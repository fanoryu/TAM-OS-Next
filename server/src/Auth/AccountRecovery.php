<?php
declare(strict_types=1);

namespace TamOs\Auth;

use TamOs\Identity\Role;

/**
 * Self-service password recovery (BF-3D, SDR-0002 §5).
 *
 * Only an account that could log in today — active user, a password already set, exactly one
 * active membership with a known role — can recover. A pending account (never activated) uses
 * the operator reset instead, so recovery never becomes a second, unaudited activation path;
 * a disabled account never recovers (recovery re-enables nothing). Both are refused silently:
 * the public response is the same for every address.
 */
final class AccountRecovery
{
    /**
     * @param array{user: array{user_status: string, has_password: bool}, memberships: list<array{membership_status: string, role: string}>} $account
     */
    public static function isRecoverable(array $account): bool
    {
        return $account['user']['user_status'] === 'active'
            && $account['user']['has_password'] === true
            && count($account['memberships']) === 1
            && $account['memberships'][0]['membership_status'] === 'active'
            && Role::tryFrom($account['memberships'][0]['role']) !== null;
    }
}
