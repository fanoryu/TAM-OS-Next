<?php
declare(strict_types=1);

/*
 * Migration file-set rules (filesystem only, no database), the comparison of files with
 * history, the executable-text normalization and the message-safe MigrationError.
 * Fixtures are written to temporary directories, never under server/migrations/.
 */

use TamOs\Data\Migration\Migration;
use TamOs\Data\Migration\MigrationError;
use TamOs\Data\Migration\MigrationSet;
use TamOs\Data\Migration\Migrator;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\migrationFixture;
use function TamOs\Tests\tempDir;

$invalid = static function (array $files, string $label): MigrationError {
    $e = assertThrows(MigrationError::class, static fn () => MigrationSet::load(migrationFixture($files)), $label);
    assertSame(MigrationError::MIGRATIONS_INVALID, $e->reason, $label);
    return $e;
};
$ok = "CREATE TABLE a (x INT)\n";
$m = static fn (int $v, string $name, string $sql = "CREATE TABLE t (x INT)\n"): Migration => new Migration($v, $name, hash('sha256', $sql), $sql);
$row = static fn (Migration $mig, bool $applied = true, ?string $name = null, ?string $sha = null): array => [
    'version' => $mig->version, 'name' => $name ?? $mig->name, 'sha256' => $sha ?? $mig->sha256, 'applied' => $applied,
];

return [
    'a missing migration directory is an empty set' => static function (): void {
        assertSame([], MigrationSet::load(tempDir() . DIRECTORY_SEPARATOR . 'absent'));
        assertSame([], MigrationSet::load(migrationFixture([])), 'an empty directory too');
    },
    'valid files load in version order with the exact SHA-256 of their bytes' => static function () use ($ok): void {
        $second = "ALTER TABLE a ADD COLUMN y INT;\n";
        $set = MigrationSet::load(migrationFixture(['0002_add_y.sql' => $second, '0001_create_a.sql' => $ok]));
        assertSame([[1, 'create_a'], [2, 'add_y']], array_map(static fn (Migration $x): array => [$x->version, $x->name], $set));
        assertSame(hash('sha256', $ok), $set[0]->sha256);
        assertSame($second, $set[1]->sql, 'original bytes kept');
        assertSame('0002_add_y', $set[1]->label());
    },
    'versions must be exactly 1..N: no gap, no zero, no duplicate' => static function () use ($invalid, $ok): void {
        $invalid(['0001_a.sql' => $ok, '0003_c.sql' => $ok], 'gap');
        $invalid(['0002_b.sql' => $ok], 'does not start at 0001');
        $invalid(['0000_zero.sql' => $ok], 'version zero');
        $invalid(['0001_a.sql' => $ok, '0001_b.sql' => $ok], 'duplicate version');
    },
    'file names must match NNNN_name.sql with a name of at most 64 characters' => static function () use ($invalid, $ok): void {
        foreach (['1_a.sql', '0001-a.sql', '0001_A.sql', '0001_a_.sql', '0001__a.sql', '0001_.sql', '00001_a.sql', '0001_a.SQL', '0001_a.sql.bak', 'README.md', '.gitkeep'] as $name) {
            $invalid(['0001_ok.sql' => $ok, $name => $ok], $name);
        }
        $invalid(['0001_' . str_repeat('a', 65) . '.sql' => $ok], 'name too long');
        assertSame(64, strlen(MigrationSet::load(migrationFixture(['0001_' . str_repeat('a', 64) . '.sql' => $ok]))[0]->name));
    },
    'a sub-directory inside the migration directory is refused' => static function () use ($invalid, $ok): void {
        $dir = migrationFixture(['0001_a.sql' => $ok]);
        mkdir($dir . DIRECTORY_SEPARATOR . '0002_b.sql');
        assertSame(MigrationError::MIGRATIONS_INVALID, assertThrows(MigrationError::class, static fn () => MigrationSet::load($dir))->reason);
    },
    'bytes must be non-empty UTF-8 without BOM or CR' => static function () use ($invalid): void {
        foreach (['empty' => '', 'blank' => " \n\t\n", 'only a semicolon' => ";\n", 'BOM' => "\xEF\xBB\xBFCREATE TABLE a (x INT)\n",
            'CRLF' => "CREATE TABLE a (x INT)\r\n", 'lone CR' => "CREATE TABLE a\r(x INT)", 'invalid UTF-8' => "CREATE TABLE a (x INT) -- \xff\n"] as $label => $bytes) {
            $e = $invalid(['0001_a.sql' => $bytes], $label);
            assertSame(1, $e->version, $label . ': version recorded');
        }
    },
    'execution text drops trailing whitespace and one final semicolon, nothing else' => static function () use ($m): void {
        assertSame('CREATE TABLE a (x INT)', $m(1, 'a', "CREATE TABLE a (x INT);\n\n")->sqlForExecution());
        assertSame('CREATE TABLE a (x INT);', $m(1, 'a', "CREATE TABLE a (x INT);;\n")->sqlForExecution(), 'only one');
        assertSame("-- note\nCREATE TABLE a (x INT) /* c */", $m(1, 'a', "-- note\nCREATE TABLE a (x INT) /* c */\n")->sqlForExecution(), 'comments untouched');
        assertSame("CREATE TABLE a (x INT); CREATE TABLE b (x INT)", $m(1, 'a', "CREATE TABLE a (x INT); CREATE TABLE b (x INT);\n")->sqlForExecution(), 'a second statement is not hidden');
    },
    'compare: empty history means every file is pending' => static function () use ($m): void {
        $set = [$m(1, 'a'), $m(2, 'b')];
        assertSame($set, Migrator::compare($set, []));
        assertSame([], Migrator::compare([], []));
    },
    'compare: applied prefix leaves only later files pending' => static function () use ($m, $row): void {
        $set = [$m(1, 'a'), $m(2, 'b'), $m(3, 'c')];
        assertSame([$set[2]], Migrator::compare($set, [$row($set[0]), $row($set[1])]));
        assertSame([], Migrator::compare($set, array_map($row, $set)));
    },
    'compare: an incomplete row refuses, whatever else matches' => static function () use ($m, $row): void {
        $set = [$m(1, 'a'), $m(2, 'b')];
        $e = assertThrows(MigrationError::class, static fn () => Migrator::compare($set, [$row($set[0]), $row($set[1], false)]));
        assertSame([MigrationError::SCHEMA_INCOMPLETE, 2], [$e->reason, $e->version]);
    },
    'compare: modified, renamed, unknown or missing migrations are drift' => static function () use ($m, $row): void {
        $set = [$m(1, 'a'), $m(2, 'b')];
        $cases = [
            'modified bytes' => [$row($set[0], true, null, hash('sha256', 'other'))],
            'renamed' => [$row($set[0], true, 'renamed')],
            'unknown version in history' => [$row($set[0]), $row($set[1]), ['version' => 3, 'name' => 'c', 'sha256' => str_repeat('0', 64), 'applied' => true]],
            'history gap' => [$row($set[1])],
        ];
        foreach ($cases as $label => $rows) {
            $e = assertThrows(MigrationError::class, static fn () => Migrator::compare($set, $rows), $label);
            assertSame(MigrationError::SCHEMA_DRIFT, $e->reason, $label);
        }
        $missing = assertThrows(MigrationError::class, static fn () => Migrator::compare([$set[0]], [$row($set[0]), $row($set[1])]));
        assertSame([MigrationError::SCHEMA_DRIFT, 2], [$missing->reason, $missing->version], 'repository file deleted');
    },
    'MigrationError carries a fixed reason and a version number only' => static function (): void {
        $e = new MigrationError(MigrationError::SCHEMA_DRIFT, 7);
        assertSame('migration schema_drift at version 7', $e->getMessage());
        assertThrows(LogicException::class, static fn () => new MigrationError('DROP TABLE users'));
        assertTrue((new MigrationError(MigrationError::HISTORY_MISSING))->version === null, 'version optional');
    },
];
