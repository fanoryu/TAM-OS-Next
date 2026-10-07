<?php
declare(strict_types=1);

namespace TamOs\Ops;

/**
 * A refused or failed backup operation (OPS-1). The reason is a fixed, value-free code: it is
 * printed by server/bin/backup.php and logged, so it never carries a path, a key, a row value,
 * SQL or a driver message.
 */
final class BackupError extends \RuntimeException
{
    /** The `backup` configuration section is missing or invalid. */
    public const CONFIG = 'config';
    /** The backup directory is missing, not a directory, a link, unwritable, or inside the application or web root. */
    public const DIRECTORY = 'directory';
    /** Another backup holds the backup lock (accidental double invocation). */
    public const BUSY = 'backup_busy';
    /** The database schema is not one this tool may snapshot (an unexpected or unclassified table, engine or key). */
    public const UNEXPECTED_SCHEMA = 'unexpected_schema';
    /** A table exists that is neither backed up nor explicitly excluded (OPS-1 table classification). */
    public const UNCLASSIFIED_TABLE = 'unclassified_table';
    /** A column value the format cannot represent exactly (a float, or a value that is not valid UTF-8). */
    public const UNSUPPORTED_VALUE = 'unsupported_value';
    /** The rows streamed from the snapshot disagree with the snapshot's own count. */
    public const SNAPSHOT_INCONSISTENT = 'snapshot_inconsistent';
    /** Writing, syncing, re-reading or renaming the backup file failed (for example a full disk). */
    public const WRITE_FAILED = 'write_failed';
    /** The written file did not read back byte-identical to what was written. */
    public const READBACK_MISMATCH = 'readback_mismatch';
    /** The final backup name already exists; a backup is never overwritten. */
    public const EXISTS = 'exists';
    /** No backup was found (status). */
    public const NONE = 'none';
    /** The newest backup is older than the freshness window (status). */
    public const STALE = 'stale';
    /** A backup file does not match its recorded SHA-256 (status, verify). */
    public const DIGEST_MISMATCH = 'digest_mismatch';
    /** The SHA-256 sidecar of a backup is missing or malformed (status, verify). */
    public const SIDECAR = 'sidecar';
    /** The file name does not match the backup id inside it (verify). */
    public const NAME_MISMATCH = 'name_mismatch';
    /** The file is not a TAM OS backup, or its structure is broken (verify). */
    public const MALFORMED = 'malformed';
    /** The file ends before its authenticated final chunk, or has bytes after it (verify). */
    public const TRUNCATED = 'truncated';
    /** A chunk fails authentication: the file was modified (verify). */
    public const TAMPERED = 'tampered';
    /** The secret key does not open this backup (verify). */
    public const WRONG_KEY = 'wrong_key';
    /** The secret key file is missing or malformed (verify, keygen). */
    public const KEY_FILE = 'key_file';
    /** The decrypted content disagrees with its own manifest (verify). */
    public const MANIFEST_MISMATCH = 'manifest_mismatch';
    /** The previous backup is not an earlier backup of the same database (verify --previous). */
    public const PREVIOUS_MISMATCH = 'previous_mismatch';
    /** Rows of an append-only table already present in the previous backup changed or disappeared (verify --previous). */
    public const CONTINUITY_BROKEN = 'continuity_broken';
    /** verify and keygen never run on a host whose configuration is the production one: the secret key stays off-host. */
    public const PRODUCTION_HOST = 'refused_on_production_host';
    /** libsodium (or zlib) is not available to this PHP. */
    public const UNAVAILABLE = 'crypto_unavailable';

    public function __construct(public readonly string $reason)
    {
        parent::__construct('backup: ' . $reason);
    }
}
