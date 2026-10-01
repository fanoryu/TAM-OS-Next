<?php
declare(strict_types=1);

namespace TamOs\Data\Auth;

use TamOs\Data\Database;

/**
 * Authentication and account-lifecycle security events (SDR-0002 §9.2) — append-only. This class is the only
 * writer of auth_events and it only inserts; no update, delete or other rewrite of the table
 * exists anywhere in the application (tools/verify-backend-boundary.js rejects one). The time
 * is the database clock. No password, session token, CSRF token or raw email is ever stored.
 */
final class AuthEvents
{
    // Must equal the CHECK auth_events_event_v3 vocabulary (migration 0012); a unit test compares them.
    public const EVENTS = [
        'login_success', 'login_failure', 'login_locked', 'logout',
        // BF-3B account lifecycle
        'ceo_bootstrap', 'credential_reset', 'activation_ok', 'activation_fail', 'password_change', 'password_fail', 'logout_all',
        // BF-3D password recovery and governed mail
        'recovery_req', 'recovery_ok', 'recovery_fail', 'mail_fail',
    ];

    public function __construct(private readonly Database $db)
    {
    }

    public function append(string $event, ?string $userId, ?string $membershipId, ?string $emailHash, ?string $ip, string $requestId): void
    {
        if (!in_array($event, self::EVENTS, true)) {
            throw new \LogicException('unknown auth event');
        }
        if (preg_match('/^[0-9a-f]{32}$/', $requestId) !== 1 || ($emailHash !== null && preg_match('/^[0-9a-f]{64}$/', $emailHash) !== 1)) {
            throw new \LogicException('auth event identifiers must be server-generated hex');
        }
        $this->db->execute(
            'INSERT INTO auth_events (occurred_at, event, user_id, membership_id, email_hash, ip, request_id) VALUES (UTC_TIMESTAMP(6), ?, ?, ?, ?, ?, ?)',
            [$event, $userId, $membershipId, $emailHash, $ip, $requestId],
        );
    }
}
