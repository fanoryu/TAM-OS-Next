<?php
declare(strict_types=1);

/*
 * Assertion and fixture helpers for the backend test harness (no PHPUnit, no Composer).
 * Test files return an array of name => closure; server/tests/run.php executes them.
 */

namespace TamOs\Tests;

use TamOs\Config\Config;
use TamOs\Config\ConfigLoader;
use TamOs\Http\Kernel;
use TamOs\Http\Request;
use TamOs\Http\Response;
use TamOs\Http\Route;
use TamOs\Http\Routes;
use TamOs\Identity\NullPrincipalResolver;
use TamOs\Log\Logger;

final class AssertionFailed extends \RuntimeException
{
}

function fail(string $message): never
{
    throw new AssertionFailed($message);
}

function assertSame(mixed $expected, mixed $actual, string $label = ''): void
{
    if ($expected !== $actual) {
        fail(($label !== '' ? $label . ': ' : '') . 'expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

function assertTrue(bool $condition, string $label): void
{
    if (!$condition) {
        fail($label);
    }
}

/**
 * @template T of \Throwable
 * @param class-string<T> $class
 * @return T
 */
function assertThrows(string $class, callable $fn, string $label = ''): \Throwable
{
    try {
        $fn();
    } catch (\Throwable $e) {
        if ($e instanceof $class) {
            return $e;
        }
        fail(($label !== '' ? $label . ': ' : '') . 'expected ' . $class . ', got ' . $e::class);
    }
    fail(($label !== '' ? $label . ': ' : '') . 'expected ' . $class . ', nothing thrown');
}

/** A fresh, empty temporary directory for one test. */
function tempDir(): string
{
    $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'tamos-test-' . bin2hex(random_bytes(6));
    mkdir($dir, 0700, true);
    return $dir;
}

/** @param array<string, mixed> $overrides */
function testConfig(array $overrides = []): Config
{
    return ConfigLoader::fromArray($overrides + [
        'env' => 'test',
        'origin' => 'https://tamos.test',
        'log_path' => tempDir() . DIRECTORY_SEPARATOR . 'api.log',
    ]);
}

/** @param list<Route>|null $routes production routes when null */
function kernel(?Config $config = null, ?array $routes = null): Kernel
{
    $config ??= testConfig();
    return new Kernel($routes ?? Routes::production(), new NullPrincipalResolver(), $config, new Logger($config->logPath, $config->env));
}

function requestId(): string
{
    return str_repeat('ab', 16);
}

/** @return array<string, mixed> */
function envelope(Response $response): array
{
    $decoded = json_decode($response->body, true, 16, JSON_THROW_ON_ERROR);
    assertTrue(is_array($decoded), 'envelope is a JSON object');
    return $decoded;
}

/** Asserts the governed API headers and the request-ID echo on any response. */
function assertApiHeaders(Response $response, string $requestId): void
{
    foreach (\TamOs\Http\ApiHeaders::HEADERS as $name => $value) {
        assertSame($value, $response->headers[$name] ?? null, 'header ' . $name);
    }
    assertSame('application/json; charset=utf-8', $response->headers['Content-Type'] ?? null, 'Content-Type');
    assertSame($requestId, $response->headers['X-Request-Id'] ?? null, 'X-Request-Id');
    foreach (array_keys($response->headers) as $name) {
        assertTrue(!str_starts_with(strtolower($name), 'access-control-'), 'no CORS header (' . $name . ')');
        assertTrue(strtolower($name) !== 'set-cookie', 'no Set-Cookie');
    }
}

/**
 * Fails when a client-visible body carries internals: filesystem paths, PHP file names,
 * database vocabulary, stack traces, exception class names or known configuration values.
 *
 * @param list<string> $secrets additional literal values that must never appear
 */
function assertNoLeak(string $body, array $secrets = []): void
{
    $patterns = [
        '#/home/#i', '#[A-Za-z]:\\\\#', '#\.php#i', '#\bPDO#', '#SQLSTATE#i', '#Stack trace#i', '/#\d+ /',
        '#Exception#', '#ErrorException#', '#Warning#', '#TAMOS_CONFIG#', '#config\.local#', '#tamos-test-#',
    ];
    foreach ($patterns as $pattern) {
        assertTrue(preg_match($pattern, $body) !== 1, 'response leaks ' . $pattern . ': ' . substr($body, 0, 200));
    }
    foreach ($secrets as $secret) {
        assertTrue($secret === '' || !str_contains($body, $secret), 'response leaks a configured value');
    }
}

/**
 * Every reason the database test guards refuse, for this configuration and environment. The
 * database suite may create or drop anything only when this list is empty. The guards are
 * deliberately redundant: a disposable CI database must satisfy all of them at once.
 *
 * @param array<string, string|false> $env TAMOS_DB_TESTS and friends, as getenv() returns them
 * @return list<string>
 */
function dbGuardViolations(Config $config, array $env): array
{
    $out = [];
    if ($config->env !== 'test') {
        $out[] = 'env is not test';
    }
    if (($env['TAMOS_DB_TESTS'] ?? false) !== '1') {
        $out[] = 'TAMOS_DB_TESTS is not 1';
    }
    $db = is_array($config->db) ? $config->db : [];
    if (!is_string($db['name'] ?? null) || preg_match('/^[a-z0-9_]{1,58}_test$/', $db['name']) !== 1) {
        $out[] = 'database name does not end in _test';
    }
    if (!in_array($db['host'] ?? null, ['127.0.0.1', 'localhost', '::1'], true)) {
        $out[] = 'database host is not loopback';
    }
    return $out;
}

/** The disposable test database's configuration, from TAMOS_TEST_DB_* (CI sets them). */
function testDbConfig(): Config
{
    $port = getenv('TAMOS_TEST_DB_PORT');
    return testConfig(['db' => [
        'host' => (string) getenv('TAMOS_TEST_DB_HOST'),
        'port' => is_string($port) && ctype_digit($port) ? (int) $port : 0,
        'name' => (string) getenv('TAMOS_TEST_DB_NAME'),
        'user' => (string) getenv('TAMOS_TEST_DB_USER'),
        'pass' => (string) getenv('TAMOS_TEST_DB_PASS'),
    ]]);
}

/**
 * A connection to the guarded test database, with every table in it dropped. Refuses unless
 * all guards pass AND the server confirms the connected schema is the configured one.
 */
function testDatabase(): \TamOs\Data\Database
{
    $config = testDbConfig();
    $violations = dbGuardViolations($config, ['TAMOS_DB_TESTS' => getenv('TAMOS_DB_TESTS')]);
    if ($violations !== []) {
        fail('database test guard refused: ' . implode('; ', $violations));
    }
    $db = new \TamOs\Data\Database(\TamOs\Data\DatabaseConfig::fromConfig($config));
    $current = $db->select('SELECT DATABASE() AS name')[0]['name'] ?? null;
    if ($current !== $config->db['name']) {
        fail('database test guard refused: connected schema is not the configured test database');
    }
    foreach ($db->select('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()') as $row) {
        $table = (string) $row['t'];
        if (preg_match('/^[a-z0-9_]{1,64}$/', $table) !== 1) {
            fail('database test guard refused: unexpected table name');
        }
        $db->execute('DROP TABLE `' . $table . '`');
    }
    return $db;
}

/** Builds a request the way a browser on the canonical origin would send a JSON mutation. */
function jsonPost(string $path, string $body, array $overrides = []): Request
{
    $args = $overrides + [
        'method' => 'POST', 'path' => $path, 'query' => '', 'contentType' => 'application/json',
        'origin' => 'https://tamos.test', 'referer' => null, 'body' => $body, 'bodyTooLarge' => false, 'isHttps' => true,
    ];
    return new Request(...$args);
}
