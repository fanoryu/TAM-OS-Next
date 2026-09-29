<?php
declare(strict_types=1);

/*
 * Backend test runner (BF-1, BF-2A). No PHPUnit, no Composer.
 *
 *   php server/tests/run.php               # unit, HTTP and (when opted in) database tests
 *   php server/tests/run.php --require-db  # CI: fail unless the database suite actually ran
 *
 * Loads the backend classes without dispatching a request, then runs every
 * tests/Unit/*Test.php, tests/Http/*Test.php and tests/Db/*Test.php. Each file returns
 * name => closure; a test passes when its closure returns without throwing.
 *
 * The database suite runs only with TAMOS_DB_TESTS=1 and a guarded disposable test database
 * (see lib.php testDatabase()). Otherwise it is reported as NOT RUN — never as passed.
 */

require dirname(__DIR__) . '/src/bootstrap.php';
require __DIR__ . '/lib.php';

\TamOs\hardenRuntime();
\TamOs\installErrorHandler();
ini_set('display_errors', 'stderr');

$requireDb = in_array('--require-db', $argv, true);
$dbOptIn = getenv('TAMOS_DB_TESTS') === '1';

$files = array_merge(
    glob(__DIR__ . '/Unit/*Test.php') ?: [],
    glob(__DIR__ . '/Http/*Test.php') ?: [],
    glob(__DIR__ . '/Db/*Test.php') ?: [],
);
sort($files);

$passed = 0;
$dbPassed = 0;
$failed = [];
foreach ($files as $file) {
    $group = basename(dirname($file));
    $suite = $group . '/' . basename($file, '.php');
    if ($group === 'Db' && !$dbOptIn) {
        echo '== ' . $suite . " == NOT RUN (database suite needs TAMOS_DB_TESTS=1 and a guarded test database)\n";
        continue;
    }
    $tests = require $file;
    if (!is_array($tests) || $tests === []) {
        $failed[] = $suite . ': file returned no tests';
        echo '  [FAIL] ' . $suite . ": file returned no tests\n";
        continue;
    }
    echo '== ' . $suite . " ==\n";
    foreach ($tests as $name => $test) {
        try {
            $test();
            $passed++;
            if ($group === 'Db') {
                $dbPassed++;
            }
            echo '  [PASS] ' . $name . "\n";
        } catch (\Throwable $e) {
            $failed[] = $suite . ' :: ' . $name;
            echo '  [FAIL] ' . $name . ' >> ' . $e::class . ': ' . $e->getMessage() . "\n";
        }
    }
}

$dbStatus = $dbOptIn ? 'database suite RAN (' . $dbPassed . ' passed)' : 'database suite NOT RUN';
if ($requireDb && ($dbOptIn === false || $dbPassed === 0)) {
    $failed[] = '--require-db: the database suite did not run';
}
if ($failed !== []) {
    echo "\nBACKEND TESTS FAILED -- " . $passed . ' passed, ' . count($failed) . ' failed; ' . $dbStatus . ":\n";
    foreach ($failed as $f) {
        echo '   - ' . $f . "\n";
    }
    exit(1);
}
echo "\nBACKEND TESTS PASSED -- " . $passed . ' passed, 0 failed; ' . $dbStatus . ".\n";
exit(0);
