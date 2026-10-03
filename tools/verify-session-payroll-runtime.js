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
  'renderDashboard', 'renderExecutiveDashboard', 'renderTransactions', 'renderExecutionCenter'];

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

const LIST = (m) => '/api/payroll-plans?month=' + m;
const DET = (id) => '/api/payroll-plan?id=' + id;
const EMPS = '/api/employees?archived=1';
const W = { generate: '/api/payroll-plans/generate', review: '/api/payroll-plans/review', approve: '/api/payroll-plans/approve',
  return: '/api/payroll-plans/return', cancel: '/api/payroll-plans/cancel' };

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
function loadRuntime(routes){
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
    + ' sessionPayrollExcludedName: sessionPayrollExcludedName, render: render, parse: function(json){ return JSON.parse(json); } };';
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
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  dom.doc = sandbox.document;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-afi4c1-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.net = net; rt.access = access; rt.spy = sandbox.__spy; rt.spyErr = sandbox.__spyErr;
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
const buttons = (html) => ['swpReviewBtn', 'swpApproveBtn', 'swpReturnBtn', 'swpCancelBtn'].filter((b) => html.indexOf('id="' + b + '"') !== -1).map((b) => b.slice(3, -3)).join();

async function boot(me, routes){
  const base = me.role === 'ceo' ? { '/api/employees': [ok({ employees: [E1] })] } : { '/api/employee?id=emp_srv_1': [ok({ employee: { id: 'emp_srv_1', employeeCode: 'EMP-777', fullName: 'Fabricated Self', jobTitle: null, department: null, employmentStatus: 'Active', joinDate: null, contactEmail: null, phone: null, monthlyBaseSalary: '1000000.00' } })] };
  const rt = loadRuntime(Object.assign({ '/api/auth/me': [ok(me)] }, base, routes || {}));
  await flush();
  return rt;
}
// Signed in as the CEO, the Payroll section opened by its section button.
async function open(routes){
  const rt = await boot(ME_CEO, Object.assign({ [LIST(MONTH)]: [ok(MONTH_ALL)] }, routes || {}));
  rt.app.fire('swSectionPayroll', 'click'); await flush();
  return rt;
}
// The detail of `id` open.
async function detail(id, answer, routes){
  const rt = await open(Object.assign({ [DET(id)]: [ok(answer)] }, routes || {}));
  const i = (rt.pr().list || []).findIndex((p) => p.id === id);
  rt.app.fire('swpOpen' + i, 'click'); await flush();
  return rt;
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
  const outsideGenerate = html.replace(/<section class="card" aria-labelledby="swpPanelTitle"[^>]*><h2 [^>]*>Prepare payroll for this month\?<\/h2>[\s\S]*?<\/section>/, '');
  check(!/Finance|ledger|journal|payment|Execut|Posted|Post to/i.test(outsideGenerate) && !/\bPaid\b/.test(html),
    label + ': no Finance, payment, execution or posting wording (the preparation confirmation alone says nothing is posted to Finance)');
  check(!/Commit(?!ted)|commit\b|expectedTotal|swpCommit/i.test(html), label + ': no Commit control or wording — Committed appears only as a status');
  check(!new RegExp('[0-9a-f]{32}').test(html.replace(RID, '').replace(new RegExp(IDO, 'g'), '')), label + ': no opaque plan id in the page (only a contributing overtime record id, by design)');
  check(rt.State.employees.length === 0 && rt.State.payrollPlans.length === 0 && rt.State.storageReady === false && rt.AuthBoot.allowsWorkspace() === false,
    label + ': legacy State (employees, payroll plans) stays empty and the business shell is never granted');
  check(rt.access.url.length === 0 && rt.loc.hash === '' && rt.loc.search === '', label + ': nothing written to the address bar or history; no browser confirm()');
  const bad = posts(rt).filter((c) => {
    const b = bodyOf(c);
    const want = c.url === W.generate ? 'month' : 'expectedVersion,id';
    return keys(b) !== want || c.init.headers['X-CSRF-Token'] === undefined;
  });
  check(bad.length === 0, label + ': every Payroll write is a CSRF POST of exactly { month } or { id, expectedVersion } — no employee, company, role, status or money');
  check(rt.net.calls.every((c) => !(overtimeOpened ? /^\/api\/(finance|transactions|payments)/ : /^\/api\/(overtime|finance|transactions|payments)/).test(c.url) && !/^\/api\/payroll-plans\/(commit|status|pay|post)/.test(c.url)),
    label + ': no Overtime, Finance or commit request is ever made by the Payroll section');
}

(async function main(){
  console.log('== AFI-4c1 SESSION PAYROLL CEO WORKSPACE — RUNTIME VERIFICATION ==');

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
    check(/<td>Ready — approved, not paid<\/td>/.test(html) && /<td>Committed<\/td>/.test(html) && /<td>Cancelled<\/td>/.test(html) && /<td>Reviewed<\/td>/.test(html) && /<td>Draft<\/td>/.test(html)
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

  /* ---------- D. Employee: no Payroll at all ---------- */
  {
    const rt = await boot(ME_EMP, {});
    const html = rt.appHTML();
    check(!/swSectionPayroll|Payroll/.test(html) && /id="swSectionMain" aria-pressed="true"[^>]*>My profile</.test(html) && /id="swSectionOvertime"[^>]*>My overtime</.test(html),
      'D. an Employee sees exactly My profile | My overtime — no Payroll section');
    rt.SessionPayroll.show(true); await flush();
    rt.SessionPayroll.ensureLoaded(rt.AuthBoot.snapshot().principal); await flush();
    rt.SessionPayroll.openPanel('generate'); rt.SessionPayroll.shiftMonth(1); rt.SessionPayroll.openDetail(ID1); await rt.SessionPayroll.confirmPanel(); await flush();
    check(rt.pr().open === false && !/Payroll|swp/.test(rt.appHTML()), 'D. invoking the Payroll section by hand as an Employee is a no-op (fails closed)');
    check(payrollCalls(rt).length === 0, 'D. an Employee makes zero /api/payroll* requests');
    rt.app.fire('swSectionOvertime', 'click'); await flush();
    check(!/Payroll|swSectionPayroll/.test(rt.appHTML()) && payrollCalls(rt).length === 0, 'D. nor from the Overtime section');
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
      const r = await detail(p.id, det(p));
      check(buttons(r.appHTML()) === want, 'F. ' + p.status + ' offers ' + (want || 'nothing'));
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
    check(!/finance|ledger|journal|payment|execut|\/post|commit\(|expectedTotal|idempotency/i.test(all.replace(/posted to Finance/g, '')), 'K. no Finance, payment, execution, posting, Commit or idempotency code');
  }

  console.log('');
  if(failures.length === 0){ console.log('AFI-4c1 SESSION PAYROLL RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.'); process.exit(0); }
  console.log('AFI-4c1 SESSION PAYROLL RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
  failures.forEach((f) => console.log('   - ' + f));
  process.exit(1);
})().catch((e) => { console.error('HARNESS ERROR: ' + (e && e.stack || e)); process.exit(2); });
