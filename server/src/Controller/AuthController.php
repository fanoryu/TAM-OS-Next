<?php
declare(strict_types=1);

namespace TamOs\Controller;

use TamOs\Auth\Authenticator;
use TamOs\Auth\LoginResult;
use TamOs\Http\ApiError;
use TamOs\Http\CookieResult;
use TamOs\Http\ErrorCode;
use TamOs\Http\Request;
use TamOs\Http\SessionCookie;
use TamOs\Identity\AuthSession;

/**
 * POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me.
 *
 * The client projection is userId, membershipId, role, employeeId and csrfToken — never
 * companyId, an email, a status, the session token or any hash. The session token travels
 * only in the HttpOnly cookie. Every credential, account or membership failure is the same
 * 401 unauthenticated; a throttled attempt is 429 rate_limited with Retry-After.
 */
final class AuthController
{
    public function __construct(private readonly Authenticator $authenticator)
    {
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
}
