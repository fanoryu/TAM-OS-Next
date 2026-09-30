<?php
declare(strict_types=1);

/*
 * Session resolution (SessionPrincipalResolver) against the real, guarded CI MariaDB: the
 * DB-clock expiry rules, the throttled touch that can never revive a session, and fresh
 * account state on every request. Times are moved by test-only SQL on the fixture rows.
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
use TamOs\Http\Request;
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

/** @return array{0: Database, 1: Kernel, 2: array<string, mixed>, 3: string, 4: string} db, kernel, account, token, csrf */
$session = static function (array $o = []): array {
    $db = authDatabase();
    $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
    $a = authFixture($db, $o);
    $r = $k->handle(loginRequest($a['email'], (string) $a['password']), requestId());
    assertSame(200, $r->status, 'fixture login');
    return [$db, $k, $a, (string) sessionCookieToken($r), (string) envelope($r)['data']['csrfToken']];
};
$me = static fn (Kernel $k, ?string $token): array => (static function ($r): array {
    return [$r->status, $r->status === 200 ? envelope($r)['data'] : null];
})($k->handle(sessionRequest('GET', '/api/auth/me', $token), requestId()));
$set = static fn (Database $db, string $token, string $assignment): int => $db->execute('UPDATE sessions SET ' . $assignment . ' WHERE token_hash = ?', [hash('sha256', $token)]);
$lastSeen = static fn (Database $db, string $token): string => (string) $db->select('SELECT last_seen_at FROM sessions WHERE token_hash = ?', [hash('sha256', $token)])[0]['last_seen_at'];

return [
    'a valid session resolves to the same projection as login; malformed or unknown tokens do not' => static function () use ($session, $me): void {
        [$db, $k, $a, $token, $csrf] = $session();
        assertSame([200, ['userId' => $a['userId'], 'membershipId' => $a['membershipId'], 'role' => 'ceo', 'employeeId' => null, 'csrfToken' => $csrf]], $me($k, $token));
        foreach (['malformed', str_repeat('Q', 43), hash('sha256', $token), substr($token, 0, 42)] as $bad) {
            assertSame(401, $me($k, $bad)[0], 'rejected: ' . substr($bad, 0, 8));
        }
    },
    'revoked sessions are dead' => static function () use ($session, $me, $set): void {
        [$db, $k, , $token] = $session();
        $set($db, $token, 'revoked_at = UTC_TIMESTAMP(6)');
        assertSame(401, $me($k, $token)[0]);
    },
    'idle expiry: 30 minutes by the database clock' => static function () use ($session, $me, $set): void {
        [$db, $k, , $token] = $session();
        $set($db, $token, 'last_seen_at = UTC_TIMESTAMP(6) - INTERVAL 29 MINUTE');
        assertSame(200, $me($k, $token)[0], '29 minutes idle is alive');
        $set($db, $token, 'last_seen_at = UTC_TIMESTAMP(6) - INTERVAL 30 MINUTE - INTERVAL 1 SECOND');
        assertSame(401, $me($k, $token)[0], 'past 30 minutes idle is expired');
    },
    'absolute expiry: activity never extends a session past absolute_expires_at' => static function () use ($session, $me, $set): void {
        [$db, $k, , $token] = $session();
        $set($db, $token, 'absolute_expires_at = UTC_TIMESTAMP(6) + INTERVAL 5 SECOND');
        assertSame(200, $me($k, $token)[0]);
        $set($db, $token, 'absolute_expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 MICROSECOND, last_seen_at = UTC_TIMESTAMP(6)');
        assertSame(401, $me($k, $token)[0], 'expired although just active');
    },
    'account state is read on every request: disable user, disable membership, remove password' => static function () use ($session, $me): void {
        foreach ([
            'user disabled' => "UPDATE users SET status = 'disabled' WHERE id = ?",
            'membership disabled' => "UPDATE memberships SET status = 'disabled' WHERE user_id = ?",
            'password removed' => 'UPDATE users SET password_hash = NULL WHERE id = ?',
            'membership removed' => 'DELETE FROM memberships WHERE user_id = ?',
        ] as $label => $sql) {
            [$db, $k, $a, $token] = $session();
            assertSame(200, $me($k, $token)[0], $label . ': before');
            $db->execute($sql, [$a['userId']]);
            assertSame(401, $me($k, $token)[0], $label . ': next request denied');
        }
    },
    'role and employee-binding changes are observed on the next request; an unknown role denies' => static function () use ($session, $me): void {
        [$db, $k, $a, $token] = $session(['role' => 'ceo']);
        $db->execute("UPDATE memberships SET role = 'employee', employee_id = 'emp-9' WHERE user_id = ?", [$a['userId']]);
        $now = $me($k, $token);
        assertSame([200, 'employee', 'emp-9'], [$now[0], $now[1]['role'] ?? null, $now[1]['employeeId'] ?? null]);
        $db->execute("UPDATE memberships SET employee_id = 'emp-10' WHERE user_id = ?", [$a['userId']]);
        assertSame('emp-10', $me($k, $token)[1]['employeeId'] ?? null, 'binding change observed');
        $db->execute('SET SESSION check_constraint_checks = 0');
        try {
            $db->execute("UPDATE memberships SET role = 'owner' WHERE user_id = ?", [$a['userId']]);
        } finally {
            $db->execute('SET SESSION check_constraint_checks = 1');
        }
        assertSame(401, $me($k, $token)[0], 'unknown role: no fallback');
    },
    'logout revokes the current session only; revokeAllForUser revokes every session of that user only' => static function () use ($session, $me): void {
        [$db, $k, $a, $t1, $csrf1] = $session();
        $t2 = (string) sessionCookieToken($k->handle(loginRequest($a['email'], (string) $a['password']), requestId()));
        $r = $k->handle(sessionRequest('POST', '/api/auth/logout', $t1, $csrf1), requestId());
        assertSame(200, $r->status);
        assertSame([401, 200], [$me($k, $t1)[0], $me($k, $t2)[0]], 'only the current session ends');
        $b = authFixture($db);
        $tb = (string) sessionCookieToken($k->handle(loginRequest($b['email'], (string) $b['password']), requestId()));
        $t3 = (string) sessionCookieToken($k->handle(loginRequest($a['email'], (string) $a['password']), requestId()));
        assertSame(2, AuthData::fromDatabase($db)->sessions()->revokeAllForUser($a['userId']), 'the two live sessions of A');
        assertSame([401, 401, 200], [$me($k, $t2)[0], $me($k, $t3)[0], $me($k, $tb)[0]]);
        assertSame(0, AuthData::fromDatabase($db)->sessions()->revokeAllForUser($a['userId']), 'idempotent');
    },
    'touch: at most once per 60 seconds, by the database clock' => static function () use ($session, $me, $set, $lastSeen): void {
        [$db, $k, , $token] = $session();
        $set($db, $token, 'last_seen_at = UTC_TIMESTAMP(6) - INTERVAL 30 SECOND');
        $before = $lastSeen($db, $token);
        assertSame(200, $me($k, $token)[0]);
        assertSame($before, $lastSeen($db, $token), 'not due: no write');
        $set($db, $token, 'last_seen_at = UTC_TIMESTAMP(6) - INTERVAL 5 MINUTE');
        $old = $lastSeen($db, $token);
        assertSame(200, $me($k, $token)[0]);
        $new = $lastSeen($db, $token);
        assertTrue($new > $old, 'due: touched');
        assertSame(1, (int) $db->select('SELECT (last_seen_at > UTC_TIMESTAMP(6) - INTERVAL 10 SECOND) AS recent FROM sessions WHERE token_hash = ?', [hash('sha256', $token)])[0]['recent']);
        assertSame(200, $me($k, $token)[0]);
        assertSame($new, $lastSeen($db, $token), 'immediately after: throttled');
    },
    'touch can never resurrect a revoked, idle-expired or absolute-expired session' => static function () use ($session, $set, $lastSeen): void {
        foreach ([
            'revoked' => 'revoked_at = UTC_TIMESTAMP(6), last_seen_at = UTC_TIMESTAMP(6) - INTERVAL 5 MINUTE',
            'idle-expired' => 'last_seen_at = UTC_TIMESTAMP(6) - INTERVAL 31 MINUTE',
            'absolute-expired' => 'absolute_expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND, last_seen_at = UTC_TIMESTAMP(6) - INTERVAL 5 MINUTE',
        ] as $label => $assignment) {
            [$db, , , $token] = $session();
            $set($db, $token, $assignment);
            $before = $db->select('SELECT last_seen_at, revoked_at, absolute_expires_at FROM sessions WHERE token_hash = ?', [hash('sha256', $token)]);
            AuthData::fromDatabase($db)->sessions()->touch(hash('sha256', $token));
            assertSame($before, $db->select('SELECT last_seen_at, revoked_at, absolute_expires_at FROM sessions WHERE token_hash = ?', [hash('sha256', $token)]), $label . ': row unchanged');
            assertSame(null, AuthData::fromDatabase($db)->sessions()->findActive(hash('sha256', $token)), $label . ': still invalid');
        }
    },
    'health and ready never resolve or touch a session, even with a valid, touch-due cookie' => static function () use ($session, $set, $lastSeen): void {
        [$db, $k, , $token] = $session();
        $set($db, $token, 'last_seen_at = UTC_TIMESTAMP(6) - INTERVAL 5 MINUTE');
        $before = $lastSeen($db, $token);
        foreach (['GET', 'HEAD'] as $method) {
            assertSame(200, $k->handle(sessionRequest($method, '/api/health', $token), requestId())->status, $method . ' health');
            assertSame(200, $k->handle(sessionRequest($method, '/api/ready', $token), requestId())->status, $method . ' ready');
        }
        assertSame($before, $lastSeen($db, $token), 'no resolution, so no touch');
        assertSame(200, $k->handle(sessionRequest('GET', '/api/auth/me', $token), requestId())->status);
        assertTrue($lastSeen($db, $token) > $before, 'me does resolve and touch');
    },
    'forged identity inputs never change who the session is' => static function () use ($session): void {
        [$db, $k, $a, $token] = $session(['role' => 'employee', 'employeeId' => 'emp-real']);
        $saved = $_SERVER;
        $_SERVER = [
            'REQUEST_METHOD' => 'GET', 'REQUEST_URI' => '/api/auth/me', 'HTTP_COOKIE' => 'role=ceo; __Host-tamos_session=' . $token,
            'HTTP_X_ROLE' => 'ceo', 'HTTP_X_USER' => 'u-forged', 'HTTP_X_COMPANY' => 'c-forged', 'HTTP_X_EMPLOYEE' => 'emp-forged',
            'HTTP_X_ACTING_AS' => 'ceo', 'HTTP_X_FORWARDED_FOR' => '10.0.0.1', 'REMOTE_ADDR' => '203.0.113.9',
        ];
        try {
            $request = Request::fromGlobals(65536);
        } finally {
            $_SERVER = $saved;
        }
        $r = $k->handle($request, requestId());
        assertSame([200, $a['userId'], 'employee', 'emp-real'], [$r->status, envelope($r)['data']['userId'], envelope($r)['data']['role'], envelope($r)['data']['employeeId']]);
    },
];
