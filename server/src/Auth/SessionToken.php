<?php
declare(strict_types=1);

namespace TamOs\Auth;

/**
 * Opaque session and CSRF tokens: 32 bytes from random_bytes(), base64url without padding,
 * always 43 characters. The database stores only the SHA-256 of a session token; the raw
 * token exists only in the HttpOnly cookie. Neither token is ever logged.
 */
final class SessionToken
{
    public const PATTERN = '/^[A-Za-z0-9_-]{43}$/';

    /** A fresh session token. Never derived from, or equal to, anything a client sent. */
    public static function generate(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    /** A fresh per-session CSRF token, same shape as a session token. */
    public static function generateCsrf(): string
    {
        return self::generate();
    }

    public static function isWellFormed(?string $token): bool
    {
        return $token !== null && preg_match(self::PATTERN, $token) === 1;
    }

    /** The at-rest identifier of a session: lower-case hex SHA-256 of the raw token. */
    public static function hash(#[\SensitiveParameter] string $token): string
    {
        return hash('sha256', $token);
    }
}
