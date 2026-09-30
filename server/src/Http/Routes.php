<?php
declare(strict_types=1);

namespace TamOs\Http;

use TamOs\Controller\AuthController;
use TamOs\Controller\HealthController;
use TamOs\Controller\ReadyController;
use TamOs\Data\Readiness;

/**
 * The production route table: liveness (never touches the database), readiness (read-only
 * database and schema check) and the BF-3A session endpoints. Only the auth routes resolve a
 * session; health and ready are RouteAuth::None whatever cookie is sent.
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
        ];
    }
}
