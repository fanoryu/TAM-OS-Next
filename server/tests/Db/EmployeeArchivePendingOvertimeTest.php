<?php
declare(strict_types=1);

/*
 * ARCH-OT-1 (EL-DEC-5 / HV-Q-3 = A, applied by Owner GO 2026-11-21 to the SESSION CEO archive)
 * against the real, guarded MariaDB: an employee is not archived while any of their overtime is
 * still Submitted or Reviewed (approving it after the archive is impossible, so it would be
 * stranded), and no Draft becomes Submitted under an archived employee. Draft, Approved and
 * Rejected overtime never block on their own. Refusals write nothing.
 *
 * Concurrency follows OvertimeConcurrencyTest: a second connection holds the employee row while a
 * worker process (tests/Support/overtime-worker.php) is observed blocked on it, the competing
 * change commits, and the worker's locked re-check decides. Archive, create, submit and approve
 * all lock the employee row before any overtime row, so none of them can deadlock another.
 *
 * Company A: a CEO, an Employee bound to e_a2, and e_a1 (no login, so the active-login guard never
 * hides this one). Company B: a CEO and e_b1. Fabricated values only.
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
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
    $ceoA = authFixture($db);
    $a = $ceoA['companyId'];
    $empA2 = authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a2']);
    employeeAnchor($db, $a, 'e_a1');
    $ceoB = authFixture($db);
    employeeAnchor($db, $ceoB['companyId'], 'e_b1');
    $db->execute("UPDATE employees SET monthly_base_salary = '3500000.00' WHERE id IN ('e_a1', 'e_a2', 'e_b1')");
    $s = [];
    foreach (['ceoA' => $ceoA, 'empA2' => $empA2, 'ceoB' => $ceoB] as $name => $f) {
        $r = $k->handle(loginRequest($f['email'], (string) $f['password']), requestId());
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken']];
    }
    return ['db' => $db, 'k' => $k, 's' => $s];
};
$post = static fn (array $w, string $who, string $path, array $body): Response
    => $w['k']->handle(sessionRequest('POST', $path, $w['s'][$who]['token'], $w['s'][$who]['csrf'], json_encode($body, JSON_THROW_ON_ERROR)), requestId());
$code = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
$version = static fn (Database $db, string $id): int => (int) $db->select('SELECT version FROM employees WHERE id = ?', [$id])[0]['version'];
$archive = static fn (array $w, string $who, string $id, ?int $v = null): Response
    => $post($w, $who, '/api/employees/archive', ['id' => $id, 'expectedVersion' => $v ?? $version($w['db'], $id)]);
$archived = static fn (Database $db, string $id): bool => $db->select('SELECT archived_at FROM employees WHERE id = ?', [$id])[0]['archived_at'] !== null;
$ot = static function (array $w, string $op, array $rec, string $who = 'ceoA') use ($post): array {
    $r = $post($w, $who, '/api/overtime-records/' . $op, ['id' => $rec['id'], 'expectedVersion' => $rec['version']] + ($op === 'approve' ? ['expectedAmount' => '21875.00'] : []));
    assertSame(200, $r->status, $op . ' ' . substr($r->body, 0, 160));
    return envelope($r)['data']['overtimeRecord'];
};
/** A 1.00-hour Draft of $employee (TAM-OT-1 values it at 21 875.00 at the fixture salary). */
$draft = static function (array $w, string $employee = 'e_a1', string $who = 'ceoA') use ($post): array {
    $r = $post($w, $who, '/api/overtime-records/create', ['employeeId' => $employee, 'monthKey' => '2026-10', 'hours' => '1.00']);
    assertSame(200, $r->status, 'create ' . substr($r->body, 0, 160));
    return envelope($r)['data']['overtimeRecord'];
};
$submitted = static fn (array $w, string $employee = 'e_a1', string $who = 'ceoA'): array => $ot($w, 'submit', $draft($w, $employee, $who), $who);
$reviewed = static fn (array $w, string $employee = 'e_a1', string $who = 'ceoA'): array => $ot($w, 'review', $submitted($w, $employee, $who), $who);
/** Every row a refused archive or submit must leave exactly as it was. */
$everything = static fn (Database $db): array => [
    $db->select('SELECT id, archived_at, version, updated_at FROM employees ORDER BY id'),
    $db->select('SELECT id, status, version, updated_at, approved_amount FROM overtime_records ORDER BY id'),
    (int) $db->select('SELECT COUNT(*) AS n FROM audit_events')[0]['n'],
];
$status = static fn (Database $db, string $id): string => (string) $db->select('SELECT status FROM overtime_records WHERE id = ?', [$id])[0]['status'];

// Worker processes (tests/Support/overtime-worker.php), one HTTP write each, on their own connection.
$spawn = static function (array $w, string $who, string $op, array $body): array {
    $cmd = [PHP_BINARY];
    if (php_ini_loaded_file() === false) {
        $cmd[] = '-n';
    }
    array_push($cmd, dirname(__DIR__) . '/Support/overtime-worker.php', $w['s'][$who]['token'], $w['s'][$who]['csrf'], $op, json_encode($body, JSON_THROW_ON_ERROR));
    $proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, getenv());
    assertTrue(is_resource($proc), 'worker started');
    fclose($pipes[0]);
    return [$proc, $pipes];
};
$finish = static function (array $worker): string {
    [$proc, $pipes] = $worker;
    $stdout = (string) stream_get_contents($pipes[1]);
    $stderr = (string) stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    assertSame(0, proc_close($proc), 'worker exit: ' . $stderr);
    return trim($stdout);
};
$lockEmployee = 'SELECT id FROM employees WHERE id = ? FOR UPDATE';
$blockedOnArchive = 'SELECT id, company_id, id AS owner_employee_id, employee_code, full_name';      // EmployeeStore::LOCK_PROFILE_SQL
$blockedOnSubmit = 'SELECT id, company_id, id AS owner_employee_id, employment_status, archived_at'; // OvertimeStore::LOCK_EMPLOYEE_SQL
$blockedOnApprove = 'SELECT id, company_id, id AS owner_employee_id, monthly_base_salary';          // OvertimeStore::LOCK_VALUATION_EMPLOYEE_SQL
/** The worker blocked on e_a1's row while a second connection holds it; $meanwhile runs, then commits. */
$race = static function (array $w, string $op, array $body, string $blockedOn, Closure $meanwhile) use ($spawn, $finish, $lockEmployee): string {
    $worker = null;
    secondConnection()->transaction(static function (Database $tx) use ($w, $op, $body, $blockedOn, $meanwhile, $spawn, $lockEmployee, &$worker): void {
        assertTrue(count($tx->select($lockEmployee, ['e_a1'])) === 1, 'the holder locked the employee row');
        $worker = $spawn($w, 'ceoA', $op, $body);
        awaitBlockedStatements($tx, $blockedOn, 1);
        $meanwhile($tx);
    });
    return $finish($worker);
};

return [
    'Submitted or Reviewed overtime blocks the archive (409); the refusal writes nothing' => static function () use ($world, $archive, $code, $submitted, $reviewed, $everything, $archived): void {
        foreach (['Submitted' => $submitted, 'Reviewed' => $reviewed] as $label => $make) {
            $w = $world();
            $rec = $make($w);
            assertSame($label, $rec['status'], 'fixture');
            $before = $everything($w['db']);
            assertSame([409, 'conflict'], $code($archive($w, 'ceoA', 'e_a1')), $label . ' overtime blocks the archive');
            assertSame($before, $everything($w['db']), $label . ': employee, overtime and audit unchanged');
            assertSame(false, $archived($w['db'], 'e_a1'), $label . ': not archived');
        }
    },
    'Draft, Approved and Rejected overtime do not block the archive; it is audited once' => static function () use ($world, $archive, $draft, $ot, $reviewed, $submitted, $status, $archived): void {
        $w = $world();
        $d = $draft($w);
        $a = $ot($w, 'approve', $reviewed($w));
        $x = $ot($w, 'reject', $submitted($w));
        assertSame(['Draft', 'Approved', 'Rejected'], [$d['status'], $a['status'], $x['status']], 'fixtures');
        $audits = (int) $w['db']->select('SELECT COUNT(*) AS n FROM audit_events')[0]['n'];
        $r = $archive($w, 'ceoA', 'e_a1');
        assertSame(200, $r->status, 'archive ' . substr($r->body, 0, 160));
        assertSame(true, envelope($r)['data']['employee']['archived'], 'archived');
        assertSame(true, $archived($w['db'], 'e_a1'));
        assertSame(['Draft', 'Approved', 'Rejected'], [$status($w['db'], $d['id']), $status($w['db'], $a['id']), $status($w['db'], $x['id'])], 'the overtime is untouched');
        $rows = $w['db']->select('SELECT action, fields FROM audit_events ORDER BY id');
        assertSame($audits + 1, count($rows), 'exactly one new audit row');
        assertSame(['employee.delete', 'archived'], [(string) end($rows)['action'], (string) end($rows)['fields']], 'the archive audit row');
    },
    'resolving the pending overtime — rejecting it, or approving it — permits the archive' => static function () use ($world, $archive, $code, $ot, $submitted, $reviewed, $archived): void {
        $w = $world();
        $s = $submitted($w);
        assertSame([409, 'conflict'], $code($archive($w, 'ceoA', 'e_a1')), 'pending');
        $ot($w, 'reject', $s);
        assertSame(200, $archive($w, 'ceoA', 'e_a1')->status, 'after the reject');
        assertSame(true, $archived($w['db'], 'e_a1'));
        $w = $world();
        $r = $reviewed($w);
        $s2 = $submitted($w);
        assertSame([409, 'conflict'], $code($archive($w, 'ceoA', 'e_a1')), 'two pending');
        $ot($w, 'approve', $r);
        assertSame([409, 'conflict'], $code($archive($w, 'ceoA', 'e_a1')), 'one still pending');
        $ot($w, 'reject', $s2);
        assertSame(200, $archive($w, 'ceoA', 'e_a1')->status, 'after both are decided');
    },
    'a Draft is never submitted after the archive (409); nothing is written' => static function () use ($world, $archive, $code, $draft, $post, $everything, $status): void {
        $w = $world();
        $d = $draft($w);
        assertSame(200, $archive($w, 'ceoA', 'e_a1')->status, 'a Draft does not block');
        $before = $everything($w['db']);
        assertSame([409, 'conflict'], $code($post($w, 'ceoA', '/api/overtime-records/submit', ['id' => $d['id'], 'expectedVersion' => $d['version']])), 'submit under an archived employee');
        assertSame($before, $everything($w['db']), 'record, employee and audit unchanged');
        assertSame('Draft', $status($w['db'], $d['id']));
        // Review and reject keep their semantics: an Employee's own Draft submit on a live employee still works.
        $own = $draft($w, 'e_a2', 'empA2');
        assertSame(200, $post($w, 'empA2', '/api/overtime-records/submit', ['id' => $own['id'], 'expectedVersion' => $own['version']])->status, 'own submit on a live employee');
    },
    'scope, authorization and versions are unchanged: another company is 404, an Employee 403, a stale version 409; others\' overtime never blocks' => static function () use ($world, $archive, $code, $submitted, $draft, $post, $version, $archived, $everything): void {
        $w = $world();
        $submitted($w, 'e_a2');                                                   // a colleague's pending overtime
        $submitted($w, 'e_b1', 'ceoB');                                           // another company's pending overtime
        $before = $everything($w['db']);
        assertSame([404, 'not_found'], $code($archive($w, 'ceoB', 'e_a1', 1)), 'another company');
        assertSame([404, 'not_found'], $code($archive($w, 'empA2', 'e_a1', 1)), 'an Employee: a colleague is out of scope');
        assertSame([403, 'forbidden'], $code($archive($w, 'empA2', 'e_a2', 1)), 'an Employee: the own record, CEO-only archive');
        assertSame([409, 'conflict'], $code($archive($w, 'ceoA', 'e_a1', $version($w['db'], 'e_a1') + 1)), 'a stale version');
        assertSame($before, $everything($w['db']), 'the refusals wrote nothing');
        $d = $draft($w);
        assertSame([404, 'not_found'], $code($post($w, 'ceoB', '/api/overtime-records/submit', ['id' => $d['id'], 'expectedVersion' => $d['version']])), 'another company never submits');
        assertSame(200, $archive($w, 'ceoA', 'e_a1')->status, 'e_a1 is archived although a colleague and another company have pending overtime');
        assertSame([false, true], [$archived($w['db'], 'e_a2'), $archived($w['db'], 'e_a1')]);
    },
    'submit waits on the employee row lock: while it is held, nothing is written (503)' => static function () use ($world, $draft, $post, $code, $everything, $lockEmployee): void {
        $w = $world();
        $d = $draft($w);
        $before = $everything($w['db']);
        $w['db']->execute('SET SESSION innodb_lock_wait_timeout = 1');
        try {
            $r = secondConnection()->transaction(static function (Database $tx) use ($w, $d, $post, $lockEmployee): Response {
                assertTrue(count($tx->select($lockEmployee, ['e_a1'])) === 1, 'the holder locked the employee row');
                return $post($w, 'ceoA', '/api/overtime-records/submit', ['id' => $d['id'], 'expectedVersion' => $d['version']]);
            });
        } finally {
            $w['db']->execute('SET SESSION innodb_lock_wait_timeout = 50');
        }
        assertSame([503, 'service_unavailable'], $code($r), 'submit waited on the employee row');
        assertSame($before, $everything($w['db']), 'nothing written');
    },
    'race: a submit waiting on the employee lock while the employee is archived is refused (409); the record stays Draft' => static function () use ($world, $draft, $race, $blockedOnSubmit, $status, $archived): void {
        $w = $world();
        $d = $draft($w);
        $out = $race($w, 'submit', ['id' => $d['id'], 'expectedVersion' => $d['version']], $blockedOnSubmit,
            static fn (Database $tx) => $tx->execute('UPDATE employees SET archived_at = UTC_TIMESTAMP(6), version = version + 1 WHERE id = ?', ['e_a1']));
        assertSame('409 conflict', $out, 'the archive committed first');
        assertSame(['Draft', true], [$status($w['db'], $d['id']), $archived($w['db'], 'e_a1')], 'no Submitted record under an archived employee');
        assertSame(0, (int) $w['db']->select("SELECT COUNT(*) AS n FROM audit_events WHERE operation = 'submit'")[0]['n'], 'no submit audited');
    },
    'race: an archive waiting on the employee lock while a Draft is submitted is refused (409); the employee stays live' => static function () use ($world, $draft, $race, $version, $blockedOnArchive, $status, $archived): void {
        $w = $world();
        $d = $draft($w);
        $out = $race($w, 'archive', ['id' => 'e_a1', 'expectedVersion' => $version($w['db'], 'e_a1')], $blockedOnArchive,
            static fn (Database $tx) => $tx->execute("UPDATE overtime_records SET status = 'Submitted', version = version + 1 WHERE id = ?", [$d['id']]));
        assertSame('409 conflict', $out, 'the submit committed first');
        assertSame(['Submitted', false], [$status($w['db'], $d['id']), $archived($w['db'], 'e_a1')], 'the Submitted record keeps a live employee');
        assertSame(0, (int) $w['db']->select("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'employee.delete'")[0]['n'], 'no archive audited');
    },
    'race: an archive waiting on the employee lock while the pending overtime is approved succeeds; one waiting while it stays pending is refused' => static function () use ($world, $reviewed, $race, $version, $blockedOnArchive, $status, $archived): void {
        $w = $world();
        $r = $reviewed($w);
        $out = $race($w, 'archive', ['id' => 'e_a1', 'expectedVersion' => $version($w['db'], 'e_a1')], $blockedOnArchive,
            static fn (Database $tx) => $tx->execute("UPDATE overtime_records SET status = 'Approved', valuation_method = 'TAM-OT-1', valuation_salary = '3500000.00', valuation_standard_hours = '160.00', approved_amount = '21875.00', approved_at = UTC_TIMESTAMP(6), version = version + 1 WHERE id = ?", [$r['id']]));
        assertSame('200 ok', $out, 'the approval committed first: nothing is pending');
        assertSame(['Approved', true], [$status($w['db'], $r['id']), $archived($w['db'], 'e_a1')]);
        $w = $world();
        $r = $reviewed($w);
        $out = $race($w, 'archive', ['id' => 'e_a1', 'expectedVersion' => $version($w['db'], 'e_a1')], $blockedOnArchive, static fn (Database $tx) => null);
        assertSame('409 conflict', $out, 'still Reviewed');
        assertSame(['Reviewed', false], [$status($w['db'], $r['id']), $archived($w['db'], 'e_a1')]);
    },
    'archive and approve queued on the same employee lock finish deterministically and without deadlock, in either order' => static function () use ($world, $reviewed, $spawn, $finish, $version, $lockEmployee, $blockedOnArchive, $blockedOnApprove, $status, $archived): void {
        foreach (['approve first', 'archive first'] as $order) {
            $w = $world();
            $r = $reviewed($w);
            $approveBody = ['id' => $r['id'], 'expectedVersion' => $r['version'], 'expectedAmount' => '21875.00'];
            $archiveBody = ['id' => 'e_a1', 'expectedVersion' => $version($w['db'], 'e_a1')];
            $workers = [];
            secondConnection()->transaction(static function (Database $tx) use ($w, $order, $approveBody, $archiveBody, $spawn, $lockEmployee, $blockedOnArchive, $blockedOnApprove, &$workers): void {
                assertTrue(count($tx->select($lockEmployee, ['e_a1'])) === 1, 'the holder locked the employee row');
                $steps = [['approve', $approveBody, $blockedOnApprove], ['archive', $archiveBody, $blockedOnArchive]];
                foreach ($order === 'approve first' ? $steps : array_reverse($steps) as [$op, $body, $blockedOn]) {
                    $workers[$op] = $spawn($w, 'ceoA', $op, $body);
                    awaitBlockedStatements($tx, $blockedOn, 1);
                }
            });
            $outApprove = $finish($workers['approve']);
            $outArchive = $finish($workers['archive']);
            assertSame('200 ok', $outApprove, $order . ': the approval always succeeds (the archive never archives over pending overtime)');
            assertTrue(in_array($outArchive, ['200 ok', '409 conflict'], true), $order . ': the archive is decided, never a deadlock or an error — ' . $outArchive);
            assertSame(['Approved', $outArchive === '200 ok'], [$status($w['db'], $r['id']), $archived($w['db'], 'e_a1')], $order . ': the outcome matches the state');
        }
    },
];
