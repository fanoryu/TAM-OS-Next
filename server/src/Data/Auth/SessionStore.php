<?php
declare(strict_types=1);

namespace TamOs\Data\Auth;

use TamOs\Data\Database;

/**
 * Session rows, keyed by the SHA-256 of the session token (the raw token is never stored).
 *
 * Validity is decided by the DATABASE clock only: a session is valid while it is not revoked,
 * UTC_TIMESTAMP(6) is strictly before absolute_expires_at, and last_seen_at is strictly after
 * UTC_TIMESTAMP(6) − 30 minutes. Equality at either boundary means expired.
 */
final class SessionStore
{
    public const IDLE_MINUTES = 30;
    public const ABSOLUTE_HOURS = 12;
    public const TOUCH_SECONDS = 60;

    // One literal per statement (the boundary check rejects assembled SQL). The interval
    // literals must equal the constants above; tests/Unit/AuthTokensTest.php asserts that.
    public const CREATE_SQL = 'INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, last_seen_at, absolute_expires_at, revoked_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 12 HOUR, NULL)';
    public const FIND_SQL = 'SELECT s.user_id, s.csrf_token, (s.last_seen_at <= UTC_TIMESTAMP(6) - INTERVAL 60 SECOND) AS touch_due, u.status AS user_status, (u.password_hash IS NOT NULL) AS has_password, m.id AS membership_id, m.company_id, m.role, m.employee_id, m.status AS membership_status FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN memberships m ON m.user_id = u.id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.absolute_expires_at > UTC_TIMESTAMP(6) AND s.last_seen_at > UTC_TIMESTAMP(6) - INTERVAL 30 MINUTE';
    // Repeats every validity predicate, so a touch can never revive a revoked or expired
    // session, and a concurrent second touch matches nothing.
    public const TOUCH_SQL = 'UPDATE sessions SET last_seen_at = UTC_TIMESTAMP(6) WHERE token_hash = ? AND revoked_at IS NULL AND absolute_expires_at > UTC_TIMESTAMP(6) AND last_seen_at > UTC_TIMESTAMP(6) - INTERVAL 30 MINUTE AND last_seen_at <= UTC_TIMESTAMP(6) - INTERVAL 60 SECOND';

    public function __construct(private readonly Database $db)
    {
    }

    public function create(string $tokenHash, string $userId, #[\SensitiveParameter] string $csrfToken): void
    {
        $this->db->execute(self::CREATE_SQL, [$tokenHash, $userId, $csrfToken]);
    }

    /**
     * The valid session with this token hash, its user and every membership row — or null.
     *
     * @return array{user: array{user_id: string, user_status: string, has_password: bool}, memberships: list<array<string, mixed>>, csrfToken: string, touchDue: bool}|null
     */
    public function findActive(string $tokenHash): ?array
    {
        $rows = $this->db->select(self::FIND_SQL, [$tokenHash]);
        if ($rows === []) {
            return null;
        }
        return [
            'user' => [
                'user_id' => (string) $rows[0]['user_id'],
                'user_status' => (string) $rows[0]['user_status'],
                'has_password' => (int) $rows[0]['has_password'] === 1,
            ],
            'memberships' => AccountStore::membershipRows($rows),
            'csrfToken' => (string) $rows[0]['csrf_token'],
            'touchDue' => (int) $rows[0]['touch_due'] === 1,
        ];
    }

    /** At most once per TOUCH_SECONDS; 0 rows (throttled, raced or no longer valid) is normal. */
    public function touch(string $tokenHash): void
    {
        $this->db->execute(self::TOUCH_SQL, [$tokenHash]);
    }

    /** @return int 1 when a live session was revoked, 0 when none matched */
    public function revoke(string $tokenHash): int
    {
        return $this->db->execute('UPDATE sessions SET revoked_at = UTC_TIMESTAMP(6) WHERE token_hash = ? AND revoked_at IS NULL', [$tokenHash]);
    }

    /** Store primitive for BF-3B (password change, disable, privilege change, revoke-all). */
    public function revokeAllForUser(string $userId): int
    {
        return $this->db->execute('UPDATE sessions SET revoked_at = UTC_TIMESTAMP(6) WHERE user_id = ? AND revoked_at IS NULL', [$userId]);
    }
}
