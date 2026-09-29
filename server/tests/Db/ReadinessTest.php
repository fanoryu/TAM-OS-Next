<?php
declare(strict_types=1);

/*
 * Readiness against the real, guarded CI database (BF-2B): every schema state it must
 * refuse, the one it must accept, and proof that checking changes nothing.
 */

use TamOs\Data\Database;
use TamOs\Data\Migration\Migrator;
use TamOs\Data\Readiness;
use TamOs\Http\Request;
use function TamOs\Tests\assertNoLeak;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\envelope;
use function TamOs\Tests\kernel;
use function TamOs\Tests\migrationFixture;
use function TamOs\Tests\requestId;
use function TamOs\Tests\tempDir;
use function TamOs\Tests\testDatabase;
use function TamOs\Tests\testDbConfig;

$A = "CREATE TABLE bf2b_a (x INT NOT NULL) ENGINE=InnoDB\n";
$B = "CREATE TABLE bf2b_b (x INT NOT NULL) ENGINE=InnoDB\n";
$snapshot = static function (Database $db): array {
    $tables = $db->select('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name');
    $rows = in_array(['t' => 'schema_migrations'], $tables, true) ? $db->select('SELECT version, name, sha256, started_at, applied_at FROM schema_migrations ORDER BY version') : null;
    return [$tables, $rows];
};
$check = static fn (string $dir): ?string => (new Readiness(testDbConfig(), $dir))->check();

return [
    'history missing: not ready, and readiness does not create the table' => static function () use ($snapshot, $check): void {
        $db = testDatabase();
        $before = $snapshot($db);
        assertSame('history_missing', $check(tempDir() . '/absent'));
        assertSame($before, $snapshot($db), 'schema unchanged');
        assertSame([[], null], $snapshot($db), 'still no schema_migrations');
    },
    'current schema (zero migrations after apply): ready, over HTTP too' => static function () use ($check): void {
        $db = testDatabase();
        $dir = tempDir() . '/absent';
        (new Migrator($db, $dir))->apply();
        assertSame(null, $check($dir));
        $r = kernel(testDbConfig(), null, $dir)->handle(new Request('GET', '/api/ready'), requestId());
        assertSame([200, ['status' => 'ready']], [$r->status, envelope($r)['data']]);
        assertSame(200, kernel(testDbConfig(), null, $dir)->handle(new Request('GET', '/api/health'), requestId())->status);
    },
    'current schema with applied migrations: ready' => static function () use ($A, $B, $check): void {
        $db = testDatabase();
        $dir = migrationFixture(['0001_create_a.sql' => $A, '0002_create_b.sql' => $B]);
        (new Migrator($db, $dir))->apply();
        assertSame(null, $check($dir));
    },
    'pending, incomplete, drifted, unknown, missing or invalid history: not ready, with the right reason' => static function () use ($A, $B, $check, $snapshot): void {
        $db = testDatabase();
        $one = migrationFixture(['0001_create_a.sql' => $A]);
        (new Migrator($db, $one))->apply();
        $states = [
            'schema_pending' => migrationFixture(['0001_create_a.sql' => $A, '0002_create_b.sql' => $B]),
            'schema_drift' => migrationFixture(['0001_create_a.sql' => $A . "-- edited\n"]),
            'migrations_invalid' => migrationFixture(['0002_gap.sql' => $B]),
        ];
        foreach ($states as $expected => $dir) {
            $before = $snapshot($db);
            assertSame($expected, $check($dir), $expected);
            assertSame($before, $snapshot($db), $expected . ': nothing written');
        }
        assertSame('schema_drift', $check(tempDir() . '/absent'), 'history row with no repository file');
        $db->execute('INSERT INTO schema_migrations (version, name, sha256, started_at, applied_at) VALUES (2, ?, ?, UTC_TIMESTAMP(6), NULL)', ['create_b', hash('sha256', $B)]);
        assertSame('schema_incomplete', $check(migrationFixture(['0001_create_a.sql' => $A, '0002_create_b.sql' => $B])), 'in-progress or failed migration');
        $db->execute('DROP TABLE schema_migrations');
        $db->execute('CREATE TABLE schema_migrations (version SMALLINT UNSIGNED NOT NULL PRIMARY KEY) ENGINE=InnoDB');
        assertSame('history_invalid', $check($one));
    },
    'not-ready over HTTP is a bare 503 with the reason only in the log' => static function (): void {
        testDatabase();
        $config = testDbConfig();
        $r = kernel($config, null, tempDir() . '/absent')->handle(new Request('GET', '/api/ready'), requestId());
        assertSame([503, 'service_unavailable'], [$r->status, envelope($r)['error']['code']]);
        assertNoLeak($r->body, ['history_missing', (string) $config->db['user'], (string) $config->db['name'], (string) $config->db['pass'], 'schema_migrations']);
        assertTrue(str_contains((string) file_get_contents($config->logPath), '"reason":"history_missing"'), 'reason logged');
    },
    'readiness takes no advisory lock (a running migration does not block it)' => static function () use ($check): void {
        $db = testDatabase();
        $dir = tempDir() . '/absent';
        (new Migrator($db, $dir))->apply();
        $holder = new Database(\TamOs\Data\DatabaseConfig::fromConfig(testDbConfig()));
        assertSame(1, (int) $holder->select("SELECT GET_LOCK('tamos_migrate', 0) AS l")[0]['l']);
        assertSame(null, $check($dir), 'still answers while the lock is held');
        $holder->select("SELECT RELEASE_LOCK('tamos_migrate') AS r");
    },
];
