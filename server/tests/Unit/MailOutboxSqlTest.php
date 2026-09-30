<?php
declare(strict_types=1);

/*
 * The outbox statement contracts (BF-3D, D-D3), without a database: delivery intent only, the
 * state predicates every transition relies on, the bounded retry schedule, and the attempt cap
 * equal to the database CHECK. The MariaDB suite proves the behaviour.
 */

use TamOs\Data\Auth\MailOutboxStore;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\productionMigrationsDir;

return [
    'the outbox holds delivery intent only: no address, token, link or body column' => static function (): void {
        $sql = (string) file_get_contents(productionMigrationsDir() . '/0013_create_mail_outbox.sql');
        preg_match_all('/^\s{2}([a-z_]+) [A-Z]/m', $sql, $m);
        assertSame(['id', 'user_id', 'kind', 'status', 'attempts', 'next_attempt_at', 'created_at', 'updated_at', 'request_id'], $m[1]);
        foreach (['email', 'token', 'link', 'url', 'body', 'subject', 'recipient'] as $word) {
            assertTrue(!str_contains($sql, $word), 'no ' . $word);
        }
        assertTrue(str_contains($sql, "CONSTRAINT mail_outbox_attempts CHECK (attempts <= 5)"), 'cap in the database');
        assertSame(5, MailOutboxStore::MAX_ATTEMPTS, 'cap in PHP equals the CHECK');
    },
    'transitions are guarded by the state they leave' => static function (): void {
        assertTrue(str_ends_with(MailOutboxStore::MARK_SENT_SQL, "WHERE id = ? AND status = 'sending'"), 'sent only from sending');
        assertTrue(str_ends_with(MailOutboxStore::RETRY_SQL, "WHERE id = ? AND status = 'sending'"), 'retry only from sending');
        assertTrue(str_contains(MailOutboxStore::RETRY_SQL, 'next_attempt_at = UTC_TIMESTAMP(6) + INTERVAL ? SECOND'), 'retry delay on the database clock');
        assertTrue(str_ends_with(MailOutboxStore::CLAIM_SQL, 'ORDER BY id LIMIT 1 FOR UPDATE'), 'claim locks one row');
        assertTrue(str_contains(MailOutboxStore::CLAIM_SQL, "status = 'sending' AND updated_at <= UTC_TIMESTAMP(6) - INTERVAL 10 MINUTE"), 'stale sending is reclaimed');
        assertSame(10, MailOutboxStore::STALE_MINUTES);
        assertTrue(str_ends_with(MailOutboxStore::OPEN_FOR_USER_SQL, "status IN ('pending', 'sending') FOR UPDATE"), 'one open mail per user and kind');
    },
    'retry is bounded: 1, 5, 15, 60 minutes, then failed' => static function (): void {
        assertSame([60, 300, 900, 3600], [MailOutboxStore::backoff(1), MailOutboxStore::backoff(2), MailOutboxStore::backoff(3), MailOutboxStore::backoff(4)]);
        foreach ([0, 5, 6, -1] as $attempt) {
            assertThrows(\LogicException::class, static fn () => MailOutboxStore::backoff($attempt), 'attempt ' . $attempt);
        }
    },
];
