<?php
declare(strict_types=1);

namespace TamOs\Auth;

use TamOs\Identity\Principal;

/**
 * The outcome of one login attempt, returned only after its transaction has committed. The
 * controller turns Failed into 401 and Locked into 429 — never inside the transaction, which
 * would roll back the security event and the rate-limit update with it.
 */
final class LoginResult
{
    public const SUCCESS = 'success';
    public const FAILED = 'failed';
    public const LOCKED = 'locked';

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

    public static function failed(): self
    {
        return new self(self::FAILED);
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
