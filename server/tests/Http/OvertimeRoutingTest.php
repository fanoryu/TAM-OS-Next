<?php
declare(strict_types=1);

/*
 * BF-4b1 overtime routes through the real production route table and kernel, with a session
 * double and NO database: every refusal proven here — 401, origin and CSRF 403, the required
 * month, query and id 400s, mass-assignment and money-key 400s — happens before any statement
 * runs. (Any route that reached the database would answer 500 here: none is configured.) The
 * data paths, Policy and the state machine are proven in tests/Db.
 *
 * BF-4b2: the valuation read and approve join the same gates — 401, CSRF and origin on approve,
 * the id and the approve allowlist (no salary, hours, rate, method, status or employee from a
 * browser; expectedAmount a whole-Rupiah string) — all before any statement runs.
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
    assertNoLeak($r->body, ['emp_1', str_repeat('3', 32), 'overtime_records', 'overtime.manage']);
};
$id = str_repeat('a', 32);
$create = '{"employeeId":"emp_1","monthKey":"2026-10","hours":"2.00"}';
$target = '{"id":"' . $id . '","expectedVersion":1}';
$writes = [
    '/api/overtime-records/create' => $create,
    '/api/overtime-records/update' => '{"id":"' . $id . '","expectedVersion":1,"hours":"1.00"}',
    '/api/overtime-records/delete' => $target,
    '/api/overtime-records/submit' => $target,
    '/api/overtime-records/review' => $target,
    '/api/overtime-records/reject' => $target,
    '/api/overtime-records/approve' => '{"id":"' . $id . '","expectedVersion":1,"expectedAmount":"218750.00"}',
];

return [
    'no session: every overtime route is 401' => static function () use ($get, $post, $is, $writes, $id): void {
        $is($get(null, '/api/overtime-records', 'month=2026-10'), 401, 'unauthenticated', null, 'month list');
        $is($get(null, '/api/overtime-record', 'id=' . $id), 401, 'unauthenticated', null, 'detail');
        $is($get(null, '/api/overtime-record/valuation', 'id=' . $id), 401, 'unauthenticated', null, 'valuation');
        foreach ($writes as $path => $body) {
            $is($post(null, $path, $body), 401, 'unauthenticated', null, $path);
        }
    },
    'every overtime write needs the session CSRF token and the canonical origin' => static function () use ($post, $is, $writes, $ceoToken, $empToken): void {
        foreach ($writes as $path => $body) {
            foreach ([$ceoToken, $empToken] as $who) {
                $is($post($who, $path, $body, null), 403, 'forbidden', null, $path . ' without csrf');
                $is($post($who, $path, $body, str_repeat('x', 43)), 403, 'forbidden', null, $path . ' wrong csrf');
                $is($post($who, $path, $body, 'session', ['origin' => 'https://evil.test']), 403, 'forbidden', null, $path . ' cross-origin');
            }
        }
    },
    'the collection requires ?month=YYYY-MM: there is no unfiltered list (D-BF4b1-3)' => static function () use ($get, $is, $ceoToken, $empToken): void {
        foreach ([$ceoToken, $empToken] as $who) {
            $is($get($who, '/api/overtime-records'), 400, 'invalid_query', null, 'no month');
            foreach (['month=', 'month=2026-13', 'month=2026-1', 'month=all', 'month=2026-10-01'] as $q) {
                $is($get($who, '/api/overtime-records', $q), 400, 'invalid_query', null, $q);
            }
            foreach (['employeeId=emp_1', 'status=Draft', 'month=2026-10&employeeId=emp_1', 'month=2026-10&month=2026-11', 'archived=1'] as $q) {
                $is($get($who, '/api/overtime-records', $q), 400, 'invalid_query', null, 'no other filter: ' . $q);
            }
        }
    },
    'the detail needs a server id' => static function () use ($get, $is, $ceoToken): void {
        $is($get($ceoToken, '/api/overtime-record'), 400, 'validation_failed', ['id'], 'no id');
        $is($get($ceoToken, '/api/overtime-record', 'id=emp_1'), 400, 'validation_failed', ['id'], 'an employee id is not an overtime id');
        $is($get($ceoToken, '/api/overtime-record', 'id=x&extra=1'), 400, 'invalid_query', null, 'unknown key');
    },
    'the valuation read needs a server id and no other key' => static function () use ($get, $is, $ceoToken, $empToken): void {
        foreach ([$ceoToken, $empToken] as $who) {
            $is($get($who, '/api/overtime-record/valuation'), 400, 'validation_failed', ['id'], 'no id');
            $is($get($who, '/api/overtime-record/valuation', 'id=emp_1'), 400, 'validation_failed', ['id'], 'not an overtime id');
            foreach (['id=x&salary=1', 'id=x&employeeId=emp_1', 'id=x&month=2026-10', 'id=x&id=y'] as $q) {
                $is($get($who, '/api/overtime-record/valuation', $q), 400, 'invalid_query', null, $q);
            }
        }
    },
    'approve: every valuation input from a browser is a 400 naming the key; expectedAmount is a required whole-Rupiah string' => static function () use ($post, $is, $ceoToken, $empToken, $id): void {
        $base = '"id":"' . $id . '","expectedVersion":1,"expectedAmount":"218750.00"';
        foreach ([$ceoToken, $empToken] as $who) {
            foreach (['salary', 'monthlySalaryBasis', 'hours', 'standardMonthlyHours', 'multiplier', 'method', 'valuationMethod', 'amount', 'approvedAmount', 'status', 'employeeId', 'company_id', 'currency'] as $key) {
                $is($post($who, '/api/overtime-records/approve', '{' . $base . ',"' . $key . '":"1"}'), 400, 'validation_failed', [$key], 'approve ' . $key);
            }
            $is($post($who, '/api/overtime-records/approve', '{"id":"' . $id . '","expectedVersion":1}'), 400, 'validation_failed', ['expectedAmount'], 'expectedAmount required');
            foreach (['218750', '218750.5', '"218750"', '"218750.50"', '"-1.00"', 'null'] as $bad) {
                $is($post($who, '/api/overtime-records/approve', '{"id":"' . $id . '","expectedVersion":1,"expectedAmount":' . $bad . '}'), 400, 'validation_failed', ['expectedAmount'], 'expectedAmount ' . $bad);
            }
        }
    },
    'mass assignment and money keys are 400 for the CEO and the Employee, before any lookup' => static function () use ($post, $is, $ceoToken, $empToken, $id): void {
        foreach ([$ceoToken, $empToken] as $who) {
            foreach (['company_id', 'status', 'version', 'approvedAmount', 'hourlyRate', 'contractId', 'payrollPlanId', 'project'] as $key) {
                $is($post($who, '/api/overtime-records/create', '{"employeeId":"emp_1","monthKey":"2026-10","hours":"2.00","' . $key . '":"x"}'), 400, 'validation_failed', [$key], 'create ' . $key);
            }
            $is($post($who, '/api/overtime-records/update', '{"id":"' . $id . '","expectedVersion":1,"employeeId":"emp_2"}'), 400, 'validation_failed', ['employeeId'], 'employeeId is immutable');
            $is($post($who, '/api/overtime-records/reject', '{"id":"' . $id . '","expectedVersion":1,"reason":"no"}'), 400, 'validation_failed', ['reason'], 'no reject reason');
            $is($post($who, '/api/overtime-records/submit', '{"id":"' . $id . '","expectedVersion":1,"status":"Reviewed"}'), 400, 'validation_failed', ['status'], 'no client status');
        }
    },
    'invalid values are 400 before any lookup: hours, month and date' => static function () use ($post, $is, $ceoToken): void {
        foreach (['"0.00"', '"7.5"', '"0.10"', '"744.25"', '7.5', '2'] as $hours) {
            $is($post($ceoToken, '/api/overtime-records/create', '{"employeeId":"emp_1","monthKey":"2026-10","hours":' . $hours . '}'), 400, 'validation_failed', ['hours'], 'hours ' . $hours);
        }
        $is($post($ceoToken, '/api/overtime-records/create', '{"employeeId":"emp_1","monthKey":"2026-10","overtimeDate":"2026-11-01","hours":"1.00"}'), 400, 'validation_failed', ['overtimeDate'], 'date outside the month');
        $is($post($ceoToken, '/api/overtime-records/create', '{"employeeId":"emp_1","monthKey":"Oct 2026","hours":"1.00"}'), 400, 'validation_failed', ['monthKey'], 'month');
        $is($post($ceoToken, '/api/overtime-records/submit', '{"id":"' . str_repeat('a', 32) . '","expectedVersion":"1"}'), 400, 'validation_failed', ['expectedVersion'], 'a string version');
    },
];
