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
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

/* ---------- runtime loader (same technique as the SPR harnesses) ---------- */
function loadRuntime(){
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    // The export runs in the SAME lexical script scope as identity.js, so it can
    // reach the internal, production-private test seam setIdentityProviderForTesting.
    + '\n;window.__TAM__ = { State: State, PRINCIPAL_TYPES: PRINCIPAL_TYPES,'
    + ' IdentityProvider: IdentityProvider, LocalIdentityProvider: LocalIdentityProvider,'
    + ' getCurrentUser: getCurrentUser, isValidUser: isValidUser, FIXTURE_PRINCIPALS: FIXTURE_PRINCIPALS,'
    + ' setIdentityProviderForTesting: setIdentityProviderForTesting };';
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
function fresh(){ return loadRuntime(); }

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
  check(c.isValidUser({ id:'u', displayName:'X', principalType:'ceo', employeeId:'e' }) === false, 'contract: CEO with stray employeeId rejected');
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
  // (c) restoring the default provider re-resolves normally — proves the seam is
  // a real indirection, not a one-way break.
  f.setIdentityProviderForTesting(null);            // null restores LocalIdentityProvider
  f.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  const restored = f.getCurrentUser();
  check(!!restored && restored.principalType === 'ceo',
    'fail-closed: restoring the default provider resolves normally (indirection is real)');

  /* ---------- 7. REFERENTIAL BOUNDARY: valid with empty State.employees ---------- */
  const r = fresh();
  r.State.employees = [];              // no business records at all
  r.LocalIdentityProvider.selectPrincipal('user_employee_fixture');
  const eu = r.getCurrentUser();
  check(!!eu && eu.principalType==='employee' && eu.employeeId==='emp_fixture_self',
    'referential: Employee identity valid with State.employees === [] (no empById, no record required)');
  check(r.State.employees.length === 0, 'referential: no Employee record was created to satisfy validation');

  /* ---------- summary ---------- */
  console.log('');
  if(failures.length){
    console.log('UX-006A IDENTITY FOUNDATION RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f=>console.log('  - ' + f));
    process.exit(1);
  }
  console.log('UX-006A IDENTITY FOUNDATION RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
