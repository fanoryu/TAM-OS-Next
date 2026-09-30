<?php
declare(strict_types=1);

use TamOs\Data\Scope\ScopedRecord;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Policy;
use TamOs\Policy\Rule;
use TamOs\Policy\Scope;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$principal = static function (string $role, ?string $employeeId, string $company = 'a'): Principal {
    $p = Principal::fromAccount(
        ['user_id' => str_repeat('1', 32), 'user_status' => 'active', 'has_password' => true],
        [['membership_id' => str_repeat('2', 32), 'company_id' => str_repeat($company, 32), 'role' => $role, 'employee_id' => $employeeId, 'membership_status' => 'active']],
    );
    return $p ?? throw new \LogicException('fixture principal');
};
$ceo = $principal('ceo', null);
$ceoBound = $principal('ceo', 'emp_ceo');
$emp = $principal('employee', 'emp_1');
$other = $principal('employee', 'emp_2');
$foreignCeo = $principal('ceo', null, 'b');
// Tests may build records directly; production code gets them only from ScopedDatabase.
$record = static fn (Principal $readBy, string $entity, ?string $owner, ?string $status = null, string $id = 'r1'): ScopedRecord
    => new ScopedRecord(Scope::of($readBy), $entity, $id, $owner, $status);

return [
    'CEO: every action is allowed with a record of its entity read in its own scope' => static function () use ($ceo, $ceoBound, $record): void {
        foreach ([$ceo, $ceoBound] as $p) {
            foreach (Action::cases() as $a) {
                $r = $a->entity() === null ? null : $record($p, $a->entity(), 'emp_x', 'Approved');
                assertTrue(Policy::allows($p, $a, $r), $a->value);
                $auth = Policy::authorize($p, $a, $r);
                assertTrue($auth instanceof Authorization && $auth->action === $a && $auth->scope->equals(Scope::of($p)) && $auth->record === $r, 'token ' . $a->value);
            }
        }
    },
    'Employee: every CeoOnly action is denied, even on their own in-scope record' => static function () use ($emp, $record): void {
        foreach (Action::cases() as $a) {
            if ($a->rule() !== Rule::CeoOnly) {
                continue;
            }
            $r = $a->entity() === null ? null : $record($emp, $a->entity(), 'emp_1', 'Draft', 'emp_1');
            assertSame(false, Policy::allows($emp, $a, $r), $a->value);
            $e = assertThrows(ApiError::class, static fn () => Policy::authorize($emp, $a, $r), $a->value);
            assertSame([ErrorCode::Forbidden, 'action_denied'], [$e->errorCode, $e->logReason]);
        }
    },
    'Employee: CeoOrOwnDraft allows only their own Draft' => static function () use ($emp, $record): void {
        foreach ([Action::OvertimeSubmitSelf, Action::OvertimeCreateSelfDraft, Action::OvertimeUpdateSelfDraft, Action::OvertimeDeleteSelfDraft] as $a) {
            assertTrue(Policy::allows($emp, $a, $record($emp, 'overtime', 'emp_1', 'Draft')), 'own draft ' . $a->value);
            foreach (['Submitted', 'Approved', 'Rejected', 'Committed to Payroll', 'draft', '', null] as $status) {
                assertSame(false, Policy::allows($emp, $a, $record($emp, 'overtime', 'emp_1', $status)), 'own ' . var_export($status, true) . ' ' . $a->value);
            }
            assertSame(false, Policy::allows($emp, $a, $record($emp, 'overtime', 'emp_2', 'Draft')), 'another owner');
            assertSame(false, Policy::allows($emp, $a, $record($emp, 'overtime', null, 'Draft')), 'no owner');
        }
    },
    'a record read under another scope never authorizes (server AZ-1)' => static function () use ($ceo, $emp, $other, $foreignCeo, $record): void {
        $a = Action::OvertimeUpdateSelfDraft;
        assertSame(false, Policy::allows($emp, $a, $record($ceo, 'overtime', 'emp_1', 'Draft')), 'read by the CEO, used by the Employee');
        assertSame(false, Policy::allows($emp, $a, $record($other, 'overtime', 'emp_1', 'Draft')), 'read under a colleague scope');
        assertSame(false, Policy::allows($ceo, $a, $record($foreignCeo, 'overtime', 'emp_1', 'Draft')), 'read in another company');
        assertSame(false, Policy::allows($ceo, Action::EmployeeUpdate, $record($emp, 'employee', 'emp_1', null, 'emp_1')), 'read under an Employee scope, used by the CEO');
    },
    'a record-bearing action needs a record of its own entity; a record-free action takes none' => static function () use ($ceo, $record): void {
        assertSame(false, Policy::allows($ceo, Action::EmployeeUpdate, null), 'missing record');
        assertSame(false, Policy::allows($ceo, Action::EmployeeUpdate, $record($ceo, 'contract', 'emp_1')), 'wrong entity');
        assertSame(false, Policy::allows($ceo, Action::OvertimeManage, $record($ceo, 'employee', 'emp_1')), 'wrong entity (overtime)');
        assertSame(false, Policy::allows($ceo, Action::SettingsManage, $record($ceo, 'employee', 'emp_1')), 'record on a record-free action');
        assertTrue(Policy::allows($ceo, Action::SettingsManage), 'record-free');
    },
    'an unknown action string cannot reach Policy' => static function (): void {
        $m = new \ReflectionMethod(Policy::class, 'authorize');
        assertSame(Action::class, (string) $m->getParameters()[1]->getType(), 'typed Action only');
        assertSame(null, Action::tryFrom('employee.read'));
    },
];
