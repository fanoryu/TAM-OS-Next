<?php
declare(strict_types=1);

namespace TamOs\Http;

/**
 * One explicit route: an exact method and path, a handler, its accepted query keys, and
 * whether the kernel resolves a session for it (RouteAuth::None unless stated).
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
    ) {
    }
}
