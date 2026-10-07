#!/usr/bin/env node
'use strict';
/* ============================================================
   AFI-4c1 — SESSION PAYROLL CEO WORKSPACE RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of AFI-4c1. This harness proves its BEHAVIOUR by
   executing every production module (module-order.js, the boot included) in the
   dependency-free Node `vm` loader of the SESSION Overtime harness, with the ONE source line
   `const AUTH_MODE = AUTH_MODES.LOCAL;` rewritten to SESSION in the concatenated text — the
   committed value is untouched. Owner decision D-AFI4c1-2 = A: a dedicated harness.

   DETERMINISTIC: fetch is a stub answering by URL (path + query) from a script; the API
   timeout timer is captured and fired on demand; the page's clock is injected — `Date` with no
   argument is a fixed instant (2031-04-15T12:00:00Z, the same calendar month in every timezone
   from UTC-12 to UTC+14). No real network, no wall clock, no credentials, no production backend.
   localStorage / sessionStorage / cookies / history are instrumented, and the LOCAL boot, the
   shell, "Acting as", local data tools, Global Search, the LOCAL Payroll and Overtime pages, the
   LOCAL payroll engine and the other domains' renderers are recording spies that must never be
   called. Every identity, token and plan here is fabricated.

   MONEY: the fabricated plans are deliberately NOT internally consistent (a Draft whose total is
   "999.00" for a base of "8000000.50" and overtime of "12345.00"), so a page that added, rounded
   or reformatted money could not show the server's strings. Every write request (method, path,
   body, CSRF header) is recorded and asserted exactly.

   AFI-4d (owner decisions D-AFI4d-1 = A, D-AFI4d-2 = A): sections S–S8 prove the SESSION
   Supplemental Payroll over BF-4d — the strict 12 / 3 / 5-key decoders, the CEO month card
   (eligibility named from the plan snapshot, documents), generate { payrollPlanId }, the linear
   lifecycle with NO Draft → Ready, Commit with one intent and a same-key Retry, the Employee's own
   Committed documents as separate rows, and the firewall (memory only, cleared, no LOCAL engine,
   no global collision). Supplemental amounts deliberately differ from their lines' sum.

   AFI-4e (owner decisions D-AFI4e-1..5 = A): sections F–F9 prove the SESSION Finance posting over
   BF-4e — the strict seven-key decoders and the request mirror, the CEO's Finance card on a
   Committed plan and a Committed Supplemental document only (matched by sourceKind + sourceId), the
   exact bodies with the source's own amount string, one intent and one Web Crypto key per deliberate
   confirmation, the unknown outcome re-read and never resent, the same-key "Retry posting", a 409
   that never claims its cause, the Finance read failure (no Post), the Employee's isolation and no
   execution semantics. The Committed plan posted here has a total that is NOT base + overtime.

   AFI-4f (owner decisions D-AFI4f-1..8 = A): sections X–X9 prove Record payment over BF-4f — the
   strict seven-key execution decoders and the five-key request mirror, the payment status inside
   the Finance card of a posted Committed source only (matched by financePostingId), the fail-closed
   eligibility (no Record payment while a posting or execution read is idle, loading, failed or
   inconsistent), the form (display-only amount, empty Date paid with the Jakarta max hint, a
   Payment method with no default), the exact body with the posting's own amount string, one
   frozen intent and one key per deliberate confirmation, the unknown outcome re-read and never
   resent, the same-key "Retry recording", a 409 that never claims its cause, the stale-CSRF
   replay of the same body and key, principal and session changes, the Employee's isolation and
   no money-moving semantics. TAM OS only records a payment made outside it.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

const root = path.resolve(__dirname, '..');
const CSRF = 'A'.repeat(21) + '_' + 'b'.repeat(21);
const CSRF2 = 'C'.repeat(21) + '_' + 'd'.repeat(21);
const RID = '0123456789abcdef0123456789abcdef';
const ME_CEO = { userId: 'u_ceo_1', membershipId: 'm_ceo_1', role: 'ceo', employeeId: null, csrfToken: CSRF };
const ME_CEO2 = { userId: 'u_ceo_2', membershipId: 'm_ceo_2', role: 'ceo', employeeId: null, csrfToken: CSRF2 };
const ME_EMP = { userId: 'u_emp_1', membershipId: 'm_emp_1', role: 'employee', employeeId: 'emp_srv_1', csrfToken: CSRF };
const FIXED_NOW = Date.UTC(2031, 3, 15, 12, 0, 0);       // 2031-04-15T12:00:00Z
const MONTH = '2031-04';
const NEVER = ['loadState', 'saveState', 'applyTheme', 'installGlobalUIHandlers', 'maybeShowFirstRunChoice', 'startFresh',
  'renderShell', 'renderView', 'renderIdentitySelectorHTML', 'restoreCompleteBackup', 'renderSmartImport', 'openGlobalSearch',
  'renderEmployees', 'renderEmployeeDetail', 'renderOvertime', 'renderOvertimeWorksheet', 'renderPayrollWorkspace', 'renderPayrollDetail',
  'generatePayrollForMonth', 'transitionPayrollLifecycle', 'commitReadyPayroll', 'computePayrollPlanned', 'persistPayrollPlans',
  'renderDashboard', 'renderExecutiveDashboard', 'renderTransactions', 'renderExecutionCenter',
  // AFI-4d: the LOCAL Supplemental engine (js/people/supplemental-engine.js) is never reached.
  'generateSupplementalForPlan', 'refreshSupplemental', 'transitionSupplemental', 'postSupplemental', 'persistSupplementalPayments',
  'renderSupplementalPayments', 'renderSupplementalDetail', 'handleSupplementalAction', 'supplementalEligibleOvertime', 'linkSupplementalExecution',
  'recoverSupplementalOrphans'];

/* ---------- fabricated records ---------- */
const E1 = { id: 'e_1', employeeCode: 'EMP-001', fullName: 'Fabricated <Alpha>', jobTitle: null, department: null, employmentStatus: 'Active', archived: false, accountState: 'none', accountManageable: true };
const E3 = { id: 'e_3', employeeCode: 'EMP-003', fullName: 'Fabricated Gamma', jobTitle: null, department: null, employmentStatus: 'Active', archived: true, accountState: 'none', accountManageable: false };
const PEOPLE = { employees: [E1, E3] };
const ID1 = '1'.repeat(32), ID2 = '2'.repeat(32), ID3 = '3'.repeat(32), ID4 = '4'.repeat(32), ID5 = '5'.repeat(32), IDO = 'a'.repeat(32);
const plan = (id, emp, code, status, version, extra) => Object.assign({ id: id, employeeId: emp, monthKey: MONTH, status: status,
  employeeCode: code, employeeName: 'Fabricated ' + code, department: null, baseSalary: '5000000.00', overtimeAmount: '0.00',
  overtimeHours: '0.00', overtimeCount: 0, totalAmount: '5000000.00', version: version }, extra || {});
const P1 = plan(ID1, 'e_1', 'EMP-001', 'Draft', 1, { employeeName: 'Fabricated <Alpha>', department: 'Ops & <Co>', baseSalary: '8000000.50',
  overtimeAmount: '12345.00', overtimeHours: '7.50', overtimeCount: 1, totalAmount: '999.00' });   // NOT base + overtime
const P2 = plan(ID2, 'e_2', 'EMP-002', 'Reviewed', 2);
const P3 = plan(ID3, 'e_4', 'EMP-004', 'Ready', 3);
const P4 = plan(ID4, 'e_5', 'EMP-005', 'Committed', 4);
const P5 = plan(ID5, 'e_6', 'EMP-006', 'Cancelled', 2);
const MONTH_ALL = { payrollPlans: [P1, P2, P3, P4, P5] };
const OT1 = { id: IDO, hours: '7.50', amount: '12345.00' };
const det = (p, ot) => ({ payrollPlan: p, payrollPlanOvertime: ot || [] });
const GEN = { payrollPlans: [P1, P2, P3, P4], excluded: [{ employeeId: 'e_3', reason: 'archived' }, { employeeId: 'e_9', reason: 'salary_missing' }, { employeeId: 'e_1', reason: 'not_active' }] };
const bumped = (p, status) => Object.assign({}, p, { status: status, version: p.version + 1 });
// AFI-4c2: a Ready plan whose total is deliberately NOT base + overtime (only the exact string may
// be sent); an Employee's own Committed plan (also inconsistent on purpose).
const ID6 = '6'.repeat(32), ID7 = '7'.repeat(32);
const PRX = plan(ID6, 'e_7', 'EMP-007', 'Ready', 5, { baseSalary: '8000000.50', overtimeAmount: '12345.00', overtimeHours: '7.50', overtimeCount: 1, totalAmount: '999.00' });
const MINE = plan(ID7, 'emp_srv_1', 'EMP-777', 'Committed', 4, { employeeName: 'Fabricated Self', baseSalary: '1000000.00', overtimeAmount: '54688.00', overtimeHours: '2.50', overtimeCount: 1, totalAmount: '777.00' });
const MONTH_RX = { payrollPlans: [P1, P2, P3, P4, P5, PRX] };
// AFI-4d: Supplemental Payroll fixtures — Committed base plans P4, P8, P9; documents whose amount
// deliberately differs from their lines (only the exact strings may be shown or sent).
const ID8 = '8'.repeat(32), ID9 = '9'.repeat(32), IDO2 = 'b'.repeat(32), IDO3 = 'c'.repeat(32);
const P8 = plan(ID8, 'e_8', 'EMP-008', 'Committed', 3);
const P9 = plan(ID9, 'e_9', 'EMP-009', 'Committed', 3);
const MONTH_S = { payrollPlans: [P1, P2, P3, P4, P5, P8, P9] };
const sdoc = (id, p, status, version, extra) => Object.assign({ id: id, payrollPlanId: p.id, employeeId: p.employeeId, monthKey: MONTH, status: status,
  employeeCode: p.employeeCode, employeeName: p.employeeName, department: null, overtimeAmount: '4321.00', overtimeHours: '2.25', overtimeCount: 1, version: version }, extra || {});
const SID_DRAFT = 'd1'.repeat(16), SID_REV = 'd2'.repeat(16), SID_READY = 'd3'.repeat(16), SID_COM = 'd4'.repeat(16), SID_CAN = 'd5'.repeat(16),
  SID_COM2 = 'd6'.repeat(16), SID_NEW = 'd7'.repeat(16), SID_MINE1 = 'e1'.repeat(16), SID_MINE2 = 'e2'.repeat(16);
const SREV = sdoc(SID_REV, P4, 'Reviewed', 2);
const SCOM = sdoc(SID_COM, P4, 'Committed', 4);
const SCAN = sdoc(SID_CAN, P4, 'Cancelled', 2);
const SCOM2 = sdoc(SID_COM2, P4, 'Committed', 4, { overtimeAmount: '99.00', overtimeHours: '0.25' });
const SDRAFT = sdoc(SID_DRAFT, P8, 'Draft', 1);
const SREADY = sdoc(SID_READY, P9, 'Ready', 3);
const SNEW = sdoc(SID_NEW, P4, 'Draft', 1, { overtimeAmount: '7777.00', overtimeHours: '3.50', overtimeCount: 2 });
const SMINE1 = sdoc(SID_MINE1, MINE, 'Committed', 4);
const SMINE2 = sdoc(SID_MINE2, MINE, 'Committed', 4, { overtimeAmount: '99.00', overtimeHours: '0.25' });
const SMONTH = { supplementalPayrolls: [SREV, SCOM, SCAN, SCOM2, SDRAFT, SREADY] };
const SLINE = { id: IDO2, hours: '2.25', amount: '1234.00' };
const SLINE2 = { id: IDO3, hours: '0.25', amount: '11.00' };
const ELIG = { payrollPlanId: ID4, employeeId: 'e_5', eligibleCount: 2, eligibleHours: '3.50', eligibleAmount: '7777.00' };
const ELIG0 = { payrollPlanId: ID8, employeeId: 'e_8', eligibleCount: 1, eligibleHours: '0.25', eligibleAmount: '0.00' };
const ELIGX = { payrollPlanId: '0'.repeat(32), employeeId: 'e_0', eligibleCount: 1, eligibleHours: '1.00', eligibleAmount: '500.00' };
const SELIGS = { supplementalEligibility: [ELIG, ELIG0, ELIGX] };
const ME_CEO_PRINCIPAL = { id: 'u_ceo_x', principalType: 'ceo', employeeId: null };
// AFI-4e: a Committed plan (total 999.00, NOT base + overtime) and the postings of it and of SCOM.
const IDPC = 'ab'.repeat(16), FID1 = 'f1'.repeat(16), FID2 = 'f2'.repeat(16), FID3 = 'f3'.repeat(16), FID4 = 'f4'.repeat(16);
const PCX = plan(IDPC, 'e_c', 'EMP-0C', 'Committed', 4, { baseSalary: '8000000.50', overtimeAmount: '12345.00', overtimeHours: '7.50', overtimeCount: 1, totalAmount: '999.00' });
const MONTH_F = { payrollPlans: [P1, P2, P3, P4, P5, PCX] };

const LIST = (m) => '/api/payroll-plans?month=' + m;
const DET = (id) => '/api/payroll-plan?id=' + id;
const EMPS = '/api/employees?archived=1';
const W = { generate: '/api/payroll-plans/generate', review: '/api/payroll-plans/review', approve: '/api/payroll-plans/approve',
  return: '/api/payroll-plans/return', cancel: '/api/payroll-plans/cancel', commit: '/api/payroll-plans/commit' };
const DRIFT = (id) => '/api/payroll-plan/drift?id=' + id;
const COMMIT_KEYS = 'expectedTotal,expectedVersion,id,idempotencyKey';
// AFI-4d: the BF-4d Supplemental routes.
const SLIST = (m) => '/api/supplemental-payrolls?month=' + m;
const SDET = (id) => '/api/supplemental-payroll?id=' + id;
const SELIG = (m) => '/api/supplemental-payrolls/eligibility?month=' + m;
const SW = { generate: '/api/supplemental-payrolls/generate', review: '/api/supplemental-payrolls/review', approve: '/api/supplemental-payrolls/approve',
  return: '/api/supplemental-payrolls/return', cancel: '/api/supplemental-payrolls/cancel', commit: '/api/supplemental-payrolls/commit' };

/* ---------- scripted responses ---------- */
function resp(status, body, headers){
  const h = Object.assign({ 'content-type': 'application/json; charset=utf-8' }, headers || {});
  const lower = {}; Object.keys(h).forEach(function(k){ lower[k.toLowerCase()] = h[k]; });
  return { status: status,
    headers: { get: function(n){ const v = lower[String(n).toLowerCase()]; return v === undefined ? null : v; } },
    text: async function(){ return typeof body === 'string' ? body : JSON.stringify(body); } };
}
const ok = (data) => resp(200, { ok: true, data: data, requestId: RID });
const err = (status, code) => resp(status, { ok: false, error: { code: code, message: 'server text' }, requestId: RID });
const NETFAIL = () => new TypeError('Failed to fetch');
const one = (p) => ({ payrollPlan: p });
const driftOk = (id, reasons) => ok({ payrollPlanDrift: { id: id, current: reasons.length === 0, reasons: reasons } });
const sone = (d) => ({ supplementalPayroll: d });
const sdet = (d, lines) => ({ supplementalPayroll: d, supplementalPayrollOvertime: lines || [] });
// AFI-4e: the BF-4e Finance posting routes, a Committed plan whose total is NOT base + overtime,
// and its postings.
const FIN = (m) => '/api/finance-postings?month=' + m;
const FW = { plan: '/api/finance-postings/payroll-plan', supp: '/api/finance-postings/supplemental-payroll' };
const FIN_PLAN_KEYS = 'expectedAmount,idempotencyKey,payrollPlanId';
const FIN_SUPP_KEYS = 'expectedAmount,idempotencyKey,supplementalPayrollId';
const finOk = (list) => ok({ financePostings: list });
const fone = (p) => ok({ financePosting: p });
const posting = (id, kind, src, amount) => ({ id: id, sourceKind: kind, sourceId: src.id, employeeId: src.employeeId, monthKey: MONTH, amount: amount, status: 'Planned' });
// AFI-4f: the BF-4f Finance execution routes and executions of the postings above.
const EXE = (m) => '/api/finance-executions?month=' + m;
const EXW = '/api/finance-executions/execute';
const EXEC_KEYS = 'executedOn,expectedAmount,financePostingId,idempotencyKey,paymentMethod';
const exeOk = (list) => ok({ financeExecutions: list });
const xone = (e) => ok({ financeExecution: e });
const execution = (id, p, date, method, amount) => ({ id: id, financePostingId: p.id, employeeId: p.employeeId, monthKey: p.monthKey, amount: amount || p.amount, executedOn: date, paymentMethod: method });
const XID1 = 'e7'.repeat(16), XID2 = 'e8'.repeat(16);
function deferred(){ let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise: promise, resolve: resolve }; }

/* ---------- a recording #app (the SESSION harnesses' element) ---------- */
const unescapeHtml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function mkApp(mkEl, dom){
  let html = '';
  let elements = {};
  const tagOf = (id) => new RegExp('<([a-z]+)[^>]*\\sid="' + id + '"[^>]*>').exec(html);
  function valueOf(id, tag){
    if(tag[1] === 'input'){ const v = /\svalue="([^"]*)"/.exec(tag[0]); return v ? unescapeHtml(v[1]) : ''; }
    return '';
  }
  function find(sel){
    const m = /^#([A-Za-z0-9_-]+)$/.exec(sel);
    if(!m) return null;
    const id = m[1];
    const tag = tagOf(id);
    if(!tag) return null;
    if(!elements[id]){
      const listeners = {};
      elements[id] = { id: id, name: (/\sname="([^"]*)"/.exec(tag[0]) || [])[1] || '', value: valueOf(id, tag), listeners: listeners,
        disabled: /\sdisabled(\s|>|=)/.test(tag[0]),
        addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
        focus: () => { dom.focused.push(id); if(dom.doc) dom.doc.activeElement = elements[id]; }, setSelectionRange: () => {}, querySelector: find, getAttribute: () => null };
    }
    return elements[id];
  }
  const app = mkEl();
  app.querySelector = find;
  app.querySelectorAll = () => [];
  app.contains = () => true;
  Object.defineProperty(app, 'innerHTML', { get: () => html, set: (v) => { html = String(v); elements = {}; } });
  app.fire = (id, type) => {
    const el = find('#' + id);
    if(!el) return 'absent';
    if(el.disabled) return 'disabled';
    (el.listeners[type] || []).forEach((fn) => fn.call(el, { preventDefault: () => {} }));
    return 'fired';
  };
  app.set = (id, value) => {
    const el = find('#' + id);
    if(!el || el.disabled) return false;
    el.value = value;
    (el.listeners.input || []).forEach((fn) => fn.call(el, {}));
    (el.listeners.change || []).forEach((fn) => fn.call(el, {}));
    return true;
  };
  return app;
}

/* ---------- runtime loader ---------- */
function loadRuntime(routes, opts){
  const jsFiles = require(path.join(root, 'tools', 'module-order.js'));
  const parts = jsFiles.map((f) => {
    let src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
    if(f === 'core/constants.js'){
      const assigns = src.match(/const AUTH_MODE = [^;\n]+;/g) || [];
      if(assigns.length !== 1) throw new Error('expected exactly one AUTH_MODE assignment');
      src = src.replace(assigns[0], 'const AUTH_MODE = AUTH_MODES.SESSION;');
    }
    if(f === 'core/app-bootstrap.js'){
      src = NEVER.map((n) => 'try { ' + n + ' = (function(){ return function(){ __spy.push("' + n + '"); return ""; }; })(); } catch(_e){ __spyErr.push("' + n + '"); }').join('\n') + '\n' + src;
    }
    return src;
  });
  const src = parts.join('\n')
    + '\n;window.__TAM__ = { State: State, AuthBoot: AuthBoot, AUTH_STATES: AUTH_STATES, CsrfHolder: CsrfHolder,'
    + ' SessionIdentityProvider: SessionIdentityProvider, API_RESULT_KINDS: API_RESULT_KINDS, API_BODY_KEY_EXCEPTION: API_BODY_KEY_EXCEPTION,'
    + ' PayrollApi: PayrollApi, PayrollDecoders: PayrollDecoders, PayrollRequests: PayrollRequests,'
    + ' SessionPayrollStore: SessionPayrollStore, SessionPayroll: SessionPayroll, SessionOvertimeStore: SessionOvertimeStore,'
    + ' sessionPayrollActions: sessionPayrollActions, sessionPayrollCurrentMonth: sessionPayrollCurrentMonth,'
    + ' sessionPayrollExcludedName: sessionPayrollExcludedName, render: render, parse: function(json){ return JSON.parse(json); },'
    + ' sessionPayrollIntentState: sessionPayrollIntentState, payrollIdempotencyKey: payrollIdempotencyKey, PAYROLL_DRIFT_REASONS: PAYROLL_DRIFT_REASONS,'
    + ' SupplementalApi: SupplementalApi, SupplementalDecoders: SupplementalDecoders, SupplementalRequests: SupplementalRequests,'
    + ' sessionSupplementalActions: sessionSupplementalActions, sessionSupplementalIntentState: sessionSupplementalIntentState,'
    + ' LOCAL_SUPPLEMENTAL_STATUSES: SUPPLEMENTAL_STATUSES,'
    + ' FinancePostingApi: FinancePostingApi, FinancePostingDecoders: FinancePostingDecoders, FinancePostingRequests: FinancePostingRequests,'
    + ' financePostingIntent: financePostingIntent, sessionFinanceStatus: sessionFinanceStatus, sessionFinanceIntentState: sessionFinanceIntentState,'
    + ' FinanceExecutionApi: FinanceExecutionApi, FinanceExecutionDecoders: FinanceExecutionDecoders, FinanceExecutionRequests: FinanceExecutionRequests,'
    + ' financeExecutionIntent: financeExecutionIntent, financeExecutionToday: financeExecutionToday, FINANCE_EXECUTION_PAYMENT_METHODS: FINANCE_EXECUTION_PAYMENT_METHODS,'
    + ' sessionFinanceExecutionStatus: sessionFinanceExecutionStatus, sessionFinanceExecutionIntentState: sessionFinanceExecutionIntentState, LOCAL_PAYMENT_METHODS: PAYMENT_METHODS };';
  const noop = function(){};
  const access = { local: [], session: [], url: [], cookie: [] };
  const storageOf = (log) => {
    const mem = {};
    return {
      getItem: (k) => { log.push('get:' + k); return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: (k, v) => { log.push('set:' + k); mem[k] = String(v); },
      removeItem: (k) => { log.push('remove:' + k); delete mem[k]; },
      key: () => null, get length(){ return 0; }, clear: () => { log.push('clear'); }
    };
  };
  const mkEl = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'', value:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, removeChild:noop, setAttribute:noop,
    getAttribute:()=>null, remove:noop, focus:noop, contains:()=>false, querySelector:()=>null, querySelectorAll:()=>[],
    classList:{ add:noop, remove:noop, toggle:noop, contains:()=>false } });
  const els = {};
  const dom = { focused: [] };
  els.app = mkApp(mkEl, dom);
  const net = { calls: [], routes: routes || {}, timers: [] };
  const fetchStub = function(url, init){
    net.calls.push({ url: url, init: init });
    return new Promise(function(resolve, reject){
      if(init && init.signal) init.signal.addEventListener('abort', function(){ const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
      const q = net.routes[url] || [];
      const next = q.length > 1 ? q.shift() : q[0];
      Promise.resolve().then(function(){
        if(!next) return reject(new TypeError('no route'));
        if(next === 'HANG') return;
        if(next && typeof next.then === 'function') return next.then((v) => (v instanceof Error ? reject(v) : resolve(v)));
        const out = typeof next === 'function' ? next(init) : next;
        if(out instanceof Error) reject(out); else resolve(out);
      });
    });
  };
  const RealDate = Date;
  function FixedDate(...a){
    if(!new.target) return new RealDate(FIXED_NOW).toString();
    return a.length ? new RealDate(...a) : new RealDate(FIXED_NOW);
  }
  FixedDate.UTC = RealDate.UTC; FixedDate.parse = RealDate.parse; FixedDate.now = () => FIXED_NOW;
  FixedDate.prototype = RealDate.prototype;
  const document = { addEventListener:noop, removeEventListener:noop,
    getElementById: (id) => (els[id] = els[id] || mkEl()),
    querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>mkEl(), contains:()=>false,
    body: mkEl(), documentElement: { dataset:{}, style:{} }, activeElement: null };
  Object.defineProperty(document, 'cookie', { get: () => { access.cookie.push('get'); return ''; }, set: () => { access.cookie.push('set'); } });
  const sandbox = {
    __spy: [], __spyErr: [], Date: FixedDate,
    console: { log:noop, warn:noop, error:noop, info:noop }, navigator: { userAgent:'tam-afi4c1' },
    setTimeout: function(fn, ms){ if(ms === 10000){ net.timers.push(fn); return 'api-timer-' + net.timers.length; } return setTimeout(fn, ms); },
    clearTimeout: function(id){ if(!/^api-timer-/.test(String(id))) clearTimeout(id); },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    AbortController: AbortController, fetch: fetchStub,
    localStorage: storageOf(access.local), sessionStorage: storageOf(access.session), storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: () => { access.url.push('confirm()'); return true; },
    location: { hash: '', search: '', pathname: '/', href: 'http://127.0.0.1/' },
    history: { replaceState: (a, b, u) => { access.url.push(String(u)); }, pushState: (a, b, u) => { access.url.push(String(u)); } },
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: document
  };
  // AFI-4c2: a deterministic Web Crypto (every key is predictable here, and every call counted);
  // opts.noCrypto: a browser without crypto.getRandomValues.
  const cryptoLog = { calls: 0, last: null };
  if(!(opts && opts.noCrypto)) sandbox.crypto = { getRandomValues: function(a){
    cryptoLog.calls++;
    for(let i = 0; i < a.length; i++) a[i] = (cryptoLog.calls * 37 + i * 11 + 171) & 255;
    cryptoLog.last = Array.from(a).map((b) => (b < 16 ? '0' : '') + b.toString(16)).join('');
    return a;
  } };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  dom.doc = sandbox.document;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-afi4c1-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.net = net; rt.access = access; rt.spy = sandbox.__spy; rt.spyErr = sandbox.__spyErr; rt.crypto = cryptoLog;
  rt.appHTML = () => (els.app ? els.app.innerHTML : '');
  rt.app = els.app; rt.dom = dom; rt.loc = sandbox.location;
  rt.pr = () => rt.SessionPayrollStore.snapshot();
  rt.state = () => rt.AuthBoot.snapshot().state;
  return rt;
}
const flush = async (n) => { for(let i = 0; i < (n || 10); i++) await new Promise((r) => setImmediate(r)); };
const posts = (rt, route) => rt.net.calls.filter((c) => c.init && c.init.method === 'POST' && (route ? c.url === route : /^\/api\/payroll-plans\//.test(c.url)));
const bodyOf = (c) => JSON.parse(c.init.body);
const countOf = (rt, url) => rt.net.calls.filter((c) => c.url === url).length;
const payrollCalls = (rt) => rt.net.calls.filter((c) => /^\/api\/payroll/.test(c.url));
const keys = (o) => Object.keys(o).sort().join();
// AFI-4f security: no regex HTML filtering. rawScript() reports any raw <script opening or closing
// tag in rendered HTML, whatever its case (the page is lower-cased first; no regex is involved);
// escapedForm() is the exact text a payload must become (js/core/utils.js escapeHtml's mapping).
const rawScript = (html) => { const h = String(html).toLowerCase(); return h.indexOf('<script') !== -1 || h.indexOf('</script') !== -1; };
const escapedForm = (v) => String(v).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;').split("'").join('&#39;');
const buttons = (html) => ['swpReviewBtn', 'swpApproveBtn', 'swpReturnBtn', 'swpCancelBtn'].filter((b) => html.indexOf('id="' + b + '"') !== -1).map((b) => b.slice(3, -3)).join();
// AFI-4d: the Supplemental writes and the Supplemental action buttons shown, in page order.
const suppPosts = (rt, route) => rt.net.calls.filter((c) => c.init && c.init.method === 'POST' && (route ? c.url === route : /^\/api\/supplemental-payrolls\//.test(c.url)));
const suppButtons = (html) => ['swpSuppReviewBtn', 'swpSuppApproveBtn', 'swpSuppReturnBtn', 'swpSuppCancelBtn', 'swpSuppCommitBtn']
  .filter((b) => html.indexOf('id="' + b + '"') !== -1).sort((a, b) => html.indexOf('id="' + a + '"') - html.indexOf('id="' + b + '"')).map((b) => b.slice(7, -3)).join();

async function boot(me, routes, opts){
  // AFI-4e: the CEO's Finance read of the month answers no posting unless a test says otherwise.
  // AFI-4f authorized revision: and the month's executions none. Was: the postings only.
  const base = me.role === 'ceo' ? { '/api/employees': [ok({ employees: [E1] })], [FIN(MONTH)]: [finOk([])], [EXE(MONTH)]: [exeOk([])] } : { '/api/employee?id=emp_srv_1': [ok({ employee: { id: 'emp_srv_1', employeeCode: 'EMP-777', fullName: 'Fabricated Self', jobTitle: null, department: null, employmentStatus: 'Active', joinDate: null, contactEmail: null, phone: null, monthlyBaseSalary: '1000000.00' } })] };
  const rt = loadRuntime(Object.assign({ '/api/auth/me': [ok(me)] }, base, routes || {}), opts);
  await flush();
  return rt;
}
// Signed in as the CEO, the Payroll section opened by its section button.
async function open(routes){
  const rt = await boot(ME_CEO, Object.assign({ [LIST(MONTH)]: [ok(MONTH_ALL)] }, routes || {}));
  rt.app.fire('swSectionPayroll', 'click'); await flush();
  return rt;
}
// AFI-4c2: the Ready plan PRX open (its drift current unless `routes` says otherwise).
async function openReady(routes, opts){
  const rt = await boot(ME_CEO, Object.assign({ [LIST(MONTH)]: [ok(MONTH_RX)], [DET(ID6)]: [ok(det(PRX, [OT1]))], [DRIFT(ID6)]: [driftOk(ID6, [])] }, routes || {}), opts);
  rt.app.fire('swSectionPayroll', 'click'); await flush();
  rt.app.fire('swpOpen5', 'click'); await flush();
  return rt;
}
// The detail of `id` open.
async function detail(id, answer, routes){
  const rt = await open(Object.assign({ [DET(id)]: [ok(answer)] }, routes || {}));
  const i = (rt.pr().list || []).findIndex((p) => p.id === id);
  rt.app.fire('swpOpen' + i, 'click'); await flush();
  return rt;
}

// AFI-4d: signed in as the CEO, the Payroll month page with its Supplemental card.
async function openS(routes, opts){
  const rt = await boot(ME_CEO, Object.assign({ [LIST(MONTH)]: [ok(MONTH_S)], [SLIST(MONTH)]: [ok(SMONTH)], [SELIG(MONTH)]: [ok(SELIGS)] }, routes || {}), opts);
  rt.app.fire('swSectionPayroll', 'click'); await flush();
  return rt;
}
// AFI-4d: the Supplemental document `doc` of SMONTH open, with `lines`.
async function suppDetail(doc, lines, routes, opts){
  const rt = await openS(Object.assign({ [SDET(doc.id)]: [ok(sdet(doc, lines))] }, routes || {}), opts);
  const i = SMONTH.supplementalPayrolls.findIndex((x) => x.id === doc.id);
  rt.app.fire('swpSuppOpen' + i, 'click'); await flush();
  return rt;
}

// AFI-4e: signed in as the CEO, the Committed plan PCX open (no posting unless `routes` says so).
async function openFin(routes, opts){
  const rt = await boot(ME_CEO, Object.assign({ [LIST(MONTH)]: [ok(MONTH_F)], [DET(IDPC)]: [ok(det(PCX, [OT1]))] }, routes || {}), opts);
  rt.app.fire('swSectionPayroll', 'click'); await flush();
  rt.app.fire('swpOpen5', 'click'); await flush();
  return rt;
}
// AFI-4f authorized revision: the posting commands only (the execution command: exPosts). Was: any /api/finance POST.
const finPosts = (rt, route) => rt.net.calls.filter((c) => c.init && c.init.method === 'POST' && (route ? c.url === route : /^\/api\/finance-postings/.test(c.url)));
// AFI-4f: the plan PCX open, posted (FPCX) and with no execution unless `routes` says otherwise; the
// execution writes; the two form fields set as a browser would (input + change).
const FPCX = posting(FID1, 'payrollPlan', PCX, '999.00');
const FSCX = posting(FID2, 'supplementalPayroll', SCOM, '4321.00');
async function openPay(routes, opts){ return openFin(Object.assign({ [FIN(MONTH)]: [finOk([FPCX])] }, routes || {}), opts); }
const exPosts = (rt) => rt.net.calls.filter((c) => c.init && c.init.method === 'POST' && c.url === EXW);
function fill(rt, date, method){ if(date !== null) rt.app.set('swpPayDate', date); if(method !== null) rt.app.set('swpPayMethod', method); }
async function recordOnce(rt, date, method){
  rt.app.fire('swpPayRecordBtn', 'click'); await flush();
  fill(rt, date || '2031-04-10', method || 'bankTransfer');
  rt.app.fire('swpPanelConfirm', 'click'); await flush();
}

// The SESSION firewall, after every phase.
function firewall(rt, label, overtimeOpened){
  check(rt.access.local.length === 0 && rt.access.session.length === 0 && rt.access.cookie.length === 0,
    label + ': zero localStorage / sessionStorage / cookie access');
  check(rt.spy.length === 0, label + ': no LOCAL boot, shell, "Acting as", Global Search, LOCAL payroll engine or page, or other domain was called' + (rt.spy.length ? ' >> ' + rt.spy.join(', ') : ''));
  const html = rt.appHTML();
  check(!/identity-selector|identityPrincipalSelect|Acting as|class="sidebar"|data-nav=|Smart Import|Backup|Restore|Start fresh/i.test(html),
    label + ': no "Acting as", navigation or local data tool in the DOM');
  check(!/\b(pph|bpjs|thr|tax|allowance|deduction|bonus|benefit|loan|statutory|gross|net pay|payslip)\b/i.test(html),
    label + ': no statutory payroll, payslip or gross / net vocabulary in the DOM');
  // AFI-4c2 authorized revision: the Commit confirmation, like the preparation one, says nothing is
  // posted to Finance. Was: only the preparation confirmation.
  // AFI-4d authorized revision: the Supplemental preparation and Commit confirmations say so too.
  // Was: the payroll preparation and Commit confirmations only.
  const outsideGenerate = html.replace(/<section class="card" aria-labelledby="swpPanelTitle"[^>]*><h2 [^>]*>(Prepare payroll for this month|Commit this payroll plan|Prepare supplemental payroll|Commit this supplemental payroll)\?<\/h2>[\s\S]*?<\/section>/, '');
  // AFI-4e authorized revision: the CEO's Finance card of a Committed source, the posting
  // confirmation ("… Nothing is paid or executed. …") and the posting messages speak of Finance and
  // Posted (pinned below and in sections F–F9). Was: no Finance wording outside those confirmations.
  const sp = rt.pr();
  // AFI-4f authorized revision: the Record payment form and its messages too (pinned in sections
  // X–X9). Was: the posting confirmation and the posting messages only.
  const finOwned = ['finPostPlan', 'finPostSupp', 'finRecordPlan', 'finRecordSupp'].indexOf(sp.mutation.kind) !== -1 || /^(fin|pay)/.test(sp.notice || '');
  let finFree = outsideGenerate.replace(/<section class="card" id="swpFinance"[\s\S]*?<\/section>/g, '')
    .replace(/<section class="card" aria-labelledby="swpPanelTitle"[^>]*><h2 [^>]*>Post this (payroll|supplemental payroll) to Finance\?<\/h2>[\s\S]*?<\/section>/, '')
    .replace(/<section class="card" aria-labelledby="swpPanelTitle"[^>]*><h2 [^>]*>Record the payment of this (payroll|supplemental payroll)\?<\/h2>[\s\S]*?<\/section>/, '');
  if(finOwned) finFree = finFree.replace(/<p class="auth-message[^"]*" id="swpMutationMessage"[^>]*>[^<]*<\/p>/, '');
  check(!/Finance|ledger|journal|payment|Execut|Posted|Post to/i.test(finFree) && !/\bPaid\b|Mark paid|\bPay\b/.test(html),
    label + ': no Finance, payment, execution or posting wording (only the preparation and Commit confirmations say nothing is posted to Finance; AFI-4e: the Finance card, the posting confirmation and its messages)');
  // AFI-4c2 authorized revision (D-AFI4c2-3 = A): Commit payroll / Retry commit exist, on a Ready
  // plan of the CEO only. Was: no Commit control or wording at all.
  const who = rt.AuthBoot.snapshot().principal;
  const d = rt.pr().detail;
  check(!/expectedTotal|expectedAmount|idempotency/i.test(html) && (!/id="swp(Commit|RetryCommit)Btn"/.test(html) || (!!who && who.principalType === 'ceo' && !!d && d.plan.status === 'Ready')),
    label + ': a Commit control appears only on a Ready plan shown to the CEO; no key, total or expected amount field in the page');
  // AFI-4e: the Finance card, its controls and the posting confirmation only on a Committed plan or
  // Supplemental document shown to the CEO.
  const sd = sp.suppDetail;
  const committedShown = (!!d && !!sp.detailId && d.plan.status === 'Committed') || (!!sd && !!sp.suppDetailId && sd.doc.status === 'Committed');
  // AFI-4f authorized revision: the payment status, its controls and the Record payment form too.
  const finShown = /id="swpFinance"|id="swp(Fin|SuppFin)(Post|RetryPost)Btn"|id="swpFinRetryBtn"|Post this (payroll|supplemental payroll) to Finance\?/.test(html)
    || /id="swpPayment"|id="swp(Pay|SuppPay)RecordBtn"|id="swpPay(Retry|StatusRetry)Btn"|id="swpPay(Date|Method)"|Record the payment of this/.test(html);
  check(!finShown || (!!who && who.principalType === 'ceo' && committedShown), label + ': Finance appears only on a Committed plan or Supplemental document shown to the CEO');
  // AFI-4d authorized revision: a Supplemental document's captured overtime record ids too. Was: IDO only.
  check(!new RegExp('[0-9a-f]{32}').test(html.replace(RID, '').replace(new RegExp(IDO + '|' + IDO2 + '|' + IDO3, 'g'), '')), label + ': no opaque plan or document id in the page (only an overtime record id, by design)');
  check(rt.State.employees.length === 0 && rt.State.payrollPlans.length === 0 && rt.State.storageReady === false && rt.AuthBoot.allowsWorkspace() === false,
    label + ': legacy State (employees, payroll plans) stays empty and the business shell is never granted');
  check(rt.access.url.length === 0 && rt.loc.hash === '' && rt.loc.search === '', label + ': nothing written to the address bar or history; no browser confirm()');
  const bad = posts(rt).filter((c) => {
    const b = bodyOf(c);
    const want = c.url === W.generate ? 'month' : c.url === W.commit ? COMMIT_KEYS : 'expectedVersion,id';
    return keys(b) !== want || c.init.headers['X-CSRF-Token'] === undefined;
  });
  check(bad.length === 0, label + ': every Payroll write is a CSRF POST of exactly { month }, { id, expectedVersion } or (commit) { id, expectedVersion, expectedTotal, idempotencyKey } — no employee, company, role, status or other money');
  // AFI-4c2 authorized revision: POST /api/payroll-plans/commit exists (CEO). Was: never a commit request.
  // AFI-4e authorized revision: the CEO's Finance month read and the two BF-4e posting commands
  // exist (an Employee makes none: below). Was: no Finance request at all.
  // AFI-4f authorized revision: plus exactly the BF-4f month read of the executions and the one
  // execution command (CEO). Was: the posting read and the two posting commands only.
  check(rt.net.calls.every((c) => !(overtimeOpened ? /^\/api\/(transactions|payments)/ : /^\/api\/(overtime|transactions|payments)/).test(c.url) && !/^\/api\/payroll-plans\/(status|pay|post)/.test(c.url)
      && (!/^\/api\/finance/.test(c.url) || (/^\/api\/finance-(postings|executions)\?month=[0-9]{4}-[0-9]{2}$/.test(c.url) && (!c.init || !c.init.method || c.init.method === 'GET'))
        || ((c.url === FW.plan || c.url === FW.supp || c.url === EXW) && !!c.init && c.init.method === 'POST'))),
    label + ': no Overtime, status or payment request is ever made by the Payroll section; Finance only as the two month reads, the two posting commands and the one execution command');
  const badFin = finPosts(rt).filter((c) => keys(bodyOf(c)) !== (c.url === FW.plan ? FIN_PLAN_KEYS : FIN_SUPP_KEYS) || c.init.headers['X-CSRF-Token'] === undefined);
  check(badFin.length === 0, label + ': every Finance posting is a CSRF POST of exactly { payrollPlanId | supplementalPayrollId, expectedAmount, idempotencyKey }');
  // AFI-4f: every execution command is a CSRF POST of exactly the five BF-4f keys.
  const badExe = exPosts(rt).filter((c) => keys(bodyOf(c)) !== EXEC_KEYS || c.init.headers['X-CSRF-Token'] === undefined);
  check(badExe.length === 0, label + ': every execution command is a CSRF POST of exactly { financePostingId, expectedAmount, executedOn, paymentMethod, idempotencyKey }');
  if(who && who.principalType === 'employee'){
    check(posts(rt).length === 0 && rt.net.calls.every((c) => !/^\/api\/payroll-plan\/drift/.test(c.url)), label + ': an Employee never writes Payroll and never reads drift');
    // AFI-4d: nor writes Supplemental payroll or reads its eligibility.
    check(suppPosts(rt).length === 0 && rt.net.calls.every((c) => !/^\/api\/supplemental-payrolls\/eligibility/.test(c.url)), label + ': an Employee never writes Supplemental payroll and never reads its eligibility');
    // AFI-4e: nor reads or writes Finance.
    check(rt.net.calls.every((c) => !/^\/api\/finance/.test(c.url)) && sp.fin === null && sp.postIntent === null, label + ': an Employee never reads or writes Finance');
    // AFI-4f: nor reads or writes an execution.
    check(sp.exec === null && sp.execIntent === null && sp.execStatus === 'idle', label + ': an Employee never reads or records a payment');
  }
  // AFI-4d: every Supplemental write is a CSRF POST of exactly { payrollPlanId }, { id, expectedVersion }
  // or (commit) { id, expectedVersion, expectedTotal, idempotencyKey }; the LOCAL engine's words never appear.
  const badSupp = suppPosts(rt).filter((c) => {
    const want = c.url === SW.generate ? 'payrollPlanId' : c.url === SW.commit ? COMMIT_KEYS : 'expectedVersion,id';
    return keys(bodyOf(c)) !== want || c.init.headers['X-CSRF-Token'] === undefined;
  });
  check(badSupp.length === 0 && !/Supplemental Payments|Supplements|overtime_drift/.test(html), label + ': every Supplemental write has exactly its BF-4d keys and the CSRF token; no LOCAL Supplemental wording');
}

(async function main(){
  console.log('== AFI-4c1 + AFI-4c2 + AFI-4d + AFI-4e + AFI-4f SESSION PAYROLL — RUNTIME VERIFICATION ==');

  /* ---------- 0. the harness itself ---------- */
  {
    const rt = loadRuntime({});
    check(rt.spyErr.length === 0, '0. every forbidden function is a replaceable declaration and is spied' + (rt.spyErr.length ? ' >> ' + rt.spyErr.join(', ') : ''));
    check(/const AUTH_MODE = AUTH_MODES\.LOCAL;/.test(fs.readFileSync(path.join(root, 'js', 'core', 'constants.js'), 'utf8')), '0. the committed AUTH_MODE is LOCAL (SESSION exists only inside this harness)');
    check(rt.sessionPayrollCurrentMonth() === MONTH, '0. the injected clock drives the page: "now" is 2031-04, whatever the real date');
    check(JSON.stringify(rt.API_BODY_KEY_EXCEPTION) === JSON.stringify({ method: 'POST', path: '/api/overtime-records/create', key: 'employeeId' }),
      '0. D-AFI4b1-3 is unchanged: the one body-key exception is employeeId on POST /api/overtime-records/create');
  }

  /* ---------- A. strict DTO decoders ---------- */
  {
    const rt = loadRuntime({});
    const D = rt.PayrollDecoders;
    const P = (o) => rt.parse(JSON.stringify(o));
    const good = D.plan(P(P1));
    check(!!good && Object.isFrozen(good) && keys(good) === keys(P1) && good.totalAmount === '999.00' && typeof good.baseSalary === 'string' && good.baseSalary === '8000000.50',
      'A. a canonical plan decodes, frozen, exactly its thirteen keys; money kept as the exact strings sent (even an inconsistent total)');
    check(['Draft', 'Reviewed', 'Ready', 'Committed', 'Cancelled'].every((s) => !!D.plan(P(Object.assign({}, P2, { status: s })))), 'A. the five BF-4c1 statuses decode, Committed included (D-AFI4c1-1 = A)');
    check(!!D.plan(P(Object.assign({}, P2, { baseSalary: '9999999999999.99', totalAmount: '999999999999999.00', overtimeAmount: '999999999999999.00', overtimeHours: '9999999.75', overtimeCount: 4294967295, version: 4294967295 }))),
      'A. column bounds accepted: DECIMAL(15,2) base, DECIMAL(17,2) amounts, DECIMAL(9,2) hours, 2^32-1 count and version');
    const bads = [
      ['unknown key', Object.assign({}, P1, { companyId: 'c' })], ['missing key', (() => { const c = Object.assign({}, P1); delete c.department; return c; })()],
      ['net key', Object.assign({}, P1, { netAmount: '1.00' })], ['live key', Object.assign({}, P1, { liveKey: 1 })],
      ['upper-case id', Object.assign({}, P1, { id: 'A'.repeat(32) })], ['bad employeeId', Object.assign({}, P1, { employeeId: 'e 1' })],
      ['month 13', Object.assign({}, P1, { monthKey: '2031-13' })], ['status Approved (LOCAL word)', Object.assign({}, P1, { status: 'Approved' })],
      ['status Paid', Object.assign({}, P1, { status: 'Paid' })], ['status Posted', Object.assign({}, P1, { status: 'Posted' })],
      ['status draft (case)', Object.assign({}, P1, { status: 'draft' })], ['base number', Object.assign({}, P1, { baseSalary: 8000000.5 })],
      ['base 0.00', Object.assign({}, P1, { baseSalary: '0.00' })], ['base one decimal', Object.assign({}, P1, { baseSalary: '8000000.5' })],
      ['base leading zero', Object.assign({}, P1, { baseSalary: '08000000.50' })], ['total with sen', Object.assign({}, P1, { totalAmount: '999.50' })],
      ['total number', Object.assign({}, P1, { totalAmount: 999 })], ['total negative', Object.assign({}, P1, { totalAmount: '-1.00' })],
      ['overtime with sen', Object.assign({}, P1, { overtimeAmount: '12345.67' })], ['hours not quarter', Object.assign({}, P1, { overtimeHours: '7.10' })],
      ['hours number', Object.assign({}, P1, { overtimeHours: 7.5 })], ['count string', Object.assign({}, P1, { overtimeCount: '1' })],
      ['count without hours', Object.assign({}, P2, { overtimeCount: 1 })], ['hours without count', Object.assign({}, P2, { overtimeHours: '1.00' })],
      ['money without count', Object.assign({}, P2, { overtimeAmount: '5.00' })], ['empty name', Object.assign({}, P1, { employeeName: '' })],
      ['name control char', Object.assign({}, P1, { employeeName: 'a\nb' })], ['code 33', Object.assign({}, P1, { employeeCode: 'x'.repeat(33) })],
      ['department empty', Object.assign({}, P1, { department: '' })], ['version 0', Object.assign({}, P1, { version: 0 })],
      ['version string', Object.assign({}, P1, { version: '1' })], ['version 1.5', Object.assign({}, P1, { version: 1.5 })]
    ];
    bads.forEach(([label, o]) => check(D.plan(P(o)) === null, 'A. refused: ' + label));
    const list = D.monthResponse(P(MONTH_ALL), MONTH);
    check(!!list && list.length === 5 && Object.isFrozen(list) && list.map((p) => p.id).join() === [ID1, ID2, ID3, ID4, ID5].join(), 'A. a month answer decodes in the server order, Cancelled and Committed included');
    check(D.monthResponse(P({ payrollPlans: [P1, Object.assign({}, P2, { status: 'Paid' })] }), MONTH) === null, 'A. one bad plan invalidates the whole list');
    check(D.monthResponse(P({ payrollPlans: [P1] }), '2031-05') === null && D.monthResponse(P({ payrollPlans: [P1], total: '1.00' }), MONTH) === null
      && D.monthResponse(P({ plans: [P1] }), MONTH) === null, 'A. a plan of another month, an extra wrapper key (a total) or another wrapper name invalidates the list');
    const d = D.detailResponse(P(det(P1, [OT1])));
    check(!!d && d.plan.id === ID1 && d.overtime.length === 1 && keys(d.overtime[0]) === 'amount,hours,id' && d.overtime[0].amount === '12345.00', 'A. a detail decodes: the plan and its contributing overtime { id, hours, amount }');
    [['extra overtime key', det(P1, [Object.assign({}, OT1, { valuationSalary: '1.00' })])], ['overtime hours 0.00', det(P1, [Object.assign({}, OT1, { hours: '0.00' })])],
      ['overtime hours 744.25', det(P1, [Object.assign({}, OT1, { hours: '744.25' })])], ['overtime amount with sen', det(P1, [Object.assign({}, OT1, { amount: '1.50' })])],
      ['overtime not a list', { payrollPlan: P1, payrollPlanOvertime: OT1 }], ['extra wrapper key', Object.assign(det(P1, []), { excluded: [] })]]
      .forEach(([label, o]) => check(D.detailResponse(P(o)) === null, 'A. detail refused: ' + label));
    check(!!D.detailResponse(P(det(P1, [Object.assign({}, OT1, { hours: '744.00' })]))) && !!D.detailResponse(P(det(P1, [Object.assign({}, OT1, { hours: '0.25', amount: '0.00' })]))),
      'A. contributing overtime bounds accepted: 744.00 h, 0.25 h, an approved amount of 0.00');
    const g = D.generateResponse(P(GEN), MONTH);
    check(!!g && g.plans.length === 4 && g.excluded.length === 3 && keys(g.excluded[0]) === 'employeeId,reason', 'A. a generate answer decodes: the live plans and the exclusions');
    [['unknown reason', Object.assign({}, GEN, { excluded: [{ employeeId: 'e_3', reason: 'on_leave' }] })], ['exclusion extra key', Object.assign({}, GEN, { excluded: [{ employeeId: 'e_3', reason: 'archived', name: 'x' }] })],
      ['exclusion bad id', Object.assign({}, GEN, { excluded: [{ employeeId: 'e 3', reason: 'archived' }] })], ['a Cancelled plan in a generate answer', Object.assign({}, GEN, { payrollPlans: [P5] })],
      ['a plan of another month', Object.assign({}, GEN, { payrollPlans: [Object.assign({}, P1, { monthKey: '2031-05' })] })], ['missing excluded', { payrollPlans: [P1] }]]
      .forEach(([label, o]) => check(D.generateResponse(P(o), MONTH) === null, 'A. generate refused: ' + label));
    check(D.planResponse(P(one(P1))) !== null && D.planResponse(P({ payrollPlan: P1, payrollPlanOvertime: [] })) === null, 'A. { payrollPlan } is exact');
  }

  /* ---------- B. strict request encoders ---------- */
  {
    const rt = loadRuntime({});
    const Q = rt.PayrollRequests;
    const g = Q.generate(MONTH);
    check(g.ok && keys(g.body) === 'month' && g.body.month === MONTH, 'B. generate: exactly { month }');
    check(['2031-13', '2031-4', '1899-12', 2031, '', null].every((m) => !Q.generate(m).ok), 'B. generate refused before transport: an invalid month');
    const t = Q.target(ID1, 3);
    check(t.ok && keys(t.body) === 'expectedVersion,id' && t.body.expectedVersion === 3, 'B. a transition: exactly { id, expectedVersion }');
    check(!Q.target('x', 1).ok && !Q.target(ID1, 0).ok && !Q.target(ID1, '1').ok && !Q.target(ID1, 4294967296).ok && !Q.target(ID1, 1.5).ok,
      'B. a transition refused before transport: bad id, version 0, string, 2^32 or fraction');
  }

  /* ---------- C. CEO: the Payroll section, the month list, money verbatim ---------- */
  {
    const rt = await boot(ME_CEO, { [LIST(MONTH)]: [ok(MONTH_ALL)] });
    const before = rt.appHTML();
    check(/<button class="tab" type="button" id="swSectionPayroll" aria-pressed="false">Payroll<\/button>/.test(before) && /id="swSectionMain" aria-pressed="true"[^>]*>Employees</.test(before),
      'C. the CEO workspace offers a third section, Payroll; Employees stays the default');
    check(payrollCalls(rt).length === 0, 'C. nothing of Payroll is read before the section is opened');
    rt.app.fire('swSectionPayroll', 'click'); await flush();
    const html = rt.appHTML();
    check(rt.pr().open === true && rt.pr().month === MONTH && countOf(rt, LIST(MONTH)) === 1 && /id="swSectionPayroll" aria-pressed="true"/.test(html) && /<h1[^>]*>Payroll<\/h1>/.test(html),
      'C. opening the section reads the month list once (the local calendar month) and shows the Payroll heading');
    const get = rt.net.calls.find((c) => c.url === LIST(MONTH));
    check(get.init.method === 'GET' && get.init.body === undefined && get.init.credentials === 'same-origin', 'C. the list read is a credentialed same-origin GET with no body');
    const rows = (html.match(/<tr><td>[^<]*<\/td><td>/g) || []).length;
    check(rows === 5 && html.indexOf('EMP-001') < html.indexOf('EMP-002') && html.indexOf('EMP-002') < html.indexOf('EMP-004') && html.indexOf('EMP-005') < html.indexOf('EMP-006'),
      'C. five rows, in the server order (no client sorting)');
    check(html.indexOf('<td>8000000.50</td><td>12345.00</td><td>999.00</td>') !== -1, 'C. money is shown exactly as sent — the deliberately inconsistent total 999.00 verbatim (no client arithmetic, rounding or reformatting)');
    check(/Base salary \(Rp\)/.test(html) && /Total \(Rp\)/.test(html) && !/Rp ?[0-9]|[0-9]\.[0-9]{3},|8\.000\.000/.test(html), 'C. amounts are labelled (Rp) and never reformatted (no locale grouping)');
    // AFI-4c2 authorized revision (D-AFI4c2-3 = A): Committed reads "Committed — final, not paid". Was: "Committed".
    check(/<td>Ready — approved, not paid<\/td>/.test(html) && /<td>Committed — final, not paid<\/td>/.test(html) && /<td>Cancelled<\/td>/.test(html) && /<td>Reviewed<\/td>/.test(html) && /<td>Draft<\/td>/.test(html)
      && !/<td>Approved<\/td>/.test(html), 'C. the server status words are shown (D-AFI4c1-3 = A): Ready reads "Ready — approved, not paid"; never the LOCAL "Approved"');
    check(/Fabricated &lt;Alpha&gt;/.test(html) && !/<Alpha>/.test(html), 'C. server text is escaped');
    check(!/Total payroll|Sum|Grand total/i.test(html) && (html.match(/999\.00/g) || []).length === 1, 'C. no month total or summary is computed');
    check(/Prepare payroll for April 2031/.test(html) && !/>[^<]*(Generate|Pay\b|Run payroll)/.test(html), 'C. the primary action reads "Prepare payroll for April 2031" — not pay, run or commit');
    firewall(rt, 'C. CEO list');
    // Empty month.
    const rt2 = await boot(ME_CEO, { [LIST(MONTH)]: [ok({ payrollPlans: [] })] });
    rt2.app.fire('swSectionPayroll', 'click'); await flush();
    check(/No payroll plans for April 2031\. Prepare payroll for this month to create them\./.test(rt2.appHTML()), 'C. an empty month says so and invites preparing payroll');
    // A read error, then Retry.
    const rt3 = await boot(ME_CEO, { [LIST(MONTH)]: [err(500, 'internal_error'), ok(MONTH_ALL)] });
    rt3.app.fire('swSectionPayroll', 'click'); await flush();
    check(/Payroll information could not be loaded/.test(rt3.appHTML()) && /Reference: 0123456789abcdef0123456789abcdef/.test(rt3.appHTML()), 'C. a failed read shows a fixed message with the server reference');
    rt3.app.fire('swpRetryBtn', 'click'); await flush();
    check(countOf(rt3, LIST(MONTH)) === 2 && (rt3.pr().list || []).length === 5, 'C. Retry reads the month again');
    const rt4 = await boot(ME_CEO, { [LIST(MONTH)]: [ok({ payrollPlans: [P1, Object.assign({}, P2, { totalAmount: 5000000 })] })] });
    rt4.app.fire('swSectionPayroll', 'click'); await flush();
    check(/TAM OS sent an unexpected response/.test(rt4.appHTML()) && rt4.pr().list === null, 'C. a malformed list answer shows nothing of it — the whole answer is refused');
    firewall(rt4, 'C. malformed list');
  }

  /* ---------- D. Employee: never the CEO's Payroll ---------- */
  // AFI-4c2 authorized revision: an Employee now has "My payroll" (section O) — their own Committed
  // payroll only. Was: no Payroll section and zero /api/payroll* requests. What stays: no CEO
  // section, no CEO control, no write and no drift read, whatever is invoked by hand.
  {
    const rt = await boot(ME_EMP, { [LIST(MONTH)]: [ok({ payrollPlans: [] })] });
    const html = rt.appHTML();
    check(/id="swSectionMain" aria-pressed="true"[^>]*>My profile</.test(html) && /id="swSectionOvertime"[^>]*>My overtime</.test(html) && /id="swSectionPayroll"[^>]*>My payroll</.test(html)
      && !/>Payroll</.test(html), 'D. an Employee sees exactly My profile | My overtime | My payroll — never the CEO Payroll section');
    check(payrollCalls(rt).length === 0, 'D. an Employee makes zero /api/payroll* requests until My payroll is opened');
    rt.SessionPayroll.openPanel('generate'); rt.SessionPayroll.openPanel('commit'); await rt.SessionPayroll.confirmPanel(); await rt.SessionPayroll.retryCommit(); rt.SessionPayroll.reloadPlan(); await flush();
    check(posts(rt).length === 0 && rt.pr().panel === null && payrollCalls(rt).length === 0, 'D. CEO writes invoked by hand as an Employee are no-ops (fail closed)');
    rt.app.fire('swSectionOvertime', 'click'); await flush();
    check(payrollCalls(rt).length === 0, 'D. nor from the Overtime section');
    firewall(rt, 'D. Employee', true);
  }

  /* ---------- E. the month: default, Previous / Next, the field, stale answers ---------- */
  {
    const may = deferred();
    const rt = await open({ [LIST('2031-05')]: [may.promise], [LIST('2031-03')]: [ok({ payrollPlans: [] })], [LIST('2031-07')]: [ok({ payrollPlans: [] })] });
    rt.app.fire('swpNextMonth', 'click'); await flush();
    check(rt.pr().month === '2031-05' && countOf(rt, LIST('2031-05')) === 1 && /Loading payroll plans/.test(rt.appHTML()), 'E. Next month reads 2031-05');
    rt.app.fire('swpPrevMonth', 'click'); await flush();
    rt.app.fire('swpPrevMonth', 'click'); await flush();
    check(rt.pr().month === '2031-03' && rt.pr().listMonth === '2031-03' && (rt.pr().list || []).length === 0, 'E. Previous month twice reads 2031-04 then 2031-03');
    may.resolve(ok({ payrollPlans: [Object.assign({}, P1, { monthKey: '2031-05' })] })); await flush();
    check(rt.pr().month === '2031-03' && (rt.pr().list || []).length === 0 && !/EMP-001/.test(rt.appHTML()), 'E. a late answer for 2031-05 never overwrites the month shown (2031-03)');
    rt.app.set('swpMonth', '2031-07'); await flush();
    check(rt.pr().month === '2031-07' && countOf(rt, LIST('2031-07')) === 1, 'E. the month field reads the month chosen');
    const calls = rt.net.calls.length;
    rt.app.set('swpMonth', '2031-13'); rt.app.set('swpMonth', 'bad'); rt.SessionPayroll.setMonth('1899-12'); await flush();
    check(rt.pr().month === '2031-07' && rt.net.calls.length === calls, 'E. an invalid month changes nothing and reads nothing');
    check(rt.access.url.length === 0 && rt.loc.search === '' && rt.access.local.length === 0, 'E. the month lives in memory only (no URL, history or storage)');
    firewall(rt, 'E. month');
  }

  /* ---------- F. the detail and the control matrix ---------- */
  {
    const rt = await detail(ID1, det(P1, [OT1]));
    const html = rt.appHTML();
    check(countOf(rt, DET(ID1)) === 1 && /<h1[^>]*>Payroll plan<\/h1>/.test(html), 'F. a row opens the plan detail with one read');
    const rows = ['Employee code</th><td>EMP-001', 'Employee</th><td>Fabricated &lt;Alpha&gt;', 'Department</th><td>Ops &amp; &lt;Co&gt;', 'Month</th><td>April 2031',
      'Status</th><td>Draft', 'Base salary (Rp)</th><td>8000000.50', 'Overtime (Rp)</th><td>12345.00', 'Overtime hours</th><td>7.50', 'Overtime records</th><td>1',
      'Total (Rp)</th><td>999.00', 'Version</th><td>1'];
    check(rows.every((r) => html.indexOf(r) !== -1), 'F. the detail shows the snapshot, month, status, money and hours exactly as sent, escaped, and the version');
    check(html.indexOf('<td>' + IDO + '</td><td>7.50</td><td>12345.00</td>') !== -1 && /Approved overtime counted/.test(html), 'F. the contributing overtime is shown from the Payroll detail answer only (id, hours, frozen amount)');
    check(!/created|updated|calculated|committed at|timestamp/i.test(html), 'F. no timestamp is shown (BF-4c1 projects none)');
    check(buttons(html) === 'Review,Approve,Cancel', 'F. a Draft offers Review, Approve, Cancel');
    const matrix = [[P2, 'Approve,Return,Cancel'], [P3, 'Return,Cancel'], [P4, ''], [P5, '']];
    for(const [p, want] of matrix){
      const r = await detail(p.id, det(p), { [DRIFT(p.id)]: [driftOk(p.id, [])] });
      check(buttons(r.appHTML()) === want, 'F. ' + p.status + ' offers ' + (want || 'nothing'));
      // AFI-4c2 authorized revision: Ready also offers Commit payroll (CEO). Was: Return, Cancel only.
      check(/id="swpCommitBtn"/.test(r.appHTML()) === (p.status === 'Ready'), 'F. ' + p.status + (p.status === 'Ready' ? ' also offers Commit payroll' : ' offers no Commit payroll'));
      if(p.status === 'Committed'){
        check(/Status<\/th><td>Committed/.test(r.appHTML()) && !/Commit(?!ted)|expectedTotal/.test(r.appHTML()), 'F. Committed is display-only: no Commit control or confirmation (D-AFI4c1-1 = A)');
        r.SessionPayroll.openPanel('cancel'); r.SessionPayroll.openPanel('review'); await flush();
        check(r.pr().panel === null && posts(r).length === 0, 'F. no action can be opened on a Committed plan, even by hand');
      }
      if(p.status === 'Cancelled'){
        r.SessionPayroll.openPanel('return'); await r.SessionPayroll.confirmPanel(); await flush();
        check(r.pr().panel === null && posts(r).length === 0, 'F. a Cancelled plan is terminal: nothing can be sent');
      }
      firewall(r, 'F. ' + p.status);
    }
    check(rt.sessionPayrollActions(rt.AuthBoot.snapshot().principal, { status: 'Committed' }).length === 0
      && rt.sessionPayrollActions({ principalType: 'employee', employeeId: 'e_1' }, P1).length === 0, 'F. the matrix offers nothing on Committed, and nothing to an Employee');
    rt.app.fire('swpBackBtn', 'click'); await flush();
    check(rt.pr().detailId === null && /Prepare payroll/.test(rt.appHTML()), 'F. Back returns to the list');
    const late = deferred();
    const rt2 = await open({ [DET(ID1)]: [late.promise], [DET(ID2)]: [ok(det(P2))] });
    rt2.SessionPayroll.openDetail(ID1); await flush();
    rt2.SessionPayroll.back(); rt2.SessionPayroll.openDetail(ID2); await flush();
    late.resolve(ok(det(P1, [OT1]))); await flush();
    check(rt2.pr().detailId === ID2 && rt2.pr().detail.plan.id === ID2 && !/EMP-001/.test(rt2.appHTML().replace(/<table>[\s\S]*<\/table>/, '')), 'F. a late detail answer of plan A never overwrites plan B');
    const rt3 = await detail(ID1, { payrollPlan: P2, payrollPlanOvertime: [] });
    check(rt3.pr().detail === null && /TAM OS sent an unexpected response/.test(rt3.appHTML()), 'F. a detail answer for another plan id is refused');
    firewall(rt3, 'F. wrong detail');
  }

  /* ---------- G. Prepare payroll (generate) ---------- */
  {
    const rt = await open({ [W.generate]: [ok(GEN)], [EMPS]: [ok(PEOPLE)] });
    rt.app.fire('swpGenerateBtn', 'click'); await flush();
    let html = rt.appHTML();
    check(posts(rt).length === 0 && /Prepare payroll for this month\?/.test(html) && /creates a Draft plan for each eligible employee/.test(html) && /recalculates existing Drafts/.test(html)
      && /Reviewed and Ready plans are not changed/.test(html) && /Nothing is paid and nothing is posted to Finance/.test(html),
      'G. Prepare payroll asks first: Drafts created and recalculated, Reviewed / Ready unchanged, nothing paid or posted to Finance — nothing sent yet');
    check(rt.app.fire('swpNextMonth', 'click') === 'absent' && (rt.SessionPayroll.shiftMonth(1), rt.pr().month === MONTH), 'G. the month cannot change while the confirmation is open');
    rt.app.fire('swpPanelCancel', 'click'); await flush();
    check(rt.pr().panel === null && posts(rt).length === 0, 'G. Back closes the confirmation; nothing sent');
    rt.app.fire('swpGenerateBtn', 'click'); await flush();
    const listReads = countOf(rt, LIST(MONTH));
    rt.app.fire('swpPanelConfirm', 'click'); await flush();
    const sent = posts(rt, W.generate);
    check(sent.length === 1 && JSON.stringify(bodyOf(sent[0])) === JSON.stringify({ month: MONTH }) && sent[0].init.headers['X-CSRF-Token'] === CSRF,
      'G. confirmed: exactly one POST /api/payroll-plans/generate with { month } and the CSRF token');
    check(countOf(rt, LIST(MONTH)) === listReads + 1, 'G. after a confirmed preparation the month list is read again (the answer omits Cancelled plans)');
    html = rt.appHTML();
    check(/Payroll prepared for this month/.test(html) && /Not included \(3\)/.test(html), 'G. a confirmation notice and "Not included (3)"');
    check(countOf(rt, EMPS) === 1 && /<li>Fabricated Gamma \(EMP-003\) — Archived employee<\/li>/.test(html) && /<li>e_9 — No monthly base salary on the employee record<\/li>/.test(html)
      && /<li>Fabricated &lt;Alpha&gt; \(EMP-001\) — Employment status is not Active<\/li>/.test(html),
      'G. exclusions are named from the CEO Employee list (D-AFI4c1-4 = A); an id it cannot name is shown as the id, never guessed; the three reasons are worded');
    rt.app.fire('swpGenerateBtn', 'click'); await flush();
    rt.app.fire('swpPanelConfirm', 'click'); await flush();
    check(posts(rt, W.generate).length === 2, 'G. preparing again is a new, deliberate confirmation (one request each)');
    rt.app.fire('swpNextMonth', 'click'); await flush();
    check(!/Not included/.test(rt.appHTML()) && rt.pr().excluded === null, 'G. a month change forgets the exclusions');
    firewall(rt, 'G. generate');
    // The Employee list cannot be read: ids, and a retry.
    const rt2 = await open({ [W.generate]: [ok(GEN)], [EMPS]: [err(500, 'internal_error'), ok(PEOPLE)] });
    rt2.SessionPayroll.openPanel('generate'); await rt2.SessionPayroll.confirmPanel(); await flush();
    check(/<li>e_3 — Archived employee<\/li>/.test(rt2.appHTML()) && /Employee names could not be loaded/.test(rt2.appHTML()), 'G. without the Employee list, exclusions show the ids and say so');
    rt2.app.fire('swpLabelsRetryBtn', 'click'); await flush();
    check(/Fabricated Gamma \(EMP-003\) — Archived employee/.test(rt2.appHTML()), 'G. Retry employee names names them');
    // 409, ambiguous outcomes: re-read, never resend.
    for(const [label, answer, want] of [['409', err(409, 'conflict'), /could not prepare payroll for this month \(a conflict was reported\)/],
      ['503', err(503, 'service_unavailable'), /could not confirm whether payroll was prepared/], ['network', NETFAIL(), /could not confirm whether payroll was prepared/],
      ['malformed', ok(Object.assign({}, GEN, { excluded: [{ employeeId: 'e_3', reason: 'on_leave' }] })), /could not confirm whether payroll was prepared/]]){
      const r = await open({ [W.generate]: [answer] });
      const reads = countOf(r, LIST(MONTH));
      r.SessionPayroll.openPanel('generate'); await r.SessionPayroll.confirmPanel(); await flush(20);
      check(posts(r, W.generate).length === 1 && countOf(r, LIST(MONTH)) === reads + 1 && want.test(r.appHTML()) && r.pr().panel === null && !/Not included/.test(r.appHTML()),
        'G. generate ' + label + ': never resent; the month is read again and the outcome is reported, no exclusions invented');
      firewall(r, 'G. generate ' + label);
    }
  }

  /* ---------- H. transitions ---------- */
  {
    const cases = [
      ['review', P1, 'swpReviewBtn', 'Reviewed', /Payroll plan marked as reviewed/],
      ['approve', P2, 'swpApproveBtn', 'Ready', /Payroll plan approved: it is now Ready — approved, not paid/],
      ['return', P3, 'swpReturnBtn', 'Draft', /Payroll plan returned to Draft/],
      ['cancel', P1, 'swpCancelBtn', 'Cancelled', /Payroll plan cancelled/]
    ];
    for(const [op, p, btn, target, notice] of cases){
      const after = bumped(p, target);
      const rt = await detail(p.id, det(p, [OT1]), { [W[op]]: [ok(one(after))] });
      rt.app.fire(btn, 'click'); await flush();
      check(posts(rt).length === 0 && !!rt.pr().panel && rt.pr().panel.kind === op, 'H. ' + op + ' asks first (an inline confirmation); nothing sent');
      if(op === 'approve') check(/becomes Ready — approved, not paid/.test(rt.appHTML()), 'H. the Approve confirmation says the plan becomes Ready — approved, not paid');
      if(op === 'cancel') check(/no longer counts the overtime it included/.test(rt.appHTML()), 'H. the Cancel confirmation says the overtime is released');
      rt.net.routes[DET(p.id)] = [ok(det(after, op === 'cancel' ? [] : [OT1]))];
      rt.app.fire('swpPanelConfirm', 'click'); await flush();
      const sent = posts(rt, W[op]);
      check(sent.length === 1 && JSON.stringify(bodyOf(sent[0])) === JSON.stringify({ id: p.id, expectedVersion: p.version }) && sent[0].init.headers['X-CSRF-Token'] === CSRF,
        'H. ' + op + ': exactly one POST ' + W[op] + ' with { id, expectedVersion: the version shown }');
      check(rt.pr().detail && rt.pr().detail.plan.status === target && rt.pr().detail.plan.version === p.version + 1 && notice.test(rt.appHTML()) && countOf(rt, DET(p.id)) === 2,
        'H. ' + op + ' confirmed by the same plan in ' + target + ' at version + 1; the plan is read again; a fixed notice');
      check(rt.pr().listStale === true || countOf(rt, LIST(MONTH)) >= 1, 'H. ' + op + ': the month list is marked stale');
      firewall(rt, 'H. ' + op);
    }
    // A success that does not confirm (version not + 1, wrong status): ambiguous, re-read, never resent.
    for(const [label, answer] of [['version not + 1', ok(one(Object.assign({}, P1, { status: 'Reviewed', version: 3 })))], ['wrong status', ok(one(bumped(P1, 'Ready')))],
      ['another plan', ok(one(bumped(P2, 'Reviewed')))], ['503', err(503, 'service_unavailable')], ['network', NETFAIL()]]){
      const rt = await detail(ID1, det(P1), { [W.review]: [answer] });
      rt.net.routes[DET(ID1)] = [ok(det(P1))];
      rt.SessionPayroll.openPanel('review'); await rt.SessionPayroll.confirmPanel(); await flush(20);
      check(posts(rt, W.review).length === 1 && rt.pr().mutation.status === 'ambiguous' && countOf(rt, DET(ID1)) === 2 && rt.pr().panel === null
        && /TAM OS could not confirm the change\. The plan read again is Draft, not Reviewed/.test(rt.appHTML()) && /id="swpReloadBtn"/.test(rt.appHTML()),
        'H. review ' + label + ': AMBIGUOUS — never resent; the plan is read again and its state reported');
      firewall(rt, 'H. ambiguous ' + label);
    }
    // 409: close, re-read, notice, a new deliberate action — never a retry.
    {
      const rt = await detail(ID2, det(P2), { [W.approve]: [err(409, 'conflict')] });
      rt.net.routes[DET(ID2)] = [ok(det(bumped(P2, 'Draft')))];
      rt.SessionPayroll.openPanel('approve'); await rt.SessionPayroll.confirmPanel(); await flush(20);
      check(posts(rt, W.approve).length === 1 && rt.pr().panel === null && countOf(rt, DET(ID2)) === 2 && rt.pr().detail.plan.status === 'Draft' && rt.pr().listStale === true
        && /This plan changed or the action is no longer available\. It was read again from TAM OS — check it, then choose again\./.test(rt.appHTML()),
        'H. 409: the confirmation closes, the plan is read again (now Draft), the list is stale, a stale-state notice — and nothing is resent');
      await flush(20);
      check(posts(rt, W.approve).length === 1 && buttons(rt.appHTML()) === 'Review,Approve,Cancel', 'H. 409: a new action needs a new deliberate click (the refreshed plan offers its own controls)');
      firewall(rt, 'H. 409');
    }
    // 404: the detail closes and the month is read again.
    {
      const rt = await detail(ID3, det(P3), { [W.cancel]: [err(404, 'not_found')] });
      const reads = countOf(rt, LIST(MONTH));
      rt.SessionPayroll.openPanel('cancel'); await rt.SessionPayroll.confirmPanel(); await flush(20);
      check(posts(rt, W.cancel).length === 1 && rt.pr().detailId === null && countOf(rt, LIST(MONTH)) === reads + 1 && /This payroll plan is no longer available/.test(rt.appHTML()),
        'H. 404: the detail closes, the month is read again, a fixed message');
    }
    // 403 with CSRF recovery: authSessionMutation's one replay with the new token.
    {
      const rt = await detail(ID1, det(P1), { [W.review]: [err(403, 'forbidden'), ok(one(bumped(P1, 'Reviewed')))] });
      rt.net.routes['/api/auth/me'] = [ok(Object.assign({}, ME_CEO, { csrfToken: CSRF2 }))];
      rt.net.routes[DET(ID1)] = [ok(det(bumped(P1, 'Reviewed')))];
      rt.SessionPayroll.openPanel('review'); await rt.SessionPayroll.confirmPanel(); await flush(20);
      const sent = posts(rt, W.review);
      check(sent.length === 2 && sent[0].init.headers['X-CSRF-Token'] === CSRF && sent[1].init.headers['X-CSRF-Token'] === CSRF2 && rt.pr().detail.plan.status === 'Reviewed',
        'H. CSRF recovery: a 403 refreshes the session and the write is replayed once with the new token (the established auth path), then confirmed');
    }
    // 401: the session ends; recovery unavailable: fail closed.
    {
      const rt = await detail(ID1, det(P1), { [W.review]: [err(401, 'unauthenticated')] });
      rt.SessionPayroll.openPanel('review'); await rt.SessionPayroll.confirmPanel(); await flush(20);
      check(rt.state() === rt.AUTH_STATES.SIGNED_OUT && rt.pr().open === false && rt.pr().list === null, 'H. a 401 ends the session (sessionLost) and destroys the Payroll data');
      const rt2 = await detail(ID1, det(P1), { [W.review]: [err(403, 'forbidden')] });
      rt2.net.routes['/api/auth/me'] = [err(503, 'service_unavailable')];
      rt2.SessionPayroll.openPanel('review'); await rt2.SessionPayroll.confirmPanel(); await flush(20);
      check(rt2.state() !== rt2.AUTH_STATES.AUTHENTICATED && rt2.pr().list === null && posts(rt2, W.review).length === 1,
        'H. a recovery that cannot confirm the session fails closed (sessionUncertain): nothing resent, the data destroyed');
    }
  }

  /* ---------- I. races: navigation, logout, principal change ---------- */
  {
    const slow = deferred();
    const rt = await detail(ID1, det(P1), { [W.review]: [slow.promise] });
    rt.net.routes[DET(ID1)] = [ok(det(bumped(P1, 'Reviewed')))];
    rt.SessionPayroll.openPanel('review'); const pend = rt.SessionPayroll.confirmPanel(); await flush();
    check(rt.app.fire('swpBackBtn', 'click') === 'disabled' && rt.app.fire('swSectionMain', 'click') === 'disabled' && rt.app.fire('swSectionOvertime', 'click') === 'disabled',
      'I. while a write is in flight, Back and the section switch are disabled');
    slow.resolve(ok(one(bumped(P1, 'Reviewed')))); await pend; await flush();
    check(rt.pr().detail.plan.status === 'Reviewed', 'I. the answer then applies');
    // Logout while a read is in flight: the late answer is dropped.
    const late = deferred();
    const rt2 = await open({ [DET(ID1)]: [late.promise], '/api/auth/logout': [ok({ signedOut: true })] });
    rt2.SessionPayroll.openDetail(ID1); await flush();
    rt2.AuthBoot.sessionLost(); await flush();
    late.resolve(ok(det(P1))); await flush();
    check(rt2.pr().detail === null && rt2.pr().open === false && rt2.pr().generation > 0, 'I. after the session ends, a late Payroll answer is dropped (the data is gone)');
    // Principal change during a write: recovery principal_changed destroys the data.
    const rt3 = await detail(ID1, det(P1), { [W.review]: [err(403, 'forbidden')] });
    rt3.net.routes['/api/auth/me'] = [ok(ME_CEO2)];
    rt3.SessionPayroll.openPanel('review'); await rt3.SessionPayroll.confirmPanel(); await flush(20);
    check(rt3.pr().detail === null && rt3.pr().list === null && posts(rt3, W.review).length === 1, 'I. a different principal discovered during a write destroys the Payroll data; nothing is resent');
    // A generate answer after the month changed back cannot be applied to another month.
    const g = deferred();
    const rt4 = await open({ [W.generate]: [g.promise] });
    rt4.SessionPayroll.openPanel('generate'); const gp = rt4.SessionPayroll.confirmPanel(); await flush();
    check(rt4.app.fire('swpNextMonth', 'click') === 'absent' || rt4.app.fire('swpNextMonth', 'click') === 'disabled', 'I. the month cannot change while a preparation is in flight');
    g.resolve(ok(GEN)); await gp; await flush();
    check(rt4.pr().excludedMonth === MONTH, 'I. the preparation applies to the month it was sent for');
    firewall(rt4, 'I. races');
  }

  /* ---------- J. the section switch and the other sections ---------- */
  {
    const rt = await open({ '/api/overtime-records?month=2031-04': [ok({ overtimeRecords: [] })], '/api/employees?archived=1': [ok(PEOPLE)] });
    rt.app.fire('swSectionOvertime', 'click'); await flush();
    check(rt.pr().open === false && rt.SessionOvertimeStore.snapshot().open === true && !/id="swp/.test(rt.appHTML()), 'J. switching to Overtime leaves Payroll (one section at a time)');
    rt.app.fire('swSectionPayroll', 'click'); await flush();
    check(rt.pr().open === true && rt.SessionOvertimeStore.snapshot().open === false && rt.pr().month === MONTH, 'J. switching back to Payroll keeps its month in memory');
    rt.app.fire('swSectionMain', 'click'); await flush();
    check(rt.pr().open === false && /id="swSectionMain" aria-pressed="true"/.test(rt.appHTML()), 'J. Employees closes Payroll');
    firewall(rt, 'J. sections', true);
  }

  /* ---------- L. the store's own guards (defense in depth beneath the controller's) ---------- */
  {
    const rt = await open({});
    const S = rt.SessionPayrollStore;
    const P = (o) => rt.parse(JSON.stringify(o));
    const listA = S.begin('list', '2031-04');
    const listB = S.begin('list', '2031-05');
    check(S.applyList(listA, P([P1])) === false && S.snapshot().list === null && S.snapshot().listMonth === '2031-05',
      'L. the store refuses a superseded list answer by itself (month A after month B)');
    check(S.applyList(listB, P([])) === true && S.snapshot().list.length === 0, 'L. the current list answer applies');
    const detA = S.begin('detail', ID1);
    const detB = S.begin('detail', ID2);
    check(S.applyDetail(detA, rt.PayrollDecoders.detailResponse(P(det(P1)))) === false && S.snapshot().detail === null && S.snapshot().detailId === ID2,
      'L. the store refuses a superseded detail answer by itself (plan A after plan B)');
    check(S.applyDetail(detB, rt.PayrollDecoders.detailResponse(P(det(P1)))) === false && S.snapshot().detail === null,
      'L. the store refuses a detail answer for another plan than the one asked for');
    check(S.applyDetail(detB, rt.PayrollDecoders.detailResponse(P(det(P2)))) === true && S.snapshot().detail.plan.id === ID2, 'L. the current detail answer applies');
    const gen = S.snapshot().generation;
    S.clear();
    check(S.applyList(listB, P([P1])) === false && S.applyDetail(detB, rt.PayrollDecoders.detailResponse(P(det(P2)))) === false && S.snapshot().generation === gen + 1,
      'L. after clear() (logout, a new principal) no earlier answer applies');
  }

  /* ---------- M. AFI-4c2 Commit (CEO): control, confirmation, the exact body, one intent ---------- */
  {
    const committedOf = (p) => bumped(p, 'Committed');
    // M1 visibility: Ready only, CEO only.
    for(const p of [P1, P2, P3, P4, P5]){
      const r = await detail(p.id, det(p), { [DRIFT(p.id)]: [driftOk(p.id, [])] });
      check(/id="swpCommitBtn"/.test(r.appHTML()) === (p.status === 'Ready'), 'M. ' + p.status + (p.status === 'Ready' ? ' offers Commit payroll' : ' never offers Commit payroll'));
      r.SessionPayroll.openPanel('commit'); await flush();
      check((r.pr().panel !== null) === (p.status === 'Ready') && posts(r).length === 0, 'M. ' + p.status + ': the Commit confirmation opens only on Ready, and asks first');
    }
    // The confirmation: exactly the plan's own server strings.
    const rt = await openReady({ [W.commit]: [ok(one(committedOf(PRX)))] });
    rt.app.fire('swpCommitBtn', 'click'); await flush();
    let html = rt.appHTML();
    check(rt.pr().panel && rt.pr().panel.kind === 'commit' && posts(rt).length === 0 && rt.crypto.calls === 0 && rt.pr().commitIntent === null,
      'M. Commit payroll asks first (an inline confirmation): nothing sent, no key made, no intent yet');
    check(/Commit this payroll plan\?/.test(html) && /final payroll obligation for April 2031/.test(html) && /can no longer be changed, returned or cancelled/.test(html)
      && /It is not a payment — nothing is paid and nothing is posted to Finance\./.test(html), 'M. the confirmation says: final obligation, no return or cancel, not a payment, nothing posted to Finance');
    check(/Fabricated EMP-007 \(EMP-007\)/.test(html) && /base salary \(Rp\) 8000000\.50/.test(html) && /overtime 7\.50 hours \(Rp\) 12345\.00/.test(html) && /total \(Rp\) 999\.00/.test(html) && /version 5\./.test(html),
      'M. it shows the server strings verbatim — base salary, overtime hours and amount, the (inconsistent) total 999.00, the version');
    check(/>Commit payroll</.test(html) && /btn btn-danger" type="button" id="swpPanelConfirm"/.test(html), 'M. the confirm button reads "Commit payroll" (a deliberate, danger-styled action)');
    // Double click: one intent, one key, one POST.
    rt.net.routes[DET(ID6)] = [ok(det(committedOf(PRX), [OT1]))];
    rt.app.fire('swpPanelConfirm', 'click');
    const second = rt.app.fire('swpPanelConfirm', 'click');
    await rt.SessionPayroll.confirmPanel();
    await flush();
    const sent = posts(rt, W.commit);
    check(sent.length === 1 && rt.crypto.calls === 1 && second !== 'fired', 'M. one confirmation, double-clicked and invoked again: exactly one key and one POST (M28)');
    const b = sent.length ? bodyOf(sent[0]) : {};
    check(keys(b) === COMMIT_KEYS && b.id === ID6 && b.expectedVersion === 5 && sent[0].init.headers['X-CSRF-Token'] === CSRF,
      'M. the body is exactly { id, expectedVersion, expectedTotal, idempotencyKey }, a CSRF POST');
    check(b.expectedTotal === '999.00' && b.expectedTotal === PRX.totalAmount && typeof b.expectedTotal === 'string',
      'M. expectedTotal is the plan\'s exact totalAmount string 999.00 — never base + overtime, never a number (M5, M6)');
    check(/^[0-9a-f]{32}$/.test(b.idempotencyKey) && b.idempotencyKey === rt.crypto.last, 'M. the key is the 16 Web Crypto bytes as 32 lowercase hex characters (M7, M8)');
    html = rt.appHTML();
    check(rt.pr().detail.plan.status === 'Committed' && /Status<\/th><td>Committed — final, not paid/.test(html) && rt.pr().commitIntent === null,
      'M. a confirmed commit: the plan is Committed — final, not paid; the intent is gone');
    check(/Payroll plan committed: it is the final payroll obligation for April 2031 — not paid\./.test(html), 'M. the notice: final payroll obligation — not paid');
    check(!/id="swp(Commit|RetryCommit|Return|Cancel|Review|Approve)Btn"/.test(html), 'M. Committed offers no control at all (M18)');
    check(countOf(rt, DRIFT(ID6)) === 1, 'M. a Committed plan is never checked for drift');
    firewall(rt, 'M. committed');
    // The success answer must confirm the intent exactly (M11, M12, M13, total).
    for(const [label, answer] of [['another id', one(Object.assign({}, committedOf(PRX), { id: ID1 }))], ['not Committed', one(Object.assign({}, committedOf(PRX), { status: 'Ready' }))],
      ['version not + 1', one(Object.assign({}, committedOf(PRX), { version: 7 }))], ['another total', one(Object.assign({}, committedOf(PRX), { totalAmount: '1000.00' }))]]){
      const r = await openReady({ [W.commit]: [ok(answer)] });
      r.app.fire('swpCommitBtn', 'click'); await flush();
      r.app.fire('swpPanelConfirm', 'click'); await flush();
      check(r.pr().mutation.status === 'ambiguous' && posts(r, W.commit).length === 1 && r.pr().detail && r.pr().detail.plan.status === 'Ready' && r.pr().commitIntent !== null,
        'M. a success answer with ' + label + ' is not a success: unknown outcome, the plan read again, nothing resent, the intent kept');
    }
  }

  /* ---------- M2. AFI-4c2 the unknown outcome and Retry commit (D-AFI4c2-1 = A) ---------- */
  {
    // A: the commit was applied — the re-read resolves it.
    const a = await openReady({ [W.commit]: [NETFAIL()] });
    a.app.fire('swpCommitBtn', 'click'); await flush();
    a.net.routes[DET(ID6)] = [ok(det(bumped(PRX, 'Committed'), [OT1]))];
    a.app.fire('swpPanelConfirm', 'click'); await flush();
    check(posts(a, W.commit).length === 1 && a.pr().commitIntent === null && a.pr().detail.plan.status === 'Committed'
      && /could not confirm the commit at first, but the plan read again is committed: it is the final payroll obligation for April 2031 — not paid\./.test(a.appHTML()),
      'M2. A: a network failure, then the re-read shows Committed at version + 1 with the same total — resolved as the success, nothing resent (M10)');
    firewall(a, 'M2. A');
    // B: still Ready, same version and total — Retry commit, the same body and key, only on a click.
    const b = await openReady({ [W.commit]: [NETFAIL(), ok(one(bumped(PRX, 'Committed')))] });
    b.app.fire('swpCommitBtn', 'click'); await flush();
    b.app.fire('swpPanelConfirm', 'click'); await flush();
    const first = bodyOf(posts(b, W.commit)[0]);
    let html = b.appHTML();
    check(posts(b, W.commit).length === 1 && b.pr().commitIntent && b.pr().commitIntent.key === first.idempotencyKey && /id="swpRetryCommitBtn"/.test(html) && !/id="swpCommitBtn"/.test(html)
      && /still Ready with the same total\. Retry commit sends the same commit again/.test(html), 'M2. B: still Ready at the same version and total — the intent is kept and Retry commit is offered; nothing was resent');
    b.render(); await flush(); b.SessionPayroll.ensureLoaded(b.AuthBoot.snapshot().principal); await flush();
    b.SessionPayroll.openPanel('commit'); await flush();
    check(posts(b, W.commit).length === 1 && b.pr().panel === null && b.crypto.calls === 1, 'M2. B: a re-render, a reload of state or another Commit payroll never sends or makes a new key (M9)');
    b.net.routes[DET(ID6)] = [ok(det(bumped(PRX, 'Committed'), [OT1]))];
    b.app.fire('swpRetryCommitBtn', 'click');
    const again = b.app.fire('swpRetryCommitBtn', 'click');
    await b.SessionPayroll.retryCommit();
    await flush();
    const retried = posts(b, W.commit);
    check(retried.length === 2 && again !== 'fired' && JSON.stringify(bodyOf(retried[1])) === JSON.stringify(first) && b.crypto.calls === 1,
      'M2. B: Retry commit (double-clicked) sends exactly one POST with the SAME id, expectedVersion, expectedTotal and key — no new key');
    check(b.pr().detail.plan.status === 'Committed' && b.pr().commitIntent === null && /final payroll obligation for April 2031 — not paid/.test(b.appHTML()), 'M2. B: the retried commit is confirmed');
    firewall(b, 'M2. B');
    // C: the re-read shows something else — the intent is dropped as stale.
    const c = await openReady({ [W.commit]: [NETFAIL()] });
    c.app.fire('swpCommitBtn', 'click'); await flush();
    c.net.routes[DET(ID6)] = [ok(det(Object.assign({}, PRX, { version: 6 }), [OT1]))];
    c.app.fire('swpPanelConfirm', 'click'); await flush();
    check(c.pr().commitIntent === null && !/id="swpRetryCommitBtn"/.test(c.appHTML()) && /the plan read again has changed/.test(c.appHTML()) && posts(c, W.commit).length === 1,
      'M2. C: another version on the re-read — the old intent is dropped as stale; no Retry; nothing resent');
    // D: the re-read fails — the intent is kept and nothing is sent; Reload plan reads it.
    const d = await openReady({ [W.commit]: [NETFAIL()] });
    d.app.fire('swpCommitBtn', 'click'); await flush();
    d.net.routes[DET(ID6)] = [err(500, 'internal_error'), ok(det(PRX, [OT1]))];
    d.app.fire('swpPanelConfirm', 'click'); await flush();
    html = d.appHTML();
    check(d.pr().commitIntent !== null && /could not be read again\. Nothing is sent again/.test(html) && !/id="swpRetryCommitBtn"/.test(html) && posts(d, W.commit).length === 1,
      'M2. D: the re-read fails — the intent is kept, nothing is sent, no Retry until the plan is read');
    d.app.fire('swpRetryBtn', 'click'); await flush();
    check(/id="swpRetryCommitBtn"/.test(d.appHTML()) && posts(d, W.commit).length === 1, 'M2. D: reading the plan again (still Ready, same version and total) offers Retry commit — still nothing sent');
    // A 500 on commit is an unknown outcome too.
    const e = await openReady({ [W.commit]: [err(500, 'internal_error')] });
    e.app.fire('swpCommitBtn', 'click'); await flush();
    e.app.fire('swpPanelConfirm', 'click'); await flush();
    check(e.pr().mutation.status === 'ambiguous' && e.pr().commitIntent !== null && posts(e, W.commit).length === 1, 'M2. a 500 answer to a commit is an unknown outcome: the intent is kept, the plan read again');
    // Logout / session loss: the intent and its key are gone.
    const f = await openReady({ [W.commit]: [NETFAIL()] });
    f.app.fire('swpCommitBtn', 'click'); await flush();
    f.app.fire('swpPanelConfirm', 'click'); await flush();
    check(f.pr().commitIntent !== null, 'M2. (an unresolved intent is held in memory)');
    f.AuthBoot.sessionLost(); await flush();
    check(f.pr().commitIntent === null && f.pr().detail === null && f.access.local.length === 0 && f.access.session.length === 0, 'M2. session loss destroys the intent and its key; nothing was ever stored (M26)');
    // No Web Crypto: nothing is sent.
    const g = await openReady({}, { noCrypto: true });
    g.app.fire('swpCommitBtn', 'click'); await flush();
    g.app.fire('swpPanelConfirm', 'click'); await flush();
    check(posts(g).length === 0 && g.pr().commitIntent === null && /cannot create a secure commit key\. Nothing was sent\./.test(g.appHTML()), 'M2. without Web Crypto the commit fails closed: nothing sent');
  }

  /* ---------- M3. AFI-4c2 Commit refused (409 and other definite answers) ---------- */
  {
    const rt = await openReady({ [W.commit]: [err(409, 'conflict')], [DRIFT(ID6)]: [driftOk(ID6, []), driftOk(ID6, ['salary_changed'])] });
    rt.app.fire('swpCommitBtn', 'click'); await flush();
    rt.app.fire('swpPanelConfirm', 'click'); await flush();
    const html = rt.appHTML();
    check(rt.pr().panel === null && rt.pr().commitIntent === null && posts(rt, W.commit).length === 1 && countOf(rt, DET(ID6)) === 2,
      'M3. a 409: definitely refused — the confirmation closes, the intent is dropped, the plan is read again, nothing resent');
    check(/TAM OS did not commit this plan: it changed, its total no longer matches, or its inputs changed\. It was read again — check it and any changes listed below\./.test(html)
      && !/payroll_(state|version|total|drift)|idempotency_mismatch/.test(html), 'M3. the conflict message never claims which cause it was');
    check(countOf(rt, DRIFT(ID6)) === 2 && /The employee&#39;s monthly base salary changed after this plan was prepared\./.test(html), 'M3. after the 409 the still-Ready plan\'s drift is read again and shown');
    check(/id="swpCommitBtn"/.test(html), 'M3. a new deliberate Commit payroll may follow (a new intent)');
    firewall(rt, 'M3. 409');
    const nf = await openReady({ [W.commit]: [err(404, 'not_found')] });
    nf.app.fire('swpCommitBtn', 'click'); await flush();
    nf.app.fire('swpPanelConfirm', 'click'); await flush();
    check(nf.pr().commitIntent === null && nf.pr().detailId === null && posts(nf, W.commit).length === 1, 'M3. a 404: the intent is dropped, the detail closes, the month is read again');
  }

  /* ---------- N. AFI-4c2 drift (D-AFI4c2-2 = A): explanation only ---------- */
  {
    const all = ['employee_archived', 'employee_not_active', 'salary_missing', 'salary_changed', 'overtime_changed'];
    const rt = await openReady({ [DRIFT(ID6)]: [driftOk(ID6, all)] });
    const html = rt.appHTML();
    check(countOf(rt, DRIFT(ID6)) === 1, 'N. a Ready detail becoming current reads its drift once');
    const texts = ['The employee is now archived.', 'The employee&#39;s employment status is no longer Active.', 'The employee no longer has a monthly base salary.',
      'The employee&#39;s monthly base salary changed after this plan was prepared.', 'The employee&#39;s approved overtime for this month changed after this plan was prepared.'];
    check(texts.every((t, i) => html.indexOf(t) !== -1 && (i === 0 || html.indexOf(texts[i - 1]) < html.indexOf(t))), 'N. every reason is shown together, in the canonical order, with its fixed text');
    check(/This plan no longer matches TAM OS\. Return it to Draft, then prepare payroll for April 2031 again\./.test(html) && /id="swpReturnBtn"/.test(html), 'N. the way forward is the normal, deliberate Return to draft');
    check(/id="swpCommitBtn"/.test(html) && posts(rt).length === 0, 'N. drift never hides Commit, never returns, regenerates or commits anything by itself (M14, M17)');
    const clean = await openReady();
    check(!/Changed since this plan was prepared/.test(clean.appHTML()) && /id="swpCommitBtn"/.test(clean.appHTML()) && !/ready to commit|safe to commit|matches TAM OS/i.test(clean.appHTML()),
      'N. current = true shows nothing and grants nothing: Commit is offered by status alone');
    for(const p of [P1, P2, P4, P5]){
      const r = await detail(p.id, det(p));
      check(countOf(r, DRIFT(p.id)) === 0, 'N. a ' + p.status + ' plan is never checked for drift');
    }
    const D = (o) => rt.PayrollDecoders.driftResponse(rt.parse(JSON.stringify(o)), ID6);
    const good = { payrollPlanDrift: { id: ID6, current: false, reasons: ['salary_missing', 'overtime_changed'] } };
    check(D(good) !== null && D({ payrollPlanDrift: { id: ID6, current: true, reasons: [] } }) !== null, 'N. the decoder accepts the canonical shapes');
    const bad = [
      ['an unknown reason', { payrollPlanDrift: { id: ID6, current: false, reasons: ['salary_increased'] } }],
      ['a repeated reason', { payrollPlanDrift: { id: ID6, current: false, reasons: ['salary_changed', 'salary_changed'] } }],
      ['reasons out of order', { payrollPlanDrift: { id: ID6, current: false, reasons: ['overtime_changed', 'salary_changed'] } }],
      ['current true with a reason', { payrollPlanDrift: { id: ID6, current: true, reasons: ['salary_changed'] } }],
      ['current false without a reason', { payrollPlanDrift: { id: ID6, current: false, reasons: [] } }],
      ['another plan id', { payrollPlanDrift: { id: ID1, current: true, reasons: [] } }],
      ['a current salary', { payrollPlanDrift: { id: ID6, current: false, reasons: ['salary_changed'], currentSalary: '1.00' } }],
      ['a total', { payrollPlanDrift: { id: ID6, current: true, reasons: [], totalAmount: '1.00' } }],
      ['an extra wrapper key', Object.assign({ salary: '1.00' }, good)],
      ['a string current', { payrollPlanDrift: { id: ID6, current: 'false', reasons: ['salary_changed'] } }]
    ];
    check(bad.every(([, o]) => D(o) === null), 'N. the decoder refuses an unknown, repeated or reordered reason, an inconsistent current, another id and any value field (M15, M16)');
    // A late drift answer for plan A never attaches to plan B.
    const late = deferred();
    const r2 = await openReady({ [DRIFT(ID6)]: [late.promise], [DET(ID3)]: [ok(det(P3))], [DRIFT(ID3)]: [driftOk(ID3, [])] });
    r2.SessionPayroll.back(); await flush();
    r2.SessionPayroll.openDetail(ID3); await flush();
    late.resolve(driftOk(ID6, ['salary_changed'])); await flush();
    check(r2.pr().detailId === ID3 && r2.pr().driftId === ID3 && r2.pr().drift && r2.pr().drift.id === ID3 && !/Changed since this plan was prepared/.test(r2.appHTML()),
      'N. a late drift answer of plan A never attaches to plan B (M27)');
    const r3 = await openReady({ [DRIFT(ID6)]: [err(500, 'internal_error')] });
    check(/could not check this plan for changes/.test(r3.appHTML()) && /id="swpCommitBtn"/.test(r3.appHTML()) && posts(r3).length === 0, 'N. a failed drift read says so and changes nothing');
    firewall(rt, 'N. drift');
  }

  /* ---------- O. AFI-4c2 My payroll (Employee): own Committed payroll only ---------- */
  {
    const MAY = '2031-05';
    const rt = await boot(ME_EMP, { [LIST(MONTH)]: [ok({ payrollPlans: [MINE] })], [DET(ID7)]: [ok(det(MINE, [OT1]))], [LIST(MAY)]: [ok({ payrollPlans: [] })] });
    rt.app.fire('swSectionPayroll', 'click'); await flush();
    let html = rt.appHTML();
    check(rt.pr().open === true && /<h1[^>]*>My payroll<\/h1>/.test(html) && /id="swSectionPayroll" aria-pressed="true"[^>]*>My payroll</.test(html) && countOf(rt, LIST(MONTH)) === 1,
      'O. My payroll opens on the current month with one read of the month');
    check(html.indexOf('<td>April 2031</td><td>Committed — final, not paid</td><td>1000000.00</td><td>54688.00</td><td>777.00</td>') !== -1,
      'O. the own Committed plan, money verbatim (the inconsistent total 777.00 as sent), Committed — final, not paid');
    check(!/Prepare payroll|Not included|swpGenerateBtn/.test(html), 'O. no preparation, no exclusions');
    rt.app.fire('swpOpen0', 'click'); await flush();
    html = rt.appHTML();
    const rows = ['Employee</th><td>Fabricated Self', 'Code</th><td>EMP-777', 'Month</th><td>April 2031', 'Status</th><td>Committed — final, not paid',
      'Base salary (Rp)</th><td>1000000.00', 'Overtime hours</th><td>2.50', 'Overtime (Rp)</th><td>54688.00', 'Total (Rp)</th><td>777.00'];
    check(/Payroll — April 2031/.test(html) && rows.every((r) => html.indexOf(r) !== -1) && html.indexOf('<td>' + IDO + '</td><td>7.50</td><td>12345.00</td>') !== -1 && /Approved overtime counted/.test(html),
      'O. the payslip-like card: the server\'s fields only, verbatim, with the approved overtime counted');
    check(!/Version|swp(Commit|RetryCommit|Return|Cancel|Review|Approve|Reload)Btn|Prepare payroll/.test(html) && !/print|pdf|download/i.test(html),
      'O. read-only: no control, no version, no print or PDF');
    check(!/\b(pph|bpjs|thr|tax|allowance|deduction|bonus|benefit|loan|net|gross|bank|payment date)\b/i.test(html), 'O. no unsupported payroll concept (M24)');
    rt.app.fire('swpBackBtn', 'click'); await flush();
    rt.app.fire('swpNextMonth', 'click'); await flush();
    check(countOf(rt, LIST(MAY)) === 1 && /No committed payroll for May 2031\./.test(rt.appHTML()), 'O. Next reads the next month; an empty month says so');
    rt.SessionPayroll.openPanel('commit'); rt.SessionPayroll.openPanel('generate'); await rt.SessionPayroll.confirmPanel(); await rt.SessionPayroll.retryCommit(); await flush();
    check(posts(rt).length === 0 && rt.net.calls.every((c) => !/drift/.test(c.url)) && rt.net.calls.filter((c) => /^\/api\/payroll/.test(c.url)).every((c) => c.url === LIST(MONTH) || c.url === LIST(MAY) || c.url === DET(ID7)),
      'O. an Employee only ever reads the month and their own plan: no drift, no write, nothing else (M22, M23)');
    firewall(rt, 'O. My payroll');
    // Defence in depth: a non-Committed or another employee's plan is refused whole.
    for(const [label, items] of [['a Ready plan of their own', [Object.assign({}, MINE, { status: 'Ready' })]], ['another employee\'s plan', [Object.assign({}, MINE, { employeeId: 'emp_other' })]]]){
      const r = await boot(ME_EMP, { [LIST(MONTH)]: [ok({ payrollPlans: items })] });
      r.app.fire('swSectionPayroll', 'click'); await flush();
      check(r.pr().list === null && /TAM OS sent an unexpected response/.test(r.appHTML()), 'O. a list holding ' + label + ' is refused whole (M20, M21)');
    }
    const r2 = await boot(ME_EMP, { [LIST(MONTH)]: [ok({ payrollPlans: [MINE] })], [DET(ID7)]: [ok(det(Object.assign({}, MINE, { employeeId: 'emp_other' })))] });
    r2.app.fire('swSectionPayroll', 'click'); await flush();
    r2.app.fire('swpOpen0', 'click'); await flush();
    check(r2.pr().detail === null && /TAM OS sent an unexpected response/.test(r2.appHTML()), 'O. a detail of another employee\'s plan is refused');
    const ceo = await open();
    check(/>Payroll</.test(ceo.appHTML()) && !/My payroll/.test(ceo.appHTML()), 'O. the CEO keeps Employees | Overtime | Payroll');
  }

  /* ---------- P. AFI-4c2 the store's own guards ---------- */
  {
    const rt = await boot(ME_CEO, {});
    const S = rt.SessionPayrollStore;
    S.bindPrincipal(rt.AuthBoot.snapshot().principal);
    const det1 = S.begin('detail', ID6);
    const dr = S.begin('drift', ID6);
    const dRes = rt.PayrollDecoders.driftResponse(rt.parse(JSON.stringify({ payrollPlanDrift: { id: ID6, current: true, reasons: [] } })), ID6);
    S.begin('detail', ID3);
    check(S.applyDrift(dr, dRes) === false, 'P. a drift answer read before the detail changed never applies (the drift belongs to its detail)');
    const dr3 = S.begin('drift', ID3);
    check(S.applyDrift(dr3, dRes) === false, 'P. a drift answer for another plan than the one asked for never applies');
    check(det1.kind === 'detail' && S.applyDetail(det1, null) === false, 'P. (an old detail token is dead)');
    S.setIntent({ id: ID6, version: 5, total: '999.00', key: 'f'.repeat(32) });
    check(Object.isFrozen(S.snapshot().commitIntent) && S.snapshot().commitIntent.key === 'f'.repeat(32), 'P. the intent is one frozen record');
    S.clear();
    check(S.snapshot().commitIntent === null && S.snapshot().drift === null, 'P. clear() (logout, session loss, a new principal) destroys the intent, its key and the drift');
    check(rt.sessionPayrollIntentState({ id: ID6, version: 5, total: '999.00' }, bumped(PRX, 'Committed')) === 'committed'
      && rt.sessionPayrollIntentState({ id: ID6, version: 5, total: '999.00' }, PRX) === 'unresolved'
      && rt.sessionPayrollIntentState({ id: ID6, version: 5, total: '999.00' }, Object.assign({}, PRX, { totalAmount: '1000.00' })) === 'stale'
      && rt.sessionPayrollIntentState({ id: ID6, version: 5, total: '999.00' }, Object.assign({}, bumped(PRX, 'Committed'), { totalAmount: '1000.00' })) === 'stale',
      'P. the reconciliation reads exactly: Committed at version + 1 with the same total, still Ready at the same version and total, or stale');
  }

  /* ---------- S. AFI-4d Supplemental Payroll: strict DTO decoders and request encoders ---------- */
  {
    const rt = loadRuntime({});
    const D = rt.SupplementalDecoders;
    const P = (o) => rt.parse(JSON.stringify(o));
    const good = D.doc(P(SDRAFT));
    check(!!good && Object.isFrozen(good) && keys(good) === keys(SDRAFT) && Object.keys(good).length === 12 && good.overtimeAmount === '4321.00',
      'S. a canonical Supplemental document decodes, frozen, exactly its twelve keys (SupplementalView::FIELDS); money the exact string');
    check(['Draft', 'Reviewed', 'Ready', 'Committed', 'Cancelled'].every((s) => !!D.doc(P(Object.assign({}, SDRAFT, { status: s })))), 'S. the five BF-4d statuses decode');
    const bads = [
      ['unknown key', Object.assign({}, SDRAFT, { companyId: 'c' })], ['missing key', (() => { const c = Object.assign({}, SDRAFT); delete c.payrollPlanId; return c; })()],
      ['a total key', Object.assign({}, SDRAFT, { totalAmount: '1.00' })], ['a paid flag', Object.assign({}, SDRAFT, { paid: false })],
      ['amount 0.00', Object.assign({}, SDRAFT, { overtimeAmount: '0.00' })], ['amount with sen', Object.assign({}, SDRAFT, { overtimeAmount: '4321.50' })],
      ['amount number', Object.assign({}, SDRAFT, { overtimeAmount: 4321 })], ['hours 0.00', Object.assign({}, SDRAFT, { overtimeHours: '0.00' })],
      ['hours not quarter', Object.assign({}, SDRAFT, { overtimeHours: '2.10' })], ['count 0', Object.assign({}, SDRAFT, { overtimeCount: 0 })],
      ['count string', Object.assign({}, SDRAFT, { overtimeCount: '1' })], ['status Approved (LOCAL word)', Object.assign({}, SDRAFT, { status: 'Approved' })],
      ['status Review (LOCAL word)', Object.assign({}, SDRAFT, { status: 'Review' })], ['status Posted', Object.assign({}, SDRAFT, { status: 'Posted' })],
      ['status Paid', Object.assign({}, SDRAFT, { status: 'Paid' })], ['bad payrollPlanId', Object.assign({}, SDRAFT, { payrollPlanId: 'x' })],
      ['upper-case id', Object.assign({}, SDRAFT, { id: 'D'.repeat(32) })], ['bad employeeId', Object.assign({}, SDRAFT, { employeeId: 'e 5' })],
      ['month 13', Object.assign({}, SDRAFT, { monthKey: '2031-13' })], ['version 0', Object.assign({}, SDRAFT, { version: 0 })],
      ['empty name', Object.assign({}, SDRAFT, { employeeName: '' })], ['department empty', Object.assign({}, SDRAFT, { department: '' })]
    ];
    bads.forEach(([label, o]) => check(D.doc(P(o)) === null, 'S. document refused: ' + label));
    const list = D.monthResponse(P(SMONTH), MONTH);
    check(!!list && list.length === SMONTH.supplementalPayrolls.length && Object.isFrozen(list), 'S. a month answer decodes in the server order, every status included');
    check(D.monthResponse(P(SMONTH), '2031-05') === null && D.monthResponse(P({ supplementalPayrolls: [SDRAFT, Object.assign({}, SREV, { status: 'Paid' })] }), MONTH) === null
      && D.monthResponse(P({ supplementalPayrolls: [SDRAFT], total: '1.00' }), MONTH) === null && D.monthResponse(P({ payrollPlans: [] }), MONTH) === null,
      'S. another month, one bad document, an extra wrapper key (a total) or another wrapper name invalidates the whole list');
    const d = D.detailResponse(P(sdet(SDRAFT, [SLINE])));
    check(!!d && d.doc.id === SID_DRAFT && d.overtime.length === 1 && keys(d.overtime[0]) === 'amount,hours,id' && d.overtime[0].amount === '1234.00',
      'S. a detail decodes: the document and its captured overtime { id, hours, amount } (three keys)');
    check(!!D.detailResponse(P(sdet(SCAN, []))), 'S. a Cancelled document with no captured overtime decodes (cancel releases it)');
    [['extra line key', sdet(SDRAFT, [Object.assign({}, SLINE, { valuationSalary: '1.00' })])], ['line hours 0.00', sdet(SDRAFT, [Object.assign({}, SLINE, { hours: '0.00' })])],
      ['line amount with sen', sdet(SDRAFT, [Object.assign({}, SLINE, { amount: '1.50' })])], ['lines not a list', { supplementalPayroll: SDRAFT, supplementalPayrollOvertime: SLINE }],
      ['extra wrapper key', Object.assign(sdet(SDRAFT, []), { payrollPlan: P4 })], ['the payroll wrapper', { payrollPlan: SDRAFT, payrollPlanOvertime: [] }]]
      .forEach(([label, o]) => check(D.detailResponse(P(o)) === null, 'S. detail refused: ' + label));
    check(D.docResponse(P(sone(SDRAFT))) !== null && D.docResponse(P({ supplementalPayroll: SDRAFT, supplementalPayrollOvertime: [] })) === null, 'S. { supplementalPayroll } is exact');
    const e = D.eligibilityResponse(P(SELIGS));
    check(!!e && e.length === SELIGS.supplementalEligibility.length && Object.keys(e[0]).length === 5 && keys(e[0]) === 'eligibleAmount,eligibleCount,eligibleHours,employeeId,payrollPlanId'
      && e.some((x) => x.eligibleAmount === '0.00'), 'S. an eligibility answer decodes: exactly five keys per entry (ELIGIBILITY_FIELDS); an amount of 0.00 is accepted');
    [['an employee name', { supplementalEligibility: [Object.assign({}, ELIG, { employeeName: 'x' })] }], ['count 0', { supplementalEligibility: [Object.assign({}, ELIG, { eligibleCount: 0 })] }],
      ['amount number', { supplementalEligibility: [Object.assign({}, ELIG, { eligibleAmount: 7777 })] }], ['hours 0.00', { supplementalEligibility: [Object.assign({}, ELIG, { eligibleHours: '0.00' })] }],
      ['a plan twice', { supplementalEligibility: [ELIG, ELIG] }], ['extra wrapper key', Object.assign({ total: '1.00' }, { supplementalEligibility: [] })]]
      .forEach(([label, o]) => check(D.eligibilityResponse(P(o)) === null, 'S. eligibility refused: ' + label));
    const Q = rt.SupplementalRequests;
    const g = Q.generate(ID4);
    check(g.ok && keys(g.body) === 'payrollPlanId' && g.body.payrollPlanId === ID4, 'S. generate: exactly { payrollPlanId }');
    check(['x', 'A'.repeat(32), 4, null, ''].every((v) => !Q.generate(v).ok), 'S. generate refused before transport: a bad plan id');
    const t = Q.target(SID_DRAFT, 3);
    check(t.ok && keys(t.body) === 'expectedVersion,id', 'S. a transition: exactly { id, expectedVersion }');
    const c = Q.commit({ id: SID_READY, version: 3, total: '4321.00', key: 'a'.repeat(32) });
    check(c.ok && keys(c.body) === COMMIT_KEYS && c.body.expectedTotal === '4321.00' && !Q.commit({ id: SID_READY, version: 3, total: 4321, key: 'a'.repeat(32) }).ok
      && !Q.commit({ id: SID_READY, version: 3, total: '4321.00', key: 'A'.repeat(32) }).ok, 'S. commit: exactly { id, expectedVersion, expectedTotal, idempotencyKey }; a number total or a bad key is refused before transport');
  }

  /* ---------- S1. AFI-4d CEO month: eligibility and the month's Supplemental documents ---------- */
  {
    const rt = await openS();
    let html = rt.appHTML();
    check(countOf(rt, LIST(MONTH)) === 1 && countOf(rt, SLIST(MONTH)) === 1 && countOf(rt, SELIG(MONTH)) === 1 && countOf(rt, EMPS) === 0,
      'S1. the month page reads the plans, the Supplemental documents and the eligibility once each — never the Employee list (D-AFI4d-1 = A)');
    check(/<h1[^>]*>Payroll<\/h1>/.test(html) && /id="swpSupp"/.test(html) && /Supplemental payroll — April 2031/.test(html) && !/id="swSectionSupplemental"/.test(html),
      'S1. Supplemental payroll is a card of the Payroll month page — no new section');
    check(/separate obligation; the committed payroll is never changed/.test(html), 'S1. the card explains a separate obligation; the committed payroll never changes');
    check(html.indexOf('<td>EMP-005</td><td>Fabricated EMP-005</td><td>2</td><td>3.50</td><td>7777.00</td>') !== -1,
      'S1. an eligible plan is named from its own Committed plan snapshot (same payrollPlanId); records, hours and amount verbatim');
    check(/id="swpSuppPrep0"/.test(html) && !/id="swpSuppPrep1"/.test(html) && /Nothing to settle: the amount is 0\.00\./.test(html),
      'S1. "Prepare supplemental payroll" is offered for an eligible amount, not for "0.00" (presentation only)');
    check(/<td>—<\/td><td>Name not available<\/td>/.test(html), 'S1. an entry whose plan is not in the month list is never guessed: "Name not available"');
    check(['<td>Draft</td>', '<td>Reviewed</td>', '<td>Ready — approved, not paid</td>', '<td>Committed — final, not paid</td>', '<td>Cancelled</td>'].every((t) => html.indexOf(t) !== -1)
      && /id="swpSuppOpen4"/.test(html), 'S1. every document of the month is listed with the server status words, Committed — final, not paid; Cancelled included');
    check((html.match(/4321\.00/g) || []).length === SMONTH.supplementalPayrolls.filter((x) => x.overtimeAmount === '4321.00').length && !/Grand total|Total compensation|Sum/i.test(html),
      'S1. amounts are shown as sent, never added up — no combined or month total');
    check(/Open supplemental payroll is Reviewed\./.test(html), 'S1. an eligible plan with an open Reviewed / Ready document says so');
    firewall(rt, 'S1. month');
    // Empty answers.
    const e = await openS({ [SLIST(MONTH)]: [ok({ supplementalPayrolls: [] })], [SELIG(MONTH)]: [ok({ supplementalEligibility: [] })] });
    check(/No approved overtime of April 2031 is waiting for supplemental payroll\./.test(e.appHTML()) && /No supplemental payroll for April 2031\./.test(e.appHTML()) && !/swpSuppPrep/.test(e.appHTML()),
      'S1. no eligibility and no documents: both say so; nothing to prepare');
    // A failed read, then Retry supplemental payroll.
    const f = await openS({ [SELIG(MONTH)]: [err(500, 'internal_error'), ok(SELIGS)] });
    check(/Payroll information could not be loaded/.test(f.appHTML()) && /id="swpSuppRetryBtn"/.test(f.appHTML()) && /<td>Draft<\/td>/.test(f.appHTML()),
      'S1. a failed eligibility read says so (the documents still show) and offers Retry');
    f.app.fire('swpSuppRetryBtn', 'click'); await flush();
    check(countOf(f, SELIG(MONTH)) === 2 && countOf(f, SLIST(MONTH)) === 1 && /id="swpSuppPrep0"/.test(f.appHTML()), 'S1. Retry supplemental payroll reads only what failed');
    const m = await openS({ [SLIST(MONTH)]: [ok({ supplementalPayrolls: [SDRAFT, Object.assign({}, SREV, { overtimeAmount: 1 })] })] });
    check(m.pr().suppList === null && /TAM OS sent an unexpected response/.test(m.appHTML()), 'S1. a malformed document list shows nothing of it — the whole answer is refused');
    // The month bar moves all three reads; a late answer for another month never applies.
    const late = deferred();
    const r = await openS({ [SLIST('2031-05')]: [late.promise], [LIST('2031-05')]: [ok({ payrollPlans: [] })], [SELIG('2031-05')]: [ok({ supplementalEligibility: [] })],
      [LIST('2031-06')]: [ok({ payrollPlans: [] })], [SLIST('2031-06')]: [ok({ supplementalPayrolls: [] })], [SELIG('2031-06')]: [ok({ supplementalEligibility: [] })] });
    r.app.fire('swpNextMonth', 'click'); await flush();
    r.app.fire('swpNextMonth', 'click'); await flush();
    late.resolve(ok({ supplementalPayrolls: [Object.assign({}, SDRAFT, { monthKey: '2031-05' })] })); await flush();
    check(r.pr().month === '2031-06' && r.pr().suppListMonth === '2031-06' && (r.pr().suppList || []).length === 0 && !/<td>Draft<\/td>/.test(r.appHTML()),
      'S1. a late Supplemental answer of 2031-05 never overwrites the month shown (2031-06)');
    firewall(r, 'S1. month bar');
  }

  /* ---------- S2. AFI-4d Prepare supplemental payroll (generate) ---------- */
  {
    const rt = await openS({ [SW.generate]: [ok(sone(SNEW))] });
    rt.app.fire('swpSuppPrep0', 'click'); await flush();
    let html = rt.appHTML();
    check(suppPosts(rt).length === 0 && rt.pr().panel && rt.pr().panel.kind === 'suppGenerate' && /Prepare supplemental payroll\?/.test(html)
      && /Fabricated EMP-005 \(EMP-005\) — April 2031: 2 approved overtime records, 3\.50 hours \(Rp\) 7777\.00 eligible now\./.test(html)
      && /creates a Draft of the approved overtime this committed payroll does not contain, or recalculates the open Draft/.test(html)
      && /An open Reviewed or Ready supplemental payroll is returned unchanged/.test(html) && /The committed payroll is not changed\. Nothing is paid and nothing is posted to Finance\./.test(html),
      'S2. Prepare asks first: the plan, month and eligible strings; Draft created or recalculated; an open Reviewed / Ready one returned unchanged; not paid, nothing posted to Finance — nothing sent');
    check(rt.app.fire('swpNextMonth', 'click') === 'absent' || (rt.SessionPayroll.shiftMonth(1), rt.pr().month === MONTH), 'S2. the month cannot change while the confirmation is open');
    rt.app.fire('swpPanelCancel', 'click'); await flush();
    check(rt.pr().panel === null && suppPosts(rt).length === 0, 'S2. Back closes it; nothing sent');
    rt.SessionPayroll.openPanel('suppGenerate', ID8); await flush();
    check(rt.pr().panel === null, 'S2. an entry of "0.00" cannot be prepared, even by hand (UX only — the server answers 409 anyway)');
    rt.SessionPayroll.openPanel('suppGenerate', 'e'.repeat(32)); await flush();
    check(rt.pr().panel === null, 'S2. nor a plan that is not eligible this month');
    const reads = [countOf(rt, LIST(MONTH)), countOf(rt, SLIST(MONTH)), countOf(rt, SELIG(MONTH))];
    rt.app.fire('swpSuppPrep0', 'click'); await flush();
    rt.app.fire('swpPanelConfirm', 'click');
    const twice = rt.app.fire('swpPanelConfirm', 'click');
    await flush();
    const sent = suppPosts(rt, SW.generate);
    check(sent.length === 1 && twice !== 'fired' && JSON.stringify(bodyOf(sent[0])) === JSON.stringify({ payrollPlanId: ID4 }) && sent[0].init.headers['X-CSRF-Token'] === CSRF,
      'S2. confirmed (double-clicked): exactly one POST /api/supplemental-payrolls/generate with exactly { payrollPlanId } and the CSRF token — no key, no amount');
    html = rt.appHTML();
    check(/Supplemental payroll prepared: its Draft holds the approved overtime that is eligible now\./.test(html) && countOf(rt, LIST(MONTH)) === reads[0] + 1
      && countOf(rt, SLIST(MONTH)) === reads[1] + 1 && countOf(rt, SELIG(MONTH)) === reads[2] + 1, 'S2. a Draft answer: a fixed notice; the plans, documents and eligibility are read again');
    check(!/new Draft|created a Draft/i.test(html.replace(/creates a Draft/g, '')), 'S2. the notice never claims a new Draft was made (it may be a recalculated one)');
    firewall(rt, 'S2. generate');
    // The base plan's open document is Reviewed / Ready: returned untouched — said so.
    for(const open of [SREV, Object.assign({}, SREADY, { payrollPlanId: ID4, employeeId: 'e_5' })]){
      const r = await openS({ [SW.generate]: [ok(sone(open))] });
      r.SessionPayroll.openPanel('suppGenerate', ID4); await r.SessionPayroll.confirmPanel(); await flush();
      check(/already has an open supplemental payroll that is Reviewed or Ready, and TAM OS returned it unchanged/.test(r.appHTML()) && !/its Draft holds/.test(r.appHTML())
        && r.pr().mutation.status === 'idle', 'S2. an open ' + open.status + ' document answered: the unchanged-document notice (canonical meaning), never a "prepared Draft"');
    }
    // Answers that do not confirm, and outcomes that cannot be known: never resent; the month is read again.
    for(const [label, answer, want] of [
      ['another plan', ok(sone(Object.assign({}, SNEW, { payrollPlanId: ID1 }))), /could not confirm whether supplemental payroll was prepared/],
      ['a Committed document', ok(sone(Object.assign({}, SNEW, { status: 'Committed' }))), /could not confirm whether supplemental payroll was prepared/],
      ['another month', ok(sone(Object.assign({}, SNEW, { monthKey: '2031-05' }))), /could not confirm whether supplemental payroll was prepared/],
      ['malformed', ok({ supplementalPayroll: SNEW, extra: 1 }), /could not confirm whether supplemental payroll was prepared/],
      ['503', err(503, 'service_unavailable'), /could not confirm whether supplemental payroll was prepared/],
      ['network', NETFAIL(), /could not confirm whether supplemental payroll was prepared/],
      ['409', err(409, 'conflict'), /did not prepare supplemental payroll \(a conflict was reported\)/],
      ['404', err(404, 'not_found'), /no longer available/]]){
      const r = await openS({ [SW.generate]: [answer] });
      const before = countOf(r, SELIG(MONTH));
      r.SessionPayroll.openPanel('suppGenerate', ID4); await r.SessionPayroll.confirmPanel(); await flush(20);
      check(suppPosts(r, SW.generate).length === 1 && countOf(r, SELIG(MONTH)) === before + 1 && want.test(r.appHTML()) && r.pr().panel === null,
        'S2. generate ' + label + ': never resent; the month is read again; the outcome reported generically');
      check(!/supplemental_(nothing_eligible|zero|plan_state|state|version)/.test(r.appHTML()), 'S2. generate ' + label + ': no server cause is claimed');
      firewall(r, 'S2. generate ' + label);
    }
  }

  /* ---------- S3. AFI-4d the Supplemental detail and its control matrix (no Draft → Ready) ---------- */
  {
    const rt = await suppDetail(SDRAFT, [SLINE]);
    let html = rt.appHTML();
    check(countOf(rt, SDET(SID_DRAFT)) === 1 && /<h1[^>]*>Supplemental payroll<\/h1>/.test(html) && rt.pr().detailId === null, 'S3. a document row opens its detail with one read (one detail at a time)');
    const rows = ['Employee code</th><td>EMP-008', 'Employee</th><td>Fabricated EMP-008', 'Month</th><td>April 2031', 'Status</th><td>Draft', 'Overtime hours</th><td>2.25',
      'Overtime records</th><td>1', 'Amount (Rp)</th><td>4321.00', 'Version</th><td>1'];
    check(rows.every((r) => html.indexOf(r) !== -1), 'S3. the detail shows the snapshot, month, status, hours, count, amount and version exactly as sent');
    check(html.indexOf('<td>' + IDO2 + '</td><td>2.25</td><td>1234.00</td>') !== -1 && /Approved overtime settled here/.test(html),
      'S3. the frozen captured overtime is shown (record, hours, frozen amount) — and never summed (1234.00 is not the document amount 4321.00)');
    check(suppButtons(html) === 'Review,Cancel' && !/id="swpSuppApproveBtn"/.test(html), 'S3. a Draft offers Review, Cancel — NO Approve (there is no Draft → Ready)');
    rt.SessionPayroll.openPanel('suppApprove'); rt.SessionPayroll.openPanel('suppCommit'); rt.SessionPayroll.openPanel('suppReturn'); await flush();
    check(rt.pr().panel === null && suppPosts(rt).length === 0, 'S3. Approve, Commit or Return invoked by hand on a Draft open nothing (no Draft → Ready)');
    for(const [doc, want] of [[SREV, 'Approve,Return,Cancel'], [SREADY, 'Commit,Return,Cancel'], [SCOM, ''], [SCAN, '']]){
      const r = await suppDetail(doc, doc === SCAN ? [] : [SLINE]);
      check(suppButtons(r.appHTML()) === want, 'S3. ' + doc.status + ' offers ' + (want || 'nothing'));
      if(doc === SCOM || doc === SCAN){
        ['suppReview', 'suppApprove', 'suppReturn', 'suppCancel', 'suppCommit'].forEach((k) => r.SessionPayroll.openPanel(k));
        await r.SessionPayroll.confirmPanel(); await flush();
        check(r.pr().panel === null && suppPosts(r).length === 0, 'S3. ' + doc.status + ' is terminal: nothing can be opened or sent, even by hand');
      }
      if(doc === SCOM) check(/Status<\/th><td>Committed — final, not paid/.test(r.appHTML()), 'S3. Committed reads "Committed — final, not paid"');
      if(doc === SCAN) check(/A cancelled supplemental payroll no longer holds overtime: its overtime was released\./.test(r.appHTML()) && /Overtime records<\/th><td>1/.test(r.appHTML()),
        'S3. a Cancelled document explains why it lists no overtime (its count stays as sent)');
      firewall(r, 'S3. ' + doc.status);
    }
    check(rt.sessionSupplementalActions(rt.AuthBoot.snapshot().principal, { status: 'Draft' }).join() === 'review,cancel'
      && rt.sessionSupplementalActions(rt.AuthBoot.snapshot().principal, { status: 'Committed' }).length === 0
      && rt.sessionSupplementalActions({ principalType: 'employee', employeeId: 'e_5' }, SREADY).length === 0, 'S3. the matrix: Draft review / cancel only; nothing on Committed; nothing to an Employee');
    rt.app.fire('swpBackBtn', 'click'); await flush();
    check(rt.pr().suppDetailId === null && /id="swpSupp"/.test(rt.appHTML()), 'S3. Back returns to the month page');
    // A Committed plan's detail lists its Supplemental documents — several waves, separately.
    const p = await openS({ [DET(ID4)]: [ok(det(P4))], [SDET(SID_COM)]: [ok(sdet(SCOM, [SLINE]))], [SDET(SID_COM2)]: [ok(sdet(SCOM2, [SLINE2]))] });
    p.app.fire('swpOpen3', 'click'); await flush();
    html = p.appHTML();
    check(/Supplemental payroll for this payroll/.test(html) && /<td>1 of 4<\/td>/.test(html) && /<td>4 of 4<\/td>/.test(html) && /id="swpSuppLink3"/.test(html) && !/id="swpSuppLink4"/.test(html),
      'S3. a Committed plan\'s detail lists its own Supplemental documents (several waves, each separate)');
    p.app.fire('swpSuppLink3', 'click'); await flush();
    check(p.pr().suppDetailId === SID_COM2 && p.pr().detailId === null && /Amount \(Rp\)<\/th><td>99\.00/.test(p.appHTML()), 'S3. a link opens that document (the plan detail gives way)');
    firewall(p, 'S3. related');
    const other = await openS({ [DET(ID1)]: [ok(det(P1))] });
    other.app.fire('swpOpen0', 'click'); await flush();
    check(!/Supplemental payroll for this payroll/.test(other.appHTML()), 'S3. a plan that is not Committed lists no Supplemental payroll');
    // A late detail answer of document A never overwrites document B.
    const late = deferred();
    const r2 = await openS({ [SDET(SID_DRAFT)]: [late.promise], [SDET(SID_REV)]: [ok(sdet(SREV, [SLINE]))] });
    r2.SessionPayroll.openSupplemental(SID_DRAFT); await flush();
    r2.SessionPayroll.back(); r2.SessionPayroll.openSupplemental(SID_REV); await flush();
    late.resolve(ok(sdet(SDRAFT, [SLINE]))); await flush();
    check(r2.pr().suppDetailId === SID_REV && r2.pr().suppDetail.doc.id === SID_REV, 'S3. a late detail answer of document A never overwrites document B');
    const r3 = await openS({ [SDET(SID_DRAFT)]: [ok(sdet(SREV, []))] });
    r3.SessionPayroll.openSupplemental(SID_DRAFT); await flush();
    check(r3.pr().suppDetail === null && /TAM OS sent an unexpected response/.test(r3.appHTML()), 'S3. a detail answer for another document id is refused');
  }

  /* ---------- S4. AFI-4d transitions ---------- */
  {
    const cases = [
      ['review', SDRAFT, 'swpSuppReviewBtn', 'Reviewed', /Supplemental payroll marked as reviewed\./],
      ['approve', SREV, 'swpSuppApproveBtn', 'Ready', /Supplemental payroll approved: it is now Ready — approved, not paid\./],
      ['return', SREV, 'swpSuppReturnBtn', 'Draft', /Supplemental payroll returned to Draft\./],
      ['return', SREADY, 'swpSuppReturnBtn', 'Draft', /Supplemental payroll returned to Draft\./],
      ['cancel', SDRAFT, 'swpSuppCancelBtn', 'Cancelled', /Supplemental payroll cancelled\. Its overtime is released\./],
      ['cancel', SREV, 'swpSuppCancelBtn', 'Cancelled', /Supplemental payroll cancelled/],
      ['cancel', SREADY, 'swpSuppCancelBtn', 'Cancelled', /Supplemental payroll cancelled/]
    ];
    for(const [op, doc, btn, target, notice] of cases){
      const after = bumped(doc, target);
      const rt = await suppDetail(doc, [SLINE], { [SW[op]]: [ok(sone(after))] });
      rt.app.fire(btn, 'click'); await flush();
      check(suppPosts(rt).length === 0 && !!rt.pr().panel, 'S4. ' + op + ' from ' + doc.status + ' asks first; nothing sent');
      if(op === 'approve') check(/It becomes Ready — approved, not paid\./.test(rt.appHTML()), 'S4. the Approve confirmation: Ready — approved, not paid');
      if(op === 'cancel') check(/releases its overtime/.test(rt.appHTML()), 'S4. the Cancel confirmation says the overtime is released');
      rt.net.routes[SDET(doc.id)] = [ok(sdet(after, op === 'cancel' ? [] : [SLINE]))];
      rt.app.fire('swpPanelConfirm', 'click'); await flush();
      const sent = suppPosts(rt, SW[op]);
      check(sent.length === 1 && JSON.stringify(bodyOf(sent[0])) === JSON.stringify({ id: doc.id, expectedVersion: doc.version }) && sent[0].init.headers['X-CSRF-Token'] === CSRF,
        'S4. ' + op + ' from ' + doc.status + ': exactly one POST ' + SW[op] + ' with { id, expectedVersion: the version shown }');
      check(rt.pr().suppDetail && rt.pr().suppDetail.doc.status === target && rt.pr().suppDetail.doc.version === doc.version + 1 && notice.test(rt.appHTML())
        && countOf(rt, SDET(doc.id)) === 2 && rt.pr().listStale === true, 'S4. ' + op + ' from ' + doc.status + ': confirmed by the same document in ' + target + ' at version + 1; read again; a fixed notice; the month is stale');
      firewall(rt, 'S4. ' + op + ' ' + doc.status);
    }
    // Answers that do not confirm, and unknown outcomes: AMBIGUOUS — never resent; the document read again.
    for(const [label, answer] of [['version not + 1', ok(sone(Object.assign({}, SDRAFT, { status: 'Reviewed', version: 3 })))], ['Ready (a Draft → Ready)', ok(sone(bumped(SDRAFT, 'Ready')))],
      ['another document', ok(sone(bumped(SREV, 'Reviewed')))], ['503', err(503, 'service_unavailable')], ['network', NETFAIL()]]){
      const rt = await suppDetail(SDRAFT, [SLINE], { [SW.review]: [answer] });
      rt.net.routes[SDET(SID_DRAFT)] = [ok(sdet(SDRAFT, [SLINE]))];
      rt.SessionPayroll.openPanel('suppReview'); await rt.SessionPayroll.confirmPanel(); await flush(20);
      check(suppPosts(rt, SW.review).length === 1 && rt.pr().mutation.status === 'ambiguous' && countOf(rt, SDET(SID_DRAFT)) === 2 && rt.pr().panel === null
        && /TAM OS could not confirm the change\. The supplemental payroll read again is Draft, not Reviewed/.test(rt.appHTML()) && /id="swpSuppReloadBtn"/.test(rt.appHTML()),
        'S4. review ' + label + ': AMBIGUOUS — never resent; the document read again and its state reported');
      firewall(rt, 'S4. ambiguous ' + label);
    }
    // Any 409: generic; the document read again; a new deliberate action.
    {
      const rt = await suppDetail(SREV, [SLINE], { [SW.approve]: [err(409, 'conflict')] });
      rt.net.routes[SDET(SID_REV)] = [ok(sdet(bumped(SREV, 'Draft'), [SLINE]))];
      rt.SessionPayroll.openPanel('suppApprove'); await rt.SessionPayroll.confirmPanel(); await flush(20);
      check(suppPosts(rt, SW.approve).length === 1 && rt.pr().panel === null && rt.pr().suppDetail.doc.status === 'Draft'
        && /This supplemental payroll changed or the action is no longer available\. It was read again from TAM OS — check it, then choose again\./.test(rt.appHTML())
        && suppButtons(rt.appHTML()) === 'Review,Cancel', 'S4. 409: generic stale message, the document read again (now Draft: Review / Cancel only), nothing resent');
      rt.app.fire('swpSuppReloadBtn', 'click'); await flush();
      check(countOf(rt, SDET(SID_REV)) === 3 && suppPosts(rt).length === 1, 'S4. Reload supplemental payroll reads it again — and sends nothing');
    }
    {
      const rt = await suppDetail(SREADY, [SLINE], { [SW.cancel]: [err(404, 'not_found')] });
      const reads = countOf(rt, SLIST(MONTH));
      rt.SessionPayroll.openPanel('suppCancel'); await rt.SessionPayroll.confirmPanel(); await flush(20);
      check(rt.pr().suppDetailId === null && countOf(rt, SLIST(MONTH)) === reads + 1 && /This supplemental payroll is no longer available/.test(rt.appHTML()),
        'S4. 404: the detail closes and the month is read again');
      const d = await suppDetail(SREADY, [SLINE], { [SW.cancel]: [err(403, 'forbidden')] });
      d.net.routes['/api/auth/me'] = [ok(ME_CEO)];
      d.SessionPayroll.openPanel('suppCancel'); await d.SessionPayroll.confirmPanel(); await flush(20);
      check(/You do not have permission to make this change\./.test(d.appHTML()), 'S4. 403: an access failure');
      const l = await suppDetail(SREADY, [SLINE], { [SW.cancel]: [resp(429, { ok: false, error: { code: 'rate_limited', message: 'x' }, requestId: RID }, { 'Retry-After': '30' })] });
      l.SessionPayroll.openPanel('suppCancel'); await l.SessionPayroll.confirmPanel(); await flush(20);
      check(/Too many requests\./.test(l.appHTML()) && suppPosts(l).length === 1, 'S4. 429: the rate-limit message; nothing resent');
      const u = await suppDetail(SREADY, [SLINE], { [SW.cancel]: [err(401, 'unauthenticated')] });
      u.SessionPayroll.openPanel('suppCancel'); await u.SessionPayroll.confirmPanel(); await flush(20);
      check(u.state() === u.AUTH_STATES.SIGNED_OUT && u.pr().suppDetail === null && u.pr().suppList === null, 'S4. 401: the session ends and every Supplemental datum is destroyed');
    }
  }

  /* ---------- S5. AFI-4d Commit (D-AFI4c2-1 reused): one intent, exact body, same-key Retry ---------- */
  {
    const committed = bumped(SREADY, 'Committed');
    const rt = await suppDetail(SREADY, [SLINE], { [SW.commit]: [ok(sone(committed))] });
    rt.app.fire('swpSuppCommitBtn', 'click'); await flush();
    let html = rt.appHTML();
    check(rt.pr().panel && rt.pr().panel.kind === 'suppCommit' && suppPosts(rt).length === 0 && rt.crypto.calls === 0 && rt.pr().suppIntent === null,
      'S5. Commit supplemental asks first: nothing sent, no key, no intent');
    check(/Commit this supplemental payroll\?/.test(html) && /final payroll obligation for April 2031: Fabricated EMP-009 \(EMP-009\), overtime 2\.25 hours in 1 records \(Rp\) 4321\.00, version 3\./.test(html)
      && /can no longer be changed, returned or cancelled/.test(html) && /It is not a payment — nothing is paid and nothing is posted to Finance\./.test(html),
      'S5. the confirmation: employee, month, hours, amount, version; final obligation; no return or cancel; NOT paid; nothing posted to Finance');
    rt.net.routes[SDET(SID_READY)] = [ok(sdet(committed, [SLINE]))];
    rt.app.fire('swpPanelConfirm', 'click');
    const second = rt.app.fire('swpPanelConfirm', 'click');
    await rt.SessionPayroll.confirmPanel(); await flush();
    const sent = suppPosts(rt, SW.commit);
    check(sent.length === 1 && rt.crypto.calls === 1 && second !== 'fired', 'S5. double-clicked and invoked again: exactly one key and one POST');
    const b = sent.length ? bodyOf(sent[0]) : {};
    check(keys(b) === COMMIT_KEYS && b.id === SID_READY && b.expectedVersion === 3 && b.expectedTotal === '4321.00' && b.expectedTotal === SREADY.overtimeAmount
      && b.idempotencyKey === rt.crypto.last && /^[0-9a-f]{32}$/.test(b.idempotencyKey) && sent[0].init.headers['X-CSRF-Token'] === CSRF,
      'S5. the body is exactly { id, expectedVersion, expectedTotal, idempotencyKey }: the document\'s own overtimeAmount string (never the lines\' 1234.00), a Web Crypto key');
    html = rt.appHTML();
    check(rt.pr().suppDetail.doc.status === 'Committed' && /Status<\/th><td>Committed — final, not paid/.test(html) && rt.pr().suppIntent === null
      && /Supplemental payroll committed: it is a final payroll obligation for April 2031 — not paid\./.test(html) && suppButtons(html) === '',
      'S5. confirmed: Committed — final, not paid; the intent is gone; no control remains');
    firewall(rt, 'S5. committed');
    for(const [label, answer] of [['another id', sone(Object.assign({}, committed, { id: SID_REV }))], ['not Committed', sone(Object.assign({}, committed, { status: 'Ready' }))],
      ['version not + 1', sone(Object.assign({}, committed, { version: 9 }))], ['another amount', sone(Object.assign({}, committed, { overtimeAmount: '1234.00' }))]]){
      const r = await suppDetail(SREADY, [SLINE], { [SW.commit]: [ok(answer)] });
      r.SessionPayroll.openPanel('suppCommit'); await r.SessionPayroll.confirmPanel(); await flush();
      check(r.pr().mutation.status === 'ambiguous' && suppPosts(r, SW.commit).length === 1 && r.pr().suppIntent !== null,
        'S5. a success with ' + label + ' is not a success: unknown outcome, read again, nothing resent, the intent kept');
    }
    // Ambiguous → Committed at version + 1 with the same amount: the success.
    const a = await suppDetail(SREADY, [SLINE], { [SW.commit]: [NETFAIL()] });
    a.net.routes[SDET(SID_READY)] = [ok(sdet(committed, [SLINE]))];
    a.SessionPayroll.openPanel('suppCommit'); await a.SessionPayroll.confirmPanel(); await flush();
    check(suppPosts(a, SW.commit).length === 1 && a.pr().suppIntent === null && a.pr().suppDetail.doc.status === 'Committed'
      && /could not confirm the commit at first, but the supplemental payroll read again is committed/.test(a.appHTML()), 'S5. ambiguous → Committed on the re-read: resolved as the success; nothing resent');
    // Ambiguous → still Ready: Retry commit with the SAME body and key, only on a click.
    const r = await suppDetail(SREADY, [SLINE], { [SW.commit]: [NETFAIL(), ok(sone(committed))] });
    r.SessionPayroll.openPanel('suppCommit'); await r.SessionPayroll.confirmPanel(); await flush();
    const first = bodyOf(suppPosts(r, SW.commit)[0]);
    html = r.appHTML();
    check(suppPosts(r, SW.commit).length === 1 && r.pr().suppIntent && r.pr().suppIntent.key === first.idempotencyKey && /id="swpSuppRetryCommitBtn"/.test(html) && !/id="swpSuppCommitBtn"/.test(html)
      && /still Ready with the same amount\. Retry commit sends the same commit again/.test(html), 'S5. ambiguous → still Ready: the intent kept; Retry commit offered; nothing resent automatically');
    r.render(); await flush(); r.SessionPayroll.openPanel('suppCommit'); await flush();
    check(suppPosts(r, SW.commit).length === 1 && r.pr().panel === null && r.crypto.calls === 1, 'S5. a re-render or another Commit never sends or makes a new key');
    r.net.routes[SDET(SID_REV)] = [ok(sdet(SREV, [SLINE]))];
    r.SessionPayroll.back(); await r.SessionPayroll.openSupplemental(SID_REV); await flush();
    await r.SessionPayroll.retrySupplementalCommit(); await flush();
    check(suppPosts(r, SW.commit).length === 1 && r.pr().suppIntent !== null && !/id="swpSuppRetryCommitBtn"/.test(r.appHTML()),
      'S5. the unresolved intent belongs to its own document: Retry commit on another document sends nothing');
    r.SessionPayroll.back(); await r.SessionPayroll.openSupplemental(SID_READY); await flush();
    r.net.routes[SDET(SID_READY)] = [ok(sdet(committed, [SLINE]))];
    r.app.fire('swpSuppRetryCommitBtn', 'click');
    const again = r.app.fire('swpSuppRetryCommitBtn', 'click');
    await r.SessionPayroll.retrySupplementalCommit(); await flush();
    const retried = suppPosts(r, SW.commit);
    check(retried.length === 2 && again !== 'fired' && JSON.stringify(bodyOf(retried[1])) === JSON.stringify(first) && r.crypto.calls === 1 && r.pr().suppDetail.doc.status === 'Committed',
      'S5. Retry commit (double-clicked) sends exactly one more POST with the SAME body and key — then confirmed');
    firewall(r, 'S5. retry');
    // Ambiguous → changed: stale; the intent dropped.
    const c = await suppDetail(SREADY, [SLINE], { [SW.commit]: [NETFAIL()] });
    c.net.routes[SDET(SID_READY)] = [ok(sdet(Object.assign({}, SREADY, { version: 4 }), [SLINE]))];
    c.SessionPayroll.openPanel('suppCommit'); await c.SessionPayroll.confirmPanel(); await flush();
    check(c.pr().suppIntent === null && !/id="swpSuppRetryCommitBtn"/.test(c.appHTML()) && /the supplemental payroll read again has changed/.test(c.appHTML()) && suppPosts(c, SW.commit).length === 1,
      'S5. ambiguous → changed on the re-read: the intent is dropped as stale; no Retry; nothing resent');
    // A 500 is an unknown outcome; a 409 a definite refusal.
    const e5 = await suppDetail(SREADY, [SLINE], { [SW.commit]: [err(500, 'internal_error')] });
    e5.SessionPayroll.openPanel('suppCommit'); await e5.SessionPayroll.confirmPanel(); await flush();
    check(e5.pr().mutation.status === 'ambiguous' && e5.pr().suppIntent !== null, 'S5. a 500 is an unknown outcome: the intent is kept, the document read again');
    const k = await suppDetail(SREADY, [SLINE], { [SW.commit]: [err(409, 'conflict')] });
    k.SessionPayroll.openPanel('suppCommit'); await k.SessionPayroll.confirmPanel(); await flush();
    check(k.pr().suppIntent === null && k.pr().panel === null && countOf(k, SDET(SID_READY)) === 2 && suppPosts(k, SW.commit).length === 1
      && /TAM OS did not commit this supplemental payroll: it changed, its amount no longer matches, or its overtime changed\./.test(k.appHTML())
      && !/supplemental_(total|links|state|version)|idempotency_mismatch/.test(k.appHTML()) && /id="swpSuppCommitBtn"/.test(k.appHTML()),
      'S5. 409: definitely refused — intent dropped, read again, the cause never claimed; a new deliberate Commit may follow');
    // Session loss destroys the intent; no Web Crypto sends nothing.
    const f = await suppDetail(SREADY, [SLINE], { [SW.commit]: [NETFAIL()] });
    f.SessionPayroll.openPanel('suppCommit'); await f.SessionPayroll.confirmPanel(); await flush();
    check(f.pr().suppIntent !== null, 'S5. (an unresolved intent is held in memory)');
    f.AuthBoot.sessionLost(); await flush();
    check(f.pr().suppIntent === null && f.pr().suppDetail === null && f.access.local.length === 0 && f.access.session.length === 0, 'S5. session loss destroys the intent and its key; nothing was stored');
    const g = await suppDetail(SREADY, [SLINE], {}, { noCrypto: true });
    g.SessionPayroll.openPanel('suppCommit'); await g.SessionPayroll.confirmPanel(); await flush();
    check(suppPosts(g).length === 0 && g.pr().suppIntent === null && /cannot create a secure commit key\. Nothing was sent\./.test(g.appHTML()), 'S5. without Web Crypto nothing is sent');
    check(rt.sessionSupplementalIntentState({ id: SID_READY, version: 3, total: '4321.00' }, committed) === 'committed'
      && rt.sessionSupplementalIntentState({ id: SID_READY, version: 3, total: '4321.00' }, SREADY) === 'unresolved'
      && rt.sessionSupplementalIntentState({ id: SID_READY, version: 3, total: '4321.00' }, Object.assign({}, SREADY, { overtimeAmount: '1.00' })) === 'stale',
      'S5. the reconciliation reads exactly: Committed at version + 1 with the same amount, still Ready at the same version and amount, or stale');
  }

  /* ---------- S6. AFI-4d My payroll (Employee): own Committed Supplemental, separate rows ---------- */
  {
    const rt = await boot(ME_EMP, { [LIST(MONTH)]: [ok({ payrollPlans: [MINE] })], [SLIST(MONTH)]: [ok({ supplementalPayrolls: [SMINE1, SMINE2] })],
      [DET(ID7)]: [ok(det(MINE, [OT1]))], [SDET(SID_MINE2)]: [ok(sdet(SMINE2, [SLINE2]))], [SDET(SID_MINE1)]: [ok(sdet(SMINE1, [SLINE]))] });
    rt.app.fire('swSectionPayroll', 'click'); await flush();
    let html = rt.appHTML();
    check(countOf(rt, SLIST(MONTH)) === 1 && countOf(rt, SELIG(MONTH)) === 0 && /Supplemental payroll — overtime approved after payroll was committed/.test(html),
      'S6. My payroll reads the own Supplemental documents of the month — never the eligibility');
    check(html.indexOf('<td>April 2031</td><td>Committed — final, not paid</td><td>2.25</td><td>4321.00</td>') !== -1 && html.indexOf('<td>April 2031</td><td>Committed — final, not paid</td><td>0.25</td><td>99.00</td>') !== -1
      && html.indexOf('<td>1000000.00</td><td>54688.00</td><td>777.00</td>') !== -1, 'S6. each Committed Supplemental is its own row (two waves), beside the payroll row — every amount as sent');
    check(!/4420\.00|1000099\.00|1004321\.00|Total compensation|Grand total/i.test(html) && (html.match(/777\.00/g) || []).length === 1,
      'S6. the payroll and the Supplemental amounts are never added together — no combined total');
    rt.app.fire('swpSuppOpen1', 'click'); await flush();
    html = rt.appHTML();
    const rows = ['Employee</th><td>Fabricated Self', 'Code</th><td>EMP-777', 'Month</th><td>April 2031', 'Status</th><td>Committed — final, not paid', 'Overtime hours</th><td>0.25',
      'Overtime records</th><td>1', 'Amount (Rp)</th><td>99.00'];
    check(rt.pr().suppDetailId === SID_MINE2 && /Supplemental payroll — April 2031/.test(html) && rows.every((x) => html.indexOf(x) !== -1) && html.indexOf('<td>' + IDO3 + '</td><td>0.25</td><td>11.00</td>') !== -1,
      'S6. a row opens its own read-only card: the server fields and the frozen overtime lines');
    check(!/Version|swpSupp(Review|Approve|Return|Cancel|Commit|RetryCommit|Reload)Btn|swpPanel|Prepare/.test(html), 'S6. read-only: no control, no version');
    rt.app.fire('swpBackBtn', 'click'); await flush();
    rt.app.fire('swpOpen0', 'click'); await flush();
    html = rt.appHTML();
    check(/Supplemental payroll for this payroll/.test(html) && /<td>1 of 2<\/td>/.test(html) && /<td>2 of 2<\/td>/.test(html) && /Total \(Rp\)<\/th><td>777\.00/.test(html),
      'S6. the payroll card links its Supplemental documents (each separate); its total stays the payroll total as sent');
    rt.app.fire('swpSuppLink0', 'click'); await flush();
    check(rt.pr().suppDetailId === SID_MINE1 && rt.pr().detailId === null, 'S6. a link opens that Supplemental card');
    ['suppGenerate', 'suppReview', 'suppApprove', 'suppReturn', 'suppCancel', 'suppCommit'].forEach((k) => rt.SessionPayroll.openPanel(k, ID7));
    await rt.SessionPayroll.confirmPanel(); await rt.SessionPayroll.retrySupplementalCommit(); rt.SessionPayroll.reloadSupplemental(); await flush();
    check(suppPosts(rt).length === 0 && rt.net.calls.every((c) => !/eligibility/.test(c.url)) && rt.pr().panel === null, 'S6. every Supplemental write or the eligibility, invoked by hand as an Employee, is a no-op');
    firewall(rt, 'S6. My payroll');
    // Defence in depth: a list holding a non-Committed, a colleague's or another company's document is refused whole.
    for(const [label, item] of [['their own Draft', Object.assign({}, SMINE1, { status: 'Draft' })], ['their own Reviewed', Object.assign({}, SMINE1, { status: 'Reviewed' })],
      ['their own Ready', Object.assign({}, SMINE1, { status: 'Ready' })], ['their own Cancelled', Object.assign({}, SMINE1, { status: 'Cancelled' })],
      ['a colleague\'s', Object.assign({}, SMINE1, { employeeId: 'e_5' })], ['another company\'s (another employee id)', Object.assign({}, SMINE1, { employeeId: 'emp_other_co' })]]){
      const r = await boot(ME_EMP, { [LIST(MONTH)]: [ok({ payrollPlans: [MINE] })], [SLIST(MONTH)]: [ok({ supplementalPayrolls: [SMINE2, item] })] });
      r.app.fire('swSectionPayroll', 'click'); await flush();
      check(r.pr().suppList === null && /TAM OS sent an unexpected response/.test(r.appHTML()) && !/<td>99\.00<\/td>/.test(r.appHTML()),
        'S6. a list holding ' + label + ' document is refused whole — nothing of it shown');
    }
    const r2 = await boot(ME_EMP, { [LIST(MONTH)]: [ok({ payrollPlans: [MINE] })], [SLIST(MONTH)]: [ok({ supplementalPayrolls: [SMINE1] })],
      [SDET(SID_MINE1)]: [ok(sdet(Object.assign({}, SMINE1, { employeeId: 'e_5' }), [SLINE]))] });
    r2.app.fire('swSectionPayroll', 'click'); await flush();
    r2.app.fire('swpSuppOpen0', 'click'); await flush();
    check(r2.pr().suppDetail === null && /TAM OS sent an unexpected response/.test(r2.appHTML()), 'S6. a detail of a colleague\'s document is refused');
    const r3 = await boot(ME_EMP, { [LIST(MONTH)]: [ok({ payrollPlans: [] })], [SLIST(MONTH)]: [ok({ supplementalPayrolls: [] })] });
    r3.app.fire('swSectionPayroll', 'click'); await flush();
    check(/No supplemental payroll for April 2031\./.test(r3.appHTML()), 'S6. an empty month says so');
  }

  /* ---------- S7. AFI-4d SESSION firewall: memory only, cleared, stale answers dropped ---------- */
  {
    const rt = await openS({ [SDET(SID_READY)]: [ok(sdet(SREADY, [SLINE]))], [SW.commit]: [NETFAIL()] });
    rt.SessionPayroll.openSupplemental(SID_READY); await flush();
    rt.SessionPayroll.openPanel('suppCommit'); await rt.SessionPayroll.confirmPanel(); await flush();
    check(rt.pr().suppIntent !== null && rt.pr().suppList !== null && rt.pr().elig !== null, 'S7. (Supplemental data and an intent held in memory)');
    rt.SessionPayrollStore.bindPrincipal({ id: 'u_ceo_2', principalType: 'ceo', employeeId: null });
    check(rt.pr().suppIntent === null && rt.pr().suppList === null && rt.pr().elig === null && rt.pr().suppDetail === null, 'S7. a different principal destroys every Supplemental datum and the intent');
    const lo = await openS();
    lo.AuthBoot.sessionLost(); await flush();
    check(lo.pr().suppList === null && lo.pr().elig === null && lo.pr().open === false, 'S7. session loss / logout destroys the Supplemental data');
    const late = deferred();
    const l2 = await openS({ [SLIST(MONTH)]: [late.promise] });
    l2.AuthBoot.sessionLost(); await flush();
    late.resolve(ok(SMONTH)); await flush();
    check(l2.pr().suppList === null, 'S7. a late Supplemental answer after the session ended is dropped');
    const S = lo.SessionPayrollStore;
    const P = (o) => lo.parse(JSON.stringify(o));
    S.bindPrincipal(ME_CEO_PRINCIPAL); S.setOpen(true, MONTH);
    const a = S.begin('suppList', MONTH), b = S.begin('suppList', MONTH);
    check(S.applySuppList(a, P([SDRAFT])) === false && S.applySuppList(b, P([])) === true, 'S7. the store refuses a superseded Supplemental list answer by itself');
    const d1 = S.begin('suppDetail', SID_DRAFT), d2 = S.begin('suppDetail', SID_REV);
    check(S.applySuppDetail(d1, lo.SupplementalDecoders.detailResponse(P(sdet(SDRAFT, [])))) === false && S.applySuppDetail(d2, lo.SupplementalDecoders.detailResponse(P(sdet(SDRAFT, [])))) === false
      && S.applySuppDetail(d2, lo.SupplementalDecoders.detailResponse(P(sdet(SREV, [])))) === true, 'S7. the store refuses a superseded detail and one for another document');
    const e1 = S.begin('elig', MONTH);
    S.setSuppIntent({ id: SID_READY, version: 3, total: '4321.00', key: 'f'.repeat(32) });
    check(Object.isFrozen(S.snapshot().suppIntent), 'S7. the Supplemental intent is one frozen record');
    S.clear();
    check(S.applyElig(e1, P([])) === false && S.snapshot().suppIntent === null && S.snapshot().suppDetail === null, 'S7. after clear() no earlier answer applies, and the intent is gone');
    check(rt.access.local.length === 0 && rt.access.session.length === 0 && rt.access.cookie.length === 0 && rt.access.url.length === 0 && rt.spy.length === 0,
      'S7. no storage, cookie, URL / history or LOCAL engine use anywhere');
  }

  /* ---------- S8. AFI-4d no global collision with the LOCAL Supplemental engine ---------- */
  {
    const rt = loadRuntime({});
    check(rt.spyErr.length === 0 && Array.isArray(rt.LOCAL_SUPPLEMENTAL_STATUSES) && rt.LOCAL_SUPPLEMENTAL_STATUSES.join() === 'Draft,Review,Approved,Posted,Executed,Cancelled'
      && typeof rt.SupplementalApi === 'object' && typeof rt.SupplementalDecoders === 'object',
      'S8. every production module loads together: the LOCAL Supplemental engine keeps its own names and statuses beside the SESSION SupplementalApi / Decoders (no redeclaration)');
    const src = ['core/payroll-api.js', 'core/session-payroll.js', 'ui/session-payroll-view.js'].map((f) => fs.readFileSync(path.join(root, 'js', f), 'utf8')).join('\n');
    const local = fs.readFileSync(path.join(root, 'js', 'people', 'supplemental-engine.js'), 'utf8');
    const localNames = (local.match(/^(?:const|let|var|function|async function) +([A-Za-z_$][A-Za-z0-9_$]*)/gm) || []).map((l) => l.split(/\s+/).pop());
    const mine = (src.match(/^(?:const|let|var|function|async function) +([A-Za-z_$][A-Za-z0-9_$]*)/gm) || []).map((l) => l.split(/\s+/).pop());
    check(localNames.length > 20 && mine.every((n) => localNames.indexOf(n) === -1), 'S8. no top-level SESSION name equals a LOCAL supplemental-engine name');
  }

  /* ---------- F. AFI-4e Finance posting: strict decoders, request encoders, the intent ---------- */
  {
    const rt = loadRuntime({});
    const D0 = rt.FinancePostingDecoders, R = rt.FinancePostingRequests;
    // Every answer is parsed inside the page's realm, as ApiClient's JSON.parse would make it.
    const inPage = (x) => (x === undefined ? x : rt.parse(JSON.stringify(x)));
    const D = { posting: (o) => D0.posting(inPage(o)), monthResponse: (o, m) => D0.monthResponse(inPage(o), m), postingResponse: (o) => D0.postingResponse(inPage(o)) };
    const good = posting(FID1, 'payrollPlan', PCX, '999.00');
    const g2 = posting(FID2, 'supplementalPayroll', SCOM, '4321.00');
    const d = D.posting(good);
    check(!!d && Object.isFrozen(d) && keys(d) === 'amount,employeeId,id,monthKey,sourceId,sourceKind,status' && d.amount === '999.00' && d.status === 'Planned',
      'F. a posting decodes to exactly its seven keys (FinancePostingView::FIELDS), frozen, the amount verbatim');
    const missing = Object.assign({}, good); delete missing.employeeId;
    [['an extra key', Object.assign({}, good, { companyId: 'c_1' })], ['the idempotency key', Object.assign({}, good, { idempotencyKey: 'a'.repeat(32) })],
     ['a missing key', missing], ['an unknown source kind', Object.assign({}, good, { sourceKind: 'payroll' })], ['a bad source id', Object.assign({}, good, { sourceId: 'X'.repeat(32) })],
     ['a bad id', Object.assign({}, good, { id: '1' })], ['a bad employee id', Object.assign({}, good, { employeeId: 'a b' })], ['a bad month', Object.assign({}, good, { monthKey: '2031-13' })],
     ['a zero amount', Object.assign({}, good, { amount: '0.00' })], ['a fractional amount', Object.assign({}, good, { amount: '999.50' })], ['a number amount', Object.assign({}, good, { amount: 999 })],
     ['an Executed status', Object.assign({}, good, { status: 'Executed' })], ['a Paid status', Object.assign({}, good, { status: 'Paid' })], ['a null', null], ['an array', [good]]]
      .forEach(([label, o]) => check(D.posting(o) === null, 'F. a posting with ' + label + ' is refused'));
    const two = D.monthResponse({ financePostings: [good, g2] }, MONTH);
    check(Array.isArray(two) && two.length === 2 && Object.isFrozen(two), 'F. a month answer of two postings of the month decodes, frozen');
    const sameIdOtherKind = posting(FID3, 'supplementalPayroll', { id: IDPC, employeeId: 'e_c' }, '4321.00');
    check(Array.isArray(D.monthResponse({ financePostings: [good, sameIdOtherKind] }, MONTH)), 'F. a plan and a document are distinct sources even with the same id (sourceKind + sourceId)');
    const many = [];
    for(let i = 0; i < 2001; i++){ const h = ('00000000' + i.toString(16)).slice(-8); many.push(posting(h.repeat(4), 'payrollPlan', { id: 'ffffffff' + h.repeat(3), employeeId: 'e_' + i }, '1.00')); }
    [['a posting of another month', { financePostings: [Object.assign({}, good, { monthKey: '2031-05' })] }], ['two postings of one source', { financePostings: [good, Object.assign({}, good, { id: FID3 })] }],
     ['two postings with one id', { financePostings: [good, Object.assign({}, g2, { id: FID1 })] }], ['one bad item', { financePostings: [good, Object.assign({}, g2, { status: 'Reversed' })] }],
     ['an extra wrapper key', { financePostings: [], total: '1.00' }], ['no array', { financePostings: {} }], ['more postings than the server cap (2001)', { financePostings: many }]]
      .forEach(([label, data]) => check(D.monthResponse(data, MONTH) === null, 'F. a month answer with ' + label + ' is refused whole'));
    check(D.monthResponse({ financePostings: many.slice(0, 2000) }, MONTH) !== null, 'F. a month answer of exactly the server cap (2000) decodes');
    check(D.postingResponse({ financePosting: good }) !== null && D.postingResponse({ financePosting: good, extra: 1 }) === null && D.postingResponse({ financePostings: [good] }) === null,
      'F. a posting answer is exactly { financePosting }');
    const intentP = { sourceKind: 'payrollPlan', sourceId: IDPC, employeeId: 'e_c', monthKey: MONTH, amount: '999.00', key: 'a'.repeat(32) };
    const rp = R.post(intentP);
    check(rp.ok && keys(rp.body) === FIN_PLAN_KEYS && rp.body.payrollPlanId === IDPC && rp.body.expectedAmount === '999.00' && rp.body.idempotencyKey === 'a'.repeat(32),
      'F. the plan posting body is exactly { payrollPlanId, expectedAmount, idempotencyKey } — never the employee, month, status or a company');
    const rs = R.post(Object.assign({}, intentP, { sourceKind: 'supplementalPayroll', sourceId: SID_COM, amount: '4321.00' }));
    check(rs.ok && keys(rs.body) === FIN_SUPP_KEYS && rs.body.supplementalPayrollId === SID_COM && rs.body.expectedAmount === '4321.00',
      'F. the Supplemental posting body is exactly { supplementalPayrollId, expectedAmount, idempotencyKey }');
    [['an unknown kind', { sourceKind: 'finance' }, 'sourceKind'], ['a bad source id', { sourceId: 'x' }, 'payrollPlanId'], ['a zero amount', { amount: '0.00' }, 'expectedAmount'],
     ['a number amount', { amount: 999 }, 'expectedAmount'], ['a bad key', { key: 'A'.repeat(32) }, 'idempotencyKey']]
      .forEach(([label, patch, field]) => { const r = R.post(Object.assign({}, intentP, patch)); check(!r.ok && r.fields.indexOf(field) !== -1, 'F. a request with ' + label + ' is refused locally (' + field + ')'); });
    const it = rt.financePostingIntent('payrollPlan', PCX);
    check(!!it && Object.isFrozen(it) && it.amount === '999.00' && it.sourceId === IDPC && it.employeeId === 'e_c' && it.monthKey === MONTH && /^[0-9a-f]{32}$/.test(it.key) && rt.crypto.calls === 1,
      'F. a posting intent of a Committed plan: its own totalAmount string (999.00, not base + overtime) and one Web Crypto key, frozen');
    check(rt.financePostingIntent('supplementalPayroll', SCOM).amount === '4321.00', 'F. a Supplemental intent carries the document\'s own overtimeAmount (not its lines\' sum)');
    const calls = rt.crypto.calls;
    check(rt.financePostingIntent('payrollPlan', P3) === null && rt.financePostingIntent('supplementalPayroll', SREADY) === null && rt.financePostingIntent('other', PCX) === null && rt.crypto.calls === calls,
      'F. no intent (and no key) for a non-Committed source or an unknown kind');
    check(loadRuntime({}, { noCrypto: true }).financePostingIntent('payrollPlan', PCX) === null, 'F. without Web Crypto there is no intent');
    check(Object.keys(rt.FinancePostingApi).sort().join() === 'month,post', 'F. the Finance client has exactly the month read and the post — no execute, pay, reverse or correct');
  }

  /* ---------- F1. AFI-4e CEO: base payroll posting — the card, the confirmation, the exact body ---------- */
  {
    const rt = await openFin();
    let html = rt.appHTML();
    check(countOf(rt, FIN(MONTH)) === 2 && /id="swpFinance"/.test(html) && /<p class="auth-lead">Not posted to Finance<\/p>/.test(html) && /id="swpFinPostBtn"/.test(html),
      'F1. a Committed plan with no posting: "Not posted to Finance" and Post to Finance; the postings are read with the month and again on opening the plan');
    rt.app.fire('swpFinPostBtn', 'click'); await flush();
    html = rt.appHTML();
    check(!!rt.pr().panel && rt.pr().panel.kind === 'finPostPlan' && finPosts(rt).length === 0 && rt.crypto.calls === 0 && rt.pr().postIntent === null,
      'F1. Post to Finance asks first (an inline confirmation): nothing sent, no key, no intent yet');
    check(html.indexOf('Records one Planned Finance posting of Rp 999.00. Nothing is paid or executed. A posting cannot be reversed.') !== -1
      && /Post this payroll to Finance\?/.test(html) && /Fabricated EMP-0C \(EMP-0C\) — April 2031\./.test(html),
      'F1. the confirmation is the approved wording with the plan\'s own total 999.00 (never base + overtime)');
    check(/btn btn-danger" type="button" id="swpPanelConfirm"[^>]*>Post to Finance</.test(html) && !/<input|<select|<textarea|contenteditable/.test(html),
      'F1. a deliberate, danger-styled "Post to Finance"; no editable amount anywhere');
    rt.net.routes[FW.plan] = [fone(posting(FID1, 'payrollPlan', PCX, '999.00'))];
    rt.net.routes[FIN(MONTH)] = [finOk([posting(FID1, 'payrollPlan', PCX, '999.00')])];
    rt.app.fire('swpPanelConfirm', 'click');
    const second = rt.app.fire('swpPanelConfirm', 'click');
    await rt.SessionPayroll.confirmPanel(); await flush();
    const sent = finPosts(rt, FW.plan);
    check(sent.length === 1 && finPosts(rt).length === 1 && rt.crypto.calls === 1 && second !== 'fired', 'F1. one confirmation, double-clicked and invoked again: exactly one key and one POST');
    const b = sent.length ? bodyOf(sent[0]) : {};
    check(keys(b) === FIN_PLAN_KEYS && b.payrollPlanId === IDPC && sent[0].init.headers['X-CSRF-Token'] === CSRF,
      'F1. the body is exactly { payrollPlanId, expectedAmount, idempotencyKey }, a CSRF POST to /api/finance-postings/payroll-plan');
    check(b.expectedAmount === '999.00' && typeof b.expectedAmount === 'string' && b.expectedAmount === PCX.totalAmount,
      'F1. expectedAmount is the plan\'s exact totalAmount string 999.00 — never base + overtime, never a number');
    check(/^[0-9a-f]{32}$/.test(b.idempotencyKey) && b.idempotencyKey === rt.crypto.last, 'F1. the key is the 16 Web Crypto bytes as 32 lowercase hex characters');
    html = rt.appHTML();
    check(rt.pr().postIntent === null && rt.pr().panel === null && /<p class="auth-lead">Posted to Finance — Planned, not paid<\/p>/.test(html)
      && /Planned amount \(Rp\)<\/th><td>999\.00</.test(html) && !/id="swpFinPostBtn"/.test(html) && countOf(rt, FIN(MONTH)) === 3,
      'F1. confirmed: the intent ends, the postings are read again — "Posted to Finance — Planned, not paid" with the posted amount, and no Post');
    check(/id="swpMutationMessage"[^>]*>Posted to Finance — Planned, not paid\.</.test(html), 'F1. the notice says Posted to Finance — Planned, not paid');
    check(rt.pr().detail.plan.status === 'Committed' && rt.pr().detail.plan.version === 4 && posts(rt).length === 0, 'F1. posting changes nothing in Payroll (no Payroll write)');
    firewall(rt, 'F1. posted');
    for(const [label, p] of [['another source', Object.assign(posting(FID1, 'payrollPlan', PCX, '999.00'), { sourceId: ID4 })], ['another kind', Object.assign(posting(FID1, 'payrollPlan', PCX, '999.00'), { sourceKind: 'supplementalPayroll' })],
      ['another amount', posting(FID1, 'payrollPlan', PCX, '1000.00')], ['another employee', Object.assign(posting(FID1, 'payrollPlan', PCX, '999.00'), { employeeId: 'e_x' })],
      ['another month', Object.assign(posting(FID1, 'payrollPlan', PCX, '999.00'), { monthKey: '2031-05' })], ['an Executed status', Object.assign(posting(FID1, 'payrollPlan', PCX, '999.00'), { status: 'Executed' })]]){
      const r = await openFin({ [FW.plan]: [fone(p)] });
      r.app.fire('swpFinPostBtn', 'click'); await flush();
      r.app.fire('swpPanelConfirm', 'click'); await flush();
      check(r.pr().mutation.status === 'ambiguous' && finPosts(r).length === 1 && r.pr().postIntent !== null && /id="swpFinRetryPostBtn"/.test(r.appHTML()),
        'F1. a success answer with ' + label + ' is not a success: unknown outcome, re-read (still unposted), the intent kept, Retry posting offered, nothing resent');
    }
  }

  {
    // The intent ends with the confirming answer itself — not only once the postings are read again.
    const r = await openFin({ [FW.plan]: [fone(posting(FID1, 'payrollPlan', PCX, '999.00'))] });
    r.app.fire('swpFinPostBtn', 'click'); await flush();
    r.net.routes[FIN(MONTH)] = ['HANG'];
    r.app.fire('swpPanelConfirm', 'click'); await flush();
    check(r.pr().postIntent === null && r.pr().mutation.status === 'idle' && r.pr().notice === 'finRecorded' && /Checking the Finance status…/.test(r.appHTML()) && !/id="swpFinPostBtn"/.test(r.appHTML()),
      'F1. a confirming answer ends the intent at once; while the postings are read again, Post is not offered');
  }

  /* ---------- F2. AFI-4e CEO: Supplemental posting ---------- */
  {
    const FSC = posting(FID2, 'supplementalPayroll', SCOM, '4321.00');
    const rt = await suppDetail(SCOM, [SLINE]);
    let html = rt.appHTML();
    check(/id="swpFinance"/.test(html) && /<p class="auth-lead">Not posted to Finance<\/p>/.test(html) && /id="swpSuppFinPostBtn"/.test(html) && countOf(rt, FIN(MONTH)) === 2,
      'F2. a Committed Supplemental document with no posting: "Not posted to Finance" and Post to Finance (its postings read again on opening it)');
    rt.app.fire('swpSuppFinPostBtn', 'click'); await flush();
    html = rt.appHTML();
    check(!!rt.pr().panel && rt.pr().panel.kind === 'finPostSupp' && /Post this supplemental payroll to Finance\?/.test(html)
      && html.indexOf('Records one Planned Finance posting of Rp 4321.00. Nothing is paid or executed. A posting cannot be reversed.') !== -1 && finPosts(rt).length === 0 && rt.pr().postIntent === null,
      'F2. the confirmation: the approved wording with the document\'s own amount 4321.00; nothing sent yet');
    rt.net.routes[FW.supp] = [fone(FSC)];
    rt.net.routes[FIN(MONTH)] = [finOk([FSC])];
    rt.app.fire('swpPanelConfirm', 'click'); await flush();
    const sent = finPosts(rt, FW.supp);
    const b = sent.length ? bodyOf(sent[0]) : {};
    check(sent.length === 1 && finPosts(rt).length === 1 && keys(b) === FIN_SUPP_KEYS && b.supplementalPayrollId === SID_COM && b.expectedAmount === '4321.00' && sent[0].init.headers['X-CSRF-Token'] === CSRF,
      'F2. exactly one CSRF POST of { supplementalPayrollId, expectedAmount, idempotencyKey } — the document\'s amount 4321.00, never its lines\' 1234.00');
    html = rt.appHTML();
    check(rt.pr().postIntent === null && /<p class="auth-lead">Posted to Finance — Planned, not paid<\/p>/.test(html) && /Planned amount \(Rp\)<\/th><td>4321\.00</.test(html) && !/id="swpSuppFinPostBtn"/.test(html)
      && suppPosts(rt).length === 0, 'F2. confirmed: Posted to Finance — Planned, not paid, with the posted amount; no Supplemental write');
    firewall(rt, 'F2. supplemental posted');
  }

  /* ---------- F3. AFI-4e already posted; matched by sourceKind + sourceId ---------- */
  {
    const FPC = posting(FID1, 'payrollPlan', PCX, '999.00'), FSC = posting(FID2, 'supplementalPayroll', SCOM, '4321.00');
    const rt = await openFin({ [FIN(MONTH)]: [finOk([FPC, FSC])] });
    const html = rt.appHTML();
    check(/<p class="auth-lead">Posted to Finance — Planned, not paid<\/p>/.test(html) && /Planned amount \(Rp\)<\/th><td>999\.00</.test(html) && !/id="swpFinPostBtn"|id="swpFinRetryPostBtn"/.test(html),
      'F3. an already-posted plan: Posted to Finance — Planned, not paid, its amount, and no Post');
    rt.SessionPayroll.openPanel('finPostPlan'); await flush();
    await rt.SessionPayroll.confirmPanel(); await rt.SessionPayroll.retryPosting(); await flush();
    check(rt.pr().panel === null && finPosts(rt).length === 0 && rt.crypto.calls === 0, 'F3. called directly: no confirmation, no key and nothing sent for a posted plan');
    firewall(rt, 'F3. posted plan');
    const amt = await openFin({ [FIN(MONTH)]: [finOk([posting(FID1, 'payrollPlan', PCX, '1000.00')])] });
    check(/Planned amount \(Rp\)<\/th><td>1000\.00</.test(amt.appHTML()) && !/Planned amount \(Rp\)<\/th><td>999\.00</.test(amt.appHTML()),
      'F3. the posted card shows the posting\'s own amount as the server sent it — never the source\'s');
    const o = await openFin({ [FIN(MONTH)]: [finOk([posting(FID3, 'payrollPlan', P4, '5000000.00'), posting(FID4, 'supplementalPayroll', { id: IDPC, employeeId: 'e_c' }, '4321.00')])] });
    check(/Not posted to Finance/.test(o.appHTML()) && /id="swpFinPostBtn"/.test(o.appHTML()),
      'F3. another plan\'s posting, or a Supplemental posting whose id equals this plan\'s, does not post this plan (sourceKind + sourceId)');
    const s = await suppDetail(SCOM, [SLINE], { [FIN(MONTH)]: [finOk([FSC])] });
    check(/Posted to Finance — Planned, not paid<\/p>/.test(s.appHTML()) && /<td>4321\.00<\/td>/.test(s.appHTML()) && !/id="swpSuppFinPostBtn"/.test(s.appHTML()),
      'F3. an already-posted Supplemental document: Posted, its amount, no Post');
    firewall(s, 'F3. posted supplemental');
  }

  /* ---------- F4. AFI-4e ineligible sources: no Finance line, no Post ---------- */
  {
    for(const p of [P1, P2, P3, P5]){
      const r = await detail(p.id, det(p), { [DRIFT(p.id)]: [driftOk(p.id, [])], [FIN(MONTH)]: [finOk([posting(FID1, 'payrollPlan', p, '5000000.00')])] });
      r.SessionPayroll.openPanel('finPostPlan'); await flush();
      check(!/id="swpFinance"|swpFinPostBtn/.test(r.appHTML()) && r.pr().panel === null && finPosts(r).length === 0,
        'F4. a ' + p.status + ' plan shows no Finance line and no Post (even with a hypothetical posting of it), and cannot open one');
    }
    for(const doc of [SDRAFT, SREV, SREADY, SCAN]){
      const r = await suppDetail(doc, []);
      r.SessionPayroll.openPanel('finPostSupp'); await flush();
      check(!/id="swpFinance"|swpSuppFinPostBtn/.test(r.appHTML()) && r.pr().panel === null && finPosts(r).length === 0, 'F4. a ' + doc.status + ' Supplemental document shows no Finance line and no Post');
    }
    const c = await detail(ID4, det(P4));
    check(/id="swpFinance"/.test(c.appHTML()) && /id="swpFinPostBtn"/.test(c.appHTML()), 'F4. a Committed plan does show its Finance line');
    const l = await open();
    check(!/swpFinance|Not posted to Finance|Post to Finance/.test(l.appHTML()) && countOf(l, FIN(MONTH)) === 1, 'F4. the month list shows no Finance status (D-AFI4e-4 = A: details only), though the month\'s postings are read');
  }

  /* ---------- F5. AFI-4e the unknown outcome and Retry posting (D-AFI4e-3 = A) ---------- */
  {
    const FPC = posting(FID1, 'payrollPlan', PCX, '999.00');
    // A: the posting was recorded — the re-read resolves it.
    const a = await openFin({ [FW.plan]: [NETFAIL()] });
    a.app.fire('swpFinPostBtn', 'click'); await flush();
    a.net.routes[FIN(MONTH)] = [finOk([FPC])];
    a.app.fire('swpPanelConfirm', 'click'); await flush();
    check(finPosts(a).length === 1 && a.pr().postIntent === null && countOf(a, DET(IDPC)) === 2
      && /could not confirm the posting at first, but the Finance status read again shows it: Posted to Finance — Planned, not paid\./.test(a.appHTML()) && /Posted to Finance — Planned, not paid<\/p>/.test(a.appHTML()),
      'F5. A: a network failure, then the re-read shows the posting at the same amount — resolved as the success, nothing resent');
    firewall(a, 'F5. A');
    // B: still unposted at the same amount — Retry posting, the same body and key, only on a click.
    const b = await openFin({ [FW.plan]: [NETFAIL(), fone(FPC)] });
    b.app.fire('swpFinPostBtn', 'click'); await flush();
    b.app.fire('swpPanelConfirm', 'click'); await flush();
    const first = bodyOf(finPosts(b, FW.plan)[0]);
    let html = b.appHTML();
    check(finPosts(b).length === 1 && !!b.pr().postIntent && b.pr().postIntent.key === first.idempotencyKey && /id="swpFinRetryPostBtn"/.test(html) && !/id="swpFinPostBtn"/.test(html)
      && /still not posted to Finance, at the same amount\. Retry posting sends the same posting again/.test(html),
      'F5. B: still Committed and unposted at the same amount — the intent is kept and Retry posting offered; nothing was resent');
    b.render(); await flush(); b.SessionPayroll.ensureLoaded(b.AuthBoot.snapshot().principal); await flush();
    b.SessionPayroll.openPanel('finPostPlan'); await flush();
    check(finPosts(b).length === 1 && b.pr().panel === null && b.crypto.calls === 1, 'F5. B: a re-render, a reload of state or another Post never sends or makes a new key');
    b.app.fire('swpBackBtn', 'click'); await flush();
    b.app.fire('swpOpen5', 'click'); await flush();
    check(!!b.pr().postIntent && /id="swpFinRetryPostBtn"/.test(b.appHTML()) && finPosts(b).length === 1, 'F5. B: leaving and reopening the plan keeps the unresolved intent (Retry posting, never a new key)');
    b.net.routes[FIN(MONTH)] = [finOk([FPC])];
    b.app.fire('swpFinRetryPostBtn', 'click');
    const again = b.app.fire('swpFinRetryPostBtn', 'click');
    await b.SessionPayroll.retryPosting(); await flush();
    const retried = finPosts(b, FW.plan);
    check(retried.length === 2 && again !== 'fired' && JSON.stringify(bodyOf(retried[1])) === JSON.stringify(first) && b.crypto.calls === 1,
      'F5. B: Retry posting (double-clicked) sends exactly one POST with the SAME payrollPlanId, expectedAmount and key — no new key');
    check(b.pr().postIntent === null && /Posted to Finance — Planned, not paid<\/p>/.test(b.appHTML()), 'F5. B: the retried posting (the server\'s replay) is confirmed');
    firewall(b, 'F5. B');
    // C: the re-read shows a posting at another amount — the intent is dropped as stale.
    const c = await openFin({ [FW.plan]: [NETFAIL()] });
    c.app.fire('swpFinPostBtn', 'click'); await flush();
    c.net.routes[FIN(MONTH)] = [finOk([posting(FID1, 'payrollPlan', PCX, '1000.00')])];
    c.app.fire('swpPanelConfirm', 'click'); await flush();
    check(c.pr().postIntent === null && !/id="swpFinRetryPostBtn"/.test(c.appHTML()) && /what was read again has changed/.test(c.appHTML()) && finPosts(c).length === 1,
      'F5. C: the re-read does not match the intent — dropped as stale; no Retry; nothing resent');
    // C2: the source read again carries another amount (still unposted) — stale, never Retry.
    const c2 = await openFin({ [FW.plan]: [NETFAIL()], [DET(IDPC)]: [ok(det(PCX, [OT1])), ok(det(Object.assign({}, PCX, { totalAmount: '1000.00' }), [OT1]))] });
    c2.app.fire('swpFinPostBtn', 'click'); await flush();
    c2.app.fire('swpPanelConfirm', 'click'); await flush();
    check(c2.pr().postIntent === null && !/id="swpFinRetryPostBtn"/.test(c2.appHTML()) && /what was read again has changed/.test(c2.appHTML()) && finPosts(c2).length === 1,
      'F5. C2: the plan read again carries another amount — the intent is stale: dropped, no Retry, nothing resent');
    // P: while the re-read is pending, Retry posting (called directly) sends nothing.
    const pend = await openFin({ [FW.plan]: [NETFAIL()] });
    pend.app.fire('swpFinPostBtn', 'click'); await flush();
    pend.net.routes[FIN(MONTH)] = ['HANG'];
    pend.app.fire('swpPanelConfirm', 'click'); await flush();
    await pend.SessionPayroll.retryPosting(); await flush();
    check(!!pend.pr().postIntent && finPosts(pend).length === 1 && !/id="swpFinRetryPostBtn"/.test(pend.appHTML()) && /It is being read again…/.test(pend.appHTML()),
      'F5. P: while the Finance status is read again, the outcome is undecided — no Retry posting, and calling it sends nothing');
    // D: the Finance re-read fails — the intent is kept, nothing is sent, no Retry until it is read.
    const d = await openFin({ [FW.plan]: [NETFAIL()] });
    d.app.fire('swpFinPostBtn', 'click'); await flush();
    d.net.routes[FIN(MONTH)] = [err(500, 'internal_error'), finOk([])];
    d.app.fire('swpPanelConfirm', 'click'); await flush();
    html = d.appHTML();
    check(!!d.pr().postIntent && /could not be read again\. Nothing is sent again/.test(html) && !/id="swpFinRetryPostBtn"|id="swpFinPostBtn"/.test(html) && /id="swpFinRetryBtn"/.test(html) && finPosts(d).length === 1,
      'F5. D: the Finance re-read fails — the intent is kept, nothing sent, neither Post nor Retry posting until it is read');
    d.app.fire('swpFinRetryBtn', 'click'); await flush();
    check(/id="swpFinRetryPostBtn"/.test(d.appHTML()) && finPosts(d).length === 1, 'F5. D: reading the Finance status again (still unposted) offers Retry posting — still nothing sent');
    // E: 500, 503, a malformed answer and a timeout are unknown outcomes too.
    for(const [label, answer] of [['a 500', err(500, 'internal_error')], ['a 503', err(503, 'service_unavailable')], ['a malformed answer', fone(Object.assign({}, FPC, { idempotencyKey: 'a'.repeat(32) }))], ['a timeout', 'HANG']]){
      const e = await openFin({ [FW.plan]: [answer] });
      e.app.fire('swpFinPostBtn', 'click'); await flush();
      e.app.fire('swpPanelConfirm', 'click'); await flush();
      if(answer === 'HANG'){ e.net.timers.splice(0).forEach((fn) => fn()); await flush(); }
      check(e.pr().mutation.status === 'ambiguous' && !!e.pr().postIntent && finPosts(e).length === 1 && /id="swpFinRetryPostBtn"/.test(e.appHTML()),
        'F5. ' + label + ' to a posting is an unknown outcome: the intent is kept, re-read, never resent automatically');
    }
    // F: session loss destroys the intent and its key.
    const f = await openFin({ [FW.plan]: [NETFAIL()] });
    f.app.fire('swpFinPostBtn', 'click'); await flush();
    f.app.fire('swpPanelConfirm', 'click'); await flush();
    check(!!f.pr().postIntent, 'F5. (an unresolved posting intent is held in memory)');
    f.AuthBoot.sessionLost(); await flush();
    check(f.pr().postIntent === null && f.pr().fin === null && f.access.local.length === 0 && f.access.session.length === 0, 'F5. session loss destroys the intent, its key and the postings; nothing was ever stored');
    // G: no Web Crypto — nothing is sent.
    const g = await openFin({}, { noCrypto: true });
    g.app.fire('swpFinPostBtn', 'click'); await flush();
    g.app.fire('swpPanelConfirm', 'click'); await flush();
    check(finPosts(g).length === 0 && g.pr().postIntent === null && /cannot create a secure posting key\. Nothing was sent\./.test(g.appHTML()), 'F5. without Web Crypto the posting fails closed: nothing sent');
    // H: while one intent is unresolved, no other source can be posted.
    const h = await openFin({ [FW.plan]: [NETFAIL()], [SDET(SID_COM)]: [ok(sdet(SCOM, [SLINE]))] });
    h.app.fire('swpFinPostBtn', 'click'); await flush();
    h.app.fire('swpPanelConfirm', 'click'); await flush();
    h.app.fire('swpBackBtn', 'click'); await flush();
    await h.SessionPayroll.openSupplemental(SID_COM); await flush();
    h.SessionPayroll.openPanel('finPostSupp'); await flush();
    check(/Another Finance posting is not confirmed yet\./.test(h.appHTML()) && !/id="swpSuppFinPostBtn"/.test(h.appHTML()) && h.pr().panel === null && finPosts(h).length === 1 && h.crypto.calls === 1,
      'F5. H: while a posting is unresolved another source offers no Post (one posting command at a time)');
  }

  /* ---------- F6. AFI-4e definite refusals: a generic 409, a stale amount, 400 / 401 / 403 / 404 ---------- */
  {
    const FPC = posting(FID1, 'payrollPlan', PCX, '999.00');
    const rt = await openFin({ [FW.plan]: [err(409, 'conflict')] });
    rt.app.fire('swpFinPostBtn', 'click'); await flush();
    rt.app.fire('swpPanelConfirm', 'click'); await flush();
    let html = rt.appHTML();
    check(rt.pr().panel === null && rt.pr().postIntent === null && finPosts(rt).length === 1 && countOf(rt, DET(IDPC)) === 2 && countOf(rt, FIN(MONTH)) === 3,
      'F6. a 409: definitely refused — the confirmation closes, the intent is dropped, the plan and the postings are read again, nothing resent');
    check(html.indexOf('TAM OS did not record this posting (a conflict was reported). It and its Finance status were read again from TAM OS — check them before choosing again.') !== -1
      && !/finance_(posted|amount|source_state|duplicate)|idempotency_mismatch|already posted|amount (changed|no longer)/i.test(html), 'F6. the conflict message never claims which cause it was');
    check(/id="swpFinPostBtn"/.test(html), 'F6. the re-read still shows it unposted: a new deliberate Post may follow');
    rt.app.fire('swpFinPostBtn', 'click'); await flush();
    rt.net.routes[FW.plan] = [fone(FPC)]; rt.net.routes[FIN(MONTH)] = [finOk([FPC])];
    rt.app.fire('swpPanelConfirm', 'click'); await flush();
    const both = finPosts(rt);
    check(both.length === 2 && bodyOf(both[1]).idempotencyKey !== bodyOf(both[0]).idempotencyKey && rt.crypto.calls === 2 && /Posted to Finance — Planned, not paid<\/p>/.test(rt.appHTML()),
      'F6. that new deliberate posting is a new command with a fresh key, and it is confirmed');
    firewall(rt, 'F6. 409');
    // A 409 whose re-read shows the posting (recorded elsewhere): shown as posted, no Post.
    const p2 = await openFin({ [FW.plan]: [err(409, 'conflict')] });
    p2.app.fire('swpFinPostBtn', 'click'); await flush();
    p2.net.routes[FIN(MONTH)] = [finOk([FPC])];
    p2.app.fire('swpPanelConfirm', 'click'); await flush();
    check(/Posted to Finance — Planned, not paid<\/p>/.test(p2.appHTML()) && !/id="swpFinPostBtn"/.test(p2.appHTML()) && /a conflict was reported/.test(p2.appHTML()) && p2.pr().postIntent === null,
      'F6. a 409 whose re-read shows a posting of the plan: it is shown posted, no Post, and the conflict is not explained');
    // Stale expected amount: the server refuses (409); the client sent exactly what it showed and
    // shows what is read again — never an amount it computed.
    const st = await openFin({ [FW.plan]: [err(409, 'conflict')], [DET(IDPC)]: [ok(det(PCX, [OT1])), ok(det(Object.assign({}, PCX, { totalAmount: '1000.00' }), [OT1]))] });
    st.app.fire('swpFinPostBtn', 'click'); await flush();
    st.app.fire('swpPanelConfirm', 'click'); await flush();
    check(bodyOf(finPosts(st)[0]).expectedAmount === '999.00' && /Total \(Rp\)<\/th><td>1000\.00</.test(st.appHTML()) && st.pr().postIntent === null,
      'F6. a stale expected amount: refused (409), the plan read again with the server\'s amount');
    st.app.fire('swpFinPostBtn', 'click'); await flush();
    check(st.appHTML().indexOf('Records one Planned Finance posting of Rp 1000.00.') !== -1, 'F6. a new confirmation shows the amount read again (1000.00), as sent by the server');
    // Other definite answers.
    for(const [label, answer, text] of [['a 400', err(400, 'validation_failed'), 'TAM OS could not accept this posting.'], ['a 403', err(403, 'forbidden'), 'You do not have permission to post to Finance.']]){
      const r = await openFin({ [FW.plan]: [answer] });
      r.app.fire('swpFinPostBtn', 'click'); await flush();
      r.app.fire('swpPanelConfirm', 'click'); await flush();
      check(r.pr().postIntent === null && finPosts(r).length === 1 && r.appHTML().indexOf(text) !== -1 && countOf(r, DET(IDPC)) === 2, 'F6. ' + label + ': definitely refused — "' + text + '", the intent dropped, read again, nothing resent');
    }
    const nf = await openFin({ [FW.plan]: [err(404, 'not_found')] });
    nf.app.fire('swpFinPostBtn', 'click'); await flush();
    nf.app.fire('swpPanelConfirm', 'click'); await flush();
    check(nf.pr().postIntent === null && nf.pr().detailId === null && countOf(nf, LIST(MONTH)) === 2 && /This payroll is no longer available\. The month was read again\./.test(nf.appHTML()),
      'F6. a 404: the intent is dropped, the detail closes, the month is read again');
    const ua = await openFin({ [FW.plan]: [err(401, 'unauthenticated')] });
    ua.app.fire('swpFinPostBtn', 'click'); await flush();
    ua.app.fire('swpPanelConfirm', 'click'); await flush();
    check(ua.pr().postIntent === null && ua.pr().fin === null && ua.state() !== ua.AUTH_STATES.AUTHENTICATED, 'F6. a 401 ends the session: the intent, its key and the postings are destroyed');
  }

  /* ---------- F7. AFI-4e the Finance read: failure, malformed, denied, loading — never Post ---------- */
  {
    const rt = await openFin({ [FIN(MONTH)]: [err(503, 'service_unavailable')] });
    let html = rt.appHTML();
    check(/could not read the Finance status of this month, so posting is not offered\./.test(html) && /id="swpFinRetryBtn"/.test(html) && !/id="swpFinPostBtn"/.test(html),
      'F7. the Finance read failed: its status is unknown, Retry Finance status is offered, and Post is not');
    rt.SessionPayroll.openPanel('finPostPlan'); await flush();
    check(rt.pr().panel === null && finPosts(rt).length === 0, 'F7. Post cannot be opened while the Finance status is unknown');
    rt.net.routes[FIN(MONTH)] = [finOk([])];
    rt.app.fire('swpFinRetryBtn', 'click'); await flush();
    check(/id="swpFinPostBtn"/.test(rt.appHTML()) && countOf(rt, FIN(MONTH)) === 3, 'F7. Retry Finance status reads it again; unposted, Post is offered');
    firewall(rt, 'F7. retried');
    const m = await openFin({ [FIN(MONTH)]: [finOk([posting(FID1, 'payrollPlan', PCX, '999.00'), posting(FID2, 'payrollPlan', PCX, '999.00')])] });
    check(/could not read the Finance status/.test(m.appHTML()) && !/id="swpFinPostBtn"|Posted to Finance/.test(m.appHTML()), 'F7. a malformed Finance answer (two postings of one plan) is refused whole: no Post, no Posted');
    const dn = await openFin({ [FIN(MONTH)]: [err(403, 'forbidden')] });
    check(/could not read the Finance status/.test(dn.appHTML()) && !/id="swpFinRetryBtn"|id="swpFinPostBtn"/.test(dn.appHTML()), 'F7. a denied Finance read: no Post and no retry');
    const ld = await openFin({ [FIN(MONTH)]: ['HANG'] });
    check(/Checking the Finance status…/.test(ld.appHTML()) && !/id="swpFinPostBtn"/.test(ld.appHTML()), 'F7. while the Finance status loads, Post is not offered');
    const mo = await openFin();
    mo.app.fire('swpBackBtn', 'click'); await flush();
    mo.app.fire('swpNextMonth', 'click'); await flush();
    check(countOf(mo, FIN('2031-05')) === 1 && mo.pr().finMonth === '2031-05', 'F7. another month reads that month\'s postings (the old ones are forgotten)');
  }

  /* ---------- F8. AFI-4e the Employee never sees, reads or writes Finance ---------- */
  {
    const rt = await boot(ME_EMP, { [LIST(MONTH)]: [ok({ payrollPlans: [MINE] })], [DET(ID7)]: [ok(det(MINE, [OT1]))], [SLIST(MONTH)]: [ok({ supplementalPayrolls: [SMINE1] })],
      [SDET(SID_MINE1)]: [ok(sdet(SMINE1, [SLINE]))], [FIN(MONTH)]: [finOk([posting(FID1, 'payrollPlan', MINE, '777.00')])] });
    rt.app.fire('swSectionPayroll', 'click'); await flush();
    rt.app.fire('swpOpen0', 'click'); await flush();
    const planHTML = rt.appHTML();
    rt.app.fire('swpBackBtn', 'click'); await flush();
    rt.app.fire('swpSuppOpen0', 'click'); await flush();
    const suppHTML = rt.appHTML();
    rt.SessionPayroll.openPanel('finPostPlan'); rt.SessionPayroll.openPanel('finPostSupp'); await rt.SessionPayroll.confirmPanel();
    await rt.SessionPayroll.retryPosting(); await rt.SessionPayroll.retryFinance(); await flush();
    check(!/Finance|Posted|swpFin|swpSuppFin/.test(planHTML + suppHTML + rt.appHTML()) && rt.net.calls.every((c) => !/^\/api\/finance/.test(c.url)) && rt.pr().fin === null && rt.pr().postIntent === null && rt.crypto.calls === 0,
      'F8. an Employee\'s own Committed payroll and Supplemental cards show no Finance; no Finance read or write is ever made, even called directly');
    firewall(rt, 'F8. Employee');
  }

  /* ---------- F9. AFI-4e no execution semantics; the store's own guards ---------- */
  {
    const rt = await openFin({ [FIN(MONTH)]: [finOk([posting(FID1, 'payrollPlan', PCX, '999.00')])] });
    // AFI-4f authorized revision: a posted card now also holds the AFI-4f payment status (its one
    // control is Record payment, pinned in X–X9); the posting part itself is unchanged. Was: a
    // posted card held no control and no payment wording at all.
    const card = (/<section class="card" id="swpFinance"[\s\S]*?<\/section>/.exec(rt.appHTML()) || [''])[0];
    const pay = (/<div id="swpPayment"[\s\S]*<\/div>(?=<\/section>)/.exec(card) || [''])[0];
    const postingPart = card.replace(pay, '');
    check(card !== '' && pay !== '' && !/<button/.test(postingPart) && !/Execut|Mark paid|payment|Revers|Correct|account|categor|ledger|journal|actual/i.test(postingPart) && !/\bPaid\b/.test(card),
      'F9. a posted card\'s posting part holds no control and no execution, payment, reversal, correction, account, category or actual vocabulary');
    check((pay.match(/<button/g) || []).length === 1 && /id="swpPayRecordBtn"[^>]*>Record payment</.test(pay) && !/Execut|Mark paid|Revers|Correct|account|categor|ledger|journal|actual|transfer|settle|reconcil/i.test(pay),
      'F9. its payment part (AFI-4f) holds exactly one control, Record payment, and no execution, reversal, transfer, settlement or account vocabulary');
    const un = await openFin();
    const ucard = (/<section class="card" id="swpFinance"[\s\S]*?<\/section>/.exec(un.appHTML()) || [''])[0];
    check((ucard.match(/<button/g) || []).length === 1 && /id="swpFinPostBtn"/.test(ucard) && !/Execut|payment|Revers|account|categor/i.test(ucard) && !/\bPaid\b/.test(ucard), 'F9. an unposted card holds exactly one control: Post to Finance');
    // AFI-4f authorized revision: the one execution request here is the BF-4f month read (no
    // command is sent in this test). Was: no execution request at all.
    check(un.net.calls.every((c) => !/execut|payment|\/pay\b|revers|correct|transaction/i.test(c.url) || /^\/api\/finance-executions\?month=2031-04$/.test(c.url)) && exPosts(un).length === 0,
      'F9. no payment, reversal, correction or transaction request exists; the only execution request is the BF-4f month read (nothing recorded here)');
    const s = un.SessionPayrollStore;
    s.setPostIntent({ sourceKind: 'payrollPlan', sourceId: IDPC, employeeId: 'e_c', monthKey: MONTH, amount: '999.00', key: 'a'.repeat(32), extra: 'x' });
    const held = s.snapshot().postIntent;
    check(Object.isFrozen(held) && keys(held) === 'amount,employeeId,key,monthKey,sourceId,sourceKind', 'F9. the store holds a posting intent frozen, with exactly its six fields');
    const token = s.begin('fin', MONTH);
    s.begin('fin', MONTH);
    check(s.applyFin(token, []) === false, 'F9. a superseded Finance read is dropped');
    s.clear();
    check(s.snapshot().postIntent === null && s.snapshot().fin === null && s.snapshot().finStatus === 'idle', 'F9. clear() destroys the postings, the intent and its key');
    const two = await openFin();
    two.app.fire('swpFinPostBtn', 'click'); await flush();
    two.SessionPayrollStore.setPostIntent({ sourceKind: 'supplementalPayroll', sourceId: SID_COM, employeeId: SCOM.employeeId, monthKey: MONTH, amount: '4321.00', key: 'b'.repeat(32) });
    await two.SessionPayroll.confirmPanel(); await flush();
    check(finPosts(two).length === 0 && two.crypto.calls === 0 && two.pr().panel === null && two.pr().postIntent.key === 'b'.repeat(32),
      'F9. a confirmation never makes a second intent while one exists (defence in depth beneath the panel guard): nothing sent, the panel closes');
    const pc = await openFin({ [FW.plan]: [NETFAIL()] });
    pc.app.fire('swpFinPostBtn', 'click'); await flush();
    pc.app.fire('swpPanelConfirm', 'click'); await flush();
    pc.SessionPayrollStore.bindPrincipal(ME_CEO_PRINCIPAL);
    check(pc.pr().postIntent === null && pc.pr().fin === null, 'F9. another principal destroys the postings and the intent');
  }


  /* ---------- X. AFI-4f Record payment: strict decoders, the request mirror, the intent, the date hint ---------- */
  {
    const rt = loadRuntime({});
    const D0 = rt.FinanceExecutionDecoders, R = rt.FinanceExecutionRequests;
    const inPage = (x) => (x === undefined ? x : rt.parse(JSON.stringify(x)));
    const D = { financeExecution: (o) => D0.financeExecution(inPage(o)), monthResponse: (o, m) => D0.monthResponse(inPage(o), m), financeExecutionResponse: (o) => D0.financeExecutionResponse(inPage(o)) };
    const good = execution(XID1, FPCX, '2031-04-10', 'bankTransfer');
    const g2 = execution(XID2, FSCX, '2031-01-31', 'cash');
    const d = D.financeExecution(good);
    check(!!d && Object.isFrozen(d) && keys(d) === 'amount,employeeId,executedOn,financePostingId,id,monthKey,paymentMethod' && d.amount === '999.00' && d.executedOn === '2031-04-10' && d.paymentMethod === 'bankTransfer',
      'X. an execution decodes to exactly its seven keys (FinanceExecutionView::FIELDS), frozen, the amount, date and method verbatim');
    check(rt.FINANCE_EXECUTION_PAYMENT_METHODS.every((m) => D.financeExecution(Object.assign({}, good, { paymentMethod: m })) !== null) && rt.FINANCE_EXECUTION_PAYMENT_METHODS.length === 6,
      'X. each of the six BF-4f payment method codes decodes');
    const missing = Object.assign({}, good); delete missing.executedOn;
    [['an extra key', Object.assign({}, good, { companyId: 'c_1' })], ['the idempotency key', Object.assign({}, good, { idempotencyKey: 'a'.repeat(32) })],
     ['a company account', Object.assign({}, good, { companyAccount: 'x' })], ['a reference', Object.assign({}, good, { reference: 'TRX-1' })], ['a note', Object.assign({}, good, { notes: 'x' })],
     ['a status', Object.assign({}, good, { status: 'Executed' })], ['a missing key', missing], ['a bad id', Object.assign({}, good, { id: '1' })],
     ['a bad posting id', Object.assign({}, good, { financePostingId: 'F'.repeat(32) })], ['a bad employee id', Object.assign({}, good, { employeeId: '<script>' })],
     ['a bad month', Object.assign({}, good, { monthKey: '2031-13' })], ['a zero amount', Object.assign({}, good, { amount: '0.00' })], ['a fractional amount', Object.assign({}, good, { amount: '999.50' })],
     ['a number amount', Object.assign({}, good, { amount: 999 })], ['a negative amount', Object.assign({}, good, { amount: '-999.00' })],
     ['an impossible date', Object.assign({}, good, { executedOn: '2031-02-29' })], ['a short date', Object.assign({}, good, { executedOn: '2031-4-10' })],
     ['a date-time', Object.assign({}, good, { executedOn: '2031-04-10T00:00:00Z' })], ['a number date', Object.assign({}, good, { executedOn: 20310410 })],
     ['an unknown method', Object.assign({}, good, { paymentMethod: 'wire' })], ['a LOCAL method label', Object.assign({}, good, { paymentMethod: 'Bank Transfer' })],
     ['a case-changed method', Object.assign({}, good, { paymentMethod: 'BankTransfer' })], ['a hostile method', Object.assign({}, good, { paymentMethod: '<img src=x onerror=alert(1)>' })],
     ['an empty method', Object.assign({}, good, { paymentMethod: '' })], ['a null', null], ['an array', [good]], ['a string', 'x']]
      .forEach(([label, o]) => check(D.financeExecution(o) === null, 'X. an execution with ' + label + ' is refused'));
    check(D0.financeExecution(rt.parse('{"__proto__":{"x":1},"id":"' + XID1 + '","financePostingId":"' + FID1 + '","employeeId":"e_c","monthKey":"2031-04","amount":"999.00","executedOn":"2031-04-10","paymentMethod":"cash"}')) === null,
      'X. a hostile __proto__ key is an extra key: refused');
    const two = D.monthResponse({ financeExecutions: [good, g2] }, MONTH);
    check(Array.isArray(two) && two.length === 2 && Object.isFrozen(two), 'X. a month answer of two executions of the month decodes, frozen');
    check(Array.isArray(D.monthResponse({ financeExecutions: [Object.assign({}, good, { executedOn: '2031-06-01' })] }, MONTH)), 'X. an execution dated outside its month decodes (BF-4f has no lower or month bound on executedOn)');
    const many = [];
    for(let i = 0; i < 2001; i++){ const h = ('00000000' + i.toString(16)).slice(-8); many.push(execution(h.repeat(4), { id: 'ffffffff' + h.repeat(3), employeeId: 'e_' + i, monthKey: MONTH, amount: '1.00' }, '2031-04-01', 'cash')); }
    [['an execution of another month', { financeExecutions: [Object.assign({}, good, { monthKey: '2031-05' })] }], ['two executions of one posting', { financeExecutions: [good, Object.assign({}, good, { id: XID2 })] }],
     ['two executions with one id', { financeExecutions: [good, Object.assign({}, g2, { id: XID1 })] }], ['one bad item', { financeExecutions: [good, Object.assign({}, g2, { paymentMethod: 'refund' })] }],
     ['an extra wrapper key', { financeExecutions: [], total: '1.00' }], ['the postings wrapper', { financePostings: [] }], ['no array', { financeExecutions: {} }],
     ['more executions than the server cap (2001)', { financeExecutions: many }]]
      .forEach(([label, data]) => check(D.monthResponse(data, MONTH) === null, 'X. a month answer with ' + label + ' is refused whole'));
    check(D.monthResponse({ financeExecutions: many.slice(0, 2000) }, MONTH) !== null, 'X. a month answer of exactly the server cap (2000) decodes');
    check(D.financeExecutionResponse({ financeExecution: good }) !== null && D.financeExecutionResponse({ financeExecution: good, extra: 1 }) === null && D.financeExecutionResponse({ financeExecutions: [good] }) === null
      && D.financeExecutionResponse({ financePosting: good }) === null, 'X. an execution answer is exactly { financeExecution }');
    check(rt.FinancePostingDecoders.posting(rt.parse(JSON.stringify(FPCX))) !== null && rt.FinancePostingDecoders.posting(rt.parse(JSON.stringify(Object.assign({}, FPCX, { executedOn: '2031-04-10' })))) === null,
      'X. the seven-key posting decoder is unchanged: a posting carrying execution data is still refused (D-FEX-6 = A)');
    const intent = { financePostingId: FID1, employeeId: 'e_c', monthKey: MONTH, amount: '999.00', executedOn: '2031-04-10', paymentMethod: 'qris', key: 'a'.repeat(32) };
    const r = R.record(intent);
    check(r.ok && keys(r.body) === EXEC_KEYS && r.body.financePostingId === FID1 && r.body.expectedAmount === '999.00' && r.body.executedOn === '2031-04-10' && r.body.paymentMethod === 'qris' && r.body.idempotencyKey === 'a'.repeat(32),
      'X. the body is exactly { financePostingId, expectedAmount, executedOn, paymentMethod, idempotencyKey } — never an employee, month, account, reference or note');
    [['a bad posting id', { financePostingId: 'x' }, 'financePostingId'], ['a zero amount', { amount: '0.00' }, 'expectedAmount'], ['a number amount', { amount: 999 }, 'expectedAmount'],
     ['an impossible date', { executedOn: '2031-02-30' }, 'executedOn'], ['an empty date', { executedOn: '' }, 'executedOn'], ['an unknown method', { paymentMethod: 'wire' }, 'paymentMethod'],
     ['an empty method', { paymentMethod: '' }, 'paymentMethod'], ['a bad key', { key: 'A'.repeat(32) }, 'idempotencyKey']]
      .forEach(([label, patch, field]) => { const x = R.record(Object.assign({}, intent, patch)); check(!x.ok && x.fields.indexOf(field) !== -1, 'X. a request with ' + label + ' is refused locally (' + field + ')'); });
    const fp = rt.FinancePostingDecoders.posting(rt.parse(JSON.stringify(FPCX)));
    const it = rt.financeExecutionIntent(fp, '2031-04-10', 'creditCard');
    check(!!it && Object.isFrozen(it) && keys(it) === 'amount,employeeId,executedOn,financePostingId,key,monthKey,paymentMethod' && it.amount === '999.00' && it.financePostingId === FID1
      && it.employeeId === 'e_c' && it.monthKey === MONTH && /^[0-9a-f]{32}$/.test(it.key) && rt.crypto.calls === 1,
      'X. an execution intent: the posting\'s own amount string (999.00), the date and method chosen and one Web Crypto key, frozen');
    const calls = rt.crypto.calls;
    check(rt.financeExecutionIntent(Object.assign({}, fp, { status: 'Executed' }), '2031-04-10', 'cash') === null && rt.financeExecutionIntent(fp, '2031-02-29', 'cash') === null
      && rt.financeExecutionIntent(fp, '2031-04-10', 'wire') === null && rt.financeExecutionIntent(null, '2031-04-10', 'cash') === null && rt.crypto.calls === calls,
      'X. no intent (and no key) for a non-Planned posting, an invalid date or an unknown method');
    check(loadRuntime({}, { noCrypto: true }).financeExecutionIntent(fp, '2031-04-10', 'cash') === null, 'X. without Web Crypto there is no intent');
    check(rt.financeExecutionToday(new Date(Date.UTC(2031, 3, 15, 16, 59, 59))) === '2031-04-15' && rt.financeExecutionToday(new Date(Date.UTC(2031, 3, 15, 17, 0, 0))) === '2031-04-16'
      && rt.financeExecutionToday(new Date(Date.UTC(2031, 11, 31, 18, 0, 0))) === '2032-01-01' && rt.financeExecutionToday() === '2031-04-15',
      'X. the Jakarta today (the date field\'s max hint) is UTC+7, whatever the browser\'s timezone: midnight at 17:00 UTC');
    check(Object.keys(rt.FinanceExecutionApi).sort().join() === 'month,record' && Object.keys(rt.FinancePostingApi).sort().join() === 'month,post',
      'X. the execution client has exactly the month read and record — no execute, pay, transfer, reverse or correct; the posting client is unchanged');
  }

  /* ---------- X1. AFI-4f CEO: record the payment of a base payroll — the card, the form, the exact body ---------- */
  {
    const rt = await openPay();
    let html = rt.appHTML();
    check(countOf(rt, EXE(MONTH)) === 2 && /id="swpPayment"/.test(html) && /<p class="auth-lead">Payment not recorded in TAM OS\.<\/p>/.test(html) && /id="swpPayRecordBtn"[^>]*>Record payment</.test(html)
      && /Record a payment that was already made outside TAM OS\. TAM OS does not send or move money\./.test(html),
      'X1. a posted Committed plan with no execution: "Payment not recorded in TAM OS." and Record payment; the executions are read with the month and again on opening the plan');
    check(html.indexOf('id="swpPayment"') > html.indexOf('Posted to Finance — Planned, not paid') && html.indexOf('id="swpPayment"') < html.indexOf('</section>', html.indexOf('id="swpFinance"')),
      'X1. the payment status sits inside the Finance card, after the posting (D-AFI4f-1 = A)');
    rt.app.fire('swpPayRecordBtn', 'click'); await flush();
    html = rt.appHTML();
    check(!!rt.pr().panel && rt.pr().panel.kind === 'finRecordPlan' && exPosts(rt).length === 0 && rt.crypto.calls === 0 && rt.pr().execIntent === null && rt.dom.focused.slice(-1)[0] === 'swpPanelTitle',
      'X1. Record payment opens an inline form: nothing sent, no key, no intent yet; the focus moves to it');
    check(/Record the payment of this payroll\?/.test(html) && html.indexOf('Fabricated EMP-0C (EMP-0C) — April 2031. Records that Rp 999.00 was paid in full outside TAM OS. TAM OS does not send or move money. A recorded payment cannot be changed or reversed.') !== -1,
      'X1. the form names the plan and says the approved words with the posting\'s own amount 999.00');
    const panel = (/<section class="card" aria-labelledby="swpPanelTitle"[\s\S]*?<\/section>/.exec(html) || [''])[0];
    check((panel.match(/<input/g) || []).length === 1 && /<input class="input" type="date" id="swpPayDate" name="executedOn" required aria-required="true" autocomplete="off" max="2031-04-15"[^>]* value="">/.test(panel)
      && (panel.match(/<select/g) || []).length === 1 && !/<textarea|contenteditable/.test(panel) && !/<input[^>]*(amount|Amount|account|reference|note)/i.test(panel),
      'X1. exactly two fields: Date paid (a required, empty date input whose max is the Jakarta today 2031-04-15) and one select; no amount, account, reference or note input');
    const opts = (panel.match(/<option value="[^"]*"[^>]*>[^<]*<\/option>/g) || []);
    check(opts.join('') === '<option value="" selected>Choose a payment method</option><option value="cash">Cash</option><option value="bankTransfer">Bank transfer</option><option value="qris">QRIS</option>'
      + '<option value="virtualAccount">Virtual account</option><option value="creditCard">Credit card</option><option value="other">Other</option>',
      'X1. Payment method: no default, then exactly the six BF-4f codes as labels, in the server order');
    check(/Amount paid \(Rp\)<\/th><td>999\.00</.test(panel) && /Date paid <span aria-hidden="true">\*<\/span>/.test(panel) && /btn btn-danger" type="button" id="swpPanelConfirm"[^>]*>Record payment</.test(panel),
      'X1. the amount is display only (the posting\'s 999.00); a deliberate, danger-styled "Record payment"');
    rt.app.fire('swpPanelConfirm', 'click'); await flush();
    html = rt.appHTML();
    check(exPosts(rt).length === 0 && rt.crypto.calls === 0 && !!rt.pr().panel && rt.pr().payDraft.missing.join() === 'executedOn,paymentMethod'
      && /Enter Date paid: a real date, no later than today \(Jakarta calendar\)\./.test(html) && /Choose a payment method\.<\/p>/.test(html) && rt.dom.focused.slice(-1)[0] === 'swpPayDate',
      'X1. Record payment with nothing entered sends nothing and makes no key: the form stays, both fields are marked, the focus goes to Date paid');
    fill(rt, '2031-04-10', null);
    rt.app.fire('swpPanelConfirm', 'click'); await flush();
    check(exPosts(rt).length === 0 && rt.pr().payDraft.missing.join() === 'paymentMethod' && rt.dom.focused.slice(-1)[0] === 'swpPayMethod' && /value="2031-04-10"/.test(rt.appHTML()),
      'X1. a date but no method: still nothing sent; only Payment method is marked; the date entered is kept');
    fill(rt, '2031-02-30', 'bankTransfer');
    rt.app.fire('swpPanelConfirm', 'click'); await flush();
    check(exPosts(rt).length === 0 && rt.pr().payDraft.missing.join() === 'executedOn' && rt.crypto.calls === 0, 'X1. an impossible date is refused locally: nothing sent, no key');
    const X = execution(XID1, FPCX, '2031-04-10', 'bankTransfer');
    rt.net.routes[EXW] = [xone(X)];
    rt.net.routes[EXE(MONTH)] = [exeOk([X])];
    fill(rt, '2031-04-10', 'bankTransfer');
    rt.app.fire('swpPanelConfirm', 'click');
    const second = rt.app.fire('swpPanelConfirm', 'click');
    await rt.SessionPayroll.confirmPanel(); await flush();
    const sent = exPosts(rt);
    check(sent.length === 1 && rt.crypto.calls === 1 && second !== 'fired', 'X1. one confirmation, double-clicked and invoked again: exactly one key and one POST (one logical command)');
    const b = sent.length ? bodyOf(sent[0]) : {};
    check(keys(b) === EXEC_KEYS && b.financePostingId === FID1 && b.executedOn === '2031-04-10' && b.paymentMethod === 'bankTransfer' && sent[0].init.headers['X-CSRF-Token'] === CSRF,
      'X1. the body is exactly { financePostingId, expectedAmount, executedOn, paymentMethod, idempotencyKey }, a CSRF POST to /api/finance-executions/execute');
    check(b.expectedAmount === '999.00' && typeof b.expectedAmount === 'string' && b.expectedAmount === FPCX.amount && b.expectedAmount === PCX.totalAmount,
      'X1. expectedAmount is the posting\'s exact amount string 999.00 (byte for byte) — never computed, never a number, never entered');
    check(/^[0-9a-f]{32}$/.test(b.idempotencyKey) && b.idempotencyKey === rt.crypto.last, 'X1. the key is the 16 Web Crypto bytes as 32 lowercase hex characters');
    html = rt.appHTML();
    check(rt.pr().execIntent === null && rt.pr().panel === null && /<p class="auth-lead">Payment recorded — paid outside TAM OS\. TAM OS did not send this money\.<\/p>/.test(html)
      && /Amount paid \(Rp\)<\/th><td>999\.00<\/td><\/tr><tr><th scope="row">Date paid<\/th><td>2031-04-10<\/td><\/tr><tr><th scope="row">Payment method<\/th><td>Bank transfer</.test(html)
      && !/id="swpPayRecordBtn"/.test(html) && countOf(rt, EXE(MONTH)) === 3,
      'X1. confirmed: the intent ends, the executions are read again — "Payment recorded — paid outside TAM OS." with the amount, date and method the server holds; no Record payment');
    check(/id="swpMutationMessage"[^>]*>Payment recorded — paid outside TAM OS\. TAM OS did not send this money\.</.test(html), 'X1. the notice says the payment was recorded, paid outside TAM OS');
    check(rt.pr().detail.plan.status === 'Committed' && posts(rt).length === 0 && finPosts(rt).length === 0 && /Posted to Finance — Planned, not paid<\/p>/.test(html),
      'X1. recording changes nothing in Payroll or the posting (no Payroll or posting write; still Planned)');
    firewall(rt, 'X1. recorded');
    for(const [label, e] of [['another posting', Object.assign({}, X, { financePostingId: FID3 })], ['another amount', Object.assign({}, X, { amount: '1000.00' })],
      ['another date', Object.assign({}, X, { executedOn: '2031-04-11' })], ['another method', Object.assign({}, X, { paymentMethod: 'cash' })],
      ['another employee', Object.assign({}, X, { employeeId: 'e_x' })], ['another month', Object.assign({}, X, { monthKey: '2031-05' })]]){
      const r = await openPay({ [EXW]: [xone(e)] });
      await recordOnce(r);
      check(r.pr().mutation.status === 'ambiguous' && exPosts(r).length === 1 && r.pr().execIntent !== null && /id="swpPayRetryBtn"/.test(r.appHTML()),
        'X1. a success answer with ' + label + ' is not a success: unknown outcome, re-read (still unrecorded), the intent kept, Retry recording offered, nothing resent');
    }
  }
  {
    // The intent ends with the confirming answer itself — not only once the executions are read again.
    const r = await openPay({ [EXW]: [xone(execution(XID1, FPCX, '2031-04-10', 'bankTransfer'))] });
    r.app.fire('swpPayRecordBtn', 'click'); await flush();
    fill(r, '2031-04-10', 'bankTransfer');
    r.net.routes[EXE(MONTH)] = ['HANG'];
    r.app.fire('swpPanelConfirm', 'click'); await flush();
    check(r.pr().execIntent === null && r.pr().mutation.status === 'idle' && r.pr().notice === 'payRecorded' && /Checking the payment status…/.test(r.appHTML()) && !/id="swpPayRecordBtn"/.test(r.appHTML()),
      'X1. a confirming answer ends the intent at once; while the executions are read again, Record payment is not offered');
    const back = await openPay();
    back.app.fire('swpPayRecordBtn', 'click'); await flush();
    fill(back, '2031-04-10', 'cash');
    back.app.fire('swpPanelCancel', 'click'); await flush();
    check(back.pr().panel === null && exPosts(back).length === 0 && back.crypto.calls === 0 && /id="swpPayRecordBtn"/.test(back.appHTML()), 'X1. Back closes the form: nothing sent, no key');
    back.app.fire('swpPayRecordBtn', 'click'); await flush();
    check(back.pr().payDraft.executedOn === '' && back.pr().payDraft.paymentMethod === '' && /id="swpPayDate"[^>]* value=""/.test(back.appHTML()) && /<option value="" selected>/.test(back.appHTML()),
      'X1. a reopened form starts empty again (no remembered date or method)');
  }

  /* ---------- X2. AFI-4f CEO: record the payment of a Supplemental payroll ---------- */
  {
    const rt = await suppDetail(SCOM, [SLINE], { [FIN(MONTH)]: [finOk([FSCX])] });
    let html = rt.appHTML();
    check(/id="swpPayment"/.test(html) && /id="swpSuppPayRecordBtn"[^>]*>Record payment</.test(html) && !/id="swpPayRecordBtn"/.test(html), 'X2. a posted Committed Supplemental document with no execution: Record payment');
    rt.app.fire('swpSuppPayRecordBtn', 'click'); await flush();
    html = rt.appHTML();
    check(rt.pr().panel.kind === 'finRecordSupp' && /Record the payment of this supplemental payroll\?/.test(html) && html.indexOf('Records that Rp 4321.00 was paid in full outside TAM OS.') !== -1 && exPosts(rt).length === 0,
      'X2. the form: the approved words with the posting\'s own amount 4321.00 (never the lines\' 1234.00); nothing sent yet');
    const X = execution(XID2, FSCX, '2031-04-01', 'other');
    rt.net.routes[EXW] = [xone(X)]; rt.net.routes[EXE(MONTH)] = [exeOk([X])];
    fill(rt, '2031-04-01', 'other');
    rt.app.fire('swpPanelConfirm', 'click'); await flush();
    const sent = exPosts(rt);
    const b = sent.length ? bodyOf(sent[0]) : {};
    check(sent.length === 1 && keys(b) === EXEC_KEYS && b.financePostingId === FID2 && b.expectedAmount === '4321.00' && b.executedOn === '2031-04-01' && b.paymentMethod === 'other',
      'X2. exactly one POST of the five keys — the Supplemental posting\'s id and its amount 4321.00');
    html = rt.appHTML();
    check(rt.pr().execIntent === null && /Payment recorded — paid outside TAM OS\./.test(html) && /<td>4321\.00<\/td>/.test(html) && /Payment method<\/th><td>Other</.test(html) && suppPosts(rt).length === 0,
      'X2. confirmed: recorded, with the server\'s amount and method; no Supplemental write');
    firewall(rt, 'X2. supplemental recorded');
  }

  /* ---------- X3. AFI-4f eligibility fails closed: no Record payment unless every read is known ---------- */
  {
    const noRecord = (r) => !/id="swp(Pay|SuppPay)RecordBtn"|id="swpPayRetryBtn"/.test(r.appHTML());
    const tryOpen = async (r, kind) => { r.SessionPayroll.openPanel(kind || 'finRecordPlan'); await flush(); await r.SessionPayroll.confirmPanel(); await r.SessionPayroll.retryRecording(); await flush(); return r.pr().panel === null && exPosts(r).length === 0 && r.crypto.calls === 0; };
    const ld = await openPay({ [EXE(MONTH)]: ['HANG'] });
    check(/Checking the payment status…/.test(ld.appHTML()) && noRecord(ld) && await tryOpen(ld), 'X3. while the executions load: "Checking the payment status…", no Record payment, and none can be opened');
    const er = await openPay({ [EXE(MONTH)]: [err(503, 'service_unavailable')] });
    check(/could not read the payment status of this month, so recording a payment is not offered\./.test(er.appHTML()) && /id="swpPayStatusRetryBtn"[^>]*>Retry payment status</.test(er.appHTML()) && noRecord(er) && await tryOpen(er),
      'X3. the execution read failed: its status is unknown, Retry payment status is offered, Record payment is not and cannot be opened');
    er.net.routes[EXE(MONTH)] = [exeOk([])];
    er.app.fire('swpPayStatusRetryBtn', 'click'); await flush();
    check(/id="swpPayRecordBtn"/.test(er.appHTML()) && countOf(er, EXE(MONTH)) === 3 && countOf(er, FIN(MONTH)) === 2, 'X3. Retry payment status reads the executions only, again; with none, Record payment is offered');
    firewall(er, 'X3. retried');
    const dn = await openPay({ [EXE(MONTH)]: [err(403, 'forbidden')] });
    check(/could not read the payment status/.test(dn.appHTML()) && !/id="swpPayStatusRetryBtn"/.test(dn.appHTML()) && noRecord(dn), 'X3. a denied execution read: no Record payment and no retry');
    const rl = await openPay({ [EXE(MONTH)]: [err(429, 'rate_limited')] });
    check(/could not read the payment status/.test(rl.appHTML()) && noRecord(rl), 'X3. a rate-limited execution read: no Record payment');
    for(const [label, list] of [['two executions of one posting', [execution(XID1, FPCX, '2031-04-10', 'cash'), execution(XID2, FPCX, '2031-04-11', 'cash')]],
      ['an unknown method', [Object.assign(execution(XID1, FPCX, '2031-04-10', 'cash'), { paymentMethod: 'refund' })]], ['an extra key', [Object.assign(execution(XID1, FPCX, '2031-04-10', 'cash'), { reference: 'x' })]]]){
      const m = await openPay({ [EXE(MONTH)]: [exeOk(list)] });
      check(/could not read the payment status/.test(m.appHTML()) && noRecord(m) && !/Payment recorded/.test(m.appHTML()), 'X3. a malformed execution answer (' + label + ') is refused whole: no Record payment, no Recorded');
    }
    const fe = await openPay({ [FIN(MONTH)]: [err(503, 'service_unavailable')] });
    check(!/id="swpPayment"/.test(fe.appHTML()) && noRecord(fe) && await tryOpen(fe), 'X3. the posting read failed: no payment status at all and no Record payment');
    const fl = await openPay({ [FIN(MONTH)]: ['HANG'] });
    check(!/id="swpPayment"/.test(fl.appHTML()) && noRecord(fl) && await tryOpen(fl), 'X3. while the postings load: no payment status and no Record payment');
    const un = await openFin();
    check(/Not posted to Finance/.test(un.appHTML()) && !/id="swpPayment"/.test(un.appHTML()) && await tryOpen(un), 'X3. an unposted source: no payment status and no Record payment (only Post to Finance)');
    const ic = await openPay({ [FIN(MONTH)]: [finOk([posting(FID1, 'payrollPlan', PCX, '1000.00')])] });
    check(/does not match this posting, so recording a payment is not offered\./.test(ic.appHTML()) && noRecord(ic) && await tryOpen(ic),
      'X3. a posting whose amount does not match its source (inconsistent): no Record payment');
    const ie = await openPay({ [EXE(MONTH)]: [exeOk([execution(XID1, FPCX, '2031-04-10', 'cash', '1000.00')])] });
    check(/does not match this posting/.test(ie.appHTML()) && !/Payment recorded/.test(ie.appHTML()) && noRecord(ie) && await tryOpen(ie), 'X3. an execution whose amount does not match its posting (inconsistent): neither Recorded nor Record payment');
    const iw = await openPay({ [EXE(MONTH)]: [exeOk([Object.assign(execution(XID1, FPCX, '2031-04-10', 'cash'), { employeeId: 'e_x' })])] });
    check(/does not match this posting/.test(iw.appHTML()) && noRecord(iw), 'X3. an execution of another employee for this posting (inconsistent): no Record payment');
    const rec = await openPay({ [EXE(MONTH)]: [exeOk([execution(XID1, FPCX, '2031-03-31', 'virtualAccount')])] });
    check(/Payment recorded — paid outside TAM OS/.test(rec.appHTML()) && /Date paid<\/th><td>2031-03-31</.test(rec.appHTML()) && /Virtual account/.test(rec.appHTML()) && noRecord(rec) && await tryOpen(rec),
      'X3. an execution already exists: Recorded with its date and method; no Record payment; called directly nothing opens or is sent');
    firewall(rec, 'X3. already recorded');
    const other = await openPay({ [EXE(MONTH)]: [exeOk([execution(XID1, FSCX, '2031-04-10', 'cash')])] });
    check(/Payment not recorded in TAM OS/.test(other.appHTML()) && /id="swpPayRecordBtn"/.test(other.appHTML()), 'X3. another posting\'s execution does not record this one (financePostingId)');
    const pi = await openPay();
    pi.SessionPayrollStore.setPostIntent({ sourceKind: 'supplementalPayroll', sourceId: SID_COM, employeeId: SCOM.employeeId, monthKey: MONTH, amount: '4321.00', key: 'b'.repeat(32) });
    pi.render(); await flush();
    check(/Another Finance record is not confirmed yet\./.test(pi.appHTML()) && noRecord(pi) && await tryOpen(pi), 'X3. while a posting intent is unresolved, no payment can be recorded (one Finance command at a time)');
    for(const p of [P1, P2, P3, P5]){
      const r = await detail(p.id, det(p), { [DRIFT(p.id)]: [driftOk(p.id, [])], [FIN(MONTH)]: [finOk([posting(FID1, 'payrollPlan', p, '5000000.00')])] });
      check(!/id="swpPayment"/.test(r.appHTML()) && await tryOpen(r), 'X3. a ' + p.status + ' plan shows no payment status and cannot record one (even with a hypothetical posting of it)');
    }
    const l = await open({ [FIN(MONTH)]: [finOk([posting(FID1, 'payrollPlan', P4, '5000000.00')])] });
    check(!/swpPayment|Payment|Record payment/.test(l.appHTML()) && countOf(l, EXE(MONTH)) === 1, 'X3. the month list shows no payment column or status (D-AFI4f-6 = A: details only), though the executions are read');
  }

  /* ---------- X4. AFI-4f the unknown outcome and Retry recording (D-AFI4f-5 = A) ---------- */
  {
    const X = execution(XID1, FPCX, '2031-04-10', 'bankTransfer');
    // A: the execution was recorded — the re-read resolves it.
    const a = await openPay({ [EXW]: [NETFAIL()] });
    a.app.fire('swpPayRecordBtn', 'click'); await flush();
    fill(a, '2031-04-10', 'bankTransfer');
    a.net.routes[EXE(MONTH)] = [exeOk([X])];
    a.app.fire('swpPanelConfirm', 'click'); await flush();
    check(exPosts(a).length === 1 && a.pr().execIntent === null && /could not confirm the payment record at first, but the payment status read again shows it: Payment recorded — paid outside TAM OS\./.test(a.appHTML())
      && /Payment recorded — paid outside TAM OS\. TAM OS did not send this money\.<\/p>/.test(a.appHTML()) && countOf(a, FIN(MONTH)) === 3 && countOf(a, EXE(MONTH)) === 3,
      'X4. A: a network failure, then the re-read (postings and executions) shows the execution at the same amount, date and method — resolved as the success, nothing resent');
    firewall(a, 'X4. A');
    // B: still unrecorded at the same amount — Retry recording, the same body and key, only on a click.
    const b = await openPay({ [EXW]: [NETFAIL(), xone(X)] });
    b.app.fire('swpPayRecordBtn', 'click'); await flush();
    fill(b, '2031-04-10', 'bankTransfer');
    b.app.fire('swpPanelConfirm', 'click'); await flush();
    const first = bodyOf(exPosts(b)[0]);
    let html = b.appHTML();
    check(exPosts(b).length === 1 && !!b.pr().execIntent && b.pr().execIntent.key === first.idempotencyKey && /id="swpPayRetryBtn"[^>]*>Retry recording</.test(html) && !/id="swpPayRecordBtn"/.test(html)
      && /still shows no payment recorded for this posting, at the same amount\. Retry recording sends the same record again — it can never record the payment twice\./.test(html) && b.pr().panel === null,
      'X4. B: the posting at the same amount with no execution — the intent is kept, the form closed, Retry recording offered; nothing was resent');
    b.render(); await flush(); b.SessionPayroll.ensureLoaded(b.AuthBoot.snapshot().principal); await flush();
    b.SessionPayroll.openPanel('finRecordPlan'); await flush();
    check(exPosts(b).length === 1 && b.pr().panel === null && b.crypto.calls === 1, 'X4. B: a re-render, a reload of state or another Record payment never sends or makes a new key');
    b.app.fire('swpBackBtn', 'click'); await flush();
    b.app.fire('swpOpen5', 'click'); await flush();
    check(!!b.pr().execIntent && /id="swpPayRetryBtn"/.test(b.appHTML()) && exPosts(b).length === 1, 'X4. B: leaving and reopening the plan keeps the unresolved intent (Retry recording, never a new key)');
    b.SessionPayrollStore.setPayDraft('executedOn', '2031-04-01'); b.SessionPayrollStore.setPayDraft('paymentMethod', 'cash');
    b.net.routes[EXE(MONTH)] = [exeOk([X])];
    b.app.fire('swpPayRetryBtn', 'click');
    const again = b.app.fire('swpPayRetryBtn', 'click');
    await b.SessionPayroll.retryRecording(); await flush();
    const retried = exPosts(b);
    check(retried.length === 2 && again !== 'fired' && JSON.stringify(bodyOf(retried[1])) === JSON.stringify(first) && b.crypto.calls === 1 && retried[1].init.headers['X-CSRF-Token'] === CSRF,
      'X4. B: Retry recording (double-clicked) sends exactly one POST with the SAME frozen body — posting, amount, date, method and key — even after the draft changed; no new key');
    check(b.pr().execIntent === null && /Payment recorded — paid outside TAM OS\./.test(b.appHTML()) && /Date paid<\/th><td>2031-04-10</.test(b.appHTML()), 'X4. B: the retried record (the server\'s replay) is confirmed');
    firewall(b, 'X4. B');
    // C: the re-read shows an execution of the posting with another method — stale (recorded elsewhere).
    const c2 = await openPay({ [EXW]: [NETFAIL()] });
    c2.app.fire('swpPayRecordBtn', 'click'); await flush();
    fill(c2, '2031-04-10', 'bankTransfer');
    c2.net.routes[EXE(MONTH)] = [exeOk([execution(XID2, FPCX, '2031-04-09', 'cash')])];
    c2.app.fire('swpPanelConfirm', 'click'); await flush();
    check(c2.pr().execIntent === null && !/id="swpPayRetryBtn"|id="swpPayRecordBtn"/.test(c2.appHTML()) && /what was read again has changed/.test(c2.appHTML()) && /Payment method<\/th><td>Cash</.test(c2.appHTML()) && exPosts(c2).length === 1,
      'X4. C: the re-read shows the posting recorded with another date and method — the intent is stale: dropped, no Retry; the server\'s record is shown');
    // C4: the re-read shows an execution of the posting at the same date but another method — stale too.
    const c4 = await openPay({ [EXW]: [NETFAIL()] });
    c4.app.fire('swpPayRecordBtn', 'click'); await flush();
    fill(c4, '2031-04-10', 'bankTransfer');
    c4.net.routes[EXE(MONTH)] = [exeOk([execution(XID2, FPCX, '2031-04-10', 'qris')])];
    c4.app.fire('swpPanelConfirm', 'click'); await flush();
    check(c4.pr().execIntent === null && c4.pr().notice === 'payRecordStale' && /what was read again has changed/.test(c4.appHTML()) && /Payment method<\/th><td>QRIS</.test(c4.appHTML()),
      'X4. C4: the re-read shows the posting recorded on the same date by another method — not this record: stale, never claimed as the success');
    const c5 = await openPay({ [EXW]: [NETFAIL()] });
    c5.app.fire('swpPayRecordBtn', 'click'); await flush();
    fill(c5, '2031-04-10', 'bankTransfer');
    c5.net.routes[EXE(MONTH)] = [exeOk([execution(XID2, FPCX, '2031-04-09', 'bankTransfer')])];
    c5.app.fire('swpPanelConfirm', 'click'); await flush();
    check(c5.pr().execIntent === null && c5.pr().notice === 'payRecordStale', 'X4. C5: the same method on another date is stale too');
    // C3: the re-read no longer shows the posting at the same amount — stale.
    const c3 = await openPay({ [EXW]: [NETFAIL()] });
    c3.app.fire('swpPayRecordBtn', 'click'); await flush();
    fill(c3, '2031-04-10', 'bankTransfer');
    c3.net.routes[FIN(MONTH)] = [finOk([posting(FID1, 'payrollPlan', PCX, '1000.00')])];
    c3.app.fire('swpPanelConfirm', 'click'); await flush();
    check(c3.pr().execIntent === null && !/id="swpPayRetryBtn"/.test(c3.appHTML()) && exPosts(c3).length === 1, 'X4. C3: the posting read again carries another amount — the intent is stale: dropped, no Retry, nothing resent');
    // P: while the re-read is pending, Retry recording (called directly) sends nothing.
    const pend = await openPay({ [EXW]: [NETFAIL()] });
    pend.app.fire('swpPayRecordBtn', 'click'); await flush();
    fill(pend, '2031-04-10', 'bankTransfer');
    pend.net.routes[EXE(MONTH)] = ['HANG'];
    pend.app.fire('swpPanelConfirm', 'click'); await flush();
    await pend.SessionPayroll.retryRecording(); await flush();
    check(!!pend.pr().execIntent && exPosts(pend).length === 1 && !/id="swpPayRetryBtn"/.test(pend.appHTML()) && /It is being read again…/.test(pend.appHTML()),
      'X4. P: while the payment status is read again, the outcome is undecided — no Retry recording, and calling it sends nothing');
    // D: the execution re-read fails — the intent is kept, nothing is sent, no Retry until it is read.
    const d = await openPay({ [EXW]: [NETFAIL()] });
    d.app.fire('swpPayRecordBtn', 'click'); await flush();
    fill(d, '2031-04-10', 'bankTransfer');
    d.net.routes[EXE(MONTH)] = [err(500, 'internal_error'), exeOk([])];
    d.app.fire('swpPanelConfirm', 'click'); await flush();
    html = d.appHTML();
    check(!!d.pr().execIntent && /the payment status could not be read again\. Nothing is sent again/.test(html) && !/id="swpPayRetryBtn"|id="swpPayRecordBtn"/.test(html) && /id="swpPayStatusRetryBtn"/.test(html) && exPosts(d).length === 1,
      'X4. D: the execution re-read fails — the intent is kept, nothing sent, neither Record payment nor Retry recording until it is read');
    await d.SessionPayroll.retryRecording(); await flush();
    check(exPosts(d).length === 1, 'X4. D: Retry recording called directly while unread sends nothing');
    d.app.fire('swpPayStatusRetryBtn', 'click'); await flush();
    check(/id="swpPayRetryBtn"/.test(d.appHTML()) && exPosts(d).length === 1, 'X4. D: reading the payment status again (still unrecorded) offers Retry recording — still nothing sent');
    // D2: the posting re-read fails — undecided too.
    const d2 = await openPay({ [EXW]: [NETFAIL()] });
    d2.app.fire('swpPayRecordBtn', 'click'); await flush();
    fill(d2, '2031-04-10', 'bankTransfer');
    d2.net.routes[FIN(MONTH)] = [err(503, 'service_unavailable')];
    d2.app.fire('swpPanelConfirm', 'click'); await flush();
    await d2.SessionPayroll.retryRecording(); await flush();
    check(!!d2.pr().execIntent && exPosts(d2).length === 1 && !/id="swpPayRetryBtn"/.test(d2.appHTML()), 'X4. D2: the posting re-read fails — the intent is kept, no Retry recording, nothing sent');
    // E: 500, 503, a malformed answer and a timeout are unknown outcomes too.
    for(const [label, answer] of [['a 500', err(500, 'internal_error')], ['a 503', err(503, 'service_unavailable')], ['a malformed answer', xone(Object.assign({}, X, { idempotencyKey: 'a'.repeat(32) }))],
      ['the postings wrapper', ok({ financePosting: FPCX })], ['a non-JSON body', resp(200, 'not json')], ['a timeout', 'HANG']]){
      const e = await openPay({ [EXW]: [answer] });
      e.app.fire('swpPayRecordBtn', 'click'); await flush();
      fill(e, '2031-04-10', 'bankTransfer');
      e.app.fire('swpPanelConfirm', 'click'); await flush();
      if(answer === 'HANG'){ e.net.timers.splice(0).forEach((fn) => fn()); await flush(); }
      check(e.pr().mutation.status === 'ambiguous' && !!e.pr().execIntent && exPosts(e).length === 1 && /id="swpPayRetryBtn"/.test(e.appHTML()),
        'X4. ' + label + ' to an execution is an unknown outcome: the intent is kept, re-read, never resent automatically');
    }
    // G: no Web Crypto — nothing is sent.
    const g = await openPay({}, { noCrypto: true });
    await recordOnce(g);
    check(exPosts(g).length === 0 && g.pr().execIntent === null && /cannot create a secure record key\. Nothing was sent\./.test(g.appHTML()), 'X4. G: without Web Crypto the record fails closed: nothing sent');
    // H: while one execution intent is unresolved, no other source can record a payment.
    const h = await openPay({ [EXW]: [NETFAIL()], [FIN(MONTH)]: [finOk([FPCX, FSCX])], [SDET(SID_COM)]: [ok(sdet(SCOM, [SLINE]))] });
    await recordOnce(h);
    h.app.fire('swpBackBtn', 'click'); await flush();
    await h.SessionPayroll.openSupplemental(SID_COM); await flush();
    h.SessionPayroll.openPanel('finRecordSupp'); await flush();
    check(/Another Finance record is not confirmed yet\./.test(h.appHTML()) && !/id="swpSuppPayRecordBtn"|id="swpPayRetryBtn"/.test(h.appHTML()) && h.pr().panel === null && exPosts(h).length === 1 && h.crypto.calls === 1,
      'X4. H: while a payment record is unresolved another source offers no Record payment and no Retry (one command at a time)');
    await h.SessionPayroll.retryRecording(); await flush();
    check(exPosts(h).length === 1, 'X4. H: Retry recording is never sent from another source\'s detail');
    h.SessionPayroll.openPanel('finPostSupp'); await flush();
    check(h.pr().panel === null || h.pr().panel.kind !== 'finRecordSupp', 'X4. H: (the posting of another source stays AFI-4e\'s own decision)');
  }

  /* ---------- X5. AFI-4f definite refusals: a generic 409, 400 / 401 / 403 / 404 / 429 ---------- */
  {
    const X = execution(XID1, FPCX, '2031-04-10', 'bankTransfer');
    const rt = await openPay({ [EXW]: [err(409, 'conflict')] });
    await recordOnce(rt);
    let html = rt.appHTML();
    check(rt.pr().panel === null && rt.pr().execIntent === null && exPosts(rt).length === 1 && countOf(rt, FIN(MONTH)) === 3 && countOf(rt, EXE(MONTH)) === 3,
      'X5. a 409: definitely refused — the form closes, the intent is dropped, the postings and executions are read again, nothing resent');
    check(html.indexOf('TAM OS did not record this payment (a conflict was reported). The posting and its payment status were read again from TAM OS — check them before choosing again.') !== -1
      && !/finance_(executed|amount|duplicate)|idempotency_mismatch|already (recorded|executed|paid)|amount (changed|no longer)|key/i.test(html.replace(/aria-[a-z]+="[^"]*"/g, '')), 'X5. the conflict message never claims which cause it was');
    check(/id="swpPayRecordBtn"/.test(html) && /id="swpReloadBtn"/.test(html), 'X5. the re-read still shows it unrecorded: a new deliberate Record payment may follow (and Reload plan)');
    rt.app.fire('swpPayRecordBtn', 'click'); await flush();
    fill(rt, '2031-04-10', 'bankTransfer');
    rt.net.routes[EXW] = [xone(X)]; rt.net.routes[EXE(MONTH)] = [exeOk([X])];
    rt.app.fire('swpPanelConfirm', 'click'); await flush();
    const both = exPosts(rt);
    check(both.length === 2 && bodyOf(both[1]).idempotencyKey !== bodyOf(both[0]).idempotencyKey && rt.crypto.calls === 2 && /Payment recorded — paid outside TAM OS\. TAM OS did not send this money\.<\/p>/.test(rt.appHTML()),
      'X5. that new deliberate record is a new command with a fresh key, and it is confirmed');
    firewall(rt, 'X5. 409');
    const p2 = await openPay({ [EXW]: [err(409, 'conflict')] });
    p2.app.fire('swpPayRecordBtn', 'click'); await flush();
    fill(p2, '2031-04-10', 'bankTransfer');
    p2.net.routes[EXE(MONTH)] = [exeOk([X])];
    p2.app.fire('swpPanelConfirm', 'click'); await flush();
    check(/Payment recorded — paid outside TAM OS/.test(p2.appHTML()) && !/id="swpPayRecordBtn"/.test(p2.appHTML()) && /a conflict was reported/.test(p2.appHTML()) && p2.pr().execIntent === null,
      'X5. a 409 whose re-read shows an execution of the posting (recorded elsewhere): shown recorded, no Record payment, the conflict not explained');
    for(const [label, answer, text] of [['a 400', err(400, 'validation_failed'), 'TAM OS could not accept this payment record. Nothing was recorded.'],
      ['a 403', err(403, 'forbidden'), 'You do not have permission to record payments.'], ['a 429', err(429, 'rate_limited'), 'Too many requests.']]){
      const r = await openPay({ [EXW]: [answer] });
      await recordOnce(r);
      check(r.pr().execIntent === null && exPosts(r).length === 1 && r.appHTML().indexOf(text) !== -1 && countOf(r, EXE(MONTH)) === 3 && /id="swpPayRecordBtn"/.test(r.appHTML()),
        'X5. ' + label + ': definitely refused — "' + text + '", the intent dropped, the payment status read again, nothing resent');
    }
    const vf = await openPay({ [EXW]: [resp(400, { ok: false, error: { code: 'validation_failed', message: 'server text', fields: ['executedOn'] }, requestId: RID })] });
    await recordOnce(vf);
    check(/TAM OS did not accept Date paid: it must be a real date no later than today \(Jakarta calendar\)\. Nothing was recorded\./.test(vf.appHTML()) && !/server text/.test(vf.appHTML()) && vf.pr().execIntent === null,
      'X5. a 400 naming executedOn (the server\'s Jakarta bound): the fixed Date paid message — the server decides, never server text');
    const vm2 = await openPay({ [EXW]: [resp(400, { ok: false, error: { code: 'validation_failed', message: 'server text', fields: ['paymentMethod'] }, requestId: RID })] });
    await recordOnce(vm2);
    check(/TAM OS did not accept the payment method\. Nothing was recorded\./.test(vm2.appHTML()), 'X5. a 400 naming paymentMethod: the fixed method message');
    const fut = await openPay({ [EXW]: [resp(400, { ok: false, error: { code: 'validation_failed', message: 'x', fields: ['executedOn'] }, requestId: RID })] });
    await recordOnce(fut, '2031-04-16', 'cash');
    check(exPosts(fut).length === 1 && bodyOf(exPosts(fut)[0]).executedOn === '2031-04-16', 'X5. a date after the Jakarta today is not blocked by the browser (max is a hint): the server decides (and refuses it)');
    const nf = await openPay({ [EXW]: [err(404, 'not_found')] });
    await recordOnce(nf);
    check(nf.pr().execIntent === null && nf.pr().detailId === null && countOf(nf, LIST(MONTH)) === 2 && /This payroll is no longer available\. The month was read again\./.test(nf.appHTML()),
      'X5. a 404: the intent is dropped, the detail closes, the month is read again');
    const ua = await openPay({ [EXW]: [err(401, 'unauthenticated')] });
    await recordOnce(ua);
    check(ua.pr().execIntent === null && ua.pr().exec === null && ua.state() !== ua.AUTH_STATES.AUTHENTICATED, 'X5. a 401 ends the session: the intent, its key and the executions are destroyed');
  }

  /* ---------- X6. AFI-4f stale CSRF: one replay of the same body and key, for the same principal only ---------- */
  {
    const X = execution(XID1, FPCX, '2031-04-10', 'bankTransfer');
    const rt = await openPay({ [EXW]: [err(403, 'forbidden'), xone(X)] });
    rt.net.routes['/api/auth/me'] = [ok(Object.assign({}, ME_CEO, { csrfToken: CSRF2 }))];
    rt.net.routes[EXE(MONTH)] = [exeOk([X])];
    await recordOnce(rt);
    const sent = exPosts(rt);
    check(sent.length === 2 && JSON.stringify(bodyOf(sent[0])) === JSON.stringify(bodyOf(sent[1])) && sent[0].init.headers['X-CSRF-Token'] === CSRF && sent[1].init.headers['X-CSRF-Token'] === CSRF2 && rt.crypto.calls === 1,
      'X6. a stale CSRF token: /me once, then exactly one replay with the new token and the SAME body and key');
    check(rt.pr().execIntent === null && /Payment recorded — paid outside TAM OS/.test(rt.appHTML()), 'X6. the replayed record is confirmed');
    firewall(rt, 'X6. replayed');
    const same = await openPay({ [EXW]: [err(403, 'forbidden')] });
    same.net.routes['/api/auth/me'] = [ok(ME_CEO)];
    await recordOnce(same);
    check(exPosts(same).length === 1 && /You do not have permission to record payments\./.test(same.appHTML()) && same.pr().execIntent === null,
      'X6. a 403 whose /me shows the same token: a genuine denial — no replay, the intent dropped');
    const other = await openPay({ [EXW]: [err(403, 'forbidden')] });
    other.net.routes['/api/auth/me'] = [ok(ME_CEO2)];
    await recordOnce(other);
    check(exPosts(other).length === 1 && other.pr().execIntent === null && other.pr().exec === null, 'X6. a 403 whose /me shows another principal: no replay; the execution data and intent are destroyed');
    const gone = await openPay({ [EXW]: [err(403, 'forbidden')] });
    gone.net.routes['/api/auth/me'] = [err(503, 'service_unavailable')];
    await recordOnce(gone);
    check(exPosts(gone).length === 1 && gone.pr().execIntent === null && gone.state() !== gone.AUTH_STATES.AUTHENTICATED, 'X6. a 403 whose /me fails: fail closed — no replay, the session state cleared');
  }

  /* ---------- X7. AFI-4f principal and session changes; the store's own guards ---------- */
  {
    const f = await openPay({ [EXW]: [NETFAIL()] });
    await recordOnce(f);
    check(!!f.pr().execIntent && Array.isArray(f.pr().exec), 'X7. (an unresolved execution intent and the executions are held in memory)');
    f.AuthBoot.sessionLost(); await flush();
    check(f.pr().execIntent === null && f.pr().exec === null && f.pr().payDraft.executedOn === '' && f.access.local.length === 0 && f.access.session.length === 0,
      'X7. session loss destroys the intent, its key, the draft and the executions; nothing was ever stored');
    const pc = await openPay({ [EXW]: [NETFAIL()] });
    await recordOnce(pc);
    pc.SessionPayrollStore.bindPrincipal(ME_CEO_PRINCIPAL);
    check(pc.pr().execIntent === null && pc.pr().exec === null, 'X7. another principal destroys the executions and the intent');
    const st = loadRuntime({});
    const s = st.SessionPayrollStore;
    s.setExecIntent({ financePostingId: FID1, employeeId: 'e_c', monthKey: MONTH, amount: '999.00', executedOn: '2031-04-10', paymentMethod: 'cash', key: 'a'.repeat(32), extra: 'x', sourceId: IDPC });
    const held = s.snapshot().execIntent;
    check(Object.isFrozen(held) && keys(held) === 'amount,employeeId,executedOn,financePostingId,key,monthKey,paymentMethod', 'X7. the store holds an execution intent frozen, with exactly its seven fields');
    s.setOpen(true, MONTH);
    const token = s.begin('exec', MONTH);
    s.begin('exec', MONTH);
    check(s.applyExec(token, []) === false, 'X7. a superseded execution read is dropped');
    const t2 = s.begin('exec', MONTH);
    s.setMonth('2031-05');
    check(s.applyExec(t2, []) === false && s.snapshot().exec === null, 'X7. an execution read of a month left behind is dropped');
    const t3 = s.begin('exec', '2031-05');
    check(s.applyExec(t3, [Object.freeze(execution(XID1, FPCX, '2031-04-10', 'cash'))]) === true && Array.isArray(s.snapshot().exec), 'X7. (an execution read of the month shown is applied)');
    s.setMonth('2031-06');
    check(s.snapshot().exec === null && s.snapshot().execMonth === null && s.snapshot().execStatus === 'idle', 'X7. a month change forgets the month\'s executions at once (the store, not only the next read)');
    s.setPayDraft('executedOn', 5); s.setPayDraft('amount', '1.00');
    check(s.snapshot().payDraft.executedOn === '' && keys(s.snapshot().payDraft) === 'executedOn,missing,paymentMethod', 'X7. the draft holds only Date paid and Payment method, as strings — never an amount');
    s.clear();
    check(s.snapshot().execIntent === null && s.snapshot().exec === null && s.snapshot().execStatus === 'idle', 'X7. clear() destroys the executions, the intent and its key');
    const two = await openPay();
    two.app.fire('swpPayRecordBtn', 'click'); await flush();
    fill(two, '2031-04-10', 'cash');
    two.SessionPayrollStore.setExecIntent({ financePostingId: FID2, employeeId: SCOM.employeeId, monthKey: MONTH, amount: '4321.00', executedOn: '2031-04-01', paymentMethod: 'other', key: 'b'.repeat(32) });
    await two.SessionPayroll.confirmPanel(); await flush();
    check(exPosts(two).length === 0 && two.crypto.calls === 0 && two.pr().panel === null && two.pr().execIntent.key === 'b'.repeat(32),
      'X7. a confirmation never makes a second intent while one exists (defence in depth beneath the panel guard): nothing sent, the form closes');
    const mo = await openPay();
    mo.app.fire('swpBackBtn', 'click'); await flush();
    mo.app.fire('swpNextMonth', 'click'); await flush();
    check(countOf(mo, EXE('2031-05')) === 1 && mo.pr().execMonth === '2031-05', 'X7. another month reads that month\'s executions (the old ones are forgotten)');
    const dd = await openPay();
    dd.SessionPayroll.setPayDraft('executedOn', '2031-04-10');
    check(dd.pr().payDraft.executedOn === '', 'X7. the draft changes only while the Record payment form is open');
  }

  /* ---------- X8. AFI-4f the Employee never sees, reads or records a payment ---------- */
  {
    const rt = await boot(ME_EMP, { [LIST(MONTH)]: [ok({ payrollPlans: [MINE] })], [DET(ID7)]: [ok(det(MINE, [OT1]))], [SLIST(MONTH)]: [ok({ supplementalPayrolls: [SMINE1] })],
      [SDET(SID_MINE1)]: [ok(sdet(SMINE1, [SLINE]))], [FIN(MONTH)]: [finOk([posting(FID1, 'payrollPlan', MINE, '777.00')])], [EXE(MONTH)]: [exeOk([execution(XID1, posting(FID1, 'payrollPlan', MINE, '777.00'), '2031-04-10', 'cash')])] });
    rt.app.fire('swSectionPayroll', 'click'); await flush();
    rt.app.fire('swpOpen0', 'click'); await flush();
    const planHTML = rt.appHTML();
    rt.app.fire('swpBackBtn', 'click'); await flush();
    rt.app.fire('swpSuppOpen0', 'click'); await flush();
    const suppHTML = rt.appHTML();
    rt.SessionPayroll.openPanel('finRecordPlan'); rt.SessionPayroll.openPanel('finRecordSupp'); await rt.SessionPayroll.confirmPanel();
    await rt.SessionPayroll.retryRecording(); await rt.SessionPayroll.retryFinanceExecutionStatus(); rt.SessionPayroll.setPayDraft('executedOn', '2031-04-10'); await flush();
    check(!/Payment|Record payment|recorded|swpPay(ment|RecordBtn|RetryBtn|StatusRetryBtn|Date|Method)|swpSuppPay|Date paid/.test(planHTML + suppHTML + rt.appHTML()) && rt.net.calls.every((c) => !/^\/api\/finance-executions/.test(c.url))
      && rt.pr().exec === null && rt.pr().execIntent === null && rt.pr().execStatus === 'idle' && rt.crypto.calls === 0,
      'X8. an Employee\'s own Committed payroll and Supplemental cards show no payment status; no execution read or write is ever made, even called directly (D-AFI4f-7 = A)');
    firewall(rt, 'X8. Employee');
  }

  /* ---------- X9. AFI-4f hostile payloads, escaping, and no money-moving semantics ---------- */
  {
    const HX = Object.assign({}, PCX, { employeeName: '<img src=x onerror=alert(1)>', employeeCode: 'EMP-<b>' });
    const rt = await openFin({ [DET(IDPC)]: [ok(det(HX, [OT1]))], [FIN(MONTH)]: [finOk([FPCX])] });
    rt.app.fire('swpPayRecordBtn', 'click'); await flush();
    const html = rt.appHTML();
    check(!/<img|<b>/.test(html) && html.indexOf('&lt;img src=x onerror=alert(1)&gt; (EMP-&lt;b&gt;) — April 2031.') !== -1, 'X9. the source\'s server strings are escaped in the Record payment form');
    fill(rt, '2031-04-10"><script>x</script>', 'cash" onclick="x');
    rt.render(); await flush();
    const h2 = rt.appHTML();
    check(!rawScript(h2) && h2.indexOf('onclick="x') === -1 && h2.indexOf('value="' + escapedForm('2031-04-10"><script>x</script>') + '"') !== -1 && h2.indexOf('<option value="cash" selected') === -1,
      'X9. a hostile typed date is escaped back into the field; a hostile method value selects nothing');
    rt.app.fire('swpPanelConfirm', 'click'); await flush();
    check(exPosts(rt).length === 0 && rt.pr().payDraft.missing.join() === 'executedOn,paymentMethod', 'X9. hostile field values are refused locally: nothing sent');
    const rq = await openPay({ [EXE(MONTH)]: [resp(503, { ok: false, error: { code: 'service_unavailable', message: '<script>alert(1)</script>' }, requestId: RID })] });
    check(!rawScript(rq.appHTML()) && rq.appHTML().indexOf('alert(1)') === -1 && rq.appHTML().indexOf('Reference: ' + RID + '.') !== -1, 'X9. a failed execution read shows fixed words and the reference only — never server text');
    // The check itself cannot be bypassed by case: it sees every raw script-tag variant and none of their escaped forms.
    const VARIANTS = ['<script>x</script>', '<SCRIPT>x</SCRIPT>', '<ScRiPt>x</sCrIpT>', '<script src=x></script>', '<SCRIPT\tsrc=x>', '</script >', '</SCRIPT>', '<sCrIpT/x>'];
    check(VARIANTS.every((v) => rawScript('<p>' + v + '</p>') && !rawScript('<p>' + escapedForm(v) + '</p>')) && !rawScript('<p>Prescription &lt;script&gt;</p>'),
      'X9. the raw-script check detects <script>, <SCRIPT>, mixed case and closing-tag variants, and never their escaped forms');
    for(const v of VARIANTS){
      const fv = await openPay();
      fv.app.fire('swpPayRecordBtn', 'click'); await flush();
      fill(fv, '2031-04-10' + v, 'cash');
      fv.render(); await flush();
      const fh = fv.appHTML();
      check(!rawScript(fh) && fh.indexOf('value="' + escapedForm('2031-04-10' + v) + '"') !== -1, 'X9. a typed Date paid of ' + JSON.stringify(v) + ' is escaped exactly, never rendered as a tag');
      fv.app.fire('swpPanelConfirm', 'click'); await flush();
      check(exPosts(fv).length === 0, 'X9. a typed Date paid of ' + JSON.stringify(v) + ' is refused locally: nothing sent');
      const sv = await openPay({ [EXE(MONTH)]: [resp(503, { ok: false, error: { code: 'service_unavailable', message: v + 'alert(1)' + v }, requestId: RID })] });
      check(!rawScript(sv.appHTML()) && sv.appHTML().indexOf('alert(1)') === -1, 'X9. server text ' + JSON.stringify(v) + ' in a failed execution read never reaches the page');
    }
    const hx = await openPay();
    const ht = hx.SessionPayrollStore.begin('exec', MONTH);
    hx.SessionPayrollStore.applyExec(ht, [Object.freeze(Object.assign(execution(XID1, FPCX, '2031-04-10', 'cash'), { executedOn: '<img src=x onerror=alert(1)>' }))]);
    hx.render(); await flush();
    check(/Date paid<\/th><td>&lt;img src=x onerror=alert\(1\)&gt;</.test(hx.appHTML()) && !/<img/.test(hx.appHTML()),
      'X9. defence in depth: even a value the strict decoder would refuse is escaped in the recorded rows');
    const rec = await openPay({ [EXE(MONTH)]: [exeOk([execution(XID1, FPCX, '2031-04-10', 'qris')])] });
    const card = (/<section class="card" id="swpFinance"[\s\S]*?<\/section>/.exec(rec.appHTML()) || [''])[0];
    check(!/<button/.test(card) && !/\bPay\b|\bPaid\b|Execut|Mark paid|Transfer(red)?\b|transferred|sent money|Settle|settled|Reconcil|Revers|Correct|Refund|account|ledger|journal|balance/.test(card)
      && /TAM OS did not send this money\./.test(card) && !/[0-9a-f]{32}/.test(card), 'X9. a recorded card holds no control, no money-moving, settlement or reversal word, no id — and says TAM OS did not send the money');
    const un = await openPay();
    un.app.fire('swpPayRecordBtn', 'click'); await flush();
    const form = (/<section class="card" aria-labelledby="swpPanelTitle"[\s\S]*?<\/section>/.exec(un.appHTML()) || [''])[0];
    const words = form.replace(/<[^>]*>/g, ' ').replace(/Bank transfer|Virtual account|Credit card|paid in full outside TAM OS|cannot be changed or reversed/g, '');
    check(form !== '' && !/\bPay\b|\bPaid\b|Execute|Executed|Mark paid/.test(words) && !/send money|transfer money|settle|reconcil|refund|partial|installment|schedule|batch|company account|bank account|reference|\bnote/i.test(words),
      'X9. the form offers no pay / execute / transfer / settle / partial / batch / schedule / account / reference / note concept — only the approved words');
    check(!/[0-9a-f]{32}/.test(form.replace(RID, '').replace(new RegExp(IDO, 'g'), '')), 'X9. no posting, execution or key id appears in the page');
  }

  /* ---------- K. sources: no money arithmetic, no LOCAL, Overtime or Finance authority ---------- */
  {
    const code = (f) => fs.readFileSync(path.join(root, 'js', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
    const all = ['core/payroll-api.js', 'core/session-payroll.js', 'ui/session-payroll-view.js'].map(code).join('\n');
    check(!/\b(Number|parseFloat|parseInt)\s*\(|Math\.|fmtIDR|toLocaleString|toFixed|\+\s*[a-z.]*(baseSalary|overtimeAmount|totalAmount)|(baseSalary|overtimeAmount|totalAmount)\s*[-+*\/]/.test(all),
      'K. the Payroll modules contain no number conversion, Math, currency formatter or arithmetic on money');
    check(!/\b(State|PayrollRepository|payrollPlansForMonth|computePayrollPlanned|commitReadyPayroll|generatePayrollForMonth|transitionPayrollLifecycle|persistPayrollPlans|localStorage|sessionStorage|TransportAdapter|ApplicationGateway)\b/.test(all),
      'K. no LOCAL State, repository, payroll engine, storage, Transport or Gateway fallback');
    check(!/\b(OvertimeApi|OvertimeDecoders|SessionOvertime|SessionOvertimeStore|OvertimeValuation|TAM-OT-1|valuation)\b/.test(all) && /OvertimeCalendar\./.test(all),
      'K. no Overtime authority (only the pure calendar helper is reused)');
    // AFI-4c2 authorized revision: Commit, expectedTotal and the idempotency key exist. Was: none.
    // AFI-4e authorized revision: the BF-4e Finance posting client exists (its identifiers, the three
    // Finance routes and the approved confirmation "Nothing is paid or executed."). Was: no Finance code.
    // AFI-4f authorized revision: the BF-4f execution client exists — its FinanceExecution
    // identifiers, the two execution routes, the two field names, the server's payment method list
    // and the approved Record payment words (pinned in X and in the verifier). Was: the posting client only.
    const nonFinance = all.replace(/const SESSION_FINANCE_EXECUTION_(TEXT|METHOD_TEXT|CONFIRM|PANELS|BUTTONS|ERRORS|FIELD_ERRORS|CONFLICT|AMBIGUOUS|NOTICES) = [\s\S]*?;\n/g, '')
      .replace(/\['cash', 'bankTransfer', 'qris', 'virtualAccount', 'creditCard', 'other'\]/g, '[]').replace(/'\/api\/finance-executions(\/execute)?'/g, "''")
      .replace(/\b(paymentMethod|executedOn|swpPayment(Title)?)\b/g, 'X')
      .replace(/posted to Finance|It is not a payment|Nothing is paid or executed\. A posting cannot be reversed\./g, '').replace(/'\/api\/finance-postings(\/payroll-plan|\/supplemental-payroll)?'/g, "''")
      .replace(/[A-Za-z_]*(Finance|FINANCE|finance)[A-Za-z_]*/g, 'X');
    check(!/finance|ledger|journal|payment|execut|\/post|markPaid|\bpay\(|revers|correct|account|categor/i.test(nonFinance), 'K. no payment, execution, ledger, reversal, correction, account or category code (AFI-4e/AFI-4f: only the Finance posting and execution clients and their approved words)');
    check(((all.match(/'\/api\/finance[^']*'/g) || []).sort().join()) === "'/api/finance-executions','/api/finance-executions/execute','/api/finance-postings','/api/finance-postings/payroll-plan','/api/finance-postings/supplemental-payroll'",
      'K. AFI-4e/AFI-4f name exactly the five Finance routes — the two month reads, the two posting commands and the one execution command');
    check(!/Math\.random|crypto\.subtle|randomUUID|localStorage|sessionStorage|indexedDB|document\.cookie/.test(all)
      && (all.match(/getRandomValues\(/g) || []).length === 1 && /c\.getRandomValues\(new Uint8Array\(16\)\)/.test(code('core/payroll-api.js'))
      && !/getRandomValues/.test(code('core/session-payroll.js') + code('ui/session-payroll-view.js')),
      'K. the commit key comes only from Web Crypto getRandomValues (16 bytes, in payroll-api.js) — never Math.random, never stored');
    check(/expectedTotal: i\.total/.test(code('core/payroll-api.js')) && /total: d\.plan\.totalAmount/.test(code('core/session-payroll.js')),
      'K. expectedTotal is the plan\'s own totalAmount string, carried unchanged by the intent');
    // AFI-4d: the Supplemental commit total is the document's own overtimeAmount string; nothing of
    // the LOCAL Supplemental engine or its store is named; no arithmetic on any eligibility amount.
    check(/total: d\.doc\.overtimeAmount/.test(code('core/session-payroll.js')) && !/eligibleAmount\s*[-+*\/]|\+\s*[a-z.]*eligibleAmount/.test(all),
      'K. the Supplemental expectedTotal is the document\'s own overtimeAmount string; no arithmetic on any eligible amount');
    check(!/\b(generateSupplementalForPlan|refreshSupplemental|transitionSupplemental|postSupplemental|persistSupplementalPayments|supplementalById|supplementalsForPlan|SUPPLEMENTAL_STATUSES|SUPPLEMENTAL_TRANSITIONS|supplementalPayments|tam_supplemental_payments_v1)\b/.test(all),
      'K. no LOCAL Supplemental engine, store or status vocabulary in the SESSION Payroll modules');
    // AFI-4f: LOCAL is untouched — no LOCAL module knows the execution client, and the LOCAL payment
    // method labels are not the server's codes (the SESSION map is its own).
    const localSrc = ['finance/execution-center.js', 'finance/transactions.js', 'finance/transaction-modals.js', 'people/payroll-ops-engine.js', 'people/supplemental-engine.js', 'core/constants.js']
      .map((f) => fs.readFileSync(path.join(root, 'js', f), 'utf8')).join('\n');
    const rtl = loadRuntime({});
    check(!/FinanceExecution|financeExecution|finance-executions|FINANCE_EXECUTION/.test(localSrc) && rtl.LOCAL_PAYMENT_METHODS.join() === 'Cash,Bank Transfer,QRIS,Virtual Account,Credit Card,Other'
      && rtl.FINANCE_EXECUTION_PAYMENT_METHODS.join() === 'cash,bankTransfer,qris,virtualAccount,creditCard,other' && /const AUTH_MODE = AUTH_MODES\.LOCAL;/.test(fs.readFileSync(path.join(root, 'js', 'core', 'constants.js'), 'utf8')),
      'K. AFI-4f leaves LOCAL unchanged: no LOCAL module names the execution client, the LOCAL PAYMENT_METHODS keep their labels beside the six server codes, AUTH_MODE stays LOCAL in the source');
    check(!/\b(execute|pay|payNow|transfer|sendMoney|reconcile|reverse|correct)\s*\(/i.test(all) && !/\bPay\b|Execute payment|Mark paid|\bPaid\b|Executed|payment date/.test(code('ui/session-payroll-view.js')),
      'K. AFI-4f adds no execute / pay / transfer / reconcile / reverse / correct function and none of the banned words (Pay, Execute payment, Mark paid, Paid, Executed, payment date)');
  }

  console.log('');
  if(failures.length === 0){ console.log('AFI-4c1 + AFI-4c2 + AFI-4d + AFI-4e + AFI-4f SESSION PAYROLL RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.'); process.exit(0); }
  console.log('AFI-4c1 + AFI-4c2 + AFI-4d + AFI-4e + AFI-4f SESSION PAYROLL RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
  failures.forEach((f) => console.log('   - ' + f));
  process.exit(1);
})().catch((e) => { console.error('HARNESS ERROR: ' + (e && e.stack || e)); process.exit(2); });
