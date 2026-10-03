<?php
declare(strict_types=1);

/*
 * BF-4c1 payroll calculation without a database (owner decisions D-PAY-2 = A, D-PAY-3 = A):
 * total = round_half_up_to_whole_rupiah(base salary + Σ frozen approved overtime amounts), exact
 * integer arithmetic only, one rounding, bounds refused rather than wrapped, malformed inputs a
 * defect. Every case is checked against an independent reference computed in this file.
 */

use TamOs\Payroll\PayrollCalculation;
use TamOs\Payroll\PayrollOutOfBounds;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$ot = static fn (string $hours, string $amount): array => ['hours' => $hours, 'amount' => $amount];
/** An independent reference: decimal strings → sen by string surgery, half-up on the last two digits. */
$reference = static function (string $salary, array $amounts): string {
    [$whole, $frac] = explode('.', $salary);
    $sen = (int) $whole * 100 + (int) $frac;
    foreach ($amounts as $a) {
        $sen += (int) explode('.', $a)[0] * 100;
    }
    $rupiah = intdiv($sen, 100) + ($sen % 100 >= 50 ? 1 : 0);
    return $rupiah . '.00';
};

return [
    'the reference cases: base only, base + one approved amount, base + several, an approved amount of zero' => static function () use ($ot): void {
        assertSame(['baseSalary' => '3500000.00', 'overtimeAmount' => '0.00', 'overtimeHours' => '0.00', 'overtimeCount' => 0, 'totalAmount' => '3500000.00'],
            PayrollCalculation::calculate('3500000.00', []), 'base only');
        assertSame(['baseSalary' => '3500000.00', 'overtimeAmount' => '218750.00', 'overtimeHours' => '10.00', 'overtimeCount' => 1, 'totalAmount' => '3718750.00'],
            PayrollCalculation::calculate('3500000.00', [$ot('10.00', '218750.00')]), 'one approved record');
        assertSame(['baseSalary' => '4123456.78', 'overtimeAmount' => '1000001.00', 'overtimeHours' => '12.75', 'overtimeCount' => 3, 'totalAmount' => '5123458.00'],
            PayrollCalculation::calculate('4123456.78', [$ot('0.25', '1.00'), $ot('2.50', '0.00'), $ot('10.00', '1000000.00')]), 'several, sen rounded half-up once');
        assertSame('0.00', PayrollCalculation::calculate('0.01', [])['totalAmount'], 'a tiny salary rounds to zero, never up by default');
    },
    'one half-up rounding on the sen of the base salary: .49 down, .50 up, .99 up; overtime amounts never round' => static function () use ($ot, $reference): void {
        foreach (['1000000.49' => '1000000.00', '1000000.50' => '1000001.00', '1000000.51' => '1000001.00', '1000000.99' => '1000001.00', '1000000.00' => '1000000.00', '0.50' => '1.00', '0.49' => '0.00'] as $salary => $total) {
            assertSame($total, PayrollCalculation::calculate($salary, [])['totalAmount'], $salary);
            assertSame($reference($salary, ['5.00']), PayrollCalculation::calculate($salary, [$ot('1.00', '5.00')])['totalAmount'], $salary . ' + overtime');
        }
    },
    'every sen of a salary against the independent reference, with and without overtime' => static function () use ($ot, $reference): void {
        for ($sen = 0; $sen < 100; $sen++) {
            $salary = '7654321.' . str_pad((string) $sen, 2, '0', STR_PAD_LEFT);
            assertSame($reference($salary, []), PayrollCalculation::calculate($salary, [])['totalAmount'], $salary);
            assertSame($reference($salary, ['123.00', '9999.00']), PayrollCalculation::calculate($salary, [$ot('1.00', '123.00'), $ot('744.00', '9999.00')])['totalAmount'], $salary . ' + 2');
        }
    },
    'hours are summed exactly in quarter-hours, for display only: they never enter the amount' => static function () use ($ot): void {
        $calc = PayrollCalculation::calculate('1000000.00', [$ot('0.25', '7.00'), $ot('0.50', '7.00'), $ot('0.75', '7.00'), $ot('744.00', '7.00')]);
        assertSame(['745.50', 4, '28.00', '1000028.00'], [$calc['overtimeHours'], $calc['overtimeCount'], $calc['overtimeAmount'], $calc['totalAmount']]);
        $a = PayrollCalculation::calculate('1000000.00', [$ot('1.00', '500.00')]);
        $b = PayrollCalculation::calculate('1000000.00', [$ot('700.00', '500.00')]);
        assertSame($a['totalAmount'], $b['totalAmount'], 'payroll never re-values overtime from hours (TAM-OT-1 stays with Overtime)');
    },
    'the bounds: the largest salary and amounts fit; one more Rupiah is refused, never wrapped' => static function () use ($ot): void {
        $max = PayrollCalculation::calculate('9999999999999.99', []);
        assertSame('10000000000000.00', $max['totalAmount'], 'the largest DECIMAL(15,2) salary rounds up exactly');
        $big = '99999999999999.00';                          // the largest approved_amount DECIMAL(16,2)
        $sum = PayrollCalculation::calculate('1.00', array_fill(0, 10, $ot('1.00', $big)));
        assertSame('999999999999990.00', $sum['overtimeAmount'], 'ten maximal approved amounts fit DECIMAL(17,2)');
        assertThrows(PayrollOutOfBounds::class, static fn () => PayrollCalculation::calculate('1.00', array_fill(0, 11, $ot('1.00', $big))), 'an overtime sum above DECIMAL(17,2)');
    },
    'a total that rounds above DECIMAL(17,2) is refused' => static function () use ($ot): void {
        $calc = PayrollCalculation::calculate('9999999999999.99', array_fill(0, 9, $ot('1.00', '99999999999999.00')));
        assertSame('909999999999991.00', $calc['totalAmount'], 'fits');
        assertThrows(PayrollOutOfBounds::class, static fn () => PayrollCalculation::calculate('9999999999999.99', array_fill(0, 10, $ot('1.00', '99999999999999.00'))), 'base + ten maximal amounts');
    },
    'malformed inputs are a defect (LogicException): zero or negative salary, floats, unrounded amounts, bad hours, extra keys' => static function () use ($ot): void {
        foreach (['0.00', '-1.00', '1', '1.0', '1.000', '01.00', ' 1.00', '1e6', '10000000000000.00'] as $bad) {
            assertThrows(\LogicException::class, static fn () => PayrollCalculation::calculate($bad, []), 'salary ' . $bad);
        }
        foreach ([$ot('1.00', '1.50'), $ot('1.00', '-1.00'), $ot('1.00', '1'), $ot('0.00', '1.00'), $ot('0.10', '1.00'), $ot('744.25', '1.00'), $ot('1', '1.00'),
            ['hours' => '1.00', 'amount' => '1.00', 'rate' => '1.00'], ['amount' => '1.00', 'hours' => '1.00']] as $i => $bad) {
            assertThrows(\LogicException::class, static fn () => PayrollCalculation::calculate('1.00', [$bad]), 'overtime ' . $i);
        }
    },
    'the shape predicates match the column types' => static function (): void {
        assertTrue(PayrollCalculation::isSalary('9999999999999.99') && !PayrollCalculation::isSalary('0.00') && !PayrollCalculation::isSalary('10000000000000.00') && !PayrollCalculation::isSalary(1.5), 'salary');
        assertTrue(PayrollCalculation::isAmount('0.00') && PayrollCalculation::isAmount('999999999999999.00') && !PayrollCalculation::isAmount('1000000000000000.00') && !PayrollCalculation::isAmount('1.50'), 'amount');
        assertTrue(PayrollCalculation::isHoursTotal('0.00') && PayrollCalculation::isHoursTotal('9999999.75') && !PayrollCalculation::isHoursTotal('1.10') && !PayrollCalculation::isHoursTotal('10000000.00'), 'hours');
    },
    'the source is integer arithmetic only: no float, rounding helper, BCMath, GMP or division operator' => static function (): void {
        $src = (string) file_get_contents(dirname(__DIR__, 2) . '/src/Payroll/PayrollCalculation.php');
        $code = preg_replace(['~/\*.*?\*/~s', '~//[^\n]*~', "~'[^']*'~"], ['', '', "''"], $src);
        assertTrue(preg_match('~\((float|double)\)|\b(floatval|round|floor|ceil|fdiv|fmod|bc[a-z]+|gmp_[a-z_]+)\s*\(|\*\*|/|\b\d+\.\d+~', (string) $code) === 0, 'integer only');
        assertTrue(str_contains($src, 'intdiv($totalSen, self::SEN_PER_RUPIAH)') && str_contains($src, 'PHP_INT_SIZE !== 8'), 'one intdiv, 64-bit asserted');
        assertTrue(!preg_match('/OvertimeValuation|TAM-OT-1/', (string) $code), 'never the overtime valuation');
    },
];
