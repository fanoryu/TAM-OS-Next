<?php
declare(strict_types=1);

namespace TamOs\Controller;

use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Http\Request;
use TamOs\Identity\AuthSession;
use TamOs\Report\FinancialReportService;

/**
 * The SESSION financial report route (Phase 1, D-INT-2): a CEO-only read that declares no Action.
 *
 *   GET /api/reports/financial?from=YYYY-MM-DD&to=YYYY-MM-DD   { financialReport: report }
 *
 * The report shape is FinancialReport::build(): the four Financial Post lines, the general total,
 * the voided transactions (shown, never counted), the separate unallocated Payroll line (posted and
 * paid) and the consolidated total, which counts payroll once, as paid.
 */
final class FinancialReportController
{
    public function __construct(private readonly FinancialReportService $service)
    {
    }

    /**
     * @param array<string, mixed> $json
     * @return array{financialReport: array<string, mixed>}
     */
    public function report(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        $q = [];
        if ($request->query !== '') {
            foreach (explode('&', $request->query) as $pair) {
                $parts = explode('=', $pair, 2);
                $q[rawurldecode($parts[0])] = rawurldecode($parts[1] ?? '');
            }
        }
        $principal = ($session ?? throw new ApiError(ErrorCode::Unauthenticated))->principal;
        return ['financialReport' => $this->service->report($principal, $q['from'] ?? null, $q['to'] ?? null)];
    }
}
