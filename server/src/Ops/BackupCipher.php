<?php
declare(strict_types=1);

namespace TamOs\Ops;

/**
 * The encrypted backup container (OPS-1, D-AB-9 = A) — the only place libsodium is used.
 *
 * A fresh random file key encrypts the gzip-compressed payload with libsodium's secretstream
 * (XChaCha20-Poly1305), and that file key is sealed (crypto_box_seal) to the configured X25519
 * public key. The host therefore holds only what it needs to encrypt; the matching secret key
 * lives off-host (SDR-0002 §16), and only verify (and, later, OPS-2 restore) opens a backup.
 *
 *   header   "TAMOSBK1" | backup id (25 ASCII) | key fingerprint (8) | sealed file key (80) | stream header (24)
 *   frames   uint32 big-endian ciphertext length | ciphertext — each at most CHUNK plaintext bytes
 *
 * Every frame authenticates the whole header as associated data, so the backup id and the key
 * fingerprint cannot be altered or swapped. Frames cannot be reordered, dropped or duplicated
 * (the stream's internal counter), the last frame carries TAG_FINAL, and nothing may follow it:
 * a truncated, extended or modified file is refused, never partially trusted.
 */
final class BackupCipher
{
    public const MAGIC = 'TAMOSBK1';
    public const ID_LENGTH = 25;
    public const HEADER_LENGTH = 8 + self::ID_LENGTH + 8 + 80 + 24;
    public const CHUNK = 65536;
    public const SECRET_KEY_HEADER = 'TAMOS-BACKUP-SECRET-KEY-V1';
    private const FINGERPRINT_CONTEXT = 'tamos-backup-key-v1';

    private string $buffer = '';
    private int $bytes = 0;
    private bool $finished = false;

    /**
     * @param resource $out
     * @param \DeflateContext $deflate
     */
    private function __construct(
        private readonly mixed $out,
        private string $state,
        private readonly string $header,
        private readonly \DeflateContext $deflate,
        private readonly \HashContext $hash,
    ) {
    }

    /** @throws BackupError crypto_unavailable */
    public static function requireAvailable(): void
    {
        if (!function_exists('sodium_crypto_secretstream_xchacha20poly1305_init_push') || !function_exists('sodium_crypto_box_seal')
            || !function_exists('deflate_init') || !function_exists('inflate_init')) {
            throw new BackupError(BackupError::UNAVAILABLE);
        }
    }

    /** The configured public key: base64 of exactly 32 bytes. @throws BackupError config */
    public static function decodePublicKey(string $encoded): string
    {
        $key = base64_decode($encoded, true);
        if (!is_string($key) || strlen($key) !== 32 || base64_encode($key) !== $encoded) {
            throw new BackupError(BackupError::CONFIG);
        }
        return $key;
    }

    /** A short, non-secret identifier of a public key: 16 hex characters. */
    public static function fingerprint(string $publicKey): string
    {
        return substr(hash('sha256', self::FINGERPRINT_CONTEXT . $publicKey), 0, 16);
    }

    /**
     * A new key pair for keygen, which runs off-host only.
     *
     * @return array{secretKeyFile: string, publicKey: string} the secret key file's contents and the base64 public key
     */
    public static function generateKeyPair(): array
    {
        self::requireAvailable();
        $pair = sodium_crypto_box_keypair();
        $secret = sodium_crypto_box_secretkey($pair);
        $public = sodium_crypto_box_publickey($pair);
        $file = self::SECRET_KEY_HEADER . "\n" . base64_encode($secret) . "\n";
        sodium_memzero($pair);
        sodium_memzero($secret);
        return ['secretKeyFile' => $file, 'publicKey' => base64_encode($public)];
    }

    /** The 32-byte secret key from a key file written by keygen. @throws BackupError key_file */
    public static function readSecretKeyFile(string $path): string
    {
        if (!is_file($path) || is_link($path) || !is_readable($path) || filesize($path) > 256) {
            throw new BackupError(BackupError::KEY_FILE);
        }
        $contents = file_get_contents($path);
        if (!is_string($contents) || preg_match('/^' . self::SECRET_KEY_HEADER . '\n([A-Za-z0-9+\/]{43}=)\n$/D', $contents, $m) !== 1) {
            throw new BackupError(BackupError::KEY_FILE);
        }
        $key = base64_decode($m[1], true);
        if (!is_string($key) || strlen($key) !== 32) {
            throw new BackupError(BackupError::KEY_FILE);
        }
        return $key;
    }

    /** The public key belonging to a secret key. */
    public static function publicKeyOf(string $secretKey): string
    {
        return sodium_crypto_box_publickey_from_secretkey($secretKey);
    }

    /**
     * Starts an encrypted backup on $out: writes the header and returns the writer.
     *
     * @param resource $out
     * @throws BackupError write_failed
     */
    public static function seal(mixed $out, string $backupId, string $publicKey): self
    {
        self::requireAvailable();
        if (strlen($backupId) !== self::ID_LENGTH || strlen($publicKey) !== 32) {
            throw new \LogicException('a backup is sealed under its id to a 32-byte public key');
        }
        $fileKey = sodium_crypto_secretstream_xchacha20poly1305_keygen();
        $sealed = sodium_crypto_box_seal($fileKey, $publicKey);
        [$state, $streamHeader] = sodium_crypto_secretstream_xchacha20poly1305_init_push($fileKey);
        sodium_memzero($fileKey);
        $header = self::MAGIC . $backupId . hex2bin(self::fingerprint($publicKey)) . $sealed . $streamHeader;
        if (strlen($header) !== self::HEADER_LENGTH) {
            throw new \LogicException('backup header length');
        }
        $deflate = deflate_init(ZLIB_ENCODING_GZIP, ['level' => 6]);
        if ($deflate === false) {
            throw new BackupError(BackupError::UNAVAILABLE);
        }
        $writer = new self($out, $state, $header, $deflate, hash_init('sha256'));
        $writer->emit($header);
        return $writer;
    }

    /** Compresses and encrypts the next part of the payload. @throws BackupError write_failed */
    public function write(string $plaintext): void
    {
        if ($this->finished) {
            throw new \LogicException('the backup stream is finished');
        }
        $this->buffer .= deflate_add($this->deflate, $plaintext, ZLIB_NO_FLUSH);
        while (strlen($this->buffer) >= self::CHUNK) {
            $this->frame(substr($this->buffer, 0, self::CHUNK), SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_MESSAGE);
            $this->buffer = substr($this->buffer, self::CHUNK);
        }
    }

    /**
     * Ends the stream with the authenticated final frame.
     *
     * @return array{bytes: int, sha256: string} the ciphertext size and SHA-256, as written
     * @throws BackupError write_failed
     */
    public function finish(): array
    {
        $this->buffer .= deflate_add($this->deflate, '', ZLIB_FINISH);
        while (strlen($this->buffer) > self::CHUNK) {
            $this->frame(substr($this->buffer, 0, self::CHUNK), SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_MESSAGE);
            $this->buffer = substr($this->buffer, self::CHUNK);
        }
        $this->frame($this->buffer, SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL);
        $this->buffer = '';
        $this->finished = true;
        sodium_memzero($this->state);
        return ['bytes' => $this->bytes, 'sha256' => hash_final($this->hash)];
    }

    /**
     * The clear header of a backup, without any key: its id and key fingerprint. Used by status
     * and before verify opens anything.
     *
     * @param resource $in
     * @return array{backupId: string, keyFingerprint: string}
     * @throws BackupError malformed
     */
    public static function readHeader(mixed $in): array
    {
        $header = self::readExactly($in, self::HEADER_LENGTH);
        if ($header === null || !str_starts_with($header, self::MAGIC)) {
            throw new BackupError(BackupError::MALFORMED);
        }
        $backupId = substr($header, 8, self::ID_LENGTH);
        if (!BackupStore::isBackupId($backupId)) {
            throw new BackupError(BackupError::MALFORMED);
        }
        return ['backupId' => $backupId, 'keyFingerprint' => bin2hex(substr($header, 8 + self::ID_LENGTH, 8))];
    }

    /**
     * Decrypts and decompresses a whole backup, handing the plaintext to $sink part by part. Throws
     * before the end on any defect, so a caller must treat what it received as unverified until
     * this returns.
     *
     * @param resource $in positioned at the start of the file
     * @param \Closure(string): void $sink
     * @return array{backupId: string, keyFingerprint: string}
     * @throws BackupError malformed | wrong_key | truncated | tampered
     */
    public static function open(mixed $in, string $secretKey, \Closure $sink): array
    {
        self::requireAvailable();
        $header = self::readExactly($in, self::HEADER_LENGTH);
        if ($header === null || !str_starts_with($header, self::MAGIC) || !BackupStore::isBackupId(substr($header, 8, self::ID_LENGTH))) {
            throw new BackupError(BackupError::MALFORMED);
        }
        $publicKey = self::publicKeyOf($secretKey);
        $fingerprint = bin2hex(substr($header, 8 + self::ID_LENGTH, 8));
        if (!hash_equals(self::fingerprint($publicKey), $fingerprint)) {
            throw new BackupError(BackupError::WRONG_KEY);
        }
        $pair = sodium_crypto_box_keypair_from_secretkey_and_publickey($secretKey, $publicKey);
        $fileKey = sodium_crypto_box_seal_open(substr($header, 8 + self::ID_LENGTH + 8, 80), $pair);
        sodium_memzero($pair);
        if (!is_string($fileKey) || strlen($fileKey) !== SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_KEYBYTES) {
            throw new BackupError(BackupError::WRONG_KEY);
        }
        try {
            $state = sodium_crypto_secretstream_xchacha20poly1305_init_pull(substr($header, self::HEADER_LENGTH - 24), $fileKey);
        } catch (\Throwable) {
            throw new BackupError(BackupError::MALFORMED);
        } finally {
            sodium_memzero($fileKey);
        }
        $inflate = inflate_init(ZLIB_ENCODING_GZIP);
        if ($inflate === false) {
            throw new BackupError(BackupError::UNAVAILABLE);
        }
        while (true) {
            $length = self::readExactly($in, 4);
            if ($length === null) {
                throw new BackupError(BackupError::TRUNCATED);
            }
            $n = unpack('N', $length)[1];
            if ($n < SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_ABYTES || $n > self::CHUNK + SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_ABYTES) {
                throw new BackupError(BackupError::MALFORMED);
            }
            $ciphertext = self::readExactly($in, $n);
            if ($ciphertext === null) {
                throw new BackupError(BackupError::TRUNCATED);
            }
            $pulled = sodium_crypto_secretstream_xchacha20poly1305_pull($state, $ciphertext, $header);
            if (!is_array($pulled)) {
                throw new BackupError(BackupError::TAMPERED);
            }
            [$compressed, $tag] = $pulled;
            if ($tag !== SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_MESSAGE && $tag !== SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL) {
                throw new BackupError(BackupError::MALFORMED);
            }
            try {
                $plain = inflate_add($inflate, $compressed, $tag === SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL ? ZLIB_FINISH : ZLIB_SYNC_FLUSH);
            } catch (\Throwable) {
                throw new BackupError(BackupError::MALFORMED);
            }
            if (!is_string($plain)) {
                throw new BackupError(BackupError::MALFORMED);
            }
            if ($plain !== '') {
                $sink($plain);
            }
            if ($tag === SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL) {
                break;
            }
        }
        sodium_memzero($state);
        if (inflate_get_status($inflate) !== ZLIB_STREAM_END) {
            throw new BackupError(BackupError::MALFORMED);
        }
        if (fread($in, 1) !== '' || !feof($in)) {
            throw new BackupError(BackupError::TRUNCATED);
        }
        return ['backupId' => substr($header, 8, self::ID_LENGTH), 'keyFingerprint' => $fingerprint];
    }

    private function frame(string $message, int $tag): void
    {
        $ciphertext = sodium_crypto_secretstream_xchacha20poly1305_push($this->state, $message, $this->header, $tag);
        $this->emit(pack('N', strlen($ciphertext)) . $ciphertext);
    }

    private function emit(string $bytes): void
    {
        $written = fwrite($this->out, $bytes);
        if ($written !== strlen($bytes)) {
            throw new BackupError(BackupError::WRITE_FAILED);
        }
        hash_update($this->hash, $bytes);
        $this->bytes += $written;
    }

    /**
     * Exactly $n bytes, or null at a clean or partial end of file.
     *
     * @param resource $in
     */
    private static function readExactly(mixed $in, int $n): ?string
    {
        $out = '';
        while (strlen($out) < $n) {
            $part = fread($in, $n - strlen($out));
            if (!is_string($part) || $part === '') {
                return null;
            }
            $out .= $part;
        }
        return $out;
    }
}
