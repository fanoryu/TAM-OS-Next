<?php
declare(strict_types=1);

/*
 * GET /api/ready without a database server: not-ready answers, the log reason, the public
 * envelope, health staying up, and the migration CLI refusing to run over HTTP. The
 * database-backed readiness cases are in tests/Db/ReadinessTest.php (CI).
 */

use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Http\Request;
use function TamOs\Tests\assertApiHeaders;
use function TamOs\Tests\assertNoLeak;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\envelope;
use function TamOs\Tests\fail;
use function TamOs\Tests\kernel;
use function TamOs\Tests\migrationFixture;
use function TamOs\Tests\requestId;
use function TamOs\Tests\runMigrateCli;
use function TamOs\Tests\tempDir;
use function TamOs\Tests\testConfig;

$secrets = ['hunter2-password', 'tamos_ci', 'db.internal.example', 'tamos_prod', 'history_missing', 'db_unavailable', 'db_unconfigured', 'migrations_invalid'];
$accessLine = static function (string $logPath): array {
    foreach (file($logPath, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        $entry = json_decode($line, true);
        if (($entry['event'] ?? null) === 'request') {
            return $entry;
        }
    }
    fail('no access line');
};
$unreachable = ['host' => '127.0.0.1', 'port' => 1, 'name' => 'tamos_prod', 'user' => 'tamos_ci', 'pass' => 'hunter2-password'];

return [
    'no db section: ready is 503 service_unavailable, reason db_unconfigured in the log only' => static function () use ($accessLine, $secrets): void {
        $config = testConfig();
        $r = kernel($config)->handle(new Request('GET', '/api/ready'), requestId());
        assertSame([503, 'service_unavailable'], [$r->status, envelope($r)['error']['code']]);
        assertApiHeaders($r, requestId());
        assertNoLeak($r->body, $secrets);
        assertSame(['/api/ready', 503, 'service_unavailable', 'db_unconfigured'], array_values(array_intersect_key($accessLine($config->logPath), array_flip(['route', 'status', 'error', 'reason']))));
    },
    'an unreachable database: 503, reason db_unavailable, no credential anywhere' => static function () use ($accessLine, $secrets, $unreachable): void {
        $config = testConfig(['db' => $unreachable]);
        $r = kernel($config)->handle(new Request('GET', '/api/ready'), requestId());
        assertSame(503, $r->status);
        assertNoLeak($r->body, $secrets);
        assertSame('db_unavailable', $accessLine($config->logPath)['reason']);
        foreach (['hunter2-password', 'tamos_ci', 'tamos_prod'] as $s) {
            assertTrue(!str_contains((string) file_get_contents($config->logPath), $s), 'log leaks ' . $s);
        }
    },
    'an invalid migration directory is checked before connecting: reason migrations_invalid' => static function () use ($accessLine, $unreachable): void {
        $config = testConfig(['db' => $unreachable]);
        $dir = migrationFixture(['0002_gap.sql' => "CREATE TABLE a (x INT)\n"]);
        $r = kernel($config, null, $dir)->handle(new Request('GET', '/api/ready'), requestId());
        assertSame(503, $r->status);
        assertSame('migrations_invalid', $accessLine($config->logPath)['reason'], 'the file set is validated before any connection');
    },
    '/api/health stays 200 while /api/ready is 503' => static function () use ($unreachable): void {
        foreach ([testConfig(), testConfig(['db' => $unreachable]), testConfig(['db' => 'garbage'])] as $config) {
            $k = kernel($config);
            assertSame(503, $k->handle(new Request('GET', '/api/ready'), requestId())->status);
            assertSame(200, $k->handle(new Request('GET', '/api/health'), requestId())->status);
        }
    },
    'HEAD /api/ready is routed; other methods are 405; queries are refused' => static function (): void {
        $k = kernel();
        assertSame(503, $k->handle(new Request('HEAD', '/api/ready'), requestId())->status);
        $post = $k->handle(new Request('POST', '/api/ready', '', 'application/json', 'https://tamos.test', null, '{}'), requestId());
        assertSame([405, 'GET, HEAD'], [$post->status, $post->headers['Allow'] ?? null]);
        assertSame(400, $k->handle(new Request('GET', '/api/ready', 'verbose=1'), requestId())->status);
    },
    'a log reason must be a fixed lower-case code' => static function (): void {
        foreach (['', 'DB down', 'reason with spaces', 'x;DROP', str_repeat('a', 40), "a\nb", 'Db_unavailable'] as $bad) {
            assertThrows(LogicException::class, static fn () => new ApiError(ErrorCode::ServiceUnavailable, logReason: $bad), json_encode($bad));
        }
        assertSame('schema_pending', (new ApiError(ErrorCode::ServiceUnavailable, logReason: 'schema_pending'))->logReason);
    },
    'the migration CLI does nothing under a non-CLI SAPI (php -S)' => static function (): void {
        $probe = stream_socket_server('tcp://127.0.0.1:0');
        $port = (int) substr((string) strrchr((string) stream_socket_get_name($probe, false), ':'), 1);
        fclose($probe);
        $logs = tempDir();
        $cmd = [PHP_BINARY];
        if (php_ini_loaded_file() === false) {
            $cmd[] = '-n';
        }
        array_push($cmd, '-S', '127.0.0.1:' . $port, '-t', dirname(__DIR__, 2) . '/bin');
        $env = getenv();
        $env['TAMOS_CONFIG'] = tempDir() . '/absent.php';
        $proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['file', $logs . '/o', 'w'], 2 => ['file', $logs . '/e', 'w']], $pipes, null, $env);
        try {
            $body = null;
            $deadline = microtime(true) + 10;
            while ($body === null && microtime(true) < $deadline) {
                $c = @stream_socket_client('tcp://127.0.0.1:' . $port, $errno, $errstr, 0.2);
                if ($c === false) {
                    usleep(50000);
                    continue;
                }
                fwrite($c, "GET /migrate.php?apply HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
                $raw = (string) stream_get_contents($c);
                fclose($c);
                $body = explode("\r\n\r\n", $raw, 2)[1] ?? '';
            }
        } finally {
            proc_terminate($proc);
        }
        assertSame('', $body, 'no output, no work');
    },
    'the migration CLI rejects unknown commands with usage and exit 2' => static function (): void {
        foreach ([[], ['migrate'], ['apply', 'extra'], ['--force']] as $args) {
            $r = runMigrateCli($args, null);
            assertSame(2, $r['exit'], json_encode($args));
            assertTrue(str_contains($r['stderr'], 'usage'), 'usage shown');
        }
    },
    'the migration CLI fails safely without a usable database' => static function () use ($unreachable): void {
        $missing = runMigrateCli(['status'], tempDir() . '/absent.php');
        assertSame([1, "configuration rejected: missing\n"], [$missing['exit'], $missing['stderr']]);
        $file = \TamOs\Tests\writeConfigFile(testConfig(['db' => $unreachable]));
        foreach (['status', 'apply'] as $cmd) {
            $r = runMigrateCli([$cmd], $file);
            assertSame([1, "database: unavailable during connect\n", ''], [$r['exit'], $r['stderr'], $r['stdout']], $cmd);
        }
        $none = runMigrateCli(['apply'], \TamOs\Tests\writeConfigFile(testConfig()));
        assertSame([1, "database: unavailable during config\n"], [$none['exit'], $none['stderr']]);
    },
];
