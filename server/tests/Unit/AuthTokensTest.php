<?php
declare(strict_types=1);

use TamOs\Auth\EmailAddress;
use TamOs\Auth\LoginKeys;
use TamOs\Auth\SessionToken;
use TamOs\Data\Auth\SessionStore;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;

return [
    'session and CSRF tokens: 43 base64url characters from 32 random bytes, never repeated' => static function (): void {
        $seen = [];
        for ($i = 0; $i < 200; $i++) {
            foreach ([SessionToken::generate(), SessionToken::generateCsrf()] as $t) {
                assertSame(43, strlen($t));
                assertTrue(preg_match('/^[A-Za-z0-9_-]{43}$/', $t) === 1, 'alphabet');
                assertSame(32, strlen(base64_decode(strtr($t, '-_', '+/') . '=', true)), '32 bytes');
                assertTrue(!isset($seen[$t]), 'unique');
                $seen[$t] = true;
            }
        }
    },
    'isWellFormed accepts only the exact token shape' => static function (): void {
        assertTrue(SessionToken::isWellFormed(str_repeat('a', 43)), 'ok');
        foreach ([null, '', str_repeat('a', 42), str_repeat('a', 44), str_repeat('a', 42) . '=', str_repeat('a', 42) . '+',
            str_repeat('a', 42) . '/', str_repeat('a', 42) . "\n", ' ' . str_repeat('a', 42)] as $bad) {
            assertTrue(!SessionToken::isWellFormed($bad), 'rejects ' . var_export($bad, true));
        }
    },
    'the at-rest session identifier is lower-case hex SHA-256 of the raw token' => static function (): void {
        $t = SessionToken::generate();
        assertSame(hash('sha256', $t), SessionToken::hash($t));
        assertTrue(preg_match('/^[0-9a-f]{64}$/', SessionToken::hash($t)) === 1, 'hex');
        assertTrue(!str_contains(SessionToken::hash($t), $t), 'not the token');
    },
    'email: trimmed and lower-cased; ASCII, FILTER_VALIDATE_EMAIL, ≤ 254 bytes; no alias or dot rewriting' => static function (): void {
        assertSame('first.last+tag@example.test', EmailAddress::candidate("  First.Last+Tag@Example.TEST \t"));
        assertTrue(EmailAddress::isValid('first.last+tag@example.test'), 'plus and dots are kept and valid');
        assertTrue(EmailAddress::candidate('a.b@example.test') !== EmailAddress::candidate('ab@example.test'), 'no dot rewriting');
        foreach (['', 'no-at-sign', 'a@', '@example.test', 'ü@example.test', 'a@exämple.test', 'a b@example.test',
            str_repeat('a', 64) . '@' . str_repeat('b', 185) . '.test'] as $bad) {
            assertTrue(!EmailAddress::isValid(EmailAddress::candidate($bad)), 'invalid: ' . $bad);
        }
    },
    'bucket and audit keys are domain-separated hashes of the candidate, computed for invalid input too' => static function (): void {
        $c = EmailAddress::candidate(' Someone@Example.TEST ');
        assertSame(hash('sha256', 'acct:someone@example.test'), LoginKeys::accountBucket($c));
        assertSame(hash('sha256', 'email:someone@example.test'), LoginKeys::emailHash($c));
        assertTrue(LoginKeys::accountBucket($c) !== LoginKeys::emailHash($c), 'separate domains');
        assertSame(hash('sha256', 'acct:not an email'), LoginKeys::accountBucket(EmailAddress::candidate('Not An Email')));
    },
    'IP keys: full IPv4, IPv6 /64, IPv4-mapped as IPv4, anything else one shared bucket' => static function (): void {
        assertSame('4:203.0.113.7', LoginKeys::ipKey('203.0.113.7'));
        assertSame('4:203.0.113.7', LoginKeys::ipKey('::ffff:203.0.113.7'));
        assertSame('6:20010db800010002', LoginKeys::ipKey('2001:db8:1:2::1'));
        assertSame(LoginKeys::ipKey('2001:db8:1:2::1'), LoginKeys::ipKey('2001:db8:1:2:ffff:ffff:ffff:ffff'), 'same /64');
        assertTrue(LoginKeys::ipKey('2001:db8:1:2::1') !== LoginKeys::ipKey('2001:db8:1:3::1'), 'different /64');
        foreach ([null, '', 'junk', '10.0.0.1, 10.0.0.2'] as $bad) {
            assertSame('none', LoginKeys::ipKey($bad));
        }
        assertSame(hash('sha256', 'ip:4:203.0.113.7'), LoginKeys::ipBucket('203.0.113.7'));
    },
    'session SQL: resolution and touch both carry every validity predicate on the database clock' => static function (): void {
        $validity = ['revoked_at IS NULL', 'absolute_expires_at > UTC_TIMESTAMP(6)', 'last_seen_at > UTC_TIMESTAMP(6) - INTERVAL 30 MINUTE'];
        foreach ($validity as $predicate) {
            assertTrue(str_contains(SessionStore::FIND_SQL, $predicate), 'find: ' . $predicate);
            assertTrue(str_contains(SessionStore::TOUCH_SQL, $predicate), 'touch (no resurrection): ' . $predicate);
        }
        assertTrue(str_contains(SessionStore::TOUCH_SQL, 'last_seen_at <= UTC_TIMESTAMP(6) - INTERVAL 60 SECOND'), 'touch throttle');
        assertTrue(str_contains(SessionStore::CREATE_SQL, 'UTC_TIMESTAMP(6) + INTERVAL 12 HOUR'), 'absolute lifetime');
        assertSame([30, 12, 60], [SessionStore::IDLE_MINUTES, SessionStore::ABSOLUTE_HOURS, SessionStore::TOUCH_SECONDS]);
        foreach ([SessionStore::FIND_SQL, SessionStore::TOUCH_SQL, SessionStore::CREATE_SQL] as $sql) {
            assertTrue(!preg_match('/\bNOW\(|CURRENT_TIMESTAMP|SYSDATE/i', $sql), 'UTC_TIMESTAMP only');
        }
    },
];
