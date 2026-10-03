<?php
declare(strict_types=1);

namespace TamOs\Payroll;

use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Overtime\OvertimeInput;

/**
 * Strict request validation for the BF-4c1 payroll routes. Each route has an exact allowlist: any
 * other key — a company, an employee, a role, a status, a salary, an amount, a total, an hours
 * value — is a 400 naming the key. Values are validated, never coerced. The browser supplies
 * identifiers and an optimistic version only; every money value is the server's own.
 *
 *   generate                         exactly { month }: "YYYY-MM", the canonical month (the same
 *                                    validation as overtime monthKey; a calendar value, no timezone)
 *   review / approve / return / cancel   exactly { id, expectedVersion }
 *   GET ?month= / ?id=               the required month (400 invalid_query) / the plan id
 */
final class PayrollInput
{
    public const ID_PATTERN = '/^[0-9a-f]{32}$/';
    public const MAX_VERSION = 4294967295;

    /**
     * POST /api/payroll-plans/generate: exactly the month.
     *
     * @param array<string, mixed> $json
     */
    public static function generate(array $json): string
    {
        self::onlyKeys($json, ['month']);
        if (!self::isMonth($json['month'] ?? null)) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid payroll month', fields: ['month']);
        }
        return $json['month'];
    }

    /**
     * review / approve / return / cancel: exactly id and expectedVersion.
     *
     * @param array<string, mixed> $json
     * @return array{id: string, expectedVersion: int}
     */
    public static function transition(array $json): array
    {
        self::onlyKeys($json, ['id', 'expectedVersion']);
        $bad = [];
        if (!is_string($json['id'] ?? null) || preg_match(self::ID_PATTERN, $json['id']) !== 1) {
            $bad[] = 'id';
        }
        $version = $json['expectedVersion'] ?? null;
        if (!is_int($version) || $version < 1 || $version > self::MAX_VERSION) {
            $bad[] = 'expectedVersion';
        }
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid payroll target', fields: $bad);
        }
        return ['id' => $json['id'], 'expectedVersion' => $version];
    }

    /** GET /api/payroll-plans?month= : the required month (400 invalid_query otherwise). */
    public static function month(?string $month): string
    {
        if ($month === null || !self::isMonth($month)) {
            throw new ApiError(ErrorCode::InvalidQuery, 'month must be YYYY-MM');
        }
        return $month;
    }

    /** GET /api/payroll-plan?id= */
    public static function id(?string $id): string
    {
        if ($id === null || preg_match(self::ID_PATTERN, $id) !== 1) {
            throw new ApiError(ErrorCode::ValidationFailed, 'payroll plan id', fields: ['id']);
        }
        return $id;
    }

    /** The canonical month: exactly the overtime monthKey rule, one source of truth. */
    public static function isMonth(mixed $v): bool
    {
        return OvertimeInput::isMonth($v);
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
            throw new ApiError(ErrorCode::ValidationFailed, 'unknown payroll field', fields: $named, logReason: 'unknown_field');
        }
    }
}
