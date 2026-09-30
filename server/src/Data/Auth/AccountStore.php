<?php
declare(strict_types=1);

namespace TamOs\Data\Auth;

use TamOs\Data\Database;

/**
 * Account reads for login and the one account write BF-3A makes: upgrading a password hash
 * after a successful login. Accounts are created, activated and administered in BF-3B.
 */
final class AccountStore
{
    public function __construct(private readonly Database $db)
    {
    }

    /**
     * The user with this exact (normalized) email, its password hash and every membership row.
     *
     * @return array{user: array{user_id: string, user_status: string, has_password: bool}, passwordHash: ?string, memberships: list<array{membership_id: string, company_id: string, role: string, employee_id: ?string, membership_status: string}>}|null
     */
    public function findForLogin(string $email): ?array
    {
        $rows = $this->db->select(
            'SELECT u.id AS user_id, u.password_hash, u.status AS user_status, m.id AS membership_id, m.company_id, m.role, m.employee_id, m.status AS membership_status FROM users u LEFT JOIN memberships m ON m.user_id = u.id WHERE u.email = ?',
            [$email],
        );
        if ($rows === []) {
            return null;
        }
        $hash = $rows[0]['password_hash'];
        return [
            'user' => [
                'user_id' => (string) $rows[0]['user_id'],
                'user_status' => (string) $rows[0]['user_status'],
                'has_password' => $hash !== null,
            ],
            'passwordHash' => $hash === null ? null : (string) $hash,
            'memberships' => self::membershipRows($rows),
        ];
    }

    /**
     * Compare-and-swap: replaces the hash only if it is still the one that was verified, on
     * exactly that user row. False (nothing changed) when it was changed concurrently.
     */
    public function replacePasswordHash(string $userId, #[\SensitiveParameter] string $oldHash, #[\SensitiveParameter] string $newHash): bool
    {
        return $this->db->execute(
            'UPDATE users SET password_hash = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND password_hash = ?',
            [$newHash, $userId, $oldHash],
        ) === 1;
    }

    /**
     * Membership rows of a users ⟕ memberships result. A user without a membership yields one
     * row whose membership columns are NULL, which becomes an empty list — never a membership.
     * Every other row is kept, so a cardinality violation stays visible to Principal.
     *
     * @param list<array<string, mixed>> $rows
     * @return list<array{membership_id: string, company_id: string, role: string, employee_id: ?string, membership_status: string}>
     */
    public static function membershipRows(array $rows): array
    {
        $out = [];
        foreach ($rows as $row) {
            if ($row['membership_id'] === null) {
                continue;
            }
            $out[] = [
                'membership_id' => (string) $row['membership_id'],
                'company_id' => (string) $row['company_id'],
                'role' => (string) $row['role'],
                'employee_id' => $row['employee_id'] === null ? null : (string) $row['employee_id'],
                'membership_status' => (string) $row['membership_status'],
            ];
        }
        return $out;
    }
}
