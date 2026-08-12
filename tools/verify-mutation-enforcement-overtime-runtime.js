#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-006C2B — OVERTIME MUTATION ENFORCEMENT — RUNTIME VERIFICATION
   ------------------------------------------------------------
   Proves SE-0 at the REAL Overtime mutation boundaries and the Employee
   self-Draft policy. Executes the production handlers through the same vm loader
   used by the other harnesses (module-order.js MINUS core/app-bootstrap.js),
   driving identity via the real LocalIdentityProvider selection path.

   Persistence AND audit flow through localStorage writes (persistHR / logActivity),
   so a single write-spy (ctl.writes) captures both: a denied mutation ⇒ 0 writes.

   Boundaries (real entry points, js/people/overtime.js):
     addOvertimeRecord, updateOvertimeRecord, setOvertimeStatus,
     duplicateOvertimeRecord, deleteOvertimeRecord, worksheetSave.

   Policy: CEO pass-through (company management); Employee self-service ONLY on
   own Draft (create/update/delete self-Draft + submitSelf Draft→Submitted);
   null denies all. Ownership-change and status-change attacks must be rejected
   with full rollback. All fixtures fabricated; no file modified.
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
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-c2b' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-c2b-runtime.js' });
  sandbox.toast = function(m){ toasts.push(String(m)); };
  sandbox.showWarning = function(m){ toasts.push('WARN:'+String(m)); };
  sandbox.showSuccess = function(m){ toasts.push('OK:'+String(m)); };
  sandbox.render = noop; sandbox.closeModal = noop; sandbox.confirmAction = ()=>true;
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.memStore = memStore; rt.ctl = ctl; rt.toasts = toasts;
  return rt;
}

const EMP = (o)=>Object.assign({ id:'emp_fixture_self', employeeId:'SELF', fullName:'SAMPLE — Self',
  employmentStatus:'Active', active:true, monthlyBaseSalary:1000000, joinDate:'2024-01-01',
  createdAt:N, updatedAt:N }, o);
const OT = (o)=>Object.assign({ id:'ot_self_draft', employeeId:'emp_fixture_self', employeeName:'SAMPLE — Self',
  monthKey:'2025-01', month:'January', year:2025, monthNum:1, overtimeDate:'2025-01-10', overtimeHours:5,
  workDescription:'seed', project:null, payrollPlanId:null, committedTxnId:null,
  snapHoursPerDay:8, snapDaysPerWeek:5, snapWeeksPerMonth:4, snapMonthlySalary:1000000, scheduleSource:'company',
  monthlyStandardHours:160, hourlyRate:6250, calculatedAmount:50000, rawAmount:50000, approvedAmount:null,
  status:'Draft', notes:'', createdAt:N, updatedAt:N, history:[{event:'created',ts:N,note:'seed'}] }, o);

function seed(rt, opts){
  opts = opts || {};
  const S = rt.State;
  S.settings = { companyWorkHoursPerDay:8, companyWorkDaysPerWeek:5, companyWeeksPerMonth:4,
    overtimeRounding:'none', payrollLocks:{} };
  S.employees = [ EMP(), EMP({ id:'e_other', employeeId:'OTH', fullName:'SAMPLE — Other' }) ];
  S.contracts = [];
  S.overtimeRecords = [
    OT(),
    OT({ id:'ot_self_submitted', status:'Submitted' }),
    OT({ id:'ot_self_approved', status:'Approved', approvedAmount:50000 }),
    OT({ id:'ot_other_draft', employeeId:'e_other', employeeName:'SAMPLE — Other' })
  ];
  S.monthlyPlans = []; S.txns = []; S.payrollPlans = []; S.payrollAdjustments = [];
  S.recurringExpenses = []; S.employeeMerges = []; S.companyAccounts = [];
  S.supplementalPayments = []; S.importBatches = []; S.backups = []; S.auditLog = S.auditLog || [];
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
const deniedNull  = (r)=> r === null || r === undefined;
const deniedFalse = (r)=> r === false;
const deniedVoid  = (r)=> r === undefined;

(async function main(){
  console.log('== UX-006C2B OVERTIME MUTATION ENFORCEMENT — RUNTIME VERIFICATION ==');
  console.log('   SE-0 at real Overtime boundaries; Employee self-Draft only; CEO management.');
  console.log('');

  const EMP_P = 'user_employee_fixture';   // binds to emp_fixture_self
  const CEO_P = 'user_ceo_fixture';

  /* ---------- 1. NULL principal — all Overtime mutations deny with SE-0 ---------- */
  console.log('-- 1. currentUser === null : all Overtime mutations deny with SE-0 --');
  await assertSE0('null: create', null, (rt)=> rt.w.addOvertimeRecord({employeeId:'emp_fixture_self', monthKey:'2025-02', overtimeHours:3}), deniedNull);
  await assertSE0('null: update', null, (rt)=> rt.w.updateOvertimeRecord('ot_self_draft', {overtimeHours:9}), deniedFalse);
  await assertSE0('null: setStatus(Submitted)', null, (rt)=> rt.w.setOvertimeStatus('ot_self_draft','Submitted'), deniedVoid);
  await assertSE0('null: delete', null, (rt)=> rt.w.deleteOvertimeRecord('ot_self_draft'), deniedVoid);
  await assertSE0('null: duplicate', null, (rt)=> rt.w.duplicateOvertimeRecord('ot_self_draft'), deniedVoid);
  await assertSE0('null: worksheetSave', null, (rt)=> rt.w.worksheetSave('2025-01', [{employeeId:'emp_fixture_self', hours:4}], true), deniedVoid);

  /* ---------- 2. EMPLOYEE — allowed ONLY on own Draft ---------- */
  console.log('-- 2. Employee : own Draft self-service allowed --');
  { const rt=loadRuntime(); seed(rt,{principal:EMP_P});
    const rec = await rt.w.addOvertimeRecord({employeeId:'emp_fixture_self', monthKey:'2025-03', overtimeHours:3});
    check(!!rec && rec.status==='Draft' && rec.employeeId==='emp_fixture_self', 'Employee: create OWN Draft allowed');
    check(rt.w.overtimeById(rec.id) === rec, 'Employee: created record is in State'); }
  { const rt=loadRuntime(); seed(rt,{principal:EMP_P});
    const ok = await rt.w.updateOvertimeRecord('ot_self_draft', {overtimeHours:7});
    check(ok === true && rt.w.overtimeById('ot_self_draft').overtimeHours===7, 'Employee: update OWN Draft allowed'); }
  { const rt=loadRuntime(); seed(rt,{principal:EMP_P});
    await rt.w.setOvertimeStatus('ot_self_draft','Submitted');
    check(rt.w.overtimeById('ot_self_draft').status==='Submitted', 'Employee: submit OWN Draft (Draft→Submitted) allowed'); }
  { const rt=loadRuntime(); seed(rt,{principal:EMP_P});
    await rt.w.deleteOvertimeRecord('ot_self_draft');
    check(!rt.w.overtimeById('ot_self_draft'), 'Employee: delete OWN Draft allowed'); }

  /* ---------- 3. EMPLOYEE — own NON-Draft denied with SE-0 ---------- */
  console.log('-- 3. Employee : own non-Draft denied (SE-0) --');
  await assertSE0('employee: update own Submitted', EMP_P, (rt)=> rt.w.updateOvertimeRecord('ot_self_submitted', {overtimeHours:9}), deniedFalse);
  await assertSE0('employee: delete own Approved', EMP_P, (rt)=> rt.w.deleteOvertimeRecord('ot_self_approved'), deniedVoid);
  await assertSE0('employee: re-submit own Submitted', EMP_P, (rt)=> rt.w.setOvertimeStatus('ot_self_submitted','Submitted'), deniedVoid);
  await assertSE0('employee: approve own Draft (manage)', EMP_P, (rt)=> rt.w.setOvertimeStatus('ot_self_draft','Approved'), deniedVoid);

  /* ---------- 4. EMPLOYEE — other-employee record denied with SE-0 ---------- */
  console.log('-- 4. Employee : other-employee record denied (SE-0) --');
  await assertSE0('employee: update OTHER draft', EMP_P, (rt)=> rt.w.updateOvertimeRecord('ot_other_draft', {overtimeHours:9}), deniedFalse);
  await assertSE0('employee: delete OTHER draft', EMP_P, (rt)=> rt.w.deleteOvertimeRecord('ot_other_draft'), deniedVoid);
  await assertSE0('employee: submit OTHER draft', EMP_P, (rt)=> rt.w.setOvertimeStatus('ot_other_draft','Submitted'), deniedVoid);
  await assertSE0('employee: duplicate OTHER draft', EMP_P, (rt)=> rt.w.duplicateOvertimeRecord('ot_other_draft'), deniedVoid);

  /* ---------- 5. OWNERSHIP-CHANGE attack — Employee edits own Draft, flips employeeId ---------- */
  console.log('-- 5. ownership-change attack rejected with SE-0 --');
  await assertSE0('employee: update own Draft but change employeeId→other', EMP_P,
    (rt)=> rt.w.updateOvertimeRecord('ot_self_draft', {employeeId:'e_other', overtimeHours:9}), deniedFalse);

  /* ---------- 6. STATUS-change attack — ordinary edit tries Draft→Approved ---------- */
  console.log('-- 6. status-change attack rejected with SE-0 --');
  await assertSE0('employee: update own Draft but set status=Approved', EMP_P,
    (rt)=> rt.w.updateOvertimeRecord('ot_self_draft', {status:'Approved', overtimeHours:9}), deniedFalse);

  /* ---------- 7. Employee company management denied ---------- */
  console.log('-- 7. Employee company management denied (SE-0) --');
  await assertSE0('employee: worksheetSave (bulk manage)', EMP_P, (rt)=> rt.w.worksheetSave('2025-01', [{employeeId:'emp_fixture_self', hours:4}], true), deniedVoid);

  /* ---------- 8. CEO — company management works (zero regression) ---------- */
  console.log('-- 8. CEO : company management works --');
  { const rt=loadRuntime(); seed(rt,{principal:CEO_P});
    const rec = await rt.w.addOvertimeRecord({employeeId:'e_other', monthKey:'2025-04', overtimeHours:2});
    check(!!rec, 'CEO: create for any employee allowed'); }
  { const rt=loadRuntime(); seed(rt,{principal:CEO_P});
    await rt.w.setOvertimeStatus('ot_self_submitted','Approved');
    check(rt.w.overtimeById('ot_self_submitted').status==='Approved', 'CEO: approve (manage transition) allowed'); }
  { const rt=loadRuntime(); seed(rt,{principal:CEO_P});
    await rt.w.setOvertimeStatus('ot_other_draft','Rejected');
    check(rt.w.overtimeById('ot_other_draft').status==='Rejected', 'CEO: reject other-employee record allowed'); }
  { const rt=loadRuntime(); seed(rt,{principal:CEO_P});
    const ok = await rt.w.updateOvertimeRecord('ot_other_draft', {overtimeHours:11});
    check(ok===true && rt.w.overtimeById('ot_other_draft').overtimeHours===11, 'CEO: update any record allowed'); }
  { const rt=loadRuntime(); seed(rt,{principal:CEO_P});
    await rt.w.deleteOvertimeRecord('ot_other_draft');
    check(!rt.w.overtimeById('ot_other_draft'), 'CEO: delete any record allowed'); }
  { const rt=loadRuntime(); const S=seed(rt,{principal:CEO_P}); const before=S.overtimeRecords.length;
    await rt.w.worksheetSave('2025-01', [{employeeId:'e_other', hours:6}], true);
    const rec = rt.State.overtimeRecords.find(o=>o.employeeId==='e_other' && o.monthKey==='2025-01');
    check(!!rec && rec.status==='Approved', 'CEO: worksheetSave bulk create+approve allowed'); }

  /* ---------- 9. public-API-only sanity ---------- */
  console.log('-- 9. frozen public API only --');
  { const rt=loadRuntime();
    check(typeof rt.w.can==='function' && rt.w.canPrincipal===undefined && rt.w.POLICY===undefined,
      'public can() available; internal canPrincipal/POLICY not on production global');
    check(rt.w.ACTIONS.OVERTIME_CREATE_SELF_DRAFT==='overtime.createSelfDraft'
      && rt.w.ACTIONS.OVERTIME_UPDATE_SELF_DRAFT==='overtime.updateSelfDraft'
      && rt.w.ACTIONS.OVERTIME_DELETE_SELF_DRAFT==='overtime.deleteSelfDraft', 'the three new ACTIONS are present with expected values'); }

  console.log('');
  if(failures.length){
    console.log('UX-006C2B OVERTIME MUTATION ENFORCEMENT RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f=>console.log('  - ' + f));
    process.exit(1);
  }
  console.log('UX-006C2B OVERTIME MUTATION ENFORCEMENT RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
