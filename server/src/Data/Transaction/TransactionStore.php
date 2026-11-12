<?php
declare(strict_types=1);

namespace TamOs\Data\Transaction;

use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Scope;

/**
 * The server general transaction (Phase 1, D-INT-1; migrations 0036–0037): one income or expense
 * of the company, allocated to exactly one Financial Post, with a separate free-text category. It
 * is never payroll — payroll obligations keep their own Finance posting and execution — and it is
 * CEO company scope only: there is no Employee statement.
 *
 * The one writer of finance_transactions and finance_transaction_voids, and it only inserts. A
 * transaction is immutable (no UPDATE, no DELETE): a mistake is corrected by voiding it — one
 * insert-only void row naming the reason, the actor and the time — and recording a new one. The
 * status (Active | Voided) is DERIVED from whether a void row exists, never stored, so a stored
 * status can never contradict the void history. The database holds at most one void per
 * transaction and each idempotency key once per company per table.
 *
 * Both writes are authorized by the existing record-free finance.manage (CeoOnly; ACTIONS stay 21).
 * A void locks its transaction by primary key, so two voids of one transaction serialize. The money
 * is stored as the exact "N.00" string the CEO entered: no SQL arithmetic.
 */
final class TransactionStore
{
    /** A range list fails closed above this many rows (read with LIST_LIMIT). */
    public const LIST_CAP = 2000;
    public const LIST_LIMIT = 2001;

    // Reads (CEO company scope): the transaction with its void, if any.
    public const RECORD_SQL = 'SELECT t.id, t.company_id, NULL AS owner_employee_id, t.kind, t.financial_post, t.category, t.description, t.amount, t.transaction_date, t.created_by_user_id, t.created_at, v.id AS void_id, v.reason AS void_reason, v.voided_by_user_id, v.voided_at FROM finance_transactions t LEFT JOIN finance_transaction_voids v ON v.company_id = t.company_id AND v.finance_transaction_id = t.id WHERE t.id = :id AND t.company_id = :company_id';
    public const RANGE_SQL = 'SELECT t.id, t.company_id, NULL AS owner_employee_id, t.kind, t.financial_post, t.category, t.description, t.amount, t.transaction_date, t.created_by_user_id, t.created_at, v.id AS void_id, v.reason AS void_reason, v.voided_by_user_id, v.voided_at FROM finance_transactions t LEFT JOIN finance_transaction_voids v ON v.company_id = t.company_id AND v.finance_transaction_id = t.id WHERE t.company_id = :company_id AND t.transaction_date >= :from_date AND t.transaction_date <= :to_date ORDER BY t.transaction_date, t.created_at, t.id LIMIT 2001';

    // Read before an insert: the row already holding an idempotency key.
    public const KEY_HOLDER_SQL = 'SELECT id, company_id, NULL AS owner_employee_id, kind, financial_post, category, description, amount, transaction_date FROM finance_transactions WHERE company_id = :company_id AND idempotency_key = :idempotency_key';
    public const VOID_KEY_HOLDER_SQL = 'SELECT id, company_id, NULL AS owner_employee_id, finance_transaction_id, reason FROM finance_transaction_voids WHERE company_id = :company_id AND idempotency_key = :idempotency_key';

    // The one lock — the transaction a void names, by primary key — and its void, read under it.
    public const LOCK_SQL = 'SELECT id, company_id, NULL AS owner_employee_id FROM finance_transactions WHERE id = :id AND company_id = :company_id FOR UPDATE';
    public const TRANSACTION_VOID_SQL = 'SELECT id, company_id, NULL AS owner_employee_id FROM finance_transaction_voids WHERE company_id = :company_id AND finance_transaction_id = :id';

    // The two writes.
    public const INSERT_SQL = 'INSERT INTO finance_transactions (id, company_id, kind, financial_post, category, description, amount, transaction_date, created_by_user_id, idempotency_key, created_at) VALUES (:id, :company_id, :kind, :financial_post, :category, :description, :amount, :transaction_date, :created_by_user_id, :idempotency_key, UTC_TIMESTAMP(6))';
    public const INSERT_VOID_SQL = 'INSERT INTO finance_transaction_voids (id, company_id, finance_transaction_id, reason, voided_by_user_id, idempotency_key, voided_at) VALUES (:void_id, :company_id, :id, :reason, :voided_by_user_id, :idempotency_key, UTC_TIMESTAMP(6))';

    public function __construct(private readonly ScopedDatabase $db)
    {
    }

    /** @return array<string, mixed>|null one transaction with its void columns (CEO), or null */
    public function record(Scope $scope, string $id): ?array
    {
        self::companyOnly($scope);
        return $this->db->select($scope, self::RECORD_SQL, ['id' => self::hex($id)])[0] ?? null;
    }

    /**
     * Every transaction dated $from..$to inclusive — at most LIST_LIMIT rows, so a caller can tell
     * that LIST_CAP was exceeded. CEO only.
     *
     * @return list<array<string, mixed>>
     */
    public function range(Scope $scope, string $from, string $to): array
    {
        self::companyOnly($scope);
        return $this->db->select($scope, self::RANGE_SQL, ['from_date' => self::date($from), 'to_date' => self::date($to)]);
    }

    /** @return array<string, mixed>|null the transaction holding this idempotency key, or null */
    public function keyHolder(Authorization $auth, string $key): ?array
    {
        return $this->db->select(self::authorized($auth)->scope, self::KEY_HOLDER_SQL, ['idempotency_key' => self::hex($key)])[0] ?? null;
    }

    /** @return array<string, mixed>|null the void holding this idempotency key, or null */
    public function voidKeyHolder(Authorization $auth, string $key): ?array
    {
        return $this->db->select(self::authorized($auth)->scope, self::VOID_KEY_HOLDER_SQL, ['idempotency_key' => self::hex($key)])[0] ?? null;
    }

    /**
     * Inserts one transaction. The values are the validated input; the creator is the actor.
     *
     * @param array{kind: string, financialPost: string, category: string, description: string, amount: string, transactionDate: string, idempotencyKey: string} $in
     */
    public function insert(Authorization $auth, string $id, array $in, string $actorUserId): void
    {
        $this->db->execute(self::authorized($auth), self::INSERT_SQL, [
            'id' => self::hex($id),
            'kind' => $in['kind'],
            'financial_post' => $in['financialPost'],
            'category' => $in['category'],
            'description' => $in['description'],
            'amount' => $in['amount'],
            'transaction_date' => self::date($in['transactionDate']),
            'created_by_user_id' => self::hex($actorUserId),
            'idempotency_key' => self::hex($in['idempotencyKey']),
        ]);
    }

    /**
     * Step 1 of a void: locks the transaction by primary key, or null.
     *
     * @return array<string, mixed>|null
     */
    public function lock(Authorization $auth, string $id): ?array
    {
        return $this->db->select(self::authorized($auth)->scope, self::LOCK_SQL, ['id' => self::hex($id)])[0] ?? null;
    }

    /** The id of the void of transaction $id, or null — read under its lock. */
    public function voidOf(Authorization $auth, string $id): ?string
    {
        $rows = $this->db->select(self::authorized($auth)->scope, self::TRANSACTION_VOID_SQL, ['id' => self::hex($id)]);
        return isset($rows[0]) ? (string) $rows[0]['id'] : null;
    }

    /** Inserts the one void of the locked transaction $id. */
    public function insertVoid(Authorization $auth, string $voidId, string $id, string $reason, string $actorUserId, string $key): void
    {
        $this->db->execute(self::authorized($auth), self::INSERT_VOID_SQL, [
            'void_id' => self::hex($voidId),
            'id' => self::hex($id),
            'reason' => $reason,
            'voided_by_user_id' => self::hex($actorUserId),
            'idempotency_key' => self::hex($key),
        ]);
    }

    private static function companyOnly(Scope $scope): void
    {
        if ($scope->isSelf()) {
            throw new \LogicException('general transaction reads are company scope only');
        }
    }

    /** Both writes are the record-free finance.manage, in company scope (an Employee never reaches one). */
    private static function authorized(Authorization $auth): Authorization
    {
        if ($auth->action !== Action::FinanceManage || $auth->record !== null || $auth->scope->isSelf()) {
            throw new \LogicException('a general transaction write needs finance.manage, in company scope');
        }
        return $auth;
    }

    private static function hex(string $v): string
    {
        if (preg_match('/^[0-9a-f]{32}$/', $v) !== 1) {
            throw new \LogicException('a transaction, void, user id or key is 32 lowercase hex characters');
        }
        return $v;
    }

    private static function date(string $v): string
    {
        if (preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/', $v) !== 1) {
            throw new \LogicException('a transaction date is YYYY-MM-DD');
        }
        return $v;
    }
}
