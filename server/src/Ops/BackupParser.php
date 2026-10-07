<?php
declare(strict_types=1);

namespace TamOs\Ops;

/**
 * Re-reads a decrypted backup payload (OPS-1 verify) and recomputes everything its manifest
 * claims — the grammar, the canonical encoding, ascending ids, row counts, row digests, maximum
 * ids and exact DECIMAL totals — from the rows themselves, then requires the manifest to agree.
 *
 * With continuity expectations (from the previous backup's manifest) it also recomputes, for each
 * append-only table, the digest and count of the rows whose id is at most the previous maximum:
 * they must equal the previous backup's digest and count exactly (D-AB-5 = B).
 */
final class BackupParser
{
    private string $pending = '';
    private string $state = 'preamble';
    private ?string $backupId = null;
    /** @var array<string, mixed>|null */
    private ?array $table = null;
    /** @var list<array<string, mixed>> */
    private array $tables = [];
    /** @var array<string, mixed>|null */
    private ?array $manifest = null;

    /**
     * @param array<string, array{maxId: int, rows: int, sha256: string}> $continuity per append-only table
     */
    public function __construct(private readonly array $continuity = [])
    {
    }

    /** Feeds the next decrypted bytes. @throws BackupError malformed | manifest_mismatch | continuity_broken */
    public function feed(string $bytes): void
    {
        $this->pending .= $bytes;
        while (($at = strpos($this->pending, "\n")) !== false) {
            $line = substr($this->pending, 0, $at);
            $this->pending = substr($this->pending, $at + 1);
            $this->line($line);
        }
        if (strlen($this->pending) > BackupFormat::MAX_LINE_BYTES) {
            throw new BackupError(BackupError::MALFORMED);
        }
    }

    /**
     * Ends the payload and returns its verified manifest.
     *
     * @return array<string, mixed>
     * @throws BackupError malformed | manifest_mismatch
     */
    public function finish(): array
    {
        if ($this->pending !== '' || $this->state !== 'done' || $this->manifest === null) {
            throw new BackupError(BackupError::MALFORMED);
        }
        $m = $this->manifest;
        if (($m['format'] ?? null) !== BackupFormat::FORMAT || ($m['formatVersion'] ?? null) !== BackupFormat::VERSION
            || ($m['backupId'] ?? null) !== $this->backupId || !is_array($m['tables'] ?? null) || count($m['tables']) !== count($this->tables)) {
            throw new BackupError(BackupError::MANIFEST_MISMATCH);
        }
        foreach ($this->tables as $i => $computed) {
            $claimed = $m['tables'][$i];
            if (!is_array($claimed)) {
                throw new BackupError(BackupError::MANIFEST_MISMATCH);
            }
            foreach (['name', 'columns', 'rows', 'maxId', 'sha256', 'decimalTotals'] as $key) {
                if (!array_key_exists($key, $claimed) || $claimed[$key] !== $computed[$key]) {
                    throw new BackupError(BackupError::MANIFEST_MISMATCH);
                }
            }
        }
        foreach ($this->continuity as $name => $expected) {
            if (!in_array($name, array_column($this->tables, 'name'), true)) {
                throw new BackupError(BackupError::CONTINUITY_BROKEN);   // an append-only table vanished
            }
        }
        return $m;
    }

    private function line(string $line): void
    {
        $value = $this->decode($line);
        switch ($this->state) {
            case 'preamble':
                if (!is_array($value) || array_keys($value) !== ['format', 'formatVersion', 'backupId'] || $value['format'] !== BackupFormat::FORMAT
                    || $value['formatVersion'] !== BackupFormat::VERSION || !is_string($value['backupId']) || !BackupStore::isBackupId($value['backupId'])) {
                    throw new BackupError(BackupError::MALFORMED);
                }
                $this->backupId = $value['backupId'];
                $this->state = 'between';
                return;
            case 'between':
                if (is_array($value) && array_keys($value) === ['table', 'columns', 'decimals']) {
                    $this->beginTable($value);
                    return;
                }
                if (is_array($value) && array_keys($value) === ['manifest'] && is_array($value['manifest'])) {
                    $this->manifest = $value['manifest'];
                    $this->state = 'done';
                    return;
                }
                throw new BackupError(BackupError::MALFORMED);
            case 'table':
                if (array_is_list($value)) {
                    $this->row($line, $value);
                    return;
                }
                $this->endTable($value);
                return;
            default:
                throw new BackupError(BackupError::MALFORMED);    // nothing follows the manifest
        }
    }

    /** @param array<string, mixed> $header */
    private function beginTable(array $header): void
    {
        ['table' => $name, 'columns' => $columns, 'decimals' => $decimals] = $header;
        if (!is_string($name) || preg_match('/^[a-z][a-z0-9_]{0,63}$/D', $name) !== 1 || in_array($name, array_column($this->tables, 'name'), true)
            || !is_array($columns) || !array_is_list($columns) || ($columns[0] ?? null) !== 'id' || !is_array($decimals)) {
            throw new BackupError(BackupError::MALFORMED);
        }
        foreach ($columns as $column) {
            if (!is_string($column) || preg_match('/^[a-z][a-z0-9_]{0,63}$/D', $column) !== 1) {
                throw new BackupError(BackupError::MALFORMED);
            }
        }
        if (count(array_unique($columns)) !== count($columns)) {
            throw new BackupError(BackupError::MALFORMED);
        }
        $totals = [];
        $indexes = [];
        foreach ($decimals as $column => $scale) {
            $index = array_search($column, $columns, true);
            if ($index === false || !is_int($scale) || $scale < 0 || $scale > 30) {
                throw new BackupError(BackupError::MALFORMED);
            }
            $indexes[$column] = [$index, $scale];
            $totals[$column] = BackupFormat::decimalZero($scale);
        }
        $expect = $this->continuity[$name] ?? null;
        $this->table = ['name' => $name, 'columns' => $columns, 'decimals' => $indexes, 'rows' => 0, 'maxId' => null,
            'hash' => hash_init('sha256'), 'totals' => $totals, 'expect' => $expect, 'prefixRows' => 0, 'prefixHash' => hash_init('sha256')];
        $this->state = 'table';
    }

    /** @param list<mixed> $values */
    private function row(string $line, array $values): void
    {
        $t = &$this->table;
        if (count($values) !== count($t['columns'])) {
            throw new BackupError(BackupError::MALFORMED);
        }
        foreach ($values as $value) {
            if (!is_int($value) && !is_string($value) && $value !== null) {
                throw new BackupError(BackupError::MALFORMED);
            }
        }
        if (!is_int($values[0]) && !is_string($values[0])) {
            throw new BackupError(BackupError::MALFORMED);
        }
        if ($t['maxId'] !== null && BackupFormat::compareIds($values[0], $t['maxId']) <= 0) {
            throw new BackupError(BackupError::MALFORMED);
        }
        foreach ($t['decimals'] as $column => [$index, $scale]) {
            $value = $values[$index];
            if ($value !== null) {
                if (!is_string($value) || !BackupFormat::isDecimal($value, $scale)) {
                    throw new BackupError(BackupError::MALFORMED);
                }
                $t['totals'][$column] = BackupFormat::decimalAdd($t['totals'][$column], $value, $scale);
            }
        }
        hash_update($t['hash'], $line . "\n");
        $t['rows']++;
        $t['maxId'] = $values[0];
        if ($t['expect'] !== null && is_int($values[0]) && $values[0] <= $t['expect']['maxId']) {
            hash_update($t['prefixHash'], $line . "\n");
            $t['prefixRows']++;
        }
    }

    private function endTable(mixed $value): void
    {
        $t = $this->table;
        if (!is_array($value) || array_keys($value) !== ['end', 'rows'] || $value['end'] !== $t['name'] || $value['rows'] !== $t['rows']) {
            throw new BackupError(BackupError::MALFORMED);
        }
        if ($t['expect'] !== null && ($t['prefixRows'] !== $t['expect']['rows'] || !hash_equals($t['expect']['sha256'], hash_final($t['prefixHash'])))) {
            throw new BackupError(BackupError::CONTINUITY_BROKEN);
        }
        $this->tables[] = [
            'name' => $t['name'],
            'columns' => $t['columns'],
            'rows' => $t['rows'],
            'maxId' => $t['maxId'],
            'sha256' => hash_final($t['hash']),
            'decimalTotals' => $t['totals'],
        ];
        $this->table = null;
        $this->state = 'between';
    }

    /** One line: canonical JSON (re-encoding it must reproduce it byte for byte). */
    private function decode(string $line): mixed
    {
        try {
            $value = json_decode($line, true, 64, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
        } catch (\JsonException) {
            throw new BackupError(BackupError::MALFORMED);
        }
        $reencoded = is_array($value) ? BackupFormat::encode($this->objectsForEncoding($line, $value)) : null;
        if ($reencoded !== $line) {
            throw new BackupError(BackupError::MALFORMED);
        }
        return $value;
    }

    /**
     * json_decode(…, true) turns {} into [], so an empty object (a table's "decimals" or a
     * manifest's "decimalTotals") is restored before the canonical re-encoding comparison.
     */
    private function objectsForEncoding(string $line, array $value): mixed
    {
        if (!str_contains($line, '{}')) {
            return $value;
        }
        try {
            return json_decode($line, false, 64, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
        } catch (\JsonException) {
            throw new BackupError(BackupError::MALFORMED);
        }
    }
}
