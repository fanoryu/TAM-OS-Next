<?php
declare(strict_types=1);

/*
 * BF-3C ScopedDatabase refusals that happen before any database work: the handle below points at
 * an unreachable port, so a statement that got past the checks would fail with DatabaseError,
 * not LogicException. Row-level checks run against MariaDB in tests/Db/ScopedDataTest.php.
 */

use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Data\DatabaseError;
use TamOs\Data\Employee\EmployeeStore;
use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Data\Scope\ScopedRecord;
use TamOs\Identity\Principal;
use TamOs\Policy\Action;
use TamOs\Policy\Policy;
use TamOs\Policy\Scope;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;

$db = static fn (): ScopedDatabase => new ScopedDatabase(new Database(DatabaseConfig::fromArray([
    'host' => '127.0.0.1', 'port' => 1, 'name' => 'tamos_test', 'user' => 'u', 'pass' => 'unreachable-by-design',
])));
$principal = static fn (string $role, ?string $employeeId): Principal => Principal::fromAccount(
    ['user_id' => str_repeat('1', 32), 'user_status' => 'active', 'has_password' => true],
    [['membership_id' => str_repeat('2', 32), 'company_id' => str_repeat('a', 32), 'role' => $role, 'employee_id' => $employeeId, 'membership_status' => 'active']],
) ?? throw new \LogicException('fixture');
$ceo = Scope::of($principal('ceo', null));
$emp = Scope::of($principal('employee', 'emp_1'));
$refusedBeforeDb = static function (callable $fn, string $label): void {
    assertThrows(\LogicException::class, $fn, $label);
};

return [
    'request input can never become scope: :company_id and :self_employee_id are refused as parameters' => static function () use ($db, $ceo, $emp, $refusedBeforeDb): void {
        foreach ([$ceo, $emp] as $scope) {
            foreach (['company_id' => str_repeat('b', 32), 'self_employee_id' => 'emp_2'] as $k => $v) {
                $refusedBeforeDb(static fn () => $db()->select($scope, EmployeeStore::LIST_SQL, [$k => $v]), 'select ' . $k);
                $refusedBeforeDb(static fn () => $db()->find($scope, 'employee', EmployeeStore::FIND_SQL, ['id' => 'x', $k => $v]), 'find ' . $k);
            }
        }
    },
    'a statement without :company_id is refused' => static function () use ($db, $ceo, $emp, $refusedBeforeDb): void {
        $refusedBeforeDb(static fn () => $db()->select($ceo, 'SELECT id, company_id, id AS owner_employee_id FROM employees'), 'company');
        $refusedBeforeDb(static fn () => $db()->select($emp, 'SELECT id, company_id, id AS owner_employee_id FROM employees WHERE id = :self_employee_id'), 'self');
    },
    'an Employee scope cannot run the company-wide statement; a CEO scope cannot run the self one' => static function () use ($db, $ceo, $emp, $refusedBeforeDb): void {
        $refusedBeforeDb(static fn () => $db()->select($emp, EmployeeStore::LIST_SQL), 'employee on the company list');
        $refusedBeforeDb(static fn () => $db()->find($emp, 'employee', EmployeeStore::FIND_SQL, ['id' => 'emp_1']), 'employee on the company find');
        $refusedBeforeDb(static fn () => $db()->select($ceo, EmployeeStore::LIST_SELF_SQL), 'ceo on the self list');
    },
    'positional parameters are refused' => static function () use ($db, $ceo, $refusedBeforeDb): void {
        $refusedBeforeDb(static fn () => $db()->select($ceo, 'SELECT id, company_id FROM employees WHERE company_id = :company_id AND id = ?', ['x']), 'positional');
    },
    'a write authorized against a record may only target that record' => static function () use ($db, $principal, $refusedBeforeDb): void {
        $p = $principal('employee', 'emp_1');
        // Tests may build a record; production gets one only from ScopedDatabase::find().
        $auth = Policy::authorize($p, Action::OvertimeUpdateSelfDraft, new ScopedRecord(Scope::of($p), 'overtime', 'ot_1', 'emp_1', 'Draft'));
        $sql = 'UPDATE overtime SET hours = :hours WHERE id = :id AND company_id = :company_id AND employee_id = :self_employee_id';
        $refusedBeforeDb(static fn () => $db()->execute($auth, $sql, ['id' => 'ot_2', 'hours' => 1]), 'another record');
        $refusedBeforeDb(static fn () => $db()->execute($auth, $sql, ['hours' => 1]), 'no id');
        $refusedBeforeDb(static fn () => $db()->execute($auth, 'UPDATE overtime SET hours = :hours WHERE id = :id AND company_id = :company_id', ['id' => 'ot_1', 'hours' => 1]), 'self write without the self predicate');
        // A correct statement passes every check and only then reaches the (unreachable) database.
        assertThrows(DatabaseError::class, static fn () => $db()->execute($auth, $sql, ['id' => 'ot_1', 'hours' => 1]), 'reaches the database');
    },
    'the employee store creates only under employee.create, with exactly the profile columns' => static function () use ($db, $principal, $refusedBeforeDb): void {
        $store = new EmployeeStore($db());
        $profile = array_fill_keys(EmployeeStore::PROFILE, null);
        $profile['employee_code'] = 'E-1';
        $profile['full_name'] = 'Fixture One';
        $profile['employment_status'] = 'Active';
        $refusedBeforeDb(static fn () => $store->create(Policy::authorize($principal('ceo', null), Action::SettingsManage), 'emp_x', $profile), 'wrong action');
        $refusedBeforeDb(static fn () => $store->create(Policy::authorize($principal('ceo', null), Action::EmployeeCreate), 'emp_x', $profile + ['company_id' => 'x']), 'an extra column');
        $refusedBeforeDb(static fn () => $store->create(Policy::authorize($principal('ceo', null), Action::EmployeeCreate), 'emp_x', array_reverse($profile, true)), 'columns out of order');
        assertThrows(DatabaseError::class, static fn () => $store->create(Policy::authorize($principal('ceo', null), Action::EmployeeCreate), 'emp_x', $profile), 'right action reaches the database');
    },
];
