<?php
declare(strict_types=1);

namespace TamOs\Data;

use TamOs\Config\Config;
use TamOs\Data\Migration\MigrationError;
use TamOs\Data\Migration\Migrator;

/**
 * Whether this instance can serve database-backed requests: the db section is valid, the
 * database answers, and the schema is exactly current. Read-only — it takes no lock and
 * never creates, alters or writes anything; before the first `migrate.php apply` it
 * reports history_missing.
 *
 * Nothing connects until check() runs, so /api/health is never affected. The reasons are
 * fixed internal codes for the server log; clients only ever see service_unavailable.
 */
final class Readiness
{
    public const DB_UNCONFIGURED = 'db_unconfigured';
    public const DB_UNAVAILABLE = 'db_unavailable';

    public function __construct(private readonly Config $config, private readonly string $migrationsDir)
    {
    }

    /**
     * @return string|null null when ready, otherwise the reason: db_unconfigured,
     *                     db_unavailable, or a MigrationError reason (history_missing,
     *                     history_invalid, migrations_invalid, schema_incomplete,
     *                     schema_drift, schema_pending)
     * @throws DatabaseError of kind failure — an unexpected database error is not "not ready"
     */
    public function check(): ?string
    {
        try {
            $pending = Migrator::fromConfig($this->config, $this->migrationsDir)->inspect();
            return $pending === [] ? null : MigrationError::SCHEMA_PENDING;
        } catch (MigrationError $e) {
            return $e->reason;
        } catch (DatabaseError $e) {
            if ($e->operation === 'config') {
                return self::DB_UNCONFIGURED;
            }
            if ($e->kind === DatabaseError::FAILURE) {
                throw $e;
            }
            return self::DB_UNAVAILABLE;
        }
    }
}
