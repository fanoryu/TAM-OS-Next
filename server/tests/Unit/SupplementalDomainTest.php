<?php
declare(strict_types=1);

/*
 * BF-4d Supplemental Payroll structure without a database: the state machine (the owner's
 * authorized linear graph in the canonical Payroll vocabulary; Committed and Cancelled terminal;
 * Commit its own operation from Ready), the strict inputs (exactly { payrollPlanId },
 * { id, expectedVersion } and { id, expectedVersion, expectedTotal, idempotencyKey }), the exact
 * overtime sum (PayrollCalculation::overtime — the one parser base Payroll uses), the projections
 * (the base plan's thirteen keys untouched; the document's twelve), the store's statements and
 * guards (company scope for every write, lock and eligibility read; the Employee's reads of their
 * own Committed documents only; compare-and-swap on an open status; exactly one statement writing
 * 'Committed'; frozen links; base Payroll and overtime read only, Approved only) and the audit
 * vocabulary. Behaviour is proven against MariaDB in tests/Db/Supplemental*Test.php.
 */

use TamOs\Data\Audit\AuditLog;
use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Data\Scope\ScopedRecord;
use TamOs\Data\Supplemental\SupplementalStore;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Payroll\PayrollCalculation;
use TamOs\Payroll\PayrollOutOfBounds;
use TamOs\Payroll\PayrollView;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Policy;
use TamOs\Policy\Scope;
use TamOs\Supplemental\SupplementalInput;
use TamOs\Supplemental\SupplementalService;
use TamOs\Supplemental\SupplementalStatus;
use TamOs\Supplemental\SupplementalView;
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
$row = ['id' => str_repeat('b', 32), 'company_id' => str_repeat('a', 32), 'owner_employee_id' => 'emp_1', 'payroll_plan_id' => str_repeat('c', 32), 'employee_id' => 'emp_1',
    'month_key' => '2026-10', 'status' => 'Draft', 'employee_code_snapshot' => 'E-001', 'employee_name_snapshot' => 'Fabricated Person', 'department_snapshot' => null,
    'overtime_amount' => '218750.00', 'overtime_hours' => '10.00', 'overtime_count' => '1', 'version' => '2'];
$sqlOf = static function (): array {
    $out = [];
    foreach ((new \ReflectionClass(SupplementalStore::class))->getConstants() as $name => $value) {
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
$ot = static fn (string $hours, string $amount): array => ['hours' => $hours, 'amount' => $amount];

return [
    'the state machine is the authorized linear graph in the Payroll vocabulary: no Draft → Ready, Committed unreachable, Committed and Cancelled terminal (M17, M18, M19)' => static function (): void {
        assertSame(['Draft', 'Reviewed', 'Ready', 'Committed', 'Cancelled'], SupplementalStatus::VALUES, 'the Payroll status spellings');
        assertSame(\TamOs\Payroll\PayrollStatus::VALUES, SupplementalStatus::VALUES, 'one vocabulary with base Payroll (D-SPAY-1 = A)');
        assertSame(['Committed', 'Cancelled'], SupplementalStatus::TERMINAL);
        assertSame(['Draft', 'Reviewed', 'Ready'], SupplementalStatus::OPEN);
        assertSame('Ready', SupplementalStatus::COMMIT_FROM);
        assertSame(['review', 'approve', 'return', 'cancel'], array_keys(SupplementalStatus::TRANSITIONS), 'no commit, post, pay or execute transition');
        $table = [];
        foreach (array_keys(SupplementalStatus::TRANSITIONS) as $op) {
            foreach (SupplementalStatus::VALUES as $from) {
                $to = SupplementalStatus::target($op, $from);
                if ($to !== null) {
                    $table[] = $from . '→' . $to;
                }
                assertTrue($to !== SupplementalStatus::COMMITTED, 'no transition reaches Committed');
                if (in_array($from, SupplementalStatus::TERMINAL, true)) {
                    assertSame(null, $to, $from . ' is terminal: ' . $op);
                }
            }
        }
        sort($table);
        $allowed = ['Draft→Reviewed', 'Reviewed→Ready', 'Reviewed→Draft', 'Ready→Draft', 'Draft→Cancelled', 'Reviewed→Cancelled', 'Ready→Cancelled'];
        sort($allowed);
        assertSame($allowed, $table, 'exactly the BF-4d §15 graph — Draft → Ready is not an approval');
        foreach (['commit', 'post', 'pay', 'execute'] as $op) {
            assertThrows(\LogicException::class, static fn () => SupplementalStatus::target($op, 'Ready'), 'no ' . $op);
        }
    },
    'generate takes exactly { payrollPlanId }: every identity, money, overtime or status key is a 400 naming it' => static function () use ($code): void {
        $id = str_repeat('c', 32);
        assertSame($id, SupplementalInput::generate(['payrollPlanId' => $id]));
        foreach (['companyId', 'employeeId', 'role', 'month', 'amount', 'overtimeAmount', 'overtimeIds', 'status', 'version', 'id'] as $key) {
            assertSame([ErrorCode::ValidationFailed, [$key]], $code(static fn () => SupplementalInput::generate(['payrollPlanId' => $id, $key => 'x'])), $key);
        }
        foreach ([[], ['payrollPlanId' => null], ['payrollPlanId' => 'emp_1'], ['payrollPlanId' => strtoupper($id)], ['payrollPlanId' => 7], ['payrollPlanId' => [$id]]] as $i => $bad) {
            assertSame([ErrorCode::ValidationFailed, ['payrollPlanId']], $code(static fn () => SupplementalInput::generate($bad)), 'payrollPlanId ' . $i);
        }
    },
    'transitions take exactly { id, expectedVersion }; commit exactly { id, expectedVersion, expectedTotal, idempotencyKey } with a canonical string total (M21)' => static function () use ($code): void {
        $id = str_repeat('c', 32);
        $key = str_repeat('f', 32);
        assertSame(['id' => $id, 'expectedVersion' => 3], SupplementalInput::transition(['id' => $id, 'expectedVersion' => 3]));
        foreach (['expectedTotal', 'overtimeAmount', 'status', 'employeeId', 'payrollPlanId'] as $k) {
            assertSame([ErrorCode::ValidationFailed, [$k]], $code(static fn () => SupplementalInput::transition(['id' => $id, 'expectedVersion' => 1, $k => '1'])), $k);
        }
        assertSame([ErrorCode::ValidationFailed, ['id', 'expectedVersion']], $code(static fn () => SupplementalInput::transition(['id' => 'X', 'expectedVersion' => '1'])));
        assertSame([ErrorCode::ValidationFailed, ['expectedVersion']], $code(static fn () => SupplementalInput::transition(['id' => $id, 'expectedVersion' => 1.0])));
        $body = ['id' => $id, 'expectedVersion' => 2, 'expectedTotal' => '218750.00', 'idempotencyKey' => $key];
        assertSame($body, SupplementalInput::commit($body));
        foreach ([218750, 218750.0, '218750', '218750.0', '0218750.00', '218750.50', '-1.00', ' 1.00', '1e5'] as $bad) {
            assertSame([ErrorCode::ValidationFailed, ['expectedTotal']], $code(static fn () => SupplementalInput::commit(['expectedTotal' => $bad] + $body)), 'expectedTotal ' . var_export($bad, true));
        }
        foreach ([str_repeat('F', 32), str_repeat('f', 31), 7, null] as $bad) {
            assertSame([ErrorCode::ValidationFailed, ['idempotencyKey']], $code(static fn () => SupplementalInput::commit(['idempotencyKey' => $bad] + $body)), 'key');
        }
        assertSame([ErrorCode::InvalidQuery, []], $code(static fn () => SupplementalInput::month('2026-1')));
        assertSame([ErrorCode::ValidationFailed, ['id']], $code(static fn () => SupplementalInput::id(str_repeat('C', 32))));
    },
    'the overtime sum is exact integer arithmetic over the frozen strings: whole Rupiah, quarter hours, overflow refused, no float (M1)' => static function () use ($ot): void {
        assertSame(['overtimeAmount' => '0.00', 'overtimeHours' => '0.00', 'overtimeCount' => 0], PayrollCalculation::overtime([]));
        assertSame(['overtimeAmount' => '437502.00', 'overtimeHours' => '20.75', 'overtimeCount' => 3],
            PayrollCalculation::overtime([$ot('10.00', '218750.00'), $ot('0.25', '1.00'), $ot('10.50', '218751.00')]));
        // 0.1 + 0.2 style inputs that drift under binary floating point stay exact here.
        assertSame('3.00', PayrollCalculation::overtime([$ot('1.00', '1.00'), $ot('1.00', '1.00'), $ot('1.00', '1.00')])['overtimeAmount']);
        assertSame('99999999999999.00', PayrollCalculation::overtime([$ot('1.00', '99999999999999.00')])['overtimeAmount'], 'the largest frozen amount');
        $many = array_fill(0, 11, $ot('744.00', '99999999999999.00'));
        assertThrows(PayrollOutOfBounds::class, static fn () => PayrollCalculation::overtime($many), 'a sum above DECIMAL(17,2) is refused, never wrapped');
        foreach ([$ot('1.00', '1.50'), $ot('1.00', '1'), $ot('1.10', '1.00'), $ot('0.00', '1.00'), ['hours' => '1.00', 'amount' => 1], ['amount' => '1.00', 'hours' => '1.00']] as $i => $bad) {
            assertThrows(\LogicException::class, static fn () => PayrollCalculation::overtime([$bad]), 'malformed input ' . $i);
        }
        $base = PayrollCalculation::calculate('3500000.00', [$ot('10.00', '218750.00'), $ot('0.25', '1.00')]);
        $sum = PayrollCalculation::overtime([$ot('10.00', '218750.00'), $ot('0.25', '1.00')]);
        assertSame([$base['overtimeAmount'], $base['overtimeHours'], $base['overtimeCount']], array_values($sum), 'base Payroll and Supplemental share one overtime sum');
    },
    'the document projection is exactly twelve fields; the base plan keeps its thirteen; never the company, open key, commit key, timestamps or a finance field (M36)' => static function () use ($row): void {
        assertSame(['id', 'employeeId', 'monthKey', 'status', 'employeeCode', 'employeeName', 'department', 'baseSalary', 'overtimeAmount', 'overtimeHours', 'overtimeCount', 'totalAmount', 'version'], PayrollView::FIELDS, 'the base plan DTO is unchanged');
        $v = SupplementalView::supplemental($row + ['open_key' => '1', 'commit_idempotency_key' => str_repeat('f', 32), 'committed_at' => 'x', 'calculated_at' => 'x']);
        assertSame(SupplementalView::FIELDS, array_keys($v));
        assertSame(12, count(SupplementalView::FIELDS));
        assertSame([str_repeat('b', 32), str_repeat('c', 32), 'emp_1', '2026-10', 'Draft', 'E-001', 'Fabricated Person', null, '218750.00', '10.00', 1, 2], array_values($v));
        foreach (SupplementalView::FIELDS as $f) {
            assertTrue(!preg_match('/company|openKey|commitKey|idempotency|committed|paid|payment|tax|bpjs|allowance|deduction|bonus|netAmount|gross|bank/i', $f), 'no such field: ' . $f);
        }
        assertSame(PayrollView::OVERTIME_FIELDS, SupplementalView::OVERTIME_FIELDS);
        assertSame(['payrollPlanId', 'employeeId', 'eligibleCount', 'eligibleHours', 'eligibleAmount'], SupplementalView::ELIGIBILITY_FIELDS);
        foreach ([['status', 'Paid'], ['status', 'Executed'], ['overtime_amount', '0.00'], ['overtime_amount', '-1.00'], ['overtime_amount', '1.50'], ['overtime_hours', '1.10'], ['overtime_count', '0']] as [$col, $bad]) {
            assertThrows(\LogicException::class, static fn () => SupplementalView::supplemental([$col => $bad] + $row), $col . ' ' . $bad . ' (M10, M11, M33)');
        }
        $e = ['payrollPlanId' => 'p', 'employeeId' => 'e', 'eligibleCount' => 2, 'eligibleHours' => '1.25', 'eligibleAmount' => '10.00'];
        assertSame($e, SupplementalView::eligibility($e));
        assertThrows(\LogicException::class, static fn () => SupplementalView::eligibility(['eligibleCount' => 0] + $e), 'never an empty entry');
        assertThrows(\LogicException::class, static fn () => SupplementalView::eligibility($e + ['companyId' => 'x']), 'exactly its keys');
    },
    'the store statements: company scope everywhere, the Employee reads own Committed only, compare-and-swap on an open status, exactly one Commit, no document DELETE, base Payroll and overtime read only (M4, M5, M6, M18, M19)' => static function () use ($sqlOf): void {
        $sql = $sqlOf();
        foreach ($sql as $name => $s) {
            assertTrue(str_contains($s, ':company_id'), $name . ' names :company_id');
            assertTrue(!str_contains($s, '?'), $name . ': named parameters only');
            if (str_contains($s, ':self_employee_id')) {
                assertTrue(str_ends_with($name, '_SELF_SQL') && str_starts_with($s, 'SELECT ') && (bool) preg_match("/\b(s\.)?status = 'Committed'/", $s) && !str_contains($s, 'FOR UPDATE') && !preg_match('/\bOR\b/', $s), $name . ': an Employee reads their own Committed documents only, without a lock (M29)');
            } else {
                assertTrue(!str_ends_with($name, '_SELF_SQL'), $name);
            }
            if ($name !== 'COMMIT_SQL' && !str_starts_with($s, 'SELECT ')) {
                assertTrue(!str_contains($s, "'Committed'") && !preg_match('/committed_at\s*=/', $s) && !str_contains($s, 'commit_idempotency_key = :'), $name . ' never writes Committed, committed_at or the commit key');
            }
            assertTrue(!preg_match('/^\s*(INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+(payroll_plans|payroll_plan_overtime|overtime_records|employees)\b/i', $s), $name . ': base Payroll, overtime and employees are never written here');
            assertTrue(!preg_match('/^\s*DELETE\s+FROM\s+supplemental_payrolls\b/i', $s), $name . ': no document DELETE');
            if (str_contains($s, 'overtime_records')) {
                assertTrue(str_contains($s, "status = 'Approved'") && !str_contains($s, 'valuation_') && !str_contains($s, 'monthly_base_salary'), $name . ': Approved overtime only, frozen amount only (M7)');
            }
            assertTrue(!preg_match('/\bSUM\s*\(|\+\s*o\.approved_amount|approved_amount\s*\+/i', $s), $name . ': no SQL money arithmetic (M2)');
            if (str_ends_with($s, 'FOR UPDATE')) {
                assertTrue((bool) preg_match('/^SELECT [^;]* FROM (employees|payroll_plans|supplemental_payrolls) WHERE id = :(employee_id|payroll_plan_id|id) AND company_id = :company_id FOR UPDATE$/', $s) && !str_contains($s, 'JOIN'), $name . ' locks one row by primary key — never a range');
            }
        }
        assertTrue(str_ends_with($sql['RECALCULATE_SQL'], "AND version = :expected_version AND status = 'Draft'"), 'recalculate: Draft only, versioned (M13, M14)');
        assertTrue(str_ends_with($sql['TRANSITION_SQL'], "AND version = :expected_version AND status = :from_status AND status IN ('Draft', 'Reviewed', 'Ready')"), 'transition: open only, versioned');
        assertTrue(str_contains($sql['CREATE_SQL'], ":month_key, 'Draft', ") && str_contains($sql['CREATE_SQL'], 'UTC_TIMESTAMP(6), NULL, NULL, 1,'), 'create: a version 1 Draft, committed_at and key NULL');
        assertTrue(str_contains($sql['UNLINK_SQL'], 'supplemental_payroll_id = :id AND EXISTS') && str_contains($sql['UNLINK_SQL'], "s.status IN ('Draft', 'Reviewed', 'Ready')"), 'links of an open document only');
        assertSame("UPDATE supplemental_payrolls SET status = 'Committed', committed_at = UTC_TIMESTAMP(6), commit_idempotency_key = :commit_idempotency_key, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Ready'", $sql['COMMIT_SQL'], 'commit: Ready only, versioned, committed_at and the key (M17)');
        assertTrue(str_contains($sql['UNCAPTURED_SQL'], 'NOT EXISTS (SELECT 1 FROM payroll_plan_overtime pl') && str_contains($sql['UNCAPTURED_SQL'], 'NOT EXISTS (SELECT 1 FROM supplemental_payroll_overtime sl'), 'eligibility excludes base-linked and captured overtime (M8, M9)');
        assertTrue(str_contains($sql['VALID_LINKS_SQL'], 'o.month_key = s.month_key') && str_contains($sql['VALID_LINKS_SQL'], 'o.employee_id = s.employee_id') && str_contains($sql['VALID_LINKS_SQL'], 'NOT EXISTS (SELECT 1 FROM payroll_plan_overtime'), 'commit revalidates the frozen links only (M22)');
        assertTrue(str_contains($sql['COMMITTED_PLANS_SQL'], "status = 'Committed'") && str_contains($sql['LOCK_PLAN_SQL'], 'status,'), 'only Committed base plans are settled (M3)');
        assertSame(['overtime_amount', 'overtime_hours', 'overtime_count'], SupplementalStore::VALUES);
        $service = (string) file_get_contents(dirname(__DIR__, 2) . '/src/Supplemental/SupplementalService.php');
        assertSame(2, substr_count($service, '}, readCommitted: true);'), 'generate and commit are the Supplemental READ COMMITTED transactions');
    },
    'the store refuses an Employee scope on anchor and eligibility reads, a foreign Action, a record-bearing Authorization, an Employee write and malformed ids or keys' => static function () use ($db, $principal): void {
        $store = new SupplementalStore($db());
        $ceo = $principal('ceo', null);
        $emp = $principal('employee', 'emp_1');
        foreach ([static fn () => $store->anchor(Scope::of($emp), str_repeat('b', 32)), static fn () => $store->planAnchor(Scope::of($emp), str_repeat('b', 32)), static fn () => $store->eligibilityInputs(Scope::of($emp), '2026-10')] as $i => $fn) {
            $e = assertThrows(\LogicException::class, $fn, 'company scope only ' . $i);
            assertSame('supplemental anchor and eligibility reads are company scope only', $e->getMessage());
        }
        $foreign = new Authorization(Action::PayrollManage, Scope::of($ceo), null);
        $recordBearing = new Authorization(Action::SupplementalManage, Scope::of($ceo), new ScopedRecord(Scope::of($ceo), 'supplementalPayroll', str_repeat('b', 32), 'emp_1', 'Draft'));
        $selfAuth = new Authorization(Action::SupplementalManage, Scope::of($emp), null);
        foreach ([$foreign, $recordBearing, $selfAuth] as $i => $auth) {
            $e = assertThrows(\LogicException::class, static fn () => $store->lock($auth, str_repeat('b', 32)), 'auth ' . $i);
            assertSame('a supplemental write needs supplemental.manage, record-free, in company scope', $e->getMessage());
            assertThrows(\LogicException::class, static fn () => $store->unlink($auth, str_repeat('b', 32)), 'unlink ' . $i);
            assertThrows(\LogicException::class, static fn () => $store->commit($auth, str_repeat('b', 32), 1, str_repeat('f', 32)), 'commit ' . $i);
        }
        $ok = Policy::authorize($ceo, Action::SupplementalManage);
        assertThrows(\LogicException::class, static fn () => $store->commit($ok, str_repeat('b', 32), 1, str_repeat('F', 32)), 'a malformed key');
        assertThrows(\LogicException::class, static fn () => $store->keyHolder($ok, 'x'), 'a malformed key read');
        assertThrows(\LogicException::class, static fn () => $store->lock($ok, 'emp_1'), 'a malformed id');
        assertThrows(\LogicException::class, static fn () => $store->transition($ok, str_repeat('b', 32), 1, 'Ready', 'Committed'), 'never to Committed');
        assertThrows(\LogicException::class, static fn () => $store->transition($ok, str_repeat('b', 32), 1, 'Committed', 'Draft'), 'never from Committed (M18)');
        assertThrows(\LogicException::class, static fn () => $store->transition($ok, str_repeat('b', 32), 1, 'Cancelled', 'Draft'), 'never from Cancelled (M19)');
        assertThrows(\LogicException::class, static fn () => $store->create($ok, str_repeat('b', 32), ['status' => 'Ready'], []), 'a base plan that is not Committed (M3)');
        assertThrows(\LogicException::class, static fn () => $store->link($ok, str_repeat('b', 32), ['emp_1']), 'a link names an overtime id');
    },
    'Policy: supplemental.manage is record-free and CEO-only; an Employee is 403 on every write and the eligibility read before any lookup (M27, M30, M37)' => static function () use ($principal, $unreachable): void {
        assertSame(null, Action::SupplementalManage->entity(), 'record-free in both vocabularies');
        assertSame(\TamOs\Policy\Rule::CeoOnly, Action::SupplementalManage->rule());
        assertSame(21, count(Action::cases()), 'ACTIONS stay 21');
        $ceo = $principal('ceo', null);
        $emp = $principal('employee', 'emp_1');
        assertTrue(Policy::allows($ceo, Action::SupplementalManage), 'CEO');
        assertTrue(!Policy::allows($emp, Action::SupplementalManage), 'Employee');
        $service = new SupplementalService($unreachable());
        $id = str_repeat('b', 32);
        foreach ([
            'generate' => static fn () => $service->generate($emp, ['payrollPlanId' => $id], str_repeat('d', 32)),
            'review' => static fn () => $service->transition($emp, 'review', ['id' => $id, 'expectedVersion' => 1], str_repeat('d', 32)),
            'cancel' => static fn () => $service->transition($emp, 'cancel', ['id' => $id, 'expectedVersion' => 1], str_repeat('d', 32)),
            'commit' => static fn () => $service->commit($emp, ['id' => $id, 'expectedVersion' => 1, 'expectedTotal' => '1.00', 'idempotencyKey' => str_repeat('f', 32)], str_repeat('d', 32)),
            'eligibility' => static fn () => $service->eligibility($emp, '2026-10'),
        ] as $op => $fn) {
            $e = assertThrows(ApiError::class, $fn);
            assertSame(ErrorCode::Forbidden, $e->errorCode, 'an Employee ' . $op . ' is 403 before any lookup');
        }
        assertThrows(\TamOs\Data\DatabaseError::class, static fn () => $service->month($emp, '2026-10'), 'an Employee read is scoped, not refused');
    },
    'the Supplemental audit vocabulary: supplemental.manage on supplementalPayroll, the Payroll operations, no field, no value (M31)' => static function () use ($db, $principal): void {
        assertSame(['create', 'recalculate', 'review', 'approve', 'return', 'cancel', 'commit'], AuditLog::SUPPLEMENTAL_OPERATIONS);
        assertSame(AuditLog::PAYROLL_OPERATIONS, AuditLog::SUPPLEMENTAL_OPERATIONS, 'the Payroll operation vocabulary');
        assertTrue(str_contains(AuditLog::APPEND_SUPPLEMENTAL_SQL, ':operation, NULL, :request_id, NULL)'), 'no target user, no field list');
        $audit = new AuditLog($db());
        $ceo = $principal('ceo', null);
        $emp = $principal('employee', 'emp_1');
        $ok = Policy::authorize($ceo, Action::SupplementalManage);
        foreach (['pay', 'post', 'execute', 'paid'] as $op) {
            assertThrows(\LogicException::class, static fn () => $audit->appendSupplemental($ok, $ceo, $op, str_repeat('b', 32), str_repeat('d', 32)), 'no ' . $op . ' operation');
        }
        assertThrows(\LogicException::class, static fn () => $audit->appendSupplemental($ok, $ceo, 'create', 'emp_1', str_repeat('d', 32)), 'a document id');
        assertThrows(\LogicException::class, static fn () => $audit->appendSupplemental(new Authorization(Action::PayrollManage, Scope::of($ceo), null), $ceo, 'create', str_repeat('b', 32), str_repeat('d', 32)), 'supplemental.manage only');
        assertThrows(\LogicException::class, static fn () => $audit->appendSupplemental(new Authorization(Action::SupplementalManage, Scope::of($emp), null), $emp, 'create', str_repeat('b', 32), str_repeat('d', 32)), 'company scope only');
        $m31 = (string) file_get_contents(dirname(__DIR__, 2) . '/migrations/0031_replace_audit_events_supplemental_checks.sql');
        assertTrue(str_contains($m31, "(entity = 'supplementalPayroll') = (action = 'supplemental.manage')")
            && str_contains($m31, "WHEN 'supplemental.manage' THEN operation IS NOT NULL AND operation IN ('create', 'recalculate', 'review', 'approve', 'return', 'cancel', 'commit')")
            && str_contains($m31, "WHEN 'payroll.manage' THEN operation IS NOT NULL AND operation IN ('create', 'recalculate', 'review', 'approve', 'return', 'cancel', 'commit')"), '0031 ties supplemental.manage to supplementalPayroll and keeps every existing rule');
    },
];
