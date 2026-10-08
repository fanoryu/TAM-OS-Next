<?php
declare(strict_types=1);

namespace TamOs\Ops;

use TamOs\Data\Backup\BackupReader;

/**
 * Creates one encrypted backup (OPS-1 `create`): locks, checks the migration history, reads every
 * backed-up table from one read-only snapshot, writes the encrypted payload to a temporary file,
 * re-reads it, publishes it atomically, then applies host retention.
 *
 * Before any row is read the snapshot's tables are classified: every table must be backed up,
 * excluded or the migration history (else unclassified_table), InnoDB, keyed by a single `id`
 * column with an integer or binary-collated type, and present exactly when an applied migration
 * created it (else unexpected_schema). Each table's streamed rows must equal its COUNT(*) in the
 * same snapshot (else snapshot_inconsistent). Any failure discards the run's own temporary files
 * and leaves every earlier backup untouched.
 *
 * $afterTable is a test seam (null in production): it runs after each table is copied, inside the
 * snapshot, so the database tests can commit concurrent writes or fail a run part-way.
 */
final class BackupCreator
{
    public function __construct(
        private readonly BackupReader $reader,
        private readonly BackupStore $store,
        private readonly string $publicKey,
        private readonly string $env,
        private readonly string $migrationsDir,
        private readonly ?\Closure $afterTable = null,
    ) {
    }

    /**
     * @return array{backupId: string, bytes: int, tables: int, rows: int, databaseHead: int, codeHead: int, pruned: int}
     * @throws BackupError
     * @throws \TamOs\Data\Migration\MigrationError
     * @throws \TamOs\Data\DatabaseError
     */
    public function create(): array
    {
        BackupCipher::requireAvailable();
        $this->reader->lock();
        try {
            $history = $this->reader->history($this->migrationsDir);
            $this->store->removeStaleTemporaries();
            $written = $this->write($history);
            $pruned = $this->store->prune($written['backupId']);
            return $written + ['pruned' => $pruned];
        } finally {
            $this->reader->unlock();
        }
    }

    /**
     * @param array{applied: list<array{version: int, name: string, sha256: string}>, codeHead: int, createdTables: list<string>} $history
     * @return array{backupId: string, bytes: int, tables: int, rows: int, databaseHead: int, codeHead: int}
     */
    private function write(array $history): array
    {
        $id = null;
        $handle = null;
        try {
            return $this->reader->snapshot(function () use ($history, &$id, &$handle): array {
                $snapshotAt = $this->reader->now();
                $schema = $this->reader->schema();
                $plan = self::plan($schema, $history['createdTables']);
                $id = BackupStore::newId($snapshotAt);
                [$handle, $tempPath] = $this->store->createTemporary($id);
                $cipher = BackupCipher::seal($handle, $id, $this->publicKey);
                $format = new BackupFormat(static function (string $line) use ($cipher): void {
                    $cipher->write($line);
                });
                $format->begin($id);
                $rows = 0;
                foreach ($plan['present'] as $table => $definition) {
                    $rows += self::copyTable($this->reader, $format, $table, $definition);
                    if ($this->afterTable !== null) {
                        ($this->afterTable)($table);
                    }
                }
                $format->finish([
                    'backupId' => $id,
                    'snapshotAt' => $snapshotAt,
                    'keyFingerprint' => BackupCipher::fingerprint($this->publicKey),
                    'source' => ['env' => $this->env, 'databaseFingerprint' => $this->reader->sourceFingerprint()],
                    'schema' => ['databaseHead' => count($history['applied']), 'codeHead' => $history['codeHead'], 'migrations' => $history['applied']],
                    'excludedTables' => BackupTables::EXCLUDED,
                    'absentTables' => $plan['absent'],
                ]);
                $sealed = $cipher->finish();
                $this->store->finalize($handle, $tempPath, $id, $sealed['sha256']);
                $handle = null;
                return ['backupId' => $id, 'bytes' => $sealed['bytes'], 'tables' => count($plan['present']), 'rows' => $rows,
                    'databaseHead' => count($history['applied']), 'codeHead' => $history['codeHead']];
            });
        } catch (\Throwable $e) {
            if (is_resource($handle)) {
                @fclose($handle);
            }
            if ($id !== null) {
                $this->store->discard($id);
            }
            if ($e instanceof BackupError || $e instanceof \TamOs\Data\DatabaseError || $e instanceof \TamOs\Data\Migration\MigrationError || $e instanceof \LogicException) {
                throw $e;
            }
            throw new BackupError(BackupError::WRITE_FAILED);   // a filesystem warning (for example a full disk)
        }
    }

    /**
     * Classifies the snapshot's tables against the backup table lists and the applied migrations.
     *
     * @param array<string, array{type: string, engine: ?string, columns: list<array<string, mixed>>, primary: list<string>}> $schema
     * @param list<string> $createdTables tables created by the applied migrations
     * @return array{present: array<string, array<string, mixed>>, absent: list<string>}
     * @throws BackupError unclassified_table | unexpected_schema
     */
    public static function plan(array $schema, array $createdTables): array
    {
        foreach ($schema as $name => $table) {
            if (!in_array($name, BackupTables::INCLUDED, true) && !in_array($name, BackupTables::EXCLUDED, true) && $name !== BackupTables::HISTORY) {
                throw new BackupError(BackupError::UNCLASSIFIED_TABLE);
            }
            if ($table['type'] !== 'BASE TABLE' || $table['engine'] !== 'InnoDB') {
                throw new BackupError(BackupError::UNEXPECTED_SCHEMA);
            }
        }
        $present = [];
        $absent = [];
        foreach (BackupReader::tables() as $name) {
            $expected = in_array($name, $createdTables, true);
            if (!isset($schema[$name])) {
                if ($expected) {
                    throw new BackupError(BackupError::UNEXPECTED_SCHEMA);
                }
                $absent[] = $name;
                continue;
            }
            if (!$expected) {
                throw new BackupError(BackupError::UNEXPECTED_SCHEMA);
            }
            $columns = $schema[$name]['columns'];
            $id = $columns[0] ?? null;
            $intId = $id !== null && in_array($id['dataType'], ['tinyint', 'smallint', 'mediumint', 'int', 'bigint'], true);
            $binaryId = $id !== null && in_array($id['dataType'], ['char', 'varchar'], true) && in_array($id['collation'], ['ascii_bin', 'binary', 'utf8mb4_bin'], true);
            if ($id === null || $schema[$name]['primary'] !== ['id'] || $id['name'] !== 'id' || !($intId || $binaryId)) {
                throw new BackupError(BackupError::UNEXPECTED_SCHEMA);
            }
            $decimals = [];
            $definitions = [];
            foreach ($columns as $column) {
                if (in_array($column['dataType'], ['float', 'double', 'real', 'blob', 'tinyblob', 'mediumblob', 'longblob', 'binary', 'varbinary', 'bit', 'json', 'geometry'], true)) {
                    throw new BackupError(BackupError::UNSUPPORTED_VALUE);
                }
                if ($column['dataType'] === 'decimal') {
                    $decimals[$column['name']] = (int) $column['scale'];
                }
                $definitions[] = [$column['name'], $column['columnType'], $column['nullable']];
            }
            $present[$name] = [
                'columns' => array_column($columns, 'name'),
                'decimals' => $decimals,
                'columnsSha256' => BackupFormat::columnsSha256($definitions),
                'after' => $intId ? 0 : '',
            ];
        }
        return ['present' => $present, 'absent' => $absent];
    }

    /**
     * Streams one table through $format in primary-key pages and checks the rows against the
     * table's COUNT(*) in the same transaction. Shared by create and by OPS-2's restore
     * verification, so a restored table is measured by exactly the encoding that backed it up.
     *
     * @param array<string, mixed> $definition a plan() entry
     * @throws BackupError snapshot_inconsistent | unsupported_value | unexpected_schema
     */
    public static function copyTable(BackupReader $reader, BackupFormat $format, string $table, array $definition): int
    {
        $format->beginTable($table, $definition['columns'], $definition['decimals'], $definition['columnsSha256']);
        $after = $definition['after'];
        do {
            $page = $reader->page($table, $after);
            foreach ($page as $row) {
                $format->row($row);
                $after = $row['id'];
            }
        } while (count($page) === BackupReader::PAGE);
        $rows = $format->endTable();
        if ($rows !== $reader->count($table)) {
            throw new BackupError(BackupError::SNAPSHOT_INCONSISTENT);
        }
        return $rows;
    }
}
