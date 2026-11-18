<?php
declare(strict_types=1);

/*
 * AWP-01 B1 option B-ii: DB-free tests of the test-only COMMIT-boundary fault proxy (tests/Support/CommitFaultProxy.php
 * and commit-fault-proxy.php). Every packet here is SYNTHETIC: these tests prove the relay's own logic — framing,
 * correlation, interception, refusals and the independent evidence check — and say nothing about real MariaDB or
 * mysqlnd behaviour (assumptions AS-1 … AS-6, which only the authorized database run can prove).
 */

use TamOs\Data\Audit\AuditLog;
use TamOs\Data\Request\RequestStore;
use TamOs\Data\Transaction\TransactionStore;
use TamOs\Tests\Support\CommitFaultEvidence;
use TamOs\Tests\Support\CommitFaultEvidenceStore;
use TamOs\Tests\Support\CommitFaultProxyProcess;
use TamOs\Tests\Support\CommitFaultRelay;
use TamOs\Tests\Support\CommitFaultTrxPoller;
use TamOs\Tests\Support\MysqlPacket;
use TamOs\Tests\Support\RelayRefusal;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\fail;

require_once dirname(__DIR__) . '/Support/CommitFaultProxy.php';

// Every proxy run here is synthetic: its retained evidence goes to a scratch root this file owns and removes at
// exit, never to the persistent default root that the authorized database run uses.
if (!defined('TAMOS_B1_UNIT_EVIDENCE')) {
    define('TAMOS_B1_UNIT_EVIDENCE', sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'tamos-b1-evidence-unit-' . bin2hex(random_bytes(6)));
    register_shutdown_function(static function (): void {
        $rm = static function (string $p) use (&$rm): void {
            if (is_dir($p) && !is_link($p)) {
                foreach (scandir($p) ?: [] as $n) {
                    if ($n !== '.' && $n !== '..') {
                        $rm($p . DIRECTORY_SEPARATOR . $n);
                    }
                }
                @rmdir($p);
            } elseif (file_exists($p)) {
                @unlink($p);
            }
        };
        foreach (glob(TAMOS_B1_UNIT_EVIDENCE . '*') ?: [] as $p) {
            $rm($p);
        }
    });
}
/** A fresh scratch path under the unit root. */
$scratch = static fn (string $name): string => TAMOS_B1_UNIT_EVIDENCE . '-' . $name . '-' . bin2hex(random_bytes(4));
/** Writes $bytes as a synthetic result.json in its own scratch directory and returns its path. */
$synthetic = static function (string $bytes) use ($scratch): string {
    $d = $scratch('src');
    mkdir($d, 0700, true);
    file_put_contents($d . DIRECTORY_SEPARATOR . 'result.json', $bytes);
    return $d . DIRECTORY_SEPARATOR . 'result.json';
};
// A complete result in deliberately non-canonical formatting: retention must keep these exact bytes, not re-encode.
$completeBytes = "{ \"armed\":false,  \"verdict\": \"transparent\", \"failure\": null, \"threadId\": 4242,\n"
    . "  \"expected\": [], \"events\": [ {\"n\":0,\"type\":\"handshake\",\"threadId\":4242}, {\"n\":1,\"type\":\"commit-forwarded\",\"txn\":7,\"response\":\"ok\"} ],\n"
    . "  \"complete\": true, \"exit\": 0, \"note\": \"\\u00e9\" }\n";

$f = static fn (int $seq, string $p): string => MysqlPacket::frame($seq, $p);
$u32 = static fn (int $v): string => pack('V', $v);
// protocol 41, long password (CLIENT_MYSQL), connect with db, transactions, secure connection, multi-results, plugin auth
$caps = 0x00000001 | 0x00000008 | 0x00000200 | 0x00002000 | 0x00008000 | 0x00020000 | 0x00080000;
$greeting = static fn (int $thread = 42): string => $f(0, "\x0A" . "10.11.19-MariaDB\x00" . $u32($thread) . 'abcdefgh' . "\x00" . pack('v', 0xF7FF) . "\x2D" . pack('v', 0x0002) . pack('v', 0x81BF) . "\x15" . str_repeat("\x00", 10) . 'ijklmnopqrst' . "\x00" . "mysql_native_password\x00");
$response = static fn (int $c) => $f(1, pack('V', $c) . pack('V', 0x01000000) . "\x2D" . str_repeat("\x00", 23) . "app_test\x00" . "\x14" . str_repeat('c', 20) . "tamos_test\x00" . "mysql_native_password\x00");
$ok = static fn (int $seq, int $affected = 0, int $status = 0x0002): string => $f($seq, "\x00" . chr($affected) . "\x00" . pack('v', $status) . "\x00\x00");
$err = static fn (int $seq): string => $f($seq, MysqlPacket::errPayload(1062, '23000', 'Duplicate entry'));
$query = static fn (string $sql): string => $f(0, "\x03" . $sql);
$prepare = static fn (string $sql): string => $f(0, "\x16" . $sql);
$prepareOk = static fn (int $id): string => $f(1, "\x00" . $u32($id) . pack('v', 0) . pack('v', 1) . "\x00" . pack('v', 0)) . $f(2, "\x03def\x00\x00\x00\x01?\x00\x0C\x3F\x00\x00\x00\x00\x00\xFD\x80\x00\x00\x00\x00") . $f(3, "\xFE\x00\x00\x02\x00");
$execute = static fn (int $id): string => $f(0, "\x17" . $u32($id) . "\x00" . $u32(1) . "\x00\x01\xFD\x00\x01x");
$close = static fn (int $id): string => $f(0, "\x19" . $u32($id));
$resultSet = $f(1, "\x01") . $f(2, "\x03def\x00\x00\x00\x02id\x00\x0C\x2D\x00\x80\x00\x00\x00\xFD\x00\x00\x00\x00\x00") . $f(3, "\xFE\x00\x00\x03\x00") . $f(4, "\x01a") . $f(5, "\xFE\x00\x00\x03\x00");
$wire = static fn (string $sql): string => CommitFaultProxyProcess::wireSql($sql);
$expected = array_map($wire, [TransactionStore::INSERT_SQL, RequestStore::INSERT_PAYMENT_SQL, RequestStore::TRANSITION_SQL, AuditLog::APPEND_REQUEST_SQL, AuditLog::APPEND_TRANSACTION_SQL]);

/**
 * A synthetic pay session: [direction, bytes, tag]. 'c' = client → proxy, 's' = server → proxy. Mirrors the
 * mysqlnd/PDO sequence the design assumes (AS-1, AS-5): connect, init command, the READ COMMITTED statement,
 * START TRANSACTION, the lock read, the five expected writes (prepare, execute, OK, close), COMMIT, ROLLBACK, QUIT.
 */
$pay = static function () use ($f, $greeting, $response, $caps, $ok, $query, $prepare, $prepareOk, $execute, $close, $resultSet, $expected): array {
    $s = [['s', $greeting(), 'greeting'], ['c', $response($caps), 'auth'], ['s', $ok(2), 'auth-ok'],
        ['c', $query("SET time_zone='+00:00'"), 'init'], ['s', $ok(1), 'init-ok'],
        ['c', $prepare('SET TRANSACTION ISOLATION LEVEL READ COMMITTED'), 'rc'], ['s', $prepareOk(1), 'rc-p'], ['c', $execute(1), 'rc-x'], ['s', $ok(1), 'rc-ok'], ['c', $close(1), 'rc-c'],
        ['c', $query('START TRANSACTION'), 'begin'], ['s', $ok(1, 0, 0x0003), 'begin-ok'],
        ['c', $prepare('SELECT id FROM finance_requests WHERE id = ? FOR UPDATE'), 'lock'], ['s', $prepareOk(2), 'lock-p'], ['c', $execute(2), 'lock-x'], ['s', $resultSet, 'lock-rows'], ['c', $close(2), 'lock-c']];
    foreach ($expected as $i => $sql) {
        $id = 3 + $i;
        array_push($s, ['c', $prepare($sql), 'p' . $i], ['s', $prepareOk($id), 'pok' . $i], ['c', $execute($id), 'x' . $i], ['s', $ok(1, 1, 0x0003), 'ok' . $i], ['c', $close($id), 'c' . $i]);
    }
    array_push($s, ['c', $query('COMMIT'), 'commit'], ['c', $query('ROLLBACK'), 'rollback'], ['s', $ok(1, 0, 0x0002), 'rollback-ok'], ['c', $f(0, "\x01"), 'quit']);
    return $s;
};
$replace = static function (array $steps, string $tag, ?array $with): array {
    $out = [];
    foreach ($steps as $s) {
        if ($s[2] === $tag) {
            if ($with !== null) {
                $out[] = $with;
            }
            continue;
        }
        $out[] = $s;
    }
    return $out;
};
$insertAfter = static function (array $steps, string $tag, array $new): array {
    $out = [];
    foreach ($steps as $s) {
        $out[] = $s;
        if ($s[2] === $tag) {
            array_push($out, ...$new);
        }
    }
    return $out;
};
$goodObservation = ['trx' => [['trx_id' => '4711', 'state' => 'RUNNING', 'isolation' => 'READ COMMITTED', 'rows_modified' => 5]], 'snapshot' => ['payments' => [['n' => 1]]]];
/** A successful bounded after-rollback poll (B-1) for the transaction above. */
$goodPost = ['trx' => [], 'poll' => ['outcome' => 'gone', 'trxId' => '4711', 'polls' => 2, 'elapsedMs' => 61.5, 'deadlineMs' => 2000, 'intervalMs' => 50, 'final' => [], 'error' => null]];
/** A fake monotonic clock (ns) and sleep for the poller: sleeping advances the clock exactly. */
$fakeClock = static function (): array {
    $t = 1_000_000_000;
    $slept = [];
    return [static function () use (&$t): int {
        return $t;
    }, static function (int $us) use (&$t, &$slept): void {
        $slept[] = $us;
        $t += $us * 1000;
    }, static function () use (&$slept): array {
        return $slept;
    }];
};
/** A query that answers from $answers in turn (a Throwable is thrown), counting its calls. */
$scripted = static function (array $answers, int &$calls): \Closure {
    return static function () use (&$answers, &$calls): mixed {
        $calls++;
        $a = array_shift($answers);
        if ($a instanceof \Throwable) {
            throw $a;
        }
        return $a;
    };
};
/** Feeds $steps (each split into $chunk-byte pieces when given) and returns what the relay forwarded each way. */
$drive = static function (CommitFaultRelay $r, array $steps, int $chunk = 0, ?array $observation = null) use ($goodObservation, $goodPost): array {
    $toServer = '';
    $toClient = '';
    foreach ($steps as [$dir, $bytes]) {
        foreach ($chunk > 0 ? str_split($bytes, $chunk) : [$bytes] as $piece) {
            $dir === 'c' ? $r->client($piece) : $r->server($piece);
            if ($r->needsObservation()) {
                $r->observe($observation ?? $goodObservation);
            }
            if ($r->needsPostObservation()) {
                $r->observeAfterRollback($goodPost);
            }
            $toServer .= $r->drainToServer();
            $toClient .= $r->drainToClient();
        }
    }
    return [$toServer, $toClient];
};
$bytesOf = static fn (array $steps, string $dir): string => implode('', array_map(static fn (array $s): string => $s[0] === $dir ? $s[1] : '', $steps));
$complete = static fn (array $result): array => $result + ['complete' => true, 'exit' => 0];
$injected = $f(1, MysqlPacket::errPayload(CommitFaultRelay::INJECTED_CODE, CommitFaultRelay::INJECTED_SQLSTATE, CommitFaultRelay::INJECTED_MESSAGE));
/** An armed relay that must refuse $steps: nothing after the refusal is forwarded, COMMIT never reaches the server. */
$refuses = static function (array $steps, string $needle, string $label) use ($drive, $expected, $query): void {
    $r = new CommitFaultRelay(true, $expected);
    [$toServer, $toClient] = $drive($r, $steps);
    assertTrue(is_string($r->failure()) && str_contains($r->failure(), $needle), $label . ': refused with "' . $needle . '", got ' . var_export($r->failure(), true));
    assertTrue(!str_contains($toServer, $query('COMMIT')), $label . ': COMMIT not forwarded');
    assertSame('failed', $r->result()['verdict'], $label . ': verdict');
};

// --- real-process helpers: the test plays both the client and a fake upstream server ---------------------------
$readN = static function ($sock, int $n, string $label): string {
    $buf = '';
    $until = microtime(true) + 10;
    while (strlen($buf) < $n) {
        if (microtime(true) > $until) {
            fail($label . ': timed out after ' . strlen($buf) . ' of ' . $n . ' bytes');
        }
        $chunk = @fread($sock, $n - strlen($buf));
        if ($chunk === false || ($chunk === '' && feof($sock))) {
            return $buf;
        }
        $buf .= $chunk;
    }
    return $buf;
};
$fakeUpstream = static function (): array {
    $srv = stream_socket_server('tcp://127.0.0.1:0');
    assertTrue($srv !== false, 'fake upstream listens');
    $name = (string) stream_socket_get_name($srv, false);
    return [$srv, (int) substr($name, (int) strrpos($name, ':') + 1)];
};
$connect = static function (CommitFaultProxyProcess $proxy, $srv): array {
    $c = stream_socket_client('tcp://127.0.0.1:' . $proxy->port, $errno, $errstr, 5);
    assertTrue($c !== false, 'client connects to the proxy');
    $s = stream_socket_accept($srv, 5);
    assertTrue($s !== false, 'the proxy connects to the fake upstream');
    stream_set_timeout($c, 5);
    stream_set_timeout($s, 5);
    return [$c, $s];
};
$spec = static fn (bool $armed, int $port, array $over = []) => $over + ['armed' => $armed, 'expected' => $armed ? $expected : [], 'upstreamHost' => '127.0.0.1',
    'upstreamPort' => $port, 'observer' => 'none', 'snapshot' => [], 'lifetimeSeconds' => 20];

return [
    'framing: packets are taken whole across partial and coalesced reads; a multi-packet payload is refused' => static function () use ($f): void {
        $buf = $f(0, 'abc') . $f(1, '') . substr($f(2, 'xyz'), 0, 5);
        assertSame([[0, 'abc'], [1, '']], MysqlPacket::take($buf));
        assertSame(5, strlen($buf), 'the partial packet stays buffered');
        $buf .= 'yz';
        assertSame([[2, 'xyz']], MysqlPacket::take($buf));
        $big = "\xFF\xFF\xFF\x00" . 'x';
        assertThrows(RelayRefusal::class, static fn () => MysqlPacket::take($big));
        $at = 0;
        assertSame(251 + 0, MysqlPacket::lenenc("\xFC\xFB\x00", $at) + 0);
        assertSame(3, $at);
        $bad = "\xFB";
        $at = 0;
        assertThrows(RelayRefusal::class, static fn () => MysqlPacket::lenenc($bad, $at));
        assertSame(['affectedRows' => 1, 'status' => 3], MysqlPacket::ok("\x00\x01\x00\x03\x00\x00\x00"));
        assertSame(null, MysqlPacket::ok("\xFF\x01\x00"));
        assertSame(['code' => 1644, 'sqlstate' => '45000'], MysqlPacket::err(MysqlPacket::errPayload(1644, '45000', 'm')));
    },
    'wire SQL: named placeholders become ?, quoted literals are untouched' => static function (): void {
        assertSame('SELECT ? , ? FROM t WHERE a = \':x\' AND b = ?', CommitFaultProxyProcess::wireSql('SELECT :a , :b_2 FROM t WHERE a = \':x\' AND b = :c'));
        assertTrue(!str_contains(CommitFaultProxyProcess::wireSql(AuditLog::APPEND_TRANSACTION_SQL), ':company_id'), 'the real audit statement is rewritten');
    },
    'unarmed: every byte is forwarded unchanged both ways, whole and in 1-, 3- and 7-byte pieces' => static function () use ($pay, $drive, $bytesOf, $complete): void {
        $steps = $pay();
        foreach ([0, 1, 3, 7] as $chunk) {
            $steps2 = array_map(static fn (array $s): array => $s[2] === 'rollback-ok' ? ['s', $s[1], 'commit-ok'] : $s, array_values(array_filter($steps, static fn (array $s): bool => $s[2] !== 'rollback')));
            $r = new CommitFaultRelay(false);
            [$toServer, $toClient] = $drive($r, $steps2, $chunk);
            assertSame($bytesOf($steps2, 'c'), $toServer, 'client bytes, chunk ' . $chunk);
            assertSame($bytesOf($steps2, 's'), $toClient, 'server bytes, chunk ' . $chunk);
            assertSame([], CommitFaultEvidence::transparentProblems($complete($r->result()), 0), 'transparent, chunk ' . $chunk);
        }
    },
    'armed: the COMMIT after the five acknowledged writes is intercepted, never forwarded, answered with the injected ERR; ROLLBACK is forwarded and confirmed' => static function () use ($pay, $drive, $bytesOf, $complete, $expected, $query, $injected): void {
        foreach ([0, 2, 5] as $chunk) {
            $steps = $pay();
            $r = new CommitFaultRelay(true, $expected);
            [$toServer, $toClient] = $drive($r, $steps, $chunk);
            $withoutCommit = array_values(array_filter($steps, static fn (array $s): bool => $s[2] !== 'commit'));
            assertSame($bytesOf($withoutCommit, 'c'), $toServer, 'everything but the COMMIT reached the server, unchanged');
            assertTrue(!str_contains($toServer, $query('COMMIT')), 'COMMIT never forwarded');
            $serverBytes = $bytesOf($steps, 's');
            $rollbackOk = end($steps)[2] === 'quit' ? $steps[count($steps) - 2][1] : '';
            assertSame(substr($serverBytes, 0, -strlen($rollbackOk)) . $injected . $rollbackOk, $toClient, 'the client got every server packet plus the injected ERR in place of the COMMIT reply');
            $result = $complete($r->result());
            assertSame('intercepted-rolled-back', $result['verdict']);
            assertSame([], CommitFaultEvidence::armedProblems($result, $expected, 0), 'the independent evidence check accepts it (chunk ' . $chunk . ')');
        }
    },
    'armed: a COMMIT without the five correct acknowledgments is refused and never forwarded' => static function () use ($drive, $expected, $pay, $replace, $insertAfter, $refuses, $ok, $err, $execute, $prepare, $prepareOk, $close, $query, $f): void {
        $steps = $pay();
        $refuses($replace($steps, 'ok4', ['s', $err(1), 'ok4']), 'not acknowledged', 'the expense audit row answered ERR');
        $refuses($replace($steps, 'ok3', ['s', $ok(1, 0, 0x0003), 'ok3']), 'not acknowledged', 'the request audit row affected no row');
        $refuses($replace($steps, 'ok4', ['s', $ok(1, 2, 0x0003), 'ok4']), 'not acknowledged', 'two rows affected');
        $refuses($replace($steps, 'ok2', ['s', $ok(1, 1, 0x0002), 'ok2']), 'ended implicitly', 'an acknowledgment without the in-transaction flag');
        $refuses($replace($replace($replace($replace($steps, 'p4', null), 'pok4', null), 'x4', null), 'ok4', null), 'not the expected statement', 'the expense audit row never ran (the lock read becomes one of the last five)');
        $refuses($replace($replace($replace($replace($steps, 'p0', null), 'pok0', null), 'x0', null), 'ok0', null), 'not the expected statement', 'the expense insert never ran');
        $swapped = [];
        foreach ($steps as $s) {
            $swapped[] = match ($s[2]) { 'p3' => ['c', $prepare(CommitFaultProxyProcess::wireSql(AuditLog::APPEND_TRANSACTION_SQL)), 'p3'], 'p4' => ['c', $prepare(CommitFaultProxyProcess::wireSql(AuditLog::APPEND_REQUEST_SQL)), 'p4'], default => $s };
        }
        $refuses($swapped, 'not the expected statement', 'the two audit rows in the wrong order');
        $refuses($insertAfter($steps, 'c4', [['c', $prepare('SELECT 1'), 'e'], ['s', $prepareOk(20), 'e'], ['c', $execute(20), 'e'], ['s', $f(1, "\x01") . $f(2, "\xFE\x00\x00\x02\x00"), 'e']]), 'not the expected statement', 'a read after the expense audit row');
        $refuses($insertAfter($steps, 'c4', [['c', $query("SET @x = 1"), 'e'], ['s', $ok(1, 0, 0x0003), 'e']]), 'other than COM_STMT_CLOSE', 'a query after the expense audit row');
        $dup = $insertAfter($steps, 'lock-c', [['c', $prepare(CommitFaultProxyProcess::wireSql(TransactionStore::INSERT_SQL)), 'e'], ['s', $prepareOk(30), 'e'], ['c', $execute(30), 'e'], ['s', $ok(1, 1, 0x0003), 'e'], ['c', $close(30), 'e']]);
        $refuses($dup, 'more than once', 'the expense insert executed twice');
        $short = new CommitFaultRelay(true, $expected);
        $drive($short, array_values(array_filter($steps, static fn (array $s): bool => !in_array($s[2], ['lock', 'lock-p', 'lock-x', 'lock-rows', 'lock-c', 'rc', 'rc-p', 'rc-x', 'rc-ok', 'rc-c', 'p0', 'pok0', 'x0', 'ok0', 'c0'], true))));
        assertTrue(str_contains((string) $short->failure(), 'fewer than five'), 'only four executions in the transaction: ' . var_export($short->failure(), true));
    },
    'armed: transaction and connection identity — no transaction, nested, a second COMMIT, unknown statements and ambiguous control are refused' => static function () use ($pay, $replace, $insertAfter, $refuses, $query, $ok, $execute, $prepare, $f): void {
        $steps = $pay();
        $refuses($replace($replace($steps, 'begin', null), 'begin-ok', null), 'without an acknowledged START TRANSACTION', 'COMMIT outside a transaction');
        $refuses($replace($steps, 'begin-ok', ['s', $ok(1, 0, 0x0002), 'begin-ok']), 'not acknowledged with an open transaction', 'START TRANSACTION without the flag');
        $refuses($insertAfter($steps, 'begin-ok', [['c', $query('START TRANSACTION'), 'e']]), 'inside an open transaction', 'nested START TRANSACTION');
        $refuses($insertAfter($steps, 'rollback-ok', [['c', $query('COMMIT'), 'e']]), 'second COMMIT', 'a second COMMIT after the intercepted one');
        $refuses($insertAfter($steps, 'begin-ok', [['c', $execute(99), 'e']]), 'unknown statement id', 'an execute of an unknown statement');
        foreach (['COMMIT AND CHAIN', '/* x */ COMMIT', 'BEGIN', 'SET autocommit = 1', 'SAVEPOINT a'] as $q) {
            $refuses($insertAfter($steps, 'begin-ok', [['c', $query($q), 'e']]), 'ambiguous transaction control', 'query "' . $q . '"');
        }
        $refuses($insertAfter($steps, 'begin-ok', [['c', $prepare('COMMIT'), 'e']]), 'ambiguous transaction control', 'a prepared COMMIT');
        $refuses($replace($steps, 'greeting', ['s', $f(0, "\x09" . 'old'), 'greeting']), 'protocol version 10', 'a protocol 9 greeting');
    },
    'unsupported protocol modes are refused during the handshake' => static function () use ($pay, $replace, $refuses, $response, $caps, $f): void {
        $steps = $pay();
        foreach ([[0x00000800, 'TLS'], [0x00000020, 'compression'], [0x04000000, 'zstd'], [0x08000000, 'query attributes'], [0x00010000, 'multi-statements']] as [$bit, $name]) {
            $refuses($replace($steps, 'auth', ['c', $response($caps | $bit), 'auth']), $name, $name);
        }
        $refuses($replace($steps, 'auth', ['c', $response($caps & ~0x00000200), 'auth']), 'protocol 41', 'no protocol 41');
        $noMysql = $f(1, pack('V', $caps & ~1) . pack('V', 0x01000000) . "\x2D" . str_repeat("\x00", 19) . "\x04\x00\x00\x00" . "app_test\x00\x00");
        $refuses($replace($steps, 'auth', ['c', $noMysql, 'auth']), 'MariaDB extended capabilities', 'MariaDB extended capabilities');
        $refuses($replace($steps, 'auth', ['c', $f(1, pack('V', $caps | 0x800) . str_repeat("\x00", 28)), 'auth']), 'TLS', 'an SSLRequest');
        $refuses($replace($steps, 'auth', ['c', $f(1, 'short'), 'auth']), 'truncated client handshake', 'a truncated handshake response');
    },
    'unexpected packet sequences and commands are refused' => static function () use ($pay, $insertAfter, $replace, $refuses, $f, $query, $ok): void {
        $steps = $pay();
        $refuses($insertAfter($steps, 'begin-ok', [['c', $f(1, "\x03SELECT 1"), 'e']]), 'not a new command', 'a client packet with sequence 1');
        $refuses($insertAfter($steps, 'begin-ok', [['c', $f(0, "\x18" . pack('V', 3) . "\x00\x00x"), 'e']]), 'unsupported command 0x18', 'COM_STMT_SEND_LONG_DATA');
        $refuses($insertAfter($steps, 'begin-ok', [['c', $f(0, "\x11" . 'u'), 'e']]), 'unsupported command 0x11', 'COM_CHANGE_USER');
        $refuses($insertAfter($steps, 'begin', [['c', $query('SELECT 1'), 'e']]), 'pipelined', 'a pipelined command');
        $refuses($replace($steps, 'begin-ok', ['s', $ok(2, 0, 0x0003), 'begin-ok']), 'sequence id 2', 'a skipped server sequence id');
        $refuses($insertAfter($steps, 'auth-ok', [['s', $ok(1), 'e']]), 'unsolicited', 'an unsolicited server packet');
        $refuses($insertAfter($steps, 'auth', [['c', $f(5, 'x'), 'e']]), 'handshake sequence', 'a handshake packet out of sequence');
        $refuses($insertAfter($steps, 'begin-ok', [['c', $f(0, ''), 'e']]), 'empty command', 'an empty command');
    },
    'rollback evidence: anything but a confirmed ROLLBACK after the injected ERR fails' => static function () use ($pay, $replace, $insertAfter, $refuses, $drive, $complete, $expected, $query, $ok, $err): void {
        $steps = $pay();
        $refuses($insertAfter($steps, 'commit', [['c', $query('SELECT 1'), 'e']]), 'other than ROLLBACK', 'a query instead of ROLLBACK');
        $refuses($replace($steps, 'rollback-ok', ['s', $err(1), 'rollback-ok']), 'ROLLBACK after the intercepted COMMIT was not acknowledged', 'ROLLBACK answered ERR');
        $refuses($replace($steps, 'rollback-ok', ['s', $ok(1, 0, 0x0003), 'rollback-ok']), 'transaction closed', 'ROLLBACK OK with the transaction still open');
        $r = new CommitFaultRelay(true, $expected);
        $drive($r, $replace($replace($replace($steps, 'rollback', null), 'rollback-ok', null), 'quit', null));
        $r->clientClosed();
        $res = $complete($r->result());
        assertSame('incomplete', $res['verdict'], 'a client that never rolls back is incomplete, not a pass');
        assertTrue(in_array('no forwarded ROLLBACK acknowledged by the server after the injected ERR', CommitFaultEvidence::armedProblems($res, $expected, 0), true), 'the evidence check names it');
    },
    'false PASS prevention: the evidence check rejects every incomplete or tampered result' => static function () use ($pay, $drive, $complete, $expected, $goodObservation, $goodPost): void {
        $r = new CommitFaultRelay(true, $expected);
        $drive($r, $pay());
        $good = $complete($r->result());
        assertSame([], CommitFaultEvidence::armedProblems($good, $expected, 0));
        $edit = static function (array $res, string $type, ?\Closure $fn, ?string $phase = null): array {
            $res['events'] = array_values(array_filter(array_map(static fn (array $e): ?array => $e['type'] === $type && ($phase === null || ($e['phase'] ?? null) === $phase) ? ($fn === null ? null : $fn($e)) : $e, $res['events'])));
            return $res;
        };
        $cases = [
            'no result file (premature termination)' => [null, 0],
            'a non-zero exit' => [$good, 1],
            'not marked complete' => [['complete' => false] + $good, 0],
            'the verdict alone claims success while a COMMIT was forwarded' => [['events' => array_merge($good['events'], [['n' => 999, 'type' => 'commit-forwarded', 'response' => 'ok', 'status' => 2]])] + $good, 0],
            'a refusal event' => [['events' => array_merge($good['events'], [['n' => 999, 'type' => 'refusal', 'reason' => 'x']])] + $good, 0],
            'no intercept observation' => [$edit($good, 'observation', null, 'intercept'), 0],
            'an observer error' => [$edit($good, 'observation', static fn (array $e): array => ['data' => ['error' => 'PDOException']] + $e, 'intercept'), 0],
            'a skipped observer' => [$edit($good, 'observation', static fn (array $e): array => ['data' => ['skipped' => true]] + $e, 'intercept'), 0],
            'no running transaction seen' => [$edit($good, 'observation', static fn (array $e): array => ['data' => ['trx' => []] + $goodObservation] + $e, 'intercept'), 0],
            'no snapshot' => [$edit($good, 'observation', static fn (array $e): array => ['data' => ['trx' => $goodObservation['trx'], 'snapshot' => []]] + $e, 'intercept'), 0],
            'no injected ERR' => [$edit($good, 'err-sent', null), 0],
            'no rollback confirmation' => [$edit($good, 'rollback-confirmed', null), 0],
            'a rollback confirmation with the transaction open' => [$edit($good, 'rollback-confirmed', static fn (array $e): array => ['status' => 3] + $e), 0],
            'a transaction still open after the rollback' => [$edit($good, 'observation', static fn (array $e): array => ['data' => ['trx' => $goodObservation['trx']]] + $e, 'after-rollback'), 0],
            'an expected statement acknowledged with 0 rows' => [$edit($good, 'execute', static fn (array $e): array => $e['sql'] === $expected[4] ? ['affectedRows' => 0] + $e : $e), 0],
            'a statement between the last acknowledgment and COMMIT' => [(static function () use ($good): array {
                $at = array_search('commit-intercepted', array_column($good['events'], 'type'), true);
                array_splice($good['events'], (int) $at, 0, [['n' => 998, 'type' => 'query', 'text' => 'SET @x=1', 'txn' => 1]]);
                return $good;
            })(), 0],
            'another connection id on the COMMIT' => [$edit($good, 'commit-intercepted', static fn (array $e): array => ['threadId' => 7] + $e), 0],
            'produced by an unarmed proxy' => [['armed' => false] + $good, 0],
        ];
        foreach ($cases as $label => [$res, $exit]) {
            assertTrue(CommitFaultEvidence::armedProblems($res, $expected, $exit) !== [], 'rejected: ' . $label);
        }
        // B-1: the bounded after-rollback poll must have seen the intercepted transaction id disappear in time.
        $post = static fn (array $over): \Closure => static fn (array $e): array => ['data' => ['trx' => [], 'poll' => $over + $goodPost['poll']]] + $e;
        $pollMsg = 'the bounded after-rollback poll did not see the transaction disappear within its deadline';
        $corrMsg = 'the after-rollback poll is not correlated with the transaction seen at the intercept';
        foreach ([
            'a poll that timed out' => [$post(['outcome' => 'timeout', 'final' => $goodObservation['trx']]), $pollMsg],
            'a poll that hit an error' => [$post(['outcome' => 'error']), $pollMsg],
            'an ambiguous poll' => [$post(['outcome' => 'ambiguous']), $pollMsg],
            'a poll with no correlation id' => [$post(['outcome' => 'no-correlation', 'trxId' => null, 'polls' => 0]), $pollMsg],
            'a poll that never ran' => [$post(['polls' => 0]), $pollMsg],
            'a poll past its deadline' => [$post(['elapsedMs' => 2000.5]), $pollMsg],
            'a poll with a longer deadline than allowed' => [$post(['deadlineMs' => 5000, 'elapsedMs' => 3000]), $pollMsg],
            'a poll whose last read still listed rows' => [$post(['final' => $goodObservation['trx']]), $pollMsg],
            'no poll at all (the old immediate read)' => [static fn (array $e): array => ['data' => ['trx' => []]] + $e, $pollMsg],
            'a poll for another transaction id' => [$post(['trxId' => '4712']), $corrMsg],
        ] as $label => [$fn, $msg]) {
            assertTrue(in_array($msg, CommitFaultEvidence::armedProblems($edit($good, 'observation', $fn, 'after-rollback'), $expected, 0), true), 'rejected: ' . $label);
        }
        $noId = $edit($good, 'observation', static fn (array $e): array => ['data' => ['trx' => [['trx_id' => null] + $goodObservation['trx'][0]]] + $goodObservation] + $e, 'intercept');
        assertTrue(in_array('the intercept observation has no transaction id to correlate', CommitFaultEvidence::armedProblems($noId, $expected, 0), true), 'rejected: no trx_id at the intercept');
        assertTrue(CommitFaultEvidence::transparentProblems($good, 0) !== [], 'an armed result is not a transparency control');
    },
    'process: unarmed, the real proxy process relays a whole session byte for byte and reports transparent' => static function () use ($fakeUpstream, $connect, $spec, $pay, $readN, $replace): void {
        [$srv, $port] = $fakeUpstream();
        $proxy = CommitFaultProxyProcess::start($spec(false, $port), TAMOS_B1_UNIT_EVIDENCE);
        [$c, $s] = $connect($proxy, $srv);
        $steps = array_map(static fn (array $x): array => $x[2] === 'rollback-ok' ? ['s', $x[1], 'commit-ok'] : $x, $replace($pay(), 'rollback', null));
        foreach ($steps as [$dir, $bytes, $tag]) {
            fwrite($dir === 'c' ? $c : $s, $bytes);
            assertSame($bytes, $readN($dir === 'c' ? $s : $c, strlen($bytes), $tag), 'relayed unchanged: ' . $tag);
        }
        fclose($c);
        $out = $proxy->stop();
        fclose($s);
        fclose($srv);
        assertSame([], CommitFaultEvidence::transparentProblems($out['result'], $out['exitCode']), 'transparent: ' . $out['stderr']);
    },
    'process: armed, the COMMIT never reaches the upstream, the client gets the injected ERR, and a skipped observer is never accepted as evidence' => static function () use ($fakeUpstream, $connect, $spec, $pay, $readN, $injected, $query, $expected): void {
        [$srv, $port] = $fakeUpstream();
        $proxy = CommitFaultProxyProcess::start($spec(true, $port), TAMOS_B1_UNIT_EVIDENCE);
        [$c, $s] = $connect($proxy, $srv);
        foreach ($pay() as [$dir, $bytes, $tag]) {
            fwrite($dir === 'c' ? $c : $s, $bytes);
            if ($tag === 'commit') {
                assertSame($injected, $readN($c, strlen($injected), 'injected ERR'), 'the client got the injected ERR');
                continue;
            }
            if ($tag === 'quit') {
                continue;
            }
            assertSame($bytes, $readN($dir === 'c' ? $s : $c, strlen($bytes), $tag), 'relayed: ' . $tag . ($tag === 'rollback' ? ' (the upstream reads ROLLBACK, so no COMMIT came first)' : ''));
        }
        assertSame("\x01\x00\x00\x00\x01", $readN($s, 5, 'quit'), 'QUIT is the last thing the upstream receives');
        fclose($c);
        $out = $proxy->stop();
        fclose($s);
        fclose($srv);
        assertSame(0, $out['exitCode'], 'clean exit: ' . $out['stderr']);
        assertSame('intercepted-rolled-back', $out['result']['verdict'] ?? null, 'the relay saw the full sequence');
        $problems = CommitFaultEvidence::armedProblems($out['result'], $expected, $out['exitCode']);
        assertTrue(in_array('no observation of the open transaction at the intercepted COMMIT', $problems, true), 'without a database observer it is NOT acceptance evidence');
        assertTrue(!str_contains(json_encode($out['result']), $query('COMMIT')), 'no raw packet bytes are logged');
    },
    'process: premature termination leaves no result and fails the evidence check; the client sees the connection end' => static function () use ($fakeUpstream, $connect, $spec, $greeting, $readN, $expected): void {
        [$srv, $port] = $fakeUpstream();
        $proxy = CommitFaultProxyProcess::start($spec(true, $port), TAMOS_B1_UNIT_EVIDENCE);
        [$c, $s] = $connect($proxy, $srv);
        fwrite($s, $greeting());
        $readN($c, strlen($greeting()), 'greeting');
        $out = $proxy->kill();
        assertSame('', $readN($c, 1, 'after kill'), 'the client connection ended');
        fclose($c);
        fclose($s);
        fclose($srv);
        assertSame(null, $out['result'], 'no result');
        assertSame(['the proxy wrote no result (terminated early or never finished)'], CommitFaultEvidence::armedProblems($out['result'], $expected, $out['exitCode']));
        assertSame(null, $out['evidence'], 'nothing is retained, and nothing is reconstructed');
        assertSame(['no retained evidence (the proxy wrote no result)'], CommitFaultEvidenceStore::retainedProblems($out), 'missing evidence fails closed');
    },
    'process: the lifetime bounds an idle proxy, which exits 3, records the timeout and closes its port' => static function () use ($fakeUpstream, $spec, $expected): void {
        [$srv2, $port2] = $fakeUpstream();
        $t = microtime(true);
        $proxy = CommitFaultProxyProcess::start($spec(true, $port2, ['lifetimeSeconds' => 1]), TAMOS_B1_UNIT_EVIDENCE);
        $listen = $proxy->port;
        $out = (static function (CommitFaultProxyProcess $p): array {
            usleep(1500000);                              // past the lifetime; the proxy exits by itself
            return $p->stop();
        })($proxy);
        fclose($srv2);
        assertTrue(microtime(true) - $t < 8.0, 'bounded');
        assertSame(3, $out['exitCode'], 'exit 3: ' . $out['stderr']);
        assertSame('lifetime exceeded', $out['result']['failure'] ?? null);
        assertTrue(CommitFaultEvidence::armedProblems($out['result'], $expected, $out['exitCode']) !== [], 'not evidence');
        $again = @stream_socket_client('tcp://127.0.0.1:' . $listen, $errno, $errstr, 1);
        assertTrue($again === false, 'the port is closed');
    },
    'process: a second client connection, an unreachable upstream and unsafe specs are refused' => static function () use ($fakeUpstream, $connect, $spec, $readN, $expected): void {
        [$srv, $port] = $fakeUpstream();
        $proxy = CommitFaultProxyProcess::start($spec(true, $port), TAMOS_B1_UNIT_EVIDENCE);
        [$c, $s] = $connect($proxy, $srv);
        $c2 = stream_socket_client('tcp://127.0.0.1:' . $proxy->port, $errno, $errstr, 5);
        $out = (static function (CommitFaultProxyProcess $p): array {
            usleep(300000);
            return $p->stop();
        })($proxy);
        assertSame('a second client connection', $out['result']['failure'] ?? null, 'second client: ' . $out['stderr']);
        assertSame(1, $out['exitCode']);
        foreach ([$c, $c2, $s, $srv] as $x) {
            if (is_resource($x)) {
                fclose($x);
            }
        }
        [$srv, $port] = $fakeUpstream();
        fclose($srv);                                     // nothing listens there now
        $proxy = CommitFaultProxyProcess::start($spec(false, $port), TAMOS_B1_UNIT_EVIDENCE);
        $c = stream_socket_client('tcp://127.0.0.1:' . $proxy->port, $errno, $errstr, 5);
        stream_set_timeout($c, 5);
        assertSame('', $readN($c, 1, 'unreachable upstream'), 'the client connection is closed');
        fclose($c);
        $out = $proxy->stop();
        assertSame('the upstream refused the connection', $out['result']['failure'] ?? null);
        foreach ([['upstreamHost' => '10.0.0.1'], ['observer' => 'remote'], ['lifetimeSeconds' => 600], ['observer' => 'db'], ['snapshot' => ['x' => ['DELETE FROM t', []]]]] as $bad) {
            $e = assertThrows(\RuntimeException::class, static fn () => CommitFaultProxyProcess::start($spec(true, 1, $bad), TAMOS_B1_UNIT_EVIDENCE));
            assertTrue(str_contains($e->getMessage(), 'refused to start'), 'refused: ' . json_encode($bad));
        }
        assertThrows(\RuntimeException::class, static fn () => CommitFaultProxyProcess::start(['armed' => true, 'expected' => ['x'], 'upstreamHost' => '127.0.0.1', 'upstreamPort' => 1, 'observer' => 'none', 'lifetimeSeconds' => 5], TAMOS_B1_UNIT_EVIDENCE));
        unset($expected);
    },
    'B-1 poll: a transaction already gone is confirmed on the first read, with no sleep' => static function () use ($fakeClock, $scripted): void {
        [$now, $sleep, $slept] = $fakeClock();
        $calls = 0;
        $r = CommitFaultTrxPoller::awaitGone($scripted([[]], $calls), '4711', 2000, 50, $now, $sleep);
        assertSame(['gone', '4711', 1, 0.0, [], null, 2000, 50], [$r['outcome'], $r['trxId'], $r['polls'], $r['elapsedMs'], $r['final'], $r['error'], $r['deadlineMs'], $r['intervalMs']]);
        assertSame([1, []], [$calls, $slept()], 'one read, no sleep');
    },
    'B-1 poll: a transaction still listed for a while is confirmed gone as soon as it disappears, about every 50 ms' => static function () use ($fakeClock, $scripted): void {
        [$now, $sleep, $slept] = $fakeClock();
        $calls = 0;
        $row = ['trx_id' => '4711', 'state' => 'RUNNING'];
        $r = CommitFaultTrxPoller::awaitGone($scripted([[$row], [['trx_id' => 4711] + $row], [$row], []], $calls), 4711, 2000, 50, $now, $sleep);
        assertSame(['gone', '4711', 4, 150.0, []], [$r['outcome'], $r['trxId'], $r['polls'], $r['elapsedMs'], $r['final']], 'gone on the 4th read after 150 ms (int and string ids agree)');
        assertSame([50000, 50000, 50000], $slept(), 'three 50 ms waits');
        assertSame(4, $calls, 'it stops at once');
    },
    'B-1 poll: a transaction that never disappears fails at the 2,000 ms deadline' => static function () use ($fakeClock, $scripted): void {
        [$now, $sleep, $slept] = $fakeClock();
        $calls = 0;
        $row = ['trx_id' => '4711', 'state' => 'RUNNING'];
        $r = CommitFaultTrxPoller::awaitGone($scripted(array_fill(0, 100, [$row]), $calls), '4711', 2000, 50, $now, $sleep);
        assertSame(['timeout', 41, 2000.0, [$row]], [$r['outcome'], $r['polls'], $r['elapsedMs'], $r['final']], 'the last read is at the deadline and is kept');
        assertSame(2000000, array_sum($slept()), 'never waits past the deadline');
        assertTrue(str_contains((string) $r['error'], '2000 ms'), 'the reason names the deadline');
    },
    'B-1 poll: another transaction, several rows, a non-list, a query error or no correlation id fail closed' => static function () use ($fakeClock, $scripted): void {
        $row = ['trx_id' => '4711', 'state' => 'RUNNING'];
        $cases = [
            'another trx id' => ['4711', [[['trx_id' => '4712'] + $row]], 'ambiguous', 1],
            'another trx id after a visible read' => ['4711', [[$row], [['trx_id' => '4712'] + $row]], 'ambiguous', 2],
            'two rows' => ['4711', [[$row, $row]], 'ambiguous', 1],
            'a row without trx_id' => ['4711', [[['state' => 'RUNNING']]], 'ambiguous', 1],
            'not a list' => ['4711', [['x' => $row]], 'ambiguous', 1],
            'not an array' => ['4711', [false], 'ambiguous', 1],
            'a query error' => ['4711', [new \RuntimeException('boom')], 'error', 1],
            'no id at the intercept' => [null, [[]], 'no-correlation', 0],
            'an empty id' => ['', [[]], 'no-correlation', 0],
            'a non-numeric id' => ['abc', [[]], 'no-correlation', 0],
        ];
        foreach ($cases as $label => [$id, $answers, $outcome, $polls]) {
            [$now, $sleep] = $fakeClock();
            $calls = 0;
            $r = CommitFaultTrxPoller::awaitGone($scripted($answers, $calls), $id, 2000, 50, $now, $sleep);
            assertSame([$outcome, $polls, $polls], [$r['outcome'], $r['polls'], $calls], $label);
            assertTrue($r['error'] !== null, 'a reason is recorded: ' . $label);
        }
    },
    'B-1 poll: with the real monotonic clock the wait is bounded and stops on disappearance' => static function () use ($scripted): void {
        $calls = 0;
        $row = ['trx_id' => '9', 'state' => 'RUNNING'];
        $t = hrtime(true);
        $r = CommitFaultTrxPoller::awaitGone($scripted(array_fill(0, 100, [$row]), $calls), '9', 200, 50);
        $wall = (hrtime(true) - $t) / 1e6;
        assertSame('timeout', $r['outcome']);
        assertTrue($r['elapsedMs'] >= 200.0 && $wall < 1500.0 && $r['polls'] >= 2 && $r['polls'] <= 6, 'bounded: ' . $r['elapsedMs'] . ' ms, ' . $r['polls'] . ' polls');
        $calls = 0;
        $r = CommitFaultTrxPoller::awaitGone($scripted([[$row], [$row], []], $calls), '9');
        assertSame(['gone', 3], [$r['outcome'], $r['polls']]);
        assertTrue($r['elapsedMs'] >= 90.0 && $r['elapsedMs'] < 1000.0, 'two real waits: ' . $r['elapsedMs'] . ' ms');
    },
    'evidence: stop() retains the original result.json bytes outside the temporary directory; cleanup removes only the temporary copy' => static function () use ($fakeUpstream, $spec, $scratch): void {
        $root = $scratch('root');
        [$srv, $port] = $fakeUpstream();
        $proxy = CommitFaultProxyProcess::start($spec(true, $port, ['lifetimeSeconds' => 1]), $root);
        $tmp = $proxy->dir;
        $out = (static function (CommitFaultProxyProcess $p): array {
            usleep(1500000);                              // the proxy exits by itself and writes its result
            return $p->stop();
        })($proxy);
        fclose($srv);
        $ev = $out['evidence'];
        assertTrue(is_array($ev), 'evidence was retained');
        assertTrue(!is_dir($tmp), 'the temporary directory is cleaned up');
        assertSame(realpath($root), dirname($ev['path']), 'retained under the evidence root');
        assertTrue(preg_match('/^b1-proxy-result-\d{8}T\d{6}Z-\d+-[0-9a-f]{12}\.json$/', basename($ev['path'])) === 1, 'run-unique name: ' . basename($ev['path']));
        $bytes = (string) file_get_contents($ev['path']);
        assertSame($ev['sha256'], hash('sha256', $bytes), 'the retained bytes match the recorded SHA-256');
        assertSame(strlen($bytes), $ev['bytes']);
        assertSame($ev['sha256'] . ' *' . basename($ev['path']) . "\n", file_get_contents($ev['path'] . '.sha256'), 'the sha256sum sidecar');
        assertSame(null, $ev['problem']);
        assertSame(json_decode($bytes, true), $out['result'], 'the test used exactly the retained result (events, order and ids)');
        assertSame([], CommitFaultEvidenceStore::retainedProblems($out), 'the independent re-check accepts it');
        echo '    evidence: ' . $ev['path'] . ' sha256=' . $ev['sha256'] . "\n";
    },
    'evidence: retention copies bytes unchanged, never overwrites a previous run, and keeps every run' => static function () use ($scratch, $synthetic, $completeBytes): void {
        $root = CommitFaultEvidenceStore::prepareRoot($scratch('root'));
        $src = $synthetic($completeBytes);
        $a = CommitFaultEvidenceStore::preserve($src, $root);
        $b = CommitFaultEvidenceStore::preserve($src, $root);
        assertTrue($a !== null && $b !== null && $a['path'] !== $b['path'] && $a['runId'] !== $b['runId'], 'two runs, two files');
        foreach ([$a, $b] as $ev) {
            assertSame($completeBytes, file_get_contents($ev['path']), 'byte-identical, formatting kept (no re-encoding)');
            assertSame(hash('sha256', $completeBytes), $ev['sha256']);
            assertSame(null, $ev['problem']);
            assertSame([], CommitFaultEvidenceStore::retainedProblems(['result' => $ev['result'], 'evidence' => $ev]));
        }
        assertSame([4242, [0, 1], 7], [$a['result']['threadId'], array_column($a['result']['events'], 'n'), $a['result']['events'][1]['txn']], 'ids and event order intact');
        assertSame($completeBytes, file_get_contents($src), 'the source is left untouched');
        assertSame(4, count(glob($root . DIRECTORY_SEPARATOR . 'b1-proxy-result-*') ?: []), 'both runs and both sidecars remain');
    },
    'evidence: empty, truncated, corrupted and incomplete results are retained as found and never accepted' => static function () use ($scratch, $synthetic, $completeBytes, $expected): void {
        $root = CommitFaultEvidenceStore::prepareRoot($scratch('root'));
        $cases = [
            'empty' => ['', 'empty'],
            'truncated' => [substr($completeBytes, 0, (int) (strlen($completeBytes) / 2)), 'not valid JSON (truncated or corrupted)'],
            'corrupted' => ["\xFF\xFE\x00garbage" . $completeBytes, 'not valid JSON (truncated or corrupted)'],
            'a JSON list' => ['[1,2,3]', 'not a complete result object'],
            'not marked complete' => [str_replace('"complete": true', '"complete": false', $completeBytes), 'not a complete result object'],
            'no event log' => ['{"armed":true,"complete":true}', 'not a complete result object'],
        ];
        foreach ($cases as $label => [$bytes, $problem]) {
            $ev = CommitFaultEvidenceStore::preserve($synthetic($bytes), $root);
            assertTrue($ev !== null, 'retained: ' . $label);
            assertSame($bytes, file_get_contents($ev['path']), 'kept exactly as found: ' . $label);
            assertSame([$problem, null], [$ev['problem'], $ev['result']], 'flagged and unusable: ' . $label);
            $out = ['result' => $ev['result'], 'evidence' => $ev, 'exitCode' => 0];
            assertTrue(in_array('the retained result is ' . $problem, CommitFaultEvidenceStore::retainedProblems($out), true), 'retention re-check rejects: ' . $label);
            assertTrue(CommitFaultEvidence::armedProblems($out['result'], $expected, 0) !== [], 'never B1 evidence: ' . $label);
        }
        assertSame(null, CommitFaultEvidenceStore::preserve($scratch('missing') . DIRECTORY_SEPARATOR . 'result.json', $root), 'a missing result retains nothing');
    },
    'evidence: a retained file that is altered, removed or detached from its checksum fails the re-check' => static function () use ($scratch, $synthetic, $completeBytes): void {
        $root = CommitFaultEvidenceStore::prepareRoot($scratch('root'));
        $fresh = static function () use ($synthetic, $completeBytes, $root): array {
            $ev = CommitFaultEvidenceStore::preserve($synthetic($completeBytes), $root);
            $result = $ev['result'];
            unset($ev['result']);
            return ['result' => $result, 'evidence' => $ev];
        };
        $out = $fresh();
        file_put_contents($out['evidence']['path'], str_replace('4242', '4243', $completeBytes));
        assertTrue(in_array('the retained evidence does not match its recorded SHA-256', CommitFaultEvidenceStore::retainedProblems($out), true), 'altered bytes');
        $out = $fresh();
        file_put_contents($out['evidence']['path'], substr($completeBytes, 0, 40));
        $p = CommitFaultEvidenceStore::retainedProblems($out);
        assertTrue(in_array('the retained evidence does not match its recorded SHA-256', $p, true) && in_array('the retained result is not valid JSON (truncated or corrupted)', $p, true), 'truncated after retention');
        $out = $fresh();
        unlink($out['evidence']['path']);
        assertSame(['the retained evidence file is missing or unreadable: ' . $out['evidence']['path']], CommitFaultEvidenceStore::retainedProblems($out), 'removed');
        $out = $fresh();
        unlink($out['evidence']['path'] . '.sha256');
        assertSame(['the checksum sidecar is missing or does not match'], CommitFaultEvidenceStore::retainedProblems($out), 'sidecar removed');
        $out = $fresh();
        $out['result']['threadId'] = 1;
        assertSame(['the retained result differs from the result the test used'], CommitFaultEvidenceStore::retainedProblems($out), 'the test used something else');
    },
    'evidence: when the copy cannot be saved, collection fails closed and the original stays in place' => static function () use ($fakeUpstream, $spec, $scratch, $synthetic, $completeBytes): void {
        $asFile = $scratch('file');
        file_put_contents($asFile, 'x');
        assertThrows(\RuntimeException::class, static fn () => CommitFaultEvidenceStore::prepareRoot($asFile), 'a file is not an evidence directory');
        assertThrows(\RuntimeException::class, static fn () => CommitFaultProxyProcess::start($spec(false, 1), $asFile), 'the proxy does not start without a usable evidence directory');
        $root = CommitFaultEvidenceStore::prepareRoot($scratch('root'));
        $src = $synthetic($completeBytes);
        rmdir($root);
        file_put_contents($root, 'not a directory');
        $e = assertThrows(\RuntimeException::class, static fn () => CommitFaultEvidenceStore::preserve($src, $root), 'the copy cannot be created');
        assertTrue(str_contains($e->getMessage(), 'the original stays at'), 'the message names the original');
        assertSame($completeBytes, file_get_contents($src), 'the original is untouched');
        // End to end: the evidence root disappears while the proxy runs; stop() throws and deletes nothing.
        $root = $scratch('root');
        [$srv, $port] = $fakeUpstream();
        $proxy = CommitFaultProxyProcess::start($spec(true, $port, ['lifetimeSeconds' => 1]), $root);
        rmdir($root);
        file_put_contents($root, 'not a directory');
        $tmp = $proxy->dir;
        $e = assertThrows(\RuntimeException::class, static function () use ($proxy): void {
            usleep(1500000);
            $proxy->stop();
        }, 'collection fails closed');
        fclose($srv);
        assertTrue(str_contains($e->getMessage(), 'evidence:'), 'an evidence failure: ' . $e->getMessage());
        assertTrue(is_file($tmp . DIRECTORY_SEPARATOR . 'result.json'), 'the original result.json is not deleted');
        assertSame('lifetime exceeded', json_decode((string) file_get_contents($tmp . DIRECTORY_SEPARATOR . 'result.json'), true)['failure'] ?? null, 'it is the proxy\'s own result');
        foreach (['spec.json', 'result.json', 'stop'] as $f) {
            @unlink($tmp . DIRECTORY_SEPARATOR . $f);
        }
        @rmdir($tmp);
    },
];
