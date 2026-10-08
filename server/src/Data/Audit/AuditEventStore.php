<?php
declare(strict_types=1);

namespace TamOs\Data\Audit;

use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Policy\Scope;

/**
 * The CEO audit read (BF-4g; owner decisions D-BF4g-1..4 = A, Audit & Backup D-AB-2/3/4/15 = A):
 * two fixed, read-only SELECTs of audit_events in CEO company scope. No write, no locking read, no
 * join — never a current user name, email or role, never another table and never auth_events —
 * and no Employee statement. AuditLog stays the only writer of audit_events.
 *
 * Both reads project the stored historical columns (the view drops company_id) and order by
 * (occurred_at, id), which is total; each reads at most LIST_LIMIT rows so a caller can tell that
 * LIST_CAP was exceeded and fail closed (D-BF4g-2 = A) — never a truncated list.
 *
 *   MONTH_SQL   the half-open UTC window of one company-calendar month: occurred_at >= :from AND
 *               occurred_at < :to, both bound as "Y-m-d H:i:s.u" (the audit_events_company_time index)
 *   RECORD_SQL  every row naming one entity and id (the audit_events_entity index); the record is
 *               never looked up, so a deleted record keeps its history (D-BF4g-4 = A)
 */
final class AuditEventStore
{
    /** A read fails closed above this many rows (read with LIST_LIMIT). */
    public const LIST_CAP = 2000;
    public const LIST_LIMIT = 2001;

    public const MONTH_SQL = 'SELECT id, company_id, NULL AS owner_employee_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields FROM audit_events WHERE company_id = :company_id AND occurred_at >= :from AND occurred_at < :to ORDER BY occurred_at, id LIMIT 2001';
    public const RECORD_SQL = 'SELECT id, company_id, NULL AS owner_employee_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields FROM audit_events WHERE company_id = :company_id AND entity = :entity AND entity_id = :entity_id ORDER BY occurred_at, id LIMIT 2001';

    public function __construct(private readonly ScopedDatabase $db)
    {
    }

    /**
     * Every audit row of the company in [$from, $to) — UTC "Y-m-d H:i:s.u" — at most LIST_LIMIT. CEO only.
     *
     * @return list<array<string, mixed>>
     */
    public function month(Scope $scope, string $from, string $to): array
    {
        self::companyOnly($scope);
        if (!self::isUtc($from) || !self::isUtc($to) || strcmp($from, $to) >= 0) {
            throw new \LogicException('an audit window is two ordered UTC instants with six fractional digits');
        }
        return $this->db->select($scope, self::MONTH_SQL, ['from' => $from, 'to' => $to]);
    }

    /**
     * Every audit row of the company naming $entity / $entityId, at most LIST_LIMIT. CEO only.
     *
     * @return list<array<string, mixed>>
     */
    public function record(Scope $scope, string $entity, string $entityId): array
    {
        self::companyOnly($scope);
        if (preg_match('/^[a-z][A-Za-z]{0,31}$/D', $entity) !== 1 || $entityId === '' || strlen($entityId) > 64) {
            throw new \LogicException('an audit record is a stored entity and its id');
        }
        return $this->db->select($scope, self::RECORD_SQL, ['entity' => $entity, 'entity_id' => $entityId]);
    }

    private static function companyOnly(Scope $scope): void
    {
        if ($scope->isSelf()) {
            throw new \LogicException('audit reads are company scope only');
        }
    }

    private static function isUtc(string $v): bool
    {
        return preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}$/D', $v) === 1;
    }
}
