<?php
declare(strict_types=1);

namespace TamOs\Data\Auth;

use TamOs\Data\Database;

/**
 * One-time account tokens, keyed by the SHA-256 of the token — the raw token is never stored
 * (SDR-0002 §5). Two purposes: "activation" (BF-3B, 72 hours) and "recovery" (BF-3D, 30
 * minutes). Every lookup names its purpose, so a recovery token can never activate an account
 * and an activation token can never reset a password. This class is the only writer of
 * account_tokens (tools/verify-backend-boundary.js).
 *
 * States: live (used_at and revoked_at NULL, expires_at still ahead), expired (derived from
 * the DATABASE clock, never stored), used and revoked — both final, never both (CHECK
 * account_tokens_final). Equality at expires_at means expired. Every statement that writes
 * a final state repeats the "not yet final" predicates, so no path can set both.
 *
 * Revocation on a credential event is purpose-agnostic (BF-3D): activation, a password change,
 * an operator reset and a recovery reset each revoke EVERY open token of the user, so no
 * earlier activation or recovery link survives a change of credentials.
 */
final class AccountTokenStore
{
    public const ACTIVATION = 'activation';
    public const RECOVERY = 'recovery';
    public const PURPOSES = [self::ACTIVATION, self::RECOVERY];
    public const ACTIVATION_HOURS = 72;
    public const RECOVERY_MINUTES = 30;

    // One literal per statement. The intervals must equal ACTIVATION_HOURS / RECOVERY_MINUTES
    // and the validity predicates must stay exactly these; tests/Unit/AccountTokenSqlTest.php
    // asserts both.
    public const ISSUE_SQL = 'INSERT INTO account_tokens (token_hash, user_id, purpose, created_at, expires_at, used_at, revoked_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 72 HOUR, NULL, NULL)';
    public const ISSUE_RECOVERY_SQL = 'INSERT INTO account_tokens (token_hash, user_id, purpose, created_at, expires_at, used_at, revoked_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 30 MINUTE, NULL, NULL)';
    public const PEEK_SQL = 'SELECT user_id, (used_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(6)) AS live FROM account_tokens WHERE token_hash = ? AND purpose = ?';
    public const LOCK_LIVE_SQL = 'SELECT token_hash FROM account_tokens WHERE token_hash = ? AND user_id = ? AND purpose = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(6) FOR UPDATE';
    public const CONSUME_SQL = 'UPDATE account_tokens SET used_at = UTC_TIMESTAMP(6) WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(6)';
    public const REVOKE_ALL_OPEN_SQL = 'UPDATE account_tokens SET revoked_at = UTC_TIMESTAMP(6) WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL';
    public const REVOKE_SQL = 'UPDATE account_tokens SET revoked_at = UTC_TIMESTAMP(6) WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL';
    public const EXPIRES_SQL = 'SELECT expires_at FROM account_tokens WHERE token_hash = ?';

    public function __construct(private readonly Database $db)
    {
    }

    /** Stores a new live token. Only a SHA-256 hex digest is accepted, never a raw token. */
    public function issue(string $tokenHash, string $userId, string $purpose): void
    {
        self::requireHash($tokenHash);
        $sql = match (self::requirePurpose($purpose)) {
            self::ACTIVATION => self::ISSUE_SQL,
            self::RECOVERY => self::ISSUE_RECOVERY_SQL,
        };
        $this->db->execute($sql, [$tokenHash, $userId, $purpose]);
    }

    /**
     * A non-locking look at a token of this purpose: its user and whether it is live now. Null
     * when no token of this purpose has this hash.
     *
     * @return array{userId: string, live: bool}|null
     */
    public function peek(string $tokenHash, string $purpose): ?array
    {
        $rows = $this->db->select(self::PEEK_SQL, [$tokenHash, self::requirePurpose($purpose)]);
        if ($rows === []) {
            return null;
        }
        return ['userId' => (string) $rows[0]['user_id'], 'live' => (int) $rows[0]['live'] === 1];
    }

    /** Locks the token row until the transaction ends; true only when it is live, of this purpose and the user's. */
    public function lockLive(string $tokenHash, string $userId, string $purpose): bool
    {
        return count($this->db->select(self::LOCK_LIVE_SQL, [$tokenHash, $userId, self::requirePurpose($purpose)])) === 1;
    }

    /** @return int 1 when a live token of this purpose was consumed, 0 when it was not live */
    public function consume(string $tokenHash, string $purpose): int
    {
        return $this->db->execute(self::CONSUME_SQL, [$tokenHash, self::requirePurpose($purpose)]);
    }

    /** Revokes every non-final token of the user, of every purpose (expired ones included). */
    public function revokeAllOpenForUser(string $userId): int
    {
        return $this->db->execute(self::REVOKE_ALL_OPEN_SQL, [$userId]);
    }

    /** Revokes one token if it is not final (a recovery token whose mail could not be delivered). */
    public function revoke(string $tokenHash): int
    {
        return $this->db->execute(self::REVOKE_SQL, [$tokenHash]);
    }

    /** The database-clock expiry of a token, as the database formats it. */
    public function expiresAt(string $tokenHash): string
    {
        $rows = $this->db->select(self::EXPIRES_SQL, [$tokenHash]);
        if ($rows === []) {
            throw new \LogicException('no such account token');
        }
        return (string) $rows[0]['expires_at'];
    }

    private static function requireHash(string $tokenHash): void
    {
        if (preg_match('/^[0-9a-f]{64}$/', $tokenHash) !== 1) {
            throw new \LogicException('account tokens are stored only as SHA-256 hex digests');
        }
    }

    private static function requirePurpose(string $purpose): string
    {
        if (!in_array($purpose, self::PURPOSES, true)) {
            throw new \LogicException('unknown account token purpose');
        }
        return $purpose;
    }
}
