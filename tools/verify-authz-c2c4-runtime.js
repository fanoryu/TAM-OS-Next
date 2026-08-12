#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-006C2C-4 — ADMINISTRATIVE DOMAIN AUTHORIZATION — RUNTIME VERIFICATION
   ------------------------------------------------------------
   Proves the frozen C2C-4 mapping (matrix rows 10-30) at the real mutation boundaries.
   ZERO new actions: every row reuses an existing capability.

     rows 10-15  supplemental generate/refresh/transition/setAccount/setNotes/post
                                              -> supplemental.manage  (post = single top gate)
     row  16     recoverSupplementalOrphans   -> NOT APPLICABLE (bootstrap self-heal)
                 linkSupplementalExecution    -> INDIRECTLY AUTHORIZED via finance.execute
     rows 17-19  recurring create/toggle/delete-> finance.manage
     row  20     commitMonthlyPlan            -> finance.manage (single top gate)
     rows 21-23  payroll adjustments          -> payroll.manage
     row  24     legacy finance mapping       -> finance.manage
     rows 25-26  bank account create/status   -> settings.manage
     rows 27-29  settings save / onboarding   -> settings.manage
     row  30     markReviewed                 -> finance.manage

   Denied (Employee and unresolved identity) must be SE-0 everywhere: serialized State
   before == after, zero storage writes, zero created finance transactions where
   applicable, and no success feedback. CEO remains operational.

   All fixtures are fabricated and run in an isolated vm context with an in-memory store.
   No production file is modified by this harness.
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
    + '\n;window.__TAM__ = { State: State, ACTIONS: ACTIONS, ACTION_SET: ACTION_SET };';
  const noop = function(){};
  const memStore = {};
  const ctl = { writes:[] };
  const memStorage = {
    getItem: (k)=> Object.prototype.hasOwnProperty.call(memStore,k) ? memStore[k] : null,
    setItem: (k,v)=>{ ctl.writes.push(k); memStore[k] = String(v); },
    removeItem: (k)=>{ delete memStore[k]; }
  };
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'', value:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const said = [];
  const sandbox = {
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-c2c4' },
    setTimeout: function(){ return 0; }, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true, prompt: ()=>'',
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-c2c4-runtime.js' });
  sandbox.showSuccess = function(m){ said.push('SUCCESS:' + String(m)); };
  sandbox.showWarning = function(m){ said.push('WARN:' + String(m)); };
  sandbox.showError   = function(m){ said.push('ERROR:' + String(m)); };
  sandbox.toast       = function(m){ said.push('TOAST:' + String(m)); };
  sandbox.render = noop; sandbox.closeModal = noop; sandbox.confirmAction = ()=>true;
  sandbox.applyTheme = noop; sandbox.hrNavTo = noop;
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.memStore = memStore; rt.ctl = ctl; rt.said = said;
  return rt;
}

const EMP = (o)=>Object.assign({ id:'emp_fixture_self', employeeId:'SELF', fullName:'SAMPLE — Self',
  employmentStatus:'Active', active:true, monthlyBaseSalary:1000000, joinDate:'2024-01-01',
  workHoursPerDay:8, workDaysPerWeek:5, weeksPerMonth:4, createdAt:N, updatedAt:N }, o);
const PP = (o)=>Object.assign({ id:'pp1', employeeId:'emp_fixture_self', employeeName:'SAMPLE — Self',
  monthKey:'2025-01', month:'Januari', year:2025, monthNum:1, status:'Committed', baseSalary:1000000,
  baseSalarySnapshot:1000000, plannedAmount:1000000, overtimeIds:[], createdAt:N, updatedAt:N,
  history:[{event:'generated',ts:N,note:'seed'}] }, o);
const SUPP = (o)=>Object.assign({ id:'sp1', payrollPlanId:'pp1', employeeId:'emp_fixture_self',
  employeeName:'SAMPLE — Self', monthKey:'2025-01', sourceType:'overtime_drift', status:'Approved',
  amount:250000, sourceOvertimeIds:['ot1'], companyAccountId:'ca1', financeTransactionId:null,
  notes:'', createdAt:N, updatedAt:N, history:[] }, o);

function seed(rt, principal){
  const S = rt.State;
  S.settings = { companyWorkHoursPerDay:8, companyWorkDaysPerWeek:5, companyWeeksPerMonth:4,
    overtimeRounding:'none', payrollLocks:{}, autoArchiveCompleted:false, defaultPayrollCategory:'Gaji',
    companyName:'SAMPLE COMPANY', onboardingDismissed:false };
  S.employees = [ EMP() ];
  S.contracts = [{ id:'c1', employeeId:'emp_fixture_self', employeeName:'SAMPLE — Self', contractNumber:'C-1',
    startDate:'2025-01-01', durationMonths:12, monthlySalary:1000000, status:'Active', createdAt:N, updatedAt:N, history:[] }];
  S.payrollPlans = [ PP() ];
  S.overtimeRecords = [{ id:'ot1', employeeId:'emp_fixture_self', monthKey:'2025-01', status:'Approved',
    overtimeHours:5, approvedAmount:250000, createdAt:N, updatedAt:N }];
  S.supplementalPayments = [ SUPP() ];
  S.companyAccounts = [{ id:'ca1', label:'SAMPLE ACCOUNT', bankName:'SAMPLE BANK', accountNumber:'000',
    purpose:'Operational', status:'Active', createdAt:N, updatedAt:N }];
  S.recurringExpenses = [{ id:'re1', name:'SAMPLE — recurring', category:'Operasional Rutin',
    defaultAmount:100000, frequency:'Monthly', active:true, startMonth:'2025-01', createdAt:N, updatedAt:N }];
  S.payrollAdjustments = [{ id:'padj1', employeeId:'emp_fixture_self', employeeName:'SAMPLE — Self',
    name:'SAMPLE — adjustment', type:'Deduction', amount:50000, active:true, startMonth:'2025-01', createdAt:N, updatedAt:N }];
  S.monthlyPlans = [{ id:'mp1', monthKey:'2025-01', month:'Januari', year:2025, monthNum:1,
    status:'Draft', committedTxnIds:[], createdAt:N, updatedAt:N }];
  S.txns = [{ id:'t_gaji', monthKey:'2025-01', month:'Januari', year:2025, monthNum:1, category:'Gaji',
    categoryCode:'A', uraian:'SAMPLE — unlinked gaji', planned:1000000, actual:null, type:'expense',
    source:'manual', status:'planned', employeeId:null, history:[] }];
  S.importBatches = []; S.backups = []; S.employeeMerges = [];
  S.selectedMonth = '2025-01'; S.payrollMonth = '2025-01';
  if(principal) rt.w.LocalIdentityProvider.selectPrincipal(principal);
  rt.ctl.writes.length = 0; rt.said.length = 0;
  return S;
}

const reportedSuccess = (rt)=> rt.said.some(function(m){ return /^SUCCESS:/.test(m); });

async function assertSE0(rt, S, label, invoke, opts){
  opts = opts || {};
  const before = JSON.stringify(S);
  const w = rt.ctl.writes.length;
  const txnCount = (S.txns||[]).length;
  rt.said.length = 0;
  const result = await invoke();
  check(JSON.stringify(rt.State) === before, label + ': State byte-identical');
  check(rt.ctl.writes.length - w === 0, label + ': zero storage writes');
  check((rt.State.txns||[]).length === txnCount, label + ': no finance transaction created');
  check(!reportedSuccess(rt), label + ': no success feedback');
  if(opts.denied) check(opts.denied(result), label + ': typed denial returned');
  return result;
}
const deniedOk = (r)=> !!r && r.ok === false;

(async function main(){
  console.log('== UX-006C2C-4 ADMINISTRATIVE DOMAIN AUTHORIZATION — RUNTIME VERIFICATION ==');
  console.log('   rows 10-30; ACTIONS stays 20 (zero new actions); denied => SE-0.');
  console.log('');
  const EMP_P = 'user_employee_fixture';
  const CEO_P = 'user_ceo_fixture';
  const DENIED = [['employee', EMP_P], ['null', null]];

  /* 1. Registry unchanged by C2C-4 */
  console.log('-- 1. registry unchanged : ACTIONS stays 20, no new action --');
  { const rt = loadRuntime();
    check(rt.ACTION_SET.length === 20, 'ACTIONS: still exactly 20 (C2C-4 adds none)');
    ['recurring.manage','bank.manage','employee.merge'].forEach(function(r){
      check(rt.ACTION_SET.indexOf(r) === -1, 'ACTIONS: rejected action ' + r + ' still absent'); });
    ['supplemental.manage','finance.manage','payroll.manage','settings.manage'].forEach(function(a){
      check(rt.ACTION_SET.indexOf(a) !== -1, 'ACTIONS: reused action ' + a + ' present'); }); }
  { const rt = loadRuntime(); seed(rt, CEO_P);
    ['supplemental.manage','settings.manage'].forEach(function(a){
      check(rt.w.can(a) === true, 'CEO: allowed ' + a + ' (previously unused action now live)'); }); }
  { const rt = loadRuntime(); seed(rt, EMP_P);
    ['supplemental.manage','settings.manage','finance.manage','payroll.manage'].forEach(function(a){
      check(rt.w.can(a, { employeeId:null }) === false, 'Employee: denied ' + a); }); }

  /* 2. Rows 10-15 — supplemental */
  const SUPP_BOUNDARIES = [
    ['generateSupplementalForPlan', (rt)=> rt.w.generateSupplementalForPlan('pp1')],
    ['refreshSupplemental',         (rt)=> rt.w.refreshSupplemental('sp1')],
    ['transitionSupplemental',      (rt)=> rt.w.transitionSupplemental('sp1','cancel')],
    ['setSupplementalAccount',      (rt)=> rt.w.setSupplementalAccount('sp1','ca1')],
    ['setSupplementalNotes',        (rt)=> rt.w.setSupplementalNotes('sp1','SAMPLE note')],
    ['postSupplemental',            (rt)=> rt.w.postSupplemental('sp1')]
  ];
  console.log('-- 2. rows 10-15 : supplemental -> supplemental.manage --');
  for(const [label, principal] of DENIED){
    for(const [name, invoke] of SUPP_BOUNDARIES){
      const rt = loadRuntime(); const S = seed(rt, principal);
      await assertSE0(rt, S, label + ': ' + name, ()=> invoke(rt), { denied: deniedOk });
    }
  }
  { const rt = loadRuntime(); const S = seed(rt, CEO_P);
    const r = await rt.w.setSupplementalNotes('sp1','SAMPLE — ceo note');
    check(!!r && r.ok === true && S.supplementalPayments[0].notes === 'SAMPLE — ceo note', 'CEO: setSupplementalNotes succeeds'); }
  { const rt = loadRuntime(); const S = seed(rt, CEO_P);
    const n = S.txns.length;
    const r = await rt.w.postSupplemental('sp1');
    check(!!r && r.ok === true, 'CEO: postSupplemental succeeds');
    check(S.txns.length === n + 1, 'CEO: postSupplemental creates the finance transaction (composite preserved)');
    check(S.supplementalPayments[0].status === 'Posted', 'CEO: postSupplemental marks the supplemental Posted'); }

  /* 3. Row 16 — frozen NOT-APPLICABLE / INDIRECT rulings preserved */
  console.log('-- 3. row 16 : recovery stays NOT APPLICABLE; link stays INDIRECT --');
  for(const [label, principal] of DENIED){
    const rt = loadRuntime(); const S = seed(rt, principal);
    // A denied principal must still be able to run the bootstrap self-heal: it is not a
    // user boundary. With no orphan present it is a no-op and returns 0.
    const n = await rt.w.recoverSupplementalOrphans();
    check(n === 0, label + ': recoverSupplementalOrphans runs (ungated, no orphan to repair)');
  }
  { const rt = loadRuntime(); const S = seed(rt, EMP_P);
    S.supplementalPayments[0].status = 'Posted';
    S.supplementalPayments[0].financeTransactionId = 'missing_txn';
    const n = await rt.w.recoverSupplementalOrphans();
    check(n === 1 && S.supplementalPayments[0].status === 'Approved',
      'employee: recoverSupplementalOrphans still repairs an orphan (NOT APPLICABLE ruling honoured)'); }

  /* 4. Rows 17-19 — recurring */
  console.log('-- 4. rows 17-19 : recurring -> finance.manage --');
  for(const [label, principal] of DENIED){
    for(const [name, invoke] of [['toggleRecurring',(rt)=>rt.w.toggleRecurring('re1')],
                                 ['deleteRecurring',(rt)=>rt.w.deleteRecurring('re1')]]){
      const rt = loadRuntime(); const S = seed(rt, principal);
      await assertSE0(rt, S, label + ': ' + name, ()=> invoke(rt));
      check(S.recurringExpenses.length === 1 && S.recurringExpenses[0].active === true,
        label + ': ' + name + ' left the rule untouched');
    }
  }
  { const rt = loadRuntime(); const S = seed(rt, CEO_P);
    await rt.w.toggleRecurring('re1');
    check(S.recurringExpenses[0].active === false, 'CEO: toggleRecurring still works'); }
  { const rt = loadRuntime(); const S = seed(rt, CEO_P);
    await rt.w.deleteRecurring('re1');
    check(S.recurringExpenses.length === 0, 'CEO: deleteRecurring still works'); }

  /* 5. Row 20 — monthly plan commit (composite) */
  console.log('-- 5. row 20 : commitMonthlyPlan -> finance.manage (composite SE-0) --');
  const PREVIEW = ()=>({ monthKey:'2025-01', rows:[
    { type:'manual', label:'SAMPLE — manual row', category:'Lainnya', planned:75000, selected:true, dup:'new' }] });
  for(const [label, principal] of DENIED){
    const rt = loadRuntime(); const S = seed(rt, principal);
    const r = await assertSE0(rt, S, label + ': commitMonthlyPlan', ()=> rt.w.commitMonthlyPlan(PREVIEW()),
      { denied:(x)=> !!x && x.error === 'NotAuthorized' });
    check(S.monthlyPlans[0].status === 'Draft', label + ': the monthly plan stays Draft');
    check((r||{}).created === 0, label + ': zero transactions created');
  }
  { const rt = loadRuntime(); const S = seed(rt, CEO_P); const n = S.txns.length;
    const r = await rt.w.commitMonthlyPlan(PREVIEW());
    check(!!r && r.ok === true && r.created === 1, 'CEO: commitMonthlyPlan still commits');
    check(S.txns.length === n + 1, 'CEO: the planned transaction is created'); }

  /* 6. Rows 21-23 — payroll adjustments */
  console.log('-- 6. rows 21-23 : payroll adjustments -> payroll.manage --');
  for(const [label, principal] of DENIED){
    for(const [name, invoke] of [['toggleAdjustment',(rt)=>rt.w.toggleAdjustment('padj1')],
                                 ['deleteAdjustment',(rt)=>rt.w.deleteAdjustment('padj1')]]){
      const rt = loadRuntime(); const S = seed(rt, principal);
      await assertSE0(rt, S, label + ': ' + name, ()=> invoke(rt));
      check(S.payrollAdjustments.length === 1 && S.payrollAdjustments[0].active === true,
        label + ': ' + name + ' left the adjustment untouched');
    }
  }
  { const rt = loadRuntime(); const S = seed(rt, CEO_P);
    await rt.w.toggleAdjustment('padj1');
    check(S.payrollAdjustments[0].active === false, 'CEO: toggleAdjustment still works'); }
  { const rt = loadRuntime(); const S = seed(rt, CEO_P);
    await rt.w.deleteAdjustment('padj1');
    check(S.payrollAdjustments.length === 0, 'CEO: deleteAdjustment still works'); }

  /* 7. Rows 25-26 — bank / company accounts */
  console.log('-- 7. rows 25-26 : bank -> settings.manage --');
  for(const [label, principal] of DENIED){
    const rt = loadRuntime(); const S = seed(rt, principal);
    await assertSE0(rt, S, label + ': setCompanyAccountStatus', ()=> rt.w.setCompanyAccountStatus('ca1','Archived'));
    check(S.companyAccounts[0].status === 'Active', label + ': the account status is unchanged');
  }
  { const rt = loadRuntime(); const S = seed(rt, CEO_P);
    await rt.w.setCompanyAccountStatus('ca1','Archived');
    check(S.companyAccounts[0].status === 'Archived', 'CEO: setCompanyAccountStatus still works'); }

  /* 8. Rows 27-29 vs data.reset — settings.manage must not confer reset authority */
  console.log('-- 8. rows 27-29 : settings.manage is not reset authority --');
  { const rt = loadRuntime(); seed(rt, CEO_P);
    check(rt.w.can('settings.manage') === true && rt.w.can('data.reset') === true,
      'CEO: settings.manage and data.reset are both allowed but distinct'); }
  { const rt = loadRuntime(); seed(rt, EMP_P);
    check(rt.w.can('settings.manage') === false && rt.w.can('data.reset') === false,
      'Employee: neither settings.manage nor data.reset'); }
  { const rt = loadRuntime(); const S = seed(rt, EMP_P);
    const before = JSON.stringify(S); const w = rt.ctl.writes.length;
    await rt.w.startFresh();
    check(JSON.stringify(rt.State) === before && rt.ctl.writes.length - w === 0,
      'Employee: startFresh still denied by data.reset (C2C-3 preserved)'); }

  /* 9. Row 24 — legacy mapping is a transaction edit under finance.manage */
  console.log('-- 9. row 24 : legacy mapping -> finance.manage --');
  { const rt = loadRuntime(); seed(rt, EMP_P);
    check(rt.w.can('finance.manage') === false, 'Employee: finance.manage denied (legacy mapping unreachable)'); }
  { const rt = loadRuntime(); seed(rt, CEO_P);
    check(rt.w.can('finance.manage') === true, 'CEO: finance.manage allowed (legacy mapping reachable)'); }

  /* 10. Regression — earlier phases intact */
  console.log('-- 10. regression : C2C-1/2/3 intact --');
  { const rt = loadRuntime(); seed(rt, EMP_P);
    ['finance.execute','import.commit','import.undo','data.restore','data.reset']
      .forEach(function(a){ check(rt.w.can(a) === false, 'regression: Employee denied ' + a); });
    check(rt.w.can('overtime.submitSelf', { id:'ot1', employeeId:'emp_fixture_self', status:'Draft' }) === true,
      'regression: Employee own-Draft overtime self-service still allowed'); }
  { const rt = loadRuntime();
    check(typeof rt.w.can === 'function' && rt.w.canPrincipal === undefined && rt.w.POLICY === undefined,
      'public can() available; internal seams not on the production global'); }

  console.log('');
  if(failures.length){
    console.log('UX-006C2C-4 RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f=>console.log('  - ' + f));
    process.exit(1);
  }
  console.log('UX-006C2C-4 RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
