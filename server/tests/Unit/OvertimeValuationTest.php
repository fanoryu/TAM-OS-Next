<?php
declare(strict_types=1);

/*
 * BF-4b2 TAM-OT-1 without a database (owner decisions D-BF4b-3 = A, D-BF4b-4 = A): exact
 * integer arithmetic (sen × quarter-hours, one half-up division), its bounds, every quarter hour,
 * the rounding boundaries, reproducibility from a snapshot, the strict valuation projection and
 * the approve request allowlist. TAM-OT-1 is an internal TAM method: no statutory divisor (173),
 * no multiplier tier. Fabricated amounts only.
 */

use TamOs\Http\ApiError;
use TamOs\Overtime\OvertimeInput;
use TamOs\Overtime\OvertimeValuation;
use TamOs\Overtime\OvertimeValuationView;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$amount = static fn (string $salary, string $hours): string => OvertimeValuation::value($salary, $hours)['amount'];
$hoursOf = static fn (int $q): string => intdiv($q * 25, 100) . '.' . str_pad((string) ($q * 25 % 100), 2, '0', STR_PAD_LEFT);

return [
    'TAM-OT-1 is salary × hours ÷ 160 in IDR, multiplier 1, one half-up rounding to the whole Rupiah' => static function () use ($amount): void {
        assertSame(['method' => 'TAM-OT-1', 'salary' => '3500000.00', 'standardHours' => '160.00', 'hours' => '10.00', 'amount' => '218750.00'],
            OvertimeValuation::value('3500000.00', '10.00'), 'the LOCAL reference case: Rp218,750 exactly');
        foreach ([
            ['4123456.78', '7.50', '193287.00'],     // 193 287.0365625 → down
            ['1000000.00', '0.25', '1563.00'],       // 1 562.5 → half-up
            ['1000000.00', '0.75', '4688.00'],       // 4 687.5 → half-up
            ['320.00', '0.25', '1.00'],              // exactly 0.5 → 1
            ['319.99', '0.25', '0.00'],              // 0.49998 → 0
            ['0.01', '0.25', '0.00'],                // the smallest inputs
            ['160.00', '1.00', '1.00'],
            ['5000000.00', '744.00', '23250000.00'],
            ['7654321.09', '1.25', '59799.00'],      // 59 799.3835… → down
        ] as [$salary, $hours, $expected]) {
            assertSame($expected, $amount($salary, $hours), $salary . ' × ' . $hours);
        }
        assertSame('TAM-OT-1', OvertimeValuation::METHOD);
        assertSame('160.00', OvertimeValuation::STANDARD_MONTHLY_HOURS, 'the fixed standard monthly hours — never 173');
    },
    'the bounds: the largest salary × 744 hours fits signed 64-bit and DECIMAL(16,2); anything outside is refused, never wrapped' => static function () use ($amount): void {
        assertSame(8, PHP_INT_SIZE, 'the supported runtime has signed 64-bit integers');
        assertTrue(OvertimeValuation::MAX_SALARY_SEN * OvertimeValuation::MAX_HOURS_QUARTERS <= PHP_INT_MAX, 'the largest numerator fits');
        assertTrue(is_int(OvertimeValuation::MAX_SALARY_SEN * OvertimeValuation::MAX_HOURS_QUARTERS), 'and stays an integer');
        assertSame('46500000000000.00', $amount('9999999999999.99', '744.00'), 'the maximum amount (14 integer digits: DECIMAL(16,2))');
        assertSame('62500000000.00', $amount('9999999999999.99', '1.00'));
        foreach (['10000000000000.00', '0.00', '-1.00', '1.5', '1', '1.000', '01.00', '1e3', ' 1.00', '1,000.00', ''] as $bad) {
            assertThrows(\LogicException::class, static fn () => OvertimeValuation::value($bad, '1.00'), 'salary ' . var_export($bad, true));
        }
        foreach (['0.00', '0.10', '744.25', '1.5', '-1.00', '1000.00'] as $bad) {
            assertThrows(\LogicException::class, static fn () => OvertimeValuation::value('1000.00', $bad), 'hours ' . $bad);
        }
    },
    'every quarter hour from 0.25 to 744.00 matches an independent integer reference' => static function () use ($amount, $hoursOf): void {
        // 3 500 000 ÷ 160 = 21 875 per hour exactly, so the amount is 21 875 × q ÷ 4, half-up.
        for ($q = 1; $q <= 2976; $q++) {
            $expected = intdiv(21875 * $q + 2, 4) . '.00';
            if ($amount('3500000.00', $hoursOf($q)) !== $expected) {
                assertSame($expected, $amount('3500000.00', $hoursOf($q)), 'q = ' . $q);
            }
        }
        // 1 000 000.01 ÷ 160 is not exact: half-up of 100 000 001 × q ÷ 64 000 against a second derivation.
        for ($q = 1; $q <= 2976; $q += 7) {
            $num = 100000001 * $q;
            $expected = intdiv(2 * $num + 64000, 128000) . '.00';
            assertSame($expected, $amount('1000000.01', $hoursOf($q)), 'q = ' . $q);
        }
    },
    'a snapshot reproduces its amount without the live salary; a foreign method or standard is refused' => static function (): void {
        $v = OvertimeValuation::value('4123456.78', '7.50');
        assertSame($v['amount'], OvertimeValuation::amount($v['method'], $v['salary'], $v['standardHours'], $v['hours']));
        foreach ([['TAM-OT-2', '160.00'], ['tam-ot-1', '160.00'], ['TAM-OT-1', '173.00'], ['TAM-OT-1', '160'], ['', '160.00']] as [$method, $standard]) {
            assertThrows(\LogicException::class, static fn () => OvertimeValuation::amount($method, '1000.00', $standard, '1.00'), $method . ' / ' . $standard);
        }
    },
    'the valuation source holds no float, BCMath, rounding helper or division operator: integers only' => static function (): void {
        $src = (string) file_get_contents(dirname(__DIR__, 2) . '/src/Overtime/OvertimeValuation.php');
        $code = (string) preg_replace(["~/\\*.*?\\*/~s", '~//[^\n]*~', "~'[^']*'~"], ['', '', "''"], $src);
        foreach (['(float)', '(double)', 'floatval', 'round(', 'floor(', 'ceil(', 'fdiv(', 'number_format', 'bcadd', 'bcmul', 'bcdiv', 'gmp_', '**'] as $needle) {
            assertTrue(!str_contains($code, $needle), 'no ' . $needle);
        }
        assertTrue(preg_match('~[^/]/[^/*]~', $code) !== 1, 'no division operator: intdiv() only');
        assertTrue(preg_match('/\b\d+\.\d+\b/', $code) !== 1, 'no float literal');
    },
    'the valuation projection: exactly seven exact strings; an approved row must reproduce from its snapshot' => static function (): void {
        $id = str_repeat('a', 32);
        $preview = OvertimeValuationView::preview($id, OvertimeValuation::value('3500000.00', '10.00'));
        assertSame(OvertimeValuationView::FIELDS, array_keys($preview));
        assertSame([$id, 'preview', 'TAM-OT-1', '10.00', '3500000.00', '160.00', '218750.00'], array_values($preview));
        $row = ['id' => $id, 'company_id' => str_repeat('c', 32), 'owner_employee_id' => 'e_1', 'hours' => '10.00', 'status' => 'Approved', 'version' => '5',
            'valuation_method' => 'TAM-OT-1', 'valuation_salary' => '3500000.00', 'valuation_standard_hours' => '160.00', 'approved_amount' => '218750.00'];
        assertSame([$id, 'approved', 'TAM-OT-1', '10.00', '3500000.00', '160.00', '218750.00'], array_values(OvertimeValuationView::approved($row)));
        foreach (['company', 'employee', 'rate', 'hourly', 'payroll', 'actor', 'At', 'version', 'status'] as $needle) {
            foreach (OvertimeValuationView::FIELDS as $f) {
                assertTrue(stripos($f, $needle) === false, $f . ' carries no ' . $needle);
            }
        }
        foreach ([
            'a tampered amount' => ['approved_amount' => '218751.00'], 'a missing snapshot' => ['valuation_salary' => null],
            'a Reviewed row' => ['status' => 'Reviewed'], 'a foreign method' => ['valuation_method' => 'TAM-OT-2'],
            'another standard' => ['valuation_standard_hours' => '173.00'], 'a fractional amount' => ['approved_amount' => '218750.50'],
        ] as $label => $bad) {
            assertThrows(\LogicException::class, static fn () => OvertimeValuationView::approved($bad + $row), $label);
        }
    },
    'approve takes exactly id, expectedVersion and a whole-Rupiah expectedAmount string; every valuation input from a browser is refused' => static function (): void {
        $id = str_repeat('b', 32);
        assertSame(['id' => $id, 'expectedVersion' => 3, 'expectedAmount' => '218750.00'], OvertimeInput::approve(['id' => $id, 'expectedVersion' => 3, 'expectedAmount' => '218750.00']));
        $fields = static fn (array $json): array => assertThrows(ApiError::class, static fn () => OvertimeInput::approve($json))->fields;
        assertSame(['expectedAmount'], $fields(['id' => $id, 'expectedVersion' => 3]), 'required');
        foreach ([218750, 218750.0, '218750', '218750.5', '218750.50', '-1.00', '0218750.00', '1e5', null, true] as $bad) {
            assertSame(['expectedAmount'], $fields(['id' => $id, 'expectedVersion' => 3, 'expectedAmount' => $bad]), var_export($bad, true));
        }
        assertSame(['id', 'expectedVersion', 'expectedAmount'], $fields(['id' => 'x', 'expectedVersion' => '3', 'expectedAmount' => 1]), 'all named together');
        foreach (['salary', 'monthlySalaryBasis', 'hours', 'standardMonthlyHours', 'multiplier', 'method', 'amount', 'status', 'employeeId', 'company_id', 'approvedAmount'] as $key) {
            assertSame([$key], $fields(['id' => $id, 'expectedVersion' => 3, 'expectedAmount' => '1.00', $key => '1.00']), $key);
        }
    },
];
