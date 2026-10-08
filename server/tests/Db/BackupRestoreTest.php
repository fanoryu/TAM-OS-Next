<?php
declare(strict_types=1);

use TamOs\Data\Backup\BackupReader;
use TamOs\Data\Backup\RestoreWriter;
use TamOs\Data\Database;
use TamOs\Data\DatabaseError;
use TamOs\Data\Migration\MigrationError;
use TamOs\Data\Migration\Migrator;
use TamOs\Ops\BackupCipher;
use TamOs\Ops\BackupCreator;
use TamOs\Ops\BackupError;
use TamOs\Ops\BackupRestorer;
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
use function TamOs\Tests\fail;
use function TamOs\Tests\migrationFixture;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\runBackupCli;
use function TamOs\Tests\secondConnection;
use function TamOs\Tests\tempDir;
use function TamOs\Tests\testConfig;
use function TamOs\Tests\testDatabase;
use function TamOs\Tests\testDbConfig;
use function TamOs\Tests\writeConfigFile;

/**
 * OPS-2 against MariaDB: an OPS-1 backup restored into an empty, migrated database reproduces every
 * backed-up row exactly (DECIMAL, DATE, DATETIME(6), NULL, text, generated columns recomputed,
 * auto-increment counters) and leaves the excluded tables empty; a non-empty, unmigrated or drifted
 * target is refused; every failure before commit — a swapped or tampered file, a forced error, a
 * killed process, a verification mismatch — leaves the target empty; concurrent writers, backups,
 * migrations and restores are held off; the proof after commit runs on a fresh connection; and
 * verify-restore detects a changed target. Restores here go back into the same guarded test
 * database after a reset; the off-host rehearsal into a separate database is DEPLOYMENT's runbook.
 * Fabricated data only.
 */

$classified = [...BackupTables::INCLUDED, ...BackupTables::EXCLUDED];
$sourceFingerprint = str_repeat('d', 64);

/** Seeds every classified table with fabricated rows, money edge values included; returns what must never leave the source. */
$seed = static function (Database $db, int $authEvents = 3): array {
    $ceo = authFixture($db);
    $c = $ceo['companyId'];
    $e1 = 'e_' . bin2hex(random_bytes(8));
    $e2 = 'e_' . bin2hex(random_bytes(8));
    employeeAnchor($db, $c, $e1);
    employeeAnchor($db, $c, $e2);
    employeeAnchor($db, $c, 'e_' . bin2hex(random_bytes(8)));
    $db->execute("UPDATE employees SET monthly_base_salary = '9999999999999.99', join_date = '2024-02-29', notes = ?, archived_at = '2026-10-07 01:02:03.000004' WHERE id = ?", ["Catatan ☕ \"kutipan\"\nbaris dua \\ / </script>", $e1]);
    $db->execute("UPDATE employees SET monthly_base_salary = '0.00', notes = '' WHERE id = ?", [$e2]);
    for ($i = 1; $i <= 3; $i++) {
        $db->execute(
            "INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, 'employee.update', 'employee', ?, NULL, NULL, ?, 'fullName')",
            [$c, $ceo['userId'], $ceo['membershipId'], $e1, bin2hex(random_bytes(16))],
        );
    }
    $db->execute("INSERT INTO auth_events (occurred_at, event, user_id, membership_id, email_hash, ip, request_id) SELECT UTC_TIMESTAMP(6), 'logout', NULL, NULL, NULL, '203.0.113.7', MD5(CONCAT(seq, RAND())) FROM seq_1_to_" . $authEvents);
    $ot = [];
    foreach (['payroll', 'supplemental'] as $k => $use) {
        $ot[$use] = bin2hex(random_bytes(16));
        $db->execute("INSERT INTO overtime_records (id, company_id, employee_id, month_key, overtime_date, hours, work_description, notes, status, version, created_at, updated_at, valuation_method, valuation_salary, valuation_standard_hours, approved_amount, approved_at) VALUES (?, ?, ?, '2026-10', ?, ?, 'Lembur', NULL, 'Approved', 2, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 'TAM-OT-1', '3500000.00', '160.00', ?, UTC_TIMESTAMP(6))",
            [$ot[$use], $c, $e1, $k === 0 ? '2026-10-05' : null, $k === 0 ? '1.25' : '744.00', $k === 0 ? '21875.00' : '15049710.00']);
    }
    $plan = bin2hex(random_bytes(16));
    $db->execute("INSERT INTO payroll_plans (id, company_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, '2026-10', 'Committed', 'CODE', 'Fixture', NULL, '3500000.01', '21875.00', '1.25', 1, '3521875.00', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), ?, 2, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
        [$plan, $c, $e1, bin2hex(random_bytes(16))]);
    $draft = bin2hex(random_bytes(16));
    $db->execute("INSERT INTO payroll_plans (id, company_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, base_salary, overtime_amount, overtime_hours, overtime_count, total_amount, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, '2026-11', 'Cancelled', 'CODE', 'Fixture', 'Ops', '1.00', '0.00', '0.00', 0, '1.00', UTC_TIMESTAMP(6), NULL, NULL, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
        [$draft, $c, $e2]);
    $db->execute('INSERT INTO payroll_plan_overtime (id, company_id, payroll_plan_id, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6))', [$ot['payroll'], $c, $plan]);
    $supp = bin2hex(random_bytes(16));
    $db->execute("INSERT INTO supplemental_payrolls (id, company_id, payroll_plan_id, employee_id, month_key, status, employee_code_snapshot, employee_name_snapshot, department_snapshot, overtime_amount, overtime_hours, overtime_count, calculated_at, committed_at, commit_idempotency_key, version, created_at, updated_at) VALUES (?, ?, ?, ?, '2026-10', 'Draft', 'CODE', 'Fixture', NULL, '15049710.00', '744.00', 1, UTC_TIMESTAMP(6), NULL, NULL, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
        [$supp, $c, $plan, $e1]);
    $db->execute('INSERT INTO supplemental_payroll_overtime (id, company_id, supplemental_payroll_id, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6))', [$ot['supplemental'], $c, $supp]);
    $posting = bin2hex(random_bytes(16));
    $db->execute("INSERT INTO finance_postings (id, company_id, source_kind, payroll_plan_id, supplemental_payroll_id, employee_id, month_key, amount, status, idempotency_key, posted_at) VALUES (?, ?, 'payrollPlan', ?, NULL, ?, '2026-10', '3521875.00', 'Planned', ?, UTC_TIMESTAMP(6))",
        [$posting, $c, $plan, $e1, bin2hex(random_bytes(16))]);
    $db->execute("INSERT INTO finance_executions (id, company_id, finance_posting_id, employee_id, month_key, amount, executed_on, payment_method, idempotency_key, recorded_at) VALUES (?, ?, ?, ?, '2026-10', '3521875.00', '2026-10-31', 'bankTransfer', ?, '2026-10-31 23:59:59.999999')",
        [bin2hex(random_bytes(16)), $c, $posting, $e1, bin2hex(random_bytes(16))]);
    $sessionHash = hash('sha256', 'session-' . bin2hex(random_bytes(8)));
    $db->execute('INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, last_seen_at, absolute_expires_at, revoked_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 1 DAY, NULL)', [$sessionHash, $ceo['userId'], substr(strtr(base64_encode(random_bytes(40)), '+/', '-_'), 0, 43)]);
    $tokenHash = hash('sha256', 'token-' . bin2hex(random_bytes(8)));
    $db->execute("INSERT INTO account_tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, 'activation', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 1 DAY)", [$tokenHash, $ceo['userId']]);
    $db->execute('INSERT INTO auth_rate_limits (bucket, failures, window_started_at, locked_until) VALUES (?, 1, UTC_TIMESTAMP(6), NULL)', [hash('sha256', 'bucket-' . bin2hex(random_bytes(8)))]);
    $db->execute("INSERT INTO mail_outbox (user_id, kind, status, attempts, next_attempt_at, created_at, updated_at, request_id) VALUES (?, 'recovery', 'pending', 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), ?)", [$ceo['userId'], bin2hex(random_bytes(16))]);
    return ['ceo' => $ceo, 'e1' => $e1, 'secrets' => [$sessionHash, $tokenHash]];
};

/** One OPS-1 backup of the guarded database, made through the real creator; returns its path. */
$backup = static function (array $keys, string $env = 'test') use ($sourceFingerprint): string {
    $dir = tempDir();
    $reader = BackupReader::fromDatabase(secondConnection(), $sourceFingerprint);
    $result = (new BackupCreator($reader, BackupStore::open($dir, dirname(__DIR__, 2)), $keys['publicKey'], $env, productionMigrationsDir()))->create();
    return $dir . DIRECTORY_SEPARATOR . BackupStore::fileName($result['backupId']);
};

/** A restorer into the guarded database; every connect() opens a new connection and is counted. */
$restorer = static function (array $keys, string $env = 'test', ?\Closure $confirm = null, ?\Closure $seam = null, ?int &$connections = null) use ($sourceFingerprint): BackupRestorer {
    $connections = 0;
    return new BackupRestorer(new BackupVerifier($keys['secretKey']), static function () use (&$connections): RestoreWriter {
        $connections++;
        return new RestoreWriter(secondConnection());
    }, $env, $sourceFingerprint, productionMigrationsDir(), $confirm, $seam);
};

/** Row counts of every classified table. */
$counts = static function (Database $db) use ($classified): array {
    $out = [];
    foreach ($classified as $table) {
        $out[$table] = (int) $db->select('SELECT COUNT(*) AS n FROM `' . $table . '`')[0]['n'];
    }
    return $out;
};
$empty = array_fill_keys($classified, 0);

/** The canonical rows of every backed-up table, as a backup encodes them, plus the generated columns. */
$snapshot = static function (Database $db): array {
    $out = [];
    foreach (BackupTables::INCLUDED as $table) {
        $out[$table] = json_encode($db->select('SELECT * FROM `' . $table . '` ORDER BY id'), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
    }
    return $out;
};

/** Decrypts a verified backup, rewrites its payload lines and seals the result under the same id and name into $into. */
$reseal = static function (string $path, array $keys, \Closure $mutate, string $into): string {
    (new BackupVerifier($keys['secretKey']))->verify($path);
    $plain = '';
    $in = fopen($path, 'rb');
    BackupCipher::open($in, $keys['secretKey'], static function (string $p) use (&$plain): void {
        $plain .= $p;
    });
    fclose($in);
    $id = (string) BackupStore::idOfFileName(basename($path));
    $store = BackupStore::open($into, dirname(__DIR__, 2));
    [$handle, $temp] = $store->createTemporary($id);
    $cipher = BackupCipher::seal($handle, $id, $keys['publicKey']);
    foreach (explode("\n", rtrim($plain, "\n")) as $line) {
        $cipher->write($mutate($line) . "\n");
    }
    $sealed = $cipher->finish();
    return $store->finalize($handle, $temp, $id, $sealed['sha256']);
};

/** Copies a backup and its sidecar over another path. */
$swapIn = static function (string $from, string $to): void {
    copy($from, $to);
    copy($from . '.sha256', $to . '.sha256');
};

return [
    'round trip: every backed-up row returns exactly — DECIMAL edges, DATE, DATETIME(6), NULL, text, generated columns — and a backup of the restored database equals the original' => static function () use ($seed, $backup, $restorer, $counts, $snapshot, $empty, $sourceFingerprint): void {
        $db = authDatabase();
        $s = $seed($db, 1203);
        $source = $snapshot($db);
        $sourceCounts = $counts($db);
        $keys = backupKeys();
        $path = $backup($keys);
        $original = (new BackupVerifier($keys['secretKey']))->verify($path);

        $db = authDatabase();
        assertSame($empty, $counts($db), 'an empty, migrated target');
        $evidence = $restorer($keys, 'test', null, null, $connections)->restore($path);
        assertSame(2, $connections, 'the restore connection, then a fresh one for the proof after commit');
        assertSame($original['backupId'], $evidence['backupId']);
        assertSame([35, 35, 35], [$evidence['backupHead'], $evidence['targetHead'], $evidence['codeHead']]);
        assertSame(array_column($original['tables'], 'rows', 'name'), $evidence['tables']);
        assertSame($source, $snapshot($db), 'every backed-up row, generated columns included, is byte-identical');
        foreach (BackupTables::INCLUDED as $table) {
            assertSame($sourceCounts[$table], $counts($db)[$table], $table);
        }
        foreach (BackupTables::EXCLUDED as $table) {
            assertSame(0, $counts($db)[$table], $table . ' is never restored');
        }
        assertSame([['9999999999999.99', '2024-02-29', '2026-10-07 01:02:03.000004']], array_map('array_values', $db->select('SELECT CAST(monthly_base_salary AS CHAR) AS m, CAST(join_date AS CHAR) AS j, CAST(archived_at AS CHAR) AS a FROM employees WHERE id = ?', [$s['e1']])));
        assertSame(['1', null], array_map(static fn (array $r): ?string => $r['k'] === null ? null : (string) $r['k'], $db->select("SELECT live_key AS k FROM payroll_plans ORDER BY status = 'Cancelled'")), 'live_key recomputed by the server');
        assertSame('1', (string) $db->select('SELECT open_key AS k FROM supplemental_payrolls')[0]['k']);

        $again = (new BackupVerifier($keys['secretKey']))->verify($backup($keys));
        foreach (['name', 'columns', 'columnsSha256', 'rows', 'maxId', 'sha256', 'decimalTotals'] as $key) {
            assertSame(array_column($original['tables'], $key), array_column($again['tables'], $key), 'a backup of the restored database: ' . $key);
        }
        assertSame($sourceFingerprint, $again['source']['databaseFingerprint']);

        $maxAudit = (int) $db->select('SELECT MAX(id) AS m FROM audit_events')[0]['m'];
        $db->execute("INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, 'employee.update', 'employee', ?, NULL, NULL, ?, NULL)",
            [$s['ceo']['companyId'], $s['ceo']['userId'], $s['ceo']['membershipId'], $s['e1'], bin2hex(random_bytes(16))]);
        assertSame($maxAudit + 1, (int) $db->select('SELECT MAX(id) AS m FROM audit_events')[0]['m'], 'the auto-increment counter continues after the restored ids');
        $continued = $backup($keys);
        (new BackupVerifier($keys['secretKey']))->verify($continued, $path);    // the audit prefix continues across the restore
    },

    'RestoreWriter names exactly the stored and generated columns of every backed-up table at head' => static function (): void {
        $db = authDatabase();
        foreach (BackupTables::INCLUDED as $table) {
            $stored = array_column($db->select("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND IS_GENERATED = 'NEVER' ORDER BY ORDINAL_POSITION", [$table]), 'c');
            $generated = array_column($db->select("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND IS_GENERATED <> 'NEVER' ORDER BY ORDINAL_POSITION", [$table]), 'c');
            assertSame($stored, RestoreWriter::COLUMNS[$table], $table . ' stored columns');
            assertSame($generated, RestoreWriter::GENERATED[$table] ?? [], $table . ' generated columns');
        }
        assertSame(['payroll_plans' => ['live_key'], 'supplemental_payrolls' => ['open_key']], (new RestoreWriter($db))->generatedColumns());
    },

    'a non-empty target is refused before anything is written — any one row in any of the 17 classified tables, excluded tables included' => static function () use ($seed, $backup, $restorer, $counts, $classified, $empty): void {
        $db = authDatabase();
        $seed($db);
        $templates = [];
        foreach ($classified as $table) {
            $row = $db->select('SELECT * FROM `' . $table . '` LIMIT 1')[0];
            foreach (RestoreWriter::GENERATED[$table] ?? [] as $column) {
                unset($row[$column]);
            }
            $templates[$table] = $row;
        }
        $keys = backupKeys();
        $path = $backup($keys);
        foreach ($templates as $table => $row) {
            $db = authDatabase();
            // Test-only: one orphan row, foreign keys off for this session only.
            $db->execute('SET SESSION foreign_key_checks = 0');
            $db->execute('INSERT INTO `' . $table . '` (`' . implode('`, `', array_keys($row)) . '`) VALUES (' . implode(', ', array_fill(0, count($row), '?')) . ')', array_values($row));
            $db->execute('SET SESSION foreign_key_checks = 1');
            $e = assertThrows(BackupError::class, static fn () => $restorer($keys)->restore($path), $table);
            assertSame(BackupError::TARGET_NOT_EMPTY, $e->reason, $table);
            $expected = $empty;
            $expected[$table] = 1;
            assertSame($expected, $counts($db), 'nothing was written: ' . $table);
        }
    },

    'the emptiness is proven again inside the transaction, under locks: a row that appears after the first check is refused and nothing is written' => static function () use ($seed, $backup, $restorer, $counts, $empty): void {
        $db = authDatabase();
        $seed($db);
        $keys = backupKeys();
        $path = $backup($keys, 'production');
        $db = authDatabase();
        $intruder = secondConnection();
        $confirm = static function (array $identity) use ($intruder): string {
            $intruder->execute('INSERT INTO auth_rate_limits (bucket, failures, window_started_at, locked_until) VALUES (?, 1, UTC_TIMESTAMP(6), NULL)', [hash('sha256', 'late')]);
            return $identity['phrase'];
        };
        assertSame(BackupError::TARGET_NOT_EMPTY, assertThrows(BackupError::class, static fn () => $restorer($keys, 'production', $confirm)->restore($path))->reason);
        $expected = $empty;
        $expected['auth_rate_limits'] = 1;
        assertSame($expected, $counts($db), 'only the late row');
    },

    'pass 2 never imports a file changed after pass 1: a swapped, tampered, truncated or re-sealed file rolls back and leaves the target empty' => static function () use ($seed, $backup, $restorer, $counts, $empty, $reseal, $swapIn): void {
        $db = authDatabase();
        $seed($db, 4000);
        $keys = backupKeys();
        $path = $backup($keys, 'production');
        $pristine = tempDir() . DIRECTORY_SEPARATOR . basename($path);
        $swapIn($path, $pristine);
        $variants = [
            // Every row identical, only the manifest's snapshot time changed: replays cleanly, then differs.
            BackupError::MANIFEST_MISMATCH => $reseal($path, $keys, static fn (string $l): string => str_starts_with($l, '{"manifest":') ? preg_replace('/"snapshotAt":"[^"]*"/', '"snapshotAt":"2000-01-01 00:00:00.000000"', $l) : $l, tempDir()),
            BackupError::NAME_MISMATCH => $backup($keys, 'production'),
        ];
        $size = filesize($path);
        foreach ([BackupError::TAMPERED => static function (string $p) use ($size): void {
            $h = fopen($p, 'r+b');
            fseek($h, $size - 10);
            $b = fread($h, 1);
            fseek($h, $size - 10);
            fwrite($h, chr(ord($b) ^ 1));
            fclose($h);
        }, BackupError::TRUNCATED => static function (string $p) use ($size): void {
            $h = fopen($p, 'r+b');
            ftruncate($h, $size - 20);
            fclose($h);
        }] as $reason => $damage) {
            $copy = tempDir() . DIRECTORY_SEPARATOR . basename($path);
            $swapIn($pristine, $copy);
            $damage($copy);
            file_put_contents($copy . '.sha256', hash_file('sha256', $copy) . '  ' . basename($copy) . "\n");
            $variants[$reason] = $copy;
        }
        foreach ($variants as $reason => $replacement) {
            $db = authDatabase();
            $swapIn($pristine, $path);
            $replayed = 0;
            $confirm = static function (array $identity) use ($swapIn, $replacement, $path, $reason): string {
                // The file changes between pass 1 and pass 2 (here, while the operator types).
                $swapIn($replacement, $path);
                if ($reason === BackupError::NAME_MISMATCH) {
                    file_put_contents($path . '.sha256', hash_file('sha256', $path) . '  ' . basename($path) . "\n");
                }
                return $identity['phrase'];
            };
            $seam = static function (string $stage) use (&$replayed): void {
                $replayed++;
            };
            $e = assertThrows(BackupError::class, static fn () => $restorer($keys, 'production', $confirm, $seam)->restore($path), $reason);
            assertSame($reason, $e->reason, $reason);
            assertSame(0, $replayed, 'no stage after the replay was reached: ' . $reason);
            assertSame($empty, $counts($db), 'rolled back: ' . $reason);
        }
        $db = authDatabase();
        $swapIn($pristine, $path);
        $restorer($keys, 'production', static fn (array $i): string => $i['phrase'])->restore($path);
        assertSame(4000, $counts($db)['auth_events'], 'the untouched file restores');
    },

    'rollback: an error after the import — a foreign-key violation with checks on, or any failure — leaves the target empty, and a retry succeeds' => static function () use ($seed, $backup, $restorer, $counts, $empty): void {
        $db = authDatabase();
        $seed($db);
        $keys = backupKeys();
        $path = $backup($keys);
        $db = authDatabase();
        $seen = [];
        $orphan = static function (string $stage, Database $tx) use (&$seen): void {
            if ($stage === 'imported') {
                $flags = $tx->select('SELECT @@SESSION.foreign_key_checks AS f, @@SESSION.unique_checks AS u')[0];
                $seen = [(int) $flags['f'], (int) $flags['u'], (int) $tx->select('SELECT COUNT(*) AS n FROM employees')[0]['n']];
                $tx->execute("INSERT INTO memberships (id, user_id, company_id, role, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, 'ceo', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [bin2hex(random_bytes(16)), str_repeat('0', 32), str_repeat('0', 32)]);
            }
        };
        $e = assertThrows(DatabaseError::class, static fn () => $restorer($keys, 'test', null, $orphan)->restore($path));
        assertSame([1, 1, 3], $seen, 'foreign-key and unique checks are on, and the rows were imported, inside the transaction');
        assertSame(1452, $e->driverCode, 'ER_NO_REFERENCED_ROW_2');
        assertSame($empty, $counts($db));
        assertThrows(\RuntimeException::class, static fn () => $restorer($keys, 'test', null, static function (string $stage): void {
            if ($stage === 'verified') {
                throw new \RuntimeException('simulated failure just before commit');
            }
        })->restore($path));
        assertSame($empty, $counts($db));
        $holder = secondConnection();
        $free = $holder->select("SELECT IS_FREE_LOCK('tamos_backup') AS b, IS_FREE_LOCK('tamos_migrate') AS m")[0];
        assertSame([1, 1], [(int) $free['b'], (int) $free['m']], 'both locks released');
        $restorer($keys)->restore($path);
        assertSame(3, $counts($db)['employees']);
    },

    'verification happens inside the transaction, before commit: a changed row, a changed money amount or an excluded row rolls back' => static function () use ($seed, $backup, $restorer, $counts, $empty): void {
        $db = authDatabase();
        $s = $seed($db);
        $keys = backupKeys();
        $path = $backup($keys);
        $changes = [
            'text' => static fn (Database $tx) => $tx->execute("UPDATE employees SET notes = 'x' WHERE id = ?", [$s['e1']]),
            'money by one cent' => static fn (Database $tx) => $tx->execute("UPDATE employees SET monthly_base_salary = '9999999999999.98' WHERE id = ?", [$s['e1']]),
            'an extra audit row' => static fn (Database $tx) => $tx->execute("INSERT INTO audit_events (company_id, occurred_at, actor_user_id, actor_membership_id, action, entity, entity_id, operation, target_user_id, request_id, fields) VALUES (?, UTC_TIMESTAMP(6), ?, ?, 'employee.update', 'employee', ?, NULL, NULL, ?, NULL)",
                [$s['ceo']['companyId'], $s['ceo']['userId'], $s['ceo']['membershipId'], $s['e1'], bin2hex(random_bytes(16))]),
            'an excluded row' => static fn (Database $tx) => $tx->execute('INSERT INTO auth_rate_limits (bucket, failures, window_started_at, locked_until) VALUES (?, 1, UTC_TIMESTAMP(6), NULL)', [hash('sha256', 'x')]),
            'the history' => static fn (Database $tx) => $tx->execute("UPDATE schema_migrations SET name = 'x' WHERE version = 1"),
        ];
        foreach ($changes as $label => $change) {
            $db = authDatabase();
            $e = assertThrows(\Throwable::class, static fn () => $restorer($keys, 'test', null, static function (string $stage, Database $tx) use ($change): void {
                if ($stage === 'imported') {
                    $change($tx);
                }
            })->restore($path), $label);
            assertTrue($e instanceof BackupError || $e instanceof MigrationError, $label . ': ' . $e::class);
            if ($e instanceof BackupError) {
                assertSame(BackupError::RESTORE_MISMATCH, $e->reason, $label);
            }
            assertSame($empty, $counts($db), 'rolled back: ' . $label);
        }
        $db = authDatabase();
        $outside = null;
        $restorer($keys, 'test', null, static function (string $stage) use (&$outside): void {
            if ($stage === 'verified') {
                $outside = (int) secondConnection()->select('SELECT COUNT(*) AS n FROM companies')[0]['n'];
            }
        })->restore($path);
        assertSame(0, $outside, 'verified while still uncommitted');
        assertSame(1, $counts($db)['companies']);
    },

    'after commit a fresh connection proves the target again; a change in that window is restore_unproven (exit 3), and verify-restore detects it' => static function () use ($seed, $backup, $restorer, $counts, $sourceFingerprint): void {
        $db = authDatabase();
        $s = $seed($db);
        $keys = backupKeys();
        $path = $backup($keys);
        $db = authDatabase();
        $e = assertThrows(BackupError::class, static fn () => $restorer($keys, 'test', null, static function (string $stage) use ($s): void {
            if ($stage === 'committed') {
                secondConnection()->execute("UPDATE employees SET notes = 'changed after commit' WHERE id = ?", [$s['e1']]);
            }
        })->restore($path));
        assertSame(BackupError::UNPROVEN, $e->reason);
        assertSame(3, $counts($db)['employees'], 'the restore was committed');
        assertSame(BackupError::RESTORE_MISMATCH, assertThrows(BackupError::class, static fn () => $restorer($keys)->verifyTarget($path))->reason);
        $db->execute("UPDATE employees SET notes = ? WHERE id = ?", ["Catatan ☕ \"kutipan\"\nbaris dua \\ / </script>", $s['e1']]);
        $evidence = $restorer($keys, 'test', null, null, $connections)->verifyTarget($path);
        assertSame(1, $connections);
        assertSame('test ' . substr($sourceFingerprint, 0, 16), $evidence['target']);

        // A commit whose outcome is unknown (the connection dies at commit) is never reported as rolled back.
        $db = authDatabase();
        $kill = static function (string $stage, Database $tx): void {
            if ($stage === 'verified') {
                $id = (int) $tx->select('SELECT CONNECTION_ID() AS id')[0]['id'];
                secondConnection()->execute('KILL CONNECTION ' . $id);
            }
        };
        assertSame(BackupError::UNPROVEN, assertThrows(BackupError::class, static fn () => $restorer($keys, 'test', null, $kill)->restore($path))->reason);
        assertSame(0, $counts($db)['employees'], 'here the server rolled it back — but the tool could not know');
    },

    'verify-restore is read-only and detects a changed, removed, added or excluded row' => static function () use ($seed, $backup, $restorer, $counts): void {
        $db = authDatabase();
        $s = $seed($db);
        $keys = backupKeys();
        $path = $backup($keys);
        $db = authDatabase();
        $restorer($keys)->restore($path);
        $before = $counts($db);
        $restorer($keys)->verifyTarget($path);
        assertSame($before, $counts($db), 'nothing written');
        $hash = (string) $db->select('SELECT password_hash AS h FROM users')[0]['h'];
        $removed = null;
        $mutations = [
            'a DATE' => ["UPDATE finance_executions SET executed_on = '2026-10-30'", "UPDATE finance_executions SET executed_on = '2026-10-31'"],
            'money' => ['UPDATE overtime_records SET approved_amount = approved_amount + 1 WHERE approved_amount = 21875', 'UPDATE overtime_records SET approved_amount = 21875 WHERE approved_amount = 21876'],
            'a credential' => ['UPDATE users SET password_hash = NULL', static fn (Database $d) => $d->execute('UPDATE users SET password_hash = ?', [$hash])],
            'a removed audit row' => [static function (Database $d) use (&$removed): void {
                $removed = $d->select('SELECT * FROM audit_events ORDER BY id DESC LIMIT 1')[0];
                $d->execute('DELETE FROM audit_events WHERE id = ?', [$removed['id']]);
            }, static function (Database $d) use (&$removed): void {
                $d->execute('INSERT INTO audit_events (`' . implode('`, `', array_keys($removed)) . '`) VALUES (' . implode(', ', array_fill(0, count($removed), '?')) . ')', array_values($removed));
            }],
            'an excluded row' => ["INSERT INTO auth_rate_limits (bucket, failures, window_started_at, locked_until) VALUES ('" . hash('sha256', 'y') . "', 1, UTC_TIMESTAMP(6), NULL)", 'DELETE FROM auth_rate_limits'],
        ];
        foreach ($mutations as $label => [$change, $undo]) {
            is_string($change) ? $db->execute($change) : $change($db);
            assertSame(BackupError::RESTORE_MISMATCH, assertThrows(BackupError::class, static fn () => $restorer($keys)->verifyTarget($path), $label)->reason, $label);
            is_string($undo) ? $db->execute($undo) : $undo($db);
            $restorer($keys)->verifyTarget($path);
        }
    },

    'schema and history drift refuse before anything is written: unmigrated, partly migrated, drifted history, an extra or changed column, a generated column made ordinary, an unclassified table' => static function () use ($seed, $backup, $restorer, $counts): void {
        $db = authDatabase();
        $seed($db);
        $keys = backupKeys();
        $path = $backup($keys);
        testDatabase();
        assertSame(MigrationError::HISTORY_MISSING, assertThrows(MigrationError::class, static fn () => $restorer($keys)->restore($path))->reason);
        $db = testDatabase();
        $first = [];
        foreach (array_slice(scandir(productionMigrationsDir()), 2, 33) as $file) {
            $first[$file] = (string) file_get_contents(productionMigrationsDir() . DIRECTORY_SEPARATOR . $file);
        }
        (new Migrator($db, migrationFixture($first)))->apply();
        assertSame(BackupError::SCHEMA_MISMATCH, assertThrows(BackupError::class, static fn () => $restorer($keys)->restore($path))->reason, 'partly migrated');
        $cases = [
            [MigrationError::class, MigrationError::SCHEMA_DRIFT, "UPDATE schema_migrations SET sha256 = REPEAT('0', 64) WHERE version = 1"],
            [BackupError::class, BackupError::SCHEMA_MISMATCH, 'ALTER TABLE companies ADD COLUMN extra INT NULL'],
            [BackupError::class, BackupError::SCHEMA_MISMATCH, 'ALTER TABLE employees MODIFY COLUMN notes VARCHAR(100) NULL'],
            [BackupError::class, BackupError::SCHEMA_MISMATCH, 'ALTER TABLE finance_executions MODIFY COLUMN amount DECIMAL(17,3) NOT NULL'],
            [BackupError::class, BackupError::SCHEMA_MISMATCH, 'ALTER TABLE payroll_plans MODIFY COLUMN live_key TINYINT UNSIGNED NULL'],
            [BackupError::class, BackupError::UNCLASSIFIED_TABLE, 'CREATE TABLE stray (id INT NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB'],
        ];
        foreach ($cases as [$class, $reason, $sql]) {
            $db = authDatabase();
            $db->execute($sql);
            assertSame($reason, assertThrows($class, static fn () => $restorer($keys)->restore($path), $sql)->reason, $sql);
            assertSame(0, array_sum($counts($db)), 'nothing written: ' . $sql);
        }
    },

    'concurrency: during the import other inserts wait, and a backup, a migration, another restore and verify-restore are refused; the restore then completes' => static function () use ($seed, $backup, $restorer, $counts, $sourceFingerprint): void {
        $db = authDatabase();
        $seed($db);
        $keys = backupKeys();
        $path = $backup($keys);
        $db = authDatabase();
        $seen = [];
        $restorer($keys, 'test', null, static function (string $stage) use (&$seen, $keys, $path, $restorer, $sourceFingerprint): void {
            if ($stage !== 'imported') {
                return;
            }
            $other = secondConnection();
            $other->execute('SET SESSION innodb_lock_wait_timeout = 1');
            foreach (["INSERT INTO companies (id, created_at) VALUES ('" . str_repeat('f', 32) . "', UTC_TIMESTAMP(6))", "INSERT INTO auth_rate_limits (bucket, failures, window_started_at, locked_until) VALUES ('" . hash('sha256', 'z') . "', 1, UTC_TIMESTAMP(6), NULL)"] as $sql) {
                $seen[] = assertThrows(DatabaseError::class, static fn () => $other->execute($sql))->driverCode;
            }
            $seen[] = assertThrows(BackupError::class, static fn () => (new BackupCreator(BackupReader::fromDatabase(secondConnection(), $sourceFingerprint), BackupStore::open(tempDir(), dirname(__DIR__, 2)), $keys['publicKey'], 'test', productionMigrationsDir()))->create())->reason;
            $seen[] = assertThrows(MigrationError::class, static fn () => (new Migrator(secondConnection(), productionMigrationsDir()))->status())->reason;
            $seen[] = assertThrows(BackupError::class, static fn () => $restorer($keys)->restore($path))->reason;
            $seen[] = assertThrows(BackupError::class, static fn () => $restorer($keys)->verifyTarget($path))->reason;
        })->restore($path);
        assertSame([1205, 1205, BackupError::BUSY, MigrationError::MIGRATION_BUSY, BackupError::BUSY, BackupError::RESTORE_MISMATCH], $seen);
        assertSame([1, 0], [$counts($db)['companies'], $counts($db)['auth_rate_limits']], 'only the restored company; the waiting inserts never landed');
    },

    'a killed restore process rolls back: the target is empty again and the next restore succeeds' => static function () use ($seed, $backup, $counts, $empty, $classified): void {
        $db = authDatabase();
        $seed($db, 30000);
        $keys = backupKeys();
        $path = $backup($keys);
        $db = authDatabase();
        $hostConfig = writeConfigFile(testConfig());
        $target = writeConfigFile(testDbConfig());
        $env = getenv();
        $env['TAMOS_CONFIG'] = $hostConfig;
        $cmd = [PHP_BINARY];
        if (php_ini_loaded_file() === false) {
            $cmd[] = '-n';
        }
        array_push($cmd, dirname(__DIR__, 2) . '/bin/backup.php', 'restore', '--file=' . $path, '--secret-key-file=' . $keys['keyFile'], '--target-config=' . $target);
        $proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $env);
        // The auto-increment counter is not transactional: it shows the uncommitted import advancing.
        $observer = secondConnection();
        $deadline = microtime(true) + 120;
        $next = 0;
        while (microtime(true) < $deadline && $next < 1000) {
            $next = (int) ($observer->select("SELECT AUTO_INCREMENT AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_events'")[0]['n'] ?? 0);
            usleep(20000);
        }
        assertTrue($next >= 1000, 'the restore was importing when it was killed');
        proc_terminate($proc, 9);
        foreach ($pipes as $pipe) {
            fclose($pipe);
        }
        proc_close($proc);
        // Locking reads wait for the dead transaction's rollback, so they see what really remains.
        $remaining = $observer->transaction(static function (Database $tx) use ($classified): array {
            $out = [];
            foreach ($classified as $table) {
                $out[$table] = (int) $tx->select('SELECT COUNT(*) AS n FROM `' . $table . '` LOCK IN SHARE MODE')[0]['n'];
            }
            return $out;
        });
        assertSame($empty, $remaining, 'the killed import rolled back');
        $run = runBackupCli(['restore', '--file=' . $path, '--secret-key-file=' . $keys['keyFile'], '--target-config=' . $target], $hostConfig);
        assertSame(0, $run['exit'], $run['stderr']);
        assertSame(30000, $counts($db)['auth_events']);
    },

    'production: only a production backup, only with the exact typed line — no confirmation, a wrong or padded one writes nothing' => static function () use ($seed, $backup, $restorer, $counts, $empty, $sourceFingerprint): void {
        $db = authDatabase();
        $seed($db);
        $keys = backupKeys();
        $testBackup = $backup($keys, 'test');
        $prodBackup = $backup($keys, 'production');
        $db = authDatabase();
        $asked = 0;
        $confirm = static function (array $identity) use (&$asked): string {
            $asked++;
            return $identity['phrase'];
        };
        assertSame(BackupError::SOURCE_ENV_MISMATCH, assertThrows(BackupError::class, static fn () => $restorer($keys, 'production', $confirm)->restore($testBackup))->reason);
        assertSame(0, $asked, 'refused before asking');
        $db->execute('INSERT INTO auth_rate_limits (bucket, failures, window_started_at, locked_until) VALUES (?, 1, UTC_TIMESTAMP(6), NULL)', [hash('sha256', 'occupied')]);
        assertSame(BackupError::TARGET_NOT_EMPTY, assertThrows(BackupError::class, static fn () => $restorer($keys, 'production', $confirm)->restore($prodBackup))->reason);
        assertSame(0, $asked, 'a non-empty target is refused before the operator is asked');
        $db->execute('DELETE FROM auth_rate_limits');
        $id = (string) BackupStore::idOfFileName(basename($prodBackup));
        $phrase = 'RESTORE ' . $id . ' INTO ' . substr($sourceFingerprint, 0, 16);
        foreach ([null, '', 'yes', $phrase . ' ', ' ' . $phrase, strtolower($phrase), 'RESTORE ' . $id . ' INTO ' . str_repeat('0', 16)] as $typed) {
            assertSame(BackupError::CONFIRMATION_REFUSED, assertThrows(BackupError::class, static fn () => $restorer($keys, 'production', static fn (): ?string => $typed)->restore($prodBackup))->reason, (string) $typed);
            assertSame($empty, $counts($db));
        }
        assertSame(BackupError::CONFIRMATION_REFUSED, assertThrows(BackupError::class, static fn () => $restorer($keys, 'production')->restore($prodBackup))->reason, 'no confirmation channel');
        $shown = [];
        $restorer($keys, 'production', static function (array $identity) use (&$shown, $phrase): string {
            $shown = $identity;
            return $phrase;
        })->restore($prodBackup);
        assertSame($phrase, $shown['phrase']);
        assertSame(['backup', 'key', 'source', 'target', 'schema', 'phrase'], array_keys($shown));
        assertSame(3, $counts($db)['employees']);
    },

    'the CLI end to end: restore, a second restore refused, verify-restore, the production confirmation over standard input, and no secret or business value in any output' => static function () use ($seed, $backup, $counts, $empty): void {
        $db = authDatabase();
        $seed($db);
        $keys = backupKeys();
        $path = $backup($keys, 'production');
        $db = authDatabase();
        $hostConfig = writeConfigFile(testConfig(['env' => 'development']));
        $base = testDbConfig();
        $target = writeConfigFile($base);
        $args = ['--file=' . $path, '--secret-key-file=' . $keys['keyFile'], '--target-config=' . $target];
        $run = runBackupCli(['restore', ...$args], $hostConfig);
        assertSame(0, $run['exit'], $run['stderr']);
        $id = (string) BackupStore::idOfFileName(basename($path));
        $fingerprint = substr(BackupReader::fingerprint((string) $base->db['host'], (int) $base->db['port'], (string) $base->db['name']), 0, 16);
        assertTrue(preg_match('/^restore: PASS\nbackup: ' . preg_quote($id, '/') . '\nmanifest: [0-9a-f]{64}\nkey: [0-9a-f]{16}\nsource: production [0-9a-f]{16}\ntarget: test ' . $fingerprint
            . '\nschema: backup head 35, target head 35, code head 35\n(table: [a-z_]+ rows [0-9]+ ok\n){13}tables: 13 verified, rows [0-9]+\ndecimal totals: matched \([0-9]+ columns\)\nexcluded: 4 empty\nverified: in-transaction yes, post-commit yes\nstarted: [0-9T:-]+Z\nfinished: [0-9T:-]+Z\nduration_ms: [0-9]+\n$/D', $run['stdout']) === 1, $run['stdout']);
        assertSame('', $run['stderr']);
        $again = runBackupCli(['restore', ...$args], $hostConfig);
        assertSame([1, '', "restore: target_not_empty\n"], [$again['exit'], $again['stdout'], $again['stderr']]);
        $check = runBackupCli(['verify-restore', ...$args], $hostConfig);
        assertSame(0, $check['exit'], $check['stderr']);
        assertTrue(str_starts_with($check['stdout'], "verify-restore: PASS\n") && str_contains($check['stdout'], "verified: target snapshot yes\n"), $check['stdout']);

        $production = writeConfigFile(testConfig(['env' => 'production', 'origin' => 'https://finance.example.test', 'db' => $base->db]));
        $prodArgs = ['--file=' . $path, '--secret-key-file=' . $keys['keyFile'], '--target-config=' . $production];
        $phrase = 'RESTORE ' . $id . ' INTO ' . $fingerprint;
        $outputs = [];
        foreach (['' => "restore: confirmation_refused\n", "yes\n" => "restore: confirmation_refused\n", $phrase . " \n" => "restore: confirmation_refused\n"] as $stdin => $error) {
            $db = authDatabase();
            $refused = runBackupCli(['restore', ...$prodArgs], $hostConfig, $stdin);
            assertSame([1, ''], [$refused['exit'], $refused['stdout']]);
            assertTrue(str_ends_with($refused['stderr'], $error) && str_contains($refused['stderr'], 'type exactly: ' . $phrase . "\n"), $refused['stderr']);
            assertSame($empty, $counts($db));
            $outputs[] = $refused;
        }
        $ok = runBackupCli(['restore', ...$prodArgs], $hostConfig, $phrase . "\n");
        assertSame(0, $ok['exit'], $ok['stderr']);
        assertTrue(str_contains($ok['stdout'], "target: production " . $fingerprint . "\n"), $ok['stdout']);
        assertTrue(str_starts_with($ok['stderr'], "restore into a PRODUCTION database\nbackup: " . $id . "\n"), $ok['stderr']);

        $onHost = runBackupCli(['restore', ...$args], $production);
        assertSame([1, '', "restore: refused_on_production_host\n"], [$onHost['exit'], $onHost['stdout'], $onHost['stderr']]);
        $onHost = runBackupCli(['verify-restore', ...$args], $production);
        assertSame([1, "verify-restore: refused_on_production_host\n"], [$onHost['exit'], $onHost['stderr']]);

        $secrets = [(string) $base->db['pass'], $path, $keys['keyFile'], dirname($path), $keys['publicKeyBase64'], '9999999999999.99', 'Catatan', '3521875', (string) $base->db['name']];
        foreach ([$run, $again, $check, $ok, ...$outputs] as $r) {
            foreach ($secrets as $secret) {
                assertTrue(!str_contains($r['stdout'] . $r['stderr'], $secret), 'output leaks a secret, path or business value');
            }
        }
    },
];
