<?php
declare(strict_types=1);

/*
 * Real-database contract tests (BF-2A). They run only against the guarded, disposable CI
 * database (TAMOS_DB_TESTS=1, env test, loopback host, *_test name, confirmed by the server);
 * see lib.php testDatabase(). Every test starts from an empty schema. The only table used is
 * the throw-away fixture `bf2a_probe` — no application schema is created here.
 */

use TamOs\Data\Database;
use TamOs\Data\DatabaseConfig;
use TamOs\Data\DatabaseError;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\testDatabase;
use function TamOs\Tests\testDbConfig;

$probe = static function (): Database {
    $db = testDatabase();
    $db->execute('CREATE TABLE bf2a_probe (id INT NOT NULL PRIMARY KEY, v VARCHAR(20) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
    return $db;
};
$second = static fn (): Database => new Database(DatabaseConfig::fromConfig(testDbConfig()));
$ids = static fn (Database $db): array => array_map(static fn (array $r): int => (int) $r['id'], $db->select('SELECT id FROM bf2a_probe ORDER BY id'));

return [
    'the guarded connection reaches the configured *_test schema' => static function (): void {
        $db = testDatabase();
        assertSame(getenv('TAMOS_TEST_DB_NAME'), $db->select('SELECT DATABASE() AS name')[0]['name']);
    },
    'session: utf8mb4, UTC and the governed sql_mode' => static function (): void {
        $row = testDatabase()->select('SELECT @@SESSION.sql_mode AS m, @@SESSION.time_zone AS tz, @@SESSION.character_set_connection AS cs')[0];
        $modes = explode(',', (string) $row['m']);
        sort($modes);
        assertSame(['ERROR_FOR_DIVISION_BY_ZERO', 'NO_ENGINE_SUBSTITUTION', 'ONLY_FULL_GROUP_BY', 'STRICT_ALL_TABLES'], $modes);
        assertSame('+00:00', $row['tz']);
        assertSame('utf8mb4', $row['cs']);
    },
    'statements are natively prepared and bound' => static function (): void {
        $db = testDatabase();
        $count = static fn (): int => (int) $db->select("SELECT VARIABLE_VALUE AS v FROM information_schema.SESSION_STATUS WHERE VARIABLE_NAME = 'COM_STMT_PREPARE'")[0]['v'];
        $before = $count();
        assertSame(42, $db->select('SELECT ? + 1 AS v', [41])[0]['v']);
        assertTrue($count() > $before, 'server-side prepare counter advanced');
        assertSame("1; DROP TABLE bf2a_probe", $db->select('SELECT ? AS v', ['1; DROP TABLE bf2a_probe'])[0]['v']);
        assertSame([null, 1, 'x'], array_values($db->select('SELECT ? AS a, ? AS b, ? AS c', [null, true, 'x'])[0]));
    },
    'stacked statements are refused' => static function (): void {
        $db = testDatabase();
        $e = assertThrows(DatabaseError::class, static fn () => $db->select('SELECT 1 AS a; SELECT 2 AS b'));
        assertSame(DatabaseError::FAILURE, $e->kind);
    },
    'execute returns the affected row count' => static function () use ($probe): void {
        $db = $probe();
        assertSame(1, $db->execute('INSERT INTO bf2a_probe (id, v) VALUES (?, ?)', [1, 'a']));
        assertSame(0, $db->execute('UPDATE bf2a_probe SET v = ? WHERE id = ?', ['b', 99]));
    },
    'transaction: commit persists and returns the callback result' => static function () use ($probe, $second, $ids): void {
        $db = $probe();
        $result = $db->transaction(static function (Database $tx): string {
            $tx->execute('INSERT INTO bf2a_probe (id, v) VALUES (?, ?)', [1, 'a']);
            return 'committed';
        });
        assertSame('committed', $result);
        assertSame([1], $ids($second()), 'visible to another connection');
    },
    'transaction: any throwable rolls back and is rethrown unchanged' => static function () use ($probe, $ids): void {
        $db = $probe();
        $thrown = new RuntimeException('business rule');
        $caught = null;
        try {
            $db->transaction(static function (Database $tx) use ($thrown): never {
                $tx->execute('INSERT INTO bf2a_probe (id, v) VALUES (?, ?)', [1, 'a']);
                throw $thrown;
            });
        } catch (RuntimeException $e) {
            $caught = $e;
        }
        assertTrue($caught === $thrown, 'the same exception instance');
        assertSame([], $ids($db), 'rolled back');
        assertSame(7, $db->transaction(static fn (): int => 7), 'usable again afterwards');
    },
    'transaction: a failing statement rolls back the whole unit' => static function () use ($probe, $ids): void {
        $db = $probe();
        $e = assertThrows(DatabaseError::class, static fn () => $db->transaction(static function (Database $tx): void {
            $tx->execute('INSERT INTO bf2a_probe (id, v) VALUES (?, ?)', [1, 'a']);
            $tx->execute('INSERT INTO bf2a_probe (id, v) VALUES (?, ?)', [1, 'duplicate']);
        }));
        assertSame([DatabaseError::FAILURE, '23000', 1062], [$e->kind, $e->sqlstate, $e->driverCode]);
        assertTrue(!str_contains($e->getMessage(), 'duplicate') && $e->getPrevious() === null, 'no driver message kept');
        assertSame([], $ids($db));
    },
    'transaction: nesting is refused and the outer unit rolls back' => static function () use ($probe, $ids): void {
        $db = $probe();
        assertThrows(LogicException::class, static fn () => $db->transaction(static function (Database $tx): void {
            $tx->execute('INSERT INTO bf2a_probe (id, v) VALUES (?, ?)', [1, 'a']);
            $tx->transaction(static fn (): int => 1);
        }));
        assertSame([], $ids($db));
    },
    'lock-wait timeout 1205 is transient, and the callback runs exactly once (no retry)' => static function () use ($probe, $second): void {
        $a = $probe();
        $a->execute('INSERT INTO bf2a_probe (id, v) VALUES (?, ?)', [5, 'locked']);
        $b = $second();
        $calls = 0;
        $error = null;
        $a->transaction(static function (Database $tx) use ($b, &$calls, &$error): void {
            $tx->select('SELECT id FROM bf2a_probe WHERE id = ? FOR UPDATE', [5]);
            try {
                $b->transaction(static function (Database $other) use (&$calls): void {
                    $calls++;
                    $other->select('SELECT id FROM bf2a_probe WHERE id = ? FOR UPDATE WAIT 1', [5]);
                });
            } catch (DatabaseError $e) {
                $error = $e;
            }
        });
        assertTrue($error instanceof DatabaseError, 'lock wait surfaced');
        assertSame([DatabaseError::TRANSIENT, 1205, 1], [$error->kind, $error->driverCode, $calls]);
    },
    'a wrong password or closed port is unavailable, with no credential in the error' => static function (): void {
        $settings = testDbConfig()->db;
        foreach ([['pass' => 'wrong-password-value'], ['port' => 1]] as $over) {
            $db = new Database(DatabaseConfig::fromArray($over + $settings));
            $e = assertThrows(DatabaseError::class, static fn () => $db->select('SELECT 1 AS one'));
            assertSame([DatabaseError::UNAVAILABLE, 'connect'], [$e->kind, $e->operation]);
            foreach ([$settings['user'], $settings['name'], 'wrong-password-value', (string) $settings['pass']] as $secret) {
                assertTrue($secret === '' || !str_contains($e->getMessage(), $secret), 'error leaks a credential');
            }
        }
    },
];
