#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-006C2A — CORE HR MUTATION ENFORCEMENT — RUNTIME VERIFICATION
   ------------------------------------------------------------
   Proves the SE-0 invariant at the REAL Employee and Contract mutation
   boundaries: DENIED AUTHORIZATION ⇒ ZERO BUSINESS SIDE EFFECT (no State
   mutation, no persistence, no audit write, no success). It executes the real
   production handlers through the same dependency-free Node `vm` loader used by
   the other runtime harnesses (module-order.js MINUS core/app-bootstrap.js),
   driving identity via the real LocalIdentityProvider selection path — never a
   default/implicit CEO.

   Persistence AND audit both flow through localStorage writes (persistHR ->
   StorageAdapter; logActivity -> AUDIT_LOG_KEY), so a single write-spy
   (ctl.writes) captures both: a denied mutation must produce ZERO writes.

   Boundaries covered (real entry points):
     employees.js — setEmployeeActive, deleteEmployee, updateEmployeeContact,
                    updateEmployeeEmployment, updateEmployeeCompensation
     contracts.js — deleteContract, updateContractDates, updateContractCore
   Create/update MODAL handlers are inline DOM submit closures (not headlessly
   invocable); their guard decision (can(*.create/update)) is proven here at the
   authorization layer and end-to-end in the browser smoke. All fixtures are
   fabricated; no file is modified.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

const N = '2025-01-01T00:00:00.000Z';

function loadRuntime(){
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { State: State };';
  const noop = function(){};
  const memStore = {};
  const ctl = { writes:[] };
  const memStorage = {
    getItem: (k)=> Object.prototype.hasOwnProperty.call(memStore,k) ? memStore[k] : null,
    setItem: (k,v)=>{ ctl.writes.push(k); memStore[k] = String(v); },
    removeItem: (k)=>{ delete memStore[k]; }
  };
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const toasts = [];
  const sandbox = {
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-c2a' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-c2a-runtime.js' });
  sandbox.toast = function(m){ toasts.push(String(m)); };
  sandbox.render = noop; sandbox.closeModal = noop;
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.memStore = memStore; rt.ctl = ctl; rt.toasts = toasts;
  return rt;
}

const EMP = (o)=>Object.assign({ id:'e1', employeeId:'E1', fullName:'SAMPLE — Alpha',
  employmentStatus:'Active', active:true, monthlyBaseSalary:1000000, joinDate:'2025-01-01',
  email:'a@example.test', phone:'0', notes:'n', createdAt:N, updatedAt:N,
  history:[{event:'created', ts:N, note:'seed'}] }, o);
const CT = (o)=>Object.assign({ id:'c1', employeeId:'e1', employeeName:'SAMPLE — Alpha',
  contractNumber:'SAMPLE/1', startDate:'2025-01-01', durationMonths:36, monthlySalary:1000000,
  status:'Draft', notes:'original note', createdAt:N, updatedAt:N,
  history:[{event:'created', ts:N, note:'seed'}] }, o);

function seed(rt, opts){
  opts = opts || {};
  const S = rt.State;
  // A bound Employee for the fixture Employee principal (emp_fixture_self) so we can
  // test SELF-record denial explicitly, plus a second "other" employee/contract.
  S.employees = [ EMP({ id:'emp_fixture_self', employeeId:'SELF', fullName:'SAMPLE — Self' }),
                  EMP({ id:'e2', employeeId:'E2', fullName:'SAMPLE — Other' }) ];
  S.contracts = [ CT({ id:'c_self', employeeId:'emp_fixture_self' }),
                  CT({ id:'c_other', employeeId:'e2' }) ];
  S.overtimeRecords = []; S.monthlyPlans = []; S.txns = []; S.payrollPlans = [];
  S.payrollAdjustments = []; S.recurringExpenses = []; S.employeeMerges = [];
  S.companyAccounts = []; S.supplementalPayments = []; S.importBatches = []; S.backups = [];
  S.auditLog = S.auditLog || [];
  if(opts.principal) rt.w.LocalIdentityProvider.selectPrincipal(opts.principal);
  rt.ctl.writes.length = 0;
  return S;
}

// Run a denied mutation and assert SE-0: result denied, State unchanged, zero writes
// (persistence + audit both flow through localStorage writes).
async function assertSE0(label, principalId, invoke, expectDenied){
  const rt = loadRuntime();
  const S = seed(rt, { principal: principalId });
  const before = JSON.stringify(S);
  const writesBefore = rt.ctl.writes.length;
  const result = await invoke(rt, S);
  const after = JSON.stringify(rt.State);
  check(expectDenied(result), label + ': call is denied (no success outcome)');
  check(after === before, label + ': State is byte-identical (no mutation)');
  check(rt.ctl.writes.length - writesBefore === 0, label + ': zero persistence/audit writes');
}

// Denial predicates per boundary's own return contract (§23 — no normalization).
const deniedTyped = (r)=> !!r && r.success === false && r.error === 'NotAuthorized';
const deniedVoid  = (r)=> r === undefined;              // imperative handlers return nothing

(async function main(){
  console.log('== UX-006C2A CORE HR MUTATION ENFORCEMENT — RUNTIME VERIFICATION ==');
  console.log('   SE-0 at real Employee/Contract boundaries: denied => no State/persist/audit.');
  console.log('');

  /* ============================================================
     1. NULL PRINCIPAL — every protected boundary denies with SE-0.
        (This was the root cause of the prior C2A halt; D1 now makes an
         explicit principal reachable, so null-denies-all is correct.)
     ============================================================ */
  console.log('-- 1. currentUser === null : all Core HR mutations deny with SE-0 --');
  await assertSE0('null: employee update (contact)', null, (rt)=> rt.w.updateEmployeeContact('emp_fixture_self', { email:'x@y.z' }), deniedTyped);
  await assertSE0('null: employee update (employment)', null, (rt)=> rt.w.updateEmployeeEmployment('emp_fixture_self', { employmentStatus:'Inactive' }), deniedTyped);
  await assertSE0('null: employee update (compensation)', null, (rt)=> rt.w.updateEmployeeCompensation('emp_fixture_self', { monthlyBaseSalary:2 }), deniedTyped);
  await assertSE0('null: employee setActive', null, (rt)=> rt.w.setEmployeeActive('emp_fixture_self', false), deniedVoid);
  await assertSE0('null: employee delete', null, (rt)=> rt.w.deleteEmployee('e2'), deniedVoid);
  await assertSE0('null: contract update (dates)', null, (rt)=> rt.w.updateContractDates('c_self', { durationMonths:24 }), deniedTyped);
  await assertSE0('null: contract update (core)', null, (rt)=> rt.w.updateContractCore('c_self', { notes:'x' }), deniedTyped);
  await assertSE0('null: contract delete', null, (rt)=> rt.w.deleteContract('c_self'), deniedVoid);
  // Create authorization decision (the inline modal guard's decision) — null denied.
  (function(){ const rt=loadRuntime(); seed(rt,{principal:null});
    check(rt.w.can(rt.w.ACTIONS.EMPLOYEE_CREATE) === false, 'null: employee.create authorization denied');
    check(rt.w.can(rt.w.ACTIONS.CONTRACT_CREATE) === false, 'null: contract.create authorization denied');
  })();

  /* ============================================================
     2. EMPLOYEE PRINCIPAL — deny-by-default, including SELF records
        (Q-SELF-EDIT remains DENIED). Both own- and other-record paths.
     ============================================================ */
  console.log('-- 2. Employee principal : all Core HR mutations deny with SE-0 (incl. SELF) --');
  const EMP_P = 'user_employee_fixture';   // binds to emp_fixture_self
  await assertSE0('employee: update OWN (contact)', EMP_P, (rt)=> rt.w.updateEmployeeContact('emp_fixture_self', { email:'x@y.z' }), deniedTyped);
  await assertSE0('employee: update OTHER (contact)', EMP_P, (rt)=> rt.w.updateEmployeeContact('e2', { email:'x@y.z' }), deniedTyped);
  await assertSE0('employee: update OWN (compensation)', EMP_P, (rt)=> rt.w.updateEmployeeCompensation('emp_fixture_self', { monthlyBaseSalary:2 }), deniedTyped);
  await assertSE0('employee: setActive OWN', EMP_P, (rt)=> rt.w.setEmployeeActive('emp_fixture_self', false), deniedVoid);
  await assertSE0('employee: delete OTHER', EMP_P, (rt)=> rt.w.deleteEmployee('e2'), deniedVoid);
  await assertSE0('employee: contract update OWN-linked (core)', EMP_P, (rt)=> rt.w.updateContractCore('c_self', { notes:'x' }), deniedTyped);
  await assertSE0('employee: contract update OTHER-linked (dates)', EMP_P, (rt)=> rt.w.updateContractDates('c_other', { durationMonths:24 }), deniedTyped);
  await assertSE0('employee: contract delete OWN-linked', EMP_P, (rt)=> rt.w.deleteContract('c_self'), deniedVoid);
  (function(){ const rt=loadRuntime(); seed(rt,{principal:EMP_P});
    check(rt.w.can(rt.w.ACTIONS.EMPLOYEE_CREATE) === false, 'employee: employee.create authorization denied');
    check(rt.w.can(rt.w.ACTIONS.CONTRACT_CREATE) === false, 'employee: contract.create authorization denied');
  })();

  /* ============================================================
     3. CEO PRINCIPAL — zero regression: real mutations occur, with persistence.
     ============================================================ */
  console.log('-- 3. CEO principal : Core HR mutations succeed and persist (zero regression) --');
  const CEO_P = 'user_ceo_fixture';
  // employee contact update
  { const rt=loadRuntime(); const S=seed(rt,{principal:CEO_P}); const w=rt.ctl.writes.length;
    const r = await rt.w.updateEmployeeContact('emp_fixture_self', { email:'new@example.test' });
    check(r && r.success === true, 'CEO: employee contact update succeeds');
    check(rt.w.empById('emp_fixture_self').email === 'new@example.test', 'CEO: employee field mutated in State');
    check(rt.ctl.writes.length - w >= 1, 'CEO: employee update persisted (write occurred)'); }
  // employee compensation update
  { const rt=loadRuntime(); seed(rt,{principal:CEO_P});
    const r = await rt.w.updateEmployeeCompensation('emp_fixture_self', { monthlyBaseSalary:2500000 });
    check(r && r.success === true && rt.w.empById('emp_fixture_self').monthlyBaseSalary === 2500000, 'CEO: employee compensation update succeeds and applies'); }
  // employee setActive
  { const rt=loadRuntime(); seed(rt,{principal:CEO_P});
    await rt.w.setEmployeeActive('emp_fixture_self', false);
    check(rt.w.empById('emp_fixture_self').active === false, 'CEO: employee setActive mutates active state'); }
  // employee delete (no linked payroll/txns -> deletable)
  { const rt=loadRuntime(); const S=seed(rt,{principal:CEO_P});
    await rt.w.deleteEmployee('e2');
    check(!rt.w.empById('e2'), 'CEO: employee delete removes the record'); }
  // contract core update
  { const rt=loadRuntime(); seed(rt,{principal:CEO_P});
    const r = await rt.w.updateContractCore('c_self', { notes:'edited by CEO' });
    check(r && r.success === true && rt.w.contractById('c_self').notes === 'edited by CEO', 'CEO: contract core update succeeds and applies'); }
  // contract dates update
  { const rt=loadRuntime(); seed(rt,{principal:CEO_P});
    const r = await rt.w.updateContractDates('c_self', { durationMonths:24 });
    check(r && r.success === true && rt.w.contractById('c_self').durationMonths === 24, 'CEO: contract dates update succeeds and applies'); }
  // contract delete (Draft, no linked -> deletable)
  { const rt=loadRuntime(); seed(rt,{principal:CEO_P});
    await rt.w.deleteContract('c_self');
    check(!rt.w.contractById('c_self'), 'CEO: contract delete removes the record'); }
  // create authorization allowed for CEO
  { const rt=loadRuntime(); seed(rt,{principal:CEO_P});
    check(rt.w.can(rt.w.ACTIONS.EMPLOYEE_CREATE) === true, 'CEO: employee.create authorization allowed');
    check(rt.w.can(rt.w.ACTIONS.CONTRACT_CREATE) === true, 'CEO: contract.create authorization allowed'); }

  /* ============================================================
     4. Frozen public API only — boundaries use can()/ACTIONS.
     ============================================================ */
  console.log('-- 4. boundary uses the frozen public authorization API --');
  { const rt=loadRuntime();
    check(typeof rt.w.can === 'function', 'public can() is available to the domain boundary');
    check(rt.w.canPrincipal === undefined, 'internal canPrincipal is NOT on the production global');
    check(rt.w.POLICY === undefined, 'internal POLICY is NOT on the production global'); }

  console.log('');
  if(failures.length){
    console.log('UX-006C2A CORE HR MUTATION ENFORCEMENT RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f=>console.log('  - ' + f));
    process.exit(1);
  }
  console.log('UX-006C2A CORE HR MUTATION ENFORCEMENT RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
