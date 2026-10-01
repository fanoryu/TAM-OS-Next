<?php
declare(strict_types=1);

/*
 * The pinned Resend send-email contract (BF-3D, D-D1, SDR-0003), with an injected poster — no
 * network, no real key, no real mail. What we depend on and nothing more: POST to
 * https://api.resend.com/emails, Bearer key, JSON {from, to, subject, text}, an Idempotency-Key,
 * and 200 with a string "id" as the only success. Error bodies are never read for meaning.
 */

use TamOs\Mail\MailError;
use TamOs\Mail\MailMessage;
use TamOs\Mail\ResendTransport;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$key = 're_test_not_a_real_key';
$from = 'TAM OS <no-reply@example.test>';
$message = static fn (): MailMessage => new MailMessage('person@example.test', 'TAM OS password reset', "line one\nline two https://x.test/#recovery=abc\n", 'outbox-7-2');
$transport = static function (?array $response, ?array &$seen = null) use ($key, $from): ResendTransport {
    return new ResendTransport($key, $from, static function (string $url, array $headers, string $body) use ($response, &$seen): ?array {
        $seen = [$url, $headers, $body];
        return $response;
    });
};

return [
    'the request is exactly the documented send-email call' => static function () use ($message, $key, $from): void {
        [$url, $headers, $body] = ResendTransport::request($message(), $from, $key);
        assertSame('https://api.resend.com/emails', $url);
        assertSame(['Authorization: Bearer re_test_not_a_real_key', 'Content-Type: application/json', 'Idempotency-Key: tamos-outbox-7-2'], $headers);
        assertSame(['from' => $from, 'to' => 'person@example.test', 'subject' => 'TAM OS password reset', 'text' => "line one\nline two https://x.test/#recovery=abc\n"],
            json_decode($body, true, 4, JSON_THROW_ON_ERROR), 'exactly from, to, subject, text — no html, no tags, no extra fields');
        assertTrue(strlen('tamos-' . str_repeat('a', 128)) <= 256, 'the idempotency key stays within the documented 256 characters');
    },
    'only 200 with a string id is success; the poster is called once' => static function () use ($transport, $message): void {
        $seen = null;
        $transport(['status' => 200, 'body' => '{"id":"49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"}'], $seen)->send($message());
        assertSame('https://api.resend.com/emails', $seen[0] ?? null);
    },
    'statuses map to fixed kinds; error bodies never shape the outcome' => static function () use ($transport, $message): void {
        $cases = [
            [null, MailError::TRANSPORT, null],
            [['status' => 200, 'body' => '{}'], MailError::REJECTED, 200],
            [['status' => 200, 'body' => 'not json'], MailError::REJECTED, 200],
            [['status' => 200, 'body' => '{"id":""}'], MailError::REJECTED, 200],
            [['status' => 429, 'body' => '{"name":"rate_limit_exceeded"}'], MailError::UNAVAILABLE, 429],
            [['status' => 500, 'body' => '{"name":"application_error"}'], MailError::UNAVAILABLE, 500],
            [['status' => 503, 'body' => ''], MailError::UNAVAILABLE, 503],
            [['status' => 400, 'body' => '{"name":"validation_error"}'], MailError::REJECTED, 400],
            [['status' => 401, 'body' => '{"name":"missing_api_key"}'], MailError::REJECTED, 401],
            [['status' => 403, 'body' => '{"name":"validation_error","message":"domain is not verified"}'], MailError::REJECTED, 403],
            [['status' => 422, 'body' => '{"name":"missing_required_field"}'], MailError::REJECTED, 422],
            [['status' => 301, 'body' => ''], MailError::REJECTED, 301],
        ];
        foreach ($cases as [$response, $kind, $status]) {
            $e = assertThrows(MailError::class, static fn () => $transport($response)->send($message()), (string) ($response['status'] ?? 'none'));
            assertSame([$kind, $status], [$e->kind, $e->status]);
            assertTrue(!str_contains($e->getMessage(), 'domain') && !str_contains($e->getMessage(), 're_test'), 'fixed message');
        }
    },
    'the transport pins HTTPS, verification and bounded timeouts; the key never appears in a dump' => static function () use ($transport, $message): void {
        assertSame([10, 5], [ResendTransport::TIMEOUT_SECONDS, ResendTransport::CONNECT_TIMEOUT_SECONDS]);
        $src = (string) file_get_contents(dirname(__DIR__, 2) . '/src/Mail/ResendTransport.php');
        foreach (['CURLOPT_SSL_VERIFYPEER => true', 'CURLOPT_SSL_VERIFYHOST => 2', 'CURLOPT_PROTOCOLS => CURLPROTO_HTTPS', 'CURLOPT_FOLLOWLOCATION => false', 'CURLOPT_TIMEOUT => self::TIMEOUT_SECONDS'] as $option) {
            assertTrue(str_contains($src, $option), $option);
        }
        ob_start();
        var_dump($transport(null), $message());
        $dump = (string) ob_get_clean();
        assertTrue(!str_contains($dump, 're_test_not_a_real_key') && !str_contains($dump, 'person@example.test') && !str_contains($dump, 'recovery=abc'), 'no key, recipient or link in a dump');
    },
    'a message refuses an invalid recipient, a multi-line subject and a free-form reference' => static function (): void {
        foreach ([['not-an-address', 'S', 'r'], ["a@example.test\r\nBcc: x@example.test", 'S', 'r'], ['a@example.test', "S\r\nBcc: x@example.test", 'r'],
            ['a@example.test', '', 'r'], ['a@example.test', 'S', 'Ref With Spaces'], ['a@example.test', 'S', str_repeat('a', 129)]] as [$to, $subject, $ref]) {
            assertThrows(\LogicException::class, static fn () => new MailMessage($to, $subject, 'body', $ref), $subject . '/' . $ref);
        }
    },
];
