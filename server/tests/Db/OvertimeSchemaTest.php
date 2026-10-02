<?php
declare(strict_types=1);

/*
 * BF-4b1 schema against the real, guarded MariaDB: overtime_records (0020) — exactly the
 * non-money record, its tenant FKs and the CHECKs that hold D-BF4b1-1 (date inside the month),
 * D-BF4b1-2 (hours) and D-BF4b-5 (status) at the database too — and the audit vocabulary of 0021,
 * which admits the overtime rows while every employee and account rule keeps its meaning.
 */

use TamOs\Data\Database;
use TamOs\Data\DatabaseError;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\employeeAnchor;

$refused = static fn (Database $db, string $sql, array $params, string $label): DatabaseError => assertThrows(
    DatabaseError::class,
    static fn () => $db->execute($sql, $params),
    $label,
);
$insert = 'INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))';
$id = static fn (): string => bin2hex(random_bytes(16));
$audit = 'INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, ?, ?, ?, ?, ?, ?, NULL)';

return [
    'overtime_records is exactly the non-money record — no amount, rate, salary, schedule, contract or payroll column — and starts empty' => static function (): void {
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
        ], $cols);
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
    '0021: overtime audit rows are accepted with their operation; every employee and account rule still holds' => static function () use ($refused, $audit): void {
        $db = authDatabase();
        $a = authFixture($db);
        $rid = str_repeat('a', 32);
        $row = static fn (string $action, string $entity, ?string $operation, ?string $target = null): array => [$a['companyId'], $a['userId'], $a['membershipId'], $action, $entity, 'x1', $operation, $target, $rid];
        foreach ([
            ['overtime.createSelfDraft', 'overtime', null], ['overtime.updateSelfDraft', 'overtime', null], ['overtime.deleteSelfDraft', 'overtime', null],
            ['overtime.submitSelf', 'overtime', 'submit'], ['overtime.manage', 'overtime', 'review'], ['overtime.manage', 'overtime', 'reject'],
            ['employee.create', 'employee', null], ['employee.update', 'employee', null], ['employee.delete', 'employee', null],
            ['account.manage', 'employee', 'provision', $a['userId']], ['account.manage', 'employee', 'enable', $a['userId']],
        ] as $good) {
            $db->execute($audit, $row(...$good));
        }
        foreach ([
            'submit without its operation' => ['overtime.submitSelf', 'overtime', null], 'submit named review' => ['overtime.submitSelf', 'overtime', 'review'],
            'manage without an operation' => ['overtime.manage', 'overtime', null], 'manage named submit' => ['overtime.manage', 'overtime', 'submit'],
            'manage named approve' => ['overtime.manage', 'overtime', 'approve'], 'create with an operation' => ['overtime.createSelfDraft', 'overtime', 'submit'],
            'an overtime action on an employee' => ['overtime.createSelfDraft', 'employee', null], 'an employee action on overtime' => ['employee.create', 'overtime', null],
            'account.manage without an operation' => ['account.manage', 'employee', null, $a['userId']], 'account.manage named review' => ['account.manage', 'employee', 'review', $a['userId']],
            'account.manage without a target' => ['account.manage', 'employee', 'provision'], 'an employee row with an operation' => ['employee.update', 'employee', 'enable'],
            'an unknown action' => ['overtime.approve', 'overtime', null], 'an unknown entity' => ['payroll.manage', 'payrollPlan', null],
        ] as $label => $bad) {
            $refused($db, $audit, $row(...$bad), $label);
        }
        assertSame(11, (int) $db->select('SELECT COUNT(*) AS n FROM audit_events')[0]['n'], 'only the valid rows');
        assertTrue($db->select("SELECT COUNT(*) AS n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_events' AND REFERENCED_TABLE_NAME = 'overtime_records'")[0]['n'] == 0,
            'no audit FK to overtime: a deleted Draft keeps its audit row');
    },
];
