#!/usr/bin/env node
'use strict';
/* ============================================================
   SPR-078 — PAYROLL POSTING AUTHORITY / COMMITTED-STATE RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of the SPR-078 slice (dead surface
   removed, one posting path, one predicate, no lowercase writer). This harness
   proves its BEHAVIOR by executing the live posting path and by exercising BOTH
   status spellings against every migrated reader.

   It reproduces the browser's single shared global scope in a Node `vm` context
   using the same loader technique as js/cli/cli.js and the SPR-077 harness.

   All fixture data is obviously fabricated. Nothing is written to disk and no
   repository file is modified.

   SCOPE NOTE (explicit, per SPR-078 §12): persistence-failure behavior is NOT
   covered here and was NOT changed by SPR-078. The live posting path still writes
   four stores sequentially and still discards their results. That remains the open
   compound-persistence problem recorded in ATR-011 and is out of scope for this
   sprint. Nothing in SPR-078 claims cross-key atomicity.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

function loadRuntime(){
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { State: State, StorageAdapter: StorageAdapter,'
    + ' PAYROLL_STATUSES: PAYROLL_STATUSES, PAYROLL_COMMITTED_STATUS: PAYROLL_COMMITTED_STATUS,'
    + ' PAYROLL_COMMITTED_STATUS_LEGACY: PAYROLL_COMMITTED_STATUS_LEGACY };';
  const noop = function(){};
  const memStore = {};
  const memStorage = {
    getItem: (k)=> Object.prototype.hasOwnProperty.call(memStore,k) ? memStore[k] : null,
    setItem: (k,v)=>{ memStore[k] = String(v); },
    removeItem: (k)=>{ delete memStore[k]; }
  };
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const sandbox = {
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-spr078' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(), body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-spr078-runtime.js' });
  const rt = sandbox.__TAM__; rt.w = sandbox; rt.memStore = memStore;
  // UX-006C2C-1 — payroll lifecycle/commit now authorize (payroll.manage). This harness
  // models the valid CEO/company workflow; select CEO explicitly (no production default).
  sandbox.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  return rt;
}

const MONTH = '2026-03';
function seed(rt, planOver){
  const now = new Date().toISOString();
  rt.State.employees = [{id:'emp_1', employeeId:'E1', fullName:'SAMPLE — Payroll Fixture', employmentStatus:'Active', active:true, monthlyBaseSalary:1000000, joinDate:'2025-01-01', workHoursPerDay:8, workDaysPerWeek:5, weeksPerMonth:4, createdAt:now, updatedAt:now}];
  rt.State.contracts = [{id:'ct_1', employeeId:'emp_1', employeeName:'SAMPLE — Payroll Fixture', contractNumber:'SAMPLE/P/1', startDate:'2025-01-01', durationMonths:36, monthlySalary:1000000, status:'Active', createdAt:now, updatedAt:now, history:[]}];
  rt.State.overtimeRecords = []; rt.State.monthlyPlans = []; rt.State.txns = [];
  rt.State.payrollAdjustments = []; rt.State.activityLog = rt.State.activityLog || [];
  rt.State.payrollPlans = [Object.assign({
    id:'pp_1', monthKey:MONTH, month:'March', year:2026, monthNum:3,
    employeeId:'emp_1', employeeName:'SAMPLE — Payroll Fixture', contractId:'ct_1',
    contractNumber:'SAMPLE/P/1', contractProgress:'15/36',
    baseSalary:1000000, baseSalarySnapshot:1000000, overtime:0, overtimeAmount:0,
    allowance:0, deduction:0, bonus:0, benefits:0, otherAddition:0, otherDeduction:0,
    plannedAmount:1000000, overtimeIds:[], status:'Ready', history:[],
    createdAt:now, updatedAt:now
  }, planOver || {})];
  return rt.State.payrollPlans[0];
}

(async function main(){
  console.log('== SPR-078 PAYROLL POSTING AUTHORITY — RUNTIME VERIFICATION ==');

  // ---------- 1. The retired planning surface is genuinely gone ----------
  console.log('-- scenario 1: retired legacy surface --');
  {
    const rt = loadRuntime(); const w = rt.w;
    ['commitPayroll','renderPayrollPlanning','renderPayrollDraft','payrollRowHTML','generatePayrollRows','buildPayrollTxn','payrollAmount','samePayrollComponents'].forEach((f)=>
      check(typeof w[f] === 'undefined', 'retired symbol is undefined at runtime: '+f));
    check(typeof w.num === 'function', 'preserved shared utility num() still resolves');
    check(typeof w.ensureMonthlyPlan === 'function', 'preserved shared utility ensureMonthlyPlan() still resolves');
    check(typeof w.commitReadyPayroll === 'function', 'the sole live posting path commitReadyPayroll() resolves');
    check(typeof w.isPayrollCommitted === 'function', 'the shared predicate isPayrollCommitted() resolves');
  }

  // ---------- 2. The predicate contract ----------
  console.log('-- scenario 2: canonical predicate contract --');
  {
    const rt = loadRuntime(); const w = rt.w;
    check(rt.PAYROLL_COMMITTED_STATUS === 'Committed', 'canonical constant is "Committed"');
    check(rt.PAYROLL_COMMITTED_STATUS_LEGACY === 'committed', 'legacy read constant is "committed"');
    check(rt.PAYROLL_STATUSES.indexOf('Committed') !== -1, 'canonical value is a member of PAYROLL_STATUSES');
    check(rt.PAYROLL_STATUSES.indexOf('committed') === -1, 'the legacy lowercase value is NOT a member of PAYROLL_STATUSES');
    check(w.isPayrollCommitted({status:'Committed'}) === true, 'predicate accepts a canonical record');
    check(w.isPayrollCommitted({status:'committed'}) === true, 'predicate accepts a legacy record (read compatibility)');
    check(w.isPayrollCommitted('Committed') === true && w.isPayrollCommitted('committed') === true, 'predicate accepts a bare status string in both spellings');
    ['Draft','Reviewed','Ready','Cancelled',''].forEach(s=>
      check(w.isPayrollCommitted({status:s}) === false, 'predicate rejects non-committed status: '+(s||'<empty>')));
    check(w.isPayrollCommitted(null) === false && w.isPayrollCommitted(undefined) === false, 'predicate is null/undefined safe');
    check(w.isPayrollCommitted({}) === false, 'predicate rejects a record with no status');
  }

  // ---------- 3. Successful posting through the sole live path ----------
  console.log('-- scenario 3: posting through the sole live path --');
  {
    const rt = loadRuntime(); const w = rt.w;
    const pp = seed(rt);
    const res = await w.commitReadyPayroll(MONTH, ['pp_1']);
    check(res.created === 1 && res.skipped === 0, 'posting creates one finance transaction');
    check(pp.status === 'Committed', 'the sole live path writes the CANONICAL status');
    check(pp.status !== 'committed', 'the sole live path never writes the lowercase legacy status');
    check(rt.PAYROLL_STATUSES.indexOf(pp.status) !== -1, 'the written status is a valid PAYROLL_STATUSES member');
    check(!!pp.committedAt, 'committedAt is set');
    check(!!pp.committedSnapshot, 'the immutable committed snapshot is frozen');
    check(rt.State.monthlyPlans[0].status === 'Committed', 'MonthlyPlan is committed');
    check(rt.State.monthlyPlans[0].committedTxnIds.length === 1, 'MonthlyPlan links the committed transaction');
    check(rt.State.txns.length === 1 && rt.State.txns[0].payrollPlanId === 'pp_1', 'the Finance transaction carries structured payroll linkage');
    check(w.payrollStage(pp) === 'Posted', 'payrollStage reports Posted');
    check(w.payrollCycleStatus(MONTH) === 'Committed', 'payrollCycleStatus reports Committed');
    const audit = JSON.parse(rt.memStore['tam_audit_log_v1'] || '[]');
    check(audit.filter(a=>a.type==='payroll.post').length === 1, 'exactly ONE posting audit entry is written');
    // Re-posting is idempotent: no duplicate transaction.
    const again = await w.commitReadyPayroll(MONTH, ['pp_1']);
    check(again.created === 0 && again.skipped === 1, 're-posting a committed row is skipped, never duplicated');
    check(rt.State.txns.length === 1, 'no duplicate finance transaction is created');
  }

  // ---------- 4. Rules cannot be bypassed (there is no alternate path) ----------
  console.log('-- scenario 4: lock / blockers / source-status enforcement --');
  {
    // not Ready
    let rt = loadRuntime(); let w = rt.w; seed(rt, {status:'Draft'});
    let res = await w.commitReadyPayroll(MONTH, ['pp_1']);
    check(res.created === 0 && res.skipped === 1, 'a non-Ready row is skipped');
    check(rt.State.payrollPlans[0].status === 'Draft', 'a skipped row keeps its original status');
    check(rt.State.txns.length === 0, 'a skipped row creates no finance transaction');

    // period locked
    rt = loadRuntime(); w = rt.w; seed(rt);
    rt.State.settings.payrollLocks = {}; rt.State.settings.payrollLocks[MONTH] = true;   // lock map, not array
    res = await w.commitReadyPayroll(MONTH, ['pp_1']);
    check(res.locked === true && res.created === 0, 'a locked period refuses posting');
    check(rt.State.payrollPlans[0].status === 'Ready', 'a locked period leaves the row untouched');
    check(rt.State.txns.length === 0, 'a locked period creates no finance transaction');

    // commit blocker (no covering contract)
    rt = loadRuntime(); w = rt.w; seed(rt);
    rt.State.contracts = [];
    res = await w.commitReadyPayroll(MONTH, ['pp_1']);
    check(res.created === 0 && res.skipped === 1 && res.skippedDetails.length === 1, 'a blocked row is skipped with a reported reason');
    check(rt.State.txns.length === 0, 'a blocked row creates no finance transaction');
  }

  // ---------- 5. Every migrated reader agrees on BOTH spellings ----------
  console.log('-- scenario 5: reader safety for Committed AND legacy committed --');
  for(const spelling of ['Committed', 'committed']){
    const rt = loadRuntime(); const w = rt.w;
    const pp = seed(rt, {status: spelling, committedTxnId:'txn_1', transactionId:'txn_1', monthlyPlanId:'mp_1', otChanged:true});
    rt.State.txns = [{id:'txn_1', monthKey:MONTH, month:'March', year:2026, monthNum:3, uraian:'SAMPLE',
      planned:1000000, actual:null, type:'expense', status:'planned', source:'payroll',
      employeeId:'emp_1', contractId:'ct_1', payrollPlanId:'pp_1', history:[]}];
    rt.State.monthlyPlans = [{id:'mp_1', monthKey:MONTH, month:'March', year:2026, monthNum:3, status:'Committed', committedTxnIds:['txn_1'], createdAt:new Date().toISOString()}];
    const tag = '['+spelling+'] ';

    check(w.isPayrollCommitted(pp) === true, tag+'predicate recognises the row');
    check(w.payrollStage(pp) === 'Posted', tag+'payrollStage reports Posted (not Draft)');
    check(w.payrollCycleStatus(MONTH) === 'Committed', tag+'payrollCycleStatus reports Committed');
    check(w.payrollStageCounts(MONTH).Posted === 1, tag+'stage counts place the row in Posted');
    check(w.hrDashboardStats(MONTH).payrollCount === 1, tag+'HR dashboard counts the committed payroll');
    check(w.hrDashboardStats(MONTH).payrollPlanned === 1000000, tag+'HR dashboard totals the committed amount');
    // Contract-cancellation safety guard (CLAUDE.md §8.1 committed-payroll immutability).
    check(w.payrollPlansForContract('ct_1').some(w.isPayrollCommitted) === true, tag+'the contract-cancellation guard sees the committed payroll');
    // Integrity checker + overtime-drift alert.
    const integrity = w.runIntegrityCheck ? w.runIntegrityCheck() : null;
    check(integrity !== null, tag+'integrity check runs');
    check((w.hrDashboardAlerts(MONTH)||[]).length >= 0, tag+'dashboard alerts evaluate without error');
    // A row generated for a month that already has committed payroll must not duplicate.
    const before = rt.State.payrollPlans.length;
    w.generatePayrollForMonth(MONTH);
    check(rt.State.payrollPlans.length === before, tag+'generation does not duplicate a committed row');
    check(rt.State.payrollPlans[0].status === spelling, tag+'generation leaves the committed row untouched');
  }

  // ---------- 6. No live writer produces the legacy value ----------
  console.log('-- scenario 6: writer prohibition --');
  {
    const rt = loadRuntime(); const w = rt.w;
    seed(rt);
    await w.commitReadyPayroll(MONTH, ['pp_1']);
    const lower = rt.State.payrollPlans.filter(p=>p.status === 'committed');
    check(lower.length === 0, 'after posting, no payroll row holds the legacy lowercase status');
    const persisted = JSON.parse(rt.memStore['tam_payroll_plans_v1'] || '[]');
    check(persisted.length === 1 && persisted[0].status === 'Committed', 'the PERSISTED status is canonical');
  }

  console.log('');
  console.log('NOTE (scope): persistence-failure behavior is intentionally NOT covered.');
  console.log('SPR-078 changed no persistence mechanics; the sole posting path still writes four');
  console.log('stores sequentially and discards their results. That remains the open ATR-011');
  console.log('compound-persistence problem. No cross-key atomicity is claimed.');
  console.log('');
  if(failures.length){
    console.log('RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
    failures.forEach(f => console.log('   - ' + f));
    process.exit(1);
  }
  console.log('RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})().catch(e => { console.error('RUNTIME VERIFICATION ERROR', e); process.exit(1); });
