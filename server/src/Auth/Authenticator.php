<?php
declare(strict_types=1);

namespace TamOs\Auth;

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Auth\RateLimiter;
use TamOs\Identity\AuthSession;
use TamOs\Identity\Principal;

/**
 * Login and logout: the ordering and the transaction boundaries. It owns no SQL — every
 * statement is in TamOs\Data\Auth — and it never trusts a browser-supplied identity.
 *
 * One login attempt is ONE transaction (SDR-0002 §2.3, §4, §9.2):
 *
 *   lock account bucket (held through verification) → read IP bucket → locked? login_locked
 *   → account lookup → exactly one password_verify → Principal (status, membership, role)
 *   → failure: account + IP failure counts and login_failure
 *   → success: revoke the presented session, new session, optional rehash, reset the
 *     account bucket, login_success
 *
 * so a failure's rate-limit updates and its security event commit together or not at all.
 * The IP bucket is locked only for its short final update, never across verification, so a
 * shared client IP never becomes a global login mutex. A database error rolls everything back
 * and surfaces as 503/500 — never as a credential failure.
 *
 * BF-3B adds the two other session-issuing / session-ending operations on the caller's own
 * account. A password change is:
 *
 *   policy → hash the new password (outside any transaction, no row locked) → one transaction:
 *   lock the user's password-change bucket (held through verification, so attempts serialize)
 *   → locked? 429 → consistent read of the account → Principal must still be the session's
 *   membership → exactly one password_verify of the current password → failure: count +
 *   password_fail → success: compare-and-swap on the verified hash (the users row is locked
 *   only from here to commit; a concurrent change means conflict and nothing is written) →
 *   revoke every session of the user and every open account token (BF-3D) → one new session
 *   for the caller → reset the bucket → password_change
 *
 * logoutAll revokes every session of the user, the caller's included, and records logout_all.
 */
final class Authenticator
{
    public const ACCOUNT_THRESHOLD = 5;
    public const IP_THRESHOLD = 20;
    public const PASSWORD_CHANGE_THRESHOLD = 5;

    public function __construct(private readonly AuthData $data)
    {
    }

    public function login(
        string $email,
        #[\SensitiveParameter] string $password,
        #[\SensitiveParameter] ?string $presentedToken,
        ?string $remoteAddr,
        string $requestId,
    ): LoginResult {
        $candidate = EmailAddress::candidate($email);
        $emailValid = EmailAddress::isValid($candidate);
        $accountBucket = LoginKeys::accountBucket($candidate);
        $ipBucket = LoginKeys::ipBucket($remoteAddr);
        $emailHash = LoginKeys::emailHash($candidate);
        // A client-sent token is never adopted: the new one is always generated here.
        $token = SessionToken::generate();
        $csrf = SessionToken::generateCsrf();
        $presentedHash = SessionToken::isWellFormed($presentedToken) ? SessionToken::hash((string) $presentedToken) : null;
        // The IP row exists before the transaction starts (autocommit), so the failure path
        // inside it only ever takes that row's record lock (see RateLimiter::ensure()).
        $this->data->rateLimits()->ensure($ipBucket);

        return $this->data->atomically(function () use (
            $candidate, $emailValid, $password, $accountBucket, $ipBucket, $emailHash, $token, $csrf, $presentedHash, $remoteAddr, $requestId,
        ): LoginResult {
            $limits = $this->data->rateLimits();
            $events = $this->data->events();

            $account = $limits->lock($accountBucket);
            $ip = $limits->peek($ipBucket);
            $wait = max(RateLimiter::lockedFor($account), $ip === null ? 0 : RateLimiter::lockedFor($ip));
            if ($wait > 0) {
                $events->append('login_locked', null, null, $emailHash, $remoteAddr, $requestId);
                return LoginResult::locked($wait);
            }

            $record = $emailValid ? $this->data->accounts()->findForLogin($candidate) : null;
            $hash = $record['passwordHash'] ?? null;
            $principal = Passwords::verify($password, $hash) && $record !== null
                ? Principal::fromAccount($record['user'], $record['memberships'])
                : null;

            if ($principal === null || $hash === null) {
                $limits->recordFailure($accountBucket, $account, self::ACCOUNT_THRESHOLD);
                $limits->recordFailure($ipBucket, $limits->lock($ipBucket), self::IP_THRESHOLD);
                $events->append('login_failure', $record['user']['user_id'] ?? null, null, $emailHash, $remoteAddr, $requestId);
                return LoginResult::failed();
            }

            $sessions = $this->data->sessions();
            if ($presentedHash !== null) {
                // Whoever's session this browser presented, it ends here (no fixation, no reuse).
                $sessions->revoke($presentedHash);
            }
            $sessions->create(SessionToken::hash($token), $principal->userId, $csrf);
            if (Passwords::needsRehash($hash)) {
                // Compare-and-swap; a concurrent change wins and the login still succeeds.
                $this->data->accounts()->replacePasswordHash($principal->userId, $hash, Passwords::hash($password));
            }
            $limits->reset($accountBucket);
            $events->append('login_success', $principal->userId, $principal->membershipId, null, $remoteAddr, $requestId);
            return LoginResult::success($principal, $token, $csrf);
        });
    }

    /** Revokes the session the request presented and records the logout, atomically. */
    public function logout(AuthSession $session, #[\SensitiveParameter] string $presentedToken, ?string $remoteAddr, string $requestId): void
    {
        if (!SessionToken::isWellFormed($presentedToken)) {
            throw new \LogicException('logout without the resolved session token');
        }
        $hash = SessionToken::hash($presentedToken);
        $this->data->atomically(function () use ($session, $hash, $remoteAddr, $requestId): void {
            $this->data->sessions()->revoke($hash);
            $this->data->events()->append('logout', $session->principal->userId, $session->principal->membershipId, null, $remoteAddr, $requestId);
        });
    }

    public function changePassword(
        AuthSession $session,
        #[\SensitiveParameter] string $currentPassword,
        #[\SensitiveParameter] string $newPassword,
        ?string $remoteAddr,
        string $requestId,
    ): PasswordChangeResult {
        if (PasswordPolicy::check($newPassword) !== null) {
            return PasswordChangeResult::failure(PasswordChangeResult::INVALID_NEW);
        }
        $userId = $session->principal->userId;
        $account = $this->data->accounts()->findById($userId);
        if ($account === null) {
            return PasswordChangeResult::failure(PasswordChangeResult::UNAUTHENTICATED);
        }
        // The email the rule compares against is the stored one, never a client value.
        if (PasswordPolicy::checkForAccount($newPassword, $account['email']) !== null) {
            return PasswordChangeResult::failure(PasswordChangeResult::INVALID_NEW);
        }
        $newHash = Passwords::hash($newPassword);
        $bucket = LoginKeys::passwordChangeBucket($userId);
        $token = SessionToken::generate();
        $csrf = SessionToken::generateCsrf();
        $this->data->rateLimits()->ensure($bucket);

        return $this->data->atomically(function () use ($session, $userId, $currentPassword, $newHash, $bucket, $token, $csrf, $remoteAddr, $requestId): PasswordChangeResult {
            $limits = $this->data->rateLimits();
            $state = $limits->lock($bucket);
            $wait = RateLimiter::lockedFor($state);
            if ($wait > 0) {
                return PasswordChangeResult::locked($wait);
            }
            $account = $this->data->accounts()->findById($userId);
            $principal = $account === null ? null : Principal::fromAccount($account['user'], $account['memberships']);
            if ($account === null || $principal === null || $principal->membershipId !== $session->principal->membershipId) {
                return PasswordChangeResult::failure(PasswordChangeResult::UNAUTHENTICATED);
            }
            $hash = $account['passwordHash'];
            if ($hash === null || !Passwords::verify($currentPassword, $hash)) {
                $limits->recordFailure($bucket, $state, self::PASSWORD_CHANGE_THRESHOLD);
                $this->data->events()->append('password_fail', $userId, $principal->membershipId, null, $remoteAddr, $requestId);
                return PasswordChangeResult::failure(PasswordChangeResult::WRONG_CURRENT);
            }
            if (!$this->data->accounts()->replacePasswordHash($userId, $hash, $newHash)) {
                // Changed concurrently (another change, a reset or a login rehash): nothing written.
                return PasswordChangeResult::failure(PasswordChangeResult::CONFLICT);
            }
            $sessions = $this->data->sessions();
            $sessions->revokeAllForUser($userId);
            // BF-3D: no recovery (or other account) link issued before the change survives it.
            $this->data->tokens()->revokeAllOpenForUser($userId);
            $sessions->create(SessionToken::hash($token), $userId, $csrf);
            $limits->reset($bucket);
            $this->data->events()->append('password_change', $userId, $principal->membershipId, null, $remoteAddr, $requestId);
            return PasswordChangeResult::success($principal, $token, $csrf);
        });
    }

    /** Revokes every session of the caller's user — the current one included — and records it. */
    public function logoutAll(AuthSession $session, ?string $remoteAddr, string $requestId): void
    {
        $this->data->atomically(function () use ($session, $remoteAddr, $requestId): void {
            $this->data->sessions()->revokeAllForUser($session->principal->userId);
            $this->data->events()->append('logout_all', $session->principal->userId, $session->principal->membershipId, null, $remoteAddr, $requestId);
        });
    }
}
