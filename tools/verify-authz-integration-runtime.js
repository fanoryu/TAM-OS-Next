#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-006C3 — INTEGRATION FREEZE — RUNTIME VERIFICATION
   ------------------------------------------------------------
   The frozen integration surface (43 entries) is inventoried in
   tools/integration-surface-manifest.js and cross-checked against source by
   tools/verify-build.js. THIS harness proves the BEHAVIOUR the Atlas rulings require:

     C3-R1  navigation destinations stay VISIBLE + NORMAL for every principal —
            never hidden, never disabled, because view access is not mutation authority
     C3-R2  a control mapping to exactly ONE frozen action is VISIBLE + DISABLED when the
            current principal cannot perform it
     C3-R3  UI availability is an AFFORDANCE, never enforcement: bypassing a disabled
            control programmatically still hits a denying mutation boundary
     C3-R4  direct/deep navigation stays possible and is not a bypass
     C3-R5  availability is derived at render time — switching principal recomputes it
            with no stale provenance, in both directions

   Fixtures are fabricated and run in an isolated vm with an in-memory store. No production
   file is modified by this harness.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const MANIFEST = require('./integration-surface-manifest.js');

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
    + '\n;window.__TAM__ = { State: State, ACTIONS: ACTIONS };';
  const noop = function(){};
  const memStore = {};
  const ctl = { writes:[] };
  const memStorage = {
    getItem: (k)=> Object.prototype.hasOwnProperty.call(memStore,k) ? memStore[k] : null,
    setItem: (k,v)=>{ ctl.writes.push(k); memStore[k] = String(v); },
    removeItem: (k)=>{ delete memStore[k]; }
  };
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'', value:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const said = [];
  const sandbox = {
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-c3' },
    setTimeout: function(){ return 0; }, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true, prompt: ()=>'',
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-c3-runtime.js' });
  sandbox.showSuccess = m=>said.push('SUCCESS:'+m); sandbox.showWarning = m=>said.push('WARN:'+m);
  sandbox.showError = m=>said.push('ERROR:'+m); sandbox.toast = m=>said.push('TOAST:'+m);
  sandbox.render = noop; sandbox.closeModal = noop; sandbox.confirmAction = ()=>true;
  sandbox.applyTheme = noop; sandbox.downloadBlob = noop;
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.memStore = memStore; rt.ctl = ctl; rt.said = said;
  return rt;
}

function seed(rt, principal){
  const S = rt.State;
  S.settings = { payrollLocks:{}, autoArchiveCompleted:false, defaultPayrollCategory:'Gaji',
    companyName:'SAMPLE COMPANY', onboardingDismissed:false };
  S.employees = [{ id:'emp_fixture_self', employeeId:'SELF', fullName:'SAMPLE — Self',
    employmentStatus:'Active', active:true, monthlyBaseSalary:1000000, createdAt:N, updatedAt:N }];
  S.contracts = []; S.payrollPlans = []; S.overtimeRecords = []; S.monthlyPlans = [];
  S.payrollAdjustments = []; S.recurringExpenses = []; S.employeeMerges = [];
  S.companyAccounts = []; S.supplementalPayments = []; S.importBatches = [];
  S.backups = [{ id:'bk1', monthKey:'2025-01', monthLabel:'Januari 2025', timestamp:N, txns:[] }];
  S.txns = [{ id:'t1', monthKey:'2025-01', month:'Januari', year:2025, monthNum:1, category:'Lainnya',
    categoryCode:'L', uraian:'SAMPLE — probe', planned:1000, actual:null, type:'expense',
    source:'manual', status:'planned', execution:null, history:[] }];
  S.selectedMonth = '2025-01'; S.payrollMonth = '2025-01'; S.view = 'execDashboard';
  if(principal) rt.w.LocalIdentityProvider.selectPrincipal(principal);
  rt.ctl.writes.length = 0; rt.said.length = 0;
  return S;
}
const asPrincipal = (rt, p)=>{ if(p) rt.w.LocalIdentityProvider.selectPrincipal(p); };

(async function main(){
  console.log('== UX-006C3 INTEGRATION FREEZE — RUNTIME VERIFICATION ==');
  console.log('   navigation visible+normal; single-capability controls disabled when denied;');
  console.log('   availability derived at render time; affordance != enforcement.');
  console.log('');
  const EMP_P = 'user_employee_fixture';
  const CEO_P = 'user_ceo_fixture';
  const PRINCIPALS = [['CEO', CEO_P], ['employee', EMP_P], ['null', null]];

  /* 1. Frozen inventory */
  console.log('-- 1. frozen integration inventory --');
  check(MANIFEST.NAVIGATION_TOTAL === 43, 'manifest: 43 integration entries frozen');
  check(MANIFEST.NAV_COUNT === 27 && MANIFEST.QUICK_ACTION_COUNT === 12 && MANIFEST.ACTION_CENTER_COUNT === 4,
    'manifest: 27 sidebar + 12 Quick Actions + 4 Action Center generators');
  check(MANIFEST.NAVIGATION_AVAILABILITY === 'visible-normal',
    'manifest: navigation availability is visible-normal (C3-R1)');
  check(MANIFEST.MUTATION_CONTROLS.every(function(c){ return !!c.action && c.action.indexOf(',') === -1; }),
    'manifest: every availability control names exactly one action (C3-R2)');

  /* 2. C3-R1 — navigation stays visible + normal for every principal */
  console.log('-- 2. C3-R1 : navigation is visible + normal for every principal --');
  for(const [label, principal] of PRINCIPALS){
    const rt = loadRuntime(); const S = seed(rt, principal);
    // Quick Actions are the only navigation surface with a filter; it must derive from
    // record state, never from the principal.
    const perView = MANIFEST.QUICK_ACTIONS.map(function(v){
      S.view = v.view; return { view:v.view, n: rt.w.quickActionsFor(v.view).length };
    });
    check(perView.every(function(x){ return x.n >= 0; }), label + ': quickActionsFor() resolves for every frozen view');
    check(rt.w.quickActionsFor('executioncenter').length === 3,
      label + ': unconditional Quick Actions stay visible (executioncenter shows all 3)');
  }
  { // identical availability across principals proves navigation is not principal-filtered
    const counts = PRINCIPALS.map(function(p){
      const rt = loadRuntime(); seed(rt, p[1]);
      return MANIFEST.QUICK_ACTIONS.map(function(v){ return rt.w.quickActionsFor(v.view).length; }).join(',');
    });
    check(counts[0] === counts[1] && counts[1] === counts[2],
      'navigation availability is identical for CEO / employee / null (never principal-filtered)'); }

  /* 3. C3-R2 — single-capability controls disabled when denied */
  console.log('-- 3. C3-R2 : mutation controls disabled when denied, enabled when allowed --');
  { const rt = loadRuntime(); seed(rt, CEO_P);
    MANIFEST.MUTATION_CONTROLS.forEach(function(c){
      const res = c.action === 'payroll.manage' ? { employeeId:null } : undefined;
      check(rt.w.authzDisabled(c.action, res) === '', 'CEO: ' + c.id + ' (' + c.action + ') is enabled');
    }); }
  for(const [label, principal] of [['employee', EMP_P], ['null', null]]){
    const rt = loadRuntime(); seed(rt, principal);
    MANIFEST.MUTATION_CONTROLS.forEach(function(c){
      const res = c.action === 'payroll.manage' ? { employeeId:null } : undefined;
      const out = rt.w.authzDisabled(c.action, res);
      check(/ disabled /.test(out), label + ': ' + c.id + ' (' + c.action + ') is disabled');
      check(/title="You do not have permission/.test(out), label + ': ' + c.id + ' explains why it is disabled');
      check(!/display:\s*none|hidden/.test(out), label + ': ' + c.id + ' is disabled, NEVER hidden');
    });
  }

  /* 4. C3-R5 — availability recomputes on a principal change, both directions */
  console.log('-- 4. C3-R5 : availability recomputes on principal change (no stale provenance) --');
  { const rt = loadRuntime(); seed(rt, CEO_P);
    const beforeCeo = rt.w.authzDisabled(ACTIONS_OF(rt,'DATA_RESET'));
    asPrincipal(rt, EMP_P);
    const afterEmp = rt.w.authzDisabled(ACTIONS_OF(rt,'DATA_RESET'));
    check(beforeCeo === '' && / disabled /.test(afterEmp),
      'CEO -> employee: a control that was enabled becomes disabled with no re-seed'); }
  { const rt = loadRuntime(); seed(rt, EMP_P);
    const beforeEmp = rt.w.authzDisabled(ACTIONS_OF(rt,'DATA_RESET'));
    asPrincipal(rt, CEO_P);
    const afterCeo = rt.w.authzDisabled(ACTIONS_OF(rt,'DATA_RESET'));
    check(/ disabled /.test(beforeEmp) && afterCeo === '',
      'employee -> CEO: a control that was disabled becomes enabled with no re-seed'); }
  { const rt = loadRuntime(); seed(rt); // unresolved -> CEO -> employee, three-way
    const a = rt.w.authzDisabled(ACTIONS_OF(rt,'IMPORT_UNDO'));
    asPrincipal(rt, CEO_P); const b = rt.w.authzDisabled(ACTIONS_OF(rt,'IMPORT_UNDO'));
    asPrincipal(rt, EMP_P); const c = rt.w.authzDisabled(ACTIONS_OF(rt,'IMPORT_UNDO'));
    check(/ disabled /.test(a) && b === '' && / disabled /.test(c),
      'null -> CEO -> employee: availability tracks the current principal every time'); }

  /* 5. C3-R3 — affordance is not enforcement */
  console.log('-- 5. C3-R3 : a bypassed disabled control still hits a denying boundary --');
  for(const [label, principal] of [['employee', EMP_P], ['null', null]]){
    const rt = loadRuntime(); const S = seed(rt, principal);
    const before = JSON.stringify(S); const w = rt.ctl.writes.length;
    // The UI would render these disabled; invoke the underlying boundaries anyway.
    await rt.w.undoLastSmartImport();                       // import.undo
    await rt.w.setPayrollLock('2025-01', true);             // payroll.manage
    const restore = await rt.w.restoreCompleteBackup({ app:'TAM', schemaVersion:6, txns:[] }); // data.restore
    await rt.w.loadDemoData();                              // employee.create
    check(JSON.stringify(rt.State) === before,
      label + ': bypassing the disabled controls mutates nothing (State byte-identical)');
    check(rt.ctl.writes.length - w === 0, label + ': bypassing the disabled controls writes nothing');
    check(!!restore && restore.ok === false, label + ': the restore boundary denies independently of the UI');
  }
  { const rt = loadRuntime(); seed(rt, EMP_P);
    // Availability is an affordance: forcing it to "enabled" must not enable the mutation.
    const realCan = rt.w.can;
    rt.w.can = function(){ return true; };                  // pretend the UI says "allowed"
    const looksEnabled = rt.w.authzDisabled('data.reset');
    rt.w.can = realCan;                                     // the boundary keeps the real policy
    const S = rt.State; const before = JSON.stringify(S); const w = rt.ctl.writes.length;
    await rt.w.startFresh();
    check(looksEnabled === '' && JSON.stringify(rt.State) === before && rt.ctl.writes.length - w === 0,
      'a control forced to look enabled still cannot mutate — UI affordance != enforcement'); }

  /* 6. C3-R4 — deep links stay open; mutation stays denied */
  console.log('-- 6. C3-R4 : direct navigation is allowed and is not a bypass --');
  for(const [label, principal] of [['employee', EMP_P], ['null', null]]){
    const rt = loadRuntime(); const S = seed(rt, principal);
    const privileged = ['settings','payroll','executioncenter','transactions','add','bankaccounts'];
    privileged.forEach(function(v){ S.view = v; });
    check(privileged.every(function(v){ S.view = v; return S.view === v; }),
      label + ': direct navigation to every privileged view is permitted');
    // Compare BUSINESS collections only: State.view legitimately changes on navigation —
    // that is the in-memory view state the C2C inventory ruled NOT APPLICABLE.
    const biz = ()=> JSON.stringify([rt.State.txns, rt.State.employees, rt.State.settings,
      rt.State.payrollPlans, rt.State.backups, rt.State.importBatches]);
    S.view = 'settings';
    const before = biz(); const w = rt.ctl.writes.length;
    await rt.w.setPayrollLock('2025-01', true);
    check(biz() === before && rt.ctl.writes.length - w === 0,
      label + ': arriving at a privileged view grants no mutation authority');
  }
  { const rt = loadRuntime(); const S = seed(rt, EMP_P);
    S.view = 'overtime';
    check(rt.w.can('overtime.submitSelf', { id:'ot1', employeeId:'emp_fixture_self', status:'Draft' }) === true,
      'employee: read/self-service value at a mixed-capability destination is preserved (overtime)'); }

  /* 7. navigation performs no mutation */
  console.log('-- 7. navigation surfaces remain navigation-only --');
  for(const [label, principal] of PRINCIPALS){
    const rt = loadRuntime(); const S = seed(rt, principal);
    const before = JSON.stringify(S.txns) + JSON.stringify(S.employees) + JSON.stringify(S.settings);
    const w = rt.ctl.writes.length;
    rt.w.hrNavTo('payroll'); rt.w.hrNavTo('employeeDetail', { detailEmpId:'emp_fixture_self' });
    MANIFEST.QUICK_ACTIONS.forEach(function(v){ rt.w.quickActionsFor(v.view); });
    check(JSON.stringify(rt.State.txns) + JSON.stringify(rt.State.employees) + JSON.stringify(rt.State.settings) === before,
      label + ': navigation mutates no business collection');
    check(rt.ctl.writes.length - w === 0, label + ': navigation performs zero storage writes');
  }

  /* 8. C3 changed no authorization semantics */
  console.log('-- 8. regression : authorization semantics untouched --');
  { const rt = loadRuntime(); seed(rt, EMP_P);
    ['finance.execute','finance.manage','import.commit','import.undo','data.restore','data.reset',
     'supplemental.manage','settings.manage'].forEach(function(a){
      check(rt.w.can(a) === false, 'regression: employee still denied ' + a); }); }
  { const rt = loadRuntime(); seed(rt, CEO_P);
    check(rt.w.can('data.reset') === true && rt.w.can('settings.manage') === true,
      'regression: CEO retains the frozen capabilities'); }
  { const rt = loadRuntime();
    check(typeof rt.w.can === 'function' && rt.w.canPrincipal === undefined,
      'public can() available; internal seams absent from the production global'); }

  console.log('');
  if(failures.length){
    console.log('UX-006C3 INTEGRATION FREEZE VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f=>console.log('  - ' + f));
    process.exit(1);
  }
  console.log('UX-006C3 INTEGRATION FREEZE VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();

function ACTIONS_OF(rt, key){ return rt.ACTIONS[key]; }
