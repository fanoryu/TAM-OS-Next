<?php
declare(strict_types=1);

namespace TamOs\Http;

/**
 * An expected, client-facing failure. The kernel maps it to its ErrorCode envelope; the
 * internal detail is for the server log only.
 */
final class ApiError extends \RuntimeException
{
    /** A log reason is a short lower-case code, so it can never carry request data or text. */
    public const LOG_REASON_PATTERN = '/^[a-z][a-z_]{0,31}$/';

    /**
     * @param list<string>      $allow      the Allow header value for method_not_allowed
     * @param list<string>      $fields     field names (never values) for validation_failed
     * @param string|null       $logReason  a fixed reason code written to the access log (never to the client)
     */
    public function __construct(
        public readonly ErrorCode $errorCode,
        string $detail = '',
        public readonly array $allow = [],
        public readonly array $fields = [],
        public readonly ?int $retryAfter = null,
        public readonly ?string $logReason = null,
    ) {
        if ($logReason !== null && preg_match(self::LOG_REASON_PATTERN, $logReason) !== 1) {
            throw new \LogicException('log reason must be a fixed lower-case code');
        }
        parent::__construct($detail !== '' ? $detail : $errorCode->value);
    }
}
