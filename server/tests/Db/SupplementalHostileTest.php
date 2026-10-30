<?php
declare(strict_types=1);

/*
 * E11 hostile principals on the nine Supplemental Payroll routes (SDR-0002 §17 E11) against the real
 * MariaDB: no session and a revoked session (401 on every route); an Employee on generate, every
 * transition, commit and eligibility (403), reading only their own Committed document (a colleague's
 * is 404 and never listed); another company's CEO (404 on every record route of company A, its
 * eligibility shows nothing of company A — the accepted C-1 expectation); forged scope fields from the
 * CEO (400); and a mutation without its CSRF token or from another origin (403). Every refusal writes
 * nothing and audits nothing. Fabricated data only.
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
/** Test-only SQL: an Approved overtime record with a frozen snapshot and $amount — "approved now". */
$overtime = static function (Database $db, string $company, string $employee, string $hours, string $amount): string {
    $id = bin2hex(random_bytes(16));
    $db->execute("INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at, valuation_method, valuation_salary, valuation_standard_hours, approved_amount, approved_at) VALUES (?, ?, ?, '2026-10', NULL, ?, NULL, NULL, 'Approved', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'TAM-OT-1', '3200000.00', '160.00', ?, UTC_TIMESTAMP(6))",
        [$id, $company, $employee, $hours, $amount]);
    return $id;
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
/** Company A's base plans of 2026-10, each approved and committed by the CEO, by employee. */
$committedPlans = static function (array $w) use ($post, $ok, $newKey): array {
    $out = [];
    foreach ($ok($post($w, 'ceoA', '/api/payroll-plans/generate', ['month' => '2026-10']), 'payroll generate')['payrollPlans'] as $p) {
        $p = $ok($post($w, 'ceoA', '/api/payroll-plans/approve', ['id' => $p['id'], 'expectedVersion' => $p['version']]), 'payroll approve')['payrollPlan'];
        $out[$p['employeeId']] = $ok($post($w, 'ceoA', '/api/payroll-plans/commit', ['id' => $p['id'], 'expectedVersion' => $p['version'], 'expectedTotal' => $p['totalAmount'], 'idempotencyKey' => $newKey()]), 'payroll commit')['payrollPlan'];
    }
    return $out;
};
$gen = static fn (array $w, string $planId, string $who = 'ceoA'): Response => $post($w, $who, '/api/supplemental-payrolls/generate', ['payrollPlanId' => $planId]);
$step = static fn (array $w, string $op, array $doc, string $who = 'ceoA'): Response
    => $post($w, $who, '/api/supplemental-payrolls/' . $op, ['id' => $doc['id'], 'expectedVersion' => $doc['version']]);
$commit = static fn (array $w, array $doc, string $key, string $who = 'ceoA'): Response
    => $post($w, $who, '/api/supplemental-payrolls/commit', ['id' => $doc['id'], 'expectedVersion' => $doc['version'], 'expectedTotal' => $doc['overtimeAmount'], 'idempotencyKey' => $key]);
/** A Draft document of $plan's late overtime (the overtime is inserted after the base commit). */
$draft = static function (array $w, array $plan, string $employee) use ($overtime, $gen, $ok): array {
    $overtime($w['db'], $w['a'], $employee, '1.00', '21875.00');
    return $ok($gen($w, $plan['id']), 'supplemental generate')['supplementalPayroll'];
};
/** A Draft driven to Ready and committed by the CEO of company A. */
$committedDoc = static function (array $w, array $doc) use ($step, $commit, $ok, $newKey): array {
    $doc = $ok($step($w, 'review', $doc), 'review')['supplementalPayroll'];
    $doc = $ok($step($w, 'approve', $doc), 'approve')['supplementalPayroll'];
    return $ok($commit($w, $doc, $newKey()), 'commit')['supplementalPayroll'];
};
/** Every table's row count. */
$counts = static function (Database $db): array {
    $out = [];
    foreach ($db->select('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME') as $t) {
        $out[(string) $t['t']] = (int) $db->select('SELECT COUNT(*) AS n FROM `' . $t['t'] . '`')[0]['n'];
    }
    return $out;
};
$docRows = static fn (Database $db): array => $db->select('SELECT * FROM supplemental_payrolls ORDER BY id');
/** The same refusal must leave every table and every document row exactly as it was. */
$unchanged = static function (Database $db, Closure $fn) use ($counts, $docRows): void {
    $before = [$counts($db), $docRows($db)];
    $fn();
    assertSame($before, [$counts($db), $docRows($db)], 'nothing written, nothing audited');
};
$writes = ['review', 'approve', 'return', 'cancel'];

return [
    '401: no session and a revoked session are refused on all nine Supplemental routes, and nothing is written' => static function () use ($world, $committedPlans, $draft, $unchanged, $writes): void {
        $w = $world();
        $plan = $committedPlans($w)['e_a1'];
        $d = $draft($w, $plan, 'e_a1');
        $calls = static function (?string $token, ?string $csrf) use ($w, $plan, $d, $writes): array {
            $out = [];
            $out['list'] = $w['k']->handle(sessionRequest('GET', '/api/supplemental-payrolls', $token, null, '', ['query' => 'month=2026-10']), requestId());
            $out['detail'] = $w['k']->handle(sessionRequest('GET', '/api/supplemental-payroll', $token, null, '', ['query' => 'id=' . $d['id']]), requestId());
            $out['eligibility'] = $w['k']->handle(sessionRequest('GET', '/api/supplemental-payrolls/eligibility', $token, null, '', ['query' => 'month=2026-10']), requestId());
            $out['generate'] = $w['k']->handle(sessionRequest('POST', '/api/supplemental-payrolls/generate', $token, $csrf, json_encode(['payrollPlanId' => $plan['id']], JSON_THROW_ON_ERROR)), requestId());
            foreach ($writes as $op) {
                $out[$op] = $w['k']->handle(sessionRequest('POST', '/api/supplemental-payrolls/' . $op, $token, $csrf, json_encode(['id' => $d['id'], 'expectedVersion' => $d['version']], JSON_THROW_ON_ERROR)), requestId());
            }
            $out['commit'] = $w['k']->handle(sessionRequest('POST', '/api/supplemental-payrolls/commit', $token, $csrf, json_encode(['id' => $d['id'], 'expectedVersion' => $d['version'], 'expectedTotal' => $d['overtimeAmount'], 'idempotencyKey' => bin2hex(random_bytes(16))], JSON_THROW_ON_ERROR)), requestId());
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
    'an Employee is 403 on generate, every transition, commit and eligibility — on their own document and a colleague\'s — and nothing is written' => static function () use ($world, $committedPlans, $draft, $gen, $step, $commit, $get, $code, $unchanged, $newKey, $writes): void {
        $w = $world();
        $plans = $committedPlans($w);
        $own = $draft($w, $plans['e_a1'], 'e_a1');
        $theirs = $draft($w, $plans['e_a2'], 'e_a2');
        $unchanged($w['db'], static function () use ($w, $plans, $own, $theirs, $gen, $step, $commit, $get, $code, $newKey, $writes): void {
            foreach (['empA1', 'empA2', 'empB1'] as $who) {
                assertSame([403, 'forbidden'], $code($gen($w, $plans['e_a1']['id'], $who)), $who . ' generate');
                foreach ([$own, $theirs] as $doc) {
                    foreach ($writes as $op) {
                        assertSame([403, 'forbidden'], $code($step($w, $op, $doc, $who)), $who . ' ' . $op);
                    }
                    assertSame([403, 'forbidden'], $code($commit($w, $doc, $newKey(), $who)), $who . ' commit');
                }
                assertSame([403, 'forbidden'], $code($get($w, $who, '/api/supplemental-payrolls/eligibility', 'month=2026-10')), $who . ' eligibility');
            }
        });
    },
    'an Employee reads only their own Committed document: a colleague\'s Committed document is 404 and never listed; their own Draft is 404' => static function () use ($world, $committedPlans, $draft, $committedDoc, $get, $ok, $code, $unchanged): void {
        $w = $world();
        $plans = $committedPlans($w);
        $mine = $committedDoc($w, $draft($w, $plans['e_a1'], 'e_a1'));
        $colleague = $committedDoc($w, $draft($w, $plans['e_a2'], 'e_a2'));
        $ownDraft = $draft($w, $plans['e_a1'], 'e_a1');
        $unchanged($w['db'], static function () use ($w, $mine, $colleague, $ownDraft, $get, $ok, $code): void {
            assertSame($mine['id'], $ok($get($w, 'empA1', '/api/supplemental-payroll', 'id=' . $mine['id']), 'own Committed')['supplementalPayroll']['id'], 'own Committed document readable');
            assertSame([$mine['id']], array_column($ok($get($w, 'empA1', '/api/supplemental-payrolls', 'month=2026-10'), 'own list')['supplementalPayrolls'], 'id'), 'only their own Committed document is listed');
            assertSame([404, 'not_found'], $code($get($w, 'empA1', '/api/supplemental-payroll', 'id=' . $colleague['id'])), 'a colleague\'s Committed document');
            assertSame([404, 'not_found'], $code($get($w, 'empA1', '/api/supplemental-payroll', 'id=' . $ownDraft['id'])), 'own Draft');
            assertSame([404, 'not_found'], $code($get($w, 'empB1', '/api/supplemental-payroll', 'id=' . $mine['id'])), 'another company Employee');
            assertSame([], $ok($get($w, 'empB1', '/api/supplemental-payrolls', 'month=2026-10'), 'other company list')['supplementalPayrolls'], 'another company Employee lists nothing of A');
        });
    },
    'another company\'s CEO gets 404 for every record route on company A, lists nothing of A, and its eligibility shows nothing of company A (C-1)' => static function () use ($world, $committedPlans, $draft, $committedDoc, $gen, $step, $commit, $get, $ok, $code, $unchanged, $newKey, $writes): void {
        $w = $world();
        $plans = $committedPlans($w);
        $d = $draft($w, $plans['e_a1'], 'e_a1');
        $done = $committedDoc($w, $draft($w, $plans['e_a2'], 'e_a2'));
        $unchanged($w['db'], static function () use ($w, $plans, $d, $done, $gen, $step, $commit, $get, $ok, $code, $newKey, $writes): void {
            assertSame([404, 'not_found'], $code($gen($w, $plans['e_a1']['id'], 'ceoB')), 'generate on company A\'s plan');
            foreach ([$d, $done] as $doc) {
                assertSame([404, 'not_found'], $code($get($w, 'ceoB', '/api/supplemental-payroll', 'id=' . $doc['id'])), 'detail ' . $doc['status']);
                foreach ($writes as $op) {
                    assertSame([404, 'not_found'], $code($step($w, $op, $doc, 'ceoB')), $op . ' ' . $doc['status']);
                }
                assertSame([404, 'not_found'], $code($commit($w, $doc, $newKey(), 'ceoB')), 'commit ' . $doc['status']);
            }
            assertSame([], $ok($get($w, 'ceoB', '/api/supplemental-payrolls', 'month=2026-10'), 'company B list')['supplementalPayrolls'], 'company B lists nothing of A');
            assertSame([], $ok($get($w, 'ceoB', '/api/supplemental-payrolls/eligibility', 'month=2026-10'), 'company B eligibility')['supplementalEligibility'], 'no row of company A');
        });
    },
    'forged scope fields from the CEO are 400 and never widen access; nothing is written' => static function () use ($world, $committedPlans, $draft, $post, $get, $unchanged): void {
        $w = $world();
        $plan = $committedPlans($w)['e_a1'];
        $d = $draft($w, $plan, 'e_a1');
        $forged = ['companyId' => $w['b'], 'company_id' => $w['b'], 'employeeId' => 'e_b1', 'role' => 'ceo', 'status' => 'Committed', 'overtimeAmount' => '1.00'];
        $unchanged($w['db'], static function () use ($w, $plan, $d, $forged, $post, $get): void {
            foreach ($forged as $key => $value) {
                assertSame(400, $post($w, 'ceoA', '/api/supplemental-payrolls/generate', ['payrollPlanId' => $plan['id'], $key => $value])->status, 'generate ' . $key);
                assertSame(400, $post($w, 'ceoA', '/api/supplemental-payrolls/review', ['id' => $d['id'], 'expectedVersion' => $d['version'], $key => $value])->status, 'review ' . $key);
                assertSame(400, $post($w, 'ceoA', '/api/supplemental-payrolls/commit', ['id' => $d['id'], 'expectedVersion' => $d['version'], 'expectedTotal' => $d['overtimeAmount'], 'idempotencyKey' => bin2hex(random_bytes(16)), $key => $value])->status, 'commit ' . $key);
            }
            assertSame(400, $get($w, 'ceoA', '/api/supplemental-payrolls', 'month=2026-10&companyId=' . $w['b'])->status, 'list with a forged company');
            assertSame(400, $get($w, 'ceoA', '/api/supplemental-payrolls/eligibility', 'month=2026-10&companyId=' . $w['b'])->status, 'eligibility with a forged company');
        });
    },
    'CSRF and Origin: a Supplemental mutation without its CSRF token, with another session\'s token or from another origin is 403 and writes nothing' => static function () use ($world, $committedPlans, $draft, $post, $code, $unchanged): void {
        $w = $world();
        $plan = $committedPlans($w)['e_a1'];
        $d = $draft($w, $plan, 'e_a1');
        $unchanged($w['db'], static function () use ($w, $plan, $d, $post, $code): void {
            foreach (['missing' => ['csrfToken' => null], 'another session' => ['csrfToken' => $w['s']['ceoB']['csrf']], 'another origin' => ['origin' => 'https://evil.test']] as $label => $over) {
                assertSame([403, 'forbidden'], $code($post($w, 'ceoA', '/api/supplemental-payrolls/review', ['id' => $d['id'], 'expectedVersion' => $d['version']], $over)), 'review ' . $label);
                assertSame([403, 'forbidden'], $code($post($w, 'ceoA', '/api/supplemental-payrolls/generate', ['payrollPlanId' => $plan['id']], $over)), 'generate ' . $label);
            }
        });
    },
];
