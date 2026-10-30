<?php
declare(strict_types=1);

/*
 * E11 hostile principals on the nine Payroll routes (SDR-0002 §17 E11) against the real MariaDB:
 * no session and a revoked session (401 on every route); an Employee on every CEO-only write and on
 * drift (403), reading only their own Committed plan (a colleague's is 404 and never listed);
 * another company's CEO and Employee (404 on every record route, nothing of company A listed);
 * forged scope fields from the CEO (400); and a mutation without its CSRF token or from another
 * origin (403). Every refusal writes nothing and audits nothing. Fabricated data only.
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
 * Company A: a CEO; e_a1 and e_a2 (Employee logins). Company B: a CEO and e_b1 (an Employee login).
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
    $db->execute("UPDATE employees SET monthly_base_salary = '3500000.00' WHERE id = 'e_a1'");
    $db->execute("UPDATE employees SET monthly_base_salary = '2000000.00' WHERE id IN ('e_a2', 'e_b1')");
    $s = [];
    foreach ($fixtures as $name => $f) {
        $r = $k->handle(loginRequest($f['email'], (string) $f['password']), requestId());
        assertSame(200, $r->status, 'login ' . $name);
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken']];
    }
    return ['db' => $db, 'k' => $k, 'a' => $a, 'b' => $ceoB['companyId'], 's' => $s];
};
$get = static fn (array $w, string $who, string $path, string $query = ''): Response
    => $w['k']->handle(sessionRequest('GET', $path, $w['s'][$who]['token'], null, '', ['query' => $query]), requestId());
$post = static fn (array $w, string $who, string $path, array $body, array $over = []): Response
    => $w['k']->handle(sessionRequest('POST', $path, $w['s'][$who]['token'], $w['s'][$who]['csrf'], json_encode($body, JSON_THROW_ON_ERROR), $over), requestId());
$ok = static function (Response $r, string $label): array {
    assertSame(200, $r->status, $label . ' (' . substr($r->body, 0, 300) . ')');
    return envelope($r)['data'];
};
$code = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
$newKey = static fn (): string => bin2hex(random_bytes(16));
/** Company A's live plans of 2026-10 after a CEO generate, by employee. */
$generate = static function (array $w, string $who = 'ceoA') use ($post, $ok): array {
    $out = [];
    foreach ($ok($post($w, $who, '/api/payroll-plans/generate', ['month' => '2026-10']), 'generate')['payrollPlans'] as $p) {
        $out[$p['employeeId']] = $p;
    }
    return $out;
};
$step = static fn (array $w, string $op, array $plan, string $who = 'ceoA'): Response
    => $post($w, $who, '/api/payroll-plans/' . $op, ['id' => $plan['id'], 'expectedVersion' => $plan['version']]);
$commit = static fn (array $w, array $plan, string $key, string $who = 'ceoA'): Response
    => $post($w, $who, '/api/payroll-plans/commit', ['id' => $plan['id'], 'expectedVersion' => $plan['version'], 'expectedTotal' => $plan['totalAmount'], 'idempotencyKey' => $key]);
/** $employee's plan approved to Ready, then committed, by the CEO of company A. */
$committed = static function (array $w, array $plan) use ($step, $commit, $ok, $newKey): array {
    $ready = $ok($step($w, 'approve', $plan), 'approve')['payrollPlan'];
    return $ok($commit($w, $ready, $newKey()), 'commit')['payrollPlan'];
};
/** Every table's row count. */
$counts = static function (Database $db): array {
    $out = [];
    foreach ($db->select('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME') as $t) {
        $out[(string) $t['t']] = (int) $db->select('SELECT COUNT(*) AS n FROM `' . $t['t'] . '`')[0]['n'];
    }
    return $out;
};
$plansRows = static fn (Database $db): array => $db->select('SELECT * FROM payroll_plans ORDER BY id');
/** The same refusal must leave every table and every plan row exactly as it was. */
$unchanged = static function (Database $db, Closure $fn) use ($counts, $plansRows): void {
    $before = [$counts($db), $plansRows($db)];
    $fn();
    assertSame($before, [$counts($db), $plansRows($db)], 'nothing written, nothing audited');
};
$writes = ['review', 'approve', 'return', 'cancel'];

return [
    '401: no session and a revoked session are refused on all nine Payroll routes, and nothing is written' => static function () use ($world, $generate, $unchanged, $writes): void {
        $w = $world();
        $p = $generate($w)['e_a1'];
        $calls = static function (?string $token, ?string $csrf) use ($w, $p, $writes): array {
            $out = [];
            $out['list'] = $w['k']->handle(sessionRequest('GET', '/api/payroll-plans', $token, null, '', ['query' => 'month=2026-10']), requestId());
            $out['detail'] = $w['k']->handle(sessionRequest('GET', '/api/payroll-plan', $token, null, '', ['query' => 'id=' . $p['id']]), requestId());
            $out['drift'] = $w['k']->handle(sessionRequest('GET', '/api/payroll-plan/drift', $token, null, '', ['query' => 'id=' . $p['id']]), requestId());
            $out['generate'] = $w['k']->handle(sessionRequest('POST', '/api/payroll-plans/generate', $token, $csrf, json_encode(['month' => '2026-10'], JSON_THROW_ON_ERROR)), requestId());
            foreach ($writes as $op) {
                $out[$op] = $w['k']->handle(sessionRequest('POST', '/api/payroll-plans/' . $op, $token, $csrf, json_encode(['id' => $p['id'], 'expectedVersion' => $p['version']], JSON_THROW_ON_ERROR)), requestId());
            }
            $out['commit'] = $w['k']->handle(sessionRequest('POST', '/api/payroll-plans/commit', $token, $csrf, json_encode(['id' => $p['id'], 'expectedVersion' => $p['version'], 'expectedTotal' => $p['totalAmount'], 'idempotencyKey' => bin2hex(random_bytes(16))], JSON_THROW_ON_ERROR)), requestId());
            return $out;
        };
        $unchanged($w['db'], static function () use ($calls): void {
            foreach ($calls(null, null) as $route => $r) {
                assertSame(401, $r->status, 'no session: ' . $route);
                assertSame('unauthenticated', envelope($r)['error']['code'] ?? null, 'no session code: ' . $route);
            }
        });
        $w['db']->execute('UPDATE sessions SET revoked_at = UTC_TIMESTAMP(6) WHERE token_hash = ?', [hash('sha256', $w['s']['ceoA']['token'])]);
        $unchanged($w['db'], static function () use ($calls, $w): void {
            foreach ($calls($w['s']['ceoA']['token'], $w['s']['ceoA']['csrf']) as $route => $r) {
                assertSame(401, $r->status, 'revoked session: ' . $route);
            }
        });
    },
    'an Employee is 403 on generate, every transition, commit and drift — on their own plan and a colleague\'s — and nothing is written' => static function () use ($world, $generate, $committed, $step, $commit, $get, $post, $code, $unchanged, $newKey, $writes): void {
        $w = $world();
        $plans = $generate($w);
        $own = $plans['e_a1'];
        $theirs = $plans['e_a2'];
        $done = $committed($w, $own);
        $unchanged($w['db'], static function () use ($w, $own, $theirs, $done, $step, $commit, $get, $post, $code, $newKey, $writes): void {
            foreach (['empA1', 'empA2', 'empB1'] as $who) {
                assertSame([403, 'forbidden'], $code($post($w, $who, '/api/payroll-plans/generate', ['month' => '2026-10'])), $who . ' generate');
                foreach ([$own, $theirs] as $plan) {
                    foreach ($writes as $op) {
                        assertSame([403, 'forbidden'], $code($step($w, $op, $plan, $who)), $who . ' ' . $op);
                    }
                    assertSame([403, 'forbidden'], $code($commit($w, $plan, $newKey(), $who)), $who . ' commit');
                }
                assertSame([403, 'forbidden'], $code($get($w, $who, '/api/payroll-plan/drift', 'id=' . $done['id'])), $who . ' drift');
            }
        });
    },
    'an Employee reads only their own Committed plan: a colleague\'s Committed plan is 404 and never listed; a pre-commit plan is 404' => static function () use ($world, $generate, $committed, $get, $ok, $code, $unchanged): void {
        $w = $world();
        $plans = $generate($w);
        $mine = $committed($w, $plans['e_a1']);
        $colleague = $committed($w, $plans['e_a2']);
        $unchanged($w['db'], static function () use ($w, $mine, $colleague, $get, $ok, $code): void {
            assertSame($mine['id'], $ok($get($w, 'empA1', '/api/payroll-plan', 'id=' . $mine['id']), 'own Committed')['payrollPlan']['id'], 'own Committed plan readable');
            assertSame([$mine['id']], array_column($ok($get($w, 'empA1', '/api/payroll-plans', 'month=2026-10'), 'own list')['payrollPlans'], 'id'), 'only their own plan is listed');
            assertSame([404, 'not_found'], $code($get($w, 'empA1', '/api/payroll-plan', 'id=' . $colleague['id'])), 'a colleague\'s Committed plan');
            assertSame([404, 'not_found'], $code($get($w, 'empB1', '/api/payroll-plan', 'id=' . $mine['id'])), 'another company Employee');
            assertSame([], $ok($get($w, 'empB1', '/api/payroll-plans', 'month=2026-10'), 'other company list')['payrollPlans'], 'another company Employee lists nothing of A');
        });
        $w2 = $world();
        $draft = $generate($w2)['e_a1'];
        assertSame([404, 'not_found'], $code($get($w2, 'empA1', '/api/payroll-plan', 'id=' . $draft['id'])), 'own Draft is not readable');
    },
    'another company\'s CEO gets 404 for every record route on company A, lists nothing of A, and writes nothing' => static function () use ($world, $generate, $committed, $step, $commit, $get, $ok, $code, $unchanged, $newKey, $writes): void {
        $w = $world();
        $plans = $generate($w);
        $draft = $plans['e_a2'];
        $done = $committed($w, $plans['e_a1']);
        $unchanged($w['db'], static function () use ($w, $draft, $done, $step, $commit, $get, $ok, $code, $newKey, $writes): void {
            foreach ([$draft, $done] as $plan) {
                assertSame([404, 'not_found'], $code($get($w, 'ceoB', '/api/payroll-plan', 'id=' . $plan['id'])), 'detail ' . $plan['status']);
                foreach ($writes as $op) {
                    assertSame([404, 'not_found'], $code($step($w, $op, $plan, 'ceoB')), $op . ' ' . $plan['status']);
                }
                assertSame([404, 'not_found'], $code($commit($w, $plan, $newKey(), 'ceoB')), 'commit ' . $plan['status']);
            }
            assertSame([404, 'not_found'], $code($get($w, 'ceoB', '/api/payroll-plan/drift', 'id=' . $done['id'])), 'drift');
            assertSame([], $ok($get($w, 'ceoB', '/api/payroll-plans', 'month=2026-10'), 'company B list')['payrollPlans'], 'company B lists nothing of A');
        });
    },
    'forged scope fields from the CEO are 400 and never widen access; nothing is written' => static function () use ($world, $generate, $step, $post, $get, $unchanged): void {
        $w = $world();
        $p = $generate($w)['e_a1'];
        $forged = ['companyId' => $w['b'], 'company_id' => $w['b'], 'employeeId' => 'e_b1', 'role' => 'ceo', 'status' => 'Committed', 'totalAmount' => '1.00'];
        $unchanged($w['db'], static function () use ($w, $p, $forged, $post, $get): void {
            foreach ($forged as $key => $value) {
                assertSame(400, $post($w, 'ceoA', '/api/payroll-plans/generate', ['month' => '2026-10', $key => $value])->status, 'generate ' . $key);
                assertSame(400, $post($w, 'ceoA', '/api/payroll-plans/review', ['id' => $p['id'], 'expectedVersion' => $p['version'], $key => $value])->status, 'review ' . $key);
                assertSame(400, $post($w, 'ceoA', '/api/payroll-plans/commit', ['id' => $p['id'], 'expectedVersion' => $p['version'], 'expectedTotal' => $p['totalAmount'], 'idempotencyKey' => bin2hex(random_bytes(16)), $key => $value])->status, 'commit ' . $key);
            }
            assertSame(400, $get($w, 'ceoA', '/api/payroll-plans', 'month=2026-10&companyId=' . $w['b'])->status, 'list with a forged company');
            assertSame(400, $get($w, 'ceoA', '/api/payroll-plan', 'id=' . $p['id'] . '&companyId=' . $w['b'])->status, 'detail with a forged company');
        });
    },
    'CSRF and Origin: a Payroll mutation without its CSRF token, with another session\'s token or from another origin is 403 and writes nothing' => static function () use ($world, $generate, $post, $code, $unchanged): void {
        $w = $world();
        $p = $generate($w)['e_a2'];
        $unchanged($w['db'], static function () use ($w, $p, $post, $code): void {
            $body = ['id' => $p['id'], 'expectedVersion' => $p['version']];
            foreach (['missing' => ['csrfToken' => null], 'another session' => ['csrfToken' => $w['s']['ceoB']['csrf']], 'another origin' => ['origin' => 'https://evil.test']] as $label => $over) {
                assertSame([403, 'forbidden'], $code($post($w, 'ceoA', '/api/payroll-plans/review', $body, $over)), 'review ' . $label);
                assertSame([403, 'forbidden'], $code($post($w, 'ceoA', '/api/payroll-plans/generate', ['month' => '2026-10'], $over)), 'generate ' . $label);
            }
        });
    },
];
