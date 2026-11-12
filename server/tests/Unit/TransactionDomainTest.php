<?php
declare(strict_types=1);

/*
 * Phase 1 general transactions and the financial report without a database (D-INT-1, D-INT-2): the
 * four fixed Financial Posts (separate from the category), the strict create / void / range inputs
 * (exact allowlists, the payroll categories refused, a positive whole-Rupiah amount, a calendar date
 * not after today in the company calendar), the projection with its DERIVED status, the report
 * arithmetic (Financial Post lines, voided rows shown and never counted, payroll as a separate
 * unallocated line, the consolidated total counting payroll once, as paid), the store and audit
 * guards (the record-free finance.manage, company scope only, exactly two INSERTs and no UPDATE or
 * DELETE) and the READ COMMITTED pin. Behaviour is proven against MariaDB in tests/Db/Transaction*Test.php.
 */

use TamOs\Data\Audit\AuditLog;
use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Data\Report\FinancialReportStore;
use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Data\Scope\ScopedRecord;
use TamOs\Data\Transaction\TransactionStore;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Policy;
use TamOs\Policy\Scope;
use TamOs\Report\FinancialReport;
use TamOs\Report\FinancialReportService;
use TamOs\Transaction\FinancialPost;
use TamOs\Transaction\TransactionInput;
use TamOs\Transaction\TransactionService;
use TamOs\Transaction\TransactionView;
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
$body = ['kind' => 'expense', 'financialPost' => 'NPIP', 'category' => 'Operasional Rutin', 'description' => 'Fabricated office supplies', 'amount' => '150000.00', 'transactionDate' => '2026-10-07', 'idempotencyKey' => str_repeat('e', 32)];
$code = static function (callable $fn): array {
    try {
        $fn();
    } catch (ApiError $e) {
        return [$e->errorCode, $e->fields];
    }
    return [null, null];
};
$txnRow = static fn (array $over = []): array => $over + ['id' => str_repeat('b', 32), 'kind' => 'income', 'financial_post' => 'GA', 'amount' => '100.00', 'transaction_date' => '2026-10-07', 'void_id' => null];

return [
    'the four fixed Financial Posts: GA, NP & IP, TJB, Drone — the same closed list as migration 0036, separate from the category' => static function (): void {
        assertSame(['GA', 'NPIP', 'TJB', 'DRONE'], FinancialPost::codes());
        assertSame(['GA', 'NP & IP', 'TJB', 'Drone'], array_map(static fn (FinancialPost $p): string => $p->displayName(), FinancialPost::cases()));
        $m36 = (string) file_get_contents(dirname(__DIR__, 2) . '/migrations/0036_create_finance_transactions.sql');
        assertTrue(str_contains($m36, "CHECK (financial_post IN ('GA', 'NPIP', 'TJB', 'DRONE'))"), 'the database enforces the same list');
        assertTrue(str_contains($m36, 'category VARCHAR(64) NOT NULL') && str_contains($m36, 'financial_post VARCHAR(8)'), 'the category is its own column');
        foreach (['ga', 'NP & IP', 'Drone', 'HR', '', 'GA '] as $bad) {
            assertSame(null, FinancialPost::tryFrom($bad), var_export($bad, true));
        }
    },
    'create: exactly the seven keys, each validated — never coerced or trimmed; the payroll categories are refused' => static function () use ($body, $code): void {
        $today = '2026-10-31';
        assertSame($body, TransactionInput::create($body, $today));
        foreach (['companyId', 'createdByUserId', 'status', 'id', 'role'] as $extra) {
            assertSame([ErrorCode::ValidationFailed, [$extra]], $code(static fn () => TransactionInput::create($body + [$extra => 'x'], $today)), 'unknown ' . $extra);
        }
        foreach ([
            'kind' => [null, '', 'Income', 'transfer', 1],
            'financialPost' => [null, 'ga', 'NP & IP', 'HR', 3],
            'category' => [null, '', ' Rutin', 'Rutin ', "a\tb", str_repeat('x', 65), 'Gaji', 'GAJI', 'payroll', 'Salary', 12],
            'description' => [null, '', ' x', "line\nbreak", str_repeat('y', 501)],
            'amount' => [null, '0.00', '-1.00', '1', '1.5', '1.50', 150000, '01.00', '1000000000000000.00'],
            'transactionDate' => [null, '2026-02-30', '26-10-07', '2026-11-01', '1899-12-31', '2026-10-7'],
            'idempotencyKey' => [null, 'x', strtoupper(str_repeat('e', 32))],
        ] as $field => $bads) {
            foreach ($bads as $bad) {
                assertSame([ErrorCode::ValidationFailed, [$field]], $code(static fn () => TransactionInput::create([$field => $bad] + $body, $today)), $field . ' ' . var_export($bad, true));
            }
        }
        assertSame('Gajian Lembur', TransactionInput::create(['category' => 'Gajian Lembur'] + $body, $today)['category'], 'only the exact payroll words are refused');
        assertSame(str_repeat('é', 64), TransactionInput::create(['category' => str_repeat('é', 64)] + $body, $today)['category'], 'length counts characters, not bytes');
        assertSame('999999999999999.00', TransactionInput::create(['amount' => '999999999999999.00'] + $body, $today)['amount'], 'the largest DECIMAL(17,2) whole Rupiah');
    },
    'void: exactly { financeTransactionId, reason, idempotencyKey }; range: from <= to, both real dates, at most 366 days' => static function () use ($code): void {
        $v = ['financeTransactionId' => str_repeat('b', 32), 'reason' => 'Entered twice', 'idempotencyKey' => str_repeat('c', 32)];
        assertSame($v, TransactionInput::void($v));
        assertSame([ErrorCode::ValidationFailed, ['amount']], $code(static fn () => TransactionInput::void($v + ['amount' => '1.00'])), 'no amount on a void');
        foreach (['financeTransactionId' => ['emp_1', null], 'reason' => ['', ' x', str_repeat('r', 201), null], 'idempotencyKey' => ['x', null]] as $f => $bads) {
            foreach ($bads as $bad) {
                assertSame([ErrorCode::ValidationFailed, [$f]], $code(static fn () => TransactionInput::void([$f => $bad] + $v)), $f . ' ' . var_export($bad, true));
            }
        }
        assertSame(['from' => '2026-01-01', 'to' => '2026-12-31'], TransactionInput::range('2026-01-01', '2026-12-31'));
        assertSame(['from' => '2024-01-01', 'to' => '2024-12-31'], TransactionInput::range('2024-01-01', '2024-12-31'), 'a leap year is 366 days');
        foreach ([[null, '2026-01-01'], ['2026-01-01', null], ['2026-02-01', '2026-01-31'], ['2026-01-01', '2027-01-02'], ['1899-12-31', '1900-01-01'], ['2026-13-01', '2026-12-01']] as [$f, $t]) {
            assertSame([ErrorCode::InvalidQuery, []], $code(static fn () => TransactionInput::range($f, $t)), var_export([$f, $t], true));
        }
        assertSame('2026-10-08', TransactionInput::today(new \DateTimeImmutable('2026-10-07T17:00:00Z')), 'the company calendar is UTC+7');
    },
    'the projection: exactly the eleven fields, never the company or the key; the status is derived from the void' => static function (): void {
        $row = ['id' => str_repeat('b', 32), 'company_id' => str_repeat('a', 32), 'owner_employee_id' => null, 'kind' => 'expense', 'financial_post' => 'TJB', 'category' => 'Operasional', 'description' => 'Fabricated', 'amount' => '5000.00',
            'transaction_date' => '2026-10-07', 'created_by_user_id' => str_repeat('1', 32), 'created_at' => '2026-10-07 01:02:03.000004', 'void_id' => null, 'void_reason' => null, 'voided_by_user_id' => null, 'voided_at' => null];
        $out = TransactionView::transaction($row);
        assertSame(TransactionView::FIELDS, array_keys($out));
        assertSame(['Active', null, '2026-10-07T01:02:03.000004Z'], [$out['status'], $out['void'], $out['createdAt']]);
        $voided = TransactionView::transaction(['void_id' => str_repeat('c', 32), 'void_reason' => 'Duplicate', 'voided_by_user_id' => str_repeat('1', 32), 'voided_at' => '2026-10-08 00:00:00.000000'] + $row);
        assertSame(['Voided', ['reason' => 'Duplicate', 'voidedByUserId' => str_repeat('1', 32), 'voidedAt' => '2026-10-08T00:00:00.000000Z']], [$voided['status'], $voided['void']]);
        foreach (['kind' => 'transfer', 'financial_post' => 'HR', 'amount' => '0.00', 'transaction_date' => '2026-02-30'] as $k => $bad) {
            assertThrows(\LogicException::class, static fn () => TransactionView::transaction([$k => $bad] + $row), $k);
        }
    },
    'the report: per-post income, expense and net; voided rows shown, never counted; payroll a separate unallocated line; consolidated counts payroll once, as paid' => static function () use ($txnRow): void {
        $range = ['from' => '2026-10-01', 'to' => '2026-10-31'];
        $txns = [
            $txnRow(['id' => '1', 'kind' => 'income', 'financial_post' => 'GA', 'amount' => '1000000.00']),
            $txnRow(['id' => '2', 'kind' => 'expense', 'financial_post' => 'GA', 'amount' => '250000.00']),
            $txnRow(['id' => '3', 'kind' => 'expense', 'financial_post' => 'DRONE', 'amount' => '400000.00', 'transaction_date' => '2026-10-31']),
            $txnRow(['id' => '4', 'kind' => 'income', 'financial_post' => 'TJB', 'amount' => '999.00', 'void_id' => 'v', 'transaction_date' => '2026-10-01']),
        ];
        $postings = [['month_key' => '2026-10', 'amount' => '3500000.00'], ['month_key' => '2026-10', 'amount' => '21875.00']];
        $executions = [['executed_on' => '2026-10-25', 'amount' => '3500000.00']];
        $r = FinancialReport::build($range, $txns, $postings, $executions);
        assertSame([
            ['code' => 'GA', 'name' => 'GA', 'income' => '1000000.00', 'expense' => '250000.00', 'net' => '750000.00', 'count' => 2],
            ['code' => 'NPIP', 'name' => 'NP & IP', 'income' => '0.00', 'expense' => '0.00', 'net' => '0.00', 'count' => 0],
            ['code' => 'TJB', 'name' => 'TJB', 'income' => '0.00', 'expense' => '0.00', 'net' => '0.00', 'count' => 0],
            ['code' => 'DRONE', 'name' => 'Drone', 'income' => '0.00', 'expense' => '400000.00', 'net' => '-400000.00', 'count' => 1],
        ], $r['posts'], 'every post, in order, even with no rows; a voided row counts nowhere');
        assertSame(['income' => '1000000.00', 'expense' => '650000.00', 'net' => '350000.00', 'count' => 3], $r['general']);
        assertSame(['count' => 1, 'amount' => '999.00'], $r['voided']);
        assertSame(['posted' => ['amount' => '3521875.00', 'count' => 2, 'fromMonth' => '2026-10', 'toMonth' => '2026-10'], 'paid' => ['amount' => '3500000.00', 'count' => 1]], $r['payroll']);
        assertSame(['income' => '1000000.00', 'expense' => '4150000.00', 'net' => '-3150000.00'], $r['consolidated'], 'general expense + payroll paid; payroll posted is never added');
        $empty = FinancialReport::build($range, [], [], []);
        assertSame(['income' => '0.00', 'expense' => '0.00', 'net' => '0.00'], $empty['consolidated']);
        foreach ([
            'a row dated outside the range' => [[$txnRow(['transaction_date' => '2026-11-01'])], [], []],
            'an unknown post' => [[$txnRow(['financial_post' => 'HR'])], [], []],
            'a zero amount' => [[$txnRow(['amount' => '0.00'])], [], []],
            'a posting of another month' => [[], [['month_key' => '2026-09', 'amount' => '1.00']], []],
            'an execution dated outside the range' => [[], [], [['executed_on' => '2026-11-01', 'amount' => '1.00']]],
        ] as $label => [$t, $p, $e]) {
            assertThrows(\LogicException::class, static fn () => FinancialReport::build($range, $t, $p, $e), $label);
        }
        assertThrows(\LogicException::class, static fn () => FinancialReport::build($range, array_fill(0, 10000, $txnRow(['amount' => '999999999999999.00'])), [], []), 'a total beyond the integer range is a defect, never a wrapped number');
    },
    'the stores: company scope only, the record-free finance.manage only, exactly two INSERTs and no UPDATE or DELETE; the report store only reads' => static function () use ($db, $principal): void {
        $store = new TransactionStore($db());
        $ceo = $principal('ceo', null);
        $emp = $principal('employee', 'emp_1');
        $id = str_repeat('b', 32);
        foreach ([static fn () => $store->range(Scope::of($emp), '2026-10-01', '2026-10-31'), static fn () => $store->record(Scope::of($emp), $id)] as $i => $fn) {
            assertSame('general transaction reads are company scope only', assertThrows(\LogicException::class, $fn, 'company scope ' . $i)->getMessage());
        }
        foreach ([
            'finance.execute' => new Authorization(Action::FinanceExecute, Scope::of($ceo), null),
            'payroll.manage' => new Authorization(Action::PayrollManage, Scope::of($ceo), new ScopedRecord(Scope::of($ceo), 'payrollPlan', $id, 'emp_1', 'Committed')),
            'an Employee scope' => new Authorization(Action::FinanceManage, Scope::of($emp), null),
        ] as $label => $bad) {
            assertSame('a general transaction write needs finance.manage, in company scope', assertThrows(\LogicException::class, static fn () => $store->lock($bad, $id), $label)->getMessage());
            assertThrows(\LogicException::class, static fn () => $store->keyHolder($bad, $id), $label . ' key');
            assertThrows(\LogicException::class, static fn () => $store->insertVoid($bad, $id, $id, 'r', $id, $id), $label . ' void');
        }
        $sql = [];
        foreach ((new \ReflectionClass(TransactionStore::class))->getConstants() as $name => $value) {
            if (str_ends_with($name, '_SQL')) {
                $sql[$name] = $value;
            }
        }
        assertSame(2, count(array_filter($sql, static fn (string $s): bool => str_starts_with($s, 'INSERT '))), 'exactly two INSERTs');
        foreach ($sql as $name => $s) {
            assertTrue(!preg_match('/^(UPDATE|DELETE|REPLACE)\b|TRUNCATE|:self_employee_id|\bSUM\s*\(/i', $s), $name . ': no update, delete, Employee scope or SQL money');
        }
        foreach ((new \ReflectionClass(FinancialReportStore::class))->getConstants() as $name => $value) {
            if (str_ends_with($name, '_SQL')) {
                assertTrue(str_starts_with($value, 'SELECT ') && !preg_match('/FOR UPDATE|LOCK IN SHARE|\bSUM\s*\(|:self_employee_id/i', $value), $name . ': a plain company-scope SELECT');
            }
        }
        assertSame('financial report reads are company scope only', assertThrows(\LogicException::class, static fn () => (new FinancialReportStore($db()))->transactions(Scope::of($emp), '2026-10-01', '2026-10-31'))->getMessage());
    },
    'Policy and audit: both writes are the existing record-free finance.manage (CeoOnly; ACTIONS stay 21); an Employee is 403 before any lookup; audit names create or void on financeTransaction, no field' => static function () use ($principal, $unreachable, $body, $db): void {
        assertSame(21, count(Action::cases()), 'ACTIONS stay 21');
        assertSame([null, 'finance.manage'], [Action::FinanceManage->entity(), Action::FinanceManage->value]);
        $ceo = $principal('ceo', null);
        $emp = $principal('employee', 'emp_1');
        assertTrue(!Policy::allows($emp, Action::FinanceManage) && Policy::allows($ceo, Action::FinanceManage), 'the CEO only');
        $service = new TransactionService($unreachable());
        $report = new FinancialReportService($unreachable());
        foreach ([
            'range' => static fn () => $service->range($emp, '2026-10-01', '2026-10-31'),
            'create' => static fn () => $service->create($emp, ['transactionDate' => '2000-01-01'] + $body, str_repeat('d', 32)),
            'void' => static fn () => $service->void($emp, ['financeTransactionId' => str_repeat('b', 32), 'reason' => 'x', 'idempotencyKey' => str_repeat('c', 32)], str_repeat('d', 32)),
            'report' => static fn () => $report->report($emp, '2026-10-01', '2026-10-31'),
        ] as $op => $fn) {
            assertSame(ErrorCode::Forbidden, assertThrows(ApiError::class, $fn)->errorCode, 'an Employee ' . $op . ' is 403 before any lookup');
        }
        assertSame([ErrorCode::ValidationFailed, ['transactionDate']], (static function () use ($service, $ceo, $body): array {
            $e = assertThrows(ApiError::class, static fn () => $service->create($ceo, ['transactionDate' => '9999-12-31'] + $body, str_repeat('d', 32)));
            return [$e->errorCode, $e->fields];
        })(), 'a future date is refused before any lookup, on the live company clock');
        assertSame(['create', 'void'], AuditLog::TRANSACTION_OPERATIONS);
        assertTrue(str_contains(AuditLog::APPEND_TRANSACTION_SQL, ':operation, NULL, :request_id, NULL)'), 'no target user, no field list');
        $audit = new AuditLog($db());
        $id = str_repeat('b', 32);
        $rid = str_repeat('d', 32);
        foreach ([
            'finance.execute' => [new Authorization(Action::FinanceExecute, Scope::of($ceo), null), 'create', $id],
            'an Employee scope' => [new Authorization(Action::FinanceManage, Scope::of($emp), null), 'create', $id],
            'an unknown operation' => [new Authorization(Action::FinanceManage, Scope::of($ceo), null), 'update', $id],
            'a malformed id' => [new Authorization(Action::FinanceManage, Scope::of($ceo), null), 'void', 'emp_1'],
        ] as $label => [$auth, $op, $tid]) {
            assertThrows(\LogicException::class, static fn () => $audit->appendTransaction($auth, $auth->scope->isSelf() ? $emp : $ceo, $op, $tid, $rid), $label);
        }
        $m38 = (string) file_get_contents(dirname(__DIR__, 2) . '/migrations/0038_replace_audit_events_finance_manage.sql');
        assertTrue(str_contains($m38, "WHEN 'finance.manage' THEN operation IS NOT NULL AND operation IN ('create', 'void')")
            && str_contains($m38, "(entity = 'financeTransaction') = (action = 'finance.manage')")
            && str_contains($m38, "WHEN 'finance.execute' THEN operation IS NOT NULL AND operation = 'execute'"), '0038 adds create/void under finance.manage on financeTransaction and keeps every rule');
        $src = (string) file_get_contents(dirname(__DIR__, 2) . '/src/Transaction/TransactionService.php');
        assertSame(2, substr_count($src, 'readCommitted: true'), 'create and void are the two commit-class transactions');
        assertTrue(!preg_match('/->\s*(finance|financeExecutions|payroll|supplemental|overtime|employees)\s*\(\s*\)/', $src), 'a general transaction never calls a payroll, posting, execution, overtime or employee store');
    },
];
