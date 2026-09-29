<?php
declare(strict_types=1);

namespace TamOs\Http;

/**
 * An immutable snapshot of the incoming request.
 *
 * This is the ONLY class that reads PHP's request globals (enforced by
 * tools/verify-backend-boundary.js). It captures just what the API contract uses — method,
 * path, query string, Content-Type, Origin, Referer and a size-capped body. Cookies,
 * Authorization, Host and X-Forwarded-* are deliberately not captured: nothing in BF-1 may
 * derive identity or trust from them.
 */
final class Request
{
    public const MUTATION_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

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
        );
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
