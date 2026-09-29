<?php
declare(strict_types=1);

namespace TamOs\Data;

use TamOs\Config\Config;

/**
 * The validated `db` configuration section, and the only place a PDO connection is opened.
 *
 * It is validated only when the database is first needed, so a missing or malformed section
 * never stops the API from booting or /api/health from answering. The password never leaves
 * this class: it is #[\SensitiveParameter] in every signature, masked in __debugInfo, and
 * handed to PDO directly.
 */
final class DatabaseConfig
{
    public const CONNECT_TIMEOUT_SECONDS = 5;
    public const INIT_COMMAND = "SET time_zone='+00:00', sql_mode='STRICT_ALL_TABLES,ONLY_FULL_GROUP_BY,NO_ENGINE_SUBSTITUTION,ERROR_FOR_DIVISION_BY_ZERO'";
    private const KEYS = ['host', 'port', 'name', 'user', 'pass'];

    private function __construct(
        public readonly string $host,
        public readonly int $port,
        public readonly string $name,
        public readonly string $user,
        #[\SensitiveParameter] private readonly string $pass,
    ) {
    }

    /** @throws DatabaseError unavailable (operation "config") when the section is absent or invalid */
    public static function fromConfig(Config $config): self
    {
        return self::fromArray($config->db);
    }

    /** @throws DatabaseError unavailable (operation "config") */
    public static function fromArray(#[\SensitiveParameter] mixed $raw): self
    {
        if (!is_array($raw)) {
            throw DatabaseError::unavailable('config');
        }
        $keys = array_keys($raw);
        sort($keys);
        $expected = self::KEYS;
        sort($expected);
        if ($keys !== $expected) {
            throw DatabaseError::unavailable('config');
        }
        foreach ($raw as $value) {
            if (is_string($value) && (str_contains($value, 'CHANGE_ME') || str_contains($value, "\0"))) {
                throw DatabaseError::unavailable('config');
            }
        }
        ['host' => $host, 'port' => $port, 'name' => $name, 'user' => $user, 'pass' => $pass] = $raw;
        $valid = is_string($host) && preg_match('/^[A-Za-z0-9.:-]{1,253}$/', $host) === 1
            && is_int($port) && $port >= 1 && $port <= 65535
            && is_string($name) && preg_match('/^[A-Za-z0-9_]{1,64}$/', $name) === 1
            && is_string($user) && $user !== '' && strlen($user) <= 80
            && is_string($pass);
        if (!$valid) {
            throw DatabaseError::unavailable('config');
        }
        return new self($host, $port, $name, $user, $pass);
    }

    public function dsn(): string
    {
        return sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $this->host, $this->port, $this->name);
    }

    /** @throws DatabaseError unavailable (operation "connect") */
    public function connect(): \PDO
    {
        if (!extension_loaded('pdo_mysql')) {
            throw DatabaseError::unavailable('connect');
        }
        try {
            return new \PDO($this->dsn(), $this->user, $this->pass, [
                \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
                \PDO::ATTR_EMULATE_PREPARES => false,
                \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
                \PDO::ATTR_PERSISTENT => false,
                \PDO::ATTR_TIMEOUT => self::CONNECT_TIMEOUT_SECONDS,
                \PDO::MYSQL_ATTR_MULTI_STATEMENTS => false,
                \PDO::MYSQL_ATTR_INIT_COMMAND => self::INIT_COMMAND,
            ]);
        } catch (\PDOException $e) {
            throw DatabaseError::fromConnect($e);
        }
    }

    /** @return array<string, mixed> */
    public function __debugInfo(): array
    {
        return ['host' => $this->host, 'port' => $this->port, 'name' => $this->name, 'user' => $this->user, 'pass' => '[REDACTED]'];
    }
}
