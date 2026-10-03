<?php
declare(strict_types=1);

namespace TamOs\Payroll;

/**
 * The BF-4c1 payroll projections, CEO-only in this slice (an Employee's read of their own Committed
 * plan is BF-4c2, owner decision D-PAY-5 = A). Exactly FIELDS — never the company, the generated
 * live key, a lock or audit detail, a timestamp, a contract, or any statutory, finance or payment
 * field (there is none). Money and hours are the exact decimal strings the database stores;
 * `version` is the integer a transition sends back as expectedVersion. The snapshot fields are the
 * employee's code, name and department frozen at calculation, so a later Employee edit never
 * rewrites a plan. Anything else in a row is a programming error, never a default.
 *
 * A plan's contributing overtime is projected as exactly OVERTIME_FIELDS: the overtime record id,
 * its hours and its frozen approved amount — never a valuation input.
 */
final class PayrollView
{
    public const FIELDS = ['id', 'employeeId', 'monthKey', 'status', 'employeeCode', 'employeeName', 'department',
        'baseSalary', 'overtimeAmount', 'overtimeHours', 'overtimeCount', 'totalAmount', 'version'];
    public const OVERTIME_FIELDS = ['id', 'hours', 'amount'];

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
