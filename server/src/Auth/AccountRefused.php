<?php
declare(strict_types=1);

namespace TamOs\Auth;

/**
 * An operator account command refused for a fixed reason (server/bin/account.php prints
 * "account: <reason>"). The reason is a lower-case code — never an email, token or value.
 */
final class AccountRefused extends \RuntimeException
{
    public const INVALID_EMAIL = 'invalid_email';
    public const BUSY = 'busy';
    public const ALREADY_BOOTSTRAPPED = 'already_bootstrapped';
    public const NOT_FOUND = 'not_found';
    public const ACCOUNT_DISABLED = 'account_disabled';
    public const TOPOLOGY_INVALID = 'topology_invalid';
    public const NOT_CEO = 'not_ceo';

    public function __construct(public readonly string $reason)
    {
        if (preg_match('/^[a-z][a-z_]{0,31}$/', $reason) !== 1) {
            throw new \LogicException('refusal reason must be a fixed lower-case code');
        }
        parent::__construct('account command refused: ' . $reason);
    }
}
