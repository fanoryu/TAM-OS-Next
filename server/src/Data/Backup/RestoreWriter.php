<?php
declare(strict_types=1);

namespace TamOs\Data\Backup;

use TamOs\Config\Config;
use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Ops\BackupTables;

/**
 * The restore's write path (OPS-2) — the one data-layer class that writes rows across companies,
 * and only for server/bin/backup.php restore, which runs off-host into an empty, already migrated
 * database (D-AB-12, D-OPS2-1 = A). It is never reachable from an HTTP route
 * (tools/verify-backend-boundary.js). It owns the restore's connection to the target — the
 * transaction, the read-only snapshot and the BackupReader on that same connection — and holds
 * exactly these statements:
 *
 *   INSERT_SQL      one plain INSERT per backed-up table, every stored column named and bound — no
 *                   IGNORE, REPLACE, ON DUPLICATE KEY, UPDATE, DELETE or TRUNCATE, and no statement
 *                   for an excluded table or the migration history
 *   LOCK_EMPTY_SQL  a shared-locking read of the first row of every classified table: inside the
 *                   restore's transaction it proves the table empty and keeps it so (the next-key
 *                   lock on an empty table blocks every other insert until commit)
 *   EMPTY_SQL       the same read without a lock, for the excluded tables after a restore
 *   two information_schema reads: the generated columns and the auto-increment counters
 *
 * Stored generated columns (GENERATED) are in the backup but never inserted: the server recomputes
 * them, and the restore's verification proves the recomputed values equal the backed-up ones.
 * Foreign-key and unique checks stay on; the backed-up order is foreign-key safe.
 */
final class RestoreWriter
{
    /** The stored (inserted) columns of every backed-up table, in table order. */
    public const COLUMNS = [
        'companies' => ['id', 'created_at'],
        'users' => ['id', 'email', 'password_hash', 'status', 'created_at', 'updated_at'],
        'employees' => ['id', 'company_id', 'employee_code', 'full_name', 'job_title', 'department', 'employment_status', 'join_date', 'contact_email', 'phone', 'notes', 'monthly_base_salary', 'archived_at', 'version', 'created_at', 'updated_at'],
        'memberships' => ['id', 'user_id', 'company_id', 'role', 'employee_id', 'status', 'created_at', 'updated_at'],
        'auth_events' => ['id', 'occurred_at', 'event', 'user_id', 'membership_id', 'email_hash', 'ip', 'request_id'],
        'audit_events' => ['id', 'company_id', 'occurred_at', 'actor_user_id', 'actor_membership_id', 'action', 'entity', 'entity_id', 'operation', 'target_user_id', 'request_id', 'fields'],
        'overtime_records' => ['id', 'company_id', 'employee_id', 'month_key', 'overtime_date', 'hours', 'work_description', 'notes', 'status', 'version', 'created_at', 'updated_at', 'valuation_method', 'valuation_salary', 'valuation_standard_hours', 'approved_amount', 'approved_at'],
        'payroll_plans' => ['id', 'company_id', 'employee_id', 'month_key', 'status', 'employee_code_snapshot', 'employee_name_snapshot', 'department_snapshot', 'base_salary', 'overtime_amount', 'overtime_hours', 'overtime_count', 'total_amount', 'calculated_at', 'committed_at', 'commit_idempotency_key', 'version', 'created_at', 'updated_at'],
        'payroll_plan_overtime' => ['id', 'company_id', 'payroll_plan_id', 'created_at'],
        'supplemental_payrolls' => ['id', 'company_id', 'payroll_plan_id', 'employee_id', 'month_key', 'status', 'employee_code_snapshot', 'employee_name_snapshot', 'department_snapshot', 'overtime_amount', 'overtime_hours', 'overtime_count', 'calculated_at', 'committed_at', 'commit_idempotency_key', 'version', 'created_at', 'updated_at'],
        'supplemental_payroll_overtime' => ['id', 'company_id', 'supplemental_payroll_id', 'created_at'],
        'finance_postings' => ['id', 'company_id', 'source_kind', 'payroll_plan_id', 'supplemental_payroll_id', 'employee_id', 'month_key', 'amount', 'status', 'idempotency_key', 'posted_at'],
        'finance_executions' => ['id', 'company_id', 'finance_posting_id', 'employee_id', 'month_key', 'amount', 'executed_on', 'payment_method', 'idempotency_key', 'recorded_at'],
    ];

    /** Stored generated columns, in table order: backed up, never inserted. */
    public const GENERATED = [
        'payroll_plans' => ['live_key'],
        'supplemental_payrolls' => ['open_key'],
    ];

    private const INSERT_SQL = [
        'companies' => 'INSERT INTO companies (id, created_at) VALUES (:id, :created_at)',
        'users' => 'INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (:id, :email, :password_hash, :status, :created_at, :updated_at)',
        'employees' => 'INSERT INTO employees (id, company_id, employee_code, full_name, job_title, department, employment_status, join_date, contact_email, phone, notes, monthly_base_salary, archived_at, version, created_at, updated_at) VALUES (:id, :company_id, :employee_code, :full_name, :job_title, :department, :employment_status, :join_date, :contact_email, :phone, :notes, :monthly_base_salary, :archived_at, :version, :created_at, :updated_at)',
        'memberships' => 'INSERT INTO memberships (id, user_id, company_id, role, employee_id, status, created_at, updated_at) VALUES (:id, :user_id, :company_id, :role, :employee_id, :status, :created_at, :updated_at)',
        'auth_events' => 'INSERT INTO auth_events (id, occurred_at, event, user_id, membership_id, email_hash, ip, request_id) VALUES (:id, :occurred_at, :event, :user_id, :membership_id, :email_hash, :ip, :request_id)',
        'audit_events' => 'INSERT INTO audit_events (id, company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (:id, :company_id, :occurred_at, :actor_user_id, :actor_membership_id, :action, :entity, :entity_id, :operation, :target_user_id, :request_id, :fields)',
        'overtime_records' => 'INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at, valuation_method, valuation_salary, valuation_standard_hours, approved_amount, approved_at) VALUES (:id, :company_id, :employee_id, :month_key, :overtime_date, :hours, :work_description, :notes, :status, :version, :created_at, :updated_at, :valuation_method, :valuation_salary, :valuation_standard_hours, :approved_amount, :approved_at)',
        'payroll_plans' => 'INSERT INTO payroll_plans (id, company_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at) VALUES (:id, :company_id, :employee_id, :month_key, :status, :employee_code_snapshot, :employee_name_snapshot, :department_snapshot, :base_salary, :overtime_amount, :overtime_hours, :overtime_count, :total_amount, :calculated_at, :committed_at, :commit_idempotency_key, :version, :created_at, :updated_at)',
        'payroll_plan_overtime' => 'INSERT INTO payroll_plan_overtime (id, company_id, payroll_plan_id, created_at) VALUES (:id, :company_id, :payroll_plan_id, :created_at)',
        'supplemental_payrolls' => 'INSERT INTO supplemental_payrolls (id, company_id, payroll_plan_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, overtime_amount, overtime_hours, overtime_count, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at) VALUES (:id, :company_id, :payroll_plan_id, :employee_id, :month_key, :status, :employee_code_snapshot, :employee_name_snapshot, :department_snapshot, :overtime_amount, :overtime_hours, :overtime_count, :calculated_at, :committed_at, :commit_idempotency_key, :version, :created_at, :updated_at)',
        'supplemental_payroll_overtime' => 'INSERT INTO supplemental_payroll_overtime (id, company_id, supplemental_payroll_id, created_at) VALUES (:id, :company_id, :supplemental_payroll_id, :created_at)',
        'finance_postings' => 'INSERT INTO finance_postings (id, company_id, source_kind, payroll_plan_id, supplemental_payroll_id, employee_id, month_key, amount, status, idempotency_key, posted_at) VALUES (:id, :company_id, :source_kind, :payroll_plan_id, :supplemental_payroll_id, :employee_id, :month_key, :amount, :status, :idempotency_key, :posted_at)',
        'finance_executions' => 'INSERT INTO finance_executions (id, company_id, finance_posting_id, employee_id, month_key, amount, executed_on, payment_method, idempotency_key, recorded_at) VALUES (:id, :company_id, :finance_posting_id, :employee_id, :month_key, :amount, :executed_on, :payment_method, :idempotency_key, :recorded_at)',
    ];

    private const LOCK_EMPTY_SQL = [
        'companies' => 'SELECT 1 AS present FROM companies LIMIT 1 LOCK IN SHARE MODE',
        'users' => 'SELECT 1 AS present FROM users LIMIT 1 LOCK IN SHARE MODE',
        'employees' => 'SELECT 1 AS present FROM employees LIMIT 1 LOCK IN SHARE MODE',
        'memberships' => 'SELECT 1 AS present FROM memberships LIMIT 1 LOCK IN SHARE MODE',
        'auth_events' => 'SELECT 1 AS present FROM auth_events LIMIT 1 LOCK IN SHARE MODE',
        'audit_events' => 'SELECT 1 AS present FROM audit_events LIMIT 1 LOCK IN SHARE MODE',
        'overtime_records' => 'SELECT 1 AS present FROM overtime_records LIMIT 1 LOCK IN SHARE MODE',
        'payroll_plans' => 'SELECT 1 AS present FROM payroll_plans LIMIT 1 LOCK IN SHARE MODE',
        'payroll_plan_overtime' => 'SELECT 1 AS present FROM payroll_plan_overtime LIMIT 1 LOCK IN SHARE MODE',
        'supplemental_payrolls' => 'SELECT 1 AS present FROM supplemental_payrolls LIMIT 1 LOCK IN SHARE MODE',
        'supplemental_payroll_overtime' => 'SELECT 1 AS present FROM supplemental_payroll_overtime LIMIT 1 LOCK IN SHARE MODE',
        'finance_postings' => 'SELECT 1 AS present FROM finance_postings LIMIT 1 LOCK IN SHARE MODE',
        'finance_executions' => 'SELECT 1 AS present FROM finance_executions LIMIT 1 LOCK IN SHARE MODE',
        'account_tokens' => 'SELECT 1 AS present FROM account_tokens LIMIT 1 LOCK IN SHARE MODE',
        'auth_rate_limits' => 'SELECT 1 AS present FROM auth_rate_limits LIMIT 1 LOCK IN SHARE MODE',
        'mail_outbox' => 'SELECT 1 AS present FROM mail_outbox LIMIT 1 LOCK IN SHARE MODE',
        'sessions' => 'SELECT 1 AS present FROM sessions LIMIT 1 LOCK IN SHARE MODE',
    ];

    private const EMPTY_SQL = [
        'account_tokens' => 'SELECT 1 AS present FROM account_tokens LIMIT 1',
        'auth_rate_limits' => 'SELECT 1 AS present FROM auth_rate_limits LIMIT 1',
        'mail_outbox' => 'SELECT 1 AS present FROM mail_outbox LIMIT 1',
        'sessions' => 'SELECT 1 AS present FROM sessions LIMIT 1',
    ];

    private const GENERATED_SQL = "SELECT TABLE_NAME AS tbl, COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND IS_GENERATED <> 'NEVER' ORDER BY TABLE_NAME, ORDINAL_POSITION";
    private const AUTO_INCREMENT_SQL = 'SELECT TABLE_NAME AS tbl, AUTO_INCREMENT AS next FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND AUTO_INCREMENT IS NOT NULL ORDER BY TABLE_NAME';

    public function __construct(private readonly Database $db)
    {
    }

    /** A new, not yet opened connection to the configured target. @throws \TamOs\Data\DatabaseError when the db section is missing or invalid */
    public static function fromConfig(Config $config): self
    {
        return new self(new Database(DatabaseConfig::fromConfig($config)));
    }

    /** The configured target's non-secret fingerprint (host, port and name), as a backup records its source. */
    public static function fingerprintOf(Config $config): string
    {
        $db = DatabaseConfig::fromConfig($config);
        return BackupReader::fingerprint($db->host, $db->port, $db->name);
    }

    /** The backup reader on this same connection, so it sees this restore's uncommitted rows. */
    public function reader(string $fingerprint): BackupReader
    {
        return BackupReader::fromDatabase($this->db, $fingerprint);
    }

    /**
     * Runs $fn in one read-write InnoDB transaction on this connection; any throwable rolls back.
     *
     * @template T
     * @param \Closure(Database): T $fn
     * @return T
     */
    public function transaction(\Closure $fn): mixed
    {
        return $this->db->transaction($fn);
    }

    /**
     * Runs $fn in one read-only REPEATABLE READ snapshot on this connection.
     *
     * @template T
     * @param \Closure(Database): T $fn
     * @return T
     */
    public function snapshot(\Closure $fn): mixed
    {
        return $this->db->snapshot($fn);
    }

    /**
     * Whether every classified table — backed up and excluded — holds no row. Inside a transaction
     * the reads lock: no other connection can insert into these tables until it ends.
     */
    public function isEmpty(): bool
    {
        self::requireCoverage();
        foreach (self::LOCK_EMPTY_SQL as $sql) {
            if ($this->db->select($sql) !== []) {
                return false;
            }
        }
        return true;
    }

    /** Whether the excluded tables hold no row (a non-locking read, for verification). */
    public function excludedEmpty(): bool
    {
        foreach (self::EMPTY_SQL as $sql) {
            if ($this->db->select($sql) !== []) {
                return false;
            }
        }
        return true;
    }

    /**
     * Inserts one backed-up row: $row maps every column of the backup's table header to its value
     * (int, string or null, exactly as backed up); generated columns are left to the server.
     *
     * @param array<string, int|string|null> $row
     */
    public function insert(string $table, array $row): void
    {
        $sql = self::INSERT_SQL[$table] ?? throw new \LogicException('not a restored table');
        $params = [];
        foreach (self::COLUMNS[$table] as $column) {
            if (!array_key_exists($column, $row)) {
                throw new \LogicException('a restored row carries every stored column');
            }
            $params[$column] = $row[$column];
        }
        if (count($row) !== count($params) + count(self::GENERATED[$table] ?? [])) {
            throw new \LogicException('a restored row carries only the table columns');
        }
        $this->db->execute($sql, $params);
    }

    /** @return array<string, list<string>> table => its generated columns, in table order */
    public function generatedColumns(): array
    {
        $out = [];
        foreach ($this->db->select(self::GENERATED_SQL) as $row) {
            $out[(string) $row['tbl']][] = (string) $row['name'];
        }
        return $out;
    }

    /** @return array<string, int> table => its next auto-increment value */
    public function autoIncrements(): array
    {
        $out = [];
        foreach ($this->db->select(self::AUTO_INCREMENT_SQL) as $row) {
            $out[(string) $row['tbl']] = (int) $row['next'];
        }
        return $out;
    }

    /** @throws \LogicException unless the statements cover exactly the classified tables */
    public static function requireCoverage(): void
    {
        $classified = [...BackupTables::INCLUDED, ...BackupTables::EXCLUDED];
        if (array_keys(self::INSERT_SQL) !== BackupTables::INCLUDED || array_keys(self::COLUMNS) !== BackupTables::INCLUDED
            || array_keys(self::LOCK_EMPTY_SQL) !== $classified || array_keys(self::EMPTY_SQL) !== BackupTables::EXCLUDED) {
            throw new \LogicException('the restore statements cover exactly the classified tables, in order');
        }
    }
}
