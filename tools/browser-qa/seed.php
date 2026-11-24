<?php
declare(strict_types=1);

/*
 * TAM OS browser QA guard and fixture — TEST-ONLY. Run only by .github/workflows/browser-qa.yml,
 * from the trusted harness checkout (harness/tools/browser-qa), never from the application checkout.
 *
 *   php seed.php preflight        --app=<workspace>/app                    # before any migration
 *   php seed.php seed             --app=<workspace>/app --state=<qa dir>/state.json
 *   php seed.php expire-sessions  --app=<workspace>/app --email=<QA CEO or Employee address>
 *
 * Every mode first runs the same identity guard, in harness code only (plain PDO, no application
 * code), and refuses before any write unless all of it holds:
 *   runner    GitHub-hosted runner (GITHUB_ACTIONS, RUNNER_ENVIRONMENT=github-hosted, CI);
 *   places    this file is <workspace>/harness/tools/browser-qa/seed.php, --app is <workspace>/app,
 *             BQA_DIR is <runner temp>/browser-qa, a real 0700 directory outside the workspace;
 *   config    TAMOS_CONFIG is BQA_DIR/config.php, not group/world readable, exactly the QA keys:
 *             env "test", a localhost origin, a log inside BQA_DIR/logs, db 127.0.0.1:3306 /
 *             tamos_browser_qa / tamos_bqa, and no mail or backup section;
 *   server    the live connection reports database tamos_browser_qa, user tamos_bqa@%, MariaDB
 *             10.11.19, port 3306, the hostname of the job's own service container (its id prefix),
 *             and the account sees no database but tamos_browser_qa (and information_schema).
 * Then, per mode:
 *   preflight        the QA database has no table, view, routine or event at all — independent of
 *                    any migration; nothing is written;
 *   seed             the schema is at migration head 42 and current (Migrator, application code
 *                    from the verified commit), every business table is empty; then FABRICATED
 *                    records are written through the backend's own lifecycle, services and policy;
 *   expire-sessions  sets the live sessions of ONE QA account past their absolute expiry, so the
 *                    browser suite sees a real 401 (no QA endpoint, no bypass).
 *
 * The generated account passwords go only to the state file, created exclusively (never replaced)
 * with mode 0600 inside BQA_DIR. Output is counts and fixed reason codes only — never a value, DSN,
 * credential, SQL or driver message; on GitHub the passwords are also registered as masked values.
 *
 * Exit codes: 0 done, 1 refused or failed (a fixed reason code on stderr), 2 usage.
 */

if (PHP_SAPI !== 'cli') {
    exit(1);
}
// No PHP diagnostic output at all: refusals print fixed reason codes only.
ini_set('display_errors', '0');
ini_set('log_errors', '0');

const BQA_DB_HOST = '127.0.0.1';
const BQA_DB_PORT = 3306;
const BQA_DB_NAME = 'tamos_browser_qa';
const BQA_DB_USER = 'tamos_bqa';
const BQA_SERVER_VERSION = '10.11.19-MariaDB';
const BQA_MIGRATION_HEAD = 42;
const BQA_CEO_EMAIL = 'ceo.bqa@example.test';
const BQA_EMPLOYEE_EMAIL = 'emp.bqa@example.test';
const BQA_OTHER_CEO_EMAIL = 'ceo.other.bqa@example.test';
const BQA_BUSINESS_TABLES = ['companies', 'users', 'memberships', 'employees', 'finance_transactions', 'finance_requests', 'finance_request_payments', 'sessions', 'account_tokens'];

/** Stops with a fixed reason code. Never includes a value, path, DSN, credential or driver message. */
function bqaRefuse(string $reason): never
{
    fwrite(STDERR, 'browser-qa seed: refused (' . $reason . ")\n");
    exit(1);
}

function bqaKey(): string
{
    return bin2hex(random_bytes(16));
}

function bqaPassword(): string
{
    return 'Bqa-' . rtrim(strtr(base64_encode(random_bytes(18)), '+/', '-_'), '=');
}

/** Absolute POSIX path, resolved; null when absent. */
function bqaReal(string $path): ?string
{
    $r = realpath($path);
    return $r === false ? null : $r;
}

// ---- G1. Usage --------------------------------------------------------------------------------
$mode = $argv[1] ?? '';
$opts = [];
foreach (array_slice($argv, 2) as $a) {
    if (preg_match('/^--(app|state|email)=(.+)$/D', $a, $m) !== 1 || isset($opts[$m[1]])) {
        $opts = null;
        break;
    }
    $opts[$m[1]] = $m[2];
}
$want = ['preflight' => ['app'], 'seed' => ['app', 'state'], 'expire-sessions' => ['app', 'email']];
$need = $want[$mode] ?? null;
$got = $opts === null ? null : array_keys($opts);
if ($need !== null) {
    sort($need);
}
if ($got !== null) {
    sort($got);
}
if ($need === null || $got !== $need) {
    fwrite(STDERR, "usage: php seed.php preflight --app=<path> | seed --app=<path> --state=<path> | expire-sessions --app=<path> --email=<address>\n");
    exit(2);
}

// ---- G2. Runner identity ----------------------------------------------------------------------
if (getenv('GITHUB_ACTIONS') !== 'true' || getenv('RUNNER_ENVIRONMENT') !== 'github-hosted' || getenv('CI') !== 'true') {
    bqaRefuse('not_a_github_hosted_runner');
}
if (PHP_OS_FAMILY !== 'Linux') {
    bqaRefuse('not_linux');
}
if (getenv('BQA_DB_NAME') !== BQA_DB_NAME) {
    bqaRefuse('qa_database_not_declared');
}
$workspace = bqaReal((string) getenv('GITHUB_WORKSPACE'));
$runnerTemp = bqaReal((string) getenv('RUNNER_TEMP'));
if ($workspace === null || $runnerTemp === null || $workspace[0] !== '/' || $runnerTemp[0] !== '/') {
    bqaRefuse('runner_paths');
}

// ---- G3. Places: trusted harness, verified application, private QA directory -----------------
if (bqaReal(__DIR__) !== bqaReal($workspace . '/harness/tools/browser-qa')) {
    bqaRefuse('not_the_trusted_harness');
}
$app = bqaReal($opts['app']);
if ($app === null || $app !== bqaReal($workspace . '/app') || !is_file($app . '/server/src/bootstrap.php')) {
    bqaRefuse('not_the_application_checkout');
}
$qaDir = $runnerTemp . '/browser-qa';
if (getenv('BQA_DIR') !== $qaDir || is_link($qaDir) || !is_dir($qaDir) || (fileperms($qaDir) & 0777) !== 0700
    || str_starts_with($qaDir . '/', $workspace . '/')) {
    bqaRefuse('qa_directory');
}

// ---- G4. Configuration identity (read as data; no application code) --------------------------
$configPath = $qaDir . '/config.php';
if (getenv('TAMOS_CONFIG') !== $configPath || is_link($configPath) || !is_file($configPath) || (fileperms($configPath) & 0077) !== 0) {
    bqaRefuse('config_location');
}
try {
    $cfg = (static fn (string $p): mixed => require $p)($configPath);
} catch (\Throwable $e) {
    bqaRefuse('config_unreadable');
}
$keys = is_array($cfg) ? array_keys($cfg) : [];
sort($keys);
if ($keys !== ['body_limit_bytes', 'db', 'env', 'log_path', 'origin']) {
    bqaRefuse('config_keys');                      // also refuses any mail or backup section
}
if ($cfg['env'] !== 'test' || !is_string($cfg['origin']) || preg_match('#^http://localhost:[0-9]{2,5}$#D', $cfg['origin']) !== 1) {
    bqaRefuse('config_not_test');
}
if (!is_string($cfg['log_path']) || !str_starts_with($cfg['log_path'], $qaDir . '/logs/')) {
    bqaRefuse('config_log_path');
}
$db = $cfg['db'];
$dbKeys = is_array($db) ? array_keys($db) : [];
sort($dbKeys);
if ($dbKeys !== ['host', 'name', 'pass', 'port', 'user'] || $db['host'] !== BQA_DB_HOST || $db['port'] !== BQA_DB_PORT
    || $db['name'] !== BQA_DB_NAME || $db['user'] !== BQA_DB_USER || !is_string($db['pass'])) {
    bqaRefuse('config_not_qa_database');
}

// ---- G5. Server identity: what we are actually connected to ----------------------------------
$serviceId = (string) getenv('SERVICE_ID');
if (preg_match('/^[0-9a-f]{64}$/D', $serviceId) !== 1) {
    bqaRefuse('service_container_unknown');
}
if (!extension_loaded('pdo_mysql')) {
    bqaRefuse('pdo_mysql_missing');
}
try {
    $pdo = new \PDO('mysql:host=' . BQA_DB_HOST . ';port=' . BQA_DB_PORT . ';dbname=' . BQA_DB_NAME . ';charset=utf8mb4', BQA_DB_USER, $db['pass'], [
        \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION, \PDO::ATTR_TIMEOUT => 5, \PDO::ATTR_EMULATE_PREPARES => false,
    ]);
} catch (\Throwable $e) {
    bqaRefuse('connect_failed');
}
unset($cfg, $db);
try {
    $who = $pdo->query('SELECT DATABASE() AS db, VERSION() AS version, CURRENT_USER() AS user, @@hostname AS host, @@port AS port')->fetch(\PDO::FETCH_ASSOC);
    $databases = $pdo->query('SHOW DATABASES')->fetchAll(\PDO::FETCH_COLUMN);
} catch (\Throwable $e) {
    bqaRefuse('identity_query_failed');
}
sort($databases);
if (($who['db'] ?? null) !== BQA_DB_NAME) {
    bqaRefuse('connected_database_mismatch');
}
if (!str_starts_with((string) ($who['version'] ?? ''), BQA_SERVER_VERSION)) {
    bqaRefuse('server_version_mismatch');
}
if (($who['user'] ?? null) !== BQA_DB_USER . '@%') {
    bqaRefuse('connected_user_mismatch');
}
if ((int) ($who['port'] ?? 0) !== BQA_DB_PORT || ($who['host'] ?? null) !== substr($serviceId, 0, 12)) {
    bqaRefuse('not_the_service_container');
}
if ($databases !== ['information_schema', BQA_DB_NAME]) {
    bqaRefuse('account_sees_other_databases');
}

$count = static function (string $sql, array $params = []) use ($pdo): int {
    $s = $pdo->prepare($sql);
    $s->execute($params);
    return (int) $s->fetchColumn();
};

// ---- preflight: an empty database, before any migration --------------------------------------
if ($mode === 'preflight') {
    try {
        $objects = $count('SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()')
            + $count('SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()')
            + $count('SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()');
    } catch (\Throwable $e) {
        bqaRefuse('freshness_query_failed');
    }
    if ($objects !== 0) {
        bqaRefuse('database_not_fresh');
    }
    echo "browser-qa preflight: QA target verified (service container, MariaDB 10.11.19, tamos_browser_qa, tamos_bqa); database empty\n";
    exit(0);
}

// ---- seed / expire-sessions: the reviewed schema head ----------------------------------------
try {
    $head = $count('SELECT MAX(version) FROM schema_migrations');
} catch (\Throwable $e) {
    bqaRefuse('schema_history_missing');
}
if ($head !== BQA_MIGRATION_HEAD) {
    bqaRefuse('migration_head_mismatch');
}

// ---- expire-sessions: one QA account's live sessions, past their absolute expiry --------------
if ($mode === 'expire-sessions') {
    if (!in_array($opts['email'], [BQA_CEO_EMAIL, BQA_EMPLOYEE_EMAIL], true)) {
        bqaRefuse('not_a_qa_account');
    }
    try {
        $s = $pdo->prepare('UPDATE sessions s JOIN users u ON u.id = s.user_id SET s.absolute_expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND'
            . ' WHERE u.email = ? AND s.revoked_at IS NULL AND s.absolute_expires_at > UTC_TIMESTAMP(6)');
        $s->execute([$opts['email']]);
        $n = $s->rowCount();
    } catch (\Throwable $e) {
        bqaRefuse('expire_failed');
    }
    echo 'browser-qa expire-sessions: expired ' . $n . "\n";
    exit(0);
}

// ---- seed: empty business tables, then the verified application's own code -------------------
$statePath = $opts['state'];
if ($statePath !== $qaDir . '/state.json' || file_exists($statePath) || is_link($statePath)) {
    bqaRefuse('state_path');
}
try {
    foreach (BQA_BUSINESS_TABLES as $table) {
        if ($count('SELECT COUNT(*) FROM `' . $table . '`') !== 0) {
            bqaRefuse('schema_not_empty');
        }
    }
} catch (\Throwable $e) {
    bqaRefuse('emptiness_query_failed');
}
unset($pdo);

require $app . '/server/src/bootstrap.php';

\TamOs\hardenRuntime();
\TamOs\installErrorHandler();

$stage = 'bootstrap';
try {
    $config = \TamOs\Config\ConfigLoader::load($configPath, null);
    if ($config->env !== 'test' || \TamOs\Data\Migration\Migrator::fromConfig($config, $app . '/server/migrations')->inspect() !== []) {
        bqaRefuse('schema_not_current');
    }

    $auth = \TamOs\Data\Auth\AuthData::fromConfig($config);
    $business = \TamOs\Data\BusinessData::fromConnector($auth->connector());
    $lifecycle = new \TamOs\Auth\AccountLifecycle($auth);
    $employees = new \TamOs\Employee\EmployeeService($business);
    $accounts = new \TamOs\Employee\AccountService($business, $auth);
    $transactions = new \TamOs\Transaction\TransactionService($business);
    $requests = new \TamOs\Request\RequestService($business);
    $rid = static fn (): string => \TamOs\Http\RequestId::generate();

    $principal = static function (string $userId) use ($auth): \TamOs\Identity\Principal {
        $account = $auth->accounts()->findById($userId) ?? throw new \RuntimeException('account_missing');
        return \TamOs\Identity\Principal::fromAccount($account['user'], $account['memberships']) ?? throw new \RuntimeException('principal_denied');
    };
    $activate = static function (string $token, string $password) use ($lifecycle, $rid): void {
        if ($lifecycle->activate($token, $password, '127.0.0.1', $rid())->outcome !== \TamOs\Auth\ActivationResult::SUCCESS) {
            throw new \RuntimeException('activation_failed');
        }
    };
    /** Issues an activation token for a pending account through the token store (no mail is configured). */
    $issueToken = static function (string $userId) use ($auth): string {
        $token = \TamOs\Auth\SessionToken::generate();
        $auth->atomically(static function () use ($auth, $userId, $token): void {
            $auth->tokens()->revokeAllOpenForUser($userId);
            $auth->tokens()->issue(\TamOs\Auth\SessionToken::hash($token), $userId, \TamOs\Data\Auth\AccountTokenStore::ACTIVATION);
        });
        return $token;
    };
    $submit = static function (\TamOs\Identity\Principal $actor, array $row) use ($requests, $rid): array {
        $view = \TamOs\Request\RequestView::request($row, true);
        return \TamOs\Request\RequestView::request($requests->transition($actor, 'submit', ['financeRequestId' => $view['id'], 'expectedVersion' => $view['version']], $rid()), true);
    };
    $employeeView = static fn (array $row): array => \TamOs\Employee\EmployeeView::detail($row);

    // Dates in the company calendar: the ledger window is the previous calendar month (always in the past).
    $today = \TamOs\Transaction\TransactionInput::today(new \DateTimeImmutable('now'));
    $first = (new \DateTimeImmutable($today . ' 00:00:00', new \DateTimeZone('UTC')))->modify('first day of previous month');
    $from = $first->format('Y-m-d');
    $to = $first->modify('last day of this month')->format('Y-m-d');
    $day = static fn (int $d): string => $first->modify('+' . ($d - 1) . ' days')->format('Y-m-d');

    // Company A: the operator bootstrap (company + first CEO), then activation with a generated password.
    $stage = 'company_a_ceo';
    $ceoPassword = bqaPassword();
    $issued = $lifecycle->createCeo(BQA_CEO_EMAIL, $rid());
    $activate($issued->token, $ceoPassword);
    $ceo = $principal($issued->userId);

    $stage = 'company_a_employees';
    $e1 = $employeeView($employees->create($ceo, ['employeeCode' => 'BQA-001', 'fullName' => 'Bqa Pegawai Satu', 'jobTitle' => 'Staff QA', 'monthlyBaseSalary' => '3500000.00'], $rid()));
    $e2 = $employeeView($employees->create($ceo, ['employeeCode' => 'BQA-002', 'fullName' => 'Bqa Rekan Dua', 'jobTitle' => 'Staff QA', 'monthlyBaseSalary' => '4250000.00'], $rid()));

    $stage = 'company_a_employee_account';
    $accounts->provision($ceo, ['id' => $e1['id'], 'email' => BQA_EMPLOYEE_EMAIL], $rid());
    $employeeUserId = $auth->atomically(static function () use ($auth): string {
        $account = $auth->accounts()->lockByEmail(BQA_EMPLOYEE_EMAIL) ?? throw new \RuntimeException('employee_account_missing');
        return (string) $account['user']['user_id'];
    });
    $employeePassword = bqaPassword();
    $activate($issueToken($employeeUserId), $employeePassword);
    $employee = $principal($employeeUserId);

    // Ledger rows, oldest first. Descriptions include CSV-hostile and formula-like fabricated text.
    $stage = 'company_a_ledger';
    $ledger = [
        ['kind' => 'expense', 'financialPost' => 'GA', 'category' => 'ATK', 'description' => 'BQA fabricated stationery', 'amount' => '150000.00', 'transactionDate' => $day(5)],
        ['kind' => 'income', 'financialPost' => 'NPIP', 'category' => 'Grant', 'description' => 'BQA fabricated grant income', 'amount' => '2500000.00', 'transactionDate' => $day(7)],
        ['kind' => 'expense', 'financialPost' => 'GA', 'category' => 'Transport', 'description' => '=HYPERLINK("http://fabricated.invalid")', 'amount' => '75000.00', 'transactionDate' => $day(10)],
        ['kind' => 'expense', 'financialPost' => 'TJB', 'category' => 'Fuel', 'description' => 'BQA fabricated "fuel", run', 'amount' => '320000.00', 'transactionDate' => $day(12)],
        ['kind' => 'expense', 'financialPost' => 'DRONE', 'category' => 'Parts', 'description' => '@cmd BQA fabricated part', 'amount' => '410000.00', 'transactionDate' => $day(15)],
        ['kind' => 'income', 'financialPost' => 'GA', 'category' => 'Refund', 'description' => 'BQA fabricated refund', 'amount' => '50000.00', 'transactionDate' => $day(20)],
    ];
    foreach ($ledger as $row) {
        $transactions->create($ceo, $row + ['idempotencyKey' => bqaKey()], $rid());
    }

    // Finance requests: a Submitted payment request (the browser approves and pays it), the
    // Employee's own Submitted reimbursement, and a colleague's Draft the Employee must never see.
    $stage = 'company_a_requests';
    $payment = ['kind' => 'paymentRequest', 'financialPost' => 'TJB', 'category' => 'Vendor', 'description' => 'BQA fabricated vendor invoice', 'amount' => '1250000.00', 'payee' => 'PT Fabricated Vendor QA', 'documentDate' => $today];
    $submit($ceo, $requests->create($ceo, $payment + ['idempotencyKey' => bqaKey()], $rid()));
    $own = ['kind' => 'reimbursement', 'category' => 'Taxi', 'description' => 'BQA fabricated taxi fare', 'amount' => '85000.00', 'documentDate' => $day(8)];
    $ownView = $submit($employee, $requests->create($employee, $own + ['idempotencyKey' => bqaKey()], $rid()));
    $colleague = ['kind' => 'reimbursement', 'employeeId' => $e2['id'], 'financialPost' => 'GA', 'category' => 'Meal', 'description' => 'BQA colleague-only fabricated claim', 'amount' => '64000.00', 'documentDate' => $day(9)];
    $requests->create($ceo, $colleague + ['idempotencyKey' => bqaKey()], $rid());

    // A same-day distractor for the drill-through: identical date, post, category, description and
    // amount to the expense the browser's payment will create. Only the transaction id differs.
    $stage = 'company_a_distractor';
    $distractor = ['kind' => 'expense', 'financialPost' => $payment['financialPost'], 'category' => $payment['category'], 'description' => $payment['description'], 'amount' => $payment['amount'], 'transactionDate' => $today];
    $distractorId = \TamOs\Transaction\TransactionView::transaction($transactions->create($ceo, $distractor + ['idempotencyKey' => bqaKey()], $rid()))['id'];

    // Company B: a second fabricated company with its own CEO, employee, ledger row and request.
    // Created through the account store (createCeo bootstraps only the first company); its CEO is
    // activated only so the backend's own services can write B's records under B's scope.
    $stage = 'company_b';
    $otherCeoUserId = $auth->atomically(static function () use ($auth): string {
        $companyId = bin2hex(random_bytes(16));
        $userId = bin2hex(random_bytes(16));
        $auth->accounts()->createCompany($companyId);
        $auth->accounts()->createPendingUser($userId, BQA_OTHER_CEO_EMAIL);
        $auth->accounts()->createCeoMembership(bin2hex(random_bytes(16)), $userId, $companyId);
        return $userId;
    });
    $activate($issueToken($otherCeoUserId), bqaPassword());           // never stored: B is never signed in
    $otherCeo = $principal($otherCeoUserId);
    $otherEmployee = $employeeView($employees->create($otherCeo, ['employeeCode' => 'BQB-001', 'fullName' => 'Bqb Pegawai Lain', 'jobTitle' => 'Staff QA B', 'monthlyBaseSalary' => '3000000.00'], $rid()));
    $otherTxn = \TamOs\Transaction\TransactionView::transaction($transactions->create($otherCeo, ['kind' => 'expense', 'financialPost' => 'GA', 'category' => 'Other', 'description' => 'BQB other-company ledger entry', 'amount' => '99000.00', 'transactionDate' => $day(6), 'idempotencyKey' => bqaKey()], $rid()));
    $otherRequest = $submit($otherCeo, $requests->create($otherCeo, ['kind' => 'paymentRequest', 'financialPost' => 'GA', 'category' => 'Other', 'description' => 'BQB other-company payment request', 'amount' => '77000.00', 'payee' => 'PT Other Fabricated', 'documentDate' => $today, 'idempotencyKey' => bqaKey()], $rid()));
} catch (\Throwable $e) {
    bqaRefuse('seed_failed_' . $stage);
}

// ---- State for the browser suite: exclusive create, 0600, inside BQA_DIR, never printed. ------
$state = [
    'today' => $today,
    'window' => ['from' => $from, 'to' => $to],
    'ceo' => ['email' => BQA_CEO_EMAIL, 'password' => $ceoPassword],
    'employee' => ['email' => BQA_EMPLOYEE_EMAIL, 'password' => $employeePassword, 'fullName' => 'Bqa Pegawai Satu', 'ownRequestId' => $ownView['id']],
    'colleague' => ['fullName' => 'Bqa Rekan Dua', 'employeeId' => $e2['id']],
    'ledger' => $ledger,
    'distractor' => $distractor + ['id' => $distractorId],
    'requests' => ['payment' => $payment, 'own' => $own, 'colleague' => $colleague],
    'otherCompany' => [
        'employeeId' => $otherEmployee['id'], 'employeeName' => 'Bqb Pegawai Lain',
        'transactionId' => $otherTxn['id'], 'transactionDescription' => 'BQB other-company ledger entry',
        'requestId' => $otherRequest['id'], 'requestVersion' => $otherRequest['version'], 'requestAmount' => $otherRequest['amount'],
        'requestDescription' => 'BQB other-company payment request',
    ],
];
$json = json_encode($state, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
umask(0077);
try {
    $h = @fopen($statePath, 'x');                   // exclusive: fails if anything appeared meanwhile
    $ok = $h !== false && chmod($statePath, 0600) && fwrite($h, $json) === strlen($json) && fclose($h) && (fileperms($statePath) & 0777) === 0600;
} catch (\Throwable $e) {
    $ok = false;
}
if (!$ok) {
    bqaRefuse('state_write_failed');
}
echo '::add-mask::' . $ceoPassword . "\n" . '::add-mask::' . $employeePassword . "\n";
echo 'browser-qa seed: 2 companies, 2 CEOs, 3 employees (1 Employee account), ' . (count($ledger) + 2) . " ledger transactions, 4 finance requests\n";
exit(0);
