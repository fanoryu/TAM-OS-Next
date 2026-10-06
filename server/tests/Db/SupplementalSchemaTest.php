<?php
declare(strict_types=1);

/*
 * BF-4d Supplemental Payroll schema against the real MariaDB (migrations 0029–0031): the CHECKs of
 * supplemental_payrolls (status vocabulary, committed_at ⇔ Committed, the commit key ⇔ Committed
 * and its format, a positive whole-Rupiah amount, positive quarter hours, a positive count,
 * version ≥ 1, a non-empty snapshot), the generated open key (at most one Draft, Reviewed or Ready
 * document per base plan — Committed and Cancelled never block), the company-scoped commit key,
 * the link table's primary key (one overtime record captured at most once, ever), the composite
 * tenant FKs without cascade, the 0031 audit vocabulary, and the forward migration of a
 * schema-0028 database whose payroll, overtime and audit rows survive unchanged with no seed row.
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
/** A company with employees e_1, e_2 and a Committed base plan of e_1 for 2026-10 — test-only SQL, fabricated values. */
$company = static function (Database $db): array {
    $c = bin2hex(random_bytes(16));
    $db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$c]);
    foreach (['e_1', 'e_2'] as $e) {
        $db->execute("INSERT INTO employees (id, company_id, employee_code, full_name, monthly_base_salary, created_at, updated_at) VALUES (?, ?, ?, ?, '3500000.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$e . '_' . substr($c, 0, 6), $c, $e . substr($c, 0, 6), 'Fixture ' . $e]);
    }
    $e1 = 'e_1_' . substr($c, 0, 6);
    $plan = bin2hex(random_bytes(16));
    $db->execute("INSERT INTO payroll_plans (id, company_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, '2026-10', 'Committed', 'CODE', 'Fixture', NULL, '3500000.00', '0.00', '0.00', 0, '3500000.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), ?, 2, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
        [$plan, $c, $e1, bin2hex(random_bytes(16))]);
    return ['id' => $c, 'e1' => $e1, 'e2' => 'e_2_' . substr($c, 0, 6), 'plan' => $plan];
};
$doc = static function (Database $db, array $c, array $over = []): string {
    $id = $over['id'] ?? bin2hex(random_bytes(16));
    $v = $over + ['plan' => $c['plan'], 'employee' => $c['e1'], 'status' => 'Draft', 'amount' => '21875.00', 'hours' => '1.00', 'count' => 1, 'committed' => null, 'code' => 'CODE', 'version' => 1];
    $key = array_key_exists('key', $v) ? $v['key'] : ($v['committed'] === null ? null : bin2hex(random_bytes(16)));
    $db->execute('INSERT INTO supplemental_payrolls (id, company_id, payroll_plan_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, overtime_amount, overtime_hours, overtime_count, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at)'
        . " VALUES (?, ?, ?, ?, '2026-10', ?, ?, 'Fixture', NULL, ?, ?, ?, UTC_TIMESTAMP(6), " . ($v['committed'] === null ? 'NULL' : 'UTC_TIMESTAMP(6)') . ', ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))',
        [$id, $c['id'], $v['plan'], $v['employee'], $v['status'], $v['code'], $v['amount'], $v['hours'], $v['count'], $key, $v['version']]);
    return $id;
};
$approved = static function (Database $db, array $c, string $employee): string {
    $id = bin2hex(random_bytes(16));
    $db->execute("INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at, valuation_method, valuation_salary, valuation_standard_hours, approved_amount, approved_at) VALUES (?, ?, ?, '2026-10', NULL, '1.00', NULL, NULL, 'Approved', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'TAM-OT-1', '3500000.00', '160.00', '21875.00', UTC_TIMESTAMP(6))", [$id, $c['id'], $employee]);
    return $id;
};
$link = 'INSERT INTO supplemental_payroll_overtime (id, company_id, supplemental_payroll_id, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6))';

return [
    'supplemental_payrolls columns: identifiers ascii_bin, the base plan snapshot as text, exact DECIMAL money and hours, DATETIME(6), InnoDB utf8mb4 — no statutory, finance or valuation column' => static function (): void {
        $db = authDatabase();
        $cols = [];
        foreach ($db->select("SELECT COLUMN_NAME AS c, COLUMN_TYPE AS t, IS_NULLABLE AS n, COLLATION_NAME AS k FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplemental_payrolls' ORDER BY ORDINAL_POSITION") as $r) {
            $cols[(string) $r['c']] = $r['t'] . ' ' . $r['n'] . ' ' . ($r['k'] ?? '-');
        }
        assertSame([
            'id' => 'char(32) NO ascii_bin', 'company_id' => 'char(32) NO ascii_bin', 'payroll_plan_id' => 'char(32) NO ascii_bin',
            'employee_id' => 'varchar(64) NO ascii_bin', 'month_key' => 'char(7) NO ascii_bin', 'status' => 'varchar(16) NO ascii_bin',
            'employee_code_snapshot' => 'varchar(32) NO utf8mb4_unicode_ci', 'employee_name_snapshot' => 'varchar(160) NO utf8mb4_unicode_ci',
            'department_snapshot' => 'varchar(120) YES utf8mb4_unicode_ci',
            'overtime_amount' => 'decimal(17,2) NO -', 'overtime_hours' => 'decimal(9,2) NO -', 'overtime_count' => 'int(10) unsigned NO -',
            'calculated_at' => 'datetime(6) NO -', 'committed_at' => 'datetime(6) YES -', 'commit_idempotency_key' => 'char(32) YES ascii_bin',
            'version' => 'int(10) unsigned NO -', 'created_at' => 'datetime(6) NO -', 'updated_at' => 'datetime(6) NO -', 'open_key' => 'tinyint(3) unsigned YES -',
        ], $cols);
        $info = $db->select("SELECT ENGINE AS e, TABLE_COLLATION AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplemental_payrolls'")[0];
        assertSame(['InnoDB', 'utf8mb4_unicode_ci'], [(string) $info['e'], (string) $info['c']]);
    },
    'supplemental_payrolls CHECKs: status vocabulary, committed_at and the key ⇔ Committed, a positive whole-Rupiah amount, positive quarter hours and count, version ≥ 1, a snapshot (M10, M11, M33)' => static function () use ($company, $doc): void {
        $db = authDatabase();
        $c = $company($db);
        $ok = $doc($db, $c);
        assertSame('1', (string) $db->select('SELECT open_key FROM supplemental_payrolls WHERE id = ?', [$ok])[0]['open_key'], 'an open document holds the open key');
        $db->execute("UPDATE supplemental_payrolls SET status = 'Cancelled' WHERE id = ?", [$ok]);
        foreach ([
            'an unknown status' => ['status' => 'Paid'],
            'an Executed status' => ['status' => 'Executed'],
            'Committed without committed_at' => ['status' => 'Committed', 'key' => bin2hex(random_bytes(16))],
            'Committed without a key' => ['status' => 'Committed', 'committed' => true, 'key' => null],
            'committed_at on a Ready document' => ['status' => 'Ready', 'committed' => true, 'key' => null],
            'a key on a Ready document' => ['status' => 'Ready', 'key' => bin2hex(random_bytes(16))],
            'an uppercase key' => ['status' => 'Committed', 'committed' => true, 'key' => strtoupper(bin2hex(random_bytes(16)))],
            'a zero amount' => ['amount' => '0.00'],
            'a negative amount' => ['amount' => '-1.00'],
            'a fractional amount' => ['amount' => '1.50'],
            'zero hours' => ['hours' => '0.00'],
            'non-quarter hours' => ['hours' => '1.10'],
            'a zero count' => ['count' => 0],
            'a zero version' => ['version' => 0],
            'an empty snapshot' => ['code' => ''],
            'a malformed id' => ['id' => 'emp_1'],
        ] as $label => $over) {
            try {
                $doc($db, $c, $over);
            } catch (\Throwable) {
                continue;
            }
            throw new \TamOs\Tests\AssertionFailed('expected the database to refuse: ' . $label);
        }
        foreach (['Draft', 'Reviewed', 'Ready'] as $s) {
            $id = $doc($db, $c, ['status' => $s]);
            $db->execute("UPDATE supplemental_payrolls SET status = 'Cancelled' WHERE id = ?", [$id]);
        }
        $doc($db, $c, ['status' => 'Committed', 'committed' => true]);
        assertSame(5, (int) $db->select('SELECT COUNT(*) AS n FROM supplemental_payrolls WHERE company_id = ?', [$c['id']])[0]['n'], 'every valid status is storable');
    },
    'the open key: at most one Draft, Reviewed or Ready document per base plan; Committed and Cancelled never block (M12, M40)' => static function () use ($refused, $company, $doc): void {
        $db = authDatabase();
        $c = $company($db);
        foreach (['Draft', 'Reviewed', 'Ready'] as $s) {
            $open = $doc($db, $c, ['status' => $s]);
            foreach (['Draft', 'Reviewed', 'Ready'] as $t) {
                try {
                    $doc($db, $c, ['status' => $t]);
                } catch (\Throwable) {
                    continue;
                }
                throw new \TamOs\Tests\AssertionFailed('a second open document beside a ' . $s . ' one: ' . $t);
            }
            $doc($db, $c, ['status' => 'Committed', 'committed' => true]);
            $doc($db, $c, ['status' => 'Cancelled']);
            $db->execute("UPDATE supplemental_payrolls SET status = 'Cancelled' WHERE id = ?", [$open]);
        }
        $doc($db, $c);
        $second = $doc($db, $c, ['status' => 'Cancelled']);
        $refused($db, "UPDATE supplemental_payrolls SET status = 'Draft' WHERE id = ?", [$second], 'reopening a second document');
        $idx = array_map(static fn (array $r): string => (string) $r['c'], $db->select("SELECT COLUMN_NAME AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplemental_payrolls' AND INDEX_NAME = 'supplemental_payrolls_open' AND NON_UNIQUE = 0 ORDER BY SEQ_IN_INDEX"));
        assertSame(['company_id', 'payroll_plan_id', 'open_key'], $idx, 'the open key is unique per company and base plan');
        assertSame(3, (int) $db->select("SELECT COUNT(*) AS n FROM supplemental_payrolls WHERE company_id = ? AND payroll_plan_id = ? AND status = 'Committed'", [$c['id'], $c['plan']])[0]['n'], 'several Committed documents per base plan');
    },
    'the commit key is unique within a company only' => static function () use ($company, $doc): void {
        $db = authDatabase();
        $c = $company($db);
        $key = bin2hex(random_bytes(16));
        $doc($db, $c, ['status' => 'Committed', 'committed' => true, 'key' => $key]);
        try {
            $doc($db, $c, ['status' => 'Committed', 'committed' => true, 'key' => $key]);
            throw new \TamOs\Tests\AssertionFailed('the same key twice in one company');
        } catch (\TamOs\Data\DatabaseError) {
        }
        $d = $company($db);
        $doc($db, $d, ['status' => 'Committed', 'committed' => true, 'key' => $key]);
        assertSame(2, (int) $db->select('SELECT COUNT(*) AS n FROM supplemental_payrolls WHERE commit_idempotency_key = ?', [$key])[0]['n'], 'another company may hold the same key');
        $idx = array_map(static fn (array $r): string => (string) $r['c'], $db->select("SELECT COLUMN_NAME AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplemental_payrolls' AND INDEX_NAME = 'supplemental_payrolls_commit_key' AND NON_UNIQUE = 0 ORDER BY SEQ_IN_INDEX"));
        assertSame(['company_id', 'commit_idempotency_key'], $idx, 'the company-scoped unique key');
    },
    'tenant keys: the base plan, the employee and the overtime of another company are refused; no FK cascades (company scoping)' => static function () use ($refused, $company, $doc, $approved, $link): void {
        $db = authDatabase();
        $c = $company($db);
        $d = $company($db);
        foreach ([['plan' => $d['plan']], ['employee' => $d['e1']], ['plan' => bin2hex(random_bytes(16))], ['employee' => 'nobody']] as $i => $over) {
            try {
                $doc($db, $c, $over);
            } catch (\Throwable) {
                continue;
            }
            throw new \TamOs\Tests\AssertionFailed('a foreign or absent parent: ' . $i);
        }
        $s = $doc($db, $c);
        $refused($db, $link, [$approved($db, $d, $d['e1']), $c['id'], $s], "another company's overtime");
        $refused($db, $link, [bin2hex(random_bytes(16)), $c['id'], $s], 'an absent overtime record');
        $refused($db, $link, [$approved($db, $c, $c['e1']), $c['id'], bin2hex(random_bytes(16))], 'an absent document');
        $refused($db, 'DELETE FROM payroll_plans WHERE id = ?', [$c['plan']], 'a base plan with a document cannot be removed (RESTRICT)');
        $rules = $db->select("SELECT DELETE_RULE AS d, UPDATE_RULE AS u FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('supplemental_payrolls', 'supplemental_payroll_overtime')");
        assertSame(6, count($rules), 'six foreign keys');
        foreach ($rules as $r) {
            assertTrue(in_array($r['d'], ['RESTRICT', 'NO ACTION'], true) && in_array($r['u'], ['RESTRICT', 'NO ACTION'], true), 'no cascade, no set null');
        }
    },
    'the link primary key: one overtime record is captured at most once, ever (M9, M39)' => static function () use ($refused, $company, $doc, $approved, $link): void {
        $db = authDatabase();
        $c = $company($db);
        $o = $approved($db, $c, $c['e1']);
        $s1 = $doc($db, $c, ['status' => 'Committed', 'committed' => true]);
        $s2 = $doc($db, $c);
        $db->execute($link, [$o, $c['id'], $s1]);
        $refused($db, $link, [$o, $c['id'], $s2], 'a second capture of one overtime record');
        $refused($db, $link, [$o, $c['id'], $s1], 'the same capture twice');
        assertSame(1, (int) $db->select('SELECT COUNT(*) AS n FROM supplemental_payroll_overtime WHERE id = ?', [$o])[0]['n']);
        $refused($db, 'DELETE FROM overtime_records WHERE id = ?', [$o], 'a captured overtime record cannot be removed (RESTRICT)');
    },
    // BF-4e authorized revision: 0033 admits post under supplemental.manage — the Finance posting of a
    // Committed document is audited on the document (D-FIN-2 = A). Was: post refused.
    '0031 + 0033: the audit vocabulary admits supplemental.manage on supplementalPayroll with the Payroll operations and post, and keeps every existing rule' => static function (): void {
        $db = authDatabase();
        $c = bin2hex(random_bytes(16));
        $db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$c]);
        $user = bin2hex(random_bytes(16));
        $membership = bin2hex(random_bytes(16));
        $db->execute("INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (?, ?, NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$user, 'audit-' . substr($c, 0, 8) . '@example.test']);
        $db->execute("INSERT INTO memberships (id, user_id, company_id, role, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, 'ceo', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$membership, $user, $c]);
        $row = static fn (string $action, string $entity, ?string $op) => $db->execute("INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, ?, ?, 'x1', ?, NULL, ?, NULL)",
            [$c, $user, $membership, $action, $entity, $op, str_repeat('a', 32)]);
        foreach (['create', 'recalculate', 'review', 'approve', 'return', 'cancel', 'commit'] as $op) {
            $row('supplemental.manage', 'supplementalPayroll', $op);
            $row('payroll.manage', 'payrollPlan', $op);
        }
        $row('supplemental.manage', 'supplementalPayroll', 'post');
        foreach ([
            'no operation' => ['supplemental.manage', 'supplementalPayroll', null],
            'a payment operation' => ['supplemental.manage', 'supplementalPayroll', 'pay'],
            'a posting operation on the wrong entity' => ['supplemental.manage', 'payrollPlan', 'post'],
            'an execution operation' => ['supplemental.manage', 'supplementalPayroll', 'execute'],
            'the wrong entity' => ['supplemental.manage', 'payrollPlan', 'create'],
            'the Supplemental entity under payroll.manage' => ['payroll.manage', 'supplementalPayroll', 'create'],
            'an overtime operation' => ['supplemental.manage', 'supplementalPayroll', 'reject'],
            'an unknown Action' => ['finance.manage', 'supplementalPayroll', 'create'],
        ] as $label => [$action, $entity, $op]) {
            try {
                $row($action, $entity, $op);
            } catch (\Throwable) {
                continue;
            }
            throw new \TamOs\Tests\AssertionFailed('expected the database to refuse: ' . $label);
        }
        $row('overtime.manage', 'overtime', 'approve');
        $row('employee.update', 'employee', null);
        assertSame(17, (int) $db->select('SELECT COUNT(*) AS n FROM audit_events WHERE company_id = ?', [$c])[0]['n'], 'the existing vocabulary still holds');
    },
    '0029–0031 migrate a schema-0028 database forward: Committed and open plans, their links, overtime and audit rows survive unchanged; nothing is seeded' => static function () use ($approved): void {
        $db = testDatabase();
        $files = [];
        foreach (glob(productionMigrationsDir() . '/*.sql') ?: [] as $path) {
            if ((int) substr(basename($path), 0, 4) <= 28) {
                $files[basename($path)] = (string) file_get_contents($path);
            }
        }
        (new Migrator($db, migrationFixture($files)))->apply();
        $c = bin2hex(random_bytes(16));
        $db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$c]);
        $db->execute("INSERT INTO employees (id, company_id, employee_code, full_name, monthly_base_salary, created_at, updated_at) VALUES ('e_1', ?, 'E1', 'Fixture e_1', '3500000.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$c]);
        $plan = bin2hex(random_bytes(16));
        $db->execute("INSERT INTO payroll_plans (id, company_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at) VALUES (?, ?, 'e_1', '2026-10', 'Committed', 'E1', 'Fixture e_1', NULL, '3500000.00', '21875.00', '1.00', 1, '3521875.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), ?, 3, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$plan, $c, bin2hex(random_bytes(16))]);
        $db->execute('INSERT INTO payroll_plan_overtime (id, company_id, payroll_plan_id, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6))', [$approved($db, ['id' => $c], 'e_1'), $c, $plan]);
        $approved($db, ['id' => $c], 'e_1');
        $snapshot = static fn (): array => [$db->select('SELECT * FROM payroll_plans ORDER BY id'), $db->select('SELECT * FROM payroll_plan_overtime ORDER BY id'), $db->select('SELECT * FROM overtime_records ORDER BY id'), $db->select('SELECT * FROM audit_events ORDER BY id')];
        $before = $snapshot();
        $applied = (new Migrator($db, productionMigrationsDir()))->apply();
        // BF-4e authorized revision: 0032–0033 follow (head 0033). Was: through 0031.
        // BF-4f authorized revision: 0034–0035 follow (head 0035). Was: through 0033.
        assertSame(['0029_create_supplemental_payrolls', '0030_create_supplemental_payroll_overtime', '0031_replace_audit_events_supplemental_checks', '0032_create_finance_postings', '0033_replace_audit_events_finance_post', '0034_create_finance_executions', '0035_replace_audit_events_finance_execute'], array_map(static fn ($m): string => $m->label(), $applied), 'only the BF-4d, BF-4e and BF-4f migrations run');
        assertSame([], (new Migrator($db, productionMigrationsDir()))->status(), 'head 0035, current');
        assertSame($before, $snapshot(), 'every payroll, link, overtime and audit row is unchanged');
        assertSame([0, 0], [(int) $db->select('SELECT COUNT(*) AS n FROM supplemental_payrolls')[0]['n'], (int) $db->select('SELECT COUNT(*) AS n FROM supplemental_payroll_overtime')[0]['n']], 'no Supplemental row is seeded');
    },
];
