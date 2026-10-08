<?php
declare(strict_types=1);

/*
 * BF-4g CEO audit read against the real MariaDB (owner decisions D-BF4g-1..4 = A): real login →
 * real session → production routes → AuditService → AuditEventStore → audit_events. Rows are placed
 * at exact stored UTC instants with test-only SQL (fabricated identifiers only); real rows are also
 * written through the real AuditLog by real overtime routes. Proven: the Asia/Jakarta month as a
 * half-open UTC window to the microsecond (month edges, a leap and a common February, the December →
 * January rollover), the total order (occurred_at, id), the eleven-key projection (no company id;
 * nullable operation, target and field list), the record history filtered by company, entity and id
 * — a deleted record keeps its history and an unknown one is [] — the 2,000 / 2,001 cap failing
 * closed with no partial list, the existing indexes serving both reads, and that the reads write
 * nothing and never expose auth_events.
 */

use TamOs\Audit\AuditEventView;
use TamOs\Data\Audit\AuditEventStore;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
use TamOs\Http\Response;
use function TamOs\Tests\assertNoLeak;
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
 * Company A: a CEO and e_a1 (an Employee login). Company B: a CEO.
 *
 * @return array{db: Database, k: Kernel, a: string, b: string, f: array<string, array<string, mixed>>, s: array<string, array{token: string, csrf: string}>}
 */
$world = static function (): array {
    $db = authDatabase();
    $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
    $ceoA = authFixture($db);
    $ceoB = authFixture($db);
    $f = ['ceoA' => $ceoA, 'empA1' => authFixture($db, ['companyId' => $ceoA['companyId'], 'role' => 'employee', 'employeeId' => 'e_a1']), 'ceoB' => $ceoB];
    $s = [];
    foreach ($f as $name => $x) {
        $r = $k->handle(loginRequest($x['email'], (string) $x['password']), requestId());
        assertSame(200, $r->status, 'login ' . $name);
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken']];
    }
    return ['db' => $db, 'k' => $k, 'a' => $ceoA['companyId'], 'b' => $ceoB['companyId'], 'f' => $f, 's' => $s];
};
/**
 * Test-only SQL: one audit row at the exact stored UTC instant $at, by $who's CEO. Returns its id.
 *
 * @param array<string, mixed> $o action, entity, entityId, operation, target, fields
 */
$audit = static function (array $w, string $who, string $at, array $o = []): string {
    $actor = $w['f'][$who];
    $w['db']->execute('INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        $actor['companyId'], $at, $actor['userId'], $actor['membershipId'], $o['action'] ?? 'employee.update', $o['entity'] ?? 'employee', $o['entityId'] ?? 'e_a1',
        $o['operation'] ?? null, $o['target'] ?? null, bin2hex(random_bytes(16)), array_key_exists('fields', $o) ? $o['fields'] : 'fullName',
    ]);
    return (string) $w['db']->select('SELECT LAST_INSERT_ID() AS id')[0]['id'];
};
/** Test-only SQL: $n rows of $who's company for employee $entityId, one microsecond apart from $start. */
$bulk = static function (array $w, string $who, int $n, string $start, string $entityId): void {
    $actor = $w['f'][$who];
    $t0 = \DateTimeImmutable::createFromFormat('!Y-m-d H:i:s.u', $start, new \DateTimeZone('UTC'));
    for ($i = 0; $i < $n; $i += 500) {
        $rows = [];
        $params = [];
        for ($j = $i; $j < min($n, $i + 500); $j++) {
            $rows[] = '(?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)';
            array_push($params, $actor['companyId'], $t0->modify('+' . $j . ' microseconds')->format('Y-m-d H:i:s.u'), $actor['userId'], $actor['membershipId'],
                'employee.update', 'employee', $entityId, bin2hex(random_bytes(16)), 'fullName');
        }
        $w['db']->execute('INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES ' . implode(', ', $rows), $params);
    }
};
$get = static fn (array $w, string $who, string $path, string $query): Response
    => $w['k']->handle(sessionRequest('GET', $path, $w['s'][$who]['token'], null, '', ['query' => $query]), requestId());
$post = static fn (array $w, string $who, string $path, array $body): Response
    => $w['k']->handle(sessionRequest('POST', $path, $w['s'][$who]['token'], $w['s'][$who]['csrf'], json_encode($body, JSON_THROW_ON_ERROR)), requestId());
/** @return list<array<string, mixed>> */
$events = static function (Response $r, string $label): array {
    assertSame(200, $r->status, $label . ' (' . substr($r->body, 0, 300) . ')');
    $data = envelope($r)['data'];
    assertSame(['auditEvents'], array_keys($data), $label . ': the envelope');
    foreach ($data['auditEvents'] as $e) {
        assertSame(AuditEventView::FIELDS, array_keys($e), $label . ': exactly the eleven keys');
    }
    return $data['auditEvents'];
};
$month = static fn (array $w, string $who, string $m): array => $events($get($w, $who, '/api/audit-events', 'month=' . $m), $who . ' ' . $m);
$record = static fn (array $w, string $who, string $entity, string $id): array => $events($get($w, $who, '/api/audit-events/record', 'entity=' . $entity . '&id=' . $id), $who . ' ' . $entity . ' ' . $id);
$ids = static fn (array $list): array => array_map(static fn (array $e): string => $e['id'], $list);

return [
    'a CEO reads exactly their company\'s rows of one Asia/Jakarta month — microsecond edges, total order, no company id (D-BF4g-1 = A)' => static function () use ($world, $audit, $month, $ids, $get): void {
        $w = $world();
        // Inserted out of order: the read orders by (occurred_at, id), never by insertion.
        $r4 = $audit($w, 'ceoA', '2026-10-31 16:59:59.999999');
        $r2 = $audit($w, 'ceoA', '2026-10-15 03:00:00.123456');
        $r1 = $audit($w, 'ceoA', '2026-09-30 17:00:00.000000');
        $r3 = $audit($w, 'ceoA', '2026-10-15 03:00:00.123456');
        $r0 = $audit($w, 'ceoA', '2026-09-30 16:59:59.999999');
        $r5 = $audit($w, 'ceoA', '2026-10-31 17:00:00.000000');
        $b1 = $audit($w, 'ceoB', '2026-10-10 00:00:00.000000');
        $b0 = $audit($w, 'ceoB', '2026-09-30 17:00:00.000000');
        $oct = $month($w, 'ceoA', '2026-10');
        assertSame([$r1, $r2, $r3, $r4], $ids($oct), 'Jakarta October: [2026-09-30 17:00Z, 2026-10-31 17:00Z), equal instants by id');
        assertSame(['2026-09-30T17:00:00.000000Z', '2026-10-15T03:00:00.123456Z', '2026-10-15T03:00:00.123456Z', '2026-10-31T16:59:59.999999Z'], array_column($oct, 'occurredAt'));
        assertSame([$r0], $ids($month($w, 'ceoA', '2026-09')), 'one microsecond before the first instant is September');
        assertSame([$r5], $ids($month($w, 'ceoA', '2026-11')), 'the first instant of the next month is November');
        assertSame([$b0, $b1], $ids($month($w, 'ceoB', '2026-10')), 'company B reads its own rows only');
        $body = $get($w, 'ceoA', '/api/audit-events', 'month=2026-10')->body;
        assertNoLeak($body, [$w['a'], $w['b'], $w['f']['ceoB']['userId'], $w['f']['ceoA']['email'], 'company', 'owner_employee_id', 'password']);
        assertSame([$w['f']['ceoA']['userId'], $w['f']['ceoA']['membershipId'], 'employee.update', 'employee', 'e_a1', null, null, ['fullName']],
            [$oct[0]['actorUserId'], $oct[0]['actorMembershipId'], $oct[0]['action'], $oct[0]['entity'], $oct[0]['entityId'], $oct[0]['operation'], $oct[0]['targetUserId'], $oct[0]['fields']], 'the stored fields as stored');
        assertSame([], $month($w, 'ceoA', '2030-01'), 'a month without rows is empty');
    },
    'leap and common February, and the December → January rollover, at microsecond precision' => static function () use ($world, $audit, $month, $ids): void {
        $w = $world();
        $at = [];
        foreach (['jan24' => '2024-01-31 16:59:59.999999', 'feb24a' => '2024-01-31 17:00:00.000000', 'feb24b' => '2024-02-29 16:59:59.999999', 'mar24' => '2024-02-29 17:00:00.000000',
            'feb25' => '2025-02-28 16:59:59.999999', 'mar25' => '2025-02-28 17:00:00.000000', 'nov26' => '2026-11-30 16:59:59.999999', 'dec26a' => '2026-11-30 17:00:00.000000',
            'dec26b' => '2026-12-31 16:59:59.999999', 'jan27' => '2026-12-31 17:00:00.000000'] as $name => $instant) {
            $at[$name] = $audit($w, 'ceoA', $instant);
        }
        $expect = ['2024-01' => ['jan24'], '2024-02' => ['feb24a', 'feb24b'], '2024-03' => ['mar24'], '2025-02' => ['feb25'], '2025-03' => ['mar25'],
            '2026-11' => ['nov26'], '2026-12' => ['dec26a', 'dec26b'], '2027-01' => ['jan27']];
        foreach ($expect as $m => $names) {
            assertSame(array_map(static fn (string $n): string => $at[$n], $names), $ids($month($w, 'ceoA', $m)), $m);
        }
        $feb = $month($w, 'ceoA', '2024-02');
        assertSame(['2024-01-31T17:00:00.000000Z', '2024-02-29T16:59:59.999999Z'], array_column($feb, 'occurredAt'), 'leap February 29 23:59:59.999999 WIB is February');
        assertSame(['2026-12-31T17:00:00.000000Z'], array_column($month($w, 'ceoA', '2027-01'), 'occurredAt'), 'UTC December 31 17:00 is Jakarta January 1');
    },
    'record history: the company\'s rows naming that entity and id, in order, with the nullable fields as stored' => static function () use ($world, $audit, $record, $ids): void {
        $w = $world();
        $plan = bin2hex(random_bytes(16));
        $later = $audit($w, 'ceoA', '2026-10-02 01:00:00.000000', ['fields' => 'fullName,phone']);
        $account = $audit($w, 'ceoA', '2026-10-01 01:00:00.000000', ['action' => 'account.manage', 'operation' => 'provision', 'target' => $w['f']['empA1']['userId'], 'fields' => null]);
        $audit($w, 'ceoA', '2026-10-01 02:00:00.000000', ['entityId' => 'e_a2']);
        $p = $audit($w, 'ceoA', '2026-10-03 01:00:00.000000', ['action' => 'payroll.manage', 'entity' => 'payrollPlan', 'entityId' => $plan, 'operation' => 'commit', 'fields' => null]);
        $x = $audit($w, 'ceoA', '2026-10-03 02:00:00.000000', ['action' => 'finance.execute', 'entity' => 'financePosting', 'entityId' => $plan, 'operation' => 'execute', 'fields' => null]);
        $audit($w, 'ceoB', '2026-10-01 00:00:00.000000');
        $h = $record($w, 'ceoA', 'employee', 'e_a1');
        assertSame([$account, $later], $ids($h), 'by occurred_at, not id; never e_a2 and never company B');
        assertSame(['account.manage', 'provision', $w['f']['empA1']['userId'], []], [$h[0]['action'], $h[0]['operation'], $h[0]['targetUserId'], $h[0]['fields']], 'an account row: operation and target, no field list');
        assertSame(['employee.update', null, null, ['fullName', 'phone']], [$h[1]['action'], $h[1]['operation'], $h[1]['targetUserId'], $h[1]['fields']], 'an update row: field names only');
        assertSame([$p], $ids($record($w, 'ceoA', 'payrollPlan', $plan)), 'the entity filters: the same id on a posting is another record');
        assertSame([$x], $ids($record($w, 'ceoA', 'financePosting', $plan)));
        assertSame([], $record($w, 'ceoA', 'overtime', $plan), 'no row for that entity');
        assertSame([], $record($w, 'ceoA', 'employee', 'e_never'), 'an unknown record is [] — no existence check (D-BF4g-4 = A)');
        assertSame(1, count($record($w, 'ceoB', 'employee', 'e_a1')), 'company B sees only its own row for the same entity id');
    },
    'a deleted record keeps its history: real AuditLog rows of a hard-deleted overtime Draft, readable by month and by record' => static function () use ($world, $post, $record, $month, $ids): void {
        $w = $world();
        $r = $post($w, 'empA1', '/api/overtime-records/create', ['employeeId' => 'e_a1', 'monthKey' => '2026-10', 'hours' => '2.00']);
        assertSame(200, $r->status, 'create ' . substr($r->body, 0, 200));
        $o = envelope($r)['data']['overtimeRecord'];
        assertSame(200, $post($w, 'empA1', '/api/overtime-records/delete', ['id' => $o['id'], 'expectedVersion' => $o['version']])->status, 'delete the Draft');
        assertSame([], $w['db']->select('SELECT id FROM overtime_records WHERE id = ?', [$o['id']]), 'the record is gone');
        $h = $record($w, 'ceoA', 'overtime', $o['id']);
        assertSame(['overtime.createSelfDraft', 'overtime.deleteSelfDraft'], array_column($h, 'action'));
        assertSame([$w['f']['empA1']['userId'], $w['f']['empA1']['userId']], array_column($h, 'actorUserId'), 'the Employee actor, as stored');
        $stored = $w['db']->select('SELECT id, occurred_at FROM audit_events WHERE entity_id = ? ORDER BY occurred_at, id', [$o['id']]);
        foreach ($stored as $i => $s) {
            assertSame(str_replace(' ', 'T', (string) $s['occurred_at']) . 'Z', $h[$i]['occurredAt'], 'the stored UTC_TIMESTAMP(6), every microsecond, with a Z');
            assertTrue(preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/', $h[$i]['occurredAt']) === 1, 'six fractional digits');
        }
        $jakarta = \DateTimeImmutable::createFromFormat('!Y-m-d H:i:s.u', (string) $stored[0]['occurred_at'], new \DateTimeZone('UTC'))->setTimezone(new \DateTimeZone('Asia/Jakarta'))->format('Y-m');
        assertTrue(array_intersect($ids($h), $ids($month($w, 'ceoA', $jakarta))) !== [], 'the real rows are in their Jakarta month');
    },
    'the cap: 2,000 rows are returned; 2,001 fail closed with 500 and no partial list (D-BF4g-2 = A)' => static function () use ($world, $bulk, $audit, $get, $events): void {
        $w = $world();
        $bulk($w, 'ceoA', 2000, '2025-06-10 00:00:00.000000', 'e_cap');
        $audit($w, 'ceoA', '2025-07-15 00:00:00.000000', ['entityId' => 'e_other']);
        $m = $events($get($w, 'ceoA', '/api/audit-events', 'month=2025-06'), 'month at the cap');
        $r = $events($get($w, 'ceoA', '/api/audit-events/record', 'entity=employee&id=e_cap'), 'record at the cap');
        assertSame([2000, 2000], [count($m), count($r)], 'exactly 2,000');
        assertSame('2025-06-10T00:00:00.000000Z', $m[0]['occurredAt']);
        assertSame('2025-06-10T00:00:00.001999Z', $m[1999]['occurredAt'], 'in order to the last microsecond');
        $bulk($w, 'ceoA', 1, '2025-06-20 00:00:00.000000', 'e_cap');
        foreach ([$get($w, 'ceoA', '/api/audit-events', 'month=2025-06'), $get($w, 'ceoA', '/api/audit-events/record', 'entity=employee&id=e_cap')] as $i => $over) {
            $e = envelope($over);
            assertSame([500, 'internal_error'], [$over->status, $e['error']['code'] ?? null], 'above the cap ' . $i);
            assertTrue(!array_key_exists('data', $e) && !str_contains($over->body, 'auditEvents') && !str_contains($over->body, 'e_cap'), 'no partial list');
        }
        assertSame(1, count($events($get($w, 'ceoA', '/api/audit-events', 'month=2025-07'), 'another month')), 'the cap is per read');
        assertSame(0, count($events($get($w, 'ceoB', '/api/audit-events', 'month=2025-06'), 'company B')), 'the cap counts the company only');
    },
    'the existing indexes serve both reads: audit_events_company_time (no filesort) and audit_events_entity' => static function () use ($world, $bulk): void {
        $w = $world();
        $bulk($w, 'ceoA', 1500, '2025-05-01 00:00:00.000000', 'e_bulk');
        $bulk($w, 'ceoA', 1500, '2025-06-01 00:00:00.000000', 'e_bulk');
        $bulk($w, 'ceoB', 1500, '2025-05-01 00:00:00.000000', 'e_bulk');
        $w['db']->select('ANALYZE TABLE audit_events');
        $explain = static fn (string $sql, array $p): array => $w['db']->select('EXPLAIN ' . $sql, $p)[0];
        // Any month: audit_events_company_time, whose order serves ORDER BY occurred_at, id (no filesort). With
        // half of the company's rows in the window the optimizer may scan it by company_id (ref) or by range.
        foreach ([['2025-04-30 17:00:00.000000', '2025-05-31 17:00:00.000000'], ['2025-03-31 17:00:00.000000', '2025-04-30 17:00:00.000000']] as [$from, $to]) {
            $m = $explain(AuditEventStore::MONTH_SQL, ['company_id' => $w['a'], 'from' => $from, 'to' => $to]);
            assertSame(['audit_events', 'audit_events_company_time'], [$m['table'], $m['key']], 'month: ' . json_encode($m));
            assertTrue(!str_contains((string) $m['Extra'], 'filesort'), 'month: ordered by the index (' . $m['Extra'] . ')');
        }
        // A selective window: a range over BOTH index columns — company_id CHAR(32) and occurred_at
        // DATETIME(6), key_len 32 + 8 — so the UTC strings bound as parameters are compared as DATETIME(6).
        assertSame(['range', '40'], [$m['type'], (string) $m['key_len']], 'a selective month is a range on (company_id, occurred_at): ' . json_encode($m));
        $r = $explain(AuditEventStore::RECORD_SQL, ['company_id' => $w['a'], 'entity' => 'employee', 'entity_id' => 'e_a1']);
        assertSame(['audit_events', 'audit_events_entity', 'ref'], [$r['table'], $r['key'], $r['type']], 'record: ' . json_encode($r));
    },
    'the reads write nothing, lock nothing and never expose auth_events' => static function () use ($world, $audit, $get, $month, $record): void {
        $w = $world();
        $audit($w, 'ceoA', '2026-10-05 00:00:00.000000');
        $snapshot = static function () use ($w): array {
            $out = [];
            foreach (['audit_events', 'auth_events', 'employees', 'users', 'memberships', 'companies', 'overtime_records', 'payroll_plans', 'finance_postings', 'finance_executions'] as $t) {
                $out[$t] = $w['db']->select('SELECT * FROM ' . $t . ' ORDER BY id');
            }
            return $out;
        };
        $auth = $w['db']->select('SELECT occurred_at FROM auth_events ORDER BY id DESC LIMIT 1')[0]['occurred_at'];
        $jakarta = \DateTimeImmutable::createFromFormat('!Y-m-d H:i:s.u', (string) $auth, new \DateTimeZone('UTC'))->setTimezone(new \DateTimeZone('Asia/Jakarta'))->format('Y-m');
        $before = $snapshot();
        $now = $month($w, 'ceoA', $jakarta);
        $month($w, 'ceoA', '2026-10');
        $record($w, 'ceoA', 'employee', 'e_a1');
        assertSame($before, $snapshot(), 'no business, audit or authentication row written or changed');
        $ours = (int) $w['db']->select('SELECT COUNT(*) AS n FROM audit_events WHERE company_id = ?', [$w['a']])[0]['n'];
        assertTrue((int) $w['db']->select('SELECT COUNT(*) AS n FROM auth_events')[0]['n'] >= 3, 'the logins wrote authentication events');
        assertTrue(count($now) <= $ours, 'only audit rows are returned in the month of the logins');
        $body = $get($w, 'ceoA', '/api/audit-events', 'month=' . $jakarta)->body . $get($w, 'ceoA', '/api/audit-events/record', 'entity=employee&id=e_a1')->body;
        assertNoLeak($body, ['login_success', 'login_failure', 'logout', 'email_hash', '203.0.113', $w['f']['ceoA']['email'], $w['f']['empA1']['email']]);
    },
];
