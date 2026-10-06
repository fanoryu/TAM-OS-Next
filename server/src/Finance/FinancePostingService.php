<?php
declare(strict_types=1);

namespace TamOs\Finance;

use TamOs\Data\BusinessData;
use TamOs\Data\DatabaseError;
use TamOs\Data\Finance\FinancePostingStore;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Policy;
use TamOs\Policy\Scope;

/**
 * The server Finance posting operations (BF-4e; owner decisions D-FIN-1..5 = A): the ordering and
 * transaction boundaries of posting one Committed payroll obligation as one Planned Finance posting.
 * It owns no SQL and never takes a company, an employee, a role, an amount, a month or a status from
 * a browser — the company and actor come from the session principal, the amount from the locked
 * source row.
 *
 * Posting is an explicit command per obligation — never a side effect of Commit — and it creates a
 * Planned record only: no execution, no payment, no actual amount, no company account, no category
 * and no monthly plan. A posting is immutable: there is no reversal and no correction (D-FIN-5 = A).
 * The source plan or document is read and locked, never written.
 *
 * Authorization follows the source domain (D-FIN-2 = A), with no new Action: a base plan posting is
 * payroll.manage against that plan (record-bearing: the handler decides it after its scoped load —
 * an Employee is 403 before any lookup, another company's plan 404); a Supplemental posting is the
 * record-free supplemental.manage, which the kernel decides before the handler. The month read is
 * CEO-only too (D-FIN-4 = A): an Employee is 403.
 *
 *   month   validate (400) → CEO (403) → the month's postings
 *   post    validate exactly { <source id>, expectedAmount, idempotencyKey } (400) → CEO (403) →
 *           the source (404) → one READ COMMITTED transaction in the global lock order: lock the
 *           source's employee, then the plan or the document (each by primary key) → the
 *           idempotency key: held by the posting of this same source at this same amount → that
 *           posting, replayed (no write, no audit); held by any other posting → 409
 *           idempotency_mismatch → the source is Committed (409 finance_source_state) →
 *           expectedAmount equals the locked amount as an exact string (409 finance_amount) → the
 *           source has no posting yet (409 finance_posted) → insert the Planned posting with the
 *           source's employee, month and exact amount and the key → audit 'post' on the source,
 *           under its Action. A duplicate key raised by that insert is a concurrent posting that
 *           took the same key or the same source: 409. A refused or failed posting stores nothing
 *           and consumes no key.
 */
final class FinancePostingService
{
    /** MariaDB ER_DUP_ENTRY: under a posting, only the per-source or the per-key unique key can raise it. */
    private const DUPLICATE_KEY = 1062;

    public function __construct(private readonly BusinessData $data)
    {
    }

    /** @return list<array<string, mixed>> every posting of $month (CEO only) */
    public function month(Principal $actor, ?string $month): array
    {
        $monthKey = FinancePostingInput::month($month);     // 400 before any lookup
        $scope = self::companyScope($actor);                // an Employee: 403 before any lookup
        $rows = $this->data->finance()->month($scope, $monthKey);
        if (count($rows) > FinancePostingStore::LIST_CAP) {
            throw new ApiError(ErrorCode::InternalError, 'finance posting month above its cap', logReason: 'finance_list_cap');
        }
        return $rows;
    }

    /**
     * Posts one Committed base payroll plan.
     *
     * @param array<string, mixed> $json
     * @return array<string, mixed> the Planned posting (the original one on a replay)
     */
    public function postPayrollPlan(Principal $actor, array $json, string $requestId): array
    {
        $in = FinancePostingInput::payrollPlan($json);      // 400 before any lookup
        $scope = self::companyScope($actor);                // an Employee: 403 before any lookup
        $store = $this->data->finance();
        $record = $store->planRecord($scope, $in['sourceId']) ?? throw new ApiError(ErrorCode::NotFound);
        $auth = Policy::authorize($actor, Action::PayrollManage, $record);
        $id = $this->data->atomically(function () use ($auth, $actor, $store, $record, $in, $requestId): string {
            // The global lock order: employee → payroll_plan → (plain reads) → posting → audit.
            $store->lockEmployee($auth, (string) $record->ownerEmployeeId) ?? throw new ApiError(ErrorCode::NotFound);
            $plan = $store->lockPlan($auth) ?? throw new ApiError(ErrorCode::NotFound);
            $replay = $this->guard($auth, FinancePostingStore::PAYROLL_PLAN, $in, (string) $plan['status'], (string) $plan['total_amount'], $store->planPosting(...));
            if ($replay !== null) {
                return $replay;
            }
            $postingId = bin2hex(random_bytes(16));
            $this->insert(static fn () => $store->insertPlan($auth, $postingId, $plan, $in['idempotencyKey']));
            $this->data->audit()->appendPosting($auth, $actor, $in['sourceId'], $requestId);
            return $postingId;
        }, readCommitted: true);
        return $store->record($scope, $id) ?? throw new \LogicException('posting not readable');
    }

    /**
     * Posts one Committed Supplemental Payroll document.
     *
     * @param array<string, mixed> $json
     * @return array<string, mixed> the Planned posting (the original one on a replay)
     */
    public function postSupplementalPayroll(Principal $actor, array $json, string $requestId): array
    {
        $in = FinancePostingInput::supplementalPayroll($json); // 400 before any lookup
        $scope = self::companyScope($actor);                // an Employee: 403 before any lookup
        $auth = Policy::authorize($actor, Action::SupplementalManage);
        $store = $this->data->finance();
        $anchor = $store->supplementalAnchor($scope, $in['sourceId']) ?? throw new ApiError(ErrorCode::NotFound);
        $id = $this->data->atomically(function () use ($auth, $actor, $store, $anchor, $in, $requestId): string {
            // The global lock order: employee → supplemental_payroll → (plain reads) → posting → audit.
            $store->lockEmployee($auth, (string) $anchor['employee_id']) ?? throw new ApiError(ErrorCode::NotFound);
            $doc = $store->lockSupplemental($auth, $in['sourceId']) ?? throw new ApiError(ErrorCode::NotFound);
            if ($doc['employee_id'] !== $anchor['employee_id']) {
                throw new \LogicException('a Supplemental document changed its employee');
            }
            $replay = $this->guard($auth, FinancePostingStore::SUPPLEMENTAL_PAYROLL, $in, (string) $doc['status'], (string) $doc['overtime_amount'],
                static fn (Authorization $a): ?string => $store->supplementalPosting($a, $in['sourceId']));
            if ($replay !== null) {
                return $replay;
            }
            $postingId = bin2hex(random_bytes(16));
            $this->insert(static fn () => $store->insertSupplemental($auth, $postingId, $doc, $in['idempotencyKey']));
            $this->data->audit()->appendPosting($auth, $actor, $in['sourceId'], $requestId);
            return $postingId;
        }, readCommitted: true);
        return $store->record($scope, $id) ?? throw new \LogicException('posting not readable');
    }

    /**
     * The guards every posting applies under its locks, in order. Returns the id of the original
     * posting when the request replays it, or null when a new posting may be inserted.
     *
     * @param array{sourceId: string, expectedAmount: string, idempotencyKey: string} $in
     * @param \Closure(Authorization): ?string $posted the id of the source's posting, if any
     */
    private function guard(Authorization $auth, string $kind, array $in, string $status, string $amount, \Closure $posted): ?string
    {
        $holder = $this->data->finance()->keyHolder($auth, $in['idempotencyKey']);
        if ($holder !== null) {
            $column = $kind === FinancePostingStore::PAYROLL_PLAN ? 'payroll_plan_id' : 'supplemental_payroll_id';
            if ($holder['source_kind'] === $kind && $holder[$column] === $in['sourceId'] && (string) $holder['amount'] === $in['expectedAmount']) {
                return (string) $holder['id'];              // the original posting: no write, no audit
            }
            throw new ApiError(ErrorCode::Conflict, logReason: 'idempotency_mismatch');
        }
        if ($status !== 'Committed') {
            throw new ApiError(ErrorCode::Conflict, logReason: 'finance_source_state');
        }
        if ($amount !== $in['expectedAmount']) {
            throw new ApiError(ErrorCode::Conflict, logReason: 'finance_amount');
        }
        if ($posted($auth) !== null) {
            throw new ApiError(ErrorCode::Conflict, logReason: 'finance_posted');
        }
        return null;
    }

    /** Runs the one INSERT; a unique key it raises is a concurrent posting of the same key or source (409). */
    private function insert(\Closure $write): void
    {
        try {
            $write();
        } catch (DatabaseError $e) {
            if ($e->driverCode === self::DUPLICATE_KEY) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'finance_duplicate');
            }
            throw $e;
        }
    }

    /** Every Finance posting route is CEO-only — an Employee principal is refused before any lookup. */
    private static function companyScope(Principal $actor): Scope
    {
        $scope = Scope::of($actor);
        if ($scope->isSelf()) {
            throw new ApiError(ErrorCode::Forbidden, 'action denied', logReason: 'action_denied');
        }
        return $scope;
    }
}
