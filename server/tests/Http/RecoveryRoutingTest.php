<?php
declare(strict_types=1);

/*
 * BF-3D recovery routes in process, without a database: both require the canonical Origin,
 * JSON and an exact body shape before any database work; neither ever resolves a session or
 * sets a cookie, whatever cookie is sent; no CSRF token is involved.
 */

use TamOs\Http\Request;
use TamOs\Identity\AuthSession;
use TamOs\Identity\PrincipalResolver;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\envelope;
use function TamOs\Tests\jsonPost;
use function TamOs\Tests\kernel;
use function TamOs\Tests\requestId;

/** A resolver that must never be called. */
$forbidden = static fn (): PrincipalResolver => new class implements PrincipalResolver {
    public function resolve(Request $request): ?AuthSession
    {
        throw new LogicException('the resolver was invoked');
    }
};
$err = static fn ($r): array => [$r->status, envelope($r)['error']['code'] ?? null, envelope($r)['error']['fields'] ?? null];

return [
    'a foreign, missing or referer-less origin is 403 before anything else' => static function () use ($forbidden, $err): void {
        $k = kernel(null, null, null, $forbidden());
        foreach (['/api/auth/forgot-password' => '{"email":"a@example.test"}', '/api/auth/reset-password' => '{"token":"t","password":"p"}'] as $path => $body) {
            foreach ([['origin' => 'https://evil.test'], ['origin' => null], ['origin' => 'https://tamos.test.evil.test']] as $override) {
                assertSame([403, 'forbidden', null], $err($k->handle(jsonPost($path, $body, $override), requestId())), $path);
            }
            assertSame([415, 'unsupported_media_type', null], $err($k->handle(jsonPost($path, $body, ['contentType' => 'text/plain']), requestId())), $path . ' json only');
            assertSame(405, $k->handle(new Request('GET', $path), requestId())->status, $path . ' POST only');
        }
    },
    'the bodies are exact: {"email"} and {"token","password"}; extras such as a user id or a role are refused' => static function () use ($forbidden, $err): void {
        $k = kernel(null, null, null, $forbidden());
        foreach (['{}', '{"email":1}', '{"email":"a@example.test","userId":"x"}', '{"email":"a@example.test","role":"ceo"}', '{"Email":"a@example.test"}'] as $body) {
            assertSame([400, 'validation_failed', ['email']], $err($k->handle(jsonPost('/api/auth/forgot-password', $body), requestId())), $body);
        }
        foreach (['{}', '{"token":"t"}', '{"token":"t","password":"p","email":"a@example.test"}', '{"token":1,"password":"p"}', '{"token":"t","newPassword":"p"}'] as $body) {
            assertSame([400, 'validation_failed', ['token', 'password']], $err($k->handle(jsonPost('/api/auth/reset-password', $body), requestId())), $body);
        }
    },
    'no session is resolved and no cookie is set, whatever cookie is sent' => static function () use ($forbidden): void {
        $k = kernel(null, null, null, $forbidden());
        foreach (['/api/auth/forgot-password' => '{"email":1}', '/api/auth/reset-password' => '{}'] as $path => $body) {
            $r = $k->handle(jsonPost($path, $body, ['sessionToken' => str_repeat('C', 43), 'csrfToken' => str_repeat('c', 43)]), requestId());
            assertSame(400, $r->status, $path);
            assertTrue(!array_key_exists('Set-Cookie', $r->headers), $path . ': no cookie');
        }
    },
];
