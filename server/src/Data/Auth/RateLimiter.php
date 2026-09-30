<?php
declare(strict_types=1);

namespace TamOs\Data\Auth;

use TamOs\Data\Database;

/**
 * Login throttling state per bucket (a SHA-256 key for an account candidate or a client IP),
 * persisted in auth_rate_limits (SDR-0002 §4). All times are the database clock.
 *
 * A failure inside a window of WINDOW_SECONDS counts toward the bucket's threshold. Every
 * time the count reaches a multiple of the threshold the bucket locks for 1, 2, 4, 8 minutes,
 * then 15 minutes at most; a lock is never permanent. When the window has passed and the
 * bucket is not locked, the next failure starts a new window.
 *
 * lock() takes the row lock (creating the row when absent), so the attempts on one bucket
 * serialize while the caller's transaction is open. Every method must run inside
 * AuthData::atomically().
 */
final class RateLimiter
{
    public const WINDOW_SECONDS = 900;
    public const FIRST_LOCK_SECONDS = 60;
    public const MAX_LOCK_SECONDS = 900;
    private const TIME_FORMAT = 'Y-m-d H:i:s.u';

    public function __construct(private readonly Database $db)
    {
    }

    /**
     * Creates the bucket if needed and locks its row until the transaction ends.
     *
     * @return array{failures: int, windowStartedAt: string, lockedUntil: ?string, now: string}
     */
    public function lock(string $bucket): array
    {
        $this->db->execute(
            'INSERT INTO auth_rate_limits (bucket, failures, window_started_at, locked_until) VALUES (?, 0, UTC_TIMESTAMP(6), NULL) ON DUPLICATE KEY UPDATE bucket = bucket',
            [$bucket],
        );
        $rows = $this->db->select('SELECT failures, window_started_at, locked_until, UTC_TIMESTAMP(6) AS now FROM auth_rate_limits WHERE bucket = ? FOR UPDATE', [$bucket]);
        return self::state($rows[0]);
    }

    /**
     * Creates the bucket row if it is absent, OUTSIDE any transaction (autocommit): the row lock
     * is released at once. Used for the IP bucket before a login transaction, so inside that
     * transaction the IP row already exists and lock() takes only its record lock — never a
     * gap insert that concurrent first-time inserts could deadlock on (which would roll back,
     * and so not count, a failed attempt).
     */
    public function ensure(string $bucket): void
    {
        $this->db->execute(
            'INSERT INTO auth_rate_limits (bucket, failures, window_started_at, locked_until) VALUES (?, 0, UTC_TIMESTAMP(6), NULL) ON DUPLICATE KEY UPDATE bucket = bucket',
            [$bucket],
        );
    }

    /**
     * Reads the bucket without locking it (null when it has no row).
     *
     * @return array{failures: int, windowStartedAt: string, lockedUntil: ?string, now: string}|null
     */
    public function peek(string $bucket): ?array
    {
        $rows = $this->db->select('SELECT failures, window_started_at, locked_until, UTC_TIMESTAMP(6) AS now FROM auth_rate_limits WHERE bucket = ?', [$bucket]);
        return $rows === [] ? null : self::state($rows[0]);
    }

    /**
     * Records one failure on a bucket whose row this transaction has locked.
     *
     * @param array{failures: int, windowStartedAt: string, lockedUntil: ?string, now: string} $locked the state lock() returned
     */
    public function recordFailure(string $bucket, array $locked, int $threshold): void
    {
        $next = self::afterFailure($locked, $threshold);
        $this->db->execute(
            'UPDATE auth_rate_limits SET failures = ?, window_started_at = ?, locked_until = ? WHERE bucket = ?',
            [$next['failures'], $next['windowStartedAt'], $next['lockedUntil'], $bucket],
        );
    }

    /**
     * BF-3D request quota (password-recovery requests, SDR-0002 §4): counts every request, not
     * failures, in a fixed window of $windowSeconds, and admits at most $limit per window — no
     * backoff lock. A refused request is not counted. Uses the same row as the failure counter
     * (failures = requests in the window), on a bucket whose row this transaction has locked.
     *
     * @param array{failures: int, windowStartedAt: string, lockedUntil: ?string, now: string} $locked the state lock() returned
     * @return int 0 when admitted (and counted); otherwise the whole seconds until the window ends
     */
    public function consumeQuota(string $bucket, array $locked, int $limit, int $windowSeconds): int
    {
        $next = self::afterRequest($locked, $limit, $windowSeconds);
        if ($next['retryAfter'] > 0) {
            return $next['retryAfter'];
        }
        $this->db->execute(
            'UPDATE auth_rate_limits SET failures = ?, window_started_at = ?, locked_until = NULL WHERE bucket = ?',
            [$next['failures'], $next['windowStartedAt'], $bucket],
        );
        return 0;
    }

    /**
     * The pure quota transition for one request.
     *
     * @param array{failures: int, windowStartedAt: string, lockedUntil: ?string, now: string} $state
     * @return array{failures: int, windowStartedAt: string, retryAfter: int}
     */
    public static function afterRequest(array $state, int $limit, int $windowSeconds): array
    {
        if ($limit < 1 || $windowSeconds < 1) {
            throw new \LogicException('limit and window must be positive');
        }
        $now = self::time($state['now']);
        $windowEnd = self::time($state['windowStartedAt'])->modify('+' . $windowSeconds . ' seconds');
        if ($windowEnd <= $now) {
            return ['failures' => 1, 'windowStartedAt' => $state['now'], 'retryAfter' => 0];
        }
        if ($state['failures'] >= $limit) {
            $micros = ((int) $windowEnd->format('U') - (int) $now->format('U')) * 1000000 + ((int) $windowEnd->format('u') - (int) $now->format('u'));
            return ['failures' => $state['failures'], 'windowStartedAt' => $state['windowStartedAt'], 'retryAfter' => max(1, intdiv($micros + 999999, 1000000))];
        }
        return ['failures' => $state['failures'] + 1, 'windowStartedAt' => $state['windowStartedAt'], 'retryAfter' => 0];
    }

    public function reset(string $bucket): void
    {
        $this->db->execute('DELETE FROM auth_rate_limits WHERE bucket = ?', [$bucket]);
    }

    /**
     * The pure transition for one failure.
     *
     * @param array{failures: int, windowStartedAt: string, lockedUntil: ?string, now: string} $state
     * @return array{failures: int, windowStartedAt: string, lockedUntil: ?string}
     */
    public static function afterFailure(array $state, int $threshold): array
    {
        if ($threshold < 1) {
            throw new \LogicException('threshold must be positive');
        }
        $now = self::time($state['now']);
        $lockedUntil = $state['lockedUntil'];
        $locked = $lockedUntil !== null && self::time($lockedUntil) > $now;
        $expired = !$locked && self::time($state['windowStartedAt']) <= $now->modify('-' . self::WINDOW_SECONDS . ' seconds');

        $failures = $expired ? 1 : $state['failures'] + 1;
        $windowStartedAt = $expired ? $state['now'] : $state['windowStartedAt'];
        if ($expired) {
            $lockedUntil = null;
        }
        if ($failures % $threshold === 0) {
            $level = intdiv($failures, $threshold);
            $seconds = min(self::FIRST_LOCK_SECONDS * 2 ** min($level - 1, 16), self::MAX_LOCK_SECONDS);
            $until = $now->modify('+' . $seconds . ' seconds');
            // A new lock never shortens one already in force.
            if ($lockedUntil === null || self::time($lockedUntil) < $until) {
                $lockedUntil = $until->format(self::TIME_FORMAT);
            }
        }
        return ['failures' => $failures, 'windowStartedAt' => $windowStartedAt, 'lockedUntil' => $lockedUntil];
    }

    /**
     * Whole seconds (rounded up) until the bucket unlocks; 0 when it is not locked.
     *
     * @param array{lockedUntil: ?string, now: string} $state
     */
    public static function lockedFor(array $state): int
    {
        if ($state['lockedUntil'] === null) {
            return 0;
        }
        $now = self::time($state['now']);
        $until = self::time($state['lockedUntil']);
        if ($until <= $now) {
            return 0;
        }
        $micros = ((int) $until->format('U') - (int) $now->format('U')) * 1000000 + ((int) $until->format('u') - (int) $now->format('u'));
        return (int) min(self::MAX_LOCK_SECONDS, max(1, intdiv($micros + 999999, 1000000)));
    }

    /**
     * @param array<string, mixed> $row
     * @return array{failures: int, windowStartedAt: string, lockedUntil: ?string, now: string}
     */
    private static function state(array $row): array
    {
        return [
            'failures' => (int) $row['failures'],
            'windowStartedAt' => self::canonical((string) $row['window_started_at']),
            'lockedUntil' => $row['locked_until'] === null ? null : self::canonical((string) $row['locked_until']),
            'now' => self::canonical((string) $row['now']),
        ];
    }

    private static function canonical(string $value): string
    {
        return self::time($value)->format(self::TIME_FORMAT);
    }

    /** A database DATETIME(6) value, read as UTC (the connection's time zone is +00:00). */
    private static function time(string $value): \DateTimeImmutable
    {
        $utc = new \DateTimeZone('UTC');
        $time = \DateTimeImmutable::createFromFormat('!' . self::TIME_FORMAT, $value, $utc)
            ?: \DateTimeImmutable::createFromFormat('!Y-m-d H:i:s', $value, $utc);
        if ($time === false) {
            throw new \UnexpectedValueException('unreadable rate-limit timestamp');
        }
        return $time;
    }
}
