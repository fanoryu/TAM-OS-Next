<?php
declare(strict_types=1);

/*
 * BF-4c2 Commit structure without a database (owner decisions D-BF4c2-1..4 = A): Commit as its own
 * operation from Ready, the exact commit input (expectedTotal and idempotencyKey grammars, never
 * coerced), the ONE drift evaluator Commit and the drift read share (eligibility, salary and the
 * Approved overtime set; display snapshots never drift; the closed reason enum in its fixed order;
 * the existing calculation, never a second formula), and the strict drift projection that exposes
 * no input value. Behaviour against MariaDB: tests/Db/PayrollCommitTest.php.
 */

use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Payroll\PayrollCalculation;
use TamOs\Payroll\PayrollDrift;
use TamOs\Payroll\PayrollInput;
use TamOs\Payroll\PayrollStatus;
use TamOs\Payroll\PayrollView;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$code = static function (callable $fn): array {
    try {
        $fn();
    } catch (ApiError $e) {
        return [$e->errorCode, $e->fields];
    }
    return [null, []];
};
$key = str_repeat('a', 32);
$id = str_repeat('c', 32);
$body = static fn (array $over = []): array => $over + ['id' => $id, 'expectedVersion' => 3, 'expectedTotal' => '3743750.00', 'idempotencyKey' => $key];
/** A Ready plan of 3 500 000.00 + two frozen Approved amounts (200 000 + 43 750) = 3 743 750.00. */
$plan = ['base_salary' => '3500000.00', 'overtime_amount' => '243750.00', 'overtime_hours' => '12.00', 'overtime_count' => '2', 'total_amount' => '3743750.00'];
$employee = ['archived_at' => null, 'employment_status' => 'Active', 'monthly_base_salary' => '3500000.00'];
$o1 = ['id' => str_repeat('1', 32), 'hours' => '10.00', 'approved_amount' => '200000.00'];
$o2 = ['id' => str_repeat('2', 32), 'hours' => '2.00', 'approved_amount' => '43750.00'];
$linked = [str_repeat('2', 32), str_repeat('1', 32)];

return [
    'Commit is its own operation from Ready only; the pre-commit graph is unchanged and nothing else reaches Committed' => static function (): void {
        assertSame(PayrollStatus::READY, PayrollStatus::COMMIT_FROM);
        assertSame(['review', 'approve', 'return', 'cancel'], array_keys(PayrollStatus::TRANSITIONS), 'commit is not a generic transition');
        foreach (PayrollStatus::TRANSITIONS as $op => [$from, $to]) {
            assertTrue($to !== PayrollStatus::COMMITTED, $op . ' never reaches Committed');
        }
        assertSame(['Committed', 'Cancelled'], PayrollStatus::TERMINAL);
    },
    'commit takes exactly { id, expectedVersion, expectedTotal, idempotencyKey }, never coerced' => static function () use ($code, $body, $key, $id): void {
        assertSame(['id' => $id, 'expectedVersion' => 3, 'expectedTotal' => '3743750.00', 'idempotencyKey' => $key], PayrollInput::commit($body()));
        foreach (['0.00', '1.00', '100.00', '999999999999999.00'] as $ok) {
            assertSame($ok, PayrollInput::commit($body(['expectedTotal' => $ok]))['expectedTotal'], $ok);
        }
        foreach (['0100.00', '100', '100.0', '100.000', '-1.00', '1.50', '1000000000000000.00', '', ' 1.00', 100, 100.0, null, ['1.00']] as $i => $bad) {
            assertSame([ErrorCode::ValidationFailed, ['expectedTotal']], $code(static fn () => PayrollInput::commit($body(['expectedTotal' => $bad]))), 'total ' . $i);
        }
        foreach ([strtoupper($key), substr($key, 1), $key . 'a', str_repeat('g', 32), '', 1, null, [$key]] as $i => $bad) {
            assertSame([ErrorCode::ValidationFailed, ['idempotencyKey']], $code(static fn () => PayrollInput::commit($body(['idempotencyKey' => $bad]))), 'key ' . $i);
        }
        foreach (['month', 'employeeId', 'companyId', 'role', 'status', 'salary', 'baseSalary', 'overtimeAmount', 'totalAmount', 'total', 'amount'] as $extra) {
            assertSame([ErrorCode::ValidationFailed, [$extra]], $code(static fn () => PayrollInput::commit($body([$extra => '1']))), $extra);
        }
        $missing = $body();
        unset($missing['idempotencyKey']);
        assertSame([ErrorCode::ValidationFailed, ['idempotencyKey']], $code(static fn () => PayrollInput::commit($missing)), 'a missing key is a 400 (M13)');
        assertSame([ErrorCode::ValidationFailed, ['id', 'expectedVersion', 'expectedTotal', 'idempotencyKey']], $code(static fn () => PayrollInput::commit(['id' => 'x', 'expectedVersion' => 0, 'expectedTotal' => 1, 'idempotencyKey' => 'k'])));
        assertSame(PayrollInput::KEY_PATTERN, '/^[0-9a-f]{32}$/');
    },
    'drift: a current plan has no reason' => static function () use ($plan, $employee, $o1, $o2, $linked): void {
        assertSame([], PayrollDrift::reasons($plan, $employee, [$o1, $o2], $linked));
        assertSame([], PayrollDrift::reasons(['base_salary' => '4123456.78', 'overtime_amount' => '0.00', 'overtime_hours' => '0.00', 'overtime_count' => 0, 'total_amount' => '4123457.00'], ['monthly_base_salary' => '4123456.78'] + $employee, [], []), 'no overtime, the one half-up rounding reproduced');
    },
    'drift: eligibility — archived, not Active, salary missing (D-BF4c2-2 = A)' => static function () use ($plan, $employee, $o1, $o2, $linked): void {
        assertSame(['employee_archived'], PayrollDrift::reasons($plan, ['archived_at' => '2026-10-01 00:00:00.000000'] + $employee, [$o1, $o2], $linked));
        assertSame(['employee_not_active'], PayrollDrift::reasons($plan, ['employment_status' => 'Inactive'] + $employee, [$o1, $o2], $linked));
        assertSame(['salary_missing'], PayrollDrift::reasons($plan, ['monthly_base_salary' => null] + $employee, [$o1, $o2], $linked));
        assertSame(['salary_missing'], PayrollDrift::reasons($plan, ['monthly_base_salary' => '0.00'] + $employee, [$o1, $o2], $linked));
    },
    'drift: salary — exact strings, never numbers' => static function () use ($plan, $employee, $o1, $o2, $linked): void {
        assertSame(['salary_changed'], PayrollDrift::reasons($plan, ['monthly_base_salary' => '3500000.01'] + $employee, [$o1, $o2], $linked));
        assertSame(['salary_changed'], PayrollDrift::reasons($plan, ['monthly_base_salary' => '3499999.99'] + $employee, [$o1, $o2], $linked), 'a sen below');
        $src = (string) file_get_contents(dirname(__DIR__, 2) . '/src/Payroll/PayrollDrift.php');
        $code = (string) preg_replace('/\/\*.*?\*\/|\/\/[^\n]*/s', '', $src);
        assertTrue(!preg_match('/\(float\)|floatval|\(int\)\s*\$salary|\bround\(|bc[a-z]+\(|gmp_|[^!=]==[^=]|[^!]!=[^=]|<>/', $code), 'no numeric comparison or float (M6)');
        assertTrue(!preg_match('/TAM-OT-1|OvertimeValuation|valuation/i', $code), 'never values overtime (M10)');
        $service = (string) preg_replace('/\/\*.*?\*\/|\/\/[^\n]*/s', '', (string) file_get_contents(dirname(__DIR__, 2) . '/src/Payroll/PayrollService.php'));
        assertTrue(!preg_match('/\(float\)|floatval|\bround\(|bc[a-z]+\(|gmp_|[^!=]==[^=]|[^!]!=[^=]|<>/', $service), 'commit compares expectedTotal and the key as exact strings — no float or loose comparison (M6)');
        assertTrue(str_contains($service, "(string) \$current['total_amount'] !== \$in['expectedTotal']"), 'the exact-string total guard');
    },
    'drift: Approved overtime — added, missing, a moved hour or amount, an out-of-bounds set' => static function () use ($plan, $employee, $o1, $o2, $linked): void {
        $o3 = ['id' => str_repeat('3', 32), 'hours' => '1.00', 'approved_amount' => '21875.00'];
        assertSame(['overtime_changed'], PayrollDrift::reasons($plan, $employee, [$o1, $o2, $o3], $linked), 'a newly Approved record (M8)');
        assertSame(['overtime_changed'], PayrollDrift::reasons($plan, $employee, [$o1], $linked), 'a linked record no longer Approved (M9)');
        assertSame(['overtime_changed'], PayrollDrift::reasons($plan, $employee, [$o1, $o2], [str_repeat('1', 32)]), 'a missing link (M9)');
        assertSame(['overtime_changed'], PayrollDrift::reasons($plan, $employee, [$o1, ['approved_amount' => '43751.00'] + $o2], $linked), 'a frozen amount that no longer matches');
        assertSame(['overtime_changed'], PayrollDrift::reasons($plan, $employee, [$o1, ['hours' => '2.25'] + $o2], $linked), 'hours that no longer match');
        assertSame(['overtime_changed'], PayrollDrift::reasons(['total_amount' => '3743751.00'] + $plan, $employee, [$o1, $o2], $linked), 'a total the calculation does not give');
        assertSame(['overtime_changed'], PayrollDrift::reasons(['overtime_count' => '3'] + $plan, $employee, [$o1, $o2], $linked), 'a count');
        $huge = array_map(static fn (int $i): array => ['id' => str_pad((string) $i, 32, '0', STR_PAD_LEFT), 'hours' => '744.00', 'approved_amount' => '99999999999999.00'], range(1, 11));
        assertSame(['overtime_changed'], PayrollDrift::reasons($plan, $employee, $huge, array_column($huge, 'id')), 'out of bounds is drift, never a crash');
    },
    'drift: display snapshots never drift; several reasons come once each in the fixed order' => static function () use ($plan, $employee, $o1, $o2, $linked): void {
        assertSame([], PayrollDrift::reasons($plan + ['employee_code_snapshot' => 'OLD', 'employee_name_snapshot' => 'Old', 'department_snapshot' => 'Old'], $employee + ['employee_code' => 'NEW', 'full_name' => 'New', 'department' => 'New'], [$o1, $o2], $linked), 'code, name and department are display snapshots');
        assertSame(PayrollDrift::REASONS, ['employee_archived', 'employee_not_active', 'salary_missing', 'salary_changed', 'overtime_changed']);
        assertSame(['employee_archived', 'employee_not_active', 'salary_missing', 'overtime_changed'], PayrollDrift::reasons($plan, ['archived_at' => 'x', 'employment_status' => 'Resigned', 'monthly_base_salary' => null], [$o1], $linked));
        assertSame(['employee_archived', 'salary_changed', 'overtime_changed'], PayrollDrift::reasons($plan, ['archived_at' => 'x', 'monthly_base_salary' => '1.00'] + $employee, [], $linked));
    },
    'the drift projection is exactly { id, current, reasons } — a closed enum in its order, current iff no reason, never an input value' => static function () use ($id): void {
        assertSame(['id', 'current', 'reasons'], PayrollView::DRIFT_FIELDS);
        assertSame(['id' => $id, 'current' => true, 'reasons' => []], PayrollView::drift(['id' => $id, 'reasons' => []]));
        assertSame(['id' => $id, 'current' => false, 'reasons' => ['salary_changed', 'overtime_changed']], PayrollView::drift(['id' => $id, 'reasons' => ['salary_changed', 'overtime_changed']]));
        foreach ([['salary_increased'], ['overtime_changed', 'salary_changed'], ['salary_changed', 'salary_changed'], ['x' => 'salary_changed'], [1]] as $i => $bad) {
            assertThrows(\LogicException::class, static fn () => PayrollView::drift(['id' => $id, 'reasons' => $bad]), 'an open or unordered enum ' . $i);
        }
        assertThrows(\LogicException::class, static fn () => PayrollView::drift(['id' => $id, 'reasons' => [], 'salary' => '1.00']), 'no extra key');
        foreach (PayrollDrift::REASONS as $r) {
            assertTrue((bool) preg_match('/^[a-z]+(_[a-z]+)+$/', $r) && !preg_match('/[0-9]/', $r), 'a reason is a word, never a value: ' . $r);
        }
    },
    'the plan projection gains no commit or drift field (AFI-4c1 strict decoder compatibility)' => static function (): void {
        assertSame(['id', 'employeeId', 'monthKey', 'status', 'employeeCode', 'employeeName', 'department', 'baseSalary', 'overtimeAmount', 'overtimeHours', 'overtimeCount', 'totalAmount', 'version'], PayrollView::FIELDS, 'exactly the thirteen BF-4c1 keys (M17)');
        $row = ['id' => str_repeat('b', 32), 'employee_id' => 'emp_1', 'month_key' => '2026-10', 'status' => 'Committed', 'employee_code_snapshot' => 'E-1', 'employee_name_snapshot' => 'Fabricated', 'department_snapshot' => null,
            'base_salary' => '1.00', 'overtime_amount' => '0.00', 'overtime_hours' => '0.00', 'overtime_count' => '0', 'total_amount' => '1.00', 'version' => '4', 'commit_idempotency_key' => str_repeat('f', 32), 'committed_at' => 'x'];
        assertSame(PayrollView::FIELDS, array_keys(PayrollView::plan($row)), 'a Committed row projects the same thirteen keys; the key and committed_at never leave');
        assertTrue(PayrollCalculation::isAmount('0.00') && !PayrollCalculation::isAmount('00.00'), 'the one canonical total spelling');
    },
];
