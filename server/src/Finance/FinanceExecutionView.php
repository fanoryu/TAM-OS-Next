<?php
declare(strict_types=1);

namespace TamOs\Finance;

use TamOs\Payroll\PayrollCalculation;

/**
 * The Finance execution projection (BF-4f). Exactly FIELDS — never the company, the idempotency key,
 * recorded_at, the actor, a lock or audit detail: the execution's id, the Planned posting it records
 * as paid, that posting's employee and month, the amount as the exact whole-Rupiah string the
 * database stores (always the posting's own), the date the payment was made outside TAM OS and its
 * payment method. The seven-key posting projection is unchanged: nothing about an execution is
 * embedded in it (D-FEX-6 = A — AFI-4e's strict decoder is untouched).
 */
final class FinanceExecutionView
{
    public const FIELDS = ['id', 'financePostingId', 'employeeId', 'monthKey', 'amount', 'executedOn', 'paymentMethod'];

    /**
     * @param array<string, mixed> $row an execution row (FinanceExecutionStore::RECORD_SQL)
     * @return array<string, mixed>
     */
    public static function execution(array $row): array
    {
        $out = [
            'id' => (string) $row['id'],
            'financePostingId' => (string) $row['finance_posting_id'],
            'employeeId' => (string) $row['employee_id'],
            'monthKey' => (string) $row['month_key'],
            'amount' => (string) $row['amount'],
            'executedOn' => (string) $row['executed_on'],
            'paymentMethod' => (string) $row['payment_method'],
        ];
        if ($out['financePostingId'] === '' || !PayrollCalculation::isAmount($out['amount']) || $out['amount'] === '0.00'
            || !FinanceExecutionInput::isDate($out['executedOn']) || !in_array($out['paymentMethod'], FinanceExecutionInput::PAYMENT_METHODS, true)) {
            throw new \LogicException('an execution row needs its posting, a positive whole-Rupiah amount, a calendar date and a known payment method');
        }
        return $out;
    }
}
