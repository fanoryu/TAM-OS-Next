<?php
declare(strict_types=1);

namespace TamOs\Controller;

use TamOs\Finance\FinancePostingService;
use TamOs\Finance\FinancePostingView;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Http\Request;
use TamOs\Identity\AuthSession;
use TamOs\Identity\Principal;

/**
 * The Finance posting routes (BF-4e). Every one requires a session (RouteAuth::Required) and is
 * CEO-only. Each posting route declares the Action of its source domain: the base plan posting the
 * existing payroll.manage (record-bearing — decided by the handler after its scoped load), the
 * Supplemental posting the existing record-free supplemental.manage (decided by the kernel before
 * the handler). No route executes, pays, records an actual amount, reverses or corrects anything.
 *
 *   GET  /api/finance-postings?month=YYYY-MM            { financePostings: [posting…] }
 *   POST /api/finance-postings/payroll-plan             { financePosting: posting }
 *                                                       body exactly { payrollPlanId, expectedAmount, idempotencyKey }
 *   POST /api/finance-postings/supplemental-payroll     { financePosting: posting }
 *                                                       body exactly { supplementalPayrollId, expectedAmount, idempotencyKey }
 *                                                       a replay answers the original posting
 */
final class FinanceController
{
    public function __construct(private readonly FinancePostingService $service)
    {
    }

    /**
     * @param array<string, mixed> $json
     * @return array{financePostings: list<array<string, mixed>>}
     */
    public function month(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['financePostings' => array_map(FinancePostingView::posting(...), $this->service->month(self::principal($session), self::query($request)['month'] ?? null))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{financePosting: array<string, mixed>}
     */
    public function postPayrollPlan(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['financePosting' => FinancePostingView::posting($this->service->postPayrollPlan(self::principal($session), $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{financePosting: array<string, mixed>}
     */
    public function postSupplementalPayroll(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['financePosting' => FinancePostingView::posting($this->service->postSupplementalPayroll(self::principal($session), $json, $requestId))];
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
