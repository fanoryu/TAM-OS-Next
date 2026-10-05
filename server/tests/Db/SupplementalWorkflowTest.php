<?php
declare(strict_types=1);

/*
 * BF-4d Supplemental Payroll against the real MariaDB (owner decisions D-SPAY-1..4 = A): real
 * login → real session → production routes → SupplementalService → SupplementalStore / AuditLog.
 * A base plan is committed through the real Payroll routes; overtime that becomes Approved after
 * that (test-only SQL: an Approved row with a frozen amount) is late. Generate (a Draft of exactly
 * the late overtime, the base plan's frozen snapshot, recalculation and the no-op, Reviewed and
 * Ready frozen, every refusal), the lifecycle matrix, versioning, Return keeping and Cancel
 * releasing the captured overtime, later waves, Commit (the exact total, the revalidated frozen
 * links, never absorbing newer overtime, the idempotent replay and every mismatch, a refused or
 * failed commit never consuming its key), the reads and the Employee's own-Committed-only privacy,
 * the eligibility read, audit and its rollback, and the base Payroll, overtime, finance and
 * statutory firewalls. Fabricated data only.
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
use TamOs\Http\Response;
use TamOs\Payroll\PayrollView;
use TamOs\Supplemental\SupplementalView;
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
 * login). Every salary is positive, so the Payroll generate makes a plan for each.
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
/** $employee's base plan of $month, generated, approved and committed through the real Payroll routes by $who. */
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
$gen = static fn (array $w, string $planId, string $who = 'ceoA'): Response => $post($w, $who, '/api/supplemental-payrolls/generate', ['payrollPlanId' => $planId]);
$step = static fn (array $w, string $op, array $doc, string $who = 'ceoA'): Response
    => $post($w, $who, '/api/supplemental-payrolls/' . $op, ['id' => $doc['id'], 'expectedVersion' => $doc['version']]);
$commitBody = static fn (array $doc, string $key, array $over = []): array
    => $over + ['id' => $doc['id'], 'expectedVersion' => $doc['version'], 'expectedTotal' => $doc['overtimeAmount'], 'idempotencyKey' => $key];
$commit = static fn (array $w, array $doc, string $key, array $over = [], string $who = 'ceoA'): Response
    => $post($w, $who, '/api/supplemental-payrolls/commit', $commitBody($doc, $key, $over));
/** A document driven from Draft to Ready (review, approve). */
$ready = static function (array $w, array $doc) use ($step, $ok): array {
    $doc = $ok($step($w, 'review', $doc), 'review')['supplementalPayroll'];
    return $ok($step($w, 'approve', $doc), 'approve')['supplementalPayroll'];
};
$row = static fn (Database $db, string $id): array => array_map(static fn ($v) => $v === null ? null : (string) $v,
    $db->select('SELECT * FROM supplemental_payrolls WHERE id = ?', [$id])[0]);
$audits = static fn (Database $db, string $id): array => array_map(static fn (array $r): string => (string) $r['operation'],
    $db->select("SELECT operation FROM audit_events WHERE action = 'supplemental.manage' AND entity_id = ? ORDER BY id", [$id]));
$links = static function (Database $db, string $id): array {
    $out = array_map(static fn (array $r): string => (string) $r['id'], $db->select('SELECT id FROM supplemental_payroll_overtime WHERE supplemental_payroll_id = ?', [$id]));
    sort($out, SORT_STRING);
    return $out;
};
$sorted = static function (array $ids): array {
    sort($ids, SORT_STRING);
    return $ids;
};
/** Every table's row count. */
$counts = static function (Database $db): array {
    $out = [];
    foreach ($db->select('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME') as $t) {
        $out[(string) $t['t']] = (int) $db->select('SELECT COUNT(*) AS n FROM `' . $t['t'] . '`')[0]['n'];
    }
    return $out;
};
/** The base Payroll and overtime state Supplemental must never write. */
$base = static fn (Database $db): array => [$db->select('SELECT * FROM payroll_plans ORDER BY id'), $db->select('SELECT * FROM payroll_plan_overtime ORDER BY id'), $db->select('SELECT * FROM overtime_records ORDER BY id'), $db->select('SELECT * FROM employees ORDER BY id')];
/** Asserts a refused request changed nothing: every row count and the document, its links and its audit rows. */
$unchanged = static function (Database $db, ?string $id, Closure $fn) use ($row, $links, $audits, $counts): void {
    $before = [$counts($db), $id === null ? null : [$row($db, $id), $links($db, $id), $audits($db, $id)]];
    $fn();
    assertSame($before, [$counts($db), $id === null ? null : [$row($db, $id), $links($db, $id), $audits($db, $id)]], 'nothing written');
};

return [
    'generate: a Committed plan with late Approved overtime gets a version 1 Draft of exactly that overtime — the base plan snapshot, its links, one create audit; base Payroll and overtime untouched (M4, M5, M6, M8)' => static function () use ($world, $overtime, $committed, $gen, $get, $ok, $links, $audits, $base, $sorted): void {
        $w = $world();
        $db = $w['db'];
        $o1 = $overtime($db, $w['a'], 'e_a1', '2026-10', '10.00', '200000.00');
        $p = $committed($w, 'e_a1');
        assertSame('200000.00', $p['overtimeAmount'], 'o1 is in the base plan');
        $o2 = $overtime($db, $w['a'], 'e_a1', '2026-10', '2.50', '54688.00');
        $o3 = $overtime($db, $w['a'], 'e_a1', '2026-10', '0.25', '1.00');
        $overtime($db, $w['a'], 'e_a1', '2026-11', '1.00', '21875.00');
        $overtime($db, $w['a'], 'e_a2', '2026-10', '1.00', '12500.00');
        $db->execute("UPDATE employees SET full_name = 'Renamed Later', department = 'Elsewhere' WHERE id = 'e_a1'");
        $before = $base($db);
        $out = $ok($gen($w, $p['id']), 'generate');
        assertSame(['supplementalPayroll'], array_keys($out));
        $d = $out['supplementalPayroll'];
        assertSame(SupplementalView::FIELDS, array_keys($d), 'exactly the twelve document keys');
        assertSame([$p['id'], 'e_a1', '2026-10', 'Draft', $p['employeeCode'], 'Fixture e_a1', 'Operations', '54689.00', '2.75', 2, 1],
            [$d['payrollPlanId'], $d['employeeId'], $d['monthKey'], $d['status'], $d['employeeCode'], $d['employeeName'], $d['department'], $d['overtimeAmount'], $d['overtimeHours'], $d['overtimeCount'], $d['version']],
            'the late overtime only; the base plan snapshot, never the current employee');
        assertSame($sorted([$o2, $o3]), $links($db, $d['id']), 'exactly the late overtime is captured — never o1 (M8)');
        assertSame(['create'], $audits($db, $d['id']));
        $a = $db->select("SELECT action, entity, operation, fields, target_user_id FROM audit_events WHERE entity_id = ?", [$d['id']])[0];
        assertSame(['supplemental.manage', 'supplementalPayroll', 'create', null, null], [$a['action'], $a['entity'], $a['operation'], $a['fields'], $a['target_user_id']], 'one row, no field, no value');
        assertSame($before, $base($db), 'no base plan, base link, overtime or employee write');
        $detail = $ok($get($w, 'ceoA', '/api/supplemental-payroll', 'id=' . $d['id']), 'detail');
        assertSame(['supplementalPayroll', 'supplementalPayrollOvertime'], array_keys($detail));
        assertSame($d, $detail['supplementalPayroll']);
        $lines = $detail['supplementalPayrollOvertime'];
        assertSame($sorted([$o2, $o3]), array_column($lines, 'id'));
        foreach ($lines as $l) {
            assertSame(['id', 'hours', 'amount'], array_keys($l));
            assertSame($l['id'] === $o2 ? ['2.50', '54688.00'] : ['0.25', '1.00'], [$l['hours'], $l['amount']], 'the frozen amount and hours');
        }
        assertTrue(!in_array($o1, array_column($lines, 'id'), true), 'never the base-linked overtime');
    },
    'generate refuses a base plan that is not Committed (409), an absent or foreign plan (404), nothing eligible (409) and a zero total (409) — writing nothing (M3, M10)' => static function () use ($world, $overtime, $committed, $gen, $post, $ok, $code, $unchanged): void {
        $w = $world();
        $db = $w['db'];
        $plans = [];
        foreach ($ok($post($w, 'ceoA', '/api/payroll-plans/generate', ['month' => '2026-09']), 'payroll generate')['payrollPlans'] as $q) {
            $plans[$q['employeeId']] = $q;
        }
        $overtime($db, $w['a'], 'e_a1', '2026-09', '1.00', '21875.00');
        $overtime($db, $w['a'], 'e_a2', '2026-09', '1.00', '21875.00');
        $overtime($db, $w['a'], 'e_a3', '2026-09', '1.00', '21875.00');
        $reviewed = $ok($post($w, 'ceoA', '/api/payroll-plans/review', ['id' => $plans['e_a2']['id'], 'expectedVersion' => $plans['e_a2']['version']]), 'review')['payrollPlan'];
        $readyPlan = $ok($post($w, 'ceoA', '/api/payroll-plans/approve', ['id' => $plans['e_a3']['id'], 'expectedVersion' => $plans['e_a3']['version']]), 'approve')['payrollPlan'];
        foreach (['Draft' => $plans['e_a1'], 'Reviewed' => $reviewed, 'Ready' => $readyPlan] as $label => $q) {
            $unchanged($db, null, static fn () => assertSame([409, 'conflict'], $code($gen($w, $q['id'])), $label . ' base plan (M3)'));
        }
        $cancelled = $ok($post($w, 'ceoA', '/api/payroll-plans/cancel', ['id' => $plans['e_a1']['id'], 'expectedVersion' => $plans['e_a1']['version']]), 'cancel')['payrollPlan'];
        $unchanged($db, null, static fn () => assertSame([409, 'conflict'], $code($gen($w, $cancelled['id'])), 'Cancelled base plan'));
        $p = $committed($w, 'e_a1');
        $unchanged($db, null, static fn () => assertSame([409, 'conflict'], $code($gen($w, $p['id'])), 'nothing late: nothing eligible'));
        $overtime($db, $w['a'], 'e_a1', '2026-10', '0.25', '0.00');
        $unchanged($db, null, static fn () => assertSame([409, 'conflict'], $code($gen($w, $p['id'])), 'a zero total is never a document (M10)'));
        $unchanged($db, null, static fn () => assertSame([404, 'not_found'], $code($gen($w, bin2hex(random_bytes(16)))), 'absent'));
        $pb = $committed($w, 'e_b1', '2026-10', 'ceoB');
        $overtime($db, $w['b'], 'e_b1', '2026-10', '1.00', '12500.00');
        $unchanged($db, null, static fn () => assertSame([404, 'not_found'], $code($gen($w, $pb['id'])), "another company's plan is absent"));
        assertSame('Draft', $ok($gen($w, $pb['id'], 'ceoB'), 'its own company')['supplementalPayroll']['status']);
    },
    'generate on an open Draft recalculates to the current eligible set (version + 1, links replaced, one recalculate audit); unchanged inputs are a no-op — no write, no audit, same version' => static function () use ($world, $overtime, $committed, $gen, $ok, $links, $audits, $row, $sorted): void {
        $w = $world();
        $db = $w['db'];
        $p = $committed($w, 'e_a1');
        $o2 = $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $d = $ok($gen($w, $p['id']), 'generate')['supplementalPayroll'];
        $snap = $row($db, $d['id']);
        $again = $ok($gen($w, $p['id']), 'no-op')['supplementalPayroll'];
        assertSame([$d, $snap, ['create']], [$again, $row($db, $d['id']), $audits($db, $d['id'])], 'nothing differs: no write, no audit, same version');
        $o3 = $overtime($db, $w['a'], 'e_a1', '2026-10', '2.00', '43750.00');
        $r = $ok($gen($w, $p['id']), 'recalculate')['supplementalPayroll'];
        assertSame([$d['id'], 'Draft', 2, '65625.00', '3.00', 2], [$r['id'], $r['status'], $r['version'], $r['overtimeAmount'], $r['overtimeHours'], $r['overtimeCount']], 'the same document, recalculated once');
        assertSame($sorted([$o2, $o3]), $links($db, $d['id']));
        assertSame(['create', 'recalculate'], $audits($db, $d['id']));
        assertSame(1, (int) $db->select("SELECT COUNT(*) AS n FROM supplemental_payrolls WHERE payroll_plan_id = ?", [$p['id']])[0]['n'], 'never a second document');
    },
    'Reviewed and Ready are frozen: generate returns them untouched and never absorbs newer overtime (M13, M14)' => static function () use ($world, $overtime, $committed, $gen, $step, $ok, $links, $audits, $row): void {
        $w = $world();
        $db = $w['db'];
        $p = $committed($w, 'e_a1');
        $o2 = $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $d = $ok($step($w, 'review', $ok($gen($w, $p['id']), 'generate')['supplementalPayroll']), 'review')['supplementalPayroll'];
        $overtime($db, $w['a'], 'e_a1', '2026-10', '2.00', '43750.00');
        $snap = [$row($db, $d['id']), $links($db, $d['id']), $audits($db, $d['id'])];
        assertSame($d, $ok($gen($w, $p['id']), 'generate on Reviewed')['supplementalPayroll'], 'Reviewed returned untouched');
        assertSame($snap, [$row($db, $d['id']), $links($db, $d['id']), $audits($db, $d['id'])], 'no recalculation (M13)');
        $r = $ok($step($w, 'approve', $d), 'approve')['supplementalPayroll'];
        $overtime($db, $w['a'], 'e_a1', '2026-10', '3.00', '65625.00');
        $snap = [$row($db, $r['id']), $links($db, $r['id']), $audits($db, $r['id'])];
        assertSame($r, $ok($gen($w, $p['id']), 'generate on Ready')['supplementalPayroll'], 'Ready returned untouched');
        assertSame($snap, [$row($db, $r['id']), $links($db, $r['id']), $audits($db, $r['id'])], 'no recalculation (M14)');
        assertSame([$o2], $links($db, $r['id']), 'the frozen set');
    },
    'D-SPAY-2: an archived, non-Active or salary-less employee still gets late Approved overtime settled' => static function () use ($world, $overtime, $committed, $gen, $ok): void {
        $w = $world();
        $db = $w['db'];
        $p = $committed($w, 'e_a1');
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $db->execute("UPDATE employees SET archived_at = UTC_TIMESTAMP(6), employment_status = 'Resigned', monthly_base_salary = NULL WHERE id = 'e_a1'");
        $d = $ok($gen($w, $p['id']), 'generate for a departed employee')['supplementalPayroll'];
        assertSame(['Draft', '21875.00', 'Fixture e_a1'], [$d['status'], $d['overtimeAmount'], $d['employeeName']], 'eligible: the work was already approved; the snapshot is the base plan');
    },
    'the lifecycle matrix: exactly the authorized transitions succeed (version + 1, one audit row of the operation); every other one is 409 and changes nothing; a stale version is 409 (M17, M18, M19, M20)' => static function () use ($world, $overtime, $committed, $gen, $step, $ready, $commit, $ok, $code, $unchanged, $audits, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $month = 0;
        $fresh = static function (string $status) use ($w, $db, $overtime, $committed, $gen, $step, $ready, $commit, $ok, $newKey, &$month): array {
            $m = sprintf('%04d-%02d', 2020 + intdiv($month, 12), $month % 12 + 1);
            $month++;
            $p = $committed($w, 'e_a1', $m);
            $overtime($db, $w['a'], 'e_a1', $m, '1.00', '21875.00');
            $d = $ok($gen($w, $p['id']), 'generate')['supplementalPayroll'];
            return match ($status) {
                'Draft' => $d,
                'Reviewed' => $ok($step($w, 'review', $d), 'review')['supplementalPayroll'],
                'Ready' => $ready($w, $d),
                'Committed' => $ok($commit($w, $ready($w, $d), $newKey()), 'commit')['supplementalPayroll'],
                'Cancelled' => $ok($step($w, 'cancel', $d), 'cancel')['supplementalPayroll'],
            };
        };
        $graph = ['review' => ['Draft' => 'Reviewed'], 'approve' => ['Reviewed' => 'Ready'], 'return' => ['Reviewed' => 'Draft', 'Ready' => 'Draft'],
            'cancel' => ['Draft' => 'Cancelled', 'Reviewed' => 'Cancelled', 'Ready' => 'Cancelled']];
        foreach (['Draft', 'Reviewed', 'Ready', 'Committed', 'Cancelled'] as $from) {
            $d = $fresh($from);
            foreach ($graph as $op => $edges) {
                if (isset($edges[$from])) {
                    continue;
                }
                $unchanged($db, $d['id'], static fn () => assertSame([409, 'conflict'], $code($step($w, $op, $d)), $op . ' from ' . $from . ' is not a transition'));
            }
            foreach ($graph as $op => $edges) {
                if (!isset($edges[$from])) {
                    continue;
                }
                $stale = $d;
                $stale['version'] = $d['version'] + 1;
                $unchanged($db, $d['id'], static fn () => assertSame([409, 'conflict'], $code($step($w, $op, $stale)), $op . ' with a stale version (M20)'));
                if ($d['version'] > 1) {
                    $stale['version'] = $d['version'] - 1;
                    $unchanged($db, $d['id'], static fn () => assertSame([409, 'conflict'], $code($step($w, $op, $stale)), $op . ' with an older version (M20)'));
                }
                $before = $audits($db, $d['id']);
                $t = $ok($step($w, $op, $d), $op . ' from ' . $from)['supplementalPayroll'];
                assertSame([$edges[$from], $d['version'] + 1], [$t['status'], $t['version']], $op . ' from ' . $from . ': one version step');
                assertSame(array_merge($before, [$op]), $audits($db, $d['id']), 'one ' . $op . ' audit row');
                $d = $fresh($from);
            }
        }
    },
    'Return to Draft keeps the captured overtime; Cancel releases it, and the next generate captures it again in a new document (M15, M16)' => static function () use ($world, $overtime, $committed, $gen, $step, $ready, $ok, $links, $sorted): void {
        $w = $world();
        $db = $w['db'];
        $p = $committed($w, 'e_a1');
        $o2 = $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $o3 = $overtime($db, $w['a'], 'e_a1', '2026-10', '0.50', '10938.00');
        $d = $ready($w, $ok($gen($w, $p['id']), 'generate')['supplementalPayroll']);
        $back = $ok($step($w, 'return', $d), 'return')['supplementalPayroll'];
        assertSame(['Draft', $sorted([$o2, $o3])], [$back['status'], $links($db, $d['id'])], 'Return keeps the links (M15)');
        $o4 = $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $again = $ok($gen($w, $p['id']), 'generate after Return')['supplementalPayroll'];
        assertSame([$d['id'], '54688.00', 3], [$again['id'], $again['overtimeAmount'], $again['overtimeCount']], 'the next generate recalculates the same Draft');
        $gone = $ok($step($w, 'cancel', $again), 'cancel')['supplementalPayroll'];
        assertSame(['Cancelled', []], [$gone['status'], $links($db, $d['id'])], 'Cancel releases every link (M16)');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM overtime_records WHERE id IN (?, ?, ?) AND status <> \'Approved\'', [$o2, $o3, $o4])[0]['n'], 'the source overtime is untouched');
        $next = $ok($gen($w, $p['id']), 'generate after Cancel')['supplementalPayroll'];
        assertTrue($next['id'] !== $d['id'] && $next['version'] === 1 && $next['status'] === 'Draft', 'a new document');
        assertSame($sorted([$o2, $o3, $o4]), $links($db, $next['id']), 'the released overtime is captured again');
    },
    'commit: Ready → Committed — the same twelve keys at version + 1, committed_at and the key stored, one commit audit row; links frozen; base Payroll untouched' => static function () use ($world, $overtime, $committed, $gen, $ready, $commit, $ok, $row, $audits, $links, $base, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $p = $committed($w, 'e_a1');
        $o2 = $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $d = $ready($w, $ok($gen($w, $p['id']), 'generate')['supplementalPayroll']);
        $key = $newKey();
        $before = $row($db, $d['id']);
        $baseBefore = $base($db);
        $c = $ok($commit($w, $d, $key), 'commit');
        assertSame(['supplementalPayroll'], array_keys($c));
        $q = $c['supplementalPayroll'];
        assertSame(SupplementalView::FIELDS, array_keys($q));
        assertSame(['Committed', $d['version'] + 1, '21875.00', '1.00', 1], [$q['status'], $q['version'], $q['overtimeAmount'], $q['overtimeHours'], $q['overtimeCount']]);
        $after = $row($db, $d['id']);
        assertTrue($before['committed_at'] === null && $after['committed_at'] !== null, 'committed_at is the database clock');
        assertSame($key, $after['commit_idempotency_key'], 'the key is stored');
        foreach (['payroll_plan_id', 'employee_id', 'month_key', 'employee_code_snapshot', 'employee_name_snapshot', 'department_snapshot', 'overtime_amount', 'overtime_hours', 'overtime_count', 'calculated_at', 'created_at'] as $col) {
            assertSame($before[$col], $after[$col], $col . ' is frozen');
        }
        assertSame(['create', 'review', 'approve', 'commit'], $audits($db, $d['id']));
        assertSame([$o2], $links($db, $d['id']));
        assertSame($baseBefore, $base($db), 'the Committed base plan, its links and overtime are untouched');
    },
    'commit refuses Draft and Reviewed, a stale version, a different expectedTotal, an absent or foreign document — none consumes the key, which then commits (M17, M20, M21, M26)' => static function () use ($world, $overtime, $committed, $gen, $step, $commit, $ok, $code, $unchanged, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $p = $committed($w, 'e_a1');
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $d = $ok($gen($w, $p['id']), 'generate')['supplementalPayroll'];
        $key = $newKey();
        $unchanged($db, $d['id'], static fn () => assertSame([409, 'conflict'], $code($commit($w, $d, $key)), 'a Draft never commits (M17)'));
        $d = $ok($step($w, 'review', $d), 'review')['supplementalPayroll'];
        $unchanged($db, $d['id'], static fn () => assertSame([409, 'conflict'], $code($commit($w, $d, $key)), 'a Reviewed document never commits'));
        $d = $ok($step($w, 'approve', $d), 'approve')['supplementalPayroll'];
        $unchanged($db, $d['id'], static fn () => assertSame([409, 'conflict'], $code($commit($w, $d, $key, ['expectedVersion' => $d['version'] - 1])), 'stale version (M20)'));
        $unchanged($db, $d['id'], static fn () => assertSame([409, 'conflict'], $code($commit($w, $d, $key, ['expectedTotal' => '21874.00'])), 'a different total (M21)'));
        $unchanged($db, $d['id'], static fn () => assertSame([409, 'conflict'], $code($commit($w, $d, $key, ['expectedTotal' => '0.00'])), 'a zero total'));
        $unchanged($db, $d['id'], static fn () => assertSame([404, 'not_found'], $code($commit($w, $d, $key, ['id' => bin2hex(random_bytes(16))])), 'absent'));
        $unchanged($db, $d['id'], static fn () => assertSame([404, 'not_found'], $code($commit($w, $d, $key, [], 'ceoB')), 'another company'));
        $c = $ok($commit($w, $d, $key), 'the same key commits after every refusal (M26)')['supplementalPayroll'];
        assertSame('Committed', $c['status']);
    },
    'the idempotent replay: the same key and body answers the same Committed document with no write and no audit; every mismatched reuse is 409 (M23, M24, M25)' => static function () use ($world, $overtime, $committed, $gen, $ready, $commit, $ok, $code, $unchanged, $row, $audits, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $p = $committed($w, 'e_a1');
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $d = $ready($w, $ok($gen($w, $p['id']), 'generate')['supplementalPayroll']);
        $key = $newKey();
        $c = $ok($commit($w, $d, $key), 'commit')['supplementalPayroll'];
        $snap = [$row($db, $d['id']), $audits($db, $d['id'])];
        $unchanged($db, $d['id'], static fn () => assertSame($c, $ok($commit($w, $d, $key), 'replay')['supplementalPayroll'], 'the original Committed document (M23, M24)'));
        assertSame($snap, [$row($db, $d['id']), $audits($db, $d['id'])]);
        $unchanged($db, $d['id'], static fn () => assertSame([409, 'conflict'], $code($commit($w, $d, $key, ['expectedTotal' => '21876.00'])), 'the key with another total (M25)'));
        $unchanged($db, $d['id'], static fn () => assertSame([409, 'conflict'], $code($commit($w, $d, $key, ['expectedVersion' => $d['version'] + 1])), 'the key with another version (M25)'));
        $unchanged($db, $d['id'], static fn () => assertSame([409, 'conflict'], $code($commit($w, $d, $newKey())), 'a Committed document with a new key'));
        $overtime($db, $w['a'], 'e_a1', '2026-10', '2.00', '43750.00');
        $e = $ready($w, $ok($gen($w, $p['id']), 'the next wave')['supplementalPayroll']);
        $unchanged($db, $e['id'], static fn () => assertSame([409, 'conflict'], $code($commit($w, $e, $key)), 'the key on another document (M25)'));
        $pk = $committed($w, 'e_a2');
        $payrollKey = (string) $db->select('SELECT commit_idempotency_key AS k FROM payroll_plans WHERE id = ?', [$pk['id']])[0]['k'];
        assertSame('Committed', $ok($commit($w, $e, $payrollKey), 'a base Payroll key is a separate namespace')['supplementalPayroll']['status']);
    },
    'commit never absorbs overtime approved after the document froze; that overtime is the next wave — several Committed documents per base plan (M22)' => static function () use ($world, $overtime, $committed, $gen, $ready, $commit, $ok, $get, $links, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $p = $committed($w, 'e_a1');
        $o2 = $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $d = $ready($w, $ok($gen($w, $p['id']), 'generate')['supplementalPayroll']);
        $o3 = $overtime($db, $w['a'], 'e_a1', '2026-10', '2.00', '43750.00');
        $c = $ok($commit($w, $d, $newKey()), 'commit')['supplementalPayroll'];
        assertSame(['21875.00', 1, [$o2]], [$c['overtimeAmount'], $c['overtimeCount'], $links($db, $d['id'])], 'the frozen set only (M22)');
        $e = $ok($gen($w, $p['id']), 'the next wave')['supplementalPayroll'];
        assertTrue($e['id'] !== $d['id'], 'a new document');
        assertSame(['43750.00', [$o3]], [$e['overtimeAmount'], $links($db, $e['id'])], 'exactly the newer overtime');
        $f = $ok($commit($w, $ready($w, $e), $newKey()), 'commit the second wave')['supplementalPayroll'];
        $list = $ok($get($w, 'ceoA', '/api/supplemental-payrolls', 'month=2026-10'), 'list')['supplementalPayrolls'];
        assertSame([$c['id'], $f['id']], array_values(array_map(static fn (array $s): string => $s['id'], array_filter($list, static fn (array $s): bool => $s['payrollPlanId'] === $p['id']))), 'two Committed documents for one base plan');
    },
    'commit revalidates the frozen links: a tampered amount, a lost link or a link to base-linked overtime is 409 and consumes no key' => static function () use ($world, $overtime, $committed, $gen, $ready, $commit, $ok, $code, $unchanged, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $o1 = $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $p = $committed($w, 'e_a1');
        $o2 = $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $d = $ready($w, $ok($gen($w, $p['id']), 'generate')['supplementalPayroll']);
        $key = $newKey();
        // Test-only SQL: each tamper is undone before the next.
        $db->execute("UPDATE supplemental_payrolls SET overtime_amount = '1.00' WHERE id = ?", [$d['id']]);
        $unchanged($db, $d['id'], static fn () => assertSame([409, 'conflict'], $code($commit($w, $d, $key, ['expectedTotal' => '1.00'])), 'a stored amount the links do not sum to'));
        $db->execute("UPDATE supplemental_payrolls SET overtime_amount = '43750.00' WHERE id = ?", [$d['id']]);
        $db->execute('DELETE FROM supplemental_payroll_overtime WHERE id = ?', [$o2]);
        $unchanged($db, $d['id'], static fn () => assertSame([409, 'conflict'], $code($commit($w, $d, $key)), 'a lost link'));
        $db->execute('INSERT INTO supplemental_payroll_overtime (id, company_id, supplemental_payroll_id, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6))', [$o1, $w['a'], $d['id']]);
        $db->execute("UPDATE supplemental_payrolls SET overtime_count = 2 WHERE id = ?", [$d['id']]);
        $unchanged($db, $d['id'], static fn () => assertSame([409, 'conflict'], $code($commit($w, $d, $key)), 'a link to overtime the base plan holds (M8)'));
        $db->execute('DELETE FROM supplemental_payroll_overtime WHERE id = ?', [$o1]);
        $db->execute('INSERT INTO supplemental_payroll_overtime (id, company_id, supplemental_payroll_id, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6))', [$o2, $w['a'], $d['id']]);
        assertSame('Committed', $ok($commit($w, $d, $key), 'restored: the same key commits')['supplementalPayroll']['status']);
    },
    'reads: the CEO lists every document of the month and reads any; an Employee reads only their own Committed documents — own Draft, Reviewed, Ready, Cancelled, a colleague and another company are 404; writes and eligibility are 403 (M27, M28, M29, M30)' => static function () use ($world, $overtime, $committed, $gen, $step, $ready, $commit, $ok, $code, $get, $post, $unchanged, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $p1 = $committed($w, 'e_a1');
        $p2 = $committed($w, 'e_a2');
        $docs = [];
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $docs['committed'] = $ok($commit($w, $ready($w, $ok($gen($w, $p1['id']), 'g')['supplementalPayroll']), $newKey()), 'c')['supplementalPayroll'];
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $docs['cancelled'] = $ok($step($w, 'cancel', $ok($gen($w, $p1['id']), 'g')['supplementalPayroll']), 'x')['supplementalPayroll'];
        $draft = $ok($gen($w, $p1['id']), 'g')['supplementalPayroll'];
        $overtime($db, $w['a'], 'e_a2', '2026-10', '1.00', '12500.00');
        $colleague = $ok($commit($w, $ready($w, $ok($gen($w, $p2['id']), 'g')['supplementalPayroll']), $newKey()), 'c')['supplementalPayroll'];
        $list = $ok($get($w, 'ceoA', '/api/supplemental-payrolls', 'month=2026-10'), 'CEO list')['supplementalPayrolls'];
        $ids = array_map(static fn (array $s): string => $s['id'], $list);
        sort($ids);
        $want = [$docs['committed']['id'], $docs['cancelled']['id'], $draft['id'], $colleague['id']];
        sort($want);
        assertSame($want, $ids, 'every status, Cancelled included');
        foreach ($list as $s) {
            assertSame(SupplementalView::FIELDS, array_keys($s));
        }
        $mine = $ok($get($w, 'empA1', '/api/supplemental-payrolls', 'month=2026-10'), 'own list')['supplementalPayrolls'];
        assertSame([$docs['committed']['id']], array_column($mine, 'id'), 'own Committed only');
        $detail = $ok($get($w, 'empA1', '/api/supplemental-payroll', 'id=' . $docs['committed']['id']), 'own detail');
        assertSame([$docs['committed'], 1], [$detail['supplementalPayroll'], count($detail['supplementalPayrollOvertime'])], 'own Committed document with its frozen lines');
        $draftReviewed = $ok($step($w, 'review', $draft), 'review')['supplementalPayroll'];
        foreach (['Cancelled' => $docs['cancelled'], 'Reviewed' => $draftReviewed] as $label => $s) {
            assertSame([404, 'not_found'], $code($get($w, 'empA1', '/api/supplemental-payroll', 'id=' . $s['id'])), 'own ' . $label . ' (M29)');
        }
        $draftReady = $ok($step($w, 'approve', $draftReviewed), 'approve')['supplementalPayroll'];
        assertSame([404, 'not_found'], $code($get($w, 'empA1', '/api/supplemental-payroll', 'id=' . $draftReady['id'])), 'own Ready (M29)');
        $draftBack = $ok($step($w, 'return', $draftReady), 'return')['supplementalPayroll'];
        assertSame([404, 'not_found'], $code($get($w, 'empA1', '/api/supplemental-payroll', 'id=' . $draftBack['id'])), 'own Draft (M29)');
        foreach (['empA1' => $colleague['id'], 'empA2' => $docs['committed']['id'], 'empB1' => $docs['committed']['id'], 'ceoB' => $docs['committed']['id']] as $who => $id) {
            $r = $get($w, $who, '/api/supplemental-payroll', 'id=' . $id);
            assertSame([404, 'not_found'], $code($r), $who . ' reading another employee or company (M28)');
            assertNoLeak($r->body, ['21875.00', '12500.00', 'Fixture e_a']);
        }
        assertSame([$colleague['id']], array_column($ok($get($w, 'empA2', '/api/supplemental-payrolls', 'month=2026-10'), 'colleague list')['supplementalPayrolls'], 'id'), 'a colleague sees only their own');
        assertSame([], $ok($get($w, 'ceoB', '/api/supplemental-payrolls', 'month=2026-10'), 'other company')['supplementalPayrolls']);
        $body = ['id' => $draftBack['id'], 'expectedVersion' => $draftBack['version']];
        foreach (['generate' => ['payrollPlanId' => $p1['id']], 'review' => $body, 'approve' => $body, 'return' => $body, 'cancel' => $body,
            'commit' => $body + ['expectedTotal' => $draftBack['overtimeAmount'], 'idempotencyKey' => $newKey()]] as $op => $b) {
            $unchanged($db, $draftBack['id'], static fn () => assertSame([403, 'forbidden'], $code($post($w, 'empA1', '/api/supplemental-payrolls/' . $op, $b)), 'an Employee ' . $op . ' (M27)'));
        }
        assertSame([403, 'forbidden'], $code($get($w, 'empA1', '/api/supplemental-payrolls/eligibility', 'month=2026-10')), 'an Employee eligibility read (M30)');
    },
    'eligibility: per Committed base plan, the Approved overtime held by no base plan and no document — exact sums; CEO company scope only' => static function () use ($world, $overtime, $committed, $gen, $ok, $get, $post): void {
        $w = $world();
        $db = $w['db'];
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $p1 = $committed($w, 'e_a1');
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.25', '27344.00');
        $overtime($db, $w['a'], 'e_a1', '2026-10', '0.50', '10938.00');
        $plans = [];
        foreach ($ok($post($w, 'ceoA', '/api/payroll-plans/generate', ['month' => '2026-10']), 'g')['payrollPlans'] as $q) {
            $plans[$q['employeeId']] = $q;
        }
        $overtime($db, $w['a'], 'e_a2', '2026-10', '1.00', '12500.00');
        $e = $ok($get($w, 'ceoA', '/api/supplemental-payrolls/eligibility', 'month=2026-10'), 'eligibility')['supplementalEligibility'];
        assertSame([['payrollPlanId' => $p1['id'], 'employeeId' => 'e_a1', 'eligibleCount' => 2, 'eligibleHours' => '1.75', 'eligibleAmount' => '38282.00']], $e,
            'only the Committed plan, only its uncaptured late overtime; a Draft base plan (e_a2) is the Payroll drift path, never Supplemental');
        $ok($gen($w, $p1['id']), 'generate');
        assertSame([], $ok($get($w, 'ceoA', '/api/supplemental-payrolls/eligibility', 'month=2026-10'), 'after capture')['supplementalEligibility'], 'captured overtime is not eligible (M9)');
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $again = $ok($get($w, 'ceoA', '/api/supplemental-payrolls/eligibility', 'month=2026-10'), 'new late')['supplementalEligibility'];
        assertSame([[$p1['id'], 1, '1.00', '21875.00']], array_map(static fn (array $x): array => [$x['payrollPlanId'], $x['eligibleCount'], $x['eligibleHours'], $x['eligibleAmount']], $again), 'a newer approval is eligible again');
        assertSame([], $ok($get($w, 'ceoB', '/api/supplemental-payrolls/eligibility', 'month=2026-10'), 'other company')['supplementalEligibility'], 'company scope');
        assertSame('Draft', $plans['e_a2']['status'], 'e_a2 has only a Draft base plan');
    },
    'a failing audit append rolls generate, a transition and commit back entirely; the same key then commits (M31)' => static function () use ($world, $overtime, $committed, $gen, $step, $commit, $ok, $code, $row, $links, $counts, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $p = $committed($w, 'e_a1');
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $block = static function (Closure $fn) use ($db): void {
            $last = (string) $db->select('SELECT MAX(occurred_at) AS t FROM audit_events')[0]['t'];
            usleep(2000);
            // Test-only DDL: every further audit insert violates this CHECK — inside the write's transaction.
            $db->execute("ALTER TABLE audit_events ADD CONSTRAINT test_block_audit CHECK (occurred_at <= '" . $last . "')");
            try {
                $fn();
            } finally {
                $db->execute('ALTER TABLE audit_events DROP CONSTRAINT test_block_audit');
            }
        };
        $before = $counts($db);
        $block(static fn () => assertSame([500, 'internal_error'], $code($gen($w, $p['id'])), 'generate'));
        assertSame($before, $counts($db), 'generate rolled back: no document, no link');
        $d = $ok($gen($w, $p['id']), 'generate')['supplementalPayroll'];
        $snap = [$row($db, $d['id']), $links($db, $d['id'])];
        $block(static fn () => assertSame([500, 'internal_error'], $code($step($w, 'cancel', $d)), 'cancel'));
        assertSame($snap, [$row($db, $d['id']), $links($db, $d['id'])], 'cancel rolled back: still Draft, links kept');
        $d = $ok($step($w, 'review', $d), 'review')['supplementalPayroll'];
        $d = $ok($step($w, 'approve', $d), 'approve')['supplementalPayroll'];
        $key = $newKey();
        $snap = $row($db, $d['id']);
        $block(static fn () => assertSame([500, 'internal_error'], $code($commit($w, $d, $key)), 'commit'));
        assertSame($snap, $row($db, $d['id']), 'commit rolled back: still Ready, no committed_at, no key');
        assertSame('Committed', $ok($commit($w, $d, $key), 'the same key after the rollback (M26)')['supplementalPayroll']['status']);
    },
    'firewalls: the whole Supplemental flow writes only its two tables and audit rows — no base Payroll, overtime, employee, finance or payment write; Committed is an obligation, not a payment; the base plan DTO keeps thirteen keys (M4, M5, M6, M32, M33, M34, M36)' => static function () use ($world, $overtime, $committed, $gen, $ready, $commit, $ok, $get, $counts, $base, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $p = $committed($w, 'e_a1');
        $overtime($db, $w['a'], 'e_a1', '2026-10', '1.00', '21875.00');
        $before = $counts($db);
        $baseBefore = $base($db);
        $c = $ok($commit($w, $ready($w, $ok($gen($w, $p['id']), 'generate')['supplementalPayroll']), $newKey()), 'commit')['supplementalPayroll'];
        $after = $counts($db);
        foreach ($after as $table => $n) {
            $delta = ['supplemental_payrolls' => 1, 'supplemental_payroll_overtime' => 1, 'audit_events' => 4][$table] ?? 0;
            assertSame(($before[$table] ?? 0) + $delta, $n, $table);
        }
        assertSame($baseBefore, $base($db), 'no base plan, base link, overtime or employee write (M4, M5, M6)');
        assertSame([], array_values(array_filter(array_keys($after), static fn (string $t): bool => (bool) preg_match('/finance|transaction|ledger|journal|payment|payslip|bank|cash/', $t))), 'no finance table exists (M32)');
        $cols = array_map(static fn (array $r): string => (string) $r['c'], $db->select("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('supplemental_payrolls', 'supplemental_payroll_overtime')"));
        assertSame([], array_values(array_filter($cols, static fn (string $col): bool => (bool) preg_match('/paid|payment|executed|posted|bank|account|tax|pph|bpjs|thr|allowance|deduction|bonus|benefit|loan|reimburs|net_|gross/', $col))), 'no paid, posted, executed, bank or statutory column (M33, M34, M35)');
        assertSame('Committed', $c['status'], 'Committed — never Paid, Posted or Executed');
        $plan = $ok($get($w, 'ceoA', '/api/payroll-plan', 'id=' . $p['id']), 'base plan detail');
        assertSame(PayrollView::FIELDS, array_keys($plan['payrollPlan']), 'the base plan DTO is unchanged (M36)');
        assertSame([$p['totalAmount'], 1], [$plan['payrollPlan']['totalAmount'], count($plan['payrollPlanOvertime'])], 'the base plan total and lines are the committed ones');
        $mine = $ok($get($w, 'empA1', '/api/payroll-plan', 'id=' . $p['id']), 'own base plan')['payrollPlan'];
        assertSame(PayrollView::FIELDS, array_keys($mine), 'the Employee base plan read is unchanged');
    },
];
