<?php
declare(strict_types=1);

namespace TamOs\Data\Employee;

use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Data\Scope\ScopedRecord;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Scope;

/**
 * The employee authorization anchor (migration 0009): the first company-owned, self-scoped
 * store, and the production pattern later domain stores follow. It is NOT an HR API — it holds
 * no personal data, and no production route calls it yet; its callers arrive with the Employee
 * domain migration. BF-3C uses it to prove company isolation, self scope and binding integrity
 * against the real database.
 *
 * Self relation (js/core/workspace.js ENTITY_SCOPE 'employee'): an Employee sees exactly the
 * anchor whose id is their own binding. Every statement names :company_id; the *_SELF_SQL
 * variants add :self_employee_id, and ScopedDatabase refuses the wrong variant for the scope.
 */
final class EmployeeStore
{
    public const ENTITY = 'employee';

    public const FIND_SQL = 'SELECT id, company_id, id AS owner_employee_id FROM employees WHERE id = :id AND company_id = :company_id';
    public const FIND_SELF_SQL = 'SELECT id, company_id, id AS owner_employee_id FROM employees WHERE id = :id AND company_id = :company_id AND id = :self_employee_id';
    public const LIST_SQL = 'SELECT id, company_id, id AS owner_employee_id FROM employees WHERE company_id = :company_id ORDER BY id';
    public const LIST_SELF_SQL = 'SELECT id, company_id, id AS owner_employee_id FROM employees WHERE company_id = :company_id AND id = :self_employee_id ORDER BY id';
    public const CREATE_SQL = 'INSERT INTO employees (id, company_id, created_at) VALUES (:id, :company_id, UTC_TIMESTAMP(6))';

    public function __construct(private readonly ScopedDatabase $db)
    {
    }

    /** The anchor with this id the scope can see, or null (absent and out of scope alike). */
    public function find(Scope $scope, string $id): ?ScopedRecord
    {
        return $this->db->find($scope, self::ENTITY, $scope->isSelf() ? self::FIND_SELF_SQL : self::FIND_SQL, ['id' => $id]);
    }

    /** @return list<string> the anchor ids the scope can see */
    public function listIds(Scope $scope): array
    {
        $rows = $this->db->select($scope, $scope->isSelf() ? self::LIST_SELF_SQL : self::LIST_SQL);
        return array_map(static fn (array $r): string => (string) $r['id'], $rows);
    }

    /** Creates an anchor in the authorized principal's company; the company never comes from input. */
    public function create(Authorization $auth, string $id): void
    {
        if ($auth->action !== Action::EmployeeCreate) {
            throw new \LogicException('an employee anchor is created only under employee.create');
        }
        $this->db->execute($auth, self::CREATE_SQL, ['id' => $id]);
    }
}
