<?php
declare(strict_types=1);

namespace TamOs\Mail;

/**
 * The governed Resend adapter (D-D1, SDR-0003): one HTTPS request per message to the documented
 * send-email endpoint, over PHP's bundled curl extension — no SDK, no Composer, no SMTP.
 *
 * The contract we depend on (pinned by tests/Unit/ResendTransportTest.php):
 *
 *   POST https://api.resend.com/emails
 *   Authorization: Bearer <api key>      Content-Type: application/json
 *   Idempotency-Key: tamos-<reference>   (≤ 256 characters; one per delivery attempt)
 *   body {"from","to","subject","text"}   plain text only
 *   200 with a JSON object carrying a string "id" = accepted; anything else = MailError
 *
 * The provider's error bodies are not relied on (their shape is not documented) and are never
 * logged: only the status decides — 429 and 5xx are `unavailable`, other statuses and a
 * malformed 200 are `rejected`, no response at all is `transport`. TLS peer and host
 * verification are on, only HTTPS is allowed, redirects are not followed, and the whole
 * request is bounded by TIMEOUT_SECONDS. This is the only file that performs network I/O
 * (tools/verify-backend-boundary.js).
 */
final class ResendTransport implements MailTransport
{
    public const ENDPOINT = 'https://api.resend.com/emails';
    public const TIMEOUT_SECONDS = 10;
    public const CONNECT_TIMEOUT_SECONDS = 5;

    /** @var \Closure(string, list<string>, string): ?array{status: int, body: string} */
    private readonly \Closure $post;

    /** @param (\Closure(string, list<string>, string): ?array{status: int, body: string})|null $post  tests inject a fake; null = curl */
    public function __construct(
        #[\SensitiveParameter] private readonly string $apiKey,
        private readonly string $from,
        ?\Closure $post = null,
    ) {
        $this->post = $post ?? self::curlPost(...);
    }

    public function send(MailMessage $message): void
    {
        [$url, $headers, $body] = self::request($message, $this->from, $this->apiKey);
        $response = ($this->post)($url, $headers, $body);
        if ($response === null) {
            throw new MailError(MailError::TRANSPORT);
        }
        $status = $response['status'];
        if ($status === 200) {
            $decoded = json_decode($response['body'], true);
            if (is_array($decoded) && is_string($decoded['id'] ?? null) && $decoded['id'] !== '') {
                return;
            }
            throw new MailError(MailError::REJECTED, $status);
        }
        throw new MailError($status === 429 || $status >= 500 ? MailError::UNAVAILABLE : MailError::REJECTED, $status);
    }

    /**
     * The exact HTTP request for a message: URL, headers and JSON body. Pure, so the contract
     * is testable without a network.
     *
     * @return array{0: string, 1: list<string>, 2: string}
     */
    public static function request(MailMessage $message, string $from, #[\SensitiveParameter] string $apiKey): array
    {
        $body = json_encode(
            ['from' => $from, 'to' => $message->to, 'subject' => $message->subject, 'text' => $message->text],
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
        );
        return [self::ENDPOINT, [
            'Authorization: Bearer ' . $apiKey,
            'Content-Type: application/json',
            'Idempotency-Key: tamos-' . $message->reference,
        ], $body];
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return ['from' => $this->from, 'apiKey' => '[REDACTED]'];
    }

    /**
     * @param list<string> $headers
     * @return array{status: int, body: string}|null null when no HTTP response was received
     */
    private static function curlPost(string $url, #[\SensitiveParameter] array $headers, #[\SensitiveParameter] string $body): ?array
    {
        $ch = curl_init();
        if ($ch === false) {
            return null;
        }
        try {
            curl_setopt_array($ch, [
                CURLOPT_URL => $url,
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $body,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_SSL_VERIFYHOST => 2,
                CURLOPT_CONNECTTIMEOUT => self::CONNECT_TIMEOUT_SECONDS,
                CURLOPT_TIMEOUT => self::TIMEOUT_SECONDS,
            ]);
            $response = curl_exec($ch);
            if (!is_string($response)) {
                return null;
            }
            return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'body' => $response];
        } finally {
            curl_close($ch);
        }
    }
}
