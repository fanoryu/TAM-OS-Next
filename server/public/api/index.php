<?php
declare(strict_types=1);

/*
 * TAM OS API front controller (BF-1).
 * Deployed at <document root>/api/; the backend source lives outside the web root at
 * <document root>/../src/ (server/ in the repository). No logic, configuration or secret
 * belongs here: it only enters the bootstrap and hands the request to the kernel.
 */
require dirname(__DIR__, 2) . '/src/bootstrap.php';

\TamOs\run();
