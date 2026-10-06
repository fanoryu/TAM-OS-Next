<?php
declare(strict_types=1);

/*
 * TAM OS backend bootstrap (BF-1; session wiring BF-3A).
 * Registers the internal autoloader (no Composer) and defines run(), the production
 * request entry. Including this file has no other side effect, so the test harness can
 * load the classes without dispatching a request.
 */

namespace TamOs;

use TamOs\Auth\AccountLifecycle;
use TamOs\Auth\AccountRecovery;
use TamOs\Auth\Authenticator;
use TamOs\Config\ConfigError;
use TamOs\Config\ConfigLoader;
use TamOs\Controller\AuthController;
use TamOs\Controller\EmployeeController;
use TamOs\Controller\FinanceController;
use TamOs\Controller\FinanceExecutionController;
use TamOs\Controller\OvertimeController;
use TamOs\Controller\PayrollController;
use TamOs\Controller\SupplementalController;
use TamOs\Data\Auth\AuthData;
use TamOs\Data\BusinessData;
use TamOs\Data\Readiness;
use TamOs\Employee\AccountService;
use TamOs\Employee\EmployeeService;
use TamOs\Finance\FinanceExecutionService;
use TamOs\Finance\FinancePostingService;
use TamOs\Http\ErrorCode;
use TamOs\Http\Kernel;
use TamOs\Http\Request;
use TamOs\Http\RequestId;
use TamOs\Http\Response;
use TamOs\Http\Routes;
use TamOs\Overtime\OvertimeService;
use TamOs\Payroll\PayrollService;
use TamOs\Supplemental\SupplementalService;
use TamOs\Identity\SessionPrincipalResolver;
use TamOs\Log\Logger;

spl_autoload_register(static function (string $class): void {
    if (!str_starts_with($class, 'TamOs\\')) {
        return;
    }
    $relative = str_replace('\\', '/', substr($class, strlen('TamOs\\')));
    if (!preg_match('#^[A-Za-z][A-Za-z0-9]*(/[A-Za-z][A-Za-z0-9]*)*$#', $relative)) {
        return;
    }
    $file = __DIR__ . '/' . $relative . '.php';
    if (is_file($file)) {
        require $file;
    }
});

/** Warnings, notices and deprecations become exceptions, so they reach the error boundary. */
function installErrorHandler(): void
{
    set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
        if (!(error_reporting() & $severity)) {
            return false;
        }
        throw new \ErrorException($message, 0, $severity, $file, $line);
    });
}

/**
 * Runtime hardening applied before any request work. Stack traces never carry call
 * arguments (a failed `new PDO(…)` would otherwise record the password in the trace), and
 * errors are never displayed.
 */
function hardenRuntime(): void
{
    ini_set('zend.exception_ignore_args', '1');
    ini_set('display_errors', '0');
    ini_set('display_startup_errors', '0');
    ini_set('html_errors', '0');
    error_reporting(E_ALL);
}

/** Production entry: one request in, one JSON response out. */
function run(): void
{
    hardenRuntime();
    header_remove('X-Powered-By');
    installErrorHandler();
    ob_start();

    $requestId = RequestId::generate();
    $started = hrtime(true);

    // A fatal error bypasses every catch block; answer with the generic 500 envelope.
    register_shutdown_function(static function () use ($requestId): void {
        $error = error_get_last();
        $fatal = E_ERROR | E_PARSE | E_CORE_ERROR | E_COMPILE_ERROR | E_USER_ERROR;
        if ($error !== null && ($error['type'] & $fatal) !== 0 && !headers_sent()) {
            Response::error(ErrorCode::InternalError, $requestId)->emit(false);
        }
    });

    try {
        $config = ConfigLoader::load(ConfigLoader::resolvePath(), Request::documentRootFromGlobals());
    } catch (ConfigError $e) {
        // Fail closed. The reason is a fixed code; configuration values are never logged.
        error_log('tamos: configuration rejected (' . $e->reason . ')');
        Response::error(ErrorCode::ServiceUnavailable, $requestId)->emit(Request::isHeadFromGlobals());
        return;
    }

    $logger = new Logger($config->logPath, $config->env);
    $request = Request::fromGlobals($config->bodyLimitBytes);
    // Readiness connects lazily, only when /api/ready runs. AuthData connects lazily, only
    // when an auth route needs it — never for /api/health or /api/ready (RouteAuth::None).
    $readiness = new Readiness($config, dirname(__DIR__) . '/migrations');
    $auth = AuthData::fromConfig($config);
    // BF-4a1: the business stores share the request's lazy connection with the auth stores.
    $business = BusinessData::fromConnector($auth->connector());
    $routes = Routes::production(
        $readiness,
        new AuthController(new Authenticator($auth), new AccountLifecycle($auth), new AccountRecovery($auth)),
        new EmployeeController(new EmployeeService($business), new AccountService($business, $auth)),
        new OvertimeController(new OvertimeService($business)),
        new PayrollController(new PayrollService($business)),
        new SupplementalController(new SupplementalService($business)),
        new FinanceController(new FinancePostingService($business)),
        new FinanceExecutionController(new FinanceExecutionService($business)),
    );
    $kernel = new Kernel($routes, new SessionPrincipalResolver($auth), $config, $logger);
    $kernel->handle($request, $requestId, $started)->emit($request->method === 'HEAD');
}
