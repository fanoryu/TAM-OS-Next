<?php
declare(strict_types=1);

namespace TamOs\Employee;

use TamOs\Auth\EmailAddress;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;

/**
 * Strict request-body validation for the Employee routes (BF-4a1). Each route has an exact
 * allowlist: any other key — company_id, version, archived_at, an actor, an id on create —
 * is a 400 naming the key, so nothing is mass-assigned and no scope value is ever accepted
 * from a browser. Values are validated, never coerced: strings are trimmed (the frontend
 * convention), an optional field sent as "" becomes null, the e-mail is normalized as
 * TamOs\Auth\EmailAddress does, and money is an exact decimal (an integer or a string, never
 * a float). Anything else is a 400 naming the field.
 */
final class EmployeeInput
{
    /** API field → column, in column order (EmployeeStore::PROFILE). */
    public const FIELDS = [
        'employeeCode' => 'employee_code',
        'fullName' => 'full_name',
        'jobTitle' => 'job_title',
        'department' => 'department',
        'employmentStatus' => 'employment_status',
        'joinDate' => 'join_date',
        'contactEmail' => 'contact_email',
        'phone' => 'phone',
        'notes' => 'notes',
        'monthlyBaseSalary' => 'monthly_base_salary',
    ];
    public const STATUSES = ['Active', 'Inactive', 'On Leave', 'Resigned', 'Terminated'];
    public const ID_PATTERN = '/^[A-Za-z0-9_-]{1,64}$/';
    public const MAX_VERSION = 4294967295;

    /**
     * POST /api/employees/create: the profile fields only. employeeCode and fullName are
     * required; employmentStatus defaults to Active; anything absent is null.
     *
     * @param array<string, mixed> $json
     * @return array<string, int|string|null> the profile, keyed by column in column order
     */
    public static function create(array $json): array
    {
        self::onlyKeys($json, array_keys(self::FIELDS));
        $missing = array_values(array_filter(['employeeCode', 'fullName'], static fn (string $k): bool => !array_key_exists($k, $json)));
        if ($missing !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'required employee field missing', fields: $missing);
        }
        $json += ['employmentStatus' => 'Active'];
        $profile = [];
        foreach (self::FIELDS as $field => $column) {
            $profile[$column] = null;
        }
        return self::apply($profile, $json);
    }

    /**
     * POST /api/employees/update: id, expectedVersion and at least one profile field.
     *
     * @param array<string, mixed> $json
     * @return array{id: string, expectedVersion: int, patch: array<string, mixed>} patch keyed by API field
     */
    public static function update(array $json): array
    {
        self::onlyKeys($json, array_merge(['id', 'expectedVersion'], array_keys(self::FIELDS)));
        [$id, $version] = self::target($json);
        $patch = array_diff_key($json, ['id' => true, 'expectedVersion' => true]);
        if ($patch === []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'no employee field to update', fields: array_keys(self::FIELDS));
        }
        // Validated now (400 before any lookup); applied to the locked row later.
        self::apply(array_fill_keys(array_values(self::FIELDS), null), $patch);
        return ['id' => $id, 'expectedVersion' => $version, 'patch' => $patch];
    }

    /**
     * POST /api/employees/archive: exactly id and expectedVersion.
     *
     * @param array<string, mixed> $json
     * @return array{id: string, expectedVersion: int}
     */
    public static function archive(array $json): array
    {
        self::onlyKeys($json, ['id', 'expectedVersion']);
        [$id, $version] = self::target($json);
        return ['id' => $id, 'expectedVersion' => $version];
    }

    /**
     * BF-4a2 POST /api/employees/provision-account: exactly id and the login email. The email is
     * normalized as TamOs\Auth\EmailAddress does for every account; a company, user, role,
     * status, token or password is an unknown key (400).
     *
     * @param array<string, mixed> $json
     * @return array{id: string, email: string}
     */
    public static function provision(array $json): array
    {
        self::onlyKeys($json, ['id', 'email']);
        $bad = [];
        if (!is_string($json['id'] ?? null) || preg_match(self::ID_PATTERN, $json['id']) !== 1) {
            $bad[] = 'id';
        }
        $email = is_string($json['email'] ?? null) ? EmailAddress::candidate($json['email']) : '';
        if (!EmailAddress::isValid($email)) {
            $bad[] = 'email';
        }
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid account request', fields: $bad);
        }
        return ['id' => $json['id'], 'email' => $email];
    }

    /**
     * BF-4a2 reissue-activation / disable-account / enable-account: exactly the Employee id.
     *
     * @param array<string, mixed> $json
     */
    public static function accountTarget(array $json): string
    {
        self::onlyKeys($json, ['id']);
        if (!is_string($json['id'] ?? null) || preg_match(self::ID_PATTERN, $json['id']) !== 1) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid employee target', fields: ['id']);
        }
        return $json['id'];
    }

    /**
     * The profile after applying a validated patch (API fields) to a current profile (columns).
     *
     * @param array<string, int|string|null> $profile keyed by column
     * @param array<string, mixed> $patch keyed by API field
     * @return array<string, int|string|null>
     */
    public static function apply(array $profile, array $patch): array
    {
        $bad = [];
        foreach ($patch as $field => $value) {
            $column = self::FIELDS[$field] ?? null;
            if ($column === null) {
                $bad[] = $field;
                continue;
            }
            try {
                $profile[$column] = self::value($field, $value);
            } catch (\InvalidArgumentException) {
                $bad[] = $field;
            }
        }
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid employee field', fields: $bad);
        }
        return $profile;
    }

    /**
     * The API field names whose column value differs between two profiles.
     *
     * @param array<string, int|string|null> $before
     * @param array<string, int|string|null> $after
     * @return list<string>
     */
    public static function changed(array $before, array $after): array
    {
        $out = [];
        foreach (self::FIELDS as $field => $column) {
            if (($before[$column] ?? null) !== ($after[$column] ?? null)) {
                $out[] = $field;
            }
        }
        return $out;
    }

    /** One validated, normalized value; InvalidArgumentException when it is not acceptable. */
    private static function value(string $field, mixed $v): int|string|null
    {
        return match ($field) {
            'employeeCode' => self::text($v, 32, true),
            'fullName' => self::text($v, 160, true),
            'jobTitle', 'department' => self::text($v, 120, false),
            'employmentStatus' => is_string($v) && in_array($v, self::STATUSES, true) ? $v : throw new \InvalidArgumentException(),
            'joinDate' => self::date($v),
            'contactEmail' => self::email($v),
            'phone' => self::phone($v),
            'notes' => self::text($v, 2000, false, true),
            'monthlyBaseSalary' => self::money($v),
        };
    }

    private static function text(mixed $v, int $max, bool $required, bool $multiline = false): ?string
    {
        if ($v === null && !$required) {
            return null;
        }
        if (!is_string($v) || preg_match('//u', $v) !== 1) {
            throw new \InvalidArgumentException();
        }
        $v = trim($v);
        if ($v === '') {
            return $required ? throw new \InvalidArgumentException() : null;
        }
        $control = $multiline ? '/[^\P{Cc}\t\n\r]/u' : '/\p{Cc}/u';
        if (preg_match($control, $v) === 1 || preg_match_all('/./su', $v) > $max) {
            throw new \InvalidArgumentException();
        }
        return $v;
    }

    private static function date(mixed $v): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_string($v) || preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m) !== 1 || !checkdate((int) $m[2], (int) $m[3], (int) $m[1]) || (int) $m[1] < 1900) {
            throw new \InvalidArgumentException();
        }
        return $v;
    }

    private static function email(mixed $v): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_string($v)) {
            throw new \InvalidArgumentException();
        }
        $candidate = EmailAddress::candidate($v);
        if ($candidate === '') {
            return null;
        }
        return EmailAddress::isValid($candidate) ? $candidate : throw new \InvalidArgumentException();
    }

    private static function phone(mixed $v): ?string
    {
        if ($v === null) {
            return null;
        }
        if (!is_string($v)) {
            throw new \InvalidArgumentException();
        }
        $v = trim($v);
        if ($v === '') {
            return null;
        }
        return preg_match('/^[0-9+()\-. ]{1,40}$/', $v) === 1 ? $v : throw new \InvalidArgumentException();
    }

    /** An exact, non-negative amount with at most 2 decimals, as the canonical "N.NN" string. */
    private static function money(mixed $v): ?string
    {
        if ($v === null) {
            return null;
        }
        if (is_int($v)) {
            $v = (string) $v;
        }
        if (!is_string($v) || preg_match('/^(\d{1,13})(?:\.(\d{1,2}))?$/', $v, $m) !== 1) {
            throw new \InvalidArgumentException();
        }
        $whole = ltrim($m[1], '0');
        return ($whole === '' ? '0' : $whole) . '.' . str_pad($m[2] ?? '', 2, '0');
    }

    /**
     * @param array<string, mixed> $json
     * @return array{0: string, 1: int}
     */
    private static function target(array $json): array
    {
        $bad = [];
        if (!is_string($json['id'] ?? null) || preg_match(self::ID_PATTERN, $json['id']) !== 1) {
            $bad[] = 'id';
        }
        $version = $json['expectedVersion'] ?? null;
        if (!is_int($version) || $version < 1 || $version > self::MAX_VERSION) {
            $bad[] = 'expectedVersion';
        }
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid employee target', fields: $bad);
        }
        return [$json['id'], $version];
    }

    /**
     * Refuses any key outside the allowlist, naming it (names only — never a value).
     *
     * @param array<string, mixed> $json
     * @param list<string> $allowed
     */
    private static function onlyKeys(array $json, array $allowed): void
    {
        $unknown = array_values(array_diff(array_map('strval', array_keys($json)), $allowed));
        if ($unknown !== []) {
            $named = array_values(array_filter($unknown, static fn (string $k): bool => preg_match('/^[A-Za-z][A-Za-z0-9_]{0,63}$/', $k) === 1));
            throw new ApiError(ErrorCode::ValidationFailed, 'unknown employee field', fields: $named, logReason: 'unknown_field');
        }
    }
}
