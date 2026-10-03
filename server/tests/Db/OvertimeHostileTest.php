<?php
declare(strict_types=1);

/*
 * BF-4b1 hostile principals against the real MariaDB (extending the BF-3C hostile-principal
 * suite to the overtime domain, as each domain migration must): an Employee reaching for CEO-only
 * transitions, a colleague's records or a non-Draft of their own; a CEO of another company; and
 * forged authority in the body. Every refusal writes nothing and audits nothing. Fabricated data.
 *
 * BF-4b2: approve joins every write matrix below (an Employee is 403 on their own record, 404 on
 * a colleague's; another company is 404), and the valuation read never discloses a preview to an
 * Employee nor any valuation across colleagues or companies.
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
use TamOs\Http\Response;
use function TamOs\Tests\assertSame;
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

/** @return array{db: Database, k: Kernel, s: array<string, array{token: string, csrf: string}>} */
$world = static function (): array {
    $db = authDatabase();
    $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
    $ceoA = authFixture($db);
    $a = $ceoA['companyId'];
    $ceoB = authFixture($db);
    $fixtures = ['ceoA' => $ceoA, 'empA1' => authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a1']),
        'empA2' => authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a2']),
        'ceoB' => $ceoB, 'empB1' => authFixture($db, ['companyId' => $ceoB['companyId'], 'role' => 'employee', 'employeeId' => 'e_b1'])];
    $s = [];
    foreach ($fixtures as $name => $f) {
        $r = $k->handle(loginRequest($f['email'], (string) $f['password']), requestId());
        assertSame(200, $r->status, 'login ' . $name);
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken']];
    }
    return ['db' => $db, 'k' => $k, 's' => $s];
};
$post = static fn (array $w, string $who, string $path, array $body): Response
    => $w['k']->handle(sessionRequest('POST', $path, $w['s'][$who]['token'], $w['s'][$who]['csrf'], json_encode($body, JSON_THROW_ON_ERROR)), requestId());
$get = static fn (array $w, string $who, string $path, string $query): Response
    => $w['k']->handle(sessionRequest('GET', $path, $w['s'][$who]['token'], null, '', ['query' => $query]), requestId());
$code = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
$new = static function (array $w, string $who, string $employee) use ($post): array {
    $r = $post($w, $who, '/api/overtime-records/create', ['employeeId' => $employee, 'monthKey' => '2026-10', 'hours' => '1.00']);
    assertSame(200, $r->status, 'create ' . substr($r->body, 0, 120));
    return envelope($r)['data']['overtimeRecord'];
};
$to = static function (array $w, string $op, array $rec) use ($post): array {
    $r = $post($w, 'ceoA', '/api/overtime-records/' . $op, ['id' => $rec['id'], 'expectedVersion' => $rec['version']]);
    assertSame(200, $r->status, $op);
    return envelope($r)['data']['overtimeRecord'];
};
$snapshot = static fn (Database $db): array => [
    $db->select('SELECT id, status, version, hours, month_key, employee_id, company_id, valuation_method, valuation_salary, approved_amount, approved_at FROM overtime_records ORDER BY id'),
    (int) $db->select('SELECT COUNT(*) AS n FROM audit_events')[0]['n'],
];
$ops = static fn (array $rec): array => [
    'update' => ['id' => $rec['id'], 'expectedVersion' => $rec['version'], 'hours' => '9.00'],
    'delete' => ['id' => $rec['id'], 'expectedVersion' => $rec['version']],
    'submit' => ['id' => $rec['id'], 'expectedVersion' => $rec['version']],
    'review' => ['id' => $rec['id'], 'expectedVersion' => $rec['version']],
    'reject' => ['id' => $rec['id'], 'expectedVersion' => $rec['version']],
    'approve' => ['id' => $rec['id'], 'expectedVersion' => $rec['version'], 'expectedAmount' => '0.00'],
];

return [
    'an Employee can never review, reject or approve, not even their own record (403), and nothing changes' => static function () use ($world, $new, $to, $post, $code, $snapshot): void {
        $w0 = $world();
        $w0['db']->execute("UPDATE employees SET monthly_base_salary = '3500000.00' WHERE id = 'e_a1'");
        $own = $to($w0, 'review', $to($w0, 'submit', $new($w0, 'empA1', 'e_a1')));
        $before0 = $snapshot($w0['db']);
        assertSame([403, 'forbidden'], $code($post($w0, 'empA1', '/api/overtime-records/approve', ['id' => $own['id'], 'expectedVersion' => $own['version'], 'expectedAmount' => '21875.00'])), 'approve own Reviewed with the right amount');
        assertSame($before0, $snapshot($w0['db']), 'nothing approved by an Employee');
        $w = $world();
        $draft = $new($w, 'empA1', 'e_a1');
        $sub = $to($w, 'submit', $new($w, 'empA1', 'e_a1'));
        $rev = $to($w, 'review', $to($w, 'submit', $new($w, 'empA1', 'e_a1')));
        $before = $snapshot($w['db']);
        foreach ([$draft, $sub, $rev] as $rec) {
            foreach (['review', 'reject', 'approve'] as $op) {
                assertSame([403, 'forbidden'], $code($post($w, 'empA1', '/api/overtime-records/' . $op, ['id' => $rec['id'], 'expectedVersion' => $rec['version']] + ($op === 'approve' ? ['expectedAmount' => '6250.00'] : []))), $op . ' own ' . $rec['status']);
            }
        }
        assertSame($before, $snapshot($w['db']), 'nothing written, nothing audited');
    },
    'an Employee acts only on their own Draft: their own non-Draft is 403 for every write' => static function () use ($world, $new, $to, $post, $code, $snapshot, $ops): void {
        $w = $world();
        $sub = $to($w, 'submit', $new($w, 'empA1', 'e_a1'));
        $before = $snapshot($w['db']);
        foreach ($ops($sub) as $op => $body) {
            assertSame([403, 'forbidden'], $code($post($w, 'empA1', '/api/overtime-records/' . $op, $body)), $op . ' own Submitted');
        }
        assertSame($before, $snapshot($w['db']));
    },
    'a colleague\'s records are invisible to an Employee: every read and write is 404' => static function () use ($world, $new, $post, $get, $code, $snapshot, $ops): void {
        $w = $world();
        $theirs = $new($w, 'empA2', 'e_a2');
        $before = $snapshot($w['db']);
        assertSame([404, 'not_found'], $code($get($w, 'empA1', '/api/overtime-record', 'id=' . $theirs['id'])), 'read');
        assertSame([404, 'not_found'], $code($get($w, 'empA1', '/api/overtime-record/valuation', 'id=' . $theirs['id'])), 'valuation');
        foreach ($ops($theirs) as $op => $body) {
            assertSame([404, 'not_found'], $code($post($w, 'empA1', '/api/overtime-records/' . $op, $body)), $op);
        }
        assertSame([], envelope($get($w, 'empA1', '/api/overtime-records', 'month=2026-10'))['data']['overtimeRecords'], 'not listed');
        assertSame($before, $snapshot($w['db']));
    },
    'another company is invisible: its CEO and its Employee get 404 for everything' => static function () use ($world, $new, $post, $get, $code, $snapshot, $ops): void {
        $w = $world();
        $rec = $new($w, 'empA1', 'e_a1');
        $before = $snapshot($w['db']);
        foreach (['ceoB', 'empB1'] as $who) {
            assertSame([404, 'not_found'], $code($get($w, $who, '/api/overtime-record', 'id=' . $rec['id'])), $who . ' read');
            assertSame([404, 'not_found'], $code($get($w, $who, '/api/overtime-record/valuation', 'id=' . $rec['id'])), $who . ' valuation');
            foreach ($ops($rec) as $op => $body) {
                assertSame([404, 'not_found'], $code($post($w, $who, '/api/overtime-records/' . $op, $body)), $who . ' ' . $op);
            }
            assertSame([], envelope($get($w, $who, '/api/overtime-records', 'month=2026-10'))['data']['overtimeRecords'], $who . ' list');
        }
        assertSame([404, 'not_found'], $code($post($w, 'ceoB', '/api/overtime-records/create', ['employeeId' => 'e_a2', 'monthKey' => '2026-10', 'hours' => '1.00'])), 'no cross-company assignment');
        assertSame($before, $snapshot($w['db']));
    },
    'forged authority in the body is refused by name, by every principal, and writes nothing' => static function () use ($world, $new, $post, $code, $snapshot): void {
        $w = $world();
        $rec = $new($w, 'empA1', 'e_a1');
        $before = $snapshot($w['db']);
        $forged = ['company_id' => str_repeat('f', 32), 'companyId' => str_repeat('f', 32), 'status' => 'Reviewed', 'version' => 9, 'actorUserId' => str_repeat('1', 32),
            'reviewedBy' => 'x', 'approvedAmount' => '1000000.00', 'hourlyRate' => '1.00', 'employeeName' => 'x', 'payrollPlanId' => 'x', 'createdAt' => '2020-01-01',
            'valuationSalary' => '1.00', 'monthlySalaryBasis' => '1.00', 'standardMonthlyHours' => '1.00', 'multiplier' => '2', 'method' => 'TAM-OT-1'];
        foreach (['ceoA', 'empA1'] as $who) {
            foreach ($forged as $key => $value) {
                assertSame([400, 'validation_failed'], $code($post($w, $who, '/api/overtime-records/create', ['employeeId' => 'e_a1', 'monthKey' => '2026-10', 'hours' => '1.00', $key => $value])), $who . ' create ' . $key);
                assertSame([400, 'validation_failed'], $code($post($w, $who, '/api/overtime-records/update', ['id' => $rec['id'], 'expectedVersion' => 1, $key => $value])), $who . ' update ' . $key);
            }
        }
        assertSame($before, $snapshot($w['db']));
    },
];
