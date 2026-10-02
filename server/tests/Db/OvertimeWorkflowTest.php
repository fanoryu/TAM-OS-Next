<?php
declare(strict_types=1);

/*
 * BF-4b1 overtime workflow end to end against the real MariaDB: real login → real session →
 * production routes → OvertimeService → OvertimeStore / AuditLog. Draft create (CEO for an
 * employee, Employee for self), eligibility, the month list and detail, the versioned Draft
 * update, every legal and illegal transition, the Draft-only hard delete, the audit row of each
 * write in the same transaction (surviving a delete), rollback when it cannot be written, and
 * the list cap. Fabricated data only.
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
use TamOs\Http\Response;
use TamOs\Overtime\OvertimeView;
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
 * Company A: a CEO, an Employee bound to e_a1, a colleague bound to e_a2 and an unbound employee
 * e_a3. Company B: a CEO and an employee e_b1. Everyone logs in for real.
 *
 * @return array{db: Database, k: Kernel, a: string, b: string, s: array<string, array{token: string, csrf: string, userId: string, membershipId: string}>}
 */
$world = static function (): array {
    $db = authDatabase();
    $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
    $ceoA = authFixture($db);
    $a = $ceoA['companyId'];
    $ceoB = authFixture($db);
    $fixtures = ['ceoA' => $ceoA, 'empA1' => authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a1']),
        'empA2' => authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a2']), 'ceoB' => $ceoB];
    employeeAnchor($db, $a, 'e_a3');
    employeeAnchor($db, $ceoB['companyId'], 'e_b1');
    $s = [];
    foreach ($fixtures as $name => $f) {
        $r = $k->handle(loginRequest($f['email'], (string) $f['password']), requestId());
        assertSame(200, $r->status, 'login ' . $name);
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken'], 'userId' => $f['userId'], 'membershipId' => $f['membershipId']];
    }
    return ['db' => $db, 'k' => $k, 'a' => $a, 'b' => $ceoB['companyId'], 's' => $s];
};
$get = static fn (array $w, string $who, string $path, string $query = ''): Response
    => $w['k']->handle(sessionRequest('GET', $path, $w['s'][$who]['token'], null, '', ['query' => $query]), requestId());
$post = static fn (array $w, string $who, string $path, array $body): Response
    => $w['k']->handle(sessionRequest('POST', $path, $w['s'][$who]['token'], $w['s'][$who]['csrf'], json_encode($body, JSON_THROW_ON_ERROR)), requestId());
$ok = static function (Response $r, string $label): array {
    assertSame(200, $r->status, $label . ' (' . substr($r->body, 0, 200) . ')');
    return envelope($r)['data'];
};
$code = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
$create = static fn (array $w, string $who, array $body): array
    => $ok($post($w, $who, '/api/overtime-records/create', $body + ['employeeId' => 'e_a1', 'monthKey' => '2026-10', 'hours' => '2.00']), 'create')['overtimeRecord'];
$step = static fn (array $w, string $who, string $op, array $rec): Response => $post($w, $who, '/api/overtime-records/' . $op, ['id' => $rec['id'], 'expectedVersion' => $rec['version']]);
$audits = static fn (Database $db, string $id): array => array_map(
    static fn (array $r): array => array_map(static fn ($v) => $v === null ? null : (string) $v, $r),
    $db->select('SELECT company_id, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields FROM audit_events WHERE entity_id = ? ORDER BY id', [$id]),
);
$row = static fn (Database $db, string $id): ?array => $db->select('SELECT company_id, employee_id, month_key, overtime_date, hours, status, version FROM overtime_records WHERE id = ?', [$id])[0] ?? null;

return [
    'CEO create: a version 1 Draft with a server id in the session company, exact hours, and its audit row' => static function () use ($world, $create, $audits, $row): void {
        $w = $world();
        $o = $create($w, 'ceoA', ['employeeId' => 'e_a3', 'overtimeDate' => '2026-10-07', 'workDescription' => 'Fabricated month-end close', 'hours' => '3.25']);
        assertTrue(preg_match('/^[0-9a-f]{32}$/', $o['id']) === 1, 'server-generated opaque id');
        assertSame(OvertimeView::FIELDS, array_keys($o), 'exact DTO');
        assertSame(['e_a3', '2026-10', '2026-10-07', '3.25', 'Fabricated month-end close', null, 'Draft', 1],
            [$o['employeeId'], $o['monthKey'], $o['overtimeDate'], $o['hours'], $o['workDescription'], $o['notes'], $o['status'], $o['version']]);
        assertSame([$w['a'], 'e_a3', '2026-10', '2026-10-07', '3.25', 'Draft', '1'], array_map('strval', array_values($row($w['db'], $o['id']))), 'stored in company A');
        $log = $audits($w['db'], $o['id']);
        assertSame([[$w['a'], $w['s']['ceoA']['userId'], $w['s']['ceoA']['membershipId'], 'overtime.createSelfDraft', 'overtime', $o['id'], null, null, requestId(), 'monthKey,overtimeDate,hours,workDescription']], array_map('array_values', $log), 'actor from the session, field names only');
        assertTrue(!str_contains((string) $log[0]['fields'], 'Fabricated') && !str_contains((string) $log[0]['fields'], '3.25'), 'no value in the audit row');
    },
    'Employee create: only for self, whatever employeeId says about a colleague; the owner is bound from the session' => static function () use ($world, $create, $post, $code, $audits): void {
        $w = $world();
        $o = $create($w, 'empA1', ['employeeId' => 'e_a1']);
        assertSame(['e_a1', 'Draft', 1], [$o['employeeId'], $o['status'], $o['version']]);
        assertSame($w['s']['empA1']['userId'], $audits($w['db'], $o['id'])[0]['actor_user_id'], 'the Employee is the actor');
        $before = (int) $w['db']->select('SELECT COUNT(*) AS n FROM overtime_records')[0]['n'];
        foreach (['e_a2' => 'a colleague', 'e_a3' => 'an unbound employee', 'e_b1' => 'another company', 'e_zz' => 'absent'] as $target => $label) {
            assertSame([404, 'not_found'], $code($post($w, 'empA1', '/api/overtime-records/create', ['employeeId' => $target, 'monthKey' => '2026-10', 'hours' => '1.00'])), $label);
        }
        assertSame($before, (int) $w['db']->select('SELECT COUNT(*) AS n FROM overtime_records')[0]['n'], 'nothing written for a refused create');
    },
    'create eligibility: the employee must be in company scope, live and Active (409 otherwise, nothing written)' => static function () use ($world, $post, $code, $create): void {
        $w = $world();
        $body = static fn (string $e): array => ['employeeId' => $e, 'monthKey' => '2026-10', 'hours' => '1.00'];
        assertSame([404, 'not_found'], $code($post($w, 'ceoA', '/api/overtime-records/create', $body('e_b1'))), 'a company B employee is out of scope');
        assertSame([404, 'not_found'], $code($post($w, 'ceoB', '/api/overtime-records/create', $body('e_a1'))), 'and the other way round');
        foreach (['Inactive', 'On Leave', 'Resigned', 'Terminated'] as $status) {
            $w['db']->execute('UPDATE employees SET employment_status = ? WHERE id = ?', [$status, 'e_a3']);
            assertSame([409, 'conflict'], $code($post($w, 'ceoA', '/api/overtime-records/create', $body('e_a3'))), $status);
        }
        $w['db']->execute("UPDATE employees SET employment_status = 'Active', archived_at = UTC_TIMESTAMP(6) WHERE id = 'e_a3'");
        assertSame([409, 'conflict'], $code($post($w, 'ceoA', '/api/overtime-records/create', $body('e_a3'))), 'archived');
        assertSame(0, (int) $w['db']->select("SELECT COUNT(*) AS n FROM overtime_records WHERE employee_id = 'e_a3'")[0]['n'], 'nothing written');
        assertSame(0, (int) $w['db']->select("SELECT COUNT(*) AS n FROM audit_events WHERE entity = 'overtime'")[0]['n'], 'nothing audited');
        $w['db']->execute("UPDATE employees SET archived_at = NULL WHERE id = 'e_a3'");
        $create($w, 'ceoA', ['employeeId' => 'e_a3']);
    },
    'existing records stay readable and keep their workflow after the employee is archived or leaves' => static function () use ($world, $create, $get, $ok, $step): void {
        $w = $world();
        $o = $create($w, 'ceoA', ['employeeId' => 'e_a3']);
        $w['db']->execute("UPDATE employees SET employment_status = 'Resigned', archived_at = UTC_TIMESTAMP(6) WHERE id = 'e_a3'");
        assertSame('Draft', $ok($get($w, 'ceoA', '/api/overtime-record', 'id=' . $o['id']), 'detail')['overtimeRecord']['status']);
        $s = $ok($step($w, 'ceoA', 'submit', $o), 'submit after archive')['overtimeRecord'];
        assertSame('Rejected', $ok($step($w, 'ceoA', 'reject', $s), 'reject after archive')['overtimeRecord']['status']);
    },
    'the month list: required month, company scope for the CEO, own rows for an Employee, date desc (undated last) then id' => static function () use ($world, $create, $get, $ok): void {
        $w = $world();
        $a = $create($w, 'ceoA', ['employeeId' => 'e_a1', 'overtimeDate' => '2026-10-03']);
        $b = $create($w, 'ceoA', ['employeeId' => 'e_a2', 'overtimeDate' => '2026-10-20']);
        $c = $create($w, 'ceoA', ['employeeId' => 'e_a1']);
        $create($w, 'ceoA', ['employeeId' => 'e_a1', 'monthKey' => '2026-11']);
        $create($w, 'ceoB', ['employeeId' => 'e_b1', 'notes' => 'company B private']);
        $ceo = $ok($get($w, 'ceoA', '/api/overtime-records', 'month=2026-10'), 'ceo')['overtimeRecords'];
        assertSame([$b['id'], $a['id'], $c['id']], array_column($ceo, 'id'), 'one month, newest date first, undated last');
        foreach ($ceo as $item) {
            assertSame(OvertimeView::FIELDS, array_keys($item), 'exact DTO');
        }
        assertNoLeak(json_encode($ceo, JSON_THROW_ON_ERROR), ['company B private', $w['b'], 'e_b1']);
        assertSame([$a['id'], $c['id']], array_column($ok($get($w, 'empA1', '/api/overtime-records', 'month=2026-10'), 'own')['overtimeRecords'], 'id'), 'the Employee sees own rows only');
        assertSame([$b['id']], array_column($ok($get($w, 'empA2', '/api/overtime-records', 'month=2026-10'), 'colleague')['overtimeRecords'], 'id'));
        assertSame([], $ok($get($w, 'ceoA', '/api/overtime-records', 'month=2026-12'), 'empty month')['overtimeRecords']);
        assertSame(1, count($ok($get($w, 'ceoB', '/api/overtime-records', 'month=2026-10'), 'company B')['overtimeRecords']));
    },
    'detail: own or in-company only; another company, a colleague and an absent id are the same 404' => static function () use ($world, $create, $get, $ok, $code): void {
        $w = $world();
        $mine = $create($w, 'ceoA', ['employeeId' => 'e_a1']);
        $theirs = $create($w, 'ceoA', ['employeeId' => 'e_a2']);
        $other = $create($w, 'ceoB', ['employeeId' => 'e_b1']);
        assertSame($mine, $ok($get($w, 'empA1', '/api/overtime-record', 'id=' . $mine['id']), 'own')['overtimeRecord']);
        assertSame([404, 'not_found'], $code($get($w, 'empA1', '/api/overtime-record', 'id=' . $theirs['id'])), 'colleague');
        assertSame([404, 'not_found'], $code($get($w, 'ceoA', '/api/overtime-record', 'id=' . $other['id'])), 'company B');
        assertSame([404, 'not_found'], $code($get($w, 'ceoA', '/api/overtime-record', 'id=' . str_repeat('0', 32))), 'absent');
    },
    'update: a Draft only, changed fields named, version + 1; stale 409; a no-op is no write; the date/month rule holds' => static function () use ($world, $create, $post, $ok, $code, $audits, $row): void {
        $w = $world();
        $o = $create($w, 'empA1', ['overtimeDate' => '2026-10-05']);
        $u = $ok($post($w, 'empA1', '/api/overtime-records/update', ['id' => $o['id'], 'expectedVersion' => 1, 'hours' => '4.75', 'notes' => 'Fabricated note', 'monthKey' => '2026-10']), 'update')['overtimeRecord'];
        assertSame(['4.75', 'Fabricated note', 2], [$u['hours'], $u['notes'], $u['version']]);
        assertSame(['overtime.updateSelfDraft', null, 'hours,notes'], [$audits($w['db'], $o['id'])[1]['action'], $audits($w['db'], $o['id'])[1]['operation'], $audits($w['db'], $o['id'])[1]['fields']], 'only what changed');
        assertSame([409, 'conflict'], $code($post($w, 'empA1', '/api/overtime-records/update', ['id' => $o['id'], 'expectedVersion' => 1, 'hours' => '9.00'])), 'stale version');
        assertSame(['4.75', '2'], [(string) $row($w['db'], $o['id'])['hours'], (string) $row($w['db'], $o['id'])['version']], 'a stale write changes nothing');
        $same = $ok($post($w, 'empA1', '/api/overtime-records/update', ['id' => $o['id'], 'expectedVersion' => 2, 'hours' => '4.75', 'workDescription' => '']), 'no-op')['overtimeRecord'];
        assertSame(2, $same['version'], 'a no-op is not a write');
        assertSame(2, count($audits($w['db'], $o['id'])), 'and is not audited');
        assertSame([400, 'validation_failed'], $code($post($w, 'empA1', '/api/overtime-records/update', ['id' => $o['id'], 'expectedVersion' => 2, 'monthKey' => '2026-11'])), 'moving the month strands the date');
        $moved = $ok($post($w, 'ceoA', '/api/overtime-records/update', ['id' => $o['id'], 'expectedVersion' => 2, 'monthKey' => '2026-11', 'overtimeDate' => null]), 'the CEO moves it with the date cleared')['overtimeRecord'];
        assertSame(['2026-11', null, 3], [$moved['monthKey'], $moved['overtimeDate'], $moved['version']]);
        $s = $ok($post($w, 'empA1', '/api/overtime-records/submit', ['id' => $o['id'], 'expectedVersion' => 3]), 'submit')['overtimeRecord'];
        assertSame([409, 'conflict'], $code($post($w, 'ceoA', '/api/overtime-records/update', ['id' => $o['id'], 'expectedVersion' => $s['version'], 'hours' => '1.00'])), 'the CEO cannot edit after submission');
        assertSame([403, 'forbidden'], $code($post($w, 'empA1', '/api/overtime-records/update', ['id' => $o['id'], 'expectedVersion' => $s['version'], 'hours' => '1.00'])), 'neither can the owner (own-Draft rule)');
    },
    'transitions: Draft → Submitted → Reviewed → Rejected, each version + 1 and audited with its operation' => static function () use ($world, $create, $step, $ok, $audits): void {
        $w = $world();
        $o = $create($w, 'empA1', []);
        $s = $ok($step($w, 'empA1', 'submit', $o), 'submit')['overtimeRecord'];
        $r = $ok($step($w, 'ceoA', 'review', $s), 'review')['overtimeRecord'];
        $x = $ok($step($w, 'ceoA', 'reject', $r), 'reject')['overtimeRecord'];
        assertSame([['Submitted', 2], ['Reviewed', 3], ['Rejected', 4]], [[$s['status'], $s['version']], [$r['status'], $r['version']], [$x['status'], $x['version']]]);
        $log = $audits($w['db'], $o['id']);
        assertSame([['overtime.createSelfDraft', null, $w['s']['empA1']['userId']], ['overtime.submitSelf', 'submit', $w['s']['empA1']['userId']], ['overtime.manage', 'review', $w['s']['ceoA']['userId']], ['overtime.manage', 'reject', $w['s']['ceoA']['userId']]],
            array_map(static fn (array $l): array => [$l['action'], $l['operation'], $l['actor_user_id']], $log));
        assertSame([null, null, null], array_map(static fn (array $l): ?string => $l['fields'], array_slice($log, 1)), 'a transition names no field');
        $direct = $create($w, 'ceoA', ['employeeId' => 'e_a2']);
        $ds = $ok($step($w, 'ceoA', 'submit', $direct), 'the CEO submits on the owner\'s behalf')['overtimeRecord'];
        assertSame('Rejected', $ok($step($w, 'ceoA', 'reject', $ds), 'Submitted → Rejected')['overtimeRecord']['status']);
    },
    'illegal transitions are 409 and change nothing; Rejected is terminal; there is no approve route' => static function () use ($world, $create, $step, $ok, $code, $post, $row): void {
        $w = $world();
        $draft = $create($w, 'ceoA', []);
        assertSame([409, 'conflict'], $code($step($w, 'ceoA', 'review', $draft)), 'Draft → Reviewed');
        assertSame([409, 'conflict'], $code($step($w, 'ceoA', 'reject', $draft)), 'Draft → Rejected');
        $sub = $ok($step($w, 'ceoA', 'submit', $draft), 'submit')['overtimeRecord'];
        assertSame([409, 'conflict'], $code($step($w, 'ceoA', 'submit', $sub)), 'Submitted → Submitted');
        $rev = $ok($step($w, 'ceoA', 'review', $sub), 'review')['overtimeRecord'];
        assertSame([409, 'conflict'], $code($step($w, 'ceoA', 'submit', $rev)), 'Reviewed → Submitted');
        assertSame([409, 'conflict'], $code($step($w, 'ceoA', 'review', $rev)), 'Reviewed → Reviewed');
        assertSame([409, 'conflict'], $code($post($w, 'ceoA', '/api/overtime-records/delete', ['id' => $rev['id'], 'expectedVersion' => $rev['version']])), 'a Reviewed record is never deleted');
        $rej = $ok($step($w, 'ceoA', 'reject', $rev), 'reject')['overtimeRecord'];
        foreach (['submit', 'review', 'reject'] as $op) {
            assertSame([409, 'conflict'], $code($step($w, 'ceoA', $op, $rej)), 'Rejected → ' . $op);
        }
        assertSame([409, 'conflict'], $code($post($w, 'ceoA', '/api/overtime-records/update', ['id' => $rej['id'], 'expectedVersion' => $rej['version'], 'hours' => '1.00'])), 'Rejected is not editable');
        assertSame([409, 'conflict'], $code($post($w, 'ceoA', '/api/overtime-records/delete', ['id' => $rej['id'], 'expectedVersion' => $rej['version']])), 'or deletable');
        assertSame(['Rejected', '4'], [(string) $row($w['db'], $rej['id'])['status'], (string) $row($w['db'], $rej['id'])['version']], 'unchanged');
        assertSame([404, 'not_found'], $code($post($w, 'ceoA', '/api/overtime-records/approve', ['id' => $rej['id'], 'expectedVersion' => 4])), 'no approve route in BF-4b1');
    },
    'delete: a Draft only, hard, at its version; the audit row survives the record and names it' => static function () use ($world, $create, $post, $ok, $code, $get, $audits, $row): void {
        $w = $world();
        $o = $create($w, 'empA1', []);
        assertSame([409, 'conflict'], $code($post($w, 'empA1', '/api/overtime-records/delete', ['id' => $o['id'], 'expectedVersion' => 2])), 'stale version');
        assertSame(['deleted' => ['id' => $o['id']]], $ok($post($w, 'empA1', '/api/overtime-records/delete', ['id' => $o['id'], 'expectedVersion' => 1]), 'delete'));
        assertSame(null, $row($w['db'], $o['id']), 'hard-deleted');
        assertSame([404, 'not_found'], $code($get($w, 'empA1', '/api/overtime-record', 'id=' . $o['id'])), 'gone');
        assertSame([404, 'not_found'], $code($post($w, 'empA1', '/api/overtime-records/delete', ['id' => $o['id'], 'expectedVersion' => 1])), 'a second delete finds nothing');
        $log = $audits($w['db'], $o['id']);
        assertSame([['overtime.createSelfDraft', 'monthKey,hours'], ['overtime.deleteSelfDraft', null]], array_map(static fn (array $l): array => [$l['action'], $l['fields']], $log), 'create then delete, both attributable; a delete names no field');
        assertSame([$w['a'], $w['s']['empA1']['userId'], 'overtime', $o['id']], [$log[1]['company_id'], $log[1]['actor_user_id'], $log[1]['entity'], $log[1]['entity_id']]);
        $c = $create($w, 'ceoA', ['employeeId' => 'e_a2']);
        $ok($post($w, 'ceoA', '/api/overtime-records/delete', ['id' => $c['id'], 'expectedVersion' => 1]), 'the CEO deletes a Draft');
    },
    'a failing audit append rolls back the overtime write it records (create, update, transition, delete)' => static function () use ($world, $create, $post, $code, $row): void {
        $w = $world();
        $o = $create($w, 'ceoA', []);
        $last = (string) $w['db']->select('SELECT MAX(occurred_at) AS m FROM audit_events')[0]['m'];
        assertTrue(preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/', $last) === 1, 'a database timestamp');
        usleep(2000);
        // Test-only DDL: every further audit insert violates this CHECK — inside the write's transaction.
        $w['db']->execute("ALTER TABLE audit_events ADD CONSTRAINT test_block_audit CHECK (occurred_at <= '" . $last . "')");
        $count = static fn (): int => (int) $w['db']->select('SELECT COUNT(*) AS n FROM overtime_records')[0]['n'];
        assertSame([500, 'internal_error'], $code($post($w, 'ceoA', '/api/overtime-records/create', ['employeeId' => 'e_a1', 'monthKey' => '2026-10', 'hours' => '1.00'])), 'create');
        assertSame(1, $count(), 'no record without its audit row');
        assertSame([500, 'internal_error'], $code($post($w, 'ceoA', '/api/overtime-records/update', ['id' => $o['id'], 'expectedVersion' => 1, 'hours' => '9.00'])), 'update');
        assertSame([500, 'internal_error'], $code($post($w, 'ceoA', '/api/overtime-records/submit', ['id' => $o['id'], 'expectedVersion' => 1])), 'submit');
        assertSame([500, 'internal_error'], $code($post($w, 'ceoA', '/api/overtime-records/delete', ['id' => $o['id'], 'expectedVersion' => 1])), 'delete');
        assertSame(['2.00', 'Draft', '1'], [(string) $row($w['db'], $o['id'])['hours'], (string) $row($w['db'], $o['id'])['status'], (string) $row($w['db'], $o['id'])['version']], 'everything rolled back; the Draft still exists');
    },
    'the month list fails closed above 2000 entitled rows instead of truncating' => static function () use ($world, $get, $ok, $code): void {
        $w = $world();
        $insert = static function (Database $db, string $company, int $from, int $count): void {
            $values = [];
            $params = [];
            for ($i = $from; $i < $from + $count; $i++) {
                $values[] = "(?, ?, 'e_b1', '2026-10', NULL, '1.00', NULL, NULL, 'Draft', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))";
                array_push($params, sprintf('%032x', $i + 1), $company);
            }
            $db->execute('INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at) VALUES ' . implode(', ', $values), $params);
        };
        $insert($w['db'], $w['b'], 0, 2000);
        assertSame(2000, count($ok($get($w, 'ceoB', '/api/overtime-records', 'month=2026-10'), 'at the cap')['overtimeRecords']), 'exactly the cap is served');
        $insert($w['db'], $w['b'], 2000, 1);
        assertSame([500, 'internal_error'], $code($get($w, 'ceoB', '/api/overtime-records', 'month=2026-10')), 'above the cap');
        assertSame(0, count($ok($get($w, 'ceoA', '/api/overtime-records', 'month=2026-10'), 'company A unaffected')['overtimeRecords']));
        assertSame(0, count($ok($get($w, 'ceoB', '/api/overtime-records', 'month=2026-11'), 'another month unaffected')['overtimeRecords']));
    },
];
