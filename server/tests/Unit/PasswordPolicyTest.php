<?php
declare(strict_types=1);

/*
 * The one set-time password rule (BF-3B, SDR-0002 §2.2) and its compatibility with login:
 * anything the policy accepts, login's Passwords::isAcceptableInput accepts too.
 */

use TamOs\Auth\PasswordPolicy;
use TamOs\Auth\Passwords;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;

$email = 'ceo-owner@example.test';

return [
    'length: 12 code points is the minimum, 72 bytes the maximum' => static function (): void {
        assertSame(PasswordPolicy::TOO_SHORT, PasswordPolicy::check('abcdefghij1'), '11 code points');
        assertSame(null, PasswordPolicy::check('abcdefghij1k'), '12 code points');
        assertSame(null, PasswordPolicy::check(str_repeat('ab1', 24)), '72 bytes');
        assertSame(PasswordPolicy::TOO_LONG, PasswordPolicy::check(str_repeat('ab1', 24) . 'x'), '73 bytes');
        assertSame([12, 72], [PasswordPolicy::MIN_CODE_POINTS, PasswordPolicy::MAX_BYTES]);
        assertSame(Passwords::MAX_BYTES, PasswordPolicy::MAX_BYTES, 'one byte limit for setting and for login');
    },
    'length is counted in code points for the minimum and in bytes for the maximum' => static function (): void {
        // 11 three-byte characters = 33 bytes but only 11 code points.
        assertSame(PasswordPolicy::TOO_SHORT, PasswordPolicy::check(str_repeat('é', 5) . str_repeat('日', 6)), '11 multibyte code points');
        assertSame(null, PasswordPolicy::check(str_repeat('日', 12)), '12 three-byte code points = 36 bytes');
        assertSame(null, PasswordPolicy::check(str_repeat('日', 24)), '24 three-byte code points = 72 bytes');
        assertSame(PasswordPolicy::TOO_LONG, PasswordPolicy::check(str_repeat('日', 24) . 'a'), '73 bytes although only 25 code points');
        assertSame(null, PasswordPolicy::check(str_repeat('😀', 12) . 'abcdefghijkl' . 'mnopqrstuvwx'), '4-byte code points: 12 × 4 + 24 = 72 bytes');
        assertSame(PasswordPolicy::TOO_LONG, PasswordPolicy::check(str_repeat('😀', 18) . 'a'), '73 bytes of emoji and ASCII');
    },
    'control characters (Unicode Cc, NUL included) and invalid UTF-8 are refused' => static function (): void {
        foreach (["\0", "\t", "\n", "\r", "\x1B", "\x7F", "\u{0085}", "\u{009F}"] as $c) {
            assertSame(PasswordPolicy::INVALID_CHARACTERS, PasswordPolicy::check('abcdefghijkl' . $c), 'control ' . bin2hex($c));
        }
        assertSame(PasswordPolicy::INVALID_CHARACTERS, PasswordPolicy::check("abcdefghijkl\xC3"), 'truncated UTF-8');
        assertSame(PasswordPolicy::INVALID_CHARACTERS, PasswordPolicy::check("abcdefghijkl\xFF"), 'invalid byte');
        assertSame(PasswordPolicy::INVALID_CHARACTERS, PasswordPolicy::check("abc\xED\xA0\x80defghijkl"), 'encoded surrogate');
    },
    'nothing is trimmed or normalized; spaces are ordinary characters' => static function (): void {
        assertSame(null, PasswordPolicy::check('  leading and trailing  '), 'spaces kept');
        assertSame(PasswordPolicy::TOO_SHORT, PasswordPolicy::check('   abcdefgh'), 'spaces count, 11 code points');
        assertSame(null, PasswordPolicy::check('            '), '12 spaces are 12 code points');
        assertSame(null, PasswordPolicy::check("e\u{0301}" . 'bcdefghijkl'), 'a decomposed é is two code points, not normalized');
        assertSame(null, PasswordPolicy::check("\u{00A0}" . 'bcdefghijkl' . "\u{200B}"), 'non-breaking and zero-width spaces are not Cc');
    },
    'the account email is refused, ASCII case-insensitively, and only for that account' => static function () use ($email): void {
        assertSame(PasswordPolicy::EQUALS_EMAIL, PasswordPolicy::checkForAccount($email, $email));
        assertSame(PasswordPolicy::EQUALS_EMAIL, PasswordPolicy::checkForAccount('CEO-Owner@Example.TEST', $email));
        assertSame(null, PasswordPolicy::checkForAccount(' ' . $email, $email), 'not trimmed: a different password');
        assertSame(null, PasswordPolicy::checkForAccount($email, 'someone-else@example.test'));
        assertSame(null, PasswordPolicy::check($email), 'the account-free rules do not know the email');
        assertSame(PasswordPolicy::TOO_SHORT, PasswordPolicy::checkForAccount('a@b.test', 'a@b.test'), 'account-free rules come first');
    },
    'the common list: bounded, lower-case, only entries the length rule would not already refuse' => static function (): void {
        assertTrue(count(PasswordPolicy::COMMON) >= 1 && count(PasswordPolicy::COMMON) <= 100, 'at most 100 entries');
        assertSame(count(PasswordPolicy::COMMON), count(array_unique(PasswordPolicy::COMMON)), 'no duplicates');
        foreach (PasswordPolicy::COMMON as $entry) {
            assertSame(strtolower($entry), $entry, 'lower case: ' . $entry);
            assertTrue(preg_match_all('/./su', $entry) >= 12 && strlen($entry) <= 72, 'within the length rule: ' . $entry);
            assertSame(PasswordPolicy::COMMON_PASSWORD, PasswordPolicy::check($entry), 'refused: ' . $entry);
            assertSame(PasswordPolicy::COMMON_PASSWORD, PasswordPolicy::check(strtoupper($entry)), 'refused in upper case: ' . $entry);
        }
        assertSame(null, PasswordPolicy::check('password12345x'), 'exact match only, no fuzzy matching');
    },
    'compatibility: every policy-accepted password is acceptable login input (fixed and random corpus)' => static function (): void {
        $corpus = ['abcdefghijkl', str_repeat('ab1', 24), str_repeat('日', 24), str_repeat('😀', 12) . str_repeat('a', 24), '            ', "e\u{0301}bcdefghijkl"];
        $valid = ['a', 'Z', '7', ' ', '-', 'é', '日', '😀', "\u{00A0}"];
        $invalid = ["\t", "\0", "\xFF", "\xC3"];
        mt_srand(3);
        for ($i = 0; $i < 4000; $i++) {
            $s = '';
            for ($n = mt_rand(0, 30); $n > 0; $n--) {
                $s .= mt_rand(1, 40) === 1 ? $invalid[mt_rand(0, count($invalid) - 1)] : $valid[mt_rand(0, count($valid) - 1)];
            }
            $corpus[] = $s;
        }
        $accepted = 0;
        foreach ($corpus as $password) {
            if (PasswordPolicy::check($password) === null) {
                $accepted++;
                assertTrue(Passwords::isAcceptableInput($password), 'accepted but not acceptable login input: ' . bin2hex($password));
            }
        }
        assertTrue($accepted > 100, 'the corpus exercises accepted passwords (' . $accepted . ')');
    },
];
