<?php
declare(strict_types=1);

namespace TamOs\Mail;

use TamOs\Auth\AccountRecovery;
use TamOs\Auth\SessionToken;
use TamOs\Data\Auth\AccountTokenStore;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\Auth\MailOutboxStore;

/**
 * The outbox worker (D-D3), run by cron through server/bin/mail.php. One mail per row:
 *
 *   transaction 1: claim the oldest due row (locked) → lock the account → still recoverable?
 *                  no → cancelled. yes → revoke every open token of the user, issue a fresh
 *                  recovery token (30 minutes from NOW, not from the request), row → sending
 *   no transaction: build the mail through RecoveryMail and hand it to the MailTransport
 *   transaction 2: accepted → sent. refused or unreachable → revoke that attempt's token;
 *                  attempts < MAX → pending with backoff, else failed + mail_fail
 *
 * Provider I/O never happens inside a transaction and never delays an HTTP request. The raw
 * token and the recipient address exist only in this process's memory for one attempt; nothing
 * about a delivery failure reaches the person who asked. A worker that dies between the two
 * transactions leaves the row in `sending`; it is claimed again after STALE_MINUTES and its
 * earlier token is revoked with every other open token before a new one is issued.
 */
final class OutboxWorker
{
    public const SENT = 'sent';
    public const RETRIED = 'retried';
    public const FAILED = 'failed';
    public const CANCELLED = 'cancelled';

    public function __construct(
        private readonly AuthData $data,
        private readonly MailTransport $transport,
        private readonly string $origin,
    ) {
    }

    /**
     * Delivers up to $limit due rows. The caller holds the 'tamos_mail' lock.
     *
     * @return array{sent: int, retried: int, failed: int, cancelled: int}
     */
    public function run(int $limit, string $requestId): array
    {
        $counts = [self::SENT => 0, self::RETRIED => 0, self::FAILED => 0, self::CANCELLED => 0];
        for ($i = 0; $i < $limit; $i++) {
            $outcome = $this->deliverOne($requestId);
            if ($outcome === null) {
                break;
            }
            $counts[$outcome]++;
        }
        return $counts;
    }

    /** @return string|null the outcome, or null when nothing is due */
    public function deliverOne(string $requestId): ?string
    {
        $token = SessionToken::generate();
        $hash = SessionToken::hash($token);
        $claim = $this->data->atomically(function () use ($hash, $requestId): ?array {
            $outbox = $this->data->outbox();
            $row = $outbox->claimDue();
            if ($row === null) {
                return null;
            }
            $account = $this->data->accounts()->lockById($row['userId']);
            if ($row['kind'] !== MailOutboxStore::RECOVERY || $account === null || !AccountRecovery::isRecoverable($account)) {
                $outbox->cancel($row['id']);
                return ['outcome' => self::CANCELLED];
            }
            $tokens = $this->data->tokens();
            $tokens->revokeAllOpenForUser($row['userId']);
            if ($row['attempts'] >= MailOutboxStore::MAX_ATTEMPTS) {
                // A stale `sending` row that already used its last attempt.
                $outbox->markFailed($row['id']);
                $this->data->events()->append('mail_fail', $row['userId'], null, null, null, $requestId);
                return ['outcome' => self::FAILED];
            }
            $tokens->issue($hash, $row['userId'], AccountTokenStore::RECOVERY);
            $outbox->markSending($row['id']);
            return ['id' => $row['id'], 'userId' => $row['userId'], 'attempt' => $row['attempts'] + 1, 'to' => $account['email']];
        });
        if ($claim === null) {
            return null;
        }
        if (isset($claim['outcome'])) {
            return $claim['outcome'];
        }

        $accepted = false;
        try {
            $this->transport->send(RecoveryMail::build(
                $this->origin,
                $claim['to'],
                $token,
                AccountTokenStore::RECOVERY_MINUTES,
                'outbox-' . $claim['id'] . '-' . $claim['attempt'],
            ));
            $accepted = true;
        } catch (MailError | \LogicException) {
            // A refused, unreachable or unbuildable message: this attempt's token must not live on.
        }

        return $this->data->atomically(function () use ($claim, $hash, $accepted, $requestId): string {
            $outbox = $this->data->outbox();
            if ($accepted) {
                $outbox->markSent($claim['id']);
                return self::SENT;
            }
            $this->data->tokens()->revoke($hash);
            if ($claim['attempt'] >= MailOutboxStore::MAX_ATTEMPTS) {
                $outbox->markFailed($claim['id']);
                $this->data->events()->append('mail_fail', $claim['userId'], null, null, null, $requestId);
                return self::FAILED;
            }
            $outbox->scheduleRetry($claim['id'], $claim['attempt']);
            return self::RETRIED;
        });
    }
}
