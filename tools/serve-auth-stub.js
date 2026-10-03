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
 * BF-4a3: the CEO list, detail and write answers carry the derived accountManageable; the self
 * answer never does.
 *
 * AFI-4a3 account administration (POST /api/employees/provision-account { id, email },
 * /reissue-activation, /disable-account, /enable-account { id }): the BF-4a2 guards — CEO only,
 * CSRF, exact keys, live record for provision / reissue / enable, a CEO-bound record always 409,
 * provision only without a login and with an unused email, reissue only when pending (at most 3
 * per record, then 429), disable only with an active membership (pending or active), enable only
 * when disabled (back to active if the login was ever activated, else pending). Answers are the
 * CEO detail only — never a token, link or email. The write-* scenarios apply to these routes too.
 * Fixtures for the matrix: EMP-001 active, EMP-002 no login, EMP-003 archived, EMP-004 bound to a
 * CEO (not manageable), EMP-005 pending, EMP-006 disabled.
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
 *
 * AFI-4b1 Overtime (GET /api/overtime-records?month=YYYY-MM, GET /api/overtime-record?id=, POST
 * /api/overtime-records/create | update | delete | submit | review | reject): a test-only model of
 * BF-4b1 — session required, CSRF, exact body keys (create: employeeId + the record fields; update:
 * id, expectedVersion + fields, never employeeId; the rest: id, expectedVersion), the OvertimeInput
 * value rules (hours "N.NN" > 0, <= 744, quarter steps; a date inside its month), scope (the CEO: the
 * company; an Employee: own records only — another owner is 404), Policy (an Employee may not review
 * or reject: 403), eligibility (an archived or not-Active owner is 409), status and version
 * compare-and-swap (409), hard delete of a Draft. The employeeId of a create is resolved in scope:
 * the browser never decides. Fixtures are in the current month (from this process's clock) and the
 * month before. The write-* scenarios apply to these routes too (write-validation names hours).
 *
 * AFI-4b2 valuation and approval (GET /api/overtime-record/valuation?id=, POST
 * /api/overtime-records/approve { id, expectedVersion, expectedAmount }): a test-only model of
 * BF-4b2 — the frozen valuation of an Approved record for the CEO and its owner; otherwise the CEO's
 * preview (an Employee is 403) of a Reviewed record only (else 409), refused (409) for an archived
 * owner or one without a salary; approve is CEO only, Reviewed at the expected version, eligible, and
 * the stub's own TAM-OT-1 (salary × hours ÷ 160, integer sen × quarter-hours, one half-up rounding to
 * the Rupiah) must equal expectedAmount exactly (409), then the snapshot is frozen. Fixtures add a
 * Reviewed and an Approved record of EMP-001 (whose frozen salary basis differs from the current one).
 *   /__stub/bump-salary   raises EMP-001's salary by 500000.00 WITHOUT a scenario switch, so a
 *                         preview already shown is stale and its approval answers 409
 * No payment or finance effect exists here.
 *
 * AFI-4c1 Payroll (GET /api/payroll-plans?month=, GET /api/payroll-plan?id=, POST
 * /api/payroll-plans/generate { month } | review | approve | return | cancel { id, expectedVersion }):
 * a test-only model of BF-4c1 — CEO only (an Employee is 403 on every route), CSRF, exact body keys;
 * generate makes a Draft for each live, Active employee with a salary (the others are `excluded`
 * with archived / not_active / salary_missing), recalculates Drafts from the salary plus the frozen
 * amounts of the month's Approved overtime (one half-up rounding to the Rupiah), and leaves Reviewed,
 * Ready and Committed plans alone; the transitions follow the BF-4c1 graph with a version
 * compare-and-swap (409); cancel releases the plan's overtime. Fixtures add a Committed plan (stub
 * only — nothing here commits) and a Cancelled one. The write-* scenarios apply here too.
 *   /__stub/bump-payroll  bumps every live plan's version WITHOUT a scenario switch, so a plan
 *                         already shown is stale and its next action answers 409
 * Nothing here pays, posts or touches Finance.
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
    archived: false, accountState: 'active', activated: true, loginEmail: 'employee@example.invalid', joinDate: '2026-01-05', contactEmail: 'one@example.invalid', phone: '0812 000 001',
    notes: 'Fabricated note <script>not run</script>', monthlyBaseSalary: '7500000.00', version: 2 },
  { id: 'emp_stub_2', employeeCode: 'EMP-002', fullName: 'Fabricated Employee Two', jobTitle: null, department: null, employmentStatus: 'On Leave',
    archived: false, accountState: 'none', joinDate: null, contactEmail: null, phone: null, notes: null, monthlyBaseSalary: null, version: 1 },
  { id: 'emp_stub_3', employeeCode: 'EMP-003', fullName: 'Fabricated Former Employee', jobTitle: 'Analyst', department: 'Operations', employmentStatus: 'Resigned',
    archived: true, accountState: 'disabled', joinDate: '2025-03-01', contactEmail: null, phone: null, notes: null, monthlyBaseSalary: '6000000.00', version: 4 },
  // AFI-4a3 fixtures. ceoBound / activated / loginEmail are the stub's own login model and never leave it.
  { id: 'emp_stub_4', employeeCode: 'EMP-004', fullName: 'Fabricated Director Record', jobTitle: 'Director', department: 'Management', employmentStatus: 'Active',
    archived: false, accountState: 'active', ceoBound: true, joinDate: null, contactEmail: null, phone: null, notes: null, monthlyBaseSalary: null, version: 1 },
  { id: 'emp_stub_5', employeeCode: 'EMP-005', fullName: 'Fabricated Pending Person', jobTitle: null, department: 'Operations', employmentStatus: 'Active',
    archived: false, accountState: 'pending', loginEmail: 'pending@example.invalid', joinDate: null, contactEmail: null, phone: null, notes: null, monthlyBaseSalary: null, version: 1 },
  { id: 'emp_stub_6', employeeCode: 'EMP-006', fullName: 'Fabricated Disabled Person', jobTitle: null, department: 'Operations', employmentStatus: 'Inactive',
    archived: false, accountState: 'disabled', activated: true, loginEmail: 'disabled@example.invalid', joinDate: null, contactEmail: null, phone: null, notes: null, monthlyBaseSalary: null, version: 1 }
];
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const LIST_KEYS = ['id', 'employeeCode', 'fullName', 'jobTitle', 'department', 'employmentStatus', 'archived', 'accountState', 'accountManageable'];
const DETAIL_KEYS = ['id', 'employeeCode', 'fullName', 'jobTitle', 'department', 'employmentStatus', 'archived', 'joinDate', 'contactEmail', 'phone', 'notes', 'monthlyBaseSalary', 'version', 'accountState', 'accountManageable'];
// BF-4a3: the server-derived accountManageable, as EmployeeStore derives it: live AND (no login OR an
// employee membership whose user is active). The stub's CEO-bound record is never manageable.
const ceoView = (e, keys) => pick({ ...e, accountManageable: !e.archived && !e.ceoBound }, keys);
const ACCOUNT_KINDS = ['provision', 'reissue', 'disable', 'enable'];
// AFI-4a2: EmployeeInput::FIELDS and STATUSES (test-only mirror).
const WRITABLE = ['employeeCode', 'fullName', 'jobTitle', 'department', 'employmentStatus', 'joinDate', 'contactEmail', 'phone', 'notes', 'monthlyBaseSalary'];
const STATUSES = ['Active', 'Inactive', 'On Leave', 'Resigned', 'Terminated'];
const SELF_KEYS = ['id', 'employeeCode', 'fullName', 'jobTitle', 'department', 'employmentStatus', 'joinDate', 'contactEmail', 'phone', 'monthlyBaseSalary'];
// AFI-3 fabricated one-time tokens (43 base64url characters, the server shape).
const STUB_TOKENS = { activation: 'stub-activation-token-' + 'a'.repeat(21), recovery: 'stub-recovery-token-' + 'r'.repeat(23) };

// AFI-4b1 fabricated Overtime records, in this process's current month and the month before.
const stubMonth = (delta) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + delta); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const OT_FIELDS = ['monthKey', 'overtimeDate', 'hours', 'workDescription', 'notes'];
const OT_VIEW = ['id', 'employeeId', 'monthKey', 'overtimeDate', 'hours', 'workDescription', 'notes', 'status', 'version'];
function stubOvertime(){
  const m = stubMonth(0), prev = stubMonth(-1);
  const r = (n, emp, month, day, hours, status, version, text) => ({ id: String(n).repeat(32).slice(0, 32), employeeId: emp, monthKey: month,
    overtimeDate: day ? month + '-' + day : null, hours: hours, workDescription: text, notes: null, status: status, version: version });
  return [r(1, 'emp_stub_1', m, '03', '7.50', 'Draft', 1, 'Fabricated <b>release</b> support'), r(2, 'emp_stub_1', m, '05', '2.25', 'Submitted', 2, 'Fabricated audit prep'),
    r(3, 'emp_stub_2', m, null, '1.00', 'Reviewed', 3, null), r(4, 'emp_stub_3', m, '09', '0.25', 'Rejected', 4, 'Fabricated duplicate entry'),
    r(5, 'emp_stub_5', m, '11', '4.00', 'Draft', 1, null), r(6, 'emp_stub_1', prev, '20', '3.00', 'Reviewed', 2, 'Fabricated month-end close'),
    // AFI-4b2: a Reviewed record of a live, salaried owner, and an Approved one with its frozen snapshot.
    r(7, 'emp_stub_1', m, '14', '6.00', 'Reviewed', 3, 'Fabricated quarter close'),
    Object.assign(r(8, 'emp_stub_1', m, '18', '2.50', 'Approved', 4, 'Fabricated vendor visit'), { frozenSalary: '7000000.00' })];
}
// AFI-4b2 TAM-OT-1 (test-only mirror of server/src/Overtime/OvertimeValuation.php): salary × hours ÷ 160
// in integer sen × quarter-hours, one half-up rounding to the whole Rupiah.
function otAmount(salary, hours){
  const sen = BigInt(salary.replace('.', '')), q = BigInt(hours.replace('.', '')) / 25n, den = 640n * 100n;
  let rupiah = sen * q / den;
  if(2n * (sen * q % den) >= den) rupiah++;
  return rupiah.toString() + '.00';
}
const otValuation = (r, kind, salary) => ({ id: r.id, kind: kind, method: 'TAM-OT-1', hours: r.hours, monthlySalaryBasis: salary,
  standardMonthlyHours: '160.00', amount: otAmount(salary, r.hours) });
// The owner's current salary when it can be valued (live, salary > 0), else null.
const otSalary = (r) => { const e = employees.find((x) => x.id === r.employeeId); return (e && !e.archived && e.monthlyBaseSalary && e.monthlyBaseSalary !== '0.00') ? e.monthlyBaseSalary : null; };
const otHours = (v) => { const m = typeof v === 'string' ? /^(0|[1-9]\d{0,2})\.(\d{2})$/.exec(v) : null; if(!m) return false; const h = +m[1] * 100 + +m[2]; return h > 0 && h <= 74400 && h % 25 === 0; };
const otMonth = (v) => typeof v === 'string' && /^(\d{4})-(0[1-9]|1[0-2])$/.test(v) && +v.slice(0, 4) >= 1900;
const otDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && +v.slice(0, 4) >= 1900 && !isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
// One OvertimeInput value: the normalized value, or undefined when it is not acceptable.
function otValue(k, v){
  const text = (max, multiline) => {
    if(v === null) return null;
    if(typeof v !== 'string') return undefined;
    const t = v.trim();
    if(t === '') return null;
    if((multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/ : /[\u0000-\u001F\u007F-\u009F]/).test(t) || Array.from(t).length > max) return undefined;
    return t;
  };
  switch(k){
    case 'monthKey': return otMonth(v) ? v : undefined;
    case 'overtimeDate': return (v === null || v === '') ? null : (otDate(v) ? v : undefined);
    case 'hours': return otHours(v) ? v : undefined;
    case 'workDescription': return text(160, false);
    case 'notes': return text(2000, true);
    default: return undefined;
  }
}


// AFI-4c1 fabricated payroll plans (test-only model of BF-4c1): a Committed plan (stub fixture only)
// and a Cancelled one, in this process's current month.
const PR_VIEW = ['id', 'employeeId', 'monthKey', 'status', 'employeeCode', 'employeeName', 'department', 'baseSalary', 'overtimeAmount', 'overtimeHours', 'overtimeCount', 'totalAmount', 'version'];
const PR_GRAPH = { review: [['Draft'], 'Reviewed'], approve: [['Draft', 'Reviewed'], 'Ready'], return: [['Reviewed', 'Ready'], 'Draft'], cancel: [['Draft', 'Reviewed', 'Ready'], 'Cancelled'] };
function stubPayroll(){
  const m = stubMonth(0);
  const p = (n, emp, code, name, status, version) => ({ id: ('c' + n).repeat(16).slice(0, 32), employeeId: emp, monthKey: m, status: status, employeeCode: code,
    employeeName: name, department: 'Operations', baseSalary: '6000000.00', overtimeAmount: '0.00', overtimeHours: '0.00', overtimeCount: 0,
    totalAmount: '6000000.00', version: version, links: [] });
  return [p(1, 'emp_stub_6', 'EMP-006', 'Fabricated Disabled Person', 'Committed', 5), p(2, 'emp_stub_5', 'EMP-005', 'Fabricated Pending Person', 'Cancelled', 2)];
}
// The stub's calculation of one plan (test-only mirror of PayrollCalculation): sen sums in BigInt,
// one half-up rounding to the whole Rupiah.
function prCalc(e, month){
  const ot = overtime.filter((r) => r.employeeId === e.id && r.monthKey === month && r.status === 'Approved');
  let sen = BigInt(e.monthlyBaseSalary.replace('.', ''));
  let quarters = 0n, otRupiah = 0n;
  ot.forEach((r) => { const a = BigInt(otAmount(r.frozenSalary, r.hours).replace('.00', '')); otRupiah += a; sen += a * 100n; quarters += BigInt(r.hours.replace('.', '')) / 25n; });
  let rupiah = sen / 100n; if(2n * (sen % 100n) >= 100n) rupiah++;
  const h = quarters * 25n;
  return { baseSalary: e.monthlyBaseSalary, overtimeAmount: otRupiah + '.00', overtimeHours: (h / 100n) + '.' + String(h % 100n).padStart(2, '0'),
    overtimeCount: ot.length, totalAmount: rupiah + '.00', links: ot.map((r) => r.id) };
}
const prOrder = (a, b) => (a.employeeCode < b.employeeCode ? -1 : a.employeeCode > b.employeeCode ? 1 : (a.id < b.id ? -1 : 1));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '': 'text/plain; charset=utf-8' };

let scenario = 'signed-out';
let session = null;            // { user, csrf, staleOnce }
let usedTokens = [];           // AFI-3: tokens consumed since the last scenario switch
let employees = [];            // AFI-4a2: this scenario's copy of STUB_EMPLOYEES
let overtime = [];             // AFI-4b1: this scenario's Overtime records
let payroll = [];              // AFI-4c1: this scenario's payroll plans (each with its overtime links)

const token = () => crypto.randomBytes(32).toString('base64url');        // 43 characters, the server shape
const rid = () => crypto.randomBytes(16).toString('hex');
function reset(name){
  scenario = name;
  usedTokens = [];
  employees = STUB_EMPLOYEES.map((e) => ({ ...e }));
  overtime = stubOvertime();
  payroll = stubPayroll();
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
      return api(res, 200, { employees: employees.filter((e) => all || !e.archived).map((e) => ceoView(e, LIST_KEYS)) });
    }
    if(keys.join() !== 'id' || !/^[A-Za-z0-9_-]{1,64}$/.test(query.get('id') || '')) return api(res, 400, 'validation_failed', null, ['id']);
    const id = query.get('id');
    if(ceo){
      const e = employees.find((x) => x.id === id);
      return e ? api(res, 200, { employee: ceoView(e, DETAIL_KEYS) }) : api(res, 404, 'not_found');
    }
    if(scenario === 'employee-self-missing' || id !== session.user.employeeId) return api(res, 404, 'not_found');
    return api(res, 200, { employee: pick(employees[0], SELF_KEYS) });
  }
  // AFI-4b1 Overtime reads: session required; the CEO's company, an Employee's own records only.
  if((p === '/api/overtime-records' || p === '/api/overtime-record') && req.method === 'GET'){
    if(!session) return api(res, 401, 'unauthenticated');
    if(scenario === 'employees-session-lost'){ session = null; return api(res, 401, 'unauthenticated'); }
    if(scenario === 'employees-unavailable') return api(res, 503, 'service_unavailable');
    const keys = [...query.keys()];
    const visible = (r) => session.user.role === 'ceo' || r.employeeId === session.user.employeeId;
    if(p === '/api/overtime-records'){
      if(keys.join() !== 'month' || !otMonth(query.get('month'))) return api(res, 400, 'invalid_query');
      return api(res, 200, { overtimeRecords: overtime.filter((r) => r.monthKey === query.get('month') && visible(r)).map((r) => pick(r, OT_VIEW)) });
    }
    if(keys.join() !== 'id' || !/^[0-9a-f]{32}$/.test(query.get('id') || '')) return api(res, 400, 'validation_failed', null, ['id']);
    const r = overtime.find((x) => x.id === query.get('id'));
    return (r && visible(r)) ? api(res, 200, { overtimeRecord: pick(r, OT_VIEW) }) : api(res, 404, 'not_found');
  }
  // AFI-4b2: the valuation read — frozen for an Approved record (CEO, owner); else the CEO's preview.
  if(p === '/api/overtime-record/valuation' && req.method === 'GET'){
    if(!session) return api(res, 401, 'unauthenticated');
    if(scenario === 'employees-session-lost'){ session = null; return api(res, 401, 'unauthenticated'); }
    if(scenario === 'employees-unavailable') return api(res, 503, 'service_unavailable');
    if([...query.keys()].join() !== 'id' || !/^[0-9a-f]{32}$/.test(query.get('id') || '')) return api(res, 400, 'validation_failed', null, ['id']);
    const r = overtime.find((x) => x.id === query.get('id'));
    if(!r || !(session.user.role === 'ceo' || r.employeeId === session.user.employeeId)) return api(res, 404, 'not_found');
    if(r.status === 'Approved') return api(res, 200, { overtimeValuation: otValuation(r, 'approved', r.frozenSalary) });
    if(session.user.role !== 'ceo') return api(res, 403, 'forbidden');
    if(r.status !== 'Reviewed' || !otSalary(r)) return api(res, 409, 'conflict');
    return api(res, 200, { overtimeValuation: otValuation(r, 'preview', otSalary(r)) });
  }
  // AFI-4c1 Payroll reads: CEO only.
  if((p === '/api/payroll-plans' || p === '/api/payroll-plan') && req.method === 'GET'){
    if(!session) return api(res, 401, 'unauthenticated');
    if(scenario === 'employees-session-lost'){ session = null; return api(res, 401, 'unauthenticated'); }
    if(scenario === 'employees-unavailable') return api(res, 503, 'service_unavailable');
    if(session.user.role !== 'ceo') return api(res, 403, 'forbidden');
    if(p === '/api/payroll-plans'){
      if(!otMonth(query.get('month') || '')) return api(res, 400, 'invalid_query');
      return api(res, 200, { payrollPlans: payroll.filter((x) => x.monthKey === query.get('month')).sort(prOrder).map((x) => pick(x, PR_VIEW)) });
    }
    const x = payroll.find((y) => y.id === query.get('id'));
    if(!x) return api(res, 404, 'not_found');
    return api(res, 200, { payrollPlan: pick(x, PR_VIEW), payrollPlanOvertime: x.links.map((id) => { const r = overtime.find((o) => o.id === id); return { id: r.id, hours: r.hours, amount: otAmount(r.frozenSalary, r.hours) }; }) });
  }
  const prWrite = { '/api/payroll-plans/generate': 'generate', '/api/payroll-plans/review': 'review', '/api/payroll-plans/approve': 'approve',
    '/api/payroll-plans/return': 'return', '/api/payroll-plans/cancel': 'cancel' }[p];
  if(prWrite && req.method === 'POST') return handlePayrollWrite(req, res, prWrite);
  const otWrite = { '/api/overtime-records/create': 'create', '/api/overtime-records/update': 'update', '/api/overtime-records/delete': 'delete',
    '/api/overtime-records/submit': 'submit', '/api/overtime-records/review': 'review', '/api/overtime-records/reject': 'reject',
    '/api/overtime-records/approve': 'approve' }[p];
  if(otWrite && req.method === 'POST') return handleOvertimeWrite(req, res, otWrite);
  // AFI-4a2 Employee writes (test-only model of BF-4a1; see the header).
  const write = { '/api/employees/create': 'create', '/api/employees/update': 'update', '/api/employees/archive': 'archive',
    '/api/employees/provision-account': 'provision', '/api/employees/reissue-activation': 'reissue', '/api/employees/disable-account': 'disable', '/api/employees/enable-account': 'enable' }[p];
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
  const allowed = kind === 'create' ? WRITABLE : kind === 'update' ? ['id', 'expectedVersion'].concat(WRITABLE)
    : kind === 'provision' ? ['id', 'email'] : ACCOUNT_KINDS.indexOf(kind) !== -1 ? ['id'] : ['id', 'expectedVersion'];
  const unknown = Object.keys(b).filter((k) => allowed.indexOf(k) === -1);
  if(unknown.length) return api(res, 400, 'validation_failed', null, unknown);
  if(scenario === 'write-validation') return api(res, 400, 'validation_failed', null, [kind === 'provision' ? 'email' : ACCOUNT_KINDS.indexOf(kind) !== -1 ? 'id' : 'employeeCode']);
  if(scenario === 'write-rate-limited') return api(res, 429, 'rate_limited', { 'Retry-After': '45' });
  if(scenario === 'write-error') return api(res, 500, 'internal_error');
  if(scenario === 'write-unavailable') return api(res, 503, 'service_unavailable');
  if(scenario === 'write-conflict') return api(res, 409, 'conflict');
  if(scenario === 'write-slow') await new Promise((r) => setTimeout(r, 4000));
  const done = (e) => (scenario === 'write-malformed' ? api(res, 200, { employee: { ...ceoView(e, DETAIL_KEYS), internalNote: 'x' } }) : api(res, 200, { employee: ceoView(e, DETAIL_KEYS) }));
  if(ACCOUNT_KINDS.indexOf(kind) !== -1) return accountWrite(res, kind, b, done);
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

/* ---------- AFI-4b1: the Overtime writes (test-only model of BF-4b1) ---------- */
const OT_TRANSITIONS = { submit: [['Draft'], 'Submitted'], review: [['Submitted'], 'Reviewed'], reject: [['Submitted', 'Reviewed'], 'Rejected'] };
async function handleOvertimeWrite(req, res, kind){
  const b = await readJson(req);
  if(!session) return api(res, 401, 'unauthenticated');
  if(scenario === 'write-session-lost'){ session = null; return api(res, 401, 'unauthenticated'); }
  if(scenario === 'write-stale-csrf' && !session.rotated){ session.rotated = true; session.csrf = token(); return api(res, 403, 'forbidden'); }
  if(req.headers['x-csrf-token'] !== session.csrf || scenario === 'write-denied') return api(res, 403, 'forbidden');
  if(!b) return api(res, 400, 'validation_failed');
  const allowed = kind === 'create' ? ['employeeId'].concat(OT_FIELDS) : kind === 'update' ? ['id', 'expectedVersion'].concat(OT_FIELDS)
    : kind === 'approve' ? ['id', 'expectedVersion', 'expectedAmount'] : ['id', 'expectedVersion'];
  const unknown = Object.keys(b).filter((k) => allowed.indexOf(k) === -1);
  if(unknown.length) return api(res, 400, 'validation_failed', null, unknown);
  if(scenario === 'write-validation') return api(res, 400, 'validation_failed', null, [kind === 'create' || kind === 'update' ? 'hours' : 'id']);
  if(scenario === 'write-rate-limited') return api(res, 429, 'rate_limited', { 'Retry-After': '45' });
  if(scenario === 'write-error') return api(res, 500, 'internal_error');
  if(scenario === 'write-unavailable') return api(res, 503, 'service_unavailable');
  if(scenario === 'write-conflict') return api(res, 409, 'conflict');
  if(scenario === 'write-slow') await new Promise((r) => setTimeout(r, 4000));
  const ceo = session.user.role === 'ceo';
  const visible = (r) => ceo || r.employeeId === session.user.employeeId;
  const done = (payload) => (scenario === 'write-malformed' ? api(res, 200, Object.assign({ internalNote: 'x' }, payload)) : api(res, 200, payload));
  if(kind === 'create'){
    const missing = ['employeeId', 'monthKey', 'hours'].filter((k) => !(k in b));
    if(missing.length) return api(res, 400, 'validation_failed', null, missing);
    const bad = Object.keys(b).filter((k) => k === 'employeeId' ? !(typeof b.employeeId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(b.employeeId)) : otValue(k, b[k]) === undefined);
    if(bad.length) return api(res, 400, 'validation_failed', null, bad);
    const rec = { id: crypto.randomBytes(16).toString('hex'), employeeId: b.employeeId, status: 'Draft', version: 1 };
    OT_FIELDS.forEach((k) => { rec[k] = k in b ? otValue(k, b[k]) : null; });
    if(rec.overtimeDate !== null && rec.overtimeDate.slice(0, 7) !== rec.monthKey) return api(res, 400, 'validation_failed', null, ['overtimeDate']);
    // The selector is resolved in scope: an Employee only for themself, the CEO in the company.
    const owner = employees.find((e) => e.id === b.employeeId);
    if(!owner || (!ceo && owner.id !== session.user.employeeId)) return api(res, 404, 'not_found');
    if(owner.archived || owner.employmentStatus !== 'Active') return api(res, 409, 'conflict');
    overtime.push(rec);
    return done({ overtimeRecord: pick(rec, OT_VIEW) });
  }
  const target = [];
  if(typeof b.id !== 'string' || !/^[0-9a-f]{32}$/.test(b.id)) target.push('id');
  if(target.length) return api(res, 400, 'validation_failed', null, target);
  const patch = Object.keys(b).filter((k) => k !== 'id' && k !== 'expectedVersion');
  if(kind === 'approve' && !(typeof b.expectedAmount === 'string' && /^(0|[1-9][0-9]{0,13})\.00$/.test(b.expectedAmount))) return api(res, 400, 'validation_failed', null, ['expectedAmount']);
  if(kind === 'update'){
    if(!patch.length) return api(res, 400, 'validation_failed', null, OT_FIELDS);
    const bad = patch.filter((k) => otValue(k, b[k]) === undefined);
    if(bad.length) return api(res, 400, 'validation_failed', null, bad);
  }
  const r = overtime.find((x) => x.id === b.id);
  if(!r || !visible(r)) return api(res, 404, 'not_found');
  if(!ceo && (kind === 'review' || kind === 'reject' || kind === 'approve')) return api(res, 403, 'forbidden');
  const from = kind === 'update' || kind === 'delete' ? ['Draft'] : kind === 'approve' ? ['Reviewed'] : OT_TRANSITIONS[kind][0];
  if(from.indexOf(r.status) === -1 || r.version !== b.expectedVersion) return api(res, 409, 'conflict');
  if(kind === 'approve'){
    // AFI-4b2: eligibility, then the server's own amount must equal the one the CEO was shown.
    const salary = otSalary(r);
    if(!salary || otAmount(salary, r.hours) !== b.expectedAmount) return api(res, 409, 'conflict');
    r.frozenSalary = salary; r.status = 'Approved'; r.version++;
    return done({ overtimeRecord: pick(r, OT_VIEW), overtimeValuation: otValuation(r, 'approved', r.frozenSalary) });
  }
  if(kind === 'delete'){ overtime = overtime.filter((x) => x !== r); return done({ deleted: { id: r.id } }); }
  if(kind === 'update'){
    const next = { ...r };
    patch.forEach((k) => { next[k] = otValue(k, b[k]); });
    if(next.overtimeDate !== null && next.overtimeDate.slice(0, 7) !== next.monthKey) return api(res, 400, 'validation_failed', null, ['overtimeDate']);
    if(OT_FIELDS.some((k) => next[k] !== r[k])){ Object.assign(r, next); r.version++; }           // a no-op writes nothing
    return done({ overtimeRecord: pick(r, OT_VIEW) });
  }
  r.status = OT_TRANSITIONS[kind][1]; r.version++;
  return done({ overtimeRecord: pick(r, OT_VIEW) });
}

/* ---------- AFI-4c1: the Payroll writes (test-only model of BF-4c1) ---------- */
async function handlePayrollWrite(req, res, kind){
  const b = await readJson(req);
  if(!session) return api(res, 401, 'unauthenticated');
  if(scenario === 'write-session-lost'){ session = null; return api(res, 401, 'unauthenticated'); }
  if(scenario === 'write-stale-csrf' && !session.rotated){ session.rotated = true; session.csrf = token(); return api(res, 403, 'forbidden'); }
  if(req.headers['x-csrf-token'] !== session.csrf || scenario === 'write-denied') return api(res, 403, 'forbidden');
  if(session.user.role !== 'ceo') return api(res, 403, 'forbidden');
  if(!b) return api(res, 400, 'validation_failed');
  const allowed = kind === 'generate' ? ['month'] : ['id', 'expectedVersion'];
  const unknown = Object.keys(b).filter((k) => allowed.indexOf(k) === -1);
  if(unknown.length) return api(res, 400, 'validation_failed', null, unknown);
  if(scenario === 'write-validation') return api(res, 400, 'validation_failed', null, [kind === 'generate' ? 'month' : 'id']);
  if(scenario === 'write-rate-limited') return api(res, 429, 'rate_limited', { 'Retry-After': '45' });
  if(scenario === 'write-error') return api(res, 500, 'internal_error');
  if(scenario === 'write-unavailable') return api(res, 503, 'service_unavailable');
  if(scenario === 'write-conflict') return api(res, 409, 'conflict');
  if(scenario === 'write-slow') await new Promise((r) => setTimeout(r, 4000));
  const done = (payload) => (scenario === 'write-malformed' ? api(res, 200, Object.assign({ internalNote: 'x' }, payload)) : api(res, 200, payload));
  if(kind === 'generate'){
    if(!otMonth(b.month)) return api(res, 400, 'validation_failed', null, ['month']);
    const excluded = [];
    employees.slice().sort((a, c) => (a.id < c.id ? -1 : 1)).forEach((e) => {
      const reason = e.archived ? 'archived' : e.employmentStatus !== 'Active' ? 'not_active' : (!e.monthlyBaseSalary || e.monthlyBaseSalary === '0.00') ? 'salary_missing' : null;
      if(reason){ excluded.push({ employeeId: e.id, reason: reason }); return; }
      const live = payroll.find((x) => x.employeeId === e.id && x.monthKey === b.month && x.status !== 'Cancelled');
      const calc = prCalc(e, b.month);
      if(!live){
        payroll.push(Object.assign({ id: crypto.randomBytes(16).toString('hex'), employeeId: e.id, monthKey: b.month, status: 'Draft', employeeCode: e.employeeCode,
          employeeName: e.fullName, department: e.department, version: 1 }, calc));
      } else if(live.status === 'Draft'){
        const before = JSON.stringify(pick(live, PR_VIEW));
        Object.assign(live, calc, { employeeCode: e.employeeCode, employeeName: e.fullName, department: e.department });
        if(JSON.stringify(pick(live, PR_VIEW)) !== before) live.version++;
      }
    });
    return done({ payrollPlans: payroll.filter((x) => x.monthKey === b.month && x.status !== 'Cancelled').sort(prOrder).map((x) => pick(x, PR_VIEW)), excluded: excluded });
  }
  const target = [];
  if(typeof b.id !== 'string' || !/^[0-9a-f]{32}$/.test(b.id)) target.push('id');
  if(!Number.isInteger(b.expectedVersion) || b.expectedVersion < 1 || b.expectedVersion > 4294967295) target.push('expectedVersion');
  if(target.length) return api(res, 400, 'validation_failed', null, target);
  const x = payroll.find((y) => y.id === b.id);
  if(!x) return api(res, 404, 'not_found');
  if(PR_GRAPH[kind][0].indexOf(x.status) === -1 || x.version !== b.expectedVersion) return api(res, 409, 'conflict');
  x.status = PR_GRAPH[kind][1]; x.version++;
  if(kind === 'cancel') x.links = [];
  return done({ payrollPlan: pick(x, PR_VIEW) });
}

// AFI-4a3: the account operations (test-only model of AccountService's guards).
function accountWrite(res, kind, b, done){
  if(typeof b.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(b.id)) return api(res, 400, 'validation_failed', null, ['id']);
  let email = '';
  if(kind === 'provision'){
    email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    if(!email || email.length > 254 || !/^[\x21-\x7E]+$/.test(email) || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) return api(res, 400, 'validation_failed', null, ['email']);
  }
  const e = employees.find((x) => x.id === b.id);
  if(!e) return api(res, 404, 'not_found');
  if(e.ceoBound && e.accountState !== 'none') return api(res, 409, 'conflict');                   // never a CEO membership
  const live = !e.archived;
  if(kind === 'provision'){
    if(!live || e.accountState !== 'none') return api(res, 409, 'conflict');
    if(employees.some((x) => x.loginEmail === email) || USERS[email]) return api(res, 409, 'conflict');
    Object.assign(e, { accountState: 'pending', loginEmail: email, activated: false });
  } else if(kind === 'reissue'){
    if(!live || e.accountState !== 'pending') return api(res, 409, 'conflict');
    if((e.reissues || 0) >= 3) return api(res, 429, 'rate_limited', { 'Retry-After': '3600' });
    e.reissues = (e.reissues || 0) + 1;
  } else if(kind === 'disable'){
    if(e.accountState !== 'pending' && e.accountState !== 'active') return api(res, 409, 'conflict');
    e.accountState = 'disabled';
  } else {
    if(!live || e.accountState !== 'disabled') return api(res, 409, 'conflict');
    e.accountState = e.activated ? 'active' : 'pending';
  }
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
  if(urlPath === '/__stub/bump-salary' && req.method === 'GET'){
    // AFI-4b2: a salary change after a preview (no scenario switch, the session stays).
    const e = employees.find((x) => x.id === 'emp_stub_1');
    e.monthlyBaseSalary = (BigInt(e.monthlyBaseSalary.replace('.', '')) + 50000000n).toString().replace(/(..)$/, '.$1');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('EMP-001 salary: ' + e.monthlyBaseSalary);
  }
  if(urlPath === '/__stub/bump-payroll' && req.method === 'GET'){
    // AFI-4c1: another change to the live plans (no scenario switch, the session stays).
    payroll.forEach((x) => { if(x.status !== 'Cancelled' && x.status !== 'Committed') x.version++; });
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('payroll plans bumped');
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
