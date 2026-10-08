<?php
declare(strict_types=1);

namespace TamOs\Audit;

use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Payroll\PayrollInput;

/**
 * The CEO audit read queries (BF-4g; owner decisions D-BF4g-1..4 = A). Nothing here reads a body:
 * both routes are GETs whose only input is the query string the kernel has already limited to its
 * declared keys (Route::$queryKeys — an unknown or repeated key is a 400 before the handler).
 *
 *   ?month=YYYY-MM          a month of the company calendar, Asia/Jakarta (D-BF4g-1 = A): its
 *                           half-open window [first instant, first instant of the next month) is
 *                           computed here, in PHP, and converted to UTC — audit_events.occurred_at
 *                           is UTC_TIMESTAMP(6) under a +00:00 session (AuditLog, DatabaseConfig) —
 *                           as two "Y-m-d H:i:s.u" strings; never CONVERT_TZ, BETWEEN or an
 *                           inclusive end of month.
 *   ?entity=…&id=…          one stored audit entity (the closed vocabulary of migration 0035) and an
 *                           id in that entity's server format. The record itself is never looked up
 *                           (D-BF4g-4 = A): an unknown or deleted record simply has no history.
 */
final class AuditInput
{
    public const COMPANY_TIMEZONE = 'Asia/Jakarta';
    /** The stored audit entities (migration 0035's audit_events_entity_v5) and each one's id format. */
    public const ENTITIES = [
        'employee' => '/^[A-Za-z0-9_-]{1,64}$/D',
        'overtime' => '/^[0-9a-f]{32}$/D',
        'payrollPlan' => '/^[0-9a-f]{32}$/D',
        'supplementalPayroll' => '/^[0-9a-f]{32}$/D',
        'financePosting' => '/^[0-9a-f]{32}$/D',
    ];
    public const UTC_FORMAT = 'Y-m-d H:i:s.u';

    /**
     * GET ?month= : the company-calendar month as its UTC half-open window.
     *
     * @return array{from: string, to: string}
     */
    public static function month(?string $month): array
    {
        $month = PayrollInput::month($month);
        $zone = new \DateTimeZone(self::COMPANY_TIMEZONE);
        $from = \DateTimeImmutable::createFromFormat('!Y-m', $month, $zone);
        if ($from === false || $from->format('Y-m') !== $month) {
            throw new ApiError(ErrorCode::InvalidQuery, 'month must be YYYY-MM');
        }
        $to = $from->add(new \DateInterval('P1M'));
        $utc = new \DateTimeZone('UTC');
        return ['from' => $from->setTimezone($utc)->format(self::UTC_FORMAT), 'to' => $to->setTimezone($utc)->format(self::UTC_FORMAT)];
    }

    /**
     * GET ?entity=&id= : a stored audit entity and an id in its format.
     *
     * @return array{entity: string, id: string}
     */
    public static function record(?string $entity, ?string $id): array
    {
        if ($entity === null || !array_key_exists($entity, self::ENTITIES)) {
            throw new ApiError(ErrorCode::ValidationFailed, 'audit entity', fields: ['entity']);
        }
        if ($id === null || preg_match(self::ENTITIES[$entity], $id) !== 1) {
            throw new ApiError(ErrorCode::ValidationFailed, 'audit record id', fields: ['id']);
        }
        return ['entity' => $entity, 'id' => $id];
    }
}
