<?php
declare(strict_types=1);

namespace TamOs\Http;

/**
 * A handler result that also sets or clears the session cookie. The kernel wraps `data` in
 * the success envelope and adds the one Set-Cookie header; the value must come from
 * SessionCookie.
 */
final class CookieResult
{
    /** @param array<string, mixed> $data */
    public function __construct(
        public readonly array $data,
        #[\SensitiveParameter] public readonly string $setCookie,
    ) {
        if (!str_starts_with($setCookie, SessionCookie::NAME . '=')) {
            throw new \LogicException('cookie results carry only the session cookie');
        }
    }
}
