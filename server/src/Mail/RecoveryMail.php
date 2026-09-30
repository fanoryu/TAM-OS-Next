<?php
declare(strict_types=1);

namespace TamOs\Mail;

/**
 * The password-recovery message. The link is built only from the canonical `origin` of the
 * server configuration — never from a Host header or any request value — and carries the raw
 * token in the URL FRAGMENT: `<origin>/#recovery=<token>`. A fragment is never sent to the
 * server, a CDN or a proxy, and never appears in a Referer, so the token stays out of every
 * access log; opening the link changes nothing (only POST /api/auth/reset-password consumes
 * it), so mail scanners that fetch links cannot burn it. The page that reads the fragment is
 * future frontend work.
 *
 * Plain text only; no account data beyond the link.
 */
final class RecoveryMail
{
    public const SUBJECT = 'TAM OS password reset';
    public const FRAGMENT = '/#recovery=';

    public static function link(string $origin, #[\SensitiveParameter] string $token): string
    {
        if (preg_match('#^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$#', $origin) !== 1) {
            throw new \LogicException('the recovery link origin must be the canonical configured origin');
        }
        if (preg_match('/^[A-Za-z0-9_-]{43}$/', $token) !== 1) {
            throw new \LogicException('a recovery token is 43 base64url characters');
        }
        return $origin . self::FRAGMENT . $token;
    }

    public static function build(string $origin, #[\SensitiveParameter] string $to, #[\SensitiveParameter] string $token, int $minutes, string $reference): MailMessage
    {
        $text = "A password reset was requested for your TAM OS account.\n\n"
            . 'To choose a new password, open this link within ' . $minutes . " minutes:\n\n"
            . self::link($origin, $token) . "\n\n"
            . "The link works once. If you did not ask for this, ignore this message: your password stays unchanged.\n";
        return new MailMessage($to, self::SUBJECT, $text, $reference);
    }
}
