<?php
declare(strict_types=1);

/*
 * BF-4g hostile principals against the CEO audit read, end to end on MariaDB: real login → real
 * session → SessionPrincipalResolver → production routes → AuditService → ScopedDatabase. Proven:
 * an Employee is 403 on both reads whatever they ask for (their own record included) and never sees
 * a row; a CEO of another company sees none of company A — its record answers are byte-identical to
 * an unknown record's (no existence oracle) — and forged scope keys are 400; a revoked, unknown or
 * disabled identity is 401; and the scoped layer refuses a foreign row even from a statement that
 * forgets its company predicate, so no read can be widened below the service either.
 */

use TamOs\Data\Audit\AuditEventStore;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Http\Kernel;
use TamOs\Http\Response;
use TamOs\Identity\Principal;
use TamOs\Policy\Scope;
use function TamOs\Tests\assertNoLeak;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\authKernel;
use function TamOs\Tests\envelope;
use function TamOs\Tests\loginRequest;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\requestId;
use function TamOs\Tests\sessionCookieToken;
use function TamOs\Tests\sessionRequest;
use function TamOs\Tests\testDbConfig;

/**
 * Company A: a CEO, e_a1 (an Employee login) and audit rows about e_a1, an overtime record and a plan.
 * Company B: a CEO, e_b1 (an Employee login).
 *
 * @return array{db: Database, k: Kernel, a: string, b: string, ot: string, f: array<string, array<string, mixed>>, s: array<string, array{token: string, csrf: string}>}
 */
$world = static function (): array {
    $db = authDatabase();
    $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
    $ceoA = authFixture($db);
    $ceoB = authFixture($db);
    $f = ['ceoA' => $ceoA, 'empA1' => authFixture($db, ['companyId' => $ceoA['companyId'], 'role' => 'employee', 'employeeId' => 'e_a1']),
        'ceoB' => $ceoB, 'empB1' => authFixture($db, ['companyId' => $ceoB['companyId'], 'role' => 'employee', 'employeeId' => 'e_b1'])];
    $ot = bin2hex(random_bytes(16));
    // Test-only SQL: company A's history (fabricated identifiers only).
    foreach ([['employee.update', 'employee', 'e_a1', null, 'fullName'], ['overtime.createSelfDraft', 'overtime', $ot, null, 'hours'], ['payroll.manage', 'payrollPlan', $ot, 'create', null]] as $i => [$action, $entity, $id, $op, $fields]) {
        $actor = $entity === 'overtime' ? $f['empA1'] : $ceoA;
        $db->execute('INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)',
            [$ceoA['companyId'], '2026-10-0' . ($i + 1) . ' 00:00:00.000000', $actor['userId'], $actor['membershipId'], $action, $entity, $id, $op, bin2hex(random_bytes(16)), $fields]);
    }
    $s = [];
    foreach ($f as $name => $x) {
        $r = $k->handle(loginRequest($x['email'], (string) $x['password']), requestId());
        assertSame(200, $r->status, 'login ' . $name);
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken']];
    }
    return ['db' => $db, 'k' => $k, 'a' => $ceoA['companyId'], 'b' => $ceoB['companyId'], 'ot' => $ot, 'f' => $f, 's' => $s];
};
$get = static fn (array $w, ?string $token, string $path, string $query): Response
    => $w['k']->handle(sessionRequest('GET', $path, $token, null, '', ['query' => $query]), requestId());
$status = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
$reads = static fn (array $w): array => [
    ['/api/audit-events', 'month=2026-10'],
    ['/api/audit-events/record', 'entity=employee&id=e_a1'],
    ['/api/audit-events/record', 'entity=overtime&id=' . $w['ot']],
    ['/api/audit-events/record', 'entity=payrollPlan&id=' . $w['ot']],
];

return [
    'the CEO of company A reads its history (the baseline every refusal below is measured against)' => static function () use ($world, $get, $reads): void {
        $w = $world();
        foreach ($reads($w) as [$path, $q]) {
            $r = $get($w, $w['s']['ceoA']['token'], $path, $q);
            assertSame(200, $r->status, $q);
            assertSame($q === 'month=2026-10' ? 3 : 1, count(envelope($r)['data']['auditEvents']), $q);
        }
    },
    'an Employee is 403 on every audit read — their own employee record and their own overtime included — and sees no row' => static function () use ($world, $get, $status, $reads): void {
        $w = $world();
        foreach (['empA1', 'empB1'] as $who) {
            foreach ($reads($w) as [$path, $q]) {
                $r = $get($w, $w['s'][$who]['token'], $path, $q);
                assertSame([403, 'forbidden'], $status($r), $who . ' ' . $q);
                assertNoLeak($r->body, ['auditEvents', 'e_a1', $w['ot'], $w['a'], 'fullName']);
            }
        }
    },
    'the CEO of company B sees nothing of company A; its record answers equal an unknown record\'s, byte for byte' => static function () use ($world, $get, $reads): void {
        $w = $world();
        foreach ($reads($w) as [$path, $q]) {
            $r = $get($w, $w['s']['ceoB']['token'], $path, $q);
            assertSame([200, []], [$r->status, envelope($r)['data']['auditEvents']], $q);
            assertNoLeak($r->body, [$w['a'], $w['ot'], $w['f']['ceoA']['userId']]);
        }
        $known = $get($w, $w['s']['ceoB']['token'], '/api/audit-events/record', 'entity=overtime&id=' . $w['ot'])->body;
        $unknown = $get($w, $w['s']['ceoB']['token'], '/api/audit-events/record', 'entity=overtime&id=' . bin2hex(random_bytes(16)))->body;
        assertSame($unknown, $known, 'no existence oracle across companies');
    },
    'forged scope keys are 400 and never widen a read' => static function () use ($world, $get, $status): void {
        $w = $world();
        foreach (['month=2026-10&company_id=' . $w['a'], 'month=2026-10&companyId=' . $w['a'], 'month=2026-10&employee_id=e_a1', 'month=2026-10&role=ceo', 'month=2026-10&scope=all',
            'month=2026-10&month=2026-11'] as $q) {
            assertSame([400, 'invalid_query'], $status($get($w, $w['s']['ceoB']['token'], '/api/audit-events', $q)), $q);
        }
        foreach (['entity=employee&id=e_a1&company_id=' . $w['a'], 'entity=employee&id=e_a1&companyId=' . $w['a']] as $q) {
            assertSame([400, 'invalid_query'], $status($get($w, $w['s']['ceoB']['token'], '/api/audit-events/record', $q)), $q);
        }
        assertSame([403, 'forbidden'], $status($get($w, $w['s']['empA1']['token'], '/api/audit-events', 'month=2026-10')), 'and the Employee stays 403');
    },
    '401: no session, an unknown token, a logged-out session and a disabled CEO' => static function () use ($world, $get, $status): void {
        $w = $world();
        assertSame([401, 'unauthenticated'], $status($get($w, null, '/api/audit-events', 'month=2026-10')), 'no session');
        assertSame([401, 'unauthenticated'], $status($get($w, str_repeat('Z', 43), '/api/audit-events', 'month=2026-10')), 'unknown token');
        $out = $w['k']->handle(sessionRequest('POST', '/api/auth/logout', $w['s']['ceoA']['token'], $w['s']['ceoA']['csrf'], '{}'), requestId());
        assertSame(true, in_array($out->status, [200, 204], true), 'logout');
        assertSame([401, 'unauthenticated'], $status($get($w, $w['s']['ceoA']['token'], '/api/audit-events/record', 'entity=employee&id=e_a1')), 'a logged-out session');
        $w['db']->execute("UPDATE users SET status = 'disabled' WHERE id = ?", [$w['f']['ceoB']['userId']]);
        assertSame([401, 'unauthenticated'], $status($get($w, $w['s']['ceoB']['token'], '/api/audit-events', 'month=2026-10')), 'a disabled CEO');
    },
    'below the service: the store refuses an Employee scope, and the scoped layer refuses a foreign row even from a predicate-less statement' => static function () use ($world): void {
        $w = $world();
        $scoped = new ScopedDatabase($w['db']);
        $store = new AuditEventStore($scoped);
        $principal = static fn (array $x, string $role, ?string $employeeId): Principal => Principal::fromAccount(
            ['user_id' => $x['userId'], 'user_status' => 'active', 'has_password' => true],
            [['membership_id' => $x['membershipId'], 'company_id' => $x['companyId'], 'role' => $role, 'employee_id' => $employeeId, 'membership_status' => 'active']],
        ) ?? throw new \LogicException('fixture');
        $emp = Scope::of($principal($w['f']['empA1'], 'employee', 'e_a1'));
        assertThrows(\LogicException::class, static fn () => $store->month($emp, '2026-09-30 17:00:00.000000', '2026-10-31 17:00:00.000000'), 'Employee scope, month');
        assertThrows(\LogicException::class, static fn () => $store->record($emp, 'employee', 'e_a1'), 'Employee scope, record');
        $b = Scope::of($principal($w['f']['ceoB'], 'ceo', null));
        assertSame([], $store->month($b, '2026-09-30 17:00:00.000000', '2026-10-31 17:00:00.000000'), 'company B scope: none of A');
        $leaky = 'SELECT id, company_id, NULL AS owner_employee_id FROM audit_events WHERE :company_id IS NOT NULL';
        assertThrows(\LogicException::class, static fn () => $scoped->select($b, $leaky), 'a statement without the company predicate cannot return company A rows');
    },
];
