<?php
declare(strict_types=1);

/*
 * TAM OS governed mail worker (BF-3D, D-D3) — run by cron, never over HTTP.
 *
 *   php server/bin/mail.php run    # deliver up to 20 due outbox rows, then exit
 *
 * It takes the 'tamos_mail' advisory lock without waiting (an overlapping run exits 1 with
 * "mail: busy"), requires an exactly current schema and a valid `mail` configuration section,
 * and delivers each row through the configured MailTransport outside any transaction.
 *
 * Exit codes: 0 done (including nothing due), 1 busy or any configuration, schema, mail or
 * database failure, 2 usage. stdout carries counts only; stderr carries reason codes only —
 * never an address, a token, a link, a credential, a provider response, SQL or a driver
 * message. It lives outside the web root and refuses any non-CLI SAPI.
 */

if (PHP_SAPI !== 'cli') {
    exit(1);
}

require dirname(__DIR__) . '/src/bootstrap.php';

use TamOs\Config\ConfigError;
use TamOs\Config\ConfigLoader;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\DatabaseError;
use TamOs\Data\Migration\MigrationError;
use TamOs\Data\Migration\Migrator;
use TamOs\Http\RequestId;
use TamOs\Mail\MailConfig;
use TamOs\Mail\MailError;
use TamOs\Mail\OutboxWorker;

\TamOs\hardenRuntime();
\TamOs\installErrorHandler();

const MAIL_BATCH = 20;

if ($argv !== [$argv[0], 'run']) {
    fwrite(STDERR, "usage: php server/bin/mail.php run\n");
    exit(2);
}

try {
    $config = ConfigLoader::load(ConfigLoader::resolvePath(), null);
    $mail = MailConfig::fromConfig($config);
    if (Migrator::fromConfig($config, dirname(__DIR__) . '/migrations')->inspect() !== []) {
        fwrite(STDERR, "mail: schema_not_current\n");
        exit(1);
    }
    $data = AuthData::fromConfig($config);
    if (!$data->acquireMailLock()) {
        fwrite(STDERR, "mail: busy\n");
        exit(1);
    }
    try {
        $counts = (new OutboxWorker($data, $mail->transport(), $config->origin))->run(MAIL_BATCH, RequestId::generate());
    } finally {
        $data->releaseMailLock();
    }
    echo 'sent: ' . $counts['sent'] . ', retried: ' . $counts['retried'] . ', failed: ' . $counts['failed'] . ', cancelled: ' . $counts['cancelled'] . "\n";
    exit(0);
} catch (MailError $e) {
    fwrite(STDERR, 'mail: ' . $e->kind . "\n");
} catch (ConfigError $e) {
    fwrite(STDERR, 'configuration rejected: ' . $e->reason . "\n");
} catch (MigrationError $e) {
    fwrite(STDERR, 'migrations: ' . $e->reason . ($e->version !== null ? sprintf(' (version %04d)', $e->version) : '') . "\n");
} catch (DatabaseError $e) {
    fwrite(STDERR, 'database: ' . $e->kind . ' during ' . $e->operation . "\n");
} catch (\Throwable $e) {
    fwrite(STDERR, "mail: internal error\n");
}
exit(1);
