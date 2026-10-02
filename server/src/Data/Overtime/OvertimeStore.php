<?php
declare(strict_types=1);

namespace TamOs\Data\Overtime;

use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Data\Scope\ScopedRecord;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Scope;

/**
 * The server overtime record (BF-4b1, migration 0020): the non-money overtime workflow — an
 * employee's hours for a month, Draft → Submitted → Reviewed, or Rejected. Company-owned and
 * self-scoped like EmployeeStore: every statement names :company_id, and every *_SELF_SQL variant
 * also binds the owner to :self_employee_id, so an Employee principal reads and writes only rows
 * of their own employee record. ScopedDatabase injects both and refuses the wrong variant.
 *
 * Writes are compare-and-swap on `version` against the record the caller loaded in scope, and
 * every write names the status it expects, so a stale or concurrent change matches no row. The
 * hard delete removes a Draft only (owner decision D-BF4b-6) — the DELETE itself carries the
 * Draft, version and scope predicates (tools/verify-backend-boundary.js). Valuation, approval
 * and payroll state belong to BF-4b2 and later; this store holds no money.
 *
 * The employee row an overtime record is created for is locked first (lock order: employee →
 * overtime), so a create serializes with an archive or an employment-status change of it.
 */
final class OvertimeStore
{
    public const ENTITY = 'overtime';

    /** Record columns a create or update writes, in column order. */
    public const RECORD = ['month_key', 'overtime_date', 'hours', 'work_description', 'notes'];

    /** A month list fails closed above this many entitled rows (read with LIST_LIMIT, never truncated). */
    public const LIST_CAP = 2000;
    public const LIST_LIMIT = 2001;

    // Anchor reads: id, company, owner and status — the record a Policy decision needs.
    public const FIND_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, status FROM overtime_records WHERE id = :id AND company_id = :company_id';
    public const FIND_SELF_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, status FROM overtime_records WHERE id = :id AND company_id = :company_id AND employee_id = :self_employee_id';

    // Record reads. The month list is the only collection (owner decision D-BF4b1-3).
    public const RECORD_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version FROM overtime_records WHERE id = :id AND company_id = :company_id';
    public const RECORD_SELF_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version FROM overtime_records WHERE id = :id AND company_id = :company_id AND employee_id = :self_employee_id';
    public const MONTH_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version FROM overtime_records WHERE company_id = :company_id AND month_key = :month_key ORDER BY overtime_date DESC, id LIMIT 2001';
    public const MONTH_SELF_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version FROM overtime_records WHERE company_id = :company_id AND month_key = :month_key AND employee_id = :self_employee_id ORDER BY overtime_date DESC, id LIMIT 2001';
    public const LOCK_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version FROM overtime_records WHERE id = :id AND company_id = :company_id FOR UPDATE';
    public const LOCK_SELF_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version FROM overtime_records WHERE id = :id AND company_id = :company_id AND employee_id = :self_employee_id FOR UPDATE';

    // The employee a create is for, locked inside the create transaction: its archive and
    // employment status decide eligibility.
    public const LOCK_EMPLOYEE_SQL = 'SELECT id, company_id, id AS owner_employee_id, employment_status, archived_at FROM employees WHERE id = :employee_id AND company_id = :company_id FOR UPDATE';
    public const LOCK_EMPLOYEE_SELF_SQL = 'SELECT id, company_id, id AS owner_employee_id, employment_status, archived_at FROM employees WHERE id = :employee_id AND company_id = :company_id AND id = :self_employee_id FOR UPDATE';

    // Writes. A new record is always a version 1 Draft; the owner comes from the authorized
    // candidate (CEO) or the scope itself (Employee), never from the request.
    public const CREATE_SQL = "INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at) VALUES (:id, :company_id, :employee_id, :month_key, :overtime_date, :hours, :work_description, :notes, 'Draft', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))";
    public const CREATE_SELF_SQL = "INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at) VALUES (:id, :company_id, :self_employee_id, :month_key, :overtime_date, :hours, :work_description, :notes, 'Draft', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))";
    public const UPDATE_SQL = "UPDATE overtime_records SET month_key = :month_key, overtime_date = :overtime_date, hours = :hours, work_description = :work_description, notes = :notes, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Draft'";
    public const UPDATE_SELF_SQL = "UPDATE overtime_records SET month_key = :month_key, overtime_date = :overtime_date, hours = :hours, work_description = :work_description, notes = :notes, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND employee_id = :self_employee_id AND version = :expected_version AND status = 'Draft'";
    public const TRANSITION_SQL = 'UPDATE overtime_records SET status = :to_status, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = :from_status';
    public const TRANSITION_SELF_SQL = 'UPDATE overtime_records SET status = :to_status, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND employee_id = :self_employee_id AND version = :expected_version AND status = :from_status';
    public const DELETE_DRAFT_SQL = "DELETE FROM overtime_records WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Draft'";
    public const DELETE_DRAFT_SELF_SQL = "DELETE FROM overtime_records WHERE id = :id AND company_id = :company_id AND employee_id = :self_employee_id AND version = :expected_version AND status = 'Draft'";

    public function __construct(private readonly ScopedDatabase $db)
    {
    }

    /** The record with this id the scope can see, or null (absent and out of scope alike). */
    public function find(Scope $scope, string $id): ?ScopedRecord
    {
        return $this->db->find($scope, self::ENTITY, $scope->isSelf() ? self::FIND_SELF_SQL : self::FIND_SQL, ['id' => $id]);
    }

    /**
     * The create candidate for a new Draft of the employee record $employee (read in scope).
     */
    public function candidate(ScopedRecord $employee, string $id): ScopedRecord
    {
        return $this->db->candidate($employee, self::ENTITY, $id, 'Draft');
    }

    /** @return array<string, mixed>|null the record the scope can see, or null */
    public function record(Scope $scope, string $id): ?array
    {
        $rows = $this->db->select($scope, $scope->isSelf() ? self::RECORD_SELF_SQL : self::RECORD_SQL, ['id' => $id]);
        return $rows[0] ?? null;
    }

    /**
     * The scope's records of one month, newest date first (undated last), then id — at most
     * LIST_LIMIT rows, so a caller can tell that LIST_CAP was exceeded.
     *
     * @return list<array<string, mixed>>
     */
    public function month(Scope $scope, string $monthKey): array
    {
        return $this->db->select($scope, $scope->isSelf() ? self::MONTH_SELF_SQL : self::MONTH_SQL, ['month_key' => $monthKey]);
    }

    /**
     * Locks and returns the record the authorization was decided on. Must run inside a transaction.
     *
     * @return array<string, mixed>|null
     */
    public function lock(Authorization $auth): ?array
    {
        $record = self::authorized($auth);
        $rows = $this->db->select($auth->scope, $auth->scope->isSelf() ? self::LOCK_SELF_SQL : self::LOCK_SQL, ['id' => $record->id]);
        return $rows[0] ?? null;
    }

    /**
     * Locks the employee row a create candidate belongs to and returns its eligibility facts, or
     * null. Must run inside the create transaction, before the insert.
     *
     * @return array{employmentStatus: string, archived: bool}|null
     */
    public function lockEmployee(Authorization $auth): ?array
    {
        if ($auth->action !== Action::OvertimeCreateSelfDraft || $auth->record === null || $auth->record->ownerEmployeeId === null) {
            throw new \LogicException('the employee is locked only for an authorized overtime create');
        }
        $sql = $auth->scope->isSelf() ? self::LOCK_EMPLOYEE_SELF_SQL : self::LOCK_EMPLOYEE_SQL;
        $rows = $this->db->select($auth->scope, $sql, ['employee_id' => $auth->record->ownerEmployeeId]);
        if ($rows === []) {
            return null;
        }
        return ['employmentStatus' => (string) $rows[0]['employment_status'], 'archived' => $rows[0]['archived_at'] !== null];
    }

    /**
     * Inserts the authorized candidate as a version 1 Draft.
     *
     * @param array<string, string|null> $record exactly the RECORD columns
     */
    public function create(Authorization $auth, array $record): void
    {
        if ($auth->action !== Action::OvertimeCreateSelfDraft || $auth->record === null || $auth->record->status !== 'Draft') {
            throw new \LogicException('overtime is created only under overtime.createSelfDraft, as a Draft candidate');
        }
        $params = ['id' => $auth->record->id] + self::recordParams($record);
        if (!$auth->scope->isSelf()) {
            $params['employee_id'] = $auth->record->ownerEmployeeId;
        }
        $this->db->execute($auth, $auth->scope->isSelf() ? self::CREATE_SELF_SQL : self::CREATE_SQL, $params);
    }

    /**
     * Replaces the record fields of the authorized Draft when its version still matches.
     *
     * @param array<string, string|null> $record exactly the RECORD columns
     * @return int 1 when written; 0 when the version moved or it is no longer a Draft
     */
    public function update(Authorization $auth, int $expectedVersion, array $record): int
    {
        if ($auth->action !== Action::OvertimeUpdateSelfDraft) {
            throw new \LogicException('overtime is updated only under overtime.updateSelfDraft');
        }
        $sql = $auth->scope->isSelf() ? self::UPDATE_SELF_SQL : self::UPDATE_SQL;
        return $this->db->execute($auth, $sql, ['id' => self::authorized($auth)->id, 'expected_version' => $expectedVersion] + self::recordParams($record));
    }

    /** @return int 1 when the status moved from $from to $to; 0 when the version or status moved */
    public function transition(Authorization $auth, int $expectedVersion, string $from, string $to): int
    {
        if (!in_array($auth->action, [Action::OvertimeSubmitSelf, Action::OvertimeManage], true)) {
            throw new \LogicException('an overtime status moves only under overtime.submitSelf or overtime.manage');
        }
        $sql = $auth->scope->isSelf() ? self::TRANSITION_SELF_SQL : self::TRANSITION_SQL;
        return $this->db->execute($auth, $sql, ['id' => self::authorized($auth)->id, 'expected_version' => $expectedVersion, 'from_status' => $from, 'to_status' => $to]);
    }

    /** @return int 1 when the Draft was deleted; 0 when the version moved or it is no longer a Draft */
    public function deleteDraft(Authorization $auth, int $expectedVersion): int
    {
        if ($auth->action !== Action::OvertimeDeleteSelfDraft) {
            throw new \LogicException('overtime is deleted only under overtime.deleteSelfDraft');
        }
        $sql = $auth->scope->isSelf() ? self::DELETE_DRAFT_SELF_SQL : self::DELETE_DRAFT_SQL;
        return $this->db->execute($auth, $sql, ['id' => self::authorized($auth)->id, 'expected_version' => $expectedVersion]);
    }

    private static function authorized(Authorization $auth): ScopedRecord
    {
        $record = $auth->record ?? throw new \LogicException('an overtime write needs the authorized record');
        if ($record->entity !== self::ENTITY) {
            throw new \LogicException('an overtime write needs an overtime record');
        }
        return $record;
    }

    /**
     * @param array<string, string|null> $record
     * @return array<string, string|null>
     */
    private static function recordParams(array $record): array
    {
        if (array_keys($record) !== self::RECORD) {
            throw new \LogicException('an overtime write takes exactly the record columns, in order');
        }
        return $record;
    }
}
