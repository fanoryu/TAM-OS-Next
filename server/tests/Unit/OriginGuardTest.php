<?php
declare(strict_types=1);

use TamOs\Http\OriginGuard;
use function TamOs\Tests\assertTrue;

$guard = new OriginGuard('https://finance.example.test');

return [
    'the exact canonical Origin is allowed' => static function () use ($guard): void {
        assertTrue($guard->allows('https://finance.example.test', null), 'exact');
        assertTrue($guard->allows('https://finance.example.test', 'https://evil.test/'), 'Origin wins over Referer');
    },
    'any other Origin is refused, even with a matching Referer' => static function () use ($guard): void {
        foreach (['https://evil.test', 'http://finance.example.test', 'https://finance.example.test:443', 'https://finance.example.test/',
            'https://FINANCE.example.test', 'https://finance.example.test.evil.test', 'null', '*', ' https://finance.example.test'] as $origin) {
            assertTrue(!$guard->allows($origin, 'https://finance.example.test/app'), $origin);
        }
    },
    'without Origin, a same-origin Referer is allowed' => static function () use ($guard): void {
        assertTrue($guard->allows(null, 'https://finance.example.test/'), 'root');
        assertTrue($guard->allows('', 'https://finance.example.test/x?y=1'), 'path + query');
        assertTrue($guard->allows(null, 'HTTPS://Finance.Example.Test/x'), 'scheme/host case-folded');
    },
    'without Origin, a foreign or malformed Referer is refused' => static function () use ($guard): void {
        foreach (['https://evil.test/', 'https://finance.example.test.evil.test/', 'https://user:pw@finance.example.test/',
            'https://finance.example.test:8443/', 'http://finance.example.test/', '/relative', 'not a url', '//finance.example.test/'] as $referer) {
            assertTrue(!$guard->allows(null, $referer), $referer);
        }
    },
    'with neither Origin nor Referer the request is refused' => static function () use ($guard): void {
        assertTrue(!$guard->allows(null, null), 'both null');
        assertTrue(!$guard->allows('', ''), 'both empty');
    },
];
