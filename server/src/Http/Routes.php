<?php
declare(strict_types=1);

namespace TamOs\Http;

use TamOs\Controller\AuthController;
use TamOs\Controller\HealthController;
use TamOs\Controller\ReadyController;
use TamOs\Data\Readiness;

/**
 * The production route table: liveness (never touches the database), readiness (read-only
 * database and schema check), the BF-3A session endpoints and the BF-3B self-service account
 * lifecycle. Only logout, me, change-password and logout-all resolve a session; health, ready,
 * login and activate are RouteAuth::None whatever cookie is sent.
 */
final class Routes
{
    /** @return list<Route> */
    public static function production(Readiness $readiness, AuthController $auth): array
    {
        return [
            new Route('GET', '/api/health', HealthController::handle(...)),
            new Route('GET', '/api/ready', (new ReadyController($readiness))->handle(...)),
            new Route('POST', '/api/auth/login', $auth->login(...)),
            new Route('POST', '/api/auth/logout', $auth->logout(...), [], RouteAuth::Optional),
            new Route('GET', '/api/auth/me', $auth->me(...), [], RouteAuth::Required),
            // BF-3B: activation is not session-bound (origin check and rate limiting instead);
            // the other two act only on the caller's own account.
            new Route('POST', '/api/auth/activate', $auth->activate(...)),
            new Route('POST', '/api/auth/change-password', $auth->changePassword(...), [], RouteAuth::Required),
            new Route('POST', '/api/auth/logout-all', $auth->logoutAll(...), [], RouteAuth::Required),
        ];
    }
}
