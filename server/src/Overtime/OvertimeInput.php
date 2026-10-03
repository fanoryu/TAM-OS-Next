<?php
declare(strict_types=1);

namespace TamOs\Overtime;

use TamOs\Employee\EmployeeInput;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;

/**
 * Strict request-body validation for the overtime routes (BF-4b1). Each route has an exact
 * allowlist: any other key — a company, a status, a version, an actor, a timestamp, an amount, a
 * contract, a payroll id, `project`, or `employeeId` on update — is a 400 naming the key. Values
 * are validated, never coerced.
 *
 *   monthKey      required, "YYYY-MM" (owner decision D-BF4b1-1)
 *   overtimeDate  optional "YYYY-MM-DD"; when present it falls inside monthKey (D-BF4b1-1). The
 *                 month is never derived from the date. Both are calendar values: no timezone.
 *   hours         required, the exact decimal STRING "N.NN" — greater than 0, at most 744 and a
 *                 multiple of 0.25 (D-BF4b1-2), checked in integer hundredths, never as a float.
 *                 A JSON number is refused. Hours are time, not money.
 *   workDescription / notes  optional text, trimmed; "" becomes null.
 *
 * BF-4b2: approve takes exactly id, expectedVersion and expectedAmount. expectedAmount is the
 * whole-Rupiah "N.00" the CEO was shown by the valuation preview — an optimistic guard compared
 * for exact equality with the server's own valuation, never stored and never authority. No
 * salary, hours, rate, multiplier, method, status or employee is ever accepted from a browser.
 */
final class OvertimeInput
{
    /** API field → column, in column order (OvertimeStore::RECORD). */
    public const FIELDS = [
        'monthKey' => 'month_key',
        'overtimeDate' => 'overtime_date',
        'hours' => 'hours',
        'workDescription' => 'work_description',
        'notes' => 'notes',
    ];
    public const ID_PATTERN = '/^[0-9a-f]{32}$/';
    public const MAX_VERSION = 4294967295;
    /** D-BF4b1-2 in hundredths of an hour: 0 < hours <= 744, in steps of 0.25. */
    public const MAX_HUNDREDTHS = 74400;
    public const STEP_HUNDREDTHS = 25;

    /**
     * POST /api/overtime-records/create: employeeId and the record fields. employeeId, monthKey
     * and hours are required.
     *
     * @param array<string, mixed> $json
     * @return array{employeeId: string, record: array<string, string|null>} the record keyed by column
     */
    public static function create(array $json): array
    {
        self::onlyKeys($json, array_merge(['employeeId'], array_keys(self::FIELDS)));
        $missing = array_values(array_filter(['employeeId', 'monthKey', 'hours'], static fn (string $k): bool => !array_key_exists($k, $json)));
        if ($missing !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'required overtime field missing', fields: $missing);
        }
        $employeeId = $json['employeeId'];
        $bad = [];
        if (!is_string($employeeId) || preg_match(EmployeeInput::ID_PATTERN, $employeeId) !== 1) {
            $bad[] = 'employeeId';
        }
        $patch = array_diff_key($json, ['employeeId' => true]);
        try {
            $record = self::apply(array_fill_keys(array_values(self::FIELDS), null), $patch);
        } catch (ApiError $e) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid overtime field', fields: array_values(array_unique(array_merge($bad, $e->fields))));
        }
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid overtime field', fields: $bad);
        }
        return ['employeeId' => $employeeId, 'record' => $record];
    }

    /**
     * POST /api/overtime-records/update: id, expectedVersion and at least one record field.
     * The fields are validated now (400 before any lookup); the date/month rule is checked again
     * against the locked record by apply().
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
            throw new ApiError(ErrorCode::ValidationFailed, 'no overtime field to update', fields: array_keys(self::FIELDS));
        }
        $bad = [];
        foreach ($patch as $field => $value) {
            try {
                self::value($field, $value);
            } catch (\InvalidArgumentException) {
                $bad[] = $field;
            }
        }
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid overtime field', fields: $bad);
        }
        return ['id' => $id, 'expectedVersion' => $version, 'patch' => $patch];
    }

    /**
     * delete / submit / review / reject: exactly id and expectedVersion.
     *
     * @param array<string, mixed> $json
     * @return array{id: string, expectedVersion: int}
     */
    public static function transition(array $json): array
    {
        self::onlyKeys($json, ['id', 'expectedVersion']);
        [$id, $version] = self::target($json);
        return ['id' => $id, 'expectedVersion' => $version];
    }

    /**
     * BF-4b2 approve: exactly id, expectedVersion and expectedAmount ("N.00", a JSON string).
     *
     * @param array<string, mixed> $json
     * @return array{id: string, expectedVersion: int, expectedAmount: string}
     */
    public static function approve(array $json): array
    {
        self::onlyKeys($json, ['id', 'expectedVersion', 'expectedAmount']);
        $bad = [];
        try {
            [$id, $version] = self::target($json);
        } catch (ApiError $e) {
            $bad = $e->fields;
        }
        if (!OvertimeValuation::isAmount($json['expectedAmount'] ?? null)) {
            $bad[] = 'expectedAmount';
        }
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid overtime approval', fields: $bad);
        }
        return ['id' => $id, 'expectedVersion' => $version, 'expectedAmount' => $json['expectedAmount']];
    }

    /** GET /api/overtime-records?month= : the required month (400 invalid_query otherwise). */
    public static function month(?string $month): string
    {
        if ($month === null || !self::isMonth($month)) {
            throw new ApiError(ErrorCode::InvalidQuery, 'month must be YYYY-MM');
        }
        return $month;
    }

    /** GET /api/overtime-record?id= */
    public static function id(?string $id): string
    {
        if ($id === null || preg_match(self::ID_PATTERN, $id) !== 1) {
            throw new ApiError(ErrorCode::ValidationFailed, 'overtime id', fields: ['id']);
        }
        return $id;
    }

    /**
     * The record after applying a validated patch (API fields) to a current record (columns),
     * then the date/month rule over the result.
     *
     * @param array<string, string|null> $record keyed by column
     * @param array<string, mixed> $patch keyed by API field
     * @return array<string, string|null>
     */
    public static function apply(array $record, array $patch): array
    {
        $bad = [];
        foreach ($patch as $field => $value) {
            $column = self::FIELDS[$field] ?? null;
            if ($column === null) {
                $bad[] = $field;
                continue;
            }
            try {
                $record[$column] = self::value($field, $value);
            } catch (\InvalidArgumentException) {
                $bad[] = $field;
            }
        }
        if ($bad === [] && $record['overtime_date'] !== null && substr((string) $record['overtime_date'], 0, 7) !== $record['month_key']) {
            $bad[] = 'overtimeDate';
        }
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid overtime field', fields: $bad);
        }
        return $record;
    }

    /**
     * The API field names whose column value differs between two records.
     *
     * @param array<string, string|null> $before
     * @param array<string, string|null> $after
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

    /** True for an exact "N.NN" with 0 < hours <= 744 in quarter-hour steps. */
    public static function isHours(mixed $v): bool
    {
        if (!is_string($v) || preg_match('/^(0|[1-9][0-9]{0,2})\.([0-9]{2})$/', $v, $m) !== 1) {
            return false;
        }
        $hundredths = (int) $m[1] * 100 + (int) $m[2];
        return $hundredths > 0 && $hundredths <= self::MAX_HUNDREDTHS && $hundredths % self::STEP_HUNDREDTHS === 0;
    }

    public static function isMonth(mixed $v): bool
    {
        return is_string($v) && preg_match('/^([0-9]{4})-(0[1-9]|1[0-2])$/', $v, $m) === 1 && (int) $m[1] >= 1900;
    }

    /** One validated, normalized value; InvalidArgumentException when it is not acceptable. */
    private static function value(string $field, mixed $v): ?string
    {
        return match ($field) {
            'monthKey' => self::isMonth($v) ? $v : throw new \InvalidArgumentException(),
            'overtimeDate' => self::date($v),
            'hours' => self::isHours($v) ? $v : throw new \InvalidArgumentException(),
            'workDescription' => self::text($v, 160, false),
            'notes' => self::text($v, 2000, true),
            default => throw new \InvalidArgumentException(),
        };
    }

    private static function date(mixed $v): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_string($v) || preg_match('/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/', $v, $m) !== 1 || !checkdate((int) $m[2], (int) $m[3], (int) $m[1]) || (int) $m[1] < 1900) {
            throw new \InvalidArgumentException();
        }
        return $v;
    }

    private static function text(mixed $v, int $max, bool $multiline): ?string
    {
        if ($v === null) {
            return null;
        }
        if (!is_string($v) || preg_match('//u', $v) !== 1) {
            throw new \InvalidArgumentException();
        }
        $v = trim($v);
        if ($v === '') {
            return null;
        }
        $control = $multiline ? '/[^\P{Cc}\t\n\r]/u' : '/\p{Cc}/u';
        if (preg_match($control, $v) === 1 || preg_match_all('/./su', $v) > $max) {
            throw new \InvalidArgumentException();
        }
        return $v;
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
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid overtime target', fields: $bad);
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
            throw new ApiError(ErrorCode::ValidationFailed, 'unknown overtime field', fields: $named, logReason: 'unknown_field');
        }
    }
}
