#!/usr/bin/env node
'use strict';
/* ============================================================
   Phase 1 — SESSION FINANCE (LEDGER) RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of the Phase 1 frontend. This harness proves its
   BEHAVIOUR by executing every production module (module-order.js, the boot included) in the
   dependency-free Node `vm` loader of the other SESSION harnesses, with the ONE source line
   `const AUTH_MODE = AUTH_MODES.SESSION;` loaded as SESSION in the concatenated text — the
   committed value is untouched.

   DETERMINISTIC: fetch is a stub answering by URL from a script; `Date` with no argument is a fixed
   instant (2031-04-15T12:00:00Z: 2031-04-15 in Asia/Jakarta). No real network, no wall clock, no
   credentials, no production backend. localStorage / sessionStorage / cookies / history are
   instrumented, and the LOCAL boot, shell, Transactions, Dashboard and other renderers are
   recording spies that must never be called. Every identity, id and amount here is fabricated.

   Proven (D-INT-1, D-INT-2): the CEO-only Finance section (an Employee has no item and sends no
   request, whatever is called); the current company month as the default range; the dashboard —
   the four Financial Posts in order, the separate Payroll line and the consolidated total, every
   amount the exact server string; strict decoding of the report and the history; the date range
   (an invalid range is never sent); Record transaction (exactly the seven body keys, a 32-hex key,
   CSRF, a payroll category refused before sending, a resubmit after an ambiguous answer reusing
   the same key); Void (exactly the three body keys, Active rows only); a 401 ends the session; no
   storage, URL or LOCAL reach.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parseSessionShell } = require('./session-shell-chrome.js');

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
const tx = (id, date, extra) => Object.assign({ id: id, kind: 'expense', financialPost: 'GA', category: 'Operasional Rutin', description: 'Fabricated <b>rent</b>',
  amount: '2500000.00', transactionDate: date, createdByUserId: U, createdAt: '2031-04-02T01:00:00.000000Z', status: 'Active', void: null }, extra || {});
const T1 = tx('1'.repeat(32), '2031-04-02');
const T2 = tx('2'.repeat(32), '2031-04-10', { kind: 'income', financialPost: 'DRONE', category: 'Jasa Survey', description: 'Fabricated survey', amount: '12000000.00' });
const T3 = tx('3'.repeat(32), '2031-04-11', { status: 'Voided', void: { reason: 'Fabricated duplicate', voidedByUserId: U, voidedAt: '2031-04-11T02:00:00.000000Z' } });
const LIST = { generalTransactions: [T1, T2, T3] };
const post = (code, name, income, expense, net, count) => ({ code: code, name: name, income: income, expense: expense, net: net, count: count });
const REPORT = { financialReport: { from: '2031-04-01', to: '2031-04-30',
  posts: [post('GA', 'GA', '0.00', '2500000.00', '-2500000.00', 1), post('NPIP', 'NP & IP', '0.00', '0.00', '0.00', 0), post('TJB', 'TJB', '0.00', '0.00', '0.00', 0), post('DRONE', 'Drone', '12000000.00', '0.00', '12000000.00', 1)],
  general: { income: '12000000.00', expense: '2500000.00', net: '9500000.00', count: 2 }, voided: { count: 1, amount: '2500000.00' },
  payroll: { posted: { amount: '7021875.00', count: 3, fromMonth: '2031-04', toMonth: '2031-04' }, paid: { amount: '3500000.00', count: 1 } },
  consolidated: { income: '12000000.00', expense: '6000000.00', net: '6000000.00' } } };
const RANGE = (f, t) => '/api/general-transactions?from=' + f + '&to=' + t;
const REP = (f, t) => '/api/reports/financial?from=' + f + '&to=' + t;
const APRIL = ['2031-04-01', '2031-04-30'];
const EMPS = '/api/employees';

/* ---------- scripted responses ---------- */
function resp(status, body){
  const lower = { 'content-type': 'application/json; charset=utf-8' };
  return { status: status, headers: { get: (n) => lower[String(n).toLowerCase()] === undefined ? null : lower[String(n).toLowerCase()] },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}
const ok = (data) => resp(200, { ok: true, data: data, requestId: RID });
const err = (status, code) => resp(status, { ok: false, error: { code: code, message: 'server text' }, requestId: RID });
const NETFAIL = () => new TypeError('Failed to fetch');

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
      // As a browser reports them: an input's value attribute, a select's selected option, a textarea's text.
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
  // Typing into a field (input listeners), then a value the form reads on submit.
  app.type = (id, value) => { const el = find('#' + id); if(!el || el.disabled) return false; el.value = value; (el.listeners.input || []).forEach((fn) => fn.call(el, {})); (el.listeners.change || []).forEach((fn) => fn.call(el, {})); return true; };
  app.voidRow = (i) => app.fire('sfList', 'click', { target: { closest: (sel) => sel === '[data-sf-void]' ? { getAttribute: () => String(i) } : null } });
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
    + '\n;window.__TAM__ = { State: State, AuthBoot: AuthBoot, TransactionApi: TransactionApi, TransactionDecoders: TransactionDecoders, TransactionRequests: TransactionRequests,'
    + ' FINANCIAL_POSTS: FINANCIAL_POSTS, transactionMonthRange: transactionMonthRange, transactionIsRange: transactionIsRange,'
    + ' SessionLedgerStore: SessionLedgerStore, SessionLedger: SessionLedger, sessionNavModel: sessionNavModel, render: render, parse: function(j){ return JSON.parse(j); } };';
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
  const sandbox = {
    __spy: [], __spyErr: [], Date: FixedDate, crypto: require('crypto').webcrypto,
    console: { log:noop, warn:noop, error:noop, info:noop }, navigator: { userAgent:'tam-phase1' },
    setTimeout: function(fn, ms){ if(ms === 10000) return 'api-timer'; return setTimeout(fn, ms); },
    clearTimeout: function(id){ if(id !== 'api-timer') clearTimeout(id); },
    requestAnimationFrame: (fn) => setTimeout(fn, 0), AbortController: AbortController, fetch: fetchStub,
    localStorage: storageOf(access.local), sessionStorage: storageOf(access.session),
    addEventListener: noop, removeEventListener: noop, confirm: () => { access.url.push('confirm()'); return true; },
    location: { hash: '', search: '', pathname: '/', href: 'http://127.0.0.1/' },
    history: { replaceState: (a, b, u) => { access.url.push(String(u)); }, pushState: (a, b, u) => { access.url.push(String(u)); } },
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }), getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: document
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-phase1-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.net = net; rt.access = access; rt.spy = sandbox.__spy; rt.spyErr = sandbox.__spyErr;
  rt.appHTML = () => els.app.innerHTML; rt.app = els.app; rt.dom = dom; rt.loc = sandbox.location;
  rt.sf = () => rt.SessionLedgerStore.snapshot();
  rt.state = () => rt.AuthBoot.snapshot().state;
  return rt;
}
const flush = async (n) => { for(let i = 0; i < (n || 12); i++) await new Promise((r) => setImmediate(r)); };
const ledgerCalls = (rt) => rt.net.calls.filter((c) => /^\/api\/(general-transactions|reports)/.test(c.url));
const posts = (rt, path) => rt.net.calls.filter((c) => c.url === path && c.init && c.init.method === 'POST');
const card = (rt) => { const s = parseSessionShell(rt.appHTML()); return s ? s.content : rt.appHTML(); };
const SELF = { id: 'emp_srv_1', employeeCode: 'EMP-777', fullName: 'Fabricated Self', jobTitle: null, department: null, employmentStatus: 'Active',
  joinDate: null, contactEmail: null, phone: null, monthlyBaseSalary: '1000000.00' };
async function boot(me, routes){
  const base = me.role === 'ceo' ? { [EMPS]: [ok({ employees: [] })] } : { '/api/employee?id=emp_srv_1': [ok({ employee: SELF })] };
  const rt = loadRuntime(Object.assign({ '/api/auth/me': [ok(me)] }, base, routes || {}));
  await flush();
  return rt;
}
async function open(routes){
  const rt = await boot(ME_CEO, Object.assign({ [REP(...APRIL)]: [ok(REPORT)], [RANGE(...APRIL)]: [ok(LIST)] }, routes || {}));
  rt.app.fire('swSectionFinance', 'click'); await flush();
  return rt;
}
function firewall(rt, label){
  check(rt.access.local.length === 0 && rt.access.session.length === 0 && rt.access.cookie.length === 0 && rt.access.url.length === 0 && rt.loc.hash === '' && rt.loc.search === '',
    label + ': zero localStorage / sessionStorage / cookie / address-bar access');
  check(rt.spy.length === 0 && rt.spyErr.length === 0 && rt.State.txns.length === 0, label + ': no LOCAL boot, shell, Transactions, Dashboard or other domain was called; LOCAL State.txns stays empty' + (rt.spy.length ? ' >> ' + rt.spy.join(', ') : ''));
  check(!/<script|\son[a-z]+=|style="|Acting as|data-nav=/i.test(card(rt)), label + ': the card carries no script, inline handler, inline style, "Acting as" or LOCAL navigation');
  check(ledgerCalls(rt).every((c) => c.init.credentials === 'same-origin' && c.init.cache === 'no-store'
    && (c.init.method === 'GET' ? c.init.body === undefined && !c.init.headers['X-CSRF-Token'] && /\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/.test(c.url)
      : c.init.method === 'POST' && c.init.headers['X-CSRF-Token'] === CSRF && !/\?/.test(c.url))),
    label + ': every read is a bodiless same-origin GET of exactly ?from=&to=; every write a same-origin POST with the CSRF token and no query');
}

(async function main(){
  console.log('== Phase 1 — SESSION FINANCE (LEDGER) RUNTIME VERIFICATION ==');

  /* ---------- A. who sees Finance ---------- */
  {
    const rt = await boot(ME_CEO);
    const html = rt.appHTML();
    check((parseSessionShell(html) || {}).role === 'ceo' && /id="swSectionPayroll"[\s\S]*id="swSectionFinance"[\s\S]*id="swSectionAudit"/.test(html) && ledgerCalls(rt).length === 0,
      'A. the CEO has a Finance item between Payroll and Audit; nothing is read before it is opened');
    firewall(rt, 'A. CEO');
  }
  {
    const rt = await boot(ME_EMP);
    check(!/swSectionFinance|>Finance</.test(rt.appHTML()), 'A. an Employee has no Finance item');
    rt.SessionLedger.show(true); rt.SessionLedger.setView('transactions'); rt.SessionLedger.applyRange(); rt.SessionLedger.openCreate(); rt.SessionLedger.submitCreate(); rt.SessionLedger.retry(); await flush();
    rt.SessionLedgerStore.setOpen(true, { from: APRIL[0], to: APRIL[1] }); rt.SessionLedger.ensureLoaded(rt.AuthBoot.snapshot().principal); await flush();
    rt.SessionLedgerStore.openForm('2031-04-15', 'f'.repeat(32)); rt.SessionLedger.submitCreate(); await flush();
    check(ledgerCalls(rt).length === 0, 'A. every SessionLedger entry point is a no-op for an Employee — even with a forged open store and form, nothing is read or written');
    firewall(rt, 'A. Employee');
  }

  /* ---------- B. the dashboard ---------- */
  {
    const rt = await open();
    const html = card(rt);
    check(rt.sf().open && rt.sf().view === 'dashboard' && rt.sf().range.from === '2031-04-01' && rt.sf().range.to === '2031-04-30'
      && rt.net.calls.filter((c) => c.url === REP(...APRIL)).length === 1 && ledgerCalls(rt).length === 1,
      'B. opening Finance reads exactly the report of the current Asia/Jakarta month (2031-04-01 to 2031-04-30), once');
    check((parseSessionShell(rt.appHTML()) || {}).active === 'finance' && /<h1 class="auth-title" id="authTitle" tabindex="-1">Finance<\/h1>/.test(html) && rt.dom.focused[rt.dom.focused.length - 1] === 'authTitle',
      'B. the Finance item is current, the heading is "Finance" and focus moves to it');
    const rows = (html.match(/<tr><th scope="row">[^<]*<\/th><td>[^<]*<\/td><td>[^<]*<\/td><td>[^<]*<\/td><td>[^<]*<\/td><\/tr>/g) || []);
    check(rows.length === 5 && /<th scope="row">GA<\/th><td>0\.00<\/td><td>2500000\.00<\/td><td>-2500000\.00<\/td><td>1<\/td>/.test(rows[0])
      && /<th scope="row">NP &amp; IP<\/th>/.test(rows[1]) && /<th scope="row">TJB<\/th>/.test(rows[2]) && /<th scope="row">Drone<\/th><td>12000000\.00<\/td>/.test(rows[3])
      && /<th scope="row">All Financial Posts<\/th><td>12000000\.00<\/td><td>2500000\.00<\/td><td>9500000\.00<\/td><td>2<\/td>/.test(rows[4]),
      'B. the four Financial Posts in order (GA, NP & IP, TJB, Drone) and their total, every amount the exact server string');
    check(/id="sfPayroll"[\s\S]*Posted for 2031-04<\/th><td>7021875\.00<\/td><td>3<\/td>[\s\S]*Paid in this range<\/th><td>3500000\.00<\/td><td>1<\/td>/.test(html)
      && !/<th scope="row">Payroll<\/th>/.test(html.split('id="sfPayroll"')[0]),
      'B. Payroll is its own table — posted and paid — never a Financial Post row');
    // PD-6 (Owner 2026-11-13): the consolidated metric is explicitly labelled cash basis; posted payroll stays separately visible.
    check(/<h3 class="section-title">Consolidated \(cash basis\)<\/h3><div class="table-wrap" id="sfConsolidated">/.test(html) && /Financial Posts and payroll paid \(cash basis\)<\/th>/.test(html)
      && /id="sfConsolidated"[\s\S]*<td>12000000\.00<\/td><td>6000000\.00<\/td><td>6000000\.00<\/td>/.test(html) && /Voided in this range: 1 \(Rp 2500000\.00\)/.test(html),
      'B. the consolidated total and the voided transactions are shown exactly as the server sent them');
    firewall(rt, 'B');
  }

  /* ---------- C. strict decoding ---------- */
  {
    const bad = JSON.parse(JSON.stringify(REPORT.financialReport));
    const variants = {
      'a fifth post': Object.assign({}, bad, { posts: bad.posts.concat([post('HR', 'HR', '0.00', '0.00', '0.00', 0)]) }),
      'posts out of order': Object.assign({}, bad, { posts: [bad.posts[1], bad.posts[0], bad.posts[2], bad.posts[3]] }),
      'a float amount': Object.assign({}, bad, { general: Object.assign({}, bad.general, { income: '12000000.5' }) }),
      'an extra key': Object.assign({}, bad, { companyId: 'x' }),
      'another range': Object.assign({}, bad, { to: '2031-04-29' }),
      'a payroll inside the posts': Object.assign({}, bad, { posts: bad.posts.map((p, i) => i === 0 ? Object.assign({}, p, { payroll: '1.00' }) : p) })
    };
    for(const [label, r] of Object.entries(variants)){
      const rt = await open({ [REP(...APRIL)]: [ok({ financialReport: r })] });
      check(rt.sf().report === null && /TAM OS sent an unexpected response/.test(card(rt)) && !/id="sfPosts"/.test(card(rt)), 'C. a report with ' + label + ' is refused whole: nothing of it is shown');
    }
    const rt = await boot(ME_CEO);
    // Fixtures cross into the page's realm as JSON, exactly as a fetched body does.
    const TX = { rangeResponse: (o, f, t) => rt.TransactionDecoders.rangeResponse(rt.parse(JSON.stringify(o)), f, t) };
    check(TX.rangeResponse(LIST, ...APRIL) !== null && TX.rangeResponse({ generalTransactions: [T2, T1] }, ...APRIL) === null
      && TX.rangeResponse({ generalTransactions: [tx('1'.repeat(32), '2031-05-01')] }, ...APRIL) === null
      && TX.rangeResponse({ generalTransactions: [Object.assign({}, T1, { financialPost: 'HR' })] }, ...APRIL) === null
      && TX.rangeResponse({ generalTransactions: [Object.assign({}, T1, { status: 'Voided' })] }, ...APRIL) === null
      && TX.rangeResponse({ generalTransactions: [Object.assign({}, T1, { companyId: 'x' })] }, ...APRIL) === null
      && TX.rangeResponse({ generalTransactions: [T1, T1] }, ...APRIL) === null,
      'C. the history decoder refuses out-of-order and out-of-range dates, an unknown post, a Voided row without its void, an extra key and a repeated id');
  }

  /* ---------- D. the history and the range ---------- */
  {
    const rt = await open();
    rt.app.fire('sfTransactionsTab', 'click'); await flush();
    const html = card(rt);
    check(rt.net.calls.filter((c) => c.url === RANGE(...APRIL)).length === 1 && /<h1 class="auth-title" id="authTitle" tabindex="-1">Transactions<\/h1>/.test(html) && /3 transactions, oldest first\./.test(html),
      'D. Transactions reads exactly the range of the month once and lists it oldest first');
    check(/Fabricated &lt;b&gt;rent&lt;\/b&gt;/.test(html) && !/<b>rent<\/b>/.test(html) && /<td>Drone<\/td>/.test(html) && /<td>Voided: Fabricated duplicate<\/td><td><\/td>/.test(html)
      && (html.match(/data-sf-void="\d+"/g) || []).join() === 'data-sf-void="0",data-sf-void="1"',
      'D. server text is escaped; the post shows its display name; a voided row shows its reason and has no Void button');
    const before = ledgerCalls(rt).length;
    rt.app.type('sfFrom', '2031-05-01'); rt.app.type('sfTo', '2031-04-01'); rt.app.fire('sfRangeForm', 'submit'); await flush();
    check(ledgerCalls(rt).length === before && /role="alert"[^>]*>Enter a From and a To date/.test(card(rt)), 'D. an inverted range is never sent; the view says so');
    rt.app.type('sfFrom', '2031-01-01'); rt.app.type('sfTo', '2032-01-02'); rt.app.fire('sfRangeForm', 'submit'); await flush();
    check(ledgerCalls(rt).length === before, 'D. a range above 366 days is never sent');
    rt.net.routes[RANGE('2031-04-10', '2031-04-11')] = [ok({ generalTransactions: [T2, T3] })];
    rt.app.type('sfFrom', '2031-04-10'); rt.app.type('sfTo', '2031-04-11'); rt.app.fire('sfRangeForm', 'submit'); await flush();
    check(rt.sf().range.from === '2031-04-10' && rt.net.calls.some((c) => c.url === RANGE('2031-04-10', '2031-04-11')) && /2 transactions/.test(card(rt)), 'D. Apply reads the new range from the server');
    firewall(rt, 'D');
  }

  /* ---------- E. Record transaction ---------- */
  {
    const CREATE = '/api/general-transactions/create';
    const made = tx('4'.repeat(32), '2031-04-15', { kind: 'income', financialPost: 'TJB', category: 'Sewa Alat', description: 'Fabricated rental', amount: '750000.00' });
    const rt = await open({ [CREATE]: [() => NETFAIL(), ok({ generalTransaction: made })] });
    rt.app.fire('sfTransactionsTab', 'click'); await flush();
    rt.app.fire('sfAddBtn', 'click'); await flush();
    check(!!rt.sf().form && /^[0-9a-f]{32}$/.test(rt.sf().form.key) && /id="sfForm"/.test(card(rt)) && rt.dom.focused[rt.dom.focused.length - 1] === 'sff-kind',
      'E. Record transaction opens an inline form with a 32-hex request key made once, focus on its first field');
    const fill = (values) => { for(const [k, v] of Object.entries(values)) rt.app.type('sff-' + k, v); };
    fill({ kind: 'income', financialPost: 'TJB', category: 'Gaji', description: 'Fabricated rental', amount: '750000.00', transactionDate: '2031-04-15' });
    rt.app.fire('sfForm', 'submit'); await flush();
    check(posts(rt, CREATE).length === 0 && /id="sff-category"[^>]*aria-invalid="true"/.test(card(rt)), 'E. a payroll category (Gaji) is refused before sending and its field is marked invalid');
    fill({ category: 'Sewa Alat' });
    const key = rt.sf().form.key;
    rt.app.fire('sfForm', 'submit'); await flush();
    const first = posts(rt, CREATE);
    const body1 = first.length ? JSON.parse(first[0].init.body) : {};
    check(first.length === 1 && Object.keys(body1).sort().join() === 'amount,category,description,financialPost,idempotencyKey,kind,transactionDate'
      && body1.idempotencyKey === key && body1.financialPost === 'TJB' && body1.amount === '750000.00' && rt.sf().mutation.status === 'ambiguous'
      && /It may already be recorded/.test(card(rt)) && !!rt.sf().form,
      'E. the write sends exactly the seven keys; a network failure is ambiguous — the form stays, nothing is resent automatically'
      + (first.length === 1 ? '' : ' >> ' + first.length + ' sent; ' + JSON.stringify(rt.sf().mutation)));
    rt.app.fire('sfForm', 'submit'); await flush();
    const second = posts(rt, CREATE);
    check(second.length === 2 && JSON.parse(second[1].init.body).idempotencyKey === key && rt.sf().form === null && /Transaction recorded\./.test(card(rt)),
      'E. a deliberate resubmit replays the SAME request key (recorded at most once) and succeeds');
    check(rt.net.calls.filter((c) => c.url === RANGE(...APRIL)).length === 2, 'E. after a recorded transaction the history is read again from the server (nothing optimistic)');
    firewall(rt, 'E');
  }

  /* ---------- F. Void ---------- */
  {
    const VOID = '/api/general-transactions/void';
    const voided = Object.assign({}, T1, { status: 'Voided', void: { reason: 'Fabricated mistake', voidedByUserId: U, voidedAt: '2031-04-15T03:00:00.000000Z' } });
    const rt = await open({ [VOID]: [ok({ generalTransaction: voided })] });
    rt.app.fire('sfTransactionsTab', 'click'); await flush();
    rt.app.voidRow(2); await flush();
    check(rt.sf().voidTarget === null, 'F. a voided row cannot be voided again (no panel)');
    rt.app.voidRow(0); await flush();
    check(!!rt.sf().voidTarget && rt.sf().voidTarget.transaction.id === T1.id && /id="sfVoidForm"/.test(card(rt)) && /It cannot be undone\./.test(card(rt)), 'F. Void opens an inline panel for that Active row, saying it cannot be undone');
    rt.app.fire('sfVoidForm', 'submit'); await flush();
    check(posts(rt, VOID).length === 0 && /id="sfVoidReason"[^>]*aria-invalid="true"/.test(card(rt)), 'F. an empty reason is refused before sending');
    rt.app.type('sfVoidReason', 'Fabricated mistake'); rt.app.fire('sfVoidForm', 'submit'); await flush();
    const sent = posts(rt, VOID);
    const body = sent.length ? JSON.parse(sent[0].init.body) : {};
    check(sent.length === 1 && Object.keys(body).sort().join() === 'financeTransactionId,idempotencyKey,reason' && body.financeTransactionId === T1.id && /^[0-9a-f]{32}$/.test(body.idempotencyKey)
      && rt.sf().voidTarget === null && /Transaction voided\./.test(card(rt)), 'F. the void sends exactly the three keys and, confirmed by a Voided answer, closes with its notice');
    firewall(rt, 'F');
  }

  /* ---------- H. the caps (PD-7, Owner 2026-11-13) ---------- */
  {
    const NARROW = /could not be loaded\. A date range with too many transactions cannot be shown in full: choose a shorter From and To range, then apply it\. If a short range also fails, try again later\./;
    const rt = await open({ [REP(...APRIL)]: [err(500, 'internal_error')] });
    check(rt.sf().report === null && NARROW.test(card(rt)) && !/id="sfPosts"|id="sfPayroll"|id="sfConsolidated"/.test(card(rt)) && /id="sfRetryBtn"/.test(card(rt)) && !/Try again in a moment/.test(card(rt)),
      'H. a report that fails closed (500) shows no partial total and tells the CEO to choose a shorter range');
    rt.net.routes[RANGE(...APRIL)] = [err(500, 'internal_error')];
    rt.app.fire('sfTransactionsTab', 'click'); await flush();
    check(NARROW.test(card(rt)) && !/data-sf-void=|transactions, oldest first/.test(card(rt)), 'H. a history that fails closed (500) lists nothing and tells the CEO to choose a shorter range');
    firewall(rt, 'H');
    const id = (n) => n.toString(16).padStart(32, '0');
    const rows = (n) => Array.from({ length: n }, (_, i) => tx(id(i + 1), '2031-04-10'));
    const TX = { rangeResponse: (o) => rt.TransactionDecoders.rangeResponse(rt.parse(JSON.stringify(o)), ...APRIL) };
    const full = TX.rangeResponse({ generalTransactions: rows(2000) });
    check(full !== null && full.length === 2000 && TX.rangeResponse({ generalTransactions: rows(2001) }) === null,
      'H. the history decoder accepts exactly 2,000 rows and refuses 2,001 whole (never a truncated list)');
  }

  /* ---------- G. session end ---------- */
  {
    const rt = await open({ [REP(...APRIL)]: [err(401, 'unauthenticated')], '/api/auth/me': [ok(ME_CEO)] });
    check(rt.state() === 'SIGNED_OUT' && rt.sf().open === false && rt.sf().report === null && !parseSessionShell(rt.appHTML()), 'G. a 401 ends the session: SIGNED_OUT, the Finance data destroyed, no shell');
    firewall(rt, 'G');
  }

  console.log('');
  if(failures.length){
    console.log('PHASE 1 SESSION FINANCE RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach((f) => console.log('   - ' + f));
    process.exit(1);
  }
  console.log('PHASE 1 SESSION FINANCE RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})().catch((e) => { console.error(e); process.exit(1); });
