<?php
declare(strict_types=1);

namespace TamOs\Auth;

/**
 * The one rule for a password being SET — activation, password change and (later) recovery
 * (SDR-0002 §2.2). Login never applies it: login only refuses what Passwords::isAcceptableInput
 * refuses, and everything accepted here is acceptable input there (a unit test proves it), so
 * a password set through this policy can always be used to log in.
 *
 *   valid UTF-8; no control character (Unicode Cc, NUL included); at least 12 code points;
 *   at most 72 bytes (the bcrypt limit, applied to every algorithm); not the account's own
 *   email; not in the short COMMON list.
 *
 * Nothing is trimmed and nothing is normalized — the password is exactly the bytes the user
 * sent, as at login. Whitespace is allowed anywhere. There are no composition rules. A
 * non-ASCII password gets fewer than 72 characters (e.g. 24 three-byte characters).
 */
final class PasswordPolicy
{
    public const MIN_CODE_POINTS = 12;
    public const MAX_BYTES = Passwords::MAX_BYTES;

    public const INVALID_CHARACTERS = 'invalid_characters';
    public const TOO_SHORT = 'too_short';
    public const TOO_LONG = 'too_long';
    public const COMMON_PASSWORD = 'common_password';
    public const EQUALS_EMAIL = 'equals_email';

    /**
     * A hand-picked sample of long passwords that recur in public breach-frequency lists (such
     * as the SecLists "Common-Credentials" collection) — not an extract of any one list, not
     * exhaustive, and no substitute for breach-corpus screening. Only entries of 12 or more
     * code points are kept (shorter ones are already refused by length). Lower case; a
     * password matches when its ASCII lower-case form equals an entry. It stops only the most
     * predictable long passwords that an online guesser would try first; it is kept because
     * SDR-0002 §2.2 names a common-password list as a default.
     */
    public const COMMON = [
        '123456789012', '1234567890123', '12345678901234', '123456789012345', '1234567890123456',
        '123456789123', '1234567891011', '111111111111', '000000000000', '123123123123',
        '123412341234', '121212121212', '112233445566', '987654321098', '098765432109',
        '1q2w3e4r5t6y', '1qaz2wsx3edc', 'qazwsxedcrfv', 'qwertyuiopas', 'qwerty123456',
        'qwertyuiop123', 'qwertyuiopasdfghjkl', 'asdfghjkl123', 'asdfasdfasdf', 'zxcvbnm12345',
        'password1234', 'password12345', 'password123456', 'passwordpassword', 'passw0rd1234',
        'abcdefghijkl', 'abcdefghijklmnop', 'abc123abc123', 'abcd1234abcd', 'iloveyou1234',
        'iloveyouiloveyou', 'welcome12345', 'letmein12345', 'changeme1234', 'administrator',
        'administrator1', 'football1234', 'baseball1234', 'sunshine1234', 'princess1234',
        'indonesia123', 'bismillah123', 'bismillah1234',
    ];

    /**
     * The rules that need no account: the name of the first one broken, or null when all hold.
     * Activation and password change apply these before any database work.
     */
    public static function check(#[\SensitiveParameter] string $password): ?string
    {
        if (preg_match('//u', $password) !== 1 || preg_match('/\p{Cc}/u', $password) === 1) {
            return self::INVALID_CHARACTERS;
        }
        if (strlen($password) > self::MAX_BYTES) {
            return self::TOO_LONG;
        }
        if (preg_match_all('/./su', $password) < self::MIN_CODE_POINTS) {
            return self::TOO_SHORT;
        }
        if (in_array(strtolower($password), self::COMMON, true)) {
            return self::COMMON_PASSWORD;
        }
        return null;
    }

    /**
     * Every rule, against the account the password is for. $accountEmail is the stored,
     * normalized address read from the database — never a value the client sent.
     */
    public static function checkForAccount(#[\SensitiveParameter] string $password, string $accountEmail): ?string
    {
        $broken = self::check($password);
        if ($broken !== null) {
            return $broken;
        }
        return strtolower($password) === $accountEmail ? self::EQUALS_EMAIL : null;
    }
}
