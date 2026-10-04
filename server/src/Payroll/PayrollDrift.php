<?php
declare(strict_types=1);

namespace TamOs\Payroll;

/**
 * The BF-4c2 drift guard (owner decisions D-PAY-4 = A, D-BF4c2-2 = A, D-BF4c2-4 = A): the ONE
 * definition of whether a plan still matches the server's current inputs. Commit refuses a drifted
 * plan (409) inside its locked transaction, and the CEO drift read explains it — both call
 * reasons(), so the two can never disagree.
 *
 * A plan has drifted when generate would no longer produce it:
 *
 *   employee_archived     the employee is archived now
 *   employee_not_active   the employee's employment status is not Active now
 *   salary_missing        the employee has no monthly base salary > 0 now
 *   salary_changed        the employee's monthly base salary differs from the plan's base salary
 *                         (exact decimal strings; never compared numerically)
 *   overtime_changed      the employee's Approved overtime of the plan month is not exactly the
 *                         plan's linked set — an id added or missing — or the existing
 *                         PayrollCalculation over the plan's base salary and that Approved set no
 *                         longer gives the plan's overtime amount, hours, count and total
 *
 * The employee's code, name and department are display snapshots and never drift. Reasons come in
 * REASONS order, each at most once; no reason means current. Payroll never values overtime here
 * either: the frozen approved amounts go through the same calculation generate uses — no second
 * formula, no rounding of its own, no float. Pure: no SQL, no clock, no state.
 */
final class PayrollDrift
{
    /** The closed reason enum, in its fixed order. */
    public const REASONS = ['employee_archived', 'employee_not_active', 'salary_missing', 'salary_changed', 'overtime_changed'];

    /**
     * @param array<string, mixed> $plan the plan row: base_salary, overtime_amount, overtime_hours, overtime_count, total_amount
     * @param array<string, mixed> $employee the employee row: archived_at, employment_status, monthly_base_salary
     * @param list<array<string, mixed>> $approved the employee's Approved overtime of the plan month: id, hours, approved_amount
     * @param list<string> $linked the overtime ids linked to the plan
     * @return list<string> the drift reasons, in REASONS order; [] when the plan is current
     */
    public static function reasons(array $plan, array $employee, array $approved, array $linked): array
    {
        $out = [];
        if ($employee['archived_at'] !== null) {
            $out[] = 'employee_archived';
        }
        if ($employee['employment_status'] !== 'Active') {
            $out[] = 'employee_not_active';
        }
        $salary = $employee['monthly_base_salary'];
        if ($salary === null || !PayrollCalculation::isSalary((string) $salary)) {
            $out[] = 'salary_missing';
        } elseif ((string) $salary !== (string) $plan['base_salary']) {
            $out[] = 'salary_changed';
        }
        if (!self::sameOvertime($plan, $approved, $linked)) {
            $out[] = 'overtime_changed';
        }
        return $out;
    }

    /**
     * @param array<string, mixed> $plan
     * @param list<array<string, mixed>> $approved
     * @param list<string> $linked
     */
    private static function sameOvertime(array $plan, array $approved, array $linked): bool
    {
        $ids = array_map(static fn (array $o): string => (string) $o['id'], $approved);
        sort($ids, SORT_STRING);
        sort($linked, SORT_STRING);
        if ($ids !== $linked) {
            return false;
        }
        try {
            $calc = PayrollCalculation::calculate((string) $plan['base_salary'], array_map(
                static fn (array $o): array => ['hours' => (string) $o['hours'], 'amount' => (string) $o['approved_amount']],
                $approved,
            ));
        } catch (PayrollOutOfBounds) {
            return false;                                   // the Approved set no longer fits the plan
        }
        return $calc['overtimeAmount'] === (string) $plan['overtime_amount']
            && $calc['overtimeHours'] === (string) $plan['overtime_hours']
            && $calc['overtimeCount'] === (int) $plan['overtime_count']
            && $calc['totalAmount'] === (string) $plan['total_amount'];
    }
}
