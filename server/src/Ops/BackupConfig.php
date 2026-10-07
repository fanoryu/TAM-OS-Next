<?php
declare(strict_types=1);

namespace TamOs\Ops;

use TamOs\Config\Config;

/**
 * The validated `backup` section of the configuration file (OPS-1, D-AB-6/8/9): exactly `dir` —
 * the absolute host directory the nightly encrypted backups are written to, outside the public web
 * root and outside the application — and `public_key`, the base64 X25519 public key the backups
 * are sealed to. The matching secret key never exists on the host (SDR-0002 §16): the host can
 * encrypt a backup but never read one. The public key is not a secret.
 *
 * Validated only when server/bin/backup.php needs it, so a missing or broken section never
 * affects the API (ConfigLoader checks only that `dir` is not inside a known document root).
 */
final class BackupConfig
{
    private const KEYS = ['dir', 'public_key'];

    private function __construct(
        public readonly string $dir,
        public readonly string $publicKey,
    ) {
    }

    /** @throws BackupError config */
    public static function fromConfig(Config $config): self
    {
        $backup = $config->backup;
        if (!is_array($backup) || array_keys($backup) !== self::KEYS) {
            throw new BackupError(BackupError::CONFIG);
        }
        foreach ($backup as $value) {
            if (!is_string($value) || str_contains($value, 'CHANGE_ME') || str_contains($value, "\0")) {
                throw new BackupError(BackupError::CONFIG);
            }
        }
        if (!self::isAbsolute($backup['dir'])) {
            throw new BackupError(BackupError::CONFIG);
        }
        return new self($backup['dir'], BackupCipher::decodePublicKey($backup['public_key']));
    }

    public static function isAbsolute(string $path): bool
    {
        return str_starts_with($path, '/') || preg_match('#^[A-Za-z]:[\\\\/]#', $path) === 1;
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return ['dir' => '[CONFIGURED]', 'publicKey' => BackupCipher::fingerprint($this->publicKey)];
    }
}
