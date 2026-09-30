<?php
declare(strict_types=1);

/*
 * BF-3C schema: the employee authorization anchor (0009) and the binding-integrity foreign key
 * (0010) against the real, guarded MariaDB. The anchor holds no personal data; a membership's
 * employee binding must reference an anchor row of the SAME company; a bound anchor cannot be
 * deleted or moved; nothing is seeded.
 */

use TamOs\Data\Database;
use TamOs\Data\DatabaseError;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\employeeAnchor;

$refused = static fn (Database $db, string $sql, array $params, string $label): DatabaseError => assertThrows(
    DatabaseError::class,
    static fn () => $db->execute($sql, $params),
    $label,
);
$id = static fn (): string => bin2hex(random_bytes(16));
$insertMembership = 'INSERT INTO memberships (id, user_id, company_id, role, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))';
$insertEmployee = 'INSERT INTO employees (id, company_id, created_at) VALUES (?, ?, UTC_TIMESTAMP(6))';
$countEmployees = static fn (Database $db): int => (int) $db->select('SELECT COUNT(*) AS n FROM employees')[0]['n'];

return [
    'employees is exactly id, company_id, created_at — no personal data — and starts empty' => static function () use ($countEmployees): void {
        $db = authDatabase();
        $cols = $db->select("SELECT COLUMN_NAME AS c, COLUMN_TYPE AS t, IS_NULLABLE AS n, CHARACTER_SET_NAME AS cs, COLLATION_NAME AS coll FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' ORDER BY ORDINAL_POSITION");
        assertSame([
            ['c' => 'id', 't' => 'varchar(64)', 'n' => 'NO', 'cs' => 'ascii', 'coll' => 'ascii_bin'],
            ['c' => 'company_id', 't' => 'char(32)', 'n' => 'NO', 'cs' => 'ascii', 'coll' => 'ascii_bin'],
            ['c' => 'created_at', 't' => 'datetime(6)', 'n' => 'NO', 'cs' => null, 'coll' => null],
        ], $cols);
        // The anchor id has the same domain as memberships.employee_id.
        $binding = $db->select("SELECT COLUMN_TYPE AS t, CHARACTER_SET_NAME AS cs, COLLATION_NAME AS coll FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'memberships' AND COLUMN_NAME = 'employee_id'")[0];
        assertSame(['t' => 'varchar(64)', 'cs' => 'ascii', 'coll' => 'ascii_bin'], $binding);
        $keys = $db->select("SELECT INDEX_NAME AS i, NON_UNIQUE AS nu, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' GROUP BY INDEX_NAME, NON_UNIQUE ORDER BY INDEX_NAME");
        assertSame([['i' => 'employees_company_id', 'nu' => 0, 'cols' => 'company_id,id'], ['i' => 'PRIMARY', 'nu' => 0, 'cols' => 'id']],
            array_map(static fn (array $r): array => ['i' => $r['i'], 'nu' => (int) $r['nu'], 'cols' => $r['cols']], $keys));
        assertSame(0, $countEmployees($db), 'no employee is seeded');
    },
    'the binding FK is (company_id, employee_id) → employees (company_id, id), RESTRICT on delete and update' => static function (): void {
        $db = authDatabase();
        $fk = $db->select("SELECT DELETE_RULE AS d, UPDATE_RULE AS u, REFERENCED_TABLE_NAME AS r FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'memberships_employee_fk'");
        assertSame([['d' => 'RESTRICT', 'u' => 'RESTRICT', 'r' => 'employees']], $fk);
        $cols = $db->select("SELECT COLUMN_NAME AS c, REFERENCED_COLUMN_NAME AS rc FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'memberships_employee_fk' ORDER BY ORDINAL_POSITION");
        assertSame([['c' => 'company_id', 'rc' => 'company_id'], ['c' => 'employee_id', 'rc' => 'id']], $cols);
    },
    'a CEO without a binding is accepted; an Employee without one is refused' => static function () use ($refused, $id, $insertMembership): void {
        $db = authDatabase();
        $ceo = authFixture($db, ['role' => 'ceo', 'employeeId' => null]);
        assertSame(null, $db->select('SELECT employee_id FROM memberships WHERE id = ?', [$ceo['membershipId']])[0]['employee_id']);
        $u = authFixture($db, ['companyId' => $ceo['companyId'], 'membership' => false]);
        $e = $refused($db, $insertMembership, [$id(), $u['userId'], $ceo['companyId'], 'employee', null, 'active'], 'unbound employee');
        assertSame(4025, $e->driverCode, 'CHECK memberships_employee_bound');
    },
    'a same-company binding is accepted; a missing or cross-company target is refused' => static function () use ($refused, $id, $insertMembership): void {
        $db = authDatabase();
        $a = authFixture($db, ['role' => 'employee', 'employeeId' => 'emp_a1']);
        assertSame('emp_a1', $db->select('SELECT employee_id FROM memberships WHERE id = ?', [$a['membershipId']])[0]['employee_id'], 'same company');
        $b = authFixture($db, ['role' => 'employee', 'employeeId' => 'emp_b1']);
        $u = authFixture($db, ['companyId' => $a['companyId'], 'membership' => false]);
        assertSame(1452, $refused($db, $insertMembership, [$id(), $u['userId'], $a['companyId'], 'employee', 'emp_missing', 'active'], 'missing target')->driverCode);
        assertSame(1452, $refused($db, $insertMembership, [$id(), $u['userId'], $a['companyId'], 'employee', 'emp_b1', 'active'], 'cross-company target')->driverCode);
        assertSame(1452, $refused($db, $insertMembership, [$id(), $u['userId'], $a['companyId'], 'ceo', 'emp_b1', 'active'], 'a CEO binding is held to the same rule')->driverCode);
        // Re-pointing an existing binding is held to the same rule.
        assertSame(1452, $refused($db, 'UPDATE memberships SET employee_id = ? WHERE id = ?', ['emp_b1', $a['membershipId']], 'rebind across companies')->driverCode);
        assertSame(1452, $refused($db, 'UPDATE memberships SET employee_id = ? WHERE id = ?', ['emp_missing', $a['membershipId']], 'rebind to nothing')->driverCode);
        assertSame(1452, $refused($db, 'UPDATE memberships SET company_id = ? WHERE id = ?', [$b['companyId'], $a['membershipId']], 'move the membership, keep the binding')->driverCode);
    },
    'a bound employee cannot be deleted or moved; an unbound one can be deleted' => static function () use ($refused, $countEmployees): void {
        $db = authDatabase();
        $a = authFixture($db, ['role' => 'employee', 'employeeId' => 'emp_bound']);
        $b = authFixture($db);
        employeeAnchor($db, $a['companyId'], 'emp_free');
        assertSame(1451, $refused($db, 'DELETE FROM employees WHERE id = ?', ['emp_bound'], 'delete a bound employee')->driverCode);
        assertSame(1451, $refused($db, 'UPDATE employees SET company_id = ? WHERE id = ?', [$b['companyId'], 'emp_bound'], 'move a bound employee')->driverCode);
        assertSame(1451, $refused($db, 'UPDATE employees SET id = ? WHERE id = ?', ['emp_renamed', 'emp_bound'], 'rename a bound employee')->driverCode);
        assertSame('emp_bound', $db->select('SELECT employee_id FROM memberships WHERE id = ?', [$a['membershipId']])[0]['employee_id'], 'binding intact');
        assertSame(1, $db->execute('DELETE FROM employees WHERE id = ?', ['emp_free']), 'unbound delete');
        assertSame(1, $countEmployees($db));
    },
    'the anchor refuses an empty id, an unknown company and a duplicate id in any company' => static function () use ($refused, $id, $insertEmployee): void {
        $db = authDatabase();
        $a = authFixture($db);
        $b = authFixture($db);
        assertSame(4025, $refused($db, $insertEmployee, ['', $a['companyId']], 'empty id')->driverCode);
        assertSame(1452, $refused($db, $insertEmployee, ['emp_x', $id()], 'unknown company')->driverCode);
        employeeAnchor($db, $a['companyId'], 'emp_1');
        assertSame(1062, $refused($db, $insertEmployee, ['emp_1', $a['companyId']], 'same company')->driverCode);
        assertSame(1062, $refused($db, $insertEmployee, ['emp_1', $b['companyId']], 'another company')->driverCode);
        assertSame(1451, $refused($db, 'DELETE FROM companies WHERE id = ?', [$a['companyId']], 'a company with employees')->driverCode);
    },
];
