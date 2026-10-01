<?php
declare(strict_types=1);

/*
 * BF-4a2 Employee account administration (SDR-0004) end to end against the real MariaDB: real
 * logins → production routes → AccountService → EmployeeStore / AccountStore / outbox / tokens /
 * AuditLog, the outbox worker with the recording transport (no network, no real mail), then the
 * unchanged /api/auth/activate and login. Fabricated data only.
 */

use TamOs\Auth\SessionToken;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Employee\EmployeeView;
use TamOs\Http\Kernel;
use TamOs\Http\Response;
use TamOs\Mail\OutboxWorker;
use TamOs\Tests\RecordingMailTransport;
use function TamOs\Tests\activateRequest;
use function TamOs\Tests\assertNoLeak;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\authKernel;
use function TamOs\Tests\employeeAnchor;
use function TamOs\Tests\envelope;
use function TamOs\Tests\jsonPost;
use function TamOs\Tests\loginRequest;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\requestId;
use function TamOs\Tests\secondConnection;
use function TamOs\Tests\sessionCookieToken;
use function TamOs\Tests\sessionRequest;
use function TamOs\Tests\testDbConfig;

$origin = 'https://finance.example.test';
$password = 'fabricated pass phrase 2026';

/**
 * Company A: an unbound CEO, an Employee logged in and bound to e_a1, a second CEO bound to the
 * Employee record e_ceo, and an Employee record e_new with no login. Company B: a CEO.
 *
 * @return array{db: Database, k: Kernel, log: string, a: string, b: string, s: array<string, array{token: string, csrf: string, userId: string, membershipId: string, email: string}>, t: RecordingMailTransport, worker: OutboxWorker}
 */
$world = static function () use ($origin): array {
    $db = authDatabase();
    $auth = AuthData::fromDatabase($db);
    $config = testDbConfig();
    $k = authKernel($config, $auth, productionMigrationsDir());
    $ceoA = authFixture($db);
    $a = $ceoA['companyId'];
    $fixtures = [
        'ceoA' => $ceoA,
        'empA1' => authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a1']),
        'ceoBound' => authFixture($db, ['companyId' => $a, 'role' => 'ceo', 'employeeId' => 'e_ceo']),
        'ceoB' => authFixture($db),
    ];
    employeeAnchor($db, $a, 'e_new');
    employeeAnchor($db, $a, 'e_new2');
    employeeAnchor($db, $fixtures['ceoB']['companyId'], 'e_b1');
    $s = [];
    foreach ($fixtures as $name => $f) {
        $r = $k->handle(loginRequest($f['email'], (string) $f['password']), requestId());
        assertSame(200, $r->status, 'login ' . $name);
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken'], 'userId' => $f['userId'], 'membershipId' => $f['membershipId'], 'email' => $f['email']];
    }
    $t = new RecordingMailTransport();
    return ['db' => $db, 'k' => $k, 'log' => $config->logPath, 'a' => $a, 'b' => $fixtures['ceoB']['companyId'], 's' => $s, 't' => $t, 'worker' => new OutboxWorker($auth, $t, $origin)];
};
$post = static fn (array $w, string $who, string $path, array $body): Response
    => $w['k']->handle(sessionRequest('POST', $path, $w['s'][$who]['token'], $w['s'][$who]['csrf'], json_encode($body, JSON_THROW_ON_ERROR)), requestId());
$get = static fn (array $w, string $who, string $path, string $query = ''): Response
    => $w['k']->handle(sessionRequest('GET', $path, $w['s'][$who]['token'], null, '', ['query' => $query]), requestId());
$ok = static function (Response $r, string $label): array {
    assertSame(200, $r->status, $label . ' (' . substr($r->body, 0, 200) . ')');
    return envelope($r)['data'];
};
$code = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
$provision = static fn (array $w, string $id, string $email, string $who = 'ceoA'): Response => $post($w, $who, '/api/employees/provision-account', ['id' => $id, 'email' => $email]);
$op = static fn (array $w, string $verb, string $id, string $who = 'ceoA'): Response => $post($w, $who, '/api/employees/' . $verb, ['id' => $id]);
$state = static fn (array $w, string $id): string => (string) $ok($get($w, 'ceoA', '/api/employee', 'id=' . $id), 'read ' . $id)['employee']['accountState'];
$userOf = static fn (Database $db, string $employeeId): ?array => $db->select('SELECT u.id, u.email, u.status, u.password_hash IS NULL AS pending, m.id AS membership_id, m.role, m.status AS membership_status, m.company_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.employee_id = ?', [$employeeId])[0] ?? null;
$openTokens = static fn (Database $db, string $userId): int => (int) $db->select('SELECT COUNT(*) AS n FROM account_tokens WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(6)', [$userId])[0]['n'];
$outbox = static fn (Database $db, string $userId): array => array_map(static fn (array $r): string => $r['kind'] . ':' . $r['status'], $db->select('SELECT kind, status FROM mail_outbox WHERE user_id = ? ORDER BY id', [$userId]));
$accountAudits = static fn (Database $db, string $employeeId): array => $db->select("SELECT company_id, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, fields FROM audit_events WHERE entity_id = ? AND action = 'account.manage' ORDER BY id", [$employeeId]);
$counts = static fn (Database $db): array => array_map(static fn (string $t): int => (int) $db->select('SELECT COUNT(*) AS n FROM ' . $t)[0]['n'], ['users' => 'users', 'memberships' => 'memberships', 'mail_outbox' => 'mail_outbox', 'account_tokens' => 'account_tokens', 'audit_events' => 'audit_events']);
// The fixed log reasons of the 409s answered so far: each refusal names the guard that refused it.
$conflicts = static fn (array $w): array => array_values(array_map(
    static fn (array $l): ?string => $l['reason'] ?? null,
    array_filter(array_map(static fn (string $l): array => (array) json_decode($l, true), file($w['log'], FILE_IGNORE_NEW_LINES) ?: []), static fn (array $l): bool => ($l['status'] ?? null) === 409),
));
$tokenIn = static function (array $w, int $i) use ($origin): string {
    $text = $w['t']->sent[$i]->text;
    $prefix = $origin . '/#activation=';
    $at = strpos($text, $prefix);
    assertTrue($at !== false, 'the mail carries an activation link');
    return substr($text, $at + strlen($prefix), 43);
};

return [
    'provision: a pending user, an active Employee membership in the session company, activation intent, one audit row — and no token anywhere' => static function () use ($world, $provision, $ok, $userOf, $openTokens, $outbox, $accountAudits): void {
        $w = $world();
        $data = $ok($provision($w, 'e_new', '  New.Person@Example.TEST '), 'provision');
        assertSame(['employee'], array_keys($data), 'the response is the Employee detail only');
        $e = $data['employee'];
        assertSame(EmployeeView::DETAIL_FIELDS, array_keys($e), 'the CEO detail, nothing more');
        assertSame(['e_new', 'pending'], [$e['id'], $e['accountState']]);
        $u = $userOf($w['db'], 'e_new');
        assertSame(['new.person@example.test', 'active', 1, 'employee', 'active', $w['a']], [$u['email'], $u['status'], (int) $u['pending'], $u['role'], $u['membership_status'], $u['company_id']]);
        assertSame(['activation:pending'], $outbox($w['db'], $u['id']), 'activation intent queued');
        assertSame(0, $openTokens($w['db'], $u['id']), 'the request issues no token');
        assertSame([], $w['db']->select('SELECT token_hash FROM account_tokens WHERE user_id = ?', [$u['id']]), 'no token row at all');
        assertSame([[
            'company_id' => $w['a'], 'actor_user_id' => $w['s']['ceoA']['userId'], 'actor_membership_id' => $w['s']['ceoA']['membershipId'],
            'action' => 'account.manage', 'entity' => 'employee', 'entity_id' => 'e_new', 'operation' => 'provision', 'target_user_id' => $u['id'], 'fields' => null,
        ]], $accountAudits($w['db'], 'e_new'));
        foreach (['new.person', $u['id'], $u['membership_id'], 'token', 'activation', 'password'] as $needle) {
            assertTrue(stripos(json_encode($e), $needle) === false, 'the response carries no ' . $needle);
        }
        $list = $ok($w['k']->handle(sessionRequest('GET', '/api/employees', $w['s']['ceoA']['token']), requestId()), 'list')['employees'];
        $states = array_column($list, 'accountState', 'id');
        assertSame(['e_a1' => 'active', 'e_ceo' => 'active', 'e_new' => 'pending', 'e_new2' => 'none'], $states, 'list states');
    },
    'the worker sends the activation mail with a 72-hour token at send time; /api/auth/activate and login then work unchanged' => static function () use ($world, $provision, $ok, $userOf, $openTokens, $outbox, $state, $tokenIn, $password): void {
        $w = $world();
        $ok($provision($w, 'e_new', 'new.person@example.test'), 'provision');
        $u = $userOf($w['db'], 'e_new');
        assertSame(['sent' => 1, 'retried' => 0, 'failed' => 0, 'cancelled' => 0], $w['worker']->run(20, requestId()));
        assertSame(['new.person@example.test', 'Activate your TAM OS account'], [$w['t']->sent[0]->to, $w['t']->sent[0]->subject]);
        $token = $tokenIn($w, 0);
        $row = $w['db']->select("SELECT purpose, TIMESTAMPDIFF(HOUR, created_at, expires_at) AS h FROM account_tokens WHERE token_hash = ?", [SessionToken::hash($token)])[0];
        assertSame(['activation', 72], [(string) $row['purpose'], (int) $row['h']]);
        assertSame(1, $openTokens($w['db'], $u['id']));
        assertSame(['activation:sent'], $outbox($w['db'], $u['id']));
        $everything = '';
        foreach (['account_tokens', 'mail_outbox', 'auth_events', 'audit_events', 'users', 'sessions'] as $table) {
            $everything .= json_encode($w['db']->select('SELECT * FROM ' . $table));
        }
        assertTrue(!str_contains($everything, $token), 'the raw token is persisted nowhere');
        assertSame(200, $w['k']->handle(activateRequest($token, $password), requestId())->status, 'activation');
        assertSame('active', $state($w, 'e_new'));
        $login = $w['k']->handle(loginRequest('new.person@example.test', $password), requestId());
        assertSame([200, 'employee', 'e_new'], [$login->status, envelope($login)['data']['role'] ?? null, envelope($login)['data']['employeeId'] ?? null], 'the new Employee logs in, bound to the record');
        assertSame(400, $w['k']->handle(activateRequest($token, $password . 'x'), requestId())->status, 'single use');
    },
    'provision refusals write nothing: already bound, email taken, archived, CEO-bound, absent, another company, an Employee' => static function () use ($world, $provision, $post, $code, $counts, $ok, $conflicts): void {
        $w = $world();
        $ok($provision($w, 'e_new', 'first@example.test'), 'first');
        $before = $counts($w['db']);
        assertSame([409, 'conflict'], $code($provision($w, 'e_new', 'second@example.test')), 'a second login for the record');
        assertSame([409, 'conflict'], $code($provision($w, 'e_new2', 'first@example.test')), 'an email already used');
        assertSame([409, 'conflict'], $code($provision($w, 'e_new2', $w['s']['ceoB']['email'])), 'an email used in another company');
        assertSame([409, 'conflict'], $code($provision($w, 'e_ceo', 'x@example.test')), 'a record bound to a CEO');
        assertSame([409, 'conflict'], $code($provision($w, 'e_a1', 'y@example.test')), 'a record with an Employee login');
        $ok($post($w, 'ceoA', '/api/employees/archive', ['id' => 'e_new2', 'expectedVersion' => 1]), 'archive e_new2');
        $before = $counts($w['db']);
        assertSame([409, 'conflict'], $code($provision($w, 'e_new2', 'z@example.test')), 'archived');
        assertSame([404, 'not_found'], $code($provision($w, 'e_none', 'z@example.test')), 'absent');
        assertSame([404, 'not_found'], $code($provision($w, 'e_b1', 'z@example.test')), 'another company');
        assertSame([404, 'not_found'], $code($provision($w, 'e_new', 'z@example.test', 'ceoB')), 'a foreign CEO');
        assertSame([403, 'forbidden'], $code($provision($w, 'e_a1', 'z@example.test', 'empA1')), 'an Employee on their own record');
        assertSame([404, 'not_found'], $code($provision($w, 'e_new', 'z@example.test', 'empA1')), 'an Employee on a colleague');
        assertSame([404, 'not_found'], $code($provision($w, $w['s']['empA1']['userId'], 'z@example.test')), 'a raw user id is no Employee id');
        assertSame($before, $counts($w['db']), 'nothing written by any refusal');
        assertSame(['account_exists', 'email_unavailable', 'email_unavailable', 'account_exists', 'account_exists', 'employee_archived'], $conflicts($w),
            'each 409 comes from its own guard, not from a UNIQUE backstop');
    },
    'every operation locks the Employee row first: while another transaction holds it, the request waits and gives up' => static function () use ($world, $provision, $op, $code, $counts, $ok): void {
        $w = $world();
        $ok($provision($w, 'e_new2', 'second@example.test'), 'a pending account to administer');
        $before = $counts($w['db']);
        $w['db']->execute('SET SESSION innodb_lock_wait_timeout = 1');
        $holder = secondConnection();
        $holder->transaction(static function () use ($holder, $w, $provision, $op, $code): void {
            $holder->select('SELECT id FROM employees WHERE id IN (?, ?) FOR UPDATE', ['e_new', 'e_new2']);
            assertSame([503, 'service_unavailable'], $code($provision($w, 'e_new', 'new@example.test')), 'provision waits on the Employee row (lock wait timeout)');
            foreach (['reissue-activation', 'disable-account'] as $verb) {
                assertSame([503, 'service_unavailable'], $code($op($w, $verb, 'e_new2')), $verb . ' waits on the Employee row (lock wait timeout)');
            }
        });
        assertSame($before, $counts($w['db']), 'nothing written while the row was held');
        $ok($provision($w, 'e_new', 'new@example.test'), 'once released, provisioning proceeds');
    },
    'a failing outbox enqueue or audit append rolls the whole provisioning back' => static function () use ($world, $provision, $code, $counts): void {
        $w = $world();
        $before = $counts($w['db']);
        // Test-only DDL on the disposable database: every further activation row is refused.
        $w['db']->execute("ALTER TABLE mail_outbox ADD CONSTRAINT test_block_outbox CHECK (kind <> 'activation')");
        assertSame([500, 'internal_error'], $code($provision($w, 'e_new', 'new@example.test')), 'outbox failure');
        assertSame($before, $counts($w['db']), 'no user, membership, outbox or audit row');
        $w['db']->execute('ALTER TABLE mail_outbox DROP CONSTRAINT test_block_outbox');
        $w['db']->execute("ALTER TABLE audit_events ADD CONSTRAINT test_block_audit CHECK (action <> 'account.manage')");
        assertSame([500, 'internal_error'], $code($provision($w, 'e_new', 'new@example.test')), 'audit failure');
        assertSame($before, $counts($w['db']), 'no user, membership, outbox or audit row');
    },
    'reissue: pending only, revokes the open token, queues one new intent, audited; the old link dies and the new one works' => static function () use ($world, $provision, $op, $ok, $code, $userOf, $openTokens, $outbox, $accountAudits, $tokenIn, $password): void {
        $w = $world();
        $ok($provision($w, 'e_new', 'new@example.test'), 'provision');
        $u = $userOf($w['db'], 'e_new');
        $w['worker']->run(20, requestId());
        $first = $tokenIn($w, 0);
        $data = $ok($op($w, 'reissue-activation', 'e_new'), 'reissue');
        assertSame(['employee'], array_keys($data), 'the response is the Employee detail only');
        assertSame('pending', $data['employee']['accountState']);
        assertSame(0, $openTokens($w['db'], $u['id']), 'the earlier link is revoked at once');
        assertSame(['activation:sent', 'activation:pending'], $outbox($w['db'], $u['id']));
        $ok($op($w, 'reissue-activation', 'e_new'), 'reissue while one is queued');
        assertSame(['activation:sent', 'activation:pending'], $outbox($w['db'], $u['id']), 'idempotent: the open row is reused');
        assertSame(['provision', 'reissue', 'reissue'], array_column($accountAudits($w['db'], 'e_new'), 'operation'));
        $w['worker']->run(20, requestId());
        $second = $tokenIn($w, 1);
        assertSame(400, $w['k']->handle(activateRequest($first, $password), requestId())->status, 'the first link is dead');
        assertSame(200, $w['k']->handle(activateRequest($second, $password), requestId())->status, 'the reissued link activates');
        assertSame([409, 'conflict'], $code($op($w, 'reissue-activation', 'e_new')), 'not pending any more');
        assertSame([409, 'conflict'], $code($op($w, 'reissue-activation', 'e_new2')), 'no login');
        assertSame([409, 'conflict'], $code($op($w, 'reissue-activation', 'e_a1')), 'an active login');
    },
    'reissue is limited to 3 per target user per hour (429), and refusals are not counted' => static function () use ($world, $provision, $op, $ok, $code): void {
        $w = $world();
        $ok($provision($w, 'e_new', 'new@example.test'), 'provision');
        for ($i = 1; $i <= 3; $i++) {
            $ok($op($w, 'reissue-activation', 'e_new'), 'reissue ' . $i);
        }
        $r = $op($w, 'reissue-activation', 'e_new');
        assertSame([429, 'rate_limited'], $code($r), 'the fourth in the hour');
        assertTrue((int) ($r->headers['Retry-After'] ?? 0) > 0, 'Retry-After');
        $ok($provision($w, 'e_new2', 'other@example.test'), 'another account');
        $ok($op($w, 'reissue-activation', 'e_new2'), 'another target user has its own quota');
    },
    'disable: the membership only — sessions and open tokens revoked, login and recovery refused, user and employment untouched, archive then allowed' => static function () use ($world, $op, $ok, $code, $userOf, $openTokens, $outbox, $accountAudits, $post): void {
        $w = $world();
        $emp = $w['s']['empA1'];
        $w['db']->execute("INSERT INTO account_tokens (token_hash, user_id, purpose, created_at, expires_at, used_at, revoked_at) VALUES (?, ?, 'recovery', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 30 MINUTE, NULL, NULL)", [hash('sha256', 'fixture'), $emp['userId']]);
        assertSame('disabled', $ok($op($w, 'disable-account', 'e_a1'), 'disable')['employee']['accountState']);
        $u = $userOf($w['db'], 'e_a1');
        assertSame(['active', 'disabled', 'employee'], [$u['status'], $u['membership_status'], $u['role']], 'users.status is untouched');
        assertSame('Active', (string) $w['db']->select('SELECT employment_status FROM employees WHERE id = ?', ['e_a1'])[0]['employment_status'], 'employment status untouched');
        assertSame(0, (int) $w['db']->select('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL', [$emp['userId']])[0]['n'], 'every session revoked');
        assertSame(0, $openTokens($w['db'], $emp['userId']), 'every open token revoked');
        assertSame(401, $w['k']->handle(sessionRequest('GET', '/api/auth/me', $emp['token']), requestId())->status, 'the live session ends on the next request');
        $f = $w['db']->select('SELECT email FROM users WHERE id = ?', [$emp['userId']])[0]['email'];
        assertSame(401, $w['k']->handle(loginRequest((string) $f, 'irrelevant password value'), requestId())->status, 'login refused');
        $w['k']->handle(jsonPost('/api/auth/forgot-password', json_encode(['email' => $f]), ['remoteAddr' => '203.0.113.9']), requestId());
        assertSame([], $outbox($w['db'], $emp['userId']), 'recovery queues nothing for a disabled account');
        assertSame(['disable'], array_column($accountAudits($w['db'], 'e_a1'), 'operation'));
        assertSame([409, 'conflict'], $code($op($w, 'disable-account', 'e_a1')), 'already disabled');
        assertSame([409, 'conflict'], $code($op($w, 'disable-account', 'e_new')), 'no login');
        $ok($post($w, 'ceoA', '/api/employees/archive', ['id' => 'e_a1', 'expectedVersion' => 1]), 'the existing archive rule allows it once the login is disabled');
    },
    'a pending account disabled before delivery: the worker cancels its activation mail and issues no token' => static function () use ($world, $provision, $op, $ok, $userOf, $outbox): void {
        $w = $world();
        $ok($provision($w, 'e_new', 'new@example.test'), 'provision');
        $u = $userOf($w['db'], 'e_new');
        assertSame('disabled', $ok($op($w, 'disable-account', 'e_new'), 'disable')['employee']['accountState']);
        assertSame(['activation:pending'], $outbox($w['db'], $u['id']), 'disable never touches the outbox');
        assertSame(['sent' => 0, 'retried' => 0, 'failed' => 0, 'cancelled' => 1], $w['worker']->run(20, requestId()));
        assertSame([], $w['t']->sent, 'no mail');
        assertSame([], $w['db']->select('SELECT token_hash FROM account_tokens WHERE user_id = ?', [$u['id']]), 'no token issued');
    },
    'enable: membership only and no mail — active with a password, pending without; refused when archived or not disabled' => static function () use ($world, $provision, $op, $ok, $code, $outbox, $userOf, $accountAudits, $post): void {
        $w = $world();
        $ok($op($w, 'disable-account', 'e_a1'), 'disable e_a1');
        assertSame('active', $ok($op($w, 'enable-account', 'e_a1'), 'enable e_a1')['employee']['accountState']);
        assertSame([409, 'conflict'], $code($op($w, 'enable-account', 'e_a1')), 'not disabled');
        $ok($provision($w, 'e_new', 'new@example.test'), 'provision');
        $u = $userOf($w['db'], 'e_new');
        $ok($op($w, 'disable-account', 'e_new'), 'disable pending');
        $w['worker']->run(20, requestId());
        assertSame('pending', $ok($op($w, 'enable-account', 'e_new'), 'enable pending')['employee']['accountState']);
        assertSame(['activation:cancelled'], $outbox($w['db'], $u['id']), 'enable queues no mail');
        assertSame(['provision', 'disable', 'enable'], array_column($accountAudits($w['db'], 'e_new'), 'operation'));
        $ok($op($w, 'reissue-activation', 'e_new'), 'the CEO reissues explicitly');
        $ok($op($w, 'disable-account', 'e_a1'), 'disable e_a1 again');
        $ok($post($w, 'ceoA', '/api/employees/archive', ['id' => 'e_a1', 'expectedVersion' => 1]), 'archive');
        assertSame([409, 'conflict'], $code($op($w, 'enable-account', 'e_a1')), 'an archived record is never re-enabled');
    },
    'CEO-target guard: a CEO membership bound to an Employee record is never administered, not even the actor\'s own' => static function () use ($world, $op, $code, $userOf, $accountAudits): void {
        $w = $world();
        foreach (['reissue-activation', 'disable-account', 'enable-account'] as $verb) {
            assertSame([409, 'conflict'], $code($op($w, $verb, 'e_ceo')), $verb . ' by another CEO');
            assertSame([409, 'conflict'], $code($op($w, $verb, 'e_ceo', 'ceoBound')), $verb . ' on the actor\'s own binding');
        }
        $u = $userOf($w['db'], 'e_ceo');
        assertSame(['ceo', 'active'], [$u['role'], $u['membership_status']], 'the CEO membership is untouched');
        assertSame(200, $w['k']->handle(sessionRequest('GET', '/api/auth/me', $w['s']['ceoBound']['token']), requestId())->status, 'and still signed in');
        assertSame([], $accountAudits($w['db'], 'e_ceo'), 'nothing audited');
    },
    'hostile principals: another company is a byte-identical 404, an Employee is 403 on their own record and 404 elsewhere, for every operation' => static function () use ($world, $post, $code, $counts): void {
        $w = $world();
        $before = $counts($w['db']);
        $routes = ['provision-account' => ['email' => 'h@example.test'], 'reissue-activation' => [], 'disable-account' => [], 'enable-account' => []];
        foreach ($routes as $verb => $extra) {
            $path = '/api/employees/' . $verb;
            $foreign = $post($w, 'ceoB', $path, ['id' => 'e_a1'] + $extra);
            $absent = $post($w, 'ceoB', $path, ['id' => 'e_none'] + $extra);
            assertSame([404, $absent->body, $absent->headers], [$foreign->status, $foreign->body, $foreign->headers], $verb . ': a foreign record is indistinguishable from an absent one');
            assertNoLeak($foreign->body, ['e_a1', $w['a']]);
            assertSame([403, 'forbidden'], $code($post($w, 'empA1', $path, ['id' => 'e_a1'] + $extra)), $verb . ': an Employee on their own record');
            assertSame([404, 'not_found'], $code($post($w, 'empA1', $path, ['id' => 'e_new'] + $extra)), $verb . ': an Employee on a colleague');
            assertSame([404, 'not_found'], $code($post($w, 'empA1', $path, ['id' => 'e_b1'] + $extra)), $verb . ': an Employee on another company');
            assertSame([400, 'validation_failed'], $code($post($w, 'ceoA', $path, ['id' => 'e_new', 'company_id' => $w['b']] + $extra)), $verb . ': a forged company');
            assertSame([400, 'validation_failed'], $code($post($w, 'ceoA', $path, ['id' => 'e_new', 'user_id' => $w['s']['empA1']['userId']] + $extra)), $verb . ': a forged user');
        }
        assertSame($before, $counts($w['db']), 'nothing written');
    },
    'employment status and account state stay independent; the self view carries no account state' => static function () use ($world, $post, $ok, $state, $get): void {
        $w = $world();
        $ok($post($w, 'ceoA', '/api/employees/update', ['id' => 'e_a1', 'expectedVersion' => 1, 'employmentStatus' => 'Terminated']), 'terminate');
        assertSame('active', $state($w, 'e_a1'), 'a terminated Employee keeps the login until it is disabled');
        assertSame(200, $w['k']->handle(sessionRequest('GET', '/api/auth/me', $w['s']['empA1']['token']), requestId())->status, 'still signed in');
        $self = $ok($get($w, 'empA1', '/api/employee', 'id=e_a1'), 'self')['employee'];
        assertTrue(!array_key_exists('accountState', $self), 'no account state in the self view');
        $ok($post($w, 'ceoA', '/api/employees/disable-account', ['id' => 'e_a1']), 'disable');
        assertSame('Terminated', (string) $w['db']->select('SELECT employment_status FROM employees WHERE id = ?', ['e_a1'])[0]['employment_status'], 'disable never rewrites employment status');
    },
];
