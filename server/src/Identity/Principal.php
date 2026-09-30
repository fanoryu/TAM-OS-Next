<?php
declare(strict_types=1);

namespace TamOs\Identity;

/**
 * The authoritative server-side identity of a request: who the user is, through which
 * membership, in which company, with which role and employee binding. Every field comes from
 * the database; nothing a browser sends (headers, query, body, an "acting as" choice) can
 * set or change one.
 *
 * The only way to build one is fromAccount(), which fails closed (returns null) unless the
 * account is exactly one usable identity. Callers are limited by
 * tools/verify-backend-boundary.js to the session resolver and the login path.
 */
final class Principal
{
    private function __construct(
        public readonly string $userId,
        public readonly string $membershipId,
        public readonly string $companyId,
        public readonly Role $role,
        public readonly ?string $employeeId,
    ) {
    }

    /**
     * SDR-0002 §6: an unknown role, a missing membership or more than one membership, a
     * disabled user or membership, an account without a password, or an Employee without an
     * employee binding all mean deny. There is no fallback role and no "first" membership.
     *
     * @param array{user_id: string, user_status: string, has_password: bool} $user
     * @param list<array{membership_id: string, company_id: string, role: string, employee_id: ?string, membership_status: string}> $memberships
     */
    public static function fromAccount(array $user, array $memberships): ?self
    {
        if (!is_string($user['user_id'] ?? null) || $user['user_id'] === ''
            || ($user['user_status'] ?? null) !== 'active' || ($user['has_password'] ?? null) !== true) {
            return null;
        }
        if (count($memberships) !== 1 || !array_is_list($memberships)) {
            return null;
        }
        $m = $memberships[0];
        if (($m['membership_status'] ?? null) !== 'active'
            || !is_string($m['membership_id'] ?? null) || $m['membership_id'] === ''
            || !is_string($m['company_id'] ?? null) || $m['company_id'] === '') {
            return null;
        }
        $role = is_string($m['role'] ?? null) ? Role::tryFrom($m['role']) : null;
        $employeeId = $m['employee_id'] ?? null;
        if ($role === null || ($employeeId !== null && (!is_string($employeeId) || $employeeId === ''))) {
            return null;
        }
        if ($role === Role::Employee && $employeeId === null) {
            return null;
        }
        return new self($user['user_id'], $m['membership_id'], $m['company_id'], $role, $employeeId);
    }

    /**
     * The client projection: identity the browser may display, never companyId or statuses.
     *
     * @return array{userId: string, membershipId: string, role: string, employeeId: ?string}
     */
    public function projection(): array
    {
        return [
            'userId' => $this->userId,
            'membershipId' => $this->membershipId,
            'role' => $this->role->value,
            'employeeId' => $this->employeeId,
        ];
    }
}
