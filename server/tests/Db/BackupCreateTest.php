<?php
declare(strict_types=1);

use TamOs\Data\Backup\BackupReader;
use TamOs\Data\Database;
use TamOs\Data\DatabaseError;
use TamOs\Data\Migration\MigrationError;
use TamOs\Data\Migration\Migrator;
use TamOs\Ops\BackupCipher;
use TamOs\Ops\BackupCreator;
use TamOs\Ops\BackupError;
use TamOs\Ops\BackupStore;
use TamOs\Ops\BackupTables;
use TamOs\Ops\BackupVerifier;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\backupKeys;
use function TamOs\Tests\employeeAnchor;
use function TamOs\Tests\migrationFixture;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\runBackupCli;
use function TamOs\Tests\secondConnection;
use function TamOs\Tests\tempDir;
use function TamOs\Tests\testDatabase;
use function TamOs\Tests\testDbConfig;
use function TamOs\Tests\testConfig;
use function TamOs\Tests\writeConfigFile;

/**
 * OPS-1 against MariaDB: one consistent, read-only snapshot of every classified table; the
 * excluded security state never copied; locks against double invocation and concurrent
 * migrations; refusal of an incomplete, drifted or unclassified schema; atomic publication,
 * failure cleanup and retention; the audit-prefix continuity check end to end; and the CLI.
 * Fabricated data only.
 */

/** Seeds every backed-up and every excluded table with fabricated rows; returns the secrets that must never be copied. */
$seed = static function (Database $db): array {
    $ceo = authFixture($db);
    $employeeId = bin2hex(random_bytes(16));
    employeeAnchor($db, $ceo['companyId'], $employeeId);
    $db->execute("UPDATE employees SET monthly_base_salary = '1500000.25', notes = ? WHERE id = ?", ["Catatan ☕ \"kutipan\"\nbaris dua", $employeeId]);
    $second = bin2hex(random_bytes(16));
    employeeAnchor($db, $ceo['companyId'], $second);
    $db->execute("UPDATE employees SET monthly_base_salary = '2750000.50' WHERE id = ?", [$second]);
    for ($i = 1; $i <= 3; $i++) {
        $db->execute(
            "INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, 'employee.update', 'employee', ?, NULL, NULL, ?, 'fullName')",
            [$ceo['companyId'], $ceo['userId'], $ceo['membershipId'], $employeeId, bin2hex(random_bytes(16))],
        );
    }
    $db->execute("INSERT INTO auth_events (occurred_at, event, user_id, membership_id, email_hash, ip, request_id) VALUES (UTC_TIMESTAMP(6), 'login_success', ?, ?, NULL, '203.0.113.7', ?)", [$ceo['userId'], $ceo['membershipId'], bin2hex(random_bytes(16))]);
    $sessionHash = hash('sha256', 'session-' . bin2hex(random_bytes(8)));
    $csrf = substr(strtr(base64_encode(random_bytes(40)), '+/', '-_'), 0, 43);
    $db->execute('INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, last_seen_at, absolute_expires_at, revoked_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 1 DAY, NULL)', [$sessionHash, $ceo['userId'], $csrf]);
    $tokenHash = hash('sha256', 'token-' . bin2hex(random_bytes(8)));
    $db->execute("INSERT INTO account_tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, 'activation', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 1 DAY)", [$tokenHash, $ceo['userId']]);
    $bucket = hash('sha256', 'bucket-' . bin2hex(random_bytes(8)));
    $db->execute('INSERT INTO auth_rate_limits (bucket, failures, window_started_at, locked_until) VALUES (?, 1, UTC_TIMESTAMP(6), NULL)', [$bucket]);
    $requestId = bin2hex(random_bytes(16));
    $db->execute("INSERT INTO mail_outbox (user_id, kind, status, attempts, next_attempt_at, created_at, updated_at, request_id) VALUES (?, 'recovery', 'pending', 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), ?)", [$ceo['userId'], $requestId]);
    return ['ceo' => $ceo, 'employeeId' => $employeeId, 'excluded' => [$sessionHash, $csrf, $tokenHash, $bucket, $requestId]];
};

/** A creator over its own connection (the backup locks and snapshot are per connection). */
$creator = static function (string $dir, string $publicKey, ?string $migrationsDir = null, ?\Closure $afterTable = null): BackupCreator {
    $reader = BackupReader::fromDatabase(secondConnection(), str_repeat('d', 64));
    return new BackupCreator($reader, BackupStore::open($dir, dirname(__DIR__, 2)), $publicKey, 'test', $migrationsDir ?? productionMigrationsDir(), $afterTable);
};

/** The decrypted payload of a backup (after full verification). */
$plaintext = static function (string $path, string $secretKey): string {
    (new BackupVerifier($secretKey))->verify($path);
    $out = '';
    $in = fopen($path, 'rb');
    BackupCipher::open($in, $secretKey, static function (string $p) use (&$out): void {
        $out .= $p;
    });
    fclose($in);
    return $out;
};

$files = static fn (string $dir): array => array_values(array_diff(scandir($dir), ['.', '..']));

return [
    'create: every classified table from one snapshot; verify reproduces the counts and the money totals the database sums' => static function () use ($seed, $creator, $plaintext): void {
        $db = authDatabase();
        $s = $seed($db);
        $keys = backupKeys();
        $dir = tempDir();
        $result = $creator($dir, $keys['publicKey'])->create();
        assertSame(13, $result['tables']);
        assertSame([35, 35, 0], [$result['databaseHead'], $result['codeHead'], $result['pruned']]);
        $path = $dir . DIRECTORY_SEPARATOR . BackupStore::fileName($result['backupId']);
        $m = (new BackupVerifier($keys['secretKey']))->verify($path);
        assertSame(BackupTables::INCLUDED, array_column($m['tables'], 'name'));
        assertSame([], $m['absentTables']);
        assertSame(BackupTables::EXCLUDED, $m['excludedTables']);
        assertSame(35, count($m['schema']['migrations']));
        $applied = $db->select('SELECT version, sha256 FROM schema_migrations ORDER BY version');
        assertSame(array_column($applied, 'sha256'), array_column($m['schema']['migrations'], 'sha256'), 'the applied history');
        $total = 0;
        foreach ($m['tables'] as $table) {
            $count = (int) $db->select('SELECT COUNT(*) AS n FROM `' . $table['name'] . '`')[0]['n'];
            assertSame($count, $table['rows'], 'rows of ' . $table['name']);
            $total += $count;
        }
        assertSame($total, $result['rows']);
        $employees = $m['tables'][array_search('employees', BackupTables::INCLUDED, true)];
        assertSame($db->select('SELECT CAST(SUM(monthly_base_salary) AS CHAR) AS s FROM employees')[0]['s'], $employees['decimalTotals']['monthly_base_salary'], 'money total equals SUM()');
        assertSame('4250000.75', $employees['decimalTotals']['monthly_base_salary']);
        $users = $m['tables'][array_search('users', BackupTables::INCLUDED, true)];
        assertSame(1, $users['rows']);

        $payload = $plaintext($path, $keys['secretKey']);
        foreach ($s['excluded'] as $secret) {
            assertTrue(!str_contains($payload, $secret), 'excluded security state is never copied');
        }
        $hash = (string) $db->select('SELECT password_hash FROM users WHERE id = ?', [$s['ceo']['userId']])[0]['password_hash'];
        assertTrue(str_contains($payload, json_encode($hash, JSON_UNESCAPED_SLASHES)), 'password hashes are kept (no credential reset after a restore)');
        assertTrue(str_contains($payload, '"Catatan ☕ \"kutipan\"\nbaris dua"'), 'text survives exactly');
        assertTrue(!str_contains((string) file_get_contents($path), 'Catatan'), 'the file itself is encrypted');
    },

    'snapshot: rows committed while the backup runs are not in it, across page boundaries, and the counts still agree' => static function () use ($seed, $creator): void {
        $db = authDatabase();
        $s = $seed($db);
        for ($i = 0; $i < 1203; $i++) {
            $db->execute("INSERT INTO auth_events (occurred_at, event, user_id, membership_id, email_hash, ip, request_id) VALUES (UTC_TIMESTAMP(6), 'logout', NULL, NULL, NULL, NULL, ?)", [bin2hex(random_bytes(16))]);
        }
        $before = ['auth_events' => 1204, 'audit_events' => 3, 'employees' => 2];
        $keys = backupKeys();
        $dir = tempDir();
        $writer = secondConnection();
        $result = $creator($dir, $keys['publicKey'], null, static function (string $table) use ($writer, $s): void {
            if ($table === 'companies') {
                // Committed by another connection after the snapshot began, before these tables are read.
                $writer->execute("INSERT INTO auth_events (occurred_at, event, user_id, membership_id, email_hash, ip, request_id) VALUES (UTC_TIMESTAMP(6), 'logout', NULL, NULL, NULL, NULL, ?)", [bin2hex(random_bytes(16))]);
                $writer->execute(
                    "INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, 'employee.update', 'employee', ?, NULL, NULL, ?, NULL)",
                    [$s['ceo']['companyId'], $s['ceo']['userId'], $s['ceo']['membershipId'], $s['employeeId'], bin2hex(random_bytes(16))],
                );
                employeeAnchor($writer, $s['ceo']['companyId'], bin2hex(random_bytes(16)));
            }
        })->create();
        $m = (new BackupVerifier($keys['secretKey']))->verify($dir . DIRECTORY_SEPARATOR . BackupStore::fileName($result['backupId']));
        foreach ($before as $table => $rows) {
            assertSame($rows, $m['tables'][array_search($table, BackupTables::INCLUDED, true)]['rows'], $table . ' as of the snapshot');
        }
        assertSame(1205, (int) $db->select('SELECT COUNT(*) AS n FROM auth_events')[0]['n'], 'the concurrent writes did commit');
    },

    'the snapshot transaction is read-only: a write inside it is refused by the server and leaves nothing' => static function (): void {
        $db = authDatabase();
        $other = secondConnection();
        $e = assertThrows(DatabaseError::class, static fn () => $other->snapshot(static fn (Database $d) => $d->execute("INSERT INTO auth_events (occurred_at, event, request_id) VALUES (UTC_TIMESTAMP(6), 'logout', ?)", [bin2hex(random_bytes(16))])));
        assertSame(1792, $e->driverCode, 'ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION');
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM auth_events')[0]['n']);
        $other->execute("INSERT INTO auth_events (occurred_at, event, request_id) VALUES (UTC_TIMESTAMP(6), 'logout', ?)", [bin2hex(random_bytes(16))]);
        assertSame(1, (int) $db->select('SELECT COUNT(*) AS n FROM auth_events')[0]['n'], 'the next transaction is an ordinary one again');
    },

    'double invocation: a held backup lock refuses (backup_busy); a running migration refuses (migration_busy); nothing is written' => static function () use ($seed, $creator, $files): void {
        $db = authDatabase();
        $seed($db);
        $keys = backupKeys();
        $dir = tempDir();
        $holder = secondConnection();
        assertSame(1, (int) $holder->select("SELECT GET_LOCK('tamos_backup', 0) AS a")[0]['a']);
        assertSame(BackupError::BUSY, assertThrows(BackupError::class, static fn () => $creator($dir, $keys['publicKey'])->create())->reason);
        $holder->select("SELECT RELEASE_LOCK('tamos_backup') AS r");
        assertSame(1, (int) $holder->select("SELECT GET_LOCK('tamos_migrate', 0) AS a")[0]['a']);
        assertSame(MigrationError::MIGRATION_BUSY, assertThrows(MigrationError::class, static fn () => $creator($dir, $keys['publicKey'])->create())->reason);
        assertSame(1, (int) $holder->select("SELECT IS_FREE_LOCK('tamos_backup') AS f")[0]['f'], 'the backup lock is released after the refusal');
        $holder->select("SELECT RELEASE_LOCK('tamos_migrate') AS r");
        assertSame([], $files($dir), 'no file and no temporary');

        // While a backup runs, a second backup and a migration are both refused.
        $seen = [];
        $creator($dir, $keys['publicKey'], null, static function (string $table) use (&$seen, $creator, $dir, $keys): void {
            if ($table === 'users') {
                $seen[] = assertThrows(BackupError::class, static fn () => $creator($dir, $keys['publicKey'])->create())->reason;
                $seen[] = assertThrows(MigrationError::class, static fn () => (new Migrator(secondConnection(), productionMigrationsDir()))->status())->reason;
            }
        })->create();
        assertSame([BackupError::BUSY, MigrationError::MIGRATION_BUSY], $seen);
        assertSame(2, count($files($dir)), 'exactly one backup and its sidecar');
    },

    'pre-migration backup: pending migrations are allowed and recorded, not-yet-created tables are absent, and it verifies' => static function () use ($creator): void {
        $db = testDatabase();
        $first = [];
        foreach (array_slice(scandir(productionMigrationsDir()), 2, 33) as $file) {
            $first[$file] = (string) file_get_contents(productionMigrationsDir() . DIRECTORY_SEPARATOR . $file);
        }
        (new Migrator($db, migrationFixture($first)))->apply();
        authFixture($db);
        $keys = backupKeys();
        $dir = tempDir();
        $result = $creator($dir, $keys['publicKey'])->create();
        assertSame([33, 35, 12], [$result['databaseHead'], $result['codeHead'], $result['tables']]);
        $m = (new BackupVerifier($keys['secretKey']))->verify($dir . DIRECTORY_SEPARATOR . BackupStore::fileName($result['backupId']));
        assertSame(['finance_executions'], $m['absentTables']);
        assertSame(33, count($m['schema']['migrations']));
    },

    'refusals before anything is written: no history, an incomplete or drifted history, an unclassified table, a non-InnoDB table' => static function () use ($creator, $files): void {
        $keys = backupKeys();
        $dir = tempDir();
        testDatabase();
        assertSame(MigrationError::HISTORY_MISSING, assertThrows(MigrationError::class, static fn () => $creator($dir, $keys['publicKey'])->create())->reason);
        $cases = [
            MigrationError::SCHEMA_INCOMPLETE => 'UPDATE schema_migrations SET applied_at = NULL WHERE version = 35',
            MigrationError::SCHEMA_DRIFT => "UPDATE schema_migrations SET sha256 = REPEAT('0', 64) WHERE version = 1",
        ];
        foreach ($cases as $reason => $sql) {
            $db = authDatabase();
            $db->execute($sql);
            assertSame($reason, assertThrows(MigrationError::class, static fn () => $creator($dir, $keys['publicKey'])->create())->reason, $reason);
        }
        $db = authDatabase();
        $db->execute('CREATE TABLE stray (id INT NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB');
        assertSame(BackupError::UNCLASSIFIED_TABLE, assertThrows(BackupError::class, static fn () => $creator($dir, $keys['publicKey'])->create())->reason);
        $db = authDatabase();
        $db->execute('ALTER TABLE auth_rate_limits ENGINE=MyISAM');
        assertSame(BackupError::UNEXPECTED_SCHEMA, assertThrows(BackupError::class, static fn () => $creator($dir, $keys['publicKey'])->create())->reason);
        $db = authDatabase();
        $db->execute('ALTER TABLE companies ADD COLUMN ratio DOUBLE NULL');
        assertSame(BackupError::UNSUPPORTED_VALUE, assertThrows(BackupError::class, static fn () => $creator($dir, $keys['publicKey'])->create())->reason, 'a float column');
        assertSame([], $files($dir), 'no file, no temporary, ever');
    },

    'a failure part-way discards only its own temporary file; earlier backups stay and the next run succeeds' => static function () use ($seed, $creator, $files): void {
        $db = authDatabase();
        $seed($db);
        $keys = backupKeys();
        $dir = tempDir();
        $good = $creator($dir, $keys['publicKey'])->create();
        $e = assertThrows(BackupError::class, static fn () => $creator($dir, $keys['publicKey'], null, static function (string $table): void {
            if ($table === 'employees') {
                throw new \RuntimeException('simulated failure part-way (for example a full disk)');
            }
        })->create());
        assertSame(BackupError::WRITE_FAILED, $e->reason);
        $name = BackupStore::fileName($good['backupId']);
        assertSame([$name, $name . '.sha256'], $files($dir), 'only the earlier backup');
        $holder = secondConnection();
        $free = $holder->select("SELECT IS_FREE_LOCK('tamos_backup') AS b, IS_FREE_LOCK('tamos_migrate') AS m")[0];
        assertSame([1, 1], [(int) $free['b'], (int) $free['m']], 'both locks released');
        $next = $creator($dir, $keys['publicKey'])->create();
        assertTrue(strcmp($next['backupId'], $good['backupId']) > 0, 'a later id');
        assertSame(4, count($files($dir)));
    },

    'retention through create: the eighth backup removes the oldest, keeping seven' => static function () use ($creator, $files): void {
        $db = authDatabase();
        authFixture($db);
        $keys = backupKeys();
        $dir = tempDir();
        $ids = [];
        for ($i = 0; $i < 8; $i++) {
            $r = $creator($dir, $keys['publicKey'])->create();
            $ids[] = $r['backupId'];
            assertSame($i === 7 ? 1 : 0, $r['pruned'], 'run ' . $i);
        }
        $store = BackupStore::open($dir, dirname(__DIR__, 2));
        assertSame(array_reverse(array_slice($ids, 1)), $store->ids());
        assertSame(14, count($files($dir)));
    },

    'continuity end to end: appended audit rows verify; an audit row rewritten in the database between backups is detected' => static function () use ($seed, $creator): void {
        $db = authDatabase();
        $s = $seed($db);
        $keys = backupKeys();
        $dir = tempDir();
        $path = static fn (array $r): string => $dir . DIRECTORY_SEPARATOR . BackupStore::fileName($r['backupId']);
        $first = $path($creator($dir, $keys['publicKey'])->create());
        $db->execute(
            "INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, 'employee.update', 'employee', ?, NULL, NULL, ?, NULL)",
            [$s['ceo']['companyId'], $s['ceo']['userId'], $s['ceo']['membershipId'], $s['employeeId'], bin2hex(random_bytes(16))],
        );
        $second = $path($creator($dir, $keys['publicKey'])->create());
        (new BackupVerifier($keys['secretKey']))->verify($second, $first);
        // Test-only SQL standing in for someone with database access rewriting history.
        $db->execute("UPDATE audit_events SET fields = 'jobTitle' WHERE id = (SELECT MIN(id) FROM (SELECT id FROM audit_events) AS a)");
        $third = $path($creator($dir, $keys['publicKey'])->create());
        (new BackupVerifier($keys['secretKey']))->verify($third);    // on its own it is a valid backup
        assertSame(BackupError::CONTINUITY_BROKEN, assertThrows(BackupError::class, static fn () => (new BackupVerifier($keys['secretKey']))->verify($third, $second))->reason);
        assertSame(BackupError::CONTINUITY_BROKEN, assertThrows(BackupError::class, static fn () => (new BackupVerifier($keys['secretKey']))->verify($third, $first))->reason);
    },

    'the CLI end to end: create, status and verify; a busy run exits 1; one metadata-only log line per create' => static function () use ($seed): void {
        $db = authDatabase();
        $seed($db);
        $keys = backupKeys();
        $dir = tempDir();
        $base = testDbConfig();
        $config = testConfig(['db' => $base->db, 'backup' => ['dir' => $dir, 'public_key' => $keys['publicKeyBase64']]]);
        $file = writeConfigFile($config);
        $run = runBackupCli(['create'], $file);
        assertSame(0, $run['exit'], $run['stderr']);
        assertTrue(preg_match('/^backup: ([0-9]{8}T[0-9]{6}Z-[0-9a-f]{8})\nbytes: [0-9]+\ntables: 13, rows: [0-9]+\nschema: database head 35, code head 35\npruned: 0\n$/D', $run['stdout'], $m) === 1, $run['stdout']);
        $status = runBackupCli(['status'], $file);
        assertSame(0, $status['exit'], $status['stderr']);
        assertTrue(str_starts_with($status['stdout'], "backups: 1, intact: 1\nnewest: " . $m[1] . ' (0 h old, '), $status['stdout']);
        $verify = runBackupCli(['verify', '--file=' . $dir . DIRECTORY_SEPARATOR . BackupStore::fileName($m[1]), '--secret-key-file=' . $keys['keyFile']], null);
        assertSame(0, $verify['exit'], $verify['stderr']);

        $holder = secondConnection();
        $holder->select("SELECT GET_LOCK('tamos_backup', 0) AS a");
        $busy = runBackupCli(['create'], $file);
        $holder->select("SELECT RELEASE_LOCK('tamos_backup') AS r");
        assertSame([1, '', "create: backup_busy\n"], [$busy['exit'], $busy['stdout'], $busy['stderr']]);

        $log = array_map(static fn (string $l): array => json_decode($l, true, 8, JSON_THROW_ON_ERROR), array_filter(explode("\n", (string) file_get_contents($config->logPath))));
        $backupLines = array_values(array_filter($log, static fn (array $l): bool => ($l['event'] ?? null) === 'backup'));
        assertSame(2, count($backupLines));
        assertSame(['created', $m[1], null], [$backupLines[0]['outcome'], $backupLines[0]['backupId'], $backupLines[0]['reason']]);
        assertSame(['failed', null, 'backup_busy'], [$backupLines[1]['outcome'], $backupLines[1]['backupId'], $backupLines[1]['reason']]);
        $raw = (string) file_get_contents($config->logPath);
        foreach ([$dir, $keys['publicKeyBase64'], (string) $base->db['pass']] as $secret) {
            assertTrue(!str_contains($raw, $secret) && !str_contains($run['stdout'] . $run['stderr'], $secret), 'no path, key or credential in the log or output');
        }
    },
];
