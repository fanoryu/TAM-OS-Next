#!/usr/bin/env node
'use strict';
/* ============================================================
   AFI-4g — SESSION AUDIT (CEO, READ ONLY) RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of AFI-4g. This harness proves its BEHAVIOUR by
   executing every production module (module-order.js, the boot included) in the dependency-free
   Node `vm` loader of the other SESSION harnesses, with the ONE source line
   `const AUTH_MODE = AUTH_MODES.SESSION;` loaded as SESSION in the concatenated text — the
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
// U1 (GR-4): the exact SESSION shell chrome, written out from the U1 specification.
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
const FIXED_NOW = Date.UTC(2031, 3, 15, 12, 0, 0);       // 2031-04-15T12:00:00Z
const MONTH = '2031-04';
// AFI-5b (H-1): the three deleted selector functions, probed lexically and on window/globalThis.
const SELECTOR_PROBE = '[typeof renderIdentitySelectorHTML, typeof bindIdentitySelector, typeof syncIdentitySelector, typeof window.renderIdentitySelectorHTML, typeof window.bindIdentitySelector, typeof window.syncIdentitySelector, typeof globalThis.renderIdentitySelectorHTML, typeof globalThis.bindIdentitySelector, typeof globalThis.syncIdentitySelector].join()';
const SELECTOR_ABSENT = 'undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined';
const NEVER = ['loadState', 'saveState', 'applyTheme', 'installGlobalUIHandlers', 'maybeShowFirstRunChoice', 'startFresh',
  'renderShell', 'renderView', 'restoreCompleteBackup', 'renderSmartImport', 'openGlobalSearch',
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
      // AFI-5b (H-1): the selector functions no longer exist. Their absence is probed in the
      // shared lexical scope (and on window / globalThis) BEFORE any spy is installed — a spy
      // assignment to a missing name would otherwise create it and hide the absence.
      src = 'var __selectorBeforeSpies = ' + SELECTOR_PROBE + ';\n' + NEVER.map((n) => 'try { ' + n + ' = (function(){ return function(){ __spy.push("' + n + '"); return ""; }; })(); } catch(_e){ __spyErr.push("' + n + '"); }').join('\n') + '\n' + src;
    }
    return src;
  });
  const src = parts.join('\n')
    + '\n;window.__TAM__ = { selectorBeforeSpies: __selectorBeforeSpies, selectorNow: function(){ return ' + SELECTOR_PROBE + '; }, State: State, AuthBoot: AuthBoot, AUTH_STATES: AUTH_STATES, API_RESULT_KINDS: API_RESULT_KINDS,'
    + ' ApiClient: ApiClient, AuditApi: AuditApi, AuditDecoders: AuditDecoders, auditJakartaTime: auditJakartaTime, auditJakartaMonth: auditJakartaMonth,'
    + ' auditIsRecord: auditIsRecord, AUDIT_LIST_CAP: AUDIT_LIST_CAP, SessionAuditStore: SessionAuditStore, SessionAudit: SessionAudit,'
    + ' sessionAuditCurrentMonth: sessionAuditCurrentMonth, SessionOvertimeStore: SessionOvertimeStore, SessionPayrollStore: SessionPayrollStore,'
    + ' SESSION_AUDIT_LIMIT_NOTE: SESSION_AUDIT_LIMIT_NOTE, render: render, SessionCsv: SessionCsv, sessionAuditMonthCsv: sessionAuditMonthCsv, parse: function(json){ return JSON.parse(json); } };';
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
  // AWP-05 authorized revision (Owner GO 2026-11-21, OD-13 = A): a recording download: the Blob, its object URL,
  // the <a download> link the CSV export clicks and the deferred revoke (2,000 ms, held until a test runs it).
  // Was: no Blob or URL, and createElement returned an inert element.
  const dl = { blobs: [], clicks: [], revoked: [], timers: [] };
  function RecBlob(parts, opts){ this.parts = parts; this.type = opts && opts.type; dl.blobs.push(this); }
  const dlEl = (tag) => { const el = mkEl(); if(String(tag).toLowerCase() === 'a') el.click = function(){ dl.clicks.push({ href: el.href, download: el.download, rel: el.rel }); }; return el; };
  const document = { addEventListener:noop, removeEventListener:noop,
    getElementById: (id) => (els[id] = els[id] || mkEl()),
    querySelector:()=>null, querySelectorAll:()=>[], createElement:(t)=>dlEl(t), contains:()=>false,
    body: mkEl(), documentElement: { dataset:{}, style:{} }, activeElement: null };
  Object.defineProperty(document, 'cookie', { get: () => { access.cookie.push('get'); return ''; }, set: () => { access.cookie.push('set'); } });
  const sandbox = {
    __spy: [], __spyErr: [], Date: FixedDate,
    console: { log:noop, warn:noop, error:noop, info:noop }, navigator: { userAgent:'tam-afi4g' },
    setTimeout: function(fn, ms){ if(ms === 2000){ dl.timers.push(fn); return 'dl-timer-' + dl.timers.length; } if(ms === 10000){ net.timers.push(fn); return 'api-timer-' + net.timers.length; } return setTimeout(fn, ms); },
    clearTimeout: function(id){ if(!/^api-timer-/.test(String(id))) clearTimeout(id); },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    AbortController: AbortController, fetch: fetchStub,
    localStorage: storageOf(access.local), sessionStorage: storageOf(access.session), storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: () => { access.url.push('confirm()'); return true; },
    // UX-1 authorized revision (Owner GO 2026-11-17): the SESSION shell writes its route (#/name) to the address
    // bar, so this recording history also moves location.hash, as a browser does. The harness boots through the
    // direct link #/employees (the People page; My profile for an Employee) — the section it exercises — so the
    // landing Home and its reads stay out of these flows (Home is verified in verify-session-shell-runtime.js).
    // Was: an empty hash; any write failed.
    location: { hash: '#/employees', search: '', pathname: '/', href: 'http://127.0.0.1/#/employees' },
    history: { replaceState: (a, b, u) => { access.url.push(String(u)); sandbox.location.hash = /^#/.test(String(u)) ? String(u) : ''; }, pushState: (a, b, u) => { access.url.push(String(u)); sandbox.location.hash = /^#/.test(String(u)) ? String(u) : ''; } },   // UX-1: a bare-path write clears the hash
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: document,
    Blob: RecBlob, URL: { createObjectURL: (b) => 'blob:http://127.0.0.1/' + dl.blobs.indexOf(b), revokeObjectURL: (u) => { dl.revoked.push(u); } }   // AWP-05
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  dom.doc = sandbox.document;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-afi4g-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.dl = dl; rt.sandbox = sandbox;   // AWP-05
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
// U1 authorized revision (GR-4): the current section is the SESSION shell's aria-current item. Was: the
// aria-pressed tab buttons.
const SECTION_BUTTONS = { main: 'swSectionMain', overtime: 'swSectionOvertime', payroll: 'swSectionPayroll', audit: 'swSectionAudit' };
const pressed = (html) => { const sh = parseSessionShell(html); return sh ? [SECTION_BUTTONS[sh.active]] : []; };

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
  check(rt.selectorBeforeSpies === SELECTOR_ABSENT && rt.selectorNow() === SELECTOR_ABSENT,
    label + ': AFI-5b — the selector functions do not exist (lexically or on window/globalThis), before the spies and now');
  // UX-1 authorized revision: only the SESSION shell route (#/name) may be written — never an email, draft, id,
  // state or query. Was: nothing written at all.
  // UX-1 authorized revision: leaving the shell (sign-out, session loss) clears the route with one write of the bare
  // path ('/', no hash, no query) — never another value. Was: route fragments only.
  check(rt.access.url.every((u) => /^#\/[a-z]+$/.test(u) || u === '/') && /^(#\/[a-z]+)?$/.test(rt.loc.hash) && rt.loc.search === '', label + ': nothing is written to the address bar (no history entry, hash or query) — only the shell route name (#/name), or its clear (/) when the shell is left');
  // U1 authorized revision (GR-4, D-GS-1): AUTHENTICATED renders the card inside the exact SESSION shell;
  // the content checks run on the card alone, and no other state has a shell. Was: no sidebar at all and
  // allowsWorkspace() false.
  const shell = parseSessionShell(rt.appHTML());
  const authed = rt.AuthBoot.snapshot().state === 'AUTHENTICATED';
  const html = shell ? shell.content : rt.appHTML();
  check(!/identity-selector|identityPrincipalSelect|Acting as|class="sidebar"|data-nav=|Smart Import|Backup|Restore|Start fresh|<script|\son[a-z]+=|style="/i.test(html) && !/style="|\son[a-z]+=|<script/i.test(rt.appHTML()),
    label + ': the DOM carries no "Acting as", LOCAL navigation, local data tool, script, inline handler or inline style');
  check((shell ? authed && rt.AuthBoot.allowsWorkspace() === true : !authed && rt.AuthBoot.allowsWorkspace() === false) && rt.spy.indexOf('renderShell') === -1 && rt.State.employees.length === 0,
    label + ': only the exact SESSION shell, only while AUTHENTICATED; the LOCAL business shell is never mounted and legacy State stays empty');
  check(rt.net.calls.every((c) => !/^\/api\/audit-events/.test(c.url) || (c.init.method === 'GET' && c.init.body === undefined && !c.init.headers['X-CSRF-Token']
    && c.init.credentials === 'same-origin' && c.init.cache === 'no-store' && ['month', 'entity,id'].indexOf(queryKeys(c.url)) !== -1)),
    label + ': every audit request is a bodiless same-origin GET without a CSRF token whose query is exactly ?month= or ?entity=&id= (never a company, role or scope)');
}

// AWP-05 (CodeQL alerts #21 and #22 corrections): the CEO Audit month table read by its exact structure with a
// forward-only cursor — literal startsWith() / indexOf() delimiters and slice(), no regular expression over the
// table and no tag stripping. Each cell's text must hold no '<' or '>'; the header cells, every body row (six cells
// and its View button, numbered 0, 1, 2 … in order) and the closing tags must follow exactly, or the whole table is
// refused (null). The cursor only moves forward and every indexOf() result is consumed or ends the read, so the
// work is linear in the input. The five entities escapeHtml() emits are decoded in one pass, never re-scanned.
const AUDIT_TABLE_ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const auditTableDecode = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (m, n) => AUDIT_TABLE_ENTITY[n]);
function readAuditMonthTable(html){
  const OPEN = '<div class="table-wrap" id="swauList" data-swau-from="month"><table><thead><tr>';
  const start = html.indexOf(OPEN);
  if(start === -1) return null;
  let i = start + OPEN.length;
  const take = (lit) => { if(!html.startsWith(lit, i)) return false; i += lit.length; return true; };
  // The text up to the next `end`, which must hold no markup; the cursor moves past `end`.
  const until = (end) => {
    const j = html.indexOf(end, i);
    if(j === -1) return null;
    const v = html.slice(i, j);
    if(v.indexOf('<') !== -1 || v.indexOf('>') !== -1) return null;
    i = j + end.length;
    return v;
  };
  const heads = [];
  while(take('<th scope="col">')){
    const h = until('</th>');
    if(h === null || h === '') return null;
    heads.push(auditTableDecode(h));
  }
  if(!heads.length || !take('<th scope="col" aria-label="Open event"></th></tr></thead><tbody>')) return null;
  const rows = [];
  while(take('<tr><td><time datetime="')){
    const iso = until('">');
    const wib = iso === null ? null : until('</time></td><td>');
    const action = wib === null ? null : until('</td><td>');
    const record = action === null ? null : until('</td><td>');
    const actor = record === null ? null : until('</td><td>');
    const fields = actor === null ? null : until('</td><td><button class="btn" type="button" data-swau-open="');
    const index = fields === null ? null : until('">View</button></td></tr>');
    if(index === null || iso.indexOf('"') !== -1 || wib === '' || index !== String(rows.length)) return null;
    rows.push({ iso: iso, wib: auditTableDecode(wib), action: auditTableDecode(action), record: auditTableDecode(record),
      actor: auditTableDecode(actor), fields: auditTableDecode(fields) });
  }
  return take('</tbody></table></div>') ? { heads: heads, rows: rows } : null;
}

(async function main(){
  console.log('== AFI-4g — SESSION AUDIT RUNTIME VERIFICATION ==');

  /* ---------- A. who sees the Audit section ---------- */
  {
    const rt = await boot(ME_CEO);
    const html = rt.appHTML();
    // U1 authorized revision (GR-4): the CEO shell (its last item Audit, after Payroll, by the oracle). Was: the tab row.
    check((parseSessionShell(html) || {}).role === 'ceo' && /id="swSectionPayroll"[\s\S]*id="swSectionAudit"/.test(html)
      && pressed(html).join() === 'swSectionMain' && auditCalls(rt).length === 0,
      'A. the CEO has a fourth section button, Audit, after Payroll — unpressed by default; nothing is read before it is opened');
    firewall(rt, 'A. CEO');
  }
  {
    const rt = await boot(ME_EMP);
    const html = rt.appHTML();
    // U1 authorized revision (GR-4): the Employee shell has no Audit item. Was: the tab row ended at My payroll.
    check(!/swSectionAudit|>Audit</.test(html) && (parseSessionShell(html) || {}).role === 'employee', 'A. an Employee has no Audit section button (My profile | My overtime | My payroll)');
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

  /* ---------- X. AWP-05 CSV export of the month shown (OD-13 = A, Owner 2026-11-21) ---------- */
  {
    const BOM = String.fromCharCode(0xFEFF), CRLF = String.fromCharCode(13, 10);
    const csvOf = (rt) => rt.dl.blobs[rt.dl.blobs.length - 1].parts.join('');
    // AWP-05 correction (Owner GO 2026-11-21): exactly the five columns of the month table, in its order. Was: plus
    // "Time (UTC, as stored)" as the second column.
    const HEAD = 'Time (WIB),Action,Record,Actor user id,Fields changed';
    const rt = await open();
    const calls = rt.net.calls.length;
    check(/id="swauExportBtn"/.test(rt.appHTML()) && rt.app.fire('swauExportBtn', 'click') === 'fired' && rt.dl.clicks.length === 1, 'X. the month list shows Export CSV and starts one download'); await flush();
    // The shown table, cell by cell, read by readAuditMonthTable() (a forward-only cursor parser; see its comment).
    const table = readAuditMonthTable(rt.appHTML());
    check(!!table && table.rows.length === 4,
      'X. the month table is read by its exact structure: every body row is a whole, well-formed six-cell row (no unexpected markup), opened by its own position');
    const shown = table ? table.rows.map((r) => [r.wib, r.action, r.record, r.actor, r.fields === '—' ? '' : r.fields]) : [];
    const q = (v) => /[",]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    const expected = BOM + [HEAD].concat(shown.map((r) => r.map(q).join(','))).join(CRLF) + CRLF;
    check(shown.length === 4 && csvOf(rt) === expected, 'X. the CSV is exactly the four events shown, in their order, cell for cell as the month table shows them');
    const ths = table ? table.heads : [];
    // The parser itself: malformed or unexpected markup is refused whole, and a large hostile input ends in one pass.
    const T_OPEN = '<div class="table-wrap" id="swauList" data-swau-from="month"><table><thead><tr><th scope="col">Time (WIB)</th>'
      + '<th scope="col" aria-label="Open event"></th></tr></thead><tbody>';
    const T_ROW = (i, cell) => '<tr><td><time datetime="2031-04-01T00:00:00.000000Z">2031-04-01 07:00:00</time></td><td>' + cell + '</td><td>R</td><td>A</td><td>F</td>'
      + '<td><button class="btn" type="button" data-swau-open="' + i + '">View</button></td></tr>';
    const T_CLOSE = '</tbody></table></div>';
    const good = readAuditMonthTable(T_OPEN + T_ROW(0, 'Employee &amp;lt;x&amp;gt; &quot;q&quot;') + T_ROW(1, 'B') + T_CLOSE);
    check(!!good && good.heads.join() === 'Time (WIB)' && good.rows.length === 2 && good.rows[0].action === 'Employee &lt;x&gt; "q"',
      'X. parser: a well-formed table is read; entities are decoded once (&amp;lt; stays the text "&lt;")');
    const BAD = [
      ['markup inside a cell', T_OPEN + T_ROW(0, '<b>B</b>') + T_CLOSE],
      ['an extra cell', T_OPEN + T_ROW(0, 'B</td><td>extra') + T_CLOSE],
      ['rows out of order', T_OPEN + T_ROW(1, 'B') + T_ROW(0, 'B') + T_CLOSE],
      ['a stray element between rows', T_OPEN + T_ROW(0, 'B') + '<tr></tr>' + T_ROW(1, 'B') + T_CLOSE],
      ['no closing table', T_OPEN + T_ROW(0, 'B')],
      ['no table at all', '<p>nothing</p>'],
      ['an empty header cell', T_OPEN.replace('Time (WIB)', '') + T_CLOSE],
      ['a quote in the datetime', T_OPEN + T_ROW(0, 'B').replace('2031-04-01T00', '2031"-04-01T00') + T_CLOSE]
    ];
    check(BAD.every((b) => readAuditMonthTable(b[1]) === null), 'X. parser: refused whole — ' + BAD.map((b) => b[0]).join('; '));
    const big = T_OPEN + '<tr>' + '</tr><tr>'.repeat(200000) + T_CLOSE;
    const longCell = T_OPEN + T_ROW(0, 'x'.repeat(2000000)) + T_CLOSE;
    const t0 = process.hrtime.bigint();
    const bigOut = readAuditMonthTable(big), longOut = readAuditMonthTable(longCell);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    check(bigOut === null && !!longOut && longOut.rows[0].action.length === 2000000 && ms < 2000,
      'X. parser: 200,000 repetitions of "</tr><tr>" are refused and a 2,000,000-character cell is read, in one linear pass (' + Math.round(ms) + ' ms)');
    check(ths.join(',') === HEAD && csvOf(rt).slice(1).split(CRLF)[0] === HEAD && HEAD.split(',').length === 5,
      'X. the CSV header is exactly the five month-table columns, in their order: Time (WIB), Action, Record, Actor user id, Fields changed');
    const cells = (line) => { const out = []; let cur = '', inQ = false; for(let i = 0; i < line.length; i++){ const ch = line[i];
      if(inQ){ if(ch === '"' && line[i + 1] === '"'){ cur += '"'; i++; } else if(ch === '"') inQ = false; else cur += ch; }
      else if(ch === '"') inQ = true; else if(ch === ','){ out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
    const body = csvOf(rt).slice(1).split(CRLF).slice(1, -1);
    check(body.length === 4 && body.every((l) => cells(l).length === 5) && !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}|UTC/.test(csvOf(rt)),
      'X. every row has exactly five cells; no stored UTC instant (or UTC column) is in the file');
    check(csvOf(rt).split(CRLF)[1] === '2031-04-01 00:00:00,Employee updated,Employee emp_1,' + U1 + ',"fullName, phone"'
      && csvOf(rt).split(CRLF)[2] === '2031-04-10 10:04:05,Login access — Create login,Employee emp_1,' + U1 + ','
      && csvOf(rt).split(CRLF)[4] === '2031-04-30 23:59:59,Payroll plan — Commit,Payroll plan ' + PP1 + ',' + U1 + ',',
      'X. independently: WIB times are correct at both month edges (2031-03-31T17:00Z is 2031-04-01 00:00:00; 2031-04-30T16:59:59.999999Z is 2031-04-30 23:59:59); field names quoted for their comma; no fields is an empty cell, never "—" or 0');
    const hostile = rt.sessionAuditMonthCsv({ listStatus: 'ready', list: [Object.assign({}, A1, { actorUserId: '=HYPERLINK("http://example.invalid")', entityId: '+cmd', fields: ['@x', '-1'] })], listMonth: MONTH, month: MONTH });
    check(!!hostile && hostile.content.split(CRLF)[1] === '2031-04-01 00:00:00,Employee updated,Employee +cmd,"\'=HYPERLINK(""http://example.invalid"")","\'@x, -1"',
      'X. formula protection holds in the audit CSV: an actor id starting with = and fields starting with @ are apostrophe-neutralised (a label that does not start with a prefix stays as is)');
    check(!new RegExp([M1, RQ, T1, 'requestId', 'membership', CSRF].join('|')).test(csvOf(rt)), 'X. no membership id, request id, target user id or token is exported');
    const k = rt.dl.clicks[0];
    check(k.download === 'tam-os-audit-2031-04.csv' && /^blob:http:\/\/127\.0\.0\.1\//.test(k.href) && k.rel === 'noopener' && rt.dl.blobs[0].type === 'text/csv;charset=utf-8' && rt.net.calls.length === calls,
      'X. the download is a blob: link named tam-os-audit-2031-04.csv, typed text/csv;charset=utf-8, and no request is made');
    check(/<p class="auth-message" id="swauMessage" role="status" tabindex="-1">CSV file prepared for download: exactly the events shown for this month\. Downloads are not recorded in the audit history\.<\/p>/.test(rt.appHTML()),
      'X. a status notice says the file holds exactly the events shown and that downloads are not recorded in the audit history');
    rt.dl.timers.shift()();
    check(rt.dl.revoked.join() === k.href, 'X. the object URL is revoked afterwards');
    firewall(rt, 'X. month export');
    // An event or a record history open: no export.
    rt.app.row(0); await flush();
    check(/<tr><th scope="row">Time \(UTC, as stored\)<\/th><td>2031-03-31T17:00:00\.000000Z<\/td><\/tr>/.test(rt.appHTML()),
      'X. the event view still shows the stored UTC instant (Time (UTC, as stored)), unchanged by the export');
    check(!/id="swauExportBtn"/.test(rt.appHTML()) && rt.SessionAudit.exportCsv() === false && rt.dl.clicks.length === 1, 'X. an event open shows no Export CSV and exports nothing');
    rt.SessionAuditStore.openRecord(A1);
    check(rt.SessionAudit.exportCsv() === false && rt.dl.clicks.length === 1, 'X. a record history open exports nothing');
  }
  {
    const BOM = String.fromCharCode(0xFEFF), CRLF = String.fromCharCode(13, 10);
    const rt = await open({ [LIST(MONTH)]: [ok({ auditEvents: [] })] });
    rt.app.fire('swauExportBtn', 'click'); await flush();
    check(rt.dl.clicks.length === 1 && rt.dl.blobs[0].parts.join('') === BOM + 'Time (WIB),Action,Record,Actor user id,Fields changed' + CRLF,
      'X. an empty month exports a valid CSV of the header alone');
    firewall(rt, 'X. empty month');
  }
  {
    const CRLF = String.fromCharCode(13, 10);
    const rt = await open({ [LIST(MONTH)]: [err(500, 'internal_error')] });
    check(!/id="swauExportBtn"/.test(rt.appHTML()) && rt.SessionAudit.exportCsv() === false && rt.dl.blobs.length === 0, 'X. a month that failed (the 2,000 cap fails closed) shows no Export CSV and exports nothing');
    const hang = await open({ [LIST(MONTH)]: ['HANG'] });
    check(!/id="swauExportBtn"/.test(hang.appHTML()) && hang.SessionAudit.exportCsv() === false && hang.dl.blobs.length === 0, 'X. a month still loading shows no Export CSV and exports nothing');
    const moved = await open({ [LIST('2031-03')]: ['HANG'] });
    moved.SessionAudit.setMonth('2031-03'); await flush();
    check(moved.au().month === '2031-03' && !/id="swauExportBtn"/.test(moved.appHTML()) && moved.SessionAudit.exportCsv() === false && moved.dl.blobs.length === 0,
      'X. after a month change, the previous month is never exported as the new one');
    const over = await open({ [LIST(MONTH)]: [ok({ auditEvents: Array.from({ length: 2001 }, (_, i) => ev(i + 1, '2031-04-10T00:00:00.000000Z')) })] });
    check(!/id="swauExportBtn"/.test(over.appHTML()) && over.SessionAudit.exportCsv() === false, 'X. 2,001 events are refused whole: no Export CSV, never a truncated file');
    const full = await open({ [LIST(MONTH)]: [ok({ auditEvents: Array.from({ length: 2000 }, (_, i) => ev(i + 1, '2031-04-10T00:00:00.000000Z')) })] });
    full.app.fire('swauExportBtn', 'click'); await flush();
    check(full.dl.blobs.length === 1 && full.dl.blobs[0].parts.join('').split(CRLF).length === 2002, 'X. exactly 2,000 events export as 2,000 lines under the header');
  }
  {
    const rt = await open();
    rt.sandbox.Blob = undefined;
    rt.app.fire('swauExportBtn', 'click'); await flush();
    check(rt.dl.clicks.length === 0 && /<p class="auth-message auth-message-warn" id="swauMessage" role="alert" tabindex="-1">This browser cannot prepare a download, so nothing was exported\.<\/p>/.test(rt.appHTML()),
      'X. a browser without Blob gets an alert that nothing was exported');
    const emp = await boot(ME_EMP);
    check(!/swauExportBtn|Export CSV/.test(emp.appHTML()) && emp.SessionAudit.exportCsv() === false && emp.dl.blobs.length === 0 && auditCalls(emp).length === 0,
      'X. an Employee never sees Export CSV, and a direct exportCsv() call exports nothing and reads nothing');
    // AWP-05 final pre-commit: the CEO guard alone. A fabricated, successfully read month is planted in the Employee's
    // store (open, READY, the month shown); the CSV builder would export it, exportCsv() must not.
    const S = emp.SessionAuditStore;
    S.setOpen(true, MONTH);
    const t = S.begin('list', MONTH); S.applyList(t, emp.AuditDecoders.monthResponse(emp.parse(JSON.stringify(MONTH_EVENTS)), MONTH));
    const planted = emp.au();
    const callsBefore = emp.net.calls.length;
    check(planted.open === true && planted.listStatus === 'ready' && planted.listMonth === MONTH && planted.month === MONTH && planted.list.length === 4 && !!emp.sessionAuditMonthCsv(planted),
      'X. control: the planted Employee store holds a READY month that the CSV builder would export');
    check(emp.SessionAudit.exportCsv() === false && emp.dl.blobs.length === 0 && emp.dl.clicks.length === 0 && emp.net.calls.length === callsBefore,
      'X. CEO guard: an Employee holding a fabricated READY audit month gets false from exportCsv(): no Blob, no download, no request');
    check(emp.au().notice === null && !/swauExportBtn|swauMessage|Export CSV|emp_1|fullName|tam-os-/.test(emp.appHTML()),
      'X. CEO guard: nothing of the planted month, no export notice and no file name reaches the Employee page');
  }

  /* ---------- O. escaping and no identity join ---------- */
  {
    const rt = await open();
    const html = rt.appHTML();
    check(!/Fabricated|fullName \(|employeeCode/.test(html.replace(/fullName, phone/, '')) && rt.net.calls.filter((c) => /^\/api\/employees?\b/.test(c.url) && !/archived/.test(c.url)).length <= 1
      && !rt.net.calls.some((c) => /archived=1/.test(c.url)),
      'O. no identity join: the actor and record are shown as stored ids — no Employee list is read for the Audit section');
  }

  /* ---------- P. Phase 1 Finance events (migration 0038; PH1-QA-01) ---------- */
  // Phase 1 authorized revision (PH1-QA-01, Owner 2026-11-13): migration 0038 adds finance.manage on
  // financeTransaction with the operations create and void. One such event must decode and show
  // beside every other event of its month — not fail the month — while every other vocabulary stays
  // closed. Was: the migration-0035 vocabulary only.
  {
    const TX1 = '0123456789abcdef'.repeat(2);
    const FC = ev(15, '2031-04-11T01:00:00.000000Z', { action: 'finance.manage', entity: 'financeTransaction', entityId: TX1, operation: 'create', fields: [] });
    const FV = ev(16, '2031-04-12T01:00:00.000000Z', { action: 'finance.manage', entity: 'financeTransaction', entityId: TX1, operation: 'void', fields: [] });
    const MIXED = [A1, A2, A3, FC, FV, A4];
    const rt = await boot(ME_CEO);
    const page = (o) => rt.parse(JSON.stringify(o));
    const dec = (events) => rt.AuditDecoders.monthResponse(page({ auditEvents: events }), MONTH);
    const c = dec([FC]), v = dec([FV]);
    check(c !== null && v !== null && c[0].action === 'finance.manage' && c[0].entity === 'financeTransaction' && c[0].entityId === TX1 && c[0].operation === 'create'
      && v[0].operation === 'void' && Object.isFrozen(c[0]),
      'P. a Finance transaction create and a void (finance.manage, financeTransaction, create | void) decode exactly');
    const mixed = dec(MIXED);
    check(mixed !== null && mixed.map((e) => e.id).join() === '11,12,13,15,16,14',
      'P. a month mixing Finance and earlier events decodes whole, in the server\'s order (the PH1-QA-01 month)');
    const badFinance = [
      ['finance.manage without an operation', Object.assign({}, FC, { operation: null })],
      ['finance.manage with execute', Object.assign({}, FC, { operation: 'execute' })],
      ['finance.manage with commit', Object.assign({}, FC, { operation: 'commit' })],
      ['finance.manage with an edit operation', Object.assign({}, FC, { operation: 'edit' })],
      ['finance.manage with a delete operation', Object.assign({}, FC, { operation: 'delete' })],
      ['finance.manage on a Finance posting', Object.assign({}, FC, { entity: 'financePosting' })],
      ['finance.execute on a Finance transaction', Object.assign({}, FC, { action: 'finance.execute', operation: 'execute' })],
      ['payroll.manage with void', Object.assign({}, A4, { operation: 'void' })],
      ['a Finance transaction id in the employee format', Object.assign({}, FC, { entityId: 'tx_1' })],
      ['an upper-case Finance transaction id', Object.assign({}, FC, { entityId: TX1.toUpperCase() })],
      ['an unknown Finance action', Object.assign({}, FC, { action: 'finance.void' })],
      ['an unknown Finance entity', Object.assign({}, FC, { entity: 'generalTransaction' })]
    ];
    badFinance.forEach(function(b){ check(dec([b[1]]) === null && dec([A1, b[1]]) === null, 'P. unknown or mismatched vocabulary still fails the whole answer: ' + b[0]); });
    const rec = (events, e, id) => rt.AuditDecoders.recordResponse(page({ auditEvents: events }), e, id);
    check(rt.auditIsRecord('financeTransaction', TX1) && !rt.auditIsRecord('financeTransaction', 'tx_1') && !rt.auditIsRecord('generalTransaction', TX1)
      && rec([FC, FV], 'financeTransaction', TX1) !== null && rec([FC, FV], 'financeTransaction', TX1).length === 2 && rec([FC, A3], 'financeTransaction', TX1) === null,
      'P. a Finance transaction is a stored audit record: its history decodes, and holds only its own events');
    const open2 = await open({ [LIST(MONTH)]: [ok({ auditEvents: MIXED })], [REC('financeTransaction', TX1)]: [ok({ auditEvents: [FC, FV] })] });
    let html = open2.appHTML();
    check(!/id="swauError"/.test(html) && (html.match(/data-swau-open="\d+"/g) || []).length === 6 && /6 events, oldest first\./.test(html)
      && /<td>Finance transaction — Create<\/td><td>Finance transaction 0123456789abcdef0123456789abcdef<\/td>/.test(html)
      && /<td>Finance transaction — Void<\/td><td>Finance transaction 0123456789abcdef0123456789abcdef<\/td>/.test(html)
      && /<td>Employee updated<\/td>/.test(html) && /<td>Login access — Create login<\/td>/.test(html) && /<td>Overtime decision — Approve<\/td>/.test(html) && /<td>Payroll plan — Commit<\/td>/.test(html),
      'P. the Audit month shows the Finance create and void with their labels beside the earlier events, and no error');
    open2.app.row(4); await flush();
    html = open2.appHTML();
    check(/<h2 class="section-title" id="swauDetailTitle" tabindex="-1">Finance transaction — Void<\/h2>/.test(html) && /Void \(void\)/.test(html),
      'P. a Finance void opens in full with its operation label');
    open2.app.fire('swauRecordBtn', 'click'); await flush();
    html = open2.appHTML();
    check(countOf(open2, REC('financeTransaction', TX1)) === 1 && /History of Finance transaction 0123456789abcdef0123456789abcdef/.test(html) && (html.match(/data-swau-open/g) || []).length === 2,
      'P. its record history reads GET /api/audit-events/record?entity=financeTransaction&id=… once and lists the create and the void');
    check(open2.net.calls.every((x) => ((x.init && x.init.method) || 'GET') === 'GET') && auditCalls(open2).every((x) => /^\/api\/audit-events(\/record)?\?/.test(x.url)),
      'P. the Audit section still only reads: no write, and only the two audit read paths');
    firewall(open2, 'P. Finance events');
  }

  /* ---------- Q. AWP-01 finance request events (migration 0041; ADR-016 D1–D4) ---------- */
  // AWP-01 (ADR-016) authorized revision: migration 0041 makes the audit vocabulary a triple set —
  // finance.execute and finance.manage name a finance request too, and the three reimbursement self
  // actions join. Every new triple must decode and be labelled (D1), a month mixing Phase 1, payroll
  // and Phase 2 events must decode whole (D2), a request's history and its linked expense's history
  // must read back (D3), and every out-of-set triple or malformed id must fail the whole answer (D4).
  // Was: the 0038 vocabulary (section P).
  {
    const RQ = 'fedcba9876543210'.repeat(2);
    const TX2 = 'abcdefabcdefabcd'.repeat(2);
    const at = (d) => '2031-04-' + d + 'T03:00:00.000000Z';
    const NEW = [
      ['reimbursement.createSelfDraft', 'financeRequest', RQ, null, ['amount', 'category', 'description', 'documentDate', 'financialPost'], 'Reimbursement draft created'],
      ['reimbursement.updateSelfDraft', 'financeRequest', RQ, null, ['amount'], 'Reimbursement draft updated'],
      ['reimbursement.submitSelf', 'financeRequest', RQ, 'submit', [], 'Reimbursement submitted — Submit'],
      ['finance.manage', 'financeRequest', RQ, 'create', ['amount', 'payee'], 'Finance request — Create'],
      ['finance.manage', 'financeRequest', RQ, 'update', ['amount'], 'Finance request — Update'],
      ['finance.manage', 'financeRequest', RQ, 'submit', [], 'Finance request — Submit'],
      ['finance.manage', 'financeRequest', RQ, 'approve', [], 'Finance request — Approve'],
      ['finance.manage', 'financeRequest', RQ, 'reject', [], 'Finance request — Reject'],
      ['finance.manage', 'financeRequest', RQ, 'cancel', [], 'Finance request — Cancel'],
      ['finance.execute', 'financeRequest', RQ, 'pay', [], 'Finance request paid — Pay'],
      ['finance.execute', 'financeTransaction', TX2, 'create', [], 'Payment recorded — Create']
    ];
    const QE = NEW.map((n, i) => ev(30 + i, at(String(13 + i)), { action: n[0], entity: n[1], entityId: n[2], operation: n[3], fields: n[4] }));
    const rt = await boot(ME_CEO);
    const page = (o) => rt.parse(JSON.stringify(o));
    const dec = (events) => rt.AuditDecoders.monthResponse(page({ auditEvents: events }), MONTH);
    const rec = (events, e, id) => rt.AuditDecoders.recordResponse(page({ auditEvents: events }), e, id);
    QE.forEach(function(e, i){
      const d = dec([e]);
      check(d !== null && d.length === 1 && d[0].action === NEW[i][0] && d[0].entity === NEW[i][1] && d[0].entityId === NEW[i][2] && d[0].operation === NEW[i][3]
        && d[0].fields.join() === NEW[i][4].join() && Object.isFrozen(d[0]),
        'Q. D1: the new triple (' + NEW[i][0] + ', ' + NEW[i][1] + ', ' + NEW[i][3] + ') decodes exactly');
    });
    check(rt.auditIsRecord('financeRequest', RQ) && !rt.auditIsRecord('financeRequest', 'req_1') && !rt.auditIsRecord('financeRequest', RQ.toUpperCase()),
      'Q. D1: a finance request is a stored audit record with a 32-hex id');
    const openQ = await open({ [LIST(MONTH)]: [ok({ auditEvents: QE })] });
    let html = openQ.appHTML();
    check(!/id="swauError"/.test(html) && /11 events, oldest first./.test(html)
      && NEW.every((n) => html.includes('<td>' + n[5] + '</td><td>' + (n[1] === 'financeRequest' ? 'Finance request ' : 'Finance transaction ') + n[2] + '</td>')),
      'Q. D1: every new triple is shown with its fixed label and record label (Finance request / Finance transaction)');
    firewall(openQ, 'Q. D1 labels');
    // D2: a month mixing the earlier events, a Phase 1 Finance transaction and the Phase 2 events.
    const FC2 = ev(29, at('12'), { action: 'finance.manage', entity: 'financeTransaction', entityId: TX2, operation: 'create', fields: [] });
    const MIXED = [A1, A2, A3, FC2].concat(QE, [A4]);
    const mixed = dec(MIXED);
    check(mixed !== null && mixed.length === 16 && mixed.map((e) => e.id).join() === MIXED.map((e) => e.id).join(),
      'Q. D2: a month mixing earlier, payroll, Phase 1 Finance and Phase 2 events decodes whole, in the server\'s order');
    // D3: the request's history and the linked expense's history.
    const LIFE = QE.filter((e, i) => NEW[i][1] === 'financeRequest');
    const life = rec(LIFE, 'financeRequest', RQ);
    check(life !== null && life.length === 10 && life.every((e) => e.entity === 'financeRequest' && e.entityId === RQ)
      && rec([FC2, QE[10]], 'financeTransaction', TX2) !== null && rec([FC2, QE[10]], 'financeTransaction', TX2).some((e) => e.action === 'finance.execute' && e.operation === 'create')
      && rec(LIFE.concat([QE[10]]), 'financeRequest', RQ) === null,
      'Q. D3: a request\'s record history decodes its full lifecycle; its linked expense\'s history holds the finance.execute / create row; a foreign event fails the answer');
    const openR = await open({ [LIST(MONTH)]: [ok({ auditEvents: LIFE })], [REC('financeRequest', RQ)]: [ok({ auditEvents: LIFE })] });
    openR.app.row(9); await flush();
    openR.app.fire('swauRecordBtn', 'click'); await flush();
    html = openR.appHTML();
    check(countOf(openR, REC('financeRequest', RQ)) === 1 && /History of Finance request fedcba9876543210fedcba9876543210/.test(html) && (html.match(/data-swau-open/g) || []).length === 10,
      'Q. D3: the request\'s record history reads GET /api/audit-events/record?entity=financeRequest&id=… once and lists its ten events');
    firewall(openR, 'Q. D3 history');
    // D4: every out-of-set triple and malformed id fails the whole answer, alone and beside valid events.
    const B = QE[6]; // finance.manage / financeRequest / approve
    const BAD = [
      ['finance.manage paying a request', Object.assign({}, B, { operation: 'pay' })],
      ['finance.manage voiding a request', Object.assign({}, B, { operation: 'void' })],
      ['finance.manage on a request without an operation', Object.assign({}, B, { operation: null })],
      ['finance.manage executing a request', Object.assign({}, B, { operation: 'execute' })],
      ['finance.execute approving a request', Object.assign({}, B, { action: 'finance.execute' })],
      ['finance.execute creating a request', Object.assign({}, B, { action: 'finance.execute', operation: 'create' })],
      ['finance.execute executing a request', Object.assign({}, B, { action: 'finance.execute', operation: 'execute' })],
      ['finance.execute voiding a transaction', Object.assign({}, QE[10], { operation: 'void' })],
      ['finance.execute on a transaction without an operation', Object.assign({}, QE[10], { operation: null })],
      ['finance.execute paying a posting', Object.assign({}, QE[10], { entity: 'financePosting', operation: 'pay' })],
      ['reimbursement.submitSelf approving', Object.assign({}, QE[2], { operation: 'approve' })],
      ['reimbursement.submitSelf without an operation', Object.assign({}, QE[2], { operation: null })],
      ['reimbursement.createSelfDraft with an operation', Object.assign({}, QE[0], { operation: 'create' })],
      ['reimbursement.updateSelfDraft with an operation', Object.assign({}, QE[1], { operation: 'update' })],
      ['a reimbursement action on an overtime record', Object.assign({}, QE[0], { entity: 'overtime' })],
      ['a reimbursement action on a transaction', Object.assign({}, QE[2], { entity: 'financeTransaction' })],
      ['finance.manage on a posting', Object.assign({}, B, { entity: 'financePosting' })],
      ['payroll.manage on a request', Object.assign({}, B, { action: 'payroll.manage', operation: 'approve' })],
      ['overtime.manage on a request', Object.assign({}, B, { action: 'overtime.manage' })],
      ['an unknown reimbursement action', Object.assign({}, B, { action: 'reimbursement.approve' })],
      ['an unknown request entity', Object.assign({}, B, { entity: 'paymentRequest' })],
      ['a request id in the employee format', Object.assign({}, B, { entityId: 'req_1' })],
      ['an upper-case request id', Object.assign({}, B, { entityId: RQ.toUpperCase() })],
      ['a 31-hex request id', Object.assign({}, B, { entityId: RQ.slice(1) })],
      ['a 33-hex request id', Object.assign({}, B, { entityId: RQ + 'a' })]
    ];
    BAD.forEach(function(b){ check(dec([b[1]]) === null && dec([A1, b[1]]) === null && dec(QE.concat([Object.assign({}, b[1], { id: '99', occurredAt: at('29') })])) === null,
      'Q. D4: refused alone and beside valid events: ' + b[0]); });
    check(rt.AuditDecoders.recordResponse(page({ auditEvents: [Object.assign({}, B, { entityId: 'req_1' })] }), 'financeRequest', 'req_1') === null,
      'Q. D4: a record answer for a malformed request id is refused');
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
