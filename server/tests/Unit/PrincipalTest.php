<?php
declare(strict_types=1);

use TamOs\Identity\AuthSession;
use TamOs\Identity\Principal;
use TamOs\Identity\Role;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;

$user = ['user_id' => str_repeat('1', 32), 'user_status' => 'active', 'has_password' => true];
$m = static fn (array $o = []): array => $o + [
    'membership_id' => str_repeat('2', 32), 'company_id' => str_repeat('3', 32), 'role' => 'ceo', 'employee_id' => null, 'membership_status' => 'active',
];

return [
    'Role is exactly ceo and employee; anything else has no role' => static function (): void {
        assertSame(['ceo', 'employee'], array_map(static fn (Role $r): string => $r->value, Role::cases()));
        foreach (['CEO', 'admin', '', 'owner', 'ceo '] as $bad) {
            assertSame(null, Role::tryFrom($bad));
        }
    },
    'a CEO without an employee binding and a bound Employee are principals' => static function () use ($user, $m): void {
        $ceo = Principal::fromAccount($user, [$m()]);
        assertTrue($ceo !== null, 'ceo');
        assertSame([str_repeat('1', 32), str_repeat('2', 32), str_repeat('3', 32), Role::Ceo, null],
            [$ceo->userId, $ceo->membershipId, $ceo->companyId, $ceo->role, $ceo->employeeId]);
        $emp = Principal::fromAccount($user, [$m(['role' => 'employee', 'employee_id' => 'emp-7'])]);
        assertSame([Role::Employee, 'emp-7'], [$emp?->role, $emp?->employeeId]);
        assertSame(['userId' => str_repeat('1', 32), 'membershipId' => str_repeat('2', 32), 'role' => 'employee', 'employeeId' => 'emp-7'], $emp?->projection());
    },
    'every deny case fails closed — no fallback role, no first membership' => static function () use ($user, $m): void {
        $cases = [
            'disabled user' => [['user_status' => 'disabled'] + $user, [$m()]],
            'unknown user status' => [['user_status' => 'pending'] + $user, [$m()]],
            'no password (not activated)' => [['has_password' => false] + $user, [$m()]],
            'no membership' => [$user, []],
            'two memberships' => [$user, [$m(), $m(['membership_id' => str_repeat('4', 32)])]],
            'two memberships, one disabled' => [$user, [$m(), $m(['membership_id' => str_repeat('4', 32), 'membership_status' => 'disabled'])]],
            'disabled membership' => [$user, [$m(['membership_status' => 'disabled'])]],
            'unknown role' => [$user, [$m(['role' => 'admin'])]],
            'upper-case role' => [$user, [$m(['role' => 'CEO'])]],
            'employee without binding' => [$user, [$m(['role' => 'employee', 'employee_id' => null])]],
            'empty binding' => [$user, [$m(['role' => 'employee', 'employee_id' => ''])]],
            'missing user id' => [['user_id' => ''] + $user, [$m()]],
            'missing company' => [$user, [$m(['company_id' => ''])]],
        ];
        foreach ($cases as $label => [$u, $ms]) {
            assertSame(null, Principal::fromAccount($u, $ms), $label);
        }
    },
    'identity-looking extras in the input rows never change the principal' => static function () use ($user, $m): void {
        $p = Principal::fromAccount($user + ['role' => 'ceo', 'actingAs' => 'ceo'], [$m(['role' => 'employee', 'employee_id' => 'e1', 'x_role' => 'ceo'])]);
        assertSame(Role::Employee, $p?->role);
    },
    'the projection never exposes companyId; AuthSession hides its CSRF token from dumps' => static function () use ($user, $m): void {
        $p = Principal::fromAccount($user, [$m()]);
        assertTrue($p !== null && !array_key_exists('companyId', $p->projection()), 'no companyId');
        $session = new AuthSession($p, str_repeat('c', 43));
        ob_start();
        var_export(print_r($session, true));
        $dump = (string) ob_get_clean();
        assertTrue(!str_contains($dump, str_repeat('c', 43)), 'csrf not dumped');
        $props = array_map(static fn (ReflectionProperty $r): string => $r->getName(), (new ReflectionClass(AuthSession::class))->getProperties());
        assertSame(['principal', 'csrfToken'], $props, 'no token hash in AuthSession');
    },
];
