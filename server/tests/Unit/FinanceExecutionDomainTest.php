<?php
declare(strict_types=1);

/*
 * BF-4f Finance execution structure without a database (owner decisions D-FEX-1..8 = A): the strict
 * input (exactly { financePostingId, expectedAmount, executedOn, paymentMethod, idempotencyKey } with
 * a canonical string amount, a real calendar date no later than today in the Asia/Jakarta company
 * calendar and no lower bound, the closed payment method list and a 32-hex key), the seven-key
 * execution projection (the seven-key posting projection untouched), the store's statements and
 * guards (CEO company scope everywhere, no Employee statement, exactly one INSERT and no UPDATE or
 * DELETE, the posting read and locked by primary key and never written, no SQL money arithmetic),
 * the authorization of an execution by the record-free finance.execute, and the 'execute' audit
 * vocabulary on the posting. Behaviour is proven against MariaDB in tests/Db/FinanceExecution*Test.php.
 */

use TamOs\Data\Audit\AuditLog;
use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Data\Finance\FinanceExecutionStore;
use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Data\Scope\ScopedRecord;
use TamOs\Finance\FinanceExecutionInput;
use TamOs\Finance\FinanceExecutionService;
use TamOs\Finance\FinanceExecutionView;
use TamOs\Finance\FinancePostingView;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
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
/** Business data over an unreachable, lazily connecting database: any statement would fail, so a 403 or 400 proves no lookup ran. */
$unreachable = static fn (): \TamOs\Data\BusinessData => \TamOs\Data\BusinessData::fromDatabase(new Database(DatabaseConfig::fromArray([
    'host' => '127.0.0.1', 'port' => 1, 'name' => 'tamos_test', 'user' => 'u', 'pass' => 'unreachable-by-design',
])));
$principal = static fn (string $role, ?string $employeeId): Principal => Principal::fromAccount(
    ['user_id' => str_repeat('1', 32), 'user_status' => 'active', 'has_password' => true],
    [['membership_id' => str_repeat('2', 32), 'company_id' => str_repeat('a', 32), 'role' => $role, 'employee_id' => $employeeId, 'membership_status' => 'active']],
) ?? throw new \LogicException('fixture');
$row = ['id' => str_repeat('b', 32), 'company_id' => str_repeat('a', 32), 'owner_employee_id' => 'emp_1', 'finance_posting_id' => str_repeat('c', 32),
    'employee_id' => 'emp_1', 'month_key' => '2026-10', 'amount' => '3521875.00', 'executed_on' => '2026-10-07', 'payment_method' => 'bankTransfer'];
$sqlOf = static function (): array {
    $out = [];
    foreach ((new \ReflectionClass(FinanceExecutionStore::class))->getConstants() as $name => $value) {
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
$posting = str_repeat('c', 32);
$key = str_repeat('f', 32);
$today = '2026-10-07';
$body = ['financePostingId' => $posting, 'expectedAmount' => '3521875.00', 'executedOn' => '2026-10-07', 'paymentMethod' => 'bankTransfer', 'idempotencyKey' => $key];

return [
    'the command takes exactly { financePostingId, expectedAmount, executedOn, paymentMethod, idempotencyKey } — every other key is a 400 naming it' => static function () use ($code, $body, $today): void {
        assertSame($body, FinanceExecutionInput::execute($body, $today));
        foreach (['companyId', 'employeeId', 'role', 'month', 'monthKey', 'amount', 'actualAmount', 'status', 'id', 'expectedVersion', 'sourceKind', 'sourceId',
            'companyAccountId', 'accountId', 'bankAccount', 'bank', 'reference', 'notes', 'note', 'category', 'executedAt', 'paidAt', 'partial', 'payrollPlanId', 'supplementalPayrollId'] as $k) {
            assertSame([ErrorCode::ValidationFailed, [$k]], $code(static fn () => FinanceExecutionInput::execute($body + [$k => 'x'], $today)), 'key ' . $k);
        }
        foreach (array_keys($body) as $k) {
            $missing = $body;
            unset($missing[$k]);
            assertSame([ErrorCode::ValidationFailed, [$k]], $code(static fn () => FinanceExecutionInput::execute($missing, $today)), 'missing ' . $k);
        }
        foreach (['emp_1', strtoupper(str_repeat('c', 32)), 7, null, [str_repeat('c', 32)]] as $i => $bad) {
            assertSame([ErrorCode::ValidationFailed, ['financePostingId']], $code(static fn () => FinanceExecutionInput::execute(['financePostingId' => $bad] + $body, $today)), 'posting id ' . $i);
        }
        assertSame([ErrorCode::ValidationFailed, ['financePostingId', 'expectedAmount', 'executedOn', 'paymentMethod', 'idempotencyKey']],
            $code(static fn () => FinanceExecutionInput::execute(['financePostingId' => 'x', 'expectedAmount' => '1', 'executedOn' => 'x', 'paymentMethod' => 'x', 'idempotencyKey' => 'x'], $today)), 'every bad field named');
        assertSame([ErrorCode::InvalidQuery, []], $code(static fn () => FinanceExecutionInput::month('2026-1')));
        assertSame('2026-10', FinanceExecutionInput::month('2026-10'));
    },
    'expectedAmount is the canonical whole-Rupiah "N.00" string and the key 32 lowercase hex characters — never coerced' => static function () use ($code, $body, $today): void {
        foreach ([3521875, 3521875.0, '3521875', '3521875.0', '03521875.00', '3521875.50', '-1.00', ' 1.00', '1e5', '1,00', ''] as $bad) {
            assertSame([ErrorCode::ValidationFailed, ['expectedAmount']], $code(static fn () => FinanceExecutionInput::execute(['expectedAmount' => $bad] + $body, $today)), 'expectedAmount ' . var_export($bad, true));
        }
        foreach ([str_repeat('F', 32), str_repeat('f', 31), str_repeat('f', 33), str_repeat('g', 32), 7, null] as $bad) {
            assertSame([ErrorCode::ValidationFailed, ['idempotencyKey']], $code(static fn () => FinanceExecutionInput::execute(['idempotencyKey' => $bad] + $body, $today)), 'key ' . var_export($bad, true));
        }
    },
    'paymentMethod is one of the closed list (D-FEX-5 = A) — the LOCAL methods as stable codes; no free text, label or other casing' => static function () use ($code, $body, $today): void {
        assertSame(['cash', 'bankTransfer', 'qris', 'virtualAccount', 'creditCard', 'other'], FinanceExecutionInput::PAYMENT_METHODS);
        foreach (FinanceExecutionInput::PAYMENT_METHODS as $m) {
            assertSame($m, FinanceExecutionInput::execute(['paymentMethod' => $m] + $body, $today)['paymentMethod']);
        }
        foreach (['Cash', 'Bank Transfer', 'bank_transfer', 'banktransfer', 'QRIS', ' cash', 'cash ', 'cheque', 'giro', 'crypto', '', 1, null, true, ['cash']] as $bad) {
            assertSame([ErrorCode::ValidationFailed, ['paymentMethod']], $code(static fn () => FinanceExecutionInput::execute(['paymentMethod' => $bad] + $body, $today)), 'method ' . var_export($bad, true));
        }
    },
    'executedOn is a real calendar date "YYYY-MM-DD", no later than today in the company calendar and with no lower bound (D-FEX-8 = A)' => static function () use ($code, $body): void {
        $today = '2026-10-07';
        foreach (['2026-10-07', '2026-10-06', '2026-09-30', '2025-12-31', '2024-02-29', '1999-01-01', '1000-01-01', '0001-01-01'] as $ok) {
            assertSame($ok, FinanceExecutionInput::execute(['executedOn' => $ok] + $body, $today)['executedOn'], 'accepted ' . $ok);
        }
        foreach (['2026-10-08', '2026-11-01', '2027-01-01', '9999-12-31'] as $future) {
            assertSame([ErrorCode::ValidationFailed, ['executedOn']], $code(static fn () => FinanceExecutionInput::execute(['executedOn' => $future] + $body, $today)), 'after today ' . $future);
        }
        foreach (['2026-02-29', '2026-13-01', '2026-00-10', '2026-10-32', '2026-10-00', '0000-01-01', '2026-10-7', '26-10-07', '2026/10/07', '2026-10-07T00:00:00', ' 2026-10-07', '20261007', '', 20261007, null] as $bad) {
            assertSame([ErrorCode::ValidationFailed, ['executedOn']], $code(static fn () => FinanceExecutionInput::execute(['executedOn' => $bad] + $body, $today)), 'date ' . var_export($bad, true));
        }
    },
    'today is the Asia/Jakarta calendar day (UTC+7), never the server UTC date' => static function (): void {
        assertSame('Asia/Jakarta', FinanceExecutionInput::COMPANY_TIMEZONE);
        $utc = new \DateTimeZone('UTC');
        assertSame('2026-10-07', FinanceExecutionInput::today(new \DateTimeImmutable('2026-10-06 17:00:00', $utc)), '17:00 UTC is 00:00 the next day in Jakarta');
        assertSame('2026-10-06', FinanceExecutionInput::today(new \DateTimeImmutable('2026-10-06 16:59:59', $utc)), '16:59:59 UTC is still the same day in Jakarta');
        assertSame('2027-01-01', FinanceExecutionInput::today(new \DateTimeImmutable('2026-12-31 18:30:00', $utc)), 'the year turns in Jakarta first');
        assertSame('2026-10-07', FinanceExecutionInput::today(new \DateTimeImmutable('2026-10-07 06:00:00', new \DateTimeZone('America/Los_Angeles'))), 'whatever the input clock zone');
        $jakartaMorning = FinanceExecutionInput::today(new \DateTimeImmutable('2026-10-06 18:00:00', $utc));
        assertSame('2026-10-07', FinanceExecutionInput::execute(['financePostingId' => str_repeat('c', 32), 'expectedAmount' => '1.00', 'executedOn' => '2026-10-07', 'paymentMethod' => 'cash', 'idempotencyKey' => str_repeat('f', 32)], $jakartaMorning)['executedOn'],
            'a payment made this morning in Jakarta is accepted while the UTC date is still yesterday');
    },
    'the execution projection is exactly seven fields; never the company, the key, recorded_at or an actor, account, reference or note; the posting DTO is unchanged' => static function () use ($row): void {
        assertSame(['id', 'financePostingId', 'employeeId', 'monthKey', 'amount', 'executedOn', 'paymentMethod'], FinanceExecutionView::FIELDS);
        $v = FinanceExecutionView::execution($row + ['idempotency_key' => str_repeat('f', 32), 'recorded_at' => 'x']);
        assertSame(FinanceExecutionView::FIELDS, array_keys($v));
        assertSame([str_repeat('b', 32), str_repeat('c', 32), 'emp_1', '2026-10', '3521875.00', '2026-10-07', 'bankTransfer'], array_values($v));
        foreach (FinanceExecutionView::FIELDS as $f) {
            assertTrue(!preg_match('/company|idempotency|recorded|actor|user|account|bank|reference|note|category|status|partial|revers|correct/i', $f), 'no such field: ' . $f);
        }
        foreach ([['amount', '0.00'], ['amount', '-1.00'], ['amount', '1.50'], ['amount', '1'], ['executed_on', '2026-02-30'], ['executed_on', '2026-10-07 00:00:00'], ['payment_method', 'Cash'],
            ['payment_method', 'cheque'], ['finance_posting_id', '']] as [$col, $bad]) {
            assertThrows(\LogicException::class, static fn () => FinanceExecutionView::execution([$col => $bad] + $row), $col . ' ' . var_export($bad, true));
        }
        assertSame(['id', 'sourceKind', 'sourceId', 'employeeId', 'monthKey', 'amount', 'status'], FinancePostingView::FIELDS, 'the posting DTO keeps its seven keys (AFI-4e decoder unaffected, D-FEX-6 = A)');
        assertSame('Planned', FinancePostingView::PLANNED, 'a posting is still Planned only');
    },
    'the store statements: CEO company scope everywhere, no Employee statement, exactly one INSERT of an execution, no UPDATE or DELETE, the posting locked by primary key only and never written, no SQL money arithmetic' => static function () use ($sqlOf): void {
        $sql = $sqlOf();
        $inserts = 0;
        foreach ($sql as $name => $s) {
            assertTrue(str_contains($s, ':company_id'), $name . ' names :company_id');
            assertTrue(!str_contains($s, '?'), $name . ': named parameters only');
            assertTrue(!str_contains($s, ':self_employee_id') && !str_ends_with($name, '_SELF_SQL'), $name . ': no Employee statement (CEO only, D-FEX-4 = A)');
            assertTrue(!preg_match('/^\s*(UPDATE|DELETE|REPLACE|TRUNCATE)\b/i', $s), $name . ': an execution is immutable — no UPDATE, DELETE or REPLACE');
            assertTrue(!preg_match('/^\s*(INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+(finance_postings|payroll_plans|payroll_plan_overtime|supplemental_payrolls|supplemental_payroll_overtime|overtime_records|employees)\b/i', $s), $name . ': the posting and the sources are never written');
            assertTrue(!preg_match('/\b(SUM|AVG)\s*\(|amount\s*[-+*\/]|[-+*\/]\s*\w*amount\b/i', $s), $name . ': no SQL money arithmetic');
            if (str_starts_with($s, 'INSERT')) {
                $inserts++;
                assertTrue(str_starts_with($s, 'INSERT INTO finance_executions (') && str_contains($s, ':amount, :executed_on, :payment_method, :idempotency_key, UTC_TIMESTAMP(6))') && !preg_match('/IGNORE|ON DUPLICATE/i', $s), $name . ': one execution with its key');
            }
            if (str_contains($s, 'FOR UPDATE')) {
                assertSame('LOCK_POSTING_SQL', $name, 'the one lock');
                assertTrue((bool) preg_match('/^SELECT [^;]* FROM finance_postings WHERE id = :id AND company_id = :company_id FOR UPDATE$/', $s) && !str_contains($s, 'JOIN'), $name . ' locks one posting by primary key — never a range');
            }
        }
        assertSame(1, $inserts, 'one INSERT');
        assertTrue(str_contains($sql['LOCK_POSTING_SQL'], 'employee_id, month_key, amount, status FROM finance_postings'), 'the amount, employee and month are read from the locked posting');
        $service = (string) file_get_contents(dirname(__DIR__, 2) . '/src/Finance/FinanceExecutionService.php');
        assertSame(1, substr_count($service, '}, readCommitted: true);'), 'the execution runs at READ COMMITTED');
        assertTrue(!preg_match('/->\s*(finance|payroll|supplemental|overtime|employees)\s*\(\s*\)/', $service), 'the execution never calls the posting, Payroll, Supplemental, Overtime or Employee store');
    },
    'the store refuses an Employee scope, any Action but the record-free finance.execute, a non-Planned posting and malformed ids or keys' => static function () use ($db, $principal, $posting, $key): void {
        $store = new FinanceExecutionStore($db());
        $ceo = $principal('ceo', null);
        $emp = $principal('employee', 'emp_1');
        foreach ([static fn () => $store->month(Scope::of($emp), '2026-10'), static fn () => $store->record(Scope::of($emp), $posting)] as $i => $fn) {
            $e = assertThrows(\LogicException::class, $fn, 'company scope only ' . $i);
            assertSame('Finance execution reads are company scope only', $e->getMessage());
        }
        $auth = new Authorization(Action::FinanceExecute, Scope::of($ceo), null);
        foreach ([
            'finance.manage' => new Authorization(Action::FinanceManage, Scope::of($ceo), null),
            'payroll.manage' => new Authorization(Action::PayrollManage, Scope::of($ceo), new ScopedRecord(Scope::of($ceo), 'payrollPlan', $posting, 'emp_1', 'Committed')),
            'supplemental.manage' => new Authorization(Action::SupplementalManage, Scope::of($ceo), null),
            'a record-bearing finance.execute' => new Authorization(Action::FinanceExecute, Scope::of($ceo), new ScopedRecord(Scope::of($ceo), 'financePosting', $posting, 'emp_1', 'Planned')),
            'an Employee scope' => new Authorization(Action::FinanceExecute, Scope::of($emp), null),
        ] as $label => $bad) {
            $e = assertThrows(\LogicException::class, static fn () => $store->lockPosting($bad, $posting), $label);
            assertSame('an execution needs the record-free finance.execute, in company scope', $e->getMessage());
            assertThrows(\LogicException::class, static fn () => $store->keyHolder($bad, $key), $label . ' key read');
            assertThrows(\LogicException::class, static fn () => $store->postingExecution($bad, $posting), $label . ' posting read');
            assertThrows(\LogicException::class, static fn () => $store->insert($bad, $posting, ['id' => $posting, 'status' => 'Planned', 'employee_id' => 'emp_1', 'month_key' => '2026-10', 'amount' => '1.00'], '2026-10-07', 'cash', $key), $label . ' insert');
        }
        foreach (['Executed', 'Paid', 'Reversed', ''] as $status) {
            $e = assertThrows(\LogicException::class, static fn () => $store->insert($auth, $posting, ['id' => $posting, 'status' => $status, 'employee_id' => 'emp_1', 'month_key' => '2026-10', 'amount' => '1.00'], '2026-10-07', 'cash', $key), 'a ' . $status . ' posting');
            assertSame('an execution is recorded only for a Planned posting', $e->getMessage());
        }
        assertThrows(\LogicException::class, static fn () => $store->keyHolder($auth, 'x'), 'a malformed key');
        assertThrows(\LogicException::class, static fn () => $store->lockPosting($auth, 'emp_1'), 'a malformed posting id');
        assertThrows(\LogicException::class, static fn () => $store->insert($auth, 'x', ['id' => $posting, 'status' => 'Planned', 'employee_id' => 'emp_1', 'month_key' => '2026-10', 'amount' => '1.00'], '2026-10-07', 'cash', $key), 'a malformed execution id');
    },
    'Policy: an execution is authorized by the existing record-free finance.execute, CEO-only; ACTIONS stay 21; an Employee is 403 before any lookup' => static function () use ($principal, $unreachable, $body): void {
        assertSame(21, count(Action::cases()), 'ACTIONS stay 21 — no Finance execution Action (D-FEX-4 = A)');
        assertSame([null, 'finance.execute'], [Action::FinanceExecute->entity(), Action::FinanceExecute->value]);
        $ceo = $principal('ceo', null);
        $emp = $principal('employee', 'emp_1');
        assertTrue(!Policy::allows($emp, Action::FinanceExecute), 'an Employee never executes');
        assertTrue(Policy::allows($ceo, Action::FinanceExecute), 'the CEO');
        $service = new FinanceExecutionService($unreachable());
        foreach ([
            'month' => static fn () => $service->month($emp, '2026-10'),
            'execute' => static fn () => $service->execute($emp, ['executedOn' => '2000-01-01'] + $body, str_repeat('d', 32)),
        ] as $op => $fn) {
            $e = assertThrows(ApiError::class, $fn);
            assertSame(ErrorCode::Forbidden, $e->errorCode, 'an Employee ' . $op . ' is 403 before any lookup');
        }
        $e = assertThrows(ApiError::class, static fn () => $service->execute($ceo, ['financePostingId' => $body['financePostingId']], str_repeat('d', 32)));
        assertSame(ErrorCode::ValidationFailed, $e->errorCode, 'the body is validated before any lookup');
        $e = assertThrows(ApiError::class, static fn () => $service->execute($ceo, ['executedOn' => '9999-12-31'] + $body, str_repeat('d', 32)));
        assertSame([ErrorCode::ValidationFailed, ['executedOn']], [$e->errorCode, $e->fields], 'a future date is refused before any lookup, on the live company clock');
    },
    "the execution audit vocabulary: operation 'execute' on the posting (entity financePosting), under finance.execute only; no field, no value; the posting and source operation lists are unchanged" => static function () use ($db, $principal, $posting): void {
        assertSame('execute', AuditLog::EXECUTION_OPERATION);
        assertSame('post', AuditLog::POSTING_OPERATION, 'the posting operation is unchanged');
        assertTrue(!in_array('execute', AuditLog::PAYROLL_OPERATIONS, true) && !in_array('execute', AuditLog::SUPPLEMENTAL_OPERATIONS, true), 'Payroll and Supplemental never audit an execution');
        assertTrue(str_contains(AuditLog::APPEND_EXECUTION_SQL, ':operation, NULL, :request_id, NULL)'), 'no target user, no field list');
        $audit = new AuditLog($db());
        $ceo = $principal('ceo', null);
        $emp = $principal('employee', 'emp_1');
        $rid = str_repeat('d', 32);
        foreach ([
            'finance.manage' => [new Authorization(Action::FinanceManage, Scope::of($ceo), null), $posting],
            'payroll.manage' => [new Authorization(Action::PayrollManage, Scope::of($ceo), new ScopedRecord(Scope::of($ceo), 'payrollPlan', $posting, 'emp_1', 'Committed')), $posting],
            'supplemental.manage' => [new Authorization(Action::SupplementalManage, Scope::of($ceo), null), $posting],
            'a record-bearing finance.execute' => [new Authorization(Action::FinanceExecute, Scope::of($ceo), new ScopedRecord(Scope::of($ceo), 'financePosting', $posting, 'emp_1', 'Planned')), $posting],
            'an Employee scope' => [new Authorization(Action::FinanceExecute, Scope::of($emp), null), $posting],
            'a malformed posting id' => [new Authorization(Action::FinanceExecute, Scope::of($ceo), null), 'emp_1'],
        ] as $label => [$auth, $id]) {
            assertThrows(\LogicException::class, static fn () => $audit->appendExecution($auth, $auth->scope->isSelf() ? $emp : $ceo, $id, $rid), $label);
        }
        assertThrows(\LogicException::class, static fn () => $audit->appendPosting(new Authorization(Action::FinanceExecute, Scope::of($ceo), null), $ceo, $posting, $rid), 'a posting row is never written under finance.execute');
        $m35 = (string) file_get_contents(dirname(__DIR__, 2) . '/migrations/0035_replace_audit_events_finance_execute.sql');
        assertTrue(str_contains($m35, "WHEN 'finance.execute' THEN operation IS NOT NULL AND operation = 'execute'")
            && str_contains($m35, "(entity = 'financePosting') = (action = 'finance.execute')")
            && str_contains($m35, "WHEN 'payroll.manage' THEN operation IS NOT NULL AND operation IN ('create', 'recalculate', 'review', 'approve', 'return', 'cancel', 'commit', 'post')")
            && str_contains($m35, "WHEN 'supplemental.manage' THEN operation IS NOT NULL AND operation IN ('create', 'recalculate', 'review', 'approve', 'return', 'cancel', 'commit', 'post')")
            && !preg_match("/'(pay|paid|reverse|void|correct|refund|settle|reconcile|partial)'|finance\.manage/", $m35), "0035 admits 'execute' under finance.execute on financePosting only, keeps every rule, and adds no payment, reversal, correction or finance.manage vocabulary");
    },
];
