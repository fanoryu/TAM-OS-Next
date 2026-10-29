#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-006A — IDENTITY FOUNDATION RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of the identity foundation. This
   harness proves its BEHAVIOUR by executing the real production module
   (js/core/identity.js) through the same dependency-free Node `vm` loader used
   by js/cli/cli.js and the SPR-077..095 harnesses: it concatenates the modules
   in module-order.js MINUS core/app-bootstrap.js (the only DOM-executing
   load-time module) and runs them against an in-memory window/localStorage.

   SCOPE — IDENTITY ONLY (UX-006A). It proves: the User contract; canonical
   IdentityProvider.getCurrentUser() semantics; the LOCAL adapter's
   enumeration/selection; fail-closed null behaviour; and the REFERENTIAL
   BOUNDARY — that an Employee identity object is valid with NO State.employees
   record present and WITHOUT calling empById. Nothing is written to disk; no
   production module is mocked or reimplemented. All fixtures are fabricated.

   AFI-5b (design Rev 1.2 §3, Rev 1.2.1 R-1): the shipped AUTH_MODE is SESSION and
   the application ships no fixtures. A LOCAL runtime here rewrites the one AUTH_MODE
   assignment to LOCAL in memory, loads the development identity
   (tools/dev/local-identity-fixture.js) right after identity.js and installs its
   LocalIdentityProvider alias through the test seam — the adapter checked below is
   that alias. A SESSION runtime loads the shipped source unchanged and proves the
   production identity has no fixture or selection API and that the seam is inert.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

/* ---------- runtime loader (same technique as the SPR harnesses) ----------
   mode 'local' (default): LOCAL rewrite + development identity + one alias install.
   mode 'local-uninstalled': LOCAL rewrite + development identity, NO install.
   mode 'session': the shipped source unchanged (SESSION), no development file.
   mode 'other': the one assignment rewritten to an unknown mode. */
const DEV_IDENTITY = fs.readFileSync(path.join(__dirname, 'dev', 'local-identity-fixture.js'), 'utf8');
function loadRuntime(mode){
  mode = mode || 'local';
  const local = mode === 'local' || mode === 'local-uninstalled';
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => {
      let s = fs.readFileSync(path.join(root,'js',f),'utf8');
      if(f === 'core/constants.js' && mode !== 'session'){
        const assigns = s.match(/const AUTH_MODE = [^;\n]+;/g) || [];
        if(assigns.length !== 1) throw new Error('expected exactly one AUTH_MODE assignment');
        s = s.replace(assigns[0], local ? 'const AUTH_MODE = AUTH_MODES.LOCAL;' : "const AUTH_MODE = 'other';");
      }
      return (f === 'core/identity.js' && local) ? s + '\n' + DEV_IDENTITY : s;
    }).join('\n')
    + (mode === 'local' ? '\n;setIdentityProviderForTesting(LocalIdentityProvider);' : '')
    // The export runs in the SAME lexical script scope as identity.js, so it can
    // reach the internal, production-private test seam setIdentityProviderForTesting.
    + '\n;window.__TAM__ = { State: State, PRINCIPAL_TYPES: PRINCIPAL_TYPES,'
    + ' IdentityProvider: IdentityProvider,'
    + (local ? ' LocalIdentityProvider: LocalIdentityProvider,' : '')
    + ' getCurrentUser: getCurrentUser, isValidUser: isValidUser, localDevReady: localDevReady,'
    + ' setIdentityProviderForTesting: setIdentityProviderForTesting,'
    + ' names: { LocalIdentityProvider: typeof LocalIdentityProvider, FIXTURE_PRINCIPALS: typeof FIXTURE_PRINCIPALS, cloneUser: typeof cloneUser } };';
  const noop = function(){};
  const memStore = {};
  const memStorage = {
    getItem: (k)=> Object.prototype.hasOwnProperty.call(memStore,k) ? memStore[k] : null,
    setItem: (k,v)=>{ memStore[k] = String(v); },
    removeItem: (k)=>{ delete memStore[k]; }
  };
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const sandbox = {
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-ux006a' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-ux006a-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.memStore = memStore;
  return rt;
}

// Fresh runtime per scenario group so selection state never leaks between them.
function fresh(mode){ return loadRuntime(mode); }

(function main(){
  console.log('== UX-006A IDENTITY FOUNDATION — RUNTIME VERIFICATION ==');
  console.log('   User contract / canonical IdentityProvider / LocalIdentityProvider /');
  console.log('   getCurrentUser fail-closed / referential boundary. Identity only.');
  console.log('');

  /* ---------- 1. User contract validation ---------- */
  const c = fresh();
  const CEO = { id:'u_ceo', displayName:'CEO', principalType:'ceo' };
  const EMP = { id:'u_emp', displayName:'Emp', principalType:'employee', employeeId:'emp_x' };
  check(c.isValidUser(CEO) === true, 'contract: valid CEO accepted (no employeeId required)');
  check(c.isValidUser(EMP) === true, 'contract: valid Employee accepted (non-empty employeeId)');
  check(c.isValidUser({ id:'u', displayName:'X', principalType:'employee' }) === false, 'contract: Employee without employeeId rejected');
  check(c.isValidUser({ id:'u', displayName:'X', principalType:'employee', employeeId:'' }) === false, 'contract: Employee with empty employeeId rejected');
  // AFI-1 — this expectation was "CEO with stray employeeId rejected". The backend
  // Principal (server/src/Identity/Principal.php) permits a CEO membership to carry an
  // employee binding (SDR-0002 §6, User != Employee), so rejecting it here would turn a
  // valid server identity into "no principal". A CEO binding is now accepted when it is
  // absent, null or a non-empty string; an empty or non-string binding is still rejected.
  check(c.isValidUser({ id:'u', displayName:'X', principalType:'ceo', employeeId:'e' }) === true, 'contract: CEO with a server employee binding (non-empty string) accepted');
  check(c.isValidUser({ id:'u', displayName:'X', principalType:'ceo', employeeId:null }) === true, 'contract: CEO with a null employee binding accepted');
  check(c.isValidUser({ id:'u', displayName:'X', principalType:'ceo', employeeId:'' }) === false, 'contract: CEO with an empty employee binding rejected');
  check(c.isValidUser({ id:'u', displayName:'X', principalType:'ceo', employeeId:42 }) === false, 'contract: CEO with a non-string employee binding rejected');
  check(c.isValidUser({ id:'u', displayName:'X', principalType:'employee', employeeId:null }) === false, 'contract: Employee with a null employeeId rejected');
  check(c.isValidUser({ id:'', displayName:'X', principalType:'ceo' }) === false, 'contract: empty id rejected');
  check(c.isValidUser({ id:'u', displayName:'', principalType:'ceo' }) === false, 'contract: empty displayName rejected');
  check(c.isValidUser({ id:'u', displayName:'X', principalType:'root' }) === false, 'contract: unknown principalType rejected');
  check(c.isValidUser(null) === false && c.isValidUser(undefined) === false, 'contract: null/undefined rejected');
  check(c.isValidUser('not-an-object') === false && c.isValidUser(42) === false, 'contract: malformed primitive rejected');
  check(c.PRINCIPAL_TYPES.CEO === 'ceo' && c.PRINCIPAL_TYPES.EMPLOYEE === 'employee', 'contract: PRINCIPAL_TYPES are the canonical literals');

  /* ---------- 2. representative principals present ---------- */
  const p = fresh();
  const avail = p.LocalIdentityProvider.getAvailablePrincipals();
  check(Array.isArray(avail) && avail.length === 2, 'principals: exactly two representative principals');
  check(avail.some(u=>u.principalType==='ceo') && avail.some(u=>u.principalType==='employee'), 'principals: both CEO and Employee represented');
  const empFix = avail.find(u=>u.principalType==='employee');
  check(!!empFix && typeof empFix.employeeId==='string' && empFix.employeeId.length>0, 'principals: Employee fixture carries a non-empty opaque employeeId');
  const ceoFix = avail.find(u=>u.principalType==='ceo');
  check(!!ceoFix && !('employeeId' in ceoFix), 'principals: CEO fixture has no employeeId');

  /* ---------- 3. canonical seam: getCurrentUser fail-closed ---------- */
  const s = fresh();
  check(s.IdentityProvider.getCurrentUser() === null, 'canonical: no principal selected -> null (no default CEO)');
  check(s.getCurrentUser() === null, 'canonical: getCurrentUser() facade returns null when unresolved');
  check(typeof s.IdentityProvider.getCurrentUser === 'function', 'canonical: IdentityProvider exposes getCurrentUser');
  check(s.IdentityProvider.getAvailablePrincipals === undefined && s.IdentityProvider.selectPrincipal === undefined,
    'canonical: IdentityProvider does NOT expose enumeration/selection (local-only)');

  /* ---------- 4. local adapter selection ---------- */
  const l = fresh();
  const gotCeo = l.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  check(!!gotCeo && gotCeo.principalType==='ceo', 'local: CEO can be selected');
  check(l.getCurrentUser() && l.getCurrentUser().principalType==='ceo', 'local: getCurrentUser() reflects selected CEO');
  const gotEmp = l.LocalIdentityProvider.selectPrincipal('user_employee_fixture');
  check(!!gotEmp && gotEmp.principalType==='employee' && !!gotEmp.employeeId, 'local: Employee can be selected (carries employeeId)');
  check(l.getCurrentUser().principalType==='employee', 'local: getCurrentUser() reflects selected Employee');
  // Unknown-id semantics: the METHOD returns null (no fabrication), AND the
  // CURRENT principal is left unchanged — it is a safe no-op miss, never a
  // switch to a privileged principal.
  const miss = l.LocalIdentityProvider.selectPrincipal('does_not_exist');
  check(miss === null, 'local: unknown-id selectPrincipal RETURN VALUE is null (no fabricated principal)');
  const afterMiss = l.getCurrentUser();
  check(!!afterMiss && afterMiss.principalType==='employee',
    'local: unknown-id selection leaves CURRENT principal unchanged (still Employee; never a privileged fallback)');

  /* ---------- 5. selection cannot corrupt canonical fixtures ---------- */
  const m = fresh();
  const copy = m.LocalIdentityProvider.getAvailablePrincipals()[0];
  copy.displayName = 'MUTATED'; copy.principalType = 'ceo';
  const copy2 = m.LocalIdentityProvider.getAvailablePrincipals()[0];
  check(copy2.displayName !== 'MUTATED', 'immutability: enumeration returns defensive copies (fixtures uncorrupted)');

  /* ---------- 6. malformed / throwing provider fails closed ----------
     Install an ALTERNATIVE provider behind the canonical seam via the internal
     test seam (setIdentityProviderForTesting), so the facade genuinely calls the
     injected provider. Each injected provider carries a call counter, proving it
     was actually invoked — so the test would FAIL if the override were a no-op. */
  const f = fresh();
  // (a) malformed result: provider returns a partial User (missing displayName).
  let malformedCalls = 0;
  const bad = { getCurrentUser(){ malformedCalls++; return { id:'x', principalType:'ceo' /* no displayName */ }; } };
  f.setIdentityProviderForTesting(bad);
  const badResult = f.getCurrentUser();
  check(malformedCalls === 1, 'fail-closed: injected malformed provider was actually invoked (call count === 1)');
  check(badResult === null, 'fail-closed: malformed provider result -> null (re-validated, never partial identity)');
  // (b) throwing provider: facade must catch and return null.
  let throwCalls = 0;
  const thrower = { getCurrentUser(){ throwCalls++; throw new Error('boom'); } };
  f.setIdentityProviderForTesting(thrower);
  const throwResult = f.getCurrentUser();
  check(throwCalls === 1, 'fail-closed: injected throwing provider was actually invoked (call count === 1)');
  check(throwResult === null, 'fail-closed: provider error -> null (facade catches; does not throw)');
  // (c) AFI-5b R-1: null CLEARS the override — LOCAL has no built-in provider, so
  // nothing is restored; explicitly reinstalling the alias resolves normally again,
  // which still proves the seam is a real indirection, not a one-way break.
  f.setIdentityProviderForTesting(null);            // null clears the override; LOCAL has no installed provider
  f.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  check(f.getCurrentUser() === null && f.localDevReady() === false,
    'fail-closed: null clears the override — LOCAL has no installed provider (null identity, not ready)');
  f.setIdentityProviderForTesting(f.LocalIdentityProvider);
  const restored = f.getCurrentUser();
  check(!!restored && restored.principalType === 'ceo',
    'fail-closed: explicitly reinstalling the alias resolves normally (indirection is real)');

  /* ---------- 7. REFERENTIAL BOUNDARY: valid with empty State.employees ---------- */
  const r = fresh();
  r.State.employees = [];              // no business records at all
  r.LocalIdentityProvider.selectPrincipal('user_employee_fixture');
  const eu = r.getCurrentUser();
  check(!!eu && eu.principalType==='employee' && eu.employeeId==='emp_fixture_self',
    'referential: Employee identity valid with State.employees === [] (no empById, no record required)');
  check(r.State.employees.length === 0, 'referential: no Employee record was created to satisfy validation');

  /* ---------- 8. AFI-5b R-1: null reset and explicit reinstall (LOCAL) ---------- */
  const z = fresh();
  check(z.getCurrentUser() === null && z.localDevReady() === false,
    'R1: a fresh LOCAL runtime with the alias installed but nobody selected -> null, not ready');
  z.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  check(!!z.getCurrentUser() && z.getCurrentUser().principalType === 'ceo' && z.localDevReady() === true,
    'R1: installed alias + CEO selected -> canonical CEO, ready');
  z.setIdentityProviderForTesting(null);
  check(z.getCurrentUser() === null && z.localDevReady() === false,
    'R1-NULL-RESET: null reset -> canonical null and not ready (no automatic alias fallback)');
  const det = z.LocalIdentityProvider.selectPrincipal('user_employee_fixture');
  check(!!det && det.principalType === 'employee' && z.getCurrentUser() === null && z.localDevReady() === false,
    'R1-SELECTION-NOT-INSTALL: selecting on the detached alias does not reinstall it (canonical still null, not ready)');
  z.setIdentityProviderForTesting(z.LocalIdentityProvider);
  const re = z.getCurrentUser();
  check(!!re && re.principalType === 'employee' && re.employeeId === 'emp_fixture_self' && z.localDevReady() === true,
    'R1-REINSTALL: explicit reinstall re-exposes the alias selection (Employee) and readiness is true');
  re.displayName = 'MUTATED';
  check(z.getCurrentUser().displayName !== 'MUTATED', 'R1-REINSTALL: the canonical principal is a defensive copy');
  check(z.LocalIdentityProvider.selectPrincipal('does_not_exist') === null && z.getCurrentUser().principalType === 'employee',
    'R1-REINSTALL: unknown id after reinstall returns null and keeps the selection');
  const un = fresh('local-uninstalled');
  check(un.getCurrentUser() === null && un.localDevReady() === false,
    'R1: LOCAL with the development file loaded but nothing installed -> null, not ready');
  un.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  check(un.getCurrentUser() === null && un.localDevReady() === false,
    'R1: selecting without an install changes nothing canonical (no implicit install)');

  /* ---------- 9. AFI-5b: the shipped SESSION identity (no fixture, inert seam) ---------- */
  const se = fresh('session');
  check(se.names.LocalIdentityProvider === 'undefined' && se.names.FIXTURE_PRINCIPALS === 'undefined' && se.names.cloneUser === 'undefined',
    'SESSION: production identity.js declares no LocalIdentityProvider, FIXTURE_PRINCIPALS or fixture helper');
  check(se.w.LocalIdentityProvider === undefined && se.w.FIXTURE_PRINCIPALS === undefined,
    'SESSION: nothing fixture-related is on window');
  check(se.getCurrentUser() === null && se.localDevReady() === false, 'SESSION: before /me -> null, and LOCAL readiness is false');
  let hostileCalls = 0;
  const hostile = { getCurrentUser(){ hostileCalls++; return { id:'h', displayName:'Hostile', principalType:'ceo' }; } };
  se.setIdentityProviderForTesting(hostile);
  check(se.getCurrentUser() === null && hostileCalls === 0 && se.localDevReady() === false,
    'R1-SESSION-INERT: a seam provider installed in SESSION is never consulted (null, provider never called, not ready)');
  se.setIdentityProviderForTesting(null);
  check(se.getCurrentUser() === null, 'R1-SESSION-INERT: a null reset in SESSION changes nothing');
  const ot = fresh('other');
  ot.setIdentityProviderForTesting(hostile);
  check(ot.getCurrentUser() === null && ot.localDevReady() === false && hostileCalls === 0,
    'unknown mode: null identity, not ready, and the seam is never consulted');

  /* ---------- summary ---------- */
  console.log('');
  if(failures.length){
    console.log('UX-006A IDENTITY FOUNDATION RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f=>console.log('  - ' + f));
    process.exit(1);
  }
  console.log('UX-006A IDENTITY FOUNDATION RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
