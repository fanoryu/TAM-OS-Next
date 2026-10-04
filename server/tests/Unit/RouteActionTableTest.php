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
    'the self-service allow-list is exactly the seven BF-3A/BF-3B/BF-3D account routes' => static function (): void {
        assertSame([
            'POST /api/auth/login',
            'POST /api/auth/logout',
            'POST /api/auth/activate',
            'POST /api/auth/change-password',
            'POST /api/auth/logout-all',
            'POST /api/auth/forgot-password',
            'POST /api/auth/reset-password',
        ], Routes::ACCOUNT_SELF_SERVICE);
    },
    'the production table validates: its mutations are the self-service routes (no Action), the three Employee writes (BF-4a1), the four account routes under account.manage (BF-4a2) the six overtime writes under their existing overtime Actions (BF-4b1) approve under overtime.manage (BF-4b2) and the five payroll writes under payroll.manage (BF-4c1)' => static function (): void {
        $routes = productionRoutes(testConfig());
        $selfService = [];
        $business = [];
        foreach ($routes as $r) {
            $key = $r->method . ' ' . $r->path;
            if (!in_array($r->method, Request::MUTATION_METHODS, true)) {
                assertSame(null, $r->action, 'a read declares no Action: ' . $key);
                continue;
            }
            if ($r->action === null) {
                $selfService[] = $key;
            } else {
                $business[$key] = $r->action;
            }
        }
        sort($selfService);
        $expected = Routes::ACCOUNT_SELF_SERVICE;
        sort($expected);
        assertSame($expected, $selfService);
        assertSame([
            'POST /api/employees/create' => Action::EmployeeCreate,
            'POST /api/employees/update' => Action::EmployeeUpdate,
            'POST /api/employees/archive' => Action::EmployeeDelete,
            'POST /api/employees/provision-account' => Action::AccountManage,
            'POST /api/employees/reissue-activation' => Action::AccountManage,
            'POST /api/employees/disable-account' => Action::AccountManage,
            'POST /api/employees/enable-account' => Action::AccountManage,
            'POST /api/overtime-records/create' => Action::OvertimeCreateSelfDraft,
            'POST /api/overtime-records/update' => Action::OvertimeUpdateSelfDraft,
            'POST /api/overtime-records/delete' => Action::OvertimeDeleteSelfDraft,
            'POST /api/overtime-records/submit' => Action::OvertimeSubmitSelf,
            'POST /api/overtime-records/review' => Action::OvertimeManage,
            'POST /api/overtime-records/reject' => Action::OvertimeManage,
            'POST /api/overtime-records/approve' => Action::OvertimeManage,
            'POST /api/payroll-plans/generate' => Action::PayrollManage,
            'POST /api/payroll-plans/review' => Action::PayrollManage,
            'POST /api/payroll-plans/approve' => Action::PayrollManage,
            'POST /api/payroll-plans/return' => Action::PayrollManage,
            'POST /api/payroll-plans/cancel' => Action::PayrollManage,
            'POST /api/payroll-plans/commit' => Action::PayrollManage,
        ], $business);
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
        assertSame(count(Routes::ACCOUNT_SELF_SERVICE) + 2, count(Routes::validate($table)));
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
