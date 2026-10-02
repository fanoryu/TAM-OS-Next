#!/usr/bin/env node
/*
 * verify-backend-boundary.js — TAM OS (Backend Foundation, BF-1 / BF-2A)
 * -----------------------------------------------------------------
 * Static enforcement of the backend's architectural boundary (ADR-0004 §2.3, SDR-0002 §8.2).
 * MariaDB has no Row-Level Security, so "SQL and database access exist only in the data-access
 * layer" must be a mechanical rule, not a convention. This tool fails the build when:
 *
 *   - PDO, ->prepare, the Database / DatabaseConfig handle or SQL statements appear outside
 *     server/src/Data/ (the data-access layer), or mysqli, ->query or ->exec appear anywhere;
 *   - SQL inside server/src/Data/ is interpolated ("… $x …") or built by concatenation or
 *     sprintf — variable values must be bound parameters;
 *   - production PHP uses eval, process execution, unserialize, extract, phpinfo, var_dump,
 *     print_r, session_start, setcookie, CORS headers, or request superglobals outside the one
 *     class allowed to read them;
 *   - a PHP file lacks declare(strict_types=1);
 *   - a Composer manifest, vendor tree, .sql file or .env appears under server/;
 *   - a PrincipalResolver other than NullPrincipalResolver / SessionPrincipalResolver exists;
 *   - (BF-3A) PHP's password API is called outside server/src/Auth/Passwords.php; the session
 *     cookie name appears outside server/src/Http/SessionCookie.php, a Set-Cookie header name
 *     outside server/src/Http/Kernel.php, or HTTP_COOKIE outside Request.php; $_COOKIE is read
 *     anywhere; Principal::fromAccount() is called outside the resolver and the Authenticator,
 *     or a Principal / AuthSession is constructed outside server/src/Identity/; a CSRF token is
 *     compared with anything but hash_equals(); SQL rewrites or removes auth_events rows; or a
 *     migration seeds rows (INSERT / UPDATE / DELETE / REPLACE / LOAD DATA) — the one exception is
 *     the BF-4a1 legacy employee backfill, admitted only at its pinned digest;
 *   - (BF-3B) a file other than migrate.php and account.php appears under server/bin/, or a CLI
 *     entry point lacks its SAPI guard; SQL writing companies, users or memberships appears
 *     outside server/src/Data/Auth/AccountStore.php, or SQL writing account_tokens outside
 *     server/src/Data/Auth/AccountTokenStore.php;
 *   - (BF-3C) an Authorization is constructed outside server/src/Policy/Policy.php or a
 *     ScopedRecord outside server/src/Data/Scope/ScopedDatabase.php; or server/src/Policy/Action.php
 *     differs from js/core/authz.js in its 21 action values, a rule class or a resource entity
 *     (parity fails closed when either side cannot be read); a migration creates a table that is
 *     neither an auth/system table nor a registered company table with the tenant key
 *     (company_id NOT NULL, FK to companies, UNIQUE (company_id, id)), or any migration foreign
 *     key cascades, nulls or defaults; a business store (server/src/Data/<Domain>/) references the
 *     Database handle or AuthData instead of ScopedDatabase, or holds a statement without
 *     :company_id, with a positional ?, or a *_SELF_SQL without :self_employee_id; or a company
 *     table (employees) is named in SQL outside a business store. Heuristic shape checks only —
 *     tenant isolation is proven by construction, the MariaDB and hostile-principal tests;
 *   - (BF-3D) network or mail I/O (curl_*, mail, fsockopen, stream sockets, stream contexts)
 *     appears outside server/src/Mail/ResendTransport.php, the adapter is named outside
 *     server/src/Mail/, or the provider endpoint appears outside the adapter; mail_outbox is
 *     written outside server/src/Data/Auth/MailOutboxStore.php; a token or link variable is
 *     printed, written or logged anywhere but the operator account CLI; a Resend-shaped key
 *     appears anywhere; the `#recovery=` link is built outside server/src/Mail/RecoveryMail.php;
 *     the Host or a forwarding header is read anywhere (server/bin/mail.php joins the CLI files);
 *   - (BF-4a2, SDR-0004) the `#activation=` link is built outside server/src/Mail/ActivationMail.php;
 *     the Employee account-administration code (server/src/Employee/, the Employee controller)
 *     names a token primitive or a mail builder — it only queues delivery intent; an account
 *     route does not declare account.manage, or account.manage is declared by any other route;
 *     an audit append or an outbox enqueue sits outside ->atomically(...);
 *   - server/src/Http/ApiHeaders.php drifts from tools/package-headers.js (the canonical contract);
 *   - a server/ file is ignored by .gitignore (the `*secret*` / `*credentials*` traps) or is
 *     present but untracked.
 *
 * Checks run on PHP code with comments removed and string literals blanked, and SQL detection
 * runs on string literals only, so prose such as "no eval()" in a comment never trips a rule.
 *
 * Usage:
 *   node tools/verify-backend-boundary.js             # check the repository
 *   node tools/verify-backend-boundary.js --selftest  # prove every rule passes clean code and catches violations
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const SERVER = 'server';
const DATA_DIR = 'server/src/Data/';
// Slice gate: directories that arrive with later, separately authorized slices. Remove an entry
// only in that slice. server/src/Data was un-gated by BF-2A; server/migrations and server/bin by
// BF-2B, each narrowly (see checkTree); server/src/Policy by BF-3C.
const NOT_YET_AUTHORIZED = [];
// The only files allowed under server/bin/ (BF-2B migrate, BF-3B account, BF-3D mail), and the
// only shape a migration file may have.
const CLI_FILES = new Set(['server/bin/migrate.php', 'server/bin/account.php', 'server/bin/mail.php']);
const MIGRATION_FILE = /^server\/migrations\/\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const SUPERGLOBAL_READERS = new Set(['server/src/Http/Request.php', 'server/dev/router.php']);
const HEADER_EMITTERS = new Set(['server/src/Http/Response.php', 'server/src/bootstrap.php']);
const INI_WRITERS = new Set(['server/src/bootstrap.php']);
// The autoloader (validated class path) and the config loader are the only variable includes.
const INCLUDE_ALLOWED = new Set(['server/src/bootstrap.php', 'server/src/Config/ConfigLoader.php']);
// BF-3A: the test-only null resolver and the one authoritative, database-backed resolver.
const RESOLVERS_ALLOWED = new Set(['server/src/Identity/NullPrincipalResolver.php', 'server/src/Identity/SessionPrincipalResolver.php']);
const PASSWORDS_FILE = 'server/src/Auth/Passwords.php';
const SESSION_COOKIE_FILE = 'server/src/Http/SessionCookie.php';
const KERNEL_FILE = 'server/src/Http/Kernel.php';
const REQUEST_FILE = 'server/src/Http/Request.php';
// Principal::fromAccount() is the only way to build an identity; only these may call it.
const PRINCIPAL_BUILDERS = new Set(['server/src/Identity/SessionPrincipalResolver.php', 'server/src/Auth/Authenticator.php']);
const IDENTITY_DIR = 'server/src/Identity/';
// BF-3B: accounts and account tokens are written by exactly one store each, so no HTTP path can
// create a company, user or membership outside the advisory-locked operator bootstrap.
const ACCOUNT_STORE = 'server/src/Data/Auth/AccountStore.php';
const TOKEN_STORE = 'server/src/Data/Auth/AccountTokenStore.php';
const LOCAL_CONFIG = /^server\/config\/config\.local\.php$/;
// BF-3C: the capability objects. An Authorization is minted only by Policy::authorize(), and a
// ScopedRecord only by the scoped data layer, so neither can be forged by a controller.
const POLICY_FILE = 'server/src/Policy/Policy.php';
const SCOPED_DATABASE = 'server/src/Data/Scope/ScopedDatabase.php';
// BF-3C: the server ACTION vocabulary and the frontend one it must equal.
const ACTION_FILE = 'server/src/Policy/Action.php';
const FRONTEND_AUTHZ = 'js/core/authz.js';
// BF-3D governed mail (SDR-0003): the outbox has one writer; network and mail primitives exist
// only in the one provider adapter, and only the Mail boundary may name that adapter, so no
// application or authentication code can depend on the provider or send mail directly.
const OUTBOX_STORE = 'server/src/Data/Auth/MailOutboxStore.php';
const MAIL_DIR = 'server/src/Mail/';
const MAIL_ADAPTER = 'server/src/Mail/ResendTransport.php';
const RECOVERY_MAIL = 'server/src/Mail/RecoveryMail.php';
// BF-4a2: the activation link has one builder; account administration never touches a token.
const ACTIVATION_MAIL = 'server/src/Mail/ActivationMail.php';
const EMPLOYEE_DIR = 'server/src/Employee/';
const EMPLOYEE_CONTROLLER = 'server/src/Controller/EmployeeController.php';
const ACCOUNT_ROUTES = ['/api/employees/provision-account', '/api/employees/reissue-activation', '/api/employees/disable-account', '/api/employees/enable-account'];
// The only production place a raw one-time token is printed: the operator CLI, once, by design.
const TOKEN_PRINTERS = new Set(['server/bin/account.php']);
// BF-4a1: the Employee record and the append-only business audit trail.
const EMPLOYEE_STORE = 'server/src/Data/Employee/EmployeeStore.php';
const AUDIT_LOG = 'server/src/Data/Audit/AuditLog.php';
const ROUTES_FILE = 'server/src/Http/Routes.php';
// BF-4b1: the overtime record has one writer, and its only hard delete removes a Draft. Each
// overtime write route declares exactly its existing overtime Action (ACTIONS stay 21).
const OVERTIME_STORE = 'server/src/Data/Overtime/OvertimeStore.php';
const OVERTIME_ROUTES = {
  '/api/overtime-records/create': 'OvertimeCreateSelfDraft',
  '/api/overtime-records/update': 'OvertimeUpdateSelfDraft',
  '/api/overtime-records/delete': 'OvertimeDeleteSelfDraft',
  '/api/overtime-records/submit': 'OvertimeSubmitSelf',
  '/api/overtime-records/review': 'OvertimeManage',
  '/api/overtime-records/reject': 'OvertimeManage',
};

// ---------------------------------------------------------------------------------------------
// A small PHP lexer: splits source into code (comments removed, strings blanked) and the list
// of string-literal contents. Heredoc/nowdoc are rejected outright so the lexer stays sound.
// ---------------------------------------------------------------------------------------------
function lexPhp(src) {
  let code = '';
  const strings = [];
  const spans = []; // { start, end, value, dq } — positions in `code`
  let i = 0;
  let heredoc = false;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '#' && next !== '[') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      code += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (c === '<' && src.startsWith('<<<', i)) {
      heredoc = true;
      code += '<<<';
      i += 3;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let value = '';
      while (j < n && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < n) {
          value += src[j] + src[j + 1];
          j += 2;
          continue;
        }
        value += src[j];
        j++;
      }
      strings.push(value);
      const start = code.length;
      code += c + src.slice(i + 1, j).replace(/[^\n]/g, ' ') + c;
      spans.push({ start, end: code.length, value, dq: c === '"' });
      i = j + 1;
      continue;
    }
    code += c;
    i++;
  }
  return { code, strings, spans, heredoc };
}

// ---------------------------------------------------------------------------------------------
// Rules. Each returns a list of violation messages for one file.
// ---------------------------------------------------------------------------------------------
const CODE_RULES = [
  { id: 'eval', re: /(?<![\w$>:])eval\s*\(/i, msg: 'eval() is forbidden' },
  { id: 'process', re: /(?<![\w$>:])(exec|shell_exec|system|passthru|proc_open|popen|pcntl_exec)\s*\(/i, msg: 'process execution is forbidden' },
  { id: 'backtick', re: /`/, msg: 'backtick shell execution is forbidden' },
  { id: 'unserialize', re: /(?<![\w$>:])unserialize\s*\(/i, msg: 'unserialize() is forbidden' },
  { id: 'extract', re: /(?<![\w$>:])extract\s*\(/i, msg: 'extract() is forbidden' },
  { id: 'debug-output', re: /(?<![\w$>:])(phpinfo|var_dump|print_r|debug_zval_dump|debug_print_backtrace)\s*\(/i, msg: 'debug/introspection output is forbidden' },
  { id: 'session', re: /(?<![\w$>:])session_[a-z_]+\s*\(/i, msg: 'PHP native sessions are forbidden (SDR-0002 §3.1)' },
  { id: 'cookie', re: /(?<![\w$>:])set(raw)?cookie\s*\(/i, msg: 'setting cookies with setcookie() is forbidden: the session cookie is built by Http/SessionCookie and emitted through Response' },
  { id: 'password-api', re: /(?<![\w$>:])password_(hash|verify|needs_rehash|get_info|algos)\s*\(/i, msg: 'the password API is called only in ' + PASSWORDS_FILE, allow: (f) => f === PASSWORDS_FILE },
  { id: 'principal-builder', re: /\bPrincipal\s*::\s*fromAccount\s*\(/, msg: 'Principal::fromAccount() is called only by the session resolver and the Authenticator', allow: (f) => PRINCIPAL_BUILDERS.has(f) },
  { id: 'identity-construction', re: /\bnew\s+\\?(?:TamOs\\Identity\\)?(Principal|AuthSession)\s*\(/, msg: 'a Principal or AuthSession is constructed only inside ' + IDENTITY_DIR, allow: (f) => f.startsWith(IDENTITY_DIR) },
  { id: 'authorization-construction', re: /\bnew\s+\\?(?:TamOs\\Policy\\)?Authorization\s*\(/, msg: 'an Authorization is constructed only by ' + POLICY_FILE, allow: (f) => f === POLICY_FILE },
  { id: 'scoped-record-construction', re: /\bnew\s+\\?(?:TamOs\\Data\\Scope\\)?ScopedRecord\s*\(/, msg: 'a ScopedRecord is constructed only by ' + SCOPED_DATABASE, allow: (f) => f === SCOPED_DATABASE },
  { id: 'network-io', re: /(?<![\w$>:])(curl_[a-z_]+|mail|mb_send_mail|fsockopen|pfsockopen|stream_socket_client|socket_create|socket_connect|stream_context_create)\s*\(/i, msg: 'network and mail I/O is performed only by the governed mail adapter ' + MAIL_ADAPTER, allow: (f) => f === MAIL_ADAPTER },
  { id: 'mail-adapter-name', re: /\bResendTransport\b/, msg: 'only the Mail boundary (' + MAIL_DIR + ') may name the provider adapter; everything else uses MailTransport', allow: (f) => f.startsWith(MAIL_DIR) },
  { id: 'token-output', re: /\b(echo|print|printf|fwrite|fputs|error_log|file_put_contents|var_export)\b[^;]*\$\w*(token|link)\b/i, msg: 'a raw token or recovery link is never printed, written or logged (only the operator CLI prints its activation token)', allow: (f) => TOKEN_PRINTERS.has(f) },
  { id: 'account-admin-token', re: /\b(SessionToken|AccountTokenStore|ActivationMail|RecoveryMail|MailTransport)\b|->\s*issue\s*\(/, msg: 'Employee account administration never issues a token or builds a mail: it only queues delivery intent; the outbox worker issues the token at send time (SDR-0004 §4)', allow: (f) => !(f.startsWith(EMPLOYEE_DIR) || f === EMPLOYEE_CONTROLLER) },
  { id: 'dynamic-include', re: /\b(include|include_once|require|require_once)\b\s*\(?\s*\$/i, msg: 'include/require of a variable path is forbidden', allow: (f) => INCLUDE_ALLOWED.has(f) },
];
// Banned in every production file, the data layer included.
const EVERYWHERE_RULES = [
  { id: 'mysqli', re: /\bmysqli\b|(?<![\w$>:])mysqli?_[a-z_]+\s*\(/i, msg: 'mysqli/mysql functions are forbidden (PDO only)' },
  { id: 'raw-query', re: /->\s*query\s*\(/i, msg: '->query() is forbidden: every statement is prepared' },
  { id: 'raw-exec', re: /->\s*exec\s*\(/i, msg: '->exec() is forbidden: migration DDL also runs as a prepared statement' },
];
// Allowed only inside server/src/Data/.
const DATA_RULES = [
  { id: 'pdo', re: /\bPDO\b|\bPDOStatement\b/, msg: 'PDO is allowed only in ' + DATA_DIR },
  { id: 'db-method', re: /->\s*prepare\s*\(/i, msg: '->prepare() is allowed only in ' + DATA_DIR },
  { id: 'db-handle', re: /\bDatabase(Config)?\b/, msg: 'the Database / DatabaseConfig handle is used only inside ' + DATA_DIR + ' (no DAL bypass)' },
];
// Upper-case SQL keywords mark a literal as a SQL fragment for the interpolation and
// concatenation rules below (project SQL is written in upper case). One flat alternation.
const SQL_KEYWORD = /\b(SELECT|INSERT|UPDATE|DELETE|REPLACE|FROM|WHERE|VALUES|SET|JOIN|INTO|LIMIT|HAVING|UNION|ORDER BY|GROUP BY)\b/;
const SQL_BUILDERS = /\b(sprintf|vsprintf|str_replace|strtr|implode|join)\s*\(\s*$/i;
// SELECT needs SQL shape after FROM (end of string, `;`, or a clause keyword), so prose such as
// "Select a principal from the list" is not mistaken for a query.
const SQL_STRING = /^\s*(SELECT\s+[\s\S]+?\s+FROM\s+[`\w.]+\s*(;|$|\b(WHERE|JOIN|INNER|LEFT|RIGHT|ORDER|GROUP|LIMIT|FOR|AS|UNION)\b)|INSERT\s+(IGNORE\s+)?INTO\b|UPDATE\s+[`\w.]+\s+SET\b|DELETE\s+FROM\b|REPLACE\s+INTO\b|(CREATE|ALTER|DROP)\s+(TEMPORARY\s+)?(TABLE|DATABASE|SCHEMA|INDEX|VIEW|USER|TRIGGER|PROCEDURE|FUNCTION)\b|TRUNCATE\s+(TABLE\s+)?[`\w]|GRANT\s+\w|REVOKE\s+\w|LOCK\s+TABLES?\b|SET\s+(NAMES|SESSION|GLOBAL|TRANSACTION)\b|(START\s+TRANSACTION|BEGIN\s+WORK)\b)/i;
const STRING_RULES = [
  { id: 'cors', re: /access-control-allow/i, msg: 'CORS headers are forbidden (SDR-0002 §13.2)' },
  { id: 'php-input', re: /^php:\/\/input$/i, msg: 'php://input is read only by server/src/Http/Request.php', allow: (f) => f === 'server/src/Http/Request.php' },
  { id: 'session-cookie-name', re: /__Host-tamos_session/i, msg: 'the session cookie name appears only in ' + SESSION_COOKIE_FILE, allow: (f) => f === SESSION_COOKIE_FILE },
  { id: 'set-cookie', re: /^\s*set-cookie\s*:?\s*$/i, msg: 'the Set-Cookie header is added only by ' + KERNEL_FILE, allow: (f) => f === KERNEL_FILE },
  { id: 'http-cookie', re: /^HTTP_COOKIE$/, msg: 'HTTP_COOKIE is read only by ' + REQUEST_FILE, allow: (f) => f === REQUEST_FILE },
  { id: 'auth-events-rewrite', re: /\bauth_events\b[\s\S]*\b(UPDATE|DELETE|REPLACE|TRUNCATE|ALTER|DROP)\b|\b(UPDATE|DELETE|REPLACE|TRUNCATE|ALTER|DROP)\b[\s\S]*\bauth_events\b/i, msg: 'auth_events is append-only: no UPDATE, DELETE, REPLACE, TRUNCATE, ALTER or DROP' },
  { id: 'account-writes', re: /^\s*(INSERT\s+(IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+`?(companies|users|memberships)\b/i, msg: 'companies, users and memberships are written only by ' + ACCOUNT_STORE, allow: (f) => f === ACCOUNT_STORE },
  { id: 'token-writes', re: /^\s*(INSERT\s+(IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+`?account_tokens\b/i, msg: 'account_tokens is written only by ' + TOKEN_STORE, allow: (f) => f === TOKEN_STORE },
  { id: 'outbox-writes', re: /^\s*(INSERT\s+(IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+`?mail_outbox\b/i, msg: 'mail_outbox is written only by ' + OUTBOX_STORE, allow: (f) => f === OUTBOX_STORE },
  // BF-4a1: employee.delete is a soft archive — no statement anywhere hard-deletes an employee;
  // the audit trail is append-only — nothing updates, deletes, replaces or truncates it.
  { id: 'employee-writes', re: /^\s*(INSERT\s+(IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE)\s+`?employees\b/i, msg: 'employees is written only by ' + EMPLOYEE_STORE, allow: (f) => f === EMPLOYEE_STORE },
  { id: 'employee-hard-delete', re: /^\s*(DELETE\s+FROM|TRUNCATE(\s+TABLE)?)\s+`?employees\b/i, msg: 'an employee is never hard-deleted (employee.delete is a soft archive)' },
  { id: 'overtime-writes', re: /^\s*(INSERT\s+(IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+`?overtime_records\b/i, msg: 'overtime_records is written only by ' + OVERTIME_STORE, allow: (f) => f === OVERTIME_STORE },
  { id: 'overtime-truncate', re: /^\s*TRUNCATE(\s+TABLE)?\s+`?overtime_records\b/i, msg: 'overtime_records is never truncated' },
  { id: 'audit-append-only', re: /^\s*(UPDATE|DELETE\s+FROM|REPLACE\s+INTO|TRUNCATE(\s+TABLE)?)\s+`?audit_events\b/i, msg: 'audit_events is append-only: no UPDATE, DELETE, REPLACE or TRUNCATE' },
  { id: 'audit-writes', re: /^\s*INSERT\s+(IGNORE\s+)?INTO\s+`?audit_events\b/i, msg: 'audit_events is written only by ' + AUDIT_LOG, allow: (f) => f === AUDIT_LOG },
  { id: 'provider-endpoint', re: /api\.resend\.com/i, msg: 'the provider endpoint appears only in ' + MAIL_ADAPTER, allow: (f) => f === MAIL_ADAPTER },
  { id: 'recovery-link', re: /#recovery=/, msg: 'the recovery link is built only by ' + RECOVERY_MAIL + ' (from the configured origin)', allow: (f) => f === RECOVERY_MAIL },
  { id: 'activation-link', re: /#activation=/, msg: 'the activation link is built only by ' + ACTIVATION_MAIL + ' (from the configured origin)', allow: (f) => f === ACTIVATION_MAIL },
  { id: 'host-header', re: /^(HTTP_HOST|SERVER_NAME|HTTP_X_FORWARDED_HOST|HTTP_X_FORWARDED_PROTO|HTTP_FORWARDED)$/, msg: 'the Host and forwarding headers are never read: URLs come only from the configured origin' },
];
// A CSRF token is compared only with hash_equals(): an ordinary comparison (or strcmp) against
// anything but null is a timing leak. The kernel's comparison must be the hash_equals() one.
const CSRF_COMPARE = [
  /csrfToken\s*(?:===|!==|==|!=|<>)\s*(?!null\b)[$\w'"(]/i,
  /[$\w'")\]]\s*(?:===|!==|==|!=|<>)\s*\$[\w$>-]*csrfToken\b/i,
  /(?<![\w$>:])(strcmp|strcasecmp|strncmp|substr_compare)\s*\([^;]*csrfToken/i,
];
const KERNEL_CSRF = /hash_equals\s*\(\s*\$session->csrfToken\s*,\s*\$request->csrfToken\s*\)/;
function checkCsrfComparison(code) {
  // `null !== $x->csrfToken` is a presence check, not a comparison of secrets.
  const stripped = code.replace(/\bnull\s*(?:===|!==|==|!=)\s*/gi, '');
  return CSRF_COMPARE.some((re) => re.test(stripped)) ? ['a CSRF token is compared only with hash_equals()'] : [];
}
// Run on the real Kernel.php: the synchronizer-token check must exist, in its hash_equals form.
function checkKernelCsrf(src) {
  return KERNEL_CSRF.test(lexPhp(src).code) ? [] : ['the kernel must compare the session CSRF token with hash_equals($session->csrfToken, $request->csrfToken)'];
}
// A migration changes structure only: seed rows (a default CEO, credentials, business data)
// never ship in server/migrations/.
const MIGRATION_SEED = /\b(INSERT\s+(IGNORE\s+)?INTO|REPLACE\s+INTO|DELETE\s+FROM|LOAD\s+DATA|(?<!\bON\s+)UPDATE\s+(?:(?:LOW_PRIORITY|IGNORE)\s+)*[`\w.]+(?:\s+(?:AS\s+)?(?!SET\b)`?\w+`?)?\s*(?:SET|JOIN|INNER|LEFT|RIGHT|CROSS|STRAIGHT_JOIN|,\s*`?\w+))\b/i;
// BF-4a1 (owner decision D-BF4a1-MIGRATION-1 = A): the single exception. 0015 gives employee anchors
// that predate 0014 a LEGACY-NNNNNN placeholder code and name so 0016 can enforce the final schema.
// It is admitted only at exactly these bytes: any edit fails here before review, and MigrationSet's
// checksum makes an applied copy immutable. No other file may write rows.
const LEGACY_BACKFILL_FILE = 'server/migrations/0015_backfill_legacy_employees.sql';
const LEGACY_BACKFILL_SHA256 = '791505de8fe5b345c9c140e8aeb1cc6002229e646b3eb1bcb5b4f62e3f8d08b2';
function checkMigrationSql(src, file) {
  if (file === LEGACY_BACKFILL_FILE) {
    return crypto.createHash('sha256').update(src, 'utf8').digest('hex') === LEGACY_BACKFILL_SHA256 ? [] : ['the legacy employee backfill is admitted only at its pinned digest'];
  }
  return MIGRATION_SEED.test(src) ? ['a migration must not insert, update or delete rows (no seed data)'] : [];
}
// BF-3C tenant-key convention. The auth/system tables are not company-owned business data; every
// other table a migration creates must be registered in COMPANY_TABLES and carry the tenant key:
// `company_id CHAR(32) … NOT NULL`, a FK to companies, and a UNIQUE (company_id, id) that child
// tables reference with composite (company_id, …) FKs. A shape check, not a proof of isolation.
const SYSTEM_TABLES = new Set(['companies', 'users', 'memberships', 'sessions', 'auth_rate_limits', 'auth_events', 'account_tokens', 'schema_migrations', 'mail_outbox']);
const COMPANY_TABLES = new Set(['employees', 'audit_events', 'overtime_records']);
function checkMigrationTenantKey(src) {
  const created = /^\s*CREATE\s+TABLE\s+`?(\w+)`?/i.exec(src);
  if (!created) return [];
  const table = created[1].toLowerCase();
  if (SYSTEM_TABLES.has(table)) return [];
  const out = [];
  if (!COMPANY_TABLES.has(table)) out.push('table ' + table + ' is neither an auth/system table nor registered in COMPANY_TABLES');
  if (!/^\s*company_id\s+CHAR\(32\)\s+CHARACTER SET ascii COLLATE ascii_bin\s+NOT NULL,\s*$/im.test(src)) out.push('company table ' + table + ' needs `company_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL`');
  if (!/\bUNIQUE\s+KEY\s+\w+\s*\(\s*company_id\s*,\s*id\s*\)/i.test(src)) out.push('company table ' + table + ' needs UNIQUE KEY (company_id, id) for composite tenant FKs');
  if (!/\bFOREIGN\s+KEY\s*\(\s*company_id\s*\)\s*REFERENCES\s+companies\s*\(\s*id\s*\)/i.test(src)) out.push('company table ' + table + ' needs FOREIGN KEY (company_id) REFERENCES companies (id)');
  return out;
}
// No migration foreign key cascades, nulls or defaults: identity and tenant rows are never
// silently detached or moved (BF-3C, migration 0010 is RESTRICT).
function checkMigrationNoCascade(src) {
  return /\bON\s+(DELETE|UPDATE)\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT)\b/i.test(src) ? ['a migration foreign key may not CASCADE, SET NULL or SET DEFAULT'] : [];
}
// BF-4a1: migration versions are contiguous from 0001 (MigrationSet enforces it at run time; this
// catches a gap or a duplicate before review).
function checkMigrationContinuity(files) {
  const versions = files.filter((f) => MIGRATION_FILE.test(f)).map((f) => parseInt(path.posix.basename(f).slice(0, 4), 10)).sort((a, b) => a - b);
  for (let i = 0; i < versions.length; i++) {
    if (versions[i] !== i + 1) return ['migration versions must run 0001…' + String(versions.length).padStart(4, '0') + ' without a gap or a duplicate (found ' + String(versions[i]).padStart(4, '0') + ' at position ' + (i + 1) + ')'];
  }
  return [];
}

// BF-4a1 route metadata: every mutation route in Routes.php is either account self-service
// (listed in ACCOUNT_SELF_SERVICE, no Action) or declares its Action:: (Routes::validate also
// refuses it at bootstrap; this catches it before review).
function checkRouteActions(src) {
  const list = /ACCOUNT_SELF_SERVICE\s*=\s*\[([\s\S]*?)\];/.exec(src);
  if (!list) return ['Routes.php: ACCOUNT_SELF_SERVICE is not parseable'];
  const selfService = new Set([...list[1].matchAll(/'([A-Z]+ \/api\/[^']+)'/g)].map((m) => m[1]));
  const out = [];
  for (const m of src.matchAll(/new Route\('(POST|PUT|PATCH|DELETE)', '([^']+)'([^\n]*)/g)) {
    const key = m[1] + ' ' + m[2];
    const declares = /\bAction::[A-Z]\w*/.test(m[3]);
    if (selfService.has(key) && declares) out.push('Routes.php: self-service route ' + key + ' must not declare an Action');
    if (!selfService.has(key) && !declares) out.push('Routes.php: business mutation ' + key + ' must declare its Action::');
    // BF-4a2: exactly the four Employee account routes are account.manage.
    const accountManage = /\bAction::AccountManage\b/.test(m[3]);
    if (ACCOUNT_ROUTES.includes(m[2]) && !accountManage) out.push('Routes.php: account route ' + key + ' must declare Action::AccountManage');
    if (!ACCOUNT_ROUTES.includes(m[2]) && accountManage) out.push('Routes.php: ' + key + ' is not an Employee account route and must not declare Action::AccountManage');
  }
  for (const path of ACCOUNT_ROUTES) if (!src.includes("new Route('POST', '" + path + "'")) out.push('Routes.php: account route POST ' + path + ' is missing');
  for (const [path, action] of Object.entries(OVERTIME_ROUTES)) {
    const line = src.split('\n').find((l) => l.includes("new Route('POST', '" + path + "'"));
    if (!line) out.push('Routes.php: overtime route POST ' + path + ' is missing');
    else if (!new RegExp('\\bAction::' + action + '\\)').test(line)) out.push('Routes.php: overtime route POST ' + path + ' must declare Action::' + action);
  }  return out;
}

// BF-4a1, SDR-0002 §9.2: a business mutation and its audit row commit in one transaction. Every
// ->audit()->append( call sits inside an ->atomically( closure (parentheses matched on the lexed
// code, where strings are blanked and comments removed). A shape check; the DB rollback test proves it.
function checkAuditInTransaction(lex) {
  const code = lex.code;
  const ranges = [];
  const open = /->\s*atomically\s*\(/g;
  let m;
  while ((m = open.exec(code))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')' && --depth === 0) break;
    }
    ranges.push([m.index, i]);
  }
  const out = [];
  const append = /->\s*audit\s*\(\s*\)\s*->\s*append(Account|Overtime)?\s*\(/g;
  while ((m = append.exec(code))) {
    const at = m.index;
    if (!ranges.some(([a, b]) => at > a && at < b)) out.push('an audit row is appended only inside the transaction of the mutation it records (->atomically(...))');
  }
  // BF-4a2: delivery intent commits with the account change it belongs to.
  const enqueue = /->\s*outbox\s*\(\s*\)\s*->\s*enqueueOnce\s*\(/g;
  while ((m = enqueue.exec(code))) {
    const at = m.index;
    if (!ranges.some(([a, b]) => at > a && at < b)) out.push('mail delivery intent is queued only inside the transaction it belongs to (->atomically(...))');
  }
  return out;
}

const SECRET_RULES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/,
  // BF-3D: a Resend API key (re_ followed by a long unbroken key body).
  /\bre_[A-Za-z0-9]{20,}\b/,
];

function isProductionPhp(file) {
  return file.startsWith('server/src/') || file.startsWith('server/public/') || file.startsWith('server/dev/') || file.startsWith('server/config/') || file.startsWith('server/bin/');
}

// `<?php`, at least one whitespace character, then any number of `/* … */` or `// …\n`
// comments (each optionally followed by whitespace), then exactly `declare(strict_types=1);`.
// An index scanner rather than a regex: every step moves forward, so the cost is linear in the
// prefix length (a repeated regex group here backtracked exponentially — CodeQL
// js/redos). Anything else before the declare — code, `#` comments, another declare, an
// unterminated comment — fails closed.
const STRICT_TYPES = 'declare(strict_types=1);';
function hasStrictTypesFirst(src) {
  const skipSpace = (k) => {
    while (k < src.length && /\s/.test(src[k])) k++;
    return k;
  };
  if (!src.startsWith('<?php')) return false;
  let i = skipSpace(5);
  if (i === 5) return false;
  for (;;) {
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) return false;
      i = skipSpace(end + 2);
    } else if (src.startsWith('//', i)) {
      const end = src.indexOf('\n', i + 2);
      if (end === -1) return false;
      i = skipSpace(end + 1);
    } else {
      return src.startsWith(STRICT_TYPES, i);
    }
  }
}

function checkPhp(file, src) {
  const out = [];
  if (!hasStrictTypesFirst(src)) {
    out.push('missing declare(strict_types=1) as the first statement');
  }
  for (const re of SECRET_RULES) if (re.test(src)) out.push('secret-shaped value: ' + re);
  const lex = lexPhp(src);
  if (lex.heredoc) out.push('heredoc/nowdoc is forbidden (keeps the boundary check sound)');
  if (!isProductionPhp(file)) return out; // tests may spawn processes, dump values and name CORS headers
  const inData = file.startsWith(DATA_DIR);
  for (const r of CODE_RULES) if (!(r.allow && r.allow(file)) && r.re.test(lex.code)) out.push(r.msg);
  for (const r of EVERYWHERE_RULES) if (r.re.test(lex.code)) out.push(r.msg);
  if (inData) for (const v of checkSqlConstruction(lex)) out.push(v);
  if (!inData) {
    for (const r of DATA_RULES) if (r.re.test(lex.code)) out.push(r.msg);
    for (const s of lex.strings) if (SQL_STRING.test(s)) out.push('SQL statement outside ' + DATA_DIR + ': "' + s.slice(0, 40) + '"');
  }
  for (const r of STRING_RULES) {
    if (r.allow && r.allow(file)) continue;
    if (lex.strings.some((s) => r.re.test(s)) || (r.id === 'cors' && r.re.test(lex.code))) out.push(r.msg);
  }
  if (!SUPERGLOBAL_READERS.has(file) && /\$(_GET|_POST|_REQUEST|_COOKIE|_SERVER|_FILES|_ENV|_SESSION|GLOBALS)\b/.test(lex.code)) {
    out.push('request superglobals are read only by server/src/Http/Request.php');
  }
  if (!HEADER_EMITTERS.has(file) && /(?<![\w$>:])(header|header_remove|http_response_code)\s*\(/i.test(lex.code)) {
    out.push('headers are emitted only by server/src/Http/Response.php (and bootstrap)');
  }
  if (!INI_WRITERS.has(file) && /(?<![\w$>:])(ini_set|ini_alter|set_include_path|putenv)\s*\(/i.test(lex.code)) {
    out.push('runtime configuration changes are made only in server/src/bootstrap.php');
  }
  if (CLI_FILES.has(file) && !(/\bPHP_SAPI\b/.test(lex.code) && lex.strings.includes('cli'))) {
    out.push('a CLI entry point must refuse any non-CLI SAPI (PHP_SAPI !== \'cli\')');
  }
  if (!RESOLVERS_ALLOWED.has(file) && /\bimplements\b[^{]*\bPrincipalResolver\b/.test(lex.code)) {
    out.push('the only PrincipalResolver implementations are NullPrincipalResolver and SessionPrincipalResolver');
  }
  // Request.php reads $_SERVER; not even it may read $_COOKIE (PHP URL-decodes and renames names).
  if (/\$_COOKIE\b/.test(lex.code)) out.push('$_COOKIE is never read: the session cookie comes from HTTP_COOKIE in Request.php');
  for (const v of checkCsrfComparison(lex.code)) out.push(v);
  for (const v of checkScopedData(file, src, lex)) out.push(v);
  for (const v of checkAuditInTransaction(lex)) out.push(v);
  for (const v of checkOvertimeDelete(lex)) out.push(v);
  return out;
}

// BF-4b1, owner decision D-BF4b-6: the only hard delete of overtime removes a Draft. Every
// DELETE FROM overtime_records statement names the company, the expected version and the Draft
// status in its own predicate, so no caller can widen it to submitted or reviewed records.
function checkOvertimeDelete(lex) {
  const out = [];
  for (const s of lex.strings) {
    if (!/^\s*DELETE\s+FROM\s+`?overtime_records\b/i.test(s)) continue;
    const where = s.split(/\bWHERE\b/i)[1] || '';
    if (!/\bcompany_id = :company_id\b/.test(where) || !/\bversion = :expected_version\b/.test(where) || !/\bstatus = 'Draft'/.test(where) || /\bOR\b/i.test(where)) {
      out.push("an overtime DELETE removes only a Draft: its WHERE names company_id = :company_id, version = :expected_version and status = 'Draft' (and no OR)");
    }
  }
  return out;
}

// BF-3C scoped data access. A business store is any file in a domain folder of the data layer
// (server/src/Data/<Domain>/, other than Auth, Migration and Scope). It receives only
// ScopedDatabase — never the Database handle — and every statement it holds names :company_id
// (named parameters only), with every *_SELF_SQL also naming :self_employee_id. The company
// tables are named in SQL only by business stores. Heuristic shape checks: they cannot prove a
// predicate is correct; ScopedDatabase's run-time refusals and the hostile-principal tests do.
const SCOPED_STORE = /^server\/src\/Data\/(?!Auth\/|Migration\/|Scope\/)[A-Z][A-Za-z0-9]*\/[A-Za-z0-9]+\.php$/;
function companyTableSql(s) {
  const names = [...COMPANY_TABLES].join('|');
  return new RegExp('\\b(FROM|JOIN|INTO|UPDATE|TABLE)\\s+`?(' + names + ')\\b', 'i').test(s);
}
// Wider than SQL_STRING (which needs a clause keyword right after the table, so an aliased
// `FROM t a JOIN …` escapes it): any literal holding an upper-case statement verb and clause.
const SQL_VERB = /\b(SELECT|INSERT|UPDATE|DELETE|REPLACE)\b/;
function checkScopedData(file, src, lex) {
  const out = [];
  const sql = lex.strings.filter((s) => SQL_STRING.test(s) || (SQL_VERB.test(s) && SQL_KEYWORD.test(s.replace(SQL_VERB, ''))));
  if (SCOPED_STORE.test(file)) {
    if (/\bDatabase(Config)?\b|\bAuthData\b/.test(lex.code)) out.push('a business store receives only ScopedDatabase, never the Database handle (' + file + ')');
    for (const s of sql) {
      if (!/:company_id\b/.test(s)) out.push('a business store statement must name :company_id: "' + s.slice(0, 40) + '"');
      if (s.includes('?')) out.push('a business store statement uses named parameters only: "' + s.slice(0, 40) + '"');
    }
    const selfSql = /\bconst\s+(\w+_SELF_SQL)\s*=\s*(?:'([^']*)'|"([^"]*)")/g;
    let m;
    while ((m = selfSql.exec(src))) if (!/:self_employee_id\b/.test(m[2] ?? m[3])) out.push(m[1] + ' must name :self_employee_id');
  } else if (sql.some(companyTableSql)) {
    out.push('the company tables (' + [...COMPANY_TABLES].join(', ') + ') are read and written only by business stores under ScopedDatabase');
  }
  return out;
}

// Inside the data layer, SQL must be a plain single-quoted literal with bound parameters:
// no "…$var…" interpolation, no `.` concatenation and no sprintf-style assembly of a SQL
// fragment. A heuristic, not a proof of SQL safety — review and tests remain the backstop.
function checkSqlConstruction(lex) {
  const out = [];
  const code = lex.code;
  const prevNonSpace = (k) => {
    k--;
    while (k >= 0 && /\s/.test(code[k])) k--;
    return k;
  };
  const nextNonSpace = (k) => {
    while (k < code.length && /\s/.test(code[k])) k++;
    return k;
  };
  for (const s of lex.spans) {
    if (s.dq && s.value.includes('$')) out.push('interpolated double-quoted string in the data layer (bind parameters instead)');
    if (!SQL_KEYWORD.test(s.value)) continue;
    const before = prevNonSpace(s.start);
    const after = nextNonSpace(s.end);
    const concatBefore = before >= 0 && (code[before] === '.' || (code[before] === '=' && code[before - 1] === '.'));
    const concatAfter = code[after] === '.' && !/[0-9]/.test(code[after + 1] || '');
    if (concatBefore || concatAfter) out.push('SQL fragment built by concatenation in the data layer: "' + s.value.slice(0, 40) + '"');
    if (SQL_BUILDERS.test(code.slice(Math.max(0, s.start - 40), s.start))) out.push('SQL fragment assembled by a string builder in the data layer: "' + s.value.slice(0, 40) + '"');
  }
  return out;
}

function checkTree(files, dirs = []) {
  const out = [];
  for (const p of [...files, ...dirs]) {
    for (const gate of NOT_YET_AUTHORIZED) {
      if (p === gate || p.startsWith(gate + '/')) out.push(p + ': ' + gate + ' is not authorized yet');
    }
  }
  for (const f of files) {
    const base = path.posix.basename(f);
    if (/^composer\.(json|lock)$/.test(base) || f.includes('/vendor/')) out.push(f + ': Composer/vendor code is not authorized (SDR-0002 §15)');
    const isMigration = MIGRATION_FILE.test(f) && base.length - '0000_'.length - '.sql'.length <= 64;
    if (f.startsWith('server/migrations/') && !isMigration) out.push(f + ': server/migrations/ holds only NNNN_name.sql migration files');
    if (/\.sql$/i.test(f) && !f.startsWith('server/migrations/')) out.push(f + ': .sql files belong only in server/migrations/');
    if (f.startsWith('server/bin/') && !CLI_FILES.has(f)) out.push(f + ': server/bin/ holds only migrate.php, account.php and mail.php');
    if (/^\.env/.test(base) || /\.(phar|pem|key)$/i.test(base)) out.push(f + ': forbidden file type');
    if (!/\.php$/.test(f) && f !== 'server/public/api/.htaccess' && !isMigration && !f.startsWith('server/migrations/')) out.push(f + ': unexpected file type under server/');
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Header parity: ApiHeaders.php must mirror tools/package-headers.js exactly.
// ---------------------------------------------------------------------------------------------
function parsePhpString(lit) {
  const q = lit[0];
  const body = lit.slice(1, -1);
  return q === "'" ? body.replace(/\\(['\\])/g, '$1') : body.replace(/\\(["\\$])/g, '$1');
}
function readPhpHeaders(src) {
  const block = /const HEADERS = \[([\s\S]*?)\];/.exec(src);
  const hsts = /const HSTS = ('[^']*'|"[^"]*");/.exec(src);
  if (!block || !hsts) return null;
  const headers = {};
  const re = /^\s*('[^']*'|"[^"]*")\s*=>\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"),\s*$/gm;
  let m;
  let count = 0;
  while ((m = re.exec(block[1]))) {
    headers[parsePhpString(m[1])] = parsePhpString(m[2]);
    count++;
  }
  const entries = block[1].split('\n').filter((l) => l.trim() !== '').length;
  if (count !== entries) return null;
  return { headers, hsts: parsePhpString(hsts[1]) };
}
function checkParity(phpSrc, contract) {
  const php = readPhpHeaders(phpSrc);
  if (!php) return ['ApiHeaders.php is not in the parseable one-entry-per-line form'];
  const want = JSON.stringify(Object.entries(contract.API_HEADERS));
  const got = JSON.stringify(Object.entries(php.headers));
  const out = [];
  if (want !== got) out.push('ApiHeaders::HEADERS drifted from tools/package-headers.js API_HEADERS');
  if (php.hsts !== contract.HSTS_PRODUCTION) out.push('ApiHeaders::HSTS drifted from tools/package-headers.js HSTS_PRODUCTION');
  return out;
}

// ---------------------------------------------------------------------------------------------
// ACTION parity (BF-3C): server/src/Policy/Action.php must hold exactly the frontend vocabulary
// of js/core/authz.js, with the same rule class and resource entity for every action.
//
// The frontend side is read by evaluating the repository's own authz.js in an empty vm context
// (two constant stubs, no require, no timers, a time limit) and taking ACTIONS, POLICY and
// ACTION_RESOURCE_ENTITY from it — the canonical values, never display text. Each POLICY
// predicate is classified by probing it with fixed principals: CeoOnly admits only the CEO;
// CeoOrOwnDraft also admits an Employee on a Draft. Any other shape is a failure, so a broadened
// Employee rule turns the check red. The server side is parsed from Action.php, which must keep
// its one-entry-per-line form; anything the parser cannot account for fails closed.
// ---------------------------------------------------------------------------------------------
const RULE_PROBES = [
  { principal: 'ceo', resource: { status: 'Approved' } },
  { principal: 'employee', resource: { status: 'Draft' } },
  { principal: 'employee', resource: { status: 'Submitted' } },
  { principal: 'employee', resource: null },
  { principal: null, resource: { status: 'Draft' } },
];
const RULE_SHAPES = { 'true,false,false,false,false': 'CeoOnly', 'true,true,false,false,false': 'CeoOrOwnDraft' };

/** @returns {{ actions: Map<string, {rule: string, entity: string|null}>|null, errors: string[] }} */
function readFrontendActions(src) {
  const vm = require('vm');
  let rt;
  try {
    const context = vm.createContext({ PRINCIPAL_TYPES: Object.freeze({ CEO: 'ceo', EMPLOYEE: 'employee' }) });
    rt = vm.runInContext(src + '\n;({ ACTIONS: ACTIONS, POLICY: POLICY, ENTITY: ACTION_RESOURCE_ENTITY, TYPES: PRINCIPAL_TYPES });', context, { timeout: 1000 });
  } catch (e) {
    return { actions: null, errors: ['js/core/authz.js could not be evaluated for ACTION parity: ' + e.message] };
  }
  const errors = [];
  const values = Object.keys(rt.ACTIONS || {}).map((k) => rt.ACTIONS[k]);
  if (new Set(values).size !== values.length) errors.push('frontend ACTIONS has duplicate values');
  const actions = new Map();
  for (const value of values) {
    const predicate = rt.POLICY ? rt.POLICY[value] : undefined;
    if (typeof predicate !== 'function') { errors.push('frontend POLICY has no predicate for ' + value); continue; }
    if (!rt.ENTITY || !Object.prototype.hasOwnProperty.call(rt.ENTITY, value)) { errors.push('frontend ACTION_RESOURCE_ENTITY has no entry for ' + value); continue; }
    const shape = RULE_PROBES.map((p) => {
      const principal = p.principal === null ? null : { principalType: p.principal === 'ceo' ? rt.TYPES.CEO : rt.TYPES.EMPLOYEE };
      try { return predicate(principal, p.resource, undefined) === true; } catch (_e) { return 'throws'; }
    }).join(',');
    const rule = RULE_SHAPES[shape];
    if (!rule) { errors.push('frontend POLICY for ' + value + ' is neither CeoOnly nor CeoOrOwnDraft (probe ' + shape + ')'); continue; }
    actions.set(value, { rule, entity: rt.ENTITY[value] });
  }
  for (const k of Object.keys(rt.POLICY || {})) if (!values.includes(k)) errors.push('frontend POLICY has an entry outside ACTIONS: ' + k);
  for (const k of Object.keys(rt.ENTITY || {})) if (!values.includes(k)) errors.push('frontend ACTION_RESOURCE_ENTITY has an entry outside ACTIONS: ' + k);
  return { actions, errors };
}

// One match block of Action.php: every non-blank line between `return match ($this) {` and `};`
// must be exactly `self::Case => <value>,`.
function readActionMatch(src, method, valueRe) {
  const block = new RegExp('public function ' + method + '\\(\\): \\??\\w+\\s*\\{\\s*return match \\(\\$this\\) \\{\\n([\\s\\S]*?)\\n\\s*\\};').exec(src);
  if (!block) return null;
  const out = new Map();
  for (const line of block[1].split('\n')) {
    if (line.trim() === '') continue;
    const m = new RegExp('^\\s*self::(\\w+) => ' + valueRe + ',\\s*$').exec(line);
    if (!m || out.has(m[1])) return null;
    out.set(m[1], m[2]);
  }
  return out;
}

/** @returns {{ actions: Map<string, {rule: string, entity: string|null}>|null, errors: string[] }} */
function readServerActions(src) {
  const unparseable = { actions: null, errors: ['server/src/Policy/Action.php is not in the parseable one-entry-per-line form'] };
  const body = /\benum Action: string\s*\{\n([\s\S]*?)\n\s*public function rule\(\)/.exec(src);
  if (!body || /\bdefault\s*=>/.test(src)) return unparseable;
  const cases = new Map();
  for (const line of body[1].split('\n')) {
    if (line.trim() === '') continue;
    const m = /^\s*case (\w+) = '([a-zA-Z.]+)';\s*$/.exec(line);
    if (!m || cases.has(m[1])) return unparseable;
    cases.set(m[1], m[2]);
  }
  const rules = readActionMatch(src, 'rule', 'Rule::(CeoOnly|CeoOrOwnDraft)');
  const entities = readActionMatch(src, 'entity', "('[a-zA-Z]+'|null)");
  if (!rules || !entities || rules.size !== cases.size || entities.size !== cases.size) return unparseable;
  const errors = [];
  const actions = new Map();
  for (const [name, value] of cases) {
    if (!rules.has(name) || !entities.has(name)) return unparseable;
    if (actions.has(value)) errors.push('server Action has a duplicate value: ' + value);
    const entity = entities.get(name);
    actions.set(value, { rule: rules.get(name), entity: entity === 'null' ? null : entity.slice(1, -1) });
  }
  return { actions, errors };
}

function checkActionParity(phpSrc, jsSrc) {
  const front = readFrontendActions(jsSrc);
  const server = readServerActions(phpSrc);
  const out = [...front.errors, ...server.errors];
  if (!front.actions || !server.actions) return out.length ? out : ['ACTION parity could not be established'];
  // SDR-0004 (BF-4a2, owner decision C1 = A): account.manage joined the shared vocabulary, 20 → 21.
  if (front.actions.size !== 21) out.push('frontend ACTIONS has ' + front.actions.size + ' actions, not 21');
  if (server.actions.size !== 21) out.push('server Action has ' + server.actions.size + ' actions, not 21');
  for (const [value, f] of front.actions) {
    const s = server.actions.get(value);
    if (!s) { out.push('server Action is missing ' + value); continue; }
    if (s.rule !== f.rule) out.push('ACTION rule drift for ' + value + ': frontend ' + f.rule + ', server ' + s.rule);
    if (s.entity !== f.entity) out.push('ACTION entity drift for ' + value + ': frontend ' + f.entity + ', server ' + s.entity);
  }
  for (const value of server.actions.keys()) if (!front.actions.has(value)) out.push('server Action has an action the frontend lacks: ' + value);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Git hygiene: nothing under server/ may be ignored (except the local config) or untracked.
// ---------------------------------------------------------------------------------------------
function git(args, input) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });
}
function gitIgnored(files) {
  if (files.length === 0) return [];
  try {
    return git(['check-ignore', '--no-index', '--stdin'], files.join('\n') + '\n').split('\n').filter(Boolean);
  } catch (e) {
    if (e.status === 1) return []; // nothing ignored
    throw e;
  }
}
function checkGitHygiene(onDisk, ignored, untracked) {
  const out = [];
  for (const f of ignored) if (!LOCAL_CONFIG.test(f)) out.push(f + ': ignored by .gitignore — it would be silently left out of the commit (rename it)');
  for (const f of untracked) if (!LOCAL_CONFIG.test(f)) out.push(f + ': present but not tracked by Git (git add it)');
  if (onDisk.length === 0) out.push('server/ is empty');
  return out;
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return acc;
}

function run() {
  const onDisk = walk(path.join(root, SERVER)).sort();
  const failures = [];
  const dirs = new Set();
  for (const f of onDisk) {
    let d = path.posix.dirname(f);
    while (d.startsWith(SERVER)) { dirs.add(d); d = path.posix.dirname(d); }
  }
  const files = onDisk.filter((f) => !LOCAL_CONFIG.test(f));
  for (const v of checkTree(files, [...dirs])) failures.push(v);
  let php = 0;
  for (const f of files.filter((x) => x.endsWith('.php'))) {
    php++;
    for (const v of checkPhp(f, fs.readFileSync(path.join(root, f), 'utf8'))) failures.push(f + ': ' + v);
  }
  // Migration files are data, not PHP: they are scanned for secret-shaped values and seed rows
  // here; MigrationSet validates their bytes at run time.
  for (const f of files.filter((x) => x.endsWith('.sql'))) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    for (const re of SECRET_RULES) if (re.test(src)) failures.push(f + ': secret-shaped value: ' + re);
    for (const v of checkMigrationSql(src, f)) failures.push(f + ': ' + v);
    for (const v of checkMigrationTenantKey(src)) failures.push(f + ': ' + v);
    for (const v of checkMigrationNoCascade(src)) failures.push(f + ': ' + v);
  }
  for (const v of checkMigrationContinuity(files)) failures.push(v);
  for (const v of checkRouteActions(fs.readFileSync(path.join(root, ROUTES_FILE), 'utf8'))) failures.push(v);
  for (const v of checkKernelCsrf(fs.readFileSync(path.join(root, KERNEL_FILE), 'utf8'))) failures.push(KERNEL_FILE + ': ' + v);
  const contract = require('./package-headers.js');
  for (const v of checkParity(fs.readFileSync(path.join(root, 'server/src/Http/ApiHeaders.php'), 'utf8'), contract)) failures.push(v);
  const actionFile = path.join(root, ACTION_FILE);
  if (!fs.existsSync(actionFile)) failures.push(ACTION_FILE + ': missing — ACTION parity cannot be established');
  else for (const v of checkActionParity(fs.readFileSync(actionFile, 'utf8'), fs.readFileSync(path.join(root, FRONTEND_AUTHZ), 'utf8'))) failures.push(v);
  const ignored = gitIgnored(onDisk);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', SERVER]).split('\n').filter(Boolean);
  for (const v of checkGitHygiene(onDisk, ignored, untracked)) failures.push(v);

  const dedup = [...new Set(failures)];
  if (dedup.length) {
    console.error('BACKEND BOUNDARY FAILED -- ' + dedup.length + ' violation(s):');
    for (const v of dedup) console.error('  - ' + v);
    process.exit(1);
  }
  console.log('BACKEND BOUNDARY PASSED -- ' + files.length + ' files (' + php + ' PHP) checked; API header mirror matches tools/package-headers.js; server ACTIONS equal ' + FRONTEND_AUTHZ + ' (21 actions, rules, entities).');
}

// ---------------------------------------------------------------------------------------------
// Selftest: every rule must pass clean code and catch its violation.
// ---------------------------------------------------------------------------------------------
function selftest() {
  const S = "<?php\ndeclare(strict_types=1);\n";
  const cases = [];
  const clean = (name, file, src) => cases.push({ name, run: () => checkPhp(file, src), expect: 0 });
  const dirty = (name, file, src, needle) => cases.push({ name, run: () => checkPhp(file, src), expect: needle });

  clean('clean class passes', 'server/src/Http/X.php', S + "final class X { public function f(): string { return 'ok'; } }\n");
  clean('comment block before declare passes', 'server/src/X.php', "<?php\n/* doc */\ndeclare(strict_types=1);\n");
  clean('prose in comments never trips a rule', 'server/src/X.php', S + "// no eval(), no exec(), no PDO, no \$_GET, no session_start()\n/* SELECT * FROM t; Access-Control-Allow-Origin */\n# phpinfo()\n");
  clean('the word DELETE as an HTTP method is not SQL', 'server/src/X.php', S + "const M = ['POST', 'PUT', 'PATCH', 'DELETE'];\n\$s = 'Select a principal from the list';\n");
  clean('method names that merely contain a banned word pass', 'server/src/X.php', S + "\$this->executeTransaction(); \$r->evaluate(); \$x = \$y->extractor();\n");
  clean('#[Attribute] syntax is code, not a comment', 'server/src/X.php', S + "#[\\SensitiveParameter]\nfunction f(): void {}\n");
  clean('tests may spawn the server and dump values', 'server/tests/Http/T.php', S + "proc_open(['php'], [], \$p); var_export(1, true); \$h = 'Access-Control-Allow-Origin';\n");
  clean('Request.php may read $_SERVER and php://input', 'server/src/Http/Request.php', S + "\$s = \$_SERVER; \$h = fopen('php://input', 'rb');\n");
  clean('the data layer may use PDO', 'server/src/Data/Database.php', S + "\$pdo = new \\PDO('x'); \$pdo->prepare('SELECT a FROM b WHERE c = ?');\n");
  clean('NullPrincipalResolver is an allowed resolver', 'server/src/Identity/NullPrincipalResolver.php', S + 'final class NullPrincipalResolver implements PrincipalResolver {}\n');
  clean('SessionPrincipalResolver is an allowed resolver (BF-3A)', 'server/src/Identity/SessionPrincipalResolver.php', S + 'final class SessionPrincipalResolver implements PrincipalResolver {}\n');

  dirty('missing strict_types is caught', 'server/src/X.php', "<?php\nfinal class X {}\n", 'strict_types');
  dirty('strict_types after code is caught', 'server/src/X.php', "<?php\necho 1;\ndeclare(strict_types=1);\n", 'strict_types');

  // The strict_types prefix scanner, case by case (the rule's accepted and rejected shapes).
  const D = 'declare(strict_types=1);';
  const strictCase = (name, src, ok) => cases.push({ name: 'strict_types: ' + name, run: () => (hasStrictTypesFirst(src) ? [] : ['strict_types missing']), expect: ok ? 0 : 'strict_types' });
  strictCase('declare right after the tag', '<?php ' + D, true);
  strictCase('whitespace before declare', "<?php \n\t  \n" + D, true);
  strictCase('one line comment', "<?php\n// note\n" + D, true);
  strictCase('several line comments', "<?php\n// a\n// b\n//\n" + D, true);
  strictCase('one block comment', "<?php\n/* a */\n" + D, true);
  strictCase('mixed block, docblock and line comments', "<?php\n/**\n * doc */\n// x\n/* y */" + D, true);
  strictCase('whitespace between comments and declare', "<?php\n/* a */\n\n\t// b\n   \n" + D, true);
  strictCase('missing declare', "<?php\nfinal class X {}\n", false);
  strictCase('statement before declare', "<?php\necho 1;\n" + D, false);
  strictCase('another declare first', "<?php\ndeclare(ticks=1);\n" + D, false);
  strictCase('strict_types=0', "<?php\ndeclare(strict_types=0);\n", false);
  strictCase('spaced declare is not the governed form', "<?php\ndeclare(strict_types = 1);\n", false);
  strictCase('unterminated block comment', "<?php\n/* never closed\n" + D, false);
  strictCase('line comment at end of file', '<?php\n// only a comment', false);
  strictCase('# comment is not an accepted prefix', "<?php\n# note\n" + D, false);
  strictCase('no whitespace after the tag', '<?php' + D, false);
  strictCase('short open tag', '<? ' + D, false);
  strictCase('text before the tag', ' <?php\n' + D, false);
  strictCase('empty file', '', false);
  // ReDoS regression (CodeQL js/redos): the attack shape for the former regex — many `*/` —
  // must be decided by syntax. The scanner is linear, so these finish immediately; no timing
  // assertion is needed or made.
  strictCase('adversarial: 50k "*/" inside one comment, no declare', '<?php /*' + '*/'.repeat(50000), false);
  strictCase('adversarial: 50k "*/" after an unclosed comment start', '<?php\n/* ' + '*/'.repeat(50000) + '\necho 1;', false);
  strictCase('adversarial: 20k empty block comments then declare', '<?php\n' + '/**/ '.repeat(20000) + D, true);
  strictCase('adversarial: 20k empty block comments then code', '<?php\n' + '/**/'.repeat(20000) + 'echo 1;', false);
  dirty('eval is caught', 'server/src/X.php', S + "eval('1');\n", 'eval');
  dirty('EVAL in any case is caught', 'server/src/X.php', S + "EVAL ('1');\n", 'eval');
  for (const fn of ['exec', 'shell_exec', 'system', 'passthru', 'proc_open', 'popen']) dirty(fn + ' is caught', 'server/src/X.php', S + fn + "('ls');\n", 'process');
  dirty('namespaced \\exec is caught', 'server/src/X.php', S + "\\exec('ls');\n", 'process');
  dirty('backticks are caught', 'server/src/X.php', S + '$x = `ls`;\n', 'backtick');
  dirty('unserialize is caught', 'server/src/X.php', S + "unserialize(\$x);\n", 'unserialize');
  dirty('extract is caught', 'server/src/X.php', S + "extract(\$x);\n", 'extract');
  for (const fn of ['phpinfo', 'var_dump', 'print_r']) dirty(fn + ' is caught', 'server/src/X.php', S + fn + "(\$x);\n", 'debug');
  dirty('session_start is caught', 'server/src/X.php', S + 'session_start();\n', 'sessions');
  dirty('setcookie is caught', 'server/src/X.php', S + "setcookie('a', 'b');\n", 'cookies');
  dirty('dynamic include is caught', 'server/src/X.php', S + 'require $path;\n', 'include');
  dirty('new PDO outside Data/ is caught', 'server/src/Http/X.php', S + "\$p = new PDO('mysql:');\n", 'PDO');
  dirty('\\PDO::ATTR outside Data/ is caught', 'server/src/X.php', S + '$a = \\PDO::ATTR_ERRMODE;\n', 'PDO');
  dirty('mysqli is caught', 'server/src/X.php', S + "\$m = new mysqli('h');\n", 'mysqli');
  dirty('mysqli_query is caught', 'server/src/X.php', S + 'mysqli_query($c, $q);\n', 'mysqli');
  for (const m of ['query', 'exec', 'prepare']) dirty('->' + m + '( outside Data/ is caught', 'server/src/X.php', S + '$db->' + m + "('x');\n", m);
  for (const sql of ['SELECT id FROM users', 'insert into t (a) values (1)', 'UPDATE users SET role = 1', 'DELETE FROM users', 'DROP TABLE users', 'CREATE TABLE t (a int)', 'TRUNCATE users', "SET NAMES utf8mb4", 'GRANT ALL ON *.* TO x', 'START TRANSACTION']) {
    dirty('SQL string "' + sql + '" outside Data/ is caught', 'server/src/Controller/X.php', S + "\$q = '" + sql + "';\n", 'SQL');
  }
  dirty('SQL in a double-quoted string is caught', 'server/src/X.php', S + '$q = "SELECT * FROM t WHERE id = $id";\n', 'SQL');
  dirty('Access-Control-Allow-Origin is caught', 'server/src/X.php', S + "\$h = 'Access-Control-Allow-Origin: *';\n", 'CORS');
  dirty('$_GET outside Request.php is caught', 'server/src/Controller/X.php', S + "\$a = \$_GET['a'];\n", 'superglobals');
  dirty('$_COOKIE is caught', 'server/src/X.php', S + '$a = $_COOKIE;\n', 'superglobals');
  dirty('$GLOBALS is caught', 'server/src/X.php', S + '$a = $GLOBALS;\n', 'superglobals');
  dirty('php://input outside Request.php is caught', 'server/src/X.php', S + "\$b = file_get_contents('php://input');\n", 'php://input');
  dirty('header() outside Response.php is caught', 'server/src/Controller/X.php', S + "header('X: 1');\n", 'headers');
  dirty('ini_set outside bootstrap is caught', 'server/src/X.php', S + "ini_set('display_errors', '1');\n", 'runtime configuration');
  dirty('a third PrincipalResolver is caught', 'server/src/Identity/CeoResolver.php', S + 'final class CeoResolver implements PrincipalResolver {}\n', 'PrincipalResolver');
  dirty('a resolver outside Identity is caught', 'server/src/Auth/HeaderResolver.php', S + 'final class HeaderResolver implements \\TamOs\\Identity\\PrincipalResolver {}\n', 'PrincipalResolver');

  // BF-3A authentication boundary: each rule passes its approved location and catches a violation.
  clean('Passwords.php may call the password API', 'server/src/Auth/Passwords.php', S + "$h = password_hash($p, PASSWORD_ARGON2ID); $ok = password_verify($p, $h); password_needs_rehash($h, 1); password_get_info($h);\n");
  for (const fn of ['password_hash', 'password_verify', 'password_needs_rehash', 'password_get_info', 'PASSWORD_VERIFY']) {
    dirty(fn + ' outside Passwords.php is caught', 'server/src/Auth/Authenticator.php', S + '$x = ' + fn + "($p, $h);\n", 'password API');
  }
  dirty('\\password_verify in a controller is caught', 'server/src/Controller/X.php', S + '$x = \\password_verify($p, $h);\n', 'password API');
  clean('a method named verify() is not the password API', 'server/src/Auth/Authenticator.php', S + '$ok = Passwords::verify($p, $h); $o->password_hash_len();\n');
  clean('SessionCookie.php holds the cookie name', SESSION_COOKIE_FILE, S + "const NAME = '__Host-tamos_session';\n");
  dirty('the cookie name in Request.php is caught', REQUEST_FILE, S + "$n = '__Host-tamos_session';\n", 'cookie name');
  dirty('the cookie name in a controller is caught', 'server/src/Controller/X.php', S + "$h = \"__Host-tamos_session=\" . $t;\n", 'cookie name');
  clean('the cookie name in a comment passes', 'server/src/Http/Request.php', S + "// reads the __Host-tamos_session cookie\n");
  clean('Kernel adds Set-Cookie', KERNEL_FILE, S + "$r = $r->withHeader('Set-Cookie', $c);\nreturn hash_equals($session->csrfToken, $request->csrfToken);\n");
  dirty('Set-Cookie outside Kernel is caught', 'server/src/Controller/X.php', S + "$r = $r->withHeader('Set-Cookie', $c);\n", 'Set-Cookie');
  dirty('set-cookie in Response is caught', 'server/src/Http/Response.php', S + "$h['set-cookie'] = $c;\n", 'Set-Cookie');
  clean('Request.php reads HTTP_COOKIE', REQUEST_FILE, S + "$c = $header('HTTP_COOKIE');\n");
  dirty('HTTP_COOKIE outside Request.php is caught', 'server/src/Identity/X.php', S + "$c = getenv('HTTP_COOKIE');\n", 'HTTP_COOKIE');
  dirty('$_COOKIE in Request.php is caught', REQUEST_FILE, S + '$c = $_COOKIE[\'x\'] ?? null;\n', '$_COOKIE');
  dirty('$_COOKIE in the data layer is caught', 'server/src/Data/Auth/SessionStore.php', S + '$c = $_COOKIE;\n', '$_COOKIE');
  clean('the resolver may build a principal', 'server/src/Identity/SessionPrincipalResolver.php', S + '$p = Principal::fromAccount($u, $m); return new AuthSession($p, $c);\n');
  clean('the Authenticator may build a principal', 'server/src/Auth/Authenticator.php', S + '$p = Principal::fromAccount($u, $m);\n');
  dirty('a controller building a principal is caught', 'server/src/Controller/X.php', S + '$p = Principal::fromAccount($json, []);\n', 'fromAccount');
  dirty('Kernel building a principal is caught', KERNEL_FILE, S + "$p = \\TamOs\\Identity\\Principal::fromAccount($u, $m);\nreturn hash_equals($session->csrfToken, $request->csrfToken);\n", 'fromAccount');
  dirty('new AuthSession outside Identity is caught', 'server/src/Auth/Authenticator.php', S + '$s = new AuthSession($p, $c);\n', 'constructed only inside');
  dirty('new \\TamOs\\Identity\\Principal outside Identity is caught', 'server/src/Controller/X.php', S + '$p = new \\TamOs\\Identity\\Principal($a, $b, $c, $d, $e);\n', 'constructed only inside');
  clean('Kernel compares CSRF with hash_equals and checks presence against null', KERNEL_FILE, S + 'return $request->csrfToken !== null && hash_equals($session->csrfToken, $request->csrfToken);\n');
  dirty('Kernel comparing CSRF with === is caught', KERNEL_FILE, S + 'return $request->csrfToken === $session->csrfToken;\n', 'hash_equals');
  dirty('Kernel comparing CSRF with == is caught', KERNEL_FILE, S + 'return $session->csrfToken == $request->csrfToken;\n', 'hash_equals');
  cases.push({ name: 'Kernel without the hash_equals comparison is caught', run: () => checkKernelCsrf(S + 'return true;\n'), expect: 'hash_equals' });
  cases.push({ name: 'Kernel with the comparison only in a comment is caught', run: () => checkKernelCsrf(S + '// hash_equals($session->csrfToken, $request->csrfToken)\nreturn true;\n'), expect: 'hash_equals' });
  cases.push({ name: 'the real Kernel compares CSRF with hash_equals', run: () => checkKernelCsrf(fs.readFileSync(path.join(root, KERNEL_FILE), 'utf8')), expect: 0 });
  dirty('strcmp on a CSRF token is caught', 'server/src/Controller/X.php', S + 'return strcmp($a->csrfToken, $b) === 0;\n', 'hash_equals');
  dirty('a literal compared to a CSRF token is caught', 'server/src/Controller/X.php', S + "return 'x' !== $s->csrfToken;\n", 'hash_equals');
  clean('a null check on a CSRF token is not a comparison', 'server/src/Controller/X.php', S + 'return $r->csrfToken === null || null !== $s->csrfToken;\n');
  clean('appending to auth_events passes', 'server/src/Data/Auth/AuthEvents.php', S + "$this->db->execute('INSERT INTO auth_events (occurred_at, event, request_id) VALUES (UTC_TIMESTAMP(6), ?, ?)', [$e, $r]);\n");
  for (const sql of ['UPDATE auth_events SET event = ?', 'DELETE FROM auth_events WHERE id = ?', 'REPLACE INTO auth_events VALUES (1)', 'TRUNCATE auth_events',
    'TRUNCATE TABLE auth_events', 'ALTER TABLE auth_events DROP COLUMN ip', 'DROP TABLE auth_events', 'DELETE e FROM auth_events e', 'update auth_events set ip = null']) {
    dirty('auth_events rewrite "' + sql + '" is caught', 'server/src/Data/Auth/AuthEvents.php', S + "$this->db->execute('" + sql + "');\n", 'append-only');
  }
  cases.push({ name: 'a CREATE TABLE migration passes the seed rule', run: () => checkMigrationSql('CREATE TABLE users (\n  id CHAR(32) NOT NULL,\n  CONSTRAINT fk FOREIGN KEY (a) REFERENCES b (id) ON DELETE RESTRICT ON UPDATE CASCADE\n) ENGINE=InnoDB;\n'), expect: 0 });
  for (const sql of ["INSERT INTO users (id) VALUES ('ceo')", 'insert ignore into companies VALUES (1)', "REPLACE INTO users VALUES ('x')", 'DELETE FROM users',
    "UPDATE users SET status = 'active'", "LOAD DATA INFILE 'x' INTO TABLE users", 'UPDATE employees e JOIN users u ON u.id = e.id SET e.id = 1',
    'update employees AS e, users u set e.id = 1', 'UPDATE IGNORE `employees` SET id = 1']) {
    cases.push({ name: 'a seeding migration is caught: ' + sql.slice(0, 24), run: () => checkMigrationSql('CREATE TABLE t (a INT);\n' + sql + ';\n'), expect: 'no seed data' });
  }
  for (const dir of ['Auth', 'Identity', 'Controller', 'Http']) {
    dirty('Database handle in ' + dir + ' is caught', 'server/src/' + dir + '/X.php', S + 'function f(Database $db): void {}\n', 'DAL bypass');
    dirty('SQL in ' + dir + ' is caught (BF-3A)', 'server/src/' + dir + '/X.php', S + "$q = 'UPDATE sessions SET revoked_at = UTC_TIMESTAMP(6) WHERE token_hash = ?';\n", 'SQL');
  }
  dirty('PDO in Auth is caught', 'server/src/Auth/X.php', S + "$p = new \\PDO('mysql:');\n", 'PDO');
  dirty('heredoc is caught', 'server/src/X.php', S + "\$a = <<<EOT\nSELECT 1\nEOT;\n", 'heredoc');
  dirty('a private key is caught (tests too)', 'server/tests/T.php', S + "\$k = '-----BEGIN RSA PRIVATE KEY-----';\n", 'secret');
  dirty('a GitHub token is caught', 'server/config/config.example.php', S + "return ['t' => 'ghp_" + 'a'.repeat(36) + "'];\n", 'secret');

  const treeCase = (name, files, needle) => cases.push({ name, run: () => checkTree(files), expect: needle });
  cases.push({ name: 'a clean tree passes', run: () => checkTree(['server/src/X.php', 'server/public/api/.htaccess'], ['server/src']), expect: 0 });
  cases.push({ name: 'server/src/Data is authorized since BF-2A', run: () => checkTree(['server/src/Data/Database.php'], ['server/src/Data']), expect: 0 });
  // BF-2B: migrations and the CLI runner.
  cases.push({ name: 'server/bin/migrate.php is authorized since BF-2B', run: () => checkTree(['server/bin/migrate.php'], ['server/bin']), expect: 0 });
  cases.push({ name: 'a valid migration file name passes', run: () => checkTree(['server/migrations/0001_create_probe.sql', 'server/migrations/0002_a1_b2.sql'], ['server/migrations']), expect: 0 });
  treeCase('an extra file under server/bin is caught', ['server/bin/seed.php'], 'only migrate.php');

  // BF-3C: the tenant-key convention for company-owned tables, and no cascading foreign keys.
  const realEmployees = fs.readFileSync(path.join(root, 'server/migrations/0009_create_employees.sql'), 'utf8');
  const realBinding = fs.readFileSync(path.join(root, 'server/migrations/0010_add_memberships_employee_fk.sql'), 'utf8');
  const tenant = (name, src, needle) => cases.push({ name: 'tenant key: ' + name, run: () => [...checkMigrationTenantKey(src), ...checkMigrationNoCascade(src)], expect: needle });
  tenant('the real employees migration passes', realEmployees, 0);
  tenant('the real binding FK migration passes', realBinding, 0);
  tenant('an auth/system table is exempt', 'CREATE TABLE sessions (\n  token_hash CHAR(64) NOT NULL\n) ENGINE=InnoDB;\n', 0);
  tenant('an unregistered business table is caught', realEmployees.replace('CREATE TABLE employees', 'CREATE TABLE contracts'), 'nor registered in COMPANY_TABLES');
  tenant('a company table without company_id is caught', realEmployees.replace(/^ {2}company_id .*\n/m, ''), 'needs `company_id');
  tenant('a nullable company_id is caught', realEmployees.replace('COLLATE ascii_bin NOT NULL,\n  created_at', 'COLLATE ascii_bin NULL,\n  created_at'), 'needs `company_id');
  tenant('a company table without UNIQUE (company_id, id) is caught', realEmployees.replace(/^ {2}UNIQUE KEY .*\n/m, ''), 'UNIQUE KEY (company_id, id)');
  tenant('a company table without its company FK is caught', realEmployees.replace(/^ {2}CONSTRAINT employees_company_fk .*\n/m, ''), 'REFERENCES companies (id)');
  tenant('ON DELETE CASCADE is caught', realBinding.replace('ON DELETE RESTRICT', 'ON DELETE CASCADE'), 'may not CASCADE');
  tenant('ON DELETE SET NULL is caught', realBinding.replace('ON DELETE RESTRICT', 'ON DELETE SET NULL'), 'may not CASCADE');
  tenant('ON UPDATE CASCADE is caught', realBinding.replace('ON UPDATE RESTRICT', 'ON UPDATE CASCADE'), 'may not CASCADE');
  for (const bad of ['server/migrations/1_x.sql', 'server/migrations/0001-x.sql', 'server/migrations/0001_X.sql', 'server/migrations/0001_x_.sql',
    'server/migrations/0001_.sql', 'server/migrations/README.md', 'server/migrations/0001_x.sql.bak', 'server/migrations/sub/0001_x.sql',
    'server/migrations/0001_' + 'a'.repeat(65) + '.sql']) {
    treeCase('a bad migration path is caught: ' + bad.slice(18, 50), [bad], 'server/migrations/ holds only');
  }
  treeCase('a .sql file outside server/migrations is caught', ['server/src/Data/Migration/0001_x.sql'], 'belong only in server/migrations');
  const CLI = 'server/bin/migrate.php';
  clean('migrate.php with its CLI guard passes', CLI, S + "if (PHP_SAPI !== 'cli') { exit(1); }\nrequire dirname(__DIR__) . '/src/bootstrap.php';\n$m = Migrator::fromConfig($c, $d);\n");
  dirty('migrate.php without the CLI guard is caught', CLI, S + "require dirname(__DIR__) . '/src/bootstrap.php';\n", 'non-CLI SAPI');
  dirty('migrate.php checking the wrong SAPI is caught', CLI, S + "if (PHP_SAPI !== 'cli-server') { exit(1); }\n", 'non-CLI SAPI');
  dirty('SQL inside migrate.php is caught', CLI, S + "if (PHP_SAPI !== 'cli') { exit(1); }\n$q = 'CREATE TABLE t (a INT)';\n", 'SQL');
  dirty('Database inside migrate.php is caught', CLI, S + "if (PHP_SAPI !== 'cli') { exit(1); }\n$d = new Database($c);\n", 'DAL bypass');
  dirty('DatabaseConfig inside migrate.php is caught', CLI, S + "if (PHP_SAPI !== 'cli') { exit(1); }\n$d = DatabaseConfig::fromConfig($c);\n", 'DAL bypass');
  dirty('PDO inside migrate.php is caught', CLI, S + "if (PHP_SAPI !== 'cli') { exit(1); }\n$p = new \\PDO('x');\n", 'PDO');
  dirty('->exec inside Data/Migration is caught', 'server/src/Data/Migration/Migrator.php', S + "$pdo->exec('CREATE TABLE t (a INT)');\n", 'exec');
  dirty('concatenated SQL inside Data/Migration is caught', 'server/src/Data/Migration/MigrationHistory.php', S + "const Q = 'SELECT a ' . 'FROM t';\n", 'concatenation');
  clean('fixed SQL literals inside Data/Migration pass', 'server/src/Data/Migration/MigrationHistory.php', S + "$this->db->select(\"SELECT GET_LOCK('tamos_migrate', 0) AS acquired\");\n");

  // BF-3B: the account CLI and the confinement of account and token writes.
  const ACLI = 'server/bin/account.php';
  cases.push({ name: 'server/bin/account.php is authorized since BF-3B', run: () => checkTree([CLI, ACLI], ['server/bin']), expect: 0 });
  treeCase('a third file under server/bin is still caught', [CLI, ACLI, 'server/bin/reissue.php'], 'server/bin/ holds only');
  clean('account.php with its CLI guard passes', ACLI, S + "if (PHP_SAPI !== 'cli') { exit(1); }\nrequire dirname(__DIR__) . '/src/bootstrap.php';\n$l = AccountLifecycle::fromConfig($c);\n");
  dirty('account.php without the CLI guard is caught', ACLI, S + "require dirname(__DIR__) . '/src/bootstrap.php';\n$l = AccountLifecycle::fromConfig($c);\n", 'non-CLI SAPI');
  dirty('account.php checking the wrong SAPI is caught', ACLI, S + "if (PHP_SAPI === 'cli-server') { exit(1); }\n", 'non-CLI SAPI');
  dirty('SQL inside account.php is caught', ACLI, S + "if (PHP_SAPI !== 'cli') { exit(1); }\n$q = 'INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))';\n", 'SQL');
  dirty('Database inside account.php is caught', ACLI, S + "if (PHP_SAPI !== 'cli') { exit(1); }\n$d = new Database($c);\n", 'DAL bypass');
  dirty('PDO inside account.php is caught', ACLI, S + "if (PHP_SAPI !== 'cli') { exit(1); }\n$p = new \\PDO('x');\n", 'PDO');
  clean('AccountStore writes accounts', ACCOUNT_STORE, S + "$this->db->execute('INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', [$id]);\n$this->db->execute('UPDATE users SET password_hash = NULL WHERE id = ?', [$u]);\n");
  clean('AccountTokenStore writes tokens', TOKEN_STORE, S + "$this->db->execute('UPDATE account_tokens SET used_at = UTC_TIMESTAMP(6) WHERE token_hash = ?', [$h]);\n");
  clean('reading accounts elsewhere in Data passes', 'server/src/Data/Auth/SessionStore.php', S + "$this->db->select('SELECT u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', [$h]);\n");
  for (const [sql, table] of [['INSERT INTO companies (id, created_at) VALUES (?, UTC_TIMESTAMP(6))', 'companies'], ['insert ignore into users (id) values (?)', 'users'],
    ['UPDATE memberships SET role = ? WHERE id = ?', 'memberships'], ['DELETE FROM users WHERE id = ?', 'users'], ['REPLACE INTO `memberships` VALUES (?)', 'memberships']]) {
    dirty('an account write outside AccountStore is caught: ' + sql.slice(0, 24), 'server/src/Data/Auth/SessionStore.php', S + "$this->db->execute('" + sql + "');\n", 'written only by ' + ACCOUNT_STORE);
  }
  dirty('a token write outside AccountTokenStore is caught', ACCOUNT_STORE, S + "$this->db->execute('INSERT INTO account_tokens (token_hash) VALUES (?)');\n", 'written only by ' + TOKEN_STORE);
  dirty('a token revoke outside AccountTokenStore is caught', 'server/src/Data/Auth/SessionStore.php', S + "$this->db->execute('UPDATE account_tokens SET revoked_at = UTC_TIMESTAMP(6)');\n", 'written only by ' + TOKEN_STORE);
  dirty('an account write in the token store is caught', TOKEN_STORE, S + "$this->db->execute('UPDATE users SET password_hash = NULL WHERE id = ?');\n", 'written only by ' + ACCOUNT_STORE);

  // BF-2A data-layer boundary.
  const DB = 'server/src/Data/Database.php';
  clean('Data: PDO construction and prepare are allowed', DB, S + "final class Database { private function f(\\PDO $pdo): void { $s = $pdo->prepare('SELECT id FROM t WHERE a = ?'); $s->bindValue(1, $x, \\PDO::PARAM_INT); } }\n");
  clean('Data: a double-quoted constant without $ is allowed', 'server/src/Data/DatabaseConfig.php', S + "const INIT = \"SET time_zone='+00:00'\";\n");
  clean('Data: a DSN built with sprintf is not SQL', 'server/src/Data/DatabaseConfig.php', S + "$d = sprintf('mysql:host=%s;port=%d', $h, $p);\n");
  clean('Data: lower-case messages may be concatenated', DB, S + "error_log('tamos: rollback failed (' . $code . ')');\n");
  clean('Kernel may catch DatabaseError (not the handle)', 'server/src/Http/Kernel.php', S + 'use TamOs\\Data\\DatabaseError;\ntry { f(); } catch (DatabaseError $e) {}\n');
  clean('Logger may test for PDOException', 'server/src/Log/Logger.php', S + "$m = $e instanceof \\PDOException ? 'x' : 'y';\n");
  for (const dir of ['Controller', 'Identity', 'Http']) {
    dirty('PDO in ' + dir + ' is caught', 'server/src/' + dir + '/X.php', S + "$p = new \\PDO('mysql:');\n", 'PDO');
    dirty('SQL in ' + dir + ' is caught', 'server/src/' + dir + '/X.php', S + "$q = 'SELECT id FROM users WHERE id = ?';\n", 'SQL');
  }
  dirty('a Database handle in a controller is caught (DAL bypass)', 'server/src/Controller/X.php', S + 'function f(Database $db): void { $db->select($sql); }\n', 'DAL bypass');
  dirty('DatabaseConfig in a controller is caught (DAL bypass)', 'server/src/Controller/X.php', S + '$c = DatabaseConfig::fromConfig($config);\n', 'DAL bypass');
  dirty('->prepare outside Data is caught', 'server/src/Http/X.php', S + "$s = $h->prepare('x');\n", 'prepare');
  dirty('mysqli inside Data is caught', DB, S + "$m = new mysqli('h');\n", 'mysqli');
  dirty('->query inside Data is caught', DB, S + "$pdo->query('SELECT 1');\n", 'query');
  dirty('->exec inside Data is caught (BF-2A)', DB, S + "$pdo->exec('CREATE TABLE t (a INT)');\n", 'exec');
  dirty('interpolated SQL in Data is caught', DB, S + '$s = $pdo->prepare("SELECT a FROM t WHERE id = $id");\n', 'interpolated');
  dirty('any interpolated string in Data is caught', DB, S + '$m = "value {$x}";\n', 'interpolated');
  dirty('SQL concatenated after a literal is caught', DB, S + "$s = $pdo->prepare('SELECT a FROM t WHERE id = ' . $id);\n", 'concatenation');
  dirty('SQL concatenated before a literal is caught', DB, S + "$s = $pdo->prepare($cols . ' FROM t WHERE a = ?');\n", 'concatenation');
  dirty('SQL appended with .= is caught', DB, S + "$sql .= ' WHERE id = ?';\n", 'concatenation');
  dirty('SQL assembled with sprintf is caught', DB, S + "$sql = sprintf('SELECT %s FROM t', $col);\n", 'string builder');
  dirty('SQL assembled with implode is caught', DB, S + "$sql = implode(' AND ', $parts) ;$w = implode(' WHERE ', $x);\n", 'string builder');
  cases.push({ name: 'server/src/Policy is authorized since BF-3C', run: () => checkTree(['server/src/Policy/Policy.php'], ['server/src/Policy']), expect: 0 });

  // BF-3C: capability construction.
  clean('Policy mints an Authorization', POLICY_FILE, S + 'return new Authorization($action, Scope::of($p), $record);\n');
  dirty('a controller minting an Authorization is caught', 'server/src/Controller/X.php', S + '$a = new Authorization(Action::DataReset, $s, null);\n', 'Authorization is constructed only');
  dirty('a fully-qualified Authorization outside Policy is caught', 'server/src/Data/Employee/EmployeeStore.php', S + '$a = new \\TamOs\\Policy\\Authorization($x, $s, null);\n', 'Authorization is constructed only');
  dirty('Scope.php minting an Authorization is caught', 'server/src/Policy/Scope.php', S + '$a = new Authorization($x, $s, null);\n', 'Authorization is constructed only');
  clean('ScopedDatabase builds a ScopedRecord', SCOPED_DATABASE, S + 'return new ScopedRecord($scope, $entity, $id, $owner, $status);\n');
  dirty('a controller building a ScopedRecord is caught', 'server/src/Controller/X.php', S + "$r = new ScopedRecord($s, 'overtime', $id, $mine, 'Draft');\n", 'ScopedRecord is constructed only');
  dirty('Policy building a ScopedRecord is caught', POLICY_FILE, S + "$r = new \\TamOs\\Data\\Scope\\ScopedRecord($s, 'x', 'y', null, null);\n", 'ScopedRecord is constructed only');
  clean('a method named newAuthorization() is not construction', 'server/src/Controller/X.php', S + '$a = $this->newAuthorization(); $r = ScopedRecord::class;\n');

  // BF-3D: governed mail — network I/O and the provider stay in the adapter; the outbox has one
  // writer; no raw token or link is printed; the mail worker is an allowed, guarded CLI.
  const realAdapter = fs.readFileSync(path.join(root, MAIL_ADAPTER), 'utf8');
  clean('the real Resend adapter passes', MAIL_ADAPTER, realAdapter);
  for (const fn of ['curl_init', 'curl_exec', 'mail', 'mb_send_mail', 'fsockopen', 'stream_socket_client', 'stream_context_create', 'socket_create']) {
    dirty(fn + ' outside the mail adapter is caught', 'server/src/Auth/AccountRecovery.php', S + '$x = ' + fn + "('a', 'b');\n", 'network and mail I/O');
  }
  dirty('\\mail() in a controller is caught', 'server/src/Controller/AuthController.php', S + "\\mail($to, 'S', $b);\n", 'network and mail I/O');
  dirty('curl in another Mail file is caught', 'server/src/Mail/OutboxWorker.php', S + '$c = curl_init();\n', 'network and mail I/O');
  clean('a method named sendMail() is not mail()', 'server/src/Mail/OutboxWorker.php', S + '$this->transport->send($m); $x->mail($y); $e->curl_version;\n');
  clean('the Mail boundary may name the adapter', 'server/src/Mail/MailConfig.php', S + "return new ResendTransport($k, $f);\n");
  dirty('auth code naming the adapter is caught', 'server/src/Auth/AccountRecovery.php', S + 'function f(ResendTransport $t): void {}\n', 'only the Mail boundary');
  dirty('a controller constructing the adapter is caught', 'server/src/Controller/AuthController.php', S + "$t = new \\TamOs\\Mail\\ResendTransport($k, $f);\n", 'only the Mail boundary');
  dirty('the provider endpoint outside the adapter is caught', 'server/src/Mail/MailConfig.php', S + "const URL = 'https://api.resend.com/emails';\n", 'provider endpoint');
  clean('the outbox store writes the outbox', OUTBOX_STORE, S + "$this->db->execute(\"UPDATE mail_outbox SET status = 'sent' WHERE id = ?\", [$i]);\n");
  dirty('an outbox write elsewhere is caught', 'server/src/Data/Auth/AccountTokenStore.php', S + "$this->db->execute(\"INSERT INTO mail_outbox (user_id) VALUES (?)\", [$u]);\n", 'written only by ' + OUTBOX_STORE);
  dirty('an outbox delete elsewhere is caught', 'server/src/Data/Auth/SessionStore.php', S + "$this->db->execute('DELETE FROM mail_outbox WHERE id = ?', [$i]);\n", 'written only by ' + OUTBOX_STORE);
  for (const [name, src] of [['echo', 'echo $token;'], ['error_log', "error_log('reset ' . $rawToken);"], ['fwrite', 'fwrite(STDERR, $link);'], ['printf', "printf('%s', $recoveryLink);"], ['var_export', 'var_export($token);']]) {
    dirty('printing a token or link with ' + name + ' is caught', 'server/bin/mail.php', S + "if (PHP_SAPI !== 'cli') { exit(1); }\n" + src + '\n', 'never printed');
  }
  clean('the operator CLI prints its activation token once', 'server/bin/account.php', S + "if (PHP_SAPI !== 'cli') { exit(1); }\necho 'activation_token: ' . $issued->token . \"\\n\";\n");
  clean('mail.php with its CLI guard passes', 'server/bin/mail.php', S + "if (PHP_SAPI !== 'cli') { exit(1); }\necho 'sent: ' . $counts['sent'] . \"\\n\";\n");
  dirty('mail.php without the CLI guard is caught', 'server/bin/mail.php', S + "echo 'x';\n", 'non-CLI SAPI');
  cases.push({ name: 'server/bin/mail.php is authorized since BF-3D', run: () => checkTree(['server/bin/migrate.php', 'server/bin/account.php', 'server/bin/mail.php'], ['server/bin']), expect: 0 });
  treeCase('a fourth file under server/bin is still caught', ['server/bin/mail.php', 'server/bin/worker.php'], 'server/bin/ holds only');
  tenant('the real mail outbox migration passes (a system table)', fs.readFileSync(path.join(root, 'server/migrations/0013_create_mail_outbox.sql'), 'utf8'), 0);
  dirty('a Resend-shaped API key is caught (tests too)', 'server/tests/Unit/T.php', S + "$k = 're_" + 'Ab3'.repeat(9) + "';\n", 'secret');
  clean('a test key with separators is not key-shaped', 'server/tests/Unit/T.php', S + "$k = 're_test_not_a_real_key';\n");
  clean('RecoveryMail builds the recovery link', RECOVERY_MAIL, S + "const FRAGMENT = '/#recovery=';\n");
  dirty('a recovery link built elsewhere is caught', 'server/src/Auth/AccountRecovery.php', S + "$l = $origin . '/#recovery=' . $t;\n", 'recovery link is built only');
  // BF-4a2 (SDR-0004).
  clean('ActivationMail builds the activation link', ACTIVATION_MAIL, S + "const FRAGMENT = '/#activation=';\n");
  dirty('an activation link built elsewhere is caught', 'server/src/Employee/AccountService.php', S + "$l = $origin . '/#activation=' . $t;\n", 'activation link is built only');
  dirty('an activation link built in the worker is caught', 'server/src/Mail/OutboxWorker.php', S + "$l = $o . '/#activation=' . $t;\n", 'activation link is built only');
  for (const [name, src] of [['SessionToken::generate', '$t = SessionToken::generate();'], ['a token issue', '$this->auth->tokens()->issue($h, $u, \'activation\');'],
    ['ActivationMail', '$m = ActivationMail::build($o, $to, $t, 72, $r);'], ['the transport', 'function f(MailTransport $t): void {}']]) {
    dirty('account administration naming ' + name + ' is caught', 'server/src/Employee/AccountService.php', S + src + '\n', 'never issues a token');
    dirty('the Employee controller naming ' + name + ' is caught', EMPLOYEE_CONTROLLER, S + src + '\n', 'never issues a token');
  }
  clean('the worker may issue and build', 'server/src/Mail/OutboxWorker.php', S + "$t = SessionToken::generate();\n$m = ActivationMail::build($o, $to, $t, 72, $r);\n");
  dirty('an outbox enqueue outside a transaction is caught', 'server/src/Employee/AccountService.php', S + "$this->auth->outbox()->enqueueOnce($u, 'activation', $r);\n", 'queued only inside the transaction');
  clean('an outbox enqueue inside atomically passes', 'server/src/Employee/AccountService.php', S + "$this->data->atomically(function () use ($u): void { $this->auth->outbox()->enqueueOnce($u, 'activation', $r); });\n");
  dirty('an account audit outside a transaction is caught', 'server/src/Employee/AccountService.php', S + "$this->data->audit()->appendAccount($auth, $actor, 'disable', $u, $r);\n", 'inside the transaction');
  for (const h of ['HTTP_HOST', 'SERVER_NAME', 'HTTP_X_FORWARDED_HOST', 'HTTP_FORWARDED']) {
    dirty('reading ' + h + ' is caught', REQUEST_FILE, S + "$h = $header('" + h + "');\n", 'Host and forwarding headers');
  }
  clean('a comment naming HTTP_HOST passes', REQUEST_FILE, S + "// HTTP_HOST is never read\n");

  // BF-3C: business stores use ScopedDatabase and name the scope; company tables stay inside them.
  const STORE = 'server/src/Data/Employee/EmployeeStore.php';
  const realStore = fs.readFileSync(path.join(root, STORE), 'utf8');
  clean('the real EmployeeStore passes', STORE, realStore);
  clean('a new domain store over ScopedDatabase passes', 'server/src/Data/Contract/ContractStore.php', S + "final class ContractStore { public function __construct(private readonly ScopedDatabase $db) {}\n  public const LIST_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id FROM contracts WHERE company_id = :company_id';\n  public const LIST_SELF_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id FROM contracts WHERE company_id = :company_id AND employee_id = :self_employee_id';\n}\n");
  dirty('a business store taking the Database handle is caught', STORE, realStore.replace('private readonly ScopedDatabase $db', 'private readonly Database $db'), 'receives only ScopedDatabase');
  dirty('a business store reaching AuthData is caught', 'server/src/Data/Contract/ContractStore.php', S + 'function f(AuthData $d): void {}\n', 'receives only ScopedDatabase');
  dirty('a business statement without :company_id is caught', STORE, realStore.replace("FROM employees WHERE company_id = :company_id ORDER BY id'", "FROM employees ORDER BY id'"), 'must name :company_id');
  dirty('a business statement with a positional ? is caught', STORE, realStore.replace('WHERE id = :id AND company_id = :company_id\'', 'WHERE id = ? AND company_id = :company_id\''), 'named parameters only');
  dirty('a *_SELF_SQL without :self_employee_id is caught', STORE, realStore.replace(' AND id = :self_employee_id ORDER BY id', ' ORDER BY id'), 'LIST_SELF_SQL must name :self_employee_id');
  dirty('employees SQL in an auth store is caught', 'server/src/Data/Auth/AccountStore.php', S + "$this->db->select('SELECT id FROM employees WHERE id = ?', [$e]);\n", 'read and written only by business stores');
  dirty('employees SQL joined from a session read is caught', 'server/src/Data/Auth/SessionStore.php', S + "const Q = 'SELECT s.user_id FROM sessions s JOIN employees e ON e.id = s.user_id WHERE s.token_hash = ?';\n", 'read and written only by business stores');
  dirty('an employees write in ScopedDatabase itself is caught', SCOPED_DATABASE, S + "$this->db->execute('INSERT INTO employees (id, company_id, created_at) VALUES (?, ?, UTC_TIMESTAMP(6))', [$a, $b]);\n", 'read and written only by business stores');
  clean('prose naming employees is not SQL', 'server/src/Data/Auth/AccountStore.php', S + "// the employees table is scoped\n$m = 'employees are anchors';\n");

  // BF-4a1: Employee writes stay in EmployeeStore and never hard-delete; the audit trail is
  // append-only and has one writer; migrations stay contiguous; mutation routes declare Actions.
  const realAudit = fs.readFileSync(path.join(root, AUDIT_LOG), 'utf8');
  const inStore = (src, extra) => src.replace('    public const ENTITY', '    ' + extra + '\n    public const ENTITY');
  clean('the real AuditLog passes', AUDIT_LOG, realAudit);
  dirty('an audit UPDATE in AuditLog itself is caught', AUDIT_LOG, realAudit.replace('    public const ACTIONS', "    public const BAD_SQL = 'UPDATE audit_events SET fields = NULL WHERE company_id = :company_id';\n    public const ACTIONS"), 'append-only');
  dirty('an audit DELETE in a business store is caught', STORE, inStore(realStore, "public const PURGE_SQL = 'DELETE FROM audit_events WHERE company_id = :company_id';"), 'append-only');
  dirty('an audit TRUNCATE is caught', AUDIT_LOG, realAudit.replace('    public const ACTIONS', "    public const T_SQL = 'TRUNCATE TABLE audit_events';\n    public const ACTIONS"), 'append-only');
  dirty('an audit REPLACE is caught', AUDIT_LOG, realAudit.replace('    public const ACTIONS', "    public const R_SQL = 'REPLACE INTO audit_events (company_id) VALUES (:company_id)';\n    public const ACTIONS"), 'append-only');
  dirty('an audit insert outside AuditLog is caught', STORE, inStore(realStore, "public const LOG_SQL = 'INSERT INTO audit_events (company_id) VALUES (:company_id)';"), 'written only by ' + AUDIT_LOG);
  dirty('an employees write outside EmployeeStore is caught', AUDIT_LOG, realAudit.replace('    public const ACTIONS', "    public const BAD_SQL = 'UPDATE employees SET notes = NULL WHERE company_id = :company_id';\n    public const ACTIONS"), 'written only by ' + EMPLOYEE_STORE);
  dirty('a hard DELETE of an employee in EmployeeStore is caught', STORE, inStore(realStore, "public const DELETE_SQL = 'DELETE FROM employees WHERE id = :id AND company_id = :company_id';"), 'never hard-deleted');
  dirty('an employee TRUNCATE is caught', STORE, inStore(realStore, "public const T_SQL = 'TRUNCATE TABLE employees';"), 'never hard-deleted');

  // BF-4b1: overtime has one writer; its hard delete removes a Draft only; self SQL names the owner.
  const realOvertime = fs.readFileSync(path.join(root, OVERTIME_STORE), 'utf8');
  clean('the real OvertimeStore passes', OVERTIME_STORE, realOvertime);
  dirty('an overtime DELETE without the Draft predicate is caught', OVERTIME_STORE, realOvertime.replace(" AND version = :expected_version AND status = 'Draft'\";\n    public const DELETE_DRAFT_SELF_SQL", " AND version = :expected_version\";\n    public const DELETE_DRAFT_SELF_SQL"), 'removes only a Draft');
  dirty('an overtime DELETE without the version predicate is caught', OVERTIME_STORE, realOvertime.replace("employee_id = :self_employee_id AND version = :expected_version AND status = 'Draft'\";\n\n", "employee_id = :self_employee_id AND status = 'Draft'\";\n\n"), 'removes only a Draft');
  dirty('an overtime DELETE widened with OR is caught', OVERTIME_STORE, realOvertime.replace("AND status = 'Draft'\";\n    public const DELETE_DRAFT_SELF_SQL", "AND (status = 'Draft' OR status = 'Submitted')\";\n    public const DELETE_DRAFT_SELF_SQL"), 'removes only a Draft');
  dirty('an overtime write outside OvertimeStore is caught', STORE, inStore(realStore, "public const OT_SQL = 'UPDATE overtime_records SET status = :s WHERE company_id = :company_id';"), 'written only by ' + OVERTIME_STORE);
  dirty('an overtime TRUNCATE is caught', OVERTIME_STORE, realOvertime.replace('    public const ENTITY', "    public const T_SQL = 'TRUNCATE TABLE overtime_records';\n    public const ENTITY"), 'never truncated');
  dirty('a double-quoted *_SELF_SQL without :self_employee_id is caught', OVERTIME_STORE, realOvertime.replace("employee_id = :self_employee_id AND version = :expected_version AND status = 'Draft'\";\n    public const TRANSITION_SQL", "version = :expected_version AND status = 'Draft'\";\n    public const TRANSITION_SQL"), 'UPDATE_SELF_SQL must name :self_employee_id');
  dirty('overtime SQL in an auth store is caught', 'server/src/Data/Auth/AccountStore.php', S + "$this->db->select('SELECT id FROM overtime_records WHERE id = ?', [$e]);\n", 'read and written only by business stores');
  const SERVICE = 'server/src/Employee/EmployeeService.php';
  const realService = fs.readFileSync(path.join(root, SERVICE), 'utf8');
  clean('the real EmployeeService appends audit rows inside its transactions', SERVICE, realService);
  dirty('an audit append moved after the transaction is caught', SERVICE, realService.replace(
    "            $this->data->employees()->create($auth, $id, $profile);\n            $this->data->audit()->append(",
    "            $this->data->employees()->create($auth, $id, $profile);\n        }));\n        $this->writing(fn () => $this->data->atomically(function (): void {\n        }));\n        $this->data->audit()->append("), 'inside the transaction');
  dirty('an audit append with no transaction is caught', 'server/src/Overtime/OvertimeService.php', S + "$this->data->audit()->append($auth, $actor, 'employee', $id, [], $rid);\n", 'inside the transaction');
  clean('an audit append inside atomically passes', 'server/src/Overtime/OvertimeService.php', S + "$this->data->atomically(function () use ($auth): void { $x = '())('; $this->data->audit()->append($auth, $a, 'employee', $i, [], $r); });\n");
  const realAuditMigration = fs.readFileSync(path.join(root, 'server/migrations/0017_create_audit_events.sql'), 'utf8');
  tenant('the real audit migration passes (a registered company table)', realAuditMigration, 0);
  tenant('an audit table without its tenant UNIQUE is caught', realAuditMigration.replace('  UNIQUE KEY audit_events_company_id (company_id, id),\n', ''), 'UNIQUE KEY');
  const realBackfill = fs.readFileSync(path.join(root, LEGACY_BACKFILL_FILE), 'utf8');
  cases.push({ name: 'the real legacy employee backfill passes at its pinned digest', run: () => checkMigrationSql(realBackfill, LEGACY_BACKFILL_FILE), expect: 0 });
  cases.push({ name: 'an edited legacy employee backfill is caught', run: () => checkMigrationSql(realBackfill.replace("'LEGACY-'", "'LEGACY_'"), LEGACY_BACKFILL_FILE), expect: 'pinned digest' });
  cases.push({ name: 'a backfill with an appended DELETE is caught', run: () => checkMigrationSql(realBackfill + 'DELETE FROM employees;\n', LEGACY_BACKFILL_FILE), expect: 'pinned digest' });
  cases.push({ name: 'the backfill bytes under another migration name are caught', run: () => checkMigrationSql(realBackfill, 'server/migrations/0018_backfill_legacy_employees.sql'), expect: 'no seed data' });
  cases.push({ name: 'contiguous migrations pass', run: () => checkMigrationContinuity(['server/migrations/0001_a.sql', 'server/migrations/0002_b.sql']), expect: 0 });
  cases.push({ name: 'a migration gap is caught', run: () => checkMigrationContinuity(['server/migrations/0001_a.sql', 'server/migrations/0003_c.sql']), expect: 'without a gap' });
  cases.push({ name: 'a duplicate migration version is caught', run: () => checkMigrationContinuity(['server/migrations/0001_a.sql', 'server/migrations/0001_b.sql']), expect: 'without a gap' });
  const realRoutes = fs.readFileSync(path.join(root, ROUTES_FILE), 'utf8');
  cases.push({ name: 'the real Routes.php declares every Action', run: () => checkRouteActions(realRoutes), expect: 0 });
  cases.push({ name: 'a business mutation without an Action is caught', run: () => checkRouteActions(realRoutes.replace(', [], RouteAuth::Required, Action::EmployeeDelete)', ', [], RouteAuth::Required)')), expect: 'must declare its Action' });
  cases.push({ name: 'an account route without account.manage is caught', run: () => checkRouteActions(realRoutes.replace("$employees->disableAccount(...), [], RouteAuth::Required, Action::AccountManage)", "$employees->disableAccount(...), [], RouteAuth::Required, Action::EmployeeUpdate)")), expect: 'must declare Action::AccountManage' });
  cases.push({ name: 'account.manage on another route is caught', run: () => checkRouteActions(realRoutes.replace("$employees->archive(...), [], RouteAuth::Required, Action::EmployeeDelete)", "$employees->archive(...), [], RouteAuth::Required, Action::AccountManage)")), expect: 'must not declare Action::AccountManage' });
  cases.push({ name: 'an overtime review route with a weaker Action is caught', run: () => checkRouteActions(realRoutes.replace("$overtime->review(...), [], RouteAuth::Required, Action::OvertimeManage)", "$overtime->review(...), [], RouteAuth::Required, Action::OvertimeSubmitSelf)")), expect: 'must declare Action::OvertimeManage' });
  cases.push({ name: 'an overtime delete route under another Action is caught', run: () => checkRouteActions(realRoutes.replace("$overtime->delete(...), [], RouteAuth::Required, Action::OvertimeDeleteSelfDraft)", "$overtime->delete(...), [], RouteAuth::Required, Action::OvertimeManage)")), expect: 'must declare Action::OvertimeDeleteSelfDraft' });
  cases.push({ name: 'a missing overtime route is caught', run: () => checkRouteActions(realRoutes.replace("            new Route('POST', '/api/overtime-records/reject', $overtime->reject(...), [], RouteAuth::Required, Action::OvertimeManage),\n", '')), expect: 'overtime route POST /api/overtime-records/reject is missing' });
  cases.push({ name: 'a missing account route is caught', run: () => checkRouteActions(realRoutes.replace("            new Route('POST', '/api/employees/enable-account', $employees->enableAccount(...), [], RouteAuth::Required, Action::AccountManage),\n", '')), expect: 'is missing' });
  cases.push({ name: 'a self-service route claiming an Action is caught', run: () => checkRouteActions(realRoutes.replace("$auth->login(...)),", "$auth->login(...), [], RouteAuth::Required, Action::SettingsManage),")), expect: 'must not declare' });

  // BF-3C: ACTION parity against the real js/core/authz.js and the real Action.php, then each drift.
  const realAction = fs.readFileSync(path.join(root, ACTION_FILE), 'utf8');
  const realAuthz = fs.readFileSync(path.join(root, FRONTEND_AUTHZ), 'utf8');
  const parity = (name, php, js, needle) => cases.push({ name: 'ACTION parity: ' + name, run: () => checkActionParity(php, js), expect: needle });
  const swap = (src, from, to) => { if (!src.includes(from)) throw new Error('selftest fixture not found: ' + from); return src.replace(from, to); };
  parity('the real Action.php equals the real authz.js', realAction, realAuthz, 0);
  parity('a missing server action is caught', swap(swap(swap(realAction, "    case DataReset = 'data.reset';\n", ''), '            self::DataReset => Rule::CeoOnly,\n', ''), '            self::DataReset => null,\n', ''), realAuthz, 'missing data.reset');
  parity('an extra server action is caught', swap(swap(swap(realAction, "    case DataReset = 'data.reset';\n", "    case DataReset = 'data.reset';\n    case EmployeeMerge = 'employee.merge';\n"),
    '            self::DataReset => Rule::CeoOnly,\n', '            self::DataReset => Rule::CeoOnly,\n            self::EmployeeMerge => Rule::CeoOnly,\n'),
    '            self::DataReset => null,\n', '            self::DataReset => null,\n            self::EmployeeMerge => null,\n'), realAuthz, 'frontend lacks: employee.merge');
  parity('a renamed server action is caught', swap(realAction, "'settings.manage'", "'settings.admin'"), realAuthz, 'missing settings.manage');
  parity('a broadened server Employee rule is caught', swap(realAction, 'self::EmployeeDelete => Rule::CeoOnly,', 'self::EmployeeDelete => Rule::CeoOrOwnDraft,'), realAuthz, 'rule drift for employee.delete');
  parity('a narrowed server Self rule is caught', swap(realAction, 'self::OvertimeSubmitSelf => Rule::CeoOrOwnDraft,', 'self::OvertimeSubmitSelf => Rule::CeoOnly,'), realAuthz, 'rule drift for overtime.submitSelf');
  parity('a changed server entity is caught', swap(realAction, "self::ContractUpdate => 'contract',", "self::ContractUpdate => 'employee',"), realAuthz, 'entity drift for contract.update');
  parity('a record-free action made record-bearing is caught', swap(realAction, 'self::ImportCommit => null,', "self::ImportCommit => 'transaction',"), realAuthz, 'entity drift for import.commit');
  parity('a default arm is caught (unparseable)', swap(realAction, '            self::DataReset => Rule::CeoOnly,\n', '            default => Rule::CeoOnly,\n'), realAuthz, 'parseable');
  parity('grouped match arms are caught (unparseable)', swap(swap(realAction, '            self::EmployeeUpdate => Rule::CeoOnly,\n', ''), 'self::EmployeeCreate => Rule::CeoOnly,', 'self::EmployeeCreate, self::EmployeeUpdate => Rule::CeoOnly,'), realAuthz, 'parseable');
  parity('a duplicated case is caught (unparseable)', swap(realAction, "    case DataReset = 'data.reset';\n", "    case DataReset = 'data.reset';\n    case DataReset = 'data.reset';\n"), realAuthz, 'parseable');
  parity('an unparseable Action.php is caught', S + "enum Action: string { case A = 'a'; }\n", realAuthz, 'parseable');
  parity('a frontend action the server lacks is caught', realAction, swap(realAuthz, "  ACCOUNT_MANAGE:     'account.manage'\n", "  ACCOUNT_MANAGE:     'account.manage',\n  EMPLOYEE_MERGE:     'employee.merge'\n"), 'employee.merge');
  // BF-4a2: account.manage is shared, CEO-only and record-bearing on the Employee record.
  parity('account.manage missing on the server is caught', swap(swap(swap(realAction, "    case AccountManage = 'account.manage';\n", ''), '            self::AccountManage => Rule::CeoOnly,\n', ''), "            self::AccountManage => 'employee',\n", ''), realAuthz, 'missing account.manage');
  parity('account.manage missing on the frontend is caught', realAction, swap(swap(swap(swap(realAuthz, "  DATA_RESET:         'data.reset',\n", "  DATA_RESET:         'data.reset'\n"), "  ACCOUNT_MANAGE:     'account.manage'\n", ''), "  'account.manage':      'employee'     // administers the login bound to an Employee record\n", ''), "  'account.manage':      ceoOnly,\n", ''), 'frontend lacks: account.manage');
  parity('a broadened server account.manage rule is caught', swap(realAction, 'self::AccountManage => Rule::CeoOnly,', 'self::AccountManage => Rule::CeoOrOwnDraft,'), realAuthz, 'rule drift for account.manage');
  parity('a record-free server account.manage is caught', swap(realAction, "self::AccountManage => 'employee',", 'self::AccountManage => null,'), realAuthz, 'entity drift for account.manage');
  parity('a broadened frontend Employee rule is caught', realAction, swap(realAuthz, "  'employee.create':     ceoOnly,", "  'employee.create':     selfDraftOnly,"), 'rule drift for employee.create');
  parity('an allow-all frontend rule is caught', realAction, swap(realAuthz, "  'data.reset':          ceoOnly,", "  'data.reset':          function(){ return true; },"), 'neither CeoOnly nor CeoOrOwnDraft');
  parity('a changed frontend entity is caught', realAction, swap(realAuthz, "  'overtime.manage':     'overtime',", "  'overtime.manage':     'payrollPlan',"), 'entity drift for overtime.manage');
  parity('an authz.js that cannot be evaluated fails closed', realAction, 'const ACTIONS = ;', 'could not be evaluated');
  dirty('a variable include outside the allow-list is caught', 'server/src/Http/X.php', S + 'require $file;\n', 'include');
  clean('prose that reads like SELECT…FROM is not SQL', 'server/src/X.php', S + "\$m = 'Select a principal from the list above';\n");
  treeCase('composer.json is caught', ['server/composer.json'], 'Composer');
  treeCase('a vendor tree is caught', ['server/vendor/autoload.php'], 'Composer');
  treeCase('a stray .sql file is caught', ['server/src/schema.sql'], 'belong only in server/migrations');
  treeCase('a .env file is caught', ['server/.env'], 'forbidden');
  treeCase('an unexpected file type is caught', ['server/src/notes.txt'], 'unexpected');

  const contract = { API_HEADERS: { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' }, HSTS_PRODUCTION: 'max-age=1' };
  const phpHeaders = (entries, hsts) => S + 'final class ApiHeaders {\n    public const HEADERS = [\n' + entries.map(([k, v]) => "        '" + k + "' => '" + v + "',\n").join('') + "    ];\n    public const HSTS = '" + hsts + "';\n}\n";
  cases.push({ name: 'matching header mirror passes', run: () => checkParity(phpHeaders([['Cache-Control', 'no-store, private'], ['X-Content-Type-Options', 'nosniff']], 'max-age=1'), contract), expect: 0 });
  cases.push({ name: 'a drifted header value is caught', run: () => checkParity(phpHeaders([['Cache-Control', 'no-cache'], ['X-Content-Type-Options', 'nosniff']], 'max-age=1'), contract), expect: 'drifted' });
  cases.push({ name: 'a missing header is caught', run: () => checkParity(phpHeaders([['Cache-Control', 'no-store, private']], 'max-age=1'), contract), expect: 'drifted' });
  cases.push({ name: 'a reordered header set is caught', run: () => checkParity(phpHeaders([['X-Content-Type-Options', 'nosniff'], ['Cache-Control', 'no-store, private']], 'max-age=1'), contract), expect: 'drifted' });
  cases.push({ name: 'a drifted HSTS value is caught', run: () => checkParity(phpHeaders([['Cache-Control', 'no-store, private'], ['X-Content-Type-Options', 'nosniff']], 'max-age=1; includeSubDomains'), contract), expect: 'HSTS' });
  cases.push({ name: 'an unparseable mirror is caught', run: () => checkParity(S + "final class ApiHeaders { public const HEADERS = ['a' => 'b', 'c' => 'd']; public const HSTS = 'x'; }\n", contract), expect: 'parseable' });
  cases.push({ name: 'the real mirror matches the real contract', run: () => checkParity(fs.readFileSync(path.join(root, 'server/src/Http/ApiHeaders.php'), 'utf8'), require('./package-headers.js')), expect: 0 });

  cases.push({ name: 'clean git state passes', run: () => checkGitHygiene(['server/src/X.php'], [], []), expect: 0 });
  cases.push({ name: 'an ignored server file is caught (the *secret* trap)', run: () => checkGitHygiene(['server/src/SecretStore.php'], ['server/src/SecretStore.php'], []), expect: 'ignored' });
  cases.push({ name: 'an untracked server file is caught', run: () => checkGitHygiene(['server/src/New.php'], [], ['server/src/New.php']), expect: 'not tracked' });
  cases.push({ name: 'the ignored local config is permitted', run: () => checkGitHygiene(['server/config/config.local.php'], ['server/config/config.local.php'], []), expect: 0 });
  // Lower-case on purpose: `*secret*` matches case-sensitively on Linux, case-insensitively on Windows.
  cases.push({ name: 'the real .gitignore ignores a *secret* file name (trap is real)', run: () => (gitIgnored(['server/src/client_secret.php']).length === 1 ? [] : ['not ignored']), expect: 0 });
  cases.push({ name: 'the real .gitignore ignores the local config', run: () => (gitIgnored(['server/config/config.local.php']).length === 1 ? [] : ['not ignored']), expect: 0 });

  let passed = 0;
  const failed = [];
  for (const c of cases) {
    const v = c.run();
    const ok = c.expect === 0 ? v.length === 0 : v.some((m) => m.toLowerCase().includes(String(c.expect).toLowerCase()));
    if (ok) passed++;
    else failed.push(c.name + ' >> ' + (v.length ? v.join(' | ') : 'no violation reported'));
  }
  if (failed.length) {
    console.error('SELFTEST FAILED -- ' + passed + ' passed, ' + failed.length + ' failed:');
    for (const f of failed) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('SELFTEST PASSED -- ' + passed + ' passed, 0 failed.');
}

if (process.argv.includes('--selftest')) selftest();
else run();
