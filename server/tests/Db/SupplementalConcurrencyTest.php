<?php
declare(strict_types=1);

/*
 * BF-4d Supplemental Payroll concurrency against the real, guarded MariaDB — deterministic, never
 * sleep-based, with the techniques of PayrollConcurrencyTest:
 *
 *   1. Lock proofs. A second connection holds an employee, a base plan or a document row in an
 *      open transaction while a Supplemental write runs with innodb_lock_wait_timeout = 1: the
 *      write must wait on that exact lock (1205 → 503) and must have written nothing.
 *   2. Race proofs. Worker processes are observed blocked on a row lock (bounded polling of
 *      PROCESSLIST) while the holder optionally commits a competing change; each worker must then
 *      act on the committed state. Where two workers race each other, the assertion holds for
 *      either order.
 *
 * Every Supplemental write locks in the global order employee → payroll_plan →
 * supplemental_payroll (primary keys only), the order base Payroll and the overtime approval use,
 * so no race can cycle: C1 generate against generate, C2 generate against an overtime approval,
 * C3 commit against return, C4 two stale transitions, C5 the duplicate commit and the
 * duplicate-key race, C6 the base Payroll generate against a Supplemental generate, C7 two
 * attempts to capture the same overtime (generate against cancel), C8 two waves opening a
 * document at once. A deadlock would surface as 503: none is accepted.
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
$approvedSql = "INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at, valuation_method, valuation_salary, valuation_standard_hours, approved_amount, approved_at) VALUES (?, ?, ?, '2026-10', NULL, '1.00', NULL, NULL, 'Approved', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'TAM-OT-1', '3500000.00', '160.00', '21875.00', UTC_TIMESTAMP(6))";
$late = static function (array $w, string $employee = 'e_1') use ($approvedSql): string {
    $id = bin2hex(random_bytes(16));
    $w['db']->execute($approvedSql, [$id, $w['a'], $employee]);
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
$gen = static fn (array $w, string $planId) => $post($w, '/api/supplemental-payrolls/generate', ['payrollPlanId' => $planId]);
$step = static fn (array $w, string $op, array $doc): Response => $post($w, '/api/supplemental-payrolls/' . $op, ['id' => $doc['id'], 'expectedVersion' => $doc['version']]);
$readyDoc = static function (array $w, string $planId) use ($gen, $step, $data): array {
    $d = $data($gen($w, $planId), 'generate')['supplementalPayroll'];
    $d = $data($step($w, 'review', $d), 'review')['supplementalPayroll'];
    return $data($step($w, 'approve', $d), 'approve')['supplementalPayroll'];
};
$commitBody = static fn (array $d, string $key): array => ['id' => $d['id'], 'expectedVersion' => $d['version'], 'expectedTotal' => $d['overtimeAmount'], 'idempotencyKey' => $key];
$state = static fn (Database $db): array => [
    (int) $db->select('SELECT COUNT(*) AS n FROM supplemental_payrolls')[0]['n'],
    (int) $db->select('SELECT COUNT(*) AS n FROM supplemental_payroll_overtime')[0]['n'],
    (int) $db->select("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'supplemental.manage'")[0]['n'],
];
$doc = static fn (Database $db, string $id): array => array_map(static fn ($v) => $v === null ? null : (string) $v, $db->select('SELECT status, version, overtime_amount, commit_idempotency_key FROM supplemental_payrolls WHERE id = ?', [$id])[0]);
$ops = static fn (Database $db, string $id): array => array_map(static fn (array $r): string => (string) $r['operation'], $db->select('SELECT operation FROM audit_events WHERE entity_id = ? ORDER BY id', [$id]));
/** The capture invariants: every overtime held at most once, never by both a base plan and a document; at most one open document per plan; a Cancelled document holds nothing. */
$invariants = static function (Database $db): void {
    assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM supplemental_payroll_overtime s JOIN payroll_plan_overtime p ON p.id = s.id')[0]['n'], 'no overtime in both a base plan and a document');
    assertSame(0, (int) $db->select("SELECT COUNT(*) AS n FROM (SELECT payroll_plan_id FROM supplemental_payrolls WHERE status IN ('Draft', 'Reviewed', 'Ready') GROUP BY payroll_plan_id HAVING COUNT(*) > 1) t")[0]['n'], 'at most one open document per base plan');
    assertSame(0, (int) $db->select("SELECT COUNT(*) AS n FROM supplemental_payroll_overtime l JOIN supplemental_payrolls s ON s.id = l.supplemental_payroll_id WHERE s.status = 'Cancelled'")[0]['n'], 'a Cancelled document holds nothing');
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
/** Starts workers once $hold($tx) has taken its locks, waits until all are blocked on $blockedOn, runs $meanwhile, commits; returns each worker's "<status> <code>", in start order. */
$raceHold = static function (array $w, array $jobs, Closure $hold, string $blockedOn, Closure $meanwhile): array {
    $workers = [];
    secondConnection()->transaction(static function (Database $tx) use ($w, $jobs, $hold, $blockedOn, $meanwhile, &$workers): void {
        $hold($tx);
        foreach ($jobs as [$op, $body]) {
            $cmd = [PHP_BINARY];
            if (php_ini_loaded_file() === false) {
                $cmd[] = '-n';
            }
            array_push($cmd, dirname(__DIR__) . '/Support/supplemental-worker.php', $w['s']['token'], $w['s']['csrf'], $op, json_encode($body, JSON_THROW_ON_ERROR));
            $proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, getenv());
            assertTrue(is_resource($proc), 'worker started');
            fclose($pipes[0]);
            $workers[] = [$proc, $pipes];
        }
        awaitBlockedStatements($tx, $blockedOn, count($jobs));
        $meanwhile($tx);
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
/** The holder locks e_1 (and $more) — every Supplemental write of e_1, and the Payroll generate, then waits on it. */
$holdEmployees = static fn (array $ids) => static function (Database $tx) use ($ids, $lockEmployee): void {
    foreach ($ids as $id) {
        assertTrue(count($tx->select($lockEmployee, [$id])) === 1, 'the holder locked ' . $id);
    }
};
// The Supplemental employee lock (SupplementalStore::LOCK_EMPLOYEE_SQL) and the Payroll generate one, as PROCESSLIST shows them.
$blockedOnSupplementalEmployee = 'SELECT id, company_id, id AS owner_employee_id FROM employees';
$blockedOnAnyEmployee = 'SELECT id, company_id, id AS owner_employee_id';

return [
    'lock proofs: generate waits on the employee lock and on the base plan lock (503, nothing written); an unrelated overtime row lock does not block it' => static function () use ($world, $committed, $late, $gen, $code, $data, $state, $whileLocked, $lockEmployee, $lockPlan): void {
        $w = $world();
        $p = $committed($w, 'e_1');
        $late($w);
        $before = $state($w['db']);
        assertSame([503, 'service_unavailable'], $code($whileLocked(secondConnection(), $lockEmployee, ['e_1'], $w['db'], static fn () => $gen($w, $p['id']))), 'employee lock');
        assertSame($before, $state($w['db']), 'nothing written');
        assertSame([503, 'service_unavailable'], $code($whileLocked(secondConnection(), $lockPlan, [$p['id']], $w['db'], static fn () => $gen($w, $p['id']))), 'base plan lock');
        assertSame($before, $state($w['db']), 'nothing written');
        $draft = bin2hex(random_bytes(16));
        $w['db']->execute("INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at) VALUES (?, ?, 'e_1', '2026-10', NULL, '1.00', NULL, NULL, 'Draft', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$draft, $w['a']]);
        $r = $whileLocked(secondConnection(), 'SELECT id FROM overtime_records WHERE id = ? FOR UPDATE', [$draft], $w['db'], static fn () => $gen($w, $p['id']));
        assertSame('Draft', $data($r, 'an overtime write in flight in the same month does not block generate')['supplementalPayroll']['status']);
    },
    'lock proofs: a transition and commit wait on the employee, the base plan and the document locks (503, nothing written)' => static function () use ($world, $committed, $late, $readyDoc, $step, $post, $commitBody, $code, $doc, $ops, $whileLocked, $lockEmployee, $lockPlan, $lockDoc): void {
        $w = $world();
        $p = $committed($w, 'e_1');
        $late($w);
        $d = $readyDoc($w, $p['id']);
        $snap = [$doc($w['db'], $d['id']), $ops($w['db'], $d['id'])];
        foreach ([[$lockEmployee, ['e_1']], [$lockPlan, [$p['id']]], [$lockDoc, [$d['id']]]] as [$sql, $params]) {
            assertSame([503, 'service_unavailable'], $code($whileLocked(secondConnection(), $sql, $params, $w['db'], static fn () => $step($w, 'return', $d))), 'return: ' . $sql);
            assertSame([503, 'service_unavailable'], $code($whileLocked(secondConnection(), $sql, $params, $w['db'], static fn () => $post($w, '/api/supplemental-payrolls/commit', $commitBody($d, bin2hex(random_bytes(16)))))), 'commit: ' . $sql);
            assertSame($snap, [$doc($w['db'], $d['id']), $ops($w['db'], $d['id'])], 'nothing written');
        }
    },
    'C1 race: two generates of one base plan both wait on the employee lock, then serialize — one document, one create row, each overtime captured once (M39, M40)' => static function () use ($world, $committed, $late, $raceHold, $holdEmployees, $blockedOnSupplementalEmployee, $state, $invariants): void {
        $w = $world();
        $p = $committed($w, 'e_1');
        $late($w);
        $late($w);
        $out = $raceHold($w, [['generate', ['payrollPlanId' => $p['id']]], ['generate', ['payrollPlanId' => $p['id']]]], $holdEmployees(['e_1']), $blockedOnSupplementalEmployee, static fn () => null);
        assertSame(['200 ok', '200 ok'], $out, 'no deadlock, no duplicate');
        assertSame([1, 2, 1], $state($w['db']), 'one document, two links, one create row — the second generate was a no-op');
        $invariants($w['db']);
    },
    'C2 race: an overtime approval committed while generate waits on its employee is captured; a real approval after the generate is never blocked and the next generate of the Draft includes it' => static function () use ($world, $committed, $raceHold, $holdEmployees, $blockedOnSupplementalEmployee, $approvedSql, $post, $gen, $data): void {
        $w = $world();
        $p = $committed($w, 'e_1');
        $o = bin2hex(random_bytes(16));
        // The holder plays the approval: it holds the employee lock (as OvertimeService::approve does) and approves meanwhile.
        $out = $raceHold($w, [['generate', ['payrollPlanId' => $p['id']]]], $holdEmployees(['e_1']), $blockedOnSupplementalEmployee,
            static fn (Database $tx) => $tx->execute($approvedSql, [$o, $w['a'], 'e_1']));
        assertSame(['200 ok'], $out, 'the approval serialized first');
        $d = $w['db']->select("SELECT id, overtime_amount FROM supplemental_payrolls WHERE payroll_plan_id = ?", [$p['id']])[0];
        assertSame(['21875.00', [$o]], [(string) $d['overtime_amount'], array_map(static fn (array $r): string => (string) $r['id'], $w['db']->select('SELECT id FROM supplemental_payroll_overtime WHERE supplemental_payroll_id = ?', [$d['id']]))]);
        $c = $data($post($w, '/api/overtime-records/create', ['employeeId' => 'e_1', 'monthKey' => '2026-10', 'hours' => '2.00']), 'create')['overtimeRecord'];
        $s = $data($post($w, '/api/overtime-records/submit', ['id' => $c['id'], 'expectedVersion' => $c['version']]), 'submit')['overtimeRecord'];
        $r = $data($post($w, '/api/overtime-records/review', ['id' => $s['id'], 'expectedVersion' => $s['version']]), 'review')['overtimeRecord'];
        $data($post($w, '/api/overtime-records/approve', ['id' => $r['id'], 'expectedVersion' => $r['version'], 'expectedAmount' => '43750.00']), 'Supplemental never blocks an overtime approval');
        assertSame('21875.00', (string) $w['db']->select('SELECT overtime_amount FROM supplemental_payrolls WHERE id = ?', [$d['id']])[0]['overtime_amount'], 'not in that calculation');
        assertSame('65625.00', $data($gen($w, $p['id']), 'regenerate')['supplementalPayroll']['overtimeAmount'], 'the next generate of the Draft includes it');
    },
    'C3 race: commit and return of one Ready document both wait on the employee lock; whichever runs first wins, the other is a deterministic 409 — never both, never a deadlock' => static function () use ($world, $committed, $late, $readyDoc, $commitBody, $raceHold, $holdEmployees, $blockedOnSupplementalEmployee, $doc, $ops, $invariants): void {
        $w = $world();
        $p = $committed($w, 'e_1');
        $late($w);
        $d = $readyDoc($w, $p['id']);
        $out = $raceHold($w, [['commit', $commitBody($d, bin2hex(random_bytes(16)))], ['return', ['id' => $d['id'], 'expectedVersion' => $d['version']]]], $holdEmployees(['e_1']), $blockedOnSupplementalEmployee, static fn () => null);
        $after = $doc($w['db'], $d['id']);
        if ($out === ['200 ok', '409 conflict']) {
            assertSame(['Committed', (string) ($d['version'] + 1)], [$after['status'], $after['version']], 'commit won');
            assertSame(['create', 'review', 'approve', 'commit'], $ops($w['db'], $d['id']));
        } else {
            assertSame(['409 conflict', '200 ok'], $out, 'exactly one winner');
            assertSame(['Draft', (string) ($d['version'] + 1), null], [$after['status'], $after['version'], $after['commit_idempotency_key']], 'return won; no key consumed');
            assertSame(['create', 'review', 'approve', 'return'], $ops($w['db'], $d['id']));
        }
        $invariants($w['db']);
    },
    'C4 race: two transitions of the same version — one wins, the stale one is 409 even where its transition would still exist; one version step, one row (M20)' => static function () use ($world, $committed, $late, $gen, $data, $raceHold, $holdEmployees, $blockedOnSupplementalEmployee, $doc, $ops): void {
        $w = $world();
        $p = $committed($w, 'e_1');
        $late($w);
        $d = $data($gen($w, $p['id']), 'generate')['supplementalPayroll'];
        $body = ['id' => $d['id'], 'expectedVersion' => $d['version']];
        $out = $raceHold($w, [['review', $body], ['review', $body]], $holdEmployees(['e_1']), $blockedOnSupplementalEmployee, static fn () => null);
        sort($out);
        assertSame(['200 ok', '409 conflict'], $out);
        assertSame(['Reviewed', '2'], array_slice(array_values($doc($w['db'], $d['id'])), 0, 2));
        assertSame(['create', 'review'], $ops($w['db'], $d['id']));
        // review and cancel of one version: cancel is a transition from Draft and from Reviewed, so
        // only the version guard refuses the loser — whichever runs second.
        $p2 = $committed($w, 'e_2');
        $late($w, 'e_2');
        $e = $data($gen($w, $p2['id']), 'generate')['supplementalPayroll'];
        $body = ['id' => $e['id'], 'expectedVersion' => $e['version']];
        $out = $raceHold($w, [['review', $body], ['cancel', $body]], $holdEmployees(['e_2']), $blockedOnSupplementalEmployee, static fn () => null);
        $after = $doc($w['db'], $e['id']);
        if ($out === ['200 ok', '409 conflict']) {
            assertSame(['Reviewed', '2', ['create', 'review']], [$after['status'], $after['version'], $ops($w['db'], $e['id'])], 'review won; the stale cancel changed nothing');
        } else {
            assertSame(['409 conflict', '200 ok'], $out, 'exactly one winner (M20)');
            assertSame(['Cancelled', '2', ['create', 'cancel']], [$after['status'], $after['version'], $ops($w['db'], $e['id'])], 'cancel won; the stale review changed nothing');
        }
    },
    'C5 race: the same commit twice is one commit and one replay; one key on two documents at once is one commit and one 409 — the key is held once (M23, M24, M25)' => static function () use ($world, $committed, $late, $readyDoc, $commitBody, $raceHold, $holdEmployees, $blockedOnSupplementalEmployee, $blockedOnAnyEmployee, $doc, $ops): void {
        $w = $world();
        $p1 = $committed($w, 'e_1');
        $late($w);
        $d = $readyDoc($w, $p1['id']);
        $key = bin2hex(random_bytes(16));
        $out = $raceHold($w, [['commit', $commitBody($d, $key)], ['commit', $commitBody($d, $key)]], $holdEmployees(['e_1']), $blockedOnSupplementalEmployee, static fn () => null);
        assertSame(['200 ok', '200 ok'], $out, 'one commit and its replay');
        assertSame(['Committed', $key], [$doc($w['db'], $d['id'])['status'], $doc($w['db'], $d['id'])['commit_idempotency_key']]);
        assertSame(1, count(array_filter($ops($w['db'], $d['id']), static fn (string $o): bool => $o === 'commit')), 'one commit row (M24)');
        $p2 = $committed($w, 'e_2');
        $late($w, 'e_2');
        $late($w, 'e_1');
        $e1 = $readyDoc($w, $p1['id']);
        $e2 = $readyDoc($w, $p2['id']);
        $shared = bin2hex(random_bytes(16));
        $out = $raceHold($w, [['commit', $commitBody($e1, $shared)], ['commit', $commitBody($e2, $shared)]], $holdEmployees(['e_1', 'e_2']), $blockedOnAnyEmployee, static fn () => null);
        sort($out);
        assertSame(['200 ok', '409 conflict'], $out, 'one key, two documents: one commit (M25)');
        assertSame(1, (int) $w['db']->select('SELECT COUNT(*) AS n FROM supplemental_payrolls WHERE commit_idempotency_key = ?', [$shared])[0]['n'], 'the key is held once');
        $statuses = [$doc($w['db'], $e1['id'])['status'], $doc($w['db'], $e2['id'])['status']];
        sort($statuses);
        assertSame(['Committed', 'Ready'], $statuses, 'the loser is still Ready, its key not consumed');
    },
    'C6 race: the base Payroll generate and a Supplemental generate of the same employee and month serialize on the employee lock; the base plan stays as committed, late overtime goes only to the document, a Draft base plan keeps its own (M5, M8)' => static function () use ($world, $committed, $late, $raceHold, $holdEmployees, $blockedOnAnyEmployee, $invariants): void {
        $w = $world();
        $p = $committed($w, 'e_1');
        $baseBefore = [$w['db']->select('SELECT * FROM payroll_plans WHERE id = ?', [$p['id']]), $w['db']->select('SELECT * FROM payroll_plan_overtime WHERE payroll_plan_id = ? ORDER BY id', [$p['id']])];
        $o1 = $late($w, 'e_1');
        $o2 = $late($w, 'e_2');
        $out = $raceHold($w, [['payroll-generate', ['month' => '2026-10']], ['generate', ['payrollPlanId' => $p['id']]]], $holdEmployees(['e_1']), $blockedOnAnyEmployee, static fn () => null);
        assertSame(['200 ok', '200 ok'], $out, 'both complete — no deadlock');
        assertSame($baseBefore, [$w['db']->select('SELECT * FROM payroll_plans WHERE id = ?', [$p['id']]), $w['db']->select('SELECT * FROM payroll_plan_overtime WHERE payroll_plan_id = ? ORDER BY id', [$p['id']])], 'the Committed base plan and its links are untouched');
        assertSame([$o1], array_map(static fn (array $r): string => (string) $r['id'], $w['db']->select('SELECT id FROM supplemental_payroll_overtime')), 'the late overtime of the committed employee is captured by the document only');
        assertSame(1, (int) $w['db']->select("SELECT COUNT(*) AS n FROM payroll_plan_overtime l JOIN payroll_plans p ON p.id = l.payroll_plan_id WHERE l.id = ? AND p.employee_id = 'e_2' AND p.status = 'Draft'", [$o2])[0]['n'], "a Draft base plan's overtime stays the Payroll drift path");
        $invariants($w['db']);
    },
    'C7 race: generate and cancel of the open Draft — in either order each overtime is captured at most once and a Cancelled document holds nothing (M15, M16, M39)' => static function () use ($world, $committed, $late, $gen, $data, $raceHold, $holdEmployees, $blockedOnSupplementalEmployee, $doc, $invariants): void {
        $w = $world();
        $p = $committed($w, 'e_1');
        $o = $late($w);
        $d = $data($gen($w, $p['id']), 'generate')['supplementalPayroll'];
        $out = $raceHold($w, [['generate', ['payrollPlanId' => $p['id']]], ['cancel', ['id' => $d['id'], 'expectedVersion' => $d['version']]]], $holdEmployees(['e_1']), $blockedOnSupplementalEmployee, static fn () => null);
        assertSame(['200 ok', '200 ok'], $out, 'both complete in either order');
        assertSame('Cancelled', $doc($w['db'], $d['id'])['status']);
        $holders = array_map(static fn (array $r): string => (string) $r['supplemental_payroll_id'], $w['db']->select('SELECT supplemental_payroll_id FROM supplemental_payroll_overtime WHERE id = ?', [$o]));
        assertTrue(count($holders) <= 1 && !in_array($d['id'], $holders, true), 'captured at most once, never by the Cancelled document');
        $invariants($w['db']);
    },
    'C8 race: two generates opening the next wave beside a Committed document — one new Draft, one create row; the open key holds (M12, M40)' => static function () use ($world, $committed, $late, $readyDoc, $commitBody, $post, $data, $raceHold, $holdEmployees, $blockedOnSupplementalEmployee, $invariants): void {
        $w = $world();
        $p = $committed($w, 'e_1');
        $late($w);
        $first = $readyDoc($w, $p['id']);
        $data($post($w, '/api/supplemental-payrolls/commit', $commitBody($first, bin2hex(random_bytes(16)))), 'commit wave 1');
        $late($w);
        $out = $raceHold($w, [['generate', ['payrollPlanId' => $p['id']]], ['generate', ['payrollPlanId' => $p['id']]]], $holdEmployees(['e_1']), $blockedOnSupplementalEmployee, static fn () => null);
        assertSame(['200 ok', '200 ok'], $out);
        $docs = $w['db']->select('SELECT id, status FROM supplemental_payrolls WHERE payroll_plan_id = ? ORDER BY created_at, id', [$p['id']]);
        assertSame(['Committed', 'Draft'], array_map(static fn (array $r): string => (string) $r['status'], $docs), 'one Committed wave and one new Draft');
        assertSame(1, (int) $w['db']->select("SELECT COUNT(*) AS n FROM audit_events WHERE entity_id = ? AND operation = 'create'", [$docs[1]['id']])[0]['n'], 'one create row');
        $invariants($w['db']);
    },
];
