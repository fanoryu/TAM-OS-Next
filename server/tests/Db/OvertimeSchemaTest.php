<?php
declare(strict_types=1);

/*
 * BF-4b1 schema against the real, guarded MariaDB: overtime_records (0020) — exactly the
 * non-money record, its tenant FKs and the CHECKs that hold D-BF4b1-1 (date inside the month),
 * D-BF4b1-2 (hours) and D-BF4b-5 (status) at the database too — and the audit vocabulary of 0021,
 * which admits the overtime rows while every employee and account rule keeps its meaning.
 *
 * BF-4b2 revisions: 0022 appends exactly the five valuation snapshot columns (the twelve BF-4b1
 * columns are unchanged and still hold no money) and the CHECKs that make Approved ⇔ a complete
 * TAM-OT-1 snapshot; 0023 admits 'approve' under overtime.manage and nowhere else.
 */

use TamOs\Data\Database;
use TamOs\Data\DatabaseError;
use TamOs\Data\Migration\Migrator;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\employeeAnchor;
use function TamOs\Tests\migrationFixture;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\testDatabase;

$refused = static fn (Database $db, string $sql, array $params, string $label): DatabaseError => assertThrows(
    DatabaseError::class,
    static fn () => $db->execute($sql, $params),
    $label,
);
$insert = 'INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))';
$id = static fn (): string => bin2hex(random_bytes(16));
$audit = 'INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, ?, ?, ?, ?, ?, ?, NULL)';

return [
    'overtime_records is the twelve BF-4b1 non-money columns followed by exactly the five BF-4b2 valuation snapshot columns — no rate, schedule, contract or payroll column — and starts empty' => static function (): void {
        $db = authDatabase();
        $cols = array_map(
            static fn (array $r): array => [$r['c'], (string) preg_replace('/^int\(\d+\)/', 'int', (string) $r['t']), $r['n'], $r['cs'], $r['coll']],
            $db->select("SELECT COLUMN_NAME AS c, COLUMN_TYPE AS t, IS_NULLABLE AS n, CHARACTER_SET_NAME AS cs, COLLATION_NAME AS coll FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'overtime_records' ORDER BY ORDINAL_POSITION"),
        );
        assertSame([
            ['id', 'char(32)', 'NO', 'ascii', 'ascii_bin'],
            ['company_id', 'char(32)', 'NO', 'ascii', 'ascii_bin'],
            ['employee_id', 'varchar(64)', 'NO', 'ascii', 'ascii_bin'],
            ['month_key', 'char(7)', 'NO', 'ascii', 'ascii_bin'],
            ['overtime_date', 'date', 'YES', null, null],
            ['hours', 'decimal(5,2)', 'NO', null, null],
            ['work_description', 'varchar(160)', 'YES', 'utf8mb4', 'utf8mb4_unicode_ci'],
            ['notes', 'text', 'YES', 'utf8mb4', 'utf8mb4_unicode_ci'],
            ['status', 'varchar(16)', 'NO', 'ascii', 'ascii_bin'],
            ['version', 'int unsigned', 'NO', null, null],
            ['created_at', 'datetime(6)', 'NO', null, null],
            ['updated_at', 'datetime(6)', 'NO', null, null],
            ['valuation_method', 'varchar(16)', 'YES', 'ascii', 'ascii_bin'],
            ['valuation_salary', 'decimal(15,2)', 'YES', null, null],
            ['valuation_standard_hours', 'decimal(5,2)', 'YES', null, null],
            ['approved_amount', 'decimal(16,2)', 'YES', null, null],
            ['approved_at', 'datetime(6)', 'YES', null, null],
        ], $cols);
        foreach (array_column($cols, 0) as $c) {
            assertTrue(preg_match('/rate|hourly|schedule|contract|payroll|paid|payment|finance|multiplier|currency/i', $c) !== 1, $c . ' is no rate, schedule, contract, payroll or finance column');
        }
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM overtime_records')[0]['n'], 'nothing seeded');
        $keys = array_column($db->select("SELECT INDEX_NAME AS i, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'overtime_records' GROUP BY INDEX_NAME"), 'c', 'i');
        ksort($keys, SORT_STRING);
        assertSame(['PRIMARY' => 'id', 'overtime_records_company_id' => 'company_id,id', 'overtime_records_employee' => 'company_id,employee_id,month_key', 'overtime_records_month' => 'company_id,month_key,employee_id'], $keys);
    },
    'the CHECKs hold the month, date-in-month, hours, status, version and id rules at the database' => static function () use ($refused, $insert, $id): void {
        $db = authDatabase();
        $a = authFixture($db);
        employeeAnchor($db, $a['companyId'], 'e_1');
        $ok = static fn (array $over = []): array => array_values(array_merge(['id' => $id(), 'c' => $a['companyId'], 'e' => 'e_1', 'm' => '2026-10', 'd' => null, 'h' => '1.00', 's' => 'Draft', 'v' => 1], $over));
        foreach ([['d' => '2026-10-31', 'h' => '744.00'], ['m' => '2024-02', 'd' => '2024-02-29', 'h' => '0.25'], ['s' => 'Submitted'], ['s' => 'Reviewed'], ['s' => 'Rejected', 'v' => 9]] as $good) {
            $db->execute($insert, $ok($good));
        }
        foreach ([
            'date in the next month' => ['d' => '2026-11-01'], 'date in another year' => ['m' => '2025-10', 'd' => '2026-10-01'],
            'month 13' => ['m' => '2026-13'], 'month without zero' => ['m' => '2026-1'], 'month with day' => ['m' => '2026-1-'],
            'zero hours' => ['h' => '0.00'], 'negative hours' => ['h' => '-1.00'], 'over 744' => ['h' => '744.25'], 'not a quarter' => ['h' => '1.10'],
            'Approved' => ['s' => 'Approved'], 'Committed to Payroll' => ['s' => 'Committed to Payroll'], 'lower-case draft' => ['s' => 'draft'],
            'version 0' => ['v' => 0], 'a non-hex id' => ['id' => 'ot_1'], 'an upper-case id' => ['id' => strtoupper($id())],
        ] as $label => $bad) {
            $refused($db, $insert, $ok($bad), $label);
        }
        assertSame(5, (int) $db->select('SELECT COUNT(*) AS n FROM overtime_records')[0]['n'], 'only the valid rows');
    },
    'tenant FKs: an overtime record needs its company and an employee of the SAME company, and pins that employee' => static function () use ($refused, $insert, $id): void {
        $db = authDatabase();
        $a = authFixture($db);
        $b = authFixture($db);
        employeeAnchor($db, $a['companyId'], 'e_a');
        employeeAnchor($db, $b['companyId'], 'e_b');
        $refused($db, $insert, [$id(), $a['companyId'], 'e_b', '2026-10', null, '1.00', 'Draft', 1], 'an employee of another company');
        $refused($db, $insert, [$id(), $a['companyId'], 'e_none', '2026-10', null, '1.00', 'Draft', 1], 'an absent employee');
        $refused($db, $insert, [$id(), str_repeat('f', 32), 'e_a', '2026-10', null, '1.00', 'Draft', 1], 'an absent company');
        $rec = $id();
        $db->execute($insert, [$rec, $a['companyId'], 'e_a', '2026-10', null, '1.00', 'Draft', 1]);
        $refused($db, 'DELETE FROM employees WHERE id = ?', ['e_a'], 'an employee with overtime cannot be deleted (RESTRICT)');
        $refused($db, 'UPDATE overtime_records SET company_id = ? WHERE id = ?', [$b['companyId'], $rec], 'an overtime record cannot move company');
        $fks = $db->select("SELECT CONSTRAINT_NAME AS n, UPDATE_RULE AS u, DELETE_RULE AS d FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'overtime_records' ORDER BY CONSTRAINT_NAME");
        assertSame([['n' => 'overtime_records_company_fk', 'u' => 'RESTRICT', 'd' => 'RESTRICT'], ['n' => 'overtime_records_employee_fk', 'u' => 'RESTRICT', 'd' => 'RESTRICT']], $fks, 'no cascade');
    },
    '0022–0023 migrate a schema-0021 database forward: every BF-4b1 row and overtime audit row stays valid and unchanged, with no snapshot' => static function (): void {
        $db = testDatabase();
        $upTo = static function (int $version): string {
            $files = [];
            foreach (glob(productionMigrationsDir() . '/*.sql') ?: [] as $path) {
                if ((int) substr(basename($path), 0, 4) <= $version) {
                    $files[basename($path)] = (string) file_get_contents($path);
                }
            }
            return migrationFixture($files);
        };
        (new Migrator($db, $upTo(21)))->apply();
        $company = bin2hex(random_bytes(16));
        $db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$company]);
        $user = bin2hex(random_bytes(16));
        $membership = bin2hex(random_bytes(16));
        $db->execute("INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (?, 'pre-0022@example.test', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$user]);
        $db->execute("INSERT INTO memberships (id, user_id, company_id, role, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, 'ceo', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$membership, $user, $company]);
        $db->execute("INSERT INTO employees (id, company_id, employee_code, full_name, monthly_base_salary, created_at, updated_at) VALUES ('e_1', ?, 'E1', 'Fixture e_1', '3500000.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$company]);
        foreach (['Draft' => 1, 'Submitted' => 2, 'Reviewed' => 3, 'Rejected' => 4] as $status => $v) {
            $db->execute("INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at) VALUES (?, ?, 'e_1', '2026-10', '2026-10-0" . $v . "', '2.25', 'Fabricated', NULL, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
                [str_repeat((string) $v, 32), $company, $status, $v]);
        }
        foreach ([['overtime.createSelfDraft', null], ['overtime.submitSelf', 'submit'], ['overtime.manage', 'review'], ['overtime.manage', 'reject']] as [$action, $op]) {
            $db->execute("INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, ?, 'overtime', 'x1', ?, NULL, ?, NULL)",
                [$company, $user, $membership, $action, $op, str_repeat('a', 32)]);
        }
        $records = static fn (): array => $db->select('SELECT id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at FROM overtime_records ORDER BY id');
        $audit = static fn (): array => $db->select('SELECT id, action, entity, entity_id, operation, fields FROM audit_events ORDER BY id');
        [$beforeRecords, $beforeAudit] = [$records(), $audit()];
        $applied = (new Migrator($db, productionMigrationsDir()))->apply();
        // BF-4d authorized revision: 0029–0031 follow (head 0031). Was: through 0028.
        // BF-4e authorized revision: 0032–0033 follow (head 0033). Was: through 0031.
        assertSame(['0022_add_overtime_records_valuation', '0023_replace_audit_events_overtime_approve', '0024_create_payroll_plans', '0025_create_payroll_plan_overtime', '0026_replace_audit_events_payroll_checks', '0027_add_payroll_plans_commit_key', '0028_replace_audit_events_payroll_commit', '0029_create_supplemental_payrolls', '0030_create_supplemental_payroll_overtime', '0031_replace_audit_events_supplemental_checks', '0032_create_finance_postings', '0033_replace_audit_events_finance_post'],
            array_map(static fn ($m): string => $m->label(), $applied), 'only the BF-4b2 migrations run, then BF-4c1, BF-4c2, BF-4d and BF-4e (which change no overtime row)');
        assertSame([], (new Migrator($db, productionMigrationsDir()))->status(), 'head 0033, current');
        assertSame($beforeRecords, $records(), 'every BF-4b1 record is unchanged');
        assertSame($beforeAudit, $audit(), 'every overtime audit row is unchanged');
        assertSame(4, (int) $db->select('SELECT COUNT(*) AS n FROM overtime_records WHERE valuation_method IS NULL AND valuation_salary IS NULL AND valuation_standard_hours IS NULL AND approved_amount IS NULL AND approved_at IS NULL')[0]['n'], 'no snapshot on a pre-0022 row');
        // The migrated rows still satisfy every CHECK: a row write (re-checked by MariaDB) is accepted for each.
        assertSame(4, $db->execute('UPDATE overtime_records SET version = version + 1'), 'the CHECKs hold for every pre-0022 row');
    },
    '0022: Approved if and only if a complete TAM-OT-1 snapshot — method, salary > 0, 160 standard hours, a whole-Rupiah amount, a time' => static function () use ($refused, $id): void {
        $db = authDatabase();
        $a = authFixture($db);
        employeeAnchor($db, $a['companyId'], 'e_1');
        $sql = 'INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at, valuation_method, valuation_salary, valuation_standard_hours, approved_amount, approved_at) VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, ?, 2, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), ?, ?, ?, ?, ?)';
        $now = '2026-10-03 12:00:00.000000';
        $row = static fn (array $over = []): array => array_values(array_merge(['id' => $id(), 'c' => $a['companyId'], 'e' => 'e_1', 'm' => '2026-10', 'h' => '10.00', 's' => 'Approved',
            'method' => 'TAM-OT-1', 'salary' => '3500000.00', 'std' => '160.00', 'amount' => '218750.00', 'at' => $now], $over));
        $db->execute($sql, $row());
        $db->execute($sql, $row(['amount' => '0.00', 'salary' => '0.01', 'h' => '0.25']));
        $db->execute($sql, $row(['amount' => '46500000000000.00', 'salary' => '9999999999999.99', 'h' => '744.00']));
        foreach (['Draft', 'Submitted', 'Reviewed', 'Rejected'] as $s) {
            $db->execute($sql, $row(['s' => $s, 'method' => null, 'salary' => null, 'std' => null, 'amount' => null, 'at' => null]));
        }
        foreach ([
            'Approved without a snapshot' => ['method' => null, 'salary' => null, 'std' => null, 'amount' => null, 'at' => null],
            'Approved without a method' => ['method' => null], 'Approved without a salary' => ['salary' => null], 'Approved without standard hours' => ['std' => null],
            'Approved without an amount' => ['amount' => null], 'Approved without a time' => ['at' => null],
            'a Reviewed row with a snapshot' => ['s' => 'Reviewed'], 'a Rejected row with a snapshot' => ['s' => 'Rejected'], 'a Draft with an amount only' => ['s' => 'Draft', 'method' => null, 'salary' => null, 'std' => null, 'at' => null],
            'another method' => ['method' => 'TAM-OT-2'], 'a statutory divisor' => ['std' => '173.00'], 'salary 0' => ['salary' => '0.00'], 'a negative salary' => ['salary' => '-1.00'],
            'a negative amount' => ['amount' => '-1.00'], 'a fractional amount' => ['amount' => '218750.50'], 'Committed to Payroll' => ['s' => 'Committed to Payroll'],
            'an amount beyond DECIMAL(16,2)' => ['amount' => '100000000000000.00'],
        ] as $label => $bad) {
            $refused($db, $sql, $row($bad), $label);
        }
        assertSame(7, (int) $db->select('SELECT COUNT(*) AS n FROM overtime_records')[0]['n'], 'only the valid rows');
        $approved = $db->select("SELECT id FROM overtime_records WHERE status = 'Approved' ORDER BY id LIMIT 1")[0]['id'];
        foreach ([
            'status back to Reviewed' => "UPDATE overtime_records SET status = 'Reviewed' WHERE id = ?",
            'the snapshot dropped' => 'UPDATE overtime_records SET approved_amount = NULL WHERE id = ?',
        ] as $label => $update) {
            $refused($db, $update, [$approved], $label);
        }
    },
    '0021: overtime audit rows are accepted with their operation; every employee and account rule still holds' => static function () use ($refused, $audit): void {
        $db = authDatabase();
        $a = authFixture($db);
        $rid = str_repeat('a', 32);
        $row = static fn (string $action, string $entity, ?string $operation, ?string $target = null): array => [$a['companyId'], $a['userId'], $a['membershipId'], $action, $entity, 'x1', $operation, $target, $rid];
        foreach ([
            ['overtime.createSelfDraft', 'overtime', null], ['overtime.updateSelfDraft', 'overtime', null], ['overtime.deleteSelfDraft', 'overtime', null],
            ['overtime.submitSelf', 'overtime', 'submit'], ['overtime.manage', 'overtime', 'review'], ['overtime.manage', 'overtime', 'reject'], ['overtime.manage', 'overtime', 'approve'],
            ['employee.create', 'employee', null], ['employee.update', 'employee', null], ['employee.delete', 'employee', null],
            ['account.manage', 'employee', 'provision', $a['userId']], ['account.manage', 'employee', 'enable', $a['userId']],
        ] as $good) {
            $db->execute($audit, $row(...$good));
        }
        foreach ([
            'submit without its operation' => ['overtime.submitSelf', 'overtime', null], 'submit named review' => ['overtime.submitSelf', 'overtime', 'review'],
            'manage without an operation' => ['overtime.manage', 'overtime', null], 'manage named submit' => ['overtime.manage', 'overtime', 'submit'],
            'submitSelf named approve' => ['overtime.submitSelf', 'overtime', 'approve'], 'create with an operation' => ['overtime.createSelfDraft', 'overtime', 'submit'],
            'approve under updateSelfDraft' => ['overtime.updateSelfDraft', 'overtime', 'approve'], 'account.manage named approve' => ['account.manage', 'employee', 'approve', $a['userId']],
            'an unknown overtime operation' => ['overtime.manage', 'overtime', 'void'],
            'an overtime action on an employee' => ['overtime.createSelfDraft', 'employee', null], 'an employee action on overtime' => ['employee.create', 'overtime', null],
            'account.manage without an operation' => ['account.manage', 'employee', null, $a['userId']], 'account.manage named review' => ['account.manage', 'employee', 'review', $a['userId']],
            'account.manage without a target' => ['account.manage', 'employee', 'provision'], 'an employee row with an operation' => ['employee.update', 'employee', 'enable'],
            'an unknown action' => ['overtime.approve', 'overtime', null], 'an unknown entity' => ['payroll.manage', 'payrollPlan', null],
        ] as $label => $bad) {
            $refused($db, $audit, $row(...$bad), $label);
        }
        assertSame(12, (int) $db->select('SELECT COUNT(*) AS n FROM audit_events')[0]['n'], 'only the valid rows');
        assertTrue($db->select("SELECT COUNT(*) AS n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_events' AND REFERENCED_TABLE_NAME = 'overtime_records'")[0]['n'] == 0,
            'no audit FK to overtime: a deleted Draft keeps its audit row');
    },
];
