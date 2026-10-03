<?php
declare(strict_types=1);

namespace TamOs\Controller;

use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Http\Request;
use TamOs\Identity\AuthSession;
use TamOs\Identity\Principal;
use TamOs\Overtime\OvertimeService;
use TamOs\Overtime\OvertimeValuationView;
use TamOs\Overtime\OvertimeView;

/**
 * BF-4b1 overtime routes. Every one requires a session (RouteAuth::Required); the reads add no
 * Action — the session's role and Scope decide them — and each write declares its existing
 * overtime Action (Routes). The CEO and the owning Employee get the same OvertimeView shape.
 *
 *   GET  /api/overtime-records?month=YYYY-MM   { overtimeRecords: [record…] }
 *   GET  /api/overtime-record?id=<id>          { overtimeRecord: record }
 *   POST /api/overtime-records/create          { overtimeRecord: record }   a new Draft
 *   POST /api/overtime-records/update          { overtimeRecord: record }   a Draft only
 *   POST /api/overtime-records/delete          { deleted: { id } }          a Draft only (hard)
 *   POST /api/overtime-records/submit          { overtimeRecord: record }   Draft → Submitted
 *   POST /api/overtime-records/review          { overtimeRecord: record }   Submitted → Reviewed
 *   POST /api/overtime-records/reject          { overtimeRecord: record }   Submitted / Reviewed → Rejected
 *
 * BF-4b2 (valuation and approval; the record shape is unchanged, its status gains Approved):
 *
 *   GET  /api/overtime-record/valuation?id=<id>  { overtimeValuation: valuation }   CEO preview of a
 *                                                 Reviewed record, or the frozen valuation of an
 *                                                 Approved one (CEO and owner)
 *   POST /api/overtime-records/approve           { overtimeRecord: record, overtimeValuation: valuation }
 *                                                 Reviewed → Approved; body { id, expectedVersion, expectedAmount }
 */
final class OvertimeController
{
    public function __construct(private readonly OvertimeService $service)
    {
    }

    /**
     * @param array<string, mixed> $json
     * @return array{overtimeRecords: list<array<string, mixed>>}
     */
    public function month(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        $rows = $this->service->month(self::principal($session), self::query($request)['month'] ?? null);
        return ['overtimeRecords' => array_map(OvertimeView::record(...), $rows)];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{overtimeRecord: array<string, mixed>}
     */
    public function find(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['overtimeRecord' => OvertimeView::record($this->service->read(self::principal($session), self::query($request)['id'] ?? null))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{overtimeRecord: array<string, mixed>}
     */
    public function create(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['overtimeRecord' => OvertimeView::record($this->service->create(self::principal($session), $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{overtimeRecord: array<string, mixed>}
     */
    public function update(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['overtimeRecord' => OvertimeView::record($this->service->update(self::principal($session), $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{deleted: array{id: string}}
     */
    public function delete(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['deleted' => $this->service->delete(self::principal($session), $json, $requestId)];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{overtimeRecord: array<string, mixed>}
     */
    public function submit(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['overtimeRecord' => OvertimeView::record($this->service->transition(self::principal($session), 'submit', $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{overtimeRecord: array<string, mixed>}
     */
    public function review(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['overtimeRecord' => OvertimeView::record($this->service->transition(self::principal($session), 'review', $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{overtimeRecord: array<string, mixed>}
     */
    public function reject(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['overtimeRecord' => OvertimeView::record($this->service->transition(self::principal($session), 'reject', $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{overtimeValuation: array<string, string>}
     */
    public function valuation(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['overtimeValuation' => $this->service->valuation(self::principal($session), self::query($request)['id'] ?? null)];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{overtimeRecord: array<string, mixed>, overtimeValuation: array<string, string>}
     */
    public function approve(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        $out = $this->service->approve(self::principal($session), $json, $requestId);
        return ['overtimeRecord' => OvertimeView::record($out['record']), 'overtimeValuation' => $out['valuation']];
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
