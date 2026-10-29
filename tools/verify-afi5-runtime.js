#!/usr/bin/env node
'use strict';
/* ============================================================
   AFI-5b — IDENTITY TRANSITION RUNTIME VERIFICATION
   ------------------------------------------------------------
   AFI-5b ships SESSION and removes the "Acting as" selector, the fixtures and the selection
   API from the application (design Rev 1.2 + micro-addendum 1.2.1). This harness executes the
   REAL production modules (module-order.js, the boot included) in the dependency-free Node
   `vm` loader of the AFI-2 harness and proves:

     T3  the shipped SESSION runtime: no selector, fixture or selection API is reachable;
         identity is null before /me, the server principal after a valid /me, and null — never
         a fallback — after every failed or malformed /me; the test seam is inert (a provider
         installed through it is never consulted, LOCAL readiness stays false); an unknown mode
         resolves no identity. LOCAL (development only, the constant rewritten in memory):
         without a ready development identity (none installed, an invalid principal, a throwing
         provider) nothing local boots — one fixed static notice, no loadState, no AuthBoot, no
         request; with one, the unchanged LOCAL boot order runs.
     T4  mutation self-test: seeded defects in the IN-MEMORY production source (never on disk)
         must each turn T3/T5 red with counted failures — the D-01 bypass (D01-LOAD), AuthBoot
         on the not-ready path (D01-BOOT), readiness read outside LOCAL (D01-SESSION-READ), the
         seam honoured in SESSION (H2-SEAM-IN-SESSION), a LOCAL fallback after a failed /me, an
         implicit CEO, and the selector reintroduced (H3-PRESENCE-REINTRODUCED).
     T5  local data preservation: every localStorage key/value is byte-identical before and after
         a SESSION boot, sign-in, sign-out, session expiry and server errors; loadState, persist and
         saveAllData are never called and storage is never read or written.

   Deterministic: fetch is a stub answering by URL from a script; the API timeout timer is never
   awaited. No network, no clock, no credentials: every identity, token and value is fabricated.
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
const DEV_IDENTITY = fs.readFileSync(path.join(__dirname, 'dev', 'local-identity-fixture.js'), 'utf8');
const CSRF = 'A'.repeat(21) + '_' + 'b'.repeat(21);
const RID = '0123456789abcdef0123456789abcdef';
const PASSWORD = 'fabricated-Passw0rd-afi5b';
const ME_CEO = { userId: 'u_ceo_1', membershipId: 'm_ceo_1', role: 'ceo', employeeId: null, csrfToken: CSRF };
const BOOT_SPIES = ['loadState', 'persist', 'saveAllData', 'applyTheme', 'installGlobalUIHandlers', 'maybeShowFirstRunChoice', 'renderShell'];
const ABSENT = ['renderIdentitySelectorHTML', 'bindIdentitySelector', 'syncIdentitySelector', 'identityAvailablePrincipals',
  'onIdentityPrincipalChange', 'LocalIdentityProvider', 'FIXTURE_PRINCIPALS'];
// Fabricated LOCAL data that a SESSION boot must leave byte-for-byte untouched (T5).
const LOCAL_DATA = {
  tam_finance_os_v1: JSON.stringify({ txns: [{ id: 't_fab_1', amount: 1000, desc: 'FABRICATED' }], settings: { companyName: 'SAMPLE' } }),
  tam_hr_employees_v1: JSON.stringify([{ id: 'e_fab_1', fullName: 'Fabricated Person' }]),
  tam_theme: 'dark', unrelated_key: 'keep-me'
};

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

/* ---------- runtime loader ----------
   opts.mode: 'SESSION' (shipped source unchanged), 'LOCAL' (rewritten in memory, development
   identity loaded after identity.js; render() is recorded, the business render needing a real
   DOM) or "'other'"; opts.persona: install a development persona
   before bootstrap; opts.devExtra: extra source appended after the development identity;
   opts.mutate: { 'core/x.js': (src) => src } — IN-MEMORY production mutation (T4 only). */
function loadRuntime(opts){
  const jsFiles = require(path.join(root, 'tools', 'module-order.js'));
  const parts = jsFiles.map((f) => {
    let src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
    if(opts.mutate && opts.mutate[f]){
      const m = opts.mutate[f](src);
      if(m === src) throw new Error('mutation did not apply: ' + f);
      src = m;
    }
    if(f === 'core/constants.js' && opts.mode !== 'SESSION'){
      const assigns = src.match(/const AUTH_MODE = [^;\n]+;/g) || [];
      if(assigns.length !== 1) throw new Error('expected exactly one AUTH_MODE assignment');
      src = src.replace(assigns[0], 'const AUTH_MODE = ' + (opts.mode === 'LOCAL' ? 'AUTH_MODES.LOCAL' : opts.mode) + ';');
    }
    if(f === 'core/identity.js' && opts.mode === 'LOCAL'){
      src += '\n' + DEV_IDENTITY + (opts.persona ? '\n;DevLocalIdentity.install(' + JSON.stringify(opts.persona) + ');' : '') + (opts.devExtra || '');
    }
    if(f === 'core/app-bootstrap.js'){
      src = BOOT_SPIES.concat(opts.mode === 'LOCAL' ? ['render'] : []).map((n) => n + ' = (function(orig){ return function(){ __spy.push("' + n + '"); return undefined; }; })(' + n + ');').join('\n') + '\n' + src;
    }
    return src;
  });
  const src = parts.join('\n')
    + '\n;window.__TAM__ = { State: State, AuthBoot: AuthBoot, getCurrentUser: getCurrentUser, localDevReady: localDevReady,'
    + ' setIdentityProviderForTesting: setIdentityProviderForTesting, CsrfHolder: CsrfHolder,'
    + ' absent: {' + ABSENT.map((n) => ' ' + n + ': typeof ' + n).join(',') + ' } };';
  const noop = function(){};
  const memStore = Object.assign({}, opts.storage || {});
  const access = { reads: 0, writes: 0 };
  const memStorage = {
    getItem: (k) => { access.reads++; return Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null; },
    setItem: (k, v) => { access.writes++; memStore[k] = String(v); }, removeItem: (k) => { access.writes++; delete memStore[k]; },
    key: (i) => { access.reads++; return Object.keys(memStore)[i] || null; }, get length(){ return Object.keys(memStore).length; },
    clear: () => { access.writes++; Object.keys(memStore).forEach((k) => { delete memStore[k]; }); }
  };
  const mkEl = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'', value:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, removeChild:noop, setAttribute:noop,
    getAttribute:()=>null, remove:noop, focus:noop, contains:()=>false, querySelector:()=>null, querySelectorAll:()=>[],
    classList:{ add:noop, remove:noop, toggle:noop, contains:()=>false } });
  const els = {};
  const net = { calls: [], routes: opts.routes || {} };
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
    console: { log:noop, warn:noop, error:noop, info:noop }, navigator: { userAgent:'tam-afi5b' },
    setTimeout: function(fn, ms){ if(ms === 10000) return 'api-timer'; return setTimeout(fn, ms); },
    clearTimeout: function(id){ if(id !== 'api-timer') clearTimeout(id); },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    AbortController: AbortController, fetch: fetchStub,
    localStorage: memStorage, sessionStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    location: { hash: '', pathname: '/', search: '' }, history: { replaceState: noop },
    document: { addEventListener:noop, removeEventListener:noop,
      getElementById: (id) => (els[id] = els[id] || mkEl()),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>mkEl(), contains:()=>false,
      body: mkEl(), documentElement: { dataset:{}, style:{} }, activeElement: null }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-afi5b-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.net = net; rt.memStore = memStore; rt.access = access; rt.spy = sandbox.__spy;
  rt.appHTML = () => (els.app ? els.app.innerHTML : '');
  rt.appText = () => (els.app ? els.app.textContent : '');
  return rt;
}
const flush = async (n) => { for(let i = 0; i < (n || 8); i++) await new Promise((r) => setImmediate(r)); };
const hostile = () => { const h = { calls: 0, getCurrentUser(){ h.calls++; return { id: 'user_ceo_fixture', displayName: 'Hostile', principalType: 'ceo' }; } }; return h; };

/* ---------- T3 + T5 (the suite the mutants must turn red) ---------- */
async function suite(mutate, chk){
  /* T3.1 shipped SESSION: nothing of the selector, the fixtures or the selection API exists */
  {
    const rt = loadRuntime({ mode: 'SESSION', mutate: mutate, routes: { '/api/auth/me': [err(401, 'unauthenticated')] } });
    chk(ABSENT.every((n) => rt.absent[n] === 'undefined' && rt.w[n] === undefined),
      'T3. SESSION: no selector function, LocalIdentityProvider or FIXTURE_PRINCIPALS is declared or on window');
    chk(rt.getCurrentUser() === null && rt.localDevReady() === false, 'T3. SESSION: null identity before /me; LOCAL readiness false');
    await flush();
    chk(!/identityPrincipalSelect|identity-selector|identity-rail|identity-context|Acting as/.test(rt.appHTML()) && /authSignInForm/.test(rt.appHTML()),
      'T3. SESSION /me 401: the sign-in view, and no selector markup anywhere');
  }
  /* T3.2 the seam is inert in SESSION: a hostile provider is never consulted */
  {
    const h = hostile();
    const rt = loadRuntime({ mode: 'SESSION', mutate: mutate, routes: { '/api/auth/me': [ok(ME_CEO)] } });
    rt.setIdentityProviderForTesting(h);
    chk(rt.getCurrentUser() === null && h.calls === 0 && rt.localDevReady() === false,
      'T3. H2-SEAM-IN-SESSION: before /me a seam provider is never consulted (null identity, provider never called, not ready)');
    await flush();
    const u = rt.getCurrentUser();
    chk(!!u && u.id === 'u_ceo_1' && h.calls === 0, 'T3. SESSION: after a valid /me the identity is the server principal; the seam provider is still never called');
    rt.setIdentityProviderForTesting(null);
    chk((rt.getCurrentUser() || {}).id === 'u_ceo_1', 'T3. SESSION: a seam null reset changes nothing');
  }
  /* T3.3 no fallback after any failed or malformed /me (a hostile seam provider present) */
  for(const [label, answer] of [['401', err(401, 'unauthenticated')], ['503', err(503, 'service_unavailable')],
    ['network', new TypeError('Failed to fetch')], ['malformed', ok(Object.assign({}, ME_CEO, { role: 'root' }))]]){
    const h = hostile();
    const rt = loadRuntime({ mode: 'SESSION', mutate: mutate, routes: { '/api/auth/me': [answer] } });
    rt.setIdentityProviderForTesting(h);
    await flush();
    chk(rt.getCurrentUser() === null && h.calls === 0, 'T3. SESSION /me ' + label + ': no identity and no fallback to the seam provider');
  }
  /* T3.4 an unknown mode resolves nothing */
  {
    const h = hostile();
    const rt = loadRuntime({ mode: "'other'", mutate: mutate, routes: { '/api/auth/me': [ok(ME_CEO)] } });
    rt.setIdentityProviderForTesting(h);
    await flush();
    chk(rt.getCurrentUser() === null && h.calls === 0 && rt.localDevReady() === false && rt.net.calls.length === 0,
      'T3. unknown mode: no identity, seam never consulted, not ready, no request');
  }
  /* T3.5 LOCAL (development only): not ready -> nothing boots */
  for(const [label, extra] of [['D01-ABSENT (no provider)', ''],
    ['D01-INVALID (invalid principal)', '\n;setIdentityProviderForTesting({ getCurrentUser(){ return { id: "x", principalType: "ceo" }; } });'],
    ['D01-THROW (provider throws)', '\n;setIdentityProviderForTesting({ getCurrentUser(){ throw new Error("boom"); } });'],
    ['installed alias, nobody selected', '\n;setIdentityProviderForTesting(LocalIdentityProvider);']]){
    const rt = loadRuntime({ mode: 'LOCAL', mutate: mutate, devExtra: extra, storage: LOCAL_DATA });
    await flush();
    chk(rt.spy.length === 0 && rt.net.calls.length === 0 && rt.access.reads === 0 && rt.access.writes === 0,
      'T3. LOCAL ' + label + ': no loadState/boot step, no request, no storage access');
    chk(rt.AuthBoot.snapshot().state === 'CHECKING_SESSION' && rt.appText() === 'Development identity not installed' && rt.appHTML() === '',
      'T3. LOCAL ' + label + ': AuthBoot never started; only the fixed static notice (textContent)');
    chk(rt.getCurrentUser() === null && rt.localDevReady() === false, 'T3. LOCAL ' + label + ': no identity, not ready');
  }
  /* T3.6 LOCAL ready -> the unchanged boot order */
  {
    const rt = loadRuntime({ mode: 'LOCAL', mutate: mutate, persona: 'user_employee_fixture' });
    await flush();
    chk(rt.spy.join() === 'loadState,applyTheme,installGlobalUIHandlers,render,maybeShowFirstRunChoice' && rt.net.calls.length === 0,
      'T3. LOCAL with a ready development identity: loadState -> applyTheme -> installGlobalUIHandlers -> render -> first-run choice, no request');
    chk((rt.getCurrentUser() || {}).id === 'user_employee_fixture' && rt.localDevReady() === true, 'T3. LOCAL ready: the installed persona is the identity');
  }
  /* T5 local data preservation across the whole SESSION lifecycle */
  {
    const before = JSON.stringify(LOCAL_DATA);
    const routes = {
      '/api/auth/me': [err(401, 'unauthenticated'), ok(ME_CEO), err(401, 'unauthenticated')],
      '/api/auth/login': [ok({ userId: 'u_ceo_1' })],
      '/api/auth/logout': [ok({ loggedOut: true })],
      '/api/employees': [err(503, 'service_unavailable'), err(401, 'unauthenticated')]
    };
    const rt = loadRuntime({ mode: 'SESSION', mutate: mutate, storage: LOCAL_DATA, routes: routes });
    await flush();
    const signedOut = rt.AuthBoot.snapshot().state === 'SIGNED_OUT';
    await rt.AuthBoot.signIn('ceo@example.invalid', PASSWORD); await flush();
    const signedIn = rt.AuthBoot.snapshot().state === 'AUTHENTICATED';
    await rt.AuthBoot.signOut(); await flush();
    const out = rt.AuthBoot.snapshot().state === 'SIGNED_OUT';
    rt.net.routes['/api/auth/me'] = [ok(ME_CEO)];
    await rt.AuthBoot.retry(); await flush();                               // re-authenticate, then the session expires
    rt.AuthBoot.sessionLost(); await flush();
    chk(signedOut && signedIn && out, 'T5. the lifecycle ran: signed out -> signed in -> signed out -> expired');
    chk(JSON.stringify(rt.memStore) === before, 'T5. every localStorage key/value is byte-identical after boot, sign-in, sign-out, expiry and server errors');
    chk(rt.access.reads === 0 && rt.access.writes === 0, 'T5. SESSION never reads or writes storage (no access at all)');
    chk(['loadState', 'persist', 'saveAllData'].every((n) => rt.spy.indexOf(n) === -1), 'T5. loadState, persist and saveAllData are never called');
  }
}

(async function main(){
  console.log('== AFI-5b IDENTITY TRANSITION — RUNTIME VERIFICATION ==');
  console.log('   T3 shipped SESSION + LOCAL readiness / T4 mutation self-test / T5 local data preservation.');
  console.log('');
  try { await suite(null, check); }
  catch(e){ check(false, 'harness error: ' + (e && e.stack || e)); }

  console.log('');
  console.log('-- T4. mutation self-test (each mutant must be caught with counted failures) --');
  const MUTANTS = [
    ['D01-LOAD: the readiness guard bypassed', { 'core/app-bootstrap.js': (s) => s.replace('if(!localDevReady()){', 'if(false){') }],
    ['D01-BOOT: AuthBoot started on the not-ready path', { 'core/app-bootstrap.js': (s) => s.replace("      return;\n    }\n    await loadState();", "      AuthBoot.start();\n      return;\n    }\n    await loadState();") }],
    ['D01-SESSION-READ: readiness consults the seam outside LOCAL', { 'core/identity.js': (s) => s.replace('  if(AUTH_MODE !== AUTH_MODES.LOCAL) return false;\n', '') }],
    ['H2-SEAM-IN-SESSION: the seam honoured in every mode', { 'core/identity.js': (s) => s.replace('getCurrentUser(){ return modeIdentityProvider().getCurrentUser(); }',
      'getCurrentUser(){ return (testIdentityProvider || modeIdentityProvider()).getCurrentUser(); }') }],
    ['LOCAL fallback after a failed /me', { 'core/identity.js': (s) => s.replace('getCurrentUser(){ return modeIdentityProvider().getCurrentUser(); }',
      'getCurrentUser(){ return modeIdentityProvider().getCurrentUser() || (testIdentityProvider ? testIdentityProvider.getCurrentUser() : null); }') }],
    ['implicit CEO when no development identity is installed', { 'core/identity.js': (s) => s.replace('return testIdentityProvider || NO_IDENTITY_PROVIDER;',
      "return testIdentityProvider || { getCurrentUser(){ return { id: 'user_ceo_fixture', displayName: 'Executive (CEO)', principalType: 'ceo' }; } };") }],
    ['H3-PRESENCE-REINTRODUCED: an uncalled selector function in the shell', { 'ui/shell-render.js': (s) => s + '\nfunction renderIdentitySelectorHTML(){ return ""; }\n' }],
    ['H3-PRESENCE-REINTRODUCED: a fixture alias on window', { 'core/identity.js': (s) => s + '\nwindow.LocalIdentityProvider = NO_IDENTITY_PROVIDER;\n' }],
    ['T5: a SESSION boot reads local data', { 'core/app-bootstrap.js': (s) => s.replace('  AuthBoot.start();\n})();', "  try { localStorage.getItem('tam_finance_os_v1'); } catch(_e){}\n  AuthBoot.start();\n})();") }]
  ];
  for(const m of MUTANTS){
    const red = [];
    try { await suite(m[1], function(c, label){ if(!c) red.push(label); }); }
    catch(e){ red.push('threw: ' + (e && e.message)); }
    const counted = red.filter((l) => !/^threw:/.test(l));
    check(counted.length > 0, 'T4. ' + m[0] + ' — caught (' + counted.length + ' counted failing check' + (counted.length === 1 ? '' : 's')
      + (red.length !== counted.length ? ', plus a thrown error' : '') + ')');
  }

  console.log('');
  if(failures.length){
    console.log('AFI-5b IDENTITY TRANSITION RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('AFI-5b IDENTITY TRANSITION RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
