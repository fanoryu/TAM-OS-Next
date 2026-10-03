<?php
declare(strict_types=1);

namespace TamOs\Payroll;

use TamOs\Data\BusinessData;
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
 * BF-4c1 is CEO-only. An Employee principal is refused (403) on every payroll route before any
 * lookup: their read of their own Committed plan is BF-4c2 (D-PAY-5 = A).
 *
 *   list / read  validate (400) → CEO (403) → company scope; absent or another company is 404
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
 * obligation awaiting the BF-4c2 Commit, never a payment.
 */
final class PayrollService
{
    /** The generate exclusion reasons, in precedence order. */
    public const EXCLUSIONS = ['archived', 'not_active', 'salary_missing'];

    public function __construct(private readonly BusinessData $data)
    {
    }

    /** @return list<array<string, mixed>> every plan of $month (CEO) */
    public function month(Principal $actor, ?string $month): array
    {
        $monthKey = PayrollInput::month($month);            // 400 before any lookup
        $scope = self::companyScope($actor);                // 403 before any connection
        $rows = $this->data->payroll()->month($scope, $monthKey);
        if (count($rows) > PayrollStore::LIST_CAP) {
            throw new ApiError(ErrorCode::InternalError, 'payroll month above its cap', logReason: 'payroll_list_cap');
        }
        return $rows;
    }

    /** @return array{plan: array<string, mixed>, overtime: list<array<string, mixed>>} one plan and its contributing overtime (CEO) */
    public function read(Principal $actor, ?string $id): array
    {
        $id = PayrollInput::id($id);                        // 400 before any lookup
        $scope = self::companyScope($actor);
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

    /** BF-4c1: payroll is CEO-only — an Employee principal is refused before any lookup. */
    private static function companyScope(Principal $actor): Scope
    {
        $scope = Scope::of($actor);
        if ($scope->isSelf()) {
            throw new ApiError(ErrorCode::Forbidden, 'action denied', logReason: 'action_denied');
        }
        return $scope;
    }
}
