<?php
declare(strict_types=1);

use TamOs\Config\ConfigLoader;
use TamOs\Ops\BackupCipher;
use TamOs\Ops\BackupConfig;
use TamOs\Ops\BackupError;
use TamOs\Ops\BackupStore;
use TamOs\Ops\BackupTables;
use TamOs\Ops\BackupVerifier;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\backupKeys;
use function TamOs\Tests\resealSidecar;
use function TamOs\Tests\syntheticBackup;
use function TamOs\Tests\syntheticTables;
use function TamOs\Tests\tempDir;
use function TamOs\Tests\testConfig;

/**
 * OPS-1: the encrypted backup file, the host directory and off-host verification — without a
 * database. Every damaged, forged, truncated, renamed or wrongly keyed file is refused.
 */

$verifyReason = static function (string $secretKey, string $path, ?string $previous = null): string {
    return assertThrows(BackupError::class, static fn () => (new BackupVerifier($secretKey))->verify($path, $previous))->reason;
};

return [
    'the backup section: exactly dir and a 32-byte base64 public key; the API config only keeps dir out of the web root' => static function (): void {
        $keys = backupKeys();
        $ok = static fn (mixed $backup) => BackupConfig::fromConfig(testConfig(['backup' => $backup]));
        $c = $ok(['dir' => '/srv/tamos-backups', 'public_key' => $keys['publicKeyBase64']]);
        assertSame($keys['publicKey'], $c->publicKey);
        assertTrue(!str_contains(print_r($c, true), '/srv/tamos-backups'), 'a dump hides the directory');
        foreach ([
            null, [], ['dir' => '/srv/b'], ['public_key' => $keys['publicKeyBase64'], 'dir' => '/srv/b'],
            ['dir' => '/srv/b', 'public_key' => $keys['publicKeyBase64'], 'keep' => 7], ['dir' => 'relative/b', 'public_key' => $keys['publicKeyBase64']],
            ['dir' => '/CHANGE_ME/b', 'public_key' => $keys['publicKeyBase64']], ['dir' => '/srv/b', 'public_key' => 'CHANGE_ME'],
            ['dir' => '/srv/b', 'public_key' => base64_encode(random_bytes(31))], ['dir' => '/srv/b', 'public_key' => rtrim($keys['publicKeyBase64'], '=')],
            ['dir' => "/srv/b\0", 'public_key' => $keys['publicKeyBase64']], ['dir' => 7, 'public_key' => $keys['publicKeyBase64']],
        ] as $i => $bad) {
            assertSame(BackupError::CONFIG, assertThrows(BackupError::class, static fn () => $ok($bad), 'case ' . $i)->reason, 'case ' . $i);
        }
        $root = tempDir();
        $config = ['env' => 'test', 'origin' => 'https://tamos.test', 'log_path' => tempDir() . '/api.log'];
        assertSame('backup_inside_document_root', assertThrows(\TamOs\Config\ConfigError::class, static fn () => ConfigLoader::fromArray($config + ['backup' => ['dir' => $root . '/backups', 'public_key' => 'x']], $root))->reason);
        assertSame('invalid_backup', assertThrows(\TamOs\Config\ConfigError::class, static fn () => ConfigLoader::fromArray($config + ['backup' => 'x']))->reason);
        assertSame(null, ConfigLoader::fromArray($config)->backup, 'the section stays optional');
    },

    'a backup round-trips: create, finalize with its sidecar, and verify with the off-host key' => static function (): void {
        $keys = backupKeys();
        $dir = tempDir();
        $path = syntheticBackup($dir, $keys['publicKey'], syntheticTables());
        assertTrue(is_file($path) && is_file($path . '.sha256'), 'backup and sidecar exist');
        assertSame(hash_file('sha256', $path) . '  ' . basename($path) . "\n", file_get_contents($path . '.sha256'), 'sha256sum format');
        $m = (new BackupVerifier($keys['secretKey']))->verify($path);
        assertSame(['companies', 'auth_events', 'audit_events', 'finance_executions'], array_column($m['tables'], 'name'));
        assertSame(['amount' => '100000001500000.00'], $m['tables'][3]['decimalTotals']);
        assertSame(BackupTables::EXCLUDED, $m['excludedTables']);
        assertSame([], array_values(array_filter(scandir($dir), static fn ($f) => str_ends_with($f, '.tmp'))), 'no work in progress left');
    },

    'the ciphertext reveals no row value, and two backups of the same content differ (fresh key, fresh nonce)' => static function (): void {
        $keys = backupKeys();
        $dir = tempDir();
        $a = syntheticBackup($dir, $keys['publicKey'], syntheticTables(), '2026-10-07 01:00:00.000001');
        $b = syntheticBackup($dir, $keys['publicKey'], syntheticTables(), '2026-10-07 01:00:00.000002');
        $bytes = file_get_contents($a);
        foreach (['1500000.00', 'login_success', 'employee.update', 'Café', 'finance_executions', 'tamos-backup"'] as $value) {
            assertTrue(!str_contains($bytes, $value), 'ciphertext leaks ' . $value);
        }
        assertTrue(substr($bytes, 41) !== substr((string) file_get_contents($b), 41), 'sealed key and stream differ');
    },

    'a modified, truncated or extended file is refused, never partially trusted' => static function () use ($verifyReason): void {
        $keys = backupKeys();
        $fresh = static fn (): string => syntheticBackup(tempDir(), $keys['publicKey'], syntheticTables(300));
        $path = $fresh();
        $bytes = (string) file_get_contents($path);
        file_put_contents($path, substr($bytes, 0, 200) . chr(ord($bytes[200]) ^ 1) . substr($bytes, 201));
        assertSame(BackupError::DIGEST_MISMATCH, $verifyReason($keys['secretKey'], $path), 'the sidecar catches any change');
        resealSidecar($path);
        assertSame(BackupError::TAMPERED, $verifyReason($keys['secretKey'], $path), 'the cipher catches it even with a forged sidecar');

        $path = $fresh();
        $bytes = (string) file_get_contents($path);
        foreach ([strlen($bytes) - 1, strlen($bytes) - 30, BackupCipher::HEADER_LENGTH + 2, BackupCipher::HEADER_LENGTH] as $cut) {
            file_put_contents($path, substr($bytes, 0, $cut));
            resealSidecar($path);
            assertSame(BackupError::TRUNCATED, $verifyReason($keys['secretKey'], $path), 'truncated at ' . $cut);
        }
        file_put_contents($path, $bytes . "\0");
        resealSidecar($path);
        assertSame(BackupError::TRUNCATED, $verifyReason($keys['secretKey'], $path), 'bytes after the final frame');
        file_put_contents($path, substr($bytes, 0, 50));
        resealSidecar($path);
        assertSame(BackupError::MALFORMED, $verifyReason($keys['secretKey'], $path), 'shorter than a header');
    },

    'the header is authenticated: a changed id or key fingerprint is refused' => static function () use ($verifyReason): void {
        $keys = backupKeys();
        $path = syntheticBackup(tempDir(), $keys['publicKey'], syntheticTables());
        $bytes = (string) file_get_contents($path);
        // Another id of the same shape, with the file renamed to match: the frames no longer authenticate.
        $other = substr($bytes, 8, 24) . (substr($bytes, 32, 1) === 'a' ? 'b' : 'a');
        $renamed = dirname($path) . '/tamos-backup-' . $other . '.tamosbk';
        file_put_contents($renamed, substr($bytes, 0, 8) . $other . substr($bytes, 33));
        resealSidecar($renamed);
        assertSame(BackupError::TAMPERED, $verifyReason($keys['secretKey'], $renamed));
        // A renamed file whose header still names the original id.
        $moved = dirname($path) . '/tamos-backup-' . $other . '.tamosbk';
        file_put_contents($moved, $bytes);
        resealSidecar($moved);
        assertSame(BackupError::NAME_MISMATCH, $verifyReason($keys['secretKey'], $moved));
        // A forged fingerprint.
        file_put_contents($path, substr($bytes, 0, 33) . str_repeat("\0", 8) . substr($bytes, 41));
        resealSidecar($path);
        assertSame(BackupError::WRONG_KEY, $verifyReason($keys['secretKey'], $path));
    },

    'only the matching secret key opens a backup; key files are checked' => static function () use ($verifyReason): void {
        $keys = backupKeys();
        $path = syntheticBackup(tempDir(), $keys['publicKey'], syntheticTables());
        assertSame(BackupError::WRONG_KEY, $verifyReason(backupKeys()['secretKey'], $path));
        foreach (['', "TAMOS-BACKUP-SECRET-KEY-V1\n", 'TAMOS-BACKUP-SECRET-KEY-V1' . "\n" . base64_encode(random_bytes(32)), "TAMOS-BACKUP-SECRET-KEY-V2\n" . base64_encode(random_bytes(32)) . "\n", base64_encode(random_bytes(32)) . "\n"] as $i => $bad) {
            $file = tempDir() . '/k';
            file_put_contents($file, $bad);
            assertSame(BackupError::KEY_FILE, assertThrows(BackupError::class, static fn () => BackupCipher::readSecretKeyFile($file))->reason, 'key file ' . $i);
        }
        assertSame(BackupError::KEY_FILE, assertThrows(BackupError::class, static fn () => BackupCipher::readSecretKeyFile(tempDir() . '/missing'))->reason);
    },

    'a missing or wrong sidecar, or a foreign file name, is refused before decryption' => static function () use ($verifyReason): void {
        $keys = backupKeys();
        $path = syntheticBackup(tempDir(), $keys['publicKey'], syntheticTables());
        file_put_contents($path . '.sha256', hash_file('sha256', $path) . '  other.tamosbk' . "\n");
        assertSame(BackupError::SIDECAR, $verifyReason($keys['secretKey'], $path));
        unlink($path . '.sha256');
        assertSame(BackupError::SIDECAR, $verifyReason($keys['secretKey'], $path));
        $foreign = dirname($path) . '/backup.bin';
        copy($path, $foreign);
        assertSame(BackupError::NAME_MISMATCH, $verifyReason($keys['secretKey'], $foreign));
    },

    'an incoherent manifest is refused: tables, excluded list, history and source' => static function () use ($verifyReason): void {
        $keys = backupKeys();
        $cases = [
            'excluded' => ['excludedTables' => ['sessions']],
            'absent list' => ['absentTables' => ['users']],
            'history' => ['schema' => ['databaseHead' => 2, 'codeHead' => 2, 'migrations' => [['version' => 1, 'name' => 'a', 'sha256' => str_repeat('0', 64)]]]],
            'head above code' => ['schema' => ['databaseHead' => 1, 'codeHead' => 0, 'migrations' => [['version' => 1, 'name' => 'a', 'sha256' => str_repeat('0', 64)]]]],
            'source' => ['source' => ['env' => 'test']],
            'fingerprint' => ['keyFingerprint' => str_repeat('0', 16)],
        ];
        foreach ($cases as $name => $meta) {
            $path = syntheticBackup(tempDir(), $keys['publicKey'], syntheticTables(), '2026-10-07 01:00:00.000000', null, $meta);
            assertSame(BackupError::MANIFEST_MISMATCH, $verifyReason($keys['secretKey'], $path), $name);
        }
        // A backed-up table out of the classified order.
        $tables = syntheticTables();
        $path = syntheticBackup(tempDir(), $keys['publicKey'], ['audit_events' => $tables['audit_events']], '2026-10-07 01:00:00.000000', static function (string $line): string {
            return str_replace('"absentTables":["companies",', '"absentTables":[', $line);
        });
        assertSame(BackupError::MANIFEST_MISMATCH, $verifyReason($keys['secretKey'], $path), 'a table neither present nor absent');
    },

    'continuity with --previous: appended rows pass; an older row rewritten or removed is refused' => static function () use ($verifyReason): void {
        $keys = backupKeys();
        $dir = tempDir();
        $older = syntheticBackup($dir, $keys['publicKey'], syntheticTables(2), '2026-10-06 01:00:00.000000');
        $newer = syntheticBackup($dir, $keys['publicKey'], syntheticTables(5), '2026-10-07 01:00:00.000000');
        $m = (new BackupVerifier($keys['secretKey']))->verify($newer, $older);
        assertSame(5, $m['tables'][2]['rows']);
        assertSame(BackupError::PREVIOUS_MISMATCH, $verifyReason($keys['secretKey'], $older, $newer), 'the previous backup must be older');
        assertSame(BackupError::PREVIOUS_MISMATCH, $verifyReason($keys['secretKey'], $newer, $newer), 'not itself');

        $tables = syntheticTables(5);
        $tables['audit_events']['rows'][1][3] = 'rewritten';
        $rewritten = syntheticBackup($dir, $keys['publicKey'], $tables, '2026-10-08 01:00:00.000000');
        assertSame(BackupError::CONTINUITY_BROKEN, $verifyReason($keys['secretKey'], $rewritten, $older));
        $tables = syntheticTables(5);
        unset($tables['audit_events']['rows'][0]);
        $tables['audit_events']['rows'] = array_values($tables['audit_events']['rows']);
        $deleted = syntheticBackup($dir, $keys['publicKey'], $tables, '2026-10-09 01:00:00.000000');
        assertSame(BackupError::CONTINUITY_BROKEN, $verifyReason($keys['secretKey'], $deleted, $older));
        $tables = syntheticTables(5);
        $tables['auth_events']['rows'] = [[2, 'logout']];
        $authDeleted = syntheticBackup($dir, $keys['publicKey'], $tables, '2026-10-10 01:00:00.000000');
        assertSame(BackupError::CONTINUITY_BROKEN, $verifyReason($keys['secretKey'], $authDeleted, $older), 'auth_events is append-only too');

        $other = syntheticBackup($dir, $keys['publicKey'], syntheticTables(5), '2026-10-11 01:00:00.000000', null, ['source' => ['env' => 'test', 'databaseFingerprint' => hash('sha256', 'another-database')]]);
        assertSame(BackupError::PREVIOUS_MISMATCH, $verifyReason($keys['secretKey'], $other, $older), 'another database');
        // A damaged previous backup is refused like any other.
        file_put_contents($older, 'x', FILE_APPEND);
        assertSame(BackupError::DIGEST_MISMATCH, $verifyReason($keys['secretKey'], $newer, $older));
    },

    'the store: retention keeps the newest 7, deletes only its own names, never the backup just made' => static function (): void {
        $keys = backupKeys();
        $dir = tempDir();
        $paths = [];
        for ($day = 1; $day <= 9; $day++) {
            $paths[] = syntheticBackup($dir, $keys['publicKey'], syntheticTables(), sprintf('2026-10-%02d 01:00:00.000000', $day));
        }
        foreach (['notes.txt', 'tamos-backup-old.tamosbk', 'tamos-backup-20261001T010000Z-00000000.tamosbk.bak', '.tamos-backup-x.tmp'] as $decoy) {
            file_put_contents($dir . '/' . $decoy, 'keep');
        }
        file_put_contents($dir . '/tamos-backup-20260901T010000Z-00000000.tamosbk.sha256', 'orphan');
        $store = BackupStore::open($dir, dirname(__DIR__, 2));
        $newest = BackupStore::idOfFileName(basename($paths[8]));
        assertSame(2, $store->prune($newest));
        assertSame(array_map(static fn ($p) => BackupStore::idOfFileName(basename($p)), array_reverse(array_slice($paths, 2))), $store->ids());
        assertTrue(!is_file($paths[0]) && !is_file($paths[0] . '.sha256') && !is_file($paths[1]), 'the two oldest are gone');
        foreach (['notes.txt', 'tamos-backup-old.tamosbk', 'tamos-backup-20261001T010000Z-00000000.tamosbk.bak', '.tamos-backup-x.tmp'] as $decoy) {
            assertTrue(is_file($dir . '/' . $decoy), 'a foreign file is never deleted: ' . $decoy);
        }
        assertTrue(!is_file($dir . '/tamos-backup-20260901T010000Z-00000000.tamosbk.sha256'), 'an orphan sidecar is removed');
        foreach ($store->ids() as $kept) {
            $store->check($kept);    // every kept backup keeps its sidecar and digest
        }
        assertSame(0, $store->prune($newest), 'pruning is idempotent');
        // The backup just made survives even when it does not sort among the newest.
        $old = syntheticBackup($dir, $keys['publicKey'], syntheticTables(), '2026-09-01 01:00:00.000000');
        assertSame(0, $store->prune(BackupStore::idOfFileName(basename($old))));
        assertTrue(is_file($old), 'never the backup just created');
    },

    'the store: temporaries, exclusive names, refused directories, read-back and no overwrite' => static function (): void {
        $dir = tempDir();
        $store = BackupStore::open($dir, dirname(__DIR__, 2));
        $id = BackupStore::newId('2026-10-07 01:00:00.000000');
        [$h, $temp] = $store->createTemporary($id);
        assertSame(BackupError::WRITE_FAILED, assertThrows(BackupError::class, static fn () => $store->createTemporary($id))->reason, 'exclusive create');
        fwrite($h, 'payload');
        assertSame(BackupError::READBACK_MISMATCH, assertThrows(BackupError::class, static fn () => $store->finalize($h, $temp, $id, hash('sha256', 'other')))->reason);
        assertTrue(!is_file($dir . '/' . BackupStore::fileName($id)), 'nothing published');
        $store->discard($id);
        assertSame(['.', '..'], scandir($dir), 'discard removes the run\'s own work only');

        [$h, $temp] = $store->createTemporary($id);
        fwrite($h, 'payload');
        file_put_contents($dir . '/' . BackupStore::fileName($id), 'existing');
        assertSame(BackupError::EXISTS, assertThrows(BackupError::class, static fn () => $store->finalize($h, $temp, $id, hash('sha256', 'payload')))->reason);
        assertSame('existing', file_get_contents($dir . '/' . BackupStore::fileName($id)), 'a final name is never overwritten');

        file_put_contents($dir . '/.tamos-backup-20261001T010000Z-00000000.tmp', 'stale');
        file_put_contents($dir . '/.tamos-backup-20261001T010000Z-00000000.sha256.tmp', 'stale');
        assertSame(3, $store->removeStaleTemporaries(), 'stale work in progress (including this test\'s) is removed');

        assertSame(BackupError::DIRECTORY, assertThrows(BackupError::class, static fn () => BackupStore::open($dir . '/missing', dirname(__DIR__, 2)))->reason);
        assertSame(BackupError::DIRECTORY, assertThrows(BackupError::class, static fn () => BackupStore::open('relative', dirname(__DIR__, 2)))->reason);
        assertSame(BackupError::DIRECTORY, assertThrows(BackupError::class, static fn () => BackupStore::open(dirname(__DIR__, 2) . '/tests', dirname(__DIR__, 2)))->reason, 'inside the application');
        $file = $dir . '/plain-file';
        file_put_contents($file, 'x');
        assertSame(BackupError::DIRECTORY, assertThrows(BackupError::class, static fn () => BackupStore::open($file, dirname(__DIR__, 2)))->reason);
    },

    'host check (status): sidecar, digest and clear header, without any key' => static function (): void {
        $keys = backupKeys();
        $dir = tempDir();
        $path = syntheticBackup($dir, $keys['publicKey'], syntheticTables());
        $store = BackupStore::open($dir, dirname(__DIR__, 2));
        $id = BackupStore::idOfFileName(basename($path));
        assertSame(BackupCipher::fingerprint($keys['publicKey']), $store->check($id)['keyFingerprint']);
        file_put_contents($path, 'x', FILE_APPEND);
        assertSame(BackupError::DIGEST_MISMATCH, assertThrows(BackupError::class, static fn () => $store->check($id))->reason);
    },
];
