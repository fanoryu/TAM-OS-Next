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
/** Starts payroll workers, waits until all are blocked on $blockedOn while $holder holds the lock, runs $meanwhile, commits; returns each worker's "<status> <code>". */
$race = static function (array $w, array $jobs, string $lockSql, array $lockParams, string $blockedOn, Closure $meanwhile): array {
    $workers = [];
    secondConnection()->transaction(static function (Database $tx) use ($w, $jobs, $lockSql, $lockParams, $blockedOn, $meanwhile, &$workers): void {
        assertTrue(count($tx->select($lockSql, $lockParams)) === 1, 'the holder locked the row');
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
$lockEmployee = 'SELECT id FROM employees WHERE id = ? FOR UPDATE';
$blockedOnEmployees = 'SELECT id, company_id, id AS owner_employee_id, employee_code, full_name';
$lockPlan = 'SELECT id FROM payroll_plans WHERE id = ? FOR UPDATE';
$blockedOnPlans = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, status, employee_code_snapshot';
$blockedOnPlanLock = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, status, version FROM payroll_plans';

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
];
