<?php
declare(strict_types=1);

/*
 * POST /api/auth/activate (BF-3B) against the real, guarded CI MariaDB: the pending bootstrap
 * CEO sets a first password once; every token or account problem is the same 400; the token is
 * never consumed by a policy failure; expiry is strict on the database clock (equality is
 * expired — proven with a frozen session clock); failures are rate-limited per IP; activation
 * never sets a cookie; and no secret reaches the database or the log.
 */

use TamOs\Auth\Passwords;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
use function TamOs\Tests\activateRequest;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\authKernel;
use function TamOs\Tests\envelope;
use function TamOs\Tests\loginRequest;
use function TamOs\Tests\pendingCeo;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\requestId;
use function TamOs\Tests\sessionCookieToken;
use function TamOs\Tests\sessionRequest;
use function TamOs\Tests\testDbConfig;

$password = 'correct horse battery staple';

/** @return array{0: Database, 1: Kernel, 2: array<string, string>, 3: \TamOs\Config\Config} */
$setup = static function (): array {
    $db = authDatabase();
    $config = testDbConfig();
    return [$db, authKernel($config, AuthData::fromDatabase($db), productionMigrationsDir()), pendingCeo($db), $config];
};
$code = static fn ($r): ?string => envelope($r)['error']['code'] ?? null;
$fields = static fn ($r): ?array => envelope($r)['error']['fields'] ?? null;
$token = static fn (Database $db, string $raw): array => $db->select(
    'SELECT user_id, used_at IS NOT NULL AS used, revoked_at IS NOT NULL AS revoked, (used_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(6)) AS live FROM account_tokens WHERE token_hash = ?',
    [hash('sha256', $raw)],
)[0];
$hashOf = static fn (Database $db, string $userId): ?string => $db->select('SELECT password_hash FROM users WHERE id = ?', [$userId])[0]['password_hash'];
$events = static fn (Database $db): array => array_column($db->select('SELECT event FROM auth_events ORDER BY id'), 'event');

return [
    'a pending CEO activates once: password set, token consumed, event recorded, no cookie; login then works' => static function () use ($setup, $password, $token, $hashOf, $events): void {
        [$db, $k, $ceo] = $setup();
        assertSame(null, $hashOf($db, $ceo['userId']), 'pending: no password');
        assertSame(401, $k->handle(loginRequest($ceo['email'], $password), requestId())->status, 'a pending account cannot log in');
        $r = $k->handle(activateRequest($ceo['token'], $password), requestId());
        assertSame([200, ['activated' => true]], [$r->status, envelope($r)['data']]);
        assertTrue(!isset($r->headers['Set-Cookie']), 'no auto-login');
        assertTrue(Passwords::verify($password, $hashOf($db, $ceo['userId'])), 'the stored hash verifies the chosen password');
        assertSame([1, 0, 0], array_map('intval', [$token($db, $ceo['token'])['used'], $token($db, $ceo['token'])['revoked'], $token($db, $ceo['token'])['live']]));
        $row = $db->select("SELECT user_id, membership_id, email_hash, ip, request_id FROM auth_events WHERE event = 'activation_ok'")[0];
        assertSame([$ceo['userId'], $ceo['membershipId'], null, '203.0.113.7', requestId()], array_values($row));
        $login = $k->handle(loginRequest($ceo['email'], $password), requestId());
        assertSame([200, 'ceo', $ceo['userId']], [$login->status, envelope($login)['data']['role'], envelope($login)['data']['userId']]);
        assertSame(['ceo_bootstrap', 'login_failure', 'activation_ok', 'login_success'], $events($db));
    },
    'replay: a used token is the generic 400 and changes nothing' => static function () use ($setup, $password, $code, $fields, $hashOf): void {
        [$db, $k, $ceo] = $setup();
        assertSame(200, $k->handle(activateRequest($ceo['token'], $password), requestId())->status);
        $before = $hashOf($db, $ceo['userId']);
        $r = $k->handle(activateRequest($ceo['token'], 'another long password'), requestId());
        assertSame([400, 'validation_failed', ['token']], [$r->status, $code($r), $fields($r)]);
        assertSame($before, $hashOf($db, $ceo['userId']), 'the password was not replaced');
        $fail = $db->select("SELECT user_id, membership_id FROM auth_events WHERE event = 'activation_fail'")[0];
        assertSame([$ceo['userId'], null], array_values($fail), 'the failure names the token\'s user, never a membership');
    },
    'unknown, malformed and foreign tokens are all the same 400; nothing is consumed' => static function () use ($setup, $password, $code, $fields, $token): void {
        [$db, $k, $ceo] = $setup();
        foreach ([str_repeat('A', 43), 'short', substr($ceo['token'], 0, 42), $ceo['token'] . 'x', hash('sha256', $ceo['token']), strtoupper($ceo['token'])] as $bad) {
            if ($bad === $ceo['token']) {
                continue;
            }
            $r = $k->handle(activateRequest($bad, $password), requestId());
            assertSame([400, 'validation_failed', ['token']], [$r->status, $code($r), $fields($r)], substr($bad, 0, 8));
        }
        assertSame(1, (int) $token($db, $ceo['token'])['live'], 'the real token is still live');
        assertSame(0, count($db->select("SELECT id FROM auth_events WHERE event = 'activation_fail' AND user_id IS NOT NULL")), 'unknown tokens name no user');
    },
    'expiry is strict on the database clock: at expires_at the token is dead, a microsecond before it is live' => static function () use ($setup, $password, $code, $token): void {
        [$db, $k, $ceo] = $setup();
        // Freeze this connection's clock (the kernel shares it), so "now" is exactly known.
        $db->execute('SET SESSION timestamp = 1900000000.250000');
        try {
            $db->execute('UPDATE account_tokens SET created_at = UTC_TIMESTAMP(6) - INTERVAL 72 HOUR, expires_at = UTC_TIMESTAMP(6) WHERE token_hash = ?', [hash('sha256', $ceo['token'])]);
            $r = $k->handle(activateRequest($ceo['token'], $password), requestId());
            assertSame([400, 'validation_failed'], [$r->status, $code($r)], 'equality is expired');
            assertSame(0, (int) $token($db, $ceo['token'])['live']);
            $db->execute('UPDATE account_tokens SET expires_at = UTC_TIMESTAMP(6) + INTERVAL 1 MICROSECOND WHERE token_hash = ?', [hash('sha256', $ceo['token'])]);
            $ok = $k->handle(activateRequest($ceo['token'], $password), requestId());
            assertSame(200, $ok->status, 'one microsecond before expiry is live');
        } finally {
            $db->execute('SET SESSION timestamp = DEFAULT');
        }
    },
    'an expired token (72 hours passed) is refused' => static function () use ($setup, $password, $code): void {
        [$db, $k, $ceo] = $setup();
        $db->execute('UPDATE account_tokens SET created_at = UTC_TIMESTAMP(6) - INTERVAL 73 HOUR, expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 HOUR');
        assertSame([400, 'validation_failed'], (static fn ($r) => [$r->status, $code($r)])($k->handle(activateRequest($ceo['token'], $password), requestId())));
    },
    'a policy failure is 400 [password] and never consumes the token — including the account-email rule' => static function () use ($setup, $password, $code, $fields, $token, $hashOf): void {
        [$db, $k, $ceo] = $setup();
        foreach (['too-short', str_repeat('x', 73), "tab\tinside-password", 'passwordpassword', $ceo['email'], strtoupper($ceo['email'])] as $bad) {
            $r = $k->handle(activateRequest($ceo['token'], $bad), requestId());
            assertSame([400, 'validation_failed', ['password']], [$r->status, $code($r), $fields($r)], substr($bad, 0, 10));
        }
        assertSame(1, (int) $token($db, $ceo['token'])['live'], 'still live');
        assertSame(null, $hashOf($db, $ceo['userId']), 'still pending');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM auth_events WHERE event IN (?, ?)', ['activation_fail', 'activation_ok'])[0]['n'], 'no event for a policy failure');
        assertSame(200, $k->handle(activateRequest($ceo['token'], $password), requestId())->status, 'the token still works');
    },
    'the 72-byte boundary: 72 bytes activate and log in; 73 bytes are refused' => static function () use ($setup, $code, $fields): void {
        [$db, $k, $ceo] = $setup();
        $long = str_repeat('日', 23) . 'abc';
        assertSame(72, strlen($long));
        $r = $k->handle(activateRequest($ceo['token'], $long . 'd'), requestId());
        assertSame([400, ['password']], [$r->status, $fields($r)], '73 bytes');
        assertSame(200, $k->handle(activateRequest($ceo['token'], $long), requestId())->status, '72 bytes');
        assertSame(200, $k->handle(loginRequest($ceo['email'], $long), requestId())->status, 'login accepts what activation set');
    },
    'a disabled user or membership, or an account that already has a password, cannot activate; the token stays live' => static function () use ($setup, $password, $code, $fields, $token): void {
        foreach ([
            'disabled user' => 'UPDATE users SET status = \'disabled\'',
            'disabled membership' => 'UPDATE memberships SET status = \'disabled\'',
            'password already set' => 'UPDATE users SET password_hash = \'$2y$12$abcdefghijklmnopqrstuuM6Xg9I8ZkkPC6r0h9t8zq9D2dS6f9cC\'',
        ] as $label => $sql) {
            [$db, $k, $ceo] = $setup();
            $db->execute($sql);
            $r = $k->handle(activateRequest($ceo['token'], $password), requestId());
            assertSame([400, 'validation_failed', ['token']], [$r->status, $code($r), $fields($r)], $label);
            assertSame(1, (int) $token($db, $ceo['token'])['live'], $label . ': not consumed');
        }
    },
    'activation revokes the user\'s other tokens and every session, and no other user\'s' => static function () use ($setup, $password): void {
        [$db, $k, $ceo] = $setup();
        $other = authFixture($db, ['companyId' => $ceo['companyId'], 'role' => 'employee', 'employeeId' => 'emp-1']);
        $otherLogin = $k->handle(loginRequest($other['email'], (string) $other['password']), requestId());
        $spare = hash('sha256', 'spare-' . bin2hex(random_bytes(8)));
        $db->execute("INSERT INTO account_tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, 'activation', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 1 HOUR)", [$spare, $ceo['userId']]);
        $db->execute("INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, last_seen_at, absolute_expires_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 1 HOUR)", [hash('sha256', 'stale'), $ceo['userId'], str_repeat('c', 43)]);
        assertSame(200, $k->handle(activateRequest($ceo['token'], $password), requestId())->status);
        assertSame(1, (int) $db->select('SELECT revoked_at IS NOT NULL AS r FROM account_tokens WHERE token_hash = ?', [$spare])[0]['r'], 'spare token revoked');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL', [$ceo['userId']])[0]['n'], 'sessions revoked');
        $me = $k->handle(sessionRequest('GET', '/api/auth/me', sessionCookieToken($otherLogin)), requestId());
        assertSame(200, $me->status, 'another user\'s session is untouched');
    },
    'a stale session cookie on the request is ignored and survives' => static function () use ($setup, $password): void {
        [$db, $k, $ceo] = $setup();
        $other = authFixture($db, ['companyId' => $ceo['companyId'], 'role' => 'employee', 'employeeId' => 'emp-2']);
        $session = (string) sessionCookieToken($k->handle(loginRequest($other['email'], (string) $other['password']), requestId()));
        $r = $k->handle(activateRequest($ceo['token'], $password, ['sessionToken' => $session]), requestId());
        assertSame(200, $r->status);
        assertTrue(!isset($r->headers['Set-Cookie']), 'no cookie set or cleared');
        assertSame(200, $k->handle(sessionRequest('GET', '/api/auth/me', $session), requestId())->status, 'the presented session was not touched');
    },
    'failed redemptions are throttled per IP (20 per window); a locked IP cannot redeem even a valid token' => static function () use ($setup, $password, $code, $token): void {
        [$db, $k, $ceo] = $setup();
        for ($i = 0; $i < 20; $i++) {
            assertSame(400, $k->handle(activateRequest(str_repeat(chr(65 + $i), 43), $password), requestId())->status, 'failure ' . $i);
        }
        $r = $k->handle(activateRequest($ceo['token'], $password), requestId());
        assertSame([429, 'rate_limited'], [$r->status, $code($r)]);
        assertTrue((int) ($r->headers['Retry-After'] ?? 0) >= 1, 'Retry-After');
        assertSame(1, (int) $token($db, $ceo['token'])['live'], 'not consumed while locked');
        $other = $k->handle(activateRequest($ceo['token'], $password, ['remoteAddr' => '198.51.100.20']), requestId());
        assertSame(200, $other->status, 'another IP is not locked out');
        assertSame(20, (int) $db->select("SELECT COUNT(*) AS n FROM auth_events WHERE event = 'activation_fail'")[0]['n']);
    },
    'no password, token or email reaches the database or the access log' => static function () use ($setup, $password): void {
        [$db, $k, $ceo, $config] = $setup();
        $k->handle(activateRequest($ceo['token'], 'wrong-length'), requestId());
        $k->handle(activateRequest(str_repeat('Z', 43), $password), requestId());
        $k->handle(activateRequest($ceo['token'], $password), requestId());
        $dump = '';
        foreach (['account_tokens', 'auth_events', 'auth_rate_limits', 'sessions'] as $t) {
            $dump .= json_encode($db->select('SELECT * FROM ' . $t));
        }
        $log = is_file($config->logPath) ? (string) file_get_contents($config->logPath) : '';
        foreach ([$ceo['token'], $password, 'wrong-length', $ceo['email'], str_repeat('Z', 43)] as $secret) {
            assertTrue(!str_contains($dump, $secret), 'database holds no ' . substr($secret, 0, 8));
            assertTrue(!str_contains($log, $secret), 'log holds no ' . substr($secret, 0, 8));
        }
    },
];
