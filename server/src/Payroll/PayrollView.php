<?php
declare(strict_types=1);

namespace TamOs\Payroll;

/**
 * The payroll projections. The plan projection is one shape for the CEO and — BF-4c2, owner decision
 * D-PAY-5 = A — for the Employee reading their own Committed plan (SDR-0002 §9.1: their own payroll
 * rows; every field is their own frozen data). Exactly FIELDS — never the company, the generated
 * live key, a lock or audit detail, a timestamp, a contract, or any statutory, finance or payment
 * field (there is none). Money and hours are the exact decimal strings the database stores;
 * `version` is the integer a transition sends back as expectedVersion. The snapshot fields are the
 * employee's code, name and department frozen at calculation, so a later Employee edit never
 * rewrites a plan. Anything else in a row is a programming error, never a default.
 *
 * A plan's contributing overtime is projected as exactly OVERTIME_FIELDS: the overtime record id,
 * its hours and its frozen approved amount — never a valuation input.
 *
 * BF-4c2 (D-BF4c2-4 = A): the CEO drift read is its own projection, exactly DRIFT_FIELDS — the plan
 * id, `current` and the closed PayrollDrift reasons in their fixed order — never a salary, an amount,
 * a total, hours, a count or any other input value. The plan projection gains nothing: no commit
 * key, no committed_at, no drift field.
 */
final class PayrollView
{
    public const FIELDS = ['id', 'employeeId', 'monthKey', 'status', 'employeeCode', 'employeeName', 'department',
        'baseSalary', 'overtimeAmount', 'overtimeHours', 'overtimeCount', 'totalAmount', 'version'];
    public const OVERTIME_FIELDS = ['id', 'hours', 'amount'];
    public const DRIFT_FIELDS = ['id', 'current', 'reasons'];

    /**
     * @param array<string, mixed> $row a plan row (PayrollStore::PLAN_COLUMNS)
     * @return array<string, mixed>
     */
    public static function plan(array $row): array
    {
        $out = [
            'id' => (string) $row['id'],
            'employeeId' => (string) $row['employee_id'],
            'monthKey' => (string) $row['month_key'],
            'status' => (string) $row['status'],
            'employeeCode' => (string) $row['employee_code_snapshot'],
            'employeeName' => (string) $row['employee_name_snapshot'],
            'department' => isset($row['department_snapshot']) ? (string) $row['department_snapshot'] : null,
            'baseSalary' => (string) $row['base_salary'],
            'overtimeAmount' => (string) $row['overtime_amount'],
            'overtimeHours' => (string) $row['overtime_hours'],
            'overtimeCount' => (int) $row['overtime_count'],
            'totalAmount' => (string) $row['total_amount'],
            'version' => (int) $row['version'],
        ];
        if (!in_array($out['status'], PayrollStatus::VALUES, true) || !PayrollCalculation::isSalary($out['baseSalary'])
            || !PayrollCalculation::isAmount($out['overtimeAmount']) || !PayrollCalculation::isAmount($out['totalAmount'])
            || !PayrollCalculation::isHoursTotal($out['overtimeHours'])) {
            throw new \LogicException('a payroll row needs a known status and canonical money and hours');
        }
        return $out;
    }

    /**
     * BF-4c2: the drift projection. `current` is true exactly when there is no reason.
     *
     * @param array{id: string, reasons: list<string>} $drift
     * @return array{id: string, current: bool, reasons: list<string>}
     */
    public static function drift(array $drift): array
    {
        $reasons = $drift['reasons'];
        if (array_keys($drift) !== ['id', 'reasons'] || !is_array($reasons) || !array_is_list($reasons)
            || $reasons !== array_values(array_intersect(PayrollDrift::REASONS, $reasons)) || count($reasons) !== count(array_unique($reasons))) {
            throw new \LogicException('drift reasons are a subset of PayrollDrift::REASONS, unique, in its order');
        }
        return ['id' => (string) $drift['id'], 'current' => $reasons === [], 'reasons' => $reasons];
    }

    /**
     * @param array<string, mixed> $row a contributing overtime row (PayrollStore::PLAN_OVERTIME_SQL)
     * @return array{id: string, hours: string, amount: string}
     */
    public static function overtime(array $row): array
    {
        $out = ['id' => (string) $row['id'], 'hours' => (string) $row['hours'], 'amount' => (string) $row['approved_amount']];
        if (!PayrollCalculation::isAmount($out['amount']) || !PayrollCalculation::isHoursTotal($out['hours'])) {
            throw new \LogicException('a contributing overtime row needs canonical hours and a frozen amount');
        }
        return $out;
    }
}
