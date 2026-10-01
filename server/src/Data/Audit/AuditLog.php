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
 */
final class AuditLog
{
    /** The Actions append() audits. A new audited Action extends this list and the action CHECK (0017, 0019). */
    public const ACTIONS = [Action::EmployeeCreate, Action::EmployeeUpdate, Action::EmployeeDelete];
    /** BF-4a2: the account.manage operations appendAccount() audits (migration 0019's CHECK). */
    public const ACCOUNT_OPERATIONS = ['provision', 'reissue', 'disable', 'enable'];
    public const ENTITIES = ['employee'];
    public const FIELD_PATTERN = '/^[a-z][A-Za-z]{0,31}$/';

    public const APPEND_SQL = 'INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, target_user_id, request_id, fields) VALUES (:company_id, UTC_TIMESTAMP(6), :actor_user_id, :actor_membership_id, :action, :entity, :id, NULL, :request_id, :fields)';
    public const APPEND_ACCOUNT_SQL = 'INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (:company_id, UTC_TIMESTAMP(6), :actor_user_id, :actor_membership_id, :action, :entity, :id, :operation, :target_user_id, :request_id, NULL)';

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
