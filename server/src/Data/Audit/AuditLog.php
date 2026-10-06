<?php
declare(strict_types=1);

namespace TamOs\Data\Audit;

use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Identity\Principal;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Scope;

/**
 * The append-only business audit trail (SDR-0002 §9.2, migration 0017). One row per business
 * mutation, written by the same transaction as the mutation. This class is the only writer of
 * audit_events and it only inserts: no statement here, or anywhere, updates or deletes an audit
 * row (tools/verify-backend-boundary.js).
 *
 * The company comes from the Authorization's scope, the actor (user and membership) from the
 * session principal, the time from the database clock — never from a browser. A row names the
 * Action, the entity and its id, and the changed FIELD NAMES only: never a value, a password,
 * a token or a request body. Under a record-bearing Authorization the entity id must be the
 * authorized record (ScopedDatabase::execute checks :id).
 *
 * BF-4a2 (SDR-0004, migration 0019): account administration is authorized by one Action,
 * account.manage, but each row names its OPERATION — provision, reissue, disable or enable — and
 * the target user, so the four are never indistinguishable. Those rows carry no field list and
 * never an email, a password, a token or a hash; employee rows carry no operation.
 *
 * BF-4b1 (migration 0021): overtime rows name the overtime Action and the record id; a status
 * transition also names its operation (submit, review, reject). The audit row of a hard-deleted
 * Draft survives the record: audit_events has no foreign key to overtime_records.
 *
 * BF-4b2 (migration 0023): the approval is overtime.manage with operation 'approve'. Like every
 * transition it names no field and carries no value — never the salary or the amount; the
 * Approved row's immutable snapshot is the valuation evidence.
 *
 * BF-4c1 (migration 0026): a payroll plan row is payroll.manage against entity payrollPlan and
 * always names its operation — create or recalculate (generate), review, approve, return or
 * cancel. It names no field and carries no value — never the salary, an overtime amount or the
 * total; the plan row's own snapshot is the evidence. CEO company scope only.
 *
 * BF-4c2 (migration 0028): Commit is payroll.manage with operation 'commit' — one row per plan,
 * written with the commit; an idempotent replay writes none. No new Action (ACTIONS stay 21).
 *
 * BF-4d (migration 0031): a Supplemental Payroll row is supplemental.manage against entity
 * supplementalPayroll and always names its operation — create or recalculate (generate), review,
 * approve, return, cancel or commit, the Payroll vocabulary. supplemental.manage is record-free, so
 * the row names the document by its id rather than through an authorized record. It names no field
 * and carries no value — never an overtime amount or the total; the document row is the evidence.
 * CEO company scope only. A no-op generate and an idempotent commit replay write none. No new
 * Action (ACTIONS stay 21).
 *
 * BF-4e (migration 0033): a Finance posting is audited on its SOURCE, under the Action of the source
 * domain (D-FIN-2 = A) — payroll.manage against the base plan (entity payrollPlan) or the
 * record-free supplemental.manage for the Supplemental document (entity supplementalPayroll) — with
 * operation 'post'. It names no field and carries no value — never the amount; the posting row is
 * the evidence. CEO company scope only. An idempotent replay writes none. No new Action.
 */
final class AuditLog
{
    /** The Actions append() audits. A new audited Action extends this list and the action CHECK (0017, 0019). */
    public const ACTIONS = [Action::EmployeeCreate, Action::EmployeeUpdate, Action::EmployeeDelete];
    /** BF-4a2: the account.manage operations appendAccount() audits (migration 0019's CHECK). */
    public const ACCOUNT_OPERATIONS = ['provision', 'reissue', 'disable', 'enable'];
    public const ENTITIES = ['employee'];
    /** BF-4b1: the overtime Actions appendOvertime() audits, and the operation each transition names (0021). */
    public const OVERTIME_ACTIONS = [Action::OvertimeCreateSelfDraft, Action::OvertimeUpdateSelfDraft, Action::OvertimeDeleteSelfDraft, Action::OvertimeSubmitSelf, Action::OvertimeManage];
    public const OVERTIME_OPERATIONS = ['submit' => Action::OvertimeSubmitSelf, 'review' => Action::OvertimeManage, 'reject' => Action::OvertimeManage, 'approve' => Action::OvertimeManage];
    /** BF-4c1 + BF-4c2: the payroll.manage operations appendPayroll() audits (migration 0028's CHECK). */
    public const PAYROLL_OPERATIONS = ['create', 'recalculate', 'review', 'approve', 'return', 'cancel', 'commit'];
    /** BF-4d: the supplemental.manage operations appendSupplemental() audits (migration 0031's CHECK). */
    public const SUPPLEMENTAL_OPERATIONS = ['create', 'recalculate', 'review', 'approve', 'return', 'cancel', 'commit'];
    /** BF-4e: the one operation appendPosting() audits, under payroll.manage or supplemental.manage (migration 0033's CHECK). */
    public const POSTING_OPERATION = 'post';
    public const FIELD_PATTERN = '/^[a-z][A-Za-z]{0,31}$/';

    public const APPEND_SQL = 'INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, target_user_id, request_id, fields) VALUES (:company_id, UTC_TIMESTAMP(6), :actor_user_id, :actor_membership_id, :action, :entity, :id, NULL, :request_id, :fields)';
    public const APPEND_OVERTIME_SQL = 'INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (:company_id, UTC_TIMESTAMP(6), :actor_user_id, :actor_membership_id, :action, :entity, :id, :operation, NULL, :request_id, :fields)';
    /** BF-4b1: the first audited Employee-principal writes. Under a self scope the row is written only for the actor's own record. */
    public const APPEND_OVERTIME_SELF_SQL = 'INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) SELECT :company_id, UTC_TIMESTAMP(6), :actor_user_id, :actor_membership_id, :action, :entity, :id, :operation, NULL, :request_id, :fields FROM DUAL WHERE :owner_employee_id = :self_employee_id';
    public const APPEND_PAYROLL_SQL = 'INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (:company_id, UTC_TIMESTAMP(6), :actor_user_id, :actor_membership_id, :action, :entity, :id, :operation, NULL, :request_id, NULL)';
    public const APPEND_SUPPLEMENTAL_SQL = 'INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (:company_id, UTC_TIMESTAMP(6), :actor_user_id, :actor_membership_id, :action, :entity, :id, :operation, NULL, :request_id, NULL)';
    public const APPEND_POSTING_SQL = 'INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (:company_id, UTC_TIMESTAMP(6), :actor_user_id, :actor_membership_id, :action, :entity, :id, :operation, NULL, :request_id, NULL)';
    public const APPEND_ACCOUNT_SQL ='INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (:company_id, UTC_TIMESTAMP(6), :actor_user_id, :actor_membership_id, :action, :entity, :id, :operation, :target_user_id, :request_id, NULL)';

    public function __construct(private readonly ScopedDatabase $db)
    {
    }

    /**
     * Appends one audit row. Must run inside the transaction of the mutation it records.
     *
     * @param list<string> $fields changed field names (camelCase), never values
     */
    public function append(Authorization $auth, Principal $actor, string $entity, string $entityId, array $fields, string $requestId): void
    {
        if (!in_array($auth->action, self::ACTIONS, true)) {
            throw new \LogicException('this Action is not audited here');
        }
        if (!in_array($entity, self::ENTITIES, true) || $entityId === '') {
            throw new \LogicException('unknown audit entity');
        }
        self::requireActor($auth, $actor, $requestId);
        $this->db->execute($auth, self::APPEND_SQL, [
            'actor_user_id' => $actor->userId,
            'actor_membership_id' => $actor->membershipId,
            'action' => $auth->action->value,
            'entity' => $entity,
            'id' => $entityId,
            'request_id' => $requestId,
            'fields' => self::fieldList($fields),
        ]);
    }

    /**
     * BF-4a2: appends one account.manage row for the Employee record the Authorization was decided
     * on, naming the operation and the target user. Must run inside the transaction of the change.
     */
    public function appendAccount(Authorization $auth, Principal $actor, string $operation, string $targetUserId, string $requestId): void
    {
        if ($auth->action !== Action::AccountManage || $auth->record === null) {
            throw new \LogicException('an account audit row is written only under account.manage, against its record');
        }
        if (!in_array($operation, self::ACCOUNT_OPERATIONS, true)) {
            throw new \LogicException('unknown account operation');
        }
        if (preg_match('/^[0-9a-f]{32}$/', $targetUserId) !== 1) {
            throw new \LogicException('an account audit row names its target user');
        }
        self::requireActor($auth, $actor, $requestId);
        $this->db->execute($auth, self::APPEND_ACCOUNT_SQL, [
            'actor_user_id' => $actor->userId,
            'actor_membership_id' => $actor->membershipId,
            'action' => $auth->action->value,
            'entity' => $auth->record->entity,
            'id' => $auth->record->id,
            'operation' => $operation,
            'target_user_id' => $targetUserId,
            'request_id' => $requestId,
        ]);
    }

    /**
     * BF-4b1: appends one overtime row for the record the Authorization was decided on — the
     * create candidate included, so the row of a later hard delete still names its record. A
     * create or update names its field names; a transition names its operation (submit, review,
     * reject) and no field; a delete names neither. Must run inside the transaction of the change.
     *
     * @param list<string> $fields changed field names (camelCase), never values
     */
    public function appendOvertime(Authorization $auth, Principal $actor, ?string $operation, array $fields, string $requestId): void
    {
        if (!in_array($auth->action, self::OVERTIME_ACTIONS, true) || $auth->record === null || $auth->record->entity !== 'overtime') {
            throw new \LogicException('an overtime audit row is written only under an overtime Action, against its record');
        }
        $expected = array_search($auth->action, self::OVERTIME_OPERATIONS, true);
        if ($operation !== null ? (self::OVERTIME_OPERATIONS[$operation] ?? null) !== $auth->action : $expected !== false) {
            throw new \LogicException('an overtime transition names its operation, and only a transition does');
        }
        if (($operation !== null || $auth->action === Action::OvertimeDeleteSelfDraft) && $fields !== []) {
            throw new \LogicException('an overtime transition or delete names no field');
        }
        self::requireActor($auth, $actor, $requestId);
        $params = [
            'actor_user_id' => $actor->userId,
            'actor_membership_id' => $actor->membershipId,
            'action' => $auth->action->value,
            'entity' => $auth->record->entity,
            'id' => $auth->record->id,
            'operation' => $operation,
            'request_id' => $requestId,
            'fields' => self::fieldList($fields),
        ];
        if (!$auth->scope->isSelf()) {
            $this->db->execute($auth, self::APPEND_OVERTIME_SQL, $params);
            return;
        }
        if ($this->db->execute($auth, self::APPEND_OVERTIME_SELF_SQL, $params + ['owner_employee_id' => (string) $auth->record->ownerEmployeeId]) !== 1) {
            throw new \LogicException('an Employee overtime audit row is written only for their own record');
        }
    }

    /**
     * BF-4c1: appends one payroll.manage row for the plan the Authorization was decided on — the
     * create candidate included — naming the operation and no field. Must run inside the
     * transaction of the change.
     */
    public function appendPayroll(Authorization $auth, Principal $actor, string $operation, string $requestId): void
    {
        if ($auth->action !== Action::PayrollManage || $auth->record === null || $auth->record->entity !== 'payrollPlan'
            || $auth->scope->isSelf() || preg_match('/^[0-9a-f]{32}$/', $auth->record->id) !== 1) {
            throw new \LogicException('a payroll audit row is written only under payroll.manage, against its plan, in company scope');
        }
        if (!in_array($operation, self::PAYROLL_OPERATIONS, true)) {
            throw new \LogicException('unknown payroll operation');
        }
        self::requireActor($auth, $actor, $requestId);
        $this->db->execute($auth, self::APPEND_PAYROLL_SQL, [
            'actor_user_id' => $actor->userId,
            'actor_membership_id' => $actor->membershipId,
            'action' => $auth->action->value,
            'entity' => $auth->record->entity,
            'id' => $auth->record->id,
            'operation' => $operation,
            'request_id' => $requestId,
        ]);
    }

    /**
     * BF-4d: appends one supplemental.manage row for the Supplemental document $id, naming the
     * operation and no field. supplemental.manage is record-free, so the Authorization carries no
     * record: the row is written only under that Action, in company scope, for a server document id.
     * Must run inside the transaction of the change.
     */
    public function appendSupplemental(Authorization $auth, Principal $actor, string $operation, string $id, string $requestId): void
    {
        if ($auth->action !== Action::SupplementalManage || $auth->record !== null || $auth->scope->isSelf()
            || preg_match('/^[0-9a-f]{32}$/', $id) !== 1) {
            throw new \LogicException('a supplemental audit row is written only under supplemental.manage, for its document, in company scope');
        }
        if (!in_array($operation, self::SUPPLEMENTAL_OPERATIONS, true)) {
            throw new \LogicException('unknown supplemental operation');
        }
        self::requireActor($auth, $actor, $requestId);
        $this->db->execute($auth, self::APPEND_SUPPLEMENTAL_SQL, [
            'actor_user_id' => $actor->userId,
            'actor_membership_id' => $actor->membershipId,
            'action' => $auth->action->value,
            'entity' => 'supplementalPayroll',
            'id' => $id,
            'operation' => $operation,
            'request_id' => $requestId,
        ]);
    }

    /**
     * BF-4e: appends one row for a Finance posting, on its source $sourceId and under the Action of
     * the source domain: payroll.manage against the base plan the Authorization was decided on
     * (entity payrollPlan), or the record-free supplemental.manage for a Supplemental document
     * (entity supplementalPayroll) — operation 'post', no field. Must run inside the transaction of
     * the posting.
     */
    public function appendPosting(Authorization $auth, Principal $actor, string $sourceId, string $requestId): void
    {
        if ($auth->scope->isSelf() || preg_match('/^[0-9a-f]{32}$/', $sourceId) !== 1) {
            throw new \LogicException('a posting audit row is written in company scope, for its source');
        }
        if ($auth->action === Action::PayrollManage && $auth->record !== null && $auth->record->entity === 'payrollPlan' && $auth->record->id === $sourceId) {
            $entity = 'payrollPlan';
        } elseif ($auth->action === Action::SupplementalManage && $auth->record === null) {
            $entity = 'supplementalPayroll';
        } else {
            throw new \LogicException('a posting audit row is written only under the Action of its source');
        }
        self::requireActor($auth, $actor, $requestId);
        $this->db->execute($auth, self::APPEND_POSTING_SQL, [
            'actor_user_id' => $actor->userId,
            'actor_membership_id' => $actor->membershipId,
            'action' => $auth->action->value,
            'entity' => $entity,
            'id' => $sourceId,
            'operation' => self::POSTING_OPERATION,
            'request_id' => $requestId,
        ]);
    }

    /**
     * The stored form of a field-name list: comma-separated, or null when empty.
     *
     * @param list<string> $fields
     */
    public static function fieldList(array $fields): ?string
    {
        if (!array_is_list($fields) || count($fields) !== count(array_unique($fields))) {
            throw new \LogicException('audit field names are a list without duplicates');
        }
        foreach ($fields as $name) {
            if (!is_string($name) || preg_match(self::FIELD_PATTERN, $name) !== 1) {
                throw new \LogicException('an audit field is a field name, never a value');
            }
        }
        $list = implode(',', $fields);
        if (strlen($list) > 512) {
            throw new \LogicException('audit field list too long');
        }
        return $list === '' ? null : $list;
    }

    /** The actor is the authorized principal itself, and the row carries the server request id. */
    private static function requireActor(Authorization $auth, Principal $actor, string $requestId): void
    {
        if (!Scope::of($actor)->equals($auth->scope)) {
            throw new \LogicException('the audit actor must be the authorized principal');
        }
        if (preg_match('/^[0-9a-f]{32}$/', $requestId) !== 1) {
            throw new \LogicException('an audit row carries the server request id');
        }
    }
}
