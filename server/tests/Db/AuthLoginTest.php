<?php
declare(strict_types=1);

/*
 * POST /api/auth/login against the real, guarded CI MariaDB with the production schema.
 * Accounts are per-run fixtures (tests/lib.php authFixture) — never production credentials.
 */

use TamOs\Auth\Passwords;
use TamOs\Auth\SessionToken;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
use TamOs\Http\Response;
use function TamOs\Tests\assertApiHeaders;
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

/** @return array{0: Database, 1: Kernel} */
$setup = static function (): array {
    $db = authDatabase();
    return [$db, authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir())];
};
$login = static fn (Kernel $k, string $email, string $password, array $o = []): Response => $k->handle(loginRequest($email, $password, $o), requestId());
/** The public part of a response: status, body without its request ID, and cookie presence. */
$public = static function (Response $r): array {
    $env = envelope($r);
    unset($env['requestId']);
    return [$r->status, $env, isset($r->headers['Set-Cookie']), $r->headers['Retry-After'] ?? null];
};
$count = static fn (Database $db, string $table): int => (int) $db->select('SELECT COUNT(*) AS n FROM ' . $table)[0]['n'];

return [
    'a CEO logs in: 200 projection, exact session cookie, nothing else disclosed' => static function () use ($setup, $login): void {
        [$db, $k] = $setup();
        $a = authFixture($db, ['role' => 'ceo']);
        $r = $login($k, '  ' . strtoupper($a['email']) . ' ', (string) $a['password']);
        assertSame(200, $r->status, 'normalized email logs in');
        assertApiHeaders($r, requestId(), true);
        $data = envelope($r)['data'];
        assertSame(['userId', 'membershipId', 'role', 'employeeId', 'csrfToken'], array_keys($data));
        assertSame([$a['userId'], $a['membershipId'], 'ceo', null], [$data['userId'], $data['membershipId'], $data['role'], $data['employeeId']]);
        assertTrue(SessionToken::isWellFormed($data['csrfToken']), 'csrf token shape');
        $token = sessionCookieToken($r);
        assertTrue($token !== null, 'cookie carries a token');
        assertSame('__Host-tamos_session=' . $token . '; Path=/; Secure; HttpOnly; SameSite=Strict', $r->headers['Set-Cookie']);
        assertTrue($token !== $data['csrfToken'], 'distinct tokens');
        assertNoLeak($r->body, [$a['companyId'], $a['email'], (string) $a['password'], $token, hash('sha256', $token), 'active']);
    },
    'the session row holds only the token hash, the CSRF token and DB-clock times (12 h absolute)' => static function () use ($setup, $login): void {
        [$db, $k] = $setup();
        $a = authFixture($db);
        $r = $login($k, $a['email'], (string) $a['password']);
        $token = (string) sessionCookieToken($r);
        $rows = $db->select('SELECT token_hash, user_id, csrf_token, revoked_at, TIMESTAMPDIFF(MICROSECOND, created_at, absolute_expires_at) AS life, (last_seen_at = created_at) AS fresh, TIMESTAMPDIFF(SECOND, created_at, UTC_TIMESTAMP(6)) AS age FROM sessions');
        assertSame(1, count($rows));
        assertSame([hash('sha256', $token), $a['userId'], envelope($r)['data']['csrfToken'], null],
            [$rows[0]['token_hash'], $rows[0]['user_id'], $rows[0]['csrf_token'], $rows[0]['revoked_at']]);
        assertSame([12 * 3600 * 1000000, 1], [(int) $rows[0]['life'], (int) $rows[0]['fresh']]);
        assertTrue((int) $rows[0]['age'] >= 0 && (int) $rows[0]['age'] < 60, 'created by the DB clock just now');
        $dump = json_encode($db->select('SELECT * FROM sessions'));
        assertTrue(!str_contains((string) $dump, $token), 'raw session token is not stored');
    },
    'an Employee login carries the employee binding' => static function () use ($setup, $login): void {
        [$db, $k] = $setup();
        $a = authFixture($db, ['role' => 'employee', 'employeeId' => 'emp-0042']);
        $data = envelope($login($k, $a['email'], (string) $a['password']))['data'];
        assertSame(['employee', 'emp-0042'], [$data['role'], $data['employeeId']]);
    },
    'every login is a new token; a second login without a cookie leaves the first session alone' => static function () use ($setup, $login): void {
        [$db, $k] = $setup();
        $a = authFixture($db);
        $t1 = sessionCookieToken($login($k, $a['email'], (string) $a['password']));
        $t2 = sessionCookieToken($login($k, $a['email'], (string) $a['password']));
        assertTrue($t1 !== null && $t2 !== null && $t1 !== $t2, 'fresh token');
        assertSame(200, $k->handle(sessionRequest('GET', '/api/auth/me', $t1), requestId())->status);
        assertSame(200, $k->handle(sessionRequest('GET', '/api/auth/me', $t2), requestId())->status);
    },
    'a recognized presented session is revoked and never adopted' => static function () use ($setup, $login): void {
        [$db, $k] = $setup();
        $a = authFixture($db);
        $t1 = (string) sessionCookieToken($login($k, $a['email'], (string) $a['password']));
        $r = $login($k, $a['email'], (string) $a['password'], ['sessionToken' => $t1]);
        $t2 = (string) sessionCookieToken($r);
        assertTrue($t2 !== '' && $t2 !== $t1, 'new token, not the presented one');
        assertTrue($db->select('SELECT revoked_at FROM sessions WHERE token_hash = ?', [hash('sha256', $t1)])[0]['revoked_at'] !== null, 'old session revoked');
        assertSame(401, $k->handle(sessionRequest('GET', '/api/auth/me', $t1), requestId())->status);
        assertSame(200, $k->handle(sessionRequest('GET', '/api/auth/me', $t2), requestId())->status);
        // Another user's session presented by this browser also ends.
        $b = authFixture($db);
        $tb = (string) sessionCookieToken($login($k, $b['email'], (string) $b['password']));
        $login($k, $a['email'], (string) $a['password'], ['sessionToken' => $tb]);
        assertSame(401, $k->handle(sessionRequest('GET', '/api/auth/me', $tb), requestId())->status);
        // An unknown or malformed presented cookie changes nothing and is not adopted.
        $forged = str_repeat('F', 43);
        $r = $login($k, $a['email'], (string) $a['password'], ['sessionToken' => $forged]);
        assertTrue(sessionCookieToken($r) !== $forged, 'forged token not adopted');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?', [hash('sha256', $forged)])[0]['n']);
    },
    'every credential, account and membership failure is the same 401 and creates no session' => static function () use ($setup, $login, $public, $count): void {
        [$db, $k] = $setup();
        $ok = authFixture($db);
        $cases = [
            'wrong password' => [$ok['email'], (string) $ok['password'] . 'x'],
            'password over 72 bytes' => [$ok['email'], str_repeat('p', 73)],
            'empty password' => [$ok['email'], ''],
            'unknown email' => ['nobody-' . bin2hex(random_bytes(4)) . '@example.test', 'pw-whatever-1'],
            'invalid email' => ['not an email', 'pw-whatever-2'],
        ];
        $notActivated = authFixture($db, ['password' => null]);
        $cases['password not set (NULL hash)'] = [$notActivated['email'], 'pw-anything-3'];
        foreach ([
            'disabled user' => ['userStatus' => 'disabled'],
            'missing membership' => ['membership' => false],
            'disabled membership' => ['membershipStatus' => 'disabled'],
        ] as $label => $o) {
            $f = authFixture($db, $o);
            $cases[$label . ' (correct password)'] = [$f['email'], (string) $f['password']];
        }
        // An unknown role cannot be inserted (CHECK); the test bypasses it on this session only.
        $bad = authFixture($db);
        $db->execute('SET SESSION check_constraint_checks = 0');
        try {
            $db->execute("UPDATE memberships SET role = 'admin' WHERE user_id = ?", [$bad['userId']]);
        } finally {
            $db->execute('SET SESSION check_constraint_checks = 1');
        }
        $cases['unknown role (correct password)'] = [$bad['email'], (string) $bad['password']];
        $unbound = authFixture($db);
        $db->execute('SET SESSION check_constraint_checks = 0');
        try {
            $db->execute("UPDATE memberships SET role = 'employee', employee_id = NULL WHERE user_id = ?", [$unbound['userId']]);
        } finally {
            $db->execute('SET SESSION check_constraint_checks = 1');
        }
        $cases['employee without binding (correct password)'] = [$unbound['email'], (string) $unbound['password']];

        $reference = null;
        $i = 0;
        foreach ($cases as $label => [$email, $password]) {
            $i++;
            $r = $login($k, $email, $password, ['remoteAddr' => '198.51.100.' . $i]);
            assertApiHeaders($r, requestId());
            $p = $public($r);
            $reference ??= $p;
            assertSame([401, ['ok' => false, 'error' => ['code' => 'unauthenticated', 'message' => 'Authentication is required.']], false, null], $p, $label);
            assertSame($reference, $p, $label . ': byte-identical public response');
            assertNoLeak($r->body, [$email, $password]);
        }
        assertSame(0, $count($db, 'sessions'), 'no session for any failure');
        assertSame(401, $login($k, $ok['email'], strtoupper((string) $ok['password']))->status, 'case matters in passwords');
        assertSame(200, $login($k, $ok['email'], (string) $ok['password'], ['remoteAddr' => '198.51.100.200'])->status, 'the good account still works');
    },
    'a successful login rehashes an outdated hash inside the login transaction; a failed one never does' => static function () use ($setup, $login): void {
        [$db, $k] = $setup();
        $password = 'pw-' . bin2hex(random_bytes(8));
        $old = password_hash($password, PASSWORD_BCRYPT, ['cost' => 4]);
        $a = authFixture($db, ['password' => $password, 'passwordHash' => $old]);
        $hashOf = static fn (): string => (string) $db->select('SELECT password_hash FROM users WHERE id = ?', [$a['userId']])[0]['password_hash'];
        assertSame(401, $login($k, $a['email'], $password . 'x')->status);
        assertSame($old, $hashOf(), 'failed login: no rehash');
        assertSame(200, $login($k, $a['email'], $password)->status);
        $new = $hashOf();
        assertTrue($new !== $old, 'rehashed');
        assertSame(false, Passwords::needsRehash($new), 'current algorithm and options');
        assertSame(true, Passwords::verify($password, $new));
        assertSame(200, $login($k, $a['email'], $password)->status, 'still logs in');
        assertSame($new, $hashOf(), 'a current hash is left alone');
    },
    'the rehash compare-and-swap changes only the intended row and only from the verified hash' => static function (): void {
        $db = authDatabase();
        $a = authFixture($db);
        $b = authFixture($db);
        $store = AuthData::fromDatabase($db)->accounts();
        $aHash = (string) $db->select('SELECT password_hash FROM users WHERE id = ?', [$a['userId']])[0]['password_hash'];
        $bHash = (string) $db->select('SELECT password_hash FROM users WHERE id = ?', [$b['userId']])[0]['password_hash'];
        $new = Passwords::hash('pw-replacement-1');
        assertSame(false, $store->replacePasswordHash($a['userId'], $bHash, $new), 'stale expected hash: no change');
        assertSame(true, $store->replacePasswordHash($a['userId'], $aHash, $new));
        assertSame($new, $db->select('SELECT password_hash FROM users WHERE id = ?', [$a['userId']])[0]['password_hash']);
        assertSame($bHash, $db->select('SELECT password_hash FROM users WHERE id = ?', [$b['userId']])[0]['password_hash'], 'other user untouched');
    },
    'the password is never stored or echoed anywhere' => static function () use ($setup, $login): void {
        [$db, $k] = $setup();
        $a = authFixture($db);
        $login($k, $a['email'], (string) $a['password'] . 'wrong');
        $login($k, $a['email'], (string) $a['password']);
        foreach (['users', 'sessions', 'auth_events', 'auth_rate_limits', 'memberships'] as $t) {
            $dump = (string) json_encode($db->select('SELECT * FROM ' . $t));
            assertTrue(!str_contains($dump, (string) $a['password']), $t . ' holds no password');
        }
    },
];
