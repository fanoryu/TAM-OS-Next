<?php
declare(strict_types=1);

use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Http\RouteAuth;
use TamOs\Http\Router;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\productionRoutes;
use function TamOs\Tests\tempDir;
use function TamOs\Tests\testConfig;

$production = static fn (): array => productionRoutes(testConfig(), tempDir() . '/none');
$router = new Router($production());
$code = static fn (string $method, string $path): ErrorCode => assertThrows(ApiError::class, static fn () => $router->match($method, $path))->errorCode;

return [
    'production has exactly thirty-six routes; activate, forgot-password and reset-password never resolve a session; change-password, logout-all, the Employee, account, overtime and payroll routes require one' => static function () use ($production): void {
        $routes = $production();
        $summary = array_map(static fn ($r): array => [$r->method, $r->path, $r->queryKeys, $r->auth], $routes);
        assertSame([
            ['GET', '/api/health', [], RouteAuth::None],
            ['GET', '/api/ready', [], RouteAuth::None],
            ['POST', '/api/auth/login', [], RouteAuth::None],
            ['POST', '/api/auth/logout', [], RouteAuth::Optional],
            ['GET', '/api/auth/me', [], RouteAuth::Required],
            ['POST', '/api/auth/activate', [], RouteAuth::None],
            ['POST', '/api/auth/change-password', [], RouteAuth::Required],
            ['POST', '/api/auth/logout-all', [], RouteAuth::Required],
            ['POST', '/api/auth/forgot-password', [], RouteAuth::None],
            ['POST', '/api/auth/reset-password', [], RouteAuth::None],
            ['GET', '/api/employees', ['archived'], RouteAuth::Required],
            ['GET', '/api/employee', ['id'], RouteAuth::Required],
            ['POST', '/api/employees/create', [], RouteAuth::Required],
            ['POST', '/api/employees/update', [], RouteAuth::Required],
            ['POST', '/api/employees/archive', [], RouteAuth::Required],
            ['POST', '/api/employees/provision-account', [], RouteAuth::Required],
            ['POST', '/api/employees/reissue-activation', [], RouteAuth::Required],
            ['POST', '/api/employees/disable-account', [], RouteAuth::Required],
            ['POST', '/api/employees/enable-account', [], RouteAuth::Required],
            ['GET', '/api/overtime-records', ['month'], RouteAuth::Required],
            ['GET', '/api/overtime-record', ['id'], RouteAuth::Required],
            ['POST', '/api/overtime-records/create', [], RouteAuth::Required],
            ['POST', '/api/overtime-records/update', [], RouteAuth::Required],
            ['POST', '/api/overtime-records/delete', [], RouteAuth::Required],
            ['POST', '/api/overtime-records/submit', [], RouteAuth::Required],
            ['POST', '/api/overtime-records/review', [], RouteAuth::Required],
            ['POST', '/api/overtime-records/reject', [], RouteAuth::Required],
            ['GET', '/api/overtime-record/valuation', ['id'], RouteAuth::Required],
            ['POST', '/api/overtime-records/approve', [], RouteAuth::Required],
            ['GET', '/api/payroll-plans', ['month'], RouteAuth::Required],
            ['GET', '/api/payroll-plan', ['id'], RouteAuth::Required],
            ['POST', '/api/payroll-plans/generate', [], RouteAuth::Required],
            ['POST', '/api/payroll-plans/review', [], RouteAuth::Required],
            ['POST', '/api/payroll-plans/approve', [], RouteAuth::Required],
            ['POST', '/api/payroll-plans/return', [], RouteAuth::Required],
            ['POST', '/api/payroll-plans/cancel', [], RouteAuth::Required],
        ], $summary);
    },
    'auth routes: POST-only login, logout, the BF-3B lifecycle and BF-3D recovery routes, GET/HEAD-only me' => static function () use ($router): void {
        assertSame('/api/auth/me', $router->match('HEAD', '/api/auth/me')->path);
        foreach (['/api/auth/login', '/api/auth/logout', '/api/auth/activate', '/api/auth/change-password', '/api/auth/logout-all', '/api/auth/forgot-password', '/api/auth/reset-password'] as $path) {
            $e = assertThrows(ApiError::class, static fn () => $router->match('GET', $path));
            assertSame([ErrorCode::MethodNotAllowed, ['POST']], [$e->errorCode, $e->allow], $path);
        }
        $e = assertThrows(ApiError::class, static fn () => $router->match('POST', '/api/auth/me'));
        assertSame([ErrorCode::MethodNotAllowed, ['GET', 'HEAD']], [$e->errorCode, $e->allow]);
        // No signup, no account administration and no CLI command over HTTP; recovery only as the two BF-3D routes.
        foreach (['/api/auth', '/api/auth/login/', '/api/auth/Login', '/api/auth/session', '/api/auth/register', '/api/auth/signup',
            '/api/auth/forgot', '/api/auth/recover', '/api/auth/reset-credentials', '/api/auth/create-ceo', '/api/mail', '/api/auth/mail-worker',
            '/api/auth/accounts', '/api/accounts', '/api/auth/activate/', '/api/auth/logoutall'] as $path) {
            assertTrue(in_array(assertThrows(ApiError::class, static fn () => $router->match('POST', $path))->errorCode, [ErrorCode::NotFound], true), $path);
        }
    },
    'GET and HEAD reach ready; other methods are 405 with Allow: GET, HEAD' => static function () use ($router): void {
        assertSame('/api/ready', $router->match('GET', '/api/ready')->path);
        assertSame('/api/ready', $router->match('HEAD', '/api/ready')->path);
        $e = assertThrows(ApiError::class, static fn () => $router->match('POST', '/api/ready'));
        assertSame([ErrorCode::MethodNotAllowed, ['GET', 'HEAD']], [$e->errorCode, $e->allow]);
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
        foreach (['/api', '/api/readiness', '/api/login', '/api/health-check', '/api/migrate'] as $path) {
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
