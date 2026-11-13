<?php
declare(strict_types=1);

namespace TamOs\Report;

use TamOs\Data\BusinessData;
use TamOs\Data\Report\FinancialReportStore;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Policy\Scope;
use TamOs\Transaction\TransactionInput;

/**
 * The SESSION financial report (Phase 1, D-INT-2): CEO only, read only, one inclusive date range of
 * at most TransactionInput::MAX_RANGE_DAYS days. It adds no Action (a read) and writes nothing —
 * no audit row either. The three reads run in one REPEATABLE READ transaction so the Financial
 * Post lines and the Payroll line come from one consistent snapshot; above REPORT_CAP rows in any
 * read the report fails closed (500), never a partial total.
 *
 *   report  validate ?from=&to= (400) → CEO (403) → FinancialReport::build()
 */
final class FinancialReportService
{
    public function __construct(private readonly BusinessData $data)
    {
    }

    /** @return array<string, mixed> */
    public function report(Principal $actor, ?string $from, ?string $to): array
    {
        $range = TransactionInput::range($from, $to);       // 400 before any lookup
        $scope = Scope::of($actor);
        if ($scope->isSelf()) {                             // an Employee: 403 before any lookup
            throw new ApiError(ErrorCode::Forbidden, 'action denied', logReason: 'action_denied');
        }
        $store = $this->data->report();
        [$transactions, $postings, $executions] = $this->data->atomically(static fn (): array => [
            $store->transactions($scope, $range['from'], $range['to']),
            $store->postings($scope, substr($range['from'], 0, 7), substr($range['to'], 0, 7)),
            $store->executions($scope, $range['from'], $range['to']),
        ]);
        foreach ([$transactions, $postings, $executions] as $rows) {
            if (count($rows) > FinancialReportStore::REPORT_CAP) {
                throw new ApiError(ErrorCode::InternalError, 'financial report above its cap', logReason: 'report_cap');
            }
        }
        return FinancialReport::build($range, $transactions, $postings, $executions);
    }
}
