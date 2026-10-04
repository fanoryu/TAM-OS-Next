<?php
declare(strict_types=1);

/*
 * BF-4c1 + BF-4c2 payroll routes through the real production route table and kernel, with a
 * session double and NO database: every refusal proven here — 401, origin and CSRF 403, an
 * Employee's 403 on every write and on the drift read, the required month, query and id 400s, every
 * identity, money or status key a 400, and the exact commit body (expectedTotal and idempotencyKey
 * grammars) — happens before any statement runs. A request that does reach the data layer answers
 * 503 here (no database is configured): that is how an Employee's plan reads (BF-4c2, their own
 * Committed plans) are shown NOT to be refused up front. The data paths, Policy and the state
 * machine are proven in tests/Db/Payroll*Test.php.
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
    '/api/payroll-plans/commit' => '{"id":"' . $id . '","expectedVersion":1,"expectedTotal":"100.00","idempotencyKey":"' . str_repeat('f', 32) . '"}',
];
$transitions = ['/api/payroll-plans/review', '/api/payroll-plans/approve', '/api/payroll-plans/return', '/api/payroll-plans/cancel'];
$commit = static fn (array $over = [], array $drop = []): string => json_encode(array_diff_key(
    $over + ['id' => $id, 'expectedVersion' => 1, 'expectedTotal' => '100.00', 'idempotencyKey' => str_repeat('f', 32)],
    array_flip($drop),
), JSON_THROW_ON_ERROR);

return [
    'no session: every payroll route is 401' => static function () use ($get, $post, $is, $writes, $id): void {
        $is($get(null, '/api/payroll-plans', 'month=2026-10'), 401, 'unauthenticated', null, 'month list');
        $is($get(null, '/api/payroll-plan', 'id=' . $id), 401, 'unauthenticated', null, 'detail');
        $is($get(null, '/api/payroll-plan/drift', 'id=' . $id), 401, 'unauthenticated', null, 'drift');
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
    // BF-4c2 authorized revision: an Employee's two plan reads now reach the data layer (their own
    // Committed plans, D-PAY-5 = A). Was: 403 on every read. Every write — commit included — and the
    // drift read stay 403 before any lookup (M16).
    'an Employee is 403 on every payroll write (commit included) and on the drift read, before any lookup; their plan reads are not refused up front (M12, M16)' => static function () use ($get, $post, $is, $writes, $empToken, $id): void {
        foreach ($writes as $path => $body) {
            $is($post($empToken, $path, $body), 403, 'forbidden', null, $path);
        }
        $is($get($empToken, '/api/payroll-plan/drift', 'id=' . $id), 403, 'forbidden', null, 'drift');
        $is($get($empToken, '/api/payroll-plans', 'month=2026-10'), 503, 'service_unavailable', null, 'month list: reaches the (absent) database');
        $is($get($empToken, '/api/payroll-plan', 'id=' . $id), 503, 'service_unavailable', null, 'detail: reaches the (absent) database');
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
    'transitions: exactly { id, expectedVersion } — a browser total, salary, status or employee is a 400 naming it' => static function () use ($post, $is, $ceoToken, $transitions, $id): void {
        foreach ($transitions as $path) {
            foreach (['expectedTotal', 'totalAmount', 'baseSalary', 'status', 'employeeId', 'companyId', 'reason'] as $key) {
                $is($post($ceoToken, $path, '{"id":"' . $id . '","expectedVersion":1,"' . $key . '":"1"}'), 400, 'validation_failed', [$key], $path . ' ' . $key);
            }
            $is($post($ceoToken, $path, '{"id":"' . $id . '","expectedVersion":"1"}'), 400, 'validation_failed', ['expectedVersion'], $path . ' a string version');
            $is($post($ceoToken, $path, '{"id":"emp_1","expectedVersion":1}'), 400, 'validation_failed', ['id'], $path . ' not a plan id');
        }
    },
    'commit: exactly { id, expectedVersion, expectedTotal, idempotencyKey } — every other key, a missing key and a non-canonical total or key is a 400 naming it (M13)' => static function () use ($post, $is, $ceoToken, $commit): void {
        foreach (['month', 'employeeId', 'companyId', 'company_id', 'role', 'status', 'salary', 'baseSalary', 'overtimeAmount', 'totalAmount', 'total', 'amount', 'paid', 'reason'] as $key) {
            $is($post($ceoToken, '/api/payroll-plans/commit', $commit([$key => '1'])), 400, 'validation_failed', [$key], 'commit ' . $key);
        }
        foreach (['id', 'expectedVersion', 'expectedTotal', 'idempotencyKey'] as $key) {
            $is($post($ceoToken, '/api/payroll-plans/commit', $commit([], [$key])), 400, 'validation_failed', [$key], 'missing ' . $key);
        }
        foreach (['0100.00', '100', '100.0', '100.000', '-1.00', '1.50', ' 100.00', '1e2', '100,00', ''] as $bad) {
            $is($post($ceoToken, '/api/payroll-plans/commit', $commit(['expectedTotal' => $bad])), 400, 'validation_failed', ['expectedTotal'], 'expectedTotal ' . $bad);
        }
        $is($post($ceoToken, '/api/payroll-plans/commit', $commit(['expectedTotal' => 100])), 400, 'validation_failed', ['expectedTotal'], 'a JSON number total');
        foreach ([str_repeat('F', 32), str_repeat('f', 31), str_repeat('f', 33), str_repeat('g', 32), '', str_repeat('f', 31) . ' '] as $bad) {
            $is($post($ceoToken, '/api/payroll-plans/commit', $commit(['idempotencyKey' => $bad])), 400, 'validation_failed', ['idempotencyKey'], 'key ' . $bad);
        }
        $is($post($ceoToken, '/api/payroll-plans/commit', $commit(['idempotencyKey' => 7])), 400, 'validation_failed', ['idempotencyKey'], 'a JSON number key');
        $is($post($ceoToken, '/api/payroll-plans/commit', $commit(['expectedVersion' => '1', 'expectedTotal' => '01.00', 'idempotencyKey' => 'x'])), 400, 'validation_failed', ['expectedVersion', 'expectedTotal', 'idempotencyKey'], 'every bad field named');
        foreach (['0.00', '100.00', '999999999999999.00'] as $ok) {
            $is($post($ceoToken, '/api/payroll-plans/commit', $commit(['expectedTotal' => $ok])), 503, 'service_unavailable', null, 'a canonical total ' . $ok . ' passes validation and reaches the data layer');
        }
    },
    'the drift read needs a server plan id and no other key; it is CEO-only (403 for an Employee, never a lookup)' => static function () use ($get, $is, $ceoToken): void {
        $is($get($ceoToken, '/api/payroll-plan/drift'), 400, 'validation_failed', ['id'], 'no id');
        $is($get($ceoToken, '/api/payroll-plan/drift', 'id=emp_1'), 400, 'validation_failed', ['id'], 'not a plan id');
        $is($get($ceoToken, '/api/payroll-plan/drift', 'id=x&employeeId=emp_1'), 400, 'invalid_query', null, 'unknown key');
    },
    // BF-4c2 authorized revision: POST /api/payroll-plans/commit exists. Was: no commit route.
    'there is no status, payment or payslip route' => static function () use ($post, $get, $ceoToken, $id): void {
        foreach (['/api/payroll-plans/status', '/api/payroll-plans/pay', '/api/payroll-plans/post', '/api/payroll-plans/update'] as $path) {
            assertSame(404, $post($ceoToken, $path, '{"id":"' . $id . '","expectedVersion":1}')->status, $path);
        }
        assertSame(404, $get($ceoToken, '/api/payslip', 'id=' . $id)->status, 'no payslip read');
    },
];
