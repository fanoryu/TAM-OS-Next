<?php
declare(strict_types=1);

/*
 * The governed mail outbox and worker (BF-3D, D-D3) against the real, guarded MariaDB, with the
 * recording test transport — no network, no real mail. Delivery intent is queued without any
 * address or token; the worker issues a fresh 30-minute recovery token at send time, sends
 * outside any transaction, revokes the token of a failed attempt, retries with bounded backoff,
 * gives up with mail_fail, cancels rows whose account can no longer recover, reclaims a stale
 * `sending` row, and never lets two recovery links live at once.
 */

use TamOs\Auth\SessionToken;
use TamOs\Data\Auth\AccountTokenStore;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\Auth\MailOutboxStore;
use TamOs\Data\Database;
use TamOs\Mail\MailError;
use TamOs\Mail\MailMessage;
use TamOs\Mail\OutboxWorker;
use TamOs\Tests\RecordingMailTransport;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\pendingCeo;
use function TamOs\Tests\requestId;
use function TamOs\Tests\runCli;
use function TamOs\Tests\secondConnection;
use function TamOs\Tests\testConfig;
use function TamOs\Tests\testDbConfig;
use function TamOs\Tests\writeConfigFile;

$origin = 'https://finance.example.test';
/** @return array{0: Database, 1: RecordingMailTransport, 2: OutboxWorker} */
$setup = static function () use ($origin): array {
    $db = authDatabase();
    $t = new RecordingMailTransport();
    return [$db, $t, new OutboxWorker(AuthData::fromDatabase($db), $t, $origin)];
};
$enqueue = static fn (Database $db, string $userId): bool => AuthData::fromDatabase($db)->atomically(
    static fn (): bool => AuthData::fromDatabase($db)->outbox()->enqueueOnce($userId, MailOutboxStore::RECOVERY, requestId()),
);
$row = static fn (Database $db, string $userId): array => $db->select('SELECT status, attempts, next_attempt_at > UTC_TIMESTAMP(6) AS later FROM mail_outbox WHERE user_id = ? ORDER BY id DESC LIMIT 1', [$userId])[0];
$openRecovery = static fn (Database $db, string $userId): array => array_column($db->select("SELECT token_hash FROM account_tokens WHERE user_id = ? AND purpose = 'recovery' AND used_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(6)", [$userId]), 'token_hash');
$tokenIn = static function (MailMessage $m) use ($origin): string {
    $prefix = $origin . '/#recovery=';
    $at = strpos($m->text, $prefix);
    return substr($m->text, (int) $at + strlen($prefix), 43);
};
$due = static fn (Database $db) => $db->execute("UPDATE mail_outbox SET next_attempt_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE status = 'pending'");

return [
    'a queued row holds no address and no token; a second request while one is open queues nothing' => static function () use ($setup, $enqueue): void {
        [$db] = $setup();
        $a = authFixture($db);
        assertSame(true, $enqueue($db, $a['userId']));
        assertSame(false, $enqueue($db, $a['userId']), 'deduplicated while pending');
        $rows = $db->select('SELECT * FROM mail_outbox');
        assertSame(1, count($rows));
        assertSame(['id', 'user_id', 'kind', 'status', 'attempts', 'next_attempt_at', 'created_at', 'updated_at', 'request_id'], array_keys($rows[0]));
        assertTrue(!str_contains(json_encode($rows), $a['email']), 'no address');
        assertSame([], $db->select('SELECT token_hash FROM account_tokens WHERE user_id = ?', [$a['userId']]), 'no token before delivery');
    },
    'delivery: a fresh 30-minute recovery token, one mail with its link, row sent; only the hash is stored' => static function () use ($setup, $enqueue, $row, $openRecovery, $tokenIn): void {
        [$db, $t, $worker] = $setup();
        $a = authFixture($db);
        $enqueue($db, $a['userId']);
        assertSame(['sent' => 1, 'retried' => 0, 'failed' => 0, 'cancelled' => 0], $worker->run(20, requestId()));
        assertSame(1, count($t->sent));
        $m = $t->sent[0];
        assertSame([$a['email'], 'TAM OS password reset'], [$m->to, $m->subject]);
        $token = $tokenIn($m);
        assertSame([SessionToken::hash($token)], $openRecovery($db, $a['userId']), 'the mailed token is the one live recovery token');
        $life = (int) $db->select('SELECT TIMESTAMPDIFF(SECOND, created_at, expires_at) AS s FROM account_tokens WHERE token_hash = ?', [SessionToken::hash($token)])[0]['s'];
        assertSame(1800, $life);
        assertSame('sent', (string) $row($db, $a['userId'])['status']);
        $everything = '';
        foreach (['account_tokens', 'mail_outbox', 'auth_events', 'users', 'sessions'] as $table) {
            $everything .= json_encode($db->select('SELECT * FROM ' . $table));
        }
        assertTrue(!str_contains($everything, $token), 'the raw token is in no table');
    },
    'the provider is called outside any transaction: the token and the sending state are already committed' => static function () use ($setup, $enqueue): void {
        [$db, $t, $worker] = $setup();
        $a = authFixture($db);
        $enqueue($db, $a['userId']);
        $other = secondConnection();
        $seen = [];
        $t->during = static function (MailMessage $m) use ($other, $a, &$seen): void {
            $seen[] = (string) $other->select('SELECT status FROM mail_outbox WHERE user_id = ?', [$a['userId']])[0]['status'];
            $seen[] = (int) $other->select("SELECT COUNT(*) AS n FROM account_tokens WHERE user_id = ? AND purpose = 'recovery' AND revoked_at IS NULL", [$a['userId']])[0]['n'];
        };
        $worker->run(20, requestId());
        assertSame(['sending', 1], $seen, 'visible to another connection while the provider is being called');
    },
    'a failed attempt revokes its token and retries with backoff; the fifth failure is final with mail_fail' => static function () use ($setup, $enqueue, $row, $openRecovery, $due): void {
        [$db, $t, $worker] = $setup();
        $a = authFixture($db);
        $enqueue($db, $a['userId']);
        $t->fail = [MailError::UNAVAILABLE, MailError::TRANSPORT, MailError::REJECTED, MailError::UNAVAILABLE, MailError::UNAVAILABLE];
        for ($attempt = 1; $attempt <= 4; $attempt++) {
            assertSame(['sent' => 0, 'retried' => 1, 'failed' => 0, 'cancelled' => 0], $worker->run(20, requestId()), 'attempt ' . $attempt);
            $r = $row($db, $a['userId']);
            assertSame(['pending', $attempt, 1], [(string) $r['status'], (int) $r['attempts'], (int) $r['later']], 'backoff ' . $attempt);
            assertSame([], $openRecovery($db, $a['userId']), 'no live token after a failed attempt ' . $attempt);
            assertSame(['sent' => 0, 'retried' => 0, 'failed' => 0, 'cancelled' => 0], $worker->run(20, requestId()), 'not due yet');
            $due($db);
        }
        assertSame(['sent' => 0, 'retried' => 0, 'failed' => 1, 'cancelled' => 0], $worker->run(20, requestId()));
        assertSame(['failed', 5], [(string) $row($db, $a['userId'])['status'], (int) $row($db, $a['userId'])['attempts']]);
        assertSame([], $openRecovery($db, $a['userId']));
        assertSame([['event' => 'mail_fail', 'user_id' => $a['userId']]], $db->select("SELECT event, user_id FROM auth_events WHERE event = 'mail_fail'"));
        assertSame(0, count($t->sent));
    },
    'a row whose account can no longer recover is cancelled without a token or a mail' => static function () use ($setup, $enqueue, $row): void {
        [$db, $t, $worker] = $setup();
        // A pending (never activated) account is never mailed a recovery link. It must be the
        // first account: the bootstrap refuses once any company exists.
        $pending = pendingCeo($db);
        $enqueue($db, $pending['userId']);
        assertSame(['sent' => 0, 'retried' => 0, 'failed' => 0, 'cancelled' => 1], $worker->run(20, requestId()), 'pending account');
        $cases = [
            'disabled user' => static fn (array $a) => $db->execute("UPDATE users SET status = 'disabled' WHERE id = ?", [$a['userId']]),
            'disabled membership' => static fn (array $a) => $db->execute("UPDATE memberships SET status = 'disabled' WHERE user_id = ?", [$a['userId']]),
            'password removed (operator reset)' => static fn (array $a) => $db->execute('UPDATE users SET password_hash = NULL WHERE id = ?', [$a['userId']]),
        ];
        foreach ($cases as $label => $change) {
            $a = authFixture($db);
            $enqueue($db, $a['userId']);
            $change($a);
            assertSame(['sent' => 0, 'retried' => 0, 'failed' => 0, 'cancelled' => 1], $worker->run(20, requestId()), $label);
            assertSame('cancelled', (string) $row($db, $a['userId'])['status'], $label);
            assertSame([], $db->select('SELECT token_hash FROM account_tokens WHERE user_id = ?', [$a['userId']]), $label . ': no token');
        }
        assertSame(0, count($t->sent));
    },
    'a new delivery replaces the previous recovery link; a stale sending row is reclaimed and its token revoked' => static function () use ($setup, $enqueue, $openRecovery, $tokenIn): void {
        [$db, $t, $worker] = $setup();
        $a = authFixture($db);
        $enqueue($db, $a['userId']);
        $worker->run(20, requestId());
        $first = SessionToken::hash($tokenIn($t->sent[0]));
        $enqueue($db, $a['userId']);
        $worker->run(20, requestId());
        $second = SessionToken::hash($tokenIn($t->sent[1]));
        assertSame([$second], $openRecovery($db, $a['userId']), 'only the newest link lives');
        assertTrue($first !== $second, 'fresh token');
        // A worker died after committing `sending`: its token is live but its mail may not exist.
        $enqueue($db, $a['userId']);
        $db->execute("UPDATE mail_outbox SET status = 'sending', attempts = 1, updated_at = UTC_TIMESTAMP(6) - INTERVAL 11 MINUTE WHERE status = 'pending'");
        assertSame(1, $worker->run(20, requestId())['sent'], 'reclaimed');
        $third = SessionToken::hash($tokenIn($t->sent[2]));
        assertSame([$third], $openRecovery($db, $a['userId']), 'the stale attempt left no live token');
        assertSame(2, (int) $db->select("SELECT attempts FROM mail_outbox WHERE status = 'sent' ORDER BY id DESC LIMIT 1")[0]['attempts']);
    },
    'one worker at a time: the mail lock is exclusive across connections' => static function (): void {
        $db = authDatabase();
        $a = AuthData::fromDatabase(secondConnection());
        $b = AuthData::fromDatabase(secondConnection());
        assertSame(true, $a->acquireMailLock());
        assertSame(false, $b->acquireMailLock(), 'held elsewhere');
        $a->releaseMailLock();
        assertSame(true, $b->acquireMailLock(), 'free again');
        $b->releaseMailLock();
        assertTrue($db instanceof Database, 'db ready');
    },
    'the CLI: usage 2; a missing or placeholder mail section is refused; nothing due sends nothing' => static function (): void {
        authDatabase();
        $script = 'mail.php';
        $usage = runCli($script, ['send'], null);
        assertSame([2, "usage: php server/bin/mail.php run\n"], [$usage['exit'], $usage['stderr']]);
        $none = runCli($script, ['run'], writeConfigFile(testDbConfig()));
        assertSame([1, '', "mail: config\n"], [$none['exit'], $none['stdout'], $none['stderr']]);
        $mail = ['transport' => 'resend', 'from' => 'TAM OS <no-reply@example.test>', 'api_key' => 're_test_not_a_real_key'];
        $ok = runCli($script, ['run'], writeConfigFile(testConfig(['db' => testDbConfig()->db, 'mail' => $mail])));
        assertSame([0, "sent: 0, retried: 0, failed: 0, cancelled: 0\n", ''], [$ok['exit'], $ok['stdout'], $ok['stderr']], 'empty outbox: no provider call');
        $holder = AuthData::fromDatabase(secondConnection());
        $holder->acquireMailLock();
        $busy = runCli($script, ['run'], writeConfigFile(testConfig(['db' => testDbConfig()->db, 'mail' => $mail])));
        assertSame([1, "mail: busy\n"], [$busy['exit'], $busy['stderr']]);
        $holder->releaseMailLock();
        foreach ([$usage, $none, $ok, $busy] as $out) {
            assertTrue(!str_contains($out['stdout'] . $out['stderr'], 're_test_not_a_real_key'), 'no key in CLI output');
        }
    },
];
