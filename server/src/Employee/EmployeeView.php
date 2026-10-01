<?php
declare(strict_types=1);

namespace TamOs\Employee;

/**
 * The least-privilege Employee projections (BF-4a1, SDR-0002 §9.1). A browser receives only
 * the fields its view needs: the company list carries no salary, notes or contact; the self
 * view carries the Employee's own profile but no notes, version or account data. No
 * projection ever carries company_id, the scope columns, an account, a token or a hash.
 */
final class EmployeeView
{
    public const LIST_FIELDS = ['id', 'employeeCode', 'fullName', 'jobTitle', 'department', 'employmentStatus', 'archived'];
    public const DETAIL_FIELDS = ['id', 'employeeCode', 'fullName', 'jobTitle', 'department', 'employmentStatus', 'archived', 'joinDate', 'contactEmail', 'phone', 'notes', 'monthlyBaseSalary', 'version'];
    public const SELF_FIELDS = ['id', 'employeeCode', 'fullName', 'jobTitle', 'department', 'employmentStatus', 'joinDate', 'contactEmail', 'phone', 'monthlyBaseSalary'];

    /**
     * CEO company list item.
     *
     * @param array<string, mixed> $row a profile row (EmployeeStore)
     * @return array<string, mixed>
     */
    public static function listItem(array $row): array
    {
        return self::pick(self::all($row), self::LIST_FIELDS);
    }

    /**
     * CEO detail.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function detail(array $row): array
    {
        return self::pick(self::all($row), self::DETAIL_FIELDS);
    }

    /**
     * The Employee's own profile.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function self(array $row): array
    {
        return self::pick(self::all($row), self::SELF_FIELDS);
    }

    /**
     * The profile columns of a row, keyed by column, as the store writes them back.
     *
     * @param array<string, mixed> $row
     * @return array<string, int|string|null>
     */
    public static function profile(array $row): array
    {
        $out = [];
        foreach (EmployeeInput::FIELDS as $column) {
            $v = $row[$column] ?? null;
            $out[$column] = $v === null ? null : (string) $v;
        }
        return $out;
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private static function all(array $row): array
    {
        $text = static fn (string $c): ?string => isset($row[$c]) ? (string) $row[$c] : null;
        return [
            'id' => (string) $row['id'],
            'employeeCode' => (string) $row['employee_code'],
            'fullName' => (string) $row['full_name'],
            'jobTitle' => $text('job_title'),
            'department' => $text('department'),
            'employmentStatus' => (string) $row['employment_status'],
            'archived' => ($row['archived_at'] ?? null) !== null,
            'joinDate' => $text('join_date'),
            'contactEmail' => $text('contact_email'),
            'phone' => $text('phone'),
            'notes' => $text('notes'),
            'monthlyBaseSalary' => $text('monthly_base_salary'),
            'version' => (int) $row['version'],
        ];
    }

    /**
     * @param array<string, mixed> $all
     * @param list<string> $fields
     * @return array<string, mixed>
     */
    private static function pick(array $all, array $fields): array
    {
        $out = [];
        foreach ($fields as $f) {
            $out[$f] = $all[$f];
        }
        return $out;
    }
}
