<?php
declare(strict_types=1);

namespace TamOs\Controller;

use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Http\Request;
use TamOs\Identity\AuthSession;
use TamOs\Identity\Principal;
use TamOs\Supplemental\SupplementalService;
use TamOs\Supplemental\SupplementalView;

/**
 * The Supplemental Payroll routes (BF-4d). Every one requires a session (RouteAuth::Required).
 * Every write and the eligibility read are CEO-only: each write declares the existing,
 * record-free supplemental.manage, which the kernel decides before the handler (an Employee is
 * 403 before any lookup). The two document reads serve the CEO in company scope and an Employee
 * their OWN COMMITTED documents only (404 otherwise). No route pays, posts or renders a payslip.
 *
 *   GET  /api/supplemental-payrolls?month=YYYY-MM       { supplementalPayrolls: [document…] }
 *   GET  /api/supplemental-payroll?id=<id>              { supplementalPayroll: document, supplementalPayrollOvertime: [{ id, hours, amount }…] }
 *   GET  /api/supplemental-payrolls/eligibility?month=  { supplementalEligibility: [{ payrollPlanId, employeeId, eligibleCount, eligibleHours, eligibleAmount }…] }   CEO only
 *   POST /api/supplemental-payrolls/generate            { supplementalPayroll: document }   body { payrollPlanId }
 *   POST /api/supplemental-payrolls/review              { supplementalPayroll: document }   Draft → Reviewed
 *   POST /api/supplemental-payrolls/approve             { supplementalPayroll: document }   Reviewed → Ready
 *   POST /api/supplemental-payrolls/return              { supplementalPayroll: document }   Reviewed / Ready → Draft
 *   POST /api/supplemental-payrolls/cancel              { supplementalPayroll: document }   Draft / Reviewed / Ready → Cancelled
 *                                                       transitions take exactly { id, expectedVersion }
 *   POST /api/supplemental-payrolls/commit              { supplementalPayroll: document }   Ready → Committed
 *                                                       body exactly { id, expectedVersion, expectedTotal, idempotencyKey };
 *                                                       a replay answers the original Committed document
 */
final class SupplementalController
{
    public function __construct(private readonly SupplementalService $service)
    {
    }

    /**
     * @param array<string, mixed> $json
     * @return array{supplementalPayrolls: list<array<string, mixed>>}
     */
    public function month(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['supplementalPayrolls' => array_map(SupplementalView::supplemental(...), $this->service->month(self::principal($session), self::query($request)['month'] ?? null))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{supplementalPayroll: array<string, mixed>, supplementalPayrollOvertime: list<array{id: string, hours: string, amount: string}>}
     */
    public function find(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        $out = $this->service->read(self::principal($session), self::query($request)['id'] ?? null);
        return ['supplementalPayroll' => SupplementalView::supplemental($out['supplemental']), 'supplementalPayrollOvertime' => array_map(SupplementalView::overtime(...), $out['overtime'])];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{supplementalEligibility: list<array<string, mixed>>}
     */
    public function eligibility(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['supplementalEligibility' => array_map(SupplementalView::eligibility(...), $this->service->eligibility(self::principal($session), self::query($request)['month'] ?? null))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{supplementalPayroll: array<string, mixed>}
     */
    public function generate(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['supplementalPayroll' => SupplementalView::supplemental($this->service->generate(self::principal($session), $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{supplementalPayroll: array<string, mixed>}
     */
    public function review(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['supplementalPayroll' => SupplementalView::supplemental($this->service->transition(self::principal($session), 'review', $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{supplementalPayroll: array<string, mixed>}
     */
    public function approve(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['supplementalPayroll' => SupplementalView::supplemental($this->service->transition(self::principal($session), 'approve', $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{supplementalPayroll: array<string, mixed>}
     */
    public function returnToDraft(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['supplementalPayroll' => SupplementalView::supplemental($this->service->transition(self::principal($session), 'return', $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{supplementalPayroll: array<string, mixed>}
     */
    public function cancel(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['supplementalPayroll' => SupplementalView::supplemental($this->service->transition(self::principal($session), 'cancel', $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{supplementalPayroll: array<string, mixed>}
     */
    public function commit(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['supplementalPayroll' => SupplementalView::supplemental($this->service->commit(self::principal($session), $json, $requestId))];
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
