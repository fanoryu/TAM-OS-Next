<?php
declare(strict_types=1);

/*
 * BF-4e Finance posting routes through the real production route table and kernel, with a session
 * double and NO database: every refusal proven here — 401, origin and CSRF 403, an Employee's 403 on
 * both postings and on the month read (the Supplemental posting is refused by the kernel before the
 * body, the base plan posting and the month read by the handler before any lookup), the required
 * month and the exact posting bodies (every identity, money, month, status, account or category key a
 * 400) — happens before any statement runs. A request that does reach the data layer answers 503
 * here (no database is configured). The data paths are proven in tests/Db/FinancePosting*Test.php.
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
    assertNoLeak($r->body, ['emp_1', str_repeat('3', 32), 'finance_postings', 'payroll.manage', 'supplemental.manage', 'action_denied']);
};
$id = str_repeat('a', 32);
$key = str_repeat('f', 32);
$body = static fn (string $source, array $over = [], array $drop = []): string => json_encode(array_diff_key(
    $over + [$source => $id, 'expectedAmount' => '3521875.00', 'idempotencyKey' => $key],
    array_flip($drop),
), JSON_THROW_ON_ERROR);
$writes = [
    '/api/finance-postings/payroll-plan' => 'payrollPlanId',
    '/api/finance-postings/supplemental-payroll' => 'supplementalPayrollId',
];

return [
    'no session: every Finance posting route is 401' => static function () use ($get, $post, $is, $writes, $body): void {
        $is($get(null, '/api/finance-postings', 'month=2026-10'), 401, 'unauthenticated', null, 'month list');
        foreach ($writes as $path => $source) {
            $is($post(null, $path, $body($source)), 401, 'unauthenticated', null, $path);
        }
    },
    'every posting needs the session CSRF token and the canonical origin' => static function () use ($post, $is, $writes, $body, $ceoToken, $empToken): void {
        foreach ($writes as $path => $source) {
            foreach ([$ceoToken, $empToken] as $who) {
                $is($post($who, $path, $body($source), null), 403, 'forbidden', null, $path . ' without csrf');
                $is($post($who, $path, $body($source), str_repeat('x', 43)), 403, 'forbidden', null, $path . ' wrong csrf');
                $is($post($who, $path, $body($source), 'session', ['origin' => 'https://evil.test']), 403, 'forbidden', null, $path . ' cross-origin');
            }
        }
    },
    'an Employee is 403 on both postings and on the month read, before any lookup (D-FIN-4 = A); the Supplemental posting is refused by the kernel whatever the body' => static function () use ($get, $post, $is, $writes, $body, $empToken): void {
        foreach ($writes as $path => $source) {
            $is($post($empToken, $path, $body($source)), 403, 'forbidden', null, $path);
        }
        $is($post($empToken, '/api/finance-postings/supplemental-payroll', '{"employeeId":"emp_1"}'), 403, 'forbidden', null, 'the record-free Action is decided before the body');
        $is($get($empToken, '/api/finance-postings', 'month=2026-10'), 403, 'forbidden', null, 'month list: CEO only');
    },
    'the month read requires ?month=YYYY-MM and nothing else' => static function () use ($get, $is, $ceoToken): void {
        $is($get($ceoToken, '/api/finance-postings'), 400, 'invalid_query', null, 'no month');
        foreach (['month=', 'month=2026-13', 'month=2026-1', 'month=all', 'month=2026-10-01'] as $q) {
            $is($get($ceoToken, '/api/finance-postings', $q), 400, 'invalid_query', null, $q);
        }
        foreach (['employeeId=emp_1', 'status=Planned', 'month=2026-10&employeeId=emp_1', 'month=2026-10&month=2026-11', 'month=2026-10&sourceKind=payrollPlan'] as $q) {
            $is($get($ceoToken, '/api/finance-postings', $q), 400, 'invalid_query', null, 'no other filter: ' . $q);
        }
        $is($get($ceoToken, '/api/finance-postings', 'month=2026-10'), 503, 'service_unavailable', null, 'a canonical month reaches the data layer');
    },
    'the postings take exactly { <source id>, expectedAmount, idempotencyKey } — every other key, a missing key and a non-canonical amount or key is a 400 naming it' => static function () use ($post, $is, $writes, $body, $ceoToken): void {
        foreach ($writes as $path => $source) {
            foreach (['companyId', 'company_id', 'employeeId', 'role', 'month', 'monthKey', 'amount', 'totalAmount', 'overtimeAmount', 'status', 'sourceKind', 'sourceId',
                'id', 'expectedVersion', 'companyAccountId', 'category', 'actual', 'executedAt', 'paid', 'reason'] as $k) {
                $is($post($ceoToken, $path, $body($source, [$k => '1'])), 400, 'validation_failed', [$k], $path . ' ' . $k);
            }
            $other = $source === 'payrollPlanId' ? 'supplementalPayrollId' : 'payrollPlanId';
            $is($post($ceoToken, $path, $body($source, [$other => str_repeat('b', 32)])), 400, 'validation_failed', [$other], $path . ': the other source kind is not accepted');
            foreach ([$source, 'expectedAmount', 'idempotencyKey'] as $k) {
                $is($post($ceoToken, $path, $body($source, [], [$k])), 400, 'validation_failed', [$k], $path . ' missing ' . $k);
            }
            foreach (['03521875.00', '3521875', '3521875.0', '-1.00', '1.50', ' 1.00', '1e2', '1,00', ''] as $bad) {
                $is($post($ceoToken, $path, $body($source, ['expectedAmount' => $bad])), 400, 'validation_failed', ['expectedAmount'], $path . ' amount ' . $bad);
            }
            $is($post($ceoToken, $path, $body($source, ['expectedAmount' => 3521875])), 400, 'validation_failed', ['expectedAmount'], $path . ' a JSON number amount');
            foreach ([str_repeat('F', 32), str_repeat('f', 31), str_repeat('g', 32), ''] as $bad) {
                $is($post($ceoToken, $path, $body($source, ['idempotencyKey' => $bad])), 400, 'validation_failed', ['idempotencyKey'], $path . ' key ' . $bad);
            }
            $is($post($ceoToken, $path, $body($source, [$source => 'emp_1'])), 400, 'validation_failed', [$source], $path . ' not a server id');
            $is($post($ceoToken, $path, $body($source)), 503, 'service_unavailable', null, $path . ': a canonical body reaches the data layer');
        }
    },
    'there is no execution, payment, actual, reversal, correction or generic Finance route' => static function () use ($post, $get, $ceoToken, $id): void {
        foreach (['/api/finance-postings/execute', '/api/finance-postings/pay', '/api/finance-postings/actual', '/api/finance-postings/reverse', '/api/finance-postings/void',
            '/api/finance-postings/correct', '/api/finance-postings/update', '/api/finance-postings/delete', '/api/finance-postings/create',
            '/api/finance-transactions/create', '/api/payroll-plans/post', '/api/supplemental-payrolls/post'] as $path) {
            assertSame(404, $post($ceoToken, $path, '{"id":"' . $id . '"}')->status, $path);
        }
        assertSame(405, $post($ceoToken, '/api/finance-postings', '{}')->status, 'the month read is a read only');
        assertSame(404, $get($ceoToken, '/api/finance-posting', 'id=' . $id)->status, 'no single posting read');
        assertSame(404, $get($ceoToken, '/api/finance-transactions', 'month=2026-10')->status, 'no Finance transaction read');
    },
];
