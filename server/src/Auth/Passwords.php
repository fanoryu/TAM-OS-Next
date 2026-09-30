<?php
declare(strict_types=1);

namespace TamOs\Auth;

/**
 * The only caller of PHP's password API (enforced by tools/verify-backend-boundary.js).
 *
 * Argon2id with pinned parameters when this PHP build supports it, otherwise bcrypt cost 12
 * (SDR-0002 §2.1). No custom cryptography, no pepper.
 *
 * verify() always runs exactly one password_verify(): against the account's hash, or — when
 * there is no account, no password yet, or the input is not an acceptable password — against
 * a fixed public dummy hash of the selected algorithm and parameters, whose result is then
 * discarded. This keeps the work comparable across those cases; it is not a claim of
 * constant-time authentication.
 */
final class Passwords
{
    /** bcrypt silently truncates past 72 bytes; longer input is refused for every algorithm. */
    public const MAX_BYTES = 72;
    public const ARGON2ID_OPTIONS = ['memory_cost' => 65536, 'time_cost' => 4, 'threads' => 1];
    public const BCRYPT_OPTIONS = ['cost' => 12];

    // Hashes of a random string that was discarded when these were generated. They grant
    // nothing: a dummy verification always yields false.
    public const DUMMY_HASH_ARGON2ID = '$argon2id$v=19$m=65536,t=4,p=1$NkNzc3o5Y2ppYjludllQdA$k4R4mI+sDlOJvBwMCsRzrHbabzfVnOvIwej+sWbTTD0';
    public const DUMMY_HASH_BCRYPT = '$2y$12$Avqj6SWtTJUyySnfXoXKAuJj3SH88pMHeIbUfJmql5TGT2lGWXCO2';

    /** The algorithm new hashes use on this runtime. */
    public static function algorithm(): string
    {
        return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
    }

    /** @return array<string, int> */
    public static function options(): array
    {
        return self::algorithm() === PASSWORD_BCRYPT ? self::BCRYPT_OPTIONS : self::ARGON2ID_OPTIONS;
    }

    public static function dummyHash(): string
    {
        return self::algorithm() === PASSWORD_BCRYPT ? self::DUMMY_HASH_BCRYPT : self::DUMMY_HASH_ARGON2ID;
    }

    /** A password a login may even try: non-empty, at most 72 bytes, no NUL. */
    public static function isAcceptableInput(#[\SensitiveParameter] string $password): bool
    {
        return $password !== '' && strlen($password) <= self::MAX_BYTES && !str_contains($password, "\0");
    }

    /**
     * True only when the input is acceptable, a hash exists, and it matches. Exactly one
     * password_verify() runs on every path.
     */
    public static function verify(#[\SensitiveParameter] string $password, #[\SensitiveParameter] ?string $hash): bool
    {
        if ($hash === null || !self::isAcceptableInput($password)) {
            password_verify(self::isAcceptableInput($password) ? $password : 'x', self::dummyHash());
            return false;
        }
        return password_verify($password, $hash);
    }

    public static function needsRehash(#[\SensitiveParameter] string $hash): bool
    {
        return password_needs_rehash($hash, self::algorithm(), self::options());
    }

    /** @return string a new hash with the current algorithm and parameters */
    public static function hash(#[\SensitiveParameter] string $password): string
    {
        if (!self::isAcceptableInput($password)) {
            throw new \InvalidArgumentException('password is not acceptable input');
        }
        return password_hash($password, self::algorithm(), self::options());
    }

    /**
     * Algorithm name and options of a hash, for tests proving the dummy matches the runtime.
     *
     * @return array{algoName: string, options: array<string, int>}
     */
    public static function describe(#[\SensitiveParameter] string $hash): array
    {
        $info = password_get_info($hash);
        return ['algoName' => (string) $info['algoName'], 'options' => $info['options']];
    }
}
