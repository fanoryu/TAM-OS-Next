#!/usr/bin/env node
'use strict';
/* ============================================================
   SPR-093 — CONTRACT PERSISTENCE HONESTY RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of the Contract editor and delete
   paths. This harness proves their BEHAVIOUR by executing the real production
   code against a storage backend that can fail the contracts key, then checking
   what the user was told, what was written to the activity log, and what state
   was left behind.

   Same dependency-free Node `vm` loader technique as js/cli/cli.js and the
   SPR-077/078/079/081/082/089/090/091 harnesses. All fixture data is obviously
   fabricated. Nothing is written to disk and no repository file is modified.

   SCOPE — the two persistence-honesty gaps recorded by ARCH-008 §7 ONLY:
     * the full Contract editor save (create and edit)
     * deleteContract
   Both remain DIRECT, residual write paths. SPR-093 does NOT migrate their
   authority, introduce a command, add repository mediation, or answer ARCH-008's
   OQ-1 / OQ-2 / OQ-3. This harness therefore asserts that the residual shape is
   PRESERVED as well as that failure is now reported honestly.

   HONESTY NOTE — persistContracts() writes ONE storage key, so "rollback" here is
   strictly in-memory restoration of State.contracts. No coordinator, no journal,
   no compensation across keys is added or claimed.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

const CONTRACTS_KEY = 'tam_contracts_v1';
const AUDIT_KEY = 'tam_audit_log_v1';
const N = '2026-01-01T00:00:00.000Z';

/* ---------- runtime loader ----------
   Loads the REAL production modules in manifest order, excluding the only
   DOM-executing load-time module. Browser infrastructure is stubbed; no business
   logic, validator, or persistence helper is mocked or reimplemented.
   `ctl.failKeys` makes StorageAdapter's underlying localStorage.setItem throw for
   a chosen key, which is how a real quota failure surfaces. */
function loadRuntime(){
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { State: State };';
  const noop = function(){};
  const memStore = {};
  const ctl = { failKeys:new Set(), writes:[] };
  const memStorage = {
    getItem: (k)=> Object.prototype.hasOwnProperty.call(memStore,k) ? memStore[k] : null,
    setItem: (k,v)=>{ ctl.writes.push(k);
      if(ctl.failKeys.has(k)){ const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      memStore[k] = String(v); },
    removeItem: (k)=>{ delete memStore[k]; }
  };
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const toasts = [];
  const sandbox = {
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-spr093' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-spr093-runtime.js' });
  // Capture what the user is actually told, and what reaches the activity log.
  sandbox.toast = function(m){ toasts.push(String(m)); };
  sandbox.render = noop; sandbox.closeModal = noop;
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.memStore = memStore; rt.ctl = ctl; rt.toasts = toasts;
  return rt;
}

/* ---------- fabricated fixtures ---------- */
const EMP = (o)=>Object.assign({ id:'e1', employeeId:'E1', fullName:'SAMPLE — Alpha',
  employmentStatus:'Active', active:true, monthlyBaseSalary:1000000, joinDate:'2025-01-01',
  createdAt:N, updatedAt:N }, o);
const CT = (o)=>Object.assign({ id:'c1', employeeId:'e1', employeeName:'SAMPLE — Alpha',
  contractNumber:'SAMPLE/1', startDate:'2025-01-01', durationMonths:36, monthlySalary:1000000,
  status:'Active', notes:'original note', createdAt:N, updatedAt:N,
  history:[{event:'created', ts:N, note:'seed'}] }, o);

function seed(rt){
  const S = rt.State;
  // UX-006C2A — deleteContract now authorizes at the mutation boundary
  // (can(contract.delete, …)). Scenarios 6-9 invoke the real production
  // deleteContract, so this harness explicitly selects the CEO principal through
  // the real local identity path (no default/implicit CEO in production).
  rt.w.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  S.employees = [EMP()];
  S.contracts = [CT()];
  S.overtimeRecords = []; S.monthlyPlans = []; S.txns = []; S.payrollPlans = [];
  S.payrollAdjustments = []; S.recurringExpenses = []; S.employeeMerges = [];
  S.companyAccounts = []; S.supplementalPayments = []; S.importBatches = []; S.backups = [];
  S.auditLog = S.auditLog || [];
  rt.memStore[CONTRACTS_KEY] = JSON.stringify(S.contracts);
  return S;
}

/* ---------- editor driver — READ THIS BEFORE TRUSTING SCENARIOS 1-5 ----------
   The editor's submit handler lives inside a modal onMount closure. It cannot be
   invoked without a real DOM, so this driver REPLAYS the production save sequence
   (snapshot → assign → push → persist → roll back on failure) against the REAL
   persistContracts() and the REAL StorageAdapter.

   WHAT SCENARIOS 1-5 THEREFORE PROVE: that persistContracts() reports failure
   honestly, and that the rollback SEMANTICS this sprint specifies are correct and
   complete. WHAT THEY DO NOT PROVE: that the production editor still performs that
   rollback — a regression inside the closure would not fail scenarios 1-5.

   That gap is closed STATICALLY by scenario 10, which asserts each rollback
   construct is present in js/people/contracts.js. Verified by fault injection:
   deleting the production editor's rollback block fails scenario 10.

   deleteContract has no such limitation — scenarios 6-9 invoke the real production
   function directly, and reverting its fix fails them behaviourally. */
const EDITED_FIELDS = ['employeeId','employeeName','contractNumber','startDate',
  'durationMonths','monthlySalary','status','notes','workHoursPerDay','workDaysPerWeek',
  'weeksPerMonth','scheduleEffectiveDate','scheduleNotes','updatedAt'];

async function editorSave(rt, existing, patch){
  const S = rt.State;
  const isNew = !existing;
  const rec = existing || { id:'c-new', createdAt:N, history:[] };
  const before = {};
  if(!isNew) EDITED_FIELDS.forEach(k=>{ before[k] = rec[k]; });
  const hadHistory = !isNew && Object.prototype.hasOwnProperty.call(rec, 'history');
  Object.keys(patch).forEach(k=>{ rec[k] = patch[k]; });
  rec.updatedAt = '2026-06-01T00:00:00.000Z';
  (rec.history = rec.history || []).push({ event:isNew?'created':'edited', ts:rec.updatedAt, note:isNew?'Contract created':'Contract edited' });
  if(isNew) S.contracts.push(rec);
  const persisted = await rt.w.persistContracts();
  if(persisted !== true){
    if(isNew) S.contracts = S.contracts.filter(x=>x!==rec);
    else EDITED_FIELDS.forEach(k=>{ if(before[k]===undefined) delete rec[k]; else rec[k]=before[k]; });
    rec.history.pop();
    if(!isNew && !hadHistory) delete rec.history;
    rt.w.toast(isNew
      ? 'Contract could not be saved — nothing was created. Free up storage and try again.'
      : 'Contract changes could not be saved — nothing was changed. Free up storage and try again.', 6000);
    return false;
  }
  rt.w.toast(isNew?'Contract created.':'Contract updated.');
  return true;
}

const said = (rt, re)=> rt.toasts.some(t=>re.test(t));
const stored = (rt)=>{ try{ return JSON.parse(rt.memStore[CONTRACTS_KEY]||'null'); }catch(e){ return null; } };
// logActivity() writes straight to the audit storage key, not to State.
const auditEntries = (rt, type)=>{ try{ return JSON.parse(rt.memStore[AUDIT_KEY]||'[]').filter(a=>a.type===type); }catch(e){ return []; } };

(async function main(){
  console.log('== SPR-093 CONTRACT PERSISTENCE HONESTY — RUNTIME VERIFICATION ==');
  console.log('   Editor save (create + edit) and deleteContract. Both remain DIRECT residual');
  console.log('   paths (ARCH-008); this sprint changes only failure reporting and rollback.');
  console.log('');

  /* ---------- 1. editor CREATE — success path unchanged ---------- */
  console.log('-- 1. editor create: successful persistence --');
  {
    const rt = loadRuntime(); seed(rt);
    const ok = await editorSave(rt, null, { employeeId:'e1', employeeName:'SAMPLE — Alpha',
      contractNumber:'SAMPLE/NEW', startDate:'2026-01-01', durationMonths:12,
      monthlySalary:2000000, status:'Active', notes:'new' });
    check(ok === true, 'create reports success when the write succeeds');
    check(rt.State.contracts.length === 2, 'the new contract is in memory');
    check((stored(rt)||[]).length === 2, 'the new contract reached storage');
    check(said(rt, /Contract created\./), 'the user is told the contract was created');
    check(!said(rt, /could not be saved/), 'no failure message on the success path');
  }

  /* ---------- 2. editor CREATE — persistence fails ---------- */
  console.log('-- 2. editor create: FAILED persistence --');
  {
    const rt = loadRuntime(); seed(rt);
    rt.ctl.failKeys.add(CONTRACTS_KEY);
    const ok = await editorSave(rt, null, { employeeId:'e1', employeeName:'SAMPLE — Alpha',
      contractNumber:'SAMPLE/NEW', startDate:'2026-01-01', durationMonths:12,
      monthlySalary:2000000, status:'Active', notes:'new' });
    check(ok === false, 'create does NOT report success when the write fails');
    check(!said(rt, /Contract created\./), 'the success message is NOT shown');
    check(said(rt, /could not be saved/), 'the user is told the save failed');
    check(rt.State.contracts.length === 1, 'the unsaved contract is rolled OUT of memory');
    check(!rt.State.contracts.some(x=>x.contractNumber==='SAMPLE/NEW'), 'no trace of the new contract remains in State');
    check((stored(rt)||[]).length === 1, 'storage still holds only the original contract');
    check(JSON.stringify(rt.State.contracts) === rt.memStore[CONTRACTS_KEY], 'in-memory and persisted state agree (no silent divergence)');
  }

  /* ---------- 3. editor EDIT — success path unchanged ---------- */
  console.log('-- 3. editor edit: successful persistence --');
  {
    const rt = loadRuntime(); const S = seed(rt);
    const ok = await editorSave(rt, S.contracts[0], { contractNumber:'SAMPLE/EDITED',
      monthlySalary:3000000, status:'Draft', notes:'edited note' });
    check(ok === true, 'edit reports success when the write succeeds');
    check(S.contracts[0].contractNumber === 'SAMPLE/EDITED', 'the edit is applied in memory');
    check(S.contracts[0].monthlySalary === 3000000 && S.contracts[0].status === 'Draft', 'every edited field is applied');
    check((stored(rt)||[])[0].contractNumber === 'SAMPLE/EDITED', 'the edit reached storage');
    check(said(rt, /Contract updated\./), 'the user is told the contract was updated');
  }

  /* ---------- 4. editor EDIT — persistence fails ---------- */
  console.log('-- 4. editor edit: FAILED persistence --');
  {
    const rt = loadRuntime(); const S = seed(rt);
    const originalJSON = JSON.stringify(S.contracts);
    const historyBefore = S.contracts[0].history.length;
    rt.ctl.failKeys.add(CONTRACTS_KEY);
    const ok = await editorSave(rt, S.contracts[0], { contractNumber:'SAMPLE/EDITED',
      monthlySalary:3000000, status:'Draft', notes:'edited note' });
    check(ok === false, 'edit does NOT report success when the write fails');
    check(!said(rt, /Contract updated\./), 'the success message is NOT shown');
    check(said(rt, /could not be saved/), 'the user is told the changes were not saved');
    check(S.contracts[0].contractNumber === 'SAMPLE/1', 'contractNumber is rolled back');
    check(S.contracts[0].monthlySalary === 1000000, 'monthlySalary is rolled back');
    check(S.contracts[0].status === 'Active', 'status is rolled back');
    check(S.contracts[0].notes === 'original note', 'notes are rolled back');
    check(S.contracts[0].updatedAt === N, 'updatedAt is rolled back');
    check(S.contracts[0].history.length === historyBefore, 'the edit history entry is dropped');
    check(JSON.stringify(S.contracts) === originalJSON, 'the whole collection is byte-identical to the pre-edit state');
    check(JSON.stringify(S.contracts) === rt.memStore[CONTRACTS_KEY], 'in-memory and persisted state agree (no silent divergence)');
  }

  /* ---------- 5. editor EDIT failure — fields absent BEFORE the edit are not invented ---------- */
  console.log('-- 5. editor edit: rollback deletes keys that did not previously exist --');
  {
    const rt = loadRuntime(); const S = seed(rt);
    check(S.contracts[0].scheduleNotes === undefined, 'precondition: the seed contract has no scheduleNotes');
    rt.ctl.failKeys.add(CONTRACTS_KEY);
    await editorSave(rt, S.contracts[0], { scheduleNotes:'SAMPLE schedule note' });
    check(S.contracts[0].scheduleNotes === undefined, 'a key that did not exist before is DELETED, not left as undefined');
    check(!Object.prototype.hasOwnProperty.call(S.contracts[0],'scheduleNotes'), 'the property is genuinely absent after rollback');
  }

  /* ---------- 5b. editor EDIT failure on a record with NO own history property ----------
     SPR-093A. A Contract restored from a legacy or externally-authored backup can carry
     no `history` at all — no in-app creation path omits it, and nothing backfills
     contract history. The production handler writes `(rec.history=rec.history||[]).push(…)`,
     which CREATES the property on such a record. Popping the entry empties the array but
     cannot remove the property, so a failed edit previously left `history: []` where none
     existed. The own-property snapshot now restores true absence. */
  console.log('-- 5b. editor edit: FAILED persistence on a record with NO own history --');
  {
    const rt = loadRuntime(); const S = seed(rt);
    const legacy = CT({ id:'c-legacy', contractNumber:'SAMPLE/LEGACY' });
    delete legacy.history;                       // legacy/restored record: no history at all
    S.contracts = [legacy];
    rt.memStore[CONTRACTS_KEY] = JSON.stringify(S.contracts);
    const originalJSON = JSON.stringify(S.contracts);
    check(!Object.prototype.hasOwnProperty.call(legacy,'history'), 'precondition: the record owns no history property');
    rt.ctl.failKeys.add(CONTRACTS_KEY);
    const ok = await editorSave(rt, legacy, { contractNumber:'SAMPLE/EDITED', notes:'edited note' });
    check(ok === false, 'the failed save does NOT report success');
    check(!Object.prototype.hasOwnProperty.call(legacy,'history'), 'history own-property remains ABSENT after rollback (not left as an empty array)');
    check(legacy.contractNumber === 'SAMPLE/LEGACY' && legacy.notes === 'original note', 'the edited fields are restored');
    check(JSON.stringify(S.contracts) === originalJSON, 'the collection is byte-identical to the pre-edit state');
    check(!said(rt, /Contract updated\./), 'no success message');
    check(said(rt, /could not be saved/), 'failure message is shown');
    check(JSON.stringify(S.contracts) === rt.memStore[CONTRACTS_KEY], 'storage is unchanged and agrees with memory');
  }

  /* ---------- 5c. an EXISTING history array is restored to its exact prior contents ---------- */
  console.log('-- 5c. editor edit: FAILED persistence preserves an EXISTING history array --');
  {
    const rt = loadRuntime(); const S = seed(rt);
    const rec = S.contracts[0];
    rec.history = [{event:'created', ts:N, note:'seed'}, {event:'edited', ts:N, note:'earlier edit'}];
    rt.memStore[CONTRACTS_KEY] = JSON.stringify(S.contracts);
    const historyJSON = JSON.stringify(rec.history);
    rt.ctl.failKeys.add(CONTRACTS_KEY);
    await editorSave(rt, rec, { contractNumber:'SAMPLE/EDITED' });
    check(Object.prototype.hasOwnProperty.call(rec,'history'), 'an existing history property is retained');
    check(JSON.stringify(rec.history) === historyJSON, 'history is restored to its exact prior contents (2 entries, unchanged)');
    check(rec.history.length === 2, 'the entry added by the failed save is gone and no earlier entry was lost');
  }

  /* ---------- 6. deleteContract — success path unchanged ---------- */
  console.log('-- 6. delete: successful persistence --');
  {
    const rt = loadRuntime(); const S = seed(rt);
    const auditBefore = auditEntries(rt,'contract.delete').length;
    await rt.w.deleteContract('c1');
    check(S.contracts.length === 0, 'the contract is removed from memory');
    check((stored(rt)||[]).length === 0, 'the removal reached storage');
    check(said(rt, /Contract deleted\./), 'the user is told the contract was deleted');
    check(auditEntries(rt,'contract.delete').length === auditBefore + 1, 'exactly one delete activity entry IS recorded on success');
  }

  /* ---------- 7. deleteContract — persistence fails ---------- */
  console.log('-- 7. delete: FAILED persistence --');
  {
    const rt = loadRuntime(); const S = seed(rt);
    const originalJSON = JSON.stringify(S.contracts);
    const auditBefore = auditEntries(rt,'contract.delete').length;
    rt.ctl.failKeys.add(CONTRACTS_KEY);
    await rt.w.deleteContract('c1');
    check(!said(rt, /Contract deleted\./), 'the success message is NOT shown');
    check(said(rt, /could not be deleted/), 'the user is told the deletion failed');
    check(S.contracts.length === 1, 'the contract is restored in memory');
    check(S.contracts[0].id === 'c1', 'the restored record is the same contract');
    check(JSON.stringify(S.contracts) === originalJSON, 'the collection is byte-identical to the pre-delete state');
    check(JSON.stringify(S.contracts) === rt.memStore[CONTRACTS_KEY], 'in-memory and persisted state agree (no silent divergence)');
    check(auditEntries(rt,'contract.delete').length === auditBefore, 'NO delete activity entry is recorded for a deletion that did not persist');
  }

  /* ---------- 8. delete failure restores ORIGINAL POSITION ---------- */
  console.log('-- 8. delete: failed persistence restores the original position --');
  {
    const rt = loadRuntime(); const S = seed(rt);
    S.contracts = [CT({id:'c0', contractNumber:'SAMPLE/0'}), CT(), CT({id:'c2', contractNumber:'SAMPLE/2'})];
    rt.memStore[CONTRACTS_KEY] = JSON.stringify(S.contracts);
    const originalOrder = S.contracts.map(x=>x.id).join(',');
    rt.ctl.failKeys.add(CONTRACTS_KEY);
    await rt.w.deleteContract('c1');
    check(S.contracts.map(x=>x.id).join(',') === originalOrder, 'the restored contract keeps its original index (order preserved)');
    check(S.contracts.length === 3, 'no record was lost or duplicated');
  }

  /* ---------- 9. existing validation and confirmation are UNCHANGED ---------- */
  console.log('-- 9. delete: pre-existing guards are preserved --');
  {
    const rt = loadRuntime(); const S = seed(rt);
    S.payrollPlans = [{ id:'pp1', contractId:'c1', employeeId:'e1', monthKey:'2026-07', status:'Ready' }];
    await rt.w.deleteContract('c1');
    check(S.contracts.length === 1, 'a contract with linked payroll is NOT deleted');
    check(said(rt, /cannot be deleted/), 'the linked-payroll refusal message is still shown');
    check(!said(rt, /could not be deleted/), 'the refusal is not reported as a persistence failure');
    check(rt.ctl.writes.indexOf(CONTRACTS_KEY) === -1, 'no write is attempted when the guard refuses');
  }

  /* ---------- 10. residual shape is PRESERVED (SPR-093 migrates no authority) ---------- */
  console.log('-- 10. scope: the residual write paths are unchanged in kind --');
  {
    const ctRaw = fs.readFileSync(path.resolve(__dirname,'..','js','people','contracts.js'),'utf8');
    // Count on comment-stripped source, as tools/verify-build.js does: several block
    // comments legitimately MENTION ContractRepository.save() while describing the path.
    const ctSrc = ctRaw.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*/g,'');
    check(/rec\.status = fd\.get\('status'\)/.test(ctRaw), 'the editor still assigns status directly (residual authority NOT migrated)');
    /* SPR-095 added a FOURTH ContractRepository.save() — the unrouted contract.core.update
       handler (domain preparation, ADR-014 step 1). That does not weaken this scope claim:
       what SPR-093 pinned is that the EDITOR and DELETE paths gained no repository
       mediation, which the persistContracts() assertions below still prove directly. */
    check((ctSrc.match(/ContractRepository\.save\(\)/g)||[]).length === 4, 'exactly four ContractRepository.save() call sites (dates + status + renewal + the unrouted SPR-095 core handler)');
    check(!/ContractRepository/.test(ctSrc.slice(ctSrc.indexOf("const EDITED_FIELDS = ["), ctSrc.indexOf("closeModal(); toast(isNew?'Contract created.'"))), 'the editor save path itself contains NO repository mediation (still persistContracts())');
    check((ctSrc.match(/uiExecute\('command'/g)||[]).length === 3, 'still exactly three command routes (the SPR-095 command is registered but routed by nothing)');
    check(/const persisted = await persistContracts\(\);/.test(ctSrc), 'the editor and delete paths check the persistContracts() result');
    check((ctSrc.match(/persisted !== true/g)||[]).length >= 2, 'both paths use the strict persisted !== true check');
    check(!/\n\s*await persistContracts\(\);/.test(ctSrc), 'no persistContracts() call in contracts.js discards its result');
    /* The editor's rollback lives inside a modal closure that scenarios 1-5 cannot
       execute, so it is bound HERE instead: each construct is asserted to exist in
       production source. Fault injection confirms deleting the block fails these. */
    check(/if\(isNew\) State\.contracts = State\.contracts\.filter\(x=>x!==rec\);/.test(ctSrc), 'editor rollback: a failed CREATE drops the new record from State');
    check(/EDITED_FIELDS\.forEach\(k=>\{ if\(before\[k\]===undefined\) delete rec\[k\]; else rec\[k\]=before\[k\]; \}\)/.test(ctSrc), 'editor rollback: a failed EDIT restores every snapshotted field (deleting keys that did not exist)');
    check(/rec\.history\.pop\(\);/.test(ctSrc), 'editor rollback: the history entry added by the failed save is dropped');
    check(/const hadHistory = !isNew && Object\.prototype\.hasOwnProperty\.call\(rec, 'history'\);/.test(ctSrc), 'editor snapshots history OWN-PROPERTY presence (not truthiness) before the edit');
    check(/if\(!isNew && !hadHistory\) delete rec\.history;/.test(ctSrc), 'editor rollback: a history property created by the failed save is removed (absence restored)');
    check(/const EDITED_FIELDS = \[/.test(ctSrc) && /if\(!isNew\) EDITED_FIELDS\.forEach\(k=>\{ before\[k\] = rec\[k\]; \}\);/.test(ctSrc), 'editor snapshots the mutated fields BEFORE assigning them');
    check(/could not be saved/.test(ctRaw) && /could not be deleted/.test(ctRaw), 'both paths carry a distinct failure message');
    // Deletion must restore the record at its original index, not append it.
    check(/State\.contracts\.splice\(prevIndex, 0, c\)/.test(ctSrc), 'delete rollback restores the record at its original position');
  }

  console.log('');
  if(failures.length){
    console.log('RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
    failures.forEach(f => console.log('   - ' + f));
    process.exit(1);
  }
  console.log('RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})().catch(e => { console.error('RUNTIME VERIFICATION ERROR', e); process.exit(1); });
