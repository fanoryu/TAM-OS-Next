<?php
declare(strict_types=1);

/*
 * BF-3C route-table fail-closed rules (SDR-0002 §7): every production mutation is either a
 * business mutation declaring its server Action or one of the five account self-service routes.
 */

use TamOs\Http\Request;
use TamOs\Http\Route;
use TamOs\Http\RouteAuth;
use TamOs\Http\Routes;
use TamOs\Policy\Action;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\productionRoutes;
use function TamOs\Tests\testConfig;

$h = static fn (): array => [];
$selfService = static fn (): array => array_map(static function (string $key) use ($h): Route {
    [$method, $path] = explode(' ', $key, 2);
    return new Route($method, $path, $h(...));
}, Routes::ACCOUNT_SELF_SERVICE);

return [
    'the self-service allow-list is exactly the five BF-3A/BF-3B account routes' => static function (): void {
        assertSame([
            'POST /api/auth/login',
            'POST /api/auth/logout',
            'POST /api/auth/activate',
            'POST /api/auth/change-password',
            'POST /api/auth/logout-all',
        ], Routes::ACCOUNT_SELF_SERVICE);
    },
    'the production table validates: its only mutations are self-service, none claims an Action' => static function (): void {
        $routes = productionRoutes(testConfig());
        $mutations = [];
        foreach ($routes as $r) {
            assertSame(null, $r->action, $r->method . ' ' . $r->path);
            if (in_array($r->method, Request::MUTATION_METHODS, true)) {
                $mutations[] = $r->method . ' ' . $r->path;
            }
        }
        sort($mutations);
        $expected = Routes::ACCOUNT_SELF_SERVICE;
        sort($expected);
        assertSame($expected, $mutations);
    },
    'a business mutation without an Action fails the table' => static function () use ($h, $selfService): void {
        foreach (['POST', 'PUT', 'PATCH', 'DELETE'] as $method) {
            $table = [...$selfService(), new Route($method, '/api/employees', $h(...), [], RouteAuth::Required)];
            assertThrows(\LogicException::class, static fn () => Routes::validate($table), $method);
        }
        $table = [...$selfService(), new Route('POST', '/api/auth/login-as', $h(...))];
        assertThrows(\LogicException::class, static fn () => Routes::validate($table), 'a look-alike of a self-service path');
    },
    'a business mutation with an Action, and any read, pass' => static function () use ($h, $selfService): void {
        $table = [...$selfService(),
            new Route('POST', '/api/employees', $h(...), [], RouteAuth::Required, Action::EmployeeCreate),
            new Route('GET', '/api/employees', $h(...), ['id'], RouteAuth::Required)];
        assertSame(7, count(Routes::validate($table)));
    },
    'a self-service route may not claim a business Action, and none may go missing' => static function () use ($h, $selfService): void {
        $routes = $selfService();
        $routes[0] = new Route('POST', '/api/auth/login', $h(...), [], RouteAuth::Required, Action::SettingsManage);
        assertThrows(\LogicException::class, static fn () => Routes::validate($routes), 'self-service with an Action');
        assertThrows(\LogicException::class, static fn () => Routes::validate(array_slice($selfService(), 1)), 'an allow-list entry without a route');
    },
    'an Action requires a mutation and a required session' => static function () use ($h): void {
        assertThrows(\LogicException::class, static fn () => new Route('GET', '/api/x', $h(...), [], RouteAuth::Required, Action::EmployeeUpdate), 'read');
        assertThrows(\LogicException::class, static fn () => new Route('POST', '/api/x', $h(...), [], RouteAuth::Optional, Action::EmployeeUpdate), 'optional');
        assertThrows(\LogicException::class, static fn () => new Route('POST', '/api/x', $h(...), [], RouteAuth::None, Action::EmployeeUpdate), 'none');
        assertTrue(new Route('DELETE', '/api/x', $h(...), [], RouteAuth::Required, Action::EmployeeDelete) instanceof Route, 'valid');
    },
];
