<?php
declare(strict_types=1);

namespace TamOs\Config;

/**
 * A configuration file that is missing, unreadable or invalid. The reason is a fixed,
 * value-free code so it can be logged without leaking configuration contents.
 */
final class ConfigError extends \RuntimeException
{
    public function __construct(public readonly string $reason)
    {
        parent::__construct('configuration rejected: ' . $reason);
    }
}
