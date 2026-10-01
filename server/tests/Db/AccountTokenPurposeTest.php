<?php
declare(strict_types=1);

/*
 * BF-3D token purposes against the real, guarded MariaDB: a recovery token lives 30 minutes on
 * the database clock and is invisible to activation (and an activation token to recovery); and
 * every credential event — activation, operator reset, password change — revokes every open
 * token of the user, of every purpose, and nobody else's.
 */

use TamOs\Auth\SessionToken;
use TamOs\Data\Auth\AccountTokenStore;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use function TamOs\Tests\activateRequest;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\authKernel;
use function TamOs\Tests\envelope;
use function TamOs\Tests\loginRequest;
use function TamOs\Tests\pendingCeo;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\requestId;
use function TamOs\Tests\runAccountCli;
use function TamOs\Tests\sessionCookieToken;
use function TamOs\Tests\sessionRequest;
use function TamOs\Tests\testDbConfig;
use function TamOs\Tests\writeConfigFile;

/** Issues a token of this purpose for the user; returns [raw, hash]. */
$issue = static function (Database $db, string $userId, string $purpose): array {
    $raw = SessionToken::generate();
    $hash = SessionToken::hash($raw);
    AuthData::fromDatabase($db)->tokens()->issue($hash, $userId, $purpose);
    return [$raw, $hash];
};
$open = static fn (Database $db, string $userId): int => (int) $db->select('SELECT COUNT(*) AS n FROM account_tokens WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL', [$userId])[0]['n'];
$password = 'a long enough passphrase';

return [
    'a recovery token lives exactly 30 minutes on the database clock' => static function () use ($issue): void {
        $db = authDatabase();
        $a = authFixture($db);
        [, $hash] = $issue($db, $a['userId'], AccountTokenStore::RECOVERY);
        $row = $db->select('SELECT purpose, TIMESTAMPDIFF(SECOND, created_at, expires_at) AS life FROM account_tokens WHERE token_hash = ?', [$hash])[0];
        assertSame(['recovery', 1800], [(string) $row['purpose'], (int) $row['life']]);
    },
    'purposes are isolated: a recovery token cannot activate; neither is visible under the other purpose' => static function () use ($issue, $password): void {
        $db = authDatabase();
        $ceo = pendingCeo($db);
        [$recoveryRaw, $recoveryHash] = $issue($db, $ceo['userId'], AccountTokenStore::RECOVERY);
        $tokens = AuthData::fromDatabase($db)->tokens();
        assertSame(null, $tokens->peek($recoveryHash, AccountTokenStore::ACTIVATION), 'recovery hash under activation');
        assertSame(null, $tokens->peek(SessionToken::hash($ceo['token']), AccountTokenStore::RECOVERY), 'activation hash under recovery');
        assertSame(0, $tokens->consume($recoveryHash, AccountTokenStore::ACTIVATION), 'no cross-purpose consumption');
        $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
        $r = $k->handle(activateRequest($recoveryRaw, $password), requestId());
        assertSame([400, ['token']], [$r->status, envelope($r)['error']['fields'] ?? null], 'a recovery token does not activate');
        assertSame(null, $db->select('SELECT password_hash FROM users WHERE id = ?', [$ceo['userId']])[0]['password_hash'], 'still pending');
    },
    'activation revokes every open token of the user, the recovery purpose included' => static function () use ($issue, $open, $password): void {
        $db = authDatabase();
        $ceo = pendingCeo($db);
        $issue($db, $ceo['userId'], AccountTokenStore::RECOVERY);
        $other = authFixture($db);
        $issue($db, $other['userId'], AccountTokenStore::RECOVERY);
        $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
        assertSame(200, $k->handle(activateRequest($ceo['token'], $password), requestId())->status);
        assertSame(0, $open($db, $ceo['userId']), 'no open token left');
        assertSame(1, $open($db, $other['userId']), 'another user untouched');
    },
    'the operator reset revokes open recovery tokens and leaves exactly its new activation token' => static function () use ($issue, $open): void {
        $db = authDatabase();
        $ceo = pendingCeo($db);
        $db->execute("UPDATE users SET password_hash = 'x-activated-hash' WHERE id = ?", [$ceo['userId']]);
        $db->execute('UPDATE account_tokens SET used_at = UTC_TIMESTAMP(6) WHERE user_id = ?', [$ceo['userId']]);
        [, $recoveryHash] = $issue($db, $ceo['userId'], AccountTokenStore::RECOVERY);
        $out = runAccountCli(['reset-credentials', '--email=' . $ceo['email']], writeConfigFile(testDbConfig()));
        assertSame(0, $out['exit'], $out['stderr']);
        assertTrue($db->select('SELECT revoked_at FROM account_tokens WHERE token_hash = ?', [$recoveryHash])[0]['revoked_at'] !== null, 'recovery token revoked');
        assertSame(1, $open($db, $ceo['userId']), 'only the new activation token is open');
        assertSame('activation', (string) $db->select('SELECT purpose FROM account_tokens WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL', [$ceo['userId']])[0]['purpose']);
    },
    'a password change revokes open recovery tokens' => static function () use ($issue, $open): void {
        $db = authDatabase();
        $a = authFixture($db);
        [, $recoveryHash] = $issue($db, $a['userId'], AccountTokenStore::RECOVERY);
        $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
        $login = $k->handle(loginRequest($a['email'], (string) $a['password']), requestId());
        $body = json_encode(['currentPassword' => $a['password'], 'newPassword' => 'another long passphrase'], JSON_THROW_ON_ERROR);
        $r = $k->handle(sessionRequest('POST', '/api/auth/change-password', (string) sessionCookieToken($login), (string) envelope($login)['data']['csrfToken'], $body), requestId());
        assertSame(200, $r->status);
        assertTrue($db->select('SELECT revoked_at FROM account_tokens WHERE token_hash = ?', [$recoveryHash])[0]['revoked_at'] !== null, 'recovery token revoked');
        assertSame(0, $open($db, $a['userId']));
    },
];
