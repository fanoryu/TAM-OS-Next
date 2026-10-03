#!/usr/bin/env node
'use strict';
/* ============================================================
   AFI-4b1 / AFI-4b2 — SESSION OVERTIME WORKSPACE RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of AFI-4b1 and AFI-4b2. This harness proves
   their BEHAVIOUR by executing every production module (module-order.js, the boot included)
   in the dependency-free Node `vm` loader of the SESSION Employee harness, with the ONE
   source line `const AUTH_MODE = AUTH_MODES.LOCAL;` rewritten to SESSION in the
   concatenated text — the committed value is untouched.

   DETERMINISTIC: fetch is a stub answering by URL (path + query) from a script; the API
   timeout timer is captured and fired on demand; the page's clock is injected — `Date`
   with no argument is a fixed instant (2031-04-15T12:00:00Z, the same calendar month in
   every timezone from UTC-12 to UTC+14), and the month helper is also driven with pure
   fake clocks. No real network, no wall clock, no credentials, no production backend.
   localStorage / sessionStorage / cookies / history are instrumented, and the LOCAL boot,
   the shell, "Acting as", local data tools, Global Search, the LOCAL Overtime page and the
   other domains' renderers are recording spies that must never be called. Every identity,
   token and record here is fabricated.

   #app is a small recording element: querySelector('#id') finds an element only when the
   rendered HTML carries that id (its value read from that HTML), its listeners can be
   fired, and focus() is recorded — so bindings, disabled controls and focus moves are
   exercised, not assumed. Every write request (method, path, body, CSRF header) is
   recorded and asserted exactly.

   AFI-4b2 (owner decision D-AFI4b2-2 = A: this harness is extended, CI stays at nine):
   valuation and approval. The fabricated valuations are deliberately NOT what TAM-OT-1
   would give for their inputs (preview 12345.00 for 7.50 h at 8000000.00), so a page that
   computed an amount itself could not show — or send — the server's string. Sections S–Z.
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
const ME_EMP = { userId: 'u_emp_1', membershipId: 'm_emp_1', role: 'employee', employeeId: 'emp_srv_1', csrfToken: CSRF };
const ME_EMP2 = { userId: 'u_emp_2', membershipId: 'm_emp_2', role: 'employee', employeeId: 'emp_srv_2', csrfToken: CSRF };
const FIXED_NOW = Date.UTC(2031, 3, 15, 12, 0, 0);       // 2031-04-15T12:00:00Z
const MONTH = '2031-04';
const NEVER = ['loadState', 'saveState', 'applyTheme', 'installGlobalUIHandlers', 'maybeShowFirstRunChoice', 'startFresh',
  'renderShell', 'renderView', 'renderIdentitySelectorHTML', 'restoreCompleteBackup', 'renderSmartImport', 'openGlobalSearch',
  'openEmployeeModal', 'setEmployeeActive', 'deleteEmployee', 'renderEmployees', 'renderEmployeeDetail', 'persistEmployees',
  'renderOvertime', 'renderOvertimeWorksheet', 'renderPayrollWorkspace', 'renderPayrollDetail', 'renderDashboard',
  'renderExecutiveDashboard', 'renderTransactions', 'renderExecutionCenter'];

/* ---------- fabricated records ---------- */
const E1 = { id: 'e_1', employeeCode: 'EMP-001', fullName: 'Fabricated <Alpha>', jobTitle: null, department: null, employmentStatus: 'Active', archived: false, accountState: 'none', accountManageable: true };
const E2 = { id: 'e_2', employeeCode: 'EMP-002', fullName: 'Fabricated Beta', jobTitle: null, department: null, employmentStatus: 'On Leave', archived: false, accountState: 'none', accountManageable: true };
const E3 = { id: 'e_3', employeeCode: 'EMP-003', fullName: 'Fabricated Gamma', jobTitle: null, department: null, employmentStatus: 'Active', archived: true, accountState: 'none', accountManageable: false };
const E4 = { id: 'e_4', employeeCode: 'EMP-004', fullName: 'Fabricated Delta', jobTitle: null, department: null, employmentStatus: 'Active', archived: false, accountState: 'none', accountManageable: true };
const PEOPLE = { employees: [E1, E2, E3, E4] };
const ID1 = '1'.repeat(32), ID2 = '2'.repeat(32), ID3 = '3'.repeat(32), ID4 = '4'.repeat(32), IDN = 'a'.repeat(32);
const IDS1 = 'b'.repeat(32), IDS2 = 'c'.repeat(32), IDS3 = 'd'.repeat(32), IDS4 = 'e'.repeat(32);
const rec = (id, owner, status, version, extra) => Object.assign({ id: id, employeeId: owner, monthKey: MONTH, overtimeDate: '2031-04-03', hours: '7.50',
  workDescription: 'Fabricated <b>task</b>', notes: null, status: status, version: version }, extra || {});
const R1 = rec(ID1, 'e_1', 'Draft', 1);
const R2 = rec(ID2, 'e_2', 'Submitted', 2, { hours: '2.25', overtimeDate: null });
const R3 = rec(ID3, 'e_3', 'Reviewed', 3, { hours: '1.00' });
const R4 = rec(ID4, 'e_gone', 'Rejected', 4, { hours: '0.25' });
const CEO_MONTH = { overtimeRecords: [R1, R2, R3, R4] };
const S1 = rec(IDS1, 'emp_srv_1', 'Draft', 1);
const S2 = rec(IDS2, 'emp_srv_1', 'Submitted', 2);
const S3 = rec(IDS3, 'emp_srv_1', 'Reviewed', 3);
const S4 = rec(IDS4, 'emp_srv_1', 'Rejected', 4);
const EMP_MONTH = { overtimeRecords: [S1, S2, S3, S4] };
const SELF = { id: 'emp_srv_1', employeeCode: 'EMP-777', fullName: 'Fabricated Self', jobTitle: null, department: null, employmentStatus: 'Active',
  joinDate: null, contactEmail: null, phone: null, monthlyBaseSalary: '1000000.00' };

/* ---------- AFI-4b2 fabricated valuations ---------- */
const ID5 = '5'.repeat(32), IDA = '6'.repeat(32), IDS5 = 'f'.repeat(32), IDX = '9'.repeat(32);
const R5 = rec(ID5, 'e_1', 'Reviewed', 3);                                   // a live owner's Reviewed record, 7.50 h
const RA = rec(IDA, 'e_4', 'Approved', 4, { hours: '2.25' });
const S5 = rec(IDS5, 'emp_srv_1', 'Approved', 4);
const val = (id, kind, hours, extra) => Object.assign({ id: id, kind: kind, method: 'TAM-OT-1', hours: hours,
  monthlySalaryBasis: '8000000.00', standardMonthlyHours: '160.00', amount: '12345.00' }, extra || {});
const PV5 = val(ID5, 'preview', '7.50');                                     // NOT 8000000 × 7.5 ÷ 160 (= 375000)
const PV5b = val(ID5, 'preview', '7.50', { monthlySalaryBasis: '8500000.00', amount: '13000.00' });
const AV5 = val(ID5, 'approved', '7.50');
const AVA = val(IDA, 'approved', '2.25', { monthlySalaryBasis: '7000000.00', amount: '98765.00' });
const AVS5 = val(IDS5, 'approved', '7.50', { monthlySalaryBasis: '900000.00', amount: '54321.00' });   // SELF's current salary is 1000000.00
const R5A = Object.assign({}, R5, { status: 'Approved', version: 4 });
const CEO_MONTH5 = { overtimeRecords: [R1, R2, R3, R4, R5, RA] };
const EMP_MONTH5 = { overtimeRecords: [S1, S2, S3, S4, S5] };
const approved = (r, v) => ({ overtimeRecord: r, overtimeValuation: v });

const OT = (m) => '/api/overtime-records?month=' + m;
const REC = (id) => '/api/overtime-record?id=' + id;
const VAL = (id) => '/api/overtime-record/valuation?id=' + id;
const EMPS = '/api/employees?archived=1';
const W = { create: '/api/overtime-records/create', update: '/api/overtime-records/update', delete: '/api/overtime-records/delete',
  submit: '/api/overtime-records/submit', review: '/api/overtime-records/review', reject: '/api/overtime-records/reject',
  approve: '/api/overtime-records/approve' };

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
const errF = (fields) => resp(400, { ok: false, error: { code: 'validation_failed', message: 'server text', fields: fields }, requestId: RID });
const NETFAIL = () => new TypeError('Failed to fetch');
const one = (r) => ({ overtimeRecord: r });
function deferred(){ let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise: promise, resolve: resolve }; }

/* ---------- a recording #app ---------- */
const unescapeHtml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function mkApp(mkEl, dom){
  let html = '';
  let elements = {};
  const tagOf = (id) => new RegExp('<([a-z]+)[^>]*\\sid="' + id + '"[^>]*>').exec(html);
  function valueOf(id, tag){
    if(tag[1] === 'input'){ const v = /\svalue="([^"]*)"/.exec(tag[0]); return v ? unescapeHtml(v[1]) : ''; }
    const rest = html.slice(tag.index + tag[0].length);
    if(tag[1] === 'textarea') return unescapeHtml(rest.slice(0, rest.indexOf('</textarea>')));
    if(tag[1] === 'select'){ const v = /<option value="([^"]*)" selected>/.exec(rest.slice(0, rest.indexOf('</select>'))); return v ? unescapeHtml(v[1]) : ''; }
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
  app.el = (id) => find('#' + id);
  app.fire = (id, type) => {
    const el = find('#' + id);
    if(!el) return 'absent';
    if(el.disabled) return 'disabled';
    (el.listeners[type] || []).forEach((fn) => fn.call(el, { preventDefault: () => {} }));
    return 'fired';
  };
  // A user typing into (or choosing in) a rendered form control: input, then change.
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
    + ' SessionIdentityProvider: SessionIdentityProvider, API_RESULT_KINDS: API_RESULT_KINDS, PRINCIPAL_TYPES: PRINCIPAL_TYPES,'
    + ' OvertimeApi: OvertimeApi, OvertimeDecoders: OvertimeDecoders, OvertimeRequests: OvertimeRequests, OvertimeCalendar: OvertimeCalendar,'
    + ' SessionOvertimeStore: SessionOvertimeStore, SessionOvertime: SessionOvertime, SessionEmployeeStore: SessionEmployeeStore,'
    + ' sessionOvertimeActions: sessionOvertimeActions, sessionOvertimeCurrentMonth: sessionOvertimeCurrentMonth,'
    + ' sessionOvertimeOwnerLabel: sessionOvertimeOwnerLabel, sessionOvertimeEligible: sessionOvertimeEligible,'
    + ' sessionOvertimeValuationWanted: sessionOvertimeValuationWanted, sessionOvertimePreviewMatches: sessionOvertimePreviewMatches,'
    + ' render: render, parse: function(json){ return JSON.parse(json); } };';
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
        const out = typeof next === 'function' ? next(init) : next;
        if(out instanceof Error) reject(out); else resolve(out);
      });
    });
  };
  // The injected clock: `new Date()` is the fixed instant; with arguments, a real Date.
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
  Object.defineProperty(document, 'cookie', { get: () => { access.cookie.push('get'); return ''; }, set: (v) => { access.cookie.push('set'); } });
  const sandbox = {
    __spy: [], __spyErr: [], Date: FixedDate,
    console: { log:noop, warn:noop, error:noop, info:noop }, navigator: { userAgent:'tam-afi4b1' },
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
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-afi4b1-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.net = net; rt.access = access; rt.spy = sandbox.__spy; rt.spyErr = sandbox.__spyErr;
  rt.appHTML = () => (els.app ? els.app.innerHTML : '');
  rt.app = els.app; rt.dom = dom; rt.loc = sandbox.location;
  rt.ot = () => rt.SessionOvertimeStore.snapshot();
  rt.state = () => rt.AuthBoot.snapshot().state;
  return rt;
}
const flush = async (n) => { for(let i = 0; i < (n || 10); i++) await new Promise((r) => setImmediate(r)); };
const posts = (rt, route) => rt.net.calls.filter((c) => c.init && c.init.method === 'POST' && (route ? c.url === route : /^\/api\/overtime-records\//.test(c.url)));
const bodyOf = (c) => JSON.parse(c.init.body);
const countOf = (rt, url) => rt.net.calls.filter((c) => c.url === url).length;
const lastFocus = (rt) => rt.dom.focused[rt.dom.focused.length - 1];
const keys = (o) => Object.keys(o).sort().join();
// AFI-4b2 authorized revision: Approve is one of the action buttons. Was: Edit, Delete, Submit, Review, Reject.
const buttons = (html) => ['swoEditBtn', 'swoDeleteBtn', 'swoSubmitBtn', 'swoReviewBtn', 'swoApproveBtn', 'swoRejectBtn'].filter((b) => html.indexOf('id="' + b + '"') !== -1).map((b) => b.slice(3, -3)).join();
const valuationCalls = (rt) => rt.net.calls.filter((c) => /^\/api\/overtime-record\/valuation/.test(c.url)).length;
const enabled = (html, id) => new RegExp('<button[^>]*id="' + id + '"(?![^>]*\\sdisabled)[^>]*>').test(html);

async function boot(me, routes){
  const base = me.role === 'ceo' ? { '/api/employees': [ok({ employees: [E1, E2, E4] })] } : { '/api/employee?id=emp_srv_1': [ok({ employee: SELF })] };
  const rt = loadRuntime(Object.assign({ '/api/auth/me': [ok(me)] }, base, routes || {}));
  await flush();
  return rt;
}
// Signed in, the Overtime section opened by its section button.
async function open(me, routes){
  const rt = await boot(me, Object.assign(me.role === 'ceo'
    ? { [OT(MONTH)]: [ok(CEO_MONTH)], [EMPS]: [ok(PEOPLE)] }
    : { [OT(MONTH)]: [ok(EMP_MONTH)] }, routes || {}));
  rt.app.fire('swSectionOvertime', 'click'); await flush();
  return rt;
}
// The detail of `id` open.
async function detail(me, id, record, routes){
  const rt = await open(me, Object.assign({ [REC(id)]: [ok(one(record))] }, routes || {}));
  const i = (rt.ot().list || []).findIndex((r) => r.id === id);
  rt.app.fire('swoOpen' + i, 'click'); await flush();
  return rt;
}

// The SESSION firewall, after every phase.
function firewall(rt, label){
  check(rt.access.local.length === 0 && rt.access.session.length === 0 && rt.access.cookie.length === 0,
    label + ': zero localStorage / sessionStorage / cookie access' + (rt.access.local.length + rt.access.session.length + rt.access.cookie.length ? ' >> ' + rt.access.local.concat(rt.access.session, rt.access.cookie).join(', ') : ''));
  check(rt.spy.length === 0, label + ': no LOCAL boot, shell, "Acting as", local data tool, Global Search, LOCAL Overtime page or other domain was called' + (rt.spy.length ? ' >> ' + rt.spy.join(', ') : ''));
  const html = rt.appHTML();
  // AFI-4b2 authorized revision. Was: no "Approv" and no money word anywhere in the DOM (BF-4b2 had
  // not reached the frontend). Now: Payroll / Finance and their vocabulary stay forbidden
  // everywhere; approval and money are allowed ONLY where BF-4b2 discloses them — the valuation
  // block, the approve panel and the approval message — and only while the detail shown is one
  // whose valuation this principal reads (CEO: Reviewed / Approved; Employee: own Approved).
  check(!/identity-selector|identityPrincipalSelect|Acting as|class="sidebar"|data-nav=|Payroll|Payslip|Finance|ledger|journal|payment|\btax\b|Smart Import|Backup|Restore|Start fresh|Commit|Post to/i.test(html),
    label + ': the DOM carries no "Acting as", navigation, Payroll / Finance entry or vocabulary, commit / post control or local data tool');
  const w = rt.ot();
  const p = rt.AuthBoot.snapshot().principal;
  const disclosed = !!w.detailId && !!w.detail && rt.sessionOvertimeValuationWanted(p, w.detail);
  const outside = html.replace(/<section class="card" id="swoValuation"[\s\S]*?<\/section>/, '')
    .replace(/<section class="card" aria-labelledby="swoPanelTitle"[^>]*><h2 [^>]*>Approve this overtime\?<\/h2>[\s\S]*?<\/section>/, '')
    .replace(/<p [^>]*id="swoMutationMessage"[^>]*>[\s\S]*?<\/p>/, '');
  const MONEY = /\b(Rp|salary|rate|amount|wage|estimat|hourly|multiplier)/i;
  check(!MONEY.test(disclosed ? outside : html), label + ': no money, rate, salary, amount or pay estimate in the DOM outside the BF-4b2 valuation disclosure' + (disclosed ? '' : ' (none here: nothing is disclosed)'));
  check(!/Approv/i.test(outside.replace(/<td>Approved<\/td>/g, '').replace(/<button class="btn btn-accent" type="button" id="swoApproveBtn"[^>]*>Approve<\/button>/, '')),
    label + ': "Approv…" appears only as the Approved status, the Approve control or inside the approval disclosure');
  const ceoReviewed = !!p && p.principalType === 'ceo' && !!w.detail && w.detail.status === 'Reviewed' && !!w.detailId;
  check((html.indexOf('id="swoApproveBtn"') === -1 || ceoReviewed) && (!/Approve this overtime\?/.test(html) || ceoReviewed),
    label + ': an Approve control or approval panel exists only for the CEO on a Reviewed record');
  check(!/[0-9a-f]{32}|"e_[0-9a-z]+"|emp_srv_/.test(html.replace(RID, '')), label + ': no opaque record or Employee id in the page');
  check(rt.State.employees.length === 0 && rt.State.storageReady === false && rt.AuthBoot.allowsWorkspace() === false,
    label + ': legacy State stays empty and the business shell is never granted');
  check(rt.access.url.length === 0 && rt.loc.hash === '' && rt.loc.search === '', label + ': nothing written to the address bar or history; no browser confirm()');
  const bad = posts(rt).filter((c) => /"(role|companyId|company_id|employee_id|actor|status|version|amount|rate|salary|payroll|contract|reason)"\s*:/.test(c.init.body)
    || (c.url !== W.create && /"employeeId"/.test(c.init.body)) || c.init.headers['X-CSRF-Token'] === undefined);
  check(bad.length === 0, label + ': every Overtime write is a CSRF POST; only create carries employeeId; none carries company, role, actor, status, version or money');
  const approvals = posts(rt, W.approve);
  check(approvals.every((c) => keys(bodyOf(c)) === 'expectedAmount,expectedVersion,id') && posts(rt).filter((c) => c.url !== W.approve).every((c) => !/expectedAmount|salary|monthlySalaryBasis|hours"\s*:\s*"[^"]*"\s*,\s*"kind/.test(c.init.body)),
    label + ': an approval body is exactly { id, expectedVersion, expectedAmount }; no other write carries an amount or salary');
}

(async function main(){
  console.log('== AFI-4b1 + AFI-4b2 SESSION OVERTIME WORKSPACE — RUNTIME VERIFICATION ==');

  /* ---------- 0. the harness itself ---------- */
  {
    const rt = loadRuntime({});
    check(rt.spyErr.length === 0, '0. every forbidden function is a replaceable declaration and is spied' + (rt.spyErr.length ? ' >> ' + rt.spyErr.join(', ') : ''));
    check(/const AUTH_MODE = AUTH_MODES\.LOCAL;/.test(fs.readFileSync(path.join(root, 'js', 'core', 'constants.js'), 'utf8')),
      '0. the committed AUTH_MODE is LOCAL (SESSION exists only inside this harness)');
    check(rt.sessionOvertimeCurrentMonth() === MONTH, '0. the injected clock drives the page: "now" is 2031-04, whatever the real date');
  }

  /* ---------- A. strict DTO decoder ---------- */
  {
    const rt = loadRuntime({});
    const D = rt.OvertimeDecoders;
    const P = (o) => rt.parse(JSON.stringify(o));
    const good = D.record(P(R1));
    check(!!good && Object.isFrozen(good) && good.hours === '7.50' && typeof good.hours === 'string' && keys(good) === keys(R1), 'A. a canonical record decodes, frozen, hours kept as the exact string');
    check(!!D.record(P(rec(ID1, 'e_1', 'Draft', 1, { hours: '744.00', overtimeDate: null, workDescription: null, notes: 'line 1\nline\t2' })))
      && !!D.record(P(rec(ID1, 'e_1', 'Rejected', 4294967295, { hours: '0.25', monthKey: '1900-01', overtimeDate: '1900-01-31' }))),
      'A. boundaries accepted: 744.00, 0.25, null date / description, multi-line notes, version 2^32-1, month 1900-01');
    const bads = [
      ['unknown key', Object.assign({}, R1, { companyId: 'c' })], ['money key', Object.assign({}, R1, { amount: '1.00' })], ['missing key', (() => { const c = Object.assign({}, R1); delete c.notes; return c; })()],
      ['upper-case id', Object.assign({}, R1, { id: 'A'.repeat(32) })], ['short id', Object.assign({}, R1, { id: '1'.repeat(31) })],
      ['bad employeeId', Object.assign({}, R1, { employeeId: 'e 1' })], ['month 13', Object.assign({}, R1, { monthKey: '2031-13', overtimeDate: null })],
      ['month 1899', Object.assign({}, R1, { monthKey: '1899-12', overtimeDate: null })], ['date outside month', Object.assign({}, R1, { overtimeDate: '2031-05-01' })],
      ['impossible date', Object.assign({}, R1, { monthKey: '2031-02', overtimeDate: '2031-02-29' })], ['hours 7.5', Object.assign({}, R1, { hours: '7.5' })],
      ['hours 7.10', Object.assign({}, R1, { hours: '7.10' })], ['hours 0.00', Object.assign({}, R1, { hours: '0.00' })], ['hours 744.25', Object.assign({}, R1, { hours: '744.25' })],
      ['hours 07.50', Object.assign({}, R1, { hours: '07.50' })], ['hours number', Object.assign({}, R1, { hours: 7.5 })], ['description newline', Object.assign({}, R1, { workDescription: 'a\nb' })],
      ['description 161', Object.assign({}, R1, { workDescription: 'x'.repeat(161) })], ['notes 2001', Object.assign({}, R1, { notes: 'x'.repeat(2001) })],
      ['notes control', Object.assign({}, R1, { notes: 'a\u0007b' })], ['empty description', Object.assign({}, R1, { workDescription: '' })],
      // AFI-4b2 authorized revision: Approved is now a known status (BF-4b2 OvertimeStatus::VALUES).
      // Was: 'status Approved' refused (AFI-4b1 failed closed on it). Now unknown statuses are refused.
      ['status approved (case)', Object.assign({}, R1, { status: 'approved' })], ['status Closed', Object.assign({}, R1, { status: 'Closed' })],
      ['version 0', Object.assign({}, R1, { version: 0 })],
      ['version 2^32', Object.assign({}, R1, { version: 4294967296 })], ['version string', Object.assign({}, R1, { version: '1' })], ['version 1.5', Object.assign({}, R1, { version: 1.5 })]
    ];
    bads.forEach(([label, o]) => check(D.record(P(o)) === null, 'A. refused: ' + label));
    const appr = D.record(P(RA));
    check(!!appr && appr.status === 'Approved' && Object.isFrozen(appr) && keys(appr) === keys(R1), 'A. AFI-4b2: an Approved record decodes (same nine keys — the record carries no money)');
    check(D.record(P(Object.assign({}, RA, { amount: '98765.00' }))) === null && D.monthResponse(P({ overtimeRecords: [R1, Object.assign({}, RA, { approvedAmount: '1.00' })] }), MONTH) === null,
      'A. AFI-4b2: an Approved record with an amount key is refused — money never rides on a record or the month list');
    const list = D.monthResponse(P(CEO_MONTH), MONTH);
    check(!!list && list.length === 4 && Object.isFrozen(list), 'A. a month answer decodes as a frozen list');
    check(D.monthResponse(P({ overtimeRecords: [R1, Object.assign({}, R2, { hours: '2.2' })] }), MONTH) === null, 'A. one malformed item invalidates the whole list');
    check(D.monthResponse(P({ overtimeRecords: [R1] }), '2031-05') === null, 'A. a record of another month invalidates the list');
    check(D.monthResponse(P({ overtimeRecords: [R1], total: 1 }), MONTH) === null && D.monthResponse(P({ records: [R1] }), MONTH) === null, 'A. wrapper keys are exact ({ overtimeRecords })');
    check(D.recordResponse(P(one(R1))) !== null && D.recordResponse(P({ overtimeRecord: R1, extra: 1 })) === null, 'A. { overtimeRecord } is exact');
    check(D.deletedResponse(P({ deleted: { id: ID1 } })) === ID1 && D.deletedResponse(P({ deleted: { id: ID1, ok: true } })) === null
      && D.deletedResponse(P({ deleted: { id: 'x' } })) === null && D.deletedResponse(P({ deleted: ID1 })) === null, 'A. { deleted: { id } } is exact');
  }

  /* ---------- B. strict request encoders ---------- */
  {
    const rt = loadRuntime({});
    const Q = rt.OvertimeRequests;
    const P = (o) => rt.parse(JSON.stringify(o));           // page-realm objects, as the view builds them
    const c = Q.create('e_1', P({ monthKey: MONTH, overtimeDate: '', hours: '7.5', workDescription: '  Fabricated task  ', notes: '' }));
    check(c.ok && keys(c.body) === 'employeeId,hours,monthKey,notes,overtimeDate,workDescription' && c.body.employeeId === 'e_1' && c.body.hours === '7.50'
      && c.body.overtimeDate === null && c.body.notes === null && c.body.workDescription === 'Fabricated task', 'B. create: exact body; 7.5 -> "7.50" string-wise; "" -> null; text trimmed');
    check(Q.hours('8') === '8.00' && Q.hours(' 2.25 ') === '2.25' && Q.hours('007.5') === '7.50' && Q.hours('744') === '744.00' && Q.hours('0.25') === '0.25',
      'B. hours normalized string-wise: 8 -> 8.00, " 2.25 " -> 2.25, 007.5 -> 7.50, 744 -> 744.00');
    check(['7.3', '7.333', '1e2', '-1', '0', '745', '7,5', '.5', '7.', 'abc', ''].every((h) => Q.hours(h) === null), 'B. hours refused: not a quarter, three decimals, exponent, negative, zero, > 744, comma, bare dot');
    const refused = [
      ['bad owner', Q.create('e 1', P({ monthKey: MONTH, hours: '1' }))], ['no month', Q.create('e_1', P({ hours: '1' }))], ['no hours', Q.create('e_1', P({ monthKey: MONTH }))],
      ['date outside month', Q.create('e_1', P({ monthKey: MONTH, hours: '1', overtimeDate: '2031-05-02' }))], ['unknown field', Q.create('e_1', P({ monthKey: MONTH, hours: '1', status: 'Draft' }))],
      ['company', Q.create('e_1', P({ monthKey: MONTH, hours: '1', companyId: 'c' }))], ['description newline', Q.create('e_1', P({ monthKey: MONTH, hours: '1', workDescription: 'a\nb' }))]
    ];
    refused.forEach(([label, r]) => check(r.ok === false && r.fields.length > 0, 'B. create refused before transport: ' + label));
    const u = Q.update(ID1, 3, P({ hours: '8' }), P({ monthKey: MONTH, overtimeDate: '2031-04-03', hours: '8', workDescription: '', notes: '' }));
    check(u.ok && keys(u.body) === 'expectedVersion,hours,id' && u.body.expectedVersion === 3 && u.body.hours === '8.00', 'B. update: exactly id, expectedVersion and the changed field — never employeeId');
    check(!Q.update(ID1, 3, P({})).ok && !Q.update(ID1, 3, P({ employeeId: 'e_2' })).ok && !Q.update(ID1, 0, P({ hours: '1' })).ok && !Q.update('x', 1, P({ hours: '1' })).ok
      && !Q.update(ID1, 1, P({ monthKey: '2031-05' }), P({ monthKey: '2031-05', overtimeDate: '2031-04-03', hours: '1', workDescription: '', notes: '' })).ok,
      'B. update refused: nothing changed, employeeId, bad version, bad id, a month that leaves the date outside it');
    const t = Q.target(ID1, 2);
    check(t.ok && keys(t.body) === 'expectedVersion,id' && !Q.target(ID1, '2').ok && !Q.target(ID1, 4294967296).ok, 'B. delete / submit / review / reject: exactly { id, expectedVersion }');
  }

  /* ---------- C. the month helper and the injectable clock ---------- */
  {
    const rt = loadRuntime({});
    const fake = (y, m, uy, um) => ({ getFullYear: () => y, getMonth: () => m, getUTCFullYear: () => uy, getUTCMonth: () => um });
    check(rt.sessionOvertimeCurrentMonth(fake(2026, 11, 2027, 0)) === '2026-12', 'C. the initial month is the LOCAL calendar month (UTC already January: still 2026-12)');
    check(rt.sessionOvertimeCurrentMonth(fake(2027, 0, 2026, 11)) === '2027-01', 'C. a local January while UTC is still December: 2027-01');
    check(rt.sessionOvertimeCurrentMonth(fake(905, 2, 905, 2)) === '0905-03', 'C. years are zero-padded to four digits');
    const C = rt.OvertimeCalendar;
    check(C.shift('2031-01', -1) === '2030-12' && C.shift('2031-12', 1) === '2032-01' && C.shift('2031-06', 1) === '2031-07', 'C. Previous / Next wrap across years');
    check(C.isMonth('1900-01') && !C.isMonth('1899-12') && !C.isMonth('2031-00') && !C.isMonth('2031-1') && !C.isMonth(' 2031-01'), 'C. months are YYYY-MM from 1900');
    check(C.daysIn('2024-02') === 29 && C.daysIn('2100-02') === 28 && C.daysIn('2000-02') === 29 && C.daysIn('2031-04') === 30 && C.daysIn('2031-12') === 31, 'C. month lengths and leap years');
    check(C.isDateIn('2031-04-30', MONTH) && !C.isDateIn('2031-04-31', MONTH) && !C.isDateIn('2031-05-01', MONTH), 'C. a date belongs to exactly its month');
  }

  /* ---------- D. CEO: section, list, owner labels (D-AFI4b1-1) ---------- */
  {
    const rt = await boot(ME_CEO, { [OT(MONTH)]: [ok(CEO_MONTH)], [EMPS]: [() => labelsGate.promise] });
    var labelsGate = deferred();
    check(/id="swSectionMain" aria-pressed="true"[^>]*>Employees</.test(rt.appHTML()) && /id="swSectionOvertime" aria-pressed="false"[^>]*>Overtime</.test(rt.appHTML())
      && rt.ot().open === false && countOf(rt, OT(MONTH)) === 0, 'D. CEO: sections Employees | Overtime; Employees stays the default; nothing of Overtime is read before it is opened');
    rt.app.fire('swSectionOvertime', 'click'); await flush();
    check(rt.ot().open && rt.ot().month === MONTH && countOf(rt, OT(MONTH)) === 1 && countOf(rt, EMPS) === 1, 'D. opening Overtime reads the injected-clock month and the canonical Employee list (archived included)');
    check(/<h1 class="auth-title" id="authTitle" tabindex="-1">Overtime<\/h1>/.test(rt.appHTML()) && /aria-pressed="true"[^>]*>Overtime</.test(rt.appHTML()) && lastFocus(rt) === 'authTitle',
      'D. the section heading is "Overtime", its button pressed, focus on the heading');
    check((rt.appHTML().match(/<td>Loading…<\/td>/g) || []).length === 4, 'D. while the Employee list loads every owner reads "Loading…"');
    labelsGate.resolve(ok(PEOPLE)); await flush();
    const html = rt.appHTML();
    check(html.indexOf('<td>Fabricated &lt;Alpha&gt; (EMP-001)</td>') !== -1 && html.indexOf('<td>Fabricated Beta (EMP-002)</td>') !== -1
      && html.indexOf('<td>Fabricated Gamma (EMP-003) (archived)</td>') !== -1 && html.indexOf('<td>Unknown employee</td>') !== -1,
      'D. owner labels: "fullName (code)", escaped; "(archived)" for archived; "Unknown employee" for an id not in the list');
    check(/<th scope="col">Date<\/th><th scope="col">Employee<\/th><th scope="col">Hours<\/th><th scope="col">Status<\/th>/.test(html)
      && html.indexOf('<td>2031-04-03</td>') !== -1 && html.indexOf('<td>7.50</td>') !== -1 && html.indexOf('<td>2.25</td>') !== -1 && html.indexOf('<td>Rejected</td>') !== -1,
      'D. the list shows date, owner, hours (exactly as sent) and status');
    check(rt.sessionOvertimeOwnerLabel(rt.AuthBoot.snapshot().principal, 'ready', PEOPLE.employees, 'e_1x') === 'Unknown employee'
      && rt.sessionOvertimeOwnerLabel(rt.AuthBoot.snapshot().principal, 'ready', [E1, Object.assign({}, E2, { id: 'e_1' })], 'e_1') === 'Unknown employee'
      && rt.sessionOvertimeOwnerLabel(rt.AuthBoot.snapshot().principal, 'error', null, 'e_1') === 'Unknown employee',
      'D. a label is never guessed: a near id, a duplicated id or a failed list gives "Unknown employee"');
    check(rt.sessionOvertimeEligible(PEOPLE.employees).map((e) => e.id).join() === 'e_1,e_4', 'D. the create selector holds only live, Active Employees');
    firewall(rt, 'D. CEO list');
  }
  {
    const rt = await open(ME_CEO, { [EMPS]: [err(500, 'internal_error'), ok(PEOPLE)] });
    const html = rt.appHTML();
    check((html.match(/<td>Unknown employee<\/td>/g) || []).length === 4 && /Employee names could not be loaded/.test(html) && /id="swoLabelsRetryBtn"/.test(html),
      'D. a failed Employee list: every owner "Unknown employee", a warning and a retry');
    rt.app.fire('swoLabelsRetryBtn', 'click'); await flush();
    check(countOf(rt, EMPS) === 2 && rt.appHTML().indexOf('<td>Fabricated Beta (EMP-002)</td>') !== -1, 'D. retrying the Employee list restores the labels');
    firewall(rt, 'D. labels retry');
  }

  /* ---------- E. Employee: own records, "You", no selector ---------- */
  {
    const rt = await open(ME_EMP);
    const html = rt.appHTML();
    check(/aria-pressed="false"[^>]*>My profile</.test(html) && /aria-pressed="true"[^>]*>My overtime</.test(html) && /<h1[^>]*>My overtime<\/h1>/.test(html),
      'E. Employee: sections My profile | My overtime; "My overtime" heading');
    check((html.match(/<td>You<\/td>/g) || []).length === 4 && countOf(rt, EMPS) === 0 && countOf(rt, '/api/employees') === 0, 'E. own rows labelled "You"; the Employee list is never read');
    check(rt.sessionOvertimeOwnerLabel(rt.AuthBoot.snapshot().principal, 'ready', null, 'emp_srv_2') === 'Unknown employee', 'E. a record of another Employee would never be labelled "You"');
    rt.app.fire('swoAddBtn', 'click'); await flush();
    check(/id="swoFormTitle"/.test(rt.appHTML()) && !/id="swo-employeeId"/.test(rt.appHTML()), 'E. the Employee create form has no employee selector');
    firewall(rt, 'E. Employee list');
  }

  /* ---------- F. month navigation ---------- */
  {
    const rt = await open(ME_CEO, { [OT('2031-03')]: [ok({ overtimeRecords: [] })], [OT('2031-05')]: [ok({ overtimeRecords: [] })], [OT('2025-12')]: [ok({ overtimeRecords: [] })] });
    rt.app.fire('swoPrevMonth', 'click'); await flush();
    check(rt.ot().month === '2031-03' && countOf(rt, OT('2031-03')) === 1 && /No overtime records for March 2031/.test(rt.appHTML()), 'F. Previous reads March 2031');
    rt.app.fire('swoNextMonth', 'click'); await flush(); rt.app.fire('swoNextMonth', 'click'); await flush();
    check(rt.ot().month === '2031-05' && countOf(rt, OT(MONTH)) === 2 && countOf(rt, OT('2031-05')) === 1, 'F. Next, Next reads April again, then May');
    rt.app.set('swoMonth', '2025-12'); await flush();
    check(rt.ot().month === '2025-12' && countOf(rt, OT('2025-12')) === 1, 'F. the month field reads the chosen month');
    const n = rt.net.calls.length;
    rt.app.set('swoMonth', '2031-13'); rt.app.set('swoMonth', '1899-12'); rt.app.set('swoMonth', ''); await flush();
    check(rt.ot().month === '2025-12' && rt.net.calls.length === n, 'F. an invalid month is ignored (no request)');
    rt.app.fire('swSectionMain', 'click'); await flush();
    check(/<h1[^>]*>Employees<\/h1>/.test(rt.appHTML()) && rt.ot().month === '2025-12', 'F. switching to Employees keeps the month in memory');
    rt.app.fire('swSectionOvertime', 'click'); await flush();
    check(rt.ot().month === '2025-12' && rt.net.calls.length === n + 0 + (countOf(rt, '/api/employees') - 1) && /December 2025/.test(rt.appHTML()), 'F. back on Overtime: the same month, re-rendered from memory without a new read');
    firewall(rt, 'F. month navigation');
  }

  /* ---------- G. detail + control matrix ---------- */
  {
    // AFI-4b2 authorized revision: CEO + Reviewed is Approve, Reject (Approve waits for a preview).
    // Was: CEO + Reviewed exactly [Reject].
    const cases = [[ME_CEO, R1, 'Edit,Delete,Submit'], [ME_CEO, R2, 'Review,Reject'], [ME_CEO, R3, 'Approve,Reject'], [ME_CEO, R4, ''],
      [ME_EMP, S1, 'Edit,Delete,Submit'], [ME_EMP, S2, ''], [ME_EMP, S3, ''], [ME_EMP, S4, '']];
    for(const [me, r, want] of cases){
      const rt = await detail(me, r.id, r);
      const html = rt.appHTML();
      const who = me.role === 'ceo' ? 'CEO' : 'Employee';
      check(buttons(html) === want, 'G. ' + who + ' + ' + r.status + ': exactly [' + want + ']' + (buttons(html) === want ? '' : ' >> ' + buttons(html)));
      const asks = me.role === 'ceo' && r.status === 'Reviewed' ? 1 : 0;
      check(valuationCalls(rt) === asks, 'G. ' + who + ' + ' + r.status + ': ' + (asks ? 'exactly one valuation read (the preview)' : 'no valuation request at all'));
      if(r === R1) check(/<h1[^>]*>Overtime record<\/h1>/.test(html) && html.indexOf('<td>Fabricated &lt;b&gt;task&lt;/b&gt;</td>') !== -1 && html.indexOf('<td>April 2031</td>') !== -1
        && html.indexOf('<td>Fabricated &lt;Alpha&gt; (EMP-001)</td>') !== -1 && /id="swoBackBtn"/.test(html), 'G. the detail is read-only text, escaped, with the owner label and Back');
    }
    const p = { principalType: 'employee', employeeId: 'emp_srv_1' };
    const loadRt = loadRuntime({});
    check(loadRt.sessionOvertimeActions(p, Object.assign({}, S1, { employeeId: 'emp_srv_2' })).length === 0 && loadRt.sessionOvertimeActions(null, S1).length === 0
      && loadRt.sessionOvertimeActions({ principalType: 'ceo' }, Object.assign({}, R1, { status: 'Closed' })).length === 0,
      'G. the matrix offers nothing on another Employee\'s Draft, without a principal, or for an unknown status');
    // AFI-4b2: Approved is terminal for everyone; approve is the CEO's, on Reviewed only.
    check(loadRt.sessionOvertimeActions({ principalType: 'ceo' }, RA).length === 0 && loadRt.sessionOvertimeActions(p, S5).length === 0
      && loadRt.sessionOvertimeActions(p, S3).length === 0 && loadRt.sessionOvertimeActions({ principalType: 'ceo' }, R5).join() === 'approve,reject',
      'G. AFI-4b2 matrix: Approved offers nothing (CEO or owner); an Employee\'s Reviewed offers nothing; CEO + Reviewed = approve, reject');
    const rt = await detail(ME_EMP, IDS2, S2);
    const n = rt.net.calls.length;
    rt.SessionOvertime.openEdit(); rt.SessionOvertime.openPanel('delete'); rt.SessionOvertime.openPanel('review'); rt.SessionOvertime.openPanel('reject'); rt.SessionOvertime.openPanel('submit'); await flush();
    check(rt.ot().form === null && rt.ot().panel === null && rt.net.calls.length === n, 'G. the controller refuses edit / delete / submit / review / reject the matrix does not offer (UX is not the only guard)');
    firewall(rt, 'G. matrix');
  }

  /* ---------- H. create ---------- */
  {
    const NEW = rec(IDN, 'e_1', 'Draft', 1, { overtimeDate: null, workDescription: null });
    const rt = await open(ME_CEO, { [W.create]: [ok(one(NEW))], [REC(IDN)]: [ok(one(NEW))] });
    rt.app.fire('swoAddBtn', 'click'); await flush();
    let html = rt.appHTML();
    check(lastFocus(rt) === 'swoFormTitle' && /<option value="0">Fabricated &lt;Alpha&gt; \(EMP-001\)<\/option><option value="1">Fabricated Delta \(EMP-004\)<\/option><\/select>/.test(html)
      && !/EMP-002|EMP-003/.test(html.slice(html.indexOf('swo-employeeId'), html.indexOf('</select>'))),
      'H. CEO create: focus on the form; the selector lists only live, Active Employees, by position');
    check(/id="swo-hours"[^>]*inputmode="decimal"|inputmode="decimal"[^>]*id="swo-hours"/.test(html) && /id="swo-overtimeDate"[^>]*min="2031-04-01" max="2031-04-30"/.test(html)
      && /<label for="swo-hours">Hours/.test(html) && /id="swo-hours-hint"/.test(html), 'H. hours is a decimal text field with quarter-hour guidance; the date is limited to the month');
    rt.app.fire('swoForm', 'submit'); await flush();
    check(posts(rt).length === 0 && /id="swo-employeeId"[^>]*aria-invalid="true"/.test(rt.appHTML()) && /id="swo-hours"[^>]*aria-invalid="true"/.test(rt.appHTML())
      && lastFocus(rt) === 'swo-employeeId', 'H. nothing chosen: refused locally — no request, the owner and hours marked, focus on the first');
    rt.app.set('swo-employeeId', '1'); rt.app.set('swo-monthKey', '2031-05'); await flush();
    check(/id="swo-overtimeDate"[^>]*min="2031-05-01" max="2031-05-31"/.test(rt.appHTML()) && rt.ot().form.values.employeeId === 'e_4', 'H. changing the form month moves the date range; the owner is held by id in memory only');
    rt.app.set('swo-monthKey', MONTH); rt.app.set('swo-employeeId', '0'); rt.app.set('swo-hours', '7.5'); rt.app.set('swo-workDescription', '  ');
    rt.app.fire('swoForm', 'submit'); await flush();
    const p = posts(rt, W.create);
    check(p.length === 1 && keys(bodyOf(p[0])) === 'employeeId,hours,monthKey,notes,overtimeDate,workDescription' && bodyOf(p[0]).employeeId === 'e_1'
      && bodyOf(p[0]).hours === '7.50' && bodyOf(p[0]).overtimeDate === null && p[0].init.headers['X-CSRF-Token'] === CSRF,
      'H. CEO create: one CSRF POST, body exactly { employeeId: selected id, monthKey, overtimeDate, hours "7.50", workDescription, notes }');
    html = rt.appHTML();
    check(rt.ot().detailId === IDN && /Overtime record created as a Draft\./.test(html) && lastFocus(rt) === 'swoMutationMessage' && rt.ot().listStale === true,
      'H. a confirmed create shows the new Draft and a status notice; focus on it; the list is stale');
    rt.app.fire('swoBackBtn', 'click'); await flush();
    check(countOf(rt, OT(MONTH)) === 2, 'H. back to the list: the month is read again');
    firewall(rt, 'H. CEO create');
  }
  {
    const NEW = rec(IDN, 'emp_srv_1', 'Draft', 1);
    const rt = await open(ME_EMP, { [W.create]: [ok(one(NEW))] });
    rt.app.fire('swoAddBtn', 'click'); await flush();
    rt.app.set('swo-hours', '2'); rt.app.set('swo-overtimeDate', '2031-04-03');
    rt.app.fire('swoForm', 'submit'); await flush();
    const p = posts(rt, W.create);
    check(p.length === 1 && bodyOf(p[0]).employeeId === 'emp_srv_1' && bodyOf(p[0]).hours === '2.00' && bodyOf(p[0]).overtimeDate === '2031-04-03',
      'H. Employee create: employeeId is the principal\'s own id (a target selector), hours "2.00"');
    firewall(rt, 'H. Employee create');
  }
  {
    // A create answer that does not confirm (another owner / not version 1) is never a success.
    for(const [label, bad] of [['another owner', rec(IDN, 'e_4', 'Draft', 1)], ['version 2', rec(IDN, 'e_1', 'Draft', 2)], ['Submitted', rec(IDN, 'e_1', 'Submitted', 1)]]){
      const rt = await open(ME_CEO, { [W.create]: [ok(one(bad))] });
      rt.app.fire('swoAddBtn', 'click'); await flush();
      rt.app.set('swo-employeeId', '0'); rt.app.set('swo-hours', '1');
      rt.app.fire('swoForm', 'submit'); await flush();
      check(rt.ot().mutation.status === 'ambiguous' && rt.ot().detailId === null && countOf(rt, OT(MONTH)) === 2 && posts(rt).length === 1
        && /could not confirm whether the record was created/.test(rt.appHTML()) && !/created as a Draft/.test(rt.appHTML()),
        'H. a non-confirming create answer (' + label + ') is unconfirmed: the month is read again, nothing resent, no success shown');
    }
  }

  /* ---------- I. edit ---------- */
  {
    const R1b = Object.assign({}, R1, { hours: '8.00', version: 2 });
    const rt = await detail(ME_CEO, ID1, R1, { [W.update]: [ok(one(R1b))] });
    rt.app.fire('swoEditBtn', 'click'); await flush();
    check(/<h1[^>]*>Edit overtime<\/h1>/.test(rt.appHTML()) && /value="7.50"/.test(rt.appHTML()) && !/id="swo-employeeId"/.test(rt.appHTML()) && lastFocus(rt) === 'swoFormTitle',
      'I. Edit starts from the decoded record; the owner is shown, not editable');
    rt.app.set('swo-hours', '7.5'); rt.app.set('swo-workDescription', ' Fabricated <b>task</b> ');
    rt.app.fire('swoForm', 'submit'); await flush();
    check(posts(rt).length === 0 && /No changes to save\./.test(rt.appHTML()), 'I. "7.5" for "7.50" and surrounding spaces are no change: no request');
    rt.app.set('swo-hours', '8');
    rt.app.fire('swoForm', 'submit'); await flush();
    const p = posts(rt, W.update);
    check(p.length === 1 && keys(bodyOf(p[0])) === 'expectedVersion,hours,id' && bodyOf(p[0]).id === ID1 && bodyOf(p[0]).expectedVersion === 1 && bodyOf(p[0]).hours === '8.00',
      'I. Save sends only the changed field with expectedVersion = the held version — never employeeId');
    check(rt.ot().detail.version === 2 && /Overtime record saved\./.test(rt.appHTML()) && rt.ot().form === null, 'I. a confirmed update becomes the detail (version 2)');
    rt.app.fire('swoEditBtn', 'click'); await flush(); rt.app.set('swo-notes', 'draft note'); rt.app.fire('swoFormCancel', 'click'); await flush();
    check(rt.ot().form === null && !/draft note/.test(rt.appHTML()), 'I. Cancel discards the local draft');
    firewall(rt, 'I. edit');
  }
  {
    const rt = await detail(ME_CEO, ID1, R1, { [W.update]: [errF(['hours'])] });
    rt.app.fire('swoEditBtn', 'click'); await flush(); rt.app.set('swo-hours', '9');
    rt.app.fire('swoForm', 'submit'); await flush();
    check(/id="swo-hours"[^>]*aria-invalid="true"[^>]*aria-describedby="swo-hours-hint swo-hours-error"/.test(rt.appHTML()) && lastFocus(rt) === 'swo-hours'
      && /Some entries need attention/.test(rt.appHTML()) && rt.ot().form.values.hours === '9', 'I. a server 400 naming hours marks it (aria-invalid + described error), focuses it, keeps the draft');
    rt.app.set('swo-overtimeDate', '2031-05-01'); rt.app.fire('swoForm', 'submit'); await flush();
    check(posts(rt).length === 1 && /id="swo-overtimeDate"[^>]*aria-invalid="true"/.test(rt.appHTML()), 'I. a date outside the month is refused locally (no request)');
  }

  /* ---------- J. delete ---------- */
  {
    const gate = deferred();
    const rt = await detail(ME_CEO, ID1, R1, { [W.delete]: [() => gate.promise], [OT(MONTH)]: [ok(CEO_MONTH), ok({ overtimeRecords: [R2, R3, R4] })] });
    rt.app.fire('swoDeleteBtn', 'click'); await flush();
    const html = rt.appHTML();
    check(/id="swoPanelTitle" tabindex="-1">Delete this Draft\?</.test(html) && lastFocus(rt) === 'swoPanelTitle' && posts(rt).length === 0
      && html.indexOf('Fabricated &lt;Alpha&gt; (EMP-001) — April 2031, 2031-04-03 — 7.50 hours (Draft).') !== -1 && rt.access.url.length === 0,
      'J. Delete opens an inline panel (no browser confirm()) naming owner, month, date and hours, escaped; focus on it; nothing sent');
    rt.app.fire('swoPanelCancel', 'click'); await flush();
    check(rt.ot().panel === null && posts(rt).length === 0, 'J. Cancel closes the panel; nothing sent');
    rt.app.fire('swoDeleteBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(posts(rt, W.delete).length === 1 && keys(bodyOf(posts(rt, W.delete)[0])) === 'expectedVersion,id' && rt.ot().detail && rt.ot().detail.id === ID1
      && /aria-busy="true"/.test(rt.appHTML()) && /Deleting…/.test(rt.appHTML()) && rt.app.fire('swoPanelConfirm', 'click') === 'disabled',
      'J. confirm sends { id, expectedVersion } once; the record stays shown while pending (no optimistic removal); controls disabled, aria-busy');
    check(rt.app.fire('swSectionMain', 'click') === 'disabled', 'J. the section switch is disabled while a write is pending');
    gate.resolve(ok({ deleted: { id: ID1 } })); await flush();
    check(rt.ot().detailId === null && countOf(rt, OT(MONTH)) === 2 && /Draft deleted\./.test(rt.appHTML()) && rt.ot().list.length === 3 && lastFocus(rt) === 'swoMutationMessage',
      'J. a confirmed delete closes the record, reads the month again (row gone from the server answer), announces it');
    firewall(rt, 'J. delete');
  }
  {
    const rt = await detail(ME_CEO, ID1, R1, { [W.delete]: [ok({ deleted: { id: ID2 } })], [REC(ID1)]: [ok(one(R1))] });
    rt.app.fire('swoDeleteBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(rt.ot().mutation.status === 'ambiguous' && countOf(rt, REC(ID1)) === 2 && !/Draft deleted\./.test(rt.appHTML()), 'J. { deleted } naming another id is not a success: unconfirmed, the record is read again');
  }

  /* ---------- K. transitions ---------- */
  for(const [me, r, op, to, label] of [[ME_EMP, S1, 'submit', 'Submitted', 'Submit'], [ME_CEO, R1, 'submit', 'Submitted', 'Submit'], [ME_CEO, R2, 'review', 'Reviewed', 'Review'],
    [ME_CEO, R2, 'reject', 'Rejected', 'Reject'], [ME_CEO, R3, 'reject', 'Rejected', 'Reject']]){
    const after = Object.assign({}, r, { status: to, version: r.version + 1 });
    const rt = await detail(me, r.id, r, { [W[op]]: [ok(one(after))] });
    rt.app.fire('swo' + label + 'Btn', 'click'); await flush();
    check(lastFocus(rt) === 'swoPanelTitle' && posts(rt).length === 0, 'K. ' + (me.role === 'ceo' ? 'CEO' : 'Employee') + ' ' + op + ' ' + r.status + ': a panel first, nothing sent');
    rt.app.fire('swoPanelConfirm', 'click'); await flush();
    const p = posts(rt, W[op]);
    check(p.length === 1 && keys(bodyOf(p[0])) === 'expectedVersion,id' && bodyOf(p[0]).id === r.id && bodyOf(p[0]).expectedVersion === r.version
      && rt.ot().detail.status === to && rt.ot().panel === null && lastFocus(rt) === 'swoMutationMessage',
      'K. ' + op + ': { id, expectedVersion } once; the confirmed record is now ' + to);
    firewall(rt, 'K. ' + op);
  }
  for(const [op, from, wrong] of [['submit', R1, 'Draft'], ['review', R2, 'Rejected'], ['reject', R3, 'Reviewed']]){
    const rt = await detail(ME_CEO, from.id, from, { [W[op]]: [ok(one(Object.assign({}, from, { status: wrong })))] });
    rt.app.fire('swo' + op[0].toUpperCase() + op.slice(1) + 'Btn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(rt.ot().mutation.status === 'ambiguous' && countOf(rt, REC(from.id)) === 2 && posts(rt).length === 1, 'K. ' + op + ' answered with status ' + wrong + ' is not confirmed: the record is read again, nothing resent');
  }

  /* ---------- L. 400 / 403 / 404 / 409 ---------- */
  {
    const rt = await detail(ME_CEO, ID2, R2, { [W.review]: [err(403, 'forbidden')], '/api/auth/me': [ok(ME_CEO)] });
    rt.app.fire('swoReviewBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(posts(rt).length === 1 && /You do not have permission to make this change\./.test(rt.appHTML()) && rt.state() === 'AUTHENTICATED' && rt.ot().panel !== null,
      'L. 403 with an unchanged CSRF token is a genuine denial: one request, a fixed message, still signed in');
  }
  {
    const rt = await detail(ME_CEO, ID1, R1, { [W.submit]: [err(404, 'not_found')] });
    rt.app.fire('swoSubmitBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(rt.ot().detailId === null && countOf(rt, OT(MONTH)) === 2 && /no longer available\. The list was reloaded\./.test(rt.appHTML()), 'L. 404 closes the record and reads the month again');
  }
  {
    const R1v2 = Object.assign({}, R1, { version: 2, hours: '3.00' });
    const R1s = Object.assign({}, R1v2, { status: 'Submitted', version: 3 });
    const rt = await detail(ME_CEO, ID1, R1, { [W.submit]: [err(409, 'conflict'), ok(one(R1s))], [REC(ID1)]: [ok(one(R1)), ok(one(R1v2))] });
    rt.app.fire('swoSubmitBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(posts(rt).length === 1 && rt.ot().panel !== null && /id="swoReloadBtn"/.test(rt.appHTML()) && /changed or the action is no longer available/.test(rt.appHTML()),
      'L. 409: no retry, the panel stays, "Reload record" offered');
    rt.app.fire('swoReloadBtn', 'click'); await flush();
    check(countOf(rt, REC(ID1)) === 2 && rt.ot().detail.version === 2 && rt.ot().panel === null, 'L. Reload record reads the record again (version 2) and closes the stale panel');
    rt.app.fire('swoSubmitBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(posts(rt).length === 2 && bodyOf(posts(rt)[1]).expectedVersion === 2 && rt.ot().detail.status === 'Submitted', 'L. the next confirm uses the reloaded version');
  }
  {
    const rt = await detail(ME_CEO, ID1, R1, { [W.update]: [err(409, 'conflict')], [REC(ID1)]: [ok(one(R1)), ok(one(Object.assign({}, R1, { version: 5 })))] });
    rt.app.fire('swoEditBtn', 'click'); await flush(); rt.app.set('swo-hours', '4'); rt.app.fire('swoForm', 'submit'); await flush();
    check(rt.ot().form && rt.ot().form.values.hours === '4' && /id="swoReloadBtn"/.test(rt.appHTML()), 'L. an edit 409 keeps the draft and offers Reload record');
    rt.app.fire('swoReloadBtn', 'click'); await flush();
    check(rt.ot().form.values.hours === '4' && rt.ot().detail.version === 5 && /Your edits are kept/.test(rt.appHTML()), 'L. reloading keeps the edits; Save will use version 5');
  }
  {
    const rt = await open(ME_CEO, { [OT(MONTH)]: [err(503, 'service_unavailable'), ok(CEO_MONTH)] });
    check(/Overtime information could not be loaded/.test(rt.appHTML()) && /id="swoRetryBtn"/.test(rt.appHTML()), 'L. a failed month read: a message and Retry');
    rt.app.fire('swoRetryBtn', 'click'); await flush();
    check(rt.ot().list && rt.ot().list.length === 4, 'L. Retry reads the month again');
  }

  /* ---------- M. CSRF recovery and the session ---------- */
  {
    const after = Object.assign({}, R1, { status: 'Submitted', version: 2 });
    const rt = await detail(ME_CEO, ID1, R1, { [W.submit]: [err(403, 'forbidden'), ok(one(after))], '/api/auth/me': [ok(ME_CEO), ok(Object.assign({}, ME_CEO, { csrfToken: CSRF2 }))] });
    rt.app.fire('swoSubmitBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    const p = posts(rt, W.submit);
    check(p.length === 2 && p[0].init.headers['X-CSRF-Token'] === CSRF && p[1].init.headers['X-CSRF-Token'] === CSRF2 && p[0].init.body === p[1].init.body
      && countOf(rt, '/api/auth/me') === 2 && rt.ot().detail.status === 'Submitted', 'M. a stale CSRF token: one /me refresh, exactly one replay with the new token');
  }
  for(const [label, meAnswer, want] of [['signed_out', err(401, 'unauthenticated'), 'SIGNED_OUT'], ['unavailable', err(503, 'service_unavailable'), 'UNAVAILABLE']]){
    const rt = await detail(ME_CEO, ID1, R1, { [W.delete]: [err(403, 'forbidden')], '/api/auth/me': [ok(ME_CEO), meAnswer] });
    rt.app.fire('swoDeleteBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(rt.state() === want && posts(rt).length === 1 && rt.ot().open === false && rt.ot().detail === null && rt.ot().list === null && rt.ot().month === null,
      'M. recovery ' + label + ': no replay, ' + want + ', every Overtime datum destroyed');
  }
  {
    const rt = await detail(ME_CEO, ID1, R1, { [W.delete]: [err(403, 'forbidden')], '/api/auth/me': [ok(ME_CEO), ok({ userId: 'u_ceo_9', membershipId: 'm_9', role: 'ceo', employeeId: null, csrfToken: CSRF2 })] });
    rt.app.fire('swoDeleteBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(posts(rt).length === 1 && rt.ot().open === false && rt.ot().list === null, 'M. recovery principal_changed: no replay, the Overtime data cleared');
  }
  {
    const rt = await open(ME_CEO, { [REC(ID1)]: [err(401, 'unauthenticated')] });
    rt.app.fire('swoOpen0', 'click'); await flush();
    check(rt.state() === 'SIGNED_OUT' && rt.ot().open === false && rt.ot().list === null, 'M. a read answered 401 ends the session and destroys the Overtime data');
    const rt2 = await detail(ME_CEO, ID1, R1, { [W.submit]: [err(401, 'unauthenticated')] });
    rt2.app.fire('swoSubmitBtn', 'click'); await flush(); rt2.app.fire('swoPanelConfirm', 'click'); await flush();
    check(rt2.state() === 'SIGNED_OUT' && rt2.ot().detail === null, 'M. a write answered 401 ends the session');
  }

  /* ---------- N. ambiguous writes: never resent, reconciled by reading ---------- */
  {
    const rt = await open(ME_CEO, { [W.create]: [err(503, 'service_unavailable')] });
    rt.app.fire('swoAddBtn', 'click'); await flush(); rt.app.set('swo-employeeId', '0'); rt.app.set('swo-hours', '1'); rt.app.fire('swoForm', 'submit'); await flush();
    check(posts(rt).length === 1 && countOf(rt, OT(MONTH)) === 2 && /could not confirm whether the record was created\. The list below was read again from TAM OS — check it before adding the record again\./.test(rt.appHTML())
      && rt.ot().form !== null && lastFocus(rt) === 'swoMutationMessage', 'N. create 503: not resent, the month read again, "check the list before adding again", the draft kept');
  }
  {
    const rt = await detail(ME_CEO, ID1, R1, { [W.update]: [NETFAIL], [REC(ID1)]: [ok(one(R1)), ok(one(Object.assign({}, R1, { hours: '6.00', version: 2 })))] });
    rt.app.fire('swoEditBtn', 'click'); await flush(); rt.app.set('swo-hours', '6'); rt.app.fire('swoForm', 'submit'); await flush();
    check(posts(rt).length === 1 && countOf(rt, REC(ID1)) === 2 && /The record was read again from TAM OS — check it before saving again\./.test(rt.appHTML()), 'N. update network failure: not resent, the record read again');
  }
  {
    const rt = await detail(ME_CEO, ID1, R1, { [W.submit]: ['HANG'], [REC(ID1)]: [ok(one(R1)), ok(one(Object.assign({}, R1, { status: 'Submitted', version: 2 })))] });
    rt.app.fire('swoSubmitBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    rt.net.timers.splice(0).forEach((fn) => fn()); await flush();
    check(posts(rt).length === 1 && countOf(rt, REC(ID1)) === 2 && /could not confirm the change, but the record read again is now Submitted\./.test(rt.appHTML()),
      'N. submit timeout: not resent; reconciled — the record read again is Submitted');
  }
  for(const [op, from] of [['review', R2], ['reject', R2]]){
    const rt = await detail(ME_CEO, from.id, from, { [W[op]]: [err(503, 'service_unavailable')], [REC(from.id)]: [ok(one(from))] });
    rt.app.fire('swo' + op[0].toUpperCase() + op.slice(1) + 'Btn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(posts(rt).length === 1 && countOf(rt, REC(from.id)) === 2 && rt.ot().panel === null && /The record read again is Submitted, not/.test(rt.appHTML()),
      'N. ' + op + ' 503: not resent; reconciled — still Submitted, the action was not applied');
  }
  {
    const rt = await detail(ME_CEO, ID1, R1, { [W.delete]: [err(503, 'service_unavailable')], [REC(ID1)]: [ok(one(R1)), err(404, 'not_found')] });
    rt.app.fire('swoDeleteBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(posts(rt).length === 1 && /could not confirm the deletion\. When the record was read again it no longer existed: the Draft is gone\./.test(rt.appHTML()) && !/Draft deleted\./.test(rt.appHTML()),
      'N. delete 503 + reread 404: "the Draft is gone" — never reported as a confirmed deletion');
  }
  {
    const rt = await detail(ME_CEO, ID1, R1, { [W.delete]: [err(503, 'service_unavailable')], [REC(ID1)]: [ok(one(R1))] });
    rt.app.fire('swoDeleteBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(posts(rt).length === 1 && /still exists unchanged: the Draft was not deleted, and you may try again\./.test(rt.appHTML()) && buttons(rt.appHTML()) === 'Edit,Delete,Submit',
      'N. delete 503 + same version: "not deleted, you may try again" — Delete offered again');
  }
  {
    const rt = await detail(ME_CEO, ID1, R1, { [W.delete]: [resp(200, '<html>proxy</html>', { 'content-type': 'text/html' })], [REC(ID1)]: [ok(one(R1)), ok(one(Object.assign({}, R1, { version: 2 })))] });
    rt.app.fire('swoDeleteBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(posts(rt).length === 1 && /record read again has changed/.test(rt.appHTML()), 'N. delete with a non-canonical answer + changed version: unconfirmed, "has changed — check it"');
  }

  /* ---------- O. stale answers ---------- */
  {
    const gA = deferred();
    const rt = await open(ME_CEO, { [OT('2031-03')]: [() => gA.promise], [OT('2031-05')]: [ok({ overtimeRecords: [rec(IDN, 'e_1', 'Draft', 1, { monthKey: '2031-05', overtimeDate: null })] })] });
    rt.app.fire('swoPrevMonth', 'click'); await flush();
    rt.SessionOvertime.setMonth('2031-05'); await flush();
    gA.resolve(ok({ overtimeRecords: [] })); await flush();
    check(rt.ot().month === '2031-05' && rt.ot().list.length === 1 && rt.ot().listMonth === '2031-05', 'O. a superseded month answer arriving late is dropped');
  }
  {
    const g1 = deferred();
    const rt = await open(ME_CEO, { [REC(ID1)]: [() => g1.promise], [REC(ID2)]: [ok(one(R2))] });
    rt.app.fire('swoOpen0', 'click'); await flush();
    rt.app.fire('swoBackBtn', 'click'); await flush();
    rt.app.fire('swoOpen1', 'click'); await flush();
    g1.resolve(ok(one(R1))); await flush();
    check(rt.ot().detailId === ID2 && rt.ot().detail.id === ID2 && buttons(rt.appHTML()) === 'Review,Reject', 'O. a superseded detail answer arriving late is dropped');
  }
  {
    const gL = deferred();
    const rt = await open(ME_CEO, { [EMPS]: [() => gL.promise] });
    const t1 = rt.SessionOvertimeStore.begin('labels');
    const t2 = rt.SessionOvertimeStore.begin('labels');
    check(rt.SessionOvertimeStore.applyLabels(t1, [E1]) === false && rt.SessionOvertimeStore.applyLabels(t2, PEOPLE.employees) === true, 'O. a superseded labels token is refused; the latest applies');
    rt.SessionOvertimeStore.clear();
    gL.resolve(ok({ employees: [Object.assign({}, E1, { id: 'e_2' })] })); await flush();
    check(rt.ot().people === null, 'O. a labels answer from before clear() (another generation) is dropped — never mislabels');
  }
  {
    // The store refuses a superseded token on its own (defence in depth behind run()).
    const rt = loadRuntime({});
    const S = rt.SessionOvertimeStore;
    const l1 = S.begin('list', MONTH), l2 = S.begin('list', MONTH);
    check(S.applyList(l1, []) === false && S.applyError(l1, { kind: 'UNAVAILABLE' }) === false && S.applyList(l2, [R1]) === true && S.snapshot().list.length === 1,
      'O. store: a superseded list token can apply neither data nor an error; the latest applies');
    const d1 = S.begin('detail', ID1), d2 = S.begin('detail', ID2);
    check(S.applyDetail(d1, R1) === false && S.applyError(d1, { kind: 'NOT_FOUND' }) === false && S.applyDetail(d2, R2) === true && S.snapshot().detail.id === ID2,
      'O. store: a superseded detail token is refused; the latest applies');
    const live = S.begin('list', MONTH);
    S.clear();
    check(S.applyList(live, [R1]) === false && S.applyList(S.begin('list', MONTH), []) === true, 'O. store: a token from before clear() (older generation) is refused');
  }
  {
    const g1 = deferred();
    const rt = await open(ME_CEO, { [REC(ID1)]: [() => g1.promise], [REC(ID2)]: [ok(one(R2))] });
    rt.app.fire('swoOpen0', 'click'); await flush();
    rt.app.fire('swoBackBtn', 'click'); await flush();
    rt.app.fire('swoOpen1', 'click'); await flush();
    g1.resolve(err(401, 'unauthenticated')); await flush();
    check(rt.state() === 'AUTHENTICATED' && rt.ot().detail.id === ID2, 'O. a superseded read answering 401 late is dropped — it does not end the session');
  }
  {
    const gW = deferred();
    const rt = await detail(ME_CEO, ID1, R1, { [W.submit]: [() => gW.promise] });
    rt.app.fire('swoSubmitBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    rt.net.routes['/api/auth/me'] = [ok({ userId: 'u_ceo_2', membershipId: 'm_ceo_2', role: 'ceo', employeeId: null, csrfToken: CSRF2 })];
    await rt.SessionIdentityProvider.refresh(); rt.render(); await flush();
    check(rt.ot().detail === null && rt.ot().open === false, 'O. the next render binds the new principal: the earlier identity\'s Overtime data is gone');
    gW.resolve(err(401, 'unauthenticated')); await flush();
    check(rt.state() === 'AUTHENTICATED' && rt.AuthBoot.snapshot().principal.id === 'u_ceo_2', 'O. a write of an earlier identity answering 401 late is dropped — the new session is not ended');
  }
  {
    const gW = deferred();
    const rt = await detail(ME_CEO, ID1, R1, { [W.submit]: [() => gW.promise], '/api/auth/logout': [ok({})] });
    rt.app.fire('swoSubmitBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    await rt.AuthBoot.signOut(); await flush();
    gW.resolve(ok(one(Object.assign({}, R1, { status: 'Submitted', version: 2 })))); await flush();
    check(rt.state() === 'SIGNED_OUT' && rt.ot().detail === null && rt.ot().mutation.status === 'idle' && !/Overtime record submitted/.test(rt.appHTML()),
      'O. logout mid-write: the late answer is dropped; nothing of it is shown or kept');
  }
  {
    const gM = deferred();
    const rt = await open(ME_CEO, { [OT('2031-03')]: [() => gM.promise], '/api/auth/logout': [ok({})] });
    rt.app.fire('swoPrevMonth', 'click'); await flush();
    await rt.AuthBoot.signOut(); await flush();
    gM.resolve(ok(CEO_MONTH)); await flush();
    check(rt.state() === 'SIGNED_OUT' && rt.ot().list === null && rt.ot().month === null, 'O. logout mid-read: the late month answer is dropped');
  }

  /* ---------- P. principal change / generation ---------- */
  {
    const rt = await open(ME_CEO);
    rt.app.fire('swoPrevMonth', 'click'); await flush();
    const gen = rt.ot().generation;
    rt.net.routes['/api/auth/me'] = [ok(ME_EMP)];
    rt.net.routes[OT(MONTH)] = [ok(EMP_MONTH)];
    await rt.SessionIdentityProvider.refresh(); rt.AuthBoot.snapshot();
    rt.app.fire('swSectionMain', 'click'); await flush();
    check(rt.ot().generation > gen && rt.ot().open === false && rt.ot().month === null && rt.ot().people === null && rt.ot().list === null,
      'P. a different principal destroys the Overtime data (new generation; month, list, labels gone)');
    rt.app.fire('swSectionOvertime', 'click'); await flush();
    check(rt.ot().month === MONTH && (rt.appHTML().match(/<td>You<\/td>/g) || []).length === 4, 'P. the new principal starts again from the clock month with their own data');
  }
  {
    const rt = await boot(ME_EMP2, { '/api/employee?id=emp_srv_2': [ok(Object.assign({}, SELF, { id: 'emp_srv_2' }))], [OT(MONTH)]: [ok({ overtimeRecords: [] })], [W.create]: [ok(one(rec(IDN, 'emp_srv_2', 'Draft', 1)))] });
    rt.app.fire('swSectionOvertime', 'click'); await flush();
    rt.app.fire('swoAddBtn', 'click'); await flush(); rt.app.set('swo-hours', '1'); rt.app.fire('swoForm', 'submit'); await flush();
    check(bodyOf(posts(rt, W.create)[0]).employeeId === 'emp_srv_2', 'P. each Employee creates only for their own principal.employeeId');
  }

  /* ---------- Q. accessibility, keyboard, focus ---------- */
  {
    const rt = await open(ME_EMP, { [W.create]: [ok(one(rec(IDN, 'emp_srv_1', 'Draft', 1)))] });
    rt.app.fire('swoAddBtn', 'click'); await flush();
    const html = rt.appHTML();
    const ids = (html.match(/<(input|select|textarea)[^>]*\sid="swo-[A-Za-z]+"/g) || []).map((m) => /id="(swo-[A-Za-z]+)"/.exec(m)[1]);
    check(ids.length === 5 && ids.every((id) => (html.match(new RegExp('<label for="' + id + '">', 'g')) || []).length === 1), 'Q. every form control has exactly one label');
    check(/id="swo-hours"[^>]*aria-required="true"/.test(html) && /id="swo-monthKey"[^>]*aria-required="true"/.test(html) && /<form id="swoForm" method="post" novalidate>/.test(html),
      'Q. required fields are marked; the form is a real form (keyboard Enter submits)');
    rt.app.set('swo-hours', '1');
    rt.app.fire('swoForm', 'submit'); await flush();
    check(posts(rt).length === 1 && lastFocus(rt) === 'swoMutationMessage' && /role="status" tabindex="-1">Overtime record created/.test(rt.appHTML()),
      'Q. keyboard submission runs the same guarded handler; the confirmation is a focused status message');
    check(/<nav aria-label="Workspace sections">/.test(rt.appHTML()) && /aria-pressed="true"/.test(rt.appHTML()), 'Q. the section switch is a labelled nav of pressed / unpressed buttons');
  }

  /* ---------- R. pending guards, storage and containment ---------- */
  {
    const g = deferred();
    const rt = await detail(ME_CEO, ID1, R1, { [W.submit]: [() => g.promise] });
    rt.app.fire('swoSubmitBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    rt.SessionOvertime.confirmPanel(); rt.SessionOvertime.back(); rt.SessionOvertime.show(false); rt.SessionOvertime.openEdit(); await flush();
    check(posts(rt).length === 1 && rt.ot().open && rt.ot().detailId === ID1, 'R. while a write is pending, a second send, Back, a section switch and Edit do nothing');
    g.resolve(ok(one(Object.assign({}, R1, { status: 'Submitted', version: 2 })))); await flush();
    const dump = JSON.stringify(rt.State) + JSON.stringify(rt.access);
    check(dump.indexOf(ID1) === -1 && dump.indexOf('7.50') === -1, 'R. no Overtime value reaches State or any storage');
    firewall(rt, 'R. after a write');
  }

  /* ================= AFI-4b2 — VALUATION + APPROVAL ================= */

  /* ---------- S. strict valuation decoding and the approve request ---------- */
  {
    const rt = loadRuntime({});
    const D = rt.OvertimeDecoders;
    const Q = rt.OvertimeRequests;
    const P = (o) => rt.parse(JSON.stringify(o));
    const hR5 = D.record(P(R5)), hRA = D.record(P(RA));
    const good = D.valuation(P(PV5), hR5);
    check(!!good && Object.isFrozen(good) && keys(good) === 'amount,hours,id,kind,method,monthlySalaryBasis,standardMonthlyHours'
      && good.amount === '12345.00' && good.monthlySalaryBasis === '8000000.00' && good.standardMonthlyHours === '160.00' && typeof good.amount === 'string',
      'S. a preview of a Reviewed record decodes, frozen, exactly the seven server keys, every value the exact string sent');
    check(!!D.valuation(P(AVA), hRA) && D.valuation(P(AVA), hRA).kind === 'approved', 'S. the frozen valuation of an Approved record decodes');
    check(!!D.valuation(P(val(ID5, 'preview', '7.50', { amount: '0.00', monthlySalaryBasis: '0.01' })), hR5)
      && !!D.valuation(P(val(ID5, 'preview', '7.50', { amount: '99999999999999.00', monthlySalaryBasis: '9999999999999.99' })), hR5),
      'S. boundaries accepted as the server serializes them: amount 0.00 / 14 digits, salary 0.01 / DECIMAL(15,2)');
    const vbads = [
      ['extra key', Object.assign({}, PV5, { hourlyRate: '1.00' })], ['missing key', (() => { const c = Object.assign({}, PV5); delete c.method; return c; })()],
      ['kind approved for a Reviewed record', Object.assign({}, PV5, { kind: 'approved' })], ['unknown kind', Object.assign({}, PV5, { kind: 'estimate' })],
      ['another id', Object.assign({}, PV5, { id: ID1 })], ['other hours', Object.assign({}, PV5, { hours: '7.25' })], ['hours 7.5', Object.assign({}, PV5, { hours: '7.5' })],
      ['unknown method', Object.assign({}, PV5, { method: 'TAM-OT-2' })], ['statutory method', Object.assign({}, PV5, { method: 'statutory' })],
      ['standard hours 173.00', Object.assign({}, PV5, { standardMonthlyHours: '173.00' })], ['standard hours number', Object.assign({}, PV5, { standardMonthlyHours: 160 })],
      ['salary 0.00', Object.assign({}, PV5, { monthlySalaryBasis: '0.00' })], ['salary without sen', Object.assign({}, PV5, { monthlySalaryBasis: '8000000' })],
      ['salary number', Object.assign({}, PV5, { monthlySalaryBasis: 8000000 })], ['salary 14 digits', Object.assign({}, PV5, { monthlySalaryBasis: '10000000000000.00' })],
      ['amount with sen', Object.assign({}, PV5, { amount: '12345.50' })], ['amount leading zero', Object.assign({}, PV5, { amount: '012345.00' })],
      ['amount negative', Object.assign({}, PV5, { amount: '-1.00' })], ['amount number', Object.assign({}, PV5, { amount: 12345 })],
      ['amount grouped', Object.assign({}, PV5, { amount: '12.345.00' })], ['amount 15 digits', Object.assign({}, PV5, { amount: '100000000000000.00' })]
    ];
    vbads.forEach(([label, o]) => check(D.valuation(P(o), hR5) === null, 'S. valuation refused: ' + label));
    check(D.valuation(P(AVA), hR5) === null && D.valuation(P(PV5), D.record(P(R1))) === null && D.valuation(P(PV5), D.record(P(R4))) === null && D.valuation(P(PV5), null) === null,
      'S. a valuation must belong to the record it was read for, whose status calls for its kind (Draft / Rejected: none)');
    check(D.valuationResponse(P({ overtimeValuation: PV5 }), hR5) !== null && D.valuationResponse(P({ overtimeValuation: PV5, overtimeRecord: R5 }), hR5) === null
      && D.valuationResponse(P(PV5), hR5) === null, 'S. { overtimeValuation } is exact');
    const ar = D.approveResponse(P(approved(R5A, AV5)));
    check(!!ar && Object.isFrozen(ar) && ar.record.status === 'Approved' && ar.valuation.kind === 'approved' && ar.valuation.amount === '12345.00', 'S. { overtimeRecord, overtimeValuation } decodes an Approved record with its frozen valuation');
    check(D.approveResponse(P(approved(R5, AV5))) === null && D.approveResponse(P(approved(R5A, PV5))) === null
      && D.approveResponse(P(approved(R5A, Object.assign({}, AV5, { id: IDA })))) === null && D.approveResponse(P(Object.assign(approved(R5A, AV5), { deleted: 1 }))) === null
      && D.approveResponse(P({ overtimeRecord: R5A })) === null, 'S. approve answers refused: record not Approved, a preview, another id, an extra or a missing wrapper key');
    const q = Q.approve(ID5, 3, '12345.00');
    check(q.ok && keys(q.body) === 'expectedAmount,expectedVersion,id' && q.body.expectedAmount === '12345.00' && q.body.expectedVersion === 3,
      'S. approve request: exactly { id, expectedVersion, expectedAmount } — never employeeId, salary, hours or method');
    check(!Q.approve(ID5, 3, '12345.5').ok && !Q.approve(ID5, 3, 12345).ok && !Q.approve(ID5, 0, '1.00').ok && !Q.approve('x', 3, '1.00').ok && !Q.approve(ID5, 3, '').ok,
      'S. approve refused before transport: amount not "N.00", a number, a bad version or id');
    check(rt.sessionOvertimeValuationWanted({ principalType: 'employee', employeeId: 'emp_srv_1' }, S3) === false
      && rt.sessionOvertimeValuationWanted({ principalType: 'employee', employeeId: 'emp_srv_1' }, S5) === true
      && rt.sessionOvertimeValuationWanted({ principalType: 'employee', employeeId: 'emp_srv_2' }, S5) === false
      && rt.sessionOvertimeValuationWanted({ principalType: 'ceo' }, R5) === true && rt.sessionOvertimeValuationWanted({ principalType: 'ceo' }, R2) === false,
      'S. disclosure: an Employee reads only their own Approved valuation (never a preview, never a colleague\'s); the CEO reads Reviewed and Approved');
  }

  /* ---------- T. CEO: Reviewed preview, approve, Approved frozen ---------- */
  {
    const gV = deferred(), gA = deferred();
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [() => gV.promise], [W.approve]: [() => gA.promise] });
    let html = rt.appHTML();
    check(valuationCalls(rt) === 1 && rt.ot().valuationStatus === 'loading' && /Valuation preview — not yet approved/.test(html) && /Reading the valuation…/.test(html)
      && buttons(html) === 'Approve,Reject' && !enabled(html, 'swoApproveBtn') && enabled(html, 'swoRejectBtn'),
      'T. a Reviewed detail reads its preview; until it is ready Approve is disabled (Reject is not)');
    rt.SessionOvertime.openPanel('approve'); await flush();
    check(rt.ot().panel === null, 'T. the controller refuses the approval panel while no matching preview is ready');
    gV.resolve(ok({ overtimeValuation: PV5 })); await flush();
    html = rt.appHTML();
    check(enabled(html, 'swoApproveBtn') && html.indexOf('<th scope="row">Amount (Rp)</th><td>12345.00</td>') !== -1
      && html.indexOf('<th scope="row">Monthly salary basis (Rp)</th><td>8000000.00</td>') !== -1 && html.indexOf('<th scope="row">Overtime hours</th><td>7.50</td>') !== -1
      && html.indexOf('<th scope="row">Standard monthly hours</th><td>160.00</td>') !== -1
      && html.indexOf('<th scope="row">Method</th><td>TAM-OT-1 — internal TAM overtime method (not a statutory calculation)</td>') !== -1,
      'T. the preview shows amount, salary basis, hours, standard hours and the internal method — exactly the server strings (12345.00 is not TAM-OT-1 of its inputs: nothing is recomputed)');
    check(!/375000|375\.000|375,000|hourly|per hour|multiplier|statutory entitle/i.test(html) && /It may change until the record is approved\./.test(html),
      'T. no locally derived amount, hourly rate or multiplier; the preview says it may change until approval');
    firewall(rt, 'T. CEO preview');
    rt.app.fire('swoApproveBtn', 'click'); await flush();
    html = rt.appHTML();
    check(posts(rt).length === 0 && lastFocus(rt) === 'swoPanelTitle' && /Approve this overtime\?/.test(html) && html.indexOf('Amount to approve (Rp): <strong>12345.00</strong>') !== -1,
      'T. Approve opens an inline confirmation repeating the exact previewed amount; nothing sent');
    rt.app.fire('swoPanelConfirm', 'click'); rt.app.fire('swoPanelConfirm', 'click'); rt.SessionOvertime.confirmPanel(); await flush();
    const p = posts(rt, W.approve);
    check(p.length === 1 && keys(bodyOf(p[0])) === 'expectedAmount,expectedVersion,id' && bodyOf(p[0]).id === ID5 && bodyOf(p[0]).expectedVersion === 3
      && bodyOf(p[0]).expectedAmount === '12345.00' && p[0].init.headers['X-CSRF-Token'] === CSRF,
      'T. Confirm (clicked twice + a direct call) sends ONE CSRF POST: { id, expectedVersion: held version, expectedAmount: the held preview\'s exact string }');
    check(/Approving…/.test(rt.appHTML()) && rt.app.fire('swoPanelConfirm', 'click') === 'disabled' && rt.app.fire('swSectionMain', 'click') === 'disabled',
      'T. while the approval is pending the controls are disabled');
    gA.resolve(ok(approved(R5A, AV5))); await flush();
    html = rt.appHTML();
    check(rt.ot().detail.status === 'Approved' && rt.ot().valuation.kind === 'approved' && rt.ot().valuationStatus === 'ready' && valuationCalls(rt) === 1
      && /Approved valuation \(frozen at approval\)/.test(html) && !/Valuation preview/.test(html) && /Overtime record approved\. Its valuation is now frozen\./.test(html)
      && html.indexOf('<td>12345.00</td>') !== -1 && buttons(html) === '' && lastFocus(rt) === 'swoMutationMessage',
      'T. a confirmed approval applies the Approved record and its frozen valuation from the same answer; no controls remain');
    const n = rt.net.calls.length;
    ['approve', 'reject', 'delete', 'submit', 'review'].forEach((k) => rt.SessionOvertime.openPanel(k)); rt.SessionOvertime.openEdit(); rt.SessionOvertime.confirmPanel(); await flush();
    check(rt.ot().panel === null && rt.ot().form === null && rt.net.calls.length === n, 'T. Approved is terminal: the controller refuses every action');
    firewall(rt, 'T. CEO approved');
    rt.app.fire('swoBackBtn', 'click'); await flush();
    check(rt.ot().valuation === null && rt.ot().valuationStatus === 'idle' && !/12345\.00/.test(rt.appHTML()), 'T. leaving the detail drops the valuation; the month list carries no money');
    const dump = JSON.stringify(rt.State) + JSON.stringify(rt.access);
    check(dump.indexOf('12345.00') === -1 && dump.indexOf('8000000.00') === -1 && rt.access.local.length + rt.access.session.length + rt.access.cookie.length === 0,
      'T. no valuation value reaches State, storage or cookies');
    firewall(rt, 'T. back to the list');
  }
  {
    const rt = await detail(ME_CEO, IDA, RA, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(IDA)]: [ok({ overtimeValuation: AVA })] });
    const html = rt.appHTML();
    check(valuationCalls(rt) === 1 && /Approved valuation \(frozen at approval\)/.test(html) && html.indexOf('<td>98765.00</td>') !== -1 && html.indexOf('<td>7000000.00</td>') !== -1
      && /Later salary changes do not alter it\./.test(html) && buttons(html) === '', 'T. CEO opening an Approved record: its frozen valuation, read once; no controls');
    firewall(rt, 'T. CEO Approved detail');
  }
  {
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [ok({ overtimeValuation: PV5 })], [W.reject]: [ok(one(Object.assign({}, R5, { status: 'Rejected', version: 4 })))] });
    rt.app.fire('swoRejectBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(posts(rt, W.reject).length === 1 && rt.ot().detail.status === 'Rejected' && rt.ot().valuation === null && valuationCalls(rt) === 1 && !/12345.00/.test(rt.appHTML()) && buttons(rt.appHTML()) === '',
      'T. Reject stays available on a Reviewed record; once Rejected the preview is gone and no valuation is read');
    firewall(rt, 'T. reject a previewed record');
  }

  /* ---------- U. D-AFI4b2-1: ANY approve 409 — re-read, fresh preview, a new deliberate approval ---------- */
  {
    // The salary changed after the preview: the amount differs.
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [ok({ overtimeValuation: PV5 }), ok({ overtimeValuation: PV5b })],
      [REC(ID5)]: [ok(one(R5)), ok(one(R5))], [W.approve]: [err(409, 'conflict'), ok(approved(R5A, Object.assign({}, AV5, { monthlySalaryBasis: '8500000.00', amount: '13000.00' })))] });
    rt.app.fire('swoApproveBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    const html = rt.appHTML();
    check(posts(rt, W.approve).length === 1 && rt.ot().panel === null && countOf(rt, REC(ID5)) === 2 && valuationCalls(rt) === 2 && rt.ot().valuation.amount === '13000.00',
      'U. 409: one POST; the panel closed; the record read again; a fresh preview read');
    check(/The amount changed from Rp 12345\.00 to Rp 13000\.00\. Check it, then approve again\./.test(html) && html.indexOf('<td>13000.00</td>') !== -1 && html.indexOf('<td>8500000.00</td>') !== -1,
      'U. amount changed (salary changed): "The amount changed from Rp 12345.00 to Rp 13000.00" and the fresh preview shown');
    await flush(20);
    check(posts(rt, W.approve).length === 1 && enabled(html, 'swoApproveBtn') && rt.ot().mutation.status === 'error', 'U. nothing is approved automatically: still one POST; Approve offered again');
    firewall(rt, 'U. amount changed');
    rt.app.fire('swoApproveBtn', 'click'); await flush();
    check(rt.appHTML().indexOf('Amount to approve (Rp): <strong>13000.00</strong>') !== -1 && posts(rt, W.approve).length === 1, 'U. the second approval needs a new Approve — its panel shows the NEW amount');
    rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(posts(rt, W.approve).length === 2 && bodyOf(posts(rt, W.approve)[1]).expectedAmount === '13000.00' && rt.ot().detail.status === 'Approved',
      'U. … and a new Confirm, which sends the fresh preview\'s amount');
  }
  {
    // A stale version (the record changed), the same amount.
    const R5v4 = Object.assign({}, R5, { version: 4, notes: 'changed' });
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [ok({ overtimeValuation: PV5 })], [REC(ID5)]: [ok(one(R5)), ok(one(R5v4))],
      [W.approve]: [err(409, 'conflict'), ok(approved(Object.assign({}, R5A, { version: 5 }), AV5))] });
    rt.app.fire('swoApproveBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(posts(rt, W.approve).length === 1 && valuationCalls(rt) === 2 && /The record changed\. Check it, then approve again\./.test(rt.appHTML()) && rt.ot().detail.version === 4,
      'U. stale version, same amount: "The record changed. Check it, then approve again."');
    rt.app.fire('swoApproveBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(posts(rt, W.approve).length === 2 && bodyOf(posts(rt, W.approve)[1]).expectedVersion === 4, 'U. the deliberate second approval uses the version read again');
  }
  for(const [label, after, want, vcalls] of [['rejected elsewhere', Object.assign({}, R5, { status: 'Rejected', version: 4 }), /it is now Rejected and can no longer be approved\./, 1],
    ['approved elsewhere', R5A, /it is now Approved and can no longer be approved\./, 2]]){
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [ok({ overtimeValuation: PV5 }), ok({ overtimeValuation: AV5 })], [REC(ID5)]: [ok(one(R5)), ok(one(after))],
      [W.approve]: [err(409, 'conflict')] });
    rt.app.fire('swoApproveBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(posts(rt, W.approve).length === 1 && want.test(rt.appHTML()) && valuationCalls(rt) === vcalls && buttons(rt.appHTML()) === '',
      'U. 409, concurrent status change (' + label + '): explained, no approval control, ' + (vcalls === 2 ? 'the frozen valuation read' : 'no valuation read'));
    firewall(rt, 'U. ' + label);
  }
  {
    // The owner was archived / lost their salary: the fresh preview itself is a 409.
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [ok({ overtimeValuation: PV5 }), err(409, 'conflict')], [REC(ID5)]: [ok(one(R5)), ok(one(R5))],
      [W.approve]: [err(409, 'conflict')] });
    rt.app.fire('swoApproveBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    const html = rt.appHTML();
    check(posts(rt, W.approve).length === 1 && (html.match(/This record cannot be valued now \(the employee may be archived or have no salary\)\./g) || []).length >= 1
      && !enabled(html, 'swoApproveBtn') && enabled(html, 'swoRejectBtn') && !/id="swoValuationRetryBtn"/.test(html) && !/12345.00/.test(html),
      'U. 409 then a 409 preview (archived / no salary): "cannot be valued now"; Approve disabled, Reject still offered; the old amount gone');
    firewall(rt, 'U. unvalued');
  }
  {
    // A Reviewed record of an archived owner never offers Approve (the server refuses its preview).
    const rt = await detail(ME_CEO, ID3, R3, { [VAL(ID3)]: [err(409, 'conflict')] });
    check(/This record cannot be valued now/.test(rt.appHTML()) && !enabled(rt.appHTML(), 'swoApproveBtn') && enabled(rt.appHTML(), 'swoRejectBtn'),
      'U. an archived owner\'s Reviewed record: cannot be valued now, Approve disabled, Reject offered');
  }

  /* ---------- V. ambiguous approval: never resent, reconciled by reading ---------- */
  {
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [ok({ overtimeValuation: PV5 }), ok({ overtimeValuation: PV5 })], [REC(ID5)]: [ok(one(R5)), ok(one(R5))],
      [W.approve]: [err(503, 'service_unavailable')] });
    rt.app.fire('swoApproveBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush(20);
    check(posts(rt, W.approve).length === 1 && rt.ot().mutation.status === 'ambiguous' && countOf(rt, REC(ID5)) === 2 && valuationCalls(rt) === 2
      && /could not confirm the approval\. The record read again is still Reviewed: it was not approved\. Check the current amount, then approve again\./.test(rt.appHTML())
      && enabled(rt.appHTML(), 'swoApproveBtn'), 'V. approve 503 + still Reviewed: not resent; a fresh preview; Approve must be chosen again');
    firewall(rt, 'V. 503 still Reviewed');
  }
  for(const [label, answer, timeout] of [['network failure', NETFAIL, false], ['timeout', 'HANG', true], ['non-JSON success', resp(200, '<html>proxy</html>', { 'content-type': 'text/html' }), false],
    ['a non-confirming amount', ok(approved(R5A, Object.assign({}, AV5, { amount: '99.00' }))), false], ['a Reviewed record in the answer', ok(approved(R5, AV5)), false]]){
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [ok({ overtimeValuation: PV5 }), ok({ overtimeValuation: AV5 })], [REC(ID5)]: [ok(one(R5)), ok(one(R5A))],
      [W.approve]: [answer] });
    rt.app.fire('swoApproveBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    if(timeout){ rt.net.timers.splice(0).forEach((fn) => fn()); await flush(); }
    await flush(20);
    check(posts(rt, W.approve).length === 1 && rt.ot().mutation.status === 'ambiguous' && rt.ot().detail.status === 'Approved' && rt.ot().valuation.kind === 'approved'
      && /could not confirm the approval, but the record read again is now Approved\. Its frozen amount is Rp 12345\.00\./.test(rt.appHTML()) && !/Overtime record approved\./.test(rt.appHTML()),
      'V. approve ' + label + ' + now Approved: not resent, never reported as confirmed; the frozen amount read and shown');
  }

  /* ---------- W. stale valuation answers, section switch, logout, principal change ---------- */
  {
    const gV = deferred();
    const rt = await open(ME_CEO, { [OT(MONTH)]: [ok(CEO_MONTH5)], [REC(ID5)]: [ok(one(R5))], [VAL(ID5)]: [() => gV.promise], [REC(ID2)]: [ok(one(R2))] });
    rt.app.fire('swoOpen4', 'click'); await flush();
    rt.app.fire('swoBackBtn', 'click'); await flush();
    rt.app.fire('swoOpen1', 'click'); await flush();
    gV.resolve(ok({ overtimeValuation: PV5 })); await flush();
    check(rt.ot().detailId === ID2 && rt.ot().valuation === null && !/12345.00/.test(rt.appHTML()), 'W. a preview answering after the CEO moved to another record is dropped');
  }
  {
    const rt = loadRuntime({});
    const S = rt.SessionOvertimeStore;
    const d = S.begin('detail', ID5); S.applyDetail(d, R5);
    const v1 = S.begin('valuation', ID5), v2 = S.begin('valuation', ID5);
    check(S.applyValuation(v1, PV5) === false && S.applyError(v1, { kind: 'UNAVAILABLE' }) === false && S.applyValuation(v2, Object.assign({}, PV5, { id: ID1 })) === false
      && S.applyValuation(v2, PV5) === true && S.snapshot().valuation.amount === '12345.00', 'W. store: a superseded valuation token is refused; a valuation of another record is refused; the latest applies');
    const v3 = S.begin('valuation', ID5);
    S.begin('detail', ID2);
    check(S.applyValuation(v3, PV5) === false && S.snapshot().valuation === null, 'W. store: a new detail drops the valuation and refuses its pending answer');
    const v4 = S.begin('valuation', ID2);
    S.clear();
    check(S.applyValuation(v4, PV5) === false && S.snapshot().valuationStatus === 'idle', 'W. store: clear() (another generation) refuses a pending valuation');
  }
  {
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [ok({ overtimeValuation: PV5 }), ok({ overtimeValuation: PV5b })] });
    rt.app.fire('swSectionMain', 'click'); await flush();
    check(rt.ot().valuation === null && !/12345.00/.test(rt.appHTML()), 'W. switching to Employees (where a salary may change) drops the preview');
    rt.app.fire('swSectionOvertime', 'click'); await flush();
    check(valuationCalls(rt) === 2 && rt.appHTML().indexOf('<td>13000.00</td>') !== -1, 'W. back on Overtime the preview is read again (the current server amount, never a remembered one)');
  }
  {
    const gV = deferred();
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [() => gV.promise], '/api/auth/logout': [ok({})] });
    await rt.AuthBoot.signOut(); await flush();
    gV.resolve(ok({ overtimeValuation: PV5 })); await flush();
    check(rt.state() === 'SIGNED_OUT' && rt.ot().valuation === null && !/12345.00/.test(rt.appHTML()), 'W. logout during the valuation read: the late answer is dropped');
  }
  {
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [err(401, 'unauthenticated')] });
    check(rt.state() === 'SIGNED_OUT' && rt.ot().valuation === null && rt.ot().detail === null, 'W. a valuation read answered 401 ends the session and destroys the Overtime data');
  }
  {
    const gV = deferred();
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [() => gV.promise] });
    rt.net.routes['/api/auth/me'] = [ok({ userId: 'u_ceo_2', membershipId: 'm_ceo_2', role: 'ceo', employeeId: null, csrfToken: CSRF2 })];
    await rt.SessionIdentityProvider.refresh(); rt.render(); await flush();
    gV.resolve(ok({ overtimeValuation: PV5 })); await flush();
    check(rt.ot().valuation === null && rt.ot().detail === null && !/12345.00/.test(rt.appHTML()), 'W. a principal change during the valuation read: the late answer is dropped');
  }
  {
    const gA = deferred();
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [ok({ overtimeValuation: PV5 })], [W.approve]: [() => gA.promise], '/api/auth/logout': [ok({})] });
    rt.app.fire('swoApproveBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    await rt.AuthBoot.signOut(); await flush();
    gA.resolve(ok(approved(R5A, AV5))); await flush();
    check(rt.state() === 'SIGNED_OUT' && rt.ot().detail === null && rt.ot().valuation === null && !/approved/i.test(rt.appHTML()), 'W. logout during the approval: the late answer is dropped; nothing of it is shown or kept');
  }
  {
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [ok({ overtimeValuation: Object.assign({}, PV5, { rate: '1.00' }) }), ok({ overtimeValuation: PV5 })] });
    let html = rt.appHTML();
    check(rt.ot().valuationStatus === 'error' && /TAM OS sent an unexpected response/.test(html) && /id="swoValuationRetryBtn"/.test(html) && !enabled(html, 'swoApproveBtn') && !/1\.00/.test(html.replace('7.50', '')),
      'W. a malformed preview is refused whole: a message and Retry valuation; Approve stays disabled');
    rt.app.fire('swoValuationRetryBtn', 'click'); await flush();
    html = rt.appHTML();
    check(valuationCalls(rt) === 2 && enabled(html, 'swoApproveBtn') && html.indexOf('<td>12345.00</td>') !== -1, 'W. Retry valuation reads it again');
  }

  /* ---------- X. approval: 401, CSRF recovery, denial, 404 ---------- */
  {
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [ok({ overtimeValuation: PV5 })], [W.approve]: [err(403, 'forbidden'), ok(approved(R5A, AV5))],
      '/api/auth/me': [ok(ME_CEO), ok(Object.assign({}, ME_CEO, { csrfToken: CSRF2 }))] });
    rt.app.fire('swoApproveBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    const p = posts(rt, W.approve);
    check(p.length === 2 && p[0].init.body === p[1].init.body && p[1].init.headers['X-CSRF-Token'] === CSRF2 && rt.ot().detail.status === 'Approved',
      'X. a stale CSRF token on approve: one /me refresh, exactly one replay of the same body (a 403 precedes any effect)');
  }
  for(const [label, meAnswer, want] of [['signed_out', err(401, 'unauthenticated'), 'SIGNED_OUT'], ['unavailable', err(503, 'service_unavailable'), 'UNAVAILABLE']]){
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [ok({ overtimeValuation: PV5 })], [W.approve]: [err(403, 'forbidden')], '/api/auth/me': [ok(ME_CEO), meAnswer] });
    rt.app.fire('swoApproveBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(rt.state() === want && posts(rt, W.approve).length === 1 && rt.ot().valuation === null && rt.ot().detail === null, 'X. approve recovery ' + label + ': no replay, ' + want + ', the valuation destroyed');
  }
  {
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [ok({ overtimeValuation: PV5 })], [W.approve]: [err(403, 'forbidden')],
      '/api/auth/me': [ok(ME_CEO), ok({ userId: 'u_ceo_9', membershipId: 'm_9', role: 'ceo', employeeId: null, csrfToken: CSRF2 })] });
    rt.app.fire('swoApproveBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(posts(rt, W.approve).length === 1 && rt.ot().valuation === null && rt.ot().open === false, 'X. approve recovery principal_changed: no replay, the Overtime data and valuation cleared');
  }
  {
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [ok({ overtimeValuation: PV5 })], [W.approve]: [err(401, 'unauthenticated')] });
    rt.app.fire('swoApproveBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(rt.state() === 'SIGNED_OUT' && rt.ot().valuation === null, 'X. approve answered 401 ends the session');
  }
  {
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5)], [VAL(ID5)]: [ok({ overtimeValuation: PV5 })], [W.approve]: [err(403, 'forbidden')], '/api/auth/me': [ok(ME_CEO), ok(ME_CEO)] });
    rt.app.fire('swoApproveBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(posts(rt, W.approve).length === 1 && /You do not have permission to make this change\./.test(rt.appHTML()) && rt.state() === 'AUTHENTICATED', 'X. a genuine approve denial: one request, a fixed message');
  }
  {
    const rt = await detail(ME_CEO, ID5, R5, { [OT(MONTH)]: [ok(CEO_MONTH5), ok(CEO_MONTH5)], [VAL(ID5)]: [ok({ overtimeValuation: PV5 })], [W.approve]: [err(404, 'not_found')] });
    rt.app.fire('swoApproveBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(posts(rt, W.approve).length === 1 && rt.ot().detailId === null && rt.ot().valuation === null && /no longer available/.test(rt.appHTML()), 'X. approve 404 closes the record (and its valuation) and reads the month again');
  }

  /* ---------- Y. Employee: no preview ever; own frozen valuation only ---------- */
  for(const r of [S1, S2, S3, S4]){
    const rt = await detail(ME_EMP, r.id, r, { [OT(MONTH)]: [ok(EMP_MONTH5)] });
    rt.SessionOvertime.openPanel('approve'); rt.SessionOvertime.retryValuation(); rt.render(); await flush();
    check(valuationCalls(rt) === 0 && buttons(rt.appHTML()) === (r === S1 ? 'Edit,Delete,Submit' : '') && !/swoValuation|Valuation preview|Approve/.test(rt.appHTML()) && rt.ot().panel === null,
      'Y. Employee + own ' + r.status + ': ZERO valuation requests (not merely hidden), no Approve, no valuation block');
    firewall(rt, 'Y. Employee ' + r.status);
  }
  {
    const rt = await detail(ME_EMP, IDS5, S5, { [OT(MONTH)]: [ok(EMP_MONTH5)], [VAL(IDS5)]: [ok({ overtimeValuation: AVS5 })] });
    const html = rt.appHTML();
    check(valuationCalls(rt) === 1 && countOf(rt, VAL(IDS5)) === 1 && /Approved valuation \(frozen at approval\)/.test(html) && html.indexOf('<td>54321.00</td>') !== -1
      && html.indexOf('<th scope="row">Monthly salary basis (Rp)</th><td>900000.00</td>') !== -1 && !/1000000\.00/.test(html) && buttons(html) === '',
      'Y. Employee + own Approved: their frozen valuation (salary basis 900000.00 at approval — not the current 1000000.00); no controls');
    firewall(rt, 'Y. Employee own Approved');
    rt.app.fire('swoBackBtn', 'click'); await flush();
    check(!/54321|900000/.test(rt.appHTML()) && (rt.appHTML().match(/<td>Approved<\/td>/g) || []).length === 1, 'Y. the Employee month list shows the Approved status and no money');
    firewall(rt, 'Y. Employee list');
  }
  {
    // A colleague's record: the server answers 404 to the record read; nothing about money is asked or shown.
    const rt = await open(ME_EMP, { [OT(MONTH)]: [ok(EMP_MONTH5)], [REC(IDX)]: [err(404, 'not_found')] });
    rt.SessionOvertime.openDetail(IDX); await flush();
    check(valuationCalls(rt) === 0 && /This overtime record was not found\./.test(rt.appHTML()) && !/Rp|salary|amount/i.test(rt.appHTML()),
      'Y. a colleague\'s record (server 404): no valuation request, no money disclosed');
    const p = rt.AuthBoot.snapshot().principal;
    check(rt.sessionOvertimeValuationWanted(p, Object.assign({}, S5, { employeeId: 'emp_srv_2' })) === false, 'Y. the page would never ask for a colleague\'s valuation either');
  }
  {
    // A server preview answer that reached an Employee would not even be requested — and the view
    // offers no Approve to an Employee whatever the store holds.
    const rt = await detail(ME_EMP, IDS3, S3, { [OT(MONTH)]: [ok(EMP_MONTH5)] });
    const tok = rt.SessionOvertimeStore.begin('valuation', IDS3);
    rt.SessionOvertimeStore.applyValuation(tok, rt.OvertimeDecoders.valuation(rt.parse(JSON.stringify(val(IDS3, 'preview', '7.50'))), rt.ot().detail)); rt.render(); await flush();
    check(!/swoApproveBtn|swoValuation|12345.00/.test(rt.appHTML()), 'Y. even a preview forced into the store is never rendered for an Employee, and no Approve exists');
  }

  /* ---------- Z. regression: AFI-4b1 Reviewed behaviour, no Payroll / Finance call ---------- */
  {
    const rt = await detail(ME_CEO, ID2, R2, { [OT(MONTH)]: [ok(CEO_MONTH5)], [W.review]: [ok(one(Object.assign({}, R2, { status: 'Reviewed', version: 3 })))], [VAL(ID2)]: [ok({ overtimeValuation: val(ID2, 'preview', '2.25') })] });
    rt.app.fire('swoReviewBtn', 'click'); await flush(); rt.app.fire('swoPanelConfirm', 'click'); await flush();
    check(rt.ot().detail.status === 'Reviewed' && /Overtime record marked as reviewed\./.test(rt.appHTML()) && valuationCalls(rt) === 1 && buttons(rt.appHTML()) === 'Approve,Reject',
      'Z. reviewing a Submitted record still works; the Reviewed record then reads its preview and offers Approve / Reject');
    const urls = rt.net.calls.map((c) => c.url);
    check(urls.every((u) => /^\/api\/(auth\/me|employees|employee\?|overtime-record)/.test(u)) && !urls.some((u) => /payroll|finance|payment|transaction|ledger|journal/i.test(u)),
      'Z. the only API calls are identity, Employee and Overtime — never Payroll or Finance');
    firewall(rt, 'Z. review then preview');
  }

  /* ---------- summary ---------- */
  console.log('');
  if(failures.length){
    console.log('AFI-4b1 + AFI-4b2 SESSION OVERTIME RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('AFI-4b1 + AFI-4b2 SESSION OVERTIME RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})().catch(function(e){ console.log('AFI-4b1 + AFI-4b2 SESSION OVERTIME RUNTIME VERIFICATION FAILED -- harness error: ' + (e && e.stack || e)); process.exit(1); });
