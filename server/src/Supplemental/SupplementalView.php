<?php
declare(strict_types=1);

namespace TamOs\Supplemental;

use TamOs\Payroll\PayrollCalculation;

/**
 * The Supplemental Payroll projections (BF-4d). The document projection is one shape for the CEO
 * and — owner decision D-SPAY-3 = A — for the Employee reading their own Committed document
 * (SDR-0002 §9.1: their own payroll rows; every field is their own frozen data). Exactly FIELDS —
 * never the company, the generated open key, the commit idempotency key, committed_at, a lock or
 * audit detail, a timestamp, or any statutory, finance or payment field (there is none). Money and
 * hours are the exact decimal strings the database stores; `version` is the integer a transition
 * sends back as expectedVersion; `overtimeAmount` is the whole obligation, so Commit's
 * expectedTotal confirms it. The snapshot fields are the base plan's frozen code, name and
 * department, so a later Employee edit never rewrites a document.
 *
 * The base Payroll plan projection (PayrollView::FIELDS, thirteen keys) is unchanged: nothing
 * Supplemental is embedded in it.
 *
 * A document's captured overtime is projected as exactly OVERTIME_FIELDS (PayrollView's line
 * shape): the overtime record id, its hours and its frozen approved amount — never a valuation
 * input. The CEO eligibility read is exactly ELIGIBILITY_FIELDS per Committed base plan.
 */
final class SupplementalView
{
    public const FIELDS = ['id', 'payrollPlanId', 'employeeId', 'monthKey', 'status', 'employeeCode', 'employeeName', 'department',
        'overtimeAmount', 'overtimeHours', 'overtimeCount', 'version'];
    public const OVERTIME_FIELDS = ['id', 'hours', 'amount'];
    public const ELIGIBILITY_FIELDS = ['payrollPlanId', 'employeeId', 'eligibleCount', 'eligibleHours', 'eligibleAmount'];

    /**
     * @param array<string, mixed> $row a document row (SupplementalStore::RECORD_SQL)
     * @return array<string, mixed>
     */
    public static function supplemental(array $row): array
    {
        $out = [
            'id' => (string) $row['id'],
            'payrollPlanId' => (string) $row['payroll_plan_id'],
            'employeeId' => (string) $row['employee_id'],
            'monthKey' => (string) $row['month_key'],
            'status' => (string) $row['status'],
            'employeeCode' => (string) $row['employee_code_snapshot'],
            'employeeName' => (string) $row['employee_name_snapshot'],
            'department' => isset($row['department_snapshot']) ? (string) $row['department_snapshot'] : null,
            'overtimeAmount' => (string) $row['overtime_amount'],
            'overtimeHours' => (string) $row['overtime_hours'],
            'overtimeCount' => (int) $row['overtime_count'],
            'version' => (int) $row['version'],
        ];
        if (!in_array($out['status'], SupplementalStatus::VALUES, true) || !PayrollCalculation::isAmount($out['overtimeAmount'])
            || $out['overtimeAmount'] === '0.00' || !PayrollCalculation::isHoursTotal($out['overtimeHours']) || $out['overtimeCount'] < 1) {
            throw new \LogicException('a supplemental row needs a known status and canonical, positive money and hours');
        }
        return $out;
    }

    /**
     * @param array<string, mixed> $row a captured overtime row (SupplementalStore::OVERTIME_SQL)
     * @return array{id: string, hours: string, amount: string}
     */
    public static function overtime(array $row): array
    {
        $out = ['id' => (string) $row['id'], 'hours' => (string) $row['hours'], 'amount' => (string) $row['approved_amount']];
        if (!PayrollCalculation::isAmount($out['amount']) || !PayrollCalculation::isHoursTotal($out['hours'])) {
            throw new \LogicException('a captured overtime row needs canonical hours and a frozen amount');
        }
        return $out;
    }

    /**
     * @param array{payrollPlanId: string, employeeId: string, eligibleCount: int, eligibleHours: string, eligibleAmount: string} $e
     * @return array{payrollPlanId: string, employeeId: string, eligibleCount: int, eligibleHours: string, eligibleAmount: string}
     */
    public static function eligibility(array $e): array
    {
        if (array_keys($e) !== self::ELIGIBILITY_FIELDS || !is_int($e['eligibleCount']) || $e['eligibleCount'] < 1
            || !PayrollCalculation::isAmount($e['eligibleAmount']) || !PayrollCalculation::isHoursTotal($e['eligibleHours'])) {
            throw new \LogicException('an eligibility entry is exactly its plan, employee and a positive count with canonical hours and amount');
        }
        return $e;
    }
}
