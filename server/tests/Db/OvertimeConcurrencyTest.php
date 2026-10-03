<?php
declare(strict_types=1);

/*
 * BF-4b1 overtime concurrency against the real, guarded MariaDB — deterministic, never
 * sleep-based. Three techniques (as in AccountConcurrencyTest):
 *
 *   1. Lock proofs. A second connection holds the overtime (or employee) row inside an open
 *      transaction while a write runs on the main connection with innodb_lock_wait_timeout = 1:
 *      the write must wait on that exact lock (1205 → 503) and must have written nothing.
 *   2. Loser proofs. Two production writes of the same version, one after the other: the first
 *      wins, the second is a deterministic 409 (or 404 once the record is gone) and changes nothing.
 *   3. Race proofs. A worker process passes its scoped load and Policy, is observed blocked on the
 *      row lock (bounded polling of PROCESSLIST), and the competing change commits meanwhile:
 *      the worker's locked re-check must refuse it.
 *
 * BF-4b2: approval locks the owning employee, then the record. It waits on either lock; it loses
 * deterministically to a concurrent approve, reject, salary change or archive; and a salary change
 * committed while it waits makes it refuse (the amount the CEO was shown no longer holds).
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

/** @return array{db: Database, k: Kernel, a: string, s: array<string, array{token: string, csrf: string}>} */
$world = static function (): array {
    $db = authDatabase();
    $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
    $ceo = authFixture($db);
    $emp = authFixture($db, ['companyId' => $ceo['companyId'], 'role' => 'employee', 'employeeId' => 'e_1']);
    employeeAnchor($db, $ceo['companyId'], 'e_2');
    $db->execute("UPDATE employees SET monthly_base_salary = '3500000.00' WHERE id IN ('e_1', 'e_2')");
    $s = [];
    foreach (['ceo' => $ceo, 'emp' => $emp] as $name => $f) {
        $r = $k->handle(loginRequest($f['email'], (string) $f['password']), requestId());
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken']];
    }
    return ['db' => $db, 'k' => $k, 'a' => $ceo['companyId'], 's' => $s];
};
$post = static fn (array $w, string $who, string $op, array $body): Response
    => $w['k']->handle(sessionRequest('POST', '/api/overtime-records/' . $op, $w['s'][$who]['token'], $w['s'][$who]['csrf'], json_encode($body, JSON_THROW_ON_ERROR)), requestId());
$code = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
$draft = static function (array $w, string $employee = 'e_1') use ($post): array {
    $r = $post($w, 'ceo', 'create', ['employeeId' => $employee, 'monthKey' => '2026-10', 'hours' => '1.00']);
    assertSame(200, $r->status, 'create');
    return envelope($r)['data']['overtimeRecord'];
};
$apply = static function (array $w, string $op, array $rec) use ($post): array {
    $r = $post($w, 'ceo', $op, ['id' => $rec['id'], 'expectedVersion' => $rec['version']] + ($op === 'update' ? ['hours' => '2.00'] : []));
    assertSame(200, $r->status, $op . ' ' . substr($r->body, 0, 120));
    return envelope($r)['data']['overtimeRecord'] ?? ['id' => $rec['id']];
};
$state = static fn (Database $db, string $id): ?array => $db->select('SELECT status, version, hours FROM overtime_records WHERE id = ?', [$id])[0] ?? null;
$audits = static fn (Database $db): int => (int) $db->select("SELECT COUNT(*) AS n FROM audit_events WHERE entity = 'overtime'")[0]['n'];
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
 * Starts the worker for one write, waits until it is blocked on $blockedOn while $holder holds the
 * lock, runs $meanwhile on the holder (the competing change), commits, and returns the worker's
 * "<status> <code>".
 */
$race = static function (array $w, string $who, string $op, array $body, string $lockSql, array $lockParams, string $blockedOn, Closure $meanwhile): string {
    $worker = null;
    secondConnection()->transaction(static function (Database $tx) use ($w, $who, $op, $body, $lockSql, $lockParams, $blockedOn, $meanwhile, &$worker): void {
        assertTrue(count($tx->select($lockSql, $lockParams)) === 1, 'the holder locked the row');
        $cmd = [PHP_BINARY];
        if (php_ini_loaded_file() === false) {
            $cmd[] = '-n';
        }
        array_push($cmd, dirname(__DIR__) . '/Support/overtime-worker.php', $w['s'][$who]['token'], $w['s'][$who]['csrf'], $op, json_encode($body, JSON_THROW_ON_ERROR));
        $proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, getenv());
        assertTrue(is_resource($proc), 'worker started');
        fclose($pipes[0]);
        $worker = [$proc, $pipes];
        awaitBlockedStatements($tx, $blockedOn, 1);
        $meanwhile($tx);
    });
    [$proc, $pipes] = $worker;
    $stdout = (string) stream_get_contents($pipes[1]);
    $stderr = (string) stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    assertSame(0, proc_close($proc), 'worker exit: ' . $stderr);
    return trim($stdout);
};
$lockOvertime = 'SELECT id FROM overtime_records WHERE id = ? FOR UPDATE';
$blockedOnOvertime = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key';
$lockEmployee = 'SELECT id FROM employees WHERE id = ? FOR UPDATE';
$blockedOnValuation = 'SELECT id, company_id, id AS owner_employee_id, monthly_base_salary';
/** A Reviewed record of e_1, 1.00 hour: TAM-OT-1 values it at 21 875.00 at the fixture salary. */
$reviewed = static function (array $w) use ($draft, $apply): array {
    return $apply($w, 'review', $apply($w, 'submit', $draft($w)));
};
$approveBody = static fn (array $rec, string $amount = '21875.00'): array => ['id' => $rec['id'], 'expectedVersion' => $rec['version'], 'expectedAmount' => $amount];
$frozen = static fn (Database $db, string $id): ?array => $db->select('SELECT status, version, valuation_method, valuation_salary, approved_amount FROM overtime_records WHERE id = ?', [$id])[0] ?? null;

return [
    'every overtime write waits on the overtime row lock: while it is held, nothing is written (503)' => static function () use ($world, $draft, $apply, $post, $code, $state, $audits, $whileLocked, $lockOvertime): void {
        $w = $world();
        $d = $draft($w);
        $s = $apply($w, 'submit', $draft($w));
        foreach ([['update', $d, ['hours' => '5.00']], ['delete', $d, []], ['submit', $d, []], ['review', $s, []], ['reject', $s, []]] as [$op, $rec, $extra]) {
            $before = [$state($w['db'], $rec['id']), $audits($w['db'])];
            $r = $whileLocked(secondConnection(), $lockOvertime, [$rec['id']], $w['db'],
                static fn () => $post($w, 'ceo', $op, ['id' => $rec['id'], 'expectedVersion' => $rec['version']] + $extra));
            assertSame([503, 'service_unavailable'], $code($r), $op . ' waited on the row');
            assertSame($before, [$state($w['db'], $rec['id']), $audits($w['db'])], $op . ' wrote nothing');
        }
    },
    'approve waits on the employee row lock and on the overtime row lock: while either is held, nothing is written (503)' => static function () use ($world, $reviewed, $post, $code, $frozen, $audits, $whileLocked, $lockOvertime, $lockEmployee, $approveBody): void {
        $w = $world();
        $r = $reviewed($w);
        foreach (['employee' => [$lockEmployee, 'e_1'], 'overtime' => [$lockOvertime, $r['id']]] as $label => [$sql, $key]) {
            $before = [$frozen($w['db'], $r['id']), $audits($w['db'])];
            $resp = $whileLocked(secondConnection(), $sql, [$key], $w['db'], static fn () => $post($w, 'ceo', 'approve', $approveBody($r)));
            assertSame([503, 'service_unavailable'], $code($resp), 'approve waited on the ' . $label . ' row');
            assertSame($before, [$frozen($w['db'], $r['id']), $audits($w['db'])], $label . ': nothing written');
        }
        $resp = $post($w, 'ceo', 'approve', $approveBody($r));
        assertSame(200, $resp->status, 'and succeeds once the locks are free');
    },
    'approve against approve, reject or review of the same version: exactly one wins; the loser is 409 and changes nothing' => static function () use ($world, $reviewed, $draft, $apply, $post, $code, $frozen, $approveBody): void {
        $w = $world();
        $r = $reviewed($w);
        assertSame(200, $post($w, 'ceo', 'approve', $approveBody($r))->status, 'first approve');
        $after = $frozen($w['db'], $r['id']);
        assertSame([409, 'conflict'], $code($post($w, 'ceo', 'approve', $approveBody($r))), 'approve/approve');
        assertSame([409, 'conflict'], $code($post($w, 'ceo', 'reject', ['id' => $r['id'], 'expectedVersion' => $r['version']])), 'approve/reject');
        assertSame($after, $frozen($w['db'], $r['id']), 'the approval stands, with one snapshot');
        $x = $reviewed($w);
        $apply($w, 'reject', $x);
        assertSame([409, 'conflict'], $code($post($w, 'ceo', 'approve', $approveBody($x))), 'reject/approve');
        assertSame('Rejected', (string) $frozen($w['db'], $x['id'])['status']);
        $s = $apply($w, 'submit', $draft($w));
        $apply($w, 'review', $s);
        assertSame([409, 'conflict'], $code($post($w, 'ceo', 'approve', $approveBody($s))), 'review/approve: the Submitted version is stale');
        assertSame(1, (int) $w['db']->select("SELECT COUNT(*) AS n FROM audit_events WHERE operation = 'approve'")[0]['n'], 'exactly one approval audited');
    },
    'race: an approval waiting on the employee lock while the salary changes is refused (409); nothing is approved at either amount' => static function () use ($world, $reviewed, $frozen, $race, $lockEmployee, $blockedOnValuation, $approveBody): void {
        $w = $world();
        $r = $reviewed($w);
        $out = $race($w, 'ceo', 'approve', $approveBody($r), $lockEmployee, ['e_1'], $blockedOnValuation,
            static fn (Database $tx) => $tx->execute("UPDATE employees SET monthly_base_salary = '4000000.00', version = version + 1 WHERE id = ?", ['e_1']));
        assertSame('409 conflict', $out, 'valuation_changed');
        assertSame(['Reviewed', null, null], [(string) $frozen($w['db'], $r['id'])['status'], $frozen($w['db'], $r['id'])['valuation_salary'], $frozen($w['db'], $r['id'])['approved_amount']]);
    },
    'race: an approval waiting on the employee lock while the employee is archived is refused (409)' => static function () use ($world, $reviewed, $frozen, $race, $lockEmployee, $blockedOnValuation, $approveBody): void {
        $w = $world();
        $r = $reviewed($w);
        $out = $race($w, 'ceo', 'approve', $approveBody($r), $lockEmployee, ['e_1'], $blockedOnValuation,
            static fn (Database $tx) => $tx->execute('UPDATE employees SET archived_at = UTC_TIMESTAMP(6), version = version + 1 WHERE id = ?', ['e_1']));
        assertSame('409 conflict', $out);
        assertSame('Reviewed', (string) $frozen($w['db'], $r['id'])['status']);
    },
    'race: an approval waiting on the overtime lock while the record is rejected, or approved, meanwhile is refused (409)' => static function () use ($world, $reviewed, $frozen, $race, $lockOvertime, $blockedOnOvertime, $approveBody): void {
        $w = $world();
        $r = $reviewed($w);
        $out = $race($w, 'ceo', 'approve', $approveBody($r), $lockOvertime, [$r['id']], $blockedOnOvertime,
            static fn (Database $tx) => $tx->execute("UPDATE overtime_records SET status = 'Rejected', version = version + 1 WHERE id = ?", [$r['id']]));
        assertSame('409 conflict', $out, 'reject wins');
        assertSame('Rejected', (string) $frozen($w['db'], $r['id'])['status'], 'Rejected stays terminal');
        $q = $reviewed($w);
        $out = $race($w, 'ceo', 'approve', $approveBody($q), $lockOvertime, [$q['id']], $blockedOnOvertime,
            static fn (Database $tx) => $tx->execute("UPDATE overtime_records SET status = 'Approved', valuation_method = 'TAM-OT-1', valuation_salary = '3500000.00', valuation_standard_hours = '160.00', approved_amount = '21875.00', approved_at = UTC_TIMESTAMP(6), version = version + 1 WHERE id = ?", [$q['id']]));
        assertSame('409 conflict', $out, 'the first approval wins');
        assertSame(0, (int) $w['db']->select("SELECT COUNT(*) AS n FROM audit_events WHERE operation = 'approve'")[0]['n'], 'the losing worker audited nothing');
    },
    'create waits on the employee row lock: while it is held, nothing is written (503)' => static function () use ($world, $post, $code, $audits, $whileLocked): void {
        $w = $world();
        $r = $whileLocked(secondConnection(), 'SELECT id FROM employees WHERE id = ? FOR UPDATE', ['e_2'], $w['db'],
            static fn () => $post($w, 'ceo', 'create', ['employeeId' => 'e_2', 'monthKey' => '2026-10', 'hours' => '1.00']));
        assertSame([503, 'service_unavailable'], $code($r));
        assertSame([0, 0], [(int) $w['db']->select('SELECT COUNT(*) AS n FROM overtime_records')[0]['n'], $audits($w['db'])]);
    },
    'two writes of the same version: exactly one wins, the loser is a deterministic 409 / 404 and changes nothing' => static function () use ($world, $draft, $apply, $post, $code, $state): void {
        $w = $world();
        $pairs = [
            'edit/edit' => ['update', 'update', null, 409], 'edit/submit' => ['update', 'submit', null, 409], 'submit/edit' => ['submit', 'update', null, 409],
            'submit/delete' => ['submit', 'delete', null, 409], 'submit/submit' => ['submit', 'submit', null, 409],
            'review/reject' => ['review', 'reject', 'submit', 409], 'reject/review' => ['reject', 'review', 'submit', 409], 'review/review' => ['review', 'review', 'submit', 409],
            'delete/submit' => ['delete', 'submit', null, 404], 'delete/delete' => ['delete', 'delete', null, 404],
        ];
        foreach ($pairs as $label => [$first, $second, $setup, $loser]) {
            $rec = $draft($w);
            if ($setup !== null) {
                $rec = $apply($w, $setup, $rec);
            }
            $apply($w, $first, $rec);
            $after = $state($w['db'], $rec['id']);
            $r = $post($w, 'ceo', $second, ['id' => $rec['id'], 'expectedVersion' => $rec['version']] + ($second === 'update' ? ['hours' => '3.00'] : []));
            assertSame([$loser, $loser === 404 ? 'not_found' : 'conflict'], $code($r), $label);
            assertSame($after, $state($w['db'], $rec['id']), $label . ': the winner stands');
        }
    },
    'race: an edit that loaded the Draft before a concurrent submit committed is refused by its locked re-check (409)' => static function () use ($world, $draft, $state, $race, $lockOvertime, $blockedOnOvertime): void {
        $w = $world();
        $d = $draft($w);
        $out = $race($w, 'emp', 'update', ['id' => $d['id'], 'expectedVersion' => 1, 'hours' => '6.00'], $lockOvertime, [$d['id']], $blockedOnOvertime,
            static fn (Database $tx) => $tx->execute("UPDATE overtime_records SET status = 'Submitted', version = 2 WHERE id = ?", [$d['id']]));
        assertSame('409 conflict', $out);
        assertSame(['status' => 'Submitted', 'version' => 2, 'hours' => '1.00'], array_map(static fn ($v) => is_numeric($v) && !str_contains((string) $v, '.') ? (int) $v : (string) $v, $state($w['db'], $d['id'])), 'the submit stands, the edit wrote nothing');
    },
    'race: a second submit that passed Policy before the first committed is refused (409); only one submit is audited' => static function () use ($world, $draft, $state, $race, $lockOvertime, $blockedOnOvertime): void {
        $w = $world();
        $d = $draft($w);
        $out = $race($w, 'emp', 'submit', ['id' => $d['id'], 'expectedVersion' => 1], $lockOvertime, [$d['id']], $blockedOnOvertime,
            static fn (Database $tx) => $tx->execute("UPDATE overtime_records SET status = 'Submitted', version = 2 WHERE id = ?", [$d['id']]));
        assertSame('409 conflict', $out);
        assertSame(0, (int) $w['db']->select("SELECT COUNT(*) AS n FROM audit_events WHERE operation = 'submit'")[0]['n'], 'the losing worker audited nothing');
        assertSame('2', (string) $state($w['db'], $d['id'])['version']);
    },
    'race: a review against a record rejected meanwhile is refused (409)' => static function () use ($world, $draft, $apply, $state, $race, $lockOvertime, $blockedOnOvertime): void {
        $w = $world();
        $s = $apply($w, 'submit', $draft($w));
        $out = $race($w, 'ceo', 'review', ['id' => $s['id'], 'expectedVersion' => $s['version']], $lockOvertime, [$s['id']], $blockedOnOvertime,
            static fn (Database $tx) => $tx->execute("UPDATE overtime_records SET status = 'Rejected', version = version + 1 WHERE id = ?", [$s['id']]));
        assertSame('409 conflict', $out);
        assertSame('Rejected', (string) $state($w['db'], $s['id'])['status'], 'Rejected stays terminal');
    },
    'race: a transition against a Draft deleted meanwhile finds nothing under its lock (404)' => static function () use ($world, $draft, $state, $race, $lockOvertime, $blockedOnOvertime): void {
        $w = $world();
        $d = $draft($w);
        $out = $race($w, 'emp', 'submit', ['id' => $d['id'], 'expectedVersion' => 1], $lockOvertime, [$d['id']], $blockedOnOvertime,
            static fn (Database $tx) => $tx->execute('DELETE FROM overtime_records WHERE id = ?', [$d['id']]));
        assertSame('404 not_found', $out);
        assertSame(null, $state($w['db'], $d['id']));
    },
    'race: a create that loaded the employee before a concurrent archive committed is refused by its locked re-check (409)' => static function () use ($world, $race): void {
        $w = $world();
        $out = $race($w, 'ceo', 'create', ['employeeId' => 'e_2', 'monthKey' => '2026-10', 'hours' => '1.00'], 'SELECT id FROM employees WHERE id = ? FOR UPDATE', ['e_2'],
            'SELECT id, company_id, id AS owner_employee_id, employment_status',
            static fn (Database $tx) => $tx->execute('UPDATE employees SET archived_at = UTC_TIMESTAMP(6), version = version + 1 WHERE id = ?', ['e_2']));
        assertSame('409 conflict', $out);
        assertSame(0, (int) $w['db']->select('SELECT COUNT(*) AS n FROM overtime_records')[0]['n'], 'nothing created for an archived employee');
    },
];
