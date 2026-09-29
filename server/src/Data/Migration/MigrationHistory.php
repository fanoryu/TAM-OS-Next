<?php
declare(strict_types=1);

namespace TamOs\Data\Migration;

use TamOs\Data\Database;
use TamOs\Data\DatabaseError;

/**
 * The only owner of migration-metadata SQL: the `schema_migrations` table and the
 * `tamos_migrate` advisory lock. Every statement is a fixed literal with bound parameters.
 *
 * The table is infrastructure, created by the runner (never a numbered migration, never by
 * readiness), and its structure is verified field by field before it is trusted.
 * Statements run in autocommit — never inside Database::transaction() — so the `started`
 * marker is committed before the migration's DDL runs.
 */
final class MigrationHistory
{
    // One literal per statement: the boundary check rejects SQL assembled by concatenation.
    private const CREATE = 'CREATE TABLE IF NOT EXISTS schema_migrations (version SMALLINT UNSIGNED NOT NULL PRIMARY KEY, name VARCHAR(64) CHARACTER SET ascii NOT NULL, sha256 CHAR(64) CHARACTER SET ascii NOT NULL, started_at DATETIME(6) NOT NULL, applied_at DATETIME(6) NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    private const COLUMNS_QUERY = "SELECT COLUMN_NAME AS name, DATA_TYPE AS type, COLUMN_TYPE AS full_type, CHARACTER_MAXIMUM_LENGTH AS len, DATETIME_PRECISION AS prec, IS_NULLABLE AS nullable, CHARACTER_SET_NAME AS charset, COLUMN_KEY AS col_key FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations' ORDER BY ORDINAL_POSITION";

    /** name => [data type, unsigned, max length, datetime precision, nullable, charset, key] */
    private const COLUMNS = [
        'version' => ['smallint', true, null, null, false, null, 'PRI'],
        'name' => ['varchar', false, 64, null, false, 'ascii', ''],
        'sha256' => ['char', false, 64, null, false, 'ascii', ''],
        'started_at' => ['datetime', false, null, 6, false, null, ''],
        'applied_at' => ['datetime', false, null, 6, true, null, ''],
    ];

    public function __construct(private readonly Database $db)
    {
    }

    public function exists(): bool
    {
        $rows = $this->db->select("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'");
        return (int) ($rows[0]['n'] ?? 0) === 1;
    }

    public function create(): void
    {
        $this->db->execute(self::CREATE);
    }

    /** @throws MigrationError history_missing | history_invalid */
    public function verifyStructure(): void
    {
        $table = $this->db->select("SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'");
        if ($table === []) {
            throw new MigrationError(MigrationError::HISTORY_MISSING);
        }
        if (strcasecmp((string) $table[0]['engine'], 'InnoDB') !== 0) {
            throw new MigrationError(MigrationError::HISTORY_INVALID);
        }
        $columns = $this->db->select(self::COLUMNS_QUERY);
        $actual = [];
        foreach ($columns as $c) {
            $actual[strtolower((string) $c['name'])] = [
                strtolower((string) $c['type']),
                str_contains(strtolower((string) $c['full_type']), 'unsigned'),
                $c['len'] === null ? null : (int) $c['len'],
                $c['prec'] === null ? null : (int) $c['prec'],
                strtoupper((string) $c['nullable']) === 'YES',
                $c['charset'] === null ? null : strtolower((string) $c['charset']),
                strtoupper((string) $c['col_key']),
            ];
        }
        $expected = self::COLUMNS;
        // Only character columns carry a charset; for the others MariaDB reports NULL.
        foreach ($actual as $name => $spec) {
            if (isset($expected[$name]) && $expected[$name][5] === null) {
                $actual[$name][5] = null;
            }
        }
        if ($actual !== $expected) {
            throw new MigrationError(MigrationError::HISTORY_INVALID);
        }
        $primary = $this->db->select("SELECT COLUMN_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations' AND INDEX_NAME = 'PRIMARY'");
        if (array_map(static fn (array $r): string => strtolower((string) $r['name']), $primary) !== ['version']) {
            throw new MigrationError(MigrationError::HISTORY_INVALID);
        }
    }

    /** @return list<array{version: int, name: string, sha256: string, applied: bool}> ordered by version */
    public function rows(): array
    {
        $rows = $this->db->select('SELECT version, name, sha256, applied_at FROM schema_migrations ORDER BY version');
        return array_map(static fn (array $r): array => [
            'version' => (int) $r['version'],
            'name' => (string) $r['name'],
            'sha256' => (string) $r['sha256'],
            'applied' => $r['applied_at'] !== null,
        ], $rows);
    }

    /** Commits the `started` marker (applied_at NULL) before the migration runs. */
    public function recordStarted(Migration $migration): void
    {
        $this->db->execute(
            'INSERT INTO schema_migrations (version, name, sha256, started_at, applied_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6), NULL)',
            [$migration->version, $migration->name, $migration->sha256],
        );
    }

    /** @throws MigrationError schema_incomplete unless exactly the started row was completed */
    public function recordApplied(Migration $migration): void
    {
        $changed = $this->db->execute(
            'UPDATE schema_migrations SET applied_at = UTC_TIMESTAMP(6) WHERE version = ? AND applied_at IS NULL',
            [$migration->version],
        );
        if ($changed !== 1) {
            throw new MigrationError(MigrationError::SCHEMA_INCOMPLETE, $migration->version);
        }
    }

    /**
     * Takes the advisory lock on this connection without waiting. Only 1 means acquired.
     *
     * @throws MigrationError migration_busy when another session holds it
     * @throws DatabaseError on NULL (lock error) or a database failure
     */
    public function acquireLock(): void
    {
        $result = $this->db->select("SELECT GET_LOCK('tamos_migrate', 0) AS acquired")[0]['acquired'] ?? null;
        if ($result === null) {
            throw new DatabaseError(DatabaseError::FAILURE, 'lock');
        }
        if ((int) $result !== 1) {
            throw new MigrationError(MigrationError::MIGRATION_BUSY);
        }
    }

    /** Best effort: closing the connection releases the lock as well. */
    public function releaseLock(): void
    {
        try {
            $this->db->select("SELECT RELEASE_LOCK('tamos_migrate') AS released");
        } catch (DatabaseError) {
            // The lock dies with the (non-persistent) connection.
        }
    }
}
