<?php
declare(strict_types=1);

namespace TamOs\Employee;

/**
 * The least-privilege Employee projections (BF-4a1, SDR-0002 §9.1). A browser receives only
 * the fields its view needs: the company list carries no salary, notes or contact; the self
 * view carries the Employee's own profile but no notes, version or account data. No
 * projection ever carries company_id, the scope columns, an account, a token or a hash.
 *
 * BF-4a2 (SDR-0004): the CEO list and detail add `accountState` — none, pending, active or
 * disabled, derived by EmployeeStore — and nothing else about the login: no email, user id,
 * membership id, hash, token, session or mail detail. The self view gains nothing.
 *
 * BF-4a3: right after it, the CEO list and detail add `accountManageable` — a boolean derived by
 * EmployeeStore: whether the record is currently a valid target for Employee account
 * administration. It is output only (never read back from a request, never authority) and says
 * nothing more about the login. The self view still gains nothing.
 */
final class EmployeeView
{
    public const LIST_FIELDS = ['id', 'employeeCode', 'fullName', 'jobTitle', 'department', 'employmentStatus', 'archived', 'accountState', 'accountManageable'];
    public const DETAIL_FIELDS = ['id', 'employeeCode', 'fullName', 'jobTitle', 'department', 'employmentStatus', 'archived', 'joinDate', 'contactEmail', 'phone', 'notes', 'monthlyBaseSalary', 'version', 'accountState', 'accountManageable'];
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
            'accountState' => $row['account_state'] ?? null,
            'accountManageable' => $row['account_manageable'] ?? null,
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
        if (array_key_exists('accountState', $out) && !in_array($out['accountState'], AccountState::VALUES, true)) {
            throw new \LogicException('a CEO projection needs the derived account state');
        }
        // BF-4a3: exactly the SQL 1 / 0 (as the driver returns it) becomes a boolean; anything else
        // — missing, NULL, another value — is a programming error, never a default.
        if (array_key_exists('accountManageable', $out)) {
            $m = $out['accountManageable'];
            if ($m === 1 || $m === '1') {
                $out['accountManageable'] = true;
            } elseif ($m === 0 || $m === '0') {
                $out['accountManageable'] = false;
            } else {
                throw new \LogicException('a CEO projection needs the derived account manageability');
            }
        }
        return $out;
    }
}
