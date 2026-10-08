#!/usr/bin/env node
'use strict';
/* ============================================================
   AFI-4g — SESSION AUDIT (CEO, READ ONLY) RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of AFI-4g. This harness proves its BEHAVIOUR by
   executing every production module (module-order.js, the boot included) in the dependency-free
   Node `vm` loader of the other SESSION harnesses, with the ONE source line
   `const AUTH_MODE = AUTH_MODES.LOCAL;` rewritten to SESSION in the concatenated text — the
   committed value is untouched.

   DETERMINISTIC: fetch is a stub answering by URL (path + query) from a script; the API timeout
   timer is captured and fired on demand; the page's clock is injected — `Date` with no argument is
   a fixed instant (2031-04-15T12:00:00Z: April 2031 in Asia/Jakarta and in every timezone from
   UTC-12 to UTC+14) — and the company-calendar helpers are driven with explicit instants. No real
   network, no wall clock, no credentials, no production backend. localStorage / sessionStorage /
   cookies / history are instrumented, and the LOCAL boot, the shell, "Acting as", local data
   tools, Global Search, the LOCAL activity log and the other domains' renderers are recording
   spies that must never be called. Every identity, id and event here is fabricated.

   Owner decisions D-AFI4g-1..10 = A. Proven: the CEO-only Audit section (an Employee has no tab
   and sends no audit request, whatever is called); the Asia/Jakarta month and WIB times to the
   microsecond edge; strict decoding (every field, the vocabularies, the order, the month and the
   record, the 2,000 cap); the loading, empty, refusal and failure states (a 500's limit note is
   informational only); the neutral empty record history; the 401 session end and the principal
   change; stale answers dropped; tab exclusivity; focus and roles; no storage, URL or LOCAL reach.
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
const RID = '0123456789abcdef0123456789abcdef';
const ME_CEO = { userId: 'u_ceo_1', membershipId: 'm_ceo_1', role: 'ceo', employeeId: null, csrfToken: CSRF };
const ME_EMP = { userId: 'u_emp_1', membershipId: 'm_emp_1', role: 'employee', employeeId: 'emp_srv_1', csrfToken: CSRF };
const FIXED_NOW = Date.UTC(2031, 3, 15, 12, 0, 0);       // 2031-04-15T12:00:00Z
const MONTH = '2031-04';
const NEVER = ['loadState', 'saveState', 'applyTheme', 'installGlobalUIHandlers', 'maybeShowFirstRunChoice', 'startFresh',
  'renderShell', 'renderView', 'renderIdentitySelectorHTML', 'restoreCompleteBackup', 'renderSmartImport', 'openGlobalSearch',
  'renderActivityLog', 'renderEmployees', 'renderEmployeeDetail', 'persistEmployees', 'logActivity',
  'renderOvertime', 'renderPayrollWorkspace', 'renderPayrollDetail', 'renderDashboard', 'renderExecutiveDashboard',
  'renderTransactions', 'renderExecutionCenter'];

/* ---------- fabricated audit events ---------- */
const U1 = 'a'.repeat(32), M1 = 'b'.repeat(32), RQ = 'c'.repeat(32), T1 = 'd'.repeat(32), OT1 = 'e'.repeat(32), PP1 = 'f'.repeat(32);
const ev = (id, occurredAt, extra) => Object.assign({ id: String(id), occurredAt: occurredAt, actorUserId: U1, actorMembershipId: M1,
  action: 'employee.update', entity: 'employee', entityId: 'emp_1', operation: null, targetUserId: null, requestId: RQ, fields: ['fullName', 'phone'] }, extra || {});
// April 2031 in Asia/Jakarta is [2031-03-31T17:00:00.000000Z, 2031-04-30T17:00:00.000000Z).
const A1 = ev(11, '2031-03-31T17:00:00.000000Z');                                                         // the first instant of April (WIB)
const A2 = ev(12, '2031-04-10T03:04:05.123456Z', { action: 'account.manage', operation: 'provision', targetUserId: T1, fields: [] });
const A3 = ev(13, '2031-04-10T03:04:05.123456Z', { action: 'overtime.manage', entity: 'overtime', entityId: OT1, operation: 'approve', fields: [] });
const A4 = ev(14, '2031-04-30T16:59:59.999999Z', { action: 'payroll.manage', entity: 'payrollPlan', entityId: PP1, operation: 'commit', fields: [] });
const MONTH_EVENTS = { auditEvents: [A1, A2, A3, A4] };
const H1 = ev(5, '2031-02-01T00:00:00.000000Z', { action: 'employee.create', fields: ['fullName'] });
const H2 = ev(11, '2031-03-31T17:00:00.000000Z');
const HISTORY = { auditEvents: [H1, H2] };

const LIST = (m) => '/api/audit-events?month=' + m;
const REC = (entity, id) => '/api/audit-events/record?entity=' + entity + '&id=' + id;
const EMPS = '/api/employees';

/* ---------- scripted responses ---------- */
function resp(status, body, headers){
  const h = Object.assign({ 'content-type': 'application/json; charset=utf-8' }, headers || {});
  const lower = {}; Object.keys(h).forEach(function(k){ lower[k.toLowerCase()] = h[k]; });
  return { status: status,
    headers: { get: function(n){ const v = lower[String(n).toLowerCase()]; return v === undefined ? null : v; } },
    text: async function(){ return typeof body === 'string' ? body : JSON.stringify(body); } };
}
const ok = (data) => resp(200, { ok: true, data: data, requestId: RID });
const err = (status, code, headers) => resp(status, { ok: false, error: { code: code, message: 'server text' }, requestId: RID }, headers);
const NETFAIL = () => new TypeError('Failed to fetch');
function deferred(){ let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise: promise, resolve: resolve }; }

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
      elements[id] = { id: id, value: tag[1] === 'input' ? (attr('value') || '') : '', listeners: listeners,
        disabled: /\sdisabled(\s|>|=)/.test(tag[0]),
        addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
        focus: () => { dom.focused.push(id); if(dom.doc) dom.doc.activeElement = elements[id]; }, setSelectionRange: () => {}, querySelector: find, getAttribute: attr };
    }
    return elements[id];
  }
  const app = mkEl();
  app.querySelector = find;
  app.querySelectorAll = () => [];
  app.contains = () => true;
  Object.defineProperty(app, 'innerHTML', { get: () => html, set: (v) => { html = String(v); elements = {}; } });
  app.el = (id) => find('#' + id);
  app.fire = (id, type, ev) => {
    const el = find('#' + id);
    if(!el) return 'absent';
    if(el.disabled) return 'disabled';
    (el.listeners[type] || []).forEach((fn) => fn.call(el, ev || { preventDefault: () => {} }));
    return 'fired';
  };
  // A click on the "View" button of row i of the rendered list (the delegated listener).
  app.row = (i) => {
    const buttons = html.match(/<button class="btn" type="button" data-swau-open="(\d+)">View<\/button>/g) || [];
    if(!buttons.some((b) => b.indexOf('data-swau-open="' + i + '"') !== -1)) return 'absent';
    return app.fire('swauList', 'click', { target: { closest: (sel) => sel === '[data-swau-open]' ? { getAttribute: (n) => n === 'data-swau-open' ? String(i) : null } : null } });
  };
  // A user choosing a month in the month field.
  app.set = (id, value) => {
    const el = find('#' + id);
    if(!el || el.disabled) return false;
    el.value = value;
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
    + '\n;window.__TAM__ = { State: State, AuthBoot: AuthBoot, AUTH_STATES: AUTH_STATES, API_RESULT_KINDS: API_RESULT_KINDS,'
    + ' ApiClient: ApiClient, AuditApi: AuditApi, AuditDecoders: AuditDecoders, auditJakartaTime: auditJakartaTime, auditJakartaMonth: auditJakartaMonth,'
    + ' auditIsRecord: auditIsRecord, AUDIT_LIST_CAP: AUDIT_LIST_CAP, SessionAuditStore: SessionAuditStore, SessionAudit: SessionAudit,'
    + ' sessionAuditCurrentMonth: sessionAuditCurrentMonth, SessionOvertimeStore: SessionOvertimeStore, SessionPayrollStore: SessionPayrollStore,'
    + ' SESSION_AUDIT_LIMIT_NOTE: SESSION_AUDIT_LIMIT_NOTE, render: render, parse: function(json){ return JSON.parse(json); } };';
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
        if(next && typeof next.then === 'function') return next.then(resolve, reject);
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
    console: { log:noop, warn:noop, error:noop, info:noop }, navigator: { userAgent:'tam-afi4g' },
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
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-afi4g-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.net = net; rt.access = access; rt.spy = sandbox.__spy; rt.spyErr = sandbox.__spyErr;
  rt.appHTML = () => (els.app ? els.app.innerHTML : '');
  rt.app = els.app; rt.dom = dom; rt.loc = sandbox.location;
  rt.au = () => rt.SessionAuditStore.snapshot();
  rt.state = () => rt.AuthBoot.snapshot().state;
  return rt;
}
const flush = async (n) => { for(let i = 0; i < (n || 10); i++) await new Promise((r) => setImmediate(r)); };
const auditCalls = (rt) => rt.net.calls.filter((c) => /^\/api\/audit-events/.test(c.url));
const countOf = (rt, url) => rt.net.calls.filter((c) => c.url === url).length;
const lastFocus = (rt) => rt.dom.focused[rt.dom.focused.length - 1];
const queryKeys = (url) => (url.split('?')[1] || '').split('&').map((p) => p.split('=')[0]).join();
const pressed = (html) => (html.match(/id="(swSection[A-Za-z]+)" aria-pressed="true"/g) || []).map((m) => m.slice(4, -21));

async function boot(me, routes){
  const base = me.role === 'ceo' ? { [EMPS]: [ok({ employees: [] })] } : { '/api/employee?id=emp_srv_1': [ok({ employee: SELF })] };
  const rt = loadRuntime(Object.assign({ '/api/auth/me': [ok(me)] }, base, routes || {}));
  await flush();
  return rt;
}
const SELF = { id: 'emp_srv_1', employeeCode: 'EMP-777', fullName: 'Fabricated Self', jobTitle: null, department: null, employmentStatus: 'Active',
  joinDate: null, contactEmail: null, phone: null, monthlyBaseSalary: '1000000.00' };
// Signed in as the CEO, the Audit section opened by its section button.
async function open(routes){
  const rt = await boot(ME_CEO, Object.assign({ [LIST(MONTH)]: [ok(MONTH_EVENTS)] }, routes || {}));
  rt.app.fire('swSectionAudit', 'click'); await flush();
  return rt;
}

// The SESSION firewall, after every phase.
function firewall(rt, label){
  check(rt.access.local.length === 0 && rt.access.session.length === 0 && rt.access.cookie.length === 0,
    label + ': zero localStorage / sessionStorage / cookie access');
  check(rt.spy.length === 0 && rt.spyErr.length === 0, label + ': no LOCAL boot, shell, "Acting as", activity log, local data tool or other domain was called' + (rt.spy.length ? ' >> ' + rt.spy.join(', ') : ''));
  check(rt.access.url.length === 0 && rt.loc.hash === '' && rt.loc.search === '', label + ': nothing is written to the address bar (no history entry, hash or query)');
  const html = rt.appHTML();
  check(!/identity-selector|identityPrincipalSelect|Acting as|class="sidebar"|data-nav=|Smart Import|Backup|Restore|Start fresh|<script|\son[a-z]+=|style="/i.test(html),
    label + ': the DOM carries no "Acting as", navigation, local data tool, script, inline handler or inline style');
  check(rt.AuthBoot.allowsWorkspace() === false && rt.State.employees.length === 0, label + ': the business shell is never granted and legacy State stays empty');
  check(rt.net.calls.every((c) => !/^\/api\/audit-events/.test(c.url) || (c.init.method === 'GET' && c.init.body === undefined && !c.init.headers['X-CSRF-Token']
    && c.init.credentials === 'same-origin' && c.init.cache === 'no-store' && ['month', 'entity,id'].indexOf(queryKeys(c.url)) !== -1)),
    label + ': every audit request is a bodiless same-origin GET without a CSRF token whose query is exactly ?month= or ?entity=&id= (never a company, role or scope)');
}

(async function main(){
  console.log('== AFI-4g — SESSION AUDIT RUNTIME VERIFICATION ==');

  /* ---------- A. who sees the Audit section ---------- */
  {
    const rt = await boot(ME_CEO);
    const html = rt.appHTML();
    check(/<button class="tab" type="button" id="swSectionPayroll" aria-pressed="false">Payroll<\/button><button class="tab" type="button" id="swSectionAudit" aria-pressed="false">Audit<\/button><\/div><\/nav>/.test(html)
      && pressed(html).join() === 'swSectionMain' && auditCalls(rt).length === 0,
      'A. the CEO has a fourth section button, Audit, after Payroll — unpressed by default; nothing is read before it is opened');
    firewall(rt, 'A. CEO');
  }
  {
    const rt = await boot(ME_EMP);
    const html = rt.appHTML();
    check(!/swSectionAudit|>Audit</.test(html) && /id="swSectionPayroll"[^>]*>My payroll<\/button><\/div><\/nav>/.test(html), 'A. an Employee has no Audit section button (My profile | My overtime | My payroll)');
    rt.SessionAudit.show(true); await flush();
    rt.SessionAudit.setMonth('2031-03'); rt.SessionAudit.shiftMonth(-1); rt.SessionAudit.openEvent(0, 'month'); rt.SessionAudit.openRecord(); rt.SessionAudit.retry(); await flush();
    rt.SessionAudit.ensureLoaded(rt.AuthBoot.snapshot().principal); await flush();
    check(rt.au().open === false && auditCalls(rt).length === 0 && !/swau/.test(rt.appHTML()), 'A. every SessionAudit entry point is a no-op for an Employee: the section never opens and no audit request is ever sent');
    // Even a forged open store sends nothing for an Employee.
    rt.SessionAuditStore.setOpen(true, MONTH); rt.SessionAudit.ensureLoaded(rt.AuthBoot.snapshot().principal); await flush();
    rt.SessionAudit.setMonth('2031-03'); rt.SessionAudit.shiftMonth(1); await flush();
    rt.SessionAuditStore.select(A1, 'month'); rt.SessionAudit.openRecord(); await flush();
    rt.SessionAuditStore.openRecord(A1); rt.SessionAuditStore.applyError(rt.SessionAuditStore.begin('record', null), { kind: 'SERVER_ERROR' }); rt.SessionAudit.retry(); await flush();
    check(auditCalls(rt).length === 0, 'A. a forged open store still reads nothing for an Employee — month, Previous / Next, record history, Retry (CEO check on every read)');
    firewall(rt, 'A. Employee');
  }

  /* ---------- B. the CEO opens Audit ---------- */
  {
    const rt = await open();
    const html = rt.appHTML();
    check(rt.au().open === true && rt.au().month === MONTH && countOf(rt, LIST(MONTH)) === 1 && auditCalls(rt).length === 1,
      'B. opening Audit reads exactly GET /api/audit-events?month=2031-04 — the current Asia/Jakarta month — once');
    check(/<h1 class="auth-title" id="authTitle" tabindex="-1">Audit history<\/h1>/.test(html) && pressed(html).join() === 'swSectionAudit' && lastFocus(rt) === 'authTitle',
      'B. the heading is "Audit history", only the Audit button is pressed, and focus moves to the heading');
    check(/<h2 class="section-title" id="swauListTitle" tabindex="-1">April 2031 \(WIB\)<\/h2>/.test(html) && /4 events, oldest first\. Times are WIB\./.test(html),
      'B. the month is named in the company calendar ("April 2031 (WIB)") with its event count');
    check(/<td><time datetime="2031-03-31T17:00:00\.000000Z">2031-04-01 00:00:00<\/time><\/td><td>Employee updated<\/td><td>Employee emp_1<\/td><td>a{32}<\/td><td>fullName, phone<\/td>/.test(html),
      'B. a row shows the WIB wall time (2031-03-31T17:00Z is 2031-04-01 00:00 WIB), the action, the record, the stored actor id and the field names');
    check(/<td>Login access — Create login<\/td>/.test(html) && /<td>Overtime decision — Approve<\/td><td>Overtime record e{32}<\/td>/.test(html)
      && /<time datetime="2031-04-30T16:59:59\.999999Z">2031-04-30 23:59:59<\/time>/.test(html) && /<td>Payroll plan — Commit<\/td>/.test(html) && /<td>—<\/td><td><button/.test(html),
      'B. actions and operations use the fixed labels; the last microsecond of April is still April 30 (WIB); no field names show "—"');
    check((html.match(/data-swau-open="\d+"/g) || []).length === 4 && /<th scope="col">Time \(WIB\)<\/th>/.test(html) && /<label for="swauMonth">Month<\/label><input class="input" type="month" id="swauMonth"[^>]*value="2031-04">/.test(html),
      'B. one View button per event; column headers are scoped; the month field is labelled and holds the month');
    check(html.indexOf(SECTION_TEXT_LEAD) !== -1 && !/company/i.test(html.replace(SECTION_TEXT_LEAD, '')), 'B. the section explains itself and shows no company');
    firewall(rt, 'B. CEO month');
  }

  /* ---------- C. the company calendar ---------- */
  {
    const rt = await boot(ME_CEO);
    const D = (iso) => new Date(iso);
    check(rt.sessionAuditCurrentMonth(D('2031-04-30T16:59:59.999Z')) === '2031-04' && rt.sessionAuditCurrentMonth(D('2031-04-30T17:00:00.000Z')) === '2031-05'
      && rt.sessionAuditCurrentMonth(D('2031-12-31T17:00:00.000Z')) === '2032-01' && rt.sessionAuditCurrentMonth(D('2031-12-31T16:59:59.999Z')) === '2031-12'
      && rt.sessionAuditCurrentMonth(D('2032-02-29T17:00:00.000Z')) === '2032-03' && rt.sessionAuditCurrentMonth() === MONTH,
      'C. the opening month is the Asia/Jakarta month: UTC+7 month edges, the December → January rollover and a leap February');
    check(rt.auditJakartaTime('2031-12-31T16:59:59.999999Z') === '2031-12-31 23:59:59' && rt.auditJakartaTime('2031-12-31T17:00:00.000000Z') === '2032-01-01 00:00:00'
      && rt.auditJakartaTime('2032-02-28T17:00:00.000000Z') === '2032-02-29 00:00:00' && rt.auditJakartaTime('2031-02-28T17:00:00.000000Z') === '2031-03-01 00:00:00'
      && rt.auditJakartaTime('2031-02-29T00:00:00.000000Z') === '' && rt.auditJakartaTime('nope') === '',
      'C. WIB wall times: year rollover, leap and common February; an impossible date is no time at all');
  }

  /* ---------- D. strict decoding ---------- */
  {
    const rt = await boot(ME_CEO);
    // Data crosses into the page realm as JSON, as a server answer does.
    const page = (o) => rt.parse(JSON.stringify(o));
    const dec = (events, month) => rt.AuditDecoders.monthResponse(page({ auditEvents: events }), month || MONTH);
    const one = (patch) => dec([Object.assign({}, A2, patch)]);
    check(dec([A1, A2, A3, A4]) !== null && dec([A1, A2, A3, A4]).length === 4 && Object.isFrozen(dec([A1])[0]) && Object.isFrozen(dec([A1])[0].fields),
      'D. a valid month answer decodes to frozen events');
    check(Object.keys(dec([A1])[0]).sort().join() === 'action,actorMembershipId,actorUserId,entity,entityId,fields,id,occurredAt,operation,requestId,targetUserId',
      'D. an event holds exactly the eleven stored fields');
    const bad = [
      ['an extra companyId key', Object.assign({}, A2, { companyId: 'x' })],
      ['a missing key', (() => { const o = Object.assign({}, A2); delete o.requestId; return o; })()],
      ['a numeric id', Object.assign({}, A2, { id: 12 })], ['id 0', Object.assign({}, A2, { id: '0' })], ['a leading-zero id', Object.assign({}, A2, { id: '012' })],
      ['occurredAt without microseconds', Object.assign({}, A2, { occurredAt: '2031-04-10T03:04:05Z' })],
      ['occurredAt with an offset', Object.assign({}, A2, { occurredAt: '2031-04-10T03:04:05.123456+07:00' })],
      ['an impossible date', Object.assign({}, A2, { occurredAt: '2031-04-31T03:04:05.123456Z' })],
      ['month 13', Object.assign({}, A2, { occurredAt: '2031-13-10T03:04:05.123456Z' })],
      ['hour 24', Object.assign({}, A2, { occurredAt: '2031-04-10T24:00:00.000000Z' })],
      ['minute 60', Object.assign({}, A2, { occurredAt: '2031-04-10T03:60:00.000000Z' })],
      ['second 60', Object.assign({}, A2, { occurredAt: '2031-04-10T03:04:60.000000Z' })],
      ['year 1899', Object.assign({}, A2, { occurredAt: '1899-04-10T03:04:05.123456Z' })],
      ['an action given as a list', Object.assign({}, A1, { action: ['employee.update'] })],
      ['an inherited action name', Object.assign({}, A1, { action: 'constructor' })],
      ['an upper-case actor id', Object.assign({}, A2, { actorUserId: 'A'.repeat(32) })],
      ['a short membership id', Object.assign({}, A2, { actorMembershipId: 'b'.repeat(31) })],
      ['a bad request id', Object.assign({}, A2, { requestId: 'z'.repeat(32) })],
      ['an unknown action', Object.assign({}, A2, { action: 'audit.delete' })],
      ['an entity the action does not name', Object.assign({}, A3, { entity: 'employee', entityId: 'emp_1' })],
      ['an unknown entity', Object.assign({}, A1, { entity: 'company' })],
      ['an overtime id in the employee format', Object.assign({}, A3, { entityId: 'emp_1' })],
      ['an employee id with a space', Object.assign({}, A1, { entityId: 'emp 1' })],
      ['account.manage without an operation', Object.assign({}, A2, { operation: null })],
      ['employee.update with an operation', Object.assign({}, A1, { operation: 'create' })],
      ['an operation the action does not allow', Object.assign({}, A3, { operation: 'commit' })],
      ['a bad target user', Object.assign({}, A2, { targetUserId: 'x' })],
      ['fields not a list', Object.assign({}, A1, { fields: 'fullName' })], ['fields null', Object.assign({}, A1, { fields: null })],
      ['a field value instead of a name', Object.assign({}, A1, { fields: ['Fabricated Name'] })],
      ['an HTML field', Object.assign({}, A1, { fields: ['<b>x</b>'] })],
      ['an array event', [A1]], ['a null event', null]
    ];
    // Each bad event alone (so no other rule — order, month — can be what refuses it), then beside a valid one.
    bad.forEach(function(b){ check(dec([b[1]]) === null && dec([A4, b[1]]) === null, 'D. one bad event fails the whole answer: ' + b[0]); });
    check(one({ operation: 'reissue' }) !== null && one({ operation: 'disable' }) !== null && dec([Object.assign({}, A4, { operation: 'post' })]) !== null
      && dec([Object.assign({}, A1, { action: 'finance.execute', entity: 'financePosting', entityId: PP1, operation: 'execute', fields: [] })]) !== null
      && dec([Object.assign({}, A1, { action: 'overtime.submitSelf', entity: 'overtime', entityId: OT1, operation: 'submit' })]) !== null
      && dec([Object.assign({}, A1, { action: 'supplemental.manage', entity: 'supplementalPayroll', entityId: PP1, operation: 'recalculate' })]) !== null
      && dec([Object.assign({}, A1, { entityId: 'E-1_x' })]) !== null,
      'D. every vocabulary of migration 0035 that is valid decodes (operations, entities and the employee id format)');
    check(dec([A2, A1]) === null && dec([A2, A2]) === null && dec([A1, Object.assign({}, A4, { id: '11' })]) === null
      && dec([A2, Object.assign({}, A3, { id: '9' })]) === null && dec([A2, A3]) !== null,
      'D. the order is the server\'s (occurredAt, id): out of order, a repeated event, a repeated id elsewhere or a smaller id at the same instant fail; a larger id at the same instant passes');
    check(dec([ev(2, '2031-09-30T17:00:00.000000Z')], '2031-10') !== null && dec([ev(2, '2031-09-30T16:59:59.999999Z')], '2031-10') === null
      && dec([ev(2, '2031-10-31T16:59:59.999999Z')], '2031-10') !== null && dec([ev(2, '2031-10-31T17:00:00.000000Z')], '2031-10') === null,
      'D. a month answer holds only events of that Asia/Jakarta month, to the microsecond at both edges');
    const big = (n) => Array.from({ length: n }, (_, i) => ev(i + 1, '2031-04-10T00:00:00.000000Z'));
    check(dec(big(2000)) !== null && dec(big(2000)).length === 2000 && dec(big(2001)) === null && rt.AUDIT_LIST_CAP === 2000,
      'D. 2,000 events decode; 2,001 fail the answer (the server cap, defence in depth)');
    check(rt.AuditDecoders.monthResponse(page({ auditEvents: [A1], companyId: 'c' }), MONTH) === null && rt.AuditDecoders.monthResponse(page({}), MONTH) === null
      && rt.AuditDecoders.monthResponse(page({ auditEvents: {} }), MONTH) === null && rt.AuditDecoders.monthResponse(null, MONTH) === null && rt.AuditDecoders.monthResponse(page([]), MONTH) === null
      && rt.AuditDecoders.monthResponse({ auditEvents: [] }, MONTH) === null,
      'D. the wrapper is exactly { auditEvents: [...] }');
    const rec = (events, e, id) => rt.AuditDecoders.recordResponse(page({ auditEvents: events }), e, id);
    check(rec([H1, H2], 'employee', 'emp_1') !== null && rec([], 'employee', 'emp_1').length === 0 && rec([H1, A3], 'employee', 'emp_1') === null
      && rec([Object.assign({}, H1, { entityId: 'emp_2' })], 'employee', 'emp_1') === null && rec([A3], 'overtime', OT1) !== null
      && rec([Object.assign({}, H1, { occurredAt: '1899-12-31T23:59:59.999999Z' })], 'employee', 'emp_1') === null && rec([Object.assign({}, H1, { occurredAt: '1900-01-01T00:00:00.000000Z' })], 'employee', 'emp_1') !== null,
      'D. a record answer holds only events of that entity and id, from 1900 on (no month check to lean on); [] decodes');
    check(rt.auditIsRecord('employee', 'emp_1') && rt.auditIsRecord('overtime', OT1) && !rt.auditIsRecord('overtime', 'emp_1') && !rt.auditIsRecord('company', 'x')
      && !rt.auditIsRecord('employee', '') && !rt.auditIsRecord('constructor', 'x') && !rt.auditIsRecord('employee', 'x'.repeat(65)),
      'D. the request mirror accepts only a stored entity and an id in its format');
  }

  /* ---------- E. the API client ---------- */
  {
    const rt = await boot(ME_CEO, { [REC('overtime', OT1)]: [ok({ auditEvents: [A3] })], [LIST('2031-02')]: [ok({ auditEvents: [] })] });
    const before = rt.net.calls.length;
    const refused = [await rt.AuditApi.month('2031-13'), await rt.AuditApi.month('1899-12'), await rt.AuditApi.month('2031-4'), await rt.AuditApi.record('company', 'x'), await rt.AuditApi.record('overtime', 'emp_1')];
    check(refused.every((r) => r.ok === false && r.kind === 'CLIENT_FAULT') && rt.net.calls.length === before, 'E. a month or record outside the grammar is refused locally — nothing is sent');
    const r = await rt.AuditApi.record('overtime', OT1);
    const m = await rt.AuditApi.month('2031-02');
    check(r.ok && r.data.length === 1 && m.ok && m.data.length === 0 && rt.net.calls.slice(-2).map((c) => c.url).join() === REC('overtime', OT1) + ',' + LIST('2031-02'),
      'E. the record read is GET /api/audit-events/record?entity=…&id=… (keys sorted, encoded); the month read GET /api/audit-events?month=…');
    check(await rt.ApiClient.request('/api/audit-events', { method: 'GET', query: { month: MONTH, company: 'x' } }).then((x) => x.ok === false && x.kind === 'CLIENT_FAULT')
      && await rt.ApiClient.request('/api/audit-events/record', { method: 'GET', query: { entity: 'employee', id: 'emp 1' } }).then((x) => x.ok === false && x.kind === 'CLIENT_FAULT')
      && rt.net.calls.length === before + 2,
      'E. ApiClient accepts `entity` as a query key (D-AFI4g-2) but still refuses any other key and any value outside the identifier shape');
  }

  /* ---------- F. states ---------- */
  const failed = async (answer, label, expect) => {
    const rt = await open({ [LIST(MONTH)]: [answer, ok(MONTH_EVENTS)] });
    const html = rt.appHTML();
    expect(rt, html);
    firewall(rt, 'F. ' + label);
    return rt;
  };
  {
    const rt = await open({ [LIST(MONTH)]: ['HANG'] });
    check(/<p class="auth-lead" role="status" aria-busy="true">Loading audit history…<\/p>/.test(rt.appHTML()) && !/data-swau-open/.test(rt.appHTML()), 'F. while the month loads: a busy status, no rows');
  }
  {
    const rt = await open({ [LIST(MONTH)]: [ok({ auditEvents: [] })] });
    check(/<div class="empty" role="status">No audit events in April 2031 \(WIB\)\.<\/div>/.test(rt.appHTML()) && !/swauRetryBtn|swauError/.test(rt.appHTML()), 'F. an empty month says so, in the company calendar');
  }
  await failed(err(403, 'forbidden'), '403', (rt, html) => check(/role="alert">You do not have access to the audit history\. Reference: 0123456789abcdef0123456789abcdef\.<\/p>/.test(html) && !/swauRetryBtn|swauLimitNote/.test(html),
    'F. 403: a refusal with its reference, no Retry'));
  await failed(err(400, 'invalid_query'), '400', (rt, html) => check(/TAM OS could not process this request\./.test(html) && !/swauRetryBtn|swauLimitNote/.test(html), 'F. 400 invalid_query: the client-fault message, no Retry'));
  const r500 = await failed(err(500, 'internal_error'), '500', (rt, html) => {
    check(/role="alert">The audit history could not be loaded\. Try again in a moment\. Reference: 0123456789abcdef0123456789abcdef\.<\/p><p class="hint" id="swauLimitNote">/.test(html) && /id="swauRetryBtn"/.test(html),
      'F. 500: the failure, its reference, the limit note and Retry');
    const note = rt.SESSION_AUDIT_LIMIT_NOTE;
    check(/2,000/.test(note) && /one possible reason/.test(note) && /did not report the cause/.test(note) && !/\b(exceeded|exceeds|too many events|over the limit|because)\b/i.test(note) && !/exceed|cap/i.test(html.replace(/<p class="hint" id="swauLimitNote">[^<]*<\/p>/, '')),
      'F. 500: the limit note is informational only — it never claims the cap was the cause');
    check(countOf(rt, LIST(MONTH)) === 1, 'F. 500: nothing is retried automatically');
  });
  check(r500.app.fire('swauRetryBtn', 'click') === 'fired', 'F. Retry is a deliberate click');
  await flush();
  check(countOf(r500, LIST(MONTH)) === 2 && (r500.appHTML().match(/data-swau-open/g) || []).length === 4 && !/swauLimitNote/.test(r500.appHTML()), 'F. Retry reads the month once more and shows it');
  await failed(err(503, 'service_unavailable'), '503', (rt, html) => check(/Check your connection, then try again\./.test(html) && /id="swauRetryBtn"/.test(html) && !/swauLimitNote/.test(html), 'F. 503: unavailable, Retry, no limit note'));
  await failed(NETFAIL(), 'network', (rt, html) => check(/Check your connection, then try again\./.test(html) && /id="swauRetryBtn"/.test(html), 'F. a network failure: unavailable, Retry'));
  await failed(err(429, 'rate_limited', { 'Retry-After': '30' }), '429', (rt, html) => check(/Too many requests\. Try again in 30 seconds\./.test(html) && /id="swauRetryBtn"/.test(html), 'F. 429: the wait is shown'));
  await failed(ok({ auditEvents: [A2, A1] }), 'malformed', (rt, html) => check(/TAM OS sent an unexpected response\./.test(html) && !/data-swau-open/.test(html), 'F. a malformed answer shows nothing of it'));
  await failed(ok({ auditEvents: [Object.assign({}, A1, { companyId: 'cmp_other' })] }), 'leak', (rt, html) => check(!/cmp_other|data-swau-open/.test(html) && /unexpected response/.test(html), 'F. an answer carrying a company key is rejected whole — nothing of it is shown'));
  {
    const rt = await open({ [LIST(MONTH)]: ['HANG'] });
    rt.net.timers.forEach((fn) => fn()); await flush();
    check(/Check your connection, then try again\./.test(rt.appHTML()) && /id="swauRetryBtn"/.test(rt.appHTML()), 'F. a timeout: unavailable, Retry');
  }

  /* ---------- G. months ---------- */
  {
    const rt = await open({ [LIST('2031-03')]: [ok({ auditEvents: [] })], [LIST('2031-05')]: [ok({ auditEvents: [] })], [LIST('2032-01')]: [ok({ auditEvents: [] })] });
    rt.app.fire('swauPrevMonth', 'click'); await flush();
    check(rt.au().month === '2031-03' && countOf(rt, LIST('2031-03')) === 1 && /March 2031 \(WIB\)/.test(rt.appHTML()), 'G. Previous month reads March');
    rt.app.fire('swauNextMonth', 'click'); await flush(); rt.app.fire('swauNextMonth', 'click'); await flush();
    check(rt.au().month === '2031-05' && countOf(rt, LIST(MONTH)) === 2 && countOf(rt, LIST('2031-05')) === 1, 'G. Next month twice reads April again, then May');
    rt.app.set('swauMonth', '2032-01'); await flush();
    check(rt.au().month === '2032-01' && countOf(rt, LIST('2032-01')) === 1, 'G. the month field reads the month chosen');
    const n = auditCalls(rt).length;
    for(const v of ['', '1899-12', '2031-13', '2031-1', 'abc', '2031-04-01']){
      rt.app.set('swauMonth', v); await flush();
      check(auditCalls(rt).length === n && rt.au().month === '2032-01' && /<p class="auth-message auth-message-warn" id="swauMessage" role="alert" tabindex="-1">Enter a month, from 1900 onwards, as YYYY-MM\.<\/p>/.test(rt.appHTML()) && lastFocus(rt) === 'swauMessage',
        'G. an invalid month "' + v + '" sends nothing, keeps the month shown and says what is expected (focus on the message)');
    }
    rt.app.set('swauMonth', '2032-01'); await flush();
    check(auditCalls(rt).length === n && !/swauMessage/.test(rt.appHTML()), 'G. choosing the month already shown sends nothing and clears the message');
    firewall(rt, 'G. months');
  }

  /* ---------- H. stale answers ---------- */
  {
    const late = deferred();
    const rt = await open({ [LIST(MONTH)]: [late.promise], [LIST('2031-03')]: [ok({ auditEvents: [] })] });
    rt.app.fire('swauPrevMonth', 'click'); await flush();
    late.resolve(ok(MONTH_EVENTS)); await flush();
    check(rt.au().month === '2031-03' && rt.au().list && rt.au().list.length === 0 && /No audit events in March 2031/.test(rt.appHTML()) && !/data-swau-open/.test(rt.appHTML()),
      'H. a superseded month answer arriving late is dropped — the month now shown keeps its own answer');
  }
  {
    const late = deferred();
    const rt = await open({ [LIST(MONTH)]: [late.promise] });
    rt.app.fire('swSectionMain', 'click'); await flush();
    late.resolve(ok(MONTH_EVENTS)); await flush();
    check(rt.au().open === false && rt.au().list === null && !/swau/.test(rt.appHTML()), 'H. an answer arriving after the section was left is dropped');
  }
  {
    const late = deferred();
    const rt = await open({ [LIST(MONTH)]: [late.promise] });
    rt.AuthBoot.sessionLost(); await flush();
    late.resolve(ok(MONTH_EVENTS)); await flush();
    check(rt.au().list === null && rt.au().open === false && rt.state() === rt.AUTH_STATES.SIGNED_OUT && !/swau|fullName, phone/.test(rt.appHTML()),
      'H. an answer arriving after the session ended is dropped (generation)');
  }
  {
    const late = deferred();
    const rt = await open({ [LIST(MONTH)]: [late.promise], [LIST('2031-03')]: [ok({ auditEvents: [] })] });
    rt.app.fire('swauPrevMonth', 'click'); await flush();
    late.resolve(err(401, 'unauthenticated')); await flush();
    check(rt.state() === rt.AUTH_STATES.AUTHENTICATED && rt.au().month === '2031-03' && /No audit events in March 2031/.test(rt.appHTML()),
      'H. a superseded read is ignored whatever it answers — even a 401 (the current read decides)');
  }
  {
    const late = deferred();
    const rt = await open({ [REC('employee', 'emp_1')]: [late.promise, ok(HISTORY)], [REC('overtime', OT1)]: [ok({ auditEvents: [A3] })] });
    rt.app.row(0); await flush(); rt.app.fire('swauRecordBtn', 'click'); await flush();
    rt.app.fire('swauBackBtn', 'click'); await flush();
    rt.app.row(2); await flush(); rt.app.fire('swauRecordBtn', 'click'); await flush();
    late.resolve(ok(HISTORY)); await flush();
    check(rt.au().record.entity === 'overtime' && rt.au().history.length === 1 && /History of Overtime record e{32}/.test(rt.appHTML()) && !/Employee created/.test(rt.appHTML()),
      'H. a superseded record history arriving late is dropped');
  }

  /* ---------- I. an event in full ---------- */
  {
    const rt = await open();
    check(rt.app.row(1) === 'fired', 'I. View opens an event'); await flush();
    const html = rt.appHTML();
    const rows = (html.match(/<tr><th scope="row">([^<]*)<\/th><td>([^<]*)<\/td><\/tr>/g) || []).map((r) => r.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|'));
    check(rows.join('\n') === ['|Event id|12|', '|Time (WIB)|2031-04-10 10:04:05|', '|Time (UTC, as stored)|2031-04-10T03:04:05.123456Z|', '|Action|Login access (account.manage)|',
      '|Operation|Create login (provision)|', '|Record type|Employee (employee)|', '|Record id|emp_1|', '|Actor user id|' + U1 + '|', '|Actor membership id|' + M1 + '|',
      '|Target user id|' + T1 + '|', '|Request id|' + RQ + '|', '|Fields changed|None recorded|'].join('\n'),
      'I. every stored field is shown — the WIB time and the exact stored UTC instant, labels with their codes, every id as stored');
    check(/<h1[^>]*>Audit event<\/h1>/.test(html) && /<h2 class="section-title" id="swauDetailTitle" tabindex="-1">Login access — Create login<\/h2>/.test(html) && lastFocus(rt) === 'swauDetailTitle' && auditCalls(rt).length === 1,
      'I. the event heading takes focus; opening an event reads nothing');
    check(/Field names only: the audit history records which fields changed, never their values\./.test(html) && /id="swauRecordBtn">Show record history</.test(html) && /id="swauBackBtn">Back to April 2031</.test(html),
      'I. the field-names note, Show record history and Back are offered');
    rt.app.fire('swauBackBtn', 'click'); await flush();
    check(rt.au().selected === null && (rt.appHTML().match(/data-swau-open/g) || []).length === 4 && lastFocus(rt) === 'swauListTitle' && auditCalls(rt).length === 1,
      'I. Back returns to the month list without reading it again; focus on the list heading');
    rt.app.row(0); await flush();
    check(/\|Operation\|—\||Target user id<\/th><td>—</.test(rt.appHTML().replace(/<[^>]+>/g, '|').replace(/\|+/g, '|')) || /<th scope="row">Target user id<\/th><td>—<\/td>/.test(rt.appHTML()),
      'I. a null operation and target show "—"');
    check(rt.app.row(7) === 'absent' && rt.SessionAudit.openEvent(9, 'month') === undefined && rt.au().selected.event.id === '11', 'I. a row that is not rendered opens nothing');
    firewall(rt, 'I. event');
  }

  /* ---------- J. record history ---------- */
  {
    const rt = await open({ [REC('employee', 'emp_1')]: [ok(HISTORY)] });
    rt.app.row(0); await flush();
    rt.app.fire('swauRecordBtn', 'click'); await flush();
    let html = rt.appHTML();
    check(countOf(rt, REC('employee', 'emp_1')) === 1 && /<h1[^>]*>Record history<\/h1>/.test(html) && /<h2 class="section-title" id="swauRecordTitle" tabindex="-1">History of Employee emp_1<\/h2>/.test(html)
      && lastFocus(rt) === 'swauRecordTitle' && (html.match(/data-swau-open/g) || []).length === 2 && /<td>Employee created<\/td>/.test(html),
      'J. Show record history reads GET /api/audit-events/record?entity=employee&id=emp_1 — the entity and id of the event opened — and lists it');
    rt.app.row(0); await flush();
    check(/\|Event id\|5\|/.test(rt.appHTML().replace(/<[^>]+>/g, '|').replace(/\|+/g, '|')) && /id="swauBackBtn">Back to record history</.test(rt.appHTML()) && !/swauRecordBtn/.test(rt.appHTML()),
      'J. an event of the history opens in full, with Back to record history (no nested history)');
    rt.app.fire('swauBackBtn', 'click'); await flush();
    check(/History of Employee emp_1/.test(rt.appHTML()) && lastFocus(rt) === 'swauRecordTitle' && countOf(rt, REC('employee', 'emp_1')) === 1, 'J. Back returns to the history without reading it again');
    rt.app.fire('swauBackBtn', 'click'); await flush();
    html = rt.appHTML();
    check(rt.au().record === null && (html.match(/data-swau-open/g) || []).length === 4 && countOf(rt, LIST(MONTH)) === 1 && lastFocus(rt) === 'swauListTitle',
      'J. Back from the history returns to the month, which is not read again');
    firewall(rt, 'J. history');
  }
  // Unknown or deleted: the server answers [] for both; the page shows one neutral sentence.
  const emptyHistory = async (entityRow) => {
    const rt = await open({ [REC(MONTH_EVENTS.auditEvents[entityRow].entity, MONTH_EVENTS.auditEvents[entityRow].entityId)]: [ok({ auditEvents: [] })] });
    rt.app.row(entityRow); await flush(); rt.app.fire('swauRecordBtn', 'click'); await flush();
    return rt.appHTML();
  };
  {
    const a = await emptyHistory(0), b = await emptyHistory(2);
    const body = (h) => h.slice(h.indexOf('</h2>'));
    check(/<div class="empty" role="status">No audit history is available for this record\.<\/div>/.test(a) && body(a).replace(/Back to April 2031/, '') === body(b).replace(/Back to April 2031/, ''),
      'J. an empty history is one neutral sentence, the same for every record');
    check(!/delet|not found|exist|unknown|archiv|removed/i.test(body(a)), 'J. the empty history never says whether the record exists, existed or was deleted');
  }
  {
    const rt = await open({ [REC('employee', 'emp_1')]: [err(500, 'internal_error'), ok(HISTORY)] });
    rt.app.row(0); await flush(); rt.app.fire('swauRecordBtn', 'click'); await flush();
    check(/The audit history could not be loaded\./.test(rt.appHTML()) && /id="swauLimitNote"/.test(rt.appHTML()) && /id="swauRetryBtn"/.test(rt.appHTML()), 'J. a failed history read: the failure, the limit note and Retry');
    rt.app.fire('swauRetryBtn', 'click'); await flush();
    check(countOf(rt, REC('employee', 'emp_1')) === 2 && (rt.appHTML().match(/data-swau-open/g) || []).length === 2 && countOf(rt, LIST(MONTH)) === 1, 'J. Retry reads the history again (not the month)');
  }

  /* ---------- K. the session ends ---------- */
  {
    const rt = await open({ [LIST(MONTH)]: [err(401, 'unauthenticated')] });
    check(rt.state() === rt.AUTH_STATES.SIGNED_OUT && rt.au().open === false && rt.au().list === null && rt.au().history === null && !/swau|swSection/.test(rt.appHTML()),
      'K. a 401 on the month read ends the session (sessionLost) and destroys the Audit data');
    firewall(rt, 'K. 401 month');
  }
  {
    const rt = await open({ [REC('employee', 'emp_1')]: [err(401, 'unauthenticated')] });
    rt.app.row(0); await flush(); rt.app.fire('swauRecordBtn', 'click'); await flush();
    check(rt.state() === rt.AUTH_STATES.SIGNED_OUT && rt.au().record === null && rt.au().history === null && rt.au().selected === null && !/emp_1|swau/.test(rt.appHTML()),
      'K. a 401 on the record read ends the session and destroys the Audit data');
  }

  /* ---------- L. a different principal ---------- */
  {
    const rt = await open({ '/api/auth/me': [ok(ME_CEO), ok(ME_EMP)], '/api/auth/login': [ok({})], '/api/employee?id=emp_srv_1': [ok({ employee: SELF })] });
    rt.app.row(0); await flush();
    const gen = rt.au().generation;
    rt.AuthBoot.sessionLost(); await flush();
    await rt.AuthBoot.signIn('employee@example.invalid', 'stub-only-password'); await flush();
    const html = rt.appHTML();
    check(rt.state() === rt.AUTH_STATES.AUTHENTICATED && rt.AuthBoot.snapshot().principal.principalType === 'employee' && rt.au().generation > gen
      && rt.au().open === false && rt.au().list === null && rt.au().selected === null && !/swSectionAudit|swau|emp_1|Audit/.test(html),
      'L. after the session ends and an Employee signs in, nothing of the CEO\'s Audit data remains and there is no Audit section');
    const n = auditCalls(rt).length;
    rt.SessionAudit.show(true); await flush();
    check(auditCalls(rt).length === n && n === 1, 'L. the Employee can never reopen it; no further audit request');
    firewall(rt, 'L. principal change');
  }
  {
    const rt = await open({ [REC('employee', 'emp_1')]: [ok(HISTORY)] });
    rt.app.row(0); await flush(); rt.app.fire('swauRecordBtn', 'click'); await flush();
    check(rt.au().history !== null, 'L. (a record history is held before the principal changes)');
    rt.SessionAuditStore.bindPrincipal({ id: 'u_ceo_2', principalType: 'ceo', employeeId: null });
    const s = rt.au();
    check(s.open === false && s.list === null && s.month === null && s.record === null && s.history === null && s.selected === null && s.error === null,
      'L. binding a different principal destroys every Audit datum — month, list, record, history, event and error');
  }

  /* ---------- M. tab exclusivity ---------- */
  {
    const rt = await open({ ['/api/overtime-records?month=' + MONTH]: [ok({ overtimeRecords: [] })], '/api/employees?archived=1': [ok({ employees: [] })],
      ['/api/payroll-plans?month=' + MONTH]: [ok({ payrollPlans: [] })], ['/api/supplemental-payrolls?month=' + MONTH]: [ok({ supplementalPayrolls: [] })],
      ['/api/supplemental-payrolls/eligibility?month=' + MONTH]: [ok({ eligibility: [] })], ['/api/finance-postings?month=' + MONTH]: [ok({ financePostings: [] })],
      ['/api/finance-executions?month=' + MONTH]: [ok({ financeExecutions: [] })] });
    rt.app.fire('swSectionOvertime', 'click'); await flush();
    check(rt.au().open === false && rt.SessionOvertimeStore.snapshot().open === true && pressed(rt.appHTML()).join() === 'swSectionOvertime' && !/swau/.test(rt.appHTML()), 'M. Overtime closes Audit');
    rt.app.fire('swSectionAudit', 'click'); await flush();
    check(rt.au().open === true && rt.SessionOvertimeStore.snapshot().open === false && pressed(rt.appHTML()).join() === 'swSectionAudit' && countOf(rt, LIST(MONTH)) === 2,
      'M. Audit closes Overtime and reads its month again (nothing is kept across a section switch)');
    rt.app.fire('swSectionPayroll', 'click'); await flush();
    check(rt.au().open === false && rt.SessionPayrollStore.snapshot().open === true && pressed(rt.appHTML()).join() === 'swSectionPayroll' && !/swau/.test(rt.appHTML()), 'M. Payroll closes Audit');
    rt.app.fire('swSectionAudit', 'click'); await flush();
    check(rt.au().open === true && rt.SessionPayrollStore.snapshot().open === false && pressed(rt.appHTML()).join() === 'swSectionAudit', 'M. Audit closes Payroll');
    rt.app.fire('swSectionMain', 'click'); await flush();
    check(rt.au().open === false && pressed(rt.appHTML()).join() === 'swSectionMain' && /<h1[^>]*>Employees<\/h1>/.test(rt.appHTML()), 'M. Employees closes Audit; exactly one section is pressed throughout');
    firewall(rt, 'M. tabs');
  }

  /* ---------- N. size ---------- */
  {
    const many = Array.from({ length: 2000 }, (_, i) => ev(i + 1, '2031-04-10T00:00:00.000000Z'));
    const rt = await open({ [LIST(MONTH)]: [ok({ auditEvents: many })] });
    check((rt.appHTML().match(/data-swau-open="\d+"/g) || []).length === 2000 && /2000 events, oldest first/.test(rt.appHTML()), 'N. 2,000 events are all listed');
    rt.app.row(1999); await flush();
    check(rt.au().selected.event.id === '2000', 'N. the last of 2,000 rows opens through the one delegated listener');
  }

  /* ---------- O. escaping and no identity join ---------- */
  {
    const rt = await open();
    const html = rt.appHTML();
    check(!/Fabricated|fullName \(|employeeCode/.test(html.replace(/fullName, phone/, '')) && rt.net.calls.filter((c) => /^\/api\/employees?\b/.test(c.url) && !/archived/.test(c.url)).length <= 1
      && !rt.net.calls.some((c) => /archived=1/.test(c.url)),
      'O. no identity join: the actor and record are shown as stored ids — no Employee list is read for the Audit section');
  }

  console.log('');
  if(failures.length){
    console.log('AFI-4g SESSION AUDIT RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('AFI-4g SESSION AUDIT RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})().catch(function(e){ console.error(e); process.exit(1); });

const SECTION_TEXT_LEAD = 'Every recorded change in the company, by month of the company calendar (Western Indonesia Time, WIB). Read only.';
