<?php
declare(strict_types=1);

namespace TamOs\Http;

use TamOs\Auth\SessionToken;

/**
 * The session cookie contract (SDR-0002 §3.2), built in exactly one place. The `__Host-`
 * prefix requires Secure, Path=/ and no Domain. The live cookie has no Max-Age or Expires,
 * so it ends with the browser session; the server-side idle and absolute limits govern it.
 * PHP's setcookie() is never used, so the header stays inspectable in the Response.
 */
final class SessionCookie
{
    public const NAME = '__Host-tamos_session';
    private const ATTRIBUTES = '; Path=/; Secure; HttpOnly; SameSite=Strict';

    public static function set(#[\SensitiveParameter] string $token): string
    {
        if (!SessionToken::isWellFormed($token)) {
            throw new \LogicException('session cookie value must be a well-formed session token');
        }
        return self::NAME . '=' . $token . self::ATTRIBUTES;
    }

    public static function clear(): string
    {
        return self::NAME . '=' . self::ATTRIBUTES . '; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
    }

    /**
     * The session token from a raw Cookie header, or null. Pairs are split on `;` and trimmed
     * of spaces and tabs; the name must match exactly. The value is taken byte for byte — no
     * URL-decoding, no quote stripping — and must be a well-formed token. Two or more cookies
     * with this name are ambiguous (cookie tossing) and yield null.
     */
    public static function tokenFromHeader(?string $header): ?string
    {
        if ($header === null || $header === '' || strlen($header) > Request::MAX_COOKIE_HEADER) {
            return null;
        }
        $found = [];
        foreach (explode(';', $header) as $pair) {
            $pair = trim($pair, " \t");
            $eq = strpos($pair, '=');
            if ($eq !== false && substr($pair, 0, $eq) === self::NAME) {
                $found[] = substr($pair, $eq + 1);
            }
        }
        return count($found) === 1 && SessionToken::isWellFormed($found[0]) ? $found[0] : null;
    }
}
