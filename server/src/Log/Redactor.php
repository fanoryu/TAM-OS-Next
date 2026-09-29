<?php
declare(strict_types=1);

namespace TamOs\Log;

/**
 * Masks credential-shaped text before it is written to a log: key=value / key: value pairs
 * for sensitive names, URL user-info, bearer values and long opaque tokens. It is a last
 * line of defense — code must not pass secrets to the logger in the first place.
 */
final class Redactor
{
    public const MASK = '[REDACTED]';
    private const MAX_LENGTH = 2000;

    private const PATTERNS = [
        // Bearer / Basic credentials (first, so the scheme word is not taken as the value)
        '/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]+/i' => '$1 ' . self::MASK,
        // password=…, "token": "…", api_key: …, authorization=…, cookie: …
        '/(["\']?(?:password|passwd|pwd|pass|secret|token|api[_-]?key|authorization|cookie|csrf[_-]?token|session)["\']?\s*[:=]\s*)("[^"]*"|\'[^\']*\'|[^\s,;&]+)/i' => '$1' . self::MASK,
        // scheme://user:pass@host
        '#([a-z][a-z0-9+.-]*://)[^/\s:@]+:[^/\s@]*@#i' => '$1' . self::MASK . '@',
        // long opaque tokens (hex, base64, base64url)
        '/[A-Za-z0-9+\/_-]{32,}={0,2}/' => self::MASK,
    ];

    public static function redact(string $text): string
    {
        $text = preg_replace(array_keys(self::PATTERNS), array_values(self::PATTERNS), $text) ?? self::MASK;
        $text = str_replace(["\r", "\n"], ' ', $text);
        if (strlen($text) > self::MAX_LENGTH) {
            $text = substr($text, 0, self::MAX_LENGTH) . '…';
        }
        return preg_match('//u', $text) === 1 ? $text : self::MASK;
    }
}
