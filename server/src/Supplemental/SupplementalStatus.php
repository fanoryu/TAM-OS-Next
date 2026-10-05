<?php
declare(strict_types=1);

namespace TamOs\Supplemental;

/**
 * The BF-4d Supplemental Payroll state machine (owner decision D-SPAY-1 = A): the canonical server
 * Payroll vocabulary (PayrollStatus) and operation names, one explicit, named server operation per
 * transition, never a generic status update. Every operation is CEO-only under the existing
 * supplemental.manage. The graph is the owner's authorized one (BF-4d §15), which is linear: unlike
 * base Payroll there is no Draft → Ready shortcut, so every Supplemental is reviewed before it is
 * approved.
 *
 *   Draft      → Reviewed    review
 *   Reviewed   → Ready       approve
 *   Reviewed   → Draft       return   (keeps the captured overtime; the next generate recalculates)
 *   Ready      → Draft       return
 *   Draft / Reviewed / Ready → Cancelled   cancel   (releases the captured overtime)
 *
 * A Draft is created and recalculated only by generate; Reviewed and Ready are frozen — no
 * recalculation, so an approval always attests to the set and total it was given. Commit is a
 * separate named operation, guarded by more than a status and a version (expectedTotal, the
 * revalidated links and an idempotency key):
 *
 *   Ready      → Committed   commit   (COMMIT_FROM → COMMITTED; nothing else reaches Committed)
 *
 * Committed and Cancelled are terminal. Committed is an immutable obligation — never paid,
 * executed or posted anywhere.
 */
final class SupplementalStatus
{
    public const DRAFT = 'Draft';
    public const REVIEWED = 'Reviewed';
    public const READY = 'Ready';
    public const COMMITTED = 'Committed';
    public const CANCELLED = 'Cancelled';
    public const VALUES = [self::DRAFT, self::REVIEWED, self::READY, self::COMMITTED, self::CANCELLED];
    /** The statuses with no way out. */
    public const TERMINAL = [self::COMMITTED, self::CANCELLED];
    /** The open statuses: at most one open document per base plan (the database's open key). */
    public const OPEN = [self::DRAFT, self::REVIEWED, self::READY];
    /** The one status Commit starts from. */
    public const COMMIT_FROM = self::READY;

    /** operation => [source statuses, target status]; the only transitions there are. */
    public const TRANSITIONS = [
        'review' => [[self::DRAFT], self::REVIEWED],
        'approve' => [[self::REVIEWED], self::READY],
        'return' => [[self::REVIEWED, self::READY], self::DRAFT],
        'cancel' => [[self::DRAFT, self::REVIEWED, self::READY], self::CANCELLED],
    ];

    /** The status $operation moves $from to, or null when that transition does not exist. */
    public static function target(string $operation, string $from): ?string
    {
        $t = self::TRANSITIONS[$operation] ?? throw new \LogicException('unknown supplemental transition');
        return in_array($from, $t[0], true) ? $t[1] : null;
    }
}
