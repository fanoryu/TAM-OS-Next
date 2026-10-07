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
 *
 * create and status read the `backup` section of the configuration (dir, public_key) and the
 * database; verify and keygen need no configuration and refuse to run where the configuration is
 * the production one, so the secret key never has to exist on the host.
 *
 * Exit codes: 0 done (status: a fresh, intact newest backup), 1 any refusal, failure, stale or
 * damaged backup, 2 usage. Output is reason codes, backup ids, counts and digests only — never a
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
use TamOs\Data\DatabaseError;
use TamOs\Data\Migration\MigrationError;
use TamOs\Log\Logger;
use TamOs\Ops\BackupCipher;
use TamOs\Ops\BackupConfig;
use TamOs\Ops\BackupCreator;
use TamOs\Ops\BackupError;
use TamOs\Ops\BackupStore;
use TamOs\Ops\BackupVerifier;

\TamOs\hardenRuntime();
\TamOs\installErrorHandler();

const USAGE = "usage: php server/bin/backup.php create|status\n"
    . "       php server/bin/backup.php verify --file=<backup> --secret-key-file=<key> [--previous=<backup>]\n"
    . "       php server/bin/backup.php keygen --secret-key-file=<new key file>\n";

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

/** verify and keygen refuse where the configuration is the production one. @throws BackupError */
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
    default => null,
};
if ($options === null) {
    fwrite(STDERR, USAGE);
    exit(2);
}

$logger = null;
$started = hrtime(true);
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
exit(1);
