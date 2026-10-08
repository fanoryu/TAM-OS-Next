<?php
declare(strict_types=1);

namespace TamOs\Audit;

use TamOs\Data\Audit\AuditLog;

/**
 * The audit event projection (BF-4g, D-BF4g-3 = A). Exactly FIELDS — the stored historical fields of
 * one audit row and nothing else: never the company, and never a current user name, email, role or
 * record value (no join). occurredAt is the stored UTC instant in ISO-8601 with all six fractional
 * digits and a Z; fields is the stored field-name list (empty when none was stored); operation and
 * targetUserId are null when the row stored none. A row this projection cannot read exactly — an
 * unreadable timestamp above all — fails the whole read (500); nothing is returned partially.
 */
final class AuditEventView
{
    public const FIELDS = ['id', 'occurredAt', 'actorUserId', 'actorMembershipId', 'action', 'entity', 'entityId', 'operation', 'targetUserId', 'requestId', 'fields'];
    private const HEX32 = '/^[0-9a-f]{32}$/D';

    /**
     * @param array<string, mixed> $row an audit row (AuditEventStore::MONTH_SQL / RECORD_SQL)
     * @return array<string, mixed>
     */
    public static function event(array $row): array
    {
        $out = [
            'id' => (string) $row['id'],
            'occurredAt' => self::utc($row['occurred_at']),
            'actorUserId' => (string) $row['actor_user_id'],
            'actorMembershipId' => (string) $row['actor_membership_id'],
            'action' => (string) $row['action'],
            'entity' => (string) $row['entity'],
            'entityId' => (string) $row['entity_id'],
            'operation' => $row['operation'] === null ? null : (string) $row['operation'],
            'targetUserId' => $row['target_user_id'] === null ? null : (string) $row['target_user_id'],
            'requestId' => (string) $row['request_id'],
            'fields' => $row['fields'] === null ? [] : explode(',', (string) $row['fields']),
        ];
        if (preg_match('/^[1-9][0-9]{0,19}$/D', $out['id']) !== 1 || preg_match(self::HEX32, $out['actorUserId']) !== 1
            || preg_match(self::HEX32, $out['actorMembershipId']) !== 1 || preg_match(self::HEX32, $out['requestId']) !== 1
            || preg_match('/^[a-z][A-Za-z]{0,31}(\.[a-z][A-Za-z]{0,31})?$/D', $out['action']) !== 1
            || !array_key_exists($out['entity'], AuditInput::ENTITIES) || $out['entityId'] === ''
            || ($out['operation'] !== null && preg_match('/^[a-z]{1,16}$/D', $out['operation']) !== 1)
            || ($out['targetUserId'] !== null && preg_match(self::HEX32, $out['targetUserId']) !== 1)) {
            throw new \LogicException('an audit row needs its id, actor, request, action, a stored entity and its id');
        }
        foreach ($out['fields'] as $name) {
            if (preg_match(AuditLog::FIELD_PATTERN, $name) !== 1) {
                throw new \LogicException('an audit row stores field names only');
            }
        }
        return $out;
    }

    /** A stored DATETIME(6) — UTC — as "YYYY-MM-DDTHH:MM:SS.ffffffZ"; anything else is refused. */
    public static function utc(mixed $stored): string
    {
        if (!is_string($stored) || preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}$/D', $stored) !== 1) {
            throw new \LogicException('an audit timestamp is a stored DATETIME(6)');
        }
        $time = \DateTimeImmutable::createFromFormat('!' . AuditInput::UTC_FORMAT, $stored, new \DateTimeZone('UTC'));
        if ($time === false || $time->format(AuditInput::UTC_FORMAT) !== $stored) {
            throw new \LogicException('an audit timestamp is a real UTC instant');
        }
        return $time->format('Y-m-d\TH:i:s.u\Z');
    }
}
