<?php
declare(strict_types=1);

namespace TamOs\Data\Migration;

/**
 * A migration-state failure with a fixed, value-free reason. The optional version is a
 * number only; no SQL, file contents, driver message or credential is ever carried.
 */
final class MigrationError extends \RuntimeException
{
    public const MIGRATIONS_INVALID = 'migrations_invalid';
    public const HISTORY_MISSING = 'history_missing';
    public const HISTORY_INVALID = 'history_invalid';
    public const SCHEMA_INCOMPLETE = 'schema_incomplete';
    public const SCHEMA_DRIFT = 'schema_drift';
    public const SCHEMA_PENDING = 'schema_pending';
    public const MIGRATION_BUSY = 'migration_busy';

    private const REASONS = [
        self::MIGRATIONS_INVALID, self::HISTORY_MISSING, self::HISTORY_INVALID, self::SCHEMA_INCOMPLETE,
        self::SCHEMA_DRIFT, self::SCHEMA_PENDING, self::MIGRATION_BUSY,
    ];

    public function __construct(public readonly string $reason, public readonly ?int $version = null)
    {
        if (!in_array($reason, self::REASONS, true)) {
            throw new \LogicException('unknown migration error reason');
        }
        parent::__construct('migration ' . $reason . ($version !== null ? ' at version ' . $version : ''));
    }
}
