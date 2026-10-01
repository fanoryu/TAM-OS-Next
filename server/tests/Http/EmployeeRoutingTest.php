<?php
declare(strict_types=1);

/*
 * BF-4a1 Employee routes through the real production route table and kernel, with a session
 * double and NO database: every refusal proven here — 401, origin and CSRF 403, the Employee
 * list 403, a CEO-only create 403, scope and mass-assignment 400s, query 400s — happens before
 * any statement runs. (Any route that reached the database would answer 500 here: there is
 * no database configured.) The data paths themselves are proven in tests/Db.
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
    assertNoLeak($r->body, ['emp_1', str_repeat('3', 32), 'employee.create', 'employees']);
};
$valid = '{"employeeCode":"EMP-1","fullName":"Fabricated Person"}';

return [
    'no session: every Employee route is 401' => static function () use ($get, $post, $is, $valid): void {
        $is($get(null, '/api/employees'), 401, 'unauthenticated', null, 'list');
        $is($get(null, '/api/employee', 'id=emp_1'), 401, 'unauthenticated', null, 'read');
        foreach (['/api/employees/create' => $valid, '/api/employees/update' => '{"id":"emp_1","expectedVersion":1,"jobTitle":"x"}', '/api/employees/archive' => '{"id":"emp_1","expectedVersion":1}'] as $path => $body) {
            $is($post(null, $path, $body), 401, 'unauthenticated', null, $path);
        }
    },
    'an Employee cannot list the company (no enumeration surface)' => static function () use ($get, $is, $empToken): void {
        $is($get($empToken, '/api/employees'), 403, 'forbidden', null, 'employee list');
        $is($get($empToken, '/api/employees', 'archived=1'), 403, 'forbidden', null, 'employee list with archived');
    },
    'an Employee cannot create: employee.create is CeoOnly and decided by the kernel before the handler' => static function () use ($post, $is, $empToken, $valid): void {
        $is($post($empToken, '/api/employees/create', $valid), 403, 'forbidden', null, 'create');
    },
    'mutations need the session CSRF token and the canonical origin' => static function () use ($post, $is, $ceoToken, $valid): void {
        foreach ([null, str_repeat('x', 43)] as $wrong) {
            $is($post($ceoToken, '/api/employees/create', $valid, $wrong), 403, 'forbidden', null, 'csrf ' . var_export($wrong, true));
        }
        $is($post($ceoToken, '/api/employees/update', '{"id":"emp_1","expectedVersion":1,"jobTitle":"x"}', null), 403, 'forbidden', null, 'update without csrf');
        $is($post($ceoToken, '/api/employees/archive', '{"id":"emp_1","expectedVersion":1}', str_repeat('y', 43)), 403, 'forbidden', null, 'archive with a wrong csrf');
        $is($post($ceoToken, '/api/employees/create', $valid, 'session', ['origin' => 'https://evil.test']), 403, 'forbidden', null, 'cross-origin');
        $is($post($ceoToken, '/api/employees/create', $valid, 'session', ['origin' => null]), 403, 'forbidden', null, 'no origin, no referer');
    },
    'scope and mass assignment: forged scope fields and unknown keys are 400 naming the key' => static function () use ($post, $is, $ceoToken, $empToken): void {
        $is($post($ceoToken, '/api/employees/create', '{"employeeCode":"E","fullName":"N","company_id":"' . str_repeat('9', 32) . '"}'), 400, 'validation_failed', ['company_id'], 'forged company on create');
        $is($post($ceoToken, '/api/employees/create', '{"employeeCode":"E","fullName":"N","id":"emp_mine"}'), 400, 'validation_failed', ['id'], 'client id on create');
        $is($post($ceoToken, '/api/employees/create', '{"employeeCode":"E","fullName":"N","version":9}'), 400, 'validation_failed', ['version'], 'version on create');
        $is($post($ceoToken, '/api/employees/update', '{"id":"emp_1","expectedVersion":1,"employee_id":"emp_2"}'), 400, 'validation_failed', ['employee_id'], 'forged binding on update');
        $is($post($ceoToken, '/api/employees/update', '{"id":"emp_1","expectedVersion":1,"archived_at":null}'), 400, 'validation_failed', ['archived_at'], 'archive through update');
        $is($post($empToken, '/api/employees/update', '{"id":"emp_1","expectedVersion":1,"company_id":"x"}'), 400, 'validation_failed', ['company_id'], 'an Employee forging scope on its own record');
        $is($post($ceoToken, '/api/employees/archive', '{"id":"emp_1","expectedVersion":1,"hard":true}'), 400, 'validation_failed', ['hard'], 'extra key on archive');
    },
    'create validation: required fields and bad values are 400 before any statement' => static function () use ($post, $is, $ceoToken): void {
        $is($post($ceoToken, '/api/employees/create', '{}'), 400, 'validation_failed', ['employeeCode', 'fullName'], 'empty');
        $is($post($ceoToken, '/api/employees/create', '{"employeeCode":"E","fullName":"N","monthlyBaseSalary":1500.5}'), 400, 'validation_failed', ['monthlyBaseSalary'], 'float money');
        $is($post($ceoToken, '/api/employees/create', '{"employeeCode":"E","fullName":"N","employmentStatus":"Fired"}'), 400, 'validation_failed', ['employmentStatus'], 'status');
        $is($post($ceoToken, '/api/employees/create', '[1]'), 400, 'malformed_json', null, 'not an object');
    },
    'update and archive targets: id and expectedVersion are validated before the scoped load' => static function () use ($post, $is, $ceoToken): void {
        $is($post($ceoToken, '/api/employees/update', '{"id":"emp_1","jobTitle":"x"}'), 400, 'validation_failed', ['expectedVersion'], 'no version');
        $is($post($ceoToken, '/api/employees/update', '{"id":"../x","expectedVersion":1,"jobTitle":"x"}'), 400, 'validation_failed', ['id'], 'bad id');
        $is($post($ceoToken, '/api/employees/update', '{"id":"emp_1","expectedVersion":1}'), 400, 'validation_failed', ['employeeCode', 'fullName', 'jobTitle', 'department', 'employmentStatus', 'joinDate', 'contactEmail', 'phone', 'notes', 'monthlyBaseSalary'], 'no field');
        $is($post($ceoToken, '/api/employees/archive', '{"id":"emp_1","expectedVersion":"1"}'), 400, 'validation_failed', ['expectedVersion'], 'string version');
    },
    'reads: only the declared query keys, archived=1 only, a well-formed id' => static function () use ($get, $is, $ceoToken, $empToken): void {
        foreach (['company_id=' . str_repeat('9', 32), 'employee_id=emp_2', 'role=ceo', 'page=2'] as $q) {
            $is($get($ceoToken, '/api/employees', $q), 400, 'invalid_query', null, 'list ' . $q);
            $is($get($empToken, '/api/employee', 'id=emp_1&' . $q), 400, 'invalid_query', null, 'read + ' . $q);
        }
        foreach (['archived=0', 'archived=true', 'archived='] as $q) {
            $is($get($ceoToken, '/api/employees', $q), 400, 'invalid_query', null, $q);
        }
        $is($get($ceoToken, '/api/employee'), 400, 'validation_failed', ['id'], 'no id');
        $is($get($empToken, '/api/employee', 'id=a%20b'), 400, 'validation_failed', ['id'], 'malformed id');
    },
];
