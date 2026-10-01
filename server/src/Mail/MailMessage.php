<?php
declare(strict_types=1);

namespace TamOs\Mail;

use TamOs\Auth\EmailAddress;

/**
 * One plain-text message to one recipient. The body may carry a one-time link, so the
 * recipient and the body never appear in a dump or a log. `reference` is a server-generated
 * key for one delivery attempt (the provider's idempotency key), never user input.
 */
final class MailMessage
{
    public function __construct(
        #[\SensitiveParameter] public readonly string $to,
        public readonly string $subject,
        #[\SensitiveParameter] public readonly string $text,
        public readonly string $reference,
    ) {
        if (!EmailAddress::isValid($to)) {
            throw new \LogicException('mail recipient is not a valid address');
        }
        if ($subject === '' || preg_match('/[\r\n\p{Cc}]/u', $subject) === 1) {
            throw new \LogicException('mail subject must be one line of text');
        }
        if (preg_match('/^[a-z0-9-]{1,128}$/', $reference) !== 1) {
            throw new \LogicException('mail reference must be a short server-generated key');
        }
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return ['to' => '[REDACTED]', 'subject' => $this->subject, 'text' => '[REDACTED]', 'reference' => $this->reference];
    }
}
