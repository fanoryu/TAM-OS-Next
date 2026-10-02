<?php
declare(strict_types=1);

/*
 * BF-4a1: the Employee and audit statements, pinned. Scope predicates, the version
 * compare-and-swap, archive-only writes, the list cap and the append-only audit insert are
 * asserted on the SQL itself (no database), and the audit trail refuses values, unaudited
 * Actions and a foreign actor before it reaches the database. BF-4a2: the derived account state
 * of the CEO reads, the account.manage binding reads and the account audit insert are pinned too.
 */

use TamOs\Config\ConfigLoader;
use TamOs\Data\Audit\AuditLog;
use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Data\Employee\EmployeeStore;
use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Data\Scope\ScopedRecord;
use TamOs\Identity\Principal;
use TamOs\Policy\Action;
use TamOs\Policy\Policy;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\tempDir;

$statements = static function (): array {
    $out = [];
    foreach ((new \ReflectionClass(EmployeeStore::class))->getReflectionConstants() as $c) {
        if (str_ends_with($c->getName(), '_SQL')) {
            $out[$c->getName()] = $c->getValue();
        }
    }
    return $out;
};
$principal = static function (string $role, ?string $employeeId, string $company = 'c'): Principal {
    $user = ['user_id' => str_repeat('1', 32), 'user_status' => 'active', 'has_password' => true];
    $m = ['membership_id' => str_repeat('2', 32), 'company_id' => str_repeat($company, 32), 'membership_status' => 'active', 'role' => $role, 'employee_id' => $employeeId];
    return Principal::fromAccount($user, [$m]) ?? throw new \LogicException('fixture principal');
};
// A ScopedDatabase over a database that is never reachable: anything refused before the
// database is a LogicException; anything that reaches it is a DatabaseError.
$db = static fn (): ScopedDatabase => new ScopedDatabase(new Database(DatabaseConfig::fromConfig(ConfigLoader::fromArray([
    'env' => 'test', 'origin' => 'https://tamos.test', 'log_path' => tempDir() . '/l.log',
    'db' => ['host' => '127.0.0.1', 'port' => 1, 'name' => 'none_test', 'user' => 'u', 'pass' => 'p'],
]))));

return [
    'every employee statement names :company_id; every *_SELF_SQL also :self_employee_id' => static function () use ($statements): void {
        foreach ($statements() as $name => $sql) {
            assertTrue(preg_match('/:company_id\b/', $sql) === 1, $name . ' names :company_id');
            assertTrue(!str_contains($sql, '?'), $name . ' uses named parameters only');
            if (str_ends_with($name, '_SELF_SQL')) {
                assertTrue(preg_match('/\bAND (e\.)?id = :self_employee_id\b/', $sql) === 1, $name . ' names :self_employee_id');
            }
        }
    },
    'no employee statement deletes; update and archive are version compare-and-swaps on live records' => static function () use ($statements): void {
        foreach ($statements() as $name => $sql) {
            assertTrue(preg_match('/\b(DELETE|TRUNCATE|REPLACE)\b/i', $sql) !== 1, $name . ' never deletes');
        }
        foreach (['UPDATE_SQL', 'ARCHIVE_SQL'] as $name) {
            $sql = $statements()[$name];
            assertTrue(str_ends_with($sql, 'WHERE id = :id AND company_id = :company_id AND version = :expected_version AND archived_at IS NULL'), $name . ' predicate');
            assertTrue(str_contains($sql, 'version = version + 1, updated_at = UTC_TIMESTAMP(6)'), $name . ' bumps the version on the database clock');
        }
        assertTrue(str_starts_with(EmployeeStore::ARCHIVE_SQL, 'UPDATE employees SET archived_at = UTC_TIMESTAMP(6),'), 'archive is a soft archive');
        assertTrue(!preg_match('/\b(company_id|version|archived_at|created_at|id)\s*=\s*:/', explode(' WHERE ', EmployeeStore::UPDATE_SQL)[0]), 'update never writes id, company, version, archive or creation from input');
    },
    'the company list is non-archived by default, deterministic, and read one past its cap' => static function (): void {
        assertSame(2000, EmployeeStore::LIST_CAP);
        assertSame(EmployeeStore::LIST_CAP + 1, EmployeeStore::LIST_LIMIT);
        assertTrue(str_ends_with(EmployeeStore::LIST_PROFILES_SQL, 'WHERE e.company_id = :company_id AND e.archived_at IS NULL ORDER BY e.employee_code, e.id LIMIT 2001'), 'default list');
        assertTrue(str_ends_with(EmployeeStore::LIST_ALL_PROFILES_SQL, 'WHERE e.company_id = :company_id ORDER BY e.employee_code, e.id LIMIT 2001'), 'archived list');
        assertTrue(str_ends_with(EmployeeStore::FIND_PROFILE_SQL, 'WHERE e.id = :id AND e.company_id = :company_id'), 'CEO detail');
        assertTrue(str_ends_with(EmployeeStore::LOCK_PROFILE_SQL, 'WHERE id = :id AND company_id = :company_id FOR UPDATE'), 'the write lock');
        assertTrue(str_contains(EmployeeStore::ACTIVE_BINDING_SQL, "WHERE company_id = :company_id AND employee_id = :employee_id AND status = 'active'"), 'active binding');
        assertTrue(str_contains(EmployeeStore::CREATE_SQL, 'VALUES (:id, :company_id, :employee_code,') && str_contains(EmployeeStore::CREATE_SQL, ':monthly_base_salary, NULL, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))'), 'create: live, version 1');
    },
    'BF-4a2: the CEO reads derive accountState from the bound login, in-company, without a hash; the self read does not join it' => static function (): void {
        $join = "FROM employees e LEFT JOIN memberships m ON m.company_id = e.company_id AND m.employee_id = e.id LEFT JOIN users u ON u.id = m.user_id WHERE ";
        $state = "CASE WHEN m.id IS NULL THEN 'none' WHEN m.status <> 'active' OR u.status <> 'active' THEN 'disabled' WHEN u.password_hash IS NULL THEN 'pending' ELSE 'active' END AS account_state";
        $manageable = "CASE WHEN e.archived_at IS NULL AND (m.id IS NULL OR (m.role = 'employee' AND u.status = 'active')) THEN 1 ELSE 0 END AS account_manageable";
        foreach (['LIST_PROFILES_SQL', 'LIST_ALL_PROFILES_SQL', 'FIND_PROFILE_SQL'] as $name) {
            $sql = constant(EmployeeStore::class . '::' . $name);
            // BF-4a3: account_manageable sits between the state and the join, over the same rows.
            assertTrue(str_contains($sql, ', ' . $state . ', ' . $manageable . ' ' . $join), $name . ' derives the state over the same-company binding');
            assertTrue(!preg_match('/\bu\.password_hash\b(?! IS NULL THEN)/', $sql) && !str_contains($sql, 'u.email'), $name . ' never projects a hash or the login email');
        }
        foreach (['FIND_PROFILE_SELF_SQL', 'LOCK_PROFILE_SQL'] as $name) {
            $sql = constant(EmployeeStore::class . '::' . $name);
            assertTrue(!str_contains($sql, 'memberships') && !str_contains($sql, 'users') && !str_contains($sql, 'account_state') && !str_contains($sql, 'account_manageable'), $name . ' has no account join');
        }
        $base = 'SELECT m.id AS membership_id, m.company_id, m.employee_id AS owner_employee_id, m.user_id, m.role, m.status AS membership_status, u.status AS user_status, (u.password_hash IS NOT NULL) AS has_password FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = :company_id AND m.employee_id = :employee_id';
        assertSame($base, EmployeeStore::ACCOUNT_SQL, 'account read');
        assertSame($base . ' FOR UPDATE', EmployeeStore::LOCK_ACCOUNT_SQL, 'account lock');
    },
    'BF-4a3: account_manageable is derived inline, once per CEO read, from the joined rows only — no subquery, no further join, no per-row lookup' => static function (): void {
        foreach (['LIST_PROFILES_SQL', 'LIST_ALL_PROFILES_SQL', 'FIND_PROFILE_SQL'] as $name) {
            $sql = constant(EmployeeStore::class . '::' . $name);
            assertSame(1, substr_count($sql, 'AS account_manageable'), $name . ' projects it once');
            assertSame(1, substr_count($sql, 'SELECT'), $name . ' stays one SELECT (no subquery)');
            assertSame(2, substr_count($sql, ' JOIN '), $name . ' keeps exactly the two existing joins');
            assertSame(1, substr_count($sql, 'LEFT JOIN memberships m ON m.company_id = e.company_id AND m.employee_id = e.id'), $name . ' joins the binding in-company');
        }
        assertSame(1, preg_match("/CASE WHEN e\\.archived_at IS NULL AND \\(m\\.id IS NULL OR \\(m\\.role = 'employee' AND u\\.status = 'active'\\)\\) THEN 1 ELSE 0 END/", EmployeeStore::FIND_PROFILE_SQL), 'live AND (no login OR an active-user employee membership)');
        assertTrue(!str_contains(EmployeeStore::ACCOUNT_SQL, 'account_manageable') && !str_contains(EmployeeStore::LOCK_ACCOUNT_SQL, 'account_manageable'), 'the account.manage reads never consult it');
    },
    'BF-4a2: the account read is account.manage-only and against a record, before the database' => static function () use ($db, $principal): void {
        $store = new EmployeeStore($db());
        $ceo = $principal('ceo', null);
        $rec = new ScopedRecord(\TamOs\Policy\Scope::of($ceo), 'employee', 'emp_1', 'emp_1', null);
        assertThrows(\LogicException::class, static fn () => $store->account(Policy::authorize($ceo, Action::EmployeeUpdate, $rec), true), 'another Action');
        assertThrows(\TamOs\Data\DatabaseError::class, static fn () => $store->account(Policy::authorize($ceo, Action::AccountManage, $rec), true), 'account.manage reaches the database');
    },
    'the store refuses a self scope for the list and the wrong Action or record for a write, before the database' => static function () use ($db, $principal): void {
        $store = new EmployeeStore($db());
        $emp = \TamOs\Policy\Scope::of($principal('employee', 'emp_1'));
        assertThrows(\LogicException::class, static fn () => $store->profiles($emp, false), 'self scope list');
        $profile = array_merge(array_fill_keys(EmployeeStore::PROFILE, null), ['employee_code' => 'E', 'full_name' => 'N', 'employment_status' => 'Active']);
        $ceo = $principal('ceo', null);
        assertThrows(\LogicException::class, static fn () => $store->update(Policy::authorize($ceo, Action::EmployeeCreate), 1, $profile), 'update without a record');
        assertThrows(\LogicException::class, static fn () => $store->archive(Policy::authorize($ceo, Action::SettingsManage), 1), 'archive under another Action');
        assertThrows(\LogicException::class, static fn () => $store->lockProfile(Policy::authorize($ceo, Action::EmployeeCreate)), 'lock without a record');
    },
    'the audit insert is append-only, scope-bound and value-free' => static function (): void {
        $sql = AuditLog::APPEND_SQL;
        assertTrue(str_starts_with($sql, 'INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, target_user_id, request_id, fields)'), 'columns');
        assertTrue(str_contains($sql, 'VALUES (:company_id, UTC_TIMESTAMP(6), :actor_user_id, :actor_membership_id, :action, :entity, :id, NULL, :request_id, :fields)'), 'company from scope, time from the database, entity is the authorized :id');
        assertSame([Action::EmployeeCreate, Action::EmployeeUpdate, Action::EmployeeDelete], AuditLog::ACTIONS);
        $account = AuditLog::APPEND_ACCOUNT_SQL;
        assertSame('INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (:company_id, UTC_TIMESTAMP(6), :actor_user_id, :actor_membership_id, :action, :entity, :id, :operation, :target_user_id, :request_id, NULL)', $account, 'BF-4a2 account row: operation and target, never a value');
        assertSame(['provision', 'reissue', 'disable', 'enable'], AuditLog::ACCOUNT_OPERATIONS);
    },
    'BF-4a2: an account audit row is account.manage against its record, a known operation, a target user and the actor' => static function () use ($db, $principal): void {
        $log = new AuditLog($db());
        $ceo = $principal('ceo', null);
        $rid = str_repeat('a', 32);
        $uid = str_repeat('b', 32);
        $rec = new ScopedRecord(\TamOs\Policy\Scope::of($ceo), 'employee', 'emp_1', 'emp_1', null);
        $auth = Policy::authorize($ceo, Action::AccountManage, $rec);
        assertThrows(\LogicException::class, static fn () => $log->appendAccount(Policy::authorize($ceo, Action::EmployeeUpdate, $rec), $ceo, 'disable', $uid, $rid), 'another Action');
        assertThrows(\LogicException::class, static fn () => $log->append($auth, $ceo, 'employee', 'emp_1', [], $rid), 'account.manage never goes through the field-list append');
        foreach (['', 'delete', 'Provision', 'archive', 'login'] as $op) {
            assertThrows(\LogicException::class, static fn () => $log->appendAccount($auth, $ceo, $op, $uid, $rid), 'operation ' . $op);
        }
        foreach (['', 'login@example.test', str_repeat('B', 32), str_repeat('b', 64)] as $target) {
            assertThrows(\LogicException::class, static fn () => $log->appendAccount($auth, $ceo, 'provision', $target, $rid), 'target ' . $target);
        }
        assertThrows(\LogicException::class, static fn () => $log->appendAccount($auth, $principal('ceo', null, 'd'), 'enable', $uid, $rid), 'actor of another company');
        assertThrows(\LogicException::class, static fn () => $log->appendAccount($auth, $ceo, 'enable', $uid, 'nope'), 'request id');
        assertThrows(\TamOs\Data\DatabaseError::class, static fn () => $log->appendAccount($auth, $ceo, 'reissue', $uid, $rid), 'a valid row reaches the database');
    },
    'audit field lists hold names only — never a value — without duplicates' => static function (): void {
        assertSame('fullName,monthlyBaseSalary', AuditLog::fieldList(['fullName', 'monthlyBaseSalary']));
        assertSame(null, AuditLog::fieldList([]));
        foreach ([['Siti Rahma'], ['7500000.00'], ['full_name'], ['fullName', 'fullName'], ['a b'], ['password=x'], [str_repeat('a', 33)], ['x' => 'fullName']] as $bad) {
            assertThrows(\LogicException::class, static fn () => AuditLog::fieldList($bad), json_encode($bad));
        }
    },
    'the audit trail refuses an unaudited Action, an unknown entity, a foreign actor or no request id, before the database' => static function () use ($db, $principal): void {
        $log = new AuditLog($db());
        $ceo = $principal('ceo', null);
        $rid = str_repeat('a', 32);
        assertThrows(\LogicException::class, static fn () => $log->append(Policy::authorize($ceo, Action::SettingsManage), $ceo, 'employee', 'e1', [], $rid), 'unaudited action');
        assertThrows(\LogicException::class, static fn () => $log->append(Policy::authorize($ceo, Action::EmployeeCreate), $ceo, 'contract', 'e1', [], $rid), 'entity');
        assertThrows(\LogicException::class, static fn () => $log->append(Policy::authorize($ceo, Action::EmployeeCreate), $principal('ceo', null, 'd'), 'employee', 'e1', [], $rid), 'actor of another company');
        assertThrows(\LogicException::class, static fn () => $log->append(Policy::authorize($ceo, Action::EmployeeCreate), $ceo, 'employee', 'e1', [], 'not-a-request-id'), 'request id');
        assertThrows(\LogicException::class, static fn () => $log->append(Policy::authorize($ceo, Action::EmployeeCreate), $ceo, 'employee', 'e1', ['Rp 7.500.000'], $rid), 'a value as a field');
        assertThrows(\TamOs\Data\DatabaseError::class, static fn () => $log->append(Policy::authorize($ceo, Action::EmployeeCreate), $ceo, 'employee', 'e1', ['fullName'], $rid), 'a valid row reaches the database');
    },
];
