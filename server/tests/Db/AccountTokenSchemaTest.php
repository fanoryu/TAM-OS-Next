<?php
declare(strict_types=1);

/*
 * The BF-3B schema (migrations 0007 account_tokens, 0008 event vocabulary) against the real,
 * guarded CI MariaDB: every CHECK and the foreign key are enforced by the database itself, and
 * the replaced event CHECK accepts exactly the BF-3A + BF-3B vocabulary.
 */

use TamOs\Data\Auth\AuthEvents;
use TamOs\Data\Database;
use TamOs\Data\DatabaseError;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\requestId;

$insert = 'INSERT INTO account_tokens (token_hash, user_id, purpose, created_at, expires_at, used_at, revoked_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 72 HOUR, ?, ?)';
$hash = static fn (): string => hash('sha256', random_bytes(32));
$refused = static fn (Database $db, string $sql, array $params, string $label): DatabaseError => assertThrows(DatabaseError::class, static fn () => $db->execute($sql, $params), $label);

return [
    'account_tokens: a live activation token for an existing user is accepted' => static function () use ($insert, $hash): void {
        $db = authDatabase();
        $a = authFixture($db, ['password' => null]);
        assertSame(1, $db->execute($insert, [$hash(), $a['userId'], 'activation', null, null]));
    },
    'account_tokens: every CHECK is enforced by MariaDB' => static function () use ($insert, $hash, $refused): void {
        $db = authDatabase();
        $a = authFixture($db, ['password' => null]);
        $cases = [
            'unknown purpose' => [$insert, [$hash(), $a['userId'], 'recovery', null, null]],
            'used and revoked' => [$insert, [$hash(), $a['userId'], 'activation', '2026-01-01 00:00:00.000000', '2026-01-01 00:00:00.000000']],
            'expires not after created' => ['INSERT INTO account_tokens (token_hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))', [$hash(), $a['userId'], 'activation']],
            'used at expiry' => ['INSERT INTO account_tokens (token_hash, user_id, purpose, created_at, expires_at, used_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6) - INTERVAL 1 HOUR, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))', [$hash(), $a['userId'], 'activation']],
            'used after expiry' => ['INSERT INTO account_tokens (token_hash, user_id, purpose, created_at, expires_at, used_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6) - INTERVAL 2 HOUR, UTC_TIMESTAMP(6) - INTERVAL 1 HOUR, UTC_TIMESTAMP(6))', [$hash(), $a['userId'], 'activation']],
        ];
        foreach ($cases as $label => [$sql, $params]) {
            $e = $refused($db, $sql, $params, $label);
            assertSame(['23000', 4025], [$e->sqlstate, $e->driverCode], $label . ': CHECK failure');
        }
        // A live token cannot later become both used and revoked.
        $h = $hash();
        $db->execute($insert, [$h, $a['userId'], 'activation', null, null]);
        $db->execute('UPDATE account_tokens SET used_at = UTC_TIMESTAMP(6) WHERE token_hash = ?', [$h]);
        $e = $refused($db, 'UPDATE account_tokens SET revoked_at = UTC_TIMESTAMP(6) WHERE token_hash = ?', [$h], 'revoke a used token');
        assertSame(4025, $e->driverCode);
    },
    'account_tokens: the user must exist, and a token hash is unique' => static function () use ($insert, $hash, $refused): void {
        $db = authDatabase();
        $a = authFixture($db, ['password' => null]);
        assertSame(1452, $refused($db, $insert, [$hash(), bin2hex(random_bytes(16)), 'activation', null, null], 'unknown user')->driverCode);
        $h = $hash();
        $db->execute($insert, [$h, $a['userId'], 'activation', null, null]);
        assertSame(1062, $refused($db, $insert, [$h, $a['userId'], 'activation', null, null], 'duplicate hash')->driverCode);
        assertSame(1451, $refused($db, 'DELETE FROM users WHERE id = ?', [$a['userId']], 'user referenced by a token')->driverCode);
    },
    'auth_events: the replaced CHECK accepts exactly the BF-3A and BF-3B vocabulary' => static function () use ($refused): void {
        $db = authDatabase();
        $sql = 'INSERT INTO auth_events (occurred_at, event, request_id) VALUES (UTC_TIMESTAMP(6), ?, ?)';
        foreach (AuthEvents::EVENTS as $event) {
            assertSame(1, $db->execute($sql, [$event, requestId()]), $event);
        }
        foreach (['activation_issue', 'activation_lock', 'password_locked', 'sessions_revoked', 'password_changed', 'account_created', ''] as $event) {
            $e = $refused($db, $sql, [$event, requestId()], 'refused: ' . $event);
            assertSame(4025, $e->driverCode, $event);
        }
        $names = array_column($db->select("SELECT CONSTRAINT_NAME AS n FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_events'"), 'n');
        assertSame(['auth_events_event_v2'], $names, 'the BF-3A constraint was replaced, not stacked');
    },
];
