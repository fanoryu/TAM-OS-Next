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
    // Phase 1 authorized revision: the four general transaction and report routes. Was: through the audit reads.
    'GET /api/general-transactions' => ['Db/TransactionHostileTest'],
    'POST /api/general-transactions/create' => ['Db/TransactionHostileTest'],
    'POST /api/general-transactions/void' => ['Db/TransactionHostileTest'],
    'GET /api/reports/financial' => ['Db/TransactionHostileTest'],
    // ADR-016 (AWP-01) authorized revision: the nine finance request routes. Was: through the report read.
    'GET /api/finance-requests' => ['Db/RequestWorkflowTest'],
    'GET /api/finance-request' => ['Db/RequestWorkflowTest'],
    'POST /api/finance-requests/create' => ['Db/RequestWorkflowTest'],
    'POST /api/finance-requests/update' => ['Db/RequestWorkflowTest'],
    'POST /api/finance-requests/submit' => ['Db/RequestWorkflowTest'],
    'POST /api/finance-requests/approve' => ['Db/RequestWorkflowTest'],
    'POST /api/finance-requests/reject' => ['Db/RequestWorkflowTest'],
    'POST /api/finance-requests/cancel' => ['Db/RequestWorkflowTest'],
    'POST /api/finance-requests/pay' => ['Db/RequestWorkflowTest'],
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
        // Phase 1 authorized revision: 58 (the four general transaction and report routes). Was: 54.
        // ADR-016 (AWP-01) authorized revision: 67 (the nine finance request routes). Was: 58.
        assertSame(67, count($routes), 'the E11 baseline counts 67 routes (Phase 2)');
    },
    // Phase 1 authorized revision: 51 required (the four general transaction and report routes). Was: 47.
    'the authentication classes match the E11 baseline: 6 public, 1 optional, 51 required' => static function (): void {
        $by = ['None' => [], 'Optional' => [], 'Required' => []];
        foreach (productionRoutes(testConfig()) as $r) {
            $by[$r->auth->name][] = $r->method . ' ' . $r->path;
        }
        sort($by['None']);
        assertSame(['GET /api/health', 'GET /api/ready', 'POST /api/auth/activate', 'POST /api/auth/forgot-password', 'POST /api/auth/login', 'POST /api/auth/reset-password'], $by['None']);
        assertSame(['POST /api/auth/logout'], $by['Optional']);
        // ADR-016 (AWP-01) authorized revision: 60 required (the nine finance request routes). Was: 51.
        assertSame(60, count($by['Required']));
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
