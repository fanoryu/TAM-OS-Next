<?php
declare(strict_types=1);

/*
 * Development-only router for PHP's built-in server. NEVER deployed.
 *
 * It stands in for server/public/api/.htaccess: /api and /api/* go to the front controller;
 * everything else is left to the built-in server, so the frontend package can be served
 * from the same origin:
 *
 *   TAMOS_CONFIG=/abs/path/config.local.php \
 *     php -S 127.0.0.1:8766 -t dist/package server/dev/router.php
 */
$uri = is_string($_SERVER['REQUEST_URI'] ?? null) ? $_SERVER['REQUEST_URI'] : '/';
// Raw prefix match: malformed /api… forms must reach the kernel (which answers 404), not
// the static file handler.
if (str_starts_with($uri, '/api')) {
    require dirname(__DIR__) . '/public/api/index.php';
    return true;
}
return false;
