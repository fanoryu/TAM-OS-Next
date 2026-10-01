<?php
declare(strict_types=1);

namespace TamOs\Data\Auth;

use TamOs\Data\Database;

/**
 * The mail outbox (BF-3D, migration 0013, D-D3): DELIVERY INTENT only — which user, which kind
 * of mail, how far delivery got. It never holds a recipient address, a token, a link or a
 * message body; the worker resolves the account and issues a fresh token at send time. This
 * class is the only writer of mail_outbox (tools/verify-backend-boundary.js).
 *
 *   pending ──claim──▶ sending ──sent──▶ sent
 *      ▲                  │ └─failure, attempts < MAX──▶ pending (next_attempt_at = backoff)
 *      │                  └──failure, attempts = MAX──▶ failed
 *      └── enqueue        any claimed row whose account is no longer recoverable ──▶ cancelled
 *
 * A row left in `sending` longer than STALE_MINUTES (a worker that died mid-send) is claimed
 * again. All times are the database clock.
 */
final class MailOutboxStore
{
    public const RECOVERY = 'recovery';
    public const MAX_ATTEMPTS = 5;
    public const STALE_MINUTES = 10;

    // One literal per statement; tests/Unit/MailOutboxSqlTest.php pins the state predicates.
    public const ENQUEUE_SQL = "INSERT INTO mail_outbox (user_id, kind, status, attempts, next_attempt_at, created_at, updated_at, request_id) VALUES (?, ?, 'pending', 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), ?)";
    public const OPEN_FOR_USER_SQL = "SELECT id FROM mail_outbox WHERE user_id = ? AND kind = ? AND status IN ('pending', 'sending') FOR UPDATE";
    public const CLAIM_SQL = "SELECT id, user_id, kind, attempts FROM mail_outbox WHERE (status = 'pending' AND next_attempt_at <= UTC_TIMESTAMP(6)) OR (status = 'sending' AND updated_at <= UTC_TIMESTAMP(6) - INTERVAL 10 MINUTE) ORDER BY id LIMIT 1 FOR UPDATE";
    public const MARK_SENDING_SQL = "UPDATE mail_outbox SET status = 'sending', attempts = attempts + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND status IN ('pending', 'sending')";
    public const MARK_SENT_SQL = "UPDATE mail_outbox SET status = 'sent', updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND status = 'sending'";
    public const RETRY_SQL = "UPDATE mail_outbox SET status = 'pending', next_attempt_at = UTC_TIMESTAMP(6) + INTERVAL ? SECOND, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND status = 'sending'";
    public const FAIL_SQL = "UPDATE mail_outbox SET status = 'failed', updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND status IN ('pending', 'sending')";
    public const CANCEL_SQL = "UPDATE mail_outbox SET status = 'cancelled', updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND status IN ('pending', 'sending')";

    /** Seconds before retry after attempt 1, 2, 3, 4 failed (attempt 5 is final). */
    public const BACKOFF_SECONDS = [60, 300, 900, 3600];

    public function __construct(private readonly Database $db)
    {
    }

    /**
     * Records delivery intent unless the user already has an undelivered mail of this kind (the
     * per-account request limit bounds how often this is reached). Must run inside
     * AuthData::atomically(): the open-row check locks until commit.
     *
     * @return bool true when a row was queued
     */
    public function enqueueOnce(string $userId, string $kind, string $requestId): bool
    {
        self::requireKind($kind);
        if ($this->db->select(self::OPEN_FOR_USER_SQL, [$userId, $kind]) !== []) {
            return false;
        }
        $this->db->execute(self::ENQUEUE_SQL, [$userId, $kind, $requestId]);
        return true;
    }

    /**
     * Locks the oldest due row (pending and due, or stale in sending) until the transaction ends.
     *
     * @return array{id: int, userId: string, kind: string, attempts: int}|null
     */
    public function claimDue(): ?array
    {
        $rows = $this->db->select(self::CLAIM_SQL);
        if ($rows === []) {
            return null;
        }
        $r = $rows[0];
        return ['id' => (int) $r['id'], 'userId' => (string) $r['user_id'], 'kind' => (string) $r['kind'], 'attempts' => (int) $r['attempts']];
    }

    public function markSending(int $id): void
    {
        self::requireOne($this->db->execute(self::MARK_SENDING_SQL, [$id]));
    }

    public function markSent(int $id): int
    {
        return $this->db->execute(self::MARK_SENT_SQL, [$id]);
    }

    public function scheduleRetry(int $id, int $attempt): int
    {
        return $this->db->execute(self::RETRY_SQL, [self::backoff($attempt), $id]);
    }

    public function markFailed(int $id): int
    {
        return $this->db->execute(self::FAIL_SQL, [$id]);
    }

    public function cancel(int $id): int
    {
        return $this->db->execute(self::CANCEL_SQL, [$id]);
    }

    public static function backoff(int $attempt): int
    {
        if ($attempt < 1 || $attempt >= self::MAX_ATTEMPTS) {
            throw new \LogicException('no retry after attempt ' . $attempt);
        }
        return self::BACKOFF_SECONDS[$attempt - 1];
    }

    private static function requireKind(string $kind): void
    {
        if ($kind !== self::RECOVERY) {
            throw new \LogicException('unknown mail kind');
        }
    }

    private static function requireOne(int $affected): void
    {
        if ($affected !== 1) {
            throw new \LogicException('outbox row changed underneath its lock');
        }
    }
}
