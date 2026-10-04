<?php
declare(strict_types=1);

/*
 * BF-4c1 payroll concurrency against the real, guarded MariaDB — deterministic, never sleep-based,
 * with the three techniques of OvertimeConcurrencyTest:
 *
 *   1. Lock proofs. A second connection holds an employee, an Approved overtime or a plan row in
 *      an open transaction while a payroll write runs with innodb_lock_wait_timeout = 1: the write
 *      must wait on that exact lock (1205 → 503) and must have written nothing.
 *   2. Loser proofs. Two writes of the same version, one after the other: the first wins, the
 *      second is a deterministic 409 and changes nothing.
 *   3. Race proofs. A worker process is observed blocked on a row lock (bounded polling of
 *      PROCESSLIST) while the competing change commits; the worker must then act on the committed
 *      state.
 *
 * Generate locks in the global order employee → overtime → payroll_plan → payroll_plan_overtime →
 * audit. An overtime approval locks its employee before its record, so an approval and a generate
 * serialize on the employee lock: an approval committed first is included, one committed after the
 * generate is not — and the approval is never blocked by payroll. Every race completes: no deadlock.
 *
 * BF-4c2 Commit (D-BF4c2-3 = A: READ COMMITTED, the same global order) locks the plan's employee by
 * primary key, then the plan, then reads the key, the eligibility, the salary, the Approved set and
 * the links under those locks. C1–C8: commit against commit (the same key: one commit and one
 * replay; different keys: one commit and one 409), a salary change, an archive or status change, an
 * overtime approval, a return, a cancel and a generate — each in both orders where both exist — plus
 * the duplicate-key race of one key on two plans. A deadlock would surface as 503: none is accepted.
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

/** @return array{db: Database, k: Kernel, a: string, s: array<string, array{token: string, csrf: string}>} */
$world = static function (): array {
    $db = authDatabase();
    $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
    $ceo = authFixture($db);
    employeeAnchor($db, $ceo['companyId'], 'e_1');
    employeeAnchor($db, $ceo['companyId'], 'e_2');
    $db->execute("UPDATE employees SET monthly_base_salary = '3500000.00' WHERE id IN ('e_1', 'e_2')");
    $r = $k->handle(loginRequest($ceo['email'], (string) $ceo['password']), requestId());
    return ['db' => $db, 'k' => $k, 'a' => $ceo['companyId'], 's' => ['ceo' => ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken']]]];
};
$post = static fn (array $w, string $path, array $body): Response
    => $w['k']->handle(sessionRequest('POST', $path, $w['s']['ceo']['token'], $w['s']['ceo']['csrf'], json_encode($body, JSON_THROW_ON_ERROR)), requestId());
$code = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
$generate = static function (array $w) use ($post): array {
    $r = $post($w, '/api/payroll-plans/generate', ['month' => '2026-10']);
    assertSame(200, $r->status, 'generate ' . substr($r->body, 0, 200));
    $out = [];
    foreach (envelope($r)['data']['payrollPlans'] as $p) {
        $out[$p['employeeId']] = $p;
    }
    return $out;
};
$step = static fn (array $w, string $op, array $plan): Response => $post($w, '/api/payroll-plans/' . $op, ['id' => $plan['id'], 'expectedVersion' => $plan['version']]);
/** Test-only SQL: an Approved overtime record of e_1 in 2026-10 with a frozen amount, on $db. */
$approvedSql = "INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at, valuation_method, valuation_salary, valuation_standard_hours, approved_amount, approved_at) VALUES (?, ?, 'e_1', '2026-10', NULL, '1.00', NULL, NULL, 'Approved', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'TAM-OT-1', '3500000.00', '160.00', '21875.00', UTC_TIMESTAMP(6))";
$state = static fn (Database $db): array => [
    (int) $db->select('SELECT COUNT(*) AS n FROM payroll_plans')[0]['n'],
    (int) $db->select('SELECT COUNT(*) AS n FROM payroll_plan_overtime')[0]['n'],
    (int) $db->select("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'payroll.manage'")[0]['n'],
];
$plan = static fn (Database $db, string $id): array => array_map(static fn ($v) => $v === null ? null : (string) $v, $db->select('SELECT status, version, base_salary, overtime_amount, total_amount FROM payroll_plans WHERE id = ?', [$id])[0]);
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
/**
 * Starts payroll workers once $hold($tx) has taken its locks (and made any write) in the holder
 * transaction, waits until all are blocked on $blockedOn, runs $meanwhile, commits; returns each
 * worker's "<status> <code>".
 */
$raceHold = static function (array $w, array $jobs, Closure $hold, string $blockedOn, Closure $meanwhile): array {
    $workers = [];
    secondConnection()->transaction(static function (Database $tx) use ($w, $jobs, $hold, $blockedOn, $meanwhile, &$workers): void {
        $hold($tx);
        foreach ($jobs as [$op, $body]) {
            $cmd = [PHP_BINARY];
            if (php_ini_loaded_file() === false) {
                $cmd[] = '-n';
            }
            array_push($cmd, dirname(__DIR__) . '/Support/payroll-worker.php', $w['s']['ceo']['token'], $w['s']['ceo']['csrf'], $op, json_encode($body, JSON_THROW_ON_ERROR));
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
/** Starts payroll workers, waits until all are blocked on $blockedOn while $holder holds the lock, runs $meanwhile, commits; returns each worker's "<status> <code>". */
$race = static fn (array $w, array $jobs, string $lockSql, array $lockParams, string $blockedOn, Closure $meanwhile): array
    => $raceHold($w, $jobs, static fn (Database $tx) => assertTrue(count($tx->select($lockSql, $lockParams)) === 1, 'the holder locked the row'), $blockedOn, $meanwhile);
$lockEmployee = 'SELECT id FROM employees WHERE id = ? FOR UPDATE';
$blockedOnEmployees = 'SELECT id, company_id, id AS owner_employee_id, employee_code, full_name';
$lockPlan = 'SELECT id FROM payroll_plans WHERE id = ? FOR UPDATE';
$blockedOnPlans = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, status, employee_code_snapshot';
$blockedOnPlanLock = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, status, version FROM payroll_plans';
// BF-4c2: Commit's plan lock and its compare-and-swap.
$blockedOnCommitLock = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, status, base_salary';
$blockedOnCommitWrite = "UPDATE payroll_plans SET status = 'Committed'";
/** $employee's 2026-10 plan, generated and approved to Ready. */
$readyPlan = static function (array $w, string $employee) use ($generate, $step): array {
    $r = $step($w, 'approve', $generate($w)[$employee]);
    assertSame(200, $r->status, 'approve');
    return envelope($r)['data']['payrollPlan'];
};
$commitBody = static fn (array $p, string $key): array => ['id' => $p['id'], 'expectedVersion' => $p['version'], 'expectedTotal' => $p['totalAmount'], 'idempotencyKey' => $key];
$commits = static fn (Database $db, string $plan): int => (int) $db->select("SELECT COUNT(*) AS n FROM audit_events WHERE entity_id = ? AND operation = 'commit'", [$plan])[0]['n'];
$full = static fn (Database $db, string $id): array => array_map(static fn ($v) => $v === null ? null : (string) $v, $db->select('SELECT * FROM payroll_plans WHERE id = ?', [$id])[0]);
/** Test-only SQL a holder runs: the plan committed with $key inside its open transaction. */
$holderCommitSql = "UPDATE payroll_plans SET status = 'Committed', committed_at = UTC_TIMESTAMP(6), commit_idempotency_key = ?, version = version + 1 WHERE id = ? AND status = 'Ready'";

return [
    'generate waits on an employee row lock and a live plan row lock: while either is held, nothing is written (503); it takes no overtime lock' => static function () use ($world, $post, $code, $state, $whileLocked, $lockEmployee, $lockPlan, $approvedSql, $generate): void {
        $w = $world();
        $o = bin2hex(random_bytes(16));
        $w['db']->execute($approvedSql, [$o, $w['a']]);
        $before = $state($w['db']);
        $r = $whileLocked(secondConnection(), $lockEmployee, ['e_2'], $w['db'], static fn () => $post($w, '/api/payroll-plans/generate', ['month' => '2026-10']));
        assertSame([503, 'service_unavailable'], $code($r), 'employee lock');
        assertSame($before, $state($w['db']), 'nothing written');
        $draft = bin2hex(random_bytes(16));
        $w['db']->execute("INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at) VALUES (?, ?, 'e_2', '2026-10', NULL, '1.00', NULL, NULL, 'Draft', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$draft, $w['a']]);
        $r = $whileLocked(secondConnection(), 'SELECT id FROM overtime_records WHERE id = ? FOR UPDATE', [$draft], $w['db'], static fn () => $post($w, '/api/payroll-plans/generate', ['month' => '2026-10']));
        assertSame(200, $r->status, 'an overtime write in flight in the same month (its row locked) does not block generate');
        $w['db']->execute('DELETE FROM payroll_plan_overtime');
        $w['db']->execute("UPDATE payroll_plans SET status = 'Cancelled'");
        $before = $state($w['db']);
        $p = $generate($w)['e_1'];
        $w['db']->execute("UPDATE employees SET monthly_base_salary = '3600000.00' WHERE id = 'e_1'");
        $after = $state($w['db']);
        $r = $whileLocked(secondConnection(), $lockPlan, [$p['id']], $w['db'], static fn () => $post($w, '/api/payroll-plans/generate', ['month' => '2026-10']));
        assertSame([503, 'service_unavailable'], $code($r), 'plan lock');
        assertSame($after, $state($w['db']), 'nothing written');
    },
    'a transition waits on its plan row lock (503) and two writes of the same version: one wins, the loser is 409 and changes nothing (M7)' => static function () use ($world, $generate, $step, $code, $plan, $whileLocked, $lockPlan): void {
        $w = $world();
        $p = $generate($w)['e_1'];
        $r = $whileLocked(secondConnection(), $lockPlan, [$p['id']], $w['db'], static fn () => $step($w, 'review', $p));
        assertSame([503, 'service_unavailable'], $code($r));
        assertSame('Draft', $plan($w['db'], $p['id'])['status']);
        assertSame(200, $step($w, 'review', $p)->status, 'first wins');
        $snap = $plan($w['db'], $p['id']);
        foreach (['approve', 'cancel', 'review', 'return'] as $op) {
            assertSame([409, 'conflict'], $code($step($w, $op, $p)), 'stale ' . $op);
        }
        assertSame($snap, $plan($w['db'], $p['id']), 'the losers changed nothing');
        assertSame(2, (int) $w['db']->select("SELECT COUNT(*) AS n FROM audit_events WHERE entity_id = ?", [$p['id']])[0]['n'], 'create + one review audited');
    },
    'race: two generates at once both wait on the employee lock, then serialize: one live plan per employee, one create row each (no duplicate, no deadlock)' => static function () use ($world, $race, $state, $lockEmployee, $blockedOnEmployees): void {
        $w = $world();
        $out = $race($w, [['generate', ['month' => '2026-10']], ['generate', ['month' => '2026-10']]], $lockEmployee, ['e_1'], $blockedOnEmployees, static fn () => null);
        assertSame(['200 ok', '200 ok'], $out);
        assertSame([2, 0, 2], $state($w['db']), 'two plans, two create rows — the second generate was a no-op');
        assertSame(2, (int) $w['db']->select("SELECT COUNT(*) AS n FROM payroll_plans WHERE status <> 'Cancelled'")[0]['n']);
    },
    'race: a generate waiting on the employee lock while the salary changes takes the committed salary; while the employee is archived, excludes them' => static function () use ($world, $race, $lockEmployee, $blockedOnEmployees): void {
        $w = $world();
        $out = $race($w, [['generate', ['month' => '2026-10']]], $lockEmployee, ['e_1'], $blockedOnEmployees,
            static fn (Database $tx) => $tx->execute("UPDATE employees SET monthly_base_salary = '4000000.00', version = version + 1 WHERE id = 'e_1'"));
        assertSame(['200 ok'], $out);
        assertSame('4000000.00', (string) $w['db']->select("SELECT base_salary FROM payroll_plans WHERE employee_id = 'e_1'")[0]['base_salary'], 'serialized after the salary change');
        $w2 = $world();
        $out = $race($w2, [['generate', ['month' => '2026-10']]], $lockEmployee, ['e_2'], $blockedOnEmployees,
            static fn (Database $tx) => $tx->execute("UPDATE employees SET archived_at = UTC_TIMESTAMP(6), version = version + 1 WHERE id = 'e_2'"));
        assertSame(['200 ok'], $out);
        assertSame(['e_1'], array_map(static fn (array $r): string => (string) $r['employee_id'], $w2['db']->select('SELECT employee_id FROM payroll_plans')), 'the archived employee gets no plan');
    },
    'race: an overtime approval committed while generate waits on its employee is included; one approved after the generate is not, and is never blocked' => static function () use ($world, $race, $lockEmployee, $blockedOnEmployees, $approvedSql, $post, $generate): void {
        $w = $world();
        $o = bin2hex(random_bytes(16));
        // The holder plays the approval: it holds the employee lock (as OvertimeService::approve does) and approves meanwhile.
        $out = $race($w, [['generate', ['month' => '2026-10']]], $lockEmployee, ['e_1'], $blockedOnEmployees,
            static fn (Database $tx) => $tx->execute($approvedSql, [$o, $w['a']]));
        assertSame(['200 ok'], $out);
        $p = $w['db']->select("SELECT id, overtime_amount FROM payroll_plans WHERE employee_id = 'e_1'")[0];
        assertSame('21875.00', (string) $p['overtime_amount'], 'approval serialized before the generate is included');
        assertSame([$o], array_map(static fn (array $r): string => (string) $r['id'], $w['db']->select('SELECT id FROM payroll_plan_overtime WHERE payroll_plan_id = ?', [$p['id']])));
        // A real approval after the generate: create → submit → review → approve through the production routes.
        $d = envelope($post($w, '/api/overtime-records/create', ['employeeId' => 'e_1', 'monthKey' => '2026-10', 'hours' => '2.00']))['data']['overtimeRecord'];
        $s = envelope($post($w, '/api/overtime-records/submit', ['id' => $d['id'], 'expectedVersion' => $d['version']]))['data']['overtimeRecord'];
        $r = envelope($post($w, '/api/overtime-records/review', ['id' => $s['id'], 'expectedVersion' => $s['version']]))['data']['overtimeRecord'];
        $a = $post($w, '/api/overtime-records/approve', ['id' => $r['id'], 'expectedVersion' => $r['version'], 'expectedAmount' => '43750.00']);
        assertSame(200, $a->status, 'payroll never blocks an overtime approval');
        assertSame('21875.00', (string) $w['db']->select('SELECT overtime_amount FROM payroll_plans WHERE id = ?', [$p['id']])[0]['overtime_amount'], 'an approval after the generate is not in that calculation');
        assertSame('65625.00', $generate($w)['e_1']['overtimeAmount'], 'the next generate of the Draft includes it');
    },
    'race: a review waiting on the plan lock while the plan is cancelled meanwhile is refused (409); a generate waiting on a Draft reviewed meanwhile leaves it untouched' => static function () use ($world, $race, $generate, $plan, $lockPlan, $blockedOnPlanLock, $blockedOnPlans): void {
        $w = $world();
        $p = $generate($w)['e_1'];
        $out = $race($w, [['review', ['id' => $p['id'], 'expectedVersion' => $p['version']]]], $lockPlan, [$p['id']], $blockedOnPlanLock,
            static fn (Database $tx) => $tx->execute("UPDATE payroll_plans SET status = 'Cancelled', version = version + 1 WHERE id = ?", [$p['id']]));
        assertSame(['409 conflict'], $out, 'cancel wins');
        assertSame('Cancelled', $plan($w['db'], $p['id'])['status']);
        $q = $generate($w)['e_1'];
        $w['db']->execute("UPDATE employees SET monthly_base_salary = '5000000.00' WHERE id = 'e_1'");
        $out = $race($w, [['generate', ['month' => '2026-10']]], $lockPlan, [$q['id']], $blockedOnPlans,
            static fn (Database $tx) => $tx->execute("UPDATE payroll_plans SET status = 'Reviewed', version = version + 1 WHERE id = ?", [$q['id']]));
        assertSame(['200 ok'], $out);
        assertSame(['Reviewed', '2', '3500000.00'], array_slice(array_values($plan($w['db'], $q['id'])), 0, 3), 'a plan reviewed while generate waited is not recalculated');
    },
    'commit waits on its employee lock and on its plan lock (503, nothing written); it takes no overtime lock' => static function () use ($world, $approvedSql, $readyPlan, $commitBody, $post, $code, $full, $commits, $whileLocked, $lockEmployee, $lockPlan): void {
        $w = $world();
        $o = bin2hex(random_bytes(16));
        $w['db']->execute($approvedSql, [$o, $w['a']]);
        $p = $readyPlan($w, 'e_1');
        $before = $full($w['db'], $p['id']);
        foreach (['employee' => [$lockEmployee, ['e_1']], 'plan' => [$lockPlan, [$p['id']]]] as $label => [$sql, $params]) {
            $r = $whileLocked(secondConnection(), $sql, $params, $w['db'], static fn () => $post($w, '/api/payroll-plans/commit', $commitBody($p, bin2hex(random_bytes(16)))));
            assertSame([503, 'service_unavailable'], $code($r), $label . ' lock');
            assertSame([$before, 0], [$full($w['db'], $p['id']), $commits($w['db'], $p['id'])], 'nothing written while the ' . $label . ' is locked');
        }
        $r = $whileLocked(secondConnection(), 'SELECT id FROM overtime_records WHERE id = ? FOR UPDATE', [$o], $w['db'], static fn () => $post($w, '/api/payroll-plans/commit', $commitBody($p, bin2hex(random_bytes(16)))));
        assertSame(200, $r->status, 'a locked overtime record does not block commit: it is read, never locked');
    },
    'C1 race: two commits of one plan with the same key wait on the employee lock, then serialize — one commit, one replay, both 200, one audit row, no deadlock' => static function () use ($world, $race, $readyPlan, $commitBody, $commits, $full, $lockEmployee, $blockedOnEmployees): void {
        $w = $world();
        $p = $readyPlan($w, 'e_1');
        $key = bin2hex(random_bytes(16));
        $out = $race($w, [['commit', $commitBody($p, $key)], ['commit', $commitBody($p, $key)]], $lockEmployee, ['e_1'], $blockedOnEmployees, static fn () => null);
        assertSame(['200 ok', '200 ok'], $out);
        $row = $full($w['db'], $p['id']);
        assertSame(['Committed', (string) ($p['version'] + 1), $key, 1], [$row['status'], $row['version'], $row['commit_idempotency_key'], $commits($w['db'], $p['id'])], 'one obligation, one audit row');
    },
    'C2 race: two commits of one plan with different keys — one commits, the other is 409; one audit row, no deadlock' => static function () use ($world, $race, $readyPlan, $commitBody, $commits, $full, $lockEmployee, $blockedOnEmployees): void {
        $w = $world();
        $p = $readyPlan($w, 'e_1');
        $out = $race($w, [['commit', $commitBody($p, bin2hex(random_bytes(16)))], ['commit', $commitBody($p, bin2hex(random_bytes(16)))]], $lockEmployee, ['e_1'], $blockedOnEmployees, static fn () => null);
        sort($out);
        assertSame(['200 ok', '409 conflict'], $out);
        assertSame(['Committed', 1], [$full($w['db'], $p['id'])['status'], $commits($w['db'], $p['id'])]);
    },
    'C3 race: a salary change committed while commit waits on the employee is drift (409); a salary change after a commit succeeds and the obligation stays frozen' => static function () use ($world, $race, $readyPlan, $commitBody, $commits, $full, $post, $lockEmployee, $blockedOnEmployees): void {
        $w = $world();
        $p = $readyPlan($w, 'e_1');
        $out = $race($w, [['commit', $commitBody($p, bin2hex(random_bytes(16)))]], $lockEmployee, ['e_1'], $blockedOnEmployees,
            static fn (Database $tx) => $tx->execute("UPDATE employees SET monthly_base_salary = '4000000.00', version = version + 1 WHERE id = 'e_1'"));
        assertSame(['409 conflict'], $out, 'salary first');
        assertSame(['Ready', 0], [$full($w['db'], $p['id'])['status'], $commits($w['db'], $p['id'])]);
        $w2 = $world();
        $q = $readyPlan($w2, 'e_1');
        assertSame(200, $post($w2, '/api/payroll-plans/commit', $commitBody($q, bin2hex(random_bytes(16))))->status, 'commit first');
        $frozen = $full($w2['db'], $q['id']);
        $v = (int) $w2['db']->select("SELECT version FROM employees WHERE id = 'e_1'")[0]['version'];
        assertSame(200, $post($w2, '/api/employees/update', ['id' => 'e_1', 'expectedVersion' => $v, 'monthlyBaseSalary' => '4000000.00'])->status, 'the salary update succeeds afterwards');
        assertSame($frozen, $full($w2['db'], $q['id']), 'the Committed snapshot stays frozen');
    },
    'C4 race: an archive or a status change committed while commit waits is drift (409); a status change after a commit succeeds and the obligation stays frozen' => static function () use ($world, $race, $readyPlan, $commitBody, $commits, $full, $post, $lockEmployee, $blockedOnEmployees): void {
        foreach (["archived_at = UTC_TIMESTAMP(6)", "employment_status = 'On Leave'"] as $change) {
            $w = $world();
            $p = $readyPlan($w, 'e_1');
            $out = $race($w, [['commit', $commitBody($p, bin2hex(random_bytes(16)))]], $lockEmployee, ['e_1'], $blockedOnEmployees,
                static fn (Database $tx) => $tx->execute('UPDATE employees SET ' . $change . ", version = version + 1 WHERE id = 'e_1'"));
            assertSame(['409 conflict'], $out, $change . ' first');
            assertSame(['Ready', 0], [$full($w['db'], $p['id'])['status'], $commits($w['db'], $p['id'])]);
        }
        $w2 = $world();
        $q = $readyPlan($w2, 'e_1');
        assertSame(200, $post($w2, '/api/payroll-plans/commit', $commitBody($q, bin2hex(random_bytes(16))))->status, 'commit first');
        $frozen = $full($w2['db'], $q['id']);
        $v = (int) $w2['db']->select("SELECT version FROM employees WHERE id = 'e_1'")[0]['version'];
        assertSame(200, $post($w2, '/api/employees/update', ['id' => 'e_1', 'expectedVersion' => $v, 'employmentStatus' => 'Inactive'])->status, 'the status change succeeds afterwards');
        assertSame($frozen, $full($w2['db'], $q['id']), 'the obligation stays frozen');
    },
    'C5 race: an overtime approval committed while commit waits on the employee is drift (409); an approval after a commit succeeds and stays outside the obligation' => static function () use ($world, $race, $readyPlan, $commitBody, $commits, $full, $post, $approvedSql, $lockEmployee, $blockedOnEmployees): void {
        $w = $world();
        $p = $readyPlan($w, 'e_1');
        // The holder plays the approval: it holds the employee lock (as OvertimeService::approve does) and approves meanwhile.
        $out = $race($w, [['commit', $commitBody($p, bin2hex(random_bytes(16)))]], $lockEmployee, ['e_1'], $blockedOnEmployees,
            static fn (Database $tx) => $tx->execute($approvedSql, [bin2hex(random_bytes(16)), $w['a']]));
        assertSame(['409 conflict'], $out, 'approval first');
        assertSame(['Ready', 0], [$full($w['db'], $p['id'])['status'], $commits($w['db'], $p['id'])]);
        $w2 = $world();
        $q = $readyPlan($w2, 'e_1');
        assertSame(200, $post($w2, '/api/payroll-plans/commit', $commitBody($q, bin2hex(random_bytes(16))))->status, 'commit first');
        $frozen = $full($w2['db'], $q['id']);
        $d = envelope($post($w2, '/api/overtime-records/create', ['employeeId' => 'e_1', 'monthKey' => '2026-10', 'hours' => '2.00']))['data']['overtimeRecord'];
        $s = envelope($post($w2, '/api/overtime-records/submit', ['id' => $d['id'], 'expectedVersion' => $d['version']]))['data']['overtimeRecord'];
        $r = envelope($post($w2, '/api/overtime-records/review', ['id' => $s['id'], 'expectedVersion' => $s['version']]))['data']['overtimeRecord'];
        assertSame(200, $post($w2, '/api/overtime-records/approve', ['id' => $r['id'], 'expectedVersion' => $r['version'], 'expectedAmount' => '43750.00'])->status, 'the approval succeeds afterwards');
        assertSame($frozen, $full($w2['db'], $q['id']), 'the Committed plan is not altered');
        assertSame(0, (int) $w2['db']->select('SELECT COUNT(*) AS n FROM payroll_plan_overtime WHERE id = ?', [$r['id']])[0]['n'], 'the new overtime is outside the obligation');
    },
    'C6/C7 races: commit against return and against cancel — whichever holds the plan first wins, the other is 409; no deadlock' => static function () use ($world, $race, $raceHold, $readyPlan, $commitBody, $commits, $full, $lockPlan, $blockedOnCommitLock, $blockedOnPlanLock, $holderCommitSql): void {
        foreach (['return' => "status = 'Draft'", 'cancel' => "status = 'Cancelled'"] as $op => $set) {
            $w = $world();
            $p = $readyPlan($w, 'e_1');
            $out = $race($w, [['commit', $commitBody($p, bin2hex(random_bytes(16)))]], $lockPlan, [$p['id']], $blockedOnCommitLock,
                static fn (Database $tx) => $tx->execute('UPDATE payroll_plans SET ' . $set . ', version = version + 1 WHERE id = ?', [$p['id']]));
            assertSame(['409 conflict'], $out, $op . ' first');
            assertSame(0, $commits($w['db'], $p['id']));
            $w2 = $world();
            $q = $readyPlan($w2, 'e_1');
            $key = bin2hex(random_bytes(16));
            $out = $raceHold($w2, [[$op, ['id' => $q['id'], 'expectedVersion' => $q['version']]]],
                static fn (Database $tx) => assertSame(1, $tx->execute($holderCommitSql, [$key, $q['id']]), 'the holder commits the plan'), $blockedOnPlanLock, static fn () => null);
            assertSame(['409 conflict'], $out, 'commit first, then ' . $op);
            assertSame(['Committed', $key], [$full($w2['db'], $q['id'])['status'], $full($w2['db'], $q['id'])['commit_idempotency_key']]);
        }
    },
    'C8 race: commit and generate wait on the same employee lock, then serialize in either order — the plan is committed, generate never rewrites it; no deadlock' => static function () use ($world, $race, $readyPlan, $commitBody, $commits, $full, $lockEmployee, $blockedOnEmployees): void {
        $w = $world();
        $p = $readyPlan($w, 'e_1');
        $other = $full($w['db'], (string) $w['db']->select("SELECT id FROM payroll_plans WHERE employee_id = 'e_2'")[0]['id']);
        $out = $race($w, [['commit', $commitBody($p, bin2hex(random_bytes(16)))], ['generate', ['month' => '2026-10']]], $lockEmployee, ['e_1'], $blockedOnEmployees, static fn () => null);
        assertSame(['200 ok', '200 ok'], $out);
        $row = $full($w['db'], $p['id']);
        assertSame(['Committed', (string) ($p['version'] + 1), $p['totalAmount'], 1], [$row['status'], $row['version'], $row['total_amount'], $commits($w['db'], $p['id'])]);
        assertSame($other, $full($w['db'], $other['id']), 'the unchanged Draft of e_2 is not rewritten either');
        assertSame(2, (int) $w['db']->select("SELECT COUNT(*) AS n FROM payroll_plans WHERE status <> 'Cancelled'")[0]['n'], 'no second live plan');
    },
    'duplicate-key race: one key committed meanwhile on another plan makes the waiting commit 409 (never 500, nothing written); a key released meanwhile lets it commit' => static function () use ($world, $raceHold, $readyPlan, $commitBody, $commits, $full, $blockedOnCommitWrite, $holderCommitSql): void {
        $w = $world();
        $a = $readyPlan($w, 'e_1');
        $b = $readyPlan($w, 'e_2');
        $key = bin2hex(random_bytes(16));
        $before = $full($w['db'], $b['id']);
        $out = $raceHold($w, [['commit', $commitBody($b, $key)]],
            static fn (Database $tx) => assertSame(1, $tx->execute($holderCommitSql, [$key, $a['id']]), 'the holder takes the key on plan A'), $blockedOnCommitWrite, static fn () => null);
        assertSame(['409 conflict'], $out, 'the key was taken by plan A: idempotency mismatch, mapped from the duplicate key');
        assertSame([$before, 0], [$full($w['db'], $b['id']), $commits($w['db'], $b['id'])], 'plan B unchanged, no audit row');
        $w2 = $world();
        $a2 = $readyPlan($w2, 'e_1');
        $b2 = $readyPlan($w2, 'e_2');
        $out = $raceHold($w2, [['commit', $commitBody($b2, $key)]],
            static fn (Database $tx) => assertSame(1, $tx->execute($holderCommitSql, [$key, $a2['id']]), 'the holder takes the key on plan A'), $blockedOnCommitWrite,
            static fn (Database $tx) => $tx->execute("UPDATE payroll_plans SET status = 'Ready', committed_at = NULL, commit_idempotency_key = NULL, version = version - 1 WHERE id = ?", [$a2['id']]));
        assertSame(['200 ok'], $out, 'the key was released before the holder committed');
        assertSame(['Committed', $key, 'Ready'], [$full($w2['db'], $b2['id'])['status'], $full($w2['db'], $b2['id'])['commit_idempotency_key'], $full($w2['db'], $a2['id'])['status']]);
    },
];
