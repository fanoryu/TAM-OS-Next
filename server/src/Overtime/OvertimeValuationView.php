<?php
declare(strict_types=1);

namespace TamOs\Overtime;

/**
 * The overtime valuation projection (BF-4b2, owner decision D-BF4b2-4 = A) — separate from the
 * record DTO, which keeps exactly its nine BF-4b1 fields, so no month list ever carries money.
 *
 *   kind 'preview'   the CEO's current valuation of a Reviewed record: computed, never stored
 *   kind 'approved'  the frozen valuation of an Approved record, for the CEO and its owner
 *
 * Exactly FIELDS, every value an exact string: the method identity, the record's hours, the
 * monthly salary the valuation used (for 'approved', the snapshot — the owner's own past
 * salary, never the current one), the standard monthly hours and the whole-Rupiah amount (IDR).
 * Never a company, an actor, a timestamp, an hourly rate, a name, or anything about payroll.
 * An approved row whose snapshot does not reproduce its amount is a LogicException (500), never
 * served.
 */
final class OvertimeValuationView
{
    public const FIELDS = ['id', 'kind', 'method', 'hours', 'monthlySalaryBasis', 'standardMonthlyHours', 'amount'];
    public const PREVIEW = 'preview';
    public const APPROVED = 'approved';

    /**
     * @param array{method: string, salary: string, standardHours: string, hours: string, amount: string} $valuation
     * @return array<string, string>
     */
    public static function preview(string $id, array $valuation): array
    {
        return self::shape($id, self::PREVIEW, $valuation['method'], $valuation['hours'], $valuation['salary'], $valuation['standardHours'], $valuation['amount']);
    }

    /**
     * @param array<string, mixed> $row a valuation row (OvertimeStore::VALUATION_SQL) of an Approved record
     * @return array<string, string>
     */
    public static function approved(array $row): array
    {
        if (($row['status'] ?? null) !== OvertimeStatus::APPROVED) {
            throw new \LogicException('only an Approved record has a frozen valuation');
        }
        $text = static fn (string $c): string => isset($row[$c]) ? (string) $row[$c] : throw new \LogicException('an Approved record needs its complete valuation snapshot');
        [$method, $hours, $salary, $standard, $amount] = [$text('valuation_method'), $text('hours'), $text('valuation_salary'), $text('valuation_standard_hours'), $text('approved_amount')];
        if (OvertimeValuation::amount($method, $salary, $standard, $hours) !== $amount) {
            throw new \LogicException('an Approved valuation must reproduce from its snapshot');
        }
        return self::shape((string) $row['id'], self::APPROVED, $method, $hours, $salary, $standard, $amount);
    }

    /** @return array<string, string> */
    private static function shape(string $id, string $kind, string $method, string $hours, string $salary, string $standard, string $amount): array
    {
        if (!OvertimeInput::isHours($hours) || !OvertimeValuation::isSalary($salary) || $standard !== OvertimeValuation::STANDARD_MONTHLY_HOURS || !OvertimeValuation::isAmount($amount) || $method !== OvertimeValuation::METHOD) {
            throw new \LogicException('an overtime valuation needs canonical exact values');
        }
        return ['id' => $id, 'kind' => $kind, 'method' => $method, 'hours' => $hours, 'monthlySalaryBasis' => $salary, 'standardMonthlyHours' => $standard, 'amount' => $amount];
    }
}
