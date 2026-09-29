<?php
declare(strict_types=1);

namespace TamOs\Http;

/**
 * Server-generated request identifier: 16 random bytes, hex-encoded. A client-supplied
 * X-Request-Id is never adopted, so it cannot inject into logs or correlate across users.
 */
final class RequestId
{
    public const PATTERN = '/^[0-9a-f]{32}$/';

    public static function generate(): string
    {
        return bin2hex(random_bytes(16));
    }
}
