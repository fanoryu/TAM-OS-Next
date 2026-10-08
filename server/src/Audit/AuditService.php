<?php
declare(strict_types=1);

namespace TamOs\Audit;

use TamOs\Data\Audit\AuditEventStore;
use TamOs\Data\BusinessData;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Policy\Scope;

/**
 * The CEO audit read (BF-4g; owner decisions D-BF4g-1..4 = A, Audit & Backup D-AB-2/3/4/15 = A):
 * the business audit trail, read-only, in the CEO's company scope. No new Action (ACTIONS stay 21) —
 * an Employee principal is refused before any lookup — no write, no transaction and no lock; the
 * authentication log (auth_events) is never read. The company comes from the session principal only.
 *
 *   month   validate ?month= (400) → CEO (403) → the month's rows in the Asia/Jakarta calendar
 *   record  validate ?entity=&id= (400) → CEO (403) → the rows naming that record, [] when none —
 *           the record itself is never looked up (D-BF4g-4 = A)
 *
 * Either read above AuditEventStore::LIST_CAP rows fails closed (D-BF4g-2 = A): 500 internal_error,
 * logged as audit_list_cap, and no partial list.
 */
final class AuditService
{
    public function __construct(private readonly BusinessData $data)
    {
    }

    /** @return list<array<string, mixed>> the audit rows of $month (CEO only) */
    public function month(Principal $actor, ?string $month): array
    {
        $window = AuditInput::month($month);               // 400 before any lookup
        $scope = self::companyScope($actor);               // an Employee: 403 before any lookup
        return self::capped($this->data->auditEvents()->month($scope, $window['from'], $window['to']));
    }

    /** @return list<array<string, mixed>> the audit rows naming one record (CEO only), [] when none */
    public function record(Principal $actor, ?string $entity, ?string $id): array
    {
        $in = AuditInput::record($entity, $id);             // 400 before any lookup
        $scope = self::companyScope($actor);               // an Employee: 403 before any lookup
        return self::capped($this->data->auditEvents()->record($scope, $in['entity'], $in['id']));
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private static function capped(array $rows): array
    {
        if (count($rows) > AuditEventStore::LIST_CAP) {
            throw new ApiError(ErrorCode::InternalError, 'audit read above its cap', logReason: 'audit_list_cap');
        }
        return $rows;
    }

    /** Every audit read is CEO-only — an Employee principal is refused before any lookup. */
    private static function companyScope(Principal $actor): Scope
    {
        $scope = Scope::of($actor);
        if ($scope->isSelf()) {
            throw new ApiError(ErrorCode::Forbidden, 'action denied', logReason: 'action_denied');
        }
        return $scope;
    }
}
