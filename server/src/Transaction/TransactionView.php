<?php
declare(strict_types=1);

namespace TamOs\Transaction;

use TamOs\Audit\AuditEventView;
use TamOs\Payroll\PayrollCalculation;

/**
 * The general transaction projection (Phase 1, D-INT-1). Exactly FIELDS — never the company or the
 * idempotency key: the id, income or expense, the Financial Post code, the free-text category and
 * description as stored, the amount as the exact whole-Rupiah string, the transaction date, who
 * recorded it and when (UTC, "YYYY-MM-DDTHH:MM:SS.ffffffZ"), the DERIVED status — Active, or Voided
 * when a void row exists — and the void itself ({ reason, voidedByUserId, voidedAt }, or null).
 * Ids are shown as stored; no identity join.
 */
final class TransactionView
{
    public const FIELDS = ['id', 'kind', 'financialPost', 'category', 'description', 'amount', 'transactionDate', 'createdByUserId', 'createdAt', 'status', 'void'];
    public const VOID_FIELDS = ['reason', 'voidedByUserId', 'voidedAt'];
    public const ACTIVE = 'Active';
    public const VOIDED = 'Voided';

    /**
     * @param array<string, mixed> $row a transaction row with its void columns (TransactionStore::RECORD_SQL)
     * @return array<string, mixed>
     */
    public static function transaction(array $row): array
    {
        $voided = $row['void_id'] !== null;
        $out = [
            'id' => (string) $row['id'],
            'kind' => (string) $row['kind'],
            'financialPost' => (string) $row['financial_post'],
            'category' => (string) $row['category'],
            'description' => (string) $row['description'],
            'amount' => (string) $row['amount'],
            'transactionDate' => (string) $row['transaction_date'],
            'createdByUserId' => (string) $row['created_by_user_id'],
            'createdAt' => AuditEventView::utc($row['created_at']),
            'status' => $voided ? self::VOIDED : self::ACTIVE,
            'void' => $voided ? [
                'reason' => (string) $row['void_reason'],
                'voidedByUserId' => (string) $row['voided_by_user_id'],
                'voidedAt' => AuditEventView::utc($row['voided_at']),
            ] : null,
        ];
        if (!in_array($out['kind'], TransactionInput::KINDS, true) || FinancialPost::tryFrom($out['financialPost']) === null
            || !PayrollCalculation::isAmount($out['amount']) || $out['amount'] === '0.00' || !TransactionInput::isDate($out['transactionDate'])) {
            throw new \LogicException('a transaction row needs a known kind and Financial Post, a positive whole-Rupiah amount and a calendar date');
        }
        return $out;
    }
}
