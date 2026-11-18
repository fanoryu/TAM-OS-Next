<?php
declare(strict_types=1);

/*
 * AWP-01 (ADR-016) finance requests without a database: the one lifecycle (legal transitions,
 * terminal states, the Action each operation is authorized under, the audit operation it names), the
 * strict inputs (exact keys per kind, an Employee reimbursement body with no employee field, the shared
 * post / category / description / amount grammar of 0036, the document-date and paidOn rules of §6, the
 * closed payment-method list), Policy on the three reimbursement self actions (CeoOrOwnDraft), the
 * Employee 403s before any lookup, the store, audit and view guards, the pay order of §5 and the
 * "Approved, not paid" report line kept outside every total. Behaviour against MariaDB is
 * tests/Db/RequestWorkflowTest.php (NOT RUN until the disposable database is authorized).
 */

use TamOs\Data\Audit\AuditLog;
use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Data\Request\RequestStore;
use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Data\Scope\ScopedRecord;
use TamOs\Data\Transaction\TransactionStore;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Policy;
use TamOs\Policy\Rule;
use TamOs\Policy\Scope;
use TamOs\Report\FinancialReport;
use TamOs\Request\RequestInput;
use TamOs\Request\RequestService;
use TamOs\Request\RequestStatus;
use TamOs\Request\RequestView;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$config = static fn (): DatabaseConfig => DatabaseConfig::fromArray([
    'host' => '127.0.0.1', 'port' => 1, 'name' => 'tamos_test', 'user' => 'u', 'pass' => 'unreachable-by-design',
]);
$db = static fn (): ScopedDatabase => new ScopedDatabase(new Database($config()));
/** Business data over an unreachable, lazily connecting database: any statement would fail, so a 400 or 403 proves no lookup ran. */
$unreachable = static fn (): \TamOs\Data\BusinessData => \TamOs\Data\BusinessData::fromDatabase(new Database($config()));
$principal = static fn (string $role, ?string $employeeId): Principal => Principal::fromAccount(
    ['user_id' => str_repeat('1', 32), 'user_status' => 'active', 'has_password' => true],
    [['membership_id' => str_repeat('2', 32), 'company_id' => str_repeat('a', 32), 'role' => $role, 'employee_id' => $employeeId, 'membership_status' => 'active']],
) ?? throw new \LogicException('fixture');
$code = static function (callable $fn): array {
    try {
        $fn();
    } catch (ApiError $e) {
        return [$e->errorCode, $e->fields];
    }
    return [null, null];
};
$today = '2026-10-31';
$payment = ['kind' => 'paymentRequest', 'financialPost' => 'GA', 'category' => 'Operasional Rutin', 'description' => 'Fabricated office rent', 'amount' => '2500000.00', 'payee' => 'Fabricated Landlord', 'documentDate' => '2026-11-15', 'idempotencyKey' => str_repeat('e', 32)];
$reimb = ['kind' => 'reimbursement', 'employeeId' => 'emp_1', 'financialPost' => 'DRONE', 'category' => 'Perjalanan Dinas', 'description' => 'Fabricated taxi fare', 'amount' => '150000.00', 'documentDate' => '2026-10-30', 'idempotencyKey' => str_repeat('f', 32)];
$selfReimb = array_diff_key($reimb, ['employeeId' => true]);
$target = ['financeRequestId' => str_repeat('b', 32), 'expectedVersion' => 1];
$row = static fn (array $over = []): array => $over + [
    'id' => str_repeat('b', 32), 'kind' => 'reimbursement', 'owner_employee_id' => 'emp_1', 'financial_post' => 'GA', 'category' => 'Perjalanan Dinas',
    'description' => 'Fabricated taxi fare', 'amount' => '150000.00', 'payee' => null, 'document_date' => '2026-10-30', 'status' => 'Draft',
    'status_reason' => null, 'version' => 1, 'created_by_user_id' => str_repeat('1', 32), 'created_at' => '2026-10-30 01:00:00.000000',
    'updated_at' => '2026-10-30 01:00:00.000000', 'finance_transaction_id' => null, 'paid_on' => null, 'payment_method' => null,
    'paid_by_user_id' => null, 'paid_at' => null,
];
$src = static fn (string $rel): string => (string) file_get_contents(dirname(__DIR__, 2) . '/' . $rel);

return [
    'L1/L2 state side: the legal transitions are exactly ADR-016 §2; Paid, Rejected and Cancelled are terminal' => static function (): void {
        $legal = [
            'update' => ['Draft' => 'Draft'],
            'submit' => ['Draft' => 'Submitted'],
            'approve' => ['Submitted' => 'Approved'],
            'reject' => ['Submitted' => 'Rejected'],
            'cancel' => ['Draft' => 'Cancelled', 'Submitted' => 'Cancelled', 'Approved' => 'Cancelled'],
            'pay' => ['Approved' => 'Paid'],
        ];
        assertSame(['Draft', 'Submitted', 'Approved', 'Paid', 'Rejected', 'Cancelled'], RequestStatus::ALL);
        foreach (array_keys(RequestStatus::TRANSITIONS) as $op) {
            foreach (RequestStatus::ALL as $from) {
                assertSame($legal[$op][$from] ?? null, RequestStatus::target($op, $from), $op . ' from ' . $from);
            }
        }
        assertSame(array_keys($legal), array_keys(RequestStatus::TRANSITIONS), 'no other operation (no delete, return, reopen or partial payment)');
        foreach (['Paid', 'Rejected', 'Cancelled'] as $terminal) {
            assertTrue(RequestStatus::isTerminal($terminal), $terminal . ' is terminal');
            foreach (array_keys(RequestStatus::TRANSITIONS) as $op) {
                assertSame(null, RequestStatus::target($op, $terminal), 'no ' . $op . ' from ' . $terminal);
            }
        }
        foreach (['delete', 'return', 'reopen', 'void', 'refund', ''] as $op) {
            assertSame(null, RequestStatus::target($op, 'Draft'), 'unknown ' . var_export($op, true));
        }
        assertSame(null, RequestStatus::target('submit', 'draft'), 'statuses are exact');
    },
    'the Action of each operation: a reimbursement create, update and submit are its self actions; everything else finance.manage, pay finance.execute' => static function (): void {
        $expect = [
            'create' => [Action::FinanceManage, Action::ReimbursementCreateSelfDraft],
            'update' => [Action::FinanceManage, Action::ReimbursementUpdateSelfDraft],
            'submit' => [Action::FinanceManage, Action::ReimbursementSubmitSelf],
            'approve' => [Action::FinanceManage, Action::FinanceManage],
            'reject' => [Action::FinanceManage, Action::FinanceManage],
            'cancel' => [Action::FinanceManage, Action::FinanceManage],
            'pay' => [Action::FinanceExecute, Action::FinanceExecute],
        ];
        foreach ($expect as $op => [$pr, $re]) {
            assertSame($pr, RequestStatus::action($op, 'paymentRequest'), $op . ' payment request');
            assertSame($re, RequestStatus::action($op, 'reimbursement'), $op . ' reimbursement');
        }
        assertThrows(\LogicException::class, static fn () => RequestStatus::action('delete', 'reimbursement'));
        assertThrows(\LogicException::class, static fn () => RequestStatus::action('create', 'refund'));
        assertSame(null, RequestStatus::auditOperation('create', Action::ReimbursementCreateSelfDraft), 'a self draft names no operation (as overtime)');
        assertSame(null, RequestStatus::auditOperation('update', Action::ReimbursementUpdateSelfDraft));
        assertSame('submit', RequestStatus::auditOperation('submit', Action::ReimbursementSubmitSelf));
        assertSame('approve', RequestStatus::auditOperation('approve', Action::FinanceManage));
    },
    'A6: ACTIONS 24 — the three reimbursement self actions on the existing CeoOrOwnDraft rule, record-bearing on financeRequest; still two rules' => static function (): void {
        assertSame(24, count(Action::cases()));
        assertSame(2, count(Rule::cases()), 'no rule added');
        foreach ([Action::ReimbursementCreateSelfDraft, Action::ReimbursementUpdateSelfDraft, Action::ReimbursementSubmitSelf] as $a) {
            assertSame([Rule::CeoOrOwnDraft, 'financeRequest'], [$a->rule(), $a->entity()], $a->value);
        }
        assertSame(['reimbursement.createSelfDraft', 'reimbursement.updateSelfDraft', 'reimbursement.submitSelf'],
            array_values(array_map(static fn (Action $a): string => $a->value, array_filter(Action::cases(), static fn (Action $a): bool => str_starts_with($a->value, 'reimbursement.')))));
    },
    'Policy: an Employee may act on their OWN Draft reimbursement only; the CEO on any; finance.manage and finance.execute stay CEO only' => static function () use ($principal): void {
        $ceo = $principal('ceo', null);
        $emp = $principal('employee', 'emp_1');
        $rec = static fn (Principal $by, ?string $owner, ?string $status): ScopedRecord => new ScopedRecord(Scope::of($by), 'financeRequest', str_repeat('b', 32), $owner, $status);
        foreach ([Action::ReimbursementCreateSelfDraft, Action::ReimbursementUpdateSelfDraft, Action::ReimbursementSubmitSelf] as $a) {
            assertTrue(Policy::allows($emp, $a, $rec($emp, 'emp_1', 'Draft')), 'own Draft ' . $a->value);
            foreach (['Submitted', 'Approved', 'Paid', 'Rejected', 'Cancelled', 'draft', null] as $s) {
                assertSame(false, Policy::allows($emp, $a, $rec($emp, 'emp_1', $s)), 'own ' . var_export($s, true) . ' ' . $a->value . ' (A4)');
            }
            assertSame(false, Policy::allows($emp, $a, $rec($emp, 'emp_2', 'Draft')), 'another owner');
            assertSame(false, Policy::allows($emp, $a, $rec($emp, null, 'Draft')), 'a payment request (no owner)');
            assertSame(false, Policy::allows($emp, $a, $rec($ceo, 'emp_1', 'Draft')), 'a record read under another scope');
            assertSame(false, Policy::allows($emp, $a, new ScopedRecord(Scope::of($emp), 'overtime', 'x', 'emp_1', 'Draft')), 'another entity');
            assertSame(false, Policy::allows($emp, $a), 'no record');
            assertTrue(Policy::allows($ceo, $a, $rec($ceo, 'emp_1', 'Submitted')), 'the CEO ' . $a->value);
        }
        foreach ([Action::FinanceManage, Action::FinanceExecute] as $a) {
            assertSame([false, true], [Policy::allows($emp, $a), Policy::allows($ceo, $a)], $a->value);
        }
    },
    'create input: exact keys per kind; the payee only on a payment request; a CEO reimbursement names its employee; an Employee body never does (A3)' => static function () use ($code, $today, $payment, $reimb, $selfReimb): void {
        $p = RequestInput::create($payment, $today, false);
        assertSame(['paymentRequest', null, 'Fabricated Landlord'], [$p['kind'], $p['employeeId'], $p['payee']]);
        $r = RequestInput::create($reimb, $today, false);
        assertSame(['reimbursement', 'emp_1', null], [$r['kind'], $r['employeeId'], $r['payee']]);
        $s = RequestInput::create($selfReimb, $today, true);
        assertSame(['reimbursement', null, null], [$s['kind'], $s['employeeId'], $s['payee']], 'the owner comes from the session, never the body');
        assertSame([ErrorCode::ValidationFailed, ['employeeId']], $code(static fn () => RequestInput::create($reimb, $today, true)), 'A3: an Employee body with an employee field is 400');
        assertSame([ErrorCode::ValidationFailed, ['employeeId']], $code(static fn () => RequestInput::create($selfReimb + ['employeeId' => 'emp_2'], $today, true)), 'A3: naming another employee is 400 too');
        assertSame([ErrorCode::ValidationFailed, ['employeeId']], $code(static fn () => RequestInput::create($selfReimb, $today, false)), 'a CEO reimbursement names its employee');
        assertSame([ErrorCode::ValidationFailed, ['payee']], $code(static fn () => RequestInput::create($reimb + ['payee' => 'x'], $today, false)), 'a reimbursement has no payee');
        assertSame([ErrorCode::ValidationFailed, ['employeeId']], $code(static fn () => RequestInput::create($payment + ['employeeId' => 'emp_1'], $today, false)), 'a payment request has no employee');
        assertSame([ErrorCode::ValidationFailed, ['payee']], $code(static fn () => RequestInput::create(array_diff_key($payment, ['payee' => true]), $today, false)), 'a payment request needs its payee');
        foreach (['companyId', 'status', 'version', 'id', 'createdByUserId', 'ownerEmployeeId'] as $extra) {
            assertSame([ErrorCode::ValidationFailed, [$extra]], $code(static fn () => RequestInput::create($payment + [$extra => 'x'], $today, false)), 'unknown ' . $extra);
        }
        foreach ([null, '', 'Reimbursement', 'refund', 1] as $kind) {
            [$c, $f] = $code(static fn () => RequestInput::create(['kind' => $kind] + $payment, $today, false));
            assertTrue($c === ErrorCode::ValidationFailed && in_array('kind', $f, true), 'kind ' . var_export($kind, true));
        }
    },
    'M3 input side: the post, category, description and amount grammar of 0036; payroll categories refused; whole positive Rupiah only' => static function () use ($code, $today, $payment): void {
        foreach ([
            'financialPost' => [null, 'ga', 'NP & IP', 'HR', '', 3],
            'category' => [null, '', ' Rent', 'Rent ', 'Gaji', 'PAYROLL', 'salary', str_repeat('x', 65), 5],
            'description' => [null, '', ' x', str_repeat('x', 501), [], 1],
            'amount' => [null, '0.00', '-1.00', '1.50', '100', '1,000.00', 100, 1.0, '01.00', '1000000000000000.00'],
            'payee' => [null, '', ' x', str_repeat('x', 161), 1],
            'idempotencyKey' => [null, '', str_repeat('E', 32), str_repeat('e', 31), str_repeat('e', 33)],
        ] as $field => $values) {
            foreach ($values as $v) {
                assertSame([ErrorCode::ValidationFailed, [$field]], $code(static fn () => RequestInput::create([$field => $v] + $payment, $today, false)), $field . ' ' . var_export($v, true));
            }
        }
        assertTrue(RequestInput::isPositiveAmount('1.00') && RequestInput::isPositiveAmount('999999999999999.00') && !RequestInput::isPositiveAmount('0.00'), 'the amount bounds');
    },
    'dates (ADR-016 §6): a reimbursement document date is not after today; a payment request needed-by date is at most today + 366; neither before 1900' => static function () use ($code, $today, $payment, $reimb): void {
        assertSame('2027-11-01', RequestInput::neededByLimit($today));
        assertSame('2027-11-01', RequestInput::create(['documentDate' => '2027-11-01'] + $payment, $today, false)['documentDate'], 'today + 366 is allowed');
        assertSame('2026-10-31', RequestInput::create(['documentDate' => $today] + $reimb, $today, false)['documentDate'], 'today is allowed');
        foreach ([[$payment, '2027-11-02'], [$reimb, '2026-11-01'], [$payment, '1899-12-31'], [$reimb, '1899-12-31'], [$reimb, '2026-02-30'], [$reimb, '2026-10-30T00:00'], [$reimb, 20261030]] as [$body, $d]) {
            assertSame([ErrorCode::ValidationFailed, ['documentDate']], $code(static fn () => RequestInput::create(['documentDate' => $d] + $body, $today, false)), $body['kind'] . ' ' . var_export($d, true));
        }
        assertTrue(RequestInput::isDocumentDate('1900-01-01', 'reimbursement', $today), 'from 1900');
        assertSame([ErrorCode::ValidationFailed, ['documentDate']], $code(static fn () => RequestInput::applyUpdate('reimbursement', [], ['documentDate' => '2026-11-01'], $today)), 'an update obeys the same rule');
    },
    'update, transition, approve, reject, cancel and pay inputs: exact keys, a positive expectedVersion, a reason only on reject and cancel, a closed payment method, paidOn not after today' => static function () use ($code, $today, $target): void {
        assertSame([ErrorCode::ValidationFailed, RequestInput::FIELDS], $code(static fn () => RequestInput::update($target)), 'an empty patch names the fields');
        assertSame(['amount' => '1.00'], RequestInput::update($target + ['amount' => '1.00'])['patch']);
        foreach ([0, -1, '1', 1.0, null, 4294967296] as $v) {
            assertSame([ErrorCode::ValidationFailed, ['expectedVersion']], $code(static fn () => RequestInput::transition(['expectedVersion' => $v] + $target)), 'version ' . var_export($v, true));
        }
        foreach (['B' . str_repeat('b', 31), 'emp_1', '', null] as $v) {
            assertSame([ErrorCode::ValidationFailed, ['financeRequestId']], $code(static fn () => RequestInput::transition(['financeRequestId' => $v] + $target)), 'id ' . var_export($v, true));
        }
        assertSame([ErrorCode::ValidationFailed, ['reason']], $code(static fn () => RequestInput::transition($target + ['reason' => 'x'])), 'submit takes no reason');
        assertSame([ErrorCode::ValidationFailed, ['reason']], $code(static fn () => RequestInput::withReason($target)), 'reject and cancel need a reason');
        assertSame([ErrorCode::ValidationFailed, ['reason']], $code(static fn () => RequestInput::withReason($target + ['reason' => str_repeat('x', 201)])));
        assertSame([ErrorCode::ValidationFailed, ['expectedAmount']], $code(static fn () => RequestInput::approve($target + ['expectedAmount' => '0.00'])), 'approve names the amount it approves');
        $pay = $target + ['expectedAmount' => '150000.00', 'paidOn' => $today, 'paymentMethod' => 'bankTransfer', 'idempotencyKey' => str_repeat('c', 32)];
        assertSame($pay, RequestInput::pay($pay, $today));
        foreach (['paidOn' => ['2026-11-01', '1899-12-31', '2026-13-01', null], 'paymentMethod' => ['wire', 'Cash', '', null], 'expectedAmount' => ['1.5', '0.00', null], 'idempotencyKey' => ['x', null]] as $field => $values) {
            foreach ($values as $v) {
                assertSame([ErrorCode::ValidationFailed, [$field]], $code(static fn () => RequestInput::pay([$field => $v] + $pay, $today)), $field . ' ' . var_export($v, true));
            }
        }
        foreach (['partial', 'amount', 'financeTransactionId', 'note'] as $extra) {
            assertSame([ErrorCode::ValidationFailed, [$extra]], $code(static fn () => RequestInput::pay($pay + [$extra => '1'], $today)), 'no ' . $extra . ' on a payment (no partial payment)');
        }
        assertSame(['payee'], (static function () use ($code, $today): array { return $code(static fn () => RequestInput::applyUpdate('reimbursement', [], ['payee' => 'x'], $today))[1]; })(), 'a reimbursement never gains a payee');
        assertSame(['amount', 'payee'], RequestInput::changed(
            ['financialPost' => 'GA', 'category' => 'c', 'description' => 'd', 'amount' => '1.00', 'payee' => 'p', 'documentDate' => '2026-10-01'],
            ['financialPost' => 'GA', 'category' => 'c', 'description' => 'd', 'amount' => '2.00', 'payee' => 'q', 'documentDate' => '2026-10-01'],
        ), 'only the fields that differ, never their values');
    },
    'list and read inputs: the Phase 1 range rule, closed status and kind filters, a 32-hex id' => static function () use ($code): void {
        assertSame(['from' => '2026-10-01', 'to' => '2026-10-31', 'status' => 'Approved', 'kind' => null], RequestInput::list('2026-10-01', '2026-10-31', 'Approved', null));
        assertSame(ErrorCode::InvalidQuery, assertThrows(ApiError::class, static fn () => RequestInput::list('2026-10-01', '2026-10-31', 'approved', null))->errorCode);
        assertSame(ErrorCode::InvalidQuery, assertThrows(ApiError::class, static fn () => RequestInput::list('2026-10-01', '2026-10-31', null, 'refund'))->errorCode);
        assertThrows(ApiError::class, static fn () => RequestInput::list('2026-10-31', '2026-10-01', null, null));
        assertSame([ErrorCode::ValidationFailed, ['id']], $code(static fn () => RequestInput::id('emp_1')));
        assertSame(str_repeat('b', 32), RequestInput::id(str_repeat('b', 32)));
    },
    'A5: an Employee is 403 before any lookup for approve, reject, cancel, pay and a payment request; malformed input is 400 before any lookup' => static function () use ($principal, $unreachable, $code, $payment, $selfReimb, $target): void {
        $emp = $principal('employee', 'emp_1');
        $ceo = $principal('ceo', null);
        $service = new RequestService($unreachable());
        foreach ([
            'approve' => static fn () => $service->transition($emp, 'approve', $target + ['expectedAmount' => '1.00'], str_repeat('d', 32)),
            'reject' => static fn () => $service->transition($emp, 'reject', $target + ['reason' => 'x'], str_repeat('d', 32)),
            'cancel' => static fn () => $service->transition($emp, 'cancel', $target + ['reason' => 'x'], str_repeat('d', 32)),
            'pay' => static fn () => $service->pay($emp, $target + ['expectedAmount' => '1.00', 'paidOn' => '2026-01-01', 'paymentMethod' => 'cash', 'idempotencyKey' => str_repeat('c', 32)], str_repeat('d', 32)),
        ] as $op => $fn) {
            assertSame(ErrorCode::Forbidden, assertThrows(ApiError::class, $fn)->errorCode, 'an Employee ' . $op . ' is 403 before any lookup');
        }
        assertSame([ErrorCode::ValidationFailed, ['payee']], $code(static fn () => $service->create($emp, $selfReimb + ['payee' => 'x'], str_repeat('d', 32))), 'an Employee reimbursement with a payee is 400 before any lookup');
        assertSame([ErrorCode::ValidationFailed, ['employeeId']], $code(static fn () => $service->create($emp, $selfReimb + ['employeeId' => 'emp_1'], str_repeat('d', 32))), 'A3 before any lookup');
        $e = assertThrows(ApiError::class, static fn () => $service->create($emp, ['documentDate' => '2026-01-01'] + $payment, str_repeat('d', 32)));
        assertSame(ErrorCode::Forbidden, $e->errorCode, 'an Employee payment request is 403 before any lookup');
        foreach ([
            'update' => static fn () => $service->update($ceo, $target, str_repeat('d', 32)),
            'submit' => static fn () => $service->transition($ceo, 'submit', ['expectedVersion' => 0] + $target, str_repeat('d', 32)),
            'read' => static fn () => $service->read($ceo, 'nope'),
            'list' => static fn () => $service->list($ceo, '2026-10-01', '2026-10-31', 'paid', null),
        ] as $op => $fn) {
            assertTrue(in_array(assertThrows(ApiError::class, $fn)->errorCode, [ErrorCode::ValidationFailed, ErrorCode::InvalidQuery], true), $op . ' is 400 before any lookup');
        }
        assertThrows(\LogicException::class, static fn () => $service->transition($ceo, 'pay', $target, str_repeat('d', 32)));
    },
    'the store: the one writer of both tables, three INSERTs, compare-and-swap UPDATEs, no DELETE; its guards refuse the wrong Action, scope or record' => static function () use ($db, $principal): void {
        $sql = array_filter((new \ReflectionClass(RequestStore::class))->getConstants(), static fn ($v, $k): bool => is_string($v) && str_ends_with($k, '_SQL'), ARRAY_FILTER_USE_BOTH);
        assertSame(3, count(array_filter($sql, static fn (string $s): bool => str_starts_with($s, 'INSERT '))));
        foreach ($sql as $k => $s) {
            assertTrue(!preg_match('/\bDELETE\b|\bREPLACE\b|\bTRUNCATE\b|ON DUPLICATE|IGNORE/i', $s), $k . ' writes plainly and never deletes');
            if (str_starts_with($s, 'UPDATE ')) {
                assertTrue(str_contains($s, 'AND version = :expected_version AND status = '), $k . ' is a compare-and-swap');
                assertTrue(!str_contains($s, 'finance_request_payments'), $k . ' never updates a payment');
            }
        }
        $store = new RequestStore($db());
        $ceo = $principal('ceo', null);
        $emp = $principal('employee', 'emp_1');
        $own = new ScopedRecord(Scope::of($emp), 'financeRequest', str_repeat('b', 32), 'emp_1', 'Draft');
        $key = str_repeat('c', 32);
        foreach ([
            'an unrelated Action' => static fn () => $store->lock(new Authorization(Action::OvertimeManage, Scope::of($ceo), null), $key),
            'finance.manage against a record' => static fn () => $store->lock(new Authorization(Action::FinanceManage, Scope::of($ceo), $own), $key),
            'finance.manage in an Employee scope' => static fn () => $store->lock(new Authorization(Action::FinanceManage, Scope::of($emp), null), $key),
            'a record of another entity' => static fn () => $store->lock(new Authorization(Action::ReimbursementSubmitSelf, Scope::of($emp), new ScopedRecord(Scope::of($emp), 'overtime', 'x', 'emp_1', 'Draft')), $key),
            'a payment key holder under finance.manage' => static fn () => $store->paymentKeyHolder(new Authorization(Action::FinanceManage, Scope::of($ceo), null), $key),
            'a payment under a self action' => static fn () => $store->insertPayment(new Authorization(Action::ReimbursementSubmitSelf, Scope::of($emp), $own), $key, $key, $key, '2026-10-01', 'cash', '1.00', $key, $key),
            'an employee lock under finance.manage' => static fn () => $store->lockEmployee(new Authorization(Action::FinanceManage, Scope::of($ceo), null)),
            'an employee lock for an update' => static fn () => $store->lockEmployee(new Authorization(Action::ReimbursementUpdateSelfDraft, Scope::of($emp), $own)),
            'a reason on Approved' => static fn () => $store->transition(new Authorization(Action::FinanceManage, Scope::of($ceo), null), $key, 1, 'Submitted', 'Approved', 'x'),
            'no reason on Rejected' => static fn () => $store->transition(new Authorization(Action::FinanceManage, Scope::of($ceo), null), $key, 1, 'Submitted', 'Rejected', null),
            'an Employee payment request' => static fn () => $store->create(new Authorization(Action::ReimbursementCreateSelfDraft, Scope::of($emp), $own), $key, ['kind' => 'paymentRequest', 'financialPost' => 'GA', 'category' => 'c', 'description' => 'd', 'amount' => '1.00', 'payee' => 'p', 'documentDate' => '2026-10-01', 'idempotencyKey' => $key], $key),
            'a malformed id' => static fn () => $store->lock(new Authorization(Action::FinanceManage, Scope::of($ceo), null), 'emp_1'),
        ] as $label => $fn) {
            assertThrows(\LogicException::class, $fn, $label);
        }
        $employeeSql = array_filter($sql, static fn (string $s): bool => str_contains($s, 'FROM employees'));
        assertSame(['LOCK_EMPLOYEE_SQL', 'LOCK_EMPLOYEE_SELF_SQL'], array_keys($employeeSql), 'only the two employee locks read employees');
        foreach ($employeeSql as $k => $s) {
            assertTrue(str_contains($s, 'FROM employees WHERE id = :employee_id AND company_id = :company_id') && str_ends_with($s, ' FOR UPDATE'), $k . ' locks the employee by primary key only');
        }
    },
    'audit: finance request rows name financeRequest under an ADR-016 Action, a self draft names no operation, a transition no field; the paid expense row is finance.execute / create' => static function () use ($db, $principal): void {
        assertSame(['finance.manage' => ['create', 'update', 'submit', 'approve', 'reject', 'cancel'], 'finance.execute' => ['pay'], 'reimbursement.createSelfDraft' => [null], 'reimbursement.updateSelfDraft' => [null], 'reimbursement.submitSelf' => ['submit']], AuditLog::REQUEST_OPERATIONS);
        $audit = new AuditLog($db());
        $ceo = $principal('ceo', null);
        $emp = $principal('employee', 'emp_1');
        $id = str_repeat('b', 32);
        $rid = str_repeat('d', 32);
        $own = new ScopedRecord(Scope::of($emp), 'financeRequest', $id, 'emp_1', 'Draft');
        foreach ([
            'an unrelated Action' => [new Authorization(Action::PayrollManage, Scope::of($ceo), null), $ceo, 'approve', $id, []],
            'finance.manage paying' => [new Authorization(Action::FinanceManage, Scope::of($ceo), null), $ceo, 'pay', $id, []],
            'finance.execute approving' => [new Authorization(Action::FinanceExecute, Scope::of($ceo), null), $ceo, 'approve', $id, []],
            'a self draft submitting' => [new Authorization(Action::ReimbursementCreateSelfDraft, Scope::of($emp), $own), $emp, 'submit', $id, []],
            'a transition naming a field' => [new Authorization(Action::FinanceManage, Scope::of($ceo), null), $ceo, 'approve', $id, ['amount']],
            'another record' => [new Authorization(Action::ReimbursementSubmitSelf, Scope::of($emp), $own), $emp, 'submit', str_repeat('c', 32), []],
            'a self action without its record' => [new Authorization(Action::ReimbursementSubmitSelf, Scope::of($emp), null), $emp, 'submit', $id, []],
            'finance.manage in an Employee scope' => [new Authorization(Action::FinanceManage, Scope::of($emp), null), $emp, 'approve', $id, []],
            'a malformed id' => [new Authorization(Action::FinanceManage, Scope::of($ceo), null), $ceo, 'approve', 'req_1', []],
        ] as $label => [$auth, $actor, $op, $rec, $fields]) {
            assertThrows(\LogicException::class, static fn () => $audit->appendRequest($auth, $actor, $op, $rec, $fields, $rid), $label);
        }
        assertThrows(\LogicException::class, static fn () => $audit->appendPaidExpense(new Authorization(Action::FinanceManage, Scope::of($ceo), null), $ceo, $id, $rid), 'the paid expense row is finance.execute only');
        assertThrows(\LogicException::class, static fn () => $audit->appendPaidExpense(new Authorization(Action::FinanceExecute, Scope::of($ceo), null), $ceo, 'tx_1', $rid));
        assertTrue(str_contains(AuditLog::APPEND_REQUEST_SELF_SQL, 'WHERE :owner_employee_id = :self_employee_id'), 'an Employee row is written only for their own reimbursement');
    },
    'the view: strict — a known kind, post and status, an owner exactly on a reimbursement, a payment exactly when Paid; no company, key or version source leaks' => static function () use ($row): void {
        $v = RequestView::request($row());
        assertSame(['id', 'kind', 'employeeId', 'financialPost', 'category', 'description', 'amount', 'payee', 'documentDate', 'status', 'statusReason', 'version', 'createdByUserId', 'createdAt', 'updatedAt', 'payment'], array_keys($v));
        assertSame(['emp_1', null, 1, '2026-10-30T01:00:00.000000Z'], [$v['employeeId'], $v['payment'], $v['version'], $v['createdAt']]);
        $paid = RequestView::request($row(['status' => 'Paid', 'finance_transaction_id' => str_repeat('c', 32), 'paid_on' => '2026-10-31', 'payment_method' => 'cash', 'paid_by_user_id' => str_repeat('1', 32), 'paid_at' => '2026-10-31 02:00:00.000000']));
        assertSame(['financeTransactionId' => str_repeat('c', 32), 'paidOn' => '2026-10-31', 'paymentMethod' => 'cash', 'paidByUserId' => str_repeat('1', 32), 'paidAt' => '2026-10-31T02:00:00.000000Z'], $paid['payment']);
        foreach ([
            'Paid without a payment' => ['status' => 'Paid'],
            'a payment without Paid' => ['finance_transaction_id' => str_repeat('c', 32), 'paid_on' => '2026-10-31', 'payment_method' => 'cash', 'paid_by_user_id' => str_repeat('1', 32), 'paid_at' => '2026-10-31 02:00:00.000000'],
            'a reimbursement without an owner' => ['owner_employee_id' => null],
            'a payment request with an owner' => ['kind' => 'paymentRequest', 'payee' => 'p'],
            'an unknown post' => ['financial_post' => 'HR'],
            'an unknown status' => ['status' => 'Reviewed'],
            'a zero amount' => ['amount' => '0.00'],
        ] as $label => $over) {
            assertThrows(\LogicException::class, static fn () => RequestView::request($row($over)), $label);
        }
    },
    'pay (ADR-016 §5): lock → key → guards → expense → payment → Paid → two audit rows, in one READ COMMITTED transaction that never touches the employee; the expense is the request\'s, dated paidOn, with a server key' => static function () use ($src): void {
        $s = $src('src/Request/RequestService.php');
        $body = substr($s, strpos($s, 'public function pay('), strpos($s, 'private function authorized(') - strpos($s, 'public function pay('));
        $at = static fn (string $needle): int => strpos($body, $needle) === false ? -1 : (int) strpos($body, $needle);
        $order = ['Policy::authorize($actor, Action::FinanceExecute)', '$store->lock($auth, $id)', '$store->paymentKeyHolder(', "!== RequestStatus::APPROVED", "'finance_request_version'", "'finance_request_amount'", '->insertPaidExpense(', '$store->insertPayment(', 'RequestStatus::APPROVED, RequestStatus::PAID', "appendRequest(\$auth, \$actor, 'pay'", '->appendPaidExpense(', 'readCommitted: true'];
        $pos = array_map($at, $order);
        assertTrue(!in_array(-1, $pos, true), 'every step is present');
        $sorted = $pos;
        sort($sorted);
        assertSame($sorted, $pos, 'the steps run in the order of §5');
        assertTrue(!str_contains($body, 'employees()') && !str_contains($body, 'lockEmployee'), 'pay never reads or locks the employee (C4)');
        assertTrue(str_contains($body, "'transactionDate' => \$in['paidOn']") && str_contains($body, "'idempotencyKey' => bin2hex(random_bytes(16))") && str_contains($body, "'kind' => 'expense'"), 'the expense is dated paidOn with a server key');
        assertTrue(str_contains($s, "public function create(") && strpos($s, '$store->lockEmployee($auth)') < strpos($s, '$store->keyHolder($auth'), 'create locks the employee before anything else (C4 lock order)');
        $t = $src('src/Transaction/TransactionService.php');
        assertTrue(strpos($t, '->lock($auth') < strpos($t, '->linkedPayment(') && strpos($t, '->linkedPayment(') < strpos($t, '->insertVoid(') && str_contains($t, "'finance_linked'"), 'V1: a void reads the payment link under its lock and refuses with finance_linked');
        assertTrue(str_contains(TransactionStore::LINK_SQL, 'FROM finance_request_payments WHERE company_id = :company_id AND finance_transaction_id = :id'), 'the link is read by the unique transaction id');
        assertSame(4, substr_count($s, 'readCommitted: true'), 'create, update, transition and pay');
    },
    'the report (ADR-016 §6, P2/P3/P4 logic): Approved-not-paid is counted per post and in all, inside its documentDate range only, and never added to any total' => static function (): void {
        $range = ['from' => '2026-10-01', 'to' => '2026-10-31'];
        $txn = static fn (array $o): array => $o + ['id' => '1', 'kind' => 'expense', 'financial_post' => 'GA', 'amount' => '100.00', 'transaction_date' => '2026-10-07', 'void_id' => null];
        $txns = [$txn(['kind' => 'income', 'amount' => '1000000.00']), $txn(['id' => '2', 'amount' => '250000.00'])];
        $postings = [['month_key' => '2026-10', 'amount' => '3500000.00']];
        $executions = [['executed_on' => '2026-10-25', 'amount' => '3500000.00']];
        $approved = [
            ['financial_post' => 'GA', 'amount' => '150000.00', 'document_date' => '2026-10-01'],
            ['financial_post' => 'GA', 'amount' => '50000.00', 'document_date' => '2026-10-31'],
            ['financial_post' => 'DRONE', 'amount' => '1000000.00', 'document_date' => '2026-10-15'],
        ];
        $without = FinancialReport::build($range, $txns, $postings, $executions);
        $with = FinancialReport::build($range, $txns, $postings, $executions, $approved);
        foreach (['posts', 'general', 'voided', 'payroll', 'consolidated', 'from', 'to'] as $k) {
            assertSame($without[$k], $with[$k], 'P2: ' . $k . ' is unchanged by Approved-not-paid requests');
        }
        assertSame(['posts' => [
            ['code' => 'GA', 'amount' => '200000.00', 'count' => 2],
            ['code' => 'NPIP', 'amount' => '0.00', 'count' => 0],
            ['code' => 'TJB', 'amount' => '0.00', 'count' => 0],
            ['code' => 'DRONE', 'amount' => '1000000.00', 'count' => 1],
        ], 'amount' => '1200000.00', 'count' => 3], $with['approvedNotPaid']);
        assertSame(['posts' => [
            ['code' => 'GA', 'amount' => '0.00', 'count' => 0], ['code' => 'NPIP', 'amount' => '0.00', 'count' => 0],
            ['code' => 'TJB', 'amount' => '0.00', 'count' => 0], ['code' => 'DRONE', 'amount' => '0.00', 'count' => 0],
        ], 'amount' => '0.00', 'count' => 0], $without['approvedNotPaid'], 'P4: Phase 1-only data gives the Phase 1 figures and an empty line');
        // P1 logic: paying one request moves its amount from the line into one expense on paidOn.
        $afterPay = FinancialReport::build($range, array_merge($txns, [$txn(['id' => '3', 'financial_post' => 'DRONE', 'amount' => '1000000.00', 'transaction_date' => '2026-10-20'])]), $postings, $executions, array_slice($approved, 0, 2));
        assertSame(['1200000.00', '200000.00'], [$with['approvedNotPaid']['amount'], $afterPay['approvedNotPaid']['amount']]);
        assertSame('1250000.00', $afterPay['general']['expense'], 'counted once, as an expense');
        foreach ([
            'P3: before the range' => [['financial_post' => 'GA', 'amount' => '1.00', 'document_date' => '2026-09-30']],
            'P3: after the range' => [['financial_post' => 'GA', 'amount' => '1.00', 'document_date' => '2026-11-01']],
            'an unknown post' => [['financial_post' => 'HR', 'amount' => '1.00', 'document_date' => '2026-10-10']],
        ] as $label => $rows) {
            assertThrows(\LogicException::class, static fn () => FinancialReport::build($range, [], [], [], $rows), $label);
        }
        assertTrue(str_contains(\TamOs\Data\Report\FinancialReportStore::APPROVED_SQL, "status = 'Approved' AND document_date >= :from_date AND document_date <= :to_date ORDER BY id LIMIT 20001"), 'P3/P5: the Approved line reads its range, capped at REPORT_CAP + 1');
    },
    'M3 schema side: migrations 0039–0041 carry the ADR-016 CHECKs, the one-payment-per-request keys and the triple-set audit constraints' => static function () use ($src): void {
        $m39 = $src('migrations/0039_create_finance_requests.sql');
        foreach ([
            "financial_post IN ('GA', 'NPIP', 'TJB', 'DRONE')", 'amount DECIMAL(17,2) NOT NULL', 'UNIQUE KEY finance_requests_idempotency_key (company_id, idempotency_key)',
            "status IN ('Draft', 'Submitted', 'Approved', 'Paid', 'Rejected', 'Cancelled')", 'FOREIGN KEY (company_id, owner_employee_id) REFERENCES employees (company_id, id)',
        ] as $needle) {
            assertTrue(str_contains($m39, $needle), '0039: ' . $needle);
        }
        assertTrue(!preg_match('/CASCADE|SET NULL/i', $m39), '0039: no cascade');
        $m40 = $src('migrations/0040_create_finance_request_payments.sql');
        foreach (['(finance_request_id)', '(finance_transaction_id)', '(company_id, idempotency_key)', "payment_method IN ('cash', 'bankTransfer', 'qris', 'virtualAccount', 'creditCard', 'other')", 'REFERENCES finance_transactions (company_id, id)'] as $needle) {
            assertTrue(str_contains($m40, $needle), '0040: ' . $needle);
        }
        $m41 = $src('migrations/0041_replace_audit_events_finance_requests.sql');
        foreach (['DROP CONSTRAINT audit_events_action_v7', 'DROP CONSTRAINT audit_events_entity_v6', 'DROP CONSTRAINT audit_events_operation_v8', 'DROP CONSTRAINT audit_events_action_operation_v8',
            "(entity = 'financeRequest' AND operation = 'pay')", "(entity = 'financeTransaction' AND operation = 'create')", "WHEN 'reimbursement.submitSelf' THEN operation IS NOT NULL AND entity = 'financeRequest' AND operation = 'submit'"] as $needle) {
            assertTrue(str_contains($m41, $needle), '0041: ' . $needle);
        }
    },

    'B1 (B-ii): RequestService has no test seam — one BusinessData constructor parameter, no hook property, and the expense audit row is the last statement of the pay transaction' => static function (): void {
        $p = (new \ReflectionMethod(RequestService::class, '__construct'))->getParameters();
        assertSame(['data'], array_map(static fn (\ReflectionParameter $x): string => $x->getName(), $p));
        assertSame('TamOs\\Data\\BusinessData', (string) $p[0]->getType(), 'the BusinessData only');
        assertSame(['data'], array_map(static fn (\ReflectionProperty $x): string => $x->getName(), (new \ReflectionClass(RequestService::class))->getProperties()), 'no hook property');
        $src = (string) file_get_contents(dirname(__DIR__, 2) . '/src/Request/RequestService.php');
        assertTrue(!str_contains($src, 'beforePayCommit'), 'the removed hook is not named');
        // The COMMIT-boundary proxy (tests/Support/CommitFaultProxy.php) intercepts the COMMIT that follows the
        // expense audit row, so nothing may run between that row and the end of the transaction callback.
        $pay = substr($src, (int) strpos($src, 'public function pay('));
        $pay = substr($pay, 0, (int) strpos($pay, '}, readCommitted: true);'));
        assertTrue(str_ends_with(rtrim($pay), '$this->data->audit()->appendPaidExpense($auth, $actor, $transactionId, $requestId);'), 'the expense audit row ends the pay transaction callback');
        assertTrue(strpos($pay, "->appendRequest(\$auth, \$actor, 'pay'") < strpos($pay, '->appendPaidExpense('), 'the request audit row precedes it');
        $boot = (string) file_get_contents(dirname(__DIR__, 2) . '/src/bootstrap.php');
        assertTrue(str_contains($boot, 'new RequestService($business)'), 'production passes the BusinessData only');
    },
];
