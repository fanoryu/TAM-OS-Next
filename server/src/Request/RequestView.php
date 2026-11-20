<?php
declare(strict_types=1);

namespace TamOs\Request;

use TamOs\Audit\AuditEventView;
use TamOs\Finance\FinanceExecutionInput;
use TamOs\Payroll\PayrollCalculation;
use TamOs\Transaction\FinancialPost;
use TamOs\Transaction\TransactionInput;

/**
 * The finance request projection (Phase 2, ADR-016). Exactly FIELDS — never the company or the
 * idempotency key: the id, the kind, the reimbursed employee (null for a payment request), the
 * Financial Post code, the category and description as stored, the amount as the exact whole-Rupiah
 * string, the payee (null for a reimbursement), the document date (needed-by or expense date), the
 * status and its reason (Rejected / Cancelled only), the version, who created it and when, and — for
 * a Paid request — its payment { financeTransactionId, paidOn, paymentMethod, paidByUserId, paidAt },
 * otherwise null. Times are UTC "YYYY-MM-DDTHH:MM:SS.ffffffZ". Ids are shown as stored.
 *
 * ADR-017: the post is null exactly while a reimbursement waits for the CEO's assignment (Draft,
 * Submitted, Rejected or Cancelled before approval). The pre-approval snapshot — CEO_FIELDS'
 * preApprovalFinancialPost and preApprovalPostCaptured — is shown to the CEO only (R-3); an Employee's
 * projection has no snapshot key at all. preApprovalPostCaptured false means "not captured" (never
 * approved, or approved before migration 0042), never "no previous post".
 */
final class RequestView
{
    public const FIELDS = ['id', 'kind', 'employeeId', 'financialPost', 'category', 'description', 'amount', 'payee', 'documentDate', 'status', 'statusReason', 'version', 'createdByUserId', 'createdAt', 'updatedAt', 'payment'];
    /** ADR-017 R-3: the CEO's projection — FIELDS with the pre-approval snapshot after the post. */
    public const CEO_FIELDS = ['id', 'kind', 'employeeId', 'financialPost', 'preApprovalFinancialPost', 'preApprovalPostCaptured', 'category', 'description', 'amount', 'payee', 'documentDate', 'status', 'statusReason', 'version', 'createdByUserId', 'createdAt', 'updatedAt', 'payment'];
    public const PAYMENT_FIELDS = ['financeTransactionId', 'paidOn', 'paymentMethod', 'paidByUserId', 'paidAt'];
    /** ADR-017 §2 (migration 0042): the statuses in which a reimbursement may have no post yet. */
    public const UNASSIGNED_STATUSES = [RequestStatus::DRAFT, RequestStatus::SUBMITTED, RequestStatus::REJECTED, RequestStatus::CANCELLED];

    /**
     * @param array<string, mixed> $row a request row with its payment columns (RequestStore::RECORD_SQL)
     * @param bool $withSnapshot the reader is the CEO (company scope): include the pre-approval snapshot (ADR-017 R-3)
     * @return array<string, mixed>
     */
    public static function request(array $row, bool $withSnapshot): array
    {
        $paid = $row['finance_transaction_id'] !== null;
        $post = $row['financial_post'] === null ? null : (string) $row['financial_post'];
        $previous = $row['pre_approval_financial_post'] === null ? null : (string) $row['pre_approval_financial_post'];
        $captured = (int) $row['pre_approval_post_captured'];
        $out = [
            'id' => (string) $row['id'],
            'kind' => (string) $row['kind'],
            'employeeId' => $row['owner_employee_id'] === null ? null : (string) $row['owner_employee_id'],
            'financialPost' => $post,
            'category' => (string) $row['category'],
            'description' => (string) $row['description'],
            'amount' => (string) $row['amount'],
            'payee' => $row['payee'] === null ? null : (string) $row['payee'],
            'documentDate' => (string) $row['document_date'],
            'status' => (string) $row['status'],
            'statusReason' => $row['status_reason'] === null ? null : (string) $row['status_reason'],
            'version' => (int) $row['version'],
            'createdByUserId' => (string) $row['created_by_user_id'],
            'createdAt' => AuditEventView::utc($row['created_at']),
            'updatedAt' => AuditEventView::utc($row['updated_at']),
            'payment' => $paid ? [
                'financeTransactionId' => (string) $row['finance_transaction_id'],
                'paidOn' => (string) $row['paid_on'],
                'paymentMethod' => (string) $row['payment_method'],
                'paidByUserId' => (string) $row['paid_by_user_id'],
                'paidAt' => AuditEventView::utc($row['paid_at']),
            ] : null,
        ];
        if (!in_array($out['kind'], RequestStatus::KINDS, true)
            || ($post === null ? ($out['kind'] !== RequestStatus::KIND_REIMBURSEMENT || !in_array($out['status'], self::UNASSIGNED_STATUSES, true)) : FinancialPost::tryFrom($post) === null)
            || ($previous !== null && FinancialPost::tryFrom($previous) === null) || !in_array($captured, [0, 1], true)
            || ($previous !== null && $captured !== 1)
            || ($captured === 1 && ($post === null || $out['kind'] !== RequestStatus::KIND_REIMBURSEMENT || !in_array($out['status'], [RequestStatus::APPROVED, RequestStatus::PAID, RequestStatus::CANCELLED], true)))
            || !RequestInput::isPositiveAmount($out['amount']) || !TransactionInput::isDate($out['documentDate'])
            || !in_array($out['status'], RequestStatus::ALL, true) || ($out['status'] === RequestStatus::PAID) !== $paid
            || ($out['kind'] === RequestStatus::KIND_REIMBURSEMENT) !== ($out['employeeId'] !== null)
            || ($paid && (!in_array($out['payment']['paymentMethod'], FinanceExecutionInput::PAYMENT_METHODS, true) || !TransactionInput::isDate($out['payment']['paidOn'])))
            || !PayrollCalculation::isAmount($out['amount'])) {
            throw new \LogicException('a finance request row needs a known kind, post and status, a positive whole-Rupiah amount, a calendar date, an owner exactly on a reimbursement, a payment exactly when Paid, a post unless an unapproved reimbursement, and a consistent pre-approval snapshot');
        }
        if (!$withSnapshot) {
            return $out;
        }
        $ceo = [];
        foreach ($out as $key => $value) {
            $ceo[$key] = $value;
            if ($key === 'financialPost') {
                $ceo['preApprovalFinancialPost'] = $previous;
                $ceo['preApprovalPostCaptured'] = $captured === 1;
            }
        }
        return $ceo;
    }

    /**
     * The editable fields of a locked request row, by API name (RequestInput::FIELDS).
     *
     * @param array<string, mixed> $row RequestStore::LOCK_SQL
     * @return array{financialPost: ?string, category: string, description: string, amount: string, payee: ?string, documentDate: string}
     */
    public static function editable(array $row): array
    {
        return [
            'financialPost' => $row['financial_post'] === null ? null : (string) $row['financial_post'],
            'category' => (string) $row['category'],
            'description' => (string) $row['description'],
            'amount' => (string) $row['amount'],
            'payee' => $row['payee'] === null ? null : (string) $row['payee'],
            'documentDate' => (string) $row['document_date'],
        ];
    }
}
