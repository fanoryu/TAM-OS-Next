<?php
declare(strict_types=1);

namespace TamOs\Http;

/**
 * Same-origin check for state-changing requests (SDR-0002 §3.4 item 3).
 *
 * Origin must equal the configured canonical origin exactly; when Origin is absent the
 * Referer's origin must match; when both are absent the request is refused. This is the
 * origin half of CSRF defense only. The synchronizer token needs an authenticated session
 * and is completed by the authentication/session milestone, not here.
 */
final class OriginGuard
{
    public function __construct(private readonly string $canonicalOrigin)
    {
    }

    public function allows(?string $origin, ?string $referer): bool
    {
        if ($origin !== null && $origin !== '') {
            return hash_equals($this->canonicalOrigin, $origin);
        }
        if ($referer === null || $referer === '') {
            return false;
        }
        $parts = parse_url($referer);
        if (!is_array($parts) || !isset($parts['scheme'], $parts['host']) || isset($parts['user']) || isset($parts['pass'])) {
            return false;
        }
        $refererOrigin = strtolower($parts['scheme']) . '://' . strtolower($parts['host'])
            . (isset($parts['port']) ? ':' . $parts['port'] : '');
        return hash_equals($this->canonicalOrigin, $refererOrigin);
    }
}
