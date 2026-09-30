<?php
declare(strict_types=1);

/*
 * BF-3D password recovery end to end against the real, guarded MariaDB, through the production
 * kernel and the recording test transport (no network, no real mail):
 *
 *   forgot-password — one generic answer for every address (known, unknown, invalid, disabled,
 *   pending, over quota), delivery intent only for a recoverable account under quota, 3 requests
 *   per address and 10 per IP per hour, no session, no cookie;
 *   reset-password  — the mailed token sets a new password once, ends every session, revokes
 *   every open token, issues no session and no cookie; every token problem is one 400 [token];
 *   the password rule is the shared PasswordPolicy and a violation consumes nothing; failed
 *   redemptions are throttled per IP; no token or address reaches the log or an event.
 */

use TamOs\Auth\SessionToken;
use TamOs\Config\Config;
use TamOs\Data\Auth\AccountTokenStore;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Http\Kernel;
use TamOs\Http\Response;
use TamOs\Mail\OutboxWorker;
use TamOs\Tests\RecordingMailTransport;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\authKernel;
use function TamOs\Tests\envelope;
use function TamOs\Tests\jsonPost;
use function TamOs\Tests\loginRequest;
use function TamOs\Tests\pendingCeo;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\requestId;
use function TamOs\Tests\sessionCookieToken;
use function TamOs\Tests\sessionRequest;
use function TamOs\Tests\testDbConfig;

$origin = 'https://finance.example.test';
$newPassword = 'a recovered long passphrase';
/** @return array{db: Database, k: Kernel, config: Config, mail: RecordingMailTransport, worker: OutboxWorker} */
$setup = static function (?Database $db = null) use ($origin): array {
    $db ??= authDatabase();
    $config = testDbConfig();
    $mail = new RecordingMailTransport();
    return ['db' => $db, 'k' => authKernel($config, AuthData::fromDatabase($db), productionMigrationsDir()), 'config' => $config,
        'mail' => $mail, 'worker' => new OutboxWorker(AuthData::fromDatabase($db), $mail, $origin)];
};
$forgot = static fn (Kernel $k, string $email, string $ip = '203.0.113.7'): Response
    => $k->handle(jsonPost('/api/auth/forgot-password', json_encode(['email' => $email], JSON_THROW_ON_ERROR), ['remoteAddr' => $ip]), requestId());
$reset = static fn (Kernel $k, string $token, string $password, string $ip = '203.0.113.7'): Response
    => $k->handle(jsonPost('/api/auth/reset-password', json_encode(['token' => $token, 'password' => $password], JSON_THROW_ON_ERROR), ['remoteAddr' => $ip]), requestId());
$shape = static fn (Response $r): array => [$r->status, $r->body, $r->headers];
$outbox = static fn (Database $db): int => (int) $db->select('SELECT COUNT(*) AS n FROM mail_outbox')[0]['n'];
/** Runs the worker and returns the raw token of the last mail. */
$deliver = static function (array $w) use ($origin): string {
    $w['worker']->run(20, requestId());
    $last = end($w['mail']->sent);
    assertTrue($last !== false, 'a mail was sent');
    return substr($last->text, (int) strpos($last->text, $origin . '/#recovery=') + strlen($origin . '/#recovery='), 43);
};
$code = static fn (Response $r): ?string => envelope($r)['error']['code'] ?? null;
$fields = static fn (Response $r): ?array => envelope($r)['error']['fields'] ?? null;

return [
    'forgot-password: the same status, body and headers for every address; intent only for a recoverable one' => static function () use ($setup, $forgot, $shape, $outbox): void {
        $w = $setup();
        $pending = pendingCeo($w['db']);
        $known = authFixture($w['db']);
        $disabled = authFixture($w['db'], ['userStatus' => 'disabled']);
        $offMembership = authFixture($w['db'], ['membershipStatus' => 'disabled']);
        $reference = $shape($forgot($w['k'], $known['email']));
        assertSame(200, $reference[0]);
        assertSame(['requested' => true], envelope($forgot($w['k'], 'nobody-' . bin2hex(random_bytes(4)) . '@example.test'))['data']);
        assertSame(1, $outbox($w['db']), 'intent queued for the known account only');
        foreach ([
            'unknown' => 'nobody-' . bin2hex(random_bytes(4)) . '@example.test',
            'invalid syntax' => 'not an address',
            'disabled user' => $disabled['email'],
            'disabled membership' => $offMembership['email'],
            'pending (never activated)' => $pending['email'],
            'known again (already queued)' => $known['email'],
            'known, other case and spaces' => '  ' . strtoupper($known['email']) . ' ',
        ] as $label => $email) {
            $r = $forgot($w['k'], $email, '198.51.100.' . random_int(1, 250));
            assertSame($reference, $shape($r), $label);
            assertTrue(!array_key_exists('Set-Cookie', $r->headers), $label . ': no cookie');
        }
        assertSame(1, $outbox($w['db']), 'still exactly one queued mail: none for unknown, disabled or pending, none duplicated');
        $row = $w['db']->select('SELECT user_id, kind, status FROM mail_outbox')[0];
        assertSame([$known['userId'], 'recovery', 'pending'], [$row['user_id'], $row['kind'], $row['status']]);
    },
    'forgot-password records recovery_req for every request, with the user only when recoverable' => static function () use ($setup, $forgot): void {
        $w = $setup();
        $known = authFixture($w['db']);
        $forgot($w['k'], $known['email']);
        $forgot($w['k'], 'ghost@example.test');
        $events = $w['db']->select("SELECT user_id, email_hash IS NOT NULL AS hashed, ip FROM auth_events WHERE event = 'recovery_req' ORDER BY id");
        assertSame([[$known['userId'], 0, '203.0.113.7'], [null, 1, '203.0.113.7']],
            array_map(static fn (array $e): array => [$e['user_id'], (int) $e['hashed'], $e['ip']], $events));
        assertTrue(!str_contains(json_encode($w['db']->select('SELECT * FROM auth_events')), 'ghost@example.test'), 'no raw address in events');
    },
    'forgot-password quotas: 3 per address per hour (silently, for real and unknown addresses alike); 10 per IP then 429' => static function () use ($setup, $forgot, $shape, $outbox, $deliver): void {
        $w = $setup();
        $known = authFixture($w['db']);
        // Each delivered mail closes the open row, so later requests could queue again — until the quota.
        for ($i = 1; $i <= 3; $i++) {
            assertSame(200, $forgot($w['k'], $known['email'], '192.0.2.' . $i)->status);
            $deliver($w);
        }
        assertSame(3, count($w['mail']->sent));
        $fourth = $forgot($w['k'], $known['email'], '192.0.2.9');
        assertSame(200, $fourth->status, 'over quota: still the generic 200');
        assertSame(3, $outbox($w['db']), 'but no fourth mail is queued');
        $unknownBucket = hash('sha256', 'recover-acct:ghost@example.test');
        for ($i = 1; $i <= 4; $i++) {
            $forgot($w['k'], 'ghost@example.test', '192.0.2.' . (20 + $i));
        }
        assertSame(3, (int) $w['db']->select('SELECT failures FROM auth_rate_limits WHERE bucket = ?', [$unknownBucket])[0]['failures'], 'an unknown address is counted exactly like a real one');
        for ($i = 1; $i <= 10; $i++) {
            $r = $forgot($w['k'], 'x' . $i . '@example.test', '203.0.113.99');
            assertSame(200, $r->status, 'ip request ' . $i);
        }
        $blocked = $forgot($w['k'], $known['email'], '203.0.113.99');
        assertSame([429, 'rate_limited'], [$blocked->status, envelope($blocked)['error']['code'] ?? null]);
        assertTrue((int) ($blocked->headers['Retry-After'] ?? 0) > 0, 'Retry-After');
        $blockedUnknown = $forgot($w['k'], 'x-unknown@example.test', '203.0.113.99');
        assertSame($shape($blocked), $shape($blockedUnknown), 'the IP throttle answers the same for any address');
    },
    'reset-password: the mailed token sets a new password once; sessions and open tokens end; no session, no cookie' => static function () use ($setup, $forgot, $reset, $deliver, $newPassword): void {
        $w = $setup();
        $a = authFixture($w['db']);
        $login = $w['k']->handle(loginRequest($a['email'], (string) $a['password']), requestId());
        $session = (string) sessionCookieToken($login);
        $forgot($w['k'], $a['email']);
        $token = $deliver($w);
        // An unrelated open activation-purpose token must not survive either.
        AuthData::fromDatabase($w['db'])->tokens()->issue(SessionToken::hash(SessionToken::generate()), $a['userId'], AccountTokenStore::ACTIVATION);
        $r = $reset($w['k'], $token, $newPassword);
        assertSame([200, ['reset' => true]], [$r->status, envelope($r)['data'] ?? null]);
        assertTrue(!array_key_exists('Set-Cookie', $r->headers), 'no cookie on success');
        assertSame(401, $w['k']->handle(sessionRequest('GET', '/api/auth/me', $session), requestId())->status, 'the old session ended');
        assertSame(0, (int) $w['db']->select('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL', [$a['userId']])[0]['n'], 'no session issued');
        assertSame(0, (int) $w['db']->select('SELECT COUNT(*) AS n FROM account_tokens WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL', [$a['userId']])[0]['n'], 'no open token of any purpose');
        assertSame(401, $w['k']->handle(loginRequest($a['email'], (string) $a['password']), requestId())->status, 'old password dead');
        assertSame(200, $w['k']->handle(loginRequest($a['email'], $newPassword), requestId())->status, 'new password works');
        assertSame(1, (int) $w['db']->select("SELECT COUNT(*) AS n FROM auth_events WHERE event = 'recovery_ok' AND user_id = ?", [$a['userId']])[0]['n']);
        $again = $reset($w['k'], $token, 'yet another long passphrase');
        assertSame([400, ['token']], [$again->status, envelope($again)['error']['fields'] ?? null], 'single use');
    },
    'every token problem is the same 400 [token]: unknown, malformed, expired, replaced, activation-purpose, account disabled since' => static function () use ($setup, $forgot, $reset, $deliver, $newPassword, $shape): void {
        $w = $setup();
        $a = authFixture($w['db']);
        $forgot($w['k'], $a['email']);
        $first = $deliver($w);
        $forgot($w['k'], $a['email']);
        $second = $deliver($w);
        $reference = $shape($reset($w['k'], SessionToken::generate(), $newPassword));
        assertSame(400, $reference[0]);
        $cases = ['malformed' => 'not-a-token', 'replaced by a newer mail' => $first];
        foreach ($cases as $label => $token) {
            assertSame($reference, $shape($reset($w['k'], $token, $newPassword)), $label);
        }
        $w['db']->execute("UPDATE account_tokens SET expires_at = UTC_TIMESTAMP(6) WHERE token_hash = ?", [SessionToken::hash($second)]);
        assertSame($reference, $shape($reset($w['k'], $second, $newPassword)), 'expired (equality is expired)');
        $pending = authFixture($w['db'], ['password' => null]);
        $activation = SessionToken::generate();
        AuthData::fromDatabase($w['db'])->tokens()->issue(SessionToken::hash($activation), $pending['userId'], AccountTokenStore::ACTIVATION);
        assertSame($reference, $shape($reset($w['k'], $activation, $newPassword)), 'an activation token cannot reset');
        $b = authFixture($w['db']);
        $forgot($w['k'], $b['email'], '192.0.2.50');
        $bToken = $deliver($w);
        $w['db']->execute("UPDATE users SET status = 'disabled' WHERE id = ?", [$b['userId']]);
        assertSame($reference, $shape($reset($w['k'], $bToken, $newPassword)), 'a disabled account never recovers');
        assertSame(6, (int) $w['db']->select("SELECT COUNT(*) AS n FROM auth_events WHERE event = 'recovery_fail'")[0]['n'], 'every failure recorded, the reference included');
    },
    'the password rule is PasswordPolicy; a violation consumes nothing' => static function () use ($setup, $forgot, $reset, $deliver, $newPassword): void {
        $w = $setup();
        $a = authFixture($w['db']);
        $forgot($w['k'], $a['email']);
        $token = $deliver($w);
        foreach (['too short' => 'short pass', 'the account email' => $a['email'], 'common' => 'password1234', 'control char' => "twelve chars\x07pw"] as $label => $bad) {
            $r = $reset($w['k'], $token, $bad);
            assertSame([400, ['password']], [$r->status, envelope($r)['error']['fields'] ?? null], $label);
        }
        assertSame(1, count(array_filter($w['db']->select("SELECT used_at FROM account_tokens WHERE token_hash = ? AND used_at IS NULL", [SessionToken::hash($token)]))), 'token still live');
        assertSame(200, $reset($w['k'], $token, $newPassword)->status, 'then a valid password works');
    },
    'failed redemptions are throttled per IP: 20 failures in 15 minutes lock the IP (429)' => static function () use ($setup, $reset, $newPassword, $code): void {
        $w = $setup();
        for ($i = 1; $i <= 20; $i++) {
            assertSame(400, $reset($w['k'], SessionToken::generate(), $newPassword, '203.0.113.50')->status, 'failure ' . $i);
        }
        $r = $reset($w['k'], SessionToken::generate(), $newPassword, '203.0.113.50');
        assertSame([429, 'rate_limited'], [$r->status, $code($r)]);
        assertSame(400, $reset($w['k'], SessionToken::generate(), $newPassword, '203.0.113.51')->status, 'another IP is unaffected');
    },
    'no raw token, recovery link or address ever reaches the API log or the security events' => static function () use ($setup, $forgot, $reset, $deliver, $newPassword): void {
        $w = $setup();
        $a = authFixture($w['db']);
        $forgot($w['k'], $a['email']);
        $token = $deliver($w);
        $reset($w['k'], $token, 'short');
        $reset($w['k'], $token, $newPassword);
        $log = is_file($w['config']->logPath) ? (string) file_get_contents($w['config']->logPath) : '';
        assertTrue($log !== '', 'the log was written');
        $events = json_encode($w['db']->select('SELECT * FROM auth_events'));
        foreach ([$token, '#recovery=', $a['email'], $newPassword] as $secret) {
            assertTrue(!str_contains($log, $secret), 'log leaks ' . substr($secret, 0, 12));
            assertTrue(!str_contains((string) $events, $secret), 'events leak ' . substr($secret, 0, 12));
        }
    },
];
