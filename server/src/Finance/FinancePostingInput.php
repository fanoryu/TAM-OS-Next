<?php
declare(strict_types=1);

namespace TamOs\Finance;

use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Payroll\PayrollCalculation;
use TamOs\Payroll\PayrollInput;

/**
 * Strict request validation for the BF-4e Finance posting routes. Each route has an exact
 * allowlist: any other key — a company, an employee, a role, a status, an amount, a month, an
 * account or a category — is a 400 naming the key. Values are validated, never coerced. The browser
 * names the one Committed obligation to post, confirms its amount and supplies the idempotency key;
 * the posted amount is always the server's own.
 *
 *   base plan      exactly { payrollPlanId, expectedAmount, idempotencyKey }
 *   Supplemental   exactly { supplementalPayrollId, expectedAmount, idempotencyKey }
 *                  expectedAmount is the whole-Rupiah "N.00" amount the CEO was shown
 *                  (PayrollCalculation::isAmount, one spelling per value) — a confirmation compared
 *                  for exact string equality with the locked source, never stored and never
 *                  authority; idempotencyKey is 32 lowercase hex characters (SDR-0002 §10), stored
 *                  on the posting
 *   GET ?month=    the required month (400 invalid_query)
 *
 * The id, month and key grammars are PayrollInput's — one source of truth.
 */
final class FinancePostingInput
{
    /**
     * POST /api/finance-postings/payroll-plan
     *
     * @param array<string, mixed> $json
     * @return array{sourceId: string, expectedAmount: string, idempotencyKey: string}
     */
    public static function payrollPlan(array $json): array
    {
        self::onlyKeys($json, ['payrollPlanId', 'expectedAmount', 'idempotencyKey']);
        return self::post($json, 'payrollPlanId');
    }

    /**
     * POST /api/finance-postings/supplemental-payroll
     *
     * @param array<string, mixed> $json
     * @return array{sourceId: string, expectedAmount: string, idempotencyKey: string}
     */
    public static function supplementalPayroll(array $json): array
    {
        self::onlyKeys($json, ['supplementalPayrollId', 'expectedAmount', 'idempotencyKey']);
        return self::post($json, 'supplementalPayrollId');
    }

    /** GET ?month= : the required month (400 invalid_query otherwise). */
    public static function month(?string $month): string
    {
        return PayrollInput::month($month);
    }

    /**
     * @param array<string, mixed> $json
     * @return array{sourceId: string, expectedAmount: string, idempotencyKey: string}
     */
    private static function post(array $json, string $source): array
    {
        $bad = [];
        $id = $json[$source] ?? null;
        if (!is_string($id) || preg_match(PayrollInput::ID_PATTERN, $id) !== 1) {
            $bad[] = $source;
        }
        if (!PayrollCalculation::isAmount($json['expectedAmount'] ?? null)) {
            $bad[] = 'expectedAmount';
        }
        $key = $json['idempotencyKey'] ?? null;
        if (!is_string($key) || preg_match(PayrollInput::KEY_PATTERN, $key) !== 1) {
            $bad[] = 'idempotencyKey';
        }
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid finance posting', fields: $bad);
        }
        return ['sourceId' => $id, 'expectedAmount' => $json['expectedAmount'], 'idempotencyKey' => $key];
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
            throw new ApiError(ErrorCode::ValidationFailed, 'unknown finance posting field', fields: $named, logReason: 'unknown_field');
        }
    }
}
