<?php
declare(strict_types=1);

namespace TamOs\Finance;

use TamOs\Data\BusinessData;
use TamOs\Data\DatabaseError;
use TamOs\Data\Finance\FinanceExecutionStore;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Policy\Action;
use TamOs\Policy\Policy;
use TamOs\Policy\Scope;

/**
 * The server Finance execution operations (BF-4f; owner decisions D-FEX-1..8 = A): the ordering and
 * transaction boundaries of recording that one Planned Finance posting was paid in full outside TAM
 * OS. TAM OS moves no money. It owns no SQL and never takes a company, an employee, a role, an amount,
 * a month or a status from a browser — the company and actor come from the session principal, the
 * amount, employee and month from the locked posting.
 *
 * Execution is an explicit command per posting — never automatic, never a batch — and it creates a
 * separate, append-only execution record (D-FEX-1 = A): the posting is read and locked, never
 * written, and stays Planned. Exactly one execution per posting, for the posting's full amount
 * (D-FEX-2 = A): no partial, over- or under-payment, no reversal, no correction, no reconciliation
 * and no company account (D-FEX-5 = A).
 *
 * Authorization is the existing finance.execute (D-FEX-4 = A, ACTIONS stay 21): CEO-only and
 * record-free, so the kernel decides it before the handler; the month read is CEO-only too (an
 * Employee is 403 before any lookup).
 *
 *   month    validate (400) → CEO (403) → the month's executions
 *   execute  validate exactly { financePostingId, expectedAmount, executedOn, paymentMethod,
 *            idempotencyKey } (400; executedOn no later than today in the company calendar) → CEO
 *            (403) → one READ COMMITTED transaction: lock the posting by primary key (404) → the
 *            idempotency key: held by the execution of this same posting with this same amount, date
 *            and payment method → that execution, replayed (no write, no audit); held by any other
 *            execution → 409 idempotency_mismatch → the posting has no execution yet (409
 *            finance_executed) → expectedAmount equals the locked amount as an exact string (409
 *            finance_amount) → insert the execution with the posting's employee, month and exact
 *            amount, the date, the payment method and the key → audit 'execute' on the posting,
 *            under finance.execute. A duplicate key raised by that insert is a concurrent execution
 *            that took the same key or the same posting: 409. A refused or failed execution stores
 *            nothing and consumes no key. Every 409 reaches the browser as the generic conflict.
 */
final class FinanceExecutionService
{
    /** MariaDB ER_DUP_ENTRY: under an execution, only the per-posting or the per-key unique key can raise it. */
    private const DUPLICATE_KEY = 1062;

    public function __construct(private readonly BusinessData $data)
    {
    }

    /** @return list<array<string, mixed>> every execution of $month (CEO only) */
    public function month(Principal $actor, ?string $month): array
    {
        $monthKey = FinanceExecutionInput::month($month);   // 400 before any lookup
        $scope = self::companyScope($actor);                // an Employee: 403 before any lookup
        $rows = $this->data->financeExecutions()->month($scope, $monthKey);
        if (count($rows) > FinanceExecutionStore::LIST_CAP) {
            throw new ApiError(ErrorCode::InternalError, 'finance execution month above its cap', logReason: 'finance_list_cap');
        }
        return $rows;
    }

    /**
     * Records the full execution of one Planned posting.
     *
     * @param array<string, mixed> $json
     * @return array<string, mixed> the execution (the original one on a replay)
     */
    public function execute(Principal $actor, array $json, string $requestId): array
    {
        $in = FinanceExecutionInput::execute($json, FinanceExecutionInput::today(new \DateTimeImmutable('now'))); // 400 before any lookup
        $scope = self::companyScope($actor);                // an Employee: 403 before any lookup
        $auth = Policy::authorize($actor, Action::FinanceExecute);
        $store = $this->data->financeExecutions();
        $id = $this->data->atomically(function () use ($auth, $actor, $store, $in, $requestId): string {
            // The one lock: the posting, by primary key → (plain reads) → execution → audit.
            $posting = $store->lockPosting($auth, $in['financePostingId']) ?? throw new ApiError(ErrorCode::NotFound);
            $holder = $store->keyHolder($auth, $in['idempotencyKey']);
            if ($holder !== null) {
                if ($holder['finance_posting_id'] === $in['financePostingId'] && (string) $holder['amount'] === $in['expectedAmount']
                    && (string) $holder['executed_on'] === $in['executedOn'] && $holder['payment_method'] === $in['paymentMethod']) {
                    return (string) $holder['id'];          // the original execution: no write, no audit
                }
                throw new ApiError(ErrorCode::Conflict, logReason: 'idempotency_mismatch');
            }
            if ($store->postingExecution($auth, $in['financePostingId']) !== null) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'finance_executed');
            }
            if ((string) $posting['amount'] !== $in['expectedAmount']) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'finance_amount');
            }
            $executionId = bin2hex(random_bytes(16));
            try {
                $store->insert($auth, $executionId, $posting, $in['executedOn'], $in['paymentMethod'], $in['idempotencyKey']);
            } catch (DatabaseError $e) {
                if ($e->driverCode === self::DUPLICATE_KEY) {
                    throw new ApiError(ErrorCode::Conflict, logReason: 'finance_duplicate');
                }
                throw $e;
            }
            $this->data->audit()->appendExecution($auth, $actor, $in['financePostingId'], $requestId);
            return $executionId;
        }, readCommitted: true);
        return $store->record($scope, $id) ?? throw new \LogicException('execution not readable');
    }

    /** Every Finance execution route is CEO-only — an Employee principal is refused before any lookup. */
    private static function companyScope(Principal $actor): Scope
    {
        $scope = Scope::of($actor);
        if ($scope->isSelf()) {
            throw new ApiError(ErrorCode::Forbidden, 'action denied', logReason: 'action_denied');
        }
        return $scope;
    }
}
