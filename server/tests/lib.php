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

/** Builds a request the way a browser on the canonical origin would send a JSON mutation. */
function jsonPost(string $path, string $body, array $overrides = []): Request
{
    $args = $overrides + [
        'method' => 'POST', 'path' => $path, 'query' => '', 'contentType' => 'application/json',
        'origin' => 'https://tamos.test', 'referer' => null, 'body' => $body, 'bodyTooLarge' => false, 'isHttps' => true,
    ];
    return new Request(...$args);
}
