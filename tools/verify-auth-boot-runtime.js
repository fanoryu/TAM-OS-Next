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
   `const AUTH_MODE = AUTH_MODES.SESSION;` in the concatenated text before it runs;
   the committed value is asserted separately. AFI-5b: the shipped mode is SESSION and the
   application has no "Acting as"; a LOCAL scenario loads the development identity
   (tools/dev/local-identity-fixture.js) right after identity.js, and installs a persona
   before bootstrap only when the scenario asks for one. fetch is a deterministic stub that
   answers by path from a script; the API timeout timer is recorded, never awaited.
   No network, no clock, no credentials: every identity, token and password here is
   fabricated.

   WP-1 (Account security): section WP-1 drives Change password and Sign out all devices for the
   CEO and the Employee — exact bodies, CSRF, the rotated-session contract, every refusal and
   uncertain outcome (never resent), the exact logout-all confirmation, field clearing — and a
   mutation register (M1-M6): each seeded source defect, applied through loadRuntime's `mutate`
   option (an exact-once text replacement), must make its case fail.
   ============================================================ */

const fs = require('fs');
const path = require('path');
// U1 (GR-4): the exact SESSION shell chrome, written out from the U1 specification.
const { parseSessionShell } = require('./session-shell-chrome.js');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

const root = path.resolve(__dirname, '..');
const MODE_LINE = 'const AUTH_MODE = AUTH_MODES.SESSION;';
const DEV_IDENTITY = fs.readFileSync(path.join(__dirname, 'dev', 'local-identity-fixture.js'), 'utf8');
const CSRF_A = 'A'.repeat(21) + '_' + 'b'.repeat(21);
const CSRF_B = 'Z'.repeat(20) + '-' + '9'.repeat(22);
const RID = '0123456789abcdef0123456789abcdef';
const PASSWORD = 'fabricated-Passw0rd-afi2';
const ME_CEO = { userId: 'u_ceo_1', membershipId: 'm_ceo_1', role: 'ceo', employeeId: null, csrfToken: CSRF_A };
const ME_EMP = { userId: 'u_emp_1', membershipId: 'm_emp_1', role: 'employee', employeeId: 'emp_srv_1', csrfToken: CSRF_A };
// AFI-5b: renderIdentitySelectorHTML is gone from the application; its absence is asserted
// directly (selectorDeclared) instead of spying on a name that no longer exists.
const BOOT_SPIES = ['loadState', 'applyTheme', 'installGlobalUIHandlers', 'maybeShowFirstRunChoice', 'renderShell'];

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
  // WP-1: an optional seeded defect [file, exact text, replacement], applied exactly once.
  const mut = opts.mutate || loadRuntime.mutate || null;
  const parts = jsFiles.map((f) => {
    let src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
    if(mut && mut[0] === f){
      if(src.split(mut[1]).length !== 2) throw new Error('mutation anchor not found exactly once in ' + f);
      src = src.split(mut[1]).join(mut[2]);
    }
    if(f === 'core/constants.js'){
      // Rewrite whichever single AUTH_MODE assignment is there, so a wrong committed value is
      // reported by the counted check in section 0 rather than crashing the run.
      const assigns = src.match(/const AUTH_MODE = [^;\n]+;/g) || [];
      if(assigns.length !== 1) throw new Error('expected exactly one AUTH_MODE assignment');
      src = src.replace(assigns[0], 'const AUTH_MODE = ' + mode + ';');
    }
    if(f === 'core/identity.js' && mode === LOCAL){
      // The development identity, as tools/serve-local-dev.js injects it; a persona only on request.
      src += '\n' + DEV_IDENTITY + (opts.persona ? '\n;DevLocalIdentity.install(' + JSON.stringify(opts.persona) + ');' : '');
    }
    if(f === 'core/app-bootstrap.js'){
      // Record (and neutralise) the local boot steps; render() stays real.
      src = BOOT_SPIES.concat(opts.spyRender ? ['render'] : []).map((n) => n + ' = (function(orig){ return function(){ __spy.push("' + n + '"); return undefined; }; })(' + n + ');').join('\n') + '\n' + src;
    }
    return src;
  });
  const src = parts.join('\n')
    + '\n;window.__TAM__ = { State: State, AuthBoot: AuthBoot, AUTH_STATES: AUTH_STATES, AUTH_MODE: AUTH_MODE,'
    + ' AUTH_MODES: AUTH_MODES, getCurrentUser: getCurrentUser, CsrfHolder: CsrfHolder,'
    + ' SessionIdentityProvider: SessionIdentityProvider,'
    + (mode === LOCAL ? ' LocalIdentityProvider: LocalIdentityProvider,' : '')
    + ' setIdentityProviderForTesting: setIdentityProviderForTesting, localDevReady: localDevReady,'
    + ' selectorDeclared: typeof renderIdentitySelectorHTML + typeof bindIdentitySelector + typeof syncIdentitySelector,'
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
  rt.appText = () => (els.app ? els.app.textContent : '');
  rt.tamReads = () => reads.filter((k) => /^tam_/.test(k));
  return rt;
}
const LOCAL = 'AUTH_MODES.LOCAL';
// AFI-5b: a seam provider that would be a CEO if it were ever consulted outside LOCAL.
const HOSTILE = { getCurrentUser(){ return { id: 'user_ceo_fixture', displayName: 'Hostile', principalType: 'ceo' }; } };
const flush = async (n) => { for(let i = 0; i < (n || 6); i++) await new Promise((r) => setImmediate(r)); };
const SESSION = 'AUTH_MODES.SESSION';
const calls = (rt, url) => rt.net.calls.filter((c) => c.url === url).length;
// No local business data, shell or "Acting as" anywhere — the AFI-2 firewall.
function firewall(rt, label){
  const html = rt.appHTML();
  check(rt.spy.indexOf('loadState') === -1 && rt.spy.indexOf('maybeShowFirstRunChoice') === -1 && rt.tamReads().length === 0,
    label + ': no loadState, no first-run choice, no local business key read');
  check(rt.State.txns.length === 0 && rt.State.employees.length === 0 && rt.State.storageReady === false,
    label + ': no business state in memory');
  // U1 authorized revision (GR-4, D-GS-1): AUTHENTICATED renders the card inside the exact SESSION
  // shell; no other state has a sidebar, and the card itself still has no LOCAL navigation (data-nav),
  // no LOCAL sidebar and no "Acting as". Was: no sidebar at all.
  const shell = parseSessionShell(html);
  const body = shell ? shell.content : html;
  check(!/identityPrincipalSelect|Acting as|class="sidebar"|id="sidebar"|data-nav=/.test(body) && rt.selectorDeclared === 'undefinedundefinedundefined'
    && (shell ? rt.AuthBoot.snapshot().state === 'AUTHENTICATED' && rt.AuthBoot.allowsWorkspace() === true : rt.AuthBoot.allowsWorkspace() === false),
    label + ': no LOCAL shell and no "Acting as" mounted (the selector functions do not exist); only the exact SESSION shell, and only while AUTHENTICATED');
}

(async function main(){
  console.log('== AFI-2 AUTHENTICATED BOOT — RUNTIME VERIFICATION ==');
  console.log('   Explicit auth mode / SESSION boot state machine / login / logout /');
  console.log('   bounded 403 recovery / business-state firewall / LOCAL development boot (AFI-5b).');
  console.log('');

  /* ---------- 0. the shipped mode ---------- */
  {
    const constants = fs.readFileSync(path.join(root, 'js', 'core', 'constants.js'), 'utf8');
    check(constants.split(MODE_LINE).length === 2 && (constants.match(/const AUTH_MODE\b/g) || []).length === 1,
      'mode: the committed source sets AUTH_MODE = AUTH_MODES.SESSION, exactly once (AFI-5b)');
    const rt = loadRuntime({ mode: SESSION });
    check(rt.AUTH_MODE === 'session' && rt.AUTH_MODES.LOCAL === 'local' && rt.AUTH_MODES.SESSION === 'session' && Object.isFrozen(rt.AUTH_MODES),
      'mode: exactly LOCAL and SESSION, frozen');
    check(rt.w.AUTH_MODE === undefined && rt.w.AuthBoot === undefined, 'mode: AUTH_MODE and AuthBoot are not exposed on window');
  }

  /* ---------- A. LOCAL development boot (AFI-5b D-01) ---------- */
  {
    // render is recorded too here: the real business render needs a real DOM, and the
    // contract under test is the boot ORDER, unchanged from before AFI-2 once a
    // development identity is ready.
    const rt = loadRuntime({ mode: LOCAL, boot: true, spyRender: true, persona: 'user_ceo_fixture' });
    await flush();
    check(rt.spy.join() === 'loadState,applyTheme,installGlobalUIHandlers,render,maybeShowFirstRunChoice',
      'A. LOCAL boot with a ready development identity: loadState -> applyTheme -> installGlobalUIHandlers -> render -> first-run choice (unchanged)');
    check(rt.net.calls.length === 0, 'A. LOCAL boot makes no API request');
    check(!/auth-screen/.test(rt.appHTML()), 'A. LOCAL boot renders no auth view');
    check((rt.getCurrentUser() || {}).id === 'user_ceo_fixture' && rt.localDevReady() === true,
      'A. LOCAL: the installed development persona establishes identity');
  }
  {
    const rt = loadRuntime({ mode: LOCAL, boot: true, spyRender: true });
    await flush();
    check(rt.spy.length === 0 && rt.net.calls.length === 0 && rt.tamReads().length === 0,
      'A. D01-ABSENT: LOCAL without a development identity: no boot step, no render, no request, no local key read');
    check(rt.AuthBoot.snapshot().state === 'CHECKING_SESSION' && rt.spy.indexOf('render') === -1,
      'A. D01-ABSENT: AuthBoot is never started on the not-ready path (state untouched, nothing painted)');
    check(rt.appText() === 'Development identity not installed' && rt.appHTML() === '' && rt.getCurrentUser() === null && rt.localDevReady() === false,
      'A. D01-ABSENT: only the fixed static notice is shown (textContent), with no identity');
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
      // U1 authorized revision (GR-4): inside the exact CEO SESSION shell, Employees active. Was: allowsWorkspace() === false.
      && rt.AuthBoot.allowsWorkspace() === true && ((parseSessionShell(rt.appHTML()) || {}).role === 'ceo') && parseSessionShell(rt.appHTML()).active === 'main',
      'D. AUTHENTICATED renders the SESSION Employee workspace inside the CEO SESSION shell, never the LOCAL business shell');
    firewall(rt, 'D. AUTHENTICATED CEO');
    // U1 authorized revision (GR-4, D-GS-1 supersedes D-A): the SESSION shell is granted here. Was: false.
    check(rt.AuthBoot.allowsWorkspace() === true && rt.spy.indexOf('renderShell') === -1, 'D. AuthBoot grants the SESSION shell (not the LOCAL renderShell) in AUTHENTICATED');
    check((rt.getCurrentUser() || {}).id === 'u_ceo_1' && rt.CsrfHolder.get() === CSRF_A, 'D. identity from /me; CSRF in memory');
    rt.setIdentityProviderForTesting(HOSTILE);
    check((rt.getCurrentUser() || {}).id === 'u_ceo_1' && rt.localDevReady() === false,
      'K. a provider installed through the test seam cannot change the SESSION identity (AFI-5b: the seam is inert)');
    rt.setIdentityProviderForTesting(null);
    rt.render();
    // U1 authorized revision (GR-4): render() keeps the exact SESSION shell; never the LOCAL one. Was: no sidebar at all.
    check(!!parseSessionShell(rt.appHTML()) && !/sidebar|identityPrincipalSelect|data-nav=/.test(parseSessionShell(rt.appHTML()).content) && rt.spy.indexOf('renderShell') === -1,
      'K. render() in SESSION mode never mounts the LOCAL shell (only the SESSION shell)');
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
    rt.setIdentityProviderForTesting(HOSTILE);
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
    rt.setIdentityProviderForTesting(HOSTILE);
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
    rt.setIdentityProviderForTesting(HOSTILE);
    check(rt.getCurrentUser() === null, 'R. after logout no local identity can take over (a seam provider is ignored)');
    rt.setIdentityProviderForTesting(null);
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

  /* ---------- O-2. no typed email outlives a session ---------- */
  // O-2: the sign-in and forgot-password forms keep a typed email across a failed attempt
  // only — never into or past a session. These cases drive the REAL submit and click
  // handlers of auth-view.js: #app answers querySelector with field stubs (value = the
  // rendered value=, or what the case "typed") and records the listeners. loadRuntime() is
  // unchanged. Fabricated identities only.
  const CEO_MAIL = 'ceo.fixture@example.test';
  const EMP_MAIL = 'employee.fixture@example.test';
  function formDriver(rt){
    const app = rt.w.document.getElementById('app');
    const handlers = {}; let typed = {};
    const rendered = (id) => { const m = app.innerHTML.match(new RegExp('id="' + id + '"[^>]*? value="([^"]*)"')); return m ? m[1] : null; };
    const stub = (id) => ({ value: rendered(id) || '', focus: function(){},
      addEventListener: function(ev, fn){ handlers[id + ':' + ev] = fn; },
      querySelector: function(sel){ const f = sel.replace(/^#/, ''); return Object.prototype.hasOwnProperty.call(typed, f) ? { value: typed[f] } : app.querySelector(sel); } });
    app.querySelector = function(sel){ const id = sel.replace(/^#/, ''); return app.innerHTML.indexOf('id="' + id + '"') === -1 ? null : stub(id); };
    return {
      value: rendered,
      // Submits a form with typed fields; returns before the request settles (for the busy view).
      submit: function(form, fields){ typed = fields; handlers[form + ':submit']({ preventDefault: function(){} }); typed = {}; },
      click: function(id){ handlers[id + ':click'](); }
    };
  }
  async function o2SignedOut(routes){
    const rt = loadRuntime({ mode: SESSION, boot: true, routes: Object.assign({ '/api/auth/me': [err(401, 'unauthenticated')] }, routes || {}) });
    const d = formDriver(rt);
    await flush(12);
    return { rt: rt, d: d };
  }
  async function o2SignIn(t, mail, me){
    t.rt.net.routes['/api/auth/me'] = [ok(me)];
    t.d.submit('authSignInForm', { authEmail: mail, authPassword: PASSWORD });
    await flush(12);
  }
  {
    const t = await o2SignedOut();
    check(t.rt.AuthBoot.snapshot().state === 'SIGNED_OUT' && t.d.value('authEmail') === '', 'O-2. fresh signed-out boot: the app supplies an empty email');
  }
  for(const [who, mail, me] of [['CEO', CEO_MAIL, ME_CEO], ['Employee', EMP_MAIL, ME_EMP]]){
    const t = await o2SignedOut({ '/api/auth/login': [ok({})], '/api/auth/logout': [ok({ loggedOut: true })] });
    await o2SignIn(t, mail, me);
    check(t.rt.AuthBoot.snapshot().state === 'AUTHENTICATED' && (t.rt.AuthBoot.snapshot().principal || {}).principalType === me.role,
      'O-2. ' + who + ' signs in through the real sign-in form');
    await t.rt.AuthBoot.signOut(); await flush();
    check(t.rt.AuthBoot.snapshot().message === 'signed_out' && t.d.value('authEmail') === '' && t.rt.appHTML().indexOf(mail) === -1,
      'O-2. ' + who + ' sign-out (confirmed): the sign-in form shows no previous email');
  }
  {
    const t = await o2SignedOut({ '/api/auth/login': [ok({})], '/api/auth/logout': [err(503, 'service_unavailable')] });
    await o2SignIn(t, EMP_MAIL, ME_EMP);
    await t.rt.AuthBoot.signOut(); await flush();
    check(t.rt.AuthBoot.snapshot().message === 'signout_unconfirmed' && t.d.value('authEmail') === '' && t.rt.appHTML().indexOf(EMP_MAIL) === -1,
      'O-2. Employee sign-out (unconfirmed): the sign-in form shows no previous email');
  }
  {
    const t = await o2SignedOut({ '/api/auth/login': [ok({})], '/api/auth/logout': [ok({ loggedOut: true })] });
    await o2SignIn(t, EMP_MAIL, ME_EMP);
    await t.rt.AuthBoot.signOut(); await flush();
    check(t.d.value('authEmail') === '' && t.rt.appHTML().indexOf(EMP_MAIL) === -1, 'O-2. handover: the next person sees no Employee email');
    await o2SignIn(t, CEO_MAIL, ME_CEO);
    check((t.rt.getCurrentUser() || {}).id === 'u_ceo_1' && (t.rt.AuthBoot.snapshot().principal || {}).principalType === 'ceo' && t.rt.appHTML().indexOf(EMP_MAIL) === -1,
      'O-2. handover: the CEO session is the CEO only, with no Employee email anywhere');
    await t.rt.AuthBoot.signOut(); await flush();
    check(t.d.value('authEmail') === '' && t.rt.appHTML().indexOf(CEO_MAIL) === -1, 'O-2. handover: after the CEO signs out the form is empty again');
  }
  {
    const t = await o2SignedOut({ '/api/auth/login': [ok({})], '/api/employees': [err(401, 'unauthenticated')] });
    await o2SignIn(t, CEO_MAIL, ME_CEO);
    check(t.rt.AuthBoot.snapshot().message === 'session_ended' && t.d.value('authEmail') === '' && t.rt.appHTML().indexOf(CEO_MAIL) === -1,
      'O-2. session ended (business read 401): the sign-in form shows no previous email');
  }
  {
    const t = await o2SignedOut({ '/api/auth/login': [ok({})] });
    await o2SignIn(t, CEO_MAIL, ME_CEO);
    t.rt.AuthBoot.sessionUncertain(); await flush();
    t.rt.net.routes['/api/auth/me'] = [err(401, 'unauthenticated')];
    await t.rt.AuthBoot.retry(); await flush();
    const s = t.rt.AuthBoot.snapshot();
    check(s.state === 'SIGNED_OUT' && s.message === null && t.d.value('authEmail') === '' && t.rt.appHTML().indexOf(CEO_MAIL) === -1,
      'O-2. uncertain session -> Retry -> signed out: the sign-in form shows no previous email');
  }
  {
    const t = await o2SignedOut({ '/api/auth/login': [ok({})], '/api/auth/logout': [ok({ loggedOut: true })], '/api/auth/forgot-password': [err(503, 'service_unavailable')] });
    t.d.click('authForgotBtn'); await flush();
    t.d.submit('authForgotForm', { authForgotEmail: EMP_MAIL }); await flush(12);
    check(t.d.value('authForgotEmail') === EMP_MAIL, 'O-2. a failed recovery request keeps its typed email (unchanged)');
    t.d.click('authBackBtn'); await flush(12);
    await o2SignIn(t, CEO_MAIL, ME_CEO);
    await t.rt.AuthBoot.signOut(); await flush();
    t.d.click('authForgotBtn'); await flush();
    check(t.d.value('authForgotEmail') === '' && t.rt.appHTML().indexOf(EMP_MAIL) === -1,
      'O-2. after a session the forgot-password form shows no earlier email');
  }
  {
    const t = await o2SignedOut({ '/api/auth/login': [err(401, 'unauthenticated')] });
    t.d.submit('authSignInForm', { authEmail: CEO_MAIL, authPassword: PASSWORD }); await flush(12);
    const dump = JSON.stringify(t.rt.memStore) + JSON.stringify(t.rt.State) + t.rt.appHTML() + JSON.stringify(t.rt.AuthBoot.snapshot());
    check(t.rt.AuthBoot.snapshot().message === 'credentials' && t.d.value('authEmail') === CEO_MAIL && dump.indexOf(PASSWORD) === -1,
      'O-2. failed sign-in keeps the typed email (unchanged UX); the password is in no storage, State, DOM or view model');
  }
  for(const [label, answers, me, msg] of [
    ['login 429', [err(429, 'rate_limited', { 'retry-after': '120' })], null, 'rate_limited'], ['login 400', [err(400, 'validation_failed')], null, 'validation'],
    ['login 403', [err(403, 'forbidden')], null, 'rejected'], ['login 503', [err(503, 'service_unavailable')], null, 'unavailable'],
    ['login 200 + /me 401', [ok({})], err(401, 'unauthenticated'), 'failed']]){
    const t = await o2SignedOut({ '/api/auth/login': answers });
    if(me) t.rt.net.routes['/api/auth/me'] = [me];
    t.d.submit('authSignInForm', { authEmail: CEO_MAIL, authPassword: PASSWORD }); await flush(12);
    check(t.rt.AuthBoot.snapshot().message === msg && t.d.value('authEmail') === CEO_MAIL && t.rt.getCurrentUser() === null,
      'O-2. ' + label + ': the typed email is kept, no identity');
  }
  {
    const t = await o2SignedOut({ '/api/auth/login': [err(401, 'unauthenticated'), ok({})], '/api/auth/logout': [ok({ loggedOut: true })] });
    t.d.submit('authSignInForm', { authEmail: CEO_MAIL, authPassword: PASSWORD }); await flush(12);
    check(t.d.value('authEmail') === CEO_MAIL, 'O-2. failed then successful sign-in: kept after the failure');
    await o2SignIn(t, CEO_MAIL, ME_CEO);
    await t.rt.AuthBoot.signOut(); await flush();
    check(t.rt.AuthBoot.snapshot().state === 'SIGNED_OUT' && t.d.value('authEmail') === '', 'O-2. failed then successful sign-in: empty after the sign-out');
  }
  {
    const t = await o2SignedOut({ '/api/auth/login': [ok({})] });
    t.rt.net.routes['/api/auth/me'] = [ok(ME_CEO)];
    t.d.submit('authSignInForm', { authEmail: CEO_MAIL, authPassword: PASSWORD });
    check(t.rt.AuthBoot.snapshot().busy === true && t.d.value('authEmail') === CEO_MAIL && /id="authEmail"[^>]* disabled/.test(t.rt.appHTML()),
      'O-2. while signing in, the busy form still shows the typed email (disabled)');
    await flush(12);
    check(t.rt.AuthBoot.snapshot().state === 'AUTHENTICATED', 'O-2. the busy sign-in completes');
  }

  /* ---------- WP-1. Account security: Change password and Sign out all devices ---------- */
  // The signed-in user's own account (CEO and Employee). Every request is sent once; no answer is
  // ever replayed; the rotated session of a password change must be confirmed by /me; logout-all is
  // done only on the exact { loggedOut: true }. Seeded defects (WP-1 M1-M6) must be caught below.
  const NEW_PW = 'fabricated-New-Passw0rd-wp1';
  const CONFIRM_LEAK = 'fabricated-Confirm-only-wp1';
  const asMe = (me, csrf) => Object.assign({}, me, { csrfToken: csrf });
  async function acct(me, routes, mutate){
    const rt = loadRuntime({ mode: SESSION, boot: true, mutate: mutate, routes: Object.assign({ '/api/auth/me': [ok(me)] }, routes || {}) });
    await flush(12);
    return rt;
  }
  const cpCalls = (rt) => rt.net.calls.filter((c) => c.url === '/api/auth/change-password');
  const laCalls = (rt) => rt.net.calls.filter((c) => c.url === '/api/auth/logout-all');
  const acc = (rt) => rt.AuthBoot.snapshot().account;
  const noSecret = (rt) => { const dump = JSON.stringify(rt.memStore) + JSON.stringify(rt.State) + rt.appHTML() + JSON.stringify(rt.AuthBoot.snapshot());
    return dump.indexOf(PASSWORD) === -1 && dump.indexOf(NEW_PW) === -1 && dump.indexOf(CONFIRM_LEAK) === -1; };
  async function changeOnce(rt, me, answer, meAfter){
    rt.net.routes['/api/auth/change-password'] = [answer];
    if(meAfter) rt.net.routes['/api/auth/me'] = [meAfter];
    rt.AuthBoot.openAccount('password');
    await rt.AuthBoot.changePassword(PASSWORD, NEW_PW, NEW_PW);
    await flush(12);
  }
  // Each case returns true when its contract holds; the mutation register re-runs them on seeded defects.
  const WP1 = {};
  WP1.success = async function(m, label, mutate){
    const rt = await acct(m, {}, mutate);
    await changeOnce(rt, m, ok(asMe(m, CSRF_B)), ok(asMe(m, CSRF_B)));
    const c = cpCalls(rt);
    const s = rt.AuthBoot.snapshot();
    const r = [
      [c.length === 1 && c[0].init.method === 'POST' && c[0].init.body === JSON.stringify({ currentPassword: PASSWORD, newPassword: NEW_PW })
        && c[0].init.headers['X-CSRF-Token'] === CSRF_A, label + ': one POST /api/auth/change-password with exactly { currentPassword, newPassword } and the session CSRF token (the confirmation is never sent)'],
      [rt.net.calls[rt.net.calls.indexOf(c[0]) + 1] && rt.net.calls[rt.net.calls.indexOf(c[0]) + 1].url === '/api/auth/me', label + ': the 200 is followed by GET /api/auth/me under the rotated session'],
      [s.state === 'AUTHENTICATED' && rt.CsrfHolder.get() === CSRF_B && (rt.getCurrentUser() || {}).id === m.userId, label + ': stays signed in; the rotated CSRF token replaces the old one; same principal'],
      [s.account.panel === null && s.account.notice === 'pw_changed' && /Your password was changed\. Every other session of your account has ended; this device stays signed in\./.test(rt.appHTML()), label + ': the panel closes with the fixed "password changed" notice'],
      [noSecret(rt), label + ': no password is in storage, State, the DOM or the view model']
    ];
    return r;
  };
  WP1.tokenMismatch = async function(mutate){
    const rt = await acct(ME_CEO, {}, mutate);
    await changeOnce(rt, ME_CEO, ok(asMe(ME_CEO, CSRF_B)), ok(asMe(ME_CEO, CSRF_A)));
    return [[rt.AuthBoot.snapshot().state === 'UNAVAILABLE' && rt.getCurrentUser() === null && rt.CsrfHolder.get() === null && cpCalls(rt).length === 1,
      'WP-1 change: /me under the new cookie names a different CSRF token than the change answer -> fail closed (UNAVAILABLE, identity cleared), never resent']];
  };
  WP1.uncertain = async function(label, answer, mutate){
    const rt = await acct(ME_CEO, {}, mutate);
    await changeOnce(rt, ME_CEO, answer, ok(ME_CEO));
    const after = rt.net.calls.length;
    rt.AuthBoot.openAccount('password');
    await rt.AuthBoot.changePassword(PASSWORD, NEW_PW, NEW_PW);
    await flush(12);
    const s = rt.AuthBoot.snapshot();
    return [
      [cpCalls(rt).length === 1, label + ': the change is sent exactly once and never resent'],
      [s.state === 'AUTHENTICATED' && s.account.notice === 'pw_unconfirmed' && s.account.locked === true && s.account.panel === null
        && /could not confirm whether your password was changed/.test(rt.appHTML()), label + ': /me still valid -> stays signed in with the "could not confirm" notice'],
      [rt.net.calls.length === after && !/id="authAcctPwBtn"/.test((rt.AuthBoot.openAccount('menu'), rt.appHTML())), label + ': Change password is not offered again in this session (opening it and submitting do nothing)'],
      [noSecret(rt), label + ': no password is kept anywhere']
    ];
  };
  WP1.uncertainSignedOut = async function(mutate){
    const rt = await acct(ME_EMP, {}, mutate);
    await changeOnce(rt, ME_EMP, err(503, 'service_unavailable'), err(401, 'unauthenticated'));
    const s = rt.AuthBoot.snapshot();
    return [[s.state === 'SIGNED_OUT' && s.message === 'password_unconfirmed' && cpCalls(rt).length === 1 && rt.getCurrentUser() === null
      && /could not confirm whether your password was changed\. Sign in with the new password first/.test(rt.appHTML()),
      'WP-1 change 503 + /me 401 (Employee): the old session is gone -> SIGNED_OUT with the "could not confirm" sign-in message; sent once']];
  };
  WP1.logoutAll = async function(m, label, mutate){
    const rt = await acct(m, { '/api/auth/logout-all': [ok({ loggedOut: true })] }, mutate);
    rt.AuthBoot.openAccount('logout_all');
    await rt.AuthBoot.signOutAll();
    const c = laCalls(rt);
    const s = rt.AuthBoot.snapshot();
    return [[c.length === 1 && c[0].init.body === '{}' && c[0].init.headers['X-CSRF-Token'] === CSRF_A && s.state === 'SIGNED_OUT' && s.message === 'signed_out_all'
      && rt.getCurrentUser() === null && rt.CsrfHolder.get() === null && /You have signed out on all devices\./.test(rt.appHTML()),
      label + ': POST /api/auth/logout-all {} with CSRF, once; the exact { loggedOut: true } -> SIGNED_OUT "signed out on all devices", identity and CSRF cleared']];
  };
  WP1.logoutAllInexact = async function(label, answer, mutate){
    const rt = await acct(ME_CEO, { '/api/auth/logout-all': [answer] }, mutate);
    rt.net.routes['/api/auth/me'] = [ok(ME_CEO)];
    rt.AuthBoot.openAccount('logout_all');
    await rt.AuthBoot.signOutAll();
    const s = rt.AuthBoot.snapshot();
    return [[s.state === 'AUTHENTICATED' && s.message !== 'signed_out_all' && s.account.message === 'all_unconfirmed' && laCalls(rt).length === 1
      && /could not confirm that your sessions were ended/.test(rt.appHTML()), label + ': never reported as done; /me still valid -> stays signed in with "could not confirm"; sent once']];
  };
  WP1.fieldsCleared = async function(mutate){
    const rt = await acct(ME_CEO, { '/api/auth/change-password': [err(400, 'validation_failed', null)] }, mutate);
    const app = rt.w.document.getElementById('app');
    const handlers = {}; const fields = {};
    const field = (id, v) => (fields[id] = { id: id, value: v, focus: function(){} });
    const stub = (id) => ({ id: id, focus: function(){}, addEventListener: function(ev, fn){ handlers[id + ':' + ev] = fn; },
      querySelector: function(sel){ return fields[sel.replace(/^#/, '')] || null; } });
    app.querySelector = function(sel){ const id = sel.replace(/^#/, ''); return app.innerHTML.indexOf('id="' + id + '"') === -1 ? null : stub(id); };
    rt.AuthBoot.openAccount('password');
    field('authAcctCurrent', PASSWORD); field('authAcctNew', NEW_PW); field('authAcctConfirm', CONFIRM_LEAK);
    const submit = handlers['authAcctPwForm:submit'];
    if(submit) submit({ preventDefault: function(){} });
    await flush(12);
    return [[!!submit && fields.authAcctCurrent.value === '' && fields.authAcctNew.value === '' && fields.authAcctConfirm.value === ''
      && cpCalls(rt).length === 0 && acc(rt).message === 'pw_mismatch' && noSecret(rt),
      'WP-1 view: the real submit handler reads the three password fields once and clears them at once; a mismatch is refused locally (no request); nothing is kept']];
  };
  for(const [m, who] of [[ME_CEO, 'CEO'], [ME_EMP, 'Employee']]){
    const rt = await acct(m);
    check(/id="authAccountBtn"[^>]*aria-expanded="false"[^>]*>Account security<\/button><button class="btn" id="authSignOutBtn"/.test(rt.appHTML()) && /<div class="head-controls"><button class="btn" id="authAccountBtn"/.test(rt.appHTML()),
      'WP-1 ' + who + ': "Account security" sits beside Sign out in a wrapping .head-controls row; the panel is closed');
    rt.AuthBoot.openAccount('menu');
    check(acc(rt).panel === 'menu' && /id="authAcctPanel"/.test(rt.appHTML()) && /id="authAcctPwBtn"/.test(rt.appHTML()) && /id="authAcctAllBtn"/.test(rt.appHTML())
      && /aria-expanded="true"/.test(rt.appHTML()) && rt.net.calls.length === 2, 'WP-1 ' + who + ': the panel offers Change password and Sign out all devices; opening it sends nothing');
    rt.AuthBoot.closeAccount();
    check(acc(rt).panel === null && !/id="authAcctPanel"/.test(rt.appHTML()), 'WP-1 ' + who + ': Close removes the panel');
    for(const [c, l] of await WP1.success(m, 'WP-1 change ' + who)) check(c, l);
    for(const [c, l] of await WP1.logoutAll(m, 'WP-1 logout-all ' + who)) check(c, l);
  }
  for(const [c, l] of await WP1.tokenMismatch()) check(c, l);
  {
    // A refused attempt, then a success: the notice carries no stale reference from the refusal.
    const rt = await acct(ME_CEO);
    await changeOnce(rt, ME_CEO, err(409, 'conflict'));
    check(acc(rt).message === 'pw_conflict' && acc(rt).requestId === RID, 'WP-1 change: precondition — a refusal shows its reference');
    rt.net.routes['/api/auth/change-password'] = [resp(200, { ok: true, data: asMe(ME_CEO, CSRF_B) })];
    rt.net.routes['/api/auth/me'] = [resp(200, { ok: true, data: asMe(ME_CEO, CSRF_B) })];
    await rt.AuthBoot.changePassword(PASSWORD, NEW_PW, NEW_PW); await flush(12);
    check(acc(rt).notice === 'pw_changed' && acc(rt).requestId === undefined && !/Reference:/.test((rt.appHTML().match(/id="authAcctNotice"[^>]*>[^<]*/) || [''])[0]),
      'WP-1 change: a later success shows the notice without the earlier refusal\'s reference');
  }
  {
    const rt = await acct(ME_CEO);
    await changeOnce(rt, ME_CEO, ok(asMe(ME_CEO, CSRF_B)), err(401, 'unauthenticated'));
    check(rt.AuthBoot.snapshot().state === 'SIGNED_OUT' && rt.AuthBoot.snapshot().message === 'session_ended' && cpCalls(rt).length === 1,
      'WP-1 change 200 + /me 401: the rotated session is not confirmed -> SIGNED_OUT, never resent');
    const rt2 = await acct(ME_CEO);
    await changeOnce(rt2, ME_CEO, ok(asMe(ME_EMP, CSRF_B)), ok(ME_CEO));
    check(rt2.AuthBoot.snapshot().state === 'AUTHENTICATED' && acc(rt2).notice === 'pw_unconfirmed' && acc(rt2).locked === true && cpCalls(rt2).length === 1,
      'WP-1 change 200 naming another principal: not accepted as the rotation -> uncertain (locked, not resent)');
  }
  for(const [label, answer, key] of [
    ['WP-1 change 400 [currentPassword]', err(400, 'validation_failed'), null],
    ['WP-1 change 429', err(429, 'rate_limited', { 'retry-after': '90' }), 'pw_rate_limited'],
    ['WP-1 change 409', err(409, 'conflict'), 'pw_conflict'],
    ['WP-1 change 403 (no replay)', err(403, 'forbidden'), 'pw_rejected']]){
    const fieldsAnswer = key === null ? resp(400, { ok: false, error: { code: 'validation_failed', message: 'x', fields: ['currentPassword'] }, requestId: RID }) : answer;
    const rt = await acct(ME_CEO);
    const before = rt.net.calls.length;
    await changeOnce(rt, ME_CEO, fieldsAnswer, ok(asMe(ME_CEO, CSRF_B)));
    const s = rt.AuthBoot.snapshot();
    check(s.state === 'AUTHENTICATED' && s.account.panel === 'password' && s.account.message === (key || 'pw_current') && cpCalls(rt).length === 1
      && rt.net.calls.length === before + 1 && rt.CsrfHolder.get() === CSRF_A && s.account.locked === false,
      label + ': refused before any change -> stays signed in, panel open with "' + (key || 'pw_current') + '"; one request, no /me, no replay');
    if(key === 'pw_rate_limited') check(/Too many attempts\. Nothing was changed\. Try again in about 2 minutes\./.test(rt.appHTML()), label + ': shows the Retry-After wait');
  }
  {
    const rt = await acct(ME_CEO);
    await changeOnce(rt, ME_CEO, resp(400, { ok: false, error: { code: 'validation_failed', message: 'x', fields: ['newPassword'] }, requestId: RID }));
    check(acc(rt).message === 'pw_policy' && /That new password cannot be used/.test(rt.appHTML()), 'WP-1 change 400 [newPassword] -> the policy message');
    const rt2 = await acct(ME_CEO);
    await changeOnce(rt2, ME_CEO, err(401, 'unauthenticated'));
    check(rt2.AuthBoot.snapshot().state === 'SIGNED_OUT' && rt2.AuthBoot.snapshot().message === 'session_ended' && cpCalls(rt2).length === 1, 'WP-1 change 401 -> SIGNED_OUT (session ended), not resent');
  }
  for(const [label, answer] of [['WP-1 change 503', err(503, 'service_unavailable')], ['WP-1 change network failure', NETFAIL],
    ['WP-1 change 500', err(500, 'internal_error')], ['WP-1 change malformed 200', ok({ changed: true })]]){
    for(const [c, l] of await WP1.uncertain(label, answer)) check(c, l);
  }
  for(const [c, l] of await WP1.uncertainSignedOut()) check(c, l);
  {
    const rt = await acct(ME_CEO);
    rt.AuthBoot.openAccount('password');
    await rt.AuthBoot.changePassword('', NEW_PW, NEW_PW);
    check(acc(rt).message === 'pw_missing' && cpCalls(rt).length === 0, 'WP-1 change: an empty field is refused locally (no request)');
    await rt.AuthBoot.changePassword(PASSWORD, NEW_PW, CONFIRM_LEAK);
    check(acc(rt).message === 'pw_mismatch' && cpCalls(rt).length === 0 && noSecret(rt), 'WP-1 change: a mismatched confirmation is refused locally (no request, nothing kept)');
    rt.net.routes['/api/auth/change-password'] = [ok(asMe(ME_CEO, CSRF_B))];
    rt.net.routes['/api/auth/me'] = [ok(asMe(ME_CEO, CSRF_B))];
    const p1 = rt.AuthBoot.changePassword(PASSWORD, NEW_PW, NEW_PW);
    const p2 = rt.AuthBoot.changePassword(PASSWORD, NEW_PW, NEW_PW);
    check(acc(rt).busy === true && /id="authSignOutBtn" type="button" disabled/.test(rt.appHTML()) && /id="authAcctPwSubmit" type="submit" disabled/.test(rt.appHTML()),
      'WP-1 change: while in flight, Sign out and the form are disabled');
    await rt.AuthBoot.signOut();
    await Promise.all([p1, p2]); await flush(12);
    check(cpCalls(rt).length === 1 && calls(rt, '/api/auth/logout') === 0 && acc(rt).notice === 'pw_changed', 'WP-1 change: a double submit sends one request, and Sign out waits for it');
  }
  {
    const rt = await acct(ME_CEO, { '/api/auth/logout-all': [err(503, 'service_unavailable')] });
    rt.net.routes['/api/auth/me'] = [err(401, 'unauthenticated')];
    rt.AuthBoot.openAccount('logout_all');
    await rt.AuthBoot.signOutAll();
    check(rt.AuthBoot.snapshot().state === 'SIGNED_OUT' && rt.AuthBoot.snapshot().message === 'signout_all_unconfirmed' && laCalls(rt).length === 1
      && /could not confirm that your sessions on other devices were ended/.test(rt.appHTML()), 'WP-1 logout-all 503 + /me 401 -> signed out here, other devices reported unconfirmed');
    const rt2 = await acct(ME_CEO, { '/api/auth/logout-all': [err(401, 'unauthenticated')] });
    rt2.AuthBoot.openAccount('logout_all');
    await rt2.AuthBoot.signOutAll();
    check(rt2.AuthBoot.snapshot().message === 'signout_all_unconfirmed' && laCalls(rt2).length === 1, 'WP-1 logout-all 401 -> SIGNED_OUT, not reported as done');
  }
  for(const [label, answer] of [['WP-1 logout-all 503', err(503, 'service_unavailable')], ['WP-1 logout-all network failure', NETFAIL],
    ['WP-1 logout-all 200 { loggedOut: true, extra }', ok({ loggedOut: true, extra: 1 })], ['WP-1 logout-all 200 { loggedOut: "yes" }', ok({ loggedOut: 'yes' })],
    ['WP-1 logout-all 200 {}', ok({})]]){
    for(const [c, l] of await WP1.logoutAllInexact(label, answer)) check(c, l);
  }
  for(const [label, answer, key] of [['WP-1 logout-all 403 (no replay)', err(403, 'forbidden'), 'all_rejected'],
    ['WP-1 logout-all 429', err(429, 'rate_limited', { 'retry-after': '30' }), 'all_rate_limited']]){
    const rt = await acct(ME_CEO, { '/api/auth/logout-all': [answer, ok({ loggedOut: true })] });
    rt.AuthBoot.openAccount('logout_all');
    const before = rt.net.calls.length;
    await rt.AuthBoot.signOutAll();
    check(rt.AuthBoot.snapshot().state === 'AUTHENTICATED' && acc(rt).message === key && laCalls(rt).length === 1 && rt.net.calls.length === before + 1,
      label + ': refused -> stays signed in with "' + key + '"; one request, no replay');
  }
  for(const [c, l] of await WP1.fieldsCleared()) check(c, l);
  {
    // State reset: a sign-out ends the panel and the uncertain-change lock.
    const rt = await acct(ME_CEO, { '/api/auth/logout': [ok({ loggedOut: true })], '/api/auth/login': [ok({})] });
    await changeOnce(rt, ME_CEO, err(503, 'service_unavailable'), ok(ME_CEO));
    check(acc(rt).locked === true, 'WP-1 reset: precondition — an uncertain change locked Change password');
    await rt.AuthBoot.signOut();
    rt.net.routes['/api/auth/me'] = [ok(ME_CEO)];
    await rt.AuthBoot.signIn('ceo@example.invalid', PASSWORD); await flush(12);
    check(rt.AuthBoot.snapshot().state === 'AUTHENTICATED' && acc(rt).locked === false && acc(rt).panel === null && acc(rt).notice === null,
      'WP-1 reset: after sign-out and a new sign-in the panel is closed and Change password is offered again');
  }

  /* WP-1 mutation register: each seeded defect must make its case fail. */
  const AB = 'core/auth-boot.js', WS = 'ui/session-workspace-view.js';
  const WP1_MUTANTS = [
    ['M1 the change is resent after an uncertain outcome', [AB, 'if(res.kind === API_RESULT_KINDS.UNAVAILABLE || res.kind === API_RESULT_KINDS.SERVER_ERROR) return passwordUncertain(principal, res);',
      "if(res.kind === API_RESULT_KINDS.UNAVAILABLE || res.kind === API_RESULT_KINDS.SERVER_ERROR){ await ApiClient.request('/api/auth/change-password', { method: 'POST', body: { currentPassword: currentPassword, newPassword: newPassword }, csrf: true }); return passwordUncertain(principal, res); }"],
      () => WP1.uncertain('M1', err(503, 'service_unavailable'))],
    ['M2 the rotated CSRF token is not confirmed by /me', [AB, ' || CsrfHolder.get() !== rotated.csrfToken){', '){'], () => WP1.tokenMismatch()],
    ['M3 logout-all accepts any loggedOut', [AB, 'Object.keys(data).length === 1 && data.loggedOut === true', '!!data.loggedOut'],
      () => WP1.logoutAllInexact('M3', ok({ loggedOut: 'yes' }))],
    ['M4 an uncertain change does not lock Change password', [AB, '    account.locked = true;\n', ''], () => WP1.uncertain('M4', NETFAIL)],
    ['M5 the password fields are not cleared on submit', [WS, "const v = el ? el.value : ''; if(el) el.value = ''; return v;", "const v = el ? el.value : ''; return v;"], () => WP1.fieldsCleared()],
    ['M6 the confirmation is sent', [AB, 'body: { currentPassword: currentPassword, newPassword: newPassword }, csrf: true });',
      'body: { currentPassword: currentPassword, newPassword: newPassword, confirmPassword: confirmPassword }, csrf: true });'], () => WP1.success(ME_CEO, 'M6')]
  ];
  for(const [name, mutate, run] of WP1_MUTANTS){
    let caught = false;
    try {
      const saved = loadRuntime.mutate; loadRuntime.mutate = mutate;
      try {
        const r = await run(); const hit = r.filter((x) => !x[0]);
        caught = hit.length > 0;
        if(caught) console.log('    ' + name.split(' ')[0] + ' caught by: ' + hit[0][1]);
      } finally { loadRuntime.mutate = saved; }
    } catch(e){ caught = /mutation anchor/.test(String(e && e.message)) ? false : true; if(!caught) console.log('    ' + e.message); }
    check(caught, 'WP-1 ' + name + ': caught');
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
