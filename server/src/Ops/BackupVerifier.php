<?php
declare(strict_types=1);

namespace TamOs\Ops;

/**
 * Verifies a backup off-host with the secret key (OPS-1 `verify`). Nothing is trusted until the
 * whole file has been read:
 *
 *   1. the sidecar SHA-256 matches the file, and the file name matches the id in its header;
 *   2. the secret key opens it, every frame authenticates, the final frame is present and nothing
 *      follows it (BackupCipher::open);
 *   3. the payload re-parses canonically and its manifest agrees with what the rows recompute to
 *      (BackupParser): counts, digests, maximum ids and exact DECIMAL totals;
 *   4. the manifest is complete and coherent: the backed-up, excluded and absent tables are exactly
 *      the classified lists, the migration history is versions 1..databaseHead, and the backup id
 *      and key fingerprint equal the header's.
 *
 * With a previous backup (which is verified the same way first), the two must come from the same
 * database, the previous one must be older, and every row the previous backup holds of an
 * append-only table must reappear byte-identical (D-AB-5 = B).
 */
final class BackupVerifier
{
    public function __construct(private readonly string $secretKey)
    {
    }

    /**
     * @return array<string, mixed> the verified manifest
     * @throws BackupError
     */
    public function verify(string $path, ?string $previousPath = null): array
    {
        $continuity = [];
        $previous = null;
        if ($previousPath !== null) {
            $previous = $this->verify($previousPath);
            $currentId = BackupStore::idOfFileName(basename($path));
            if ($currentId === null || strcmp($previous['backupId'], $currentId) >= 0) {
                throw new BackupError(BackupError::PREVIOUS_MISMATCH);    // the previous backup must be older
            }
            foreach ($previous['tables'] as $table) {
                if (in_array($table['name'], BackupTables::APPEND_ONLY, true) && $table['rows'] > 0) {
                    $continuity[$table['name']] = ['maxId' => $table['maxId'], 'rows' => $table['rows'], 'sha256' => $table['sha256']];
                }
            }
        }
        $manifest = $this->read($path, $continuity);
        if ($previous !== null && ($previous['source']['databaseFingerprint'] !== $manifest['source']['databaseFingerprint']
            || strcmp($previous['backupId'], $manifest['backupId']) >= 0)) {
            throw new BackupError(BackupError::PREVIOUS_MISMATCH);
        }
        return $manifest;
    }

    /**
     * @param array<string, array{maxId: int, rows: int, sha256: string}> $continuity
     * @return array<string, mixed>
     */
    private function read(string $path, array $continuity): array
    {
        $checked = BackupStore::checkFile($path);
        $parser = new BackupParser($continuity);
        $in = fopen($path, 'rb');
        if ($in === false) {
            throw new BackupError(BackupError::MALFORMED);
        }
        try {
            $header = BackupCipher::open($in, $this->secretKey, static function (string $plain) use ($parser): void {
                $parser->feed($plain);
            });
        } finally {
            fclose($in);
        }
        $manifest = $parser->finish();
        if ($manifest['backupId'] !== $header['backupId'] || BackupStore::idOfFileName(basename($path)) !== $header['backupId']) {
            throw new BackupError(BackupError::NAME_MISMATCH);
        }
        if (($manifest['keyFingerprint'] ?? null) !== $header['keyFingerprint'] || $checked['keyFingerprint'] !== $header['keyFingerprint']) {
            throw new BackupError(BackupError::MANIFEST_MISMATCH);
        }
        self::requireCoherent($manifest);
        return $manifest;
    }

    /**
     * The manifest's own structure: classified tables, history and source.
     *
     * @param array<string, mixed> $m
     * @throws BackupError manifest_mismatch
     */
    public static function requireCoherent(array $m): void
    {
        $tables = array_column($m['tables'], 'name');
        $absent = $m['absentTables'] ?? null;
        $source = $m['source'] ?? null;
        $schema = $m['schema'] ?? null;
        $ok = is_array($absent) && array_is_list($absent)
            && ($m['excludedTables'] ?? null) === BackupTables::EXCLUDED
            && array_values(array_filter(BackupTables::INCLUDED, static fn (string $t): bool => !in_array($t, $absent, true))) === $tables
            && array_values(array_intersect(BackupTables::INCLUDED, $absent)) === $absent
            && is_array($source) && array_keys($source) === ['env', 'databaseFingerprint'] && is_string($source['env'])
            && is_string($source['databaseFingerprint']) && preg_match('/^[0-9a-f]{64}$/D', $source['databaseFingerprint']) === 1
            && is_string($m['snapshotAt'] ?? null)
            && is_array($schema) && array_keys($schema) === ['databaseHead', 'codeHead', 'migrations']
            && is_int($schema['databaseHead']) && is_int($schema['codeHead']) && $schema['databaseHead'] <= $schema['codeHead']
            && is_array($schema['migrations']) && count($schema['migrations']) === $schema['databaseHead'];
        if ($ok) {
            foreach ($schema['migrations'] as $i => $migration) {
                $ok = $ok && is_array($migration) && array_keys($migration) === ['version', 'name', 'sha256'] && $migration['version'] === $i + 1
                    && is_string($migration['name']) && is_string($migration['sha256']) && preg_match('/^[0-9a-f]{64}$/D', $migration['sha256']) === 1;
            }
            foreach ($m['tables'] as $table) {
                $ok = $ok && is_string($table['columnsSha256'] ?? null) && preg_match('/^[0-9a-f]{64}$/D', $table['columnsSha256']) === 1;
            }
        }
        if (!$ok) {
            throw new BackupError(BackupError::MANIFEST_MISMATCH);
        }
    }
}
