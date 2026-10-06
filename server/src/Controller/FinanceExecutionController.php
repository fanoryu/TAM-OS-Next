<?php
declare(strict_types=1);

namespace TamOs\Controller;

use TamOs\Finance\FinanceExecutionService;
use TamOs\Finance\FinanceExecutionView;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Http\Request;
use TamOs\Identity\AuthSession;
use TamOs\Identity\Principal;

/**
 * The Finance execution routes (BF-4f). Every one requires a session (RouteAuth::Required) and is
 * CEO-only. The command declares the existing record-free finance.execute (decided by the kernel
 * before the handler); the month read adds no Action and is decided by the handler. An execution
 * records that a Planned posting was paid in full outside TAM OS — no route moves money, records a
 * partial amount, reverses, corrects or reconciles anything.
 *
 *   GET  /api/finance-executions?month=YYYY-MM      { financeExecutions: [execution…] }
 *   POST /api/finance-executions/execute            { financeExecution: execution }
 *                                                   body exactly { financePostingId, expectedAmount,
 *                                                   executedOn, paymentMethod, idempotencyKey }
 *                                                   a replay answers the original execution
 */
final class FinanceExecutionController
{
    public function __construct(private readonly FinanceExecutionService $service)
    {
    }

    /**
     * @param array<string, mixed> $json
     * @return array{financeExecutions: list<array<string, mixed>>}
     */
    public function month(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['financeExecutions' => array_map(FinanceExecutionView::execution(...), $this->service->month(self::principal($session), self::query($request)['month'] ?? null))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{financeExecution: array<string, mixed>}
     */
    public function execute(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['financeExecution' => FinanceExecutionView::execution($this->service->execute(self::principal($session), $json, $requestId))];
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
