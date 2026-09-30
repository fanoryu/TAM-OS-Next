<?php
declare(strict_types=1);

/*
 * Real-server smoke tests: PHP's built-in server runs server/dev/router.php →
 * server/public/api/index.php → bootstrap run(), and raw HTTP is sent over a socket, so the
 * SAPI glue (status line, emitted headers, X-Powered-By removal, HEAD, fail-closed config)
 * is proven — not just the in-process kernel. Uses the same PHP binary as the runner.
 */

use function TamOs\Tests\assertNoLeak;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\fail;
use function TamOs\Tests\tempDir;

$serverRoot = dirname(__DIR__, 2);

/** @return array{stop: callable, send: callable} */
$startServer = static function (?string $configFile) use ($serverRoot): array {
    $probe = stream_socket_server('tcp://127.0.0.1:0');
    if ($probe === false) {
        fail('cannot allocate a port');
    }
    $port = (int) substr((string) strrchr((string) stream_socket_get_name($probe, false), ':'), 1);
    fclose($probe);

    $docroot = tempDir();
    file_put_contents($docroot . '/index.html', 'static');
    $logs = tempDir();
    $env = getenv();
    unset($env['TAMOS_CONFIG']);
    if ($configFile !== null) {
        $env['TAMOS_CONFIG'] = $configFile;
    }
    $cmd = [PHP_BINARY];
    if (php_ini_loaded_file() === false) {
        $cmd[] = '-n';
    }
    array_push($cmd, '-S', '127.0.0.1:' . $port, '-t', $docroot, $serverRoot . '/dev/router.php');
    $proc = proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['file', $logs . '/out.txt', 'w'], 2 => ['file', $logs . '/err.txt', 'w']], $pipes, null, $env);
    if (!is_resource($proc)) {
        fail('cannot start php -S');
    }
    $deadline = microtime(true) + 10;
    while (true) {
        $c = @stream_socket_client('tcp://127.0.0.1:' . $port, $errno, $errstr, 0.2);
        if ($c !== false) {
            fclose($c);
            break;
        }
        if (microtime(true) > $deadline) {
            proc_terminate($proc);
            fail('php -S did not start: ' . (string) @file_get_contents($logs . '/err.txt'));
        }
        usleep(50000);
    }

    $send = static function (string $method, string $target, array $headers = [], string $body = '') use ($port): array {
        $c = stream_socket_client('tcp://127.0.0.1:' . $port, $errno, $errstr, 5);
        if ($c === false) {
            fail('connect failed');
        }
        stream_set_timeout($c, 10);
        $raw = $method . ' ' . $target . " HTTP/1.1\r\nHost: 127.0.0.1:" . $port . "\r\nConnection: close\r\n";
        foreach ($headers as $h) {
            $raw .= $h . "\r\n";
        }
        if ($body !== '' && !preg_grep('/^(Content-Length|Transfer-Encoding):/i', $headers)) {
            $raw .= 'Content-Length: ' . strlen($body) . "\r\n";
        }
        fwrite($c, $raw . "\r\n" . $body);
        $response = stream_get_contents($c);
        fclose($c);
        [$head, $payload] = array_pad(explode("\r\n\r\n", (string) $response, 2), 2, '');
        $lines = explode("\r\n", $head);
        $status = (int) (explode(' ', (string) array_shift($lines))[1] ?? 0);
        $parsed = [];
        foreach ($lines as $line) {
            [$k, $v] = array_pad(explode(':', $line, 2), 2, '');
            $parsed[strtolower(trim($k))] = trim($v);
        }
        return ['status' => $status, 'headers' => $parsed, 'body' => $payload];
    };
    return ['stop' => static fn () => proc_terminate($proc), 'send' => $send, 'logs' => $logs];
};

$writeConfig = static function (array $values): string {
    $dir = tempDir();
    $file = $dir . DIRECTORY_SEPARATOR . 'config.local.php';
    file_put_contents($file, "<?php\ndeclare(strict_types=1);\nreturn " . var_export($values, true) . ";\n");
    return $file;
};

$assertEnvelope = static function (array $r, int $status, ?string $code): void {
    assertSame($status, $r['status'], 'status');
    assertSame('application/json; charset=utf-8', $r['headers']['content-type'] ?? null, 'content-type');
    assertSame('no-store, private', $r['headers']['cache-control'] ?? null, 'cache-control');
    assertSame('nosniff', $r['headers']['x-content-type-options'] ?? null, 'nosniff');
    assertSame("default-src 'none'; frame-ancestors 'none'", $r['headers']['content-security-policy'] ?? null, 'csp');
    assertTrue(!isset($r['headers']['x-powered-by']), 'no X-Powered-By');
    assertTrue(!isset($r['headers']['set-cookie']), 'no Set-Cookie');
    foreach (array_keys($r['headers']) as $name) {
        assertTrue(!str_starts_with($name, 'access-control-'), 'no CORS header');
    }
    $id = $r['headers']['x-request-id'] ?? '';
    assertTrue(preg_match('/^[0-9a-f]{32}$/', $id) === 1, 'server request id');
    if ($r['body'] !== '') {
        $env = json_decode($r['body'], true, 16, JSON_THROW_ON_ERROR);
        assertSame($id, $env['requestId'], 'body requestId matches header');
        assertSame($code, $env['error']['code'] ?? null, 'error code');
        assertNoLeak($r['body']);
    }
};

$validConfig = static function () use ($writeConfig): string {
    return $writeConfig(['env' => 'production', 'origin' => 'https://tamos.test', 'log_path' => tempDir() . DIRECTORY_SEPARATOR . 'api.log']);
};

return [
    'real server: GET /api/health is 200 with the governed headers and no X-Powered-By' => static function () use ($startServer, $validConfig, $assertEnvelope): void {
        $s = $startServer($validConfig());
        try {
            $r = ($s['send'])('GET', '/api/health');
            $assertEnvelope($r, 200, null);
            assertSame(['ok' => true, 'data' => ['status' => 'ok']], array_diff_key(json_decode($r['body'], true), ['requestId' => 1]));
            assertTrue(!isset($r['headers']['strict-transport-security']), 'no HSTS over plain http');
            $head = ($s['send'])('HEAD', '/api/health');
            assertSame([200, ''], [$head['status'], $head['body']], 'HEAD has no body');
        } finally {
            ($s['stop'])();
        }
    },
    'real server: hostile requests get safe envelopes' => static function () use ($startServer, $validConfig, $assertEnvelope): void {
        $s = $startServer($validConfig());
        try {
            foreach (['/api/../index.html', '/api/%2e%2e/index.html', '/api/health%00', '/api//health', '/api/health/', '/api/health.php',
                '/api/index.php', '/api/' . str_repeat('x', 2000), '/api/%ff'] as $target) {
                $assertEnvelope(($s['send'])('GET', $target), 404, 'not_found');
            }
            $assertEnvelope(($s['send'])('POST', '/api/health', ['Content-Type: application/json', 'Origin: https://tamos.test'], '{}'), 405, 'method_not_allowed');
            $assertEnvelope(($s['send'])('OPTIONS', '/api/health', ['Origin: https://evil.test', 'Access-Control-Request-Method: POST']), 405, 'method_not_allowed');
            $assertEnvelope(($s['send'])('TRACE', '/api/health'), 405, 'method_not_allowed');
            $assertEnvelope(($s['send'])('GET', '/api/health?debug=1'), 400, 'invalid_query');
            $big = str_repeat('a', 70000);
            $chunked = dechex(strlen($big)) . "\r\n" . $big . "\r\n0\r\n\r\n";
            $r = ($s['send'])('POST', '/api/health', ['Content-Type: application/json', 'Transfer-Encoding: chunked'], $chunked);
            assertTrue(in_array($r['status'], [405, 413], true), 'oversized chunked body is refused, not processed');
        } finally {
            ($s['stop'])();
        }
    },
    'real server: forged identity and request-ID headers are ignored' => static function () use ($startServer, $validConfig, $assertEnvelope): void {
        $s = $startServer($validConfig());
        try {
            $r = ($s['send'])('GET', '/api/health', [
                'Cookie: __Host-tamos_session=forged; role=ceo', 'Authorization: Bearer forged', 'X-Role: ceo',
                'X-Forwarded-For: 10.0.0.1', 'X-Forwarded-Host: evil.test', 'X-Request-Id: attacker-chosen-id',
            ]);
            $assertEnvelope($r, 200, null);
            assertTrue($r['headers']['x-request-id'] !== 'attacker-chosen-id', 'request id not adopted');
            assertTrue(!str_contains($r['body'], 'forged') && !str_contains($r['body'], 'ceo'), 'nothing reflected');
        } finally {
            ($s['stop'])();
        }
    },
    'real server: a well-formed session cookie never makes health or ready resolve identity (unreachable database)' => static function () use ($startServer, $writeConfig, $assertEnvelope): void {
        $config = $writeConfig([
            'env' => 'production', 'origin' => 'https://tamos.test', 'log_path' => tempDir() . DIRECTORY_SEPARATOR . 'api.log',
            'db' => ['host' => '127.0.0.1', 'port' => 1, 'name' => 'tamos_prod', 'user' => 'tamos_ci', 'pass' => 'hunter2-password'],
        ]);
        $s = $startServer($config);
        try {
            $cookie = 'Cookie: __Host-tamos_session=' . str_repeat('A', 43) . '; theme=dark';
            $assertEnvelope(($s['send'])('GET', '/api/health', [$cookie, 'X-CSRF-Token: ' . str_repeat('c', 43)]), 200, null);
            $head = ($s['send'])('HEAD', '/api/health', [$cookie]);
            assertSame(200, $head['status'], 'HEAD health');
            // Ready reports the unreachable database as it always has — through readiness, not identity.
            $assertEnvelope(($s['send'])('GET', '/api/ready', [$cookie]), 503, 'service_unavailable');
            // The same cookie on an auth route does resolve, so the unreachable database shows there.
            $assertEnvelope(($s['send'])('GET', '/api/auth/me', [$cookie]), 503, 'service_unavailable');
            // Without a well-formed cookie, me answers 401 without touching the database.
            $assertEnvelope(($s['send'])('GET', '/api/auth/me', ['Cookie: __Host-tamos_session=forged']), 401, 'unauthenticated');
            $log = (string) file_get_contents($s['logs'] . '/err.txt') . (string) file_get_contents($s['logs'] . '/out.txt');
            assertTrue(!str_contains($log, str_repeat('A', 43)), 'token never logged by the server process');
        } finally {
            ($s['stop'])();
        }
    },
    'real server: /api/health is 200 with no, a broken or an unreachable db section' => static function () use ($startServer, $writeConfig, $assertEnvelope): void {
        $base = ['env' => 'production', 'origin' => 'https://tamos.test', 'log_path' => tempDir() . DIRECTORY_SEPARATOR . 'api.log'];
        foreach ([
            'none' => $base,
            'broken' => $base + ['db' => 'mysql://tamos_ci:hunter2-password@db.internal.example/tamos_prod'],
            'unreachable' => $base + ['db' => ['host' => '127.0.0.1', 'port' => 1, 'name' => 'tamos_prod', 'user' => 'tamos_ci', 'pass' => 'hunter2-password']],
        ] as $label => $values) {
            $s = $startServer($writeConfig($values));
            try {
                $r = ($s['send'])('GET', '/api/health');
                $assertEnvelope($r, 200, null);
                assertTrue(!str_contains($r['body'], 'hunter2') && !str_contains($r['body'], 'tamos_prod'), $label . ': no db detail');
            } finally {
                ($s['stop'])();
            }
        }
    },
    'real server: missing, placeholder or misplaced configuration fails closed with 503' => static function () use ($startServer, $writeConfig, $assertEnvelope, $serverRoot): void {
        $cases = [
            'missing' => tempDir() . '/absent.php',
            'example (placeholders)' => $serverRoot . '/config/config.example.php',
            'unknown key' => $writeConfig(['env' => 'production', 'origin' => 'https://tamos.test', 'log_path' => '/tmp/x.log', 'debug' => true]),
            'production over http' => $writeConfig(['env' => 'production', 'origin' => 'http://tamos.test', 'log_path' => '/tmp/x.log']),
        ];
        foreach ($cases as $label => $file) {
            $s = $startServer($file);
            try {
                $r = ($s['send'])('GET', '/api/health');
                $assertEnvelope($r, 503, 'service_unavailable');
                assertTrue(!str_contains($r['body'], basename($file)), $label . ': file name not leaked');
            } finally {
                ($s['stop'])();
            }
        }
    },
];
