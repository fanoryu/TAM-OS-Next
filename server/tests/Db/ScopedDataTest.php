<?php
declare(strict_types=1);

/*
 * BF-3C scoped data access against the real MariaDB: named binding under native prepares, the
 * company and self predicates of EmployeeStore, ScopedDatabase's row checks (a statement whose
 * predicate is wrong fails the read instead of leaking rows), and scope-injected writes.
 */

use TamOs\Data\Auth\AuthData;
use TamOs\Data\Database;
use TamOs\Data\DatabaseError;
use TamOs\Data\Employee\EmployeeStore;
use TamOs\Data\Scope\ScopedDatabase;
use TamOs\Identity\Principal;
use TamOs\Policy\Action;
use TamOs\Policy\Policy;
use TamOs\Policy\Scope;
use function TamOs\Tests\assertSame;
use function TamOs\Tests\assertThrows;
use function TamOs\Tests\assertTrue;
use function TamOs\Tests\authDatabase;
use function TamOs\Tests\authFixture;
use function TamOs\Tests\employeeAnchor;

/**
 * Two companies. A: CEO (unbound), Employee e_a1, Employee e_a2, and an unbound anchor e_a3.
 * B: CEO bound to its own anchor e_b1. Principals come from the same builder the resolver uses.
 *
 * @return array{db: Database, scoped: ScopedDatabase, store: EmployeeStore, a: string, b: string, ceoA: Principal, ceoB: Principal, empA1: Principal, empA2: Principal}
 */
$world = static function (): array {
    $db = authDatabase();
    $ceoA = authFixture($db);
    $a = $ceoA['companyId'];
    $empA1 = authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a1']);
    $empA2 = authFixture($db, ['companyId' => $a, 'role' => 'employee', 'employeeId' => 'e_a2']);
    employeeAnchor($db, $a, 'e_a3');
    $ceoB = authFixture($db, ['role' => 'ceo', 'employeeId' => 'e_b1']);
    $principal = static function (array $fixture) use ($db): Principal {
        $found = AuthData::fromDatabase($db)->accounts()->findById($fixture['userId']);
        return Principal::fromAccount($found['user'] ?? [], $found['memberships'] ?? []) ?? throw new \LogicException('fixture principal');
    };
    $scoped = new ScopedDatabase($db);
    return ['db' => $db, 'scoped' => $scoped, 'store' => new EmployeeStore($scoped), 'a' => $a, 'b' => $ceoB['companyId'],
        'ceoA' => $principal($ceoA), 'ceoB' => $principal($ceoB), 'empA1' => $principal($empA1), 'empA2' => $principal($empA2)];
};

return [
    'named parameters bind under native prepares on MariaDB; a name used twice is refused by the driver' => static function (): void {
        $db = authDatabase();
        assertSame([['a' => 'x', 'b' => 7]], array_map(static fn (array $r): array => ['a' => $r['a'], 'b' => (int) $r['b']],
            $db->select('SELECT :first AS a, :second AS b', ['first' => 'x', 'second' => 7])));
        assertSame([['v' => '1']], array_map(static fn (array $r): array => ['v' => (string) $r['v']], $db->select('SELECT ? AS v', [1])), 'positional unchanged');
        assertThrows(DatabaseError::class, static fn () => $db->select('SELECT :x AS a, :x AS b', ['x' => 1]), 'a repeated name (native prepares)');
    },
    'CEO: company-wide within its own company only; a bound CEO is still company-wide' => static function () use ($world): void {
        $w = $world();
        assertSame(['e_a1', 'e_a2', 'e_a3'], $w['store']->listIds(Scope::of($w['ceoA'])), 'company A');
        assertSame(['e_b1'], $w['store']->listIds(Scope::of($w['ceoB'])), 'company B (bound CEO)');
        assertTrue($w['store']->find(Scope::of($w['ceoA']), 'e_a2') !== null, 'same company');
        assertSame(null, $w['store']->find(Scope::of($w['ceoA']), 'e_b1'), 'other company');
        assertSame(null, $w['store']->find(Scope::of($w['ceoB']), 'e_a1'), 'other company, reversed');
        assertSame(null, $w['store']->find(Scope::of($w['ceoA']), 'e_absent'), 'absent');
    },
    'Employee: exactly their own anchor, never a colleague\'s or another company\'s' => static function () use ($world): void {
        $w = $world();
        $s = Scope::of($w['empA1']);
        assertSame(['e_a1'], $w['store']->listIds($s), 'list is self only');
        $own = $w['store']->find($s, 'e_a1');
        assertSame(['employee', 'e_a1', 'e_a1', true], [$own?->entity, $own?->id, $own?->ownerEmployeeId, $own?->scope->equals($s)], 'own record');
        foreach (['e_a2', 'e_a3', 'e_b1', 'e_absent'] as $id) {
            assertSame(null, $w['store']->find($s, $id), $id);
        }
        assertSame(['e_a2'], $w['store']->listIds(Scope::of($w['empA2'])), 'the colleague sees only theirs');
    },
    'a statement whose predicate is wrong fails the read and returns no row' => static function () use ($world): void {
        $w = $world();
        $ceo = Scope::of($w['ceoA']);
        $emp = Scope::of($w['empA1']);
        // Company predicate defeated (OR): company B's row comes back → the whole read fails.
        assertThrows(\LogicException::class, static fn () => $w['scoped']->select($ceo,
            'SELECT id, company_id, id AS owner_employee_id FROM employees WHERE company_id = :company_id OR company_id <> :company_idx', ['company_idx' => '']), 'cross-company row');
        // Self predicate defeated: a colleague's row comes back → the whole read fails.
        assertThrows(\LogicException::class, static fn () => $w['scoped']->select($emp,
            'SELECT id, company_id, id AS owner_employee_id FROM employees WHERE company_id = :company_id AND (id = :self_employee_id OR 1 = 1)'), 'colleague row');
        // Missing owner projection.
        assertThrows(\LogicException::class, static fn () => $w['scoped']->select($ceo,
            'SELECT id, company_id FROM employees WHERE company_id = :company_id'), 'no owner column');
    },
    'a create lands in the authorized principal\'s company; the company never comes from input' => static function () use ($world): void {
        $w = $world();
        $w['store']->create(Policy::authorize($w['ceoB'], Action::EmployeeCreate), 'e_new_b');
        assertSame([$w['b']], array_map(static fn (array $r): string => (string) $r['company_id'],
            $w['db']->select('SELECT company_id FROM employees WHERE id = ?', ['e_new_b'])), 'company B');
        assertSame(null, $w['store']->find(Scope::of($w['ceoA']), 'e_new_b'), 'invisible to company A');
        assertThrows(\TamOs\Http\ApiError::class, static fn () => Policy::authorize($w['empA1'], Action::EmployeeCreate), 'an Employee cannot create');
        assertThrows(\LogicException::class, static fn () => $w['scoped']->execute(Policy::authorize($w['ceoA'], Action::EmployeeCreate),
            EmployeeStore::CREATE_SQL, ['id' => 'e_forged', 'company_id' => $w['b']]), 'a forged company_id is refused');
        assertSame([], $w['db']->select('SELECT id FROM employees WHERE id = ?', ['e_forged']), 'nothing written');
    },
];
