<?php
declare(strict_types=1);

namespace TamOs\Overtime;

/**
 * The BF-4b2 overtime valuation (owner decisions D-BF4b-3 = A, D-BF4b-4 = A): one fixed,
 * versioned INTERNAL TAM method, TAM-OT-1 — never a statutory or legal formula. It is the LOCAL
 * "TAM Internal Overtime Calculation Method" (js/people/overtime.js) at the LOCAL company
 * defaults, with every input server-authoritative:
 *
 *   amount = monthly salary × overtime hours ÷ 160      (standard monthly hours 160.00, multiplier 1)
 *
 * in IDR (the single-currency invariant), with no intermediate rounding and ONE final half-up
 * rounding to the whole Rupiah. The hourly rate is never materialized. A future rule gets a new
 * method identity; TAM-OT-1 never changes meaning, so an Approved record's snapshot (method,
 * salary, standard hours, hours) always reproduces its amount.
 *
 * Exact arithmetic without binary floating point and without BCMath: every value is parsed from
 * its exact "N.NN" decimal string into integers — the salary in sen (hundredths of a Rupiah), the
 * hours and the standard hours in quarter-hours — and the result is one integer division with an
 * explicit half-up remainder test:
 *
 *   rupiah = round_half_up(salary_sen × hours_q ÷ (standard_q × 100))
 *
 * Bounds (signed 64-bit, asserted): salary_sen ≤ 999 999 999 999 999 (DECIMAL(15,2)), hours_q ≤
 * 2976 (744 h), so the numerator ≤ 2 975 999 999 999 997 024 < PHP_INT_MAX; the denominator is
 * 64 000; the largest amount, 46 500 000 000 000 Rupiah, fits approved_amount DECIMAL(16,2).
 * The multiplication is checked before it is made, and a failed bound is a LogicException (500),
 * never a wrapped or float result. Pure: no SQL, no clock, no state.
 */
final class OvertimeValuation
{
    public const METHOD = 'TAM-OT-1';
    public const STANDARD_MONTHLY_HOURS = '160.00';
    /** The largest salary in sen: monthly_base_salary is DECIMAL(15,2). */
    public const MAX_SALARY_SEN = 999999999999999;
    /** The largest hours in quarter-hours: 744.00 h (D-BF4b1-2). */
    public const MAX_HOURS_QUARTERS = 2976;
    private const SEN_PER_RUPIAH = 100;

    /**
     * The TAM-OT-1 valuation of $hours at $salary, as exact canonical strings.
     *
     * @param string $salary the monthly salary "N.NN", greater than 0
     * @param string $hours the overtime hours "N.NN" (OvertimeInput::isHours)
     * @return array{method: string, salary: string, standardHours: string, hours: string, amount: string}
     */
    public static function value(string $salary, string $hours): array
    {
        return [
            'method' => self::METHOD,
            'salary' => $salary,
            'standardHours' => self::STANDARD_MONTHLY_HOURS,
            'hours' => $hours,
            'amount' => self::amount(self::METHOD, $salary, self::STANDARD_MONTHLY_HOURS, $hours),
        ];
    }

    /**
     * Reproduces an amount from a snapshot. Only TAM-OT-1 exists, and only at 160.00 hours.
     *
     * @return string whole Rupiah as "N.00"
     */
    public static function amount(string $method, string $salary, string $standardHours, string $hours): string
    {
        if (PHP_INT_SIZE !== 8) {
            throw new \LogicException('overtime valuation needs signed 64-bit integers');
        }
        if ($method !== self::METHOD || $standardHours !== self::STANDARD_MONTHLY_HOURS) {
            throw new \LogicException('unknown overtime valuation method');
        }
        $salarySen = self::salarySen($salary);
        $hoursQ = self::quarters($hours);
        $standardQ = self::quarters($standardHours);
        if ($salarySen > intdiv(PHP_INT_MAX, $hoursQ)) {
            throw new \LogicException('overtime valuation out of its integer bounds');
        }
        $numerator = $salarySen * $hoursQ;
        $denominator = $standardQ * self::SEN_PER_RUPIAH;
        $rupiah = intdiv($numerator, $denominator);
        if (2 * ($numerator % $denominator) >= $denominator) {
            $rupiah++;                                      // half-up, the one rounding
        }
        return $rupiah . '.00';
    }

    /** True for an exact salary "N.NN" a valuation accepts: greater than 0, at most DECIMAL(15,2). */
    public static function isSalary(mixed $v): bool
    {
        return is_string($v) && preg_match('/^(0|[1-9][0-9]{0,12})\.([0-9]{2})$/', $v) === 1 && $v !== '0.00';
    }

    /** True for a whole-Rupiah amount "N.00" as approved_amount DECIMAL(16,2) serializes it. */
    public static function isAmount(mixed $v): bool
    {
        return is_string($v) && preg_match('/^(0|[1-9][0-9]{0,13})\.00$/', $v) === 1;
    }

    private static function salarySen(string $salary): int
    {
        if (!self::isSalary($salary) || preg_match('/^([0-9]+)\.([0-9]{2})$/', $salary, $m) !== 1) {
            throw new \LogicException('an overtime valuation needs an exact salary greater than 0');
        }
        $sen = (int) $m[1] * self::SEN_PER_RUPIAH + (int) $m[2];
        if ($sen < 1 || $sen > self::MAX_SALARY_SEN) {
            throw new \LogicException('overtime valuation out of its integer bounds');
        }
        return $sen;
    }

    private static function quarters(string $hours): int
    {
        if (!OvertimeInput::isHours($hours) || preg_match('/^([0-9]+)\.([0-9]{2})$/', $hours, $m) !== 1) {
            throw new \LogicException('an overtime valuation needs exact quarter hours');
        }
        $q = intdiv((int) $m[1] * 100 + (int) $m[2], 25);
        if ($q < 1 || $q > self::MAX_HOURS_QUARTERS) {
            throw new \LogicException('overtime valuation out of its integer bounds');
        }
        return $q;
    }
}
