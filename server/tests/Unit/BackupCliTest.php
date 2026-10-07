<?php
declare(strict_types=1);

use TamOs\Ops\BackupCipher;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\backupKeys;
use function TamOs\Tests\runBackupCli;
use function TamOs\Tests\syntheticBackup;
use function TamOs\Tests\syntheticTables;
use function TamOs\Tests\tempDir;
use function TamOs\Tests\testConfig;
use function TamOs\Tests\writeConfigFile;

/**
 * OPS-1: server/bin/backup.php without a database — usage, keygen, verify, status, the
 * production-host refusal, exit codes, and output that never carries a path or a key.
 */

$noLeak = static function (array $run, array $secrets): void {
    foreach ($secrets as $secret) {
        assertTrue(!str_contains($run['stdout'] . $run['stderr'], $secret), 'output leaks a path or key');
    }
};
$statusConfig = static function (string $dir, string $publicKeyBase64, string $env = 'test'): string {
    return writeConfigFile(testConfig(['backup' => ['dir' => $dir, 'public_key' => $publicKeyBase64]] + ($env === 'test' ? [] : ['env' => $env])));
};

return [
    'usage errors exit 2 and do nothing' => static function (): void {
        foreach ([[], ['backup'], ['create', 'extra'], ['status', '--x=1'], ['verify'], ['verify', '--file=a'], ['verify', '--file=a', '--secret-key-file=b', '--file=c'],
            ['verify', '--file=a', '--secret-key-file=b', '--unknown=c'], ['keygen'], ['keygen', '--secret-key-file='], ['restore']] as $args) {
            $run = runBackupCli($args, null);
            assertSame(2, $run['exit'], implode(' ', $args));
            assertTrue(str_starts_with($run['stderr'], 'usage:'), 'usage text');
        }
    },

    'keygen writes an owner-only secret key file once and prints the public key and its fingerprint' => static function () use ($noLeak): void {
        $file = tempDir() . DIRECTORY_SEPARATOR . 'backup.key';
        $run = runBackupCli(['keygen', '--secret-key-file=' . $file], null);
        assertSame(0, $run['exit'], $run['stderr']);
        assertTrue(preg_match('/^public_key: ([A-Za-z0-9+\/]{43}=)\nfingerprint: ([0-9a-f]{16})\n$/D', $run['stdout'], $m) === 1, 'output shape');
        $secret = BackupCipher::readSecretKeyFile($file);
        assertSame($m[1], base64_encode(BackupCipher::publicKeyOf($secret)), 'the printed public key matches the file');
        assertSame($m[2], BackupCipher::fingerprint(BackupCipher::publicKeyOf($secret)));
        $noLeak($run, [$file, trim(explode("\n", (string) file_get_contents($file))[1])]);
        $again = runBackupCli(['keygen', '--secret-key-file=' . $file], null);
        assertSame(1, $again['exit']);
        assertSame("keygen: key_file\n", $again['stderr'], 'never overwrites a key file');
        assertSame($secret, BackupCipher::readSecretKeyFile($file), 'the existing key is untouched');
    },

    'verify succeeds off-host and reports ids, counts, heads and continuity — no path, no key' => static function () use ($noLeak): void {
        $keys = backupKeys();
        $dir = tempDir();
        $older = syntheticBackup($dir, $keys['publicKey'], syntheticTables(2), '2026-10-06 01:00:00.000000');
        $newer = syntheticBackup($dir, $keys['publicKey'], syntheticTables(4), '2026-10-07 01:00:00.000000');
        $run = runBackupCli(['verify', '--file=' . $newer, '--secret-key-file=' . $keys['keyFile'], '--previous=' . $older], null);
        assertSame(0, $run['exit'], $run['stderr']);
        assertTrue(str_starts_with($run['stdout'], 'verified: ' . substr(basename($newer), 13, 25) . "\ntables: 4, rows: 10\nschema: database head 1, code head 1\nsource: test "), $run['stdout']);
        assertTrue(str_ends_with($run['stdout'], "continuity: verified\n"), 'continuity line');
        $noLeak($run, [$dir, $keys['keyFile'], $keys['publicKeyBase64'], '1500000.00']);
        $single = runBackupCli(['verify', '--file=' . $older, '--secret-key-file=' . $keys['keyFile']], null);
        assertSame(0, $single['exit']);
        assertTrue(str_ends_with($single['stdout'], "continuity: not checked\n"), 'no previous');
    },

    'verify failures exit 1 with a reason code only' => static function () use ($noLeak): void {
        $keys = backupKeys();
        $path = syntheticBackup(tempDir(), $keys['publicKey'], syntheticTables());
        file_put_contents($path, 'x', FILE_APPEND);
        $run = runBackupCli(['verify', '--file=' . $path, '--secret-key-file=' . $keys['keyFile']], null);
        assertSame([1, '', "verify: digest_mismatch\n"], [$run['exit'], $run['stdout'], $run['stderr']]);
        $other = backupKeys();
        $good = syntheticBackup(tempDir(), $keys['publicKey'], syntheticTables());
        $run = runBackupCli(['verify', '--file=' . $good, '--secret-key-file=' . $other['keyFile']], null);
        assertSame([1, "verify: wrong_key\n"], [$run['exit'], $run['stderr']]);
        $run = runBackupCli(['verify', '--file=' . $good . '.missing', '--secret-key-file=' . $keys['keyFile']], null);
        assertSame([1, "verify: name_mismatch\n"], [$run['exit'], $run['stderr']]);
        $noLeak($run, [$good, $keys['keyFile']]);
    },

    'verify and keygen refuse to run where the configuration is the production one' => static function (): void {
        $keys = backupKeys();
        $good = syntheticBackup(tempDir(), $keys['publicKey'], syntheticTables());
        $production = writeConfigFile(testConfig(['env' => 'production', 'origin' => 'https://finance.example.test']));
        $run = runBackupCli(['verify', '--file=' . $good, '--secret-key-file=' . $keys['keyFile']], $production);
        assertSame([1, '', "verify: refused_on_production_host\n"], [$run['exit'], $run['stdout'], $run['stderr']]);
        $file = tempDir() . DIRECTORY_SEPARATOR . 'k.key';
        $run = runBackupCli(['keygen', '--secret-key-file=' . $file], $production);
        assertSame([1, "keygen: refused_on_production_host\n"], [$run['exit'], $run['stderr']]);
        assertTrue(!file_exists($file), 'no key file is written on the production host');
        $development = writeConfigFile(testConfig(['env' => 'development']));
        assertSame(0, runBackupCli(['verify', '--file=' . $good, '--secret-key-file=' . $keys['keyFile']], $development)['exit'], 'a non-production configuration is fine');
    },

    'status: none, fresh, stale and damaged; exit 0 only for a fresh, intact newest backup' => static function () use ($statusConfig, $noLeak): void {
        $keys = backupKeys();
        $dir = tempDir();
        $config = $statusConfig($dir, $keys['publicKeyBase64']);
        $run = runBackupCli(['status'], $config);
        assertSame([1, "status: none\n"], [$run['exit'], $run['stderr']]);

        syntheticBackup($dir, $keys['publicKey'], syntheticTables(), gmdate('Y-m-d H:i:s', time() - 40 * 3600) . '.000000');
        $run = runBackupCli(['status'], $config);
        assertSame([1, "status: stale\n"], [$run['exit'], $run['stderr']], 'older than 26 hours');
        assertTrue(str_contains($run['stdout'], 'backups: 1, intact: 1') && str_contains($run['stdout'], ' h old, '), $run['stdout']);

        $fresh = syntheticBackup($dir, $keys['publicKey'], syntheticTables(), gmdate('Y-m-d H:i:s') . '.000000');
        $run = runBackupCli(['status'], $config);
        assertSame(0, $run['exit'], $run['stderr']);
        assertTrue(str_contains($run['stdout'], 'backups: 2, intact: 2') && str_contains($run['stdout'], 'key current'), $run['stdout']);
        $noLeak($run, [$dir, $keys['publicKeyBase64']]);

        $rotated = $statusConfig($dir, backupKeys()['publicKeyBase64']);
        assertTrue(str_contains(runBackupCli(['status'], $rotated)['stdout'], 'key other'), 'a rotated key is reported');

        file_put_contents($fresh, 'x', FILE_APPEND);
        $run = runBackupCli(['status'], $config);
        assertSame([1, "status: digest_mismatch\n"], [$run['exit'], $run['stderr']]);
        assertTrue(str_contains($run['stdout'], 'backups: 2, intact: 1'), $run['stdout']);
    },

    'create and status refuse a missing or invalid backup section, or a directory inside the application' => static function (): void {
        $keys = backupKeys();
        $none = writeConfigFile(testConfig());
        assertSame([1, "status: config\n"], (static fn ($r) => [$r['exit'], $r['stderr']])(runBackupCli(['status'], $none)));
        assertSame([1, "create: config\n"], (static fn ($r) => [$r['exit'], $r['stderr']])(runBackupCli(['create'], $none)));
        $inside = writeConfigFile(testConfig(['backup' => ['dir' => dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'tests', 'public_key' => $keys['publicKeyBase64']]]));
        assertSame([1, "create: directory\n"], (static fn ($r) => [$r['exit'], $r['stderr']])(runBackupCli(['create'], $inside)));
        $missing = writeConfigFile(testConfig(['backup' => ['dir' => tempDir() . DIRECTORY_SEPARATOR . 'missing', 'public_key' => $keys['publicKeyBase64']]]));
        assertSame([1, "create: directory\n"], (static fn ($r) => [$r['exit'], $r['stderr']])(runBackupCli(['create'], $missing)));
    },
];
