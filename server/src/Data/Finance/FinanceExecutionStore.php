<?php
declare(strict_types=1);

namespace TamOs\Data\Finance;

use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Scope;

/**
 * The server Finance execution (BF-4f, migration 0034; owner decisions D-FEX-1..8 = A): one
 * append-only record that one Planned Finance posting was paid in full outside TAM OS — TAM OS moves
 * no money. Every read, lock and write is CEO company scope only; there is no Employee statement.
 *
 * The one writer of finance_executions, and it only inserts: an execution is immutable (no UPDATE,
 * no DELETE — no reversal and no correction). Its one INSERT writes the locked posting's own
 * employee, month and amount, the caller's date, payment method and idempotency key; the database
 * holds at most one execution per posting (D-FEX-2 = A) and each key once per company. An execution
 * is authorized by the record-free finance.execute (D-FEX-4 = A), so its INSERT names the posting as
 * :finance_posting_id.
 *
 * The posting is READ and locked only, never written (D-FEX-1 = A): finance_postings keeps its one
 * writer and every posting stays Planned. An execution locks exactly one row — the posting, by
 * primary key — so it serializes with every other execution of that posting and never cycles with a
 * posting (BF-4e locks employee → source and only inserts postings). The money is copied as the
 * exact stored string: no SQL arithmetic.
 */
final class FinanceExecutionStore
{
    /** A month list fails closed above this many rows (read with LIST_LIMIT). */
    public const LIST_CAP = 2000;
    public const LIST_LIMIT = 2001;

    // Execution reads (CEO company scope).
    public const RECORD_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, finance_posting_id, employee_id, month_key, amount, executed_on, payment_method FROM finance_executions WHERE id = :id AND company_id = :company_id';
    public const MONTH_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, finance_posting_id, employee_id, month_key, amount, executed_on, payment_method FROM finance_executions WHERE company_id = :company_id AND month_key = :month_key ORDER BY employee_id, recorded_at, id LIMIT 2001';

    // The one lock — the posting, by primary key.
    public const LOCK_POSTING_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, amount, status FROM finance_postings WHERE id = :id AND company_id = :company_id FOR UPDATE';

    // Read under the lock: the execution already holding an idempotency key, and the execution of a posting.
    public const KEY_HOLDER_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, finance_posting_id, amount, executed_on, payment_method FROM finance_executions WHERE company_id = :company_id AND idempotency_key = :idempotency_key';
    public const POSTING_EXECUTION_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id FROM finance_executions WHERE company_id = :company_id AND finance_posting_id = :id';

    // The one write — the full execution of the locked, Planned posting.
    public const INSERT_SQL = 'INSERT INTO finance_executions (id, company_id, finance_posting_id, employee_id, month_key, amount, executed_on, payment_method, idempotency_key, recorded_at) VALUES (:execution_id, :company_id, :finance_posting_id, :employee_id, :month_key, :amount, :executed_on, :payment_method, :idempotency_key, UTC_TIMESTAMP(6))';

    public function __construct(private readonly ScopedDatabase $db)
    {
    }

    /** @return array<string, mixed>|null one execution (CEO), or null */
    public function record(Scope $scope, string $id): ?array
    {
        self::companyOnly($scope);
        return $this->db->select($scope, self::RECORD_SQL, ['id' => self::id($id)])[0] ?? null;
    }

    /**
     * Every execution of one month — at most LIST_LIMIT rows, so a caller can tell that LIST_CAP was
     * exceeded. CEO only.
     *
     * @return list<array<string, mixed>>
     */
    public function month(Scope $scope, string $monthKey): array
    {
        self::companyOnly($scope);
        return $this->db->select($scope, self::MONTH_SQL, ['month_key' => $monthKey]);
    }

    /**
     * Step 1 of an execution: locks the posting by primary key and returns its employee, month,
     * amount and status, or null.
     *
     * @return array<string, mixed>|null
     */
    public function lockPosting(Authorization $auth, string $postingId): ?array
    {
        return $this->db->select(self::authorized($auth)->scope, self::LOCK_POSTING_SQL, ['id' => self::id($postingId)])[0] ?? null;
    }

    /** @return array<string, mixed>|null the company's execution holding this idempotency key, or null */
    public function keyHolder(Authorization $auth, string $key): ?array
    {
        return $this->db->select(self::authorized($auth)->scope, self::KEY_HOLDER_SQL, ['idempotency_key' => self::key($key)])[0] ?? null;
    }

    /** The id of the execution of a posting, or null. */
    public function postingExecution(Authorization $auth, string $postingId): ?string
    {
        $rows = $this->db->select(self::authorized($auth)->scope, self::POSTING_EXECUTION_SQL, ['id' => self::id($postingId)]);
        return isset($rows[0]) ? (string) $rows[0]['id'] : null;
    }

    /**
     * Inserts the full execution of the locked, Planned posting $posting.
     *
     * @param array<string, mixed> $posting the locked posting (LOCK_POSTING_SQL)
     */
    public function insert(Authorization $auth, string $executionId, array $posting, string $executedOn, string $paymentMethod, string $key): void
    {
        if ($posting['status'] !== 'Planned') {
            throw new \LogicException('an execution is recorded only for a Planned posting');
        }
        $this->db->execute(self::authorized($auth), self::INSERT_SQL, [
            'execution_id' => self::id($executionId),
            'finance_posting_id' => self::id((string) $posting['id']),
            'employee_id' => (string) $posting['employee_id'],
            'month_key' => (string) $posting['month_key'],
            'amount' => (string) $posting['amount'],
            'executed_on' => $executedOn,
            'payment_method' => $paymentMethod,
            'idempotency_key' => self::key($key),
        ]);
    }

    private static function companyOnly(Scope $scope): void
    {
        if ($scope->isSelf()) {
            throw new \LogicException('Finance execution reads are company scope only');
        }
    }

    private static function id(string $id): string
    {
        if (preg_match('/^[0-9a-f]{32}$/', $id) !== 1) {
            throw new \LogicException('an execution or posting id is 32 lowercase hex characters');
        }
        return $id;
    }

    private static function key(string $key): string
    {
        if (preg_match('/^[0-9a-f]{32}$/', $key) !== 1) {
            throw new \LogicException('an execution idempotency key is 32 lowercase hex characters');
        }
        return $key;
    }

    /** An execution is authorized by the record-free finance.execute, in company scope (an Employee never reaches one). */
    private static function authorized(Authorization $auth): Authorization
    {
        if ($auth->action !== Action::FinanceExecute || $auth->record !== null || $auth->scope->isSelf()) {
            throw new \LogicException('an execution needs the record-free finance.execute, in company scope');
        }
        return $auth;
    }
}
