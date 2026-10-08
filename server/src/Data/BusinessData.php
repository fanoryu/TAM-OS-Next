<?php
declare(strict_types=1);

namespace TamOs\Data;

use TamOs\Data\Audit\AuditEventStore;
use TamOs\Data\Audit\AuditLog;
use TamOs\Data\Employee\EmployeeStore;
use TamOs\Data\Finance\FinanceExecutionStore;
use TamOs\Data\Finance\FinancePostingStore;
use TamOs\Data\Overtime\OvertimeStore;
use TamOs\Data\Payroll\PayrollStore;
use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Data\Supplemental\SupplementalStore;

/**
 * The business data access point (BF-4a1; overtime BF-4b1; payroll BF-4c1; supplemental payroll BF-4d; Finance posting BF-4e; Finance execution BF-4f; the CEO audit read BF-4g): the scoped business stores over one lazily opened,
 * request-scoped connection — shared with TamOs\Data\Auth\AuthData in production, so the
 * session lookup and the business statements of a request use the same connection — and
 * atomically() for the transaction boundaries the business services own. The stores receive
 * only ScopedDatabase, never this connection. Nothing connects until a store is first used.
 */
final class BusinessData
{
    private ?Database $db = null;
    private ?ScopedDatabase $scoped = null;
    private ?EmployeeStore $employees = null;
    private ?OvertimeStore $overtime = null;
    private ?PayrollStore $payroll = null;
    private ?SupplementalStore $supplemental = null;
    private ?FinancePostingStore $finance = null;
    private ?FinanceExecutionStore $financeExecutions = null;
    private ?AuditLog $audit = null;
    private ?AuditEventStore $auditEvents = null;

    /** @param \Closure(): Database $connect */
    private function __construct(private readonly \Closure $connect)
    {
    }

    /** @param \Closure(): Database $connect */
    public static function fromConnector(\Closure $connect): self
    {
        return new self($connect);
    }

    /** For the guarded database tests, which share their connection with the fixtures. */
    public static function fromDatabase(Database $db): self
    {
        return new self(static fn (): Database => $db);
    }

    public function employees(): EmployeeStore
    {
        return $this->employees ??= new EmployeeStore($this->scoped());
    }

    public function overtime(): OvertimeStore
    {
        return $this->overtime ??= new OvertimeStore($this->scoped());
    }

    public function payroll(): PayrollStore
    {
        return $this->payroll ??= new PayrollStore($this->scoped());
    }

    public function supplemental(): SupplementalStore
    {
        return $this->supplemental ??= new SupplementalStore($this->scoped());
    }

    public function finance(): FinancePostingStore
    {
        return $this->finance ??= new FinancePostingStore($this->scoped());
    }

    public function financeExecutions(): FinanceExecutionStore
    {
        return $this->financeExecutions ??= new FinanceExecutionStore($this->scoped());
    }

    public function audit(): AuditLog
    {
        return $this->audit ??= new AuditLog($this->scoped());
    }

    /** BF-4g: the read-only CEO audit read; AuditLog stays the only writer of audit_events. */
    public function auditEvents(): AuditEventStore
    {
        return $this->auditEvents ??= new AuditEventStore($this->scoped());
    }

    /**
     * Runs $fn in one database transaction: a business write and its audit row commit together
     * or not at all. Nested calls are refused (Database::transaction). $readCommitted runs that
     * one transaction at READ COMMITTED (payroll generate and commit, BF-4c1/BF-4c2; Supplemental
     * Payroll generate and commit, BF-4d; a Finance posting, BF-4e; a Finance execution, BF-4f).
     *
     * @template T
     * @param \Closure(): T $fn
     * @return T
     */
    public function atomically(\Closure $fn, bool $readCommitted = false): mixed
    {
        return $this->db()->transaction(static fn (): mixed => $fn(), $readCommitted);
    }

    private function scoped(): ScopedDatabase
    {
        return $this->scoped ??= new ScopedDatabase($this->db());
    }

    private function db(): Database
    {
        return $this->db ??= ($this->connect)();
    }
}
