<?php
declare(strict_types=1);

namespace TamOs\Transaction;

use TamOs\Data\BusinessData;
use TamOs\Data\DatabaseError;
use TamOs\Data\Transaction\TransactionStore;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Policy\Action;
use TamOs\Policy\Policy;
use TamOs\Policy\Scope;

/**
 * The server general transaction operations (Phase 1, D-INT-1): record one income or expense
 * against a Financial Post, void one, and read a date range. It owns no SQL and never takes a
 * company, a creator, a role or a status from a browser — the company and the actor come from the
 * session principal, the status is derived from the void history.
 *
 * Both writes are the existing record-free finance.manage (CeoOnly), decided by the kernel before
 * the handler and again here (an Employee is 403 before any lookup). ACTIONS stay 21. Each write
 * and its audit row ('create' or 'void' under finance.manage on entity financeTransaction, no field,
 * no value — migration 0038) commit in one transaction or not at all.
 *
 *   range   validate (400) → CEO (403) → the transactions dated in the range, at most LIST_CAP
 *   create  validate exactly the seven keys (400) → CEO (403) → one READ COMMITTED transaction: the
 *           idempotency key held by a transaction with exactly these values → that transaction,
 *           replayed (no write, no audit); held by any other → 409 idempotency_mismatch → insert →
 *           audit 'create'. A duplicate key raised by the insert is a concurrent create of the
 *           same key: 409.
 *   void    validate exactly { financeTransactionId, reason, idempotencyKey } (400) → CEO (403) →
 *           one READ COMMITTED transaction: lock the transaction by primary key (404) → the key
 *           held by a void of this transaction with this reason → replayed; held by any other void
 *           → 409 idempotency_mismatch → already voided → 409 transaction_voided → insert the void
 *           → audit 'void'. A refused or failed write stores nothing and consumes no key.
 */
final class TransactionService
{
    /** MariaDB ER_DUP_ENTRY: only the per-key (and, for a void, the per-transaction) unique key can raise it. */
    private const DUPLICATE_KEY = 1062;

    public function __construct(private readonly BusinessData $data)
    {
    }

    /** @return list<array<string, mixed>> every transaction dated $from..$to (CEO only) */
    public function range(Principal $actor, ?string $from, ?string $to): array
    {
        $range = TransactionInput::range($from, $to);       // 400 before any lookup
        $scope = self::companyScope($actor);                // an Employee: 403 before any lookup
        $rows = $this->data->transactions()->range($scope, $range['from'], $range['to']);
        if (count($rows) > TransactionStore::LIST_CAP) {
            throw new ApiError(ErrorCode::InternalError, 'general transaction range above its cap', logReason: 'transaction_list_cap');
        }
        return $rows;
    }

    /**
     * @param array<string, mixed> $json
     * @return array<string, mixed> the transaction (the original one on a replay)
     */
    public function create(Principal $actor, array $json, string $requestId): array
    {
        $in = TransactionInput::create($json, TransactionInput::today(new \DateTimeImmutable('now'))); // 400 before any lookup
        $scope = self::companyScope($actor);                // an Employee: 403 before any lookup
        $auth = Policy::authorize($actor, Action::FinanceManage);
        $store = $this->data->transactions();
        $id = $this->data->atomically(function () use ($auth, $actor, $store, $in, $requestId): string {
            $holder = $store->keyHolder($auth, $in['idempotencyKey']);
            if ($holder !== null) {
                if (self::sameCreate($holder, $in)) {
                    return (string) $holder['id'];          // the original transaction: no write, no audit
                }
                throw new ApiError(ErrorCode::Conflict, logReason: 'idempotency_mismatch');
            }
            $transactionId = bin2hex(random_bytes(16));
            self::insert(static fn () => $store->insert($auth, $transactionId, $in, $actor->userId));
            $this->data->audit()->appendTransaction($auth, $actor, 'create', $transactionId, $requestId);
            return $transactionId;
        }, readCommitted: true);
        return $store->record($scope, $id) ?? throw new \LogicException('transaction not readable');
    }

    /**
     * @param array<string, mixed> $json
     * @return array<string, mixed> the voided transaction (the same one on a replay)
     */
    public function void(Principal $actor, array $json, string $requestId): array
    {
        $in = TransactionInput::void($json);                // 400 before any lookup
        $scope = self::companyScope($actor);                // an Employee: 403 before any lookup
        $auth = Policy::authorize($actor, Action::FinanceManage);
        $store = $this->data->transactions();
        $this->data->atomically(function () use ($auth, $actor, $store, $in, $requestId): void {
            // The one lock: the transaction, by primary key → (plain reads) → void → audit.
            $store->lock($auth, $in['financeTransactionId']) ?? throw new ApiError(ErrorCode::NotFound);
            $holder = $store->voidKeyHolder($auth, $in['idempotencyKey']);
            if ($holder !== null) {
                if ($holder['finance_transaction_id'] === $in['financeTransactionId'] && (string) $holder['reason'] === $in['reason']) {
                    return;                                 // the original void: no write, no audit
                }
                throw new ApiError(ErrorCode::Conflict, logReason: 'idempotency_mismatch');
            }
            if ($store->voidOf($auth, $in['financeTransactionId']) !== null) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'transaction_voided');
            }
            $voidId = bin2hex(random_bytes(16));
            self::insert(static fn () => $store->insertVoid($auth, $voidId, $in['financeTransactionId'], $in['reason'], $actor->userId, $in['idempotencyKey']));
            $this->data->audit()->appendTransaction($auth, $actor, 'void', $in['financeTransactionId'], $requestId);
        }, readCommitted: true);
        return $store->record($scope, $in['financeTransactionId']) ?? throw new \LogicException('transaction not readable');
    }

    /**
     * @param array<string, mixed> $holder the row holding the key (TransactionStore::KEY_HOLDER_SQL)
     * @param array<string, string> $in
     */
    private static function sameCreate(array $holder, array $in): bool
    {
        return $holder['kind'] === $in['kind'] && $holder['financial_post'] === $in['financialPost']
            && (string) $holder['category'] === $in['category'] && (string) $holder['description'] === $in['description']
            && (string) $holder['amount'] === $in['amount'] && (string) $holder['transaction_date'] === $in['transactionDate'];
    }

    /** Runs the one INSERT; a unique key it raises is a concurrent write of the same key or void: 409. */
    private static function insert(\Closure $write): void
    {
        try {
            $write();
        } catch (DatabaseError $e) {
            if ($e->driverCode === self::DUPLICATE_KEY) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'transaction_duplicate');
            }
            throw $e;
        }
    }

    /** Every general transaction route is CEO-only — an Employee principal is refused before any lookup. */
    private static function companyScope(Principal $actor): Scope
    {
        $scope = Scope::of($actor);
        if ($scope->isSelf()) {
            throw new ApiError(ErrorCode::Forbidden, 'action denied', logReason: 'action_denied');
        }
        return $scope;
    }
}
