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
 * Rejected is terminal. Editing and the hard delete exist only for a Draft. There is no Approved
 * status and no approval here: valuation and approval are BF-4b2. The status strings are the
 * frontend's (js/core/constants.js OVERTIME_STATUSES), and Policy's own-Draft rule reads 'Draft'.
 */
final class OvertimeStatus
{
    public const DRAFT = 'Draft';
    public const SUBMITTED = 'Submitted';
    public const REVIEWED = 'Reviewed';
    public const REJECTED = 'Rejected';
    public const VALUES = [self::DRAFT, self::SUBMITTED, self::REVIEWED, self::REJECTED];

    /** operation => [Action, source statuses, target status]; the only transitions there are. */
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
