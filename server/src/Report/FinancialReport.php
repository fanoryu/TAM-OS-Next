<?php
declare(strict_types=1);

namespace TamOs\Report;

use TamOs\Payroll\PayrollCalculation;
use TamOs\Transaction\FinancialPost;
use TamOs\Transaction\TransactionInput;

/**
 * The SESSION financial report arithmetic (Phase 1, D-INT-2): pure, deterministic integer
 * arithmetic over the stored whole-Rupiah "N.00" strings — no float, no rounding, no SQL money.
 *
 *   posts         one line per Financial Post, in FinancialPost order (every post, even with no
 *                 rows): income, expense, net = income − expense, and the count of Active rows
 *   general       the four posts summed — the general transactions only
 *   voided        the count and amount of voided transactions in the range: shown, never counted
 *   payroll       the separate, UNALLOCATED payroll line: never split across Financial Posts and
 *                 never counted inside a post or the general total —
 *                   posted  the Finance postings of the payroll months the range touches
 *                           (fromMonth..toMonth: a payroll obligation belongs to a month, not a day)
 *                   paid    the Finance executions dated in the range
 *   consolidated  income = general income; expense = general expense + payroll PAID (each
 *                 obligation counted once, when its cash leaves); net = income − expense. Payroll
 *                 posted is a commitment shown beside it, never added to it.
 *
 * Amounts are reported as "N.00" (net may be "-N.00"). A sum beyond PHP_INT_MAX Rupiah is refused
 * as a defect (never a wrapped number).
 */
final class FinancialReport
{
    /**
     * @param array{from: string, to: string} $range
     * @param list<array<string, mixed>> $transactions FinancialReportStore::TRANSACTIONS_SQL rows
     * @param list<array<string, mixed>> $postings     FinancialReportStore::POSTINGS_SQL rows
     * @param list<array<string, mixed>> $executions   FinancialReportStore::EXECUTIONS_SQL rows
     * @return array<string, mixed>
     */
    public static function build(array $range, array $transactions, array $postings, array $executions): array
    {
        $lines = [];
        foreach (FinancialPost::cases() as $post) {
            $lines[$post->value] = ['income' => 0, 'expense' => 0, 'count' => 0];
        }
        $voidedCount = 0;
        $voidedAmount = 0;
        foreach ($transactions as $row) {
            $amount = self::rupiah($row['amount']);
            $date = (string) $row['transaction_date'];
            if (strcmp($date, $range['from']) < 0 || strcmp($date, $range['to']) > 0) {
                throw new \LogicException('a report transaction is dated outside its range');
            }
            if ($row['void_id'] !== null) {
                $voidedCount++;
                $voidedAmount = self::add($voidedAmount, $amount);
                continue;
            }
            $code = (string) $row['financial_post'];
            if (!isset($lines[$code]) || !in_array($row['kind'], TransactionInput::KINDS, true)) {
                throw new \LogicException('a report transaction needs a known Financial Post and kind');
            }
            $lines[$code][(string) $row['kind']] = self::add($lines[$code][(string) $row['kind']], $amount);
            $lines[$code]['count']++;
        }

        $posts = [];
        $income = 0;
        $expense = 0;
        $count = 0;
        foreach (FinancialPost::cases() as $post) {
            $l = $lines[$post->value];
            $posts[] = ['code' => $post->value, 'name' => $post->displayName(), 'income' => self::money($l['income']), 'expense' => self::money($l['expense']), 'net' => self::money($l['income'] - $l['expense']), 'count' => $l['count']];
            $income = self::add($income, $l['income']);
            $expense = self::add($expense, $l['expense']);
            $count += $l['count'];
        }

        $fromMonth = substr($range['from'], 0, 7);
        $toMonth = substr($range['to'], 0, 7);
        $posted = 0;
        foreach ($postings as $row) {
            $month = (string) $row['month_key'];
            if (strcmp($month, $fromMonth) < 0 || strcmp($month, $toMonth) > 0) {
                throw new \LogicException('a report posting belongs to a month outside its range');
            }
            $posted = self::add($posted, self::rupiah($row['amount']));
        }
        $paid = 0;
        foreach ($executions as $row) {
            $on = (string) $row['executed_on'];
            if (strcmp($on, $range['from']) < 0 || strcmp($on, $range['to']) > 0) {
                throw new \LogicException('a report execution is dated outside its range');
            }
            $paid = self::add($paid, self::rupiah($row['amount']));
        }
        $consolidatedExpense = self::add($expense, $paid);

        return [
            'from' => $range['from'],
            'to' => $range['to'],
            'posts' => $posts,
            'general' => ['income' => self::money($income), 'expense' => self::money($expense), 'net' => self::money($income - $expense), 'count' => $count],
            'voided' => ['count' => $voidedCount, 'amount' => self::money($voidedAmount)],
            'payroll' => [
                'posted' => ['amount' => self::money($posted), 'count' => count($postings), 'fromMonth' => $fromMonth, 'toMonth' => $toMonth],
                'paid' => ['amount' => self::money($paid), 'count' => count($executions)],
            ],
            'consolidated' => ['income' => self::money($income), 'expense' => self::money($consolidatedExpense), 'net' => self::money($income - $consolidatedExpense)],
        ];
    }

    /** A stored positive "N.00" amount as whole Rupiah. */
    private static function rupiah(mixed $amount): int
    {
        if (!PayrollCalculation::isAmount($amount) || $amount === '0.00') {
            throw new \LogicException('a report amount is a positive whole-Rupiah "N.00" string');
        }
        return (int) substr($amount, 0, -3);
    }

    private static function add(int $a, int $b): int
    {
        if ($b > PHP_INT_MAX - $a) {
            throw new \LogicException('a report total exceeds the integer range');
        }
        return $a + $b;
    }

    private static function money(int $rupiah): string
    {
        return $rupiah . '.00';
    }
}
