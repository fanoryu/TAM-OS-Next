<?php
declare(strict_types=1);

/*
 * Data-layer unit tests that need no database server: configuration validation, error
 * classification, connect-failure mapping, parameter rules, exception hardening and the
 * database test guards. Real-MariaDB behaviour is in tests/Db/ (CI).
 */

use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Data\DatabaseError;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\dbGuardViolations;
use function TamOs\Tests\testConfig;

$valid = static fn (array $over = []): array => $over + [
    'host' => '127.0.0.1', 'port' => 3306, 'name' => 'tamos_test', 'user' => 'tamos_ci', 'pass' => 'hunter2-password',
];
$configError = static function (mixed $raw): DatabaseError {
    $e = assertThrows(DatabaseError::class, static fn () => DatabaseConfig::fromArray($raw));
    assertSame([DatabaseError::UNAVAILABLE, 'config'], [$e->kind, $e->operation]);
    return $e;
};
$pdoError = static function (string $message, ?array $info): \PDOException {
    $e = new \PDOException($message);
    $e->errorInfo = $info;
    return $e;
};

return [
    'a complete db section validates and builds the exact DSN' => static function () use ($valid): void {
        $c = DatabaseConfig::fromArray($valid());
        assertSame('mysql:host=127.0.0.1;port=3306;dbname=tamos_test;charset=utf8mb4', $c->dsn());
        assertSame(['127.0.0.1', 3306, 'tamos_test', 'tamos_ci'], [$c->host, $c->port, $c->name, $c->user]);
    },
    'an absent or non-array db section is unavailable (config)' => static function () use ($configError): void {
        foreach ([null, 'mysql://x', 3306, true] as $raw) {
            $configError($raw);
        }
        assertSame(DatabaseError::UNAVAILABLE, assertThrows(DatabaseError::class, static fn () => DatabaseConfig::fromConfig(testConfig()))->kind);
    },
    'unknown, missing or mistyped db keys are refused' => static function () use ($valid, $configError): void {
        $configError($valid(['socket' => '/tmp/x']));
        $missing = $valid();
        unset($missing['pass']);
        $configError($missing);
        foreach ([['port' => '3306'], ['port' => 0], ['port' => 70000], ['host' => ''], ['host' => 'db;dbname=other'], ['host' => 'db host'],
            ['host' => 'db/x'], ['name' => 'tamos-test'], ['name' => ''], ['name' => str_repeat('a', 65)], ['user' => ''], ['pass' => null],
            ['pass' => "a\0b"], ['user' => 'CHANGE_ME'], ['pass' => 'CHANGE_ME']] as $bad) {
            $configError($valid($bad));
        }
    },
    'the password never appears in debug output or error messages' => static function () use ($valid): void {
        $c = DatabaseConfig::fromArray($valid());
        ob_start();
        var_export($c->__debugInfo());
        $dump = (string) ob_get_clean();
        assertTrue(!str_contains($dump, 'hunter2') && str_contains($dump, '[REDACTED]'), 'debugInfo masks the password');
        $e = assertThrows(DatabaseError::class, static fn () => DatabaseConfig::fromArray($valid(['port' => 'x'])));
        assertTrue(!str_contains($e->getMessage(), 'hunter2') && !str_contains($e->getMessage(), 'tamos_ci'), 'message is value-free');
    },
    '#[SensitiveParameter] hides the password even when trace arguments are enabled' => static function () use ($valid): void {
        $previous = ini_set('zend.exception_ignore_args', '0');
        try {
            $e = assertThrows(DatabaseError::class, static fn () => DatabaseConfig::fromArray($valid(['port' => 'x'])));
        } finally {
            ini_set('zend.exception_ignore_args', (string) $previous);
        }
        assertTrue(!str_contains($e->getTraceAsString(), 'hunter2'), 'trace hides the db section');
    },
    'runtime hardening drops call arguments from every trace' => static function (): void {
        \TamOs\hardenRuntime();
        assertSame('1', ini_get('zend.exception_ignore_args'));
        $thrower = static function (string $secret): never {
            throw new RuntimeException('x');
        };
        try {
            $thrower('hunter2-in-args');
        } catch (RuntimeException $e) {
            assertTrue(!str_contains($e->getTraceAsString(), 'hunter2-in-args'), 'no arguments in the trace');
        }
    },
    'deadlock 1213 and lock-wait 1205 are transient' => static function () use ($pdoError): void {
        $deadlock = DatabaseError::fromPdo($pdoError('SQLSTATE[40001]: Deadlock found; user tamos_ci', ['40001', 1213, 'Deadlock found']), 'execute');
        assertSame([DatabaseError::TRANSIENT, '40001', 1213, 'execute'], [$deadlock->kind, $deadlock->sqlstate, $deadlock->driverCode, $deadlock->operation]);
        $wait = DatabaseError::fromPdo($pdoError('SQLSTATE[HY000]: Lock wait timeout', ['HY000', 1205, 'Lock wait timeout exceeded']), 'select');
        assertSame([DatabaseError::TRANSIENT, 1205], [$wait->kind, $wait->driverCode]);
    },
    'lost connections are unavailable; everything else is failure' => static function () use ($pdoError): void {
        foreach ([2006, 2013] as $code) {
            assertSame(DatabaseError::UNAVAILABLE, DatabaseError::fromPdo($pdoError('gone', ['HY000', $code, 'gone']), 'select')->kind);
        }
        foreach ([['23000', 1062], ['42000', 1064], ['42S02', 1146], ['HY000', null]] as [$state, $code]) {
            assertSame(DatabaseError::FAILURE, DatabaseError::fromPdo($pdoError('x', [$state, $code, 'x']), 'select')->kind);
        }
    },
    'a DatabaseError keeps codes only: no driver message, no chained exception' => static function () use ($pdoError): void {
        $raw = "SQLSTATE[23000]: Integrity constraint violation: 1062 Duplicate entry 'salary-9000' for key 'PRIMARY'";
        $e = DatabaseError::fromPdo($pdoError($raw, ['23000', 1062, "Duplicate entry 'salary-9000'"]), 'execute');
        assertSame('database failure during execute', $e->getMessage());
        assertSame(null, $e->getPrevious());
        assertTrue(!str_contains(serialize([$e->kind, $e->operation, $e->sqlstate, $e->driverCode]), 'salary'), 'no row values');
    },
    'connect failures are unavailable; codes are read from the message shape only' => static function () use ($pdoError): void {
        $e = DatabaseError::fromConnect($pdoError("SQLSTATE[HY000] [1045] Access denied for user 'tamos_ci'@'10.0.0.5' (using password: YES)", null));
        assertSame([DatabaseError::UNAVAILABLE, 'connect', 'HY000', 1045], [$e->kind, $e->operation, $e->sqlstate, $e->driverCode]);
        assertTrue(!str_contains($e->getMessage(), 'tamos_ci') && !str_contains($e->getMessage(), '10.0.0.5'), 'no user or host');
        $odd = DatabaseError::fromConnect($pdoError('could not find driver', null));
        assertSame([DatabaseError::UNAVAILABLE, null, null], [$odd->kind, $odd->sqlstate, $odd->driverCode]);
    },
    'an unreachable server is unavailable and the connection is lazy' => static function () use ($valid): void {
        $db = new Database(DatabaseConfig::fromArray($valid(['port' => 1])));
        $e = assertThrows(DatabaseError::class, static fn () => $db->select('SELECT 1 AS one'));
        assertSame([DatabaseError::UNAVAILABLE, 'connect'], [$e->kind, $e->operation]);
        assertTrue(!str_contains($e->getMessage(), '127.0.0.1') && !str_contains($e->getMessage(), 'hunter2'), 'value-free');
    },
    'parameters must be a positional list of int, string, bool or null (checked before connecting)' => static function () use ($valid): void {
        $db = new Database(DatabaseConfig::fromArray($valid(['port' => 1])));
        foreach ([[1.5], [['x']], [new stdClass()], ['a' => 1]] as $params) {
            assertThrows(LogicException::class, static fn () => $db->select('SELECT ? AS v', $params), json_encode($params) ?: 'object');
        }
    },
    'database test guards refuse anything but a loopback *_test database in env test with the opt-in' => static function (): void {
        $ok = testConfig(['db' => ['host' => '127.0.0.1', 'port' => 3306, 'name' => 'tamos_test', 'user' => 'u', 'pass' => 'p']]);
        assertSame([], dbGuardViolations($ok, ['TAMOS_DB_TESTS' => '1']));
        assertSame(['TAMOS_DB_TESTS is not 1'], dbGuardViolations($ok, ['TAMOS_DB_TESTS' => false]));
        $cases = [
            'env is not test' => ['env' => 'development', 'origin' => 'http://127.0.0.1:1'],
            'database name does not end in _test' => ['db' => ['host' => '127.0.0.1', 'name' => 'tamos']],
            'database host is not loopback' => ['db' => ['host' => 'db.example.com', 'name' => 'tamos_test']],
        ];
        foreach ($cases as $reason => $over) {
            $config = testConfig($over + ['db' => ['host' => '127.0.0.1', 'name' => 'tamos_test']]);
            assertTrue(in_array($reason, dbGuardViolations($config, ['TAMOS_DB_TESTS' => '1']), true), $reason);
        }
        foreach (['production_test_x', 'tamos_testing', 'TAMOS_TEST', 'a-b_test', '_test', 'tamos'] as $name) {
            $config = testConfig(['db' => ['host' => '127.0.0.1', 'name' => $name]]);
            assertTrue(in_array('database name does not end in _test', dbGuardViolations($config, ['TAMOS_DB_TESTS' => '1']), true), $name);
        }
        foreach (['10.0.0.5', 'db', '127.0.0.2', 'localhost.evil.test'] as $host) {
            $config = testConfig(['db' => ['host' => $host, 'name' => 'tamos_test']]);
            assertTrue(in_array('database host is not loopback', dbGuardViolations($config, ['TAMOS_DB_TESTS' => '1']), true), $host);
        }
        assertTrue(dbGuardViolations(testConfig(['db' => 'x']), ['TAMOS_DB_TESTS' => '1']) !== [], 'a non-array db section is refused');
    },
];
