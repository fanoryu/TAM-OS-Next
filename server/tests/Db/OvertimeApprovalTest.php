<?php
declare(strict_types=1);

/*
 * BF-4b2 overtime valuation and approval end to end against the real MariaDB (owner decisions
 * D-BF4b-3/4 = A, D-BF4b2-1..5 = A): real login → real session → production routes →
 * OvertimeService → OvertimeStore / AuditLog. The CEO preview (computed, never stored), approval
 * with expectedVersion and expectedAmount, the atomic snapshot and its audit row, eligibility,
 * Approved as terminal and immutable (a later salary change rewrites nothing), the owner's read of
 * their own Approved valuation, rollback when the audit row cannot be written, and the payroll /
 * finance firewall (approval writes overtime_records and audit_events only). Fabricated data only:
 * salaries are set with test-only SQL.
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
use TamOs\Http\Response;
use TamOs\Overtime\OvertimeValuation;
use TamOs\Overtime\OvertimeValuationView;
use TamOs\Overtime\OvertimeView;
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
 * Company A: a CEO, an Employee bound to e_a1 (salary 3 500 000.00), a colleague bound to e_a2
 * (salary 4 123 456.78) and an unbound employee e_a3 (no salary). Company B: a CEO, an Employee
 * bound to e_b1. Everyone logs in for real.
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
    $db->execute("UPDATE employees SET monthly_base_salary = '3500000.00' WHERE id = 'e_a1'");
    $db->execute("UPDATE employees SET monthly_base_salary = '4123456.78' WHERE id = 'e_a2'");
    $db->execute("UPDATE employees SET monthly_base_salary = '2000000.00' WHERE id = 'e_b1'");
    $s = [];
    foreach ($fixtures as $name => $f) {
        $r = $k->handle(loginRequest($f['email'], (string) $f['password']), requestId());
        assertSame(200, $r->status, 'login ' . $name);
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken'], 'userId' => $f['userId'], 'membershipId' => $f['membershipId']];
    }
    return ['db' => $db, 'k' => $k, 'a' => $a, 'b' => $ceoB['companyId'], 's' => $s];
};
$get = static fn (array $w, string $who, string $path, string $query = ''): Response
    => $w['k']->handle(sessionRequest('GET', $path, $w['s'][$who]['token'], null, '', ['query' => $query]), requestId());
$post = static fn (array $w, string $who, string $path, array $body): Response
    => $w['k']->handle(sessionRequest('POST', $path, $w['s'][$who]['token'], $w['s'][$who]['csrf'], json_encode($body, JSON_THROW_ON_ERROR)), requestId());
$ok = static function (Response $r, string $label): array {
    assertSame(200, $r->status, $label . ' (' . substr($r->body, 0, 200) . ')');
    return envelope($r)['data'];
};
$code = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
$step = static fn (array $w, string $who, string $op, array $rec): array
    => $ok($post($w, $who, '/api/overtime-records/' . $op, ['id' => $rec['id'], 'expectedVersion' => $rec['version']]), $op)['overtimeRecord'];
/** A Reviewed record of $employee with $hours, created, submitted and reviewed by the company's CEO. */
$reviewed = static function (array $w, string $employee = 'e_a1', string $hours = '10.00', string $ceo = 'ceoA') use ($post, $ok, $step): array {
    $d = $ok($post($w, $ceo, '/api/overtime-records/create', ['employeeId' => $employee, 'monthKey' => '2026-10', 'hours' => $hours]), 'create')['overtimeRecord'];
    return $step($w, $ceo, 'review', $step($w, $ceo, 'submit', $d));
};
$preview = static fn (array $w, string $who, array $rec): Response => $get($w, $who, '/api/overtime-record/valuation', 'id=' . $rec['id']);
$approve = static fn (array $w, string $who, array $rec, string $amount): Response
    => $post($w, $who, '/api/overtime-records/approve', ['id' => $rec['id'], 'expectedVersion' => $rec['version'], 'expectedAmount' => $amount]);
$snap = static fn (Database $db, string $id): ?array => array_map(static fn ($v) => $v === null ? null : (string) $v, $db->select(
    'SELECT status, version, hours, valuation_method, valuation_salary, valuation_standard_hours, approved_amount, approved_at IS NOT NULL AS approved_at_set FROM overtime_records WHERE id = ?', [$id])[0] ?? []) ?: null;
$audits = static fn (Database $db, string $id): array => array_map(
    static fn (array $r): array => array_map(static fn ($v) => $v === null ? null : (string) $v, $r),
    $db->select('SELECT company_id, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields FROM audit_events WHERE entity_id = ? ORDER BY id', [$id]),
);
/** Every table's row count — the payroll / finance firewall compares it around an approval. */
$counts = static function (Database $db): array {
    $out = [];
    foreach ($db->select("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME") as $t) {
        $out[(string) $t['t']] = (int) $db->select('SELECT COUNT(*) AS n FROM `' . $t['t'] . '`')[0]['n'];
    }
    return $out;
};

return [
    'preview: the CEO sees the current TAM-OT-1 valuation of a Reviewed record; nothing is stored, versioned or audited' => static function () use ($world, $reviewed, $preview, $ok, $snap, $audits): void {
        $w = $world();
        $r = $reviewed($w);
        $before = [$snap($w['db'], $r['id']), count($audits($w['db'], $r['id']))];
        $v = $ok($preview($w, 'ceoA', $r), 'preview')['overtimeValuation'];
        assertSame(OvertimeValuationView::FIELDS, array_keys($v), 'exact projection');
        assertSame([$r['id'], 'preview', 'TAM-OT-1', '10.00', '3500000.00', '160.00', '218750.00'], array_values($v));
        assertSame($before, [$snap($w['db'], $r['id']), count($audits($w['db'], $r['id']))], 'a preview writes nothing');
        assertSame(['Reviewed', (string) $r['version'], '10.00', null, null, null, null, '0'], array_values($snap($w['db'], $r['id'])), 'no snapshot before approval');
        $w['db']->execute("UPDATE employees SET monthly_base_salary = '3200000.00' WHERE id = 'e_a1'");
        assertSame('200000.00', $ok($preview($w, 'ceoA', $r), 'preview after a salary change')['overtimeValuation']['amount'], 'a preview is always the current valuation');
    },
    'preview refusals: wrong state 409; an Employee never gets a preview (403, own record or not); colleague and other company 404; ineligible 409' => static function () use ($world, $reviewed, $preview, $post, $ok, $step, $code): void {
        $w = $world();
        $r = $reviewed($w);
        $draft = $ok($post($w, 'ceoA', '/api/overtime-records/create', ['employeeId' => 'e_a1', 'monthKey' => '2026-10', 'hours' => '1.00']), 'draft')['overtimeRecord'];
        $sub = $step($w, 'ceoA', 'submit', $ok($post($w, 'ceoA', '/api/overtime-records/create', ['employeeId' => 'e_a1', 'monthKey' => '2026-10', 'hours' => '1.00']), 'd2')['overtimeRecord']);
        $rej = $step($w, 'ceoA', 'reject', $reviewed($w));
        foreach (['Draft' => $draft, 'Submitted' => $sub, 'Rejected' => $rej] as $label => $rec) {
            assertSame([409, 'conflict'], $code($preview($w, 'ceoA', $rec)), $label);
        }
        assertSame([403, 'forbidden'], $code($preview($w, 'empA1', $r)), 'the owner gets no preview');
        assertSame([403, 'forbidden'], $code($preview($w, 'empA1', $draft)), 'not even of their own Draft');
        assertSame([404, 'not_found'], $code($preview($w, 'empA2', $r)), 'a colleague');
        assertSame([404, 'not_found'], $code($preview($w, 'ceoB', $r)), 'another company CEO');
        assertSame([404, 'not_found'], $code($preview($w, 'empB1', $r)), 'another company Employee');
        assertSame([404, 'not_found'], $code($preview($w, 'ceoA', ['id' => str_repeat('0', 32)])), 'absent');
        $none = $reviewed($w, 'e_a3');
        $resp = $preview($w, 'ceoA', $none);
        assertSame([409, 'conflict'], $code($resp), 'no salary');
        $w['db']->execute("UPDATE employees SET monthly_base_salary = '0.00' WHERE id = 'e_a3'");
        assertSame([409, 'conflict'], $code($preview($w, 'ceoA', $none)), 'salary 0');
        $w['db']->execute("UPDATE employees SET archived_at = UTC_TIMESTAMP(6) WHERE id = 'e_a1'");
        $archived = $preview($w, 'ceoA', $r);
        assertSame([409, 'conflict'], $code($archived), 'archived');
        assertNoLeak($archived->body . $resp->body, ['3500000', '218750', 'e_a1', 'salary', 'monthly_base_salary', 'archived']);
    },
    'approve: Reviewed → Approved with the frozen snapshot, version + 1, one audit row naming approve and no value' => static function () use ($world, $reviewed, $approve, $ok, $snap, $audits): void {
        $w = $world();
        $r = $reviewed($w);
        $out = $ok($approve($w, 'ceoA', $r, '218750.00'), 'approve');
        assertSame(['overtimeRecord', 'overtimeValuation'], array_keys($out));
        assertSame(OvertimeView::FIELDS, array_keys($out['overtimeRecord']), 'the record DTO keeps its nine fields');
        assertSame(['Approved', $r['version'] + 1, '10.00'], [$out['overtimeRecord']['status'], $out['overtimeRecord']['version'], $out['overtimeRecord']['hours']]);
        assertSame([$r['id'], 'approved', 'TAM-OT-1', '10.00', '3500000.00', '160.00', '218750.00'], array_values($out['overtimeValuation']));
        assertSame(['Approved', (string) ($r['version'] + 1), '10.00', 'TAM-OT-1', '3500000.00', '160.00', '218750.00', '1'], array_values($snap($w['db'], $r['id'])), 'stored atomically');
        $log = $audits($w['db'], $r['id']);
        assertSame([$w['a'], $w['s']['ceoA']['userId'], $w['s']['ceoA']['membershipId'], 'overtime.manage', 'overtime', $r['id'], 'approve', null, requestId(), null], array_values(end($log)), 'actor from the session; no field, no amount, no salary');
        assertSame(4, count($log), 'create, submit, review, approve');
        assertSame('218750.00', OvertimeValuation::amount('TAM-OT-1', '3500000.00', '160.00', '10.00'), 'the snapshot reproduces the amount without the live salary');
    },
    'approve needs Reviewed: Draft, Submitted, Rejected and Approved are 409 and change nothing' => static function () use ($world, $reviewed, $approve, $post, $ok, $step, $code, $snap): void {
        $w = $world();
        $draft = $ok($post($w, 'ceoA', '/api/overtime-records/create', ['employeeId' => 'e_a1', 'monthKey' => '2026-10', 'hours' => '10.00']), 'draft')['overtimeRecord'];
        $sub = $step($w, 'ceoA', 'submit', $ok($post($w, 'ceoA', '/api/overtime-records/create', ['employeeId' => 'e_a1', 'monthKey' => '2026-10', 'hours' => '10.00']), 'd2')['overtimeRecord']);
        $rej = $step($w, 'ceoA', 'reject', $reviewed($w));
        $app = $reviewed($w);
        $ok($approve($w, 'ceoA', $app, '218750.00'), 'approve');
        $app['version']++;
        foreach (['Draft' => $draft, 'Submitted' => $sub, 'Rejected' => $rej, 'Approved' => $app] as $label => $rec) {
            $before = $snap($w['db'], $rec['id']);
            assertSame([409, 'conflict'], $code($approve($w, 'ceoA', $rec, '218750.00')), $label);
            assertSame($before, $snap($w['db'], $rec['id']), $label . ' unchanged');
        }
    },
    'a stale expectedVersion or a changed valuation is 409 and writes nothing; the CEO never approves an amount it was not shown' => static function () use ($world, $reviewed, $approve, $preview, $ok, $code, $snap, $audits): void {
        $w = $world();
        $r = $reviewed($w);
        $before = [$snap($w['db'], $r['id']), count($audits($w['db'], $r['id']))];
        assertSame([409, 'conflict'], $code($approve($w, 'ceoA', ['id' => $r['id'], 'version' => $r['version'] - 1], '218750.00')), 'stale version');
        assertSame([409, 'conflict'], $code($approve($w, 'ceoA', $r, '218751.00')), 'another amount');
        assertSame([409, 'conflict'], $code($approve($w, 'ceoA', $r, '0.00')), 'zero');
        $shown = $ok($preview($w, 'ceoA', $r), 'preview')['overtimeValuation']['amount'];
        $w['db']->execute("UPDATE employees SET monthly_base_salary = '3600000.00', version = version + 1 WHERE id = 'e_a1'");
        assertSame([409, 'conflict'], $code($approve($w, 'ceoA', $r, $shown)), 'the salary changed after the preview: valuation_changed');
        assertSame($before, [$snap($w['db'], $r['id']), count($audits($w['db'], $r['id']))], 'nothing written, nothing audited');
        $fresh = $ok($preview($w, 'ceoA', $r), 'a new preview')['overtimeValuation']['amount'];
        assertSame('225000.00', $fresh);
        assertSame('225000.00', $ok($approve($w, 'ceoA', $r, $fresh), 'approve the new amount')['overtimeValuation']['amount']);
    },
    'eligibility (D-BF4b2-2 = A): archived or no positive salary is 409; employment status and the login account are not checked' => static function () use ($world, $reviewed, $approve, $ok, $code, $snap): void {
        $w = $world();
        $none = $reviewed($w, 'e_a3');
        assertSame([409, 'conflict'], $code($approve($w, 'ceoA', $none, '0.00')), 'no salary');
        $w['db']->execute("UPDATE employees SET monthly_base_salary = '0.00' WHERE id = 'e_a3'");
        assertSame([409, 'conflict'], $code($approve($w, 'ceoA', $none, '0.00')), 'salary 0');
        assertSame('Reviewed', $snap($w['db'], $none['id'])['status']);
        $arch = $reviewed($w, 'e_a2');
        $w['db']->execute("UPDATE employees SET archived_at = UTC_TIMESTAMP(6) WHERE id = 'e_a2'");
        assertSame([409, 'conflict'], $code($approve($w, 'ceoA', $arch, '257716.00')), 'archived');
        assertSame('Reviewed', $snap($w['db'], $arch['id'])['status']);
        foreach (['Resigned', 'Terminated', 'Inactive', 'On Leave'] as $status) {
            $r = $reviewed($w);
            $w['db']->execute('UPDATE employees SET employment_status = ? WHERE id = ?', [$status, 'e_a1']);
            assertSame('Approved', $ok($approve($w, 'ceoA', $r, '218750.00'), $status)['overtimeRecord']['status'], $status . ' is still approvable');
            $w['db']->execute("UPDATE employees SET employment_status = 'Active' WHERE id = 'e_a1'");
        }
        $r = $reviewed($w);
        $w['db']->execute("UPDATE users SET status = 'disabled' WHERE id = ?", [$w['s']['empA1']['userId']]);
        $w['db']->execute("UPDATE memberships SET status = 'disabled' WHERE id = ?", [$w['s']['empA1']['membershipId']]);
        assertSame('Approved', $ok($approve($w, 'ceoA', $r, '218750.00'), 'disabled login')['overtimeRecord']['status'], 'the login account is not employment');
    },
    'Approved is terminal and immutable: no transition, edit, delete or re-approval; a later salary change rewrites nothing' => static function () use ($world, $reviewed, $approve, $post, $get, $ok, $code, $snap): void {
        $w = $world();
        $r = $reviewed($w);
        $a = $ok($approve($w, 'ceoA', $r, '218750.00'), 'approve')['overtimeRecord'];
        $frozen = $snap($w['db'], $r['id']);
        foreach (['submit', 'review', 'reject', 'delete'] as $op) {
            assertSame([409, 'conflict'], $code($post($w, 'ceoA', '/api/overtime-records/' . $op, ['id' => $a['id'], 'expectedVersion' => $a['version']])), 'Approved → ' . $op);
        }
        assertSame([409, 'conflict'], $code($post($w, 'ceoA', '/api/overtime-records/update', ['id' => $a['id'], 'expectedVersion' => $a['version'], 'hours' => '1.00'])), 'no edit');
        assertSame([409, 'conflict'], $code($approve($w, 'ceoA', $a, '218750.00')), 'no re-approval');
        $w['db']->execute("UPDATE employees SET monthly_base_salary = '9000000.00', version = version + 1 WHERE id = 'e_a1'");
        assertSame($frozen, $snap($w['db'], $r['id']), 'the stored valuation is unchanged');
        foreach (['ceoA', 'empA1'] as $who) {
            $v = $ok($get($w, $who, '/api/overtime-record/valuation', 'id=' . $r['id']), $who)['overtimeValuation'];
            assertSame(['approved', '3500000.00', '218750.00'], [$v['kind'], $v['monthlySalaryBasis'], $v['amount']], $who . ' reads the frozen snapshot, never the live salary');
        }
    },
    'disclosure (D-BF4b2-4 = A): the owner reads their own Approved valuation; colleagues and other companies get 404; month lists carry no money' => static function () use ($world, $reviewed, $approve, $get, $ok, $code): void {
        $w = $world();
        $mine = $reviewed($w);
        $ok($approve($w, 'ceoA', $mine, '218750.00'), 'approve mine');
        $theirs = $reviewed($w, 'e_a2', '7.50');
        $ok($approve($w, 'ceoA', $theirs, '193287.00'), 'approve theirs');
        assertSame('218750.00', $ok($get($w, 'empA1', '/api/overtime-record/valuation', 'id=' . $mine['id']), 'own')['overtimeValuation']['amount']);
        foreach (['empA1' => $theirs, 'ceoB' => $mine, 'empB1' => $mine] as $who => $rec) {
            $r = $get($w, $who, '/api/overtime-record/valuation', 'id=' . $rec['id']);
            assertSame([404, 'not_found'], $code($r), $who);
            assertNoLeak($r->body, ['4123456', '193287', '3500000', '218750']);
        }
        foreach (['ceoA', 'empA1'] as $who) {
            $list = $ok($get($w, $who, '/api/overtime-records', 'month=2026-10'), $who . ' list')['overtimeRecords'];
            foreach ($list as $item) {
                assertSame(OvertimeView::FIELDS, array_keys($item), 'the record DTO only');
            }
            assertNoLeak(json_encode($list, JSON_THROW_ON_ERROR), ['218750', '193287', '3500000', '4123456', 'TAM-OT-1', '160.00']);
        }
    },
    'payroll / finance firewall: an approval writes only its overtime row and one audit row; no table appears' => static function () use ($world, $reviewed, $approve, $ok, $counts): void {
        $w = $world();
        $r = $reviewed($w);
        $before = $counts($w['db']);
        $ok($approve($w, 'ceoA', $r, '218750.00'), 'approve');
        $after = $counts($w['db']);
        assertSame(array_keys($before), array_keys($after), 'no table created');
        $before['audit_events']++;
        assertSame($before, $after, 'only audit_events grew; every other table, payroll or finance included, is untouched');
        // BF-4c1 authorized revision: the payroll tables now exist (payroll_plans, payroll_plan_overtime);
        // an approval still writes none of them (their counts are compared above). Was: no payroll table at all.
        foreach (array_keys($after) as $t) {
            assertTrue(preg_match('/payslip|payment|finance|transaction|ledger|journal/i', $t) !== 1, 'no finance table: ' . $t);
            assertTrue(preg_match('/payroll/', $t) !== 1 || in_array($t, ['payroll_plans', 'payroll_plan_overtime'], true), 'only the BF-4c1 payroll tables: ' . $t);
        }
    },
    'a failing audit append rolls the approval back: the record stays Reviewed with no snapshot' => static function () use ($world, $reviewed, $approve, $code, $snap): void {
        $w = $world();
        $r = $reviewed($w);
        $before = $snap($w['db'], $r['id']);
        $last = (string) $w['db']->select('SELECT MAX(occurred_at) AS m FROM audit_events')[0]['m'];
        usleep(2000);
        // Test-only DDL: every further audit insert violates this CHECK — inside the approval's transaction.
        $w['db']->execute("ALTER TABLE audit_events ADD CONSTRAINT test_block_audit CHECK (occurred_at <= '" . $last . "')");
        assertSame([500, 'internal_error'], $code($approve($w, 'ceoA', $r, '218750.00')), 'approve');
        assertSame($before, $snap($w['db'], $r['id']), 'no partially Approved record survives');
    },
];
