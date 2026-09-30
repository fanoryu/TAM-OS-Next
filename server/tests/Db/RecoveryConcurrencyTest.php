<?php
declare(strict_types=1);

/*
 * BF-3D single-use under concurrency, against the real, guarded MariaDB with separate worker
 * processes: two resets with one recovery token end with exactly one success; a reset that
 * waited on the locked account while another consumed the token fails and writes nothing.
 */

use TamOs\Auth\Passwords;
use TamOs\Auth\SessionToken;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Mail\OutboxWorker;
use TamOs\Tests\RecordingMailTransport;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\awaitBlockedStatements;
use function TamOs\Tests\jsonPost;
use function TamOs\Tests\authKernel;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\requestId;
use function TamOs\Tests\secondConnection;
use function TamOs\Tests\testDbConfig;

$origin = 'https://finance.example.test';
/** A recoverable account with one live recovery token, delivered through the real worker. */
$issued = static function () use ($origin): array {
    $db = authDatabase();
    $a = authFixture($db);
    $k = authKernel(testDbConfig(), AuthData::fromDatabase($db), productionMigrationsDir());
    assertSame(200, $k->handle(jsonPost('/api/auth/forgot-password', json_encode(['email' => $a['email']], JSON_THROW_ON_ERROR), ['remoteAddr' => '203.0.113.7']), requestId())->status);
    $mail = new RecordingMailTransport();
    (new OutboxWorker(AuthData::fromDatabase($db), $mail, $origin))->run(20, requestId());
    $text = $mail->sent[0]->text;
    $token = substr($text, (int) strpos($text, '#recovery=') + strlen('#recovery='), 43);
    return [$db, $a, $token];
};
$spawn = static function (string $token, string $password): array {
    $cmd = [PHP_BINARY];
    if (php_ini_loaded_file() === false) {
        $cmd[] = '-n';
    }
    array_push($cmd, dirname(__DIR__) . '/Support/reset-password-worker.php', $token, $password);
    $proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, getenv());
    assertTrue(is_resource($proc), 'worker started');
    fclose($pipes[0]);
    return [$proc, $pipes];
};
$finish = static function (array $worker): string {
    [$proc, $pipes] = $worker;
    $stdout = (string) stream_get_contents($pipes[1]);
    $stderr = (string) stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    assertSame(0, proc_close($proc), 'worker exit: ' . $stderr);
    return trim($stdout);
};

return [
    'two simultaneous resets with one token: exactly one succeeds' => static function () use ($issued, $spawn, $finish): void {
        [$db, $a, $token] = $issued();
        $w1 = $spawn($token, 'first racing passphrase');
        $w2 = $spawn($token, 'second racing passphrase');
        $out = [$finish($w1), $finish($w2)];
        sort($out);
        assertSame(['200 ok', '400 validation_failed'], $out);
        assertSame(1, (int) $db->select('SELECT COUNT(*) AS n FROM account_tokens WHERE token_hash = ? AND used_at IS NOT NULL', [SessionToken::hash($token)])[0]['n']);
        $hash = (string) $db->select('SELECT password_hash FROM users WHERE id = ?', [$a['userId']])[0]['password_hash'];
        assertTrue(Passwords::verify('first racing passphrase', $hash) !== Passwords::verify('second racing passphrase', $hash), 'exactly one password stands');
        assertSame(1, (int) $db->select("SELECT COUNT(*) AS n FROM auth_events WHERE event = 'recovery_ok'")[0]['n']);
    },
    'a reset that waited on the locked account while another consumed the token fails and writes nothing' => static function () use ($issued, $spawn, $finish): void {
        [$db, $a, $token] = $issued();
        $winner = Passwords::hash('the winning passphrase');
        $worker = null;
        secondConnection()->transaction(static function (Database $tx) use ($a, $token, $winner, $spawn, &$worker): void {
            $tx->select('SELECT id FROM users WHERE id = ? FOR UPDATE', [$a['userId']]);
            $worker = $spawn($token, 'the losing passphrase');
            awaitBlockedStatements($tx, 'SELECT u.id AS user_id, u.email', 1);
            // The winner, holding the account row: consume the token and set its password, then commit.
            $tx->execute('UPDATE account_tokens SET used_at = UTC_TIMESTAMP(6) WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL', [SessionToken::hash($token)]);
            $tx->execute('UPDATE users SET password_hash = ? WHERE id = ?', [$winner, $a['userId']]);
        });
        assertSame('400 validation_failed', $finish($worker));
        assertSame($winner, (string) $db->select('SELECT password_hash FROM users WHERE id = ?', [$a['userId']])[0]['password_hash'], 'the winner stands');
        assertSame(0, (int) $db->select("SELECT COUNT(*) AS n FROM auth_events WHERE event = 'recovery_ok'")[0]['n'], 'the loser recorded no success');
    },
];
