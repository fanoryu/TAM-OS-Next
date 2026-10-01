<?php
declare(strict_types=1);

namespace TamOs\Mail;

/**
 * A delivery that did not reach the provider or that the provider did not accept. The message
 * is a fixed code: never a provider response body, a credential, the recipient or the link.
 *
 *   transport    no HTTP response: connection, TLS or timeout failure
 *   unavailable  the provider is throttling or failing (429, 5xx) — worth retrying
 *   rejected     the provider refused the request (another 4xx, or a malformed 200)
 *   config       the mail configuration is missing or invalid
 */
final class MailError extends \RuntimeException
{
    public const TRANSPORT = 'transport';
    public const UNAVAILABLE = 'unavailable';
    public const REJECTED = 'rejected';
    public const CONFIG = 'config';

    public function __construct(public readonly string $kind, public readonly ?int $status = null)
    {
        parent::__construct('mail ' . $kind . ($status !== null ? ' (' . $status . ')' : ''));
    }
}
