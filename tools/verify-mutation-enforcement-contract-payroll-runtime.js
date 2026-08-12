#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-006C2C-1 — CONTRACT OPERATIONS + PAYROLL ENFORCEMENT — RUNTIME VERIFICATION
   ------------------------------------------------------------
   Proves SE-0 at the real operational Contract + Payroll mutation boundaries and
   the composite atomicity of renewContract (Contract create+update) and
   commitReadyPayroll (Payroll + Finance). Executes the production handlers through
   the same vm loader used by the other harnesses (module-order.js MINUS
   core/app-bootstrap.js), driving identity via the real LocalIdentityProvider.

   Persistence AND audit flow through localStorage writes (persist* / logActivity),
   so a single write-spy (ctl.writes) captures both: denied ⇒ 0 writes.

   Boundaries: transitionContractStatus, renewContract; generatePayrollForMonth,
   transitionPayrollLifecycle, commitReadyPayroll, prepareNextMonthPayroll,
   setPayrollLock. Mappings (frozen): contract status→contract.update; renewal→
   contract.create (top-level composite); all payroll ops→payroll.manage.
   All are CEO-only; Employee and null deny. Fixtures fabricated; no file modified.
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
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-c2c1' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-c2c1-runtime.js' });
  sandbox.toast = function(m){ toasts.push(String(m)); };
  sandbox.showWarning = function(m){ toasts.push('WARN:'+String(m)); };
  sandbox.showSuccess = function(m){ toasts.push('OK:'+String(m)); };
  sandbox.render = noop; sandbox.closeModal = noop; sandbox.confirmAction = ()=>true;
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.memStore = memStore; rt.ctl = ctl; rt.toasts = toasts;
  return rt;
}

const EMP = (o)=>Object.assign({ id:'emp_fixture_self', employeeId:'SELF', fullName:'SAMPLE — Self',
  employmentStatus:'Active', active:true, monthlyBaseSalary:1000000, joinDate:'2024-01-01', createdAt:N, updatedAt:N }, o);
const CT = (o)=>Object.assign({ id:'c1', employeeId:'emp_fixture_self', employeeName:'SAMPLE — Self',
  contractNumber:'C-1', startDate:'2025-01-01', durationMonths:12, monthlySalary:1000000,
  status:'Draft', notes:'', createdAt:N, updatedAt:N, history:[{event:'created',ts:N,note:'seed'}] }, o);
const PP = (o)=>Object.assign({ id:'pp1', employeeId:'emp_fixture_self', employeeName:'SAMPLE — Self',
  monthKey:'2025-01', month:'January', year:2025, monthNum:1, status:'Draft', baseSalary:1000000,
  baseSalarySnapshot:1000000, plannedAmount:1000000, history:[{event:'generated',ts:N,note:'seed'}], createdAt:N, updatedAt:N }, o);

const RENEWAL = { successor:{ employeeId:'emp_fixture_self', employeeName:'SAMPLE — Self', contractNumber:'C-2',
  startDate:'2026-01-01', durationMonths:12, monthlySalary:1000000, status:'Active', notes:'' },
  predecessorStatus:'Renewed', predecessorNote:'renewed', successorNote:'created via renewal' };

function seed(rt, opts){
  opts = opts || {};
  const S = rt.State;
  S.settings = { companyWorkHoursPerDay:8, companyWorkDaysPerWeek:5, companyWeeksPerMonth:4,
    overtimeRounding:'none', payrollLocks:{} };
  S.employees = [ EMP() ];
  S.contracts = [ CT() ];
  S.overtimeRecords = []; S.monthlyPlans = []; S.txns = []; S.payrollPlans = [ PP() ];
  S.payrollAdjustments = []; S.recurringExpenses = []; S.employeeMerges = [];
  S.companyAccounts = []; S.supplementalPayments = []; S.importBatches = []; S.backups = [];
  S.auditLog = S.auditLog || []; S.payrollMonth = '2025-01';
  if(opts.principal) rt.w.LocalIdentityProvider.selectPrincipal(opts.principal);
  rt.ctl.writes.length = 0;
  return S;
}

async function assertSE0(label, principalId, invoke, expectDenied){
  const rt = loadRuntime();
  const S = seed(rt, { principal: principalId });
  const before = JSON.stringify(S);
  const w = rt.ctl.writes.length;
  const result = await invoke(rt, S);
  check(expectDenied(result), label + ': denied (no success outcome)');
  check(JSON.stringify(rt.State) === before, label + ': State byte-identical (no mutation)');
  check(rt.ctl.writes.length - w === 0, label + ': zero persistence/audit writes');
}
const deniedTyped = (r)=> !!r && r.success === false && r.error === 'NotAuthorized';
const deniedResultNA = (r)=> !!r && r.error === 'NotAuthorized';
const deniedVoid = (r)=> r === undefined;
// Outcome-reporting audit — setPayrollLock now returns a typed result so its caller cannot
// report a denied lock/unlock as success. The denial assertion is tightened accordingly:
// it must be the explicit NotAuthorized result, not merely "not a success".
const deniedLock = (r)=> !!r && r.ok === false && r.error === 'NotAuthorized';
const deniedGenerated = (r)=> !!r && r.denied === true && r.generated === 0;

(async function main(){
  console.log('== UX-006C2C-1 CONTRACT OPERATIONS + PAYROLL — RUNTIME VERIFICATION ==');
  console.log('   SE-0 at operational Contract + Payroll boundaries; composite atomicity.');
  console.log('');
  const EMP_P = 'user_employee_fixture';
  const CEO_P = 'user_ceo_fixture';

  /* 1. NULL — all deny SE-0 */
  console.log('-- 1. currentUser === null : all deny with SE-0 --');
  await assertSE0('null: contract status transition', null, (rt)=> rt.w.transitionContractStatus('c1', {to:'Active'}), deniedTyped);
  await assertSE0('null: contract renewal', null, (rt)=> rt.w.renewContract('c1', RENEWAL), deniedTyped);
  await assertSE0('null: payroll generate', null, (rt)=> rt.w.generatePayrollForMonth('2025-02'), deniedGenerated);
  await assertSE0('null: payroll lifecycle', null, (rt)=> rt.w.transitionPayrollLifecycle('pp1', {to:'Reviewed'}), deniedTyped);
  await assertSE0('null: commit ready payroll', null, (rt)=> rt.w.commitReadyPayroll('2025-01', ['pp1']), deniedResultNA);
  await assertSE0('null: prepare next month', null, (rt)=> rt.w.prepareNextMonthPayroll('2025-01'), deniedVoid);
  await assertSE0('null: set payroll lock', null, (rt)=> rt.w.setPayrollLock('2025-01', true), deniedLock);

  /* 2. EMPLOYEE — all deny SE-0 */
  console.log('-- 2. Employee : all deny with SE-0 --');
  await assertSE0('employee: contract status transition', EMP_P, (rt)=> rt.w.transitionContractStatus('c1', {to:'Active'}), deniedTyped);
  await assertSE0('employee: contract renewal', EMP_P, (rt)=> rt.w.renewContract('c1', RENEWAL), deniedTyped);
  await assertSE0('employee: payroll generate', EMP_P, (rt)=> rt.w.generatePayrollForMonth('2025-02'), deniedGenerated);
  await assertSE0('employee: payroll lifecycle', EMP_P, (rt)=> rt.w.transitionPayrollLifecycle('pp1', {to:'Reviewed'}), deniedTyped);
  await assertSE0('employee: commit ready payroll', EMP_P, (rt)=> rt.w.commitReadyPayroll('2025-01', ['pp1']), deniedResultNA);
  await assertSE0('employee: prepare next month', EMP_P, (rt)=> rt.w.prepareNextMonthPayroll('2025-01'), deniedVoid);
  await assertSE0('employee: set payroll lock', EMP_P, (rt)=> rt.w.setPayrollLock('2025-01', true), deniedLock);

  /* 3. RENEWAL composite atomicity — denied leaves predecessor unchanged + no successor */
  console.log('-- 3. renewContract composite atomicity (denied) --');
  { const rt=loadRuntime(); const S=seed(rt,{principal:EMP_P});
    const predBefore = JSON.stringify(rt.w.contractById('c1'));
    const countBefore = rt.State.contracts.length;
    const r = await rt.w.renewContract('c1', RENEWAL);
    check(deniedTyped(r), 'renewal denied returns NotAuthorized');
    check(JSON.stringify(rt.w.contractById('c1')) === predBefore, 'renewal denied: predecessor unchanged');
    check(rt.State.contracts.length === countBefore, 'renewal denied: no successor created');
    check(rt.ctl.writes.length === 0, 'renewal denied: zero writes'); }

  /* 4. COMMIT composite atomicity — denied leaves payroll + finance txns unchanged */
  console.log('-- 4. commitReadyPayroll composite atomicity (denied) --');
  { const rt=loadRuntime(); const S=seed(rt,{principal:EMP_P});
    const plansBefore = JSON.stringify(rt.State.payrollPlans);
    const txnsBefore = JSON.stringify(rt.State.txns);
    const r = await rt.w.commitReadyPayroll('2025-01', ['pp1']);
    check(deniedResultNA(r), 'commit denied returns NotAuthorized');
    check(JSON.stringify(rt.State.payrollPlans) === plansBefore, 'commit denied: payroll plans unchanged');
    check(JSON.stringify(rt.State.txns) === txnsBefore, 'commit denied: finance transactions unchanged');
    check(rt.ctl.writes.length === 0, 'commit denied: zero writes (payroll + finance atomic)'); }

  /* 5. CEO — zero regression: operations authorized and succeed */
  console.log('-- 5. CEO : operations authorized (zero regression) --');
  { const rt=loadRuntime(); seed(rt,{principal:CEO_P});
    const r = await rt.w.transitionContractStatus('c1', {to:'Active'});
    check(r && r.success === true && rt.w.contractById('c1').status === 'Active', 'CEO: contract status transition succeeds'); }
  { const rt=loadRuntime(); const S=seed(rt,{principal:CEO_P}); const n=rt.State.contracts.length;
    const r = await rt.w.renewContract('c1', RENEWAL);
    check(r && r.success === true, 'CEO: renewal succeeds');
    check(rt.State.contracts.length === n+1, 'CEO: renewal created the successor contract');
    check(rt.w.contractById('c1').status === 'Renewed', 'CEO: renewal updated the predecessor'); }
  { const rt=loadRuntime(); seed(rt,{principal:CEO_P});
    const r = rt.w.generatePayrollForMonth('2025-02');
    check(r && r.denied !== true, 'CEO: payroll generate authorized (not denied)'); }
  { const rt=loadRuntime(); seed(rt,{principal:CEO_P});
    const r = await rt.w.transitionPayrollLifecycle('pp1', {to:'Reviewed'});
    check(r && r.success === true && rt.w.payrollPlanById('pp1').status === 'Reviewed', 'CEO: payroll lifecycle transition succeeds'); }
  { const rt=loadRuntime(); seed(rt,{principal:CEO_P});
    const r = await rt.w.commitReadyPayroll('2025-01', ['pp1']);
    check(r && r.error !== 'NotAuthorized', 'CEO: commit authorized (proceeds; not an authz denial)'); }
  { const rt=loadRuntime(); seed(rt,{principal:CEO_P});
    const lr = await rt.w.setPayrollLock('2025-01', true);
    check(rt.State.settings.payrollLocks['2025-01'] === true, 'CEO: set payroll lock succeeds');
    check(!!lr && lr.ok === true, 'CEO: set payroll lock returns the typed success result'); }

  /* 6. public-API-only sanity */
  console.log('-- 6. frozen public API only --');
  { const rt=loadRuntime();
    check(typeof rt.w.can==='function' && rt.w.canPrincipal===undefined && rt.w.POLICY===undefined,
      'public can() available; internal canPrincipal/POLICY not on production global'); }

  console.log('');
  if(failures.length){
    console.log('UX-006C2C-1 CONTRACT OPERATIONS + PAYROLL RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f=>console.log('  - ' + f));
    process.exit(1);
  }
  console.log('UX-006C2C-1 CONTRACT OPERATIONS + PAYROLL RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
