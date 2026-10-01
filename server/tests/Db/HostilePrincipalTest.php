<?php
declare(strict_types=1);

/*
 * BF-3C hostile-principal matrix (SDR-0002 §7, §8.3, E11 for the employee anchor), end to end:
 * real login → real session cookie → SessionPrincipalResolver → Kernel → Policy →
 * ScopedDatabase → EmployeeStore → MariaDB.
 *
 * The routes are TEST-ONLY (no production business endpoint exists in BF-3C); they follow the
 * rule every business route must follow: a record-bearing action loads the record under the
 * principal's scope first (absent or out of scope → 404), then asks Policy (→ 403).
 * Overtime has no backend table yet, so its CeoOrOwnDraft cases run Policy against principals
 * resolved from real sessions.
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Data\Employee\EmployeeStore;
use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Data\Scope\ScopedRecord;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Http\Kernel;
use TamOs\Http\Request;
use TamOs\Http\Response;
use TamOs\Http\Route;
use TamOs\Http\RouteAuth;
use TamOs\Identity\AuthSession;
use TamOs\Identity\Principal;
use TamOs\Identity\SessionPrincipalResolver;
use TamOs\Log\Logger;
use TamOs\Policy\Action;
use TamOs\Policy\Policy;
use TamOs\Policy\Scope;
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

/** The test-only business routes, over the real scoped store. */
$routes = static function (EmployeeStore $store, ScopedDatabase $scoped): array {
    $scopeOf = static fn (?AuthSession $s): Scope => Scope::of(($s ?? throw new \LogicException('required route'))->principal);
    $idFrom = static function (array $json): string {
        if (array_keys($json) !== ['id'] || !is_string($json['id'])) {
            throw new ApiError(ErrorCode::ValidationFailed, 'body must be exactly {"id"}', fields: ['id']);
        }
        return $json['id'];
    };
    $idQuery = static function (Request $r): string {
        parse_str($r->query, $q);
        return is_string($q['id'] ?? null) ? $q['id'] : throw new ApiError(ErrorCode::ValidationFailed, fields: ['id']);
    };
    $loadOr404 = static fn (Scope $scope, string $id): ScopedRecord => $store->find($scope, $id) ?? throw new ApiError(ErrorCode::NotFound);
    $recordAction = static fn (Action $action) => static function (Request $r, ?AuthSession $s, array $json) use ($scopeOf, $idFrom, $loadOr404, $action): array {
        $record = $loadOr404($scopeOf($s), $idFrom($json));
        Policy::authorize($s->principal, $action, $record);
        return ['authorized' => $action->value];
    };
    return [
        new Route('GET', '/api/test/employee', static fn (Request $r, ?AuthSession $s): array => ['id' => $loadOr404($scopeOf($s), $idQuery($r))->id], ['id'], RouteAuth::Required),
        new Route('GET', '/api/test/employees', static fn (Request $r, ?AuthSession $s): array => ['ids' => $store->listIds($scopeOf($s))], [], RouteAuth::Required),
        // A deliberately wrong route: always runs the company-wide statement. ScopedDatabase must refuse it for an Employee.
        new Route('GET', '/api/test/employees-unsafe', static fn (Request $r, ?AuthSession $s): array => ['rows' => count($scoped->select($scopeOf($s), EmployeeStore::LIST_SQL))], [], RouteAuth::Required),
        new Route('POST', '/api/test/employee-update', $recordAction(Action::EmployeeUpdate), [], RouteAuth::Required, Action::EmployeeUpdate),
        new Route('POST', '/api/test/employee-delete', $recordAction(Action::EmployeeDelete), [], RouteAuth::Required, Action::EmployeeDelete),
        new Route('POST', '/api/test/employees', static function (Request $r, ?AuthSession $s, array $json) use ($store, $idFrom): array {
            $id = $idFrom($json);
            $profile = array_merge(array_fill_keys(EmployeeStore::PROFILE, null), ['employee_code' => substr($id, 0, 32), 'full_name' => 'Fixture ' . $id, 'employment_status' => 'Active']);
            $store->create(Policy::authorize(($s ?? throw new \LogicException('required'))->principal, Action::EmployeeCreate), $id, $profile);
            return ['created' => true];
        }, [], RouteAuth::Required, Action::EmployeeCreate),
        new Route('POST', '/api/test/settings', static fn (): array => ['done' => true], [], RouteAuth::Required, Action::SettingsManage),
    ];
};

/**
 * Company A: CEO (unbound), Employees e_a1 and e_a2, unbound anchor e_a3. Company B: a CEO and
 * anchor e_b1. Everyone logs in for real.
 *
 * @return array{db: Database, k: Kernel, a: string, b: string, s: array<string, array{token: string, csrf: string, userId: string}>}
 */
$world = static function () use ($routes): array {
    $db = authDatabase();
    $auth = AuthData::fromDatabase($db);
    $login = authKernel(testDbConfig(), $auth, productionMigrationsDir());
    $ceoA = authFixture($db);
    $a = $ceoA['companyId'];
    $fixtures = [
        'ceoA' => $ceoA,
        'empA1' => authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a1']),
        'empA2' => authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a2']),
        'ceoB' => authFixture($db),
    ];
    employeeAnchor($db, $a, 'e_a3');
    employeeAnchor($db, $fixtures['ceoB']['companyId'], 'e_b1');
    $s = [];
    foreach ($fixtures as $name => $f) {
        $r = $login->handle(loginRequest($f['email'], (string) $f['password']), requestId());
        assertSame(200, $r->status, 'login ' . $name);
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken'], 'userId' => $f['userId']];
    }
    $scoped = new ScopedDatabase($db);
    $config = testDbConfig();
    $k = new Kernel($routes(new EmployeeStore($scoped), $scoped), new SessionPrincipalResolver($auth), $config, new Logger($config->logPath, $config->env));
    return ['db' => $db, 'k' => $k, 'a' => $a, 'b' => $fixtures['ceoB']['companyId'], 's' => $s];
};
$get = static fn (array $w, string $who, string $path, string $query = ''): Response
    => $w['k']->handle(sessionRequest('GET', $path, $who === '' ? null : $w['s'][$who]['token'], null, '', ['query' => $query]), requestId());
$post = static fn (array $w, string $who, string $path, string $body, ?string $csrf = null): Response
    => $w['k']->handle(sessionRequest('POST', $path, $who === '' ? null : $w['s'][$who]['token'], $csrf ?? ($who === '' ? null : $w['s'][$who]['csrf']), $body), requestId());
$status = static fn (Response $r): array => [$r->status, $r->status === 200 ? envelope($r)['data'] : (envelope($r)['error']['code'] ?? null)];
$principalOf = static function (array $w, string $who): Principal {
    $session = (new SessionPrincipalResolver(AuthData::fromDatabase($w['db'])))->resolve(sessionRequest('GET', '/api/auth/me', $w['s'][$who]['token']));
    return ($session ?? throw new \LogicException('no session for ' . $who))->principal;
};

return [
    '401: no session, an unknown token, and an expired, revoked or disabled identity' => static function () use ($world, $get, $post, $status): void {
        $w = $world();
        assertSame([401, 'unauthenticated'], $status($get($w, '', '/api/test/employees')), 'no session');
        assertSame([401, 'unauthenticated'], $status($post($w, '', '/api/test/settings', '{}')), 'no session, mutation');
        $forged = $w['k']->handle(sessionRequest('GET', '/api/test/employees', str_repeat('Z', 43)), requestId());
        assertSame([401, 'unauthenticated'], $status($forged), 'unknown token');
        $hash = static fn (string $who): string => hash('sha256', $w['s'][$who]['token']);
        $cases = [
            'idle-expired session' => ['empA1', 'UPDATE sessions SET last_seen_at = UTC_TIMESTAMP(6) - INTERVAL 31 MINUTE WHERE token_hash = ?', 'hash'],
            'absolute-expired session' => ['empA2', 'UPDATE sessions SET absolute_expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE token_hash = ?', 'hash'],
            'revoked session' => ['ceoB', 'UPDATE sessions SET revoked_at = UTC_TIMESTAMP(6) WHERE token_hash = ?', 'hash'],
        ];
        foreach ($cases as $label => [$who, $sql]) {
            assertSame(200, $get($w, $who, '/api/test/employees')->status, $label . ': live before');
            $w['db']->execute($sql, [$hash($who)]);
            assertSame([401, 'unauthenticated'], $status($get($w, $who, '/api/test/employees')), $label);
        }
        $w2 = $world();
        foreach (['disabled user' => ['empA1', "UPDATE users SET status = 'disabled' WHERE id = ?"],
            'disabled membership' => ['empA2', "UPDATE memberships SET status = 'disabled' WHERE user_id = ?"]] as $label => [$who, $sql]) {
            $w2['db']->execute($sql, [$w2['s'][$who]['userId']]);
            assertSame([401, 'unauthenticated'], $status($get($w2, $who, '/api/test/employees')), $label);
            assertSame([401, 'unauthenticated'], $status($post($w2, $who, '/api/test/settings', '{}')), $label . ', mutation');
        }
    },
    '401: an unknown role or an unbound Employee resolves to no principal (constraints bypassed on purpose)' => static function () use ($world, $get, $status): void {
        $w = $world();
        $w['db']->execute('SET SESSION check_constraint_checks = 0');
        try {
            $w['db']->execute("UPDATE memberships SET role = 'admin' WHERE user_id = ?", [$w['s']['ceoA']['userId']]);
            $w['db']->execute('UPDATE memberships SET employee_id = NULL WHERE user_id = ?', [$w['s']['empA1']['userId']]);
        } finally {
            $w['db']->execute('SET SESSION check_constraint_checks = 1');
        }
        assertSame([401, 'unauthenticated'], $status($get($w, 'ceoA', '/api/test/employees')), 'unknown role');
        assertSame([401, 'unauthenticated'], $status($get($w, 'empA1', '/api/test/employees')), 'employee without binding');
        assertSame(200, $get($w, 'empA2', '/api/test/employees')->status, 'untouched colleague still works');
    },
    'unknown action: no Action exists for it, so nothing can authorize it' => static function (): void {
        foreach (['employee.read', 'admin.all', 'data.export', ''] as $name) {
            assertSame(null, Action::tryFrom($name), $name);
        }
    },
    'CEO: same-company read and actions succeed; another company is 404 and absent from lists' => static function () use ($world, $get, $post, $status): void {
        $w = $world();
        assertSame([200, ['id' => 'e_a2']], $status($get($w, 'ceoA', '/api/test/employee', 'id=e_a2')), 'same company');
        assertSame([200, ['ids' => ['e_a1', 'e_a2', 'e_a3']]], $status($get($w, 'ceoA', '/api/test/employees')), 'company-wide list');
        assertSame([200, ['ids' => ['e_b1']]], $status($get($w, 'ceoB', '/api/test/employees')), 'the other company sees only its own');
        assertSame([200, ['authorized' => 'employee.update']], $status($post($w, 'ceoA', '/api/test/employee-update', '{"id":"e_a1"}')), 'update');
        assertSame([200, ['authorized' => 'employee.delete']], $status($post($w, 'ceoA', '/api/test/employee-delete', '{"id":"e_a3"}')), 'delete');
        assertSame([200, ['done' => true]], $status($post($w, 'ceoA', '/api/test/settings', '{}')), 'record-free');
        assertSame([404, 'not_found'], $status($get($w, 'ceoA', '/api/test/employee', 'id=e_b1')), 'cross-company read');
        assertSame([404, 'not_found'], $status($post($w, 'ceoA', '/api/test/employee-update', '{"id":"e_b1"}')), 'cross-company action');
        assertSame([404, 'not_found'], $status($post($w, 'ceoB', '/api/test/employee-delete', '{"id":"e_a1"}')), 'cross-company action, reversed');
    },
    'Employee: own anchor only; colleague and foreign records are 404; CEO-only actions on their own record are 403' => static function () use ($world, $get, $post, $status): void {
        $w = $world();
        assertSame([200, ['id' => 'e_a1']], $status($get($w, 'empA1', '/api/test/employee', 'id=e_a1')), 'own');
        assertSame([200, ['ids' => ['e_a1']]], $status($get($w, 'empA1', '/api/test/employees')), 'list is self only');
        foreach (['e_a2' => 'colleague', 'e_a3' => 'unbound anchor', 'e_b1' => 'other company', 'e_none' => 'absent'] as $id => $label) {
            assertSame([404, 'not_found'], $status($get($w, 'empA1', '/api/test/employee', 'id=' . $id)), 'read ' . $label);
            assertSame([404, 'not_found'], $status($post($w, 'empA1', '/api/test/employee-update', '{"id":"' . $id . '"}')), 'update ' . $label);
            assertSame([404, 'not_found'], $status($post($w, 'empA1', '/api/test/employee-delete', '{"id":"' . $id . '"}')), 'delete ' . $label);
        }
        assertSame([403, 'forbidden'], $status($post($w, 'empA1', '/api/test/employee-update', '{"id":"e_a1"}')), 'CEO-only on own record');
        assertSame([403, 'forbidden'], $status($post($w, 'empA1', '/api/test/employee-delete', '{"id":"e_a1"}')), 'CEO-only on own record (delete)');
        assertSame([403, 'forbidden'], $status($post($w, 'empA1', '/api/test/settings', '{}')), 'record-free CEO-only');
        assertSame([403, 'forbidden'], $status($post($w, 'empA1', '/api/test/employees', '{"id":"e_mine"}')), 'create');
        assertSame([], $w['db']->select('SELECT id FROM employees WHERE id = ?', ['e_mine']), 'nothing created');
    },
    'absent and out-of-scope records answer byte-identical 404s' => static function () use ($world, $get, $post): void {
        $w = $world();
        $pairs = [
            [$get($w, 'empA1', '/api/test/employee', 'id=e_a2'), $get($w, 'empA1', '/api/test/employee', 'id=e_none')],
            [$get($w, 'ceoA', '/api/test/employee', 'id=e_b1'), $get($w, 'ceoA', '/api/test/employee', 'id=e_none')],
            [$post($w, 'empA1', '/api/test/employee-delete', '{"id":"e_b1"}'), $post($w, 'empA1', '/api/test/employee-delete', '{"id":"e_none"}')],
        ];
        foreach ($pairs as $i => [$foreign, $absent]) {
            assertSame([404, $absent->body, $absent->headers], [$foreign->status, $foreign->body, $foreign->headers], 'pair ' . $i);
            assertNoLeak($foreign->body, ['e_a2', 'e_b1', 'employee', $w['b']]);
        }
    },
    'forged scope inputs: company_id / employee_id / role in query or body are 400 and never widen access' => static function () use ($world, $get, $post, $status): void {
        $w = $world();
        foreach (['company_id=' . $w['b'], 'employee_id=e_a2', 'role=ceo', 'user_id=x', 'permissions=all'] as $q) {
            assertSame([400, 'invalid_query'], $status($get($w, 'empA1', '/api/test/employees', $q)), $q);
            assertSame([400, 'invalid_query'], $status($get($w, 'empA1', '/api/test/employee', 'id=e_a1&' . $q)), 'id + ' . $q);
        }
        foreach (['{"id":"e_a2","employee_id":"e_a1"}', '{"id":"e_a1","company_id":"' . $w['b'] . '"}', '{"id":"e_a1","role":"ceo"}'] as $body) {
            assertSame([400, 'validation_failed'], $status($post($w, 'empA1', '/api/test/employee-update', $body)), $body);
        }
        // A CEO creating with a forged company still lands in its own company.
        assertSame([400, 'validation_failed'], $status($post($w, 'ceoA', '/api/test/employees', '{"id":"e_x","company_id":"' . $w['b'] . '"}')), 'forged company on create');
        assertSame([200, ['created' => true]], $status($post($w, 'ceoA', '/api/test/employees', '{"id":"e_x"}')), 'create');
        assertSame([$w['a']], array_map(static fn (array $r): string => (string) $r['company_id'], $w['db']->select('SELECT company_id FROM employees WHERE id = ?', ['e_x'])));
        assertSame([404, 'not_found'], $status($get($w, 'ceoB', '/api/test/employee', 'id=e_x')), 'invisible to company B');
    },
    'an Employee on a route that runs the company-wide statement gets 500 and no rows; the CEO is unaffected' => static function () use ($world, $get, $status): void {
        $w = $world();
        $r = $get($w, 'empA1', '/api/test/employees-unsafe');
        assertSame([500, 'internal_error'], $status($r));
        assertNoLeak($r->body, ['e_a2', 'e_a3', 'rows']);
        assertSame([200, ['rows' => 3]], $status($get($w, 'ceoA', '/api/test/employees-unsafe')), 'ceo');
    },
    'binding integrity: stale and cross-company bindings are refused; a dangling one (FK bypassed) sees nothing' => static function () use ($world, $get, $status): void {
        $w = $world();
        $refused = static function (callable $fn, int $code, string $label): void {
            try {
                $fn();
            } catch (\TamOs\Data\DatabaseError $e) {
                assertSame($code, $e->driverCode, $label);
                return;
            }
            throw new \TamOs\Tests\AssertionFailed($label . ': not refused');
        };
        $refused(static fn () => $w['db']->execute('UPDATE memberships SET employee_id = ? WHERE user_id = ?', ['e_b1', $w['s']['empA1']['userId']]), 1452, 'cross-company binding');
        $refused(static fn () => $w['db']->execute('UPDATE memberships SET employee_id = ? WHERE user_id = ?', ['e_gone', $w['s']['empA1']['userId']]), 1452, 'binding to nothing');
        $refused(static fn () => $w['db']->execute('DELETE FROM employees WHERE id = ?', ['e_a1']), 1451, 'delete a bound employee');
        assertSame([200, ['ids' => ['e_a1']]], $status($get($w, 'empA1', '/api/test/employees')), 'binding intact');
        // Only an operator with FK checks off can dangle a binding; the Employee then sees no anchor.
        $w['db']->execute('SET SESSION foreign_key_checks = 0');
        try {
            $w['db']->execute('DELETE FROM employees WHERE id = ?', ['e_a1']);
        } finally {
            $w['db']->execute('SET SESSION foreign_key_checks = 1');
        }
        assertSame([200, ['ids' => []]], $status($get($w, 'empA1', '/api/test/employees')), 'dangling: empty');
        assertSame([404, 'not_found'], $status($get($w, 'empA1', '/api/test/employee', 'id=e_a1')), 'dangling: 404');
    },
    'CSRF: a mutation without the session token is 403 and never reaches Policy or the store' => static function () use ($world, $post, $status): void {
        $w = $world();
        foreach (['', str_repeat('x', 43), $w['s']['ceoB']['csrf']] as $csrf) {
            $r = $post($w, 'ceoA', '/api/test/employees', '{"id":"e_csrf"}', $csrf === '' ? str_repeat('q', 43) : $csrf);
            assertSame([403, 'forbidden'], $status($r), 'csrf ' . strlen($csrf));
        }
        assertSame([], $w['db']->select('SELECT id FROM employees WHERE id = ?', ['e_csrf']), 'nothing created');
    },
    'overtime CeoOrOwnDraft with real principals: own Draft allowed; own non-Draft, colleague and cross-scope denied' => static function () use ($world, $principalOf): void {
        $w = $world();
        $emp = $principalOf($w, 'empA1');
        $colleague = $principalOf($w, 'empA2');
        $ceo = $principalOf($w, 'ceoA');
        $ot = static fn (Principal $readBy, ?string $owner, ?string $status): ScopedRecord => new ScopedRecord(Scope::of($readBy), 'overtime', 'ot_1', $owner, $status);
        foreach ([Action::OvertimeSubmitSelf, Action::OvertimeCreateSelfDraft, Action::OvertimeUpdateSelfDraft, Action::OvertimeDeleteSelfDraft] as $a) {
            assertTrue(Policy::allows($emp, $a, $ot($emp, 'e_a1', 'Draft')), 'own draft ' . $a->value);
            assertTrue(!Policy::allows($emp, $a, $ot($emp, 'e_a1', 'Submitted')), 'own submitted ' . $a->value);
            assertTrue(!Policy::allows($emp, $a, $ot($emp, 'e_a2', 'Draft')), 'colleague owner ' . $a->value);
            assertTrue(!Policy::allows($emp, $a, $ot($colleague, 'e_a1', 'Draft')), 'read under the colleague scope ' . $a->value);
            assertTrue(!Policy::allows($emp, $a, $ot($ceo, 'e_a1', 'Draft')), 'read under the CEO scope ' . $a->value);
            assertTrue(Policy::allows($ceo, $a, $ot($ceo, 'e_a2', 'Approved')), 'CEO pass-through ' . $a->value);
        }
        assertTrue(!Policy::allows($emp, Action::OvertimeManage, $ot($emp, 'e_a1', 'Draft')), 'overtime.manage is CEO-only');
    },
];
