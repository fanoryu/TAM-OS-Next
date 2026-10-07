<?php
declare(strict_types=1);

namespace TamOs\Data\Backup;

use TamOs\Config\Config;
use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Data\DatabaseError;
use TamOs\Data\Migration\MigrationHistory;
use TamOs\Data\Migration\Migrator;
use TamOs\Ops\BackupError;
use TamOs\Ops\BackupTables;

/**
 * The backup's read-only view of the whole database (OPS-1) — the one data-layer class that reads
 * across companies, and only for server/bin/backup.php: it is never reachable from an HTTP route
 * (tools/verify-backend-boundary.js). It holds SELECT statements only, plus the advisory locks and
 * the read-only snapshot; it writes nothing.
 *
 *   lock()       the backup lock (a second backup is refused: backup_busy) and the migration lock
 *                (a running migration refuses the backup, and no migration starts during it)
 *   history()    the applied migrations, checked like `migrate.php status` (an incomplete or
 *                drifted history refuses the backup; pending migrations are allowed — that is the
 *                pre-migration backup, D-AB-13)
 *   snapshot()   one read-only REPEATABLE READ transaction for every read of the backup
 *
 * Each backed-up table is read in primary-key pages through its own fixed statement, so no table
 * or column name is ever built into SQL.
 */
final class BackupReader
{
    public const PAGE = 500;
    private const BACKUP_LOCK_SQL = "SELECT GET_LOCK('tamos_backup', 0) AS acquired";
    private const BACKUP_UNLOCK_SQL = "SELECT RELEASE_LOCK('tamos_backup') AS released";
    private const NOW_SQL = 'SELECT UTC_TIMESTAMP(6) AS now';
    private const TABLES_SQL = 'SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME';
    private const COLUMNS_SQL = 'SELECT TABLE_NAME AS tbl, COLUMN_NAME AS name, COLUMN_TYPE AS column_type, DATA_TYPE AS data_type, IS_NULLABLE AS nullable, NUMERIC_SCALE AS scale, COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION';
    private const PRIMARY_SQL = "SELECT TABLE_NAME AS tbl, COLUMN_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME = 'PRIMARY' ORDER BY TABLE_NAME, SEQ_IN_INDEX";

    /** One page of a table, after the last id read. */
    private const PAGE_SQL = [
        'companies' => 'SELECT * FROM companies WHERE id > :after ORDER BY id LIMIT 500',
        'users' => 'SELECT * FROM users WHERE id > :after ORDER BY id LIMIT 500',
        'employees' => 'SELECT * FROM employees WHERE id > :after ORDER BY id LIMIT 500',
        'memberships' => 'SELECT * FROM memberships WHERE id > :after ORDER BY id LIMIT 500',
        'auth_events' => 'SELECT * FROM auth_events WHERE id > :after ORDER BY id LIMIT 500',
        'audit_events' => 'SELECT * FROM audit_events WHERE id > :after ORDER BY id LIMIT 500',
        'overtime_records' => 'SELECT * FROM overtime_records WHERE id > :after ORDER BY id LIMIT 500',
        'payroll_plans' => 'SELECT * FROM payroll_plans WHERE id > :after ORDER BY id LIMIT 500',
        'payroll_plan_overtime' => 'SELECT * FROM payroll_plan_overtime WHERE id > :after ORDER BY id LIMIT 500',
        'supplemental_payrolls' => 'SELECT * FROM supplemental_payrolls WHERE id > :after ORDER BY id LIMIT 500',
        'supplemental_payroll_overtime' => 'SELECT * FROM supplemental_payroll_overtime WHERE id > :after ORDER BY id LIMIT 500',
        'finance_postings' => 'SELECT * FROM finance_postings WHERE id > :after ORDER BY id LIMIT 500',
        'finance_executions' => 'SELECT * FROM finance_executions WHERE id > :after ORDER BY id LIMIT 500',
    ];

    /** A table's row count inside the same snapshot — an independent check of the rows streamed. */
    private const COUNT_SQL = [
        'companies' => 'SELECT COUNT(*) AS n FROM companies',
        'users' => 'SELECT COUNT(*) AS n FROM users',
        'employees' => 'SELECT COUNT(*) AS n FROM employees',
        'memberships' => 'SELECT COUNT(*) AS n FROM memberships',
        'auth_events' => 'SELECT COUNT(*) AS n FROM auth_events',
        'audit_events' => 'SELECT COUNT(*) AS n FROM audit_events',
        'overtime_records' => 'SELECT COUNT(*) AS n FROM overtime_records',
        'payroll_plans' => 'SELECT COUNT(*) AS n FROM payroll_plans',
        'payroll_plan_overtime' => 'SELECT COUNT(*) AS n FROM payroll_plan_overtime',
        'supplemental_payrolls' => 'SELECT COUNT(*) AS n FROM supplemental_payrolls',
        'supplemental_payroll_overtime' => 'SELECT COUNT(*) AS n FROM supplemental_payroll_overtime',
        'finance_postings' => 'SELECT COUNT(*) AS n FROM finance_postings',
        'finance_executions' => 'SELECT COUNT(*) AS n FROM finance_executions',
    ];

    private readonly MigrationHistory $history;
    private bool $locked = false;

    private function __construct(private readonly Database $db, private readonly string $sourceFingerprint)
    {
        $this->history = new MigrationHistory($db);
    }

    /** @throws DatabaseError when the db section is missing or invalid */
    public static function fromConfig(Config $config): self
    {
        $db = DatabaseConfig::fromConfig($config);
        return new self(new Database($db), self::fingerprint($db->host, $db->port, $db->name));
    }

    /** For the guarded database tests, which share their connection with the fixtures. */
    public static function fromDatabase(Database $db, string $sourceFingerprint): self
    {
        return new self($db, $sourceFingerprint);
    }

    /** A non-secret identifier of the source database (host, port and name; never a credential). */
    public static function fingerprint(string $host, int $port, string $name): string
    {
        return hash('sha256', "tamos-backup-source\n" . $host . "\n" . $port . "\n" . $name);
    }

    public function sourceFingerprint(): string
    {
        return $this->sourceFingerprint;
    }

    /**
     * Takes the backup lock, then the migration lock, on this connection without waiting.
     *
     * @throws BackupError backup_busy
     * @throws \TamOs\Data\Migration\MigrationError migration_busy
     * @throws DatabaseError
     */
    public function lock(): void
    {
        $acquired = $this->db->select(self::BACKUP_LOCK_SQL)[0]['acquired'] ?? null;
        if ($acquired === null) {
            throw new DatabaseError(DatabaseError::FAILURE, 'lock');
        }
        if ((int) $acquired !== 1) {
            throw new BackupError(BackupError::BUSY);
        }
        try {
            $this->history->acquireLock();
        } catch (\Throwable $e) {
            $this->releaseBackupLock();
            throw $e;
        }
        $this->locked = true;
    }

    /** Best effort: closing the connection releases both locks as well. */
    public function unlock(): void
    {
        if ($this->locked) {
            $this->history->releaseLock();
            $this->releaseBackupLock();
            $this->locked = false;
        }
    }

    /**
     * The applied migration history (versions 1..k, each complete and identical to its file) and
     * the code's migration count. Pending files are allowed; anything else refuses.
     *
     * @return array{applied: list<array{version: int, name: string, sha256: string}>, codeHead: int, createdTables: list<string>}
     * @throws \TamOs\Data\Migration\MigrationError history_missing | history_invalid | schema_incomplete | schema_drift | migrations_invalid
     */
    public function history(string $migrationsDir): array
    {
        $migrator = new Migrator($this->db, $migrationsDir);
        $pending = $migrator->inspect();
        $set = \TamOs\Data\Migration\MigrationSet::load($migrationsDir);
        $applied = [];
        $created = [];
        foreach (array_slice($set, 0, count($set) - count($pending)) as $migration) {
            $applied[] = ['version' => $migration->version, 'name' => $migration->name, 'sha256' => $migration->sha256];
            if (preg_match_all('/^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-z0-9_]+)`?/mi', $migration->sql, $m) > 0) {
                array_push($created, ...$m[1]);
            }
        }
        return ['applied' => $applied, 'codeHead' => count($set), 'createdTables' => $created];
    }

    /**
     * Runs $fn inside one read-only REPEATABLE READ snapshot.
     *
     * @template T
     * @param \Closure(): T $fn
     * @return T
     */
    public function snapshot(\Closure $fn): mixed
    {
        return $this->db->snapshot(static fn (): mixed => $fn());
    }

    /** The database clock (UTC) — the snapshot's time, read first inside it. */
    public function now(): string
    {
        return (string) $this->db->select(self::NOW_SQL)[0]['now'];
    }

    /**
     * Every table of the database with its engine, columns (in order) and primary key.
     *
     * @return array<string, array{type: string, engine: ?string, columns: list<array{name: string, columnType: string, dataType: string, nullable: bool, scale: ?int, collation: ?string}>, primary: list<string>}>
     */
    public function schema(): array
    {
        $tables = [];
        foreach ($this->db->select(self::TABLES_SQL) as $row) {
            $tables[(string) $row['name']] = ['type' => (string) $row['type'], 'engine' => $row['engine'] === null ? null : (string) $row['engine'], 'columns' => [], 'primary' => []];
        }
        foreach ($this->db->select(self::COLUMNS_SQL) as $row) {
            $table = (string) $row['tbl'];
            if (isset($tables[$table])) {
                $tables[$table]['columns'][] = [
                    'name' => (string) $row['name'],
                    'columnType' => (string) $row['column_type'],
                    'dataType' => strtolower((string) $row['data_type']),
                    'nullable' => $row['nullable'] === 'YES',
                    'scale' => $row['scale'] === null ? null : (int) $row['scale'],
                    'collation' => $row['collation'] === null ? null : (string) $row['collation'],
                ];
            }
        }
        foreach ($this->db->select(self::PRIMARY_SQL) as $row) {
            $table = (string) $row['tbl'];
            if (isset($tables[$table])) {
                $tables[$table]['primary'][] = (string) $row['name'];
            }
        }
        return $tables;
    }

    /** @throws \LogicException for a table that is not backed up */
    public function count(string $table): int
    {
        $sql = self::COUNT_SQL[$table] ?? throw new \LogicException('not a backed-up table');
        return (int) $this->db->select($sql)[0]['n'];
    }

    /**
     * The next page of $table: up to PAGE rows with id greater than $after, in id order.
     *
     * @return list<array<string, mixed>>
     */
    public function page(string $table, int|string $after): array
    {
        $sql = self::PAGE_SQL[$table] ?? throw new \LogicException('not a backed-up table');
        return $this->db->select($sql, ['after' => $after]);
    }

    /** @return list<string> the backed-up tables this reader has statements for, in backup order */
    public static function tables(): array
    {
        if (array_keys(self::PAGE_SQL) !== BackupTables::INCLUDED || array_keys(self::COUNT_SQL) !== BackupTables::INCLUDED) {
            throw new \LogicException('the backup statements cover exactly the backed-up tables, in order');
        }
        return BackupTables::INCLUDED;
    }

    private function releaseBackupLock(): void
    {
        try {
            $this->db->select(self::BACKUP_UNLOCK_SQL);
        } catch (DatabaseError) {
            // The lock dies with the (non-persistent) connection.
        }
    }
}
