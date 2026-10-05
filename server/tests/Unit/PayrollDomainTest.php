<?php
declare(strict_types=1);

/*
 * BF-4c1 + BF-4c2 payroll structure without a database: the pre-commit state machine (the
 * canonical LOCAL graph, with Committed and Cancelled terminal) and Commit as its own operation from
 * Ready, the strict inputs (exactly { month }, { id, expectedVersion } and, for commit, { id,
 * expectedVersion, expectedTotal, idempotencyKey } — every identity, money or status key a 400),
 * the projections, the store's statements and guards (company scope for every write, lock and drift
 * read; the Employee's reads of their own Committed plans only; compare-and-swap; exactly one
 * statement writing 'Committed'; frozen links; Approved overtime only) and the audit vocabulary.
 * Behaviour is proven against MariaDB in tests/Db/Payroll*Test.php.
 */

use TamOs\Data\Audit\AuditLog;
use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Data\Payroll\PayrollStore;
use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Data\Scope\ScopedRecord;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Payroll\PayrollInput;
use TamOs\Payroll\PayrollService;
use TamOs\Payroll\PayrollStatus;
use TamOs\Payroll\PayrollView;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Policy;
use TamOs\Policy\Scope;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$db = static fn (): ScopedDatabase => new ScopedDatabase(new Database(DatabaseConfig::fromArray([
    'host' => '127.0.0.1', 'port' => 1, 'name' => 'tamos_test', 'user' => 'u', 'pass' => 'unreachable-by-design',
])));
/** Business data over an unreachable, lazily connecting database: any statement would fail, so a 403 proves no lookup ran. */
$unreachable = static fn (): \TamOs\Data\BusinessData => \TamOs\Data\BusinessData::fromDatabase(new Database(DatabaseConfig::fromArray([
    'host' => '127.0.0.1', 'port' => 1, 'name' => 'tamos_test', 'user' => 'u', 'pass' => 'unreachable-by-design',
])));
$principal = static fn (string $role, ?string $employeeId): Principal => Principal::fromAccount(
    ['user_id' => str_repeat('1', 32), 'user_status' => 'active', 'has_password' => true],
    [['membership_id' => str_repeat('2', 32), 'company_id' => str_repeat('a', 32), 'role' => $role, 'employee_id' => $employeeId, 'membership_status' => 'active']],
) ?? throw new \LogicException('fixture');
$row = ['id' => str_repeat('b', 32), 'company_id' => str_repeat('a', 32), 'owner_employee_id' => 'emp_1', 'employee_id' => 'emp_1', 'month_key' => '2026-10',
    'status' => 'Draft', 'employee_code_snapshot' => 'E-001', 'employee_name_snapshot' => 'Fabricated Person', 'department_snapshot' => null,
    'base_salary' => '3500000.00', 'overtime_amount' => '218750.00', 'overtime_hours' => '10.00', 'overtime_count' => '1', 'total_amount' => '3718750.00', 'version' => '2'];
$sqlOf = static function (): array {
    $out = [];
    foreach ((new \ReflectionClass(PayrollStore::class))->getConstants() as $name => $value) {
        if (str_ends_with($name, '_SQL')) {
            $out[$name] = $value;
        }
    }
    return $out;
};
$code = static function (callable $fn): array {
    try {
        $fn();
    } catch (ApiError $e) {
        return [$e->errorCode, $e->fields];
    }
    return [null, []];
};

return [
    'the state machine is the canonical LOCAL pre-commit graph: Committed unreachable, Committed and Cancelled terminal' => static function (): void {
        assertSame(['Draft', 'Reviewed', 'Ready', 'Committed', 'Cancelled'], PayrollStatus::VALUES, 'the frontend PAYROLL_STATUSES spellings');
        assertSame(['Committed', 'Cancelled'], PayrollStatus::TERMINAL);
        assertSame(['review', 'approve', 'return', 'cancel'], array_keys(PayrollStatus::TRANSITIONS), 'no commit operation (BF-4c2)');
        $table = [];
        foreach (array_keys(PayrollStatus::TRANSITIONS) as $op) {
            foreach (PayrollStatus::VALUES as $from) {
                $to = PayrollStatus::target($op, $from);
                if ($to !== null) {
                    $table[] = $from . '→' . $to;
                }
                assertTrue($to !== PayrollStatus::COMMITTED, 'no operation reaches Committed');
                if (in_array($from, PayrollStatus::TERMINAL, true)) {
                    assertSame(null, $to, $from . ' is terminal: ' . $op);
                }
            }
        }
        sort($table);
        $local = ['Draft→Reviewed', 'Draft→Ready', 'Draft→Cancelled', 'Reviewed→Ready', 'Reviewed→Draft', 'Reviewed→Cancelled', 'Ready→Draft', 'Ready→Cancelled'];
        sort($local);
        assertSame($local, $table, 'exactly js/domain/payroll-lifecycle-aggregate.js PAYROLL_LIFECYCLE_TRANSITIONS');
        $src = (string) file_get_contents(dirname(__DIR__, 3) . '/js/domain/payroll-lifecycle-aggregate.js');
        assertTrue(str_contains($src, "'Draft':     ['Reviewed', 'Ready', 'Cancelled']") && str_contains($src, "'Reviewed':  ['Ready', 'Draft', 'Cancelled']")
            && str_contains($src, "'Ready':     ['Draft', 'Cancelled']") && str_contains($src, "'Committed': []") && str_contains($src, "'Cancelled': []"), 'the LOCAL graph is unchanged');
        assertThrows(\LogicException::class, static fn () => PayrollStatus::target('commit', 'Ready'), 'no commit');
    },
    'generate takes exactly { month }: every identity, money, status or extra key is a 400 naming it (M1, M2, M12 inputs)' => static function () use ($code): void {
        assertSame('2026-10', PayrollInput::generate(['month' => '2026-10']));
        foreach (['companyId', 'employeeId', 'role', 'salary', 'baseSalary', 'amount', 'overtimeAmount', 'totalAmount', 'total', 'status', 'version', 'monthKey'] as $key) {
            assertSame([ErrorCode::ValidationFailed, [$key]], $code(static fn () => PayrollInput::generate(['month' => '2026-10', $key => 'x'])), $key);
        }
        foreach ([[], ['month' => null], ['month' => '2026-13'], ['month' => '2026-1'], ['month' => '1899-12'], ['month' => 202610], ['month' => ['2026-10']], ['month' => '2026-10 '], ['month' => '2026-10-01']] as $i => $bad) {
            assertSame([ErrorCode::ValidationFailed, ['month']], $code(static fn () => PayrollInput::generate($bad)), 'month ' . $i);
        }
    },
    'transitions take exactly { id, expectedVersion }; a browser total, salary or status is a 400' => static function () use ($code): void {
        $id = str_repeat('c', 32);
        assertSame(['id' => $id, 'expectedVersion' => 3], PayrollInput::transition(['id' => $id, 'expectedVersion' => 3]));
        foreach (['expectedTotal', 'totalAmount', 'salary', 'status', 'employeeId', 'companyId', 'month'] as $key) {
            assertSame([ErrorCode::ValidationFailed, [$key]], $code(static fn () => PayrollInput::transition(['id' => $id, 'expectedVersion' => 1, $key => '1'])), $key);
        }
        assertSame([ErrorCode::ValidationFailed, ['id', 'expectedVersion']], $code(static fn () => PayrollInput::transition(['id' => 'X', 'expectedVersion' => '1'])));
        assertSame([ErrorCode::ValidationFailed, ['expectedVersion']], $code(static fn () => PayrollInput::transition(['id' => $id, 'expectedVersion' => 0])));
        assertSame([ErrorCode::ValidationFailed, ['expectedVersion']], $code(static fn () => PayrollInput::transition(['id' => $id, 'expectedVersion' => 1.0])));
        assertSame([ErrorCode::InvalidQuery, []], $code(static fn () => PayrollInput::month('2026-1')));
        assertSame([ErrorCode::InvalidQuery, []], $code(static fn () => PayrollInput::month(null)));
        assertSame([ErrorCode::ValidationFailed, ['id']], $code(static fn () => PayrollInput::id(str_repeat('C', 32))));
        assertTrue(PayrollInput::isMonth('2026-10') === \TamOs\Overtime\OvertimeInput::isMonth('2026-10') && !PayrollInput::isMonth('2026-00'), 'the one canonical month rule');
    },
    'the plan projection is exactly its fields: snapshot and exact money, never the company, live key, timestamps or a finance field' => static function () use ($row): void {
        $v = PayrollView::plan($row + ['live_key' => '1', 'calculated_at' => 'x', 'committed_at' => null]);
        assertSame(PayrollView::FIELDS, array_keys($v));
        assertSame([str_repeat('b', 32), 'emp_1', '2026-10', 'Draft', 'E-001', 'Fabricated Person', null, '3500000.00', '218750.00', '10.00', 1, '3718750.00', 2], array_values($v));
        foreach (PayrollView::FIELDS as $f) {
            assertTrue(!preg_match('/company|live|paid|payment|tax|bpjs|allowance|deduction|net|gross|committed/i', $f), 'no such field: ' . $f);
        }
        assertSame(['id', 'hours', 'amount'], PayrollView::OVERTIME_FIELDS);
        assertSame(['id' => 'o1', 'hours' => '10.00', 'amount' => '218750.00'], PayrollView::overtime(['id' => 'o1', 'hours' => '10.00', 'approved_amount' => '218750.00', 'company_id' => 'x', 'owner_employee_id' => 'y']));
        foreach (['status' => 'Paid', 'base_salary' => '0.00', 'total_amount' => '1.50', 'overtime_amount' => '-1.00', 'overtime_hours' => '1.10'] as $col => $bad) {
            assertThrows(\LogicException::class, static fn () => PayrollView::plan([$col => $bad] + $row), $col);
        }
    },
    // BF-4c2 authorized revision: the *_SELF_SQL reads (an Employee's own Committed plans) name
    // :self_employee_id, and COMMIT_SQL is the one statement writing 'Committed'. Was: company scope
    // only and no 'Committed' anywhere.
    'the store statements: company scope for every write and lock, the Employee reads own Committed only, named parameters, compare-and-swap on a pre-commit status, exactly one Commit, no plan DELETE, Approved overtime only' => static function () use ($sqlOf): void {
        $sql = $sqlOf();
        foreach ($sql as $name => $s) {
            assertTrue(str_contains($s, ':company_id'), $name . ' names :company_id');
            assertTrue(!str_contains($s, '?'), $name . ': named parameters only');
            if (str_contains($s, ':self_employee_id')) {
                assertTrue(str_ends_with($name, '_SELF_SQL') && str_starts_with($s, 'SELECT ') && (bool) preg_match("/\b(p\.)?status = 'Committed'/", $s) && !str_contains($s, 'FOR UPDATE'), $name . ': an Employee reads their own Committed plans only, without a lock (M14)');
            } else {
                assertTrue(!str_ends_with($name, '_SELF_SQL'), $name);
            }
            if ($name !== 'COMMIT_SQL' && !str_ends_with($name, '_SELF_SQL')) {
                assertTrue(!str_contains($s, "'Committed'") && !preg_match('/committed_at\s*=/', $s) && !(str_contains($s, 'commit_idempotency_key') && !str_starts_with($s, 'SELECT ')), $name . ' never writes Committed, committed_at or the commit key');
            }
            assertTrue(!preg_match('/^\s*DELETE\s+FROM\s+payroll_plans\b/i', $s), $name . ': no plan DELETE');
            if (str_contains($s, 'overtime_records')) {
                assertTrue(str_contains($s, "status = 'Approved'") && !str_contains($s, 'valuation_'), $name . ': Approved overtime only, frozen amount only');
            }
        }
        assertTrue(str_ends_with($sql['RECALCULATE_SQL'], "AND version = :expected_version AND status = 'Draft'"), 'recalculate: Draft only, versioned');
        assertTrue(str_ends_with($sql['TRANSITION_SQL'], "AND version = :expected_version AND status = :from_status AND status IN ('Draft', 'Reviewed', 'Ready')"), 'transition: pre-commit only, versioned');
        assertTrue(str_contains($sql['CREATE_SQL'], ":month_key, 'Draft', ") && str_contains($sql['CREATE_SQL'], 'UTC_TIMESTAMP(6), NULL, 1,'), 'create: a version 1 Draft, committed_at NULL');
        assertTrue(str_contains($sql['UNLINK_SQL'], "payroll_plan_id = :id AND EXISTS") && str_contains($sql['UNLINK_SQL'], "p.status IN ('Draft', 'Reviewed', 'Ready')"), 'links of a pre-commit plan only');
        foreach ($sql as $name => $s) {
            if (str_ends_with($s, 'FOR UPDATE')) {
                assertTrue((bool) preg_match('/WHERE (id = :(employee_id|plan_id|id)) AND company_id = :company_id FOR UPDATE$/', $s), $name . ' locks one row by primary key — never a secondary-index range');
            }
        }
        assertTrue(str_ends_with($sql['LOCK_EMPLOYEE_SQL'], 'WHERE id = :employee_id AND company_id = :company_id FOR UPDATE') && str_ends_with($sql['LOCK_PLAN_ROW_SQL'], 'WHERE id = :plan_id AND company_id = :company_id FOR UPDATE'), 'generate locks employees and plans by primary key');
        assertTrue(!str_contains($sql['APPROVED_OVERTIME_SQL'], 'FOR UPDATE') && str_contains($sql['APPROVED_OVERTIME_SQL'], 'month_key = :month_key'), 'the plan month only (M5), never locked');
        assertSame("UPDATE payroll_plans SET status = 'Committed', committed_at = UTC_TIMESTAMP(6), commit_idempotency_key = :commit_idempotency_key, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Ready'", $sql['COMMIT_SQL'], 'commit: Ready only, versioned, sets committed_at and the key (M1, M2)');
        assertTrue(str_ends_with($sql['LOCK_COMMIT_SQL'], 'WHERE id = :id AND company_id = :company_id FOR UPDATE') && str_contains($sql['LOCK_COMMIT_SQL'], 'commit_idempotency_key'), 'commit locks its plan by primary key');
        assertTrue(!str_contains($sql['EMPLOYEE_APPROVED_SQL'], 'FOR UPDATE') && str_contains($sql['EMPLOYEE_APPROVED_SQL'], "employee_id = :employee_id AND month_key = :month_key AND status = 'Approved'"), 'drift reads the employee month Approved set, unlocked');
        assertTrue(\TamOs\Data\Database::READ_COMMITTED_SQL === 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED', 'generate runs at READ COMMITTED');
        // BF-4c2 authorized revision (D-BF4c2-3 = A): Commit is the one other READ COMMITTED
        // transaction. Was: exactly the generate transaction.
        $service = (string) file_get_contents(dirname(__DIR__, 2) . '/src/Payroll/PayrollService.php');
        assertSame(2, substr_count($service, '}, readCommitted: true);'), 'exactly the generate and commit transactions are READ COMMITTED');
        assertTrue(str_contains($service, "            \$this->data->audit()->appendPayroll(\$auth, \$actor, 'commit', \$requestId);\n        }, readCommitted: true);"), 'the commit transaction is the second one');
        // BF-4d authorized revision: Supplemental Payroll generate and commit follow the same lesson
        // (pinned in SupplementalDomainTest). Was: exactly 2 in the backend.
        $all = '';
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(dirname(__DIR__, 2) . '/src', \FilesystemIterator::SKIP_DOTS)) as $f) {
            $all .= str_ends_with((string) $f, '.php') ? (string) file_get_contents((string) $f) : '';
        }
        assertSame(4, substr_count($all, 'readCommitted: true'), 'nothing else in the backend runs at READ COMMITTED (D-BF4c2-3 narrow; BF-4d: Supplemental generate and commit)');
        assertSame(2, substr_count((string) file_get_contents(dirname(__DIR__, 2) . '/src/Supplemental/SupplementalService.php'), 'readCommitted: true'), 'the other two are the Supplemental generate and commit');
        assertSame(['employee_code_snapshot', 'employee_name_snapshot', 'department_snapshot', 'base_salary', 'overtime_amount', 'overtime_hours', 'overtime_count', 'total_amount'], PayrollStore::VALUES);
    },
    // BF-4c2 authorized revision: an Employee scope may read (own Committed plans); it is refused on
    // the drift and idempotency reads. Was: refused on every read.
    'the store refuses an Employee scope on the drift and key reads, a foreign Action, a period write, a write without its plan and a malformed commit key' => static function () use ($db, $principal): void {
        $store = new PayrollStore($db());
        $ceo = $principal('ceo', null);
        $emp = $principal('employee', 'emp_1');
        $e = assertThrows(\LogicException::class, static fn () => $store->driftInputs(Scope::of($emp), str_repeat('b', 32)), 'no Employee drift read');
        assertSame('payroll drift and idempotency reads are company scope only', $e->getMessage());
        $e = assertThrows(\LogicException::class, static fn () => $store->keyHolder(Scope::of($emp), str_repeat('f', 32)), 'no Employee key read');
        assertSame('payroll drift and idempotency reads are company scope only', $e->getMessage());
        $plan = new Authorization(Action::PayrollManage, Scope::of($ceo), new ScopedRecord(Scope::of($ceo), 'payrollPlan', str_repeat('b', 32), 'emp_1', 'Ready'));
        $e = assertThrows(\LogicException::class, static fn () => $store->commit($plan, 1, str_repeat('F', 32)), 'a malformed key');
        assertSame('a commit idempotency key is 32 lowercase hex characters', $e->getMessage());
        $e = assertThrows(\LogicException::class, static fn () => $store->keyHolder(Scope::of($ceo), 'x'), 'a malformed key read');
        assertSame('a commit idempotency key is 32 lowercase hex characters', $e->getMessage());
        $selfAuth = new Authorization(Action::PayrollManage, Scope::of($emp), new ScopedRecord(Scope::of($emp), 'payrollPlan', str_repeat('b', 32), 'emp_1', 'Ready'));
        assertThrows(\LogicException::class, static fn () => $store->commit($selfAuth, 1, str_repeat('f', 32)), 'never an Employee commit');
        assertThrows(\LogicException::class, static fn () => $store->lockOwner($selfAuth), 'never an Employee lock');
        $periodAuth = Policy::authorize($ceo, Action::PayrollManage, $store->periodCandidate(Scope::of($ceo), '2026-10'));
        assertThrows(\LogicException::class, static fn () => $store->lockForCommit($periodAuth), 'a period is not a plan');
        assertThrows(\LogicException::class, static fn () => $store->commit($periodAuth, 1, str_repeat('f', 32)), 'no commit under a period');
        $period = Policy::authorize($ceo, Action::PayrollManage, $store->periodCandidate(Scope::of($ceo), '2026-10'));
        assertThrows(\LogicException::class, static fn () => $store->lock($period), 'a period is not a plan');
        assertThrows(\LogicException::class, static fn () => $store->transition($period, 1, 'Draft', 'Reviewed'), 'no write under a period');
        assertThrows(\LogicException::class, static fn () => $store->transition(new Authorization(Action::PayrollManage, Scope::of($ceo), new ScopedRecord(Scope::of($ceo), 'payrollPlan', str_repeat('b', 32), 'emp_1', 'Ready')), 1, 'Ready', 'Committed'), 'never to Committed');
        assertThrows(\LogicException::class, static fn () => $store->transition(new Authorization(Action::PayrollManage, Scope::of($ceo), new ScopedRecord(Scope::of($ceo), 'payrollPlan', str_repeat('b', 32), 'emp_1', 'Cancelled')), 1, 'Cancelled', 'Draft'), 'never from a terminal status');
        $foreign = new Authorization(Action::OvertimeManage, Scope::of($ceo), new ScopedRecord(Scope::of($ceo), 'payrollPlan', str_repeat('b', 32), 'emp_1', 'Draft'));
        assertThrows(\LogicException::class, static fn () => $store->unlink($foreign), 'payroll.manage only');
        assertThrows(\LogicException::class, static fn () => $store->employeeIds(new Authorization(Action::PayrollManage, Scope::of($ceo), new ScopedRecord(Scope::of($ceo), 'payrollPlan', str_repeat('b', 32), 'emp_1', 'Draft'))), 'a plan is not a period');
        assertThrows(\LogicException::class, static fn () => $store->periodCandidate(Scope::of($ceo), '2026-13'), 'a canonical month');
        assertThrows(\LogicException::class, static fn () => $db()->periodCandidate(Scope::of($ceo), 'employee', '2026-10'), 'never an employee period');
    },
    'Policy: payroll.manage on the period admits the CEO only; an Employee is 403 (M12)' => static function () use ($db, $principal, $unreachable): void {
        $store = new PayrollStore($db());
        $ceo = $principal('ceo', null);
        $emp = $principal('employee', 'emp_1');
        assertTrue(Policy::allows($ceo, Action::PayrollManage, $store->periodCandidate(Scope::of($ceo), '2026-10')), 'CEO');
        assertTrue(!Policy::allows($emp, Action::PayrollManage, $store->periodCandidate(Scope::of($emp), '2026-10')), 'Employee');
        assertTrue(!Policy::allows($ceo, Action::OvertimeManage, $store->periodCandidate(Scope::of($ceo), '2026-10')), 'another action');
        $e = assertThrows(ApiError::class, static fn () => (new PayrollService($unreachable()))->generate($emp, ['month' => '2026-10'], str_repeat('d', 32)));
        assertSame(ErrorCode::Forbidden, $e->errorCode, 'an Employee generate is 403 before any lookup');
        $body = ['id' => str_repeat('b', 32), 'expectedVersion' => 1, 'expectedTotal' => '1.00', 'idempotencyKey' => str_repeat('f', 32)];
        $e = assertThrows(ApiError::class, static fn () => (new PayrollService($unreachable()))->commit($emp, $body, str_repeat('d', 32)));
        assertSame(ErrorCode::Forbidden, $e->errorCode, 'an Employee commit is 403 before any lookup (M16)');
        $e = assertThrows(ApiError::class, static fn () => (new PayrollService($unreachable()))->drift($emp, str_repeat('b', 32)));
        assertSame(ErrorCode::Forbidden, $e->errorCode, 'an Employee drift read is 403 before any lookup');
        // BF-4c2 authorized revision: an Employee's month read reaches the data layer (own Committed
        // plans only). Was: 403 before any lookup.
        assertThrows(\TamOs\Data\DatabaseError::class, static fn () => (new PayrollService($unreachable()))->month($emp, '2026-10'), 'an Employee read is scoped, not refused');
    },
    'the payroll audit vocabulary: payroll.manage operations, commit included (BF-4c2), no field, no value' => static function () use ($db, $principal): void {
        assertSame(['create', 'recalculate', 'review', 'approve', 'return', 'cancel', 'commit'], AuditLog::PAYROLL_OPERATIONS);
        assertTrue(str_ends_with(AuditLog::APPEND_PAYROLL_SQL, ':operation, NULL, :request_id, NULL)'), 'no target user, no field list');
        $audit = new AuditLog($db());
        $ceo = $principal('ceo', null);
        $plan = new Authorization(Action::PayrollManage, Scope::of($ceo), new ScopedRecord(Scope::of($ceo), 'payrollPlan', str_repeat('b', 32), 'emp_1', 'Draft'));
        assertThrows(\LogicException::class, static fn () => $audit->appendPayroll($plan, $ceo, 'pay', str_repeat('d', 32)), 'no payment operation');
        $period = new Authorization(Action::PayrollManage, Scope::of($ceo), new ScopedRecord(Scope::of($ceo), 'payrollPlan', '2026-10', null, null));
        assertThrows(\LogicException::class, static fn () => $audit->appendPayroll($period, $ceo, 'create', str_repeat('d', 32)), 'a period is never audited as a plan');
        $other = new Authorization(Action::OvertimeManage, Scope::of($ceo), new ScopedRecord(Scope::of($ceo), 'overtime', str_repeat('b', 32), 'emp_1', 'Reviewed'));
        assertThrows(\LogicException::class, static fn () => $audit->appendPayroll($other, $ceo, 'approve', str_repeat('d', 32)), 'payroll.manage only');
        $migration = (string) file_get_contents(dirname(__DIR__, 2) . '/migrations/0026_replace_audit_events_payroll_checks.sql');
        assertTrue(str_contains($migration, "(entity = 'payrollPlan') = (action = 'payroll.manage')"), '0026 ties payroll.manage to payrollPlan');
        $m28 = (string) file_get_contents(dirname(__DIR__, 2) . '/migrations/0028_replace_audit_events_payroll_commit.sql');
        assertTrue(str_contains($m28, "WHEN 'payroll.manage' THEN operation IS NOT NULL AND operation IN ('create', 'recalculate', 'review', 'approve', 'return', 'cancel', 'commit')")
            && !str_contains($m28, 'audit_events_action_v') && !str_contains($m28, 'audit_events_entity_v'), '0028 adds commit under payroll.manage and nothing else: no new Action, no new entity');
    },
];
