<?php
declare(strict_types=1);

/*
 * Phase 1 general transactions and the financial report against the real MariaDB (D-INT-1, D-INT-2):
 * real login → real session → production routes → TransactionService / FinancialReportService →
 * TransactionStore / FinancialReportStore / AuditLog. Proven: a create stores exactly the values
 * sent with the actor as creator and one finance.manage 'create' audit row; the same request twice
 * and a dropped-response replay answer the original with no second row or audit; a key reused with
 * other values is 409 and writes nothing; a void writes one void row and one 'void' audit row and
 * derives Voided, a replayed void writes nothing, a second void is 409, an unknown id 404; the range
 * read honours its inclusive boundaries; and the report reconciles exactly with the database rows —
 * every Financial Post line, the general total, the voided rows, and a separate Payroll line made of
 * real Finance postings and executions that never appears inside a post — while the payroll posting
 * and payment rows stay byte-identical. PD-7: the range read lists exactly 2,000 rows and fails closed
 * (500, no partial list) at 2,001; the report totals exactly 20,000 rows and fails closed (500, no
 * partial total) at 20,001. Fabricated data only.
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
use TamOs\Http\Response;
use TamOs\Transaction\TransactionView;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
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
 * Company A: a CEO and e_a1 (an Employee login, salary 3,500,000). Company B: a CEO.
 *
 * @return array{db: Database, k: Kernel, a: string, b: string, s: array<string, array{token: string, csrf: string}>, ceoUser: string}
 */
$world = static function (): array {
    $db = authDatabase();
    $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
    $ceoA = authFixture($db);
    $ceoB = authFixture($db);
    $fixtures = ['ceoA' => $ceoA, 'empA1' => authFixture($db, ['companyId' => $ceoA['companyId'], 'role' => 'employee', 'employeeId' => 'e_a1']), 'ceoB' => $ceoB];
    $db->execute("UPDATE employees SET monthly_base_salary = '3500000.00' WHERE id = 'e_a1'");
    $s = [];
    foreach ($fixtures as $name => $f) {
        $r = $k->handle(loginRequest($f['email'], (string) $f['password']), requestId());
        assertSame(200, $r->status, 'login ' . $name);
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken']];
    }
    $ceoUser = (string) $db->select("SELECT user_id FROM memberships WHERE company_id = ? AND role = 'ceo'", [$ceoA['companyId']])[0]['user_id'];
    return ['db' => $db, 'k' => $k, 'a' => $ceoA['companyId'], 'b' => $ceoB['companyId'], 's' => $s, 'ceoUser' => $ceoUser];
};
$get = static fn (array $w, string $who, string $path, string $query): Response
    => $w['k']->handle(sessionRequest('GET', $path, $w['s'][$who]['token'], null, '', ['query' => $query]), requestId());
$post = static fn (array $w, string $who, string $path, array $body): Response
    => $w['k']->handle(sessionRequest('POST', $path, $w['s'][$who]['token'], $w['s'][$who]['csrf'], json_encode($body, JSON_THROW_ON_ERROR)), requestId());
$ok = static function (Response $r, string $label): array {
    assertSame(200, $r->status, $label . ' (' . substr($r->body, 0, 300) . ')');
    return envelope($r)['data'];
};
$code = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
$newKey = static fn (): string => bin2hex(random_bytes(16));
$body = static fn (array $over = []): array => $over + ['kind' => 'expense', 'financialPost' => 'NPIP', 'category' => 'Operasional Kegiatan', 'description' => 'Fabricated field trip', 'amount' => '750000.00', 'transactionDate' => '2026-10-10', 'idempotencyKey' => bin2hex(random_bytes(16))];
$create = static fn (array $w, array $b, string $who = 'ceoA'): Response => $post($w, $who, '/api/general-transactions/create', $b);
$void = static fn (array $w, string $id, string $key, string $reason = 'Fabricated duplicate'): Response
    => $post($w, 'ceoA', '/api/general-transactions/void', ['financeTransactionId' => $id, 'reason' => $reason, 'idempotencyKey' => $key]);
$audits = static fn (Database $db, string $id): array => array_map(static fn (array $r): string => $r['action'] . ' ' . $r['entity'] . ' ' . $r['operation'] . ' ' . ($r['fields'] ?? '-'),
    $db->select('SELECT action, entity, operation, fields FROM audit_events WHERE entity_id = ? ORDER BY id', [$id]));
$rows = static fn (Database $db): array => [$db->select('SELECT * FROM finance_transactions ORDER BY id'), $db->select('SELECT * FROM finance_transaction_voids ORDER BY id'), $db->select('SELECT * FROM audit_events ORDER BY id')];
/**
 * PD-7: $count fabricated income rows of 1.00 for company $company, numbered from $from, dated across $month
 * (day 1..28), the posts in turn GA, NPIP, TJB, DRONE. Inserted 1,000 per statement.
 */
$bulkTransactions = static function (Database $db, string $company, string $user, int $from, int $count, string $month): void {
    $posts = ['GA', 'NPIP', 'TJB', 'DRONE'];
    for ($start = $from; $start < $from + $count; $start += 1000) {
        $values = [];
        for ($n = $start; $n < min($start + 1000, $from + $count); $n++) {
            $values[] = sprintf("('%032x', '%s', 'income', '%s', 'Fabricated Cap', 'Fabricated cap row', '1.00', '%s-%02d', '%s', 'c%031x', UTC_TIMESTAMP(6))",
                $n + 1, $company, $posts[$n % 4], $month, 1 + $n % 28, $user, $n + 1);
        }
        $db->execute('INSERT INTO finance_transactions (id, company_id, kind, financial_post, category, description, amount, transaction_date, created_by_user_id, idempotency_key, created_at) VALUES ' . implode(', ', $values));
    }
};
/** PD-7: a failed-closed read is the bare error envelope — no data, no row, no total. */
$failedClosed = static function (Response $r, string $label): void {
    $e = envelope($r);
    $keys = array_keys($e);
    sort($keys);
    assertSame(['error', 'ok', 'requestId'], $keys, $label . ': only the error envelope');
    assertSame(false, $e['ok'], $label . ': not ok');
    assertTrue(!str_contains($r->body, 'Fabricated') && !str_contains($r->body, 'generalTransactions') && !str_contains($r->body, 'financialReport') && !str_contains($r->body, '.00'), $label . ': nothing partial in the body');
};
/** e_a1's base plan of $month, approved, committed, posted (BF-4e) and, when $paidOn is given, executed (BF-4f): the posting. */
$payroll = static function (array $w, string $month, ?string $paidOn) use ($post, $ok, $newKey): array {
    $plan = $ok($post($w, 'ceoA', '/api/payroll-plans/generate', ['month' => $month]), 'payroll generate')['payrollPlans'][0];
    $plan = $ok($post($w, 'ceoA', '/api/payroll-plans/approve', ['id' => $plan['id'], 'expectedVersion' => $plan['version']]), 'payroll approve')['payrollPlan'];
    $plan = $ok($post($w, 'ceoA', '/api/payroll-plans/commit', ['id' => $plan['id'], 'expectedVersion' => $plan['version'], 'expectedTotal' => $plan['totalAmount'], 'idempotencyKey' => $newKey()]), 'payroll commit')['payrollPlan'];
    $posting = $ok($post($w, 'ceoA', '/api/finance-postings/payroll-plan', ['payrollPlanId' => $plan['id'], 'expectedAmount' => $plan['totalAmount'], 'idempotencyKey' => $newKey()]), 'post plan')['financePosting'];
    if ($paidOn !== null) {
        $ok($post($w, 'ceoA', '/api/finance-executions/execute', ['financePostingId' => $posting['id'], 'expectedAmount' => $posting['amount'], 'executedOn' => $paidOn, 'paymentMethod' => 'bankTransfer', 'idempotencyKey' => $newKey()]), 'execute');
    }
    return $posting;
};
/** An exact SQL total of one company's ACTIVE transactions — the independent oracle the report must equal. */
$sqlTotal = static fn (Database $db, string $company, string $from, string $to, string $kind, ?string $post = null): string => (string) $db->select(
    'SELECT COALESCE(SUM(t.amount), 0.00) AS s FROM finance_transactions t LEFT JOIN finance_transaction_voids v ON v.company_id = t.company_id AND v.finance_transaction_id = t.id WHERE t.company_id = ? AND v.id IS NULL AND t.kind = ? AND t.transaction_date BETWEEN ? AND ?' . ($post === null ? '' : ' AND t.financial_post = ?'),
    array_merge([$company, $kind, $from, $to], $post === null ? [] : [$post]))[0]['s'];

return [
    'create: stores exactly the values sent, the actor as creator, the derived Active status and one finance.manage create audit row with no field' => static function () use ($world, $ok, $create, $body, $audits): void {
        $w = $world();
        $b = $body(['category' => 'Sewa Kantor — Jakarta', 'description' => 'Fabricated rent, Oktober']);
        $t = $ok($create($w, $b), 'create')['generalTransaction'];
        assertSame(TransactionView::FIELDS, array_keys($t));
        assertSame([$b['kind'], $b['financialPost'], $b['category'], $b['description'], $b['amount'], $b['transactionDate'], $w['ceoUser'], 'Active', null],
            [$t['kind'], $t['financialPost'], $t['category'], $t['description'], $t['amount'], $t['transactionDate'], $t['createdByUserId'], $t['status'], $t['void']]);
        $row = $w['db']->select('SELECT * FROM finance_transactions WHERE id = ?', [$t['id']])[0];
        assertSame([$w['a'], $b['idempotencyKey'], 'NPIP', 'Sewa Kantor — Jakarta'], [$row['company_id'], $row['idempotency_key'], $row['financial_post'], $row['category']]);
        assertSame(['finance.manage financeTransaction create -'], $audits($w['db'], $t['id']));
    },
    'the same create twice, and a dropped-response replay, answer the original with no second row or audit; the key with other values is 409 and writes nothing' => static function () use ($world, $ok, $create, $body, $code, $rows): void {
        $w = $world();
        $b = $body();
        $first = $ok($create($w, $b), 'first')['generalTransaction'];
        $before = $rows($w['db']);
        assertSame($first, $ok($create($w, $b), 'replay')['generalTransaction'], 'the original transaction');
        assertSame($before, $rows($w['db']), 'a replay writes nothing');
        foreach (['kind' => 'income', 'financialPost' => 'GA', 'category' => 'Lain', 'description' => 'Other', 'amount' => '750001.00', 'transactionDate' => '2026-10-11'] as $field => $other) {
            assertSame([409, 'conflict'], $code($create($w, [$field => $other] + $b)), 'the key with another ' . $field);
        }
        assertSame($before, $rows($w['db']), 'every mismatch writes nothing');
        $other = $ok($create($w, $b, 'ceoB'), 'company B, the same key')['generalTransaction'];
        assertTrue($other['id'] !== $first['id'], 'company B has its own key space: a new transaction, not one of company A');
    },
    'void: one void row and one void audit row, Voided derived, the transaction row untouched; a replay writes nothing; a second void is 409; an unknown id 404' => static function () use ($world, $ok, $create, $void, $body, $code, $audits, $rows, $newKey): void {
        $w = $world();
        $t = $ok($create($w, $body()), 'create')['generalTransaction'];
        $original = $w['db']->select('SELECT * FROM finance_transactions WHERE id = ?', [$t['id']]);
        $key = $newKey();
        $v = $ok($void($w, $t['id'], $key), 'void')['generalTransaction'];
        assertSame(['Voided', 'Fabricated duplicate', $w['ceoUser']], [$v['status'], $v['void']['reason'], $v['void']['voidedByUserId']]);
        assertSame($original, $w['db']->select('SELECT * FROM finance_transactions WHERE id = ?', [$t['id']]), 'the transaction row is never written');
        assertSame(['finance.manage financeTransaction create -', 'finance.manage financeTransaction void -'], $audits($w['db'], $t['id']));
        $before = $rows($w['db']);
        assertSame($v, $ok($void($w, $t['id'], $key), 'void replay')['generalTransaction'], 'the replay answers the voided transaction');
        assertSame($before, $rows($w['db']), 'a replayed void writes nothing');
        assertSame([409, 'conflict'], $code($void($w, $t['id'], $newKey())), 'a second void');
        assertSame([409, 'conflict'], $code($void($w, $t['id'], $key, 'Another reason')), 'the key with another reason');
        assertSame([404, 'not_found'], $code($void($w, str_repeat('f', 32), $newKey())), 'an unknown transaction');
        assertSame($before, $rows($w['db']), 'every refusal writes nothing');
        assertSame(1, (int) $w['db']->select('SELECT COUNT(*) AS n FROM finance_transaction_voids')[0]['n']);
    },
    'the range read honours its inclusive boundaries, orders by date, and shows voided transactions with their void' => static function () use ($world, $ok, $get, $create, $void, $body, $newKey): void {
        $w = $world();
        $ids = [];
        foreach (['2026-09-30', '2026-10-01', '2026-10-15', '2026-10-31', '2026-11-01'] as $date) {
            $ids[$date] = $ok($create($w, $body(['transactionDate' => $date])), 'create ' . $date)['generalTransaction']['id'];
        }
        $ok($void($w, $ids['2026-10-15'], $newKey()), 'void');
        $list = $ok($get($w, 'ceoA', '/api/general-transactions', 'from=2026-10-01&to=2026-10-31'), 'range')['generalTransactions'];
        assertSame(['2026-10-01', '2026-10-15', '2026-10-31'], array_column($list, 'transactionDate'), 'exactly the inclusive range, in date order');
        assertSame(['Active', 'Voided', 'Active'], array_column($list, 'status'));
        assertSame(['2026-10-15'], array_column($ok($get($w, 'ceoA', '/api/general-transactions', 'from=2026-10-15&to=2026-10-15'), 'one day')['generalTransactions'], 'transactionDate'), 'a one-day range');
        assertSame([], $ok($get($w, 'ceoA', '/api/general-transactions', 'from=2025-10-01&to=2025-10-31'), 'empty')['generalTransactions']);
    },
    'the report reconciles exactly with the database rows: every post, the general total, voided rows excluded, payroll a separate line of real postings and executions, consolidated counting payroll once; payroll rows unchanged' => static function () use ($world, $ok, $get, $create, $void, $body, $newKey, $payroll, $sqlTotal): void {
        $w = $world();
        $octPosting = $payroll($w, '2026-10', '2026-10-25');           // posted for October, paid in October
        $payroll($w, '2026-09', '2026-10-02');                         // posted for September, paid in October
        $novPosting = $payroll($w, '2026-11', null);                   // posted for November, not paid
        $payrollRows = static fn (): array => [$w['db']->select('SELECT * FROM finance_postings ORDER BY id'), $w['db']->select('SELECT * FROM finance_executions ORDER BY id'), $w['db']->select('SELECT * FROM payroll_plans ORDER BY id')];
        $before = $payrollRows();
        $plan = [['income', 'GA', '12000000.00', '2026-10-01'], ['expense', 'GA', '2500000.00', '2026-10-05'], ['expense', 'NPIP', '750000.00', '2026-10-10'],
            ['income', 'TJB', '4000000.00', '2026-10-20'], ['expense', 'DRONE', '1250000.00', '2026-10-31'], ['expense', 'DRONE', '999.00', '2026-10-12'],
            ['income', 'GA', '5000000.00', '2026-09-30'], ['expense', 'TJB', '300000.00', '2026-11-01']];
        $made = [];
        foreach ($plan as [$kind, $postCode, $amount, $date]) {
            $made[] = $ok($create($w, $body(['kind' => $kind, 'financialPost' => $postCode, 'amount' => $amount, 'transactionDate' => $date])), 'create')['generalTransaction'];
        }
        $ok($void($w, $made[5]['id'], $newKey()), 'void the 999');
        $ok($create($w, $body(['amount' => '100.00', 'transactionDate' => '2026-10-15']), 'ceoB'), 'company B noise');
        $r = $ok($get($w, 'ceoA', '/api/reports/financial', 'from=2026-10-01&to=2026-10-31'), 'report')['financialReport'];
        $db = $w['db'];
        foreach ($r['posts'] as $line) {
            assertSame($sqlTotal($db, $w['a'], '2026-10-01', '2026-10-31', 'income', $line['code']), $line['income'], $line['code'] . ' income reconciles');
            assertSame($sqlTotal($db, $w['a'], '2026-10-01', '2026-10-31', 'expense', $line['code']), $line['expense'], $line['code'] . ' expense reconciles');
        }
        assertSame(['GA', 'NPIP', 'TJB', 'DRONE'], array_column($r['posts'], 'code'));
        assertSame(['12000000.00', '2500000.00', '9500000.00', 2], [$r['posts'][0]['income'], $r['posts'][0]['expense'], $r['posts'][0]['net'], $r['posts'][0]['count']]);
        assertSame(['0.00', '1250000.00', '-1250000.00', 1], [$r['posts'][3]['income'], $r['posts'][3]['expense'], $r['posts'][3]['net'], $r['posts'][3]['count']], 'the voided 999 counts nowhere');
        assertSame(['income' => $sqlTotal($db, $w['a'], '2026-10-01', '2026-10-31', 'income'), 'expense' => $sqlTotal($db, $w['a'], '2026-10-01', '2026-10-31', 'expense'), 'net' => '11500000.00', 'count' => 5], $r['general']);
        assertSame(['count' => 1, 'amount' => '999.00'], $r['voided']);
        $postedSql = (string) $db->select("SELECT SUM(amount) AS s FROM finance_postings WHERE company_id = ? AND month_key BETWEEN '2026-10' AND '2026-10'", [$w['a']])[0]['s'];
        $paidSql = (string) $db->select("SELECT SUM(amount) AS s FROM finance_executions WHERE company_id = ? AND executed_on BETWEEN '2026-10-01' AND '2026-10-31'", [$w['a']])[0]['s'];
        assertSame(['amount' => $postedSql, 'count' => 1, 'fromMonth' => '2026-10', 'toMonth' => '2026-10'], $r['payroll']['posted'], 'posted: the October obligation only');
        assertSame(['amount' => $paidSql, 'count' => 2], $r['payroll']['paid'], 'paid: both payments dated in October');
        assertSame($octPosting['amount'], $r['payroll']['posted']['amount']);
        assertSame('7000000.00', $paidSql, 'two payments of 3,500,000');
        assertSame(['income' => '16000000.00', 'expense' => '11500000.00', 'net' => '4500000.00'], $r['consolidated'], 'general expense 4,500,000 + payroll paid 7,000,000, counted once');
        $nov = $ok($get($w, 'ceoA', '/api/reports/financial', 'from=2026-11-01&to=2026-11-30'), 'november')['financialReport'];
        assertSame(['3500000.00', 1, '0.00', 0], [$nov['payroll']['posted']['amount'], $nov['payroll']['posted']['count'], $nov['payroll']['paid']['amount'], $nov['payroll']['paid']['count']], 'November: posted, not paid');
        assertSame('300000.00', $nov['general']['expense']);
        assertSame($before, $payrollRows(), 'general transactions and the report never write a posting, an execution or a plan');
    },

    // PD-7 (Owner 2026-11-13): the caps at their boundaries. The rows are fabricated in bulk straight into the
    // table (the API would need one request per row); the reads go through the production routes.
    'PD-7: the range read returns exactly 2,000 transactions, and at 2,001 fails closed with 500 internal_error and no partial list' => static function () use ($world, $get, $ok, $code, $bulkTransactions, $failedClosed): void {
        $w = $world();
        $bulkTransactions($w['db'], $w['a'], $w['ceoUser'], 0, 2000, '2026-10');
        $bulkTransactions($w['db'], $w['a'], $w['ceoUser'], 2000, 5, '2026-11');      // outside the range: never counted against it
        $list = $ok($get($w, 'ceoA', '/api/general-transactions', 'from=2026-10-01&to=2026-10-31'), '2,000 rows')['generalTransactions'];
        assertSame(2000, count($list), 'exactly LIST_CAP rows are listed in full');
        assertSame(2000, count(array_unique(array_column($list, 'id'))), 'each row once');
        $bulkTransactions($w['db'], $w['a'], $w['ceoUser'], 2005, 1, '2026-10');
        $r = $get($w, 'ceoA', '/api/general-transactions', 'from=2026-10-01&to=2026-10-31');
        assertSame([500, 'internal_error'], $code($r), '2,001 rows: the cap fails closed');
        $failedClosed($r, 'the history above its cap');
        assertSame(5, count($ok($get($w, 'ceoA', '/api/general-transactions', 'from=2026-11-01&to=2026-11-30'), 'a short range')['generalTransactions']), 'a narrower range still reads');
    },
    'PD-7: the report reads exactly 20,000 transactions with exact totals, and at 20,001 fails closed with 500 internal_error and no partial total; payroll posted/paid semantics are unchanged' => static function () use ($world, $get, $ok, $code, $bulkTransactions, $failedClosed): void {
        $w = $world();
        $bulkTransactions($w['db'], $w['a'], $w['ceoUser'], 0, 20000, '2026-10');
        $r = $ok($get($w, 'ceoA', '/api/reports/financial', 'from=2026-10-01&to=2026-10-31'), '20,000 rows')['financialReport'];
        assertSame(['income' => '20000.00', 'expense' => '0.00', 'net' => '20000.00', 'count' => 20000], $r['general'], 'exactly REPORT_CAP rows are totalled in full');
        assertSame([5000, 5000, 5000, 5000], array_column($r['posts'], 'count'), 'every Financial Post line is complete');
        assertSame(['amount' => '0.00', 'count' => 0, 'fromMonth' => '2026-10', 'toMonth' => '2026-10'], $r['payroll']['posted'], 'payroll posted stays its own line, by month');
        assertSame(['amount' => '0.00', 'count' => 0], $r['payroll']['paid'], 'payroll paid stays its own line, by date');
        assertSame(['income' => '20000.00', 'expense' => '0.00', 'net' => '20000.00'], $r['consolidated'], 'consolidated stays general + payroll paid (PD-6)');
        $bulkTransactions($w['db'], $w['a'], $w['ceoUser'], 20000, 1, '2026-10');
        $over = $get($w, 'ceoA', '/api/reports/financial', 'from=2026-10-01&to=2026-10-31');
        assertSame([500, 'internal_error'], $code($over), '20,001 rows: the cap fails closed');
        $failedClosed($over, 'the report above its cap');
        $day = $ok($get($w, 'ceoA', '/api/reports/financial', 'from=2026-10-01&to=2026-10-01'), 'a short range')['financialReport'];
        assertSame((int) $w['db']->select("SELECT COUNT(*) AS n FROM finance_transactions WHERE company_id = ? AND transaction_date = '2026-10-01'", [$w['a']])[0]['n'], $day['general']['count'], 'a narrower range still reports, exactly');
    },
];
