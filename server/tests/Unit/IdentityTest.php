<?php
declare(strict_types=1);

use TamOs\Http\Request;
use TamOs\Identity\NullPrincipalResolver;
use TamOs\Identity\PrincipalResolver;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;

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
    'the request snapshot does not capture cookies, Authorization, Host or forwarding headers' => static function (): void {
        $names = array_map(static fn (ReflectionProperty $p): string => $p->getName(), (new ReflectionClass(Request::class))->getProperties());
        assertSame(['method', 'path', 'query', 'contentType', 'origin', 'referer', 'body', 'bodyTooLarge', 'isHttps'], $names);
    },
    'Request::fromGlobals ignores forged identity headers' => static function (): void {
        $saved = $_SERVER;
        $_SERVER = [
            'REQUEST_METHOD' => 'GET', 'REQUEST_URI' => '/api/health?x=1', 'HTTP_COOKIE' => '__Host-tamos_session=forged',
            'HTTP_AUTHORIZATION' => 'Bearer forged', 'HTTP_X_ROLE' => 'ceo', 'HTTP_HOST' => 'evil.test',
            'HTTP_X_FORWARDED_FOR' => '10.0.0.1', 'HTTP_X_FORWARDED_HOST' => 'evil.test', 'HTTP_X_REQUEST_ID' => 'attacker',
            'HTTP_ORIGIN' => 'https://tamos.test', 'HTTPS' => 'on',
        ];
        try {
            $request = Request::fromGlobals(65536);
        } finally {
            $_SERVER = $saved;
        }
        assertSame(['GET', '/api/health', 'x=1', 'https://tamos.test', true], [$request->method, $request->path, $request->query, $request->origin, $request->isHttps]);
        assertSame(null, (new NullPrincipalResolver())->resolve($request));
        assertTrue(!str_contains(serialize($request), 'forged') && !str_contains(serialize($request), 'attacker') && !str_contains(serialize($request), 'evil'), 'nothing forged captured');
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
