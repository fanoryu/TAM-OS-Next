<?php
declare(strict_types=1);

namespace TamOs\Auth;

/**
 * A freshly issued activation token, returned only after its transaction has committed. The
 * raw token exists nowhere else — the database holds its SHA-256 — and the CLI prints it once.
 */
final class IssuedActivation
{
    public function __construct(
        public readonly string $userId,
        #[\SensitiveParameter] public readonly string $token,
        public readonly string $expiresAt,
    ) {
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return ['userId' => $this->userId, 'token' => '[REDACTED]', 'expiresAt' => $this->expiresAt];
    }
}
