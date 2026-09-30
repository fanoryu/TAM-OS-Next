<?php
declare(strict_types=1);

namespace TamOs\Policy;

use TamOs\Identity\Principal;
use TamOs\Identity\Role;

/**
 * The authoritative data scope of a principal (SDR-0002 §8.1, §8.3): always its company, and for
 * the Employee role also its bound employee (SELF). A CEO is company-wide whether or not its
 * membership carries an employee binding.
 *
 * The only way to build one is Scope::of(), and a Principal only comes from the database, so no
 * request value — company_id, employee_id, role, user_id, permissions — can set or widen a scope.
 */
final class Scope
{
    private function __construct(
        public readonly string $companyId,
        public readonly ?string $selfEmployeeId,
    ) {
    }

    public static function of(Principal $principal): self
    {
        return match ($principal->role) {
            Role::Ceo => new self($principal->companyId, null),
            Role::Employee => new self($principal->companyId, $principal->employeeId
                ?? throw new \LogicException('an Employee principal always has an employee binding')),
        };
    }

    public function isSelf(): bool
    {
        return $this->selfEmployeeId !== null;
    }

    public function equals(self $other): bool
    {
        return $this->companyId === $other->companyId && $this->selfEmployeeId === $other->selfEmployeeId;
    }
}
