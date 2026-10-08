<?php
declare(strict_types=1);

/*
 * BF-4g CEO audit read structure without a database (owner decisions D-BF4g-1..4 = A): the month
 * window of the Asia/Jakarta company calendar as a half-open UTC interval with six fractional digits
 * (month edges, a leap and a common February, the December → January rollover), the record query
 * (the stored entity vocabulary and each one's id format), the eleven-key projection (never the
 * company; nullable operation and target; the stored field list; the UTC timestamp with all six
 * digits and a Z, an unreadable one refused), the store's two fixed, read-only, company-scope
 * SELECTs (no join, no lock, no write, never auth_events) and the CEO-only, 400-before-403 service
 * with no lookup before either. Behaviour is proven against MariaDB in tests/Db/Audit*Test.php.
 */

use TamOs\Audit\AuditEventView;
use TamOs\Audit\AuditInput;
use TamOs\Audit\AuditService;
use TamOs\Data\Audit\AuditEventStore;
use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Policy\Scope;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$unreachableDb = static fn (): Database => new Database(DatabaseConfig::fromArray([
    'host' => '127.0.0.1', 'port' => 1, 'name' => 'tamos_test', 'user' => 'u', 'pass' => 'unreachable-by-design',
]));
/** Business data over an unreachable, lazily connecting database: any statement would fail, so a 403 or 400 proves no lookup ran. */
$unreachable = static fn (): \TamOs\Data\BusinessData => \TamOs\Data\BusinessData::fromDatabase($unreachableDb());
$principal = static fn (string $role, ?string $employeeId): Principal => Principal::fromAccount(
    ['user_id' => str_repeat('1', 32), 'user_status' => 'active', 'has_password' => true],
    [['membership_id' => str_repeat('2', 32), 'company_id' => str_repeat('a', 32), 'role' => $role, 'employee_id' => $employeeId, 'membership_status' => 'active']],
) ?? throw new \LogicException('fixture');
$row = static fn (array $over = []): array => $over + ['id' => 41, 'company_id' => str_repeat('a', 32), 'owner_employee_id' => null,
    'occurred_at' => '2026-09-30 17:00:00.000001', 'actor_user_id' => str_repeat('1', 32), 'actor_membership_id' => str_repeat('2', 32),
    'action' => 'employee.update', 'entity' => 'employee', 'entity_id' => 'e_a1', 'operation' => null, 'target_user_id' => null,
    'request_id' => str_repeat('d', 32), 'fields' => 'fullName,phone'];
$code = static function (callable $fn): array {
    $e = assertThrows(ApiError::class, $fn);
    return [$e->errorCode, $e->fields];
};

return [
    'a month is the half-open Asia/Jakarta window in UTC, six fractional digits (D-BF4g-1 = A)' => static function (): void {
        assertSame(['from' => '2026-09-30 17:00:00.000000', 'to' => '2026-10-31 17:00:00.000000'], AuditInput::month('2026-10'), 'October');
        assertSame(['from' => '2025-12-31 17:00:00.000000', 'to' => '2026-01-31 17:00:00.000000'], AuditInput::month('2026-01'), 'January: the window starts in the previous UTC year');
        assertSame(['from' => '2026-11-30 17:00:00.000000', 'to' => '2026-12-31 17:00:00.000000'], AuditInput::month('2026-12'), 'December ends inside UTC December 31');
        assertSame(['from' => '2026-12-31 17:00:00.000000', 'to' => '2027-01-31 17:00:00.000000'], AuditInput::month('2027-01'), 'December → January rollover');
        assertSame(['from' => '2024-01-31 17:00:00.000000', 'to' => '2024-02-29 17:00:00.000000'], AuditInput::month('2024-02'), 'leap February: 29 days');
        assertSame(['from' => '2025-01-31 17:00:00.000000', 'to' => '2025-02-28 17:00:00.000000'], AuditInput::month('2025-02'), 'common February: 28 days');
        assertSame(['from' => '2026-03-31 17:00:00.000000', 'to' => '2026-04-30 17:00:00.000000'], AuditInput::month('2026-04'), 'a 30-day month');
        assertSame(AuditInput::month('2026-10')['to'], AuditInput::month('2026-11')['from'], 'consecutive windows meet exactly: no gap, no overlap');
        assertSame('Asia/Jakarta', AuditInput::COMPANY_TIMEZONE);
    },
    'the window does not depend on the PHP default timezone' => static function (): void {
        $was = date_default_timezone_get();
        try {
            foreach (['Pacific/Kiritimati', 'Etc/GMT+12', 'America/New_York', 'UTC'] as $tz) {
                date_default_timezone_set($tz);
                assertSame(['from' => '2024-01-31 17:00:00.000000', 'to' => '2024-02-29 17:00:00.000000'], AuditInput::month('2024-02'), $tz);
            }
        } finally {
            date_default_timezone_set($was);
        }
    },
    'a month query is YYYY-MM or 400 invalid_query' => static function () use ($code): void {
        foreach ([null, '', '2026-13', '2026-00', '2026-1', '26-10', '2026-10-01', '2026/10', 'all', "2026-10\n", ' 2026-10', '1899-12', '2026-10 '] as $bad) {
            assertSame([ErrorCode::InvalidQuery, []], $code(static fn () => AuditInput::month($bad)), var_export($bad, true));
        }
    },
    'a record query is one stored entity and an id in its format, or 400 naming the field' => static function () use ($code): void {
        $hex = str_repeat('a', 32);
        assertSame(['entity' => 'employee', 'id' => 'e_a1'], AuditInput::record('employee', 'e_a1'));
        assertSame(['entity' => 'employee', 'id' => 'LEGACY-000001'], AuditInput::record('employee', 'LEGACY-000001'));
        foreach (['overtime', 'payrollPlan', 'supplementalPayroll', 'financePosting'] as $entity) {
            assertSame(['entity' => $entity, 'id' => $hex], AuditInput::record($entity, $hex), $entity);
            foreach ([str_repeat('A', 32), str_repeat('a', 31), str_repeat('a', 33), 'e_a1', $hex . "\n", ''] as $bad) {
                assertSame([ErrorCode::ValidationFailed, ['id']], $code(static fn () => AuditInput::record($entity, $bad)), $entity . ' ' . var_export($bad, true));
            }
        }
        foreach (['', 'e a1', str_repeat('x', 65), "e_a1\n", 'e_a1;', "e'1", 'é'] as $bad) {
            assertSame([ErrorCode::ValidationFailed, ['id']], $code(static fn () => AuditInput::record('employee', $bad)), 'employee ' . var_export($bad, true));
        }
        assertSame([ErrorCode::ValidationFailed, ['id']], $code(static fn () => AuditInput::record('employee', null)), 'missing id');
        foreach ([null, '', 'Employee', 'employees', 'auth', 'authEvent', 'auth_events', 'session', 'user', 'company', 'financeExecution', 'payroll'] as $bad) {
            assertSame([ErrorCode::ValidationFailed, ['entity']], $code(static fn () => AuditInput::record($bad, 'e_a1')), var_export($bad, true));
        }
        assertSame(['employee', 'overtime', 'payrollPlan', 'supplementalPayroll', 'financePosting'], array_keys(AuditInput::ENTITIES), 'the stored vocabulary of migration 0035');
    },
    'the projection is exactly the eleven stored historical fields — never the company (D-BF4g-3 = A)' => static function () use ($row): void {
        $out = AuditEventView::event($row());
        assertSame(AuditEventView::FIELDS, array_keys($out));
        assertSame(['id', 'occurredAt', 'actorUserId', 'actorMembershipId', 'action', 'entity', 'entityId', 'operation', 'targetUserId', 'requestId', 'fields'], AuditEventView::FIELDS);
        assertSame(['id' => '41', 'occurredAt' => '2026-09-30T17:00:00.000001Z', 'actorUserId' => str_repeat('1', 32), 'actorMembershipId' => str_repeat('2', 32),
            'action' => 'employee.update', 'entity' => 'employee', 'entityId' => 'e_a1', 'operation' => null, 'targetUserId' => null, 'requestId' => str_repeat('d', 32),
            'fields' => ['fullName', 'phone']], $out);
        $json = json_encode($out, JSON_THROW_ON_ERROR);
        assertTrue(!str_contains($json, str_repeat('a', 32)) && !str_contains($json, 'company') && !str_contains($json, 'owner'), 'no company id or owner in the projection');
        $extra = AuditEventView::event($row(['email' => 'x@example.test', 'role' => 'ceo', 'password_hash' => 'h', 'ip' => '203.0.113.7']));
        assertSame(AuditEventView::FIELDS, array_keys($extra), 'an extra column never reaches the response');
    },
    'nullable historical fields: no operation, no target, no field list; and the stored ones as stored' => static function () use ($row): void {
        $none = AuditEventView::event($row(['fields' => null]));
        assertSame([null, null, []], [$none['operation'], $none['targetUserId'], $none['fields']]);
        $account = AuditEventView::event($row(['action' => 'account.manage', 'operation' => 'provision', 'target_user_id' => str_repeat('3', 32), 'fields' => null]));
        assertSame(['account.manage', 'provision', str_repeat('3', 32), []], [$account['action'], $account['operation'], $account['targetUserId'], $account['fields']]);
        $exec = AuditEventView::event($row(['action' => 'finance.execute', 'entity' => 'financePosting', 'entity_id' => str_repeat('c', 32), 'operation' => 'execute', 'fields' => null]));
        assertSame(['finance.execute', 'financePosting', str_repeat('c', 32), 'execute'], [$exec['action'], $exec['entity'], $exec['entityId'], $exec['operation']]);
        $draft = AuditEventView::event($row(['action' => 'overtime.createSelfDraft', 'entity' => 'overtime', 'entity_id' => str_repeat('e', 32), 'fields' => 'hours']));
        assertSame(['hours'], $draft['fields']);
    },
    'occurredAt: a stored UTC DATETIME(6) as YYYY-MM-DDTHH:MM:SS.ffffffZ, every microsecond kept' => static function (): void {
        foreach (['2026-09-30 16:59:59.999999' => '2026-09-30T16:59:59.999999Z', '2026-09-30 17:00:00.000000' => '2026-09-30T17:00:00.000000Z',
            '2024-02-29 23:59:59.000001' => '2024-02-29T23:59:59.000001Z', '2026-12-31 17:00:00.500000' => '2026-12-31T17:00:00.500000Z',
            '1970-01-01 00:00:00.000000' => '1970-01-01T00:00:00.000000Z'] as $stored => $iso) {
            assertSame($iso, AuditEventView::utc($stored), $stored);
        }
        $was = date_default_timezone_get();
        try {
            date_default_timezone_set('Asia/Jakarta');
            assertSame('2026-09-30T16:59:59.999999Z', AuditEventView::utc('2026-09-30 16:59:59.999999'), 'never the PHP default timezone');
        } finally {
            date_default_timezone_set($was);
        }
    },
    'an unreadable stored timestamp fails the row — never a partial or shifted value' => static function () use ($row): void {
        foreach (['2026-09-30 17:00:00', '2026-09-30 17:00:00.000', '2026-09-30T17:00:00.000000', '2026-09-30 17:00:00.000000Z', '2026-02-30 00:00:00.000000',
            '2026-13-01 00:00:00.000000', '2026-09-30 24:00:00.000000', '2026-09-30 17:60:00.000000', '0000-00-00 00:00:00.000000', '', ' 2026-09-30 17:00:00.000000',
            "2026-09-30 17:00:00.000000\n", 1759251600, null] as $bad) {
            assertThrows(\LogicException::class, static fn () => AuditEventView::utc($bad), var_export($bad, true));
            assertThrows(\LogicException::class, static fn () => AuditEventView::event($row(['occurred_at' => $bad])), 'row ' . var_export($bad, true));
        }
    },
    'a row that is not a stored audit row is refused' => static function () use ($row): void {
        foreach ([['id' => 0], ['id' => 'x'], ['actor_user_id' => 'u'], ['actor_membership_id' => ''], ['request_id' => str_repeat('D', 32)], ['action' => ''],
            ['action' => 'Employee.update'], ['entity' => 'auth'], ['entity_id' => ''], ['operation' => ''], ['target_user_id' => 'u'], ['fields' => 'full name'],
            ['fields' => ''], ['fields' => 'a,'], ['fields' => '3000000']] as $bad) {
            assertThrows(\LogicException::class, static fn () => AuditEventView::event($row($bad)), json_encode($bad));
        }
    },
    'the store: two fixed, read-only SELECTs of audit_events in company scope — no join, lock, write, Employee scope or auth_events' => static function (): void {
        $sql = array_filter((new \ReflectionClass(AuditEventStore::class))->getConstants(), 'is_string');
        assertSame(['MONTH_SQL', 'RECORD_SQL'], array_keys($sql));
        foreach ($sql as $name => $s) {
            assertTrue(str_starts_with($s, 'SELECT id, company_id, NULL AS owner_employee_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields FROM audit_events WHERE company_id = :company_id AND '), $name . ': the stored columns of audit_events only, company first');
            assertTrue(str_ends_with($s, ' ORDER BY occurred_at, id LIMIT 2001'), $name . ': total order, read one above the cap');
            assertTrue(preg_match('/\b(JOIN|UNION|INSERT|UPDATE|DELETE|REPLACE|FOR UPDATE|SHARE|LOCK|auth_events|users|memberships|employees|CONVERT_TZ|BETWEEN|NOW|CURDATE|UTC_TIMESTAMP|DATE|MONTH|LAST_DAY|INTERVAL)\b|:self_employee_id|<=|\bOR\b/i', $s) !== 1, $name . ': no join, lock, write, other table, SQL date function, inclusive bound or OR');
        }
        assertTrue(str_contains($sql['MONTH_SQL'], ' AND occurred_at >= :from AND occurred_at < :to ORDER BY'), 'the month is half-open: >= :from AND < :to');
        assertTrue(str_contains($sql['RECORD_SQL'], ' AND entity = :entity AND entity_id = :entity_id ORDER BY'), 'the record is its entity and id only');
        assertSame([2000, 2001], [AuditEventStore::LIST_CAP, AuditEventStore::LIST_LIMIT]);
    },
    'the store refuses an Employee scope and a malformed window before any statement' => static function () use ($unreachableDb, $principal): void {
        $store = new AuditEventStore(new ScopedDatabase($unreachableDb()));
        $emp = Scope::of($principal('employee', 'emp_1'));
        $ceo = Scope::of($principal('ceo', null));
        // The store's own guard, not only the scoped layer beneath it (defence in depth: both refuse).
        assertSame('audit reads are company scope only', assertThrows(\LogicException::class, static fn () => $store->month($emp, '2026-09-30 17:00:00.000000', '2026-10-31 17:00:00.000000'), 'Employee month')->getMessage());
        assertSame('audit reads are company scope only', assertThrows(\LogicException::class, static fn () => $store->record($emp, 'employee', 'emp_1'), 'Employee record')->getMessage());
        foreach ([['2026-09-30 17:00:00', '2026-10-31 17:00:00'], ['2026-10-31 17:00:00.000000', '2026-09-30 17:00:00.000000'], ['2026-09-30 17:00:00.000000', '2026-09-30 17:00:00.000000'],
            ['2026-09-30T17:00:00.000000', '2026-10-31 17:00:00.000000']] as [$from, $to]) {
            assertThrows(\LogicException::class, static fn () => $store->month($ceo, $from, $to), $from . ' / ' . $to);
        }
        foreach ([['', 'x'], ['employee', ''], ['employee', str_repeat('x', 65)], ['auth_events', 'x']] as [$entity, $id]) {
            assertThrows(\LogicException::class, static fn () => $store->record($ceo, $entity, $id), $entity . '/' . $id);
        }
    },
    'the service: 400 before 403 before any lookup; an Employee is 403 on both reads (no new Action)' => static function () use ($unreachable, $principal, $code): void {
        $service = new AuditService($unreachable());
        $emp = $principal('employee', 'emp_1');
        $ceo = $principal('ceo', null);
        assertSame([ErrorCode::InvalidQuery, []], $code(static fn () => $service->month($ceo, '2026-13')), 'CEO, bad month');
        assertSame([ErrorCode::InvalidQuery, []], $code(static fn () => $service->month($emp, null)), 'Employee, missing month: 400 first');
        assertSame([ErrorCode::ValidationFailed, ['entity']], $code(static fn () => $service->record($ceo, 'auth', 'x')), 'CEO, bad entity');
        assertSame([ErrorCode::ValidationFailed, ['entity']], $code(static fn () => $service->record($emp, 'auth', 'x')), 'Employee, bad entity: 400 first');
        assertSame([ErrorCode::ValidationFailed, ['id']], $code(static fn () => $service->record($emp, 'overtime', 'emp_1')), 'Employee, bad id: 400 first');
        assertSame([ErrorCode::Forbidden, []], $code(static fn () => $service->month($emp, '2026-10')), 'Employee month: 403 before any lookup');
        assertSame([ErrorCode::Forbidden, []], $code(static fn () => $service->record($emp, 'employee', 'emp_1')), 'Employee, even for their own employee record');
        $e = assertThrows(ApiError::class, static fn () => $service->month($emp, '2026-10'));
        assertSame('action_denied', $e->logReason);
        assertThrows(\TamOs\Data\DatabaseError::class, static fn () => $service->month($ceo, '2026-10'), 'a CEO reaches the (unreachable) database');
    },
];
