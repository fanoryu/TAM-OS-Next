<?php
declare(strict_types=1);

/*
 * Migration runner against the real, guarded CI database (BF-2B). Every test starts from an
 * empty schema (testDatabase() drops the tables of the *_test schema only). Fixture
 * migrations are temporary files creating throw-away `bf2b_*` tables — no application schema.
 */

use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Data\DatabaseError;
use TamOs\Data\Migration\MigrationError;
use TamOs\Data\Migration\Migrator;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\migrationFixture;
use function TamOs\Tests\runMigrateCli;
use function TamOs\Tests\tempDir;
use function TamOs\Tests\testDatabase;
use function TamOs\Tests\testDbConfig;
use function TamOs\Tests\writeConfigFile;

$A = "CREATE TABLE bf2b_a (x INT NOT NULL) ENGINE=InnoDB;\n";
$B = "CREATE TABLE bf2b_b (x INT NOT NULL) ENGINE=InnoDB\n";
$tables = static fn (Database $db): array => array_map(
    static fn (array $r): string => (string) $r['t'],
    $db->select('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name'),
);
$history = static fn (Database $db): array => $db->select('SELECT version, name, sha256, applied_at FROM schema_migrations ORDER BY version');
$reason = static fn (callable $fn): string => assertThrows(MigrationError::class, $fn)->reason;
$other = static fn (): Database => new Database(DatabaseConfig::fromConfig(testDbConfig()));

return [
    'apply on an empty database bootstraps a verified history table, with zero migrations' => static function () use ($tables): void {
        $db = testDatabase();
        $m = new Migrator($db, tempDir() . '/absent');
        assertSame([], $m->apply());
        assertSame(['schema_migrations'], $tables($db));
        assertSame([], $m->inspect(), 'current, structure verified');
    },
    'the first migration applies once; a second apply is a no-op; the checksum is recorded' => static function () use ($A, $tables, $history): void {
        $db = testDatabase();
        $m = new Migrator($db, migrationFixture(['0001_create_a.sql' => $A]));
        assertSame(['0001_create_a'], array_map(static fn ($x): string => $x->label(), $m->apply()));
        assertSame(['bf2b_a', 'schema_migrations'], $tables($db));
        assertSame([], $m->apply(), 'no-op');
        $rows = $history($db);
        assertSame(1, count($rows));
        assertSame([1, 'create_a', hash('sha256', $A)], [(int) $rows[0]['version'], $rows[0]['name'], $rows[0]['sha256']]);
        assertTrue($rows[0]['applied_at'] !== null, 'completed');
    },
    'a modified or renamed applied migration is drift for apply, status and inspect' => static function () use ($A, $reason): void {
        $db = testDatabase();
        (new Migrator($db, migrationFixture(['0001_create_a.sql' => $A])))->apply();
        foreach ([['0001_create_a.sql' => $A . "-- edited\n"], ['0001_renamed.sql' => $A]] as $files) {
            $m = new Migrator($db, migrationFixture($files));
            foreach (['apply', 'status', 'inspect'] as $op) {
                assertSame(MigrationError::SCHEMA_DRIFT, $reason(static fn () => $m->$op()), $op);
            }
        }
    },
    'an unknown history row or a deleted repository file is drift' => static function () use ($A, $B, $reason): void {
        $db = testDatabase();
        (new Migrator($db, migrationFixture(['0001_create_a.sql' => $A, '0002_create_b.sql' => $B])))->apply();
        assertSame(MigrationError::SCHEMA_DRIFT, $reason(static fn () => (new Migrator($db, migrationFixture(['0001_create_a.sql' => $A])))->apply()), 'file deleted');
        $db->execute('DELETE FROM schema_migrations WHERE version = ?', [2]);
        $db->execute("INSERT INTO schema_migrations (version, name, sha256, started_at, applied_at) VALUES (9, 'ghost', ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [str_repeat('0', 64)]);
        assertSame(MigrationError::SCHEMA_DRIFT, $reason(static fn () => (new Migrator($db, migrationFixture(['0001_create_a.sql' => $A])))->inspect()), 'unknown row');
    },
    'a failing migration leaves its committed started marker, and every consumer then refuses' => static function () use ($A, $B, $history, $reason): void {
        $db = testDatabase();
        $dir = migrationFixture(['0001_create_a.sql' => $A, '0002_duplicate_a.sql' => $A, '0003_create_b.sql' => $B]);
        $e = assertThrows(DatabaseError::class, static fn () => (new Migrator($db, $dir))->apply());
        assertSame(DatabaseError::FAILURE, $e->kind);
        $rows = $history($other = new Database(DatabaseConfig::fromConfig(testDbConfig())));
        assertSame([1, 2], array_map(static fn (array $r): int => (int) $r['version'], $rows), 'marker visible to another connection (committed)');
        assertTrue($rows[0]['applied_at'] !== null && $rows[1]['applied_at'] === null, '0001 applied, 0002 incomplete');
        $m = new Migrator($db, $dir);
        foreach (['apply', 'status', 'inspect'] as $op) {
            $err = assertThrows(MigrationError::class, static fn () => $m->$op(), $op);
            assertSame([MigrationError::SCHEMA_INCOMPLETE, 2], [$err->reason, $err->version], $op);
        }
        assertSame(2, count($history($db)), 'no automatic cleanup, 0003 never started');
    },
    'an incomplete marker (the "DDL ran, completion not recorded" state) is never replayed' => static function () use ($A, $history, $tables): void {
        $db = testDatabase();
        (new Migrator($db, tempDir() . '/absent'))->apply();
        $db->execute('INSERT INTO schema_migrations (version, name, sha256, started_at, applied_at) VALUES (1, ?, ?, UTC_TIMESTAMP(6), NULL)', ['create_a', hash('sha256', $A)]);
        $e = assertThrows(MigrationError::class, static fn () => (new Migrator($db, migrationFixture(['0001_create_a.sql' => $A])))->apply());
        assertSame(MigrationError::SCHEMA_INCOMPLETE, $e->reason);
        assertSame(['schema_migrations'], $tables($db), 'not replayed');
        assertTrue($history($db)[0]['applied_at'] === null, 'not guessed complete');
    },
    'a two-statement migration is refused and neither statement takes effect' => static function () use ($tables, $history): void {
        $db = testDatabase();
        $dir = migrationFixture(['0001_two.sql' => "CREATE TABLE bf2b_a (x INT);\nCREATE TABLE bf2b_b (x INT);\n"]);
        assertSame(DatabaseError::FAILURE, assertThrows(DatabaseError::class, static fn () => (new Migrator($db, $dir))->apply())->kind);
        assertSame(['schema_migrations'], $tables($db), 'no bf2b_a, no bf2b_b');
        assertTrue($history($db)[0]['applied_at'] === null, 'left incomplete, fail closed');
    },
    'the advisory lock refuses a second runner without waiting, and is released afterwards' => static function () use ($A, $other, $reason): void {
        $db = testDatabase();
        $holder = $other();
        assertSame(1, (int) $holder->select("SELECT GET_LOCK('tamos_migrate', 0) AS l")[0]['l']);
        $m = new Migrator($db, migrationFixture(['0001_create_a.sql' => $A]));
        $started = microtime(true);
        assertSame(MigrationError::MIGRATION_BUSY, $reason(static fn () => $m->apply()));
        assertSame(MigrationError::MIGRATION_BUSY, $reason(static fn () => $m->status()));
        assertTrue(microtime(true) - $started < 5, 'no waiting');
        $holder->select("SELECT RELEASE_LOCK('tamos_migrate') AS r");
        assertSame(1, count($m->apply()), 'works once free');
        assertSame(1, (int) $holder->select("SELECT GET_LOCK('tamos_migrate', 0) AS l")[0]['l'], 'the runner released its lock');
        $holder->select("SELECT RELEASE_LOCK('tamos_migrate') AS r");
    },
    'status and inspect are read-only: no history created, nothing applied' => static function () use ($A, $tables, $reason): void {
        $db = testDatabase();
        $m = new Migrator($db, migrationFixture(['0001_create_a.sql' => $A]));
        assertSame(MigrationError::HISTORY_MISSING, $reason(static fn () => $m->status()));
        assertSame(MigrationError::HISTORY_MISSING, $reason(static fn () => $m->inspect()));
        assertSame([], $tables($db));
        (new Migrator($db, tempDir() . '/absent'))->apply();
        assertSame(['0001_create_a'], array_map(static fn ($x): string => $x->label(), $m->status()), 'pending reported');
        assertSame(['schema_migrations'], $tables($db), 'not applied by status');
    },
    'a history table with the wrong structure is history_invalid, even for apply' => static function () use ($reason): void {
        $db = testDatabase();
        $db->execute('CREATE TABLE schema_migrations (version SMALLINT UNSIGNED NOT NULL PRIMARY KEY, name VARCHAR(64) NOT NULL, sha256 CHAR(64) NOT NULL, started_at DATETIME(6) NOT NULL) ENGINE=InnoDB');
        $m = new Migrator($db, tempDir() . '/absent');
        assertSame(MigrationError::HISTORY_INVALID, $reason(static fn () => $m->apply()));
        assertSame(MigrationError::HISTORY_INVALID, $reason(static fn () => $m->inspect()));
        $db->execute('DROP TABLE schema_migrations');
        $db->execute('CREATE TABLE schema_migrations (version INT NOT NULL PRIMARY KEY, name VARCHAR(64) CHARACTER SET ascii NOT NULL, sha256 CHAR(64) CHARACTER SET ascii NOT NULL, started_at DATETIME(6) NOT NULL, applied_at DATETIME(6) NULL) ENGINE=InnoDB');
        assertSame(MigrationError::HISTORY_INVALID, $reason(static fn () => $m->inspect()), 'signed INT version');
    },
    'the CLI bootstraps, reports and leaks nothing' => static function () use ($tables): void {
        $db = testDatabase();
        $config = testDbConfig();
        $file = writeConfigFile($config);
        $status = runMigrateCli(['status'], $file);
        assertSame([1, "migrations: history_missing\n"], [$status['exit'], $status['stderr']]);
        // The real server/migrations set: 0001–0006 (BF-3A auth schema), 0007–0008 (BF-3B lifecycle),
        // 0009–0010 (BF-3C employee anchor and binding FK), 0011–0013 (BF-3D token purpose, events, mail outbox),
        // 0014–0017 (BF-4a1 employee profile — transitional columns, legacy backfill, final constraints —
        // and business audit), 0018–0019 (BF-4a2 activation mail kind, account audit operation),
        // 0020–0021 (BF-4b1 overtime records, overtime audit vocabulary), 0022–0023 (BF-4b2 overtime
        // valuation snapshot, approve audit operation).
        $apply = runMigrateCli(['apply'], $file);
        assertSame([0, "applied: 0001_create_companies\napplied: 0002_create_users\napplied: 0003_create_memberships\n"
            . "applied: 0004_create_sessions\napplied: 0005_create_auth_rate_limits\napplied: 0006_create_auth_events\n"
            . "applied: 0007_create_account_tokens\napplied: 0008_replace_auth_events_event_check\n"
            . "applied: 0009_create_employees\napplied: 0010_add_memberships_employee_fk\n"
            . "applied: 0011_replace_account_tokens_purpose_check\napplied: 0012_replace_auth_events_event_check\n"
            . "applied: 0013_create_mail_outbox\napplied: 0014_extend_employees_profile\n"
            . "applied: 0015_backfill_legacy_employees\napplied: 0016_enforce_employees_profile\napplied: 0017_create_audit_events\n"
            . "applied: 0018_replace_mail_outbox_kind_check\napplied: 0019_add_audit_events_account_operation\n"
            . "applied: 0020_create_overtime_records\napplied: 0021_replace_audit_events_overtime_checks\n"
            . "applied: 0022_add_overtime_records_valuation\napplied: 0023_replace_audit_events_overtime_approve\n"
            . "migrations: current\n"],
            [$apply['exit'], $apply['stdout']]);
        assertSame(['account_tokens', 'audit_events', 'auth_events', 'auth_rate_limits', 'companies', 'employees', 'mail_outbox', 'memberships', 'overtime_records', 'schema_migrations', 'sessions', 'users'], $tables($db));
        $again = runMigrateCli(['status'], $file);
        assertSame([0, "migrations: current\n"], [$again['exit'], $again['stdout']]);
        $noop = runMigrateCli(['apply'], $file);
        assertSame([0, "migrations: current\n"], [$noop['exit'], $noop['stdout']], 'second apply is a no-op');
        $db->execute('UPDATE schema_migrations SET applied_at = NULL WHERE version = ?', [6]);
        $broken = runMigrateCli(['apply'], $file);
        assertSame([1, "migrations: schema_incomplete (version 0006)\n"], [$broken['exit'], $broken['stderr']]);
        $wrong = runMigrateCli(['status'], writeConfigFile(\TamOs\Tests\testConfig(['db' => ['pass' => 'wrong-password-value'] + $config->db])));
        assertSame([1, "database: unavailable during connect\n"], [$wrong['exit'], $wrong['stderr']]);
        foreach ([$status, $apply, $again, $broken, $wrong] as $out) {
            $text = $out['stdout'] . $out['stderr'];
            foreach ([(string) $config->db['pass'], (string) $config->db['user'], 'wrong-password-value', 'mysql:', 'SQLSTATE', 'CREATE', 'INSERT'] as $secret) {
                assertTrue($secret === '' || !str_contains($text, $secret), 'CLI output leaks ' . $secret);
            }
        }
    },
];
