<?php
declare(strict_types=1);

/*
 * BF-4f Finance execution concurrency against the real, guarded MariaDB — deterministic, never
 * sleep-based, with the techniques of FinancePostingConcurrencyTest:
 *
 *   1. Lock proofs. A second connection holds a posting row in an open transaction while an
 *      execution runs with innodb_lock_wait_timeout = 1: the execution must wait on that exact lock
 *      (1205 → 503) and must have written nothing. Holding the posting's employee row (as a posting,
 *      a Payroll or a Supplemental write does first) or another posting does not block it.
 *   2. Race proofs. Worker processes are observed blocked on a row lock (bounded polling of
 *      PROCESSLIST) while the holder keeps it; each worker must then act on the committed state.
 *      Where two workers race each other, the assertion holds for either order.
 *
 * An execution locks exactly one row, its posting, by primary key. A posting (BF-4e) locks employee →
 * source and only inserts new posting rows, and never waits on an existing posting row, so no race
 * can cycle: X1 the same execution twice (one execution and its replay), X2 one posting under two keys
 * (one execution, one 409), X3 one key on two postings at once (one execution, one 409 — the
 * database's per-company key decides), X4 two executions of one employee's postings released
 * together with the BF-4e posting of that employee's next Supplemental document (all three
 * complete), X5 the dropped-response retry racing a second key (the original replays, the other is
 * 409). A deadlock would surface as 503: none is accepted.
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
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

/** @return array{db: Database, k: Kernel, a: string, s: array{token: string, csrf: string}} */
$world = static function (): array {
    $db = authDatabase();
    $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
    $ceo = authFixture($db);
    employeeAnchor($db, $ceo['companyId'], 'e_1');
    employeeAnchor($db, $ceo['companyId'], 'e_2');
    $db->execute("UPDATE employees SET monthly_base_salary = '3500000.00' WHERE id IN ('e_1', 'e_2')");
    $r = $k->handle(loginRequest($ceo['email'], (string) $ceo['password']), requestId());
    return ['db' => $db, 'k' => $k, 'a' => $ceo['companyId'], 's' => ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken']]];
};
$post = static fn (array $w, string $path, array $body): Response
    => $w['k']->handle(sessionRequest('POST', $path, $w['s']['token'], $w['s']['csrf'], json_encode($body, JSON_THROW_ON_ERROR)), requestId());
$code = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
$data = static function (Response $r, string $label): array {
    assertSame(200, $r->status, $label . ' ' . substr($r->body, 0, 200));
    return envelope($r)['data'];
};
/** Test-only SQL: an Approved overtime record of $employee in 2026-10 with a frozen amount — "approved now". */
$late = static function (array $w, string $employee = 'e_1'): void {
    $w['db']->execute("INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at, valuation_method, valuation_salary, valuation_standard_hours, approved_amount, approved_at) VALUES (?, ?, ?, '2026-10', NULL, '1.00', NULL, NULL, 'Approved', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'TAM-OT-1', '3500000.00', '160.00', '21875.00', UTC_TIMESTAMP(6))",
        [bin2hex(random_bytes(16)), $w['a'], $employee]);
};
/** $employee's 2026-10 base plan, generated, approved and committed through the Payroll routes. */
$committed = static function (array $w, string $employee) use ($post, $data): array {
    $plans = [];
    foreach ($data($post($w, '/api/payroll-plans/generate', ['month' => '2026-10']), 'payroll generate')['payrollPlans'] as $p) {
        $plans[$p['employeeId']] = $p;
    }
    $p = $data($post($w, '/api/payroll-plans/approve', ['id' => $plans[$employee]['id'], 'expectedVersion' => $plans[$employee]['version']]), 'payroll approve')['payrollPlan'];
    return $data($post($w, '/api/payroll-plans/commit', ['id' => $p['id'], 'expectedVersion' => $p['version'], 'expectedTotal' => $p['totalAmount'], 'idempotencyKey' => bin2hex(random_bytes(16))]), 'payroll commit')['payrollPlan'];
};
/** The Planned posting of $employee's Committed base plan (BF-4e). */
$posted = static function (array $w, string $employee) use ($committed, $post, $data): array {
    $p = $committed($w, $employee);
    return $data($post($w, '/api/finance-postings/payroll-plan', ['payrollPlanId' => $p['id'], 'expectedAmount' => $p['totalAmount'], 'idempotencyKey' => bin2hex(random_bytes(16))]), 'post plan')['financePosting'];
};
/** A Committed Supplemental document of $planId's late overtime. */
$committedDoc = static function (array $w, string $planId) use ($post, $data): array {
    $d = $data($post($w, '/api/supplemental-payrolls/generate', ['payrollPlanId' => $planId]), 'generate')['supplementalPayroll'];
    foreach (['review', 'approve'] as $op) {
        $d = $data($post($w, '/api/supplemental-payrolls/' . $op, ['id' => $d['id'], 'expectedVersion' => $d['version']]), $op)['supplementalPayroll'];
    }
    return $data($post($w, '/api/supplemental-payrolls/commit', ['id' => $d['id'], 'expectedVersion' => $d['version'], 'expectedTotal' => $d['overtimeAmount'], 'idempotencyKey' => bin2hex(random_bytes(16))]), 'supplemental commit')['supplementalPayroll'];
};
$docBody = static fn (array $d): array => ['supplementalPayrollId' => $d['id'], 'expectedAmount' => $d['overtimeAmount'], 'idempotencyKey' => bin2hex(random_bytes(16))];
$execBody = static fn (array $f, string $key, array $over = []): array => $over + ['financePostingId' => $f['id'], 'expectedAmount' => $f['amount'], 'executedOn' => '2026-10-05', 'paymentMethod' => 'bankTransfer', 'idempotencyKey' => $key];
$state = static fn (Database $db): array => [
    (int) $db->select('SELECT COUNT(*) AS n FROM finance_executions')[0]['n'],
    (int) $db->select("SELECT COUNT(*) AS n FROM audit_events WHERE operation = 'execute'")[0]['n'],
];
/** The execution invariants: at most one execution per posting, one execute audit row per execution, every execution at its Planned posting's employee, month and amount. */
$invariants = static function (Database $db): void {
    assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM (SELECT finance_posting_id FROM finance_executions GROUP BY finance_posting_id HAVING COUNT(*) > 1) t')[0]['n'], 'at most one execution per posting');
    assertSame((int) $db->select('SELECT COUNT(*) AS n FROM finance_executions')[0]['n'], (int) $db->select("SELECT COUNT(*) AS n FROM audit_events WHERE operation = 'execute'")[0]['n'], 'one execute audit row per execution');
    assertSame(0, (int) $db->select("SELECT COUNT(*) AS n FROM finance_executions e JOIN finance_postings f ON f.company_id = e.company_id AND f.id = e.finance_posting_id WHERE f.status <> 'Planned' OR e.amount <> f.amount OR e.employee_id <> f.employee_id OR e.month_key <> f.month_key")[0]['n'], 'every execution is its Planned posting in full');
    assertSame(['Planned'], array_values(array_unique(array_map(static fn (array $r): string => (string) $r['status'], $db->select('SELECT status FROM finance_postings')))), 'every posting is still Planned');
};
/** Runs $fn while $holder keeps $lockSql's row locked in an open transaction; $db waits at most 1 s. */
$whileLocked = static function (Database $holder, string $lockSql, array $params, Database $db, Closure $fn): mixed {
    $db->execute('SET SESSION innodb_lock_wait_timeout = 1');
    try {
        return $holder->transaction(static function (Database $tx) use ($lockSql, $params, $fn): mixed {
            assertTrue(count($tx->select($lockSql, $params)) === 1, 'the holder locked the row');
            return $fn();
        });
    } finally {
        $db->execute('SET SESSION innodb_lock_wait_timeout = 50');
    }
};
/**
 * Starts workers once $hold($tx) has taken its locks, waits until each statement prefix of $blockedOn
 * shows its count of blocked connections, commits; returns each worker's "<status> <code>", in start order.
 *
 * @param array<string, int> $blockedOn statement prefix => connections blocked on it
 */
$raceHold = static function (array $w, array $jobs, Closure $hold, array $blockedOn): array {
    $workers = [];
    secondConnection()->transaction(static function (Database $tx) use ($w, $jobs, $hold, $blockedOn, &$workers): void {
        $hold($tx);
        foreach ($jobs as [$op, $body]) {
            $cmd = [PHP_BINARY];
            if (php_ini_loaded_file() === false) {
                $cmd[] = '-n';
            }
            array_push($cmd, dirname(__DIR__) . '/Support/finance-worker.php', $w['s']['token'], $w['s']['csrf'], $op, json_encode($body, JSON_THROW_ON_ERROR));
            $proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, getenv());
            assertTrue(is_resource($proc), 'worker started');
            fclose($pipes[0]);
            $workers[] = [$proc, $pipes];
        }
        foreach ($blockedOn as $statement => $n) {
            awaitBlockedStatements($tx, $statement, $n);
        }
    });
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
$lockPosting = 'SELECT id FROM finance_postings WHERE id = ? FOR UPDATE';
$lockEmployee = 'SELECT id FROM employees WHERE id = ? FOR UPDATE';
$holdRows = static fn (string $sql, array $ids) => static function (Database $tx) use ($sql, $ids): void {
    foreach ($ids as $id) {
        assertTrue(count($tx->select($sql, [$id])) === 1, 'the holder locked ' . $id);
    }
};
// The statements a blocked worker shows in PROCESSLIST: an execution's posting lock and a posting's
// employee lock.
$blockedOnPosting = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, amount, status FROM finance_postings';
$blockedOnEmployee = 'SELECT id, company_id, id AS owner_employee_id';

return [
    'lock proofs: an execution waits on its posting row lock (503, nothing written); its employee row and another posting in flight do not block it — it locks only its posting' => static function () use ($world, $posted, $post, $execBody, $code, $data, $state, $whileLocked, $lockPosting, $lockEmployee): void {
        $w = $world();
        $f1 = $posted($w, 'e_1');
        $f2 = $posted($w, 'e_2');
        $before = $state($w['db']);
        assertSame([503, 'service_unavailable'], $code($whileLocked(secondConnection(), $lockPosting, [$f1['id']], $w['db'], static fn () => $post($w, '/api/finance-executions/execute', $execBody($f1, bin2hex(random_bytes(16)))))), 'waits on its posting');
        assertSame($before, $state($w['db']), 'nothing written');
        $r = $whileLocked(secondConnection(), $lockPosting, [$f2['id']], $w['db'], static fn () => $post($w, '/api/finance-executions/execute', $execBody($f1, bin2hex(random_bytes(16)))));
        assertSame($f1['id'], $data($r, 'another posting locked does not block the execution')['financeExecution']['financePostingId']);
        $r = $whileLocked(secondConnection(), $lockEmployee, ['e_2'], $w['db'], static fn () => $post($w, '/api/finance-executions/execute', $execBody($f2, bin2hex(random_bytes(16)))));
        assertSame($f2['id'], $data($r, "the posting's employee row held FOR UPDATE (the first lock of every posting, Payroll and Supplemental write) does not block the execution")['financeExecution']['financePostingId']);
        assertSame(['Planned', 'Planned'], array_map(static fn (array $x): string => (string) $x['status'], $w['db']->select('SELECT status FROM finance_postings ORDER BY id')));
    },
    'X1 race: the same execution twice (a double click) both wait on the posting lock — one execution and its replay; one execute audit row' => static function () use ($world, $posted, $execBody, $raceHold, $holdRows, $lockPosting, $blockedOnPosting, $state, $invariants): void {
        $w = $world();
        $f = $posted($w, 'e_1');
        $key = bin2hex(random_bytes(16));
        $out = $raceHold($w, [['execute', $execBody($f, $key)], ['execute', $execBody($f, $key)]], $holdRows($lockPosting, [$f['id']]), [$blockedOnPosting => 2]);
        assertSame(['200 ok', '200 ok'], $out, 'one execution and its replay — no deadlock');
        assertSame([1, 1], $state($w['db']), 'one execution, one execute row');
        assertSame($key, (string) $w['db']->select('SELECT idempotency_key FROM finance_executions')[0]['idempotency_key']);
        $invariants($w['db']);
    },
    'X2 race: one posting under two keys at once — exactly one execution, the other 409; the loser stores no key' => static function () use ($world, $posted, $post, $execBody, $code, $raceHold, $holdRows, $lockPosting, $blockedOnPosting, $state, $invariants): void {
        $w = $world();
        $f = $posted($w, 'e_1');
        $k1 = bin2hex(random_bytes(16));
        $k2 = bin2hex(random_bytes(16));
        $out = $raceHold($w, [['execute', $execBody($f, $k1)], ['execute', $execBody($f, $k2, ['paymentMethod' => 'cash'])]], $holdRows($lockPosting, [$f['id']]), [$blockedOnPosting => 2]);
        sort($out);
        assertSame(['200 ok', '409 conflict'], $out, 'exactly one execution of the posting (D-FEX-2 = A)');
        assertSame([1, 1], $state($w['db']));
        $winner = (string) $w['db']->select('SELECT idempotency_key FROM finance_executions')[0]['idempotency_key'];
        $loser = $winner === $k1 ? $k2 : $k1;
        assertSame(0, (int) $w['db']->select('SELECT COUNT(*) AS n FROM finance_executions WHERE idempotency_key = ?', [$loser])[0]['n'], 'the loser stored no key');
        $f2 = $posted($w, 'e_2');
        assertSame(200, $post($w, '/api/finance-executions/execute', $execBody($f2, $loser))->status, 'the loser key, never consumed, executes another posting');
        assertSame([409, 'conflict'], $code($post($w, '/api/finance-executions/execute', $execBody($f, bin2hex(random_bytes(16))))), 'the posting stays executed once');
        $invariants($w['db']);
    },
    'X3 race: one key on two postings at once — one execution, one 409 (the database per-company key decides); the loser executes with its own key' => static function () use ($world, $posted, $post, $execBody, $data, $raceHold, $holdRows, $lockPosting, $blockedOnPosting, $state, $invariants): void {
        $w = $world();
        $f1 = $posted($w, 'e_1');
        $f2 = $posted($w, 'e_2');
        $shared = bin2hex(random_bytes(16));
        $out = $raceHold($w, [['execute', $execBody($f1, $shared)], ['execute', $execBody($f2, $shared)]], $holdRows($lockPosting, [$f1['id'], $f2['id']]), [$blockedOnPosting => 2]);
        sort($out);
        assertSame(['200 ok', '409 conflict'], $out, 'one key, two postings: one execution');
        assertSame([1, 1], $state($w['db']));
        $winner = (string) $w['db']->select('SELECT finance_posting_id FROM finance_executions WHERE idempotency_key = ?', [$shared])[0]['finance_posting_id'];
        $loser = $winner === $f1['id'] ? $f2 : $f1;
        assertSame($loser['id'], $data($post($w, '/api/finance-executions/execute', $execBody($loser, bin2hex(random_bytes(16)))), 'the loser with its own key')['financeExecution']['financePostingId']);
        $invariants($w['db']);
    },
    'X4 race: two executions of one employee\'s postings, held on their posting rows, and the BF-4e posting of that employee\'s next Supplemental document, held on the employee row, released together — all three complete, no deadlock' => static function () use ($world, $committed, $late, $committedDoc, $post, $data, $docBody, $execBody, $raceHold, $holdRows, $lockEmployee, $lockPosting, $blockedOnPosting, $blockedOnEmployee, $state, $invariants): void {
        $w = $world();
        $p = $committed($w, 'e_1');
        $f = $data($post($w, '/api/finance-postings/payroll-plan', ['payrollPlanId' => $p['id'], 'expectedAmount' => $p['totalAmount'], 'idempotencyKey' => bin2hex(random_bytes(16))]), 'post plan')['financePosting'];
        $late($w);
        $fd = $data($post($w, '/api/finance-postings/supplemental-payroll', $docBody($committedDoc($w, $p['id']))), 'post first document')['financePosting'];
        $late($w);
        $next = $committedDoc($w, $p['id']);
        $out = $raceHold($w, [['execute', $execBody($f, bin2hex(random_bytes(16)))], ['execute', $execBody($fd, bin2hex(random_bytes(16)), ['paymentMethod' => 'qris'])], ['post-supplemental', $docBody($next)]],
            static function (Database $tx) use ($holdRows, $lockEmployee, $lockPosting, $f, $fd): void {
                $holdRows($lockEmployee, ['e_1'])($tx);
                $holdRows($lockPosting, [$f['id'], $fd['id']])($tx);
            }, [$blockedOnPosting => 2, $blockedOnEmployee => 1]);
        assertSame(['200 ok', '200 ok', '200 ok'], $out, 'both executions and the posting complete in any order');
        assertSame([2, 2], $state($w['db']));
        assertSame(3, (int) $w['db']->select("SELECT COUNT(*) AS n FROM finance_postings WHERE status = 'Planned'")[0]['n'], 'three Planned postings — two executed, the new one not');
        $invariants($w['db']);
    },
    'X5 race: a dropped-response retry (same body, same key) racing a second key after the execution committed — the retry replays the original, the other is 409' => static function () use ($world, $posted, $post, $execBody, $data, $raceHold, $holdRows, $lockPosting, $blockedOnPosting, $state, $invariants): void {
        $w = $world();
        $f = $posted($w, 'e_1');
        $key = bin2hex(random_bytes(16));
        $original = $data($post($w, '/api/finance-executions/execute', $execBody($f, $key)), 'execute — its answer is then lost')['financeExecution'];
        $out = $raceHold($w, [['execute', $execBody($f, $key)], ['execute', $execBody($f, bin2hex(random_bytes(16)))]], $holdRows($lockPosting, [$f['id']]), [$blockedOnPosting => 2]);
        assertSame(['200 ok', '409 conflict'], $out, 'the retry replays; the other key is refused');
        assertSame([1, 1], $state($w['db']), 'still one execution');
        assertSame($original['id'], (string) $w['db']->select('SELECT id FROM finance_executions')[0]['id']);
        $invariants($w['db']);
    },
];
