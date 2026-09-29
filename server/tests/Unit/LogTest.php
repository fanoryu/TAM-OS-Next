<?php
declare(strict_types=1);

use TamOs\Log\Logger;
use TamOs\Log\Redactor;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\requestId;
use function TamOs\Tests\tempDir;

$lines = static function (string $file): array {
    $out = [];
    foreach (file($file, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        $out[] = json_decode($line, true, 16, JSON_THROW_ON_ERROR);
    }
    return $out;
};

return [
    'credential-shaped values are masked' => static function (): void {
        $cases = [
            'password=hunter2' => 'hunter2',
            'db pass: "s3cr3t value"' => 's3cr3t value',
            '{"token":"abc123"}' => 'abc123',
            'api_key=KEY-1' => 'KEY-1',
            'Authorization: Bearer eyJhbGciOi.payload.sig' => 'eyJhbGciOi',
            'mysql://tamos:pw123@db.internal/tamos' => 'pw123',
            'cookie=__Host-tamos_session=zzz' => 'zzz',
            'csrf_token=qqq' => 'qqq',
            'opaque ' . str_repeat('a1', 20) => str_repeat('a1', 20),
        ];
        foreach ($cases as $input => $secret) {
            $out = Redactor::redact($input);
            assertTrue(!str_contains($out, $secret), $input . ' => ' . $out);
            assertTrue(str_contains($out, Redactor::MASK), 'masked: ' . $input);
        }
    },
    'ordinary text is left readable; newlines cannot forge log lines' => static function (): void {
        assertSame('Route not found for GET', Redactor::redact('Route not found for GET'));
        assertSame('a b', Redactor::redact("a\nb"));
        assertTrue(strlen(Redactor::redact(str_repeat('x ', 5000))) <= 2010, 'length capped');
        assertSame(Redactor::MASK, Redactor::redact("\xff\xfe"));
    },
    'access lines are fixed-field JSON with a sanitized method' => static function () use ($lines): void {
        $file = tempDir() . '/api.log';
        $log = new Logger($file, 'production');
        $log->access(requestId(), 'GET', '/api/health', 200, 3, null);
        $log->access(requestId(), "GET\r\nX: 1", null, 404, 1, 'not_found');
        [$a, $b] = $lines($file);
        assertSame(['ts', 'level', 'event', 'requestId', 'method', 'route', 'status', 'durationMs', 'error', 'reason'], array_keys($a));
        assertSame(null, $a['reason']);
        assertSame(['info', 'request', requestId(), 'GET', '/api/health', 200], [$a['level'], $a['event'], $a['requestId'], $a['method'], $a['route'], $a['status']]);
        assertSame(['INVALID', '-', 'not_found'], [$b['method'], $b['route'], $b['error']]);
        assertTrue(preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/', $a['ts']) === 1, 'UTC timestamp');
    },
    'exceptions are logged redacted; traces only outside production' => static function () use ($lines): void {
        $prod = tempDir() . '/api.log';
        (new Logger($prod, 'production'))->exception(requestId(), new RuntimeException('connect failed password=hunter2'));
        $entry = $lines($prod)[0];
        assertSame('RuntimeException', $entry['class']);
        assertTrue(!str_contains($entry['message'], 'hunter2'), 'message redacted');
        assertTrue(!array_key_exists('trace', $entry), 'no trace in production');
        assertTrue(!str_contains($entry['at'], '/') && !str_contains($entry['at'], '\\'), 'basename only');

        $dev = tempDir() . '/api.log';
        (new Logger($dev, 'development'))->exception(requestId(), new RuntimeException('x'));
        assertTrue(array_key_exists('trace', $lines($dev)[0]), 'trace in development');
    },
    'a log write failure neither throws nor echoes' => static function (): void {
        $dir = tempDir();
        $previous = ini_set('error_log', $dir . '/php-error.log');
        ob_start();
        (new Logger($dir, 'production'))->access(requestId(), 'GET', null, 200, 0, null); // a directory is not writable as a file
        $echoed = ob_get_clean();
        ini_set('error_log', (string) $previous);
        assertSame('', $echoed);
        assertTrue(str_contains((string) file_get_contents($dir . '/php-error.log'), 'tamos: log write failed'), 'fixed message only');
    },
];
