<?php
declare(strict_types=1);

namespace TamOs\Data\Supplemental;

use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Scope;

/**
 * The server Supplemental Payroll document (BF-4d, migrations 0029–0030; owner decisions
 * D-SPAY-1..4 = A): a separate CEO-managed document for one employee and one month that settles
 * the Approved overtime of that month NOT contained in the employee's already-Committed base
 * Payroll plan — and the record of which overtime it captured. Every write, lock, idempotency and
 * eligibility read is CEO company scope only. The Employee reads their OWN COMMITTED documents
 * only: the *_SELF_SQL reads name :self_employee_id and status = 'Committed', so under an Employee
 * scope a Draft, Reviewed, Ready or Cancelled document — their own included — is absent (404),
 * exactly like another employee's.
 *
 * The one writer of supplemental_payrolls and supplemental_payroll_overtime. supplemental.manage is
 * a record-free Action (its entity is null in both vocabularies), so a write here carries the
 * Authorization of the action, not of a record: every write names its document by :id and the
 * company from the Scope, and every UPDATE is a compare-and-swap on `version` that names the open
 * status it expects, so no statement here can change a Committed or a Cancelled document. Exactly
 * one statement writes 'Committed' — COMMIT_SQL: from 'Ready' at the expected version, setting
 * committed_at and the commit idempotency key, both frozen afterwards. There is no DELETE of a
 * document. A link row's id is the overtime record it captures, so the primary key makes a double
 * capture impossible; links are written at generation, replaced when a Draft is recalculated and
 * released when a document is cancelled — the link DELETE itself requires its document to be
 * open, so a Committed document's links freeze. The database's open key holds at most one open
 * (Draft, Reviewed or Ready) document per base plan.
 *
 * The base Payroll is READ only: the Committed plan (its snapshot is copied) and its links, never
 * written. Overtime is READ only: Approved records with their frozen approved_amount, never a
 * valuation input, never written, never locked. Every write follows the global lock order
 * employee → payroll_plan → supplemental_payroll (→ links → audit), each row locked by primary key
 * only — never a secondary-index range. An overtime approval locks its employee before its record,
 * so holding the employee lock freezes the employee's Approved set; a Committed plan's links are
 * frozen; and every Supplemental write holds that same employee lock, so the captured set read
 * under it is stable. Generate and Commit run at READ COMMITTED, so each plain read sees everything
 * committed before the locks it follows.
 */
final class SupplementalStore
{
    public const ENTITY = 'supplementalPayroll';

    /** The document columns a create or recalculation writes, in column order. */
    public const VALUES = ['overtime_amount', 'overtime_hours', 'overtime_count'];

    /** A month list or an employee month fails closed above this many rows (read with LIST_LIMIT). */
    public const LIST_CAP = 2000;
    public const LIST_LIMIT = 2001;

    // Anchor reads (plain, before the locks): which employee and base plan a write must lock first.
    public const ANCHOR_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, payroll_plan_id FROM supplemental_payrolls WHERE id = :id AND company_id = :company_id';
    public const PLAN_ANCHOR_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id FROM payroll_plans WHERE id = :payroll_plan_id AND company_id = :company_id';

    // Document reads (CEO company scope).
    public const RECORD_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, payroll_plan_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, overtime_amount, overtime_hours, overtime_count, version FROM supplemental_payrolls WHERE id = :id AND company_id = :company_id';
    public const MONTH_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, payroll_plan_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, overtime_amount, overtime_hours, overtime_count, version FROM supplemental_payrolls WHERE company_id = :company_id AND month_key = :month_key ORDER BY employee_code_snapshot, employee_id, created_at, id LIMIT 2001';
    // The Employee's reads — their own Committed documents only (D-SPAY-3 = A).
    public const RECORD_SELF_SQL = "SELECT id, company_id, employee_id AS owner_employee_id, payroll_plan_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, overtime_amount, overtime_hours, overtime_count, version FROM supplemental_payrolls WHERE id = :id AND company_id = :company_id AND employee_id = :self_employee_id AND status = 'Committed'";
    public const MONTH_SELF_SQL = "SELECT id, company_id, employee_id AS owner_employee_id, payroll_plan_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, overtime_amount, overtime_hours, overtime_count, version FROM supplemental_payrolls WHERE company_id = :company_id AND month_key = :month_key AND employee_id = :self_employee_id AND status = 'Committed' ORDER BY employee_code_snapshot, employee_id, created_at, id LIMIT 2001";
    // The captured overtime of one document: its frozen amounts, through the document's own links.
    public const OVERTIME_SQL = "SELECT o.id, o.company_id, o.employee_id AS owner_employee_id, o.hours, o.approved_amount FROM supplemental_payroll_overtime l JOIN overtime_records o ON o.company_id = l.company_id AND o.id = l.id WHERE l.company_id = :company_id AND l.supplemental_payroll_id = :supplemental_payroll_id AND o.status = 'Approved' ORDER BY o.id";
    public const OVERTIME_SELF_SQL = "SELECT o.id, o.company_id, o.employee_id AS owner_employee_id, o.hours, o.approved_amount FROM supplemental_payroll_overtime l JOIN supplemental_payrolls s ON s.company_id = l.company_id AND s.id = l.supplemental_payroll_id JOIN overtime_records o ON o.company_id = l.company_id AND o.id = l.id WHERE l.company_id = :company_id AND l.supplemental_payroll_id = :supplemental_payroll_id AND s.employee_id = :self_employee_id AND s.status = 'Committed' AND o.employee_id = s.employee_id AND o.status = 'Approved' ORDER BY o.id";

    // The CEO eligibility read: the month's Committed base plans, and the month's Approved overtime
    // captured by no base plan and no Supplemental document (a filter, never an SQL sum).
    public const COMMITTED_PLANS_SQL = "SELECT id, company_id, employee_id AS owner_employee_id, employee_id FROM payroll_plans WHERE company_id = :company_id AND month_key = :month_key AND status = 'Committed' ORDER BY employee_id, id LIMIT 2001";
    public const UNCAPTURED_SQL = "SELECT o.id, o.company_id, o.employee_id AS owner_employee_id, o.employee_id, o.hours, o.approved_amount FROM overtime_records o WHERE o.company_id = :company_id AND o.month_key = :month_key AND o.status = 'Approved' AND NOT EXISTS (SELECT 1 FROM payroll_plan_overtime pl WHERE pl.company_id = o.company_id AND pl.id = o.id) AND NOT EXISTS (SELECT 1 FROM supplemental_payroll_overtime sl WHERE sl.company_id = o.company_id AND sl.id = o.id) ORDER BY o.employee_id, o.id LIMIT 2001";

    // Writes, in the global order: the employee, the base plan, the document — each by primary key.
    public const LOCK_EMPLOYEE_SQL = 'SELECT id, company_id, id AS owner_employee_id FROM employees WHERE id = :employee_id AND company_id = :company_id FOR UPDATE';
    public const LOCK_PLAN_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot FROM payroll_plans WHERE id = :payroll_plan_id AND company_id = :company_id FOR UPDATE';
    public const LOCK_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, payroll_plan_id, employee_id, month_key, status, overtime_amount, overtime_hours, overtime_count, version, commit_idempotency_key FROM supplemental_payrolls WHERE id = :id AND company_id = :company_id FOR UPDATE';
    // The open document of a base plan (at most one: the open key), read under the plan lock.
    public const OPEN_ID_SQL = "SELECT id, company_id, employee_id AS owner_employee_id FROM supplemental_payrolls WHERE company_id = :company_id AND payroll_plan_id = :payroll_plan_id AND status IN ('Draft', 'Reviewed', 'Ready') ORDER BY id LIMIT 2";
    // The generate inputs, read under the locks: the employee's Approved overtime of the month, the
    // base plan's links, and every overtime of that employee and month already captured by a
    // Supplemental document (a cancelled one has released its links).
    public const EMPLOYEE_APPROVED_SQL = "SELECT id, company_id, employee_id AS owner_employee_id, hours, approved_amount FROM overtime_records WHERE company_id = :company_id AND employee_id = :employee_id AND month_key = :month_key AND status = 'Approved' ORDER BY id LIMIT 2001";
    public const PLAN_LINKS_SQL = 'SELECT l.id, l.company_id, p.employee_id AS owner_employee_id FROM payroll_plan_overtime l JOIN payroll_plans p ON p.company_id = l.company_id AND p.id = l.payroll_plan_id WHERE l.company_id = :company_id AND l.payroll_plan_id = :payroll_plan_id ORDER BY l.id';
    public const CAPTURED_SQL = 'SELECT l.id, l.company_id, s.employee_id AS owner_employee_id, l.supplemental_payroll_id FROM supplemental_payroll_overtime l JOIN supplemental_payrolls s ON s.company_id = l.company_id AND s.id = l.supplemental_payroll_id WHERE l.company_id = :company_id AND s.employee_id = :employee_id AND s.month_key = :month_key ORDER BY l.id';
    // Commit's revalidation, under the locks: the document's links, and those of them that are still
    // the employee's Approved overtime of the month that no base plan holds.
    public const LINKS_SQL = 'SELECT l.id, l.company_id, s.employee_id AS owner_employee_id FROM supplemental_payroll_overtime l JOIN supplemental_payrolls s ON s.company_id = l.company_id AND s.id = l.supplemental_payroll_id WHERE l.company_id = :company_id AND l.supplemental_payroll_id = :supplemental_payroll_id ORDER BY l.id';
    public const VALID_LINKS_SQL = "SELECT o.id, o.company_id, o.employee_id AS owner_employee_id, o.hours, o.approved_amount FROM supplemental_payroll_overtime l JOIN supplemental_payrolls s ON s.company_id = l.company_id AND s.id = l.supplemental_payroll_id JOIN overtime_records o ON o.company_id = l.company_id AND o.id = l.id WHERE l.company_id = :company_id AND l.supplemental_payroll_id = :supplemental_payroll_id AND o.employee_id = s.employee_id AND o.month_key = s.month_key AND o.status = 'Approved' AND NOT EXISTS (SELECT 1 FROM payroll_plan_overtime pl WHERE pl.company_id = o.company_id AND pl.id = o.id) ORDER BY o.id";
    // The company's document (if any) already holding a commit idempotency key.
    public const KEY_HOLDER_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id FROM supplemental_payrolls WHERE company_id = :company_id AND commit_idempotency_key = :commit_idempotency_key';

    // A new document is always a version 1 Draft; its owner, base plan, month and snapshot are the
    // locked Committed plan's.
    public const CREATE_SQL = "INSERT INTO supplemental_payrolls (id, company_id, payroll_plan_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, overtime_amount, overtime_hours, overtime_count, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at) VALUES (:id, :company_id, :payroll_plan_id, :employee_id, :month_key, 'Draft', :employee_code_snapshot, :employee_name_snapshot, :department_snapshot, :overtime_amount, :overtime_hours, :overtime_count, UTC_TIMESTAMP(6), NULL, NULL, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))";
    public const RECALCULATE_SQL = "UPDATE supplemental_payrolls SET overtime_amount = :overtime_amount, overtime_hours = :overtime_hours, overtime_count = :overtime_count, calculated_at = UTC_TIMESTAMP(6), version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Draft'";
    public const TRANSITION_SQL = "UPDATE supplemental_payrolls SET status = :to_status, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = :from_status AND status IN ('Draft', 'Reviewed', 'Ready')";
    // The one statement that writes 'Committed' — from Ready at the expected version only.
    public const COMMIT_SQL = "UPDATE supplemental_payrolls SET status = 'Committed', committed_at = UTC_TIMESTAMP(6), commit_idempotency_key = :commit_idempotency_key, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Ready'";
    public const LINK_SQL = 'INSERT INTO supplemental_payroll_overtime (id, company_id, supplemental_payroll_id, created_at) VALUES (:overtime_id, :company_id, :id, UTC_TIMESTAMP(6))';
    public const UNLINK_SQL = "DELETE FROM supplemental_payroll_overtime WHERE company_id = :company_id AND supplemental_payroll_id = :id AND EXISTS (SELECT 1 FROM supplemental_payrolls s WHERE s.company_id = supplemental_payroll_overtime.company_id AND s.id = supplemental_payroll_overtime.supplemental_payroll_id AND s.status IN ('Draft', 'Reviewed', 'Ready'))";

    public function __construct(private readonly ScopedDatabase $db)
    {
    }

    /** @return array<string, mixed>|null the document's owner and base plan, read before the locks (CEO), or null */
    public function anchor(Scope $scope, string $id): ?array
    {
        self::companyOnly($scope);
        return $this->db->select($scope, self::ANCHOR_SQL, ['id' => self::id($id)])[0] ?? null;
    }

    /** @return array<string, mixed>|null the base plan's owner, read before the locks (CEO), or null */
    public function planAnchor(Scope $scope, string $planId): ?array
    {
        self::companyOnly($scope);
        return $this->db->select($scope, self::PLAN_ANCHOR_SQL, ['payroll_plan_id' => self::id($planId)])[0] ?? null;
    }

    /** @return array<string, mixed>|null the document, or null (an Employee: their own Committed document only) */
    public function record(Scope $scope, string $id): ?array
    {
        return $this->db->select($scope, $scope->isSelf() ? self::RECORD_SELF_SQL : self::RECORD_SQL, ['id' => self::id($id)])[0] ?? null;
    }

    /**
     * Every document of one month, Cancelled included — at most LIST_LIMIT rows, so a caller can
     * tell that LIST_CAP was exceeded. An Employee: their own Committed documents of the month only.
     *
     * @return list<array<string, mixed>>
     */
    public function month(Scope $scope, string $monthKey): array
    {
        return $this->db->select($scope, $scope->isSelf() ? self::MONTH_SELF_SQL : self::MONTH_SQL, ['month_key' => $monthKey]);
    }

    /** @return list<array<string, mixed>> the overtime one document captured, with its frozen amounts (an Employee: of their own Committed document only) */
    public function overtimeOf(Scope $scope, string $id): array
    {
        return $this->db->select($scope, $scope->isSelf() ? self::OVERTIME_SELF_SQL : self::OVERTIME_SQL, ['supplemental_payroll_id' => self::id($id)]);
    }

    /**
     * The CEO eligibility inputs of one month: the Committed base plans and the uncaptured Approved
     * overtime — each at most LIST_LIMIT rows.
     *
     * @return array{plans: list<array<string, mixed>>, overtime: list<array<string, mixed>>}
     */
    public function eligibilityInputs(Scope $scope, string $monthKey): array
    {
        self::companyOnly($scope);
        return [
            'plans' => $this->db->select($scope, self::COMMITTED_PLANS_SQL, ['month_key' => $monthKey]),
            'overtime' => $this->db->select($scope, self::UNCAPTURED_SQL, ['month_key' => $monthKey]),
        ];
    }

    /**
     * Step 1 of every write: locks the employee by primary key and returns it, or null.
     *
     * @return array<string, mixed>|null
     */
    public function lockEmployee(Authorization $auth, string $employeeId): ?array
    {
        return $this->db->select(self::authorized($auth)->scope, self::LOCK_EMPLOYEE_SQL, ['employee_id' => $employeeId])[0] ?? null;
    }

    /**
     * Step 2: locks the base plan by primary key and returns its status and snapshot, or null.
     *
     * @return array<string, mixed>|null
     */
    public function lockPlan(Authorization $auth, string $planId): ?array
    {
        return $this->db->select(self::authorized($auth)->scope, self::LOCK_PLAN_SQL, ['payroll_plan_id' => self::id($planId)])[0] ?? null;
    }

    /**
     * Step 3: locks one document by primary key and returns what the guards compare, or null.
     *
     * @return array<string, mixed>|null
     */
    public function lock(Authorization $auth, string $id): ?array
    {
        return $this->db->select(self::authorized($auth)->scope, self::LOCK_SQL, ['id' => self::id($id)])[0] ?? null;
    }

    /** The id of the base plan's open document, or null; read under the plan lock. */
    public function openId(Authorization $auth, string $planId): ?string
    {
        $rows = $this->db->select(self::authorized($auth)->scope, self::OPEN_ID_SQL, ['payroll_plan_id' => self::id($planId)]);
        if (count($rows) > 1) {
            throw new \LogicException('two open supplemental documents for one base plan');
        }
        return isset($rows[0]) ? (string) $rows[0]['id'] : null;
    }

    /**
     * The generate inputs of one employee and month, read under the locks: the Approved overtime
     * with its frozen amounts, the base plan's links, and the overtime already captured by any
     * Supplemental document (id => document id).
     *
     * @return array{approved: list<array<string, mixed>>, planLinks: list<string>, captured: array<string, string>}
     */
    public function generateInputs(Authorization $auth, string $planId, string $employeeId, string $monthKey): array
    {
        $scope = self::authorized($auth)->scope;
        $approved = $this->db->select($scope, self::EMPLOYEE_APPROVED_SQL, ['employee_id' => $employeeId, 'month_key' => $monthKey]);
        if (count($approved) > self::LIST_CAP) {
            throw new \LogicException('an employee month above the supplemental overtime cap');
        }
        $planLinks = array_map(static fn (array $r): string => (string) $r['id'], $this->db->select($scope, self::PLAN_LINKS_SQL, ['payroll_plan_id' => self::id($planId)]));
        $captured = [];
        foreach ($this->db->select($scope, self::CAPTURED_SQL, ['employee_id' => $employeeId, 'month_key' => $monthKey]) as $r) {
            $captured[(string) $r['id']] = (string) $r['supplemental_payroll_id'];
        }
        return ['approved' => $approved, 'planLinks' => $planLinks, 'captured' => $captured];
    }

    /**
     * Commit's revalidation inputs, read under the locks: every link of the document, and those of
     * them still valid (the employee's Approved overtime of the month, held by no base plan).
     *
     * @return array{links: list<string>, valid: list<array<string, mixed>>}
     */
    public function commitInputs(Authorization $auth, string $id): array
    {
        $scope = self::authorized($auth)->scope;
        return [
            'links' => array_map(static fn (array $r): string => (string) $r['id'], $this->db->select($scope, self::LINKS_SQL, ['supplemental_payroll_id' => self::id($id)])),
            'valid' => $this->db->select($scope, self::VALID_LINKS_SQL, ['supplemental_payroll_id' => self::id($id)]),
        ];
    }

    /** The id of the company's document holding this commit idempotency key, or null. */
    public function keyHolder(Authorization $auth, string $key): ?string
    {
        $rows = $this->db->select(self::authorized($auth)->scope, self::KEY_HOLDER_SQL, ['commit_idempotency_key' => self::key($key)]);
        return isset($rows[0]) ? (string) $rows[0]['id'] : null;
    }

    /**
     * Inserts a version 1 Draft for the locked Committed base plan $plan.
     *
     * @param array<string, mixed> $plan the locked plan (LOCK_PLAN_SQL)
     * @param array<string, int|string> $values exactly the VALUES columns
     */
    public function create(Authorization $auth, string $id, array $plan, array $values): void
    {
        if ($plan['status'] !== 'Committed') {
            throw new \LogicException('a supplemental document is created only for a Committed base plan');
        }
        $this->db->execute(self::authorized($auth), self::CREATE_SQL, [
            'id' => self::id($id),
            'payroll_plan_id' => self::id((string) $plan['id']),
            'employee_id' => (string) $plan['employee_id'],
            'month_key' => (string) $plan['month_key'],
            'employee_code_snapshot' => (string) $plan['employee_code_snapshot'],
            'employee_name_snapshot' => (string) $plan['employee_name_snapshot'],
            'department_snapshot' => $plan['department_snapshot'] === null ? null : (string) $plan['department_snapshot'],
        ] + self::values($values));
    }

    /**
     * Replaces the amounts of a Draft when its version still matches.
     *
     * @param array<string, int|string> $values exactly the VALUES columns
     * @return int 1 when written; 0 when the version moved or it is no longer a Draft
     */
    public function recalculate(Authorization $auth, string $id, int $expectedVersion, array $values): int
    {
        return $this->db->execute(self::authorized($auth), self::RECALCULATE_SQL, ['id' => self::id($id), 'expected_version' => $expectedVersion] + self::values($values));
    }

    /** @return int 1 when the status moved from $from to $to; 0 when the version or status moved */
    public function transition(Authorization $auth, string $id, int $expectedVersion, string $from, string $to): int
    {
        if (!in_array($from, ['Draft', 'Reviewed', 'Ready'], true) || !in_array($to, ['Draft', 'Reviewed', 'Ready', 'Cancelled'], true)) {
            throw new \LogicException('a supplemental transition starts while open and never reaches Committed');
        }
        return $this->db->execute(self::authorized($auth), self::TRANSITION_SQL, ['id' => self::id($id), 'expected_version' => $expectedVersion, 'from_status' => $from, 'to_status' => $to]);
    }

    /**
     * Ready → Committed at the expected version, storing the commit idempotency key; committed_at
     * is the database clock.
     *
     * @return int 1 when committed; 0 when the version or status moved
     */
    public function commit(Authorization $auth, string $id, int $expectedVersion, string $key): int
    {
        return $this->db->execute(self::authorized($auth), self::COMMIT_SQL, ['id' => self::id($id), 'expected_version' => $expectedVersion, 'commit_idempotency_key' => self::key($key)]);
    }

    /**
     * Records the overtime a document captured. A record already captured by any document is
     * refused by the primary key (a double capture is a database error, never a merge).
     *
     * @param list<string> $overtimeIds
     */
    public function link(Authorization $auth, string $id, array $overtimeIds): void
    {
        $auth = self::authorized($auth);
        foreach ($overtimeIds as $overtimeId) {
            if (!is_string($overtimeId) || preg_match('/^[0-9a-f]{32}$/', $overtimeId) !== 1) {
                throw new \LogicException('a supplemental link names an overtime record id');
            }
            $this->db->execute($auth, self::LINK_SQL, ['id' => self::id($id), 'overtime_id' => $overtimeId]);
        }
    }

    /** Releases every link of an open document; returns the count. */
    public function unlink(Authorization $auth, string $id): int
    {
        return $this->db->execute(self::authorized($auth), self::UNLINK_SQL, ['id' => self::id($id)]);
    }

    private static function companyOnly(Scope $scope): void
    {
        if ($scope->isSelf()) {
            throw new \LogicException('supplemental anchor and eligibility reads are company scope only');
        }
    }

    private static function id(string $id): string
    {
        if (preg_match('/^[0-9a-f]{32}$/', $id) !== 1) {
            throw new \LogicException('a supplemental or base plan id is 32 lowercase hex characters');
        }
        return $id;
    }

    private static function key(string $key): string
    {
        if (preg_match('/^[0-9a-f]{32}$/', $key) !== 1) {
            throw new \LogicException('a commit idempotency key is 32 lowercase hex characters');
        }
        return $key;
    }

    /**
     * Every Supplemental lock and write is authorized under supplemental.manage, record-free, in
     * company scope (an Employee never reaches one).
     */
    private static function authorized(Authorization $auth): Authorization
    {
        if ($auth->action !== Action::SupplementalManage || $auth->record !== null || $auth->scope->isSelf()) {
            throw new \LogicException('a supplemental write needs supplemental.manage, record-free, in company scope');
        }
        return $auth;
    }

    /**
     * @param array<string, int|string> $values
     * @return array<string, int|string>
     */
    private static function values(array $values): array
    {
        if (array_keys($values) !== self::VALUES) {
            throw new \LogicException('a supplemental write takes exactly the document values, in order');
        }
        return $values;
    }
}
