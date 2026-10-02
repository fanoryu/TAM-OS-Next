<?php
declare(strict_types=1);

/*
 * BF-4b1: strict overtime request validation. Exact per-route allowlists (no company, status,
 * version, actor, money, contract, payroll or project from a browser), the D-BF4b1-1 month/date
 * rule and the D-BF4b1-2 hours rule, validated exactly and never coerced.
 */

use TamOs\Data\Overtime\OvertimeStore;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Overtime\OvertimeInput;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$invalid = static function (callable $fn, array $fields, string $label): void {
    $e = assertThrows(ApiError::class, $fn, $label);
    assertSame([ErrorCode::ValidationFailed, $fields], [$e->errorCode, $e->fields], $label);
};
$minimal = ['employeeId' => 'emp_1', 'monthKey' => '2026-10', 'hours' => '2.50'];
$id = str_repeat('a', 32);

return [
    'the field map is exactly the five record columns, in OvertimeStore column order' => static function (): void {
        assertSame(OvertimeStore::RECORD, array_values(OvertimeInput::FIELDS));
        assertSame(['monthKey', 'overtimeDate', 'hours', 'workDescription', 'notes'], array_keys(OvertimeInput::FIELDS));
    },
    'create: employeeId, monthKey and hours are required; the rest is null; there is no status or version' => static function () use ($minimal, $invalid): void {
        $in = OvertimeInput::create($minimal);
        assertSame('emp_1', $in['employeeId']);
        assertSame(['month_key' => '2026-10', 'overtime_date' => null, 'hours' => '2.50', 'work_description' => null, 'notes' => null], $in['record']);
        $invalid(static fn () => OvertimeInput::create([]), ['employeeId', 'monthKey', 'hours'], 'empty');
        $invalid(static fn () => OvertimeInput::create(['employeeId' => 'emp_1', 'hours' => '1.00']), ['monthKey'], 'no month');
        $invalid(static fn () => OvertimeInput::create(['employeeId' => 'emp_1', 'monthKey' => '2026-10']), ['hours'], 'no hours');
        $invalid(static fn () => OvertimeInput::create(['monthKey' => '2026-10', 'hours' => '1.00']), ['employeeId'], 'no employee');
    },
    'create: every authority, money, contract, payroll and LOCAL-only key is refused by name' => static function () use ($minimal, $invalid): void {
        foreach (['company_id', 'companyId', 'status', 'version', 'expectedVersion', 'id', 'actor', 'createdAt', 'updatedAt', 'reviewedBy',
            'snapMonthlySalary', 'snapHoursPerDay', 'snapDaysPerWeek', 'snapWeeksPerMonth', 'scheduleSource', 'monthlyStandardHours', 'hourlyRate',
            'rawAmount', 'calculatedAmount', 'approvedAmount', 'contractId', 'contractNumber', 'payrollPlanId', 'committedTxnId',
            'overtimeRounding', 'overtimeMethodLabel', 'project', 'employeeName', 'history', 'month', 'year', 'monthNum', 'overtimeHours'] as $k) {
            $invalid(static fn () => OvertimeInput::create($minimal + [$k => 'x']), [$k], $k);
        }
    },
    'create: an invalid employeeId is named with any invalid field' => static function () use ($minimal, $invalid): void {
        foreach (['', 'has space', str_repeat('a', 65), 7, null, ['x']] as $bad) {
            $invalid(static fn () => OvertimeInput::create(['employeeId' => $bad] + $minimal), ['employeeId'], var_export($bad, true));
        }
        $invalid(static fn () => OvertimeInput::create(['employeeId' => '', 'monthKey' => 'x', 'hours' => '1.00']), ['employeeId', 'monthKey'], 'both');
    },
    'monthKey is exactly YYYY-MM from 1900 on (D-BF4b1-1)' => static function () use ($minimal, $invalid): void {
        foreach (['1900-01', '2026-01', '2026-12', '9999-09'] as $ok) {
            assertSame($ok, OvertimeInput::create(['monthKey' => $ok] + $minimal)['record']['month_key'], $ok);
        }
        foreach (['2026-13', '2026-00', '2026-1', '26-10', '2026/10', '2026-10-01', ' 2026-10', '1899-12', '', 202610, null] as $bad) {
            $invalid(static fn () => OvertimeInput::create(['monthKey' => $bad] + $minimal), ['monthKey'], var_export($bad, true));
        }
    },
    'overtimeDate is optional; when present it is a real date inside monthKey (D-BF4b1-1), never moving the month' => static function () use ($minimal, $invalid): void {
        foreach ([null, ''] as $none) {
            assertSame(null, OvertimeInput::create($minimal + ['overtimeDate' => $none])['record']['overtime_date'], var_export($none, true));
        }
        assertSame('2026-10-31', OvertimeInput::create($minimal + ['overtimeDate' => '2026-10-31'])['record']['overtime_date']);
        assertSame('2024-02-29', OvertimeInput::create(['monthKey' => '2024-02'] + $minimal + ['overtimeDate' => '2024-02-29'])['record']['overtime_date'], 'leap day');
        foreach (['2026-11-01', '2026-09-30', '2025-10-15'] as $outside) {
            $invalid(static fn () => OvertimeInput::create($minimal + ['overtimeDate' => $outside]), ['overtimeDate'], 'outside the month: ' . $outside);
        }
        foreach (['2026-10-32', '2026-02-30', '2023-02-29', '2026-10-1', '10/01/2026', '2026-10-01T00:00:00Z', 20261001] as $bad) {
            $invalid(static fn () => OvertimeInput::create($minimal + ['overtimeDate' => $bad]), ['overtimeDate'], var_export($bad, true));
        }
    },
    'hours are the exact string "N.NN", > 0, <= 744, in quarter hours (D-BF4b1-2); never a number or a float' => static function () use ($minimal, $invalid): void {
        foreach (['0.25', '0.50', '0.75', '1.00', '7.50', '12.25', '99.75', '743.75', '744.00'] as $ok) {
            assertSame($ok, OvertimeInput::create(['hours' => $ok] + $minimal)['record']['hours'], $ok);
        }
        foreach (['0.00', '0', '-1.00', '-0.25', '744.25', '745.00', '1000.00', '0.10', '0.20', '1.01', '7.33', '7.5', '7', '07.50', '7.500', ' 7.50', '7.50 ',
            '1e2', 'NaN', 'INF', 'Infinity', '', '7,50', '+7.50', 7.5, 7, 0, 7.50, true, null, []] as $bad) {
            $invalid(static fn () => OvertimeInput::create(['hours' => $bad] + $minimal), ['hours'], var_export($bad, true));
        }
        assertTrue(!OvertimeInput::isHours('0.00') && OvertimeInput::isHours('0.25') && OvertimeInput::isHours('744.00') && !OvertimeInput::isHours('744.25'), 'the boundaries');
    },
    'text: trimmed, "" becomes null, length in code points, control characters refused' => static function () use ($minimal, $invalid): void {
        $r = OvertimeInput::create($minimal + ['workDescription' => '  Fabricated audit prep  ', 'notes' => "line one\nline two\ttab"])['record'];
        assertSame(['Fabricated audit prep', "line one\nline two\ttab"], [$r['work_description'], $r['notes']]);
        assertSame([null, null], array_values(array_intersect_key(OvertimeInput::create($minimal + ['workDescription' => '   ', 'notes' => ''])['record'], ['work_description' => 1, 'notes' => 1])));
        assertSame(str_repeat('é', 160), OvertimeInput::create($minimal + ['workDescription' => str_repeat('é', 160)])['record']['work_description'], '160 code points');
        $invalid(static fn () => OvertimeInput::create($minimal + ['workDescription' => str_repeat('a', 161)]), ['workDescription'], '161');
        $invalid(static fn () => OvertimeInput::create($minimal + ['workDescription' => "two\nlines"]), ['workDescription'], 'single line');
        $invalid(static fn () => OvertimeInput::create($minimal + ['notes' => str_repeat('a', 2001)]), ['notes'], '2001');
        $invalid(static fn () => OvertimeInput::create($minimal + ['notes' => "bell\x07"]), ['notes'], 'control');
        $invalid(static fn () => OvertimeInput::create($minimal + ['notes' => "\xff\xfe"]), ['notes'], 'invalid UTF-8');
        $invalid(static fn () => OvertimeInput::create($minimal + ['notes' => 5]), ['notes'], 'not a string');
    },
    'update: id, expectedVersion and at least one record field; employeeId and authority keys are refused' => static function () use ($id, $invalid): void {
        $u = OvertimeInput::update(['id' => $id, 'expectedVersion' => 3, 'hours' => '4.00']);
        assertSame([$id, 3, ['hours' => '4.00']], [$u['id'], $u['expectedVersion'], $u['patch']]);
        $invalid(static fn () => OvertimeInput::update(['id' => $id, 'expectedVersion' => 1]), array_keys(OvertimeInput::FIELDS), 'no field');
        foreach (['employeeId', 'status', 'version', 'company_id', 'approvedAmount', 'hourlyRate', 'contractId'] as $k) {
            $invalid(static fn () => OvertimeInput::update(['id' => $id, 'expectedVersion' => 1, 'hours' => '1.00', $k => 'x']), [$k], $k);
        }
        $invalid(static fn () => OvertimeInput::update(['id' => $id, 'expectedVersion' => 1, 'hours' => '0.00']), ['hours'], 'invalid value before any lookup');
    },
    'targets: a server hex id and a positive integer version, nothing else' => static function () use ($id, $invalid): void {
        assertSame(['id' => $id, 'expectedVersion' => 1], OvertimeInput::transition(['id' => $id, 'expectedVersion' => 1]));
        foreach (['emp_1', strtoupper($id), str_repeat('a', 31), str_repeat('a', 33), '', 7] as $bad) {
            $invalid(static fn () => OvertimeInput::transition(['id' => $bad, 'expectedVersion' => 1]), ['id'], var_export($bad, true));
        }
        foreach ([0, -1, '1', 1.0, 4294967296, null] as $bad) {
            $invalid(static fn () => OvertimeInput::transition(['id' => $id, 'expectedVersion' => $bad]), ['expectedVersion'], var_export($bad, true));
        }
        $invalid(static fn () => OvertimeInput::transition(['id' => $id, 'expectedVersion' => 1, 'reason' => 'x']), ['reason'], 'no reject reason in BF-4b1');
        $invalid(static fn () => OvertimeInput::transition(['id' => $id, 'expectedVersion' => 1, 'status' => 'Approved']), ['status'], 'no status from a browser');
    },
    'apply re-checks the date/month rule against the record it changes' => static function () use ($invalid): void {
        $current = ['month_key' => '2026-10', 'overtime_date' => '2026-10-05', 'hours' => '1.00', 'work_description' => null, 'notes' => null];
        $invalid(static fn () => OvertimeInput::apply($current, ['monthKey' => '2026-11']), ['overtimeDate'], 'moving the month alone strands the date');
        assertSame(['2026-11', '2026-11-05'], array_slice(array_values(OvertimeInput::apply($current, ['monthKey' => '2026-11', 'overtimeDate' => '2026-11-05'])), 0, 2), 'both together');
        assertSame(['2026-11', null], array_slice(array_values(OvertimeInput::apply($current, ['monthKey' => '2026-11', 'overtimeDate' => null])), 0, 2), 'or the date cleared');
        assertSame(['hours'], OvertimeInput::changed($current, OvertimeInput::apply($current, ['hours' => '2.00', 'notes' => ''])), 'changed names only what differs');
    },
    'the list month and the detail id are validated before any lookup' => static function () use ($id): void {
        assertSame('2026-10', OvertimeInput::month('2026-10'));
        foreach ([null, '', '2026-13', '2026-1', 'all'] as $bad) {
            $e = assertThrows(ApiError::class, static fn () => OvertimeInput::month($bad), var_export($bad, true));
            assertSame(ErrorCode::InvalidQuery, $e->errorCode);
        }
        assertSame($id, OvertimeInput::id($id));
        assertSame(ErrorCode::ValidationFailed, assertThrows(ApiError::class, static fn () => OvertimeInput::id('emp_1'))->errorCode);
    },
];
