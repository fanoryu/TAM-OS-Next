<?php
declare(strict_types=1);

/*
 * E11 hostile principals on the four Phase 1 routes (SDR-0002 §17 E11) against the real MariaDB: no
 * session and a revoked session (401 on every route); an Employee on the range read, create, void
 * and the financial report (403 before any lookup); another company's CEO (404 when voiding company
 * A's transaction; its range and report show nothing of company A); forged scope, creator and status
 * fields from the CEO (400); and a mutation without its CSRF token, with another session's token or
 * from another origin (403). Every refusal writes nothing and audits nothing. Fabricated data only.
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

/**
 * Company A: a CEO and e_a1 (an Employee login). Company B: a CEO and e_b1 (an Employee login).
 * Company A holds one recorded transaction.
 *
 * @return array{db: Database, k: Kernel, a: string, b: string, s: array<string, array{token: string, csrf: string}>, t: array<string, mixed>}
 */
$world = static function (): array {
    $db = authDatabase();
    $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
    $ceoA = authFixture($db);
    $ceoB = authFixture($db);
    $fixtures = ['ceoA' => $ceoA, 'empA1' => authFixture($db, ['companyId' => $ceoA['companyId'], 'role' => 'employee', 'employeeId' => 'e_a1']),
        'ceoB' => $ceoB, 'empB1' => authFixture($db, ['companyId' => $ceoB['companyId'], 'role' => 'employee', 'employeeId' => 'e_b1'])];
    $s = [];
    foreach ($fixtures as $name => $f) {
        $r = $k->handle(loginRequest($f['email'], (string) $f['password']), requestId());
        assertSame(200, $r->status, 'login ' . $name);
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken']];
    }
    $r = $k->handle(sessionRequest('POST', '/api/general-transactions/create', $s['ceoA']['token'], $s['ceoA']['csrf'], json_encode(['kind' => 'expense', 'financialPost' => 'GA', 'category' => 'Operasional Rutin', 'description' => 'Fabricated rent', 'amount' => '2500000.00', 'transactionDate' => '2026-10-05', 'idempotencyKey' => bin2hex(random_bytes(16))], JSON_THROW_ON_ERROR)), requestId());
    assertSame(200, $r->status, 'company A records a transaction (' . substr($r->body, 0, 200) . ')');
    return ['db' => $db, 'k' => $k, 'a' => $ceoA['companyId'], 'b' => $ceoB['companyId'], 's' => $s, 't' => envelope($r)['data']['generalTransaction']];
};
$get = static fn (array $w, string $who, string $path, string $query): Response
    => $w['k']->handle(sessionRequest('GET', $path, $w['s'][$who]['token'], null, '', ['query' => $query]), requestId());
$post = static fn (array $w, string $who, string $path, array $body, array $over = []): Response
    => $w['k']->handle(sessionRequest('POST', $path, $w['s'][$who]['token'], $w['s'][$who]['csrf'], json_encode($body, JSON_THROW_ON_ERROR), $over), requestId());
$code = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
$createBody = static fn (array $over = []): array => $over + ['kind' => 'income', 'financialPost' => 'DRONE', 'category' => 'Jasa', 'description' => 'Fabricated survey fee', 'amount' => '1000000.00', 'transactionDate' => '2026-10-06', 'idempotencyKey' => bin2hex(random_bytes(16))];
$voidBody = static fn (array $t, array $over = []): array => $over + ['financeTransactionId' => $t['id'], 'reason' => 'Fabricated duplicate', 'idempotencyKey' => bin2hex(random_bytes(16))];
$range = 'from=2026-10-01&to=2026-10-31';
/** Every table's row count, every transaction, void and audit row. */
$unchanged = static function (Database $db, Closure $fn): void {
    $rows = static function () use ($db): array {
        $out = [];
        foreach ($db->select('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME') as $t) {
            $out[(string) $t['t']] = (int) $db->select('SELECT COUNT(*) AS n FROM `' . $t['t'] . '`')[0]['n'];
        }
        return [$out, $db->select('SELECT * FROM finance_transactions ORDER BY id'), $db->select('SELECT * FROM finance_transaction_voids ORDER BY id'), $db->select('SELECT * FROM audit_events ORDER BY id')];
    };
    $before = $rows();
    $fn();
    assertSame($before, $rows(), 'nothing written, nothing audited');
};

return [
    '401: no session and a revoked session are refused on all four routes, and nothing is written' => static function () use ($world, $createBody, $voidBody, $range, $unchanged): void {
        $w = $world();
        $calls = static fn (?string $token, ?string $csrf): array => [
            'range' => $w['k']->handle(sessionRequest('GET', '/api/general-transactions', $token, null, '', ['query' => $range]), requestId()),
            'report' => $w['k']->handle(sessionRequest('GET', '/api/reports/financial', $token, null, '', ['query' => $range]), requestId()),
            'create' => $w['k']->handle(sessionRequest('POST', '/api/general-transactions/create', $token, $csrf, json_encode($createBody(), JSON_THROW_ON_ERROR)), requestId()),
            'void' => $w['k']->handle(sessionRequest('POST', '/api/general-transactions/void', $token, $csrf, json_encode($voidBody($w['t']), JSON_THROW_ON_ERROR)), requestId()),
        ];
        $unchanged($w['db'], static function () use ($calls): void {
            foreach ($calls(null, null) as $route => $r) {
                assertSame([401, 'unauthenticated'], [$r->status, envelope($r)['error']['code'] ?? null], 'no session: ' . $route);
            }
        });
        $w['db']->execute('UPDATE sessions SET revoked_at = UTC_TIMESTAMP(6) WHERE token_hash = ?', [hash('sha256', $w['s']['ceoA']['token'])]);
        $unchanged($w['db'], static function () use ($calls, $w): void {
            foreach ($calls($w['s']['ceoA']['token'], $w['s']['ceoA']['csrf']) as $route => $r) {
                assertSame(401, $r->status, 'revoked session: ' . $route);
            }
        });
    },
    'an Employee is 403 on the range read, create, void and the report — in their own company and another — and nothing is written' => static function () use ($world, $get, $post, $code, $createBody, $voidBody, $range, $unchanged): void {
        $w = $world();
        $unchanged($w['db'], static function () use ($w, $get, $post, $code, $createBody, $voidBody, $range): void {
            foreach (['empA1', 'empB1'] as $who) {
                assertSame([403, 'forbidden'], $code($get($w, $who, '/api/general-transactions', $range)), $who . ' range');
                assertSame([403, 'forbidden'], $code($get($w, $who, '/api/reports/financial', $range)), $who . ' report');
                assertSame([403, 'forbidden'], $code($post($w, $who, '/api/general-transactions/create', $createBody())), $who . ' create');
                assertSame([403, 'forbidden'], $code($post($w, $who, '/api/general-transactions/void', $voidBody($w['t']))), $who . ' void');
            }
        });
    },
    'another company\'s CEO gets 404 when voiding company A\'s transaction, and its range and report show nothing of company A' => static function () use ($world, $get, $post, $code, $voidBody, $range, $unchanged): void {
        $w = $world();
        $unchanged($w['db'], static function () use ($w, $get, $post, $code, $voidBody, $range): void {
            assertSame([404, 'not_found'], $code($post($w, 'ceoB', '/api/general-transactions/void', $voidBody($w['t']))), 'void company A\'s transaction');
            assertSame([], envelope($get($w, 'ceoB', '/api/general-transactions', $range))['data']['generalTransactions'], 'no transaction of company A');
            $report = envelope($get($w, 'ceoB', '/api/reports/financial', $range))['data']['financialReport'];
            assertSame(['income' => '0.00', 'expense' => '0.00', 'net' => '0.00', 'count' => 0], $report['general'], 'company B\'s report holds nothing of company A');
        });
    },
    'forged scope, creator, status and id fields from the CEO are 400 and never widen access; nothing is written' => static function () use ($world, $get, $post, $createBody, $voidBody, $range, $unchanged): void {
        $w = $world();
        $forged = ['companyId' => $w['b'], 'company_id' => $w['b'], 'createdByUserId' => str_repeat('1', 32), 'role' => 'ceo', 'status' => 'Voided', 'id' => str_repeat('f', 32), 'employeeId' => 'e_b1'];
        $unchanged($w['db'], static function () use ($w, $get, $post, $createBody, $voidBody, $forged, $range): void {
            foreach ($forged as $key => $value) {
                assertSame(400, $post($w, 'ceoA', '/api/general-transactions/create', $createBody([$key => $value]))->status, 'create ' . $key);
                assertSame(400, $post($w, 'ceoA', '/api/general-transactions/void', $voidBody($w['t'], [$key => $value]))->status, 'void ' . $key);
            }
            assertSame(400, $get($w, 'ceoA', '/api/general-transactions', $range . '&companyId=' . $w['b'])->status, 'range with a forged company');
            assertSame(400, $get($w, 'ceoA', '/api/reports/financial', $range . '&companyId=' . $w['b'])->status, 'report with a forged company');
            assertSame(400, $get($w, 'ceoA', '/api/reports/financial', 'from=2026-10-31&to=2026-10-01')->status, 'report with an inverted range');
        });
    },
    'CSRF and Origin: a create or void without its CSRF token, with another session\'s token or from another origin is 403 and writes nothing' => static function () use ($world, $post, $code, $createBody, $voidBody, $unchanged): void {
        $w = $world();
        $unchanged($w['db'], static function () use ($w, $post, $code, $createBody, $voidBody): void {
            foreach (['missing' => ['csrfToken' => null], 'another session' => ['csrfToken' => $w['s']['ceoB']['csrf']], 'another origin' => ['origin' => 'https://evil.test']] as $label => $over) {
                assertSame([403, 'forbidden'], $code($post($w, 'ceoA', '/api/general-transactions/create', $createBody(), $over)), 'create ' . $label);
                assertSame([403, 'forbidden'], $code($post($w, 'ceoA', '/api/general-transactions/void', $voidBody($w['t']), $over)), 'void ' . $label);
            }
        });
    },
];
