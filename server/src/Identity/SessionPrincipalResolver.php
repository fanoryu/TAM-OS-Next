<?php
declare(strict_types=1);

namespace TamOs\Identity;

use TamOs\Auth\SessionToken;
use TamOs\Data\Auth\AuthData;
use TamOs\Http\Request;

/**
 * The production resolver: session cookie → shape check → SHA-256 → one database read of the
 * session, its user and every membership → Principal::fromAccount (fails closed) → touch.
 *
 * The only request input is the session token. Role, user, membership, company and employee
 * come from the database on every request, so a disabled account, a role change or a new
 * employee binding takes effect on the next request. The touch runs after validation and
 * repeats every validity predicate; a session revoked between the read and the touch still
 * completes this one request (a documented one-request window) and fails from the next.
 */
final class SessionPrincipalResolver implements PrincipalResolver
{
    public function __construct(private readonly AuthData $data)
    {
    }

    public function resolve(Request $request): ?AuthSession
    {
        $token = $request->sessionToken;
        if ($token === null || !SessionToken::isWellFormed($token)) {
            return null;
        }
        $hash = SessionToken::hash($token);
        $sessions = $this->data->sessions();
        $found = $sessions->findActive($hash);
        if ($found === null) {
            return null;
        }
        $principal = Principal::fromAccount($found['user'], $found['memberships']);
        if ($principal === null) {
            return null;
        }
        if ($found['touchDue']) {
            $sessions->touch($hash);
        }
        return new AuthSession($principal, $found['csrfToken']);
    }
}
