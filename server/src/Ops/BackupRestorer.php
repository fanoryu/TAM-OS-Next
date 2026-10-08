<?php
declare(strict_types=1);

namespace TamOs\Ops;

use TamOs\Data\Backup\BackupReader;
use TamOs\Data\Backup\RestoreWriter;
use TamOs\Data\DatabaseError;
use TamOs\Data\Migration\MigrationSet;

/**
 * Restores one verified backup into an empty, already migrated database (OPS-2 `restore`), and
 * proves a target equals a backup (`verify-restore`). Operator tooling that runs off-host only
 * (D-AB-12, D-OPS2-1 = A): it needs the secret key, which never exists on the production host.
 *
 *   1. the whole backup is verified first (BackupVerifier::verify) — before the target is touched;
 *   2. its migration history must be exactly the code's migrations (no downgrade, no transformation);
 *   3. under the backup and migration locks, the target's history must be identical and current and
 *      its schema must classify like a backup's (BackupCreator::plan) with the backed-up columns,
 *      column definitions and generated columns; every classified table, excluded ones included,
 *      must be empty (restore runs no DDL and never truncates, overwrites or merges);
 *   4. a production target needs a production backup and the exact typed confirmation;
 *   5. one InnoDB transaction: the emptiness again, under locking reads; the backup replayed
 *      (verified again from its first byte) into RestoreWriter's fixed INSERTs; then every table
 *      re-read and re-encoded exactly as a backup encodes it, which must reproduce the manifest's
 *      columns, counts, maximum ids, row digests and DECIMAL totals, with the excluded tables empty
 *      and the history unchanged — only then is it committed; anything else rolls back;
 *   6. after commit, a new connection repeats that proof in a read-only snapshot and checks the
 *      auto-increment counters. A failure there, or a commit whose outcome is unknown, is
 *      restore_unproven: the target holds data that is not proven (server/bin/backup.php exit 3).
 *
 * $seam is a test seam (null in production): it runs at 'imported' and 'verified' inside the
 * transaction, with the transaction's connection, and at 'committed' after it.
 */
final class BackupRestorer
{
    /**
     * @param \Closure(): RestoreWriter $connect a new connection to the target on every call
     * @param (\Closure(array<string, string>): ?string)|null $confirm production only: shows the identity and returns the typed line
     * @param (\Closure(string, mixed): void)|null $seam
     */
    public function __construct(
        private readonly BackupVerifier $verifier,
        private readonly \Closure $connect,
        private readonly string $targetEnv,
        private readonly string $targetFingerprint,
        private readonly string $migrationsDir,
        private readonly ?\Closure $confirm = null,
        private readonly ?\Closure $seam = null,
    ) {
    }

    /** The line an operator types to restore into a production database. */
    public static function confirmationPhrase(string $backupId, string $targetFingerprint): string
    {
        return 'RESTORE ' . $backupId . ' INTO ' . substr($targetFingerprint, 0, 16);
    }

    /**
     * @return array<string, mixed> the evidence: ids, fingerprints, heads, per-table row counts and timings — no row value
     * @throws BackupError
     * @throws \TamOs\Data\Migration\MigrationError
     * @throws DatabaseError
     */
    public function restore(string $path, ?string $previousPath = null): array
    {
        $started = microtime(true);
        $manifest = $this->verifier->verify($path, $previousPath);
        $codeHead = self::requireCompatible($manifest, MigrationSet::load($this->migrationsDir));
        $writer = ($this->connect)();
        $reader = $writer->reader($this->targetFingerprint);
        $reader->lock();
        try {
            $target = $this->requireTarget($reader, $writer, $manifest);
            if (!$writer->isEmpty()) {
                throw new BackupError(BackupError::TARGET_NOT_EMPTY);
            }
            $this->requireConfirmation($manifest, $codeHead);
            try {
                $writer->transaction(function ($tx) use ($path, $manifest, $target, $reader, $writer): void {
                    if (!$writer->isEmpty()) {
                        throw new BackupError(BackupError::TARGET_NOT_EMPTY);
                    }
                    $columns = array_column($manifest['tables'], 'columns', 'name');
                    $this->verifier->replay($path, $manifest, static function (string $table, array $header) use ($columns): void {
                        if (($columns[$table] ?? null) !== $header) {
                            throw new BackupError(BackupError::MANIFEST_MISMATCH);
                        }
                    }, static function (string $table, array $row) use ($writer): void {
                        $writer->insert($table, $row);
                    });
                    $this->seam('imported', $tx);
                    $this->requireRestored($reader, $writer, $manifest, $target['plan']);
                    $this->seam('verified', $tx);
                });
            } catch (DatabaseError $e) {
                // The server may have committed before the connection failed: not provably rolled back.
                throw $e->operation === 'commit' ? new BackupError(BackupError::UNPROVEN) : $e;
            }
            try {
                $this->seam('committed', null);
                $this->prove($manifest);
            } catch (\Throwable) {
                throw new BackupError(BackupError::UNPROVEN);
            }
        } finally {
            $reader->unlock();
        }
        return $this->evidence($manifest, $target['head'], $codeHead, $started);
    }

    /**
     * verify-restore: proves, read-only, that the target holds exactly the backup.
     *
     * @return array<string, mixed> the evidence
     * @throws BackupError restore_mismatch | schema_mismatch | …
     */
    public function verifyTarget(string $path): array
    {
        $started = microtime(true);
        $manifest = $this->verifier->verify($path);
        $codeHead = self::requireCompatible($manifest, MigrationSet::load($this->migrationsDir));
        $head = $this->prove($manifest);
        return $this->evidence($manifest, $head, $codeHead, $started);
    }

    /**
     * The backup's applied migrations must be exactly the code's migrations, one by one.
     *
     * @param array<string, mixed> $manifest
     * @param list<\TamOs\Data\Migration\Migration> $set
     * @return int the code's migration head
     * @throws BackupError schema_mismatch
     */
    public static function requireCompatible(array $manifest, array $set): int
    {
        $code = array_map(static fn ($m): array => ['version' => $m->version, 'name' => $m->name, 'sha256' => $m->sha256], $set);
        if ($manifest['schema']['databaseHead'] !== count($set) || $manifest['schema']['migrations'] !== $code) {
            throw new BackupError(BackupError::SCHEMA_MISMATCH);
        }
        return count($set);
    }

    /**
     * The target's history and schema, which must be the backup's.
     *
     * @param array<string, mixed> $manifest
     * @return array{plan: array<string, mixed>, head: int}
     */
    private function requireTarget(BackupReader $reader, RestoreWriter $writer, array $manifest): array
    {
        $history = $reader->history($this->migrationsDir);
        if (count($history['applied']) !== $history['codeHead'] || $history['applied'] !== $manifest['schema']['migrations']) {
            throw new BackupError(BackupError::SCHEMA_MISMATCH);
        }
        $plan = BackupCreator::plan($reader->schema(), $history['createdTables']);
        if ($plan['absent'] !== $manifest['absentTables'] || array_keys($plan['present']) !== array_column($manifest['tables'], 'name')) {
            throw new BackupError(BackupError::SCHEMA_MISMATCH);
        }
        $generated = $writer->generatedColumns();
        foreach ($manifest['tables'] as $table) {
            $name = $table['name'];
            $definition = $plan['present'][$name];
            $own = $generated[$name] ?? [];
            if ($definition['columns'] !== $table['columns'] || $definition['columnsSha256'] !== $table['columnsSha256']
                || $own !== (RestoreWriter::GENERATED[$name] ?? []) || array_values(array_diff($definition['columns'], $own)) !== RestoreWriter::COLUMNS[$name]) {
                throw new BackupError(BackupError::SCHEMA_MISMATCH);
            }
        }
        return ['plan' => $plan, 'head' => count($history['applied'])];
    }

    /** @param array<string, mixed> $manifest */
    private function requireConfirmation(array $manifest, int $codeHead): void
    {
        if ($this->targetEnv !== 'production') {
            return;
        }
        if ($manifest['source']['env'] !== 'production') {
            throw new BackupError(BackupError::SOURCE_ENV_MISMATCH);
        }
        $phrase = self::confirmationPhrase($manifest['backupId'], $this->targetFingerprint);
        $typed = $this->confirm === null ? null : ($this->confirm)([
            'backup' => $manifest['backupId'],
            'key' => $manifest['keyFingerprint'],
            'source' => $manifest['source']['env'] . ' ' . substr($manifest['source']['databaseFingerprint'], 0, 16),
            'target' => $this->targetEnv . ' ' . substr($this->targetFingerprint, 0, 16),
            'schema' => 'backup head ' . $manifest['schema']['databaseHead'] . ', code head ' . $codeHead,
            'phrase' => $phrase,
        ]);
        if (!is_string($typed) || !hash_equals($phrase, $typed)) {
            throw new BackupError(BackupError::CONFIRMATION_REFUSED);
        }
    }

    /**
     * Re-reads every backed-up table through the backup's own encoding and requires the manifest's
     * claims, the excluded tables empty and the history unchanged.
     *
     * @param array<string, mixed> $manifest
     * @param array<string, mixed> $plan
     * @throws BackupError restore_mismatch
     */
    private function requireRestored(BackupReader $reader, RestoreWriter $writer, array $manifest, array $plan): void
    {
        $format = new BackupFormat(static function (string $line): void {
        });
        $format->begin($manifest['backupId']);
        foreach ($manifest['tables'] as $table) {
            BackupCreator::copyTable($reader, $format, $table['name'], $plan['present'][$table['name']]);
        }
        $measured = $format->finish(['backupId' => $manifest['backupId'], 'snapshotAt' => '', 'keyFingerprint' => '', 'source' => [], 'schema' => [],
            'excludedTables' => [], 'absentTables' => []])['tables'];
        foreach ($manifest['tables'] as $i => $claimed) {
            foreach (['name', 'columns', 'columnsSha256', 'rows', 'maxId', 'sha256'] as $key) {
                if ($measured[$i][$key] !== $claimed[$key]) {
                    throw new BackupError(BackupError::RESTORE_MISMATCH);
                }
            }
            if ((array) $measured[$i]['decimalTotals'] !== $claimed['decimalTotals']) {
                throw new BackupError(BackupError::RESTORE_MISMATCH);
            }
        }
        if (!$writer->excludedEmpty() || $reader->history($this->migrationsDir)['applied'] !== $manifest['schema']['migrations']) {
            throw new BackupError(BackupError::RESTORE_MISMATCH);
        }
    }

    /**
     * On a new connection: the target's schema, then its content in one read-only snapshot, then
     * the auto-increment counters past every restored id.
     *
     * @param array<string, mixed> $manifest
     * @return int the target's migration head
     */
    private function prove(array $manifest): int
    {
        $writer = ($this->connect)();
        $reader = $writer->reader($this->targetFingerprint);
        $target = $this->requireTarget($reader, $writer, $manifest);
        $writer->snapshot(function () use ($reader, $writer, $manifest, $target): void {
            $this->requireRestored($reader, $writer, $manifest, $target['plan']);
        });
        $next = $writer->autoIncrements();
        foreach ($manifest['tables'] as $table) {
            if (is_int($table['maxId']) && ($next[$table['name']] ?? 0) <= $table['maxId']) {
                throw new BackupError(BackupError::RESTORE_MISMATCH);
            }
        }
        return $target['head'];
    }

    /**
     * @param array<string, mixed> $manifest
     * @return array<string, mixed>
     */
    private function evidence(array $manifest, int $targetHead, int $codeHead, float $started): array
    {
        $finished = microtime(true);
        return [
            'backupId' => $manifest['backupId'],
            'manifestSha256' => hash('sha256', BackupFormat::encode($manifest)),
            'keyFingerprint' => $manifest['keyFingerprint'],
            'source' => $manifest['source']['env'] . ' ' . substr($manifest['source']['databaseFingerprint'], 0, 16),
            'target' => $this->targetEnv . ' ' . substr($this->targetFingerprint, 0, 16),
            'backupHead' => $manifest['schema']['databaseHead'],
            'targetHead' => $targetHead,
            'codeHead' => $codeHead,
            'tables' => array_column($manifest['tables'], 'rows', 'name'),
            'decimalColumns' => array_sum(array_map(static fn (array $t): int => count($t['decimalTotals']), $manifest['tables'])),
            'excluded' => count($manifest['excludedTables']),
            'started' => gmdate('Y-m-d\TH:i:s\Z', (int) $started),
            'finished' => gmdate('Y-m-d\TH:i:s\Z', (int) $finished),
            'durationMs' => (int) round(($finished - $started) * 1000),
        ];
    }

    private function seam(string $stage, mixed $connection): void
    {
        if ($this->seam !== null) {
            ($this->seam)($stage, $connection);
        }
    }
}
