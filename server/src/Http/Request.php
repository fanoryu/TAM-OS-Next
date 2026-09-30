<?php
declare(strict_types=1);

namespace TamOs\Http;

use TamOs\Auth\SessionToken;

/**
 * An immutable snapshot of the incoming request.
 *
 * This is the ONLY class that reads PHP's request globals (enforced by
 * tools/verify-backend-boundary.js). It captures just what the API contract uses — method,
 * path, query string, Content-Type, Origin, Referer, a size-capped body, and (BF-3A) three
 * narrow authentication inputs:
 *
 *   sessionToken  the one `__Host-tamos_session` value in HTTP_COOKIE, if well-formed
 *   csrfToken     X-CSRF-Token, if well-formed
 *   remoteAddr    REMOTE_ADDR, validated and canonicalized
 *
 * Any other cookie, Authorization, Host, X-Forwarded-For, Forwarded, CF-Connecting-IP,
 * X-Real-IP and every identity-looking header are deliberately not captured: identity comes
 * only from the server-side session. $_COOKIE is never read (PHP URL-decodes and renames).
 */
final class Request
{
    public const MUTATION_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
    public const MAX_COOKIE_HEADER = 8192;

    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly string $query = '',
        public readonly ?string $contentType = null,
        public readonly ?string $origin = null,
        public readonly ?string $referer = null,
        public readonly string $body = '',
        public readonly bool $bodyTooLarge = false,
        public readonly bool $isHttps = false,
        #[\SensitiveParameter] public readonly ?string $sessionToken = null,
        #[\SensitiveParameter] public readonly ?string $csrfToken = null,
        public readonly ?string $remoteAddr = null,
    ) {
    }

    public function isMutation(): bool
    {
        return in_array($this->method, self::MUTATION_METHODS, true);
    }

    public static function fromGlobals(int $bodyLimit): self
    {
        $server = $_SERVER;
        $method = is_string($server['REQUEST_METHOD'] ?? null) ? $server['REQUEST_METHOD'] : '';
        $uri = is_string($server['REQUEST_URI'] ?? null) ? $server['REQUEST_URI'] : '';
        $cut = strpos($uri, '?');
        $path = $cut === false ? $uri : substr($uri, 0, $cut);
        $query = $cut === false ? '' : substr($uri, $cut + 1);
        $header = static fn (string $key): ?string => is_string($server[$key] ?? null) ? $server[$key] : null;

        $body = '';
        $tooLarge = false;
        if (in_array($method, self::MUTATION_METHODS, true)) {
            $declared = $header('CONTENT_LENGTH');
            if ($declared !== null && ctype_digit($declared) && (strlen($declared) > 9 || (int) $declared > $bodyLimit)) {
                $tooLarge = true;
            } else {
                // Content-Length may be absent (chunked) or wrong: never read past the cap.
                $stream = fopen('php://input', 'rb');
                if ($stream !== false) {
                    $read = stream_get_contents($stream, $bodyLimit + 1);
                    fclose($stream);
                    $body = is_string($read) ? $read : '';
                }
                if (strlen($body) > $bodyLimit) {
                    $tooLarge = true;
                    $body = '';
                }
            }
        }

        $https = $header('HTTPS');
        return new self(
            $method,
            $path,
            $query,
            $header('CONTENT_TYPE'),
            $header('HTTP_ORIGIN'),
            $header('HTTP_REFERER'),
            $body,
            $tooLarge,
            $https !== null && $https !== '' && strtolower($https) !== 'off',
            SessionCookie::tokenFromHeader($header('HTTP_COOKIE')),
            SessionToken::isWellFormed($header('HTTP_X_CSRF_TOKEN')) ? $header('HTTP_X_CSRF_TOKEN') : null,
            self::canonicalIp($header('REMOTE_ADDR')),
        );
    }

    /** The connection's address in canonical text form, or null when absent or invalid. */
    public static function canonicalIp(?string $address): ?string
    {
        if ($address === null || filter_var($address, FILTER_VALIDATE_IP) === false) {
            return null;
        }
        $packed = inet_pton($address);
        $text = is_string($packed) ? inet_ntop($packed) : false;
        return is_string($text) ? $text : null;
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        $info = get_object_vars($this);
        $info['sessionToken'] = $this->sessionToken === null ? null : '[REDACTED]';
        $info['csrfToken'] = $this->csrfToken === null ? null : '[REDACTED]';
        return $info;
    }

    public static function documentRootFromGlobals(): ?string
    {
        $root = $_SERVER['DOCUMENT_ROOT'] ?? null;
        return is_string($root) && $root !== '' ? $root : null;
    }

    public static function isHeadFromGlobals(): bool
    {
        return ($_SERVER['REQUEST_METHOD'] ?? null) === 'HEAD';
    }
}
