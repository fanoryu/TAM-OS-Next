<?php
declare(strict_types=1);

namespace TamOs\Data;

/**
 * The request-scoped database handle: one lazy, non-persistent connection, opened on first
 * use and never by /api/health.
 *
 * Every statement is prepared and executed with bound parameters; there is no raw query or
 * exec path. Parameters are positional and limited to int, string, bool and null — floats
 * are refused so money never passes through binary floating point.
 *
 * transaction() runs its callback exactly once: nested transactions are refused, any
 * throwable rolls back, and nothing is retried.
 */
final class Database
{
    private ?\PDO $pdo = null;
    private bool $inTransaction = false;

    public function __construct(private readonly DatabaseConfig $config)
    {
    }

    /**
     * @param list<int|string|bool|null> $params
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
     * @param list<int|string|bool|null> $params
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
    public function transaction(callable $fn): mixed
    {
        if ($this->inTransaction) {
            throw new \LogicException('nested database transaction');
        }
        $pdo = $this->pdo();
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

    /** @param list<int|string|bool|null> $params */
    private function run(string $sql, array $params, string $operation): \PDOStatement
    {
        if (!array_is_list($params)) {
            throw new \LogicException('database parameters must be a positional list');
        }
        foreach ($params as $value) {
            if (!is_int($value) && !is_string($value) && !is_bool($value) && $value !== null) {
                throw new \LogicException('database parameters must be int, string, bool or null');
            }
        }
        $pdo = $this->pdo();
        try {
            $statement = $pdo->prepare($sql);
            foreach ($params as $i => $value) {
                $statement->bindValue($i + 1, $value, match (true) {
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
