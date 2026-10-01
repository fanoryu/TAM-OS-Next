#!/usr/bin/env node
'use strict';
/* ============================================================
   AFI-3 — CREDENTIAL FLOWS RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of AFI-3. This harness proves its
   BEHAVIOUR by executing the real production modules in the dependency-free Node
   `vm` loader of tools/verify-auth-boot-runtime.js — every module in module-order.js,
   app-bootstrap.js included — against an in-memory window/document/localStorage,
   plus a fake location/history (to prove the fragment is read once and stripped) and
   a small DOM for #app whose nodes are found by id in the rendered HTML (to drive the
   real form handlers).

   LOCAL-ONLY: not wired into CI (owner decision; CI-HARDEN-1 exact-five policy).
   The auth mode is set per scenario by rewriting the ONE source line
   `const AUTH_MODE = AUTH_MODES.LOCAL;` in memory. fetch is a deterministic stub that
   answers by path from a script. No network, no clock, no credentials, no mail: every
   token, address and password here is fabricated.
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
const RID = '0123456789abcdef0123456789abcdef';
const CSRF_A = 'A'.repeat(21) + '_' + 'b'.repeat(21);
const T_REC = 'fabricated-recovery-token-' + 'r'.repeat(17);      // 43 characters
const T_ACT = 'fabricated-activation-tok-' + 'a'.repeat(17);      // 43 characters
const PW = 'fabricated-New-Passw0rd-afi3';
const PW2 = 'fabricated-Other-Passw0rd-afi3';
const ME_CEO = { userId: 'u_ceo_1', membershipId: 'm_ceo_1', role: 'ceo', employeeId: null, csrfToken: CSRF_A };
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
const err = (status, code, headers, fields) => resp(status, { ok: false, error: Object.assign({ code: code, message: 'server text' }, fields ? { fields: fields } : {}), requestId: RID }, headers);
const v400 = (fields) => err(400, 'validation_failed', null, fields);
const NETFAIL = () => new TypeError('Failed to fetch');
// A response the test releases by hand (to hold a request in flight).
function deferred(){ let release; const p = new Promise((r) => { release = r; }); const fn = () => p; fn.release = release; return fn; }

/* ---------- runtime loader ---------- */
function loadRuntime(opts){
  const mode = opts.mode;
  const jsFiles = require(path.join(root, 'tools', 'module-order.js'));
  const parts = jsFiles.map((f) => {
    let src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
    if(f === 'core/constants.js'){
      const assigns = src.match(/const AUTH_MODE = [^;\n]+;/g) || [];
      if(assigns.length !== 1) throw new Error('expected exactly one AUTH_MODE assignment');
      src = src.replace(assigns[0], 'const AUTH_MODE = ' + mode + ';');
    }
    if(f === 'core/app-bootstrap.js'){
      // Record (and neutralise) the local boot steps; render() stays real except in LOCAL,
      // where the business render needs a real DOM and the contract is the boot ORDER.
      src = BOOT_SPIES.concat(mode === LOCAL ? ['render'] : []).map((n) => n + ' = (function(orig){ return function(){ __spy.push("' + n + '"); return "' + n + '" === "renderIdentitySelectorHTML" ? "" : undefined; }; })(' + n + ');').join('\n') + '\n' + src;
    }
    return src;
  });
  const src = parts.join('\n')
    + '\n;window.__TAM__ = { State: State, AuthBoot: AuthBoot, AuthFlow: AuthFlow, AUTH_FLOW_STATES: AUTH_FLOW_STATES,'
    + ' parseAuthLink: parseAuthLink, AUTH_MODE: AUTH_MODE, getCurrentUser: getCurrentUser, CsrfHolder: CsrfHolder,'
    + ' LocalIdentityProvider: LocalIdentityProvider, render: render, openGlobalSearch: openGlobalSearch };';
  const noop = function(){};
  const memStore = {}; const reads = []; const writes = [];
  const memStorage = {
    getItem: (k) => { reads.push(k); return Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null; },
    setItem: (k, v) => { writes.push(k); memStore[k] = String(v); }, removeItem: (k) => { writes.push(k); delete memStore[k]; }
  };
  const logs = [];
  const logger = (lvl) => function(){ logs.push(lvl + ':' + Array.prototype.join.call(arguments, ' ')); };
  // #app: nodes are looked up by id in the rendered HTML; a re-render discards them.
  const dom = { nodes: {}, focused: null };
  const mkEl = (id) => {
    const el = { id: id, style:{}, dataset:{}, className:'', textContent:'', value:'', listeners: {},
      addEventListener: function(t, fn){ (el.listeners[t] = el.listeners[t] || []).push(fn); }, removeEventListener:noop,
      appendChild:noop, removeChild:noop, setAttribute:noop, getAttribute:()=>null, remove:noop, contains:()=>false,
      focus: function(){ dom.focused = id || null; },
      querySelector: (sel) => app.querySelector(sel), querySelectorAll:()=>[],
      classList:{ add:noop, remove:noop, toggle:noop, contains:()=>false } };
    let html = '';
    Object.defineProperty(el, 'innerHTML', { get: () => html, set: (v) => { html = String(v); if(el === app) dom.nodes = {}; } });
    return el;
  };
  const app = mkEl('app');
  app.querySelector = function(sel){
    const m = /^#([A-Za-z][\w-]*)$/.exec(sel);
    if(!m || app.innerHTML.indexOf('id="' + m[1] + '"') === -1) return null;
    return (dom.nodes[m[1]] = dom.nodes[m[1]] || mkEl(m[1]));
  };
  const els = { app: app };
  const net = { calls: [], routes: {}, created: 0 };
  const fetchStub = function(url, init){
    net.calls.push({ url: url, init: init });
    return new Promise(function(resolve, reject){
      const q = net.routes[url] || [];
      const next = q.length > 1 ? q.shift() : q[0];
      Promise.resolve().then(function(){
        if(!next) return reject(new TypeError('no route'));
        const out = typeof next === 'function' ? next(init) : next;
        Promise.resolve(out).then(function(o){ if(o instanceof Error) reject(o); else resolve(o); });
      });
    });
  };
  const loc = { hash: opts.hash || '', pathname: opts.pathname || '/', search: opts.search || '' };
  const hist = { calls: [], replaceState: function(st, title, url){ hist.calls.push([st, title, url]); if(String(url).indexOf('#') === -1) loc.hash = ''; },
    pushState: function(){ hist.calls.push(['push']); } };
  const winListeners = {};
  const sandbox = {
    __spy: [],
    console: { log:logger('log'), warn:logger('warn'), error:logger('error'), info:logger('info'), debug:logger('debug') },
    navigator: { userAgent:'tam-afi3' },
    setTimeout: function(fn, ms){ if(ms === 10000) return 'api-timer'; return setTimeout(fn, ms); },
    clearTimeout: function(id){ if(id !== 'api-timer') clearTimeout(id); },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    AbortController: AbortController, fetch: fetchStub,
    localStorage: memStorage, sessionStorage: memStorage, storage: undefined,
    location: loc, history: hist,
    addEventListener: function(t, fn){ (winListeners[t] = winListeners[t] || []).push(fn); }, removeEventListener: noop, confirm: ()=>true,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: { addEventListener:noop, removeEventListener:noop,
      getElementById: (id) => (els[id] = els[id] || mkEl(id)),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>{ net.created++; return mkEl(); }, contains:()=>false,
      body: mkEl('body'), documentElement: { dataset:{}, style:{} }, activeElement: null }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  if(opts.routes) net.routes = opts.routes;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-afi3-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.net = net; rt.memStore = memStore; rt.reads = reads; rt.writes = writes; rt.spy = sandbox.__spy;
  rt.loc = loc; rt.hist = hist; rt.logs = logs; rt.dom = dom; rt.winListeners = winListeners;
  rt.appHTML = () => app.innerHTML;
  rt.node = (id) => app.querySelector('#' + id);
  rt.tamReads = () => reads.filter((k) => /^tam_/.test(k));
  rt.fireHash = (h) => { loc.hash = h; (winListeners.hashchange || []).forEach((fn) => fn({})); };
  return rt;
}
const flush = async (n) => { for(let i = 0; i < (n || 8); i++) await new Promise((r) => setImmediate(r)); };
const SESSION = 'AUTH_MODES.SESSION';
const LOCAL = 'AUTH_MODES.LOCAL';
const calls = (rt, url) => rt.net.calls.filter((c) => c.url === url);
const flowState = (rt) => rt.AuthFlow.snapshot().state;
const lastBody = (rt, url) => { const c = calls(rt, url); return c.length ? JSON.parse(c[c.length - 1].init.body) : null; };

// Drive the real form handlers through the rendered DOM.
function submitPasswords(rt, a, b){
  const form = rt.node('authNewPasswordForm'); const n1 = rt.node('authNewPassword'); const n2 = rt.node('authConfirmPassword');
  if(!form || !n1 || !n2) return false;
  n1.value = a; n2.value = b;
  let prevented = false;
  (form.listeners.submit || []).forEach((fn) => fn({ preventDefault: () => { prevented = true; } }));
  return { prevented: prevented, cleared: n1.value === '' && n2.value === '' };
}
function submitForgot(rt, email){
  const form = rt.node('authForgotForm'); const input = rt.node('authForgotEmail');
  if(!form || !input) return false;
  input.value = email;
  (form.listeners.submit || []).forEach((fn) => fn({ preventDefault: () => {} }));
  return true;
}
function click(rt, id){ const n = rt.node(id); if(!n) return false; (n.listeners.click || []).forEach((fn) => fn({})); return true; }

// No local business data, shell, "Acting as", Global Search, storage, logging or identity.
function firewall(rt, label){
  const html = rt.appHTML();
  check(rt.spy.indexOf('loadState') === -1 && rt.spy.indexOf('maybeShowFirstRunChoice') === -1 && rt.tamReads().length === 0,
    label + ': no loadState, no first-run choice, no tam_* read');
  check(rt.State.txns.length === 0 && rt.State.employees.length === 0 && rt.State.storageReady === false, label + ': no business state in memory');
  check(!/identityPrincipalSelect|Acting as|class="sidebar"|id="sidebar"|data-nav=/.test(html) && rt.spy.indexOf('renderIdentitySelectorHTML') === -1,
    label + ': no shell and no "Acting as" mounted');
  const created = rt.net.created;
  try { rt.openGlobalSearch(); } catch(_e){ rt.net.created++; }
  check(rt.net.created === created && rt.AuthBoot.allowsWorkspace() === false, label + ': Ctrl/Cmd+K opens nothing; no workspace');
  check(rt.writes.length === 0 && rt.logs.length === 0, label + ': nothing written to storage, nothing logged');
}
// Neither the token nor a password anywhere observable.
function noLeak(rt, label, secrets){
  const dump = JSON.stringify(rt.memStore) + JSON.stringify(rt.State) + rt.appHTML() + JSON.stringify(rt.AuthFlow.snapshot())
    + JSON.stringify(rt.AuthBoot.snapshot()) + rt.logs.join('|') + rt.loc.hash + JSON.stringify(rt.hist.calls);
  check(secrets.every((s) => dump.indexOf(s) === -1), label + ': token and password are in no storage, State, DOM, view model, URL or log');
}

async function linkFlow(hash, routes){
  const rt = loadRuntime({ mode: SESSION, hash: hash, routes: Object.assign({ '/api/auth/me': [err(401, 'unauthenticated')] }, routes || {}) });
  await flush();
  return rt;
}
async function signedOut(routes){
  const rt = loadRuntime({ mode: SESSION, routes: Object.assign({ '/api/auth/me': [err(401, 'unauthenticated')] }, routes || {}) });
  await flush();
  return rt;
}

(async function main(){
  console.log('== AFI-3 CREDENTIAL FLOWS — RUNTIME VERIFICATION ==');
  console.log('   Link ingestion and stripping / activation / recovery request / reset /');
  console.log('   enumeration defense / business-state firewall / LOCAL and AFI-2 unchanged.');
  console.log('');

  /* ---------- 0. module surface ---------- */
  {
    const rt = loadRuntime({ mode: LOCAL });
    check(rt.w.AuthFlow === undefined && rt.w.parseAuthLink === undefined, '0. AuthFlow and parseAuthLink are not exposed on window');
    check(Object.isFrozen(rt.AUTH_FLOW_STATES) && Object.keys(rt.AUTH_FLOW_STATES).sort().join() === 'ACTIVATE_DONE,ACTIVATE_FORM,FORGOT_FORM,FORGOT_SENT,IDLE,LINK_INVALID,RESET_DONE,RESET_FORM',
      '0. exactly the eight flow states, frozen');
    check(Object.isFrozen(rt.AuthFlow.snapshot()) && Object.keys(rt.AuthFlow.snapshot()).indexOf('token') === -1, '0. the view model is frozen and has no token field');
  }

  /* ---------- L. link parsing ---------- */
  {
    const rt = loadRuntime({ mode: LOCAL });
    const p = rt.parseAuthLink;
    const r1 = p('#recovery=' + T_REC); const a1 = p('#activation=' + T_ACT);
    check(!!r1 && r1.purpose === 'recovery' && r1.token === T_REC, 'L. #recovery=<43> parses as a recovery link');
    check(!!a1 && a1.purpose === 'activation' && a1.token === T_ACT, 'L. #activation=<43> parses as an activation link');
    const bad = [
      ['42 characters', '#recovery=' + T_REC.slice(1)], ['44 characters', '#recovery=' + T_REC + 'x'],
      ['extra parameter', '#recovery=' + T_REC + '&next=/elsewhere'], ['redirect parameter', '#recovery=' + T_REC + '?redirect=https://x.invalid'],
      ['two tokens', '#recovery=' + T_REC + '#activation=' + T_ACT], ['two tokens (&)', '#recovery=' + T_REC + '&activation=' + T_ACT],
      ['non-base64url character', '#recovery=' + T_REC.slice(1) + '+'], ['padding', '#recovery=' + T_REC.slice(1) + '='],
      ['trailing slash', '#activation=' + T_ACT + '/'], ['trailing space', '#recovery=' + T_REC + ' '],
      ['wrong case', '#Recovery=' + T_REC], ['wrong separator', '#recovery:' + T_REC], ['unknown purpose', '#reset=' + T_REC],
      ['query instead of fragment', '?recovery=' + T_REC], ['no hash sign', 'recovery=' + T_REC], ['empty', ''], ['null', null]
    ];
    bad.forEach(([label, h]) => check(p(h) === null, 'L. rejected: ' + label));
  }

  /* ---------- I. ingestion at SESSION start ---------- */
  {
    const rt = await linkFlow('#recovery=' + T_REC);
    check(flowState(rt) === 'RESET_FORM' && rt.AuthFlow.snapshot().purpose === 'recovery', 'I. a recovery link opens RESET_FORM');
    check(rt.net.calls.length === 0, 'I. no /me (and no request at all) before the flow is shown');
    check(rt.hist.calls.length === 1 && rt.hist.calls[0][0] === null && rt.hist.calls[0][1] === '' && rt.hist.calls[0][2] === '/' && rt.loc.hash === '',
      'I. the fragment is stripped at once with replaceState(null, "", pathname + search)');
    check(!rt.hist.calls.some((c) => c[0] === 'push'), 'I. no history entry is pushed');
    check(/Choose a new password/.test(rt.appHTML()) && /autocomplete="new-password"/.test(rt.appHTML()) && rt.dom.focused === 'authNewPassword',
      'I. the reset form renders with new-password fields and focus on the first one');
    check((rt.appHTML().match(/type="password"/g) || []).length === 2 && !/maxlength="72"/.test(rt.appHTML()), 'I. two password fields (new + confirm), no byte-unsafe maxlength');
    noLeak(rt, 'I. after ingestion', [T_REC]);
    firewall(rt, 'I. RESET_FORM');
  }
  {
    const rt = loadRuntime({ mode: SESSION, hash: '#activation=' + T_ACT, pathname: '/tam/', search: '?v=1', routes: { '/api/auth/me': [ok(ME_CEO)] } });
    await flush();
    check(flowState(rt) === 'ACTIVATE_FORM' && /Activate your account/.test(rt.appHTML()), 'I. an activation link opens ACTIVATE_FORM');
    check(rt.hist.calls.length === 1 && rt.hist.calls[0][2] === '/tam/?v=1' && rt.loc.hash === '', 'I. the strip keeps pathname and search, drops only the fragment');
    check(rt.net.calls.length === 0 && rt.getCurrentUser() === null, 'I. no session check, no identity while the flow is open');
  }
  {
    const rt = await linkFlow('#recovery=short-token');
    check(flowState(rt) === 'LINK_INVALID' && rt.loc.hash === '' && rt.hist.calls.length === 1 && rt.net.calls.length === 0,
      'I. a malformed credential fragment is stripped and shown as an invalid link, with no request');
    const rt2 = await linkFlow('#activation=' + T_ACT + '&next=/x');
    check(flowState(rt2) === 'LINK_INVALID' && rt2.AuthFlow.snapshot().purpose === 'activation' && rt2.loc.hash === '',
      'I. an activation link with an extra parameter is stripped and refused');
    noLeak(rt2, 'I. refused link', [T_ACT]);
  }
  {
    const rt = await linkFlow('#section-2');
    check(rt.hist.calls.length === 0 && rt.loc.hash === '#section-2' && flowState(rt) === 'IDLE', 'I. a non-credential fragment is left untouched');
    check(calls(rt, '/api/auth/me').length === 1 && rt.AuthBoot.snapshot().state === 'SIGNED_OUT', 'I. ... and the AFI-2 boot runs unchanged (one /me)');
    const rt2 = await linkFlow('#recoveryx=' + T_REC);
    check(rt2.hist.calls.length === 0 && flowState(rt2) === 'IDLE', 'I. a look-alike purpose (#recoveryx=) is not a credential link');
  }

  /* ---------- H. hashchange ---------- */
  {
    const rt = await signedOut();
    check((rt.winListeners.hashchange || []).length === 1, 'H. SESSION start installs exactly one hashchange listener');
    rt.fireHash('#activation=' + T_ACT);
    check(flowState(rt) === 'ACTIVATE_FORM' && rt.loc.hash === '' && rt.hist.calls.length === 1 && calls(rt, '/api/auth/me').length === 1,
      'H. a link opened into a loaded tab is ingested once, stripped, and opens its flow (no request)');
    rt.fireHash('#recovery=' + T_REC);
    check(flowState(rt) === 'RESET_FORM' && rt.loc.hash === '', 'H. a newer link replaces an idle flow');
    rt.fireHash('#nothing');
    check(flowState(rt) === 'RESET_FORM' && rt.loc.hash === '#nothing', 'H. a non-credential hashchange is ignored');
    noLeak(rt, 'H. after hashchange', [T_REC, T_ACT]);
  }
  {
    const d = deferred();
    const rt = await linkFlow('#recovery=' + T_REC, { '/api/auth/reset-password': [d] });
    const p = rt.AuthFlow.submitPassword(PW, PW);
    await flush();
    check(rt.AuthFlow.snapshot().busy === true, 'H. (reset in flight)');
    rt.fireHash('#activation=' + T_ACT);
    check(flowState(rt) === 'RESET_FORM' && rt.loc.hash === '' && rt.AuthFlow.snapshot().busy === true,
      'H. while a request is in flight a new link is stripped but does not replace the active flow');
    d.release(ok({ reset: true }));
    await p; await flush();
    check(flowState(rt) === 'RESET_DONE', 'H. the in-flight reset completes normally');
  }
  {
    const d = deferred();
    const rt = await signedOut({ '/api/auth/login': [d] });
    const p = rt.AuthBoot.signIn('ceo@example.invalid', PW);
    rt.fireHash('#recovery=' + T_REC);
    check(flowState(rt) === 'IDLE' && rt.loc.hash === '', 'H. while a sign-in is in flight a link is stripped and ignored');
    d.release(err(401, 'unauthenticated'));
    await p;
  }

  /* ---------- A. activation ---------- */
  {
    const rt = await linkFlow('#activation=' + T_ACT, { '/api/auth/activate': [ok({ activated: true })] });
    const r = submitPasswords(rt, PW, PW);
    check(r && r.prevented && r.cleared, 'A. submit is intercepted and both password fields are cleared at once');
    check(rt.AuthFlow.snapshot().busy === true && /disabled/.test(rt.appHTML()) && /Activating/.test(rt.appHTML()), 'A. controls are disabled while activating');
    await flush();
    const c = calls(rt, '/api/auth/activate');
    check(c.length === 1 && c[0].init.method === 'POST' && c[0].init.body === JSON.stringify({ token: T_ACT, password: PW }),
      'A. POST /api/auth/activate with exactly { token, password } (no confirmation, no email)');
    check(c[0].init.headers['X-CSRF-Token'] === undefined && c[0].init.headers['Content-Type'] === 'application/json' && c[0].init.credentials === 'same-origin',
      'A. no CSRF header; JSON; same-origin');
    check(flowState(rt) === 'ACTIVATE_DONE' && /Account activated/.test(rt.appHTML()) && /authContinueBtn/.test(rt.appHTML()) && /Continue to sign in/.test(rt.appHTML()),
      'A. success -> ACTIVATE_DONE with an explicit "Continue to sign in"');
    check(rt.getCurrentUser() === null && rt.CsrfHolder.get() === null && calls(rt, '/api/auth/me').length === 0, 'A. activation establishes no identity and checks no session');
    await flush(12);
    check(flowState(rt) === 'ACTIVATE_DONE' && rt.net.calls.length === 1, 'A. no timed redirect, no further request');
    noLeak(rt, 'A. after activation', [T_ACT, PW]);
    firewall(rt, 'A. ACTIVATE_DONE');
    click(rt, 'authContinueBtn');
    await flush();
    check(flowState(rt) === 'IDLE' && calls(rt, '/api/auth/me').length === 1 && rt.AuthBoot.snapshot().state === 'SIGNED_OUT' && /authSignInForm/.test(rt.appHTML()),
      'A. Continue -> the flow ends and /me decides (401 -> sign-in form)');
  }
  {
    const rt = await linkFlow('#activation=' + T_ACT, { '/api/auth/activate': [v400(['token'])] });
    await rt.AuthFlow.submitPassword(PW, PW);
    check(flowState(rt) === 'LINK_INVALID' && /invalid, has expired or was already used/.test(rt.appHTML()) && /administrator for a new activation link/.test(rt.appHTML()),
      'A. 400 token -> LINK_INVALID (one state for invalid, expired, used, revoked)');
    await rt.AuthFlow.submitPassword(PW, PW);
    await flush(12);
    check(calls(rt, '/api/auth/activate').length === 1, 'A. the refused token is discarded: no retry, automatic or manual');
    noLeak(rt, 'A. LINK_INVALID', [T_ACT, PW]);
    firewall(rt, 'A. LINK_INVALID');
  }
  {
    const rt = await linkFlow('#activation=' + T_ACT, { '/api/auth/activate': [v400(['password']), ok({ activated: true })] });
    await rt.AuthFlow.submitPassword('fabricated12', 'fabricated12');
    check(flowState(rt) === 'ACTIVATE_FORM' && rt.AuthFlow.snapshot().message === 'policy' && /That password cannot be used/.test(rt.appHTML()),
      'A. 400 password -> stays on the form with the fixed policy message');
    await rt.AuthFlow.submitPassword(PW, PW);
    const c = calls(rt, '/api/auth/activate');
    check(c.length === 2 && JSON.parse(c[1].init.body).token === T_ACT && flowState(rt) === 'ACTIVATE_DONE', 'A. the token is kept: a manual retry with a new password succeeds');
  }
  {
    const rt = await linkFlow('#activation=' + T_ACT, { '/api/auth/activate': [err(429, 'rate_limited', { 'retry-after': '300' }), ok({ activated: true })] });
    await rt.AuthFlow.submitPassword(PW, PW);
    const s = rt.AuthFlow.snapshot();
    check(flowState(rt) === 'ACTIVATE_FORM' && s.message === 'rate_limited' && s.retryAfter === 300 && /Try again in about 5 minutes\./.test(rt.appHTML()),
      'A. 429 -> stays on the form with the approximate wait');
    await flush(12);
    check(calls(rt, '/api/auth/activate').length === 1 && !/disabled/.test(rt.appHTML()), 'A. 429: no automatic retry, no countdown, controls usable');
    await rt.AuthFlow.submitPassword(PW, PW);
    check(JSON.parse(calls(rt, '/api/auth/activate')[1].init.body).token === T_ACT, 'A. 429: the token is kept for a manual retry');
  }
  for(const [label, answer, msg] of [
    ['503', err(503, 'service_unavailable'), 'unavailable'], ['500', err(500, 'internal_error'), 'unavailable'],
    ['network failure', NETFAIL, 'unavailable'], ['403', err(403, 'forbidden'), 'rejected_link'],
    ['404', err(404, 'not_found'), 'unavailable'], ['400 other', err(400, 'malformed_json'), 'failed'],
    ['malformed 200 (activated: "yes")', ok({ activated: 'yes' }), 'unavailable'], ['malformed 200 (extra key)', ok({ activated: true, userId: 'u1' }), 'unavailable'],
    ['malformed 200 (wrong key)', ok({ reset: true }), 'unavailable'], ['non-JSON 200', resp(200, '<html></html>', { 'content-type': 'text/html' }), 'unavailable']]){
    const rt = await linkFlow('#activation=' + T_ACT, { '/api/auth/activate': [answer, ok({ activated: true })] });
    await rt.AuthFlow.submitPassword(PW, PW);
    check(flowState(rt) === 'ACTIVATE_FORM' && rt.AuthFlow.snapshot().message === msg && rt.getCurrentUser() === null,
      'A. ' + label + ' -> stays on the form, message "' + msg + '", never success');
    await flush(12);
    check(calls(rt, '/api/auth/activate').length === 1, 'A. ' + label + ': no automatic retry');
    if(label === '503'){
      await rt.AuthFlow.submitPassword(PW, PW);
      check(flowState(rt) === 'ACTIVATE_DONE' && JSON.parse(calls(rt, '/api/auth/activate')[1].init.body).token === T_ACT, 'A. 503: the token is kept; a manual retry succeeds');
    }
  }
  {
    const rt = await linkFlow('#activation=' + T_ACT, { '/api/auth/activate': [ok({ activated: true })] });
    const r = submitPasswords(rt, PW, PW2);
    await flush();
    check(r && r.cleared && calls(rt, '/api/auth/activate').length === 0 && rt.AuthFlow.snapshot().message === 'mismatch' && /do not match/.test(rt.appHTML()),
      'A. confirmation mismatch: handled locally, zero requests, fields cleared');
    await rt.AuthFlow.submitPassword('', '');
    check(calls(rt, '/api/auth/activate').length === 0 && rt.AuthFlow.snapshot().message === 'missing_password', 'A. empty fields: zero requests');
    noLeak(rt, 'A. mismatch', [PW, PW2, T_ACT]);
  }
  {
    const rt = await linkFlow('#activation=' + T_ACT, { '/api/auth/activate': [ok({ activated: true })] });
    const p1 = rt.AuthFlow.submitPassword(PW, PW); const p2 = rt.AuthFlow.submitPassword(PW, PW);
    submitPasswords(rt, PW, PW);
    await Promise.all([p1, p2]); await flush();
    check(calls(rt, '/api/auth/activate').length === 1, 'A. a double submit sends one request');
  }

  /* ---------- F. recovery request (forgot password) ---------- */
  {
    const rt = await signedOut();
    check(/authForgotBtn/.test(rt.appHTML()) && /Forgot password\?/.test(rt.appHTML()), 'F. the sign-in view offers "Forgot password?"');
    click(rt, 'authForgotBtn');
    check(flowState(rt) === 'FORGOT_FORM' && /Reset your password/.test(rt.appHTML()) && rt.dom.focused === 'authForgotEmail', 'F. "Forgot password?" opens the form, focus on the email field');
    check(rt.net.calls.length === 1, 'F. opening the form sends nothing');
    click(rt, 'authBackBtn');
    await flush();
    check(flowState(rt) === 'IDLE' && calls(rt, '/api/auth/me').length === 2 && rt.AuthBoot.snapshot().state === 'SIGNED_OUT', 'F. Back -> the flow ends and /me is checked again');
  }
  {
    const rt = loadRuntime({ mode: SESSION, routes: { '/api/auth/me': [ok(ME_CEO)] } });
    await flush();
    rt.AuthFlow.openForgot();
    check(flowState(rt) === 'IDLE', 'F. not offered while AUTHENTICATED');
    const rt2 = loadRuntime({ mode: SESSION, routes: { '/api/auth/me': [err(503, 'service_unavailable')] } });
    await flush();
    rt2.AuthFlow.openForgot();
    check(flowState(rt2) === 'IDLE', 'F. not offered while UNAVAILABLE');
    const d = deferred();
    const rt3 = await signedOut({ '/api/auth/login': [d] });
    const p = rt3.AuthBoot.signIn('ceo@example.invalid', PW);
    rt3.AuthFlow.openForgot();
    check(flowState(rt3) === 'IDLE', 'F. not offered while a sign-in is in flight');
    d.release(err(401, 'unauthenticated')); await p;
  }
  {
    // Enumeration defense: three different addresses, one indistinguishable outcome.
    const outcomes = [];
    for(const email of ['ceo@example.invalid', 'nobody@example.invalid', 'not-an-address']){
      const rt = await signedOut({ '/api/auth/forgot-password': [ok({ requested: true })] });
      rt.AuthFlow.openForgot();
      submitForgot(rt, email);
      await flush();
      const c = calls(rt, '/api/auth/forgot-password');
      check(c.length === 1 && c[0].init.body === JSON.stringify({ email: email }) && c[0].init.headers['X-CSRF-Token'] === undefined,
        'F. POST /api/auth/forgot-password with exactly { email }, no CSRF (' + email + ')');
      outcomes.push({ html: rt.appHTML(), snap: JSON.stringify(rt.AuthFlow.snapshot()), focus: rt.dom.focused, email: email });
      if(email === 'ceo@example.invalid'){
        check(flowState(rt) === 'FORGOT_SENT' && /If an account can be recovered, a link was sent\. Use the most recent message\. If none arrives, contact your administrator\./.test(rt.appHTML()),
          'F. 200 -> FORGOT_SENT with the one generic confirmation');
        check(!/immediately|now been sent|has been sent to/.test(rt.appHTML()), 'F. the confirmation promises no immediate delivery');
        firewall(rt, 'F. FORGOT_SENT');
      }
    }
    check(outcomes.every((o) => o.html === outcomes[0].html && o.snap === outcomes[0].snap && o.focus === outcomes[0].focus),
      'F. known, unknown and invalid addresses render identically (copy, state, focus, buttons)');
    check(outcomes.every((o) => o.html.indexOf(o.email) === -1), 'F. the confirmation never echoes the address');
  }
  {
    const rt = await signedOut({ '/api/auth/forgot-password': [err(429, 'rate_limited', { 'retry-after': '900' })] });
    rt.AuthFlow.openForgot();
    await rt.AuthFlow.requestRecovery('someone@example.invalid');
    check(flowState(rt) === 'FORGOT_FORM' && rt.AuthFlow.snapshot().message === 'rate_limited' && /Try again in about 15 minutes\./.test(rt.appHTML()),
      'F. 429 -> stays on the form with the approximate wait');
    check(/Too many attempts from this network\./.test(rt.appHTML()) && !/account/i.test(rt.AuthFlow.snapshot().message), 'F. the rate-limit message names the network, not an account');
    await flush(12);
    check(calls(rt, '/api/auth/forgot-password').length === 1, 'F. 429: no automatic retry');
  }
  for(const [label, answer] of [['network failure', NETFAIL], ['503', err(503, 'service_unavailable')], ['500', err(500, 'internal_error')],
    ['malformed 200', ok({ requested: 'yes' })], ['malformed 200 (extra key)', ok({ requested: true, sent: true })], ['non-JSON 200', resp(200, 'ok', { 'content-type': 'text/plain' })]]){
    const rt = await signedOut({ '/api/auth/forgot-password': [answer] });
    rt.AuthFlow.openForgot();
    await rt.AuthFlow.requestRecovery('someone@example.invalid');
    check(flowState(rt) === 'FORGOT_FORM' && rt.AuthFlow.snapshot().message === 'unavailable' && /could not be reached/.test(rt.appHTML()),
      'F. ' + label + ' -> generic unavailable, never the confirmation');
  }
  {
    const rt = await signedOut({ '/api/auth/forgot-password': [ok({ requested: true })] });
    rt.AuthFlow.openForgot();
    await rt.AuthFlow.requestRecovery('   ');
    check(calls(rt, '/api/auth/forgot-password').length === 0 && rt.AuthFlow.snapshot().message === 'missing_email', 'F. an empty address is refused locally (zero requests)');
    const p1 = rt.AuthFlow.requestRecovery('a@example.invalid'); const p2 = rt.AuthFlow.requestRecovery('a@example.invalid');
    check(/Sending/.test(rt.appHTML()) && /disabled/.test(rt.appHTML()), 'F. controls are disabled while sending');
    await Promise.all([p1, p2]);
    check(calls(rt, '/api/auth/forgot-password').length === 1, 'F. a double submit sends one request');
    click(rt, 'authBackBtn');
    await flush();
    check(flowState(rt) === 'IDLE' && rt.AuthBoot.snapshot().state === 'SIGNED_OUT', 'F. from the confirmation, Back returns to sign-in through /me');
  }

  /* ---------- R. reset ---------- */
  {
    const rt = await linkFlow('#recovery=' + T_REC, { '/api/auth/reset-password': [ok({ reset: true })] });
    const r = submitPasswords(rt, PW, PW);
    await flush();
    const c = calls(rt, '/api/auth/reset-password');
    check(r && r.cleared && c.length === 1 && c[0].init.body === JSON.stringify({ token: T_REC, password: PW }) && c[0].init.headers['X-CSRF-Token'] === undefined,
      'R. POST /api/auth/reset-password with exactly { token, password }, no CSRF; fields cleared');
    check(flowState(rt) === 'RESET_DONE' && /Password changed/.test(rt.appHTML()) && /every session of your account has ended/.test(rt.appHTML()),
      'R. success -> RESET_DONE (every session ended; sign in with the new password)');
    check(rt.getCurrentUser() === null && rt.AuthBoot.allowsWorkspace() === false && calls(rt, '/api/auth/me').length === 0, 'R. reset establishes no identity and grants no workspace');
    noLeak(rt, 'R. after reset', [T_REC, PW]);
    firewall(rt, 'R. RESET_DONE');
    rt.net.routes['/api/auth/me'] = [err(401, 'unauthenticated')];
    click(rt, 'authContinueBtn');
    await flush();
    check(flowState(rt) === 'IDLE' && rt.AuthBoot.snapshot().state === 'SIGNED_OUT' && calls(rt, '/api/auth/me').length === 1, 'R. Continue -> /me 401 -> SIGNED_OUT');
  }
  {
    // Another account's session cookie survives a reset: /me stays authoritative.
    const rt = await linkFlow('#recovery=' + T_REC, { '/api/auth/reset-password': [ok({ reset: true })] });
    await rt.AuthFlow.submitPassword(PW, PW);
    rt.net.routes['/api/auth/me'] = [ok(ME_CEO)];
    await rt.AuthFlow.leave();
    const s = rt.AuthBoot.snapshot();
    check(s.state === 'AUTHENTICATED' && (s.principal || {}).id === 'u_ceo_1' && rt.AuthBoot.allowsWorkspace() === false,
      'R. Continue -> /me 200 -> AUTHENTICATED holding view: /me, not the reset, decides');
  }
  {
    const rt = await linkFlow('#recovery=' + T_REC, { '/api/auth/reset-password': [v400(['token'])] });
    await rt.AuthFlow.submitPassword(PW, PW);
    check(flowState(rt) === 'LINK_INVALID' && /Forgot password\?/.test(rt.appHTML()) && /If you just set a new password, sign in with it\./.test(rt.appHTML()),
      'R. 400 token -> LINK_INVALID, pointing to sign-in and "Forgot password?"');
    await rt.AuthFlow.submitPassword(PW, PW); await flush(12);
    check(calls(rt, '/api/auth/reset-password').length === 1, 'R. the refused token is discarded (no retry)');
    click(rt, 'authBackBtn'); await flush();
    check(flowState(rt) === 'IDLE' && rt.AuthBoot.snapshot().state === 'SIGNED_OUT', 'R. Back to sign in -> /me decides');
  }
  {
    const rt = await linkFlow('#recovery=' + T_REC, { '/api/auth/reset-password': [v400(['token', 'password'])] });
    await rt.AuthFlow.submitPassword(PW, PW);
    check(flowState(rt) === 'RESET_FORM' && rt.AuthFlow.snapshot().message === 'failed', 'R. a body-shape 400 (token + password) is not mistaken for a dead link');
  }
  {
    const rt = await linkFlow('#recovery=' + T_REC, { '/api/auth/reset-password': [v400(['password']), err(429, 'rate_limited', { 'retry-after': '45' }), err(503, 'service_unavailable'), ok({ reset: true })] });
    await rt.AuthFlow.submitPassword(PW, PW);
    check(flowState(rt) === 'RESET_FORM' && rt.AuthFlow.snapshot().message === 'policy', 'R. 400 password -> policy message, stays on the form');
    await rt.AuthFlow.submitPassword(PW, PW);
    check(rt.AuthFlow.snapshot().message === 'rate_limited' && /Try again in 45 seconds\./.test(rt.appHTML()), 'R. 429 -> approximate wait');
    await rt.AuthFlow.submitPassword(PW, PW);
    check(rt.AuthFlow.snapshot().message === 'unavailable' && /Reference: 0123456789abcdef0123456789abcdef\./.test(rt.appHTML()), 'R. 503 -> unavailable with the server reference');
    await rt.AuthFlow.submitPassword(PW, PW);
    const c = calls(rt, '/api/auth/reset-password');
    check(c.length === 4 && c.every((x) => JSON.parse(x.init.body).token === T_REC) && flowState(rt) === 'RESET_DONE',
      'R. the token is kept across policy, 429 and 503; each retry is manual; the last succeeds');
  }
  for(const [label, answer] of [['malformed 200 (reset: 1)', ok({ reset: 1 })], ['malformed 200 (activated)', ok({ activated: true })], ['network failure', NETFAIL]]){
    const rt = await linkFlow('#recovery=' + T_REC, { '/api/auth/reset-password': [answer] });
    await rt.AuthFlow.submitPassword(PW, PW);
    check(flowState(rt) === 'RESET_FORM' && rt.AuthFlow.snapshot().message === 'unavailable', 'R. ' + label + ' -> never success');
  }
  {
    const rt = await linkFlow('#recovery=' + T_REC, { '/api/auth/reset-password': [ok({ reset: true })] });
    submitPasswords(rt, PW, PW2); await flush();
    check(calls(rt, '/api/auth/reset-password').length === 0 && rt.AuthFlow.snapshot().message === 'mismatch', 'R. confirmation mismatch: zero requests');
    const p1 = rt.AuthFlow.submitPassword(PW, PW); const p2 = rt.AuthFlow.submitPassword(PW, PW);
    await Promise.all([p1, p2]);
    check(calls(rt, '/api/auth/reset-password').length === 1, 'R. a double submit sends one request');
  }
  {
    // Back from the form drops the token: a later attempt has nothing to send.
    const rt = await linkFlow('#recovery=' + T_REC, { '/api/auth/reset-password': [ok({ reset: true })] });
    click(rt, 'authBackBtn'); await flush();
    await rt.AuthFlow.submitPassword(PW, PW);
    check(flowState(rt) === 'IDLE' && calls(rt, '/api/auth/reset-password').length === 0 && calls(rt, '/api/auth/me').length === 1,
      'R. Back to sign in drops the token and lets /me decide');
    // A reload after the strip: the fragment is gone, so the normal boot runs.
    const again = loadRuntime({ mode: SESSION, hash: rt.loc.hash, routes: { '/api/auth/me': [err(401, 'unauthenticated')] } });
    await flush();
    check(flowState(again) === 'IDLE' && again.AuthBoot.snapshot().state === 'SIGNED_OUT', 'R. a reload after the strip does not bring the token back');
  }

  /* ---------- G. LOCAL, invalid mode, AFI-2 ---------- */
  {
    const rt = loadRuntime({ mode: LOCAL, hash: '#recovery=' + T_REC });
    await flush();
    check(rt.spy.join() === 'loadState,applyTheme,installGlobalUIHandlers,render,maybeShowFirstRunChoice', 'G. LOCAL with a credential fragment: the LOCAL boot sequence is unchanged');
    check(rt.loc.hash === '#recovery=' + T_REC && rt.hist.calls.length === 0 && !(rt.winListeners.hashchange || []).length,
      'G. LOCAL neither parses nor strips the fragment and installs no hashchange listener');
    check(rt.net.calls.length === 0 && flowState(rt) === 'IDLE', 'G. LOCAL sends no /api request and never enters a flow');
    rt.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
    check((rt.getCurrentUser() || {}).id === 'user_ceo_fixture', 'G. LOCAL: LocalIdentityProvider and "Acting as" still establish identity');
    rt.AuthFlow.openForgot();
    check(rt.AuthFlow.beginFromLink() === false && flowState(rt) === 'IDLE' && rt.hist.calls.length === 0, 'G. LOCAL: AuthFlow entry points are inert');
  }
  {
    const rt = loadRuntime({ mode: "'something-else'", hash: '#activation=' + T_ACT, routes: { '/api/auth/me': [ok(ME_CEO)] } });
    await flush();
    check(rt.AuthBoot.snapshot().state === 'UNAVAILABLE' && rt.net.calls.length === 0 && flowState(rt) === 'IDLE' && rt.loc.hash === '#activation=' + T_ACT,
      'G. an invalid AUTH_MODE fails closed: no flow, no request, fragment not read');
    firewall(rt, 'G. invalid mode');
  }
  {
    const rt = loadRuntime({ mode: SESSION, routes: { '/api/auth/me': [ok(ME_CEO)] } });
    check(rt.AuthBoot.snapshot().state === 'CHECKING_SESSION', 'G. AFI-2: without a link SESSION boot starts in CHECKING_SESSION');
    await flush();
    check(calls(rt, '/api/auth/me').length === 1 && rt.AuthBoot.snapshot().state === 'AUTHENTICATED' && /Signed in as/.test(rt.appHTML()),
      'G. AFI-2: one /me, AUTHENTICATED holding view, unchanged');
    rt.LocalIdentityProvider.selectPrincipal('user_employee_fixture');
    check((rt.getCurrentUser() || {}).id === 'u_ceo_1', 'G. AFI-2: no local identity takes over in SESSION mode');
  }

  /* ---------- summary ---------- */
  console.log('');
  if(failures.length){
    console.log('AFI-3 CREDENTIAL FLOWS RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('AFI-3 CREDENTIAL FLOWS RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})().catch(function(e){ console.log('AFI-3 CREDENTIAL FLOWS RUNTIME VERIFICATION FAILED -- harness error: ' + (e && e.stack || e)); process.exit(1); });
