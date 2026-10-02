<?php
declare(strict_types=1);

/*
 * BF-4a1 migration compatibility (owner decision D-BF4a1-MIGRATION-1 = A). A database at schema
 * 0013 may already hold employee anchors (id, company_id, created_at) with no profile. 0014 adds
 * the profile columns in a transitional (nullable) form, 0015 gives ONLY those legacy rows a
 * recognisable migration placeholder, 0016 enforces the final schema and 0017 adds the audit
 * trail — so such a database migrates forward with no manual step and no stranded marker.
 *
 * Placeholder: employee_code LEGACY-NNNNNN (six digits, numbered per company in (created_at, id)
 * order, skipping any number whose code the company already holds), full_name
 * '[Legacy record — profile pending]'. Never derived from the opaque id. Fabricated data only.
 */

use TamOs\Data\Database;
use TamOs\Data\Migration\Migrator;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\migrationFixture;
use function TamOs\Tests\productionMigrationsDir;
use function TamOs\Tests\testDatabase;

$legacyName = '[Legacy record — profile pending]';

/** The guarded, emptied test database with the production migrations up to $version applied. */
$migratedTo = static function (int $version): Database {
    $db = testDatabase();
    $files = [];
    foreach (glob(productionMigrationsDir() . '/*.sql') ?: [] as $path) {
        if ((int) substr(basename($path), 0, 4) <= $version) {
            $files[basename($path)] = (string) file_get_contents($path);
        }
    }
    (new Migrator($db, migrationFixture($files)))->apply();
    return $db;
};
$company = static function (Database $db): string {
    $id = bin2hex(random_bytes(16));
    $db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$id]);
    return $id;
};
// A schema-0013 anchor: exactly the columns 0009 defines.
$anchor = static fn (Database $db, string $companyId, string $id, string $createdAt): int => $db->execute(
    'INSERT INTO employees (id, company_id, created_at) VALUES (?, ?, ?)',
    [$id, $companyId, $createdAt],
);
$rows = static fn (Database $db): array => array_map(
    static fn (array $r): array => [$r['id'], $r['company_id'], $r['employee_code'], $r['full_name'], $r['created_at'], $r['updated_at'], (int) $r['version']],
    $db->select('SELECT id, company_id, employee_code, full_name, created_at, updated_at, version FROM employees ORDER BY company_id, id'),
);
$history = static fn (Database $db): array => array_map(
    static fn (array $r): string => $r['version'] . ':' . $r['done'],
    $db->select('SELECT version, applied_at IS NOT NULL AS done FROM schema_migrations ORDER BY version'),
);
$sorted = static function (array $rows): array {
    usort($rows, static fn (array $a, array $b): int => [$a[1], $a[0]] <=> [$b[1], $b[0]]);
    return $rows;
};

return [
    'schema-0013 anchors in two companies, one bound to an active login, migrate through 0017 with no manual step' => static function () use ($migratedTo, $company, $anchor, $rows, $history, $sorted, $legacyName): void {
        $db = $migratedTo(13);
        $a = $company($db);
        $b = $company($db);
        // Company A: emp_z is the oldest; emp_a and emp_b share a timestamp, so id breaks the tie.
        $anchor($db, $a, 'emp_z', '2026-01-01 08:00:00.000000');
        $anchor($db, $a, 'emp_b', '2026-01-02 08:00:00.000000');
        $anchor($db, $a, 'emp_a', '2026-01-02 08:00:00.000000');
        $anchor($db, $b, 'emp_y', '2026-01-03 08:00:00.000000');
        $user = bin2hex(random_bytes(16));
        $membership = bin2hex(random_bytes(16));
        $db->execute("INSERT INTO users (id, email, password_hash, status, created_at, updated_at) VALUES (?, 'legacy-bound@example.test', NULL, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$user]);
        $db->execute("INSERT INTO memberships (id, user_id, company_id, role, employee_id, status, created_at, updated_at) VALUES (?, ?, ?, 'employee', 'emp_b', 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", [$membership, $user, $a]);

        $applied = (new Migrator($db, productionMigrationsDir()))->apply();
        assertSame(['0014_extend_employees_profile', '0015_backfill_legacy_employees', '0016_enforce_employees_profile', '0017_create_audit_events',
            '0018_replace_mail_outbox_kind_check', '0019_add_audit_events_account_operation', '0020_create_overtime_records', '0021_replace_audit_events_overtime_checks'],
            array_map(static fn ($m): string => $m->label(), $applied), 'the BF-4a1 migrations, in order, then BF-4a2');
        assertSame(array_map(static fn (int $v): string => $v . ':1', range(1, 21)), $history($db), 'every marker complete — none stranded');
        assertSame([], (new Migrator($db, productionMigrationsDir()))->status(), 'status: current');
        assertSame([], (new Migrator($db, productionMigrationsDir()))->apply(), 'a second apply is a no-op');

        $legacy = static fn (string $id, string $co, string $code, string $at): array => [$id, $co, $code, $legacyName, $at, $at, 1];
        assertSame($sorted([
            $legacy('emp_z', $a, 'LEGACY-000001', '2026-01-01 08:00:00.000000'),
            $legacy('emp_a', $a, 'LEGACY-000002', '2026-01-02 08:00:00.000000'),
            $legacy('emp_b', $a, 'LEGACY-000003', '2026-01-02 08:00:00.000000'),
            $legacy('emp_y', $b, 'LEGACY-000001', '2026-01-03 08:00:00.000000'),
        ]), $rows($db), 'ids, companies and created_at kept; codes per company in (created_at, id) order; updated_at = created_at');
        assertSame([['employee_id' => 'emp_b', 'company_id' => $a, 'status' => 'active']],
            $db->select('SELECT employee_id, company_id, status FROM memberships WHERE id = ?', [$membership]), 'the binding survives (its RESTRICT FK also forbids any delete-and-recreate)');
    },
    'a code the company already holds is skipped, case-insensitively; existing rows are never overwritten' => static function () use ($migratedTo, $company, $anchor, $rows, $sorted, $legacyName): void {
        $db = $migratedTo(14);
        $a = $company($db);
        $b = $company($db);
        $db->execute("INSERT INTO employees (id, company_id, employee_code, full_name, created_at, updated_at) VALUES ('emp_held', ?, 'legacy-000001', 'Fabricated Holder', '2026-02-01 08:00:00.000000', '2026-02-01 08:00:00.000000')", [$a]);
        $anchor($db, $a, 'emp_old', '2026-01-01 08:00:00.000000');
        $anchor($db, $a, 'emp_new', '2026-01-05 08:00:00.000000');
        $anchor($db, $b, 'emp_other', '2026-01-01 08:00:00.000000');
        (new Migrator($db, productionMigrationsDir()))->apply();
        assertSame($sorted([
            ['emp_held', $a, 'legacy-000001', 'Fabricated Holder', '2026-02-01 08:00:00.000000', '2026-02-01 08:00:00.000000', 1],
            ['emp_old', $a, 'LEGACY-000002', $legacyName, '2026-01-01 08:00:00.000000', '2026-01-01 08:00:00.000000', 1],
            ['emp_new', $a, 'LEGACY-000003', $legacyName, '2026-01-05 08:00:00.000000', '2026-01-05 08:00:00.000000', 1],
            ['emp_other', $b, 'LEGACY-000001', $legacyName, '2026-01-01 08:00:00.000000', '2026-01-01 08:00:00.000000', 1],
        ]), $rows($db), 'the held number is skipped in its company only');
    },
    'the final schema is the authorized one: code, name and updated_at NOT NULL, non-empty CHECKs, no BF-4a2 field' => static function () use ($migratedTo, $company, $anchor): void {
        $db = $migratedTo(13);
        $anchor($db, $company($db), 'emp_1', '2026-01-01 08:00:00.000000');
        (new Migrator($db, productionMigrationsDir()))->apply();
        $cols = $db->select("SELECT COLUMN_NAME AS c, IS_NULLABLE AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' ORDER BY ORDINAL_POSITION");
        assertSame(['id', 'company_id', 'employee_code', 'full_name', 'job_title', 'department', 'employment_status', 'join_date', 'contact_email', 'phone', 'notes', 'monthly_base_salary', 'archived_at', 'version', 'created_at', 'updated_at'],
            array_column($cols, 'c'), 'exactly the BF-4a1 columns');
        $nullable = array_column($cols, 'n', 'c');
        assertSame(['NO', 'NO', 'NO'], [$nullable['employee_code'], $nullable['full_name'], $nullable['updated_at']], 'NOT NULL');
        assertSame([
            'employees_code' => "`employee_code` <> ''",
            'employees_employment_status' => "`employment_status` in ('Active','Inactive','On Leave','Resigned','Terminated')",
            'employees_full_name' => "`full_name` <> ''",
            'employees_id' => "`id` <> ''",
            'employees_salary' => '`monthly_base_salary` >= 0',
            'employees_version' => '`version` >= 1',
        ], array_column($db->select("SELECT CONSTRAINT_NAME AS c, CHECK_CLAUSE AS k FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' ORDER BY CONSTRAINT_NAME"), 'k', 'c'));
        assertSame([['c' => 'company_id,employee_code']], $db->select("SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND INDEX_NAME = 'employees_company_code' AND NON_UNIQUE = 0"), 'per-company unique code');
        foreach (['bank', 'account', 'contract', 'history', 'activation'] as $needle) {
            assertSame(0, (int) $db->select("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME LIKE ?", ['%' . $needle . '%'])[0]['n'], 'no ' . $needle . ' column');
        }
    },
];
