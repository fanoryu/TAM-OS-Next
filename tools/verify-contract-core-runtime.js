#!/usr/bin/env node
'use strict';
/* ============================================================
   SPR-095 — CONTRACT CORE DOMAIN PREPARATION RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of the Contract Core authority
   introduced by ADR-014. This harness proves its BEHAVIOUR by executing the real
   production modules — ContractCoreAggregate, Domain.command, updateContractCore,
   ContractRepository, persistContracts, StorageAdapter — against a storage backend
   that can be made to fail the contracts key.

   Same dependency-free Node `vm` loader technique as js/cli/cli.js and the
   SPR-077/078/079/081/082/089/090/091/093 harnesses. All fixture data is obviously
   fabricated. Nothing is written to disk and no repository file is modified. No
   business logic, validator, or persistence helper is mocked or reimplemented.

   SCOPE — DOMAIN PREPARATION ONLY (ADR-014 sequencing step 1). This sprint
   introduces an aggregate, a command, a handler and repository mediation, and
   changes NO runtime behaviour: nothing in the application invokes
   contract.core.update. Scenario 9 asserts exactly that, and asserts the full
   Contract editor still writes these ten fields directly through persistContracts().
   SPR-095 does NOT migrate the editor, does not touch the delete path, and does not
   answer ARCH-008's OQ-2 or OQ-3.

   HONESTY NOTE — persistContracts() writes ONE storage key, so "rollback" here is
   strictly in-memory restoration of the Contract record. No coordinator, no journal,
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
const N = '2026-01-01T00:00:00.000Z';

// ADR-014's field-authority matrix, restated here as the harness's INDEPENDENT
// expectation. It is deliberately NOT read from production: a regression that
// widens the aggregate's allowlist must fail against this list, not against itself.
const ADR014_CORE_FIELDS = ['employeeId','employeeName','contractNumber','monthlySalary','notes',
  'workHoursPerDay','workDaysPerWeek','weeksPerMonth','scheduleEffectiveDate','scheduleNotes'];
// Every mutable/system/immutable Contract field ADR-014 assigns elsewhere.
const ADR014_NOT_OWNED = ['status','startDate','durationMonths','endDate','updatedAt','history',
  'id','createdAt','renewedFromId','renewedToId'];

/* ---------- runtime loader ---------- */
function loadRuntime(){
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { State: State, Domain: Domain, ContractCoreAggregate: ContractCoreAggregate,'
    + ' ContractRepository: ContractRepository, CONTRACT_CORE_FIELDS: CONTRACT_CORE_FIELDS,'
    + ' CONTRACT_CORE_SCHEDULE_FIELDS: CONTRACT_CORE_SCHEDULE_FIELDS, DOMAIN_COMMANDS: DOMAIN_COMMANDS };';
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
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-spr095' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-spr095-runtime.js' });
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

function seed(rt, contracts, employees){
  const S = rt.State;
  // UX-006C2A — updateContractCore now authorizes at the mutation boundary
  // (can(contract.update, …)). This harness exercises the valid CEO workflow, so
  // it explicitly selects the CEO principal through the real local identity path.
  // No default/implicit CEO is introduced in production; selection is explicit here.
  rt.w.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  S.employees = employees || [EMP(), EMP({ id:'e2', employeeId:'E2', fullName:'SAMPLE — Beta' })];
  S.contracts = contracts || [CT()];
  S.overtimeRecords = []; S.monthlyPlans = []; S.txns = []; S.payrollPlans = [];
  S.payrollAdjustments = []; S.recurringExpenses = []; S.employeeMerges = [];
  S.companyAccounts = []; S.supplementalPayments = []; S.importBatches = []; S.backups = [];
  S.auditLog = S.auditLog || [];
  rt.memStore[CONTRACTS_KEY] = JSON.stringify(S.contracts);
  rt.ctl.writes.length = 0;
  return S;
}

// Execute the command exactly as a future ingress would: through the real Domain
// facade, so the aggregate runs first and the handler receives its sanitized patch.
const exec = (rt, id, patch)=> rt.Domain.command('contract.core.update', id, patch);
const stored = (rt)=>{ try{ return JSON.parse(rt.memStore[CONTRACTS_KEY]||'null'); }catch(e){ return null; } };
const isTypedFailure = (r, code)=> !!r && r.success === false && r.error === code && r.data === undefined;
const isTypedSuccess = (r)=> !!r && r.success === true && !!r.data && r.error === undefined;

(async function main(){
  console.log('== SPR-095 CONTRACT CORE DOMAIN PREPARATION — RUNTIME VERIFICATION ==');
  console.log('   ContractCoreAggregate / contract.core.update / updateContractCore /');
  console.log('   ContractRepository. Domain preparation ONLY — nothing invokes the command,');
  console.log('   and the full Contract editor still persists directly (ADR-014 step 1).');
  console.log('');

  /* ---------- 1. the aggregate accepts a valid update ---------- */
  console.log('-- 1. valid update through the real Domain command path --');
  {
    const rt = loadRuntime(); const S = seed(rt);
    const r = await exec(rt, 'c1', { notes:'SAMPLE revised note', monthlySalary:'2500000' });
    check(isTypedSuccess(r), 'a valid update returns the typed success contract { success:true, data }');
    check(S.contracts[0].notes === 'SAMPLE revised note', 'notes is applied in memory');
    check(S.contracts[0].monthlySalary === 2500000, 'monthlySalary is normalized to a number and applied');
    check((stored(rt)||[])[0].notes === 'SAMPLE revised note', 'the update reached storage');
    check(S.contracts[0].updatedAt !== N, 'the handler authored updatedAt');
    check(S.contracts[0].history.length === 2 && S.contracts[0].history[1].event === 'contract-core-edited', 'the handler appended exactly one history entry');
    check(rt.ctl.writes.filter(k=>k===CONTRACTS_KEY).length === 1, 'exactly one contracts write per command (single persistence invocation)');
    check(JSON.stringify(S.contracts) === rt.memStore[CONTRACTS_KEY], 'in-memory and persisted state agree');
  }

  /* ---------- 2. ownership is exactly the ten ADR-014 fields ---------- */
  console.log('-- 2. ownership: exactly the ten fields of the ADR-014 matrix --');
  {
    const rt = loadRuntime(); seed(rt);
    const owned = rt.CONTRACT_CORE_FIELDS;
    check(Array.isArray(owned) && owned.length === 10, 'the aggregate owns exactly ten fields (found ' + (owned||[]).length + ')');
    check(ADR014_CORE_FIELDS.every(f=>owned.indexOf(f)!==-1), 'every field ADR-014 assigns to the Core aggregate is owned');
    check(owned.every(f=>ADR014_CORE_FIELDS.indexOf(f)!==-1), 'the aggregate owns NO field beyond the ADR-014 matrix');
    check(ADR014_NOT_OWNED.every(f=>owned.indexOf(f)===-1), 'no specialized, derived, system-authored or immutable field is owned');
    check(rt.CONTRACT_CORE_SCHEDULE_FIELDS.length === 5 && rt.CONTRACT_CORE_SCHEDULE_FIELDS.every(f=>owned.indexOf(f)!==-1), 'the atomic schedule group is a five-field subset of the ten');
    const spec = rt.DOMAIN_COMMANDS['contract.core.update'];
    check(!!spec && spec.boundary === 'ContractCoreAggregate' && spec.handler === 'updateContractCore' && spec.aggregate === 'Contract', 'contract.core.update is registered to ContractCoreAggregate / updateContractCore');
    check(typeof rt.Domain.commandHandler('contract.core.update') === 'function', 'the registered handler name resolves to a real function');
  }

  /* ---------- 3. forbidden fields are REFUSED, never silently dropped ---------- */
  console.log('-- 3. forbidden fields are rejected with a typed failure --');
  {
    for(const f of ADR014_NOT_OWNED.concat(['contractType','somethingInvented'])){
      const rt = loadRuntime(); const S = seed(rt);
      const originalJSON = JSON.stringify(S.contracts);
      const r = await exec(rt, 'c1', { [f]: 'SAMPLE' });
      check(isTypedFailure(r, 'ForbiddenContractField'), 'forbidden field refused with ForbiddenContractField: ' + f);
      check(JSON.stringify(S.contracts) === originalJSON, 'the Contract is untouched after refusing: ' + f);
      check(rt.ctl.writes.indexOf(CONTRACTS_KEY) === -1, 'no write is attempted when a forbidden field is refused: ' + f);
    }
    // A forbidden field mixed WITH owned fields refuses the whole patch — never partially applies.
    const rt = loadRuntime(); const S = seed(rt);
    const originalJSON = JSON.stringify(S.contracts);
    const r = await exec(rt, 'c1', { notes:'SAMPLE note', status:'Cancelled' });
    check(isTypedFailure(r, 'ForbiddenContractField'), 'a mixed patch (owned + forbidden) is refused entirely');
    check(JSON.stringify(S.contracts) === originalJSON, 'no owned field from a mixed patch is partially applied');
  }

  /* ---------- 4. defense in depth: the HANDLER refuses a forbidden field too ---------- */
  console.log('-- 4. handler bypass: the handler enforces the allowlist itself --');
  {
    const rt = loadRuntime(); const S = seed(rt);
    const originalJSON = JSON.stringify(S.contracts);
    // Called DIRECTLY, bypassing the aggregate — the shape a future ingress bug takes.
    const r = await rt.w.updateContractCore('c1', { status:'Cancelled', startDate:'2030-01-01' });
    check(isTypedFailure(r, 'ForbiddenContractField'), 'the handler refuses a forbidden field even when the aggregate is bypassed');
    check(S.contracts[0].status === 'Active' && S.contracts[0].startDate === '2025-01-01', 'the specialized fields are unchanged by the bypass attempt');
    check(JSON.stringify(S.contracts) === originalJSON, 'the Contract is byte-identical after a bypass attempt');
    const empty = await rt.w.updateContractCore('c1', {});
    check(isTypedFailure(empty, 'NoContractCoreFieldsProvided'), 'the handler refuses an empty patch with a typed failure');
    const missing = await exec(rt, 'no-such-contract', { notes:'SAMPLE' });
    check(isTypedFailure(missing, 'ContractNotFound'), 'an unknown Contract id returns the typed ContractNotFound');
  }

  /* ---------- 5. INVARIANT — employeeId + employeeName are an atomic pair (ADR-014 §1, PD-2) ---------- */
  console.log('-- 5. invariant: the employee link is atomic, and PD-2 bounds reassignment --');
  {
    const rt = loadRuntime(); const S = seed(rt);
    check(isTypedFailure(await exec(rt,'c1',{ employeeId:'e2' }), 'IncompleteEmployeeLink'), 'employeeId alone is refused (the display name would desynchronize)');
    check(isTypedFailure(await exec(rt,'c1',{ employeeName:'SAMPLE — Beta' }), 'IncompleteEmployeeLink'), 'employeeName alone is refused');
    check(isTypedFailure(await exec(rt,'c1',{ employeeId:'ghost', employeeName:'SAMPLE — Ghost' }), 'EmployeeNotFound'), 'an unknown employee is refused');
    check(isTypedFailure(await exec(rt,'c1',{ employeeId:'e2', employeeName:'SAMPLE — Alpha' }), 'EmployeeLinkMismatch'), 'a name that is not the linked employee’s name is refused (never silently rewritten)');
    check(S.contracts[0].employeeId === 'e1' && S.contracts[0].employeeName === 'SAMPLE — Alpha', 'the link is unchanged after every refusal');
    // PD-2: the seed contract is Active, so reassignment is refused outright.
    check(isTypedFailure(await exec(rt,'c1',{ employeeId:'e2', employeeName:'SAMPLE — Beta' }), 'EmployeeReassignmentNotAllowed'), 'PD-2: reassignment is refused on a non-Draft Contract');
    // Re-submitting the SAME employee is not a reassignment and stays allowed.
    check(isTypedSuccess(await exec(rt,'c1',{ employeeId:'e1', employeeName:'SAMPLE — Alpha' })), 'resubmitting the unchanged link is not a reassignment');
  }
  {
    // PD-2 on a Draft contract WITH linked records — the guard mirrors the delete guard.
    const rt = loadRuntime(); const S = seed(rt, [CT({ status:'Draft' })]);
    S.payrollPlans = [{ id:'pp1', contractId:'c1', employeeId:'e1', monthKey:'2026-07', status:'Ready' }];
    check(isTypedFailure(await exec(rt,'c1',{ employeeId:'e2', employeeName:'SAMPLE — Beta' }), 'EmployeeReassignmentNotAllowed'), 'PD-2: linked payroll blocks reassignment on a Draft Contract');
    S.payrollPlans = []; S.txns = [{ id:'t1', contractId:'c1', planned:1 }];
    check(isTypedFailure(await exec(rt,'c1',{ employeeId:'e2', employeeName:'SAMPLE — Beta' }), 'EmployeeReassignmentNotAllowed'), 'PD-2: a linked transaction blocks reassignment');
    S.txns = []; S.overtimeRecords = [{ id:'ot1', contractId:'c1', employeeId:'e1', overtimeHours:2 }];
    check(isTypedFailure(await exec(rt,'c1',{ employeeId:'e2', employeeName:'SAMPLE — Beta' }), 'EmployeeReassignmentNotAllowed'), 'PD-2: a linked overtime record blocks reassignment');
    S.overtimeRecords = [];
    const ok = await exec(rt,'c1',{ employeeId:'e2', employeeName:'SAMPLE — Beta' });
    check(isTypedSuccess(ok), 'PD-2: reassignment succeeds on a Draft Contract with no linked records');
    check(S.contracts[0].employeeId === 'e2' && S.contracts[0].employeeName === 'SAMPLE — Beta', 'both link fields moved TOGETHER (the atomic pair invariant holds)');
    check((stored(rt)||[])[0].employeeId === 'e2', 'the reassignment reached storage');
  }

  /* ---------- 6. INVARIANT — the schedule is one atomic value object (ADR-014 §2) ---------- */
  console.log('-- 6. invariant: the five schedule fields are one value object --');
  {
    const rt = loadRuntime(); const S = seed(rt);
    const full = { workHoursPerDay:'8', workDaysPerWeek:'5', weeksPerMonth:'4', scheduleEffectiveDate:'2026-02-01', scheduleNotes:'SAMPLE schedule' };
    // Partial GROUP (fewer than five keys submitted) is refused.
    check(isTypedFailure(await exec(rt,'c1',{ workHoursPerDay:'8' }), 'IncompleteScheduleGroup'), 'a partial schedule group (one key) is refused');
    check(isTypedFailure(await exec(rt,'c1',{ workHoursPerDay:'8', workDaysPerWeek:'5', weeksPerMonth:'4' }), 'IncompleteScheduleGroup'), 'a partial schedule group (three of five keys) is refused');
    // All five keys present but only ONE numeric component filled — the exact hazard
    // ADR-014 §2 measures: readSchedule() would treat it as a complete contract schedule.
    const partial = Object.assign({}, full, { workDaysPerWeek:'', weeksPerMonth:'' });
    check(isTypedFailure(await exec(rt,'c1', partial), 'IncompleteScheduleGroup'), 'an internally incomplete group (hours only) is refused — the rate-zeroing hazard');
    // Prove the hazard is real by measuring what the refused patch WOULD have produced.
    const hazard = rt.w.effectiveSchedule(rt.State.employees[0], { workHoursPerDay:8, workDaysPerWeek:null, weeksPerMonth:null });
    check(hazard.source === 'contract' && hazard.valid === false, 'the refused shape would have overridden the employee schedule and been invalid');
    check(rt.w.overtimeCalc(1000000, hazard, 5).hourlyRate === 0 || !isFinite(rt.w.overtimeCalc(1000000, hazard, 5).hourlyRate), 'the refused shape would have zeroed the hourly rate (invariant preserved by refusing)');
    check(isTypedFailure(await exec(rt,'c1', Object.assign({}, full, { workHoursPerDay:'0' })), 'InvalidScheduleComponent'), 'a zero schedule component is refused');
    check(isTypedFailure(await exec(rt,'c1', Object.assign({}, full, { workDaysPerWeek:'abc' })), 'InvalidScheduleComponent'), 'a non-numeric schedule component is refused');
    check(isTypedFailure(await exec(rt,'c1', Object.assign({}, full, { scheduleEffectiveDate:'2026-02-31' })), 'InvalidScheduleEffectiveDate'), 'an impossible schedule effective date is refused');
    check(S.contracts[0].workHoursPerDay === undefined, 'no schedule field was written by any refused patch');
    // A complete group succeeds and yields a valid contract-level schedule.
    check(isTypedSuccess(await exec(rt,'c1', full)), 'a complete schedule group is accepted');
    const sched = rt.w.effectiveSchedule(rt.State.employees[0], S.contracts[0]);
    check(sched.source === 'contract' && sched.valid === true, 'the accepted schedule resolves as a valid contract-level schedule');
    check(rt.w.overtimeCalc(1000000, sched, 10).hourlyRate > 0, 'the accepted schedule yields a non-zero hourly rate');
    check(S.contracts[0].scheduleEffectiveDate === '2026-02-01' && S.contracts[0].scheduleNotes === 'SAMPLE schedule', 'the non-numeric schedule fields are stored');
    // Clearing all three components together restores inheritance.
    check(isTypedSuccess(await exec(rt,'c1', { workHoursPerDay:'', workDaysPerWeek:'', weeksPerMonth:'', scheduleEffectiveDate:'', scheduleNotes:'' })), 'clearing the whole group is accepted');
    check(rt.w.readSchedule(S.contracts[0]) === null, 'a fully cleared group returns to inheriting the employee/company schedule');
  }

  /* ---------- 7. INVARIANT — PD-1 (contractNumber) and compensation validation ---------- */
  console.log('-- 7. invariant: PD-1 contractNumber is Draft-only; salary is validated --');
  {
    const rt = loadRuntime(); const S = seed(rt);
    check(isTypedFailure(await exec(rt,'c1',{ contractNumber:'SAMPLE/CHANGED' }), 'ContractNumberNotEditable'), 'PD-1: the number cannot change once the Contract has left Draft');
    check(S.contracts[0].contractNumber === 'SAMPLE/1', 'the issued number is unchanged after the refusal');
    check(isTypedSuccess(await exec(rt,'c1',{ contractNumber:'SAMPLE/1' })), 'resubmitting the unchanged number is not an edit and is allowed');
    check(isTypedFailure(await exec(rt,'c1',{ contractNumber:'   ' }), 'InvalidContractNumber'), 'a blank contract number is refused');
    check(isTypedFailure(await exec(rt,'c1',{ monthlySalary:'-1' }), 'InvalidMonthlySalary'), 'a negative salary is refused');
    check(isTypedFailure(await exec(rt,'c1',{ monthlySalary:'not-a-number' }), 'InvalidMonthlySalary'), 'a non-numeric salary is refused');
    const cleared = await exec(rt,'c1',{ monthlySalary:'' });
    check(isTypedSuccess(cleared) && S.contracts[0].monthlySalary === null, 'a blank salary clears to null (the existing stored shape)');
  }
  {
    const rt = loadRuntime(); const S = seed(rt, [CT({ status:'Draft' })]);
    check(isTypedSuccess(await exec(rt,'c1',{ contractNumber:'SAMPLE/RENUMBERED' })), 'PD-1: the number IS editable while the Contract is in Draft');
    check(S.contracts[0].contractNumber === 'SAMPLE/RENUMBERED', 'the Draft renumber is applied');
  }

  /* ---------- 8. persistence mediation, repository integration and ROLLBACK ---------- */
  console.log('-- 8. persistence mediation through ContractRepository, and rollback --');
  {
    // The Repository contract itself, exercised directly against the real StorageAdapter.
    const rt = loadRuntime(); seed(rt);
    const okRes = await rt.ContractRepository.save();
    check(okRes && okRes.ok === true && okRes.error === undefined, 'ContractRepository.save() normalizes a successful write to { ok:true }');
    rt.ctl.failKeys.add(CONTRACTS_KEY);
    const failRes = await rt.ContractRepository.save();
    check(failRes && failRes.ok === false && failRes.error === 'PersistFailed', 'ContractRepository.save() normalizes a failed write to { ok:false, error:"PersistFailed" }');
  }
  {
    // A failed write must surface as PersistFailed and leave nothing behind. Only the
    // Repository's normalized result can produce this outcome — persistContracts()
    // returns a bare boolean, so a repository bypass cannot pass this scenario.
    const rt = loadRuntime(); const S = seed(rt);
    const originalJSON = JSON.stringify(S.contracts);
    const historyBefore = S.contracts[0].history.length;
    rt.ctl.failKeys.add(CONTRACTS_KEY);
    const r = await exec(rt,'c1',{ notes:'SAMPLE revised note', monthlySalary:'2500000',
      workHoursPerDay:'8', workDaysPerWeek:'5', weeksPerMonth:'4', scheduleEffectiveDate:'2026-02-01', scheduleNotes:'SAMPLE schedule' });
    check(isTypedFailure(r, 'PersistFailed'), 'a failed write returns the typed PersistFailed result (never a claimed success)');
    check(S.contracts[0].notes === 'original note' && S.contracts[0].monthlySalary === 1000000, 'every changed field is rolled back');
    check(S.contracts[0].updatedAt === N, 'updatedAt is rolled back');
    check(S.contracts[0].history.length === historyBefore, 'the history entry added by the failed command is dropped');
    check(!Object.prototype.hasOwnProperty.call(S.contracts[0],'workHoursPerDay'), 'a key that did not exist before is DELETED, not left as undefined');
    check(JSON.stringify(S.contracts) === originalJSON, 'the collection is byte-identical to the pre-command state');
    check(JSON.stringify(S.contracts) === rt.memStore[CONTRACTS_KEY], 'in-memory and persisted state agree (no silent divergence)');
  }
  {
    // A record carrying no own `history` must not acquire one from a failed command.
    const rt = loadRuntime(); const S = seed(rt);
    const legacy = CT({ id:'c-legacy', contractNumber:'SAMPLE/LEGACY' });
    delete legacy.history;
    S.contracts = [legacy];
    rt.memStore[CONTRACTS_KEY] = JSON.stringify(S.contracts);
    const originalJSON = JSON.stringify(S.contracts);
    rt.ctl.failKeys.add(CONTRACTS_KEY);
    const r = await exec(rt,'c-legacy',{ notes:'SAMPLE revised note' });
    check(isTypedFailure(r, 'PersistFailed'), 'the failed command on a legacy record returns PersistFailed');
    check(!Object.prototype.hasOwnProperty.call(legacy,'history'), 'history own-property remains ABSENT after rollback (not left as an empty array)');
    check(JSON.stringify(S.contracts) === originalJSON, 'the legacy record is byte-identical after rollback');
  }
  {
    // Retry after a failure writes exactly once and leaves no residue.
    const rt = loadRuntime(); const S = seed(rt);
    rt.ctl.failKeys.add(CONTRACTS_KEY);
    await exec(rt,'c1',{ notes:'SAMPLE revised note' });
    rt.ctl.failKeys.delete(CONTRACTS_KEY);
    const r = await exec(rt,'c1',{ notes:'SAMPLE revised note' });
    check(isTypedSuccess(r), 'a retry after a failed write succeeds');
    check(S.contracts[0].history.length === 2, 'the retry left exactly one history entry (no residue from the failed attempt)');
    check(JSON.stringify(S.contracts) === rt.memStore[CONTRACTS_KEY], 'memory and storage agree after the retry');
  }

  /* ---------- 9. SCOPE — nothing invokes the command; the editor is unmigrated ---------- */
  console.log('-- 9. scope: domain preparation only (no routing, no editor migration) --');
  {
    const root = path.resolve(__dirname,'..');
    const jsFiles = require(path.join(root,'tools','module-order.js'));
    const allSrc = jsFiles.map(f=>fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n');
    const strip = (s)=> s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*/g,'');
    const code = strip(allSrc);
    const ctRaw = fs.readFileSync(path.join(root,'js','people','contracts.js'),'utf8');
    const ctSrc = strip(ctRaw);
    check(!/uiExecute\('command',\s*'contract\.core\.update'/.test(code), 'NO UI seam routes contract.core.update (the command is invoked by nothing)');
    check(!/Domain\.command\(\s*'contract\.core\.update'/.test(code), 'no module invokes contract.core.update through the Domain facade directly');
    check((code.match(/updateContractCore\s*\(/g)||[]).length === 1, 'updateContractCore appears exactly once in production source — its own definition, no call site');
    check((code.match(/ContractCoreAggregate\s*[.[]/g)||[]).length === 0, 'no module calls ContractCoreAggregate directly (the Domain facade resolves it by name)');
    // The editor keeps its existing, unmigrated persistence path.
    check(/rec\.status = fd\.get\('status'\)/.test(ctRaw), 'the editor still assigns status directly (authority NOT migrated)');
    check(/rec\.employeeId = emp\.id;/.test(ctSrc) && /rec\.contractNumber = \(fd\.get\('contractNumber'\)\|\|''\)\.trim\(\);/.test(ctSrc), 'the editor still writes the Core fields directly');
    check(/const persisted = await persistContracts\(\);/.test(ctSrc), 'the editor still persists through persistContracts() — no repository mediation was added to it');
    check((ctSrc.match(/uiExecute\('command'/g)||[]).length === 3, 'contracts.js still routes exactly three commands (dates + status + renewal)');
    check(!/deleteContract[\s\S]{0,600}ContractRepository/.test(ctSrc), 'the delete path is untouched (still direct, no repository mediation)');
    check(/const SCHEMA_VERSION = 6;/.test(fs.readFileSync(path.join(root,'js','core','constants.js'),'utf8')), 'SCHEMA_VERSION remains 6 (no schema change)');
  }

  /* ---------- 10. invariant preservation beyond the edited Contract ---------- */
  console.log('-- 10. nothing outside the edited Contract is touched --');
  {
    const rt = loadRuntime();
    const S = seed(rt, [CT(), CT({ id:'c2', contractNumber:'SAMPLE/2', employeeId:'e2', employeeName:'SAMPLE — Beta' })]);
    S.payrollPlans = [{ id:'pp1', contractId:'c1', employeeId:'e1', monthKey:'2026-05', status:'Committed',
      baseSalarySnapshot:1000000, plannedAmount:1000000 }];
    S.txns = [{ id:'t1', contractId:'c1', planned:1000000, actual:1000000, status:'Completed' }];
    const siblingJSON = JSON.stringify(S.contracts[1]);
    const payrollJSON = JSON.stringify(S.payrollPlans);
    const txnJSON = JSON.stringify(S.txns);
    const empJSON = JSON.stringify(S.employees);
    const writesBefore = rt.ctl.writes.slice();
    const r = await exec(rt,'c1',{ notes:'SAMPLE revised note' });
    check(isTypedSuccess(r), 'the update succeeds');
    check(JSON.stringify(S.contracts[1]) === siblingJSON, 'the sibling Contract is untouched');
    check(JSON.stringify(S.payrollPlans) === payrollJSON, 'committed payroll is untouched (immutability preserved)');
    check(JSON.stringify(S.txns) === txnJSON, 'linked transactions are untouched');
    check(JSON.stringify(S.employees) === empJSON, 'the Employee record is untouched');
    check(S.contracts[0].id === 'c1' && S.contracts[0].createdAt === N, 'id and createdAt are unchanged (immutable after creation)');
    check(S.contracts[0].status === 'Active' && S.contracts[0].startDate === '2025-01-01' && S.contracts[0].durationMonths === 36, 'the specialized lifecycle fields are unchanged');
    check(S.contracts[0].endDate === undefined, 'endDate is never persisted (it stays derived)');
    const newWrites = rt.ctl.writes.slice(writesBefore.length);
    check(newWrites.length === 1 && newWrites[0] === CONTRACTS_KEY, 'exactly one storage key is written — the contracts collection (no compound persistence)');
  }

  console.log('');
  if(failures.length){
    console.log('RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
    failures.forEach(f => console.log('   - ' + f));
    process.exit(1);
  }
  console.log('RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})().catch(e => { console.error('RUNTIME VERIFICATION ERROR', e); process.exit(1); });
