<?php
declare(strict_types=1);

namespace TamOs\Request;

use TamOs\Employee\EmployeeInput;
use TamOs\Finance\FinanceExecutionInput;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Payroll\PayrollCalculation;
use TamOs\Payroll\PayrollInput;
use TamOs\Transaction\FinancialPost;
use TamOs\Transaction\TransactionInput;

/**
 * Strict request validation for the Phase 2 finance request routes (ADR-016 §1, §5, §6). Each route
 * has an exact allowlist: any other key — a company, a creator, a role, a status, a version on
 * create, an id on create, an employee on an Employee's create — is a 400 naming the key. Values are
 * validated, never coerced or trimmed: what is stored is exactly what was sent.
 *
 *   create (paymentRequest)   exactly { kind, financialPost, category, description, amount, payee,
 *                             documentDate, idempotencyKey }
 *   create (reimbursement)    the CEO: { kind, employeeId, category, description, amount,
 *                             documentDate, idempotencyKey } and optionally financialPost (ADR-017
 *                             §1: absent = not yet assigned; a JSON null is refused); an Employee: the
 *                             same without employeeId and without financialPost — the owner is taken
 *                             from the Scope (§4), the post is the CEO's to assign (ADR-017)
 *   update                    { financeRequestId, expectedVersion } and at least one of
 *                             { financialPost, category, description, amount, payee, documentDate };
 *                             an Employee may not send financialPost (ADR-017 §1); a post is set or
 *                             replaced, never cleared (null is refused); kind and owner are immutable;
 *                             the kind-dependent rules (payee only on a payment request, the
 *                             documentDate bound) are checked against the locked request by
 *                             applyUpdate()
 *   submit                    exactly { financeRequestId, expectedVersion }
 *   approve                   { financeRequestId, expectedVersion, expectedAmount } and, exactly for
 *                             a reimbursement, financialPost — the post the CEO selects or confirms
 *                             (ADR-017 §1, D6); checked against the request's kind by approvalPost()
 *   reject / cancel           exactly { financeRequestId, expectedVersion, reason }
 *   pay                       exactly { financeRequestId, expectedVersion, expectedAmount, paidOn,
 *                             paymentMethod, idempotencyKey }
 *   GET list                  ?from=&to= (the Phase 1 range rule on documentDate) and optional
 *                             ?status= and ?kind=
 *   GET one                   ?id=
 *
 * Dates (§6), "today" in the company calendar (Asia/Jakarta): a reimbursement's documentDate (the
 * expense date) and paidOn are 1900-01-01 … today; a payment request's documentDate (needed-by) is
 * 1900-01-01 … today + NEEDED_BY_DAYS. category, description, amount and the post follow Phase 1
 * exactly (TransactionInput, FinancialPost, PayrollCalculation::isAmount); the payment methods are
 * BF-4f's closed list (FinanceExecutionInput::PAYMENT_METHODS) — one source of truth each.
 */
final class RequestInput
{
    public const PAYEE_MAX = 160;
    public const REASON_MAX = 200;
    /** A payment request may be needed up to today + 366 days (SUBMISSION point 1). */
    public const NEEDED_BY_DAYS = 366;
    public const MAX_VERSION = 4294967295;
    public const FIELDS = ['financialPost', 'category', 'description', 'amount', 'payee', 'documentDate'];
    /** ADR-017 §1: the fields an Employee may change on their own Draft — never the Financial Post. */
    public const SELF_FIELDS = ['category', 'description', 'amount', 'payee', 'documentDate'];

    private const PAYMENT_REQUEST_KEYS = ['kind', 'financialPost', 'category', 'description', 'amount', 'payee', 'documentDate', 'idempotencyKey'];
    private const REIMBURSEMENT_KEYS = ['kind', 'employeeId', 'financialPost', 'category', 'description', 'amount', 'documentDate', 'idempotencyKey'];

    /**
     * POST /api/finance-requests/create
     *
     * @param array<string, mixed> $json
     * @param bool $selfScope the caller is an Employee (no employeeId and no financialPost key is accepted)
     * @return array{kind: string, employeeId: ?string, financialPost: ?string, category: string, description: string, amount: string, payee: ?string, documentDate: string, idempotencyKey: string}
     */
    public static function create(array $json, string $today, bool $selfScope): array
    {
        $kind = $json['kind'] ?? null;
        $reimbursement = $kind === RequestStatus::KIND_REIMBURSEMENT;
        if ($reimbursement) {
            // ADR-017 §1: an Employee never sends a post (400 naming it); the CEO's is optional.
            $keys = $selfScope ? array_values(array_diff(self::REIMBURSEMENT_KEYS, ['employeeId', 'financialPost'])) : self::REIMBURSEMENT_KEYS;
        } elseif ($kind === RequestStatus::KIND_PAYMENT_REQUEST) {
            $keys = self::PAYMENT_REQUEST_KEYS;
        } else {
            $keys = array_values(array_unique(array_merge(self::PAYMENT_REQUEST_KEYS, $selfScope ? [] : ['employeeId'])));
        }
        self::onlyKeys($json, $keys);
        $bad = [];
        if (!in_array($kind, RequestStatus::KINDS, true)) {
            $bad[] = 'kind';
        }
        $employeeId = null;
        if ($reimbursement && !$selfScope) {
            $employeeId = $json['employeeId'] ?? null;
            if (!is_string($employeeId) || preg_match(EmployeeInput::ID_PATTERN, $employeeId) !== 1) {
                $bad[] = 'employeeId';
            }
        }
        // A payment request always carries its post; a reimbursement's is checked only when sent (ADR-017).
        $bad = array_merge($bad, self::fieldErrors($json, ['financialPost'], !$reimbursement));
        $bad = array_merge($bad, self::fieldErrors($json, ['category', 'description', 'amount'], true));
        $payee = null;
        if ($kind === RequestStatus::KIND_PAYMENT_REQUEST) {
            $payee = $json['payee'] ?? null;
            if (!TransactionInput::isText($payee, self::PAYEE_MAX)) {
                $bad[] = 'payee';
            }
        }
        $date = $json['documentDate'] ?? null;
        if (!self::isDocumentDate($date, is_string($kind) ? $kind : RequestStatus::KIND_REIMBURSEMENT, $today)) {
            $bad[] = 'documentDate';
        }
        if (!self::isKey($json['idempotencyKey'] ?? null)) {
            $bad[] = 'idempotencyKey';
        }
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid finance request', fields: $bad);
        }
        return [
            'kind' => $kind,
            'employeeId' => $employeeId,
            'financialPost' => $json['financialPost'] ?? null,
            'category' => $json['category'],
            'description' => $json['description'],
            'amount' => $json['amount'],
            'payee' => $payee,
            'documentDate' => $date,
            'idempotencyKey' => $json['idempotencyKey'],
        ];
    }

    /**
     * POST /api/finance-requests/update: the target and at least one field, each validated now
     * (400 before any lookup); the kind-dependent rules run again in applyUpdate().
     *
     * @param array<string, mixed> $json
     * @param bool $selfScope the caller is an Employee (no financialPost key is accepted, ADR-017 §1)
     * @return array{financeRequestId: string, expectedVersion: int, patch: array<string, string>}
     */
    public static function update(array $json, bool $selfScope): array
    {
        $fields = $selfScope ? self::SELF_FIELDS : self::FIELDS;
        self::onlyKeys($json, array_merge(['financeRequestId', 'expectedVersion'], $fields));
        $bad = self::targetErrors($json);
        $patch = array_diff_key($json, ['financeRequestId' => true, 'expectedVersion' => true]);
        if ($patch === [] && $bad === []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'no finance request field to update', fields: $fields);
        }
        $bad = array_merge($bad, self::fieldErrors($patch, array_values(array_intersect(['financialPost', 'category', 'description', 'amount'], array_keys($patch))), true));
        if (array_key_exists('payee', $patch) && !TransactionInput::isText($patch['payee'], self::PAYEE_MAX)) {
            $bad[] = 'payee';
        }
        if (array_key_exists('documentDate', $patch) && (!TransactionInput::isDate($patch['documentDate']) || strcmp($patch['documentDate'], TransactionInput::EARLIEST_DATE) < 0)) {
            $bad[] = 'documentDate';
        }
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid finance request update', fields: $bad);
        }
        /** @var array<string, string> $patch */
        return ['financeRequestId' => $json['financeRequestId'], 'expectedVersion' => $json['expectedVersion'], 'patch' => $patch];
    }

    /**
     * Applies a validated patch to the locked request's editable fields (API names), enforcing the
     * kind-dependent rules: payee belongs to a payment request only, and the documentDate bound
     * depends on the kind (§6).
     *
     * @param array<string, ?string> $current the locked request's editable fields (RequestView::editable); a reimbursement's post may be null (ADR-017)
     * @param array<string, string> $patch
     * @return array<string, ?string> the fields after the patch
     */
    public static function applyUpdate(string $kind, array $current, array $patch, string $today): array
    {
        $bad = [];
        if ($kind === RequestStatus::KIND_REIMBURSEMENT && array_key_exists('payee', $patch)) {
            $bad[] = 'payee';
        }
        if (array_key_exists('documentDate', $patch) && !self::isDocumentDate($patch['documentDate'], $kind, $today)) {
            $bad[] = 'documentDate';
        }
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid finance request update', fields: $bad);
        }
        return array_merge($current, $patch);
    }

    /**
     * The field names that differ between two editable-field sets, in FIELDS order.
     *
     * @param array<string, ?string> $before
     * @param array<string, ?string> $after
     * @return list<string>
     */
    public static function changed(array $before, array $after): array
    {
        $out = [];
        foreach (self::FIELDS as $f) {
            if (($before[$f] ?? null) !== ($after[$f] ?? null)) {
                $out[] = $f;
            }
        }
        return $out;
    }

    /**
     * POST /api/finance-requests/submit: exactly the target.
     *
     * @param array<string, mixed> $json
     * @return array{financeRequestId: string, expectedVersion: int}
     */
    public static function transition(array $json): array
    {
        self::onlyKeys($json, ['financeRequestId', 'expectedVersion']);
        $bad = self::targetErrors($json);
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid finance request target', fields: $bad);
        }
        return ['financeRequestId' => $json['financeRequestId'], 'expectedVersion' => $json['expectedVersion']];
    }

    /**
     * POST /api/finance-requests/approve: the target, the exact amount the CEO was shown and, when
     * sent, the Financial Post (validated now, 400 before any lookup; whether the request's kind
     * requires or forbids it is decided by approvalPost() after the load).
     *
     * @param array<string, mixed> $json
     * @return array{financeRequestId: string, expectedVersion: int, expectedAmount: string, financialPost: ?string}
     */
    public static function approve(array $json): array
    {
        self::onlyKeys($json, ['financeRequestId', 'expectedVersion', 'expectedAmount', 'financialPost']);
        $bad = self::targetErrors($json);
        if (!self::isPositiveAmount($json['expectedAmount'] ?? null)) {
            $bad[] = 'expectedAmount';
        }
        $bad = array_merge($bad, self::fieldErrors($json, ['financialPost'], false));
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid finance request approval', fields: $bad);
        }
        return ['financeRequestId' => $json['financeRequestId'], 'expectedVersion' => $json['expectedVersion'], 'expectedAmount' => $json['expectedAmount'], 'financialPost' => $json['financialPost'] ?? null];
    }

    /**
     * ADR-017 §1 (D6): every reimbursement approval names the post the CEO selects or confirms; a
     * payment request's approval names none (its post was required at create). 400 naming the field.
     */
    public static function approvalPost(string $kind, ?string $financialPost): ?string
    {
        if (($kind === RequestStatus::KIND_REIMBURSEMENT) !== ($financialPost !== null)) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid finance request approval', fields: ['financialPost']);
        }
        return $financialPost;
    }

    /**
     * POST /api/finance-requests/reject and /cancel: the target and a reason.
     *
     * @param array<string, mixed> $json
     * @return array{financeRequestId: string, expectedVersion: int, reason: string}
     */
    public static function withReason(array $json): array
    {
        self::onlyKeys($json, ['financeRequestId', 'expectedVersion', 'reason']);
        $bad = self::targetErrors($json);
        if (!TransactionInput::isText($json['reason'] ?? null, self::REASON_MAX)) {
            $bad[] = 'reason';
        }
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid finance request reason', fields: $bad);
        }
        return ['financeRequestId' => $json['financeRequestId'], 'expectedVersion' => $json['expectedVersion'], 'reason' => $json['reason']];
    }

    /**
     * POST /api/finance-requests/pay (§5).
     *
     * @param array<string, mixed> $json
     * @return array{financeRequestId: string, expectedVersion: int, expectedAmount: string, paidOn: string, paymentMethod: string, idempotencyKey: string}
     */
    public static function pay(array $json, string $today): array
    {
        self::onlyKeys($json, ['financeRequestId', 'expectedVersion', 'expectedAmount', 'paidOn', 'paymentMethod', 'idempotencyKey']);
        $bad = self::targetErrors($json);
        if (!self::isPositiveAmount($json['expectedAmount'] ?? null)) {
            $bad[] = 'expectedAmount';
        }
        $on = $json['paidOn'] ?? null;
        if (!TransactionInput::isDate($on) || strcmp($on, TransactionInput::EARLIEST_DATE) < 0 || strcmp($on, $today) > 0) {
            $bad[] = 'paidOn';
        }
        if (!in_array($json['paymentMethod'] ?? null, FinanceExecutionInput::PAYMENT_METHODS, true)) {
            $bad[] = 'paymentMethod';
        }
        if (!self::isKey($json['idempotencyKey'] ?? null)) {
            $bad[] = 'idempotencyKey';
        }
        if ($bad !== []) {
            throw new ApiError(ErrorCode::ValidationFailed, 'invalid finance request payment', fields: $bad);
        }
        return [
            'financeRequestId' => $json['financeRequestId'],
            'expectedVersion' => $json['expectedVersion'],
            'expectedAmount' => $json['expectedAmount'],
            'paidOn' => $on,
            'paymentMethod' => $json['paymentMethod'],
            'idempotencyKey' => $json['idempotencyKey'],
        ];
    }

    /**
     * GET ?from=&to=[&status=][&kind=] : the documentDate range (Phase 1 rule, 400 invalid_query) and
     * the optional filters.
     *
     * @return array{from: string, to: string, status: ?string, kind: ?string}
     */
    public static function list(?string $from, ?string $to, ?string $status, ?string $kind): array
    {
        $range = TransactionInput::range($from, $to);
        if ($status !== null && !in_array($status, RequestStatus::ALL, true)) {
            throw new ApiError(ErrorCode::InvalidQuery, 'invalid status filter');
        }
        if ($kind !== null && !in_array($kind, RequestStatus::KINDS, true)) {
            throw new ApiError(ErrorCode::InvalidQuery, 'invalid kind filter');
        }
        return ['from' => $range['from'], 'to' => $range['to'], 'status' => $status, 'kind' => $kind];
    }

    /** GET ?id= : a request id (400 before any lookup). */
    public static function id(?string $id): string
    {
        if ($id === null || preg_match(PayrollInput::ID_PATTERN, $id) !== 1) {
            throw new ApiError(ErrorCode::ValidationFailed, 'finance request id', fields: ['id']);
        }
        return $id;
    }

    /** today + NEEDED_BY_DAYS in the company calendar. */
    public static function neededByLimit(string $today): string
    {
        return (new \DateTimeImmutable($today, new \DateTimeZone('UTC')))->modify('+' . self::NEEDED_BY_DAYS . ' days')->format('Y-m-d');
    }

    /** The documentDate rule of §6 for a request of $kind. */
    public static function isDocumentDate(mixed $v, string $kind, string $today): bool
    {
        if (!TransactionInput::isDate($v) || strcmp($v, TransactionInput::EARLIEST_DATE) < 0) {
            return false;
        }
        $limit = $kind === RequestStatus::KIND_PAYMENT_REQUEST ? self::neededByLimit($today) : $today;
        return strcmp($v, $limit) <= 0;
    }

    /** A positive whole-Rupiah "N.00" amount. */
    public static function isPositiveAmount(mixed $v): bool
    {
        return PayrollCalculation::isAmount($v) && $v !== '0.00';
    }

    /**
     * The Phase 1 rules for the shared fields named in $names (present or, when $required, missing).
     *
     * @param array<string, mixed> $json
     * @param list<string> $names
     * @return list<string>
     */
    private static function fieldErrors(array $json, array $names, bool $required): array
    {
        $bad = [];
        foreach ($names as $name) {
            if (!$required && !array_key_exists($name, $json)) {
                continue;
            }
            $v = $json[$name] ?? null;
            $ok = match ($name) {
                'financialPost' => is_string($v) && FinancialPost::tryFrom($v) !== null,
                'category' => TransactionInput::isText($v, TransactionInput::CATEGORY_MAX) && !in_array(strtolower($v), TransactionInput::PAYROLL_CATEGORIES, true),
                'description' => TransactionInput::isText($v, TransactionInput::DESCRIPTION_MAX),
                'amount' => self::isPositiveAmount($v),
                default => throw new \LogicException('unknown shared field'),
            };
            if (!$ok) {
                $bad[] = $name;
            }
        }
        return $bad;
    }

    /**
     * @param array<string, mixed> $json
     * @return list<string>
     */
    private static function targetErrors(array $json): array
    {
        $bad = [];
        $id = $json['financeRequestId'] ?? null;
        if (!is_string($id) || preg_match(PayrollInput::ID_PATTERN, $id) !== 1) {
            $bad[] = 'financeRequestId';
        }
        $version = $json['expectedVersion'] ?? null;
        if (!is_int($version) || $version < 1 || $version > self::MAX_VERSION) {
            $bad[] = 'expectedVersion';
        }
        return $bad;
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
            throw new ApiError(ErrorCode::ValidationFailed, 'unknown finance request field', fields: $named, logReason: 'unknown_field');
        }
    }
}
