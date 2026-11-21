<?php
declare(strict_types=1);

/*
 * PAY-DRIFT-1 (AWP-00 F-01; OD-F01-1 broad; owner decisions D-1..D-5) against the real MariaDB:
 * the CEO drift read also answers for a COMMITTED base plan — the post-commit warning of
 * CLAUDE.md §8.6 — through the one existing route and the one PayrollDrift definition. Read-only:
 * no plan, link, Supplemental, finance or audit row changes. D-3 (approved with modification):
 * Approved overtime is left out of a Committed plan's comparison only when it is linked to a
 * COMMITTED Supplemental document of the same company, base plan, employee and month; Draft,
 * Reviewed, Ready and Cancelled documents and every non-qualifying link never suppress, and the
 * base plan's own linked overtime always stays visible. Fabricated data only.
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
use TamOs\Http\Response;
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
 * Company A: a CEO; e_a1 and e_a2 (Employee logins), e_a3. Company B: a CEO and e_b1 (an Employee
 * login). Every salary is positive.
 *
 * @return array{db: Database, k: Kernel, a: string, b: string, s: array<string, array{token: string, csrf: string}>}
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
    $db->execute("UPDATE employees SET monthly_base_salary = '2000000.00' WHERE id IN ('e_a2', 'e_a3', 'e_b1')");
    $s = [];
    foreach ($fixtures as $name => $f) {
        $r = $k->handle(loginRequest($f['email'], (string) $f['password']), requestId());
        assertSame(200, $r->status, 'login ' . $name);
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken']];
    }
    return ['db' => $db, 'k' => $k, 'a' => $a, 'b' => $ceoB['companyId'], 's' => $s];
};
/** Test-only SQL: an Approved overtime record with a frozen snapshot and $amount — "approved now". */
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
/** $employee's base plan of $month, generated, approved and committed through the real Payroll routes. */
$committed = static function (array $w, string $employee, string $month = '2026-10', string $who = 'ceoA') use ($post, $ok, $newKey): array {
    $plans = [];
    foreach ($ok($post($w, $who, '/api/payroll-plans/generate', ['month' => $month]), 'payroll generate')['payrollPlans'] as $p) {
        $plans[$p['employeeId']] = $p;
    }
    $p = $plans[$employee];
    if ($p['status'] === 'Committed') {
        return $p;
    }
    $p = $ok($post($w, $who, '/api/payroll-plans/approve', ['id' => $p['id'], 'expectedVersion' => $p['version']]), 'payroll approve')['payrollPlan'];
    return $ok($post($w, $who, '/api/payroll-plans/commit', ['id' => $p['id'], 'expectedVersion' => $p['version'], 'expectedTotal' => $p['totalAmount'], 'idempotencyKey' => $newKey()]), 'payroll commit')['payrollPlan'];
};
$drift = static fn (array $w, string $id, string $who = 'ceoA'): Response => $get($w, $who, '/api/payroll-plan/drift', 'id=' . $id);
/** The drift reasons of plan $id for the CEO of company A. */
$reasons = static fn (array $w, string $id) => $ok($drift($w, $id), 'drift')['payrollPlanDrift']['reasons'];
// The Supplemental document through its real routes.
$sGen = static fn (array $w, string $planId): array => $ok($post($w, 'ceoA', '/api/supplemental-payrolls/generate', ['payrollPlanId' => $planId]), 'supplemental generate')['supplementalPayroll'];
$sStep = static fn (array $w, string $op, array $doc): array
    => $ok($post($w, 'ceoA', '/api/supplemental-payrolls/' . $op, ['id' => $doc['id'], 'expectedVersion' => $doc['version']]), 'supplemental ' . $op)['supplementalPayroll'];
$sCommit = static fn (array $w, array $doc): array => $ok($post($w, 'ceoA', '/api/supplemental-payrolls/commit',
    ['id' => $doc['id'], 'expectedVersion' => $doc['version'], 'expectedTotal' => $doc['overtimeAmount'], 'idempotencyKey' => $newKey()]), 'supplemental commit')['supplementalPayroll'];
/**
 * Test-only SQL: a Committed Supplemental document linking $ids, with any combination of base plan,
 * employee and month — the non-qualifying shapes the production routes would never produce.
 */
$fakeCommittedSupplemental = static function (Database $db, string $company, string $planId, string $employee, string $month, array $ids): string {
    $id = bin2hex(random_bytes(16));
    $db->execute("INSERT INTO supplemental_payrolls (id, company_id, payroll_plan_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, overtime_amount, overtime_hours, overtime_count, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Committed', 'FAKE', 'Fixture fake', NULL, '1000.00', '1.00', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), ?, 4, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
        [$id, $company, $planId, $employee, $month, bin2hex(random_bytes(16))]);
    foreach ($ids as $o) {
        $db->execute('INSERT INTO supplemental_payroll_overtime (id, company_id, supplemental_payroll_id, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6))', [$o, $company, $id]);
    }
    return $id;
};
/** Every table's rows — the read-only proof compares the whole database around a read. */
$everything = static function (Database $db): array {
    $out = [];
    foreach ($db->select('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME') as $t) {
        if (in_array((string) $t['t'], ['sessions', 'auth_rate_limits', 'auth_events'], true)) {
            continue;                                       // session bookkeeping of the request itself, not business data
        }
        $out[(string) $t['t']] = $db->select('SELECT * FROM `' . $t['t'] . '` ORDER BY 1');
    }
    return $out;
};

return [
    'a Committed plan is answered: unchanged → current; salary changed → salary_changed; the route and the { id, current, reasons } shape are the existing ones' => static function () use ($world, $committed, $drift, $ok, $reasons): void {
        $w = $world();
        $p = $committed($w, 'e_a1');
        assertSame('Committed', $p['status']);
        assertSame(['id' => $p['id'], 'current' => true, 'reasons' => []], $ok($drift($w, $p['id']), 'unchanged')['payrollPlanDrift'], 'an unchanged Committed plan is current');
        $w['db']->execute("UPDATE employees SET monthly_base_salary = '3650000.00' WHERE id = 'e_a1'");
        assertSame(['salary_changed'], $reasons($w, $p['id']), 'salary drift after commit');
        $w['db']->execute("UPDATE employees SET employment_status = 'Inactive' WHERE id = 'e_a1'");
        assertSame(['employee_not_active', 'salary_changed'], $reasons($w, $p['id']), 'the canonical reason order is kept');
    },
    'read-only after downstream processing: with the plan posted and its payment recorded, the whole database — the plan, its total and links, Supplemental, finance postings and executions, audit — is identical after Committed drift reads; no audit row' => static function () use ($world, $committed, $overtime, $drift, $ok, $post, $everything, $sGen, $sStep, $sCommit): void {
        $w = $world();
        $db = $w['db'];
        $p = $committed($w, 'e_a1');
        $posting = $ok($post($w, 'ceoA', '/api/finance-postings/payroll-plan', ['payrollPlanId' => $p['id'], 'expectedAmount' => $p['totalAmount'], 'idempotencyKey' => bin2hex(random_bytes(16))]), 'post to finance')['financePosting'];
        $ok($post($w, 'ceoA', '/api/finance-executions/execute', ['financePostingId' => $posting['id'], 'expectedAmount' => $posting['amount'], 'executedOn' => '2026-10-05', 'paymentMethod' => 'bankTransfer', 'idempotencyKey' => bin2hex(random_bytes(16))]), 'record payment');
        $late = $overtime($db, $w['a'], 'e_a1', '2026-10', '2.00', '43750.00');
        $sCommit($w, $sStep($w, 'approve', $sStep($w, 'review', $sGen($w, $p['id']))));
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $db->execute("UPDATE employees SET monthly_base_salary = '3700000.00' WHERE id = 'e_a1'");
        $before = $everything($db);
        assertTrue(count($before['finance_postings']) === 1 && count($before['finance_executions']) === 1 && count($before['supplemental_payrolls']) === 1, 'the fixture has a posting, a recorded payment and a Committed Supplemental');
        $r = $drift($w, $p['id']);
        assertSame(['salary_changed', 'overtime_changed'], $ok($r, 'drift')['payrollPlanDrift']['reasons'], 'drifted Committed plan');
        $drift($w, $p['id']);
        assertSame($before, $everything($db), 'nothing written by two reads');
        assertNoLeak($r->body, ['3700000.00', '3500000.00', '21875', '43750', $late, 'totalAmount', 'payroll_drift', $w['a']]);
    },
    'uncovered overtime: late Approved overtime of the month with no Supplemental document is overtime_changed' => static function () use ($world, $committed, $overtime, $reasons): void {
        $w = $world();
        $p = $committed($w, 'e_a1');
        $overtime($w['db'], $w['a'], 'e_a1', '2026-10', '2.00', '43750.00');
        assertSame(['overtime_changed'], $reasons($w, $p['id']));
    },
    'Supplemental Draft, Reviewed and Ready never suppress; Committed suppresses exactly the overtime it settles; Cancelled does not suppress' => static function () use ($world, $committed, $overtime, $reasons, $sGen, $sStep, $sCommit): void {
        $w = $world();
        $db = $w['db'];
        $p = $committed($w, 'e_a1');
        $overtime($db, $w['a'], 'e_a1', '2026-10', '2.00', '43750.00');
        $d = $sGen($w, $p['id']);
        assertSame(['overtime_changed'], $reasons($w, $p['id']), 'Draft');
        $d = $sStep($w, 'review', $d);
        assertSame(['overtime_changed'], $reasons($w, $p['id']), 'Reviewed');
        $d = $sStep($w, 'approve', $d);
        assertSame(['overtime_changed'], $reasons($w, $p['id']), 'Ready');
        $sCommit($w, $d);
        assertSame([], $reasons($w, $p['id']), 'Committed Supplemental settles its overtime');
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        assertSame(['overtime_changed'], $reasons($w, $p['id']), 'newer overtime the Committed document does not contain still drifts');
        // a second wave cancelled: Cancelled never suppresses
        $d2 = $sGen($w, $p['id']);
        $sStep($w, 'cancel', $d2);
        assertSame(['overtime_changed'], $reasons($w, $p['id']), 'Cancelled');
    },
    'non-qualifying Committed Supplemental links never suppress: another employee, another month, an unrelated base plan; another company is impossible by the composite keys' => static function () use ($world, $committed, $overtime, $reasons, $fakeCommittedSupplemental): void {
        $w = $world();
        $db = $w['db'];
        $p = $committed($w, 'e_a1');
        $p2 = $committed($w, 'e_a2');
        $pNov = $committed($w, 'e_a1', '2026-11');
        $late = $overtime($db, $w['a'], 'e_a1', '2026-10', '2.00', '43750.00');
        $fakeCommittedSupplemental($db, $w['a'], $p['id'], 'e_a2', '2026-10', [$late]);
        assertSame(['overtime_changed'], $reasons($w, $p['id']), 'another employee');
        $db->execute('DELETE FROM supplemental_payroll_overtime');
        $fakeCommittedSupplemental($db, $w['a'], $p['id'], 'e_a1', '2026-11', [$late]);
        assertSame(['overtime_changed'], $reasons($w, $p['id']), 'another month');
        $db->execute('DELETE FROM supplemental_payroll_overtime');
        $fakeCommittedSupplemental($db, $w['a'], $p2['id'], 'e_a1', '2026-10', [$late]);
        assertSame(['overtime_changed'], $reasons($w, $p['id']), 'an unrelated base plan (another employee\'s plan)');
        $db->execute('DELETE FROM supplemental_payroll_overtime');
        $fakeCommittedSupplemental($db, $w['a'], $pNov['id'], 'e_a1', '2026-10', [$late]);
        assertSame(['overtime_changed'], $reasons($w, $p['id']), 'an unrelated base plan (the same employee\'s other month)');
        $db->execute('DELETE FROM supplemental_payroll_overtime');
        $fakeCommittedSupplemental($db, $w['a'], $p['id'], 'e_a1', '2026-10', [$late]);
        assertSame([], $reasons($w, $p['id']), 'control: the qualifying link suppresses');
        $bPlan = $committed($w, 'e_b1', '2026-10', 'ceoB');
        $refused = false;
        try {
            $fakeCommittedSupplemental($db, $w['b'], $bPlan['id'], 'e_b1', '2026-10', [$late]);
        } catch (\Throwable) {
            $refused = true;
        }
        assertTrue($refused, 'a company B link to a company A overtime record is refused by the composite foreign key');
        assertSame([], $reasons($w, $p['id']), 'company A answer unchanged');
    },
    'the base plan\'s own linked overtime always stays visible, even when a Committed Supplemental links the same record' => static function () use ($world, $committed, $overtime, $reasons, $fakeCommittedSupplemental): void {
        $w = $world();
        $db = $w['db'];
        $own = $overtime($db, $w['a'], 'e_a1', '2026-10', '10.00', '200000.00');
        $p = $committed($w, 'e_a1');
        assertSame('200000.00', $p['overtimeAmount'], 'the base plan counts its own overtime');
        $fakeCommittedSupplemental($db, $w['a'], $p['id'], 'e_a1', '2026-10', [$own]);
        assertSame([], $reasons($w, $p['id']), 'unchanged own overtime is current');
        $db->execute("UPDATE overtime_records SET approved_amount = '250000.00' WHERE id = ?", [$own]);
        assertSame(['overtime_changed'], $reasons($w, $p['id']), 'a changed amount of the plan\'s own overtime is detected');
        $db->execute("UPDATE overtime_records SET approved_amount = '200000.00' WHERE id = ?", [$own]);
        assertSame([], $reasons($w, $p['id']), 'restored');
        $db->execute("UPDATE overtime_records SET status = 'Rejected', valuation_method = NULL, valuation_salary = NULL, valuation_standard_hours = NULL, approved_amount = NULL, approved_at = NULL WHERE id = ?", [$own]);
        assertSame(['overtime_changed'], $reasons($w, $p['id']), 'the plan\'s own overtime no longer Approved is detected');
    },
    'access control is unchanged on a Committed plan: the owner Employee 403, another company 404; a Cancelled plan is still 409' => static function () use ($world, $committed, $drift, $code, $post, $ok): void {
        $w = $world();
        $p = $committed($w, 'e_a1');
        assertSame([403, 'forbidden'], $code($drift($w, $p['id'], 'empA1')), 'the owner Employee');
        assertSame([403, 'forbidden'], $code($drift($w, $p['id'], 'empA2')), 'a colleague');
        assertSame([404, 'not_found'], $code($drift($w, $p['id'], 'ceoB')), 'another company CEO');
        $plans = [];
        foreach ($ok($post($w, 'ceoA', '/api/payroll-plans/generate', ['month' => '2026-10']), 'generate')['payrollPlans'] as $q) {
            $plans[$q['employeeId']] = $q;
        }
        $c = $ok($post($w, 'ceoA', '/api/payroll-plans/cancel', ['id' => $plans['e_a3']['id'], 'expectedVersion' => $plans['e_a3']['version']]), 'cancel')['payrollPlan'];
        assertSame([409, 'conflict'], $code($drift($w, $c['id'])), 'Cancelled');
    },
];
