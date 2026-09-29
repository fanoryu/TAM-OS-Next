<?php
declare(strict_types=1);

namespace TamOs\Data\Migration;

use TamOs\Config\Config;
use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;

/**
 * Compares the repository's migrations with the database's history and, for `apply` only,
 * brings the schema forward.
 *
 *   inspect()  read-only: no lock, never creates anything          (readiness)
 *   status()   lock → inspect → release                             (CLI `status`)
 *   apply()    lock → create/verify history → inspect → run pending (CLI `apply`)
 *
 * Each pending migration: commit a `started` row (applied_at NULL), run its single
 * statement, then mark exactly that row applied. There is no surrounding transaction —
 * DDL commits implicitly — so any failure after the marker leaves an incomplete row, and
 * every later apply, status and readiness check refuses until a person reconciles it.
 * Nothing is deleted, replayed or guessed.
 */
final class Migrator
{
    private readonly MigrationHistory $history;

    public function __construct(private readonly Database $db, private readonly string $migrationsDir)
    {
        $this->history = new MigrationHistory($db);
    }

    /** @throws \TamOs\Data\DatabaseError when the db section is missing or invalid */
    public static function fromConfig(Config $config, string $migrationsDir): self
    {
        return new self(new Database(DatabaseConfig::fromConfig($config)), $migrationsDir);
    }

    /**
     * @return list<Migration> the pending migrations (empty = current)
     * @throws MigrationError migrations_invalid | history_missing | history_invalid | schema_incomplete | schema_drift
     */
    public function inspect(): array
    {
        $set = MigrationSet::load($this->migrationsDir);
        if (!$this->history->exists()) {
            throw new MigrationError(MigrationError::HISTORY_MISSING);
        }
        $this->history->verifyStructure();
        return self::compare($set, $this->history->rows());
    }

    /** @return list<Migration> the pending migrations, read under the lock for a consistent view */
    public function status(): array
    {
        $this->history->acquireLock();
        try {
            return $this->inspect();
        } finally {
            $this->history->releaseLock();
        }
    }

    /** @return list<Migration> the migrations applied by this call (empty = already current) */
    public function apply(): array
    {
        $set = MigrationSet::load($this->migrationsDir);
        $this->history->acquireLock();
        try {
            if (!$this->history->exists()) {
                $this->history->create();
            }
            $this->history->verifyStructure();
            $pending = self::compare($set, $this->history->rows());
            foreach ($pending as $migration) {
                $this->history->recordStarted($migration);
                $this->db->execute($migration->sqlForExecution());
                $this->history->recordApplied($migration);
            }
            return $pending;
        } finally {
            $this->history->releaseLock();
        }
    }

    /**
     * History must be exactly versions 1..k, each complete and identical (name and SHA-256) to
     * the repository file with that version; repository files after k are pending.
     *
     * @param list<Migration> $set
     * @param list<array{version: int, name: string, sha256: string, applied: bool}> $rows ordered by version
     * @return list<Migration>
     * @throws MigrationError schema_incomplete | schema_drift
     */
    public static function compare(array $set, array $rows): array
    {
        foreach ($rows as $row) {
            if (!$row['applied']) {
                throw new MigrationError(MigrationError::SCHEMA_INCOMPLETE, $row['version']);
            }
        }
        foreach ($rows as $i => $row) {
            $file = $set[$i] ?? null;
            if ($row['version'] !== $i + 1 || $file === null || $file->version !== $row['version']
                || $file->name !== $row['name'] || !hash_equals($file->sha256, $row['sha256'])) {
                throw new MigrationError(MigrationError::SCHEMA_DRIFT, $row['version']);
            }
        }
        return array_slice($set, count($rows));
    }
}
