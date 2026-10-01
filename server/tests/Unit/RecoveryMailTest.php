<?php
declare(strict_types=1);

/*
 * The recovery message and its link (BF-3D): the link comes only from the canonical configured
 * origin, carries the token in the fragment, and the body holds nothing but fixed text and the
 * link. Also the `mail` configuration section: exactly transport, from, api_key; secrets never
 * dumped; placeholders and malformed values refused.
 */

use TamOs\Auth\SessionToken;
use TamOs\Mail\MailConfig;
use TamOs\Mail\MailError;
use TamOs\Mail\RecoveryMail;
use TamOs\Mail\ResendTransport;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\testConfig;

$token = str_repeat('A', 21) . '_-' . str_repeat('b', 20);
$mail = ['transport' => 'resend', 'from' => 'TAM OS <no-reply@example.test>', 'api_key' => 're_test_not_a_real_key'];

return [
    'the link is <configured origin>/#recovery=<token>: the token only in the fragment' => static function () use ($token): void {
        assertSame('https://finance.example.test/#recovery=' . $token, RecoveryMail::link('https://finance.example.test', $token));
        assertSame('http://127.0.0.1:8765/#recovery=' . $token, RecoveryMail::link('http://127.0.0.1:8765', $token), 'development origin');
        $link = RecoveryMail::link('https://finance.example.test', $token);
        assertTrue(!str_contains(explode('#', $link, 2)[0], $token), 'nothing before the fragment carries the token');
        assertTrue(!str_contains($link, '?'), 'no query string');
        assertSame(43, strlen(SessionToken::generate()), 'a real token has the shape the link accepts');
    },
    'anything but a canonical origin, or a malformed token, is refused (no Host header, no path, no injection)' => static function () use ($token): void {
        foreach (['https://finance.example.test/', 'https://finance.example.test/app', 'https://Finance.example.test', 'finance.example.test',
            'https://evil.test@finance.example.test', "https://finance.example.test\r\nX: y", 'https://finance.example.test#x', '', 'javascript:alert(1)'] as $origin) {
            assertThrows(\LogicException::class, static fn () => RecoveryMail::link($origin, $token), $origin);
        }
        foreach (['', 'short', $token . 'x', str_repeat('+', 43), str_repeat('=', 43)] as $bad) {
            assertThrows(\LogicException::class, static fn () => RecoveryMail::link('https://finance.example.test', $bad), 'token ' . $bad);
        }
    },
    'the message: fixed subject, one link, the lifetime, no other data' => static function () use ($token): void {
        $m = RecoveryMail::build('https://finance.example.test', 'person@example.test', $token, 30, 'outbox-1-1');
        assertSame(['person@example.test', 'TAM OS password reset', 'outbox-1-1'], [$m->to, $m->subject, $m->reference]);
        assertSame(1, substr_count($m->text, $token), 'the token appears once');
        assertSame(1, substr_count($m->text, 'https://'), 'one link');
        assertTrue(str_contains($m->text, 'within 30 minutes'), 'lifetime stated');
        assertTrue(!str_contains($m->text, 'person@example.test'), 'the address is not repeated in the body');
    },
    'mail configuration: exactly transport, from, api_key' => static function () use ($mail): void {
        $c = MailConfig::fromConfig(testConfig(['mail' => $mail]));
        assertSame(['resend', 'TAM OS <no-reply@example.test>'], [$c->transport, $c->from]);
        assertTrue($c->transport() instanceof ResendTransport, 'resend transport');
        $bad = [
            'absent' => null,
            'not an array' => 'resend',
            'missing key' => ['transport' => 'resend', 'from' => $mail['from']],
            'extra key' => $mail + ['smtp_host' => 'x'],
            'reordered' => ['from' => $mail['from'], 'transport' => 'resend', 'api_key' => $mail['api_key']],
            'placeholder' => ['api_key' => 'CHANGE_ME'] + $mail,
            'placeholder sender' => ['from' => 'TAM OS <CHANGE_ME@example.invalid>'] + $mail,
            'unknown transport' => ['transport' => 'smtp'] + $mail,
            'bare sender' => ['from' => 'no-reply@example.test'] + $mail,
            'header injection in sender' => ['from' => "TAM OS <a@example.test>\r\nBcc: x@example.test"] + $mail,
            'bad key shape' => ['api_key' => 'sk_live_whatever'] + $mail,
            'non-string' => ['api_key' => 123] + $mail,
        ];
        foreach ($bad as $label => $value) {
            $e = assertThrows(MailError::class, static fn () => MailConfig::fromConfig(testConfig($value === null ? [] : ['mail' => $value])), $label);
            assertSame(MailError::CONFIG, $e->kind, $label);
        }
    },
    'the API key never appears in a dump of the configuration' => static function () use ($mail): void {
        ob_start();
        var_dump(MailConfig::fromConfig(testConfig(['mail' => $mail])), testConfig(['mail' => $mail]));
        assertTrue(!str_contains((string) ob_get_clean(), 're_test_not_a_real_key'), 'redacted');
    },
];
