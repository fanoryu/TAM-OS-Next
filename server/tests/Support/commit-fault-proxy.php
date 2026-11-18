<?php
declare(strict_types=1);

/*
 * TEST-ONLY — AWP-01 B1 option B-ii: the COMMIT-boundary fault proxy process (see CommitFaultProxy.php).
 * Started only by a test through CommitFaultProxyProcess::start(); never by production code.
 *
 * Argument: one private directory holding spec.json. Prints "READY <port>" once it listens, then serves
 * exactly ONE client connection and writes result.json there when it finishes. It finishes when the session
 * ends, when the test creates the file "stop" in that directory, on a refusal, or when its lifetime runs out.
 *
 * spec.json: {
 *   "armed": bool, "expected": [five wire SQL texts, armed only],
 *   "upstreamHost": "127.0.0.1" | "localhost", "upstreamPort": int,
 *   "observer": "db" | "none", "snapshot": {name: [SELECT sql, [params]]}, "lifetimeSeconds": 1..120
 * }
 * Safety: it binds only 127.0.0.1 on a random port, connects only to a loopback upstream, and with the "db"
 * observer refuses unless the database test guards pass and the upstream is the guarded test database. The
 * "none" observer exists for the DB-free tests; its results never satisfy CommitFaultEvidence::armedProblems().
 * Exit codes: 0 result written; 1 refused or failed (result written when possible); 2 usage; 3 lifetime exceeded.
 */

use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Tests\Support\CommitFaultRelay;
use TamOs\Tests\Support\CommitFaultTrxPoller;
use function TamOs\Tests\dbGuardViolations;
use function TamOs\Tests\testDbConfig;

if (PHP_SAPI !== 'cli' || count($argv) !== 2 || !is_dir($argv[1]) || !is_file($argv[1] . '/spec.json')) {
    exit(2);
}
require dirname(__DIR__, 2) . '/src/bootstrap.php';
require dirname(__DIR__) . '/lib.php';
require __DIR__ . '/CommitFaultProxy.php';

\TamOs\hardenRuntime();
\TamOs\installErrorHandler();

$dir = $argv[1];
$spec = json_decode((string) file_get_contents($dir . '/spec.json'), true);
$refuse = static function (string $why): never {
    fwrite(STDERR, 'commit-fault-proxy: ' . $why . "\n");
    exit(1);
};
if (!is_array($spec) || !is_bool($spec['armed'] ?? null) || !is_int($spec['upstreamPort'] ?? null)
    || !in_array($spec['upstreamHost'] ?? null, ['127.0.0.1', 'localhost'], true)
    || !in_array($spec['observer'] ?? null, ['db', 'none'], true)
    || !is_int($spec['lifetimeSeconds'] ?? null) || $spec['lifetimeSeconds'] < 1 || $spec['lifetimeSeconds'] > 120) {
    $refuse('invalid spec (loopback upstream, observer db|none, lifetime 1..120 s)');
}
$expected = $spec['armed'] ? ($spec['expected'] ?? null) : [];
if (!is_array($expected) || ($spec['armed'] && (count($expected) !== 5 || array_filter($expected, 'is_string') !== $expected))) {
    $refuse('an armed proxy needs exactly five expected statements');
}
$snapshot = is_array($spec['snapshot'] ?? null) ? $spec['snapshot'] : [];
if (count($snapshot) > 12) {
    $refuse('at most 12 snapshot queries');
}
foreach ($snapshot as $name => $q) {
    if (!is_string($name) || !is_array($q) || !is_string($q[0] ?? null) || preg_match('/^\s*SELECT\s/i', $q[0]) !== 1 || str_contains($q[0], ';') || !is_array($q[1] ?? [])) {
        $refuse('snapshot queries are single SELECT statements');
    }
}
if ($spec['observer'] === 'db') {
    $config = testDbConfig();
    if (dbGuardViolations($config, ['TAMOS_DB_TESTS' => getenv('TAMOS_DB_TESTS')]) !== []) {
        $refuse('the database test guards refused the observer');
    }
    if ($config->db['port'] !== $spec['upstreamPort'] || $config->db['host'] !== $spec['upstreamHost']) {
        $refuse('the upstream is not the guarded test database');
    }
}

$relay = new CommitFaultRelay($spec['armed'], array_values($expected));
$deadline = microtime(true) + $spec['lifetimeSeconds'];
$exit = 0;
$observer = null;
$interceptTrxId = null;                                            // the trx_id seen at the intercept (B-1 correlation)
$trxSql = 'SELECT trx_id, trx_state AS state, trx_isolation_level AS isolation, trx_rows_modified AS rows_modified FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id = ?';
$connectObserver = static function () use (&$observer): Database {
    if ($observer === null) {
        $observer = new Database(DatabaseConfig::fromConfig(testDbConfig()));
        $observer->execute('SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED');
    }
    return $observer;
};
/** @return array<string, mixed> the intercept observation: the open transaction and the dirty-read snapshot */
$observe = static function () use ($spec, $snapshot, $relay, $connectObserver, $trxSql, &$interceptTrxId): array {
    if ($spec['observer'] === 'none') {
        return ['skipped' => true];
    }
    try {
        $db = $connectObserver();
        $out = ['trx' => $db->select($trxSql, [(int) $relay->threadId()])];
        if (count($out['trx']) === 1) {
            $interceptTrxId = $out['trx'][0]['trx_id'] ?? null;
        }
        foreach ($snapshot as $name => [$sql, $params]) {
            $out['snapshot'][$name] = $db->select($sql, $params ?? []);
        }
        return $out;
    } catch (\Throwable $e) {
        return ['error' => get_class($e) . ($e instanceof \TamOs\Data\DatabaseError ? ' ' . $e->operation . ' ' . ($e->driverCode ?? '-') : '')];
    }
};
/**
 * @return array<string, mixed> the after-rollback observation (B-1): called only once the relay has validated the
 * server's ROLLBACK OK with the transaction flag cleared; bounded poll for the intercepted trx_id to disappear.
 */
$observeAfterRollback = static function () use ($spec, $relay, $connectObserver, $trxSql, &$interceptTrxId): array {
    if ($spec['observer'] === 'none') {
        return ['skipped' => true];
    }
    try {
        $db = $connectObserver();
    } catch (\Throwable $e) {
        return ['error' => get_class($e)];
    }
    $poll = CommitFaultTrxPoller::awaitGone(static fn (): array => $db->select($trxSql, [(int) $relay->threadId()]), $interceptTrxId);
    $out = ['trx' => $poll['outcome'] === 'gone' ? [] : $poll['final'], 'poll' => $poll];
    if ($poll['outcome'] !== 'gone') {
        $out['error'] = 'after-rollback poll: ' . $poll['outcome'] . ($poll['error'] !== null ? ' (' . $poll['error'] . ')' : '');
    }
    return $out;
};
/** Writes all of $bytes, waiting for the socket to accept them (partial writes), within the lifetime. */
$writeAll = static function ($sock, string $bytes) use ($deadline): bool {
    while ($bytes !== '') {
        $r = null;
        $w = [$sock];
        $e = null;
        if (microtime(true) > $deadline || @stream_select($r, $w, $e, 0, 200000) === false) {
            return false;
        }
        if ($w === []) {
            continue;
        }
        $n = @fwrite($sock, $bytes);
        if ($n === false || $n === 0) {
            return false;
        }
        $bytes = substr($bytes, $n);
    }
    return true;
};

$server = @stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
if ($server === false) {
    $refuse('cannot listen on 127.0.0.1');
}
$name = (string) stream_socket_get_name($server, false);
echo 'READY ' . substr($name, (int) strrpos($name, ':') + 1) . "\n";
fflush(STDOUT);

$client = null;
$upstream = null;
$done = false;
while (!$done) {
    if (microtime(true) > $deadline) {
        $relay->abort('lifetime exceeded');
        $exit = 3;
        break;
    }
    if (is_file($dir . '/stop')) {
        break;
    }
    $read = [$server];
    if ($client !== null) {
        $read[] = $client;
    }
    if ($upstream !== null) {
        $read[] = $upstream;
    }
    $w = null;
    $e = null;
    if (@stream_select($read, $w, $e, 0, 50000) === false) {
        $relay->abort('select failed');
        $exit = 1;
        break;
    }
    foreach ($read as $sock) {
        if ($sock === $server) {
            $conn = @stream_socket_accept($server, 0);
            if ($conn === false) {
                continue;
            }
            if ($client !== null) {
                fclose($conn);
                $relay->abort('a second client connection');
                $exit = 1;
                $done = true;
                break;
            }
            $client = $conn;
            $upstream = @stream_socket_client('tcp://' . $spec['upstreamHost'] . ':' . $spec['upstreamPort'], $errno, $errstr, 5);
            if ($upstream === false) {
                $relay->abort('the upstream refused the connection');
                $exit = 1;
                $done = true;
                break;
            }
            stream_set_blocking($client, false);
            stream_set_blocking($upstream, false);
            continue;
        }
        $bytes = @fread($sock, 65536);
        if ($bytes === false || ($bytes === '' && feof($sock))) {
            $sock === $client ? $relay->clientClosed() : $relay->serverClosed();
            $done = true;
            break;
        }
        $sock === $client ? $relay->client($bytes) : $relay->server($bytes);
    }
    if ($relay->needsObservation()) {
        $relay->observe($observe());
    }
    if ($relay->needsPostObservation()) {
        $relay->observeAfterRollback($observeAfterRollback());
    }
    if ($upstream !== null && !$writeAll($upstream, $relay->drainToServer())) {
        $relay->abort('writing to the upstream failed');
        $exit = 1;
        $done = true;
    }
    if ($client !== null && !$writeAll($client, $relay->drainToClient())) {
        $relay->abort('writing to the client failed');
        $exit = 1;
        $done = true;
    }
    if ($relay->failure() !== null) {
        $exit = $exit === 0 ? 1 : $exit;
        $done = true;
    }
}
foreach ([$client, $upstream, $server] as $s) {
    if (is_resource($s)) {
        fclose($s);
    }
}
$result = $relay->result() + ['complete' => true, 'exit' => $exit];
file_put_contents($dir . '/result.tmp', json_encode($result, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT));
rename($dir . '/result.tmp', $dir . '/result.json');
exit($exit);
