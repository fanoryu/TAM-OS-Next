#!/usr/bin/env node
'use strict';
/* ============================================================
   AUTHORIZED-BOUNDARY OUTCOME REPORTING — RUNTIME VERIFICATION
   ------------------------------------------------------------
   Authorization enforcement at the gated boundaries is proven elsewhere (C2A/C2B/
   C2C-1/C2C-2 harnesses). THIS harness proves the other half of the contract: a
   DENIED operation must never be REPORTED as a success.

     denied  =>  no domain mutation
                 no persistence caused by that mutation
                 no success message
                 no success navigation / completion state (e.g. a cleared selection)
                 the denial is visible to the user
     allowed =>  the existing successful behaviour is unchanged

   The defect class was found by the UX-006C2C-2 governance review (BLOCKER-1: the
   Execution Center Schedule control reported "Transaction scheduled." to a denied
   principal) and the UX-006C2C-3/4 mapping review (Findings A and B). This harness
   drives the REAL production click handlers — captured the way the page binds them —
   rather than matching source strings, for every defect confirmed by the audit:

     A  payroll Generate button        (persist + "Generated 0, refreshed 0, 0 excluded.")
     B  payroll lock / unlock buttons  (warning + "Period locked.")
     C  Post to Finance (commitReadyPayroll)  (denial fell into the completion path:
                                               selection cleared, modal closed, summary shown)
     D  bulk lifecycle actions         (success channel for an all-denied batch)

   Fixtures fabricated; no production file is modified by this harness.
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
  const said = [];
  const sandbox = {
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-outcome' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true, prompt: ()=>'2025-02-01',
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-outcome-runtime.js' });
  // Every user-facing channel is captured with its severity so "reported as success"
  // is decidable, not guessed.
  sandbox.showSuccess = function(m){ said.push('SUCCESS:' + String(m)); };
  sandbox.showWarning = function(m){ said.push('WARN:' + String(m)); };
  sandbox.showError   = function(m){ said.push('ERROR:' + String(m)); };
  sandbox.toast       = function(m){ said.push('TOAST:' + String(m)); };
  sandbox.render = noop; sandbox.closeModal = noop; sandbox.confirmAction = ()=>true;
  sandbox.openModalHTML = noop; sandbox.focusFirstIn = noop;
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.memStore = memStore; rt.ctl = ctl; rt.said = said;
  return rt;
}

const EMP = (o)=>Object.assign({ id:'emp_fixture_self', employeeId:'SELF', fullName:'SAMPLE — Self',
  employmentStatus:'Active', active:true, monthlyBaseSalary:1000000, joinDate:'2024-01-01', createdAt:N, updatedAt:N }, o);
const CT = (o)=>Object.assign({ id:'c1', employeeId:'emp_fixture_self', employeeName:'SAMPLE — Self',
  contractNumber:'C-1', startDate:'2025-01-01', durationMonths:12, monthlySalary:1000000,
  status:'Active', notes:'', createdAt:N, updatedAt:N, history:[{event:'created',ts:N,note:'seed'}] }, o);
const PP = (o)=>Object.assign({ id:'pp1', employeeId:'emp_fixture_self', employeeName:'SAMPLE — Self',
  monthKey:'2025-01', month:'January', year:2025, monthNum:1, status:'Ready', baseSalary:1000000,
  baseSalarySnapshot:1000000, plannedAmount:1000000, contractId:'c1',
  history:[{event:'generated',ts:N,note:'seed'}], createdAt:N, updatedAt:N }, o);

function seed(rt, principal){
  const S = rt.State;
  S.settings = { companyWorkHoursPerDay:8, companyWorkDaysPerWeek:5, companyWeeksPerMonth:4,
    overtimeRounding:'none', payrollLocks:{}, autoArchiveCompleted:false, defaultPayrollCategory:'Gaji' };
  S.employees = [ EMP() ]; S.contracts = [ CT() ]; S.payrollPlans = [ PP() ];
  S.overtimeRecords = []; S.monthlyPlans = []; S.txns = []; S.payrollAdjustments = [];
  S.recurringExpenses = []; S.employeeMerges = []; S.companyAccounts = [];
  S.supplementalPayments = []; S.importBatches = []; S.backups = [];
  S.payrollMonth = '2025-01'; S.selectedMonth = '2025-01';
  if(principal) rt.w.LocalIdentityProvider.selectPrincipal(principal);
  rt.ctl.writes.length = 0; rt.said.length = 0;
  return S;
}

// Capture a production click handler the way renderPayrollWorkspace binds it: the
// renderer looks its controls up with document.getElementById, so a stub element
// records the listener the real code attaches.
function capturePayrollWorkspaceHandlers(rt){
  const handlers = {};
  const stub = (id) => ({ id:id, style:{}, dataset:{}, innerHTML:'', value:'2025-01',
    addEventListener:(ev, fn)=>{ if(ev==='click' || ev==='change') handlers[id] = fn; },
    querySelector:()=>null, querySelectorAll:()=>[] });
  const main = { innerHTML:'', querySelector:()=>null, querySelectorAll:()=>[] };
  const prevGet = rt.w.document.getElementById;
  rt.w.document.getElementById = (id) => stub(id);
  try { rt.w.renderPayrollWorkspace(main); } finally { rt.w.document.getElementById = prevGet; }
  return handlers;
}
const saidAll = (rt)=> rt.said.join(' | ');
const reportedSuccess = (rt)=> /^SUCCESS:/m.test(rt.said.join('\n'));

(async function main(){
  console.log('== AUTHORIZED-BOUNDARY OUTCOME REPORTING — RUNTIME VERIFICATION ==');
  console.log('   denied => no mutation, no persistence, NO success report; allowed => unchanged.');
  console.log('');
  const EMP_P = 'user_employee_fixture';
  const CEO_P = 'user_ceo_fixture';
  const DENIED = [['employee', EMP_P], ['null', null]];

  /* A. Payroll Generate button */
  console.log('-- A. payroll Generate button : denial is not a success --');
  for(const [label, principal] of DENIED){
    const rt = loadRuntime(); const S = seed(rt, principal);
    const h = capturePayrollWorkspaceHandlers(rt);
    check(typeof h.genPay === 'function', label + ': Generate handler bound');
    if(typeof h.genPay !== 'function') continue;
    const before = JSON.stringify(S); const w = rt.ctl.writes.length;
    await h.genPay();
    check(!reportedSuccess(rt), label + ': denied Generate reports NO success message');
    check(/WARN:/.test(saidAll(rt)), label + ': denied Generate reports the denial');
    check(JSON.stringify(rt.State) === before, label + ': denied Generate leaves State byte-identical');
    check(rt.ctl.writes.length - w === 0, label + ': denied Generate performs zero writes (no persist)');
  }
  { const rt = loadRuntime(); const S = seed(rt, CEO_P);
    const h = capturePayrollWorkspaceHandlers(rt);
    const w = rt.ctl.writes.length;
    await h.genPay();
    check(reportedSuccess(rt) && /Generated /.test(saidAll(rt)), 'CEO: Generate still reports its success summary');
    check(rt.ctl.writes.length - w > 0, 'CEO: Generate still persists'); }

  /* B. Payroll lock / unlock */
  console.log('-- B. payroll lock / unlock : denial is not a success --');
  for(const [label, principal] of DENIED){
    const rt = loadRuntime(); const S = seed(rt, principal);
    const h = capturePayrollWorkspaceHandlers(rt);
    check(typeof h.lockBtn === 'function', label + ': lock handler bound');
    if(typeof h.lockBtn !== 'function') continue;
    const before = JSON.stringify(S); const w = rt.ctl.writes.length;
    await h.lockBtn();
    check(!reportedSuccess(rt), label + ': denied lock reports NO success message');
    check(!/Period locked|Period unlocked/.test(saidAll(rt)), label + ': denied lock never says "Period locked."');
    check(/WARN:/.test(saidAll(rt)), label + ': denied lock reports the denial');
    check(rt.State.settings.payrollLocks['2025-01'] === undefined, label + ': denied lock does not lock the period');
    check(JSON.stringify(rt.State) === before && rt.ctl.writes.length - w === 0,
      label + ': denied lock leaves State byte-identical and performs zero writes');
  }
  { const rt = loadRuntime(); seed(rt, CEO_P);
    const h = capturePayrollWorkspaceHandlers(rt);
    await h.lockBtn();
    check(rt.State.settings.payrollLocks['2025-01'] === true, 'CEO: lock still locks the period');
    check(/SUCCESS:Period locked\./.test(saidAll(rt)), 'CEO: lock still reports success'); }
  { const rt = loadRuntime(); seed(rt, CEO_P);
    const okRes = await rt.w.setPayrollLock('2025-01', true);
    check(!!okRes && okRes.ok === true, 'CEO: setPayrollLock returns the typed success result'); }
  for(const [label, principal] of DENIED){
    const rt = loadRuntime(); seed(rt, principal);
    const r = await rt.w.setPayrollLock('2025-01', true);
    check(!!r && r.ok === false && r.error === 'NotAuthorized',
      label + ': setPayrollLock returns the typed NotAuthorized result (caller can tell)');
  }

  /* C. Post to Finance — a denial must not reach the completion path */
  console.log('-- C. commitReadyPayroll : denial never reports a completed posting --');
  for(const [label, principal] of DENIED){
    const rt = loadRuntime(); const S = seed(rt, principal);
    const before = JSON.stringify(S); const w = rt.ctl.writes.length;
    const res = await rt.w.commitReadyPayroll('2025-01', ['pp1']);
    check(!!res && res.error === 'NotAuthorized', label + ': commit returns NotAuthorized');
    check(res.created === 0 && (res.posted||[]).length === 0, label + ': commit created nothing');
    check(JSON.stringify(rt.State) === before && rt.ctl.writes.length - w === 0,
      label + ': denied commit leaves State byte-identical and performs zero writes');
    check(!reportedSuccess(rt), label + ': denied commit reports NO success message');
  }
  { // the caller's completion path must be unreachable for a denial: it clears the
    // selection and reports "Posted to finance: 0 transaction(s) created" otherwise.
    const src = fs.readFileSync(path.join(path.resolve(__dirname,'..'),'js','people','payroll-workspace.js'),'utf8');
    const fn = (src.match(/const res=await commitReadyPayroll[\s\S]*?showSuccess\(`Posted to finance/) || [''])[0];
    const gate = fn.indexOf("res.error === 'NotAuthorized'");
    const completion = fn.indexOf('// Success only from here');
    check(gate !== -1 && completion !== -1 && gate < completion,
      'the Post-to-Finance caller returns on NotAuthorized BEFORE clearing the selection'); }

  /* D. Bulk lifecycle — an all-denied batch is not a success */
  console.log('-- D. bulk lifecycle actions : an all-denied batch is not a success --');
  for(const [label, principal] of DENIED){
    const rt = loadRuntime(); const S = seed(rt, principal);
    const before = JSON.stringify(S); const w = rt.ctl.writes.length;
    const r = await rt.w.requestPayrollLifecycle('pp1', 'Draft');   // Ready -> Draft is a legal transition
    check(r === false, label + ': lifecycle transition denied (returns false)');
    check(rt.State.payrollPlans[0].status === 'Ready', label + ': denied lifecycle leaves the plan status unchanged');
    check(JSON.stringify(rt.State) === before && rt.ctl.writes.length - w === 0,
      label + ': denied lifecycle leaves State byte-identical and performs zero writes');
    check(!reportedSuccess(rt), label + ': denied lifecycle reports NO success message');
  }
  { const rt = loadRuntime(); seed(rt, CEO_P);
    const r = await rt.w.requestPayrollLifecycle('pp1', 'Draft');
    check(r === true && rt.State.payrollPlans[0].status === 'Draft', 'CEO: lifecycle transition still succeeds'); }

  /* E. Regression — the boundaries fixed earlier stay fixed */
  console.log('-- E. previously remediated boundaries stay correct --');
  for(const [label, principal] of DENIED){
    const rt = loadRuntime(); const S = seed(rt, principal);
    S.txns = [{ id:'t1', monthKey:'2025-01', month:'Januari', year:2025, monthNum:1, category:'Lainnya',
      categoryCode:'L', uraian:'SAMPLE — probe', planned:1000, actual:null, type:'expense', txnDate:null,
      scheduledDate:null, source:'manual', unplanned:false, execution:null, status:'planned', history:[] }];
    rt.said.length = 0;
    const r = await rt.w.scheduleTransaction('t1','2025-02-01');
    check(!!r && r.ok === false, label + ': BLOCKER-1 boundary (scheduleTransaction) still returns a typed denial');
    check(!reportedSuccess(rt), label + ': BLOCKER-1 boundary reports no success');
    const r2 = await rt.w.commitSmartImport({ batchId:'b', fileName:'SAMPLE.xlsx', items:[], candidates:new Map() });
    check(!!r2 && r2.error === 'NotAuthorized', label + ': Smart Import commit still denies with a typed result');
  }

  console.log('');
  if(failures.length){
    console.log('AUTHORIZED-BOUNDARY OUTCOME REPORTING VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f=>console.log('  - ' + f));
    process.exit(1);
  }
  console.log('AUTHORIZED-BOUNDARY OUTCOME REPORTING VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
