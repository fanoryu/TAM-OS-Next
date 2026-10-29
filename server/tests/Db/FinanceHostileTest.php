<?php
declare(strict_types=1);

/*
 * E11 hostile principals on the five Finance routes (SDR-0002 §17 E11) against the real MariaDB: no
 * session and a revoked session (401 on every route); an Employee on both month reads, both postings
 * and the execution (403 before any lookup, on their own obligations and a colleague's); another
 * company's CEO (404 when posting or executing company A's records, and its month reads show nothing
 * of company A); forged scope fields from the CEO (400); and a mutation without its CSRF token or from
 * another origin (403). Every refusal writes nothing and audits nothing. Fabricated data only.
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
$overtime = static function (Database $db, string $company, string $employee, string $amount): void {
    $db->execute("INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at, valuation_method, valuation_salary, valuation_standard_hours, approved_amount, approved_at) VALUES (?, ?, ?, '2026-10', NULL, '1.00', NULL, NULL, 'Approved', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'TAM-OT-1', '3200000.00', '160.00', ?, UTC_TIMESTAMP(6))",
        [bin2hex(random_bytes(16)), $company, $employee, $amount]);
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
/** A Committed Supplemental document of $plan's late overtime, through the real Supplemental routes. */
$committedDoc = static function (array $w, array $plan, string $employee) use ($overtime, $post, $ok, $newKey): array {
    $overtime($w['db'], $w['a'], $employee, '21875.00');
    $d = $ok($post($w, 'ceoA', '/api/supplemental-payrolls/generate', ['payrollPlanId' => $plan['id']]), 'supplemental generate')['supplementalPayroll'];
    foreach (['review', 'approve'] as $op) {
        $d = $ok($post($w, 'ceoA', '/api/supplemental-payrolls/' . $op, ['id' => $d['id'], 'expectedVersion' => $d['version']]), 'supplemental ' . $op)['supplementalPayroll'];
    }
    return $ok($post($w, 'ceoA', '/api/supplemental-payrolls/commit', ['id' => $d['id'], 'expectedVersion' => $d['version'], 'expectedTotal' => $d['overtimeAmount'], 'idempotencyKey' => $newKey()]), 'supplemental commit')['supplementalPayroll'];
};
$postPlan = static fn (array $w, array $plan, string $who = 'ceoA', array $extra = []): Response
    => $post($w, $who, '/api/finance-postings/payroll-plan', $extra + ['payrollPlanId' => $plan['id'], 'expectedAmount' => $plan['totalAmount'], 'idempotencyKey' => bin2hex(random_bytes(16))]);
$postDoc = static fn (array $w, array $doc, string $who = 'ceoA', array $extra = []): Response
    => $post($w, $who, '/api/finance-postings/supplemental-payroll', $extra + ['supplementalPayrollId' => $doc['id'], 'expectedAmount' => $doc['overtimeAmount'], 'idempotencyKey' => bin2hex(random_bytes(16))]);
$execute = static fn (array $w, array $posting, string $who = 'ceoA', array $extra = []): Response
    => $post($w, $who, '/api/finance-executions/execute', $extra + ['financePostingId' => $posting['id'], 'expectedAmount' => $posting['amount'], 'executedOn' => '2026-10-05', 'paymentMethod' => 'bankTransfer', 'idempotencyKey' => bin2hex(random_bytes(16))]);
/** Company A with one Planned posting of e_a1's plan, e_a2's Committed plan and e_a2's Committed Supplemental document, both unposted. */
$scenario = static function () use ($world, $committedPlans, $committedDoc, $postPlan, $ok): array {
    $w = $world();
    $plans = $committedPlans($w);
    $doc = $committedDoc($w, $plans['e_a2'], 'e_a2');
    $posting = $ok($postPlan($w, $plans['e_a1']), 'post e_a1')['financePosting'];
    return [$w, $plans, $doc, $posting];
};
/** Every table's row count. */
$counts = static function (Database $db): array {
    $out = [];
    foreach ($db->select('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME') as $t) {
        $out[(string) $t['t']] = (int) $db->select('SELECT COUNT(*) AS n FROM `' . $t['t'] . '`')[0]['n'];
    }
    return $out;
};
/** The same refusal must leave every table, every posting and every execution exactly as it was. */
$unchanged = static function (Database $db, Closure $fn) use ($counts): void {
    $rows = static fn (): array => [$counts($db), $db->select('SELECT * FROM finance_postings ORDER BY id'), $db->select('SELECT * FROM finance_executions ORDER BY id')];
    $before = $rows();
    $fn();
    assertSame($before, $rows(), 'nothing written, nothing audited');
};

return [
    '401: no session and a revoked session are refused on all five Finance routes, and nothing is written' => static function () use ($scenario, $unchanged): void {
        [$w, $plans, $doc, $posting] = $scenario();
        $calls = static function (?string $token, ?string $csrf) use ($w, $plans, $doc, $posting): array {
            return [
                'postings month' => $w['k']->handle(sessionRequest('GET', '/api/finance-postings', $token, null, '', ['query' => 'month=2026-10']), requestId()),
                'executions month' => $w['k']->handle(sessionRequest('GET', '/api/finance-executions', $token, null, '', ['query' => 'month=2026-10']), requestId()),
                'post plan' => $w['k']->handle(sessionRequest('POST', '/api/finance-postings/payroll-plan', $token, $csrf, json_encode(['payrollPlanId' => $plans['e_a2']['id'], 'expectedAmount' => $plans['e_a2']['totalAmount'], 'idempotencyKey' => bin2hex(random_bytes(16))], JSON_THROW_ON_ERROR)), requestId()),
                'post document' => $w['k']->handle(sessionRequest('POST', '/api/finance-postings/supplemental-payroll', $token, $csrf, json_encode(['supplementalPayrollId' => $doc['id'], 'expectedAmount' => $doc['overtimeAmount'], 'idempotencyKey' => bin2hex(random_bytes(16))], JSON_THROW_ON_ERROR)), requestId()),
                'execute' => $w['k']->handle(sessionRequest('POST', '/api/finance-executions/execute', $token, $csrf, json_encode(['financePostingId' => $posting['id'], 'expectedAmount' => $posting['amount'], 'executedOn' => '2026-10-05', 'paymentMethod' => 'bankTransfer', 'idempotencyKey' => bin2hex(random_bytes(16))], JSON_THROW_ON_ERROR)), requestId()),
            ];
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
    'an Employee is 403 on both month reads, both postings and the execution — their own obligations and a colleague\'s — and nothing is written' => static function () use ($scenario, $get, $postPlan, $postDoc, $execute, $code, $unchanged): void {
        [$w, $plans, $doc, $posting] = $scenario();
        $unchanged($w['db'], static function () use ($w, $plans, $doc, $posting, $get, $postPlan, $postDoc, $execute, $code): void {
            foreach (['empA1', 'empA2', 'empB1'] as $who) {
                assertSame([403, 'forbidden'], $code($get($w, $who, '/api/finance-postings', 'month=2026-10')), $who . ' postings month');
                assertSame([403, 'forbidden'], $code($get($w, $who, '/api/finance-executions', 'month=2026-10')), $who . ' executions month');
                foreach (['e_a1', 'e_a2'] as $employee) {
                    assertSame([403, 'forbidden'], $code($postPlan($w, $plans[$employee], $who)), $who . ' post plan of ' . $employee);
                }
                assertSame([403, 'forbidden'], $code($postDoc($w, $doc, $who)), $who . ' post document');
                assertSame([403, 'forbidden'], $code($execute($w, $posting, $who)), $who . ' execute');
            }
        });
    },
    'another company\'s CEO gets 404 when posting or executing company A\'s records, and its month reads show nothing of company A' => static function () use ($scenario, $get, $ok, $postPlan, $postDoc, $execute, $code, $unchanged): void {
        [$w, $plans, $doc, $posting] = $scenario();
        $unchanged($w['db'], static function () use ($w, $plans, $doc, $posting, $get, $ok, $postPlan, $postDoc, $execute, $code): void {
            assertSame([404, 'not_found'], $code($postPlan($w, $plans['e_a2'], 'ceoB')), 'post company A\'s plan');
            assertSame([404, 'not_found'], $code($postDoc($w, $doc, 'ceoB')), 'post company A\'s document');
            assertSame([404, 'not_found'], $code($execute($w, $posting, 'ceoB')), 'execute company A\'s posting');
            assertSame([], $ok($get($w, 'ceoB', '/api/finance-postings', 'month=2026-10'), 'company B postings')['financePostings'], 'no posting of company A');
            assertSame([], $ok($get($w, 'ceoB', '/api/finance-executions', 'month=2026-10'), 'company B executions')['financeExecutions'], 'no execution of company A');
        });
    },
    'forged scope fields from the CEO are 400 and never widen access; nothing is written' => static function () use ($scenario, $get, $postPlan, $postDoc, $execute, $unchanged): void {
        [$w, $plans, $doc, $posting] = $scenario();
        $forged = ['companyId' => $w['b'], 'company_id' => $w['b'], 'employeeId' => 'e_b1', 'role' => 'ceo', 'status' => 'Executed', 'amount' => '1.00'];
        $unchanged($w['db'], static function () use ($w, $plans, $doc, $posting, $forged, $get, $postPlan, $postDoc, $execute): void {
            foreach ($forged as $key => $value) {
                assertSame(400, $postPlan($w, $plans['e_a2'], 'ceoA', [$key => $value])->status, 'post plan ' . $key);
                assertSame(400, $postDoc($w, $doc, 'ceoA', [$key => $value])->status, 'post document ' . $key);
                assertSame(400, $execute($w, $posting, 'ceoA', [$key => $value])->status, 'execute ' . $key);
            }
            assertSame(400, $get($w, 'ceoA', '/api/finance-postings', 'month=2026-10&companyId=' . $w['b'])->status, 'postings month with a forged company');
            assertSame(400, $get($w, 'ceoA', '/api/finance-executions', 'month=2026-10&companyId=' . $w['b'])->status, 'executions month with a forged company');
        });
    },
    'CSRF and Origin: a Finance mutation without its CSRF token, with another session\'s token or from another origin is 403 and writes nothing' => static function () use ($scenario, $postPlan, $execute, $code, $unchanged, $post): void {
        [$w, $plans, , $posting] = $scenario();
        $unchanged($w['db'], static function () use ($w, $plans, $posting, $post, $code): void {
            foreach (['missing' => ['csrfToken' => null], 'another session' => ['csrfToken' => $w['s']['ceoB']['csrf']], 'another origin' => ['origin' => 'https://evil.test']] as $label => $over) {
                assertSame([403, 'forbidden'], $code($post($w, 'ceoA', '/api/finance-postings/payroll-plan', ['payrollPlanId' => $plans['e_a2']['id'], 'expectedAmount' => $plans['e_a2']['totalAmount'], 'idempotencyKey' => bin2hex(random_bytes(16))], $over)), 'post plan ' . $label);
                assertSame([403, 'forbidden'], $code($post($w, 'ceoA', '/api/finance-executions/execute', ['financePostingId' => $posting['id'], 'expectedAmount' => $posting['amount'], 'executedOn' => '2026-10-05', 'paymentMethod' => 'bankTransfer', 'idempotencyKey' => bin2hex(random_bytes(16))], $over)), 'execute ' . $label);
            }
        });
    },
];
