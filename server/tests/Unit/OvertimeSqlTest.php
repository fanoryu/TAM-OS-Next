<?php
declare(strict_types=1);

/*
 * BF-4b1 overtime structure without a database: the D-BF4b-5 state machine, the strict view,
 * the store's statements (scope, self binding, compare-and-swap, the Draft-only delete), the
 * overtime audit vocabulary and the create candidate. Behaviour is proven against MariaDB in
 * tests/Db/Overtime*Test.php.
 *
 * BF-4b2 revisions (D-BF4b2-1 = A): the status vocabulary gains Approved, reached ONLY by the
 * separate approve transition (never a generic one) and never left; the record view keeps its
 * nine fields; only APPROVE_SQL and the valuation reads name the valuation columns; the audit
 * vocabulary gains 'approve' under overtime.manage.
 */

use TamOs\Data\Audit\AuditLog;
use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Data\Overtime\OvertimeStore;
use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Data\Scope\ScopedRecord;
use TamOs\Identity\Principal;
use TamOs\Overtime\OvertimeStatus;
use TamOs\Overtime\OvertimeView;
use TamOs\Policy\Action;
use TamOs\Policy\Policy;
use TamOs\Policy\Scope;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$db = static fn (): ScopedDatabase => new ScopedDatabase(new Database(DatabaseConfig::fromArray([
    'host' => '127.0.0.1', 'port' => 1, 'name' => 'tamos_test', 'user' => 'u', 'pass' => 'unreachable-by-design',
])));
$principal = static fn (string $role, ?string $employeeId): Principal => Principal::fromAccount(
    ['user_id' => str_repeat('1', 32), 'user_status' => 'active', 'has_password' => true],
    [['membership_id' => str_repeat('2', 32), 'company_id' => str_repeat('a', 32), 'role' => $role, 'employee_id' => $employeeId, 'membership_status' => 'active']],
) ?? throw new \LogicException('fixture');
$row = ['id' => str_repeat('b', 32), 'company_id' => str_repeat('a', 32), 'owner_employee_id' => 'emp_1', 'employee_id' => 'emp_1', 'month_key' => '2026-10',
    'overtime_date' => '2026-10-05', 'hours' => '7.50', 'work_description' => 'Fabricated', 'notes' => null, 'status' => 'Draft', 'version' => '3'];
$sqlOf = static function (): array {
    $out = [];
    foreach ((new \ReflectionClass(OvertimeStore::class))->getConstants() as $name => $value) {
        if (str_ends_with($name, '_SQL')) {
            $out[$name] = $value;
        }
    }
    return $out;
};

return [
    'the state machine is exactly D-BF4b-5 plus D-BF4b2-1: submit, review, reject generic; approve separate; Rejected and Approved terminal' => static function (): void {
        assertSame(['Draft', 'Submitted', 'Reviewed', 'Approved', 'Rejected'], OvertimeStatus::VALUES, 'the frontend status spellings, with Approved and without Committed to Payroll');
        assertSame(['Approved', 'Rejected'], OvertimeStatus::TERMINAL);
        assertSame(['approve', Action::OvertimeManage, 'Reviewed', 'Approved'], OvertimeStatus::APPROVE, 'approve: CEO, from Reviewed only');
        assertSame(['submit', 'review', 'reject'], array_keys(OvertimeStatus::TRANSITIONS), 'approve is not a generic transition');
        $table = [];
        foreach (array_keys(OvertimeStatus::TRANSITIONS) as $op) {
            foreach (OvertimeStatus::VALUES as $from) {
                $table[$op . ':' . $from] = OvertimeStatus::target($op, $from);
            }
        }
        assertSame([
            'submit:Draft' => 'Submitted', 'submit:Submitted' => null, 'submit:Reviewed' => null, 'submit:Approved' => null, 'submit:Rejected' => null,
            'review:Draft' => null, 'review:Submitted' => 'Reviewed', 'review:Reviewed' => null, 'review:Approved' => null, 'review:Rejected' => null,
            'reject:Draft' => null, 'reject:Submitted' => 'Rejected', 'reject:Reviewed' => 'Rejected', 'reject:Approved' => null, 'reject:Rejected' => null,
        ], $table);
        assertSame([Action::OvertimeSubmitSelf, Action::OvertimeManage, Action::OvertimeManage], array_map(OvertimeStatus::action(...), ['submit', 'review', 'reject']));
        assertThrows(\LogicException::class, static fn () => OvertimeStatus::action('approve'), 'no generic approve');
        foreach (OvertimeStatus::VALUES as $from) {
            foreach (array_keys(OvertimeStatus::TRANSITIONS) as $op) {
                assertTrue(OvertimeStatus::target($op, $from) !== OvertimeStatus::DRAFT, 'nothing returns to Draft');
                assertTrue(OvertimeStatus::target($op, $from) !== OvertimeStatus::APPROVED, 'no generic transition reaches Approved');
                if (in_array($from, OvertimeStatus::TERMINAL, true)) {
                    assertSame(null, OvertimeStatus::target($op, $from), $from . ' is terminal: ' . $op);
                }
            }
        }
    },
    'the view is exactly nine fields, one shape for CEO and Employee, with no money, names, company or timestamps (an Approved record too)' => static function () use ($row): void {
        $v = OvertimeView::record($row);
        assertSame(OvertimeView::FIELDS, array_keys($v));
        assertSame([str_repeat('b', 32), 'emp_1', '2026-10', '2026-10-05', '7.50', 'Fabricated', null, 'Draft', 3], array_values($v));
        foreach (['company', 'amount', 'rate', 'salary', 'schedule', 'contract', 'payroll', 'name', 'createdAt', 'updatedAt', 'actor', 'approved'] as $needle) {
            foreach (OvertimeView::FIELDS as $f) {
                assertTrue(stripos($f, $needle) === false, $f . ' carries no ' . $needle);
            }
        }
        $approved = OvertimeView::record(['status' => 'Approved', 'valuation_method' => 'TAM-OT-1', 'approved_amount' => '1.00'] + $row);
        assertSame(OvertimeView::FIELDS, array_keys($approved), 'an Approved record keeps the nine fields: no valuation in the record DTO');
        assertSame('Approved', $approved['status']);
        foreach ([['hours' => '7.5'], ['hours' => '0.00'], ['hours' => '7.33'], ['status' => 'Committed to Payroll'], ['status' => 'Paid']] as $bad) {
            assertThrows(\LogicException::class, static fn () => OvertimeView::record($bad + $row), json_encode($bad));
        }
        assertSame(['month_key' => '2026-10', 'overtime_date' => '2026-10-05', 'hours' => '7.50', 'work_description' => 'Fabricated', 'notes' => null], OvertimeView::columns($row));
    },
    'every statement names the company; every *_SELF_SQL binds the owner; reads project company and owner; only the valuation statements name money' => static function () use ($sqlOf): void {
        $valuation = ['APPROVE_SQL', 'VALUATION_SQL', 'VALUATION_SELF_SQL', 'VALUATION_EMPLOYEE_SQL', 'LOCK_VALUATION_EMPLOYEE_SQL'];
        foreach ($sqlOf() as $name => $sql) {
            assertTrue(str_contains($sql, ':company_id'), $name . ' names :company_id');
            if (str_ends_with($name, '_SELF_SQL')) {
                assertTrue(preg_match('/(employee_id|\bid) = :self_employee_id|VALUES \(:id, :company_id, :self_employee_id,/', $sql) === 1, $name . ' binds the owner');
            } else {
                assertTrue(!str_contains($sql, ':self_employee_id'), $name . ' is the company variant');
            }
            if (str_starts_with($sql, 'SELECT')) {
                assertTrue(str_contains($sql, 'company_id') && str_contains($sql, 'AS owner_employee_id'), $name . ' projects the scope columns');
            }
            if (!in_array($name, $valuation, true)) {
                assertTrue(!preg_match('/\b(amount|rate|salary|contract|payroll|approved)\b|valuation_|approved_|monthly_base_salary/i', $sql), $name . ' touches no money or payroll');
            }
            assertTrue(!preg_match('/payroll|payment|paid|finance|transaction|ledger|journal|Committed/i', $sql), $name . ' touches no payroll or finance');
        }
        foreach ($valuation as $name) {
            assertTrue(!str_contains(constant(OvertimeStore::class . '::' . $name), ':self_employee_id') || $name === 'VALUATION_SELF_SQL', $name . ': the salary and the approval are company scope only');
        }
        $writers = array_keys(array_filter($sqlOf(), static fn (string $s): bool => preg_match('/^(UPDATE|INSERT)\b/', $s) === 1 && preg_match('/valuation_|approved_|\'Approved\'/', $s) === 1));
        assertSame(['APPROVE_SQL'], $writers, 'APPROVE_SQL is the only writer of the valuation columns and of Approved');
        assertSame("UPDATE overtime_records SET status = 'Approved', valuation_method = :valuation_method, valuation_salary = :valuation_salary, valuation_standard_hours = :valuation_standard_hours, approved_amount = :approved_amount, approved_at = UTC_TIMESTAMP(6), version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Reviewed'",
            OvertimeStore::APPROVE_SQL, 'Reviewed → Approved, compare-and-swap, the database clock');
        assertTrue(str_ends_with(OvertimeStore::LOCK_VALUATION_EMPLOYEE_SQL, 'FOR UPDATE') && !str_contains(OvertimeStore::VALUATION_EMPLOYEE_SQL, 'FOR UPDATE'), 'approval locks the owner; the preview does not');
        assertTrue(str_contains(OvertimeStore::LOCK_SQL, 'FOR UPDATE') && str_contains(OvertimeStore::LOCK_SELF_SQL, 'FOR UPDATE') && str_contains(OvertimeStore::LOCK_EMPLOYEE_SQL, 'FOR UPDATE'), 'the locks');
        assertTrue(str_contains(OvertimeStore::MONTH_SQL, 'month_key = :month_key') && str_ends_with(OvertimeStore::MONTH_SQL, 'ORDER BY overtime_date DESC, id LIMIT 2001'), 'one month, deterministic, cap + 1');
    },
    'writes are compare-and-swap; a new record is a version 1 Draft; the only hard delete removes a Draft' => static function (): void {
        foreach (['CREATE_SQL', 'CREATE_SELF_SQL'] as $c) {
            assertTrue(str_contains(constant(OvertimeStore::class . '::' . $c), "'Draft', 1, UTC_TIMESTAMP(6)"), $c . ' writes a version 1 Draft');
        }
        foreach (['UPDATE_SQL', 'UPDATE_SELF_SQL', 'DELETE_DRAFT_SQL', 'DELETE_DRAFT_SELF_SQL'] as $c) {
            $sql = constant(OvertimeStore::class . '::' . $c);
            assertTrue(str_contains($sql, 'version = :expected_version') && str_contains($sql, "status = 'Draft'") && !str_contains($sql, ' OR '), $c . ' is a Draft-only compare-and-swap');
        }
        foreach (['TRANSITION_SQL', 'TRANSITION_SELF_SQL'] as $c) {
            $sql = constant(OvertimeStore::class . '::' . $c);
            assertTrue(str_contains($sql, 'version = :expected_version') && str_contains($sql, 'status = :from_status') && str_contains($sql, 'version = version + 1'), $c);
        }
        assertSame(2, count(array_filter([OvertimeStore::DELETE_DRAFT_SQL, OvertimeStore::DELETE_DRAFT_SELF_SQL], static fn (string $s): bool => str_starts_with($s, 'DELETE FROM overtime_records WHERE'))), 'two delete statements, both Draft-only');
    },
    'the overtime audit vocabulary: five existing Actions; submit, review, reject and approve name their Action' => static function (): void {
        assertSame([Action::OvertimeCreateSelfDraft, Action::OvertimeUpdateSelfDraft, Action::OvertimeDeleteSelfDraft, Action::OvertimeSubmitSelf, Action::OvertimeManage], AuditLog::OVERTIME_ACTIONS);
        assertSame(['submit' => Action::OvertimeSubmitSelf, 'review' => Action::OvertimeManage, 'reject' => Action::OvertimeManage, 'approve' => Action::OvertimeManage], AuditLog::OVERTIME_OPERATIONS);
        assertSame([Action::EmployeeCreate, Action::EmployeeUpdate, Action::EmployeeDelete], AuditLog::ACTIONS, 'the employee rows are unchanged');
        assertTrue(str_contains(AuditLog::APPEND_OVERTIME_SQL, ':operation, NULL, :request_id, :fields'), 'no target user on an overtime row');
        assertTrue(str_ends_with(AuditLog::APPEND_OVERTIME_SELF_SQL, ':operation, NULL, :request_id, :fields FROM DUAL WHERE :owner_employee_id = :self_employee_id'),
            'under an Employee scope the row is written only for the actor\'s own record');
    },
    'an overtime audit row is refused before any database work unless its operation matches its Action' => static function () use ($db, $principal): void {
        $ceo = $principal('ceo', null);
        $log = new AuditLog($db());
        $record = static fn (Principal $p): ScopedRecord => new ScopedRecord(Scope::of($p), 'overtime', str_repeat('c', 32), 'emp_1', 'Draft');
        $auth = static fn (Action $a): \TamOs\Policy\Authorization => Policy::authorize($ceo, $a, $record($ceo));
        $rid = str_repeat('d', 32);
        foreach ([
            'create with an operation' => [Action::OvertimeCreateSelfDraft, 'submit', []],
            'submit without its operation' => [Action::OvertimeSubmitSelf, null, []],
            'submit named review' => [Action::OvertimeSubmitSelf, 'review', []],
            'manage named submit' => [Action::OvertimeManage, 'submit', []],
            'manage without an operation' => [Action::OvertimeManage, null, []],
            'an unknown operation' => [Action::OvertimeManage, 'void', []],
            'submitSelf named approve' => [Action::OvertimeSubmitSelf, 'approve', []],
            'an approval naming fields' => [Action::OvertimeManage, 'approve', ['approvedAmount']],
            'a transition naming fields' => [Action::OvertimeManage, 'review', ['status']],
            'a delete naming fields' => [Action::OvertimeDeleteSelfDraft, null, ['hours']],
        ] as $label => [$a, $op, $fields]) {
            assertThrows(\LogicException::class, static fn () => $log->appendOvertime($auth($a), $ceo, $op, $fields, $rid), $label);
        }
        $emp = Policy::authorize($ceo, Action::EmployeeUpdate, new ScopedRecord(Scope::of($ceo), 'employee', 'emp_1', 'emp_1', null));
        assertThrows(\LogicException::class, static fn () => $log->appendOvertime($emp, $ceo, null, [], $rid), 'an employee Action');
    },
    'a create candidate is owned only by an employee record read in scope, with a new server id' => static function () use ($db, $principal): void {
        $p = $principal('employee', 'emp_1');
        $employee = new ScopedRecord(Scope::of($p), 'employee', 'emp_1', 'emp_1', null);
        $c = $db()->candidate($employee, 'overtime', str_repeat('e', 32), 'Draft');
        assertSame([true, 'overtime', str_repeat('e', 32), 'emp_1', 'Draft'], [$c->scope->equals(Scope::of($p)), $c->entity, $c->id, $c->ownerEmployeeId, $c->status]);
        assertTrue(Policy::allows($p, Action::OvertimeCreateSelfDraft, $c), 'an Employee may create their own Draft');
        foreach ([
            'an overtime owner' => [new ScopedRecord(Scope::of($p), 'overtime', str_repeat('f', 32), 'emp_1', 'Draft'), 'overtime', str_repeat('e', 32), 'Draft'],
            'an employee owned by another' => [new ScopedRecord(Scope::of($p), 'employee', 'emp_1', 'emp_2', null), 'overtime', str_repeat('e', 32), 'Draft'],
            'an employee candidate' => [$employee, 'employee', str_repeat('e', 32), 'Draft'],
            'a non-server id' => [$employee, 'overtime', 'emp_1', 'Draft'],
            'no status' => [$employee, 'overtime', str_repeat('e', 32), ''],
        ] as $label => [$owner, $entity, $id, $status]) {
            assertThrows(\LogicException::class, static fn () => $db()->candidate($owner, $entity, $id, $status), $label);
        }
        $colleague = $db()->candidate(new ScopedRecord(Scope::of($p), 'employee', 'emp_2', 'emp_2', null), 'overtime', str_repeat('e', 32), 'Draft');
        assertTrue(!Policy::allows($p, Action::OvertimeCreateSelfDraft, $colleague), 'never for a colleague');
    },
    'the store refuses a write under the wrong Action before any database work' => static function () use ($db, $principal): void {
        $ceo = $principal('ceo', null);
        $store = new OvertimeStore($db());
        $rec = new ScopedRecord(Scope::of($ceo), 'overtime', str_repeat('c', 32), 'emp_1', 'Draft');
        $record = ['month_key' => '2026-10', 'overtime_date' => null, 'hours' => '1.00', 'work_description' => null, 'notes' => null];
        assertThrows(\LogicException::class, static fn () => $store->update(Policy::authorize($ceo, Action::OvertimeManage, $rec), 1, $record), 'update under manage');
        assertThrows(\LogicException::class, static fn () => $store->deleteDraft(Policy::authorize($ceo, Action::OvertimeUpdateSelfDraft, $rec), 1), 'delete under update');
        assertThrows(\LogicException::class, static fn () => $store->transition(Policy::authorize($ceo, Action::OvertimeDeleteSelfDraft, $rec), 1, 'Draft', 'Submitted'), 'transition under delete');
        assertThrows(\LogicException::class, static fn () => $store->create(Policy::authorize($ceo, Action::OvertimeManage, $rec), $record), 'create under manage');
        assertThrows(\LogicException::class, static fn () => $store->update(Policy::authorize($ceo, Action::OvertimeUpdateSelfDraft, $rec), 1, ['hours' => '1.00'] + $record), 'record columns out of order');
        $valuation = ['method' => 'TAM-OT-1', 'salary' => '1.00', 'standardHours' => '160.00', 'hours' => '1.00', 'amount' => '0.00'];
        $reviewed = new ScopedRecord(Scope::of($ceo), 'overtime', str_repeat('c', 32), 'emp_1', 'Reviewed');
        assertThrows(\LogicException::class, static fn () => $store->approve(Policy::authorize($ceo, Action::OvertimeSubmitSelf, $reviewed), 1, $valuation), 'approve under submitSelf');
        assertThrows(\LogicException::class, static fn () => $store->lockValuationInputs(Policy::authorize($ceo, Action::OvertimeSubmitSelf, $reviewed)), 'owner lock under submitSelf');
        foreach ([['Reviewed', 'Approved'], ['Approved', 'Rejected'], ['Approved', 'Reviewed'], ['Approved', 'Draft']] as [$from, $to]) {
            assertThrows(\LogicException::class, static fn () => $store->transition(Policy::authorize($ceo, Action::OvertimeManage, $reviewed), 1, $from, $to), 'generic ' . $from . ' → ' . $to);
        }
    },
    'an Employee scope can never reach the approval or the salary statements, even with a forged Authorization path' => static function () use ($db, $principal): void {
        $emp = $principal('employee', 'emp_1');
        $store = new OvertimeStore($db());
        assertThrows(\LogicException::class, static fn () => $store->valuationInputs(Scope::of($emp), 'emp_1'), 'no salary read in self scope');
        $own = new ScopedRecord(Scope::of($emp), 'overtime', str_repeat('c', 32), 'emp_1', 'Draft');
        $auth = Policy::authorize($emp, Action::OvertimeUpdateSelfDraft, $own);
        assertThrows(\LogicException::class, static fn () => $store->approve($auth, 1, ['method' => 'TAM-OT-1', 'salary' => '1.00', 'standardHours' => '160.00', 'hours' => '1.00', 'amount' => '0.00']), 'no approval in self scope');
        assertThrows(\LogicException::class, static fn () => $store->lockValuationInputs($auth), 'no owner lock in self scope');
        assertTrue(!Policy::allows($emp, Action::OvertimeManage, new ScopedRecord(Scope::of($emp), 'overtime', str_repeat('c', 32), 'emp_1', 'Reviewed')), 'overtime.manage is CEO-only, own record or not');
    },
];
