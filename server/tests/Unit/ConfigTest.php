<?php
declare(strict_types=1);

use TamOs\Config\ConfigError;
use TamOs\Config\ConfigLoader;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\tempDir;

$valid = static fn (array $over = []): array => $over + [
    'env' => 'production',
    'origin' => 'https://finance.example.test',
    'log_path' => '/var/tamos/logs/api.log',
];
$reason = static fn (array $data): string => assertThrows(ConfigError::class, static fn () => ConfigLoader::fromArray($data))->reason;
$writeConfig = static function (string $dir, string $php): string {
    $file = $dir . DIRECTORY_SEPARATOR . 'config.local.php';
    file_put_contents($file, $php);
    return $file;
};

return [
    'a complete production config loads, with the default body limit' => static function () use ($valid): void {
        $c = ConfigLoader::fromArray($valid());
        assertSame('production', $c->env);
        assertSame('https://finance.example.test', $c->origin);
        assertSame(65536, $c->bodyLimitBytes);
        assertTrue($c->isProduction(), 'isProduction');
    },
    'an explicit body limit within range is kept' => static function () use ($valid): void {
        assertSame(1024, ConfigLoader::fromArray($valid(['body_limit_bytes' => 1024]))->bodyLimitBytes);
    },
    'unknown keys fail closed (a typo is never ignored)' => static function () use ($valid, $reason): void {
        assertSame('unknown_key', $reason($valid(['orgin' => 'x'])));
        assertSame('unknown_key', $reason($valid(['database' => ['pass' => 'x']])));
    },
    'the optional db section is carried unvalidated (checked only when the database is used)' => static function () use ($valid): void {
        assertSame(null, ConfigLoader::fromArray($valid())->db);
        foreach ([['host' => 'CHANGE_ME'], 'not-an-array', ['pass' => 'x']] as $db) {
            assertSame($db, ConfigLoader::fromArray($valid(['db' => $db]))->db);
        }
    },
    'any CHANGE_ME placeholder is refused' => static function () use ($valid, $reason): void {
        assertSame('placeholder_value', $reason($valid(['origin' => 'https://CHANGE_ME.invalid'])));
        assertSame('placeholder_value', $reason($valid(['log_path' => '/CHANGE_ME/api.log'])));
    },
    'env must be one of production, development, test' => static function () use ($valid, $reason): void {
        foreach (['', 'prod', 'Production', 'staging'] as $env) {
            assertSame('invalid_env', $reason($valid(['env' => $env])), $env);
        }
        assertSame('invalid_env', $reason($valid(['env' => 1])));
        $data = $valid();
        unset($data['env']);
        assertSame('invalid_env', $reason($data));
    },
    'origin must be scheme://host[:port] with no path, slash, user-info or upper case' => static function () use ($valid, $reason): void {
        foreach ([
            'https://finance.example.test/', 'https://finance.example.test/app', 'finance.example.test',
            'https://Finance.example.test', 'https://user@finance.example.test', 'ftp://finance.example.test',
            'https://finance.example.test:99999999', 'https://-bad.test', '*', 'null',
        ] as $origin) {
            assertSame('invalid_origin', $reason($valid(['origin' => $origin])), $origin);
        }
    },
    'production requires an https origin; development may use http' => static function () use ($valid, $reason): void {
        assertSame('production_origin_not_https', $reason($valid(['origin' => 'http://finance.example.test'])));
        assertSame('http://127.0.0.1:8766', ConfigLoader::fromArray($valid(['env' => 'development', 'origin' => 'http://127.0.0.1:8766']))->origin);
    },
    'log path must be absolute and NUL-free' => static function () use ($valid, $reason): void {
        foreach (['logs/api.log', '', "/var/log\0/x"] as $p) {
            assertSame('invalid_log_path', $reason($valid(['log_path' => $p])));
        }
        assertSame('C:\\tamos\\api.log', ConfigLoader::fromArray($valid(['log_path' => 'C:\\tamos\\api.log']))->logPath);
    },
    'body limit must be an int in 1..1048576' => static function () use ($valid, $reason): void {
        foreach ([0, -1, 1048577, '65536', 1.5] as $limit) {
            assertSame('invalid_body_limit', $reason($valid(['body_limit_bytes' => $limit])));
        }
    },
    'a missing file is refused' => static function (): void {
        $e = assertThrows(ConfigError::class, static fn () => ConfigLoader::load(tempDir() . '/none.php', null));
        assertSame('missing', $e->reason);
    },
    'a file that does not return an array is refused' => static function () use ($writeConfig): void {
        $file = $writeConfig(tempDir(), "<?php\nreturn 'x';\n");
        assertSame('not_an_array', assertThrows(ConfigError::class, static fn () => ConfigLoader::load($file, null))->reason);
    },
    'a file that throws while loading is refused without surfacing its error' => static function () use ($writeConfig): void {
        $file = $writeConfig(tempDir(), "<?php\nthrow new RuntimeException('password=hunter2');\n");
        $e = assertThrows(ConfigError::class, static fn () => ConfigLoader::load($file, null));
        assertSame('unloadable', $e->reason);
        assertTrue(!str_contains($e->getMessage(), 'hunter2'), 'no inner message');
    },
    'a config inside the document root is refused' => static function () use ($writeConfig): void {
        $root = tempDir();
        $file = $writeConfig($root, "<?php\nreturn [];\n");
        assertSame('inside_document_root', assertThrows(ConfigError::class, static fn () => ConfigLoader::load($file, $root))->reason);
    },
    'a log inside the document root is refused' => static function () use ($writeConfig, $valid): void {
        $root = tempDir();
        $outside = tempDir();
        $log = var_export($root . DIRECTORY_SEPARATOR . 'api.log', true);
        $file = $writeConfig($outside, "<?php\nreturn ['env' => 'test', 'origin' => 'https://a.test', 'log_path' => " . $log . "];\n");
        assertSame('log_inside_document_root', assertThrows(ConfigError::class, static fn () => ConfigLoader::load($file, $root))->reason);
    },
    'a valid file outside the document root loads' => static function () use ($writeConfig): void {
        $root = tempDir();
        $dir = tempDir();
        $log = var_export($dir . DIRECTORY_SEPARATOR . 'api.log', true);
        $file = $writeConfig($dir, "<?php\nreturn ['env' => 'test', 'origin' => 'https://a.test', 'log_path' => " . $log . "];\n");
        assertSame('test', ConfigLoader::load($file, $root)->env);
    },
    'the tracked example config is refused as-is' => static function (): void {
        $example = dirname(__DIR__, 2) . '/config/config.example.php';
        assertSame('placeholder_value', assertThrows(ConfigError::class, static fn () => ConfigLoader::load($example, null))->reason);
    },
    'TAMOS_CONFIG selects the file; otherwise config/config.local.php under the app root' => static function (): void {
        $previous = getenv('TAMOS_CONFIG');
        putenv('TAMOS_CONFIG=/elsewhere/config.php');
        assertSame('/elsewhere/config.php', ConfigLoader::resolvePath());
        putenv('TAMOS_CONFIG');
        assertTrue(str_ends_with(str_replace('\\', '/', ConfigLoader::resolvePath()), 'server/config/config.local.php'), 'default path');
        if ($previous !== false) {
            putenv('TAMOS_CONFIG=' . $previous);
        }
    },
];
