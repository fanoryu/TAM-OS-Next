<?php
declare(strict_types=1);

namespace TamOs\Http;

use TamOs\Config\Config;
use TamOs\Data\DatabaseError;
use TamOs\Identity\PrincipalResolver;
use TamOs\Log\Logger;

/**
 * The request pipeline and the single exception boundary.
 *
 *   route (404 / 405) → mutation guards: origin (403), Content-Type (415), size (413),
 *   JSON object (400) → query allow-list (400) → principal → handler → envelope
 *
 * Any ApiError becomes its fixed envelope; a DatabaseError becomes service_unavailable or
 * internal_error by kind; any other Throwable becomes internal_error. Failures are logged,
 * redacted, server-side only. Nothing a handler throws reaches the client.
 */
final class Kernel
{
    public const MAX_QUERY_LENGTH = 2048;

    private readonly Router $router;
    private readonly OriginGuard $originGuard;

    /** @param list<Route> $routes */
    public function __construct(
        array $routes,
        private readonly PrincipalResolver $principals,
        private readonly Config $config,
        private readonly Logger $logger,
    ) {
        $this->router = new Router($routes);
        $this->originGuard = new OriginGuard($config->origin);
    }

    public function handle(Request $request, string $requestId, ?int $startedNs = null): Response
    {
        $startedNs ??= hrtime(true);
        $route = null;
        $error = null;
        $reason = null;
        try {
            $route = $this->router->match($request->method, $request->path);
            $json = $request->isMutation() ? $this->guardMutation($request) : [];
            $this->checkQuery($request->query, $route->queryKeys);
            $principal = $this->principals->resolve($request);
            $response = Response::success(($route->handler)($request, $principal, $json), $requestId);
        } catch (ApiError $e) {
            $error = $e->errorCode->value;
            $reason = $e->logReason;
            $response = Response::error($e->errorCode, $requestId, $e);
        } catch (DatabaseError $e) {
            // Unreachable or transient (deadlock, lock wait) → 503; any other database failure → 500.
            $code = $e->kind === DatabaseError::FAILURE ? ErrorCode::InternalError : ErrorCode::ServiceUnavailable;
            $error = $code->value;
            $this->logger->database($requestId, $e);
            $response = Response::error($code, $requestId);
        } catch (\Throwable $e) {
            $error = ErrorCode::InternalError->value;
            $this->logger->exception($requestId, $e);
            $response = Response::error(ErrorCode::InternalError, $requestId);
        }

        if ($this->config->isProduction() && $request->isHttps) {
            $response = $response->withHeader('Strict-Transport-Security', ApiHeaders::HSTS);
        }
        $this->logger->access(
            $requestId,
            $request->method,
            $route?->path,
            $response->status,
            intdiv(hrtime(true) - $startedNs, 1000000),
            $error,
            $reason,
        );
        return $response;
    }

    /** @return array<string, mixed> the decoded JSON object */
    private function guardMutation(Request $request): array
    {
        if (!$this->originGuard->allows($request->origin, $request->referer)) {
            throw new ApiError(ErrorCode::Forbidden, 'origin check failed');
        }
        if (!JsonBody::isJsonContentType($request->contentType)) {
            throw new ApiError(ErrorCode::UnsupportedMediaType);
        }
        if ($request->bodyTooLarge) {
            throw new ApiError(ErrorCode::PayloadTooLarge);
        }
        return JsonBody::decode($request->body);
    }

    /** @param list<string> $allowedKeys */
    private function checkQuery(string $query, array $allowedKeys): void
    {
        if ($query === '') {
            return;
        }
        if (strlen($query) > self::MAX_QUERY_LENGTH) {
            throw new ApiError(ErrorCode::InvalidQuery, 'query too long');
        }
        $seen = [];
        foreach (explode('&', $query) as $pair) {
            $key = rawurldecode(explode('=', $pair, 2)[0]);
            $value = rawurldecode(explode('=', $pair, 2)[1] ?? '');
            if (!in_array($key, $allowedKeys, true) || isset($seen[$key]) || preg_match('//u', $value) !== 1) {
                throw new ApiError(ErrorCode::InvalidQuery, 'query key rejected');
            }
            $seen[$key] = true;
        }
    }
}
