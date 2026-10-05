<?php
declare(strict_types=1);

namespace TamOs\Payroll;

/**
 * The BF-4c1 payroll calculation (owner decisions D-PAY-2 = A, D-PAY-3 = A): an internal TAM
 * calculation, never statutory payroll, and exactly
 *
 *   total = round_half_up_to_whole_rupiah(base salary + Σ approved overtime amounts)
 *
 * The base salary is the employee's monthly_base_salary; each overtime amount is the FROZEN
 * approved_amount of an Approved overtime record, consumed exactly as stored. Payroll never values
 * overtime itself: hours are only summed for display, never multiplied into money, and no rate,
 * method or current salary reinterprets an approved amount. There is no other component.
 *
 * Exact arithmetic without binary floating point and without BCMath or GMP, as BF-4b2: every value
 * is parsed from its exact decimal string into integers — money in sen (hundredths of a Rupiah),
 * hours in quarter-hours — added with an explicit overflow check, and the ONE rounding is an
 * integer division with an explicit half-up remainder test. Only the base salary can carry sen
 * (approved amounts are whole Rupiah), so the rounding only ever concerns it.
 *
 * Bounds: a result that would not fit signed 64-bit integers or its column (overtime_amount and
 * total_amount DECIMAL(17,2), overtime_hours DECIMAL(9,2)) is PayrollOutOfBounds — refused, never
 * wrapped. A malformed input string is a LogicException (the inputs come from the database's own
 * typed columns). Pure: no SQL, no clock, no state.
 */
final class PayrollCalculation
{
    /** The largest base salary in sen: monthly_base_salary is DECIMAL(15,2). */
    public const MAX_SALARY_SEN = 999999999999999;
    /** The largest whole-Rupiah overtime or total amount: DECIMAL(17,2). */
    public const MAX_AMOUNT_RUPIAH = 999999999999999;
    /** The largest summed hours in quarter-hours: overtime_hours DECIMAL(9,2) = 9 999 999.75 h. */
    public const MAX_HOURS_QUARTERS = 39999999;
    private const SEN_PER_RUPIAH = 100;
    private const HUNDREDTHS_PER_QUARTER = 25;

    /**
     * The plan amounts of one employee and month, as exact canonical strings.
     *
     * @param string $baseSalary the monthly base salary "N.NN", greater than 0
     * @param list<array{hours: string, amount: string}> $overtime the Approved overtime: hours "N.NN", frozen amount "N.00"
     * @return array{baseSalary: string, overtimeAmount: string, overtimeHours: string, overtimeCount: int, totalAmount: string}
     * @throws PayrollOutOfBounds
     */
    public static function calculate(string $baseSalary, array $overtime): array
    {
        if (PHP_INT_SIZE !== 8) {
            throw new \LogicException('the payroll calculation needs signed 64-bit integers');
        }
        $baseSen = self::salarySen($baseSalary);
        [$overtimeRupiah, $quarters] = self::sum($overtime);
        $totalSen = $baseSen + $overtimeRupiah * self::SEN_PER_RUPIAH;
        $totalRupiah = intdiv($totalSen, self::SEN_PER_RUPIAH);
        if (2 * ($totalSen % self::SEN_PER_RUPIAH) >= self::SEN_PER_RUPIAH) {
            $totalRupiah++;                                 // half-up, the one rounding
        }
        if ($totalRupiah > self::MAX_AMOUNT_RUPIAH) {
            throw new PayrollOutOfBounds('payroll total out of its bounds');
        }
        return [
            'baseSalary' => $baseSalary,
            'overtimeAmount' => $overtimeRupiah . '.00',
            'overtimeHours' => self::hoursString($quarters),
            'overtimeCount' => count($overtime),
            'totalAmount' => $totalRupiah . '.00',
        ];
    }

    /**
     * BF-4d: the frozen overtime alone, as exact canonical strings — the Supplemental Payroll amount
     * (no base salary, so no sen and no rounding). The same parsing, bounds and integer sum as
     * calculate(): one overtime sum for base Payroll and Supplemental Payroll.
     *
     * @param list<array{hours: string, amount: string}> $overtime the Approved overtime: hours "N.NN", frozen amount "N.00"
     * @return array{overtimeAmount: string, overtimeHours: string, overtimeCount: int}
     * @throws PayrollOutOfBounds
     */
    public static function overtime(array $overtime): array
    {
        [$overtimeRupiah, $quarters] = self::sum($overtime);
        return [
            'overtimeAmount' => $overtimeRupiah . '.00',
            'overtimeHours' => self::hoursString($quarters),
            'overtimeCount' => count($overtime),
        ];
    }

    /** True for an exact salary "N.NN" a calculation accepts: greater than 0, at most DECIMAL(15,2). */
    public static function isSalary(mixed $v): bool
    {
        return is_string($v) && preg_match('/^(0|[1-9][0-9]{0,12})\.([0-9]{2})$/', $v) === 1 && $v !== '0.00';
    }

    /** True for a whole-Rupiah amount "N.00" as a DECIMAL(17,2) column serializes it. */
    public static function isAmount(mixed $v): bool
    {
        return is_string($v) && preg_match('/^(0|[1-9][0-9]{0,14})\.00$/', $v) === 1;
    }

    /** True for a summed hours value "N.NN" in quarter-hour steps, at most DECIMAL(9,2). */
    public static function isHoursTotal(mixed $v): bool
    {
        if (!is_string($v) || preg_match('/^(0|[1-9][0-9]{0,6})\.([0-9]{2})$/', $v, $m) !== 1) {
            return false;
        }
        return ((int) $m[2]) % self::HUNDREDTHS_PER_QUARTER === 0;
    }

    /**
     * The overtime in whole Rupiah and quarter hours, each summed with an explicit overflow check.
     *
     * @param list<array{hours: string, amount: string}> $overtime
     * @return array{0: int, 1: int}
     * @throws PayrollOutOfBounds
     */
    private static function sum(array $overtime): array
    {
        if (PHP_INT_SIZE !== 8) {
            throw new \LogicException('the payroll calculation needs signed 64-bit integers');
        }
        $overtimeRupiah = 0;
        $quarters = 0;
        foreach ($overtime as $record) {
            if (!is_array($record) || array_keys($record) !== ['hours', 'amount']) {
                throw new \LogicException('an overtime input is exactly its hours and its frozen amount');
            }
            $overtimeRupiah = self::add($overtimeRupiah, self::amountRupiah($record['amount']), self::MAX_AMOUNT_RUPIAH);
            $quarters = self::add($quarters, self::quarters($record['hours']), self::MAX_HOURS_QUARTERS);
        }
        return [$overtimeRupiah, $quarters];
    }

    /** $a + $b, refused above $max (both are non-negative and already within bounds). */
    private static function add(int $a, int $b, int $max): int
    {
        if ($b > $max - $a) {
            throw new PayrollOutOfBounds('payroll sum out of its bounds');
        }
        return $a + $b;
    }

    private static function salarySen(string $salary): int
    {
        if (!self::isSalary($salary) || preg_match('/^([0-9]+)\.([0-9]{2})$/', $salary, $m) !== 1) {
            throw new \LogicException('a payroll calculation needs an exact base salary greater than 0');
        }
        $sen = (int) $m[1] * self::SEN_PER_RUPIAH + (int) $m[2];
        if ($sen < 1 || $sen > self::MAX_SALARY_SEN) {
            throw new \LogicException('payroll base salary out of its integer bounds');
        }
        return $sen;
    }

    private static function amountRupiah(mixed $amount): int
    {
        if (!is_string($amount) || preg_match('/^(0|[1-9][0-9]{0,13})\.00$/', $amount, $m) !== 1) {
            throw new \LogicException('an approved overtime amount is a whole-Rupiah "N.00"');
        }
        return (int) $m[1];
    }

    private static function quarters(mixed $hours): int
    {
        if (!is_string($hours) || preg_match('/^(0|[1-9][0-9]{0,2})\.([0-9]{2})$/', $hours, $m) !== 1) {
            throw new \LogicException('approved overtime hours are an exact "N.NN"');
        }
        $hundredths = (int) $m[1] * 100 + (int) $m[2];
        if ($hundredths < self::HUNDREDTHS_PER_QUARTER || $hundredths > 74400 || $hundredths % self::HUNDREDTHS_PER_QUARTER !== 0) {
            throw new \LogicException('approved overtime hours are quarter hours above 0 and at most 744');
        }
        return intdiv($hundredths, self::HUNDREDTHS_PER_QUARTER);
    }

    private static function hoursString(int $quarters): string
    {
        $hundredths = $quarters * self::HUNDREDTHS_PER_QUARTER;
        return intdiv($hundredths, 100) . '.' . str_pad((string) ($hundredths % 100), 2, '0', STR_PAD_LEFT);
    }
}
