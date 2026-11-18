<?php
declare(strict_types=1);

namespace TamOs\Request;

use TamOs\Data\BusinessData;
use TamOs\Data\DatabaseError;
use TamOs\Data\Request\RequestStore;
use TamOs\Data\Scope\ScopedRecord;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Policy;
use TamOs\Policy\Scope;
use TamOs\Transaction\TransactionInput;

/**
 * The server finance request operations (Phase 2, ADR-016): payment requests and reimbursements,
 * one lifecycle, and the atomic payment that records the linked general expense. It owns no SQL and
 * never takes a company, an owner, a creator, a role or a status from a browser — the company and the
 * actor come from the session principal, a reimbursement's owner from an employee record read in
 * scope (or, for an Employee, the Scope itself).
 *
 * Order of every write (spec §2): validate (400) → the record-free CeoOnly check where it applies
 * (403 before any lookup) → the scoped load (404: absent and out of scope alike) → Policy (403: in
 * scope, not permitted) → one READ COMMITTED transaction whose first lock is by primary key → the
 * state, version and amount guards (409) → the write and its audit row(s) → commit, or nothing.
 *
 *   list / read  CEO company scope, Employee self scope (own reimbursements only); a list fails
 *                closed above RequestStore::LIST_CAP
 *   create       paymentRequest: finance.manage (record-free). reimbursement: the employee in scope
 *                (404) → a Draft candidate → reimbursement.createSelfDraft (403) → lock the employee
 *                by PK → the create key (replay | 409 idempotency_mismatch) → refuse an archived or
 *                not-Active employee (409, R1 = A) → insert + audit
 *   update       scoped load → finance.manage | reimbursement.updateSelfDraft → lock the request →
 *                Draft and version (409) → the kind-dependent field rules (400) → compare-and-swap +
 *                audit naming the changed fields; nothing changed → no write, no audit, same version
 *   submit       scoped load → finance.manage | reimbursement.submitSelf → (reimbursement: lock the
 *                employee by PK, refuse archived / not-Active, R1 = A) → lock the request → Draft and
 *                version (409) → Submitted + audit
 *   approve / reject / cancel  finance.manage before any lookup → company load (404) → lock the
 *                request → legal source, version and (approve) the exact amount (409) → the status
 *                (with its reason) + audit. Never the employee.
 *   pay          finance.execute before any lookup → §5 steps 1–8 (see pay())
 *
 * Paid, Rejected and Cancelled accept no operation (409, nothing written).
 */
final class RequestService
{
    /** MariaDB ER_DUP_ENTRY: a concurrent create or payment of the same key, or a second payment of one request. */
    private const DUPLICATE_KEY = 1062;

    public function __construct(private readonly BusinessData $data)
    {
    }

    /** @return list<array<string, mixed>> the scope's requests in the documentDate range */
    public function list(Principal $actor, ?string $from, ?string $to, ?string $status, ?string $kind): array
    {
        $q = RequestInput::list($from, $to, $status, $kind);   // 400 before any lookup
        $rows = $this->data->requests()->list(Scope::of($actor), $q['from'], $q['to'], $q['status'], $q['kind']);
        if (count($rows) > RequestStore::LIST_CAP) {
            throw new ApiError(ErrorCode::InternalError, 'finance request list above its cap', logReason: 'finance_request_list_cap');
        }
        return $rows;
    }

    /** @return array<string, mixed> the request the principal may read */
    public function read(Principal $actor, ?string $id): array
    {
        $id = RequestInput::id($id);                            // 400 before any lookup
        return $this->data->requests()->record(Scope::of($actor), $id) ?? throw new ApiError(ErrorCode::NotFound);
    }

    /**
     * @param array<string, mixed> $json
     * @return array<string, mixed> the created Draft (the original one on a replay)
     */
    public function create(Principal $actor, array $json, string $requestId): array
    {
        $scope = Scope::of($actor);
        $in = RequestInput::create($json, self::today(), $scope->isSelf()); // 400 before any lookup
        $store = $this->data->requests();
        $id = bin2hex(random_bytes(16));
        if ($in['kind'] === RequestStatus::KIND_PAYMENT_REQUEST) {
            $auth = Policy::authorize($actor, Action::FinanceManage);     // an Employee: 403 before any lookup
        } else {
            $employeeId = $scope->isSelf() ? (string) $scope->selfEmployeeId : (string) $in['employeeId'];
            $employee = $this->data->employees()->find($scope, $employeeId) ?? throw new ApiError(ErrorCode::NotFound);
            $auth = Policy::authorize($actor, Action::ReimbursementCreateSelfDraft, $store->candidate($employee, $id));
        }
        $created = $this->data->atomically(function () use ($auth, $actor, $store, $in, $id, $requestId): string {
            if ($in['kind'] === RequestStatus::KIND_REIMBURSEMENT) {
                // Lock order (R1 = A, C4): the employee row by primary key, first.
                $eligibility = $store->lockEmployee($auth) ?? throw new ApiError(ErrorCode::NotFound);
            }
            $holder = $store->keyHolder($auth, $in['idempotencyKey']);
            if ($holder !== null) {
                if (self::sameCreate($holder, $in, $auth)) {
                    return (string) $holder['id'];                       // the original request: no write, no audit
                }
                throw new ApiError(ErrorCode::Conflict, logReason: 'idempotency_mismatch');
            }
            if (isset($eligibility)) {
                self::eligible($eligibility);
            }
            self::insert(static fn () => $store->create($auth, $id, $in, $actor->userId));
            $fields = $in['kind'] === RequestStatus::KIND_PAYMENT_REQUEST ? RequestInput::FIELDS : array_values(array_diff(RequestInput::FIELDS, ['payee']));
            $this->data->audit()->appendRequest($auth, $actor, 'create', $id, $fields, $requestId);
            return $id;
        }, readCommitted: true);
        return $store->record($auth->scope, $created) ?? throw new \LogicException('created finance request not readable');
    }

    /**
     * @param array<string, mixed> $json
     * @return array<string, mixed> the request after the update
     */
    public function update(Principal $actor, array $json, string $requestId): array
    {
        $in = RequestInput::update($json);                      // 400 before any lookup
        [$auth, $kind] = $this->authorized($actor, 'update', $in['financeRequestId']);
        $store = $this->data->requests();
        $today = self::today();
        $this->data->atomically(function () use ($auth, $actor, $store, $in, $kind, $today, $requestId): void {
            $current = $this->locked($auth, $in['financeRequestId'], 'update', $in['expectedVersion']);
            $before = RequestView::editable($current);
            $after = RequestInput::applyUpdate($kind, $before, $in['patch'], $today);
            $changed = RequestInput::changed($before, $after);
            if ($changed === []) {
                return;                                         // nothing differs: no write, no audit, same version
            }
            /** @var array{financialPost: string, category: string, description: string, amount: string, payee: ?string, documentDate: string} $after */
            if ($store->update($auth, $in['financeRequestId'], $in['expectedVersion'], $after) !== 1) {
                throw new \LogicException('update: the locked Draft did not change');
            }
            $this->data->audit()->appendRequest($auth, $actor, 'update', $in['financeRequestId'], $changed, $requestId);
        }, readCommitted: true);
        return $store->record($auth->scope, $in['financeRequestId']) ?? throw new \LogicException('updated finance request not readable');
    }

    /**
     * submit, approve, reject or cancel.
     *
     * @param array<string, mixed> $json
     * @return array<string, mixed> the request in its new status
     */
    public function transition(Principal $actor, string $operation, array $json, string $requestId): array
    {
        $in = match ($operation) {
            'submit' => RequestInput::transition($json) + ['expectedAmount' => null, 'reason' => null],
            'approve' => RequestInput::approve($json) + ['reason' => null],
            'reject', 'cancel' => RequestInput::withReason($json) + ['expectedAmount' => null],
            default => throw new \LogicException('unknown finance request transition'),
        };                                                      // 400 before any lookup
        if ($operation === 'submit') {
            [$auth, $kind] = $this->authorized($actor, 'submit', $in['financeRequestId']);
        } else {
            $auth = Policy::authorize($actor, Action::FinanceManage);     // an Employee: 403 before any lookup
            $this->data->requests()->find($auth->scope, $in['financeRequestId']) ?? throw new ApiError(ErrorCode::NotFound);
            $kind = null;
        }
        $store = $this->data->requests();
        $this->data->atomically(function () use ($auth, $actor, $store, $operation, $in, $kind, $requestId): void {
            if ($operation === 'submit' && $kind === RequestStatus::KIND_REIMBURSEMENT) {
                // Lock order (R1 = A, C4): the employee row by primary key, then the request row.
                self::eligible($store->lockEmployee($auth) ?? throw new ApiError(ErrorCode::NotFound));
            }
            $current = $this->locked($auth, $in['financeRequestId'], $operation, $in['expectedVersion']);
            if ($operation === 'approve' && (string) $current['amount'] !== $in['expectedAmount']) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'finance_request_amount');
            }
            $from = (string) $current['status'];
            $to = RequestStatus::target($operation, $from) ?? throw new \LogicException('transition: no target');
            if ($store->transition($auth, $in['financeRequestId'], $in['expectedVersion'], $from, $to, $in['reason']) !== 1) {
                throw new \LogicException('transition: the locked request did not change');
            }
            $this->data->audit()->appendRequest($auth, $actor, $operation, $in['financeRequestId'], [], $requestId);
        }, readCommitted: true);
        return $store->record($auth->scope, $in['financeRequestId']) ?? throw new \LogicException('transitioned finance request not readable');
    }

    /**
     * Records the payment of an Approved request (ADR-016 §5), in one READ COMMITTED transaction:
     *   1. lock the request by primary key (404) — the only row lock before the inserts;
     *   2. the pay key: held by a payment of this request with the same paidOn, paymentMethod and
     *      amount → that result (no write, no audit); held by any other → 409 idempotency_mismatch;
     *   3. Approved, the expected version and the exact expected amount (409);
     *   4. insert the general expense (TransactionStore, its one writer) — the request's post,
     *      category, description and amount, dated paidOn, a server-generated key;
     *   5. insert the payment row; 6. the request Paid, version + 1;
     *   7. the two audit rows (finance.execute: 'pay' on the request, 'create' on the expense);
     *   8. commit. Any failure rolls the whole transaction back: nothing stored, no key consumed.
     * Nothing here locks or reads the employee.
     *
     * @param array<string, mixed> $json
     * @return array<string, mixed> the Paid request (the same one on a replay)
     */
    public function pay(Principal $actor, array $json, string $requestId): array
    {
        $in = RequestInput::pay($json, self::today());          // 400 before any lookup
        $auth = Policy::authorize($actor, Action::FinanceExecute);        // an Employee: 403 before any lookup
        $store = $this->data->requests();
        $transactions = $this->data->transactions();
        $this->data->atomically(function () use ($auth, $actor, $store, $transactions, $in, $requestId): void {
            $id = $in['financeRequestId'];
            $current = $store->lock($auth, $id) ?? throw new ApiError(ErrorCode::NotFound);                // 1
            $holder = $store->paymentKeyHolder($auth, $in['idempotencyKey']);                               // 2
            if ($holder !== null) {
                if ($holder['finance_request_id'] === $id && (string) $holder['paid_on'] === $in['paidOn']
                    && $holder['payment_method'] === $in['paymentMethod'] && (string) $holder['amount'] === $in['expectedAmount']) {
                    return;                                     // the original payment: no write, no audit
                }
                throw new ApiError(ErrorCode::Conflict, logReason: 'idempotency_mismatch');
            }
            if ($current['status'] !== RequestStatus::APPROVED) {                                           // 3
                throw new ApiError(ErrorCode::Conflict, logReason: 'finance_request_state');
            }
            if ((int) $current['version'] !== $in['expectedVersion']) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'finance_request_version');
            }
            if ((string) $current['amount'] !== $in['expectedAmount']) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'finance_request_amount');
            }
            $transactionId = bin2hex(random_bytes(16));
            self::insert(static fn () => $transactions->insertPaidExpense($auth, $transactionId, [                // 4
                'kind' => 'expense',
                'financialPost' => (string) $current['financial_post'],
                'category' => (string) $current['category'],
                'description' => (string) $current['description'],
                'amount' => (string) $current['amount'],
                'transactionDate' => $in['paidOn'],
                'idempotencyKey' => bin2hex(random_bytes(16)),
            ], $actor->userId));
            self::insert(static fn () => $store->insertPayment($auth, bin2hex(random_bytes(16)), $id, $transactionId,   // 5
                $in['paidOn'], $in['paymentMethod'], (string) $current['amount'], $actor->userId, $in['idempotencyKey']));
            if ($store->transition($auth, $id, $in['expectedVersion'], RequestStatus::APPROVED, RequestStatus::PAID, null) !== 1) { // 6
                throw new \LogicException('pay: the locked Approved request did not change');
            }
            $this->data->audit()->appendRequest($auth, $actor, 'pay', $id, [], $requestId);                // 7
            $this->data->audit()->appendPaidExpense($auth, $actor, $transactionId, $requestId);
        }, readCommitted: true);                                                                            // 8
        return $store->record($auth->scope, $in['financeRequestId']) ?? throw new \LogicException('paid finance request not readable');
    }

    /**
     * The scoped load (404 absent or out of scope) and Policy (403) for a kind-dependent operation:
     * a payment request under the record-free finance.manage, a reimbursement under its self action
     * against the loaded record. The kind follows from the owner (migration 0039's CHECK).
     *
     * @return array{0: Authorization, 1: string} the authorization and the request's kind
     */
    private function authorized(Principal $actor, string $operation, string $id): array
    {
        $record = $this->data->requests()->find(Scope::of($actor), $id) ?? throw new ApiError(ErrorCode::NotFound);
        $kind = self::kindOf($record);
        $action = RequestStatus::action($operation, $kind);
        return [Policy::authorize($actor, $action, $action === Action::FinanceManage ? null : $record), $kind];
    }

    /**
     * The request locked by primary key, refused (409) unless $operation is legal from its status
     * and it is at the expected version. Terminal statuses accept nothing.
     *
     * @return array<string, mixed>
     */
    private function locked(Authorization $auth, string $id, string $operation, int $expectedVersion): array
    {
        $current = $this->data->requests()->lock($auth, $id) ?? throw new ApiError(ErrorCode::NotFound);
        if (RequestStatus::target($operation, (string) $current['status']) === null) {
            throw new ApiError(ErrorCode::Conflict, logReason: 'finance_request_state');
        }
        if ((int) $current['version'] !== $expectedVersion) {
            throw new ApiError(ErrorCode::Conflict, logReason: 'finance_request_version');
        }
        return $current;
    }

    /** R1 = A: a reimbursement is created or submitted only for an Active, non-archived employee. */
    private static function eligible(array $eligibility): void
    {
        if ($eligibility['archived']) {
            throw new ApiError(ErrorCode::Conflict, logReason: 'employee_archived');
        }
        if ($eligibility['employmentStatus'] !== 'Active') {
            throw new ApiError(ErrorCode::Conflict, logReason: 'employee_not_active');
        }
    }

    private static function kindOf(ScopedRecord $record): string
    {
        return $record->ownerEmployeeId === null ? RequestStatus::KIND_PAYMENT_REQUEST : RequestStatus::KIND_REIMBURSEMENT;
    }

    /**
     * @param array<string, mixed> $holder the row holding the create key (RequestStore::KEY_HOLDER_SQL)
     * @param array<string, mixed> $in
     */
    private static function sameCreate(array $holder, array $in, Authorization $auth): bool
    {
        $owner = $in['kind'] === RequestStatus::KIND_REIMBURSEMENT ? $auth->record?->ownerEmployeeId : null;
        return $holder['kind'] === $in['kind'] && $holder['owner_employee_id'] === $owner
            && $holder['financial_post'] === $in['financialPost'] && (string) $holder['category'] === $in['category']
            && (string) $holder['description'] === $in['description'] && (string) $holder['amount'] === $in['amount']
            && ($holder['payee'] === null ? null : (string) $holder['payee']) === $in['payee'] && (string) $holder['document_date'] === $in['documentDate'];
    }

    /** Runs one INSERT; a unique key it raises is a concurrent write of the same key or a second payment: 409. */
    private static function insert(\Closure $write): void
    {
        try {
            $write();
        } catch (DatabaseError $e) {
            if ($e->driverCode === self::DUPLICATE_KEY) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'finance_request_duplicate');
            }
            throw $e;
        }
    }

    /** Today in the company calendar (Asia/Jakarta). */
    private static function today(): string
    {
        return TransactionInput::today(new \DateTimeImmutable('now'));
    }
}
