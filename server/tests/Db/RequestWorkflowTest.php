<?php
declare(strict_types=1);

/*
 * AWP-01 finance payment requests and reimbursements against the real MariaDB (ADR-016): real login →
 * real session → production routes → RequestService → RequestStore / TransactionStore / AuditLog.
 *
 *   L1–L4  every legal transition succeeds and increments the version; every illegal one (all six
 *          operations on Paid, Rejected and Cancelled included), every stale expectedVersion and an
 *          approve at another amount is 409 with nothing changed and no audit row
 *   R1–R5  create and pay replays answer the original with no row or audit; a key reused with other
 *          values is 409 idempotency_mismatch; a refused pay consumes no key
 *   B1     a database failure injected at each statement after §5 step 4 (the payment insert, the Paid
 *          update, the request audit row, the expense audit row) rolls the whole payment back: zero new
 *          rows in the four tables and the same key then succeeds; and (B-ii, Owner GO 2026-11-18) a
 *          failure at the COMMIT boundary — after both audit rows are acknowledged by the server, with the
 *          COMMIT never reaching it — injected by the test-only COMMIT-boundary fault proxy
 *          (tests/Support/CommitFaultProxy.php; RequestService has no test seam), rolls back the payment, the
 *          expense, the Paid status and version, both audit rows and the key, proven over a direct connection;
 *          the same key then pays exactly once and replays. An unarmed run proves the proxy is transparent.
 *   A1–A7  the §3 matrix for the CEO, the owning Employee, another Employee, a disabled account and an
 *          anonymous caller; identical 404s; the caller is always the owner; 403 before any lookup
 *   V1–V2  a paid-linked expense cannot be voided (409 finance_linked, nothing changed); an unlinked
 *          Phase 1 transaction still can
 *   P1–P5  the report reconciles with the database before and after payment; Approved-not-paid never
 *          enters a total; the documentDate range rule; Phase 1 figures byte-identical across 0041;
 *          REPORT_CAP fails closed
 *
 *   CR-01  (ADR-017, migration 0042) T-H an Employee never sends a post, the CEO's create may omit it and
 *          a post is set or replaced, never cleared; T-A every reimbursement approval names its post and
 *          writes Approved, the final post and the snapshot of the locked row's previous post atomically,
 *          its audit row naming financialPost only when it changed; T-I create idempotency (R2-2 = A);
 *          T-W no later operation changes the post or the snapshot; T-P payment and the report use the
 *          approved post; T-V the Employee never receives a snapshot key
 *
 * Route coverage (RouteHostileCoverageTest): '/api/finance-requests', '/api/finance-request',
 * '/api/finance-requests/create', '/api/finance-requests/update', '/api/finance-requests/submit',
 * '/api/finance-requests/approve', '/api/finance-requests/reject', '/api/finance-requests/cancel',
 * '/api/finance-requests/pay'. Fabricated data only.
 */

use TamOs\Data\Audit\AuditLog;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\BusinessData;
use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Data\DatabaseError;
use TamOs\Data\Migration\Migrator;
use TamOs\Data\Report\FinancialReportStore;
use TamOs\Data\Request\RequestStore;
use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Data\Transaction\TransactionStore;
use TamOs\Http\Response;
use TamOs\Identity\Principal;
use TamOs\Policy\Action;
use TamOs\Policy\Policy;
use TamOs\Policy\Scope;
use TamOs\Report\FinancialReport;
use TamOs\Request\RequestService;
use TamOs\Tests\Support\CommitFaultEvidence;
use TamOs\Tests\Support\CommitFaultEvidenceStore;
use TamOs\Tests\Support\CommitFaultProxyProcess;
use TamOs\Tests\Support\CommitFaultRelay;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\authKernel;
use function TamOs\Tests\envelope;
use function TamOs\Tests\loginRequest;
use function TamOs\Tests\migrationFixture;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\requestId;
use function TamOs\Tests\sessionCookieToken;
use function TamOs\Tests\sessionRequest;
use function TamOs\Tests\testDatabase;
use function TamOs\Tests\testDbConfig;

require_once dirname(__DIR__) . '/Support/CommitFaultProxy.php';

const AWP01_LIST = '/api/finance-requests';
const AWP01_READ = '/api/finance-request';
const AWP01_WRITES = ['create' => '/api/finance-requests/create', 'update' => '/api/finance-requests/update', 'submit' => '/api/finance-requests/submit',
    'approve' => '/api/finance-requests/approve', 'reject' => '/api/finance-requests/reject', 'cancel' => '/api/finance-requests/cancel', 'pay' => '/api/finance-requests/pay'];

/**
 * Company A: a CEO, e_a1 and e_a2 (Employee logins) and e_a3 (an Employee login disabled on demand).
 * Company B: a CEO and e_b1.
 */
$world = static function (): array {
    $db = authDatabase();
    $config = testDbConfig();
    $k = authKernel($config, AuthData::fromDatabase($db), productionMigrationsDir());
    $ceoA = authFixture($db);
    $ceoB = authFixture($db);
    $a = $ceoA['companyId'];
    $f = ['ceoA' => $ceoA, 'ceoB' => $ceoB,
        'empA1' => authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a1']),
        'empA2' => authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a2']),
        'empA3' => authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a3']),
        'empB1' => authFixture($db, ['companyId' => $ceoB['companyId'], 'role' => 'employee', 'employeeId' => 'e_b1'])];
    $s = [];
    foreach ($f as $name => $x) {
        $r = $k->handle(loginRequest($x['email'], (string) $x['password']), requestId());
        assertSame(200, $r->status, 'login ' . $name);
        $s[$name] = ['token' => (string) sessionCookieToken($r), 'csrf' => (string) envelope($r)['data']['csrfToken']];
    }
    return ['db' => $db, 'k' => $k, 'log' => $config->logPath, 'a' => $a, 'b' => $ceoB['companyId'], 'f' => $f, 's' => $s];
};
$get = static fn (array $w, ?string $who, string $path, string $query): Response
    => $w['k']->handle(sessionRequest('GET', $path, $who === null ? null : $w['s'][$who]['token'], null, '', ['query' => $query]), requestId());
$post = static fn (array $w, ?string $who, string $path, array $body): Response
    => $w['k']->handle(sessionRequest('POST', $path, $who === null ? null : $w['s'][$who]['token'], $who === null ? null : $w['s'][$who]['csrf'], json_encode($body, JSON_THROW_ON_ERROR)), requestId());
$ok = static function (Response $r, string $label): array {
    assertSame(200, $r->status, $label . ' (' . substr($r->body, 0, 300) . ')');
    return envelope($r)['data'];
};
$code = static fn (Response $r): array => [$r->status, envelope($r)['error']['code'] ?? null];
/** The fixed internal reason of the last access-log line (never sent to the browser). */
$reason = static function (array $w): ?string {
    $lines = array_values(array_filter(explode("\n", is_file($w['log']) ? (string) file_get_contents($w['log']) : '')));
    return $lines === [] ? null : (json_decode((string) end($lines), true)['reason'] ?? null);
};
$key = static fn (): string => bin2hex(random_bytes(16));
$pr = static fn (array $over = []): array => $over + ['kind' => 'paymentRequest', 'financialPost' => 'GA', 'category' => 'Vendor', 'description' => 'Fabricated printer toner',
    'amount' => '450000.00', 'payee' => 'CV Fiktif Sejahtera', 'documentDate' => '2026-10-10', 'idempotencyKey' => bin2hex(random_bytes(16))];
// CR-01 (ADR-017) authorized revision: a reimbursement body carries no Financial Post (an Employee may not send one;
// the CEO's is optional) — the approval assigns it ($args). Was: 'financialPost' => 'TJB' in every reimbursement body.
$rb = static fn (array $over = []): array => $over + ['kind' => 'reimbursement', 'category' => 'Transport', 'description' => 'Fabricated taxi fare',
    'amount' => '125000.00', 'documentDate' => '2026-10-08', 'idempotencyKey' => bin2hex(random_bytes(16))];
$create = static fn (array $w, string $who, array $body): Response => $post($w, $who, AWP01_WRITES['create'], $body);
$op = static fn (array $w, string $who, string $operation, array $body): Response => $post($w, $who, AWP01_WRITES[$operation], $body);
/** The body of $operation on $r at its current version (expectedAmount, reason and payment as the operation needs). */
$args = static function (string $operation, array $r, array $over = []): array {
    $b = ['financeRequestId' => $r['id'], 'expectedVersion' => $r['version']];
    $b += match ($operation) {
        'update' => ['description' => $r['description'] . ' (edited)'],
        // CR-01 (ADR-017 D6) authorized revision: a reimbursement approval names its post — the stored one, or TJB
        // (the post these tests used before ADR-017) when none is assigned yet. Was: ['expectedAmount'] only.
        'approve' => ['expectedAmount' => $r['amount']] + ($r['kind'] === 'reimbursement' ? ['financialPost' => $r['financialPost'] ?? 'TJB'] : []),
        'reject', 'cancel' => ['reason' => 'Fabricated reason'],
        'pay' => ['expectedAmount' => $r['amount'], 'paidOn' => '2026-10-20', 'paymentMethod' => 'bankTransfer', 'idempotencyKey' => bin2hex(random_bytes(16))],
        default => [],
    };
    return $over + $b;
};
/** A CEO payment request driven to $status through the API. */
$at = static function (array $w, string $status, array $body = []) use ($create, $op, $args, $ok, $pr): array {
    $r = $ok($create($w, 'ceoA', $pr($body)), 'create')['financeRequest'];
    $path = ['Draft' => [], 'Submitted' => ['submit'], 'Approved' => ['submit', 'approve'], 'Paid' => ['submit', 'approve', 'pay'],
        'Rejected' => ['submit', 'reject'], 'Cancelled' => ['cancel']][$status];
    foreach ($path as $step) {
        $r = $ok($op($w, 'ceoA', $step, $args($step, $r)), $step)['financeRequest'];
    }
    assertSame($status, $r['status'], 'driven to ' . $status);
    return $r;
};
$tables = ['finance_requests', 'finance_request_payments', 'finance_transactions', 'audit_events'];
$rows = static fn (Database $db): array => array_map(static fn (string $t): array => $db->select('SELECT * FROM `' . $t . '` ORDER BY id'), $tables);
$counts = static fn (Database $db): array => array_map(static fn (string $t): int => (int) $db->select('SELECT COUNT(*) AS n FROM `' . $t . '`')[0]['n'], $tables);
$audits = static fn (Database $db, string $id): array => array_map(static fn (array $r): string => $r['action'] . ' ' . $r['entity'] . ' ' . ($r['operation'] ?? '-') . ' ' . ($r['fields'] ?? '-'),
    $db->select('SELECT action, entity, operation, fields FROM audit_events WHERE entity_id = ? ORDER BY id', [$id]));
/** B-ii: the wire text of the five pay statements of §5 steps 4–7 (company scope), in order. */
$b1Expected = array_map(static fn (string $sql): string => CommitFaultProxyProcess::wireSql($sql),
    [TransactionStore::INSERT_SQL, RequestStore::INSERT_PAYMENT_SQL, RequestStore::TRANSITION_SQL, AuditLog::APPEND_REQUEST_SQL, AuditLog::APPEND_TRANSACTION_SQL]);
/** B-ii: starts the proxy in front of the guarded test database; returns it and a Database that connects through it. */
$b1Proxy = static function (bool $armed, array $snapshot) use ($b1Expected): array {
    $db = testDbConfig()->db;
    $proxy = CommitFaultProxyProcess::start(['armed' => $armed, 'expected' => $armed ? $b1Expected : [], 'upstreamHost' => $db['host'],
        'upstreamPort' => $db['port'], 'observer' => 'db', 'snapshot' => $snapshot, 'lifetimeSeconds' => 60]);
    return [$proxy, new Database(DatabaseConfig::fromArray(['host' => '127.0.0.1', 'port' => $proxy->port] + $db))];
};
$b1Ceo = static function (array $w): Principal {
    $f = $w['f']['ceoA'];
    return Principal::fromAccount(['user_id' => $f['userId'], 'user_status' => 'active', 'has_password' => true],
        [['membership_id' => $f['membershipId'], 'company_id' => $f['companyId'], 'role' => 'ceo', 'employee_id' => null, 'membership_status' => 'active']]) ?? throw new \LogicException('fixture');
};
$report = static fn (array $w, string $from, string $to) => $ok($get($w, 'ceoA', '/api/reports/financial', 'from=' . $from . '&to=' . $to), 'report ' . $from)['financialReport'];
$withoutPending = static function (array $r): array {
    unset($r['approvedNotPaid']);
    return $r;
};

return [
    'L1: every legal transition succeeds, increments the version by one and writes its audit row(s)' => static function () use ($world, $create, $op, $args, $ok, $pr, $rb, $audits): void {
        $w = $world();
        $r = $ok($create($w, 'ceoA', $pr()), 'create')['financeRequest'];
        assertSame(['Draft', 1, null, null], [$r['status'], $r['version'], $r['employeeId'], $r['payment']]);
        $steps = [['update', 'Draft'], ['submit', 'Submitted'], ['approve', 'Approved'], ['pay', 'Paid']];
        foreach ($steps as [$step, $status]) {
            $next = $ok($op($w, 'ceoA', $step, $args($step, $r)), $step)['financeRequest'];
            assertSame([$status, $r['version'] + 1], [$next['status'], $next['version']], $step);
            $r = $next;
        }
        assertSame(['finance.manage financeRequest create financialPost,category,description,amount,payee,documentDate', 'finance.manage financeRequest update description',
            'finance.manage financeRequest submit -', 'finance.manage financeRequest approve -', 'finance.execute financeRequest pay -'], $audits($w['db'], $r['id']), 'one audit row per transition');
        assertSame(['finance.execute financeTransaction create -'], $audits($w['db'], $r['payment']['financeTransactionId']), 'the linked expense is audited once');
        foreach ([['Draft', 'cancel'], ['Submitted', 'cancel'], ['Approved', 'cancel'], ['Submitted', 'reject']] as [$from, $step]) {
            $x = $ok($create($w, 'ceoA', $pr()), 'create')['financeRequest'];
            foreach (['Draft' => [], 'Submitted' => ['submit'], 'Approved' => ['submit', 'approve']][$from] as $pre) {
                $x = $ok($op($w, 'ceoA', $pre, $args($pre, $x)), $pre)['financeRequest'];
            }
            $y = $ok($op($w, 'ceoA', $step, $args($step, $x)), $from . ' ' . $step)['financeRequest'];
            assertSame([$step === 'reject' ? 'Rejected' : 'Cancelled', $x['version'] + 1, 'Fabricated reason'], [$y['status'], $y['version'], $y['statusReason']], $from . ' → ' . $step);
        }
        $m = $ok($create($w, 'empA1', $rb()), 'own reimbursement')['financeRequest'];
        $m = $ok($op($w, 'empA1', 'update', $args('update', $m)), 'own update')['financeRequest'];
        $m = $ok($op($w, 'empA1', 'submit', $args('submit', $m)), 'own submit')['financeRequest'];
        assertSame(['Submitted', 3, 'e_a1'], [$m['status'], $m['version'], $m['employeeId']]);
        // CR-01 (ADR-017) authorized revision: an Employee Draft is created without a post. Was: '- financialPost,category,…'.
        assertSame(['reimbursement.createSelfDraft financeRequest - category,description,amount,documentDate', 'reimbursement.updateSelfDraft financeRequest - description',
            'reimbursement.submitSelf financeRequest submit -'], $audits($w['db'], $m['id']), 'the self actions are audited under their own names');
    },

    'L2: every illegal transition is 409 with no change and no audit row — every operation on Paid, Rejected and Cancelled included' => static function () use ($world, $op, $args, $at, $code, $rows): void {
        $w = $world();
        $legal = ['Draft' => ['update', 'submit', 'cancel'], 'Submitted' => ['approve', 'reject', 'cancel'], 'Approved' => ['cancel', 'pay'], 'Paid' => [], 'Rejected' => [], 'Cancelled' => []];
        foreach ($legal as $status => $ok) {
            $r = $at($w, $status);
            foreach (array_diff(array_keys(AWP01_WRITES), ['create'], $ok) as $operation) {
                $before = $rows($w['db']);
                assertSame([409, 'conflict'], $code($op($w, 'ceoA', $operation, $args($operation, $r))), $operation . ' on ' . $status);
                assertSame($before, $rows($w['db']), $operation . ' on ' . $status . ': nothing changed, no audit row');
            }
        }
    },

    'L3: a stale expectedVersion is 409 for every transition; L4: approve at another amount is 409' => static function () use ($world, $op, $args, $at, $code, $rows, $reason): void {
        $w = $world();
        foreach (['update' => 'Draft', 'submit' => 'Draft', 'approve' => 'Submitted', 'reject' => 'Submitted', 'cancel' => 'Approved', 'pay' => 'Approved'] as $operation => $status) {
            $r = $at($w, $status, ['description' => 'Fabricated stale ' . $operation]);
            foreach (array_filter([$r['version'] - 1, $r['version'] + 1], static fn (int $v): bool => $v >= 1) as $stale) {
                $before = $rows($w['db']);
                assertSame([409, 'conflict'], $code($op($w, 'ceoA', $operation, $args($operation, $r, ['expectedVersion' => $stale]))), $operation . ' at version ' . $stale);
                assertSame('finance_request_version', $reason($w), $operation . ': the version guard');
                assertSame($before, $rows($w['db']), $operation . ' stale: nothing changed');
            }
        }
        $r = $at($w, 'Submitted');
        foreach (['450001.00', '449999.00', '1.00'] as $amount) {
            $before = $rows($w['db']);
            assertSame([409, 'conflict'], $code($op($w, 'ceoA', 'approve', $args('approve', $r, ['expectedAmount' => $amount]))), 'approve at ' . $amount);
            assertSame('finance_request_amount', $reason($w));
            assertSame($before, $rows($w['db']), 'approve at another amount: nothing changed');
        }
    },

    'R1/R2: a create replay answers the original (no row, no audit); the key reused with other values is 409 idempotency_mismatch' => static function () use ($world, $create, $ok, $pr, $rb, $code, $counts, $reason, $key): void {
        $w = $world();
        foreach (['ceoA payment request' => ['ceoA', $pr(['idempotencyKey' => $key()])], 'ceoA reimbursement' => ['ceoA', $rb(['employeeId' => 'e_a2', 'idempotencyKey' => $key()])],
            'empA1 reimbursement' => ['empA1', $rb(['idempotencyKey' => $key()])]] as $label => [$who, $body]) {
            $first = $ok($create($w, $who, $body), $label)['financeRequest'];
            $n = $counts($w['db']);
            $again = $ok($create($w, $who, $body), $label . ' replay')['financeRequest'];
            assertSame($first, $again, $label . ': the same request');
            assertSame($n, $counts($w['db']), $label . ': no row, no audit');
            // CR-01 (ADR-017) authorized revision: an Employee body may not carry a post at all (400, before the key is
            // read); the CEO's reimbursement without one differs from a retry naming one. Was: financialPost for every creator.
            $differs = ['amount' => '1000.00', 'description' => 'Fabricated other', 'documentDate' => '2026-10-09'] + ($who === 'empA1' ? [] : ['financialPost' => 'NPIP']);
            foreach ($differs as $field => $value) {
                assertSame([409, 'conflict'], $code($create($w, $who, [$field => $value] + $body)), $label . ': ' . $field . ' differs');
                assertSame('idempotency_mismatch', $reason($w), $label . ': ' . $field);
            }
            if ($who === 'empA1') {
                assertSame([400, 'validation_failed'], $code($create($w, $who, ['financialPost' => 'NPIP'] + $body)), $label . ': an Employee naming a post is 400 (ADR-017)');
            }
            assertSame($n, $counts($w['db']), $label . ': the mismatches wrote nothing');
        }
        $k = $key();
        $ok($create($w, 'ceoA', $rb(['employeeId' => 'e_a1', 'idempotencyKey' => $k])), 'for e_a1');
        assertSame([409, 'conflict'], $code($create($w, 'ceoA', $rb(['employeeId' => 'e_a2', 'idempotencyKey' => $k]))), 'the same key for another owner');
        assertSame([409, 'conflict'], $code($create($w, 'ceoA', $pr(['idempotencyKey' => $k]))), 'the same key for another kind');
    },

    'R3/R4/R5: a pay replay answers the payment (no second expense, no audit); other values are 409; a refused pay consumes no key' => static function () use ($world, $op, $args, $at, $ok, $code, $counts, $rows, $reason, $key): void {
        $w = $world();
        $r = $at($w, 'Approved');
        $body = $args('pay', $r);
        $paid = $ok($op($w, 'ceoA', 'pay', $body), 'pay')['financeRequest'];
        $n = $counts($w['db']);
        assertSame($paid, $ok($op($w, 'ceoA', 'pay', $body), 'replay')['financeRequest'], 'R3: the same Paid request and payment');
        assertSame($n, $counts($w['db']), 'R3: no second payment, expense or audit row');
        foreach (['paidOn' => '2026-10-21', 'paymentMethod' => 'cash', 'expectedAmount' => '450001.00'] as $field => $value) {
            assertSame([409, 'conflict'], $code($op($w, 'ceoA', 'pay', [$field => $value] + $body)), 'R4: ' . $field . ' differs');
            assertSame('idempotency_mismatch', $reason($w), 'R4: ' . $field);
        }
        assertSame($n, $counts($w['db']), 'R4: the mismatches wrote nothing');
        $other = $at($w, 'Approved');
        $n = $counts($w['db']);
        assertSame([409, 'conflict'], $code($op($w, 'ceoA', 'pay', $args('pay', $other, ['idempotencyKey' => $body['idempotencyKey']]))), 'R4: the key on another request');
        assertSame('idempotency_mismatch', $reason($w));
        assertSame($n, $counts($w['db']), 'R4: nothing written');
        // R5: wrong amount, wrong status, stale version — then the same key succeeds once.
        $k = $key();
        $sub = $at($w, 'Submitted');
        foreach (['wrong amount' => [$other, ['expectedAmount' => '1.00']], 'stale version' => [$other, ['expectedVersion' => $other['version'] - 1]], 'not Approved' => [$sub, []]] as $label => [$target, $over]) {
            $before = $rows($w['db']);
            assertSame([409, 'conflict'], $code($op($w, 'ceoA', 'pay', $args('pay', $target, ['idempotencyKey' => $k] + $over))), 'R5: ' . $label);
            assertSame($before, $rows($w['db']), 'R5: ' . $label . ' writes nothing');
        }
        $p = $ok($op($w, 'ceoA', 'pay', $args('pay', $other, ['idempotencyKey' => $k])), 'R5: the unconsumed key')['financeRequest'];
        assertSame('Paid', $p['status']);
        assertSame(1, (int) $w['db']->select('SELECT COUNT(*) AS n FROM finance_request_payments WHERE idempotency_key = ?', [$k])[0]['n'], 'R5: the key is used once');
    },

    'B1: a failure injected after §5 step 4, 5, 6 and 7 rolls the payment back whole; the same key then succeeds' => static function () use ($world, $op, $args, $at, $ok, $code, $counts, $rows): void {
        // Each injection is a test-only CHECK (DDL before the request, dropped after) that refuses exactly
        // the next statement of §5: after step 4 the payment insert (5); after 5 the Paid update (6); after 6
        // the request audit row (7a); after 7a the expense audit row (7b), the last write before commit.
        $points = [
            'after step 4 (the expense is inserted; the payment insert fails)' => static fn (array $r): array => ['finance_request_payments', "payment_method <> 'other'"],
            'after step 5 (the payment is inserted; the Paid update fails)' => static fn (array $r): array => ['finance_requests', "NOT (status = 'Paid' AND id = '" . $r['id'] . "')"],
            'after step 6 (the request is Paid; its audit row fails)' => static fn (array $r): array => ['audit_events', "NOT (action = 'finance.execute' AND entity = 'financeRequest' AND entity_id = '" . $r['id'] . "')"],
            'after step 7a (the request audit row is written; the expense audit row fails)' => static fn (array $r): array => ['audit_events', "NOT (action = 'finance.execute' AND entity = 'financeTransaction' AND operation = 'create')"],
        ];
        foreach ($points as $label => $block) {
            $w = $world();
            $r = $at($w, 'Approved');
            $body = $args('pay', $r, ['paymentMethod' => 'other']);
            [$table, $check] = $block($r);
            assertTrue(preg_match('/^[a-z_]+$/', $table) === 1 && preg_match('/^[A-Za-z0-9_. \'=<>()]+$/', $check) === 1, 'test-only DDL');
            $before = $rows($w['db']);
            $w['db']->execute('ALTER TABLE `' . $table . '` ADD CONSTRAINT test_block_b1 CHECK (' . $check . ')');
            try {
                assertSame([500, 'internal_error'], $code($op($w, 'ceoA', 'pay', $body)), $label . ': the injected failure');
            } finally {
                $w['db']->execute('ALTER TABLE `' . $table . '` DROP CONSTRAINT test_block_b1');
            }
            assertSame($before, $rows($w['db']), $label . ': zero new rows in the four tables, the request still Approved');
            assertSame(0, (int) $w['db']->select('SELECT COUNT(*) AS n FROM finance_request_payments WHERE idempotency_key = ?', [$body['idempotencyKey']])[0]['n'], $label . ': no consumed key');
            $n = $counts($w['db']);
            $paid = $ok($op($w, 'ceoA', 'pay', $body), $label . ': the same key once the failure is gone')['financeRequest'];
            assertSame('Paid', $paid['status']);
            assertSame([$n[0], $n[1] + 1, $n[2] + 1, $n[3] + 2], $counts($w['db']), $label . ': then exactly one payment, one expense, two audit rows');
        }
    },

    'B1 (B-ii): a failure at the COMMIT boundary — both audit rows acknowledged, the COMMIT never reaching MariaDB — rolls everything back; the same key then pays once and replays' => static function () use ($world, $op, $args, $at, $ok, $counts, $rows, $audits, $tables, $b1Expected, $b1Proxy, $b1Ceo): void {
        $w = $world();
        $r = $at($w, 'Approved');
        $body = $args('pay', $r);
        $before = $rows($w['db']);
        $n = $counts($w['db']);
        // What the proxy's observer reads on its own connection at READ UNCOMMITTED while the COMMIT is held.
        $snapshot = [];
        foreach ($tables as $t) {
            $snapshot['count ' . $t] = ['SELECT COUNT(*) AS n FROM `' . $t . '`', []];
        }
        $snapshot['request'] = ['SELECT status, version FROM finance_requests WHERE id = ?', [$r['id']]];
        $snapshot['payment'] = ['SELECT finance_transaction_id AS t FROM finance_request_payments WHERE idempotency_key = ?', [$body['idempotencyKey']]];
        $snapshot['request audit'] = ['SELECT action, entity, operation, fields FROM audit_events WHERE entity_id = ? ORDER BY id', [$r['id']]];
        $snapshot['expense audit'] = ['SELECT action, entity, operation, fields FROM audit_events WHERE entity_id = (SELECT finance_transaction_id FROM finance_request_payments WHERE idempotency_key = ?) ORDER BY id', [$body['idempotencyKey']]];
        [$proxy, $proxied] = $b1Proxy(true, $snapshot);
        $ceo = $b1Ceo($w);
        $e = (static function () use ($proxied, $ceo, $body): \Throwable {
            $service = new RequestService(BusinessData::fromDatabase($proxied));
            return assertThrows(DatabaseError::class, static fn () => $service->pay($ceo, $body, requestId()), 'the intercepted COMMIT fails the pay');
        })();
        unset($proxied);                                                    // closes the proxied connection
        $out = $proxy->stop();
        assertSame([DatabaseError::FAILURE, 'commit', CommitFaultRelay::INJECTED_SQLSTATE, CommitFaultRelay::INJECTED_CODE], [$e->kind, $e->operation, $e->sqlstate, $e->driverCode],
            'the pay failed on the injected COMMIT error and on nothing else');
        // Criteria 3, 4 and 5 at the wire: the five statements acknowledged with OK, one row and an open transaction;
        // nothing but COM_STMT_CLOSE before the COMMIT; the COMMIT never forwarded; the ROLLBACK forwarded and
        // acknowledged with the transaction closed; the observer saw the transaction open, then gone.
        assertSame([], CommitFaultEvidenceStore::retainedProblems($out), 'retained proxy evidence');
        echo '    B1 evidence: ' . $out['evidence']['path'] . ' sha256=' . $out['evidence']['sha256'] . "\n";
        $poll = array_values(array_filter((array) ($out['result']['events'] ?? []), static fn (array $x): bool => $x['type'] === 'observation' && ($x['phase'] ?? null) === 'after-rollback'))[0]['data']['poll'] ?? null;
        echo '    B1 after-rollback poll: ' . json_encode($poll, JSON_UNESCAPED_SLASHES) . "\n";
        assertSame([], CommitFaultEvidence::armedProblems($out['result'], $b1Expected, $out['exitCode']), 'proxy evidence (' . trim($out['stderr']) . ')');
        $obs = array_values(array_filter($out['result']['events'], static fn (array $x): bool => $x['type'] === 'observation' && $x['phase'] === 'intercept'))[0]['data'];
        assertSame(['RUNNING', 'READ COMMITTED', 5], [$obs['trx'][0]['state'], $obs['trx'][0]['isolation'], (int) $obs['trx'][0]['rows_modified']], 'the open pay transaction on the proxied connection: READ COMMITTED, five rows modified');
        // Criteria 1–3 from the observer's dirty read: written inside the transaction, before COMMIT.
        $snap = $obs['snapshot'];
        $life = ['finance.manage financeRequest create financialPost,category,description,amount,payee,documentDate', 'finance.manage financeRequest submit -', 'finance.manage financeRequest approve -'];
        $line = static fn (array $a): string => $a['action'] . ' ' . $a['entity'] . ' ' . ($a['operation'] ?? '-') . ' ' . ($a['fields'] ?? '-');
        assertSame([$n[0], $n[1] + 1, $n[2] + 1, $n[3] + 2], array_map(static fn (string $t): int => (int) $snap['count ' . $t][0]['n'], $tables), 'inside: one payment, one expense, two audit rows');
        assertSame(['Paid', $r['version'] + 1], [(string) $snap['request'][0]['status'], (int) $snap['request'][0]['version']], 'inside: Paid at version + 1');
        assertSame(1, count($snap['payment']), 'inside: the payment holds the key');
        assertSame(array_merge($life, ['finance.execute financeRequest pay -']), array_map($line, $snap['request audit']), 'inside: the request pay audit row');
        assertSame(['finance.execute financeTransaction create -'], array_map($line, $snap['expense audit']), 'inside: the expense audit row');
        // Criteria 5 and 6 over a direct connection that bypasses the proxy.
        assertSame($before, $rows($w['db']), 'after the rollback: no payment, no expense, the request Approved at its version, no audit row');
        assertSame(0, (int) $w['db']->select('SELECT COUNT(*) AS n FROM finance_request_payments WHERE idempotency_key = ?', [$body['idempotencyKey']])[0]['n'], 'no consumed key');
        assertSame($life, $audits($w['db'], $r['id']), 'the request history has no pay row');
        // Criteria 7 and 8, direct, through the production service.
        $paid = $ok($op($w, 'ceoA', 'pay', $body), 'the same key through the production service')['financeRequest'];
        assertSame(['Paid', $r['version'] + 1], [$paid['status'], $paid['version']]);
        assertSame([$n[0], $n[1] + 1, $n[2] + 1, $n[3] + 2], $counts($w['db']), 'exactly one payment, one expense and two audit rows');
        $after = $rows($w['db']);
        assertSame($paid, $ok($op($w, 'ceoA', 'pay', $body), 'replay')['financeRequest'], 'the replay answers the payment');
        assertSame($after, $rows($w['db']), 'the replay writes nothing');
    },

    'B1 (B-ii control): unarmed, the same pay through the proxy commits normally — the proxy is transparent' => static function () use ($world, $args, $at, $counts, $b1Proxy, $b1Ceo): void {
        $w = $world();
        $r = $at($w, 'Approved');
        $body = $args('pay', $r);
        $n = $counts($w['db']);
        [$proxy, $proxied] = $b1Proxy(false, []);
        $ceo = $b1Ceo($w);
        $paid = (static fn (): array => (new RequestService(BusinessData::fromDatabase($proxied)))->pay($ceo, $body, requestId()))();
        unset($proxied);
        $out = $proxy->stop();
        assertSame([], CommitFaultEvidenceStore::retainedProblems($out), 'retained proxy evidence');
        echo '    B1 control evidence: ' . $out['evidence']['path'] . ' sha256=' . $out['evidence']['sha256'] . "\n";
        assertSame([], CommitFaultEvidence::transparentProblems($out['result'], $out['exitCode']), 'transparent (' . trim($out['stderr']) . ')');
        assertSame(['Paid', $r['version'] + 1], [$paid['status'], $paid['version']], 'paid through the proxy');
        assertSame([$n[0], $n[1] + 1, $n[2] + 1, $n[3] + 2], $counts($w['db']), 'committed, read over a direct connection');
    },

    'A1: the §3 matrix — CEO, owning Employee, another Employee, a disabled account and an anonymous caller' => static function () use ($world, $get, $post, $create, $op, $args, $ok, $code, $pr, $rb, $at): void {
        $w = $world();
        $own = $ok($create($w, 'empA1', $rb()), 'own create')['financeRequest'];
        $ok($get($w, 'empA1', AWP01_READ, 'id=' . $own['id']), 'own read');
        $ok($get($w, 'ceoA', AWP01_READ, 'id=' . $own['id']), 'CEO reads a reimbursement');
        $ok($get($w, 'ceoA', AWP01_LIST, 'from=2026-10-01&to=2026-10-31'), 'CEO list');
        $ok($get($w, 'empA1', AWP01_LIST, 'from=2026-10-01&to=2026-10-31'), 'Employee list');
        $ceoMade = $ok($create($w, 'ceoA', $rb(['employeeId' => 'e_a1'])), 'CEO creates a reimbursement for e_a1')['financeRequest'];
        assertSame(['e_a1', $w['f']['ceoA']['userId']], [$ceoMade['employeeId'], $ceoMade['createdByUserId']], 'owner e_a1, creator the CEO');
        $ok($op($w, 'empA1', 'update', $args('update', $ceoMade)), 'the owner edits their Draft');
        assertSame([404, 'not_found'], $code($op($w, 'empA2', 'update', $args('update', $own))), 'another Employee: update');
        assertSame([404, 'not_found'], $code($op($w, 'empA2', 'submit', $args('submit', $own))), 'another Employee: submit');
        assertSame([404, 'not_found'], $code($get($w, 'empA2', AWP01_READ, 'id=' . $own['id'])), 'another Employee: read');
        assertSame([404, 'not_found'], $code($get($w, 'empB1', AWP01_READ, 'id=' . $own['id'])), 'another company\'s Employee: read');
        assertSame([404, 'not_found'], $code($get($w, 'ceoB', AWP01_READ, 'id=' . $own['id'])), 'another company\'s CEO: read');
        assertSame([403, 'forbidden'], $code($create($w, 'empA1', $pr())), 'an Employee cannot create a payment request');
        $w['db']->execute("UPDATE users SET status = 'disabled' WHERE id = ?", [$w['f']['empA3']['userId']]);
        $submitted = $at($w, 'Submitted');
        foreach (['empA3' => 'a disabled account', null => 'an anonymous caller'] as $who => $label) {
            $who = $who === '' ? null : $who;
            assertSame([401, 'unauthenticated'], $code($get($w, $who, AWP01_LIST, 'from=2026-10-01&to=2026-10-31')), $label . ': list');
            assertSame([401, 'unauthenticated'], $code($get($w, $who, AWP01_READ, 'id=' . $own['id'])), $label . ': read');
            foreach (AWP01_WRITES as $operation => $path) {
                $body = $operation === 'create' ? $rb() : $args($operation, $submitted);
                assertSame([401, 'unauthenticated'], $code($post($w, $who, $path, $body)), $label . ': ' . $operation);
            }
        }
        $ok($op($w, 'ceoA', 'approve', $args('approve', $submitted)), 'the CEO approves');
    },

    'A2: an Employee is 404 — with identical bodies — for another employee\'s reimbursement, any payment request and a non-existent id' => static function () use ($world, $get, $op, $args, $create, $ok, $rb, $at): void {
        $w = $world();
        $theirs = $ok($create($w, 'empA2', $rb()), 'e_a2 creates')['financeRequest'];
        $payment = $at($w, 'Draft');
        $absent = array_merge($theirs, ['id' => bin2hex(random_bytes(16))]);
        $bodies = [];
        foreach (['another employee\'s reimbursement' => $theirs, 'a payment request' => $payment, 'a non-existent id' => $absent] as $label => $r) {
            foreach (['read' => $get($w, 'empA1', AWP01_READ, 'id=' . $r['id']), 'update' => $op($w, 'empA1', 'update', $args('update', $r)), 'submit' => $op($w, 'empA1', 'submit', $args('submit', $r))] as $how => $resp) {
                assertSame(404, $resp->status, $label . ': ' . $how);
                $e = envelope($resp);
                unset($e['requestId']);
                $bodies[$how][] = json_encode($e);
            }
        }
        foreach ($bodies as $how => $list) {
            assertSame(1, count(array_unique($list)), $how . ': the three 404 bodies are identical');
        }
    },

    'A3: an Employee create body naming an employee is 400 and the stored owner is always the caller; A4: editing or submitting their own non-Draft is 403' => static function () use ($world, $create, $op, $args, $ok, $code, $rb, $counts): void {
        $w = $world();
        $n = $counts($w['db']);
        foreach (['e_a2', 'e_a1', 'e_b1'] as $e) {
            assertSame([400, 'validation_failed'], $code($create($w, 'empA1', $rb(['employeeId' => $e]))), 'employeeId ' . $e);
        }
        assertSame($n, $counts($w['db']), 'nothing written');
        $mine = $ok($create($w, 'empA1', $rb()), 'own create')['financeRequest'];
        assertSame(['e_a1', $w['f']['empA1']['userId']], [$mine['employeeId'], $mine['createdByUserId']], 'the caller is owner and creator');
        assertSame('e_a1', (string) $w['db']->select('SELECT owner_employee_id AS o FROM finance_requests WHERE id = ?', [$mine['id']])[0]['o']);
        $sub = $ok($op($w, 'empA1', 'submit', $args('submit', $mine)), 'own submit')['financeRequest'];
        foreach (['update', 'submit'] as $operation) {
            assertSame([403, 'forbidden'], $code($op($w, 'empA1', $operation, $args($operation, $sub))), 'A4: own Submitted: ' . $operation);
        }
        $appr = $ok($op($w, 'ceoA', 'approve', $args('approve', $sub)), 'CEO approves')['financeRequest'];
        $cancelled = $ok($op($w, 'ceoA', 'cancel', $args('cancel', $appr)), 'CEO cancels')['financeRequest'];
        foreach ([$appr, $cancelled] as $r) {
            foreach (['update', 'submit'] as $operation) {
                assertSame([403, 'forbidden'], $code($op($w, 'empA1', $operation, $args($operation, $r))), 'A4: own ' . $r['status'] . ': ' . $operation);
            }
        }
    },

    'A5: an Employee is 403 for approve, reject, cancel and pay, before any lookup' => static function () use ($world, $op, $args, $create, $ok, $rb, $code, $rows): void {
        $w = $world();
        $own = $ok($create($w, 'empA1', $rb()), 'own')['financeRequest'];
        $absent = array_merge($own, ['id' => bin2hex(random_bytes(16))]);
        $before = $rows($w['db']);
        foreach (['approve', 'reject', 'cancel', 'pay'] as $operation) {
            foreach (['their own Draft' => $own, 'a non-existent id' => $absent] as $label => $r) {
                assertSame([403, 'forbidden'], $code($op($w, 'empA1', $operation, $args($operation, $r))), $operation . ' on ' . $label);
            }
        }
        assertSame($before, $rows($w['db']), 'nothing written');
    },

    'A7: an Employee list returns only their own reimbursements across two employees and three statuses' => static function () use ($world, $get, $create, $op, $args, $ok, $rb, $at): void {
        $w = $world();
        $mine = [];
        foreach (['empA1', 'empA2'] as $who) {
            foreach (['Draft', 'Submitted', 'Approved'] as $status) {
                $r = $ok($create($w, $who, $rb(['description' => 'Fabricated ' . $who . ' ' . $status])), 'create')['financeRequest'];
                if ($status !== 'Draft') {
                    $r = $ok($op($w, $who, 'submit', $args('submit', $r)), 'submit')['financeRequest'];
                }
                if ($status === 'Approved') {
                    $r = $ok($op($w, 'ceoA', 'approve', $args('approve', $r)), 'approve')['financeRequest'];
                }
                $mine[$who][] = $r['id'];
            }
        }
        $at($w, 'Approved');
        $list = $ok($get($w, 'empA1', AWP01_LIST, 'from=2026-10-01&to=2026-10-31'), 'e_a1 list')['financeRequests'];
        $ids = array_column($list, 'id');
        sort($ids);
        $expect = $mine['empA1'];
        sort($expect);
        assertSame($expect, $ids, 'exactly e_a1\'s three reimbursements');
        assertSame(['e_a1'], array_values(array_unique(array_column($list, 'employeeId'))));
        assertSame(7, count($ok($get($w, 'ceoA', AWP01_LIST, 'from=2026-10-01&to=2026-10-31'), 'CEO list')['financeRequests']), 'the CEO sees the company');
        assertSame(1, count($ok($get($w, 'empA1', AWP01_LIST, 'from=2026-10-01&to=2026-10-31&status=Approved'), 'filtered')['financeRequests']), 'a status filter keeps the self scope');
        assertSame(0, count($ok($get($w, 'empA1', AWP01_LIST, 'from=2026-10-01&to=2026-10-31&kind=paymentRequest'), 'kind')['financeRequests']), 'no payment request is ever listed for an Employee');
        assertSame(0, count($ok($get($w, 'ceoB', AWP01_LIST, 'from=2026-10-01&to=2026-10-31'), 'company B')['financeRequests']), 'another company sees none');
    },

    'R1 = A: a reimbursement is created or submitted only for an Active, non-archived employee (409); an unknown or foreign employee is 404' => static function () use ($world, $create, $op, $args, $ok, $code, $rb, $reason): void {
        $w = $world();
        $draft = $ok($create($w, 'ceoA', $rb(['employeeId' => 'e_a2'])), 'draft for e_a2')['financeRequest'];
        $w['db']->execute("UPDATE employees SET employment_status = 'Resigned' WHERE id = 'e_a2'");
        assertSame([409, 'conflict'], $code($create($w, 'ceoA', $rb(['employeeId' => 'e_a2']))), 'create for a Resigned employee');
        assertSame('employee_not_active', $reason($w));
        assertSame([409, 'conflict'], $code($op($w, 'ceoA', 'submit', $args('submit', $draft))), 'submit for a Resigned employee');
        $w['db']->execute("UPDATE employees SET employment_status = 'Active', archived_at = UTC_TIMESTAMP(6) WHERE id = 'e_a2'");
        assertSame([409, 'conflict'], $code($op($w, 'ceoA', 'submit', $args('submit', $draft))), 'submit for an archived employee');
        assertSame('employee_archived', $reason($w));
        assertSame([404, 'not_found'], $code($create($w, 'ceoA', $rb(['employeeId' => 'e_b1']))), 'another company\'s employee');
        assertSame([404, 'not_found'], $code($create($w, 'ceoA', $rb(['employeeId' => 'e_none']))), 'an unknown employee');
    },

    'V1: a paid-linked expense cannot be voided (409 finance_linked, nothing changed); V2: an unlinked Phase 1 transaction still voids' => static function () use ($world, $post, $at, $ok, $code, $rows, $reason, $key): void {
        $w = $world();
        $paid = $at($w, 'Paid');
        $linked = $paid['payment']['financeTransactionId'];
        $before = $rows($w['db']);
        assertSame([409, 'conflict'], $code($post($w, 'ceoA', '/api/general-transactions/void', ['financeTransactionId' => $linked, 'reason' => 'Fabricated', 'idempotencyKey' => $key()])), 'V1: void of the linked expense');
        assertSame('finance_linked', $reason($w));
        assertSame($before, $rows($w['db']), 'V1: nothing changed');
        $t = $ok($post($w, 'ceoA', '/api/general-transactions/create', ['kind' => 'expense', 'financialPost' => 'GA', 'category' => 'Operasional', 'description' => 'Fabricated unlinked',
            'amount' => '50000.00', 'transactionDate' => '2026-10-11', 'idempotencyKey' => $key()]), 'V2: unlinked create')['generalTransaction'];
        $ok($post($w, 'ceoA', '/api/general-transactions/void', ['financeTransactionId' => $t['id'], 'reason' => 'Fabricated duplicate', 'idempotencyKey' => $key()]), 'V2: the unlinked void');
        assertSame(1, (int) $w['db']->select('SELECT COUNT(*) AS n FROM finance_transaction_voids WHERE finance_transaction_id = ?', [$t['id']])[0]['n']);
    },

    'P1/P2/P3: the report reconciles with the database before and after payment; Approved-not-paid never enters a total; the documentDate range rule' => static function () use ($world, $post, $op, $args, $at, $ok, $report, $withoutPending, $key): void {
        $w = $world();
        foreach ([['income', 'DRONE', '2000000.00'], ['expense', 'GA', '300000.00']] as [$kind, $p, $amount]) {
            $ok($post($w, 'ceoA', '/api/general-transactions/create', ['kind' => $kind, 'financialPost' => $p, 'category' => 'Fabricated', 'description' => 'Fabricated base',
                'amount' => $amount, 'transactionDate' => '2026-10-05', 'idempotencyKey' => $key()]), 'base ' . $kind);
        }
        $ranges = [['2026-10-01', '2026-10-31'], ['2026-10-10', '2026-10-10'], ['2026-01-01', '2026-12-31'], ['2026-09-01', '2026-09-30']];
        $base = [];
        foreach ($ranges as [$f, $t]) {
            $base[$f . $t] = $report($w, $f, $t);
        }
        $approved = $at($w, 'Approved');                                              // GA 450,000.00 on 2026-10-10
        $early = $at($w, 'Approved', ['documentDate' => '2026-09-30', 'financialPost' => 'NPIP', 'amount' => '80000.00']);
        $at($w, 'Submitted', ['amount' => '7000.00']);
        $at($w, 'Draft', ['amount' => '9000.00']);
        foreach ($ranges as [$f, $t]) {
            $r = $report($w, $f, $t);
            assertSame($withoutPending($base[$f . $t]), $withoutPending($r), 'P2: no total moves for ' . $f . '..' . $t);
        }
        $oct = $report($w, '2026-10-01', '2026-10-31');
        assertSame(['amount' => '450000.00', 'count' => 1], ['amount' => $oct['approvedNotPaid']['amount'], 'count' => $oct['approvedNotPaid']['count']], 'P3: only the in-range Approved request');
        assertSame([['code' => 'GA', 'amount' => '450000.00', 'count' => 1], ['code' => 'NPIP', 'amount' => '0.00', 'count' => 0], ['code' => 'TJB', 'amount' => '0.00', 'count' => 0], ['code' => 'DRONE', 'amount' => '0.00', 'count' => 0]], $oct['approvedNotPaid']['posts']);
        assertSame('80000.00', $report($w, '2026-09-01', '2026-09-30')['approvedNotPaid']['amount'], 'P3: the September request is on September\'s line');
        assertSame('530000.00', $report($w, '2026-01-01', '2026-12-31')['approvedNotPaid']['amount'], 'P3: a wide range holds both');
        $sumApproved = (string) $w['db']->select("SELECT CAST(SUM(amount) AS CHAR) AS s FROM finance_requests WHERE company_id = ? AND status = 'Approved' AND document_date BETWEEN '2026-10-01' AND '2026-10-31'", [$w['a']])[0]['s'];
        assertSame($sumApproved, $oct['approvedNotPaid']['amount'], 'P1: the line equals the database SUM');
        // P1: pay on 2026-10-20 — the general expense rises by exactly the amount; Approved drops by it.
        $ok($op($w, 'ceoA', 'pay', $args('pay', $approved)), 'pay');
        $ok($op($w, 'ceoA', 'pay', $args('pay', $early, ['paidOn' => '2026-10-21'])), 'pay the September request in October');
        $after = $report($w, '2026-10-01', '2026-10-31');
        assertSame(['income' => '2000000.00', 'expense' => '830000.00', 'net' => '1170000.00', 'count' => 4], $after['general'], 'P1/P3: both payments counted once, on their paidOn');
        assertSame(['amount' => '0.00', 'count' => 0], ['amount' => $after['approvedNotPaid']['amount'], 'count' => $after['approvedNotPaid']['count']], 'P1: Approved-not-paid drops by the paid amount');
        assertSame('0.00', $report($w, '2026-09-01', '2026-09-30')['approvedNotPaid']['amount'], 'P3: a paid request leaves its documentDate line');
        $db = (string) $w['db']->select("SELECT CAST(SUM(t.amount) AS CHAR) AS s FROM finance_transactions t LEFT JOIN finance_transaction_voids v ON v.finance_transaction_id = t.id WHERE t.company_id = ? AND t.kind = 'expense' AND v.id IS NULL AND t.transaction_date BETWEEN '2026-10-01' AND '2026-10-31'", [$w['a']])[0]['s'];
        assertSame($db, $after['general']['expense'], 'P1: the expense total equals the database SUM');
        assertSame('750000.00', $after['posts'][0]['expense'] ?? null, 'P1: GA expense = 300,000 + 450,000');
    },

    'P4: Phase 1-only figures are byte-identical before and after migration 0041 (approvedNotPaid empty)' => static function (): void {
        $db = testDatabase();
        $files = [];
        foreach (glob(productionMigrationsDir() . '/*.sql') ?: [] as $path) {
            if ((int) substr(basename($path), 0, 4) <= 38) {
                $files[basename($path)] = (string) file_get_contents($path);
            }
        }
        (new Migrator($db, migrationFixture($files)))->apply();
        $f = authFixture($db);
        $c = $f['companyId'];
        foreach ([['income', 'DRONE', '1500000.00', '2026-10-03'], ['expense', 'GA', '250000.00', '2026-10-04'], ['expense', 'TJB', '99999.00', '2026-10-31'], ['income', 'NPIP', '1.00', '2026-11-01']] as $i => [$kind, $p, $amount, $date]) {
            $db->execute('INSERT INTO finance_transactions (id, company_id, kind, financial_post, category, description, amount, transaction_date, created_by_user_id, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))',
                [bin2hex(random_bytes(16)), $c, $kind, $p, 'Fabricated', 'Fabricated P4 ' . $i, $amount, $date, $f['userId'], bin2hex(random_bytes(16))]);
        }
        $principal = Principal::fromAccount(['user_id' => $f['userId'], 'user_status' => 'active', 'has_password' => true],
            [['membership_id' => $f['membershipId'], 'company_id' => $c, 'role' => 'ceo', 'employee_id' => null, 'membership_status' => 'active']]) ?? throw new \LogicException('fixture');
        $scope = Scope::of($principal);
        $figures = static function (bool $phase2) use ($db, $scope): array {
            $store = new FinancialReportStore(new ScopedDatabase($db));
            $range = ['from' => '2026-10-01', 'to' => '2026-10-31'];
            $approved = $phase2 ? $store->approved($scope, $range['from'], $range['to']) : [];
            return FinancialReport::build($range, $store->transactions($scope, $range['from'], $range['to']), $store->postings($scope, '2026-10', '2026-10'), $store->executions($scope, $range['from'], $range['to']), $approved);
        };
        $before = $figures(false);                                                 // at head 0038: no finance_requests table
        (new Migrator($db, productionMigrationsDir()))->apply();
        $after = $figures(true);
        assertSame(json_encode($before, JSON_THROW_ON_ERROR), json_encode($after, JSON_THROW_ON_ERROR), 'byte-identical figures');
        assertSame(['income' => '1500000.00', 'expense' => '349999.00', 'net' => '1150001.00', 'count' => 3], $after['general']);
        assertSame(['0.00', 0], [$after['approvedNotPaid']['amount'], $after['approvedNotPaid']['count']], 'an empty Approved-not-paid line');
    },

    'P5: above REPORT_CAP Approved requests the report fails closed (500, no partial total); at the cap it totals exactly' => static function () use ($world, $get, $ok, $code): void {
        $w = $world();
        $user = $w['f']['ceoA']['userId'];
        $bulk = static function (int $from, int $count) use ($w, $user): void {
            $posts = ['GA', 'NPIP', 'TJB', 'DRONE'];
            for ($start = $from; $start < $from + $count; $start += 1000) {
                $values = [];
                for ($n = $start; $n < min($start + 1000, $from + $count); $n++) {
                    $values[] = sprintf("('%032x', '%s', 'paymentRequest', '%s', 'Fabricated Cap', 'Fabricated cap request', '1.00', 'CV Fiktif', NULL, '2026-10-%02d', 'Approved', NULL, 3, 'c%031x', '%s', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))",
                        $n + 1, $w['a'], $posts[$n % 4], 1 + $n % 28, $n + 1, $user);
                }
                $w['db']->execute('INSERT INTO finance_requests (id, company_id, kind, financial_post, category, description, amount, payee, owner_employee_id, document_date, status, status_reason, version, idempotency_key, created_by_user_id, created_at, updated_at) VALUES ' . implode(', ', $values));
            }
        };
        $bulk(0, FinancialReportStore::REPORT_CAP);
        $r = $ok($get($w, 'ceoA', '/api/reports/financial', 'from=2026-10-01&to=2026-10-31'), 'at the cap')['financialReport'];
        assertSame(['20000.00', 20000], [$r['approvedNotPaid']['amount'], $r['approvedNotPaid']['count']], 'exactly REPORT_CAP requests are totalled');
        assertSame(['income' => '0.00', 'expense' => '0.00', 'net' => '0.00', 'count' => 0], $r['general'], 'and none of them is in a total');
        $bulk(FinancialReportStore::REPORT_CAP, 1);
        $over = $get($w, 'ceoA', '/api/reports/financial', 'from=2026-10-01&to=2026-10-31');
        assertSame([500, 'internal_error'], $code($over), 'REPORT_CAP + 1: fails closed');
        assertTrue(!str_contains($over->body, 'financialReport') && !str_contains($over->body, 'approvedNotPaid') && !str_contains($over->body, '.00'), 'nothing partial');
    },

    'CR-01 T-H1–T-H5 (ADR-017 §1): an Employee Draft has no post and cannot get one from the Employee; the CEO may omit, set and replace it, never clear it' => static function () use ($world, $get, $create, $op, $args, $ok, $code, $rb, $pr, $rows, $audits): void {
        $w = $world();
        $snap = ['preApprovalFinancialPost', 'preApprovalPostCaptured'];
        $before = $rows($w['db']);
        assertSame([400, 'validation_failed'], $code($create($w, 'empA1', $rb(['financialPost' => 'GA']))), 'T-H1: an Employee naming a post');
        assertSame([400, 'validation_failed'], $code($create($w, 'empA1', $rb(['financialPost' => null]))), 'T-H1: even null');
        assertSame($before, $rows($w['db']), 'T-H1: nothing written');
        $mine = $ok($create($w, 'empA1', $rb()), 'T-H1: without a post')['financeRequest'];
        assertSame(null, $mine['financialPost'], 'T-H1: the Draft has no post');
        assertSame([], array_values(array_intersect($snap, array_keys($mine))), 'T-V2: the Employee response has no snapshot key');
        assertSame([null, 0, null], array_map(static fn ($v) => is_numeric($v) ? (int) $v : $v, array_values($w['db']->select('SELECT financial_post, pre_approval_post_captured, pre_approval_financial_post FROM finance_requests WHERE id = ?', [$mine['id']])[0])), 'stored NULL, not captured');
        $before = $rows($w['db']);
        assertSame([400, 'validation_failed'], $code($op($w, 'empA1', 'update', $args('update', $mine, ['financialPost' => 'GA']))), 'T-H2: an Employee update naming a post');
        assertSame($before, $rows($w['db']), 'T-H2: nothing written');
        $mine = $ok($op($w, 'empA1', 'update', $args('update', $mine)), 'T-H2: the other fields update')['financeRequest'];
        assertSame([null, 2], [$mine['financialPost'], $mine['version']], 'T-H2: the post is unchanged');
        $ceoView = $ok($get($w, 'ceoA', AWP01_READ, 'id=' . $mine['id']), 'CEO read')['financeRequest'];
        assertSame([null, null, false], [$ceoView['financialPost'], $ceoView['preApprovalFinancialPost'], $ceoView['preApprovalPostCaptured']], 'T-V3: the CEO sees the snapshot, not captured');
        // T-H4: the CEO sets the missing post on the Employee's Draft, then replaces it; null is refused.
        $set = $ok($op($w, 'ceoA', 'update', ['financeRequestId' => $mine['id'], 'expectedVersion' => $mine['version'], 'financialPost' => 'GA']), 'T-H4: set')['financeRequest'];
        assertSame(['GA', 3], [$set['financialPost'], $set['version']]);
        $replaced = $ok($op($w, 'ceoA', 'update', ['financeRequestId' => $set['id'], 'expectedVersion' => $set['version'], 'financialPost' => 'NPIP']), 'T-H4: replace')['financeRequest'];
        assertSame('NPIP', $replaced['financialPost']);
        $before = $rows($w['db']);
        assertSame([400, 'validation_failed'], $code($op($w, 'ceoA', 'update', ['financeRequestId' => $replaced['id'], 'expectedVersion' => $replaced['version'], 'financialPost' => null])), 'T-H4: never cleared');
        assertSame([400, 'validation_failed'], $code($op($w, 'ceoA', 'update', ['financeRequestId' => $replaced['id'], 'expectedVersion' => $replaced['version'], 'financialPost' => 'RND'])), 'T-H4: never an unknown code');
        assertSame($before, $rows($w['db']), 'T-H4: nothing written');
        assertSame(['reimbursement.createSelfDraft financeRequest - category,description,amount,documentDate', 'reimbursement.updateSelfDraft financeRequest - description',
            'reimbursement.updateSelfDraft financeRequest - financialPost', 'reimbursement.updateSelfDraft financeRequest - financialPost'], $audits($w['db'], $mine['id']), 'field names only, never a value');
        // T-H3: the CEO's own reimbursement create.
        $none = $ok($create($w, 'ceoA', $rb(['employeeId' => 'e_a1'])), 'T-H3: no post')['financeRequest'];
        $drone = $ok($create($w, 'ceoA', $rb(['employeeId' => 'e_a1', 'financialPost' => 'DRONE'])), 'T-H3: DRONE')['financeRequest'];
        assertSame([null, 'DRONE'], [$none['financialPost'], $drone['financialPost']], 'T-H3: absent → NULL; a canonical code is stored as sent');
        assertSame(['reimbursement.createSelfDraft financeRequest - category,description,amount,documentDate', 'reimbursement.createSelfDraft financeRequest - financialPost,category,description,amount,documentDate'],
            [$audits($w['db'], $none['id'])[0], $audits($w['db'], $drone['id'])[0]], 'the create row names the post only when one was set');
        $before = $rows($w['db']);
        foreach ([null, 'RND', 'drone'] as $v) {
            assertSame([400, 'validation_failed'], $code($create($w, 'ceoA', $rb(['employeeId' => 'e_a1', 'financialPost' => $v]))), 'T-H3: ' . var_export($v, true));
        }
        assertSame([400, 'validation_failed'], $code($create($w, 'ceoA', array_diff_key($pr(), ['financialPost' => true]))), 'T-H5: a payment request needs its post');
        assertSame($before, $rows($w['db']), 'T-H3/T-H5: nothing written');
    },

    'CR-01 T-A1–T-A7 (ADR-017 §1, §3, D6): every reimbursement approval names its post; Approved, the final post and the locked row\'s previous post are written together; the audit row names financialPost only when it changed' => static function () use ($world, $get, $create, $op, $args, $ok, $code, $rb, $at, $rows, $audits, $reason): void {
        $w = $world();
        $submitted = static function (array $body, string $who = 'empA1') use ($w, $create, $op, $args, $ok): array {
            $r = $ok($create($w, $who, $body), 'create')['financeRequest'];
            return $ok($op($w, $who, 'submit', $args('submit', $r)), 'submit')['financeRequest'];
        };
        $stored = static function (string $id) use ($w): array {
            $x = $w['db']->select('SELECT status, financial_post, pre_approval_financial_post, pre_approval_post_captured, version FROM finance_requests WHERE id = ?', [$id])[0];
            return [$x['status'], $x['financial_post'], $x['pre_approval_financial_post'], (int) $x['pre_approval_post_captured'], (int) $x['version']];
        };
        $noPost = static fn (array $b): array => array_diff_key($b, ['financialPost' => true]);
        // T-A1: no post (or an unknown one) on a reimbursement approval is 400, nothing written, no audit row.
        $r = $submitted($rb());
        $before = $rows($w['db']);
        assertSame([400, 'validation_failed'], $code($op($w, 'ceoA', 'approve', $noPost($args('approve', $r)))), 'T-A1: no post');
        assertSame([400, 'validation_failed'], $code($op($w, 'ceoA', 'approve', $args('approve', $r, ['financialPost' => 'RND']))), 'T-A1: RND');
        assertSame([400, 'validation_failed'], $code($op($w, 'ceoA', 'approve', $args('approve', $r, ['financialPost' => null]))), 'T-A1: null');
        // T-A4: an Employee is 403 before any lookup; T-A6: stale version or another amount is 409.
        assertSame([403, 'forbidden'], $code($op($w, 'empA1', 'approve', $args('approve', $r, ['financialPost' => 'GA']))), 'T-A4');
        assertSame([409, 'conflict'], $code($op($w, 'ceoA', 'approve', $args('approve', $r, ['financialPost' => 'GA', 'expectedVersion' => $r['version'] - 1]))), 'T-A6: stale');
        assertSame('finance_request_version', $reason($w));
        assertSame([409, 'conflict'], $code($op($w, 'ceoA', 'approve', $args('approve', $r, ['financialPost' => 'GA', 'expectedAmount' => '1.00']))), 'T-A6: another amount');
        assertSame('finance_request_amount', $reason($w));
        assertSame($before, $rows($w['db']), 'T-A1/T-A4/T-A6: nothing changed, no audit row');
        // T-A2: assigning a post that was missing.
        $a = $ok($op($w, 'ceoA', 'approve', $args('approve', $r, ['financialPost' => 'DRONE'])), 'T-A2: approve with DRONE')['financeRequest'];
        assertSame(['Approved', $r['version'] + 1, 'DRONE', null, true], [$a['status'], $a['version'], $a['financialPost'], $a['preApprovalFinancialPost'], $a['preApprovalPostCaptured']], 'T-A2: final DRONE, captured, no previous post');
        assertSame(['Approved', 'DRONE', null, 1, $r['version'] + 1], $stored($r['id']), 'T-A2: stored');
        assertSame('finance.manage financeRequest approve financialPost', $audits($w['db'], $r['id'])[2], 'T-A2/T-V5: the approval names the field, never a value');
        // D3: reassigning a preassigned post.
        $g = $submitted($rb(['employeeId' => 'e_a2', 'financialPost' => 'GA']), 'ceoA');
        $ga = $ok($op($w, 'ceoA', 'approve', $args('approve', $g, ['financialPost' => 'NPIP'])), 'reassign GA → NPIP')['financeRequest'];
        assertSame(['NPIP', 'GA', true], [$ga['financialPost'], $ga['preApprovalFinancialPost'], $ga['preApprovalPostCaptured']], 'previous GA, final NPIP');
        assertSame(['Approved', 'NPIP', 'GA', 1, $g['version'] + 1], $stored($g['id']));
        assertSame('finance.manage financeRequest approve financialPost', $audits($w['db'], $g['id'])[2]);
        // T-A7: confirming the stored post.
        $t = $submitted($rb(['employeeId' => 'e_a2', 'financialPost' => 'TJB']), 'ceoA');
        $tj = $ok($op($w, 'ceoA', 'approve', $args('approve', $t)), 'confirm TJB')['financeRequest'];
        assertSame(['TJB', 'TJB', true], [$tj['financialPost'], $tj['preApprovalFinancialPost'], $tj['preApprovalPostCaptured']], 'T-A7: previous = final, captured');
        assertSame('finance.manage financeRequest approve -', $audits($w['db'], $t['id'])[2], 'T-A7: no field when the post is confirmed');
        // T-V2: the Employee reads the approved reimbursement with its post and no snapshot key.
        $mine = $ok($get($w, 'empA1', AWP01_READ, 'id=' . $r['id']), 'Employee read')['financeRequest'];
        assertSame(['DRONE', false, false], [$mine['financialPost'], array_key_exists('preApprovalFinancialPost', $mine), array_key_exists('preApprovalPostCaptured', $mine)], 'T-V2: the assigned post, no snapshot');
        foreach ($ok($get($w, 'empA1', AWP01_LIST, 'from=2026-10-01&to=2026-10-31'), 'Employee list')['financeRequests'] as $x) {
            assertTrue(!array_key_exists('preApprovalFinancialPost', $x) && !array_key_exists('preApprovalPostCaptured', $x), 'T-V2: no snapshot key in the Employee list');
        }
        // T-A3: a payment request approval names no post; without one it is unchanged and never captured.
        $p = $at($w, 'Submitted');
        $before = $rows($w['db']);
        assertSame([400, 'validation_failed'], $code($op($w, 'ceoA', 'approve', $args('approve', $p, ['financialPost' => 'GA']))), 'T-A3: a post on a payment request');
        assertSame($before, $rows($w['db']), 'T-A3: nothing written');
        $pa = $ok($op($w, 'ceoA', 'approve', $args('approve', $p)), 'T-A3: payment request approve')['financeRequest'];
        assertSame(['GA', null, false], [$pa['financialPost'], $pa['preApprovalFinancialPost'], $pa['preApprovalPostCaptured']], 'T-A3: unchanged behaviour, not captured');
        assertSame(['Approved', 'GA', null, 0, $p['version'] + 1], $stored($p['id']));
    },

    'CR-01 T-A5 (ADR-017 §3): the approval statement captures only the value it was given under the lock — a changed post, a stale version or an already captured row matches no row' => static function () use ($world, $create, $op, $args, $ok, $rb, $b1Ceo): void {
        $w = $world();
        $r = $ok($create($w, 'ceoA', $rb(['employeeId' => 'e_a1', 'financialPost' => 'GA'])), 'create')['financeRequest'];
        $r = $ok($op($w, 'ceoA', 'submit', $args('submit', $r)), 'submit')['financeRequest'];
        $store = new RequestStore(new ScopedDatabase($w['db']));
        $auth = Policy::authorize($b1Ceo($w), Action::FinanceManage);
        $state = static function () use ($w, $r): array {
            $x = $w['db']->select('SELECT status, financial_post, pre_approval_financial_post, pre_approval_post_captured, version FROM finance_requests WHERE id = ?', [$r['id']])[0];
            return [$x['status'], $x['financial_post'], $x['pre_approval_financial_post'], (int) $x['pre_approval_post_captured'], (int) $x['version']];
        };
        $before = $state();
        assertSame(0, $store->approveReimbursement($auth, $r['id'], $r['version'], null, 'DRONE'), 'a NULL previous post does not match GA (null-safe)');
        assertSame(0, $store->approveReimbursement($auth, $r['id'], $r['version'], 'NPIP', 'DRONE'), 'another previous post');
        assertSame(0, $store->approveReimbursement($auth, $r['id'], $r['version'] + 1, 'GA', 'DRONE'), 'a stale version');
        assertSame($before, $state(), 'nothing changed');
        assertSame(1, $store->approveReimbursement($auth, $r['id'], $r['version'], 'GA', 'DRONE'), 'the locked value');
        assertSame(['Approved', 'DRONE', 'GA', 1, $r['version'] + 1], $state(), 'the snapshot is the bound previous value');
        $after = $state();
        assertSame(0, $store->approveReimbursement($auth, $r['id'], $r['version'] + 1, 'DRONE', 'TJB'), 'an Approved, captured row is never approved again');
        assertSame($after, $state());
    },

    'CR-01 T-W1/T-D2 (ADR-017 §4): after approval no operation changes the post or the snapshot; a cancelled approval keeps both' => static function () use ($world, $create, $op, $args, $ok, $code, $rb): void {
        $w = $world();
        $snap = static function (string $id) use ($w): array {
            $x = $w['db']->select('SELECT financial_post, pre_approval_financial_post, pre_approval_post_captured FROM finance_requests WHERE id = ?', [$id])[0];
            return [$x['financial_post'], $x['pre_approval_financial_post'], (int) $x['pre_approval_post_captured']];
        };
        $approved = static function (string $post) use ($w, $create, $op, $args, $ok, $rb): array {
            $r = $ok($create($w, 'empA1', $rb()), 'create')['financeRequest'];
            $r = $ok($op($w, 'empA1', 'submit', $args('submit', $r)), 'submit')['financeRequest'];
            return $ok($op($w, 'ceoA', 'approve', $args('approve', $r, ['financialPost' => $post])), 'approve')['financeRequest'];
        };
        $a = $approved('DRONE');
        $fixed = $snap($a['id']);
        assertSame(['DRONE', null, 1], $fixed);
        foreach (['update' => ['financialPost' => 'GA'], 'submit' => [], 'reject' => [], 'approve' => ['financialPost' => 'GA']] as $operation => $over) {
            assertSame([409, 'conflict'], $code($op($w, 'ceoA', $operation, $args($operation, $a, $over))), 'T-W1: ' . $operation . ' after approval');
            assertSame($fixed, $snap($a['id']), 'T-W1: ' . $operation . ' changed nothing');
        }
        $paid = $ok($op($w, 'ceoA', 'pay', $args('pay', $a)), 'pay')['financeRequest'];
        assertSame(['Paid', 'DRONE', null, true], [$paid['status'], $paid['financialPost'], $paid['preApprovalFinancialPost'], $paid['preApprovalPostCaptured']], 'T-W1: pay keeps the post and the snapshot');
        assertSame($fixed, $snap($a['id']));
        $c = $approved('TJB');
        $cancelled = $ok($op($w, 'ceoA', 'cancel', $args('cancel', $c)), 'cancel the approval')['financeRequest'];
        assertSame(['Cancelled', 'TJB', true], [$cancelled['status'], $cancelled['financialPost'], $cancelled['preApprovalPostCaptured']], 'T-D2: a cancelled approval keeps its post and captured = 1');
        assertSame(['TJB', null, 1], $snap($c['id']));
        $refused = false;
        try {
            $w['db']->execute('UPDATE finance_requests SET financial_post = NULL WHERE id = ?', [$c['id']]);
        } catch (DatabaseError $e) {
            $refused = true;
        }
        assertTrue($refused, 'T-D2: clearing the post of a cancelled approval is refused (finance_requests_captured_post)');
        assertSame(['TJB', null, 1], $snap($c['id']));
    },

    'CR-01 T-I1–T-I3 (ADR-017, R2-2 = Option A): a create retry replays until the stored request changes; after a post assignment it is 409 idempotency_mismatch and never a duplicate' => static function () use ($world, $create, $op, $args, $ok, $code, $rb, $counts, $reason, $key): void {
        $w = $world();
        $body = $rb(['idempotencyKey' => $key()]);
        $first = $ok($create($w, 'empA1', $body), 'create')['financeRequest'];
        $n = $counts($w['db']);
        assertSame($first, $ok($create($w, 'empA1', $body), 'T-I1: retry')['financeRequest'], 'T-I1: the same Draft, post NULL');
        assertSame($n, $counts($w['db']), 'T-I1: no row, no audit');
        $s = $ok($op($w, 'empA1', 'submit', $args('submit', $first)), 'submit')['financeRequest'];
        $ok($op($w, 'ceoA', 'approve', $args('approve', $s, ['financialPost' => 'GA'])), 'approve with GA');
        $n = $counts($w['db']);
        assertSame([409, 'conflict'], $code($create($w, 'empA1', $body)), 'T-I2: the retry after the CEO assigned a post');
        assertSame('idempotency_mismatch', $reason($w));
        assertSame($n, $counts($w['db']), 'T-I2: no new row');
        assertSame([$first['id']], array_column($w['db']->select('SELECT id FROM finance_requests WHERE company_id = ? AND idempotency_key = ?', [$w['a'], $body['idempotencyKey']]), 'id'), 'T-I2: the key is still held by the original');
        $ceoBody = $rb(['employeeId' => 'e_a2', 'idempotencyKey' => $key()]);
        $d = $ok($create($w, 'ceoA', $ceoBody), 'CEO create, no post')['financeRequest'];
        $ok($op($w, 'ceoA', 'update', ['financeRequestId' => $d['id'], 'expectedVersion' => $d['version'], 'financialPost' => 'TJB']), 'set the post');
        $n = $counts($w['db']);
        assertSame([409, 'conflict'], $code($create($w, 'ceoA', $ceoBody)), 'T-I3: as any baseline Draft edit');
        assertSame('idempotency_mismatch', $reason($w));
        assertSame($n, $counts($w['db']), 'T-I3: no new row');
    },

    'CR-01 T-P1–T-P3 (ADR-017 §3): pay records the expense on the approved post; the Approved-not-paid line groups by it; pay idempotency is unchanged' => static function () use ($world, $create, $op, $args, $ok, $rb, $report, $counts, $rows): void {
        $w = $world();
        $r = $ok($create($w, 'ceoA', $rb(['employeeId' => 'e_a1', 'financialPost' => 'GA', 'amount' => '210000.00', 'documentDate' => '2026-10-12'])), 'create GA')['financeRequest'];
        $r = $ok($op($w, 'ceoA', 'submit', $args('submit', $r)), 'submit')['financeRequest'];
        $r = $ok($op($w, 'ceoA', 'approve', $args('approve', $r, ['financialPost' => 'DRONE'])), 'approve on DRONE')['financeRequest'];
        $line = $report($w, '2026-10-01', '2026-10-31')['approvedNotPaid'];
        assertSame([['code' => 'GA', 'amount' => '0.00', 'count' => 0], ['code' => 'NPIP', 'amount' => '0.00', 'count' => 0], ['code' => 'TJB', 'amount' => '0.00', 'count' => 0], ['code' => 'DRONE', 'amount' => '210000.00', 'count' => 1]], $line['posts'], 'T-P2: on the approved post');
        $body = $args('pay', $r);
        $paid = $ok($op($w, 'ceoA', 'pay', $body), 'pay')['financeRequest'];
        assertSame('DRONE', (string) $w['db']->select('SELECT financial_post AS p FROM finance_transactions WHERE id = ?', [$paid['payment']['financeTransactionId']])[0]['p'], 'T-P1: the expense carries the canonical approved code, not the earlier GA');
        $after = $rows($w['db']);
        assertSame($paid, $ok($op($w, 'ceoA', 'pay', $body), 'T-P3: replay')['financeRequest'], 'T-P3: the replay answers the payment');
        assertSame($after, $rows($w['db']), 'T-P3: the replay writes nothing');
    },
];
