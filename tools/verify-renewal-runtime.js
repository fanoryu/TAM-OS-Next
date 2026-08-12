#!/usr/bin/env node
'use strict';
/* ============================================================
   SPR-077 — CONTRACT RENEWAL RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of the renewal slice (aggregate
   purity, command registration, Repository mediation, absence of any compound
   abstraction). This harness proves its BEHAVIOR by actually executing the
   command through the canonical Platform path:

     TransportAdapter -> ApplicationGateway -> Domain.command
       -> ContractRenewalAggregate (business authority)
       -> renewContract (implementation authority)
       -> ContractRepository.save() -> persistContracts() -> StorageAdapter

   It reproduces the browser's single shared global scope in a Node `vm`
   context using the same loader technique as js/cli/cli.js (EXCLUDING
   core/app-bootstrap.js, the only DOM-executing load-time module). The storage
   backend is an in-memory shim that can be told to FAIL, which is how the
   persistence-failure and in-memory-rollback paths are exercised for real.

   All fixture data is obviously fabricated. Nothing is written to disk, no real
   company data is used, and no repository file is modified.

   Scenarios (SPR-077 §13):
     1. successful renewal
     2. business-rule rejection (terminal status / already renewed / invalid input)
     3. persistence failure
     4. in-memory rollback after persistence failure
     5. no false-success UI or audit behavior
     6. predecessor + successor consistency after success
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

// ---------- runtime loader (same technique as js/cli/cli.js) ----------
function loadRuntime(){
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { TransportAdapter: TransportAdapter, State: State, StorageAdapter: StorageAdapter,'
    + ' ContractRenewalAggregate: ContractRenewalAggregate, ContractRepository: ContractRepository };';
  const noop = function(){};
  // Memory storage shim with a fail switch — this is how a real persist failure
  // is produced (StorageAdapter._localSet returns false when setItem throws).
  const memStore = {}; const ctl = { failWrites:false };
  const memStorage = {
    getItem: (k)=> Object.prototype.hasOwnProperty.call(memStore,k) ? memStore[k] : null,
    setItem: (k,v)=>{ if(ctl.failWrites){ const e = new Error('quota'); e.name='QuotaExceededError'; throw e; } memStore[k] = String(v); },
    removeItem: (k)=>{ delete memStore[k]; }
  };
  // Inert DOM element stub. StorageAdapter reports a failed write to the user via
  // toast(), which resolves #toast-root and appends to it — so getElementById must
  // return an appendable element, exactly as the browser does. These stubs are
  // never used to render anything; they only let the classic scripts run in Node.
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const sandbox = {
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-spr077' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(), body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-spr077-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.ctl = ctl; rt.memStore = memStore; rt.sandbox = sandbox;
  // UX-006C2C-1 — renewContract now authorizes (contract.create). This harness models
  // the valid CEO/company workflow, so it explicitly selects CEO through the real
  // local identity path (no production default introduced).
  sandbox.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  return rt;
}

// Obviously fabricated fixture — never real company data.
function seedContract(rt, over){
  const base = {
    id: 'ct_sample_predecessor', employeeId: 'emp_sample_1', employeeName: 'SAMPLE — Renewal Fixture',
    contractNumber: 'SAMPLE/PRED/001', startDate: '2025-01-01', durationMonths: 12,
    monthlySalary: 1000000, status: 'Active', notes: 'Sample predecessor',
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
    history: [{ event:'created', ts:'2025-01-01T00:00:00.000Z', note:'Sample' }]
  };
  rt.State.contracts = [Object.assign(base, over || {})];
  return rt.State.contracts[0];
}

const GOOD = {
  contractNumber: 'SAMPLE/SUCC/002', startDate: '2026-01-01',
  durationMonths: 12, monthlySalary: 1200000, status: 'Active'
};

function renew(rt, id, patch){
  return rt.TransportAdapter.execute({ kind:'command', name:'contract.renewal.execute', args:[id, patch] });
}

(async function main(){
  console.log('== SPR-077 CONTRACT RENEWAL — RUNTIME VERIFICATION ==');

  // ---------- 1 + 6. Successful renewal; predecessor/successor consistency ----------
  console.log('-- scenario 1/6: successful renewal + entity consistency --');
  {
    const rt = loadRuntime();
    const pred = seedContract(rt);
    const res = await renew(rt, pred.id, GOOD);
    check(res.ok === true, 'platform envelope reports completion');
    const out = res.result;
    check(out && out.success === true, 'renewal succeeds through the canonical Platform path');
    check(rt.State.contracts.length === 2, 'exactly one successor was created (no duplicates)');
    const succ = rt.State.contracts.find(c => c.id !== pred.id);
    // Predecessor
    check(pred.status === 'Renewed', 'predecessor moved to the terminal Renewed status');
    check(pred.renewedToId === succ.id, 'predecessor links forward to the successor');
    check(pred.updatedAt !== '2025-01-01T00:00:00.000Z', 'predecessor updatedAt was advanced by the handler');
    check(pred.history.length === 2 && pred.history[1].event === 'renewed', 'predecessor gained exactly one renewed history entry');
    check(pred.history[1].note === 'Renewed into SAMPLE/SUCC/002', 'predecessor history note is the aggregate-authored text');
    // Successor
    check(succ.renewedFromId === pred.id, 'successor links back to the predecessor');
    check(succ.contractNumber === 'SAMPLE/SUCC/002' && succ.startDate === '2026-01-01' && succ.durationMonths === 12, 'successor carries the submitted business facts');
    check(succ.monthlySalary === 1200000 && succ.status === 'Active', 'successor carries the submitted salary and initial status');
    check(succ.employeeId === pred.employeeId && succ.employeeName === pred.employeeName, 'successor inherits the employee identity from the predecessor');
    check(succ.notes === 'Renewal of SAMPLE/PRED/001', 'successor notes are the aggregate-authored renewal text');
    check(succ.history.length === 1 && succ.history[0].note === 'Renewed from SAMPLE/PRED/001', 'successor history is the aggregate-authored creation note');
    check(typeof succ.id === 'string' && succ.id.indexOf('ct_') === 0 && succ.id !== pred.id, 'successor received a fresh handler-generated id');
    check(out.data && out.data.predecessor === pred && out.data.successor === succ, 'typed result returns both contracts');
    // ONE collection write covered BOTH contracts (not compound).
    const stored = JSON.parse(rt.memStore['tam_contracts_v1']);
    check(Array.isArray(stored) && stored.length === 2, 'ONE contracts write persisted BOTH the predecessor and the successor');
    check(stored.find(c=>c.id===pred.id).status === 'Renewed' && !!stored.find(c=>c.id===succ.id), 'persisted state matches memory (predecessor Renewed + successor present)');
    check(Object.keys(rt.memStore).filter(k=>k!=='tam_contracts_v1' && k!=='tam_storage_probe').length === 0, 'renewal touched exactly ONE storage key (not a compound operation)');
  }

  // ---------- 2. Business-rule rejection ----------
  console.log('-- scenario 2: business-rule rejection --');
  {
    const cases = [
      ['already-Renewed predecessor is rejected', { status:'Renewed' }, GOOD, 'RenewalNotAllowed'],
      ['Cancelled predecessor is rejected',       { status:'Cancelled' }, GOOD, 'RenewalNotAllowed'],
      ['predecessor with an existing successor is rejected', { renewedToId:'ct_existing' }, GOOD, 'ContractAlreadyRenewed'],
      ['empty successor contract number is rejected', {}, Object.assign({}, GOOD, {contractNumber:'   '}), 'InvalidContractNumber'],
      ['non-canonical successor start date is rejected', {}, Object.assign({}, GOOD, {startDate:'2026-02-31'}), 'InvalidStartDate'],
      ['zero/negative successor duration is rejected', {}, Object.assign({}, GOOD, {durationMonths:'0'}), 'InvalidDurationMonths'],
      ['negative successor salary is rejected', {}, Object.assign({}, GOOD, {monthlySalary:'-5'}), 'InvalidMonthlySalary'],
      ['non-offered successor status is rejected', {}, Object.assign({}, GOOD, {status:'Renewed'}), 'InvalidContractStatusState']
    ];
    for(const [label, predOver, patch, expected] of cases){
      const rt = loadRuntime();
      const pred = seedContract(rt, predOver);
      const before = JSON.stringify(rt.State.contracts);
      const res = await renew(rt, pred.id, patch);
      const out = res.result;
      check(out && out.success === false && out.error === expected, label + ' (' + expected + ')');
      check(rt.State.contracts.length === 1, label + ' — no successor was created');
      check(JSON.stringify(rt.State.contracts) === before, label + ' — no contract was mutated');
      check(rt.memStore['tam_contracts_v1'] === undefined, label + ' — nothing was persisted');
    }
    // Unknown contract
    const rt = loadRuntime(); seedContract(rt);
    const res = await renew(rt, 'ct_does_not_exist', GOOD);
    check(res.result && res.result.error === 'ContractNotFound', 'unknown contract id is rejected (ContractNotFound)');
    check(rt.memStore['tam_contracts_v1'] === undefined, 'unknown contract id persists nothing');
  }

  // ---------- 3 + 4 + 5. Persistence failure, rollback, no false success ----------
  console.log('-- scenario 3/4/5: persistence failure + in-memory rollback + no false success --');
  {
    const rt = loadRuntime();
    const pred = seedContract(rt);
    const snapshot = JSON.stringify(rt.State.contracts);
    rt.ctl.failWrites = true;                       // storage now rejects every write
    const res = await renew(rt, pred.id, GOOD);
    const out = res.result;
    // 3. Persistence failure is reported as a typed FAILURE, never as success.
    check(res.ok === true, 'a persistence failure is a business outcome, not a Platform fault');
    check(out && out.success === false, 'renewal reports FAILURE when the write fails (no false success)');
    check(out.error === 'PersistFailed', 'the typed failure is PersistFailed');
    check(!out.data, 'a failed renewal returns no successor payload for the UI to navigate to');
    // 4. In-memory rollback — State.contracts matches the last persisted state.
    check(rt.State.contracts.length === 1, 'rollback removed the successor from memory');
    check(pred.status === 'Active', 'rollback restored the predecessor status');
    check(pred.renewedToId === undefined, 'rollback removed the predecessor forward link');
    check(pred.updatedAt === '2025-01-01T00:00:00.000Z', 'rollback restored the predecessor updatedAt');
    check(pred.history.length === 1, 'rollback dropped the predecessor history entry');
    check(JSON.stringify(rt.State.contracts) === snapshot, 'in-memory contracts are byte-identical to the pre-renewal state');
    // 5. Nothing was persisted and no audit record was written.
    check(rt.memStore['tam_contracts_v1'] === undefined, 'nothing was persisted');
    check(!(rt.State.activityLog || []).some(a => String(a.type||'').indexOf('renew') !== -1), 'no renewal audit record was written for a failed renewal');
    // Retry after storage recovers must succeed cleanly from the restored state.
    rt.ctl.failWrites = false;
    const retry = await renew(rt, pred.id, GOOD);
    check(retry.result && retry.result.success === true, 'retry succeeds once storage recovers (state was left retry-able)');
    check(rt.State.contracts.length === 2, 'retry created exactly one successor (rollback left no residue)');
  }

  // ---------- summary ----------
  console.log('');
  if(failures.length){
    console.log('RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
    failures.forEach(f => console.log('   - ' + f));
    process.exit(1);
  }
  console.log('RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})().catch(e => { console.error('RUNTIME VERIFICATION ERROR', e); process.exit(1); });
