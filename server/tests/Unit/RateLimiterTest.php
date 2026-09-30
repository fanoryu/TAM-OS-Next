<?php
declare(strict_types=1);

use TamOs\Data\Auth\RateLimiter;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;

$state = static fn (int $failures, string $window, ?string $locked, string $now): array => [
    'failures' => $failures, 'windowStartedAt' => $window, 'lockedUntil' => $locked, 'now' => $now,
];
$T0 = '2026-01-01 00:00:00.000000';

return [
    'the account schedule: locks of 1, 2, 4, 8 then 15 minutes at 5, 10, 15, 20, 25 failures' => static function () use ($state, $T0): void {
        $expect = [5 => '00:01:00', 10 => '00:02:00', 15 => '00:04:00', 20 => '00:08:00', 25 => '00:15:00', 30 => '00:15:00'];
        foreach ($expect as $failures => $lock) {
            $next = RateLimiter::afterFailure($state($failures - 1, $T0, null, $T0), 5);
            assertSame([$failures, '2026-01-01 ' . $lock . '.000000'], [$next['failures'], $next['lockedUntil']], $failures . ' failures');
        }
        $next = RateLimiter::afterFailure($state(3, $T0, null, $T0), 5);
        assertSame([4, null], [$next['failures'], $next['lockedUntil']], 'below threshold, no lock');
    },
    'the IP schedule uses the same backoff at multiples of 20' => static function () use ($state, $T0): void {
        assertSame(null, RateLimiter::afterFailure($state(18, $T0, null, $T0), 20)['lockedUntil']);
        assertSame('2026-01-01 00:01:00.000000', RateLimiter::afterFailure($state(19, $T0, null, $T0), 20)['lockedUntil']);
        assertSame('2026-01-01 00:02:00.000000', RateLimiter::afterFailure($state(39, $T0, null, $T0), 20)['lockedUntil']);
    },
    'a window older than 15 minutes resets when not locked; exactly 15 minutes is expired' => static function () use ($state): void {
        $now = '2026-01-01 00:15:00.000000';
        $reset = RateLimiter::afterFailure($state(4, '2026-01-01 00:00:00.000000', '2026-01-01 00:01:00.000000', $now), 5);
        assertSame([1, $now, null], [$reset['failures'], $reset['windowStartedAt'], $reset['lockedUntil']], 'boundary equality expires');
        $kept = RateLimiter::afterFailure($state(4, '2026-01-01 00:00:00.000001', null, $now), 5);
        assertSame([5, '2026-01-01 00:00:00.000001'], [$kept['failures'], $kept['windowStartedAt']], 'one microsecond inside the window');
    },
    'a window does not reset while a lock is in force, and a new lock never shortens one' => static function () use ($state): void {
        $now = '2026-01-01 00:20:00.000000';
        // Window started 20 minutes ago but the bucket is locked until 00:40: no reset, and the
        // 1-minute lock this failure earns (until 00:21) does not replace the longer one.
        $next = RateLimiter::afterFailure($state(4, '2026-01-01 00:00:00.000000', '2026-01-01 00:40:00.000000', $now), 5);
        assertSame([5, '2026-01-01 00:00:00.000000', '2026-01-01 00:40:00.000000'], [$next['failures'], $next['windowStartedAt'], $next['lockedUntil']]);
        $longer = RateLimiter::afterFailure($state(24, '2026-01-01 00:00:00.000000', '2026-01-01 00:30:00.000000', $now), 5);
        assertSame('2026-01-01 00:35:00.000000', $longer['lockedUntil'], 'a longer new lock does replace a shorter one');
    },
    'lockedFor: rounded-up seconds while locked, clamped 1..900, zero otherwise' => static function (): void {
        $now = '2026-01-01 00:00:00.000000';
        assertSame(0, RateLimiter::lockedFor(['lockedUntil' => null, 'now' => $now]));
        assertSame(0, RateLimiter::lockedFor(['lockedUntil' => $now, 'now' => $now]), 'equality is unlocked');
        assertSame(0, RateLimiter::lockedFor(['lockedUntil' => '2025-12-31 23:59:59.000000', 'now' => $now]));
        assertSame(1, RateLimiter::lockedFor(['lockedUntil' => '2026-01-01 00:00:00.000001', 'now' => $now]), 'ceil to 1');
        assertSame(60, RateLimiter::lockedFor(['lockedUntil' => '2026-01-01 00:01:00.000000', 'now' => $now]));
        assertSame(61, RateLimiter::lockedFor(['lockedUntil' => '2026-01-01 00:01:00.500000', 'now' => $now]));
        assertSame(900, RateLimiter::lockedFor(['lockedUntil' => '2026-01-02 00:00:00.000000', 'now' => $now]), 'clamped');
    },
    'a bad threshold is a programming error' => static function () use ($state, $T0): void {
        assertThrows(LogicException::class, static fn () => RateLimiter::afterFailure($state(0, $T0, null, $T0), 0));
    },
];
