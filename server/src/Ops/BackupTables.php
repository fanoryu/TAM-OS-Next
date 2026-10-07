<?php
declare(strict_types=1);

namespace TamOs\Ops;

/**
 * The backup table classification (OPS-1, D-AB-7 = B) — the one place it is defined.
 *
 * Every table a migration creates is either backed up (INCLUDED, in foreign-key-safe order, so a
 * later restore can load it front to back) or explicitly EXCLUDED; tools/verify-backend-boundary.js
 * fails the build when a migration creates an unclassified table, and a backup refuses
 * (unclassified_table) when the database holds one. schema_migrations is not copied as rows: its
 * applied history is recorded in the manifest.
 *
 * EXCLUDED is short-lived security and delivery state that must not come back from a backup:
 * sessions (a restore would revive signed-in sessions; every user signs in again), account_tokens
 * (open activation and recovery tokens are reissued instead), auth_rate_limits (counters) and
 * mail_outbox (a queue whose messages hold no content). Users keep their password hashes, so a
 * restore needs no credential reset.
 *
 * APPEND_ONLY tables are never updated or deleted by the application (SDR-0002 §9.2; the boundary
 * tool's audit-append-only and auth-events-rewrite rules), so every row of one backup must reappear
 * byte-identical in every later backup — the audit-prefix continuity check (D-AB-5 = B).
 */
final class BackupTables
{
    public const INCLUDED = [
        'companies',
        'users',
        'employees',
        'memberships',
        'auth_events',
        'audit_events',
        'overtime_records',
        'payroll_plans',
        'payroll_plan_overtime',
        'supplemental_payrolls',
        'supplemental_payroll_overtime',
        'finance_postings',
        'finance_executions',
    ];

    public const EXCLUDED = [
        'account_tokens',
        'auth_rate_limits',
        'mail_outbox',
        'sessions',
    ];

    public const APPEND_ONLY = [
        'auth_events',
        'audit_events',
    ];

    /** The migration history table: recorded in the manifest, never copied as rows. */
    public const HISTORY = 'schema_migrations';
}
