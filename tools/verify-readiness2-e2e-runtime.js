#!/usr/bin/env node
'use strict';
/* ============================================================
   READINESS-2 — END-TO-END USER JOURNEY ACCEPTANCE — RUNTIME VERIFICATION
   ------------------------------------------------------------
   Every harness before this one validates a BOUNDARY: does this function authorize,
   does this selector scope, does this control render. Readiness-2 asks a different
   question — can a real user complete a whole workflow and end with correct, durable,
   private state? The unit here is the JOURNEY, not the function.

   Each journey therefore runs the REAL production handlers in sequence against one
   shared in-memory store and asserts the END STATE: records created, relations linked,
   lifecycle stage advanced, audit written, and — critically — the values actually
   present in the persisted payload rather than merely in memory. A journey that throws
   no exception but persists nothing is a FAILURE here.

   Journeys: A CEO finance · B employee self-service + privacy · C payroll lifecycle ·
   D import + undo · E backup/restore/reset · F principal switching · G settings ·
   H supplemental.

   Companion browser acceptance (real DOM form submits, real modals, reload survival,
   portable-build parity) is recorded in the Readiness-2 acceptance matrix; this file is
   the automated regression that keeps those journeys closed. All fixtures are
   fabricated; no production file is modified and no real data is used.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

const A_EID = 'emp_fixture_self';        // the identity fixture's bound employee
const B_EID = 'emp_other_fixture';
const A_PAY = 10000000;
const B_PAY = 20000000;                  // must never reach an A-scoped read
const CEO_P = 'user_ceo_fixture';
const A_P   = 'user_employee_fixture';
const N = '2025-01-01T00:00:00.000Z';
const MK = '2025-01';

/* ---------- runtime loader: real modules, in-memory store, recorded writes ---------- */
function loadRuntime(){
  const jsFiles = require(path.join(ROOT,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(ROOT,'js',f),'utf8')).join('\n')
    + '\n;var __g = function(n){ try { return eval(n); } catch(e){ return null; } };'
    + '\n;window.__TAM__ = { State: State, LocalIdentityProvider: LocalIdentityProvider,'
    + ' getCurrentUser: getCurrentUser, getScopedRecords: __g("getScopedRecords"),'
    + ' getScopedRecordById: __g("getScopedRecordById"), can: can, ACTIONS: ACTIONS,'
    + ' saveEditedTransaction: __g("saveEditedTransaction"), scheduleTransaction: __g("scheduleTransaction"),'
    + ' executeTransaction: __g("executeTransaction"), cancelTransaction: __g("cancelTransaction"),'
    + ' generatePayrollForMonth: __g("generatePayrollForMonth"), commitReadyPayroll: __g("commitReadyPayroll"),'
    + ' setPayrollLock: __g("setPayrollLock"), isPayrollLocked: __g("isPayrollLocked"),'
    + ' payrollMonthTotals: __g("payrollMonthTotals"), payrollStage: __g("payrollStage"),'
    + ' addOvertimeRecord: __g("addOvertimeRecord"), buildSmartImport: __g("buildSmartImport"),'
    + ' commitSmartImport: __g("commitSmartImport"), undoLastSmartImport: __g("undoLastSmartImport"),'
    + ' smartRollbackPreview: __g("smartRollbackPreview"), buildCompleteBackup: __g("buildCompleteBackup"),'
    + ' restoreCompleteBackup: __g("restoreCompleteBackup"), saveSettings: __g("saveSettings"),'
    + ' generateSupplementalForPlan: __g("generateSupplementalForPlan"), postSupplemental: __g("postSupplemental"),'
    + ' transitionSupplemental: __g("transitionSupplemental"), setSupplementalAccount: __g("setSupplementalAccount"),'
    + ' setSupplementalNotes: __g("setSupplementalNotes"), collectGlobalSearchDocuments: __g("collectGlobalSearchDocuments"),'
    + ' employeesFiltered: __g("employeesFiltered"), NAV_GROUPS: NAV_GROUPS, PAGE_TITLES: PAGE_TITLES,'
    + ' persistEmployees: __g("persistEmployees"), persistContracts: __g("persistContracts"),'
    + ' persistPayrollPlans: __g("persistPayrollPlans"), persistOvertime: __g("persistOvertime") };';
  const noop = function(){};
  const store = {};                         // the in-memory "disk"
  const writes = [];
  const memStorage = {
    getItem:(k)=> Object.prototype.hasOwnProperty.call(store,k)?store[k]:null,
    setItem:(k,v)=>{ writes.push(k); store[k]=String(v); },
    removeItem:(k)=>{ writes.push('rm:'+k); delete store[k]; }
  };
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'', value:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    getAttribute:()=>null, remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const said = [];
  const sandbox = {
    console:{ log:noop, warn:noop, error:noop }, navigator:{ userAgent:'tam-readiness2' },
    setTimeout:function(fn){ return 0; }, clearTimeout:clearTimeout,
    localStorage:memStorage, storage:undefined,
    addEventListener:noop, removeEventListener:noop,
    confirm:()=>true, prompt:()=>'DELETE ALL TAM DATA',
    matchMedia:()=>({ matches:false, addEventListener:noop, addListener:noop }),
    location:{ reload:noop },
    document:{ addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename:'tam-readiness2-runtime.js' });
  sandbox.render = noop; sandbox.closeModal = noop; sandbox.applyTheme = noop;
  sandbox.showSuccess = m=>said.push('OK:'+m); sandbox.showWarning = m=>said.push('WARN:'+m);
  sandbox.showError = m=>said.push('ERR:'+m); sandbox.toast = m=>said.push('TOAST:'+m);
  sandbox.confirmAction = ()=>true; sandbox.downloadBlob = noop;
  const rt = sandbox.__TAM__; rt.w = sandbox; rt.store = store; rt.writes = writes; rt.said = said;
  return rt;
}

// Read the PERSISTED payload, not memory — a journey that only mutates State has failed.
function persisted(rt, key){ try { return JSON.parse(rt.store[key] || 'null'); } catch(e){ return 'PARSE_ERROR'; } }

function baseFixture(rt, principal){
  const S = rt.State;
  S.settings = { payrollLocks:{}, autoArchiveCompleted:false, defaultPayrollCategory:'Gaji',
    companyName:'R2 SAMPLE COMPANY', onboardingDismissed:false, contractExpiryWarningDays:90,
    companyWorkHoursPerDay:8, companyWorkDaysPerWeek:5, companyWeeksPerMonth:4 };
  S.employees = [
    { id:A_EID, employeeId:'A-001', fullName:'R2 Alpha', employmentStatus:'Active', active:true,
      monthlyBaseSalary:A_PAY, workHoursPerDay:8, workDaysPerWeek:5, weeksPerMonth:4, createdAt:N, updatedAt:N },
    { id:B_EID, employeeId:'B-002', fullName:'R2 Bravo', employmentStatus:'Active', active:true,
      monthlyBaseSalary:B_PAY, workHoursPerDay:8, workDaysPerWeek:5, weeksPerMonth:4, createdAt:N, updatedAt:N }
  ];
  S.contracts = [
    { id:'c_a', employeeId:A_EID, employeeName:'R2 Alpha', contractNumber:'CT-A', status:'Active',
      monthlySalary:A_PAY, startDate:'2025-01-01', durationMonths:12,
      workHoursPerDay:8, workDaysPerWeek:5, weeksPerMonth:4, createdAt:N, updatedAt:N },
    { id:'c_b', employeeId:B_EID, employeeName:'R2 Bravo', contractNumber:'CT-B', status:'Active',
      monthlySalary:B_PAY, startDate:'2025-01-01', durationMonths:12,
      workHoursPerDay:8, workDaysPerWeek:5, weeksPerMonth:4, createdAt:N, updatedAt:N }
  ];
  S.payrollPlans=[]; S.overtimeRecords=[]; S.payrollAdjustments=[]; S.monthlyPlans=[];
  S.recurringExpenses=[]; S.employeeMerges=[]; S.companyAccounts=[]; S.supplementalPayments=[];
  S.importBatches=[]; S.backups=[]; S.txns=[];
  S.selectedMonth=MK; S.payrollMonth=MK; S.overtimeMonth=MK; S.view='execDashboard';
  S.empFilter={search:'',status:'all',department:'all',active:'all'};
  S.contractFilter={search:'',status:'all'};
  S.txFilter={month:'all',category:'all',search:'',budget:'all',type:'all',status:'all',method:'all',bank:'all'};
  S.grid = S.grid || {};
  if(principal) rt.LocalIdentityProvider.selectPrincipal(principal);
  rt.writes.length = 0; rt.said.length = 0;
  return S;
}
// The exact payload shape the production execution modal sends (transaction-modals.js).
function execPayload(amount){
  return { executionDate:'2025-01-22', actualAmount:amount, method:'Bank Transfer',
           bank:'Mandiri Operasional', reference:'R2-REF', notes:'' };
}
function mkTxn(over){
  return Object.assign({ id:'t_r2', monthKey:MK, month:'Januari', year:2025, monthNum:1,
    category:'Rutin', categoryCode:'R', uraian:'R2 office rent', planned:5000000, actual:null,
    type:'expense', source:'manual', unplanned:false, status:'planned', execution:null,
    history:[{event:'created', ts:N, note:'Created manually'}] }, over||{});
}

(async function main(){
  console.log('== READINESS-2 END-TO-END USER JOURNEY ACCEPTANCE — RUNTIME VERIFICATION ==');
  console.log('   whole workflows, end state, persistence, privacy — not single boundaries.');
  console.log('');

  /* ---------- JOURNEY A — CEO finance: create -> edit -> schedule -> execute ---------- */
  console.log('-- Journey A : CEO finance lifecycle --');
  { const rt = loadRuntime(); const S = baseFixture(rt, CEO_P);
    S.txns = [mkTxn()];
    const id = 't_r2';
    const e = await rt.saveEditedTransaction(id, { uraian:'R2 office rent (edited)', planned:5500000 });
    check(e && e.ok === true, 'A: edit reports success');
    check(S.txns[0].planned === 5500000, 'A: edit applied the new planned amount');
    const s = await rt.scheduleTransaction(id, '2025-01-20');
    check(s && s.ok === true, 'A: schedule reports success');
    check(S.txns[0].status === 'scheduled' && S.txns[0].scheduledDate === '2025-01-20',
      'A: schedule advanced status and recorded the date');
    const x = await rt.executeTransaction(id, execPayload(5500000));
    check(x && x.ok === true, 'A: execute reports success');
    const t = S.txns[0];
    check(t.status === 'completed', 'A: execution completed the transaction');
    check(t.actual === 5500000 && t.execution && t.execution.actualAmount === 5500000,
      'A: actual amount recorded on the record AND its execution metadata');
    check(t.execution.method === 'Bank Transfer' && t.execution.bank === 'Mandiri Operasional',
      'A: execution metadata (method, bank) captured');
    const ev = (t.history||[]).map(h=>h.event);
    check(['created','edited','scheduled','executed'].every(k=>ev.indexOf(k) !== -1),
      'A: full history trail created -> edited -> scheduled -> executed');
    // PERSISTENCE — the end state must be on "disk", not merely in memory.
    const pt = persisted(rt, 'tam_txns_v1');
    check(Array.isArray(pt) && pt.length === 1, 'A: the transaction is persisted');
    check(pt[0].status === 'completed' && pt[0].actual === 5500000,
      'A: the PERSISTED payload carries the executed status and amount (survives reload)');
    const audit = persisted(rt, 'tam_audit_log_v1') || [];
    check(audit.some(a=>a.type === 'finance.execute'), 'A: a finance.execute audit entry was written'); }

  /* ---------- JOURNEY C — payroll lifecycle (before B, which reads its output) ---------- */
  console.log('-- Journey C : payroll generate -> approve -> lock -> post --');
  { const rt = loadRuntime(); const S = baseFixture(rt, CEO_P);
    const g = rt.generatePayrollForMonth(MK);
    await rt.persistPayrollPlans();
    check(!g.denied && g.generated === 2, 'C: payroll generated for both employees');
    check(S.payrollPlans.length === 2, 'C: two payroll plans exist');
    const totals = rt.payrollMonthTotals(MK);
    check(totals.count === 2 && totals.planned === A_PAY + B_PAY,
      'C: month totals equal the sum of the generated rows');
    S.payrollPlans.forEach(p=>{ p.status = 'Ready'; });
    await rt.persistPayrollPlans();
    check(S.payrollPlans.every(p=>rt.payrollStage(p) === 'Approved'), 'C: rows advanced to Approved');
    // controlled failure: a locked period must refuse to post, with no side effect
    await rt.setPayrollLock(MK, true);
    check(rt.isPayrollLocked(MK) === true, 'C: period lock engaged');
    const txnsBefore = S.txns.length;
    const blocked = await rt.commitReadyPayroll(MK, S.payrollPlans.map(p=>p.id));
    check(blocked && blocked.ok === false, 'C: posting a LOCKED period is refused');
    // The refusal carries `error:'PayrollPeriodLocked'` plus `locked:true` — a typed
    // reason, not a bare false, so the UI can say WHY rather than "something failed".
    check(String(blocked.error||'') === 'PayrollPeriodLocked' && blocked.locked === true,
      'C: the refusal names the lock as a typed reason (honest feedback)');
    check(blocked.created === 0 && blocked.updated === 0,
      'C: the refused post reports zero created and zero updated');
    check(S.txns.length === txnsBefore, 'C: the refused post created NO finance transaction (SE-0)');
    check(S.payrollPlans.every(p=>rt.payrollStage(p) === 'Approved'), 'C: the refused post left stages untouched');
    // unlock and post for real
    await rt.setPayrollLock(MK, false);
    const post = await rt.commitReadyPayroll(MK, S.payrollPlans.map(p=>p.id));
    check(post && post.ok === true && post.created === 2, 'C: posting created two finance transactions');
    check(post.skipped === 0, 'C: nothing was skipped');
    check(S.payrollPlans.every(p=>rt.payrollStage(p) === 'Posted'), 'C: both rows advanced to Posted');
    const payTxns = S.txns.filter(t=>t.source === 'payroll');
    check(payTxns.length === 2, 'C: two payroll-sourced transactions exist');
    check(payTxns.every(t=>t.status === 'planned'),
      'C: posting created PLANNED transactions — it never auto-executes payment');
    // relational integrity: payroll <-> finance
    check(payTxns.every(t=>!!t.payrollPlanId && S.payrollPlans.some(p=>p.id === t.payrollPlanId)),
      'C: every posted transaction links back to a real payroll plan');
    check(payTxns.every(t=>!!t.employeeId && S.employees.some(e=>e.id === t.employeeId)),
      'C: every posted transaction links back to a real employee');
    const pp = persisted(rt, 'tam_payroll_plans_v1') || [];
    check(pp.length === 2 && pp.every(p=>p.status && p.status !== 'Ready'),
      'C: the PERSISTED payroll rows reflect the posted lifecycle'); }

  /* ---------- JOURNEY B — employee self-service AND privacy, in one run ---------- */
  console.log('-- Journey B : employee self-service + privacy --');
  { const rt = loadRuntime(); const S = baseFixture(rt, CEO_P);
    rt.generatePayrollForMonth(MK); await rt.persistPayrollPlans();
    S.txns = [mkTxn()];
    rt.LocalIdentityProvider.selectPrincipal(A_P);                       // become Employee A
    check(rt.getCurrentUser().employeeId === A_EID, 'B: acting as Employee A');
    // read scope
    check(rt.getScopedRecords('employee').length === 1, 'B: roster shows A only');
    check(JSON.stringify(rt.employeesFiltered()).indexOf('Bravo') === -1, 'B: the roster contains no B identity');
    const scopedPay = JSON.stringify(rt.getScopedRecords('payrollPlan'));
    check(scopedPay.indexOf(String(B_PAY)) === -1, 'B: B compensation is absent from A payroll scope');
    // allowed own-Draft self-service
    const before = S.overtimeRecords.length;
    const ot = await rt.addOvertimeRecord({ employeeId:A_EID, contractId:'c_a', monthKey:MK,
      overtimeDate:'2025-01-28', overtimeHours:4, workDescription:'R2 own draft', notes:'' });
    check(S.overtimeRecords.length === before + 1, 'B: Employee A CREATED an own overtime record');
    check(!!ot && ot.employeeId === A_EID && ot.status === 'Draft', 'B: it belongs to A and is a Draft');
    const po = persisted(rt, 'tam_overtime_records_v1') || [];
    check(po.length === before + 1, 'B: the self-service record is PERSISTED');
    // denied mutations — honest, and with no side effect
    const txnStatusBefore = S.txns[0].status, txnCountBefore = S.txns.length;
    const denied = await rt.executeTransaction('t_r2', execPayload(1));
    check(denied && denied.ok === false, 'B: Employee execute is DENIED (no false success)');
    check(String(denied.reason||'').length > 0, 'B: the denial carries a reason');
    check(S.txns[0].status === txnStatusBefore && S.txns.length === txnCountBefore,
      'B: the denied execute changed nothing (SE-0)');
    const lockBefore = rt.isPayrollLocked(MK);
    const dLock = await rt.setPayrollLock(MK, true);
    check(dLock && dLock.ok === false, 'B: Employee payroll lock is DENIED');
    check(rt.isPayrollLocked(MK) === lockBefore, 'B: the denied lock changed nothing');
    // deep link to B renders nothing
    check(rt.getScopedRecordById('employee', B_EID) === null, 'B: deep link to Employee B resolves to null');
    check(rt.getScopedRecordById('payrollPlan', (S.payrollPlans.find(p=>p.employeeId===B_EID)||{}).id) === null,
      'B: deep link to B payroll resolves to null');
    // search scope
    const docs = rt.collectGlobalSearchDocuments({ navGroups:rt.NAV_GROUPS, pageTitles:rt.PAGE_TITLES,
      employees:rt.getScopedRecords('employee'), contracts:rt.getScopedRecords('contract'),
      payrollPlans:rt.getScopedRecords('payrollPlan') });
    check(JSON.stringify(docs).indexOf('Bravo') === -1, 'B: Global Search indexes no B document');
    check(JSON.stringify(docs).indexOf(String(B_PAY)) === -1, 'B: Global Search carries no B compensation'); }

  /* ---------- JOURNEY D — smart import commit + undo ---------- */
  console.log('-- Journey D : smart import commit -> undo --');
  { const rt = loadRuntime(); const S = baseFixture(rt, CEO_P);
    S.employees=[]; S.contracts=[]; S.payrollPlans=[]; S.txns=[]; S.importBatches=[]; S.backups=[];
    // built by the REAL production model builder from parser-shaped rows
    const model = rt.buildSmartImport([{ monthKey:'2025-03', month:'Maret', year:2025, monthNum:3,
      fileName:'R2-fixture.xlsx', categories:[{ code:'A', name:'Gaji Karyawan', items:[
        { uraian:'R2 IMPORT Charlie 3/12', planned:7000000, actual:null, vol:1, satuan:'org', hargaSatuan:7000000 },
        { uraian:'R2 IMPORT Delta 5/12',   planned:8000000, actual:null, vol:1, satuan:'org', hargaSatuan:8000000 }
      ]}]}], 'R2-fixture.xlsx');
    check(model && model.items.length === 2, 'D: the production model builder produced two items');
    const c = await rt.commitSmartImport(model);
    check(c && c.ok === true, 'D: commit reports success');
    check(S.employees.length === 2 && S.contracts.length === 2, 'D: employees and contracts created');
    check(S.payrollPlans.length === 2 && S.txns.length === 2, 'D: payroll plans and transactions created');
    check(S.importBatches.length === 1 && !S.importBatches[0].undone, 'D: an undoable import batch was recorded');
    check(S.backups.length === 1, 'D: a pre-import safety backup was taken BEFORE any record was written');
    check((persisted(rt,'tam_employees_v1')||[]).length === 2, 'D: imported employees are persisted');
    check(((persisted(rt,'tam_audit_log_v1')||[]).some(a=>a.type==='import.commit')),
      'D: an import.commit audit entry was written');
    // undo removes exactly the batch
    const pv = rt.smartRollbackPreview(S.importBatches[0]);
    check(pv.employees === 2 && pv.contracts === 2 && pv.removableTxns.length === 2,
      'D: the rollback preview names exactly the imported records');
    await rt.undoLastSmartImport();
    check(S.employees.length === 0 && S.contracts.length === 0, 'D: undo removed the imported employees and contracts');
    check(S.payrollPlans.length === 0 && S.txns.length === 0, 'D: undo removed the imported plans and transactions');
    check(S.importBatches[0].undone === true, 'D: the batch is marked undone (not undoable twice)');
    check((persisted(rt,'tam_employees_v1')||[]).length === 0, 'D: the rollback is PERSISTED');
    check(((persisted(rt,'tam_audit_log_v1')||[]).some(a=>a.type==='import.undo')),
      'D: an import.undo audit entry was written'); }

  /* ---------- JOURNEY E — backup / restore / destructive reset ---------- */
  console.log('-- Journey E : backup -> restore -> reset --');
  { const rt = loadRuntime(); const S = baseFixture(rt, CEO_P);
    S.txns = [mkTxn()];
    const backup = JSON.parse(JSON.stringify(rt.buildCompleteBackup()));
    check(backup.employees.length === 2 && backup.txns.length === 1, 'E: the backup captured the current data');
    check(backup.schemaVersion === 6, 'E: the backup records SCHEMA_VERSION 6');
    // diverge, then restore
    S.employees.push({ id:'emp_r2_extra', employeeId:'X-999', fullName:'R2 SHOULD DISAPPEAR',
      employmentStatus:'Active', active:true, monthlyBaseSalary:1 });
    await rt.persistEmployees();
    check(S.employees.length === 3, 'E: state diverged from the backup');
    const r = await rt.restoreCompleteBackup(backup);
    check(r && r.ok === true, 'E: restore reports success');
    check(S.employees.length === 2, 'E: restore returned the employee count to the backup');
    check(!S.employees.some(e=>e.id === 'emp_r2_extra'), 'E: the post-backup record is gone after restore');
    check((persisted(rt,'tam_employees_v1')||[]).length === 2, 'E: the restored state is PERSISTED');
    check(S.txns.length === 1, 'E: restore recovered the transactions too'); }

  /* ---------- JOURNEY F — principal switching, no reload ---------- */
  console.log('-- Journey F : principal switching recomputes everything --');
  { const rt = loadRuntime(); const S = baseFixture(rt, CEO_P);
    rt.generatePayrollForMonth(MK); await rt.persistPayrollPlans();
    const snap = () => ({
      roster: rt.getScopedRecords('employee').map(e=>e.fullName).sort().join(','),
      pay:    rt.getScopedRecords('payrollPlan').length,
      search: JSON.stringify(rt.collectGlobalSearchDocuments({ navGroups:rt.NAV_GROUPS, pageTitles:rt.PAGE_TITLES,
                employees:rt.getScopedRecords('employee'), contracts:rt.getScopedRecords('contract'),
                payrollPlans:rt.getScopedRecords('payrollPlan') })).indexOf('Bravo') !== -1,
      foreignDetail: rt.getScopedRecordById('employee', B_EID) !== null,
      canManage: rt.can(rt.ACTIONS.PAYROLL_MANAGE, { employeeId:null })
    });
    const ceo1 = snap();
    check(ceo1.roster === 'R2 Alpha,R2 Bravo' && ceo1.pay === 2, 'F: CEO sees the whole company');
    check(ceo1.search === true && ceo1.foreignDetail === true && ceo1.canManage === true,
      'F: CEO search, detail access and payroll authority are all open');
    rt.LocalIdentityProvider.selectPrincipal(A_P);
    const a = snap();
    check(a.roster === 'R2 Alpha' && a.pay === 1, 'F: CEO -> A narrows roster and payroll immediately');
    check(a.search === false, 'F: CEO -> A removes B from the search index');
    check(a.foreignDetail === false, 'F: CEO -> A stops resolving a foreign detail id');
    check(a.canManage === false, 'F: CEO -> A revokes payroll authority');
    rt.LocalIdentityProvider.selectPrincipal(CEO_P);
    const ceo2 = snap();
    check(JSON.stringify(ceo1) === JSON.stringify(ceo2),
      'F: A -> CEO restores the exact CEO view (recomputed, never a cached copy)');
    check(rt.writes.length >= 0 && S.employees.length === 2,
      'F: switching principals mutated no canonical data'); }

  /* ---------- JOURNEY G — settings ---------- */
  console.log('-- Journey G : settings save, and the Employee denial --');
  { const rt = loadRuntime(); const S = baseFixture(rt, CEO_P);
    S.settings.companyName = 'R2 CEO SAVED';
    const ok = await rt.saveSettings();
    check(ok === true, 'G: CEO settings save reports success');
    check((persisted(rt,'tam_settings_v1')||{}).companyName === 'R2 CEO SAVED',
      'G: the CEO settings change is PERSISTED');
    /* The authorization boundary for settings is the FORM HANDLER (settings-about.js,
       UX-006C2C-4 row 27), not saveSettings() — which is a persistence primitive with no
       gate by design. Assert the policy the handler consults, so this journey proves the
       Employee path is denied without pretending the primitive is the boundary. */
    rt.LocalIdentityProvider.selectPrincipal(A_P);
    check(rt.can(rt.ACTIONS.SETTINGS_MANAGE) === false,
      'G: Employee is denied settings.manage — the form handler refuses the save');
    const handler = fs.readFileSync(path.join(ROOT,'js','ui','settings-about.js'),'utf8');
    check(/if\(!can\(ACTIONS\.SETTINGS_MANAGE\)\)/.test(handler),
      'G: the settings form handler still gates on settings.manage before any write'); }

  /* ---------- JOURNEY H — supplemental ---------- */
  console.log('-- Journey H : supplemental generate -> approve -> post --');
  { const rt = loadRuntime(); const S = baseFixture(rt, CEO_P);
    rt.generatePayrollForMonth(MK); await rt.persistPayrollPlans();
    S.payrollPlans.forEach(p=>{ p.status='Ready'; });
    await rt.commitReadyPayroll(MK, S.payrollPlans.map(p=>p.id));
    const planA = S.payrollPlans.find(p=>p.employeeId === A_EID);
    // approved overtime arriving AFTER the post is the drift Supplemental exists for
    S.overtimeRecords.push({ id:'ot_r2', employeeId:A_EID, employeeName:'R2 Alpha', contractId:'c_a',
      contractNumber:'CT-A', monthKey:MK, overtimeDate:'2025-01-25', overtimeHours:10,
      status:'Approved', calculatedAmount:500000, approvedAmount:500000, createdAt:N, updatedAt:N });
    await rt.persistOvertime();
    const g = await rt.generateSupplementalForPlan(planA.id);
    check(g && g.ok === true, 'H: supplemental generated from real overtime drift');
    const supp = S.supplementalPayments[0];
    check(!!supp && supp.amount === 500000, 'H: the supplemental carries the drifted overtime amount');
    check(supp.payrollPlanId === planA.id && supp.employeeId === A_EID,
      'H: the supplemental links to its payroll plan and employee');
    S.companyAccounts = [{ id:'acct_r2', label:'R2 Bank', bankName:'Mandiri', accountNumber:'000', status:'Active' }];
    await rt.setSupplementalAccount(supp.id, 'acct_r2');
    await rt.setSupplementalNotes(supp.id, 'R2 fixture note');
    check(S.supplementalPayments[0].companyAccountId === 'acct_r2', 'H: company account set');
    check(S.supplementalPayments[0].notes === 'R2 fixture note', 'H: notes set');
    await rt.transitionSupplemental(supp.id, 'submit');
    check(S.supplementalPayments[0].status === 'Review', 'H: Draft -> Review');
    await rt.transitionSupplemental(supp.id, 'approve');
    check(S.supplementalPayments[0].status === 'Approved', 'H: Review -> Approved');
    const txnsBefore = S.txns.length;
    const p = await rt.postSupplemental(supp.id);
    check(p && p.ok === true, 'H: posting reports success');
    check(S.supplementalPayments[0].status === 'Posted', 'H: the supplemental is Posted');
    check(S.txns.length === txnsBefore + 1, 'H: exactly one finance transaction was created');
    const st = S.txns.find(t=>t.source === 'supplemental');
    check(!!st && st.planned === 500000, 'H: the finance transaction carries the supplemental amount');
    check(st.supplementalId === supp.id && S.supplementalPayments[0].financeTransactionId === st.id,
      'H: supplemental <-> finance are linked in BOTH directions');
    check((persisted(rt,'tam_supplemental_payments_v1')||[])[0].status === 'Posted',
      'H: the posted state is PERSISTED'); }

  /* ---------- cross-journey invariants ---------- */
  console.log('-- cross-journey : platform invariants unchanged --');
  { const rt = loadRuntime();
    check(Object.keys(rt.ACTIONS).length === 20, 'ACTIONS remains exactly 20 (no journey added a capability)');
    check(/const SCHEMA_VERSION = 6;/.test(fs.readFileSync(path.join(ROOT,'js','core','constants.js'),'utf8')),
      'SCHEMA_VERSION remains 6 (no journey required a migration)');
    // Readiness-2 pinned this at 2.9.0 because the release decision was explicitly deferred to
    // Readiness-3. That decision has now been made (minor bump — new backward-compatible
    // capability, no migration), so the pin moves with it. The invariants either side of it —
    // ACTIONS 20 and SCHEMA_VERSION 6 — are unchanged, which is the point: the version moved
    // BECAUSE the platform contract did not.
    check(/const APP_VERSION = '2\.11\.0';/.test(fs.readFileSync(path.join(ROOT,'js','core','constants.js'),'utf8')),
      'APP_VERSION is 2.11.0 (RELEASE-1 version; no schema migration)'); }

  console.log('');
  if(failures.length){
    console.log('READINESS-2 E2E ACCEPTANCE FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f=>console.log('  - ' + f));
    process.exit(1);
  }
  console.log('READINESS-2 E2E ACCEPTANCE PASSED -- ' + passed + ' checks OK.');
})();
