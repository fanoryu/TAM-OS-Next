<?php
declare(strict_types=1);

namespace TamOs\Mail;

/**
 * The account-activation message (BF-4a2, SDR-0004 §4) for an Employee account the CEO
 * provisioned. Same rules as RecoveryMail: the link is built only from the canonical `origin` of
 * the server configuration — never from a Host header or any request value — and carries the
 * raw token in the URL FRAGMENT, `<origin>/#activation=<token>` (the form the AFI-3 frontend
 * reads). A fragment never reaches a server, a CDN, a proxy or a Referer; opening the link
 * changes nothing (only POST /api/auth/activate consumes it).
 *
 * Plain text only; no account or business data beyond the link.
 */
final class ActivationMail
{
    public const SUBJECT = 'Activate your TAM OS account';
    public const FRAGMENT = '/#activation=';

    public static function link(string $origin, #[\SensitiveParameter] string $token): string
    {
        if (preg_match('#^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$#', $origin) !== 1) {
            throw new \LogicException('the activation link origin must be the canonical configured origin');
        }
        if (preg_match('/^[A-Za-z0-9_-]{43}$/', $token) !== 1) {
            throw new \LogicException('an activation token is 43 base64url characters');
        }
        return $origin . self::FRAGMENT . $token;
    }

    public static function build(string $origin, #[\SensitiveParameter] string $to, #[\SensitiveParameter] string $token, int $hours, string $reference): MailMessage
    {
        $text = "A TAM OS account was created for you.\n\n"
            . 'To choose your password and activate it, open this link within ' . $hours . " hours:\n\n"
            . self::link($origin, $token) . "\n\n"
            . "The link works once. If you did not expect this, ignore this message: nothing happens until the link is used.\n";
        return new MailMessage($to, self::SUBJECT, $text, $reference);
    }
}
