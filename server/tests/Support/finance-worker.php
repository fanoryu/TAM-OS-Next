<?php
declare(strict_types=1);

/*
 * Test-only worker for tests/Db/FinancePostingConcurrencyTest.php and (BF-4f)
 * tests/Db/FinanceExecutionConcurrencyTest.php: performs ONE write — a Finance posting (operation
 * "post-plan" or "post-supplemental"), a Finance execution (operation "execute") or, for the
 * cross-domain races, a Supplemental generate or commit (operations "supplemental-generate",
 * "supplemental-commit") or the Payroll generate ("payroll-generate") — through the production
 * kernel on its own connection to the guarded test database, so the test can hold a row lock and
 * observe this request blocked on it.
 * Prints "<status> <error code | ok>". Never resets the database; refuses unless the database test
 * guards pass. Arguments: session token, CSRF token, operation, JSON body (fabricated test values
 * only).
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

[, $token, $csrf, $operation, $body] = $argv;
$paths = [
    'post-plan' => '/api/finance-postings/payroll-plan', 'post-supplemental' => '/api/finance-postings/supplemental-payroll',
    'supplemental-generate' => '/api/supplemental-payrolls/generate', 'supplemental-commit' => '/api/supplemental-payrolls/commit',
    'payroll-generate' => '/api/payroll-plans/generate', 'execute' => '/api/finance-executions/execute',
];
if (!isset($paths[$operation])) {
    exit(2);
}
$config = testDbConfig();
if (dbGuardViolations($config, ['TAMOS_DB_TESTS' => getenv('TAMOS_DB_TESTS')]) !== []) {
    fwrite(STDERR, "database test guard refused\n");
    exit(1);
}
$kernel = authKernel($config, AuthData::fromDatabase(new Database(DatabaseConfig::fromConfig($config))), productionMigrationsDir());
$response = $kernel->handle(sessionRequest('POST', $paths[$operation], $token, $csrf, $body), requestId());
$decoded = json_decode($response->body, true);
echo $response->status . ' ' . ($decoded['error']['code'] ?? 'ok') . "\n";
exit(0);
