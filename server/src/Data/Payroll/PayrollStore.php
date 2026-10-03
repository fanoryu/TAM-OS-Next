<?php
declare(strict_types=1);

namespace TamOs\Data\Payroll;

use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Data\Scope\ScopedRecord;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Scope;

/**
 * The server payroll plan (BF-4c1, migrations 0024–0025): one plan per employee and month —
 * Base Salary + Approved Overtime, calculated by the server — and the record of which Approved
 * overtime contributed to it. CEO company scope only in this slice: there is no *_SELF_SQL, so
 * ScopedDatabase refuses every statement here under an Employee scope (the Employee's read of their
 * own Committed plan is BF-4c2).
 *
 * The one writer of payroll_plans and payroll_plan_overtime. Writes are compare-and-swap on
 * `version` against the record the caller authorized, and every UPDATE names the pre-commit status
 * it expects, so no statement here can change a Committed or a Cancelled plan, and none writes
 * 'Committed' (Commit is BF-4c2). There is no DELETE of a plan. A link row's id is the overtime
 * record it consumes, so the primary key makes double consumption impossible; links are written
 * at calculation, replaced when a Draft is recalculated and released when a plan is cancelled —
 * the link DELETE itself requires its plan to be pre-commit, so a Committed plan's links freeze.
 *
 * Overtime is READ only: the Approved records of the month with their frozen approved_amount,
 * never a valuation input, never written, never locked. Generate runs at READ COMMITTED and follows
 * the global order employee → overtime → payroll_plan → payroll_plan_overtime (the audit row
 * follows). It locks rows by primary key only, one by one in id order — never a secondary-index
 * range, which would cycle with an overtime create's foreign-key check or a plan cancel's live-key
 * update: every employee of the company first (an overtime approval locks its employee before its
 * record, so holding the employee locks freezes the month's Approved set, and Approved is
 * terminal), then reads that Approved set, then locks the month's live plans, then reads their
 * links (a cancel releases links only under its plan lock). Under READ COMMITTED each plain read
 * sees everything committed before it, i.e. before the locks it follows.
 */
final class PayrollStore
{
    public const ENTITY = 'payrollPlan';

    /** The plan columns a create or recalculation writes, in column order. */
    public const VALUES = ['employee_code_snapshot', 'employee_name_snapshot', 'department_snapshot', 'base_salary', 'overtime_amount', 'overtime_hours', 'overtime_count', 'total_amount'];

    /** A month list, an employee lock or an overtime lock fails closed above this many rows (read with LIST_LIMIT). */
    public const LIST_CAP = 2000;
    public const LIST_LIMIT = 2001;

    // Anchor read: id, company, owner and status — the record a Policy decision needs.
    public const FIND_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, status FROM payroll_plans WHERE id = :id AND company_id = :company_id';

    // Plan reads (CEO company scope).
    public const RECORD_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, version FROM payroll_plans WHERE id = :id AND company_id = :company_id';
    public const MONTH_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, version FROM payroll_plans WHERE company_id = :company_id AND month_key = :month_key ORDER BY employee_code_snapshot, employee_id, created_at, id LIMIT 2001';
    public const LIVE_MONTH_SQL = "SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, version FROM payroll_plans WHERE company_id = :company_id AND month_key = :month_key AND status <> 'Cancelled' ORDER BY employee_code_snapshot, employee_id, id LIMIT 2001";
    // The contributing overtime of one plan: its frozen amounts, through the plan's own links.
    public const PLAN_OVERTIME_SQL = "SELECT o.id, o.company_id, o.employee_id AS owner_employee_id, o.hours, o.approved_amount FROM payroll_plan_overtime l JOIN overtime_records o ON o.company_id = l.company_id AND o.id = l.id WHERE l.company_id = :company_id AND l.payroll_plan_id = :payroll_plan_id AND o.status = 'Approved' ORDER BY o.id";

    // Generate, in the global lock order: ids by a plain read, then each row locked by primary key.
    public const EMPLOYEE_IDS_SQL = 'SELECT id, company_id, id AS owner_employee_id FROM employees WHERE company_id = :company_id ORDER BY id LIMIT 2001';
    public const LOCK_EMPLOYEE_SQL = 'SELECT id, company_id, id AS owner_employee_id, employee_code, full_name, department, employment_status, monthly_base_salary, archived_at FROM employees WHERE id = :employee_id AND company_id = :company_id FOR UPDATE';
    public const APPROVED_OVERTIME_SQL = "SELECT id, company_id, employee_id AS owner_employee_id, employee_id, hours, approved_amount FROM overtime_records WHERE company_id = :company_id AND month_key = :month_key AND status = 'Approved' ORDER BY employee_id, id LIMIT 2001";
    public const LIVE_PLAN_IDS_SQL = "SELECT id, company_id, employee_id AS owner_employee_id FROM payroll_plans WHERE company_id = :company_id AND month_key = :month_key AND status <> 'Cancelled' ORDER BY id LIMIT 2001";
    public const LOCK_PLAN_ROW_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, version FROM payroll_plans WHERE id = :plan_id AND company_id = :company_id FOR UPDATE';
    public const MONTH_LINKS_SQL = 'SELECT l.id, l.company_id, p.employee_id AS owner_employee_id, l.payroll_plan_id FROM payroll_plan_overtime l JOIN payroll_plans p ON p.company_id = l.company_id AND p.id = l.payroll_plan_id WHERE l.company_id = :company_id AND p.month_key = :month_key ORDER BY l.id';
    // A transition's lock of the one plan it was authorized on.
    public const LOCK_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, status, version FROM payroll_plans WHERE id = :id AND company_id = :company_id FOR UPDATE';

    // Writes. A new plan is always a version 1 Draft; its owner comes from the authorized candidate.
    public const CREATE_SQL = "INSERT INTO payroll_plans (id, company_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, calculated_at, committed_at, version, created_at, updated_at) VALUES (:id, :company_id, :employee_id, :month_key, 'Draft', :employee_code_snapshot, :employee_name_snapshot, :department_snapshot, :base_salary, :overtime_amount, :overtime_hours, :overtime_count, :total_amount, UTC_TIMESTAMP(6), NULL, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))";
    public const RECALCULATE_SQL = "UPDATE payroll_plans SET employee_code_snapshot = :employee_code_snapshot, employee_name_snapshot = :employee_name_snapshot, department_snapshot = :department_snapshot, base_salary = :base_salary, overtime_amount = :overtime_amount, overtime_hours = :overtime_hours, overtime_count = :overtime_count, total_amount = :total_amount, calculated_at = UTC_TIMESTAMP(6), version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Draft'";
    public const TRANSITION_SQL = "UPDATE payroll_plans SET status = :to_status, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = :from_status AND status IN ('Draft', 'Reviewed', 'Ready')";
    public const LINK_SQL = 'INSERT INTO payroll_plan_overtime (id, company_id, payroll_plan_id, created_at) VALUES (:overtime_id, :company_id, :id, UTC_TIMESTAMP(6))';
    public const UNLINK_SQL = "DELETE FROM payroll_plan_overtime WHERE company_id = :company_id AND payroll_plan_id = :id AND EXISTS (SELECT 1 FROM payroll_plans p WHERE p.company_id = payroll_plan_overtime.company_id AND p.id = payroll_plan_overtime.payroll_plan_id AND p.status IN ('Draft', 'Reviewed', 'Ready'))";

    public function __construct(private readonly ScopedDatabase $db)
    {
    }

    /** The plan with this id the scope can see, or null (absent and out of scope alike). */
    public function find(Scope $scope, string $id): ?ScopedRecord
    {
        self::companyOnly($scope);
        return $this->db->find($scope, self::ENTITY, self::FIND_SQL, ['id' => $id]);
    }

    /** The create candidate for a new Draft of the employee record $employee (read in scope). */
    public function candidate(ScopedRecord $employee, string $id): ScopedRecord
    {
        return $this->db->candidate($employee, self::ENTITY, $id, 'Draft');
    }

    /** The period a generate is authorized against: the scope and the month, nothing else. */
    public function periodCandidate(Scope $scope, string $monthKey): ScopedRecord
    {
        return $this->db->periodCandidate($scope, self::ENTITY, $monthKey);
    }

    /** @return array<string, mixed>|null the plan, or null */
    public function record(Scope $scope, string $id): ?array
    {
        self::companyOnly($scope);
        return $this->db->select($scope, self::RECORD_SQL, ['id' => $id])[0] ?? null;
    }

    /**
     * Every plan of one month, Cancelled included — at most LIST_LIMIT rows, so a caller can tell
     * that LIST_CAP was exceeded.
     *
     * @return list<array<string, mixed>>
     */
    public function month(Scope $scope, string $monthKey): array
    {
        self::companyOnly($scope);
        return $this->db->select($scope, self::MONTH_SQL, ['month_key' => $monthKey]);
    }

    /** @return list<array<string, mixed>> the month's live (non-Cancelled) plans, at most LIST_LIMIT */
    public function livePlans(Scope $scope, string $monthKey): array
    {
        self::companyOnly($scope);
        return $this->db->select($scope, self::LIVE_MONTH_SQL, ['month_key' => $monthKey]);
    }

    /** @return list<array<string, mixed>> the overtime that contributed to one plan, with its frozen amounts */
    public function overtimeOf(Scope $scope, string $planId): array
    {
        self::companyOnly($scope);
        return $this->db->select($scope, self::PLAN_OVERTIME_SQL, ['payroll_plan_id' => $planId]);
    }

    /**
     * Generate, step 1: the company's employee ids, in id order — at most LIST_LIMIT rows.
     *
     * @return list<string>
     */
    public function employeeIds(Authorization $period): array
    {
        return array_map(static fn (array $r): string => (string) $r['id'], $this->db->select(self::period($period)->scope, self::EMPLOYEE_IDS_SQL));
    }

    /**
     * Generate, step 2: locks one employee by primary key and returns its current inputs, or null
     * when it no longer exists in the company.
     *
     * @return array<string, mixed>|null
     */
    public function lockEmployee(Authorization $period, string $employeeId): ?array
    {
        return $this->db->select(self::period($period)->scope, self::LOCK_EMPLOYEE_SQL, ['employee_id' => $employeeId])[0] ?? null;
    }

    /**
     * Generate, step 3: the month's Approved overtime with its frozen amounts — at most LIST_LIMIT
     * rows. Read after the employee locks, which freeze it; never locked itself.
     *
     * @return list<array<string, mixed>>
     */
    public function approvedOvertime(Authorization $period): array
    {
        $auth = self::period($period);
        return $this->db->select($auth->scope, self::APPROVED_OVERTIME_SQL, ['month_key' => (string) $auth->record?->id]);
    }

    /**
     * Generate, step 4: the ids of the month's live plans — at most LIST_LIMIT rows.
     *
     * @return list<string>
     */
    public function livePlanIds(Authorization $period): array
    {
        $auth = self::period($period);
        return array_map(static fn (array $r): string => (string) $r['id'], $this->db->select($auth->scope, self::LIVE_PLAN_IDS_SQL, ['month_key' => (string) $auth->record?->id]));
    }

    /**
     * Generate, step 5: locks one plan by primary key and returns it as it is now, or null.
     *
     * @return array<string, mixed>|null
     */
    public function lockPlanRow(Authorization $period, string $planId): ?array
    {
        return $this->db->select(self::period($period)->scope, self::LOCK_PLAN_ROW_SQL, ['plan_id' => $planId])[0] ?? null;
    }

    /**
     * Generate, step 6: the month's overtime links, read after the plan locks.
     *
     * @return list<array<string, mixed>>
     */
    public function monthLinks(Authorization $period): array
    {
        $auth = self::period($period);
        return $this->db->select($auth->scope, self::MONTH_LINKS_SQL, ['month_key' => (string) $auth->record?->id]);
    }

    /**
     * Locks and returns the plan the authorization was decided on. Must run inside a transaction.
     *
     * @return array<string, mixed>|null
     */
    public function lock(Authorization $auth): ?array
    {
        $record = self::authorized($auth);
        return $this->db->select($auth->scope, self::LOCK_SQL, ['id' => $record->id])[0] ?? null;
    }

    /**
     * Inserts the authorized candidate as a version 1 Draft of $monthKey.
     *
     * @param array<string, int|string|null> $values exactly the VALUES columns
     */
    public function create(Authorization $auth, string $monthKey, array $values): void
    {
        $record = self::authorized($auth);
        if ($record->status !== 'Draft' || $record->ownerEmployeeId === null) {
            throw new \LogicException('a payroll plan is created only as an authorized Draft candidate of an employee');
        }
        $this->db->execute($auth, self::CREATE_SQL, ['id' => $record->id, 'employee_id' => $record->ownerEmployeeId, 'month_key' => $monthKey] + self::values($values));
    }

    /**
     * Replaces the calculation of the authorized Draft when its version still matches.
     *
     * @param array<string, int|string|null> $values exactly the VALUES columns
     * @return int 1 when written; 0 when the version moved or it is no longer a Draft
     */
    public function recalculate(Authorization $auth, int $expectedVersion, array $values): int
    {
        return $this->db->execute($auth, self::RECALCULATE_SQL, ['id' => self::authorized($auth)->id, 'expected_version' => $expectedVersion] + self::values($values));
    }

    /** @return int 1 when the status moved from $from to $to; 0 when the version or status moved */
    public function transition(Authorization $auth, int $expectedVersion, string $from, string $to): int
    {
        if (!in_array($from, ['Draft', 'Reviewed', 'Ready'], true) || !in_array($to, ['Draft', 'Reviewed', 'Ready', 'Cancelled'], true)) {
            throw new \LogicException('a payroll transition starts before commit and never reaches Committed');
        }
        return $this->db->execute($auth, self::TRANSITION_SQL, ['id' => self::authorized($auth)->id, 'expected_version' => $expectedVersion, 'from_status' => $from, 'to_status' => $to]);
    }

    /**
     * Records the overtime that contributed to the authorized plan. A record already linked to any
     * plan is refused by the primary key (double consumption is a database error, never a merge).
     *
     * @param list<string> $overtimeIds
     */
    public function link(Authorization $auth, array $overtimeIds): void
    {
        $record = self::authorized($auth);
        foreach ($overtimeIds as $overtimeId) {
            if (!is_string($overtimeId) || preg_match('/^[0-9a-f]{32}$/', $overtimeId) !== 1) {
                throw new \LogicException('an overtime link names an overtime record id');
            }
            $this->db->execute($auth, self::LINK_SQL, ['id' => $record->id, 'overtime_id' => $overtimeId]);
        }
    }

    /** Releases every overtime link of the authorized plan while it is pre-commit; returns the count. */
    public function unlink(Authorization $auth): int
    {
        return $this->db->execute($auth, self::UNLINK_SQL, ['id' => self::authorized($auth)->id]);
    }

    private static function companyOnly(Scope $scope): void
    {
        if ($scope->isSelf()) {
            throw new \LogicException('payroll plans are read only in company scope in BF-4c1');
        }
    }

    /** The plan a write or lock was authorized on, under payroll.manage in company scope. */
    private static function authorized(Authorization $auth): ScopedRecord
    {
        $record = $auth->record ?? throw new \LogicException('a payroll write needs the authorized plan');
        if ($auth->action !== Action::PayrollManage || $auth->scope->isSelf() || $record->entity !== self::ENTITY
            || preg_match('/^[0-9a-f]{32}$/', $record->id) !== 1) {
            throw new \LogicException('a payroll write needs a payroll plan authorized under payroll.manage, in company scope');
        }
        return $record;
    }

    /** The period a generate lock was authorized on, under payroll.manage in company scope. */
    private static function period(Authorization $auth): Authorization
    {
        $record = $auth->record;
        if ($auth->action !== Action::PayrollManage || $auth->scope->isSelf() || $record === null || $record->entity !== self::ENTITY
            || $record->ownerEmployeeId !== null || preg_match('/^[0-9]{4}-(0[1-9]|1[0-2])$/', $record->id) !== 1) {
            throw new \LogicException('a payroll period lock needs a period authorized under payroll.manage, in company scope');
        }
        return $auth;
    }

    /**
     * @param array<string, int|string|null> $values
     * @return array<string, int|string|null>
     */
    private static function values(array $values): array
    {
        if (array_keys($values) !== self::VALUES) {
            throw new \LogicException('a payroll write takes exactly the plan values, in order');
        }
        return $values;
    }
}
