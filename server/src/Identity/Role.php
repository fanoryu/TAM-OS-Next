<?php
declare(strict_types=1);

namespace TamOs\Identity;

/**
 * The two membership roles (SDR-0002 §6). There is no general RBAC and no roles table; a
 * stored value outside this vocabulary resolves to no principal (Role::tryFrom → null → deny).
 */
enum Role: string
{
    case Ceo = 'ceo';
    case Employee = 'employee';
}
