<?php
declare(strict_types=1);

namespace TamOs\Data\Auth;

use TamOs\Config\Config;
use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;

/**
 * The authentication data access point: one lazily opened, request-scoped Database shared by
 * the four auth stores, and atomically() for the transaction boundaries the Authenticator
 * owns. Nothing is validated or connected until a store is first used, so constructing it
 * never makes /api/health (or anything else) depend on the database.
 */
final class AuthData
{
    private ?Database $db = null;
    private ?AccountStore $accounts = null;
    private ?SessionStore $sessions = null;
    private ?RateLimiter $rateLimits = null;
    private ?AuthEvents $events = null;

    /** @param \Closure(): Database $connect */
    private function __construct(private readonly \Closure $connect)
    {
    }

    public static function fromConfig(Config $config): self
    {
        return new self(static fn (): Database => new Database(DatabaseConfig::fromConfig($config)));
    }

    /** For the guarded database tests, which share their connection with the fixtures. */
    public static function fromDatabase(Database $db): self
    {
        return new self(static fn (): Database => $db);
    }

    public function accounts(): AccountStore
    {
        return $this->accounts ??= new AccountStore($this->db());
    }

    public function sessions(): SessionStore
    {
        return $this->sessions ??= new SessionStore($this->db());
    }

    public function rateLimits(): RateLimiter
    {
        return $this->rateLimits ??= new RateLimiter($this->db());
    }

    public function events(): AuthEvents
    {
        return $this->events ??= new AuthEvents($this->db());
    }

    /**
     * Runs $fn in one database transaction: every store write inside commits together or not
     * at all. Nested calls are refused (Database::transaction).
     *
     * @template T
     * @param \Closure(): T $fn
     * @return T
     */
    public function atomically(\Closure $fn): mixed
    {
        return $this->db()->transaction(static fn (): mixed => $fn());
    }

    private function db(): Database
    {
        return $this->db ??= ($this->connect)();
    }
}
