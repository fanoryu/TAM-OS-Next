#!/usr/bin/env node
'use strict';
/* ============================================================
   I4 — SESSION FINANCE REQUESTS RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of the I4 frontend. This harness proves its BEHAVIOUR
   by executing every production module (module-order.js, the boot included) in the dependency-free
   Node `vm` loader of the other SESSION harnesses, with the ONE source line
   `const AUTH_MODE = AUTH_MODES.SESSION;` loaded as SESSION in the concatenated text — the
   committed value is untouched.

   DETERMINISTIC: fetch is a stub answering by URL from a script; `Date` with no argument is a fixed
   instant (2031-04-15T12:00:00Z: 2031-04-15 in Asia/Jakarta). No real network, no wall clock, no
   credentials, no production backend. localStorage / sessionStorage / cookies / history are
   instrumented, and the LOCAL boot, shell and renderers are recording spies that must never be
   called. Every identity, id and amount here is fabricated.

   Proven (ADR-016, Owner GO I4): who sees the section and its item (CEO "Finance Requests",
   Employee "My reimbursements"); the current company year as the default range; strict decoding;
   the list, the filter and the detail, every amount the exact server string and every value
   escaped; the CEO's create / edit / submit / approve / reject / cancel / pay with exactly the
   server's body keys, the version and amount shown, a 32-hex key and the CSRF token; a resubmit
   after an ambiguous answer reusing the same key; one write in flight at a time; 409 / 404 re-read
   from the server and never resend; 403 and 401; an answer that does not confirm the write is not
   a success; the Employee's own reimbursements with no CEO control (forged calls send nothing);
   the Approved-not-paid figures on Home, apart from income / expense / net; no storage, URL or
   LOCAL reach.

   I4-F01 (Owner GO, 2026-11-19): the concurrent detail and history reads keep their own errors in
   every completion order (gated, released in the order named); each Retry reads only the read whose
   error it is shown with; closing or leaving a request, the session ending and another principal
   drop late failures and every kept error.
   ============================================================ */

const ROUTE_ONLY = (u) => /^#\/[a-z]+$/.test(u);
const ROUTE_OR_CLEAR = (u) => ROUTE_ONLY(u) || u === '/';
const HASH_OK = (h) => ROUTE_ONLY(h) || h === '';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parseSessionShell } = require('./session-shell-chrome.js');
const { unmoney } = require('./ux-money-oracle.js');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

const root = path.resolve(__dirname, '..');
const CSRF = 'A'.repeat(21) + '_' + 'b'.repeat(21);
const RID = '0123456789abcdef0123456789abcdef';
const ME_CEO = { userId: 'u_ceo_1', membershipId: 'm_ceo_1', role: 'ceo', employeeId: null, csrfToken: CSRF };
const ME_EMP = { userId: 'u_emp_1', membershipId: 'm_emp_1', role: 'employee', employeeId: 'emp_srv_1', csrfToken: CSRF };
const FIXED_NOW = Date.UTC(2031, 3, 15, 12, 0, 0);
const NEVER = ['loadState', 'saveState', 'applyTheme', 'installGlobalUIHandlers', 'maybeShowFirstRunChoice', 'startFresh',
  'renderShell', 'renderView', 'restoreCompleteBackup', 'renderSmartImport', 'openGlobalSearch', 'renderActivityLog',
  'renderEmployees', 'persistEmployees', 'logActivity', 'renderOvertime', 'renderPayrollWorkspace', 'renderDashboard',
  'renderExecutiveDashboard', 'renderTransactions', 'renderExecutionCenter', 'renderCashflow', 'renderBudget'];

/* ---------- fabricated data ---------- */
const U = 'a'.repeat(32);
const AT = '2031-04-02T01:00:00.000000Z';
const fr = (id, extra) => Object.assign({ id: id, kind: 'paymentRequest', employeeId: null, financialPost: 'GA', category: 'Operasional', description: 'Fabricated <b>supplies</b>',
  amount: '1500000.00', payee: 'Fabricated <Vendor> & Co', documentDate: '2031-04-20', status: 'Draft', statusReason: null, version: 1,
  createdByUserId: U, createdAt: AT, updatedAt: AT, payment: null }, extra || {});
const PAYMENT = { financeTransactionId: '9'.repeat(32), paidOn: '2031-04-12', paymentMethod: 'bankTransfer', paidByUserId: U, paidAt: '2031-04-12T03:00:00.000000Z' };
const PR_DRAFT = fr('1'.repeat(32), { documentDate: '2031-03-01' });
const PR_SUB = fr('2'.repeat(32), { status: 'Submitted', version: 2, documentDate: '2031-03-05', financialPost: 'DRONE', amount: '2000000.00' });
const PR_APP = fr('3'.repeat(32), { status: 'Approved', version: 3, documentDate: '2031-04-01', amount: '750000.00' });
const rb = (id, extra) => fr(id, Object.assign({ kind: 'reimbursement', employeeId: 'emp_srv_1', payee: null, category: 'Transport', description: 'Fabricated taxi', amount: '125000.00' }, extra || {}));
const RB_PAID = rb('4'.repeat(32), { status: 'Paid', version: 4, documentDate: '2031-04-02', payment: PAYMENT });
const RB_REJ = rb('5'.repeat(32), { status: 'Rejected', version: 3, documentDate: '2031-04-03', statusReason: 'Fabricated <no receipt>' });
const RB_DRAFT = rb('6'.repeat(32), { documentDate: '2031-04-10' });
const CEO_LIST = { financeRequests: [PR_DRAFT, PR_SUB, PR_APP, RB_PAID, RB_REJ, RB_DRAFT] };
const EMP_LIST = { financeRequests: [RB_PAID, RB_REJ, RB_DRAFT] };
const YEAR = '/api/finance-requests?from=2031-01-01&to=2031-12-31';
const ONE = (id) => '/api/finance-request?id=' + id;
const HIST = (id) => '/api/audit-events/record?entity=financeRequest&id=' + id;
const EMPS_ALL = '/api/employees?archived=1';
const E1 = { id: 'emp_srv_1', employeeCode: 'EMP-777', fullName: 'Fabricated <Self>', jobTitle: null, department: null, employmentStatus: 'Active', archived: false, accountState: 'active', accountManageable: true };
const SELF = { id: 'emp_srv_1', employeeCode: 'EMP-777', fullName: 'Fabricated Self', jobTitle: null, department: null, employmentStatus: 'Active',
  joinDate: null, contactEmail: null, phone: null, monthlyBaseSalary: '1000000.00' };
const EV = (id, action, operation, at) => ({ id: id, action: action, actorMembershipId: U, actorUserId: U, entity: 'financeRequest', entityId: PR_SUB.id, fields: [],
  occurredAt: at, operation: operation, requestId: RID, targetUserId: null });
const HISTORY = { auditEvents: [EV('1', 'finance.manage', 'create', '2031-03-05T01:00:00.000000Z'), EV('2', 'finance.manage', 'submit', '2031-03-05T02:00:00.000000Z')] };
const W = {
  create: '/api/finance-requests/create', update: '/api/finance-requests/update', submit: '/api/finance-requests/submit', approve: '/api/finance-requests/approve',
  reject: '/api/finance-requests/reject', cancel: '/api/finance-requests/cancel', pay: '/api/finance-requests/pay'
};
const post = (code, name, income, expense, net, count) => ({ code: code, name: name, income: income, expense: expense, net: net, count: count });
const REPORT = (anp) => ({ financialReport: { from: '2031-04-01', to: '2031-04-30',
  posts: [post('GA', 'GA', '0.00', '2500000.00', '-2500000.00', 1), post('NPIP', 'NP & IP', '0.00', '0.00', '0.00', 0), post('TJB', 'TJB', '0.00', '0.00', '0.00', 0), post('DRONE', 'RnD — Research & Development', '12000000.00', '0.00', '12000000.00', 1)],
  general: { income: '12000000.00', expense: '2500000.00', net: '9500000.00', count: 2 }, voided: { count: 0, amount: '0.00' },
  payroll: { posted: { amount: '0.00', count: 0, fromMonth: '2031-04', toMonth: '2031-04' }, paid: { amount: '0.00', count: 0 } },
  consolidated: { income: '12000000.00', expense: '2500000.00', net: '9500000.00' }, approvedNotPaid: anp } });
const ANP = { posts: [{ code: 'GA', amount: '750000.00', count: 2 }, { code: 'NPIP', amount: '0.00', count: 0 }, { code: 'TJB', amount: '0.00', count: 0 }, { code: 'DRONE', amount: '1000000.00', count: 1 }], amount: '1750000.00', count: 3 };
const ANP_ZERO = { posts: ['GA', 'NPIP', 'TJB', 'DRONE'].map((c) => ({ code: c, amount: '0.00', count: 0 })), amount: '0.00', count: 0 };
const REP_APRIL = '/api/reports/financial?from=2031-04-01&to=2031-04-30';

/* ---------- scripted responses ---------- */
function resp(status, body){
  const lower = { 'content-type': 'application/json; charset=utf-8' };
  return { status: status, headers: { get: (n) => lower[String(n).toLowerCase()] === undefined ? null : lower[String(n).toLowerCase()] },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}
const ok = (data) => resp(200, { ok: true, data: data, requestId: RID });
const err = (status, code) => resp(status, { ok: false, error: { code: code, message: 'server text' }, requestId: RID });
const NETFAIL = () => new TypeError('Failed to fetch');
const one = (r) => ok({ financeRequest: r });

/* ---------- a recording #app ---------- */
const unescapeHtml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function mkApp(mkEl, dom){
  let html = '';
  let elements = {};
  const tagOf = (id) => new RegExp('<([a-z]+)[^>]*\\sid="' + id + '"[^>]*>').exec(html);
  function find(sel){
    const m = /^#([A-Za-z0-9_-]+)$/.exec(sel);
    if(!m) return null;
    const id = m[1];
    const tag = tagOf(id);
    if(!tag) return null;
    if(!elements[id]){
      const listeners = {};
      const attr = (n) => { const v = new RegExp('\\s' + n + '="([^"]*)"').exec(tag[0]); return v ? unescapeHtml(v[1]) : null; };
      const rest = html.slice(html.indexOf(tag[0]) + tag[0].length);
      const initial = tag[1] === 'input' ? (attr('value') || '')
        : tag[1] === 'select' ? ((/<option value="([^"]*)" selected>/.exec(rest.slice(0, rest.indexOf('</select>'))) || [])[1] || '')
        : tag[1] === 'textarea' ? unescapeHtml(rest.slice(0, rest.indexOf('</textarea>'))) : '';
      elements[id] = { id: id, name: attr('name'), value: unescapeHtml(initial), listeners: listeners,
        disabled: /\sdisabled(\s|>|=)/.test(tag[0]),
        addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
        focus: () => { dom.focused.push(id); }, setSelectionRange: () => {}, querySelector: find, getAttribute: attr };
    }
    return elements[id];
  }
  const app = mkEl();
  app.querySelector = find;
  app.querySelectorAll = () => [];
  app.contains = () => true;
  Object.defineProperty(app, 'innerHTML', { get: () => html, set: (v) => { html = String(v); elements = {}; } });
  app.fire = (id, type, ev) => {
    const el = find('#' + id);
    if(!el) return 'absent';
    if(el.disabled && type === 'click') return 'disabled';
    (el.listeners[type] || []).forEach((fn) => fn.call(el, ev || { preventDefault: () => {} }));
    return 'fired';
  };
  app.type = (id, value) => { const el = find('#' + id); if(!el || el.disabled) return false; el.value = value; (el.listeners.input || []).forEach((fn) => fn.call(el, {})); (el.listeners.change || []).forEach((fn) => fn.call(el, {})); return true; };
  // A row's Open button, as the delegated listener sees a click on it.
  app.openRow = (i) => app.fire('frList', 'click', { target: { closest: (sel) => sel === '[data-fr-open]' ? { disabled: false, getAttribute: () => String(i) } : null } });
  return app;
}

/* ---------- runtime loader ---------- */
function loadRuntime(routes, hash){
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
    + '\n;window.__TAM__ = { State: State, AuthBoot: AuthBoot, SessionRequestsStore: SessionRequestsStore, SessionRequests: SessionRequests,'
    + ' FinanceRequestDecoders: FinanceRequestDecoders, FinanceRequestRequests: FinanceRequestRequests, render: render, parse: function(j){ return JSON.parse(j); } };';
  const noop = function(){};
  const access = { local: [], session: [], url: [], cookie: [] };
  const storageOf = (log) => ({ getItem: (k) => { log.push('get:' + k); return null; }, setItem: (k) => { log.push('set:' + k); }, removeItem: (k) => { log.push('remove:' + k); },
    key: () => null, get length(){ return 0; }, clear: () => { log.push('clear'); } });
  const mkEl = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'', value:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, removeChild:noop, setAttribute:noop,
    getAttribute:()=>null, remove:noop, focus:noop, contains:()=>false, querySelector:()=>null, querySelectorAll:()=>[],
    classList:{ add:noop, remove:noop, toggle:noop, contains:()=>false } });
  const els = {};
  const dom = { focused: [] };
  els.app = mkApp(mkEl, dom);
  const net = { calls: [], routes: routes || {} };
  const fetchStub = function(url, init){
    net.calls.push({ url: url, init: init });
    return new Promise(function(resolve, reject){
      const q = net.routes[url] || [];
      const next = q.length > 1 ? q.shift() : q[0];
      Promise.resolve().then(function(){
        if(!next) return reject(new TypeError('no route'));
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
  const document = { addEventListener:noop, removeEventListener:noop, getElementById: (id) => (els[id] = els[id] || mkEl()),
    querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>mkEl(), contains:()=>false,
    body: mkEl(), documentElement: { dataset:{}, style:{} }, activeElement: null };
  Object.defineProperty(document, 'cookie', { get: () => { access.cookie.push('get'); return ''; }, set: () => { access.cookie.push('set'); } });
  const h = hash || '#/employees';
  const sandbox = {
    __spy: [], __spyErr: [], Date: FixedDate, crypto: require('crypto').webcrypto,
    console: { log:noop, warn:noop, error:noop, info:noop }, navigator: { userAgent:'tam-i4' },
    setTimeout: function(fn, ms){ if(ms === 10000) return 'api-timer'; return setTimeout(fn, ms); },
    clearTimeout: function(id){ if(id !== 'api-timer') clearTimeout(id); },
    requestAnimationFrame: (fn) => setTimeout(fn, 0), AbortController: AbortController, fetch: fetchStub,
    localStorage: storageOf(access.local), sessionStorage: storageOf(access.session),
    addEventListener: noop, removeEventListener: noop, confirm: () => { access.url.push('confirm()'); return true; },
    location: { hash: h, search: '', pathname: '/', href: 'http://127.0.0.1/' + h },
    history: { replaceState: (a, b, u) => { access.url.push(String(u)); sandbox.location.hash = /^#/.test(String(u)) ? String(u) : ''; }, pushState: (a, b, u) => { access.url.push(String(u)); sandbox.location.hash = /^#/.test(String(u)) ? String(u) : ''; } },
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }), getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: document
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-i4-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.net = net; rt.access = access; rt.spy = sandbox.__spy; rt.spyErr = sandbox.__spyErr;
  rt.appHTML = () => els.app.innerHTML; rt.app = els.app; rt.dom = dom; rt.loc = sandbox.location;
  rt.rq = () => rt.SessionRequestsStore.snapshot();
  rt.state = () => rt.AuthBoot.snapshot().state;
  return rt;
}
const flush = async (n) => { for(let i = 0; i < (n || 14); i++) await new Promise((r) => setImmediate(r)); };
const frCalls = (rt) => rt.net.calls.filter((c) => /^\/api\/finance-request/.test(c.url));
const writes = (rt) => rt.net.calls.filter((c) => c.init && c.init.method === 'POST' && /^\/api\/finance-requests\//.test(c.url));
const posts = (rt, p) => rt.net.calls.filter((c) => c.url === p && c.init && c.init.method === 'POST');
const bodyOf = (c) => JSON.parse(c.init.body);
const keysOf = (c) => Object.keys(bodyOf(c)).sort().join();
const shellContent = (rt) => { const s = parseSessionShell(rt.appHTML()); return s ? s.content : rt.appHTML(); };
const card = (rt) => unmoney(shellContent(rt)).html;
const HEX32 = /^[0-9a-f]{32}$/;

async function boot(me, routes, hash){
  const base = me.role === 'ceo' ? { '/api/employees': [ok({ employees: [] })] } : { '/api/employee?id=emp_srv_1': [ok({ employee: SELF })] };
  const rt = loadRuntime(Object.assign({ '/api/auth/me': [ok(me)] }, base, routes || {}), hash);
  await flush();
  return rt;
}
// The CEO with Finance Requests open on the company year.
async function openCeo(routes){
  const rt = await boot(ME_CEO, Object.assign({ [YEAR]: [ok(CEO_LIST)], [EMPS_ALL]: [ok({ employees: [E1] })] }, routes || {}));
  rt.app.fire('swSectionRequests', 'click'); await flush();
  return rt;
}
async function openEmp(routes){
  const rt = await boot(ME_EMP, Object.assign({ [YEAR]: [ok(EMP_LIST)] }, routes || {}));
  rt.app.fire('swSectionRequests', 'click'); await flush();
  return rt;
}
// Open the row at `i` of the (filtered) list, with its detail (and, for the CEO, its history).
async function openRow(rt, i, r, extra){
  rt.net.routes[ONE(r.id)] = [one(r)];
  if(!rt.net.routes[HIST(r.id)]) rt.net.routes[HIST(r.id)] = [ok({ auditEvents: [] })];
  Object.assign(rt.net.routes, extra || {});
  rt.app.openRow(i); await flush();
}
function firewall(rt, label){
  check(rt.access.local.length === 0 && rt.access.session.length === 0 && rt.access.cookie.length === 0 && rt.access.url.every(ROUTE_OR_CLEAR) && HASH_OK(rt.loc.hash) && rt.loc.search === '',
    label + ': zero localStorage / sessionStorage / cookie access; the address bar carries only a route');
  check(rt.spy.length === 0 && rt.spyErr.length === 0 && rt.State.txns.length === 0, label + ': no LOCAL boot, shell or renderer was called; LOCAL State stays empty' + (rt.spy.length ? ' >> ' + rt.spy.join(', ') : ''));
  check(!/<script|\son[a-z]+=|style="|Acting as|data-nav=/i.test(card(rt)) && !/[0-9a-f]{32}/.test(card(rt).replace(/value="[^"]*"/g, '')),
    label + ': the card carries no script, inline handler, inline style, "Acting as", LOCAL navigation or opaque id');
  check(frCalls(rt).every((c) => c.init.credentials === 'same-origin' && c.init.cache === 'no-store'
    && (c.init.method === 'GET' ? c.init.body === undefined && !c.init.headers['X-CSRF-Token']
      : c.init.method === 'POST' && c.init.headers['X-CSRF-Token'] === CSRF && !/\?/.test(c.url))),
    label + ': every request read is a bodiless same-origin GET; every write a same-origin POST with the CSRF token and no query');
}

(async function main(){
  console.log('== I4 — SESSION FINANCE REQUESTS RUNTIME VERIFICATION ==');

  /* ---------- A. who sees the section ---------- */
  {
    const rt = await boot(ME_CEO);
    const html = rt.appHTML();
    check((parseSessionShell(html) || {}).role === 'ceo' && /id="swSectionTransactions"[\s\S]*id="swSectionRequests"[\s\S]*>Finance Requests<[\s\S]*id="swSectionAudit"/.test(html) && frCalls(rt).length === 0,
      'A. the CEO has a "Finance Requests" item after Transactions; nothing is read before it is opened');
    firewall(rt, 'A. CEO');
  }
  {
    const rt = await boot(ME_EMP);
    const html = rt.appHTML();
    check((parseSessionShell(html) || {}).role === 'employee' && /id="swSectionRequests"[\s\S]*>My reimbursements</.test(html) && !/Finance Requests/.test(html) && frCalls(rt).length === 0,
      'A. an Employee has a "My reimbursements" item (no "Finance Requests"); nothing is read before it is opened');
  }
  {
    const rt = loadRuntime({ '/api/auth/me': [err(401, 'unauthenticated')] }); await flush();
    rt.SessionRequests.show(true); rt.SessionRequests.openCreate(); rt.SessionRequests.applyRange(); await flush();
    check(!rt.rq().open && frCalls(rt).length === 0, 'A. signed out: every SessionRequests entry point is a no-op — nothing is read or written');
  }

  /* ---------- B. the CEO list ---------- */
  {
    const rt = await openCeo();
    const html = card(rt);
    const s = rt.rq();
    check(s.open && s.range.from === '2031-01-01' && s.range.to === '2031-12-31' && rt.net.calls.filter((c) => c.url === YEAR).length === 1
      && rt.net.calls.filter((c) => c.url === EMPS_ALL).length === 1,
      'B. opening reads the requests of the current company year (2031-01-01 to 2031-12-31) once, and the employee names (archived included) once');
    check((parseSessionShell(rt.appHTML()) || {}).active === 'requests' && rt.loc.hash === '#/requests' && /<h1 class="auth-title" id="authTitle" tabindex="-1">Finance Requests<\/h1>/.test(html)
      && rt.dom.focused[rt.dom.focused.length - 1] === 'authTitle',
      'B. the item is current, the address bar reads #/requests, the heading is "Finance Requests" and focus moves to it');
    const rows = html.match(/<tr><td>\d{4}-\d{2}-\d{2}<\/td>[\s\S]*?<\/tr>/g) || [];
    check(rows.length === 6 && /<td>2031-03-01<\/td><td>Payment request<\/td><td>Fabricated &lt;Vendor&gt; &amp; Co<\/td><td>GA<\/td><td>Operasional<\/td><td>1500000\.00<\/td>/.test(rows[0])
      && /<td>RnD — Research &amp; Development<\/td>/.test(rows[1]) && /Approved — not paid/.test(rows[2]) && /<td>Reimbursement<\/td><td>Fabricated &lt;Self&gt;<\/td>/.test(rows[3]) && /Paid/.test(rows[3]),
      'B. six rows in date order: date, type, the escaped payee or the employee\'s name, post, category, the exact amount, the status ("Approved — not paid")');
    check(/data-fr-open="0"/.test(html) && /data-fr-open="5"/.test(html) && !/<b>/.test(html), 'B. a row is opened by its position; no server value reaches the page as markup');
    const m = unmoney(shellContent(rt));
    check(m.ok && m.count === 6, 'B. every amount is the exact server string, shown with the display-only grouping (6 amounts)');
    rt.app.type('frFilter', 'Approved');
    const f = card(rt);
    check(rt.rq().filter === 'Approved' && (f.match(/<tr><td>\d{4}/g) || []).length === 1 && /1 request Approved — not paid, by date/.test(f) && rt.net.calls.filter((c) => c.url === YEAR).length === 1,
      'B. the status filter shows only Approved requests, without reading the server again');
    rt.app.type('frFilter', 'Bogus');
    check(rt.rq().filter === '', 'B. a status outside the six is no filter');
    firewall(rt, 'B');
  }

  /* ---------- C. strict decoding ---------- */
  {
    const rt = await boot(ME_CEO);
    const D = (o) => rt.FinanceRequestDecoders.listResponse(rt.parse(JSON.stringify(o)), '2031-01-01', '2031-12-31');
    const R = (o) => rt.FinanceRequestDecoders.request(rt.parse(JSON.stringify(o)));
    const variants = {
      'an extra key': Object.assign({}, PR_DRAFT, { companyId: 'x' }),
      'a missing key': (() => { const o = Object.assign({}, PR_DRAFT); delete o.version; return o; })(),
      'an unknown status': Object.assign({}, PR_DRAFT, { status: 'Reviewed' }),
      'an unknown kind': Object.assign({}, PR_DRAFT, { kind: 'advance' }),
      'a float amount': Object.assign({}, PR_DRAFT, { amount: '1500000.5' }),
      'a numeric amount': Object.assign({}, PR_DRAFT, { amount: 1500000 }),
      'a reimbursement with a payee': Object.assign({}, RB_DRAFT, { payee: 'x' }),
      'a payment request with an owner': Object.assign({}, PR_DRAFT, { employeeId: 'emp_srv_1' }),
      'a reason on a Draft': Object.assign({}, PR_DRAFT, { statusReason: 'x' }),
      'a Rejected without a reason': Object.assign({}, RB_REJ, { statusReason: null }),
      'a payment on an Approved': Object.assign({}, PR_APP, { payment: PAYMENT }),
      'a Paid without a payment': Object.assign({}, RB_PAID, { payment: null }),
      'an unknown payment method': Object.assign({}, RB_PAID, { payment: Object.assign({}, PAYMENT, { paymentMethod: 'Cash' }) }),
      'a version of 0': Object.assign({}, PR_DRAFT, { version: 0 }),
      'an unknown Financial Post': Object.assign({}, PR_DRAFT, { financialPost: 'HR' })
    };
    let all = true;
    for(const [label, o] of Object.entries(variants)){ if(R(o) !== null){ all = false; console.log('    accepted: ' + label); } }
    check(all && R(PR_DRAFT) !== null && R(RB_PAID) !== null && R(RB_REJ) !== null, 'C. a request is decoded only with exactly the server\'s fields and grammar (' + Object.keys(variants).length + ' malformed variants refused)');
    check(D(CEO_LIST) !== null && D({ financeRequests: [PR_SUB, PR_DRAFT] }) === null && D({ financeRequests: [PR_DRAFT, PR_DRAFT] }) === null
      && D({ financeRequests: [fr('7'.repeat(32), { documentDate: '2032-01-01' })] }) === null && D({ financeRequests: [], more: true }) === null && D({ financeRequests: [] }).length === 0,
      'C. a list is refused whole when out of date order, holding an id twice, a date outside the range or an extra key');
  }
  {
    const rt = await openCeo({ [YEAR]: [ok({ financeRequests: [Object.assign({}, PR_DRAFT, { companyId: 'x' })] })] });
    check(rt.rq().list === null && /TAM OS sent an unexpected response/.test(card(rt)) && !/id="frList"/.test(card(rt)) && /id="frRetryBtn"/.test(card(rt)),
      'C. a malformed list shows a fixed message and Retry, and nothing of it');
    rt.net.routes[YEAR] = [ok(CEO_LIST)];
    rt.app.fire('frRetryBtn', 'click'); await flush();
    check(rt.rq().list && rt.rq().list.length === 6 && /id="frList"/.test(card(rt)), 'C. Retry reads the list again');
  }
  {
    const rt = await openCeo({ [YEAR]: [err(503, 'unavailable')] });
    check(/Check your connection/.test(card(rt)) && /id="frRetryBtn"/.test(card(rt)), 'C. a 503 list read shows the fixed unavailable message and Retry');
  }

  /* ---------- D. the CEO creates a payment request ---------- */
  {
    const rt = await openCeo();
    rt.app.fire('frNewBtn', 'click');
    let html = card(rt);
    const f = rt.rq().form;
    check(f && f.mode === 'create' && f.kind === 'paymentRequest' && HEX32.test(f.key) && /id="frf-payee"/.test(html) && /Needed by/.test(html) && /value="2031-04-15"/.test(html)
      && rt.dom.focused[rt.dom.focused.length - 1] === 'frf-financialPost',
      'D. "New payment request" opens a form with a payee and a needed-by date (today by default), a 32-hex key made once, focus on the first field');
    rt.app.type('frf-financialPost', 'TJB'); rt.app.type('frf-category', 'Gaji'); rt.app.type('frf-description', 'Fabricated toner'); rt.app.type('frf-amount', '350000.00');
    rt.app.type('frf-payee', 'Fabricated Supplier'); rt.app.type('frf-documentDate', '2031-05-02');
    rt.app.fire('frForm', 'submit'); await flush();
    check(writes(rt).length === 0 && rt.rq().mutation.fields.join() === 'category' && /id="frf-category"[^>]*aria-invalid="true" aria-describedby="frf-category-hint frf-category-error"/.test(card(rt)),
      'D. a payroll category (Gaji) is refused before sending; the field is marked invalid');
    rt.app.type('frf-category', 'Office supplies'); rt.app.type('frf-documentDate', '2032-05-02');
    rt.app.fire('frForm', 'submit'); await flush();
    check(writes(rt).length === 0 && rt.rq().mutation.fields.join() === 'documentDate', 'D. a needed-by date beyond today + 366 days is refused before sending');
    rt.app.type('frf-documentDate', '2031-05-02');
    const key = rt.rq().form.key;
    const NEW = fr('8'.repeat(32), { financialPost: 'TJB', category: 'Office supplies', description: 'Fabricated toner', amount: '350000.00', payee: 'Fabricated Supplier', documentDate: '2031-05-02' });
    rt.net.routes[W.create] = [NETFAIL(), one(NEW)];
    rt.app.fire('frForm', 'submit'); await flush();
    const c1 = posts(rt, W.create);
    check(c1.length === 1 && keysOf(c1[0]) === 'amount,category,description,documentDate,financialPost,idempotencyKey,kind,payee'
      && bodyOf(c1[0]).kind === 'paymentRequest' && bodyOf(c1[0]).amount === '350000.00' && bodyOf(c1[0]).idempotencyKey === key && !('employeeId' in bodyOf(c1[0])),
      'D. Save draft sends exactly the eight payment-request keys (no employeeId), the amount as typed and the form\'s key');
    check(rt.rq().mutation.status === 'ambiguous' && rt.rq().form && rt.rq().form.key === key && /could not confirm the result/.test(card(rt)),
      'D. a network failure is ambiguous, never a success: the form and its key stay, with a fixed message');
    rt.net.routes[ONE(NEW.id)] = [one(NEW)]; rt.net.routes[HIST(NEW.id)] = [ok({ auditEvents: [] })];
    rt.net.routes[YEAR] = [ok({ financeRequests: CEO_LIST.financeRequests.slice(0, 3).concat([RB_PAID, RB_REJ, RB_DRAFT, NEW]) })];
    rt.app.fire('frForm', 'submit'); await flush();
    const c2 = posts(rt, W.create);
    html = card(rt);
    check(c2.length === 2 && bodyOf(c2[1]).idempotencyKey === key && JSON.stringify(bodyOf(c2[1])) === JSON.stringify(bodyOf(c2[0])),
      'D. the deliberate resubmit replays the same body under the same key — never a second request');
    check(rt.rq().form === null && rt.rq().detailId === NEW.id && rt.net.calls.filter((c) => c.url === ONE(NEW.id)).length === 1 && /Draft saved/.test(html) && /id="frDetail"/.test(html),
      'D. the confirmed Draft opens, read again from the server, with "Draft saved"');
    firewall(rt, 'D');
  }
  {
    const rt = await openCeo();
    rt.app.fire('frNewBtn', 'click');
    rt.app.type('frf-financialPost', 'GA'); rt.app.type('frf-category', 'Office'); rt.app.type('frf-description', 'Fabricated'); rt.app.type('frf-amount', '1.00'); rt.app.type('frf-payee', 'P');
    rt.net.routes[W.create] = [one(fr('8'.repeat(32), { amount: '2.00', category: 'Office', description: 'Fabricated', payee: 'P', documentDate: '2031-04-15' }))];
    rt.app.fire('frForm', 'submit'); await flush();
    check(posts(rt, W.create).length === 1 && rt.rq().mutation.status === 'ambiguous' && rt.rq().form !== null,
      'D. a 200 whose Draft does not hold the values sent is not a success (ambiguous; the form stays)');
  }

  /* ---------- E. edit and submit a Draft ---------- */
  {
    const rt = await openCeo();
    await openRow(rt, 0, PR_DRAFT);
    let html = card(rt);
    check(rt.rq().detailId === PR_DRAFT.id && /id="frEditBtn"/.test(html) && /id="frSubmitBtn"/.test(html) && /id="frCancelBtn"/.test(html)
      && !/id="frApproveBtn"|id="frRejectBtn"|id="frPayBtn"/.test(html) && /<dd>Fabricated &lt;b&gt;supplies&lt;\/b&gt;<\/dd>/.test(html) && /<dt>Version<\/dt><dd>1<\/dd>/.test(html),
      'E. a Draft offers the CEO Edit, Submit and Cancel only; every value is escaped');
    check(rt.net.calls.filter((c) => c.url === ONE(PR_DRAFT.id)).length === 1 && rt.net.calls.filter((c) => c.url === HIST(PR_DRAFT.id)).length === 1,
      'E. opening a request reads it and its activity history from the server, once each');
    rt.app.fire('frEditBtn', 'click');
    rt.app.fire('frForm', 'submit'); await flush();
    check(writes(rt).length === 0 && /Nothing was changed/.test(card(rt)), 'E. saving an unchanged Draft sends nothing');
    rt.app.type('frf-amount', '1600000.00');
    const EDITED = Object.assign({}, PR_DRAFT, { amount: '1600000.00', version: 2 });
    rt.net.routes[W.update] = [one(EDITED)]; rt.net.routes[ONE(PR_DRAFT.id)] = [one(EDITED)];
    rt.app.fire('frForm', 'submit'); await flush();
    const u = posts(rt, W.update);
    check(u.length === 1 && JSON.stringify(bodyOf(u[0])) === JSON.stringify({ financeRequestId: PR_DRAFT.id, expectedVersion: 1, amount: '1600000.00' }),
      'E. Save changes sends only the changed field, with the id and the version shown');
    html = card(rt);
    check(rt.rq().form === null && rt.rq().detail.version === 2 && /Draft updated/.test(html) && /<dt>Version<\/dt><dd>2<\/dd>/.test(html), 'E. the updated Draft is read again (version 2)');
    rt.app.fire('frSubmitBtn', 'click');
    html = card(rt);
    check(rt.rq().action.op === 'submit' && /id="frActionForm"/.test(html) && /Once submitted, the request can no longer be edited/.test(html) && writes(rt).length === 1,
      'E. Submit asks for confirmation first; nothing is sent yet');
    rt.net.routes[W.submit] = [one(Object.assign({}, EDITED, { status: 'Submitted', version: 3 }))];
    rt.net.routes[ONE(PR_DRAFT.id)] = [one(Object.assign({}, EDITED, { status: 'Submitted', version: 3 }))];
    rt.app.fire('frActionForm', 'submit'); await flush();
    const s = posts(rt, W.submit);
    check(s.length === 1 && JSON.stringify(bodyOf(s[0])) === JSON.stringify({ financeRequestId: PR_DRAFT.id, expectedVersion: 2 }) && /Submitted for approval/.test(card(rt))
      && rt.rq().detail.status === 'Submitted', 'E. Confirm sends exactly { financeRequestId, expectedVersion } of the version shown; the request reads Submitted');
    firewall(rt, 'E');
  }

  /* ---------- F. approve, reject ---------- */
  {
    const rt = await openCeo();
    await openRow(rt, 1, PR_SUB, { [HIST(PR_SUB.id)]: [ok(HISTORY)] });
    let html = card(rt);
    check(/id="frApproveBtn"/.test(html) && /id="frRejectBtn"/.test(html) && /id="frCancelBtn"/.test(html) && !/id="frEditBtn"|id="frSubmitBtn"|id="frPayBtn"/.test(html)
      && /id="frHistory"/.test(html) && (html.match(/<li>/g) || []).length >= 2,
      'F. a Submitted request offers Approve, Reject and Cancel only, and shows its activity history');
    rt.app.fire('frRejectBtn', 'click');
    rt.app.fire('frActionForm', 'submit'); await flush();
    check(writes(rt).length === 0 && rt.rq().mutation.fields.join() === 'reason' && /frReason-error/.test(card(rt)), 'F. Reject without a reason sends nothing and marks the reason');
    rt.app.type('frReason', 'Fabricated duplicate');
    const REJ = Object.assign({}, PR_SUB, { status: 'Rejected', version: 3, statusReason: 'Fabricated duplicate' });
    rt.net.routes[W.reject] = [one(REJ)]; rt.net.routes[ONE(PR_SUB.id)] = [one(REJ)];
    rt.app.fire('frActionForm', 'submit'); await flush();
    const r = posts(rt, W.reject);
    html = card(rt);
    check(r.length === 1 && JSON.stringify(bodyOf(r[0])) === JSON.stringify({ financeRequestId: PR_SUB.id, expectedVersion: 2, reason: 'Fabricated duplicate' })
      && /Reason for rejection<\/dt><dd>Fabricated duplicate/.test(html) && !/id="frOps"/.test(html),
      'F. Reject sends { financeRequestId, expectedVersion, reason }; the Rejected request shows its reason and offers nothing');
  }
  {
    const rt = await openCeo();
    await openRow(rt, 1, PR_SUB);
    rt.app.fire('frApproveBtn', 'click');
    check(/commits the company to pay this amount\. It is not a payment/.test(card(rt)) && /Rp 2\.000\.000,00/.test(card(rt)), 'F. Approve names the amount and says it is not a payment');
    rt.net.routes[W.approve] = [err(409, 'conflict')];
    rt.net.routes[ONE(PR_SUB.id)] = [one(Object.assign({}, PR_SUB, { version: 3, amount: '2100000.00' }))];
    const before = rt.net.calls.filter((c) => c.url === YEAR).length;
    rt.app.fire('frActionForm', 'submit'); await flush();
    const a = posts(rt, W.approve);
    let html = card(rt);
    check(a.length === 1 && JSON.stringify(bodyOf(a[0])) === JSON.stringify({ financeRequestId: PR_SUB.id, expectedVersion: 2, expectedAmount: '2000000.00' }),
      'F. Approve sends { financeRequestId, expectedVersion, expectedAmount } — the exact amount shown');
    check(rt.rq().action === null && rt.rq().detail.version === 3 && rt.net.calls.filter((c) => c.url === YEAR).length === before + 1 && /changed or moved on/.test(html)
      && /<dt>Amount \(Rp\)<\/dt><dd>2100000\.00<\/dd>/.test(html) && posts(rt, W.approve).length === 1,
      'F. a 409 closes the panel, reads the list and the request again (the new amount shown) and never resends');
    rt.app.fire('frApproveBtn', 'click');
    rt.net.routes[W.approve] = [one(Object.assign({}, PR_SUB, { version: 4, amount: '2100000.00', status: 'Submitted' }))];
    rt.app.fire('frActionForm', 'submit'); await flush();
    check(posts(rt, W.approve).length === 2 && bodyOf(posts(rt, W.approve)[1]).expectedAmount === '2100000.00' && bodyOf(posts(rt, W.approve)[1]).expectedVersion === 3
      && rt.rq().mutation.status === 'ambiguous',
      'F. the user decides again on the new version and amount; an answer still Submitted does not confirm the approval (ambiguous)');
    firewall(rt, 'F');
  }
  {
    const rt = await openCeo();
    await openRow(rt, 1, PR_SUB);
    rt.app.fire('frApproveBtn', 'click');
    rt.net.routes[W.approve] = [err(404, 'not_found')];
    rt.app.fire('frActionForm', 'submit'); await flush();
    check(/not found/.test(card(rt)) && rt.net.calls.filter((c) => c.url === YEAR).length === 2, 'F. a 404 says not found and reads the list again');
  }
  {
    const rt = await openCeo();
    await openRow(rt, 1, PR_SUB);
    rt.app.fire('frApproveBtn', 'click');
    rt.net.routes[W.approve] = [err(403, 'forbidden')];
    rt.app.fire('frActionForm', 'submit'); await flush();
    check(posts(rt, W.approve).length === 1 && /You do not have access/.test(card(rt)) && rt.rq().mutation.status === 'error' && rt.state() === 'AUTHENTICATED',
      'F. a 403 (the same session and token) is a denial, shown with a fixed message, never replayed');
  }
  {
    const rt = await openCeo();
    await openRow(rt, 1, PR_SUB);
    rt.app.fire('frApproveBtn', 'click');
    rt.net.routes[W.approve] = [err(401, 'unauthenticated')];
    rt.app.fire('frActionForm', 'submit'); await flush();
    check(rt.state() !== 'AUTHENTICATED' && rt.rq().list === null && rt.rq().detail === null && !rt.rq().open, 'F. a 401 ends the session and clears the Finance Requests data');
  }

  /* ---------- G. pay and cancel ---------- */
  {
    const rt = await openCeo();
    await openRow(rt, 2, PR_APP);
    let html = card(rt);
    check(/id="frPayBtn"/.test(html) && /id="frCancelBtn"/.test(html) && !/id="frApproveBtn"|id="frEditBtn"/.test(html) && /Approved, not paid: the amount is committed but not yet an expense/.test(html),
      'G. an Approved request offers Record payment and Cancel, and says it is committed, not yet an expense');
    rt.app.fire('frPayBtn', 'click');
    const key = rt.rq().action.key;
    html = card(rt);
    check(HEX32.test(key) && rt.rq().action.paidOn === '2031-04-15' && /id="frPaidOn"[^>]*value="2031-04-15"/.test(html) && /<option value="bankTransfer">Bank transfer<\/option>/.test(html)
      && rt.dom.focused[rt.dom.focused.length - 1] === 'frPaidOn',
      'G. Record payment opens the panel: today as the payment date, the six methods, a 32-hex key made once, focus on the date');
    rt.app.fire('frActionForm', 'submit'); await flush();
    check(writes(rt).length === 0 && rt.rq().mutation.fields.join() === 'paymentMethod', 'G. without a method nothing is sent');
    rt.app.type('frMethod', 'bankTransfer'); rt.app.type('frPaidOn', '2031-04-16');
    rt.app.fire('frActionForm', 'submit'); await flush();
    check(writes(rt).length === 0 && rt.rq().mutation.fields.join() === 'paidOn', 'G. a payment date after today is refused before sending');
    rt.app.type('frPaidOn', '2031-04-14');
    const PAID = Object.assign({}, PR_APP, { status: 'Paid', version: 4, payment: Object.assign({}, PAYMENT, { paidOn: '2031-04-14' }) });
    let release;
    rt.net.routes[W.pay] = [() => new Promise((r) => { release = r; }), one(PAID)];
    rt.SessionRequests.confirmAction(); rt.SessionRequests.confirmAction(); rt.app.fire('frActionForm', 'submit');
    await flush(4);
    check(posts(rt, W.pay).length === 1 && rt.rq().mutation.status === 'pending' && /id="frActionConfirm"[^>]*disabled/.test(card(rt)) && /Recording payment…/.test(card(rt)),
      'G. while a payment is in flight a second confirm sends nothing; the button is disabled and says "Recording payment…"');
    release(NETFAIL()); await flush();
    const p1 = posts(rt, W.pay);
    check(JSON.stringify(bodyOf(p1[0])) === JSON.stringify({ financeRequestId: PR_APP.id, expectedVersion: 3, expectedAmount: '750000.00', paidOn: '2031-04-14', paymentMethod: 'bankTransfer', idempotencyKey: key }),
      'G. Record payment sends exactly { financeRequestId, expectedVersion, expectedAmount, paidOn, paymentMethod, idempotencyKey }');
    check(rt.rq().mutation.status === 'ambiguous' && rt.rq().action && rt.rq().action.key === key && /may already be recorded/.test(card(rt)) && rt.rq().detail.status === 'Approved',
      'G. a lost answer is ambiguous — never shown as paid; the panel keeps its key');
    rt.net.routes[ONE(PR_APP.id)] = [one(PAID)];
    rt.app.fire('frActionForm', 'submit'); await flush();
    const p2 = posts(rt, W.pay);
    html = card(rt);
    check(p2.length === 2 && JSON.stringify(bodyOf(p2[1])) === JSON.stringify(bodyOf(p2[0])) && /Paid\. The expense has been recorded/.test(html)
      && /<dt>Paid on<\/dt><dd>2031-04-14<\/dd><dt>Payment method<\/dt><dd>Bank transfer<\/dd>/.test(html) && !/id="frOps"/.test(html),
      'G. the deliberate resubmit replays the same payment under the same key; the Paid request shows the date and method and offers nothing');
    firewall(rt, 'G');
  }
  {
    const rt = await openCeo();
    await openRow(rt, 2, PR_APP);
    rt.app.fire('frPayBtn', 'click'); rt.app.type('frMethod', 'cash');
    rt.net.routes[W.pay] = [one(Object.assign({}, PR_APP, { status: 'Paid', version: 4, amount: '760000.00', payment: Object.assign({}, PAYMENT, { paidOn: '2031-04-15', paymentMethod: 'cash' }) }))];
    rt.app.fire('frActionForm', 'submit'); await flush();
    check(rt.rq().mutation.status === 'ambiguous' && !/Paid\. The expense/.test(card(rt)), 'G. a Paid answer of another amount does not confirm the payment');
  }
  {
    const rt = await openCeo();
    await openRow(rt, 2, PR_APP);
    rt.app.fire('frPayBtn', 'click'); rt.app.type('frMethod', 'cash');
    rt.net.routes[W.pay] = [err(409, 'conflict')];
    rt.net.routes[ONE(PR_APP.id)] = [one(Object.assign({}, PR_APP, { status: 'Cancelled', version: 4, statusReason: 'Fabricated elsewhere' }))];
    rt.app.fire('frActionForm', 'submit'); await flush();
    check(posts(rt, W.pay).length === 1 && rt.rq().action === null && rt.rq().detail.status === 'Cancelled' && !/id="frPayBtn"/.test(card(rt)),
      'G. a payment refused as 409 (cancelled elsewhere) re-reads the request: Cancelled, nothing to pay, never resent');
  }
  {
    const rt = await openCeo();
    await openRow(rt, 2, PR_APP);
    rt.app.fire('frCancelBtn', 'click'); rt.app.type('frReason', 'Fabricated no longer needed');
    const C = Object.assign({}, PR_APP, { status: 'Cancelled', version: 4, statusReason: 'Fabricated no longer needed' });
    rt.net.routes[W.cancel] = [one(C)]; rt.net.routes[ONE(PR_APP.id)] = [one(C)];
    rt.app.fire('frActionForm', 'submit'); await flush();
    const c = posts(rt, W.cancel);
    check(c.length === 1 && JSON.stringify(bodyOf(c[0])) === JSON.stringify({ financeRequestId: PR_APP.id, expectedVersion: 3, reason: 'Fabricated no longer needed' })
      && /Reason for cancellation<\/dt><dd>Fabricated no longer needed/.test(card(rt)), 'G. Cancel sends { financeRequestId, expectedVersion, reason } and shows the reason');
  }
  {
    const rt = await openCeo();
    await openRow(rt, 3, RB_PAID);
    rt.SessionRequests.openAction('pay'); rt.SessionRequests.openAction('cancel'); rt.SessionRequests.openEdit(); rt.SessionRequests.confirmAction(); await flush();
    check(writes(rt).length === 0 && rt.rq().action === null && rt.rq().form === null, 'G. a Paid request accepts no operation, even called directly');
  }

  /* ---------- H. the Employee ---------- */
  {
    const rt = await openEmp();
    let html = card(rt);
    check(rt.loc.hash === '#/reimbursements' && /<h1 class="auth-title" id="authTitle" tabindex="-1">My reimbursements<\/h1>/.test(html) && rt.net.calls.filter((c) => c.url === YEAR).length === 1
      && !rt.net.calls.some((c) => /^\/api\/employees|^\/api\/audit-events/.test(c.url)),
      'H. an Employee\'s "My reimbursements" (#/reimbursements) reads the list once — never the employee list or any history');
    check((html.match(/<tr><td>\d{4}/g) || []).length === 3 && /<td>Reimbursement<\/td><td>You<\/td>/.test(html) && /New reimbursement/.test(html), 'H. their reimbursements, each "for You", and "New reimbursement"');
    await openRow(rt, 0, RB_PAID);
    html = card(rt);
    check(!/id="frOps"/.test(html) && /<dt>Paid on<\/dt><dd>2031-04-12<\/dd>/.test(html) && !/id="frHistory"|>Activity</.test(html) && rt.net.calls.filter((c) => /^\/api\/audit-events/.test(c.url)).length === 0,
      'H. a Paid reimbursement shows its payment and no control or history');
    rt.SessionRequests.openAction('approve'); rt.SessionRequests.openAction('pay'); rt.SessionRequests.openAction('cancel'); rt.SessionRequests.openAction('reject'); rt.SessionRequests.confirmAction(); await flush();
    check(writes(rt).length === 0 && rt.rq().action === null, 'H. forged CEO operations (approve, pay, cancel, reject) open nothing and send nothing');
    rt.app.fire('frBackBtn', 'click');
    await openRow(rt, 1, RB_REJ);
    check(/Reason for rejection<\/dt><dd>Fabricated &lt;no receipt&gt;/.test(card(rt)) && !/id="frOps"/.test(card(rt)), 'H. a Rejected reimbursement shows the escaped reason and no control');
    rt.app.fire('frBackBtn', 'click');
    await openRow(rt, 2, RB_DRAFT);
    html = card(rt);
    check(/id="frEditBtn"/.test(html) && /id="frSubmitBtn"/.test(html) && !/id="frCancelBtn"|id="frApproveBtn"|id="frRejectBtn"|id="frPayBtn"/.test(html),
      'H. their own Draft offers Edit and Submit only — no Cancel, Approve, Reject or Pay');
    rt.app.fire('frSubmitBtn', 'click');
    const SUB = Object.assign({}, RB_DRAFT, { status: 'Submitted', version: 2 });
    rt.net.routes[W.submit] = [one(SUB)]; rt.net.routes[ONE(RB_DRAFT.id)] = [one(SUB)];
    rt.app.fire('frActionForm', 'submit'); await flush();
    check(JSON.stringify(bodyOf(posts(rt, W.submit)[0])) === JSON.stringify({ financeRequestId: RB_DRAFT.id, expectedVersion: 1 }) && /Submitted for approval/.test(card(rt)) && !/id="frOps"/.test(card(rt)),
      'H. the Employee submits their Draft with { financeRequestId, expectedVersion }; Submitted, it offers them nothing');
    firewall(rt, 'H');
  }
  {
    const rt = await openEmp();
    rt.app.fire('frNewBtn', 'click');
    let html = card(rt);
    check(rt.rq().form.kind === 'reimbursement' && !/id="frf-payee"/.test(html) && /Expense date/.test(html), 'H. "New reimbursement" has no payee field and an expense date');
    rt.app.type('frf-financialPost', 'NPIP'); rt.app.type('frf-category', 'Transport'); rt.app.type('frf-description', 'Fabricated bus'); rt.app.type('frf-amount', '45000.00'); rt.app.type('frf-documentDate', '2031-04-16');
    rt.app.fire('frForm', 'submit'); await flush();
    check(writes(rt).length === 0 && rt.rq().mutation.fields.join() === 'documentDate', 'H. an expense date after today is refused before sending');
    rt.app.type('frf-documentDate', '2031-04-14');
    const NEW = rb('8'.repeat(32), { financialPost: 'NPIP', description: 'Fabricated bus', amount: '45000.00', documentDate: '2031-04-14' });
    rt.net.routes[W.create] = [one(NEW)]; rt.net.routes[ONE(NEW.id)] = [one(NEW)];
    rt.app.fire('frForm', 'submit'); await flush();
    const c = posts(rt, W.create);
    check(c.length === 1 && keysOf(c[0]) === 'amount,category,description,documentDate,financialPost,idempotencyKey,kind' && bodyOf(c[0]).kind === 'reimbursement',
      'H. the reimbursement body is exactly the seven keys — no payee, no employeeId (the server takes the owner from the session)');
    check(/Draft saved/.test(card(rt)) && rt.rq().detailId === NEW.id, 'H. the new Draft opens');
  }
  {
    const rt = await openEmp();
    const forged = Object.assign({}, RB_DRAFT, { employeeId: 'emp_other_2' });
    await openRow(rt, 2, forged);
    check(!/id="frOps"/.test(card(rt)), 'H. a reimbursement of another employee (were the server ever to return one) offers no control');
  }

  /* ---------- I. Approved-not-paid on Home ---------- */
  {
    const rt = await boot(ME_CEO, { [REP_APRIL]: [ok(REPORT(ANP))] }, '#/home');
    const html = card(rt);
    check(/<dt>Income \(Rp\)<\/dt><dd>12000000\.00<\/dd><dt>Expenses \(Rp\)<\/dt><dd>2500000\.00<\/dd><dt>Net \(Rp\)<\/dt><dd>9500000\.00<\/dd>/.test(html),
      'I. CEO Home keeps income, expenses and net exactly as reported');
    check(/id="swhApprovedNotPaid"><dt>Approved, not paid \(Rp\)<\/dt><dd>1750000\.00<\/dd><dt>Requests waiting for payment<\/dt><dd>3<\/dd>/.test(html)
      && /not counted in the expenses or the net above/.test(html) && /data-sw-go="requests"|Finance Requests/.test(html),
      'I. Home shows the Approved-not-paid amount (exact Rupiah string) and count apart, never in the expenses or net, with a Finance Requests shortcut');
    check(/<data class="ux-money" value="1750000\.00">1\.750\.000,00<\/data>/.test(shellContent(rt)), 'I. the amount keeps full Rupiah precision in <data value>, grouped for display only');
    firewall(rt, 'I');
  }
  {
    const rt = await boot(ME_CEO, { [REP_APRIL]: [ok(REPORT(ANP_ZERO))] }, '#/home');
    check(/id="swhApprovedNotPaid"><dt>Approved, not paid \(Rp\)<\/dt><dd>0\.00<\/dd><dt>Requests waiting for payment<\/dt><dd>0<\/dd>/.test(card(rt)) && /No approved request is waiting for payment this month/.test(card(rt)),
      'I. zero Approved-not-paid shows 0.00 and 0 with a plain message');
  }
  {
    const rt = await boot(ME_EMP, {}, '#/home');
    check(/id="swhReimbursementsTitle">My reimbursements</.test(card(rt)) &&!/swhApprovedNotPaid/.test(card(rt)) && !rt.net.calls.some((c) => /^\/api\/reports/.test(c.url)),
      'I. Employee Home has a My reimbursements card and never the company figure or the report');
  }

  /* ---------- J. clearing ---------- */
  {
    const rt = await openCeo();
    await openRow(rt, 0, PR_DRAFT);
    const gen = rt.rq().generation;
    rt.AuthBoot.sessionLost(); await flush();
    check(rt.rq().generation > gen && rt.rq().list === null && rt.rq().detail === null && rt.rq().employees === null && !/Fabricated/.test(rt.appHTML()),
      'J. losing the session destroys the Finance Requests data and nothing of it stays on the page');
    firewall(rt, 'J');
  }

  /* ---------- K. I4-F01: the detail and history reads keep their own errors ---------- */
  // Each read is held by a gate and released in the order named, so the completion order is proven,
  // not assumed. A read error is retried only by the Retry shown with it, and a retry is a read.
  const gate = () => { let release; const p = new Promise((r) => { release = r; }); return { route: () => p, release: (v) => release(v) }; };
  // Unavailable, without a request reference (a 32-hex reference would trip the firewall's opaque-id rule).
  const DOWN = () => resp(503, { ok: false, error: { code: 'unavailable', message: 'server text' } });
  const errs = (rt) => rt.rq().errors || {};
  const calls = (rt, u) => rt.net.calls.filter((c) => c.url === u).length;
  const retryOf = (rt) => { const m = /<button[^>]*id="frRetryBtn"[^>]*>/.exec(card(rt)); return m ? ((/data-fr-retry="([a-z]+)"/.exec(m[0]) || [])[1] || 'unnamed') : null; };
  const LOADING_DETAIL = /Loading the request…/;
  // The CEO opens PR_SUB (row 1) with its detail and history reads held.
  async function openHeld(){
    const rt = await openCeo();
    const d = gate(), h = gate();
    rt.net.routes[ONE(PR_SUB.id)] = [d.route]; rt.net.routes[HIST(PR_SUB.id)] = [h.route];
    rt.app.openRow(1); await flush();
    return { rt: rt, d: d, h: h };
  }
  {
    const { rt, d, h } = await openHeld();
    check(rt.rq().detailStatus === 'loading' && rt.rq().historyStatus === 'loading' && LOADING_DETAIL.test(card(rt)), 'K. F01-A: both reads are in flight together');
    d.release(DOWN()); await flush();
    h.release(DOWN()); await flush();
    const s = rt.rq();
    const html = card(rt);
    check(s.detailStatus === 'error' && s.historyStatus === 'error' && s.errors && (s.errors || {}).detail && (s.errors || {}).detail.kind === 'UNAVAILABLE' && (s.errors || {}).history && (s.errors || {}).history.kind === 'UNAVAILABLE',
      'K. F01-A: detail fails, then history fails — both stay ERROR and each keeps its own error');
    check(/id="frReadError"[^>]*>The finance requests could not be loaded\. Check your connection/.test(html) && !LOADING_DETAIL.test(html) && /id="frRetryBtn"/.test(html)
      && !/id="frOps"|id="frDetail"/.test(html) && /id="frBackBtn"/.test(html),
      'K. F01-A: the detail error is shown with a Retry and Back to the list — never a permanent "Loading the request…", no operation offered');
    check(retryOf(rt) === 'detail', 'K. F01-A: the Retry shown names the detail read');
    const one0 = calls(rt, ONE(PR_SUB.id)), hist0 = calls(rt, HIST(PR_SUB.id));
    rt.net.routes[ONE(PR_SUB.id)] = [one(PR_SUB)]; rt.net.routes[HIST(PR_SUB.id)] = [DOWN()];
    rt.app.fire('frRetryBtn', 'click'); await flush();
    check(calls(rt, ONE(PR_SUB.id)) === one0 + 1 && calls(rt, HIST(PR_SUB.id)) === hist0 && rt.rq().detailStatus === 'ready' && /id="frDetail"/.test(card(rt)),
      'K. F01-A: Retry reads the detail — once — and not the history');
    firewall(rt, 'K. F01-A');
  }
  {
    const { rt, d, h } = await openHeld();
    h.release(DOWN()); await flush();
    d.release(err(500, 'server_error')); await flush();
    const s = rt.rq();
    const html = card(rt);
    check(s.detailStatus === 'error' && s.errors && (s.errors || {}).detail && (s.errors || {}).detail.kind === 'SERVER_ERROR' && (s.errors || {}).history && (s.errors || {}).history.kind === 'UNAVAILABLE',
      'K. F01-B: history fails, then detail fails — neither error overwrites the other');
    check(/id="frReadError"/.test(html) && !LOADING_DETAIL.test(html) && !/id="frOps"/.test(html) && retryOf(rt) === 'detail',
      'K. F01-B: the detail error and its Retry are shown, never a false loading state');
  }
  {
    const { rt, d, h } = await openHeld();
    d.release(one(PR_SUB)); await flush();
    h.release(DOWN()); await flush();
    const detail = rt.rq().detail;
    let html = card(rt);
    check(rt.rq().detailStatus === 'ready' && rt.rq().errors && errs(rt).detail === null && errs(rt).history && /id="frDetail"/.test(html) && /id="frApproveBtn"/.test(html)
      && /id="frHistoryError"/.test(html) && !/id="frReadError"/.test(html) && retryOf(rt) === 'history',
      'K. F01-C: detail succeeds, history fails — the detail stays with its operations; the history error has its own Retry');
    const one0 = calls(rt, ONE(PR_SUB.id)), hist0 = calls(rt, HIST(PR_SUB.id)), list0 = calls(rt, YEAR);
    rt.net.routes[HIST(PR_SUB.id)] = [ok(HISTORY)];
    rt.app.fire('frRetryBtn', 'click'); await flush();
    html = card(rt);
    check(calls(rt, HIST(PR_SUB.id)) === hist0 + 1 && calls(rt, ONE(PR_SUB.id)) === one0 && calls(rt, YEAR) === list0 && rt.rq().detail === detail
      && /id="frHistory"/.test(html) && !/id="frHistoryError"/.test(html) && errs(rt).history === null && writes(rt).length === 0,
      'K. F01-C: the history Retry reads only the history; the detail shown is kept as it was');
  }
  {
    const { rt, d, h } = await openHeld();
    d.release(DOWN()); await flush();
    h.release(ok(HISTORY)); await flush();
    const html = card(rt);
    check(rt.rq().detailStatus === 'error' && rt.rq().historyStatus === 'ready' && rt.rq().errors && errs(rt).detail && errs(rt).history === null
      && /id="frReadError"/.test(html) && retryOf(rt) === 'detail' && !LOADING_DETAIL.test(html) && !/id="frOps"|id="frApproveBtn"|id="frPayBtn"/.test(html),
      'K. F01-D: detail fails, history succeeds — the history does not hide the detail failure; detail Retry, no operation');
  }
  {
    const { rt, d, h } = await openHeld();
    d.release(DOWN()); await flush();
    h.release(DOWN()); await flush();
    rt.net.routes[ONE(PR_SUB.id)] = [one(PR_SUB)];
    rt.app.fire('frRetryBtn', 'click'); await flush();
    let html = card(rt);
    check(rt.rq().detailStatus === 'ready' && /id="frDetail"/.test(html) && rt.rq().historyStatus === 'error' && errs(rt).history && /id="frHistoryError"/.test(html) && retryOf(rt) === 'history',
      'K. F01-E: after both fail, a detail Retry shows the request while the history failure stays, with its own Retry');
    rt.net.routes[HIST(PR_SUB.id)] = [ok(HISTORY)];
    rt.app.fire('frRetryBtn', 'click'); await flush();
    html = card(rt);
    check(/id="frHistory"/.test(html) && !/id="frHistoryError"|id="frReadError"/.test(html) && errs(rt).detail === null && errs(rt).history === null && writes(rt).length === 0,
      'K. F01-E: the history Retry then succeeds; no error is left and nothing was written');
    firewall(rt, 'K. F01-E');
  }
  {
    // Closing the request while its reads are in flight: their late failures are dropped.
    const { rt, d, h } = await openHeld();
    rt.app.fire('frBackBtn', 'click'); await flush();
    d.release(DOWN()); h.release(DOWN()); await flush();
    let s = rt.rq();
    check(s.detailId === null && s.detailStatus === 'idle' && s.errors && (s.errors || {}).detail === null && (s.errors || {}).history === null && (s.errors || {}).list === null && /id="frList"/.test(card(rt)),
      'K. F01-F: late failures of a closed request are dropped — the list shows, no error kept');
    // A failed request, then another opened: the old errors do not follow.
    const d2 = gate(), h2 = gate();
    rt.net.routes[ONE(PR_SUB.id)] = [d2.route]; rt.net.routes[HIST(PR_SUB.id)] = [h2.route];
    rt.app.openRow(1); await flush();
    d2.release(DOWN()); h2.release(DOWN()); await flush();
    rt.app.fire('frBackBtn', 'click'); await flush();
    check(errs(rt).detail === null && errs(rt).history === null, 'K. F01-F: Back discards the closed request\'s errors');
    await openRow(rt, 2, PR_APP);
    s = rt.rq();
    check(s.detailId === PR_APP.id && s.detailStatus === 'ready' && (s.errors || {}).detail === null && (s.errors || {}).history === null && /id="frDetail"/.test(card(rt)) && !/id="frReadError"|id="frHistoryError"/.test(card(rt)),
      'K. F01-F: the next request opened shows no error of the one before');
    // Another request opened while the first one's reads are in flight: their late answers are dropped.
    const d3 = gate(), h3 = gate();
    rt.app.fire('frBackBtn', 'click');
    rt.net.routes[ONE(PR_SUB.id)] = [d3.route]; rt.net.routes[HIST(PR_SUB.id)] = [h3.route];
    rt.app.openRow(1); await flush();
    rt.app.fire('frBackBtn', 'click');
    await openRow(rt, 2, PR_APP);
    d3.release(DOWN()); h3.release(DOWN()); await flush();
    s = rt.rq();
    check(s.detailId === PR_APP.id && s.detailStatus === 'ready' && s.historyStatus === 'ready' && (s.errors || {}).detail === null && (s.errors || {}).history === null && !/id="frReadError"|id="frHistoryError"/.test(card(rt)),
      'K. F01-F: late failures of a request left for another are dropped');
  }
  {
    // The session ends while the reads are in flight.
    const { rt, d, h } = await openHeld();
    const gen = rt.rq().generation;
    rt.AuthBoot.sessionLost(); await flush();
    d.release(DOWN()); h.release(DOWN()); await flush();
    const s = rt.rq();
    check(s.generation > gen && s.detailId === null && s.errors && (s.errors || {}).detail === null && (s.errors || {}).history === null && (s.errors || {}).list === null && !/Fabricated|frReadError|frHistoryError/.test(rt.appHTML()),
      'K. F01-F: after the session ends, late failures are dropped and no request error is kept');
  }
  {
    // Another principal: the data and every error are destroyed; late answers of the first are dropped.
    const { rt, d, h } = await openHeld();
    d.release(DOWN()); await flush();
    const gen = rt.rq().generation;
    const other = Object.assign({}, rt.AuthBoot.snapshot().principal, { id: 'u_other_9' });
    check(rt.SessionRequestsStore.bindPrincipal(other) === true, 'K. F01-F: a different principal rebinds the store');
    h.release(DOWN()); await flush();
    const s = rt.rq();
    check(s.generation > gen && s.detailId === null && s.list === null && s.errors && (s.errors || {}).detail === null && (s.errors || {}).history === null && (s.errors || {}).list === null,
      'K. F01-F: a principal change clears every request error; a late failure of the first principal is dropped');
  }

  console.log('');
  if(failures.length){
    console.log('I4 FINANCE REQUESTS RUNTIME FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
    failures.forEach((f) => console.log('   - ' + f));
    process.exit(1);
  }
  console.log('I4 FINANCE REQUESTS RUNTIME PASSED -- ' + passed + ' checks OK.');
})().catch((e) => { console.error(e); process.exit(1); });
