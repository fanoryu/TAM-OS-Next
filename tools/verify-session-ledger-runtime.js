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

// UX-1: the one thing the address bar may carry — the SESSION shell route (#/name).
const ROUTE_ONLY = (u) => /^#\/[a-z]+$/.test(u);
// UX-1 authorized revision: leaving the shell (sign-out, session loss) clears the route with one write of the bare
// path ('/', no hash, no query) — never another value. Was: route fragments only.
const ROUTE_OR_CLEAR = (u) => ROUTE_ONLY(u) || u === '/';
const HASH_OK = (h) => ROUTE_ONLY(h) || h === '';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parseSessionShell } = require('./session-shell-chrome.js');
const { unmoney } = require('./ux-money-oracle.js');   // UX-1 (UX-OD-07): display-only money grouping

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
  posts: [post('GA', 'GA', '0.00', '2500000.00', '-2500000.00', 1), post('NPIP', 'NP & IP', '0.00', '0.00', '0.00', 0), post('TJB', 'TJB', '0.00', '0.00', '0.00', 0), post('DRONE', 'RnD — Research & Development', '12000000.00', '0.00', '12000000.00', 1)],
  general: { income: '12000000.00', expense: '2500000.00', net: '9500000.00', count: 2 }, voided: { count: 1, amount: '2500000.00' },
  payroll: { posted: { amount: '7021875.00', count: 3, fromMonth: '2031-04', toMonth: '2031-04' }, paid: { amount: '3500000.00', count: 1 } },
  consolidated: { income: '12000000.00', expense: '6000000.00', net: '6000000.00' },
  // AWP-01 (ADR-016 §6) authorized revision: the Approved-not-paid line, outside every total. Was: absent.
  approvedNotPaid: { posts: [{ code: 'GA', amount: '750000.00', count: 2 }, { code: 'NPIP', amount: '0.00', count: 0 }, { code: 'TJB', amount: '0.00', count: 0 }, { code: 'DRONE', amount: '1000000.00', count: 1 }],
    amount: '1750000.00', count: 3 } } };
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
    + ' SessionLedgerStore: SessionLedgerStore, SessionLedger: SessionLedger, sessionNavModel: sessionNavModel, render: render, SessionCsv: SessionCsv, sessionLedgerTransactionsCsv: sessionLedgerTransactionsCsv, sessionLedgerReportCsv: sessionLedgerReportCsv,'
    + ' transactionIsAmount: transactionIsAmount, sessionLedgerAmountPreview: sessionLedgerAmountPreview, parse: function(j){ return JSON.parse(j); } };';
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
  // AWP-05 authorized revision (Owner GO 2026-11-21, OD-13 = A): a recording download: the Blob, its object URL,
  // the <a download> link the CSV export clicks and the deferred revoke (2,000 ms, held until a test runs it).
  // Was: no Blob or URL, and createElement returned an inert element.
  const dl = { blobs: [], clicks: [], revoked: [], timers: [] };
  function RecBlob(parts, opts){ this.parts = parts; this.type = opts && opts.type; dl.blobs.push(this); }
  const dlEl = (tag) => { const el = mkEl(); if(String(tag).toLowerCase() === 'a') el.click = function(){ dl.clicks.push({ href: el.href, download: el.download, rel: el.rel }); }; return el; };
  const document = { addEventListener:noop, removeEventListener:noop, getElementById: (id) => (els[id] = els[id] || mkEl()),
    querySelector:()=>null, querySelectorAll:()=>[], createElement:(t)=>dlEl(t), contains:()=>false,
    body: mkEl(), documentElement: { dataset:{}, style:{} }, activeElement: null };
  Object.defineProperty(document, 'cookie', { get: () => { access.cookie.push('get'); return ''; }, set: () => { access.cookie.push('set'); } });
  const sandbox = {
    __spy: [], __spyErr: [], Date: FixedDate, crypto: require('crypto').webcrypto,
    console: { log:noop, warn:noop, error:noop, info:noop }, navigator: { userAgent:'tam-phase1' },
    setTimeout: function(fn, ms){ if(ms === 2000){ dl.timers.push(fn); return 'dl-timer-' + dl.timers.length; } if(ms === 10000) return 'api-timer'; return setTimeout(fn, ms); },
    clearTimeout: function(id){ if(id !== 'api-timer') clearTimeout(id); },
    requestAnimationFrame: (fn) => setTimeout(fn, 0), AbortController: AbortController, fetch: fetchStub,
    localStorage: storageOf(access.local), sessionStorage: storageOf(access.session),
    addEventListener: noop, removeEventListener: noop, confirm: () => { access.url.push('confirm()'); return true; },
    // UX-1 authorized revision (Owner GO 2026-11-17): the SESSION shell writes its route (#/name) to the address
    // bar, so this recording history also moves location.hash, as a browser does. The harness boots through the
    // direct link #/employees (the People page; My profile for an Employee), so the landing Home and its reads
    // stay out of these flows (Home is verified in verify-session-shell-runtime.js). Only a route name may be
    // written (ROUTE_ONLY below); confirm() is still recorded and still fails. Was: an empty hash; any write failed.
    location: { hash: '#/employees', search: '', pathname: '/', href: 'http://127.0.0.1/#/employees' },
    history: { replaceState: (a, b, u) => { access.url.push(String(u)); sandbox.location.hash = /^#/.test(String(u)) ? String(u) : ''; }, pushState: (a, b, u) => { access.url.push(String(u)); sandbox.location.hash = /^#/.test(String(u)) ? String(u) : ''; } },   // UX-1: a bare-path write clears the hash
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }), getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: document,
    Blob: RecBlob, URL: { createObjectURL: (b) => 'blob:http://127.0.0.1/' + dl.blobs.indexOf(b), revokeObjectURL: (u) => { dl.revoked.push(u); } }   // AWP-05
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-phase1-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.dl = dl; rt.sandbox = sandbox;   // AWP-05
  rt.net = net; rt.access = access; rt.spy = sandbox.__spy; rt.spyErr = sandbox.__spyErr;
  rt.appHTML = () => els.app.innerHTML; rt.app = els.app; rt.dom = dom; rt.loc = sandbox.location;
  rt.sf = () => rt.SessionLedgerStore.snapshot();
  rt.state = () => rt.AuthBoot.snapshot().state;
  return rt;
}
const flush = async (n) => { for(let i = 0; i < (n || 12); i++) await new Promise((r) => setImmediate(r)); };
const ledgerCalls = (rt) => rt.net.calls.filter((c) => /^\/api\/(general-transactions|reports)/.test(c.url));
const posts = (rt, path) => rt.net.calls.filter((c) => c.url === path && c.init && c.init.method === 'POST');
// UX-1 authorized revision: money cells are <data class="ux-money" value="EXACT">GROUPED</data>; the card reads the
// exact value back (unmoney) so every exact-string check below still reads the server string, and money(rt)
// checks the shown grouping against the independent oracle. The Dashboard / Transactions tabs are gone (the
// sidebar's Overview and Transactions items are the two views): the flows open Transactions from the sidebar.
// Was: raw strings in the cells and an sfTransactionsTab tab.
const shellContent = (rt) => { const s = parseSessionShell(rt.appHTML()); return s ? s.content : rt.appHTML(); };
const card = (rt) => unmoney(shellContent(rt)).html;
const money = (rt) => unmoney(shellContent(rt));
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
  check(rt.access.local.length === 0 && rt.access.session.length === 0 && rt.access.cookie.length === 0 && rt.access.url.every(ROUTE_OR_CLEAR) && HASH_OK(rt.loc.hash) && rt.loc.search === '',
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
    check((parseSessionShell(html) || {}).role === 'ceo' && /id="swSectionFinance"[\s\S]*id="swSectionPayroll"[\s\S]*id="swSectionTransactions"[\s\S]*id="swSectionAudit"/.test(html) && ledgerCalls(rt).length === 0,
      'A. the CEO has Overview and Transactions items (Overview, Payroll, Transactions, then Activity Log; UI-INT-1, was Finance between Payroll and Audit); nothing is read before it is opened');
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
    check((parseSessionShell(rt.appHTML()) || {}).active === 'finance' && /<h1 class="auth-title" id="authTitle" tabindex="-1">Finance Overview<\/h1>/.test(html) && rt.dom.focused[rt.dom.focused.length - 1] === 'authTitle',
      'B. the Overview item is current, the heading is "Finance Overview" (v2.11.0 title, UI-INT-1; was "Finance") and focus moves to it');
    const rows = (html.match(/<tr><th scope="row">[^<]*<\/th><td>[^<]*<\/td><td>[^<]*<\/td><td>[^<]*<\/td><td>[^<]*<\/td><\/tr>/g) || []);
    check(rows.length === 5 && /<th scope="row">GA<\/th><td>0\.00<\/td><td>2500000\.00<\/td><td>-2500000\.00<\/td><td>1<\/td>/.test(rows[0])
      && /<th scope="row">NP &amp; IP<\/th>/.test(rows[1]) && /<th scope="row">TJB<\/th>/.test(rows[2]) && /<th scope="row">RnD — Research &amp; Development<\/th><td>12000000\.00<\/td>/.test(rows[3])
      && /<th scope="row">All Financial Posts<\/th><td>12000000\.00<\/td><td>2500000\.00<\/td><td>9500000\.00<\/td><td>2<\/td>/.test(rows[4]),
      'B. the four Financial Posts in order (GA, NP & IP, TJB, RnD — Research & Development) and their total, every amount the exact server string');
    check(/id="sfPayroll"[\s\S]*Posted for 2031-04<\/th><td>7021875\.00<\/td><td>3<\/td>[\s\S]*Paid in this range<\/th><td>3500000\.00<\/td><td>1<\/td>/.test(html)
      && !/<th scope="row">Payroll<\/th>/.test(html.split('id="sfPayroll"')[0]),
      'B. Payroll is its own table — posted and paid — never a Financial Post row');
    // PD-6 (Owner 2026-11-13): the consolidated metric is explicitly labelled cash basis; posted payroll stays separately visible.
    check(/<h3 class="section-title">Consolidated \(cash basis\)<\/h3><div class="table-wrap" id="sfConsolidated">/.test(html) && /Financial Posts and payroll paid \(cash basis\)<\/th>/.test(html)
      && /id="sfConsolidated"[\s\S]*<td>12000000\.00<\/td><td>6000000\.00<\/td><td>6000000\.00<\/td>/.test(html) && /Voided in this range: 1 \(Rp 2500000\.00\)/.test(html),
      'B. the consolidated total and the voided transactions are shown exactly as the server sent them');
    const m = money(rt);
    // I4 authorized revision (ADR-016 §6): the Approved-not-paid table adds 5 amounts (four posts and all). Was: 21.
    check(m.ok && m.count === 26 && /<data class="ux-money" value="-2500000\.00">-2\.500\.000,00<\/data>/.test(shellContent(rt)),
      'B. UX-1 (UX-OD-07): every dashboard amount is the exact server string in <data value>, shown with display-only grouping (26 amounts, 21 before I4; the negative net keeps its sign)');
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
      'a payroll inside the posts': Object.assign({}, bad, { posts: bad.posts.map((p, i) => i === 0 ? Object.assign({}, p, { payroll: '1.00' }) : p) }),
      // AWP-01 (ADR-016 §6): the Approved-not-paid line is required and strictly shaped.
      'no approvedNotPaid line': (() => { const r = Object.assign({}, bad); delete r.approvedNotPaid; return r; })(),
      'approvedNotPaid posts out of order': Object.assign({}, bad, { approvedNotPaid: Object.assign({}, bad.approvedNotPaid, { posts: [bad.approvedNotPaid.posts[3], bad.approvedNotPaid.posts[1], bad.approvedNotPaid.posts[2], bad.approvedNotPaid.posts[0]] }) }),
      'approvedNotPaid counts that do not add up': Object.assign({}, bad, { approvedNotPaid: Object.assign({}, bad.approvedNotPaid, { count: 4 }) }),
      'an approvedNotPaid amount with a zero count': Object.assign({}, bad, { approvedNotPaid: Object.assign({}, bad.approvedNotPaid, { posts: bad.approvedNotPaid.posts.map((p, i) => i === 1 ? Object.assign({}, p, { amount: '5.00' }) : p) }) }),
      'a float approvedNotPaid amount': Object.assign({}, bad, { approvedNotPaid: Object.assign({}, bad.approvedNotPaid, { amount: '1750000.5' }) }),
      'an extra approvedNotPaid key': Object.assign({}, bad, { approvedNotPaid: Object.assign({}, bad.approvedNotPaid, { requests: [] }) })
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
    rt.app.fire('swSectionTransactions', 'click'); await flush();
    const html = card(rt);
    check(rt.net.calls.filter((c) => c.url === RANGE(...APRIL)).length === 1 && /<h1 class="auth-title" id="authTitle" tabindex="-1">Transactions<\/h1>/.test(html) && /3 transactions, oldest first\./.test(html),
      'D. Transactions reads exactly the range of the month once and lists it oldest first');
    check(/Fabricated &lt;b&gt;rent&lt;\/b&gt;/.test(html) && !/<b>rent<\/b>/.test(html) && /<td>RnD — Research &amp; Development<\/td>/.test(html) && /<td><span class="ux-badge ux-tone-stop"><span class="ux-badge-mark" aria-hidden="true">✕<\/span>Voided<\/span> Fabricated duplicate<\/td><td><\/td>/.test(html)
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
    rt.app.fire('swSectionTransactions', 'click'); await flush();
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

  /* ---------- E3. CR-02: the RnD option is the DRONE code (display rename only, 2026-11-19) ---------- */
  {
    const CREATE = '/api/general-transactions/create';
    const made = tx('5'.repeat(32), '2031-04-16', { kind: 'expense', financialPost: 'DRONE', category: 'Riset', description: 'Fabricated research', amount: '500000.00' });
    const rt = await open({ [CREATE]: [ok({ generalTransaction: made })] });
    rt.app.fire('swSectionTransactions', 'click'); await flush();
    rt.app.fire('sfAddBtn', 'click'); await flush();
    const sel = (/<select[^>]*id="sff-financialPost"[^>]*>([\s\S]*?)<\/select>/.exec(card(rt)) || ['', ''])[1];
    const opts = [...sel.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => m[1] + '=' + m[2]);
    check(opts.join('|') === '=Choose a Financial Post|GA=GA|NPIP=NP &amp; IP|TJB=TJB|DRONE=RnD — Research &amp; Development',
      'E3. CR-02: the Financial Post menu shows "RnD — Research & Development" for the DRONE code; no RND code is offered >> ' + opts.join('|'));
    for(const [k, v] of Object.entries({ kind: 'expense', financialPost: 'DRONE', category: 'Riset', description: 'Fabricated research', amount: '500000.00', transactionDate: '2031-04-16' })) rt.app.type('sff-' + k, v);
    rt.app.fire('sfForm', 'submit'); await flush();
    const sent = posts(rt, CREATE);
    const body = sent.length ? JSON.parse(sent[0].init.body) : {};
    check(sent.length === 1 && body.financialPost === 'DRONE' && body.amount === '500000.00' && /Transaction recorded\./.test(card(rt)),
      'E3. CR-02: choosing RnD sends the unchanged code DRONE >> ' + JSON.stringify(body.financialPost));
    firewall(rt, 'E3');
  }

  /* ---------- E2. the amount preview (UX-1 G-4 correction, 2026-11-17) ---------- */
  // The preview reads back only what the transaction validator accepts (written out here from the
  // validator's contract: a whole Rupiah N.00 above zero, at most 15 integer digits); a 16-digit value
  // is never shown as an amount, and the form still refuses it before sending.
  {
    const rt = await open({});
    const P = rt.sessionLedgerAmountPreview;
    const READS = /^Reads as Rp /, REFUSED = /^This amount is not accepted\./, GROUPED = /^Write the amount without thousands separators/;
    const cases = [
      ['1500000.00', READS, 'Reads as Rp 1.500.000,00.'], ['1.00', READS, 'Reads as Rp 1,00.'],
      ['999999999999999.00', READS, 'Reads as Rp 999.999.999.999.999,00.'],
      ['1000000000000000.00', REFUSED], ['9999999999999999.00', REFUSED], ['0.00', REFUSED], ['00.00', REFUSED],
      ['1500000.50', REFUSED], ['01500000.00', REFUSED],
      ['1.500.000', GROUPED], ['1,500,000.00', GROUPED], ['1500000', null], ['', null]
    ];
    const bad = cases.filter(([v, re, exact]) => { const out = P(v); return re ? (!re.test(out) || (exact && out !== exact)) : out !== ''; });
    check(bad.length === 0, 'E2. the amount preview reads back exactly the amounts the validator accepts; 16 digits, zero and non-.00 values are refused, never read back'
      + (bad.length ? ' >> ' + bad.map(([v]) => v + '→' + JSON.stringify(P(v))).join('; ') : ''));
    const agree = cases.every(([v]) => READS.test(P(v)) === rt.transactionIsAmount(v));
    check(agree, 'E2. "Reads as" is shown exactly when transactionIsAmount() accepts the value (one source of truth)');
    rt.app.fire('swSectionTransactions', 'click'); await flush();
    rt.app.fire('sfAddBtn', 'click'); await flush();
    for(const [k, v] of Object.entries({ kind: 'income', financialPost: 'TJB', category: 'Sewa Alat', description: 'Fabricated rental', amount: '1000000000000000.00', transactionDate: '2031-04-15' })) rt.app.type('sff-' + k, v);
    rt.app.fire('sfForm', 'submit'); await flush();
    check(posts(rt, '/api/general-transactions/create').length === 0 && /id="sff-amount"[^>]*aria-invalid="true"/.test(card(rt)),
      'E2. a 16-digit amount is still refused before sending and its field is marked invalid (validation unchanged)');
    firewall(rt, 'E2');
  }

  /* ---------- F. Void ---------- */
  {
    const VOID = '/api/general-transactions/void';
    const voided = Object.assign({}, T1, { status: 'Voided', void: { reason: 'Fabricated mistake', voidedByUserId: U, voidedAt: '2031-04-15T03:00:00.000000Z' } });
    const rt = await open({ [VOID]: [ok({ generalTransaction: voided })] });
    rt.app.fire('swSectionTransactions', 'click'); await flush();
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
    rt.app.fire('swSectionTransactions', 'click'); await flush();
    check(NARROW.test(card(rt)) && !/data-sf-void=|transactions, oldest first/.test(card(rt)), 'H. a history that fails closed (500) lists nothing and tells the CEO to choose a shorter range');
    firewall(rt, 'H');
    const id = (n) => n.toString(16).padStart(32, '0');
    const rows = (n) => Array.from({ length: n }, (_, i) => tx(id(i + 1), '2031-04-10'));
    const TX = { rangeResponse: (o) => rt.TransactionDecoders.rangeResponse(rt.parse(JSON.stringify(o)), ...APRIL) };
    const full = TX.rangeResponse({ generalTransactions: rows(2000) });
    check(full !== null && full.length === 2000 && TX.rangeResponse({ generalTransactions: rows(2001) }) === null,
      'H. the history decoder accepts exactly 2,000 rows and refuses 2,001 whole (never a truncated list)');
  }

  /* ---------- X. AWP-05 CSV export (OD-13 = A, Owner 2026-11-21) ---------- */
  {
    const BOM = String.fromCharCode(0xFEFF), CR = String.fromCharCode(13), LF = String.fromCharCode(10), CRLF = CR + LF, TAB = String.fromCharCode(9);
    const fw = (n) => String.fromCharCode(n);
    const unq = (v) => v[0] === '"' ? v.slice(1, -1).replace(/""/g, '"') : v;
    const name = (rt, code) => rt.FINANCIAL_POSTS.find((p) => p.code === code).name;
    const blob = (rt) => rt.dl.blobs[rt.dl.blobs.length - 1];
    const csvOf = (rt) => blob(rt).parts.join('');
    const EXPORTED = /<p class="auth-message" id="sfMessage" role="status" tabindex="-1">CSV file prepared for download: exactly the rows shown for this range\. Downloads are not recorded in the audit history\.<\/p>/;

    // X1. the encoder
    const rt = await open();
    const c = rt.SessionCsv;
    check(c.text(null) === '' && c.text(undefined) === '' && c.money(null) === '' && c.money(undefined) === '' && c.count(null) === '' && c.count(undefined) === ''
      && c.money('0.00') === '0.00' && c.count(0) === '0' && c.money('-2500000.00') === '-2500000.00' && c.money('12000000.00') === '12000000.00' && c.count(12) === '12',
      'X. missing values are empty cells, never 0; zero stays 0; an exact negative money string stays a bare number');
    check(c.money('1,000.00') === '"1,000.00"' && c.money('=1') === "'=1" && c.money('-0.5') === "'-0.5" && c.money(12) === '12' && c.count(-1) === "'-1" && c.count(1.5) === '1.5' && c.count('7') === '7',
      'X. a value that is not an exact money string / safe count is written as text (formula-safe), never parsed or rounded');
    check(c.text('a,b') === '"a,b"' && c.text('say "hi"') === '"say ""hi"""' && c.text('one' + LF + 'two') === '"one' + LF + 'two"' && c.text('one' + CRLF + 'two') === '"one' + CRLF + 'two"'
      && c.text('trail ') === '"trail "' && c.text('plain') === 'plain' && c.text('') === '',
      'X. RFC 4180: a comma, quote, CR, LF or trailing space is quoted with doubled quotes; plain text is bare');
    const ID = 'Sewa kantor Jl. Merdeka — pembayaran bulan April, "lunas" (café, 日本)';
    check(c.text(ID) === '"' + ID.replace(/"/g, '""') + '"' && unq(c.text(ID)) === ID && c.text('Biaya perjalanan dinas – Jawa Timur') === 'Biaya perjalanan dinas – Jawa Timur',
      'X. Unicode and Indonesian text pass through unchanged (quoted only where RFC 4180 needs it)');
    const FORMULAS = ['=1+1', '=HYPERLINK("http://example.invalid","x")', '+SUM(A1:A2)', '-2+3', '@SUM(A1)', TAB + '=1', CR + '=1', LF + '=1', ' =1', fw(0xFF1D) + '1+1', fw(0xFF0B) + '1', fw(0xFF0D) + '1', fw(0xFF20) + 'x', fw(0) + '=1', fw(0x200B) + '=1', fw(0xFEFF) + '=1', fw(0x2028) + '=1', fw(0xA0) + '=1'];
    check(FORMULAS.every((p) => unq(c.text(p)) === "'" + p) && unq(c.text('-2500000.00')) === "'-2500000.00" && c.text('a=b') === 'a=b',
      'X. formula payloads (= + - @, full-width forms, tab / CR / LF / space / control / zero-width / BOM / line-separator lead) get a leading apostrophe; a text cell never starts a formula');
    check(c.filename(['Transactions', '2031-04-01', 'to', '2031-04-30']) === 'tam-os-transactions-2031-04-01-to-2031-04-30.csv' && c.filename(['../x/<y>', '', 'Z']) === 'tam-os-x-y-z.csv'
      && c.document(['A', 'B'], []) === BOM + 'A,B' + CRLF && c.document(['=A'], [['1']]) === BOM + "'=A" + CRLF + '1' + CRLF,
      'X. deterministic file names ([a-z0-9-] only); a document is BOM + header + CRLF rows + a final CRLF; an empty one is the header alone');

    // X2. the Financial dashboard: the shown report, GP-03 payroll and consolidated excluded
    check(/id="sfExportBtn"/.test(card(rt)) && /id="sfExportNote">Export CSV holds the Financial Post lines, the voided line and the approved-not-paid line of this range\. Payroll and the consolidated total are not exported\.</.test(card(rt)),
      'X. the dashboard shows Export CSV with a note naming what is and is not exported');
    const callsBefore = rt.net.calls.length;
    check(rt.app.fire('sfExportBtn', 'click') === 'fired' && rt.dl.clicks.length === 1, 'X. Export CSV on the dashboard starts one download'); await flush();
    const D = '2031-04-01,2031-04-30,';
    const REPORT_CSV = BOM + ['From,To,Section,Financial Post,Income (Rp),Expenses (Rp),Net (Rp),Amount (Rp),Count',
      D + 'Income and expenses,GA,0.00,2500000.00,-2500000.00,,1', D + 'Income and expenses,NP & IP,0.00,0.00,0.00,,0', D + 'Income and expenses,TJB,0.00,0.00,0.00,,0',
      D + 'Income and expenses,RnD — Research & Development,12000000.00,0.00,12000000.00,,1', D + 'Income and expenses,All Financial Posts,12000000.00,2500000.00,9500000.00,,2',
      D + '"Voided, not counted",,,,,2500000.00,1',
      D + '"Approved, not paid",' + name(rt, 'GA') + ',,,,750000.00,2', D + '"Approved, not paid",' + name(rt, 'NPIP') + ',,,,0.00,0', D + '"Approved, not paid",' + name(rt, 'TJB') + ',,,,0.00,0',
      D + '"Approved, not paid",' + name(rt, 'DRONE') + ',,,,1000000.00,1', D + '"Approved, not paid",All Financial Posts,,,,1750000.00,3'].join(CRLF) + CRLF;
    check(csvOf(rt) === REPORT_CSV, 'X. the report CSV is exactly the shown range, posts, total, voided and approved-not-paid lines (negative net bare, unused cells empty, never 0)');
    check(!/7021875|3500000\.00|6000000|payroll|consolidated/i.test(csvOf(rt)), 'X. GP-03: no payroll amount, payroll count or consolidated total is exported');
    const k = rt.dl.clicks[0];
    check(k.download === 'tam-os-financial-report-2031-04-01-to-2031-04-30.csv' && k.href === 'blob:http://127.0.0.1/0' && k.rel === 'noopener' && blob(rt).type === 'text/csv;charset=utf-8',
      'X. the download is a same-document blob: link named tam-os-financial-report-2031-04-01-to-2031-04-30.csv, typed text/csv;charset=utf-8');
    check(rt.net.calls.length === callsBefore, 'X. exporting makes no request at all (no fetch, no new privilege, no third party)');
    check(EXPORTED.test(card(rt)) && rt.dom.focused[rt.dom.focused.length - 1] === 'sfMessage',
      'X. a status notice says the file holds exactly the rows shown and that downloads are not recorded in the audit history; focus moves to it');
    check(rt.dl.revoked.length === 0 && rt.dl.timers.length === 1, 'X. the object URL stays alive while the download starts');
    rt.dl.timers.shift()();
    check(rt.dl.revoked.join() === k.href, 'X. the object URL is revoked afterwards');
    firewall(rt, 'X dashboard');

    // X3. the Transactions list shown
    rt.app.fire('swSectionTransactions', 'click'); await flush();
    check(/id="sfExportBtn"/.test(card(rt)) && !/id="sfExportNote"/.test(card(rt)), 'X. the Transactions list shows Export CSV');
    rt.app.fire('sfExportBtn', 'click'); await flush();
    const TX_CSV = BOM + ['Date,Type,Financial Post,Category,Description,Amount (Rp),Status,Void reason',
      '2031-04-02,Expense,' + name(rt, 'GA') + ',Operasional Rutin,Fabricated <b>rent</b>,2500000.00,Active,',
      '2031-04-10,Income,' + name(rt, 'DRONE') + ',Jasa Survey,Fabricated survey,12000000.00,Active,',
      '2031-04-11,Expense,' + name(rt, 'GA') + ',Operasional Rutin,Fabricated <b>rent</b>,2500000.00,Voided,Fabricated duplicate'].join(CRLF) + CRLF;
    check(rt.dl.clicks.length === 2 && rt.dl.clicks[1].download === 'tam-os-transactions-2031-04-01-to-2031-04-30.csv' && csvOf(rt) === TX_CSV,
      'X. the Transactions CSV is exactly the rows shown, in their order, Voided rows with their reason, active rows with an empty reason cell');
    check(!new RegExp(['1'.repeat(32), U, 'createdAt', 'voidedBy', CSRF, 'csrf', '&lt;'].join('|'), 'i').test(csvOf(rt)), 'X. no id, user id, timestamp, CSRF token or HTML escaping is in the file');
    check(EXPORTED.test(card(rt)), 'X. the Transactions export shows the same notice');
    firewall(rt, 'X transactions');

    // X4. the open void panel blocks an export
    rt.app.voidRow(0); await flush();
    check(/id="sfExportBtn"[^>]* disabled/.test(card(rt)) && rt.app.fire('sfExportBtn', 'click') === 'disabled' && rt.SessionLedger.exportCsv() === false && rt.dl.clicks.length === 2,
      'X. while the void panel is open, Export CSV is disabled and refused');
  }
  {
    const rt = await open();
    rt.app.fire('swSectionTransactions', 'click'); await flush();
    rt.SessionLedgerStore.openForm('2031-04-15', 'f'.repeat(32));
    check(rt.SessionLedger.exportCsv() === false && rt.dl.clicks.length === 0, 'X. while the Record form is open, an export is refused');
  }
  {
    // X5. view-level formula, Unicode and Indonesian text
    const BOM = String.fromCharCode(0xFEFF);
    const HOSTILE = tx('4'.repeat(32), '2031-04-03', { description: '=HYPERLINK("http://example.invalid","klik")' });
    const INDO = tx('5'.repeat(32), '2031-04-04', { description: 'Sewa kantor Jl. Merdeka — pembayaran, "lunas" (café)' });
    const NEG = tx('6'.repeat(32), '2031-04-05', { description: '-1+2', amount: '1.00' });
    const rt = await open({ [RANGE(...APRIL)]: [ok({ generalTransactions: [HOSTILE, INDO, NEG] })] });
    rt.app.fire('swSectionTransactions', 'click'); await flush();
    check(rt.sf().list && rt.sf().list.length === 3, 'X. a list with a formula payload and Indonesian text is read and shown');
    rt.app.fire('sfExportBtn', 'click'); await flush();
    const lines = rt.dl.blobs[0].parts.join('').slice(1).split(String.fromCharCode(13, 10));
    check(rt.dl.blobs[0].parts.join('')[0] === BOM && lines[1].split(',')[4] === "\"'=HYPERLINK(\"\"http://example.invalid\"\"" && /,"Sewa kantor Jl\. Merdeka — pembayaran, ""lunas"" \(café\)",/.test(lines[2])
      && lines[3].split(',')[4] === "'-1+2" && lines[3].split(',')[5] === '1.00' && lines.length === 5 && lines[4] === '',
      'X. in the file the formula description is apostrophe-neutralised and quoted, the Indonesian text is exact, a description "-1+2" is neutralised while its amount stays a number');
    firewall(rt, 'X hostile');
  }
  {
    // X6. empty, failed, loading, over-cap
    const BOM = String.fromCharCode(0xFEFF);
    const rt = await open({ [RANGE(...APRIL)]: [ok({ generalTransactions: [] })] });
    rt.app.fire('swSectionTransactions', 'click'); await flush();
    rt.app.fire('sfExportBtn', 'click'); await flush();
    check(rt.dl.clicks.length === 1 && rt.dl.blobs[0].parts.join('') === BOM + 'Date,Type,Financial Post,Category,Description,Amount (Rp),Status,Void reason' + String.fromCharCode(13, 10),
      'X. an empty range exports a valid CSV of the header alone');
    firewall(rt, 'X empty');
  }
  {
    const rt = await open({ [REP(...APRIL)]: [err(500, 'internal_error')], [RANGE(...APRIL)]: [err(500, 'internal_error')] });
    check(!/id="sfExportBtn"/.test(card(rt)) && rt.SessionLedger.exportCsv() === false, 'X. a report that failed shows no Export CSV and exports nothing');
    rt.app.fire('swSectionTransactions', 'click'); await flush();
    check(!/id="sfExportBtn"/.test(card(rt)) && rt.SessionLedger.exportCsv() === false && rt.dl.clicks.length === 0 && rt.dl.blobs.length === 0, 'X. a history that failed (the cap fails closed) shows no Export CSV and exports nothing');
    firewall(rt, 'X failed');
  }
  {
    const hang = () => new Promise(() => {});
    const rt = await open({ [REP(...APRIL)]: [hang], [RANGE(...APRIL)]: [hang] });
    check(!/id="sfExportBtn"/.test(card(rt)) && rt.SessionLedger.exportCsv() === false, 'X. a report still loading shows no Export CSV and exports nothing');
    rt.app.fire('swSectionTransactions', 'click'); await flush();
    check(!/id="sfExportBtn"/.test(card(rt)) && rt.SessionLedger.exportCsv() === false && rt.dl.clicks.length === 0, 'X. a history still loading shows no Export CSV and exports nothing');
  }
  {
    const id = (n) => n.toString(16).padStart(32, '0');
    const rows = (n) => Array.from({ length: n }, (_, i) => tx(id(i + 1), '2031-04-10'));
    const over = await open({ [RANGE(...APRIL)]: [ok({ generalTransactions: rows(2001) })] });
    over.app.fire('swSectionTransactions', 'click'); await flush();
    check(!/id="sfExportBtn"/.test(card(over)) && over.SessionLedger.exportCsv() === false && over.dl.clicks.length === 0, 'X. 2,001 rows are refused whole: no Export CSV, never a truncated file');
    const full = await open({ [RANGE(...APRIL)]: [ok({ generalTransactions: rows(2000) })] });
    full.app.fire('swSectionTransactions', 'click'); await flush();
    full.app.fire('sfExportBtn', 'click'); await flush();
    check(full.dl.clicks.length === 1 && full.dl.blobs[0].parts.join('').split(String.fromCharCode(13, 10)).length === 2002, 'X. exactly 2,000 rows export as 2,000 lines under the header');
  }
  {
    // X6b. a new range still loading: the previous range is never exported under it
    const hang = () => new Promise(() => {});
    const rt = await open({ [REP('2031-04-10', '2031-04-11')]: [hang], [RANGE('2031-04-10', '2031-04-11')]: [hang] });
    rt.app.type('sfFrom', '2031-04-10'); rt.app.type('sfTo', '2031-04-11'); rt.app.fire('sfRangeForm', 'submit'); await flush();
    check(!/id="sfExportBtn"/.test(card(rt)) && rt.SessionLedger.exportCsv() === false && rt.dl.blobs.length === 0, 'X. while a new report range loads, the previous report is never exported');
    rt.app.fire('swSectionTransactions', 'click'); await flush();
    check(!/id="sfExportBtn"/.test(card(rt)) && rt.SessionLedger.exportCsv() === false && rt.dl.blobs.length === 0, 'X. while a new history range loads, the previous list is never exported');
    const back = await open();
    back.app.fire('swSectionTransactions', 'click'); await flush();
    back.net.routes[RANGE('2031-04-10', '2031-04-11')] = [hang];
    back.app.type('sfFrom', '2031-04-10'); back.app.type('sfTo', '2031-04-11'); back.app.fire('sfRangeForm', 'submit'); await flush();
    check(!/id="sfExportBtn"/.test(card(back)) && back.SessionLedger.exportCsv() === false && back.dl.blobs.length === 0, 'X. a shown April list is not exported once the From and To of a new range are being read');
  }
  {
    // X7. no Blob support; the Employee
    const rt = await open();
    rt.sandbox.Blob = undefined;
    rt.app.fire('sfExportBtn', 'click'); await flush();
    check(rt.dl.clicks.length === 0 && /<p class="auth-message auth-message-warn" id="sfMessage" role="alert" tabindex="-1">This browser cannot prepare a download, so nothing was exported\.<\/p>/.test(card(rt)),
      'X. a browser without Blob gets an alert that nothing was exported');
    const emp = await boot(ME_EMP);
    check(!/sfExportBtn|Export CSV/.test(emp.appHTML()) && emp.SessionLedger.exportCsv() === false && emp.dl.clicks.length === 0 && emp.dl.blobs.length === 0 && ledgerCalls(emp).length === 0,
      'X. an Employee never sees Export CSV, and a direct exportCsv() call exports nothing and reads nothing');
    // AWP-05 final pre-commit: the CEO guard alone. Fabricated, successfully read CEO-like data is planted in the
    // Employee's store (open, READY list and report); the CSV builders would export it, exportCsv() must not.
    const S = emp.SessionLedgerStore;
    S.setOpen(true, Object.freeze({ from: APRIL[0], to: APRIL[1] }));
    const tl = S.begin('list'); S.applyRead(tl, emp.TransactionDecoders.rangeResponse(emp.parse(JSON.stringify(LIST)), ...APRIL));
    const tr = S.begin('report'); S.applyRead(tr, emp.TransactionDecoders.reportResponse(emp.parse(JSON.stringify(REPORT)), ...APRIL));
    const planted = emp.sf();
    const callsBefore = emp.net.calls.length;
    check(planted.open === true && planted.listStatus === 'ready' && planted.reportStatus === 'ready' && planted.list.length === 3
      && !!emp.sessionLedgerTransactionsCsv(planted) && !!emp.sessionLedgerReportCsv(planted),
      'X. control: the planted Employee store holds a READY list and report that the CSV builders would export');
    let results = [];
    ['transactions', 'dashboard'].forEach((v) => { S.setView(v); results.push(emp.SessionLedger.exportCsv()); });
    check(results.join() === 'false,false' && emp.dl.blobs.length === 0 && emp.dl.clicks.length === 0 && emp.net.calls.length === callsBefore,
      'X. CEO guard: an Employee holding fabricated READY CEO-like data gets false from exportCsv() on both views: no Blob, no download, no request');
    check(emp.sf().notice === null && !/sfExportBtn|sfMessage|Export CSV|Fabricated (&lt;b&gt;)?rent|Fabricated survey|Fabricated duplicate|2500000|Operasional|tam-os-/.test(emp.appHTML()),
      'X. CEO guard: nothing of the planted data, no export notice and no file name reaches the Employee page');
  }

  /* ---------- P. Sprint 3: the CEO's Financial Post filter and its CSV (Owner GO 2026-11-24) ---------- */
  {
    const BOM = String.fromCharCode(0xFEFF), CRLF = String.fromCharCode(13) + String.fromCharCode(10);
    const blob = (rt) => rt.dl.blobs[rt.dl.blobs.length - 1];
    const csvOf = (rt) => blob(rt).parts.join('');
    const rowsOf = (rt) => card(rt).match(/<tr( aria-current="true")?><td>\d{4}-\d{2}-\d{2}<\/td>[\s\S]*?<\/tr>/g) || [];
    const P1 = tx('4'.repeat(32), '2031-04-03', { category: '@cmd', description: '=HYPERLINK("http://fabricated.invalid")', amount: '100000.00' });
    const P2 = tx('5'.repeat(32), '2031-04-05', { kind: 'income', financialPost: 'NPIP', category: 'Hibah', description: 'Fabricated, grant', amount: '300000.00' });
    const P3 = tx('6'.repeat(32), '2031-04-12', { category: 'Transport', description: 'Fabricated "taxi", fare', amount: '75000.00' });
    const FL = { generalTransactions: [T1, P1, P2, T2, T3, P3] };            // GA: T1, P1, T3 (Voided), P3; NPIP: P2; DRONE: T2; TJB: none
    const openTx = async (routes) => {
      const rt = await open(Object.assign({ [RANGE(...APRIL)]: [ok(FL)] }, routes || {}));
      rt.app.fire('swSectionTransactions', 'click'); await flush();
      return rt;
    };
    // P1. the selector: CEO only, Transactions only, All Financial Posts by default, from FINANCIAL_POSTS.
    {
      const rt = await open();
      check(!/id="sfPostFilter"/.test(card(rt)), 'P. the Financial dashboard has no Financial Post filter (its totals are never filtered)');
      rt.app.fire('swSectionTransactions', 'click'); await flush();
      const html = card(rt);
      check(rt.sf().postFilter === '' && /<label for="sfPostFilter">Financial Post<\/label><select class="input" id="sfPostFilter" name="financialPost"><option value="" selected>All Financial Posts<\/option><option value="GA">GA<\/option><option value="NPIP">NP &amp; IP<\/option><option value="TJB">TJB<\/option><option value="DRONE">RnD — Research &amp; Development<\/option><\/select>/.test(html),
        'P. Transactions offers a Financial Post filter: All Financial Posts (default, selected) and the four posts, labelled as everywhere else');
      check(rowsOf(rt).length === 3 && /3 transactions, oldest first\./.test(html), 'P. All Financial Posts keeps the existing list and count');
    }
    // P2. filtering over the list read: rows, order, count, no request.
    {
      const rt = await openTx();
      const calls = ledgerCalls(rt).length;
      rt.app.type('sfPostFilter', 'GA');
      let html = card(rt);
      const r = rowsOf(rt);
      check(rt.sf().postFilter === 'GA' && r.length === 4 && r.every((x) => /<td>GA<\/td>/.test(x)) && /2031-04-02[\s\S]*2031-04-03[\s\S]*2031-04-11[\s\S]*2031-04-12/.test(r.join(''))
        && /4 transactions in GA, oldest first\./.test(html) && /Voided/.test(r[2]),
        'P. GA shows only its four rows (the Voided one included), oldest first, counted "4 transactions in GA"');
      rt.app.type('sfPostFilter', 'NPIP');
      html = card(rt);
      check(rowsOf(rt).length === 1 && /<td>NP &amp; IP<\/td>/.test(rowsOf(rt)[0]) && /1 transaction in NP &amp; IP, oldest first\./.test(html), 'P. NP & IP shows its one row, "1 transaction in NP & IP"');
      rt.app.type('sfPostFilter', 'TJB');
      html = card(rt);
      check(rowsOf(rt).length === 0 && /<div class="empty" role="status">No transactions in TJB dated 2031-04-01 to 2031-04-30\.<\/div>/.test(html) && /id="sfExportBtn"/.test(html),
        'P. a post with no rows says so ("No transactions in TJB dated …"), Export CSV still offered');
      check(ledgerCalls(rt).length === calls, 'P. switching the Financial Post reads nothing from the server');
      // The empty result exports the header only, named for the post.
      rt.app.fire('sfExportBtn', 'click'); await flush();
      check(rt.dl.clicks.length === 1 && rt.dl.clicks[0].download === 'tam-os-transactions-tjb-2031-04-01-to-2031-04-30.csv'
        && csvOf(rt) === BOM + 'Date,Type,Financial Post,Category,Description,Amount (Rp),Status,Void reason' + CRLF,
        'P. an empty filtered result exports the header row only, in a file named for the post');
      rt.app.type('sfPostFilter', 'Bogus');
      check(rt.sf().postFilter === '' && rowsOf(rt).length === 6, 'P. a post outside the four is no filter (unknown codes such as RND or markup are ignored)');
      rt.SessionLedger.setPostFilter('RND'); rt.SessionLedger.setPostFilter('<b>');
      check(rt.sf().postFilter === '' && ledgerCalls(rt).length === calls, 'P. direct calls with an unknown post change nothing and read nothing');
      firewall(rt, 'P filter');
    }
    // P3. the CSV of the filtered rows: exactly them, escaped and formula-safe, no hidden metadata.
    {
      const rt = await openTx();
      rt.app.type('sfPostFilter', 'GA');
      rt.app.fire('sfExportBtn', 'click'); await flush();
      const GA_CSV = BOM + ['Date,Type,Financial Post,Category,Description,Amount (Rp),Status,Void reason',
        '2031-04-02,Expense,GA,Operasional Rutin,Fabricated <b>rent</b>,2500000.00,Active,',
        "2031-04-03,Expense,GA,'@cmd,\"'=HYPERLINK(\"\"http://fabricated.invalid\"\")\",100000.00,Active,",
        '2031-04-11,Expense,GA,Operasional Rutin,Fabricated <b>rent</b>,2500000.00,Voided,Fabricated duplicate',
        '2031-04-12,Expense,GA,Transport,"Fabricated ""taxi"", fare",75000.00,Active,'].join(CRLF) + CRLF;
      check(rt.dl.clicks.length === 1 && rt.dl.clicks[0].download === 'tam-os-transactions-ga-2031-04-01-to-2031-04-30.csv' && csvOf(rt) === GA_CSV,
        'P. the GA CSV is exactly the four GA rows shown, in order: quotes doubled, commas quoted, formula starts (= @) neutralised with an apostrophe, the voided reason kept');
      check(!/NP & IP|RnD|Hibah|survey|grant/.test(csvOf(rt)) && !new RegExp(['4'.repeat(32), '1'.repeat(32), U, 'createdAt', 'voidedBy', CSRF].join('|')).test(csvOf(rt)),
        'P. no row of another post, no id, user id, timestamp or token is in the file');
      rt.app.type('sfPostFilter', '');
      rt.app.fire('sfExportBtn', 'click'); await flush();
      check(rt.dl.clicks[1].download === 'tam-os-transactions-2031-04-01-to-2031-04-30.csv' && (csvOf(rt).match(/\r\n/g) || []).length === 7,
        'P. back to All Financial Posts, the export is the whole list under the existing file name (header + six rows)');
    }
    // P4. composition with the date range; Void on the filtered row; the report never filtered.
    {
      const MAY = ['2031-05-01', '2031-05-31'];
      const M1 = tx('7'.repeat(32), '2031-05-02', { financialPost: 'DRONE', category: 'Drone', description: 'Fabricated May drone', amount: '50000.00' });
      const M2 = tx('8'.repeat(32), '2031-05-03', { description: 'Fabricated May rent' });
      const rt = await openTx({ [RANGE(...MAY)]: [ok({ generalTransactions: [M1, M2] })] });
      rt.app.type('sfPostFilter', 'DRONE');
      rt.app.type('sfFrom', MAY[0]); rt.app.type('sfTo', MAY[1]); rt.app.fire('sfRangeForm', 'submit'); await flush();
      check(rt.sf().postFilter === 'DRONE' && rt.net.calls.filter((c) => c.url === RANGE(...MAY)).length === 1 && rowsOf(rt).length === 1 && /Fabricated May drone/.test(rowsOf(rt)[0])
        && /1 transaction in RnD — Research &amp; Development, oldest first\./.test(card(rt)),
        'P. the filter composes with the date range: May is read once and shows only its RnD row');
      rt.app.type('sfFrom', APRIL[0]); rt.app.type('sfTo', APRIL[1]); rt.net.routes[RANGE(...APRIL)] = [ok(FL)]; rt.app.fire('sfRangeForm', 'submit'); await flush();
      rt.app.type('sfPostFilter', 'GA');
      rt.app.voidRow(3); await flush();
      check(rt.sf().voidTarget && rt.sf().voidTarget.transaction.id === P3.id && /id="sfVoidForm"[\s\S]*Fabricated &quot;taxi&quot;, fare|id="sfVoidForm"[\s\S]*Fabricated "taxi", fare/.test(card(rt)),
        'P. Void on the fourth GA row opens that GA transaction (P3), not the fourth row of the whole list (an RnD income)');
      check(/id="sfPostFilter"[^>]* disabled/.test(card(rt)), 'P. while the void panel is open the filter is disabled');
      rt.SessionLedger.setPostFilter('DRONE');
      check(rt.sf().postFilter === 'GA', 'P. and a direct change is refused while the void panel is open');
      rt.app.fire('sfVoidCancel', 'click'); await flush();
      // The dashboard: the server's totals, unchanged by the filter.
      rt.app.fire('swSectionFinance', 'click'); await flush();
      const dash = card(rt);
      const posts = (dash.match(/<div class="table-wrap" id="sfPosts">[\s\S]*?<\/table><\/div>/) || [''])[0];
      const plain = await open();
      const plainPosts = (card(plain).match(/<div class="table-wrap" id="sfPosts">[\s\S]*?<\/table><\/div>/) || ['-'])[0];
      check(rt.sf().postFilter === 'GA' && posts !== '' && posts === plainPosts && /<th scope="row">All Financial Posts<\/th><td>12000000\.00<\/td><td>2500000\.00<\/td><td>9500000\.00<\/td>/.test(posts)
        && /<th scope="row">GA<\/th><td>0\.00<\/td><td>2500000\.00<\/td><td>-2500000\.00<\/td>/.test(posts) && !/sfPostFilter/.test(dash),
        'P. with GA chosen, the dashboard still shows every post and the server totals (general 12,000,000 / 2,500,000 / 9,500,000) exactly as returned');
      rt.app.fire('sfExportBtn', 'click'); await flush();
      check(/All Financial Posts,12000000\.00,2500000\.00,9500000\.00/.test(csvOf(rt)) && /RnD — Research & Development,12000000\.00/.test(csvOf(rt)),
        'P. the report CSV is unfiltered too: every post and the server total line');
    }
    // P5. malformed data, the drill-through, principal change, Employee.
    {
      const rt = await open({ [RANGE(...APRIL)]: [ok({ generalTransactions: [tx('9'.repeat(32), '2031-04-02', { financialPost: 'RND' })] })] });
      rt.app.fire('swSectionTransactions', 'click'); await flush();
      check(rt.sf().listStatus === 'error' && !/id="sfExportBtn"/.test(card(rt)) && rt.SessionLedger.exportCsv() === false && !/<tr><td>2031/.test(card(rt)),
        'P. a list naming an unknown post (RND) is refused whole by the decoder: no row, no export');
    }
    {
      const rt = await openTx();
      rt.app.type('sfPostFilter', 'NPIP');
      check(rt.SessionLedger.drill({ transactionId: T1.id, date: '2031-04-02', requestId: 'b'.repeat(32) }) === true && rt.sf().postFilter === '' && rt.sf().drill !== null,
        'P. opening a ledger drill-through resets the filter, so the linked row is never filtered out');
    }
    {
      const rt = await openTx();
      rt.app.type('sfPostFilter', 'GA');
      const other = Object.assign({}, rt.AuthBoot.snapshot().principal, { id: 'u_other_9' });
      check(rt.SessionLedgerStore.bindPrincipal(other) === true && rt.sf().postFilter === '', 'P. a different principal resets the filter to All Financial Posts');
    }
    {
      const rt = await openTx();
      rt.app.type('sfPostFilter', 'GA');
      rt.AuthBoot.sessionLost(); await flush();
      check(rt.sf().postFilter === '' && !/sfPostFilter/.test(rt.appHTML()), 'P. the session ending resets the filter and removes it from the page');
    }
    {
      const emp = await boot(ME_EMP);
      const calls = emp.net.calls.length;
      emp.SessionLedger.setPostFilter('GA');
      check(!/sfPostFilter|Financial Post filter/.test(emp.appHTML()) && emp.sf().postFilter === '' && emp.net.calls.length === calls && ledgerCalls(emp).length === 0,
        'P. an Employee has no Financial Post filter; a direct call changes nothing and reads nothing');
      firewall(emp, 'P Employee');
    }
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
