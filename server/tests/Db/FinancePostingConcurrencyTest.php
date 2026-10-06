<?php
declare(strict_types=1);

/*
 * BF-4e Finance posting concurrency against the real, guarded MariaDB — deterministic, never
 * sleep-based, with the techniques of SupplementalConcurrencyTest:
 *
 *   1. Lock proofs. A second connection holds an employee, a base plan or a Supplemental document
 *      row in an open transaction while a posting runs with innodb_lock_wait_timeout = 1: the
 *      posting must wait on that exact lock (1205 → 503) and must have written nothing.
 *   2. Race proofs. Worker processes are observed blocked on a row lock (bounded polling of
 *      PROCESSLIST) while the holder keeps it; each worker must then act on the committed state.
 *      Where two workers race each other, the assertion holds for either order.
 *
 * A posting locks in the global order employee → payroll_plan → supplemental_payroll (primary keys
 * only, a subset of the order every Payroll and Supplemental write uses), so no race can cycle:
 * F1 the same posting twice (one posting and its replay), F2 one source under two keys (one
 * posting, one 409), F3 one key on two sources at once (one posting, one 409 — the database's
 * per-company key decides), F4 a base plan posting against the Payroll generate of its month, F5 a
 * Supplemental posting against the Supplemental commit of the next wave of the same plan, F6 a base
 * plan posting and the posting of its own Supplemental document at once. A deadlock would surface as
 * 503: none is accepted.
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
use TamOs\Http\Response;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\authKernel;
use function TamOs\Tests\awaitBlockedStatements;
use function TamOs\Tests\employeeAnchor;
use function TamOs\Tests\envelope;
use function TamOs\Tests\loginRequest;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\requestId;
use function TamOs\Tests\secondConnection;
use function TamOs\Tests\sessionCookieToken;
use function TamOs\Tests\sessionRequest;
use function TamOs\Tests\testDbConfig;

/** @return array{db: Database, k: Kernel, a: string, s: array{token: string, csrf: string}} */
$world = static function (): array {
    $db = authDatabase();
    $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
    $ceo = authFixture($db);
    employeeAnchor($db, $ceo['companyId'], 'e_1');
    employeeAnchor($db, $ceo['companyId'], 'e_2');
    $db->execute("UPDATE employees SET monthly_base_salary = '3500000.00' WHERE id IN ('e_1', 'e_2')");
    $r = $k->handle(loginRequest($ceo['email'], (string) $ceo['password']), requestId());
    return ['db' => $db, 'k' => $k, 'a' => $ceo['companyId'], 's' => ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken']]];
};
$post = static fn (array $w, string $path, array $body): Response
    => $w['k']->handle(sessionRequest('POST', $path, $w['s']['token'], $w['s']['csrf'], json_encode($body, JSON_THROW_ON_ERROR)), requestId());
$code = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
$data = static function (Response $r, string $label): array {
    assertSame(200, $r->status, $label . ' ' . substr($r->body, 0, 200));
    return envelope($r)['data'];
};
/** Test-only SQL: an Approved overtime record of $employee in 2026-10 with a frozen amount — "approved now". */
$late = static function (array $w, string $employee = 'e_1'): string {
    $id = bin2hex(random_bytes(16));
    $w['db']->execute("INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at, valuation_method, valuation_salary, valuation_standard_hours, approved_amount, approved_at) VALUES (?, ?, ?, '2026-10', NULL, '1.00', NULL, NULL, 'Approved', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'TAM-OT-1', '3500000.00', '160.00', '21875.00', UTC_TIMESTAMP(6))", [$id, $w['a'], $employee]);
    return $id;
};
/** $employee's 2026-10 base plan, generated, approved and committed through the Payroll routes. */
$committed = static function (array $w, string $employee) use ($post, $data): array {
    $plans = [];
    foreach ($data($post($w, '/api/payroll-plans/generate', ['month' => '2026-10']), 'payroll generate')['payrollPlans'] as $p) {
        $plans[$p['employeeId']] = $p;
    }
    $p = $data($post($w, '/api/payroll-plans/approve', ['id' => $plans[$employee]['id'], 'expectedVersion' => $plans[$employee]['version']]), 'payroll approve')['payrollPlan'];
    return $data($post($w, '/api/payroll-plans/commit', ['id' => $p['id'], 'expectedVersion' => $p['version'], 'expectedTotal' => $p['totalAmount'], 'idempotencyKey' => bin2hex(random_bytes(16))]), 'payroll commit')['payrollPlan'];
};
/** A Ready Supplemental document of $planId's late overtime. */
$readyDoc = static function (array $w, string $planId) use ($post, $data): array {
    $d = $data($post($w, '/api/supplemental-payrolls/generate', ['payrollPlanId' => $planId]), 'generate')['supplementalPayroll'];
    foreach (['review', 'approve'] as $op) {
        $d = $data($post($w, '/api/supplemental-payrolls/' . $op, ['id' => $d['id'], 'expectedVersion' => $d['version']]), $op)['supplementalPayroll'];
    }
    return $d;
};
$suppCommitBody = static fn (array $d): array => ['id' => $d['id'], 'expectedVersion' => $d['version'], 'expectedTotal' => $d['overtimeAmount'], 'idempotencyKey' => bin2hex(random_bytes(16))];
$committedDoc = static fn (array $w, string $planId): array => $data($post($w, '/api/supplemental-payrolls/commit', $suppCommitBody($readyDoc($w, $planId))), 'supplemental commit')['supplementalPayroll'];
$planBody = static fn (array $p, string $key): array => ['payrollPlanId' => $p['id'], 'expectedAmount' => $p['totalAmount'], 'idempotencyKey' => $key];
$docBody = static fn (array $d, string $key): array => ['supplementalPayrollId' => $d['id'], 'expectedAmount' => $d['overtimeAmount'], 'idempotencyKey' => $key];
$state = static fn (Database $db): array => [
    (int) $db->select('SELECT COUNT(*) AS n FROM finance_postings')[0]['n'],
    (int) $db->select("SELECT COUNT(*) AS n FROM audit_events WHERE operation = 'post'")[0]['n'],
];
/** The posting invariants: at most one posting per source, each key once, one post audit row per posting, every posting Planned at its source's amount. */
$invariants = static function (Database $db): void {
    assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM (SELECT payroll_plan_id FROM finance_postings WHERE payroll_plan_id IS NOT NULL GROUP BY payroll_plan_id HAVING COUNT(*) > 1) t')[0]['n'], 'at most one posting per plan');
    assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM (SELECT supplemental_payroll_id FROM finance_postings WHERE supplemental_payroll_id IS NOT NULL GROUP BY supplemental_payroll_id HAVING COUNT(*) > 1) t')[0]['n'], 'at most one posting per document');
    assertSame((int) $db->select('SELECT COUNT(*) AS n FROM finance_postings')[0]['n'], (int) $db->select("SELECT COUNT(*) AS n FROM audit_events WHERE operation = 'post'")[0]['n'], 'one post audit row per posting');
    assertSame(0, (int) $db->select("SELECT COUNT(*) AS n FROM finance_postings f LEFT JOIN payroll_plans p ON p.company_id = f.company_id AND p.id = f.payroll_plan_id LEFT JOIN supplemental_payrolls s ON s.company_id = f.company_id AND s.id = f.supplemental_payroll_id WHERE f.status <> 'Planned' OR f.amount <> COALESCE(p.total_amount, s.overtime_amount) OR COALESCE(p.status, s.status) <> 'Committed'")[0]['n'], 'every posting is Planned at its Committed source amount');
};
/** Runs $fn while $holder keeps $lockSql's row locked in an open transaction; $db waits at most 1 s. */
$whileLocked = static function (Database $holder, string $lockSql, array $params, Database $db, Closure $fn): mixed {
    $db->execute('SET SESSION innodb_lock_wait_timeout = 1');
    try {
        return $holder->transaction(static function (Database $tx) use ($lockSql, $params, $fn): mixed {
            assertTrue(count($tx->select($lockSql, $params)) === 1, 'the holder locked the row');
            return $fn();
        });
    } finally {
        $db->execute('SET SESSION innodb_lock_wait_timeout = 50');
    }
};
/** Starts workers once $hold($tx) has taken its locks, waits until all are blocked on $blockedOn, commits; returns each worker's "<status> <code>", in start order. */
$raceHold = static function (array $w, array $jobs, Closure $hold, string $blockedOn): array {
    $workers = [];
    secondConnection()->transaction(static function (Database $tx) use ($w, $jobs, $hold, $blockedOn, &$workers): void {
        $hold($tx);
        foreach ($jobs as [$op, $body]) {
            $cmd = [PHP_BINARY];
            if (php_ini_loaded_file() === false) {
                $cmd[] = '-n';
            }
            array_push($cmd, dirname(__DIR__) . '/Support/finance-worker.php', $w['s']['token'], $w['s']['csrf'], $op, json_encode($body, JSON_THROW_ON_ERROR));
            $proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, getenv());
            assertTrue(is_resource($proc), 'worker started');
            fclose($pipes[0]);
            $workers[] = [$proc, $pipes];
        }
        awaitBlockedStatements($tx, $blockedOn, count($jobs));
    });
    $out = [];
    foreach ($workers as [$proc, $pipes]) {
        $stdout = (string) stream_get_contents($pipes[1]);
        $stderr = (string) stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        assertSame(0, proc_close($proc), 'worker exit: ' . $stderr);
        $out[] = trim($stdout);
    }
    return $out;
};
$lockEmployee = 'SELECT id FROM employees WHERE id = ? FOR UPDATE';
$lockPlan = 'SELECT id FROM payroll_plans WHERE id = ? FOR UPDATE';
$lockDoc = 'SELECT id FROM supplemental_payrolls WHERE id = ? FOR UPDATE';
$holdEmployees = static fn (array $ids) => static function (Database $tx) use ($ids, $lockEmployee): void {
    foreach ($ids as $id) {
        assertTrue(count($tx->select($lockEmployee, [$id])) === 1, 'the holder locked ' . $id);
    }
};
// The employee lock every posting, Supplemental and Payroll write takes first, as PROCESSLIST shows it.
$blockedOnEmployee = 'SELECT id, company_id, id AS owner_employee_id';

return [
    'lock proofs: a base plan posting waits on the employee and the plan locks, a Supplemental posting on the employee and the document locks (503, nothing written); another employee lock does not block it' => static function () use ($world, $committed, $late, $committedDoc, $post, $planBody, $docBody, $code, $data, $state, $whileLocked, $lockEmployee, $lockPlan, $lockDoc): void {
        $w = $world();
        $p = $committed($w, 'e_1');
        $late($w);
        $d = $committedDoc($w, $p['id']);
        $before = $state($w['db']);
        foreach ([[$lockEmployee, ['e_1']], [$lockPlan, [$p['id']]]] as [$sql, $params]) {
            assertSame([503, 'service_unavailable'], $code($whileLocked(secondConnection(), $sql, $params, $w['db'], static fn () => $post($w, '/api/finance-postings/payroll-plan', $planBody($p, bin2hex(random_bytes(16)))))), 'base plan: ' . $sql);
            assertSame($before, $state($w['db']), 'nothing written');
        }
        foreach ([[$lockEmployee, ['e_1']], [$lockDoc, [$d['id']]]] as [$sql, $params]) {
            assertSame([503, 'service_unavailable'], $code($whileLocked(secondConnection(), $sql, $params, $w['db'], static fn () => $post($w, '/api/finance-postings/supplemental-payroll', $docBody($d, bin2hex(random_bytes(16)))))), 'Supplemental: ' . $sql);
            assertSame($before, $state($w['db']), 'nothing written');
        }
        $r = $whileLocked(secondConnection(), $lockEmployee, ['e_2'], $w['db'], static fn () => $post($w, '/api/finance-postings/payroll-plan', $planBody($p, bin2hex(random_bytes(16)))));
        assertSame('Planned', $data($r, 'another employee in flight does not block the posting')['financePosting']['status']);
    },
    'F1 race: the same posting twice both wait on the employee lock — one posting and its replay; one post audit row' => static function () use ($world, $committed, $planBody, $raceHold, $holdEmployees, $blockedOnEmployee, $state, $invariants): void {
        $w = $world();
        $p = $committed($w, 'e_1');
        $key = bin2hex(random_bytes(16));
        $out = $raceHold($w, [['post-plan', $planBody($p, $key)], ['post-plan', $planBody($p, $key)]], $holdEmployees(['e_1']), $blockedOnEmployee);
        assertSame(['200 ok', '200 ok'], $out, 'one posting and its replay — no deadlock');
        assertSame([1, 1], $state($w['db']), 'one posting, one post row');
        assertSame($key, (string) $w['db']->select('SELECT idempotency_key FROM finance_postings')[0]['idempotency_key']);
        $invariants($w['db']);
    },
    'F2 race: one source under two keys at once — exactly one posting, the other 409; the loser stores no key' => static function () use ($world, $committed, $late, $committedDoc, $planBody, $docBody, $raceHold, $holdEmployees, $blockedOnEmployee, $state, $invariants): void {
        $w = $world();
        $p = $committed($w, 'e_1');
        $k1 = bin2hex(random_bytes(16));
        $k2 = bin2hex(random_bytes(16));
        $out = $raceHold($w, [['post-plan', $planBody($p, $k1)], ['post-plan', $planBody($p, $k2)]], $holdEmployees(['e_1']), $blockedOnEmployee);
        sort($out);
        assertSame(['200 ok', '409 conflict'], $out, 'exactly one posting of the plan');
        assertSame([1, 1], $state($w['db']));
        $late($w);
        $d = $committedDoc($w, $p['id']);
        $out = $raceHold($w, [['post-supplemental', $docBody($d, bin2hex(random_bytes(16)))], ['post-supplemental', $docBody($d, bin2hex(random_bytes(16)))]], $holdEmployees(['e_1']), $blockedOnEmployee);
        sort($out);
        assertSame(['200 ok', '409 conflict'], $out, 'exactly one posting of the document');
        assertSame([2, 2], $state($w['db']));
        $invariants($w['db']);
    },
    'F3 race: one key on two sources at once — one posting, one 409; the key is held once and the loser can post with its own key' => static function () use ($world, $committed, $post, $planBody, $data, $raceHold, $holdEmployees, $blockedOnEmployee, $state, $invariants): void {
        $w = $world();
        $p1 = $committed($w, 'e_1');
        $p2 = $committed($w, 'e_2');
        $shared = bin2hex(random_bytes(16));
        $out = $raceHold($w, [['post-plan', $planBody($p1, $shared)], ['post-plan', $planBody($p2, $shared)]], $holdEmployees(['e_1', 'e_2']), $blockedOnEmployee);
        sort($out);
        assertSame(['200 ok', '409 conflict'], $out, 'one key, two plans: one posting');
        assertSame([1, 1], $state($w['db']));
        $winner = (string) $w['db']->select('SELECT payroll_plan_id FROM finance_postings WHERE idempotency_key = ?', [$shared])[0]['payroll_plan_id'];
        $loser = $winner === $p1['id'] ? $p2 : $p1;
        assertSame('Planned', $data($post($w, '/api/finance-postings/payroll-plan', $planBody($loser, bin2hex(random_bytes(16)))), 'the loser with its own key')['financePosting']['status']);
        $invariants($w['db']);
    },
    'F4 race: a base plan posting and the Payroll generate of its month serialize on the employee lock — both complete, the Committed plan is untouched, one posting' => static function () use ($world, $committed, $late, $planBody, $raceHold, $holdEmployees, $blockedOnEmployee, $state, $invariants): void {
        $w = $world();
        $p = $committed($w, 'e_1');
        $late($w);
        $before = [$w['db']->select('SELECT * FROM payroll_plans WHERE id = ?', [$p['id']]), $w['db']->select('SELECT * FROM payroll_plan_overtime WHERE payroll_plan_id = ? ORDER BY id', [$p['id']])];
        $out = $raceHold($w, [['payroll-generate', ['month' => '2026-10']], ['post-plan', $planBody($p, bin2hex(random_bytes(16)))]], $holdEmployees(['e_1', 'e_2']), $blockedOnEmployee);
        assertSame(['200 ok', '200 ok'], $out, 'both complete — no deadlock');
        assertSame($before, [$w['db']->select('SELECT * FROM payroll_plans WHERE id = ?', [$p['id']]), $w['db']->select('SELECT * FROM payroll_plan_overtime WHERE payroll_plan_id = ? ORDER BY id', [$p['id']])], 'the Committed plan and its links are untouched');
        assertSame([1, 1], $state($w['db']));
        $invariants($w['db']);
    },
    'F5 race: a Supplemental posting and the Supplemental commit of the next wave of the same plan serialize on the employee lock — both complete, no deadlock' => static function () use ($world, $committed, $late, $committedDoc, $readyDoc, $docBody, $suppCommitBody, $raceHold, $holdEmployees, $blockedOnEmployee, $state, $invariants): void {
        $w = $world();
        $p = $committed($w, 'e_1');
        $late($w);
        $first = $committedDoc($w, $p['id']);
        $late($w);
        $second = $readyDoc($w, $p['id']);
        $out = $raceHold($w, [['supplemental-commit', $suppCommitBody($second)], ['post-supplemental', $docBody($first, bin2hex(random_bytes(16)))]], $holdEmployees(['e_1']), $blockedOnEmployee);
        assertSame(['200 ok', '200 ok'], $out, 'both complete in either order');
        assertSame('Committed', (string) $w['db']->select('SELECT status FROM supplemental_payrolls WHERE id = ?', [$second['id']])[0]['status']);
        assertSame([1, 1], $state($w['db']), 'the first wave posted; the second is Committed and not posted');
        $invariants($w['db']);
    },
    'F6 race: a base plan posting and the posting of its own Supplemental document at once — two separate postings, never combined' => static function () use ($world, $committed, $late, $committedDoc, $planBody, $docBody, $raceHold, $holdEmployees, $blockedOnEmployee, $state, $invariants): void {
        $w = $world();
        $p = $committed($w, 'e_1');
        $late($w);
        $d = $committedDoc($w, $p['id']);
        $out = $raceHold($w, [['post-plan', $planBody($p, bin2hex(random_bytes(16)))], ['post-supplemental', $docBody($d, bin2hex(random_bytes(16)))]], $holdEmployees(['e_1']), $blockedOnEmployee);
        assertSame(['200 ok', '200 ok'], $out);
        $rows = $w['db']->select('SELECT source_kind, amount FROM finance_postings ORDER BY source_kind');
        assertSame([['payrollPlan', '3500000.00'], ['supplementalPayroll', '21875.00']], array_map(static fn (array $r): array => [(string) $r['source_kind'], (string) $r['amount']], $rows), 'one posting per source, each at its own amount');
        assertSame([2, 2], $state($w['db']));
        $invariants($w['db']);
    },
];
