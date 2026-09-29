<?php
declare(strict_types=1);

/*
 * Backend test runner (BF-1). No PHPUnit, no Composer.
 *
 *   php server/tests/run.php
 *
 * Loads the backend classes without dispatching a request, then runs every
 * tests/Unit/*Test.php and tests/Http/*Test.php. Each file returns name => closure; a test
 * passes when its closure returns without throwing. Exits non-zero on any failure.
 */

require dirname(__DIR__) . '/src/bootstrap.php';
require __DIR__ . '/lib.php';

\TamOs\installErrorHandler();
ini_set('display_errors', 'stderr');
error_reporting(E_ALL);

$files = array_merge(glob(__DIR__ . '/Unit/*Test.php') ?: [], glob(__DIR__ . '/Http/*Test.php') ?: []);
sort($files);

$passed = 0;
$failed = [];
foreach ($files as $file) {
    $suite = basename(dirname($file)) . '/' . basename($file, '.php');
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
            echo '  [PASS] ' . $name . "\n";
        } catch (\Throwable $e) {
            $failed[] = $suite . ' :: ' . $name;
            echo '  [FAIL] ' . $name . ' >> ' . $e::class . ': ' . $e->getMessage() . "\n";
        }
    }
}

if ($failed !== []) {
    echo "\nBACKEND TESTS FAILED -- " . $passed . ' passed, ' . count($failed) . " failed:\n";
    foreach ($failed as $f) {
        echo '   - ' . $f . "\n";
    }
    exit(1);
}
echo "\nBACKEND TESTS PASSED -- " . $passed . " passed, 0 failed.\n";
exit(0);
