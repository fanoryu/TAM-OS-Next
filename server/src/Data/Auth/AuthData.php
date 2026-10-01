<?php
declare(strict_types=1);

namespace TamOs\Data\Auth;

use TamOs\Config\Config;
use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Data\DatabaseError;

/**
 * The authentication data access point: one lazily opened, request-scoped Database shared by
 * the auth stores, atomically() for the transaction boundaries the Authenticator and the
 * account lifecycle own, and the account advisory lock the operator CLI serializes on.
 * Nothing is validated or connected until a store is first used, so constructing it never
 * makes /api/health (or anything else) depend on the database.
 */
final class AuthData
{
    private ?Database $db = null;
    private ?AccountStore $accounts = null;
    private ?SessionStore $sessions = null;
    private ?RateLimiter $rateLimits = null;
    private ?AuthEvents $events = null;
    private ?AccountTokenStore $tokens = null;
    private ?MailOutboxStore $outbox = null;

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

    public function tokens(): AccountTokenStore
    {
        return $this->tokens ??= new AccountTokenStore($this->db());
    }

    public function outbox(): MailOutboxStore
    {
        return $this->outbox ??= new MailOutboxStore($this->db());
    }

    /**
     * BF-4a1: this request's lazy connection, for the business data access point
     * (TamOs\Data\BusinessData), so a request resolves its session and runs its business
     * statements on ONE connection. Calling the closure connects; obtaining it does not.
     *
     * @return \Closure(): Database
     */
    public function connector(): \Closure
    {
        return fn (): Database => $this->db();
    }

    /**
     * BF-3D: the server-wide advisory lock 'tamos_mail', taken without waiting, so one outbox
     * worker runs at a time (a cron run that overlaps the previous one exits). Same semantics as
     * acquireAccountLock().
     *
     * @throws DatabaseError on a lock error (NULL) or a database failure
     */
    public function acquireMailLock(): bool
    {
        $result = $this->db()->select("SELECT GET_LOCK('tamos_mail', 0) AS acquired")[0]['acquired'] ?? null;
        if ($result === null) {
            throw new DatabaseError(DatabaseError::FAILURE, 'lock');
        }
        return (int) $result === 1;
    }

    /** Best effort: the lock dies with the (non-persistent) connection anyway. */
    public function releaseMailLock(): void
    {
        try {
            $this->db()->select("SELECT RELEASE_LOCK('tamos_mail') AS released");
        } catch (DatabaseError) {
            // Released when the connection closes.
        }
    }

    /**
     * Takes the server-wide advisory lock 'tamos_account' on this connection without waiting:
     * true when acquired, false when another session holds it. It serializes every operator
     * account command (bootstrap, reset); an InnoDB locking read on an empty table would not
     * (gap locks do not conflict, and READ COMMITTED takes none). A transaction never releases
     * it — releaseAccountLock() does, and so does closing the connection.
     *
     * @throws DatabaseError on a lock error (NULL) or a database failure
     */
    public function acquireAccountLock(): bool
    {
        $result = $this->db()->select("SELECT GET_LOCK('tamos_account', 0) AS acquired")[0]['acquired'] ?? null;
        if ($result === null) {
            throw new DatabaseError(DatabaseError::FAILURE, 'lock');
        }
        return (int) $result === 1;
    }

    /** Best effort: the lock dies with the (non-persistent) connection anyway. */
    public function releaseAccountLock(): void
    {
        try {
            $this->db()->select("SELECT RELEASE_LOCK('tamos_account') AS released");
        } catch (DatabaseError) {
            // Released when the connection closes.
        }
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
