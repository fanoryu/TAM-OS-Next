<?php
declare(strict_types=1);

namespace TamOs\Http;

/**
 * A JSON API response in the standard envelope:
 *   success  {"ok":true,"data":…,"requestId":"…"}
 *   failure  {"ok":false,"error":{"code":"…","message":"…"},"requestId":"…"}
 * Every response carries ApiHeaders plus Content-Type and X-Request-Id. This is the only
 * class that emits headers or output (enforced by tools/verify-backend-boundary.js).
 */
final class Response
{
    private const JSON_FLAGS = JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_THROW_ON_ERROR;

    /** @param array<string, string> $headers */
    private function __construct(
        public readonly int $status,
        public readonly array $headers,
        public readonly string $body,
    ) {
    }

    public static function success(mixed $data, string $requestId, int $status = 200): self
    {
        return self::json($status, ['ok' => true, 'data' => $data, 'requestId' => $requestId], $requestId);
    }

    public static function error(ErrorCode $code, string $requestId, ?ApiError $error = null): self
    {
        $payload = ['code' => $code->value, 'message' => $code->message()];
        if ($error !== null && $error->fields !== []) {
            $payload['fields'] = $error->fields;
        }
        $response = self::json($code->status(), ['ok' => false, 'error' => $payload, 'requestId' => $requestId], $requestId);
        if ($error !== null && $error->allow !== []) {
            $response = $response->withHeader('Allow', implode(', ', $error->allow));
        }
        if ($error !== null && $error->retryAfter !== null) {
            $response = $response->withHeader('Retry-After', (string) $error->retryAfter);
        }
        return $response;
    }

    public function withHeader(string $name, string $value): self
    {
        return new self($this->status, [...$this->headers, $name => $value], $this->body);
    }

    /** Sends the response. Anything buffered earlier (stray output, notices) is discarded. */
    public function emit(bool $omitBody): void
    {
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        header_remove('X-Powered-By');
        http_response_code($this->status);
        foreach ($this->headers as $name => $value) {
            header($name . ': ' . $value);
        }
        if (!$omitBody) {
            echo $this->body;
        }
    }

    /** @param array<string, mixed> $envelope */
    private static function json(int $status, array $envelope, string $requestId): self
    {
        $headers = ApiHeaders::HEADERS;
        $headers['Content-Type'] = 'application/json; charset=utf-8';
        $headers['X-Request-Id'] = $requestId;
        return new self($status, $headers, json_encode($envelope, self::JSON_FLAGS));
    }
}
