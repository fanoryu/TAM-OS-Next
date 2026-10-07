<?php
declare(strict_types=1);

/*
 * BF-4f Finance execution against the real MariaDB (owner decisions D-FEX-1..8 = A): real login →
 * real session → production routes → FinanceExecutionService → FinanceExecutionStore / AuditLog. A
 * base plan and a Supplemental document are committed through the real Payroll and Supplemental
 * routes and posted through the real BF-4e routes; each Planned posting is then executed. Proven: the
 * execution (the posting's employee, month and exact amount, the stated date and payment method; one
 * finance.execute 'execute' audit row on the posting), the posting itself never written and still
 * Planned, every refusal (an absent or foreign posting, a wrong expectedAmount, a second execution,
 * a future date) writing nothing and consuming no key, the same request twice, the dropped-response
 * replay and every key mismatch (another posting, another amount, date or payment method), the
 * month read and the Employee's 403s, audit rollback, and the firewalls: the posting, its source,
 * overtime and employees are never written. Fabricated data only.
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Finance\FinanceExecutionView;
use TamOs\Finance\FinancePostingView;
use TamOs\Http\Kernel;
use TamOs\Http\Response;
use function TamOs\Tests\assertNoLeak;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
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
 * Company A: a CEO; e_a1 and e_a2 (Employee logins), e_a3. Company B: a CEO and e_b1 (an Employee
 * login). Every salary is positive, so the Payroll generate makes a plan for each.
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
    employeeAnchor($db, $a, 'e_a3');
    $db->execute("UPDATE employees SET monthly_base_salary = '3500000.00' WHERE id = 'e_a1'");
    $db->execute("UPDATE employees SET monthly_base_salary = '2000000.00' WHERE id IN ('e_a2', 'e_a3', 'e_b1')");
    $s = [];
    foreach ($fixtures as $name => $f) {
        $r = $k->handle(loginRequest($f['email'], (string) $f['password']), requestId());
        assertSame(200, $r->status, 'login ' . $name);
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken']];
    }
    return ['db' => $db, 'k' => $k, 'a' => $a, 'b' => $ceoB['companyId'], 's' => $s];
};
/** Test-only SQL: an Approved overtime record with a frozen snapshot and $amount — "approved now". */
$overtime = static function (Database $db, string $company, string $employee, string $month, string $hours, string $amount): string {
    $id = bin2hex(random_bytes(16));
    $db->execute("INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at, valuation_method, valuation_salary, valuation_standard_hours, approved_amount, approved_at) VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, 'Approved', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'TAM-OT-1', '3200000.00', '160.00', ?, UTC_TIMESTAMP(6))",
        [$id, $company, $employee, $month, $hours, $amount]);
    return $id;
};
$get = static fn (array $w, string $who, string $path, string $query = ''): Response
    => $w['k']->handle(sessionRequest('GET', $path, $w['s'][$who]['token'], null, '', ['query' => $query]), requestId());
$post = static fn (array $w, string $who, string $path, array $body): Response
    => $w['k']->handle(sessionRequest('POST', $path, $w['s'][$who]['token'], $w['s'][$who]['csrf'], json_encode($body, JSON_THROW_ON_ERROR)), requestId());
$ok = static function (Response $r, string $label): array {
    assertSame(200, $r->status, $label . ' (' . substr($r->body, 0, 300) . ')');
    return envelope($r)['data'];
};
$code = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
$newKey = static fn (): string => bin2hex(random_bytes(16));
/** $employee's base plan of $month, generated, approved and committed through the real Payroll routes by $who, then posted through BF-4e: the Planned posting. */
$posted = static function (array $w, string $employee, string $month = '2026-10', string $who = 'ceoA') use ($post, $ok, $newKey): array {
    $plans = [];
    foreach ($ok($post($w, $who, '/api/payroll-plans/generate', ['month' => $month]), 'payroll generate')['payrollPlans'] as $p) {
        $plans[$p['employeeId']] = $p;
    }
    $p = $ok($post($w, $who, '/api/payroll-plans/approve', ['id' => $plans[$employee]['id'], 'expectedVersion' => $plans[$employee]['version']]), 'payroll approve')['payrollPlan'];
    $p = $ok($post($w, $who, '/api/payroll-plans/commit', ['id' => $p['id'], 'expectedVersion' => $p['version'], 'expectedTotal' => $p['totalAmount'], 'idempotencyKey' => $newKey()]), 'payroll commit')['payrollPlan'];
    return $ok($post($w, $who, '/api/finance-postings/payroll-plan', ['payrollPlanId' => $p['id'], 'expectedAmount' => $p['totalAmount'], 'idempotencyKey' => $newKey()]), 'post plan')['financePosting'];
};
/** A Committed Supplemental document of $planId's late overtime, posted through BF-4e: the Planned posting. */
$postedDoc = static function (array $w, string $planId, string $who = 'ceoA') use ($post, $ok, $newKey): array {
    $d = $ok($post($w, $who, '/api/supplemental-payrolls/generate', ['payrollPlanId' => $planId]), 'supplemental generate')['supplementalPayroll'];
    foreach (['review', 'approve'] as $op) {
        $d = $ok($post($w, $who, '/api/supplemental-payrolls/' . $op, ['id' => $d['id'], 'expectedVersion' => $d['version']]), 'supplemental ' . $op)['supplementalPayroll'];
    }
    $d = $ok($post($w, $who, '/api/supplemental-payrolls/commit', ['id' => $d['id'], 'expectedVersion' => $d['version'], 'expectedTotal' => $d['overtimeAmount'], 'idempotencyKey' => $newKey()]), 'supplemental commit')['supplementalPayroll'];
    return $ok($post($w, $who, '/api/finance-postings/supplemental-payroll', ['supplementalPayrollId' => $d['id'], 'expectedAmount' => $d['overtimeAmount'], 'idempotencyKey' => $newKey()]), 'post document')['financePosting'];
};
$execute = static fn (array $w, array $posting, string $key, array $over = [], string $who = 'ceoA'): Response
    => $post($w, $who, '/api/finance-executions/execute', $over + ['financePostingId' => $posting['id'], 'expectedAmount' => $posting['amount'], 'executedOn' => '2026-10-05', 'paymentMethod' => 'bankTransfer', 'idempotencyKey' => $key]);
$executions = static fn (Database $db): array => $db->select('SELECT * FROM finance_executions ORDER BY id');
$audits = static fn (Database $db, string $id): array => array_map(static fn (array $r): string => $r['action'] . ' ' . $r['entity'] . ' ' . $r['operation'],
    $db->select('SELECT action, entity, operation FROM audit_events WHERE entity_id = ? ORDER BY id', [$id]));
/** Every table's row count. */
$counts = static function (Database $db): array {
    $out = [];
    foreach ($db->select('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME') as $t) {
        $out[(string) $t['t']] = (int) $db->select('SELECT COUNT(*) AS n FROM `' . $t['t'] . '`')[0]['n'];
    }
    return $out;
};
/** The state an execution must never write: postings, base plans and their links, Supplemental documents and theirs, overtime and employees. */
$sources = static fn (Database $db): array => [$db->select('SELECT * FROM finance_postings ORDER BY id'), $db->select('SELECT * FROM payroll_plans ORDER BY id'), $db->select('SELECT * FROM payroll_plan_overtime ORDER BY id'),
    $db->select('SELECT * FROM supplemental_payrolls ORDER BY id'), $db->select('SELECT * FROM supplemental_payroll_overtime ORDER BY id'),
    $db->select('SELECT * FROM overtime_records ORDER BY id'), $db->select('SELECT * FROM employees ORDER BY id')];
/** Asserts a refused request changed nothing at all: every table's rows. */
$unchanged = static function (Database $db, Closure $fn) use ($counts, $executions, $sources): void {
    $before = [$counts($db), $executions($db), $sources($db), $db->select('SELECT * FROM audit_events ORDER BY id')];
    $fn();
    assertSame($before, [$counts($db), $executions($db), $sources($db), $db->select('SELECT * FROM audit_events ORDER BY id')], 'nothing written');
};

return [
    'a Planned base plan posting is executed in full: the posting\'s employee, month and exact amount, the stated date and method; one finance.execute execute audit row on the posting; the posting is never written and stays Planned' => static function () use ($world, $overtime, $posted, $execute, $ok, $executions, $audits, $sources, $counts, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $overtime($db, $w['a'], 'e_a1', '2026-10', '10.00', '218750.00');
        $f = $posted($w, 'e_a1');
        assertSame(['Planned', '3718750.00'], [$f['status'], $f['amount']]);
        $src = $sources($db);
        $before = $counts($db);
        $key = $newKey();
        $out = $ok($execute($w, $f, $key, ['executedOn' => '2026-10-03', 'paymentMethod' => 'cash']), 'execute');
        assertSame(['financeExecution'], array_keys($out));
        $e = $out['financeExecution'];
        assertSame(FinanceExecutionView::FIELDS, array_keys($e), 'exactly the seven execution keys');
        assertSame([$f['id'], 'e_a1', '2026-10', '3718750.00', '2026-10-03', 'cash'], [$e['financePostingId'], $e['employeeId'], $e['monthKey'], $e['amount'], $e['executedOn'], $e['paymentMethod']], 'the posting, its exact amount, the date and the method');
        $rows = $executions($db);
        assertSame(1, count($rows));
        $r = $rows[0];
        assertSame([$e['id'], $w['a'], $f['id'], 'e_a1', '2026-10', '3718750.00', '2026-10-03', 'cash', $key],
            [$r['id'], $r['company_id'], $r['finance_posting_id'], $r['employee_id'], $r['month_key'], (string) $r['amount'], (string) $r['executed_on'], $r['payment_method'], $r['idempotency_key']], 'the stored execution');
        foreach ($counts($db) as $table => $n) {
            assertSame(($before[$table] ?? 0) + (['finance_executions' => 1, 'audit_events' => 1][$table] ?? 0), $n, $table . ': one execution row and one audit row only');
        }
        assertSame(['finance.execute financePosting execute'], $audits($db, $f['id']), 'one execute row on the posting');
        $a = $db->select("SELECT fields, target_user_id, request_id FROM audit_events WHERE entity_id = ? AND operation = 'execute'", [$f['id']])[0];
        assertSame([null, null], [$a['fields'], $a['target_user_id']], 'no field, no value');
        assertSame([], $audits($db, $e['id']), 'the execution id itself is never an audit entity');
        assertSame($src, $sources($db), 'no posting, plan, link, document, overtime or employee write');
        assertSame('Planned', (string) $db->select('SELECT status FROM finance_postings WHERE id = ?', [$f['id']])[0]['status'], 'the posting is still Planned (D-FEX-1 = A)');
    },
    'a Planned Supplemental posting is executed in full at its own amount; the base plan posting is executed separately; the month read lists both' => static function () use ($world, $overtime, $posted, $postedDoc, $execute, $ok, $get, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $f = $posted($w, 'e_a1');
        $overtime($db, $w['a'], 'e_a1', '2026-10', '2.50', '54688.00');
        $g = $postedDoc($w, $f['sourceId']);
        assertSame(['supplementalPayroll', '54688.00'], [$g['sourceKind'], $g['amount']]);
        $e1 = $ok($execute($w, $g, $newKey(), ['paymentMethod' => 'qris']), 'execute the Supplemental posting')['financeExecution'];
        assertSame([$g['id'], '54688.00', 'qris'], [$e1['financePostingId'], $e1['amount'], $e1['paymentMethod']]);
        $e2 = $ok($execute($w, $f, $newKey(), ['paymentMethod' => 'virtualAccount']), 'execute the base plan posting')['financeExecution'];
        assertSame([$f['id'], '3500000.00'], [$e2['financePostingId'], $e2['amount']], 'never combined with its Supplemental posting');
        $list = $ok($get($w, 'ceoA', '/api/finance-executions', 'month=2026-10'), 'month')['financeExecutions'];
        $ids = array_column($list, 'id');
        sort($ids);
        $want = [$e1['id'], $e2['id']];
        sort($want);
        assertSame($want, $ids, 'two executions of the month');
        foreach ($list as $x) {
            assertSame(FinanceExecutionView::FIELDS, array_keys($x));
        }
        $postings = $ok($get($w, 'ceoA', '/api/finance-postings', 'month=2026-10'), 'posting month read')['financePostings'];
        assertSame(2, count($postings));
        foreach ($postings as $p) {
            assertSame([FinancePostingView::FIELDS, 'Planned'], [array_keys($p), $p['status']], 'the posting read is unchanged: seven keys, still Planned (D-FEX-6 = A)');
        }
    },
    'the same request twice: the second answers the original execution — no write, no audit (D-FEX-6 = A)' => static function () use ($world, $posted, $execute, $ok, $counts, $executions, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $f = $posted($w, 'e_a1');
        $key = $newKey();
        $first = $ok($execute($w, $f, $key), 'execute')['financeExecution'];
        $before = [$counts($db), $executions($db), $db->select('SELECT * FROM audit_events ORDER BY id')];
        assertSame($first, $ok($execute($w, $f, $key), 'the same request again')['financeExecution'], 'the original execution');
        assertSame($before, [$counts($db), $executions($db), $db->select('SELECT * FROM audit_events ORDER BY id')], 'a replay writes nothing — no execution, no audit row');
    },
    'a dropped response: the execution committed but the client never saw the answer; it re-reads, then retries with the same body and key and receives the original — exactly one execution' => static function () use ($world, $posted, $execute, $ok, $get, $counts, $executions, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $f = $posted($w, 'e_a1');
        $key = $newKey();
        $execute($w, $f, $key, ['executedOn' => '2026-10-01', 'paymentMethod' => 'creditCard']);  // the answer is lost in transit
        $seen = $ok($get($w, 'ceoA', '/api/finance-executions', 'month=2026-10'), 're-read')['financeExecutions'];
        assertSame(1, count($seen), 'the re-read shows the committed execution');
        $before = [$counts($db), $executions($db)];
        $retry = $ok($execute($w, $f, $key, ['executedOn' => '2026-10-01', 'paymentMethod' => 'creditCard']), 'retry, same body and key')['financeExecution'];
        assertSame($seen[0], $retry, 'the retry answers the original execution');
        assertSame($before, [$counts($db), $executions($db)], 'the retry wrote nothing');
        assertSame(1, (int) $db->select("SELECT COUNT(*) AS n FROM audit_events WHERE operation = 'execute'")[0]['n'], 'one execute audit row, ever');
    },
    'exactly one execution per posting: a second execution with another key is 409 — whatever its amount, date or method — and writes nothing' => static function () use ($world, $posted, $execute, $ok, $code, $unchanged, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $f = $posted($w, 'e_a1');
        $ok($execute($w, $f, $newKey()), 'execute');
        foreach ([[], ['executedOn' => '2026-10-06'], ['paymentMethod' => 'cash'], ['expectedAmount' => '1.00'], ['expectedAmount' => '1750000.00']] as $i => $over) {
            $unchanged($db, static fn () => assertSame([409, 'conflict'], $code($execute($w, $f, $newKey(), $over)), 'a second execution ' . $i . ' (D-FEX-2 = A)'));
        }
    },
    'the idempotency key names one execution of one posting with one body: reused on another posting, or with another amount, date or method, it is 409 and writes nothing' => static function () use ($world, $posted, $execute, $ok, $code, $unchanged, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $f1 = $posted($w, 'e_a1');
        $f2 = $posted($w, 'e_a2');
        $f3 = $posted($w, 'e_a3');
        assertSame($f2['amount'], $f3['amount'], 'two postings at one amount');
        $key = $newKey();
        $ok($execute($w, $f1, $key), 'execute f1');
        $unchanged($db, static fn () => assertSame([409, 'conflict'], $code($execute($w, $f2, $key)), 'another posting'));
        $unchanged($db, static fn () => assertSame([409, 'conflict'], $code($execute($w, $f1, $key, ['executedOn' => '2026-10-04'])), 'the same posting, another date'));
        $unchanged($db, static fn () => assertSame([409, 'conflict'], $code($execute($w, $f1, $key, ['paymentMethod' => 'other'])), 'the same posting, another method'));
        $unchanged($db, static fn () => assertSame([409, 'conflict'], $code($execute($w, $f1, $key, ['expectedAmount' => '1.00'])), 'the same posting, another amount'));
        $k2 = $newKey();
        $ok($execute($w, $f2, $k2), 'execute f2');
        $unchanged($db, static fn () => assertSame([409, 'conflict'], $code($execute($w, $f3, $k2)), 'another posting at the same amount and body is never a replay'));
        assertSame($f3['id'], $ok($execute($w, $f3, $newKey()), 'f3 with its own key')['financeExecution']['financePostingId']);
    },
    'expectedAmount is only a guard: any other amount is 409, writes nothing and consumes no key; the stored amount is always the posting\'s own' => static function () use ($world, $posted, $execute, $ok, $code, $unchanged, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $f = $posted($w, 'e_a1');
        $key = $newKey();
        foreach (['3499999.00', '3500001.00', '1750000.00', '7000000.00', '1.00'] as $bad) {
            $unchanged($db, static fn () => assertSame([409, 'conflict'], $code($execute($w, $f, $key, ['expectedAmount' => $bad])), 'at ' . $bad . ' (no partial, over- or under-payment)'));
        }
        assertSame('3500000.00', $ok($execute($w, $f, $key), 'the same key at the exact amount')['financeExecution']['amount']);
    },
    'an absent posting, another company\'s posting and a source id are 404; a future date is 400; nothing is written and no key is consumed' => static function () use ($world, $posted, $execute, $ok, $code, $unchanged, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $f = $posted($w, 'e_a1');
        $fb = $posted($w, 'e_b1', '2026-10', 'ceoB');
        $key = $newKey();
        $unchanged($db, static fn () => assertSame([404, 'not_found'], $code($execute($w, ['id' => bin2hex(random_bytes(16)), 'amount' => '1.00'], $key)), 'absent posting'));
        $unchanged($db, static fn () => assertSame([404, 'not_found'], $code($execute($w, $fb, $key)), "another company's posting is absent"));
        $unchanged($db, static fn () => assertSame([404, 'not_found'], $code($execute($w, ['id' => $f['sourceId']] + $f, $key)), 'a plan id is not a posting id'));
        $future = (new \DateTimeImmutable('now', new \DateTimeZone('Asia/Jakarta')))->modify('+2 days')->format('Y-m-d');
        $unchanged($db, static fn () => assertSame([400, 'validation_failed'], $code($execute($w, $f, $key, ['executedOn' => $future])), 'a date after today in the company calendar'));
        $today = (new \DateTimeImmutable('now', new \DateTimeZone('Asia/Jakarta')))->format('Y-m-d');
        $e = $ok($execute($w, $f, $key, ['executedOn' => $today]), 'the same key, never consumed by a refusal, executes today')['financeExecution'];
        assertSame($today, $e['executedOn'], 'today in the company calendar is accepted');
        assertSame('1999-12-31', $ok($execute($w, $fb, $key, ['executedOn' => '1999-12-31'], 'ceoB'), 'the same key in another company, an old date (no lower bound)')['financeExecution']['executedOn']);
    },
    'reads: the CEO lists every execution of the month (company scope); an Employee is 403 on the month read and on the command — their own posting included; another company sees none' => static function () use ($world, $posted, $execute, $ok, $code, $get, $unchanged, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $f1 = $posted($w, 'e_a1');
        $f2 = $posted($w, 'e_a2');
        $ok($execute($w, $f1, $newKey()), 'execute');
        assertSame(1, count($ok($get($w, 'ceoA', '/api/finance-executions', 'month=2026-10'), 'month')['financeExecutions']));
        assertSame([], $ok($get($w, 'ceoA', '/api/finance-executions', 'month=2026-11'), 'another month')['financeExecutions']);
        assertSame([], $ok($get($w, 'ceoB', '/api/finance-executions', 'month=2026-10'), 'another company')['financeExecutions'], 'company scope');
        foreach (['empA1', 'empA2', 'empB1'] as $who) {
            $r = $get($w, $who, '/api/finance-executions', 'month=2026-10');
            assertSame([403, 'forbidden'], $code($r), $who . ' month read (CEO only)');
            assertNoLeak($r->body, ['3500000.00', 'bankTransfer', 'Fixture e_a']);
        }
        $unchanged($db, static fn () => assertSame([403, 'forbidden'], $code($execute($w, $f2, $newKey(), [], 'empA2')), 'an Employee executing their own posting'));
        $unchanged($db, static fn () => assertSame([403, 'forbidden'], $code($execute($w, $f2, $newKey(), [], 'empA1')), "an Employee executing a colleague's posting"));
        $unchanged($db, static fn () => assertSame([404, 'not_found'], $code($execute($w, $f2, $newKey(), [], 'ceoB')), "another company's CEO"));
    },
    'a failing audit append rolls the execution back entirely; the same key then executes' => static function () use ($world, $posted, $execute, $ok, $code, $counts, $executions, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $f = $posted($w, 'e_a1');
        $block = static function (Closure $fn) use ($db): void {
            $last = (string) $db->select('SELECT MAX(occurred_at) AS t FROM audit_events')[0]['t'];
            usleep(2000);
            // Test-only DDL: every further audit insert violates this CHECK — inside the execution's transaction.
            $db->execute("ALTER TABLE audit_events ADD CONSTRAINT test_block_audit CHECK (occurred_at <= '" . $last . "')");
            try {
                $fn();
            } finally {
                $db->execute('ALTER TABLE audit_events DROP CONSTRAINT test_block_audit');
            }
        };
        $key = $newKey();
        $before = [$counts($db), $executions($db)];
        $block(static fn () => assertSame([500, 'internal_error'], $code($execute($w, $f, $key)), 'execute'));
        assertSame($before, [$counts($db), $executions($db)], 'rolled back: no execution, no key');
        assertSame($f['id'], $ok($execute($w, $f, $key), 'the same key after the rollback')['financeExecution']['financePostingId']);
    },
    'firewalls: an execution never writes a posting, a source, a link, overtime or an employee; the posting is never re-posted or changed; the posting and source DTOs keep their keys; nothing is reversed or corrected' => static function () use ($world, $posted, $execute, $ok, $code, $get, $post, $sources, $newKey): void {
        $w = $world();
        $db = $w['db'];
        $f = $posted($w, 'e_a1');
        $src = $sources($db);
        $ok($execute($w, $f, $newKey()), 'execute');
        assertSame($src, $sources($db), 'every posting, source and employee row is unchanged');
        $plan = $ok($get($w, 'ceoA', '/api/payroll-plan', 'id=' . $f['sourceId']), 'base plan detail')['payrollPlan'];
        assertSame([13, 'Committed', $f['amount']], [count($plan), $plan['status'], $plan['totalAmount']], 'the base plan DTO and status are unchanged');
        assertSame([409, 'conflict'], $code($post($w, 'ceoA', '/api/finance-postings/payroll-plan', ['payrollPlanId' => $f['sourceId'], 'expectedAmount' => $f['amount'], 'idempotencyKey' => $newKey()])), 'an executed posting is still the one posting of its plan');
        $cols = array_map(static fn (array $r): string => (string) $r['c'], $db->select("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_postings' ORDER BY ORDINAL_POSITION"));
        assertSame(['id', 'company_id', 'source_kind', 'payroll_plan_id', 'supplemental_payroll_id', 'employee_id', 'month_key', 'amount', 'status', 'idempotency_key', 'posted_at'], $cols, 'the BF-4e posting table is unchanged');
        assertSame(['Planned'], array_values(array_unique(array_map(static fn (array $r): string => (string) $r['status'], $db->select('SELECT status FROM finance_postings')))), 'every posting is still Planned');
        foreach (['/api/finance-executions/reverse', '/api/finance-executions/correct', '/api/finance-executions/batch'] as $path) {
            assertSame(404, $post($w, 'ceoA', $path, ['financePostingId' => $f['id']])->status, $path);
        }
        assertTrue(count($ok($get($w, 'ceoA', '/api/finance-executions', 'month=2026-10'), 'month')['financeExecutions']) === 1, 'one execution');
    },
];
