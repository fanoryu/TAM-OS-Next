#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-006C2C-2 — FINANCE + IMPORT AUTHORIZATION — RUNTIME VERIFICATION
   ------------------------------------------------------------
   Proves the frozen Decision F2 mapping at the real Finance and Smart Import
   mutation boundaries, and SE-0 (denied ⇒ no state change, no persistence, no
   audit). Executes the production handlers through the same vm loader used by the
   other harnesses (module-order.js MINUS core/app-bootstrap.js), driving identity
   via the real LocalIdentityProvider.

   Frozen mapping:
     executeTransaction                                   -> finance.execute
     schedule/cancel/archive/duplicate/saveEdited         -> finance.manage
     commitSmartImport                                    -> import.commit
   `finance.execute` stays the IRREVERSIBLE posting capability and must not depend
   on `finance.manage`; that separation is proven by driving the boundaries with an
   instrumented can() rather than by inspecting source text.

   Persistence AND audit flow through localStorage writes (persist / saveAllData /
   logActivity), so a single write-spy (ctl.writes) captures both: denied ⇒ 0 writes.
   All are CEO-only; Employee and an unresolved principal deny. Fixtures fabricated;
   no file modified.
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
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const toasts = [];
  const sandbox = {
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-c2c2' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-c2c2-runtime.js' });
  sandbox.toast = function(m){ toasts.push(String(m)); };
  sandbox.showWarning = function(m){ toasts.push('WARN:'+String(m)); };
  sandbox.showSuccess = function(m){ toasts.push('OK:'+String(m)); };
  sandbox.showError = function(m){ toasts.push('ERR:'+String(m)); };
  sandbox.render = noop; sandbox.closeModal = noop; sandbox.confirmAction = ()=>true;
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.memStore = memStore; rt.ctl = ctl; rt.toasts = toasts;
  return rt;
}

const EMP = (o)=>Object.assign({ id:'emp_fixture_self', employeeId:'SELF', fullName:'SAMPLE — Self',
  employmentStatus:'Active', active:true, monthlyBaseSalary:1000000, joinDate:'2024-01-01', createdAt:N, updatedAt:N }, o);
const TXN = (o)=>Object.assign({ id:'t1', monthKey:'2025-01', month:'Januari', year:2025, monthNum:1,
  category:'Lainnya', categoryCode:'L', no:null, uraian:'SAMPLE — planned transaction', vol:1, satuan:'paket',
  hargaSatuan:500000, planned:500000, actual:null, type:'expense', txnDate:null, source:'manual',
  unplanned:false, execution:null, status:'planned', history:[{event:'created',ts:N,note:'seed'}] }, o);

function seed(rt, opts){
  opts = opts || {};
  const S = rt.State;
  S.settings = { companyWorkHoursPerDay:8, companyWorkDaysPerWeek:5, companyWeeksPerMonth:4,
    overtimeRounding:'none', payrollLocks:{}, autoArchiveCompleted:false, defaultPayrollCategory:'Gaji' };
  S.employees = [ EMP() ];
  S.contracts = []; S.overtimeRecords = []; S.monthlyPlans = []; S.txns = [ TXN() ];
  S.payrollPlans = []; S.payrollAdjustments = []; S.recurringExpenses = []; S.employeeMerges = [];
  S.companyAccounts = []; S.supplementalPayments = []; S.importBatches = []; S.backups = [];
  S.auditLog = S.auditLog || []; S.payrollMonth = '2025-01';
  if(opts.principal) rt.w.LocalIdentityProvider.selectPrincipal(opts.principal);
  rt.ctl.writes.length = 0;
  return S;
}

// An empty Smart Import model: a denied commit must not even reach the parse/fan-out,
// so the model deliberately carries nothing to commit.
const MODEL = ()=>({ batchId:'batch_fixture', fileName:'SAMPLE.xlsx', items:[], candidates:new Map(), months:[] });

const EXEC_DATA = { executionDate:'2025-01-15', actualAmount:500000, method:'Transfer', bank:'SAMPLE BANK',
  reference:'SAMPLE-REF', notes:'fabricated fixture' };

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
const deniedTxn = (r)=> !!r && r.ok === false;
const deniedImport = (r)=> !!r && r.ok === false && r.error === 'NotAuthorized';

// Instrumented can(): records every action asked for and answers from `allow`.
// Overriding the global binding is exactly how the production boundaries reach can(),
// so this proves which capability a boundary really consults.
function spyCan(rt, allow){
  const asked = [];
  rt.w.can = function(action){ asked.push(action); return allow.indexOf(action) !== -1; };
  return asked;
}

const TXN_BOUNDARIES = [
  ['schedule',  (rt)=> rt.w.scheduleTransaction('t1','2025-02-01')],
  ['cancel',    (rt)=> rt.w.cancelTransaction('t1')],
  ['archive',   (rt)=> rt.w.archiveTransaction('t1')],
  ['duplicate', (rt)=> rt.w.duplicateTransaction('t1')],
  ['edit',      (rt)=> rt.w.saveEditedTransaction('t1',{ uraian:'SAMPLE — edited' })]
];

(async function main(){
  console.log('== UX-006C2C-2 FINANCE + IMPORT AUTHORIZATION — RUNTIME VERIFICATION ==');
  console.log('   Decision F2: finance.execute (posting) vs finance.manage (administration);');
  console.log('   import.commit at the Smart Import commit boundary. SE-0 at every boundary.');
  console.log('');
  const EMP_P = 'user_employee_fixture';
  const CEO_P = 'user_ceo_fixture';

  /* 1. ACTION registry — exactly one new action */
  console.log('-- 1. ACTIONS registry (16 -> 17) --');
  { const rt = loadRuntime();
    // UX-006C2C-3 raised the vocabulary to 20; this C2C-2 harness asserts the count it
    // shares with the registry, plus the C2C-2 actions it actually owns.
    check(rt.ACTION_SET.length === 20, 'ACTIONS: exactly 20 actions (C2C-2 finance.manage + C2C-3 trio)');
    check(rt.ACTION_SET.indexOf('finance.manage') !== -1, 'ACTIONS: finance.manage exists');
    check(rt.ACTIONS.FINANCE_MANAGE === 'finance.manage', 'ACTIONS.FINANCE_MANAGE maps to finance.manage');
    check(rt.ACTIONS.FINANCE_EXECUTE === 'finance.execute', 'ACTIONS.FINANCE_EXECUTE preserved');
    check(rt.ACTIONS.IMPORT_COMMIT === 'import.commit', 'ACTIONS.IMPORT_COMMIT preserved');
    check(!rt.ACTION_SET.some(function(x){ return /\.read(\.|$)/.test(x); }), 'ACTIONS: still no *.read action'); }

  /* 2. Policy matrix — CEO allow / Employee deny / null deny */
  console.log('-- 2. policy matrix for the three C2C-2 actions --');
  const C2C2_ACTIONS = ['finance.execute','finance.manage','import.commit'];
  { const rt = loadRuntime(); seed(rt, { principal: CEO_P });
    C2C2_ACTIONS.forEach(function(a){ check(rt.w.can(a) === true, 'CEO: allowed ' + a); }); }
  { const rt = loadRuntime(); seed(rt, { principal: EMP_P });
    C2C2_ACTIONS.forEach(function(a){ check(rt.w.can(a) === false, 'Employee: denied ' + a); }); }
  { const rt = loadRuntime(); seed(rt); rt.w.LocalIdentityProvider.selectPrincipal(null);
    check(rt.w.getCurrentUser() === null, 'null: identity is genuinely unresolved');
    C2C2_ACTIONS.forEach(function(a){ check(rt.w.can(a) === false, 'null: denied ' + a + ' (fail-closed)'); }); }

  /* 3. NULL — every boundary denies with SE-0 */
  console.log('-- 3. currentUser === null : all deny with SE-0 --');
  await assertSE0('null: execute transaction', null, (rt)=> rt.w.executeTransaction('t1', EXEC_DATA), deniedTxn);
  for(const b of TXN_BOUNDARIES) await assertSE0('null: ' + b[0] + ' transaction', null, b[1], deniedTxn);
  await assertSE0('null: smart import commit', null, (rt)=> rt.w.commitSmartImport(MODEL()), deniedImport);

  /* 4. EMPLOYEE — every boundary denies with SE-0 */
  console.log('-- 4. Employee : all deny with SE-0 --');
  await assertSE0('employee: execute transaction', EMP_P, (rt)=> rt.w.executeTransaction('t1', EXEC_DATA), deniedTxn);
  for(const b of TXN_BOUNDARIES) await assertSE0('employee: ' + b[0] + ' transaction', EMP_P, b[1], deniedTxn);
  await assertSE0('employee: smart import commit', EMP_P, (rt)=> rt.w.commitSmartImport(MODEL()), deniedImport);

  /* 5. Which capability each boundary actually consults (frozen mapping) */
  console.log('-- 5. boundary -> ACTION mapping (instrumented can()) --');
  { const rt = loadRuntime(); seed(rt, { principal: CEO_P });
    const asked = spyCan(rt, ['finance.execute','finance.manage','import.commit']);
    await rt.w.executeTransaction('t1', EXEC_DATA);
    check(asked.indexOf('finance.execute') !== -1, 'executeTransaction consults finance.execute');
    check(asked.indexOf('finance.manage') === -1, 'executeTransaction does NOT consult finance.manage'); }
  { const rt = loadRuntime(); seed(rt, { principal: CEO_P });
    // finance.execute alone must NOT authorize the irreversible boundary's siblings,
    // and denying finance.manage must not disable execution.
    const asked = spyCan(rt, ['finance.execute']);
    const r = await rt.w.executeTransaction('t1', EXEC_DATA);
    check(r && r.ok === true, 'executeTransaction succeeds with finance.execute alone (no finance.manage dependency)');
    check(asked.filter(function(a){ return a === 'finance.execute'; }).length === 1, 'executeTransaction authorizes exactly once'); }
  for(const b of TXN_BOUNDARIES){
    const rt = loadRuntime(); seed(rt, { principal: CEO_P });
    const asked = spyCan(rt, ['finance.execute','finance.manage','import.commit']);
    await b[1](rt);
    check(asked.indexOf('finance.manage') !== -1, b[0] + ' transaction consults finance.manage');
    check(asked.indexOf('finance.execute') === -1, b[0] + ' transaction does NOT consult finance.execute');
  }
  for(const b of TXN_BOUNDARIES){
    const rt = loadRuntime(); const S = seed(rt, { principal: CEO_P });
    spyCan(rt, ['finance.execute','import.commit']);   // everything EXCEPT finance.manage
    const before = JSON.stringify(S); const w = rt.ctl.writes.length;
    const r = await b[1](rt);
    check(deniedTxn(r), b[0] + ' transaction denied when only finance.manage is withheld');
    check(JSON.stringify(rt.State) === before && rt.ctl.writes.length - w === 0,
      b[0] + ' transaction: SE-0 when finance.manage is withheld');
  }
  { const rt = loadRuntime(); seed(rt, { principal: CEO_P });
    const asked = spyCan(rt, ['import.commit']);
    await rt.w.commitSmartImport(MODEL());
    check(asked.indexOf('import.commit') !== -1, 'commitSmartImport consults import.commit');
    check(asked.length === 1, 'commitSmartImport authorizes exactly once (single top gate)');
    check(asked.indexOf('finance.manage') === -1 && asked.indexOf('finance.execute') === -1,
      'commitSmartImport does NOT consult any finance action'); }

  /* 6. CEO — zero regression: the real boundaries still work */
  console.log('-- 6. CEO : boundaries authorized (zero regression) --');
  { const rt = loadRuntime(); seed(rt, { principal: CEO_P });
    const r = await rt.w.executeTransaction('t1', EXEC_DATA);
    const t = rt.State.txns.find(function(x){ return x.id === 't1'; });
    check(r && r.ok === true, 'CEO: executeTransaction succeeds');
    check(t.status === 'completed' && t.actual === 500000 && !!t.execution, 'CEO: execution recorded (planned -> actual)');
    check(/"type":"finance\.execute"/.test(rt.memStore['tam_audit_log_v1'] || ''), 'CEO: finance.execute audit entry written'); }
  { const rt = loadRuntime(); seed(rt, { principal: CEO_P });
    const r = await rt.w.scheduleTransaction('t1','2025-02-01');
    check(r && r.ok === true && rt.State.txns[0].status === 'scheduled', 'CEO: scheduleTransaction succeeds'); }
  { const rt = loadRuntime(); seed(rt, { principal: CEO_P });
    const r = await rt.w.cancelTransaction('t1');
    check(r && r.ok === true && rt.State.txns[0].status === 'cancelled', 'CEO: cancelTransaction succeeds'); }
  { const rt = loadRuntime(); seed(rt, { principal: CEO_P });
    const r = await rt.w.archiveTransaction('t1');
    check(r && r.ok === true && rt.State.txns[0].status === 'archived', 'CEO: archiveTransaction succeeds'); }
  { const rt = loadRuntime(); seed(rt, { principal: CEO_P });
    const r = await rt.w.duplicateTransaction('t1');
    check(r && r.ok === true && rt.State.txns.length === 2 && rt.State.txns[1].status === 'planned',
      'CEO: duplicateTransaction succeeds (planned copy)'); }
  { const rt = loadRuntime(); seed(rt, { principal: CEO_P });
    const r = await rt.w.saveEditedTransaction('t1',{ uraian:'SAMPLE — edited' });
    check(r && r.ok === true && rt.State.txns[0].uraian === 'SAMPLE — edited', 'CEO: saveEditedTransaction succeeds'); }
  { const rt = loadRuntime(); seed(rt, { principal: CEO_P });
    const r = await rt.w.commitSmartImport(MODEL());
    check(r && r.error !== 'NotAuthorized', 'CEO: commitSmartImport authorized (proceeds; not an authz denial)');
    check(rt.State.backups.length === 1, 'CEO: the pre-import safety backup is taken'); }

  /* 6b. UI CALL SITES — a denied boundary must never be REPORTED as a success.
     Governance BLOCKER-1 (Atlas review of PR #119): the Execution Center "Schedule"
     control ignored the scheduleTransaction result and always emitted
     showSuccess('Transaction scheduled.'), so a denied Employee was told the schedule
     had happened. The mutation was correctly blocked — only the report was wrong.
     This drives the REAL production click handler: renderExecutionCenter binds it via
     main.querySelectorAll('[data-schedule-txn]'), so a stub `main` captures the actual
     listener and invokes it. No production code is modified by the harness. */
  console.log('-- 6b. Execution Center Schedule control : denial is never reported as success --');
  function captureScheduleHandler(rt){
    let handler = null;
    const btn = { dataset:{ scheduleTxn:'t1' }, addEventListener:(ev, fn)=>{ if(ev==='click') handler = fn; } };
    const main = { innerHTML:'', querySelector:()=>null,
      querySelectorAll:(sel)=> sel === '[data-schedule-txn]' ? [btn] : [] };
    rt.w.prompt = ()=> '2025-02-01';                       // a valid date: passes the format guard
    rt.w.renderExecutionCenter(main);
    return handler;
  }
  for(const [label, principal] of [['employee', EMP_P], ['null', null]]){
    const rt = loadRuntime(); const S = seed(rt, { principal: principal });
    // The row must be unscheduled+planned so the Schedule control is bound for it.
    S.txns[0].txnDate = null; S.txns[0].scheduledDate = null; S.txns[0].status = 'planned';
    const handler = captureScheduleHandler(rt);
    check(typeof handler === 'function', label + ': Execution Center Schedule handler bound (fixture reaches the control)');
    if(typeof handler !== 'function') continue;
    const before = JSON.stringify(rt.State); const w = rt.ctl.writes.length;
    rt.toasts.length = 0;
    await handler({ stopPropagation:function(){} });
    const said = rt.toasts.join(' | ');
    check(!/OK:Transaction scheduled\./.test(said), label + ': denied Schedule reports NO success message');
    check(/WARN:/.test(said), label + ': denied Schedule reports the denial to the user');
    check(JSON.stringify(rt.State) === before, label + ': denied Schedule leaves State byte-identical');
    check(rt.ctl.writes.length - w === 0, label + ': denied Schedule performs zero writes');
  }
  { const rt = loadRuntime(); const S = seed(rt, { principal: CEO_P });
    S.txns[0].txnDate = null; S.txns[0].scheduledDate = null; S.txns[0].status = 'planned';
    const handler = captureScheduleHandler(rt);
    rt.toasts.length = 0;
    await handler({ stopPropagation:function(){} });
    const said = rt.toasts.join(' | ');
    check(rt.State.txns[0].status === 'scheduled' && rt.State.txns[0].scheduledDate === '2025-02-01',
      'CEO: Execution Center Schedule still performs the schedule (authorized path not regressed)');
    check(/OK:Transaction scheduled\./.test(said), 'CEO: Execution Center Schedule still reports success'); }

  /* 7. Import denial writes nothing at all — not even the safety backup */
  console.log('-- 7. denied import : no safety backup, no batch, no audit --');
  { const rt = loadRuntime(); const S = seed(rt, { principal: EMP_P });
    const r = await rt.w.commitSmartImport(MODEL());
    check(deniedImport(r), 'denied import returns NotAuthorized');
    check(S.backups.length === 0, 'denied import: no pre-import safety backup written');
    check(S.importBatches.length === 0, 'denied import: no import batch recorded');
    check(!/import\.commit/.test(rt.memStore['tam_audit_log_v1'] || ''), 'denied import: no import.commit audit entry');
    check(rt.ctl.writes.length === 0, 'denied import: zero writes'); }

  /* 8. Regression — unrelated mappings and the public API are intact */
  console.log('-- 8. regression: unrelated authorization unchanged --');
  { const rt = loadRuntime(); seed(rt, { principal: EMP_P });
    check(rt.w.can('overtime.submitSelf', { id:'ot1', employeeId:'emp_fixture_self', status:'Draft' }) === true,
      'regression: Employee overtime.submitSelf on own Draft still allowed');
    check(rt.w.can('payroll.manage', { id:'pp1', employeeId:'emp_fixture_self' }) === false,
      'regression: Employee payroll.manage still denied');
    check(rt.w.can('supplemental.manage') === false && rt.w.can('settings.manage') === false,
      'regression: Employee supplemental/settings still denied'); }
  { const rt = loadRuntime(); seed(rt, { principal: CEO_P });
    check(rt.w.can('contract.update', { id:'c1', employeeId:'emp_fixture_self' }) === true
      && rt.w.can('supplemental.manage') === true && rt.w.can('settings.manage') === true,
      'regression: CEO mappings outside C2C-2 unchanged');
    check(rt.w.can('finance.mange') === false && rt.w.can('') === false,
      'regression: unknown action strings still deny (fail-closed)'); }
  { const rt = loadRuntime();
    check(typeof rt.w.can === 'function' && rt.w.canPrincipal === undefined && rt.w.POLICY === undefined,
      'public can() available; internal canPrincipal/POLICY not on production global'); }

  console.log('');
  if(failures.length){
    console.log('UX-006C2C-2 FINANCE + IMPORT AUTHORIZATION RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f=>console.log('  - ' + f));
    process.exit(1);
  }
  console.log('UX-006C2C-2 FINANCE + IMPORT AUTHORIZATION RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();

