<?php
declare(strict_types=1);

/*
 * Phase 1 general transaction schema against the real MariaDB (migrations 0036–0038; D-INT-1,
 * D-INT-4): the columns of finance_transactions and finance_transaction_voids; the database refusing
 * an unknown Financial Post, an unknown kind, a payroll category, a non-positive or fractional
 * amount, untrimmed or empty text and malformed ids; one void per transaction and each idempotency
 * key once per company per table; the composite tenant FK of a void to its transaction without
 * cascade (a voided transaction can never be removed); the 0038 audit vocabulary ('create' and
 * 'void' under finance.manage on financeTransaction only, every earlier rule kept); the fresh
 * sequence 0001–0038; and the forward migration of a schema-0035 database whose payroll, posting,
 * execution and audit rows survive byte-identical with no transaction seeded.
 */

use TamOs\Data\Database;
use TamOs\Data\Migration\Migrator;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\migrationFixture;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\testDatabase;

/** A company and a user (test-only SQL, fabricated values). */
$company = static function (Database $db): array {
    $c = bin2hex(random_bytes(16));
    $u = bin2hex(random_bytes(16));
    $db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$c]);
    $db->execute("INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (?, ?, NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$u, 'schema-' . substr($u, 0, 8) . '@example.test']);
    return ['id' => $c, 'user' => $u];
};
/** Inserts one transaction (test-only SQL); $over replaces any column value. */
$transaction = static function (Database $db, array $c, array $over = []): string {
    $v = $over + ['id' => bin2hex(random_bytes(16)), 'company' => $c['id'], 'kind' => 'expense', 'post' => 'GA', 'category' => 'Operasional', 'description' => 'Fabricated',
        'amount' => '1000.00', 'date' => '2026-10-07', 'user' => $c['user'], 'key' => bin2hex(random_bytes(16))];
    $db->execute('INSERT INTO finance_transactions (id, company_id, kind, financial_post, category, description, amount, transaction_date, created_by_user_id, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))',
        [$v['id'], $v['company'], $v['kind'], $v['post'], $v['category'], $v['description'], $v['amount'], $v['date'], $v['user'], $v['key']]);
    return $v['id'];
};
$voidRow = static function (Database $db, array $c, string $transactionId, array $over = []): string {
    $v = $over + ['id' => bin2hex(random_bytes(16)), 'company' => $c['id'], 'reason' => 'Fabricated', 'user' => $c['user'], 'key' => bin2hex(random_bytes(16))];
    $db->execute('INSERT INTO finance_transaction_voids (id, company_id, finance_transaction_id, reason, voided_by_user_id, idempotency_key, voided_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))',
        [$v['id'], $v['company'], $transactionId, $v['reason'], $v['user'], $v['key']]);
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

return [
    'the fresh sequence 0001–0038 applies in order and is current; no transaction or void is seeded' => static function (): void {
        $db = testDatabase();
        $applied = (new Migrator($db, productionMigrationsDir()))->apply();
        $labels = array_map(static fn ($m): string => $m->label(), $applied);
        assertSame(38, count($labels), 'thirty-eight migrations');
        assertSame(['0036_create_finance_transactions', '0037_create_finance_transaction_voids', '0038_replace_audit_events_finance_manage'], array_slice($labels, -3));
        $numbers = array_map(static fn (string $l): int => (int) substr($l, 0, 4), $labels);
        assertSame(range(1, 38), $numbers, 'in order, without a gap');
        assertSame([], (new Migrator($db, productionMigrationsDir()))->status(), 'head 0038, current');
        assertSame([0, 0], [(int) $db->select('SELECT COUNT(*) AS n FROM finance_transactions')[0]['n'], (int) $db->select('SELECT COUNT(*) AS n FROM finance_transaction_voids')[0]['n']]);
    },
    'columns: identifiers ascii_bin, an exact DECIMAL amount, a DATE, the creator and DATETIME(6), InnoDB utf8mb4 — no stored status, no update column' => static function () use ($columns): void {
        $db = authDatabase();
        assertSame([
            'id' => 'char(32) NO ascii_bin', 'company_id' => 'char(32) NO ascii_bin', 'kind' => 'varchar(8) NO ascii_bin', 'financial_post' => 'varchar(8) NO ascii_bin',
            'category' => 'varchar(64) NO utf8mb4_unicode_ci', 'description' => 'varchar(500) NO utf8mb4_unicode_ci', 'amount' => 'decimal(17,2) NO -', 'transaction_date' => 'date NO -',
            'created_by_user_id' => 'char(32) NO ascii_bin', 'idempotency_key' => 'char(32) NO ascii_bin', 'created_at' => 'datetime(6) NO -',
        ], $columns($db, 'finance_transactions'));
        assertSame([
            'id' => 'char(32) NO ascii_bin', 'company_id' => 'char(32) NO ascii_bin', 'finance_transaction_id' => 'char(32) NO ascii_bin', 'reason' => 'varchar(200) NO utf8mb4_unicode_ci',
            'voided_by_user_id' => 'char(32) NO ascii_bin', 'idempotency_key' => 'char(32) NO ascii_bin', 'voided_at' => 'datetime(6) NO -',
        ], $columns($db, 'finance_transaction_voids'));
        foreach (['finance_transactions', 'finance_transaction_voids'] as $t) {
            $info = $db->select('SELECT ENGINE AS e, TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [$t])[0];
            assertSame(['InnoDB', 'utf8mb4_unicode_ci'], [(string) $info['e'], (string) $info['c']], $t);
        }
    },
    'CHECKs: only the four Financial Posts, income or expense, no payroll category, a positive whole-Rupiah amount, trimmed non-empty text, canonical ids and keys' => static function () use ($company, $transaction, $voidRow, $expectRefused): void {
        $db = authDatabase();
        $c = $company($db);
        foreach ([
            'an unknown Financial Post' => ['post' => 'HR'], 'a lower-case post' => ['post' => 'ga'], 'a display name as code' => ['post' => 'NP & IP'],
            'an unknown kind' => ['kind' => 'transfer'],
            'the payroll category Gaji' => ['category' => 'Gaji'], 'GAJI' => ['category' => 'GAJI'], 'payroll' => ['category' => 'Payroll'], 'salary' => ['category' => 'salary'],
            'an empty category' => ['category' => ''], 'an untrimmed category' => ['category' => ' Rutin'], 'a trailing-space category' => ['category' => 'Rutin '], 'a trailing-space Gaji' => ['category' => 'Gaji '], 'an empty description' => ['description' => ''], 'an untrimmed description' => ['description' => 'x '],
            'a zero amount' => ['amount' => '0.00'], 'a negative amount' => ['amount' => '-5.00'], 'a fractional amount' => ['amount' => '10.50'],
            'a date before 1900' => ['date' => '1899-12-31'], 'a malformed id' => ['id' => 'not-hex'], 'a malformed key' => ['key' => 'x'], 'an unknown creator' => ['user' => str_repeat('9', 32)],
        ] as $label => $over) {
            $expectRefused(static fn () => $transaction($db, $c, $over), $label);
        }
        foreach (['GA', 'NPIP', 'TJB', 'DRONE'] as $post) {
            $transaction($db, $c, ['post' => $post]);
        }
        $transaction($db, $c, ['category' => 'Gajian Lembur', 'kind' => 'income']);
        $t = $transaction($db, $c);
        foreach (['an empty reason' => ['reason' => ''], 'an untrimmed reason' => ['reason' => ' x'], 'a trailing-space reason' => ['reason' => 'x '], 'an unknown voider' => ['user' => str_repeat('9', 32)], 'a malformed key' => ['key' => 'x']] as $label => $over) {
            $expectRefused(static fn () => $voidRow($db, $c, $t, $over), 'void: ' . $label);
        }
        assertSame(6, (int) $db->select('SELECT COUNT(*) AS n FROM finance_transactions WHERE company_id = ?', [$c['id']])[0]['n'], 'only the six valid rows were stored');
    },
    'one void per transaction, each key once per company per table, a void only of its own company\'s transaction, and no cascade: a voided transaction cannot be removed' => static function () use ($company, $transaction, $voidRow, $expectRefused): void {
        $db = authDatabase();
        $a = $company($db);
        $b = $company($db);
        $key = bin2hex(random_bytes(16));
        $t = $transaction($db, $a, ['key' => $key]);
        $expectRefused(static fn () => $transaction($db, $a, ['key' => $key]), 'the same key twice in one company');
        $transaction($db, $b, ['key' => $key]);
        $voidRow($db, $a, $t);
        $expectRefused(static fn () => $voidRow($db, $a, $t), 'a second void');
        $tb = $transaction($db, $b);
        $expectRefused(static fn () => $voidRow($db, $a, $tb), 'a void of another company\'s transaction');
        $expectRefused(static fn () => $db->execute('DELETE FROM finance_transactions WHERE id = ?', [$t]), 'deleting a voided transaction');
        $fks = $db->select("SELECT CONSTRAINT_NAME AS n, DELETE_RULE AS d FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('finance_transactions', 'finance_transaction_voids') ORDER BY CONSTRAINT_NAME");
        assertSame(5, count($fks), 'company, creator; company, transaction, voider');
        foreach ($fks as $fk) {
            assertSame('RESTRICT', (string) $fk['d'], (string) $fk['n'] . ' never cascades');
        }
    },
    "0038: the audit vocabulary admits 'create' and 'void' under finance.manage on financeTransaction only, and keeps every earlier rule" => static function () use ($company, $expectRefused): void {
        $db = authDatabase();
        $c = $company($db);
        $m = bin2hex(random_bytes(16));
        $db->execute("INSERT INTO memberships (id, user_id, company_id, role, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, 'ceo', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$m, $c['user'], $c['id']]);
        $row = static fn (string $action, string $entity, ?string $op) => $db->execute('INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, ?, ?, ?, ?, NULL, ?, NULL)',
            [$c['id'], $c['user'], $m, $action, $entity, str_repeat('b', 32), $op, str_repeat('a', 32)]);
        $row('finance.manage', 'financeTransaction', 'create');
        $row('finance.manage', 'financeTransaction', 'void');
        foreach ([
            'no operation' => ['finance.manage', 'financeTransaction', null],
            'an update operation' => ['finance.manage', 'financeTransaction', 'update'],
            'a delete operation' => ['finance.manage', 'financeTransaction', 'delete'],
            'another entity' => ['finance.manage', 'financePosting', 'create'],
            'void under finance.execute' => ['finance.execute', 'financeTransaction', 'void'],
            'void under payroll.manage' => ['payroll.manage', 'payrollPlan', 'void'],
            'financeTransaction under finance.execute' => ['finance.execute', 'financeTransaction', 'execute'],
        ] as $label => [$action, $entity, $op]) {
            $expectRefused(static fn () => $row($action, $entity, $op), $label);
        }
        $row('finance.execute', 'financePosting', 'execute');
        $row('payroll.manage', 'payrollPlan', 'post');
        $row('employee.update', 'employee', null);
        assertSame(5, (int) $db->select('SELECT COUNT(*) AS n FROM audit_events WHERE company_id = ?', [$c['id']])[0]['n'], 'the earlier vocabulary still holds');
    },
    '0036–0038 migrate a schema-0035 database forward: payroll, postings, executions and audit rows survive byte-identical; nothing is seeded' => static function (): void {
        $db = testDatabase();
        $files = [];
        foreach (glob(productionMigrationsDir() . '/*.sql') ?: [] as $path) {
            if ((int) substr(basename($path), 0, 4) <= 35) {
                $files[basename($path)] = (string) file_get_contents($path);
            }
        }
        (new Migrator($db, migrationFixture($files)))->apply();
        $c = bin2hex(random_bytes(16));
        $u = bin2hex(random_bytes(16));
        $m = bin2hex(random_bytes(16));
        $e = 'e_up_' . substr($c, 0, 6);
        $plan = bin2hex(random_bytes(16));
        $posting = bin2hex(random_bytes(16));
        $db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$c]);
        $db->execute("INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (?, 'upgrade-0035@example.test', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$u]);
        $db->execute("INSERT INTO memberships (id, user_id, company_id, role, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, 'ceo', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$m, $u, $c]);
        $db->execute("INSERT INTO employees (id, company_id, employee_code, full_name, monthly_base_salary, created_at, updated_at) VALUES (?, ?, ?, 'Fixture', '3500000.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$e, $c, 'UP' . substr($c, 0, 6)]);
        $db->execute("INSERT INTO payroll_plans (id, company_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, '2026-10', 'Committed', 'CODE', 'Fixture', NULL, '3500000.00', '0.00', '0.00', 0, '3500000.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), ?, 2, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$plan, $c, $e, bin2hex(random_bytes(16))]);
        $db->execute("INSERT INTO finance_postings (id, company_id, source_kind, payroll_plan_id, supplemental_payroll_id, employee_id, month_key, amount, status, idempotency_key, posted_at) VALUES (?, ?, 'payrollPlan', ?, NULL, ?, '2026-10', '3500000.00', 'Planned', ?, UTC_TIMESTAMP(6))", [$posting, $c, $plan, $e, bin2hex(random_bytes(16))]);
        $db->execute("INSERT INTO finance_executions (id, company_id, finance_posting_id, employee_id, month_key, amount, executed_on, payment_method, idempotency_key, recorded_at) VALUES (?, ?, ?, ?, '2026-10', '3500000.00', '2026-10-25', 'bankTransfer', ?, UTC_TIMESTAMP(6))", [bin2hex(random_bytes(16)), $c, $posting, $e, bin2hex(random_bytes(16))]);
        $db->execute("INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, 'finance.execute', 'financePosting', ?, 'execute', NULL, ?, NULL)", [$c, $u, $m, $posting, str_repeat('a', 32)]);
        $snapshot = static fn (): array => [$db->select('SELECT * FROM payroll_plans ORDER BY id'), $db->select('SELECT * FROM finance_postings ORDER BY id'), $db->select('SELECT * FROM finance_executions ORDER BY id'),
            $db->select('SELECT * FROM employees ORDER BY id'), $db->select('SELECT * FROM audit_events ORDER BY id')];
        $before = $snapshot();
        $applied = (new Migrator($db, productionMigrationsDir()))->apply();
        assertSame(['0036_create_finance_transactions', '0037_create_finance_transaction_voids', '0038_replace_audit_events_finance_manage'], array_map(static fn ($x): string => $x->label(), $applied), 'only the Phase 1 migrations run');
        assertSame([], (new Migrator($db, productionMigrationsDir()))->status(), 'head 0038, current');
        assertSame($before, $snapshot(), 'every payroll, posting, execution, employee and audit row is unchanged');
        assertSame([0, 0], [(int) $db->select('SELECT COUNT(*) AS n FROM finance_transactions')[0]['n'], (int) $db->select('SELECT COUNT(*) AS n FROM finance_transaction_voids')[0]['n']], 'nothing is seeded');
        $db->execute("INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, 'finance.manage', 'financeTransaction', ?, 'create', NULL, ?, NULL)", [$c, $u, $m, str_repeat('b', 32), str_repeat('a', 32)]);
        assertTrue(true, 'the upgraded audit vocabulary admits a transaction row');
    },
];
