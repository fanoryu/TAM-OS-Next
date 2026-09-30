<?php
declare(strict_types=1);

use TamOs\Http\CookieResult;
use TamOs\Http\SessionCookie;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$token = str_repeat('Ab_-', 10) . 'xyz';

return [
    'set: exactly the __Host- session cookie contract' => static function () use ($token): void {
        assertSame('__Host-tamos_session=' . $token . '; Path=/; Secure; HttpOnly; SameSite=Strict', SessionCookie::set($token));
    },
    'clear: same attributes, expired now' => static function (): void {
        assertSame('__Host-tamos_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT', SessionCookie::clear());
    },
    'neither carries Domain, and the live cookie is not persistent' => static function () use ($token): void {
        foreach ([SessionCookie::set($token), SessionCookie::clear()] as $h) {
            assertTrue(stripos($h, 'domain') === false, 'no Domain');
            foreach (['; Path=/', '; Secure', '; HttpOnly', '; SameSite=Strict'] as $attr) {
                assertTrue(str_contains($h, $attr), $attr);
            }
        }
        assertTrue(stripos(SessionCookie::set($token), 'max-age') === false && stripos(SessionCookie::set($token), 'expires') === false, 'session cookie');
    },
    'only a well-formed token can be set; a cookie result carries only the session cookie' => static function () use ($token): void {
        foreach (['', 'x', $token . ';Domain=evil.test', $token . "\r\nX: y"] as $bad) {
            assertThrows(LogicException::class, static fn () => SessionCookie::set($bad));
        }
        assertThrows(LogicException::class, static fn () => new CookieResult([], 'other=1; Path=/'));
        assertSame(['a' => 1], (new CookieResult(['a' => 1], SessionCookie::clear()))->data);
    },
];
