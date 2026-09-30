<?php
declare(strict_types=1);

namespace TamOs\Http;

use TamOs\Policy\Action;

/**
 * One explicit route: an exact method and path, a handler, its accepted query keys, whether the
 * kernel resolves a session for it (RouteAuth::None unless stated), and — for a business
 * mutation — the server Action it performs (SDR-0002 §7).
 *
 * A route that declares an Action is a mutation that requires a session; anything else is a
 * construction error. That every production business mutation declares one is enforced by
 * Routes::validate().
 */
final class Route
{
    /**
     * @param \Closure(Request, ?\TamOs\Identity\AuthSession, array<string, mixed>, string): mixed $handler  session, decoded JSON body, request ID
     * @param list<string>                       $queryKeys
     */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly \Closure $handler,
        public readonly array $queryKeys = [],
        public readonly RouteAuth $auth = RouteAuth::None,
        public readonly ?Action $action = null,
    ) {
        if ($action !== null && (!$this->isMutation() || $auth !== RouteAuth::Required)) {
            throw new \LogicException('a route with an Action must be a mutation that requires a session');
        }
    }

    public function isMutation(): bool
    {
        return in_array($this->method, Request::MUTATION_METHODS, true);
    }
}
