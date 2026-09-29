<?php
declare(strict_types=1);

namespace TamOs\Data\Migration;

/**
 * Reads and validates the repository's migration files. Filesystem only — no database.
 *
 * `NNNN_name.sql`, versions exactly 1..N (no gap, no duplicate), name ≤ 64 characters, and
 * bytes that are non-empty UTF-8 without a BOM or any CR. A missing directory is an empty
 * set (there is no migration until 0001 exists); a present directory may hold nothing but
 * migration files. Any violation fails closed as `migrations_invalid`.
 */
final class MigrationSet
{
    public const FILE_PATTERN = '/^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/';
    public const MAX_NAME_LENGTH = 64;

    /**
     * @return list<Migration> ordered by version
     * @throws MigrationError migrations_invalid
     */
    public static function load(string $dir): array
    {
        if (!file_exists($dir)) {
            return [];
        }
        if (!is_dir($dir) || is_link($dir)) {
            throw new MigrationError(MigrationError::MIGRATIONS_INVALID);
        }
        $entries = scandir($dir);
        if ($entries === false) {
            throw new MigrationError(MigrationError::MIGRATIONS_INVALID);
        }

        $byVersion = [];
        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $path = $dir . DIRECTORY_SEPARATOR . $entry;
            if (preg_match(self::FILE_PATTERN, $entry, $m) !== 1 || !is_file($path) || is_link($path)) {
                throw new MigrationError(MigrationError::MIGRATIONS_INVALID);
            }
            $version = (int) $m[1];
            if ($version < 1 || strlen($m[2]) > self::MAX_NAME_LENGTH || isset($byVersion[$version])) {
                throw new MigrationError(MigrationError::MIGRATIONS_INVALID, $version);
            }
            $byVersion[$version] = self::read($path, $version, $m[2]);
        }

        ksort($byVersion);
        if (array_keys($byVersion) !== ($byVersion === [] ? [] : range(1, count($byVersion)))) {
            throw new MigrationError(MigrationError::MIGRATIONS_INVALID);
        }
        return array_values($byVersion);
    }

    private static function read(string $path, int $version, string $name): Migration
    {
        $bytes = file_get_contents($path);
        $valid = is_string($bytes)
            && $bytes !== ''
            && !str_starts_with($bytes, "\xEF\xBB\xBF")
            && !str_contains($bytes, "\r")
            && preg_match('//u', $bytes) === 1;
        if (!$valid) {
            throw new MigrationError(MigrationError::MIGRATIONS_INVALID, $version);
        }
        $migration = new Migration($version, $name, hash('sha256', $bytes), $bytes);
        if (trim($migration->sqlForExecution()) === '') {
            throw new MigrationError(MigrationError::MIGRATIONS_INVALID, $version);
        }
        return $migration;
    }
}
