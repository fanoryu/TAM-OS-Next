<?php
declare(strict_types=1);

/*
 * BF-3D pure rules, without a database: the per-window request quota (recovery requests), the
 * domain-separated recovery buckets, and who may recover. The login failure/backoff transition
 * is unchanged (tests/Unit/RateLimiterTest.php).
 */

use TamOs\Auth\AccountRecovery;
use TamOs\Auth\LoginKeys;
use TamOs\Data\Auth\RateLimiter;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$state = static fn (int $count, string $start, string $now): array => ['failures' => $count, 'windowStartedAt' => $start, 'lockedUntil' => null, 'now' => $now];
$account = static fn (array $user = [], array $membership = []): array => [
    'user' => $user + ['user_id' => str_repeat('1', 32), 'user_status' => 'active', 'has_password' => true],
    'memberships' => [$membership + ['membership_id' => str_repeat('2', 32), 'company_id' => str_repeat('3', 32), 'role' => 'ceo', 'employee_id' => null, 'membership_status' => 'active']],
];

return [
    'quota: at most N requests per window; the refused one is not counted; a new window starts fresh' => static function () use ($state): void {
        $t0 = '2026-10-01 10:00:00.000000';
        assertSame(['failures' => 1, 'windowStartedAt' => $t0, 'retryAfter' => 0], RateLimiter::afterRequest($state(0, $t0, $t0), 3, 3600), 'first');
        assertSame(['failures' => 3, 'windowStartedAt' => $t0, 'retryAfter' => 0], RateLimiter::afterRequest($state(2, $t0, '2026-10-01 10:10:00.000000'), 3, 3600), 'third');
        $refused = RateLimiter::afterRequest($state(3, $t0, '2026-10-01 10:59:00.000000'), 3, 3600);
        assertSame([3, 60], [$refused['failures'], $refused['retryAfter']], 'fourth refused until the window ends, not counted');
        assertSame(['failures' => 1, 'windowStartedAt' => '2026-10-01 11:00:00.000000', 'retryAfter' => 0],
            RateLimiter::afterRequest($state(3, $t0, '2026-10-01 11:00:00.000000'), 3, 3600), 'equality at the window end starts a new window');
        assertSame(1, RateLimiter::afterRequest($state(3, $t0, '2026-10-01 10:59:59.500000'), 3, 3600)['retryAfter'], 'rounded up, at least 1');
        assertThrows(\LogicException::class, static fn () => RateLimiter::afterRequest($state(0, $t0, $t0), 0, 3600));
        assertThrows(\LogicException::class, static fn () => RateLimiter::afterRequest($state(0, $t0, $t0), 3, 0));
    },
    'the recovery limits are the SDR-0002 §4 defaults' => static function (): void {
        assertSame([3, 10, 3600, 20], [AccountRecovery::REQUEST_ACCOUNT_LIMIT, AccountRecovery::REQUEST_IP_LIMIT, AccountRecovery::REQUEST_WINDOW_SECONDS, AccountRecovery::RESET_IP_THRESHOLD]);
    },
    'recovery buckets are domain-separated from login, activation and each other' => static function (): void {
        assertSame(hash('sha256', 'recover-acct:a@example.test'), LoginKeys::recoveryAccountBucket('a@example.test'));
        assertSame(hash('sha256', 'recover-ip:4:203.0.113.7'), LoginKeys::recoveryIpBucket('203.0.113.7'));
        assertSame(hash('sha256', 'reset-ip:4:203.0.113.7'), LoginKeys::resetIpBucket('203.0.113.7'));
        $all = [LoginKeys::accountBucket('a@example.test'), LoginKeys::recoveryAccountBucket('a@example.test'), LoginKeys::ipBucket('203.0.113.7'),
            LoginKeys::activationIpBucket('203.0.113.7'), LoginKeys::recoveryIpBucket('203.0.113.7'), LoginKeys::resetIpBucket('203.0.113.7')];
        assertSame(6, count(array_unique($all)), 'all distinct');
    },
    'only an account that could log in today can recover' => static function () use ($account): void {
        assertTrue(AccountRecovery::isRecoverable($account()), 'active CEO with a password');
        assertTrue(AccountRecovery::isRecoverable($account([], ['role' => 'employee', 'employee_id' => 'e1'])), 'active Employee with a password');
        foreach ([
            'pending (no password)' => $account(['has_password' => false]),
            'disabled user' => $account(['user_status' => 'disabled']),
            'disabled membership' => $account([], ['membership_status' => 'disabled']),
            'unknown role' => $account([], ['role' => 'admin']),
            'no membership' => ['user' => $account()['user'], 'memberships' => []],
            'two memberships' => ['user' => $account()['user'], 'memberships' => [$account()['memberships'][0], $account()['memberships'][0]]],
        ] as $label => $a) {
            assertSame(false, AccountRecovery::isRecoverable($a), $label);
        }
    },
];
