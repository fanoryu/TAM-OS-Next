<?php
declare(strict_types=1);

namespace TamOs\Http;

/**
 * An expected, client-facing failure. The kernel maps it to its ErrorCode envelope; the
 * internal detail is for the server log only.
 */
final class ApiError extends \RuntimeException
{
    /**
     * @param list<string>      $allow      the Allow header value for method_not_allowed
     * @param list<string>      $fields     field names (never values) for validation_failed
     */
    public function __construct(
        public readonly ErrorCode $errorCode,
        string $detail = '',
        public readonly array $allow = [],
        public readonly array $fields = [],
        public readonly ?int $retryAfter = null,
    ) {
        parent::__construct($detail !== '' ? $detail : $errorCode->value);
    }
}
