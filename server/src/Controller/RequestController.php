<?php
declare(strict_types=1);

namespace TamOs\Controller;

use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Http\Request;
use TamOs\Identity\AuthSession;
use TamOs\Identity\Principal;
use TamOs\Policy\Scope;
use TamOs\Request\RequestService;
use TamOs\Request\RequestView;

/**
 * The finance request routes (Phase 2, ADR-016). Every one requires a session (RouteAuth::Required).
 * The writes declare their Action: create, update and submit the record-bearing reimbursement self
 * actions (decided by the service after its scoped load — a payment request is decided there under
 * finance.manage), approve, reject and cancel the record-free finance.manage and pay the record-free
 * finance.execute (both decided by the kernel before the handler: an Employee is 403 before the body).
 * There is no delete, return-to-Draft, partial payment, reversal or correction route.
 *
 *   GET  /api/finance-requests?from=&to=[&status=][&kind=]   { financeRequests: [request…] }
 *   GET  /api/finance-request?id=                             { financeRequest: request }
 *   POST /api/finance-requests/create | update | submit | approve | reject | cancel | pay
 *                                                             { financeRequest: request }
 */
final class RequestController
{
    public function __construct(private readonly RequestService $service)
    {
    }

    /**
     * @param array<string, mixed> $json
     * @return array{financeRequests: list<array<string, mixed>>}
     */
    public function list(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        $q = self::query($request);
        return ['financeRequests' => array_map(static fn (array $row): array => self::view($session, $row), $this->service->list(self::principal($session), $q['from'] ?? null, $q['to'] ?? null, $q['status'] ?? null, $q['kind'] ?? null))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{financeRequest: array<string, mixed>}
     */
    public function find(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['financeRequest' => self::view($session, $this->service->read(self::principal($session), self::query($request)['id'] ?? null))];
    }

    /** @param array<string, mixed> $json */
    public function create(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['financeRequest' => self::view($session, $this->service->create(self::principal($session), $json, $requestId))];
    }

    /** @param array<string, mixed> $json */
    public function update(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['financeRequest' => self::view($session, $this->service->update(self::principal($session), $json, $requestId))];
    }

    /** @param array<string, mixed> $json */
    public function submit(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['financeRequest' => self::view($session, $this->service->transition(self::principal($session), 'submit', $json, $requestId))];
    }

    /** @param array<string, mixed> $json */
    public function approve(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['financeRequest' => self::view($session, $this->service->transition(self::principal($session), 'approve', $json, $requestId))];
    }

    /** @param array<string, mixed> $json */
    public function reject(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['financeRequest' => self::view($session, $this->service->transition(self::principal($session), 'reject', $json, $requestId))];
    }

    /** @param array<string, mixed> $json */
    public function cancel(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['financeRequest' => self::view($session, $this->service->transition(self::principal($session), 'cancel', $json, $requestId))];
    }

    /** @param array<string, mixed> $json */
    public function pay(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['financeRequest' => self::view($session, $this->service->pay(self::principal($session), $json, $requestId))];
    }

    /**
     * The request projection for the session's principal: the CEO (company scope) sees the
     * pre-approval snapshot, an Employee (self scope) never does (ADR-017 R-3).
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private static function view(?AuthSession $session, array $row): array
    {
        return RequestView::request($row, !Scope::of(self::principal($session))->isSelf());
    }

    private static function principal(?AuthSession $session): Principal
    {
        return ($session ?? throw new ApiError(ErrorCode::Unauthenticated))->principal;
    }

    /**
     * The query string as name => value. The kernel has already refused unknown or repeated keys
     * and invalid UTF-8 (Route::$queryKeys).
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
