#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-006C1 — AUTHORIZATION FOUNDATION RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of the authorization foundation.
   This harness proves its BEHAVIOUR by executing the real production modules
   (js/core/authz.js on top of identity.js + workspace.js) through the same
   dependency-free Node `vm` loader used by the UX-006A/UX-006B harnesses:
   concatenate module-order.js MINUS core/app-bootstrap.js and run against an
   in-memory window/localStorage.

   SCOPE — HEADLESS (UX-006C1). It proves: the mutation-only ACTIONS vocabulary
   (no `*.read`); CEO pass-through; Employee deny-by-default with the single
   allowed `overtime.submitSelf` on an own in-scope Draft; the AZ-1 scope
   precondition; AZ-2 fail-closed; and that internal symbols (canPrincipal /
   POLICY / isInScope) are NOT part of the public surface. No live business
   mutation is exercised; all fixtures are fabricated; nothing is written to disk.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

function loadRuntime(){
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { State: State, PRINCIPAL_TYPES: PRINCIPAL_TYPES,'
    + ' LocalIdentityProvider: LocalIdentityProvider, getCurrentUser: getCurrentUser,'
    + ' ACTIONS: ACTIONS, can: can, canPrincipal: canPrincipal, POLICY: POLICY,'
    + ' isInScope: isInScope, isInScopeForPrincipal: isInScopeForPrincipal, ACTION_SET: ACTION_SET };';
  const noop = function(){};
  const memStore = {};
  const memStorage = {
    getItem: (k)=> Object.prototype.hasOwnProperty.call(memStore,k) ? memStore[k] : null,
    setItem: (k,v)=>{ memStore[k] = String(v); }, removeItem: (k)=>{ delete memStore[k]; }
  };
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const sandbox = {
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-ux006c1' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-ux006c1-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.memStore = memStore;
  return rt;
}

const SELF_EID = 'emp_fixture_self';
const OTHER_EID = 'emp_other';
function seed(rt){
  const S = rt.State;
  S.employees = [{ id:SELF_EID, employeeId:'EMP-001', fullName:'SAMPLE — Self' },
                 { id:OTHER_EID, employeeId:'EMP-002', fullName:'SAMPLE — Other' }];
  S.contracts = [{ id:'c_self', employeeId:SELF_EID }, { id:'c_other', employeeId:OTHER_EID }];
  S.payrollPlans = [{ id:'p_self', employeeId:SELF_EID }];
  S.overtimeRecords = [
    { id:'ot_self_draft', employeeId:SELF_EID, status:'Draft' },
    { id:'ot_self_submitted', employeeId:SELF_EID, status:'Submitted' },
    { id:'ot_other_draft', employeeId:OTHER_EID, status:'Draft' }
  ];
  return S;
}
function asCeo(rt){ rt.LocalIdentityProvider.selectPrincipal('user_ceo_fixture'); return rt; }
function asEmp(rt){ rt.LocalIdentityProvider.selectPrincipal('user_employee_fixture'); return rt; }
function fresh(){ const rt = loadRuntime(); seed(rt); return rt; }

const COMPANY_ACTIONS = ['employee.create','employee.update','employee.delete','contract.create',
  'contract.update','contract.delete','payroll.manage','overtime.manage','finance.execute',
  'finance.manage','import.commit','supplemental.manage','settings.manage',
  // UX-006C2C-3 — the three destructive/lifecycle capabilities (CEO-only, resource-free).
  'import.undo','data.restore','data.reset'];

(function main(){
  console.log('== UX-006C1 AUTHORIZATION FOUNDATION — RUNTIME VERIFICATION ==');
  console.log('   Mutation-only ACTIONS / CEO pass-through / Employee deny-by-default /');
  console.log('   overtime.submitSelf / AZ-1 scope precondition / AZ-2 fail-closed. Headless.');
  console.log('');

  /* ---------- 1. ACTIONS vocabulary — mutation-only, no reads ---------- */
  const a = fresh();
  const actionValues = a.ACTION_SET;
  check(actionValues.length === 20, 'ACTIONS: exactly the 20 mutation actions (13 + C2B self-Draft trio + C2C-2 finance.manage + C2C-3 import.undo/data.restore/data.reset)');
  check(!actionValues.some(function(x){ return /\.read(\.|$)/.test(x); }), 'ACTIONS: contains NO *.read / *.read.self action');
  ['employee.create','employee.update','employee.delete','contract.create','contract.update','contract.delete',
   'payroll.manage','overtime.submitSelf','overtime.createSelfDraft','overtime.updateSelfDraft','overtime.deleteSelfDraft',
   'overtime.manage','finance.execute','finance.manage','import.commit','supplemental.manage',
   'settings.manage','import.undo','data.restore','data.reset'].forEach(function(act){
     check(actionValues.indexOf(act) !== -1, 'ACTIONS: includes ' + act);
   });

  /* ---------- 2. CEO pass-through ---------- */
  const ceo = asCeo(fresh());
  COMPANY_ACTIONS.forEach(function(act){
    // resource-bearing company actions get an in-scope company record; system actions omit it.
    var res = act.indexOf('employee.')===0 ? {id:SELF_EID}
            : act.indexOf('contract.')===0 ? {id:'c_self',employeeId:SELF_EID}
            : act==='payroll.manage' ? {id:'p_self',employeeId:SELF_EID}
            : act==='overtime.manage' ? {id:'ot_self_draft',employeeId:SELF_EID,status:'Draft'}
            : undefined;
    check(ceo.can(act, res) === true, 'CEO: allowed ' + act);
  });
  check(ceo.can('overtime.submitSelf', {id:'ot_self_draft',employeeId:SELF_EID,status:'Draft'}) === true,
    'CEO: overtime.submitSelf allowed (company overtime management)');

  /* ---------- 3. Employee deny-by-default for all company actions ---------- */
  const emp = asEmp(fresh());
  COMPANY_ACTIONS.forEach(function(act){
    var res = act.indexOf('employee.')===0 ? {id:SELF_EID}
            : act.indexOf('contract.')===0 ? {id:'c_self',employeeId:SELF_EID}
            : act==='payroll.manage' ? {id:'p_self',employeeId:SELF_EID}
            : act==='overtime.manage' ? {id:'ot_self_draft',employeeId:SELF_EID,status:'Draft'}
            : undefined;
    check(emp.can(act, res) === false, 'Employee: denied ' + act);
  });

  /* ---------- 4. overtime.submitSelf — the one allowed employee mutation ---------- */
  check(emp.can('overtime.submitSelf', {id:'ot_self_draft',employeeId:SELF_EID,status:'Draft'}) === true,
    'Employee: overtime.submitSelf allowed on OWN in-scope Draft');
  check(emp.can('overtime.submitSelf', {id:'ot_self_submitted',employeeId:SELF_EID,status:'Submitted'}) === false,
    'Employee: overtime.submitSelf DENIED on own non-Draft (Submitted)');
  check(emp.can('overtime.submitSelf', {id:'ot_other_draft',employeeId:OTHER_EID,status:'Draft'}) === false,
    'Employee: overtime.submitSelf DENIED on ANOTHER employee\'s Draft (out of scope)');
  check(emp.can('overtime.submitSelf', undefined) === false,
    'Employee: overtime.submitSelf DENIED with no resource');

  /* ---------- 4b. UX-006C2B — Employee self-Draft trio (create/update/delete) ---------- */
  ['overtime.createSelfDraft','overtime.updateSelfDraft','overtime.deleteSelfDraft'].forEach(function(act){
    check(ceo.can(act, {id:'ot',employeeId:SELF_EID,status:'Draft'}) === true, 'CEO: ' + act + ' allowed (pass-through)');
    check(ceo.can(act, {id:'ot',employeeId:OTHER_EID,status:'Approved'}) === true, 'CEO: ' + act + ' allowed on any company record/status');
    check(emp.can(act, {id:'ot',employeeId:SELF_EID,status:'Draft'}) === true, 'Employee: ' + act + ' allowed on OWN in-scope Draft');
    check(emp.can(act, {id:'ot',employeeId:SELF_EID,status:'Submitted'}) === false, 'Employee: ' + act + ' DENIED on own non-Draft');
    check(emp.can(act, {id:'ot',employeeId:SELF_EID,status:'Approved'}) === false, 'Employee: ' + act + ' DENIED on own Approved');
    check(emp.can(act, {id:'ot',employeeId:OTHER_EID,status:'Draft'}) === false, 'Employee: ' + act + ' DENIED on ANOTHER employee\'s Draft (out of scope)');
    check(emp.can(act, undefined) === false, 'Employee: ' + act + ' DENIED with no resource');
  });

  /* ---------- 5. AZ-1 scope precondition ---------- */
  // A company action that is CEO-only is denied for employee regardless; test the
  // precondition directly on an allowed-shape action with an out-of-scope record.
  check(emp.can('overtime.submitSelf', {id:'x',employeeId:OTHER_EID,status:'Draft'}) === false,
    'AZ-1: out-of-scope resource denied even for an otherwise-allowed action');
  // CEO ALL_COMPANY: another employee's record is in scope for CEO.
  check(ceo.can('overtime.submitSelf', {id:'ot_other_draft',employeeId:OTHER_EID,status:'Draft'}) === true,
    'AZ-1: CEO ALL_COMPANY — other-employee record is in scope');
  // Employee with missing linkage -> denied.
  const badLink = asEmp(fresh()); badLink.State.employees = [];
  check(badLink.can('overtime.submitSelf', {id:'ot_self_draft',employeeId:SELF_EID,status:'Draft'}) === false,
    'AZ-1: employee with missing Employee linkage denied');

  /* ---------- 6. AZ-2 fail-closed ---------- */
  check(fresh().can('employee.delete', {id:SELF_EID}) === false, 'AZ-2: no principal selected -> deny');
  check(asCeo(fresh()).can('not.a.real.action', {}) === false, 'AZ-2: unknown action -> deny');
  check(asCeo(fresh()).can(null, {}) === false, 'AZ-2: null action -> deny');
  check(asCeo(fresh()).can('employee.update', undefined) === false, 'AZ-2: resource-bearing action with missing resource -> deny');
  check(asCeo(fresh()).can('employee.update', 42) === false, 'AZ-2: malformed (non-object) resource -> deny (no throw)');
  // An invalid principal never resolves through the frozen identity seam
  // (getCurrentUser re-validates -> null), so can() sees no principal and denies;
  // the unknown-principal branch itself is proven directly on canPrincipal (§7).

  /* ---------- 7. pure canPrincipal fail-closed ---------- */
  const p = fresh();
  const CEO_P = { id:'u_ceo', displayName:'CEO', principalType:'ceo' };
  const EMP_P = { id:'u_emp', displayName:'Emp', principalType:'employee', employeeId:SELF_EID };
  check(p.canPrincipal(null, 'employee.delete', {id:SELF_EID}) === false, 'canPrincipal: null principal -> false');
  check(p.canPrincipal({principalType:'root'}, 'employee.delete', {id:SELF_EID}) === false, 'canPrincipal: unknown principal -> false');
  check(p.canPrincipal(CEO_P, 'settings.manage') === true, 'canPrincipal: CEO settings.manage -> true');
  check(p.canPrincipal(EMP_P, 'overtime.submitSelf', {id:'ot_self_draft',employeeId:SELF_EID,status:'Draft'}) === true,
    'canPrincipal: employee submitSelf own Draft -> true (no global principal needed)');

  /* ---------- 8. public surface: ACTIONS + can only; internals absent ---------- */
  const s = fresh();
  check(typeof s.w.ACTIONS === 'object' && typeof s.w.can === 'function', 'public: ACTIONS + can exposed on window');
  check(typeof s.w.canPrincipal === 'undefined', 'public: canPrincipal NOT on window');
  check(typeof s.w.POLICY === 'undefined', 'public: POLICY NOT on window');
  check(typeof s.w.isInScope === 'undefined', 'public: isInScope NOT on window (workspace internal)');
  // Workspace public API unchanged (exactly three symbols still present).
  check(typeof s.w.WORKSPACE_TYPES === 'object' && typeof s.w.getCurrentWorkspace === 'function' && typeof s.w.getScopedRecords === 'function',
    'preservation: Workspace public API still WORKSPACE_TYPES/getCurrentWorkspace/getScopedRecords');

  /* ---------- 9. EXPLICIT-PRINCIPAL scope: canPrincipal must not depend on global currentUser ----------
     These assertions FAIL under the previous implementation (where the scope
     precondition resolved via getCurrentUser()). */
  const EMP_A = { id:'u_empA', displayName:'A', principalType:'employee', employeeId:SELF_EID };
  const OTHER_DRAFT = { id:'ot_other_draft', employeeId:OTHER_EID, status:'Draft' };
  const OWN_DRAFT   = { id:'ot_self_draft',  employeeId:SELF_EID,  status:'Draft' };

  // (a) global currentUser = CEO, explicit Employee A, resource = Employee B's Draft -> DENY.
  const g1 = asCeo(fresh());
  check(g1.canPrincipal(EMP_A, 'overtime.submitSelf', OTHER_DRAFT) === false,
    'explicit-principal: global CEO + explicit EmployeeA on EmployeeB Draft -> false (not CEO ALL_COMPANY)');
  // (a2) same global CEO, explicit Employee A on OWN Draft -> ALLOW.
  check(g1.canPrincipal(EMP_A, 'overtime.submitSelf', OWN_DRAFT) === true,
    'explicit-principal: global CEO + explicit EmployeeA on own Draft -> true');

  // (b) global currentUser = Employee, explicit CEO, resource = another Employee's record -> ALLOW (CEO ALL_COMPANY).
  const g2 = asEmp(fresh());
  check(g2.canPrincipal(CEO_P, 'employee.delete', {id:OTHER_EID}) === true,
    'explicit-principal: global Employee + explicit CEO on other-employee record -> true (CEO ALL_COMPANY, not restricted by global SELF)');

  // (c) NO global principal selected: canPrincipal decides purely from the supplied principal.
  const g3 = fresh(); // nothing selected -> getCurrentUser() === null
  check(g3.canPrincipal(CEO_P, 'employee.delete', {id:OTHER_EID}) === true,
    'explicit-principal: no global principal + explicit CEO -> true (independent of selection)');
  check(g3.canPrincipal(EMP_A, 'overtime.submitSelf', OWN_DRAFT) === true,
    'explicit-principal: no global principal + explicit EmployeeA own Draft -> true');
  check(g3.canPrincipal(EMP_A, 'overtime.submitSelf', OTHER_DRAFT) === false,
    'explicit-principal: no global principal + explicit EmployeeA on other Draft -> false');

  // (d) the explicit-principal scope helper itself does not depend on global selection.
  check(g1.isInScopeForPrincipal(EMP_A, 'overtime', OTHER_DRAFT) === false
     && g2.isInScopeForPrincipal(CEO_P, 'employee', {id:OTHER_EID}) === true,
    'explicit-principal: isInScopeForPrincipal uses the supplied principal, not getCurrentUser');

  console.log('');
  if(failures.length){
    console.log('UX-006C1 AUTHORIZATION FOUNDATION RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f=>console.log('  - ' + f));
    process.exit(1);
  }
  console.log('UX-006C1 AUTHORIZATION FOUNDATION RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
