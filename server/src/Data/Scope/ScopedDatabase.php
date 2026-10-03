<?php
declare(strict_types=1);

namespace TamOs\Data\Scope;

use TamOs\Data\Database;
use TamOs\Policy\Authorization;
use TamOs\Policy\Scope;

/**
 * The only database capability a business store receives (SDR-0002 §8.1): it injects the
 * authoritative scope into every statement, so a store cannot omit or override it.
 *
 *   - Parameters are named. :company_id is always bound from the Scope; under an Employee
 *     (self) scope :self_employee_id is bound from it too. A caller passing either name is
 *     refused — request input can never become scope.
 *   - A statement without :company_id is refused. Under a self scope a statement without
 *     :self_employee_id is refused, so an Employee cannot reach company-wide rows by calling the
 *     company query; under a company scope a self query is refused as a store error.
 *   - Every row read must project company_id and owner_employee_id, and each is checked against
 *     the Scope after the fetch: a row of another company, or under a self scope a row not owned
 *     by that employee, fails the whole read and nothing is returned.
 *   - Reads take a Scope; writes take an Authorization (only Policy mints one), and a write
 *     authorized against a record may only target that record's :id.
 *
 * Refusals are \LogicException (a store defect → 500, logged), never a partial result. These
 * checks are structural: they do not prove a statement's predicates are semantically right —
 * the hostile-principal tests do that at run time.
 */
final class ScopedDatabase
{
    public const COMPANY = 'company_id';
    public const SELF = 'self_employee_id';

    public function __construct(private readonly Database $db)
    {
    }

    /**
     * @param array<string, int|string|bool|null> $params
     * @return list<array<string, mixed>>
     */
    public function select(Scope $scope, string $sql, array $params = []): array
    {
        $rows = $this->db->select($sql, self::bind($scope, $sql, $params));
        foreach ($rows as $row) {
            if (($row[self::COMPANY] ?? null) !== $scope->companyId) {
                throw new \LogicException('a scoped read returned a row outside the company scope');
            }
            if (!array_key_exists('owner_employee_id', $row)) {
                throw new \LogicException('a scoped read must project owner_employee_id');
            }
            if ($scope->isSelf() && $row['owner_employee_id'] !== $scope->selfEmployeeId) {
                throw new \LogicException('a scoped read returned a row outside the self scope');
            }
        }
        return $rows;
    }

    /**
     * The one record with this entity that the scope can see, or null — absent and out of scope
     * are the same null, so a caller cannot tell them apart (SDR-0002 §8.3).
     *
     * @param array<string, int|string|bool|null> $params
     */
    public function find(Scope $scope, string $entity, string $sql, array $params): ?ScopedRecord
    {
        $rows = $this->select($scope, $sql, $params);
        if ($rows === []) {
            return null;
        }
        if (count($rows) !== 1 || !is_string($rows[0]['id'] ?? null)) {
            throw new \LogicException('a scoped find must match at most one row with an id');
        }
        $row = $rows[0];
        $owner = $row['owner_employee_id'];
        $status = $row['status'] ?? null;
        return new ScopedRecord($scope, $entity, $row['id'], is_string($owner) ? $owner : null, is_string($status) ? $status : null);
    }

    /**
     * BF-4b1: a create candidate — the record a record-bearing create is authorized against before
     * it exists. Its scope and its owner come only from an employee record this layer already
     * found under that scope, so a candidate can never name a company or an employee the
     * principal cannot see; the caller supplies only the new server id and the initial status.
     */
    public function candidate(ScopedRecord $owner, string $entity, string $id, string $status): ScopedRecord
    {
        if ($owner->entity !== 'employee' || $owner->ownerEmployeeId !== $owner->id) {
            throw new \LogicException('a create candidate is owned by an employee record read in scope');
        }
        if ($entity === 'employee' || preg_match('/^[0-9a-f]{32}$/', $id) !== 1 || $status === '') {
            throw new \LogicException('a create candidate needs a new server id and its initial status');
        }
        return new ScopedRecord($owner->scope, $entity, $id, $owner->id, $status);
    }

    /**
     * BF-4c1: a period candidate — the record a company-and-month operation (payroll generate) is
     * authorized against before any plan of it is read or written. It is the principal's own scope
     * and a canonical "YYYY-MM" month only: no owner (so no Employee rule can admit it) and no
     * status. It never authorizes a write — a write needs the Authorization of the one record it
     * targets (execute()) — only the company-scope reads and row locks of that operation.
     */
    public function periodCandidate(Scope $scope, string $entity, string $monthKey): ScopedRecord
    {
        if ($entity === 'employee' || preg_match('/^[0-9]{4}-(0[1-9]|1[0-2])$/', $monthKey) !== 1) {
            throw new \LogicException('a period candidate is a non-employee entity and a canonical month');
        }
        return new ScopedRecord($scope, $entity, $monthKey, null, null);
    }

    /**
     * @param array<string, int|string|bool|null> $params
     * @return int the affected row count (0 = nothing in scope matched → the caller's 404)
     */
    public function execute(Authorization $auth, string $sql, array $params): int
    {
        if ($auth->record !== null && ($params['id'] ?? null) !== $auth->record->id) {
            throw new \LogicException('a write authorized against a record must target that record');
        }
        return $this->db->execute($sql, self::bind($auth->scope, $sql, $params));
    }

    /**
     * @param array<string, int|string|bool|null> $params
     * @return array<string, int|string|bool|null>
     */
    private static function bind(Scope $scope, string $sql, array $params): array
    {
        if ($params !== [] && array_is_list($params)) {
            throw new \LogicException('scoped statements take named parameters');
        }
        if (array_key_exists(self::COMPANY, $params) || array_key_exists(self::SELF, $params)) {
            throw new \LogicException('scope parameters come only from the Scope');
        }
        if (preg_match('/:company_id\b/', $sql) !== 1) {
            throw new \LogicException('a scoped statement must use :company_id');
        }
        $params[self::COMPANY] = $scope->companyId;
        $usesSelf = preg_match('/:self_employee_id\b/', $sql) === 1;
        if ($scope->isSelf()) {
            if (!$usesSelf) {
                throw new \LogicException('a statement run under a self scope must use :self_employee_id');
            }
            $params[self::SELF] = $scope->selfEmployeeId;
        } elseif ($usesSelf) {
            throw new \LogicException('a self statement cannot run under a company scope');
        }
        return $params;
    }
}
