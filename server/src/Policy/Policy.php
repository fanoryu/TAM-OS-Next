<?php
declare(strict_types=1);

namespace TamOs\Policy;

use TamOs\Data\Scope\ScopedRecord;
use TamOs\Http\ApiError;
use TamOs\Http\ErrorCode;
use TamOs\Identity\Principal;
use TamOs\Identity\Role;

/**
 * The authoritative server POLICY over the 20 ACTIONS (SDR-0002 §7). The browser's can() is UX
 * only; this is the decision.
 *
 * Default deny: an action outside the vocabulary cannot be expressed (Action is an enum); a
 * record-bearing action needs a record read under the principal's own scope (the server AZ-1
 * precondition) and a record-free action accepts none; CeoOnly admits only the CEO; CeoOrOwnDraft
 * admits the CEO, and an Employee only for their own Draft. There is no fallback to CEO.
 *
 * For a record-bearing action the caller loads the record through the scoped data layer FIRST —
 * absent or out of scope is 404 — and only then asks Policy, so 403 means "in scope, not
 * permitted" (SDR-0002 §8.3).
 */
final class Policy
{
    /** @throws ApiError forbidden (action_denied) */
    public static function authorize(Principal $principal, Action $action, ?ScopedRecord $record = null): Authorization
    {
        if (!self::allows($principal, $action, $record)) {
            throw new ApiError(ErrorCode::Forbidden, 'action denied', logReason: 'action_denied');
        }
        return new Authorization($action, Scope::of($principal), $record);
    }

    public static function allows(Principal $principal, Action $action, ?ScopedRecord $record = null): bool
    {
        $scope = Scope::of($principal);
        $entity = $action->entity();
        if ($entity === null) {
            if ($record !== null) {
                return false;
            }
        } elseif ($record === null || $record->entity !== $entity || !$record->scope->equals($scope)) {
            return false;
        }
        return match ($action->rule()) {
            Rule::CeoOnly => $principal->role === Role::Ceo,
            Rule::CeoOrOwnDraft => match ($principal->role) {
                Role::Ceo => true,
                Role::Employee => $record !== null
                    && $record->ownerEmployeeId !== null
                    && $record->ownerEmployeeId === $scope->selfEmployeeId
                    && $record->status === 'Draft',
            },
        };
    }
}
