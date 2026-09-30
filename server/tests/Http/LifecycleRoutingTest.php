<?php
declare(strict_types=1);

/*
 * BF-3B route-level semantics, in process and without a database: activate never resolves a
 * session and checks its body and the password rule before any database work; change-password
 * and logout-all require a session and its CSRF token; the origin check runs first for all.
 * With no db section configured, anything that reaches the database answers 503 — which is how
 * these tests prove what happened before it.
 */

use TamOs\Http\Request;
use TamOs\Identity\AuthSession;
use TamOs\Identity\Principal;
use TamOs\Identity\PrincipalResolver;
use function TamOs\Tests\assertApiHeaders;
use function TamOs\Tests\assertNoLeak;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\envelope;
use function TamOs\Tests\jsonPost;
use function TamOs\Tests\kernel;
use function TamOs\Tests\requestId;
use function TamOs\Tests\sessionRequest;

$token = str_repeat('C', 43);
$csrf = str_repeat('c', 43);
$code = static fn ($r): ?string => envelope($r)['error']['code'] ?? null;
$fields = static fn ($r): ?array => envelope($r)['error']['fields'] ?? null;
/** A resolver that must never be called. */
$forbidden = static fn (): PrincipalResolver => new class implements PrincipalResolver {
    public function resolve(Request $request): ?AuthSession
    {
        throw new LogicException('the resolver was invoked');
    }
};
/** A resolver double: one CEO session, and a call counter. */
$resolver = static function () use ($token, $csrf): PrincipalResolver {
    return new class ($token, $csrf) implements PrincipalResolver {
        public int $calls = 0;

        public function __construct(private string $t, private string $c)
        {
        }

        public function resolve(Request $request): ?AuthSession
        {
            $this->calls++;
            if ($request->sessionToken !== $this->t) {
                return null;
            }
            $principal = Principal::fromAccount(
                ['user_id' => str_repeat('1', 32), 'user_status' => 'active', 'has_password' => true],
                [['membership_id' => str_repeat('2', 32), 'company_id' => str_repeat('3', 32), 'role' => 'ceo', 'employee_id' => null, 'membership_status' => 'active']],
            );
            return new AuthSession($principal, $this->c);
        }
    };
};
$activate = static fn (string $body, array $o = []): Request => jsonPost('/api/auth/activate', $body, $o + ['remoteAddr' => '203.0.113.7']);
$validToken = str_repeat('T', 43);

return [
    'activate never resolves a session, whatever cookie is sent, and sets no cookie' => static function () use ($forbidden, $activate, $token, $validToken, $code): void {
        $k = kernel(null, null, null, $forbidden());
        $body = json_encode(['token' => $validToken, 'password' => 'a-fine-new-password'], JSON_THROW_ON_ERROR);
        foreach ([$token, 'malformed', null] as $cookie) {
            $r = $k->handle($activate($body, ['sessionToken' => $cookie, 'csrfToken' => null]), requestId());
            assertSame([503, 'service_unavailable'], [$r->status, $code($r)], 'reaches the database (none configured), not the resolver');
            assertApiHeaders($r, requestId());
        }
    },
    'activate: the body is exactly {token, password}, both strings' => static function () use ($forbidden, $activate, $code, $fields): void {
        $k = kernel(null, null, null, $forbidden());
        foreach ([
            'extra email' => '{"token":"x","password":"a-fine-new-password","email":"ceo@example.test"}',
            'extra role' => '{"token":"x","password":"a-fine-new-password","role":"ceo"}',
            'missing token' => '{"password":"a-fine-new-password"}',
            'numeric token' => '{"token":1,"password":"a-fine-new-password"}',
            'array password' => '{"token":"x","password":["a"]}',
            'empty' => '{}',
        ] as $label => $body) {
            $r = $k->handle($activate($body), requestId());
            assertSame([400, 'validation_failed', ['token', 'password']], [$r->status, $code($r), $fields($r)], $label);
            assertTrue(!str_contains($r->body, 'ceo@example.test') && !str_contains($r->body, 'a-fine-new-password'), $label . ': nothing reflected');
        }
    },
    'activate: a password the policy refuses is 400 [password] before any database work' => static function () use ($forbidden, $activate, $validToken, $code, $fields): void {
        $k = kernel(null, null, null, $forbidden());
        foreach (['short', str_repeat('x', 73), "nul\0-inside-password", 'password12345'] as $password) {
            $r = $k->handle($activate(json_encode(['token' => $validToken, 'password' => $password], JSON_THROW_ON_ERROR)), requestId());
            assertSame([400, 'validation_failed', ['password']], [$r->status, $code($r), $fields($r)], 'no 503: the database was never reached');
        }
    },
    'activate: Origin/Referer and Content-Type are enforced first' => static function () use ($forbidden, $activate, $validToken): void {
        $k = kernel(null, null, null, $forbidden());
        $body = json_encode(['token' => $validToken, 'password' => 'a-fine-new-password'], JSON_THROW_ON_ERROR);
        foreach ([['origin' => 'https://evil.test'], ['origin' => null], ['origin' => null, 'referer' => 'https://evil.test/x'], ['origin' => 'null']] as $o) {
            assertSame(403, $k->handle($activate($body, $o), requestId())->status);
        }
        assertSame(415, $k->handle($activate($body, ['contentType' => 'application/x-www-form-urlencoded']), requestId())->status);
        assertSame(400, $k->handle($activate($body, ['query' => 'token=' . $validToken]), requestId())->status, 'no token in the URL');
    },
    'change-password and logout-all: 401 without a session, before the handler' => static function () use ($resolver, $code): void {
        $k = kernel(null, null, null, $resolver());
        foreach (['/api/auth/change-password' => '{"currentPassword":"a","newPassword":"b"}', '/api/auth/logout-all' => '{}'] as $path => $body) {
            foreach ([null, 'malformed', str_repeat('X', 43)] as $cookie) {
                $r = $k->handle(sessionRequest('POST', $path, $cookie, str_repeat('c', 43), $body), requestId());
                assertSame([401, 'unauthenticated'], [$r->status, $code($r)], $path);
                assertTrue(!isset($r->headers['Set-Cookie']), $path . ': no cookie change');
            }
        }
    },
    'change-password and logout-all: a missing or wrong CSRF token is 403 and nothing happens' => static function () use ($resolver, $token, $code): void {
        $k = kernel(null, null, null, $resolver());
        foreach (['/api/auth/change-password' => '{"currentPassword":"a","newPassword":"b"}', '/api/auth/logout-all' => '{}'] as $path => $body) {
            foreach (['missing' => null, 'wrong' => str_repeat('w', 43)] as $label => $csrf) {
                $r = $k->handle(sessionRequest('POST', $path, $token, $csrf, $body), requestId());
                assertSame([403, 'forbidden'], [$r->status, $code($r)], $path . ' ' . $label);
                assertTrue(!isset($r->headers['Set-Cookie']), $path . ': cookie kept');
            }
        }
    },
    'change-password and logout-all: the origin check runs before any session resolution' => static function () use ($resolver, $token, $csrf): void {
        $res = $resolver();
        $k = kernel(null, null, null, $res);
        foreach (['/api/auth/change-password', '/api/auth/logout-all'] as $path) {
            foreach ([['origin' => 'https://evil.test'], ['origin' => null]] as $o) {
                assertSame(403, $k->handle(sessionRequest('POST', $path, $token, $csrf, '{}', $o), requestId())->status, $path);
            }
        }
        assertSame(0, $res->calls, 'no resolution for a cross-origin mutation');
    },
    'change-password: body exactly {currentPassword, newPassword}; a refused new password is 400 before the database' => static function () use ($resolver, $token, $csrf, $code, $fields): void {
        $k = kernel(null, null, null, $resolver());
        foreach (['{"newPassword":"a-fine-new-password"}', '{"currentPassword":"x","newPassword":"a-fine-new-password","userId":"u"}', '{"currentPassword":1,"newPassword":"a-fine-new-password"}'] as $body) {
            $r = $k->handle(sessionRequest('POST', '/api/auth/change-password', $token, $csrf, $body), requestId());
            assertSame([400, 'validation_failed', ['currentPassword', 'newPassword']], [$r->status, $code($r), $fields($r)], $body);
        }
        $r = $k->handle(sessionRequest('POST', '/api/auth/change-password', $token, $csrf, '{"currentPassword":"x","newPassword":"too-short"}'), requestId());
        assertSame([400, 'validation_failed', ['newPassword']], [$r->status, $code($r), $fields($r)], 'policy first: no 503');
        $r = $k->handle(sessionRequest('POST', '/api/auth/change-password', $token, $csrf, '{"currentPassword":"x","newPassword":"a-fine-new-password"}'), requestId());
        assertSame(503, $r->status, 'a valid request goes on to the database');
    },
    'logout-all: body must be {}' => static function () use ($resolver, $token, $csrf, $code): void {
        $k = kernel(null, null, null, $resolver());
        $r = $k->handle(sessionRequest('POST', '/api/auth/logout-all', $token, $csrf, '{"userId":"someone-else"}'), requestId());
        assertSame([400, 'validation_failed'], [$r->status, $code($r)]);
        assertSame(503, $k->handle(sessionRequest('POST', '/api/auth/logout-all', $token, $csrf, '{}'), requestId())->status, 'then revocation needs the database');
    },
    'responses never leak passwords, tokens or internals' => static function () use ($resolver, $token, $csrf, $activate, $validToken): void {
        $k = kernel(null, null, null, $resolver());
        foreach ([
            $activate(json_encode(['token' => $validToken, 'password' => 'hunter2-secret-long'], JSON_THROW_ON_ERROR)),
            sessionRequest('POST', '/api/auth/change-password', $token, $csrf, '{"currentPassword":"old-secret-value","newPassword":"hunter2-secret-long"}'),
            sessionRequest('POST', '/api/auth/logout-all', $token, $csrf, '{}'),
        ] as $request) {
            assertNoLeak($k->handle($request, requestId())->body, [$validToken, 'hunter2-secret-long', 'old-secret-value', $token, $csrf, hash('sha256', $validToken)]);
        }
    },
];
