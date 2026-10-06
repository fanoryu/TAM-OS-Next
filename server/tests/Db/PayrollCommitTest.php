<?php
declare(strict_types=1);

/*
 * BF-4c2 Payroll Commit and the Employee self-read against the real MariaDB (owner decisions
 * D-PAY-1/4/5 = A, D-BF4c2-1..4 = A): real login → real session → production routes →
 * PayrollService → PayrollStore / AuditLog. Ready → Committed (committed_at, version + 1, the stored
 * key, one commit audit row) as an immutable obligation and nothing else; the idempotent replay and
 * every mismatch; a refused or failed commit never consuming its key; expectedTotal as an exact
 * confirmation; the drift guard (eligibility, salary, Approved overtime — never the display
 * snapshot) and the CEO drift read sharing its one definition; Committed terminality; the
 * Employee's read of their own Committed plans only and the MU-4 privacy probes; the unchanged CEO
 * projection; rollback when the audit row cannot be written; the finance, overtime and statutory
 * firewalls. Fabricated data only.
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
 * Company A: a CEO; e_a1 and e_a2 (Employee logins, salaries 3 500 000.00 and 4 123 456.78), e_a3
 * (salary 2 000 000.00). Company B: a CEO and e_b1 (an Employee login, salary 2 000 000.00).
 *
 * @return array{db: Database, k: Kernel, a: string, b: string, s: array<string, array{token: string, csrf: string, userId: string, membershipId: string}>}
 */
$world = static function (): array {
    $db = authDatabase();
    $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
    $ceoA = authFixture($db);
    $a = $ceoA['companyId'];
    $ceoB = authFixture($db);
    $fixtures = ['ceoA' => $ceoA, 'empA1' => authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a1']),
        'empA2' => authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a2']), 'ceoB' => $ceoB,
        'empB1' => authFixture($db, ['companyId' => $ceoB['companyId'], 'role' => 'employee', 'employeeId' => 'e_b1'])];
    employeeAnchor($db, $a, 'e_a3');
    $db->execute("UPDATE employees SET monthly_base_salary = '3500000.00', department = 'Operations' WHERE id = 'e_a1'");
    $db->execute("UPDATE employees SET monthly_base_salary = '4123456.78' WHERE id = 'e_a2'");
    $db->execute("UPDATE employees SET monthly_base_salary = '2000000.00' WHERE id IN ('e_a3', 'e_b1')");
    $s = [];
    foreach ($fixtures as $name => $f) {
        $r = $k->handle(loginRequest($f['email'], (string) $f['password']), requestId());
        assertSame(200, $r->status, 'login ' . $name);
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken'], 'userId' => $f['userId'], 'membershipId' => $f['membershipId']];
    }
    return ['db' => $db, 'k' => $k, 'a' => $a, 'b' => $ceoB['companyId'], 's' => $s];
};
/** Test-only SQL: an Approved overtime record with a frozen snapshot and $amount. */
$overtime = static function (Database $db, string $company, string $employee, string $month, string $hours, string $amount): string {
    $id = bin2hex(random_bytes(16));
    $db->execute("INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at, valuation_method, valuation_salary, valuation_standard_hours, approved_amount, approved_at) VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, 'Approved', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'TAM-OT-1', '3200000.00', '160.00', ?, UTC_TIMESTAMP(6))",
        [$id, $company, $employee, $month, $hours, $amount]);
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
$newKey = static fn (): string => bin2hex(random_bytes(16));
/** The live plans of $month after a CEO generate, by employee. */
$generate = static function (array $w, string $month = '2026-10', string $who = 'ceoA') use ($post, $ok): array {
    $out = [];
    foreach ($ok($post($w, $who, '/api/payroll-plans/generate', ['month' => $month]), 'generate')['payrollPlans'] as $p) {
        $out[$p['employeeId']] = $p;
    }
    return $out;
};
$step = static fn (array $w, string $op, array $plan, string $who = 'ceoA'): Response
    => $post($w, $who, '/api/payroll-plans/' . $op, ['id' => $plan['id'], 'expectedVersion' => $plan['version']]);
/** $employee's plan of $month, generated and approved to Ready by $who. */
$ready = static function (array $w, string $employee, string $month = '2026-10', string $who = 'ceoA') use ($generate, $step, $ok): array {
    return $ok($step($w, 'approve', $generate($w, $month, $who)[$employee], $who), 'approve')['payrollPlan'];
};
$commitBody = static fn (array $plan, string $key, array $over = []): array
    => $over + ['id' => $plan['id'], 'expectedVersion' => $plan['version'], 'expectedTotal' => $plan['totalAmount'], 'idempotencyKey' => $key];
$commit = static fn (array $w, array $plan, string $key, array $over = [], string $who = 'ceoA'): Response
    => $post($w, $who, '/api/payroll-plans/commit', $commitBody($plan, $key, $over));
$drift = static fn (array $w, string $id, string $who = 'ceoA'): Response => $get($w, $who, '/api/payroll-plan/drift', 'id=' . $id);
$row = static fn (Database $db, string $plan): array => array_map(static fn ($v) => $v === null ? null : (string) $v,
    $db->select('SELECT * FROM payroll_plans WHERE id = ?', [$plan])[0]);
$audits = static fn (Database $db, string $plan): array => array_map(static fn (array $r): string => (string) $r['operation'],
    $db->select("SELECT operation FROM audit_events WHERE action = 'payroll.manage' AND entity_id = ? ORDER BY id", [$plan]));
$links = static fn (Database $db, string $plan): array => array_map(static fn (array $r): string => (string) $r['id'],
    $db->select('SELECT id FROM payroll_plan_overtime WHERE payroll_plan_id = ? ORDER BY id', [$plan]));
/** Every table's row count — the firewalls compare it around a commit. */
$counts = static function (Database $db): array {
    $out = [];
    foreach ($db->select('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME') as $t) {
        $out[(string) $t['t']] = (int) $db->select('SELECT COUNT(*) AS n FROM `' . $t['t'] . '`')[0]['n'];
    }
    return $out;
};
/** Asserts a refused commit changed nothing: the plan row, its links and its audit rows. */
$unchanged = static function (Database $db, string $plan, Closure $fn) use ($row, $links, $audits): void {
    $before = [$row($db, $plan), $links($db, $plan), $audits($db, $plan)];
    $fn();
    assertSame($before, [$row($db, $plan), $links($db, $plan), $audits($db, $plan)], 'nothing written');
};

return [
    'commit: Ready → Committed — the same thirteen-key plan at version + 1, committed_at and the key stored, one commit audit row; the snapshot and links are the obligation' => static function () use ($world, $overtime, $ready, $commit, $ok, $row, $audits, $links, $newKey, $get): void {
        $w = $world();
        $db = $w['db'];
        $o = $overtime($db, $w['a'], 'e_a1', '2026-10', '10.00', '200000.00');
        $p = $ready($w, 'e_a1');
        $key = $newKey();
        $before = $row($db, $p['id']);
        $c = $ok($commit($w, $p, $key), 'commit');
        assertSame(['payrollPlan'], array_keys($c));
        $q = $c['payrollPlan'];
        assertSame(PayrollView::FIELDS, array_keys($q), 'exactly the thirteen BF-4c1 keys (M17)');
        assertSame(['Committed', $p['version'] + 1, '3700000.00', '3500000.00', '200000.00', '10.00', 1, 'e_a1', 'Fixture e_a1', 'Operations'],
            [$q['status'], $q['version'], $q['totalAmount'], $q['baseSalary'], $q['overtimeAmount'], $q['overtimeHours'], $q['overtimeCount'], $q['employeeCode'], $q['employeeName'], $q['department']]);
        $after = $row($db, $p['id']);
        assertTrue($after['committed_at'] !== null && $before['committed_at'] === null, 'committed_at is the database clock');
        assertSame($key, $after['commit_idempotency_key'], 'the key is stored');
        foreach (['base_salary', 'overtime_amount', 'overtime_hours', 'overtime_count', 'total_amount', 'employee_code_snapshot', 'employee_name_snapshot', 'department_snapshot', 'calculated_at', 'month_key', 'employee_id'] as $col) {
            assertSame($before[$col], $after[$col], $col . ' is frozen as calculated');
        }
        assertSame(['create', 'approve', 'commit'], $audits($db, $p['id']), 'one commit row');
        assertSame([$o], $links($db, $p['id']), 'the links are the obligation');
        $commitRow = $db->select("SELECT actor_user_id, actor_membership_id, entity, operation, fields, target_user_id FROM audit_events WHERE entity_id = ? AND operation = 'commit'", [$p['id']])[0];
        assertSame([$w['s']['ceoA']['userId'], $w['s']['ceoA']['membershipId'], 'payrollPlan', 'commit', null, null], array_values(array_map(static fn ($v) => $v === null ? null : (string) $v, $commitRow)), 'the actor from the session, no field, no value');
        $detail = $get($w, 'ceoA', '/api/payroll-plan', 'id=' . $p['id']);
        assertSame($q, $ok($detail, 'detail')['payrollPlan'], 'the CEO detail reads the same Committed plan');
        assertNoLeak($detail->body . $commit($w, $p, $key)->body, [$key, 'commit_idempotency_key', 'committed_at', 'idempotency', $w['a']]);
    },
    'commit only from Ready: Draft, Reviewed and Cancelled are 409 payroll state and change nothing (M1, M2)' => static function () use ($world, $generate, $step, $ok, $commit, $code, $unchanged, $newKey): void {
        $w = $world();
        $plans = $generate($w);
        $draft = $plans['e_a1'];
        $reviewed = $ok($step($w, 'review', $plans['e_a2']), 'review')['payrollPlan'];
        $cancelled = $ok($step($w, 'cancel', $plans['e_a3']), 'cancel')['payrollPlan'];
        foreach (['Draft' => $draft, 'Reviewed' => $reviewed, 'Cancelled' => $cancelled] as $label => $p) {
            $unchanged($w['db'], $p['id'], static fn () => assertSame([409, 'conflict'], $code($commit($w, $p, $newKey())), $label));
        }
    },
    'idempotent replay: the same key and request after a success — the ambiguous retry — answers the same Committed plan with no write and no audit row' => static function () use ($world, $ready, $commit, $ok, $row, $audits, $newKey, $counts): void {
        $w = $world();
        $p = $ready($w, 'e_a1');
        $key = $newKey();
        $first = $ok($commit($w, $p, $key), 'first')['payrollPlan'];
        $snap = [$row($w['db'], $p['id']), $audits($w['db'], $p['id']), $counts($w['db'])];
        for ($i = 0; $i < 3; $i++) {
            assertSame($first, $ok($commit($w, $p, $key), 'replay ' . $i)['payrollPlan'], 'the original Committed plan');
        }
        assertSame($snap, [$row($w['db'], $p['id']), $audits($w['db'], $p['id']), $counts($w['db'])], 'no write, no audit row, not even updated_at (M11)');
    },
    'idempotency mismatch: the same key with another expectedVersion, another expectedTotal or another plan is 409; another key on the Committed plan is 409; nothing changes (M12)' => static function () use ($world, $ready, $commit, $ok, $code, $unchanged, $newKey): void {
        $w = $world();
        $p = $ready($w, 'e_a1');
        $other = $ready($w, 'e_a2');
        $key = $newKey();
        $ok($commit($w, $p, $key), 'commit');
        $unchanged($w['db'], $p['id'], static function () use ($w, $commit, $code, $p, $key, $newKey): void {
            assertSame([409, 'conflict'], $code($commit($w, $p, $key, ['expectedVersion' => $p['version'] + 1])), 'same key, another version');
            assertSame([409, 'conflict'], $code($commit($w, $p, $key, ['expectedTotal' => '1.00'])), 'same key, another total');
            assertSame([409, 'conflict'], $code($commit($w, $p, $newKey())), 'another key on the Committed plan');
        });
        $unchanged($w['db'], $other['id'], static fn () => assertSame([409, 'conflict'], $code($commit($w, $other, $key)), 'the same key on another plan'));
        assertSame('Ready', $other['status']);
        $ok($commit($w, $other, $newKey()), 'the other plan commits with its own key');
        $w2 = $world();
        $b = $ready($w2, 'e_b1', '2026-10', 'ceoB');
        $ok($commit($w2, $b, $key, [], 'ceoB'), 'another company may use the same key');
    },
    'a refused or failed commit never consumes its key: after a 409 total, version, drift or state the same key commits the valid request' => static function () use ($world, $ready, $commit, $ok, $code, $newKey, $row): void {
        $w = $world();
        $db = $w['db'];
        $p = $ready($w, 'e_a1');
        $key = $newKey();
        assertSame([409, 'conflict'], $code($commit($w, $p, $key, ['expectedTotal' => '3500001.00'])), 'wrong total');
        assertSame([409, 'conflict'], $code($commit($w, $p, $key, ['expectedVersion' => $p['version'] + 5])), 'stale version');
        $db->execute("UPDATE employees SET monthly_base_salary = '3500000.01' WHERE id = 'e_a1'");
        assertSame([409, 'conflict'], $code($commit($w, $p, $key)), 'drift');
        $db->execute("UPDATE employees SET monthly_base_salary = '3500000.00' WHERE id = 'e_a1'");
        assertSame(null, $row($db, $p['id'])['commit_idempotency_key'], 'no key stored by a refusal');
        assertSame('Committed', $ok($commit($w, $p, $key), 'the valid request with the same key')['payrollPlan']['status']);
    },
    'expectedTotal is an exact confirmation of the locked total: a different total is 409 and changes nothing; the browser total is never stored (M5)' => static function () use ($world, $ready, $commit, $code, $unchanged, $newKey, $ok, $row): void {
        $w = $world();
        $p = $ready($w, 'e_a2');
        assertSame('4123457.00', $p['totalAmount'], 'the half-up whole-Rupiah total');
        $unchanged($w['db'], $p['id'], static function () use ($w, $commit, $code, $p, $newKey): void {
            foreach (['4123456.00', '4123458.00', '0.00', '41234570.00'] as $total) {
                assertSame([409, 'conflict'], $code($commit($w, $p, $newKey(), ['expectedTotal' => $total])), $total);
            }
        });
        $ok($commit($w, $p, $newKey()), 'the exact total commits');
        assertSame('4123457.00', $row($w['db'], $p['id'])['total_amount'], 'the server total, unchanged');
    },
    'a stale expectedVersion is 409 and changes nothing' => static function () use ($world, $ready, $commit, $code, $unchanged, $newKey): void {
        $w = $world();
        $p = $ready($w, 'e_a1');
        $unchanged($w['db'], $p['id'], static fn () => assertSame([409, 'conflict'], $code($commit($w, $p, $newKey(), ['expectedVersion' => $p['version'] - 1])), 'older'));
        $unchanged($w['db'], $p['id'], static fn () => assertSame([409, 'conflict'], $code($commit($w, $p, $newKey(), ['expectedVersion' => $p['version'] + 1])), 'newer'));
    },
    'drift guard and drift read share one definition: each eligibility, salary and Approved-overtime change is 409 on commit and named by the drift read; the display snapshot never drifts (D-BF4c2-2, D-BF4c2-4)' => static function () use ($world, $overtime, $ready, $commit, $drift, $ok, $code, $unchanged, $newKey): void {
        $cases = [
            'salary changed' => [static fn (array $w) => $w['db']->execute("UPDATE employees SET monthly_base_salary = '3600000.00' WHERE id = 'e_a1'"), ['salary_changed']],
            'salary a sen higher' => [static fn (array $w) => $w['db']->execute("UPDATE employees SET monthly_base_salary = '3500000.01' WHERE id = 'e_a1'"), ['salary_changed']],
            'salary missing' => [static fn (array $w) => $w['db']->execute("UPDATE employees SET monthly_base_salary = NULL WHERE id = 'e_a1'"), ['salary_missing']],
            'archived' => [static fn (array $w) => $w['db']->execute("UPDATE employees SET archived_at = UTC_TIMESTAMP(6) WHERE id = 'e_a1'"), ['employee_archived']],
            'not Active' => [static fn (array $w) => $w['db']->execute("UPDATE employees SET employment_status = 'Inactive' WHERE id = 'e_a1'"), ['employee_not_active']],
            'a newly Approved overtime record' => [static fn (array $w) => $overtime($w['db'], $w['a'], 'e_a1', '2026-10', '1.00', '21875.00'), ['overtime_changed']],
            'a missing link' => [static fn (array $w) => $w['db']->execute('DELETE l FROM payroll_plan_overtime l JOIN payroll_plans p ON p.id = l.payroll_plan_id WHERE p.employee_id = ?', ['e_a1']), ['overtime_changed']],
            'several at once' => [static function (array $w) use ($overtime): void {
                $w['db']->execute("UPDATE employees SET monthly_base_salary = '1.00', archived_at = UTC_TIMESTAMP(6), employment_status = 'Resigned' WHERE id = 'e_a1'");
                $overtime($w['db'], $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
            }, ['employee_archived', 'employee_not_active', 'salary_changed', 'overtime_changed']],
        ];
        foreach ($cases as $label => [$change, $reasons]) {
            $w = $world();
            $overtime($w['db'], $w['a'], 'e_a1', '2026-10', '2.00', '43750.00');
            $p = $ready($w, 'e_a1');
            assertSame(['id' => $p['id'], 'current' => true, 'reasons' => []], $ok($drift($w, $p['id']), 'before: ' . $label)['payrollPlanDrift'], 'current before ' . $label);
            $change($w);
            $d = $ok($drift($w, $p['id']), 'drift: ' . $label)['payrollPlanDrift'];
            assertSame(['id' => $p['id'], 'current' => false, 'reasons' => $reasons], $d, 'the drift read names ' . $label);
            $unchanged($w['db'], $p['id'], static fn () => assertSame([409, 'conflict'], $code($commit($w, $p, $newKey())), 'commit refuses ' . $label . ' (M7, M8, M9)'));
        }
        $w = $world();
        $p = $ready($w, 'e_a1');
        $w['db']->execute("UPDATE employees SET full_name = 'Renamed Fixture', employee_code = 'E-NEW', department = 'Elsewhere', version = version + 1 WHERE id = 'e_a1'");
        assertSame(true, $ok($drift($w, $p['id']), 'renamed')['payrollPlanDrift']['current'], 'a rename is not drift');
        $c = $ok($commit($w, $p, $newKey()), 'a renamed employee commits')['payrollPlan'];
        assertSame(['e_a1', 'Fixture e_a1', 'Operations'], [$c['employeeCode'], $c['employeeName'], $c['department']], 'the obligation keeps the calculated snapshot');
    },
    'after drift, the D-PAY-4 path — return to Draft, generate, approve — commits the recalculated plan' => static function () use ($world, $overtime, $ready, $commit, $step, $generate, $ok, $code, $newKey, $links): void {
        $w = $world();
        $p = $ready($w, 'e_a1');
        $late = $overtime($w['db'], $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        assertSame([409, 'conflict'], $code($commit($w, $p, $newKey())), 'drift');
        $back = $ok($step($w, 'return', $p), 'return')['payrollPlan'];
        $re = $generate($w)['e_a1'];
        assertSame([$back['id'], '3521875.00'], [$re['id'], $re['totalAmount']], 'recalculated with the late approval');
        $r = $ok($step($w, 'approve', $re), 'approve')['payrollPlan'];
        $c = $ok($commit($w, $r, $newKey()), 'commit')['payrollPlan'];
        assertSame(['Committed', '3521875.00'], [$c['status'], $c['totalAmount']]);
        assertSame([$late], $links($w['db'], $p['id']));
    },
    'the drift read: CEO only, read-only, exact { id, current, reasons } — an Employee is 403, another company and an absent plan 404, a Committed or Cancelled plan 409; no input value leaks' => static function () use ($world, $ready, $generate, $step, $commit, $drift, $ok, $code, $counts, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $plans = $generate($w);
        $d = $ok($drift($w, $plans['e_a1']['id']), 'a Draft')['payrollPlanDrift'];
        assertSame(['id', 'current', 'reasons'], array_keys($d), 'exactly the three keys');
        $db->execute("UPDATE employees SET monthly_base_salary = '9876543.21' WHERE id = 'e_a1'");
        $before = $counts($db);
        $snap = $db->select('SELECT * FROM payroll_plans ORDER BY id');
        $r = $drift($w, $plans['e_a1']['id']);
        assertSame(['id' => $plans['e_a1']['id'], 'current' => false, 'reasons' => ['salary_changed']], $ok($r, 'drifted Draft')['payrollPlanDrift']);
        assertNoLeak($r->body, ['9876543.21', '3500000.00', '3500000', 'totalAmount', 'baseSalary', 'e_a1', $w['a'], 'payroll_drift', 'salary_changed_from']);
        assertSame([$before, $snap], [$counts($db), $db->select('SELECT * FROM payroll_plans ORDER BY id')], 'read-only: nothing recalculated, returned or written');
        assertSame([403, 'forbidden'], $code($drift($w, $plans['e_a1']['id'], 'empA1')), 'the owner Employee');
        assertSame([404, 'not_found'], $code($drift($w, $plans['e_a1']['id'], 'ceoB')), 'another company CEO');
        assertSame([404, 'not_found'], $code($drift($w, str_repeat('0', 32))), 'absent');
        $c = $ok($step($w, 'cancel', $plans['e_a3']), 'cancel')['payrollPlan'];
        assertSame([409, 'conflict'], $code($drift($w, $c['id'])), 'Cancelled can no longer be committed');
        $r2 = $ok($step($w, 'approve', $plans['e_a2']), 'approve')['payrollPlan'];
        $ok($commit($w, $r2, $newKey()), 'commit');
        assertSame([409, 'conflict'], $code($drift($w, $r2['id'])), 'Committed is the obligation, never re-judged');
    },
    'Committed is terminal: no transition, no second commit, no generate and no link release touches it (M3, M4)' => static function () use ($world, $overtime, $ready, $commit, $step, $generate, $ok, $code, $row, $links, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $o = $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $c = $ok($commit($w, $ready($w, 'e_a1'), $newKey()), 'commit')['payrollPlan'];
        $before = $row($db, $c['id']);
        foreach (['review', 'approve', 'return', 'cancel'] as $op) {
            assertSame([409, 'conflict'], $code($step($w, $op, $c)), $op . ' on Committed');
        }
        assertSame([409, 'conflict'], $code($commit($w, $c, $newKey(), ['expectedVersion' => $c['version']])), 'commit again');
        $db->execute("UPDATE employees SET monthly_base_salary = '9999999.00', full_name = 'Changed' WHERE id = 'e_a1'");
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '1.00');
        assertSame($c['id'], $generate($w)['e_a1']['id'], 'the Committed plan stays the live plan');
        assertSame($before, $row($db, $c['id']), 'never altered: snapshot, total, key, committed_at, version');
        assertSame([$o], $links($db, $c['id']), 'its links are frozen');
        assertSame(0, $db->execute('DELETE FROM payroll_plan_overtime WHERE company_id = ? AND payroll_plan_id = ? AND EXISTS (SELECT 1 FROM payroll_plans p WHERE p.company_id = payroll_plan_overtime.company_id AND p.id = payroll_plan_overtime.payroll_plan_id AND p.status IN (\'Draft\', \'Reviewed\', \'Ready\'))', [$w['a'], $c['id']]), 'the production release statement matches no link of a Committed plan');
        // Test-only SQL with the production commit predicate: it matches no Committed plan, so its key is never replaced.
        assertSame(0, $db->execute("UPDATE payroll_plans SET status = 'Committed', committed_at = UTC_TIMESTAMP(6), commit_idempotency_key = ?, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND company_id = ? AND version = ? AND status = 'Ready'", [$newKey(), $c['id'], $w['a'], $c['version']]), 'the commit statement cannot replace the key of a Committed plan');
        assertSame($before, $row($db, $c['id']), 'the key and committed_at are unchanged');
    },
    'Employee self-read: their own Committed plans only — list and detail with the frozen overtime; their own Draft, Reviewed, Ready and Cancelled are absent' => static function () use ($world, $overtime, $generate, $step, $ready, $commit, $get, $ok, $code, $newKey): void {
        $w = $world();
        $o = $overtime($w['db'], $w['a'], 'e_a1', '2026-10', '2.50', '54688.00');
        $c = $ok($commit($w, $ready($w, 'e_a1'), $newKey()), 'commit')['payrollPlan'];
        $list = $get($w, 'empA1', '/api/payroll-plans', 'month=2026-10');
        assertSame([$c], $ok($list, 'own list')['payrollPlans'], 'exactly the own Committed plan, the CEO projection');
        $detail = $get($w, 'empA1', '/api/payroll-plan', 'id=' . $c['id']);
        assertSame(['payrollPlan' => $c, 'payrollPlanOvertime' => [['id' => $o, 'hours' => '2.50', 'amount' => '54688.00']]], $ok($detail, 'own detail'));
        assertNoLeak($list->body . $detail->body, ['commit_idempotency_key', 'committed_at', 'e_a2', 'e_a3', $w['a'], 'valuation', '3200000']);
        $nov = $generate($w, '2026-11');
        $draft = $nov['e_a1'];
        $reviewed = $ok($step($w, 'review', $generate($w, '2026-12')['e_a1']), 'review')['payrollPlan'];
        $readyPlan = $ready($w, 'e_a1', '2027-01');
        $cancelled = $ok($step($w, 'cancel', $generate($w, '2027-02')['e_a1']), 'cancel')['payrollPlan'];
        foreach (['Draft' => $draft, 'Reviewed' => $reviewed, 'Ready' => $readyPlan, 'Cancelled' => $cancelled] as $label => $p) {
            assertSame([404, 'not_found'], $code($get($w, 'empA1', '/api/payroll-plan', 'id=' . $p['id'])), 'own ' . $label . ' (M14)');
            assertSame([], $ok($get($w, 'empA1', '/api/payroll-plans', 'month=' . $p['monthKey']), 'own ' . $label . ' month')['payrollPlans'], 'own ' . $label . ' month list');
        }
        assertSame(['e_a1', 'e_a2', 'e_a3'], array_column($ok($get($w, 'ceoA', '/api/payroll-plans', 'month=2026-11'), 'CEO list')['payrollPlans'], 'employeeId'), 'the CEO still reads the whole company month');
    },
    'MU-4 privacy proof with real sessions: no Employee fetches a colleague, another company or a company-wide list through the raw API; every Employee write is 403' => static function () use ($world, $ready, $commit, $get, $post, $drift, $ok, $code, $counts, $newKey): void {
        $w = $world();
        $a1 = $ok($commit($w, $ready($w, 'e_a1'), $newKey()), 'commit A1')['payrollPlan'];
        $a2 = $ok($commit($w, $ready($w, 'e_a2'), $newKey()), 'commit A2')['payrollPlan'];
        $b1 = $ok($commit($w, $ready($w, 'e_b1', '2026-10', 'ceoB'), $newKey(), [], 'ceoB'), 'commit B1')['payrollPlan'];
        assertSame([200, null], $code($get($w, 'empA1', '/api/payroll-plan', 'id=' . $a1['id'])), 'A1 → own Committed');
        assertSame([404, 'not_found'], $code($get($w, 'empA1', '/api/payroll-plan', 'id=' . $a2['id'])), 'A1 → colleague A2 (M15)');
        assertSame([404, 'not_found'], $code($get($w, 'empA2', '/api/payroll-plan', 'id=' . $a1['id'])), 'A2 → colleague A1');
        assertSame([404, 'not_found'], $code($get($w, 'empA1', '/api/payroll-plan', 'id=' . $b1['id'])), 'A1 → another company');
        assertSame([404, 'not_found'], $code($get($w, 'empB1', '/api/payroll-plan', 'id=' . $a1['id'])), 'company-2 Employee → company-1 plan');
        assertSame([404, 'not_found'], $code($get($w, 'empA1', '/api/payroll-plan', 'id=' . bin2hex(random_bytes(16)))), 'a random opaque id');
        assertSame([$a1['id']], array_column($ok($get($w, 'empA1', '/api/payroll-plans', 'month=2026-10'), 'A1 list')['payrollPlans'], 'id'), 'the month list is the own Committed plan only — never company-wide');
        assertSame([$b1['id']], array_column($ok($get($w, 'empB1', '/api/payroll-plans', 'month=2026-10'), 'B1 list')['payrollPlans'], 'id'));
        assertSame(3, count($ok($get($w, 'ceoA', '/api/payroll-plans', 'month=2026-10'), 'CEO list')['payrollPlans']), 'the CEO sees the company');
        $before = $counts($w['db']);
        $target = ['id' => $a1['id'], 'expectedVersion' => $a1['version']];
        foreach (['generate' => ['month' => '2026-10'], 'review' => $target, 'approve' => $target, 'return' => $target, 'cancel' => $target,
            'commit' => $target + ['expectedTotal' => $a1['totalAmount'], 'idempotencyKey' => $newKey()]] as $op => $body) {
            assertSame([403, 'forbidden'], $code($post($w, 'empA1', '/api/payroll-plans/' . $op, $body)), 'A1 ' . $op . ' (M16)');
        }
        assertSame([403, 'forbidden'], $code($drift($w, $a1['id'], 'empA1')), 'A1 drift read');
        assertSame($before, $counts($w['db']), 'nothing written by a refused Employee');
        assertSame([404, 'not_found'], $code($commit($w, $a1, $newKey(), [], 'ceoB')), 'another company CEO cannot commit or probe');
    },
    'the CEO projection is unchanged for Committed plans: the list and detail carry exactly the thirteen keys and no commit or drift field (AFI-4c1 compatibility)' => static function () use ($world, $ready, $commit, $get, $ok, $newKey): void {
        $w = $world();
        $c = $ok($commit($w, $ready($w, 'e_a1'), $newKey()), 'commit')['payrollPlan'];
        foreach ($ok($get($w, 'ceoA', '/api/payroll-plans', 'month=2026-10'), 'list')['payrollPlans'] as $p) {
            assertSame(PayrollView::FIELDS, array_keys($p), 'list keys');
        }
        $d = $ok($get($w, 'ceoA', '/api/payroll-plan', 'id=' . $c['id']), 'detail');
        assertSame(['payrollPlan', 'payrollPlanOvertime'], array_keys($d));
        assertSame(PayrollView::FIELDS, array_keys($d['payrollPlan']), 'detail keys');
    },
    'a failing audit append rolls the commit back entirely: still Ready, no key, no audit; the same key then commits (M11)' => static function () use ($world, $ready, $commit, $ok, $code, $row, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $p = $ready($w, 'e_a1');
        $key = $newKey();
        $snap = $row($db, $p['id']);
        $last = (string) $db->select('SELECT MAX(occurred_at) AS t FROM audit_events')[0]['t'];
        usleep(2000);
        // Test-only DDL: every further audit insert violates this CHECK — inside the commit transaction.
        $db->execute("ALTER TABLE audit_events ADD CONSTRAINT test_block_audit CHECK (occurred_at <= '" . $last . "')");
        try {
            assertSame([500, 'internal_error'], $code($commit($w, $p, $key)), 'commit');
            assertSame($snap, $row($db, $p['id']), 'rolled back: still Ready, no committed_at, no key');
        } finally {
            $db->execute('ALTER TABLE audit_events DROP CONSTRAINT test_block_audit');
        }
        assertSame('Committed', $ok($commit($w, $p, $key), 'the same key after the rollback')['payrollPlan']['status']);
    },
    'finance, overtime and statutory firewalls: a commit changes only its plan row and one audit row — no finance, payment or overtime write; Committed is an obligation, not a payment (M18, M19)' => static function () use ($world, $overtime, $ready, $commit, $ok, $counts, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $p = $ready($w, 'e_a1');
        $before = $counts($db);
        $otBefore = $db->select('SELECT * FROM overtime_records ORDER BY id');
        $empBefore = $db->select('SELECT * FROM employees ORDER BY id');
        $others = $db->select("SELECT * FROM payroll_plans WHERE id <> ? ORDER BY id", [$p['id']]);
        $c = $ok($commit($w, $p, $newKey()), 'commit')['payrollPlan'];
        $after = $counts($db);
        foreach ($after as $table => $n) {
            assertSame(($before[$table] ?? 0) + ($table === 'audit_events' ? 1 : 0), $n, $table);
        }
        assertSame([$otBefore, $empBefore, $others], [$db->select('SELECT * FROM overtime_records ORDER BY id'), $db->select('SELECT * FROM employees ORDER BY id'), $db->select("SELECT * FROM payroll_plans WHERE id <> ? ORDER BY id", [$p['id']])], 'no overtime, employee or other plan write (no revaluation, no status change)');
        // BF-4e authorized revision: the Finance posting table exists, and Commit never writes it (its
        // count is compared above — Commit is not a posting, D-FIN-3 = A). Was: no finance table at all.
        // BF-4f authorized revision: the Finance execution table exists too, and this flow never writes it
        // (its count is compared above). Was: finance_postings the one finance table.
        assertSame([], array_values(array_filter(array_keys($after), static fn (string $t): bool => !in_array($t, ['finance_postings', 'finance_executions'], true) && (bool) preg_match('/finance|transaction|ledger|journal|payment|payslip|bank|cash/', $t))), 'no other finance table exists');
        $cols = array_map(static fn (array $r): string => (string) $r['c'], $db->select("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_plans'"));
        assertSame([], array_values(array_filter($cols, static fn (string $c): bool => (bool) preg_match('/paid|payment|executed|posted|tax|pph|bpjs|thr|allowance|deduction|bonus|benefit|loan|net_|gross/', $c))), 'no paid, posted, executed or statutory column');
        assertSame('Committed', $c['status'], 'Committed — never Paid, Posted or Executed');
    },
];
