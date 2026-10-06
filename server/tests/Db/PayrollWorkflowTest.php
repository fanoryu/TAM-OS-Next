<?php
declare(strict_types=1);

/*
 * BF-4c1 payroll plans end to end against the real MariaDB (owner decisions D-PAY-1..6 = A): real
 * login → real session → production routes → PayrollService → PayrollStore / AuditLog. Generation
 * (Base Salary + the FROZEN approved amounts of the month's Approved overtime, eligibility and its
 * exclusion reasons, the exact response shape), idempotence, Draft recalculation, Reviewed / Ready /
 * Committed never silently altered, the pre-commit lifecycle, Cancelled releasing its overtime and
 * being replaced, the CEO reads, the snapshot, the audit rows, rollback when the audit row cannot
 * be written, out-of-bounds refusal, hostile principals, and the overtime / finance firewalls.
 * Fabricated data only: salaries and overtime are set with test-only SQL; the Committed plan is
 * committed through the BF-4c2 route (tests/Db/PayrollCommitTest.php proves Commit itself).
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
use TamOs\Http\Response;
use TamOs\Payroll\PayrollView;
use function TamOs\Tests\assertNoLeak;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\authKernel;
use function TamOs\Tests\employeeAnchor;
use function TamOs\Tests\envelope;
use function TamOs\Tests\loginRequest;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\requestId;
use function TamOs\Tests\sessionCookieToken;
use function TamOs\Tests\sessionRequest;
use function TamOs\Tests\testDbConfig;

/**
 * Company A: a CEO; e_a1 (an Employee login, salary 3 500 000.00); e_a2 (salary 4 123 456.78);
 * e_a3 (no salary); e_a4 (Inactive, salary 1 000 000.00); e_a5 (archived, salary 1 000 000.00).
 * Company B: a CEO and e_b1 (salary 2 000 000.00). Everyone logs in for real.
 *
 * @return array{db: Database, k: Kernel, a: string, b: string, s: array<string, array{token: string, csrf: string, userId: string, membershipId: string}>}
 */
$world = static function (): array {
    $db = authDatabase();
    $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
    $ceoA = authFixture($db);
    $a = $ceoA['companyId'];
    $ceoB = authFixture($db);
    $fixtures = ['ceoA' => $ceoA, 'empA1' => authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a1']), 'ceoB' => $ceoB,
        'empB1' => authFixture($db, ['companyId' => $ceoB['companyId'], 'role' => 'employee', 'employeeId' => 'e_b1'])];
    foreach (['e_a2', 'e_a3', 'e_a4', 'e_a5'] as $e) {
        employeeAnchor($db, $a, $e);
    }
    $db->execute("UPDATE employees SET monthly_base_salary = '3500000.00', department = 'Operations' WHERE id = 'e_a1'");
    $db->execute("UPDATE employees SET monthly_base_salary = '4123456.78' WHERE id = 'e_a2'");
    $db->execute("UPDATE employees SET monthly_base_salary = '1000000.00', employment_status = 'Inactive' WHERE id = 'e_a4'");
    $db->execute("UPDATE employees SET monthly_base_salary = '1000000.00', archived_at = UTC_TIMESTAMP(6) WHERE id = 'e_a5'");
    $db->execute("UPDATE employees SET monthly_base_salary = '2000000.00' WHERE id = 'e_b1'");
    $s = [];
    foreach ($fixtures as $name => $f) {
        $r = $k->handle(loginRequest($f['email'], (string) $f['password']), requestId());
        assertSame(200, $r->status, 'login ' . $name);
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken'], 'userId' => $f['userId'], 'membershipId' => $f['membershipId']];
    }
    return ['db' => $db, 'k' => $k, 'a' => $a, 'b' => $ceoB['companyId'], 's' => $s];
};
/** Test-only SQL: an overtime record; an Approved one carries a frozen snapshot with $amount. */
$overtime = static function (Database $db, string $company, string $employee, string $month, string $hours, string $status = 'Approved', ?string $amount = null): string {
    $id = bin2hex(random_bytes(16));
    $approved = $status === 'Approved';
    $db->execute('INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at, valuation_method, valuation_salary, valuation_standard_hours, approved_amount, approved_at)'
        . ' VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, ?, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), ?, ?, ?, ?, ' . ($approved ? 'UTC_TIMESTAMP(6)' : 'NULL') . ')',
        [$id, $company, $employee, $month, $hours, $status, $approved ? 'TAM-OT-1' : null, $approved ? '3200000.00' : null, $approved ? '160.00' : null, $approved ? ($amount ?? '1.00') : null]);
    return $id;
};
$get = static fn (array $w, string $who, string $path, string $query = ''): Response
    => $w['k']->handle(sessionRequest('GET', $path, $w['s'][$who]['token'], null, '', ['query' => $query]), requestId());
$post = static fn (array $w, string $who, string $path, array $body): Response
    => $w['k']->handle(sessionRequest('POST', $path, $w['s'][$who]['token'], $w['s'][$who]['csrf'], json_encode($body, JSON_THROW_ON_ERROR)), requestId());
$ok = static function (Response $r, string $label): array {
    assertSame(200, $r->status, $label . ' (' . substr($r->body, 0, 300) . ')');
    return envelope($r)['data'];
};
$code = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
$generate = static fn (array $w, string $who = 'ceoA', string $month = '2026-10'): Response => $post($w, $who, '/api/payroll-plans/generate', ['month' => $month]);
$step = static fn (array $w, string $op, array $plan, string $who = 'ceoA'): Response
    => $post($w, $who, '/api/payroll-plans/' . $op, ['id' => $plan['id'], 'expectedVersion' => $plan['version']]);
/** The generated plan of $employee in a generate answer. */
$planOf = static function (array $data, string $employee): array {
    foreach ($data['payrollPlans'] as $p) {
        if ($p['employeeId'] === $employee) {
            return $p;
        }
    }
    throw new \LogicException('no plan for ' . $employee);
};
$links = static fn (Database $db, string $plan): array => array_map(static fn (array $r): string => (string) $r['id'],
    $db->select('SELECT id FROM payroll_plan_overtime WHERE payroll_plan_id = ? ORDER BY id', [$plan]));
$audits = static fn (Database $db, ?string $plan = null): array => array_map(
    static fn (array $r): array => array_map(static fn ($v) => $v === null ? null : (string) $v, $r),
    $plan === null
        ? $db->select("SELECT entity_id, operation FROM audit_events WHERE action = 'payroll.manage' ORDER BY id")
        : $db->select('SELECT company_id, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, fields FROM audit_events WHERE entity_id = ? ORDER BY id', [$plan]),
);
$row = static fn (Database $db, string $plan): array => array_map(static fn ($v) => $v === null ? null : (string) $v,
    $db->select('SELECT status, version, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, calculated_at, committed_at FROM payroll_plans WHERE id = ?', [$plan])[0]);
/** Every table's row count — the firewalls compare it around a payroll write. */
$counts = static function (Database $db): array {
    $out = [];
    foreach ($db->select('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME') as $t) {
        $out[(string) $t['t']] = (int) $db->select('SELECT COUNT(*) AS n FROM `' . $t['t'] . '`')[0]['n'];
    }
    return $out;
};
$overtimeRows = static fn (Database $db): array => $db->select('SELECT * FROM overtime_records ORDER BY id');

return [
    'generate: one Draft per eligible employee — Base Salary + the frozen approved amounts of the month, exclusions with reason codes, the exact response shape' => static function () use ($world, $overtime, $generate, $ok, $planOf, $links, $audits, $overtimeRows): void {
        $w = $world();
        $db = $w['db'];
        $o1 = $overtime($db, $w['a'], 'e_a1', '2026-10', '10.00', 'Approved', '200000.00');   // frozen at an older salary: TAM-OT-1 today would be 218 750
        $o2 = $overtime($db, $w['a'], 'e_a1', '2026-10', '2.00', 'Approved', '43750.00');
        $overtime($db, $w['a'], 'e_a1', '2026-10', '5.00', 'Reviewed');
        $overtime($db, $w['a'], 'e_a1', '2026-10', '5.00', 'Submitted');
        $overtime($db, $w['a'], 'e_a1', '2026-10', '5.00', 'Draft');
        $overtime($db, $w['a'], 'e_a1', '2026-10', '5.00', 'Rejected');
        $overtime($db, $w['a'], 'e_a1', '2026-11', '5.00', 'Approved', '99999.00');           // another month (M5)
        $overtime($db, $w['a'], 'e_a5', '2026-10', '5.00', 'Approved', '5000.00');            // an excluded employee
        $before = $overtimeRows($db);
        $data = $ok($generate($w), 'generate');
        assertSame(['payrollPlans', 'excluded'], array_keys($data));
        assertSame([['employeeId' => 'e_a3', 'reason' => 'salary_missing'], ['employeeId' => 'e_a4', 'reason' => 'not_active'], ['employeeId' => 'e_a5', 'reason' => 'archived']], $data['excluded'], 'exclusions in employee order, strict reason codes');
        assertSame(['e_a1', 'e_a2'], array_column($data['payrollPlans'], 'employeeId'), 'only the eligible, deterministic order');
        $p1 = $planOf($data, 'e_a1');
        assertSame(PayrollView::FIELDS, array_keys($p1), 'the exact projection');
        assertSame(['2026-10', 'Draft', 'e_a1', 'Fixture e_a1', 'Operations', '3500000.00', '243750.00', '12.00', 2, '3743750.00', 1],
            [$p1['monthKey'], $p1['status'], $p1['employeeCode'], $p1['employeeName'], $p1['department'], $p1['baseSalary'], $p1['overtimeAmount'], $p1['overtimeHours'], $p1['overtimeCount'], $p1['totalAmount'], $p1['version']],
            'base + the two FROZEN Approved amounts of October only — never recomputed, never Reviewed / Draft / Rejected / November (M3, M4, M5)');
        $p2 = $planOf($data, 'e_a2');
        assertSame(['4123456.78', '0.00', '0.00', 0, '4123457.00'], [$p2['baseSalary'], $p2['overtimeAmount'], $p2['overtimeHours'], $p2['overtimeCount'], $p2['totalAmount']], 'one half-up rounding of the sen');
        $expected = [$o1, $o2];
        sort($expected);
        assertSame($expected, $links($db, $p1['id']), 'the links name exactly the consumed Approved records');
        assertSame([], $links($db, $p2['id']));
        assertSame([[$w['a'], $w['s']['ceoA']['userId'], $w['s']['ceoA']['membershipId'], 'payroll.manage', 'payrollPlan', $p1['id'], 'create', null, null]], array_map('array_values', $audits($db, $p1['id'])), 'one create row, no field, no value');
        assertSame(2, count($audits($db)), 'one audit row per plan');
        assertSame($before, $overtimeRows($db), 'no overtime record is written (overtime firewall)');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM payroll_plans WHERE company_id = ?', [$w['b']])[0]['n'], 'company B untouched');
    },
    'generate is idempotent: a repeat with unchanged inputs writes nothing, audits nothing and keeps every version' => static function () use ($world, $overtime, $generate, $ok, $audits, $row, $planOf): void {
        $w = $world();
        $overtime($w['db'], $w['a'], 'e_a1', '2026-10', '1.00', 'Approved', '21875.00');
        $first = $ok($generate($w), 'first');
        $snap = $row($w['db'], $planOf($first, 'e_a1')['id']);
        $second = $ok($generate($w), 'second');
        assertSame($first, $second, 'the same answer');
        assertSame($snap, $row($w['db'], $planOf($first, 'e_a1')['id']), 'not even calculated_at moves');
        assertSame(2, count($audits($w['db'])), 'no new audit row');
    },
    'a Draft is recalculated from the current inputs — salary, a newly approved record, a renamed employee — with version + 1, links replaced and a recalculate row' => static function () use ($world, $overtime, $generate, $ok, $planOf, $links, $audits): void {
        $w = $world();
        $db = $w['db'];
        $o1 = $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', 'Approved', '21875.00');
        $p = $planOf($ok($generate($w), 'generate'), 'e_a1');
        $db->execute("UPDATE employees SET monthly_base_salary = '3600000.50', full_name = 'Renamed Fixture', employee_code = 'E-NEW', department = NULL, version = version + 1 WHERE id = 'e_a1'");
        $o2 = $overtime($db, $w['a'], 'e_a1', '2026-10', '3.00', 'Approved', '67500.00');
        $q = $planOf($ok($generate($w), 'regenerate'), 'e_a1');
        assertSame([$p['id'], 'Draft', 2, 'E-NEW', 'Renamed Fixture', null, '3600000.50', '89375.00', '4.00', 2, '3689376.00'],
            [$q['id'], $q['status'], $q['version'], $q['employeeCode'], $q['employeeName'], $q['department'], $q['baseSalary'], $q['overtimeAmount'], $q['overtimeHours'], $q['overtimeCount'], $q['totalAmount']]);
        $expected = [$o1, $o2];
        sort($expected);
        assertSame($expected, $links($db, $p['id']));
        assertSame([[$p['id'], 'create'], [$p['id'], 'recalculate']], array_values(array_filter(array_map('array_values', $audits($db)), static fn (array $a): bool => $a[0] === $p['id'])));
    },
    'Reviewed and Ready plans are never silently altered by generate; return to Draft lets the next generate recalculate (D-PAY-4 shape)' => static function () use ($world, $overtime, $generate, $ok, $step, $planOf, $links, $row): void {
        $w = $world();
        $db = $w['db'];
        $o1 = $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', 'Approved', '21875.00');
        $data = $ok($generate($w), 'generate');
        $r = $ok($step($w, 'review', $planOf($data, 'e_a1')), 'review')['payrollPlan'];
        $ready = $ok($step($w, 'approve', $planOf($data, 'e_a2')), 'approve')['payrollPlan'];
        [$snapR, $snapReady] = [$row($db, $r['id']), $row($db, $ready['id'])];
        $db->execute("UPDATE employees SET monthly_base_salary = '9000000.00', full_name = 'Changed' WHERE id IN ('e_a1', 'e_a2')");
        $late = $overtime($db, $w['a'], 'e_a1', '2026-10', '2.00', 'Approved', '43750.00');
        $again = $ok($generate($w), 'generate after the inputs changed');
        assertSame([$snapR, $snapReady], [$row($db, $r['id']), $row($db, $ready['id'])], 'Reviewed and Ready are untouched (M16: the snapshot is not the live salary)');
        assertSame([$o1], $links($db, $r['id']), 'the late approval is not consumed by a Reviewed plan');
        assertSame([$r['id'], $ready['id']], [$planOf($again, 'e_a1')['id'], $planOf($again, 'e_a2')['id']], 'no second live plan');
        $back = $ok($step($w, 'return', $r), 'return')['payrollPlan'];
        assertSame(['Draft', $r['version'] + 1, '3500000.00'], [$back['status'], $back['version'], $back['baseSalary']], 'return changes only the status');
        $re = $planOf($ok($generate($w), 'recalculate'), 'e_a1');
        $expected = [$o1, $late];
        sort($expected);
        assertSame(['9000000.00', '65625.00', 'Changed', 'Draft'], [$re['baseSalary'], $re['overtimeAmount'], $re['employeeName'], $re['status']]);
        assertSame($expected, $links($db, $r['id']), 'the late approval joins the recalculated Draft');
    },
    'the pre-commit lifecycle: every operation from every status — legal moves succeed, the rest are 409; a stale version is 409 and changes nothing (M7)' => static function () use ($world, $generate, $ok, $step, $code, $planOf, $row): void {
        $w = $world();
        $fresh = static function () use ($w, $generate, $ok, $planOf, $step): array {
            $w['db']->execute('DELETE FROM payroll_plan_overtime');
            $w['db']->execute("UPDATE payroll_plans SET status = 'Cancelled' WHERE status <> 'Committed'");
            return $planOf($ok($generate($w), 'fresh'), 'e_a2');
        };
        $reach = static function (string $status) use ($fresh, $ok, $step, $w): array {
            $p = $fresh();
            return match ($status) {
                'Draft' => $p,
                'Reviewed' => $ok($step($w, 'review', $p), 'to Reviewed')['payrollPlan'],
                'Ready' => $ok($step($w, 'approve', $p), 'to Ready')['payrollPlan'],
                'Cancelled' => $ok($step($w, 'cancel', $p), 'to Cancelled')['payrollPlan'],
            };
        };
        $legal = ['review' => ['Draft' => 'Reviewed'], 'approve' => ['Draft' => 'Ready', 'Reviewed' => 'Ready'], 'return' => ['Reviewed' => 'Draft', 'Ready' => 'Draft'], 'cancel' => ['Draft' => 'Cancelled', 'Reviewed' => 'Cancelled', 'Ready' => 'Cancelled']];
        foreach ($legal as $op => $moves) {
            foreach (['Draft', 'Reviewed', 'Ready', 'Cancelled'] as $from) {
                $p = $reach($from);
                $r = $step($w, $op, $p);
                if (isset($moves[$from])) {
                    $out = $ok($r, $op . ' from ' . $from)['payrollPlan'];
                    assertSame([$moves[$from], $p['version'] + 1, $p['totalAmount']], [$out['status'], $out['version'], $out['totalAmount']], $op . ' from ' . $from);
                    $before = $row($w['db'], $p['id']);
                    assertSame([409, 'conflict'], $code($step($w, $op === 'cancel' ? 'review' : 'cancel', $p)), 'stale version after ' . $op);
                    assertSame($before, $row($w['db'], $p['id']), 'a stale write changes nothing');
                } else {
                    assertSame([409, 'conflict'], $code($r), $op . ' from ' . $from . ' is illegal');
                }
            }
        }
    },
    'Committed is terminal: no operation, no generate and no link release touches it (M8); Cancelled is terminal (M9)' => static function () use ($world, $overtime, $generate, $ok, $step, $code, $planOf, $links, $row, $post): void {
        $w = $world();
        $db = $w['db'];
        $o = $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', 'Approved', '21875.00');
        $data = $ok($generate($w), 'generate');
        $p = $ok($step($w, 'approve', $planOf($data, 'e_a1')), 'approve')['payrollPlan'];
        // BF-4c2 authorized revision: committed through the production commit route. Was: test-only
        // SQL standing in for Commit (0027 now requires a commit key on every Committed row).
        $committed = $ok($post($w, 'ceoA', '/api/payroll-plans/commit', ['id' => $p['id'], 'expectedVersion' => $p['version'], 'expectedTotal' => $p['totalAmount'], 'idempotencyKey' => bin2hex(random_bytes(16))]), 'commit')['payrollPlan'];
        $before = $row($db, $p['id']);
        foreach (['review', 'approve', 'return', 'cancel'] as $op) {
            assertSame([409, 'conflict'], $code($step($w, $op, $committed)), $op . ' on Committed');
        }
        $db->execute("UPDATE employees SET monthly_base_salary = '9999999.00' WHERE id = 'e_a1'");
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', 'Approved', '1.00');
        $again = $ok($generate($w), 'generate');
        assertSame($p['id'], $planOf($again, 'e_a1')['id'], 'the Committed plan stays the live plan');
        assertSame($before, $row($db, $p['id']), 'Committed is never altered');
        assertSame([$o], $links($db, $p['id']), 'its links are frozen');
        assertSame(0, $db->execute('DELETE FROM payroll_plan_overtime WHERE company_id = ? AND payroll_plan_id = ? AND EXISTS (SELECT 1 FROM payroll_plans p WHERE p.company_id = payroll_plan_overtime.company_id AND p.id = payroll_plan_overtime.payroll_plan_id AND p.status IN (\'Draft\', \'Reviewed\', \'Ready\'))', [$w['a'], $p['id']]), 'the production release statement matches no link of a Committed plan');
        $c = $ok($step($w, 'cancel', $planOf($data, 'e_a2')), 'cancel')['payrollPlan'];
        foreach (['review', 'approve', 'return', 'cancel'] as $op) {
            assertSame([409, 'conflict'], $code($step($w, $op, $c)), $op . ' on Cancelled');
        }
    },
    'cancel releases the overtime links; the next generate creates a new live Draft that consumes them again, the Cancelled plan stays as history' => static function () use ($world, $overtime, $generate, $ok, $step, $planOf, $links, $get, $audits): void {
        $w = $world();
        $db = $w['db'];
        $o = $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', 'Approved', '21875.00');
        $p = $planOf($ok($generate($w), 'generate'), 'e_a1');
        $c = $ok($step($w, 'cancel', $p), 'cancel')['payrollPlan'];
        assertSame(['Cancelled', 2], [$c['status'], $c['version']]);
        assertSame([], $links($db, $p['id']), 'a cancelled plan consumes no overtime');
        $n = $planOf($ok($generate($w), 'regenerate'), 'e_a1');
        assertTrue($n['id'] !== $p['id'], 'a new live plan');
        assertSame([$o], $links($db, $n['id']), 'the released record is consumed again, once');
        $list = $ok($get($w, 'ceoA', '/api/payroll-plans', 'month=2026-10'), 'list')['payrollPlans'];
        assertSame(3, count($list), 'the list keeps the Cancelled history');
        assertSame(['Cancelled', 'Draft'], array_values(array_map(static fn (array $x): string => $x['status'], array_filter($list, static fn (array $x): bool => $x['employeeId'] === 'e_a1'))));
        assertSame([[$p['id'], 'create'], [$p['id'], 'cancel']], array_values(array_filter(array_map('array_values', $audits($db)), static fn (array $a): bool => $a[0] === $p['id'])));
    },
    'reads: the CEO month list and detail with the contributing overtime; another company is 404; an Employee reads no pre-commit plan; nothing internal leaks' => static function () use ($world, $overtime, $generate, $ok, $get, $code, $planOf): void {
        $w = $world();
        $o = $overtime($w['db'], $w['a'], 'e_a1', '2026-10', '2.50', 'Approved', '54688.00');
        $p = $planOf($ok($generate($w), 'generate'), 'e_a1');
        $list = $get($w, 'ceoA', '/api/payroll-plans', 'month=2026-10');
        assertSame(['e_a1', 'e_a2'], array_column($ok($list, 'list')['payrollPlans'], 'employeeId'));
        $d = $get($w, 'ceoA', '/api/payroll-plan', 'id=' . $p['id']);
        assertSame(['payrollPlan', 'payrollPlanOvertime'], array_keys($ok($d, 'detail')));
        assertSame([['id' => $o, 'hours' => '2.50', 'amount' => '54688.00']], $ok($d, 'detail')['payrollPlanOvertime'], 'the frozen amount, nothing else');
        assertNoLeak($list->body . $d->body, [$w['a'], 'live_key', 'company_id', 'calculated_at', 'committed', 'valuation', '3200000']);
        assertSame([], $ok($get($w, 'ceoA', '/api/payroll-plans', 'month=2026-11'), 'empty month')['payrollPlans']);
        assertSame([404, 'not_found'], $code($get($w, 'ceoB', '/api/payroll-plan', 'id=' . $p['id'])), 'another company CEO');
        assertSame([], $ok($get($w, 'ceoB', '/api/payroll-plans', 'month=2026-10'), 'company B list')['payrollPlans'], 'company B sees none of A (M11)');
        assertSame([404, 'not_found'], $code($get($w, 'ceoA', '/api/payroll-plan', 'id=' . str_repeat('0', 32))), 'absent');
        // BF-4c2 authorized revision (D-PAY-5 = A): the owner reads only their own Committed plans, so
        // their own Draft is absent (404) and their month list empty. Was: 403 on every Employee read.
        assertSame([404, 'not_found'], $code($get($w, 'empA1', '/api/payroll-plan', 'id=' . $p['id'])), 'the owner does not read their own Draft');
        assertSame([], $ok($get($w, 'empA1', '/api/payroll-plans', 'month=2026-10'), 'Employee list')['payrollPlans'], 'Employee list: no Committed plan yet');
    },
    'hostile principals: an Employee is 403 on every write; another company CEO is 404 on every transition and its generate never touches company A (M11, M12)' => static function () use ($world, $generate, $ok, $step, $code, $planOf, $counts, $post): void {
        $w = $world();
        $p = $planOf($ok($generate($w), 'generate'), 'e_a1');
        $before = $counts($w['db']);
        assertSame([403, 'forbidden'], $code($generate($w, 'empA1')), 'Employee generate');
        assertSame([403, 'forbidden'], $code($generate($w, 'empB1')), 'other company Employee generate');
        foreach (['review', 'approve', 'return', 'cancel'] as $op) {
            assertSame([403, 'forbidden'], $code($step($w, $op, $p, 'empA1')), 'owner ' . $op);
            assertSame([404, 'not_found'], $code($step($w, $op, $p, 'ceoB')), 'company B CEO ' . $op);
        }
        assertSame($before, $counts($w['db']), 'nothing written by a refused principal');
        $b = $ok($generate($w, 'ceoB'), 'company B generate');
        assertSame(['e_b1'], array_column($b['payrollPlans'], 'employeeId'), 'company B plans only its own employees');
        assertSame([], $b['excluded']);
        assertSame([400, 'validation_failed'], $code($post($w, 'ceoA', '/api/payroll-plans/generate', ['month' => '2026-10', 'companyId' => $w['b']])), 'no browser company');
    },
    'snapshot: a later rename, code change, salary change or archive never rewrites an existing plan until an authorized Draft recalculation (M16)' => static function () use ($world, $generate, $ok, $step, $planOf, $row): void {
        $w = $world();
        $data = $ok($generate($w), 'generate');
        $draft = $planOf($data, 'e_a1');
        $reviewed = $ok($step($w, 'review', $planOf($data, 'e_a2')), 'review')['payrollPlan'];
        $before = [$row($w['db'], $draft['id']), $row($w['db'], $reviewed['id'])];
        $w['db']->execute("UPDATE employees SET full_name = 'Renamed', employee_code = CONCAT('NEW-', id), department = 'Elsewhere', monthly_base_salary = '1.00', version = version + 1 WHERE id IN ('e_a1', 'e_a2')");
        $w['db']->execute("UPDATE employees SET archived_at = UTC_TIMESTAMP(6) WHERE id = 'e_a2'");
        assertSame($before, [$row($w['db'], $draft['id']), $row($w['db'], $reviewed['id'])], 'an Employee edit writes no plan');
        $again = $ok($generate($w), 'generate');
        assertSame('1.00', $planOf($again, 'e_a1')['baseSalary'], 'the Draft takes the new inputs only through a recalculation');
        assertSame($before[1], $row($w['db'], $reviewed['id']), 'the Reviewed plan of a now-archived employee is untouched');
        assertSame([['employeeId' => 'e_a2', 'reason' => 'archived'], ['employeeId' => 'e_a3', 'reason' => 'salary_missing'], ['employeeId' => 'e_a4', 'reason' => 'not_active'], ['employeeId' => 'e_a5', 'reason' => 'archived']], $again['excluded']);
    },
    'a failing audit append rolls generate and every transition back entirely (M10)' => static function () use ($world, $overtime, $generate, $ok, $step, $code, $planOf, $counts, $row): void {
        $w = $world();
        $db = $w['db'];
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', 'Approved', '21875.00');
        $p = $planOf($ok($generate($w), 'generate'), 'e_a1');
        $db->execute('DELETE FROM payroll_plan_overtime');
        $db->execute("UPDATE payroll_plans SET status = 'Cancelled'");
        $before = [$counts($db), $row($db, $p['id'])];
        $last = (string) $db->select('SELECT MAX(occurred_at) AS t FROM audit_events')[0]['t'];
        usleep(2000);
        // Test-only DDL: every further audit insert violates this CHECK — inside the payroll transaction.
        $db->execute("ALTER TABLE audit_events ADD CONSTRAINT test_block_audit CHECK (occurred_at <= '" . $last . "')");
        try {
            assertSame([500, 'internal_error'], $code($generate($w)), 'generate');
            assertSame($before, [$counts($db), $row($db, $p['id'])], 'no plan and no link survive the failed generate');
        } finally {
            $db->execute('ALTER TABLE audit_events DROP CONSTRAINT test_block_audit');
        }
        $q = $planOf($ok($generate($w), 'generate again'), 'e_a1');
        $snap = $row($db, $q['id']);
        $last = (string) $db->select('SELECT MAX(occurred_at) AS t FROM audit_events')[0]['t'];
        usleep(2000);
        $db->execute("ALTER TABLE audit_events ADD CONSTRAINT test_block_audit CHECK (occurred_at <= '" . $last . "')");
        try {
            foreach (['review', 'approve', 'cancel'] as $op) {
                assertSame([500, 'internal_error'], $code($step($w, $op, $q)), $op);
                assertSame($snap, $row($db, $q['id']), $op . ' rolled back');
            }
            assertSame(1, count($db->select('SELECT id FROM payroll_plan_overtime WHERE payroll_plan_id = ?', [$q['id']])), 'a failed cancel releases nothing');
        } finally {
            $db->execute('ALTER TABLE audit_events DROP CONSTRAINT test_block_audit');
        }
    },
    'an exact result above its column is refused (409) and nothing is written — never wrapped or rounded away' => static function () use ($world, $overtime, $generate, $code, $counts): void {
        $w = $world();
        $db = $w['db'];
        $db->execute("UPDATE employees SET monthly_base_salary = '9999999999999.99' WHERE id = 'e_a2'");
        for ($i = 0; $i < 10; $i++) {
            $overtime($db, $w['a'], 'e_a2', '2026-10', '744.00', 'Approved', '99999999999999.00');
        }
        $before = $counts($db);
        assertSame([409, 'conflict'], $code($generate($w)), 'out of bounds');
        assertSame($before, $counts($db), 'the whole generate is refused');
    },
    'finance and payment firewall: generate and every transition change only payroll_plans, payroll_plan_overtime and audit_events (M13)' => static function () use ($world, $overtime, $generate, $ok, $step, $planOf, $counts): void {
        $w = $world();
        $db = $w['db'];
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', 'Approved', '21875.00');
        $before = $counts($db);
        $data = $ok($generate($w), 'generate');
        $p = $ok($step($w, 'approve', $planOf($data, 'e_a1')), 'approve')['payrollPlan'];
        $ok($step($w, 'cancel', $planOf($data, 'e_a2')), 'cancel');
        $after = $counts($db);
        foreach ($after as $table => $n) {
            if (!in_array($table, ['payroll_plans', 'payroll_plan_overtime', 'audit_events'], true)) {
                assertSame($before[$table] ?? null, $n, $table . ' is untouched');
            }
        }
        assertSame([2, 1, $before['audit_events'] + 4], [$after['payroll_plans'], $after['payroll_plan_overtime'], $after['audit_events']]);
        // BF-4e authorized revision: the Finance posting table exists; generate and the transitions never
        // write it (its count is compared above). Was: no finance table at all.
        assertSame([], array_values(array_filter(array_keys($after), static fn (string $t): bool => $t !== 'finance_postings' && (bool) preg_match('/finance|transaction|ledger|journal|payment|payslip/', $t))), 'no other finance table exists');
        assertSame('Ready', $p['status'], 'Ready is an approved obligation, not a payment');
    },
];
