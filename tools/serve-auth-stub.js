#!/usr/bin/env node
/*
 * serve-auth-stub.js — TAM OS (AFI-2, owner decision D-B)
 * -----------------------------------------------------------------
 * TEST-ONLY. A loopback-only server for browser QA of the SESSION-mode auth views. It
 * serves dist/package/ under the production header contract (tools/package-headers.js),
 * except that js/core/constants.js is served IN MEMORY with AUTH_MODE set to SESSION —
 * nothing on disk changes and the shipped package stays LOCAL. /api/auth/me, /login and
 * /logout answer with the canonical envelope and the AuthController projection, from a
 * deterministic scenario held in memory.
 *
 * It is NOT a backend: no database, no PHP, no real credentials, no real cookie session
 * (the HttpOnly cookie is invisible to the page anyway, so the stub keeps one in-memory
 * session instead). Real PHP + MariaDB authenticated E2E is still required before AFI-5.
 * It is never deployed, never part of the package and never a runtime dependency.
 *
 * Usage:  node tools/build-package.js && node tools/serve-auth-stub.js [port]   (default 8767)
 *
 * Scenario (GET switches it; the in-memory session resets on every switch):
 *   /__stub/scenario/signed-out          /me 401 until a login (default)
 *   /__stub/scenario/ceo                 already signed in as CEO
 *   /__stub/scenario/employee            already signed in as Employee
 *   /__stub/scenario/me-unavailable      /me 503
 *   /__stub/scenario/me-malformed        /me 200 with an unknown role
 *   /__stub/scenario/login-rate-limited  login 429 with Retry-After: 120
 *   /__stub/scenario/logout-stale-csrf   the first logout answers 403 and rotates the CSRF token
 *   /__stub/scenario/logout-unavailable  logout 503
 * Fabricated test login (stub only): ceo@example.invalid / stub-only-password
 * (employee@example.invalid signs in as Employee); anything else is 401.
 *
 * AFI-3 credential flows (POST /api/auth/activate, /forgot-password, /reset-password).
 * Fabricated one-time links (stub only; each token works once per scenario switch):
 *   /#activation=stub-activation-token-aaaaaaaaaaaaaaaaaaaaa
 *   /#recovery=stub-recovery-token-rrrrrrrrrrrrrrrrrrrrrrr
 * Any other well-formed token answers 400 fields:[token], as the backend does for every
 * invalid, expired, used or revoked token. A new password under 12 characters answers
 * 400 fields:[password]. forgot-password answers the one generic 200 for every address.
 *   /__stub/scenario/link-invalid         activate / reset: 400 token for every token
 *   /__stub/scenario/password-policy      activate / reset: 400 password
 *   /__stub/scenario/forgot-rate-limited  forgot-password 429 with Retry-After: 900
 *   /__stub/scenario/reset-rate-limited   activate / reset 429 with Retry-After: 300
 *   /__stub/scenario/recovery-unavailable activate / forgot / reset 503
 *   /__stub/scenario/recovery-malformed   activate / forgot / reset 200 with a malformed body
 *
 * AFI-4a1 read-only Employee workspace (GET /api/employees[?archived=1], GET /api/employee?id=),
 * scoped like the server: the CEO lists and reads the fabricated company records below; an
 * Employee is 403 on the list and reads only their own record (any other id is 404). These
 * records are fabricated and live only in this process.
 *   /__stub/scenario/employees-unavailable  the Employee reads answer 503
 *   /__stub/scenario/employee-self-missing  signed in as Employee; their own record answers 404
 *   /__stub/scenario/employees-session-lost signed in as CEO; the Employee reads answer 401
 *
 * AFI-4a2 CEO writes (POST /api/employees/create, /update, /archive): RouteAuth::Required, same
 * origin, JSON, X-CSRF-Token equal to the session token (else 403), CEO only (an Employee is
 * 403), exact body keys, the EmployeeInput value rules, server ids, version compare-and-swap;
 * a duplicate employee code, an archived record and a record with an active login are 409; a
 * changed update bumps the version, a no-op update does not; archive is soft. The records are
 * copied afresh on every scenario switch. TEST-ONLY: none of this is production logic. Each
 * scenario below signs in as CEO and applies to the writes only (reads stay normal):
 *   /__stub/scenario/write-validation   400 fields:[employeeCode]
 *   /__stub/scenario/write-session-lost 401 (the session ends)
 *   /__stub/scenario/write-denied       403 with the CSRF token unchanged (a genuine denial)
 *   /__stub/scenario/write-stale-csrf   the first write answers 403 and rotates the CSRF token
 *   /__stub/scenario/write-conflict     409
 *   /__stub/scenario/write-rate-limited 429 with Retry-After: 45
 *   /__stub/scenario/write-error        500 (nothing applied)
 *   /__stub/scenario/write-unavailable  503 (nothing applied — the browser cannot know that)
 *   /__stub/scenario/write-malformed    the write IS applied, then answered 200 with a malformed body
 *   /__stub/scenario/write-slow         the write is answered after 4 seconds
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { STATIC_HEADERS, API_HEADERS } = require('./package-headers.js');

const pkgRoot = path.resolve(__dirname, '..', 'dist', 'package');
const port = Number(process.argv[2]) || 8767;
const ORIGIN = 'http://127.0.0.1:' + port;
const MODE_LINE = 'const AUTH_MODE = AUTH_MODES.LOCAL;';
const STUB_PASSWORD = 'stub-only-password';
const USERS = {
  'ceo@example.invalid': { userId: 'u_stub_ceo', membershipId: 'm_stub_ceo', role: 'ceo', employeeId: null },
  'employee@example.invalid': { userId: 'u_stub_emp', membershipId: 'm_stub_emp', role: 'employee', employeeId: 'emp_stub_1' }
};
const SCENARIOS = ['signed-out', 'ceo', 'employee', 'me-unavailable', 'me-malformed', 'login-rate-limited', 'logout-stale-csrf', 'logout-unavailable',
  'link-invalid', 'password-policy', 'forgot-rate-limited', 'reset-rate-limited', 'recovery-unavailable', 'recovery-malformed',
  'employees-unavailable', 'employee-self-missing', 'employees-session-lost',
  'write-validation', 'write-session-lost', 'write-denied', 'write-stale-csrf', 'write-conflict', 'write-rate-limited', 'write-error', 'write-unavailable',
  'write-malformed', 'write-slow'];
// AFI-4a1 fabricated company records (the CEO detail DTO; the list and self views are projections).
const STUB_EMPLOYEES = [
  { id: 'emp_stub_1', employeeCode: 'EMP-001', fullName: 'Fabricated Employee One', jobTitle: 'Engineer', department: 'Operations', employmentStatus: 'Active',
    archived: false, accountState: 'active', joinDate: '2026-01-05', contactEmail: 'one@example.invalid', phone: '0812 000 001',
    notes: 'Fabricated note <script>not run</script>', monthlyBaseSalary: '7500000.00', version: 2 },
  { id: 'emp_stub_2', employeeCode: 'EMP-002', fullName: 'Fabricated Employee Two', jobTitle: null, department: null, employmentStatus: 'On Leave',
    archived: false, accountState: 'none', joinDate: null, contactEmail: null, phone: null, notes: null, monthlyBaseSalary: null, version: 1 },
  { id: 'emp_stub_3', employeeCode: 'EMP-003', fullName: 'Fabricated Former Employee', jobTitle: 'Analyst', department: 'Operations', employmentStatus: 'Resigned',
    archived: true, accountState: 'disabled', joinDate: '2025-03-01', contactEmail: null, phone: null, notes: null, monthlyBaseSalary: '6000000.00', version: 4 }
];
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const LIST_KEYS = ['id', 'employeeCode', 'fullName', 'jobTitle', 'department', 'employmentStatus', 'archived', 'accountState'];
// AFI-4a2: EmployeeInput::FIELDS and STATUSES (test-only mirror).
const WRITABLE = ['employeeCode', 'fullName', 'jobTitle', 'department', 'employmentStatus', 'joinDate', 'contactEmail', 'phone', 'notes', 'monthlyBaseSalary'];
const STATUSES = ['Active', 'Inactive', 'On Leave', 'Resigned', 'Terminated'];
const SELF_KEYS = ['id', 'employeeCode', 'fullName', 'jobTitle', 'department', 'employmentStatus', 'joinDate', 'contactEmail', 'phone', 'monthlyBaseSalary'];
// AFI-3 fabricated one-time tokens (43 base64url characters, the server shape).
const STUB_TOKENS = { activation: 'stub-activation-token-' + 'a'.repeat(21), recovery: 'stub-recovery-token-' + 'r'.repeat(23) };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '': 'text/plain; charset=utf-8' };

let scenario = 'signed-out';
let session = null;            // { user, csrf, staleOnce }
let usedTokens = [];           // AFI-3: tokens consumed since the last scenario switch
let employees = [];            // AFI-4a2: this scenario's copy of STUB_EMPLOYEES

const token = () => crypto.randomBytes(32).toString('base64url');        // 43 characters, the server shape
const rid = () => crypto.randomBytes(16).toString('hex');
function reset(name){
  scenario = name;
  usedTokens = [];
  employees = STUB_EMPLOYEES.map((e) => ({ ...e }));
  session = (name === 'ceo' || name === 'me-malformed' || name === 'employees-session-lost' || name === 'employees-unavailable' || name.startsWith('write-')) ? { user: USERS['ceo@example.invalid'], csrf: token() }
    : (name === 'employee' || name === 'employee-self-missing') ? { user: USERS['employee@example.invalid'], csrf: token() } : null;
}
function api(res, status, payload, extra, fields){
  const id = rid();
  const body = status < 300 ? { ok: true, data: payload, requestId: id }
    : { ok: false, error: Object.assign({ code: payload, message: 'stub' }, fields ? { fields: fields } : {}), requestId: id };
  res.writeHead(status, { ...API_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'X-Request-Id': id, ...(extra || {}) });
  res.end(JSON.stringify(body));
}
function readJson(req){
  return new Promise((resolve) => {
    let raw = ''; req.on('data', (c) => { raw += c; if(raw.length > 16384) req.destroy(); });
    req.on('end', () => { try { const v = JSON.parse(raw); resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : null); } catch(_e){ resolve(null); } });
  });
}

async function handleApi(req, res, p, query){
  const mutation = req.method !== 'GET' && req.method !== 'HEAD';
  if(mutation){
    if(req.headers.origin !== ORIGIN) return api(res, 403, 'forbidden');                 // same-origin only
    if(!/^application\/json\b/i.test(req.headers['content-type'] || '')) return api(res, 415, 'unsupported_media_type');
  }
  if(p === '/api/auth/me' && (req.method === 'GET' || req.method === 'HEAD')){
    if(scenario === 'me-unavailable') return api(res, 503, 'service_unavailable');
    if(!session) return api(res, 401, 'unauthenticated');
    const projection = { ...session.user, csrfToken: session.csrf };
    if(scenario === 'me-malformed') projection.role = 'superuser';
    return api(res, 200, projection);
  }
  if(p === '/api/auth/login' && req.method === 'POST'){
    const b = await readJson(req);
    if(!b || Object.keys(b).sort().join() !== 'email,password' || typeof b.email !== 'string' || typeof b.password !== 'string') return api(res, 400, 'validation_failed');
    if(scenario === 'login-rate-limited') return api(res, 429, 'rate_limited', { 'Retry-After': '120' });
    const user = USERS[b.email.trim().toLowerCase()];
    if(!user || b.password !== STUB_PASSWORD) return api(res, 401, 'unauthenticated');
    session = { user: user, csrf: token(), staleOnce: scenario === 'logout-stale-csrf' };
    return api(res, 200, { ...user, csrfToken: session.csrf });
  }
  if(p === '/api/auth/logout' && req.method === 'POST'){
    const b = await readJson(req);
    if(!b || Object.keys(b).length !== 0) return api(res, 400, 'validation_failed');
    if(scenario === 'logout-unavailable') return api(res, 503, 'service_unavailable');
    if(session){
      if(session.staleOnce){ session.staleOnce = false; session.csrf = token(); return api(res, 403, 'forbidden'); }  // another tab rotated it
      if(req.headers['x-csrf-token'] !== session.csrf) return api(res, 403, 'forbidden');
    }
    session = null;
    return api(res, 200, { loggedOut: true });
  }
  // AFI-4a1 Employee reads: RouteAuth::Required, scoped by the session principal, exact query keys.
  if((p === '/api/employees' || p === '/api/employee') && req.method === 'GET'){
    if(!session) return api(res, 401, 'unauthenticated');
    if(scenario === 'employees-session-lost'){ session = null; return api(res, 401, 'unauthenticated'); }
    if(scenario === 'employees-unavailable') return api(res, 503, 'service_unavailable');
    const keys = [...query.keys()];
    const ceo = session.user.role === 'ceo';
    if(p === '/api/employees'){
      if(keys.some((k) => k !== 'archived') || (query.has('archived') && query.get('archived') !== '1')) return api(res, 400, 'invalid_query');
      if(!ceo) return api(res, 403, 'forbidden');
      const all = query.get('archived') === '1';
      return api(res, 200, { employees: employees.filter((e) => all || !e.archived).map((e) => pick(e, LIST_KEYS)) });
    }
    if(keys.join() !== 'id' || !/^[A-Za-z0-9_-]{1,64}$/.test(query.get('id') || '')) return api(res, 400, 'validation_failed', null, ['id']);
    const id = query.get('id');
    if(ceo){
      const e = employees.find((x) => x.id === id);
      return e ? api(res, 200, { employee: e }) : api(res, 404, 'not_found');
    }
    if(scenario === 'employee-self-missing' || id !== session.user.employeeId) return api(res, 404, 'not_found');
    return api(res, 200, { employee: pick(employees[0], SELF_KEYS) });
  }
  // AFI-4a2 Employee writes (test-only model of BF-4a1; see the header).
  const write = { '/api/employees/create': 'create', '/api/employees/update': 'update', '/api/employees/archive': 'archive' }[p];
  if(write && req.method === 'POST') return handleWrite(req, res, write);
  // AFI-3 credential flows: RouteAuth::None on the server — no session, no CSRF.
  if(p === '/api/auth/forgot-password' && req.method === 'POST'){
    const b = await readJson(req);
    if(!b || Object.keys(b).join() !== 'email' || typeof b.email !== 'string') return api(res, 400, 'validation_failed', null, ['email']);
    if(scenario === 'forgot-rate-limited') return api(res, 429, 'rate_limited', { 'Retry-After': '900' });
    if(scenario === 'recovery-unavailable') return api(res, 503, 'service_unavailable');
    if(scenario === 'recovery-malformed') return api(res, 200, { requested: 'yes' });
    return api(res, 200, { requested: true });                                            // every address alike
  }
  const purpose = p === '/api/auth/activate' ? 'activation' : p === '/api/auth/reset-password' ? 'recovery' : null;
  if(purpose && req.method === 'POST'){
    const b = await readJson(req);
    if(!b || Object.keys(b).sort().join() !== 'password,token' || typeof b.token !== 'string' || typeof b.password !== 'string') return api(res, 400, 'validation_failed', null, ['token', 'password']);
    if(scenario === 'recovery-unavailable') return api(res, 503, 'service_unavailable');
    if(scenario === 'recovery-malformed') return api(res, 200, { done: true });
    if(scenario === 'password-policy' || Array.from(b.password).length < 12) return api(res, 400, 'validation_failed', null, ['password']);
    if(scenario === 'reset-rate-limited') return api(res, 429, 'rate_limited', { 'Retry-After': '300' });
    if(scenario === 'link-invalid' || b.token !== STUB_TOKENS[purpose] || usedTokens.indexOf(b.token) !== -1) return api(res, 400, 'validation_failed', null, ['token']);
    usedTokens.push(b.token);
    session = null;                                    // every session of the user ends; none is created
    return api(res, 200, purpose === 'activation' ? { activated: true } : { reset: true });
  }
  return api(res, 404, 'not_found');
}

/* ---------- AFI-4a2: the Employee writes (test-only) ---------- */
// One EmployeeInput value: the normalized value, or undefined when it is not acceptable.
function fieldValue(k, v){
  const text = (max, required, multiline) => {
    if(v === null && !required) return null;
    if(typeof v !== 'string') return undefined;
    const t = v.trim();
    if(t === '') return required ? undefined : null;
    if((multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/ : /[\u0000-\u001F\u007F-\u009F]/).test(t) || Array.from(t).length > max) return undefined;
    return t;
  };
  const opt = (accept, norm) => {
    if(v === null) return null;
    if(typeof v !== 'string') return undefined;
    const t = v.trim();
    if(t === '') return null;
    return accept(t) ? (norm ? norm(t) : t) : undefined;
  };
  switch(k){
    case 'employeeCode': return text(32, true);
    case 'fullName': return text(160, true);
    case 'jobTitle': case 'department': return text(120, false);
    case 'notes': return text(2000, false, true);
    case 'employmentStatus': return STATUSES.indexOf(v) !== -1 ? v : undefined;
    case 'joinDate': return opt((t) => /^\d{4}-\d{2}-\d{2}$/.test(t) && +t.slice(0, 4) >= 1900 && !isNaN(Date.parse(t + 'T00:00:00Z')) && new Date(t + 'T00:00:00Z').toISOString().slice(0, 10) === t);
    case 'contactEmail': return opt((t) => /^[\x21-\x7E]+$/.test(t) && /^[^@]+@[^@]+\.[^@]+$/.test(t), (t) => t.toLowerCase());
    case 'phone': return opt((t) => /^[0-9+()\-. ]{1,40}$/.test(t));
    case 'monthlyBaseSalary': {
      if(v === null) return null;
      const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(Number.isInteger(v) ? String(v) : (typeof v === 'string' ? v : ''));
      return m ? (m[1].replace(/^0+(?=\d)/, '') + '.' + (m[2] || '').padEnd(2, '0')) : undefined;
    }
    default: return undefined;
  }
}
async function handleWrite(req, res, kind){
  const b = await readJson(req);
  if(!session) return api(res, 401, 'unauthenticated');
  if(scenario === 'write-session-lost'){ session = null; return api(res, 401, 'unauthenticated'); }
  if(scenario === 'write-stale-csrf' && !session.rotated){ session.rotated = true; session.csrf = token(); return api(res, 403, 'forbidden'); }  // another tab rotated it
  if(req.headers['x-csrf-token'] !== session.csrf || scenario === 'write-denied') return api(res, 403, 'forbidden');
  if(session.user.role !== 'ceo') return api(res, 403, 'forbidden');
  if(!b) return api(res, 400, 'validation_failed');
  const allowed = kind === 'create' ? WRITABLE : kind === 'update' ? ['id', 'expectedVersion'].concat(WRITABLE) : ['id', 'expectedVersion'];
  const unknown = Object.keys(b).filter((k) => allowed.indexOf(k) === -1);
  if(unknown.length) return api(res, 400, 'validation_failed', null, unknown);
  if(scenario === 'write-validation') return api(res, 400, 'validation_failed', null, ['employeeCode']);
  if(scenario === 'write-rate-limited') return api(res, 429, 'rate_limited', { 'Retry-After': '45' });
  if(scenario === 'write-error') return api(res, 500, 'internal_error');
  if(scenario === 'write-unavailable') return api(res, 503, 'service_unavailable');
  if(scenario === 'write-conflict') return api(res, 409, 'conflict');
  if(scenario === 'write-slow') await new Promise((r) => setTimeout(r, 4000));
  const done = (e) => (scenario === 'write-malformed' ? api(res, 200, { employee: { ...e, internalNote: 'x' } }) : api(res, 200, { employee: e }));
  if(kind === 'create'){
    const missing = ['employeeCode', 'fullName'].filter((k) => !(k in b));
    const bad = missing.length ? missing : Object.keys(b).filter((k) => fieldValue(k, b[k]) === undefined);
    if(bad.length) return api(res, 400, 'validation_failed', null, bad);
    const e = { id: crypto.randomBytes(16).toString('hex'), archived: false, accountState: 'none', version: 1 };
    WRITABLE.forEach((k) => { e[k] = k in b ? fieldValue(k, b[k]) : (k === 'employmentStatus' ? 'Active' : null); });
    if(employees.some((x) => x.employeeCode === e.employeeCode)) return api(res, 409, 'conflict');
    employees.push(e);
    return done(e);
  }
  const target = [];
  if(typeof b.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(b.id)) target.push('id');
  if(!Number.isInteger(b.expectedVersion) || b.expectedVersion < 1 || b.expectedVersion > 4294967295) target.push('expectedVersion');
  if(target.length) return api(res, 400, 'validation_failed', null, target);
  const patch = Object.keys(b).filter((k) => k !== 'id' && k !== 'expectedVersion');
  if(kind === 'update'){
    if(!patch.length) return api(res, 400, 'validation_failed', null, WRITABLE);
    const bad = patch.filter((k) => fieldValue(k, b[k]) === undefined);
    if(bad.length) return api(res, 400, 'validation_failed', null, bad);
  }
  const e = employees.find((x) => x.id === b.id);
  if(!e) return api(res, 404, 'not_found');
  if(e.archived || e.version !== b.expectedVersion) return api(res, 409, 'conflict');
  if(kind === 'archive'){
    if(e.accountState === 'active') return api(res, 409, 'conflict');                     // a login is still bound to it
    e.archived = true; e.version++;
    return done(e);
  }
  const next = { ...e };
  patch.forEach((k) => { next[k] = fieldValue(k, b[k]); });
  if(next.employeeCode !== e.employeeCode && employees.some((x) => x.employeeCode === next.employeeCode)) return api(res, 409, 'conflict');
  if(WRITABLE.some((k) => next[k] !== e[k])){ Object.assign(e, next); e.version++; }        // a no-op writes nothing
  return done(e);
}

if(!fs.existsSync(path.join(pkgRoot, 'index.html'))){
  console.error('dist/package/index.html not found — run `node tools/build-package.js` first.');
  process.exit(1);
}
reset('signed-out');

http.createServer((req, res) => {
  const url = new URL(req.url, ORIGIN);
  const urlPath = decodeURIComponent(url.pathname);
  const sw = /^\/__stub\/scenario\/([a-z-]+)$/.exec(urlPath);
  if(sw && req.method === 'GET'){
    if(SCENARIOS.indexOf(sw[1]) === -1){ res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('unknown scenario'); }
    reset(sw[1]);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('scenario: ' + scenario);
  }
  if(urlPath === '/api' || urlPath.startsWith('/api/')) return handleApi(req, res, urlPath, url.searchParams);
  if(req.method !== 'GET' && req.method !== 'HEAD'){ res.writeHead(405, { ...STATIC_HEADERS, 'Allow': 'GET, HEAD' }); return res.end(); }
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(pkgRoot, rel);
  if(!file.startsWith(pkgRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()){
    res.writeHead(404, { ...STATIC_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found');
  }
  let body = fs.readFileSync(file);
  if(rel === 'js/core/constants.js'){
    const src = body.toString('utf8');
    if(src.split(MODE_LINE).length !== 2){ res.writeHead(500); return res.end('auth mode line not found'); }
    body = src.replace(MODE_LINE, 'const AUTH_MODE = AUTH_MODES.SESSION;');   // in memory only
  }
  res.writeHead(200, { ...STATIC_HEADERS, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(req.method === 'HEAD' ? '' : body);
}).listen(port, '127.0.0.1', () => {
  console.log('TEST-ONLY auth stub: SESSION-mode package at ' + ORIGIN + '/ (scenario: ' + scenario + '). Ctrl+C to stop.');
});
