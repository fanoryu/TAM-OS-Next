<?php
declare(strict_types=1);

namespace TamOs\Employee;

use TamOs\Data\BusinessData;
use TamOs\Data\DatabaseError;
use TamOs\Data\Employee\EmployeeStore;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Identity\Role;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Policy;
use TamOs\Policy\Scope;

/**
 * The server Employee operations (BF-4a1): the ordering and the transaction boundaries of the
 * Employee routes. It owns no SQL and never takes a company, an employee binding or an actor
 * from a browser — all three come from the session principal.
 *
 *   list     CEO only (an Employee is 403: no enumeration surface); company scope; fails
 *            closed above EmployeeStore::LIST_CAP entitled rows instead of truncating
 *   read     company scope for the CEO, self scope for an Employee; absent and out of scope
 *            alike are 404
 *   create   validate → employee.create (decided by the kernel and again here) → one
 *            transaction: insert with a server id + audit
 *   update   validate → scoped load (404) → Policy (403) → one transaction: lock the row,
 *            refuse archived (409) or a moved version (409), compare-and-swap + audit
 *   archive  validate → scoped load (404) → Policy (403) → one transaction: lock the row,
 *            refuse archived, a moved version or an active login bound to it (409), soft
 *            archive + audit
 *
 * A duplicate employee code is 409. A forced failure anywhere inside a transaction rolls back
 * the write and its audit row together. Employment status never changes a login.
 */
final class EmployeeService
{
    private const DUPLICATE_KEY = 1062;

    public function __construct(private readonly BusinessData $data)
    {
    }

    /** @return list<array<string, mixed>> profile rows in (employee_code, id) order */
    public function list(Principal $actor, bool $includeArchived): array
    {
        if ($actor->role !== Role::Ceo) {
            throw new ApiError(ErrorCode::Forbidden, 'employee list is CEO-only', logReason: 'employee_list_denied');
        }
        $rows = $this->data->employees()->profiles(Scope::of($actor), $includeArchived);
        if (count($rows) > EmployeeStore::LIST_CAP) {
            throw new ApiError(ErrorCode::InternalError, 'employee list above its cap', logReason: 'employee_list_cap');
        }
        return $rows;
    }

    /** @return array<string, mixed> the profile row the principal may read */
    public function read(Principal $actor, string $id): array
    {
        if (preg_match(EmployeeInput::ID_PATTERN, $id) !== 1) {
            throw new ApiError(ErrorCode::ValidationFailed, 'employee id', fields: ['id']);
        }
        return $this->data->employees()->profile(Scope::of($actor), $id) ?? throw new ApiError(ErrorCode::NotFound);
    }

    /**
     * @param array<string, mixed> $json
     * @return array<string, mixed> the created profile row
     */
    public function create(Principal $actor, array $json, string $requestId): array
    {
        $profile = EmployeeInput::create($json);
        $auth = Policy::authorize($actor, Action::EmployeeCreate);
        $id = bin2hex(random_bytes(16));
        $this->writing(fn () => $this->data->atomically(function () use ($auth, $actor, $id, $profile, $requestId): void {
            $this->data->employees()->create($auth, $id, $profile);
            $this->data->audit()->append($auth, $actor, EmployeeStore::ENTITY, $id, EmployeeInput::changed(array_fill_keys(EmployeeStore::PROFILE, null), $profile), $requestId);
        }));
        return $this->data->employees()->profile($auth->scope, $id) ?? throw new \LogicException('created employee not readable');
    }

    /**
     * @param array<string, mixed> $json
     * @return array<string, mixed> the profile row after the update
     */
    public function update(Principal $actor, array $json, string $requestId): array
    {
        $in = EmployeeInput::update($json);
        $auth = $this->authorized($actor, Action::EmployeeUpdate, $in['id']);
        $this->writing(fn () => $this->data->atomically(function () use ($auth, $actor, $in, $requestId): void {
            $current = $this->lockedLive($auth, $in['expectedVersion']);
            $before = EmployeeView::profile($current);
            $after = EmployeeInput::apply($before, $in['patch']);
            $changed = EmployeeInput::changed($before, $after);
            if ($changed === []) {
                return;                                     // nothing differs: no write, no audit, same version
            }
            if ($this->data->employees()->update($auth, $in['expectedVersion'], $after) !== 1) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'employee_version');
            }
            $this->data->audit()->append($auth, $actor, EmployeeStore::ENTITY, $in['id'], $changed, $requestId);
        }));
        return $this->data->employees()->profile($auth->scope, $in['id']) ?? throw new \LogicException('updated employee not readable');
    }

    /**
     * @param array<string, mixed> $json
     * @return array<string, mixed> the archived profile row
     */
    public function archive(Principal $actor, array $json, string $requestId): array
    {
        $in = EmployeeInput::archive($json);
        $auth = $this->authorized($actor, Action::EmployeeDelete, $in['id']);
        $this->data->atomically(function () use ($auth, $actor, $in, $requestId): void {
            $this->lockedLive($auth, $in['expectedVersion']);
            if ($this->data->employees()->hasActiveBinding($auth)) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'employee_bound');
            }
            if ($this->data->employees()->archive($auth, $in['expectedVersion']) !== 1) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'employee_version');
            }
            $this->data->audit()->append($auth, $actor, EmployeeStore::ENTITY, $in['id'], ['archived'], $requestId);
        });
        return $this->data->employees()->profile($auth->scope, $in['id']) ?? throw new \LogicException('archived employee not readable');
    }

    /** The record loaded under the principal's scope (404 when absent or out of scope), then Policy (403). */
    private function authorized(Principal $actor, Action $action, string $id): Authorization
    {
        $record = $this->data->employees()->find(Scope::of($actor), $id) ?? throw new ApiError(ErrorCode::NotFound);
        return Policy::authorize($actor, $action, $record);
    }

    /**
     * The locked row, refused when archived or when its version is not the expected one.
     *
     * @return array<string, mixed>
     */
    private function lockedLive(Authorization $auth, int $expectedVersion): array
    {
        $current = $this->data->employees()->lockProfile($auth) ?? throw new ApiError(ErrorCode::NotFound);
        if (($current['archived_at'] ?? null) !== null) {
            throw new ApiError(ErrorCode::Conflict, logReason: 'employee_archived');
        }
        if ((int) $current['version'] !== $expectedVersion) {
            throw new ApiError(ErrorCode::Conflict, logReason: 'employee_version');
        }
        return $current;
    }

    /** A duplicate employee code (the only unique value a caller chooses) is a 409. */
    private function writing(\Closure $fn): void
    {
        try {
            $fn();
        } catch (DatabaseError $e) {
            if ($e->driverCode === self::DUPLICATE_KEY) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'employee_code_taken');
            }
            throw $e;
        }
    }
}
