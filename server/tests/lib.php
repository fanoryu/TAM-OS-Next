<?php
declare(strict_types=1);

/*
 * Assertion and fixture helpers for the backend test harness (no PHPUnit, no Composer).
 * Test files return an array of name => closure; server/tests/run.php executes them.
 */

namespace TamOs\Tests;

use TamOs\Config\Config;
use TamOs\Config\ConfigLoader;
use TamOs\Http\Kernel;
use TamOs\Http\Request;
use TamOs\Http\Response;
use TamOs\Http\Route;
use TamOs\Http\Routes;
use TamOs\Identity\NullPrincipalResolver;
use TamOs\Identity\PrincipalResolver;
use TamOs\Log\Logger;

final class AssertionFailed extends \RuntimeException
{
}

/**
 * The deterministic test MailTransport (BF-3D): records every message in memory and never
 * touches a network — no real email is ever sent by a test. `$fail` queues outcomes: a
 * MailError kind to throw for the next send, or null to accept it. `$during` runs inside
 * send(), so a test can observe the database while "delivery" is in flight.
 */
final class RecordingMailTransport implements \TamOs\Mail\MailTransport
{
    /** @var list<\TamOs\Mail\MailMessage> */
    public array $sent = [];
    /** @var list<?string> */
    public array $fail = [];
    /** @var (\Closure(\TamOs\Mail\MailMessage): void)|null */
    public ?\Closure $during = null;

    public function send(\TamOs\Mail\MailMessage $message): void
    {
        if ($this->during !== null) {
            ($this->during)($message);
        }
        $kind = array_shift($this->fail);
        if ($kind !== null) {
            throw new \TamOs\Mail\MailError($kind);
        }
        $this->sent[] = $message;
    }
}

function fail(string $message): never
{
    throw new AssertionFailed($message);
}

function assertSame(mixed $expected, mixed $actual, string $label = ''): void
{
    if ($expected !== $actual) {
        fail(($label !== '' ? $label . ': ' : '') . 'expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

function assertTrue(bool $condition, string $label): void
{
    if (!$condition) {
        fail($label);
    }
}

/**
 * @template T of \Throwable
 * @param class-string<T> $class
 * @return T
 */
function assertThrows(string $class, callable $fn, string $label = ''): \Throwable
{
    try {
        $fn();
    } catch (\Throwable $e) {
        if ($e instanceof $class) {
            return $e;
        }
        fail(($label !== '' ? $label . ': ' : '') . 'expected ' . $class . ', got ' . $e::class);
    }
    fail(($label !== '' ? $label . ': ' : '') . 'expected ' . $class . ', nothing thrown');
}

/** A fresh, empty temporary directory for one test. */
function tempDir(): string
{
    $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'tamos-test-' . bin2hex(random_bytes(6));
    mkdir($dir, 0700, true);
    return $dir;
}

/** @param array<string, mixed> $overrides */
function testConfig(array $overrides = []): Config
{
    return ConfigLoader::fromArray($overrides + [
        'env' => 'test',
        'origin' => 'https://tamos.test',
        'log_path' => tempDir() . DIRECTORY_SEPARATOR . 'api.log',
    ]);
}

/**
 * @param list<Route>|null $routes production routes when null
 * @param string|null $migrationsDir readiness' migration directory (an absent one = zero migrations)
 */
function kernel(?Config $config = null, ?array $routes = null, ?string $migrationsDir = null, ?PrincipalResolver $resolver = null): Kernel
{
    $config ??= testConfig();
    $routes ??= productionRoutes($config, $migrationsDir);
    return new Kernel($routes, $resolver ?? new NullPrincipalResolver(), $config, new Logger($config->logPath, $config->env));
}

/**
 * The production route table over lazily connecting auth data, exactly as bootstrap builds it.
 *
 * @return list<Route>
 */
function productionRoutes(Config $config, ?string $migrationsDir = null, ?\TamOs\Data\Auth\AuthData $auth = null): array
{
    $auth ??= \TamOs\Data\Auth\AuthData::fromConfig($config);
    return Routes::production(
        new \TamOs\Data\Readiness($config, $migrationsDir ?? tempDir() . DIRECTORY_SEPARATOR . 'no-migrations'),
        new \TamOs\Controller\AuthController(new \TamOs\Auth\Authenticator($auth), new \TamOs\Auth\AccountLifecycle($auth), new \TamOs\Auth\AccountRecovery($auth)),
        new \TamOs\Controller\EmployeeController(
            new \TamOs\Employee\EmployeeService($business = \TamOs\Data\BusinessData::fromConnector($auth->connector())),
            new \TamOs\Employee\AccountService($business, $auth),
        ),
        new \TamOs\Controller\OvertimeController(new \TamOs\Overtime\OvertimeService($business)),
        new \TamOs\Controller\PayrollController(new \TamOs\Payroll\PayrollService($business)),
        new \TamOs\Controller\SupplementalController(new \TamOs\Supplemental\SupplementalService($business)),
    );
}

/** A kernel wired like production (SessionPrincipalResolver) over the given auth data. */
function authKernel(Config $config, \TamOs\Data\Auth\AuthData $auth, ?string $migrationsDir = null): Kernel
{
    return new Kernel(
        productionRoutes($config, $migrationsDir, $auth),
        new \TamOs\Identity\SessionPrincipalResolver($auth),
        $config,
        new Logger($config->logPath, $config->env),
    );
}

function requestId(): string
{
    return str_repeat('ab', 16);
}

/** @return array<string, mixed> */
function envelope(Response $response): array
{
    $decoded = json_decode($response->body, true, 16, JSON_THROW_ON_ERROR);
    assertTrue(is_array($decoded), 'envelope is a JSON object');
    return $decoded;
}

/**
 * Asserts the governed API headers and the request-ID echo on any response. Set-Cookie is
 * refused unless the caller expects the session cookie (auth routes only).
 */
function assertApiHeaders(Response $response, string $requestId, bool $allowSessionCookie = false): void
{
    foreach (\TamOs\Http\ApiHeaders::HEADERS as $name => $value) {
        assertSame($value, $response->headers[$name] ?? null, 'header ' . $name);
    }
    assertSame('application/json; charset=utf-8', $response->headers['Content-Type'] ?? null, 'Content-Type');
    assertSame($requestId, $response->headers['X-Request-Id'] ?? null, 'X-Request-Id');
    foreach (array_keys($response->headers) as $name) {
        assertTrue(!str_starts_with(strtolower($name), 'access-control-'), 'no CORS header (' . $name . ')');
        assertTrue($allowSessionCookie || strtolower($name) !== 'set-cookie', 'no Set-Cookie');
    }
}

/**
 * Fails when a client-visible body carries internals: filesystem paths, PHP file names,
 * database vocabulary, stack traces, exception class names or known configuration values.
 *
 * @param list<string> $secrets additional literal values that must never appear
 */
function assertNoLeak(string $body, array $secrets = []): void
{
    $patterns = [
        '#/home/#i', '#[A-Za-z]:\\\\#', '#\.php#i', '#\bPDO#', '#SQLSTATE#i', '#Stack trace#i', '/#\d+ /',
        '#Exception#', '#ErrorException#', '#Warning#', '#TAMOS_CONFIG#', '#config\.local#', '#tamos-test-#',
    ];
    foreach ($patterns as $pattern) {
        assertTrue(preg_match($pattern, $body) !== 1, 'response leaks ' . $pattern . ': ' . substr($body, 0, 200));
    }
    foreach ($secrets as $secret) {
        assertTrue($secret === '' || !str_contains($body, $secret), 'response leaks a configured value');
    }
}

/**
 * Every reason the database test guards refuse, for this configuration and environment. The
 * database suite may create or drop anything only when this list is empty. The guards are
 * deliberately redundant: a disposable CI database must satisfy all of them at once.
 *
 * @param array<string, string|false> $env TAMOS_DB_TESTS and friends, as getenv() returns them
 * @return list<string>
 */
function dbGuardViolations(Config $config, array $env): array
{
    $out = [];
    if ($config->env !== 'test') {
        $out[] = 'env is not test';
    }
    if (($env['TAMOS_DB_TESTS'] ?? false) !== '1') {
        $out[] = 'TAMOS_DB_TESTS is not 1';
    }
    $db = is_array($config->db) ? $config->db : [];
    if (!is_string($db['name'] ?? null) || preg_match('/^[a-z0-9_]{1,58}_test$/', $db['name']) !== 1) {
        $out[] = 'database name does not end in _test';
    }
    if (!in_array($db['host'] ?? null, ['127.0.0.1', 'localhost', '::1'], true)) {
        $out[] = 'database host is not loopback';
    }
    return $out;
}

/** The disposable test database's configuration, from TAMOS_TEST_DB_* (CI sets them). */
function testDbConfig(): Config
{
    $port = getenv('TAMOS_TEST_DB_PORT');
    return testConfig(['db' => [
        'host' => (string) getenv('TAMOS_TEST_DB_HOST'),
        'port' => is_string($port) && ctype_digit($port) ? (int) $port : 0,
        'name' => (string) getenv('TAMOS_TEST_DB_NAME'),
        'user' => (string) getenv('TAMOS_TEST_DB_USER'),
        'pass' => (string) getenv('TAMOS_TEST_DB_PASS'),
    ]]);
}

/**
 * A connection to the guarded test database, with every table in it dropped. Refuses unless
 * all guards pass AND the server confirms the connected schema is the configured one.
 */
function testDatabase(): \TamOs\Data\Database
{
    $config = testDbConfig();
    $violations = dbGuardViolations($config, ['TAMOS_DB_TESTS' => getenv('TAMOS_DB_TESTS')]);
    if ($violations !== []) {
        fail('database test guard refused: ' . implode('; ', $violations));
    }
    $db = new \TamOs\Data\Database(\TamOs\Data\DatabaseConfig::fromConfig($config));
    $current = $db->select('SELECT DATABASE() AS name')[0]['name'] ?? null;
    if ($current !== $config->db['name']) {
        fail('database test guard refused: connected schema is not the configured test database');
    }
    // BF-3A tables reference each other by foreign key, so the reset turns FK checks off for
    // this session only — here, in the guarded test helper, never in production code — and
    // always turns them back on, even when a drop fails.
    $db->execute('SET SESSION foreign_key_checks = 0');
    try {
        foreach ($db->select('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()') as $row) {
            $table = (string) $row['t'];
            if (preg_match('/^[a-z0-9_]{1,64}$/', $table) !== 1) {
                fail('database test guard refused: unexpected table name');
            }
            $db->execute('DROP TABLE `' . $table . '`');
        }
    } finally {
        $db->execute('SET SESSION foreign_key_checks = 1');
    }
    if ((int) ($db->select('SELECT @@SESSION.foreign_key_checks AS f')[0]['f'] ?? 0) !== 1) {
        fail('database test guard: foreign_key_checks was not restored');
    }
    return $db;
}

/**
 * A temporary migration directory holding exactly these files (name => bytes). Fixtures live
 * only in the system temp directory — never under server/migrations/.
 *
 * @param array<string, string> $files
 */
function migrationFixture(array $files): string
{
    $dir = tempDir() . DIRECTORY_SEPARATOR . 'migrations';
    mkdir($dir);
    foreach ($files as $name => $bytes) {
        file_put_contents($dir . DIRECTORY_SEPARATOR . $name, $bytes);
    }
    return $dir;
}

/** Writes a config file for a child process (the CLI or php -S) and returns its path. */
function writeConfigFile(Config $config): string
{
    $file = tempDir() . DIRECTORY_SEPARATOR . 'config.local.php';
    $values = ['env' => $config->env, 'origin' => $config->origin, 'log_path' => $config->logPath];
    if ($config->db !== null) {
        $values['db'] = $config->db;
    }
    if ($config->mail !== null) {
        $values['mail'] = $config->mail;
    }
    file_put_contents($file, "<?php\ndeclare(strict_types=1);\nreturn " . var_export($values, true) . ";\n");
    return $file;
}

/**
 * Runs server/bin/migrate.php in a child process with the given config file.
 *
 * @param list<string> $args
 * @return array{exit: int, stdout: string, stderr: string}
 */
function runMigrateCli(array $args, ?string $configFile): array
{
    return runCli('migrate.php', $args, $configFile);
}

/**
 * Runs server/bin/account.php (BF-3B) in a child process with the given config file.
 *
 * @param list<string> $args
 * @return array{exit: int, stdout: string, stderr: string}
 */
function runAccountCli(array $args, ?string $configFile): array
{
    return runCli('account.php', $args, $configFile);
}

/**
 * @param list<string> $args
 * @return array{exit: int, stdout: string, stderr: string}
 */
function runCli(string $script, array $args, ?string $configFile): array
{
    $env = getenv();
    unset($env['TAMOS_CONFIG']);
    if ($configFile !== null) {
        $env['TAMOS_CONFIG'] = $configFile;
    }
    $cmd = [PHP_BINARY];
    if (php_ini_loaded_file() === false) {
        $cmd[] = '-n';
    }
    array_push($cmd, dirname(__DIR__) . '/bin/' . $script, ...$args);
    $proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $env);
    if (!is_resource($proc)) {
        fail('cannot start ' . $script);
    }
    fclose($pipes[0]);
    $stdout = (string) stream_get_contents($pipes[1]);
    $stderr = (string) stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    return ['exit' => proc_close($proc), 'stdout' => $stdout, 'stderr' => $stderr];
}

/** Builds a request the way a browser on the canonical origin would send a JSON mutation. */
function jsonPost(string $path, string $body, array $overrides = []): Request
{
    $args = $overrides + [
        'method' => 'POST', 'path' => $path, 'query' => '', 'contentType' => 'application/json',
        'origin' => 'https://tamos.test', 'referer' => null, 'body' => $body, 'bodyTooLarge' => false, 'isHttps' => true,
    ];
    return new Request(...$args);
}

/** server/migrations — the real, production migration set. */
function productionMigrationsDir(): string
{
    return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'migrations';
}

/** The guarded, emptied test database with the production migrations (0001…) applied. */
function authDatabase(): \TamOs\Data\Database
{
    $db = testDatabase();
    (new \TamOs\Data\Migration\Migrator($db, productionMigrationsDir()))->apply();
    return $db;
}

/**
 * Inserts one test account — company, user and (unless 'membership' => false) membership —
 * with per-run random identifiers, email and password. Test-only SQL: production creates only
 * the pending bootstrap CEO (BF-3B, pendingCeo()), and tests need other shapes — activated,
 * Employee, disabled, several per company. Options: role, employeeId, userStatus, membershipStatus,
 * companyId (reuse), password (null = not activated), passwordHash (raw override), membership,
 * employeeRow (false = do not create the employee anchor a binding references).
 *
 * @param array<string, mixed> $o
 * @return array{companyId: string, userId: string, membershipId: string, email: string, password: ?string}
 */
function authFixture(\TamOs\Data\Database $db, array $o = []): array
{
    $companyId = $o['companyId'] ?? bin2hex(random_bytes(16));
    if (!isset($o['companyId'])) {
        $db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$companyId]);
    }
    $userId = bin2hex(random_bytes(16));
    $membershipId = bin2hex(random_bytes(16));
    $email = 'u-' . bin2hex(random_bytes(6)) . '@example.test';
    $password = array_key_exists('password', $o) ? $o['password'] : 'pw-' . bin2hex(random_bytes(10));
    $hash = array_key_exists('passwordHash', $o) ? $o['passwordHash'] : ($password === null ? null : \TamOs\Auth\Passwords::hash($password));
    $db->execute(
        'INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))',
        [$userId, $email, $hash, $o['userStatus'] ?? 'active'],
    );
    if (($o['membership'] ?? true) && ($o['employeeId'] ?? null) !== null && ($o['employeeRow'] ?? true)) {
        employeeAnchor($db, $companyId, $o['employeeId']);
    }
    if ($o['membership'] ?? true) {
        $db->execute(
            'INSERT INTO memberships (id, user_id, company_id, role, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))',
            [$membershipId, $userId, $companyId, $o['role'] ?? 'ceo', $o['employeeId'] ?? null, $o['membershipStatus'] ?? 'active'],
        );
    }
    return ['companyId' => $companyId, 'userId' => $userId, 'membershipId' => $membershipId, 'email' => $email, 'password' => $password];
}

/**
 * The employee row (BF-3C anchor, BF-4a1 profile: migrations 0009, 0014–0016) that an employee
 * binding must reference — created once per company, with a fabricated code (the id) and name.
 * Test-only SQL; fabricated identifiers only.
 */
function employeeAnchor(\TamOs\Data\Database $db, string $companyId, string $employeeId): void
{
    if ($db->select('SELECT id FROM employees WHERE company_id = ? AND id = ?', [$companyId, $employeeId]) === []) {
        $db->execute(
            'INSERT INTO employees (id, company_id, employee_code, full_name, created_at, updated_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))',
            [$employeeId, $companyId, substr($employeeId, 0, 32), 'Fixture ' . $employeeId],
        );
    }
}

/**
 * BF-3B: the bootstrap CEO, created through the real lifecycle (not test SQL) on this
 * connection. The account is pending: no password until the returned token is redeemed.
 *
 * @return array{userId: string, membershipId: string, companyId: string, email: string, token: string}
 */
function pendingCeo(\TamOs\Data\Database $db, ?string $email = null): array
{
    $email ??= 'ceo-' . bin2hex(random_bytes(6)) . '@example.test';
    $issued = (new \TamOs\Auth\AccountLifecycle(\TamOs\Data\Auth\AuthData::fromDatabase($db)))->createCeo($email, requestId());
    $m = $db->select('SELECT id, company_id FROM memberships WHERE user_id = ?', [$issued->userId])[0];
    return ['userId' => $issued->userId, 'membershipId' => (string) $m['id'], 'companyId' => (string) $m['company_id'], 'email' => $email, 'token' => $issued->token];
}

/** A same-origin JSON activation request from the fixed documentation IP. */
function activateRequest(string $token, string $password, array $overrides = []): Request
{
    return jsonPost('/api/auth/activate', json_encode(['token' => $token, 'password' => $password], JSON_THROW_ON_ERROR), $overrides + ['remoteAddr' => '203.0.113.7']);
}

/** A second, independent connection to the guarded test database (never resets it). */
function secondConnection(): \TamOs\Data\Database
{
    return new \TamOs\Data\Database(\TamOs\Data\DatabaseConfig::fromConfig(testDbConfig()));
}

/**
 * Waits — bounded, polling a condition, never a fixed sleep — until exactly $count other
 * connections of this database user are executing a statement that starts with $statement
 * (i.e. are blocked on a lock the caller holds). Fails the test when the deadline passes.
 */
function awaitBlockedStatements(\TamOs\Data\Database $observer, string $statement, int $count, float $deadlineSeconds = 30.0): void
{
    $until = microtime(true) + $deadlineSeconds;
    do {
        $n = (int) $observer->select(
            'SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE ID <> CONNECTION_ID() AND DB = DATABASE() AND INFO LIKE ?',
            [$statement . '%'],
        )[0]['n'];
        if ($n === $count) {
            return;
        }
        usleep(20000);
    } while (microtime(true) < $until);
    fail('expected ' . $count . ' connection(s) blocked on "' . $statement . '", saw ' . $n);
}

/** A same-origin JSON login request from a fixed documentation IP (RFC 5737). */
function loginRequest(string $email, string $password, array $overrides = []): Request
{
    return jsonPost('/api/auth/login', json_encode(['email' => $email, 'password' => $password], JSON_THROW_ON_ERROR), $overrides + ['remoteAddr' => '203.0.113.7']);
}

/** The session token a response's Set-Cookie carries (null when it sets none or clears). */
function sessionCookieToken(Response $response): ?string
{
    $header = $response->headers['Set-Cookie'] ?? null;
    if (!is_string($header) || preg_match('/^__Host-tamos_session=([A-Za-z0-9_-]{43});/', $header, $m) !== 1) {
        return null;
    }
    return $m[1];
}

/** A request carrying a session cookie (and optionally a CSRF header) from the canonical origin. */
function sessionRequest(string $method, string $path, ?string $token, ?string $csrf = null, string $body = '', array $overrides = []): Request
{
    $mutation = in_array($method, Request::MUTATION_METHODS, true);
    return new Request(...($overrides + [
        'method' => $method, 'path' => $path, 'query' => '',
        'contentType' => $mutation ? 'application/json' : null,
        'origin' => $mutation ? 'https://tamos.test' : null, 'referer' => null,
        'body' => $mutation && $body === '' ? '{}' : $body, 'bodyTooLarge' => false, 'isHttps' => true,
        'sessionToken' => $token, 'csrfToken' => $csrf, 'remoteAddr' => '203.0.113.7',
    ]));
}
