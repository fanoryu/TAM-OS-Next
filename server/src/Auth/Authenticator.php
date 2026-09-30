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
 */
final class Authenticator
{
    public const ACCOUNT_THRESHOLD = 5;
    public const IP_THRESHOLD = 20;

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
}
