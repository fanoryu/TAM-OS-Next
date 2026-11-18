<?php
declare(strict_types=1);

namespace TamOs\Data\Report;

use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Policy\Scope;

/**
 * The SESSION financial report reads (Phase 1, D-INT-2): three fixed, read-only SELECTs in CEO
 * company scope. No write, no locking read and no Employee statement — the report never changes a
 * transaction, a posting or an execution; each table keeps its own single writer.
 *
 *   TRANSACTIONS_SQL  the general transactions dated in the range, with whether each is voided —
 *                     the Financial Post lines
 *   POSTINGS_SQL      the payroll Finance postings (base plan and Supplemental) of the payroll
 *                     months the range touches — the Payroll line, "posted"
 *   EXECUTIONS_SQL    the payroll Finance executions dated in the range — the Payroll line, "paid"
 *   APPROVED_SQL      Phase 2 (ADR-016 §6): the Approved, not yet paid finance requests whose
 *                     documentDate is in the range — the "Approved, not paid" line, never a total
 *
 * Payroll is read only from finance_postings and finance_executions and general transactions only
 * from finance_transactions: no row can be counted on both sides. A paid finance request is counted
 * only through its linked general expense; an Approved one only on its own line, outside every total
 * — the pay transaction moves it from one to the other in one commit, so it is never in both. The report sums the stored
 * "N.00" strings in PHP (FinancialReport), never in SQL. Each read takes at most REPORT_LIMIT rows,
 * so a caller can tell that REPORT_CAP was exceeded and fail closed — never a partial total.
 */
final class FinancialReportStore
{
    public const REPORT_CAP = 20000;
    public const REPORT_LIMIT = 20001;

    public const TRANSACTIONS_SQL = 'SELECT t.id, t.company_id, NULL AS owner_employee_id, t.kind, t.financial_post, t.amount, t.transaction_date, v.id AS void_id FROM finance_transactions t LEFT JOIN finance_transaction_voids v ON v.company_id = t.company_id AND v.finance_transaction_id = t.id WHERE t.company_id = :company_id AND t.transaction_date >= :from_date AND t.transaction_date <= :to_date ORDER BY t.id LIMIT 20001';
    public const POSTINGS_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, source_kind, month_key, amount FROM finance_postings WHERE company_id = :company_id AND month_key >= :from_month AND month_key <= :to_month ORDER BY id LIMIT 20001';
    public const EXECUTIONS_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id, amount, executed_on FROM finance_executions WHERE company_id = :company_id AND executed_on >= :from_date AND executed_on <= :to_date ORDER BY id LIMIT 20001';
    public const APPROVED_SQL = "SELECT id, company_id, NULL AS owner_employee_id, financial_post, amount, document_date FROM finance_requests WHERE company_id = :company_id AND status = 'Approved' AND document_date >= :from_date AND document_date <= :to_date ORDER BY id LIMIT 20001";

    public function __construct(private readonly ScopedDatabase $db)
    {
    }

    /** @return list<array<string, mixed>> */
    public function transactions(Scope $scope, string $from, string $to): array
    {
        self::companyOnly($scope);
        return $this->db->select($scope, self::TRANSACTIONS_SQL, ['from_date' => self::date($from), 'to_date' => self::date($to)]);
    }

    /** @return list<array<string, mixed>> */
    public function postings(Scope $scope, string $fromMonth, string $toMonth): array
    {
        self::companyOnly($scope);
        return $this->db->select($scope, self::POSTINGS_SQL, ['from_month' => self::month($fromMonth), 'to_month' => self::month($toMonth)]);
    }

    /** @return list<array<string, mixed>> */
    public function executions(Scope $scope, string $from, string $to): array
    {
        self::companyOnly($scope);
        return $this->db->select($scope, self::EXECUTIONS_SQL, ['from_date' => self::date($from), 'to_date' => self::date($to)]);
    }

    /**
     * Phase 2 (ADR-016 §6): the Approved, unpaid finance requests with a documentDate in the range.
     *
     * @return list<array<string, mixed>>
     */
    public function approved(Scope $scope, string $from, string $to): array
    {
        self::companyOnly($scope);
        return $this->db->select($scope, self::APPROVED_SQL, ['from_date' => self::date($from), 'to_date' => self::date($to)]);
    }

    private static function companyOnly(Scope $scope): void
    {
        if ($scope->isSelf()) {
            throw new \LogicException('financial report reads are company scope only');
        }
    }

    private static function date(string $v): string
    {
        if (preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/', $v) !== 1) {
            throw new \LogicException('a report date is YYYY-MM-DD');
        }
        return $v;
    }

    private static function month(string $v): string
    {
        if (preg_match('/^[0-9]{4}-(0[1-9]|1[0-2])$/', $v) !== 1) {
            throw new \LogicException('a report month is YYYY-MM');
        }
        return $v;
    }
}
