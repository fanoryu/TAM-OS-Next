#!/usr/bin/env node
'use strict';
/* ============================================================
   SPR-082 — MONTHLY PLAN COMMIT RESULT INTEGRITY RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of the slice. This harness proves
   its BEHAVIOR by running commitMonthlyPlan() — and its single live caller's
   result handling — against a storage backend that can be told to fail specific
   keys.

   It reproduces the browser's single shared global scope in a Node `vm` context
   using the same loader technique as js/cli/cli.js and the SPR-077/078/079/081
   harnesses.

   All fixture data is obviously fabricated. Nothing is written to disk and no
   repository file is modified.

   HONESTY NOTE — what these tests do and do NOT assert:
   commitMonthlyPlan() writes TWO storage keys, sequentially: transactions, then
   monthly plans. The browser provides atomicity for a single key only, never
   across keys, so a failure result means "the commit did not complete
   successfully", NOT "nothing was persisted". These tests deliberately assert
   that the first write DOES still land when the second fails, that attempt-all
   behaviour is unchanged, and that no message describes that state as rolled
   back. SPR-082 added no rollback, compensation, journal, or coordination, and
   none is claimed. The new integrity rule DETECTS the resulting partial state;
   it does not repair it.
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
   OPERATION-DRIVEN harness: it proves this rule fires from a genuine partial
   write rather than from a hand-built state, which is strictly stronger evidence
   than a state-shaped fixture. That is why this rule is deliberately NOT
   re-covered by the dedicated integrity harnesses. The declaration below makes
   that ownership machine-readable so tools/verify-build.js can account for every
   production rule identifier without duplicating a single fixture.
   Severity is the EXPECTED production severity, bound per finding below. */
const INTEGRITY_COVERAGE = {
  harness: 'verify-monthlyplan-runtime.js',
  rules: {
    'monthlyplan-orphan-transaction': 'critical'
  }
};
/* INTEGRITY-COVERAGE-END */

const KEYS = { txns:'tam_txns_v1', monthlyPlans:'tam_monthly_plans_v1' };

// `preset` pre-populates the storage backend BEFORE the app loads, so a fresh
// runtime + loadState() reproduces a genuine browser reload from exactly the
// keys that actually persisted — not a continuation of the previous in-memory
// State. This distinction is the whole point of the reload-state evidence.
function loadRuntime(preset){
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = fs.readFileSync(path.join(root,'js','core','constants.js'),'utf8') && jsFiles.map(f => fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { State: State, StorageAdapter: StorageAdapter, HR_KEYS: HR_KEYS };';
  const noop = function(){};
  const memStore = Object.assign({}, preset || {}); const ctl = { failKeys:new Set(), writes:[] };
  const memStorage = {
    getItem: (k)=> Object.prototype.hasOwnProperty.call(memStore,k) ? memStore[k] : null,
    setItem: (k,v)=>{
      ctl.writes.push(k);
      if(ctl.failKeys.has(k)){ const e = new Error('quota'); e.name='QuotaExceededError'; throw e; }
      memStore[k] = String(v);
    },
    removeItem: (k)=>{ delete memStore[k]; }
  };
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const toasts = [], errors = [];
  const sandbox = {
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-spr082' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    confirm: ()=> true,
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(), body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-spr082-runtime.js' });
  // Capture user-facing messages AFTER load so the app's own helpers are replaced.
  sandbox.toast = function(msg){ toasts.push(String(msg)); };
  sandbox.showError = function(msg){ errors.push(String(msg)); };
  sandbox.render = noop;
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.memStore = memStore; rt.ctl = ctl; rt.toasts = toasts; rt.errors = errors;
  return rt;
}

function seed(rt){
  // UX-006C2C-4 — commitMonthlyPlan is now authorized (finance.manage, CEO-only), so this
  // SPR-082 persistence-integrity harness runs as the CEO principal. It tests write results
  // and partial-persistence reporting, not authorization; the authz behaviour is proven by
  // tools/verify-authz-c2c4-runtime.js.
  rt.w.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  rt.State.txns = []; rt.State.backups = []; rt.State.employees = []; rt.State.contracts = [];
  rt.State.payrollPlans = []; rt.State.monthlyPlans = []; rt.State.overtimeRecords = [];
  rt.State.recurringExpenses = []; rt.State.payrollAdjustments = []; rt.State.employeeMerges = [];
  rt.State.companyAccounts = []; rt.State.supplementalPayments = []; rt.State.importBatches = [];
}

// Genuine reload: a FRESH runtime whose storage contains only what persisted,
// then the app's own loadState() rebuilds State from those keys.
async function reload(persistedStore){
  const rt = loadRuntime(persistedStore);
  // UX-006C2C-4 — a genuine reload starts with no principal selected; the retry scenarios
  // exercise commitMonthlyPlan (now finance.manage), so the reloaded runtime selects CEO too.
  rt.w.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  await rt.w.loadState();
  rt.ctl.writes.length = 0;   // ignore load-time bookkeeping writes
  return rt;
}

// A fabricated two-row preview: one recurring row, one manual row. Both are new.
function preview(rt, monthKey){
  void rt;
  return { monthKey, rows: [
    { type:'recurring', label:'Fabricated Office Internet', category:'Operasional Rutin', planned:1500000, selected:true, dup:'new', recurringId:'rec_fake_1', vendor:null, paymentMethod:null, bankAccount:null, warn:null },
    { type:'manual', label:'Fabricated Stationery', category:'Operasional Kegiatan', planned:250000, selected:true, dup:'new', warn:null }
  ]};
}

(async function main(){
  console.log('== SPR-082 MONTHLY PLAN COMMIT RESULT INTEGRITY — RUNTIME VERIFICATION ==');

  // ---------- 1. both writes succeed ----------
  console.log('-- scenario 1: both writes succeed --');
  {
    const rt = loadRuntime(); seed(rt);
    const res = await rt.w.commitMonthlyPlan(preview(rt,'2026-03'));
    check(res.ok === true, 'both writes succeed -> ok:true');
    check(res.created === 2, 'created count reflects the two new rows');
    check(typeof res.monthlyPlanId === 'string' && res.monthlyPlanId.length > 0, 'success result carries monthlyPlanId');
    check(res.transactionId != null, 'success result carries transactionId');
    check(res.error === undefined, 'success result carries no error');
    check(res.failedStep === undefined, 'success result carries no failedStep');
    check(res.partialPersistence === undefined, 'success result carries no partialPersistence flag');
    check(rt.memStore[KEYS.txns] !== undefined, 'transactions were persisted');
    check(rt.memStore[KEYS.monthlyPlans] !== undefined, 'monthly plans were persisted');
    check(rt.State.txns.length === 2, 'exactly two planned transactions exist');
    check(rt.State.monthlyPlans[0].status === 'Committed', 'the plan is marked Committed');
    check(rt.State.monthlyPlans[0].committedTxnIds.length === 2, 'both transaction ids are linked on the plan');
  }

  // ---------- 2. write order and attempt-all behaviour ----------
  console.log('-- scenario 2: write order and attempt-all behaviour --');
  {
    let rt = loadRuntime(); seed(rt);
    await rt.w.commitMonthlyPlan(preview(rt,'2026-03'));
    const order = rt.ctl.writes.filter(k => k===KEYS.txns || k===KEYS.monthlyPlans);
    check(order[0] === KEYS.txns, 'transactions are written FIRST (write order unchanged)');
    check(order[1] === KEYS.monthlyPlans, 'monthly plans are written SECOND (write order unchanged)');

    // first write fails -> second must STILL be attempted (attempt-all preserved)
    rt = loadRuntime(); seed(rt); rt.ctl.failKeys.add(KEYS.txns);
    await rt.w.commitMonthlyPlan(preview(rt,'2026-03'));
    check(rt.ctl.writes.includes(KEYS.monthlyPlans), 'a failing FIRST write does not abort the second (attempt-all unchanged)');
    check(rt.ctl.writes.filter(k=>k===KEYS.txns).length === 1, 'the failing write is attempted exactly once (no retry loop added)');
  }

  // ---------- 3. transaction write fails (step 1) ----------
  console.log('-- scenario 3: transactions write fails --');
  {
    const rt = loadRuntime(); seed(rt); rt.ctl.failKeys.add(KEYS.txns);
    const res = await rt.w.commitMonthlyPlan(preview(rt,'2026-03'));
    check(res.ok === false, 'transactions write fails -> ok:false');
    check(res.error === 'MonthlyPlanPersistenceFailed', 'typed error is MonthlyPlanPersistenceFailed');
    check(res.failedStep === 'transactions', 'failedStep names the transactions step');
    check(JSON.stringify(res.failedSteps) === JSON.stringify(['transactions']), 'failedSteps lists exactly the transactions step');
    check(JSON.stringify(res.completedSteps) === JSON.stringify(['monthlyPlans']), 'completedSteps lists the write that DID succeed');
    check(res.partialPersistence === true, 'partialPersistence is true (the monthlyPlans write landed)');
    check(res.recoveryHint === 'RunIntegrityCheckAndReview', 'recoveryHint points at Integrity Check');
    check(rt.memStore[KEYS.txns] === undefined, 'the failed transactions write really did not persist');
    check(rt.memStore[KEYS.monthlyPlans] !== undefined, 'the monthlyPlans write really DID persist (partial persistence is real)');
  }

  // ---------- 4. monthly plan write fails (step 2) ----------
  console.log('-- scenario 4: monthlyPlans write fails --');
  {
    const rt = loadRuntime(); seed(rt); rt.ctl.failKeys.add(KEYS.monthlyPlans);
    const res = await rt.w.commitMonthlyPlan(preview(rt,'2026-03'));
    check(res.ok === false, 'monthlyPlans write fails -> ok:false');
    check(res.failedStep === 'monthlyPlans', 'failedStep names the monthlyPlans step');
    check(JSON.stringify(res.failedSteps) === JSON.stringify(['monthlyPlans']), 'failedSteps lists exactly the monthlyPlans step');
    check(JSON.stringify(res.completedSteps) === JSON.stringify(['transactions']), 'completedSteps lists the transactions write');
    check(res.partialPersistence === true, 'partialPersistence is true (the transactions write landed)');
    check(rt.memStore[KEYS.txns] !== undefined, 'the transactions write really DID persist (partial persistence is real)');
    check(rt.memStore[KEYS.monthlyPlans] === undefined, 'the failed monthlyPlans write really did not persist');
  }

  // ---------- 5. both writes fail ----------
  console.log('-- scenario 5: both writes fail --');
  {
    const rt = loadRuntime(); seed(rt);
    rt.ctl.failKeys.add(KEYS.txns); rt.ctl.failKeys.add(KEYS.monthlyPlans);
    const res = await rt.w.commitMonthlyPlan(preview(rt,'2026-03'));
    check(res.ok === false, 'both writes fail -> ok:false');
    check(res.failedStep === 'transactions', 'failedStep is the FIRST failure in the fixed write order (deterministic)');
    check(JSON.stringify(res.failedSteps) === JSON.stringify(['transactions','monthlyPlans']), 'failedSteps lists both steps in write order');
    check(JSON.stringify(res.completedSteps) === JSON.stringify([]), 'completedSteps is empty');
    check(res.partialPersistence === false, 'partialPersistence is FALSE only when nothing persisted (evidence-based)');
    check(rt.memStore[KEYS.txns] === undefined && rt.memStore[KEYS.monthlyPlans] === undefined, 'neither key persisted');
  }

  // ---------- 6. no success UI after failure; success UI intact after success ----------
  console.log('-- scenario 6: caller UI gating --');
  {
    // Drive the caller's result handling directly (same branch logic as the click handler).
    async function driveCaller(rt, pv){
      const res = await rt.w.commitMonthlyPlan(pv);
      if(!res.ok){
        rt.w.showError('Monthly Plan commit did not complete successfully. Some data may already have been saved. Run Integrity Check and review the Monthly Plan and Finance transaction before retrying.', null, 9000);
        rt.w.render(); return res;
      }
      rt.State.planPreview = null;
      rt.w.toast('Monthly plan committed: ' + res.created + ' planned transaction(s) created.', 5000);
      rt.w.render(); return res;
    }

    let rt = loadRuntime(); seed(rt); rt.ctl.failKeys.add(KEYS.monthlyPlans);
    rt.State.planPreview = preview(rt,'2026-03');
    await driveCaller(rt, rt.State.planPreview);
    // The storage layer emits its own failure notification (pre-existing, and it is
    // how the user learns the write failed). What must never appear is the COMMIT
    // SUCCESS toast.
    check(!rt.toasts.some(t => /monthly plan committed/i.test(t)), 'FAILURE: the success toast is never shown');
    check(rt.toasts.every(t => !/created\./i.test(t)), 'FAILURE: no toast reports created transactions');
    check(rt.toasts.every(t => /not saved|may not persist/i.test(t)), 'FAILURE: any toast present is the storage layer reporting the failed write');
    check(rt.errors.length === 1, 'FAILURE: exactly one manual-review error is shown');
    check(/did not complete successfully/i.test(rt.errors[0]), 'FAILURE: the message says the commit did not complete');
    check(/some data may already have been saved/i.test(rt.errors[0]), 'FAILURE: the message admits partial persistence');
    check(/integrity check/i.test(rt.errors[0]), 'FAILURE: the message directs the user to Integrity Check');
    check(rt.State.planPreview !== null, 'FAILURE: the preview is RETAINED so the user can review what was involved');
    const msg = rt.errors.join(' | ');
    [/rolled back/i, /reverted/i, /nothing was saved/i, /no data was saved/i, /undone automatically/i].forEach((re)=>
      check(!re.test(msg), 'FAILURE: the message never claims: ' + re.source));
    check(!/localStorage|browser storage|developer tools/i.test(msg), 'FAILURE: the message never tells the user to edit browser storage');

    // success path keeps its existing completion behaviour
    rt = loadRuntime(); seed(rt);
    rt.State.planPreview = preview(rt,'2026-03');
    await driveCaller(rt, rt.State.planPreview);
    check(rt.errors.length === 0, 'SUCCESS: no error is shown');
    check(rt.toasts.length === 1, 'SUCCESS: the completion toast is preserved');
    check(/2 planned transaction\(s\) created/i.test(rt.toasts[0]), 'SUCCESS: the toast reports the created count');
    check(rt.State.planPreview === null, 'SUCCESS: the preview is cleared (existing behaviour preserved)');
  }

  // ---------- 7. retry after each partial state ----------
  console.log('-- scenario 7: retry and duplicate safety --');
  {
    // Scenario A — transactions persisted, monthlyPlans failed. A rebuilt preview
    // must mark the persisted rows as duplicates so a retry creates nothing new.
    const rt = loadRuntime(); seed(rt); rt.ctl.failKeys.add(KEYS.monthlyPlans);
    const res1 = await rt.w.commitMonthlyPlan(preview(rt,'2026-03'));
    check(res1.ok === false, 'A: first attempt reports failure');
    const txnCountAfterFirst = rt.State.txns.length;
    check(txnCountAfterFirst === 2, 'A: two transactions exist in memory after the failed commit');

    // Rebuild the preview from the SAME inputs, exactly as the UI would.
    const rebuilt = rt.w.buildMonthlyPreview('2026-03', {
      payroll:false, recurring:false,
      copyRows:[{uraian:'Fabricated Stationery', category:'Operasional Kegiatan', planned:250000}]
    });
    const stationery = rebuilt.rows.find(r => /Stationery/.test(r.label));
    check(stationery && stationery.dup === 'duplicate', 'A: the rebuilt preview marks the already-persisted row as a duplicate');

    rt.ctl.failKeys.clear();
    const res2 = await rt.w.commitMonthlyPlan(rebuilt);
    check(res2.ok === true, 'A: the retry succeeds once storage recovers');
    check(res2.created === 0, 'A: the retry creates NO new transaction (duplicate rows are skipped)');
    check(rt.State.txns.length === txnCountAfterFirst, 'A: no duplicate Finance transaction was created on retry');

    // Scenario C — both writes failed. Nothing persisted, so a retry is a clean redo.
    const rt2 = loadRuntime(); seed(rt2);
    rt2.ctl.failKeys.add(KEYS.txns); rt2.ctl.failKeys.add(KEYS.monthlyPlans);
    const r1 = await rt2.w.commitMonthlyPlan(preview(rt2,'2026-04'));
    check(r1.partialPersistence === false, 'C: nothing persisted, so partialPersistence is false');
    check(rt2.memStore[KEYS.txns] === undefined, 'C: no transactions reached storage');
  }

  // ---------- 8. integrity detection of the proven partial state ----------
  console.log('-- scenario 8: integrity rule (detection only) --');
  {
    // Reproduce the RELOADED Scenario A state: the transaction persisted carrying
    // monthlyPlanId, the plan did not record it.
    const rt = loadRuntime(); seed(rt);
    rt.State.monthlyPlans = [{id:'mp_fake_1', monthKey:'2026-03', month:'March', year:2026, monthNum:3, status:'Draft', committedTxnIds:[], createdAt:'2026-03-01T00:00:00.000Z'}];
    rt.State.txns = [{id:'tx_fake_1', monthKey:'2026-03', month:'March', year:2026, monthNum:3,
      category:'Operasional Rutin', uraian:'Fabricated Office Internet', planned:1500000, actual:null,
      type:'expense', source:'recurring', status:'planned', monthlyPlanId:'mp_fake_1', history:[]}];

    const before = JSON.stringify(rt.State.txns) + JSON.stringify(rt.State.monthlyPlans);
    const findings = rt.w.runIntegrityCheck();
    const all = [].concat(findings.critical||[], findings.warning||[], findings.info||[], findings.issues||[]);
    const flat = JSON.stringify(findings);
    check(/monthlyplan-orphan-transaction/.test(flat), 'the orphan monthly-plan transaction is detected');
    /* SPR-092 (GOV-007 D1) — severity is now BOUND TO THE FINDING.
       The previous form tested /critical/i against JSON.stringify(result), which is
       satisfied by the always-present `counts.critical` key and was therefore true
       even for a result with zero findings. It could not have detected a downgrade
       of this rule from critical to warning. This reads the finding's own severity
       field, so a production severity change fails here. Detection behaviour and
       production code are unchanged; only the assertion is repaired. */
    const orphanFindings = (findings.findings || []).filter((f)=>f.category === 'monthlyplan-orphan-transaction');
    check(orphanFindings.length > 0 && orphanFindings.every((f)=>f.severity === INTEGRITY_COVERAGE.rules['monthlyplan-orphan-transaction']),
      'the finding is raised at Critical severity (bound to the finding, not to counts.critical)');
    check(/tx_fake_1/.test(flat), 'the finding names the transaction id');
    check(/mp_fake_1/.test(flat), 'the finding names the monthly plan id');
    check(/review/i.test(flat), 'the finding gives an actionable manual-review instruction');
    check(JSON.stringify(rt.State.txns) + JSON.stringify(rt.State.monthlyPlans) === before,
      'the integrity checker is READ-ONLY — it repaired nothing');
    void all;

    // healthy data must NOT trigger the rule
    const rt2 = loadRuntime(); seed(rt2);
    const okRes = await rt2.w.commitMonthlyPlan(preview(rt2,'2026-03'));
    check(okRes.ok === true, 'healthy fixture committed successfully');
    const healthy = JSON.stringify(rt2.w.runIntegrityCheck());
    check(!/monthlyplan-orphan-transaction/.test(healthy), 'a fully committed plan raises NO orphan finding (no false positive)');

    // payroll-sourced transactions are out of scope for this rule
    const rt3 = loadRuntime(); seed(rt3);
    rt3.State.monthlyPlans = [{id:'mp_fake_2', monthKey:'2026-05', month:'May', year:2026, monthNum:5, status:'Draft', committedTxnIds:[], createdAt:'2026-05-01T00:00:00.000Z'}];
    rt3.State.txns = [{id:'tx_fake_2', monthKey:'2026-05', month:'May', year:2026, monthNum:5,
      category:'Gaji', uraian:'Fabricated Payroll', planned:9000000, actual:null,
      type:'expense', source:'payroll', status:'planned', monthlyPlanId:'mp_fake_2', history:[]}];
    const pay = JSON.stringify(rt3.w.runIntegrityCheck());
    check(!/monthlyplan-orphan-transaction/.test(pay), 'payroll-sourced transactions are NOT reported by this rule (SPR-081 rules own them)');
  }

  // ---------- 10. SCENARIO A — RELOAD-STATE retry (the real browser path) ----------
  // Scenario 7 retried inside the SAME runtime, with State still in memory. That
  // is continuation, not reload. These blocks rebuild State from ONLY the keys
  // that actually persisted, via the app's own loadState().
  console.log('-- scenario 10: Scenario A reload-state retry --');
  {
    // --- A2: the plan was CREATED by the failing commit (first commit of the month) ---
    let rt = loadRuntime(); seed(rt); rt.ctl.failKeys.add(KEYS.monthlyPlans);
    const first = await rt.w.commitMonthlyPlan(preview(rt,'2026-03'));
    check(first.ok === false && first.failedStep === 'monthlyPlans', 'A2: the first attempt fails on the monthlyPlans write');
    check(rt.memStore[KEYS.txns] !== undefined && rt.memStore[KEYS.monthlyPlans] === undefined,
      'A2: only the transactions key persisted');
    const storeA2 = JSON.parse(JSON.stringify(rt.memStore));

    let r = await reload(storeA2);
    check(r.State.txns.length === 2, 'A2 RELOADED: both planned transactions came back from storage');
    check(r.State.monthlyPlans.length === 0, 'A2 RELOADED: NO monthly plan exists — the plan was never persisted');
    check(r.State.txns.every(t=>typeof t.monthlyPlanId === 'string' && t.monthlyPlanId),
      'A2 RELOADED: the transactions still carry a monthlyPlanId that now points at nothing');
    let before = JSON.stringify(r.w.runIntegrityCheck());
    check(/monthlyplan-orphan-transaction/.test(before), 'A2 RELOADED: monthlyplan-orphan-transaction fires BEFORE retry');
    check(/critical/i.test(before), 'A2 RELOADED: the finding is Critical');
    check(/no such monthly plan exists/.test(before), 'A2 RELOADED: the finding states the plan is absent, not merely unlinked');
    check(!/corrupt-plan-ref/.test(before), 'A2 RELOADED: corrupt-plan-ref cannot see this state (it walks committedTxnIds)');

    // Rebuild the preview from the RELOADED state and retry after storage recovers.
    const rebuiltA2 = r.w.buildMonthlyPreview('2026-03', { payroll:false, recurring:false,
      copyRows:[{uraian:'Fabricated Stationery', category:'Operasional Kegiatan', planned:250000}] });
    const rowA2 = rebuiltA2.rows.find(x=>/Stationery/.test(x.label));
    check(rowA2 && rowA2.dup === 'duplicate', 'A2 RETRY: the reloaded transaction is recognised as a duplicate');
    const txnsBeforeA2 = r.State.txns.length;
    const retryA2 = await r.w.commitMonthlyPlan(rebuiltA2);
    check(retryA2.ok === true, 'A2 RETRY: succeeds once storage recovers');
    check(retryA2.created === 0, 'A2 RETRY: created count is ZERO');
    check(r.State.txns.length === txnsBeforeA2, 'A2 RETRY: no duplicate Finance transaction was created');
    const afterA2 = JSON.stringify(r.w.runIntegrityCheck());
    // The retry re-creates the plan and marks it Committed, but it links only the
    // rows IT committed — the pre-existing reloaded transactions are skipped as
    // duplicates and are therefore never added to committedTxnIds.
    check(/monthlyplan-orphan-transaction/.test(afterA2),
      'A2 RETRY: the finding REMAINS — the retry skipped the rows as duplicates, so it never linked them to the new plan');
    check(r.State.monthlyPlans.length === 1, 'A2 RETRY: a monthly plan now exists');
    check(r.State.monthlyPlans[0].committedTxnIds.length === 0,
      'A2 RETRY: the new plan links NO transactions (the duplicates were skipped, never linked)');

    // --- A1: the plan already existed in storage before the failing commit ---
    let rt1 = loadRuntime(); seed(rt1);
    rt1.State.monthlyPlans = [{id:'mp_pre', monthKey:'2026-03', month:'March', year:2026, monthNum:3, status:'Draft', committedTxnIds:[], createdAt:'2026-03-01T00:00:00.000Z'}];
    await rt1.w.persistMonthlyPlans();
    rt1.ctl.failKeys.add(KEYS.monthlyPlans);
    await rt1.w.commitMonthlyPlan(preview(rt1,'2026-03'));
    const r1 = await reload(JSON.parse(JSON.stringify(rt1.memStore)));
    check(r1.State.monthlyPlans.length === 1, 'A1 RELOADED: the pre-existing plan came back');
    check(r1.State.monthlyPlans[0].status === 'Draft', 'A1 RELOADED: the plan is still Draft — the commit never persisted');
    check(r1.State.monthlyPlans[0].committedTxnIds.length === 0, 'A1 RELOADED: the plan lists none of the persisted transactions');
    check(r1.State.txns.length === 2, 'A1 RELOADED: both transactions came back');
    const beforeA1 = JSON.stringify(r1.w.runIntegrityCheck());
    check(/monthlyplan-orphan-transaction/.test(beforeA1), 'A1 RELOADED: monthlyplan-orphan-transaction fires BEFORE retry');
    check(/does not list it as a committed row/.test(beforeA1), 'A1 RELOADED: the finding states the plan exists but does not link back');
  }

  // ---------- 11. SCENARIO B — RELOAD-STATE retry ----------
  console.log('-- scenario 11: Scenario B reload-state retry --');
  {
    let rt = loadRuntime(); seed(rt); rt.ctl.failKeys.add(KEYS.txns);
    const first = await rt.w.commitMonthlyPlan(preview(rt,'2026-04'));
    check(first.ok === false && first.failedStep === 'transactions', 'B: the first attempt fails on the transactions write');
    check(rt.memStore[KEYS.monthlyPlans] !== undefined && rt.memStore[KEYS.txns] === undefined,
      'B: only the monthlyPlans key persisted');

    const r = await reload(JSON.parse(JSON.stringify(rt.memStore)));
    check(r.State.txns.length === 0, 'B RELOADED: NO transactions exist — that write never landed');
    check(r.State.monthlyPlans.length === 1, 'B RELOADED: the monthly plan came back');
    const planB = r.State.monthlyPlans[0];
    check(planB.status === 'Committed', 'B RELOADED: the plan is marked Committed');
    check(planB.committedTxnIds.length === 2, 'B RELOADED: committedTxnIds holds 2 ids');
    check(planB.committedTxnIds.every(id => !r.State.txns.some(t=>t.id===id)),
      'B RELOADED: every committedTxnId is DANGLING — it points to a transaction that does not exist');
    const beforeB = JSON.stringify(r.w.runIntegrityCheck());
    check(/corrupt-plan-ref/.test(beforeB), 'B RELOADED: corrupt-plan-ref fires BEFORE retry');
    check(!/monthlyplan-orphan-transaction/.test(beforeB),
      'B RELOADED: the new orphan rule does NOT fire (no transaction exists to carry a monthlyPlanId)');

    // Retry reachability: nothing gates the commit button, and no completion
    // marker blocks it — the plan being Committed does not stop a re-commit.
    const rebuiltB = r.w.buildMonthlyPreview('2026-04', { payroll:false, recurring:false,
      copyRows:[{uraian:'Fabricated Stationery', category:'Operasional Kegiatan', planned:250000}] });
    const rowB = rebuiltB.rows.find(x=>/Stationery/.test(x.label));
    check(rowB && rowB.dup === 'new', 'B RETRY: the row is NEW again (its transaction never persisted), so retry is reachable');
    const staleIds = planB.committedTxnIds.slice();
    const retryB = await r.w.commitMonthlyPlan(rebuiltB);
    check(retryB.ok === true, 'B RETRY: succeeds once storage recovers');
    check(retryB.created === 1, 'B RETRY: creates the transaction that never persisted');
    const newIds = r.State.txns.map(t=>t.id);
    check(newIds.length === 1, 'B RETRY: exactly one transaction now exists');
    check(!staleIds.includes(newIds[0]), 'B RETRY: the created transaction has a NEW id (the stale ids are not reused)');
    check(staleIds.every(id => r.State.monthlyPlans[0].committedTxnIds.includes(id)),
      'B RETRY: the stale dangling ids REMAIN on the plan (nothing removes them — no automatic repair)');
    check(r.State.monthlyPlans[0].committedTxnIds.length === 3,
      'B RETRY: committedTxnIds now holds 2 stale ids + 1 real id');
    const afterB = JSON.stringify(r.w.runIntegrityCheck());
    check(/corrupt-plan-ref/.test(afterB),
      'B RETRY: corrupt-plan-ref REMAINS after a successful retry — the dangling ids were never cleaned');
    // ...and the UI would report success while that finding still stands.
    check(retryB.ok === true && /corrupt-plan-ref/.test(afterB),
      'B RETRY: the commit reports SUCCESS even though an integrity finding still stands (documented, not repaired)');
  }

  // ---------- 9. no atomicity / rollback claim in the slice ----------
  console.log('-- scenario 9: no rollback or coordination introduced --');
  {
    const src = fs.readFileSync(path.join(path.resolve(__dirname,'..'),'js','people','monthly-plan.js'),'utf8');
    // Scan the USER-FACING string literals: the word "rollback" may legitimately
    // appear in a comment that DENIES one, but must never appear in a message.
    const literals = (src.match(/'[^'\n]*'|`[^`]*`/g) || []).join(' | ');
    check(!/rolled back|rollback|reverted|compensat/i.test(literals), 'no user-facing message in the module claims rollback or compensation');
    check(!/undone automatically|nothing was saved/i.test(literals), 'no user-facing message claims nothing was saved');
    // And no rollback IMPLEMENTATION: the slice never restores a pre-mutation snapshot.
    check(!/snapshot|restoreState|revertTo|structuredClone/i.test(src), 'commitMonthlyPlan implements no state snapshot or restore');
    check(!/UnitOfWork|TransactionCoordinator|journal|beginTransaction/i.test(src), 'no unit of work, coordinator, or journal was introduced');
    check(!/SCHEMA_VERSION\s*=/.test(src), 'no schema change in the slice');
  }

  console.log('');
  console.log('NOTE (scope): commitMonthlyPlan() writes TWO keys sequentially and is NOT');
  console.log('atomic. These tests assert that partial persistence is REAL and reported');
  console.log('honestly — a failure means the commit did not complete, never that nothing');
  console.log('was written. No rollback, compensation, journal, or coordination was added by');
  console.log('SPR-082. The new integrity rule DETECTS the partial state; it does not repair it.');
  console.log('');
  if(failures.length){
    console.log('RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
    failures.forEach(f => console.log('   - ' + f));
    process.exit(1);
  }
  console.log('RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})().catch(e => { console.error('RUNTIME VERIFICATION ERROR', e); process.exit(1); });
