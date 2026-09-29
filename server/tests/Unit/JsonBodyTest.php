<?php
declare(strict_types=1);

use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Http\JsonBody;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$malformed = static function (string $body): void {
    $e = assertThrows(ApiError::class, static fn () => JsonBody::decode($body), json_encode($body, JSON_INVALID_UTF8_SUBSTITUTE));
    assertSame(ErrorCode::MalformedJson, $e->errorCode);
};

return [
    'application/json with an optional utf-8 charset is accepted' => static function (): void {
        foreach (['application/json', 'Application/JSON', 'application/json; charset=utf-8', 'application/json;charset=UTF-8', 'application/json; charset="utf-8"'] as $ct) {
            assertTrue(JsonBody::isJsonContentType($ct), $ct);
        }
    },
    'every other content type is refused' => static function (): void {
        foreach ([null, '', 'text/plain', 'application/jsonx', 'application/json-patch+json', 'application/x-www-form-urlencoded',
            'multipart/form-data; boundary=x', 'text/json', 'application/json; charset=latin1', 'application/json, text/plain',
            "application/json\r\nX-Evil: 1", ' application/json'] as $ct) {
            assertTrue(!JsonBody::isJsonContentType($ct), (string) json_encode($ct));
        }
    },
    'a JSON object decodes; large integers stay strings' => static function (): void {
        assertSame(['a' => 1, 'b' => ['c' => true]], JsonBody::decode(" \n{\"a\":1,\"b\":{\"c\":true}}"));
        assertSame([], JsonBody::decode('{}'));
        assertSame('123456789012345678901234567890', JsonBody::decode('{"n":123456789012345678901234567890}')['n']);
    },
    'unicode survives' => static function (): void {
        assertSame('Rp 1.000 — ✓', JsonBody::decode('{"s":"Rp 1.000 — ✓"}')['s']);
    },
    'non-objects, empty, truncated and invalid bodies are malformed_json' => static function () use ($malformed): void {
        foreach (['', '   ', '[]', '[{"a":1}]', '"x"', '1', 'null', 'true', '{', '{"a":}', '{"a":1}x', "{'a':1}", '{"a":NaN}', "\xEF\xBB\xBF{}"] as $body) {
            $malformed($body);
        }
    },
    'invalid UTF-8 is malformed_json' => static function () use ($malformed): void {
        $malformed("{\"a\":\"\xff\xfe\"}");
        $malformed("{\"a\xc3\":1}");
    },
    'nesting beyond the depth limit is malformed_json; within it decodes' => static function () use ($malformed): void {
        $nest = static fn (int $n): string => str_repeat('{"a":', $n) . '1' . str_repeat('}', $n);
        $malformed($nest(64));
        assertTrue(is_array(JsonBody::decode($nest(10))), 'depth 10');
    },
    'duplicate keys keep the last value (documented json_decode behaviour)' => static function (): void {
        assertSame(['a' => 2], JsonBody::decode('{"a":1,"a":2}'));
    },
];
