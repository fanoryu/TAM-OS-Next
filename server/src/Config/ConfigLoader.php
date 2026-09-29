<?php
declare(strict_types=1);

namespace TamOs\Config;

/**
 * Loads and validates the backend configuration, failing closed on anything unexpected.
 *
 * The file is a PHP script returning an array (see server/config/config.example.php).
 * Its location is the TAMOS_CONFIG environment variable when set (development, test, CI),
 * otherwise <app root>/config/config.local.php — outside the public web root in the
 * production layout, and ignored by Git (`config.local.*`). Whether the host allows that
 * placement is pre-deployment evidence (SDR-0002 E1), not an assumption.
 */
final class ConfigLoader
{
    public const DEFAULT_BODY_LIMIT = 65536;
    public const MAX_BODY_LIMIT = 1048576;
    private const KEYS = ['env', 'origin', 'log_path', 'body_limit_bytes'];
    private const PLACEHOLDER = 'CHANGE_ME';

    public static function resolvePath(): string
    {
        $fromEnv = getenv('TAMOS_CONFIG');
        if (is_string($fromEnv) && $fromEnv !== '') {
            return $fromEnv;
        }
        return dirname(__DIR__, 2) . '/config/config.local.php';
    }

    /**
     * @param string|null $documentRoot the web server's document root, when known; the
     *                                  configuration and the log must both live outside it
     */
    public static function load(string $path, ?string $documentRoot): Config
    {
        if (!is_file($path) || !is_readable($path)) {
            throw new ConfigError('missing');
        }
        if (self::isInside($path, $documentRoot)) {
            throw new ConfigError('inside_document_root');
        }
        try {
            $data = (static fn (string $file): mixed => require $file)($path);
        } catch (\Throwable) {
            throw new ConfigError('unloadable');
        }
        if (!is_array($data)) {
            throw new ConfigError('not_an_array');
        }
        return self::fromArray($data, $documentRoot);
    }

    /** @param array<mixed> $data */
    public static function fromArray(array $data, ?string $documentRoot = null): Config
    {
        foreach (array_keys($data) as $key) {
            if (!in_array($key, self::KEYS, true)) {
                throw new ConfigError('unknown_key');
            }
        }
        foreach ($data as $value) {
            if (is_string($value) && str_contains($value, self::PLACEHOLDER)) {
                throw new ConfigError('placeholder_value');
            }
        }

        $env = $data['env'] ?? null;
        if (!is_string($env) || !in_array($env, Config::ENVIRONMENTS, true)) {
            throw new ConfigError('invalid_env');
        }

        $origin = $data['origin'] ?? null;
        if (!is_string($origin) || !preg_match('#^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$#', $origin)) {
            throw new ConfigError('invalid_origin');
        }
        if ($env === 'production' && !str_starts_with($origin, 'https://')) {
            throw new ConfigError('production_origin_not_https');
        }

        $logPath = $data['log_path'] ?? null;
        if (!is_string($logPath) || !self::isAbsolute($logPath) || str_contains($logPath, "\0")) {
            throw new ConfigError('invalid_log_path');
        }
        if (self::isInside($logPath, $documentRoot)) {
            throw new ConfigError('log_inside_document_root');
        }

        $limit = $data['body_limit_bytes'] ?? self::DEFAULT_BODY_LIMIT;
        if (!is_int($limit) || $limit < 1 || $limit > self::MAX_BODY_LIMIT) {
            throw new ConfigError('invalid_body_limit');
        }

        return new Config($env, $origin, $logPath, $limit);
    }

    private static function isAbsolute(string $path): bool
    {
        return str_starts_with($path, '/') || (bool) preg_match('#^[A-Za-z]:[\\\\/]#', $path);
    }

    private static function isInside(string $path, ?string $documentRoot): bool
    {
        if ($documentRoot === null || $documentRoot === '') {
            return false;
        }
        $root = realpath($documentRoot);
        if ($root === false) {
            return false;
        }
        // The file may not exist yet (a log); resolve its directory instead.
        $resolved = realpath($path);
        if ($resolved === false) {
            $dir = realpath(dirname($path));
            if ($dir === false) {
                return false;
            }
            $resolved = $dir . DIRECTORY_SEPARATOR . basename($path);
        }
        $norm = static fn (string $p): string => strtolower(str_replace('\\', '/', $p));
        return str_starts_with($norm($resolved) . '/', rtrim($norm($root), '/') . '/');
    }
}
