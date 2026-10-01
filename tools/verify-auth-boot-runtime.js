#!/usr/bin/env node
'use strict';
/* ============================================================
   AFI-2 — AUTHENTICATED BOOT RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of AFI-2. This harness proves its
   BEHAVIOUR by executing the real production modules in the dependency-free Node
   `vm` loader used by the other runtime harnesses: every module in module-order.js
   (app-bootstrap.js included where the boot itself is under test), against an
   in-memory window/document/localStorage.

   The auth mode is set per scenario by rewriting the ONE source line
   `const AUTH_MODE = AUTH_MODES.LOCAL;` in the concatenated text before it runs;
   the committed value is asserted separately. fetch is a deterministic stub that
   answers by path from a script; the API timeout timer is recorded, never awaited.
   No network, no clock, no credentials: every identity, token and password here is
   fabricated.
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
const MODE_LINE = 'const AUTH_MODE = AUTH_MODES.LOCAL;';
const CSRF_A = 'A'.repeat(21) + '_' + 'b'.repeat(21);
const CSRF_B = 'Z'.repeat(20) + '-' + '9'.repeat(22);
const RID = '0123456789abcdef0123456789abcdef';
const PASSWORD = 'fabricated-Passw0rd-afi2';
const ME_CEO = { userId: 'u_ceo_1', membershipId: 'm_ceo_1', role: 'ceo', employeeId: null, csrfToken: CSRF_A };
const ME_EMP = { userId: 'u_emp_1', membershipId: 'm_emp_1', role: 'employee', employeeId: 'emp_srv_1', csrfToken: CSRF_A };
const BOOT_SPIES = ['loadState', 'applyTheme', 'installGlobalUIHandlers', 'maybeShowFirstRunChoice', 'renderIdentitySelectorHTML', 'renderShell'];

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

/* ---------- runtime loader ---------- */
function loadRuntime(opts){
  const mode = opts.mode;
  const jsFiles = require(path.join(root, 'tools', 'module-order.js'))
    .filter((f) => opts.boot || f !== 'core/app-bootstrap.js');
  const parts = jsFiles.map((f) => {
    let src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
    if(f === 'core/constants.js'){
      // Rewrite whichever single AUTH_MODE assignment is there, so a wrong committed value is
      // reported by the counted check in section 0 rather than crashing the run.
      const assigns = src.match(/const AUTH_MODE = [^;\n]+;/g) || [];
      if(assigns.length !== 1) throw new Error('expected exactly one AUTH_MODE assignment');
      src = src.replace(assigns[0], 'const AUTH_MODE = ' + mode + ';');
    }
    if(f === 'core/app-bootstrap.js'){
      // Record (and neutralise) the local boot steps; render() stays real.
      src = BOOT_SPIES.concat(opts.spyRender ? ['render'] : []).map((n) => n + ' = (function(orig){ return function(){ __spy.push("' + n + '"); return "' + n + '" === "renderIdentitySelectorHTML" ? "" : undefined; }; })(' + n + ');').join('\n') + '\n' + src;
    }
    return src;
  });
  const src = parts.join('\n')
    + '\n;window.__TAM__ = { State: State, AuthBoot: AuthBoot, AUTH_STATES: AUTH_STATES, AUTH_MODE: AUTH_MODE,'
    + ' AUTH_MODES: AUTH_MODES, getCurrentUser: getCurrentUser, CsrfHolder: CsrfHolder,'
    + ' SessionIdentityProvider: SessionIdentityProvider, LocalIdentityProvider: LocalIdentityProvider,'
    + ' authSessionMutation: authSessionMutation, render: render, openGlobalSearch: openGlobalSearch,'
    + ' API_RESULT_KINDS: API_RESULT_KINDS,'
    // A request body built in the PAGE realm, as a real caller would.
    + ' body: function(json){ return JSON.parse(json); } };';
  const noop = function(){};
  const memStore = {}; const reads = [];
  const memStorage = {
    getItem: (k) => { reads.push(k); return Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null; },
    setItem: (k, v) => { memStore[k] = String(v); }, removeItem: (k) => { delete memStore[k]; }
  };
  const mkEl = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'', value:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, removeChild:noop, setAttribute:noop,
    getAttribute:()=>null, remove:noop, focus:noop, contains:()=>false, querySelector:()=>null, querySelectorAll:()=>[],
    classList:{ add:noop, remove:noop, toggle:noop, contains:()=>false } });
  const els = {};
  const net = { calls: [], routes: {}, created: 0 };
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
  const sandbox = {
    __spy: [],
    console: { log:noop, warn:noop, error:noop, info:noop }, navigator: { userAgent:'tam-afi2' },
    setTimeout: function(fn, ms){ if(ms === 10000) return 'api-timer'; return setTimeout(fn, ms); },
    clearTimeout: function(id){ if(id !== 'api-timer') clearTimeout(id); },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    AbortController: AbortController, fetch: fetchStub,
    localStorage: memStorage, sessionStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: { addEventListener:noop, removeEventListener:noop,
      getElementById: (id) => (els[id] = els[id] || mkEl()),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>{ net.created++; return mkEl(); }, contains:()=>false,
      body: mkEl(), documentElement: { dataset:{}, style:{} }, activeElement: null }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  if(opts.routes) net.routes = opts.routes;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-afi2-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.net = net; rt.memStore = memStore; rt.reads = reads; rt.spy = sandbox.__spy;
  rt.appHTML = () => (els.app ? els.app.innerHTML : '');
  rt.tamReads = () => reads.filter((k) => /^tam_/.test(k));
  return rt;
}
const flush = async (n) => { for(let i = 0; i < (n || 6); i++) await new Promise((r) => setImmediate(r)); };
const SESSION = 'AUTH_MODES.SESSION';
const LOCAL = 'AUTH_MODES.LOCAL';
const calls = (rt, url) => rt.net.calls.filter((c) => c.url === url).length;
// No local business data, shell or "Acting as" anywhere — the AFI-2 firewall.
function firewall(rt, label){
  const html = rt.appHTML();
  check(rt.spy.indexOf('loadState') === -1 && rt.spy.indexOf('maybeShowFirstRunChoice') === -1 && rt.tamReads().length === 0,
    label + ': no loadState, no first-run choice, no local business key read');
  check(rt.State.txns.length === 0 && rt.State.employees.length === 0 && rt.State.storageReady === false,
    label + ': no business state in memory');
  check(!/identityPrincipalSelect|Acting as|class="sidebar"|id="sidebar"|data-nav=/.test(html) && rt.spy.indexOf('renderIdentitySelectorHTML') === -1,
    label + ': no shell and no "Acting as" mounted');
}

(async function main(){
  console.log('== AFI-2 AUTHENTICATED BOOT — RUNTIME VERIFICATION ==');
  console.log('   Explicit auth mode / SESSION boot state machine / login / logout /');
  console.log('   bounded 403 recovery / business-state firewall / LOCAL unchanged.');
  console.log('');

  /* ---------- 0. the shipped mode ---------- */
  {
    const constants = fs.readFileSync(path.join(root, 'js', 'core', 'constants.js'), 'utf8');
    check(constants.split(MODE_LINE).length === 2 && (constants.match(/const AUTH_MODE\b/g) || []).length === 1,
      'mode: the committed source sets AUTH_MODE = AUTH_MODES.LOCAL, exactly once');
    const rt = loadRuntime({ mode: LOCAL });
    check(rt.AUTH_MODE === 'local' && rt.AUTH_MODES.LOCAL === 'local' && rt.AUTH_MODES.SESSION === 'session' && Object.isFrozen(rt.AUTH_MODES),
      'mode: exactly LOCAL and SESSION, frozen');
    check(rt.w.AUTH_MODE === undefined && rt.w.AuthBoot === undefined, 'mode: AUTH_MODE and AuthBoot are not exposed on window');
  }

  /* ---------- A. LOCAL mode boot unchanged ---------- */
  {
    // render is recorded too here: the real business render needs a real DOM, and the
    // contract under test is the boot ORDER, unchanged from before AFI-2.
    const rt = loadRuntime({ mode: LOCAL, boot: true, spyRender: true });
    await flush();
    check(rt.spy.join() === 'loadState,applyTheme,installGlobalUIHandlers,render,maybeShowFirstRunChoice',
      'A. LOCAL boot: loadState -> applyTheme -> installGlobalUIHandlers -> render -> first-run choice (unchanged)');
    check(rt.net.calls.length === 0, 'A. LOCAL boot makes no API request');
    check(!/auth-screen/.test(rt.appHTML()), 'A. LOCAL boot renders no auth view');
    rt.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
    check((rt.getCurrentUser() || {}).id === 'user_ceo_fixture', 'A. LOCAL: "Acting as" selection still establishes identity');
  }

  /* ---------- B–E. SESSION boot ---------- */
  {
    const rt = loadRuntime({ mode: SESSION, boot: true, routes: { '/api/auth/me': [ok(ME_CEO)] } });
    check(rt.AuthBoot.snapshot().state === 'CHECKING_SESSION' && /Checking your session/.test(rt.appHTML()),
      'C. SESSION boot starts in CHECKING_SESSION with the checking view');
    firewall(rt, 'C. CHECKING_SESSION');
    await flush();
    check(rt.spy.indexOf('applyTheme') === -1 && rt.spy.indexOf('installGlobalUIHandlers') === -1,
      'B. SESSION boot runs none of the LOCAL boot steps');
    // AFI-4a1 revision: once AUTHENTICATED, the CEO workspace makes its one Employee read
    // (GET /api/employees). Was: no request after /me. The session is still checked first.
    check(calls(rt, '/api/auth/me') === 1 && rt.net.calls.length === 2 && rt.net.calls[0].url === '/api/auth/me' && rt.net.calls[1].url === '/api/employees',
      'B. SESSION boot checks the session first: exactly one GET /api/auth/me, then only the workspace read GET /api/employees');
    const s = rt.AuthBoot.snapshot();
    check(s.state === 'AUTHENTICATED' && s.principal && s.principal.principalType === 'ceo', 'D. /me 200 valid -> AUTHENTICATED (CEO)');
    check(/Signed in/.test(rt.appHTML()) && /Signed in as <strong>CEO<\/strong>/.test(rt.appHTML()) && /authSignOutBtn/.test(rt.appHTML()),
      'D. AUTHENTICATED renders the holding view with the role label and Sign out');
    // AFI-4a1 revision: AUTHENTICATED now renders the read-only SESSION Employee workspace on
    // the auth-view path (not the business shell — the firewall below still holds). Was: the
    // "not available in this sign-in mode" holding view.
    check(!/authSignInForm/.test(rt.appHTML()) && /<h1 class="auth-title" id="authTitle" tabindex="-1">Employees<\/h1>/.test(rt.appHTML())
      && rt.AuthBoot.allowsWorkspace() === false, 'D. AUTHENTICATED renders the SESSION Employee workspace, never the business shell');
    firewall(rt, 'D. AUTHENTICATED CEO');
    check(rt.AuthBoot.allowsWorkspace() === false, 'D. AuthBoot grants no workspace (D-A)');
    check((rt.getCurrentUser() || {}).id === 'u_ceo_1' && rt.CsrfHolder.get() === CSRF_A, 'D. identity from /me; CSRF in memory');
    rt.LocalIdentityProvider.selectPrincipal('user_employee_fixture');
    check((rt.getCurrentUser() || {}).id === 'u_ceo_1', 'K. a local "Acting as" selection cannot change the SESSION identity');
    rt.render();
    check(!/sidebar|identityPrincipalSelect/.test(rt.appHTML()), 'K. render() in SESSION mode never mounts the shell');
    const createdBefore = rt.net.created;
    // An attempt to build the overlay (even one that throws on the fake DOM) counts as opening it.
    try { rt.openGlobalSearch(); } catch(_e){ rt.net.created++; }
    check(rt.net.created === createdBefore, 'K. Ctrl+K / openGlobalSearch opens nothing without a workspace (no overlay created)');
  }
  {
    const rt = loadRuntime({ mode: SESSION, boot: true, routes: { '/api/auth/me': [ok(ME_EMP)] } });
    await flush();
    const s = rt.AuthBoot.snapshot();
    check(s.state === 'AUTHENTICATED' && (s.principal || {}).principalType === 'employee' && /Signed in as <strong>Employee<\/strong>/.test(rt.appHTML()),
      'D. /me 200 Employee -> AUTHENTICATED holding view');
    rt.State.employees = [];
    firewall(rt, 'M. AUTHENTICATED Employee');
  }

  /* ---------- E–J. /me classification ---------- */
  const meCases = [
    ['E. /me 401 -> SIGNED_OUT', err(401, 'unauthenticated'), 'SIGNED_OUT'],
    ['F. /me 403 -> UNAVAILABLE', err(403, 'forbidden'), 'UNAVAILABLE'],
    ['G. /me 429 -> UNAVAILABLE', err(429, 'rate_limited', { 'retry-after': '30' }), 'UNAVAILABLE'],
    ['H. /me 500 -> UNAVAILABLE', err(500, 'internal_error'), 'UNAVAILABLE'],
    ['H. /me 503 -> UNAVAILABLE', err(503, 'service_unavailable'), 'UNAVAILABLE'],
    ['I. network failure -> UNAVAILABLE', NETFAIL, 'UNAVAILABLE'],
    ['J. malformed /me (unknown role) -> UNAVAILABLE', ok(Object.assign({}, ME_CEO, { role: 'root' })), 'UNAVAILABLE'],
    ['J. malformed /me (extra authority field) -> UNAVAILABLE', ok(Object.assign({}, ME_CEO, { companyId: 'c1' })), 'UNAVAILABLE'],
    ['J. non-JSON 200 -> UNAVAILABLE', resp(200, '<html></html>', { 'content-type': 'text/html' }), 'UNAVAILABLE']
  ];
  for(const [label, answer, expect] of meCases){
    const rt = loadRuntime({ mode: SESSION, boot: true, routes: { '/api/auth/me': [answer] } });
    rt.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
    await flush();
    const s = rt.AuthBoot.snapshot();
    check(s.state === expect && rt.getCurrentUser() === null && rt.CsrfHolder.get() === null, label + ' (no identity, no CSRF, no local fallback)');
    check(expect === 'SIGNED_OUT' ? /authSignInForm/.test(rt.appHTML()) : (/authRetryBtn/.test(rt.appHTML()) && !/authSignInForm/.test(rt.appHTML())),
      label + ': ' + (expect === 'SIGNED_OUT' ? 'sign-in form shown' : 'Retry shown, no sign-in form'));
    firewall(rt, label);
  }
  {
    // timeout: the 10 s abort is recorded, never awaited; simulate it by rejecting as an abort.
    const rt = loadRuntime({ mode: SESSION, boot: true, routes: { '/api/auth/me': [() => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; return e; }] } });
    await flush();
    check(rt.AuthBoot.snapshot().state === 'UNAVAILABLE', 'I. timeout (abort) -> UNAVAILABLE');
  }
  {
    // An invalid mode never reaches the API and never falls back to LOCAL.
    const rt = loadRuntime({ mode: "'something-else'", boot: true, routes: { '/api/auth/me': [ok(ME_CEO)] } });
    rt.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
    await flush();
    check(rt.AuthBoot.snapshot().state === 'UNAVAILABLE' && rt.net.calls.length === 0 && rt.getCurrentUser() === null,
      'mode: an invalid AUTH_MODE fails closed (UNAVAILABLE, no request, no identity, no LOCAL fallback)');
    firewall(rt, 'invalid mode');
  }

  /* ---------- T. retry ---------- */
  {
    const rt = loadRuntime({ mode: SESSION, boot: true, routes: { '/api/auth/me': [err(503, 'service_unavailable'), ok(ME_CEO)] } });
    await flush();
    check(rt.AuthBoot.snapshot().state === 'UNAVAILABLE' && calls(rt, '/api/auth/me') === 1, 'T. UNAVAILABLE after one /me; no automatic retry');
    await flush(12);
    check(calls(rt, '/api/auth/me') === 1, 'T. still exactly one /me while idle (no retry loop)');
    const p = rt.AuthBoot.retry();
    check(rt.AuthBoot.snapshot().state === 'CHECKING_SESSION', 'T. Retry -> CHECKING_SESSION');
    await p;
    check(rt.AuthBoot.snapshot().state === 'AUTHENTICATED' && calls(rt, '/api/auth/me') === 2, 'T. Retry performs one bounded recheck');
    await rt.AuthBoot.retry();
    check(calls(rt, '/api/auth/me') === 2, 'T. Retry is ignored outside UNAVAILABLE');
  }

  /* ---------- N–Q. login ---------- */
  async function signedOut(extraRoutes){
    const rt = loadRuntime({ mode: SESSION, boot: true, routes: Object.assign({ '/api/auth/me': [err(401, 'unauthenticated')] }, extraRoutes || {}) });
    await flush();
    return rt;
  }
  {
    const rt = await signedOut({ '/api/auth/login': [ok(Object.assign({}, ME_EMP, { role: 'employee' }))] });
    rt.net.routes['/api/auth/me'] = [ok(ME_CEO)];
    await rt.AuthBoot.signIn('ceo@example.invalid', PASSWORD);
    const login = rt.net.calls.find((c) => c.url === '/api/auth/login');
    check(!!login && login.init.method === 'POST' && login.init.body === JSON.stringify({ email: 'ceo@example.invalid', password: PASSWORD })
      && login.init.headers['X-CSRF-Token'] === undefined, 'N. login: POST /api/auth/login {email, password}, no CSRF header');
    // AFI-4a1 revision: the request right after the login is /me (the workspace read follows it).
    const iLogin = rt.net.calls.findIndex((c) => c.url === '/api/auth/login');
    check(iLogin !== -1 && (rt.net.calls[iLogin + 1] || {}).url === '/api/auth/me', 'N. login 200 is followed by GET /api/auth/me');
    const s = rt.AuthBoot.snapshot();
    check(s.state === 'AUTHENTICATED' && (s.principal || {}).principalType === 'ceo',
      'N. identity comes from /me, not from the login body (login said employee, /me said CEO)');
    const dump = JSON.stringify(rt.memStore) + JSON.stringify(rt.State) + rt.appHTML() + JSON.stringify(s);
    check(dump.indexOf(PASSWORD) === -1, 'security: the password is in no storage, State, DOM or view model');
    firewall(rt, 'N. after login');
  }
  {
    const rt = await signedOut({ '/api/auth/login': [err(401, 'unauthenticated')] });
    await rt.AuthBoot.signIn('nobody@example.invalid', PASSWORD);
    const s = rt.AuthBoot.snapshot();
    check(s.state === 'SIGNED_OUT' && s.message === 'credentials' && /Email or password is incorrect, or this account cannot sign in\./.test(rt.appHTML()),
      'O. login 401 -> SIGNED_OUT with the one generic credential message');
    check(calls(rt, '/api/auth/me') === 1 && rt.getCurrentUser() === null, 'O. a failed login makes no /me call and sets no identity');
  }
  {
    const rt = await signedOut({ '/api/auth/login': [err(429, 'rate_limited', { 'retry-after': '120' })] });
    await rt.AuthBoot.signIn('x@example.invalid', PASSWORD);
    const s = rt.AuthBoot.snapshot();
    check(s.state === 'SIGNED_OUT' && s.message === 'rate_limited' && s.retryAfter === 120 && /Try again in about 2 minutes\./.test(rt.appHTML()),
      'P. login 429 -> SIGNED_OUT showing Retry-After as a wait');
    await flush(12);
    check(calls(rt, '/api/auth/login') === 1, 'P. no automatic login retry');
  }
  for(const [label, answer, msg] of [
    ['login 400', err(400, 'validation_failed'), 'validation'], ['login 403', err(403, 'forbidden'), 'rejected'],
    ['login 503', err(503, 'service_unavailable'), 'unavailable'], ['login network failure', NETFAIL, 'unavailable']]){
    const rt = await signedOut({ '/api/auth/login': [answer] });
    await rt.AuthBoot.signIn('x@example.invalid', PASSWORD);
    const s = rt.AuthBoot.snapshot();
    check(s.state === 'SIGNED_OUT' && s.message === msg && rt.getCurrentUser() === null, label + ' -> SIGNED_OUT, message "' + msg + '", no identity');
  }
  for(const [label, me, state] of [
    ['Q. login 200 + malformed /me', ok(Object.assign({}, ME_CEO, { role: 'admin' })), 'UNAVAILABLE'],
    ['Q. login 200 + /me 503', err(503, 'service_unavailable'), 'UNAVAILABLE'],
    ['Q. login 200 + /me 401', err(401, 'unauthenticated'), 'SIGNED_OUT']]){
    const rt = await signedOut({ '/api/auth/login': [ok(ME_CEO)] });
    rt.net.routes['/api/auth/me'] = [me];
    await rt.AuthBoot.signIn('ceo@example.invalid', PASSWORD);
    check(rt.AuthBoot.snapshot().state === state && rt.getCurrentUser() === null && rt.CsrfHolder.get() === null,
      label + ' -> ' + state + ', no identity (fail closed)');
  }
  {
    const rt = await signedOut({ '/api/auth/login': [ok(ME_CEO)] });
    rt.net.routes['/api/auth/me'] = [ok(ME_CEO)];
    const p1 = rt.AuthBoot.signIn('ceo@example.invalid', PASSWORD);
    const p2 = rt.AuthBoot.signIn('ceo@example.invalid', PASSWORD);
    check(rt.AuthBoot.snapshot().busy === true && /disabled/.test(rt.appHTML()), 'security: controls are disabled while signing in');
    await Promise.all([p1, p2]);
    check(calls(rt, '/api/auth/login') === 1, 'security: a double submit sends one login request');
    const rt2 = await signedOut({ '/api/auth/login': [ok(ME_CEO)] });
    await rt2.AuthBoot.signIn('', '');
    check(calls(rt2, '/api/auth/login') === 0 && rt2.AuthBoot.snapshot().message === 'missing', 'login: empty fields are refused locally');
  }

  /* ---------- R–S. logout ---------- */
  async function authed(extraRoutes){
    const rt = loadRuntime({ mode: SESSION, boot: true, routes: Object.assign({ '/api/auth/me': [ok(ME_CEO)] }, extraRoutes || {}) });
    await flush();
    return rt;
  }
  {
    const rt = await authed({ '/api/auth/logout': [ok({ loggedOut: true })] });
    await rt.AuthBoot.signOut();
    const lo = rt.net.calls.find((c) => c.url === '/api/auth/logout');
    check(!!lo && lo.init.method === 'POST' && lo.init.body === '{}' && lo.init.headers['X-CSRF-Token'] === CSRF_A,
      'R. logout: POST /api/auth/logout {} with the in-memory CSRF token');
    const s = rt.AuthBoot.snapshot();
    check(s.state === 'SIGNED_OUT' && s.message === 'signed_out' && rt.getCurrentUser() === null && rt.CsrfHolder.get() === null,
      'R. logout success -> SIGNED_OUT, identity and CSRF cleared');
    rt.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
    check(rt.getCurrentUser() === null, 'R. after logout no local identity can take over');
    firewall(rt, 'R. after logout');
  }
  for(const [label, answer] of [['S. logout 503', err(503, 'service_unavailable')], ['S. logout network failure', NETFAIL], ['S. logout 500', err(500, 'internal_error')]]){
    const rt = await authed({ '/api/auth/logout': [answer] });
    await rt.AuthBoot.signOut();
    const s = rt.AuthBoot.snapshot();
    check(s.state === 'SIGNED_OUT' && s.message === 'signout_unconfirmed' && rt.getCurrentUser() === null && rt.CsrfHolder.get() === null
      && /could not confirm the sign-out/.test(rt.appHTML()), label + ' -> signed out on this device with an unconfirmed-server warning');
  }

  /* ---------- U–Z. bounded 403 / stale-CSRF recovery ---------- */
  async function recovery(meAfter, replayAnswers){
    const rt = await authed();
    rt.net.routes['/api/test/mutation'] = [err(403, 'forbidden')].concat(replayAnswers || []);
    rt.net.routes['/api/auth/me'] = [meAfter];
    const before = rt.net.calls.length;
    const out = await rt.authSessionMutation('/api/test/mutation', rt.body('{"note":"x"}'));
    const muts = rt.net.calls.slice(before).filter((c) => c.url === '/api/test/mutation');
    return { rt: rt, out: out, total: rt.net.calls.length - before, muts: muts };
  }
  {
    const r = await recovery(ok(Object.assign({}, ME_CEO, { csrfToken: CSRF_B })), [ok({ done: true })]);
    check(r.out.recovery === 'replayed' && r.out.result.ok === true && r.muts.length === 2, 'U. same principal + changed token -> exactly one replay');
    check(r.muts.length === 2 && r.muts[0].init.headers['X-CSRF-Token'] === CSRF_A && r.muts[1].init.headers['X-CSRF-Token'] === CSRF_B, 'U. the replay carries the refreshed token');
    check(r.total === 3, 'U. the recovery path makes exactly 3 requests (mutation, /me, one replay)');
  }
  {
    const r = await recovery(ok(ME_CEO), [ok({ done: true })]);
    check(r.out.recovery === 'token_unchanged' && r.out.result.kind === 'DENIED' && r.muts.length === 1 && r.total === 2,
      'V. same principal + unchanged token -> genuine denial, no replay');
  }
  {
    const r = await recovery(ok(Object.assign({}, ME_EMP, { csrfToken: CSRF_B })), [ok({ done: true })]);
    check(r.out.recovery === 'principal_changed' && r.muts.length === 1 && r.total === 2, 'W. changed principal -> no replay');
  }
  {
    const r = await recovery(err(401, 'unauthenticated'));
    check(r.out.recovery === 'signed_out' && r.muts.length === 1 && r.rt.getCurrentUser() === null, 'X. /me 401 during recheck -> signed out, no replay');
  }
  for(const [label, me] of [['Y. /me 503 during recheck', err(503, 'service_unavailable')], ['Y. malformed /me during recheck', ok({ bad: true })], ['Y. network failure during recheck', NETFAIL]]){
    const r = await recovery(me);
    check(r.out.recovery === 'unavailable' && r.muts.length === 1 && r.rt.getCurrentUser() === null && r.rt.CsrfHolder.get() === null,
      label + ' -> fail closed (identity cleared), no replay');
  }
  {
    const r = await recovery(ok(Object.assign({}, ME_CEO, { csrfToken: CSRF_B })), [err(403, 'forbidden'), ok({ done: true })]);
    check(r.out.recovery === 'replayed' && r.out.result.kind === 'DENIED' && r.muts.length === 2 && r.total === 3,
      'Z. replay answered 403 -> DENIED, no second replay (3 requests maximum)');
  }
  {
    // logout through the same path: stale token, same principal -> one replay -> confirmed.
    const rt = await authed({ '/api/auth/logout': [err(403, 'forbidden'), ok({ loggedOut: true })] });
    rt.net.routes['/api/auth/me'] = [ok(Object.assign({}, ME_CEO, { csrfToken: CSRF_B }))];
    await rt.AuthBoot.signOut();
    check(calls(rt, '/api/auth/logout') === 2 && rt.AuthBoot.snapshot().message === 'signed_out', 'U. logout with a stale CSRF token is replayed once and confirmed');
    const rt2 = await authed({ '/api/auth/logout': [err(403, 'forbidden')] });
    rt2.net.routes['/api/auth/me'] = [err(401, 'unauthenticated')];
    await rt2.AuthBoot.signOut();
    check(calls(rt2, '/api/auth/logout') === 1 && rt2.AuthBoot.snapshot().message === 'signed_out', 'X. logout 403 + /me 401: the session is already gone -> signed out');
  }

  /* ---------- summary ---------- */
  console.log('');
  if(failures.length){
    console.log('AFI-2 AUTHENTICATED BOOT RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('AFI-2 AUTHENTICATED BOOT RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})().catch(function(e){ console.log('AFI-2 AUTHENTICATED BOOT RUNTIME VERIFICATION FAILED -- harness error: ' + (e && e.stack || e)); process.exit(1); });
