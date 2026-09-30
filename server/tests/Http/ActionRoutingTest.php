<?php
declare(strict_types=1);

/*
 * BF-3C: the kernel decides a route's record-free Action before its handler runs, after the
 * existing gates (origin, session 401, CSRF 403). Test-only routes and a resolver double; no
 * production business route exists.
 */

use TamOs\Http\Request;
use TamOs\Http\Route;
use TamOs\Http\RouteAuth;
use TamOs\Identity\AuthSession;
use TamOs\Identity\Principal;
use TamOs\Identity\PrincipalResolver;
use TamOs\Policy\Action;
use function TamOs\Tests\assertNoLeak;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\envelope;
use function TamOs\Tests\kernel;
use function TamOs\Tests\requestId;
use function TamOs\Tests\sessionRequest;

$ceoToken = str_repeat('C', 43);
$empToken = str_repeat('E', 43);
$csrf = str_repeat('c', 43);
$resolver = static fn (): PrincipalResolver => new class ($ceoToken, $empToken, $csrf) implements PrincipalResolver {
    public function __construct(private string $c, private string $e, private string $csrf)
    {
    }

    public function resolve(Request $request): ?AuthSession
    {
        $user = ['user_id' => str_repeat('1', 32), 'user_status' => 'active', 'has_password' => true];
        $m = ['membership_id' => str_repeat('2', 32), 'company_id' => str_repeat('3', 32), 'membership_status' => 'active'];
        $p = match ($request->sessionToken) {
            $this->c => Principal::fromAccount($user, [$m + ['role' => 'ceo', 'employee_id' => null]]),
            $this->e => Principal::fromAccount($user, [$m + ['role' => 'employee', 'employee_id' => 'emp_1']]),
            default => null,
        };
        return $p === null ? null : new AuthSession($p, $this->csrf);
    }
};
$ran = new \ArrayObject();
$routes = static fn (): array => [
    new Route('POST', '/api/test/settings', static function () use ($ran): array {
        $ran[] = 'settings';
        return ['done' => true];
    }, [], RouteAuth::Required, Action::SettingsManage),
    new Route('POST', '/api/test/employee-update', static function () use ($ran): array {
        $ran[] = 'employee-update';
        return ['handler' => true];
    }, [], RouteAuth::Required, Action::EmployeeUpdate),
];
$code = static fn ($r): ?string => envelope($r)['error']['code'] ?? null;

return [
    'record-free Action: CEO passes, Employee is 403 before the handler, no session is 401' => static function () use ($resolver, $routes, $ran, $code, $ceoToken, $empToken, $csrf): void {
        $k = kernel(null, $routes(), null, $resolver());
        $ran->exchangeArray([]);
        $ok = $k->handle(sessionRequest('POST', '/api/test/settings', $ceoToken, $csrf), requestId());
        assertSame([200, ['settings']], [$ok->status, $ran->getArrayCopy()], 'ceo');
        $ran->exchangeArray([]);
        $denied = $k->handle(sessionRequest('POST', '/api/test/settings', $empToken, $csrf), requestId());
        assertSame([403, 'forbidden', []], [$denied->status, $code($denied), $ran->getArrayCopy()], 'employee');
        assertNoLeak($denied->body, ['settings.manage', 'employee', 'emp_1']);
        $anon = $k->handle(sessionRequest('POST', '/api/test/settings', null, $csrf), requestId());
        assertSame([401, 'unauthenticated', []], [$anon->status, $code($anon), $ran->getArrayCopy()], 'no session');
        $bad = $k->handle(sessionRequest('POST', '/api/test/settings', 'not-a-session-token', $csrf), requestId());
        assertSame(401, $bad->status, 'unknown session');
    },
    'CSRF is still checked first: a CEO without the token is 403 and the handler never runs' => static function () use ($resolver, $routes, $ran, $ceoToken): void {
        $k = kernel(null, $routes(), null, $resolver());
        $ran->exchangeArray([]);
        foreach ([null, str_repeat('x', 43)] as $wrong) {
            $r = $k->handle(sessionRequest('POST', '/api/test/settings', $ceoToken, $wrong), requestId());
            assertSame([403, []], [$r->status, $ran->getArrayCopy()]);
        }
    },
    'a record-bearing Action is left to the handler (its scoped load comes first)' => static function () use ($resolver, $routes, $ran, $empToken, $csrf): void {
        $k = kernel(null, $routes(), null, $resolver());
        $ran->exchangeArray([]);
        $r = $k->handle(sessionRequest('POST', '/api/test/employee-update', $empToken, $csrf), requestId());
        assertSame([200, ['employee-update']], [$r->status, $ran->getArrayCopy()]);
    },
];
