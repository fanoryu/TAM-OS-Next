<?php
declare(strict_types=1);

/*
 * BF-4g CEO audit read routes through the real production route table and kernel, with a session
 * double and NO database: every refusal proven here — 401, an Employee's 403 on both reads (by the
 * handler, before any lookup; no Action is declared), the exact query keys (an unknown, repeated or
 * scope-forging key is a 400 from the kernel), an invalid month, entity or id a 400 — happens before
 * any statement runs. A request that does reach the data layer answers 503 here (no database is
 * configured). There is no audit write, correction, deletion or export route and no authentication
 * log route. The data paths are proven in tests/Db/Audit*Test.php.
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
$post = static fn (?string $token, string $path, string $body): Response => $k()->handle(sessionRequest('POST', $path, $token, $csrf, $body), requestId());
$is = static function (Response $r, int $status, string $code, ?array $fields, string $label): void {
    $e = envelope($r);
    assertSame([$status, $code, $fields], [$r->status, $e['error']['code'] ?? null, $e['error']['fields'] ?? null], $label);
    assertApiHeaders($r, requestId());
    assertNoLeak($r->body, ['emp_1', str_repeat('3', 32), 'audit_events', 'auth_events', 'action_denied', 'audit_list_cap']);
};
$hex = str_repeat('a', 32);

return [
    'no session: both audit reads are 401' => static function () use ($get, $is): void {
        $is($get(null, '/api/audit-events', 'month=2026-10'), 401, 'unauthenticated', null, 'month');
        $is($get(null, '/api/audit-events/record', 'entity=employee&id=emp_1'), 401, 'unauthenticated', null, 'record');
        $is($get(str_repeat('X', 43), '/api/audit-events', 'month=2026-10'), 401, 'unauthenticated', null, 'an unknown session');
    },
    'an Employee is 403 on both reads, before any lookup — even for their own employee record (CEO only, no new Action)' => static function () use ($get, $is, $empToken, $hex): void {
        $is($get($empToken, '/api/audit-events', 'month=2026-10'), 403, 'forbidden', null, 'month');
        $is($get($empToken, '/api/audit-events/record', 'entity=employee&id=emp_1'), 403, 'forbidden', null, 'own employee record');
        $is($get($empToken, '/api/audit-events/record', 'entity=overtime&id=' . $hex), 403, 'forbidden', null, 'an overtime record');
    },
    'the month read requires ?month=YYYY-MM and nothing else' => static function () use ($get, $is, $ceoToken): void {
        $is($get($ceoToken, '/api/audit-events'), 400, 'invalid_query', null, 'no month');
        foreach (['month=', 'month=2026-13', 'month=2026-1', 'month=all', 'month=2026-10-01', 'month=2026-10%0A', 'month=%202026-10'] as $q) {
            $is($get($ceoToken, '/api/audit-events', $q), 400, 'invalid_query', null, $q);
        }
        foreach (['company_id=' . str_repeat('9', 32), 'companyId=x', 'month=2026-10&companyId=' . str_repeat('9', 32), 'month=2026-10&month=2026-11', 'month=2026-10&entity=employee',
            'month=2026-10&from=2026-10-01', 'month=2026-10&limit=5000', 'month=2026-10&timezone=UTC', 'month=2026-10&employeeId=emp_1', 'month=2026-10&role=ceo', 'month=2026-10&event=login_success'] as $q) {
            $is($get($ceoToken, '/api/audit-events', $q), 400, 'invalid_query', null, 'no other key: ' . $q);
        }
        $is($get($ceoToken, '/api/audit-events', 'month=2026-10'), 503, 'service_unavailable', null, 'a canonical month reaches the data layer');
    },
    'the record read requires ?entity=&id= and nothing else; an invalid entity or id is a 400 naming it' => static function () use ($get, $is, $ceoToken, $hex): void {
        $path = '/api/audit-events/record';
        foreach (['', 'id=emp_1', 'entity=employee&id=emp_1&month=2026-10', 'entity=employee&entity=overtime&id=emp_1', 'entity=employee&id=emp_1&id=emp_2',
            'entity=employee&id=emp_1&companyId=' . str_repeat('9', 32), 'entity=employee&id=emp_1&company_id=x'] as $q) {
            $status = $q === '' || $q === 'id=emp_1' ? null : 'invalid_query';
            if ($status === null) {
                $is($get($ceoToken, $path, $q), 400, 'validation_failed', ['entity'], 'missing entity: ' . $q);
            } else {
                $is($get($ceoToken, $path, $q), 400, 'invalid_query', null, 'no other or repeated key: ' . $q);
            }
        }
        $is($get($ceoToken, $path, 'entity=employee'), 400, 'validation_failed', ['id'], 'missing id');
        foreach (['entity=auth&id=x', 'entity=authEvent&id=x', 'entity=auth_events&id=1', 'entity=user&id=' . $hex, 'entity=Employee&id=emp_1', 'entity=&id=emp_1', 'entity=financeExecution&id=' . $hex] as $q) {
            $is($get($ceoToken, $path, $q), 400, 'validation_failed', ['entity'], $q);
        }
        foreach (['entity=employee&id=', 'entity=employee&id=a%20b', 'entity=employee&id=' . str_repeat('x', 65), 'entity=overtime&id=emp_1', 'entity=payrollPlan&id=' . strtoupper($hex),
            'entity=financePosting&id=' . $hex . '%0A', 'entity=supplementalPayroll&id=' . substr($hex, 1)] as $q) {
            $is($get($ceoToken, $path, $q), 400, 'validation_failed', ['id'], $q);
        }
        foreach (['entity=employee&id=emp_1', 'entity=overtime&id=' . $hex, 'entity=payrollPlan&id=' . $hex, 'entity=supplementalPayroll&id=' . $hex, 'entity=financePosting&id=' . $hex] as $q) {
            $is($get($ceoToken, $path, $q), 503, 'service_unavailable', null, 'a valid record query reaches the data layer: ' . $q);
        }
    },
    'reads only: no audit write, correction, deletion, export or authentication-log route' => static function () use ($get, $post, $ceoToken, $hex): void {
        assertSame(405, $post($ceoToken, '/api/audit-events', '{"month":"2026-10"}')->status, 'the month read is GET only');
        assertSame(405, $post($ceoToken, '/api/audit-events/record', '{"entity":"employee","id":"emp_1"}')->status, 'the record read is GET only');
        foreach (['/api/audit-events/create', '/api/audit-events/append', '/api/audit-events/update', '/api/audit-events/delete', '/api/audit-events/purge', '/api/audit-events/correct',
            '/api/audit-events/export', '/api/audit-events/restore', '/api/audit-event', '/api/auth-events', '/api/auth/events', '/api/audit', '/api/activity-log'] as $p) {
            assertSame(404, $post($ceoToken, $p, '{"id":"' . $hex . '"}')->status, 'POST ' . $p);
            assertSame(404, $get($ceoToken, $p, 'month=2026-10')->status, 'GET ' . $p);
        }
        assertSame(404, $get($ceoToken, '/api/audit-events/' . $hex)->status, 'no path-parameter read');
    },
];
