<?php
declare(strict_types=1);

namespace TamOs\Request;

use TamOs\Policy\Action;

/**
 * The Phase 2 finance request lifecycle (ADR-016 §2) as pure data: the six statuses, the one legal
 * source set and target of every operation, the terminal statuses, and the Action each operation is
 * authorized under for each kind (§3). It reads nothing and writes nothing.
 *
 *            submit              approve              pay
 *   Draft ───────────▶ Submitted ──────────▶ Approved ──────────▶ Paid (terminal)
 *     │ cancel            │ reject / cancel     │ cancel
 *     ▼                   ▼                     ▼
 *   Cancelled          Rejected | Cancelled   Cancelled            (all terminal)
 *
 * update keeps a Draft a Draft. There is no return to Draft, no edit after Draft, no partial payment
 * and no reversal: Paid, Rejected and Cancelled accept no operation.
 */
final class RequestStatus
{
    public const DRAFT = 'Draft';
    public const SUBMITTED = 'Submitted';
    public const APPROVED = 'Approved';
    public const PAID = 'Paid';
    public const REJECTED = 'Rejected';
    public const CANCELLED = 'Cancelled';

    /** Every status, in lifecycle order (the CHECK of migration 0039). */
    public const ALL = [self::DRAFT, self::SUBMITTED, self::APPROVED, self::PAID, self::REJECTED, self::CANCELLED];
    public const TERMINAL = [self::PAID, self::REJECTED, self::CANCELLED];
    /** The statuses that carry a status_reason (and only they). */
    public const WITH_REASON = [self::REJECTED, self::CANCELLED];

    public const KIND_PAYMENT_REQUEST = 'paymentRequest';
    public const KIND_REIMBURSEMENT = 'reimbursement';
    public const KINDS = [self::KIND_PAYMENT_REQUEST, self::KIND_REIMBURSEMENT];

    /** operation => [legal source statuses, target status] */
    public const TRANSITIONS = [
        'update' => [[self::DRAFT], self::DRAFT],
        'submit' => [[self::DRAFT], self::SUBMITTED],
        'approve' => [[self::SUBMITTED], self::APPROVED],
        'reject' => [[self::SUBMITTED], self::REJECTED],
        'cancel' => [[self::DRAFT, self::SUBMITTED, self::APPROVED], self::CANCELLED],
        'pay' => [[self::APPROVED], self::PAID],
    ];

    /** The target of $operation from $from, or null when the transition is illegal. */
    public static function target(string $operation, string $from): ?string
    {
        $t = self::TRANSITIONS[$operation] ?? null;
        if ($t === null || !in_array($from, $t[0], true)) {
            return null;
        }
        return $t[1];
    }

    public static function isTerminal(string $status): bool
    {
        return in_array($status, self::TERMINAL, true);
    }

    /**
     * The Action an operation on a request of $kind is authorized under (ADR-016 §3): a payment
     * request is managed under finance.manage; a reimbursement is created, updated and submitted under
     * its CeoOrOwnDraft self action; approve, reject and cancel of either kind are finance.manage; pay
     * of either kind is finance.execute.
     */
    public static function action(string $operation, string $kind): Action
    {
        if (!in_array($kind, self::KINDS, true)) {
            throw new \LogicException('unknown finance request kind');
        }
        $reimbursement = $kind === self::KIND_REIMBURSEMENT;
        return match ($operation) {
            'create' => $reimbursement ? Action::ReimbursementCreateSelfDraft : Action::FinanceManage,
            'update' => $reimbursement ? Action::ReimbursementUpdateSelfDraft : Action::FinanceManage,
            'submit' => $reimbursement ? Action::ReimbursementSubmitSelf : Action::FinanceManage,
            'approve', 'reject', 'cancel' => Action::FinanceManage,
            'pay' => Action::FinanceExecute,
            default => throw new \LogicException('unknown finance request operation'),
        };
    }

    /**
     * The audit operation an operation's row names (migration 0041): the reimbursement self drafts
     * name none (as overtime.createSelfDraft / updateSelfDraft); every other operation names itself.
     */
    public static function auditOperation(string $operation, Action $action): ?string
    {
        if ($action === Action::ReimbursementCreateSelfDraft || $action === Action::ReimbursementUpdateSelfDraft) {
            return null;
        }
        return $operation;
    }
}
