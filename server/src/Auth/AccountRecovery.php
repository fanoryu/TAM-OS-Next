<?php
declare(strict_types=1);

namespace TamOs\Auth;

use TamOs\Data\Auth\AccountTokenStore;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\Auth\MailOutboxStore;
use TamOs\Data\Auth\RateLimiter;
use TamOs\Identity\Role;

/**
 * Self-service password recovery (BF-3D, SDR-0002 §5): the ordering and the transaction
 * boundaries of the two public endpoints. It owns no SQL and never takes an identity from a
 * browser. No provider I/O happens here — the recovery request only records delivery intent in
 * the outbox; the mail worker (TamOs\Mail\OutboxWorker) issues the token and sends the mail.
 *
 * Request (POST /api/auth/forgot-password):
 *
 *   IP rows ensured (autocommit) → one transaction: lock the IP bucket, admit within 10
 *   requests per hour or answer 429 → lock the address bucket, count the request (3 per hour,
 *   the same for every address, known or not) → look the account up → recoverable and under
 *   quota: queue delivery intent (at most one open per user) → recovery_req (user id when known,
 *   else the email hash) → the same generic answer for every address
 *
 * Reset (POST /api/auth/reset-password) mirrors activation:
 *
 *   policy (no database) → IP gate (reset-ip, 20 failures / 15 minutes) → non-locking
 *   recovery-token + account read (a dead token costs no hashing) → failure: count +
 *   recovery_fail → account-aware policy → hash outside any transaction → one transaction:
 *   lock user + membership rows, then the token row, re-check on the database clock →
 *   compare-and-swap the password on the locked hash, consume the token, revoke every open
 *   token of every purpose and every session → recovery_ok
 *
 * Reset issues no session and sets no cookie: the user logs in with the new password.
 *
 * Only an account that could log in today can recover — active user, a password already set,
 * exactly one active membership with a known role. A pending account uses the operator reset,
 * so recovery never becomes a second, unaudited activation path; a disabled account never
 * recovers (recovery re-enables nothing). Both are refused silently.
 */
final class AccountRecovery
{
    public const REQUEST_ACCOUNT_LIMIT = 3;
    public const REQUEST_IP_LIMIT = 10;
    public const REQUEST_WINDOW_SECONDS = 3600;
    public const RESET_IP_THRESHOLD = 20;

    public function __construct(private readonly AuthData $data)
    {
    }

    public function request(string $email, ?string $remoteAddr, string $requestId): RecoveryResult
    {
        $candidate = EmailAddress::candidate($email);
        $valid = EmailAddress::isValid($candidate);
        $ipBucket = LoginKeys::recoveryIpBucket($remoteAddr);
        $accountBucket = LoginKeys::recoveryAccountBucket($candidate);
        $limits = $this->data->rateLimits();
        // The rows exist before the transaction (autocommit), as for login: no gap inserts inside it.
        $limits->ensure($ipBucket);
        $limits->ensure($accountBucket);

        return $this->data->atomically(function () use ($candidate, $valid, $ipBucket, $accountBucket, $remoteAddr, $requestId): RecoveryResult {
            $limits = $this->data->rateLimits();
            $wait = $limits->consumeQuota($ipBucket, $limits->lock($ipBucket), self::REQUEST_IP_LIMIT, self::REQUEST_WINDOW_SECONDS);
            if ($wait > 0) {
                return RecoveryResult::locked($wait);
            }
            $admitted = $limits->consumeQuota($accountBucket, $limits->lock($accountBucket), self::REQUEST_ACCOUNT_LIMIT, self::REQUEST_WINDOW_SECONDS) === 0;
            $account = $valid ? $this->data->accounts()->findForLogin($candidate) : null;
            $userId = $account !== null && self::isRecoverable($account) ? $account['user']['user_id'] : null;
            if ($userId !== null && $admitted) {
                $this->data->outbox()->enqueueOnce($userId, MailOutboxStore::RECOVERY, $requestId);
            }
            $this->data->events()->append('recovery_req', $userId, null, $userId === null ? LoginKeys::emailHash($candidate) : null, $remoteAddr, $requestId);
            return RecoveryResult::requested();
        });
    }

    public function reset(
        #[\SensitiveParameter] string $token,
        #[\SensitiveParameter] string $password,
        ?string $remoteAddr,
        string $requestId,
    ): RecoveryResult {
        if (PasswordPolicy::check($password) !== null) {
            return RecoveryResult::invalidPassword();
        }
        $bucket = LoginKeys::resetIpBucket($remoteAddr);
        $limits = $this->data->rateLimits();
        $limits->ensure($bucket);
        $gate = $limits->peek($bucket);
        $wait = $gate === null ? 0 : RateLimiter::lockedFor($gate);
        if ($wait > 0) {
            return RecoveryResult::locked($wait);
        }

        // Fast path: an unknown or dead token costs no password hashing.
        $hash = SessionToken::isWellFormed($token) ? SessionToken::hash($token) : null;
        $peek = $hash === null ? null : $this->data->tokens()->peek($hash, AccountTokenStore::RECOVERY);
        $account = $peek !== null && $peek['live'] ? $this->data->accounts()->findById($peek['userId']) : null;
        if ($hash === null || $peek === null || $account === null || !self::isRecoverable($account)) {
            $userId = $peek['userId'] ?? null;
            return $this->data->atomically(fn (): RecoveryResult => $this->resetFailure($bucket, $userId, $remoteAddr, $requestId));
        }
        if (PasswordPolicy::checkForAccount($password, $account['email']) !== null) {
            return RecoveryResult::invalidPassword();
        }
        $newHash = Passwords::hash($password);
        $userId = $peek['userId'];

        return $this->data->atomically(function () use ($hash, $userId, $password, $newHash, $bucket, $remoteAddr, $requestId): RecoveryResult {
            $locked = $this->data->accounts()->lockById($userId);
            $tokens = $this->data->tokens();
            if ($locked === null || !self::isRecoverable($locked) || !$tokens->lockLive($hash, $userId, AccountTokenStore::RECOVERY)) {
                return $this->resetFailure($bucket, $userId, $remoteAddr, $requestId);
            }
            if (PasswordPolicy::checkForAccount($password, $locked['email']) !== null) {
                return RecoveryResult::invalidPassword();
            }
            // Both are guaranteed by the locked re-check; anything else rolls everything back.
            if ($locked['passwordHash'] === null || !$this->data->accounts()->replacePasswordHash($userId, $locked['passwordHash'], $newHash)) {
                throw new \LogicException('recovery: the locked password changed');
            }
            if ($tokens->consume($hash, AccountTokenStore::RECOVERY) !== 1) {
                throw new \LogicException('recovery: token no longer live');
            }
            $tokens->revokeAllOpenForUser($userId);
            $this->data->sessions()->revokeAllForUser($userId);
            $this->data->events()->append('recovery_ok', $userId, $locked['memberships'][0]['membership_id'], null, $remoteAddr, $requestId);
            return RecoveryResult::success();
        });
    }

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

    /** Must run inside AuthData::atomically(): the failure count and its event commit together. */
    private function resetFailure(string $bucket, ?string $userId, ?string $remoteAddr, string $requestId): RecoveryResult
    {
        $limits = $this->data->rateLimits();
        $limits->recordFailure($bucket, $limits->lock($bucket), self::RESET_IP_THRESHOLD);
        $this->data->events()->append('recovery_fail', $userId, null, null, $remoteAddr, $requestId);
        return RecoveryResult::invalidToken();
    }
}
