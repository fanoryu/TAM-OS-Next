<?php
declare(strict_types=1);

/*
 * AWP-01 finance request concurrency against the real, guarded MariaDB (ADR-016 C1–C4) — deterministic,
 * never sleep-based, with the techniques of FinanceExecutionConcurrencyTest: a second connection holds
 * the request row in an open transaction, worker processes (tests/Support/request-worker.php) are
 * observed blocked on that exact lock (bounded polling of PROCESSLIST), the holder commits, and each
 * worker must act on the committed state. Where two workers race, the assertion holds for either order.
 *
 *   C1 two approves of one request: one success, one 409
 *   CR-01 T-C1 two approves of one Submitted reimbursement selecting different Financial Posts: one
 *      success, one 409; the stored post, snapshot and audit row are the winner's alone
 *   C2 two pays of one request under different keys: one Paid, one 409; exactly one payment row and
 *      one linked expense
 *   C3 a pay against a cancel: exactly one wins and the database matches the winner
 *   C4 100 iterations of a mixed run — pay and cancel of one request, an overtime create, a general
 *      transaction create, a reimbursement create and the archive of that reimbursement's employee —
 *      started together: no deadlock (a deadlock or lock wait would surface as 503: none is accepted)
 *
 * Lock order: create and submit of a reimbursement lock the employee row, then the request row; every
 * other request write locks only the request row; pay never touches employees. Fabricated data only.
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Data\Request\RequestStore;
use TamOs\Http\Response;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\authKernel;
use function TamOs\Tests\awaitBlockedStatements;
use function TamOs\Tests\employeeAnchor;
use function TamOs\Tests\envelope;
use function TamOs\Tests\loginRequest;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\requestId;
use function TamOs\Tests\secondConnection;
use function TamOs\Tests\sessionCookieToken;
use function TamOs\Tests\sessionRequest;
use function TamOs\Tests\testDbConfig;

$world = static function (): array {
    $db = authDatabase();
    $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
    $ceo = authFixture($db);
    employeeAnchor($db, $ceo['companyId'], 'e_1');
    $db->execute("UPDATE employees SET monthly_base_salary = '3500000.00' WHERE id = 'e_1'");
    $r = $k->handle(loginRequest($ceo['email'], (string) $ceo['password']), requestId());
    return ['db' => $db, 'k' => $k, 'a' => $ceo['companyId'], 's' => ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken']]];
};
$post = static fn (array $w, string $path, array $body): Response
    => $w['k']->handle(sessionRequest('POST', $path, $w['s']['token'], $w['s']['csrf'], json_encode($body, JSON_THROW_ON_ERROR)), requestId());
$data = static function (Response $r, string $label): array {
    assertSame(200, $r->status, $label . ' ' . substr($r->body, 0, 200));
    return envelope($r)['data'];
};
$key = static fn (): string => bin2hex(random_bytes(16));
/** A CEO payment request at Submitted or Approved. */
$request = static function (array $w, string $status, string $amount = '450000.00') use ($post, $data, $key): array {
    $r = $data($post($w, '/api/finance-requests/create', ['kind' => 'paymentRequest', 'financialPost' => 'GA', 'category' => 'Vendor', 'description' => 'Fabricated race',
        'amount' => $amount, 'payee' => 'CV Fiktif', 'documentDate' => '2026-10-10', 'idempotencyKey' => $key()]), 'create')['financeRequest'];
    $r = $data($post($w, '/api/finance-requests/submit', ['financeRequestId' => $r['id'], 'expectedVersion' => $r['version']]), 'submit')['financeRequest'];
    if ($status === 'Approved') {
        $r = $data($post($w, '/api/finance-requests/approve', ['financeRequestId' => $r['id'], 'expectedVersion' => $r['version'], 'expectedAmount' => $r['amount']]), 'approve')['financeRequest'];
    }
    return $r;
};
$approveBody = static fn (array $r): array => ['financeRequestId' => $r['id'], 'expectedVersion' => $r['version'], 'expectedAmount' => $r['amount']];
$cancelBody = static fn (array $r): array => ['financeRequestId' => $r['id'], 'expectedVersion' => $r['version'], 'reason' => 'Fabricated race cancel'];
$payBody = static fn (array $r, string $k, string $method = 'bankTransfer'): array => ['financeRequestId' => $r['id'], 'expectedVersion' => $r['version'], 'expectedAmount' => $r['amount'],
    'paidOn' => '2026-10-20', 'paymentMethod' => $method, 'idempotencyKey' => $k];
$lockRequest = 'SELECT id FROM finance_requests WHERE id = ? FOR UPDATE';
$blockedOnRequest = substr(RequestStore::LOCK_SQL, 0, (int) strpos(RequestStore::LOCK_SQL, ' WHERE'));
/** The payment invariants: at most one payment per request and per transaction; every payment's request Paid at its amount; one pay and one expense-create audit row per payment. */
$invariants = static function (Database $db): void {
    assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM (SELECT finance_request_id FROM finance_request_payments GROUP BY finance_request_id HAVING COUNT(*) > 1) t')[0]['n'], 'one payment per request');
    assertSame(0, (int) $db->select("SELECT COUNT(*) AS n FROM finance_request_payments p JOIN finance_requests r ON r.company_id = p.company_id AND r.id = p.finance_request_id JOIN finance_transactions t ON t.company_id = p.company_id AND t.id = p.finance_transaction_id WHERE r.status <> 'Paid' OR r.amount <> p.amount OR t.amount <> p.amount OR t.kind <> 'expense' OR t.transaction_date <> p.paid_on")[0]['n'], 'every payment matches its Paid request and its expense');
    assertSame((int) $db->select("SELECT COUNT(*) AS n FROM finance_requests WHERE status = 'Paid'")[0]['n'], (int) $db->select('SELECT COUNT(*) AS n FROM finance_request_payments')[0]['n'], 'every Paid request has its payment');
    $payments = (int) $db->select('SELECT COUNT(*) AS n FROM finance_request_payments')[0]['n'];
    assertSame($payments, (int) $db->select("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'finance.execute' AND entity = 'financeRequest' AND operation = 'pay'")[0]['n'], 'one pay audit row per payment');
    assertSame($payments, (int) $db->select("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'finance.execute' AND entity = 'financeTransaction' AND operation = 'create'")[0]['n'], 'one linked-expense audit row per payment');
};
$spawn = static function (array $w, string $op, array $body): array {
    $cmd = [PHP_BINARY];
    if (php_ini_loaded_file() === false) {
        $cmd[] = '-n';
    }
    array_push($cmd, dirname(__DIR__) . '/Support/request-worker.php', $w['s']['token'], $w['s']['csrf'], $op, json_encode($body, JSON_THROW_ON_ERROR));
    $proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, getenv());
    assertTrue(is_resource($proc), 'worker started');
    fclose($pipes[0]);
    return [$proc, $pipes];
};
$collect = static function (array $workers): array {
    $out = [];
    foreach ($workers as [$proc, $pipes]) {
        $stdout = (string) stream_get_contents($pipes[1]);
        $stderr = (string) stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        assertSame(0, proc_close($proc), 'worker exit: ' . $stderr);
        $out[] = trim($stdout);
    }
    return $out;
};
/** Starts $jobs while a second connection holds $id's request row, waits until $n of them are blocked on the request lock, commits; returns each "<status> <code>". */
$raceHold = static function (array $w, array $jobs, string $id, int $n) use ($spawn, $collect, $lockRequest, $blockedOnRequest): array {
    $workers = [];
    secondConnection()->transaction(static function (Database $tx) use ($w, $jobs, $id, $n, $spawn, $lockRequest, $blockedOnRequest, &$workers): void {
        assertTrue(count($tx->select($lockRequest, [$id])) === 1, 'the holder locked the request');
        foreach ($jobs as [$op, $body]) {
            $workers[] = $spawn($w, $op, $body);
        }
        awaitBlockedStatements($tx, $blockedOnRequest, $n);
    });
    return $collect($workers);
};

return [
    'C1: two concurrent approves of one request — one success, one 409' => static function () use ($world, $request, $approveBody, $raceHold, $invariants): void {
        $w = $world();
        $r = $request($w, 'Submitted');
        $out = $raceHold($w, [['request-approve', $approveBody($r)], ['request-approve', $approveBody($r)]], $r['id'], 2);
        sort($out);
        assertSame(['200 ok', '409 conflict'], $out, 'exactly one approve');
        $row = $w['db']->select('SELECT status, version FROM finance_requests WHERE id = ?', [$r['id']])[0];
        assertSame(['Approved', 3], [(string) $row['status'], (int) $row['version']], 'Approved once, version + 1');
        assertSame(1, (int) $w['db']->select("SELECT COUNT(*) AS n FROM audit_events WHERE entity_id = ? AND operation = 'approve'", [$r['id']])[0]['n'], 'one approve audit row');
        $invariants($w['db']);
    },

    'CR-01 T-C1: two concurrent reimbursement approvals with different posts — one 200, one 409; the stored post is the winner\'s' => static function () use ($world, $post, $data, $key, $raceHold, $invariants): void {
        $w = $world();
        $r = $data($post($w, '/api/finance-requests/create', ['kind' => 'reimbursement', 'employeeId' => 'e_1', 'category' => 'Transport', 'description' => 'Fabricated post race',
            'amount' => '75000.00', 'documentDate' => '2026-10-08', 'idempotencyKey' => $key()]), 'create')['financeRequest'];
        assertSame(null, $r['financialPost'], 'created without a post');
        $r = $data($post($w, '/api/finance-requests/submit', ['financeRequestId' => $r['id'], 'expectedVersion' => $r['version']]), 'submit')['financeRequest'];
        $body = static fn (string $p): array => ['financeRequestId' => $r['id'], 'expectedVersion' => $r['version'], 'expectedAmount' => $r['amount'], 'financialPost' => $p];
        $out = $raceHold($w, [['request-approve', $body('GA')], ['request-approve', $body('DRONE')]], $r['id'], 2);
        $sorted = $out;
        sort($sorted);
        assertSame(['200 ok', '409 conflict'], $sorted, 'exactly one approve');
        $winner = $out[0] === '200 ok' ? 'GA' : 'DRONE';
        $row = $w['db']->select('SELECT status, version, financial_post, pre_approval_financial_post, pre_approval_post_captured FROM finance_requests WHERE id = ?', [$r['id']])[0];
        assertSame(['Approved', 3, $winner, null, 1], [(string) $row['status'], (int) $row['version'], (string) $row['financial_post'], $row['pre_approval_financial_post'], (int) $row['pre_approval_post_captured']],
            'Approved once with the winner\'s post; previous NULL captured');
        assertSame(1, (int) $w['db']->select("SELECT COUNT(*) AS n FROM audit_events WHERE entity_id = ? AND operation = 'approve'", [$r['id']])[0]['n'], 'one approve audit row');
        $invariants($w['db']);
    },

    'C2: two concurrent pays of one request under different keys — one Paid, one 409; exactly one payment and one linked expense' => static function () use ($world, $request, $payBody, $raceHold, $invariants, $key): void {
        $w = $world();
        $r = $request($w, 'Approved');
        $out = $raceHold($w, [['request-pay', $payBody($r, $key())], ['request-pay', $payBody($r, $key(), 'cash')]], $r['id'], 2);
        sort($out);
        assertSame(['200 ok', '409 conflict'], $out, 'exactly one pay');
        assertSame([1, 1], [(int) $w['db']->select('SELECT COUNT(*) AS n FROM finance_request_payments')[0]['n'], (int) $w['db']->select("SELECT COUNT(*) AS n FROM finance_transactions WHERE kind = 'expense'")[0]['n']], 'one payment, one expense');
        $invariants($w['db']);
    },

    'C3: a pay concurrent with a cancel — exactly one wins and the database matches the winner (either order)' => static function () use ($world, $request, $payBody, $cancelBody, $raceHold, $invariants, $key): void {
        $w = $world();
        $r = $request($w, 'Approved');
        [$pay, $cancel] = $raceHold($w, [['request-pay', $payBody($r, $key())], ['request-cancel', $cancelBody($r)]], $r['id'], 2);
        $sorted = [$pay, $cancel];
        sort($sorted);
        assertSame(['200 ok', '409 conflict'], $sorted, 'exactly one wins');
        $status = (string) $w['db']->select('SELECT status FROM finance_requests WHERE id = ?', [$r['id']])[0]['status'];
        $payments = (int) $w['db']->select('SELECT COUNT(*) AS n FROM finance_request_payments')[0]['n'];
        $expenses = (int) $w['db']->select('SELECT COUNT(*) AS n FROM finance_transactions')[0]['n'];
        assertSame($pay === '200 ok' ? ['Paid', 1, 1] : ['Cancelled', 0, 0], [$status, $payments, $expenses], 'the state is the winner\'s');
        $invariants($w['db']);
    },

    'C4: no deadlock in a 100-iteration mixed run (pay, cancel, overtime create, general-transaction create, reimbursement create, employee archive)' => static function () use ($world, $request, $payBody, $cancelBody, $spawn, $collect, $invariants, $key): void {
        $w = $world();
        $seen = [];
        for ($i = 0; $i < 100; $i++) {
            $r = $request($w, 'Approved', sprintf('%d.00', 1000 + $i));
            $e = sprintf('e_mix_%03d', $i);
            employeeAnchor($w['db'], $w['a'], $e);
            $jobs = [
                'pay' => ['request-pay', $payBody($r, $key())],
                'cancel' => ['request-cancel', $cancelBody($r)],
                'overtime' => ['overtime-create', ['employeeId' => 'e_1', 'monthKey' => '2026-10', 'hours' => '1.00']],
                'transaction' => ['transaction-create', ['kind' => 'expense', 'financialPost' => 'NPIP', 'category' => 'Operasional', 'description' => 'Fabricated mixed ' . $i,
                    'amount' => '1000.00', 'transactionDate' => '2026-10-12', 'idempotencyKey' => $key()]],
                'reimbursement' => ['request-create', ['kind' => 'reimbursement', 'employeeId' => $e, 'financialPost' => 'TJB', 'category' => 'Transport', 'description' => 'Fabricated mixed ' . $i,
                    'amount' => '5000.00', 'documentDate' => '2026-10-08', 'idempotencyKey' => $key()]],
                'archive' => ['employee-archive', ['id' => $e, 'expectedVersion' => 1]],
            ];
            $workers = [];
            foreach ($jobs as [$op, $body]) {
                $workers[] = $spawn($w, $op, $body);
            }
            $out = array_combine(array_keys($jobs), $collect($workers));
            foreach ($out as $job => $result) {
                assertTrue(!str_starts_with($result, '503') && !str_starts_with($result, '500'), 'iteration ' . $i . ' ' . $job . ': no deadlock, lock wait or failure (' . $result . ')');
                $seen[$job][$result] = true;
            }
            $pair = [$out['pay'], $out['cancel']];
            sort($pair);
            assertSame(['200 ok', '409 conflict'], $pair, 'iteration ' . $i . ': exactly one of pay and cancel');
            assertSame(['200 ok', '200 ok'], [$out['overtime'], $out['transaction']], 'iteration ' . $i . ': the unrelated writes complete');
            assertTrue(in_array($out['reimbursement'], ['200 ok', '409 conflict'], true) && in_array($out['archive'], ['200 ok', '409 conflict'], true), 'iteration ' . $i . ': the employee race resolves to a committed outcome');
        }
        $invariants($w['db']);
        assertSame(0, (int) $w['db']->select("SELECT COUNT(*) AS n FROM finance_requests r JOIN employees e ON e.company_id = r.company_id AND e.id = r.owner_employee_id WHERE r.created_at > e.archived_at")[0]['n'], 'no reimbursement was created for an already-archived employee');
        assertTrue(isset($seen['pay']['200 ok']) || isset($seen['cancel']['200 ok']), 'the run exercised the pay/cancel race');
    },
];
