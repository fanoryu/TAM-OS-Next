<?php
declare(strict_types=1);

namespace TamOs\Mail;

/**
 * The provider-neutral mail boundary (BF-3D, SDR-0003). Application and authentication code
 * depends only on this interface; exactly one governed implementation talks to a provider
 * (ResendTransport), and tools/verify-backend-boundary.js confines network and mail
 * primitives to it. Replacing the provider means replacing that one class.
 *
 * send() either hands the message to the provider or throws MailError. It is called only by
 * the outbox worker, never inside a database transaction and never from an HTTP request, and
 * it never retries — retry is the outbox's decision.
 */
interface MailTransport
{
    /** @throws MailError */
    public function send(MailMessage $message): void;
}
