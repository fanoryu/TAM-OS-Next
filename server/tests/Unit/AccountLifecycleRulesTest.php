<?php
declare(strict_types=1);

/*
 * The pure account-lifecycle decisions (BF-3B): which account an operator reset may touch and
 * which account a live activation token may activate. Both fail closed on anything unexpected.
 */

use TamOs\Auth\AccountLifecycle;
use TamOs\Auth\AccountRefused;
use TamOs\Auth\IssuedActivation;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$account = static function (array $o = []): array {
    $membership = ['membership_id' => str_repeat('2', 32), 'company_id' => str_repeat('3', 32), 'role' => $o['role'] ?? 'ceo',
        'employee_id' => null, 'membership_status' => $o['membershipStatus'] ?? 'active'];
    return [
        'user' => ['user_id' => str_repeat('1', 32), 'user_status' => $o['userStatus'] ?? 'active', 'has_password' => $o['hasPassword'] ?? true],
        'email' => 'ceo@example.test',
        'passwordHash' => null,
        'memberships' => $o['memberships'] ?? [$membership],
    ];
};

return [
    'reset: an active CEO with one active membership may be reset, with or without a password' => static function () use ($account): void {
        assertSame(null, AccountLifecycle::resetRefusal($account()));
        assertSame(null, AccountLifecycle::resetRefusal($account(['hasPassword' => false])), 'expired bootstrap token: reissue');
    },
    'reset: every unexpected account fails closed with its reason' => static function () use ($account): void {
        $m = $account()['memberships'][0];
        $cases = [
            'disabled user' => [['userStatus' => 'disabled'], AccountRefused::ACCOUNT_DISABLED],
            'unknown user status' => [['userStatus' => 'pending'], AccountRefused::ACCOUNT_DISABLED],
            'disabled membership' => [['membershipStatus' => 'disabled'], AccountRefused::ACCOUNT_DISABLED],
            'no membership' => [['memberships' => []], AccountRefused::TOPOLOGY_INVALID],
            'two memberships' => [['memberships' => [$m, $m]], AccountRefused::TOPOLOGY_INVALID],
            'employee' => [['role' => 'employee'], AccountRefused::NOT_CEO],
            'unknown role' => [['role' => 'admin'], AccountRefused::NOT_CEO],
            'disabled user and employee' => [['userStatus' => 'disabled', 'role' => 'employee'], AccountRefused::ACCOUNT_DISABLED],
        ];
        foreach ($cases as $label => [$o, $reason]) {
            assertSame($reason, AccountLifecycle::resetRefusal($account($o)), $label);
        }
    },
    'activation: only an active, password-less account with exactly one active membership of a known role' => static function () use ($account): void {
        $m = $account()['memberships'][0];
        assertTrue(AccountLifecycle::isActivatable($account(['hasPassword' => false])), 'pending CEO');
        assertTrue(AccountLifecycle::isActivatable($account(['hasPassword' => false, 'role' => 'employee'])), 'role-agnostic for known roles');
        foreach ([
            'already has a password' => ['hasPassword' => true],
            'disabled user' => ['hasPassword' => false, 'userStatus' => 'disabled'],
            'disabled membership' => ['hasPassword' => false, 'membershipStatus' => 'disabled'],
            'no membership' => ['hasPassword' => false, 'memberships' => []],
            'two memberships' => ['hasPassword' => false, 'memberships' => [$m, $m]],
            'unknown role' => ['hasPassword' => false, 'role' => 'admin'],
        ] as $label => $o) {
            assertTrue(!AccountLifecycle::isActivatable($account($o)), $label);
        }
    },
    'refusal reasons are fixed codes; an issued token never appears in a dump' => static function (): void {
        assertSame('busy', (new AccountRefused(AccountRefused::BUSY))->reason);
        assertThrows(LogicException::class, static fn () => new AccountRefused('someone@example.test'));
        $issued = new IssuedActivation(str_repeat('1', 32), 'raw-token-value-that-must-not-leak', '2026-10-03 00:00:00.000000');
        ob_start();
        var_dump($issued);
        $dump = (string) ob_get_clean();
        assertTrue(!str_contains($dump, 'raw-token-value') && str_contains($dump, '[REDACTED]'), 'redacted');
    },
];
