<?php
declare(strict_types=1);

/*
 * E11 confirmation cases (SDR-0002 §17 E11) that complete the matrix of routes whose main hostile
 * suites live elsewhere: the four account-administration routes (another company's Employee, no
 * session, missing CSRF), the overtime valuation read under the accepted C-1 expectations (an
 * Employee's own Approved record 200, own non-Approved 403, a colleague's and another company's 404),
 * and the two audit reads (no session and a revoked session 401, a second Employee 403). Every
 * refusal writes nothing and audits nothing. Fabricated data only.
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
use TamOs\Http\Response;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\authKernel;
use function TamOs\Tests\employeeAnchor;
use function TamOs\Tests\envelope;
use function TamOs\Tests\loginRequest;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\requestId;
use function TamOs\Tests\sessionCookieToken;
use function TamOs\Tests\sessionRequest;
use function TamOs\Tests\testDbConfig;

/**
 * Company A: a CEO; e_a1 and e_a2 (Employee logins); e_new (an Employee record with no login).
 * Company B: a CEO and e_b1 (an Employee login).
 *
 * @return array{db: Database, k: Kernel, a: string, b: string, s: array<string, array{token: string, csrf: string}>}
 */
$world = static function (): array {
    $db = authDatabase();
    $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
    $ceoA = authFixture($db);
    $a = $ceoA['companyId'];
    $ceoB = authFixture($db);
    $fixtures = ['ceoA' => $ceoA, 'empA1' => authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a1']),
        'empA2' => authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a2']), 'ceoB' => $ceoB,
        'empB1' => authFixture($db, ['companyId' => $ceoB['companyId'], 'role' => 'employee', 'employeeId' => 'e_b1'])];
    employeeAnchor($db, $a, 'e_new');
    $db->execute("UPDATE employees SET monthly_base_salary = '3500000.00' WHERE id IN ('e_a1', 'e_a2')");
    $s = [];
    foreach ($fixtures as $name => $f) {
        $r = $k->handle(loginRequest($f['email'], (string) $f['password']), requestId());
        assertSame(200, $r->status, 'login ' . $name);
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken']];
    }
    return ['db' => $db, 'k' => $k, 'a' => $a, 'b' => $ceoB['companyId'], 's' => $s];
};
$get = static fn (array $w, ?string $who, string $path, string $query): Response
    => $w['k']->handle(sessionRequest('GET', $path, $who === null ? null : $w['s'][$who]['token'], null, '', ['query' => $query]), requestId());
$post = static fn (array $w, ?string $who, string $path, array $body, array $over = []): Response
    => $w['k']->handle(sessionRequest('POST', $path, $who === null ? null : $w['s'][$who]['token'], $who === null ? null : $w['s'][$who]['csrf'], json_encode($body, JSON_THROW_ON_ERROR), $over), requestId());
$code = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
/** Every table's row count. */
$counts = static function (Database $db): array {
    $out = [];
    foreach ($db->select('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME') as $t) {
        $out[(string) $t['t']] = (int) $db->select('SELECT COUNT(*) AS n FROM `' . $t['t'] . '`')[0]['n'];
    }
    return $out;
};
$accountRoutes = ['provision-account' => ['email' => 'h@example.test'], 'reissue-activation' => [], 'disable-account' => [], 'enable-account' => []];
/** An overtime record of e_a1 created by its owner and moved by the CEO through $ops. */
$overtimeOf = static function (array $w, array $ops) use ($post): array {
    $r = $post($w, 'empA1', '/api/overtime-records/create', ['employeeId' => 'e_a1', 'monthKey' => '2026-10', 'hours' => '1.00']);
    assertSame(200, $r->status, 'create ' . substr($r->body, 0, 120));
    $rec = envelope($r)['data']['overtimeRecord'];
    foreach ($ops as $op) {
        $body = ['id' => $rec['id'], 'expectedVersion' => $rec['version']] + ($op === 'approve' ? ['expectedAmount' => '21875.00'] : []);
        $r = $post($w, 'ceoA', '/api/overtime-records/' . $op, $body);
        assertSame(200, $r->status, $op . ' ' . substr($r->body, 0, 160));
        $rec = envelope($r)['data']['overtimeRecord'];
    }
    return $rec;
};

return [
    'account administration: another company\'s Employee is 404, no session is 401 and a missing CSRF token is 403 on all four routes; nothing is written' => static function () use ($world, $post, $code, $counts, $accountRoutes): void {
        $w = $world();
        $before = $counts($w['db']);
        foreach ($accountRoutes as $verb => $extra) {
            $path = '/api/employees/' . $verb;
            foreach (['e_a1', 'e_new'] as $id) {
                assertSame([404, 'not_found'], $code($post($w, 'empB1', $path, ['id' => $id] + $extra)), $verb . ': another company\'s Employee on ' . $id);
            }
            assertSame([401, 'unauthenticated'], $code($post($w, null, $path, ['id' => 'e_new'] + $extra)), $verb . ': no session');
            assertSame([403, 'forbidden'], $code($post($w, 'ceoA', $path, ['id' => 'e_new'] + $extra, ['csrfToken' => null])), $verb . ': missing CSRF token');
            assertSame([403, 'forbidden'], $code($post($w, 'ceoA', $path, ['id' => 'e_new'] + $extra, ['origin' => 'https://evil.test'])), $verb . ': another origin');
        }
        assertSame($before, $counts($w['db']), 'nothing written');
    },
    'overtime valuation (C-1): an Employee reads the frozen valuation of their own Approved record; their own non-Approved record is 403; a colleague and another company are 404' => static function () use ($world, $get, $code, $counts, $overtimeOf): void {
        $w = $world();
        $approved = $overtimeOf($w, ['submit', 'review', 'approve']);
        assertSame('Approved', $approved['status'], 'the record is Approved');
        $records = ['Draft' => $overtimeOf($w, []), 'Submitted' => $overtimeOf($w, ['submit']), 'Reviewed' => $overtimeOf($w, ['submit', 'review'])];
        $before = $counts($w['db']);
        $own = $get($w, 'empA1', '/api/overtime-record/valuation', 'id=' . $approved['id']);
        assertSame(200, $own->status, 'own Approved: ' . substr($own->body, 0, 160));
        assertSame('21875.00', envelope($own)['data']['overtimeValuation']['amount'], 'the frozen amount');
        foreach ($records as $status => $rec) {
            assertSame([403, 'forbidden'], $code($get($w, 'empA1', '/api/overtime-record/valuation', 'id=' . $rec['id'])), 'own ' . $status . ': no preview for an Employee');
        }
        foreach (['empA2', 'ceoB', 'empB1'] as $who) {
            foreach (['Approved' => $approved] + $records as $status => $rec) {
                assertSame([404, 'not_found'], $code($get($w, $who, '/api/overtime-record/valuation', 'id=' . $rec['id'])), $who . ' on ' . $status);
            }
        }
        assertSame($before, $counts($w['db']), 'reads write nothing');
    },
    'audit reads: no session and a revoked session are 401, a second Employee is 403, and nothing is written' => static function () use ($world, $get, $code, $counts): void {
        $w = $world();
        $reads = [['/api/audit-events', 'month=2026-10'], ['/api/audit-events/record', 'entity=employee&id=e_a2']];
        $before = $counts($w['db']);
        foreach ($reads as [$path, $q]) {
            assertSame([401, 'unauthenticated'], $code($get($w, null, $path, $q)), 'no session ' . $q);
            assertSame([403, 'forbidden'], $code($get($w, 'empA2', $path, $q)), 'an Employee ' . $q);
        }
        $w['db']->execute('UPDATE sessions SET revoked_at = UTC_TIMESTAMP(6) WHERE token_hash = ?', [hash('sha256', $w['s']['ceoA']['token'])]);
        foreach ($reads as [$path, $q]) {
            assertSame([401, 'unauthenticated'], $code($get($w, 'ceoA', $path, $q)), 'revoked session ' . $q);
        }
        $after = $counts($w['db']);
        assertSame($before, $after, 'nothing written');
    },
];
