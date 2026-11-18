<?php
declare(strict_types=1);

namespace TamOs\Data\Request;

use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Data\Scope\ScopedRecord;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Scope;

/**
 * The server finance request (Phase 2, ADR-016; migrations 0039–0040): a payment request (a company
 * expense to a named payee) or a reimbursement (money an employee spent on the company's behalf), one
 * lifecycle Draft → Submitted → Approved → Paid, or Rejected / Cancelled. The sole writer of
 * finance_requests and finance_request_payments; the linked general expense is written by
 * TransactionStore, its one writer.
 *
 * Ownership (§4): a reimbursement's owner_employee_id is the reimbursed employee; a payment request
 * has none (NULL). Every statement names :company_id, and every *_SELF_SQL variant also binds the
 * owner to :self_employee_id, so an Employee principal reads and writes only their own
 * reimbursements — a payment request (owner NULL) never matches a self Scope. ScopedDatabase injects
 * both and refuses the wrong variant.
 *
 * Writes are compare-and-swap on `version` against the record the caller locked by primary key, and
 * every write names the status it expects, so a stale or concurrent change matches no row. A request
 * is never deleted: Rejected and Cancelled are statuses, and Paid, Rejected and Cancelled are
 * terminal. A payment row is immutable (no UPDATE, no DELETE) and there is at most one per request
 * (UNIQUE finance_request_id), per linked expense (UNIQUE finance_transaction_id) and per client key.
 * The money is stored as the exact "N.00" string the request carried: no SQL arithmetic.
 *
 * Eligibility (ADR-016 acceptance clarification 1, R1 = A): creating or submitting a reimbursement
 * locks the reimbursed employee row by primary key FIRST, then (submit) the request row — the lock
 * order of overtime create (employee → record), so a create or submit serializes with an archive or
 * an employment-status change. Approve, reject, cancel and pay never read or lock the employee.
 */
final class RequestStore
{
    public const ENTITY = 'financeRequest';

    /** A list fails closed above this many rows (read with LIST_LIMIT, never truncated). */
    public const LIST_CAP = 2000;
    public const LIST_LIMIT = 2001;

    // Anchor reads: id, company, owner and status — the record a Policy decision needs.
    public const FIND_SQL = 'SELECT id, company_id, owner_employee_id, status FROM finance_requests WHERE id = :id AND company_id = :company_id';
    public const FIND_SELF_SQL = 'SELECT id, company_id, owner_employee_id, status FROM finance_requests WHERE id = :id AND company_id = :company_id AND owner_employee_id = :self_employee_id';

    // Record reads: the request with its payment, if any.
    public const RECORD_SQL = 'SELECT r.id, r.company_id, r.owner_employee_id, r.kind, r.financial_post, r.category, r.description, r.amount, r.payee, r.document_date, r.status, r.status_reason, r.version, r.created_by_user_id, r.created_at, r.updated_at, p.finance_transaction_id, p.paid_on, p.payment_method, p.paid_by_user_id, p.created_at AS paid_at FROM finance_requests r LEFT JOIN finance_request_payments p ON p.company_id = r.company_id AND p.finance_request_id = r.id WHERE r.id = :id AND r.company_id = :company_id';
    public const RECORD_SELF_SQL = 'SELECT r.id, r.company_id, r.owner_employee_id, r.kind, r.financial_post, r.category, r.description, r.amount, r.payee, r.document_date, r.status, r.status_reason, r.version, r.created_by_user_id, r.created_at, r.updated_at, p.finance_transaction_id, p.paid_on, p.payment_method, p.paid_by_user_id, p.created_at AS paid_at FROM finance_requests r LEFT JOIN finance_request_payments p ON p.company_id = r.company_id AND p.finance_request_id = r.id WHERE r.id = :id AND r.company_id = :company_id AND r.owner_employee_id = :self_employee_id';
    // The list: by documentDate, with every status and kind bound when no filter is given.
    public const LIST_SQL = 'SELECT r.id, r.company_id, r.owner_employee_id, r.kind, r.financial_post, r.category, r.description, r.amount, r.payee, r.document_date, r.status, r.status_reason, r.version, r.created_by_user_id, r.created_at, r.updated_at, p.finance_transaction_id, p.paid_on, p.payment_method, p.paid_by_user_id, p.created_at AS paid_at FROM finance_requests r LEFT JOIN finance_request_payments p ON p.company_id = r.company_id AND p.finance_request_id = r.id WHERE r.company_id = :company_id AND r.document_date >= :from_date AND r.document_date <= :to_date AND r.status IN (:status_1, :status_2, :status_3, :status_4, :status_5, :status_6) AND r.kind IN (:kind_1, :kind_2) ORDER BY r.document_date, r.created_at, r.id LIMIT 2001';
    public const LIST_SELF_SQL = 'SELECT r.id, r.company_id, r.owner_employee_id, r.kind, r.financial_post, r.category, r.description, r.amount, r.payee, r.document_date, r.status, r.status_reason, r.version, r.created_by_user_id, r.created_at, r.updated_at, p.finance_transaction_id, p.paid_on, p.payment_method, p.paid_by_user_id, p.created_at AS paid_at FROM finance_requests r LEFT JOIN finance_request_payments p ON p.company_id = r.company_id AND p.finance_request_id = r.id WHERE r.company_id = :company_id AND r.owner_employee_id = :self_employee_id AND r.document_date >= :from_date AND r.document_date <= :to_date AND r.status IN (:status_1, :status_2, :status_3, :status_4, :status_5, :status_6) AND r.kind IN (:kind_1, :kind_2) ORDER BY r.document_date, r.created_at, r.id LIMIT 2001';

    // The one lock of every write: the request, by primary key (ADR-016 §2, §5 step 1).
    public const LOCK_SQL = 'SELECT id, company_id, owner_employee_id, kind, financial_post, category, description, amount, payee, document_date, status, version FROM finance_requests WHERE id = :id AND company_id = :company_id FOR UPDATE';
    public const LOCK_SELF_SQL = 'SELECT id, company_id, owner_employee_id, kind, financial_post, category, description, amount, payee, document_date, status, version FROM finance_requests WHERE id = :id AND company_id = :company_id AND owner_employee_id = :self_employee_id FOR UPDATE';

    // The reimbursed employee, locked by primary key before the request (create, submit; R1 = A).
    public const LOCK_EMPLOYEE_SQL = 'SELECT id, company_id, id AS owner_employee_id, employment_status, archived_at FROM employees WHERE id = :employee_id AND company_id = :company_id FOR UPDATE';
    public const LOCK_EMPLOYEE_SELF_SQL = 'SELECT id, company_id, id AS owner_employee_id, employment_status, archived_at FROM employees WHERE id = :employee_id AND company_id = :company_id AND id = :self_employee_id FOR UPDATE';

    // Read before a create: the request already holding the create key (own rows only under a self scope).
    public const KEY_HOLDER_SQL = 'SELECT id, company_id, owner_employee_id, kind, financial_post, category, description, amount, payee, document_date FROM finance_requests WHERE company_id = :company_id AND idempotency_key = :idempotency_key';
    public const KEY_HOLDER_SELF_SQL = 'SELECT id, company_id, owner_employee_id, kind, financial_post, category, description, amount, payee, document_date FROM finance_requests WHERE company_id = :company_id AND idempotency_key = :idempotency_key AND owner_employee_id = :self_employee_id';
    // Read under the pay lock (§5 step 2): the payment already holding the pay key.
    public const PAYMENT_KEY_HOLDER_SQL = 'SELECT id, company_id, NULL AS owner_employee_id, finance_request_id, finance_transaction_id, paid_on, payment_method, amount FROM finance_request_payments WHERE company_id = :company_id AND idempotency_key = :idempotency_key';

    // Writes. A new request is always a version 1 Draft; the owner comes from the authorized
    // candidate (an employee record read in scope) or the scope itself, never from the request.
    public const CREATE_SQL = "INSERT INTO finance_requests (id, company_id, kind, financial_post, category, description, amount, payee, owner_employee_id, document_date, status, status_reason, version, idempotency_key, created_by_user_id, created_at, updated_at) VALUES (:id, :company_id, :kind, :financial_post, :category, :description, :amount, :payee, :owner_employee_id, :document_date, 'Draft', NULL, 1, :idempotency_key, :created_by_user_id, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))";
    public const CREATE_SELF_SQL = "INSERT INTO finance_requests (id, company_id, kind, financial_post, category, description, amount, payee, owner_employee_id, document_date, status, status_reason, version, idempotency_key, created_by_user_id, created_at, updated_at) VALUES (:id, :company_id, 'reimbursement', :financial_post, :category, :description, :amount, NULL, :self_employee_id, :document_date, 'Draft', NULL, 1, :idempotency_key, :created_by_user_id, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))";
    public const UPDATE_SQL = "UPDATE finance_requests SET financial_post = :financial_post, category = :category, description = :description, amount = :amount, payee = :payee, document_date = :document_date, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Draft'";
    public const UPDATE_SELF_SQL = "UPDATE finance_requests SET financial_post = :financial_post, category = :category, description = :description, amount = :amount, document_date = :document_date, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND owner_employee_id = :self_employee_id AND version = :expected_version AND status = 'Draft'";
    public const TRANSITION_SQL = 'UPDATE finance_requests SET status = :to_status, status_reason = :status_reason, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = :from_status';
    public const TRANSITION_SELF_SQL = 'UPDATE finance_requests SET status = :to_status, status_reason = :status_reason, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND owner_employee_id = :self_employee_id AND version = :expected_version AND status = :from_status';
    // §5 step 5: the one payment of an Approved request (immutable; CEO company scope only).
    public const INSERT_PAYMENT_SQL = 'INSERT INTO finance_request_payments (id, company_id, finance_request_id, finance_transaction_id, paid_on, payment_method, amount, paid_by_user_id, idempotency_key, created_at) VALUES (:payment_id, :company_id, :id, :finance_transaction_id, :paid_on, :payment_method, :amount, :paid_by_user_id, :idempotency_key, UTC_TIMESTAMP(6))';

    /** The statuses and kinds bound when the list is not filtered. */
    private const STATUSES = ['Draft', 'Submitted', 'Approved', 'Paid', 'Rejected', 'Cancelled'];
    private const KINDS = ['paymentRequest', 'reimbursement'];
    /** The Actions a request write may be authorized under (ADR-016 §3). */
    private const WRITE_ACTIONS = [Action::FinanceManage, Action::FinanceExecute, Action::ReimbursementCreateSelfDraft, Action::ReimbursementUpdateSelfDraft, Action::ReimbursementSubmitSelf];

    public function __construct(private readonly ScopedDatabase $db)
    {
    }

    /** The request with this id the scope can see, or null (absent and out of scope alike). */
    public function find(Scope $scope, string $id): ?ScopedRecord
    {
        return $this->db->find($scope, self::ENTITY, $scope->isSelf() ? self::FIND_SELF_SQL : self::FIND_SQL, ['id' => self::hex($id)]);
    }

    /** The create candidate for a new reimbursement Draft of the employee record $employee (read in scope). */
    public function candidate(ScopedRecord $employee, string $id): ScopedRecord
    {
        return $this->db->candidate($employee, self::ENTITY, $id, 'Draft');
    }

    /** @return array<string, mixed>|null the request with its payment columns the scope can see, or null */
    public function record(Scope $scope, string $id): ?array
    {
        return $this->db->select($scope, $scope->isSelf() ? self::RECORD_SELF_SQL : self::RECORD_SQL, ['id' => self::hex($id)])[0] ?? null;
    }

    /**
     * The scope's requests with a documentDate in $from..$to, optionally of one status and one kind —
     * at most LIST_LIMIT rows, so a caller can tell that LIST_CAP was exceeded.
     *
     * @return list<array<string, mixed>>
     */
    public function list(Scope $scope, string $from, string $to, ?string $status, ?string $kind): array
    {
        $params = ['from_date' => self::date($from), 'to_date' => self::date($to)];
        foreach (self::STATUSES as $i => $s) {
            $params['status_' . ($i + 1)] = $status ?? $s;
        }
        foreach (self::KINDS as $i => $k) {
            $params['kind_' . ($i + 1)] = $kind ?? $k;
        }
        return $this->db->select($scope, $scope->isSelf() ? self::LIST_SELF_SQL : self::LIST_SQL, $params);
    }

    /**
     * Step 1 of every write: locks the request by primary key (own rows only under a self scope), or null.
     *
     * @return array<string, mixed>|null
     */
    public function lock(Authorization $auth, string $id): ?array
    {
        $scope = self::authorized($auth)->scope;
        return $this->db->select($scope, $scope->isSelf() ? self::LOCK_SELF_SQL : self::LOCK_SQL, ['id' => self::hex($id)])[0] ?? null;
    }

    /**
     * Locks the reimbursed employee of a create candidate or a submitted reimbursement by primary key
     * (R1 = A), or null.
     *
     * @return array{employmentStatus: string, archived: bool}|null
     */
    public function lockEmployee(Authorization $auth): ?array
    {
        if (!in_array($auth->action, [Action::ReimbursementCreateSelfDraft, Action::ReimbursementSubmitSelf], true) || $auth->record === null || $auth->record->ownerEmployeeId === null) {
            throw new \LogicException('the employee is locked only for an authorized reimbursement create or submit');
        }
        $sql = $auth->scope->isSelf() ? self::LOCK_EMPLOYEE_SELF_SQL : self::LOCK_EMPLOYEE_SQL;
        $rows = $this->db->select($auth->scope, $sql, ['employee_id' => $auth->record->ownerEmployeeId]);
        if ($rows === []) {
            return null;
        }
        return ['employmentStatus' => (string) $rows[0]['employment_status'], 'archived' => $rows[0]['archived_at'] !== null];
    }

    /** @return array<string, mixed>|null the request holding this create key (own rows only under a self scope), or null */
    public function keyHolder(Authorization $auth, string $key): ?array
    {
        $scope = self::authorized($auth)->scope;
        return $this->db->select($scope, $scope->isSelf() ? self::KEY_HOLDER_SELF_SQL : self::KEY_HOLDER_SQL, ['idempotency_key' => self::hex($key)])[0] ?? null;
    }

    /** @return array<string, mixed>|null the payment holding this pay key, or null (finance.execute only) */
    public function paymentKeyHolder(Authorization $auth, string $key): ?array
    {
        return $this->db->select(self::executing($auth)->scope, self::PAYMENT_KEY_HOLDER_SQL, ['idempotency_key' => self::hex($key)])[0] ?? null;
    }

    /**
     * Inserts one Draft. Under a self scope the owner is the scope's employee and the kind is a
     * reimbursement; otherwise the owner is the authorized candidate's (a reimbursement) or none (a
     * payment request).
     *
     * @param array{kind: string, financialPost: string, category: string, description: string, amount: string, payee: ?string, documentDate: string, idempotencyKey: string} $in
     */
    public function create(Authorization $auth, string $id, array $in, string $actorUserId): void
    {
        $auth = self::authorized($auth);
        $params = [
            'id' => self::hex($id),
            'financial_post' => $in['financialPost'],
            'category' => $in['category'],
            'description' => $in['description'],
            'amount' => $in['amount'],
            'document_date' => self::date($in['documentDate']),
            'idempotency_key' => self::hex($in['idempotencyKey']),
            'created_by_user_id' => self::hex($actorUserId),
        ];
        if ($auth->scope->isSelf()) {
            if ($in['kind'] !== 'reimbursement' || $auth->action !== Action::ReimbursementCreateSelfDraft) {
                throw new \LogicException('an Employee creates only their own reimbursement');
            }
            $this->db->execute($auth, self::CREATE_SELF_SQL, $params);
            return;
        }
        if ($in['kind'] === 'reimbursement') {
            if ($auth->action !== Action::ReimbursementCreateSelfDraft || $auth->record === null || $auth->record->ownerEmployeeId === null) {
                throw new \LogicException('a reimbursement is created against its employee candidate');
            }
            $owner = $auth->record->ownerEmployeeId;
            $payee = null;
        } else {
            if ($auth->action !== Action::FinanceManage || $auth->record !== null || $in['payee'] === null) {
                throw new \LogicException('a payment request is created under finance.manage, with its payee');
            }
            $owner = null;
            $payee = $in['payee'];
        }
        $this->db->execute($auth, self::CREATE_SQL, $params + ['kind' => $in['kind'], 'payee' => $payee, 'owner_employee_id' => $owner]);
    }

    /**
     * Writes the editable fields of the locked Draft at the expected version.
     *
     * @param array{financialPost: string, category: string, description: string, amount: string, payee: ?string, documentDate: string} $fields
     * @return int 1 when the Draft changed
     */
    public function update(Authorization $auth, string $id, int $expectedVersion, array $fields): int
    {
        $auth = self::authorized($auth);
        $params = [
            'id' => self::hex($id),
            'expected_version' => $expectedVersion,
            'financial_post' => $fields['financialPost'],
            'category' => $fields['category'],
            'description' => $fields['description'],
            'amount' => $fields['amount'],
            'document_date' => self::date($fields['documentDate']),
        ];
        if ($auth->scope->isSelf()) {
            return $this->db->execute($auth, self::UPDATE_SELF_SQL, $params);
        }
        return $this->db->execute($auth, self::UPDATE_SQL, $params + ['payee' => $fields['payee']]);
    }

    /** One status change of the locked request, at the expected version; the reason only on Rejected / Cancelled. */
    public function transition(Authorization $auth, string $id, int $expectedVersion, string $from, string $to, ?string $reason): int
    {
        $auth = self::authorized($auth);
        if (in_array($to, ['Rejected', 'Cancelled'], true) !== ($reason !== null)) {
            throw new \LogicException('a status reason is written exactly on Rejected and Cancelled');
        }
        $params = ['id' => self::hex($id), 'expected_version' => $expectedVersion, 'from_status' => $from, 'to_status' => $to, 'status_reason' => $reason];
        return $this->db->execute($auth, $auth->scope->isSelf() ? self::TRANSITION_SELF_SQL : self::TRANSITION_SQL, $params);
    }

    /** §5 step 5: the one payment row of the locked request (finance.execute only). */
    public function insertPayment(Authorization $auth, string $paymentId, string $requestId, string $transactionId, string $paidOn, string $method, string $amount, string $actorUserId, string $key): void
    {
        $this->db->execute(self::executing($auth), self::INSERT_PAYMENT_SQL, [
            'payment_id' => self::hex($paymentId),
            'id' => self::hex($requestId),
            'finance_transaction_id' => self::hex($transactionId),
            'paid_on' => self::date($paidOn),
            'payment_method' => $method,
            'amount' => $amount,
            'paid_by_user_id' => self::hex($actorUserId),
            'idempotency_key' => self::hex($key),
        ]);
    }

    /** A request write is authorized under one of the ADR-016 §3 Actions. */
    private static function authorized(Authorization $auth): Authorization
    {
        if (!in_array($auth->action, self::WRITE_ACTIONS, true)) {
            throw new \LogicException('a finance request write needs an ADR-016 Action');
        }
        if ($auth->record !== null && $auth->record->entity !== self::ENTITY) {
            throw new \LogicException('a finance request write is authorized against a finance request');
        }
        if (in_array($auth->action, [Action::FinanceManage, Action::FinanceExecute], true) && ($auth->record !== null || $auth->scope->isSelf())) {
            throw new \LogicException('finance.manage and finance.execute are record-free, in company scope');
        }
        return $auth;
    }

    /** The payment statements are the record-free finance.execute, in company scope. */
    private static function executing(Authorization $auth): Authorization
    {
        if ($auth->action !== Action::FinanceExecute || $auth->record !== null || $auth->scope->isSelf()) {
            throw new \LogicException('a finance request payment needs finance.execute, in company scope');
        }
        return $auth;
    }

    private static function hex(string $v): string
    {
        if (preg_match('/^[0-9a-f]{32}$/', $v) !== 1) {
            throw new \LogicException('a request, payment, transaction, user id or key is 32 lowercase hex characters');
        }
        return $v;
    }

    private static function date(string $v): string
    {
        if (preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/', $v) !== 1) {
            throw new \LogicException('a request date is YYYY-MM-DD');
        }
        return $v;
    }
}
