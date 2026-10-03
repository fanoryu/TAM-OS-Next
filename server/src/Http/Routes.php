<?php
declare(strict_types=1);

namespace TamOs\Http;

use TamOs\Controller\AuthController;
use TamOs\Controller\EmployeeController;
use TamOs\Controller\HealthController;
use TamOs\Controller\OvertimeController;
use TamOs\Controller\PayrollController;
use TamOs\Controller\ReadyController;
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
 * BF-4c1: the payroll reads need a session and add no Action (CEO only in this slice; the month
 * list requires ?month=). generate, review, approve, return and cancel each declare the existing
 * payroll.manage — record-bearing, decided by the handler (generate against the period, the others
 * after their scoped load: 404 before 403). There is no commit route and no generic status route.
 * ACTIONS stay 21.
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
    public static function production(Readiness $readiness, AuthController $auth, EmployeeController $employees, OvertimeController $overtime, PayrollController $payroll): array
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
            // BF-4c1: payroll plans — CEO only, payroll.manage, no commit (BF-4c2).
            new Route('GET', '/api/payroll-plans', $payroll->month(...), ['month'], RouteAuth::Required),
            new Route('GET', '/api/payroll-plan', $payroll->find(...), ['id'], RouteAuth::Required),
            new Route('POST', '/api/payroll-plans/generate', $payroll->generate(...), [], RouteAuth::Required, Action::PayrollManage),
            new Route('POST', '/api/payroll-plans/review', $payroll->review(...), [], RouteAuth::Required, Action::PayrollManage),
            new Route('POST', '/api/payroll-plans/approve', $payroll->approve(...), [], RouteAuth::Required, Action::PayrollManage),
            new Route('POST', '/api/payroll-plans/return', $payroll->returnToDraft(...), [], RouteAuth::Required, Action::PayrollManage),
            new Route('POST', '/api/payroll-plans/cancel', $payroll->cancel(...), [], RouteAuth::Required, Action::PayrollManage),
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
