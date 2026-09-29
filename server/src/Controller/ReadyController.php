<?php
declare(strict_types=1);

namespace TamOs\Controller;

use TamOs\Data\Readiness;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Http\Request;

/**
 * GET /api/ready — 200 {"status":"ready"} when the database is reachable and the schema is
 * current, otherwise 503 service_unavailable. The reason goes to the server log only.
 */
final class ReadyController
{
    public function __construct(private readonly Readiness $readiness)
    {
    }

    /**
     * @param array<string, mixed> $json
     * @return array{status: string}
     */
    public function handle(Request $request, ?object $principal, array $json): array
    {
        $reason = $this->readiness->check();
        if ($reason !== null) {
            throw new ApiError(ErrorCode::ServiceUnavailable, logReason: $reason);
        }
        return ['status' => 'ready'];
    }
}
