<?php
declare(strict_types=1);

namespace TamOs\Data;

/**
 * A database failure, classified and stripped of every driver message.
 *
 * The PDO message is never kept or chained: connect errors name the user and host, and
 * statement errors can quote SQL or row values. Only the kind, the operation and the
 * SQLSTATE / driver code survive, which is all the kernel needs to answer and log.
 *
 *   unavailable  the database cannot be reached or is not configured      → 503
 *   transient    deadlock (1213) or lock-wait timeout (1205); retry later  → 503
 *   failure      anything else                                             → 500
 */
final class DatabaseError extends \RuntimeException
{
    public const UNAVAILABLE = 'unavailable';
    public const TRANSIENT = 'transient';
    public const FAILURE = 'failure';

    private const TRANSIENT_CODES = [1205, 1213];
    // Server gone away / lost connection / cannot connect / too many connections.
    private const UNAVAILABLE_CODES = [1040, 2002, 2003, 2006, 2013];

    public function __construct(
        public readonly string $kind,
        public readonly string $operation,
        public readonly ?string $sqlstate = null,
        public readonly ?int $driverCode = null,
    ) {
        parent::__construct('database ' . $kind . ' during ' . $operation);
    }

    public static function unavailable(string $operation): self
    {
        return new self(self::UNAVAILABLE, $operation);
    }

    /** Classifies a PDOException raised by a statement, keeping only its codes. */
    public static function fromPdo(\PDOException $e, string $operation): self
    {
        [$sqlstate, $driverCode] = self::codes($e);
        $kind = match (true) {
            in_array($driverCode, self::TRANSIENT_CODES, true) => self::TRANSIENT,
            in_array($driverCode, self::UNAVAILABLE_CODES, true) => self::UNAVAILABLE,
            default => self::FAILURE,
        };
        return new self($kind, $operation, $sqlstate, $driverCode);
    }

    /** A failure to open the connection is always "unavailable", whatever the code says. */
    public static function fromConnect(\PDOException $e): self
    {
        [$sqlstate, $driverCode] = self::codes($e);
        return new self(self::UNAVAILABLE, 'connect', $sqlstate, $driverCode);
    }

    /** @return array{0: ?string, 1: ?int} */
    private static function codes(\PDOException $e): array
    {
        $info = $e->errorInfo;
        if (is_array($info) && isset($info[0]) && is_string($info[0])) {
            $sqlstate = preg_match('/^[0-9A-Z]{5}$/', $info[0]) === 1 ? $info[0] : null;
            $driver = isset($info[1]) && is_int($info[1]) ? $info[1] : null;
            return [$sqlstate, $driver];
        }
        // Connect failures carry no errorInfo; read the codes from the message shape
        // "SQLSTATE[HY000] [2002] …" and discard the rest of it.
        $message = $e->getMessage();
        $sqlstate = preg_match('/^SQLSTATE\[([0-9A-Z]{5})\]/', $message, $m) === 1 ? $m[1] : null;
        $driver = preg_match('/^SQLSTATE\[[0-9A-Z]{5}\] \[([0-9]{1,5})\]/', $message, $n) === 1 ? (int) $n[1] : null;
        return [$sqlstate, $driver];
    }
}
