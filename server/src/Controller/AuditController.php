<?php
declare(strict_types=1);

namespace TamOs\Controller;

use TamOs\Audit\AuditEventView;
use TamOs\Audit\AuditService;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Http\Request;
use TamOs\Identity\AuthSession;
use TamOs\Identity\Principal;

/**
 * The CEO audit read routes (BF-4g). Both require a session (RouteAuth::Required), add no Action and
 * are CEO-only (decided by the handler before any lookup). Both are reads: nothing is written,
 * locked or corrected, and the authentication log is not exposed.
 *
 *   GET /api/audit-events?month=YYYY-MM                  { auditEvents: [event…] }
 *   GET /api/audit-events/record?entity=…&id=…           { auditEvents: [event…] }   [] when none
 */
final class AuditController
{
    public function __construct(private readonly AuditService $service)
    {
    }

    /**
     * @param array<string, mixed> $json
     * @return array{auditEvents: list<array<string, mixed>>}
     */
    public function month(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['auditEvents' => array_map(AuditEventView::event(...), $this->service->month(self::principal($session), self::query($request)['month'] ?? null))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{auditEvents: list<array<string, mixed>>}
     */
    public function record(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        $query = self::query($request);
        return ['auditEvents' => array_map(AuditEventView::event(...), $this->service->record(self::principal($session), $query['entity'] ?? null, $query['id'] ?? null))];
    }

    private static function principal(?AuthSession $session): Principal
    {
        return ($session ?? throw new ApiError(ErrorCode::Unauthenticated))->principal;
    }

    /**
     * The query string as name => value. The kernel has already refused unknown or repeated
     * keys and invalid UTF-8 (Route::$queryKeys).
     *
     * @return array<string, string>
     */
    private static function query(Request $request): array
    {
        $out = [];
        if ($request->query === '') {
            return $out;
        }
        foreach (explode('&', $request->query) as $pair) {
            $parts = explode('=', $pair, 2);
            $out[rawurldecode($parts[0])] = rawurldecode($parts[1] ?? '');
        }
        return $out;
    }
}
