<?php
declare(strict_types=1);

namespace TamOs\Identity;

/**
 * An authenticated session as the request pipeline sees it: the authoritative principal and
 * the session's CSRF token (compared by the kernel, returned by /api/auth/me). It carries no
 * session token and no token hash — logout re-derives the hash from the request's own cookie.
 */
final class AuthSession
{
    public function __construct(
        public readonly Principal $principal,
        #[\SensitiveParameter] public readonly string $csrfToken,
    ) {
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return ['principal' => $this->principal, 'csrfToken' => '[REDACTED]'];
    }
}
