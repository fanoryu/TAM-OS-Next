<?php
declare(strict_types=1);

namespace TamOs\Supplemental;

use TamOs\Data\BusinessData;
use TamOs\Data\DatabaseError;
use TamOs\Data\Supplemental\SupplementalStore;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Payroll\PayrollCalculation;
use TamOs\Payroll\PayrollOutOfBounds;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Policy;
use TamOs\Policy\Scope;

/**
 * The server Supplemental Payroll operations (BF-4d; owner decisions D-SPAY-1..4 = A): the
 * ordering and transaction boundaries of the Supplemental document. It owns no SQL and never takes
 * a company, an employee, a role, an amount, an overtime id or a status from a browser — the
 * company and actor come from the session principal, every money value from the database.
 *
 * Supplemental Payroll settles Approved overtime of one employee and month that their
 * already-Committed base plan does not contain (the overtime became Approved after that plan was
 * committed). It never writes the base plan, its links or any overtime record. Before the base plan
 * is committed, late overtime goes through the Payroll drift path instead (overtime_changed →
 * return to Draft → regenerate); nothing here applies to it.
 *
 * Every write and the eligibility read are CEO-only under the existing supplemental.manage, a
 * record-free Action: the kernel refuses an Employee (403) before the handler runs, before any
 * lookup, and companyScope() refuses again here. An Employee reads their OWN COMMITTED documents
 * through the two document reads, under their self scope — any other document, their own Draft /
 * Reviewed / Ready / Cancelled included, is 404, indistinguishable from absent.
 *
 *   list / read  validate (400) → the principal's scope (CEO: company; Employee: own Committed)
 *   eligibility  validate (400) → CEO (403) → in one transaction: the month's Committed base plans
 *                and its Approved overtime captured by no base plan and no document, summed per plan
 *                by PayrollCalculation::overtime (no SQL sum)
 *   generate     validate { payrollPlanId } (400) → CEO (403) → the plan (404) → one READ COMMITTED
 *                transaction in the global order: lock the plan's employee, then the plan (409 unless
 *                Committed), then its open document if any, then read under those locks the
 *                employee's Approved overtime of the month, the plan's links and every overtime
 *                already captured by a document →
 *                  an open Reviewed or Ready document → returned untouched (frozen: no recalculation)
 *                  an open Draft → recalculated to the current eligible set (its own captured overtime
 *                    stays eligible), links replaced, audit 'recalculate' — unless nothing differs (no
 *                    write, no audit, same version)
 *                  no open document, eligible overtime → a Draft of it, its links, audit 'create'
 *                  no open document, nothing eligible (or a zero total) → 409
 *                Eligibility ignores the employee's current status and salary (D-SPAY-2 = A): the
 *                work was already approved. No idempotency key: at most one open document per plan
 *                (the database's open key) makes generate naturally idempotent.
 *   review / approve / return / cancel   validate (400) → CEO (403) → the document (404) → one
 *                transaction in the same global order: lock the employee, the base plan, the document;
 *                the source status and the expected version (409); cancel releases the links (return
 *                keeps them); compare-and-swap + audit
 *   commit       validate exactly { id, expectedVersion, expectedTotal, idempotencyKey } (400) → CEO
 *                (403) → the document (404) → one READ COMMITTED transaction in the global order:
 *                lock the employee, the base plan, the document → the idempotency key: held by this
 *                document, Committed at expectedVersion + 1 with expectedTotal → the original commit,
 *                replayed (no write, no audit); held by any other document → 409
 *                idempotency_mismatch → Ready (409 supplemental_state) → the expected version (409
 *                supplemental_version) → expectedTotal equals the locked amount as an exact string
 *                (409 supplemental_total) → every link still the employee's Approved overtime of the
 *                month held by no base plan, and their exact sum still the stored amount, hours and
 *                count (409 supplemental_links) → the compare-and-swap that sets Committed,
 *                committed_at and the key → audit 'commit'. Overtime approved after the document
 *                froze is never absorbed: it belongs to the next document. A duplicate key raised by
 *                that one statement is a concurrent commit with the same key on another document:
 *                409 idempotency_mismatch. A refused or failed commit stores no key.
 *
 * Committed is an immutable obligation: never paid, executed or posted anywhere.
 */
final class SupplementalService
{
    /** MariaDB ER_DUP_ENTRY: under commit, only the company-unique commit idempotency key can raise it. */
    private const DUPLICATE_KEY = 1062;

    public function __construct(private readonly BusinessData $data)
    {
    }

    /** @return list<array<string, mixed>> every document of $month (CEO), or the Employee's own Committed documents of it */
    public function month(Principal $actor, ?string $month): array
    {
        $monthKey = SupplementalInput::month($month);       // 400 before any lookup
        $rows = $this->data->supplemental()->month(Scope::of($actor), $monthKey);
        if (count($rows) > SupplementalStore::LIST_CAP) {
            throw new ApiError(ErrorCode::InternalError, 'supplemental month above its cap', logReason: 'supplemental_list_cap');
        }
        return $rows;
    }

    /** @return array{supplemental: array<string, mixed>, overtime: list<array<string, mixed>>} one document and its captured overtime (CEO; an Employee: their own Committed document) */
    public function read(Principal $actor, ?string $id): array
    {
        $id = SupplementalInput::id($id);                   // 400 before any lookup
        $scope = Scope::of($actor);
        $row = $this->data->supplemental()->record($scope, $id) ?? throw new ApiError(ErrorCode::NotFound);
        return ['supplemental' => $row, 'overtime' => $this->data->supplemental()->overtimeOf($scope, $id)];
    }

    /**
     * The month's Committed base plans that have Approved overtime no plan and no document holds.
     *
     * @return list<array{payrollPlanId: string, employeeId: string, eligibleCount: int, eligibleHours: string, eligibleAmount: string}>
     */
    public function eligibility(Principal $actor, ?string $month): array
    {
        $monthKey = SupplementalInput::month($month);       // 400 before any lookup
        $scope = self::companyScope($actor);                // an Employee: 403 before any lookup
        $in = $this->data->atomically(fn (): array => $this->data->supplemental()->eligibilityInputs($scope, $monthKey));
        if (count($in['plans']) > SupplementalStore::LIST_CAP || count($in['overtime']) > SupplementalStore::LIST_CAP) {
            throw new ApiError(ErrorCode::InternalError, 'supplemental eligibility above its cap', logReason: 'supplemental_list_cap');
        }
        $byEmployee = [];
        foreach ($in['overtime'] as $o) {
            $byEmployee[(string) $o['employee_id']][] = ['hours' => (string) $o['hours'], 'amount' => (string) $o['approved_amount']];
        }
        $out = [];
        foreach ($in['plans'] as $p) {
            $records = $byEmployee[(string) $p['employee_id']] ?? [];
            if ($records === []) {
                continue;
            }
            try {
                $sum = PayrollCalculation::overtime($records);
            } catch (PayrollOutOfBounds) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'supplemental_out_of_bounds');
            }
            $out[] = ['payrollPlanId' => (string) $p['id'], 'employeeId' => (string) $p['employee_id'],
                'eligibleCount' => $sum['overtimeCount'], 'eligibleHours' => $sum['overtimeHours'], 'eligibleAmount' => $sum['overtimeAmount']];
        }
        return $out;
    }

    /**
     * @param array<string, mixed> $json
     * @return array<string, mixed> the base plan's open document (created, recalculated or untouched)
     */
    public function generate(Principal $actor, array $json, string $requestId): array
    {
        $planId = SupplementalInput::generate($json);
        $scope = self::companyScope($actor);
        $auth = Policy::authorize($actor, Action::SupplementalManage);
        $store = $this->data->supplemental();
        $anchor = $store->planAnchor($scope, $planId) ?? throw new ApiError(ErrorCode::NotFound);
        try {
            $id = $this->data->atomically(function () use ($auth, $actor, $store, $anchor, $planId, $requestId): string {
                // The global lock order: employee → payroll_plan → supplemental_payroll → links → audit.
                $store->lockEmployee($auth, (string) $anchor['employee_id']) ?? throw new ApiError(ErrorCode::NotFound);
                $plan = $store->lockPlan($auth, $planId) ?? throw new ApiError(ErrorCode::NotFound);
                if ($plan['status'] !== 'Committed') {
                    throw new ApiError(ErrorCode::Conflict, logReason: 'supplemental_plan_state');
                }
                $open = null;
                $openId = $store->openId($auth, $planId);
                if ($openId !== null) {
                    $open = $store->lock($auth, $openId);
                    if ($open !== null && !in_array($open['status'], SupplementalStatus::OPEN, true)) {
                        $open = null;                       // closed before the lock: no longer open
                    }
                }
                if ($open !== null && $open['status'] !== SupplementalStatus::DRAFT) {
                    return (string) $open['id'];            // Reviewed or Ready: frozen, never recalculated
                }
                $in = $store->generateInputs($auth, $planId, (string) $plan['employee_id'], (string) $plan['month_key']);
                $taken = array_fill_keys($in['planLinks'], true);
                $records = [];
                foreach ($in['approved'] as $o) {
                    $oid = (string) $o['id'];
                    if (isset($taken[$oid])) {
                        continue;                           // held by the Committed base plan
                    }
                    $holder = $in['captured'][$oid] ?? null;
                    if ($holder !== null && ($open === null || $holder !== (string) $open['id'])) {
                        continue;                           // captured by another Supplemental document
                    }
                    $records[] = $o;
                }
                if ($records === []) {
                    if ($open !== null) {
                        throw new \LogicException('an open Draft lost every captured overtime');
                    }
                    throw new ApiError(ErrorCode::Conflict, logReason: 'supplemental_nothing_eligible');
                }
                $sum = PayrollCalculation::overtime(array_map(
                    static fn (array $o): array => ['hours' => (string) $o['hours'], 'amount' => (string) $o['approved_amount']],
                    $records,
                ));
                if ($sum['overtimeAmount'] === '0.00') {
                    throw new ApiError(ErrorCode::Conflict, logReason: 'supplemental_zero');
                }
                $values = ['overtime_amount' => $sum['overtimeAmount'], 'overtime_hours' => $sum['overtimeHours'], 'overtime_count' => $sum['overtimeCount']];
                $overtimeIds = array_map(static fn (array $o): string => (string) $o['id'], $records);
                sort($overtimeIds, SORT_STRING);
                if ($open === null) {
                    $id = bin2hex(random_bytes(16));
                    $store->create($auth, $id, $plan, $values);
                    $store->link($auth, $id, $overtimeIds);
                    $this->data->audit()->appendSupplemental($auth, $actor, 'create', $id, $requestId);
                    return $id;
                }
                $id = (string) $open['id'];
                $linked = array_keys(array_filter($in['captured'], static fn (string $holder): bool => $holder === $id));
                $linked = array_map('strval', $linked);
                sort($linked, SORT_STRING);
                if (self::sameValues($open, $values) && $linked === $overtimeIds) {
                    return $id;                             // nothing differs: no write, no audit, same version
                }
                $store->unlink($auth, $id);
                if ($store->recalculate($auth, $id, (int) $open['version'], $values) !== 1) {
                    throw new \LogicException('recalculate: the locked Draft did not change');
                }
                $store->link($auth, $id, $overtimeIds);
                $this->data->audit()->appendSupplemental($auth, $actor, 'recalculate', $id, $requestId);
                return $id;
            }, readCommitted: true);
        } catch (PayrollOutOfBounds) {
            throw new ApiError(ErrorCode::Conflict, logReason: 'supplemental_out_of_bounds');
        }
        return $store->record($scope, $id) ?? throw new \LogicException('generated supplemental not readable');
    }

    /**
     * review, approve, return or cancel (SupplementalStatus::TRANSITIONS).
     *
     * @param array<string, mixed> $json
     * @return array<string, mixed> the document in its new status
     */
    public function transition(Principal $actor, string $operation, array $json, string $requestId): array
    {
        $in = SupplementalInput::transition($json);
        $scope = self::companyScope($actor);
        $auth = Policy::authorize($actor, Action::SupplementalManage);
        $store = $this->data->supplemental();
        $anchor = $store->anchor($scope, $in['id']) ?? throw new ApiError(ErrorCode::NotFound);
        $this->data->atomically(function () use ($auth, $actor, $store, $anchor, $operation, $in, $requestId): void {
            $current = $this->lockChain($auth, $anchor);
            $from = (string) $current['status'];
            $to = SupplementalStatus::target($operation, $from) ?? throw new ApiError(ErrorCode::Conflict, logReason: 'supplemental_state');
            if ((int) $current['version'] !== $in['expectedVersion']) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'supplemental_version');
            }
            if ($operation === 'cancel') {
                $store->unlink($auth, $in['id']);           // a cancelled document captures no overtime
            }
            if ($store->transition($auth, $in['id'], $in['expectedVersion'], $from, $to) !== 1) {
                throw new \LogicException('transition: the locked document did not change');
            }
            $this->data->audit()->appendSupplemental($auth, $actor, $operation, $in['id'], $requestId);
        });
        return $store->record($scope, $in['id']) ?? throw new \LogicException('transitioned supplemental not readable');
    }

    /**
     * Ready → Committed, idempotent on the key.
     *
     * @param array<string, mixed> $json
     * @return array<string, mixed> the Committed document (the original one on a replay)
     */
    public function commit(Principal $actor, array $json, string $requestId): array
    {
        $in = SupplementalInput::commit($json);             // 400 before any lookup
        $scope = self::companyScope($actor);                // an Employee: 403 before any lookup
        $auth = Policy::authorize($actor, Action::SupplementalManage);
        $store = $this->data->supplemental();
        $anchor = $store->anchor($scope, $in['id']) ?? throw new ApiError(ErrorCode::NotFound);
        $this->data->atomically(function () use ($auth, $actor, $store, $anchor, $in, $requestId): void {
            $current = $this->lockChain($auth, $anchor);
            $holder = $store->keyHolder($auth, $in['idempotencyKey']);
            if ($holder !== null) {
                if (self::isReplay($current, $holder, $in)) {
                    return;                                 // the original commit: no write, no audit
                }
                throw new ApiError(ErrorCode::Conflict, logReason: 'idempotency_mismatch');
            }
            if ($current['status'] !== SupplementalStatus::COMMIT_FROM) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'supplemental_state');
            }
            if ((int) $current['version'] !== $in['expectedVersion']) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'supplemental_version');
            }
            if ((string) $current['overtime_amount'] !== $in['expectedTotal']) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'supplemental_total');
            }
            if (!self::linksValid($current, $store->commitInputs($auth, $in['id']))) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'supplemental_links');
            }
            try {
                $written = $store->commit($auth, $in['id'], $in['expectedVersion'], $in['idempotencyKey']);
            } catch (DatabaseError $e) {
                if ($e->driverCode === self::DUPLICATE_KEY) {
                    // The key was taken meanwhile by a concurrent commit of another document.
                    throw new ApiError(ErrorCode::Conflict, logReason: 'idempotency_mismatch');
                }
                throw $e;
            }
            if ($written !== 1) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'supplemental_state');
            }
            $this->data->audit()->appendSupplemental($auth, $actor, 'commit', $in['id'], $requestId);
        }, readCommitted: true);
        return $store->record($scope, $in['id']) ?? throw new \LogicException('committed supplemental not readable');
    }

    /**
     * The global lock order for one document: its employee, its base plan, then the document, each
     * by primary key. The document's employee and base plan never change, so the anchor read before
     * the locks names the right rows; the locked document must still match it.
     *
     * @param array<string, mixed> $anchor
     * @return array<string, mixed> the locked document
     */
    private function lockChain(Authorization $auth, array $anchor): array
    {
        $store = $this->data->supplemental();
        $store->lockEmployee($auth, (string) $anchor['employee_id']) ?? throw new ApiError(ErrorCode::NotFound);
        $store->lockPlan($auth, (string) $anchor['payroll_plan_id']) ?? throw new ApiError(ErrorCode::NotFound);
        $current = $store->lock($auth, (string) $anchor['id']) ?? throw new ApiError(ErrorCode::NotFound);
        if ($current['employee_id'] !== $anchor['employee_id'] || $current['payroll_plan_id'] !== $anchor['payroll_plan_id']) {
            throw new \LogicException('a supplemental document changed its employee or base plan');
        }
        return $current;
    }

    /**
     * Commit's revalidation: every link is still valid and their exact sum is still the stored
     * amount, hours and count — the frozen set, never a newly Approved record.
     *
     * @param array<string, mixed> $current the locked document
     * @param array{links: list<string>, valid: list<array<string, mixed>>} $in
     */
    private static function linksValid(array $current, array $in): bool
    {
        $valid = array_map(static fn (array $o): string => (string) $o['id'], $in['valid']);
        if ($in['links'] === [] || $valid !== $in['links']) {
            return false;
        }
        try {
            $sum = PayrollCalculation::overtime(array_map(
                static fn (array $o): array => ['hours' => (string) $o['hours'], 'amount' => (string) $o['approved_amount']],
                $in['valid'],
            ));
        } catch (PayrollOutOfBounds) {
            return false;
        }
        return $sum['overtimeAmount'] === (string) $current['overtime_amount']
            && $sum['overtimeHours'] === (string) $current['overtime_hours']
            && $sum['overtimeCount'] === (int) $current['overtime_count'];
    }

    /**
     * A commit request is the replay of the commit that stored its key when that commit was of this
     * document, from expectedVersion, at expectedTotal — the fingerprint the immutable document implies.
     *
     * @param array<string, mixed> $current the locked document
     * @param array{id: string, expectedVersion: int, expectedTotal: string, idempotencyKey: string} $in
     */
    private static function isReplay(array $current, string $holder, array $in): bool
    {
        return $holder === (string) $current['id']
            && $current['status'] === SupplementalStatus::COMMITTED
            && $current['commit_idempotency_key'] === $in['idempotencyKey']
            && (int) $current['version'] === $in['expectedVersion'] + 1
            && (string) $current['overtime_amount'] === $in['expectedTotal'];
    }

    /** @param array<string, int|string> $values */
    private static function sameValues(array $row, array $values): bool
    {
        foreach ($values as $column => $value) {
            if ((string) $row[$column] !== (string) $value) {
                return false;
            }
        }
        return true;
    }

    /** Every Supplemental write and the eligibility read are CEO-only — an Employee principal is refused before any lookup. */
    private static function companyScope(Principal $actor): Scope
    {
        $scope = Scope::of($actor);
        if ($scope->isSelf()) {
            throw new ApiError(ErrorCode::Forbidden, 'action denied', logReason: 'action_denied');
        }
        return $scope;
    }
}
