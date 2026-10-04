<?php
declare(strict_types=1);

namespace TamOs\Payroll;

/**
 * The BF-4c1 payroll plan state machine (owner decisions D-PAY-1 = A, D-PAY-6 = A): the canonical
 * LOCAL pre-commit graph (js/domain/payroll-lifecycle-aggregate.js PAYROLL_LIFECYCLE_TRANSITIONS),
 * one explicit, named server operation per transition, never a generic status update. Every
 * operation is CEO-only under the existing payroll.manage.
 *
 *   Draft      → Reviewed    review
 *   Draft      → Ready       approve
 *   Reviewed   → Ready       approve
 *   Reviewed   → Draft       return
 *   Ready      → Draft       return
 *   Draft / Reviewed / Ready → Cancelled   cancel
 *
 * A Draft is created and recalculated only by generate. Committed and Cancelled are terminal — no
 * operation has either as its source. Ready is an approved obligation awaiting commit, never a
 * payment.
 *
 * BF-4c2 (owner decisions D-BF4c2-1..4 = A): Commit is a separate named operation, not one of these
 * transitions, because it is guarded by more than a status and a version (expectedTotal, the drift
 * guard and an idempotency key):
 *
 *   Ready      → Committed   commit   (COMMIT_FROM → COMMITTED; nothing else reaches Committed)
 *
 * Committed is an immutable payroll obligation — never paid, executed or posted anywhere.
 */
final class PayrollStatus
{
    public const DRAFT = 'Draft';
    public const REVIEWED = 'Reviewed';
    public const READY = 'Ready';
    public const COMMITTED = 'Committed';
    public const CANCELLED = 'Cancelled';
    public const VALUES = [self::DRAFT, self::REVIEWED, self::READY, self::COMMITTED, self::CANCELLED];
    /** The statuses with no way out. */
    public const TERMINAL = [self::COMMITTED, self::CANCELLED];
    /** The statuses a BF-4c1 operation may start from. */
    public const PRE_COMMIT = [self::DRAFT, self::REVIEWED, self::READY];
    /** BF-4c2: the one status Commit starts from. */
    public const COMMIT_FROM = self::READY;

    /** operation => [source statuses, target status]; the only transitions there are. */
    public const TRANSITIONS = [
        'review' => [[self::DRAFT], self::REVIEWED],
        'approve' => [[self::DRAFT, self::REVIEWED], self::READY],
        'return' => [[self::REVIEWED, self::READY], self::DRAFT],
        'cancel' => [[self::DRAFT, self::REVIEWED, self::READY], self::CANCELLED],
    ];

    /** The status $operation moves $from to, or null when that transition does not exist. */
    public static function target(string $operation, string $from): ?string
    {
        $t = self::TRANSITIONS[$operation] ?? throw new \LogicException('unknown payroll transition');
        return in_array($from, $t[0], true) ? $t[1] : null;
    }
}
