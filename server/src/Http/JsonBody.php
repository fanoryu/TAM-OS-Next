<?php
declare(strict_types=1);

namespace TamOs\Http;

/**
 * Strict JSON request-body decoding.
 *
 * The body must be one JSON object (`{…}`); arrays, scalars, empty bodies, invalid UTF-8
 * and nesting deeper than MAX_DEPTH are malformed_json. Large integers stay strings, so no
 * precision is lost silently. json_decode keeps the last of duplicate keys and cannot
 * report them.
 */
final class JsonBody
{
    public const MAX_DEPTH = 32;
    private const CONTENT_TYPE = '#^application/json[ \t]*(;[ \t]*charset[ \t]*=[ \t]*("utf-8"|utf-8)[ \t]*)?$#i';

    public static function isJsonContentType(?string $contentType): bool
    {
        return $contentType !== null && preg_match(self::CONTENT_TYPE, $contentType) === 1;
    }

    /**
     * @return array<string, mixed>
     * @throws ApiError malformed_json
     */
    public static function decode(string $body): array
    {
        $trimmed = ltrim($body, " \t\n\r");
        if ($trimmed === '' || $trimmed[0] !== '{') {
            throw new ApiError(ErrorCode::MalformedJson, 'body is not a JSON object');
        }
        try {
            $value = json_decode($body, true, self::MAX_DEPTH, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
        } catch (\JsonException $e) {
            throw new ApiError(ErrorCode::MalformedJson, 'json error ' . $e->getCode());
        }
        if (!is_array($value)) {
            throw new ApiError(ErrorCode::MalformedJson, 'body is not a JSON object');
        }
        return $value;
    }
}
