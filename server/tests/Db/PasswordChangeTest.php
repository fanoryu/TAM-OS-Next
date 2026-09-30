<?php
declare(strict_types=1);

/*
 * POST /api/auth/change-password and POST /api/auth/logout-all (BF-3B) against the real,
 * guarded CI MariaDB: the current password is verified against the stored hash, every session
 * of the user is revoked and the caller continues on exactly one fresh session; wrong current
 * passwords are counted and throttled per user; the rule's email comes from the database;
 * logout-all ends every session of the caller's user and nobody else's.
 */

use TamOs\Auth\Passwords;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
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
$clear = '__Host-tamos_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';

/** @return array{0: Database, 1: Kernel, 2: array<string, mixed>} */
$setup = static function (): array {
    $db = authDatabase();
    return [$db, authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir()), authFixture($db)];
};
/** Logs in and returns [token, csrf]. */
$login = static function (Kernel $k, string $email, string $password): array {
    $r = $k->handle(loginRequest($email, $password), requestId());
    assertSame(200, $r->status, 'login');
    return [(string) sessionCookieToken($r), (string) envelope($r)['data']['csrfToken']];
};
$change = static fn (Kernel $k, string $token, string $csrf, string $current, string $new) => $k->handle(
    sessionRequest('POST', '/api/auth/change-password', $token, $csrf, json_encode(['currentPassword' => $current, 'newPassword' => $new], JSON_THROW_ON_ERROR)),
    requestId(),
);
$me = static fn (Kernel $k, ?string $token): int => $k->handle(sessionRequest('GET', '/api/auth/me', $token), requestId())->status;
$code = static fn ($r): ?string => envelope($r)['error']['code'] ?? null;
$fields = static fn ($r): ?array => envelope($r)['error']['fields'] ?? null;
$live = static fn (Database $db, string $userId): int => (int) $db->select('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL', [$userId])[0]['n'];

return [
    'success: all sessions revoked, exactly one fresh session for the caller, new cookie and CSRF token' => static function () use ($setup, $login, $change, $me, $live, $newPassword): void {
        [$db, $k, $a] = $setup();
        [$t1, $c1] = $login($k, $a['email'], (string) $a['password']);
        [$t2] = $login($k, $a['email'], (string) $a['password']);
        $r = $change($k, $t1, $c1, (string) $a['password'], $newPassword);
        assertSame(200, $r->status);
        $data = envelope($r)['data'];
        $fresh = (string) sessionCookieToken($r);
        assertSame(['userId' => $a['userId'], 'membershipId' => $a['membershipId'], 'role' => 'ceo', 'employeeId' => null], array_diff_key($data, ['csrfToken' => 1]));
        assertTrue($fresh !== '' && $fresh !== $t1 && $data['csrfToken'] !== $c1, 'rotated token and CSRF');
        assertSame([401, 401, 200], [$me($k, $t1), $me($k, $t2), $me($k, $fresh)], 'old sessions dead, the fresh one works');
        assertSame(1, $live($db, $a['userId']), 'exactly one live session');
        assertSame(401, $k->handle(loginRequest($a['email'], (string) $a['password']), requestId())->status, 'the old password no longer works');
        assertSame(200, $k->handle(loginRequest($a['email'], $newPassword), requestId())->status, 'the new one does');
        $row = $db->select("SELECT user_id, membership_id, ip FROM auth_events WHERE event = 'password_change'")[0];
        assertSame([$a['userId'], $a['membershipId'], '203.0.113.7'], array_values($row));
    },
    'wrong current password: 400 [currentPassword], counted, password_fail, nothing else changes' => static function () use ($setup, $login, $change, $me, $code, $fields, $newPassword): void {
        [$db, $k, $a] = $setup();
        [$t, $c] = $login($k, $a['email'], (string) $a['password']);
        $r = $change($k, $t, $c, 'not-the-current-password', $newPassword);
        assertSame([400, 'validation_failed', ['currentPassword']], [$r->status, $code($r), $fields($r)]);
        assertTrue(!isset($r->headers['Set-Cookie']), 'no cookie change');
        assertSame(200, $me($k, $t), 'the session survives');
        assertSame(200, $k->handle(loginRequest($a['email'], (string) $a['password']), requestId())->status, 'the password is unchanged');
        assertSame(1, (int) $db->select("SELECT COUNT(*) AS n FROM auth_events WHERE event = 'password_fail' AND user_id = ?", [$a['userId']])[0]['n']);
        assertSame(1, (int) $db->select('SELECT failures FROM auth_rate_limits WHERE bucket = ?', [hash('sha256', 'pwchange:' . $a['userId'])])[0]['failures']);
    },
    'five wrong current passwords lock the user\'s bucket: 429 with Retry-After, even for the right one; login is unaffected' => static function () use ($setup, $login, $change, $code, $newPassword): void {
        [$db, $k, $a] = $setup();
        [$t, $c] = $login($k, $a['email'], (string) $a['password']);
        for ($i = 0; $i < 5; $i++) {
            assertSame(400, $change($k, $t, $c, 'wrong-' . $i . '-password', $newPassword)->status);
        }
        $r = $change($k, $t, $c, (string) $a['password'], $newPassword);
        assertSame([429, 'rate_limited'], [$r->status, $code($r)]);
        assertTrue((int) ($r->headers['Retry-After'] ?? 0) >= 1, 'Retry-After');
        assertSame(200, $k->handle(loginRequest($a['email'], (string) $a['password']), requestId())->status, 'login throttling is separate');
    },
    'a refused new password is 400 [newPassword]; the account email comes from the database' => static function () use ($setup, $login, $change, $fields): void {
        [$db, $k, $a] = $setup();
        [$t, $c] = $login($k, $a['email'], (string) $a['password']);
        foreach (['short-one', $a['email'], strtoupper($a['email']), 'password12345', str_repeat('y', 73)] as $bad) {
            $r = $change($k, $t, $c, (string) $a['password'], $bad);
            assertSame([400, ['newPassword']], [$r->status, $fields($r)], substr($bad, 0, 10));
        }
        assertSame(0, (int) $db->select("SELECT COUNT(*) AS n FROM auth_events WHERE event IN ('password_change', 'password_fail')")[0]['n']);
    },
    'the principal is re-read: a disabled account or membership cannot change its password' => static function () use ($setup, $login, $change, $newPassword): void {
        foreach (['UPDATE users SET status = \'disabled\'', 'UPDATE memberships SET status = \'disabled\''] as $sql) {
            [$db, $k, $a] = $setup();
            [$t, $c] = $login($k, $a['email'], (string) $a['password']);
            $db->execute($sql);
            $r = $change($k, $t, $c, (string) $a['password'], $newPassword);
            assertSame(401, $r->status, $sql);
            assertTrue(Passwords::verify((string) $a['password'], (string) $db->select('SELECT password_hash FROM users WHERE id = ?', [$a['userId']])[0]['password_hash']), 'unchanged');
        }
    },
    'logout-all revokes every session of the caller, the current one included, clears the cookie, and touches no one else' => static function () use ($setup, $login, $me, $live, $clear): void {
        [$db, $k, $a] = $setup();
        $b = authFixture($db, ['companyId' => $a['companyId'], 'role' => 'employee', 'employeeId' => 'emp-9']);
        [$t1, $c1] = $login($k, $a['email'], (string) $a['password']);
        [$t2] = $login($k, $a['email'], (string) $a['password']);
        [$tb] = $login($k, $b['email'], (string) $b['password']);
        $r = $k->handle(sessionRequest('POST', '/api/auth/logout-all', $t1, $c1, '{}'), requestId());
        assertSame([200, ['loggedOut' => true], $clear], [$r->status, envelope($r)['data'], $r->headers['Set-Cookie'] ?? null]);
        assertSame([401, 401, 200], [$me($k, $t1), $me($k, $t2), $me($k, $tb)]);
        assertSame(0, $live($db, $a['userId']));
        $row = $db->select("SELECT user_id, membership_id FROM auth_events WHERE event = 'logout_all'")[0];
        assertSame([$a['userId'], $a['membershipId']], array_values($row));
    },
    'no password, session token or CSRF token reaches auth_events' => static function () use ($setup, $login, $change, $newPassword): void {
        [$db, $k, $a] = $setup();
        [$t, $c] = $login($k, $a['email'], (string) $a['password']);
        $change($k, $t, $c, 'typed-wrong-secret', $newPassword);
        $r = $change($k, $t, $c, (string) $a['password'], $newPassword);
        $fresh = (string) sessionCookieToken($r);
        $dump = (string) json_encode($db->select('SELECT * FROM auth_events'));
        foreach ([(string) $a['password'], $newPassword, 'typed-wrong-secret', $t, $c, $fresh, (string) envelope($r)['data']['csrfToken'], $a['email']] as $secret) {
            assertTrue(!str_contains($dump, $secret), 'auth_events holds no ' . substr($secret, 0, 8));
        }
    },
];
