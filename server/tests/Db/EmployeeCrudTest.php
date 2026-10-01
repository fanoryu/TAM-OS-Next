<?php
declare(strict_types=1);

/*
 * BF-4a1 Employee domain end to end against the real MariaDB: real login → real session →
 * production routes → EmployeeService → EmployeeStore / AuditLog. Create, scoped reads, the
 * versioned update, the soft archive, the list cap, the audit row written by the same
 * transaction, and rollback when the audit row cannot be written. Fabricated data only.
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Employee\EmployeeView;
use TamOs\Http\Kernel;
use TamOs\Http\Response;
use function TamOs\Tests\assertNoLeak;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\authKernel;
use function TamOs\Tests\envelope;
use function TamOs\Tests\loginRequest;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\requestId;
use function TamOs\Tests\sessionCookieToken;
use function TamOs\Tests\sessionRequest;
use function TamOs\Tests\testDbConfig;

/**
 * Company A: a CEO and an Employee bound to e_a1. Company B: a CEO and no employee. Everyone
 * logs in for real; the kernel is the production one over the same connection.
 *
 * @return array{db: Database, k: Kernel, a: string, b: string, s: array<string, array{token: string, csrf: string, userId: string, membershipId: string}>}
 */
$world = static function (): array {
    $db = authDatabase();
    $auth = AuthData::fromDatabase($db);
    $k = authKernel(testDbConfig(), $auth, productionMigrationsDir());
    $ceoA = authFixture($db);
    $a = $ceoA['companyId'];
    $fixtures = ['ceoA' => $ceoA, 'empA1' => authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a1']), 'ceoB' => authFixture($db)];
    $s = [];
    foreach ($fixtures as $name => $f) {
        $r = $k->handle(loginRequest($f['email'], (string) $f['password']), requestId());
        assertSame(200, $r->status, 'login ' . $name);
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken'], 'userId' => $f['userId'], 'membershipId' => $f['membershipId']];
    }
    return ['db' => $db, 'k' => $k, 'a' => $a, 'b' => $fixtures['ceoB']['companyId'], 's' => $s];
};
$get = static fn (array $w, string $who, string $path, string $query = ''): Response
    => $w['k']->handle(sessionRequest('GET', $path, $w['s'][$who]['token'], null, '', ['query' => $query]), requestId());
$post = static fn (array $w, string $who, string $path, array $body): Response
    => $w['k']->handle(sessionRequest('POST', $path, $w['s'][$who]['token'], $w['s'][$who]['csrf'], json_encode($body, JSON_THROW_ON_ERROR)), requestId());
$ok = static function (Response $r, string $label): array {
    assertSame(200, $r->status, $label . ' (' . substr($r->body, 0, 160) . ')');
    return envelope($r)['data'];
};
$code = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
$create = static fn (array $w, string $who, array $body): array => $ok($post($w, $who, '/api/employees/create', $body), 'create')['employee'];
$audits = static fn (Database $db, string $entityId): array => $db->select('SELECT company_id, actor_user_id, actor_membership_id, action, entity, entity_id, target_user_id, request_id, fields FROM audit_events WHERE entity_id = ? ORDER BY id', [$entityId]);
$row = static fn (Database $db, string $id): ?array => $db->select('SELECT company_id, employee_code, full_name, job_title, monthly_base_salary, archived_at, version FROM employees WHERE id = ?', [$id])[0] ?? null;

return [
    'CEO create: server id, own company, version 1, exact money, and its audit row in the same transaction' => static function () use ($world, $create, $audits, $row): void {
        $w = $world();
        $e = $create($w, 'ceoA', ['employeeCode' => 'EMP-100', 'fullName' => 'Fabricated One', 'jobTitle' => 'Engineer', 'monthlyBaseSalary' => '7500000']);
        assertTrue(preg_match('/^[0-9a-f]{32}$/', $e['id']) === 1, 'server-generated opaque id');
        assertSame(EmployeeView::DETAIL_FIELDS, array_keys($e), 'detail DTO');
        assertSame(['EMP-100', 'Fabricated One', 'Engineer', null, 'Active', false, '7500000.00', 1],
            [$e['employeeCode'], $e['fullName'], $e['jobTitle'], $e['department'], $e['employmentStatus'], $e['archived'], $e['monthlyBaseSalary'], $e['version']]);
        $r = $row($w['db'], $e['id']);
        assertSame([$w['a'], '7500000.00', null, 1], [(string) $r['company_id'], (string) $r['monthly_base_salary'], $r['archived_at'], (int) $r['version']], 'stored in company A');
        $log = $audits($w['db'], $e['id']);
        assertSame(1, count($log), 'one audit row');
        assertSame([$w['a'], $w['s']['ceoA']['userId'], $w['s']['ceoA']['membershipId'], 'employee.create', 'employee', $e['id'], null, requestId(), 'employeeCode,fullName,jobTitle,employmentStatus,monthlyBaseSalary'],
            array_values(array_map(static fn ($v) => $v === null ? null : (string) $v, $log[0])), 'actor from the session, names only');
        assertTrue(!str_contains((string) $log[0]['fields'], 'Fabricated') && !str_contains((string) $log[0]['fields'], '7500000'), 'no value in the audit row');
    },
    'duplicate employee code: 409 (case-insensitive within a company), nothing written; another company may reuse it' => static function () use ($world, $post, $create, $code): void {
        $w = $world();
        $create($w, 'ceoA', ['employeeCode' => 'EMP-100', 'fullName' => 'Fabricated One']);
        $events = (int) $w['db']->select('SELECT COUNT(*) AS n FROM audit_events')[0]['n'];
        assertSame([409, 'conflict'], $code($post($w, 'ceoA', '/api/employees/create', ['employeeCode' => 'EMP-100', 'fullName' => 'Other'])), 'same code');
        assertSame([409, 'conflict'], $code($post($w, 'ceoA', '/api/employees/create', ['employeeCode' => 'emp-100', 'fullName' => 'Other'])), 'case variant');
        assertSame(0, (int) $w['db']->select("SELECT COUNT(*) AS n FROM employees WHERE company_id = ? AND full_name = 'Other'", [$w['a']])[0]['n'], 'no second row');
        assertSame($events, (int) $w['db']->select('SELECT COUNT(*) AS n FROM audit_events')[0]['n'], 'no audit row for a refused create');
        $create($w, 'ceoB', ['employeeCode' => 'EMP-100', 'fullName' => 'Company B One']);
    },
    'CEO list: own company only, non-archived by default, (employee_code, id) order, list fields only' => static function () use ($world, $get, $ok, $create): void {
        $w = $world();
        foreach (['EMP-200', 'EMP-050', 'EMP-100'] as $c) {
            $create($w, 'ceoA', ['employeeCode' => $c, 'fullName' => 'Fabricated ' . $c, 'monthlyBaseSalary' => 100, 'notes' => 'private']);
        }
        $create($w, 'ceoB', ['employeeCode' => 'EMP-075', 'fullName' => 'Company B']);
        $list = $ok($get($w, 'ceoA', '/api/employees'), 'list')['employees'];
        $codes = array_column($list, 'employeeCode');
        assertSame(['EMP-050', 'EMP-100', 'EMP-200'], array_values(array_filter($codes, static fn ($c): bool => str_starts_with($c, 'EMP-'))), 'ordered, own company');
        assertTrue(in_array('e_a1', $codes, true) && !in_array('EMP-075', $codes, true), 'the bound fixture is listed; company B is not');
        foreach ($list as $item) {
            assertSame(EmployeeView::LIST_FIELDS, array_keys($item), 'list DTO');
        }
        assertNoLeak(json_encode($list, JSON_THROW_ON_ERROR), ['private', '100.00', $w['b']]);
        assertSame(['EMP-075'], array_column($ok($get($w, 'ceoB', '/api/employees'), 'list B')['employees'], 'employeeCode'), 'company B sees only its own');
    },
    'archive is soft: hidden by default, listed with ?archived=1, readable, never deleted, then frozen' => static function () use ($world, $get, $post, $ok, $code, $create, $audits, $row): void {
        $w = $world();
        $e = $create($w, 'ceoA', ['employeeCode' => 'EMP-900', 'fullName' => 'To Archive']);
        $archived = $ok($post($w, 'ceoA', '/api/employees/archive', ['id' => $e['id'], 'expectedVersion' => 1]), 'archive')['employee'];
        assertSame([true, 2], [$archived['archived'], $archived['version']]);
        $r = $row($w['db'], $e['id']);
        assertTrue($r !== null && $r['archived_at'] !== null, 'the row is still there, archived');
        assertTrue(!in_array('EMP-900', array_column($ok($get($w, 'ceoA', '/api/employees'), 'default')['employees'], 'employeeCode'), true), 'hidden by default');
        $all = $ok($get($w, 'ceoA', '/api/employees', 'archived=1'), 'archived=1')['employees'];
        assertSame([true], array_column(array_values(array_filter($all, static fn ($i): bool => $i['employeeCode'] === 'EMP-900')), 'archived'), 'listed when asked');
        assertSame(true, $ok($get($w, 'ceoA', '/api/employee', 'id=' . $e['id']), 'detail')['employee']['archived'], 'detail of an archived employee');
        assertSame([409, 'conflict'], $code($post($w, 'ceoA', '/api/employees/update', ['id' => $e['id'], 'expectedVersion' => 2, 'jobTitle' => 'x'])), 'archived update');
        assertSame([409, 'conflict'], $code($post($w, 'ceoA', '/api/employees/archive', ['id' => $e['id'], 'expectedVersion' => 2])), 'archive again');
        $log = $audits($w['db'], $e['id']);
        assertSame([['employee.create', null], ['employee.delete', 'archived']], array_map(static fn (array $l): array => [(string) $l['action'], $l['action'] === 'employee.delete' ? (string) $l['fields'] : null], $log), 'create then archive');
    },
    'update: changed fields only, version + 1, stale version 409, a no-op keeps the version, a code collision 409' => static function () use ($world, $post, $ok, $code, $create, $audits, $row): void {
        $w = $world();
        $e = $create($w, 'ceoA', ['employeeCode' => 'EMP-300', 'fullName' => 'Fabricated Three', 'monthlyBaseSalary' => '100']);
        $create($w, 'ceoA', ['employeeCode' => 'EMP-301', 'fullName' => 'Neighbour']);
        $u = $ok($post($w, 'ceoA', '/api/employees/update', ['id' => $e['id'], 'expectedVersion' => 1, 'jobTitle' => 'Lead', 'fullName' => 'Fabricated Three', 'monthlyBaseSalary' => 100]), 'update')['employee'];
        assertSame(['Lead', 2, '100.00'], [$u['jobTitle'], $u['version'], $u['monthlyBaseSalary']]);
        $log = $audits($w['db'], $e['id']);
        assertSame(['employee.update', 'jobTitle'], [(string) $log[1]['action'], (string) $log[1]['fields']], 'only the changed field is named');
        assertSame([409, 'conflict'], $code($post($w, 'ceoA', '/api/employees/update', ['id' => $e['id'], 'expectedVersion' => 1, 'jobTitle' => 'Stale'])), 'stale version');
        assertSame(['Lead', 2], [(string) $row($w['db'], $e['id'])['job_title'], (int) $row($w['db'], $e['id'])['version']], 'a stale write changes nothing');
        $same = $ok($post($w, 'ceoA', '/api/employees/update', ['id' => $e['id'], 'expectedVersion' => 2, 'jobTitle' => 'Lead']), 'no-op')['employee'];
        assertSame(2, $same['version'], 'a no-op is not a write');
        assertSame(2, count($audits($w['db'], $e['id'])), 'and is not audited');
        assertSame([409, 'conflict'], $code($post($w, 'ceoA', '/api/employees/update', ['id' => $e['id'], 'expectedVersion' => 2, 'employeeCode' => 'EMP-301'])), 'code collision');
        assertSame('EMP-300', (string) $row($w['db'], $e['id'])['employee_code'], 'unchanged after a collision');
    },
    'archive is refused while an active login is bound; allowed once that membership is disabled; no account is touched' => static function () use ($world, $post, $ok, $code): void {
        $w = $world();
        assertSame([409, 'conflict'], $code($post($w, 'ceoA', '/api/employees/archive', ['id' => 'e_a1', 'expectedVersion' => 1])), 'bound to an active membership');
        $w['db']->execute("UPDATE memberships SET status = 'disabled' WHERE user_id = ?", [$w['s']['empA1']['userId']]);
        assertSame(true, $ok($post($w, 'ceoA', '/api/employees/archive', ['id' => 'e_a1', 'expectedVersion' => 1]), 'archive')['employee']['archived']);
        $m = $w['db']->select('SELECT m.status AS ms, u.status AS us, m.employee_id AS e FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.user_id = ?', [$w['s']['empA1']['userId']])[0];
        assertSame(['disabled', 'active', 'e_a1'], [(string) $m['ms'], (string) $m['us'], (string) $m['e']], 'membership and user unchanged by the archive');
    },
    'employment status never changes a login' => static function () use ($world, $get, $post, $ok): void {
        $w = $world();
        $ok($post($w, 'ceoA', '/api/employees/update', ['id' => 'e_a1', 'expectedVersion' => 1, 'employmentStatus' => 'Terminated']), 'terminate');
        assertSame(200, $get($w, 'empA1', '/api/employee', 'id=e_a1')->status, 'the bound Employee still signs in and reads');
        $m = $w['db']->select('SELECT status FROM memberships WHERE user_id = ?', [$w['s']['empA1']['userId']])[0];
        assertSame('active', (string) $m['status'], 'membership untouched');
    },
    'Employee self-read returns only the self projection; another record is 404; writes are 403 or 404' => static function () use ($world, $get, $post, $ok, $code, $create): void {
        $w = $world();
        $w['db']->execute("UPDATE employees SET notes = 'ceo only', monthly_base_salary = '5000000.00' WHERE id = 'e_a1'");
        $other = $create($w, 'ceoA', ['employeeCode' => 'EMP-400', 'fullName' => 'Colleague']);
        $self = $ok($get($w, 'empA1', '/api/employee', 'id=e_a1'), 'self')['employee'];
        assertSame(EmployeeView::SELF_FIELDS, array_keys($self), 'self DTO');
        assertSame('5000000.00', $self['monthlyBaseSalary'], 'own salary');
        assertNoLeak(json_encode($self, JSON_THROW_ON_ERROR), ['ceo only', $w['a']]);
        assertSame([404, 'not_found'], $code($get($w, 'empA1', '/api/employee', 'id=' . $other['id'])), 'colleague');
        assertSame([403, 'forbidden'], $code($get($w, 'empA1', '/api/employees')), 'no list');
        assertSame([403, 'forbidden'], $code($post($w, 'empA1', '/api/employees/update', ['id' => 'e_a1', 'expectedVersion' => 1, 'phone' => '0812'])), 'own record, CEO-only update');
        assertSame([403, 'forbidden'], $code($post($w, 'empA1', '/api/employees/archive', ['id' => 'e_a1', 'expectedVersion' => 1])), 'own record, CEO-only archive');
        assertSame([404, 'not_found'], $code($post($w, 'empA1', '/api/employees/update', ['id' => $other['id'], 'expectedVersion' => 1, 'phone' => '0812'])), 'colleague update');
        assertSame([403, 'forbidden'], $code($post($w, 'empA1', '/api/employees/create', ['employeeCode' => 'X', 'fullName' => 'Y'])), 'create');
    },
    'a failing audit append rolls back the employee write it records (create, update, archive)' => static function () use ($world, $post, $code, $create, $row): void {
        $w = $world();
        $e = $create($w, 'ceoA', ['employeeCode' => 'EMP-500', 'fullName' => 'Before']);
        // Test-only DDL: the rows written so far satisfy this CHECK and every further audit insert
        // violates it — inside the transaction of the write it records.
        $last = (string) $w['db']->select('SELECT MAX(occurred_at) AS m FROM audit_events')[0]['m'];
        assertTrue(preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/', $last) === 1, 'a database timestamp');
        usleep(2000);
        $w['db']->execute("ALTER TABLE audit_events ADD CONSTRAINT test_block_audit CHECK (occurred_at <= '" . $last . "')");
        assertSame([500, 'internal_error'], $code($post($w, 'ceoA', '/api/employees/create', ['employeeCode' => 'EMP-501', 'fullName' => 'Lost'])), 'create');
        assertSame(0, (int) $w['db']->select("SELECT COUNT(*) AS n FROM employees WHERE employee_code = 'EMP-501'")[0]['n'], 'no employee without its audit row');
        assertSame([500, 'internal_error'], $code($post($w, 'ceoA', '/api/employees/update', ['id' => $e['id'], 'expectedVersion' => 1, 'fullName' => 'After'])), 'update');
        assertSame(['Before', 1], [(string) $row($w['db'], $e['id'])['full_name'], (int) $row($w['db'], $e['id'])['version']], 'update rolled back');
        assertSame([500, 'internal_error'], $code($post($w, 'ceoA', '/api/employees/archive', ['id' => $e['id'], 'expectedVersion' => 1])), 'archive');
        assertSame([null, 1], [$row($w['db'], $e['id'])['archived_at'], (int) $row($w['db'], $e['id'])['version']], 'archive rolled back');
    },
    'the company list fails closed above 2000 entitled rows instead of truncating' => static function () use ($world, $get, $ok, $code): void {
        $w = $world();
        $insert = static function (Database $db, string $company, int $from, int $count): void {
            $values = [];
            $params = [];
            for ($i = $from; $i < $from + $count; $i++) {
                $values[] = "(?, ?, ?, 'Fabricated', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))";
                array_push($params, 'cap_' . $i, $company, sprintf('CAP-%05d', $i));
            }
            $db->execute('INSERT INTO employees (id, company_id, employee_code, full_name, created_at, updated_at) VALUES ' . implode(', ', $values), $params);
        };
        $insert($w['db'], $w['b'], 0, 2000);
        assertSame(2000, count($ok($get($w, 'ceoB', '/api/employees'), 'at the cap')['employees']), 'exactly the cap is served');
        $insert($w['db'], $w['b'], 2000, 1);
        assertSame([500, 'internal_error'], $code($get($w, 'ceoB', '/api/employees')), 'above the cap');
        assertSame(1, count($ok($get($w, 'ceoA', '/api/employees'), 'company A unaffected')['employees']), 'company A has only its fixture');
    },
];
