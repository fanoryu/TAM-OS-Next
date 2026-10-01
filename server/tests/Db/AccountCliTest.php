<?php
declare(strict_types=1);

/*
 * server/bin/account.php (BF-3B) in a child process against the real, guarded CI MariaDB:
 * create-ceo bootstraps exactly once; reset-credentials is CEO-only break-glass; both require
 * a current schema, serialize on the 'tamos_account' advisory lock, print the raw token once on
 * success only, and never print or store a secret anywhere else.
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Data\Migration\Migrator;
use function TamOs\Tests\activateRequest;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\authKernel;
use function TamOs\Tests\envelope;
use function TamOs\Tests\loginRequest;
use function TamOs\Tests\migrationFixture;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\requestId;
use function TamOs\Tests\runAccountCli;
use function TamOs\Tests\secondConnection;
use function TamOs\Tests\sessionCookieToken;
use function TamOs\Tests\sessionRequest;
use function TamOs\Tests\testDatabase;
use function TamOs\Tests\testDbConfig;
use function TamOs\Tests\writeConfigFile;

$usage = "usage: php server/bin/account.php create-ceo|reset-credentials --email=<address>\n";
$output = '/^user: ([0-9a-f]{32})\nexpires_at: (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{6}) UTC\nactivation_token: ([A-Za-z0-9_-]{43})\n$/';
/** @return array{userId: string, expiresAt: string, token: string} */
$issued = static function (array $out) use ($output): array {
    assertSame([0, ''], [$out['exit'], $out['stderr']], 'command succeeded: ' . $out['stderr']);
    assertTrue(preg_match($output, $out['stdout'], $m) === 1, 'exactly the three output lines');
    return ['userId' => $m[1], 'expiresAt' => $m[2], 'token' => $m[3]];
};
$count = static fn (Database $db, string $table): int => (int) $db->select('SELECT COUNT(*) AS n FROM ' . $table)[0]['n'];
$dumpAll = static function (Database $db): string {
    $out = '';
    foreach (['companies', 'users', 'memberships', 'sessions', 'account_tokens', 'auth_events', 'auth_rate_limits', 'schema_migrations'] as $t) {
        $out .= json_encode($db->select('SELECT * FROM ' . $t));
    }
    return $out;
};
$password = 'operator chosen passphrase';

return [
    'create-ceo: one company, one pending CEO, one membership, one hashed 72-hour token, one event; the token printed once' => static function () use ($issued, $count, $dumpAll): void {
        $db = authDatabase();
        $out = runAccountCli(['create-ceo', '--email=  First.CEO@Example.TEST '], writeConfigFile(testDbConfig()));
        $t = $issued($out);
        assertSame([1, 1, 1, 1, 1], [$count($db, 'companies'), $count($db, 'users'), $count($db, 'memberships'), $count($db, 'account_tokens'), $count($db, 'auth_events')]);
        $user = $db->select('SELECT id, email, password_hash, status FROM users')[0];
        assertSame([$t['userId'], 'first.ceo@example.test', null, 'active'], array_values($user), 'normalized email, no password');
        $m = $db->select('SELECT user_id, role, employee_id, status FROM memberships')[0];
        assertSame([$t['userId'], 'ceo', null, 'active'], array_values($m));
        $tok = $db->select('SELECT token_hash, user_id, purpose, TIMESTAMPDIFF(SECOND, created_at, expires_at) AS life, expires_at, used_at, revoked_at FROM account_tokens')[0];
        assertSame([hash('sha256', $t['token']), $t['userId'], 'activation', 72 * 3600, $t['expiresAt'], null, null], array_values($tok));
        $e = $db->select('SELECT event, user_id, membership_id, email_hash, ip FROM auth_events')[0];
        assertSame(['ceo_bootstrap', $t['userId'], (string) $db->select('SELECT id FROM memberships')[0]['id'], null, null], array_values($e));
        assertTrue(!str_contains($dumpAll($db), $t['token']), 'the raw token is nowhere in the database');
        assertTrue(substr_count($out['stdout'], $t['token']) === 1, 'printed exactly once');
    },
    'create-ceo refuses a second bootstrap, and any pre-existing company or user, changing nothing' => static function () use ($issued, $count): void {
        $db = authDatabase();
        $file = writeConfigFile(testDbConfig());
        $issued(runAccountCli(['create-ceo', '--email=ceo@example.test'], $file));
        foreach (['ceo@example.test', 'other@example.test'] as $email) {
            $again = runAccountCli(['create-ceo', '--email=' . $email], $file);
            assertSame([1, '', "account: already_bootstrapped\n"], [$again['exit'], $again['stdout'], $again['stderr']], $email);
        }
        assertSame([1, 1, 1, 1], [$count($db, 'companies'), $count($db, 'users'), $count($db, 'account_tokens'), $count($db, 'auth_events')]);
        // A company without users, or a user without a company, also blocks it.
        $db2 = authDatabase();
        $db2->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [bin2hex(random_bytes(16))]);
        assertSame("account: already_bootstrapped\n", runAccountCli(['create-ceo', '--email=ceo@example.test'], $file)['stderr'], 'company only');
        $db3 = authDatabase();
        $db3->execute("INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (?, 'x@example.test', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [bin2hex(random_bytes(16))]);
        assertSame("account: already_bootstrapped\n", runAccountCli(['create-ceo', '--email=ceo@example.test'], $file)['stderr'], 'user only');
        assertSame(0, $count($db3, 'companies'), 'nothing created');
    },
    'usage errors exit 2 before any configuration or database work; no password option exists' => static function () use ($usage): void {
        foreach ([[], ['create-ceo'], ['create-ceo', '--email', 'a@example.test'], ['create-ceo', '--email=a@example.test', '--force'],
            ['create-ceo', '--password=secret-value-1'], ['create-ceo', '--email=not-an-address'], ['reissue-activation', '--email=a@example.test']] as $args) {
            $out = runAccountCli($args, null); // no config at all: reaching it would be exit 1
            assertSame([2, '', $usage], [$out['exit'], $out['stdout'], $out['stderr']], implode(' ', $args));
        }
    },
    'a schema that is not exactly current is refused before any account work' => static function () use ($count): void {
        $db = testDatabase();
        $file = writeConfigFile(testDbConfig());
        assertSame([1, "migrations: history_missing\n"], (static fn ($o) => [$o['exit'], $o['stderr']])(runAccountCli(['create-ceo', '--email=ceo@example.test'], $file)));
        $files = [];
        foreach (glob(productionMigrationsDir() . '/000[1-6]_*.sql') ?: [] as $path) {
            $files[basename($path)] = (string) file_get_contents($path);
        }
        (new Migrator($db, migrationFixture($files)))->apply();
        $out = runAccountCli(['create-ceo', '--email=ceo@example.test'], $file);
        assertSame([1, '', "account: schema_not_current\n"], [$out['exit'], $out['stdout'], $out['stderr']], '0007–0013 pending');
        assertSame(0, $count($db, 'users'));
    },
    'the advisory lock: a held lock makes both commands refuse at once with nothing written; each run releases it' => static function () use ($issued, $count): void {
        $db = authDatabase();
        $file = writeConfigFile(testDbConfig());
        $holder = secondConnection();
        assertSame(1, (int) $holder->select("SELECT GET_LOCK('tamos_account', 0) AS l")[0]['l']);
        $started = microtime(true);
        foreach (['create-ceo', 'reset-credentials'] as $command) {
            $out = runAccountCli([$command, '--email=ceo@example.test'], $file);
            assertSame([1, '', "account: busy\n"], [$out['exit'], $out['stdout'], $out['stderr']], $command);
        }
        assertTrue(microtime(true) - $started < 20, 'no waiting for the lock');
        assertSame([0, 0, 0], [$count($db, 'companies'), $count($db, 'users'), $count($db, 'auth_events')]);
        $holder->select("SELECT RELEASE_LOCK('tamos_account') AS r");
        $issued(runAccountCli(['create-ceo', '--email=ceo@example.test'], $file));
        assertSame(1, (int) $holder->select("SELECT GET_LOCK('tamos_account', 0) AS l")[0]['l'], 'released after success');
        $holder->select("SELECT RELEASE_LOCK('tamos_account') AS r");
        assertSame("account: already_bootstrapped\n", runAccountCli(['create-ceo', '--email=ceo@example.test'], $file)['stderr']);
        assertSame(1, (int) $holder->select("SELECT GET_LOCK('tamos_account', 0) AS l")[0]['l'], 'released after a refusal');
        $holder->select("SELECT RELEASE_LOCK('tamos_account') AS r");
    },
    'the advisory lock dies with its connection (an interrupted operator run cannot wedge the lock)' => static function (): void {
        authDatabase();
        $a = secondConnection();
        assertSame(1, (int) $a->select("SELECT GET_LOCK('tamos_account', 0) AS l")[0]['l']);
        $b = secondConnection();
        assertSame(0, (int) $b->select("SELECT GET_LOCK('tamos_account', 0) AS l")[0]['l'], 'held');
        unset($a); // the only reference: PDO closes the connection
        assertSame(1, (int) $b->select("SELECT GET_LOCK('tamos_account', 10) AS l")[0]['l'], 'released by the disconnect (bounded wait)');
        $b->select("SELECT RELEASE_LOCK('tamos_account') AS r");
    },
    'reset-credentials: active CEO → pending; every session revoked; old tokens revoked; one new token; old password dead' => static function () use ($issued, $password, $dumpAll): void {
        $db = authDatabase();
        $file = writeConfigFile(testDbConfig());
        $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
        $first = $issued(runAccountCli(['create-ceo', '--email=ceo@example.test'], $file));
        assertSame(200, $k->handle(activateRequest($first['token'], $password), requestId())->status);
        $session = (string) sessionCookieToken($k->handle(loginRequest('ceo@example.test', $password), requestId()));
        $reset = runAccountCli(['reset-credentials', '--email=CEO@example.test'], $file);
        $second = $issued($reset);
        assertSame($first['userId'], $second['userId']);
        assertSame(null, $db->select('SELECT password_hash FROM users')[0]['password_hash'], 'pending again');
        assertSame(401, $k->handle(sessionRequest('GET', '/api/auth/me', $session), requestId())->status, 'session revoked');
        assertSame(401, $k->handle(loginRequest('ceo@example.test', $password), requestId())->status, 'old password dead');
        $states = $db->select('SELECT token_hash, used_at IS NOT NULL AS used, revoked_at IS NOT NULL AS revoked FROM account_tokens ORDER BY created_at, token_hash');
        $byHash = array_column($states, null, 'token_hash');
        assertSame([1, 0], [(int) $byHash[hash('sha256', $first['token'])]['used'], (int) $byHash[hash('sha256', $first['token'])]['revoked']], 'the used token stays used');
        assertSame([0, 0], [(int) $byHash[hash('sha256', $second['token'])]['used'], (int) $byHash[hash('sha256', $second['token'])]['revoked']], 'the new token is live');
        $e = $db->select("SELECT user_id, ip FROM auth_events WHERE event = 'credential_reset'")[0];
        assertSame([$first['userId'], null], array_values($e));
        assertSame(400, $k->handle(activateRequest($first['token'], 'yet another passphrase'), requestId())->status, 'the old token cannot activate');
        assertSame(200, $k->handle(activateRequest($second['token'], 'yet another passphrase'), requestId())->status, 'the new one can');
        assertSame(200, $k->handle(loginRequest('ceo@example.test', 'yet another passphrase'), requestId())->status);
        assertTrue(!str_contains($dumpAll($db), $second['token']) && !str_contains($reset['stderr'], $second['token']), 'no raw token stored or on stderr');
    },
    'reset-credentials replaces an expired bootstrap token (the only reissue path): the old one is revoked' => static function () use ($issued, $password): void {
        $db = authDatabase();
        $file = writeConfigFile(testDbConfig());
        $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
        $first = $issued(runAccountCli(['create-ceo', '--email=ceo@example.test'], $file));
        $db->execute('UPDATE account_tokens SET created_at = UTC_TIMESTAMP(6) - INTERVAL 80 HOUR, expires_at = UTC_TIMESTAMP(6) - INTERVAL 8 HOUR');
        $second = $issued(runAccountCli(['reset-credentials', '--email=ceo@example.test'], $file));
        assertSame(1, (int) $db->select('SELECT revoked_at IS NOT NULL AS r FROM account_tokens WHERE token_hash = ?', [hash('sha256', $first['token'])])[0]['r']);
        assertSame(400, $k->handle(activateRequest($first['token'], $password), requestId())->status);
        assertSame(200, $k->handle(activateRequest($second['token'], $password), requestId())->status);
    },
    'reset-credentials fails closed on every unexpected account, changing nothing' => static function () use ($count): void {
        $cases = [
            'unknown email' => [static fn (Database $db): string => 'nobody@example.test', "account: not_found\n"],
            'disabled user' => [static function (Database $db): string {
                $a = authFixture($db);
                $db->execute("UPDATE users SET status = 'disabled' WHERE id = ?", [$a['userId']]);
                return $a['email'];
            }, "account: account_disabled\n"],
            'disabled membership' => [static function (Database $db): string {
                $a = authFixture($db, ['membershipStatus' => 'disabled']);
                return $a['email'];
            }, "account: account_disabled\n"],
            'no membership' => [static fn (Database $db): string => authFixture($db, ['membership' => false])['email'], "account: topology_invalid\n"],
            'employee' => [static fn (Database $db): string => authFixture($db, ['role' => 'employee', 'employeeId' => 'emp-1'])['email'], "account: not_ceo\n"],
        ];
        foreach ($cases as $label => [$arrange, $stderr]) {
            $db = authDatabase();
            $email = $arrange($db);
            $before = [$db->select('SELECT id, password_hash, status FROM users'), $count($db, 'sessions'), $count($db, 'account_tokens'), $count($db, 'auth_events')];
            $out = runAccountCli(['reset-credentials', '--email=' . $email], writeConfigFile(testDbConfig()));
            assertSame([1, '', $stderr], [$out['exit'], $out['stdout'], $out['stderr']], $label);
            assertSame($before, [$db->select('SELECT id, password_hash, status FROM users'), $count($db, 'sessions'), $count($db, 'account_tokens'), $count($db, 'auth_events')], $label . ': nothing changed');
            assertTrue(!str_contains($out['stderr'], '@'), $label . ': no email on stderr');
        }
    },
    'a database outage is reported by kind only, with no credential and no token' => static function (): void {
        authDatabase();
        $config = testDbConfig();
        $wrong = \TamOs\Tests\testConfig(['db' => ['pass' => 'wrong-password-value'] + $config->db]);
        $out = runAccountCli(['create-ceo', '--email=ceo@example.test'], writeConfigFile($wrong));
        assertSame([1, '', "database: unavailable during connect\n"], [$out['exit'], $out['stdout'], $out['stderr']]);
    },
];
