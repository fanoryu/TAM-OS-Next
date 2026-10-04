<?php
declare(strict_types=1);

namespace TamOs\Payroll;

use TamOs\Data\BusinessData;
use TamOs\Data\DatabaseError;
use TamOs\Data\Payroll\PayrollStore;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Policy;
use TamOs\Policy\Scope;

/**
 * The server payroll operations (BF-4c1; owner decisions D-PAY-1..6 = A): the ordering and
 * transaction boundaries of the payroll plan. It owns no SQL and never takes a company, an
 * employee, a role, a salary, an amount or a status from a browser — the company and actor come
 * from the session principal, every money value from the database.
 *
 * Every write and the drift read are CEO-only: an Employee principal is refused (403) before any
 * lookup. BF-4c2 (D-PAY-5 = A): an Employee reads their OWN COMMITTED plans through the same two
 * reads, under their self scope — any other plan, their own Draft / Reviewed / Ready / Cancelled
 * included, is 404, indistinguishable from absent.
 *
 *   list / read  validate (400) → the principal's scope (CEO: company; Employee: own Committed);
 *                absent, out of scope or another company is 404
 *   generate     validate { month } (400) → CEO (403) → payroll.manage on the period (403) → one
 *                READ COMMITTED transaction: lock every employee of the company by primary key in
 *                id order, read the month's Approved overtime (frozen by those locks), lock the
 *                month's live plans by primary key, read their links (the global lock order, with
 *                no secondary-index range lock) → for each employee:
 *                  ineligible (archived, not Active, no salary > 0) → excluded with a reason code,
 *                    no plan
 *                  no live plan → a Draft of Base Salary + its Approved overtime, its links, audit
 *                    'create'
 *                  a Draft → recalculated from the current inputs, links replaced, audit
 *                    'recalculate' — unless nothing differs (no write, no audit, same version)
 *                  Reviewed, Ready or Committed → untouched
 *                → { plans: the month's live plans, excluded }
 *   review / approve / return / cancel   validate (400) → CEO (403) → scoped load (404) →
 *                payroll.manage (403) → one transaction: lock the plan, the source status and the
 *                expected version (409), cancel releases the plan's links, compare-and-swap + audit
 *
 * Payroll never values overtime: it consumes each Approved record's frozen approved_amount exactly
 * (PayrollCalculation) and never writes an overtime record. An overtime approval serialized before
 * a generate is included; one serialized after it is not, and approval is never blocked. Nothing
 * here commits a plan, pays it, or has any finance or statutory effect: Ready is an approved
 * obligation awaiting Commit, never a payment.
 *
 * BF-4c2 (owner decisions D-BF4c2-1..4 = A):
 *
 *   commit       validate exactly { id, expectedVersion, expectedTotal, idempotencyKey } (400) → CEO
 *                (403) → scoped load (404) → payroll.manage (403) → one READ COMMITTED transaction
 *                (D-BF4c2-3, the narrow extension of the generate exception) in the global order:
 *                lock the plan's employee by primary key → lock the plan by primary key → the
 *                idempotency key: held by this plan, Committed at expectedVersion + 1 with
 *                expectedTotal → the original commit, replayed (no write, no audit); held by any
 *                other request → 409 idempotency_mismatch → Ready (409 payroll_state) → the
 *                expected version (409 payroll_version) → expectedTotal equals the locked total as
 *                an exact string (409 payroll_total) → PayrollDrift on the inputs read under those
 *                locks (409 payroll_drift) → the compare-and-swap that sets Committed, committed_at
 *                and the key → audit 'commit'. A duplicate key raised by that one statement is a
 *                concurrent commit with the same key on another plan: 409 idempotency_mismatch.
 *                A refused or failed commit stores no key, so the key is not consumed.
 *   drift        validate (400) → CEO (403) → in one transaction, the same PayrollDrift over the
 *                plan's current inputs (404 when absent or another company; 409 payroll_state when
 *                the plan is Committed or Cancelled and can no longer be committed). Read-only and
 *                advisory: Commit always re-checks under its own locks.
 *
 * Committed is an immutable obligation: never paid, executed or posted anywhere.
 */
final class PayrollService
{
    /** The generate exclusion reasons, in precedence order. */
    public const EXCLUSIONS = ['archived', 'not_active', 'salary_missing'];
    /** MariaDB ER_DUP_ENTRY: under commit, only the company-unique commit idempotency key can raise it. */
    private const DUPLICATE_KEY = 1062;

    public function __construct(private readonly BusinessData $data)
    {
    }

    /** @return list<array<string, mixed>> every plan of $month (CEO), or the Employee's own Committed plans of it */
    public function month(Principal $actor, ?string $month): array
    {
        $monthKey = PayrollInput::month($month);            // 400 before any lookup
        $scope = Scope::of($actor);                         // an Employee: self scope, own Committed only
        $rows = $this->data->payroll()->month($scope, $monthKey);
        if (count($rows) > PayrollStore::LIST_CAP) {
            throw new ApiError(ErrorCode::InternalError, 'payroll month above its cap', logReason: 'payroll_list_cap');
        }
        return $rows;
    }

    /** @return array{plan: array<string, mixed>, overtime: list<array<string, mixed>>} one plan and its contributing overtime (CEO; an Employee: their own Committed plan) */
    public function read(Principal $actor, ?string $id): array
    {
        $id = PayrollInput::id($id);                        // 400 before any lookup
        $scope = Scope::of($actor);
        $plan = $this->data->payroll()->record($scope, $id) ?? throw new ApiError(ErrorCode::NotFound);
        return ['plan' => $plan, 'overtime' => $this->data->payroll()->overtimeOf($scope, $id)];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{plans: list<array<string, mixed>>, excluded: list<array{employeeId: string, reason: string}>}
     */
    public function generate(Principal $actor, array $json, string $requestId): array
    {
        $monthKey = PayrollInput::generate($json);
        $scope = self::companyScope($actor);                // 403 before any connection; Policy decides again below
        $period = Policy::authorize($actor, Action::PayrollManage, $this->data->payroll()->periodCandidate($scope, $monthKey));
        try {
            $excluded = $this->data->atomically(function () use ($period, $actor, $monthKey, $requestId): array {
                // The global lock order: employee → overtime → payroll_plan → payroll_plan_overtime → audit.
                $store = $this->data->payroll();
                $scope = $period->scope;
                $employees = [];
                foreach (self::capped($store->employeeIds($period), 'payroll_employee_cap') as $employeeId) {
                    $locked = $store->lockEmployee($period, $employeeId);
                    if ($locked !== null) {
                        $employees[] = $locked;
                    }
                }
                $overtime = [];
                foreach (self::capped($store->approvedOvertime($period), 'payroll_overtime_cap') as $o) {
                    $overtime[(string) $o['employee_id']][] = $o;
                }
                $plans = [];
                foreach (self::capped($store->livePlanIds($period), 'payroll_list_cap') as $planId) {
                    $p = $store->lockPlanRow($period, $planId);
                    if ($p === null || $p['status'] === PayrollStatus::CANCELLED) {
                        continue;                           // cancelled before the lock: no longer live
                    }
                    $owner = (string) $p['employee_id'];
                    if (isset($plans[$owner])) {
                        throw new \LogicException('two live payroll plans for one employee and month');
                    }
                    $plans[$owner] = $p;
                }
                $links = [];
                foreach ($store->monthLinks($period) as $l) {
                    $links[(string) $l['payroll_plan_id']][] = (string) $l['id'];
                }
                $excluded = [];
                foreach ($employees as $e) {
                    $employeeId = (string) $e['id'];
                    $reason = self::exclusion($e);
                    if ($reason !== null) {
                        $excluded[] = ['employeeId' => $employeeId, 'reason' => $reason];
                        continue;
                    }
                    $records = $overtime[$employeeId] ?? [];
                    $calc = PayrollCalculation::calculate((string) $e['monthly_base_salary'], array_map(
                        static fn (array $o): array => ['hours' => (string) $o['hours'], 'amount' => (string) $o['approved_amount']],
                        $records,
                    ));
                    $values = [
                        'employee_code_snapshot' => (string) $e['employee_code'],
                        'employee_name_snapshot' => (string) $e['full_name'],
                        'department_snapshot' => $e['department'] === null ? null : (string) $e['department'],
                        'base_salary' => $calc['baseSalary'],
                        'overtime_amount' => $calc['overtimeAmount'],
                        'overtime_hours' => $calc['overtimeHours'],
                        'overtime_count' => $calc['overtimeCount'],
                        'total_amount' => $calc['totalAmount'],
                    ];
                    $overtimeIds = array_map(static fn (array $o): string => (string) $o['id'], $records);
                    sort($overtimeIds, SORT_STRING);
                    $plan = $plans[$employeeId] ?? null;
                    if ($plan === null) {
                        $employee = $this->data->employees()->find($scope, $employeeId) ?? throw new \LogicException('a locked employee is not readable');
                        $auth = Policy::authorize($actor, Action::PayrollManage, $store->candidate($employee, bin2hex(random_bytes(16))));
                        $store->create($auth, $monthKey, $values);
                        $store->link($auth, $overtimeIds);
                        $this->data->audit()->appendPayroll($auth, $actor, 'create', $requestId);
                        continue;
                    }
                    if ($plan['status'] !== PayrollStatus::DRAFT) {
                        continue;                                   // Reviewed, Ready or Committed: never silently altered
                    }
                    $linked = $links[(string) $plan['id']] ?? [];
                    sort($linked, SORT_STRING);
                    if (self::sameValues($plan, $values) && $linked === $overtimeIds) {
                        continue;                                   // nothing differs: no write, no audit, same version
                    }
                    $auth = Policy::authorize($actor, Action::PayrollManage, $store->find($scope, (string) $plan['id']) ?? throw new \LogicException('a locked plan is not readable'));
                    $store->unlink($auth);
                    if ($store->recalculate($auth, (int) $plan['version'], $values) !== 1) {
                        throw new \LogicException('recalculate: the locked Draft did not change');
                    }
                    $store->link($auth, $overtimeIds);
                    $this->data->audit()->appendPayroll($auth, $actor, 'recalculate', $requestId);
                }
                return $excluded;
            }, readCommitted: true);
        } catch (PayrollOutOfBounds) {
            throw new ApiError(ErrorCode::Conflict, logReason: 'payroll_out_of_bounds');
        }
        $plans = $this->data->payroll()->livePlans($scope, $monthKey);
        if (count($plans) > PayrollStore::LIST_CAP) {
            throw new ApiError(ErrorCode::InternalError, 'payroll month above its cap', logReason: 'payroll_list_cap');
        }
        return ['plans' => $plans, 'excluded' => $excluded];
    }

    /**
     * review, approve, return or cancel (PayrollStatus::TRANSITIONS).
     *
     * @param array<string, mixed> $json
     * @return array<string, mixed> the plan in its new status
     */
    public function transition(Principal $actor, string $operation, array $json, string $requestId): array
    {
        $in = PayrollInput::transition($json);
        $scope = self::companyScope($actor);
        $record = $this->data->payroll()->find($scope, $in['id']) ?? throw new ApiError(ErrorCode::NotFound);
        $auth = Policy::authorize($actor, Action::PayrollManage, $record);
        $this->data->atomically(function () use ($auth, $actor, $operation, $in, $requestId): void {
            $current = $this->data->payroll()->lock($auth) ?? throw new ApiError(ErrorCode::NotFound);
            $from = (string) $current['status'];
            $to = PayrollStatus::target($operation, $from) ?? throw new ApiError(ErrorCode::Conflict, logReason: 'payroll_state');
            if ((int) $current['version'] !== $in['expectedVersion']) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'payroll_version');
            }
            if ($operation === 'cancel') {
                $this->data->payroll()->unlink($auth);      // a cancelled plan consumes no overtime
            }
            if ($this->data->payroll()->transition($auth, $in['expectedVersion'], $from, $to) !== 1) {
                throw new \LogicException('transition: the locked plan did not change');
            }
            $this->data->audit()->appendPayroll($auth, $actor, $operation, $requestId);
        });
        return $this->data->payroll()->record($scope, $in['id']) ?? throw new \LogicException('transitioned plan not readable');
    }

    /**
     * BF-4c2: Ready → Committed, idempotent on the key (D-BF4c2-1 = A).
     *
     * @param array<string, mixed> $json
     * @return array<string, mixed> the Committed plan (the original one on a replay)
     */
    public function commit(Principal $actor, array $json, string $requestId): array
    {
        $in = PayrollInput::commit($json);                  // 400 before any lookup
        $scope = self::companyScope($actor);                // an Employee: 403 before any lookup
        $record = $this->data->payroll()->find($scope, $in['id']) ?? throw new ApiError(ErrorCode::NotFound);
        $auth = Policy::authorize($actor, Action::PayrollManage, $record);
        $this->data->atomically(function () use ($auth, $actor, $in, $requestId): void {
            // The global lock order: employee → payroll_plan → (plain reads) → audit.
            $store = $this->data->payroll();
            $store->lockOwner($auth) ?? throw new ApiError(ErrorCode::NotFound);
            $current = $store->lockForCommit($auth) ?? throw new ApiError(ErrorCode::NotFound);
            $holder = $store->keyHolder($auth->scope, $in['idempotencyKey']);
            if ($holder !== null) {
                if (self::isReplay($current, $holder, $in)) {
                    return;                                 // the original commit: no write, no audit
                }
                throw new ApiError(ErrorCode::Conflict, logReason: 'idempotency_mismatch');
            }
            if ($current['status'] !== PayrollStatus::COMMIT_FROM) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'payroll_state');
            }
            if ((int) $current['version'] !== $in['expectedVersion']) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'payroll_version');
            }
            if ((string) $current['total_amount'] !== $in['expectedTotal']) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'payroll_total');
            }
            $inputs = $store->driftInputs($auth->scope, (string) $current['id']) ?? throw new \LogicException('a locked plan has no drift inputs');
            if (PayrollDrift::reasons($inputs['plan'], $inputs['employee'], $inputs['approved'], $inputs['linked']) !== []) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'payroll_drift');
            }
            try {
                $written = $store->commit($auth, $in['expectedVersion'], $in['idempotencyKey']);
            } catch (DatabaseError $e) {
                if ($e->driverCode === self::DUPLICATE_KEY) {
                    // The key was taken meanwhile by a concurrent commit of another plan.
                    throw new ApiError(ErrorCode::Conflict, logReason: 'idempotency_mismatch');
                }
                throw $e;
            }
            if ($written !== 1) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'payroll_state');
            }
            $this->data->audit()->appendPayroll($auth, $actor, 'commit', $requestId);
        }, readCommitted: true);
        return $this->data->payroll()->record($scope, $in['id']) ?? throw new \LogicException('committed plan not readable');
    }

    /**
     * BF-4c2: why a plan could no longer be committed as it is (D-BF4c2-4 = A) — the same
     * PayrollDrift Commit applies, over the plan's current inputs. CEO only; read-only.
     *
     * @return array{id: string, reasons: list<string>}
     */
    public function drift(Principal $actor, ?string $id): array
    {
        $id = PayrollInput::id($id);                        // 400 before any lookup
        $scope = self::companyScope($actor);                // an Employee: 403 before any lookup
        $inputs = $this->data->atomically(fn (): ?array => $this->data->payroll()->driftInputs($scope, $id)) ?? throw new ApiError(ErrorCode::NotFound);
        if (!in_array($inputs['plan']['status'], PayrollStatus::PRE_COMMIT, true)) {
            throw new ApiError(ErrorCode::Conflict, logReason: 'payroll_state');
        }
        return ['id' => $id, 'reasons' => PayrollDrift::reasons($inputs['plan'], $inputs['employee'], $inputs['approved'], $inputs['linked'])];
    }

    /**
     * A commit request is the replay of the commit that stored its key when that commit was of this
     * plan, from expectedVersion, at expectedTotal — the fingerprint the immutable plan implies.
     *
     * @param array<string, mixed> $current the locked plan
     * @param array{id: string, expectedVersion: int, expectedTotal: string, idempotencyKey: string} $in
     */
    private static function isReplay(array $current, string $holder, array $in): bool
    {
        return $holder === (string) $current['id']
            && $current['status'] === PayrollStatus::COMMITTED
            && $current['commit_idempotency_key'] === $in['idempotencyKey']
            && (int) $current['version'] === $in['expectedVersion'] + 1
            && (string) $current['total_amount'] === $in['expectedTotal'];
    }

    /** The reason a locked employee row gets no plan, or null when eligible (D-PAY-2 = A). */
    private static function exclusion(array $e): ?string
    {
        if ($e['archived_at'] !== null) {
            return 'archived';
        }
        if ($e['employment_status'] !== 'Active') {
            return 'not_active';
        }
        $salary = $e['monthly_base_salary'];
        return $salary !== null && PayrollCalculation::isSalary((string) $salary) ? null : 'salary_missing';
    }

    /** @param array<string, int|string|null> $values */
    private static function sameValues(array $plan, array $values): bool
    {
        foreach ($values as $column => $value) {
            $stored = $plan[$column];
            if (($stored === null ? null : (string) $stored) !== ($value === null ? null : (string) $value)) {
                return false;
            }
        }
        return true;
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private static function capped(array $rows, string $reason): array
    {
        if (count($rows) > PayrollStore::LIST_CAP) {
            throw new ApiError(ErrorCode::InternalError, 'payroll generate above its cap', logReason: $reason);
        }
        return $rows;
    }

    /** Every payroll write and the drift read are CEO-only — an Employee principal is refused before any lookup. */
    private static function companyScope(Principal $actor): Scope
    {
        $scope = Scope::of($actor);
        if ($scope->isSelf()) {
            throw new ApiError(ErrorCode::Forbidden, 'action denied', logReason: 'action_denied');
        }
        return $scope;
    }
}
