<?php
declare(strict_types=1);

/*
 * How database failures reach a client (BF-2A): through the kernel's error boundary, as a
 * fixed envelope with no database detail, and into the log as codes only. Uses TEST-ONLY
 * routes; the production route table is unchanged.
 */

use TamOs\Data\DatabaseError;
use TamOs\Http\Request;
use TamOs\Http\Route;
use function TamOs\Tests\assertApiHeaders;
use function TamOs\Tests\assertNoLeak;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\envelope;
use function TamOs\Tests\kernel;
use function TamOs\Tests\requestId;
use function TamOs\Tests\testConfig;

$secrets = ['hunter2-password', 'tamos_ci', 'db.internal.example', 'tamos_prod', 'Duplicate entry', 'salary-9000'];
$routes = static fn (): array => [
    new Route('GET', '/api/test-unavailable', static fn (): never => throw new DatabaseError(DatabaseError::UNAVAILABLE, 'connect', 'HY000', 2002)),
    new Route('GET', '/api/test-transient', static fn (): never => throw new DatabaseError(DatabaseError::TRANSIENT, 'execute', '40001', 1213)),
    new Route('GET', '/api/test-failure', static fn (): never => throw new DatabaseError(DatabaseError::FAILURE, 'execute', '23000', 1062)),
    new Route('GET', '/api/test-raw-pdo', static function (): never {
        $e = new PDOException("SQLSTATE[23000]: Duplicate entry 'salary-9000' for user 'tamos_ci'@'db.internal.example'");
        $e->errorInfo = ['23000', 1062, "Duplicate entry 'salary-9000'"];
        throw $e;
    }),
];
$dbConfigs = [
    'absent' => null,
    'not an array' => 'mysql://tamos_ci:hunter2-password@db.internal.example/tamos_prod',
    'invalid keys' => ['host' => 'db.internal.example', 'pass' => 'hunter2-password'],
    'unreachable' => ['host' => '127.0.0.1', 'port' => 1, 'name' => 'tamos_prod', 'user' => 'tamos_ci', 'pass' => 'hunter2-password'],
];

return [
    'unavailable and transient database errors answer 503 service_unavailable' => static function () use ($routes, $secrets): void {
        foreach (['unavailable', 'transient'] as $kind) {
            $r = kernel(null, $routes())->handle(new Request('GET', '/api/test-' . $kind), requestId());
            assertSame([503, 'service_unavailable'], [$r->status, envelope($r)['error']['code']], $kind);
            assertApiHeaders($r, requestId());
            assertNoLeak($r->body, $secrets);
            assertTrue(!str_contains($r->body, '2002') && !str_contains($r->body, '1213') && !str_contains($r->body, 'HY000'), 'no codes');
        }
    },
    'other database failures answer 500 internal_error' => static function () use ($routes, $secrets): void {
        $r = kernel(null, $routes())->handle(new Request('GET', '/api/test-failure'), requestId());
        assertSame([500, 'internal_error'], [$r->status, envelope($r)['error']['code']]);
        assertNoLeak($r->body, $secrets);
    },
    'database errors are logged as codes only' => static function () use ($routes): void {
        $config = testConfig();
        kernel($config, $routes())->handle(new Request('GET', '/api/test-transient'), requestId());
        $lines = array_map(static fn (string $l): array => json_decode($l, true), file($config->logPath, FILE_IGNORE_NEW_LINES) ?: []);
        $db = array_values(array_filter($lines, static fn (array $l): bool => $l['event'] === 'db_error'))[0] ?? null;
        assertTrue($db !== null, 'db_error logged');
        assertSame(['ts', 'level', 'event', 'requestId', 'kind', 'operation', 'sqlstate', 'driverCode'], array_keys($db));
        assertSame(['transient', 'execute', '40001', 1213, requestId()], [$db['kind'], $db['operation'], $db['sqlstate'], $db['driverCode'], $db['requestId']]);
    },
    'a raw PDOException never has its message logged or returned' => static function () use ($routes, $secrets): void {
        $config = testConfig(['env' => 'development', 'origin' => 'http://127.0.0.1:8766']);
        $r = kernel($config, $routes())->handle(new Request('GET', '/api/test-raw-pdo'), requestId());
        assertSame(500, $r->status);
        assertNoLeak($r->body, $secrets);
        $log = (string) file_get_contents($config->logPath);
        foreach ($secrets as $secret) {
            assertTrue(!str_contains($log, $secret), 'log leaks ' . $secret);
        }
        assertTrue(str_contains($log, 'database message withheld'), 'message withheld');
    },
    '/api/health stays 200 whatever the db section says, and never connects' => static function () use ($dbConfigs, $secrets): void {
        foreach ($dbConfigs as $label => $db) {
            $config = testConfig($db === null ? [] : ['db' => $db]);
            $started = hrtime(true);
            $r = kernel($config)->handle(new Request('GET', '/api/health'), requestId());
            assertSame([200, ['status' => 'ok']], [$r->status, envelope($r)['data']], $label);
            assertNoLeak($r->body, $secrets);
            assertTrue(hrtime(true) - $started < 1_000_000_000, $label . ': answered without a connection attempt');
            assertTrue(!str_contains((string) @file_get_contents($config->logPath), 'db_error'), $label . ': no database activity logged');
        }
    },
    'a db section with placeholders or a bad shape does not stop the config from loading' => static function (): void {
        $config = testConfig(['db' => ['host' => 'CHANGE_ME', 'pass' => 'CHANGE_ME']]);
        assertSame('test', $config->env);
        $e = null;
        try {
            \TamOs\Data\DatabaseConfig::fromConfig($config);
        } catch (DatabaseError $e) {
        }
        assertSame([DatabaseError::UNAVAILABLE, 'config'], [$e?->kind, $e?->operation]);
    },
];
