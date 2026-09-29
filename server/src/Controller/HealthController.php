<?php
declare(strict_types=1);

namespace TamOs\Controller;

use TamOs\Http\Request;

/**
 * GET /api/health — liveness only. It answers without touching any database and reveals no
 * version, environment, host, path or runtime detail.
 */
final class HealthController
{
    /**
     * @param array<string, mixed> $json
     * @return array{status: string}
     */
    public static function handle(Request $request, ?object $principal, array $json): array
    {
        return ['status' => 'ok'];
    }
}
