<?php
declare(strict_types=1);

namespace TamOs\Ops;

/**
 * The host backup directory (OPS-1, D-AB-8 = A, D-AB-10 = A) — the only code that creates,
 * renames or deletes backup files, and only names it owns:
 *
 *   tamos-backup-<id>.tamosbk           a finished, encrypted backup
 *   tamos-backup-<id>.tamosbk.sha256    its SHA-256, in sha256sum format (the transfer check)
 *   .tamos-backup-<id>.tmp / .sha256.tmp   work in progress, never a backup
 *
 * <id> is the snapshot's UTC time, its microsecond and a random suffix (YYYYMMDDTHHMMSSZ-xxxxxxxx), so names sort
 * chronologically and never collide. A backup becomes visible only by an atomic rename after it
 * was synced, re-read and found byte-identical to what was written, its sidecar already in place;
 * a final name is never overwritten. After a successful backup the directory keeps the newest
 * KEEP backups and removes older ones; a failed run deletes only its own work in progress and
 * prunes nothing, so a failing schedule never erodes the good backups. The owner pulls finished
 * backups off-host (SFTP); off-host retention is the owner's.
 */
final class BackupStore
{
    public const KEEP = 7;
    /** status: the newest backup must be younger than this (a nightly schedule plus slack). */
    public const MAX_AGE_SECONDS = 26 * 3600;
    public const ID_PATTERN = '/^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/D';
    private const FINAL_PATTERN = '/^tamos-backup-([0-9]{8}T[0-9]{6}Z-[0-9a-f]{8})\.tamosbk$/D';
    private const SIDECAR_PATTERN = '/^tamos-backup-([0-9]{8}T[0-9]{6}Z-[0-9a-f]{8})\.tamosbk\.sha256$/D';
    private const TEMP_PATTERN = '/^\.tamos-backup-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}(\.sha256)?\.tmp$/D';

    private function __construct(public readonly string $dir)
    {
    }

    /**
     * The configured directory: an existing, writable, real directory (not a link) outside the
     * application tree (and so outside its public API root).
     *
     * @throws BackupError directory
     */
    public static function open(string $dir, string $appRoot): self
    {
        if (!BackupConfig::isAbsolute($dir) || !is_dir($dir) || is_link($dir) || !is_writable($dir)) {
            throw new BackupError(BackupError::DIRECTORY);
        }
        $real = realpath($dir);
        $app = realpath($appRoot);
        if ($real === false || $app === false || self::isInside($real, $app)) {
            throw new BackupError(BackupError::DIRECTORY);
        }
        return new self($real);
    }

    /** For verify, which works on files the owner pulled off-host, not on the host directory. */
    public static function isBackupId(string $id): bool
    {
        return preg_match(self::ID_PATTERN, $id) === 1;
    }

    public static function newId(string $snapshotAt): string
    {
        if (preg_match('/^([0-9]{4})-([0-9]{2})-([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]{1,6})?$/D', $snapshotAt, $m) !== 1) {
            throw new \LogicException('snapshot time is a UTC DATETIME');
        }
        // The suffix starts with the microsecond (5 hex digits) and ends with 3 random hex digits,
        // so ids sort chronologically even within one second.
        $micro = (int) str_pad(substr($m[7] ?? '', 1), 6, '0');
        return $m[1] . $m[2] . $m[3] . 'T' . $m[4] . $m[5] . $m[6] . 'Z-' . sprintf('%05x', $micro) . substr(bin2hex(random_bytes(2)), 0, 3);
    }

    public static function fileName(string $id): string
    {
        return 'tamos-backup-' . $id . '.tamosbk';
    }

    /** The id a finished backup's file name carries, or null for any other name. */
    public static function idOfFileName(string $name): ?string
    {
        return preg_match(self::FINAL_PATTERN, $name, $m) === 1 ? $m[1] : null;
    }

    /** The UTC time encoded in an id. */
    public static function timeOf(string $id): int
    {
        $time = \DateTimeImmutable::createFromFormat('!Ymd\THis\Z', substr($id, 0, 16), new \DateTimeZone('UTC'));
        if ($time === false) {
            throw new \LogicException('backup id time');
        }
        return $time->getTimestamp();
    }

    /** Deletes work in progress a crashed earlier run left behind. Call only under the backup lock. */
    public function removeStaleTemporaries(): int
    {
        $n = 0;
        foreach ($this->entries() as $name) {
            if (preg_match(self::TEMP_PATTERN, $name) === 1 && is_file($this->path($name)) && !is_link($this->path($name))) {
                unlink($this->path($name));
                $n++;
            }
        }
        return $n;
    }

    /**
     * Creates the work-in-progress file for $id (exclusive create, owner-only permissions).
     *
     * @return array{0: resource, 1: string} the open handle and its path
     * @throws BackupError write_failed
     */
    public function createTemporary(string $id): array
    {
        $path = $this->path('.tamos-backup-' . $id . '.tmp');
        $handle = self::createExclusive($path);
        if ($handle === false) {
            throw new BackupError(BackupError::WRITE_FAILED);
        }
        return [$handle, $path];
    }

    /**
     * Creates a new file that did not exist (never opens or truncates an existing one), readable and
     * writable by the owner only from its first byte.
     *
     * @return resource|false
     */
    public static function createExclusive(string $path): mixed
    {
        $mask = umask(0077);
        try {
            $handle = @fopen($path, 'xb');
        } finally {
            umask($mask);
        }
        if ($handle !== false) {
            @chmod($path, 0600);
        }
        return $handle;
    }

    /**
     * Makes a written temporary file the finished backup $id: syncs and closes it, re-reads it and
     * requires the SHA-256 written, writes the sidecar, then renames — sidecar first, backup last —
     * so a backup name never refers to an unsynced, unverified or sidecar-less file.
     *
     * @param resource $handle
     * @return string the final path
     * @throws BackupError write_failed | readback_mismatch | exists
     */
    public function finalize(mixed $handle, string $tempPath, string $id, string $sha256): string
    {
        if (!fflush($handle) || !fsync($handle) || !fclose($handle)) {
            throw new BackupError(BackupError::WRITE_FAILED);
        }
        $read = hash_file('sha256', $tempPath);
        if (!is_string($read) || !hash_equals($sha256, $read)) {
            throw new BackupError(BackupError::READBACK_MISMATCH);
        }
        $final = $this->path(self::fileName($id));
        $sidecar = $final . '.sha256';
        if (file_exists($final) || file_exists($sidecar)) {
            throw new BackupError(BackupError::EXISTS);
        }
        $sidecarTemp = $this->path('.tamos-backup-' . $id . '.sha256.tmp');
        $out = self::createExclusive($sidecarTemp);
        if ($out === false) {
            throw new BackupError(BackupError::WRITE_FAILED);
        }
        $line = $sha256 . '  ' . self::fileName($id) . "\n";
        $ok = fwrite($out, $line) === strlen($line) && fflush($out) && fsync($out);
        fclose($out);
        if (!$ok || !rename($sidecarTemp, $sidecar)) {
            @unlink($sidecarTemp);
            throw new BackupError(BackupError::WRITE_FAILED);
        }
        if (file_exists($final) || !rename($tempPath, $final)) {
            @unlink($sidecar);
            throw new BackupError(BackupError::WRITE_FAILED);
        }
        return $final;
    }

    /** Removes a failed run's own work in progress (best effort; never a finished backup). */
    public function discard(string $id): void
    {
        foreach (['.tamos-backup-' . $id . '.tmp', '.tamos-backup-' . $id . '.sha256.tmp'] as $name) {
            if (is_file($this->path($name))) {
                @unlink($this->path($name));
            }
        }
    }

    /** @return list<string> the ids of finished backups (a file and its sidecar), newest first */
    public function ids(): array
    {
        $ids = [];
        foreach ($this->entries() as $name) {
            $id = self::idOfFileName($name);
            if ($id !== null && is_file($this->path($name)) && !is_link($this->path($name))) {
                $ids[] = $id;
            }
        }
        rsort($ids, SORT_STRING);
        return $ids;
    }

    /**
     * Keeps the newest KEEP finished backups and deletes the rest (file and sidecar). Only names
     * this store owns are ever deleted, and never $justCreated. Call only after a successful
     * backup, under the lock.
     *
     * @return int the number of backups removed
     */
    public function prune(string $justCreated): int
    {
        $removed = 0;
        foreach (array_slice($this->ids(), self::KEEP) as $id) {
            if ($id === $justCreated) {
                continue;
            }
            $final = $this->path(self::fileName($id));
            if (is_file($final . '.sha256') && !is_link($final . '.sha256')) {
                unlink($final . '.sha256');
            }
            unlink($final);
            $removed++;
        }
        foreach ($this->entries() as $name) {
            // A sidecar whose backup is gone (a crash between the two renames) is not a backup.
            if (preg_match(self::SIDECAR_PATTERN, $name, $m) === 1 && !is_file($this->path(self::fileName($m[1])))) {
                unlink($this->path($name));
            }
        }
        return $removed;
    }

    /**
     * Checks one finished backup on the host without any key: its sidecar, its SHA-256 and its
     * clear header (magic, id, key fingerprint).
     *
     * @return array{bytes: int, keyFingerprint: string}
     * @throws BackupError sidecar | digest_mismatch | malformed | name_mismatch
     */
    public function check(string $id): array
    {
        return self::checkFile($this->path(self::fileName($id)));
    }

    /**
     * The same checks for any backup file path (verify uses it on pulled copies).
     *
     * @return array{bytes: int, keyFingerprint: string}
     * @throws BackupError sidecar | digest_mismatch | malformed | name_mismatch
     */
    public static function checkFile(string $path): array
    {
        $id = self::idOfFileName(basename($path));
        if ($id === null) {
            throw new BackupError(BackupError::NAME_MISMATCH);
        }
        if (!is_file($path) || is_link($path)) {
            throw new BackupError(BackupError::MALFORMED);
        }
        $sidecar = @file_get_contents($path . '.sha256');
        if (!is_string($sidecar) || preg_match('/^([0-9a-f]{64})  (\S+)\n$/D', $sidecar, $m) !== 1 || $m[2] !== basename($path)) {
            throw new BackupError(BackupError::SIDECAR);
        }
        $actual = hash_file('sha256', $path);
        if (!is_string($actual) || !hash_equals($m[1], $actual)) {
            throw new BackupError(BackupError::DIGEST_MISMATCH);
        }
        $in = fopen($path, 'rb');
        try {
            $header = BackupCipher::readHeader($in);
        } finally {
            fclose($in);
        }
        if ($header['backupId'] !== $id) {
            throw new BackupError(BackupError::NAME_MISMATCH);
        }
        return ['bytes' => (int) filesize($path), 'keyFingerprint' => $header['keyFingerprint']];
    }

    private function path(string $name): string
    {
        return $this->dir . DIRECTORY_SEPARATOR . $name;
    }

    /** @return list<string> */
    private function entries(): array
    {
        $entries = scandir($this->dir);
        if ($entries === false) {
            throw new BackupError(BackupError::DIRECTORY);
        }
        return array_values(array_filter($entries, static fn (string $e): bool => $e !== '.' && $e !== '..'));
    }

    private static function isInside(string $path, string $root): bool
    {
        $norm = static fn (string $p): string => rtrim(strtolower(str_replace('\\', '/', $p)), '/') . '/';
        return str_starts_with($norm($path), $norm($root));
    }
}
