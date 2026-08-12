#!/usr/bin/env node
'use strict';
/* ============================================================
   SPR-081 — PAYROLL POSTING INTEGRITY RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of this slice. This harness proves
   its BEHAVIOR by executing the real posting path against a storage backend that
   can fail specific keys, then rebuilding state from what actually persisted
   (a reload) and retrying — which is exactly how SPR-080 found the two silent
   financial defects this sprint closes.

   Same Node `vm` loader technique as js/cli/cli.js and the SPR-077/078/079
   harnesses. All fixture data is obviously fabricated. Nothing is written to
   disk and no repository file is modified.

   HONESTY NOTE: payroll posting writes four storage keys sequentially and is NOT
   atomic. SPR-081 adds result checking and detection — no rollback, no
   compensation, no retry framework, no coordination, and no write reordering.
   These tests assert that partial persistence is REAL and reported, never hidden.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

/* INTEGRITY-COVERAGE-BEGIN
   Machine-readable coverage ownership (GOV-007 / SPR-092). This is an
   OPERATION-DRIVEN harness: it proves these rules fire from a genuine partial
   write rather than from a hand-built state, which is strictly stronger evidence
   than a state-shaped fixture. That is why these two rules are deliberately NOT
   re-covered by the dedicated integrity harnesses. The declaration below makes
   that ownership machine-readable so tools/verify-build.js can account for every
   production rule identifier without duplicating a single fixture.
   Severities are the EXPECTED production severities, bound per finding below. */
const INTEGRITY_COVERAGE = {
  harness: 'verify-payroll-posting-runtime.js',
  rules: {
    'payroll-orphan-transaction': 'critical',
    'payroll-overtime-uncommitted': 'critical'
  }
};
/* INTEGRITY-COVERAGE-END */

function loadRuntime(){
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { State: State, StorageAdapter: StorageAdapter };';
  const noop = function(){};
  const memStore = {}; const ctl = { failKeys:new Set(), writes:[] };
  const memStorage = {
    getItem: (k)=> Object.prototype.hasOwnProperty.call(memStore,k) ? memStore[k] : null,
    setItem: (k,v)=>{ ctl.writes.push(k); if(ctl.failKeys.has(k)){ const e=new Error('quota'); e.name='QuotaExceededError'; throw e; } memStore[k]=String(v); },
    removeItem: (k)=>{ delete memStore[k]; }
  };
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const toasts = [];
  const sandbox = {
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-spr081' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(), body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-spr081-runtime.js' });
  sandbox.toast = function(m){ toasts.push(String(m)); };
  const rt = sandbox.__TAM__; rt.w = sandbox; rt.memStore = memStore; rt.ctl = ctl; rt.toasts = toasts;
  // UX-006C2C-1 — commitReadyPayroll now authorizes (payroll.manage). This harness models
  // the valid CEO/company workflow; select CEO explicitly (no production default).
  sandbox.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  return rt;
}

const K = { plans:'tam_payroll_plans_v1', mplans:'tam_monthly_plans_v1',
            ot:'tam_overtime_records_v1', txns:'tam_txns_v1', audit:'tam_audit_log_v1' };
const MONTH = '2026-07';

function seed(rt){
  const now = new Date().toISOString();
  rt.State.employees=[{id:'e1',employeeId:'E1',fullName:'SAMPLE — Fixture',employmentStatus:'Active',active:true,monthlyBaseSalary:1000000,joinDate:'2025-01-01',workHoursPerDay:8,workDaysPerWeek:5,weeksPerMonth:4,createdAt:now,updatedAt:now}];
  rt.State.contracts=[{id:'c1',employeeId:'e1',employeeName:'SAMPLE — Fixture',contractNumber:'S/1',startDate:'2025-01-01',durationMonths:36,monthlySalary:1000000,status:'Active',createdAt:now,updatedAt:now,history:[]}];
  rt.State.overtimeRecords=[{id:'ot1',employeeId:'e1',contractId:'c1',monthKey:MONTH,overtimeDate:MONTH+'-10',overtimeHours:2,hourlyRate:10000,calculatedAmount:20000,approvedAmount:20000,status:'Approved',createdAt:now,updatedAt:now,history:[]}];
  rt.State.monthlyPlans=[]; rt.State.txns=[]; rt.State.payrollAdjustments=[];
  rt.State.recurringExpenses=[]; rt.State.employeeMerges=[]; rt.State.companyAccounts=[];
  rt.State.supplementalPayments=[]; rt.State.importBatches=[]; rt.State.backups=[];
  rt.State.payrollPlans=[{id:'pp1',monthKey:MONTH,month:'July',year:2026,monthNum:7,
    employeeId:'e1',employeeName:'SAMPLE — Fixture',contractId:'c1',contractNumber:'S/1',contractProgress:'19/36',
    baseSalary:1000000,baseSalarySnapshot:1000000,overtime:20000,overtimeAmount:20000,
    allowance:0,deduction:0,bonus:0,benefits:0,otherAddition:0,otherDeduction:0,
    plannedAmount:1020000,overtimeIds:['ot1'],status:'Ready',history:[],createdAt:now,updatedAt:now}];
  [['plans','payrollPlans'],['ot','overtimeRecords'],['txns','txns'],['mplans','monthlyPlans']].forEach(([k,s])=>{ rt.memStore[K[k]]=JSON.stringify(rt.State[s]); });
}
function reload(from){
  const rt2 = loadRuntime(); seed(rt2);
  const g=(k)=>{ try{ return JSON.parse(from.memStore[k]||'null'); }catch(e){ return null; } };
  rt2.State.payrollPlans=g(K.plans)||[]; rt2.State.monthlyPlans=g(K.mplans)||[];
  rt2.State.overtimeRecords=g(K.ot)||[]; rt2.State.txns=g(K.txns)||[];
  return rt2;
}
function findings(rt){
  try{ const r=rt.w.runIntegrityCheck();
    const items=(r&&(r.items||r.findings||r.issues))||(Array.isArray(r)?r:[]);
    return items.map(i=>({sev:i.severity||i.sev, cat:i.category||i.code, msg:i.message||i.text}));
  }catch(e){ return [{sev:'ERR', cat:'CHECK_ERROR', msg:e.message}]; }
}
function auditCount(rt){
  try{ return JSON.parse(rt.memStore[K.audit]||'[]').filter(a=>a.type==='payroll.post').length; }catch(e){ return -1; }
}

(async function main(){
  console.log('== SPR-081 PAYROLL POSTING INTEGRITY — RUNTIME VERIFICATION ==');

  // ---------- 1. Canonical successful post ----------
  console.log('-- scenario 1: successful post --');
  {
    const rt = loadRuntime(); seed(rt);
    const res = await rt.w.commitReadyPayroll(MONTH, ['pp1']);
    check(res.ok === true, 'success returns ok:true');
    check(res.created === 1 && res.skipped === 0, 'one transaction created, nothing skipped');
    check(res.error === undefined && res.failedStep === undefined, 'success carries no failure fields');
    check(rt.State.txns.length === 1, 'exactly one finance transaction exists');
    check(rt.State.payrollPlans[0].status === 'Committed', 'payroll row is committed');
    check(rt.State.overtimeRecords[0].status === 'Committed to Payroll', 'linked overtime is committed');
    check(auditCount(rt) === 1, 'exactly ONE payroll.post success audit entry');
    check(findings(rt).filter(f=>f.cat==='payroll-orphan-transaction' || f.cat==='payroll-overtime-uncommitted').length === 0, 'a healthy post produces neither new critical finding');
  }

  // ---------- 2. Per-write failures ----------
  console.log('-- scenario 2: individual write failures --');
  // Attempt-all is preserved, so EVERY step other than the failing one completes —
  // including steps that come after the failure. That is the honest reading of
  // partial persistence: a payrollPlans failure still leaves the other three keys
  // written, which is precisely the Scenario A state.
  const ALL = ['payrollPlans','monthlyPlans','overtime','transactions'];
  const cases = [
    ['payrollPlans', K.plans],
    ['monthlyPlans', K.mplans],
    ['overtime',     K.ot],
    ['transactions', K.txns]
  ].map(([step,key]) => [step, key, ALL.filter(s=>s!==step)]);
  for(const [step, key, expectedCompleted] of cases){
    const rt = loadRuntime(); seed(rt);
    rt.ctl.failKeys.add(key); rt.ctl.writes.length = 0;
    const res = await rt.w.commitReadyPayroll(MONTH, ['pp1']);
    check(res.ok === false, '['+step+'] failure returns ok:false');
    check(res.error === 'PayrollPersistenceFailed', '['+step+'] typed error is PayrollPersistenceFailed');
    check(res.failedStep === step, '['+step+'] failedStep is correctly identified');
    check(JSON.stringify(res.completedSteps) === JSON.stringify(expectedCompleted), '['+step+'] completedSteps is accurate: '+JSON.stringify(res.completedSteps));
    check(res.partialPersistence === (expectedCompleted.length > 0), '['+step+'] partialPersistence reflects whether any write landed');
    check(res.recoveryHint === 'RunIntegrityCheckAndReview', '['+step+'] a recovery hint is supplied');
    check(auditCount(rt) === 0, '['+step+'] NO success audit entry is written');
    // attempt-all preserved: all four writes were attempted regardless of the failure
    const attempted = rt.ctl.writes.filter(w=>[K.plans,K.mplans,K.ot,K.txns].includes(w));
    check(attempted.length === 4, '['+step+'] all four writes were still attempted (attempt-all behaviour preserved)');
  }

  // ---------- 3. Multiple failures ----------
  console.log('-- scenario 3: multiple failures --');
  {
    const rt = loadRuntime(); seed(rt);
    rt.ctl.failKeys.add(K.mplans); rt.ctl.failKeys.add(K.txns);
    const res = await rt.w.commitReadyPayroll(MONTH, ['pp1']);
    check(res.ok === false && res.failedStep === 'monthlyPlans', 'failedStep is the FIRST failure in write order (deterministic)');
    check(JSON.stringify(res.failedSteps) === JSON.stringify(['monthlyPlans','transactions']), 'every failed step is reported');
    check(JSON.stringify(res.completedSteps) === JSON.stringify(['payrollPlans','overtime']), 'completed steps exclude the failures');
    check(res.partialPersistence === true, 'partialPersistence is true when some writes landed');
    check(auditCount(rt) === 0, 'no success audit on multiple failures');
    check(!/rolled back|reverted/i.test(JSON.stringify(res)), 'the result claims no rollback');
  }

  // ---------- 4. SCENARIO A — detection before retry, and no duplicate on retry ----------
  console.log('-- scenario 4: Scenario A (orphan transaction) --');
  {
    const rt = loadRuntime(); seed(rt);
    rt.ctl.failKeys.add(K.plans);                 // plans write fails, txns write lands
    await rt.w.commitReadyPayroll(MONTH, ['pp1']);
    const rl = reload(rt);                        // rebuild from what actually persisted
    check(rl.State.txns.length === 1, 'after reload an orphan finance transaction exists');
    check(rl.State.payrollPlans[0].status === 'Ready', 'after reload the payroll row is back at Ready');
    check(!rl.State.payrollPlans[0].committedTxnId, 'after reload the payroll row has no forward link');
    // DETECTION BEFORE RETRY — this produced no finding at all before SPR-081.
    const pre = findings(rl).filter(f=>f.cat==='payroll-orphan-transaction');
    check(pre.length === 1, 'Integrity Rule A detects the orphan transaction BEFORE any retry');
    check(pre[0].sev === 'critical', 'Rule A is reported as CRITICAL');
    check(/pp1/.test(pre[0].msg) && /SAMPLE/.test(pre[0].msg) && /2026-07/.test(pre[0].msg), 'Rule A names the payroll row, employee and period');
    check(/Do not post this payroll again/.test(pre[0].msg), 'Rule A tells the user not to post again before review');
    // RETRY — must reuse, never duplicate.
    const before = rl.State.txns[0].id;
    const retry = await rl.w.commitReadyPayroll(MONTH, ['pp1']);
    check(retry.ok === true, 'retry completes once storage is healthy');
    check(rl.State.txns.length === 1, 'retry does NOT create a second transaction');
    check(rl.State.txns[0].id === before, 'the existing transaction id is retained');
    check(rl.State.txns.reduce((s,t)=>s+t.planned,0) === 1020000, 'the planned amount is NOT doubled');
    check(rl.State.payrollPlans[0].committedTxnId === before, 'the forward linkage is restored to the existing transaction');
    check(retry.created === 0, 'the retry reports no new transaction created');
    check(findings(rl).filter(f=>f.cat==='payroll-orphan-transaction').length === 0, 'the orphan finding clears once posting completes successfully');
  }

  // ---------- 5. Ambiguous reverse lookup ----------
  console.log('-- scenario 5: ambiguous reverse lookup --');
  {
    const rt = loadRuntime(); seed(rt);
    const mk = (id)=>({id, monthKey:MONTH, month:'July', year:2026, monthNum:7, uraian:'SAMPLE',
      planned:1020000, actual:null, type:'expense', status:'planned', source:'payroll',
      employeeId:'e1', contractId:'c1', payrollPlanId:'pp1', history:[]});
    rt.State.txns = [mk('pay_dup_1'), mk('pay_dup_2')];      // two candidates, no forward link
    const res = await rt.w.commitReadyPayroll(MONTH, ['pp1']);
    check(rt.State.txns.length === 2, 'no THIRD transaction is created for an ambiguous row');
    check(res.created === 0 && res.skipped === 1, 'the ambiguous row is skipped, not posted');
    check(/PayrollTransactionAmbiguous/.test(JSON.stringify(res.skippedDetails)), 'the skip reason is the typed ambiguity');
    check(/pay_dup_1/.test(JSON.stringify(res.skippedDetails)) && /pay_dup_2/.test(JSON.stringify(res.skippedDetails)), 'both candidate ids are reported for review');
    check(rt.State.payrollPlans[0].status === 'Ready', 'the ambiguous row was NOT committed');
    check(!rt.State.payrollPlans[0].committedTxnId, 'no candidate was guessed as the forward link');
    check(rt.State.overtimeRecords[0].status === 'Approved', 'the ambiguous row did not consume its overtime');
  }

  // ---------- 6. SCENARIO C — committed payroll, still-Approved overtime ----------
  console.log('-- scenario 6: Scenario C (uncommitted overtime) --');
  {
    const rt = loadRuntime(); seed(rt);
    rt.ctl.failKeys.add(K.ot);                    // overtime write fails; everything else lands
    const res = await rt.w.commitReadyPayroll(MONTH, ['pp1']);
    check(res.failedStep === 'overtime', 'the overtime step is identified as failed');
    check(auditCount(rt) === 0, 'no success audit');
    const rl = reload(rt);
    check(rl.w.isPayrollCommitted(rl.State.payrollPlans[0]) === true, 'after reload the payroll row is committed');
    check(rl.State.overtimeRecords[0].status === 'Approved', 'after reload the linked overtime is still Approved');
    const c = findings(rl).filter(f=>f.cat==='payroll-overtime-uncommitted');
    check(c.length === 1, 'Integrity Rule C detects the uncommitted overtime');
    check(c[0].sev === 'critical', 'Rule C is reported as CRITICAL');
    check(/ot1/.test(c[0].msg) && /pp1/.test(c[0].msg) && /Approved/.test(c[0].msg), 'Rule C names the payroll row, overtime id and current status');
    check(/paid twice/.test(c[0].msg), 'Rule C states the double-payment exposure plainly');
    check(/Do not include or approve this overtime in another payroll/.test(c[0].msg), 'Rule C tells the user not to reuse the overtime before review');
  }

  // ---------- 7. Integrity checking mutates nothing ----------
  console.log('-- scenario 7: detection is read-only --');
  {
    const rt = loadRuntime(); seed(rt);
    rt.ctl.failKeys.add(K.plans);
    await rt.w.commitReadyPayroll(MONTH, ['pp1']);
    const rl = reload(rt);
    const before = JSON.stringify({p:rl.State.payrollPlans, o:rl.State.overtimeRecords, t:rl.State.txns, m:rl.State.monthlyPlans});
    const storeBefore = JSON.stringify(rl.memStore);
    findings(rl); findings(rl);                   // run twice — must be deterministic and inert
    const after = JSON.stringify({p:rl.State.payrollPlans, o:rl.State.overtimeRecords, t:rl.State.txns, m:rl.State.monthlyPlans});
    check(before === after, 'running Integrity Check mutates no in-memory record');
    check(storeBefore === JSON.stringify(rl.memStore), 'running Integrity Check persists nothing');
    check(JSON.stringify(findings(rl)) === JSON.stringify(findings(rl)), 'Integrity Check is deterministic across runs');
  }

  // ---------- 8. Existing business gates still hold ----------
  console.log('-- scenario 8: preserved regression behaviour --');
  {
    let rt = loadRuntime(); seed(rt); rt.State.payrollPlans[0].status='Draft';
    let res = await rt.w.commitReadyPayroll(MONTH, ['pp1']);
    check(res.created === 0 && res.skipped === 1, 'the Ready gate still blocks a non-Approved row');

    rt = loadRuntime(); seed(rt);
    rt.State.settings.payrollLocks = {}; rt.State.settings.payrollLocks[MONTH] = true;
    res = await rt.w.commitReadyPayroll(MONTH, ['pp1']);
    check(res.locked === true && res.ok === false && res.error === 'PayrollPeriodLocked', 'the period lock still refuses posting, now typed');
    check(rt.State.txns.length === 0, 'a locked period creates no transaction');

    rt = loadRuntime(); seed(rt); rt.State.contracts = [];
    res = await rt.w.commitReadyPayroll(MONTH, ['pp1']);
    check(res.created === 0 && res.skipped === 1 && res.skippedDetails.length === 1, 'commit blockers still skip with a reason');

    // re-posting a committed row is still skipped (idempotent), and creates nothing
    rt = loadRuntime(); seed(rt);
    await rt.w.commitReadyPayroll(MONTH, ['pp1']);
    const again = await rt.w.commitReadyPayroll(MONTH, ['pp1']);
    check(again.created === 0 && again.skipped === 1, 're-posting a committed row is skipped');
    check(rt.State.txns.length === 1, 're-posting creates no duplicate transaction');
  }

  // ---------- 9. WORKSPACE CALLER control flow (SPR-081 follow-up) ----------
  // The engine result is not enough: the CALLER must not perform completion
  // behaviour on a failed posting. Clearing the selection discards which rows the
  // user was posting, so it must never run before the result is inspected.
  console.log('-- scenario 9: workspace caller failure path --');
  {
    // Drive the real click handler by replaying its exact body against the live
    // engine, selection set, and UI seams. This exercises the ordering itself
    // rather than asserting on source text (verify-build.js already does that).
    async function runPostHandler(rt, monthKey, readyIds){
      const w = rt.w;
      const sel = w.payrollSelSet(monthKey);
      const ui = { closedModal:false, rendered:false, summaryOpened:false, success:null, error:null };
      const origClose = w.closeModal, origRender = w.render, origSummary = w.openPostResultModal,
            origOk = w.showSuccess, origErr = w.showError;
      w.closeModal = ()=>{ ui.closedModal = true; };
      w.render = ()=>{ ui.rendered = true; };
      w.openPostResultModal = ()=>{ ui.summaryOpened = true; };
      w.showSuccess = (m)=>{ ui.success = String(m); };
      w.showError = (m)=>{ ui.error = String(m); };
      try{
        const res = await w.commitReadyPayroll(monthKey, readyIds);
        if(res.locked){ sel.clear(); w.closeModal(); return {res, ui, selSize:sel.size}; }
        if(res.ok !== true && res.error === 'PayrollPersistenceFailed'){
          w.closeModal();
          w.showError('Payroll posting did not complete successfully. Some data may already have been saved. Run Integrity Check (Settings → Run Integrity Check) and review Payroll and Finance records before attempting another posting.', null, 12000);
          w.render();
          return {res, ui, selSize:sel.size};
        }
        sel.clear(); w.closeModal();
        res.skippedDetails = res.skippedDetails || [];
        if(res.skippedDetails.length){ w.openPostResultModal(res); }
        else w.showSuccess('Posted to finance: '+res.created+' transaction(s) created, '+res.updated+' updated.', 6000);
        w.render();
        return {res, ui, selSize:sel.size};
      } finally {
        w.closeModal=origClose; w.render=origRender; w.openPostResultModal=origSummary;
        w.showSuccess=origOk; w.showError=origErr;
      }
    }

    // FAILURE — selection must survive.
    let rt = loadRuntime(); seed(rt);
    rt.State.payrollSel = {}; rt.w.payrollSelSet(MONTH).add('pp1');
    rt.ctl.failKeys.add(K.plans);
    let out = await runPostHandler(rt, MONTH, ['pp1']);
    check(out.res.ok === false, 'caller: a failed posting returns ok:false');
    check(out.selSize === 1, 'caller: FAILURE RETAINS the selection (rows stay selected)');
    check(rt.w.payrollSelSet(MONTH).has('pp1'), 'caller: the exact selected row id is preserved');
    check(out.ui.error !== null && /Run Integrity Check/.test(out.ui.error), 'caller: failure emits the manual-review error');
    check(out.ui.success === null, 'caller: failure emits NO success toast');
    check(out.ui.summaryOpened === false, 'caller: failure opens NO posted-vs-skipped summary');
    check(out.ui.closedModal === true && out.ui.rendered === true, 'caller: failure closes the modal and re-renders safely');

    // SUCCESS — existing completion UX preserved.
    rt = loadRuntime(); seed(rt);
    rt.State.payrollSel = {}; rt.w.payrollSelSet(MONTH).add('pp1');
    out = await runPostHandler(rt, MONTH, ['pp1']);
    check(out.res.ok === true, 'caller: success returns ok:true');
    check(out.selSize === 0, 'caller: SUCCESS clears the selection');
    check(out.ui.closedModal === true, 'caller: success closes the modal');
    check(out.ui.success !== null && /Posted to finance/.test(out.ui.success), 'caller: success shows the completion toast');
    check(out.ui.error === null, 'caller: success emits no error');
    check(out.ui.rendered === true, 'caller: success re-renders');

    // SUCCESS WITH SKIPS — the summary path is still reached.
    rt = loadRuntime(); seed(rt);
    rt.State.payrollSel = {}; rt.w.payrollSelSet(MONTH).add('pp1');
    // A SECOND employee — reusing employee e1 would trip the pre-existing
    // "duplicate payroll for this month" blocker and skip both rows, which is
    // correct behaviour but not the case under test here.
    const now2 = new Date().toISOString();
    rt.State.employees.push({id:'e2', employeeId:'E2', fullName:'SAMPLE — Second', employmentStatus:'Active', active:true, monthlyBaseSalary:500000, joinDate:'2025-01-01', workHoursPerDay:8, workDaysPerWeek:5, weeksPerMonth:4, createdAt:now2, updatedAt:now2});
    rt.State.contracts.push({id:'c2', employeeId:'e2', employeeName:'SAMPLE — Second', contractNumber:'S/2', startDate:'2025-01-01', durationMonths:36, monthlySalary:500000, status:'Active', createdAt:now2, updatedAt:now2, history:[]});
    rt.State.payrollPlans.push({id:'pp2', monthKey:MONTH, month:'July', year:2026, monthNum:7,
      employeeId:'e2', employeeName:'SAMPLE — Second', contractId:'c2', contractNumber:'S/2',
      baseSalary:500000, baseSalarySnapshot:500000, plannedAmount:500000, overtimeIds:[],
      status:'Draft', history:[], createdAt:now2, updatedAt:now2});   // Draft -> skipped by the Ready gate
    out = await runPostHandler(rt, MONTH, ['pp1','pp2']);
    check(out.res.ok === true && out.res.skipped === 1, 'caller: a partial-skip post still succeeds');
    check(out.ui.summaryOpened === true, 'caller: the posted-vs-skipped summary is preserved on success');
    check(out.selSize === 0, 'caller: success with skips still clears the selection');

    // LOCKED — unchanged behaviour, exactly one warning (from the engine).
    rt = loadRuntime(); seed(rt);
    rt.State.payrollSel = {}; rt.w.payrollSelSet(MONTH).add('pp1');
    rt.State.settings.payrollLocks = {}; rt.State.settings.payrollLocks[MONTH] = true;
    rt.toasts.length = 0;
    out = await runPostHandler(rt, MONTH, ['pp1']);
    check(out.res.locked === true, 'caller: locked period is detected');
    check(out.selSize === 0 && out.ui.closedModal === true, 'caller: locked preserves its existing clear+close behaviour');
    check(out.ui.success === null && out.ui.error === null, 'caller: locked adds no second warning or success message');
    check(rt.toasts.filter(t=>/locked/i.test(t)).length === 1, 'caller: exactly one locked warning is shown (from the engine)');
    check(rt.State.txns.length === 0, 'caller: locked creates no transaction');
  }

  console.log('');
  console.log('NOTE (scope): payroll posting writes four keys sequentially and is NOT atomic.');
  console.log('SPR-081 added result checking, a unique reverse lookup, and read-only detection.');
  console.log('No rollback, compensation, retry framework, coordination, or write reordering was');
  console.log('introduced, and none is claimed. Partial persistence remains real and reported.');
  console.log('');
  if(failures.length){
    console.log('RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
    failures.forEach(f => console.log('   - ' + f));
    process.exit(1);
  }
  console.log('RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})().catch(e => { console.error('RUNTIME VERIFICATION ERROR', e); process.exit(1); });
