<?php
declare(strict_types=1);

namespace TamOs\Controller;

use TamOs\Auth\AccountLifecycle;
use TamOs\Auth\AccountRecovery;
use TamOs\Auth\ActivationResult;
use TamOs\Auth\Authenticator;
use TamOs\Auth\LoginResult;
use TamOs\Auth\PasswordChangeResult;
use TamOs\Auth\RecoveryResult;
use TamOs\Http\ApiError;
use TamOs\Http\CookieResult;
use TamOs\Http\ErrorCode;
use TamOs\Http\Request;
use TamOs\Http\SessionCookie;
use TamOs\Identity\AuthSession;

/**
 * POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me (BF-3A), the BF-3B
 * self-service lifecycle: POST /api/auth/activate, POST /api/auth/change-password,
 * POST /api/auth/logout-all, and BF-3D recovery: POST /api/auth/forgot-password,
 * POST /api/auth/reset-password.
 *
 * The client projection is userId, membershipId, role, employeeId and csrfToken — never
 * companyId, an email, a status, the session token or any hash. The session token travels
 * only in the HttpOnly cookie. Every credential, account or membership failure is the same
 * 401 unauthenticated; a throttled attempt is 429 rate_limited with Retry-After. Every
 * activation-token or account failure is the same 400 naming the field "token".
 */
final class AuthController
{
    public function __construct(
        private readonly Authenticator $authenticator,
        private readonly AccountLifecycle $lifecycle,
        private readonly AccountRecovery $recovery,
    ) {
    }

    /**
     * BF-3D: asks for a password-recovery mail. The answer is the same 200 for every address —
     * known, unknown, disabled, pending or over its hourly quota — so it reveals nothing about
     * which accounts exist; only the client IP's own throttle answers 429. No mail is sent here:
     * the request records delivery intent and the cron worker sends it.
     *
     * @param array<string, mixed> $json
     * @return array{requested: true}
     */
    public function forgotPassword(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        if (array_keys($json) !== ['email'] || !is_string($json['email'])) {
            throw new ApiError(ErrorCode::ValidationFailed, 'forgot-password body shape', fields: ['email']);
        }
        $result = $this->recovery->request($json['email'], $request->remoteAddr, $requestId);
        if ($result->outcome === RecoveryResult::LOCKED) {
            throw new ApiError(ErrorCode::RateLimited, retryAfter: $result->retryAfter, logReason: 'recovery_locked');
        }
        return ['requested' => true];
    }

    /**
     * BF-3D: sets a new password from a one-time recovery token. Every session of the user ends;
     * no session is created and no cookie is set: the user logs in afterwards. Every token or
     * account failure is the same 400 naming the field "token".
     *
     * @param array<string, mixed> $json
     * @return array{reset: true}
     */
    public function resetPassword(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        $keys = array_keys($json);
        sort($keys);
        if ($keys !== ['password', 'token'] || !is_string($json['token']) || !is_string($json['password'])) {
            throw new ApiError(ErrorCode::ValidationFailed, 'reset-password body shape', fields: ['token', 'password']);
        }
        $result = $this->recovery->reset($json['token'], $json['password'], $request->remoteAddr, $requestId);
        return match ($result->outcome) {
            RecoveryResult::SUCCESS => ['reset' => true],
            RecoveryResult::LOCKED => throw new ApiError(ErrorCode::RateLimited, retryAfter: $result->retryAfter, logReason: 'reset_locked'),
            RecoveryResult::INVALID_PASSWORD => throw new ApiError(ErrorCode::ValidationFailed, fields: ['password'], logReason: 'password_policy'),
            default => throw new ApiError(ErrorCode::ValidationFailed, fields: ['token'], logReason: 'reset_rejected'),
        };
    }

    /** @param array<string, mixed> $json */
    public function login(Request $request, ?AuthSession $session, array $json, string $requestId): CookieResult
    {
        $keys = array_keys($json);
        sort($keys);
        if ($keys !== ['email', 'password'] || !is_string($json['email']) || !is_string($json['password'])) {
            throw new ApiError(ErrorCode::ValidationFailed, 'login body shape', fields: ['email', 'password']);
        }
        $result = $this->authenticator->login($json['email'], $json['password'], $request->sessionToken, $request->remoteAddr, $requestId);
        if ($result->outcome === LoginResult::LOCKED) {
            throw new ApiError(ErrorCode::RateLimited, retryAfter: $result->retryAfter, logReason: 'login_locked');
        }
        if ($result->outcome !== LoginResult::SUCCESS || $result->principal === null || $result->sessionToken === null || $result->csrfToken === null) {
            throw new ApiError(ErrorCode::Unauthenticated, logReason: 'login_rejected');
        }
        return new CookieResult(
            $result->principal->projection() + ['csrfToken' => $result->csrfToken],
            SessionCookie::set($result->sessionToken),
        );
    }

    /**
     * Idempotent. With a valid session (whose CSRF token the kernel has already checked) the
     * session is revoked and the logout recorded; without one nothing is written. Either way
     * the answer is the same and the cookie is cleared.
     *
     * @param array<string, mixed> $json
     */
    public function logout(Request $request, ?AuthSession $session, array $json, string $requestId): CookieResult
    {
        if ($json !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'logout body must be {}');
        }
        if ($session !== null) {
            $this->authenticator->logout($session, (string) $request->sessionToken, $request->remoteAddr, $requestId);
        }
        return new CookieResult(['loggedOut' => true], SessionCookie::clear());
    }

    /**
     * @param array<string, mixed> $json
     * @return array{userId: string, membershipId: string, role: string, employeeId: ?string, csrfToken: string}
     */
    public function me(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        if ($session === null) {
            throw new ApiError(ErrorCode::Unauthenticated);
        }
        return $session->principal->projection() + ['csrfToken' => $session->csrfToken];
    }

    /**
     * Sets the first password of a pending account from a one-time activation token. Never
     * resolves a session and never sets one: the user logs in afterwards.
     *
     * @param array<string, mixed> $json
     * @return array{activated: true}
     */
    public function activate(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        $keys = array_keys($json);
        sort($keys);
        if ($keys !== ['password', 'token'] || !is_string($json['token']) || !is_string($json['password'])) {
            throw new ApiError(ErrorCode::ValidationFailed, 'activate body shape', fields: ['token', 'password']);
        }
        $result = $this->lifecycle->activate($json['token'], $json['password'], $request->remoteAddr, $requestId);
        return match ($result->outcome) {
            ActivationResult::SUCCESS => ['activated' => true],
            ActivationResult::LOCKED => throw new ApiError(ErrorCode::RateLimited, retryAfter: $result->retryAfter, logReason: 'activation_locked'),
            ActivationResult::INVALID_PASSWORD => throw new ApiError(ErrorCode::ValidationFailed, fields: ['password'], logReason: 'password_policy'),
            default => throw new ApiError(ErrorCode::ValidationFailed, fields: ['token'], logReason: 'activation_rejected'),
        };
    }

    /**
     * Changes the caller's password. On success every session of the user is revoked and the
     * caller continues on a fresh one: new cookie, new CSRF token.
     *
     * @param array<string, mixed> $json
     */
    public function changePassword(Request $request, ?AuthSession $session, array $json, string $requestId): CookieResult
    {
        if ($session === null) {
            throw new ApiError(ErrorCode::Unauthenticated);
        }
        $keys = array_keys($json);
        sort($keys);
        if ($keys !== ['currentPassword', 'newPassword'] || !is_string($json['currentPassword']) || !is_string($json['newPassword'])) {
            throw new ApiError(ErrorCode::ValidationFailed, 'change-password body shape', fields: ['currentPassword', 'newPassword']);
        }
        $result = $this->authenticator->changePassword($session, $json['currentPassword'], $json['newPassword'], $request->remoteAddr, $requestId);
        if ($result->outcome === PasswordChangeResult::SUCCESS && $result->principal !== null && $result->sessionToken !== null && $result->csrfToken !== null) {
            return new CookieResult(
                $result->principal->projection() + ['csrfToken' => $result->csrfToken],
                SessionCookie::set($result->sessionToken),
            );
        }
        throw match ($result->outcome) {
            PasswordChangeResult::INVALID_NEW => new ApiError(ErrorCode::ValidationFailed, fields: ['newPassword'], logReason: 'password_policy'),
            PasswordChangeResult::WRONG_CURRENT => new ApiError(ErrorCode::ValidationFailed, fields: ['currentPassword'], logReason: 'password_rejected'),
            PasswordChangeResult::LOCKED => new ApiError(ErrorCode::RateLimited, retryAfter: $result->retryAfter, logReason: 'password_locked'),
            PasswordChangeResult::CONFLICT => new ApiError(ErrorCode::Conflict, logReason: 'password_conflict'),
            default => new ApiError(ErrorCode::Unauthenticated, logReason: 'password_session'),
        };
    }

    /**
     * Ends every session of the caller's user, this one included, and clears the cookie.
     *
     * @param array<string, mixed> $json
     */
    public function logoutAll(Request $request, ?AuthSession $session, array $json, string $requestId): CookieResult
    {
        if ($session === null) {
            throw new ApiError(ErrorCode::Unauthenticated);
        }
        if ($json !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'logout-all body must be {}');
        }
        $this->authenticator->logoutAll($session, $request->remoteAddr, $requestId);
        return new CookieResult(['loggedOut' => true], SessionCookie::clear());
    }
}
