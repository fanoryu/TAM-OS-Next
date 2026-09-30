<?php
declare(strict_types=1);

namespace TamOs\Data\Scope;

use TamOs\Policy\Scope;

/**
 * A record as Policy sees it: an entity row that was read — or a create candidate that was
 * built — under one Scope, with the employee it belongs to and its status. It is the server form
 * of the frontend AZ-1 precondition: a record-bearing action is authorized only against a
 * ScopedRecord of the same scope as the principal.
 *
 * Constructed only by ScopedDatabase (tools/verify-backend-boundary.js), so a controller cannot
 * describe a record Policy has not seen come through the scoped data layer.
 */
final class ScopedRecord
{
    public function __construct(
        public readonly Scope $scope,
        public readonly string $entity,
        public readonly string $id,
        public readonly ?string $ownerEmployeeId,
        public readonly ?string $status,
    ) {
    }
}
