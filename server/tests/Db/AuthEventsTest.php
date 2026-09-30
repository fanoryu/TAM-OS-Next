<?php
declare(strict_types=1);

/*
 * Authentication security events against the real, guarded CI MariaDB: what each event
 * records, that it commits with its transaction (and rolls back with it), that the
 * application can only append, and that no secret ever reaches the table.
 */

use TamOs\Auth\LoginKeys;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\Auth\AuthEvents;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
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
$events = static fn (Database $db): array => $db->select(
    'SELECT event, user_id, membership_id, email_hash, ip, request_id, (occurred_at <= UTC_TIMESTAMP(6) AND occurred_at > UTC_TIMESTAMP(6) - INTERVAL 1 MINUTE) AS recent FROM auth_events ORDER BY id',
);

return [
    'success, failure, locked and logout each record exactly their approved fields' => static function () use ($setup, $events): void {
        [$db, $k] = $setup();
        $a = authFixture($db);
        $unknown = 'Ghost-' . bin2hex(random_bytes(4)) . '@Example.test';
        $k->handle(loginRequest($unknown, 'wrong-0', ['remoteAddr' => '198.51.100.9']), requestId());
        for ($i = 1; $i <= 5; $i++) {
            $k->handle(loginRequest($a['email'], 'wrong-' . $i), requestId());
        }
        $k->handle(loginRequest($a['email'], (string) $a['password']), requestId()); // locked
        $db->execute('UPDATE auth_rate_limits SET locked_until = NULL');
        $r = $k->handle(loginRequest($a['email'], (string) $a['password']), requestId());
        $token = (string) sessionCookieToken($r);
        $k->handle(sessionRequest('POST', '/api/auth/logout', $token, (string) envelope($r)['data']['csrfToken']), requestId());

        $rows = $events($db);
        assertSame(['login_failure', 'login_failure', 'login_failure', 'login_failure', 'login_failure', 'login_failure', 'login_locked', 'login_success', 'logout'],
            array_column($rows, 'event'));
        $unknownHash = LoginKeys::emailHash(strtolower($unknown));
        assertSame(['login_failure', null, null, $unknownHash, '198.51.100.9', requestId()], array_values(array_slice($rows[0], 0, 6)), 'unknown account: no user');
        assertSame(['login_failure', $a['userId'], null, LoginKeys::emailHash($a['email']), '203.0.113.7', requestId()], array_values(array_slice($rows[1], 0, 6)), 'known account');
        assertSame(['login_locked', null, null, LoginKeys::emailHash($a['email']), '203.0.113.7', requestId()], array_values(array_slice($rows[6], 0, 6)));
        assertSame(['login_success', $a['userId'], $a['membershipId'], null, '203.0.113.7', requestId()], array_values(array_slice($rows[7], 0, 6)));
        assertSame(['logout', $a['userId'], $a['membershipId'], null, '203.0.113.7', requestId()], array_values(array_slice($rows[8], 0, 6)));
        foreach ($rows as $row) {
            assertSame(1, (int) $row['recent'], 'database-clock timestamp');
        }
    },
    'no password, token, CSRF token or raw email ever reaches auth_events' => static function () use ($setup): void {
        [$db, $k] = $setup();
        $a = authFixture($db);
        $k->handle(loginRequest($a['email'], 'typed-secret-' . bin2hex(random_bytes(4))), requestId());
        $r = $k->handle(loginRequest($a['email'], (string) $a['password']), requestId());
        $token = (string) sessionCookieToken($r);
        $csrf = (string) envelope($r)['data']['csrfToken'];
        $k->handle(sessionRequest('POST', '/api/auth/logout', $token, $csrf), requestId());
        $dump = (string) json_encode($db->select('SELECT * FROM auth_events'));
        foreach ([(string) $a['password'], 'typed-secret-', $token, hash('sha256', $token), $csrf, $a['email'], 'example.test'] as $secret) {
            assertTrue(!str_contains($dump, $secret), 'auth_events holds no ' . substr($secret, 0, 12));
        }
    },
    'an event commits or rolls back with its transaction' => static function (): void {
        $db = authDatabase();
        $auth = AuthData::fromDatabase($db);
        assertThrows(RuntimeException::class, static fn () => $auth->atomically(static function () use ($auth): void {
            $auth->events()->append('login_failure', null, null, str_repeat('a', 64), null, requestId());
            $auth->rateLimits()->lock(str_repeat('b', 64));
            throw new RuntimeException('abort');
        }));
        assertSame([0, 0], [(int) $db->select('SELECT COUNT(*) AS n FROM auth_events')[0]['n'], (int) $db->select('SELECT COUNT(*) AS n FROM auth_rate_limits')[0]['n']]);
        $auth->atomically(static fn () => $auth->events()->append('logout', null, null, null, null, requestId()));
        assertSame(1, (int) $db->select('SELECT COUNT(*) AS n FROM auth_events')[0]['n']);
    },
    'the application API can only append, and only the approved vocabulary with server-generated identifiers' => static function (): void {
        $methods = array_map(static fn (ReflectionMethod $m): string => $m->getName(), (new ReflectionClass(AuthEvents::class))->getMethods(ReflectionMethod::IS_PUBLIC));
        sort($methods);
        assertSame(['__construct', 'append'], $methods);
        $events = AuthData::fromDatabase(authDatabase())->events();
        assertThrows(LogicException::class, static fn () => $events->append('password_changed', null, null, null, null, requestId()));
        assertThrows(LogicException::class, static fn () => $events->append('logout', null, null, null, null, 'client-chosen-id'));
        assertThrows(LogicException::class, static fn () => $events->append('login_failure', null, null, 'someone@example.test', null, requestId()));
    },
];
