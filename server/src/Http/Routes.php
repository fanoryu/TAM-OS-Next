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
 *
 * BF-3C: every mutation is either a business mutation that declares its server Action, or one of
 * the account self-service routes below, which act only on the caller's own credentials and are
 * governed by SDR-0002 §2–§5, not by the 20 ACTIONS. validate() refuses anything else, so the
 * table fails closed at bootstrap if a business mutation is added without an Action.
 */
final class Routes
{
    /** The only mutations without an Action. Never a business operation; never extended casually. */
    public const ACCOUNT_SELF_SERVICE = [
        'POST /api/auth/login',
        'POST /api/auth/logout',
        'POST /api/auth/activate',
        'POST /api/auth/change-password',
        'POST /api/auth/logout-all',
    ];

    /** @return list<Route> */
    public static function production(Readiness $readiness, AuthController $auth): array
    {
        return self::validate([
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
        ]);
    }

    /**
     * @param list<Route> $routes
     * @return list<Route>
     * @throws \LogicException when a mutation has no Action and is not account self-service, when
     *                         a self-service route claims an Action, or when a self-service
     *                         entry names no route
     */
    public static function validate(array $routes): array
    {
        $seen = [];
        foreach ($routes as $route) {
            $key = $route->method . ' ' . $route->path;
            $selfService = in_array($key, self::ACCOUNT_SELF_SERVICE, true);
            if ($selfService) {
                $seen[$key] = true;
                if ($route->action !== null) {
                    throw new \LogicException('account self-service is not a business action: ' . $key);
                }
            } elseif ($route->isMutation() && $route->action === null) {
                throw new \LogicException('a business mutation must declare its Action: ' . $key);
            }
        }
        if (count($seen) !== count(self::ACCOUNT_SELF_SERVICE)) {
            throw new \LogicException('every account self-service entry must name a route');
        }
        return $routes;
    }
}
