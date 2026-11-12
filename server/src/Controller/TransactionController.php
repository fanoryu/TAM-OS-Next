<?php
declare(strict_types=1);

namespace TamOs\Controller;

use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Http\Request;
use TamOs\Identity\AuthSession;
use TamOs\Identity\Principal;
use TamOs\Transaction\TransactionService;
use TamOs\Transaction\TransactionView;

/**
 * The general transaction routes (Phase 1, D-INT-1). Every one requires a session
 * (RouteAuth::Required) and is CEO-only. The two writes declare the existing record-free
 * finance.manage, decided by the kernel before the handler. There is no update or delete route:
 * a transaction is immutable, and a void is its only correction.
 *
 *   GET  /api/general-transactions?from=YYYY-MM-DD&to=YYYY-MM-DD   { generalTransactions: [transaction…] }
 *   POST /api/general-transactions/create                          { generalTransaction: transaction }
 *        body exactly { kind, financialPost, category, description, amount, transactionDate, idempotencyKey }
 *   POST /api/general-transactions/void                            { generalTransaction: transaction }
 *        body exactly { financeTransactionId, reason, idempotencyKey }
 *        a replay answers the original transaction
 */
final class TransactionController
{
    public function __construct(private readonly TransactionService $service)
    {
    }

    /**
     * @param array<string, mixed> $json
     * @return array{generalTransactions: list<array<string, mixed>>}
     */
    public function range(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        $q = self::query($request);
        return ['generalTransactions' => array_map(TransactionView::transaction(...), $this->service->range(self::principal($session), $q['from'] ?? null, $q['to'] ?? null))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{generalTransaction: array<string, mixed>}
     */
    public function create(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['generalTransaction' => TransactionView::transaction($this->service->create(self::principal($session), $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{generalTransaction: array<string, mixed>}
     */
    public function void(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['generalTransaction' => TransactionView::transaction($this->service->void(self::principal($session), $json, $requestId))];
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
