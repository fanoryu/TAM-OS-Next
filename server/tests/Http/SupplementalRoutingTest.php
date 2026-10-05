<?php
declare(strict_types=1);

/*
 * BF-4d Supplemental Payroll routes through the real production route table and kernel, with a
 * session double and NO database: every refusal proven here — 401, origin and CSRF 403, an
 * Employee's 403 on every write and on the eligibility read (supplemental.manage is record-free,
 * so the kernel decides it before the handler and before any lookup), the required month, query
 * and id 400s, every identity, money, overtime or status key a 400, and the exact commit body —
 * happens before any statement runs. A request that does reach the data layer answers 503 here
 * (no database is configured): that is how an Employee's document reads (their own Committed
 * documents, D-SPAY-3 = A) are shown NOT to be refused up front. The data paths, Policy and the
 * state machine are proven in tests/Db/Supplemental*Test.php.
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
    assertNoLeak($r->body, ['emp_1', str_repeat('3', 32), 'supplemental_payrolls', 'supplemental.manage', 'action_denied']);
};
$id = str_repeat('a', 32);
$target = '{"id":"' . $id . '","expectedVersion":1}';
$writes = [
    '/api/supplemental-payrolls/generate' => '{"payrollPlanId":"' . $id . '"}',
    '/api/supplemental-payrolls/review' => $target,
    '/api/supplemental-payrolls/approve' => $target,
    '/api/supplemental-payrolls/return' => $target,
    '/api/supplemental-payrolls/cancel' => $target,
    '/api/supplemental-payrolls/commit' => '{"id":"' . $id . '","expectedVersion":1,"expectedTotal":"100.00","idempotencyKey":"' . str_repeat('f', 32) . '"}',
];
$transitions = ['/api/supplemental-payrolls/review', '/api/supplemental-payrolls/approve', '/api/supplemental-payrolls/return', '/api/supplemental-payrolls/cancel'];
$commit = static fn (array $over = [], array $drop = []): string => json_encode(array_diff_key(
    $over + ['id' => $id, 'expectedVersion' => 1, 'expectedTotal' => '100.00', 'idempotencyKey' => str_repeat('f', 32)],
    array_flip($drop),
), JSON_THROW_ON_ERROR);

return [
    'no session: every Supplemental route is 401' => static function () use ($get, $post, $is, $writes, $id): void {
        $is($get(null, '/api/supplemental-payrolls', 'month=2026-10'), 401, 'unauthenticated', null, 'month list');
        $is($get(null, '/api/supplemental-payroll', 'id=' . $id), 401, 'unauthenticated', null, 'detail');
        $is($get(null, '/api/supplemental-payrolls/eligibility', 'month=2026-10'), 401, 'unauthenticated', null, 'eligibility');
        foreach ($writes as $path => $body) {
            $is($post(null, $path, $body), 401, 'unauthenticated', null, $path);
        }
    },
    'every Supplemental write needs the session CSRF token and the canonical origin' => static function () use ($post, $is, $writes, $ceoToken, $empToken): void {
        foreach ($writes as $path => $body) {
            foreach ([$ceoToken, $empToken] as $who) {
                $is($post($who, $path, $body, null), 403, 'forbidden', null, $path . ' without csrf');
                $is($post($who, $path, $body, str_repeat('x', 43)), 403, 'forbidden', null, $path . ' wrong csrf');
                $is($post($who, $path, $body, 'session', ['origin' => 'https://evil.test']), 403, 'forbidden', null, $path . ' cross-origin');
            }
        }
    },
    'an Employee is 403 on every Supplemental write and on the eligibility read, before any lookup — whatever the body; their document reads are not refused up front (M27, M30)' => static function () use ($get, $post, $is, $writes, $empToken, $id): void {
        foreach ($writes as $path => $body) {
            $is($post($empToken, $path, $body), 403, 'forbidden', null, $path);
            $is($post($empToken, $path, '{"employeeId":"emp_1"}'), 403, 'forbidden', null, $path . ': the record-free Action is decided before the body');
        }
        $is($get($empToken, '/api/supplemental-payrolls/eligibility', 'month=2026-10'), 403, 'forbidden', null, 'eligibility');
        $is($get($empToken, '/api/supplemental-payrolls', 'month=2026-10'), 503, 'service_unavailable', null, 'month list: reaches the (absent) database');
        $is($get($empToken, '/api/supplemental-payroll', 'id=' . $id), 503, 'service_unavailable', null, 'detail: reaches the (absent) database');
    },
    'the collection and the eligibility read require ?month=YYYY-MM and nothing else' => static function () use ($get, $is, $ceoToken, $empToken): void {
        foreach (['/api/supplemental-payrolls' => [$ceoToken, $empToken], '/api/supplemental-payrolls/eligibility' => [$ceoToken]] as $path => $who) {
            foreach ($who as $token) {
                $is($get($token, $path), 400, 'invalid_query', null, $path . ' no month');
                foreach (['month=', 'month=2026-13', 'month=2026-1', 'month=all', 'month=2026-10-01'] as $q) {
                    $is($get($token, $path, $q), 400, 'invalid_query', null, $path . ' ' . $q);
                }
                foreach (['employeeId=emp_1', 'status=Draft', 'month=2026-10&employeeId=emp_1', 'month=2026-10&month=2026-11', 'month=2026-10&payrollPlanId=x'] as $q) {
                    $is($get($token, $path, $q), 400, 'invalid_query', null, $path . ' no other filter: ' . $q);
                }
            }
        }
    },
    'the detail needs a server document id and no other key' => static function () use ($get, $is, $ceoToken): void {
        $is($get($ceoToken, '/api/supplemental-payroll'), 400, 'validation_failed', ['id'], 'no id');
        $is($get($ceoToken, '/api/supplemental-payroll', 'id=emp_1'), 400, 'validation_failed', ['id'], 'an employee id is not a document id');
        $is($get($ceoToken, '/api/supplemental-payroll', 'id=x&employeeId=emp_1'), 400, 'invalid_query', null, 'unknown key');
    },
    'generate: exactly { payrollPlanId } — a browser amount, overtime id, employee, company, month, role or status is a 400 naming it' => static function () use ($post, $is, $ceoToken, $id): void {
        foreach (['month', 'salary', 'overtimeAmount', 'overtimeIds', 'overtimeHours', 'amount', 'employeeId', 'companyId', 'company_id', 'role', 'status', 'id', 'expectedVersion'] as $key) {
            $is($post($ceoToken, '/api/supplemental-payrolls/generate', '{"payrollPlanId":"' . $id . '","' . $key . '":"1"}'), 400, 'validation_failed', [$key], 'generate ' . $key);
        }
        foreach (['{}', '{"payrollPlanId":"emp_1"}', '{"payrollPlanId":null}', '{"payrollPlanId":7}', '{"payrollPlanId":"' . strtoupper($id) . '"}'] as $body) {
            $is($post($ceoToken, '/api/supplemental-payrolls/generate', $body), 400, 'validation_failed', ['payrollPlanId'], 'generate ' . $body);
        }
        $is($post($ceoToken, '/api/supplemental-payrolls/generate', '{"payrollPlanId":"' . $id . '"}'), 503, 'service_unavailable', null, 'a canonical plan id reaches the data layer');
    },
    'transitions: exactly { id, expectedVersion } — a browser total, amount, status or employee is a 400 naming it' => static function () use ($post, $is, $ceoToken, $transitions, $id): void {
        foreach ($transitions as $path) {
            foreach (['expectedTotal', 'overtimeAmount', 'status', 'employeeId', 'companyId', 'payrollPlanId', 'reason'] as $key) {
                $is($post($ceoToken, $path, '{"id":"' . $id . '","expectedVersion":1,"' . $key . '":"1"}'), 400, 'validation_failed', [$key], $path . ' ' . $key);
            }
            $is($post($ceoToken, $path, '{"id":"' . $id . '","expectedVersion":"1"}'), 400, 'validation_failed', ['expectedVersion'], $path . ' a string version');
            $is($post($ceoToken, $path, '{"id":"emp_1","expectedVersion":1}'), 400, 'validation_failed', ['id'], $path . ' not a document id');
        }
    },
    'commit: exactly { id, expectedVersion, expectedTotal, idempotencyKey } — every other key, a missing key and a non-canonical total or key is a 400 naming it (M21)' => static function () use ($post, $is, $ceoToken, $commit): void {
        foreach (['month', 'employeeId', 'companyId', 'payrollPlanId', 'role', 'status', 'overtimeAmount', 'totalAmount', 'amount', 'paid', 'reason'] as $key) {
            $is($post($ceoToken, '/api/supplemental-payrolls/commit', $commit([$key => '1'])), 400, 'validation_failed', [$key], 'commit ' . $key);
        }
        foreach (['id', 'expectedVersion', 'expectedTotal', 'idempotencyKey'] as $key) {
            $is($post($ceoToken, '/api/supplemental-payrolls/commit', $commit([], [$key])), 400, 'validation_failed', [$key], 'missing ' . $key);
        }
        foreach (['0100.00', '100', '100.0', '100.000', '-1.00', '1.50', ' 100.00', '1e2', '100,00', ''] as $bad) {
            $is($post($ceoToken, '/api/supplemental-payrolls/commit', $commit(['expectedTotal' => $bad])), 400, 'validation_failed', ['expectedTotal'], 'expectedTotal ' . $bad);
        }
        $is($post($ceoToken, '/api/supplemental-payrolls/commit', $commit(['expectedTotal' => 100])), 400, 'validation_failed', ['expectedTotal'], 'a JSON number total');
        $is($post($ceoToken, '/api/supplemental-payrolls/commit', $commit(['expectedTotal' => 100.0])), 400, 'validation_failed', ['expectedTotal'], 'a JSON float total');
        foreach ([str_repeat('F', 32), str_repeat('f', 31), str_repeat('f', 33), str_repeat('g', 32), ''] as $bad) {
            $is($post($ceoToken, '/api/supplemental-payrolls/commit', $commit(['idempotencyKey' => $bad])), 400, 'validation_failed', ['idempotencyKey'], 'key ' . $bad);
        }
        $is($post($ceoToken, '/api/supplemental-payrolls/commit', $commit(['expectedVersion' => '1', 'expectedTotal' => '01.00', 'idempotencyKey' => 'x'])), 400, 'validation_failed', ['expectedVersion', 'expectedTotal', 'idempotencyKey'], 'every bad field named');
        $is($post($ceoToken, '/api/supplemental-payrolls/commit', $commit()), 503, 'service_unavailable', null, 'a canonical body reaches the data layer');
    },
    'there is no status, payment, posting, execution or payslip Supplemental route' => static function () use ($post, $get, $ceoToken, $id): void {
        foreach (['/api/supplemental-payrolls/status', '/api/supplemental-payrolls/pay', '/api/supplemental-payrolls/post', '/api/supplemental-payrolls/execute', '/api/supplemental-payrolls/update', '/api/supplemental-payrolls/create', '/api/supplemental-payrolls/delete'] as $path) {
            assertSame(404, $post($ceoToken, $path, '{"id":"' . $id . '","expectedVersion":1}')->status, $path);
        }
        assertSame(404, $get($ceoToken, '/api/supplemental-payroll/drift', 'id=' . $id)->status, 'no supplemental drift read');
    },
];
