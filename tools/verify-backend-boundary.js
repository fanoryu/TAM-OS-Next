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
 *   - (BF-4e) finance_postings is written outside server/src/Data/Finance/FinancePostingStore.php or
 *     by anything but an INSERT of a 'Planned' posting (a posting is immutable: no UPDATE, DELETE,
 *     REPLACE or TRUNCATE); the Finance code writes or calls the store of its Payroll or Supplemental
 *     source, locks anything but one row by primary key, computes money, or names an execution,
 *     payment, actual, account, category, monthly-plan, reversal or correction concept; a Finance
 *     posting route declares anything but the Action of its source domain, or another Finance route
 *     exists;
 *   - (BF-4f) finance_executions is written outside server/src/Data/Finance/FinanceExecutionStore.php
 *     or by anything but its one INSERT (an execution is immutable: no UPDATE, DELETE, REPLACE or
 *     TRUNCATE — no reversal, no correction); the execution locks anything but its one posting row by
 *     primary key, calls another store, computes money, or names a reversal, correction, refund,
 *     partial, settlement, reconciliation, company or bank account, reference, note, category, batch
 *     or schedule concept; its input allows anything but the five approved keys or the closed payment
 *     method list drifts; the execution route declares anything but finance.execute, finance.execute
 *     is declared by any other route, or another Finance execution route exists;
 *   - (OPS-1) a backup class is named outside the backup tooling (server/src/Ops/,
 *     server/src/Data/Backup/, server/bin/backup.php) — backups have no HTTP surface; libsodium is used
 *     outside server/src/Ops/BackupCipher.php, or a file is deleted or renamed outside
 *     server/src/Ops/BackupStore.php; the host-side create path names the secret key, decryption or
 *     the verifier; the backup reader holds anything but SELECT statements (no write, locking read or
 *     file output) or an advisory lock other than tamos_backup, or server/src/Data/Backup/ holds
 *     another file; a migration creates a table that BackupTables does not classify exactly once
 *     (backed up or excluded), the excluded or append-only lists drift, the backed-up order breaks a
 *     foreign key, or the reader's per-table statements drift from that list;
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
// The only files allowed under server/bin/ (BF-2B migrate, BF-3B account, BF-3D mail, OPS-1 backup),
// and the only shape a migration file may have.
const CLI_FILES = new Set(['server/bin/migrate.php', 'server/bin/account.php', 'server/bin/mail.php', 'server/bin/backup.php']);
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
  // BF-4b2: approval reuses overtime.manage (ACTIONS stay 21).
  '/api/overtime-records/approve': 'OvertimeManage',
};
// BF-4b2 (D-BF4b-3/4 = A): the TAM-OT-1 valuation is integer arithmetic only, and the Overtime
// code paths carry no payroll or finance side effect.
const OVERTIME_VALUATION = 'server/src/Overtime/OvertimeValuation.php';
const OVERTIME_DIR = 'server/src/Overtime/';
const OVERTIME_CONTROLLER = 'server/src/Controller/OvertimeController.php';
// BF-4c1 (owner decisions D-PAY-1..6 = A): the payroll plan and its overtime links have one
// writer; Payroll reads Approved overtime and never values it; its calculation is integer-only;
// it has no finance and no statutory side effect; each payroll write route declares the existing
// payroll.manage (ACTIONS stay 21); its inputs take no identity key.
// BF-4c2 authorized revision (D-BF4c2-1..4 = A): exactly one statement — COMMIT_STATEMENT — writes
// 'Committed', committed_at and the commit idempotency key, and the one commit route joins the
// payroll writes. Was: no statement wrote 'Committed' and there was no commit route.
const PAYROLL_STORE = 'server/src/Data/Payroll/PayrollStore.php';
const PAYROLL_DIR = 'server/src/Payroll/';
const PAYROLL_CONTROLLER = 'server/src/Controller/PayrollController.php';
const PAYROLL_CALCULATION = 'server/src/Payroll/PayrollCalculation.php';
const PAYROLL_INPUT = 'server/src/Payroll/PayrollInput.php';
const PAYROLL_ROUTES = ['/api/payroll-plans/generate', '/api/payroll-plans/review', '/api/payroll-plans/approve', '/api/payroll-plans/return', '/api/payroll-plans/cancel', '/api/payroll-plans/commit'];
const PAYROLL_COMMIT_ROUTE = '/api/payroll-plans/commit';
const COMMIT_STATEMENT = "UPDATE payroll_plans SET status = 'Committed', committed_at = UTC_TIMESTAMP(6), commit_idempotency_key = :commit_idempotency_key, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Ready'";
// BF-4d (owner decisions D-SPAY-1..4 = A): the Supplemental Payroll document and its overtime links
// have one writer; Supplemental reads Approved overtime and the Committed base plan and never values
// or writes either (no base Payroll, Overtime or Employee store call, and those tables keep their own
// single writers); it has no finance, payment, posting, execution or statutory side effect; it sums
// money only in PHP (no SQL money arithmetic); exactly one statement — SUPPLEMENTAL_COMMIT_STATEMENT —
// writes 'Committed', committed_at and the commit key; each write route declares the existing,
// record-free supplemental.manage (ACTIONS stay 21); its inputs take no identity, money or overtime key.
const SUPPLEMENTAL_STORE = 'server/src/Data/Supplemental/SupplementalStore.php';
const SUPPLEMENTAL_DIR = 'server/src/Supplemental/';
const SUPPLEMENTAL_CONTROLLER = 'server/src/Controller/SupplementalController.php';
const SUPPLEMENTAL_INPUT = 'server/src/Supplemental/SupplementalInput.php';
const SUPPLEMENTAL_ROUTES = ['/api/supplemental-payrolls/generate', '/api/supplemental-payrolls/review', '/api/supplemental-payrolls/approve', '/api/supplemental-payrolls/return', '/api/supplemental-payrolls/cancel', '/api/supplemental-payrolls/commit'];
const SUPPLEMENTAL_COMMIT_STATEMENT = "UPDATE supplemental_payrolls SET status = 'Committed', committed_at = UTC_TIMESTAMP(6), commit_idempotency_key = :commit_idempotency_key, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Ready'";
// BF-4e (owner decisions D-FIN-1..5 = A): the Finance posting has one writer, which only inserts a
// 'Planned' posting of one Committed source — a posting is immutable (no UPDATE, DELETE, REPLACE or
// TRUNCATE anywhere). Finance reads and locks its source by primary key and never writes it or calls
// its store (Payroll and Supplemental keep their single writers); it never computes money (the amount
// is the source's stored string); it has no execution, payment, actual, account, category,
// monthly-plan, reversal or correction vocabulary; each posting route declares the Action of its
// source domain — the base plan posting payroll.manage, the Supplemental posting supplemental.manage
// (ACTIONS stay 21) — and the month read none; its inputs take no identity, money, month or status key.
const FINANCE_STORE = 'server/src/Data/Finance/FinancePostingStore.php';
const FINANCE_DIR = 'server/src/Finance/';
const FINANCE_CONTROLLER = 'server/src/Controller/FinanceController.php';
const FINANCE_INPUT = 'server/src/Finance/FinancePostingInput.php';
const FINANCE_ROUTES = { '/api/finance-postings/payroll-plan': 'PayrollManage', '/api/finance-postings/supplemental-payroll': 'SupplementalManage' };
const FINANCE_READ_ROUTE = 'GET /api/finance-postings';
// BF-4f (owner decisions D-FEX-1..8 = A): the Finance execution has one writer, which only inserts
// one full execution of one Planned posting — an execution is immutable (no UPDATE, DELETE, REPLACE
// or TRUNCATE anywhere: no reversal, no correction). It locks only its posting, by primary key, and
// never writes it (the posting stays Planned; finance_postings keeps its one writer) or calls another
// store; it never computes money (the amount is the posting's stored string); it has no reversal,
// correction, refund, partial, settlement, reconciliation, company-account, bank-account, reference,
// note, category, batch or schedule vocabulary; the command declares exactly the existing
// record-free finance.execute (ACTIONS stay 21) and the month read none; its input takes exactly the
// five approved keys, the payment method from the closed list.
const FINANCE_EXECUTION_STORE = 'server/src/Data/Finance/FinanceExecutionStore.php';
const FINANCE_EXECUTION_PREFIX = 'server/src/Finance/FinanceExecution';
const FINANCE_EXECUTION_CONTROLLER = 'server/src/Controller/FinanceExecutionController.php';
const FINANCE_EXECUTION_INPUT = 'server/src/Finance/FinanceExecutionInput.php';
const FINANCE_EXECUTION_ROUTE = '/api/finance-executions/execute';
const FINANCE_EXECUTION_READ_ROUTE = 'GET /api/finance-executions';
const FINANCE_EXECUTION_KEYS = 'financePostingId,expectedAmount,executedOn,paymentMethod,idempotencyKey';
const PAYMENT_METHODS = 'cash,bankTransfer,qris,virtualAccount,creditCard,other';
const ACTION_COUNT = 21;
// OPS-1 (D-AB-1..16 = recommended): encrypted database backups are operator tooling, never an HTTP
// surface. The one cross-company reader (read-only), the backup classes and their CLI form a closed
// set; only the cipher uses libsodium, only the store deletes or renames files (its own names), and
// the host-side create path never names the secret key, decryption or the verifier (SDR-0002 §16).
const BACKUP_CLI = 'server/bin/backup.php';
const BACKUP_DATA_DIR = 'server/src/Data/Backup/';
const BACKUP_READER = 'server/src/Data/Backup/BackupReader.php';
const OPS_DIR = 'server/src/Ops/';
const BACKUP_CIPHER = 'server/src/Ops/BackupCipher.php';
const BACKUP_STORE = 'server/src/Ops/BackupStore.php';
const BACKUP_TABLES_FILE = 'server/src/Ops/BackupTables.php';
const BACKUP_HOST_FILES = new Set(['server/src/Ops/BackupCreator.php', BACKUP_STORE, BACKUP_READER]);
const BACKUP_EXCLUDED = 'account_tokens,auth_rate_limits,mail_outbox,sessions';
const BACKUP_APPEND_ONLY = 'auth_events,audit_events';

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
  // OPS-1: backups are operator tooling only — no route, controller, service or kernel names them.
  { id: 'backup-surface', re: /\b(BackupReader|BackupCreator|BackupStore|BackupVerifier|BackupCipher|BackupParser|BackupFormat|BackupConfig|BackupTables)\b/, msg: 'the backup classes are named only by the backup tooling (' + OPS_DIR + ', ' + BACKUP_DATA_DIR + ', ' + BACKUP_CLI + '): backups have no HTTP surface (OPS-1)', allow: (f) => f.startsWith(OPS_DIR) || f.startsWith(BACKUP_DATA_DIR) || f === BACKUP_CLI },
  { id: 'sodium', re: /(?<![\w$>:])sodium_[a-z0-9_]+\s*\(|\bSODIUM_[A-Z0-9_]+\b/i, msg: 'libsodium is used only by ' + BACKUP_CIPHER, allow: (f) => f === BACKUP_CIPHER },
  { id: 'file-delete', re: /(?<![\w$>:])(?<!\bfunction\s+)(unlink|rename|rmdir)\s*\(/i, msg: 'files are deleted or renamed only by ' + BACKUP_STORE + ' (only its own backup names)', allow: (f) => f === BACKUP_STORE },
  { id: 'backup-host-decrypt', re: /\b(readSecretKeyFile|generateKeyPair|BackupVerifier|BackupParser|publicKeyOf)\b|\bBackupCipher\s*::\s*open\s*\(/, msg: 'the host-side backup path (create, store, reader) never names the secret key, decryption or the verifier: the host can encrypt a backup, never read one (SDR-0002 §16)', allow: (f) => !BACKUP_HOST_FILES.has(f) },
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
  // BF-4c1: payroll_plans and payroll_plan_overtime have one writer; a plan is never deleted and
  // neither table is ever truncated.
  { id: 'payroll-writes', re: /^\s*(INSERT\s+(IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+`?payroll_plans\b/i, msg: 'payroll_plans is written only by ' + PAYROLL_STORE, allow: (f) => f === PAYROLL_STORE },
  { id: 'payroll-hard-delete', re: /^\s*(DELETE\s+FROM|TRUNCATE(\s+TABLE)?)\s+`?payroll_plans\b/i, msg: 'a payroll plan is never deleted (cancel is a status) and payroll_plans is never truncated' },
  { id: 'payroll-link-writes', re: /^\s*(INSERT\s+(IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+`?payroll_plan_overtime\b/i, msg: 'payroll_plan_overtime is written only by ' + PAYROLL_STORE, allow: (f) => f === PAYROLL_STORE },
  { id: 'payroll-link-truncate', re: /^\s*TRUNCATE(\s+TABLE)?\s+`?payroll_plan_overtime\b/i, msg: 'payroll_plan_overtime is never truncated' },
  // BF-4d: supplemental_payrolls and supplemental_payroll_overtime have one writer; a document is
  // never deleted (cancel is a status) and neither table is ever truncated.
  { id: 'supplemental-writes', re: /^\s*(INSERT\s+(IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+`?supplemental_payrolls\b/i, msg: 'supplemental_payrolls is written only by ' + SUPPLEMENTAL_STORE, allow: (f) => f === SUPPLEMENTAL_STORE },
  { id: 'supplemental-hard-delete', re: /^\s*(DELETE\s+FROM|TRUNCATE(\s+TABLE)?)\s+`?supplemental_payrolls\b/i, msg: 'a Supplemental document is never deleted (cancel is a status) and supplemental_payrolls is never truncated' },
  { id: 'supplemental-link-writes', re: /^\s*(INSERT\s+(IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+`?supplemental_payroll_overtime\b/i, msg: 'supplemental_payroll_overtime is written only by ' + SUPPLEMENTAL_STORE, allow: (f) => f === SUPPLEMENTAL_STORE },
  { id: 'supplemental-link-truncate', re: /^\s*TRUNCATE(\s+TABLE)?\s+`?supplemental_payroll_overtime\b/i, msg: 'supplemental_payroll_overtime is never truncated' },
  // BF-4e: finance_postings has one writer, which only inserts — a posting is immutable.
  { id: 'finance-writes', re: /^\s*(INSERT\s+(IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+`?finance_postings\b/i, msg: 'finance_postings is written only by ' + FINANCE_STORE, allow: (f) => f === FINANCE_STORE },
  { id: 'finance-immutable', re: /^\s*(UPDATE|DELETE\s+FROM|REPLACE\s+INTO|TRUNCATE(\s+TABLE)?)\s+`?finance_postings\b/i, msg: 'a Finance posting is immutable: no UPDATE, DELETE, REPLACE or TRUNCATE of finance_postings' },
  // BF-4f: finance_executions has one writer, which only inserts — an execution is immutable.
  { id: 'finance-execution-writes', re: /^\s*(INSERT\s+(IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+`?finance_executions\b/i, msg: 'finance_executions is written only by ' + FINANCE_EXECUTION_STORE, allow: (f) => f === FINANCE_EXECUTION_STORE },
  { id: 'finance-execution-immutable', re: /^\s*(UPDATE|DELETE\s+FROM|REPLACE\s+INTO|TRUNCATE(\s+TABLE)?)\s+`?finance_executions\b/i, msg: 'a Finance execution is immutable: no UPDATE, DELETE, REPLACE or TRUNCATE of finance_executions (no reversal, no correction)' },
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
const COMPANY_TABLES = new Set(['employees', 'audit_events', 'overtime_records', 'payroll_plans', 'payroll_plan_overtime', 'supplemental_payrolls', 'supplemental_payroll_overtime', 'finance_postings', 'finance_executions']);
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
  }
  // BF-4c1 + BF-4c2: exactly the six payroll writes (the five BF-4c1 ones and commit) declare
  // payroll.manage; no other status, payment or payslip route.
  for (const path of PAYROLL_ROUTES) {
    const line = src.split('\n').find((l) => l.includes("new Route('POST', '" + path + "'"));
    if (!line) out.push('Routes.php: payroll route POST ' + path + ' is missing');
    else if (!/\bAction::PayrollManage\)/.test(line)) out.push('Routes.php: payroll route POST ' + path + ' must declare Action::PayrollManage');
  }
  for (const m of src.matchAll(/new Route\('([A-Z]+)', '([^']+)'([^\n]*)/g)) {
    // BF-4e authorized revision: the base plan posting route also declares payroll.manage (its source
    // domain's Action, D-FIN-2 = A). Was: payroll.manage on the payroll writes only.
    if (/\bAction::PayrollManage\b/.test(m[3]) && (!(PAYROLL_ROUTES.includes(m[2]) || FINANCE_ROUTES[m[2]] === 'PayrollManage') || m[1] !== 'POST')) out.push('Routes.php: ' + m[1] + ' ' + m[2] + ' is not a payroll write and must not declare Action::PayrollManage');
    const commitRoute = m[1] === 'POST' && m[2] === PAYROLL_COMMIT_ROUTE;
    // BF-4d authorized revision: the Supplemental routes are governed below. Was: every /payroll/ path here.
    // BF-4e authorized revision: the Finance posting routes are governed below too.
    if (/payroll/i.test(m[2]) && !/^\/api\/supplemental-payroll/.test(m[2]) && !/^\/api\/finance-postings\//.test(m[2]) && !commitRoute && /commit|status|paid|pay\b|payslip|post/i.test(m[2].replace('/api/payroll-plans', '').replace('/api/payroll-plan', ''))) out.push('Routes.php: ' + m[1] + ' ' + m[2] + ' — no payroll status, payment or payslip route (the one commit route is POST ' + PAYROLL_COMMIT_ROUTE + ')');
  }
  // BF-4d: exactly the six Supplemental writes declare supplemental.manage; no Supplemental status,
  // payment, posting, execution or payslip route.
  for (const path of SUPPLEMENTAL_ROUTES) {
    const line = src.split('\n').find((l) => l.includes("new Route('POST', '" + path + "'"));
    if (!line) out.push('Routes.php: Supplemental route POST ' + path + ' is missing');
    else if (!/\bAction::SupplementalManage\)/.test(line)) out.push('Routes.php: Supplemental route POST ' + path + ' must declare Action::SupplementalManage');
  }
  for (const m of src.matchAll(/new Route\('([A-Z]+)', '([^']+)'([^\n]*)/g)) {
    // BF-4e authorized revision: the Supplemental posting route also declares supplemental.manage (its
    // source domain's Action). Was: supplemental.manage on the Supplemental writes only.
    if (/\bAction::SupplementalManage\b/.test(m[3]) && (!(SUPPLEMENTAL_ROUTES.includes(m[2]) || FINANCE_ROUTES[m[2]] === 'SupplementalManage') || m[1] !== 'POST')) out.push('Routes.php: ' + m[1] + ' ' + m[2] + ' is not a Supplemental write and must not declare Action::SupplementalManage');
    if (/^\/api\/supplemental-payroll/.test(m[2]) && /status|paid|pay\b|payslip|post|execut|finance|bank/i.test(m[2])) out.push('Routes.php: ' + m[1] + ' ' + m[2] + ' — no Supplemental status, payment, posting, execution or payslip route');
  }
  // BF-4e: exactly the two Finance posting writes, each under its source domain's Action, and the CEO
  // month read with no Action — no execution, payment, actual, reversal, correction or other Finance route.
  for (const [path, action] of Object.entries(FINANCE_ROUTES)) {
    const line = src.split('\n').find((l) => l.includes("new Route('POST', '" + path + "'"));
    if (!line) out.push('Routes.php: Finance posting route POST ' + path + ' is missing');
    else if (!new RegExp('RouteAuth::Required, Action::' + action + '\\),$').test(line.trim())) out.push('Routes.php: Finance posting route POST ' + path + ' must declare exactly Action::' + action + ' (its source domain)');
  }
  if (!src.split('\n').some((l) => l.includes("new Route('GET', '/api/finance-postings', ") && /\['month'\], RouteAuth::Required\),$/.test(l.trim()))) out.push('Routes.php: the Finance month read GET /api/finance-postings (?month=, a session, no Action) is missing');
  // BF-4f: exactly one Finance execution command under exactly the record-free finance.execute, and
  // the CEO execution month read with no Action; finance.execute is declared by no other route.
  const execLine = src.split('\n').find((l) => l.includes("new Route('POST', '" + FINANCE_EXECUTION_ROUTE + "'"));
  if (!execLine) out.push('Routes.php: Finance execution route POST ' + FINANCE_EXECUTION_ROUTE + ' is missing');
  else if (!/RouteAuth::Required, Action::FinanceExecute\),$/.test(execLine.trim())) out.push('Routes.php: Finance execution route POST ' + FINANCE_EXECUTION_ROUTE + ' must declare exactly Action::FinanceExecute');
  if (!src.split('\n').some((l) => l.includes("new Route('GET', '/api/finance-executions', ") && /\['month'\], RouteAuth::Required\),$/.test(l.trim()))) out.push('Routes.php: the Finance execution month read GET /api/finance-executions (?month=, a session, no Action) is missing');
  for (const m of src.matchAll(/new Route\('([A-Z]+)', '([^']+)'([^\n]*)/g)) {
    if (/\bAction::FinanceExecute\b/.test(m[3]) && !(m[1] === 'POST' && m[2] === FINANCE_EXECUTION_ROUTE)) out.push('Routes.php: ' + m[1] + ' ' + m[2] + ' is not the Finance execution and must not declare Action::FinanceExecute');
  }
  for (const m of src.matchAll(/new Route\('([A-Z]+)', '([^']+)'([^\n]*)/g)) {
    if (!/^\/api\/finance/.test(m[2])) continue;
    const key = m[1] + ' ' + m[2];
    // BF-4f authorized revision: the one execution command and its month read join the Finance
    // routes. Was: the two postings and the posting month read only.
    if (key !== FINANCE_READ_ROUTE && key !== FINANCE_EXECUTION_READ_ROUTE && !(m[1] === 'POST' && (FINANCE_ROUTES[m[2]] || m[2] === FINANCE_EXECUTION_ROUTE))) out.push('Routes.php: ' + key + ' — the only Finance routes are the two postings, the execution and their two month reads (no batch, payment, actual, reversal, correction or reconciliation route)');
    if ((key === FINANCE_READ_ROUTE || key === FINANCE_EXECUTION_READ_ROUTE) && /\bAction::/.test(m[3])) out.push('Routes.php: ' + key + ' is a read and declares no Action');
  }
  return out;
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
  const append = /->\s*audit\s*\(\s*\)\s*->\s*append(Account|Overtime|Payroll|Supplemental|Posting|Execution)?\s*\(/g;
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
  for (const v of checkBackupReader(file, lex)) out.push(v);
  for (const v of checkAuditInTransaction(lex)) out.push(v);
  for (const v of checkOvertimeDelete(lex)) out.push(v);
  for (const v of checkOvertimeApproval(file, lex)) out.push(v);
  if (file === OVERTIME_VALUATION) for (const v of checkIntegerValuation(lex)) out.push(v);
  if (file.startsWith(OVERTIME_DIR) || file === OVERTIME_STORE || file === OVERTIME_CONTROLLER) for (const v of checkOvertimeFirewall(lex)) out.push(v);
  for (const v of checkPayrollStatements(file, lex)) out.push(v);
  if (file === PAYROLL_CALCULATION) for (const v of checkIntegerPayroll(lex)) out.push(v);
  if (file.startsWith(PAYROLL_DIR) || file === PAYROLL_STORE || file === PAYROLL_CONTROLLER) for (const v of checkPayrollFirewall(lex)) out.push(v);
  if (file === PAYROLL_INPUT) for (const v of checkPayrollInput(lex)) out.push(v);
  for (const v of checkSupplementalStatements(file, lex)) out.push(v);
  if (file.startsWith(SUPPLEMENTAL_DIR) || file === SUPPLEMENTAL_STORE || file === SUPPLEMENTAL_CONTROLLER) for (const v of checkSupplementalFirewall(lex)) out.push(v);
  if (file.startsWith(SUPPLEMENTAL_DIR)) for (const v of checkIntegerSupplemental(lex)) out.push(v);
  if (file === SUPPLEMENTAL_INPUT) for (const v of checkSupplementalInput(lex)) out.push(v);
  for (const v of checkFinanceStatements(file, lex)) out.push(v);
  // BF-4f authorized revision: the BF-4e posting firewall governs every Finance domain file but the
  // FinanceExecution* files, which have the execution firewall below. Was: every file of
  // server/src/Finance/ (the posting store and controller unchanged).
  const executionFile = file.startsWith(FINANCE_EXECUTION_PREFIX) || file === FINANCE_EXECUTION_STORE || file === FINANCE_EXECUTION_CONTROLLER;
  if ((file.startsWith(FINANCE_DIR) && !file.startsWith(FINANCE_EXECUTION_PREFIX)) || file === FINANCE_STORE || file === FINANCE_CONTROLLER) for (const v of checkFinanceFirewall(lex)) out.push(v);
  if (file === FINANCE_INPUT) for (const v of checkFinanceInput(lex)) out.push(v);
  for (const v of checkFinanceExecutionStatements(file, lex)) out.push(v);
  if (executionFile) for (const v of checkFinanceExecutionFirewall(lex)) out.push(v);
  if (file === FINANCE_EXECUTION_INPUT) for (const v of checkFinanceExecutionInput(lex)) out.push(v);
  return out;
}

// BF-4c1: every statement that writes a payroll plan is a pre-commit compare-and-swap: an UPDATE
// names the company, the expected version and a pre-commit status (status = 'Draft', or status IN
// ('Draft', 'Reviewed', 'Ready')) and no OR; the INSERT writes a 'Draft'. BF-4c2 authorized
// revision: exactly one statement, COMMIT_STATEMENT (Ready → Committed at the expected version),
// writes 'Committed', committed_at or the commit idempotency key — every other write naming any of
// them is a violation. Was: no statement wrote 'Committed' or committed_at. Every Employee
// (:self_employee_id) payroll read is a plain SELECT of Committed plans only (D-PAY-5 = A). The only link DELETE names the company and its plan
// (:id) and requires that plan to be pre-commit, so a Committed plan's links are frozen. Any payroll
// statement reading overtime_records reads Approved records only, and never a valuation column.
const PRE_COMMIT_STATUS = /\bstatus = 'Draft'|\bstatus IN \('Draft', 'Reviewed', 'Ready'\)/;
function checkPayrollStatements(file, lex) {
  const out = [];
  let commits = 0;
  for (const s of lex.strings) {
    if (file === PAYROLL_STORE && s === COMMIT_STATEMENT) {
      commits++;
      continue;
    }
    const writesPlan = /^\s*(INSERT\s+(IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE)\s+`?payroll_plans\b/i.test(s);
    if (writesPlan && /'Committed'|\bcommitted_at\s*=|\bcommit_idempotency_key\b/.test(s)) out.push("only the one COMMIT_SQL statement writes 'Committed', committed_at or the commit idempotency key (Ready → Committed at the expected version, in company scope)");
    if (file === PAYROLL_STORE && /:self_employee_id\b/.test(s) && (!/^SELECT\b/.test(s) || !/\b(p\.)?status = 'Committed'/.test(s) || /\bFOR\s+UPDATE\b|\bOR\b/i.test(s))) {
      out.push("an Employee payroll read is a plain SELECT of their own Committed plans only (status = 'Committed', no lock, no OR)");
    }
    if (/^\s*UPDATE\s+`?payroll_plans\b/i.test(s)) {
      const where = s.split(/\bWHERE\b/i)[1] || '';
      if (!/\bcompany_id = :company_id\b/.test(where) || !/\bversion = :expected_version\b/.test(where) || !PRE_COMMIT_STATUS.test(where) || /\bOR\b/i.test(where)) {
        out.push("a payroll plan UPDATE is a pre-commit compare-and-swap: its WHERE names company_id = :company_id, version = :expected_version and a pre-commit status (and no OR), so a Committed or Cancelled plan never changes");
      }
    }
    if (/^\s*(INSERT\s+(IGNORE\s+)?INTO|REPLACE\s+INTO)\s+`?payroll_plans\b/i.test(s) && !/, 'Draft', /.test(s)) out.push("a payroll plan is inserted only as a 'Draft'");
    if (/^\s*DELETE\s+FROM\s+`?payroll_plan_overtime\b/i.test(s)) {
      const where = s.split(/\bWHERE\b/i).slice(1).join(' WHERE ');
      if (!/\bcompany_id = :company_id\b/.test(where) || !/\bpayroll_plan_id = :id\b/.test(where) || !/\bp\.status IN \('Draft', 'Reviewed', 'Ready'\)/.test(where) || /\bOR\b/i.test(where)) {
        out.push("a payroll link DELETE releases only the links of one pre-commit plan: company_id = :company_id, payroll_plan_id = :id and p.status IN ('Draft', 'Reviewed', 'Ready') (and no OR)");
      }
    }
    if (file === PAYROLL_STORE && /\bovertime_records\b/.test(s) && (!/status = 'Approved'/.test(s) || /\bvaluation_|monthly_base_salary\s*,\s*archived_at\s+FROM\s+overtime/.test(s))) {
      out.push("payroll reads only Approved overtime and only its frozen approved_amount (never a valuation column)");
    }
    // No deadlock: payroll locks one row by primary key, never a secondary-index range (which cycles
    // with an overtime create's foreign-key check or a cancel's live-key update), and never overtime.
    if (file === PAYROLL_STORE && /\b(FOR\s+UPDATE|LOCK\s+IN\s+SHARE\s+MODE|FOR\s+SHARE)\b/i.test(s)
      && (!/^SELECT [^;]* FROM (employees|payroll_plans) WHERE id = :\w+ AND company_id = :company_id FOR UPDATE$/.test(s) || /\bJOIN\b|\bOR\b|overtime_records/i.test(s))) {
      out.push('payroll locks rows only by primary key (WHERE id = :x AND company_id = :company_id FOR UPDATE on employees or payroll_plans) — never a range, a join or an overtime record');
    }
  }
  if (file === PAYROLL_STORE && commits !== 1) out.push('PayrollStore has exactly one Commit statement (COMMIT_SQL, Ready → Committed at the expected version); found ' + commits);
  return out;
}

// BF-4c1: the payroll calculation is integer arithmetic only, as the BF-4b2 valuation.
function checkIntegerPayroll(lex) {
  return FLOAT_AUTHORITY.test(lex.code) ? ['the payroll calculation is integer arithmetic only (no float, BCMath, GMP, rounding helper or division operator: intdiv())'] : [];
}

// BF-4c1: the Payroll code (domain, store, controller) never values overtime (no OvertimeValuation,
// OvertimeService, OvertimeStore, TAM-OT-1 or valuation identifier), has no finance or payment
// side effect, and no statutory payroll vocabulary (D-PAY-3 = A: Base Salary + Approved Overtime
// only — no tax, BPJS, THR, allowance, deduction, bonus, benefit or loan).
const PAYROLL_OVERTIME_AUTHORITY = /\bOvertimeValuation\b|\bOvertimeService\b|\bOvertimeStore\b|TAM-OT-1|valuation|STANDARD_MONTHLY_HOURS/i;
const PAYROLL_FINANCE_SIDE_EFFECT = /payment|ledger|journal|finance|transaction_|disburse|\bpaid\b|\bbank|\bcash|\btxn/i;
const PAYROLL_STATUTORY = /\bpph|bpjs|\bthr\b|\btax|allowance|deduction|bonus|benefit|\bloan|statutory|tunjangan|potongan/i;
function checkPayrollFirewall(lex) {
  const out = [];
  const code = lex.code.replace(/->\s*atomically\s*\(/g, '');
  const any = (re) => re.test(code) || lex.strings.some((s) => re.test(s));
  if (any(PAYROLL_OVERTIME_AUTHORITY)) out.push('Payroll never values overtime: it consumes the frozen approved_amount (no OvertimeValuation, OvertimeService, OvertimeStore, TAM-OT-1 or valuation identifier)');
  if (any(PAYROLL_FINANCE_SIDE_EFFECT)) out.push('the Payroll code has no finance side effect (no payment, ledger, journal, finance, bank, cash or paid identifier or statement)');
  if (any(PAYROLL_STATUTORY)) out.push('the Payroll code has no statutory payroll (no tax, PPh, BPJS, THR, allowance, deduction, bonus, benefit or loan identifier)');
  return out;
}

// BF-4c1: the payroll inputs take exactly { month } (generate) and { id, expectedVersion } (the
// transitions) — no employee, company, role, salary, amount, total or status key, and no new
// identity exception (D-AFI4b1-3 stays the one overtime create selector). BF-4c2 authorized
// revision: commit takes exactly { id, expectedVersion, expectedTotal, idempotencyKey }. Was: two
// allowlists.
function checkPayrollInput(lex) {
  // The allowlists, recovered from the lexed code and the string spans inside each call.
  const lists = [...lex.code.matchAll(/self::onlyKeys\(\$json, \[[^\]]*\]\)/g)]
    .map((m) => lex.spans.filter((sp) => sp.start >= m.index && sp.end <= m.index + m[0].length).map((sp) => sp.value).join(','));
  const out = [];
  if (lists.length !== 3 || lists[0] !== 'month' || lists[1] !== 'id,expectedVersion' || lists[2] !== 'id,expectedVersion,expectedTotal,idempotencyKey') out.push('the payroll inputs allow exactly { month }, { id, expectedVersion } and (commit) { id, expectedVersion, expectedTotal, idempotencyKey }');
  if (lex.strings.some((s) => /^(employeeId|companyId|role|salary|baseSalary|amount|totalAmount|total|status|overtimeAmount)$/.test(s))) out.push('a payroll input never names an identity, money or status key');
  return out;
}

// BF-4d: every statement that writes a Supplemental document is an open-status compare-and-swap: an
// UPDATE names the company, the expected version and an open status (status = 'Draft', or status IN
// ('Draft', 'Reviewed', 'Ready')) and no OR; the INSERT writes a 'Draft'. Exactly one statement,
// SUPPLEMENTAL_COMMIT_STATEMENT (Ready → Committed at the expected version), writes 'Committed',
// committed_at or the commit idempotency key. Every Employee (:self_employee_id) read is a plain
// SELECT of Committed documents only. The only link DELETE names the company and its document (:id)
// and requires that document to be open, so a Committed document's links are frozen. Overtime is read
// Approved only and never by a valuation column or a salary; rows are locked only by primary key; SQL
// never adds or sums money (the exact sum is PayrollCalculation::overtime, in PHP).
const OPEN_STATUS = /\bstatus = 'Draft'|\bstatus IN \('Draft', 'Reviewed', 'Ready'\)/;
const SQL_MONEY_ARITHMETIC = /\b(SUM|AVG)\s*\(|\b(approved_amount|overtime_amount|total_amount|base_salary)\s*[-+*\/]|[-+*\/]\s*(\w+\.)?(approved_amount|overtime_amount|total_amount|base_salary)\b/i;
function checkSupplementalStatements(file, lex) {
  const out = [];
  let commits = 0;
  for (const s of lex.strings) {
    if (file === SUPPLEMENTAL_STORE && s === SUPPLEMENTAL_COMMIT_STATEMENT) {
      commits++;
      continue;
    }
    const writesDoc = /^\s*(INSERT\s+(IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE)\s+`?supplemental_payrolls\b/i.test(s);
    if (writesDoc && /'Committed'|\bcommitted_at\s*=|\bcommit_idempotency_key\s*=/.test(s)) out.push("only the one Supplemental COMMIT_SQL statement writes 'Committed', committed_at or the commit idempotency key (Ready → Committed at the expected version, in company scope)");
    if (file === SUPPLEMENTAL_STORE && /:self_employee_id\b/.test(s) && (!/^SELECT\b/.test(s) || !/\b(s\.)?status = 'Committed'/.test(s) || /\bFOR\s+UPDATE\b|\bOR\b/i.test(s))) {
      out.push("an Employee Supplemental read is a plain SELECT of their own Committed documents only (status = 'Committed', no lock, no OR)");
    }
    if (/^\s*UPDATE\s+`?supplemental_payrolls\b/i.test(s)) {
      const where = s.split(/\bWHERE\b/i)[1] || '';
      if (!/\bcompany_id = :company_id\b/.test(where) || !/\bversion = :expected_version\b/.test(where) || !OPEN_STATUS.test(where) || /\bOR\b/i.test(where)) {
        out.push('a Supplemental document UPDATE is an open-status compare-and-swap: its WHERE names company_id = :company_id, version = :expected_version and an open status (and no OR), so a Committed or Cancelled document never changes');
      }
    }
    if (/^\s*(INSERT\s+(IGNORE\s+)?INTO|REPLACE\s+INTO)\s+`?supplemental_payrolls\b/i.test(s) && !/, 'Draft', /.test(s)) out.push("a Supplemental document is inserted only as a 'Draft'");
    if (/^\s*DELETE\s+FROM\s+`?supplemental_payroll_overtime\b/i.test(s)) {
      const where = s.split(/\bWHERE\b/i).slice(1).join(' WHERE ');
      if (!/\bcompany_id = :company_id\b/.test(where) || !/\bsupplemental_payroll_id = :id\b/.test(where) || !/\bs\.status IN \('Draft', 'Reviewed', 'Ready'\)/.test(where) || /\bOR\b/i.test(where)) {
        out.push("a Supplemental link DELETE releases only the links of one open document: company_id = :company_id, supplemental_payroll_id = :id and s.status IN ('Draft', 'Reviewed', 'Ready') (and no OR)");
      }
    }
    if (file === SUPPLEMENTAL_STORE && /\bovertime_records\b/.test(s) && (!/status = 'Approved'/.test(s) || /\bvaluation_|\bmonthly_base_salary\b/.test(s))) {
      out.push('Supplemental reads only Approved overtime and only its frozen approved_amount (never a valuation column or a salary)');
    }
    if (file === SUPPLEMENTAL_STORE && /\b(FOR\s+UPDATE|LOCK\s+IN\s+SHARE\s+MODE|FOR\s+SHARE)\b/i.test(s)
      && (!/^SELECT [^;]* FROM (employees|payroll_plans|supplemental_payrolls) WHERE id = :\w+ AND company_id = :company_id FOR UPDATE$/.test(s) || /\bJOIN\b|\bOR\b|overtime_records/i.test(s))) {
      out.push('Supplemental locks rows only by primary key (WHERE id = :x AND company_id = :company_id FOR UPDATE on employees, payroll_plans or supplemental_payrolls) — never a range, a join or an overtime record');
    }
    if (file === SUPPLEMENTAL_STORE && SQL_MONEY_ARITHMETIC.test(s)) out.push('Supplemental never adds or sums money in SQL (the exact sum is PayrollCalculation::overtime, in PHP)');
  }
  if (file === SUPPLEMENTAL_STORE && commits !== 1) out.push('SupplementalStore has exactly one Commit statement (COMMIT_SQL, Ready → Committed at the expected version); found ' + commits);
  return out;
}

// BF-4d: the Supplemental domain is integer and string arithmetic only, as the payroll calculation it reuses.
function checkIntegerSupplemental(lex) {
  return FLOAT_AUTHORITY.test(lex.code) ? ['the Supplemental code is integer arithmetic only (no float, BCMath, GMP, rounding helper or division operator)'] : [];
}

// BF-4d: the Supplemental code (domain, store, controller) never values overtime and never calls the
// base Payroll, Overtime or Employee store (it reads them through its own SELECTs only); it has no
// finance, payment, posting, execution, bank or statutory vocabulary — no LOCAL postSupplemental port.
const SUPPLEMENTAL_STORE_CALLS = /->\s*(payroll|overtime|employees)\s*\(\s*\)/;
const SUPPLEMENTAL_FINANCE = /\bexecuted\b|\bposted\b|postSupplemental|companyAccount|company_account|\bpaid_at\b/i;
const SUPPLEMENTAL_COMPONENT = /reimburs|commission/i;
function checkSupplementalFirewall(lex) {
  const out = [];
  const code = lex.code.replace(/->\s*atomically\s*\(/g, '');
  const any = (re) => re.test(code) || lex.strings.some((s) => re.test(s));
  if (any(PAYROLL_OVERTIME_AUTHORITY)) out.push('Supplemental never values overtime: it consumes the frozen approved_amount (no OvertimeValuation, OvertimeService, OvertimeStore, TAM-OT-1 or valuation identifier)');
  if (SUPPLEMENTAL_STORE_CALLS.test(code)) out.push('Supplemental never calls the base Payroll, Overtime or Employee store — it reads them through its own statements and never writes them');
  if (any(PAYROLL_FINANCE_SIDE_EFFECT) || any(SUPPLEMENTAL_FINANCE)) out.push('the Supplemental code has no finance side effect (no payment, ledger, journal, finance, bank, cash, paid, posted or executed identifier or statement)');
  if (any(PAYROLL_STATUTORY) || any(SUPPLEMENTAL_COMPONENT)) out.push('the Supplemental code has no statutory or component payroll (no tax, PPh, BPJS, THR, allowance, deduction, bonus, benefit, loan, reimbursement or commission identifier)');
  return out;
}

// BF-4d: the Supplemental inputs take exactly { payrollPlanId } (generate), { id, expectedVersion }
// (the transitions) and { id, expectedVersion, expectedTotal, idempotencyKey } (commit) — no
// employee, company, role, amount, overtime, month or status key.
function checkSupplementalInput(lex) {
  const lists = [...lex.code.matchAll(/self::onlyKeys\(\$json, \[[^\]]*\]\)/g)]
    .map((m) => lex.spans.filter((sp) => sp.start >= m.index && sp.end <= m.index + m[0].length).map((sp) => sp.value).join(','));
  const out = [];
  if (lists.length !== 3 || lists[0] !== 'payrollPlanId' || lists[1] !== 'id,expectedVersion' || lists[2] !== 'id,expectedVersion,expectedTotal,idempotencyKey') out.push('the Supplemental inputs allow exactly { payrollPlanId }, { id, expectedVersion } and (commit) { id, expectedVersion, expectedTotal, idempotencyKey }');
  if (lex.strings.some((s) => /^(employeeId|companyId|role|amount|overtimeAmount|overtimeIds|overtimeHours|total|totalAmount|status|month|monthKey)$/.test(s))) out.push('a Supplemental input never names an identity, money, overtime or status key');
  return out;
}

// BF-4e: the Finance store holds exactly two statements writing finance_postings — one INSERT per
// source kind, each of a 'Planned' posting with its key, never IGNORE or ON DUPLICATE KEY UPDATE —
// locks only one employee, base plan or Supplemental document row by primary key, names no Employee
// scope (CEO only, D-FIN-4 = A) and never computes money in SQL (the amount is the source's string).
const FINANCE_INSERT = /^\s*INSERT\s+(IGNORE\s+)?INTO\s+`?finance_postings\b/i;
function checkFinanceStatements(file, lex) {
  if (file !== FINANCE_STORE) return [];
  const out = [];
  let inserts = 0;
  for (const s of lex.strings) {
    if (FINANCE_INSERT.test(s)) {
      inserts++;
      if (/\bIGNORE\b|\bON\s+DUPLICATE\s+KEY\b/i.test(s) || !/, 'Planned', :idempotency_key, UTC_TIMESTAMP\(6\)\)$/.test(s)) out.push("a Finance posting is inserted only as 'Planned' with its idempotency key — never IGNORE or ON DUPLICATE KEY UPDATE");
    }
    if (/:self_employee_id\b/.test(s)) out.push('the Finance posting statements are CEO company scope only (no :self_employee_id)');
    if (/\b(FOR\s+UPDATE|LOCK\s+IN\s+SHARE\s+MODE|FOR\s+SHARE)\b/i.test(s)
      && (!/^SELECT [^;]* FROM (employees|payroll_plans|supplemental_payrolls) WHERE id = :\w+ AND company_id = :company_id FOR UPDATE$/.test(s) || /\bJOIN\b|\bOR\b/i.test(s))) {
      out.push('Finance locks rows only by primary key (WHERE id = :x AND company_id = :company_id FOR UPDATE on employees, payroll_plans or supplemental_payrolls) — never a range, a join or a posting');
    }
    if (SQL_MONEY_ARITHMETIC.test(s) || /\bamount\s*[-+*\/]|[-+*\/]\s*:?amount\b/i.test(s)) out.push("Finance never computes money in SQL: the posted amount is the source's stored string");
  }
  if (inserts !== 2) out.push('FinancePostingStore has exactly two INSERT statements (one per source kind); found ' + inserts);
  return out;
}

// BF-4e: the Finance code (domain, store, controller) never calls the Payroll, Supplemental, Overtime
// or Employee store (it reads and locks its source through its own statements and never writes it),
// posts Planned only (no execution, payment, actual, disbursement, company account, bank, cash,
// category, monthly plan, reversal, refund or correction identifier or statement — D-FIN-1/5 = A),
// never values overtime or names a statutory component, and never computes money (no float, BCMath,
// GMP, rounding helper or division operator).
const FINANCE_STORE_CALLS = /->\s*(payroll|supplemental|overtime|employees)\s*\(\s*\)/;
const FINANCE_BEYOND_PLANNED = /(?<!->)\bexecut|payment|\bpaid\b|\bpay\b|\bactual|disburse|company_?account|companyAccount|\bbank|\bcash|\bcategor|monthly_?plan|monthlyPlan|\brevers|\brefund|\bcorrect|\bunpost|ledger|journal|\btxn|transaction_/i;
function checkFinanceFirewall(lex) {
  const out = [];
  const code = lex.code.replace(/->\s*atomically\s*\(/g, '');
  const any = (re) => re.test(code) || lex.strings.some((s) => re.test(s));
  if (FINANCE_STORE_CALLS.test(code)) out.push('Finance never calls the Payroll, Supplemental, Overtime or Employee store — it reads and locks its source through its own statements and never writes it');
  if (any(FINANCE_BEYOND_PLANNED)) out.push('BF-4e posts Planned only: no execution, payment, actual, account, category, monthly-plan, reversal or correction identifier or statement');
  if (any(PAYROLL_OVERTIME_AUTHORITY) || any(PAYROLL_STATUTORY)) out.push('Finance never values overtime and has no statutory or component payroll');
  if (FLOAT_AUTHORITY.test(lex.code)) out.push('the Finance code never computes money (no float, BCMath, GMP, rounding helper or division operator)');
  return out;
}

// BF-4e: the posting inputs take exactly { payrollPlanId, expectedAmount, idempotencyKey } and
// { supplementalPayrollId, expectedAmount, idempotencyKey } — no employee, company, role, amount,
// month, status, source kind, account or category key.
function checkFinanceInput(lex) {
  const lists = [...lex.code.matchAll(/self::onlyKeys\(\$json, \[[^\]]*\]\)/g)]
    .map((m) => lex.spans.filter((sp) => sp.start >= m.index && sp.end <= m.index + m[0].length).map((sp) => sp.value).join(','));
  const out = [];
  if (lists.length !== 2 || lists[0] !== 'payrollPlanId,expectedAmount,idempotencyKey' || lists[1] !== 'supplementalPayrollId,expectedAmount,idempotencyKey') out.push('the Finance posting inputs allow exactly { payrollPlanId, expectedAmount, idempotencyKey } and { supplementalPayrollId, expectedAmount, idempotencyKey }');
  if (lex.strings.some((s) => /^(employeeId|companyId|role|amount|totalAmount|overtimeAmount|status|month|monthKey|sourceKind|companyAccountId|accountId|category)$/.test(s))) out.push('a Finance posting input never names an identity, money, month, status, account or category key');
  return out;
}

// BF-4f: the execution store holds exactly one statement writing finance_executions — its INSERT of
// one execution with the date, the payment method and the key, never IGNORE or ON DUPLICATE KEY
// UPDATE — and exactly one lock, the posting row by primary key (never a range, a join, an employee
// or a source); it names no Employee scope (CEO only) and never computes money in SQL (the amount is
// the posting's stored string).
const FINANCE_EXECUTION_INSERT = /^\s*INSERT\s+(IGNORE\s+)?INTO\s+`?finance_executions\b/i;
const FINANCE_EXECUTION_LOCK = 'SELECT id, company_id, employee_id AS owner_employee_id, employee_id, month_key, amount, status FROM finance_postings WHERE id = :id AND company_id = :company_id FOR UPDATE';
function checkFinanceExecutionStatements(file, lex) {
  if (file !== FINANCE_EXECUTION_STORE) return [];
  const out = [];
  let inserts = 0;
  let locks = 0;
  for (const s of lex.strings) {
    if (FINANCE_EXECUTION_INSERT.test(s)) {
      inserts++;
      if (/\bIGNORE\b|\bON\s+DUPLICATE\s+KEY\b/i.test(s) || !/, :amount, :executed_on, :payment_method, :idempotency_key, UTC_TIMESTAMP\(6\)\)$/.test(s)) out.push('a Finance execution is inserted only once, with its date, payment method and idempotency key — never IGNORE or ON DUPLICATE KEY UPDATE');
    }
    if (/:self_employee_id\b/.test(s)) out.push('the Finance execution statements are CEO company scope only (no :self_employee_id)');
    if (/\b(FOR\s+UPDATE|LOCK\s+IN\s+SHARE\s+MODE|FOR\s+SHARE)\b/i.test(s)) {
      locks++;
      if (s !== FINANCE_EXECUTION_LOCK) out.push('an execution locks exactly its posting, by primary key (' + FINANCE_EXECUTION_LOCK + ') — never a range, a join, an employee or a source');
    }
    if (SQL_MONEY_ARITHMETIC.test(s) || /\bamount\s*[-+*\/]|[-+*\/]\s*:?amount\b/i.test(s)) out.push("Finance never computes money in SQL: the executed amount is the posting's stored string");
  }
  if (inserts !== 1) out.push('FinanceExecutionStore has exactly one INSERT statement; found ' + inserts);
  if (locks !== 1) out.push('FinanceExecutionStore takes exactly one lock, its posting; found ' + locks);
  return out;
}

// BF-4f: the execution code (domain, store, controller) never calls the posting, Payroll,
// Supplemental, Overtime or Employee store (it locks its posting through its own statement and never
// writes it), records one full execution only (no reversal, correction, refund, partial, settlement,
// reconciliation, company or bank account, reference, note, category, batch or schedule identifier
// or statement — D-FEX-1/2/5 = A), never values overtime or names a statutory component, and never
// computes money (no float, BCMath, GMP, rounding helper or division operator).
const FINANCE_EXECUTION_STORE_CALLS = /->\s*(finance|payroll|supplemental|overtime|employees)\s*\(\s*\)/;
const FINANCE_EXECUTION_BEYOND = /\brevers|\brefund|\bcorrect|\bunexecut|partial|\bsettle|reconcil|disburse|company_?account|companyAccount|bank_?account|bankAccount|account_?id\b|accountId|\bcategor|ledger|journal|monthly_?plan|monthlyPlan|\bbatch|\bschedul|\breference|\bnotes?\b|\bmemo\b|\btxn|transaction_|\bwithdraw/i;
function checkFinanceExecutionFirewall(lex) {
  const out = [];
  const code = lex.code.replace(/->\s*atomically\s*\(/g, '');
  const any = (re) => re.test(code) || lex.strings.some((s) => re.test(s));
  if (FINANCE_EXECUTION_STORE_CALLS.test(code)) out.push('the Finance execution never calls the posting, Payroll, Supplemental, Overtime or Employee store — it locks its posting through its own statement and never writes it');
  if (any(FINANCE_EXECUTION_BEYOND)) out.push('BF-4f records one full execution only: no reversal, correction, refund, partial, settlement, reconciliation, company or bank account, reference, note, category, batch or schedule identifier or statement');
  if (any(PAYROLL_OVERTIME_AUTHORITY) || any(PAYROLL_STATUTORY)) out.push('the Finance execution never values overtime and has no statutory or component payroll');
  if (FLOAT_AUTHORITY.test(lex.code)) out.push('the Finance execution code never computes money (no float, BCMath, GMP, rounding helper or division operator)');
  return out;
}

// BF-4f: the execution input takes exactly { financePostingId, expectedAmount, executedOn,
// paymentMethod, idempotencyKey } — no employee, company, role, amount, month, status, account,
// reference or note key — and the payment method comes from exactly the closed list (D-FEX-5 = A),
// the date bound from the Asia/Jakarta company calendar (D-FEX-8 = A).
function checkFinanceExecutionInput(lex) {
  const valuesIn = (re) => [...lex.code.matchAll(re)]
    .map((m) => lex.spans.filter((sp) => sp.start >= m.index && sp.end <= m.index + m[0].length).map((sp) => sp.value).join(','));
  const lists = valuesIn(/self::onlyKeys\(\$json, \[[^\]]*\]\)/g);
  const methods = valuesIn(/const PAYMENT_METHODS = \[[^\]]*\];/g);
  const zone = valuesIn(/const COMPANY_TIMEZONE = '[^']*';/g);
  const out = [];
  if (lists.length !== 1 || lists[0] !== FINANCE_EXECUTION_KEYS) out.push('the Finance execution input allows exactly { financePostingId, expectedAmount, executedOn, paymentMethod, idempotencyKey }');
  if (lex.strings.some((s) => /^(employeeId|companyId|role|amount|actualAmount|totalAmount|status|month|monthKey|sourceKind|companyAccountId|accountId|bankAccount|reference|notes?|category)$/.test(s))) out.push('a Finance execution input never names an identity, money, month, status, account, reference or note key');
  if (methods.length !== 1 || methods[0] !== PAYMENT_METHODS) out.push('the payment methods are exactly the closed list ' + PAYMENT_METHODS + ' (D-FEX-5 = A)');
  if (zone.length !== 1 || zone[0] !== 'Asia/Jakarta') out.push('executedOn is bounded by today in the Asia/Jakarta company calendar (D-FEX-8 = A)');
  return out;
}

// BF-4b2, D-BF4b2-1 = A: exactly one statement writes the valuation snapshot or the Approved status
// — the approval compare-and-swap from 'Reviewed' at the expected version in company scope (an
// Employee never approves: no self variant, no OR). No other UPDATE or INSERT of overtime_records
// names a valuation column or 'Approved', so an Approved valuation can never be changed, and the
// overtime store never reads the owner's salary through a self-scope statement (the Employee's own
// profile read in EmployeeStore is a different, BF-4a1 projection).
const VALUATION_COLUMNS = /\b(valuation_method|valuation_salary|valuation_standard_hours|approved_amount|approved_at)\b|'Approved'/;
function checkOvertimeApproval(file, lex) {
  const out = [];
  let approvals = 0;
  for (const s of lex.strings) {
    if (file === OVERTIME_STORE && /monthly_base_salary/.test(s) && /:self_employee_id\b/.test(s)) out.push('the employee salary is never read through a self-scope statement');
    if (!/^\s*(INSERT\s+(IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE)\s+`?overtime_records\b/i.test(s) || !VALUATION_COLUMNS.test(s)) continue;
    approvals++;
    const [set, where = ''] = s.split(/\bWHERE\b/i);
    if (!/^\s*UPDATE\s+overtime_records\s+SET\s+status = 'Approved', /.test(set) || !/\bcompany_id = :company_id\b/.test(where) || !/\bversion = :expected_version\b/.test(where)
      || !/\bstatus = 'Reviewed'/.test(where) || /:self_employee_id\b/.test(s) || /\bOR\b/i.test(where) || VALUATION_COLUMNS.test(where)) {
      out.push("the overtime valuation snapshot and 'Approved' are written only by the approval: UPDATE overtime_records SET status = 'Approved', … WHERE company_id = :company_id, version = :expected_version and status = 'Reviewed' (company scope, no OR)");
    }
  }
  if (approvals > 1) out.push('exactly one statement writes the overtime valuation snapshot');
  return out;
}

// BF-4b2, D-BF4b-4 = A: no binary floating point, BCMath, GMP or rounding helper becomes monetary
// authority. On the lexed code (comments removed, strings blanked) of the valuation: no float
// cast or literal, no float or decimal-library function, no `/` or `**` operator — intdiv() only.
const FLOAT_AUTHORITY = /\((float|double|real)\)|\b(floatval|doubleval|round|floor|ceil|fdiv|fmod|number_format|pow|sqrt|bc[a-z]+|gmp_[a-z_]+)\s*\(|\*\*|\/|\b\d+\.\d+|\b\d+[eE][+-]?\d+|\bINF\b|\bNAN\b|\bPHP_FLOAT_/;
function checkIntegerValuation(lex) {
  return FLOAT_AUTHORITY.test(lex.code) ? ['the overtime valuation is integer arithmetic only (no float, BCMath, GMP, rounding helper or division operator: intdiv())'] : [];
}

// BF-4b2: the Overtime code (domain, store, controller) names no payroll, payment or finance
// identifier or statement: an Approved valuation is an upstream result, never a side effect.
const PAYROLL_FINANCE = /payroll|payslip|payment|ledger|journal|finance|transaction_|disburse|\bpaid\b|Committed to Payroll/i;
function checkOvertimeFirewall(lex) {
  const code = lex.code.replace(/->\s*atomically\s*\(/g, '');
  return PAYROLL_FINANCE.test(code) || lex.strings.some((s) => PAYROLL_FINANCE.test(s)) ? ['the Overtime code has no payroll or finance side effect (no payroll, payment, ledger, journal or finance identifier or statement)'] : [];
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
// OPS-1 authorized revision: server/src/Data/Backup/ is not a business store — it holds only the
// read-only, cross-company BackupReader, governed by checkBackupReader below. Was: every domain
// folder but Auth, Migration and Scope.
const SCOPED_STORE = /^server\/src\/Data\/(?!Auth\/|Migration\/|Scope\/|Backup\/)[A-Z][A-Za-z0-9]*\/[A-Za-z0-9]+\.php$/;
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
  } else if (file !== BACKUP_READER && sql.some(companyTableSql)) {
    out.push('the company tables (' + [...COMPANY_TABLES].join(', ') + ') are read and written only by business stores under ScopedDatabase');
  }
  return out;
}

// OPS-1: the backup reader is the data layer's one cross-company reader, so it is read-only by
// shape: every statement is a SELECT (no write, no locking read, no INTO OUTFILE / DUMPFILE), its only
// advisory lock is tamos_backup (the migration lock is taken through MigrationHistory), and
// server/src/Data/Backup/ holds nothing else.
function checkBackupReader(file, lex) {
  if (!file.startsWith(BACKUP_DATA_DIR)) return [];
  if (file !== BACKUP_READER) return [BACKUP_DATA_DIR + ' holds only BackupReader.php'];
  const out = [];
  const sql = lex.strings.filter((s) => SQL_STRING.test(s) || /^\s*SELECT\b/i.test(s) || (SQL_VERB.test(s) && SQL_KEYWORD.test(s.replace(SQL_VERB, ''))));
  for (const s of sql) {
    if (!/^SELECT\b/.test(s) || /\b(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE|LOCK|OUTFILE|DUMPFILE|SHARE)\b/i.test(s.slice(6))) {
      out.push('the backup reader holds SELECT statements only (no write, locking read or file output): "' + s.slice(0, 40) + '"');
    }
    for (const m of s.matchAll(/\b(GET_LOCK|RELEASE_LOCK|IS_FREE_LOCK)\s*\(\s*'([^']*)'/gi)) {
      if (m[2] !== 'tamos_backup') out.push('the backup reader takes only the tamos_backup advisory lock (the migration lock through MigrationHistory)');
    }
  }
  return out;
}

// OPS-1 (D-AB-7 = B): every table a migration creates is classified for backup exactly once —
// BackupTables::INCLUDED or EXCLUDED — so a new table can never be silently left out of the backups;
// the excluded and append-only lists are pinned; the backed-up order is foreign-key safe (a table
// references only tables before it, so a restore loads front to back); and BackupReader's fixed
// per-table statements cover exactly that list, in order, in exactly one shape each.
function phpStringList(src, decl) {
  const m = new RegExp(decl + ' = \\[([\\s\\S]*?)\\];').exec(src);
  return m ? [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]) : null;
}
function checkBackupTables(tablesSrc, readerSrc, migrationSrcs) {
  const included = phpStringList(tablesSrc, 'public const INCLUDED');
  const excluded = phpStringList(tablesSrc, 'public const EXCLUDED');
  const appendOnly = phpStringList(tablesSrc, 'public const APPEND_ONLY');
  if (!included || !excluded || !appendOnly) return [BACKUP_TABLES_FILE + ': INCLUDED, EXCLUDED and APPEND_ONLY are not parseable'];
  const out = [];
  const created = new Set();
  const references = [];
  for (const src of migrationSrcs) {
    const owner = /^\s*(?:CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?|ALTER\s+TABLE\s+)`?(\w+)`?/i.exec(src);
    for (const m of src.matchAll(/^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/gim)) created.add(m[1].toLowerCase());
    if (owner) for (const m of src.matchAll(/\bREFERENCES\s+`?(\w+)`?/gi)) references.push([owner[1].toLowerCase(), m[1].toLowerCase()]);
  }
  for (const t of created) {
    if (t !== 'schema_migrations' && included.includes(t) === excluded.includes(t)) out.push('table ' + t + ' must be classified for backup exactly once, in BackupTables::INCLUDED or EXCLUDED (OPS-1)');
  }
  for (const t of [...included, ...excluded]) if (!created.has(t)) out.push('BackupTables names ' + t + ', which no migration creates');
  if (new Set(included).size !== included.length) out.push('BackupTables::INCLUDED names a table twice');
  if (excluded.slice().sort().join() !== BACKUP_EXCLUDED) out.push('BackupTables::EXCLUDED is exactly ' + BACKUP_EXCLUDED + ' (D-AB-7 = B)');
  if (appendOnly.join() !== BACKUP_APPEND_ONLY) out.push('BackupTables::APPEND_ONLY is exactly ' + BACKUP_APPEND_ONLY + ' — the tables the boundary keeps append-only');
  for (const [from, to] of references) {
    if (from !== to && included.includes(from) && included.indexOf(to) > included.indexOf(from)) out.push('BackupTables::INCLUDED is not foreign-key safe: ' + from + ' references ' + to + ', which comes after it');
    if (included.includes(from) && excluded.includes(to)) out.push('a backed-up table (' + from + ') references an excluded one (' + to + ')');
  }
  for (const [decl, shape] of [['PAGE_SQL', (t) => 'SELECT * FROM ' + t + ' WHERE id > :after ORDER BY id LIMIT 500'], ['COUNT_SQL', (t) => 'SELECT COUNT(*) AS n FROM ' + t]]) {
    const m = new RegExp('private const ' + decl + ' = \\[([\\s\\S]*?)\\];').exec(readerSrc);
    const entries = m ? [...m[1].matchAll(/^\s*'([a-z0-9_]+)' => '([^']*)',?\s*$/gm)] : [];
    if (entries.map((e) => e[1]).join() !== included.join()) out.push('BackupReader::' + decl + ' covers exactly BackupTables::INCLUDED, in order');
    for (const [, t, sql] of entries) if (sql !== shape(t)) out.push('BackupReader::' + decl + "['" + t + "'] must be exactly: " + shape(t));
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
    if (f.startsWith('server/bin/') && !CLI_FILES.has(f)) out.push(f + ': server/bin/ holds only migrate.php, account.php, mail.php and backup.php');
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
  // OPS-1: the backup table classification against every migration.
  const tablesPath = path.join(root, BACKUP_TABLES_FILE);
  const readerPath = path.join(root, BACKUP_READER);
  if (!fs.existsSync(tablesPath) || !fs.existsSync(readerPath)) failures.push(BACKUP_TABLES_FILE + ' / ' + BACKUP_READER + ': missing — the backup table classification cannot be checked');
  else for (const v of checkBackupTables(fs.readFileSync(tablesPath, 'utf8'), fs.readFileSync(readerPath, 'utf8'), files.filter((x) => x.endsWith('.sql')).map((f) => fs.readFileSync(path.join(root, f), 'utf8')))) failures.push(v);
  for (const v of checkRouteActions(fs.readFileSync(path.join(root, ROUTES_FILE), 'utf8'))) failures.push(v);
  for (const v of checkKernelCsrf(fs.readFileSync(path.join(root, KERNEL_FILE), 'utf8'))) failures.push(KERNEL_FILE + ': ' + v);
  const contract = require('./package-headers.js');
  for (const v of checkParity(fs.readFileSync(path.join(root, 'server/src/Http/ApiHeaders.php'), 'utf8'), contract)) failures.push(v);
  const actionFile = path.join(root, ACTION_FILE);
  if (!fs.existsSync(actionFile)) failures.push(ACTION_FILE + ': missing — ACTION parity cannot be established');
  else for (const v of checkActionParity(fs.readFileSync(actionFile, 'utf8'), fs.readFileSync(path.join(root, FRONTEND_AUTHZ), 'utf8'))) failures.push(v);
  // BF-4c1: payroll adds no Action — the vocabulary stays exactly ACTION_COUNT.
  if (fs.existsSync(actionFile) && (fs.readFileSync(actionFile, 'utf8').match(/^\s*case \w+ = '/gm) || []).length !== ACTION_COUNT) failures.push(ACTION_FILE + ': the server ACTIONS must stay ' + ACTION_COUNT);
  const ignored = gitIgnored(onDisk);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', SERVER]).split('\n').filter(Boolean);
  for (const v of checkGitHygiene(onDisk, ignored, untracked)) failures.push(v);

  const dedup = [...new Set(failures)];
  if (dedup.length) {
    console.error('BACKEND BOUNDARY FAILED -- ' + dedup.length + ' violation(s):');
    for (const v of dedup) console.error('  - ' + v);
    process.exit(1);
  }
  console.log('BACKEND BOUNDARY PASSED -- ' + files.length + ' files (' + php + ' PHP) checked; API header mirror matches tools/package-headers.js; server ACTIONS equal ' + FRONTEND_AUTHZ + ' (21 actions, rules, entities); every migrated table is classified for backup.');
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
  // BF-4c1: the two payroll tables are registered company tables with the tenant key.
  const m24 = fs.readFileSync(path.join(root, 'server/migrations/0024_create_payroll_plans.sql'), 'utf8');
  const m25 = fs.readFileSync(path.join(root, 'server/migrations/0025_create_payroll_plan_overtime.sql'), 'utf8');
  tenant('the real payroll_plans migration passes', m24, 0);
  tenant('the real payroll_plan_overtime migration passes', m25, 0);
  tenant('payroll_plans without its tenant UNIQUE is caught', m24.replace('  UNIQUE KEY payroll_plans_company_id (company_id, id),\n', ''), 'UNIQUE KEY (company_id, id)');
  tenant('payroll_plan_overtime without its company FK is caught', m25.replace('  CONSTRAINT payroll_plan_overtime_company_fk FOREIGN KEY (company_id) REFERENCES companies (id),\n', ''), 'REFERENCES companies (id)');
  tenant('a cascading payroll link FK is caught', m25.replace('REFERENCES payroll_plans (company_id, id)', 'REFERENCES payroll_plans (company_id, id) ON DELETE CASCADE'), 'CASCADE');
  // BF-4d: the two Supplemental tables are registered company tables with the tenant key.
  const m29 = fs.readFileSync(path.join(root, 'server/migrations/0029_create_supplemental_payrolls.sql'), 'utf8');
  const m30 = fs.readFileSync(path.join(root, 'server/migrations/0030_create_supplemental_payroll_overtime.sql'), 'utf8');
  tenant('the real supplemental_payrolls migration passes', m29, 0);
  tenant('the real supplemental_payroll_overtime migration passes', m30, 0);
  tenant('supplemental_payrolls without its tenant UNIQUE is caught', m29.replace('  UNIQUE KEY supplemental_payrolls_company_id (company_id, id),\n', ''), 'UNIQUE KEY (company_id, id)');
  tenant('supplemental_payroll_overtime without its company FK is caught', m30.replace('  CONSTRAINT supplemental_payroll_overtime_company_fk FOREIGN KEY (company_id) REFERENCES companies (id),\n', ''), 'REFERENCES companies (id)');
  tenant('a cascading Supplemental base-plan FK is caught', m29.replace('REFERENCES payroll_plans (company_id, id)', 'REFERENCES payroll_plans (company_id, id) ON DELETE CASCADE'), 'CASCADE');
  tenant('a set-null Supplemental link FK is caught', m30.replace('REFERENCES supplemental_payrolls (company_id, id)', 'REFERENCES supplemental_payrolls (company_id, id) ON DELETE SET NULL'), 'CASCADE');
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
  // BF-4b2: the approval is the one writer of the snapshot; the valuation is integers only; no payroll / finance.
  dirty('a second writer of the valuation snapshot is caught', OVERTIME_STORE, realOvertime.replace('    public const ENTITY', "    public const FIX_SQL = \"UPDATE overtime_records SET approved_amount = :approved_amount WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Approved'\";\n    public const ENTITY"), 'written only by the approval');
  dirty('a generic UPDATE to Approved is caught', OVERTIME_STORE, realOvertime.replace('    public const ENTITY', "    public const GEN_SQL = \"UPDATE overtime_records SET status = 'Approved', version = version + 1 WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = :from_status\";\n    public const ENTITY"), 'written only by the approval');
  dirty('an approval from Submitted is caught', OVERTIME_STORE, realOvertime.replace("AND version = :expected_version AND status = 'Reviewed'\"", "AND version = :expected_version AND status = 'Submitted'\""), 'written only by the approval');
  dirty('an approval without its version predicate is caught', OVERTIME_STORE, realOvertime.replace("AND company_id = :company_id AND version = :expected_version AND status = 'Reviewed'\"", "AND company_id = :company_id AND status = 'Reviewed'\""), 'written only by the approval');
  dirty('an approval widened with OR is caught', OVERTIME_STORE, realOvertime.replace("AND status = 'Reviewed'\"", "AND (status = 'Reviewed' OR status = 'Submitted')\""), 'written only by the approval');
  dirty('a self-scope approval is caught', OVERTIME_STORE, realOvertime.replace("WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Reviewed'\"", "WHERE id = :id AND company_id = :company_id AND employee_id = :self_employee_id AND version = :expected_version AND status = 'Reviewed'\""), 'written only by the approval');
  dirty('a Draft update that touches the snapshot is caught', OVERTIME_STORE, realOvertime.replace("notes = :notes, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Draft'\";\n    public const UPDATE_SELF_SQL", "notes = :notes, approved_amount = NULL, version = version + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Draft'\";\n    public const UPDATE_SELF_SQL"), 'written only by the approval');
  dirty('a salary read through a self statement is caught', OVERTIME_STORE, realOvertime.replace("monthly_base_salary, archived_at FROM employees WHERE id = :employee_id AND company_id = :company_id';", "monthly_base_salary, archived_at FROM employees WHERE id = :employee_id AND company_id = :company_id AND id = :self_employee_id';"), 'never read through a self-scope statement');
  const realValuation = fs.readFileSync(path.join(root, OVERTIME_VALUATION), 'utf8');
  clean('the real OvertimeValuation is integer arithmetic only', OVERTIME_VALUATION, realValuation);
  clean('the real Overtime domain has no payroll or finance side effect', 'server/src/Overtime/OvertimeService.php', fs.readFileSync(path.join(root, 'server/src/Overtime/OvertimeService.php'), 'utf8'));
  for (const [label, from, to] of [
    ['a float cast', '$numerator = $salarySen * $hoursQ;', '$numerator = (float) $salarySen * $hoursQ;'],
    ['a division operator', '$rupiah = intdiv($numerator, $denominator);', '$rupiah = (int) ($numerator / $denominator);'],
    ['round()', '$rupiah = intdiv($numerator, $denominator);', '$rupiah = (int) round($numerator / $denominator);'],
    ['a BCMath call', '$numerator = $salarySen * $hoursQ;', '$numerator = (int) bcmul((string) $salarySen, (string) $hoursQ);'],
    ['a float literal', '$rupiah++;', '$rupiah += 0.5;'],
    ['floatval()', '$numerator = $salarySen * $hoursQ;', '$numerator = floatval($salarySen) * $hoursQ;'],
  ]) {
    if (!realValuation.includes(from)) throw new Error('selftest fixture drift: ' + from);
    dirty('float authority in the valuation is caught: ' + label, OVERTIME_VALUATION, realValuation.replace(from, to), 'integer arithmetic only');
  }
  dirty('a payroll call from the Overtime domain is caught', 'server/src/Overtime/OvertimeService.php', S + "$this->data->payroll()->commit($auth);\n", 'no payroll or finance side effect');
  dirty('a finance statement in the overtime store is caught', OVERTIME_STORE, realOvertime.replace('    public const ENTITY', "    public const T_SQL = 'INSERT INTO finance_transactions (company_id) VALUES (:company_id)';\n    public const ENTITY"), 'no payroll or finance side effect');
  dirty('a paid flag in the overtime controller is caught', OVERTIME_CONTROLLER, S + "$out = ['paid' => true];\n", 'no payroll or finance side effect');
  dirty('overtime SQL in an auth store is caught', 'server/src/Data/Auth/AccountStore.php', S + "$this->db->select('SELECT id FROM overtime_records WHERE id = ?', [$e]);\n", 'read and written only by business stores');
  // BF-4c1: payroll has one writer, pre-commit compare-and-swaps only, no 'Committed', frozen links,
  // Approved overtime only, integer-only calculation, no valuation, finance or statutory code.
  const realPayroll = fs.readFileSync(path.join(root, PAYROLL_STORE), 'utf8');
  const inPayroll = (extra) => realPayroll.replace('    public const ENTITY', '    ' + extra + '\n    public const ENTITY');
  clean('the real PayrollStore passes', PAYROLL_STORE, realPayroll);
  dirty('a payroll plan write outside PayrollStore is caught', OVERTIME_STORE, realOvertime.replace('    public const ENTITY', "    public const P_SQL = \"UPDATE payroll_plans SET status = 'Draft' WHERE company_id = :company_id AND version = :expected_version AND status = 'Draft'\";\n    public const ENTITY"), 'written only by ' + PAYROLL_STORE);
  dirty('a payroll link write outside PayrollStore is caught', STORE, inStore(realStore, "public const L_SQL = 'INSERT INTO payroll_plan_overtime (id, company_id) VALUES (:id, :company_id)';"), 'payroll_plan_overtime is written only by');
  dirty('a payroll plan DELETE is caught', PAYROLL_STORE, inPayroll("public const D_SQL = \"DELETE FROM payroll_plans WHERE id = :id AND company_id = :company_id AND status = 'Draft'\";"), 'never deleted');
  dirty('a payroll TRUNCATE is caught', PAYROLL_STORE, inPayroll("public const T_SQL = 'TRUNCATE TABLE payroll_plans';"), 'never deleted');
  dirty('a payroll link TRUNCATE is caught', PAYROLL_STORE, inPayroll("public const T_SQL = 'TRUNCATE TABLE payroll_plan_overtime';"), 'never truncated');
  dirty('a write of Committed is caught (M8)', PAYROLL_STORE, inPayroll("public const C_SQL = \"UPDATE payroll_plans SET status = 'Committed', committed_at = UTC_TIMESTAMP(6), version = version + 1 WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Draft'\";"), "writes 'Committed'");
  // BF-4c2: the one Commit statement — from Ready only, versioned, never widened, never duplicated.
  dirty('a commit from Draft is caught (M1)', PAYROLL_STORE, realPayroll.replace("AND version = :expected_version AND status = 'Ready'\";", "AND version = :expected_version AND status = 'Draft'\";"), "writes 'Committed'");
  dirty('a commit from Reviewed or Ready is caught (M2)', PAYROLL_STORE, realPayroll.replace("AND version = :expected_version AND status = 'Ready'\";", "AND version = :expected_version AND status IN ('Reviewed', 'Ready')\";"), "writes 'Committed'");
  dirty('a commit without its version predicate is caught', PAYROLL_STORE, realPayroll.replace("WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Ready'\";", "WHERE id = :id AND company_id = :company_id AND status = 'Ready'\";"), "writes 'Committed'");
  dirty('a missing Commit statement is caught', PAYROLL_STORE, realPayroll.replace("AND version = :expected_version AND status = 'Ready'\";", "AND version = :expected_version AND status = 'Ready' \";"), 'exactly one Commit statement');
  dirty('a second write of the commit key is caught', PAYROLL_STORE, inPayroll("public const K_SQL = \"UPDATE payroll_plans SET commit_idempotency_key = :k, version = version + 1 WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Draft'\";"), 'commit idempotency key');
  dirty('an Employee read of a non-Committed plan is caught (M14)', PAYROLL_STORE, realPayroll.replace("AND employee_id = :self_employee_id AND status = 'Committed' ORDER BY", "AND employee_id = :self_employee_id ORDER BY"), 'own Committed plans only');
  dirty('an Employee lock is caught', PAYROLL_STORE, inPayroll("public const L2_SQL = \"SELECT id, company_id, employee_id AS owner_employee_id FROM payroll_plans WHERE id = :id AND company_id = :company_id AND employee_id = :self_employee_id AND status = 'Committed' FOR UPDATE\";"), 'own Committed plans only');
  dirty('a transition without its pre-commit predicate is caught (M8/M9)', PAYROLL_STORE, realPayroll.replace(" AND status = :from_status AND status IN ('Draft', 'Reviewed', 'Ready')\";", " AND status = :from_status\";"), 'pre-commit compare-and-swap');
  dirty('a transition without its version predicate is caught (M7)', PAYROLL_STORE, realPayroll.replace("WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = :from_status", "WHERE id = :id AND company_id = :company_id AND status = :from_status"), 'pre-commit compare-and-swap');
  dirty('a recalculation of a non-Draft plan is caught', PAYROLL_STORE, realPayroll.replace("AND version = :expected_version AND status = 'Draft'\";\n    public const TRANSITION_SQL", "AND version = :expected_version AND status <> 'Cancelled'\";\n    public const TRANSITION_SQL"), 'pre-commit compare-and-swap');
  dirty('a transition widened with OR is caught', PAYROLL_STORE, realPayroll.replace("AND status = :from_status AND status IN ('Draft', 'Reviewed', 'Ready')", "AND (status = :from_status OR status = 'Committed') AND status IN ('Draft', 'Reviewed', 'Ready')"), 'pre-commit compare-and-swap');
  dirty('a link release of a committed plan is caught', PAYROLL_STORE, realPayroll.replace("AND p.status IN ('Draft', 'Reviewed', 'Ready'))\";", "AND p.status IN ('Draft', 'Reviewed', 'Ready', 'Committed'))\";"), 'releases only the links of one pre-commit plan');
  dirty('a link release of every plan is caught', PAYROLL_STORE, realPayroll.replace("WHERE company_id = :company_id AND payroll_plan_id = :id AND EXISTS", "WHERE company_id = :company_id AND EXISTS"), 'releases only the links of one pre-commit plan');
  dirty('a payroll read of non-Approved overtime is caught (M4)', PAYROLL_STORE, realPayroll.replace("AND month_key = :month_key AND status = 'Approved' ORDER BY employee_id, id", "AND month_key = :month_key AND status IN ('Approved', 'Reviewed') ORDER BY employee_id, id"), 'reads only Approved overtime');
  dirty('a payroll range lock of employees is caught (deadlock)', PAYROLL_STORE, realPayroll.replace("FROM employees WHERE company_id = :company_id ORDER BY id LIMIT 2001';", "FROM employees WHERE company_id = :company_id ORDER BY id LIMIT 2001 FOR UPDATE';"), 'only by primary key');
  dirty('a payroll lock of overtime rows is caught (deadlock)', PAYROLL_STORE, realPayroll.replace("AND status = 'Approved' ORDER BY employee_id, id LIMIT 2001\";", "AND status = 'Approved' ORDER BY employee_id, id LIMIT 2001 FOR UPDATE\";"), 'only by primary key');
  dirty('a payroll share-lock of the month plans is caught (deadlock)', PAYROLL_STORE, realPayroll.replace("AND status <> 'Cancelled' ORDER BY id LIMIT 2001\";", "AND status <> 'Cancelled' ORDER BY id LIMIT 2001 LOCK IN SHARE MODE\";"), 'only by primary key');
  dirty('a payroll read of a valuation column is caught (M3)', PAYROLL_STORE, realPayroll.replace('employee_id, hours, approved_amount FROM overtime_records', 'employee_id, hours, valuation_salary, approved_amount FROM overtime_records'), 'never values overtime');
  const realCalc = fs.readFileSync(path.join(root, PAYROLL_CALCULATION), 'utf8');
  clean('the real PayrollCalculation is integer arithmetic only', PAYROLL_CALCULATION, realCalc);
  for (const [label, from, to] of [
    ['a float cast (M14)', '$totalSen = $baseSen + $overtimeRupiah * self::SEN_PER_RUPIAH;', '$totalSen = (float) $baseSen + $overtimeRupiah * self::SEN_PER_RUPIAH;'],
    ['a division operator', '$totalRupiah = intdiv($totalSen, self::SEN_PER_RUPIAH);', '$totalRupiah = (int) ($totalSen / self::SEN_PER_RUPIAH);'],
    ['round()', '$totalRupiah = intdiv($totalSen, self::SEN_PER_RUPIAH);', '$totalRupiah = (int) round($totalSen / self::SEN_PER_RUPIAH);'],
    ['a BCMath call', '$totalSen = $baseSen + $overtimeRupiah * self::SEN_PER_RUPIAH;', '$totalSen = (int) bcadd((string) $baseSen, (string) $overtimeRupiah);'],
    ['a float literal', '$totalRupiah++;', '$totalRupiah += 0.5;'],
  ]) {
    if (!realCalc.includes(from)) throw new Error('selftest fixture drift: ' + from);
    dirty('float authority in the payroll calculation is caught: ' + label, PAYROLL_CALCULATION, realCalc.replace(from, to), 'integer arithmetic only');
  }
  const PAYROLL_SERVICE = 'server/src/Payroll/PayrollService.php';
  const realPayrollService = fs.readFileSync(path.join(root, PAYROLL_SERVICE), 'utf8');
  clean('the real PayrollService passes the payroll firewalls', PAYROLL_SERVICE, realPayrollService);
  clean('the real PayrollController passes the payroll firewalls', PAYROLL_CONTROLLER, fs.readFileSync(path.join(root, PAYROLL_CONTROLLER), 'utf8'));
  dirty('a TAM-OT-1 call from Payroll is caught (M3)', PAYROLL_SERVICE, S + "$a = \\TamOs\\Overtime\\OvertimeValuation::value($salary, $hours);\n", 'never values overtime');
  dirty('a finance side effect in Payroll is caught (M13)', PAYROLL_SERVICE, S + "$this->data->finance()->post($auth);\n", 'no finance side effect');
  dirty('a paid flag in the payroll controller is caught (M13)', PAYROLL_CONTROLLER, S + "$out = ['paid' => true];\n", 'no finance side effect');
  dirty('a finance statement in the payroll store is caught (M13)', PAYROLL_STORE, inPayroll("public const F_SQL = 'INSERT INTO finance_transactions (company_id) VALUES (:company_id)';"), 'no finance side effect');
  dirty('a statutory deduction in Payroll is caught (M15)', PAYROLL_SERVICE, S + "$bpjs = 1;\n", 'no statutory payroll');
  dirty('a tax term in the payroll calculation is caught (M15)', PAYROLL_CALCULATION, realCalc.replace('$totalSen = $baseSen', '$taxSen = 0;\n        $totalSen = $baseSen'), 'no statutory payroll');
  dirty('an allowance key in a payroll view is caught (M15)', 'server/src/Payroll/PayrollView.php', S + "$k = 'allowance';\n", 'no statutory payroll');
  dirty('a payroll audit append outside the transaction is caught (M10)', PAYROLL_SERVICE, realPayrollService.replace("            $this->data->audit()->appendPayroll($auth, $actor, $operation, $requestId);\n        });", "        });\n        $this->data->audit()->appendPayroll($auth, $actor, $operation, $requestId);"), 'inside the transaction');
  const realPayrollInput = fs.readFileSync(path.join(root, PAYROLL_INPUT), 'utf8');
  clean('the real PayrollInput passes', PAYROLL_INPUT, realPayrollInput);
  dirty('a browser salary key on generate is caught (M1)', PAYROLL_INPUT, realPayrollInput.replace("self::onlyKeys($json, ['month']);", "self::onlyKeys($json, ['month', 'salary']);"), 'exactly { month }');
  dirty('a browser total key on a transition is caught (M2)', PAYROLL_INPUT, realPayrollInput.replace("self::onlyKeys($json, ['id', 'expectedVersion']);", "self::onlyKeys($json, ['id', 'expectedVersion', 'totalAmount']);"), 'exactly { month }');
  dirty('a commit without its idempotency key is caught (M13)', PAYROLL_INPUT, realPayrollInput.replace("self::onlyKeys($json, ['id', 'expectedVersion', 'expectedTotal', 'idempotencyKey']);", "self::onlyKeys($json, ['id', 'expectedVersion', 'expectedTotal']);"), 'idempotencyKey');
  dirty('a browser salary key on commit is caught', PAYROLL_INPUT, realPayrollInput.replace("self::onlyKeys($json, ['id', 'expectedVersion', 'expectedTotal', 'idempotencyKey']);", "self::onlyKeys($json, ['id', 'expectedVersion', 'expectedTotal', 'idempotencyKey', 'baseSalary']);"), 'idempotencyKey');
  dirty('an employeeId key on generate is caught (identity)', PAYROLL_INPUT, realPayrollInput.replace("self::onlyKeys($json, ['month']);", "self::onlyKeys($json, ['employeeId']);"), 'never names an identity');
  // BF-4d: Supplemental has one writer, open-status compare-and-swaps only, exactly one Commit, frozen
  // links, Approved overtime only, PK locks, no SQL money arithmetic, no base Payroll / overtime write,
  // no valuation, finance, posting, execution or statutory code, strict inputs.
  const realSupp = fs.readFileSync(path.join(root, SUPPLEMENTAL_STORE), 'utf8');
  const inSupp = (extra) => realSupp.replace('    public const ENTITY', '    ' + extra + '\n    public const ENTITY');
  const suppSwap = (from, to) => { if (!realSupp.includes(from)) throw new Error('selftest fixture drift: ' + from); return realSupp.replace(from, to); };
  clean('the real SupplementalStore passes', SUPPLEMENTAL_STORE, realSupp);
  dirty('a Supplemental document write outside SupplementalStore is caught', PAYROLL_STORE, inPayroll("public const S_SQL = \"UPDATE supplemental_payrolls SET status = 'Draft' WHERE company_id = :company_id AND version = :expected_version AND status = 'Draft'\";"), 'written only by ' + SUPPLEMENTAL_STORE);
  dirty('a Supplemental link write outside SupplementalStore is caught', PAYROLL_STORE, inPayroll("public const S_SQL = 'INSERT INTO supplemental_payroll_overtime (id, company_id) VALUES (:id, :company_id)';"), 'supplemental_payroll_overtime is written only by');
  dirty('a base plan write from SupplementalStore is caught (M4)', SUPPLEMENTAL_STORE, inSupp("public const P_SQL = \"UPDATE payroll_plans SET total_amount = :t, version = version + 1 WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Draft'\";"), 'written only by ' + PAYROLL_STORE);
  dirty('a base plan link write from SupplementalStore is caught (M5)', SUPPLEMENTAL_STORE, inSupp("public const P_SQL = 'INSERT INTO payroll_plan_overtime (id, company_id, payroll_plan_id, created_at) VALUES (:overtime_id, :company_id, :id, UTC_TIMESTAMP(6))';"), 'payroll_plan_overtime is written only by');
  dirty('an overtime write from SupplementalStore is caught (M6)', SUPPLEMENTAL_STORE, inSupp("public const O_SQL = \"UPDATE overtime_records SET approved_amount = :a WHERE id = :id AND company_id = :company_id\";"), 'overtime_records is written only by');
  dirty('a Supplemental document DELETE is caught', SUPPLEMENTAL_STORE, inSupp("public const D_SQL = \"DELETE FROM supplemental_payrolls WHERE id = :id AND company_id = :company_id AND status = 'Draft'\";"), 'never deleted');
  dirty('a Supplemental link TRUNCATE is caught', SUPPLEMENTAL_STORE, inSupp("public const T_SQL = 'TRUNCATE TABLE supplemental_payroll_overtime';"), 'never truncated');
  dirty('a second write of Committed is caught (M18)', SUPPLEMENTAL_STORE, inSupp("public const C_SQL = \"UPDATE supplemental_payrolls SET status = 'Committed', committed_at = UTC_TIMESTAMP(6), version = version + 1 WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Draft'\";"), "writes 'Committed'");
  dirty('a commit from Draft is caught (M17)', SUPPLEMENTAL_STORE, suppSwap("AND version = :expected_version AND status = 'Ready'\";", "AND version = :expected_version AND status = 'Draft'\";"), "writes 'Committed'");
  dirty('a commit without its version predicate is caught', SUPPLEMENTAL_STORE, suppSwap("WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Ready'\";", "WHERE id = :id AND company_id = :company_id AND status = 'Ready'\";"), "writes 'Committed'");
  dirty('a second write of the commit key is caught', SUPPLEMENTAL_STORE, inSupp("public const K_SQL = \"UPDATE supplemental_payrolls SET commit_idempotency_key = :k, version = version + 1 WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Draft'\";"), 'commit idempotency key');
  dirty('an Employee read of a non-Committed document is caught (M29)', SUPPLEMENTAL_STORE, suppSwap("AND employee_id = :self_employee_id AND status = 'Committed' ORDER BY", "AND employee_id = :self_employee_id ORDER BY"), 'own Committed documents only');
  dirty('an Employee read widened with OR is caught (M28)', SUPPLEMENTAL_STORE, suppSwap("WHERE id = :id AND company_id = :company_id AND employee_id = :self_employee_id AND status = 'Committed'\";", "WHERE id = :id AND company_id = :company_id AND (employee_id = :self_employee_id OR status = 'Committed')\";"), 'own Committed documents only');
  dirty('a transition without its open-status predicate is caught (M18, M19)', SUPPLEMENTAL_STORE, suppSwap(" AND status = :from_status AND status IN ('Draft', 'Reviewed', 'Ready')\";", " AND status = :from_status\";"), 'open-status compare-and-swap');
  dirty('a transition without its version predicate is caught (M20)', SUPPLEMENTAL_STORE, suppSwap("WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = :from_status", "WHERE id = :id AND company_id = :company_id AND status = :from_status"), 'open-status compare-and-swap');
  dirty('a recalculation of a frozen document is caught (M13, M14)', SUPPLEMENTAL_STORE, suppSwap("AND version = :expected_version AND status = 'Draft'\";\n    public const TRANSITION_SQL", "AND version = :expected_version AND status IN ('Draft', 'Reviewed', 'Ready', 'Committed')\";\n    public const TRANSITION_SQL"), 'open-status compare-and-swap');
  dirty('a Supplemental insert of a non-Draft is caught', SUPPLEMENTAL_STORE, suppSwap(":month_key, 'Draft', :employee_code_snapshot", ":month_key, 'Ready', :employee_code_snapshot"), "inserted only as a 'Draft'");
  dirty('a link release of a Committed document is caught', SUPPLEMENTAL_STORE, suppSwap("AND s.status IN ('Draft', 'Reviewed', 'Ready'))\";", "AND s.status IN ('Draft', 'Reviewed', 'Ready', 'Committed'))\";"), 'releases only the links of one open document');
  dirty('a link release of every document is caught', SUPPLEMENTAL_STORE, suppSwap("WHERE company_id = :company_id AND supplemental_payroll_id = :id AND EXISTS", "WHERE company_id = :company_id AND EXISTS"), 'releases only the links of one open document');
  dirty('a Supplemental read of non-Approved overtime is caught', SUPPLEMENTAL_STORE, suppSwap("AND employee_id = :employee_id AND month_key = :month_key AND status = 'Approved' ORDER BY id LIMIT 2001\";", "AND employee_id = :employee_id AND month_key = :month_key AND status IN ('Approved', 'Reviewed') ORDER BY id LIMIT 2001\";"), 'reads only Approved overtime');
  dirty('a Supplemental read of a valuation column is caught (M7)', SUPPLEMENTAL_STORE, suppSwap('employee_id AS owner_employee_id, hours, approved_amount FROM overtime_records WHERE company_id = :company_id AND employee_id', 'employee_id AS owner_employee_id, hours, valuation_salary, approved_amount FROM overtime_records WHERE company_id = :company_id AND employee_id'), 'never a valuation column');
  dirty('a Supplemental range lock of employees is caught (deadlock)', SUPPLEMENTAL_STORE, inSupp("public const R_SQL = 'SELECT id, company_id, id AS owner_employee_id FROM employees WHERE company_id = :company_id ORDER BY id FOR UPDATE';"), 'only by primary key');
  dirty('a Supplemental lock of overtime rows is caught (deadlock)', SUPPLEMENTAL_STORE, inSupp("public const R_SQL = \"SELECT id, company_id, employee_id AS owner_employee_id FROM overtime_records WHERE id = :id AND company_id = :company_id AND status = 'Approved' FOR UPDATE\";"), 'only by primary key');
  dirty('an SQL money sum is caught (M2)', SUPPLEMENTAL_STORE, inSupp("public const S_SQL = \"SELECT SUM(approved_amount) AS t, company_id, employee_id AS owner_employee_id FROM overtime_records WHERE company_id = :company_id AND status = 'Approved'\";"), 'never adds or sums money in SQL');
  dirty('an SQL money addition is caught (M2)', SUPPLEMENTAL_STORE, suppSwap("SET overtime_amount = :overtime_amount,", "SET overtime_amount = overtime_amount + :overtime_amount,"), 'never adds or sums money in SQL');
  dirty('a missing Supplemental Commit statement is caught', SUPPLEMENTAL_STORE, suppSwap("AND version = :expected_version AND status = 'Ready'\";", "AND version = :expected_version AND status = 'Ready' \";"), 'exactly one Commit statement');
  const SUPP_SERVICE = 'server/src/Supplemental/SupplementalService.php';
  const realSuppService = fs.readFileSync(path.join(root, SUPP_SERVICE), 'utf8');
  clean('the real SupplementalService passes the Supplemental firewalls', SUPP_SERVICE, realSuppService);
  clean('the real SupplementalController passes the Supplemental firewalls', SUPPLEMENTAL_CONTROLLER, fs.readFileSync(path.join(root, SUPPLEMENTAL_CONTROLLER), 'utf8'));
  for (const f of ['SupplementalStatus.php', 'SupplementalView.php', 'SupplementalInput.php']) clean('the real ' + f + ' passes', SUPPLEMENTAL_DIR + f, fs.readFileSync(path.join(root, SUPPLEMENTAL_DIR + f), 'utf8'));
  dirty('a base Payroll store call from Supplemental is caught (M4)', SUPP_SERVICE, S + "$this->data->payroll()->commit($auth, 1, $k);\n", 'never calls the base Payroll');
  dirty('an Overtime store call from Supplemental is caught (M6)', SUPP_SERVICE, S + "$this->data->overtime()->approve($auth);\n", 'never calls the base Payroll');
  dirty('a TAM-OT-1 call from Supplemental is caught (M7)', SUPP_SERVICE, S + "$a = \\TamOs\\Overtime\\OvertimeValuation::value($salary, $hours);\n", 'never values overtime');
  dirty('a finance posting in Supplemental is caught (M32)', SUPP_SERVICE, S + "$this->data->finance()->post($auth);\n", 'no finance side effect');
  dirty('a LOCAL postSupplemental port is caught (M32)', SUPP_SERVICE, S + "$r = postSupplemental($id);\n", 'no finance side effect');
  dirty('an Executed status in Supplemental is caught (M33)', SUPPLEMENTAL_DIR + 'SupplementalStatus.php', S + "$s = 'Executed';\n", 'no finance side effect');
  dirty('a paid flag in the Supplemental controller is caught (M33)', SUPPLEMENTAL_CONTROLLER, S + "$out = ['paid' => true];\n", 'no finance side effect');
  dirty('a company account snapshot in Supplemental is caught (M32)', SUPPLEMENTAL_STORE, inSupp("public const A_SQL = 'SELECT company_account_id, company_id, id AS owner_employee_id FROM supplemental_payrolls WHERE company_id = :company_id';"), 'no finance side effect');
  dirty('a THR term in Supplemental is caught (M34)', SUPP_SERVICE, S + "$thr = 1;\n", 'no statutory');
  dirty('a PPh term in Supplemental is caught (M34)', SUPPLEMENTAL_DIR + 'SupplementalView.php', S + "$k = 'pph21';\n", 'no statutory');
  dirty('an allowance component in Supplemental is caught (M35)', SUPP_SERVICE, S + "$allowance = '0.00';\n", 'no statutory');
  dirty('a reimbursement component in Supplemental is caught (M35)', SUPP_SERVICE, S + "$reimbursement = '0.00';\n", 'no statutory');
  dirty('a bonus column in the Supplemental store is caught (M35)', SUPPLEMENTAL_STORE, inSupp("public const B_SQL = 'SELECT bonus_amount, company_id, employee_id AS owner_employee_id FROM supplemental_payrolls WHERE company_id = :company_id';"), 'no statutory');
  dirty('a float in Supplemental is caught (M1)', SUPP_SERVICE, S + "$t = (float) $amount;\n", 'integer arithmetic only');
  dirty('a division in Supplemental is caught (M1)', SUPP_SERVICE, S + "$t = $amount / 100;\n", 'integer arithmetic only');
  dirty('a Supplemental audit append outside the transaction is caught (M31)', SUPP_SERVICE, realSuppService.replace("            $this->data->audit()->appendSupplemental($auth, $actor, $operation, $in['id'], $requestId);\n        });", "        });\n        $this->data->audit()->appendSupplemental($auth, $actor, $operation, $in['id'], $requestId);"), 'inside the transaction');
  const realSuppInput = fs.readFileSync(path.join(root, SUPPLEMENTAL_INPUT), 'utf8');
  dirty('a browser amount key on generate is caught', SUPPLEMENTAL_INPUT, realSuppInput.replace("self::onlyKeys($json, ['payrollPlanId']);", "self::onlyKeys($json, ['payrollPlanId', 'overtimeAmount']);"), 'exactly { payrollPlanId }');
  dirty('a browser overtime list on generate is caught', SUPPLEMENTAL_INPUT, realSuppInput.replace("self::onlyKeys($json, ['payrollPlanId']);", "self::onlyKeys($json, ['payrollPlanId', 'overtimeIds']);"), 'exactly { payrollPlanId }');
  dirty('a commit without its idempotency key is caught', SUPPLEMENTAL_INPUT, realSuppInput.replace("self::onlyKeys($json, ['id', 'expectedVersion', 'expectedTotal', 'idempotencyKey']);", "self::onlyKeys($json, ['id', 'expectedVersion', 'expectedTotal']);"), 'idempotencyKey');
  dirty('an employeeId key on a transition is caught (identity)', SUPPLEMENTAL_INPUT, realSuppInput.replace("self::onlyKeys($json, ['id', 'expectedVersion']);", "self::onlyKeys($json, ['employeeId']);"), 'never names an identity');
  // BF-4e: one Finance writer that only inserts Planned postings, PK locks, no SQL money, no source
  // write or store call, Planned only (no execution, payment, actual, account, category, reversal),
  // strict inputs, routes under the source domain's Action.
  const realFin = fs.readFileSync(path.join(root, FINANCE_STORE), 'utf8');
  const inFin = (extra) => realFin.replace('    public const PAYROLL_PLAN', '    ' + extra + '\n    public const PAYROLL_PLAN');
  const finSwap = (from, to) => { if (!realFin.includes(from)) throw new Error('selftest fixture drift: ' + from); return realFin.replace(from, to); };
  clean('the real FinancePostingStore passes', FINANCE_STORE, realFin);
  const FIN_SERVICE = FINANCE_DIR + 'FinancePostingService.php';
  const realFinService = fs.readFileSync(path.join(root, FIN_SERVICE), 'utf8');
  clean('the real FinancePostingService passes the Finance firewalls', FIN_SERVICE, realFinService);
  clean('the real FinanceController passes the Finance firewalls', FINANCE_CONTROLLER, fs.readFileSync(path.join(root, FINANCE_CONTROLLER), 'utf8'));
  for (const f of ['FinancePostingInput.php', 'FinancePostingView.php']) clean('the real ' + f + ' passes', FINANCE_DIR + f, fs.readFileSync(path.join(root, FINANCE_DIR + f), 'utf8'));
  dirty('a posting UPDATE is caught (immutable)', FINANCE_STORE, inFin("public const U_SQL = \"UPDATE finance_postings SET status = 'Executed' WHERE id = :id AND company_id = :company_id\";"), 'immutable');
  dirty('a posting DELETE is caught (immutable, no reversal)', FINANCE_STORE, inFin("public const D_SQL = 'DELETE FROM finance_postings WHERE id = :id AND company_id = :company_id';"), 'immutable');
  dirty('a posting TRUNCATE is caught', FINANCE_STORE, inFin("public const T_SQL = 'TRUNCATE TABLE finance_postings';"), 'immutable');
  dirty('a posting write outside FinancePostingStore is caught', PAYROLL_STORE, inPayroll("public const F_SQL = \"INSERT INTO finance_postings (id, company_id, status) VALUES (:id, :company_id, 'Planned')\";"), 'written only by ' + FINANCE_STORE);
  dirty('a posting insert of a non-Planned status is caught', FINANCE_STORE, finSwap(":id, NULL, :employee_id, :month_key, :amount, 'Planned', :idempotency_key", ":id, NULL, :employee_id, :month_key, :amount, 'Executed', :idempotency_key"), "inserted only as 'Planned'");
  dirty('an INSERT IGNORE posting is caught', FINANCE_STORE, finSwap("\"INSERT INTO finance_postings (id, company_id, source_kind, payroll_plan_id, supplemental_payroll_id, employee_id, month_key, amount, status, idempotency_key, posted_at) VALUES (:posting_id, :company_id, 'payrollPlan'", "\"INSERT IGNORE INTO finance_postings (id, company_id, source_kind, payroll_plan_id, supplemental_payroll_id, employee_id, month_key, amount, status, idempotency_key, posted_at) VALUES (:posting_id, :company_id, 'payrollPlan'"), "never IGNORE");
  dirty('an upserting posting is caught', FINANCE_STORE, finSwap("'Planned', :idempotency_key, UTC_TIMESTAMP(6))\";\n    public const INSERT_SUPPLEMENTAL_SQL", "'Planned', :idempotency_key, UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE amount = VALUES(amount)\";\n    public const INSERT_SUPPLEMENTAL_SQL"), 'inserted only');
  dirty('a third posting INSERT is caught', FINANCE_STORE, inFin("public const M_SQL = \"INSERT INTO finance_postings (id, company_id, source_kind, payroll_plan_id, supplemental_payroll_id, employee_id, month_key, amount, status, idempotency_key, posted_at) VALUES (:posting_id, :company_id, 'manual', NULL, NULL, :employee_id, :month_key, :amount, 'Planned', :idempotency_key, UTC_TIMESTAMP(6))\";"), 'exactly two INSERT statements');
  dirty('a base plan write from the Finance store is caught', FINANCE_STORE, inFin("public const P_SQL = \"UPDATE payroll_plans SET status = 'Posted' WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Draft'\";"), 'written only by ' + PAYROLL_STORE);
  dirty('a Supplemental write from the Finance store is caught', FINANCE_STORE, inFin("public const S_SQL = \"UPDATE supplemental_payrolls SET status = 'Posted' WHERE id = :id AND company_id = :company_id AND version = :expected_version AND status = 'Draft'\";"), 'written only by ' + SUPPLEMENTAL_STORE);
  dirty('a Finance range lock is caught (deadlock)', FINANCE_STORE, inFin("public const R_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id FROM payroll_plans WHERE company_id = :company_id AND month_key = :month_key FOR UPDATE';"), 'only by primary key');
  dirty('a lock of a posting row is caught', FINANCE_STORE, inFin("public const L_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id FROM finance_postings WHERE id = :id AND company_id = :company_id FOR UPDATE';"), 'only by primary key');
  dirty('an Employee Finance statement is caught (CEO only)', FINANCE_STORE, inFin("public const MONTH_SELF_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id FROM finance_postings WHERE company_id = :company_id AND employee_id = :self_employee_id';"), 'CEO company scope only');
  dirty('an SQL money computation is caught', FINANCE_STORE, finSwap(":month_key, :amount, 'Planned', :idempotency_key, UTC_TIMESTAMP(6))\";\n    public const INSERT_SUPPLEMENTAL_SQL", ":month_key, :amount + 0, 'Planned', :idempotency_key, UTC_TIMESTAMP(6))\";\n    public const INSERT_SUPPLEMENTAL_SQL"), 'never computes money in SQL');
  dirty('an SQL sum is caught', FINANCE_STORE, inFin("public const S_SQL = 'SELECT SUM(amount) AS t, company_id, employee_id AS owner_employee_id FROM finance_postings WHERE company_id = :company_id';"), 'never computes money in SQL');
  dirty('a Payroll store call from Finance is caught', FIN_SERVICE, S + "$this->data->payroll()->commit($auth, 1, $k);\n", 'never calls the Payroll');
  dirty('a Supplemental store call from Finance is caught', FIN_SERVICE, S + "$this->data->supplemental()->lock($auth, $id);\n", 'never calls the Payroll');
  dirty('an execution in Finance is caught (D-FIN-1)', FIN_SERVICE, S + "$r = executeTransaction($id);\n", 'Planned only');
  dirty('an Executed status in the Finance view is caught', FINANCE_DIR + 'FinancePostingView.php', S + "$s = 'Executed';\n", 'Planned only');
  dirty('an actual amount in Finance is caught', FIN_SERVICE, S + "$actualAmount = $x;\n", 'Planned only');
  dirty('a paid flag in the Finance controller is caught', FINANCE_CONTROLLER, S + "$out = ['paid' => true];\n", 'Planned only');
  dirty('a company account in Finance is caught', FINANCE_STORE, inFin("public const A_SQL = 'SELECT company_account_id, company_id, employee_id AS owner_employee_id FROM finance_postings WHERE company_id = :company_id';"), 'Planned only');
  dirty('a category in Finance is caught', FIN_SERVICE, S + "$category = 'Gaji';\n", 'Planned only');
  dirty('a monthly plan link in Finance is caught', FIN_SERVICE, S + "$monthlyPlanId = $p;\n", 'Planned only');
  dirty('a reversal in Finance is caught (D-FIN-5)', FIN_SERVICE, S + "$this->reverse($id);\n", 'Planned only');
  dirty('a correction in Finance is caught (D-FIN-5)', FIN_SERVICE, S + "$correction = 1;\n", 'Planned only');
  dirty('a float in Finance is caught', FIN_SERVICE, S + "$t = (float) $amount;\n", 'never computes money');
  dirty('a division in Finance is caught', FIN_SERVICE, S + "$t = $amount / 100;\n", 'never computes money');
  dirty('a statutory term in Finance is caught', FIN_SERVICE, S + "$pph21 = 0;\n", 'no statutory');
  dirty('a Finance audit append outside the transaction is caught', FIN_SERVICE, realFinService.replace("            $this->data->audit()->appendPosting($auth, $actor, $in['sourceId'], $requestId);\n            return $postingId;\n        }, readCommitted: true);\n        return $store->record($scope, $id) ?? throw new \\LogicException('posting not readable');\n    }\n\n    /**\n     * Posts one Committed Supplemental",
    "            return $postingId;\n        }, readCommitted: true);\n        $this->data->audit()->appendPosting($auth, $actor, $in['sourceId'], $requestId);\n        return $store->record($scope, $id) ?? throw new \\LogicException('posting not readable');\n    }\n\n    /**\n     * Posts one Committed Supplemental"), 'inside the transaction');
  const realFinInput = fs.readFileSync(path.join(root, FINANCE_INPUT), 'utf8');
  dirty('a browser amount key on a posting is caught', FINANCE_INPUT, realFinInput.replace("self::onlyKeys($json, ['payrollPlanId', 'expectedAmount', 'idempotencyKey']);", "self::onlyKeys($json, ['payrollPlanId', 'expectedAmount', 'idempotencyKey', 'amount']);"), 'exactly { payrollPlanId');
  dirty('a posting without its idempotency key is caught', FINANCE_INPUT, realFinInput.replace("self::onlyKeys($json, ['supplementalPayrollId', 'expectedAmount', 'idempotencyKey']);", "self::onlyKeys($json, ['supplementalPayrollId', 'expectedAmount']);"), 'exactly { payrollPlanId');
  dirty('an employeeId key on a posting is caught (identity)', FINANCE_INPUT, realFinInput.replace("self::onlyKeys($json, ['payrollPlanId', 'expectedAmount', 'idempotencyKey']);", "self::onlyKeys($json, ['employeeId', 'expectedAmount', 'idempotencyKey']);"), 'never names an identity');
  const m32 = fs.readFileSync(path.join(root, 'server/migrations/0032_create_finance_postings.sql'), 'utf8');
  tenant('the real finance_postings migration passes', m32, 0);
  tenant('finance_postings without its tenant UNIQUE is caught', m32.replace('  UNIQUE KEY finance_postings_company_id (company_id, id),\n', ''), 'UNIQUE KEY (company_id, id)');
  tenant('a cascading posting source FK is caught', m32.replace('REFERENCES payroll_plans (company_id, id)', 'REFERENCES payroll_plans (company_id, id) ON DELETE CASCADE'), 'CASCADE');
  tenant('a set-null posting FK is caught', m32.replace('REFERENCES supplemental_payrolls (company_id, id)', 'REFERENCES supplemental_payrolls (company_id, id) ON DELETE SET NULL'), 'CASCADE');
  // BF-4f: one execution writer that only inserts, one posting lock, no SQL money, no posting write or
  // store call, one full execution only (no reversal, correction, partial, account, reference, note),
  // the exact input and closed method list, the route under finance.execute.
  const realExe = fs.readFileSync(path.join(root, FINANCE_EXECUTION_STORE), 'utf8');
  const inExe = (extra) => realExe.replace('    public const LIST_CAP', '    ' + extra + '\n    public const LIST_CAP');
  const exeSwap = (from, to) => { if (!realExe.includes(from)) throw new Error('selftest fixture drift: ' + from); return realExe.replace(from, to); };
  clean('the real FinanceExecutionStore passes', FINANCE_EXECUTION_STORE, realExe);
  const EXE_SERVICE = FINANCE_EXECUTION_PREFIX + 'Service.php';
  const realExeService = fs.readFileSync(path.join(root, EXE_SERVICE), 'utf8');
  clean('the real FinanceExecutionService passes the execution firewalls', EXE_SERVICE, realExeService);
  clean('the real FinanceExecutionController passes the execution firewalls', FINANCE_EXECUTION_CONTROLLER, fs.readFileSync(path.join(root, FINANCE_EXECUTION_CONTROLLER), 'utf8'));
  for (const f of ['Input.php', 'View.php']) clean('the real FinanceExecution' + f + ' passes', FINANCE_EXECUTION_PREFIX + f, fs.readFileSync(path.join(root, FINANCE_EXECUTION_PREFIX + f), 'utf8'));
  dirty('an execution UPDATE is caught (immutable)', FINANCE_EXECUTION_STORE, inExe("public const U_SQL = \"UPDATE finance_executions SET payment_method = 'cash' WHERE id = :id AND company_id = :company_id\";"), 'immutable');
  dirty('an execution DELETE is caught (no reversal)', FINANCE_EXECUTION_STORE, inExe("public const D_SQL = 'DELETE FROM finance_executions WHERE id = :id AND company_id = :company_id';"), 'immutable');
  dirty('an execution TRUNCATE is caught', FINANCE_EXECUTION_STORE, inExe("public const T_SQL = 'TRUNCATE TABLE finance_executions';"), 'immutable');
  dirty('an execution write outside FinanceExecutionStore is caught', FINANCE_STORE, inFin("public const E_SQL = \"INSERT INTO finance_executions (id, company_id) VALUES (:id, :company_id)\";"), 'written only by ' + FINANCE_EXECUTION_STORE);
  dirty('a posting status write from the execution store is caught (D-FEX-1)', FINANCE_EXECUTION_STORE, inExe("public const P_SQL = \"UPDATE finance_postings SET status = 'Executed' WHERE id = :id AND company_id = :company_id\";"), 'written only by ' + FINANCE_STORE);
  dirty('an INSERT IGNORE execution is caught', FINANCE_EXECUTION_STORE, exeSwap("'INSERT INTO finance_executions (", "'INSERT IGNORE INTO finance_executions ("), 'never IGNORE');
  dirty('an upserting execution is caught', FINANCE_EXECUTION_STORE, exeSwap(":idempotency_key, UTC_TIMESTAMP(6))';", ":idempotency_key, UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE executed_on = VALUES(executed_on)';"), 'inserted only once');
  dirty('a second execution INSERT is caught (one execution per posting)', FINANCE_EXECUTION_STORE, inExe("public const P2_SQL = 'INSERT INTO finance_executions (id, company_id, finance_posting_id, employee_id, month_key, amount, executed_on, payment_method, idempotency_key, recorded_at) VALUES (:execution_id, :company_id, :finance_posting_id, :employee_id, :month_key, :amount, :executed_on, :payment_method, :idempotency_key, UTC_TIMESTAMP(6))';"), 'exactly one INSERT');
  dirty('an execution lock of the employee is caught', FINANCE_EXECUTION_STORE, inExe("public const E_SQL = 'SELECT id, company_id, id AS owner_employee_id FROM employees WHERE id = :employee_id AND company_id = :company_id FOR UPDATE';"), 'locks exactly its posting');
  dirty('an execution range lock is caught (deadlock)', FINANCE_EXECUTION_STORE, exeSwap("FROM finance_postings WHERE id = :id AND company_id = :company_id FOR UPDATE'", "FROM finance_postings WHERE company_id = :company_id AND month_key = :id FOR UPDATE'"), 'locks exactly its posting');
  dirty('an execution without its posting lock is caught', FINANCE_EXECUTION_STORE, exeSwap(" AND company_id = :company_id FOR UPDATE';", " AND company_id = :company_id';"), 'exactly one lock');
  dirty('an Employee execution statement is caught (CEO only)', FINANCE_EXECUTION_STORE, inExe("public const MONTH_SELF_SQL = 'SELECT id, company_id, employee_id AS owner_employee_id FROM finance_executions WHERE company_id = :company_id AND employee_id = :self_employee_id';"), 'CEO company scope only');
  dirty('an execution SQL money computation is caught (partial payment)', FINANCE_EXECUTION_STORE, exeSwap(":month_key, :amount, :executed_on", ":month_key, :amount - 1, :executed_on"), 'never computes money in SQL');
  dirty('an execution SQL sum is caught', FINANCE_EXECUTION_STORE, inExe("public const S_SQL = 'SELECT SUM(amount) AS t, company_id, employee_id AS owner_employee_id FROM finance_executions WHERE company_id = :company_id';"), 'never computes money in SQL');
  dirty('a posting store call from the execution is caught', EXE_SERVICE, S + "$this->data->finance()->record($scope, $id);\n", 'never calls the posting');
  dirty('a Payroll store call from the execution is caught', EXE_SERVICE, S + "$this->data->payroll()->commit($auth, 1, $k);\n", 'never calls the posting');
  dirty('a reversal in the execution is caught (no reversal)', EXE_SERVICE, S + "$this->reverse($id);\n", 'one full execution only');
  dirty('a correction in the execution is caught (no correction)', EXE_SERVICE, S + "$correction = 1;\n", 'one full execution only');
  dirty('a refund in the execution is caught', EXE_SERVICE, S + "$refund = 1;\n", 'one full execution only');
  dirty('a partial payment in the execution is caught (D-FEX-2)', EXE_SERVICE, S + "$partialAmount = $x;\n", 'one full execution only');
  dirty('a reconciliation in the execution is caught', EXE_SERVICE, S + "$this->reconcile($id);\n", 'one full execution only');
  dirty('a company account in the execution is caught (D-FEX-5)', FINANCE_EXECUTION_STORE, inExe("public const A_SQL = 'SELECT company_account_id, company_id, employee_id AS owner_employee_id FROM finance_executions WHERE company_id = :company_id';"), 'one full execution only');
  dirty('a bank account in the execution view is caught (D-FEX-5)', FINANCE_EXECUTION_PREFIX + 'View.php', S + "$bankAccount = 'x';\n", 'one full execution only');
  dirty('a reference in the execution controller is caught (D-FEX-5)', FINANCE_EXECUTION_CONTROLLER, S + "$out = ['reference' => $r];\n", 'one full execution only');
  dirty('a note in the execution is caught (D-FEX-5)', EXE_SERVICE, S + "$notes = $n;\n", 'one full execution only');
  dirty('a batch execution is caught', EXE_SERVICE, S + "$this->batch($ids);\n", 'one full execution only');
  dirty('a scheduled execution is caught', EXE_SERVICE, S + "$scheduledFor = $d;\n", 'one full execution only');
  dirty('a float in the execution is caught', EXE_SERVICE, S + "$t = (float) $amount;\n", 'never computes money');
  dirty('a division in the execution is caught', EXE_SERVICE, S + "$t = $amount / 2;\n", 'never computes money');
  dirty('a statutory term in the execution is caught', EXE_SERVICE, S + "$pph21 = 0;\n", 'no statutory');
  dirty('an execution audit append outside the transaction is caught', EXE_SERVICE, realExeService.replace("            $this->data->audit()->appendExecution($auth, $actor, $in['financePostingId'], $requestId);\n            return $executionId;\n        }, readCommitted: true);\n",
    "            return $executionId;\n        }, readCommitted: true);\n        $this->data->audit()->appendExecution($auth, $actor, $in['financePostingId'], $requestId);\n"), 'inside the transaction');
  const realExeInput = fs.readFileSync(path.join(root, FINANCE_EXECUTION_INPUT), 'utf8');
  const exeKeys = "self::onlyKeys($json, ['financePostingId', 'expectedAmount', 'executedOn', 'paymentMethod', 'idempotencyKey']);";
  dirty('a browser amount key on an execution is caught (D-FEX-3)', FINANCE_EXECUTION_INPUT, realExeInput.replace(exeKeys, "self::onlyKeys($json, ['financePostingId', 'expectedAmount', 'executedOn', 'paymentMethod', 'idempotencyKey', 'amount']);"), 'allows exactly');
  dirty('an execution without its idempotency key is caught', FINANCE_EXECUTION_INPUT, realExeInput.replace(exeKeys, "self::onlyKeys($json, ['financePostingId', 'expectedAmount', 'executedOn', 'paymentMethod']);"), 'allows exactly');
  dirty('a company account key on an execution is caught (D-FEX-5)', FINANCE_EXECUTION_INPUT, realExeInput.replace(exeKeys, "self::onlyKeys($json, ['financePostingId', 'expectedAmount', 'executedOn', 'paymentMethod', 'idempotencyKey', 'companyAccountId']);"), 'allows exactly');
  dirty('an employeeId key on an execution is caught (identity)', FINANCE_EXECUTION_INPUT, realExeInput.replace(exeKeys, "self::onlyKeys($json, ['employeeId', 'expectedAmount', 'executedOn', 'paymentMethod', 'idempotencyKey']);"), 'never names an identity');
  dirty('a widened payment method list is caught (D-FEX-5)', FINANCE_EXECUTION_INPUT, realExeInput.replace("'creditCard', 'other'];", "'creditCard', 'other', 'cheque'];"), 'closed list');
  dirty('a server UTC date bound is caught (D-FEX-8)', FINANCE_EXECUTION_INPUT, realExeInput.replace("COMPANY_TIMEZONE = 'Asia/Jakarta';", "COMPANY_TIMEZONE = 'UTC';"), 'Asia/Jakarta');
  const m34 = fs.readFileSync(path.join(root, 'server/migrations/0034_create_finance_executions.sql'), 'utf8');
  tenant('the real finance_executions migration passes', m34, 0);
  tenant('finance_executions without its tenant UNIQUE is caught', m34.replace('  UNIQUE KEY finance_executions_company_id (company_id, id),\n', ''), 'UNIQUE KEY (company_id, id)');
  tenant('a cascading execution posting FK is caught (an executed posting removed)', m34.replace('REFERENCES finance_postings (company_id, id)', 'REFERENCES finance_postings (company_id, id) ON DELETE CASCADE'), 'CASCADE');
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
  cases.push({ name: 'an overtime approve route under a weaker Action is caught', run: () => checkRouteActions(realRoutes.replace("$overtime->approve(...), [], RouteAuth::Required, Action::OvertimeManage)", "$overtime->approve(...), [], RouteAuth::Required, Action::OvertimeSubmitSelf)")), expect: 'must declare Action::OvertimeManage' });
  cases.push({ name: 'a missing overtime approve route is caught', run: () => checkRouteActions(realRoutes.replace("            new Route('POST', '/api/overtime-records/approve', $overtime->approve(...), [], RouteAuth::Required, Action::OvertimeManage),\n", '')), expect: 'overtime route POST /api/overtime-records/approve is missing' });
  cases.push({ name: 'a missing account route is caught', run: () => checkRouteActions(realRoutes.replace("            new Route('POST', '/api/employees/enable-account', $employees->enableAccount(...), [], RouteAuth::Required, Action::AccountManage),\n", '')), expect: 'is missing' });
  cases.push({ name: 'a payroll write under a weaker Action is caught', run: () => checkRouteActions(realRoutes.replace("$payroll->cancel(...), [], RouteAuth::Required, Action::PayrollManage)", "$payroll->cancel(...), [], RouteAuth::Required, Action::OvertimeManage)")), expect: 'must declare Action::PayrollManage' });
  cases.push({ name: 'a missing payroll route is caught', run: () => checkRouteActions(realRoutes.replace("            new Route('POST', '/api/payroll-plans/return', $payroll->returnToDraft(...), [], RouteAuth::Required, Action::PayrollManage),\n", '')), expect: 'payroll route POST /api/payroll-plans/return is missing' });
  cases.push({ name: 'a payroll payment route is caught', run: () => checkRouteActions(realRoutes.replace("            new Route('POST', '/api/payroll-plans/cancel',", "            new Route('POST', '/api/payroll-plans/pay', $payroll->cancel(...), [], RouteAuth::Required, Action::PayrollManage),\n            new Route('POST', '/api/payroll-plans/cancel',")), expect: 'not a payroll write' });
  cases.push({ name: 'a payroll status read is caught', run: () => checkRouteActions(realRoutes.replace("            new Route('POST', '/api/payroll-plans/cancel',", "            new Route('GET', '/api/payroll-plan/status', $payroll->find(...), ['id'], RouteAuth::Required),\n            new Route('POST', '/api/payroll-plans/cancel',")), expect: 'no payroll status, payment or payslip route' });
  cases.push({ name: 'a missing commit route is caught', run: () => checkRouteActions(realRoutes.replace("            new Route('POST', '/api/payroll-plans/commit', $payroll->commit(...), [], RouteAuth::Required, Action::PayrollManage),\n", '')), expect: 'payroll route POST /api/payroll-plans/commit is missing' });
  cases.push({ name: 'payroll.manage on the drift read is caught', run: () => checkRouteActions(realRoutes.replace("$payroll->drift(...), ['id'], RouteAuth::Required)", "$payroll->drift(...), ['id'], RouteAuth::Required, Action::PayrollManage)")), expect: 'must not declare Action::PayrollManage' });
  cases.push({ name: 'a Supplemental write under a weaker Action is caught (M37)', run: () => checkRouteActions(realRoutes.replace("$supplemental->cancel(...), [], RouteAuth::Required, Action::SupplementalManage)", "$supplemental->cancel(...), [], RouteAuth::Required, Action::PayrollManage)")), expect: 'must declare Action::SupplementalManage' });
  cases.push({ name: 'a missing Supplemental route is caught', run: () => checkRouteActions(realRoutes.replace("            new Route('POST', '/api/supplemental-payrolls/commit', $supplemental->commit(...), [], RouteAuth::Required, Action::SupplementalManage),\n", '')), expect: 'Supplemental route POST /api/supplemental-payrolls/commit is missing' });
  cases.push({ name: 'a Supplemental posting route is caught (M32)', run: () => checkRouteActions(realRoutes.replace("            new Route('POST', '/api/supplemental-payrolls/cancel',", "            new Route('POST', '/api/supplemental-payrolls/post', $supplemental->cancel(...), [], RouteAuth::Required, Action::SupplementalManage),\n            new Route('POST', '/api/supplemental-payrolls/cancel',")), expect: 'not a Supplemental write' });
  cases.push({ name: 'a Supplemental execute read is caught (M33)', run: () => checkRouteActions(realRoutes.replace("            new Route('POST', '/api/supplemental-payrolls/cancel',", "            new Route('GET', '/api/supplemental-payroll/execution', $supplemental->find(...), ['id'], RouteAuth::Required),\n            new Route('POST', '/api/supplemental-payrolls/cancel',")), expect: 'no Supplemental status, payment, posting, execution' });
  cases.push({ name: 'supplemental.manage on the eligibility read is caught', run: () => checkRouteActions(realRoutes.replace("$supplemental->eligibility(...), ['month'], RouteAuth::Required)", "$supplemental->eligibility(...), ['month'], RouteAuth::Required, Action::SupplementalManage)")), expect: 'must not declare Action::SupplementalManage' });
  cases.push({ name: 'supplemental.manage on a payroll route is caught', run: () => checkRouteActions(realRoutes.replace("$payroll->review(...), [], RouteAuth::Required, Action::PayrollManage)", "$payroll->review(...), [], RouteAuth::Required, Action::SupplementalManage)")), expect: 'must declare Action::PayrollManage' });
  cases.push({ name: 'a Finance base plan posting under supplemental.manage is caught', run: () => checkRouteActions(realRoutes.replace("$finance->postPayrollPlan(...), [], RouteAuth::Required, Action::PayrollManage)", "$finance->postPayrollPlan(...), [], RouteAuth::Required, Action::SupplementalManage)")), expect: 'must declare exactly Action::PayrollManage' });
  cases.push({ name: 'a Finance Supplemental posting under finance.manage is caught', run: () => checkRouteActions(realRoutes.replace("$finance->postSupplementalPayroll(...), [], RouteAuth::Required, Action::SupplementalManage)", "$finance->postSupplementalPayroll(...), [], RouteAuth::Required, Action::FinanceManage)")), expect: 'must declare exactly Action::SupplementalManage' });
  cases.push({ name: 'a missing Finance posting route is caught', run: () => checkRouteActions(realRoutes.replace("            new Route('POST', '/api/finance-postings/payroll-plan', $finance->postPayrollPlan(...), [], RouteAuth::Required, Action::PayrollManage),\n", '')), expect: 'Finance posting route POST /api/finance-postings/payroll-plan is missing' });
  cases.push({ name: 'a missing Finance month read is caught', run: () => checkRouteActions(realRoutes.replace("            new Route('GET', '/api/finance-postings', $finance->month(...), ['month'], RouteAuth::Required),\n", '')), expect: 'Finance month read' });
  cases.push({ name: 'a Finance execution route is caught (D-FIN-1)', run: () => checkRouteActions(realRoutes.replace("            new Route('GET', '/api/finance-postings',", "            new Route('POST', '/api/finance-postings/execute', $finance->postPayrollPlan(...), [], RouteAuth::Required, Action::FinanceExecute),\n            new Route('GET', '/api/finance-postings',")), expect: 'the only Finance routes' });
  cases.push({ name: 'a Finance reversal route is caught (D-FIN-5)', run: () => checkRouteActions(realRoutes.replace("            new Route('GET', '/api/finance-postings',", "            new Route('POST', '/api/finance-postings/reverse', $finance->postPayrollPlan(...), [], RouteAuth::Required, Action::FinanceManage),\n            new Route('GET', '/api/finance-postings',")), expect: 'the only Finance routes' });
  cases.push({ name: 'a Finance transaction route is caught', run: () => checkRouteActions(realRoutes.replace("            new Route('GET', '/api/finance-postings',", "            new Route('GET', '/api/finance-transactions', $finance->month(...), ['month'], RouteAuth::Required),\n            new Route('GET', '/api/finance-postings',")), expect: 'the only Finance routes' });
  cases.push({ name: 'an Action on the Finance month read is caught', run: () => checkRouteActions(realRoutes.replace("$finance->month(...), ['month'], RouteAuth::Required)", "$finance->month(...), ['month'], RouteAuth::Required, Action::FinanceManage)")), expect: 'Finance month read' });
  // BF-4f: the one execution command under exactly finance.execute; its month read with no Action.
  cases.push({ name: 'the Finance execution under finance.manage is caught (D-FEX-4)', run: () => checkRouteActions(realRoutes.replace("$financeExecutions->execute(...), [], RouteAuth::Required, Action::FinanceExecute)", "$financeExecutions->execute(...), [], RouteAuth::Required, Action::FinanceManage)")), expect: 'must declare exactly Action::FinanceExecute' });
  cases.push({ name: 'a missing Finance execution route is caught', run: () => checkRouteActions(realRoutes.replace("            new Route('POST', '/api/finance-executions/execute', $financeExecutions->execute(...), [], RouteAuth::Required, Action::FinanceExecute),\n", '')), expect: 'Finance execution route POST /api/finance-executions/execute is missing' });
  cases.push({ name: 'a missing Finance execution month read is caught', run: () => checkRouteActions(realRoutes.replace("            new Route('GET', '/api/finance-executions', $financeExecutions->month(...), ['month'], RouteAuth::Required),\n", '')), expect: 'Finance execution month read' });
  cases.push({ name: 'an Action on the Finance execution month read is caught', run: () => checkRouteActions(realRoutes.replace("$financeExecutions->month(...), ['month'], RouteAuth::Required)", "$financeExecutions->month(...), ['month'], RouteAuth::Required, Action::FinanceExecute)")), expect: 'Finance execution month read' });
  cases.push({ name: 'finance.execute on a posting route is caught', run: () => checkRouteActions(realRoutes.replace("$finance->postSupplementalPayroll(...), [], RouteAuth::Required, Action::SupplementalManage)", "$finance->postSupplementalPayroll(...), [], RouteAuth::Required, Action::FinanceExecute)")), expect: 'must not declare Action::FinanceExecute' });
  cases.push({ name: 'a batch execution route is caught', run: () => checkRouteActions(realRoutes.replace("            new Route('GET', '/api/finance-executions',", "            new Route('POST', '/api/finance-executions/batch', $financeExecutions->execute(...), [], RouteAuth::Required, Action::FinanceExecute),\n            new Route('GET', '/api/finance-executions',")), expect: 'the only Finance routes' });
  cases.push({ name: 'an execution reversal route is caught', run: () => checkRouteActions(realRoutes.replace("            new Route('GET', '/api/finance-executions',", "            new Route('POST', '/api/finance-executions/reverse', $financeExecutions->execute(...), [], RouteAuth::Required, Action::FinanceManage),\n            new Route('GET', '/api/finance-executions',")), expect: 'the only Finance routes' });
  cases.push({ name: 'payroll.manage on another route is caught', run: () => checkRouteActions(realRoutes.replace("$overtime->reject(...), [], RouteAuth::Required, Action::OvertimeManage)", "$overtime->reject(...), [], RouteAuth::Required, Action::PayrollManage)")), expect: 'must not declare Action::PayrollManage' });
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

  // OPS-1: backups are operator tooling — CLI, surface, crypto, file deletion, host-never-decrypts,
  // the read-only reader and the table classification.
  clean('backup.php with its CLI guard passes', BACKUP_CLI, S + "if (PHP_SAPI !== 'cli') { exit(1); }\nrequire dirname(__DIR__) . '/src/bootstrap.php';\n$c = new BackupCreator(BackupReader::fromConfig($x), $s, $k, $e, $d);\n");
  dirty('backup.php without the CLI guard is caught', BACKUP_CLI, S + "require dirname(__DIR__) . '/src/bootstrap.php';\n", 'non-CLI SAPI');
  dirty('SQL inside backup.php is caught', BACKUP_CLI, S + "if (PHP_SAPI !== 'cli') { exit(1); }\n$q = 'SELECT * FROM users WHERE id = 1';\n", 'SQL');
  treeCase('another CLI (a restore) is caught', ['server/bin/restore.php'], 'server/bin/ holds only');
  dirty('a controller naming the backup creator is caught (no HTTP surface)', 'server/src/Controller/BackupController.php', S + "final class BackupController { public function f(BackupCreator $c): void {} }\n", 'no HTTP surface');
  dirty('a route naming the backup store is caught', ROUTES_FILE, S + "$s = BackupStore::open($d, $r);\n", 'no HTTP surface');
  dirty('the kernel naming the verifier is caught', KERNEL_FILE, S + "$v = new BackupVerifier($k);\n", 'no HTTP surface');
  clean('the Ops classes name each other and the reader', 'server/src/Ops/BackupCreator.php', S + "final class BackupCreator { public function __construct(private BackupReader $r, private BackupStore $s) {} }\n");
  clean('libsodium inside the cipher passes', BACKUP_CIPHER, S + "$k = sodium_crypto_secretstream_xchacha20poly1305_keygen(); $t = SODIUM_CRYPTO_SECRETSTREAM_XCHACHA20POLY1305_TAG_FINAL;\n");
  dirty('libsodium outside the cipher is caught', BACKUP_STORE, S + "$s = sodium_crypto_box_seal($k, $p);\n", 'libsodium is used only');
  dirty('a libsodium constant outside the cipher is caught', 'server/src/Auth/SessionToken.php', S + "$n = SODIUM_CRYPTO_BOX_SEALBYTES;\n", 'libsodium is used only');
  clean('the store deletes and renames its own files', BACKUP_STORE, S + "unlink($p); rename($a, $b);\n");
  dirty('unlink outside the store is caught', 'server/src/Ops/BackupCreator.php', S + "unlink($p);\n", 'deleted or renamed only');
  dirty('rename outside the store is caught', 'server/src/Log/Logger.php', S + "rename($a, $b);\n", 'deleted or renamed only');
  dirty('rmdir anywhere else is caught', 'server/bin/backup.php', S + "if (PHP_SAPI !== 'cli') { exit(1); }\nrmdir($d);\n", 'deleted or renamed only');
  clean('a method named unlink, and its call, are not file deletion', 'server/src/Data/Employee/EmployeeStore.php', S + "final class S { public function unlink(Authorization $auth): int { return 0; } }\n$store->unlink($auth);\n");
  dirty('the create path reading the secret key is caught', 'server/src/Ops/BackupCreator.php', S + "$k = BackupCipher::readSecretKeyFile($f);\n", 'never names the secret key');
  dirty('the create path decrypting is caught', 'server/src/Ops/BackupCreator.php', S + "BackupCipher::open($in, $k, $sink);\n", 'never names the secret key');
  dirty('the store naming the verifier is caught', BACKUP_STORE, S + "$v = new BackupVerifier($k);\n", 'never names the secret key');
  dirty('the reader deriving a public key is caught', BACKUP_READER, S + "$p = BackupCipher::publicKeyOf($k);\n", 'never names the secret key');
  clean('the verifier opens backups off-host', 'server/src/Ops/BackupVerifier.php', S + "$h = BackupCipher::open($in, $this->secretKey, $sink);\n");
  clean('the backup reader reads every table, company tables included, with fixed SELECTs', BACKUP_READER, S + "const P = ['employees' => 'SELECT * FROM employees WHERE id > :after ORDER BY id LIMIT 500'];\nconst L = \"SELECT GET_LOCK('tamos_backup', 0) AS acquired\";\nconst C = 'SELECT COUNT(*) AS n FROM audit_events';\n");
  dirty('a write in the backup reader is caught', BACKUP_READER, S + "const Q = 'INSERT INTO auth_events (id) VALUES (:id)';\n", 'SELECT statements only');
  dirty('a delete in the backup reader is caught', BACKUP_READER, S + "const Q = 'DELETE FROM sessions WHERE token_hash = :h';\n", 'SELECT statements only');
  dirty('a locking read in the backup reader is caught', BACKUP_READER, S + "const Q = 'SELECT * FROM users WHERE id > :after FOR UPDATE';\n", 'SELECT statements only');
  dirty('a shared-lock read in the backup reader is caught', BACKUP_READER, S + "const Q = 'SELECT * FROM users LOCK IN SHARE MODE';\n", 'SELECT statements only');
  dirty('file output from the backup reader is caught', BACKUP_READER, S + "const Q = 'SELECT * FROM users INTO OUTFILE :f';\n", 'SELECT statements only');
  dirty('the backup reader taking the migration lock directly is caught', BACKUP_READER, S + "const Q = \"SELECT GET_LOCK('tamos_migrate', 0) AS a\";\n", 'only the tamos_backup advisory lock');
  dirty('another file in Data/Backup is caught', 'server/src/Data/Backup/BackupWriter.php', S + "final class BackupWriter {}\n", 'holds only BackupReader.php');
  dirty('a business store still may not skip :company_id', 'server/src/Data/Employee/EmployeeStore.php', S + "const Q = 'SELECT * FROM employees WHERE id > :after';\n", ':company_id');
  {
    const tablesSrc = (inc, exc, app) => S + 'final class BackupTables {\n    public const INCLUDED = [' + inc.map((t) => "'" + t + "'").join(', ') + '];\n    public const EXCLUDED = [' + exc.map((t) => "'" + t + "'").join(', ') + '];\n    public const APPEND_ONLY = [' + app.map((t) => "'" + t + "'").join(', ') + '];\n}\n';
    const readerSrc = (tables, page = (t) => 'SELECT * FROM ' + t + ' WHERE id > :after ORDER BY id LIMIT 500') => S + '    private const PAGE_SQL = [\n' + tables.map((t) => "        '" + t + "' => '" + page(t) + "',\n").join('') + '    ];\n    private const COUNT_SQL = [\n' + tables.map((t) => "        '" + t + "' => 'SELECT COUNT(*) AS n FROM " + t + "',\n").join('') + '    ];\n';
    const migs = ['CREATE TABLE companies (\n  id CHAR(32)\n)', 'CREATE TABLE users (\n  id CHAR(32)\n)', 'CREATE TABLE auth_events (\n  id BIGINT\n)', 'CREATE TABLE audit_events (\n  id BIGINT,\n  CONSTRAINT f FOREIGN KEY (company_id) REFERENCES companies (id)\n)',
      'CREATE TABLE sessions (x INT)', 'CREATE TABLE account_tokens (x INT)', 'CREATE TABLE auth_rate_limits (x INT)', 'CREATE TABLE mail_outbox (x INT)', 'CREATE TABLE schema_migrations (x INT)'];
    const inc = ['companies', 'users', 'auth_events', 'audit_events'];
    const exc = ['account_tokens', 'auth_rate_limits', 'mail_outbox', 'sessions'];
    const app = ['auth_events', 'audit_events'];
    const tables = (name, t, r, m, expect) => cases.push({ name, run: () => checkBackupTables(t, r, m), expect });
    tables('a complete backup classification passes', tablesSrc(inc, exc, app), readerSrc(inc), migs, 0);
    tables('an unclassified new table is caught', tablesSrc(inc, exc, app), readerSrc(inc), [...migs, 'CREATE TABLE invoices (id CHAR(32))'], 'classified for backup exactly once');
    tables('a table both backed up and excluded is caught', tablesSrc([...inc, 'sessions'], exc, app), readerSrc([...inc, 'sessions']), migs, 'classified for backup exactly once');
    tables('a classified table no migration creates is caught', tablesSrc([...inc, 'ghosts'], exc, app), readerSrc([...inc, 'ghosts']), migs, 'which no migration creates');
    tables('moving sessions into the backup is caught (D-AB-7)', tablesSrc([...inc, 'sessions'], exc.filter((t) => t !== 'sessions'), app), readerSrc([...inc, 'sessions']), migs, 'EXCLUDED is exactly');
    tables('a drifted append-only list is caught', tablesSrc(inc, exc, ['audit_events']), readerSrc(inc), migs, 'APPEND_ONLY is exactly');
    tables('a foreign-key-unsafe order is caught', tablesSrc(['audit_events', 'companies', 'users', 'auth_events'], exc, app), readerSrc(['audit_events', 'companies', 'users', 'auth_events']), migs, 'not foreign-key safe');
    tables('a late ALTER TABLE reference is honoured', tablesSrc(inc, exc, app), readerSrc(inc), [...migs, 'ALTER TABLE companies ADD CONSTRAINT g FOREIGN KEY (u) REFERENCES users (id)'], 'not foreign-key safe');
    tables('a reader missing a table is caught', tablesSrc(inc, exc, app), readerSrc(inc.slice(0, 3)), migs, 'covers exactly');
    tables('a reader statement that drifts is caught', tablesSrc(inc, exc, app), readerSrc(inc, (t) => 'SELECT * FROM ' + t + ' ORDER BY id'), migs, 'must be exactly');
    tables('the real classification passes against the real migrations', fs.readFileSync(path.join(root, BACKUP_TABLES_FILE), 'utf8'), fs.readFileSync(path.join(root, BACKUP_READER), 'utf8'),
      fs.readdirSync(path.join(root, 'server', 'migrations')).filter((f) => f.endsWith('.sql')).map((f) => fs.readFileSync(path.join(root, 'server', 'migrations', f), 'utf8')), 0);
  }

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
