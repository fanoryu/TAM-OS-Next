<?php
declare(strict_types=1);

namespace TamOs\Http;

use TamOs\Controller\HealthController;

/** The production route table. BF-1 exposes exactly one route. */
final class Routes
{
    /** @return list<Route> */
    public static function production(): array
    {
        return [
            new Route('GET', '/api/health', HealthController::handle(...)),
        ];
    }
}
