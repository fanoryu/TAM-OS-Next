#!/usr/bin/env node
'use strict';
/* ============================================================
   SPR-079 — saveAllData() RESULT INTEGRITY RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of the slice. This harness proves
   its BEHAVIOR by running saveAllData() and each live caller against a storage
   backend that can be told to fail specific keys, at specific positions in the
   fan-out, or to throw.

   It reproduces the browser's single shared global scope in a Node `vm` context
   using the same loader technique as js/cli/cli.js and the SPR-077/078 harnesses.

   All fixture data is obviously fabricated. Nothing is written to disk and no
   repository file is modified.

   HONESTY NOTE — what these tests do and do NOT assert:
   saveAllData() writes one storage key per dataset. The browser provides
   atomicity for a single key only, never across keys, so a `false` result means
   "the operation did not complete successfully", NOT "nothing was persisted".
   These tests deliberately assert that earlier writes in a failing fan-out DO
   still land, and that no caller describes that state as rolled back. SPR-079
   added no rollback, retry, journal, or coordination, and none is claimed.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

// ctl.failKeys  — Set of storage keys whose writes should fail
// ctl.throwKeys — Set of storage keys whose writes should THROW instead
function loadRuntime(){
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { State: State, StorageAdapter: StorageAdapter, HR_KEYS: HR_KEYS };';
  const noop = function(){};
  const memStore = {}; const ctl = { failKeys:new Set(), throwKeys:new Set(), writes:[] };
  const memStorage = {
    getItem: (k)=> Object.prototype.hasOwnProperty.call(memStore,k) ? memStore[k] : null,
    setItem: (k,v)=>{
      ctl.writes.push(k);
      if(ctl.throwKeys.has(k)){ throw new Error('simulated non-quota storage fault for ' + k); }
      if(ctl.failKeys.has(k)){ const e = new Error('quota'); e.name='QuotaExceededError'; throw e; }
      memStore[k] = String(v);
    },
    removeItem: (k)=>{ delete memStore[k]; }
  };
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    getAttribute:()=>null, hasAttribute:()=>false, removeAttribute:noop, insertAdjacentHTML:noop, // UX-004D: #main now hosts the breadcrumb landmark
    classList:{ add:noop, remove:noop, toggle:noop, contains:()=>false }, focus:noop, blur:noop, // UX-004E: sidebarApplyState toggles classes on the shell
    remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const toasts = []; const confirms = { answer:true };
  const sandbox = {
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-spr079' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    confirm: ()=> confirms.answer,
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(), body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-spr079-runtime.js' });
  // Capture user-facing messages AFTER load so the app's own toast() is replaced.
  sandbox.toast = function(msg){ toasts.push(String(msg)); };
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.memStore = memStore; rt.ctl = ctl; rt.toasts = toasts; rt.confirms = confirms;
  return rt;
}

const KEYS = {
  txns: 'tam_txns_v1', settings: 'tam_settings_v1', backups: 'tam_backups_v1',
  employees: 'tam_employees_v1', contracts: 'tam_contracts_v1',
  importBatches: 'tam_import_batches_v1', employeeMerges: 'tam_employee_merges_v1',
  supplemental: 'tam_supplemental_payments_v1'
};

function seedMinimal(rt){
  // UX-006C2C-2 — commitSmartImport is now authorized (import.commit, CEO-only), so
  // this persistence-integrity harness runs as the CEO principal. SPR-079 is about
  // write results, not authorization; the authz behaviour itself is proven by
  // tools/verify-mutation-enforcement-finance-import-runtime.js.
  rt.w.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  rt.State.txns = []; rt.State.backups = []; rt.State.employees = []; rt.State.contracts = [];
  rt.State.payrollPlans = []; rt.State.monthlyPlans = []; rt.State.overtimeRecords = [];
  rt.State.recurringExpenses = []; rt.State.payrollAdjustments = []; rt.State.employeeMerges = [];
  rt.State.companyAccounts = []; rt.State.supplementalPayments = []; rt.State.importBatches = [];
}

(async function main(){
  console.log('== SPR-079 saveAllData RESULT INTEGRITY — RUNTIME VERIFICATION ==');

  // ---------- 1. saveAllData() result contract ----------
  console.log('-- scenario 1: saveAllData() result contract --');
  {
    // all writes succeed
    let rt = loadRuntime(); seedMinimal(rt);
    let r = await rt.w.saveAllData();
    check(r === true, 'all writes succeed -> returns true (strict boolean)');
    check(rt.ctl.writes.length === 14, 'the fan-out performs all 14 writes (txns + settings + backups + 11 HR keys)');

    // FIRST write fails (transactions is first in the fan-out)
    rt = loadRuntime(); seedMinimal(rt); rt.ctl.failKeys.add(KEYS.txns);
    r = await rt.w.saveAllData();
    check(r === false, 'FIRST write fails -> returns false');
    check(rt.memStore[KEYS.settings] !== undefined, 'first-write failure does not prevent later writes (fan-out is not atomic)');

    // MIDDLE write fails (an HR key in the middle of the list)
    rt = loadRuntime(); seedMinimal(rt); rt.ctl.failKeys.add(KEYS.contracts);
    r = await rt.w.saveAllData();
    check(r === false, 'MIDDLE write fails -> returns false');
    check(rt.memStore[KEYS.txns] !== undefined && rt.memStore[KEYS.employees] !== undefined, 'earlier writes still persisted (partial persistence is real and not hidden)');

    // FINAL write fails (last HR key in HR_KEYS order)
    const lastKey = rt.HR_KEYS[Object.keys(rt.HR_KEYS)[Object.keys(rt.HR_KEYS).length - 1]];
    rt = loadRuntime(); seedMinimal(rt); rt.ctl.failKeys.add(lastKey);
    r = await rt.w.saveAllData();
    check(r === false, 'FINAL write fails -> returns false');
    check(rt.memStore[KEYS.txns] !== undefined, 'a final-write failure does not un-persist earlier writes');

    // SEVERAL writes fail
    rt = loadRuntime(); seedMinimal(rt);
    rt.ctl.failKeys.add(KEYS.txns); rt.ctl.failKeys.add(KEYS.contracts); rt.ctl.failKeys.add(KEYS.employees);
    r = await rt.w.saveAllData();
    check(r === false, 'SEVERAL writes fail -> returns false');

    // EXCEPTION SEMANTICS — stated precisely, because the two cases are different.
    //
    // TESTED: localStorage.setItem() throws. StorageAdapter._localSet catches it
    // (and the claude-mode branch of .set likewise catches), records the fault, and
    // returns false. The promise handed to Promise.all therefore RESOLVES to false
    // — it is never rejected. saveAllData sees an ordinary false and reports false.
    //
    // NOT TESTED AND NOT CLAIMED: a persistence function returning an actually
    // REJECTED promise. saveAllData has no try/catch and no .catch(); a rejection
    // entering Promise.all would reject and propagate out of saveAllData to the
    // caller. No current code path produces that, so no behaviour is asserted for
    // it here and none should be inferred.
    rt = loadRuntime(); seedMinimal(rt); rt.ctl.throwKeys.add(KEYS.contracts);
    let threw = false;
    try { r = await rt.w.saveAllData(); } catch(e){ threw = true; }
    check(threw === false, 'a setItem() throw is caught by StorageAdapter and never reaches Promise.all as a rejection');
    check(r === false, 'a setItem() throw is normalised to a resolved false, so saveAllData returns false');
    check(rt.memStore[KEYS.txns] !== undefined, 'a throwing write does not abort the rest of the fan-out');

    // Result is a strict boolean in every case.
    rt = loadRuntime(); seedMinimal(rt);
    check(typeof (await rt.w.saveAllData()) === 'boolean', 'the result is always a strict boolean (contract unchanged)');
  }

  // ---------- 2. Employee merge caller ----------
  console.log('-- scenario 2: employee merge --');
  function seedMerge(rt){
    seedMinimal(rt);
    const now = new Date().toISOString();
    rt.State.employees = [
      {id:'e_canon', employeeId:'E1', fullName:'SAMPLE — Canonical', employmentStatus:'Active', active:true, createdAt:now, updatedAt:now, history:[]},
      {id:'e_dup',   employeeId:'E2', fullName:'SAMPLE — Canonical', employmentStatus:'Active', active:true, createdAt:now, updatedAt:now, history:[]}
    ];
    rt.State.contracts = [{id:'c1', employeeId:'e_dup', employeeName:'SAMPLE — Canonical', contractNumber:'S/1', startDate:'2025-01-01', durationMonths:12, monthlySalary:1000, status:'Active', createdAt:now, updatedAt:now, history:[]}];
  }
  {
    // success
    let rt = loadRuntime(); seedMerge(rt);
    let res = await rt.w.mergeEmployeeGroup('e_canon', ['e_dup'], {});
    check(res && res.ok === true, 'merge success -> { ok:true }');
    check(!!res.audit && res.audit.duplicateEmployeeIds.length === 1, 'merge success returns the audit record');
    check(rt.State.employees.length === 1, 'the duplicate master record was removed');
    check(rt.State.contracts[0].employeeId === 'e_canon', 'the contract was relinked to the canonical employee');
    check(rt.State.backups.length === 1, 'a pre-merge safety backup was taken');
    check(rt.memStore[KEYS.backups] !== undefined, 'the safety backup was persisted BEFORE the merge writes');

    // persistence failure
    rt = loadRuntime(); seedMerge(rt); rt.ctl.failKeys.add(KEYS.employeeMerges);
    res = await rt.w.mergeEmployeeGroup('e_canon', ['e_dup'], {});
    check(res && res.ok === false, 'merge persistence failure -> { ok:false }');
    check(rt.State.backups.length === 1 && rt.memStore[KEYS.backups] !== undefined, 'the safety backup survives a failed merge');
    check(res.audit !== undefined, 'the audit record is still returned for diagnostics');
    // Retry safety: the merge is idempotent over the same ids. Re-running it after
    // a failed persist neither re-merges nor corrupts — the duplicate is already
    // gone, links already point at the canonical record, and nothing is doubled.
    const empBefore = rt.State.employees.length, ctBefore = rt.State.contracts[0].employeeId;
    rt.ctl.failKeys.clear();
    const second = await rt.w.mergeEmployeeGroup('e_canon', ['e_dup'], {});
    check(second && second.ok === true, 'retry after failure completes once storage recovers');
    check(rt.State.employees.length === empBefore, 'retry does not remove another employee');
    check(rt.State.contracts[0].employeeId === ctBefore, 'retry leaves the relinked contract unchanged');
    check(rt.State.employees[0].id === 'e_canon', 'the canonical employee survives the retry intact');
  }

  // ---------- 3. Smart Import commit caller ----------
  console.log('-- scenario 3: Smart Import commit --');
  function importModel(){
    return { fileName:'SAMPLE.xlsx', batchId:'batch_sample_1', items:[], months:[] };
  }
  {
    // success
    let rt = loadRuntime(); seedMinimal(rt);
    let res = await rt.w.commitSmartImport(importModel());
    check(res && res.ok === true, 'import commit success -> { ok:true }');
    check(!!res.audit && res.audit.batchId === 'batch_sample_1', 'import commit success returns the audit record');
    let auditLog = JSON.parse(rt.memStore['tam_audit_log_v1'] || '[]');
    check(auditLog.filter(a=>a.type==='import.commit').length === 1, 'a success audit entry IS written when every write succeeds');

    // persistence failure
    rt = loadRuntime(); seedMinimal(rt); rt.ctl.failKeys.add(KEYS.importBatches);
    res = await rt.w.commitSmartImport(importModel());
    check(res && res.ok === false, 'import commit persistence failure -> { ok:false }');
    auditLog = JSON.parse(rt.memStore['tam_audit_log_v1'] || '[]');
    check(auditLog.filter(a=>a.type==='import.commit').length === 0, 'NO success audit entry is written on failure');
    check(rt.State.backups.length === 1 && rt.memStore[KEYS.backups] !== undefined, 'the pre-import safety backup survives a failed commit');
    check(rt.State.importBatches.length === 1 && rt.State.importBatches[0].undone === false, 'the batch is not marked undone by a failed commit');
  }

  // ---------- 4. Smart Import undo caller ----------
  console.log('-- scenario 4: Smart Import undo --');
  function seedUndo(rt){
    seedMinimal(rt);
    rt.State.importBatches = [{batchId:'b1', fileName:'SAMPLE.xlsx', ts:new Date().toISOString(), mode:'smart', undone:false,
      created:{employees:[], contracts:[], payrollPlans:[], txns:[], monthlyPlanTxns:[]},
      counts:{employees:0, contracts:0, payrollPlans:0, txns:0, skipped:0, duplicatesSkipped:0, contractConflicts:0, uniqueEmployees:0}}];
  }
  {
    // success
    let rt = loadRuntime(); seedUndo(rt); rt.toasts.length = 0;
    await rt.w.undoLastSmartImport();
    check(rt.State.importBatches[0].undone === true, 'undo success marks the batch undone');
    check(rt.toasts.some(t=>/undone/i.test(t)), 'undo success shows the success message');
    check(!rt.toasts.some(t=>/could not be saved/i.test(t)), 'undo success shows no failure message');

    // persistence failure
    rt = loadRuntime(); seedUndo(rt); rt.toasts.length = 0; rt.ctl.failKeys.add(KEYS.importBatches);
    await rt.w.undoLastSmartImport();
    check(!rt.toasts.some(t=>/Smart Import undone/i.test(t)), 'undo failure shows NO success message');
    check(rt.toasts.some(t=>/could not be saved/i.test(t) && /not completed successfully/i.test(t)), 'undo failure states the operation did not complete successfully');

    // THE COMPLETION MARKER MUST NOT SURVIVE A FAILURE.
    // `undone` is both the completion marker AND the selector used to find the
    // batch (`find(b=>!b.undone)`). Before this fix it stayed true after a failed
    // write, which misrepresented completion in memory and blocked every further
    // attempt for the rest of the session.
    check(rt.State.importBatches[0].undone === false, 'undo failure clears the completion marker (no false completion in memory)');
    check(rt.State.importBatches[0].undoneAt === undefined, 'undo failure clears undoneAt');
    check(rt.State.importBatches[0].keptTxns === undefined, 'undo failure clears keptTxns');
    check(rt.State.importBatches.some(b=>!b.undone) === true, 'the batch is selectable again after a failed undo');

    // IMMEDIATE RETRY — same session, no reload, storage recovered.
    rt.ctl.failKeys.clear(); rt.ctl.writes.length = 0; rt.toasts.length = 0;
    await rt.w.undoLastSmartImport();
    check(!rt.toasts.some(t=>/No Smart Import batch available/i.test(t)), 'immediate retry is NOT blocked by the previous failure');
    check(rt.ctl.writes.length > 0, 'immediate retry reaches storage again');
    check(rt.toasts.some(t=>/Smart Import undone/i.test(t)), 'immediate retry succeeds once storage recovers');
    check(rt.State.importBatches[0].undone === true, 'the completion marker is set only after a successful retry');
    check(rt.State.importBatches.filter(b=>b.batchId==='b1').length === 1, 'retry does not duplicate the batch record');

    // RETRY AFTER RELOAD — the batch write failed, so storage still holds
    // undone:false. Rebuilding State from what actually persisted must stay
    // retryable, and the retry must complete.
    rt = loadRuntime(); seedUndo(rt);
    rt.memStore[KEYS.importBatches] = JSON.stringify(rt.State.importBatches);   // prior successful commit
    rt.ctl.failKeys.add(KEYS.importBatches);
    await rt.w.undoLastSmartImport();
    const reloaded = loadRuntime(); seedUndo(reloaded);
    reloaded.State.importBatches = JSON.parse(rt.memStore[KEYS.importBatches]); // reload = read storage
    check(reloaded.State.importBatches[0].undone === false, 'after reload the batch is still marked not-undone (the failed write never landed)');
    reloaded.ctl.writes.length = 0; reloaded.toasts.length = 0;
    await reloaded.w.undoLastSmartImport();
    check(reloaded.ctl.writes.length > 0, 'retry after reload reaches storage');
    check(reloaded.toasts.some(t=>/Smart Import undone/i.test(t)), 'retry after reload succeeds');
    check(reloaded.State.importBatches[0].undone === true, 'retry after reload completes the undo');

    // HONEST LIMIT — documented, not papered over. If the importBatches write
    // SUCCEEDS while another key fails, storage keeps undone:true while the other
    // dataset's removal did not land. That batch is not retryable after reload.
    // This is a consequence of non-atomic multi-key persistence, NOT something
    // SPR-079 introduced or claims to solve.
    rt = loadRuntime(); seedUndo(rt);
    rt.memStore[KEYS.importBatches] = JSON.stringify(rt.State.importBatches);
    rt.ctl.failKeys.add(KEYS.txns);                       // batch write lands, txns write fails
    await rt.w.undoLastSmartImport();
    const persistedBatch = JSON.parse(rt.memStore[KEYS.importBatches])[0];
    check(persistedBatch.undone === true, 'KNOWN LIMIT: a landed batch write records undone:true even though another key failed');
    check(rt.State.importBatches[0].undone === false, 'in-memory state still reports the operation as incomplete (honest for this session)');
  }

  // ---------- 5. No failure message claims a rollback ----------
  console.log('-- scenario 5: failure wording honesty --');
  {
    const rt = loadRuntime();
    const sources = ['js/people/employee-dedup.js','js/import/smart-import-commit.js','js/import/smart-import-ui.js']
      .map(f => fs.readFileSync(path.resolve(__dirname,'..',f),'utf8')).join('\n');
    const msgs = (sources.match(/showError\('[^']*'/g)||[]).join(' ');
    check(msgs.length > 0, 'failure messages are present to inspect');
    [/rolled back/i, /reverted/i, /nothing was changed/i, /no data was saved/i, /undone automatically/i].forEach((re)=>
      check(!re.test(msgs), 'no failure message claims: ' + re.source));
    check(/reload the page to return to the last saved state/i.test(msgs), 'failure messages give the honest recovery path (reload restores the last saved state)');
    check(/backup/i.test(msgs), 'failure messages point the user at the safety backup where one exists');
    void rt;
  }

  console.log('');
  console.log('NOTE (scope): saveAllData() writes one key per dataset and is NOT atomic.');
  console.log('These tests assert that partial persistence is REAL and reported honestly —');
  console.log('a false result means the operation did not complete, never that nothing was');
  console.log('written. No rollback, retry, journal, or coordination was added by SPR-079.');
  console.log('');
  if(failures.length){
    console.log('RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
    failures.forEach(f => console.log('   - ' + f));
    process.exit(1);
  }
  console.log('RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})().catch(e => { console.error('RUNTIME VERIFICATION ERROR', e); process.exit(1); });
