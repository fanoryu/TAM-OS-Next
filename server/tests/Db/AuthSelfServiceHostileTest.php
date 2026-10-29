<?php
declare(strict_types=1);

/*
 * E11 hostile principals on the two session-bound account self-service routes (SDR-0002 §17 E11):
 * POST /api/auth/change-password and POST /api/auth/logout-all act only on the caller's own account.
 * No session, a revoked session and an idle-expired session are 401; a missing or foreign CSRF token
 * and another origin are 403; a body naming another user is 400 and touches no one; and an Employee's
 * own change or logout-all never reaches a colleague, the CEO or another company. Fabricated data.
 */

use TamOs\Auth\Passwords;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
use TamOs\Http\Response;
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

$newPassword = 'a brand new passphrase';

/**
 * Company A: a CEO, e_a1 and e_a2 (Employee logins). Company B: a CEO. Everyone logs in for real.
 *
 * @return array{db: Database, k: Kernel, f: array<string, array<string, mixed>>, s: array<string, array{token: string, csrf: string}>}
 */
$world = static function (): array {
    $db = authDatabase();
    $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
    $ceoA = authFixture($db);
    $a = $ceoA['companyId'];
    $f = ['ceoA' => $ceoA, 'empA1' => authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a1']),
        'empA2' => authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a2']), 'ceoB' => authFixture($db)];
    $s = [];
    foreach ($f as $name => $x) {
        $r = $k->handle(loginRequest($x['email'], (string) $x['password']), requestId());
        assertSame(200, $r->status, 'login ' . $name);
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken']];
    }
    return ['db' => $db, 'k' => $k, 'f' => $f, 's' => $s];
};
$change = static fn (Kernel $k, ?string $token, ?string $csrf, array $body, array $over = []): Response
    => $k->handle(sessionRequest('POST', '/api/auth/change-password', $token, $csrf, json_encode($body, JSON_THROW_ON_ERROR), $over), requestId());
$logoutAll = static fn (Kernel $k, ?string $token, ?string $csrf, array $body = [], array $over = []): Response
    => $k->handle(sessionRequest('POST', '/api/auth/logout-all', $token, $csrf, $body === [] ? '{}' : json_encode($body, JSON_THROW_ON_ERROR), $over), requestId());
$code = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
/** Live sessions and password hashes of every user — a refusal must leave both exactly as they were. */
$state = static fn (Database $db): array => [
    $db->select('SELECT user_id, COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL GROUP BY user_id ORDER BY user_id'),
    $db->select('SELECT id, password_hash FROM users ORDER BY id'),
];

return [
    '401: no session, a revoked session and an idle-expired session cannot change a password or log out everywhere, and nothing changes' => static function () use ($world, $change, $logoutAll, $code, $state, $newPassword): void {
        $w = $world();
        $body = ['currentPassword' => (string) $w['f']['empA1']['password'], 'newPassword' => $newPassword];
        $before = $state($w['db']);
        assertSame([401, 'unauthenticated'], $code($change($w['k'], null, null, $body)), 'change-password, no session');
        assertSame([401, 'unauthenticated'], $code($logoutAll($w['k'], null, null)), 'logout-all, no session');
        assertSame($before, $state($w['db']), 'no session: nothing changes');
        $hash = static fn (string $who): string => hash('sha256', $w['s'][$who]['token']);
        $w['db']->execute('UPDATE sessions SET revoked_at = UTC_TIMESTAMP(6) WHERE token_hash = ?', [$hash('empA1')]);
        $w['db']->execute('UPDATE sessions SET last_seen_at = UTC_TIMESTAMP(6) - INTERVAL 31 MINUTE WHERE token_hash = ?', [$hash('empA2')]);
        $before = $state($w['db']);
        foreach (['empA1' => 'revoked', 'empA2' => 'idle-expired'] as $who => $label) {
            $b = ['currentPassword' => (string) $w['f'][$who]['password'], 'newPassword' => $newPassword];
            assertSame(401, $change($w['k'], $w['s'][$who]['token'], $w['s'][$who]['csrf'], $b)->status, 'change-password, ' . $label);
            assertSame(401, $logoutAll($w['k'], $w['s'][$who]['token'], $w['s'][$who]['csrf'])->status, 'logout-all, ' . $label);
        }
        assertSame($before, $state($w['db']), 'revoked / expired: nothing changes');
    },
    'CSRF and Origin: a missing CSRF token, another session\'s token or another origin is 403 on both routes, and nothing changes' => static function () use ($world, $change, $logoutAll, $code, $state, $newPassword): void {
        $w = $world();
        $t = $w['s']['empA1']['token'];
        $body = ['currentPassword' => (string) $w['f']['empA1']['password'], 'newPassword' => $newPassword];
        $before = $state($w['db']);
        foreach (['missing' => ['csrfToken' => null], 'another session' => ['csrfToken' => $w['s']['empA2']['csrf']], 'another origin' => ['origin' => 'https://evil.test']] as $label => $over) {
            assertSame([403, 'forbidden'], $code($change($w['k'], $t, $w['s']['empA1']['csrf'], $body, $over)), 'change-password ' . $label);
            assertSame([403, 'forbidden'], $code($logoutAll($w['k'], $t, $w['s']['empA1']['csrf'], [], $over)), 'logout-all ' . $label);
        }
        assertSame($before, $state($w['db']), 'nothing changes');
    },
    'a body naming another user is 400 on both routes and touches no account' => static function () use ($world, $change, $logoutAll, $code, $state, $newPassword): void {
        $w = $world();
        $t = $w['s']['empA1']['token'];
        $c = $w['s']['empA1']['csrf'];
        $before = $state($w['db']);
        foreach (['userId' => $w['f']['ceoA']['userId'], 'email' => $w['f']['ceoA']['email'], 'membershipId' => $w['f']['ceoA']['membershipId'], 'companyId' => $w['f']['ceoB']['companyId'], 'role' => 'ceo'] as $key => $value) {
            $r = $change($w['k'], $t, $c, ['currentPassword' => (string) $w['f']['empA1']['password'], 'newPassword' => $newPassword, $key => $value]);
            assertSame([400, 'validation_failed'], $code($r), 'change-password with ' . $key);
            assertSame([400, 'validation_failed'], $code($logoutAll($w['k'], $t, $c, [$key => $value])), 'logout-all with ' . $key);
        }
        assertSame($before, $state($w['db']), 'no password and no session changed');
    },
    'an Employee\'s own password change and logout-all reach only their own account — never a colleague, the CEO or another company' => static function () use ($world, $change, $logoutAll, $newPassword): void {
        $w = $world();
        $others = ['empA2', 'ceoA', 'ceoB'];
        $hashOf = static fn (string $who): string => (string) $w['db']->select('SELECT password_hash FROM users WHERE id = ?', [$w['f'][$who]['userId']])[0]['password_hash'];
        $live = static fn (string $who): int => (int) $w['db']->select('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL', [$w['f'][$who]['userId']])[0]['n'];
        $before = [];
        foreach ($others as $who) {
            $before[$who] = [$hashOf($who), $live($who)];
        }
        $r = $change($w['k'], $w['s']['empA1']['token'], $w['s']['empA1']['csrf'], ['currentPassword' => (string) $w['f']['empA1']['password'], 'newPassword' => $newPassword]);
        assertSame(200, $r->status, 'own password change');
        assertTrue(Passwords::verify($newPassword, $hashOf('empA1')), 'own password changed');
        $fresh = (string) sessionCookieToken($r);
        $freshCsrf = (string) envelope($r)['data']['csrfToken'];
        assertSame(200, $logoutAll($w['k'], $fresh, $freshCsrf)->status, 'own logout-all');
        assertSame(0, $live('empA1'), 'every own session ended');
        foreach ($others as $who) {
            assertSame($before[$who], [$hashOf($who), $live($who)], $who . ': password and sessions untouched');
        }
    },
];
