<?php
declare(strict_types=1);

namespace TamOs\Controller;

use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Http\Request;
use TamOs\Identity\AuthSession;
use TamOs\Identity\Principal;
use TamOs\Payroll\PayrollService;
use TamOs\Payroll\PayrollView;

/**
 * BF-4c1 payroll routes. Every one requires a session (RouteAuth::Required) and, in this slice,
 * the CEO: an Employee is 403 on all of them. The reads add no Action; each write declares the
 * existing payroll.manage (Routes). No route commits, pays or reads a payslip.
 *
 *   GET  /api/payroll-plans?month=YYYY-MM   { payrollPlans: [plan…] }   every plan of the month
 *   GET  /api/payroll-plan?id=<id>          { payrollPlan: plan, payrollPlanOvertime: [{ id, hours, amount }…] }
 *   POST /api/payroll-plans/generate        { payrollPlans: [plan…], excluded: [{ employeeId, reason }…] }
 *                                           body { month }; the month's live plans after generation
 *   POST /api/payroll-plans/review          { payrollPlan: plan }   Draft → Reviewed
 *   POST /api/payroll-plans/approve         { payrollPlan: plan }   Draft / Reviewed → Ready
 *   POST /api/payroll-plans/return          { payrollPlan: plan }   Reviewed / Ready → Draft
 *   POST /api/payroll-plans/cancel          { payrollPlan: plan }   Draft / Reviewed / Ready → Cancelled
 *                                           transitions take exactly { id, expectedVersion }
 */
final class PayrollController
{
    public function __construct(private readonly PayrollService $service)
    {
    }

    /**
     * @param array<string, mixed> $json
     * @return array{payrollPlans: list<array<string, mixed>>}
     */
    public function month(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['payrollPlans' => array_map(PayrollView::plan(...), $this->service->month(self::principal($session), self::query($request)['month'] ?? null))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{payrollPlan: array<string, mixed>, payrollPlanOvertime: list<array{id: string, hours: string, amount: string}>}
     */
    public function find(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        $out = $this->service->read(self::principal($session), self::query($request)['id'] ?? null);
        return ['payrollPlan' => PayrollView::plan($out['plan']), 'payrollPlanOvertime' => array_map(PayrollView::overtime(...), $out['overtime'])];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{payrollPlans: list<array<string, mixed>>, excluded: list<array{employeeId: string, reason: string}>}
     */
    public function generate(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        $out = $this->service->generate(self::principal($session), $json, $requestId);
        return ['payrollPlans' => array_map(PayrollView::plan(...), $out['plans']), 'excluded' => $out['excluded']];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{payrollPlan: array<string, mixed>}
     */
    public function review(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['payrollPlan' => PayrollView::plan($this->service->transition(self::principal($session), 'review', $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{payrollPlan: array<string, mixed>}
     */
    public function approve(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['payrollPlan' => PayrollView::plan($this->service->transition(self::principal($session), 'approve', $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{payrollPlan: array<string, mixed>}
     */
    public function returnToDraft(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['payrollPlan' => PayrollView::plan($this->service->transition(self::principal($session), 'return', $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{payrollPlan: array<string, mixed>}
     */
    public function cancel(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['payrollPlan' => PayrollView::plan($this->service->transition(self::principal($session), 'cancel', $json, $requestId))];
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
