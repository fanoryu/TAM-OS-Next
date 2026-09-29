<?php
declare(strict_types=1);

namespace TamOs\Http;

/**
 * The stable, machine-readable API error vocabulary. Each code has one HTTP status and one
 * fixed, safe message; exception text never reaches a client.
 */
enum ErrorCode: string
{
    case MalformedJson = 'malformed_json';
    case InvalidQuery = 'invalid_query';
    case ValidationFailed = 'validation_failed';
    case Unauthenticated = 'unauthenticated';
    case Forbidden = 'forbidden';
    case NotFound = 'not_found';
    case MethodNotAllowed = 'method_not_allowed';
    case Conflict = 'conflict';
    case PayloadTooLarge = 'payload_too_large';
    case UnsupportedMediaType = 'unsupported_media_type';
    case RateLimited = 'rate_limited';
    case InternalError = 'internal_error';
    case ServiceUnavailable = 'service_unavailable';

    public function status(): int
    {
        return match ($this) {
            self::MalformedJson, self::InvalidQuery, self::ValidationFailed => 400,
            self::Unauthenticated => 401,
            self::Forbidden => 403,
            self::NotFound => 404,
            self::MethodNotAllowed => 405,
            self::Conflict => 409,
            self::PayloadTooLarge => 413,
            self::UnsupportedMediaType => 415,
            self::RateLimited => 429,
            self::InternalError => 500,
            self::ServiceUnavailable => 503,
        };
    }

    public function message(): string
    {
        return match ($this) {
            self::MalformedJson => 'The request body is not a valid JSON object.',
            self::InvalidQuery => 'The query string is not accepted by this endpoint.',
            self::ValidationFailed => 'The request did not pass validation.',
            self::Unauthenticated => 'Authentication is required.',
            self::Forbidden => 'The request is not permitted.',
            self::NotFound => 'The requested resource was not found.',
            self::MethodNotAllowed => 'The request method is not allowed for this resource.',
            self::Conflict => 'The request conflicts with the current state.',
            self::PayloadTooLarge => 'The request body is too large.',
            self::UnsupportedMediaType => 'The request body must be sent as application/json.',
            self::RateLimited => 'Too many requests. Try again later.',
            self::InternalError => 'An internal error occurred.',
            self::ServiceUnavailable => 'The service is temporarily unavailable.',
        };
    }
}
