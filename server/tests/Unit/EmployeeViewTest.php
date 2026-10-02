<?php
declare(strict_types=1);

/*
 * BF-4a1: least-privilege Employee projections (SDR-0002 §9.1). The company list carries no
 * salary, notes or contact; the self view no notes, version or account data; no projection
 * carries company_id, the scope columns or anything beyond the profile. BF-4a2: the CEO list
 * and detail add the derived accountState, and nothing else about the login; the self view
 * gains nothing. BF-4a3: right after it, the CEO list and detail add the derived boolean
 * accountManageable; the self view still gains nothing.
 */

use TamOs\Employee\EmployeeView;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$row = [
    'id' => 'emp_1', 'company_id' => str_repeat('c', 32), 'owner_employee_id' => 'emp_1',
    'employee_code' => 'EMP-1', 'full_name' => 'Fabricated Person', 'job_title' => 'Engineer', 'department' => null,
    'employment_status' => 'Active', 'join_date' => '2026-01-05', 'contact_email' => 'person@example.test', 'phone' => '0812',
    'notes' => 'private note', 'monthly_base_salary' => '7500000.00', 'archived_at' => null, 'version' => 3,
    'account_state' => 'pending', 'account_manageable' => 1,
];
$sensitive = ['monthlyBaseSalary', 'notes', 'contactEmail', 'phone', 'joinDate', 'version'];

return [
    'the CEO list item is exactly the list fields — no salary, notes, contact or version' => static function () use ($row, $sensitive): void {
        $item = EmployeeView::listItem($row);
        assertSame(['id', 'employeeCode', 'fullName', 'jobTitle', 'department', 'employmentStatus', 'archived', 'accountState', 'accountManageable'], array_keys($item));
        assertSame(['emp_1', 'EMP-1', 'Fabricated Person', 'Engineer', null, 'Active', false, 'pending', true], array_values($item));
        foreach ($sensitive as $f) {
            assertTrue(!array_key_exists($f, $item), 'list leaks ' . $f);
        }
    },
    'the CEO detail adds the profile and version, nothing else' => static function () use ($row): void {
        $d = EmployeeView::detail($row + ['archived_at' => null]);
        assertSame(EmployeeView::DETAIL_FIELDS, array_keys($d));
        assertSame(['2026-01-05', 'person@example.test', '0812', 'private note', '7500000.00', 3], [$d['joinDate'], $d['contactEmail'], $d['phone'], $d['notes'], $d['monthlyBaseSalary'], $d['version']]);
        assertSame(true, EmployeeView::detail(array_merge($row, ['archived_at' => '2026-03-01 10:00:00.000000']))['archived'], 'archived flag');
        assertSame('pending', $d['accountState'], 'derived account state');
    },
    'BF-4a2: the CEO projections require a known account state; the self view never carries one' => static function () use ($row): void {
        foreach (['none', 'pending', 'active', 'disabled'] as $state) {
            assertSame($state, EmployeeView::listItem(['account_state' => $state] + $row)['accountState'], $state);
        }
        foreach ([null, '', 'Active', 'locked'] as $bad) {
            $broken = array_merge($row, ['account_state' => $bad]);
            assertThrows(\LogicException::class, static fn () => EmployeeView::listItem($broken), 'list ' . var_export($bad, true));
            assertThrows(\LogicException::class, static fn () => EmployeeView::detail($broken), 'detail ' . var_export($bad, true));
        }
        $self = EmployeeView::self(array_merge($row, ['account_state' => null]));
        assertTrue(!array_key_exists('accountState', $self), 'self carries no account state');
    },
    'BF-4a3: accountManageable follows accountState in list and detail, a strict boolean from SQL 1 / 0; anything else fails; self never carries it' => static function () use ($row): void {
        $d = EmployeeView::detail($row);
        assertSame(['version', 'accountState', 'accountManageable'], array_slice(array_keys($d), -3), 'detail order');
        assertSame('accountManageable', array_key_last(EmployeeView::listItem($row)), 'list order');
        foreach ([[1, true], ['1', true], [0, false], ['0', false]] as [$raw, $want]) {
            $r = array_merge($row, ['account_manageable' => $raw]);
            assertSame($want, EmployeeView::listItem($r)['accountManageable'], 'list ' . var_export($raw, true));
            assertSame($want, EmployeeView::detail($r)['accountManageable'], 'detail ' . var_export($raw, true));
        }
        foreach ([null, '', 'true', true, false, 2, '2', -1, 'yes'] as $bad) {
            $broken = array_merge($row, ['account_manageable' => $bad]);
            assertThrows(\LogicException::class, static fn () => EmployeeView::listItem($broken), 'list ' . var_export($bad, true));
            assertThrows(\LogicException::class, static fn () => EmployeeView::detail($broken), 'detail ' . var_export($bad, true));
        }
        $missing = $row;
        unset($missing['account_manageable']);
        assertThrows(\LogicException::class, static fn () => EmployeeView::detail($missing), 'a missing projection never defaults');
        $self = EmployeeView::self(array_diff_key($row, ['account_state' => 1, 'account_manageable' => 1]));
        assertTrue(!array_key_exists('accountManageable', $self) && !array_key_exists('accountState', $self), 'self carries neither');
        assertTrue(!array_key_exists('accountManageable', EmployeeView::self($row)), 'self drops it even when the row has it');
    },
    'the self view is the Employee\'s own profile without notes, version, archive or account data' => static function () use ($row): void {
        $s = EmployeeView::self($row);
        assertSame(['id', 'employeeCode', 'fullName', 'jobTitle', 'department', 'employmentStatus', 'joinDate', 'contactEmail', 'phone', 'monthlyBaseSalary'], array_keys($s));
        foreach (['notes', 'version', 'archived', 'accountState', 'accountManageable'] as $f) {
            assertTrue(!array_key_exists($f, $s), 'self leaks ' . $f);
        }
    },
    'no projection carries company_id, the scope columns, a bank field, a contract type or history' => static function () use ($row): void {
        $poisoned = $row + ['bank_account_number' => '123', 'contract_type' => 'PKWT', 'history' => 'h', 'password_hash' => 'x', 'csrf' => 'y',
            'user_id' => str_repeat('d', 32), 'membership_id' => str_repeat('e', 32), 'email' => 'login@example.test', 'token_hash' => str_repeat('f', 64)];
        foreach ([EmployeeView::listItem($poisoned), EmployeeView::detail($poisoned), EmployeeView::self($poisoned)] as $i => $view) {
            $json = json_encode($view, JSON_THROW_ON_ERROR);
            foreach ([str_repeat('c', 32), 'company', 'owner', 'bank', '123', 'PKWT', 'history', 'password', 'csrf', str_repeat('d', 32), str_repeat('e', 32), 'login@', str_repeat('f', 64), 'token', 'membership', 'userId'] as $needle) {
                assertTrue(stripos($json, $needle) === false, 'projection ' . $i . ' carries ' . $needle);
            }
        }
    },
    'profile() returns the ten profile columns as strings for write-back comparison' => static function () use ($row): void {
        $p = EmployeeView::profile($row);
        assertSame(['employee_code', 'full_name', 'job_title', 'department', 'employment_status', 'join_date', 'contact_email', 'phone', 'notes', 'monthly_base_salary'], array_keys($p));
        assertSame([null, '7500000.00'], [$p['department'], $p['monthly_base_salary']]);
    },
];
