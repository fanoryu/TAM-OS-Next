<?php
declare(strict_types=1);

namespace TamOs\Data;

/**
 * The request-scoped database handle: one lazy, non-persistent connection, opened on first
 * use and never by /api/health.
 *
 * Every statement is prepared and executed with bound parameters; there is no raw query or
 * exec path. Parameters are either a positional list or, for the scoped data layer (BF-3C), a
 * map of lower-case names to :name placeholders — never a mix — and are limited to int, string,
 * bool and null; floats are refused so money never passes through binary floating point. Named
 * placeholders are bound by PDO under native (non-emulated) prepares, so each name appears once
 * in a statement.
 *
 * transaction() runs its callback exactly once: nested transactions are refused, any
 * throwable rolls back, and nothing is retried. By default it runs at the server's isolation level
 * (REPEATABLE READ); BF-4c1's payroll generate asks for READ COMMITTED for that one transaction,
 * so each of its plain reads sees what committed before it — after the row locks it has taken —
 * without locking secondary-index ranges.
 */
final class Database
{
    public const READ_COMMITTED_SQL = 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED';
    public const SNAPSHOT_SQL = 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY';

    private ?\PDO $pdo = null;
    private bool $inTransaction = false;

    public function __construct(private readonly DatabaseConfig $config)
    {
    }

    /**
     * @param array<int|string, int|string|bool|null> $params
     * @return list<array<string, mixed>>
     * @throws DatabaseError
     */
    public function select(string $sql, array $params = []): array
    {
        $statement = $this->run($sql, $params, 'select');
        try {
            return $statement->fetchAll();
        } catch (\PDOException $e) {
            throw DatabaseError::fromPdo($e, 'select');
        }
    }

    /**
     * @param array<int|string, int|string|bool|null> $params
     * @return int the affected row count
     * @throws DatabaseError
     */
    public function execute(string $sql, array $params = []): int
    {
        return $this->run($sql, $params, 'execute')->rowCount();
    }

    /**
     * @template T
     * @param callable(Database): T $fn
     * @return T
     * @throws DatabaseError|\Throwable the callback's own throwable is rethrown unchanged
     */
    public function transaction(callable $fn, bool $readCommitted = false): mixed
    {
        if ($this->inTransaction) {
            throw new \LogicException('nested database transaction');
        }
        $pdo = $this->pdo();
        if ($readCommitted) {
            $this->run(self::READ_COMMITTED_SQL, [], 'begin');    // applies to the next transaction only
        }
        try {
            $pdo->beginTransaction();
        } catch (\PDOException $e) {
            throw DatabaseError::fromPdo($e, 'begin');
        }
        $this->inTransaction = true;
        try {
            $result = $fn($this);
            try {
                $pdo->commit();
            } catch (\PDOException $e) {
                throw DatabaseError::fromPdo($e, 'commit');
            }
            return $result;
        } catch (\Throwable $e) {
            $this->rollBackQuietly($pdo);
            throw $e;
        } finally {
            $this->inTransaction = false;
        }
    }

    /**
     * OPS-1: runs $fn in one read-only REPEATABLE READ transaction, so every InnoDB read inside it
     * sees the one snapshot taken at its first read, whatever commits meanwhile. Any write inside
     * is refused by the server; nested transactions are refused here.
     *
     * @template T
     * @param callable(Database): T $fn
     * @return T
     */
    public function snapshot(callable $fn): mixed
    {
        if ($this->inTransaction) {
            throw new \LogicException('nested database transaction');
        }
        $this->run(self::SNAPSHOT_SQL, [], 'begin');    // applies to the next transaction only
        return $this->transaction($fn);
    }

    /** @param array<int|string, int|string|bool|null> $params */
    private function run(string $sql, array $params, string $operation): \PDOStatement
    {
        $named = !array_is_list($params);
        if ($named) {
            foreach (array_keys($params) as $name) {
                if (!is_string($name) || preg_match('/^[a-z][a-z0-9_]{0,63}$/', $name) !== 1) {
                    throw new \LogicException('database parameters must be a positional list or a map of lower-case names');
                }
            }
        }
        foreach ($params as $value) {
            if (!is_int($value) && !is_string($value) && !is_bool($value) && $value !== null) {
                throw new \LogicException('database parameters must be int, string, bool or null');
            }
        }
        $pdo = $this->pdo();
        try {
            $statement = $pdo->prepare($sql);
            foreach ($params as $key => $value) {
                $statement->bindValue($named ? ':' . $key : $key + 1, $value, match (true) {
                    is_int($value) => \PDO::PARAM_INT,
                    is_bool($value) => \PDO::PARAM_BOOL,
                    $value === null => \PDO::PARAM_NULL,
                    default => \PDO::PARAM_STR,
                });
            }
            $statement->execute();
            return $statement;
        } catch (\PDOException $e) {
            throw DatabaseError::fromPdo($e, $operation);
        }
    }

    private function pdo(): \PDO
    {
        return $this->pdo ??= $this->config->connect();
    }

    /** A failed rollback must not mask the original error; it is logged by code only. */
    private function rollBackQuietly(\PDO $pdo): void
    {
        try {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
        } catch (\Throwable $e) {
            $error = $e instanceof \PDOException ? DatabaseError::fromPdo($e, 'rollback') : null;
            error_log('tamos: database rollback failed (' . ($error?->sqlstate ?? '-') . '/' . ($error?->driverCode ?? '-') . ')');
        }
    }
}
