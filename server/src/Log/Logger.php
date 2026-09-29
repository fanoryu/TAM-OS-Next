<?php
declare(strict_types=1);

namespace TamOs\Log;

/**
 * Structured server log: one JSON object per line, appended to the configured path, which
 * must sit outside the public web root.
 *
 * Fields are fixed and metadata-only. Request bodies, query values, cookies, Authorization,
 * CSRF tokens, passwords and configuration values are never logged. Exception text is
 * redacted; a stack trace is written only outside production and only to this log. A
 * failure to write never breaks the response and never echoes what was being written.
 */
final class Logger
{
    private const METHOD = '/^[A-Z]{1,16}$/';

    public function __construct(private readonly string $path, private readonly string $env)
    {
    }

    public function access(string $requestId, string $method, ?string $route, int $status, int $durationMs, ?string $error): void
    {
        $this->write([
            'level' => $status >= 500 ? 'error' : 'info',
            'event' => 'request',
            'requestId' => $requestId,
            'method' => preg_match(self::METHOD, $method) === 1 ? $method : 'INVALID',
            'route' => $route ?? '-',
            'status' => $status,
            'durationMs' => $durationMs,
            'error' => $error,
        ]);
    }

    public function exception(string $requestId, \Throwable $e): void
    {
        $entry = [
            'level' => 'error',
            'event' => 'exception',
            'requestId' => $requestId,
            'class' => $e::class,
            'message' => Redactor::redact($e->getMessage()),
            'at' => basename($e->getFile()) . ':' . $e->getLine(),
        ];
        if ($this->env !== 'production') {
            $entry['trace'] = Redactor::redact($e->getTraceAsString());
        }
        $this->write($entry);
    }

    /** @param array<string, mixed> $entry */
    private function write(array $entry): void
    {
        $line = ['ts' => gmdate('Y-m-d\TH:i:s\Z')] + $entry;
        try {
            $json = json_encode($line, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
            file_put_contents($this->path, $json . "\n", FILE_APPEND | LOCK_EX);
        } catch (\Throwable) {
            error_log('tamos: log write failed');
        }
    }
}
