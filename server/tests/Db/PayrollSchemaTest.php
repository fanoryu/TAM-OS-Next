<?php
declare(strict_types=1);

/*
 * BF-4c1 payroll schema against the real MariaDB (migrations 0024–0026): the CHECKs of
 * payroll_plans (status vocabulary, committed_at ⇔ Committed, base salary > 0, whole-Rupiah
 * overtime and total, consistent overtime count / hours), the generated live key (at most one
 * non-Cancelled plan per company, month and employee — Cancelled plans never block), the link
 * table's primary key (one overtime record consumed at most once, ever), the composite tenant FKs
 * without cascade, the audit vocabulary of 0026, and the forward migration of a schema-0023
 * database whose Employee, Overtime and audit rows survive unchanged with no seed row.
 *
 * BF-4c2 (migrations 0027–0028): the commit idempotency key — present if and only if Committed, 32
 * lowercase hex characters, unique within a company (another company may hold the same key) — the
 * commit audit operation, and the forward migration of a schema-0026 database whose existing plans
 * (Draft, Ready, Cancelled) survive unchanged with no key.
 */

use TamOs\Data\Database;
use TamOs\Data\Migration\Migrator;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\migrationFixture;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\testDatabase;

$refused = static function (Database $db, string $sql, array $params, string $label): void {
    try {
        $db->execute($sql, $params);
    } catch (\Throwable) {
        return;
    }
    throw new \TamOs\Tests\AssertionFailed('expected the database to refuse: ' . $label);
};
/** A company with a CEO membership and employees e_1, e_2 — test-only SQL, fabricated values. */
$company = static function (Database $db): array {
    $c = bin2hex(random_bytes(16));
    $db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$c]);
    foreach (['e_1', 'e_2'] as $e) {
        $db->execute("INSERT INTO employees (id, company_id, employee_code, full_name, monthly_base_salary, created_at, updated_at) VALUES (?, ?, ?, ?, '3500000.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$e . '_' . substr($c, 0, 6), $c, $e . substr($c, 0, 6), 'Fixture ' . $e]);
    }
    return ['id' => $c, 'e1' => 'e_1_' . substr($c, 0, 6), 'e2' => 'e_2_' . substr($c, 0, 6)];
};
$plan = static function (Database $db, array $c, string $employee, array $over = []): string {
    $id = $over['id'] ?? bin2hex(random_bytes(16));
    $v = $over + ['month' => '2026-10', 'status' => 'Draft', 'base' => '3500000.00', 'ot' => '0.00', 'hours' => '0.00', 'count' => 0, 'total' => '3500000.00', 'committed' => null];
    // BF-4c2: a test-only Committed row carries a commit key unless 'key' says otherwise (0027).
    $key = array_key_exists('key', $v) ? $v['key'] : ($v['committed'] === null ? null : bin2hex(random_bytes(16)));
    $db->execute('INSERT INTO payroll_plans (id, company_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at)'
        . " VALUES (?, ?, ?, ?, ?, 'CODE', 'Fixture', NULL, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), " . ($v['committed'] === null ? 'NULL' : 'UTC_TIMESTAMP(6)') . ', ?, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))',
        [$id, $c['id'], $employee, $v['month'], $v['status'], $v['base'], $v['ot'], $v['hours'], $v['count'], $v['total'], $key]);
    return $id;
};
$approved = static function (Database $db, array $c, string $employee): string {
    $id = bin2hex(random_bytes(16));
    $db->execute("INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at, valuation_method, valuation_salary, valuation_standard_hours, approved_amount, approved_at) VALUES (?, ?, ?, '2026-10', NULL, '1.00', NULL, NULL, 'Approved', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'TAM-OT-1', '3500000.00', '160.00', '21875.00', UTC_TIMESTAMP(6))", [$id, $c['id'], $employee]);
    return $id;
};
$link = 'INSERT INTO payroll_plan_overtime (id, company_id, payroll_plan_id, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6))';

return [
    'payroll_plans CHECKs: status vocabulary, committed_at ⇔ Committed, base > 0, whole-Rupiah amounts, consistent overtime, version ≥ 1' => static function () use ($refused, $company, $plan): void {
        $db = authDatabase();
        $c = $company($db);
        $ok = $plan($db, $c, $c['e1']);
        assertSame('1', (string) $db->select('SELECT live_key FROM payroll_plans WHERE id = ?', [$ok])[0]['live_key'], 'a live plan has live key 1');
        $insert = static fn (array $over) => static fn () => $plan($db, $c, $c['e2'], $over);
        foreach ([
            'an unknown status' => ['status' => 'Paid'],
            'Committed without committed_at' => ['status' => 'Committed'],
            'committed_at on a Draft' => ['committed' => true],
            'a zero base salary' => ['base' => '0.00', 'total' => '0.00'],
            'a fractional overtime amount' => ['ot' => '1.50', 'hours' => '1.00', 'count' => 1, 'total' => '3500002.00'],
            'a fractional total' => ['total' => '3500000.50'],
            'a total below the overtime' => ['ot' => '10.00', 'hours' => '1.00', 'count' => 1, 'total' => '5.00'],
            'hours without a record' => ['hours' => '1.00'],
            'a record without hours' => ['count' => 1],
            'money without a record' => ['ot' => '10.00', 'total' => '3500010.00'],
            'non-quarter hours' => ['hours' => '1.10', 'count' => 1],
            'a bad month' => ['month' => '2026-13'],
            'a bad id' => ['id' => 'not-hex'],
        ] as $label => $over) {
            try {
                $insert($over)();
            } catch (\Throwable) {
                continue;
            }
            throw new \TamOs\Tests\AssertionFailed('expected the database to refuse: ' . $label);
        }
        $refused($db, "UPDATE payroll_plans SET version = 0 WHERE id = ?", [$ok], 'version 0');
        $refused($db, "UPDATE payroll_plans SET status = 'Committed' WHERE id = ?", [$ok], 'a status move to Committed without committed_at (BF-4c1 cannot commit)');
    },
    'payroll_plans columns: ascii_bin identifiers and status, utf8mb4 snapshot text, exact DECIMAL money, DATETIME(6) times' => static function (): void {
        $db = authDatabase();
        $cols = [];
        foreach ($db->select("SELECT COLUMN_NAME AS c, COLUMN_TYPE AS t, CHARACTER_SET_NAME AS cs, IS_NULLABLE AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_plans' ORDER BY ORDINAL_POSITION") as $r) {
            $cols[(string) $r['c']] = [(string) $r['t'], $r['cs'] === null ? null : (string) $r['cs'], (string) $r['n']];
        }
        assertSame([
            'id' => ['char(32)', 'ascii', 'NO'], 'company_id' => ['char(32)', 'ascii', 'NO'], 'employee_id' => ['varchar(64)', 'ascii', 'NO'],
            'month_key' => ['char(7)', 'ascii', 'NO'], 'status' => ['varchar(16)', 'ascii', 'NO'],
            'employee_code_snapshot' => ['varchar(32)', 'utf8mb4', 'NO'], 'employee_name_snapshot' => ['varchar(160)', 'utf8mb4', 'NO'], 'department_snapshot' => ['varchar(120)', 'utf8mb4', 'YES'],
            'base_salary' => ['decimal(15,2)', null, 'NO'], 'overtime_amount' => ['decimal(17,2)', null, 'NO'], 'overtime_hours' => ['decimal(9,2)', null, 'NO'],
            'overtime_count' => ['int(10) unsigned', null, 'NO'], 'total_amount' => ['decimal(17,2)', null, 'NO'],
            'calculated_at' => ['datetime(6)', null, 'NO'], 'committed_at' => ['datetime(6)', null, 'YES'], 'commit_idempotency_key' => ['char(32)', 'ascii', 'YES'], 'version' => ['int(10) unsigned', null, 'NO'],
            'created_at' => ['datetime(6)', null, 'NO'], 'updated_at' => ['datetime(6)', null, 'NO'], 'live_key' => ['tinyint(3) unsigned', null, 'YES'],
        ], $cols, 'no float, no statutory, finance or valuation column');
    },
    'the generated live key: one non-Cancelled plan per company, month and employee; Cancelled plans never block a replacement (M17)' => static function () use ($refused, $company, $plan): void {
        $db = authDatabase();
        $c = $company($db);
        $first = $plan($db, $c, $c['e1']);
        foreach (['Draft', 'Reviewed', 'Ready'] as $status) {
            try {
                $plan($db, $c, $c['e1'], ['status' => $status]);
                throw new \TamOs\Tests\AssertionFailed('a second live ' . $status . ' plan was accepted');
            } catch (\TamOs\Tests\AssertionFailed $e) {
                throw $e;
            } catch (\Throwable) {
            }
        }
        $plan($db, $c, $c['e1'], ['month' => '2026-11']);
        $plan($db, $c, $c['e2']);
        $db->execute("UPDATE payroll_plans SET status = 'Cancelled' WHERE id = ?", [$first]);
        assertSame(null, $db->select('SELECT live_key FROM payroll_plans WHERE id = ?', [$first])[0]['live_key'], 'Cancelled has no live key');
        $second = $plan($db, $c, $c['e1']);
        $plan($db, $c, $c['e1'], ['status' => 'Cancelled']);
        $db->execute("UPDATE payroll_plans SET status = 'Cancelled' WHERE id = ?", [$second]);
        $plan($db, $c, $c['e1'], ['status' => 'Committed', 'committed' => true]);
        $refused($db, "UPDATE payroll_plans SET status = 'Draft' WHERE id = ?", [$second], 'a Cancelled plan cannot come back beside a Committed one');
        assertSame(4, (int) $db->select("SELECT COUNT(*) AS n FROM payroll_plans WHERE employee_id = ? AND month_key = '2026-10'", [$c['e1']])[0]['n'], 'three Cancelled and one Committed');
        $keys = $db->select("SELECT COLUMN_NAME AS c, GENERATION_EXPRESSION AS g, EXTRA AS x FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_plans' AND COLUMN_NAME = 'live_key'")[0];
        assertTrue(str_contains((string) $keys['x'], 'STORED') || str_contains((string) $keys['x'], 'PERSISTENT'), 'a stored generated column');
        $idx = array_map(static fn (array $r): string => (string) $r['c'], $db->select("SELECT COLUMN_NAME AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_plans' AND INDEX_NAME = 'payroll_plans_live' ORDER BY SEQ_IN_INDEX"));
        assertSame(['company_id', 'month_key', 'employee_id', 'live_key'], $idx, 'the unique live key');
    },
    'the link primary key: one overtime record is consumed at most once, by any plan (M6); links stay inside their company' => static function () use ($refused, $company, $plan, $approved, $link): void {
        $db = authDatabase();
        $c = $company($db);
        $o = $approved($db, $c, $c['e1']);
        $p1 = $plan($db, $c, $c['e1']);
        $p2 = $plan($db, $c, $c['e1'], ['month' => '2026-11']);
        $db->execute($link, [$o, $c['id'], $p1]);
        $refused($db, $link, [$o, $c['id'], $p1], 'the same record twice in one plan');
        $refused($db, $link, [$o, $c['id'], $p2], 'the same record in another plan');
        $d = $company($db);
        $pd = $plan($db, $d, $d['e1']);
        $refused($db, $link, [$approved($db, $c, $c['e1']), $d['id'], $pd], 'a record of company C linked in company D');
        $refused($db, $link, [str_repeat('f', 32), $c['id'], $p1], 'a record that does not exist');
        $refused($db, 'DELETE FROM overtime_records WHERE id = ?', [$o], 'a consumed overtime record cannot be deleted');
        $refused($db, 'DELETE FROM payroll_plans WHERE id = ?', [$p1], 'a plan with links cannot be deleted');
        $refused($db, 'DELETE FROM employees WHERE id = ?', [$c['e1']], 'an employee with a plan cannot be deleted');
        $fks = $db->select("SELECT CONSTRAINT_NAME AS n, UPDATE_RULE AS u, DELETE_RULE AS d FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('payroll_plans', 'payroll_plan_overtime') ORDER BY CONSTRAINT_NAME");
        $names = array_map(static fn (array $r): string => (string) $r['n'], $fks);
        sort($names, SORT_STRING);
        assertSame(['payroll_plan_overtime_company_fk', 'payroll_plan_overtime_plan_fk', 'payroll_plan_overtime_record_fk', 'payroll_plans_company_fk', 'payroll_plans_employee_fk'], $names);
        foreach ($fks as $fk) {
            assertSame(['RESTRICT', 'RESTRICT'], [(string) $fk['u'], (string) $fk['d']], (string) $fk['n'] . ' does not cascade');
        }
    },
    // BF-4c2 authorized revision: 0028 admits commit. Was: commit refused (BF-4c1).
    '0026 + 0028: the audit vocabulary admits create, recalculate, review, approve, return, cancel and commit under payroll.manage on payrollPlan only' => static function () use ($refused, $company): void {
        $db = authDatabase();
        $c = $company($db);
        $user = bin2hex(random_bytes(16));
        $m = bin2hex(random_bytes(16));
        $db->execute("INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (?, 'audit-0026@example.test', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$user]);
        $db->execute("INSERT INTO memberships (id, user_id, company_id, role, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, 'ceo', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$m, $user, $c['id']]);
        $ins = "INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, ?, ?, 'p1', ?, NULL, ?, NULL)";
        $rid = str_repeat('a', 32);
        foreach (['create', 'recalculate', 'review', 'approve', 'return', 'cancel', 'commit'] as $op) {
            $db->execute($ins, [$c['id'], $user, $m, 'payroll.manage', 'payrollPlan', $op, $rid]);
        }
        foreach (['pay', 'post', 'execute', 'submit'] as $op) {
            $refused($db, $ins, [$c['id'], $user, $m, 'payroll.manage', 'payrollPlan', $op, $rid], 'no ' . $op . ' operation under payroll.manage');
        }
        $refused($db, $ins, [$c['id'], $user, $m, 'overtime.manage', 'overtime', 'commit', $rid], 'commit is only a payroll operation');
        $refused($db, $ins, [$c['id'], $user, $m, 'payroll.manage', 'payrollPlan', 'Commit', $rid], 'exact spelling');
        $refused($db, $ins, [$c['id'], $user, $m, 'payroll.manage', 'payrollPlan', null, $rid], 'an operation is required');
        $refused($db, $ins, [$c['id'], $user, $m, 'payroll.manage', 'employee', 'create', $rid], 'payroll.manage is a payrollPlan row');
        $refused($db, $ins, [$c['id'], $user, $m, 'employee.update', 'payrollPlan', null, $rid], 'payrollPlan is only payroll.manage');
        $refused($db, $ins, [$c['id'], $user, $m, 'overtime.manage', 'overtime', 'cancel', $rid], 'cancel is not an overtime operation');
        $refused($db, $ins, [$c['id'], $user, $m, 'finance.execute', 'payrollPlan', null, $rid], 'no finance action');
        $db->execute($ins, [$c['id'], $user, $m, 'overtime.manage', 'overtime', 'approve', $rid]);
        $db->execute("INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, 'employee.update', 'employee', 'e1', NULL, NULL, ?, 'fullName')", [$c['id'], $user, $m, $rid]);
    },
    '0024–0028 migrate a schema-0023 database forward: Employee, Overtime and audit rows survive unchanged; no payroll row is seeded' => static function (): void {
        $db = testDatabase();
        $files = [];
        foreach (glob(productionMigrationsDir() . '/*.sql') ?: [] as $path) {
            if ((int) substr(basename($path), 0, 4) <= 23) {
                $files[basename($path)] = (string) file_get_contents($path);
            }
        }
        (new Migrator($db, migrationFixture($files)))->apply();
        $company = bin2hex(random_bytes(16));
        $db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$company]);
        $user = bin2hex(random_bytes(16));
        $membership = bin2hex(random_bytes(16));
        $db->execute("INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (?, 'pre-0024@example.test', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$user]);
        $db->execute("INSERT INTO memberships (id, user_id, company_id, role, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, 'ceo', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$membership, $user, $company]);
        $db->execute("INSERT INTO employees (id, company_id, employee_code, full_name, monthly_base_salary, created_at, updated_at) VALUES ('e_1', ?, 'E1', 'Fixture e_1', '3500000.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$company]);
        $db->execute("INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at) VALUES (?, ?, 'e_1', '2026-10', NULL, '2.00', NULL, NULL, 'Reviewed', 3, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [str_repeat('1', 32), $company]);
        $db->execute("INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at, valuation_method, valuation_salary, valuation_standard_hours, approved_amount, approved_at) VALUES (?, ?, 'e_1', '2026-10', NULL, '1.00', NULL, NULL, 'Approved', 4, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'TAM-OT-1', '3500000.00', '160.00', '21875.00', UTC_TIMESTAMP(6))", [str_repeat('2', 32), $company]);
        foreach ([['employee.update', 'employee', null], ['overtime.manage', 'overtime', 'approve'], ['account.manage', 'employee', 'provision']] as [$action, $entity, $op]) {
            $db->execute("INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, ?, ?, 'x1', ?, ?, ?, NULL)",
                [$company, $user, $membership, $action, $entity, $op, $action === 'account.manage' ? $user : null, str_repeat('a', 32)]);
        }
        $snapshot = static fn (): array => [$db->select('SELECT * FROM employees ORDER BY id'), $db->select('SELECT * FROM overtime_records ORDER BY id'), $db->select('SELECT * FROM audit_events ORDER BY id')];
        $before = $snapshot();
        $applied = (new Migrator($db, productionMigrationsDir()))->apply();
        // BF-4d authorized revision: 0029–0031 follow (head 0031). Was: through 0028.
        assertSame(['0024_create_payroll_plans', '0025_create_payroll_plan_overtime', '0026_replace_audit_events_payroll_checks', '0027_add_payroll_plans_commit_key', '0028_replace_audit_events_payroll_commit', '0029_create_supplemental_payrolls', '0030_create_supplemental_payroll_overtime', '0031_replace_audit_events_supplemental_checks'], array_map(static fn ($m): string => $m->label(), $applied), 'only the BF-4c1, BF-4c2 and BF-4d migrations run');
        assertSame([], (new Migrator($db, productionMigrationsDir()))->status(), 'head 0031, current');
        assertSame($before, $snapshot(), 'every Employee, Overtime and audit row is unchanged');
        assertSame([0, 0], [(int) $db->select('SELECT COUNT(*) AS n FROM payroll_plans')[0]['n'], (int) $db->select('SELECT COUNT(*) AS n FROM payroll_plan_overtime')[0]['n']], 'no payroll row is seeded');
    },
    '0027: the commit key exists if and only if Committed, is 32 lowercase hex characters and is unique within a company only' => static function () use ($refused, $company, $plan): void {
        $db = authDatabase();
        $c = $company($db);
        $key = bin2hex(random_bytes(16));
        $committed = $plan($db, $c, $c['e1'], ['status' => 'Committed', 'committed' => true, 'key' => $key]);
        foreach ([
            'Committed without a key' => ['status' => 'Committed', 'committed' => true, 'key' => null],
            'a key on a Ready plan' => ['status' => 'Ready', 'key' => bin2hex(random_bytes(16))],
            'a key on a Cancelled plan' => ['status' => 'Cancelled', 'key' => bin2hex(random_bytes(16))],
            'an uppercase key' => ['status' => 'Committed', 'committed' => true, 'key' => strtoupper(bin2hex(random_bytes(16)))],
            'a short key' => ['status' => 'Committed', 'committed' => true, 'key' => substr(bin2hex(random_bytes(16)), 1)],
            'the same key twice in one company' => ['status' => 'Committed', 'committed' => true, 'key' => $key],
        ] as $label => $over) {
            try {
                $plan($db, $c, $c['e2'], $over + ['month' => '2026-11']);
            } catch (\Throwable) {
                continue;
            }
            throw new \TamOs\Tests\AssertionFailed('expected the database to refuse: ' . $label);
        }
        $d = $company($db);
        $plan($db, $d, $d['e1'], ['status' => 'Committed', 'committed' => true, 'key' => $key]);
        assertSame(2, (int) $db->select('SELECT COUNT(*) AS n FROM payroll_plans WHERE commit_idempotency_key = ?', [$key])[0]['n'], 'another company may hold the same key');
        $refused($db, 'UPDATE payroll_plans SET commit_idempotency_key = NULL WHERE id = ?', [$committed], 'a Committed plan cannot lose its key');
        $refused($db, "UPDATE payroll_plans SET status = 'Committed', committed_at = UTC_TIMESTAMP(6) WHERE id = ?", [$plan($db, $c, $c['e2'])], 'a commit without a key');
        $idx = array_map(static fn (array $r): string => (string) $r['c'], $db->select("SELECT COLUMN_NAME AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_plans' AND INDEX_NAME = 'payroll_plans_commit_key' AND NON_UNIQUE = 0 ORDER BY SEQ_IN_INDEX"));
        assertSame(['company_id', 'commit_idempotency_key'], $idx, 'the company-scoped unique key');
    },
    '0027–0028 migrate a schema-0026 database forward: existing Draft, Ready and Cancelled plans, links and audit rows survive unchanged, with no key; nothing is seeded' => static function () use ($company, $plan, $approved, $link): void {
        $db = testDatabase();
        $files = [];
        foreach (glob(productionMigrationsDir() . '/*.sql') ?: [] as $path) {
            if ((int) substr(basename($path), 0, 4) <= 26) {
                $files[basename($path)] = (string) file_get_contents($path);
            }
        }
        (new Migrator($db, migrationFixture($files)))->apply();
        $c = $company($db);
        $insert = static fn (string $employee, string $status, string $month): string => (static function () use ($db, $c, $employee, $status, $month): string {
            $id = bin2hex(random_bytes(16));
            $db->execute("INSERT INTO payroll_plans (id, company_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, calculated_at, committed_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'CODE', 'Fixture', NULL, '3500000.00', '0.00', '0.00', 0, '3500000.00', UTC_TIMESTAMP(6), NULL, 3, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$id, $c['id'], $employee, $month, $status]);
            return $id;
        })();
        $draft = $insert($c['e1'], 'Draft', '2026-10');
        $insert($c['e2'], 'Ready', '2026-10');
        $insert($c['e1'], 'Cancelled', '2026-09');
        $db->execute($link, [$approved($db, $c, $c['e1']), $c['id'], $draft]);
        $snapshot = static fn (): array => [$db->select('SELECT * FROM payroll_plans ORDER BY id'), $db->select('SELECT * FROM payroll_plan_overtime ORDER BY id'), $db->select('SELECT * FROM audit_events ORDER BY id')];
        $before = $snapshot();
        $applied = (new Migrator($db, productionMigrationsDir()))->apply();
        // BF-4d authorized revision: 0029–0031 follow (head 0031). Was: through 0028.
        assertSame(['0027_add_payroll_plans_commit_key', '0028_replace_audit_events_payroll_commit', '0029_create_supplemental_payrolls', '0030_create_supplemental_payroll_overtime', '0031_replace_audit_events_supplemental_checks'], array_map(static fn ($m): string => $m->label(), $applied), 'only the BF-4c2 and BF-4d migrations run');
        assertSame([], (new Migrator($db, productionMigrationsDir()))->status(), 'head 0031, current');
        [$plans, $links, $audit] = $snapshot();
        $sorted = static function (array $r): array {
            ksort($r);
            return $r;
        };
        assertSame(array_map(static fn (array $r): array => $sorted($r + ['commit_idempotency_key' => null]), $before[0]), array_map($sorted, $plans), 'every plan is unchanged, with no key');
        assertSame([$before[1], $before[2]], [$links, $audit], 'links and audit rows are unchanged');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM payroll_plans WHERE commit_idempotency_key IS NOT NULL')[0]['n'], 'no key is seeded');
        $plan($db, $c, $c['e2'], ['month' => '2026-12', 'status' => 'Committed', 'committed' => true]);
    },
];
