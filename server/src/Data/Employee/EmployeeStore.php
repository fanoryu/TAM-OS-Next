<?php
declare(strict_types=1);

namespace TamOs\Data\Employee;

use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Data\Scope\ScopedRecord;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Scope;

/**
 * The server Employee record (BF-3C anchor, BF-4a1 profile, migrations 0009 and 0014–0016): the first
 * company-owned, self-scoped business store, and the pattern later domain stores follow. Every
 * statement names :company_id and the *_SELF_SQL variants add :self_employee_id;
 * ScopedDatabase injects both from the Scope and refuses the wrong variant for the scope.
 *
 * Self relation (js/core/workspace.js ENTITY_SCOPE 'employee'): an Employee sees exactly the
 * record whose id is their own binding.
 *
 * Writes (BF-4a1): create under employee.create; update and archive under employee.update and
 * employee.delete against the record the caller loaded in scope, compare-and-swap on `version`
 * (SDR-0002 §10), never on an archived record. employee.delete is a SOFT archive: there is no
 * DELETE statement here, and history is kept (SDR-0002 §6, §12). Bank fields, contract type and
 * history are not stored.
 */
final class EmployeeStore
{
    public const ENTITY = 'employee';

    /** Profile columns, in column order. The only values a create or update writes. */
    public const PROFILE = ['employee_code', 'full_name', 'job_title', 'department', 'employment_status', 'join_date', 'contact_email', 'phone', 'notes', 'monthly_base_salary'];

    /** The company list fails closed above this many entitled rows (read with LIST_LIMIT, never truncated). */
    public const LIST_CAP = 2000;
    public const LIST_LIMIT = 2001;

    // Anchor reads (BF-3C): id, company and owner only — the record a Policy decision needs.
    public const FIND_SQL = 'SELECT id, company_id, id AS owner_employee_id FROM employees WHERE id = :id AND company_id = :company_id';
    public const FIND_SELF_SQL = 'SELECT id, company_id, id AS owner_employee_id FROM employees WHERE id = :id AND company_id = :company_id AND id = :self_employee_id';
    public const LIST_SQL = 'SELECT id, company_id, id AS owner_employee_id FROM employees WHERE company_id = :company_id ORDER BY id';
    public const LIST_SELF_SQL = 'SELECT id, company_id, id AS owner_employee_id FROM employees WHERE company_id = :company_id AND id = :self_employee_id ORDER BY id';

    // Profile reads (BF-4a1). The company list is CEO-only and has no self variant.
    public const LIST_PROFILES_SQL = 'SELECT id, company_id, id AS owner_employee_id, employee_code, full_name, job_title, department, employment_status, join_date, contact_email, phone, notes, monthly_base_salary, archived_at, version FROM employees WHERE company_id = :company_id AND archived_at IS NULL ORDER BY employee_code, id LIMIT 2001';
    public const LIST_ALL_PROFILES_SQL = 'SELECT id, company_id, id AS owner_employee_id, employee_code, full_name, job_title, department, employment_status, join_date, contact_email, phone, notes, monthly_base_salary, archived_at, version FROM employees WHERE company_id = :company_id ORDER BY employee_code, id LIMIT 2001';
    public const FIND_PROFILE_SQL = 'SELECT id, company_id, id AS owner_employee_id, employee_code, full_name, job_title, department, employment_status, join_date, contact_email, phone, notes, monthly_base_salary, archived_at, version FROM employees WHERE id = :id AND company_id = :company_id';
    public const FIND_PROFILE_SELF_SQL = 'SELECT id, company_id, id AS owner_employee_id, employee_code, full_name, job_title, department, employment_status, join_date, contact_email, phone, notes, monthly_base_salary, archived_at, version FROM employees WHERE id = :id AND company_id = :company_id AND id = :self_employee_id';
    public const LOCK_PROFILE_SQL = 'SELECT id, company_id, id AS owner_employee_id, employee_code, full_name, job_title, department, employment_status, join_date, contact_email, phone, notes, monthly_base_salary, archived_at, version FROM employees WHERE id = :id AND company_id = :company_id FOR UPDATE';

    // An active login bound to the record (memberships, 0010). Read after LOCK_PROFILE_SQL inside the
    // archive transaction; binding a membership (BF-4a2) locks the same employee row first.
    public const ACTIVE_BINDING_SQL = "SELECT id, company_id, employee_id AS owner_employee_id FROM memberships WHERE company_id = :company_id AND employee_id = :employee_id AND status = 'active' LIMIT 1";

    // Writes. Version compare-and-swap; archived records are never written.
    public const CREATE_SQL = 'INSERT INTO employees (id, company_id, employee_code, full_name, job_title, department, employment_status, join_date, contact_email, phone, notes, monthly_base_salary, archived_at, version, created_at, updated_at) VALUES (:id, :company_id, :employee_code, :full_name, :job_title, :department, :employment_status, :join_date, :contact_email, :phone, :notes, :monthly_base_salary, NULL, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))';
    public const UPDATE_SQL = 'UPDATE employees SET employee_code = :employee_code, full_name = :full_name, job_title = :job_title, department = :department, employment_status = :employment_status, join_date = :join_date, contact_email = :contact_email, phone = :phone, notes = :notes, monthly_base_salary = :monthly_base_salary, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND version = :expected_version AND archived_at IS NULL';
    public const ARCHIVE_SQL = 'UPDATE employees SET archived_at = UTC_TIMESTAMP(6), version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND version = :expected_version AND archived_at IS NULL';

    public function __construct(private readonly ScopedDatabase $db)
    {
    }

    /** The record with this id the scope can see, or null (absent and out of scope alike). */
    public function find(Scope $scope, string $id): ?ScopedRecord
    {
        return $this->db->find($scope, self::ENTITY, $scope->isSelf() ? self::FIND_SELF_SQL : self::FIND_SQL, ['id' => $id]);
    }

    /** @return list<string> the record ids the scope can see, archived included */
    public function listIds(Scope $scope): array
    {
        $rows = $this->db->select($scope, $scope->isSelf() ? self::LIST_SELF_SQL : self::LIST_SQL);
        return array_map(static fn (array $r): string => (string) $r['id'], $rows);
    }

    /**
     * The company's profiles in (employee_code, id) order — at most LIST_LIMIT rows, so a caller
     * can tell that LIST_CAP was exceeded. Company scope only: a self scope is refused.
     *
     * @return list<array<string, mixed>>
     */
    public function profiles(Scope $scope, bool $includeArchived): array
    {
        if ($scope->isSelf()) {
            throw new \LogicException('the employee list is company-scoped only');
        }
        return $this->db->select($scope, $includeArchived ? self::LIST_ALL_PROFILES_SQL : self::LIST_PROFILES_SQL);
    }

    /** @return array<string, mixed>|null the profile the scope can see (archived included), or null */
    public function profile(Scope $scope, string $id): ?array
    {
        $rows = $this->db->select($scope, $scope->isSelf() ? self::FIND_PROFILE_SELF_SQL : self::FIND_PROFILE_SQL, ['id' => $id]);
        return $rows[0] ?? null;
    }

    /**
     * Locks and returns the profile the authorization was decided on. Must run inside a transaction.
     *
     * @return array<string, mixed>|null
     */
    public function lockProfile(Authorization $auth): ?array
    {
        $record = $auth->record ?? throw new \LogicException('a profile lock needs the authorized record');
        $rows = $this->db->select($auth->scope, self::LOCK_PROFILE_SQL, ['id' => $record->id]);
        return $rows[0] ?? null;
    }

    /** Whether an active membership is bound to the authorized record. */
    public function hasActiveBinding(Authorization $auth): bool
    {
        $record = $auth->record ?? throw new \LogicException('a binding check needs the authorized record');
        return $this->db->select($auth->scope, self::ACTIVE_BINDING_SQL, ['employee_id' => $record->id]) !== [];
    }

    /**
     * Creates a record in the authorized principal's company; the company never comes from input
     * and the id is the server's.
     *
     * @param array<string, int|string|null> $profile exactly the PROFILE columns
     */
    public function create(Authorization $auth, string $id, array $profile): void
    {
        if ($auth->action !== Action::EmployeeCreate) {
            throw new \LogicException('an employee is created only under employee.create');
        }
        $this->db->execute($auth, self::CREATE_SQL, ['id' => $id] + self::profileParams($profile));
    }

    /**
     * Replaces the profile of the authorized record when its version still matches.
     *
     * @param array<string, int|string|null> $profile exactly the PROFILE columns
     * @return int 1 when written; 0 when the version moved or the record is archived
     */
    public function update(Authorization $auth, int $expectedVersion, array $profile): int
    {
        if ($auth->action !== Action::EmployeeUpdate || $auth->record === null) {
            throw new \LogicException('an employee is updated only under employee.update, against its record');
        }
        return $this->db->execute($auth, self::UPDATE_SQL, ['id' => $auth->record->id, 'expected_version' => $expectedVersion] + self::profileParams($profile));
    }

    /** @return int 1 when archived; 0 when the version moved or it is already archived */
    public function archive(Authorization $auth, int $expectedVersion): int
    {
        if ($auth->action !== Action::EmployeeDelete || $auth->record === null) {
            throw new \LogicException('an employee is archived only under employee.delete, against its record');
        }
        return $this->db->execute($auth, self::ARCHIVE_SQL, ['id' => $auth->record->id, 'expected_version' => $expectedVersion]);
    }

    /**
     * @param array<string, int|string|null> $profile
     * @return array<string, int|string|null>
     */
    private static function profileParams(array $profile): array
    {
        if (array_keys($profile) !== self::PROFILE) {
            throw new \LogicException('an employee write takes exactly the profile columns, in order');
        }
        return $profile;
    }
}
