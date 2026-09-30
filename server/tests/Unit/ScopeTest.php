<?php
declare(strict_types=1);

use TamOs\Identity\Principal;
use TamOs\Policy\Scope;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;

$principal = static fn (string $role, ?string $employeeId, string $company = 'a'): ?Principal => Principal::fromAccount(
    ['user_id' => str_repeat('1', 32), 'user_status' => 'active', 'has_password' => true],
    [['membership_id' => str_repeat('2', 32), 'company_id' => str_repeat($company, 32), 'role' => $role, 'employee_id' => $employeeId, 'membership_status' => 'active']],
);

return [
    'a CEO is company-wide, with or without an employee binding' => static function () use ($principal): void {
        foreach ([null, 'emp_ceo'] as $binding) {
            $s = Scope::of($principal('ceo', $binding) ?? throw new \LogicException('p'));
            assertSame([str_repeat('a', 32), null, false], [$s->companyId, $s->selfEmployeeId, $s->isSelf()], var_export($binding, true));
        }
    },
    'an Employee is scoped to their company and their own binding' => static function () use ($principal): void {
        $s = Scope::of($principal('employee', 'emp_1') ?? throw new \LogicException('p'));
        assertSame([str_repeat('a', 32), 'emp_1', true], [$s->companyId, $s->selfEmployeeId, $s->isSelf()]);
    },
    'equality compares company and self' => static function () use ($principal): void {
        $of = static fn (string $r, ?string $e, string $c = 'a'): Scope => Scope::of($principal($r, $e, $c) ?? throw new \LogicException('p'));
        assertTrue($of('ceo', null)->equals($of('ceo', 'x')), 'two CEOs of one company');
        assertTrue(!$of('ceo', null)->equals($of('ceo', null, 'b')), 'another company');
        assertTrue(!$of('ceo', null)->equals($of('employee', 'e1')), 'CEO vs Employee');
        assertTrue(!$of('employee', 'e1')->equals($of('employee', 'e2')), 'two Employees');
    },
    'a scope can only be derived from a principal' => static function (): void {
        $c = new \ReflectionMethod(Scope::class, '__construct');
        assertTrue($c->isPrivate(), 'private constructor');
        $of = new \ReflectionMethod(Scope::class, 'of');
        assertSame([Principal::class], array_map(static fn (\ReflectionParameter $p): string => (string) $p->getType(), $of->getParameters()));
    },
];
