<?php
declare(strict_types=1);

/*
 * TAM OS backend configuration — EXAMPLE ONLY. Holds no secret and no real value.
 *
 * Copy to config.local.php (ignored by Git through `config.local.*`) and replace every
 * CHANGE_ME: the loader refuses any value that still contains it. In production the real
 * file lives OUTSIDE the public web root (<document root>/../config/config.local.php), or
 * wherever TAMOS_CONFIG points; the loader also refuses a file or log inside the document
 * root. Whether the host permits that placement is pre-deployment evidence (SDR-0002 E1).
 *
 * Unknown keys are rejected, so a typo fails closed instead of being ignored.
 * BF-1 has no database: database settings arrive with the data-layer slice (BF-2).
 */
return [
    // 'production' | 'development' | 'test'. Production requires an https:// origin.
    'env' => 'CHANGE_ME',

    // The canonical frontend origin, scheme://host[:port], no path or trailing slash.
    // State-changing requests must come from exactly this origin.
    'origin' => 'https://CHANGE_ME.invalid',

    // Absolute path of the JSON-lines API log. Must be outside the public web root.
    'log_path' => '/CHANGE_ME/outside-web-root/logs/api.log',

    // Maximum request body in bytes (default 65536, at most 1048576).
    'body_limit_bytes' => 65536,
];
