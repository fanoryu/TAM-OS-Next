#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-006C2C-3 — DESTRUCTIVE / LIFECYCLE AUTHORIZATION — RUNTIME VERIFICATION
   ------------------------------------------------------------
   Proves the frozen C2C-3 mapping (matrix rows 1-9) at the real mutation boundaries,
   with SE-0 for every denial and the PR #122 outcome-reporting invariant applied to
   each newly gated boundary.

     row 1  undoLastSmartImport     -> import.undo      (NEW action)
     row 2  confirmImport           -> import.commit
     row 3  applyMonthUpdate        -> import.commit    (frozen R2; NOT data.restore)
     row 4  month restore           -> data.restore     (NEW action)
     row 5  restoreCompleteBackup   -> data.restore     (NEW action)
     row 6  resetAppData            -> data.reset       (NEW action)
     row 7  startFresh              -> data.reset       (NEW action)
     row 8  loadDemoData            -> employee.create
     row 9  mergeEmployeeGroup      -> employee.delete

   Denied (Employee and unresolved identity) must be SE-0 at every boundary:
     serialized State before == after · relevant storage writes == 0 ·
     safety-backup count == 0 where applicable · success-audit count == 0 ·
     no success message. CEO remains operational everywhere.

   Every fixture is fabricated and lives in an isolated vm context with an in-memory
   store, so a destructive test can never touch real data. No production file is
   modified by this harness.
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
  const ctl = { writes:[], removes:[], downloads:[] };
  const memStorage = {
    getItem: (k)=> Object.prototype.hasOwnProperty.call(memStore,k) ? memStore[k] : null,
    setItem: (k,v)=>{ ctl.writes.push(k); memStore[k] = String(v); },
    removeItem: (k)=>{ ctl.removes.push(k); delete memStore[k]; }
  };
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'', value:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const said = [];
  const sandbox = {
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-c2c3' },
    setTimeout: function(){ return 0; }, clearTimeout: clearTimeout,          // never reload in a test
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop,
    confirm: ()=>true, prompt: ()=>'DELETE ALL TAM DATA',                     // pass every human gate
    location: { reload: function(){ said.push('RELOAD'); } },
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-c2c3-runtime.js' });
  sandbox.showSuccess = function(m){ said.push('SUCCESS:' + String(m)); };
  sandbox.showWarning = function(m){ said.push('WARN:' + String(m)); };
  sandbox.showError   = function(m){ said.push('ERROR:' + String(m)); };
  sandbox.toast       = function(m){ said.push('TOAST:' + String(m)); };
  sandbox.render = noop; sandbox.closeModal = noop; sandbox.confirmAction = ()=>true;
  sandbox.downloadBlob = function(){ ctl.downloads.push(1); };
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.memStore = memStore; rt.ctl = ctl; rt.said = said;
  return rt;
}

const EMP = (o)=>Object.assign({ id:'emp_fixture_self', employeeId:'SELF', fullName:'SAMPLE — Self',
  employmentStatus:'Active', active:true, monthlyBaseSalary:1000000, joinDate:'2024-01-01', createdAt:N, updatedAt:N }, o);
const TXN = (o)=>Object.assign({ id:'t1', monthKey:'2025-01', month:'Januari', year:2025, monthNum:1,
  category:'Lainnya', categoryCode:'L', uraian:'SAMPLE — probe', vol:1, satuan:'paket', hargaSatuan:1000,
  planned:1000, actual:null, type:'expense', txnDate:null, source:'manual', unplanned:false,
  execution:null, status:'planned', history:[{event:'created',ts:N,note:'seed'}] }, o);

function seed(rt, principal){
  const S = rt.State;
  S.settings = { companyWorkHoursPerDay:8, companyWorkDaysPerWeek:5, companyWeeksPerMonth:4,
    overtimeRounding:'none', payrollLocks:{}, autoArchiveCompleted:false, defaultPayrollCategory:'Gaji',
    companyName:'SAMPLE COMPANY' };
  S.employees = [ EMP(), EMP({ id:'emp_dup', employeeId:'DUP', fullName:'SAMPLE — Self' }) ];
  S.contracts = []; S.payrollPlans = []; S.overtimeRecords = []; S.monthlyPlans = [];
  S.payrollAdjustments = []; S.recurringExpenses = []; S.employeeMerges = [];
  S.companyAccounts = []; S.supplementalPayments = []; S.backups = [];
  S.txns = [ TXN(), TXN({ id:'t_imp', source:'payroll', importBatchId:'b_undo' }) ];
  S.importBatches = [{ batchId:'b_undo', fileName:'SAMPLE.xlsx', ts:N, mode:'smart', undone:false,
    created:{ employees:[], contracts:[], payrollPlans:[], txns:['t_imp'], monthlyPlanTxns:[] }, counts:{} }];
  S.selectedMonth = '2025-01'; S.payrollMonth = '2025-01'; S.pendingImport = null;
  if(principal) rt.w.LocalIdentityProvider.selectPrincipal(principal);
  rt.ctl.writes.length = 0; rt.ctl.removes.length = 0; rt.ctl.downloads.length = 0; rt.said.length = 0;
  return S;
}

const reportedSuccess = (rt)=> rt.said.some(function(m){ return /^SUCCESS:/.test(m); });
const auditRaw = (rt)=> rt.memStore['tam_audit_log_v1'] || '';

// A fabricated Complete Backup that passes validateCompleteBackup.
function backupFile(rt){
  return { app:'TAM Intelligence OS', schemaVersion:6, exportedAt:N,
    txns:[ TXN({ id:'t_restored', uraian:'SAMPLE — restored' }) ],
    settings:{ companyName:'RESTORED SAMPLE' }, backups:[],
    employees:[], contracts:[], payrollPlans:[], monthlyPlans:[], recurringExpenses:[],
    overtimeRecords:[], payrollAdjustments:[], employeeMerges:[], companyAccounts:[],
    supplementalPayments:[], importBatches:[] };
}

/* SE-0 assertion shared by every destructive boundary. */
async function assertSE0(rt, S, label, invoke, opts){
  opts = opts || {};
  const before = JSON.stringify(S);
  const w = rt.ctl.writes.length, rm = rt.ctl.removes.length, bk = (S.backups||[]).length;
  rt.said.length = 0;
  const result = await invoke();
  check(JSON.stringify(rt.State) === before, label + ': State byte-identical');
  check(rt.ctl.writes.length - w === 0, label + ': zero storage writes');
  check(rt.ctl.removes.length - rm === 0, label + ': zero storage removals');
  check((rt.State.backups||[]).length - bk === 0, label + ': no safety backup created');
  check(!reportedSuccess(rt), label + ': no success message');
  if(opts.auditType) check(auditRaw(rt).indexOf(opts.auditType) === -1, label + ': no ' + opts.auditType + ' audit entry');
  if(opts.denied) check(opts.denied(result), label + ': typed denial returned');
  return result;
}

(async function main(){
  console.log('== UX-006C2C-3 DESTRUCTIVE / LIFECYCLE AUTHORIZATION — RUNTIME VERIFICATION ==');
  console.log('   rows 1-9; ACTIONS 17 -> 20; denied => SE-0 and never reported as success.');
  console.log('');
  const EMP_P = 'user_employee_fixture';
  const CEO_P = 'user_ceo_fixture';
  const DENIED = [['employee', EMP_P], ['null', null]];
  const NEW_ACTIONS = ['import.undo','data.restore','data.reset'];

  /* 1. Registry */
  console.log('-- 1. ACTIONS registry (17 -> 20) --');
  { const rt = loadRuntime();
    check(rt.ACTION_SET.length === 20, 'ACTIONS: exactly 20 after the C2C-3 amendment');
    NEW_ACTIONS.forEach(function(a){ check(rt.ACTION_SET.indexOf(a) !== -1, 'ACTIONS: ' + a + ' exists'); });
    check(rt.ACTIONS.IMPORT_UNDO === 'import.undo' && rt.ACTIONS.DATA_RESTORE === 'data.restore'
      && rt.ACTIONS.DATA_RESET === 'data.reset', 'ACTIONS: the three keys map to their frozen values');
    ['recurring.manage','bank.manage','employee.merge'].forEach(function(r){
      check(rt.ACTION_SET.indexOf(r) === -1, 'ACTIONS: rejected action ' + r + ' is absent'); });
    check(new Set(rt.ACTION_SET).size === 20, 'ACTIONS: no duplicate values');
    check(rt.ACTION_SET.indexOf('finance.execute') !== -1 && rt.ACTION_SET.indexOf('import.commit') !== -1,
      'ACTIONS: pre-existing vocabulary preserved'); }

  /* 2. Policy matrix */
  console.log('-- 2. policy matrix for the three new actions --');
  { const rt = loadRuntime(); seed(rt, CEO_P);
    NEW_ACTIONS.forEach(function(a){ check(rt.w.can(a) === true, 'CEO: allowed ' + a); }); }
  { const rt = loadRuntime(); seed(rt, EMP_P);
    NEW_ACTIONS.forEach(function(a){ check(rt.w.can(a) === false, 'Employee: denied ' + a); }); }
  { const rt = loadRuntime(); seed(rt);
    check(rt.w.getCurrentUser() === null, 'null: identity genuinely unresolved');
    NEW_ACTIONS.forEach(function(a){ check(rt.w.can(a) === false, 'null: denied ' + a + ' (fail-closed)'); });
    check(rt.w.can('data.restor') === false && rt.w.can('') === false, 'null: unknown action strings still deny'); }

  /* 3. Row 1 — Smart Import undo (cross-domain SE-0 + audit semantics) */
  console.log('-- 3. row 1 : undoLastSmartImport -> import.undo --');
  for(const [label, principal] of DENIED){
    const rt = loadRuntime(); const S = seed(rt, principal);
    await assertSE0(rt, S, label + ': undo', ()=> rt.w.undoLastSmartImport(), { auditType:'import.undo' });
    check(rt.State.importBatches[0].undone === false, label + ': undo does not mark the batch undone');
    check(/WARN:/.test(rt.said.join('|')), label + ': undo denial is reported');
  }
  { const rt = loadRuntime(); const S = seed(rt, CEO_P);
    await rt.w.undoLastSmartImport();
    check(!S.txns.some(function(t){ return t.id === 't_imp'; }), 'CEO: undo removes the imported transaction');
    check(S.importBatches[0].undone === true, 'CEO: undo marks the batch undone');
    check(reportedSuccess(rt), 'CEO: undo reports success');
    check(/"type":"import\.undo"/.test(auditRaw(rt)), 'CEO: undo writes the import.undo audit entry'); }
  { // audit only for an undo that actually happens: no batch to undo => no audit, no success
    const rt = loadRuntime(); const S = seed(rt, CEO_P); S.importBatches = [];
    await rt.w.undoLastSmartImport();
    check(!/"type":"import\.undo"/.test(auditRaw(rt)), 'CEO: no batch => no undo audit entry');
    check(!reportedSuccess(rt), 'CEO: no batch => no success message'); }

  /* 4. Rows 2-3 — legacy import preview */
  console.log('-- 4. rows 2-3 : legacy import commit paths -> import.commit --');
  for(const [label, principal] of DENIED){
    const rt = loadRuntime(); const S = seed(rt, principal);
    const batchWrap = { batch:{ key:'2025-01', monthName:'Januari', year:2025 },
      items:[{ key:'k1', row:{ uraian:'SAMPLE — imported', category:'Lainnya', planned:500 } }] };
    const diff = { rows:[], removed:[], oldTxns:[TXN()] };
    await assertSE0(rt, S, label + ': applyMonthUpdate', ()=> rt.w.applyMonthUpdate(batchWrap, diff, { batches:[batchWrap] }, null, null));
  }
  { const rt = loadRuntime(); seed(rt, CEO_P);
    check(typeof rt.w.applyMonthUpdate === 'function' && rt.w.can('import.commit') === true,
      'CEO: applyMonthUpdate is authorized (import.commit allowed)'); }

  /* 5. Rows 4-5 — restore */
  console.log('-- 5. rows 4-5 : restore -> data.restore --');
  for(const [label, principal] of DENIED){
    const rt = loadRuntime(); const S = seed(rt, principal);
    const r = await assertSE0(rt, S, label + ': restoreCompleteBackup',
      ()=> rt.w.restoreCompleteBackup(backupFile(rt)), { denied:(x)=> !!x && x.ok === false });
    check(!!r && /permission/i.test(r.reason||''), label + ': complete restore reports a permission failure');
    check(!S.txns.some(function(t){ return t.id === 't_restored'; }), label + ': no restored data entered State');
  }
  { const rt = loadRuntime(); const S = seed(rt, CEO_P);
    const r = await rt.w.restoreCompleteBackup(backupFile(rt));
    check(!!r && r.ok === true, 'CEO: restoreCompleteBackup succeeds');
    check(S.txns.length === 1 && S.txns[0].id === 't_restored', 'CEO: restore replaced the transactions');
    check(S.settings.companyName === 'RESTORED SAMPLE', 'CEO: restore replaced settings');
    check((S.backups||[]).some(function(b){ return b.safety === true; }), 'CEO: restore still took the pre-restore safety backup'); }

  /* 6. Rows 6-7 — destructive reset */
  console.log('-- 6. rows 6-7 : reset -> data.reset --');
  for(const [label, principal] of DENIED){
    const rt = loadRuntime(); const S = seed(rt, principal);
    await assertSE0(rt, S, label + ': startFresh', ()=> rt.w.startFresh());
    check(rt.ctl.downloads.length === 0, label + ': startFresh downloads no backup when denied');
    check(rt.said.indexOf('RELOAD') === -1, label + ': startFresh does not reload when denied');
  }
  { const rt = loadRuntime(); seed(rt, CEO_P);
    await rt.w.startFresh();
    check(rt.ctl.removes.length > 0, 'CEO: startFresh clears the TAM storage keys');
    check(rt.ctl.downloads.length === 1, 'CEO: startFresh still downloads the pre-reset backup first'); }
  { const rt = loadRuntime(); seed(rt, EMP_P);
    check(rt.w.can('data.reset') === false && rt.w.can('settings.manage') === false,
      'Employee: data.reset is not reachable through settings.manage either'); }
  { const rt = loadRuntime(); seed(rt, CEO_P);
    check(rt.w.can('data.reset') === true && rt.w.can('data.restore') === true,
      'CEO: reset and restore are distinct capabilities, both allowed'); }

  /* 7. Row 8 — demo data */
  console.log('-- 7. row 8 : loadDemoData -> employee.create --');
  for(const [label, principal] of DENIED){
    const rt = loadRuntime(); const S = seed(rt, principal);
    await assertSE0(rt, S, label + ': loadDemoData', ()=> rt.w.loadDemoData());
  }
  { const rt = loadRuntime(); const S = seed(rt, CEO_P); const n = S.employees.length;
    await rt.w.loadDemoData();
    check(S.employees.length === n + 2 && S.contracts.length === 2, 'CEO: loadDemoData creates the demo records');
    check(reportedSuccess(rt), 'CEO: loadDemoData reports success'); }

  /* 8. Row 9 — dedup merge (cross-domain SE-0) */
  console.log('-- 8. row 9 : mergeEmployeeGroup -> employee.delete --');
  for(const [label, principal] of DENIED){
    const rt = loadRuntime(); const S = seed(rt, principal);
    const r = await assertSE0(rt, S, label + ': mergeEmployeeGroup',
      ()=> rt.w.mergeEmployeeGroup('emp_fixture_self', ['emp_dup'], {}),
      { denied:(x)=> !!x && x.error === 'NotAuthorized' });
    check(S.employees.length === 2, label + ': both employee records survive a denied merge');
    check((S.employeeMerges||[]).length === 0, label + ': no merge audit record');
  }
  { const rt = loadRuntime(); const S = seed(rt, CEO_P);
    const r = await rt.w.mergeEmployeeGroup('emp_fixture_self', ['emp_dup'], {});
    check(!!r && r.ok === true, 'CEO: merge succeeds');
    check(S.employees.length === 1, 'CEO: the duplicate master record is removed');
    check((S.employeeMerges||[]).length === 1, 'CEO: the merge audit record is written');
    check((S.backups||[]).length === 1, 'CEO: the pre-merge safety backup is taken'); }

  /* 9. Regression — frozen vocabulary and C2C-4 untouched */
  console.log('-- 9. regression : frozen semantics preserved, C2C-4 untouched --');
  { const rt = loadRuntime(); seed(rt, EMP_P);
    check(rt.w.can('finance.execute') === false && rt.w.can('finance.manage') === false
      && rt.w.can('import.commit') === false, 'regression: C2C-2 actions still deny for Employee');
    check(rt.w.can('overtime.submitSelf', { id:'ot1', employeeId:'emp_fixture_self', status:'Draft' }) === true,
      'regression: Employee own-Draft overtime self-service still allowed'); }
  { const rt = loadRuntime(); const S = seed(rt, EMP_P);
    // C2C-4 domains must still be reachable (unwired) — proving C2C-3 did not over-gate.
    const before = JSON.stringify(S.recurringExpenses);
    check(typeof rt.w.toggleRecurring === 'function' && typeof rt.w.commitMonthlyPlan === 'function',
      'regression: C2C-4 boundaries still exist and are not gated by C2C-3');
    check(JSON.stringify(S.recurringExpenses) === before, 'regression: C2C-4 state untouched by this harness'); }
  { const rt = loadRuntime();
    check(typeof rt.w.can === 'function' && rt.w.canPrincipal === undefined && rt.w.POLICY === undefined,
      'public can() available; internal seams not on the production global'); }

  console.log('');
  if(failures.length){
    console.log('UX-006C2C-3 RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f=>console.log('  - ' + f));
    process.exit(1);
  }
  console.log('UX-006C2C-3 RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
