<?php
declare(strict_types=1);

/*
 * BF-4e Finance posting structure without a database (owner decisions D-FIN-1..5 = A): the strict
 * inputs (exactly { payrollPlanId | supplementalPayrollId, expectedAmount, idempotencyKey } with a
 * canonical string amount and a 32-hex key), the seven-key posting projection (Planned only; the
 * base plan's thirteen and the Supplemental document's twelve keys untouched), the store's statements
 * and guards (CEO company scope everywhere, no Employee statement, two INSERTs of a Planned posting
 * and no UPDATE or DELETE, the sources read and locked by primary key and never written, no SQL money
 * arithmetic), the authorization of a posting by its source domain's Action, and the 'post' audit
 * vocabulary on the source. Behaviour is proven against MariaDB in tests/Db/FinancePosting*Test.php.
 */

use TamOs\Data\Audit\AuditLog;
use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Data\Finance\FinancePostingStore;
use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Data\Scope\ScopedRecord;
use TamOs\Finance\FinancePostingInput;
use TamOs\Finance\FinancePostingService;
use TamOs\Finance\FinancePostingView;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Payroll\PayrollView;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Policy;
use TamOs\Policy\Scope;
use TamOs\Supplemental\SupplementalView;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$db = static fn (): ScopedDatabase => new ScopedDatabase(new Database(DatabaseConfig::fromArray([
    'host' => '127.0.0.1', 'port' => 1, 'name' => 'tamos_test', 'user' => 'u', 'pass' => 'unreachable-by-design',
])));
/** Business data over an unreachable, lazily connecting database: any statement would fail, so a 403 or 400 proves no lookup ran. */
$unreachable = static fn (): \TamOs\Data\BusinessData => \TamOs\Data\BusinessData::fromDatabase(new Database(DatabaseConfig::fromArray([
    'host' => '127.0.0.1', 'port' => 1, 'name' => 'tamos_test', 'user' => 'u', 'pass' => 'unreachable-by-design',
])));
$principal = static fn (string $role, ?string $employeeId): Principal => Principal::fromAccount(
    ['user_id' => str_repeat('1', 32), 'user_status' => 'active', 'has_password' => true],
    [['membership_id' => str_repeat('2', 32), 'company_id' => str_repeat('a', 32), 'role' => $role, 'employee_id' => $employeeId, 'membership_status' => 'active']],
) ?? throw new \LogicException('fixture');
$row = ['id' => str_repeat('b', 32), 'company_id' => str_repeat('a', 32), 'owner_employee_id' => 'emp_1', 'source_kind' => 'payrollPlan', 'payroll_plan_id' => str_repeat('c', 32),
    'supplemental_payroll_id' => null, 'employee_id' => 'emp_1', 'month_key' => '2026-10', 'amount' => '3521875.00', 'status' => 'Planned'];
$sqlOf = static function (): array {
    $out = [];
    foreach ((new \ReflectionClass(FinancePostingStore::class))->getConstants() as $name => $value) {
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
$plan = str_repeat('c', 32);
$key = str_repeat('f', 32);

return [
    'the base plan posting takes exactly { payrollPlanId, expectedAmount, idempotencyKey }; the Supplemental one exactly { supplementalPayrollId, expectedAmount, idempotencyKey } — every other key is a 400 naming it' => static function () use ($code, $plan, $key): void {
        $body = ['payrollPlanId' => $plan, 'expectedAmount' => '3521875.00', 'idempotencyKey' => $key];
        assertSame(['sourceId' => $plan, 'expectedAmount' => '3521875.00', 'idempotencyKey' => $key], FinancePostingInput::payrollPlan($body));
        $supp = ['supplementalPayrollId' => $plan, 'expectedAmount' => '21875.00', 'idempotencyKey' => $key];
        assertSame(['sourceId' => $plan, 'expectedAmount' => '21875.00', 'idempotencyKey' => $key], FinancePostingInput::supplementalPayroll($supp));
        foreach (['companyId', 'employeeId', 'role', 'month', 'monthKey', 'amount', 'totalAmount', 'status', 'sourceKind', 'sourceId', 'id', 'expectedVersion',
            'companyAccountId', 'category', 'actual', 'executedAt', 'supplementalPayrollId'] as $k) {
            assertSame([ErrorCode::ValidationFailed, [$k]], $code(static fn () => FinancePostingInput::payrollPlan($body + [$k => 'x'])), 'base plan ' . $k);
        }
        foreach (['payrollPlanId', 'amount', 'employeeId', 'status', 'sourceKind'] as $k) {
            assertSame([ErrorCode::ValidationFailed, [$k]], $code(static fn () => FinancePostingInput::supplementalPayroll($supp + [$k => 'x'])), 'Supplemental ' . $k);
        }
        foreach (['payrollPlanId', 'expectedAmount', 'idempotencyKey'] as $k) {
            $missing = $body;
            unset($missing[$k]);
            assertSame([ErrorCode::ValidationFailed, [$k]], $code(static fn () => FinancePostingInput::payrollPlan($missing)), 'missing ' . $k);
        }
        foreach (['emp_1', strtoupper($plan), 7, null, [$plan]] as $i => $bad) {
            assertSame([ErrorCode::ValidationFailed, ['payrollPlanId']], $code(static fn () => FinancePostingInput::payrollPlan(['payrollPlanId' => $bad] + $body)), 'source id ' . $i);
            assertSame([ErrorCode::ValidationFailed, ['supplementalPayrollId']], $code(static fn () => FinancePostingInput::supplementalPayroll(['supplementalPayrollId' => $bad] + $supp)), 'Supplemental id ' . $i);
        }
    },
    'expectedAmount is the canonical whole-Rupiah "N.00" string and the key 32 lowercase hex characters — never coerced' => static function () use ($code, $plan, $key): void {
        $body = ['payrollPlanId' => $plan, 'expectedAmount' => '3521875.00', 'idempotencyKey' => $key];
        foreach ([3521875, 3521875.0, '3521875', '3521875.0', '03521875.00', '3521875.50', '-1.00', ' 1.00', '1e5', '1,00', ''] as $bad) {
            assertSame([ErrorCode::ValidationFailed, ['expectedAmount']], $code(static fn () => FinancePostingInput::payrollPlan(['expectedAmount' => $bad] + $body)), 'expectedAmount ' . var_export($bad, true));
        }
        foreach ([str_repeat('F', 32), str_repeat('f', 31), str_repeat('f', 33), str_repeat('g', 32), 7, null] as $bad) {
            assertSame([ErrorCode::ValidationFailed, ['idempotencyKey']], $code(static fn () => FinancePostingInput::payrollPlan(['idempotencyKey' => $bad] + $body)), 'key ' . var_export($bad, true));
        }
        assertSame([ErrorCode::ValidationFailed, ['payrollPlanId', 'expectedAmount', 'idempotencyKey']],
            $code(static fn () => FinancePostingInput::payrollPlan(['payrollPlanId' => 'x', 'expectedAmount' => '1', 'idempotencyKey' => 'x'])), 'every bad field named');
        assertSame([ErrorCode::InvalidQuery, []], $code(static fn () => FinancePostingInput::month('2026-1')));
        assertSame('2026-10', FinancePostingInput::month('2026-10'));
    },
    'the posting projection is exactly seven fields, Planned only; never the company, the key, posted_at or an execution, account or category field; the source DTOs are unchanged' => static function () use ($row): void {
        assertSame(['id', 'sourceKind', 'sourceId', 'employeeId', 'monthKey', 'amount', 'status'], FinancePostingView::FIELDS);
        $v = FinancePostingView::posting($row + ['idempotency_key' => str_repeat('f', 32), 'posted_at' => 'x']);
        assertSame(FinancePostingView::FIELDS, array_keys($v));
        assertSame([str_repeat('b', 32), 'payrollPlan', str_repeat('c', 32), 'emp_1', '2026-10', '3521875.00', 'Planned'], array_values($v));
        $s = FinancePostingView::posting(['source_kind' => 'supplementalPayroll', 'payroll_plan_id' => null, 'supplemental_payroll_id' => str_repeat('d', 32), 'amount' => '21875.00'] + $row);
        assertSame(['supplementalPayroll', str_repeat('d', 32), '21875.00'], [$s['sourceKind'], $s['sourceId'], $s['amount']]);
        foreach (FinancePostingView::FIELDS as $f) {
            assertTrue(!preg_match('/company|idempotency|posted|actual|execut|paid|payment|account|category|bank/i', $f), 'no such field: ' . $f);
        }
        foreach ([['status', 'Executed'], ['status', 'Paid'], ['status', 'Actual'], ['amount', '0.00'], ['amount', '-1.00'], ['amount', '1.50'], ['source_kind', 'manual'], ['payroll_plan_id', null]] as [$col, $bad]) {
            assertThrows(\LogicException::class, static fn () => FinancePostingView::posting([$col => $bad] + $row), $col . ' ' . var_export($bad, true));
        }
        assertSame(13, count(PayrollView::FIELDS), 'the base plan DTO keeps thirteen keys');
        assertSame(12, count(SupplementalView::FIELDS), 'the Supplemental DTO keeps twelve keys');
        assertTrue(!in_array('posted', array_merge(PayrollView::FIELDS, SupplementalView::FIELDS), true), 'nothing about a posting is embedded in a source DTO');
    },
    'the store statements: CEO company scope everywhere, no Employee statement, exactly two INSERTs of a Planned posting, no UPDATE or DELETE, the sources read and locked by primary key only, no SQL money arithmetic' => static function () use ($sqlOf): void {
        $sql = $sqlOf();
        $inserts = 0;
        foreach ($sql as $name => $s) {
            assertTrue(str_contains($s, ':company_id'), $name . ' names :company_id');
            assertTrue(!str_contains($s, '?'), $name . ': named parameters only');
            assertTrue(!str_contains($s, ':self_employee_id') && !str_ends_with($name, '_SELF_SQL'), $name . ': no Employee statement (CEO only, D-FIN-4 = A)');
            assertTrue(!preg_match('/^\s*(UPDATE|DELETE|REPLACE|TRUNCATE)\b/i', $s), $name . ': a posting is immutable — no UPDATE, DELETE or REPLACE');
            assertTrue(!preg_match('/^\s*(INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+(payroll_plans|payroll_plan_overtime|supplemental_payrolls|supplemental_payroll_overtime|overtime_records|employees)\b/i', $s), $name . ': the sources are never written');
            assertTrue(!preg_match('/\b(SUM|AVG)\s*\(|amount\s*[-+*\/]|[-+*\/]\s*\w*amount\b/i', $s), $name . ': no SQL money arithmetic');
            if (str_starts_with($s, 'INSERT')) {
                $inserts++;
                assertTrue(str_starts_with($s, 'INSERT INTO finance_postings (') && str_contains($s, ", 'Planned', :idempotency_key, UTC_TIMESTAMP(6))") && !preg_match('/IGNORE|ON DUPLICATE/i', $s), $name . ': a Planned posting with its key');
            }
            if (str_ends_with($s, 'FOR UPDATE')) {
                assertTrue((bool) preg_match('/^SELECT [^;]* FROM (employees|payroll_plans|supplemental_payrolls) WHERE id = :(employee_id|id) AND company_id = :company_id FOR UPDATE$/', $s) && !str_contains($s, 'JOIN'), $name . ' locks one row by primary key — never a range');
            }
        }
        assertSame(2, $inserts, 'one INSERT per source kind');
        assertTrue(str_contains($sql['INSERT_PLAN_SQL'], "'payrollPlan', :id, NULL,") && str_contains($sql['INSERT_SUPPLEMENTAL_SQL'], "'supplementalPayroll', NULL, :id,"), 'each INSERT names its source as :id and the other source as NULL');
        assertTrue(str_contains($sql['LOCK_PLAN_SQL'], 'status, total_amount FROM payroll_plans') && str_contains($sql['LOCK_SUPPLEMENTAL_SQL'], 'status, overtime_amount FROM supplemental_payrolls'), 'the amount is read from the locked source');
        assertSame(['payrollPlan', 'supplementalPayroll'], [FinancePostingStore::PAYROLL_PLAN, FinancePostingStore::SUPPLEMENTAL_PAYROLL]);
        $service = (string) file_get_contents(dirname(__DIR__, 2) . '/src/Finance/FinancePostingService.php');
        assertSame(2, substr_count($service, '}, readCommitted: true);'), 'both postings run at READ COMMITTED');
        assertTrue(!preg_match('/->\s*(payroll|supplemental|overtime|employees)\s*\(\s*\)/', $service), 'Finance never calls the Payroll, Supplemental, Overtime or Employee store');
    },
    'the store refuses an Employee scope, a foreign Action, a record-free payroll.manage, a record-bearing supplemental.manage, a plan other than the authorized one and malformed ids or keys' => static function () use ($db, $principal, $plan, $key): void {
        $store = new FinancePostingStore($db());
        $ceo = $principal('ceo', null);
        $emp = $principal('employee', 'emp_1');
        foreach ([static fn () => $store->month(Scope::of($emp), '2026-10'), static fn () => $store->record(Scope::of($emp), $plan),
            static fn () => $store->planRecord(Scope::of($emp), $plan), static fn () => $store->supplementalAnchor(Scope::of($emp), $plan)] as $i => $fn) {
            $e = assertThrows(\LogicException::class, $fn, 'company scope only ' . $i);
            assertSame('Finance posting reads are company scope only', $e->getMessage());
        }
        $planRecord = new ScopedRecord(Scope::of($ceo), 'payrollPlan', $plan, 'emp_1', 'Committed');
        $payroll = new Authorization(Action::PayrollManage, Scope::of($ceo), $planRecord);
        $supplemental = new Authorization(Action::SupplementalManage, Scope::of($ceo), null);
        foreach ([
            'a foreign Action' => new Authorization(Action::FinanceManage, Scope::of($ceo), null),
            'finance.execute' => new Authorization(Action::FinanceExecute, Scope::of($ceo), null),
            'a record-free payroll.manage' => new Authorization(Action::PayrollManage, Scope::of($ceo), null),
            'payroll.manage on another entity' => new Authorization(Action::PayrollManage, Scope::of($ceo), new ScopedRecord(Scope::of($ceo), 'supplementalPayroll', $plan, 'emp_1', 'Committed')),
            'a record-bearing supplemental.manage' => new Authorization(Action::SupplementalManage, Scope::of($ceo), $planRecord),
            'an Employee scope' => new Authorization(Action::SupplementalManage, Scope::of($emp), null),
        ] as $label => $auth) {
            $e = assertThrows(\LogicException::class, static fn () => $store->lockEmployee($auth, 'emp_1'), $label);
            assertSame('a posting needs payroll.manage on its plan or supplemental.manage, in company scope', $e->getMessage());
            assertThrows(\LogicException::class, static fn () => $store->keyHolder($auth, $key), $label . ' key read');
        }
        assertThrows(\LogicException::class, static fn () => $store->lockSupplemental($payroll, $plan), 'a Supplemental lock under payroll.manage');
        assertThrows(\LogicException::class, static fn () => $store->supplementalPosting($payroll, $plan), 'a Supplemental posting read under payroll.manage');
        assertThrows(\LogicException::class, static fn () => $store->lockPlan($supplemental), 'a plan lock under supplemental.manage');
        assertThrows(\LogicException::class, static fn () => $store->planPosting($supplemental), 'a plan posting read under supplemental.manage');
        assertThrows(\LogicException::class, static fn () => $store->insertPlan($supplemental, $plan, ['id' => $plan, 'status' => 'Committed'], $key), 'a plan posting under supplemental.manage');
        assertThrows(\LogicException::class, static fn () => $store->insertSupplemental($payroll, $plan, ['id' => $plan, 'status' => 'Committed'], $key), 'a Supplemental posting under payroll.manage');
        $e = assertThrows(\LogicException::class, static fn () => $store->insertPlan($payroll, $plan, ['id' => str_repeat('d', 32), 'status' => 'Committed'], $key), 'another plan than the authorized one');
        assertSame('a base plan posting is made only from the authorized, Committed plan', $e->getMessage());
        foreach (['Draft', 'Reviewed', 'Ready', 'Cancelled'] as $status) {
            assertThrows(\LogicException::class, static fn () => $store->insertPlan($payroll, $plan, ['id' => $plan, 'status' => $status], $key), 'a ' . $status . ' plan is never posted');
            assertThrows(\LogicException::class, static fn () => $store->insertSupplemental($supplemental, $plan, ['id' => $plan, 'status' => $status], $key), 'a ' . $status . ' document is never posted');
        }
        assertThrows(\LogicException::class, static fn () => $store->keyHolder($supplemental, 'x'), 'a malformed key');
        assertThrows(\LogicException::class, static fn () => $store->lockSupplemental($supplemental, 'emp_1'), 'a malformed id');
    },
    'Policy: a posting is authorized by its source domain — payroll.manage against the plan, the record-free supplemental.manage; both CEO-only; ACTIONS stay 21; an Employee is 403 before any lookup' => static function () use ($principal, $unreachable, $plan, $key): void {
        assertSame(21, count(Action::cases()), 'ACTIONS stay 21 — no Finance posting Action');
        assertSame(['payrollPlan', null], [Action::PayrollManage->entity(), Action::SupplementalManage->entity()]);
        $ceo = $principal('ceo', null);
        $emp = $principal('employee', 'emp_1');
        $own = new ScopedRecord(Scope::of($emp), 'payrollPlan', $plan, 'emp_1', 'Committed');
        assertTrue(!Policy::allows($emp, Action::PayrollManage, $own), 'an Employee never posts their own plan');
        assertTrue(!Policy::allows($emp, Action::SupplementalManage), 'an Employee never posts a Supplemental document');
        assertTrue(Policy::allows($ceo, Action::SupplementalManage), 'the CEO');
        $service = new FinancePostingService($unreachable());
        foreach ([
            'month' => static fn () => $service->month($emp, '2026-10'),
            'base plan' => static fn () => $service->postPayrollPlan($emp, ['payrollPlanId' => $plan, 'expectedAmount' => '1.00', 'idempotencyKey' => $key], str_repeat('d', 32)),
            'Supplemental' => static fn () => $service->postSupplementalPayroll($emp, ['supplementalPayrollId' => $plan, 'expectedAmount' => '1.00', 'idempotencyKey' => $key], str_repeat('d', 32)),
        ] as $op => $fn) {
            $e = assertThrows(ApiError::class, $fn);
            assertSame(ErrorCode::Forbidden, $e->errorCode, 'an Employee ' . $op . ' is 403 before any lookup');
        }
        $e = assertThrows(ApiError::class, static fn () => $service->postPayrollPlan($ceo, ['payrollPlanId' => $plan], str_repeat('d', 32)));
        assertSame(ErrorCode::ValidationFailed, $e->errorCode, 'the body is validated before any lookup');
    },
    "the posting audit vocabulary: operation 'post' on the source, under payroll.manage (its plan) or supplemental.manage (its document); no field, no value; the Payroll and Supplemental operation lists are unchanged" => static function () use ($db, $principal, $plan): void {
        assertSame('post', AuditLog::POSTING_OPERATION);
        assertTrue(!in_array('post', AuditLog::PAYROLL_OPERATIONS, true) && !in_array('post', AuditLog::SUPPLEMENTAL_OPERATIONS, true), 'Payroll and Supplemental never audit a posting themselves');
        assertTrue(str_contains(AuditLog::APPEND_POSTING_SQL, ':operation, NULL, :request_id, NULL)'), 'no target user, no field list');
        $audit = new AuditLog($db());
        $ceo = $principal('ceo', null);
        $emp = $principal('employee', 'emp_1');
        $record = new ScopedRecord(Scope::of($ceo), 'payrollPlan', $plan, 'emp_1', 'Committed');
        $rid = str_repeat('d', 32);
        foreach ([
            'another plan than the authorized one' => [new Authorization(Action::PayrollManage, Scope::of($ceo), $record), str_repeat('e', 32)],
            'a record-free payroll.manage' => [new Authorization(Action::PayrollManage, Scope::of($ceo), null), $plan],
            'a record-bearing supplemental.manage' => [new Authorization(Action::SupplementalManage, Scope::of($ceo), $record), $plan],
            'finance.manage' => [new Authorization(Action::FinanceManage, Scope::of($ceo), null), $plan],
            'finance.execute' => [new Authorization(Action::FinanceExecute, Scope::of($ceo), null), $plan],
            'an Employee scope' => [new Authorization(Action::SupplementalManage, Scope::of($emp), null), $plan],
            'a malformed source id' => [new Authorization(Action::SupplementalManage, Scope::of($ceo), null), 'emp_1'],
        ] as $label => [$auth, $source]) {
            assertThrows(\LogicException::class, static fn () => $audit->appendPosting($auth, $auth->scope->isSelf() ? $emp : $ceo, $source, $rid), $label);
        }
        $m33 = (string) file_get_contents(dirname(__DIR__, 2) . '/migrations/0033_replace_audit_events_finance_post.sql');
        assertTrue(str_contains($m33, "WHEN 'payroll.manage' THEN operation IS NOT NULL AND operation IN ('create', 'recalculate', 'review', 'approve', 'return', 'cancel', 'commit', 'post')")
            && str_contains($m33, "WHEN 'supplemental.manage' THEN operation IS NOT NULL AND operation IN ('create', 'recalculate', 'review', 'approve', 'return', 'cancel', 'commit', 'post')")
            && !preg_match("/'(pay|execute|reverse|void|correct)'/", $m33), "0033 admits 'post' under the two source Actions only, and no execution, payment or reversal operation");
    },
];
