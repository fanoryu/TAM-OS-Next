<?php
declare(strict_types=1);

/*
 * server/bin/account.php's command line (BF-3B), parsed without side effects: exactly one of
 * the two commands with exactly one --email= argument; everything else is a usage error.
 */

use TamOs\Auth\AccountCommand;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;

$script = 'server/bin/account.php';

return [
    'the two commands parse, and the email is normalized' => static function () use ($script): void {
        $c = AccountCommand::parse([$script, 'create-ceo', '--email=CEO@Example.TEST']);
        assertSame(['create-ceo', 'ceo@example.test'], [$c?->command, $c?->email]);
        $r = AccountCommand::parse([$script, 'reset-credentials', '--email=  ceo@example.test ']);
        assertSame(['reset-credentials', 'ceo@example.test'], [$r?->command, $r?->email]);
    },
    'every other command line is a usage error' => static function () use ($script): void {
        $bad = [
            'no arguments' => [$script],
            'command only' => [$script, 'create-ceo'],
            'unknown command' => [$script, 'issue-activation', '--email=a@example.test'],
            'reissue is not a command' => [$script, 'reissue-activation', '--email=a@example.test'],
            'upper-case command' => [$script, 'CREATE-CEO', '--email=a@example.test'],
            'space form' => [$script, 'create-ceo', '--email', 'a@example.test'],
            'duplicate email' => [$script, 'create-ceo', '--email=a@example.test', '--email=b@example.test'],
            'extra argument' => [$script, 'create-ceo', '--email=a@example.test', '--force'],
            'force instead of email' => [$script, 'reset-credentials', '--force'],
            'password option' => [$script, 'create-ceo', '--password=secret-value-1'],
            'password after email' => [$script, 'create-ceo', '--email=a@example.test', '--password=secret-value-1'],
            'unknown option' => [$script, 'create-ceo', '--mail=a@example.test'],
            'empty email' => [$script, 'create-ceo', '--email='],
            'invalid email' => [$script, 'create-ceo', '--email=not-an-address'],
            'non-ASCII email' => [$script, 'create-ceo', '--email=ü@example.test'],
            'positional email' => [$script, 'create-ceo', 'a@example.test'],
            'option first' => [$script, '--email=a@example.test', 'create-ceo'],
        ];
        foreach ($bad as $label => $argv) {
            assertSame(null, AccountCommand::parse($argv), $label);
        }
        assertSame(null, AccountCommand::parse([1 => $script, 2 => 'create-ceo', 3 => '--email=a@example.test']), 'not a list');
    },
    'the usage text names only the two commands and no password option' => static function (): void {
        assertTrue(str_contains(AccountCommand::USAGE, 'create-ceo|reset-credentials --email=<address>'), 'usage');
        assertTrue(!str_contains(strtolower(AccountCommand::USAGE), 'password') && !str_contains(AccountCommand::USAGE, 'force'), 'no password, no force');
    },
];
