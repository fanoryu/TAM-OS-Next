<?php
declare(strict_types=1);

namespace TamOs\Http;

use TamOs\Controller\HealthController;
use TamOs\Controller\ReadyController;
use TamOs\Data\Readiness;

/**
 * The production route table: liveness (never touches the database) and readiness
 * (read-only database and schema check).
 */
final class Routes
{
    /** @return list<Route> */
    public static function production(Readiness $readiness): array
    {
        return [
            new Route('GET', '/api/health', HealthController::handle(...)),
            new Route('GET', '/api/ready', (new ReadyController($readiness))->handle(...)),
        ];
    }
}
