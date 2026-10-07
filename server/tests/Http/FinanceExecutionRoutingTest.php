<?php
declare(strict_types=1);

/*
 * BF-4f Finance execution routes through the real production route table and kernel, with a session
 * double and NO database: every refusal proven here — 401, origin and CSRF 403, an Employee's 403 on
 * the command (refused by the kernel before the body: finance.execute is record-free) and on the
 * month read (by the handler before any lookup), the required month and the exact command body
 * (every identity, money, month, status, account, bank, reference or note key a 400; a future date
 * and an unknown payment method a 400) — happens before any statement runs. A request that does
 * reach the data layer answers 503 here (no database is configured). The data paths are proven in
 * tests/Db/FinanceExecution*Test.php.
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
    assertNoLeak($r->body, ['emp_1', str_repeat('3', 32), 'finance_executions', 'finance.execute', 'action_denied', '3521875.00', 'bankTransfer', '2026-10-01']);
};
$path = '/api/finance-executions/execute';
$body = static fn (array $over = [], array $drop = []): string => json_encode(array_diff_key(
    $over + ['financePostingId' => str_repeat('a', 32), 'expectedAmount' => '3521875.00', 'executedOn' => '2026-10-01', 'paymentMethod' => 'bankTransfer', 'idempotencyKey' => str_repeat('f', 32)],
    array_flip($drop),
), JSON_THROW_ON_ERROR);

return [
    'no session: both Finance execution routes are 401' => static function () use ($get, $post, $is, $path, $body): void {
        $is($get(null, '/api/finance-executions', 'month=2026-10'), 401, 'unauthenticated', null, 'month list');
        $is($post(null, $path, $body()), 401, 'unauthenticated', null, 'execute');
    },
    'the command needs the session CSRF token and the canonical origin' => static function () use ($post, $is, $path, $body, $ceoToken, $empToken): void {
        foreach ([$ceoToken, $empToken] as $who) {
            $is($post($who, $path, $body(), null), 403, 'forbidden', null, 'without csrf');
            $is($post($who, $path, $body(), str_repeat('x', 43)), 403, 'forbidden', null, 'wrong csrf');
            $is($post($who, $path, $body(), 'session', ['origin' => 'https://evil.test']), 403, 'forbidden', null, 'cross-origin');
        }
    },
    'an Employee is 403 on the command whatever the body (finance.execute is record-free, decided by the kernel) and on the month read, before any lookup (D-FEX-4 = A)' => static function () use ($get, $post, $is, $path, $body, $empToken): void {
        $is($post($empToken, $path, $body()), 403, 'forbidden', null, 'execute');
        $is($post($empToken, $path, '{"employeeId":"emp_1"}'), 403, 'forbidden', null, 'the record-free Action is decided before the body');
        $is($get($empToken, '/api/finance-executions', 'month=2026-10'), 403, 'forbidden', null, 'month list: CEO only');
    },
    'the month read requires ?month=YYYY-MM and nothing else' => static function () use ($get, $is, $ceoToken): void {
        $is($get($ceoToken, '/api/finance-executions'), 400, 'invalid_query', null, 'no month');
        foreach (['month=', 'month=2026-13', 'month=2026-1', 'month=all', 'month=2026-10-01'] as $q) {
            $is($get($ceoToken, '/api/finance-executions', $q), 400, 'invalid_query', null, $q);
        }
        foreach (['employeeId=emp_1', 'financePostingId=' . str_repeat('a', 32), 'month=2026-10&employeeId=emp_1', 'month=2026-10&month=2026-11', 'month=2026-10&paymentMethod=cash'] as $q) {
            $is($get($ceoToken, '/api/finance-executions', $q), 400, 'invalid_query', null, 'no other filter: ' . $q);
        }
        $is($get($ceoToken, '/api/finance-executions', 'month=2026-10'), 503, 'service_unavailable', null, 'a canonical month reaches the data layer');
    },
    'the command takes exactly { financePostingId, expectedAmount, executedOn, paymentMethod, idempotencyKey } — every other key, a missing key and a non-canonical value is a 400 naming it' => static function () use ($post, $is, $path, $body, $ceoToken): void {
        foreach (['companyId', 'company_id', 'employeeId', 'role', 'month', 'monthKey', 'amount', 'actualAmount', 'status', 'sourceKind', 'sourceId', 'id', 'expectedVersion',
            'companyAccountId', 'accountId', 'bank', 'bankAccount', 'reference', 'notes', 'category', 'executedAt', 'paidAt', 'partial', 'reason', 'payrollPlanId'] as $key) {
            $is($post($ceoToken, $path, $body([$key => '1'])), 400, 'validation_failed', [$key], $key);
        }
        foreach (['financePostingId', 'expectedAmount', 'executedOn', 'paymentMethod', 'idempotencyKey'] as $key) {
            $is($post($ceoToken, $path, $body([], [$key])), 400, 'validation_failed', [$key], 'missing ' . $key);
        }
        foreach (['03521875.00', '3521875', '3521875.0', '-1.00', '1.50', ' 1.00', '1e2', '1,00', ''] as $bad) {
            $is($post($ceoToken, $path, $body(['expectedAmount' => $bad])), 400, 'validation_failed', ['expectedAmount'], 'amount ' . $bad);
        }
        $is($post($ceoToken, $path, $body(['expectedAmount' => 3521875])), 400, 'validation_failed', ['expectedAmount'], 'a JSON number amount');
        foreach (['2026-02-29', '2026-10-1', '2026/10/01', '2026-10-01T00:00:00Z', '', '9999-12-31'] as $bad) {
            $is($post($ceoToken, $path, $body(['executedOn' => $bad])), 400, 'validation_failed', ['executedOn'], 'date ' . $bad);
        }
        $future = (new \DateTimeImmutable('now', new \DateTimeZone('Asia/Jakarta')))->modify('+2 days')->format('Y-m-d');
        $is($post($ceoToken, $path, $body(['executedOn' => $future])), 400, 'validation_failed', ['executedOn'], 'a date after today in the company calendar');
        foreach (['Bank Transfer', 'Cash', 'cheque', ''] as $bad) {
            $is($post($ceoToken, $path, $body(['paymentMethod' => $bad])), 400, 'validation_failed', ['paymentMethod'], 'method ' . $bad);
        }
        foreach ([str_repeat('F', 32), str_repeat('f', 31), str_repeat('g', 32), ''] as $bad) {
            $is($post($ceoToken, $path, $body(['idempotencyKey' => $bad])), 400, 'validation_failed', ['idempotencyKey'], 'key ' . $bad);
        }
        $is($post($ceoToken, $path, $body(['financePostingId' => 'emp_1'])), 400, 'validation_failed', ['financePostingId'], 'not a server id');
        $today = (new \DateTimeImmutable('now', new \DateTimeZone('Asia/Jakarta')))->format('Y-m-d');
        $is($post($ceoToken, $path, $body(['executedOn' => $today])), 503, 'service_unavailable', null, 'today in the company calendar reaches the data layer');
        $is($post($ceoToken, $path, $body(['executedOn' => '1999-12-31', 'paymentMethod' => 'other'])), 503, 'service_unavailable', null, 'no lower bound on the date');
    },
    'there is no batch, automatic, partial, reversal, correction, reconciliation or single-execution route; the posting routes are unchanged' => static function () use ($post, $get, $ceoToken): void {
        $id = str_repeat('a', 32);
        foreach (['/api/finance-executions/batch', '/api/finance-executions/execute-all', '/api/finance-executions/auto', '/api/finance-executions/partial', '/api/finance-executions/reverse',
            '/api/finance-executions/void', '/api/finance-executions/correct', '/api/finance-executions/update', '/api/finance-executions/delete', '/api/finance-executions/reconcile',
            '/api/finance-executions/settle', '/api/finance-executions/refund', '/api/finance-executions', '/api/finance-postings/execute', '/api/finance-postings/pay'] as $p) {
            assertSame($p === '/api/finance-executions' ? 405 : 404, $post($ceoToken, $p, '{"id":"' . $id . '"}')->status, $p);
        }
        assertSame(405, $get($ceoToken, '/api/finance-executions/execute', 'month=2026-10')->status, 'the command is a POST only');
        assertSame(404, $get($ceoToken, '/api/finance-execution', 'id=' . $id)->status, 'no single execution read');
        assertSame(503, $get($ceoToken, '/api/finance-postings', 'month=2026-10')->status, 'the posting month read is unchanged');
    },
];
