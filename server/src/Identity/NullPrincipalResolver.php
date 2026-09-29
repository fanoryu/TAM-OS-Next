<?php
declare(strict_types=1);

namespace TamOs\Identity;

use TamOs\Http\Request;

/**
 * Resolves every request to no principal. There is no fallback identity: no CEO, no
 * Employee, and nothing a cookie, header or body field can turn into one.
 */
final class NullPrincipalResolver implements PrincipalResolver
{
    public function resolve(Request $request): ?object
    {
        return null;
    }
}
