<?php
declare(strict_types=1);

namespace TamOs\Config;

/**
 * Validated backend configuration. Constructed only by ConfigLoader.
 *
 * `db` is carried unvalidated: it is checked by TamOs\Data\DatabaseConfig only when the
 * database is first needed, so a missing or malformed section never affects /api/health.
 * `mail` likewise: TamOs\Mail\MailConfig checks it only when the outbox worker needs it.
 */
final class Config
{
    public const ENVIRONMENTS = ['production', 'development', 'test'];

    public function __construct(
        public readonly string $env,
        public readonly string $origin,
        public readonly string $logPath,
        public readonly int $bodyLimitBytes,
        #[\SensitiveParameter] public readonly mixed $db = null,
        #[\SensitiveParameter] public readonly mixed $mail = null,
    ) {
    }

    public function isProduction(): bool
    {
        return $this->env === 'production';
    }

    /**
     * The database and mail sections hold credentials; a dump shows only whether they are set.
     *
     * @return array<string, mixed>
     */
    public function __debugInfo(): array
    {
        return [
            'env' => $this->env,
            'origin' => $this->origin,
            'logPath' => $this->logPath,
            'bodyLimitBytes' => $this->bodyLimitBytes,
            'db' => $this->db === null ? null : '[REDACTED]',
            'mail' => $this->mail === null ? null : '[REDACTED]',
        ];
    }
}
