<?php
declare(strict_types=1);

namespace TamOs\Config;

/** Validated backend configuration. Constructed only by ConfigLoader. */
final class Config
{
    public const ENVIRONMENTS = ['production', 'development', 'test'];

    public function __construct(
        public readonly string $env,
        public readonly string $origin,
        public readonly string $logPath,
        public readonly int $bodyLimitBytes,
    ) {
    }

    public function isProduction(): bool
    {
        return $this->env === 'production';
    }
}
