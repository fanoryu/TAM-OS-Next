<?php
declare(strict_types=1);

namespace TamOs\Auth;

use TamOs\Config\Config;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\Auth\RateLimiter;
use TamOs\Identity\Role;

/**
 * The BF-3B account lifecycle: the ordering and the transaction boundaries of the two operator
 * commands (server/bin/account.php) and of activation. It owns no SQL — every statement is in
 * TamOs\Data\Auth — and it never takes an identity, a company or an email from a browser.
 *
 * Operator commands (CLI only, operator trust; SDR-0002 §2.4 bootstrap exception, D2 / D5):
 *
 *   createCeo           advisory lock → one transaction: refuse if any company or user exists
 *                       → company, pending CEO user, CEO membership, activation token,
 *                       ceo_bootstrap → commit → the raw token, once
 *   resetCredentials    advisory lock → one transaction: lock the account → refuse unless it
 *                       is an active CEO with exactly one active membership → password NULL,
 *                       revoke every session, revoke open tokens, new token, credential_reset
 *
 * resetCredentials on an account that has no password yet is how an expired bootstrap token
 * is replaced; there is no separate reissue command.
 *
 * Activation (POST /api/auth/activate), SDR-0002 §5, §10:
 *
 *   policy (no database) → IP gate → non-locking token + account read → failure: count +
 *   activation_fail → account-aware policy → hash the password (outside any transaction)
 *   → one transaction: lock user + membership rows, then the token row, re-check everything
 *   on the database clock → set the first password (compare-and-swap on NULL), consume the
 *   token, revoke the user's other tokens and every session → activation_ok
 *
 * Locks are always taken user row first, token row second — here and in resetCredentials —
 * so the CLI and the HTTP path cannot deadlock each other. A policy failure never consumes the
 * token. Activation never creates a session: the user then logs in.
 */
final class AccountLifecycle
{
    public const ACTIVATION_IP_THRESHOLD = 20;

    public function __construct(private readonly AuthData $data)
    {
    }

    public static function fromConfig(Config $config): self
    {
        return new self(AuthData::fromConfig($config));
    }

    /** @throws AccountRefused invalid_email | busy | already_bootstrapped */
    public function createCeo(string $email, string $requestId): IssuedActivation
    {
        $candidate = self::email($email);
        $token = SessionToken::generate();
        $hash = SessionToken::hash($token);
        return $this->underAccountLock(fn (): IssuedActivation => $this->data->atomically(function () use ($candidate, $token, $hash, $requestId): IssuedActivation {
            $accounts = $this->data->accounts();
            $state = $accounts->bootstrapState();
            if ($state['companies'] || $state['users']) {
                throw new AccountRefused(AccountRefused::ALREADY_BOOTSTRAPPED);
            }
            $companyId = self::newId();
            $userId = self::newId();
            $membershipId = self::newId();
            $accounts->createCompany($companyId);
            $accounts->createPendingUser($userId, $candidate);
            $accounts->createCeoMembership($membershipId, $userId, $companyId);
            $tokens = $this->data->tokens();
            $tokens->issue($hash, $userId);
            $this->data->events()->append('ceo_bootstrap', $userId, $membershipId, null, null, $requestId);
            return new IssuedActivation($userId, $token, $tokens->expiresAt($hash));
        }));
    }

    /** @throws AccountRefused invalid_email | busy | not_found | account_disabled | topology_invalid | not_ceo */
    public function resetCredentials(string $email, string $requestId): IssuedActivation
    {
        $candidate = self::email($email);
        $token = SessionToken::generate();
        $hash = SessionToken::hash($token);
        return $this->underAccountLock(fn (): IssuedActivation => $this->data->atomically(function () use ($candidate, $token, $hash, $requestId): IssuedActivation {
            $account = $this->data->accounts()->lockByEmail($candidate);
            if ($account === null) {
                throw new AccountRefused(AccountRefused::NOT_FOUND);
            }
            $refusal = self::resetRefusal($account);
            if ($refusal !== null) {
                throw new AccountRefused($refusal);
            }
            $userId = $account['user']['user_id'];
            $tokens = $this->data->tokens();
            $this->data->accounts()->clearPasswordHash($userId);
            $this->data->sessions()->revokeAllForUser($userId);
            $tokens->revokeOpenForUser($userId);
            $tokens->issue($hash, $userId);
            $this->data->events()->append('credential_reset', $userId, $account['memberships'][0]['membership_id'], null, null, $requestId);
            return new IssuedActivation($userId, $token, $tokens->expiresAt($hash));
        }));
    }

    public function activate(
        #[\SensitiveParameter] string $token,
        #[\SensitiveParameter] string $password,
        ?string $remoteAddr,
        string $requestId,
    ): ActivationResult {
        if (PasswordPolicy::check($password) !== null) {
            return ActivationResult::invalidPassword();
        }
        $bucket = LoginKeys::activationIpBucket($remoteAddr);
        $limits = $this->data->rateLimits();
        // The IP row exists before any transaction (autocommit), as for login.
        $limits->ensure($bucket);
        $gate = $limits->peek($bucket);
        $wait = $gate === null ? 0 : RateLimiter::lockedFor($gate);
        if ($wait > 0) {
            return ActivationResult::locked($wait);
        }

        // Fast path: an unknown or dead token costs no password hashing.
        $hash = SessionToken::isWellFormed($token) ? SessionToken::hash($token) : null;
        $peek = $hash === null ? null : $this->data->tokens()->peek($hash);
        $account = $peek !== null && $peek['live'] ? $this->data->accounts()->findById($peek['userId']) : null;
        if ($hash === null || $peek === null || $account === null || !self::isActivatable($account)) {
            $userId = $peek['userId'] ?? null;
            return $this->data->atomically(fn (): ActivationResult => $this->activationFailure($bucket, $userId, $remoteAddr, $requestId));
        }
        if (PasswordPolicy::checkForAccount($password, $account['email']) !== null) {
            return ActivationResult::invalidPassword();
        }
        $newHash = Passwords::hash($password);
        $userId = $peek['userId'];

        return $this->data->atomically(function () use ($hash, $userId, $password, $newHash, $bucket, $remoteAddr, $requestId): ActivationResult {
            $locked = $this->data->accounts()->lockById($userId);
            $tokens = $this->data->tokens();
            if ($locked === null || !self::isActivatable($locked) || !$tokens->lockLive($hash, $userId)) {
                return $this->activationFailure($bucket, $userId, $remoteAddr, $requestId);
            }
            if (PasswordPolicy::checkForAccount($password, $locked['email']) !== null) {
                return ActivationResult::invalidPassword();
            }
            // Both are guaranteed by the locked re-check; anything else rolls everything back.
            if (!$this->data->accounts()->setInitialPasswordHash($userId, $newHash)) {
                throw new \LogicException('activation: account already has a password');
            }
            if ($tokens->consume($hash) !== 1) {
                throw new \LogicException('activation: token no longer live');
            }
            $tokens->revokeOpenForUser($userId);
            $this->data->sessions()->revokeAllForUser($userId);
            $this->data->events()->append('activation_ok', $userId, $locked['memberships'][0]['membership_id'], null, $remoteAddr, $requestId);
            return ActivationResult::success();
        });
    }

    /**
     * Why an operator reset of this account is refused, or null. BF-3B knows exactly one kind
     * of account — the bootstrap CEO — so anything else is unexpected and fails closed. A reset
     * never re-enables anything.
     *
     * @param array{user: array{user_status: string}, memberships: list<array{membership_status: string, role: string}>} $account
     */
    public static function resetRefusal(array $account): ?string
    {
        if ($account['user']['user_status'] !== 'active') {
            return AccountRefused::ACCOUNT_DISABLED;
        }
        if (count($account['memberships']) !== 1) {
            return AccountRefused::TOPOLOGY_INVALID;
        }
        $membership = $account['memberships'][0];
        if ($membership['membership_status'] !== 'active') {
            return AccountRefused::ACCOUNT_DISABLED;
        }
        return $membership['role'] === Role::Ceo->value ? null : AccountRefused::NOT_CEO;
    }

    /**
     * An account a live token may activate: active, no password yet, exactly one active
     * membership with a known role.
     *
     * @param array{user: array{user_status: string, has_password: bool}, memberships: list<array{membership_status: string, role: string}>} $account
     */
    public static function isActivatable(array $account): bool
    {
        return $account['user']['user_status'] === 'active'
            && $account['user']['has_password'] === false
            && count($account['memberships']) === 1
            && $account['memberships'][0]['membership_status'] === 'active'
            && Role::tryFrom($account['memberships'][0]['role']) !== null;
    }

    /** Must run inside AuthData::atomically(): the failure count and its event commit together. */
    private function activationFailure(string $bucket, ?string $userId, ?string $remoteAddr, string $requestId): ActivationResult
    {
        $limits = $this->data->rateLimits();
        $limits->recordFailure($bucket, $limits->lock($bucket), self::ACTIVATION_IP_THRESHOLD);
        $this->data->events()->append('activation_fail', $userId, null, null, $remoteAddr, $requestId);
        return ActivationResult::invalidToken();
    }

    /**
     * @param \Closure(): IssuedActivation $fn
     * @throws AccountRefused busy
     */
    private function underAccountLock(\Closure $fn): IssuedActivation
    {
        if (!$this->data->acquireAccountLock()) {
            throw new AccountRefused(AccountRefused::BUSY);
        }
        try {
            return $fn();
        } finally {
            $this->data->releaseAccountLock();
        }
    }

    private static function email(string $email): string
    {
        $candidate = EmailAddress::candidate($email);
        if (!EmailAddress::isValid($candidate)) {
            throw new AccountRefused(AccountRefused::INVALID_EMAIL);
        }
        return $candidate;
    }

    private static function newId(): string
    {
        return bin2hex(random_bytes(16));
    }
}
