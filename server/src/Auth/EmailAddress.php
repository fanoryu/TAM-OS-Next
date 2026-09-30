<?php
declare(strict_types=1);

namespace TamOs\Auth;

/**
 * Authentication email addresses (owner decision D3): ASCII only, trimmed and lower-cased,
 * FILTER_VALIDATE_EMAIL, at most 254 bytes. No plus-alias stripping, no dot rewriting, no
 * IDN — two addresses are the same account only when their normalized bytes are equal.
 */
final class EmailAddress
{
    public const MAX_BYTES = 254;

    /**
     * The candidate key: trimmed and lower-cased, whatever the input. Rate-limit buckets and
     * the audit email hash are derived from it BEFORE validity is decided, so an invalid
     * address is handled exactly like an unknown one.
     */
    public static function candidate(string $input): string
    {
        return strtolower(trim($input));
    }

    public static function isValid(string $candidate): bool
    {
        return $candidate !== ''
            && strlen($candidate) <= self::MAX_BYTES
            && preg_match('/^[\x21-\x7E]+$/', $candidate) === 1
            && filter_var($candidate, FILTER_VALIDATE_EMAIL) !== false;
    }
}
