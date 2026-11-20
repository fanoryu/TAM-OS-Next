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
 *
 * CR-01 (ADR-017, migration 0042; CR01-MIGRATION-0042-DESIGN M-T1–M-T4, M-T3b, M-T6; T-D1, T-D3, T-D4):
 * the fresh sequence reaches 0042; a schema-0041 database with both kinds in all six statuses migrates
 * with every row unchanged except the new columns (NULL, 0) and identical report figures; every new
 * CHECK refuses its row and the allowed edge rows are admitted; a failing 0042 refuses cleanly (the
 * table unchanged, the incomplete marker blocking every consumer, as for every migration).
 */

use TamOs\Data\Database;
use TamOs\Data\DatabaseError;
use TamOs\Data\Migration\MigrationError;
use TamOs\Data\Migration\Migrator;
use TamOs\Data\Report\FinancialReportStore;
use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Identity\Principal;
use TamOs\Policy\Scope;
use TamOs\Report\FinancialReport;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
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
    if (array_key_exists('previous', $over) || array_key_exists('captured', $over)) {
        // CR-01 (migration 0042): the pre-approval snapshot columns, named only when a case sets them.
        $db->execute('INSERT INTO finance_requests (id, company_id, kind, financial_post, pre_approval_financial_post, pre_approval_post_captured, category, description, amount, payee, owner_employee_id, document_date, status, status_reason, version, idempotency_key, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))',
            [$v['id'], $v['company'], $v['kind'], $v['post'], $over['previous'] ?? null, $over['captured'] ?? 0, $v['category'], $v['description'], $v['amount'], $v['payee'], $v['owner'], $v['date'], $v['status'], $v['reason'], $v['version'], $v['key'], $v['user']]);
        return $v['id'];
    }
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
    // CR-01 (ADR-017) authorized revision: the fresh sequence ends at 0042 (M-T1). Was: 0001–0041, forty-one migrations.
    'M1: the fresh sequence 0001–0042 applies in order and is current; no request or payment is seeded' => static function () use ($count): void {
        $db = testDatabase();
        $applied = (new Migrator($db, productionMigrationsDir()))->apply();
        $labels = array_map(static fn ($m): string => $m->label(), $applied);
        assertSame(42, count($labels), 'forty-two migrations');
        assertSame(['0039_create_finance_requests', '0040_create_finance_request_payments', '0041_replace_audit_events_finance_requests', '0042_alter_finance_requests_assigned_post'], array_slice($labels, -4));
        assertSame(range(1, 42), array_map(static fn (string $l): int => (int) substr($l, 0, 4), $labels), 'in order, without a gap');
        assertSame([], (new Migrator($db, productionMigrationsDir()))->status(), 'head 0042, current');
        assertSame([0, 0], [$count($db, 'finance_requests'), $count($db, 'finance_request_payments')], 'nothing is seeded');
    },

    'M1: the request and payment columns — exact money, DATEs, ascii identifiers, business text in utf8mb4' => static function () use ($columns): void {
        $db = authDatabase();
        $u = 'utf8mb4_unicode_ci';
        assertSame([
            // CR-01 (ADR-017, migration 0042) authorized revision: the post is nullable, followed by the snapshot. Was: 'varchar(8) NO ascii_bin', no snapshot.
            'id' => 'char(32) NO ascii_bin', 'company_id' => 'char(32) NO ascii_bin', 'kind' => 'varchar(16) NO ascii_bin', 'financial_post' => 'varchar(8) YES ascii_bin',
            'pre_approval_financial_post' => 'varchar(8) YES ascii_bin', 'pre_approval_post_captured' => 'tinyint(1) NO -',
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

    // CR-01 (ADR-017) authorized revision: the forward run from 0038 now also applies 0042. Was: 0039–0041.
    'M2: 0039–0042 migrate a schema-0038 database forward: Phase 1, payroll, posting, execution and audit rows survive byte-identical; nothing is seeded' => static function () use ($count): void {
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
        assertSame(['0039_create_finance_requests', '0040_create_finance_request_payments', '0041_replace_audit_events_finance_requests', '0042_alter_finance_requests_assigned_post'], array_map(static fn ($x): string => $x->label(), $applied), 'only the AWP-01 and CR-01 migrations run');
        assertSame([], (new Migrator($db, productionMigrationsDir()))->status(), 'head 0042, current');
        assertSame($before, $snapshot(), 'every Phase 1, payroll, posting, execution, employee and audit row is unchanged');
        assertSame([0, 0], [$count($db, 'finance_requests'), $count($db, 'finance_request_payments')], 'nothing is seeded');
        $db->execute("INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, 'finance.execute', 'financeRequest', ?, 'pay', NULL, ?, NULL)", [$c, $u, $m, str_repeat('b', 32), str_repeat('a', 32)]);
        assertTrue(true, 'the upgraded audit vocabulary admits a request row');
    },

    'CR-01 M-T2/M-T6: 0042 migrates a schema-0041 database with both kinds in all six statuses — every row unchanged except the new columns (NULL, 0); the report figures are byte-identical' => static function () use ($company, $request, $columns): void {
        $db = testDatabase();
        $files = [];
        foreach (glob(productionMigrationsDir() . '/*.sql') ?: [] as $path) {
            if ((int) substr(basename($path), 0, 4) <= 41) {
                $files[basename($path)] = (string) file_get_contents($path);
            }
        }
        assertSame(41, count($files), 'the schema-0041 fixture');
        (new Migrator($db, migrationFixture($files)))->apply();
        $c = $company($db);
        $reasons = ['Rejected' => 'Fabricated rejection', 'Cancelled' => 'Fabricated cancellation'];
        foreach (['Draft', 'Submitted', 'Approved', 'Paid', 'Rejected', 'Cancelled'] as $i => $s) {
            $request($db, $c, ['status' => $s, 'reason' => $reasons[$s] ?? null, 'post' => ['GA', 'NPIP', 'TJB', 'DRONE'][$i % 4], 'amount' => (1000 * ($i + 1)) . '.00', 'date' => '2026-10-0' . ($i + 1)]);
            $request($db, $c, ['kind' => 'reimbursement', 'payee' => null, 'owner' => $c['employee'], 'status' => $s, 'reason' => $reasons[$s] ?? null,
                'post' => ['DRONE', 'TJB', 'NPIP', 'GA'][$i % 4], 'amount' => (300 * ($i + 1)) . '.00', 'date' => '2026-10-1' . ($i + 1)]);
        }
        $db->execute("INSERT INTO finance_transactions (id, company_id, kind, financial_post, category, description, amount, transaction_date, created_by_user_id, idempotency_key, created_at) VALUES (?, ?, 'expense', 'TJB', 'Vendor', 'Fabricated', '125000.00', '2026-10-20', ?, ?, UTC_TIMESTAMP(6))",
            [bin2hex(random_bytes(16)), $c['id'], $c['user'], bin2hex(random_bytes(16))]);
        $principal = Principal::fromAccount(['user_id' => $c['user'], 'user_status' => 'active', 'has_password' => true],
            [['membership_id' => bin2hex(random_bytes(16)), 'company_id' => $c['id'], 'role' => 'ceo', 'employee_id' => null, 'membership_status' => 'active']]) ?? throw new \LogicException('fixture');
        $scope = Scope::of($principal);
        $figures = static function () use ($db, $scope): string {
            $store = new FinancialReportStore(new ScopedDatabase($db));
            return json_encode(FinancialReport::build(['from' => '2026-10-01', 'to' => '2026-10-31'], $store->transactions($scope, '2026-10-01', '2026-10-31'),
                $store->postings($scope, '2026-10', '2026-10'), $store->executions($scope, '2026-10-01', '2026-10-31'), $store->approved($scope, '2026-10-01', '2026-10-31')), JSON_THROW_ON_ERROR);
        };
        $others = static fn (): array => array_map(static fn (string $t): array => $db->select('SELECT * FROM `' . $t . '` ORDER BY id'), ['finance_transactions', 'finance_request_payments', 'audit_events', 'employees', 'companies', 'users']);
        $before = $db->select('SELECT * FROM finance_requests ORDER BY id');
        $beforeOthers = $others();
        $beforeFigures = $figures();
        $applied = (new Migrator($db, productionMigrationsDir()))->apply();
        assertSame(['0042_alter_finance_requests_assigned_post'], array_map(static fn ($x): string => $x->label(), $applied), 'only 0042 runs');
        assertSame([], (new Migrator($db, productionMigrationsDir()))->status(), 'head 0042, current');
        $after = $db->select('SELECT * FROM finance_requests ORDER BY id');
        assertSame(12, count($after), 'twelve requests');
        foreach ($after as $i => $row) {
            assertSame([null, 0], [$row['pre_approval_financial_post'], (int) $row['pre_approval_post_captured']], 'the new columns are NULL and 0 (not captured)');
            unset($row['pre_approval_financial_post'], $row['pre_approval_post_captured']);
            assertSame($before[$i], $row, 'every existing value is unchanged');
        }
        assertSame($beforeOthers, $others(), 'transactions, payments, audit rows and identities are untouched');
        assertSame($beforeFigures, $figures(), 'M-T6: the report figures are byte-identical across 0042');
        assertSame('varchar(8) YES ascii_bin', $columns($db, 'finance_requests')['financial_post'], 'the post became nullable');
    },

    'CR-01 M-T3/T-D1/T-D4: every 0042 CHECK refuses its row — a payment request or an Approved/Paid reimbursement without a post, RND, a snapshot without capture, a capture outside an approved reimbursement, a capture without a final post (M-7)' => static function () use ($company, $request, $expectRefused): void {
        $db = authDatabase();
        $c = $company($db);
        $reimb = ['kind' => 'reimbursement', 'payee' => null, 'owner' => $c['employee']];
        $reasons = ['Rejected' => 'Fabricated', 'Cancelled' => 'Fabricated'];
        $refused = [];
        foreach (['Draft', 'Submitted', 'Approved', 'Paid', 'Rejected', 'Cancelled'] as $s) {
            $refused['M-3: a ' . $s . ' payment request without a post'] = ['post' => null, 'status' => $s, 'reason' => $reasons[$s] ?? null];
        }
        $refused += [
            'M-4/T-D4: an Approved reimbursement without a post' => ['post' => null, 'status' => 'Approved'] + $reimb,
            'M-4/T-D4: a Paid reimbursement without a post' => ['post' => null, 'status' => 'Paid'] + $reimb,
            'M-2: RND as the post (DRONE is the code)' => ['post' => 'RND'] + $reimb,
            'M-2: a lower-case post' => ['post' => 'drone'] + $reimb,
            'M-6: RND as the previous post' => ['status' => 'Approved', 'previous' => 'RND', 'captured' => 1] + $reimb,
            'M-6: a previous post with captured = 0' => ['status' => 'Approved', 'previous' => 'GA', 'captured' => 0] + $reimb,
            'M-6: captured on a payment request' => ['status' => 'Approved', 'captured' => 1],
            'M-6: captured on a Draft' => ['captured' => 1] + $reimb,
            'M-6: captured on a Submitted request' => ['status' => 'Submitted', 'captured' => 1] + $reimb,
            'M-6: captured on a Rejected request' => ['status' => 'Rejected', 'reason' => 'Fabricated', 'captured' => 1] + $reimb,
            'M-6: captured outside 0/1' => ['status' => 'Approved', 'captured' => 2] + $reimb,
            'M-7/T-D1: captured with no final post, Approved' => ['status' => 'Approved', 'post' => null, 'captured' => 1] + $reimb,
            'M-7/T-D1: captured with no final post, Paid' => ['status' => 'Paid', 'post' => null, 'captured' => 1] + $reimb,
            'M-7/T-D1: captured with no final post, Cancelled' => ['status' => 'Cancelled', 'reason' => 'Fabricated', 'post' => null, 'captured' => 1] + $reimb,
        ];
        foreach ($refused as $label => $over) {
            $expectRefused(static fn () => $request($db, $c, $over), $label);
        }
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM finance_requests WHERE company_id = ?', [$c['id']])[0]['n'], 'no refused row exists');
        // T-D1 / T-D4 by UPDATE: an existing row cannot be made invalid either.
        $approved = $request($db, $c, ['status' => 'Approved', 'captured' => 1, 'post' => 'DRONE'] + $reimb);
        $cancelled = $request($db, $c, ['status' => 'Cancelled', 'reason' => 'Fabricated', 'captured' => 1, 'post' => 'TJB', 'previous' => 'GA'] + $reimb);
        $early = $request($db, $c, ['status' => 'Cancelled', 'reason' => 'Fabricated', 'post' => null] + $reimb);
        $payment = $request($db, $c, ['status' => 'Approved']);
        foreach ([
            'T-D4: clearing an Approved post' => ['UPDATE finance_requests SET financial_post = NULL WHERE id = ?', $approved],
            'T-D1: clearing a cancelled approval\'s post' => ['UPDATE finance_requests SET financial_post = NULL WHERE id = ?', $cancelled],
            'T-D1: capturing a Cancelled row that has no post' => ['UPDATE finance_requests SET pre_approval_post_captured = 1 WHERE id = ?', $early],
            'T-D4: clearing a payment request post' => ['UPDATE finance_requests SET financial_post = NULL WHERE id = ?', $payment],
            'M-6: dropping the capture flag under a previous post' => ['UPDATE finance_requests SET pre_approval_post_captured = 0 WHERE id = ?', $cancelled],
        ] as $label => [$sql, $id]) {
            $expectRefused(static fn () => $db->execute($sql, [$id]), $label);
        }
        $state = static fn (string $id): array => (static function (array $x): array { return [$x['financial_post'], $x['pre_approval_financial_post'], (int) $x['pre_approval_post_captured']]; })($db->select('SELECT financial_post, pre_approval_financial_post, pre_approval_post_captured FROM finance_requests WHERE id = ?', [$id])[0]);
        assertSame([['DRONE', null, 1], ['TJB', 'GA', 1], [null, null, 0], ['GA', null, 0]], [$state($approved), $state($cancelled), $state($early), $state($payment)], 'the refused updates changed nothing');
    },

    'CR-01 M-T3b/T-D3: the allowed edge rows are admitted — no post before approval in Draft, Submitted, Rejected and Cancelled; a cancelled approval with its post and capture; a pre-0042 approval not captured' => static function () use ($company, $request): void {
        $db = authDatabase();
        $c = $company($db);
        $reimb = ['kind' => 'reimbursement', 'payee' => null, 'owner' => $c['employee']];
        $ids = [
            $request($db, $c, ['post' => null] + $reimb),
            $request($db, $c, ['post' => null, 'status' => 'Submitted'] + $reimb),
            $request($db, $c, ['post' => null, 'status' => 'Rejected', 'reason' => 'Fabricated'] + $reimb),
            $request($db, $c, ['post' => null, 'status' => 'Cancelled', 'reason' => 'Fabricated', 'captured' => 0] + $reimb),   // T-D3: cancelled before approval
            $request($db, $c, ['post' => 'TJB', 'status' => 'Cancelled', 'reason' => 'Fabricated', 'captured' => 1] + $reimb),  // cancelled after approval, no previous post
            $request($db, $c, ['post' => 'NPIP', 'status' => 'Cancelled', 'reason' => 'Fabricated', 'captured' => 1, 'previous' => 'GA'] + $reimb),
            $request($db, $c, ['post' => 'DRONE', 'status' => 'Approved', 'captured' => 1, 'previous' => 'DRONE'] + $reimb),   // a confirmed post
            $request($db, $c, ['post' => 'GA', 'status' => 'Paid', 'captured' => 1, 'previous' => null] + $reimb),
            $request($db, $c, ['post' => 'GA', 'status' => 'Approved'] + $reimb),                                              // approved before 0042: not captured
        ];
        assertSame(count($ids), (int) $db->select('SELECT COUNT(*) AS n FROM finance_requests WHERE company_id = ?', [$c['id']])[0]['n'], 'every edge row is stored');
    },

    'CR-01 M-T4: a 0042 that cannot validate the existing rows refuses cleanly — the table unchanged, the incomplete marker blocking apply, status and inspect' => static function () use ($company, $request, $columns): void {
        $db = testDatabase();
        $files = [];
        foreach (glob(productionMigrationsDir() . '/*.sql') ?: [] as $path) {
            if ((int) substr(basename($path), 0, 4) <= 41) {
                $files[basename($path)] = (string) file_get_contents($path);
            }
        }
        (new Migrator($db, migrationFixture($files)))->apply();
        $c = $company($db);
        $request($db, $c);
        $db->execute('SET SESSION check_constraint_checks = 0');
        try {
            $request($db, $c, ['post' => 'RND']);                  // seeded invalid row: a code the 0042 CHECK refuses
        } finally {
            $db->execute('SET SESSION check_constraint_checks = 1');
        }
        $shape = $columns($db, 'finance_requests');
        $rowsBefore = $db->select('SELECT * FROM finance_requests ORDER BY id');
        $e = assertThrows(DatabaseError::class, static fn () => (new Migrator($db, productionMigrationsDir()))->apply());
        assertSame(DatabaseError::FAILURE, $e->kind, 'the ALTER is refused');
        assertSame($shape, $columns($db, 'finance_requests'), 'the table is unchanged: the post still NOT NULL, no snapshot column');
        assertTrue(!array_key_exists('pre_approval_financial_post', $columns($db, 'finance_requests')), 'no snapshot column');
        assertSame($rowsBefore, $db->select('SELECT * FROM finance_requests ORDER BY id'), 'no row changed');
        $marker = $db->select('SELECT version, applied_at FROM schema_migrations WHERE version = 42');
        assertSame(1, count($marker), 'the started marker is committed (the runner never guesses a failed DDL complete)');
        assertSame(null, $marker[0]['applied_at'], '0042 is recorded incomplete, never applied');
        $m = new Migrator($db, productionMigrationsDir());
        foreach (['apply', 'status', 'inspect'] as $op) {
            $err = assertThrows(MigrationError::class, static fn () => $m->$op(), $op);
            assertSame([MigrationError::SCHEMA_INCOMPLETE, 42], [$err->reason, $err->version], $op . ' refuses until the database is restored (D-AB-13)');
        }
    },
];
