<?php
declare(strict_types=1);

/*
 * BF-4c1 payroll routes through the real production route table and kernel, with a session
 * double and NO database: every refusal proven here — 401, origin and CSRF 403, an Employee's 403
 * (BF-4c1 is CEO-only), the required month, query and id 400s, and every identity, money or status
 * key a 400 — happens before any statement runs. (Any route that reached the database would answer
 * 500 here: none is configured.) The data paths, Policy and the state machine are proven in
 * tests/Db/Payroll*Test.php. There is no commit route.
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
$get = static fn (?string $token, string $path, string $query = ''): Response => $k()->handle(sessionRequest('GET', $path, $token, null, '', ['query' => $query]), requestId());
$post = static fn (?string $token, string $path, string $body, ?string $withCsrf = 'session', array $over = []): Response
    => $k()->handle(sessionRequest('POST', $path, $token, $withCsrf === 'session' ? $csrf : $withCsrf, $body, $over), requestId());
$is = static function (Response $r, int $status, string $code, ?array $fields, string $label): void {
    $e = envelope($r);
    assertSame([$status, $code, $fields], [$r->status, $e['error']['code'] ?? null, $e['error']['fields'] ?? null], $label);
    assertApiHeaders($r, requestId());
    assertNoLeak($r->body, ['emp_1', str_repeat('3', 32), 'payroll_plans', 'payroll.manage', 'action_denied']);
};
$id = str_repeat('a', 32);
$target = '{"id":"' . $id . '","expectedVersion":1}';
$writes = [
    '/api/payroll-plans/generate' => '{"month":"2026-10"}',
    '/api/payroll-plans/review' => $target,
    '/api/payroll-plans/approve' => $target,
    '/api/payroll-plans/return' => $target,
    '/api/payroll-plans/cancel' => $target,
];

return [
    'no session: every payroll route is 401' => static function () use ($get, $post, $is, $writes, $id): void {
        $is($get(null, '/api/payroll-plans', 'month=2026-10'), 401, 'unauthenticated', null, 'month list');
        $is($get(null, '/api/payroll-plan', 'id=' . $id), 401, 'unauthenticated', null, 'detail');
        foreach ($writes as $path => $body) {
            $is($post(null, $path, $body), 401, 'unauthenticated', null, $path);
        }
    },
    'every payroll write needs the session CSRF token and the canonical origin' => static function () use ($post, $is, $writes, $ceoToken, $empToken): void {
        foreach ($writes as $path => $body) {
            foreach ([$ceoToken, $empToken] as $who) {
                $is($post($who, $path, $body, null), 403, 'forbidden', null, $path . ' without csrf');
                $is($post($who, $path, $body, str_repeat('x', 43)), 403, 'forbidden', null, $path . ' wrong csrf');
                $is($post($who, $path, $body, 'session', ['origin' => 'https://evil.test']), 403, 'forbidden', null, $path . ' cross-origin');
            }
        }
    },
    'BF-4c1 is CEO-only: an Employee is 403 on every payroll read and write, before any lookup (M12)' => static function () use ($get, $post, $is, $writes, $empToken, $id): void {
        $is($get($empToken, '/api/payroll-plans', 'month=2026-10'), 403, 'forbidden', null, 'month list');
        $is($get($empToken, '/api/payroll-plan', 'id=' . $id), 403, 'forbidden', null, 'detail');
        foreach ($writes as $path => $body) {
            $is($post($empToken, $path, $body), 403, 'forbidden', null, $path);
        }
    },
    'the collection requires ?month=YYYY-MM and nothing else' => static function () use ($get, $is, $ceoToken, $empToken): void {
        foreach ([$ceoToken, $empToken] as $who) {
            $is($get($who, '/api/payroll-plans'), 400, 'invalid_query', null, 'no month');
            foreach (['month=', 'month=2026-13', 'month=2026-1', 'month=all', 'month=2026-10-01'] as $q) {
                $is($get($who, '/api/payroll-plans', $q), 400, 'invalid_query', null, $q);
            }
            foreach (['employeeId=emp_1', 'status=Draft', 'month=2026-10&employeeId=emp_1', 'month=2026-10&month=2026-11', 'month=2026-10&companyId=x'] as $q) {
                $is($get($who, '/api/payroll-plans', $q), 400, 'invalid_query', null, 'no other filter: ' . $q);
            }
        }
    },
    'the detail needs a server plan id and no other key' => static function () use ($get, $is, $ceoToken): void {
        $is($get($ceoToken, '/api/payroll-plan'), 400, 'validation_failed', ['id'], 'no id');
        $is($get($ceoToken, '/api/payroll-plan', 'id=emp_1'), 400, 'validation_failed', ['id'], 'an employee id is not a plan id');
        $is($get($ceoToken, '/api/payroll-plan', 'id=x&employeeId=emp_1'), 400, 'invalid_query', null, 'unknown key');
    },
    'generate: exactly { month } — a browser salary, total, amount, employee, company, role or status is a 400 naming it (M1, M2)' => static function () use ($post, $is, $ceoToken): void {
        foreach (['salary', 'baseSalary', 'monthlyBaseSalary', 'overtimeAmount', 'totalAmount', 'total', 'amount', 'employeeId', 'companyId', 'company_id', 'role', 'status', 'overtimeIds'] as $key) {
            $is($post($ceoToken, '/api/payroll-plans/generate', '{"month":"2026-10","' . $key . '":"1"}'), 400, 'validation_failed', [$key], 'generate ' . $key);
        }
        foreach (['{}', '{"month":"2026-13"}', '{"month":202610}', '{"month":null}', '{"month":"10-2026"}', '{"monthKey":"2026-10"}'] as $body) {
            $is($post($ceoToken, '/api/payroll-plans/generate', $body), 400, 'validation_failed', $body === '{"monthKey":"2026-10"}' ? ['monthKey'] : ['month'], 'generate ' . $body);
        }
    },
    'transitions: exactly { id, expectedVersion } — a browser total, salary, status or employee is a 400 naming it' => static function () use ($post, $is, $ceoToken, $writes, $id): void {
        foreach (array_slice(array_keys($writes), 1) as $path) {
            foreach (['expectedTotal', 'totalAmount', 'baseSalary', 'status', 'employeeId', 'companyId', 'reason'] as $key) {
                $is($post($ceoToken, $path, '{"id":"' . $id . '","expectedVersion":1,"' . $key . '":"1"}'), 400, 'validation_failed', [$key], $path . ' ' . $key);
            }
            $is($post($ceoToken, $path, '{"id":"' . $id . '","expectedVersion":"1"}'), 400, 'validation_failed', ['expectedVersion'], $path . ' a string version');
            $is($post($ceoToken, $path, '{"id":"emp_1","expectedVersion":1}'), 400, 'validation_failed', ['id'], $path . ' not a plan id');
        }
    },
    'there is no commit, status, payment or payslip route' => static function () use ($post, $get, $ceoToken, $id): void {
        foreach (['/api/payroll-plans/commit', '/api/payroll-plans/status', '/api/payroll-plans/pay', '/api/payroll-plans/post', '/api/payroll-plans/update'] as $path) {
            assertSame(404, $post($ceoToken, $path, '{"id":"' . $id . '","expectedVersion":1}')->status, $path);
        }
        assertSame(404, $get($ceoToken, '/api/payslip', 'id=' . $id)->status, 'no payslip read');
    },
];
