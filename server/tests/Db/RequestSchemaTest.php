<?php
declare(strict_types=1);

/*
 * AWP-01 finance request schema against the real MariaDB (migrations 0039–0041; ADR-016 M1–M4):
 * M1 the fresh sequence 0001–0041 applies in order and is current with nothing seeded; M2 a
 * schema-0038 database with Phase 1, payroll, posting, execution and audit rows migrates forward
 * with every row byte-identical and the old audit rows still valid; M3 the database refuses every
 * malformed request or payment (kind-dependent NULLs, an unknown Financial Post, a payroll
 * category, a non-positive or fractional amount, a missing Rejected/Cancelled reason, untrimmed
 * text, malformed ids, a second payment for one request or one transaction, a cross-tenant link,
 * removing a paid request or its linked expense) and the 0041 audit vocabulary admits exactly its
 * triples; M4 (the backup round trip of both tables) is carried by the BackupCreateTest and
 * BackupRestoreTest seeds. Fabricated data only.
 */

use TamOs\Data\Database;
use TamOs\Data\Migration\Migrator;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\employeeAnchor;
use function TamOs\Tests\migrationFixture;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\testDatabase;

/** A company, a user and one employee (test-only SQL, fabricated values). */
$company = static function (Database $db): array {
    $c = bin2hex(random_bytes(16));
    $u = bin2hex(random_bytes(16));
    $e = 'e_' . bin2hex(random_bytes(8));
    $db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$c]);
    $db->execute("INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (?, ?, NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$u, 'request-' . substr($u, 0, 8) . '@example.test']);
    employeeAnchor($db, $c, $e);
    return ['id' => $c, 'user' => $u, 'employee' => $e];
};
/** Inserts one request (test-only SQL); $over replaces any column value. */
$request = static function (Database $db, array $c, array $over = []): string {
    $v = $over + ['id' => bin2hex(random_bytes(16)), 'company' => $c['id'], 'kind' => 'paymentRequest', 'post' => 'GA', 'category' => 'Vendor', 'description' => 'Fabricated',
        'amount' => '250000.00', 'payee' => 'CV Fiktif', 'owner' => null, 'date' => '2026-11-03', 'status' => 'Draft', 'reason' => null, 'version' => 1,
        'key' => bin2hex(random_bytes(16)), 'user' => $c['user']];
    $db->execute('INSERT INTO finance_requests (id, company_id, kind, financial_post, category, description, amount, payee, owner_employee_id, document_date, status, status_reason, version, idempotency_key, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))',
        [$v['id'], $v['company'], $v['kind'], $v['post'], $v['category'], $v['description'], $v['amount'], $v['payee'], $v['owner'], $v['date'], $v['status'], $v['reason'], $v['version'], $v['key'], $v['user']]);
    return $v['id'];
};
$transaction = static function (Database $db, array $c, string $amount = '250000.00'): string {
    $id = bin2hex(random_bytes(16));
    $db->execute("INSERT INTO finance_transactions (id, company_id, kind, financial_post, category, description, amount, transaction_date, created_by_user_id, idempotency_key, created_at) VALUES (?, ?, 'expense', 'GA', 'Vendor', 'Fabricated', ?, '2026-11-04', ?, ?, UTC_TIMESTAMP(6))",
        [$id, $c['id'], $amount, $c['user'], bin2hex(random_bytes(16))]);
    return $id;
};
$payment = static function (Database $db, array $c, string $requestId, string $transactionId, array $over = []): string {
    $v = $over + ['id' => bin2hex(random_bytes(16)), 'company' => $c['id'], 'date' => '2026-11-04', 'method' => 'bankTransfer', 'amount' => '250000.00', 'user' => $c['user'], 'key' => bin2hex(random_bytes(16))];
    $db->execute('INSERT INTO finance_request_payments (id, company_id, finance_request_id, finance_transaction_id, paid_on, payment_method, amount, paid_by_user_id, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))',
        [$v['id'], $v['company'], $requestId, $transactionId, $v['date'], $v['method'], $v['amount'], $v['user'], $v['key']]);
    return $v['id'];
};
$expectRefused = static function (Closure $fn, string $label): void {
    try {
        $fn();
    } catch (\Throwable) {
        return;
    }
    throw new \TamOs\Tests\AssertionFailed('expected the database to refuse: ' . $label);
};
$columns = static function (Database $db, string $table): array {
    $out = [];
    foreach ($db->select('SELECT COLUMN_NAME AS c, COLUMN_TYPE AS t, IS_NULLABLE AS n, COLLATION_NAME AS k FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION', [$table]) as $r) {
        $out[(string) $r['c']] = $r['t'] . ' ' . $r['n'] . ' ' . ($r['k'] ?? '-');
    }
    return $out;
};
$count = static fn (Database $db, string $table): int => (int) $db->select('SELECT COUNT(*) AS n FROM `' . $table . '`')[0]['n'];

return [
    'M1: the fresh sequence 0001–0041 applies in order and is current; no request or payment is seeded' => static function () use ($count): void {
        $db = testDatabase();
        $applied = (new Migrator($db, productionMigrationsDir()))->apply();
        $labels = array_map(static fn ($m): string => $m->label(), $applied);
        assertSame(41, count($labels), 'forty-one migrations');
        assertSame(['0039_create_finance_requests', '0040_create_finance_request_payments', '0041_replace_audit_events_finance_requests'], array_slice($labels, -3));
        assertSame(range(1, 41), array_map(static fn (string $l): int => (int) substr($l, 0, 4), $labels), 'in order, without a gap');
        assertSame([], (new Migrator($db, productionMigrationsDir()))->status(), 'head 0041, current');
        assertSame([0, 0], [$count($db, 'finance_requests'), $count($db, 'finance_request_payments')], 'nothing is seeded');
    },

    'M1: the request and payment columns — exact money, DATEs, ascii identifiers, business text in utf8mb4' => static function () use ($columns): void {
        $db = authDatabase();
        $u = 'utf8mb4_unicode_ci';
        assertSame([
            'id' => 'char(32) NO ascii_bin', 'company_id' => 'char(32) NO ascii_bin', 'kind' => 'varchar(16) NO ascii_bin', 'financial_post' => 'varchar(8) NO ascii_bin',
            'category' => 'varchar(64) NO ' . $u, 'description' => 'varchar(500) NO ' . $u, 'amount' => 'decimal(17,2) NO -', 'payee' => 'varchar(160) YES ' . $u,
            'owner_employee_id' => 'varchar(64) YES ascii_bin', 'document_date' => 'date NO -', 'status' => 'varchar(16) NO ascii_bin', 'status_reason' => 'varchar(200) YES ' . $u,
            'version' => 'int(10) unsigned NO -', 'idempotency_key' => 'char(32) NO ascii_bin', 'created_by_user_id' => 'char(32) NO ascii_bin',
            'created_at' => 'datetime(6) NO -', 'updated_at' => 'datetime(6) NO -',
        ], $columns($db, 'finance_requests'));
        assertSame([
            'id' => 'char(32) NO ascii_bin', 'company_id' => 'char(32) NO ascii_bin', 'finance_request_id' => 'char(32) NO ascii_bin', 'finance_transaction_id' => 'char(32) NO ascii_bin',
            'paid_on' => 'date NO -', 'payment_method' => 'varchar(16) NO ascii_bin', 'amount' => 'decimal(17,2) NO -', 'paid_by_user_id' => 'char(32) NO ascii_bin',
            'idempotency_key' => 'char(32) NO ascii_bin', 'created_at' => 'datetime(6) NO -',
        ], $columns($db, 'finance_request_payments'));
        foreach (['finance_requests', 'finance_request_payments'] as $t) {
            assertSame('InnoDB', (string) $db->select('SELECT ENGINE AS e FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [$t])[0]['e'], $t . ' is InnoDB');
        }
        $fks = $db->select("SELECT CONSTRAINT_NAME AS n, DELETE_RULE AS d, UPDATE_RULE AS u FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('finance_requests', 'finance_request_payments') ORDER BY CONSTRAINT_NAME");
        assertSame(7, count($fks), 'seven foreign keys');
        foreach ($fks as $fk) {
            assertSame(['RESTRICT', 'RESTRICT'], [(string) $fk['d'], (string) $fk['u']], $fk['n'] . ' never cascades');
        }
    },

    'M3: valid rows of both kinds are admitted; every malformed request is refused by the database' => static function () use ($company, $request, $expectRefused, $count): void {
        $db = authDatabase();
        $c = $company($db);
        $request($db, $c);
        $request($db, $c, ['kind' => 'reimbursement', 'payee' => null, 'owner' => $c['employee'], 'post' => 'DRONE', 'category' => 'Transport ☕']);
        $request($db, $c, ['status' => 'Rejected', 'reason' => 'Fabricated duplicate', 'version' => 3]);
        $request($db, $c, ['status' => 'Cancelled', 'reason' => 'Fabricated', 'amount' => '999999999999999.00']);
        foreach (['Submitted', 'Approved', 'Paid'] as $s) {
            $request($db, $c, ['status' => $s]);
        }
        $reimb = ['kind' => 'reimbursement', 'payee' => null, 'owner' => $c['employee']];
        foreach ([
            'an unknown kind' => ['kind' => 'invoice'],
            'an unknown Financial Post' => ['post' => 'HQ'],
            'a lower-case Financial Post' => ['post' => 'ga'],
            'a payroll category (gaji)' => ['category' => 'Gaji'],
            'a payroll category (payroll)' => ['category' => 'PAYROLL'],
            'a payroll category (salary)' => ['category' => 'salary'],
            'an empty category' => ['category' => ''],
            'an untrimmed category' => ['category' => ' Vendor'],
            'a 65-character category' => ['category' => str_repeat('k', 65)],
            'an empty description' => ['description' => ''],
            'an untrimmed description' => ['description' => 'Fabricated '],
            'a 501-character description' => ['description' => str_repeat('d', 501)],
            'a zero amount' => ['amount' => '0.00'],
            'a negative amount' => ['amount' => '-1.00'],
            'a fractional amount' => ['amount' => '1000.50'],
            'a payment request without a payee' => ['payee' => null],
            'a payment request with an empty payee' => ['payee' => ''],
            'a payment request with an untrimmed payee' => ['payee' => 'CV Fiktif '],
            'a payment request with an owner' => ['owner' => $c['employee']],
            'a reimbursement with a payee' => ['payee' => 'CV Fiktif'] + $reimb,
            'a reimbursement without an owner' => ['owner' => null] + $reimb,
            'a reimbursement owned by an unknown employee' => ['owner' => 'e_unknown'] + $reimb,
            'an unknown status' => ['status' => 'Returned'],
            'a Rejected request without a reason' => ['status' => 'Rejected'],
            'a Cancelled request without a reason' => ['status' => 'Cancelled'],
            'an empty reason' => ['status' => 'Rejected', 'reason' => ''],
            'an untrimmed reason' => ['status' => 'Cancelled', 'reason' => ' Fabricated'],
            'a reason on a Draft' => ['reason' => 'Fabricated'],
            'a reason on a Paid request' => ['status' => 'Paid', 'reason' => 'Fabricated'],
            'version zero' => ['version' => 0],
            'a date before 1900' => ['date' => '1899-12-31'],
            'an upper-case id' => ['id' => strtoupper(bin2hex(random_bytes(16)))],
            'a short id' => ['id' => bin2hex(random_bytes(15))],
            'an id in the employee format' => ['id' => 'req_1'],             // B-2: the id format is owned here (0039)
            'a malformed idempotency key' => ['key' => 'not-a-key'],
            'an unknown company' => ['company' => bin2hex(random_bytes(16))],
            'an unknown creator' => ['user' => bin2hex(random_bytes(16))],
        ] as $label => $over) {
            $expectRefused(static fn () => $request($db, $c, $over), $label);
        }
        $key = bin2hex(random_bytes(16));
        $request($db, $c, ['key' => $key]);
        $expectRefused(static fn () => $request($db, $c, ['key' => $key]), 'an idempotency key twice in one company');
        $other = $company($db);
        $request($db, $other, ['key' => $key]);
        $expectRefused(static fn () => $request($db, $c, ['kind' => 'reimbursement', 'payee' => null, 'owner' => $other['employee']]), 'a reimbursement owned by another company\'s employee');
        assertSame(9, $count($db, 'finance_requests'), 'only the valid rows exist');
    },

    'M3: one payment per request and per transaction, same tenant, never removed; a paid request and its expense cannot be deleted' => static function () use ($company, $request, $transaction, $payment, $expectRefused): void {
        $db = authDatabase();
        $c = $company($db);
        $r = $request($db, $c, ['status' => 'Paid']);
        $t = $transaction($db, $c);
        $p = $payment($db, $c, $r, $t);
        foreach ([
            'a second payment of the request' => static fn () => $payment($db, $c, $r, $transaction($db, $c)),
            'a second request paid by the transaction' => static fn () => $payment($db, $c, $request($db, $c, ['status' => 'Paid']), $t),
            'an unknown method' => static fn () => $payment($db, $c, $request($db, $c), $transaction($db, $c), ['method' => 'cheque']),
            'a zero amount' => static fn () => $payment($db, $c, $request($db, $c), $transaction($db, $c), ['amount' => '0.00']),
            'a fractional amount' => static fn () => $payment($db, $c, $request($db, $c), $transaction($db, $c), ['amount' => '1.50']),
            'a date before 1900' => static fn () => $payment($db, $c, $request($db, $c), $transaction($db, $c), ['date' => '1899-01-01']),
            'a malformed id' => static fn () => $payment($db, $c, $request($db, $c), $transaction($db, $c), ['id' => 'x']),
            'a malformed idempotency key' => static fn () => $payment($db, $c, $request($db, $c), $transaction($db, $c), ['key' => 'x']),
            'an unknown payer' => static fn () => $payment($db, $c, $request($db, $c), $transaction($db, $c), ['user' => bin2hex(random_bytes(16))]),
            'an unknown request' => static fn () => $payment($db, $c, bin2hex(random_bytes(16)), $transaction($db, $c)),
            'an unknown transaction' => static fn () => $payment($db, $c, $request($db, $c), bin2hex(random_bytes(16))),
        ] as $label => $fn) {
            $expectRefused($fn, $label);
        }
        $other = $company($db);
        $expectRefused(static fn () => $payment($db, $other, $request($db, $c), $transaction($db, $other)), 'a payment of another company\'s request');
        $expectRefused(static fn () => $payment($db, $other, $request($db, $other), $transaction($db, $c)), 'a payment by another company\'s transaction');
        $expectRefused(static fn () => $db->execute('DELETE FROM finance_requests WHERE id = ?', [$r]), 'deleting a paid request');
        $expectRefused(static fn () => $db->execute('DELETE FROM finance_transactions WHERE id = ?', [$t]), 'deleting the linked expense');
        $expectRefused(static fn () => $db->execute('UPDATE finance_request_payments SET finance_request_id = ? WHERE id = ?', [bin2hex(random_bytes(16)), $p]), 'relinking the payment');
        assertSame(1, (int) $db->select('SELECT COUNT(*) AS n FROM finance_request_payments WHERE company_id = ?', [$c['id']])[0]['n'], 'the one payment stands');
    },

    "M3: the 0041 audit vocabulary admits exactly the request triples and keeps every earlier rule" => static function () use ($company, $expectRefused): void {
        $db = authDatabase();
        $c = $company($db);
        $m = bin2hex(random_bytes(16));
        $db->execute("INSERT INTO memberships (id, user_id, company_id, role, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, 'ceo', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$m, $c['user'], $c['id']]);
        // ADR-016 §8: these CHECKs judge only the (action, entity, operation) triple. No migration checks the
        // format of audit_events.entity_id beyond non-empty (0017), and earlier entities hold non-hex ids
        // (LEGACY-NNNNNN employees, 0015). A request id's format is enforced by finance_requests_id (0039, M3
        // above) and the server-generated ids; a malformed id in an audit answer is rejected by the client
        // decoder (D4, tools/verify-session-audit-runtime.js). B-2: so no malformed-id case belongs here.
        $row = static fn (string $action, string $entity, ?string $op) => $db->execute('INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, ?, ?, ?, ?, NULL, ?, NULL)',
            [$c['id'], $c['user'], $m, $action, $entity, str_repeat('b', 32), $op, str_repeat('a', 32)]);
        $admitted = [
            ['reimbursement.createSelfDraft', 'financeRequest', null], ['reimbursement.updateSelfDraft', 'financeRequest', null], ['reimbursement.submitSelf', 'financeRequest', 'submit'],
            ['finance.manage', 'financeRequest', 'create'], ['finance.manage', 'financeRequest', 'update'], ['finance.manage', 'financeRequest', 'submit'],
            ['finance.manage', 'financeRequest', 'approve'], ['finance.manage', 'financeRequest', 'reject'], ['finance.manage', 'financeRequest', 'cancel'],
            ['finance.execute', 'financeRequest', 'pay'], ['finance.execute', 'financeTransaction', 'create'],
            ['finance.manage', 'financeTransaction', 'create'], ['finance.manage', 'financeTransaction', 'void'], ['finance.execute', 'financePosting', 'execute'],
            ['payroll.manage', 'payrollPlan', 'post'], ['employee.update', 'employee', null],
        ];
        foreach ($admitted as [$a, $e, $o]) {
            $row($a, $e, $o);
        }
        foreach ([
            'pay under finance.manage' => ['finance.manage', 'financeRequest', 'pay'],
            'void on a request' => ['finance.manage', 'financeRequest', 'void'],
            'no operation under finance.manage on a request' => ['finance.manage', 'financeRequest', null],
            'approve under finance.execute' => ['finance.execute', 'financeRequest', 'approve'],
            'execute on a request' => ['finance.execute', 'financeRequest', 'execute'],
            'void under finance.execute' => ['finance.execute', 'financeTransaction', 'void'],
            'no operation under finance.execute' => ['finance.execute', 'financeTransaction', null],
            'pay on a posting' => ['finance.execute', 'financePosting', 'pay'],
            'update on a transaction' => ['finance.manage', 'financeTransaction', 'update'],
            'an operation on a self draft' => ['reimbursement.createSelfDraft', 'financeRequest', 'create'],
            'an operation on a self update' => ['reimbursement.updateSelfDraft', 'financeRequest', 'update'],
            'approve under submitSelf' => ['reimbursement.submitSelf', 'financeRequest', 'approve'],
            'no operation under submitSelf' => ['reimbursement.submitSelf', 'financeRequest', null],
            'a self action on overtime' => ['reimbursement.submitSelf', 'overtime', 'submit'],
            'a request under payroll.manage' => ['payroll.manage', 'financeRequest', 'approve'],
            'an unknown action' => ['reimbursement.approve', 'financeRequest', 'approve'],
            'an unknown entity' => ['finance.manage', 'paymentRequest', 'create'],
        ] as $label => $t) {
            $expectRefused(static fn () => $row(...$t), $label);
        }
        assertSame(count($admitted), (int) $db->select('SELECT COUNT(*) AS n FROM audit_events WHERE company_id = ?', [$c['id']])[0]['n'], 'exactly the admitted triples are stored');
    },

    'M2: 0039–0041 migrate a schema-0038 database forward: Phase 1, payroll, posting, execution and audit rows survive byte-identical; nothing is seeded' => static function () use ($count): void {
        $db = testDatabase();
        $files = [];
        foreach (glob(productionMigrationsDir() . '/*.sql') ?: [] as $path) {
            if ((int) substr(basename($path), 0, 4) <= 38) {
                $files[basename($path)] = (string) file_get_contents($path);
            }
        }
        assertSame(38, count($files), 'the schema-0038 fixture');
        (new Migrator($db, migrationFixture($files)))->apply();
        $c = bin2hex(random_bytes(16));
        $u = bin2hex(random_bytes(16));
        $m = bin2hex(random_bytes(16));
        $e = 'e_up_' . substr($c, 0, 6);
        $plan = bin2hex(random_bytes(16));
        $posting = bin2hex(random_bytes(16));
        $txn = bin2hex(random_bytes(16));
        $db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$c]);
        $db->execute("INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (?, 'upgrade-0038@example.test', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$u]);
        $db->execute("INSERT INTO memberships (id, user_id, company_id, role, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, 'ceo', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$m, $u, $c]);
        $db->execute("INSERT INTO employees (id, company_id, employee_code, full_name, monthly_base_salary, created_at, updated_at) VALUES (?, ?, ?, 'Fixture', '3500000.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$e, $c, 'UP' . substr($c, 0, 6)]);
        $db->execute("INSERT INTO payroll_plans (id, company_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, '2026-10', 'Committed', 'CODE', 'Fixture', NULL, '3500000.00', '0.00', '0.00', 0, '3500000.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), ?, 2, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$plan, $c, $e, bin2hex(random_bytes(16))]);
        $db->execute("INSERT INTO finance_postings (id, company_id, source_kind, payroll_plan_id, supplemental_payroll_id, employee_id, month_key, amount, status, idempotency_key, posted_at) VALUES (?, ?, 'payrollPlan', ?, NULL, ?, '2026-10', '3500000.00', 'Planned', ?, UTC_TIMESTAMP(6))", [$posting, $c, $plan, $e, bin2hex(random_bytes(16))]);
        $db->execute("INSERT INTO finance_executions (id, company_id, finance_posting_id, employee_id, month_key, amount, executed_on, payment_method, idempotency_key, recorded_at) VALUES (?, ?, ?, ?, '2026-10', '3500000.00', '2026-10-25', 'bankTransfer', ?, UTC_TIMESTAMP(6))", [bin2hex(random_bytes(16)), $c, $posting, $e, bin2hex(random_bytes(16))]);
        $db->execute("INSERT INTO finance_transactions (id, company_id, kind, financial_post, category, description, amount, transaction_date, created_by_user_id, idempotency_key, created_at) VALUES (?, ?, 'expense', 'NPIP', 'Operasional', 'Fabricated', '125000.00', '2026-10-20', ?, ?, UTC_TIMESTAMP(6))", [$txn, $c, $u, bin2hex(random_bytes(16))]);
        $db->execute("INSERT INTO finance_transaction_voids (id, company_id, finance_transaction_id, reason, voided_by_user_id, idempotency_key, voided_at) VALUES (?, ?, ?, 'Fabricated duplicate', ?, ?, UTC_TIMESTAMP(6))", [bin2hex(random_bytes(16)), $c, $txn, $u, bin2hex(random_bytes(16))]);
        foreach ([['finance.execute', 'financePosting', $posting, 'execute'], ['finance.manage', 'financeTransaction', $txn, 'create'], ['finance.manage', 'financeTransaction', $txn, 'void'], ['employee.update', 'employee', $e, null]] as [$a, $en, $id, $op]) {
            $db->execute('INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, ?, ?, ?, ?, NULL, ?, NULL)', [$c, $u, $m, $a, $en, $id, $op, str_repeat('a', 32)]);
        }
        $snapshot = static fn (): array => array_map(static fn (string $t): array => $db->select('SELECT * FROM `' . $t . '` ORDER BY id'),
            ['employees', 'payroll_plans', 'finance_postings', 'finance_executions', 'finance_transactions', 'finance_transaction_voids', 'audit_events', 'memberships', 'users', 'companies']);
        $before = $snapshot();
        $applied = (new Migrator($db, productionMigrationsDir()))->apply();
        assertSame(['0039_create_finance_requests', '0040_create_finance_request_payments', '0041_replace_audit_events_finance_requests'], array_map(static fn ($x): string => $x->label(), $applied), 'only the AWP-01 migrations run');
        assertSame([], (new Migrator($db, productionMigrationsDir()))->status(), 'head 0041, current');
        assertSame($before, $snapshot(), 'every Phase 1, payroll, posting, execution, employee and audit row is unchanged');
        assertSame([0, 0], [$count($db, 'finance_requests'), $count($db, 'finance_request_payments')], 'nothing is seeded');
        $db->execute("INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, 'finance.execute', 'financeRequest', ?, 'pay', NULL, ?, NULL)", [$c, $u, $m, str_repeat('b', 32), str_repeat('a', 32)]);
        assertTrue(true, 'the upgraded audit vocabulary admits a request row');
    },
];
