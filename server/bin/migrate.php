<?php
declare(strict_types=1);

/*
 * TAM OS schema migration runner — the ONLY way the schema changes.
 *
 *   php server/bin/migrate.php status   # locked, read-only report
 *   php server/bin/migrate.php apply    # create/verify history, then run pending migrations
 *
 * Exit codes: 0 current / applied / status reported, 1 any configuration, database or
 * migration failure, 2 usage. Output names migration versions and reason codes only —
 * never the DSN, a credential, SQL or a driver message. It lives outside the web root and
 * refuses to do anything under a non-CLI SAPI.
 */

if (PHP_SAPI !== 'cli') {
    exit(1);
}

require dirname(__DIR__) . '/src/bootstrap.php';

use TamOs\Config\ConfigError;
use TamOs\Config\ConfigLoader;
use TamOs\Data\DatabaseError;
use TamOs\Data\Migration\MigrationError;
use TamOs\Data\Migration\Migrator;

\TamOs\hardenRuntime();
\TamOs\installErrorHandler();

$command = $argv[1] ?? '';
if (!in_array($command, ['status', 'apply'], true) || count($argv) !== 2) {
    fwrite(STDERR, "usage: php server/bin/migrate.php status|apply\n");
    exit(2);
}

try {
    $config = ConfigLoader::load(ConfigLoader::resolvePath(), null);
    $migrator = Migrator::fromConfig($config, dirname(__DIR__) . '/migrations');
    if ($command === 'status') {
        $pending = $migrator->status();
        echo $pending === [] ? "migrations: current\n" : 'migrations: ' . count($pending) . " pending (next " . $pending[0]->label() . ")\n";
    } else {
        foreach ($migrator->apply() as $migration) {
            echo 'applied: ' . $migration->label() . "\n";
        }
        echo "migrations: current\n";
    }
    exit(0);
} catch (ConfigError $e) {
    fwrite(STDERR, 'configuration rejected: ' . $e->reason . "\n");
} catch (MigrationError $e) {
    fwrite(STDERR, 'migrations: ' . $e->reason . ($e->version !== null ? sprintf(' (version %04d)', $e->version) : '') . "\n");
} catch (DatabaseError $e) {
    fwrite(STDERR, 'database: ' . $e->kind . ' during ' . $e->operation . "\n");
} catch (\Throwable $e) {
    fwrite(STDERR, "migrations: internal error\n");
}
exit(1);
