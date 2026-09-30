<?php
declare(strict_types=1);

namespace TamOs\Auth;

/**
 * The outcome of one activation attempt, returned only after any transaction has committed,
 * so a failure's rate-limit update and security event are never rolled back by the 400/429.
 * InvalidToken covers every token or account problem alike (unknown, expired, used, revoked,
 * disabled, already activated); InvalidPassword means the token was not consumed.
 */
final class ActivationResult
{
    public const SUCCESS = 'success';
    public const INVALID_TOKEN = 'invalid_token';
    public const INVALID_PASSWORD = 'invalid_password';
    public const LOCKED = 'locked';

    private function __construct(public readonly string $outcome, public readonly int $retryAfter = 0)
    {
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
