<?php
declare(strict_types=1);

/*
 * Login throttling against the real, guarded CI MariaDB: account and IP thresholds, backoff,
 * expiry, success reset, unknown accounts, persistence, and REMOTE_ADDR as the only IP.
 */

use TamOs\Auth\LoginKeys;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
use TamOs\Http\Request;
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
use function TamOs\Tests\testDbConfig;

/** @return array{0: Database, 1: Kernel} */
$setup = static function (): array {
    $db = authDatabase();
    return [$db, authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir())];
};
$login = static fn (Kernel $k, string $email, string $password, string $ip = '203.0.113.7'): Response
    => $k->handle(loginRequest($email, $password, ['remoteAddr' => $ip]), requestId());
$bucket = static fn (Database $db, string $key): ?array => $db->select(
    'SELECT failures, TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(6), locked_until) AS remaining FROM auth_rate_limits WHERE bucket = ?',
    [$key],
)[0] ?? null;
$public = static function (Response $r): array {
    $env = envelope($r);
    unset($env['requestId']);
    return [$r->status, $env, isset($r->headers['Set-Cookie'])];
};
$unlock = static fn (Database $db): int => $db->execute('UPDATE auth_rate_limits SET locked_until = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE locked_until IS NOT NULL');

return [
    'account: the 5th failure locks for 1 minute; even the right password is then 429 with Retry-After' => static function () use ($setup, $login, $bucket): void {
        [$db, $k] = $setup();
        $a = authFixture($db);
        for ($i = 1; $i <= 5; $i++) {
            assertSame(401, $login($k, $a['email'], 'wrong-' . $i, '198.51.100.' . $i)->status, 'failure ' . $i);
        }
        $row = $bucket($db, LoginKeys::accountBucket($a['email']));
        assertSame(5, (int) $row['failures']);
        assertTrue((int) $row['remaining'] > 55 * 1000000 && (int) $row['remaining'] <= 60 * 1000000, 'locked about 60 s');
        $r = $login($k, $a['email'], (string) $a['password'], '198.51.100.99');
        assertSame([429, 'rate_limited'], [$r->status, envelope($r)['error']['code']]);
        $retry = (int) ($r->headers['Retry-After'] ?? 0);
        assertTrue($retry >= 1 && $retry <= 60, 'Retry-After ' . $retry);
        assertTrue(!isset($r->headers['Set-Cookie']), 'no session while locked');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM sessions')[0]['n']);
        assertSame(5, (int) $bucket($db, LoginKeys::accountBucket($a['email']))['failures'], 'locked attempts are refused before verification, not counted');
    },
    'backoff: the next lock doubles; lock expiry lets the right password in and resets the account bucket' => static function () use ($setup, $login, $bucket, $unlock): void {
        [$db, $k] = $setup();
        $a = authFixture($db);
        for ($i = 1; $i <= 5; $i++) {
            $login($k, $a['email'], 'wrong-' . $i, '198.51.100.' . $i);
        }
        $unlock($db);
        for ($i = 6; $i <= 10; $i++) {
            assertSame(401, $login($k, $a['email'], 'wrong-' . $i, '198.51.100.' . $i)->status, 'failure ' . $i);
        }
        $row = $bucket($db, LoginKeys::accountBucket($a['email']));
        assertSame(10, (int) $row['failures']);
        assertTrue((int) $row['remaining'] > 115 * 1000000 && (int) $row['remaining'] <= 120 * 1000000, 'second lock is 2 minutes');
        $r = $login($k, $a['email'], (string) $a['password'], '198.51.100.50');
        assertTrue((int) $r->headers['Retry-After'] > 60, 'Retry-After reflects the longer lock');
        $unlock($db);
        assertSame(200, $login($k, $a['email'], (string) $a['password'], '198.51.100.51')->status, 'after expiry the right password works');
        assertSame(null, $bucket($db, LoginKeys::accountBucket($a['email'])), 'success resets the account bucket');
    },
    'the window: failures older than 15 minutes no longer count' => static function () use ($setup, $login, $bucket): void {
        [$db, $k] = $setup();
        $a = authFixture($db);
        for ($i = 1; $i <= 4; $i++) {
            $login($k, $a['email'], 'wrong-' . $i, '198.51.100.' . $i);
        }
        $db->execute('UPDATE auth_rate_limits SET window_started_at = UTC_TIMESTAMP(6) - INTERVAL 16 MINUTE WHERE bucket = ?', [LoginKeys::accountBucket($a['email'])]);
        assertSame(401, $login($k, $a['email'], 'wrong-5', '198.51.100.5')->status);
        assertSame(1, (int) $bucket($db, LoginKeys::accountBucket($a['email']))['failures'], 'new window');
        assertSame(200, $login($k, $a['email'], (string) $a['password'], '198.51.100.6')->status, 'not locked');
    },
    'success resets the account bucket only, never the IP bucket' => static function () use ($setup, $login, $bucket): void {
        [$db, $k] = $setup();
        $a = authFixture($db);
        for ($i = 1; $i <= 3; $i++) {
            $login($k, $a['email'], 'wrong-' . $i);
        }
        assertSame(200, $login($k, $a['email'], (string) $a['password'])->status);
        assertSame(null, $bucket($db, LoginKeys::accountBucket($a['email'])));
        assertSame(3, (int) $bucket($db, LoginKeys::ipBucket('203.0.113.7'))['failures'], 'IP failures stay');
        assertSame(200, $login($k, $a['email'], (string) $a['password'], '192.0.2.200')->status);
        assertSame(0, (int) $bucket($db, LoginKeys::ipBucket('192.0.2.200'))['failures'], 'the IP row is created before the transaction (ensure), with no failure');
    },
    'unknown and invalid addresses are counted and locked exactly like real accounts' => static function () use ($setup, $login, $public): void {
        [$db, $k] = $setup();
        $a = authFixture($db);
        $unknown = 'ghost-' . bin2hex(random_bytes(4)) . '@example.test';
        for ($i = 1; $i <= 5; $i++) {
            $login($k, $a['email'], 'wrong-' . $i, '198.51.100.' . $i);
            $login($k, $unknown, 'wrong-' . $i, '198.51.100.' . (10 + $i));
            $login($k, 'Not An Email', 'wrong-' . $i, '198.51.100.' . (20 + $i));
        }
        $known = $login($k, $a['email'], 'wrong-x', '198.51.100.40');
        $ghost = $login($k, $unknown, 'wrong-x', '198.51.100.41');
        $invalid = $login($k, 'not an email', 'wrong-x', '198.51.100.42');
        assertSame([429, false], [$known->status, isset($known->headers['Set-Cookie'])]);
        assertSame($public($known), $public($ghost), 'unknown account indistinguishable');
        assertSame($public($known), $public($invalid), 'invalid address indistinguishable');
        assertTrue(isset($ghost->headers['Retry-After'], $invalid->headers['Retry-After']), 'Retry-After for all');
        assertSame(3, (int) $db->select('SELECT COUNT(*) AS n FROM auth_rate_limits WHERE failures = 5')[0]['n'], 'three account buckets, five failures each');
    },
    'IP: 20 failures across accounts lock that address (/64 for IPv6), not others' => static function () use ($setup, $login, $bucket): void {
        [$db, $k] = $setup();
        $a = authFixture($db);
        for ($i = 1; $i <= 20; $i++) {
            assertSame(401, $login($k, 'spray-' . $i . '@example.test', 'wrong', '192.0.2.10')->status, 'spray ' . $i);
        }
        $row = $bucket($db, LoginKeys::ipBucket('192.0.2.10'));
        assertTrue($row !== null && (int) $row['failures'] === 20 && (int) $row['remaining'] > 0, 'IP bucket locked');
        $r = $login($k, $a['email'], (string) $a['password'], '192.0.2.10');
        assertSame(429, $r->status, 'even a valid account from that address');
        assertSame(200, $login($k, $a['email'], (string) $a['password'], '192.0.2.11')->status, 'another address is unaffected');
        for ($i = 1; $i <= 20; $i++) {
            $login($k, 'v6-' . $i . '@example.test', 'wrong', '2001:db8:1:2::' . dechex($i));
        }
        assertSame(429, $login($k, $a['email'], (string) $a['password'], '2001:db8:1:2:ffff::1')->status, 'same /64 shares the lock');
    },
    'only REMOTE_ADDR identifies the client: forwarding headers are ignored' => static function () use ($setup, $bucket): void {
        [$db, $k] = $setup();
        $saved = $_SERVER;
        $addresses = [];
        try {
            for ($i = 1; $i <= 3; $i++) {
                $_SERVER = [
                    'REQUEST_METHOD' => 'GET', 'REQUEST_URI' => '/api/auth/me', 'REMOTE_ADDR' => '192.0.2.77',
                    'HTTP_X_FORWARDED_FOR' => '10.9.9.' . $i, 'HTTP_FORWARDED' => 'for=10.8.8.' . $i,
                    'HTTP_CF_CONNECTING_IP' => '10.7.7.' . $i, 'HTTP_X_REAL_IP' => '10.6.6.' . $i,
                ];
                $addresses[] = Request::fromGlobals(65536)->remoteAddr;
            }
        } finally {
            $_SERVER = $saved;
        }
        assertSame(['192.0.2.77', '192.0.2.77', '192.0.2.77'], $addresses);
        foreach ($addresses as $i => $ip) {
            $k->handle(loginRequest('x' . $i . '@example.test', 'wrong', ['remoteAddr' => $ip]), requestId());
        }
        assertSame(3, (int) $bucket($db, LoginKeys::ipBucket('192.0.2.77'))['failures'], 'one bucket for the connection address');
        foreach (['10.9.9.1', '10.8.8.1', '10.7.7.1', '10.6.6.1'] as $spoofed) {
            assertSame(null, $bucket($db, LoginKeys::ipBucket($spoofed)), 'no bucket for ' . $spoofed);
        }
    },
    'throttling state is persistent: a new connection sees the same lock' => static function () use ($setup, $login): void {
        [$db, $k] = $setup();
        $a = authFixture($db);
        for ($i = 1; $i <= 5; $i++) {
            $login($k, $a['email'], 'wrong-' . $i, '198.51.100.' . $i);
        }
        $fresh = authKernel(testDbConfig(), AuthData::fromConfig(testDbConfig()), productionMigrationsDir());
        assertSame(429, $fresh->handle(loginRequest($a['email'], (string) $a['password'], ['remoteAddr' => '198.51.100.60']), requestId())->status);
    },
];
