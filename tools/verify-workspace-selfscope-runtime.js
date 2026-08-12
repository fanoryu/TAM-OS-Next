#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-006B — PERSONAL WORKSPACE & SELF-SCOPE RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of the workspace/scope foundation.
   This harness proves its BEHAVIOUR by executing the real production module
   (js/core/workspace.js, on top of js/core/identity.js) through the same
   dependency-free Node `vm` loader used by the SPR-077..095 and UX-006A
   harnesses: it concatenates module-order.js MINUS core/app-bootstrap.js and
   runs against an in-memory window/localStorage.

   SCOPE — HEADLESS FOUNDATION (owner amendment R1). It proves: identity->Employee
   binding (User.employeeId === Employee.id, never the human Employee.employeeId);
   derived Executive/Personal workspaces; getScopedRecords() SELF/ALL_COMPANY/
   fail-closed semantics per entity; and NO escalation of an invalid/absent
   principal to Executive/ALL_COMPANY. No live Global Search integration is
   exercised because GS is intentionally untouched in UX-006B. All fixtures are
   fabricated; nothing is written to disk; no production module is mocked.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

/* ---------- runtime loader ---------- */
function loadRuntime(){
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { State: State, PRINCIPAL_TYPES: PRINCIPAL_TYPES,'
    + ' LocalIdentityProvider: LocalIdentityProvider, getCurrentUser: getCurrentUser,'
    + ' setIdentityProviderForTesting: setIdentityProviderForTesting,'
    + ' WORKSPACE_TYPES: WORKSPACE_TYPES, getCurrentWorkspace: getCurrentWorkspace,'
    + ' getScopedRecords: getScopedRecords, getBoundEmployee: getBoundEmployee,'
    + ' getScopeContext: getScopeContext, ENTITY_SCOPE: ENTITY_SCOPE, empById: empById };';
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
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-ux006b' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-ux006b-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.memStore = memStore;
  return rt;
}

// The identity fixture the module ships. self = the bound employee, other = a
// second employee whose records must be filtered out of the SELF view.
const SELF_EID = 'emp_fixture_self';
const OTHER_EID = 'emp_other';

// Seed fabricated multi-employee business data keyed by Employee.id.
function seed(rt){
  const S = rt.State;
  S.employees = [
    { id: SELF_EID,  employeeId: 'EMP-001', fullName: 'SAMPLE — Self'  },
    { id: OTHER_EID, employeeId: 'EMP-002', fullName: 'SAMPLE — Other' }
  ];
  S.contracts = [
    { id:'c_self',  employeeId: SELF_EID,  contractNumber:'C/1' },
    { id:'c_other', employeeId: OTHER_EID, contractNumber:'C/2' }
  ];
  S.payrollPlans = [
    { id:'p_self',  employeeId: SELF_EID,  monthKey:'2026-01' },
    { id:'p_other', employeeId: OTHER_EID, monthKey:'2026-01' }
  ];
  S.overtimeRecords = [
    { id:'o_self',  employeeId: SELF_EID,  overtimeHours:3 },
    { id:'o_other', employeeId: OTHER_EID, overtimeHours:5 }
  ];
  return S;
}
function fresh(){ const rt = loadRuntime(); seed(rt); return rt; }
const ids = (arr)=> arr.map(r=>r.id).sort();

(function main(){
  console.log('== UX-006B PERSONAL WORKSPACE & SELF-SCOPE — RUNTIME VERIFICATION ==');
  console.log('   Employee binding / derived workspaces / getScopedRecords / no escalation.');
  console.log('   Headless (Global Search intentionally untouched in UX-006B).');
  console.log('');

  /* ---------- 1. Employee binding ---------- */
  const b = fresh();
  b.LocalIdentityProvider.selectPrincipal('user_employee_fixture');
  const bound = b.getBoundEmployee();
  check(!!bound && bound.id === SELF_EID, 'binding: employee principal binds via User.employeeId === Employee.id');
  check(!!bound && bound.employeeId === 'EMP-001', 'binding: bound record carries the human code but linkage did NOT use it');
  // Prove the linkage is by Employee.id, not the human Employee.employeeId code:
  const byHuman = b.empById('EMP-001');
  check(byHuman === undefined, 'binding: empById(humanCode) does not resolve — human code is not the identity key');
  // CEO has no employee binding.
  const c0 = fresh(); c0.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  check(c0.getBoundEmployee() === null, 'binding: CEO principal has no bound employee');
  // No principal -> no binding.
  const n0 = fresh();
  check(n0.getBoundEmployee() === null, 'binding: no principal -> no bound employee');
  // Missing Employee record -> fail closed.
  const m0 = fresh(); m0.State.employees = []; m0.LocalIdentityProvider.selectPrincipal('user_employee_fixture');
  check(m0.getBoundEmployee() === null, 'binding: employee principal + missing Employee record -> null (fail closed)');

  /* ---------- 2. Workspace derivation ---------- */
  const ce = fresh(); ce.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  const ews = ce.getCurrentWorkspace();
  check(!!ews && ews.type==='executive' && ews.scope==='ALL_COMPANY', 'workspace: CEO -> Executive / ALL_COMPANY');
  check(!!ews && ews.id==='workspace:executive:company' && ews.ownerRef.kind==='system', 'workspace: Executive id deterministic + system-owned (not CEO-owned)');
  const em = fresh(); em.LocalIdentityProvider.selectPrincipal('user_employee_fixture');
  const pws = em.getCurrentWorkspace();
  check(!!pws && pws.type==='personal' && pws.scope==='SELF', 'workspace: Employee -> Personal / SELF');
  check(!!pws && pws.id==='workspace:personal:'+SELF_EID && pws.ownerRef.kind==='employee' && pws.ownerRef.employeeId===SELF_EID,
    'workspace: Personal id deterministic (workspace:personal:<Employee.id>) + owned by Employee.id');
  // determinism across calls
  check(em.getCurrentWorkspace().id === pws.id, 'workspace: Personal workspace is deterministic across calls');
  // invalid linkage -> null, NO escalation
  const mi = fresh(); mi.State.employees = []; mi.LocalIdentityProvider.selectPrincipal('user_employee_fixture');
  check(mi.getCurrentWorkspace() === null, 'workspace: employee with missing linkage -> null (no Executive escalation)');
  // no principal -> null
  check(fresh().getCurrentWorkspace() === null, 'workspace: no principal -> null workspace');

  /* ---------- 3. WORKSPACE_TYPES ---------- */
  const t = fresh();
  check(t.WORKSPACE_TYPES.EXECUTIVE==='executive' && t.WORKSPACE_TYPES.PERSONAL==='personal', 'types: WORKSPACE_TYPES = executive/personal');

  /* ---------- 4. getScopedRecords — CEO sees full datasets ---------- */
  const ceo = fresh(); ceo.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  ['employee','contract','payrollPlan','overtime'].forEach(function(et){
    check(ceo.getScopedRecords(et).length === 2, 'scope(CEO): '+et+' returns full company dataset (2)');
  });

  /* ---------- 5. getScopedRecords — Employee sees SELF only ---------- */
  const emp = fresh(); emp.LocalIdentityProvider.selectPrincipal('user_employee_fixture');
  check(ids(emp.getScopedRecords('employee')).join()   === [SELF_EID].join(),  'scope(Employee): employee -> self record only');
  check(ids(emp.getScopedRecords('contract')).join()   === ['c_self'].join(),  'scope(Employee): contract -> own only (other filtered)');
  check(ids(emp.getScopedRecords('payrollPlan')).join() === ['p_self'].join(),  'scope(Employee): payrollPlan -> own only (other filtered)');
  check(ids(emp.getScopedRecords('overtime')).join()    === ['o_self'].join(),  'scope(Employee): overtime -> own only (other filtered)');

  /* ---------- 6. getScopedRecords — fail-closed ---------- */
  const noU = fresh();
  check(noU.getScopedRecords('employee').length === 0, 'scope(no user): empty (fail closed)');
  const badLink = fresh(); badLink.State.employees = [{id:OTHER_EID,employeeId:'EMP-002',fullName:'x'}]; badLink.LocalIdentityProvider.selectPrincipal('user_employee_fixture');
  check(badLink.getScopedRecords('contract').length === 0, 'scope(invalid linkage): empty (fail closed, no full-company fallback)');
  check(emp.getScopedRecords('unknownEntity').length === 0, 'scope(unknown entity type): empty (fail closed)');
  // returned array is a copy (caller cannot mutate the underlying collection)
  const cp = ceo.getScopedRecords('employee'); cp.push({id:'x'});
  check(ceo.State.employees.length === 2, 'scope: returned array is a copy (underlying collection not mutated)');

  /* ---------- 7. NO ESCALATION (explicit) ---------- */
  const esc = fresh(); esc.State.employees = []; esc.LocalIdentityProvider.selectPrincipal('user_employee_fixture');
  const w = esc.getCurrentWorkspace();
  check(w === null, 'no-escalation: invalid employee never receives a workspace');
  check(esc.getScopedRecords('contract').length === 0 && esc.getScopedRecords('payrollPlan').length === 0,
    'no-escalation: invalid employee never receives ALL_COMPANY records');
  // scope context internal shape
  const ctx = emp.getScopeContext();
  check(!!ctx && ctx.workspace && ctx.workspace.scope==='SELF' && ctx.employee && ctx.employee.id===SELF_EID,
    'context: getScopeContext derives {workspace, principal, employee} (internal)');

  /* ---------- 8. ENTITY_SCOPE centralization ---------- */
  const es = fresh();
  /* Readiness-1 extended this set from four to six. The invariant this check exists to
     protect is NOT the number — it is that every supported entity carries an EXPLICIT
     SELF predicate, so a new entity type can never inherit a silent `record.employeeId`
     default. Both additions (payrollAdjustment, transaction) declare their own
     predicate over an ownership field the domain already carries, so the invariant
     holds; the pin is updated deliberately and the predicate requirement is now
     asserted directly rather than implied by the count. */
  check(Object.keys(es.ENTITY_SCOPE).sort().join() === ['contract','employee','overtime','payrollAdjustment','payrollPlan','transaction'].join(),
    'ENTITY_SCOPE: exactly the six supported entities (Readiness-1 added payrollAdjustment + transaction)');
  check(Object.keys(es.ENTITY_SCOPE).every(function(k){
      const e = es.ENTITY_SCOPE[k];
      return e && typeof e.collection === 'function' && typeof e.self === 'function';
    }),
    'ENTITY_SCOPE: every entity declares an explicit collection AND self predicate (no silent default)');
  check(es.ENTITY_SCOPE.employee.self({id:SELF_EID}, SELF_EID) === true
     && es.ENTITY_SCOPE.contract.self({employeeId:SELF_EID}, SELF_EID) === true,
    'ENTITY_SCOPE: employee keys on record.id; contract keys on record.employeeId (entity-specific, not blind)');

  /* ---------- summary ---------- */
  console.log('');
  if(failures.length){
    console.log('UX-006B WORKSPACE & SELF-SCOPE RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f=>console.log('  - ' + f));
    process.exit(1);
  }
  console.log('UX-006B WORKSPACE & SELF-SCOPE RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
