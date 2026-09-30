<?php
declare(strict_types=1);

/*
 * Test-only worker for tests/Db/AccountConcurrencyTest.php: performs ONE
 * POST /api/auth/change-password through the production kernel on its own connection to the
 * guarded test database, so the test can hold a row lock and observe this request blocked on
 * it. Prints "<status> <error code | ok>". Never resets the database; refuses unless the
 * database test guards pass. Arguments: session token, CSRF token, current, new password
 * (fabricated test values only).
 */

if (PHP_SAPI !== 'cli' || count($argv) !== 5) {
    exit(2);
}

require dirname(__DIR__, 2) . '/src/bootstrap.php';
require dirname(__DIR__) . '/lib.php';

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use function TamOs\Tests\authKernel;
use function TamOs\Tests\dbGuardViolations;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\requestId;
use function TamOs\Tests\sessionRequest;
use function TamOs\Tests\testDbConfig;

\TamOs\hardenRuntime();
\TamOs\installErrorHandler();

[, $token, $csrf, $current, $new] = $argv;
$config = testDbConfig();
if (dbGuardViolations($config, ['TAMOS_DB_TESTS' => getenv('TAMOS_DB_TESTS')]) !== []) {
    fwrite(STDERR, "database test guard refused\n");
    exit(1);
}
$kernel = authKernel($config, AuthData::fromDatabase(new Database(DatabaseConfig::fromConfig($config))), productionMigrationsDir());
$body = json_encode(['currentPassword' => $current, 'newPassword' => $new], JSON_THROW_ON_ERROR);
$response = $kernel->handle(sessionRequest('POST', '/api/auth/change-password', $token, $csrf, $body), requestId());
$decoded = json_decode($response->body, true);
echo $response->status . ' ' . ($decoded['error']['code'] ?? 'ok') . "\n";
exit(0);
