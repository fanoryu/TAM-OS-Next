<?php
declare(strict_types=1);

namespace TamOs\Identity;

use TamOs\Http\Request;

/**
 * Resolves every request to no session. There is no fallback identity: no CEO, no
 * Employee, and nothing a cookie, header or body field can turn into one. Used by tests.
 */
final class NullPrincipalResolver implements PrincipalResolver
{
    public function resolve(Request $request): ?AuthSession
    {
        return null;
    }
}
