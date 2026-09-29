<?php
declare(strict_types=1);

use TamOs\Http\ApiError;
use TamOs\Http\ApiHeaders;
use TamOs\Http\ErrorCode;
use TamOs\Http\RequestId;
use TamOs\Http\Response;
use function TamOs\Tests\assertApiHeaders;
use function TamOs\Tests\assertNoLeak;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\envelope;
use function TamOs\Tests\requestId;

$expected = [
    'malformed_json' => 400, 'invalid_query' => 400, 'validation_failed' => 400, 'unauthenticated' => 401,
    'forbidden' => 403, 'not_found' => 404, 'method_not_allowed' => 405, 'conflict' => 409, 'payload_too_large' => 413,
    'unsupported_media_type' => 415, 'rate_limited' => 429, 'internal_error' => 500, 'service_unavailable' => 503,
];

return [
    'the error vocabulary is exactly the 13 governed codes with their statuses' => static function () use ($expected): void {
        $actual = [];
        foreach (ErrorCode::cases() as $case) {
            $actual[$case->value] = $case->status();
        }
        assertSame($expected, $actual);
    },
    'every error code renders the standard envelope with a fixed safe message' => static function (): void {
        $messages = [];
        foreach (ErrorCode::cases() as $case) {
            $r = Response::error($case, requestId());
            assertSame($case->status(), $r->status, $case->value);
            assertApiHeaders($r, requestId());
            $env = envelope($r);
            assertSame(['ok', 'error', 'requestId'], array_keys($env), $case->value);
            assertSame(false, $env['ok']);
            assertSame(['code' => $case->value, 'message' => $case->message()], $env['error']);
            assertSame(requestId(), $env['requestId']);
            assertNoLeak($r->body);
            $messages[] = $case->message();
        }
        assertSame(count($messages), count(array_unique($messages)), 'messages are distinct');
    },
    'the success envelope is {ok, data, requestId}' => static function (): void {
        $r = Response::success(['status' => 'ok'], requestId());
        assertSame(200, $r->status);
        assertApiHeaders($r, requestId());
        assertSame('{"ok":true,"data":{"status":"ok"},"requestId":"' . requestId() . '"}', $r->body);
    },
    'method_not_allowed carries Allow; rate_limited carries Retry-After; validation lists field names' => static function (): void {
        $r = Response::error(ErrorCode::MethodNotAllowed, requestId(), new ApiError(ErrorCode::MethodNotAllowed, '', ['GET', 'HEAD']));
        assertSame('GET, HEAD', $r->headers['Allow'] ?? null);
        $r = Response::error(ErrorCode::RateLimited, requestId(), new ApiError(ErrorCode::RateLimited, '', [], [], 30));
        assertSame('30', $r->headers['Retry-After'] ?? null);
        $r = Response::error(ErrorCode::ValidationFailed, requestId(), new ApiError(ErrorCode::ValidationFailed, '', [], ['name']));
        assertSame(['name'], envelope($r)['error']['fields']);
    },
    'the internal detail of an ApiError never reaches the body' => static function (): void {
        $r = Response::error(ErrorCode::Conflict, requestId(), new ApiError(ErrorCode::Conflict, 'row 42 of /home/x/y.php password=1'));
        assertTrue(!str_contains($r->body, 'row 42') && !str_contains($r->body, 'password'), 'detail hidden');
        assertNoLeak($r->body);
    },
    'response JSON escapes markup characters' => static function (): void {
        $r = Response::success(['s' => '<script>&</script>'], requestId());
        assertTrue(!str_contains($r->body, '<') && !str_contains($r->body, '&'), 'hex-escaped');
    },
    'API headers are exactly the governed set; HSTS has no includeSubDomains' => static function (): void {
        assertSame(['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy', 'Cache-Control'], array_keys(ApiHeaders::HEADERS));
        assertSame('no-store, private', ApiHeaders::HEADERS['Cache-Control']);
        assertTrue(!str_contains(strtolower(ApiHeaders::HSTS), 'includesubdomains') && !str_contains(ApiHeaders::HSTS, 'preload'), 'HSTS scope');
    },
    'request IDs are 32 lower-case hex characters and unique' => static function (): void {
        $seen = [];
        for ($i = 0; $i < 2000; $i++) {
            $id = RequestId::generate();
            assertTrue(preg_match(RequestId::PATTERN, $id) === 1, 'pattern');
            $seen[$id] = true;
        }
        assertSame(2000, count($seen), 'unique');
    },
];
