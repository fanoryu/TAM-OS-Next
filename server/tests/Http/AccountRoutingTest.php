<?php
declare(strict_types=1);

/*
 * BF-4a2 account routes (SDR-0004) through the real production route table and kernel, with a
 * session double and NO database: 401 without a session, origin and CSRF 403, and the strict
 * bodies — forged scope or security fields, unknown keys, bad ids and emails are 400 — all before
 * any statement runs (a route that reached the database would answer 500 here). The Employee
 * 403 needs the scoped load and is proven in tests/Db, with every data path.
 */

use TamOs\Http\Request;
use TamOs\Http\Response;
use TamOs\Identity\AuthSession;
use TamOs\Identity\Principal;
use TamOs\Identity\PrincipalResolver;
use function TamOs\Tests\assertApiHeaders;
use function TamOs\Tests\assertNoLeak;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\envelope;
use function TamOs\Tests\kernel;
use function TamOs\Tests\requestId;
use function TamOs\Tests\sessionRequest;

$ceoToken = str_repeat('C', 43);
$empToken = str_repeat('E', 43);
$csrf = str_repeat('c', 43);
$resolver = new class ($ceoToken, $empToken, $csrf) implements PrincipalResolver {
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
$k = static fn () => kernel(null, null, null, $resolver);
$post = static fn (?string $token, string $path, string $body, ?string $withCsrf = 'session', array $over = []): Response
    => $k()->handle(sessionRequest('POST', $path, $token, $withCsrf === 'session' ? $csrf : $withCsrf, $body, $over), requestId());
$is = static function (Response $r, int $status, string $code, ?array $fields, string $label): void {
    $e = envelope($r);
    assertSame([$status, $code, $fields], [$r->status, $e['error']['code'] ?? null, $e['error']['fields'] ?? null], $label);
    assertApiHeaders($r, requestId());
    assertNoLeak($r->body, ['emp_1', str_repeat('3', 32), 'account.manage', 'a@example.test', '#activation=', 'password_hash']);
};
$routes = [
    '/api/employees/provision-account' => '{"id":"emp_1","email":"a@example.test"}',
    '/api/employees/reissue-activation' => '{"id":"emp_1"}',
    '/api/employees/disable-account' => '{"id":"emp_1"}',
    '/api/employees/enable-account' => '{"id":"emp_1"}',
];

return [
    'no session: every account route is 401' => static function () use ($post, $is, $routes): void {
        foreach ($routes as $path => $body) {
            $is($post(null, $path, $body), 401, 'unauthenticated', null, $path);
            $is($post(str_repeat('Z', 43), $path, $body), 401, 'unauthenticated', null, $path . ' unknown session');
        }
    },
    'account routes need the session CSRF token and the canonical origin' => static function () use ($post, $is, $routes, $ceoToken): void {
        foreach ($routes as $path => $body) {
            $is($post($ceoToken, $path, $body, null), 403, 'forbidden', null, $path . ' without csrf');
            $is($post($ceoToken, $path, $body, str_repeat('y', 43)), 403, 'forbidden', null, $path . ' wrong csrf');
            $is($post($ceoToken, $path, $body, 'session', ['origin' => 'https://evil.test']), 403, 'forbidden', null, $path . ' cross-origin');
            $is($post($ceoToken, $path, $body, 'session', ['origin' => null]), 403, 'forbidden', null, $path . ' no origin');
        }
    },
    'only POST: GET, PUT and DELETE are not account routes' => static function () use ($k, $ceoToken, $csrf): void {
        foreach (['GET', 'PUT', 'DELETE'] as $method) {
            $r = $k()->handle(sessionRequest($method, '/api/employees/provision-account', $ceoToken, $csrf, $method === 'GET' ? '' : '{"id":"emp_1","email":"a@example.test"}'), requestId());
            assertSame(405, $r->status, $method);
        }
    },
    'forged scope and security fields are 400 naming the key, for the CEO and an Employee alike' => static function () use ($post, $is, $routes, $ceoToken, $empToken): void {
        foreach (['company_id', 'companyId', 'user_id', 'userId', 'membership_id', 'membershipId', 'role', 'actor', 'status', 'token', 'password', 'scope', 'employee_id'] as $key) {
            foreach ($routes as $path => $body) {
                $forged = substr($body, 0, -1) . ',"' . $key . '":"x"}';
                $is($post($ceoToken, $path, $forged), 400, 'validation_failed', [$key], $path . ' ' . $key);
            }
            $is($post($empToken, '/api/employees/disable-account', '{"id":"emp_1","' . $key . '":"x"}'), 400, 'validation_failed', [$key], 'employee ' . $key);
        }
    },
    'malformed bodies: a bad id or email, a missing field, not an object' => static function () use ($post, $is, $routes, $ceoToken): void {
        $is($post($ceoToken, '/api/employees/provision-account', '{"id":"emp_1"}'), 400, 'validation_failed', ['email'], 'no email');
        $is($post($ceoToken, '/api/employees/provision-account', '{"id":"emp_1","email":"nope"}'), 400, 'validation_failed', ['email'], 'invalid email');
        $is($post($ceoToken, '/api/employees/provision-account', '{"id":"a b","email":"nope"}'), 400, 'validation_failed', ['id', 'email'], 'both invalid');
        foreach (array_keys($routes) as $path) {
            $is($post($ceoToken, $path, '{}'), 400, 'validation_failed', $path === '/api/employees/provision-account' ? ['id', 'email'] : ['id'], $path . ' empty');
            $is($post($ceoToken, $path, '{"id":"../x","email":"a@example.test"}'), 400, 'validation_failed', $path === '/api/employees/provision-account' ? ['id'] : ['email'], $path . ' bad id');
            $is($post($ceoToken, $path, '[1]'), 400, 'malformed_json', null, $path . ' not an object');
        }
    },
];
