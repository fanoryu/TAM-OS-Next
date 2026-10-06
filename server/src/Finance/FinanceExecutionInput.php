<?php
declare(strict_types=1);

namespace TamOs\Finance;

use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Payroll\PayrollCalculation;
use TamOs\Payroll\PayrollInput;

/**
 * Strict request validation for the BF-4f Finance execution routes. The command has an exact
 * allowlist: any other key — a company, an employee, a role, an amount, a month, a status, a company
 * account, a bank, a reference or a note — is a 400 naming the key. Values are validated, never
 * coerced. The browser names the one Planned posting it records as paid, confirms its amount, states
 * when and how the payment was made outside TAM OS and supplies the idempotency key; the executed
 * amount is always the server's own (D-FEX-3 = A).
 *
 *   execute     exactly { financePostingId, expectedAmount, executedOn, paymentMethod, idempotencyKey }
 *               expectedAmount is the whole-Rupiah "N.00" amount the CEO was shown
 *               (PayrollCalculation::isAmount, one spelling per value) — a confirmation compared for
 *               exact string equality with the locked posting, never stored and never authority;
 *               executedOn is a real calendar date "YYYY-MM-DD" no later than today in the company
 *               calendar (COMPANY_TIMEZONE), with no lower bound (D-FEX-8 = A); paymentMethod is one
 *               of PAYMENT_METHODS (D-FEX-5 = A); idempotencyKey is 32 lowercase hex characters
 *               (SDR-0002 §10), stored on the execution
 *   GET ?month= the required month (400 invalid_query)
 *
 * The id, month and key grammars are PayrollInput's — one source of truth.
 */
final class FinanceExecutionInput
{
    /** The closed payment method list (D-FEX-5 = A) — the LOCAL PAYMENT_METHODS, as stable codes. */
    public const PAYMENT_METHODS = ['cash', 'bankTransfer', 'qris', 'virtualAccount', 'creditCard', 'other'];
    /** The company calendar executedOn is bounded by (D-FEX-8 = A). */
    public const COMPANY_TIMEZONE = 'Asia/Jakarta';

    /**
     * POST /api/finance-executions/execute
     *
     * @param array<string, mixed> $json
     * @param string $today the company calendar's today, "YYYY-MM-DD" (today())
     * @return array{financePostingId: string, expectedAmount: string, executedOn: string, paymentMethod: string, idempotencyKey: string}
     */
    public static function execute(array $json, string $today): array
    {
        self::onlyKeys($json, ['financePostingId', 'expectedAmount', 'executedOn', 'paymentMethod', 'idempotencyKey']);
        $bad = [];
        $id = $json['financePostingId'] ?? null;
        if (!is_string($id) || preg_match(PayrollInput::ID_PATTERN, $id) !== 1) {
            $bad[] = 'financePostingId';
        }
        if (!PayrollCalculation::isAmount($json['expectedAmount'] ?? null)) {
            $bad[] = 'expectedAmount';
        }
        $on = $json['executedOn'] ?? null;
        if (!self::isDate($on) || strcmp($on, $today) > 0) {
            $bad[] = 'executedOn';
        }
        $method = $json['paymentMethod'] ?? null;
        if (!in_array($method, self::PAYMENT_METHODS, true)) {
            $bad[] = 'paymentMethod';
        }
        $key = $json['idempotencyKey'] ?? null;
        if (!is_string($key) || preg_match(PayrollInput::KEY_PATTERN, $key) !== 1) {
            $bad[] = 'idempotencyKey';
        }
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid finance execution', fields: $bad);
        }
        return ['financePostingId' => $id, 'expectedAmount' => $json['expectedAmount'], 'executedOn' => $on, 'paymentMethod' => $method, 'idempotencyKey' => $key];
    }

    /** GET ?month= : the required month (400 invalid_query otherwise). */
    public static function month(?string $month): string
    {
        return PayrollInput::month($month);
    }

    /** Today in the company calendar (D-FEX-8 = A), "YYYY-MM-DD" — never the server's UTC date. */
    public static function today(\DateTimeImmutable $now): string
    {
        return $now->setTimezone(new \DateTimeZone(self::COMPANY_TIMEZONE))->format('Y-m-d');
    }

    /** A real calendar date in its one spelling "YYYY-MM-DD" (a calendar value: no time, no timezone). */
    public static function isDate(mixed $v): bool
    {
        return is_string($v) && preg_match('/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/', $v, $m) === 1 && checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
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
            throw new ApiError(ErrorCode::ValidationFailed, 'unknown finance execution field', fields: $named, logReason: 'unknown_field');
        }
    }
}
