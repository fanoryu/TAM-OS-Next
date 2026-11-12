<?php
declare(strict_types=1);

namespace TamOs\Transaction;

use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Payroll\PayrollCalculation;
use TamOs\Payroll\PayrollInput;

/**
 * Strict request validation for the Phase 1 general transaction routes (D-INT-1). Each route has an
 * exact allowlist: any other key — a company, a creator, a role, a status, an id on create — is a
 * 400 naming the key. Values are validated, never coerced or trimmed on the browser's behalf: a
 * text with surrounding whitespace is refused, so what is stored is exactly what was sent.
 *
 *   create   exactly { kind, financialPost, category, description, amount, transactionDate, idempotencyKey }
 *            kind income | expense; financialPost one of FinancialPost; category 1–64 characters
 *            and never a payroll category (Gaji, Payroll, Salary — payroll is reported separately
 *            and must not be double-counted); description 1–500 characters; amount a positive
 *            whole-Rupiah "N.00" (PayrollCalculation::isAmount); transactionDate a calendar date
 *            from 1900-01-01 and not after today in the company calendar (Asia/Jakarta)
 *   void     exactly { financeTransactionId, reason, idempotencyKey }; reason 1–200 characters
 *   GET      ?from=YYYY-MM-DD&to=YYYY-MM-DD, both required, from <= to, at most MAX_RANGE_DAYS days
 *
 * Text is valid UTF-8 (the JSON body guarantees it) with no control character. The id and key
 * grammars are PayrollInput's — one source of truth.
 */
final class TransactionInput
{
    public const KINDS = ['income', 'expense'];
    /** Payroll is never a general transaction (case-insensitive): it has its own reporting line. */
    public const PAYROLL_CATEGORIES = ['gaji', 'payroll', 'salary'];
    public const CATEGORY_MAX = 64;
    public const DESCRIPTION_MAX = 500;
    public const REASON_MAX = 200;
    public const MAX_RANGE_DAYS = 366;
    public const EARLIEST_DATE = '1900-01-01';
    public const COMPANY_TIMEZONE = 'Asia/Jakarta';

    /**
     * POST /api/general-transactions/create
     *
     * @param array<string, mixed> $json
     * @return array{kind: string, financialPost: string, category: string, description: string, amount: string, transactionDate: string, idempotencyKey: string}
     */
    public static function create(array $json, string $today): array
    {
        self::onlyKeys($json, ['kind', 'financialPost', 'category', 'description', 'amount', 'transactionDate', 'idempotencyKey']);
        $bad = [];
        if (!in_array($json['kind'] ?? null, self::KINDS, true)) {
            $bad[] = 'kind';
        }
        if (!is_string($json['financialPost'] ?? null) || FinancialPost::tryFrom($json['financialPost']) === null) {
            $bad[] = 'financialPost';
        }
        $category = $json['category'] ?? null;
        if (!self::isText($category, self::CATEGORY_MAX) || in_array(strtolower($category), self::PAYROLL_CATEGORIES, true)) {
            $bad[] = 'category';
        }
        if (!self::isText($json['description'] ?? null, self::DESCRIPTION_MAX)) {
            $bad[] = 'description';
        }
        $amount = $json['amount'] ?? null;
        if (!PayrollCalculation::isAmount($amount) || $amount === '0.00') {
            $bad[] = 'amount';
        }
        $on = $json['transactionDate'] ?? null;
        if (!self::isDate($on) || strcmp($on, self::EARLIEST_DATE) < 0 || strcmp($on, $today) > 0) {
            $bad[] = 'transactionDate';
        }
        if (!self::isKey($json['idempotencyKey'] ?? null)) {
            $bad[] = 'idempotencyKey';
        }
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid general transaction', fields: $bad);
        }
        return [
            'kind' => $json['kind'],
            'financialPost' => $json['financialPost'],
            'category' => $category,
            'description' => $json['description'],
            'amount' => $amount,
            'transactionDate' => $on,
            'idempotencyKey' => $json['idempotencyKey'],
        ];
    }

    /**
     * POST /api/general-transactions/void
     *
     * @param array<string, mixed> $json
     * @return array{financeTransactionId: string, reason: string, idempotencyKey: string}
     */
    public static function void(array $json): array
    {
        self::onlyKeys($json, ['financeTransactionId', 'reason', 'idempotencyKey']);
        $bad = [];
        $id = $json['financeTransactionId'] ?? null;
        if (!is_string($id) || preg_match(PayrollInput::ID_PATTERN, $id) !== 1) {
            $bad[] = 'financeTransactionId';
        }
        if (!self::isText($json['reason'] ?? null, self::REASON_MAX)) {
            $bad[] = 'reason';
        }
        if (!self::isKey($json['idempotencyKey'] ?? null)) {
            $bad[] = 'idempotencyKey';
        }
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid general transaction void', fields: $bad);
        }
        return ['financeTransactionId' => $id, 'reason' => $json['reason'], 'idempotencyKey' => $json['idempotencyKey']];
    }

    /**
     * GET ?from=&to= : the required inclusive date range (400 invalid_query otherwise).
     *
     * @return array{from: string, to: string}
     */
    public static function range(?string $from, ?string $to): array
    {
        if (!self::isDate($from) || !self::isDate($to) || strcmp($from, self::EARLIEST_DATE) < 0 || strcmp($from, $to) > 0) {
            throw new ApiError(ErrorCode::InvalidQuery, 'invalid date range');
        }
        $days = (new \DateTimeImmutable($from, new \DateTimeZone('UTC')))->diff(new \DateTimeImmutable($to, new \DateTimeZone('UTC')))->days;
        if ($days === false || $days + 1 > self::MAX_RANGE_DAYS) {
            throw new ApiError(ErrorCode::InvalidQuery, 'date range too long');
        }
        return ['from' => $from, 'to' => $to];
    }

    /** Today's date in the company calendar (Asia/Jakarta, UTC+7). */
    public static function today(\DateTimeImmutable $now): string
    {
        return $now->setTimezone(new \DateTimeZone(self::COMPANY_TIMEZONE))->format('Y-m-d');
    }

    public static function isDate(mixed $v): bool
    {
        return is_string($v) && preg_match('/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/D', $v, $m) === 1 && checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
    }

    /** 1..$max characters, no control character, no surrounding whitespace. */
    public static function isText(mixed $v, int $max): bool
    {
        if (!is_string($v) || preg_match('/^.{1,' . $max . '}$/Dsu', $v) !== 1 || preg_match('/\p{Cc}/u', $v) === 1) {
            return false;
        }
        return trim($v) === $v;
    }

    private static function isKey(mixed $v): bool
    {
        return is_string($v) && preg_match(PayrollInput::KEY_PATTERN, $v) === 1;
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
            throw new ApiError(ErrorCode::ValidationFailed, 'unknown general transaction field', fields: $named, logReason: 'unknown_field');
        }
    }
}
