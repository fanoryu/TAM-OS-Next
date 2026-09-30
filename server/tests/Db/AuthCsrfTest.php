<?php
declare(strict_types=1);

/*
 * CSRF and origin protection on the real session path (SessionPrincipalResolver + MariaDB):
 * the synchronizer token is per session, compared in the kernel, and required for any
 * mutation made with a live session; GET is unaffected; login relies on Origin/Referer.
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
use function TamOs\Tests\assertApiHeaders;
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

/** @return array{0: Database, 1: Kernel, 2: string, 3: string, 4: string, 5: string} db, kernel, tokenA, csrfA, tokenB, csrfB */
$two = static function (): array {
    $db = authDatabase();
    $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
    $out = [$db, $k];
    foreach ([authFixture($db), authFixture($db)] as $a) {
        $r = $k->handle(loginRequest($a['email'], (string) $a['password']), requestId());
        $out[] = (string) sessionCookieToken($r);
        $out[] = (string) envelope($r)['data']['csrfToken'];
    }
    return $out;
};
$alive = static fn (Kernel $k, string $token): bool => $k->handle(sessionRequest('GET', '/api/auth/me', $token), requestId())->status === 200;
$logout = static fn (Kernel $k, string $token, ?string $csrf, array $o = []) => $k->handle(sessionRequest('POST', '/api/auth/logout', $token, $csrf, '{}', $o), requestId());

return [
    'each session has its own CSRF token, stored with the session and returned by me' => static function () use ($two): void {
        [$db, $k, $ta, $ca, $tb, $cb] = $two();
        assertTrue($ca !== $cb && $ca !== $ta, 'distinct per session and from the session token');
        assertSame($ca, $db->select('SELECT csrf_token FROM sessions WHERE token_hash = ?', [hash('sha256', $ta)])[0]['csrf_token']);
        assertSame($ca, envelope($k->handle(sessionRequest('GET', '/api/auth/me', $ta), requestId()))['data']['csrfToken'], 'available again after a reload');
    },
    'a valid CSRF token logs out: 200, cookie cleared, session revoked' => static function () use ($two, $alive, $logout): void {
        [$db, $k, $ta, $ca, $tb] = $two();
        $r = $logout($k, $ta, $ca);
        assertSame([200, ['loggedOut' => true]], [$r->status, envelope($r)['data']]);
        assertApiHeaders($r, requestId(), true);
        assertSame('__Host-tamos_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT', $r->headers['Set-Cookie']);
        assertSame([false, true], [$alive($k, $ta), $alive($k, $tb)]);
        $again = $logout($k, $ta, $ca);
        assertSame([200, ['loggedOut' => true]], [$again->status, envelope($again)['data']], 'idempotent once the session is gone');
    },
    'missing, wrong and another session\'s CSRF token are refused and the session survives' => static function () use ($two, $alive, $logout): void {
        [$db, $k, $ta, $ca, $tb, $cb] = $two();
        foreach (['missing' => null, 'wrong' => str_repeat('w', 43), 'another session' => $cb, 'the session token itself' => $ta] as $label => $csrf) {
            $r = $logout($k, $ta, $csrf);
            assertSame([403, 'forbidden'], [$r->status, envelope($r)['error']['code']], $label);
            assertTrue(!isset($r->headers['Set-Cookie']), $label . ': no cookie change');
            assertTrue($alive($k, $ta), $label . ': still logged in');
        }
    },
    'origin: mismatch refused, Referer fallback accepted, both absent refused' => static function () use ($two, $alive, $logout): void {
        [$db, $k, $ta, $ca, $tb, $cb] = $two();
        assertSame(403, $logout($k, $ta, $ca, ['origin' => 'https://evil.test'])->status, 'cross-origin with a valid token');
        assertSame(403, $logout($k, $ta, $ca, ['origin' => null, 'referer' => 'https://evil.test/x'])->status, 'cross-origin referer');
        assertSame(403, $logout($k, $ta, $ca, ['origin' => null, 'referer' => null])->status, 'both absent');
        assertTrue($alive($k, $ta), 'none of those logged out');
        assertSame(200, $logout($k, $ta, $ca, ['origin' => null, 'referer' => 'https://tamos.test/app/settings'])->status, 'same-origin Referer fallback');
        assertTrue(!$alive($k, $ta), 'logged out');
        assertTrue($alive($k, $tb), 'other session untouched');
    },
    'GET needs no CSRF token; login needs none either but still needs the origin' => static function () use ($two): void {
        [$db, $k, $ta] = $two();
        assertSame(200, $k->handle(sessionRequest('GET', '/api/auth/me', $ta), requestId())->status);
        $a = authFixture($db);
        assertSame(200, $k->handle(loginRequest($a['email'], (string) $a['password']), requestId())->status, 'login without X-CSRF-Token');
        assertSame(403, $k->handle(loginRequest($a['email'], (string) $a['password'], ['origin' => 'https://evil.test']), requestId())->status, 'login CSRF: cross-origin refused');
        assertSame(403, $k->handle(loginRequest($a['email'], (string) $a['password'], ['origin' => null]), requestId())->status, 'login with no Origin or Referer refused');
    },
];
