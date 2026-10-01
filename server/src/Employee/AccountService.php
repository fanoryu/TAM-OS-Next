<?php
declare(strict_types=1);

namespace TamOs\Employee;

use TamOs\Auth\LoginKeys;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\Auth\MailOutboxStore;
use TamOs\Data\BusinessData;
use TamOs\Data\DatabaseError;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Policy;
use TamOs\Policy\Scope;

/**
 * Employee account administration (BF-4a2, SDR-0004): the ordering and the transaction
 * boundaries of the four account.manage operations. It owns no SQL — the Employee record and its
 * bound login are read through EmployeeStore under the principal's scope, account rows are
 * written by AccountStore, tokens by AccountTokenStore, mail intent by MailOutboxStore and the
 * audit row by AuditLog — and it never takes a company, user, role, actor or token from a browser:
 * the target is named only by Employee id.
 *
 * Every operation: validate → scoped load of the Employee (absent or out of scope: 404) →
 * Policy(account.manage, CEO-only: 403) → ONE transaction on the request's shared connection
 * (BusinessData and AuthData share it): lock the Employee row, then the bound membership and
 * user rows (then tokens), refuse a login whose role is not `employee` (409) — so a CEO
 * membership bound to an Employee record is never administered here — then change state and
 * append the account.manage audit row naming the operation. Any failure rolls everything back.
 *
 *   provision  not archived, no login bound, email free → pending user (active, no password),
 *              active employee membership in the session's company, activation mail INTENT in
 *              the outbox. No token: the outbox worker issues it at send time (SDR-0004 §4).
 *   reissue    pending only, at most REISSUE_LIMIT per target user per hour (429) → revoke every
 *              open token of the user → queue activation intent (a still-open row is reused)
 *   disable    membership active → membership disabled, every session and open token revoked;
 *              users.status, employment status and the outbox are not touched (the worker
 *              cancels a queued activation mail that no longer qualifies)
 *   enable     not archived, membership disabled → membership active; nothing else, no mail
 */
final class AccountService
{
    public const REISSUE_LIMIT = 3;
    public const REISSUE_WINDOW_SECONDS = 3600;
    private const DUPLICATE_KEY = 1062;

    public function __construct(private readonly BusinessData $data, private readonly AuthData $auth)
    {
    }

    /**
     * @param array<string, mixed> $json
     * @return array<string, mixed> the profile row after provisioning (CEO read)
     */
    public function provision(Principal $actor, array $json, string $requestId): array
    {
        $in = EmployeeInput::provision($json);
        $auth = $this->authorized($actor, $in['id']);
        try {
            $this->data->atomically(function () use ($auth, $actor, $in, $requestId): void {
                $this->lockedLive($auth);
                if ($this->data->employees()->account($auth, true) !== null) {
                    throw new ApiError(ErrorCode::Conflict, logReason: 'account_exists');
                }
                $accounts = $this->auth->accounts();
                if ($accounts->lockByEmail($in['email']) !== null) {
                    throw new ApiError(ErrorCode::Conflict, logReason: 'email_unavailable');
                }
                $userId = self::newId();
                $accounts->createPendingUser($userId, $in['email']);
                $accounts->createEmployeeMembership(self::newId(), $userId, $auth->scope->companyId, $in['id']);
                if (!$this->auth->outbox()->enqueueOnce($userId, MailOutboxStore::ACTIVATION, $requestId)) {
                    throw new \LogicException('a new account already had activation mail queued');
                }
                $this->data->audit()->appendAccount($auth, $actor, 'provision', $userId, $requestId);
            });
        } catch (DatabaseError $e) {
            // A concurrent provisioning won the email, the user or the Employee binding (UNIQUE).
            if ($e->driverCode === self::DUPLICATE_KEY) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'account_conflict');
            }
            throw $e;
        }
        return $this->profile($auth, $in['id']);
    }

    /**
     * @param array<string, mixed> $json
     * @return array<string, mixed>
     */
    public function reissue(Principal $actor, array $json, string $requestId): array
    {
        $id = EmployeeInput::accountTarget($json);
        $auth = $this->authorized($actor, $id);
        // The quota row exists before the transaction (autocommit), as for login and recovery.
        $known = $this->data->employees()->account($auth, false);
        if ($known !== null) {
            $this->auth->rateLimits()->ensure(LoginKeys::activationReissueBucket($known['userId']));
        }
        $this->data->atomically(function () use ($auth, $actor, $requestId): void {
            $this->lockedLive($auth);
            $account = $this->employeeAccount($auth);
            if (AccountState::of($account) !== AccountState::PENDING) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'account_not_pending');
            }
            $limits = $this->auth->rateLimits();
            $bucket = LoginKeys::activationReissueBucket($account['userId']);
            $wait = $limits->consumeQuota($bucket, $limits->lock($bucket), self::REISSUE_LIMIT, self::REISSUE_WINDOW_SECONDS);
            if ($wait > 0) {
                throw new ApiError(ErrorCode::RateLimited, retryAfter: $wait, logReason: 'reissue_locked');
            }
            $this->auth->tokens()->revokeAllOpenForUser($account['userId']);
            $this->auth->outbox()->enqueueOnce($account['userId'], MailOutboxStore::ACTIVATION, $requestId);
            $this->data->audit()->appendAccount($auth, $actor, 'reissue', $account['userId'], $requestId);
        });
        return $this->profile($auth, $id);
    }

    /**
     * @param array<string, mixed> $json
     * @return array<string, mixed>
     */
    public function disable(Principal $actor, array $json, string $requestId): array
    {
        $id = EmployeeInput::accountTarget($json);
        $auth = $this->authorized($actor, $id);
        $this->data->atomically(function () use ($auth, $actor, $requestId): void {
            $this->locked($auth);
            $account = $this->employeeAccount($auth);
            if ($account['membershipStatus'] !== 'active') {
                throw new ApiError(ErrorCode::Conflict, logReason: 'account_not_active');
            }
            if ($this->auth->accounts()->setEmployeeMembershipStatus($account['membershipId'], $auth->scope->companyId, 'active', 'disabled') !== 1) {
                throw new \LogicException('disable: the locked membership did not change');
            }
            $this->auth->sessions()->revokeAllForUser($account['userId']);
            $this->auth->tokens()->revokeAllOpenForUser($account['userId']);
            $this->data->audit()->appendAccount($auth, $actor, 'disable', $account['userId'], $requestId);
        });
        return $this->profile($auth, $id);
    }

    /**
     * @param array<string, mixed> $json
     * @return array<string, mixed>
     */
    public function enable(Principal $actor, array $json, string $requestId): array
    {
        $id = EmployeeInput::accountTarget($json);
        $auth = $this->authorized($actor, $id);
        $this->data->atomically(function () use ($auth, $actor, $requestId): void {
            $this->lockedLive($auth);
            $account = $this->employeeAccount($auth);
            if ($account['membershipStatus'] !== 'disabled') {
                throw new ApiError(ErrorCode::Conflict, logReason: 'account_not_disabled');
            }
            if ($this->auth->accounts()->setEmployeeMembershipStatus($account['membershipId'], $auth->scope->companyId, 'disabled', 'active') !== 1) {
                throw new \LogicException('enable: the locked membership did not change');
            }
            $this->data->audit()->appendAccount($auth, $actor, 'enable', $account['userId'], $requestId);
        });
        return $this->profile($auth, $id);
    }

    /** The record loaded under the principal's scope (404 when absent or out of scope), then Policy (403). */
    private function authorized(Principal $actor, string $id): Authorization
    {
        $record = $this->data->employees()->find(Scope::of($actor), $id) ?? throw new ApiError(ErrorCode::NotFound);
        return Policy::authorize($actor, Action::AccountManage, $record);
    }

    /**
     * Locks the Employee row (first in the lock order).
     *
     * @return array<string, mixed>
     */
    private function locked(Authorization $auth): array
    {
        return $this->data->employees()->lockProfile($auth) ?? throw new ApiError(ErrorCode::NotFound);
    }

    /** Locks the Employee row and refuses an archived record (409). */
    private function lockedLive(Authorization $auth): void
    {
        if (($this->locked($auth)['archived_at'] ?? null) !== null) {
            throw new ApiError(ErrorCode::Conflict, logReason: 'employee_archived');
        }
    }

    /**
     * The login bound to the record, locked: none is 409, and so is one whose role is not
     * `employee` — a CEO membership is never administered by these routes (SDR-0004 §3.9).
     *
     * @return array{membershipId: string, userId: string, role: string, membershipStatus: string, userStatus: string, hasPassword: bool}
     */
    private function employeeAccount(Authorization $auth): array
    {
        $account = $this->data->employees()->account($auth, true) ?? throw new ApiError(ErrorCode::Conflict, logReason: 'account_absent');
        if ($account['role'] !== 'employee') {
            throw new ApiError(ErrorCode::Conflict, logReason: 'account_not_employee');
        }
        return $account;
    }

    /** @return array<string, mixed> */
    private function profile(Authorization $auth, string $id): array
    {
        return $this->data->employees()->profile($auth->scope, $id) ?? throw new \LogicException('administered employee not readable');
    }

    private static function newId(): string
    {
        return bin2hex(random_bytes(16));
    }
}
