#!/usr/bin/env node
/*
 * verify-backend-boundary.js — TAM OS (Backend Foundation, BF-1)
 * -----------------------------------------------------------------
 * Static enforcement of the backend's architectural boundary (ADR-0004 §2.3, SDR-0002 §8.2).
 * MariaDB has no Row-Level Security, so "SQL and database access exist only in the data-access
 * layer" must be a mechanical rule, not a convention. This tool fails the build when:
 *
 *   - PDO, mysqli, ->query/->exec/->prepare or SQL statements appear outside server/src/Data/
 *     (the future data-access layer; BF-1 has none, and the slice gate below keeps it absent);
 *   - production PHP uses eval, process execution, unserialize, extract, phpinfo, var_dump,
 *     print_r, session_start, setcookie, CORS headers, or request superglobals outside the one
 *     class allowed to read them;
 *   - a PHP file lacks declare(strict_types=1);
 *   - a Composer manifest, vendor tree, .sql file or .env appears under server/;
 *   - more than one PrincipalResolver implementation exists (BF-1: NullPrincipalResolver only);
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

const root = path.resolve(__dirname, '..');
const SERVER = 'server';
const DATA_DIR = 'server/src/Data/';
// BF-1 slice gate: these arrive with later, separately authorized slices (BF-2 data layer,
// migrations; the authorization milestone for Policy). Remove an entry only in that slice.
const NOT_YET_AUTHORIZED = ['server/src/Data', 'server/migrations', 'server/bin', 'server/src/Policy'];
const SUPERGLOBAL_READERS = new Set(['server/src/Http/Request.php', 'server/dev/router.php']);
const HEADER_EMITTERS = new Set(['server/src/Http/Response.php', 'server/src/bootstrap.php']);
const INI_WRITERS = new Set(['server/src/bootstrap.php']);
// The autoloader (validated class path) and the config loader are the only variable includes.
const INCLUDE_ALLOWED = new Set(['server/src/bootstrap.php', 'server/src/Config/ConfigLoader.php']);
const RESOLVER_ALLOWED = 'server/src/Identity/NullPrincipalResolver.php';
const LOCAL_CONFIG = /^server\/config\/config\.local\.php$/;

// ---------------------------------------------------------------------------------------------
// A small PHP lexer: splits source into code (comments removed, strings blanked) and the list
// of string-literal contents. Heredoc/nowdoc are rejected outright so the lexer stays sound.
// ---------------------------------------------------------------------------------------------
function lexPhp(src) {
  let code = '';
  const strings = [];
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
      code += c + src.slice(i + 1, j).replace(/[^\n]/g, ' ') + c;
      i = j + 1;
      continue;
    }
    code += c;
    i++;
  }
  return { code, strings, heredoc };
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
  { id: 'cookie', re: /(?<![\w$>:])set(raw)?cookie\s*\(/i, msg: 'setting cookies is not authorized in BF-1' },
  { id: 'dynamic-include', re: /\b(include|include_once|require|require_once)\b\s*\(?\s*\$/i, msg: 'include/require of a variable path is forbidden', allow: (f) => INCLUDE_ALLOWED.has(f) },
];
const DATA_RULES = [
  { id: 'pdo', re: /\bPDO\b|\bPDOStatement\b/, msg: 'PDO is allowed only in ' + DATA_DIR },
  { id: 'mysqli', re: /\bmysqli\b|(?<![\w$>:])mysqli?_[a-z_]+\s*\(/i, msg: 'mysqli/mysql functions are allowed only in ' + DATA_DIR },
  { id: 'db-method', re: /->\s*(query|exec|prepare)\s*\(/i, msg: '->query/->exec/->prepare are allowed only in ' + DATA_DIR },
];
// SELECT needs SQL shape after FROM (end of string, `;`, or a clause keyword), so prose such as
// "Select a principal from the list" is not mistaken for a query.
const SQL_STRING = /^\s*(SELECT\s+[\s\S]+?\s+FROM\s+[`\w.]+\s*(;|$|\b(WHERE|JOIN|INNER|LEFT|RIGHT|ORDER|GROUP|LIMIT|FOR|AS|UNION)\b)|INSERT\s+(IGNORE\s+)?INTO\b|UPDATE\s+[`\w.]+\s+SET\b|DELETE\s+FROM\b|REPLACE\s+INTO\b|(CREATE|ALTER|DROP)\s+(TEMPORARY\s+)?(TABLE|DATABASE|SCHEMA|INDEX|VIEW|USER|TRIGGER|PROCEDURE|FUNCTION)\b|TRUNCATE\s+(TABLE\s+)?[`\w]|GRANT\s+\w|REVOKE\s+\w|LOCK\s+TABLES?\b|SET\s+(NAMES|SESSION|GLOBAL|TRANSACTION)\b|(START\s+TRANSACTION|BEGIN\s+WORK)\b)/i;
const STRING_RULES = [
  { id: 'cors', re: /access-control-allow/i, msg: 'CORS headers are forbidden (SDR-0002 §13.2)' },
  { id: 'php-input', re: /^php:\/\/input$/i, msg: 'php://input is read only by server/src/Http/Request.php', allow: (f) => f === 'server/src/Http/Request.php' },
];
const SECRET_RULES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/,
];

function isProductionPhp(file) {
  return file.startsWith('server/src/') || file.startsWith('server/public/') || file.startsWith('server/dev/') || file.startsWith('server/config/');
}

function checkPhp(file, src) {
  const out = [];
  if (!/^<\?php\s+(\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*declare\(strict_types=1\);/.test(src)) {
    out.push('missing declare(strict_types=1) as the first statement');
  }
  for (const re of SECRET_RULES) if (re.test(src)) out.push('secret-shaped value: ' + re);
  const lex = lexPhp(src);
  if (lex.heredoc) out.push('heredoc/nowdoc is forbidden (keeps the boundary check sound)');
  if (!isProductionPhp(file)) return out; // tests may spawn processes, dump values and name CORS headers
  const inData = file.startsWith(DATA_DIR);
  for (const r of CODE_RULES) if (!(r.allow && r.allow(file)) && r.re.test(lex.code)) out.push(r.msg);
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
  if (file !== RESOLVER_ALLOWED && /\bimplements\b[^{]*\bPrincipalResolver\b/.test(lex.code)) {
    out.push('BF-1 permits exactly one PrincipalResolver (NullPrincipalResolver); an identity-producing resolver needs the authentication milestone');
  }
  return out;
}

function checkTree(files, dirs = []) {
  const out = [];
  for (const p of [...files, ...dirs]) {
    for (const gate of NOT_YET_AUTHORIZED) {
      if (p === gate || p.startsWith(gate + '/')) out.push(p + ': ' + gate + ' is not authorized in BF-1');
    }
  }
  for (const f of files) {
    const base = path.posix.basename(f);
    if (/^composer\.(json|lock)$/.test(base) || f.includes('/vendor/')) out.push(f + ': Composer/vendor code is not authorized (SDR-0002 §15)');
    if (/\.sql$/i.test(f)) out.push(f + ': .sql files belong only to the future server/migrations/');
    if (/^\.env/.test(base) || /\.(phar|pem|key)$/i.test(base)) out.push(f + ': forbidden file type');
    if (!/\.php$/.test(f) && f !== 'server/public/api/.htaccess') out.push(f + ': unexpected file type under server/');
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
  const contract = require('./package-headers.js');
  for (const v of checkParity(fs.readFileSync(path.join(root, 'server/src/Http/ApiHeaders.php'), 'utf8'), contract)) failures.push(v);
  const ignored = gitIgnored(onDisk);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', SERVER]).split('\n').filter(Boolean);
  for (const v of checkGitHygiene(onDisk, ignored, untracked)) failures.push(v);

  const dedup = [...new Set(failures)];
  if (dedup.length) {
    console.error('BACKEND BOUNDARY FAILED -- ' + dedup.length + ' violation(s):');
    for (const v of dedup) console.error('  - ' + v);
    process.exit(1);
  }
  console.log('BACKEND BOUNDARY PASSED -- ' + files.length + ' files (' + php + ' PHP) checked; API header mirror matches tools/package-headers.js.');
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
  clean('NullPrincipalResolver is the one resolver', RESOLVER_ALLOWED, S + 'final class NullPrincipalResolver implements PrincipalResolver {}\n');

  dirty('missing strict_types is caught', 'server/src/X.php', "<?php\nfinal class X {}\n", 'strict_types');
  dirty('strict_types after code is caught', 'server/src/X.php', "<?php\necho 1;\ndeclare(strict_types=1);\n", 'strict_types');
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
  dirty('a second PrincipalResolver is caught', 'server/src/Identity/CeoResolver.php', S + 'final class CeoResolver implements PrincipalResolver {}\n', 'PrincipalResolver');
  dirty('heredoc is caught', 'server/src/X.php', S + "\$a = <<<EOT\nSELECT 1\nEOT;\n", 'heredoc');
  dirty('a private key is caught (tests too)', 'server/tests/T.php', S + "\$k = '-----BEGIN RSA PRIVATE KEY-----';\n", 'secret');
  dirty('a GitHub token is caught', 'server/config/config.example.php', S + "return ['t' => 'ghp_" + 'a'.repeat(36) + "'];\n", 'secret');

  const treeCase = (name, files, needle) => cases.push({ name, run: () => checkTree(files), expect: needle });
  cases.push({ name: 'a clean tree passes', run: () => checkTree(['server/src/X.php', 'server/public/api/.htaccess'], ['server/src']), expect: 0 });
  treeCase('server/src/Data (BF-2) is gated', ['server/src/Data/Database.php'], 'not authorized');
  treeCase('server/migrations is gated', ['server/migrations/0000_init.sql'], 'not authorized');
  cases.push({ name: 'server/src/Policy is gated', run: () => checkTree([], ['server/src/Policy']), expect: 'not authorized' });
  dirty('a variable include outside the allow-list is caught', 'server/src/Http/X.php', S + 'require $file;\n', 'include');
  clean('prose that reads like SELECT…FROM is not SQL', 'server/src/X.php', S + "\$m = 'Select a principal from the list above';\n");
  treeCase('composer.json is caught', ['server/composer.json'], 'Composer');
  treeCase('a vendor tree is caught', ['server/vendor/autoload.php'], 'Composer');
  treeCase('a stray .sql file is caught', ['server/src/schema.sql'], '.sql');
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
  cases.push({ name: 'the real .gitignore ignores a *secret* file name (trap is real)', run: () => (gitIgnored(['server/src/SecretStore.php']).length === 1 ? [] : ['not ignored']), expect: 0 });
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
