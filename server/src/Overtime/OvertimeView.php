<?php
declare(strict_types=1);

namespace TamOs\Overtime;

use TamOs\Data\Overtime\OvertimeStore;

/**
 * The overtime projection (BF-4b1): one shape for the CEO and for the owning Employee, who may
 * read their own overtime (SDR-0002 §9.1). Exactly FIELDS — never the company, an actor, a
 * timestamp, an employee name, a contract, a payroll id or any amount, rate, salary or schedule
 * (valuation is BF-4b2). `hours` is the exact "N.NN" string the database stores; `version` is
 * the integer a write sends back as expectedVersion. Anything else in a row is a programming
 * error, never a default.
 */
final class OvertimeView
{
    public const FIELDS = ['id', 'employeeId', 'monthKey', 'overtimeDate', 'hours', 'workDescription', 'notes', 'status', 'version'];

    /**
     * @param array<string, mixed> $row a record row (OvertimeStore)
     * @return array<string, mixed>
     */
    public static function record(array $row): array
    {
        $text = static fn (string $c): ?string => isset($row[$c]) ? (string) $row[$c] : null;
        $out = [
            'id' => (string) $row['id'],
            'employeeId' => (string) $row['employee_id'],
            'monthKey' => (string) $row['month_key'],
            'overtimeDate' => $text('overtime_date'),
            'hours' => (string) $row['hours'],
            'workDescription' => $text('work_description'),
            'notes' => $text('notes'),
            'status' => (string) $row['status'],
            'version' => (int) $row['version'],
        ];
        if (!OvertimeInput::isHours($out['hours']) || !in_array($out['status'], OvertimeStatus::VALUES, true)) {
            throw new \LogicException('an overtime row needs canonical hours and a known status');
        }
        return $out;
    }

    /**
     * The record columns of a row, keyed by column, as the store writes them back.
     *
     * @param array<string, mixed> $row
     * @return array<string, string|null>
     */
    public static function columns(array $row): array
    {
        $out = [];
        foreach (OvertimeStore::RECORD as $column) {
            $v = $row[$column] ?? null;
            $out[$column] = $v === null ? null : (string) $v;
        }
        return $out;
    }
}
