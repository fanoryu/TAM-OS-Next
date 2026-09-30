<?php
declare(strict_types=1);

/*
 * TAM OS operator account commands (BF-3B) — the ONLY way an account comes into existence
 * or is reset before the future account administration exists.
 *
 *   php server/bin/account.php create-ceo --email=<address>         # once: company + first CEO
 *   php server/bin/account.php reset-credentials --email=<address>  # break-glass: CEO only
 *
 * Neither takes a password. Each prints a one-time activation token (valid 72 hours) exactly
 * once, on stdout, after its transaction has committed; the database keeps only its SHA-256.
 * The CEO sets their own password with POST /api/auth/activate, then logs in.
 * reset-credentials is operator break-glass recovery, not self-service recovery: it removes
 * the password, ends every session, revokes earlier tokens and issues a new token — which is
 * also how an expired bootstrap token is replaced.
 *
 * Exit codes: 0 done, 1 any refusal or configuration, schema or database failure, 2 usage.
 * stderr carries reason codes only — never the email, the token, the DSN, a credential, SQL
 * or a driver message. It lives outside the web root and refuses any non-CLI SAPI.
 */

if (PHP_SAPI !== 'cli') {
    exit(1);
}

require dirname(__DIR__) . '/src/bootstrap.php';

use TamOs\Auth\AccountCommand;
use TamOs\Auth\AccountLifecycle;
use TamOs\Auth\AccountRefused;
use TamOs\Config\ConfigError;
use TamOs\Config\ConfigLoader;
use TamOs\Data\DatabaseError;
use TamOs\Data\Migration\MigrationError;
use TamOs\Data\Migration\Migrator;
use TamOs\Http\RequestId;

\TamOs\hardenRuntime();
\TamOs\installErrorHandler();

$command = AccountCommand::parse($argv);
if ($command === null) {
    fwrite(STDERR, AccountCommand::USAGE);
    exit(2);
}

try {
    $config = ConfigLoader::load(ConfigLoader::resolvePath(), null);
    if (Migrator::fromConfig($config, dirname(__DIR__) . '/migrations')->inspect() !== []) {
        fwrite(STDERR, "account: schema_not_current\n");
        exit(1);
    }
    $lifecycle = AccountLifecycle::fromConfig($config);
    $issued = $command->command === AccountCommand::CREATE_CEO
        ? $lifecycle->createCeo($command->email, RequestId::generate())
        : $lifecycle->resetCredentials($command->email, RequestId::generate());
    echo 'user: ' . $issued->userId . "\n"
        . 'expires_at: ' . $issued->expiresAt . " UTC\n"
        . 'activation_token: ' . $issued->token . "\n";
    exit(0);
} catch (AccountRefused $e) {
    fwrite(STDERR, 'account: ' . $e->reason . "\n");
} catch (ConfigError $e) {
    fwrite(STDERR, 'configuration rejected: ' . $e->reason . "\n");
} catch (MigrationError $e) {
    fwrite(STDERR, 'migrations: ' . $e->reason . ($e->version !== null ? sprintf(' (version %04d)', $e->version) : '') . "\n");
} catch (DatabaseError $e) {
    fwrite(STDERR, 'database: ' . $e->kind . ' during ' . $e->operation . "\n");
} catch (\Throwable $e) {
    fwrite(STDERR, "account: internal error\n");
}
exit(1);
