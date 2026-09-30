<?php
declare(strict_types=1);

namespace TamOs\Policy;

use TamOs\Data\Scope\ScopedRecord;

/**
 * Proof that Policy authorized one action for one principal: the action, the principal's scope
 * and, for a record-bearing action, the record it was authorized against. Every scoped write
 * requires one, so a write cannot happen without an authorization check.
 *
 * Constructed only by Policy::authorize() (tools/verify-backend-boundary.js).
 */
final class Authorization
{
    public function __construct(
        public readonly Action $action,
        public readonly Scope $scope,
        public readonly ?ScopedRecord $record,
    ) {
    }
}
