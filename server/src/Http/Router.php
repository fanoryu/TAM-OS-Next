<?php
declare(strict_types=1);

namespace TamOs\Http;

/**
 * Exact-match routing over an explicit table — no patterns, no parameters.
 *
 * A path is accepted only in canonical form: `/api` followed by lower-case segments of
 * [a-z0-9-]. Anything else (dots, percent-encoding, `//`, a trailing slash, NUL, upper
 * case, over-long) is not found, so traversal and encoding tricks never reach a handler.
 */
final class Router
{
    public const MAX_PATH_LENGTH = 256;
    private const CANONICAL_PATH = '#^/api(/[a-z0-9]+(-[a-z0-9]+)*)*$#';

    /** @param list<Route> $routes */
    public function __construct(private readonly array $routes)
    {
    }

    public static function isCanonicalPath(string $path): bool
    {
        return strlen($path) <= self::MAX_PATH_LENGTH && preg_match(self::CANONICAL_PATH, $path) === 1;
    }

    /** @throws ApiError not_found or method_not_allowed (with Allow) */
    public function match(string $method, string $path): Route
    {
        if (!self::isCanonicalPath($path)) {
            throw new ApiError(ErrorCode::NotFound, 'non-canonical path');
        }
        $allowed = [];
        foreach ($this->routes as $route) {
            if ($route->path !== $path) {
                continue;
            }
            if ($route->method === $method || ($method === 'HEAD' && $route->method === 'GET')) {
                return $route;
            }
            $allowed[] = $route->method;
            if ($route->method === 'GET') {
                $allowed[] = 'HEAD';
            }
        }
        if ($allowed === []) {
            throw new ApiError(ErrorCode::NotFound, 'no route');
        }
        $allowed = array_values(array_unique($allowed));
        sort($allowed);
        throw new ApiError(ErrorCode::MethodNotAllowed, 'method not routed', $allowed);
    }
}
