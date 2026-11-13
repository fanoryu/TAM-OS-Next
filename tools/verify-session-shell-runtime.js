#!/usr/bin/env node
'use strict';
/* ============================================================
   U1 — SESSION GRADUATED SHELL RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of the U1 SESSION shell (D-GS-1, GR-4). This
   harness proves its BEHAVIOUR by executing every production module (module-order.js, the
   boot included) in the dependency-free Node `vm` loader of the AFI harnesses, SESSION mode,
   against a deterministic fetch stub. Every identity and record here is fabricated.

     R-1  role x navigation: the CEO sees exactly Employees | Overtime | Payroll | Audit, an
          Employee exactly My profile | My overtime | My payroll — the exact chrome of
          tools/session-shell-chrome.js — and sessionNavModel() fails closed on anything else
     R-2  every LOCAL view id (NAV_GROUPS) set on State.view and rendered: still the SESSION
          shell, the same section, no LOCAL renderer, no API call
     R-3  sign-out, a business 401 and UNAVAILABLE: no shell, no workspace, stores cleared
     R-6  the role label beside Sign out is the /me role; R-7 "My profile" only for an Employee
     R-11 mutation self-test: each seeded defect (shell outside AUTHENTICATED, Employee Audit
          leak, the old allowsWorkspace() render gate, an unknown role's model, a workspace in
          UNAVAILABLE, a focusable closed drawer, the Employee "Finance" label, no resize focus
          correction, no #main fallback, an unverified focus(), inert despite a failed rescue, no recovery)
          must make this suite fail
     A11y the mobile drawer: closed = inert + aria-hidden; open, Escape, backdrop, item tap, repaint;
          r3: a live desktop <-> mobile resize (matchMedia change) never leaves focus in the inert sidebar;
          r4: fail-safe rescue under fault injection (menu button missing / focus() ineffective / all fail)
     WR   UI-DEV-03 (R4-4, Owner D4-u): mobile -> desktop with the (now hidden) menu button focused
          moves focus to the current nav item, else #main, in all three simulated orders (A: still
          focused when 'change' runs; B: blur to body first; S: silent drop, no event), and never
          moves focus that is elsewhere, after a pointer press, in an unfocused window, with the
          drawer open, or after the session ended. M13-M16 (and M13b/M13c) seed defects in it.
          The orders are SIMULATED here; which one a browser produces is not asserted.

   The mobile drawer, focus trap and layout need a real browser (fake DOM has no layout); they
   are covered by the U1 browser validation, not here.
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
const SELF = { id: 'emp_srv_1', employeeCode: 'EMP-777', fullName: 'Fabricated Self', jobTitle: null, department: null, employmentStatus: 'Active',
  joinDate: null, contactEmail: null, phone: null, monthlyBaseSalary: '1000000.00' };
const E1 = { id: 'e_1', employeeCode: 'EMP-001', fullName: 'Fabricated Alpha', jobTitle: 'Engineer', department: null, employmentStatus: 'Active', archived: false, accountState: 'active', accountManageable: true };
// LOCAL renderers SESSION must never reach. Each is a `function` declaration, replaced by a spy.
const NEVER = ['loadState', 'saveState', 'applyTheme', 'installGlobalUIHandlers', 'maybeShowFirstRunChoice', 'startFresh',
  'renderShell', 'renderView', 'renderViewContent', 'syncShellState', 'restoreCompleteBackup', 'renderSmartImport', 'openGlobalSearch',
  'renderActivityLog', 'renderEmployees', 'renderEmployeeDetail', 'renderOvertime', 'renderPayrollWorkspace', 'renderDashboard',
  'renderExecutiveDashboard', 'renderTransactions', 'renderExecutionCenter', 'renderSettings', 'renderAbout', 'renderReleaseNotes'];

function resp(status, body){
  return { status: status,
    headers: { get: (n) => String(n).toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null },
    text: async () => JSON.stringify(body) };
}
const ok = (data) => resp(200, { ok: true, data: data, requestId: RID });
const err = (status, code) => resp(status, { ok: false, error: { code: code, message: 'server text' }, requestId: RID });

/* ---------- a recording #app (as in the AFI harnesses) ---------- */
function mkApp(mkEl, dom){
  let html = ''; let elements = {};
  const tagOf = (id) => new RegExp('<([a-z]+)[^>]*\\sid="' + id + '"[^>]*>').exec(html);
  // #sidebar contains the live elements whose id sits in its markup (it ends before <main>).
  const inSidebar = (o) => { const a = html.indexOf(' id="sidebar"'), b = html.indexOf('<main', a);
    return a >= 0 && !!o && !!o.id && o === elements[o.id] && html.slice(a, b < 0 ? html.length : b).indexOf(' id="' + o.id + '"') >= 0; };
  function find(sel){
    // UI-DEV-03: the current nav item (the one marked aria-current="page" inside #sidebar).
    if(sel === '#sidebar [aria-current="page"]'){
      const a = html.indexOf(' id="sidebar"'), b = html.indexOf('<main', a);
      const c = a < 0 ? null : /<[a-z]+[^>]*\sid="([A-Za-z0-9_-]+)"[^>]*\saria-current="page"/.exec(html.slice(a, b < 0 ? html.length : b));
      return c ? find('#' + c[1]) : null;
    }
    const m = /^#([A-Za-z0-9_-]+)$/.exec(sel);
    if(!m) return null;
    const tag = tagOf(m[1]);
    if(!tag) return null;
    const id = m[1];
    if(!elements[id]){
      const listeners = {};
      const attrs = {};
      elements[id] = { id: id, value: '', listeners: listeners, disabled: /\sdisabled(\s|>|=)/.test(tag[0]), attrs: attrs,
        setAttribute: (n, v) => { dom.log.push('set:' + id + ':' + n); attrs[n] = String(v); }, removeAttribute: (n) => { dom.log.push('unset:' + id + ':' + n); delete attrs[n]; }, querySelectorAll: () => [],
        contains: (o) => o === elements[id] || (id === 'sidebar' && inSidebar(o)),
        addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
        focus: () => { if(dom.noFocus.has(id)){ dom.log.push('focus-refused:' + id); return; }
          // UI-DEV-03: an element inside an inert #sidebar cannot take focus (as in a browser).
          if(id !== 'sidebar' && elements.sidebar && 'inert' in elements.sidebar.attrs && inSidebar(elements[id])){ dom.log.push('focus-refused-inert:' + id); return; }
          dom.focused.push(id); dom.log.push('focus:' + id);
          // UI-DEV-03: focusout on the element losing focus (relatedTarget = the new one), then a
          // document focusin (capture listeners). Element listeners only; no bubbling is modelled.
          const prev = dom.doc.activeElement, next = elements[id];
          if(prev && prev !== next && prev.listeners) (prev.listeners.focusout || []).forEach((fn) => fn.call(prev, { relatedTarget: next }));
          dom.doc.activeElement = next;
          (dom.docListeners.focusin || []).forEach((fn) => fn({ target: next })); },
        // UI-DEV-03: the menu button is display:none at desktop width (shell.css), so it has no boxes.
        getClientRects: () => (id === 'navHamburger' && !dom.media.matches ? [] : [{}]),
        setSelectionRange: () => {}, querySelector: find, getAttribute: () => null };
      const self = elements[id];
      Object.defineProperty(self, 'isConnected', { get: () => elements[id] === self });
    }
    return elements[id];
  }
  const app = mkEl();
  app.querySelector = find; app.querySelectorAll = () => []; app.contains = () => true;
  Object.defineProperty(app, 'innerHTML', { get: () => html, set: (v) => {
    // A repaint detaches every element; focus on one of them falls back to body, as in a browser.
    const a = dom.doc && dom.doc.activeElement; if(a && a.id && elements[a.id] === a) dom.doc.activeElement = dom.doc.body;
    html = String(v); elements = {}; } });
  app.fire = (id, type, ev) => {
    const el = find('#' + id);
    if(!el) return 'absent';
    if(el.disabled) return 'disabled';
    (el.listeners[type] || []).forEach((fn) => fn.call(el, Object.assign({ preventDefault: () => {} }, ev || {})));
    return 'fired';
  };
  return app;
}

/* ---------- runtime loader; `mutate(file, src)` seeds a defect (R-11) ---------- */
// `drawerMode` is the initial (max-width:768px) match; rt.resize(mobile) changes it and fires the
// 'change' listeners, as a real window resize across the breakpoint does.
function loadRuntime(routes, mutate, drawerMode){
  const jsFiles = require(path.join(root, 'tools', 'module-order.js'));
  const parts = jsFiles.map((f) => {
    let src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
    if(f === 'core/constants.js'){
      const assigns = src.match(/const AUTH_MODE = [^;\n]+;/g) || [];
      if(assigns.length !== 1) throw new Error('expected exactly one AUTH_MODE assignment');
      src = src.replace(assigns[0], 'const AUTH_MODE = AUTH_MODES.SESSION;');
    }
    if(mutate) src = mutate(f, src);
    if(f === 'core/app-bootstrap.js'){
      src = NEVER.map((n) => 'try { ' + n + ' = (function(){ return function(){ __spy.push("' + n + '"); return ""; }; })(); } catch(_e){ __spyErr.push("' + n + '"); }').join('\n') + '\n' + src;
    }
    return src;
  });
  const src = parts.join('\n')
    + '\n;window.__TAM__ = { State: State, AuthBoot: AuthBoot, AUTH_STATES: AUTH_STATES, NAV_GROUPS: NAV_GROUPS, render: render,'
    + ' sessionNavModel: sessionNavModel, SESSION_ROUTES: SESSION_ROUTES, SessionEmployeeStore: SessionEmployeeStore,'
    + ' SessionOvertimeStore: SessionOvertimeStore, SessionPayrollStore: SessionPayrollStore, SessionAuditStore: SessionAuditStore,'
    + ' SessionShellDrawer: SessionShellDrawer };';
  const noop = function(){};
  const access = { local: [], session: [] };
  const storageOf = (log) => ({ getItem: (k) => { log.push('get:' + k); return null; }, setItem: (k) => { log.push('set:' + k); },
    removeItem: (k) => { log.push('remove:' + k); }, key: () => null, get length(){ return 0; }, clear: () => { log.push('clear'); } });
  const mkEl = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'', value:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, removeChild:noop, setAttribute:noop, removeAttribute:noop,
    getAttribute:()=>null, remove:noop, focus:noop, contains:()=>false, querySelector:()=>null, querySelectorAll:()=>[],
    classList:{ add:noop, remove:noop, toggle:noop, contains:()=>false } });
  const els = {}; const dom = { focused: [], log: [], noFocus: new Set(), docListeners: {}, hasFocus: true }; // noFocus: ids whose focus() is ineffective (fault injection)
  const media = { matches: !!drawerMode, listeners: [] };
  dom.media = media;
  const mql = () => ({ get matches(){ return media.matches; }, addEventListener: (t, fn) => { if(t === 'change') media.listeners.push(fn); }, addListener: (fn) => { media.listeners.push(fn); } });
  els.app = mkApp(mkEl, dom);
  const net = { calls: [], routes: routes || {} };
  const fetchStub = function(url, init){
    net.calls.push({ url: url, init: init });
    return new Promise(function(resolve, reject){
      const q = net.routes[url] || [];
      const next = q.length > 1 ? q.shift() : q[0];
      Promise.resolve().then(function(){ if(!next) return reject(new TypeError('no route')); resolve(typeof next === 'function' ? next(init) : next); });
    });
  };
  const sandbox = {
    __spy: [], __spyErr: [],
    console: { log:noop, warn:noop, error:noop, info:noop }, navigator: { userAgent:'tam-u1' },
    setTimeout: (fn, ms) => (ms === 10000 ? 'api-timer' : setTimeout(fn, ms)), clearTimeout: (id) => { if(id !== 'api-timer') clearTimeout(id); },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    AbortController: AbortController, fetch: fetchStub,
    localStorage: storageOf(access.local), sessionStorage: storageOf(access.session),
    addEventListener: noop, removeEventListener: noop, confirm: () => true,
    location: { hash: '', search: '', pathname: '/', href: 'http://127.0.0.1/' },
    history: { replaceState: noop, pushState: noop },
    matchMedia: mql,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: { addEventListener: (t, fn) => { (dom.docListeners[t] = dom.docListeners[t] || []).push(fn); }, removeEventListener:noop,
      hasFocus: () => dom.hasFocus, getElementById: (id) => (els[id] = els[id] || mkEl()),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>mkEl(), contains:()=>false,
      body: mkEl(), documentElement: { dataset:{}, style:{} }, activeElement: null }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  dom.doc = sandbox.document;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-u1-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.net = net; rt.access = access; rt.spy = sandbox.__spy; rt.spyErr = sandbox.__spyErr;
  rt.app = els.app; rt.appHTML = () => els.app.innerHTML; rt.dom = dom;
  rt.state = () => rt.AuthBoot.snapshot().state;
  rt.resize = (mobile) => { if(media.matches === !!mobile) return; media.matches = !!mobile; media.listeners.slice().forEach((fn) => fn({ matches: media.matches })); };
  // UI-DEV-03 — a simulated mobile -> desktop change, in one of three orders (none is asserted to be
  // what a browser does): 'A' the hidden menu button keeps focus when 'change' runs; 'B' focus drops
  // to body with a focusout (relatedTarget null) first; 'S' it drops silently (no event). noChange:
  // the 'change' listeners do not run (only the deferred focusout re-check can act).
  rt.toDesktop = (mode, noChange) => {
    if(!media.matches) return;
    media.matches = false;
    const a = dom.doc.activeElement;
    if((mode === 'B' || mode === 'S') && a && a.id === 'navHamburger'){
      dom.doc.activeElement = dom.doc.body; dom.log.push('drop:navHamburger');
      if(mode === 'B') ((a.listeners || {}).focusout || []).forEach((fn) => fn.call(a, { relatedTarget: null }));
    }
    if(!noChange) media.listeners.slice().forEach((fn) => fn({ matches: false }));
  };
  rt.change = () => media.listeners.slice().forEach((fn) => fn({ matches: media.matches }));
  rt.pointer = () => (dom.docListeners.pointerdown || []).forEach((fn) => fn({}));
  return rt;
}
const flush = async (n) => { for(let i = 0; i < (n || 8); i++) await new Promise((r) => setImmediate(r)); };
const BASE = { ceo: { '/api/employees': [ok({ employees: [E1] })] }, employee: { '/api/employee?id=emp_srv_1': [ok({ employee: SELF })] } };
async function boot(me, mutate, extra, drawerMode){
  const rt = loadRuntime(Object.assign({ '/api/auth/me': [ok(me)] }, BASE[me.role], extra || {}), mutate, drawerMode);
  await flush();
  return rt;
}
// Phase 1 authorized revision: the CEO's Finance group ends with Finance (the Ledger). Was: Overtime | Payroll.
const EXPECT = {
  // UI-INT-1 (Owner D-UI-1): v2.11.0 wording and order; Overtime sits under "More". Was: overtime | payroll | finance:Finance / audit:Audit.
  ceo: [['people', ['main:Employees']], ['finance', ['finance:Overview', 'overtime:Overtime', 'payroll:Payroll', 'transactions:Transactions']], ['system', ['audit:Activity Log']]],
  employee: [['people', ['main:My profile']], ['finance', ['overtime:My overtime', 'payroll:My payroll']]]
};
const modelShape = (m) => m ? m.groups.map((g) => [g.id, g.items.map((i) => i.id + ':' + i.label)]) : null;
const storesEmpty = (rt) => rt.SessionEmployeeStore.snapshot().list === null && rt.SessionOvertimeStore.snapshot().open === false
  && rt.SessionPayrollStore.snapshot().open === false && rt.SessionAuditStore.snapshot().open === false;
const noShellAfter = (rt) => !parseSessionShell(rt.appHTML()) && !/id="sidebar"|class="sidebar"|swSection|data-nav=/.test(rt.appHTML()) && rt.AuthBoot.allowsWorkspace() === false;

/* ---------- the suite: a list of [ok, label]; R-11 runs it against seeded defects ---------- */
async function suite(mutate){
  const out = [];
  const t = (cond, label) => out.push([!!cond, label]);

  // R-1 / R-6 / R-7 — per role.
  for(const me of [ME_CEO, ME_EMP]){
    const role = me.role;
    const rt = await boot(me, mutate);
    const shell = parseSessionShell(rt.appHTML());
    t(rt.state() === 'AUTHENTICATED' && rt.AuthBoot.allowsWorkspace() === true && !!shell && shell.role === role && shell.active === 'main' && shell.disabled === false,
      'R-1 ' + role + ': AUTHENTICATED renders the exact ' + role + ' SESSION shell, home item active, items enabled');
    t(JSON.stringify(modelShape(rt.sessionNavModel(rt.AuthBoot.snapshot().principal))) === JSON.stringify(EXPECT[role]),
      'R-1 ' + role + ': sessionNavModel(principal) is exactly ' + EXPECT[role].map((g) => g[1].join(' | ')).join(' / '));
    // U1 correction 2: the Employee's Finance group reads "My work"; the CEO's stays "Finance".
    const labels = rt.sessionNavModel(rt.AuthBoot.snapshot().principal).groups.map((g) => g.label).join();
    t(labels === (role === 'ceo' ? 'People,Finance,System' : 'People,My work') && (role === 'ceo' || !/>Finance</.test(rt.appHTML())),
      'R-1 ' + role + ': group labels are ' + (role === 'ceo' ? 'People, Finance, System' : 'People, My work (no "Finance" heading for an Employee)'));
    t(new RegExp('Signed in as <strong>' + (role === 'ceo' ? 'CEO' : 'Employee') + '</strong>').test(shell ? shell.content : '') && /id="authSignOutBtn"/.test(shell ? shell.content : ''),
      'R-6 ' + role + ': the card names the /me role beside Sign out');
    t(role === 'employee' ? /<h1[^>]*>My profile<\/h1>/.test(rt.appHTML()) : (!/My profile/.test(rt.appHTML()) && /<h1[^>]*>Employees<\/h1>/.test(rt.appHTML())),
      'R-7 ' + role + ': "My profile" appears only for an Employee (U-1A guard)');
    t(rt.spy.length === 0 && rt.access.local.length === 0 && rt.access.session.length === 0,
      'R-1 ' + role + ': no LOCAL renderer and no browser storage' + (rt.spy.length ? ' >> ' + rt.spy.join(', ') : ''));

    // R-2 — every LOCAL view id is unreachable through State.view.
    const calls = rt.net.calls.length;
    const ids = rt.NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id)).concat(['smartImport', 'importResults', 'employeeDetail', 'payrollDetail', 'nonexistent']);
    const leaks = [];
    ids.forEach((id) => {
      rt.State.view = id; rt.render();
      const s = parseSessionShell(rt.appHTML());
      if(!s || s.role !== role || s.active !== 'main' || rt.spy.length) leaks.push(id);
    });
    t(leaks.length === 0 && rt.net.calls.length === calls, 'R-2 ' + role + ': all ' + ids.length + ' LOCAL view ids set on State.view render the same SESSION section, no LOCAL renderer, no API call' + (leaks.length ? ' >> ' + leaks.join(', ') : ''));

    // A section item shows its section in the shell (Overtime is a pure open: it reads on open).
    rt.net.routes['/api/employees?archived=1'] = [ok({ employees: [E1] })];
    rt.app.fire('swSectionAudit', 'click'); await flush();
    t(role === 'ceo' ? (parseSessionShell(rt.appHTML()) || {}).active === 'audit' : rt.app.fire('swSectionAudit', 'click') === 'absent' && rt.SessionAuditStore.snapshot().open === false,
      'R-1 ' + role + ': ' + (role === 'ceo' ? 'the Audit item opens Audit, marked current' : 'there is no Audit item and Audit never opens'));
    rt.app.fire('swSectionMain', 'click'); await flush();

    // R-3 — sign-out.
    rt.net.routes['/api/auth/logout'] = [ok({ signedOut: true })];
    await rt.AuthBoot.signOut(); await flush();
    t(rt.state() === 'SIGNED_OUT' && noShellAfter(rt) && /id="authSignInForm"/.test(rt.appHTML()) && storesEmpty(rt),
      'R-3 ' + role + ': sign-out removes the shell and every section; the sign-in form; stores cleared');
  }

  // R-3 — a business 401 and UNAVAILABLE.
  {
    const rt = await boot(ME_CEO, mutate);
    rt.AuthBoot.sessionLost(); await flush();
    t(rt.state() === 'SIGNED_OUT' && noShellAfter(rt) && storesEmpty(rt), 'R-3 a business 401 (sessionLost) ends the shell; stores cleared');
  }
  {
    const rt = await boot(ME_EMP, mutate);
    rt.AuthBoot.sessionUncertain(); await flush();
    t(rt.state() === 'UNAVAILABLE' && noShellAfter(rt) && /id="authRetryBtn"/.test(rt.appHTML()) && storesEmpty(rt),
      'R-3 UNAVAILABLE (sessionUncertain) shows Retry only: no shell, no workspace, stores cleared');
  }
  {
    const rt = loadRuntime({ '/api/auth/me': [err(401, 'unauthenticated')] }, mutate); await flush();
    t(rt.state() === 'SIGNED_OUT' && noShellAfter(rt) && /id="authSignInForm"/.test(rt.appHTML()), 'R-3 signed out at boot (/me 401): the sign-in form, no shell');
    rt.State.view = 'execDashboard'; rt.render();
    t(noShellAfter(rt) && rt.spy.length === 0, 'R-2 signed out: a LOCAL view id on State.view still renders only the sign-in form');
  }
  {
    const rt = loadRuntime({ '/api/auth/me': [err(503, 'unavailable')] }, mutate); await flush();
    t(rt.state() === 'UNAVAILABLE' && noShellAfter(rt), 'R-3 /me 503 at boot: UNAVAILABLE, no shell');
  }

  // U1 correction 1 — the mobile drawer (matchMedia max-width:768px matches): closed means inert.
  {
    const rt = await boot(ME_CEO, mutate, null, true);
    const el = (id) => rt.app.querySelector('#' + id) || { attrs: {} };
    const closed = () => el('sidebar').attrs.inert === '' && el('sidebar').attrs['aria-hidden'] === 'true' && el('navHamburger').attrs['aria-expanded'] === 'false';
    t(closed(), 'A11y drawer: at mobile width the closed drawer is inert and aria-hidden after render (Tab cannot reach it)');
    rt.app.fire('navHamburger', 'click');
    t(!('inert' in el('sidebar').attrs) && !('aria-hidden' in el('sidebar').attrs) && el('navHamburger').attrs['aria-expanded'] === 'true',
      'A11y drawer: opening removes inert and aria-hidden; the menu button reports expanded');
    rt.app.fire('sidebar', 'keydown', { key: 'Escape' });
    t(closed() && rt.dom.focused[rt.dom.focused.length - 1] === 'navHamburger', 'A11y drawer: Escape closes it (inert again) and returns focus to the menu button');
    rt.app.fire('navHamburger', 'click'); rt.render();
    t(!('inert' in el('sidebar').attrs) && el('navHamburger').attrs['aria-expanded'] === 'true', 'A11y drawer: a repaint while open keeps it open and focusable');
    rt.app.fire('sidebarBackdrop', 'click');
    t(closed(), 'A11y drawer: a backdrop tap closes it (inert again)');
    rt.app.fire('navHamburger', 'click');
    rt.net.routes['/api/audit-events?month=' + new Date().toISOString().slice(0, 7)] = [ok({ events: [] })];
    rt.app.fire('swSectionAudit', 'click'); await flush();
    t(closed() && (parseSessionShell(rt.appHTML()) || {}).active === 'audit', 'A11y drawer: an item tap navigates and closes the drawer (inert again)');
  }
  {
    const rt = await boot(ME_EMP, mutate);
    const sb = rt.app.querySelector('#sidebar') || { attrs: { inert: 'absent' } };
    t(!('inert' in sb.attrs) && !('aria-hidden' in sb.attrs), 'A11y drawer: at desktop width the sidebar is never inert or aria-hidden');
  }

  // U1 r3 — a live desktop -> mobile resize (the matchMedia 'change' listener) never strands focus
  // in the now-inert sidebar.
  {
    const rt = await boot(ME_CEO, mutate);
    const el = (id) => rt.app.querySelector('#' + id) || { attrs: {}, focus: () => {} };
    const inert = () => el('sidebar').attrs.inert === '' && el('sidebar').attrs['aria-hidden'] === 'true';
    el('swSectionOvertime').focus();
    const from = rt.dom.log.length;
    rt.resize(true);
    const log = rt.dom.log.slice(from);
    const f = log.indexOf('focus:navHamburger'), i = log.indexOf('set:sidebar:inert'), h = log.indexOf('set:sidebar:aria-hidden');
    t(inert() && rt.dom.doc.activeElement === el('navHamburger') && f >= 0 && i > f && h > f && el('navHamburger').attrs['aria-expanded'] === 'false',
      'A11y resize 1: a focused desktop sidebar item -> mobile width moves focus to the menu button before the sidebar turns inert and aria-hidden' + (f < 0 ? ' >> focus not moved' : i < f ? ' >> inert first' : ''));
    // 4 — then the drawer itself: open, Escape, focus back on the menu button.
    rt.app.fire('navHamburger', 'click');
    const opened = !('inert' in el('sidebar').attrs) && el('navHamburger').attrs['aria-expanded'] === 'true';
    rt.app.fire('sidebar', 'keydown', { key: 'Escape' });
    t(opened && inert() && rt.dom.doc.activeElement === el('navHamburger') && el('navHamburger').attrs['aria-expanded'] === 'false',
      'A11y resize 4: after the resize, open -> Escape closes the drawer, inert again, focus on the menu button');
  }
  {
    const rt = await boot(ME_CEO, mutate);
    const el = (id) => rt.app.querySelector('#' + id) || { attrs: {}, focus: () => {} };
    const out = el('authSignOutBtn'); out.focus();
    const from = rt.dom.log.length;
    rt.resize(true);
    t(el('sidebar').attrs.inert === '' && rt.dom.doc.activeElement === out && !rt.dom.log.slice(from).some((x) => /^focus:/.test(x)),
      'A11y resize 2: focus outside the sidebar (Sign out) -> mobile width leaves focus where it is; the sidebar turns inert');
    rt.resize(false);
    t(!('inert' in el('sidebar').attrs) && !('aria-hidden' in el('sidebar').attrs) && el('navHamburger').attrs['aria-expanded'] === 'false'
      && rt.dom.doc.activeElement === out && !rt.dom.log.slice(from).some((x) => /^focus:/.test(x)),
      'A11y resize 3: mobile -> desktop width makes the sidebar accessible again (no inert, no aria-hidden); focus unchanged');
  }
  // U1 r4 — the rescue is fail-safe: each focus attempt is checked against document.activeElement,
  // #main is the fallback, and a sidebar still holding focus is never made inert or aria-hidden.
  // Fault injection (harness only): an element removed from the markup, or a focus() that does nothing.
  {
    const rt = await boot(ME_CEO, mutate);
    const el = (id) => rt.app.querySelector('#' + id) || { attrs: {}, focus: () => {} };
    rt.app.innerHTML = rt.appHTML().replace(/<button class="nav-hamburger"[^>]*>[\s\S]*?<\/button>/, '');
    const gone = !rt.app.querySelector('#navHamburger');
    el('swSectionOvertime').focus();
    const from = rt.dom.log.length;
    rt.resize(true);
    const log = rt.dom.log.slice(from);
    t(gone && rt.dom.doc.activeElement === el('main') && el('sidebar').attrs.inert === '' && el('sidebar').attrs['aria-hidden'] === 'true'
      && log.indexOf('focus:main') >= 0 && log.indexOf('focus:main') < log.indexOf('set:sidebar:inert') && rt.SessionShellDrawer.held === false,
      'A11y rescue F1: menu button missing -> the fallback #main takes focus before the sidebar turns inert and aria-hidden');
  }
  {
    const rt = await boot(ME_CEO, mutate);
    const el = (id) => rt.app.querySelector('#' + id) || { attrs: {}, focus: () => {} };
    rt.dom.noFocus.add('navHamburger');
    el('swSectionPayroll').focus();
    const from = rt.dom.log.length;
    rt.resize(true);
    const log = rt.dom.log.slice(from);
    t(rt.dom.doc.activeElement === el('main') && el('sidebar').attrs.inert === '' && log.indexOf('focus-refused:navHamburger') >= 0
      && log.indexOf('focus-refused:navHamburger') < log.indexOf('focus:main') && log.indexOf('focus:main') < log.indexOf('set:sidebar:inert'),
      'A11y rescue F2: menu button focus() ineffective -> the actual activeElement is checked, the fallback #main takes focus, then inert');
  }
  {
    const rt = await boot(ME_CEO, mutate);
    const el = (id) => rt.app.querySelector('#' + id) || { attrs: {}, focus: () => {} };
    rt.dom.noFocus.add('navHamburger'); rt.dom.noFocus.add('main');
    const item = el('swSectionAudit'); item.focus();
    rt.resize(true);
    const sb = el('sidebar');
    t(!('inert' in sb.attrs) && !('aria-hidden' in sb.attrs) && rt.dom.doc.activeElement === item && rt.SessionShellDrawer.held === true
      && el('navHamburger').attrs['aria-expanded'] === 'false',
      'A11y rescue F3: every focus attempt fails -> the focused sidebar is NOT made inert or aria-hidden; state held (recoverable)');
    rt.app.fire('sidebar', 'focusout', { relatedTarget: el('swSectionMain') });
    t(!('inert' in el('sidebar').attrs) && rt.SessionShellDrawer.held === true,
      'A11y rescue F3: focus moving within the sidebar keeps it focusable (still held)');
    rt.dom.noFocus.clear();
    el('authSignOutBtn').focus();
    rt.app.fire('sidebar', 'focusout', { relatedTarget: el('authSignOutBtn') });
    t(el('sidebar').attrs.inert === '' && el('sidebar').attrs['aria-hidden'] === 'true' && rt.SessionShellDrawer.held === false && rt.dom.doc.activeElement === el('authSignOutBtn'),
      'A11y rescue F3: once focus leaves the held sidebar it becomes inert and aria-hidden (recovered); focus untouched');
    rt.dom.noFocus.add('navHamburger'); rt.dom.noFocus.add('main');
    rt.resize(false); el('swSectionMain').focus(); rt.resize(true); // held again: every attempt fails
    const heldAgain = rt.SessionShellDrawer.held === true;
    rt.AuthBoot.sessionLost(); await flush();
    t(heldAgain && rt.state() === 'SIGNED_OUT' && noShellAfter(rt) && rt.SessionShellDrawer.held === false,
      'A11y rescue F4: session lost while held -> no shell, held cleared');
  }
  {
    // 5a — session lost after the resize: the shell is gone, a later resize focuses nothing.
    const rt = await boot(ME_CEO, mutate);
    (rt.app.querySelector('#swSectionPayroll') || { focus: () => {} }).focus();
    rt.resize(true);
    rt.AuthBoot.sessionLost(); await flush();
    const from = rt.dom.log.length;
    rt.resize(false); rt.resize(true);
    const a = rt.dom.doc.activeElement;
    t(rt.state() === 'SIGNED_OUT' && noShellAfter(rt) && !rt.dom.log.slice(from).some((x) => /^focus:/.test(x)) && !(a && /^(navHamburger|sidebar|swSection)/.test(a.id || '')),
      'A11y resize 5a: session lost after a resize removes the sidebar; later resizes focus nothing and no detached shell element holds focus');
  }
  {
    // 5b — session lost while a sidebar item holds focus at desktop width, then the resize.
    const rt = await boot(ME_CEO, mutate);
    (rt.app.querySelector('#swSectionAudit') || { focus: () => {} }).focus();
    rt.AuthBoot.sessionLost(); await flush();
    const from = rt.dom.log.length;
    rt.resize(true);
    const a = rt.dom.doc.activeElement;
    t(rt.state() === 'SIGNED_OUT' && noShellAfter(rt) && !rt.dom.log.slice(from).some((x) => /^(focus|set):/.test(x)) && !(a && /^(navHamburger|sidebar|swSection)/.test(a.id || '')),
      'A11y resize 5b: session lost before the resize: the resize touches nothing and restores no focus to a detached element');
  }

  // UI-DEV-03 (R4-4, Owner D4-u) — mobile -> desktop with the menu button focused. The menu button is
  // hidden at desktop width; focus must end on the current nav item (else #main), never on a hidden
  // or detached element, and focus anywhere else must never move. Orders A / B / S are simulated.
  const frame = () => new Promise((r) => setTimeout(r, 5)); // one requestAnimationFrame (setTimeout 0 here)
  const atMobile = async (me) => {
    const rt = await boot(me, mutate, null, true);
    const el = (id) => rt.app.querySelector('#' + id) || { attrs: {}, focus: () => {} };
    return { rt: rt, el: el };
  };
  const focusLog = (rt, from) => rt.dom.log.slice(from).filter((x) => /^focus/.test(x));
  for(const me of [ME_CEO, ME_EMP]){
    const role = me.role;
    for(const [mode, noChange, label] of [['A', false, 'R1 (A: still focused when change runs)'], ['B', false, 'R2 (B: blur to body before change)'],
      ['S', false, 'R3 (S: silent drop, no event)']]){
      const { rt, el } = await atMobile(me);
      el('navHamburger').focus();
      const set = rt.SessionShellDrawer.hamLast === true;
      const from = rt.dom.log.length;
      rt.toDesktop(mode, noChange); await frame();
      const item = el('swSectionMain');
      t(set && rt.dom.doc.activeElement === item && rt.app.querySelector('#sidebar [aria-current="page"]') === item
        && JSON.stringify(focusLog(rt, from)) === '["focus:swSectionMain"]' && rt.SessionShellDrawer.hamLast === false && !('inert' in el('sidebar').attrs),
        'WR ' + label + ' ' + role + ': the hidden menu button\'s focus moves once to the current nav item; the sidebar is not inert' + ' >> ' + focusLog(rt, from).join(','));
    }
  }
  for(const me of [ME_CEO, ME_EMP]){
    // R2b — B with the deferred focusout re-check running before 'change' (the closed drawer is still
    // inert, so the nav item refuses focus): #main takes it; the later 'change' moves nothing.
    const { rt, el } = await atMobile(me);
    el('navHamburger').focus();
    const from = rt.dom.log.length;
    rt.toDesktop('B', true); await frame();
    const early = rt.dom.doc.activeElement === el('main');
    rt.change(); await frame();
    t(early && rt.dom.doc.activeElement === el('main') && JSON.stringify(focusLog(rt, from)) === '["focus-refused-inert:swSectionMain","focus:main"]' && !('inert' in el('sidebar').attrs),
      'WR R2b ' + me.role + ' (B, the focusout re-check before change): #main takes focus (the nav item is still inert); the later change moves nothing >> ' + focusLog(rt, from).join(','));
  }
  {
    // R4 — the current item refuses focus: #main (tabindex -1) takes it.
    const { rt, el } = await atMobile(ME_CEO);
    el('navHamburger').focus(); rt.dom.noFocus.add('swSectionMain');
    const from = rt.dom.log.length;
    rt.toDesktop('S'); await frame();
    t(rt.dom.doc.activeElement === el('main') && JSON.stringify(focusLog(rt, from)) === '["focus-refused:swSectionMain","focus:main"]',
      'WR R4: the current nav item refuses focus -> the actual activeElement is checked and #main takes focus >> ' + focusLog(rt, from).join(','));
  }
  {
    // R5 — both refuse: focus untouched, two attempts only, no throw, no loop.
    const { rt, el } = await atMobile(ME_CEO);
    const ham = el('navHamburger'); ham.focus(); rt.dom.noFocus.add('swSectionMain'); rt.dom.noFocus.add('main');
    const from = rt.dom.log.length;
    let threw = null; try { rt.toDesktop('A'); await frame(); } catch(e){ threw = e; }
    t(!threw && rt.dom.doc.activeElement === ham && JSON.stringify(focusLog(rt, from)) === '["focus-refused:swSectionMain","focus-refused:main"]',
      'WR R5: both targets refuse -> focus left as it is, exactly two attempts, no throw, no loop >> ' + focusLog(rt, from).join(','));
  }
  for(const me of [ME_CEO, ME_EMP]){
    // R6 — focus elsewhere (Sign out, #main) never moves, in every order; nor body reached from elsewhere.
    for(const mode of ['A', 'B', 'S']){
      const { rt, el } = await atMobile(me);
      const out = el('authSignOutBtn'); out.focus();
      const from = rt.dom.log.length;
      rt.toDesktop(mode); await frame();
      const { rt: rt2, el: el2 } = await atMobile(me);
      const main = el2('main'); main.focus();
      const from2 = rt2.dom.log.length;
      rt2.toDesktop(mode); await frame();
      t(rt.dom.doc.activeElement === out && focusLog(rt, from).length === 0 && rt2.dom.doc.activeElement === main && focusLog(rt2, from2).length === 0,
        'WR R6 ' + me.role + ' ' + mode + ': focus on Sign out or #main is never moved by the desktop change');
    }
    const { rt, el } = await atMobile(me);
    el('navHamburger').focus(); el('authSignOutBtn').focus();       // Tab away: focusin elsewhere clears hamLast
    rt.dom.doc.activeElement = rt.dom.doc.body;                       // later lost for another reason
    const from = rt.dom.log.length;
    rt.toDesktop('S'); await frame();
    t(rt.SessionShellDrawer.hamLast === false && rt.dom.doc.activeElement === rt.dom.doc.body && focusLog(rt, from).length === 0,
      'WR R6 ' + me.role + ': body reached after focus left the menu button for another element -> untouched');
  }
  {
    // R7 — a pointer press after the menu button clears hamLast: a later body focus is the user's.
    const { rt, el } = await atMobile(ME_CEO);
    const ham = el('navHamburger'); ham.focus();
    rt.pointer(); rt.dom.doc.activeElement = rt.dom.doc.body;
    ((ham.listeners || {}).focusout || []).forEach((fn) => fn.call(ham, { relatedTarget: null })); await frame(); // click on the page: blur at mobile width
    const from = rt.dom.log.length;
    rt.toDesktop('S'); await frame();
    t(rt.SessionShellDrawer.hamLast === false && rt.dom.doc.activeElement === rt.dom.doc.body && focusLog(rt, from).length === 0,
      'WR R7: menu button focused, then a pointer press on the page -> the desktop change moves nothing');
  }
  {
    // R8 — an unfocused window (document.hasFocus() false) is never acted on.
    for(const mode of ['A', 'S']){
      const { rt, el } = await atMobile(ME_EMP);
      const ham = el('navHamburger'); ham.focus(); rt.dom.hasFocus = false;
      const from = rt.dom.log.length;
      rt.toDesktop(mode); await frame();
      t(focusLog(rt, from).length === 0 && rt.dom.doc.activeElement === (mode === 'A' ? ham : rt.dom.doc.body),
        'WR R8 ' + mode + ': document.hasFocus() false -> no focus moved');
    }
  }
  {
    // R9 — drawer open, focus on an item in it: the existing close path only, focus unchanged.
    const { rt, el } = await atMobile(ME_CEO);
    el('navHamburger').focus(); rt.app.fire('navHamburger', 'click');
    const item = el('swSectionOvertime'); item.focus();
    const from = rt.dom.log.length;
    rt.toDesktop('A'); await frame();
    t(rt.SessionShellDrawer.open === false && !('inert' in el('sidebar').attrs) && rt.dom.doc.activeElement === item && focusLog(rt, from).length === 0,
      'WR R9: drawer open with focus on an item -> the drawer closes as before; focus stays on the item');
  }
  {
    // R10 — session ended before the change: no shell, nothing focused, hamLast cleared.
    for(const mode of ['B', 'S']){
      const { rt, el } = await atMobile(ME_CEO);
      const ham = el('navHamburger'); ham.focus();
      rt.AuthBoot.sessionLost(); await flush();
      const cleared = rt.SessionShellDrawer.hamLast === false;
      const from = rt.dom.log.length;
      rt.toDesktop(mode); await frame();
      const a = rt.dom.doc.activeElement;
      t(cleared && noShellAfter(rt) && focusLog(rt, from).length === 0 && !(a && /^(navHamburger|sidebar|swSection)/.test(a.id || '')),
        'WR R10 ' + mode + ': session lost before the change -> hamLast cleared, nothing focused, no detached element holds focus');
    }
  }
  {
    // R11 — desktop -> mobile unchanged: a focused sidebar item moves to the menu button, nothing else.
    const rt = await boot(ME_EMP, mutate);
    const el = (id) => rt.app.querySelector('#' + id) || { attrs: {}, focus: () => {} };
    el('swSectionOvertime').focus();
    const from = rt.dom.log.length;
    rt.resize(true); await frame();
    t(JSON.stringify(focusLog(rt, from)) === '["focus:navHamburger"]' && rt.dom.doc.activeElement === el('navHamburger') && el('sidebar').attrs.inert === '',
      'WR R11: desktop -> mobile behaves as before (focus to the menu button only, sidebar inert) >> ' + focusLog(rt, from).join(','));
  }
  {
    // R12 — both triggers fire (focusout re-check and the change handler): exactly one focus move.
    const { rt, el } = await atMobile(ME_CEO);
    el('navHamburger').focus();
    const from = rt.dom.log.length;
    rt.toDesktop('B'); await frame(); await frame();
    rt.change(); await frame();                                       // a duplicate 'change' with focus now visible
    const items = focusLog(rt, from);
    t(JSON.stringify(items) === '["focus:swSectionMain"]' && rt.dom.doc.activeElement === el('swSectionMain'),
      'WR R12: both triggers and a duplicate change -> exactly one focus move >> ' + items.join(','));
  }

  // Fail closed — the pure model.
  {
    const rt = loadRuntime({ '/api/auth/me': [err(401, 'unauthenticated')] }, mutate); await flush();
    const m = rt.sessionNavModel;
    t(m(null) === null && m(undefined) === null && m('ceo') === null && m({}) === null && m({ principalType: 'admin' }) === null && m({ principalType: 'CEO' }) === null
      && m({ principalType: 'owner', role: 'ceo' }) === null,
      'fail closed: sessionNavModel is null for no principal, a string, an unknown or mis-cased role');
    const a = m({ principalType: 'ceo' }), b = m({ principalType: 'ceo' });
    t(a !== b && Object.isFrozen(a) && Object.isFrozen(a.groups) && a.groups.every((g) => Object.isFrozen(g) && Object.isFrozen(g.items) && g.items.every(Object.isFrozen)) && a.home === 'main',
      'the model is a new deeply frozen value each call, home "main"');
    t(Object.isFrozen(rt.SESSION_ROUTES) && rt.SESSION_ROUTES.length === 6 && rt.SESSION_ROUTES.every((r) => Object.isFrozen(r) && Object.isFrozen(r.labels)),
      'SESSION_ROUTES is frozen: exactly the six SESSION routes (UI-INT-1 split Finance into Overview and Transactions; was five)');
  }
  return out;
}

/* ---------- R-11 seeded defects ---------- */
const swap = (file, a, b) => (f, src) => {
  if(f !== file) return src;
  if(src.split(a).length !== 2) throw new Error('mutation anchor not found once in ' + file + ': ' + a.slice(0, 60));
  return src.replace(a, () => b);
};
const MUTATIONS = [
  ['M1 allowsWorkspace() true in every state', swap('core/auth-boot.js', 'return state === AUTH_STATES.AUTHENTICATED && typeof sessionNavModel', 'return true || typeof sessionNavModel')],
  ['M2 an Employee is given the Audit item', swap('ui/session-workspace-view.js', "labels: Object.freeze({ ceo: 'Activity Log' })", "labels: Object.freeze({ ceo: 'Activity Log', employee: 'Audit' })")],
  ['M3 render() gated on allowsWorkspace() again (LOCAL shell when AUTHENTICATED)', swap('ui/shell-render.js', '  if(AUTH_MODE !== AUTH_MODES.LOCAL){', "  if(AUTH_MODE !== AUTH_MODES.LOCAL && !(typeof AuthBoot !== 'undefined' && AuthBoot.allowsWorkspace())){")],
  ['M4 sessionNavModel accepts any role', (f, src) => swap('ui/session-workspace-view.js', '  if(role !== PRINCIPAL_TYPES.CEO && role !== PRINCIPAL_TYPES.EMPLOYEE) return null;\n', '')(f,
    swap('ui/session-workspace-view.js', "  if(!groups.some(function(g){ return g.items.some(function(i){ return i.id === SESSION_HOME_ROUTE; }); })) return null;\n", '')(f, src))],
  ['M6 the closed drawer is not inert', swap('ui/session-workspace-view.js', " sidebar.setAttribute('inert', '');", '')],
  ['M8 the resize focus correction is removed (focus stays in the inert sidebar)', swap('ui/session-workspace-view.js', 'const hide = drawer && !open && sessionShellRescueFocus(app, sidebar);', 'const hide = drawer && !open;')],
  ['M9 the #main fallback is disabled', swap('ui/session-workspace-view.js', "const targets = [app.querySelector('#navHamburger'), app.querySelector('#main')];", "const targets = [app.querySelector('#navHamburger')];")],
  ['M10 focus() is assumed to succeed (activeElement not verified)', swap('ui/session-workspace-view.js', 'if(document.activeElement === t && !inside()) return true;', 'return true;')],
  ['M11 a failed rescue still makes the focused sidebar inert', swap('ui/session-workspace-view.js', 'const hide = drawer && !open && sessionShellRescueFocus(app, sidebar);', 'const hide = drawer && !open && (sessionShellRescueFocus(app, sidebar) || true);')],
  ['M12 a held sidebar never recovers on focusout', swap('ui/session-workspace-view.js', 'if(!SessionShellDrawer.held) return;', 'return;')],
  ['M13 the desktop focus recovery is removed', swap('ui/session-workspace-view.js', 'function sessionShellDesktopFocus(root){', 'function sessionShellDesktopFocus(root){ return false;')],
  ['M13b the change-handler trigger is removed', swap('ui/session-workspace-view.js', 'if(!sidebarIsDrawerMode()) sessionShellDesktopFocus(root);', '')],
  ['M13c the deferred focusout trigger is removed', swap('ui/session-workspace-view.js', "requestAnimationFrame(function(){ sessionShellDesktopFocus(document.getElementById('app')); });", '')],
  ['M14 the recovery assumes focus() succeeded', swap('ui/session-workspace-view.js', 'if(document.activeElement === t){ SessionShellDrawer.hamLast = false; return true; }', 'SessionShellDrawer.hamLast = false; return true;')],
  ['M15 the recovery runs at mobile width or for focus elsewhere', (f, src) => swap('ui/session-workspace-view.js', "if(!root || typeof root.querySelector !== 'function' || sidebarIsDrawerMode()) return false;", "if(!root || typeof root.querySelector !== 'function') return false;")(f,
    swap('ui/session-workspace-view.js', 'if(!(a === ham || ((!a || a === document.body) && SessionShellDrawer.hamLast))) return false;', '')(f, src))],
  ['M16 a pointer press never clears hamLast', swap('ui/session-workspace-view.js', "document.addEventListener('pointerdown', function(){ SessionShellDrawer.hamLast = false; }, true);", '')],
  ['M7 the Employee group label reverts to "Finance"', swap('ui/session-workspace-view.js', "finance: 'My work'", "finance: 'Finance'")],
  ['M5 the workspace renders in UNAVAILABLE', swap('ui/auth-view.js', 'if(s.state === AUTH_STATES.AUTHENTICATED) return renderSessionWorkspace(app, s);', 'if(s.state === AUTH_STATES.AUTHENTICATED || s.state === AUTH_STATES.UNAVAILABLE) return renderSessionWorkspace(app, s);')]
];

(async function main(){
  console.log('== U1 — SESSION GRADUATED SHELL RUNTIME VERIFICATION ==');
  const results = await suite(null);
  results.forEach(([c, label]) => check(c, label));
  console.log('-- R-11 mutation self-test --');
  for(const [name, mutate] of MUTATIONS){
    let caught;
    try { caught = (await suite(mutate)).filter(([c]) => !c).map(([, l]) => l); }
    catch(e){ caught = ['threw: ' + e.message]; }
    check(caught.length > 0 && !/^threw: /.test(caught[0]), 'R-11 ' + name + ' is caught by an assertion' + (caught.length ? ' (by: ' + caught[0] + ')' : ''));
  }
  console.log('');
  if(failures.length){
    console.log('U1 SESSION SHELL RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('U1 SESSION SHELL RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})().catch((e) => { console.error(e); process.exit(1); });
