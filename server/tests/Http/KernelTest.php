<?php
declare(strict_types=1);

/*
 * In-process API contract tests: Kernel::handle(Request) → Response.
 *
 * The mutation pipeline has no production route in BF-1, so these tests exercise it through
 * a TEST-ONLY route table passed to the kernel. No such route exists in Routes::production().
 */

use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Http\Request;
use TamOs\Http\Route;
use function TamOs\Tests\assertApiHeaders;
use function TamOs\Tests\assertNoLeak;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\envelope;
use function TamOs\Tests\jsonPost;
use function TamOs\Tests\kernel;
use function TamOs\Tests\requestId;
use function TamOs\Tests\testConfig;

$seen = new ArrayObject();
$testRoutes = static fn (): array => [
    new Route('GET', '/api/health', \TamOs\Controller\HealthController::handle(...)),
    new Route('POST', '/api/test-echo', static function (Request $r, ?object $principal, array $json) use ($seen): array {
        $seen['principal'] = $principal;
        $seen['json'] = $json;
        return ['received' => array_keys($json)];
    }),
    new Route('GET', '/api/test-query', static fn (): array => ['q' => 'ok'], ['page']),
    new Route('GET', '/api/test-throw', static function (): never {
        throw new RuntimeException('boom in /home/u123/tamos/src/Secret.php password=hunter2 SQLSTATE[HY000]');
    }),
    new Route('GET', '/api/test-warning', static function (): array {
        $a = [];
        return [$a['missing']];
    }),
    new Route('GET', '/api/test-type-error', static fn (): array => [strlen(...)(null)]),
    new Route('GET', '/api/test-conflict', static fn (): never => throw new ApiError(ErrorCode::Conflict, 'version 3 != 4')),
    new Route('GET', '/api/test-unauthenticated', static fn (): never => throw new ApiError(ErrorCode::Unauthenticated)),
    new Route('GET', '/api/test-forbidden', static fn (): never => throw new ApiError(ErrorCode::Forbidden)),
    new Route('GET', '/api/test-rate', static fn (): never => throw new ApiError(ErrorCode::RateLimited, '', [], [], 60)),
    new Route('GET', '/api/test-unavailable', static fn (): never => throw new ApiError(ErrorCode::ServiceUnavailable)),
];
$get = static fn (string $path, string $query = '', string $method = 'GET'): Request => new Request($method, $path, $query);
$code = static function ($response): string {
    return envelope($response)['error']['code'];
};

return [
    'GET /api/health → 200 {ok,data:{status:ok},requestId} with governed headers' => static function () use ($get): void {
        $r = kernel()->handle($get('/api/health'), requestId());
        assertSame(200, $r->status);
        assertApiHeaders($r, requestId());
        assertSame(['ok' => true, 'data' => ['status' => 'ok'], 'requestId' => requestId()], envelope($r));
        assertNoLeak($r->body);
    },
    'health reveals nothing about version, runtime, environment or host' => static function () use ($get): void {
        $body = kernel(testConfig(['env' => 'development', 'origin' => 'http://127.0.0.1:8766']))->handle($get('/api/health'), requestId())->body;
        foreach (['2.11', PHP_VERSION, 'php', 'development', 'test', '127.0.0.1', 'tamos', php_uname('n')] as $needle) {
            assertTrue(!str_contains(strtolower($body), strtolower($needle)), 'health leaks ' . $needle);
        }
    },
    'HEAD /api/health is routed like GET' => static function () use ($get): void {
        assertSame(200, kernel()->handle($get('/api/health', '', 'HEAD'), requestId())->status);
    },
    'unknown and malformed paths are 404 not_found' => static function () use ($get, $code): void {
        foreach (['/api/ready', '/api/../index.html', '/api/%2e%2e/', '/api/health/', '/api/HEALTH'] as $path) {
            $r = kernel()->handle($get($path), requestId());
            assertSame([404, 'not_found'], [$r->status, $code($r)], $path);
            assertApiHeaders($r, requestId());
        }
    },
    'wrong method is 405 method_not_allowed with Allow' => static function () use ($get, $code): void {
        foreach (['POST', 'DELETE', 'OPTIONS', 'TRACE'] as $method) {
            $r = kernel()->handle(new Request($method, '/api/health', '', 'application/json', 'https://tamos.test', null, '{}'), requestId());
            assertSame([405, 'method_not_allowed', 'GET, HEAD'], [$r->status, $code($r), $r->headers['Allow'] ?? null], $method);
        }
    },
    'OPTIONS never becomes a CORS preflight' => static function () use ($get): void {
        $r = kernel()->handle(new Request('OPTIONS', '/api/health', '', null, 'https://evil.test'), requestId());
        assertSame(405, $r->status);
        assertApiHeaders($r, requestId());
    },
    'query strings: none accepted by health; route allow-lists enforced' => static function () use ($get, $code, $testRoutes): void {
        foreach (['x=1', 'callback=f', 'role=ceo', str_repeat('a', 3000)] as $q) {
            $r = kernel()->handle($get('/api/health', $q), requestId());
            assertSame([400, 'invalid_query'], [$r->status, $code($r)], substr($q, 0, 20));
        }
        $k = kernel(null, $testRoutes());
        assertSame(200, $k->handle($get('/api/test-query', 'page=2'), requestId())->status);
        foreach (['page=1&page=2', 'page=1&x=1', 'page%00=1', 'page=%ff', 'PAGE=1'] as $q) {
            assertSame(400, $k->handle($get('/api/test-query', $q), requestId())->status, $q);
        }
    },
    'mutations need the canonical Origin (or same-origin Referer): else 403 forbidden' => static function () use ($testRoutes, $code): void {
        $k = kernel(null, $testRoutes());
        foreach ([['origin' => null], ['origin' => 'https://evil.test'], ['origin' => 'null'], ['origin' => null, 'referer' => 'https://evil.test/']] as $o) {
            $r = $k->handle(jsonPost('/api/test-echo', '{}', $o), requestId());
            assertSame([403, 'forbidden'], [$r->status, $code($r)], json_encode($o));
        }
        assertSame(200, $k->handle(jsonPost('/api/test-echo', '{}', ['origin' => null, 'referer' => 'https://tamos.test/app']), requestId())->status);
    },
    'mutations need application/json: else 415 unsupported_media_type' => static function () use ($testRoutes, $code): void {
        $k = kernel(null, $testRoutes());
        foreach ([null, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=a', 'application/jsonx'] as $ct) {
            $r = $k->handle(jsonPost('/api/test-echo', '{}', ['contentType' => $ct]), requestId());
            assertSame([415, 'unsupported_media_type'], [$r->status, $code($r)], (string) $ct);
        }
    },
    'an oversized body is 413 payload_too_large' => static function () use ($testRoutes, $code): void {
        $r = kernel(null, $testRoutes())->handle(jsonPost('/api/test-echo', '', ['bodyTooLarge' => true]), requestId());
        assertSame([413, 'payload_too_large'], [$r->status, $code($r)]);
    },
    'a malformed or non-object body is 400 malformed_json' => static function () use ($testRoutes, $code): void {
        foreach (['', '[]', '{"a":', 'null', "{\"a\":\"\xff\"}"] as $body) {
            $r = kernel(null, $testRoutes())->handle(jsonPost('/api/test-echo', $body), requestId());
            assertSame([400, 'malformed_json'], [$r->status, $code($r)]);
        }
    },
    'a valid mutation reaches the handler with the decoded body and a null principal' => static function () use ($testRoutes, $seen): void {
        $r = kernel(null, $testRoutes())->handle(jsonPost('/api/test-echo', '{"role":"ceo","company_id":"c1","employee_id":"e1"}'), requestId());
        assertSame(200, $r->status);
        assertSame(null, $seen['principal'], 'principal stays null despite role/company_id/employee_id');
        assertSame(['role' => 'ceo', 'company_id' => 'c1', 'employee_id' => 'e1'], $seen['json']);
    },
    'handler-raised ApiErrors map to 401 / 403 / 409 / 429 / 503' => static function () use ($testRoutes, $get, $code): void {
        $k = kernel(null, $testRoutes());
        foreach (['unauthenticated' => 401, 'forbidden' => 403, 'conflict' => 409, 'rate' => 429, 'unavailable' => 503] as $p => $status) {
            $r = $k->handle($get('/api/test-' . $p), requestId());
            assertSame($status, $r->status, $p);
            assertApiHeaders($r, requestId());
        }
        assertSame('60', $k->handle($get('/api/test-rate'), requestId())->headers['Retry-After'] ?? null);
        assertTrue(!str_contains($k->handle($get('/api/test-conflict'), requestId())->body, 'version 3'), 'detail hidden');
    },
    'exceptions, PHP warnings and TypeErrors become a generic 500 with no leak' => static function () use ($testRoutes, $get, $code): void {
        $config = testConfig();
        $k = kernel($config, $testRoutes());
        foreach (['/api/test-throw', '/api/test-warning', '/api/test-type-error'] as $path) {
            $r = $k->handle($get($path), requestId());
            assertSame([500, 'internal_error'], [$r->status, $code($r)], $path);
            assertApiHeaders($r, requestId());
            assertNoLeak($r->body, [$config->logPath, 'hunter2', 'u123']);
        }
        $log = (string) file_get_contents($config->logPath);
        assertTrue(str_contains($log, '"class":"RuntimeException"'), 'exception logged');
        assertTrue(!str_contains($log, 'hunter2'), 'log redacted');
    },
    'request bodies, query values and identity fields are never logged' => static function () use ($testRoutes, $get): void {
        $config = testConfig();
        $k = kernel($config, $testRoutes());
        $k->handle(jsonPost('/api/test-echo', '{"password":"hunter2","role":"ceo"}'), requestId());
        $k->handle($get('/api/test-query', 'page=sensitive-value'), requestId());
        $log = (string) file_get_contents($config->logPath);
        foreach (['hunter2', 'ceo', 'sensitive-value', 'password'] as $needle) {
            assertTrue(!str_contains($log, $needle), 'log contains ' . $needle);
        }
    },
    'HSTS only in production over HTTPS' => static function (): void {
        $req = static fn (bool $https): Request => new Request('GET', '/api/health', '', null, null, null, '', false, $https);
        $prod = testConfig(['env' => 'production']);
        assertSame('max-age=31536000', kernel($prod)->handle($req(true), requestId())->headers['Strict-Transport-Security'] ?? null);
        assertTrue(!isset(kernel($prod)->handle($req(false), requestId())->headers['Strict-Transport-Security']), 'not over http');
        assertTrue(!isset(kernel()->handle($req(true), requestId())->headers['Strict-Transport-Security']), 'not outside production');
        assertSame('max-age=31536000', kernel($prod)->handle(new Request('GET', '/nope', '', null, null, null, '', false, true), requestId())->headers['Strict-Transport-Security'] ?? null, 'errors too');
    },
    'the response request ID is the server-generated one' => static function () use ($get): void {
        $r = kernel()->handle($get('/api/health'), 'c0ffee' . str_repeat('0', 26));
        assertSame('c0ffee' . str_repeat('0', 26), envelope($r)['requestId']);
    },
];
