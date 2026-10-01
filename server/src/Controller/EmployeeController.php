<?php
declare(strict_types=1);

namespace TamOs\Controller;

use TamOs\Employee\AccountService;
use TamOs\Employee\EmployeeService;
use TamOs\Employee\EmployeeView;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Http\Request;
use TamOs\Identity\AuthSession;
use TamOs\Identity\Principal;
use TamOs\Identity\Role;

/**
 * BF-4a1 Employee routes. Every one requires a session (RouteAuth::Required); the reads add
 * no Action — the session's role and Scope decide them — and the writes declare
 * employee.create / employee.update / employee.delete (Routes). Responses are the least-privilege
 * projections of EmployeeView: the CEO gets the company list and details; an Employee gets
 * only their own profile and no list.
 *
 *   GET  /api/employees[?archived=1]  { employees: [list item…] }      CEO only
 *   GET  /api/employee?id=<id>        { employee: detail | self }
 *   POST /api/employees/create        { employee: detail }
 *   POST /api/employees/update        { employee: detail }
 *   POST /api/employees/archive       { employee: detail }
 *
 * BF-4a2 (SDR-0004): Employee account administration, all under account.manage (CEO-only,
 * record-bearing: 404 before 403) and answered with the CEO detail and its accountState:
 *
 *   POST /api/employees/provision-account   {id, email}
 *   POST /api/employees/reissue-activation  {id}
 *   POST /api/employees/disable-account     {id}
 *   POST /api/employees/enable-account      {id}
 */
final class EmployeeController
{
    public function __construct(private readonly EmployeeService $service, private readonly AccountService $accounts)
    {
    }

    /**
     * @param array<string, mixed> $json
     * @return array{employees: list<array<string, mixed>>}
     */
    public function list(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        $query = self::query($request);
        $archived = $query['archived'] ?? null;
        if ($archived !== null && $archived !== '1') {
            throw new ApiError(ErrorCode::InvalidQuery, 'archived must be 1');
        }
        $rows = $this->service->list(self::principal($session), $archived === '1');
        return ['employees' => array_map(EmployeeView::listItem(...), $rows)];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{employee: array<string, mixed>}
     */
    public function find(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        $principal = self::principal($session);
        $id = self::query($request)['id'] ?? throw new ApiError(ErrorCode::ValidationFailed, 'employee id', fields: ['id']);
        $row = $this->service->read($principal, $id);
        return ['employee' => $principal->role === Role::Ceo ? EmployeeView::detail($row) : EmployeeView::self($row)];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{employee: array<string, mixed>}
     */
    public function create(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['employee' => EmployeeView::detail($this->service->create(self::principal($session), $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{employee: array<string, mixed>}
     */
    public function update(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['employee' => EmployeeView::detail($this->service->update(self::principal($session), $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{employee: array<string, mixed>}
     */
    public function archive(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['employee' => EmployeeView::detail($this->service->archive(self::principal($session), $json, $requestId))];
    }

    /**
     * BF-4a2 account administration (account.manage). The response is the CEO detail with the
     * derived accountState — never a token, link, email or account id.
     *
     * @param array<string, mixed> $json
     * @return array{employee: array<string, mixed>}
     */
    public function provisionAccount(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['employee' => EmployeeView::detail($this->accounts->provision(self::principal($session), $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{employee: array<string, mixed>}
     */
    public function reissueActivation(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['employee' => EmployeeView::detail($this->accounts->reissue(self::principal($session), $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{employee: array<string, mixed>}
     */
    public function disableAccount(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['employee' => EmployeeView::detail($this->accounts->disable(self::principal($session), $json, $requestId))];
    }

    /**
     * @param array<string, mixed> $json
     * @return array{employee: array<string, mixed>}
     */
    public function enableAccount(Request $request, ?AuthSession $session, array $json, string $requestId): array
    {
        return ['employee' => EmployeeView::detail($this->accounts->enable(self::principal($session), $json, $requestId))];
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
