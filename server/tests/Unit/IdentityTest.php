<?php
declare(strict_types=1);

use TamOs\Http\Request;
use TamOs\Http\SessionCookie;
use TamOs\Identity\NullPrincipalResolver;
use TamOs\Identity\PrincipalResolver;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;

/** Request::fromGlobals over a temporary $_SERVER. */
$fromServer = static function (array $server): Request {
    $saved = $_SERVER;
    $_SERVER = $server + ['REQUEST_METHOD' => 'GET', 'REQUEST_URI' => '/api/auth/me'];
    try {
        return Request::fromGlobals(65536);
    } finally {
        $_SERVER = $saved;
    }
};
$token = str_repeat('A', 20) . '-' . str_repeat('b', 20) . '_9';
$other = str_repeat('Z', 43);

return [
    'NullPrincipalResolver is the resolver and returns null' => static function (): void {
        $resolver = new NullPrincipalResolver();
        assertTrue($resolver instanceof PrincipalResolver, 'implements the seam');
        assertSame(null, $resolver->resolve(new Request('GET', '/api/health')));
    },
    'identity-bearing request fields never produce a principal' => static function (): void {
        $resolver = new NullPrincipalResolver();
        $hostile = new Request('POST', '/api/health', 'role=ceo&company_id=1', 'application/json', 'https://tamos.test', null,
            '{"role":"ceo","company_id":"c1","employee_id":"e1","user_id":"u1"}', false, true);
        assertSame(null, $resolver->resolve($hostile));
    },
    'the request snapshot captures only the three approved auth inputs — no Authorization, Host or forwarding headers' => static function (): void {
        $names = array_map(static fn (ReflectionProperty $p): string => $p->getName(), (new ReflectionClass(Request::class))->getProperties());
        assertSame(['method', 'path', 'query', 'contentType', 'origin', 'referer', 'body', 'bodyTooLarge', 'isHttps', 'sessionToken', 'csrfToken', 'remoteAddr'], $names);
    },
    'Request::fromGlobals ignores forged identity headers' => static function () use ($fromServer, $token): void {
        $request = $fromServer([
            'REQUEST_METHOD' => 'GET', 'REQUEST_URI' => '/api/health?x=1', 'HTTP_COOKIE' => '__Host-tamos_session=forged; role=ceo',
            'HTTP_AUTHORIZATION' => 'Bearer ' . $token, 'HTTP_X_ROLE' => 'ceo', 'HTTP_X_USER' => 'u1', 'HTTP_X_COMPANY' => 'c1',
            'HTTP_X_EMPLOYEE' => 'e1', 'HTTP_X_ACTING_AS' => 'ceo', 'HTTP_HOST' => 'evil.test',
            'HTTP_X_FORWARDED_FOR' => '10.0.0.1', 'HTTP_FORWARDED' => 'for=10.0.0.2', 'HTTP_CF_CONNECTING_IP' => '10.0.0.3',
            'HTTP_X_REAL_IP' => '10.0.0.4', 'HTTP_X_FORWARDED_HOST' => 'evil.test', 'HTTP_X_REQUEST_ID' => 'attacker',
            'HTTP_ORIGIN' => 'https://tamos.test', 'HTTPS' => 'on', 'REMOTE_ADDR' => '198.51.100.9',
        ]);
        assertSame(['GET', '/api/health', 'x=1', 'https://tamos.test', true], [$request->method, $request->path, $request->query, $request->origin, $request->isHttps]);
        assertSame([null, null, '198.51.100.9'], [$request->sessionToken, $request->csrfToken, $request->remoteAddr], 'Authorization is not a session; REMOTE_ADDR only');
        assertSame(null, (new NullPrincipalResolver())->resolve($request));
        $dump = serialize($request);
        foreach (['forged', 'attacker', 'evil', 'ceo', '10.0.0.', $token] as $needle) {
            assertTrue(!str_contains($dump, $needle), 'nothing forged captured: ' . $needle);
        }
    },
    'session cookie: exactly one well-formed value among unrelated cookies is captured' => static function () use ($fromServer, $token): void {
        assertSame($token, $fromServer(['HTTP_COOKIE' => '__Host-tamos_session=' . $token])->sessionToken, 'alone');
        assertSame($token, $fromServer(['HTTP_COOKIE' => "theme=dark;\t__Host-tamos_session=" . $token . ' ; lang=id'])->sessionToken, 'among others, OWS trimmed');
        assertSame(null, $fromServer([])->sessionToken, 'no cookie header');
        assertSame(null, $fromServer(['HTTP_COOKIE' => 'theme=dark; tamos_session=' . $token])->sessionToken, 'a similar name is not the cookie');
    },
    'session cookie: duplicates are ambiguous and yield no token' => static function () use ($fromServer, $token, $other): void {
        assertSame(null, $fromServer(['HTTP_COOKIE' => '__Host-tamos_session=' . $token . '; __Host-tamos_session=' . $other])->sessionToken, 'two values');
        assertSame(null, $fromServer(['HTTP_COOKIE' => '__Host-tamos_session=' . $token . '; __Host-tamos_session=' . $token])->sessionToken, 'same value twice');
        assertSame(null, $fromServer(['HTTP_COOKIE' => '__Host-tamos_session=' . $token . '; __Host-tamos_session=junk'])->sessionToken, 'valid + malformed');
    },
    'session cookie: malformed values are never decoded, unquoted or truncated into a token' => static function () use ($fromServer, $token): void {
        foreach ([
            'short' => substr($token, 1), 'long' => $token . 'x', 'quoted' => '"' . $token . '"',
            'url-encoded' => str_replace('-', '%2D', $token), 'padded' => substr($token, 0, 42) . '=', 'plus' => substr($token, 0, 42) . '+',
            'empty' => '', 'space inside' => substr($token, 0, 20) . ' ' . substr($token, 21),
        ] as $label => $value) {
            assertSame(null, $fromServer(['HTTP_COOKIE' => '__Host-tamos_session=' . $value])->sessionToken, $label);
        }
        assertSame(null, $fromServer(['HTTP_COOKIE' => '__HOST-TAMOS_SESSION=' . $token])->sessionToken, 'name is case-sensitive');
        assertSame(null, $fromServer(['HTTP_COOKIE' => str_repeat('a=b; ', 2000) . '__Host-tamos_session=' . $token])->sessionToken, 'over-long header');
        assertSame(null, SessionCookie::tokenFromHeader(null));
    },
    'CSRF header is captured only in token shape; REMOTE_ADDR is validated and canonical' => static function () use ($fromServer, $token): void {
        assertSame($token, $fromServer(['HTTP_X_CSRF_TOKEN' => $token])->csrfToken);
        assertSame(null, $fromServer(['HTTP_X_CSRF_TOKEN' => $token . 'x'])->csrfToken, 'wrong length');
        assertSame(null, $fromServer(['HTTP_X_CSRF_TOKEN' => ''])->csrfToken, 'empty');
        assertSame('2001:db8::1', $fromServer(['REMOTE_ADDR' => '2001:0DB8:0000::0001'])->remoteAddr, 'IPv6 canonical');
        assertSame('192.0.2.1', $fromServer(['REMOTE_ADDR' => '192.0.2.1'])->remoteAddr);
        foreach (['', 'unknown', '192.0.2.256', '10.0.0.1, 10.0.0.2'] as $bad) {
            assertSame(null, $fromServer(['REMOTE_ADDR' => $bad])->remoteAddr, 'invalid: ' . $bad);
        }
    },
    'Request::fromGlobals reads no body for GET and flags an oversized declared body' => static function (): void {
        $saved = $_SERVER;
        try {
            $_SERVER = ['REQUEST_METHOD' => 'POST', 'REQUEST_URI' => '/api/x', 'CONTENT_LENGTH' => '70000', 'CONTENT_TYPE' => 'application/json'];
            $big = Request::fromGlobals(65536);
            $_SERVER = ['REQUEST_METHOD' => 'POST', 'REQUEST_URI' => '/api/x', 'CONTENT_LENGTH' => '99999999999999999999'];
            $huge = Request::fromGlobals(65536);
            $_SERVER = ['REQUEST_METHOD' => 'HTTPS', 'REQUEST_URI' => '/api/x', 'HTTPS' => 'off'];
            $odd = Request::fromGlobals(65536);
        } finally {
            $_SERVER = $saved;
        }
        assertSame([true, ''], [$big->bodyTooLarge, $big->body]);
        assertSame(true, $huge->bodyTooLarge);
        assertSame([false, false], [$odd->bodyTooLarge, $odd->isHttps]);
    },
];
