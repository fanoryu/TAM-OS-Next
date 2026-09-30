<?php
declare(strict_types=1);

/*
 * BF-3B concurrency against the real, guarded CI MariaDB — deterministic, never sleep-based.
 * Two techniques:
 *
 *   1. Lock proofs. A second connection holds a row lock inside an open transaction while the
 *      operation runs on the main connection with innodb_lock_wait_timeout = 1: the operation
 *      must wait on that exact lock (1205 → 503 / transient) and must have written nothing.
 *   2. Race proofs. The interleaving is forced step by step on two connections (a stale
 *      snapshot read before a commit, a write after it), or — where the race is inside one
 *      request — a worker process is started, observed blocked on the lock (bounded polling of
 *      PROCESSLIST, which fails the test on its deadline), and then released.
 */

use TamOs\Auth\AccountLifecycle;
use TamOs\Auth\Passwords;
use TamOs\Data\Auth\AccountStore;
use TamOs\Data\Auth\AccountTokenStore;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Data\DatabaseError;
use TamOs\Http\Kernel;
use function TamOs\Tests\activateRequest;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\authKernel;
use function TamOs\Tests\awaitBlockedStatements;
use function TamOs\Tests\envelope;
use function TamOs\Tests\loginRequest;
use function TamOs\Tests\pendingCeo;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\requestId;
use function TamOs\Tests\secondConnection;
use function TamOs\Tests\sessionCookieToken;
use function TamOs\Tests\sessionRequest;
use function TamOs\Tests\testDbConfig;

$password = 'first chosen passphrase';

/** @return array{0: Database, 1: Kernel, 2: AuthData} */
$setup = static function (): array {
    $db = authDatabase();
    $auth = AuthData::fromDatabase($db);
    return [$db, authKernel(testDbConfig(), $auth, productionMigrationsDir()), $auth];
};
/** Runs $fn while $holder keeps $lockSql's rows locked in an open transaction; $db waits at most 1 s. */
$whileLocked = static function (Database $holder, string $lockSql, array $params, Database $db, Closure $fn): mixed {
    $db->execute('SET SESSION innodb_lock_wait_timeout = 1');
    try {
        return $holder->transaction(static function (Database $tx) use ($lockSql, $params, $fn): mixed {
            assertTrue(count($tx->select($lockSql, $params)) >= 1, 'the holder locked the row');
            return $fn();
        });
    } finally {
        $db->execute('SET SESSION innodb_lock_wait_timeout = 50');
    }
};
$liveToken = static fn (Database $db, string $raw): int => (int) $db->select(
    'SELECT (used_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(6)) AS live FROM account_tokens WHERE token_hash = ?',
    [hash('sha256', $raw)],
)[0]['live'];
$hashOf = static fn (Database $db, string $userId): ?string => $db->select('SELECT password_hash FROM users WHERE id = ?', [$userId])[0]['password_hash'];

return [
    'activation waits on the user row: while another transaction holds it, nothing is written (503)' => static function () use ($setup, $whileLocked, $liveToken, $hashOf, $password): void {
        [$db, $k] = $setup();
        $ceo = pendingCeo($db);
        $r = $whileLocked(secondConnection(), 'SELECT id FROM users WHERE id = ? FOR UPDATE', [$ceo['userId']], $db,
            static fn () => $k->handle(activateRequest($ceo['token'], $password), requestId()));
        assertSame([503, 'service_unavailable'], [$r->status, envelope($r)['error']['code']]);
        assertSame([1, null], [$liveToken($db, $ceo['token']), $hashOf($db, $ceo['userId'])], 'token live, no password');
        assertSame(0, (int) $db->select("SELECT COUNT(*) AS n FROM auth_events WHERE event = 'activation_ok'")[0]['n']);
        assertSame(200, $k->handle(activateRequest($ceo['token'], $password), requestId())->status, 'once free, it activates');
        assertSame(400, $k->handle(activateRequest($ceo['token'], $password), requestId())->status, 'and only once');
    },
    'activation waits on the token row too' => static function () use ($setup, $whileLocked, $liveToken, $hashOf, $password): void {
        [$db, $k] = $setup();
        $ceo = pendingCeo($db);
        $r = $whileLocked(secondConnection(), 'SELECT token_hash FROM account_tokens WHERE token_hash = ? FOR UPDATE', [hash('sha256', $ceo['token'])], $db,
            static fn () => $k->handle(activateRequest($ceo['token'], $password), requestId()));
        assertSame(503, $r->status);
        assertSame([1, null], [$liveToken($db, $ceo['token']), $hashOf($db, $ceo['userId'])], 'rolled back as a unit');
    },
    'stale snapshot race: a redemption that read "live" before a concurrent one committed can neither set a password nor consume' => static function () use ($setup, $hashOf, $password): void {
        [$db, $k] = $setup();
        $ceo = pendingCeo($db);
        $hash = hash('sha256', $ceo['token']);
        $b = secondConnection();
        $b->transaction(static function (Database $tx) use ($db, $k, $ceo, $hash, $hashOf, $password): void {
            $tokens = new AccountTokenStore($tx);
            $accounts = new AccountStore($tx);
            // B reads first: its snapshot says live and pending.
            assertSame(['userId' => $ceo['userId'], 'live' => true], $tokens->peek($hash));
            assertSame(false, $accounts->findById($ceo['userId'])['user']['has_password']);
            // A redeems and commits in between.
            assertSame(200, $k->handle(activateRequest($ceo['token'], $password), requestId())->status);
            // B's snapshot still says pending — but its writes are compare-and-swap on current rows.
            assertSame(false, $accounts->findById($ceo['userId'])['user']['has_password'], 'B still sees its stale snapshot');
            assertSame(false, $accounts->setInitialPasswordHash($ceo['userId'], Passwords::hash('attacker chosen value')), 'no second first-password');
            assertSame(0, $tokens->consume($hash), 'no second consumption');
        });
        assertTrue(Passwords::verify($password, $hashOf($db, $ceo['userId'])), 'the winner\'s password stands');
        assertSame(1, (int) $db->select('SELECT COUNT(*) AS n FROM account_tokens WHERE used_at IS NOT NULL')[0]['n']);
    },
    'reset and activation serialize on the user row: reset waits while it is held, and either order ends consistent' => static function () use ($setup, $whileLocked, $liveToken, $password): void {
        [$db, $k, $auth] = $setup();
        $ceo = pendingCeo($db);
        $lifecycle = new AccountLifecycle($auth);
        $e = $whileLocked(secondConnection(), 'SELECT id FROM users WHERE id = ? FOR UPDATE', [$ceo['userId']], $db,
            static fn () => assertThrows(DatabaseError::class, static fn () => $lifecycle->resetCredentials($ceo['email'], requestId())));
        assertSame([DatabaseError::TRANSIENT, 1205], [$e->kind, $e->driverCode]);
        assertSame([1, 1], [$liveToken($db, $ceo['token']), (int) $db->select('SELECT COUNT(*) AS n FROM account_tokens')[0]['n']], 'nothing written by the waiting reset');
        // Order 1: reset, then the old token → refused; the new one works.
        $issued = $lifecycle->resetCredentials($ceo['email'], requestId());
        assertSame(400, $k->handle(activateRequest($ceo['token'], $password), requestId())->status);
        assertSame(200, $k->handle(activateRequest($issued->token, $password), requestId())->status);
        // Order 2: activated, then reset → pending again, the password is gone.
        $again = $lifecycle->resetCredentials($ceo['email'], requestId());
        assertSame(401, $k->handle(loginRequest($ceo['email'], $password), requestId())->status);
        assertSame(1, $liveToken($db, $again->token));
    },
    'bootstrap waits for nothing but the advisory lock: a concurrent holder makes it refuse without writing' => static function () use ($setup): void {
        [$db, , $auth] = $setup();
        $holder = secondConnection();
        assertSame(1, (int) $holder->select("SELECT GET_LOCK('tamos_account', 0) AS l")[0]['l']);
        $e = assertThrows(\TamOs\Auth\AccountRefused::class, static fn () => (new AccountLifecycle($auth))->createCeo('ceo@example.test', requestId()));
        assertSame('busy', $e->reason);
        assertSame(0, (int) $db->select('SELECT COUNT(*) AS n FROM users')[0]['n']);
        $holder->select("SELECT RELEASE_LOCK('tamos_account') AS r");
        (new AccountLifecycle($auth))->createCeo('ceo@example.test', requestId());
        assertSame(1, (int) $db->select('SELECT COUNT(*) AS n FROM companies')[0]['n']);
    },
    'password change waits on the user\'s bucket: while another attempt holds it, nothing changes (503)' => static function () use ($setup, $whileLocked): void {
        [$db, $k] = $setup();
        $a = authFixture($db);
        $login = $k->handle(loginRequest($a['email'], (string) $a['password']), requestId());
        [$t, $c] = [(string) sessionCookieToken($login), (string) envelope($login)['data']['csrfToken']];
        $bucket = hash('sha256', 'pwchange:' . $a['userId']);
        $db->execute('INSERT INTO auth_rate_limits (bucket, failures, window_started_at, locked_until) VALUES (?, 0, UTC_TIMESTAMP(6), NULL)', [$bucket]);
        $body = json_encode(['currentPassword' => $a['password'], 'newPassword' => 'a brand new passphrase'], JSON_THROW_ON_ERROR);
        $r = $whileLocked(secondConnection(), 'SELECT bucket FROM auth_rate_limits WHERE bucket = ? FOR UPDATE', [$bucket], $db,
            static fn () => $k->handle(sessionRequest('POST', '/api/auth/change-password', $t, $c, $body), requestId()));
        assertSame(503, $r->status);
        assertSame(200, $k->handle(sessionRequest('GET', '/api/auth/me', $t), requestId())->status, 'the session survives');
        assertSame(200, $k->handle(loginRequest($a['email'], (string) $a['password']), requestId())->status, 'the password is unchanged');
    },
    'two changes presented with one session: the first wins and revokes it, so the second is refused (401)' => static function () use ($setup): void {
        [$db, $k] = $setup();
        $a = authFixture($db);
        $login = $k->handle(loginRequest($a['email'], (string) $a['password']), requestId());
        [$t, $c] = [(string) sessionCookieToken($login), (string) envelope($login)['data']['csrfToken']];
        $first = $k->handle(sessionRequest('POST', '/api/auth/change-password', $t, $c, json_encode(['currentPassword' => $a['password'], 'newPassword' => 'winner passphrase one'], JSON_THROW_ON_ERROR)), requestId());
        assertSame(200, $first->status);
        // The second request presents the same (now revoked) session: it is refused before anything.
        $second = $k->handle(sessionRequest('POST', '/api/auth/change-password', $t, $c, json_encode(['currentPassword' => $a['password'], 'newPassword' => 'loser passphrase two'], JSON_THROW_ON_ERROR)), requestId());
        assertSame(401, $second->status);
        assertSame(200, $k->handle(loginRequest($a['email'], 'winner passphrase one'), requestId())->status);
        assertSame(401, $k->handle(loginRequest($a['email'], 'loser passphrase two'), requestId())->status);
    },
    'compare-and-swap conflict: a hash changed between verification and write is a 409, and nothing is written' => static function () use ($setup): void {
        [$db, $k] = $setup();
        $a = authFixture($db);
        $login = $k->handle(loginRequest($a['email'], (string) $a['password']), requestId());
        [$t, $c] = [(string) sessionCookieToken($login), (string) envelope($login)['data']['csrfToken']];
        $holder = secondConnection();
        $other = Passwords::hash('changed elsewhere meanwhile');
        $worker = null;
        $holder->transaction(static function (Database $tx) use ($a, $t, $c, $other, &$worker): void {
            // Hold the users row: the worker's consistent read is not blocked, its CAS write is.
            $tx->select('SELECT id FROM users WHERE id = ? FOR UPDATE', [$a['userId']]);
            $cmd = [PHP_BINARY];
            if (php_ini_loaded_file() === false) {
                $cmd[] = '-n';
            }
            array_push($cmd, dirname(__DIR__) . '/Support/change-password-worker.php', $t, $c, (string) $a['password'], 'worker new passphrase');
            $worker = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, getenv());
            assertTrue(is_resource($worker), 'worker started');
            fclose($pipes[0]);
            $worker = [$worker, $pipes];
            awaitBlockedStatements($tx, 'UPDATE users SET password_hash', 1);
            // Change the hash while the worker waits on it, then commit (release).
            $tx->execute('UPDATE users SET password_hash = ? WHERE id = ?', [$other, $a['userId']]);
        });
        [$proc, $pipes] = $worker;
        $stdout = (string) stream_get_contents($pipes[1]);
        $stderr = (string) stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        assertSame(0, proc_close($proc), 'worker exit: ' . $stderr);
        assertSame('409 conflict', trim($stdout));
        assertSame($other, $db->select('SELECT password_hash FROM users WHERE id = ?', [$a['userId']])[0]['password_hash'], 'the concurrent write stands');
        assertSame(200, $k->handle(sessionRequest('GET', '/api/auth/me', $t), requestId())->status, 'no session was revoked');
        assertSame(0, (int) $db->select("SELECT COUNT(*) AS n FROM auth_events WHERE event = 'password_change'")[0]['n']);
    },
];
