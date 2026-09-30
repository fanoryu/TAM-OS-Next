<?php
declare(strict_types=1);

/*
 * BF-3B statement contracts, without a database: the activation-token and account SQL carry
 * exactly the validity, final-state, locking and compare-and-swap predicates the design relies
 * on; the PHP event vocabulary equals the database CHECK; raw tokens are refused at the store.
 * The guarded database suite proves the same behaviour against MariaDB.
 */

use TamOs\Auth\LoginKeys;
use TamOs\Data\Auth\AccountStore;
use TamOs\Data\Auth\AccountTokenStore;
use TamOs\Data\Auth\AuthEvents;
use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\productionMigrationsDir;

$live = ['used_at IS NULL', 'revoked_at IS NULL', 'expires_at > UTC_TIMESTAMP(6)'];

return [
    'activation tokens live 72 hours from the database clock' => static function (): void {
        assertSame(72, AccountTokenStore::ACTIVATION_HOURS);
        assertTrue(str_contains(AccountTokenStore::ISSUE_SQL, 'UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 72 HOUR, NULL, NULL)'), 'issue: created, expires, not used, not revoked');
        assertSame('activation', AccountTokenStore::ACTIVATION);
    },
    'recovery tokens (BF-3D) live 30 minutes from the database clock' => static function (): void {
        assertSame(30, AccountTokenStore::RECOVERY_MINUTES);
        assertTrue(str_contains(AccountTokenStore::ISSUE_RECOVERY_SQL, 'UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 30 MINUTE, NULL, NULL)'), 'issue: 30 minutes, not used, not revoked');
        assertSame(['activation', 'recovery'], AccountTokenStore::PURPOSES);
        $sql = (string) file_get_contents(productionMigrationsDir() . '/0011_replace_account_tokens_purpose_check.sql');
        assertSame("ALTER TABLE account_tokens DROP CONSTRAINT account_tokens_purpose, ADD CONSTRAINT account_tokens_purpose_v2 CHECK (purpose IN ('activation', 'recovery'));\n", $sql, 'the database purposes equal the store');
    },
    'every lookup names its purpose; credential-event revocation covers every purpose' => static function (): void {
        foreach (['peek' => AccountTokenStore::PEEK_SQL, 'lock' => AccountTokenStore::LOCK_LIVE_SQL, 'consume' => AccountTokenStore::CONSUME_SQL] as $name => $sql) {
            assertTrue(str_contains($sql, 'purpose = ?'), $name . ' is purpose-bound');
        }
        assertTrue(!str_contains(AccountTokenStore::REVOKE_ALL_OPEN_SQL, 'purpose'), 'revoke-all is purpose-agnostic');
        assertTrue(str_contains(AccountTokenStore::REVOKE_ALL_OPEN_SQL, 'WHERE user_id = ?'), 'revoke-all is per user');
        assertTrue(str_contains(AccountTokenStore::REVOKE_SQL, 'WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL'), 'single revoke only over a non-final token');
    },
    'an unknown purpose is refused before any database work' => static function (): void {
        $store = new AccountTokenStore(new Database(DatabaseConfig::fromArray(['host' => '127.0.0.1', 'port' => 1, 'name' => 'none_test', 'user' => 'none', 'pass' => ''])));
        foreach (['', 'reset', 'Recovery', 'activation '] as $bad) {
            assertThrows(LogicException::class, static fn () => $store->issue(str_repeat('a', 64), str_repeat('1', 32), $bad), 'issue ' . $bad);
            assertThrows(LogicException::class, static fn () => $store->peek(str_repeat('a', 64), $bad), 'peek ' . $bad);
            assertThrows(LogicException::class, static fn () => $store->consume(str_repeat('a', 64), $bad), 'consume ' . $bad);
        }
    },
    'peek, lock and consume all require a live token: not used, not revoked, strictly before expiry' => static function () use ($live): void {
        foreach (['peek' => AccountTokenStore::PEEK_SQL, 'lock' => AccountTokenStore::LOCK_LIVE_SQL, 'consume' => AccountTokenStore::CONSUME_SQL] as $name => $sql) {
            foreach ($live as $predicate) {
                assertTrue(str_contains($sql, $predicate), $name . ': ' . $predicate);
            }
            assertTrue(!str_contains($sql, 'expires_at >= ') && !preg_match('/\bNOW\(|CURRENT_TIMESTAMP|SYSDATE/i', $sql), $name . ': strict, database clock');
        }
        assertTrue(str_contains(AccountTokenStore::LOCK_LIVE_SQL, 'user_id = ?'), 'lock: the token must belong to the locked user');
    },
    'the token row and the account rows are locked with FOR UPDATE before any write' => static function (): void {
        assertTrue(str_ends_with(AccountTokenStore::LOCK_LIVE_SQL, ' FOR UPDATE'), 'token row');
        assertTrue(str_ends_with(AccountStore::LOCK_BY_ID_SQL, 'WHERE u.id = ? FOR UPDATE'), 'account by id');
        assertTrue(str_ends_with(AccountStore::LOCK_BY_EMAIL_SQL, 'WHERE u.email = ? FOR UPDATE'), 'account by email');
        assertTrue(!str_contains(AccountStore::ACCOUNT_COLUMNS_SQL, 'FOR UPDATE'), 'the consistent read does not lock');
    },
    'a final state is written only over a non-final token, so used and revoked never coexist' => static function (): void {
        assertTrue(str_contains(AccountTokenStore::CONSUME_SQL, 'SET used_at = UTC_TIMESTAMP(6)'), 'consume sets used_at');
        foreach ([AccountTokenStore::REVOKE_ALL_OPEN_SQL, AccountTokenStore::REVOKE_SQL] as $revoke) {
            assertTrue(str_contains($revoke, 'SET revoked_at = UTC_TIMESTAMP(6)'), 'revoke sets revoked_at');
            foreach (['used_at IS NULL', 'revoked_at IS NULL'] as $predicate) {
                assertTrue(str_contains($revoke, $predicate), 'revoke: ' . $predicate);
            }
        }
        $sql = (string) file_get_contents(productionMigrationsDir() . '/0007_create_account_tokens.sql');
        assertTrue(str_contains($sql, 'CONSTRAINT account_tokens_final CHECK (used_at IS NULL OR revoked_at IS NULL)'), 'the database refuses both');
        assertTrue(str_contains($sql, 'CONSTRAINT account_tokens_used_in_time CHECK (used_at IS NULL OR used_at < expires_at)'), 'never used at or after expiry');
        assertTrue(!str_contains($sql, 'token VARCHAR') && str_contains($sql, 'token_hash CHAR(64)'), 'only a hash column');
    },
    'password writes are compare-and-swap: first password only over NULL, change only over the verified hash' => static function (): void {
        assertTrue(str_ends_with(AccountStore::SET_INITIAL_HASH_SQL, 'WHERE id = ? AND password_hash IS NULL'), 'activation');
        assertTrue(str_ends_with(AccountStore::REPLACE_HASH_SQL, 'WHERE id = ? AND password_hash = ?'), 'change / rehash');
        assertTrue(str_contains(AccountStore::CLEAR_HASH_SQL, 'SET password_hash = NULL'), 'operator reset');
    },
    'the store refuses to persist anything but a SHA-256 hex digest (no raw token at rest)' => static function (): void {
        $store = new AccountTokenStore(new Database(DatabaseConfig::fromArray(['host' => '127.0.0.1', 'port' => 1, 'name' => 'none_test', 'user' => 'none', 'pass' => ''])));
        foreach ([str_repeat('A', 43), 'raw-token', str_repeat('A', 64), str_repeat('a', 63), ''] as $bad) {
            foreach (AccountTokenStore::PURPOSES as $purpose) {
                assertThrows(LogicException::class, static fn () => $store->issue($bad, str_repeat('1', 32), $purpose), 'refused: ' . substr($bad, 0, 8) . ' ' . $purpose);
            }
        }
    },
    'the PHP event vocabulary equals the database CHECK of migration 0012, and keeps BF-3A and BF-3B' => static function (): void {
        $sql = (string) file_get_contents(productionMigrationsDir() . '/0012_replace_auth_events_event_check.sql');
        assertTrue(preg_match("/ADD CONSTRAINT auth_events_event_v3 CHECK \\(event IN \\(([^)]*)\\)\\)/", $sql, $m) === 1, 'CHECK found');
        $db = array_map(static fn (string $s): string => trim($s, " '"), explode(',', $m[1]));
        assertSame(AuthEvents::EVENTS, $db);
        assertSame(['login_success', 'login_failure', 'login_locked', 'logout'], array_slice(AuthEvents::EVENTS, 0, 4), 'BF-3A events kept');
        assertSame(['ceo_bootstrap', 'credential_reset', 'activation_ok', 'activation_fail', 'password_change', 'password_fail', 'logout_all'], array_slice(AuthEvents::EVENTS, 4, 7), 'BF-3B events kept');
        assertSame(['recovery_req', 'recovery_ok', 'recovery_fail', 'mail_fail'], array_slice(AuthEvents::EVENTS, 11), 'BF-3D events');
        foreach (AuthEvents::EVENTS as $event) {
            assertTrue(strlen($event) <= 16, 'fits VARCHAR(16): ' . $event);
        }
        assertTrue(str_contains($sql, 'DROP CONSTRAINT auth_events_event_v2,'), 'the BF-3B CHECK is replaced, not stacked');
    },
    'activation and password-change buckets are domain-separated from login' => static function (): void {
        assertSame(hash('sha256', 'activate-ip:4:203.0.113.7'), LoginKeys::activationIpBucket('203.0.113.7'));
        assertSame(hash('sha256', 'activate-ip:none'), LoginKeys::activationIpBucket(null));
        assertSame(hash('sha256', 'pwchange:' . str_repeat('1', 32)), LoginKeys::passwordChangeBucket(str_repeat('1', 32)));
        assertTrue(LoginKeys::activationIpBucket('203.0.113.7') !== LoginKeys::ipBucket('203.0.113.7'), 'not the login IP bucket');
    },
];
