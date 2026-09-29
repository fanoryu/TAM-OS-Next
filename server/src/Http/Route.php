<?php
declare(strict_types=1);

namespace TamOs\Http;

/** One explicit route: an exact method and path, a handler, and its accepted query keys. */
final class Route
{
    /**
     * @param \Closure(Request, ?object, array<string, mixed>): mixed $handler  principal, decoded JSON body
     * @param list<string>                       $queryKeys
     */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly \Closure $handler,
        public readonly array $queryKeys = [],
    ) {
    }
}
