<?php
declare(strict_types=1);

namespace TamOs\Config;

/**
 * Validated backend configuration. Constructed only by ConfigLoader.
 *
 * `db` is carried unvalidated: it is checked by TamOs\Data\DatabaseConfig only when the
 * database is first needed, so a missing or malformed section never affects /api/health.
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
    ) {
    }

    public function isProduction(): bool
    {
        return $this->env === 'production';
    }
}
