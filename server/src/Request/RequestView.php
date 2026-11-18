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
 */
final class RequestView
{
    public const FIELDS = ['id', 'kind', 'employeeId', 'financialPost', 'category', 'description', 'amount', 'payee', 'documentDate', 'status', 'statusReason', 'version', 'createdByUserId', 'createdAt', 'updatedAt', 'payment'];
    public const PAYMENT_FIELDS = ['financeTransactionId', 'paidOn', 'paymentMethod', 'paidByUserId', 'paidAt'];

    /**
     * @param array<string, mixed> $row a request row with its payment columns (RequestStore::RECORD_SQL)
     * @return array<string, mixed>
     */
    public static function request(array $row): array
    {
        $paid = $row['finance_transaction_id'] !== null;
        $out = [
            'id' => (string) $row['id'],
            'kind' => (string) $row['kind'],
            'employeeId' => $row['owner_employee_id'] === null ? null : (string) $row['owner_employee_id'],
            'financialPost' => (string) $row['financial_post'],
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
        if (!in_array($out['kind'], RequestStatus::KINDS, true) || FinancialPost::tryFrom($out['financialPost']) === null
            || !RequestInput::isPositiveAmount($out['amount']) || !TransactionInput::isDate($out['documentDate'])
            || !in_array($out['status'], RequestStatus::ALL, true) || ($out['status'] === RequestStatus::PAID) !== $paid
            || ($out['kind'] === RequestStatus::KIND_REIMBURSEMENT) !== ($out['employeeId'] !== null)
            || ($paid && (!in_array($out['payment']['paymentMethod'], FinanceExecutionInput::PAYMENT_METHODS, true) || !TransactionInput::isDate($out['payment']['paidOn'])))
            || !PayrollCalculation::isAmount($out['amount'])) {
            throw new \LogicException('a finance request row needs a known kind, post and status, a positive whole-Rupiah amount, a calendar date, an owner exactly on a reimbursement and a payment exactly when Paid');
        }
        return $out;
    }

    /**
     * The editable fields of a locked request row, by API name (RequestInput::FIELDS).
     *
     * @param array<string, mixed> $row RequestStore::LOCK_SQL
     * @return array{financialPost: string, category: string, description: string, amount: string, payee: ?string, documentDate: string}
     */
    public static function editable(array $row): array
    {
        return [
            'financialPost' => (string) $row['financial_post'],
            'category' => (string) $row['category'],
            'description' => (string) $row['description'],
            'amount' => (string) $row['amount'],
            'payee' => $row['payee'] === null ? null : (string) $row['payee'],
            'documentDate' => (string) $row['document_date'],
        ];
    }
}
