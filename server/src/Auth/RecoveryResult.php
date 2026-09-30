<?php
declare(strict_types=1);

namespace TamOs\Auth;

/**
 * The outcome of a recovery request or a password reset, returned only after any transaction
 * has committed, so a failure's rate-limit update and security event are never rolled back.
 *
 *   requested         the generic answer to every recovery request that passes the IP gate —
 *                     known, unknown, disabled, pending or over-quota address alike
 *   success           the password was reset
 *   invalid_token     every token or account problem alike (unknown, expired, used, revoked,
 *                     another purpose, account no longer recoverable)
 *   invalid_password  the new password breaks the rule; the token was not consumed
 *   locked            the client IP is throttled (independent of any account)
 */
final class RecoveryResult
{
    public const REQUESTED = 'requested';
    public const SUCCESS = 'success';
    public const INVALID_TOKEN = 'invalid_token';
    public const INVALID_PASSWORD = 'invalid_password';
    public const LOCKED = 'locked';

    private function __construct(public readonly string $outcome, public readonly int $retryAfter = 0)
    {
    }

    public static function requested(): self
    {
        return new self(self::REQUESTED);
    }

    public static function success(): self
    {
        return new self(self::SUCCESS);
    }

    public static function invalidToken(): self
    {
        return new self(self::INVALID_TOKEN);
    }

    public static function invalidPassword(): self
    {
        return new self(self::INVALID_PASSWORD);
    }

    public static function locked(int $retryAfter): self
    {
        return new self(self::LOCKED, $retryAfter);
    }
}
