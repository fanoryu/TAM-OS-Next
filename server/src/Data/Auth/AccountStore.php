<?php
declare(strict_types=1);

namespace TamOs\Data\Auth;

use TamOs\Data\Database;

/**
 * Account reads and writes: login lookup and hash upgrade (BF-3A), and the BF-3B account
 * lifecycle — first-company bootstrap, activation, password change and operator reset.
 * This class is the only writer of companies, users and memberships
 * (tools/verify-backend-boundary.js). There is no generic account CRUD: BF-3B creates exactly
 * one kind of account, the pending bootstrap CEO.
 */
final class AccountStore
{
    public const ACCOUNT_COLUMNS_SQL = 'SELECT u.id AS user_id, u.email, u.password_hash, u.status AS user_status, m.id AS membership_id, m.company_id, m.role, m.employee_id, m.status AS membership_status FROM users u LEFT JOIN memberships m ON m.user_id = u.id WHERE u.id = ?';
    public const LOCK_BY_ID_SQL = 'SELECT u.id AS user_id, u.email, u.password_hash, u.status AS user_status, m.id AS membership_id, m.company_id, m.role, m.employee_id, m.status AS membership_status FROM users u LEFT JOIN memberships m ON m.user_id = u.id WHERE u.id = ? FOR UPDATE';
    public const LOCK_BY_EMAIL_SQL = 'SELECT u.id AS user_id, u.email, u.password_hash, u.status AS user_status, m.id AS membership_id, m.company_id, m.role, m.employee_id, m.status AS membership_status FROM users u LEFT JOIN memberships m ON m.user_id = u.id WHERE u.email = ? FOR UPDATE';
    public const REPLACE_HASH_SQL = 'UPDATE users SET password_hash = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND password_hash = ?';
    public const SET_INITIAL_HASH_SQL = 'UPDATE users SET password_hash = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND password_hash IS NULL';
    public const CLEAR_HASH_SQL = 'UPDATE users SET password_hash = NULL, updated_at = UTC_TIMESTAMP(6) WHERE id = ?';

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
        return $this->db->execute(self::REPLACE_HASH_SQL, [$newHash, $userId, $oldHash]) === 1;
    }

    /**
     * An account by user id — email, hash and every membership — without locking (a consistent
     * read). Null when there is no such user.
     *
     * @return array{user: array{user_id: string, user_status: string, has_password: bool}, email: string, passwordHash: ?string, memberships: list<array{membership_id: string, company_id: string, role: string, employee_id: ?string, membership_status: string}>}|null
     */
    public function findById(string $userId): ?array
    {
        return self::account($this->db->select(self::ACCOUNT_COLUMNS_SQL, [$userId]));
    }

    /**
     * The same account, with its user and membership rows locked until the transaction ends.
     *
     * @return array{user: array{user_id: string, user_status: string, has_password: bool}, email: string, passwordHash: ?string, memberships: list<array{membership_id: string, company_id: string, role: string, employee_id: ?string, membership_status: string}>}|null
     */
    public function lockById(string $userId): ?array
    {
        return self::account($this->db->select(self::LOCK_BY_ID_SQL, [$userId]));
    }

    /**
     * The account with this exact (normalized) email, locked until the transaction ends.
     *
     * @return array{user: array{user_id: string, user_status: string, has_password: bool}, email: string, passwordHash: ?string, memberships: list<array{membership_id: string, company_id: string, role: string, employee_id: ?string, membership_status: string}>}|null
     */
    public function lockByEmail(string $email): ?array
    {
        return self::account($this->db->select(self::LOCK_BY_EMAIL_SQL, [$email]));
    }

    /** Sets the first password of a pending account; false when it already has one. */
    public function setInitialPasswordHash(string $userId, #[\SensitiveParameter] string $newHash): bool
    {
        return $this->db->execute(self::SET_INITIAL_HASH_SQL, [$newHash, $userId]) === 1;
    }

    /** Operator reset: the account returns to pending (no password can authenticate). */
    public function clearPasswordHash(string $userId): void
    {
        $this->db->execute(self::CLEAR_HASH_SQL, [$userId]);
    }

    /**
     * Whether any company or any user exists. The bootstrap caller holds the account advisory
     * lock, which — not a locking read — is what serializes bootstraps.
     *
     * @return array{companies: bool, users: bool}
     */
    public function bootstrapState(): array
    {
        $row = $this->db->select('SELECT EXISTS (SELECT 1 FROM companies) AS companies, EXISTS (SELECT 1 FROM users) AS users')[0];
        return ['companies' => (int) $row['companies'] === 1, 'users' => (int) $row['users'] === 1];
    }

    public function createCompany(string $companyId): void
    {
        $this->db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$companyId]);
    }

    /** A pending user: active, with no password (it cannot authenticate until activated). */
    public function createPendingUser(string $userId, string $email): void
    {
        $this->db->execute(
            'INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (?, ?, NULL, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))',
            [$userId, $email, 'active'],
        );
    }

    /** The bootstrap CEO membership: active, no employee binding. */
    public function createCeoMembership(string $membershipId, string $userId, string $companyId): void
    {
        $this->db->execute(
            'INSERT INTO memberships (id, user_id, company_id, role, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))',
            [$membershipId, $userId, $companyId, 'ceo', 'active'],
        );
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

    /**
     * @param list<array<string, mixed>> $rows
     * @return array{user: array{user_id: string, user_status: string, has_password: bool}, email: string, passwordHash: ?string, memberships: list<array{membership_id: string, company_id: string, role: string, employee_id: ?string, membership_status: string}>}|null
     */
    private static function account(array $rows): ?array
    {
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
            'email' => (string) $rows[0]['email'],
            'passwordHash' => $hash === null ? null : (string) $hash,
            'memberships' => self::membershipRows($rows),
        ];
    }
}
