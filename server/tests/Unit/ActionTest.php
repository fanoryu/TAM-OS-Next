<?php
declare(strict_types=1);

use TamOs\Policy\Action;
use TamOs\Policy\Rule;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;

// The frozen vocabulary, rules and entities of js/core/authz.js, restated here as the unit-level
// expectation; tools/verify-backend-boundary.js compares Action.php with authz.js itself.
$expected = [
    'employee.create' => [Rule::CeoOnly, null],
    'employee.update' => [Rule::CeoOnly, 'employee'],
    'employee.delete' => [Rule::CeoOnly, 'employee'],
    'contract.create' => [Rule::CeoOnly, null],
    'contract.update' => [Rule::CeoOnly, 'contract'],
    'contract.delete' => [Rule::CeoOnly, 'contract'],
    'payroll.manage' => [Rule::CeoOnly, 'payrollPlan'],
    'overtime.submitSelf' => [Rule::CeoOrOwnDraft, 'overtime'],
    'overtime.createSelfDraft' => [Rule::CeoOrOwnDraft, 'overtime'],
    'overtime.updateSelfDraft' => [Rule::CeoOrOwnDraft, 'overtime'],
    'overtime.deleteSelfDraft' => [Rule::CeoOrOwnDraft, 'overtime'],
    'overtime.manage' => [Rule::CeoOnly, 'overtime'],
    'finance.execute' => [Rule::CeoOnly, null],
    'finance.manage' => [Rule::CeoOnly, null],
    'import.commit' => [Rule::CeoOnly, null],
    'supplemental.manage' => [Rule::CeoOnly, null],
    'settings.manage' => [Rule::CeoOnly, null],
    'import.undo' => [Rule::CeoOnly, null],
    'data.restore' => [Rule::CeoOnly, null],
    'data.reset' => [Rule::CeoOnly, null],
    // BF-4a2 (SDR-0004, owner decision C1 = A): shared with authz.js, CEO-only, on the Employee record.
    'account.manage' => [Rule::CeoOnly, 'employee'],
    // ADR-016 §3 (AWP-01): Employee self-service on own Draft reimbursements, CeoOrOwnDraft.
    'reimbursement.createSelfDraft' => [Rule::CeoOrOwnDraft, 'financeRequest'],
    'reimbursement.updateSelfDraft' => [Rule::CeoOrOwnDraft, 'financeRequest'],
    'reimbursement.submitSelf' => [Rule::CeoOrOwnDraft, 'financeRequest'],
];

return [
    'the vocabulary is exactly the 21 frontend ACTIONS, without duplicates' => static function () use ($expected): void {
        $values = array_map(static fn (Action $a): string => $a->value, Action::cases());
        // ADR-016 (AWP-01) authorized revision: 24. Was: 21.
        assertSame(24, count($values), 'count');
        assertSame(24, count(array_unique($values)), 'no duplicates');
        assertSame(array_keys($expected), $values, 'values and order');
    },
    'every action has its frontend rule and entity (17 CeoOnly, 4 CeoOrOwnDraft)' => static function () use ($expected): void {
        foreach (Action::cases() as $a) {
            assertSame($expected[$a->value], [$a->rule(), $a->entity()], $a->value);
        }
        $own = array_values(array_filter(Action::cases(), static fn (Action $a): bool => $a->rule() === Rule::CeoOrOwnDraft));
        // ADR-016 (AWP-01) authorized revision: the three reimbursement self actions join (7). Was: the four overtime ones.
        assertSame(['overtime.submitSelf', 'overtime.createSelfDraft', 'overtime.updateSelfDraft', 'overtime.deleteSelfDraft', 'reimbursement.createSelfDraft', 'reimbursement.updateSelfDraft', 'reimbursement.submitSelf'],
            array_map(static fn (Action $a): string => $a->value, $own));
        assertSame(['CeoOnly', 'CeoOrOwnDraft'], array_map(static fn (Rule $r): string => $r->name, Rule::cases()), 'only two rules exist');
    },
    'an unknown or near-miss action string has no Action' => static function (): void {
        foreach (['', 'employee.read', 'Employee.create', 'employee.create ', 'overtime.submitself', 'admin', 'employee.merge',
            'recurring.manage', 'bank.manage', '*', 'EmployeeCreate', 'account.read', 'Account.manage', 'account.manageSelf', 'AccountManage'] as $bad) {
            assertSame(null, Action::tryFrom($bad), $bad);
        }
        assertTrue(!array_filter(Action::cases(), static fn (Action $a): bool => str_ends_with($a->value, '.read')), 'no read actions');
    },
];
