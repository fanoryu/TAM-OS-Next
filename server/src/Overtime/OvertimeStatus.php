<?php
declare(strict_types=1);

namespace TamOs\Overtime;

use TamOs\Policy\Action;

/**
 * The BF-4b1 overtime state machine (owner decision D-BF4b-5): one explicit, named server
 * operation per transition, never a generic status update.
 *
 *   Draft      → Submitted   submit   overtime.submitSelf   (the owner, or the CEO for them)
 *   Submitted  → Reviewed    review   overtime.manage       (CEO)
 *   Submitted  → Rejected    reject   overtime.manage       (CEO)
 *   Reviewed   → Rejected    reject   overtime.manage       (CEO)
 *
 * Rejected is terminal. Editing and the hard delete exist only for a Draft. The status strings are
 * the frontend's (js/core/constants.js OVERTIME_STATUSES), and Policy's own-Draft rule reads 'Draft'.
 *
 * BF-4b2 (owner decision D-BF4b2-1 = A) adds exactly one more transition, which is NOT a member of
 * TRANSITIONS and so never reachable through the generic transition path:
 *
 *   Reviewed   → Approved    approve  overtime.manage       (CEO; OvertimeService::approve)
 *
 * Approval values the record (OvertimeValuation) and freezes that valuation on the row in the same
 * transaction; the database refuses an Approved row without it. Approved is terminal: no reject,
 * no return to Reviewed or Draft, no revaluation. Payroll, a void or a correction are later slices.
 */
final class OvertimeStatus
{
    public const DRAFT = 'Draft';
    public const SUBMITTED = 'Submitted';
    public const REVIEWED = 'Reviewed';
    public const APPROVED = 'Approved';
    public const REJECTED = 'Rejected';
    public const VALUES = [self::DRAFT, self::SUBMITTED, self::REVIEWED, self::APPROVED, self::REJECTED];
    /** BF-4b2: the statuses with no way out. */
    public const TERMINAL = [self::APPROVED, self::REJECTED];

    /** BF-4b2: the approval — [operation, Action, the one source status, target status]. */
    public const APPROVE = ['approve', Action::OvertimeManage, self::REVIEWED, self::APPROVED];

    /** operation => [Action, source statuses, target status]; the only generic transitions there are. */
    public const TRANSITIONS = [
        'submit' => [Action::OvertimeSubmitSelf, [self::DRAFT], self::SUBMITTED],
        'review' => [Action::OvertimeManage, [self::SUBMITTED], self::REVIEWED],
        'reject' => [Action::OvertimeManage, [self::SUBMITTED, self::REVIEWED], self::REJECTED],
    ];

    /** The Action an operation is authorized by. */
    public static function action(string $operation): Action
    {
        return (self::TRANSITIONS[$operation] ?? throw new \LogicException('unknown overtime transition'))[0];
    }

    /** The status $operation moves $from to, or null when that transition does not exist. */
    public static function target(string $operation, string $from): ?string
    {
        $t = self::TRANSITIONS[$operation] ?? throw new \LogicException('unknown overtime transition');
        return in_array($from, $t[1], true) ? $t[2] : null;
    }
}
