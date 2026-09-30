<?php
declare(strict_types=1);

namespace TamOs\Http;

/**
 * Whether the kernel resolves a session for a route.
 *
 *   None      never resolved — no cookie is read and no database is touched for identity
 *             (/api/health, /api/ready, /api/auth/login, /api/auth/activate)
 *   Optional  resolved; the handler receives the session or null (/api/auth/logout)
 *   Required  resolved; no valid session is 401 before the handler runs (/api/auth/me,
 *             /api/auth/change-password, /api/auth/logout-all)
 *
 * On a mutation, a resolved session always requires a matching X-CSRF-Token.
 */
enum RouteAuth
{
    case None;
    case Optional;
    case Required;
}
