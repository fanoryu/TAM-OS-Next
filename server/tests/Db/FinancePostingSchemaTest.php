<?php
declare(strict_types=1);

/*
 * BF-4e Finance posting schema against the real MariaDB (migrations 0032–0033): the columns of
 * finance_postings, its CHECKs (exactly one source — a base plan or a Supplemental document, named
 * by source_kind; Planned only; a positive whole-Rupiah amount; a 32-hex id and key; a canonical
 * month), at most one posting per source and each key once per company, the composite tenant FKs to
 * the source, the employee and the company without cascade (a posted source can never be removed),
 * the 0033 audit vocabulary ('post' under payroll.manage and supplemental.manage only), and the
 * forward migration of a schema-0031 database whose payroll, Supplemental, overtime and audit rows
 * survive unchanged with no posting seeded.
 */

use TamOs\Data\Database;
use TamOs\Data\Migration\Migrator;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\migrationFixture;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\testDatabase;

$refused = static function (Database $db, string $sql, array $params, string $label): void {
    try {
        $db->execute($sql, $params);
    } catch (\Throwable) {
        return;
    }
    throw new \TamOs\Tests\AssertionFailed('expected the database to refuse: ' . $label);
};
/** A company with employee e_1, a Committed base plan of e_1 for 2026-10 and a Committed Supplemental document of it — test-only SQL, fabricated values. */
$company = static function (Database $db): array {
    $c = bin2hex(random_bytes(16));
    $db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$c]);
    $e1 = 'e_1_' . substr($c, 0, 6);
    $db->execute("INSERT INTO employees (id, company_id, employee_code, full_name, monthly_base_salary, created_at, updated_at) VALUES (?, ?, ?, 'Fixture e_1', '3500000.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$e1, $c, 'E1' . substr($c, 0, 6)]);
    $plan = bin2hex(random_bytes(16));
    $db->execute("INSERT INTO payroll_plans (id, company_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, '2026-10', 'Committed', 'CODE', 'Fixture', NULL, '3500000.00', '0.00', '0.00', 0, '3500000.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), ?, 2, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
        [$plan, $c, $e1, bin2hex(random_bytes(16))]);
    $doc = bin2hex(random_bytes(16));
    $db->execute("INSERT INTO supplemental_payrolls (id, company_id, payroll_plan_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, overtime_amount, overtime_hours, overtime_count, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, ?, '2026-10', 'Committed', 'CODE', 'Fixture', NULL, '21875.00', '1.00', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), ?, 4, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
        [$doc, $c, $plan, $e1, bin2hex(random_bytes(16))]);
    return ['id' => $c, 'e1' => $e1, 'plan' => $plan, 'doc' => $doc];
};
/** Inserts one posting (test-only SQL); $over replaces any column value. */
$posting = static function (Database $db, array $c, array $over = []): string {
    $v = $over + ['id' => bin2hex(random_bytes(16)), 'company' => $c['id'], 'kind' => 'payrollPlan', 'plan' => $c['plan'], 'doc' => null, 'employee' => $c['e1'],
        'month' => '2026-10', 'amount' => '3500000.00', 'status' => 'Planned', 'key' => bin2hex(random_bytes(16))];
    $db->execute('INSERT INTO finance_postings (id, company_id, source_kind, payroll_plan_id, supplemental_payroll_id, employee_id, month_key, amount, status, idempotency_key, posted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))',
        [$v['id'], $v['company'], $v['kind'], $v['plan'], $v['doc'], $v['employee'], $v['month'], $v['amount'], $v['status'], $v['key']]);
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
    'finance_postings columns: identifiers ascii_bin, an exact DECIMAL amount, DATETIME(6), InnoDB utf8mb4 — no execution, payment, actual, account, category or monthly-plan column' => static function (): void {
        $db = authDatabase();
        $cols = [];
        foreach ($db->select("SELECT COLUMN_NAME AS c, COLUMN_TYPE AS t, IS_NULLABLE AS n, COLLATION_NAME AS k FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_postings' ORDER BY ORDINAL_POSITION") as $r) {
            $cols[(string) $r['c']] = $r['t'] . ' ' . $r['n'] . ' ' . ($r['k'] ?? '-');
        }
        assertSame([
            'id' => 'char(32) NO ascii_bin', 'company_id' => 'char(32) NO ascii_bin', 'source_kind' => 'varchar(24) NO ascii_bin',
            'payroll_plan_id' => 'char(32) YES ascii_bin', 'supplemental_payroll_id' => 'char(32) YES ascii_bin',
            'employee_id' => 'varchar(64) NO ascii_bin', 'month_key' => 'char(7) NO ascii_bin', 'amount' => 'decimal(17,2) NO -',
            'status' => 'varchar(16) NO ascii_bin', 'idempotency_key' => 'char(32) NO ascii_bin', 'posted_at' => 'datetime(6) NO -',
        ], $cols);
        $info = $db->select("SELECT ENGINE AS e, TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_postings'")[0];
        assertSame(['InnoDB', 'utf8mb4_unicode_ci'], [(string) $info['e'], (string) $info['c']]);
    },
    'finance_postings CHECKs: exactly one source named by source_kind, Planned only, a positive whole-Rupiah amount, a canonical id, key and month' => static function () use ($company, $posting, $expectRefused): void {
        $db = authDatabase();
        $c = $company($db);
        foreach ([
            'no source' => ['plan' => null],
            'both sources' => ['doc' => $c['doc']],
            'a Supplemental kind naming a plan' => ['kind' => 'supplementalPayroll'],
            'a plan kind naming a document' => ['plan' => null, 'doc' => $c['doc']],
            'an unknown kind' => ['kind' => 'manual'],
            'an Executed status' => ['status' => 'Executed'],
            'a Paid status' => ['status' => 'Paid'],
            'an Actual status' => ['status' => 'Actual'],
            'a Reversed status' => ['status' => 'Reversed'],
            'a zero amount' => ['amount' => '0.00'],
            'a negative amount' => ['amount' => '-1.00'],
            'a fractional amount' => ['amount' => '1.50'],
            'an uppercase key' => ['key' => strtoupper(bin2hex(random_bytes(16)))],
            'a short key' => ['key' => 'abc'],
            'a malformed id' => ['id' => 'pst_1'],
            'a malformed month' => ['month' => '2026-13'],
        ] as $label => $over) {
            $expectRefused(static fn () => $posting($db, $c, $over), $label);
        }
        $posting($db, $c);
        $posting($db, $c, ['kind' => 'supplementalPayroll', 'plan' => null, 'doc' => $c['doc'], 'amount' => '21875.00']);
        assertSame(2, (int) $db->select('SELECT COUNT(*) AS n FROM finance_postings WHERE company_id = ?', [$c['id']])[0]['n'], 'one posting of each source kind is storable');
    },
    'at most one posting per source, ever; each key once per company — another company may hold the same key' => static function () use ($company, $posting, $expectRefused): void {
        $db = authDatabase();
        $c = $company($db);
        $key = bin2hex(random_bytes(16));
        $posting($db, $c, ['key' => $key]);
        $expectRefused(static fn () => $posting($db, $c), 'a second posting of the base plan');
        $posting($db, $c, ['kind' => 'supplementalPayroll', 'plan' => null, 'doc' => $c['doc']]);
        $expectRefused(static fn () => $posting($db, $c, ['kind' => 'supplementalPayroll', 'plan' => null, 'doc' => $c['doc']]), 'a second posting of the document');
        $d = $company($db);
        $expectRefused(static fn () => $posting($db, $c, ['plan' => $d['plan'], 'key' => $key]), 'the same key twice in one company');
        $posting($db, $d, ['key' => $key]);
        assertSame(2, (int) $db->select('SELECT COUNT(*) AS n FROM finance_postings WHERE idempotency_key = ?', [$key])[0]['n'], 'another company may hold the same key');
        foreach (['finance_postings_payroll_plan' => ['company_id', 'payroll_plan_id'], 'finance_postings_supplemental_payroll' => ['company_id', 'supplemental_payroll_id'],
            'finance_postings_idempotency_key' => ['company_id', 'idempotency_key']] as $index => $want) {
            $idx = array_map(static fn (array $r): string => (string) $r['c'], $db->select("SELECT COLUMN_NAME AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_postings' AND INDEX_NAME = ? AND NON_UNIQUE = 0 ORDER BY SEQ_IN_INDEX", [$index]));
            assertSame($want, $idx, $index . ' is unique per company');
        }
    },
    'tenant keys: a foreign or absent plan, document or employee is refused; a posted source can never be removed; no FK cascades' => static function () use ($refused, $company, $posting, $expectRefused): void {
        $db = authDatabase();
        $c = $company($db);
        $d = $company($db);
        foreach ([
            "another company's plan" => ['plan' => $d['plan']],
            'an absent plan' => ['plan' => bin2hex(random_bytes(16))],
            "another company's document" => ['kind' => 'supplementalPayroll', 'plan' => null, 'doc' => $d['doc']],
            'an absent document' => ['kind' => 'supplementalPayroll', 'plan' => null, 'doc' => bin2hex(random_bytes(16))],
            "another company's employee" => ['employee' => $d['e1']],
            'an absent employee' => ['employee' => 'nobody'],
            'an absent company' => ['company' => bin2hex(random_bytes(16))],
        ] as $label => $over) {
            $expectRefused(static fn () => $posting($db, $c, $over), $label);
        }
        $posting($db, $c);
        $posting($db, $c, ['kind' => 'supplementalPayroll', 'plan' => null, 'doc' => $c['doc']]);
        $refused($db, 'DELETE FROM supplemental_payrolls WHERE id = ?', [$c['doc']], 'a posted document cannot be removed (RESTRICT)');
        $refused($db, 'DELETE FROM payroll_plans WHERE id = ?', [$c['plan']], 'a posted plan cannot be removed (RESTRICT)');
        $rules = $db->select("SELECT DELETE_RULE AS d, UPDATE_RULE AS u FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_postings'");
        assertSame(4, count($rules), 'four foreign keys: company, plan, document, employee');
        foreach ($rules as $r) {
            assertTrue(in_array($r['d'], ['RESTRICT', 'NO ACTION'], true) && in_array($r['u'], ['RESTRICT', 'NO ACTION'], true), 'no cascade, no set null');
        }
    },
    "0033: the audit vocabulary admits 'post' under payroll.manage on payrollPlan and supplemental.manage on supplementalPayroll only, and keeps every existing rule" => static function () use ($expectRefused): void {
        $db = authDatabase();
        $c = bin2hex(random_bytes(16));
        $db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$c]);
        $user = bin2hex(random_bytes(16));
        $membership = bin2hex(random_bytes(16));
        $db->execute("INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (?, ?, NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$user, 'audit-' . substr($c, 0, 8) . '@example.test']);
        $db->execute("INSERT INTO memberships (id, user_id, company_id, role, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, 'ceo', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$membership, $user, $c]);
        $row = static fn (string $action, string $entity, ?string $op) => $db->execute("INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, ?, ?, 'x1', ?, NULL, ?, NULL)",
            [$c, $user, $membership, $action, $entity, $op, str_repeat('a', 32)]);
        $row('payroll.manage', 'payrollPlan', 'post');
        $row('supplemental.manage', 'supplementalPayroll', 'post');
        foreach (['create', 'recalculate', 'review', 'approve', 'return', 'cancel', 'commit'] as $op) {
            $row('supplemental.manage', 'supplementalPayroll', $op);
            $row('payroll.manage', 'payrollPlan', $op);
        }
        foreach ([
            'post under overtime.manage' => ['overtime.manage', 'overtime', 'post'],
            'post under account.manage' => ['account.manage', 'employee', 'post'],
            'post on an employee row' => ['employee.update', 'employee', 'post'],
            'post on the wrong entity' => ['payroll.manage', 'supplementalPayroll', 'post'],
            'finance.manage' => ['finance.manage', 'payrollPlan', 'post'],
            'finance.execute' => ['finance.execute', 'payrollPlan', 'post'],
            'a financePosting entity' => ['payroll.manage', 'financePosting', 'post'],
            'an execute operation' => ['payroll.manage', 'payrollPlan', 'execute'],
            'a pay operation' => ['supplemental.manage', 'supplementalPayroll', 'pay'],
            'a reverse operation' => ['payroll.manage', 'payrollPlan', 'reverse'],
            'no operation' => ['payroll.manage', 'payrollPlan', null],
        ] as $label => [$action, $entity, $op]) {
            $expectRefused(static fn () => $row($action, $entity, $op), $label);
        }
        $row('overtime.manage', 'overtime', 'approve');
        assertSame(17, (int) $db->select('SELECT COUNT(*) AS n FROM audit_events WHERE company_id = ?', [$c])[0]['n'], 'the existing vocabulary still holds');
    },
    '0032–0033 migrate a schema-0031 database forward: payroll, Supplemental, overtime and audit rows survive unchanged; no posting is seeded' => static function (): void {
        $db = testDatabase();
        $files = [];
        foreach (glob(productionMigrationsDir() . '/*.sql') ?: [] as $path) {
            if ((int) substr(basename($path), 0, 4) <= 31) {
                $files[basename($path)] = (string) file_get_contents($path);
            }
        }
        (new Migrator($db, migrationFixture($files)))->apply();
        $c = bin2hex(random_bytes(16));
        $db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$c]);
        $db->execute("INSERT INTO employees (id, company_id, employee_code, full_name, monthly_base_salary, created_at, updated_at) VALUES ('e_1', ?, 'E1', 'Fixture e_1', '3500000.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$c]);
        $plan = bin2hex(random_bytes(16));
        $db->execute("INSERT INTO payroll_plans (id, company_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at) VALUES (?, ?, 'e_1', '2026-10', 'Committed', 'E1', 'Fixture e_1', NULL, '3500000.00', '0.00', '0.00', 0, '3500000.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), ?, 3, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$plan, $c, bin2hex(random_bytes(16))]);
        $db->execute("INSERT INTO supplemental_payrolls (id, company_id, payroll_plan_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, overtime_amount, overtime_hours, overtime_count, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, 'e_1', '2026-10', 'Committed', 'E1', 'Fixture e_1', NULL, '21875.00', '1.00', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), ?, 4, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [bin2hex(random_bytes(16)), $c, $plan, bin2hex(random_bytes(16))]);
        $snapshot = static fn (): array => [$db->select('SELECT * FROM payroll_plans ORDER BY id'), $db->select('SELECT * FROM supplemental_payrolls ORDER BY id'), $db->select('SELECT * FROM overtime_records ORDER BY id'), $db->select('SELECT * FROM audit_events ORDER BY id')];
        $before = $snapshot();
        $applied = (new Migrator($db, productionMigrationsDir()))->apply();
        assertSame(['0032_create_finance_postings', '0033_replace_audit_events_finance_post'], array_map(static fn ($m): string => $m->label(), $applied), 'only the BF-4e migrations run');
        assertSame([], (new Migrator($db, productionMigrationsDir()))->status(), 'head 0033, current');
        assertSame($before, $snapshot(), 'every payroll, Supplemental, overtime and audit row is unchanged');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM finance_postings')[0]['n'], 'no posting is seeded');
    },
];
