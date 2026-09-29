<?php
declare(strict_types=1);

namespace TamOs\Identity;

use TamOs\Http\Request;

/**
 * The server-side identity seam: resolves the authoritative principal for a request, or
 * null when there is none (SDR-0002 §1, §7 — unknown principal means deny).
 *
 * BF-1 has no authentication, so the only implementation is NullPrincipalResolver. The
 * authoritative principal model (user, membership, company, role, employee binding,
 * statuses) arrives with the authenticated-identity milestone, which narrows this return
 * type; until then no code may construct an identity.
 */
interface PrincipalResolver
{
    public function resolve(Request $request): ?object;
}
