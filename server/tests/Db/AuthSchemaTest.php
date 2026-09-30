<?php
declare(strict_types=1);

/*
 * The production schema (server/migrations 0001–0006 BF-3A, 0007–0008 BF-3B, 0009–0010 BF-3C)
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

$authTables = ['account_tokens', 'auth_events', 'auth_rate_limits', 'companies', 'employees', 'memberships', 'sessions', 'users'];
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
    'production migrations 0001–0010 apply in order, create exactly the auth tables and the employee anchor, and seed nothing' => static function () use ($tables, $authTables): void {
        $db = testDatabase();
        $applied = (new Migrator($db, productionMigrationsDir()))->apply();
        assertSame(['0001_create_companies', '0002_create_users', '0003_create_memberships', '0004_create_sessions', '0005_create_auth_rate_limits', '0006_create_auth_events',
            '0007_create_account_tokens', '0008_replace_auth_events_event_check', '0009_create_employees', '0010_add_memberships_employee_fk'],
            array_map(static fn ($m): string => $m->label(), $applied));
        assertSame(['account_tokens', 'auth_events', 'auth_rate_limits', 'companies', 'employees', 'memberships', 'schema_migrations', 'sessions', 'users'], $tables($db));
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM employees')[0]['n'], 'no employee');
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
        assertSame(10, count($files));
        $files['0004_create_sessions.sql'] .= "\n";
        $dir = migrationFixture($files);
        assertSame(MigrationError::SCHEMA_DRIFT, (new Readiness(testDbConfig(), $dir))->check());
        $r = kernel(testDbConfig(), null, $dir)->handle(new Request('GET', '/api/ready'), requestId());
        assertSame(503, $r->status);
    },
    'every table (auth and the employee anchor) is InnoDB utf8mb4_unicode_ci; character columns are ascii_bin; datetimes are DATETIME(6)' => static function () use ($authTables): void {
        $db = authDatabase();
        foreach ($authTables as $t) {
            $info = $db->select('SELECT ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [$t])[0];
            assertSame(['InnoDB', 'utf8mb4_unicode_ci'], [(string) $info['engine'], (string) $info['collation']], $t);
        }
        $columns = $db->select("SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS type, CHARACTER_SET_NAME AS cs, COLLATION_NAME AS coll, DATETIME_PRECISION AS prec FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> 'schema_migrations'");
        assertTrue(count($columns) === 45, 'expected 45 columns (42 auth, 3 employees), got ' . count($columns));
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
    'the named CHECK constraints and foreign keys exist' => static function (): void {
        $db = authDatabase();
        $checks = array_map(static fn (array $r): string => (string) $r['n'],
            $db->select('SELECT CONSTRAINT_NAME AS n FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY CONSTRAINT_NAME'));
        assertSame(['account_tokens_expiry', 'account_tokens_final', 'account_tokens_purpose', 'account_tokens_used_in_time',
            'auth_events_event_v2', 'employees_id', 'memberships_employee_bound', 'memberships_employee_id', 'memberships_role', 'memberships_status',
            'users_email_normalized', 'users_password_hash', 'users_status'], $checks);
        $fks = array_map(static fn (array $r): string => $r['t'] . '.' . $r['n'] . '->' . $r['r'],
            $db->select('SELECT TABLE_NAME AS t, CONSTRAINT_NAME AS n, REFERENCED_TABLE_NAME AS r FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() ORDER BY TABLE_NAME, CONSTRAINT_NAME'));
        assertSame(['account_tokens.account_tokens_user_fk->users', 'employees.employees_company_fk->companies', 'memberships.memberships_company_fk->companies',
            'memberships.memberships_employee_fk->employees', 'memberships.memberships_user_fk->users', 'sessions.sessions_user_fk->users'], $fks, 'auth_events has no FK');
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
