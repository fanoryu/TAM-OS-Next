<?php
declare(strict_types=1);

/*
 * The production schema (server/migrations 0001–0006 BF-3A, 0007–0008 BF-3B, 0009–0010 BF-3C,
 * 0011–0013 BF-3D, 0014–0017 BF-4a1, 0018–0019 BF-4a2, 0020–0021 BF-4b1, 0022–0023 BF-4b2)
 * against the real, guarded CI MariaDB: it applies, seeds nothing, is ready, and its constraints
 * are actually enforced. The employee anchor and binding FK are proven in EmployeeSchemaTest.
 */

use TamOs\Data\Database;
use TamOs\Data\DatabaseError;
use TamOs\Data\Migration\MigrationError;
use TamOs\Data\Migration\Migrator;
use TamOs\Data\Readiness;
use TamOs\Http\Request;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\envelope;
use function TamOs\Tests\kernel;
use function TamOs\Tests\migrationFixture;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\requestId;
use function TamOs\Tests\testDatabase;
use function TamOs\Tests\testDbConfig;

$authTables = ['account_tokens', 'audit_events', 'auth_events', 'auth_rate_limits', 'companies', 'employees', 'mail_outbox', 'memberships', 'overtime_records', 'payroll_plans', 'payroll_plan_overtime', 'sessions', 'users'];
$tables = static fn (Database $db): array => array_map(
    static fn (array $r): string => (string) $r['t'],
    $db->select('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name'),
);
/** Asserts a statement is refused by the database; returns the error for code checks. */
$refused = static fn (Database $db, string $sql, array $params, string $label): DatabaseError => assertThrows(
    DatabaseError::class,
    static fn () => $db->execute($sql, $params),
    $label,
);
$id = static fn (): string => bin2hex(random_bytes(16));
$insertUser = 'INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))';
$insertMembership = 'INSERT INTO memberships (id, user_id, company_id, role, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))';

return [
    // BF-4d authorized revision: 0029–0031 follow and create the Supplemental Payroll document and
    // its overtime links (head 0031). Was: 0001–0028, fourteen tables.
    // BF-4e authorized revision: 0032–0033 follow and create the Finance posting (head 0033). Was:
    // 0001–0031, sixteen tables.
    // BF-4f authorized revision: 0034–0035 follow and create the Finance execution (head 0035). Was:
    // 0001–0033, seventeen tables.
    'production migrations 0001–0035 apply in order, create exactly the auth tables, the employees, the mail outbox, the audit trail, the overtime records, the payroll plans with their overtime links, the Supplemental Payroll documents with theirs, the Finance postings and the Finance executions, and seed nothing' => static function () use ($tables, $authTables): void {
        $db = testDatabase();
        $applied = (new Migrator($db, productionMigrationsDir()))->apply();
        assertSame(['0001_create_companies', '0002_create_users', '0003_create_memberships', '0004_create_sessions', '0005_create_auth_rate_limits', '0006_create_auth_events',
            '0007_create_account_tokens', '0008_replace_auth_events_event_check', '0009_create_employees', '0010_add_memberships_employee_fk',
            '0011_replace_account_tokens_purpose_check', '0012_replace_auth_events_event_check', '0013_create_mail_outbox',
            '0014_extend_employees_profile', '0015_backfill_legacy_employees', '0016_enforce_employees_profile', '0017_create_audit_events',
            '0018_replace_mail_outbox_kind_check', '0019_add_audit_events_account_operation',
            '0020_create_overtime_records', '0021_replace_audit_events_overtime_checks',
            '0022_add_overtime_records_valuation', '0023_replace_audit_events_overtime_approve',
            '0024_create_payroll_plans', '0025_create_payroll_plan_overtime', '0026_replace_audit_events_payroll_checks', '0027_add_payroll_plans_commit_key', '0028_replace_audit_events_payroll_commit',
            '0029_create_supplemental_payrolls', '0030_create_supplemental_payroll_overtime', '0031_replace_audit_events_supplemental_checks', '0032_create_finance_postings', '0033_replace_audit_events_finance_post', '0034_create_finance_executions', '0035_replace_audit_events_finance_execute'],
            array_map(static fn ($m): string => $m->label(), $applied));
        assertSame(['account_tokens', 'audit_events', 'auth_events', 'auth_rate_limits', 'companies', 'employees', 'finance_executions', 'finance_postings', 'mail_outbox', 'memberships', 'overtime_records', 'payroll_plans', 'payroll_plan_overtime', 'schema_migrations', 'sessions', 'supplemental_payrolls', 'supplemental_payroll_overtime', 'users'], $tables($db));
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM finance_postings')[0]['n'], 'no Finance posting');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM finance_executions')[0]['n'], 'no Finance execution');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM supplemental_payrolls')[0]['n'], 'no Supplemental document');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM supplemental_payroll_overtime')[0]['n'], 'no Supplemental link');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM payroll_plans')[0]['n'], 'no payroll plan');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM payroll_plan_overtime')[0]['n'], 'no payroll link');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM overtime_records')[0]['n'], 'no overtime record');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM employees')[0]['n'], 'no employee');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM audit_events')[0]['n'], 'no audit row');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM account_tokens')[0]['n'], 'no token');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM companies')[0]['n'], 'no company');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM users')[0]['n'], 'no user, no default CEO');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM memberships')[0]['n'], 'no membership');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM sessions')[0]['n'], 'no session');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM auth_rate_limits')[0]['n'], 'no rate-limit row');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM auth_events')[0]['n'], 'no event');
    },
    'a second apply is a no-op, the schema is current, and /api/ready is 200' => static function (): void {
        $db = authDatabase();
        $m = new Migrator($db, productionMigrationsDir());
        assertSame([], $m->apply(), 'no-op');
        assertSame([], $m->inspect(), 'current');
        assertSame(null, (new Readiness(testDbConfig(), productionMigrationsDir()))->check());
        $r = kernel(testDbConfig(), null, productionMigrationsDir())->handle(new Request('GET', '/api/ready'), requestId());
        assertSame([200, ['status' => 'ready']], [$r->status, envelope($r)['data']]);
    },
    'a modified production migration is drift; readiness refuses it' => static function (): void {
        authDatabase();
        $files = [];
        foreach (glob(productionMigrationsDir() . '/*.sql') ?: [] as $path) {
            $files[basename($path)] = (string) file_get_contents($path);
        }
        // BF-4d authorized revision: through 0031. Was: 28 files through 0028 (BF-4c2).
        // BF-4e authorized revision: through 0033. Was: 31 files through 0031 (BF-4d).
        // BF-4f authorized revision: through 0035. Was: 33 files through 0033 (BF-4e).
        assertSame(35, count($files), 'the production set through 0035 (BF-4f)');
        $files['0004_create_sessions.sql'] .= "\n";
        $dir = migrationFixture($files);
        assertSame(MigrationError::SCHEMA_DRIFT, (new Readiness(testDbConfig(), $dir))->check());
        $r = kernel(testDbConfig(), null, $dir)->handle(new Request('GET', '/api/ready'), requestId());
        assertSame(503, $r->status);
    },
    'every table is InnoDB utf8mb4_unicode_ci; outside the employees and overtime business text, character columns are ascii_bin and datetimes are DATETIME(6)' => static function () use ($authTables): void {
        $db = authDatabase();
        foreach ($authTables as $t) {
            $info = $db->select('SELECT ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [$t])[0];
            assertSame(['InnoDB', 'utf8mb4_unicode_ci'], [(string) $info['engine'], (string) $info['collation']], $t);
        }
        // BF-4a1: employees holds human text (names, titles, notes), a date and money; its exact
        // columns are pinned in EmployeeSchemaTest. Every other table keeps the identifier rule.
        // BF-4c1 authorized revision: payroll_plans (snapshot text and money) is pinned in
        // PayrollSchemaTest; payroll_plan_overtime keeps the identifier rule (4 columns). Was: 63.
        // BF-4d authorized revision: supplemental_payrolls (snapshot text and money) is pinned in
        // SupplementalSchemaTest; supplemental_payroll_overtime keeps the identifier rule (4 columns). Was: 67.
        // BF-4e authorized revision: finance_postings (an exact money column) is pinned in
        // FinancePostingSchemaTest. Was: every table but the four above.
        // BF-4f authorized revision: finance_executions (an exact money column and a DATE) is pinned in
        // FinanceExecutionSchemaTest. Was: every table but the five above.
        $columns = $db->select("SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS type, CHARACTER_SET_NAME AS cs, COLLATION_NAME AS coll, DATETIME_PRECISION AS prec FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME NOT IN ('schema_migrations', 'employees', 'overtime_records', 'payroll_plans', 'supplemental_payrolls', 'finance_postings', 'finance_executions')");
        assertTrue(count($columns) === 71, 'expected 71 columns (42 auth, 9 mail outbox, 12 audit, 4 payroll link, 4 supplemental link), got ' . count($columns));
        foreach ($columns as $c) {
            $label = $c['t'] . '.' . $c['c'];
            if (in_array($c['type'], ['char', 'varchar'], true)) {
                assertSame(['ascii', 'ascii_bin'], [(string) $c['cs'], (string) $c['coll']], $label);
            } elseif ($c['type'] === 'datetime') {
                assertSame(6, (int) $c['prec'], $label);
            } else {
                assertTrue(in_array($c['type'], ['int', 'bigint'], true), $label . ' is ' . $c['type']);
            }
        }
    },
    // BF-4d authorized revision: 0031 replaces the audit action, entity and action-operation CHECKs
    // (v5, v4, v5) and 0029–0030 add the Supplemental CHECKs and six foreign keys. Was: action_v4,
    // entity_v3, action_operation_v4 and no Supplemental constraint.
    // BF-4e authorized revision: 0033 replaces the audit operation and action-operation CHECKs (v6,
    // v6) and 0032 adds the Finance posting CHECKs and four foreign keys. Was: operation_v5,
    // action_operation_v5 and no Finance constraint.
    // BF-4f authorized revision: 0035 replaces the audit action, entity, operation and action-operation
    // CHECKs (v6, v5, v7, v7) and 0034 adds the Finance execution CHECKs and three foreign keys. Was:
    // action_v5, entity_v4, operation_v6, action_operation_v6 and no execution constraint.
    'the named CHECK constraints and foreign keys exist' => static function (): void {
        $db = authDatabase();
        $checks = array_map(static fn (array $r): string => (string) $r['n'],
            $db->select('SELECT CONSTRAINT_NAME AS n FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY CONSTRAINT_NAME'));
        assertSame(['account_tokens_expiry', 'account_tokens_final', 'account_tokens_purpose_v2', 'account_tokens_used_in_time',
            'audit_events_account_target', 'audit_events_action_operation_v7', 'audit_events_action_v6', 'audit_events_entity_id', 'audit_events_entity_v5', 'audit_events_fields', 'audit_events_operation_v7',
            'auth_events_event_v3', 'employees_code', 'employees_employment_status', 'employees_full_name', 'employees_id', 'employees_salary', 'employees_version',
            'finance_executions_amount', 'finance_executions_id', 'finance_executions_idempotency_key_format', 'finance_executions_month_key', 'finance_executions_payment_method',
            'finance_postings_amount', 'finance_postings_id', 'finance_postings_idempotency_key_format', 'finance_postings_month_key', 'finance_postings_source', 'finance_postings_status',
            'mail_outbox_attempts', 'mail_outbox_kind_v2', 'mail_outbox_status', 'memberships_employee_bound', 'memberships_employee_id', 'memberships_role', 'memberships_status',
            'overtime_records_approved_amount', 'overtime_records_date_in_month', 'overtime_records_hours', 'overtime_records_id', 'overtime_records_month_key', 'overtime_records_status_v2',
            'overtime_records_valuation', 'overtime_records_valuation_hours', 'overtime_records_valuation_method', 'overtime_records_valuation_salary', 'overtime_records_version',
            'payroll_plans_base_salary', 'payroll_plans_committed', 'payroll_plans_commit_key_committed', 'payroll_plans_commit_key_format', 'payroll_plans_id', 'payroll_plans_month_key', 'payroll_plans_overtime', 'payroll_plans_snapshot', 'payroll_plans_status',
            'payroll_plans_total', 'payroll_plans_version', 'payroll_plan_overtime_id',
            'supplemental_payrolls_amount', 'supplemental_payrolls_committed', 'supplemental_payrolls_commit_key_committed', 'supplemental_payrolls_commit_key_format', 'supplemental_payrolls_count',
            'supplemental_payrolls_hours', 'supplemental_payrolls_id', 'supplemental_payrolls_month_key', 'supplemental_payrolls_snapshot', 'supplemental_payrolls_status', 'supplemental_payrolls_version',
            'supplemental_payroll_overtime_id',
            'users_email_normalized', 'users_password_hash', 'users_status'], $checks);
        $fks = array_map(static fn (array $r): string => $r['t'] . '.' . $r['n'] . '->' . $r['r'],
            $db->select('SELECT TABLE_NAME AS t, CONSTRAINT_NAME AS n, REFERENCED_TABLE_NAME AS r FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY TABLE_NAME, CONSTRAINT_NAME'));
        assertSame(['account_tokens.account_tokens_user_fk->users',
            'audit_events.audit_events_actor_membership_fk->memberships', 'audit_events.audit_events_actor_user_fk->users',
            'audit_events.audit_events_company_fk->companies', 'audit_events.audit_events_target_user_fk->users',
            'employees.employees_company_fk->companies',
            'finance_executions.finance_executions_company_fk->companies', 'finance_executions.finance_executions_employee_fk->employees',
            'finance_executions.finance_executions_finance_posting_fk->finance_postings',
            'finance_postings.finance_postings_company_fk->companies', 'finance_postings.finance_postings_employee_fk->employees',
            'finance_postings.finance_postings_payroll_plan_fk->payroll_plans', 'finance_postings.finance_postings_supplemental_payroll_fk->supplemental_payrolls',
            'mail_outbox.mail_outbox_user_fk->users',
            'memberships.memberships_company_fk->companies', 'memberships.memberships_employee_fk->employees', 'memberships.memberships_user_fk->users',
            'overtime_records.overtime_records_company_fk->companies', 'overtime_records.overtime_records_employee_fk->employees',
            'payroll_plans.payroll_plans_company_fk->companies', 'payroll_plans.payroll_plans_employee_fk->employees',
            'payroll_plan_overtime.payroll_plan_overtime_company_fk->companies', 'payroll_plan_overtime.payroll_plan_overtime_plan_fk->payroll_plans', 'payroll_plan_overtime.payroll_plan_overtime_record_fk->overtime_records',
            'sessions.sessions_user_fk->users',
            'supplemental_payrolls.supplemental_payrolls_company_fk->companies', 'supplemental_payrolls.supplemental_payrolls_employee_fk->employees', 'supplemental_payrolls.supplemental_payrolls_plan_fk->payroll_plans',
            'supplemental_payroll_overtime.supplemental_payroll_overtime_company_fk->companies', 'supplemental_payroll_overtime.supplemental_payroll_overtime_record_fk->overtime_records',
            'supplemental_payroll_overtime.supplemental_payroll_overtime_supplemental_fk->supplemental_payrolls'], $fks, 'auth_events has no FK');
    },
    'CHECK constraints are enforced by MariaDB' => static function () use ($refused, $id, $insertUser, $insertMembership): void {
        $db = authDatabase();
        $a = authFixture($db);
        $cases = [
            'user status' => [$insertUser, [$id(), 'x1@example.test', null, 'pending']],
            'upper-case email' => [$insertUser, [$id(), 'Upper@example.test', null, 'active']],
            'untrimmed email' => [$insertUser, [$id(), ' x2@example.test', null, 'active']],
            'empty email' => [$insertUser, [$id(), '', null, 'active']],
            'empty password hash' => [$insertUser, [$id(), 'x3@example.test', '', 'active']],
            'membership role' => [$insertMembership, [$id(), $a['userId'], $a['companyId'], 'admin', null, 'active']],
            'membership status' => [$insertMembership, [$id(), $a['userId'], $a['companyId'], 'ceo', null, 'pending']],
            'empty employee id' => [$insertMembership, [$id(), $a['userId'], $a['companyId'], 'ceo', '', 'active']],
            'unbound employee' => [$insertMembership, [$id(), $a['userId'], $a['companyId'], 'employee', null, 'active']],
            'event vocabulary' => ["INSERT INTO auth_events (occurred_at, event, request_id) VALUES (UTC_TIMESTAMP(6), 'password_changed', ?)", [str_repeat('a', 32)]],
        ];
        // The membership cases use a second, membership-less user so UNIQUE(user_id) is not what refuses them.
        $free = $id();
        $db->execute($insertUser, [$free, 'free-' . bin2hex(random_bytes(4)) . '@example.test', null, 'active']);
        foreach ($cases as $label => [$sql, $params]) {
            if ($sql === $insertMembership) {
                $params[1] = $free;
            }
            $e = $refused($db, $sql, $params, $label);
            assertSame(['23000', 4025], [$e->sqlstate, $e->driverCode], $label . ': CHECK failure');
        }
        $e = $refused($db, $insertUser, [$id(), 'ü@example.test', null, 'active'], 'non-ASCII email');
        assertTrue($e->driverCode !== null, 'strict mode refuses non-ASCII');
    },
    'foreign keys are enforced; a referenced user cannot be deleted' => static function () use ($refused, $id, $insertMembership): void {
        $db = authDatabase();
        $a = authFixture($db);
        $e = $refused($db, $insertMembership, [$id(), $id(), $a['companyId'], 'ceo', null, 'active'], 'unknown user');
        assertSame(1452, $e->driverCode);
        $free = authFixture($db, ['membership' => false]);
        $e = $refused($db, $insertMembership, [$id(), $free['userId'], $id(), 'ceo', null, 'active'], 'unknown company');
        assertSame(1452, $e->driverCode);
        $e = $refused($db, "INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, last_seen_at, absolute_expires_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
            [str_repeat('0', 64), $id(), str_repeat('c', 43)], 'session for unknown user');
        assertSame(1452, $e->driverCode);
        $e = $refused($db, 'DELETE FROM users WHERE id = ?', [$a['userId']], 'delete referenced user');
        assertSame(1451, $e->driverCode);
    },
    'uniqueness: email; one membership per user; one binding per employee; any number of unbound memberships' => static function () use ($refused, $id, $insertUser, $insertMembership): void {
        $db = authDatabase();
        $a = authFixture($db);
        assertSame(1062, $refused($db, $insertUser, [$id(), $a['email'], null, 'active'], 'duplicate email')->driverCode);
        assertSame(1062, $refused($db, $insertMembership, [$id(), $a['userId'], $a['companyId'], 'ceo', null, 'active'], 'second membership')->driverCode);
        // NULL employee_id never collides: several unbound CEO memberships in one company.
        authFixture($db, ['companyId' => $a['companyId'], 'role' => 'ceo', 'employeeId' => null]);
        authFixture($db, ['companyId' => $a['companyId'], 'role' => 'ceo', 'employeeId' => null]);
        assertSame(3, (int) $db->select('SELECT COUNT(*) AS n FROM memberships WHERE company_id = ? AND employee_id IS NULL', [$a['companyId']])[0]['n']);
        authFixture($db, ['companyId' => $a['companyId'], 'role' => 'employee', 'employeeId' => 'emp-1']);
        $u = authFixture($db, ['companyId' => $a['companyId'], 'membership' => false]);
        assertSame(1062, $refused($db, $insertMembership, [$id(), $u['userId'], $a['companyId'], 'employee', 'emp-1', 'active'], 'binding reused in the company')->driverCode);
        // BF-3C: an employee id is one anchor row in one company (global primary key), so another
        // company binds its own employee; the cross-company binding refusal is in EmployeeSchemaTest.
        $other = authFixture($db, ['role' => 'employee', 'employeeId' => 'emp-2']);
        assertTrue($other['companyId'] !== $a['companyId'], 'another company binds its own employee');
    },
];
