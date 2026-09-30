<?php
declare(strict_types=1);

namespace TamOs\Auth;

/**
 * The command line of server/bin/account.php, parsed without side effects:
 *
 *   account.php create-ceo --email=<address>
 *   account.php reset-credentials --email=<address>
 *
 * Exactly one command and exactly one `--email=` argument; anything else — an unknown command
 * or option, a repeated or missing argument, the `--email <address>` form, an empty or invalid
 * address — is a usage error. There is no password argument and no --force.
 */
final class AccountCommand
{
    public const CREATE_CEO = 'create-ceo';
    public const RESET_CREDENTIALS = 'reset-credentials';
    public const USAGE = "usage: php server/bin/account.php create-ceo|reset-credentials --email=<address>\n";

    private const EMAIL_OPTION = '--email=';

    private function __construct(public readonly string $command, public readonly string $email)
    {
    }

    /**
     * @param list<string> $argv as PHP passes it (script name first)
     * @return self|null null on any usage error
     */
    public static function parse(array $argv): ?self
    {
        if (!array_is_list($argv) || count($argv) !== 3) {
            return null;
        }
        [, $command, $option] = $argv;
        if (!in_array($command, [self::CREATE_CEO, self::RESET_CREDENTIALS], true) || !str_starts_with($option, self::EMAIL_OPTION)) {
            return null;
        }
        $email = EmailAddress::candidate(substr($option, strlen(self::EMAIL_OPTION)));
        return EmailAddress::isValid($email) ? new self($command, $email) : null;
    }
}
