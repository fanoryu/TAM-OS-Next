<?php
declare(strict_types=1);

namespace TamOs\Data\Finance;

use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Data\Scope\ScopedRecord;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Scope;

/**
 * The server Finance posting (BF-4e, migration 0032; owner decisions D-FIN-1..5 = A): one Planned
 * record made from exactly one Committed payroll obligation — a base payroll plan or a Supplemental
 * Payroll document — and nothing else. Every read, lock and write is CEO company scope only; there
 * is no Employee statement.
 *
 * The one writer of finance_postings, and it only inserts: a posting is immutable (no UPDATE, no
 * DELETE). Both INSERT statements write status 'Planned', the source's own employee, month and
 * amount, and the caller's idempotency key; the database holds at most one posting per source (a
 * unique key on each source column) and each key once per company. A base plan posting is
 * authorized against its plan (payroll.manage is record-bearing), so its INSERT names that plan as
 * :id; a Supplemental posting is authorized by the record-free supplemental.manage and names its
 * document as :id the same way.
 *
 * The sources are READ only — the Committed plan or document, never written: Payroll and
 * Supplemental keep their own single writers. A posting locks in the global order employee →
 * payroll_plan → supplemental_payroll, each row by primary key only (a base plan posting locks the
 * employee and the plan; a Supplemental posting the employee and the document), so it serializes
 * with every Payroll and Supplemental write and never cycles with one. The money is copied as the
 * exact stored string: no SQL arithmetic.
 */
final class FinancePostingStore
{
    public const PAYROLL_PLAN = 'payrollPlan';
    public const SUPPLEMENTAL_PAYROLL = 'supplementalPayroll';

    /** A month list fails closed above this many rows (read with LIST_LIMIT). */
    public const LIST_CAP = 2000;
    public const LIST_LIMIT = 2001;

    // Posting reads (CEO company scope).
    public const RECORD_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, source_kind, payroll_plan_id, supplemental_payroll_id, employee_id, month_key, amount, status FROM finance_postings WHERE id = :id AND company_id = :company_id';
    public const MONTH_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, source_kind, payroll_plan_id, supplemental_payroll_id, employee_id, month_key, amount, status FROM finance_postings WHERE company_id = :company_id AND month_key = :month_key ORDER BY employee_id, source_kind, posted_at, id LIMIT 2001';

    // Source reads before the locks: the base plan a payroll.manage Authorization is decided on, and
    // which employee a Supplemental document belongs to.
    public const PLAN_FIND_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, status FROM payroll_plans WHERE id = :id AND company_id = :company_id';
    public const SUPPLEMENTAL_ANCHOR_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id FROM supplemental_payrolls WHERE id = :id AND company_id = :company_id';

    // The locks, in the global order — each by primary key.
    public const LOCK_EMPLOYEE_SQL = 'SELECT id, company_id, id AS owner_employee_id FROM employees WHERE id = :employee_id AND company_id = :company_id FOR UPDATE';
    public const LOCK_PLAN_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, status, total_amount FROM payroll_plans WHERE id = :id AND company_id = :company_id FOR UPDATE';
    public const LOCK_SUPPLEMENTAL_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, status, overtime_amount FROM supplemental_payrolls WHERE id = :id AND company_id = :company_id FOR UPDATE';

    // Read under the locks: the posting already holding an idempotency key, and the posting of a source.
    public const KEY_HOLDER_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, source_kind, payroll_plan_id, supplemental_payroll_id, amount FROM finance_postings WHERE company_id = :company_id AND idempotency_key = :idempotency_key';
    public const PLAN_POSTING_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id FROM finance_postings WHERE company_id = :company_id AND payroll_plan_id = :id';
    public const SUPPLEMENTAL_POSTING_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id FROM finance_postings WHERE company_id = :company_id AND supplemental_payroll_id = :id';

    // The two writes — always a Planned posting of one source, from the locked source row.
    public const INSERT_PLAN_SQL = "INSERT INTO finance_postings (id, company_id, source_kind, payroll_plan_id, supplemental_payroll_id, employee_id, month_key, amount, status, idempotency_key, posted_at) VALUES (:posting_id, :company_id, 'payrollPlan', :id, NULL, :employee_id, :month_key, :amount, 'Planned', :idempotency_key, UTC_TIMESTAMP(6))";
    public const INSERT_SUPPLEMENTAL_SQL = "INSERT INTO finance_postings (id, company_id, source_kind, payroll_plan_id, supplemental_payroll_id, employee_id, month_key, amount, status, idempotency_key, posted_at) VALUES (:posting_id, :company_id, 'supplementalPayroll', NULL, :id, :employee_id, :month_key, :amount, 'Planned', :idempotency_key, UTC_TIMESTAMP(6))";

    public function __construct(private readonly ScopedDatabase $db)
    {
    }

    /** @return array<string, mixed>|null one posting (CEO), or null */
    public function record(Scope $scope, string $id): ?array
    {
        self::companyOnly($scope);
        return $this->db->select($scope, self::RECORD_SQL, ['id' => self::id($id)])[0] ?? null;
    }

    /**
     * Every posting of one month — at most LIST_LIMIT rows, so a caller can tell that LIST_CAP was
     * exceeded. CEO only.
     *
     * @return list<array<string, mixed>>
     */
    public function month(Scope $scope, string $monthKey): array
    {
        self::companyOnly($scope);
        return $this->db->select($scope, self::MONTH_SQL, ['month_key' => $monthKey]);
    }

    /** The base plan a posting is authorized against (CEO), or null. */
    public function planRecord(Scope $scope, string $planId): ?ScopedRecord
    {
        self::companyOnly($scope);
        return $this->db->find($scope, self::PAYROLL_PLAN, self::PLAN_FIND_SQL, ['id' => self::id($planId)]);
    }

    /** @return array<string, mixed>|null the Supplemental document's owner, read before the locks (CEO), or null */
    public function supplementalAnchor(Scope $scope, string $id): ?array
    {
        self::companyOnly($scope);
        return $this->db->select($scope, self::SUPPLEMENTAL_ANCHOR_SQL, ['id' => self::id($id)])[0] ?? null;
    }

    /**
     * Step 1 of a posting: locks the source's employee by primary key, or null.
     *
     * @return array<string, mixed>|null
     */
    public function lockEmployee(Authorization $auth, string $employeeId): ?array
    {
        return $this->db->select(self::authorized($auth)->scope, self::LOCK_EMPLOYEE_SQL, ['employee_id' => $employeeId])[0] ?? null;
    }

    /**
     * Step 2 of a base plan posting: locks the authorized plan by primary key and returns its status,
     * owner, month and total, or null.
     *
     * @return array<string, mixed>|null
     */
    public function lockPlan(Authorization $auth): ?array
    {
        $plan = self::planAuthorized($auth);
        return $this->db->select($auth->scope, self::LOCK_PLAN_SQL, ['id' => $plan])[0] ?? null;
    }

    /**
     * Step 2 of a Supplemental posting: locks the document by primary key and returns its status,
     * owner, month and amount, or null.
     *
     * @return array<string, mixed>|null
     */
    public function lockSupplemental(Authorization $auth, string $id): ?array
    {
        return $this->db->select(self::supplementalAuthorized($auth)->scope, self::LOCK_SUPPLEMENTAL_SQL, ['id' => self::id($id)])[0] ?? null;
    }

    /** @return array<string, mixed>|null the company's posting holding this idempotency key, or null */
    public function keyHolder(Authorization $auth, string $key): ?array
    {
        return $this->db->select(self::authorized($auth)->scope, self::KEY_HOLDER_SQL, ['idempotency_key' => self::key($key)])[0] ?? null;
    }

    /** The id of the posting of the authorized base plan, or null. */
    public function planPosting(Authorization $auth): ?string
    {
        $rows = $this->db->select($auth->scope, self::PLAN_POSTING_SQL, ['id' => self::planAuthorized($auth)]);
        return isset($rows[0]) ? (string) $rows[0]['id'] : null;
    }

    /** The id of the posting of a Supplemental document, or null. */
    public function supplementalPosting(Authorization $auth, string $id): ?string
    {
        $rows = $this->db->select(self::supplementalAuthorized($auth)->scope, self::SUPPLEMENTAL_POSTING_SQL, ['id' => self::id($id)]);
        return isset($rows[0]) ? (string) $rows[0]['id'] : null;
    }

    /**
     * Inserts the Planned posting of the locked, Committed base plan $plan.
     *
     * @param array<string, mixed> $plan the locked plan (LOCK_PLAN_SQL)
     */
    public function insertPlan(Authorization $auth, string $postingId, array $plan, string $key): void
    {
        $id = self::planAuthorized($auth);
        if ((string) $plan['id'] !== $id || $plan['status'] !== 'Committed') {
            throw new \LogicException('a base plan posting is made only from the authorized, Committed plan');
        }
        $this->db->execute($auth, self::INSERT_PLAN_SQL, self::values($id, $postingId, $plan, (string) $plan['total_amount'], $key));
    }

    /**
     * Inserts the Planned posting of the locked, Committed Supplemental document $doc.
     *
     * @param array<string, mixed> $doc the locked document (LOCK_SUPPLEMENTAL_SQL)
     */
    public function insertSupplemental(Authorization $auth, string $postingId, array $doc, string $key): void
    {
        self::supplementalAuthorized($auth);
        if ($doc['status'] !== 'Committed') {
            throw new \LogicException('a Supplemental posting is made only from a Committed document');
        }
        $this->db->execute($auth, self::INSERT_SUPPLEMENTAL_SQL, self::values(self::id((string) $doc['id']), $postingId, $doc, (string) $doc['overtime_amount'], $key));
    }

    /**
     * @param array<string, mixed> $source the locked source row
     * @return array<string, string>
     */
    private static function values(string $sourceId, string $postingId, array $source, string $amount, string $key): array
    {
        return [
            'id' => $sourceId,
            'posting_id' => self::id($postingId),
            'employee_id' => (string) $source['employee_id'],
            'month_key' => (string) $source['month_key'],
            'amount' => $amount,
            'idempotency_key' => self::key($key),
        ];
    }

    private static function companyOnly(Scope $scope): void
    {
        if ($scope->isSelf()) {
            throw new \LogicException('Finance posting reads are company scope only');
        }
    }

    private static function id(string $id): string
    {
        if (preg_match('/^[0-9a-f]{32}$/', $id) !== 1) {
            throw new \LogicException('a posting, base plan or Supplemental id is 32 lowercase hex characters');
        }
        return $id;
    }

    private static function key(string $key): string
    {
        if (preg_match('/^[0-9a-f]{32}$/', $key) !== 1) {
            throw new \LogicException('a posting idempotency key is 32 lowercase hex characters');
        }
        return $key;
    }

    /**
     * A posting is authorized by the Action of its source domain, in company scope: payroll.manage
     * against the base plan, or the record-free supplemental.manage (an Employee never reaches one).
     */
    private static function authorized(Authorization $auth): Authorization
    {
        $plan = $auth->action === Action::PayrollManage && $auth->record !== null && $auth->record->entity === self::PAYROLL_PLAN;
        $supplemental = $auth->action === Action::SupplementalManage && $auth->record === null;
        if ((!$plan && !$supplemental) || $auth->scope->isSelf()) {
            throw new \LogicException('a posting needs payroll.manage on its plan or supplemental.manage, in company scope');
        }
        return $auth;
    }

    /** The id of the base plan a payroll.manage posting Authorization was decided on. */
    private static function planAuthorized(Authorization $auth): string
    {
        if (self::authorized($auth)->action !== Action::PayrollManage) {
            throw new \LogicException('a base plan posting is authorized under payroll.manage');
        }
        return self::id($auth->record->id);
    }

    private static function supplementalAuthorized(Authorization $auth): Authorization
    {
        if (self::authorized($auth)->action !== Action::SupplementalManage) {
            throw new \LogicException('a Supplemental posting is authorized under supplemental.manage');
        }
        return $auth;
    }
}
