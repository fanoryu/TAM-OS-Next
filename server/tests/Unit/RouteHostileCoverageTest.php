<?php
declare(strict_types=1);

/*
 * E11 coverage guard (SDR-0002 §17 E11): every production route names the suite(s) that exercise it
 * against hostile principals — no session, expired or revoked sessions, an Employee on CEO routes or
 * a colleague's records, another company, forged scope and missing CSRF. The table below is frozen:
 * a new route fails this test until it is given a hostile suite, and a listed suite must exist and
 * name the route (its exact path, or its parent path for routes built as parent + operation).
 */

use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\productionRoutes;
use function TamOs\Tests\testConfig;

/** route => the suites (relative to tests/, without .php) that cover it */
$coverage = [
    'GET /api/health' => ['Http/KernelTest'],
    'GET /api/ready' => ['Http/ReadyTest'],
    'POST /api/auth/login' => ['Db/AuthLoginTest', 'Http/AuthRoutingTest'],
    'POST /api/auth/logout' => ['Db/AuthCsrfTest'],
    'GET /api/auth/me' => ['Db/AuthSessionTest'],
    'POST /api/auth/activate' => ['Db/ActivationTest', 'Http/LifecycleRoutingTest'],
    'POST /api/auth/change-password' => ['Db/PasswordChangeTest', 'Db/AuthSelfServiceHostileTest'],
    'POST /api/auth/logout-all' => ['Db/PasswordChangeTest', 'Db/AuthSelfServiceHostileTest'],
    'POST /api/auth/forgot-password' => ['Db/RecoveryTest'],
    'POST /api/auth/reset-password' => ['Db/RecoveryTest'],
    'GET /api/employees' => ['Db/HostilePrincipalTest'],
    'GET /api/employee' => ['Db/HostilePrincipalTest'],
    'POST /api/employees/create' => ['Db/HostilePrincipalTest'],
    'POST /api/employees/update' => ['Db/HostilePrincipalTest'],
    'POST /api/employees/archive' => ['Db/HostilePrincipalTest'],
    'POST /api/employees/provision-account' => ['Db/AccountAdministrationTest', 'Db/HostileConfirmationsTest'],
    'POST /api/employees/reissue-activation' => ['Db/AccountAdministrationTest', 'Db/HostileConfirmationsTest'],
    'POST /api/employees/disable-account' => ['Db/AccountAdministrationTest', 'Db/HostileConfirmationsTest'],
    'POST /api/employees/enable-account' => ['Db/AccountAdministrationTest', 'Db/HostileConfirmationsTest'],
    'GET /api/overtime-records' => ['Db/OvertimeHostileTest'],
    'GET /api/overtime-record' => ['Db/OvertimeHostileTest'],
    'POST /api/overtime-records/create' => ['Db/OvertimeHostileTest'],
    'POST /api/overtime-records/update' => ['Db/OvertimeHostileTest'],
    'POST /api/overtime-records/delete' => ['Db/OvertimeHostileTest'],
    'POST /api/overtime-records/submit' => ['Db/OvertimeHostileTest'],
    'POST /api/overtime-records/review' => ['Db/OvertimeHostileTest'],
    'POST /api/overtime-records/reject' => ['Db/OvertimeHostileTest'],
    'GET /api/overtime-record/valuation' => ['Db/OvertimeHostileTest', 'Db/HostileConfirmationsTest'],
    'POST /api/overtime-records/approve' => ['Db/OvertimeHostileTest'],
    'GET /api/payroll-plans' => ['Db/PayrollHostileTest'],
    'GET /api/payroll-plan' => ['Db/PayrollHostileTest'],
    'POST /api/payroll-plans/generate' => ['Db/PayrollHostileTest'],
    'POST /api/payroll-plans/review' => ['Db/PayrollHostileTest'],
    'POST /api/payroll-plans/approve' => ['Db/PayrollHostileTest'],
    'POST /api/payroll-plans/return' => ['Db/PayrollHostileTest'],
    'POST /api/payroll-plans/cancel' => ['Db/PayrollHostileTest'],
    'POST /api/payroll-plans/commit' => ['Db/PayrollHostileTest'],
    'GET /api/payroll-plan/drift' => ['Db/PayrollHostileTest'],
    'GET /api/supplemental-payrolls' => ['Db/SupplementalHostileTest'],
    'GET /api/supplemental-payroll' => ['Db/SupplementalHostileTest'],
    'GET /api/supplemental-payrolls/eligibility' => ['Db/SupplementalHostileTest'],
    'POST /api/supplemental-payrolls/generate' => ['Db/SupplementalHostileTest'],
    'POST /api/supplemental-payrolls/review' => ['Db/SupplementalHostileTest'],
    'POST /api/supplemental-payrolls/approve' => ['Db/SupplementalHostileTest'],
    'POST /api/supplemental-payrolls/return' => ['Db/SupplementalHostileTest'],
    'POST /api/supplemental-payrolls/cancel' => ['Db/SupplementalHostileTest'],
    'POST /api/supplemental-payrolls/commit' => ['Db/SupplementalHostileTest'],
    'GET /api/finance-postings' => ['Db/FinanceHostileTest'],
    'POST /api/finance-postings/payroll-plan' => ['Db/FinanceHostileTest'],
    'POST /api/finance-postings/supplemental-payroll' => ['Db/FinanceHostileTest'],
    'GET /api/finance-executions' => ['Db/FinanceHostileTest'],
    'POST /api/finance-executions/execute' => ['Db/FinanceHostileTest'],
    'GET /api/audit-events' => ['Db/AuditHostileTest', 'Db/HostileConfirmationsTest'],
    'GET /api/audit-events/record' => ['Db/AuditHostileTest', 'Db/HostileConfirmationsTest'],
];

return [
    'every production route has a frozen hostile-coverage entry, and the table names no route that does not exist' => static function () use ($coverage): void {
        $routes = [];
        foreach (productionRoutes(testConfig()) as $r) {
            $routes[] = $r->method . ' ' . $r->path;
        }
        sort($routes);
        $listed = array_keys($coverage);
        sort($listed);
        assertSame($listed, $routes, 'the coverage table equals the production route table');
        assertSame(54, count($routes), 'the E11 baseline counts 54 routes');
    },
    'the authentication classes match the E11 baseline: 6 public, 1 optional, 47 required' => static function (): void {
        $by = ['None' => [], 'Optional' => [], 'Required' => []];
        foreach (productionRoutes(testConfig()) as $r) {
            $by[$r->auth->name][] = $r->method . ' ' . $r->path;
        }
        sort($by['None']);
        assertSame(['GET /api/health', 'GET /api/ready', 'POST /api/auth/activate', 'POST /api/auth/forgot-password', 'POST /api/auth/login', 'POST /api/auth/reset-password'], $by['None']);
        assertSame(['POST /api/auth/logout'], $by['Optional']);
        assertSame(47, count($by['Required']));
    },
    'every listed suite exists and names the route it covers' => static function () use ($coverage): void {
        $root = dirname(__DIR__);
        foreach ($coverage as $route => $suites) {
            [, $path] = explode(' ', $route, 2);
            $parent = substr($path, 0, (int) strrpos($path, '/') + 1);
            $named = false;
            foreach ($suites as $suite) {
                $file = $root . '/' . $suite . '.php';
                assertTrue(is_file($file), $route . ': ' . $suite . ' exists');
                $src = (string) file_get_contents($file);
                $named = $named || str_contains($src, "'" . $path . "'") || str_contains($src, "'" . $path . '?') || ($parent !== '/api/' && str_contains($src, "'" . $parent . "'"));
            }
            assertTrue($named, $route . ': a listed suite names the route');
        }
    },
];
