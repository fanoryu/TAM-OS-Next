<?php
declare(strict_types=1);

namespace TamOs\Mail;

use TamOs\Auth\EmailAddress;
use TamOs\Config\Config;

/**
 * The validated `mail` section of the configuration file (outside the web root, SDR-0002 §14):
 * exactly `transport` ("resend"), `from` ("Display Name <address>") and `api_key`. It is
 * validated only when the outbox worker first needs it, so a missing or broken section never
 * affects the API. The API key is a secret: never logged, never dumped, never in the repository.
 */
final class MailConfig
{
    public const TRANSPORTS = ['resend'];
    private const KEYS = ['transport', 'from', 'api_key'];

    private function __construct(
        public readonly string $transport,
        public readonly string $from,
        #[\SensitiveParameter] public readonly string $apiKey,
    ) {
    }

    /** @throws MailError config */
    public static function fromConfig(Config $config): self
    {
        $mail = $config->mail;
        if (!is_array($mail) || array_keys($mail) !== self::KEYS) {
            throw new MailError(MailError::CONFIG);
        }
        foreach ($mail as $value) {
            if (!is_string($value) || str_contains($value, 'CHANGE_ME')) {
                throw new MailError(MailError::CONFIG);
            }
        }
        if (!in_array($mail['transport'], self::TRANSPORTS, true) || !self::isFrom($mail['from'])
            || preg_match('/^re_[A-Za-z0-9_]{8,200}$/', $mail['api_key']) !== 1) {
            throw new MailError(MailError::CONFIG);
        }
        return new self($mail['transport'], $mail['from'], $mail['api_key']);
    }

    /** The one transport the configuration names. */
    public function transport(): MailTransport
    {
        return match ($this->transport) {
            'resend' => new ResendTransport($this->apiKey, $this->from),
        };
    }

    /** "Display Name <address>": a one-line name without angle brackets, and a valid address. */
    public static function isFrom(string $from): bool
    {
        return preg_match('/^([A-Za-z0-9 ._-]{1,64}) <([^<>\s]+)>$/', $from, $m) === 1 && EmailAddress::isValid($m[2]);
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return ['transport' => $this->transport, 'from' => $this->from, 'apiKey' => '[REDACTED]'];
    }
}
