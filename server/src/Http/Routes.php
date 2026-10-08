<?php
declare(strict_types=1);

namespace TamOs\Http;

use TamOs\Controller\AuditController;
use TamOs\Controller\AuthController;
use TamOs\Controller\EmployeeController;
use TamOs\Controller\FinanceController;
use TamOs\Controller\FinanceExecutionController;
use TamOs\Controller\HealthController;
use TamOs\Controller\OvertimeController;
use TamOs\Controller\PayrollController;
use TamOs\Controller\ReadyController;
use TamOs\Controller\SupplementalController;
use TamOs\Data\Readiness;
use TamOs\Policy\Action;

/**
 * The production route table: liveness (never touches the database), readiness (read-only
 * database and schema check), the BF-3A session endpoints, the BF-3B self-service account
 * lifecycle, BF-3D password recovery and the BF-4a1 Employee domain. Only logout, me,
 * change-password, logout-all and the Employee routes resolve a session; health, ready, login,
 * activate, forgot-password and reset-password are RouteAuth::None whatever cookie is sent.
 *
 * BF-4a1: the Employee reads need a session and add no Action — the role and the Scope decide
 * them (SDR-0002 §8). The Employee writes declare employee.create (record-free, decided by the
 * kernel) and employee.update / employee.delete (record-bearing, decided by the handler after
 * its scoped load: 404 before 403). BF-4a2 (SDR-0004): the four Employee account routes declare
 * account.manage, record-bearing the same way.
 *
 * BF-4b1: the overtime reads need a session and add no Action (role and Scope decide them; the
 * month list requires ?month=). Each overtime write declares its existing overtime Action —
 * createSelfDraft, updateSelfDraft, deleteSelfDraft, submitSelf, or manage for review and reject —
 * all record-bearing, decided by the handler after its scoped load (404 before 403).
 *
 * BF-4b2: the valuation read adds no route-level Action (an Approved record's frozen valuation is
 * read by scope; a preview is decided by the handler under overtime.manage), and approve declares
 * the existing overtime.manage — record-bearing, 404 before 403. ACTIONS stay 21.
 *
 * BF-4c1: the payroll reads need a session and add no Action (the month list requires ?month=).
 * generate, review, approve, return and cancel each declare the existing payroll.manage —
 * record-bearing, decided by the handler (generate against the period, the others after their
 * scoped load: 404 before 403). There is no generic status route.
 *
 * BF-4c2: commit declares the existing payroll.manage (record-bearing, 404 before 403); the drift
 * read adds no Action (CEO only, decided by the handler). The two plan reads become role-aware: an
 * Employee reads their own Committed plans. ACTIONS stay 21.
 *
 * BF-4d: the Supplemental Payroll writes — generate, review, approve, return, cancel and commit —
 * each declare the existing supplemental.manage, which is record-free and so decided by the kernel
 * before the handler (an Employee is 403 before any lookup). The two document reads and the CEO
 * eligibility read add no Action (role and Scope decide them; an Employee reads their own
 * Committed documents). There is no generic status, payment, posting or execution route. ACTIONS
 * stay 21.
 *
 * BF-4e: the two Finance posting writes declare the Action of their source domain (D-FIN-2 = A) —
 * the base plan posting the existing payroll.manage (record-bearing, decided by the handler after
 * its scoped load: an Employee is 403 before any lookup), the Supplemental posting the existing
 * record-free supplemental.manage (decided by the kernel). The month read adds no Action and is
 * CEO-only (decided by the handler). There is no execution, payment, actual, reversal or
 * correction route. ACTIONS stay 21.
 *
 * BF-4f: the one Finance execution write declares the existing record-free finance.execute
 * (D-FEX-4 = A), decided by the kernel before the handler (an Employee is 403 before the body). The
 * month read adds no Action and is CEO-only (decided by the handler). There is no batch, automatic,
 * partial, reversal, correction or reconciliation route, and no posting route changes. ACTIONS stay 21.
 *
 * BF-4g: the two CEO audit reads — a month of the Asia/Jakarta company calendar and the history of
 * one record — add no Action and are CEO-only (decided by the handler before any lookup). They are
 * GETs: no audit write, correction or deletion route exists, and the authentication log has no
 * route. ACTIONS stay 21.
 *
 * BF-3C: every mutation is either a business mutation that declares its server Action, or one of
 * the account self-service routes below, which act only on the caller's own credentials and are
 * governed by SDR-0002 §2–§5, not by the ACTIONS. validate() refuses anything else, so the
 * table fails closed at bootstrap if a business mutation is added without an Action.
 */
final class Routes
{
    /** The only mutations without an Action. Never a business operation; never extended casually. */
    public const ACCOUNT_SELF_SERVICE = [
        'POST /api/auth/login',
        'POST /api/auth/logout',
        'POST /api/auth/activate',
        'POST /api/auth/change-password',
        'POST /api/auth/logout-all',
        'POST /api/auth/forgot-password',
        'POST /api/auth/reset-password',
    ];

    /** @return list<Route> */
    public static function production(Readiness $readiness, AuthController $auth, EmployeeController $employees, OvertimeController $overtime, PayrollController $payroll, SupplementalController $supplemental, FinanceController $finance, FinanceExecutionController $financeExecutions, AuditController $audit): array
    {
        return self::validate([
            new Route('GET', '/api/health', HealthController::handle(...)),
            new Route('GET', '/api/ready', (new ReadyController($readiness))->handle(...)),
            new Route('POST', '/api/auth/login', $auth->login(...)),
            new Route('POST', '/api/auth/logout', $auth->logout(...), [], RouteAuth::Optional),
            new Route('GET', '/api/auth/me', $auth->me(...), [], RouteAuth::Required),
            // BF-3B: activation is not session-bound (origin check and rate limiting instead);
            // the other two act only on the caller's own account.
            new Route('POST', '/api/auth/activate', $auth->activate(...)),
            new Route('POST', '/api/auth/change-password', $auth->changePassword(...), [], RouteAuth::Required),
            new Route('POST', '/api/auth/logout-all', $auth->logoutAll(...), [], RouteAuth::Required),
            // BF-3D: recovery is not session-bound (origin check and rate limiting instead, like
            // activate); neither route ever resolves a session or sets a cookie.
            new Route('POST', '/api/auth/forgot-password', $auth->forgotPassword(...)),
            new Route('POST', '/api/auth/reset-password', $auth->resetPassword(...)),
            // BF-4a1: the Employee domain (company scope for the CEO, self scope for an Employee).
            new Route('GET', '/api/employees', $employees->list(...), ['archived'], RouteAuth::Required),
            new Route('GET', '/api/employee', $employees->find(...), ['id'], RouteAuth::Required),
            new Route('POST', '/api/employees/create', $employees->create(...), [], RouteAuth::Required, Action::EmployeeCreate),
            new Route('POST', '/api/employees/update', $employees->update(...), [], RouteAuth::Required, Action::EmployeeUpdate),
            new Route('POST', '/api/employees/archive', $employees->archive(...), [], RouteAuth::Required, Action::EmployeeDelete),
            new Route('POST', '/api/employees/provision-account', $employees->provisionAccount(...), [], RouteAuth::Required, Action::AccountManage),
            new Route('POST', '/api/employees/reissue-activation', $employees->reissueActivation(...), [], RouteAuth::Required, Action::AccountManage),
            new Route('POST', '/api/employees/disable-account', $employees->disableAccount(...), [], RouteAuth::Required, Action::AccountManage),
            new Route('POST', '/api/employees/enable-account', $employees->enableAccount(...), [], RouteAuth::Required, Action::AccountManage),
            // BF-4b1: the non-money overtime workflow (company scope for the CEO, own rows for an Employee).
            new Route('GET', '/api/overtime-records', $overtime->month(...), ['month'], RouteAuth::Required),
            new Route('GET', '/api/overtime-record', $overtime->find(...), ['id'], RouteAuth::Required),
            new Route('POST', '/api/overtime-records/create', $overtime->create(...), [], RouteAuth::Required, Action::OvertimeCreateSelfDraft),
            new Route('POST', '/api/overtime-records/update', $overtime->update(...), [], RouteAuth::Required, Action::OvertimeUpdateSelfDraft),
            new Route('POST', '/api/overtime-records/delete', $overtime->delete(...), [], RouteAuth::Required, Action::OvertimeDeleteSelfDraft),
            new Route('POST', '/api/overtime-records/submit', $overtime->submit(...), [], RouteAuth::Required, Action::OvertimeSubmitSelf),
            new Route('POST', '/api/overtime-records/review', $overtime->review(...), [], RouteAuth::Required, Action::OvertimeManage),
            new Route('POST', '/api/overtime-records/reject', $overtime->reject(...), [], RouteAuth::Required, Action::OvertimeManage),
            // BF-4b2: valuation and approval (TAM-OT-1); no payroll, no finance.
            new Route('GET', '/api/overtime-record/valuation', $overtime->valuation(...), ['id'], RouteAuth::Required),
            new Route('POST', '/api/overtime-records/approve', $overtime->approve(...), [], RouteAuth::Required, Action::OvertimeManage),
            // BF-4c1: payroll plans — payroll.manage writes; BF-4c2: the reads serve an Employee their own Committed plans.
            new Route('GET', '/api/payroll-plans', $payroll->month(...), ['month'], RouteAuth::Required),
            new Route('GET', '/api/payroll-plan', $payroll->find(...), ['id'], RouteAuth::Required),
            new Route('POST', '/api/payroll-plans/generate', $payroll->generate(...), [], RouteAuth::Required, Action::PayrollManage),
            new Route('POST', '/api/payroll-plans/review', $payroll->review(...), [], RouteAuth::Required, Action::PayrollManage),
            new Route('POST', '/api/payroll-plans/approve', $payroll->approve(...), [], RouteAuth::Required, Action::PayrollManage),
            new Route('POST', '/api/payroll-plans/return', $payroll->returnToDraft(...), [], RouteAuth::Required, Action::PayrollManage),
            new Route('POST', '/api/payroll-plans/cancel', $payroll->cancel(...), [], RouteAuth::Required, Action::PayrollManage),
            // BF-4c2: Commit (an immutable obligation — never a payment) and the CEO drift read.
            new Route('POST', '/api/payroll-plans/commit', $payroll->commit(...), [], RouteAuth::Required, Action::PayrollManage),
            new Route('GET', '/api/payroll-plan/drift', $payroll->drift(...), ['id'], RouteAuth::Required),
            // BF-4d: Supplemental Payroll — late Approved overtime of a Committed base plan, under supplemental.manage.
            new Route('GET', '/api/supplemental-payrolls', $supplemental->month(...), ['month'], RouteAuth::Required),
            new Route('GET', '/api/supplemental-payroll', $supplemental->find(...), ['id'], RouteAuth::Required),
            new Route('GET', '/api/supplemental-payrolls/eligibility', $supplemental->eligibility(...), ['month'], RouteAuth::Required),
            new Route('POST', '/api/supplemental-payrolls/generate', $supplemental->generate(...), [], RouteAuth::Required, Action::SupplementalManage),
            new Route('POST', '/api/supplemental-payrolls/review', $supplemental->review(...), [], RouteAuth::Required, Action::SupplementalManage),
            new Route('POST', '/api/supplemental-payrolls/approve', $supplemental->approve(...), [], RouteAuth::Required, Action::SupplementalManage),
            new Route('POST', '/api/supplemental-payrolls/return', $supplemental->returnToDraft(...), [], RouteAuth::Required, Action::SupplementalManage),
            new Route('POST', '/api/supplemental-payrolls/cancel', $supplemental->cancel(...), [], RouteAuth::Required, Action::SupplementalManage),
            new Route('POST', '/api/supplemental-payrolls/commit', $supplemental->commit(...), [], RouteAuth::Required, Action::SupplementalManage),
            // BF-4e: Finance posting — one Planned posting per Committed obligation, under its source's Action.
            new Route('GET', '/api/finance-postings', $finance->month(...), ['month'], RouteAuth::Required),
            new Route('POST', '/api/finance-postings/payroll-plan', $finance->postPayrollPlan(...), [], RouteAuth::Required, Action::PayrollManage),
            new Route('POST', '/api/finance-postings/supplemental-payroll', $finance->postSupplementalPayroll(...), [], RouteAuth::Required, Action::SupplementalManage),
            // BF-4f: Finance execution — one full execution per Planned posting, recorded under finance.execute.
            new Route('GET', '/api/finance-executions', $financeExecutions->month(...), ['month'], RouteAuth::Required),
            new Route('POST', '/api/finance-executions/execute', $financeExecutions->execute(...), [], RouteAuth::Required, Action::FinanceExecute),
            // BF-4g: the CEO audit read — read-only, company scope, no Action.
            new Route('GET', '/api/audit-events', $audit->month(...), ['month'], RouteAuth::Required),
            new Route('GET', '/api/audit-events/record', $audit->record(...), ['entity', 'id'], RouteAuth::Required),
        ]);
    }

    /**
     * @param list<Route> $routes
     * @return list<Route>
     * @throws \LogicException when a mutation has no Action and is not account self-service, when
     *                         a self-service route claims an Action, or when a self-service
     *                         entry names no route
     */
    public static function validate(array $routes): array
    {
        $seen = [];
        foreach ($routes as $route) {
            $key = $route->method . ' ' . $route->path;
            $selfService = in_array($key, self::ACCOUNT_SELF_SERVICE, true);
            if ($selfService) {
                $seen[$key] = true;
                if ($route->action !== null) {
                    throw new \LogicException('account self-service is not a business action: ' . $key);
                }
            } elseif ($route->isMutation() && $route->action === null) {
                throw new \LogicException('a business mutation must declare its Action: ' . $key);
            }
        }
        if (count($seen) !== count(self::ACCOUNT_SELF_SERVICE)) {
            throw new \LogicException('every account self-service entry must name a route');
        }
        return $routes;
    }
}
