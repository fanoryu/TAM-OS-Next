<?php
declare(strict_types=1);

namespace TamOs\Finance;

use TamOs\Payroll\PayrollCalculation;

/**
 * The Finance posting projection (BF-4e). Exactly FIELDS — never the company, the idempotency key,
 * posted_at, a lock or audit detail: the posting's id, which Committed obligation it was made from
 * (sourceKind payrollPlan or supplementalPayroll, and that record's id), the source's employee and
 * month, the amount as the exact whole-Rupiah string the database stores, and its status, which is
 * always Planned. The base plan (thirteen keys) and Supplemental document (twelve keys) projections
 * are unchanged: nothing about a posting is embedded in them.
 */
final class FinancePostingView
{
    public const FIELDS = ['id', 'sourceKind', 'sourceId', 'employeeId', 'monthKey', 'amount', 'status'];
    public const SOURCE_KINDS = ['payrollPlan', 'supplementalPayroll'];
    public const PLANNED = 'Planned';

    /**
     * @param array<string, mixed> $row a posting row (FinancePostingStore::RECORD_SQL)
     * @return array<string, mixed>
     */
    public static function posting(array $row): array
    {
        $kind = (string) $row['source_kind'];
        $out = [
            'id' => (string) $row['id'],
            'sourceKind' => $kind,
            'sourceId' => (string) ($kind === 'payrollPlan' ? $row['payroll_plan_id'] : $row['supplemental_payroll_id']),
            'employeeId' => (string) $row['employee_id'],
            'monthKey' => (string) $row['month_key'],
            'amount' => (string) $row['amount'],
            'status' => (string) $row['status'],
        ];
        if (!in_array($kind, self::SOURCE_KINDS, true) || $out['sourceId'] === '' || $out['status'] !== self::PLANNED
            || !PayrollCalculation::isAmount($out['amount']) || $out['amount'] === '0.00') {
            throw new \LogicException('a posting row needs a known source, a positive whole-Rupiah amount and the Planned status');
        }
        return $out;
    }
}
