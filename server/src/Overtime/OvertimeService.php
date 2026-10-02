<?php
declare(strict_types=1);

namespace TamOs\Overtime;

use TamOs\Data\BusinessData;
use TamOs\Data\Overtime\OvertimeStore;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Policy\Action;
use TamOs\Policy\Authorization;
use TamOs\Policy\Policy;
use TamOs\Policy\Scope;

/**
 * The server overtime operations (BF-4b1): the non-money workflow's ordering and transaction
 * boundaries. It owns no SQL and never takes a company, an owner or an actor from a browser —
 * the company and actor come from the session principal, the owner from an employee record read
 * in scope.
 *
 *   month   company scope for the CEO, own rows for an Employee; one month only (D-BF4b1-3);
 *           fails closed above OvertimeStore::LIST_CAP rows instead of truncating
 *   read    absent and out of scope alike are 404
 *   create  validate → the employee in scope (404) → a Draft candidate → overtime.createSelfDraft
 *           (403) → one transaction: lock the employee, refuse an archived or not-Active one
 *           (409), insert + audit
 *   update  validate → scoped load (404) → overtime.updateSelfDraft (403) → one transaction:
 *           lock, refuse a non-Draft or a moved version (409), apply + the date/month rule (400),
 *           compare-and-swap + audit; nothing changed → no write, no audit, same version
 *   delete  scoped load → overtime.deleteSelfDraft → lock, Draft and version (409) → hard delete
 *           + audit in the same transaction (D-BF4b-6)
 *   submit / review / reject  scoped load → the transition's Action → lock, source status and
 *           version (409) → compare-and-swap + audit naming the operation (D-BF4b-5)
 *
 * Policy decides on the record as loaded; the locked row decides again, so a change that lands
 * between the two loses deterministically (409). Nothing here values overtime or touches payroll.
 */
final class OvertimeService
{
    public function __construct(private readonly BusinessData $data)
    {
    }

    /** @return list<array<string, mixed>> the scope's records of $month */
    public function month(Principal $actor, ?string $month): array
    {
        $monthKey = OvertimeInput::month($month);           // 400 before any lookup
        $rows = $this->data->overtime()->month(Scope::of($actor), $monthKey);
        if (count($rows) > OvertimeStore::LIST_CAP) {
            throw new ApiError(ErrorCode::InternalError, 'overtime month above its cap', logReason: 'overtime_list_cap');
        }
        return $rows;
    }

    /** @return array<string, mixed> the record the principal may read */
    public function read(Principal $actor, ?string $id): array
    {
        $id = OvertimeInput::id($id);                       // 400 before any lookup
        return $this->data->overtime()->record(Scope::of($actor), $id) ?? throw new ApiError(ErrorCode::NotFound);
    }

    /**
     * @param array<string, mixed> $json
     * @return array<string, mixed> the created Draft
     */
    public function create(Principal $actor, array $json, string $requestId): array
    {
        $in = OvertimeInput::create($json);
        $employee = $this->data->employees()->find(Scope::of($actor), $in['employeeId']) ?? throw new ApiError(ErrorCode::NotFound);
        $id = bin2hex(random_bytes(16));
        $auth = Policy::authorize($actor, Action::OvertimeCreateSelfDraft, $this->data->overtime()->candidate($employee, $id));
        $this->data->atomically(function () use ($auth, $actor, $in, $requestId): void {
            $eligibility = $this->data->overtime()->lockEmployee($auth) ?? throw new ApiError(ErrorCode::NotFound);
            if ($eligibility['archived']) {
                throw new ApiError(ErrorCode::Conflict, logReason: 'employee_archived');
            }
            if ($eligibility['employmentStatus'] !== 'Active') {
                throw new ApiError(ErrorCode::Conflict, logReason: 'employee_not_active');
            }
            $this->data->overtime()->create($auth, $in['record']);
            $this->data->audit()->appendOvertime($auth, $actor, null, OvertimeInput::changed(array_fill_keys(OvertimeStore::RECORD, null), $in['record']), $requestId);
        });
        return $this->data->overtime()->record($auth->scope, $id) ?? throw new \LogicException('created overtime not readable');
    }

    /**
     * @param array<string, mixed> $json
     * @return array<string, mixed> the record after the update
     */
    public function update(Principal $actor, array $json, string $requestId): array
    {
        $in = OvertimeInput::update($json);
        $auth = $this->authorized($actor, Action::OvertimeUpdateSelfDraft, $in['id']);
        $this->data->atomically(function () use ($auth, $actor, $in, $requestId): void {
            $current = $this->locked($auth, [OvertimeStatus::DRAFT], $in['expectedVersion']);
            $before = OvertimeView::columns($current);
            $after = OvertimeInput::apply($before, $in['patch']);
            $changed = OvertimeInput::changed($before, $after);
            if ($changed === []) {
                return;                                     // nothing differs: no write, no audit, same version
            }
            if ($this->data->overtime()->update($auth, $in['expectedVersion'], $after) !== 1) {
                throw new \LogicException('update: the locked Draft did not change');
            }
            $this->data->audit()->appendOvertime($auth, $actor, null, $changed, $requestId);
        });
        return $this->data->overtime()->record($auth->scope, $in['id']) ?? throw new \LogicException('updated overtime not readable');
    }

    /**
     * @param array<string, mixed> $json
     * @return array{id: string} the id of the deleted Draft
     */
    public function delete(Principal $actor, array $json, string $requestId): array
    {
        $in = OvertimeInput::transition($json);
        $auth = $this->authorized($actor, Action::OvertimeDeleteSelfDraft, $in['id']);
        $this->data->atomically(function () use ($auth, $actor, $in, $requestId): void {
            $this->locked($auth, [OvertimeStatus::DRAFT], $in['expectedVersion']);
            if ($this->data->overtime()->deleteDraft($auth, $in['expectedVersion']) !== 1) {
                throw new \LogicException('delete: the locked Draft was not deleted');
            }
            $this->data->audit()->appendOvertime($auth, $actor, null, [], $requestId);
        });
        return ['id' => $in['id']];
    }

    /**
     * submit, review or reject (OvertimeStatus::TRANSITIONS).
     *
     * @param array<string, mixed> $json
     * @return array<string, mixed> the record in its new status
     */
    public function transition(Principal $actor, string $operation, array $json, string $requestId): array
    {
        $in = OvertimeInput::transition($json);
        $auth = $this->authorized($actor, OvertimeStatus::action($operation), $in['id']);
        $this->data->atomically(function () use ($auth, $actor, $operation, $in, $requestId): void {
            $current = $this->locked($auth, OvertimeStatus::TRANSITIONS[$operation][1], $in['expectedVersion']);
            $from = (string) $current['status'];
            $to = OvertimeStatus::target($operation, $from) ?? throw new \LogicException('transition: no target');
            if ($this->data->overtime()->transition($auth, $in['expectedVersion'], $from, $to) !== 1) {
                throw new \LogicException('transition: the locked record did not change');
            }
            $this->data->audit()->appendOvertime($auth, $actor, $operation, [], $requestId);
        });
        return $this->data->overtime()->record($auth->scope, $in['id']) ?? throw new \LogicException('transitioned overtime not readable');
    }

    /** The record loaded under the principal's scope (404 when absent or out of scope), then Policy (403). */
    private function authorized(Principal $actor, Action $action, string $id): Authorization
    {
        $record = $this->data->overtime()->find(Scope::of($actor), $id) ?? throw new ApiError(ErrorCode::NotFound);
        return Policy::authorize($actor, $action, $record);
    }

    /**
     * The locked row, refused (409) unless it is in one of $statuses at the expected version.
     *
     * @param list<string> $statuses
     * @return array<string, mixed>
     */
    private function locked(Authorization $auth, array $statuses, int $expectedVersion): array
    {
        $current = $this->data->overtime()->lock($auth) ?? throw new ApiError(ErrorCode::NotFound);
        if (!in_array($current['status'], $statuses, true)) {
            throw new ApiError(ErrorCode::Conflict, logReason: 'overtime_state');
        }
        if ((int) $current['version'] !== $expectedVersion) {
            throw new ApiError(ErrorCode::Conflict, logReason: 'overtime_version');
        }
        return $current;
    }
}
