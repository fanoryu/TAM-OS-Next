<?php
declare(strict_types=1);

/*
 * Route-level authentication semantics, in process and without a database (BF-3A):
 * which routes resolve a session, the 401 / CSRF gates, origin-before-resolution, cookie
 * headers, and that forged identity inputs are ignored. The resolver here is a test double
 * that counts its calls; the real SessionPrincipalResolver is exercised in tests/Db.
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
use function TamOs\Tests\testConfig;

$employeeToken = str_repeat('E', 43);
$ceoToken = str_repeat('C', 43);
$employeeCsrf = str_repeat('e', 43);
$ceoCsrf = str_repeat('c', 43);

/** A resolver double: fixed sessions by token, and a call counter. */
$resolver = static function () use ($employeeToken, $ceoToken, $employeeCsrf, $ceoCsrf): PrincipalResolver {
    return new class ($employeeToken, $ceoToken, $employeeCsrf, $ceoCsrf) implements PrincipalResolver {
        public int $calls = 0;

        public function __construct(private string $e, private string $c, private string $ec, private string $cc)
        {
        }

        public function resolve(Request $request): ?AuthSession
        {
            $this->calls++;
            $user = ['user_id' => str_repeat('1', 32), 'user_status' => 'active', 'has_password' => true];
            $m = ['membership_id' => str_repeat('2', 32), 'company_id' => str_repeat('3', 32), 'membership_status' => 'active'];
            return match ($request->sessionToken) {
                $this->e => new AuthSession(Principal::fromAccount($user, [$m + ['role' => 'employee', 'employee_id' => 'emp-1']]), $this->ec),
                $this->c => new AuthSession(Principal::fromAccount($user, [$m + ['role' => 'ceo', 'employee_id' => null]]), $this->cc),
                default => null,
            };
        }
    };
};
/** A resolver that must never be called. */
$forbidden = static fn (): PrincipalResolver => new class implements PrincipalResolver {
    public function resolve(Request $request): ?AuthSession
    {
        throw new LogicException('the resolver was invoked');
    }
};
$code = static fn ($r): ?string => envelope($r)['error']['code'] ?? null;
$clear = '__Host-tamos_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';

return [
    'health and ready never resolve a session, whatever cookie is sent' => static function () use ($code, $forbidden, $employeeToken): void {
        $k = kernel(null, null, null, $forbidden());
        foreach (['GET', 'HEAD'] as $method) {
            foreach ([$employeeToken, 'malformed', null] as $token) {
                $h = $k->handle(sessionRequest($method, '/api/health', $token), requestId());
                assertSame(200, $h->status, $method . ' health');
                assertApiHeaders($h, requestId());
                // No db section: readiness answers 503 — and still never resolves identity.
                $r = $k->handle(sessionRequest($method, '/api/ready', $token), requestId());
                assertSame(503, $r->status, $method . ' ready');
            }
        }
    },
    'login never resolves a session; its body contract fails before any database work' => static function () use ($code, $forbidden, $employeeToken): void {
        $k = kernel(null, null, null, $forbidden());
        $cases = [
            'extra field' => ['{"email":"a@example.test","password":"pw","role":"ceo"}', 'validation_failed'],
            'missing password' => ['{"email":"a@example.test"}', 'validation_failed'],
            'non-string password' => ['{"email":"a@example.test","password":123456789012}', 'validation_failed'],
            'array email' => ['{"email":["a@example.test"],"password":"pw"}', 'validation_failed'],
            'empty object' => ['{}', 'validation_failed'],
            'malformed JSON' => ['{"email":', 'malformed_json'],
            'JSON array' => ['["a@example.test","pw"]', 'malformed_json'],
        ];
        foreach ($cases as $label => [$body, $expected]) {
            $r = $k->handle(jsonPost('/api/auth/login', $body, ['sessionToken' => $employeeToken]), requestId());
            assertSame([400, $expected], [$r->status, $code($r)], $label);
            assertApiHeaders($r, requestId());
            assertTrue(!str_contains($r->body, 'role') && !str_contains($r->body, 'a@example.test'), $label . ': nothing reflected');
        }
        $q = $k->handle(jsonPost('/api/auth/login', '{"email":"a@example.test","password":"pw"}', ['query' => 'email=a@example.test']), requestId());
        assertSame([400, 'invalid_query'], [$q->status, $code($q)], 'credentials in the URL are refused');
    },
    'login: Origin/Referer and Content-Type are enforced before anything else' => static function () use ($code, $forbidden): void {
        $k = kernel(null, null, null, $forbidden());
        $body = '{"email":"a@example.test","password":"pw"}';
        foreach ([
            'no origin or referer' => ['origin' => null],
            'cross origin' => ['origin' => 'https://evil.test'],
            'cross-origin referer' => ['origin' => null, 'referer' => 'https://evil.test/login'],
            'null origin' => ['origin' => 'null'],
        ] as $label => $o) {
            $r = $k->handle(jsonPost('/api/auth/login', $body, $o), requestId());
            assertSame([403, 'forbidden'], [$r->status, $code($r)], $label);
        }
        $r = $k->handle(jsonPost('/api/auth/login', $body, ['origin' => null, 'referer' => 'https://tamos.test/app']), requestId());
        assertSame(503, $r->status, 'same-origin Referer fallback passes the guard (then the unconfigured database answers 503)');
        $r = $k->handle(jsonPost('/api/auth/login', $body, ['contentType' => 'text/plain']), requestId());
        assertSame(415, $r->status, 'form-style content type refused');
    },
    'login: a storage failure is 503 service_unavailable, never a credential failure' => static function () use ($code, $forbidden): void {
        $r = kernel(null, null, null, $forbidden())->handle(jsonPost('/api/auth/login', '{"email":"a@example.test","password":"pw"}'), requestId());
        assertSame([503, 'service_unavailable'], [$r->status, $code($r)]);
        assertTrue(!isset($r->headers['Set-Cookie']), 'no cookie on failure');
    },
    'me: 401 without a session; the projection with a session; no CSRF needed for GET/HEAD' => static function () use ($code, $resolver, $employeeToken, $employeeCsrf): void {
        $res = $resolver();
        $k = kernel(null, null, null, $res);
        foreach ([null, 'malformed', str_repeat('X', 43)] as $token) {
            $r = $k->handle(sessionRequest('GET', '/api/auth/me', $token), requestId());
            assertSame([401, 'unauthenticated'], [$r->status, $code($r)]);
        }
        $r = $k->handle(sessionRequest('GET', '/api/auth/me', $employeeToken), requestId());
        assertSame(200, $r->status);
        assertApiHeaders($r, requestId());
        assertSame(['userId' => str_repeat('1', 32), 'membershipId' => str_repeat('2', 32), 'role' => 'employee', 'employeeId' => 'emp-1', 'csrfToken' => $employeeCsrf], envelope($r)['data']);
        assertTrue(!str_contains($r->body, str_repeat('3', 32)) && !str_contains($r->body, $employeeToken), 'no companyId, no session token');
        $head = $k->handle(sessionRequest('HEAD', '/api/auth/me', $employeeToken), requestId());
        assertSame(200, $head->status);
        assertSame(5, $res->calls, 'me resolves every time');
    },
    'me: forged identity headers, query and body never change the principal' => static function () use ($code, $resolver, $employeeToken): void {
        $k = kernel(null, null, null, $resolver());
        $saved = $_SERVER;
        $_SERVER = [
            'REQUEST_METHOD' => 'GET', 'REQUEST_URI' => '/api/auth/me', 'HTTP_COOKIE' => '__Host-tamos_session=' . $employeeToken . '; role=ceo',
            'HTTP_X_ROLE' => 'ceo', 'HTTP_X_USER' => 'u-forged', 'HTTP_X_COMPANY' => 'c-forged', 'HTTP_X_EMPLOYEE' => 'e-forged',
            'HTTP_X_ACTING_AS' => 'ceo', 'HTTP_AUTHORIZATION' => 'Bearer ceo', 'REMOTE_ADDR' => '198.51.100.1',
        ];
        try {
            $request = Request::fromGlobals(65536);
        } finally {
            $_SERVER = $saved;
        }
        $r = $k->handle($request, requestId());
        assertSame([200, 'employee', 'emp-1'], [$r->status, envelope($r)['data']['role'], envelope($r)['data']['employeeId']]);
        foreach (['u-forged', 'c-forged', 'e-forged'] as $f) {
            assertTrue(!str_contains($r->body, $f), $f);
        }
        $q = $k->handle(sessionRequest('GET', '/api/auth/me', $employeeToken, null, '', ['query' => 'role=ceo']), requestId());
        assertSame(400, $q->status, 'identity in the query is refused, not applied');
    },
    'logout without a session: idempotent 200, cookie cleared, no CSRF needed, no database' => static function () use ($code, $resolver, $clear): void {
        $k = kernel(null, null, null, $resolver());
        foreach ([null, 'malformed', str_repeat('X', 43)] as $token) {
            $r = $k->handle(sessionRequest('POST', '/api/auth/logout', $token), requestId());
            assertSame([200, ['loggedOut' => true]], [$r->status, envelope($r)['data']]);
            assertApiHeaders($r, requestId(), true);
            assertSame($clear, $r->headers['Set-Cookie'] ?? null);
        }
        $r = $k->handle(sessionRequest('POST', '/api/auth/logout', null, null, '{"all":true}'), requestId());
        assertSame([400, 'validation_failed'], [$r->status, $code($r)], 'logout body must be {}');
    },
    'logout with a session: missing, wrong or another session\'s CSRF token is 403 and nothing is cleared' => static function () use ($code, $resolver, $employeeToken, $employeeCsrf, $ceoCsrf): void {
        $k = kernel(null, null, null, $resolver());
        foreach (['missing' => null, 'wrong' => str_repeat('w', 43), 'other session' => $ceoCsrf] as $label => $csrf) {
            $r = $k->handle(sessionRequest('POST', '/api/auth/logout', $employeeToken, $csrf), requestId());
            assertSame([403, 'forbidden'], [$r->status, $code($r)], $label);
            assertTrue(!isset($r->headers['Set-Cookie']), $label . ': cookie kept');
        }
        $ok = $k->handle(sessionRequest('POST', '/api/auth/logout', $employeeToken, $employeeCsrf), requestId());
        assertSame(503, $ok->status, 'the matching token passes the kernel (revocation then needs the database)');
    },
    'mutations: the origin check runs before any session resolution' => static function () use ($code, $resolver, $employeeToken, $employeeCsrf): void {
        $res = $resolver();
        $k = kernel(null, null, null, $res);
        foreach ([['origin' => 'https://evil.test'], ['origin' => null], ['origin' => null, 'referer' => 'https://evil.test/']] as $o) {
            $r = $k->handle(sessionRequest('POST', '/api/auth/logout', $employeeToken, $employeeCsrf, '{}', $o), requestId());
            assertSame(403, $r->status);
        }
        assertSame(0, $res->calls, 'no resolution for a cross-origin mutation');
    },
    'responses never leak tokens or internals' => static function () use ($code, $resolver, $employeeToken, $employeeCsrf): void {
        $k = kernel(testConfig(), null, null, $resolver());
        foreach ([
            sessionRequest('GET', '/api/auth/me', null),
            sessionRequest('POST', '/api/auth/logout', $employeeToken),
            jsonPost('/api/auth/login', '{"email":"a@example.test","password":"hunter2-secret"}'),
        ] as $request) {
            $r = $k->handle($request, requestId());
            assertNoLeak($r->body, [$employeeToken, 'hunter2-secret', hash('sha256', $employeeToken)]);
        }
    },
];
