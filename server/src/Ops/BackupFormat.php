<?php
declare(strict_types=1);

namespace TamOs\Ops;

/**
 * The backup payload (OPS-1): the plaintext that BackupCipher compresses and encrypts. It is
 * newline-delimited canonical JSON, written front to back from one consistent snapshot:
 *
 *   {"format":"tamos-backup","formatVersion":1,"backupId":"…"}
 *   {"table":"companies","columns":["id",…],"decimals":{}}       one header per table,
 *   ["…",…]                                                       its rows in primary-key order,
 *   {"end":"companies","rows":N}                                  and its end marker
 *   …
 *   {"manifest":{…}}                                              the manifest, always last
 *
 * A row is a JSON array of the table's column values in column order: an int, a string (DECIMAL,
 * DATE and DATETIME values are the database's exact text) or null — never a float. Encoding is
 * canonical (one byte form per value set), so the same database content always produces the same
 * table lines, and each table's SHA-256 is taken over its row lines exactly as written.
 *
 * The manifest records, per table: columns, a digest of the column definitions, the row count, the
 * largest id, the row digest and exact totals of every DECIMAL column (the money reconciliation);
 * plus the excluded and not-yet-created tables, the applied migration history, the key fingerprint
 * and a non-secret fingerprint of the source database. It holds no row value, path or credential.
 */
final class BackupFormat
{
    public const FORMAT = 'tamos-backup';
    public const VERSION = 1;
    public const JSON_FLAGS = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR;
    public const MAX_LINE_BYTES = 16777216;

    /** @var array<string, mixed>|null the table being written */
    private ?array $table = null;
    /** @var list<array<string, mixed>> the finished tables' manifest entries */
    private array $tables = [];
    private bool $begun = false;
    private bool $done = false;

    /** @param \Closure(string): void $emit receives the payload, line by line */
    public function __construct(private readonly \Closure $emit)
    {
    }

    /** The canonical encoding of one JSON line (without its newline). */
    public static function encode(mixed $value): string
    {
        try {
            return json_encode($value, self::JSON_FLAGS);
        } catch (\JsonException) {
            throw new BackupError(BackupError::UNSUPPORTED_VALUE);
        }
    }

    public function begin(string $backupId): void
    {
        if ($this->begun) {
            throw new \LogicException('the payload has begun');
        }
        $this->begun = true;
        $this->line(['format' => self::FORMAT, 'formatVersion' => self::VERSION, 'backupId' => $backupId]);
    }

    /**
     * @param list<string> $columns in table order; the first is the primary key `id`
     * @param array<string, int> $decimals DECIMAL column => scale
     */
    public function beginTable(string $name, array $columns, array $decimals, string $columnsSha256): void
    {
        if (!$this->begun || $this->done || $this->table !== null || ($columns[0] ?? null) !== 'id') {
            throw new \LogicException('a table starts after begin, one at a time, with its id column first');
        }
        foreach (array_keys($decimals) as $column) {
            if (!in_array($column, $columns, true)) {
                throw new \LogicException('a decimal column is one of the table columns');
            }
        }
        $totals = [];
        foreach ($decimals as $column => $scale) {
            $totals[$column] = self::decimalZero($scale);
        }
        $this->table = ['name' => $name, 'columns' => $columns, 'decimals' => $decimals, 'columnsSha256' => $columnsSha256,
            'rows' => 0, 'maxId' => null, 'hash' => hash_init('sha256'), 'totals' => $totals];
        $this->line(['table' => $name, 'columns' => $columns, 'decimals' => (object) $decimals]);
    }

    /**
     * One row, as the database returned it (column => value, in column order).
     *
     * @param array<string, mixed> $row
     * @throws BackupError unsupported_value | snapshot_inconsistent
     */
    public function row(array $row): void
    {
        $t = $this->table ?? throw new \LogicException('a row belongs to a table');
        if (array_keys($row) !== $t['columns']) {
            throw new BackupError(BackupError::UNEXPECTED_SCHEMA);
        }
        $values = array_values($row);
        foreach ($values as $value) {
            if (!is_int($value) && !is_string($value) && $value !== null) {
                throw new BackupError(BackupError::UNSUPPORTED_VALUE);
            }
        }
        if ($t['maxId'] !== null && self::compareIds($values[0], $t['maxId']) <= 0) {
            throw new BackupError(BackupError::SNAPSHOT_INCONSISTENT);    // ids strictly ascending
        }
        foreach ($t['decimals'] as $column => $scale) {
            $value = $row[$column];
            if ($value !== null) {
                if (!is_string($value) || !self::isDecimal($value, $scale)) {
                    throw new BackupError(BackupError::UNSUPPORTED_VALUE);
                }
                $this->table['totals'][$column] = self::decimalAdd($this->table['totals'][$column], $value, $scale);
            }
        }
        $line = self::encode($values);
        hash_update($this->table['hash'], $line . "\n");
        $this->table['rows']++;
        $this->table['maxId'] = $values[0];
        ($this->emit)($line . "\n");
    }

    /** @return int the table's row count */
    public function endTable(): int
    {
        $t = $this->table ?? throw new \LogicException('no table to end');
        $this->line(['end' => $t['name'], 'rows' => $t['rows']]);
        $this->tables[] = [
            'name' => $t['name'],
            'columns' => $t['columns'],
            'columnsSha256' => $t['columnsSha256'],
            'rows' => $t['rows'],
            'maxId' => $t['maxId'],
            'sha256' => hash_final($t['hash']),
            'decimalTotals' => (object) $t['totals'],
        ];
        $this->table = null;
        return $t['rows'];
    }

    /**
     * Writes the manifest — the payload's last line — and returns it.
     *
     * @param array<string, mixed> $meta backupId, snapshotAt, keyFingerprint, source, schema, excludedTables, absentTables
     * @return array<string, mixed>
     */
    public function finish(array $meta): array
    {
        if (!$this->begun || $this->done || $this->table !== null) {
            throw new \LogicException('the manifest closes a payload whose tables are all ended');
        }
        $manifest = [
            'format' => self::FORMAT,
            'formatVersion' => self::VERSION,
            'backupId' => $meta['backupId'],
            'snapshotAt' => $meta['snapshotAt'],
            'keyFingerprint' => $meta['keyFingerprint'],
            'source' => $meta['source'],
            'schema' => $meta['schema'],
            'excludedTables' => $meta['excludedTables'],
            'absentTables' => $meta['absentTables'],
            'tables' => $this->tables,
        ];
        $this->line(['manifest' => $manifest]);
        $this->done = true;
        return $manifest;
    }

    /** SHA-256 of a table's column definitions: [[name, column type, nullable], …] in table order. */
    public static function columnsSha256(array $definitions): string
    {
        return hash('sha256', self::encode($definitions));
    }

    /** Ids ascend as ints (BIGINT) or as bytes (ascii_bin CHAR / VARCHAR). */
    public static function compareIds(mixed $a, mixed $b): int
    {
        if (is_int($a) && is_int($b)) {
            return $a <=> $b;
        }
        if (is_string($a) && is_string($b)) {
            return strcmp($a, $b) <=> 0;
        }
        throw new BackupError(BackupError::UNSUPPORTED_VALUE);
    }

    public static function isDecimal(string $value, int $scale): bool
    {
        $pattern = $scale === 0 ? '/^-?(0|[1-9][0-9]*)$/D' : '/^-?(0|[1-9][0-9]*)\.[0-9]{' . $scale . '}$/D';
        return preg_match($pattern, $value) === 1;
    }

    public static function decimalZero(int $scale): string
    {
        return $scale === 0 ? '0' : '0.' . str_repeat('0', $scale);
    }

    /**
     * Exact sum of two DECIMAL texts of the same scale — integer digit arithmetic, never a float,
     * so a money total is reproduced to the last digit.
     */
    public static function decimalAdd(string $a, string $b, int $scale): string
    {
        if (!self::isDecimal($a, $scale) || !self::isDecimal($b, $scale)) {
            throw new \LogicException('decimal operands share the column scale');
        }
        [$na, $da] = self::digits($a);
        [$nb, $db] = self::digits($b);
        if ($na === $nb) {
            [$neg, $digits] = [$na, self::addDigits($da, $db)];
        } elseif (self::compareDigits($da, $db) >= 0) {
            [$neg, $digits] = [$na, self::subtractDigits($da, $db)];
        } else {
            [$neg, $digits] = [$nb, self::subtractDigits($db, $da)];
        }
        $digits = str_pad($digits, $scale + 1, '0', STR_PAD_LEFT);
        $text = $scale === 0 ? $digits : substr($digits, 0, -$scale) . '.' . substr($digits, -$scale);
        return $neg && trim($digits, '0') !== '' ? '-' . $text : $text;
    }

    /** @return array{0: bool, 1: string} the sign and the scaled integer digits without leading zeros */
    private static function digits(string $value): array
    {
        $neg = str_starts_with($value, '-');
        $digits = ltrim(str_replace('.', '', ltrim($value, '-')), '0');
        return [$neg, $digits === '' ? '0' : $digits];
    }

    private static function compareDigits(string $a, string $b): int
    {
        return strlen($a) !== strlen($b) ? strlen($a) <=> strlen($b) : strcmp($a, $b) <=> 0;
    }

    private static function addDigits(string $a, string $b): string
    {
        $out = '';
        $carry = 0;
        for ($i = strlen($a) - 1, $j = strlen($b) - 1; $i >= 0 || $j >= 0 || $carry > 0; $i--, $j--) {
            $sum = ($i >= 0 ? (int) $a[$i] : 0) + ($j >= 0 ? (int) $b[$j] : 0) + $carry;
            $out = (string) ($sum % 10) . $out;
            $carry = intdiv($sum, 10);
        }
        return ltrim($out, '0') === '' ? '0' : ltrim($out, '0');
    }

    /** $a − $b for $a ≥ $b. */
    private static function subtractDigits(string $a, string $b): string
    {
        $out = '';
        $borrow = 0;
        for ($i = strlen($a) - 1, $j = strlen($b) - 1; $i >= 0; $i--, $j--) {
            $diff = (int) $a[$i] - ($j >= 0 ? (int) $b[$j] : 0) - $borrow;
            $borrow = $diff < 0 ? 1 : 0;
            $out = (string) ($diff + 10 * $borrow) . $out;
        }
        return ltrim($out, '0') === '' ? '0' : ltrim($out, '0');
    }

    /** @param array<string, mixed> $value */
    private function line(array $value): void
    {
        ($this->emit)(self::encode($value) . "\n");
    }
}
