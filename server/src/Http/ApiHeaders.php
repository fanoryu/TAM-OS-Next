<?php
declare(strict_types=1);

namespace TamOs\Http;

/**
 * Response headers for every /api/* response, errors included.
 *
 * MIRROR, not source: tools/package-headers.js (API_HEADERS, HSTS_PRODUCTION) is the
 * canonical header contract. tools/verify-backend-boundary.js fails the build if these
 * values drift from it. Keep one `'Name' => 'value',` entry per line.
 */
final class ApiHeaders
{
    public const HEADERS = [
        'Content-Security-Policy' => "default-src 'none'; frame-ancestors 'none'",
        'X-Content-Type-Options' => 'nosniff',
        'Referrer-Policy' => 'strict-origin-when-cross-origin',
        'Cache-Control' => 'no-store, private',
    ];

    /** Sent only in production over HTTPS (SDR-0002 §13.1; no includeSubDomains / preload). */
    public const HSTS = 'max-age=31536000';
}
