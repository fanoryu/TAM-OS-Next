<?php
declare(strict_types=1);

namespace TamOs\Supplemental;

use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Payroll\PayrollCalculation;
use TamOs\Payroll\PayrollInput;

/**
 * Strict request validation for the BF-4d Supplemental Payroll routes. Each route has an exact
 * allowlist: any other key — a company, an employee, a role, a status, an amount, an hours value,
 * an overtime id — is a 400 naming the key. Values are validated, never coerced. The browser
 * supplies identifiers and an optimistic version only; every money value is the server's own.
 *
 *   generate                         exactly { payrollPlanId }: the Committed base plan to settle
 *   review / approve / return / cancel   exactly { id, expectedVersion }
 *   commit                           exactly { id, expectedVersion, expectedTotal, idempotencyKey }:
 *                                    expectedTotal is the whole-Rupiah "N.00" amount the CEO was
 *                                    shown (PayrollCalculation::isAmount, one spelling per value) — a
 *                                    confirmation compared for exact string equality with the locked
 *                                    document, never stored and never authority; idempotencyKey is
 *                                    32 lowercase hex characters, stored on the committed document
 *   GET ?month= / ?id=               the required month (400 invalid_query) / the document id
 *
 * The id, version, month and key grammars are PayrollInput's — one source of truth.
 */
final class SupplementalInput
{
    /**
     * POST /api/supplemental-payrolls/generate: exactly the base plan id.
     *
     * @param array<string, mixed> $json
     */
    public static function generate(array $json): string
    {
        self::onlyKeys($json, ['payrollPlanId']);
        $id = $json['payrollPlanId'] ?? null;
        if (!is_string($id) || preg_match(PayrollInput::ID_PATTERN, $id) !== 1) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid supplemental base plan', fields: ['payrollPlanId']);
        }
        return $id;
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
        $bad = self::target($json);
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid supplemental target', fields: $bad);
        }
        return ['id' => $json['id'], 'expectedVersion' => $json['expectedVersion']];
    }

    /**
     * commit: exactly id, expectedVersion, expectedTotal ("N.00", a JSON string) and
     * idempotencyKey (32 lowercase hex characters, a JSON string). Never coerced.
     *
     * @param array<string, mixed> $json
     * @return array{id: string, expectedVersion: int, expectedTotal: string, idempotencyKey: string}
     */
    public static function commit(array $json): array
    {
        self::onlyKeys($json, ['id', 'expectedVersion', 'expectedTotal', 'idempotencyKey']);
        $bad = self::target($json);
        if (!PayrollCalculation::isAmount($json['expectedTotal'] ?? null)) {
            $bad[] = 'expectedTotal';
        }
        $key = $json['idempotencyKey'] ?? null;
        if (!is_string($key) || preg_match(PayrollInput::KEY_PATTERN, $key) !== 1) {
            $bad[] = 'idempotencyKey';
        }
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid supplemental commit', fields: $bad);
        }
        return ['id' => $json['id'], 'expectedVersion' => $json['expectedVersion'], 'expectedTotal' => $json['expectedTotal'], 'idempotencyKey' => $key];
    }

    /** GET ?month= : the required month (400 invalid_query otherwise). */
    public static function month(?string $month): string
    {
        return PayrollInput::month($month);
    }

    /** GET /api/supplemental-payroll?id= */
    public static function id(?string $id): string
    {
        if ($id === null || preg_match(PayrollInput::ID_PATTERN, $id) !== 1) {
            throw new ApiError(ErrorCode::ValidationFailed, 'supplemental payroll id', fields: ['id']);
        }
        return $id;
    }

    /**
     * The invalid target fields of a write: the document id and the optimistic version.
     *
     * @param array<string, mixed> $json
     * @return list<string>
     */
    private static function target(array $json): array
    {
        $bad = [];
        if (!is_string($json['id'] ?? null) || preg_match(PayrollInput::ID_PATTERN, $json['id']) !== 1) {
            $bad[] = 'id';
        }
        $version = $json['expectedVersion'] ?? null;
        if (!is_int($version) || $version < 1 || $version > PayrollInput::MAX_VERSION) {
            $bad[] = 'expectedVersion';
        }
        return $bad;
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
            throw new ApiError(ErrorCode::ValidationFailed, 'unknown supplemental field', fields: $named, logReason: 'unknown_field');
        }
    }
}
