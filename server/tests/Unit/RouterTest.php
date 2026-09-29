<?php
declare(strict_types=1);

use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Http\Router;
use TamOs\Http\Routes;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$router = new Router(Routes::production());
$code = static fn (string $method, string $path): ErrorCode => assertThrows(ApiError::class, static fn () => $router->match($method, $path))->errorCode;

return [
    'production has exactly one route: GET /api/health' => static function (): void {
        $routes = Routes::production();
        assertSame(1, count($routes));
        assertSame(['GET', '/api/health', []], [$routes[0]->method, $routes[0]->path, $routes[0]->queryKeys]);
    },
    'GET and HEAD reach health' => static function () use ($router): void {
        assertSame('/api/health', $router->match('GET', '/api/health')->path);
        assertSame('/api/health', $router->match('HEAD', '/api/health')->path);
    },
    'other methods on a known path are 405 with Allow: GET, HEAD' => static function () use ($router): void {
        foreach (['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'PROPFIND', 'get', ''] as $method) {
            $e = assertThrows(ApiError::class, static fn () => $router->match($method, '/api/health'), $method);
            assertSame(ErrorCode::MethodNotAllowed, $e->errorCode, $method);
            assertSame(['GET', 'HEAD'], $e->allow, $method);
        }
    },
    'unknown canonical paths are 404' => static function () use ($code): void {
        foreach (['/api', '/api/ready', '/api/login', '/api/health-check'] as $path) {
            assertSame(ErrorCode::NotFound, $code('GET', $path), $path);
        }
    },
    'non-canonical and suspicious paths are 404, never routed' => static function () use ($code): void {
        foreach ([
            '', '/', '/api/', '/api/health/', '//api/health', '/api//health', '/api/../index.html', '/api/./health',
            '/api/%2e%2e/index.html', '/api/health%00', '/api/health%2F', '/api%2Fhealth', '/api/Health', '/API/health',
            '/api/health.php', '/api/index.php', '/apihealth', '/api/health;x', '/api/health\\', "/api/health\0",
            '/api/he alth', '/api/-health', '/api/health-', '/api/' . str_repeat('a', 300), '/api/héalth',
        ] as $path) {
            assertSame(ErrorCode::NotFound, $code('GET', $path), json_encode($path));
            assertTrue(!Router::isCanonicalPath($path), 'not canonical: ' . json_encode($path));
        }
    },
    'unknown path with an unknown method is 404, not 405' => static function () use ($code): void {
        assertSame(ErrorCode::NotFound, $code('PROPFIND', '/api/nothing'));
    },
];
