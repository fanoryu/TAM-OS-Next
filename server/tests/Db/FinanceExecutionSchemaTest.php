<?php
declare(strict_types=1);

/*
 * BF-4f Finance execution schema against the real MariaDB (migrations 0034–0035): the columns of
 * finance_executions, its CHECKs (a positive whole-Rupiah amount, the closed payment method list, a
 * 32-hex id and key, a canonical month), at most one execution per posting and each key once per
 * company, the composite tenant FKs to the posting, the employee and the company without cascade (an
 * executed posting can never be removed), the 0035 audit vocabulary ('execute' under finance.execute
 * on financePosting only, every earlier rule kept), and the forward migration of a schema-0033
 * database whose postings, payroll, Supplemental, overtime and audit rows survive unchanged with no
 * execution seeded and every posting still Planned.
 */

use TamOs\Data\Database;
use TamOs\Data\Migration\Migrator;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\migrationFixture;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\testDatabase;

/** A company with employee e_1, a Committed base plan of e_1 for 2026-10 and its Planned posting — test-only SQL, fabricated values. */
$company = static function (Database $db): array {
    $c = bin2hex(random_bytes(16));
    $db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$c]);
    $e1 = 'e_1_' . substr($c, 0, 6);
    $db->execute("INSERT INTO employees (id, company_id, employee_code, full_name, monthly_base_salary, created_at, updated_at) VALUES (?, ?, ?, 'Fixture e_1', '3500000.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$e1, $c, 'E1' . substr($c, 0, 6)]);
    $plan = bin2hex(random_bytes(16));
    $db->execute("INSERT INTO payroll_plans (id, company_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, '2026-10', 'Committed', 'CODE', 'Fixture', NULL, '3500000.00', '0.00', '0.00', 0, '3500000.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), ?, 2, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
        [$plan, $c, $e1, bin2hex(random_bytes(16))]);
    $posting = bin2hex(random_bytes(16));
    $db->execute("INSERT INTO finance_postings (id, company_id, source_kind, payroll_plan_id, supplemental_payroll_id, employee_id, month_key, amount, status, idempotency_key, posted_at) VALUES (?, ?, 'payrollPlan', ?, NULL, ?, '2026-10', '3500000.00', 'Planned', ?, UTC_TIMESTAMP(6))",
        [$posting, $c, $plan, $e1, bin2hex(random_bytes(16))]);
    return ['id' => $c, 'e1' => $e1, 'plan' => $plan, 'posting' => $posting];
};
/** Inserts one execution (test-only SQL); $over replaces any column value. */
$execution = static function (Database $db, array $c, array $over = []): string {
    $v = $over + ['id' => bin2hex(random_bytes(16)), 'company' => $c['id'], 'posting' => $c['posting'], 'employee' => $c['e1'], 'month' => '2026-10', 'amount' => '3500000.00',
        'on' => '2026-10-07', 'method' => 'bankTransfer', 'key' => bin2hex(random_bytes(16))];
    $db->execute('INSERT INTO finance_executions (id, company_id, finance_posting_id, employee_id, month_key, amount, executed_on, payment_method, idempotency_key, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))',
        [$v['id'], $v['company'], $v['posting'], $v['employee'], $v['month'], $v['amount'], $v['on'], $v['method'], $v['key']]);
    return $v['id'];
};
$expectRefused = static function (Closure $fn, string $label): void {
    try {
        $fn();
    } catch (\Throwable) {
        return;
    }
    throw new \TamOs\Tests\AssertionFailed('expected the database to refuse: ' . $label);
};

return [
    'finance_executions columns: identifiers ascii_bin, an exact DECIMAL amount, a DATE, DATETIME(6), InnoDB utf8mb4 — no status, partial, account, bank, reference, note, reversal or version column' => static function (): void {
        $db = authDatabase();
        $cols = [];
        foreach ($db->select("SELECT COLUMN_NAME AS c, COLUMN_TYPE AS t, IS_NULLABLE AS n, COLLATION_NAME AS k FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_executions' ORDER BY ORDINAL_POSITION") as $r) {
            $cols[(string) $r['c']] = $r['t'] . ' ' . $r['n'] . ' ' . ($r['k'] ?? '-');
        }
        assertSame([
            'id' => 'char(32) NO ascii_bin', 'company_id' => 'char(32) NO ascii_bin', 'finance_posting_id' => 'char(32) NO ascii_bin',
            'employee_id' => 'varchar(64) NO ascii_bin', 'month_key' => 'char(7) NO ascii_bin', 'amount' => 'decimal(17,2) NO -', 'executed_on' => 'date NO -',
            'payment_method' => 'varchar(16) NO ascii_bin', 'idempotency_key' => 'char(32) NO ascii_bin', 'recorded_at' => 'datetime(6) NO -',
        ], $cols);
        assertSame([], array_values(array_filter(array_keys($cols), static fn (string $c): bool => (bool) preg_match('/status|partial|account|bank|reference|note|categor|revers|void|correct|refund|settle|reconcil|version|updated|actor|user/', $c))), 'the minimal execution');
        $info = $db->select("SELECT ENGINE AS e, TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_executions'")[0];
        assertSame(['InnoDB', 'utf8mb4_unicode_ci'], [(string) $info['e'], (string) $info['c']]);
    },
    'finance_executions CHECKs: a positive whole-Rupiah amount, the closed payment method list, a canonical id, key and month' => static function () use ($company, $execution, $expectRefused): void {
        $db = authDatabase();
        foreach ([
            'a zero amount' => ['amount' => '0.00'],
            'a negative amount' => ['amount' => '-1.00'],
            'a fractional amount' => ['amount' => '1.50'],
            'a label payment method' => ['method' => 'Bank Transfer'],
            'an uppercase payment method' => ['method' => 'CASH'],
            'an unknown payment method' => ['method' => 'cheque'],
            'an empty payment method' => ['method' => ''],
            'an uppercase key' => ['key' => strtoupper(bin2hex(random_bytes(16)))],
            'a short key' => ['key' => 'abc'],
            'a malformed id' => ['id' => 'exe_1'],
            'a malformed month' => ['month' => '2026-13'],
        ] as $label => $over) {
            $c = $company($db);
            $expectRefused(static fn () => $execution($db, $c, $over), $label);
        }
        foreach (['cash', 'bankTransfer', 'qris', 'virtualAccount', 'creditCard', 'other'] as $method) {
            $execution($db, $company($db), ['method' => $method]);
        }
        assertSame(6, (int) $db->select('SELECT COUNT(*) AS n FROM finance_executions')[0]['n'], 'every method of the closed list is storable');
    },
    'at most one execution per posting, ever; each key once per company — another company may hold the same key' => static function () use ($company, $execution, $expectRefused): void {
        $db = authDatabase();
        $c = $company($db);
        $key = bin2hex(random_bytes(16));
        $execution($db, $c, ['key' => $key]);
        $expectRefused(static fn () => $execution($db, $c), 'a second execution of the posting');
        $expectRefused(static fn () => $execution($db, $c, ['amount' => '1.00', 'on' => '2026-10-01', 'method' => 'cash']), 'a partial second execution of the posting');
        $d = $company($db);
        $p2 = bin2hex(random_bytes(16));
        $plan2 = bin2hex(random_bytes(16));
        $db->execute("INSERT INTO payroll_plans (id, company_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, '2026-11', 'Committed', 'CODE', 'Fixture', NULL, '3500000.00', '0.00', '0.00', 0, '3500000.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), ?, 2, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
            [$plan2, $c['id'], $c['e1'], bin2hex(random_bytes(16))]);
        $db->execute("INSERT INTO finance_postings (id, company_id, source_kind, payroll_plan_id, supplemental_payroll_id, employee_id, month_key, amount, status, idempotency_key, posted_at) VALUES (?, ?, 'payrollPlan', ?, NULL, ?, '2026-11', '3500000.00', 'Planned', ?, UTC_TIMESTAMP(6))",
            [$p2, $c['id'], $plan2, $c['e1'], bin2hex(random_bytes(16))]);
        $expectRefused(static fn () => $execution($db, $c, ['posting' => $p2, 'month' => '2026-11', 'key' => $key]), 'the same key twice in one company');
        $execution($db, $d, ['key' => $key]);
        assertSame(2, (int) $db->select('SELECT COUNT(*) AS n FROM finance_executions WHERE idempotency_key = ?', [$key])[0]['n'], 'another company may hold the same key');
        foreach (['finance_executions_company_id' => ['company_id', 'id'], 'finance_executions_finance_posting' => ['company_id', 'finance_posting_id'],
            'finance_executions_idempotency_key' => ['company_id', 'idempotency_key']] as $index => $want) {
            $idx = array_map(static fn (array $r): string => (string) $r['c'], $db->select("SELECT COLUMN_NAME AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_executions' AND INDEX_NAME = ? AND NON_UNIQUE = 0 ORDER BY SEQ_IN_INDEX", [$index]));
            assertSame($want, $idx, $index . ' is unique per company');
        }
    },
    'tenant keys: a foreign or absent posting, employee or company is refused; an executed posting can never be removed; no FK cascades' => static function () use ($company, $execution, $expectRefused): void {
        $db = authDatabase();
        $c = $company($db);
        $d = $company($db);
        foreach ([
            "another company's posting" => ['posting' => $d['posting']],
            'an absent posting' => ['posting' => bin2hex(random_bytes(16))],
            "another company's employee" => ['employee' => $d['e1']],
            'an absent employee' => ['employee' => 'nobody'],
            'an absent company' => ['company' => bin2hex(random_bytes(16))],
        ] as $label => $over) {
            $expectRefused(static fn () => $execution($db, $c, $over), $label);
        }
        $execution($db, $c);
        $expectRefused(static fn () => $db->execute('DELETE FROM finance_postings WHERE id = ?', [$c['posting']]), 'an executed posting cannot be removed (RESTRICT)');
        assertSame(1, (int) $db->select('SELECT COUNT(*) AS n FROM finance_postings WHERE id = ?', [$c['posting']])[0]['n']);
        $rules = $db->select("SELECT DELETE_RULE AS d, UPDATE_RULE AS u FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_executions'");
        assertSame(3, count($rules), 'three foreign keys: company, posting, employee');
        foreach ($rules as $r) {
            assertTrue(in_array($r['d'], ['RESTRICT', 'NO ACTION'], true) && in_array($r['u'], ['RESTRICT', 'NO ACTION'], true), 'no cascade, no set null');
        }
    },
    "0035: the audit vocabulary admits 'execute' under finance.execute on financePosting only, and keeps every existing rule" => static function () use ($expectRefused): void {
        $db = authDatabase();
        $c = bin2hex(random_bytes(16));
        $db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$c]);
        $user = bin2hex(random_bytes(16));
        $membership = bin2hex(random_bytes(16));
        $db->execute("INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (?, ?, NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$user, 'audit-' . substr($c, 0, 8) . '@example.test']);
        $db->execute("INSERT INTO memberships (id, user_id, company_id, role, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, 'ceo', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$membership, $user, $c]);
        $row = static fn (string $action, string $entity, ?string $op) => $db->execute("INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, ?, ?, 'x1', ?, NULL, ?, NULL)",
            [$c, $user, $membership, $action, $entity, $op, str_repeat('a', 32)]);
        $row('finance.execute', 'financePosting', 'execute');
        foreach (['create', 'recalculate', 'review', 'approve', 'return', 'cancel', 'commit', 'post'] as $op) {
            $row('payroll.manage', 'payrollPlan', $op);
            $row('supplemental.manage', 'supplementalPayroll', $op);
        }
        foreach ([
            'execute under payroll.manage' => ['payroll.manage', 'payrollPlan', 'execute'],
            'execute under supplemental.manage' => ['supplemental.manage', 'supplementalPayroll', 'execute'],
            'execute under overtime.manage' => ['overtime.manage', 'overtime', 'execute'],
            'execute on an employee row' => ['employee.update', 'employee', 'execute'],
            'finance.execute on a plan' => ['finance.execute', 'payrollPlan', 'execute'],
            'finance.execute on a document' => ['finance.execute', 'supplementalPayroll', 'execute'],
            'finance.execute on an employee row' => ['finance.execute', 'employee', 'execute'],
            'a financePosting entity under employee.update' => ['employee.update', 'financePosting', null],
            'a financePosting entity under payroll.manage' => ['payroll.manage', 'financePosting', 'post'],
            'a financePosting entity under supplemental.manage' => ['supplemental.manage', 'financePosting', 'post'],
            'post under finance.execute' => ['finance.execute', 'financePosting', 'post'],
            'no operation under finance.execute' => ['finance.execute', 'financePosting', null],
            'a pay operation' => ['finance.execute', 'financePosting', 'pay'],
            'a reverse operation' => ['finance.execute', 'financePosting', 'reverse'],
            'a correct operation' => ['finance.execute', 'financePosting', 'correct'],
            'finance.manage' => ['finance.manage', 'financePosting', 'execute'],
            'an unknown entity' => ['finance.execute', 'financeExecution', 'execute'],
        ] as $label => [$action, $entity, $op]) {
            $expectRefused(static fn () => $row($action, $entity, $op), $label);
        }
        $row('overtime.manage', 'overtime', 'approve');
        $row('employee.update', 'employee', null);
        assertSame(19, (int) $db->select('SELECT COUNT(*) AS n FROM audit_events WHERE company_id = ?', [$c])[0]['n'], 'the existing vocabulary still holds');
    },
    '0034–0035 migrate a schema-0033 database forward: postings stay Planned and unchanged, payroll, Supplemental, overtime and audit rows survive unchanged; no execution is seeded' => static function () use ($company): void {
        $db = testDatabase();
        $files = [];
        foreach (glob(productionMigrationsDir() . '/*.sql') ?: [] as $path) {
            if ((int) substr(basename($path), 0, 4) <= 33) {
                $files[basename($path)] = (string) file_get_contents($path);
            }
        }
        (new Migrator($db, migrationFixture($files)))->apply();
        $c = $company($db);
        $user = bin2hex(random_bytes(16));
        $membership = bin2hex(random_bytes(16));
        $db->execute("INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (?, 'upgrade@example.test', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$user]);
        $db->execute("INSERT INTO memberships (id, user_id, company_id, role, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, 'ceo', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$membership, $user, $c['id']]);
        $db->execute("INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, 'payroll.manage', 'payrollPlan', ?, 'post', NULL, ?, NULL)",
            [$c['id'], $user, $membership, $c['plan'], str_repeat('a', 32)]);
        $snapshot = static fn (): array => [$db->select('SELECT * FROM finance_postings ORDER BY id'), $db->select('SELECT * FROM payroll_plans ORDER BY id'), $db->select('SELECT * FROM supplemental_payrolls ORDER BY id'),
            $db->select('SELECT * FROM overtime_records ORDER BY id'), $db->select('SELECT * FROM audit_events ORDER BY id')];
        $before = $snapshot();
        assertSame(1, count($before[0]), 'a Planned posting before the upgrade');
        $applied = (new Migrator($db, productionMigrationsDir()))->apply();
        assertSame(['0034_create_finance_executions', '0035_replace_audit_events_finance_execute'], array_map(static fn ($m): string => $m->label(), $applied), 'only the BF-4f migrations run');
        assertSame([], (new Migrator($db, productionMigrationsDir()))->status(), 'head 0035, current');
        assertSame($before, $snapshot(), 'every posting, payroll, Supplemental, overtime and audit row is unchanged');
        assertSame('Planned', (string) $db->select('SELECT status FROM finance_postings')[0]['status'], 'the posting is still Planned');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM finance_executions')[0]['n'], 'no execution is seeded');
    },
];
