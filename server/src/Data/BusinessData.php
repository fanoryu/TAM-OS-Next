<?php
declare(strict_types=1);

namespace TamOs\Data;

use TamOs\Data\Audit\AuditLog;
use TamOs\Data\Employee\EmployeeStore;
use TamOs\Data\Scope\ScopedDatabase;

/**
 * The business data access point (BF-4a1): the scoped business stores over one lazily opened,
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
    private ?AuditLog $audit = null;

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

    public function audit(): AuditLog
    {
        return $this->audit ??= new AuditLog($this->scoped());
    }

    /**
     * Runs $fn in one database transaction: a business write and its audit row commit together
     * or not at all. Nested calls are refused (Database::transaction).
     *
     * @template T
     * @param \Closure(): T $fn
     * @return T
     */
    public function atomically(\Closure $fn): mixed
    {
        return $this->db()->transaction(static fn (): mixed => $fn());
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
