<?php
declare(strict_types=1);

/*
 * BF-4a1: strict Employee request validation. Exact per-route allowlists (no mass assignment,
 * no scope value from a browser), validated values that are never coerced, exact money.
 */

use TamOs\Data\Employee\EmployeeStore;
use TamOs\Employee\EmployeeInput;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$invalid = static function (callable $fn, array $fields, string $label): void {
    $e = assertThrows(ApiError::class, $fn, $label);
    assertSame([ErrorCode::ValidationFailed, $fields], [$e->errorCode, $e->fields], $label);
};
$minimal = ['employeeCode' => 'EMP-001', 'fullName' => 'Fabricated Person'];

return [
    'the field map is exactly the ten profile columns, in EmployeeStore column order' => static function (): void {
        assertSame(EmployeeStore::PROFILE, array_values(EmployeeInput::FIELDS));
        assertSame(['Active', 'Inactive', 'On Leave', 'Resigned', 'Terminated'], EmployeeInput::STATUSES, 'the frontend EMPLOYMENT_STATUSES');
    },
    'create: required code and name; status defaults to Active; everything else null' => static function () use ($minimal): void {
        $p = EmployeeInput::create($minimal);
        assertSame(EmployeeStore::PROFILE, array_keys($p), 'column order');
        assertSame(['EMP-001', 'Fabricated Person', null, null, 'Active', null, null, null, null, null], array_values($p));
    },
    'create: a full, valid profile is normalized, never coerced' => static function (): void {
        $p = EmployeeInput::create([
            'employeeCode' => '  EMP-7 ', 'fullName' => " Siti Rahma\u{0301}wati ", 'jobTitle' => 'Engineer', 'department' => '',
            'employmentStatus' => 'On Leave', 'joinDate' => '2026-02-28', 'contactEmail' => ' Person@Example.TEST ', 'phone' => '+62 (21) 555-0100',
            'notes' => "line one\nline two\ttabbed", 'monthlyBaseSalary' => '7500000.5',
        ]);
        assertSame(['EMP-7', "Siti Rahma\u{0301}wati", 'Engineer', null, 'On Leave', '2026-02-28', 'person@example.test', '+62 (21) 555-0100', "line one\nline two\ttabbed", '7500000.50'], array_values($p));
    },
    'money is exact: integers and decimal strings only, two decimals, canonical form' => static function () use ($minimal, $invalid): void {
        foreach ([[0, '0.00'], [12000000, '12000000.00'], ['0', '0.00'], ['007', '7.00'], ['1.5', '1.50'], ['9999999999999.99', '9999999999999.99'], [null, null]] as [$in, $out]) {
            assertSame($out, EmployeeInput::create($minimal + ['monthlyBaseSalary' => $in])['monthly_base_salary'], var_export($in, true));
        }
        foreach ([1.5, -1, '-1', '1.555', '1e6', '', ' 1', '10000000000000', 'abc', true, [], '1,000'] as $bad) {
            $invalid(static fn () => EmployeeInput::create($minimal + ['monthlyBaseSalary' => $bad]), ['monthlyBaseSalary'], 'salary ' . var_export($bad, true));
        }
    },
    'every field rejects a wrong type or shape, naming the field' => static function () use ($minimal, $invalid): void {
        $cases = [
            'employeeCode' => ['', '   ', 42, str_repeat('x', 33), "A\x07B", null],
            'fullName' => ['', null, str_repeat('n', 161), ['x'], "tab\tname"],
            'jobTitle' => [str_repeat('j', 121), 7, "x\ny"],
            'department' => [false, str_repeat('d', 121)],
            'employmentStatus' => ['active', 'ACTIVE', 'Fired', '', null, 1],
            'joinDate' => ['2026-02-30', '26-01-01', '2026/01/01', '1899-12-31', 20260101, '2026-1-1'],
            'contactEmail' => ['not-an-email', 'x@', 'ü@example.test', 5],
            'phone' => ['call me', '0812-ABC', str_repeat('1', 41), 812],
            'notes' => [str_repeat('n', 2001), "bell\x07", 3],
        ];
        foreach ($cases as $field => $values) {
            foreach ($values as $v) {
                $invalid(static fn () => EmployeeInput::create(array_merge($minimal, [$field => $v])), [$field], $field . ' ' . var_export($v, true));
            }
        }
    },
    'unknown keys are refused by name: no id, company, version, archive or actor on create' => static function () use ($minimal, $invalid): void {
        foreach (['id', 'company_id', 'companyId', 'version', 'archived_at', 'archived', 'createdAt', 'updated_at', 'actorUserId', 'employee_id', 'role', 'bankAccountNumber', 'contractType', 'history'] as $k) {
            $invalid(static fn () => EmployeeInput::create($minimal + [$k => 'x']), [$k], $k);
        }
        $e = assertThrows(ApiError::class, static fn () => EmployeeInput::create($minimal + ['bad key!' => 1]));
        assertSame([ErrorCode::ValidationFailed, []], [$e->errorCode, $e->fields], 'a key that is not a name is refused without being echoed');
    },
    'create requires employeeCode and fullName' => static function () use ($invalid): void {
        $invalid(static fn () => EmployeeInput::create([]), ['employeeCode', 'fullName'], 'empty');
        $invalid(static fn () => EmployeeInput::create(['fullName' => 'x']), ['employeeCode'], 'no code');
    },
    'update: id, expectedVersion and at least one field; the patch keeps API names' => static function () use ($invalid): void {
        $u = EmployeeInput::update(['id' => 'emp_1', 'expectedVersion' => 3, 'jobTitle' => 'Lead', 'monthlyBaseSalary' => null]);
        assertSame(['id' => 'emp_1', 'expectedVersion' => 3, 'patch' => ['jobTitle' => 'Lead', 'monthlyBaseSalary' => null]], $u);
        $invalid(static fn () => EmployeeInput::update(['id' => 'emp_1', 'expectedVersion' => 3]), array_keys(EmployeeInput::FIELDS), 'no field');
        $invalid(static fn () => EmployeeInput::update(['expectedVersion' => 1, 'jobTitle' => 'x']), ['id'], 'no id');
        $invalid(static fn () => EmployeeInput::update(['id' => 'emp_1', 'jobTitle' => 'x']), ['expectedVersion'], 'no version');
        foreach ([0, -1, '2', 1.0, 4294967296, null] as $v) {
            $invalid(static fn () => EmployeeInput::update(['id' => 'emp_1', 'expectedVersion' => $v, 'jobTitle' => 'x']), ['expectedVersion'], 'version ' . var_export($v, true));
        }
        foreach (['', 'a b', str_repeat('i', 65), 'émp', '../x', 7] as $id) {
            $invalid(static fn () => EmployeeInput::update(['id' => $id, 'expectedVersion' => 1, 'jobTitle' => 'x']), ['id'], 'id ' . var_export($id, true));
        }
        $invalid(static fn () => EmployeeInput::update(['id' => 'emp_1', 'expectedVersion' => 1, 'fullName' => '']), ['fullName'], 'a required field cannot be cleared');
        foreach (['company_id', 'version', 'archived_at', 'employee_id'] as $k) {
            $invalid(static fn () => EmployeeInput::update(['id' => 'emp_1', 'expectedVersion' => 1, 'jobTitle' => 'x', $k => 'y']), [$k], 'forged ' . $k);
        }
    },
    'archive: exactly id and expectedVersion' => static function () use ($invalid): void {
        assertSame(['id' => 'emp_1', 'expectedVersion' => 2], EmployeeInput::archive(['id' => 'emp_1', 'expectedVersion' => 2]));
        $invalid(static fn () => EmployeeInput::archive(['id' => 'emp_1', 'expectedVersion' => 2, 'archived_at' => 'now']), ['archived_at'], 'extra key');
        $invalid(static fn () => EmployeeInput::archive(['id' => 'emp_1']), ['expectedVersion'], 'no version');
    },
    'apply merges a validated patch; changed() names only fields whose value differs' => static function (): void {
        $before = EmployeeInput::create(['employeeCode' => 'E-1', 'fullName' => 'A', 'monthlyBaseSalary' => '100']);
        $after = EmployeeInput::apply($before, ['fullName' => 'A', 'department' => 'Ops', 'monthlyBaseSalary' => 100]);
        assertSame(['department'], EmployeeInput::changed($before, $after), 'same name and the same amount written differently are no change');
        assertSame([], EmployeeInput::changed($before, $before));
        assertTrue(EmployeeInput::changed(array_fill_keys(EmployeeStore::PROFILE, null), $before) === ['employeeCode', 'fullName', 'employmentStatus', 'monthlyBaseSalary'], 'create audits the fields set');
    },
];
