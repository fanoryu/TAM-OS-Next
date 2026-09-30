<?php
declare(strict_types=1);

namespace TamOs\Auth;

use TamOs\Identity\Principal;

/**
 * The outcome of one password change, returned only after its transaction has committed.
 * Success carries the caller's fresh session (every earlier session is revoked); Conflict
 * means the password changed concurrently and nothing was written.
 */
final class PasswordChangeResult
{
    public const SUCCESS = 'success';
    public const INVALID_NEW = 'invalid_new';
    public const WRONG_CURRENT = 'wrong_current';
    public const LOCKED = 'locked';
    public const CONFLICT = 'conflict';
    public const UNAUTHENTICATED = 'unauthenticated';

    private function __construct(
        public readonly string $outcome,
        public readonly ?Principal $principal = null,
        #[\SensitiveParameter] public readonly ?string $sessionToken = null,
        #[\SensitiveParameter] public readonly ?string $csrfToken = null,
        public readonly int $retryAfter = 0,
    ) {
    }

    public static function success(Principal $principal, #[\SensitiveParameter] string $sessionToken, #[\SensitiveParameter] string $csrfToken): self
    {
        return new self(self::SUCCESS, $principal, $sessionToken, $csrfToken);
    }

    public static function failure(string $outcome): self
    {
        if (!in_array($outcome, [self::INVALID_NEW, self::WRONG_CURRENT, self::CONFLICT, self::UNAUTHENTICATED], true)) {
            throw new \LogicException('unknown password change outcome');
        }
        return new self($outcome);
    }

    public static function locked(int $retryAfter): self
    {
        return new self(self::LOCKED, retryAfter: $retryAfter);
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return ['outcome' => $this->outcome, 'principal' => $this->principal, 'retryAfter' => $this->retryAfter];
    }
}
