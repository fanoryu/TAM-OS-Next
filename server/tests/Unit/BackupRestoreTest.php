<?php
declare(strict_types=1);

use TamOs\Data\Backup\RestoreWriter;
use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Data\Migration\MigrationSet;
use TamOs\Ops\BackupCipher;
use TamOs\Ops\BackupError;
use TamOs\Ops\BackupFormat;
use TamOs\Ops\BackupParser;
use TamOs\Ops\BackupRestorer;
use TamOs\Ops\BackupStore;
use TamOs\Ops\BackupTables;
use TamOs\Ops\BackupVerifier;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\backupKeys;
use function TamOs\Tests\fail;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\resealSidecar;
use function TamOs\Tests\runBackupCli;
use function TamOs\Tests\syntheticBackup;
use function TamOs\Tests\syntheticTables;
use function TamOs\Tests\tempDir;
use function TamOs\Tests\testConfig;
use function TamOs\Tests\writeConfigFile;

/**
 * OPS-2 without a database: the replay that feeds a restore (the same verifier and parser, run again
 * from the first byte), the migration-history compatibility rule, the order "verify completely, then
 * touch the target", the production confirmation phrase, RestoreWriter's closed write surface, and
 * the restore CLI's usage, host refusal and output. The MariaDB behaviour is in Db/BackupRestoreTest.
 */

/** A target that must never be contacted: any connection attempt fails the test. */
$untouchable = static function (array $keys, string $env = 'test'): BackupRestorer {
    return new BackupRestorer(new BackupVerifier($keys['secretKey']), static function (): RestoreWriter {
        fail('the target was contacted before the backup was verified');
    }, $env, str_repeat('e', 64), productionMigrationsDir());
};

/** A Database handle that is never opened (an unreachable, unused configuration). */
$closedDatabase = static fn (): Database => new Database(DatabaseConfig::fromArray(['host' => '127.0.0.1', 'port' => 1, 'name' => 'never_test', 'user' => 'never', 'pass' => 'never']));

/** The manifest of the code's own migrations, as a backup at head would record it. */
$atHead = static function (): array {
    $migrations = array_map(static fn ($m): array => ['version' => $m->version, 'name' => $m->name, 'sha256' => $m->sha256], MigrationSet::load(productionMigrationsDir()));
    return ['schema' => ['databaseHead' => count($migrations), 'codeHead' => count($migrations), 'migrations' => $migrations]];
};

return [
    'replay hands every table header and row to the sinks, as backed up, and requires the manifest verify() returned' => static function (): void {
        $keys = backupKeys();
        $tables = syntheticTables(3);
        $path = syntheticBackup(tempDir(), $keys['publicKey'], $tables);
        $verifier = new BackupVerifier($keys['secretKey']);
        $manifest = $verifier->verify($path);
        $headers = [];
        $rows = [];
        $verifier->replay($path, $manifest, static function (string $table, array $columns) use (&$headers): void {
            $headers[$table] = $columns;
        }, static function (string $table, array $row) use (&$rows): void {
            $rows[$table][] = $row;
        });
        assertSame(array_map(static fn (array $t): array => $t['columns'], $tables), array_intersect_key($headers, $tables));
        foreach ($tables as $name => $t) {
            assertSame(array_map(static fn (array $r): array => array_combine($t['columns'], $r), $t['rows']), $rows[$name], $name);
        }
        $other = $manifest;
        $other['snapshotAt'] = '2000-01-01 00:00:00.000000';
        assertSame(BackupError::MANIFEST_MISMATCH, assertThrows(BackupError::class, static fn () => $verifier->replay($path, $other, static function (): void {
        }, static function (): void {
        }))->reason, 'a manifest other than the verified one');
    },

    'replay refuses a file changed after verify: tampered, truncated, extended or re-sealed under the same id with another manifest' => static function (): void {
        $keys = backupKeys();
        $path = syntheticBackup(tempDir(), $keys['publicKey'], syntheticTables(2));
        $verifier = new BackupVerifier($keys['secretKey']);
        $manifest = $verifier->verify($path);
        $pristine = (string) file_get_contents($path);
        $none = static function (): void {
        };
        $cases = [
            BackupError::TAMPERED => substr($pristine, 0, -5) . chr(ord($pristine[strlen($pristine) - 5]) ^ 1) . substr($pristine, -4),
            BackupError::TRUNCATED => substr($pristine, 0, -3),
        ];
        foreach ($cases as $reason => $bytes) {
            file_put_contents($path, $bytes);
            resealSidecar($path);
            assertSame($reason, assertThrows(BackupError::class, static fn () => $verifier->replay($path, $manifest, $none, $none))->reason, $reason);
        }
        file_put_contents($path, $pristine . 'x');
        resealSidecar($path);
        assertSame(BackupError::TRUNCATED, assertThrows(BackupError::class, static fn () => $verifier->replay($path, $manifest, $none, $none))->reason, 'bytes after the final frame');

        // Same id, same rows, a different manifest: every row is handed over, then the replay refuses.
        file_put_contents($path, $pristine);
        resealSidecar($path);
        $plain = '';
        $in = fopen($path, 'rb');
        BackupCipher::open($in, $keys['secretKey'], static function (string $p) use (&$plain): void {
            $plain .= $p;
        });
        fclose($in);
        $id = (string) BackupStore::idOfFileName(basename($path));
        $dir = tempDir();
        $store = BackupStore::open($dir, dirname(__DIR__, 2));
        [$handle, $temp] = $store->createTemporary($id);
        $cipher = BackupCipher::seal($handle, $id, $keys['publicKey']);
        $cipher->write(preg_replace('/"snapshotAt":"[^"]*"/', '"snapshotAt":"2000-01-01 00:00:00.000000"', $plain));
        $forged = $store->finalize($handle, $temp, $id, $cipher->finish()['sha256']);
        $handed = 0;
        $count = static function () use (&$handed): void {
            $handed++;
        };
        assertSame(BackupError::MANIFEST_MISMATCH, assertThrows(BackupError::class, static fn () => $verifier->replay($forged, $manifest, $none, $count))->reason);
        assertSame(8, $handed, 'every row was handed over before the refusal — the restore must roll them back');
    },

    'the parser hands a row to the sink only after all of its checks pass' => static function (): void {
        $out = '';
        $format = new BackupFormat(static function (string $line) use (&$out): void {
            $out .= $line;
        });
        $format->begin('20261007T010000Z-00000abc');
        $format->beginTable('finance_executions', ['id', 'amount'], ['amount' => 2], hash('sha256', 'x'));
        $format->row(['id' => str_repeat('1', 32), 'amount' => '1.00']);
        $format->row(['id' => str_repeat('2', 32), 'amount' => '2.00']);
        $format->endTable();
        $bad = str_replace('"2.00"', '"2.0"', $out);    // the second row's DECIMAL loses its scale
        $rows = [];
        $parser = new BackupParser([], null, static function (string $table, array $row) use (&$rows): void {
            $rows[] = $row;
        });
        assertSame(BackupError::MALFORMED, assertThrows(BackupError::class, static fn () => $parser->feed($bad))->reason);
        assertSame([['id' => str_repeat('1', 32), 'amount' => '1.00']], $rows, 'only the row that passed');
        $descending = str_replace(str_repeat('2', 32), str_repeat('0', 32), $out);
        $rows = [];
        $parser = new BackupParser([], null, static function (string $table, array $row) use (&$rows): void {
            $rows[] = $row;
        });
        assertThrows(BackupError::class, static fn () => $parser->feed($descending));
        assertSame(1, count($rows), 'a descending id is never handed over');
    },

    'compatibility: the backup history must be exactly the code migrations — no lower or higher head, no renamed or changed migration' => static function () use ($atHead): void {
        $set = MigrationSet::load(productionMigrationsDir());
        $manifest = $atHead();
        assertSame(count($set), BackupRestorer::requireCompatible($manifest, $set));
        $cases = [];
        $lower = $manifest;
        array_pop($lower['schema']['migrations']);
        $lower['schema']['databaseHead']--;
        $cases['a pre-migration backup (lower head)'] = $lower;
        $higher = $manifest;
        $higher['schema']['migrations'][] = ['version' => count($set) + 1, 'name' => 'future', 'sha256' => str_repeat('0', 64)];
        $higher['schema']['databaseHead']++;
        $cases['a backup from newer code (higher head)'] = $higher;
        $renamed = $manifest;
        $renamed['schema']['migrations'][4]['name'] = 'renamed';
        $cases['a renamed migration'] = $renamed;
        $changed = $manifest;
        $changed['schema']['migrations'][0]['sha256'] = str_repeat('0', 64);
        $cases['a changed migration'] = $changed;
        $head = $manifest;
        $head['schema']['databaseHead']--;
        $cases['a head that disagrees with the history'] = $head;
        foreach ($cases as $label => $m) {
            assertSame(BackupError::SCHEMA_MISMATCH, assertThrows(BackupError::class, static fn () => BackupRestorer::requireCompatible($m, $set), $label)->reason, $label);
        }
    },

    'the whole backup is verified before the target is contacted: a damaged, foreign-key or incompatible backup is refused without a connection' => static function () use ($untouchable): void {
        $keys = backupKeys();
        $path = syntheticBackup(tempDir(), $keys['publicKey'], syntheticTables());
        foreach (['restore', 'verifyTarget'] as $method) {
            assertSame(BackupError::SCHEMA_MISMATCH, assertThrows(BackupError::class, static fn () => $untouchable($keys)->{$method}($path))->reason, 'head 1 against code head 35: ' . $method);
            assertSame(BackupError::WRONG_KEY, assertThrows(BackupError::class, static fn () => $untouchable(backupKeys())->{$method}($path))->reason, $method);
        }
        assertSame(BackupError::SCHEMA_MISMATCH, assertThrows(BackupError::class, static fn () => $untouchable($keys, 'production')->restore($path))->reason, 'production too');
        file_put_contents($path, 'x', FILE_APPEND);
        assertSame(BackupError::DIGEST_MISMATCH, assertThrows(BackupError::class, static fn () => $untouchable($keys)->restore($path))->reason);
        resealSidecar($path);
        assertSame(BackupError::TRUNCATED, assertThrows(BackupError::class, static fn () => $untouchable($keys)->restore($path))->reason);
    },

    'the production confirmation phrase names the backup id and the first 16 hex of the target fingerprint' => static function (): void {
        assertSame('RESTORE 20261007T010000Z-00000abc INTO 0123456789abcdef', BackupRestorer::confirmationPhrase('20261007T010000Z-00000abc', '0123456789abcdef' . str_repeat('f', 48)));
    },

    'RestoreWriter: one plain INSERT per backed-up table, none for an excluded table; a row must carry exactly the table columns' => static function () use ($closedDatabase): void {
        RestoreWriter::requireCoverage();
        assertSame(BackupTables::INCLUDED, array_keys(RestoreWriter::COLUMNS));
        $writer = new RestoreWriter($closedDatabase());
        foreach ([...BackupTables::EXCLUDED, BackupTables::HISTORY, 'stray'] as $table) {
            assertThrows(\LogicException::class, static fn () => $writer->insert($table, ['id' => 1]), $table);
        }
        $row = array_fill_keys(RestoreWriter::COLUMNS['payroll_plans'], 'x') + ['live_key' => 1];
        $missing = $row;
        unset($missing['version']);
        assertThrows(\LogicException::class, static fn () => $writer->insert('payroll_plans', $missing), 'a missing column');
        assertThrows(\LogicException::class, static fn () => $writer->insert('payroll_plans', $row + ['extra' => 1]), 'an extra column');
        $withoutGenerated = $row;
        unset($withoutGenerated['live_key']);
        assertThrows(\LogicException::class, static fn () => $writer->insert('payroll_plans', $withoutGenerated), 'the generated column belongs to the backed-up row');
        $sql = (new \ReflectionClassConstant(RestoreWriter::class, 'INSERT_SQL'))->getValue();
        foreach ($sql as $table => $statement) {
            $columns = RestoreWriter::COLUMNS[$table];
            assertSame('INSERT INTO ' . $table . ' (' . implode(', ', $columns) . ') VALUES (:' . implode(', :', $columns) . ')', $statement, $table);
            foreach (RestoreWriter::GENERATED[$table] ?? [] as $generated) {
                assertTrue(!str_contains($statement, $generated), 'a generated column is never inserted: ' . $table);
            }
        }
    },

    'CLI usage: restore and verify-restore need exactly file, secret key and target config; --yes, --force and any other option exit 2' => static function (): void {
        $base = ['--file=a', '--secret-key-file=b', '--target-config=c'];
        foreach ([['restore'], ['restore', '--file=a', '--secret-key-file=b'], ['restore', ...$base, '--yes'], ['restore', ...$base, '--force'], ['restore', ...$base, '--yes=1'],
            ['restore', ...$base, '--force=1'], ['restore', ...$base, '--confirm=x'], ['restore', ...$base, '--target-config=d'], ['verify-restore', ...$base, '--previous=x'],
            ['verify-restore', '--file=a', '--target-config=c'], ['restore', ...$base, 'extra']] as $args) {
            $run = runBackupCli($args, null);
            assertSame(2, $run['exit'], implode(' ', $args));
            assertTrue(str_starts_with($run['stderr'], 'usage:'), 'usage text');
            assertSame('', $run['stdout']);
        }
    },

    'CLI: restore and verify-restore refuse on the production host before reading anything; a missing target configuration is refused; a damaged backup never reaches the target' => static function (): void {
        $keys = backupKeys();
        $path = syntheticBackup(tempDir(), $keys['publicKey'], syntheticTables());
        $production = writeConfigFile(testConfig(['env' => 'production', 'origin' => 'https://finance.example.test']));
        $unreachable = writeConfigFile(testConfig(['db' => ['host' => '127.0.0.1', 'port' => 1, 'name' => 'never_test', 'user' => 'never', 'pass' => 'never-a-secret']]));
        foreach (['restore', 'verify-restore'] as $command) {
            $run = runBackupCli([$command, '--file=' . $path, '--secret-key-file=' . $keys['keyFile'], '--target-config=' . $unreachable], $production);
            assertSame([1, '', $command . ": refused_on_production_host\n"], [$run['exit'], $run['stdout'], $run['stderr']]);
            $run = runBackupCli([$command, '--file=' . $path, '--secret-key-file=' . $keys['keyFile'], '--target-config=' . $unreachable . '.missing'], null);
            assertSame([1, '', "configuration rejected: missing\n"], [$run['exit'], $run['stdout'], $run['stderr']]);
            $run = runBackupCli([$command, '--file=' . $path, '--secret-key-file=' . $keys['keyFile'], '--target-config=' . $unreachable], null);
            assertSame([1, '', $command . ": schema_mismatch\n"], [$run['exit'], $run['stdout'], $run['stderr']], 'refused before the (unreachable) database');
        }
        file_put_contents($path, 'x', FILE_APPEND);
        $run = runBackupCli(['restore', '--file=' . $path, '--secret-key-file=' . $keys['keyFile'], '--target-config=' . $unreachable], null);
        assertSame([1, "restore: digest_mismatch\n"], [$run['exit'], $run['stderr']]);
        foreach ([$path, $keys['keyFile'], $unreachable, 'never-a-secret'] as $secret) {
            assertTrue(!str_contains($run['stdout'] . $run['stderr'], $secret), 'no path or credential in the output');
        }
    },
];
