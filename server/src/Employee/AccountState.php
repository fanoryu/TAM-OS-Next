<?php
declare(strict_types=1);

namespace TamOs\Employee;

/**
 * The account state of an Employee record (BF-4a2, SDR-0004 §3), DERIVED from the login bound to
 * it — never stored. EmployeeStore computes the same rule in SQL for the CEO reads.
 *
 *   none      no membership is bound to the record
 *   pending   membership and user active, no password yet (activation outstanding)
 *   active    membership and user active, password set
 *   disabled  the membership (or the user) is disabled
 *
 * Employment status and archive are separate facts and never change this state.
 */
final class AccountState
{
    public const NONE = 'none';
    public const PENDING = 'pending';
    public const ACTIVE = 'active';
    public const DISABLED = 'disabled';
    public const VALUES = [self::NONE, self::PENDING, self::ACTIVE, self::DISABLED];

    /** @param array{membershipStatus: string, userStatus: string, hasPassword: bool}|null $account */
    public static function of(?array $account): string
    {
        if ($account === null) {
            return self::NONE;
        }
        if ($account['membershipStatus'] !== 'active' || $account['userStatus'] !== 'active') {
            return self::DISABLED;
        }
        return $account['hasPassword'] ? self::ACTIVE : self::PENDING;
    }
}
