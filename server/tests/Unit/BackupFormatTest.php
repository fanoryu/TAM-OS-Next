<?php
declare(strict_types=1);

use TamOs\Ops\BackupError;
use TamOs\Ops\BackupFormat;
use TamOs\Ops\BackupParser;
use TamOs\Ops\BackupStore;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;

/** OPS-1: the backup payload — canonical lines, exact DECIMAL totals, and the re-parse that checks every manifest claim. */

$payload = static function (array $tables, ?\Closure $mutate = null): string {
    $out = '';
    $format = new BackupFormat(static function (string $line) use (&$out, $mutate): void {
        $out .= $mutate === null ? $line : $mutate($line);
    });
    $id = '20261007T010000Z-00000abc';
    $format->begin($id);
    foreach ($tables as $name => $t) {
        $format->beginTable($name, $t['columns'], $t['decimals'] ?? [], hash('sha256', $name));
        foreach ($t['rows'] as $row) {
            $format->row(array_combine($t['columns'], $row));
        }
        $format->endTable();
    }
    $format->finish(['backupId' => $id, 'snapshotAt' => '2026-10-07 01:00:00.000000', 'keyFingerprint' => str_repeat('0', 16),
        'source' => ['env' => 'test', 'databaseFingerprint' => str_repeat('f', 64)],
        'schema' => ['databaseHead' => 0, 'codeHead' => 0, 'migrations' => []], 'excludedTables' => [], 'absentTables' => []]);
    return $out;
};
$parse = static function (string $bytes, array $continuity = []): array {
    $parser = new BackupParser($continuity);
    // Feed in uneven pieces: lines must survive any chunking.
    foreach (str_split($bytes, 7) as $piece) {
        $parser->feed($piece);
    }
    return $parser->finish();
};
$money = ['finance_executions' => ['columns' => ['id', 'amount', 'note'], 'decimals' => ['amount' => 2], 'rows' => [
    [str_repeat('1', 32), '1500000.00', "Café ☕ \"q\" \\ / \n\t\u{2028}"],
    [str_repeat('2', 32), '0.05', null],
    [str_repeat('3', 32), '99999999999999.95', ''],
]]];

return [
    'decimal totals are exact digit arithmetic — carries, borrows, signs and scale 0' => static function (): void {
        assertSame('100000000000000.00', BackupFormat::decimalAdd('99999999999999.95', '0.05', 2));
        assertSame('0.00', BackupFormat::decimalAdd('1.25', '-1.25', 2));
        assertSame('-0.75', BackupFormat::decimalAdd('0.50', '-1.25', 2));
        assertSame('1.25', BackupFormat::decimalAdd('-0.50', '1.75', 2));
        assertSame('-3.00', BackupFormat::decimalAdd('-1.50', '-1.50', 2));
        assertSame('1000', BackupFormat::decimalAdd('999', '1', 0));
        assertSame('12345678901234567891.123', BackupFormat::decimalAdd('12345678901234567889.999', '1.124', 3));
        assertThrows(\LogicException::class, static fn () => BackupFormat::decimalAdd('1.5', '1.25', 2), 'operands share the scale');
        assertThrows(\LogicException::class, static fn () => BackupFormat::decimalAdd('1e3', '0', 0), 'never a float text');
    },

    'a payload round-trips: the parser recomputes counts, digests, max ids and money totals equal to the manifest' => static function () use ($payload, $parse, $money): void {
        $tables = $money + ['audit_events' => ['columns' => ['id', 'action'], 'rows' => [[1, 'a'], [2, 'b'], [10, 'c']]]];
        $m = $parse($payload($tables));
        assertSame(['finance_executions', 'audit_events'], array_column($m['tables'], 'name'));
        assertSame(3, $m['tables'][0]['rows']);
        assertSame(str_repeat('3', 32), $m['tables'][0]['maxId']);
        assertSame(['amount' => '100000001500000.00'], $m['tables'][0]['decimalTotals']);
        assertSame(10, $m['tables'][1]['maxId']);
        assertSame([], $m['tables'][1]['decimalTotals']);
    },

    'the same content always produces the same table lines and digests (deterministic)' => static function () use ($payload, $money): void {
        $a = $payload($money);
        $b = $payload($money);
        assertSame($a, $b);
    },

    'a row value that is a float, a bool or an array is refused; invalid UTF-8 is unsupported' => static function (): void {
        $format = new BackupFormat(static function (string $line): void {
        });
        $format->begin('20261007T010000Z-00000abc');
        $format->beginTable('auth_events', ['id', 'v'], [], str_repeat('0', 64));
        foreach ([1.5, true, ['x'], "\xC3\x28"] as $bad) {
            assertSame(BackupError::UNSUPPORTED_VALUE, assertThrows(BackupError::class, static fn () => $format->row(['id' => 1, 'v' => $bad]))->reason);
        }
    },

    'rows must ascend strictly by id; a decimal must have the column scale' => static function (): void {
        $format = new BackupFormat(static function (string $line): void {
        });
        $format->begin('20261007T010000Z-00000abc');
        $format->beginTable('finance_executions', ['id', 'amount'], ['amount' => 2], str_repeat('0', 64));
        $format->row(['id' => 'b', 'amount' => '1.00']);
        assertSame(BackupError::SNAPSHOT_INCONSISTENT, assertThrows(BackupError::class, static fn () => $format->row(['id' => 'b', 'amount' => '1.00']))->reason);
        assertSame(BackupError::SNAPSHOT_INCONSISTENT, assertThrows(BackupError::class, static fn () => $format->row(['id' => 'a', 'amount' => '1.00']))->reason);
        assertSame(BackupError::UNSUPPORTED_VALUE, assertThrows(BackupError::class, static fn () => $format->row(['id' => 'c', 'amount' => '1.5']))->reason);
        assertSame(BackupError::UNEXPECTED_SCHEMA, assertThrows(BackupError::class, static fn () => $format->row(['amount' => '1.00', 'id' => 'd']))->reason);
    },

    'hostile payloads: every forged manifest claim is refused' => static function () use ($payload, $parse, $money): void {
        $forge = static function (string $find, string $replace) use ($payload, $money): string {
            return $payload($money, static function (string $line) use ($find, $replace): string {
                return str_starts_with($line, '{"manifest"') ? str_replace($find, $replace, $line) : $line;
            });
        };
        $reason = static fn (string $bytes): string => assertThrows(BackupError::class, static fn () => $parse($bytes))->reason;
        assertSame(BackupError::MANIFEST_MISMATCH, $reason($forge('"rows":3', '"rows":2')), 'row count');
        assertSame(BackupError::MANIFEST_MISMATCH, $reason($forge('100000001500000.00', '100000001500000.01')), 'money total');
        assertSame(BackupError::MANIFEST_MISMATCH, $reason($forge('"maxId":"' . str_repeat('3', 32), '"maxId":"' . str_repeat('2', 32))), 'max id');
        assertSame(BackupError::MANIFEST_MISMATCH, $reason($forge('"backupId":"20261007T010000Z-00000abc"', '"backupId":"20261007T010000Z-00000abd"')), 'backup id');
    },

    'hostile payloads: broken grammar, non-canonical lines, floats and trailing content are malformed' => static function () use ($payload, $parse, $money): void {
        $good = $payload($money);
        $lines = explode("\n", rtrim($good, "\n"));
        $reason = static fn (string $bytes): string => assertThrows(BackupError::class, static fn () => $parse($bytes))->reason;
        $with = static function (int $i, string $line) use ($lines): string {
            $copy = $lines;
            $copy[$i] = $line;
            return implode("\n", $copy) . "\n";
        };
        assertSame(BackupError::MALFORMED, $reason(implode("\n", array_slice($lines, 0, -1)) . "\n"), 'no manifest');
        assertSame(BackupError::MALFORMED, $reason($good . '{"x":1}' . "\n"), 'a line after the manifest');
        assertSame(BackupError::MALFORMED, $reason(rtrim($good, "\n")), 'no final newline');
        assertSame(BackupError::MALFORMED, $reason($with(2, str_replace(',', ', ', $lines[2]))), 'non-canonical spacing');
        assertSame(BackupError::MALFORMED, $reason($with(3, '["' . str_repeat('2', 32) . '",0.05,null]')), 'a float');
        assertSame(BackupError::MALFORMED, $reason($with(3, '["' . str_repeat('1', 32) . '","0.05",null]')), 'ids not ascending');
        assertSame(BackupError::MALFORMED, $reason($with(3, '["' . str_repeat('2', 32) . '","0.05"]')), 'a short row');
        assertSame(BackupError::MALFORMED, $reason($with(5, '{"end":"finance_executions","rows":2}')), 'end marker count');
        assertSame(BackupError::MALFORMED, $reason($with(0, '{"format":"tamos-backup","formatVersion":2,"backupId":"20261007T010000Z-00000abc"}')), 'format version');
        assertSame(BackupError::MALFORMED, $reason("\xEF\xBB\xBF" . $good), 'a BOM');
    },

    'continuity: the rows up to the previous maximum id must equal the previous digest and count' => static function () use ($payload, $parse): void {
        $rows = [[1, 'a'], [2, 'b'], [3, 'c']];
        $previous = $parse($payload(['audit_events' => ['columns' => ['id', 'action'], 'rows' => array_slice($rows, 0, 2)]]));
        $expect = ['audit_events' => ['maxId' => 2, 'rows' => 2, 'sha256' => $previous['tables'][0]['sha256']]];
        $parse($payload(['audit_events' => ['columns' => ['id', 'action'], 'rows' => $rows]]), $expect);    // appended: fine
        $reason = static fn (array $r): string => assertThrows(BackupError::class, static fn () => $parse($payload(['audit_events' => ['columns' => ['id', 'action'], 'rows' => $r]]), $expect))->reason;
        assertSame(BackupError::CONTINUITY_BROKEN, $reason([[1, 'a'], [2, 'B'], [3, 'c']]), 'an old row rewritten');
        assertSame(BackupError::CONTINUITY_BROKEN, $reason([[1, 'a'], [3, 'c']]), 'an old row deleted');
        assertSame(BackupError::CONTINUITY_BROKEN, $reason([[2, 'b'], [3, 'c']]), 'the first row deleted');
        assertSame(BackupError::CONTINUITY_BROKEN, $reason([[1, 'a']]), 'the tail deleted');
        assertSame(BackupError::CONTINUITY_BROKEN, assertThrows(BackupError::class, static fn () => $parse($payload([]), $expect))->reason, 'the table vanished');
    },

    'backup ids sort chronologically even within one second' => static function (): void {
        $a = BackupStore::newId('2026-10-07 01:00:00.000001');
        $b = BackupStore::newId('2026-10-07 01:00:00.500000');
        $c = BackupStore::newId('2026-10-07 01:00:01');
        assertTrue(BackupStore::isBackupId($a) && BackupStore::isBackupId($c), 'id shape');
        assertTrue(strcmp($a, $b) < 0 && strcmp($b, $c) < 0, 'chronological order');
        assertSame(gmmktime(1, 0, 1, 10, 7, 2026), BackupStore::timeOf($c));
    },
];
