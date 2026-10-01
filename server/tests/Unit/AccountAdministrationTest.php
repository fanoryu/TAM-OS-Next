<?php
declare(strict_types=1);

/*
 * BF-4a2 (SDR-0004) without a database: the strict account-route bodies, the derived account
 * state, the activation message and its link, the activation mail kind and the reissue bucket.
 */

use TamOs\Auth\LoginKeys;
use TamOs\Auth\SessionToken;
use TamOs\Data\Auth\AccountTokenStore;
use TamOs\Data\Auth\MailOutboxStore;
use TamOs\Employee\AccountService;
use TamOs\Employee\AccountState;
use TamOs\Employee\EmployeeInput;
use TamOs\Http\ApiError;
use TamOs\Mail\ActivationMail;
use TamOs\Mail\RecoveryMail;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

$token = str_repeat('A', 21) . '_-' . str_repeat('b', 20);
$fields = static fn (callable $fn): array => assertThrows(ApiError::class, $fn)->fields;

return [
    'provision takes exactly id and email; the email is normalized as for every account' => static function (): void {
        assertSame(['id' => 'e_1', 'email' => 'new.person@example.test'], EmployeeInput::provision(['id' => 'e_1', 'email' => '  New.Person@Example.TEST ']));
    },
    'provision refuses forged scope and security fields by name, and bad values naming the field' => static function () use ($fields): void {
        foreach (['company_id', 'companyId', 'user_id', 'userId', 'membership_id', 'role', 'actor', 'status', 'token', 'password', 'scope', 'employee_id', 'passwordHash'] as $key) {
            assertSame([$key], $fields(static fn () => EmployeeInput::provision(['id' => 'e_1', 'email' => 'a@example.test', $key => 'x'])), $key);
        }
        assertSame(['email'], $fields(static fn () => EmployeeInput::provision(['id' => 'e_1'])), 'email required');
        assertSame(['id'], $fields(static fn () => EmployeeInput::provision(['email' => 'a@example.test'])), 'id required');
        foreach (['', 'not-an-email', 'a@b', 'two@@example.test', 42, null, ['a@example.test']] as $bad) {
            assertSame(['email'], $fields(static fn () => EmployeeInput::provision(['id' => 'e_1', 'email' => $bad])), 'email ' . json_encode($bad));
        }
        foreach (['', 'has space', str_repeat('a', 65), 'e/1', 7] as $bad) {
            assertSame(['id'], $fields(static fn () => EmployeeInput::provision(['id' => $bad, 'email' => 'a@example.test'])), 'id ' . json_encode($bad));
        }
    },
    'reissue, disable and enable take exactly the Employee id' => static function () use ($fields): void {
        assertSame('e_1', EmployeeInput::accountTarget(['id' => 'e_1']));
        foreach (['user_id', 'email', 'expectedVersion', 'company_id', 'role', 'token'] as $key) {
            assertSame([$key], $fields(static fn () => EmployeeInput::accountTarget(['id' => 'e_1', $key => 'x'])), $key);
        }
        assertSame(['id'], $fields(static fn () => EmployeeInput::accountTarget([])), 'id required');
        assertSame(['id'], $fields(static fn () => EmployeeInput::accountTarget(['id' => 'a b'])), 'bad id');
    },
    'account state is derived: none, pending, active, disabled; employment status plays no part' => static function (): void {
        $a = static fn (string $m, string $u, bool $p): array => ['membershipStatus' => $m, 'userStatus' => $u, 'hasPassword' => $p];
        assertSame(AccountState::NONE, AccountState::of(null));
        assertSame(AccountState::PENDING, AccountState::of($a('active', 'active', false)));
        assertSame(AccountState::ACTIVE, AccountState::of($a('active', 'active', true)));
        assertSame(AccountState::DISABLED, AccountState::of($a('disabled', 'active', true)));
        assertSame(AccountState::DISABLED, AccountState::of($a('disabled', 'active', false)), 'a disabled pending login is disabled');
        assertSame(AccountState::DISABLED, AccountState::of($a('active', 'disabled', true)), 'a disabled user is disabled');
        assertSame(['none', 'pending', 'active', 'disabled'], AccountState::VALUES);
    },
    'the activation link is <configured origin>/#activation=<token>: the token only in the fragment' => static function () use ($token): void {
        assertSame('https://finance.example.test/#activation=' . $token, ActivationMail::link('https://finance.example.test', $token));
        $link = ActivationMail::link('https://finance.example.test', $token);
        assertTrue(!str_contains(explode('#', $link, 2)[0], $token), 'nothing before the fragment carries the token');
        assertTrue(!str_contains($link, '?') && !str_contains($link, '#recovery='), 'no query string, never a recovery link');
        assertSame(43, strlen(SessionToken::generate()), 'a real token has the shape the link accepts');
        assertTrue(RecoveryMail::link('https://finance.example.test', $token) !== $link, 'distinct from recovery');
    },
    'the activation link refuses anything but a canonical origin, and a malformed token' => static function () use ($token): void {
        foreach (['https://finance.example.test/', 'https://finance.example.test/app', 'https://Finance.example.test', 'finance.example.test',
            'https://evil.test@finance.example.test', "https://finance.example.test\r\nX: y", 'https://finance.example.test#x', '', 'javascript:alert(1)'] as $origin) {
            assertThrows(\LogicException::class, static fn () => ActivationMail::link($origin, $token), $origin);
        }
        foreach (['', 'short', $token . 'x', str_repeat('+', 43), str_repeat('=', 43)] as $bad) {
            assertThrows(\LogicException::class, static fn () => ActivationMail::link('https://finance.example.test', $bad), 'token ' . $bad);
        }
    },
    'the activation message: fixed subject, one link, the 72-hour lifetime, no other data' => static function () use ($token): void {
        $m = ActivationMail::build('https://finance.example.test', 'person@example.test', $token, AccountTokenStore::ACTIVATION_HOURS, 'outbox-1-1');
        assertSame(['person@example.test', 'Activate your TAM OS account', 'outbox-1-1'], [$m->to, $m->subject, $m->reference]);
        assertSame(1, substr_count($m->text, $token), 'the token appears once');
        assertSame(1, substr_count($m->text, 'https://'), 'one link');
        assertTrue(str_contains($m->text, 'within 72 hours'), 'lifetime stated');
        assertTrue(!str_contains($m->text, 'person@example.test'), 'the address is not repeated in the body');
    },
    'the outbox knows exactly recovery and activation; the reissue quota is per user, 3 per hour' => static function (): void {
        assertSame(['recovery', 'activation'], MailOutboxStore::KINDS);
        assertSame(72, AccountTokenStore::ACTIVATION_HOURS);
        assertSame([3, 3600], [AccountService::REISSUE_LIMIT, AccountService::REISSUE_WINDOW_SECONDS]);
        $u = str_repeat('a', 32);
        assertSame(hash('sha256', 'reissue:' . $u), LoginKeys::activationReissueBucket($u));
        assertTrue(LoginKeys::activationReissueBucket($u) !== LoginKeys::activationReissueBucket(str_repeat('b', 32)), 'per user');
        assertTrue(LoginKeys::activationReissueBucket($u) !== LoginKeys::passwordChangeBucket($u), 'its own bucket');
    },
];
