<?php
declare(strict_types=1);

namespace TamOs\Identity;

use TamOs\Http\Request;

/**
 * The server-side identity seam: resolves the authoritative session for a request, or null
 * when there is none (SDR-0002 §1, §7 — unknown principal means deny).
 *
 * The kernel calls it only for routes whose RouteAuth is Optional or Required — never for
 * /api/health or /api/ready. Production uses SessionPrincipalResolver; NullPrincipalResolver
 * remains for tests. No other implementation is permitted (tools/verify-backend-boundary.js).
 */
interface PrincipalResolver
{
    public function resolve(Request $request): ?AuthSession;
}
