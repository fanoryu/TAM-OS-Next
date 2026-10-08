<?php
declare(strict_types=1);

/*
 * TAM OS encrypted database backups (OPS-1) — operator tooling, never an HTTP surface.
 *
 *   php server/bin/backup.php create    # host, cron: one encrypted backup, then keep the newest 7
 *   php server/bin/backup.php status    # host: newest backup's age, every backup's SHA-256 and header
 *   php server/bin/backup.php verify --file=<backup> --secret-key-file=<key> [--previous=<older backup>]
 *                                       # off-host only: decrypt and check everything, optionally the
 *                                       # append-only continuity against the previous backup
 *   php server/bin/backup.php keygen --secret-key-file=<new key file>
 *                                       # off-host only: a new key pair; prints the public key for the
 *                                       # host configuration and writes the secret key file (never on the host)
 *   php server/bin/backup.php restore --file=<backup> --secret-key-file=<key> --target-config=<config> [--previous=<older backup>]
 *                                       # off-host only (OPS-2): verify the backup completely, then load it into
 *                                       # the empty, migrated database of <config> in one transaction and prove it
 *   php server/bin/backup.php verify-restore --file=<backup> --secret-key-file=<key> --target-config=<config>
 *                                       # off-host only: prove, read-only, that the target holds exactly the backup
 *
 * create and status read the `backup` section of the configuration (dir, public_key) and the
 * database; verify, keygen, restore and verify-restore refuse to run where the configuration is the
 * production one, so the secret key never has to exist on the host (D-OPS2-1 = A). restore and
 * verify-restore take their target only from --target-config; a production target (a production
 * database reached over an SSH tunnel from the owner's machine) accepts only a production backup
 * and asks, on standard input, for the exact line RESTORE <backup id> INTO <target fingerprint>.
 * There is no option that skips it.
 *
 * Exit codes: 0 done (status: a fresh, intact newest backup; restore: restored and proven), 1 any
 * refusal, failure, stale or damaged backup (restore: nothing was committed — the target is still
 * empty), 2 usage, 3 restore committed but its proof after commit failed or did not finish — the
 * target holds data that is not proven (run verify-restore, or drop and recreate it). Output is reason codes, backup ids, counts and digests only — never a
 * path, a key, a row value, the DSN, a credential, SQL or a driver message. It lives outside the
 * web root and refuses any non-CLI SAPI.
 */

if (PHP_SAPI !== 'cli') {
    exit(1);
}

require dirname(__DIR__) . '/src/bootstrap.php';

use TamOs\Config\ConfigError;
use TamOs\Config\ConfigLoader;
use TamOs\Data\Backup\BackupReader;
use TamOs\Data\Backup\RestoreWriter;
use TamOs\Data\DatabaseError;
use TamOs\Data\Migration\MigrationError;
use TamOs\Log\Logger;
use TamOs\Ops\BackupCipher;
use TamOs\Ops\BackupConfig;
use TamOs\Ops\BackupCreator;
use TamOs\Ops\BackupError;
use TamOs\Ops\BackupRestorer;
use TamOs\Ops\BackupStore;
use TamOs\Ops\BackupVerifier;

\TamOs\hardenRuntime();
\TamOs\installErrorHandler();

const USAGE = "usage: php server/bin/backup.php create|status\n"
    . "       php server/bin/backup.php verify --file=<backup> --secret-key-file=<key> [--previous=<backup>]\n"
    . "       php server/bin/backup.php keygen --secret-key-file=<new key file>\n"
    . "       php server/bin/backup.php restore --file=<backup> --secret-key-file=<key> --target-config=<config> [--previous=<backup>]\n"
    . "       php server/bin/backup.php verify-restore --file=<backup> --secret-key-file=<key> --target-config=<config>\n";

/** @return array<string, string>|null the --name=value options, or null for anything else */
function backupOptions(array $args, array $required, array $optional): ?array
{
    $out = [];
    foreach ($args as $arg) {
        if (preg_match('/^--([a-z][a-z-]*)=(.+)$/s', $arg, $m) !== 1 || isset($out[$m[1]]) || !in_array($m[1], [...$required, ...$optional], true)) {
            return null;
        }
        $out[$m[1]] = $m[2];
    }
    foreach ($required as $name) {
        if (!isset($out[$name])) {
            return null;
        }
    }
    return $out;
}

/** verify, keygen, restore and verify-restore refuse where the configuration is the production one. @throws BackupError */
function refuseOnProductionHost(): void
{
    try {
        $config = ConfigLoader::load(ConfigLoader::resolvePath(), null);
    } catch (ConfigError) {
        return;     // no usable configuration here: an off-host machine
    }
    if ($config->isProduction()) {
        throw new BackupError(BackupError::PRODUCTION_HOST);
    }
}

$command = $argv[1] ?? '';
$args = array_slice($argv, 2);
$options = match ($command) {
    'create', 'status' => $args === [] ? [] : null,
    'verify' => backupOptions($args, ['file', 'secret-key-file'], ['previous']),
    'keygen' => backupOptions($args, ['secret-key-file'], []),
    'restore' => backupOptions($args, ['file', 'secret-key-file', 'target-config'], ['previous']),
    'verify-restore' => backupOptions($args, ['file', 'secret-key-file', 'target-config'], []),
    default => null,
};
if ($options === null) {
    fwrite(STDERR, USAGE);
    exit(2);
}

$logger = null;
$started = hrtime(true);
$exit = 1;
try {
    if ($command === 'keygen') {
        refuseOnProductionHost();
        $target = $options['secret-key-file'];
        $pair = BackupCipher::generateKeyPair();
        $out = BackupStore::createExclusive($target);
        if ($out === false) {
            throw new BackupError(BackupError::KEY_FILE);    // never overwrites an existing key file
        }
        $ok = fwrite($out, $pair['secretKeyFile']) === strlen($pair['secretKeyFile']) && fflush($out) && fsync($out);
        fclose($out);
        if (!$ok) {
            throw new BackupError(BackupError::KEY_FILE);
        }
        $publicKey = BackupCipher::decodePublicKey($pair['publicKey']);
        echo 'public_key: ' . $pair['publicKey'] . "\n";
        echo 'fingerprint: ' . BackupCipher::fingerprint($publicKey) . "\n";
        exit(0);
    }

    if ($command === 'verify') {
        refuseOnProductionHost();
        $verifier = new BackupVerifier(BackupCipher::readSecretKeyFile($options['secret-key-file']));
        $manifest = $verifier->verify($options['file'], $options['previous'] ?? null);
        $rows = array_sum(array_column($manifest['tables'], 'rows'));
        echo 'verified: ' . $manifest['backupId'] . "\n";
        echo 'tables: ' . count($manifest['tables']) . ', rows: ' . $rows . "\n";
        echo 'schema: database head ' . $manifest['schema']['databaseHead'] . ', code head ' . $manifest['schema']['codeHead'] . "\n";
        echo 'source: ' . $manifest['source']['env'] . ' ' . substr($manifest['source']['databaseFingerprint'], 0, 16) . "\n";
        echo 'continuity: ' . (isset($options['previous']) ? 'verified' : 'not checked') . "\n";
        exit(0);
    }

    if ($command === 'restore' || $command === 'verify-restore') {
        refuseOnProductionHost();
        $target = ConfigLoader::load($options['target-config'], null);
        $restorer = new BackupRestorer(
            new BackupVerifier(BackupCipher::readSecretKeyFile($options['secret-key-file'])),
            static fn (): RestoreWriter => RestoreWriter::fromConfig($target),
            $target->env,
            RestoreWriter::fingerprintOf($target),
            dirname(__DIR__) . '/migrations',
            static function (array $identity): ?string {
                fwrite(STDERR, "restore into a PRODUCTION database\n");
                foreach (['backup', 'key', 'source', 'target', 'schema'] as $name) {
                    fwrite(STDERR, $name . ': ' . $identity[$name] . "\n");
                }
                fwrite(STDERR, 'type exactly: ' . $identity['phrase'] . "\n");
                $line = fgets(STDIN);
                return $line === false ? null : rtrim($line, "\r\n");
            },
        );
        $evidence = $command === 'restore' ? $restorer->restore($options['file'], $options['previous'] ?? null) : $restorer->verifyTarget($options['file']);
        echo $command . ": PASS\n";
        echo 'backup: ' . $evidence['backupId'] . "\n";
        echo 'manifest: ' . $evidence['manifestSha256'] . "\n";
        echo 'key: ' . $evidence['keyFingerprint'] . "\n";
        echo 'source: ' . $evidence['source'] . "\n";
        echo 'target: ' . $evidence['target'] . "\n";
        echo 'schema: backup head ' . $evidence['backupHead'] . ', target head ' . $evidence['targetHead'] . ', code head ' . $evidence['codeHead'] . "\n";
        foreach ($evidence['tables'] as $table => $rows) {
            echo 'table: ' . $table . ' rows ' . $rows . " ok\n";
        }
        echo 'tables: ' . count($evidence['tables']) . ' verified, rows ' . array_sum($evidence['tables']) . "\n";
        echo 'decimal totals: matched (' . $evidence['decimalColumns'] . " columns)\n";
        echo 'excluded: ' . $evidence['excluded'] . " empty\n";
        echo $command === 'restore' ? "verified: in-transaction yes, post-commit yes\n" : "verified: target snapshot yes\n";
        echo 'started: ' . $evidence['started'] . "\n";
        echo 'finished: ' . $evidence['finished'] . "\n";
        echo 'duration_ms: ' . $evidence['durationMs'] . "\n";
        exit(0);
    }

    $config = ConfigLoader::load(ConfigLoader::resolvePath(), null);
    $logger = new Logger($config->logPath, $config->env);
    $backup = BackupConfig::fromConfig($config);
    $store = BackupStore::open($backup->dir, dirname(__DIR__));

    if ($command === 'status') {
        $logger = null;     // status is read-only and logs nothing
        $ids = $store->ids();
        if ($ids === []) {
            throw new BackupError(BackupError::NONE);
        }
        $checked = [];
        foreach ($ids as $id) {
            try {
                $checked[$id] = $store->check($id);
            } catch (BackupError) {
                $checked[$id] = null;
            }
        }
        $newest = $checked[$ids[0]];
        $age = time() - BackupStore::timeOf($ids[0]);
        $damaged = count(array_filter($checked, static fn (?array $c): bool => $c === null));
        echo 'backups: ' . count($ids) . ', intact: ' . (count($ids) - $damaged) . "\n";
        echo 'newest: ' . $ids[0] . ' (' . intdiv(max(0, $age), 3600) . ' h old, '
            . ($newest === null ? 'damaged' : $newest['bytes'] . ' bytes, key ' . ($newest['keyFingerprint'] === BackupCipher::fingerprint($backup->publicKey) ? 'current' : 'other')) . ")\n";
        if ($damaged > 0) {
            throw new BackupError(BackupError::DIGEST_MISMATCH);
        }
        if ($age > BackupStore::MAX_AGE_SECONDS) {
            throw new BackupError(BackupError::STALE);
        }
        exit(0);
    }

    $creator = new BackupCreator(BackupReader::fromConfig($config), $store, $backup->publicKey, $config->env, dirname(__DIR__) . '/migrations');
    $result = $creator->create();
    $logger->backup('created', $result['backupId'], $result['bytes'], intdiv(hrtime(true) - $started, 1000000), null);
    echo 'backup: ' . $result['backupId'] . "\n";
    echo 'bytes: ' . $result['bytes'] . "\n";
    echo 'tables: ' . $result['tables'] . ', rows: ' . $result['rows'] . "\n";
    echo 'schema: database head ' . $result['databaseHead'] . ', code head ' . $result['codeHead'] . "\n";
    echo 'pruned: ' . $result['pruned'] . "\n";
    exit(0);
} catch (BackupError $e) {
    $reason = $e->reason;
    $exit = $reason === BackupError::UNPROVEN ? 3 : 1;
    fwrite(STDERR, $command . ': ' . $reason . "\n");
} catch (ConfigError $e) {
    $reason = 'config_' . $e->reason;
    fwrite(STDERR, 'configuration rejected: ' . $e->reason . "\n");
} catch (MigrationError $e) {
    $reason = $e->reason;
    fwrite(STDERR, 'migrations: ' . $e->reason . ($e->version !== null ? sprintf(' (version %04d)', $e->version) : '') . "\n");
} catch (DatabaseError $e) {
    $reason = 'database_' . $e->kind;
    fwrite(STDERR, 'database: ' . $e->kind . ' during ' . $e->operation . "\n");
} catch (\Throwable $e) {
    $reason = 'internal_error';
    fwrite(STDERR, $command . ": internal error\n");
}
if ($command === 'create' && $logger !== null) {
    $logger->backup('failed', null, 0, intdiv(hrtime(true) - $started, 1000000), $reason);
}
exit($exit);
