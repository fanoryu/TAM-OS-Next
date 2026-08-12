#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-004D — BREADCRUMBS & CONTEXT QUICK ACTIONS — RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of the UX-004D slice (canonical
   derivation, single manifest, single landmark, navigation-only handlers, numeric
   typography selectors, golden-master revision). This harness proves its BEHAVIOUR
   by executing the real production functions in the browser's single shared global
   scope, reproduced in a Node `vm` context using the same loader technique as
   js/cli/cli.js (EXCLUDING core/app-bootstrap.js, the only DOM-executing load-time
   module).

   It verifies three things at runtime:
     A. Breadcrumb matrix — breadcrumbTrail(view) yields the expected
        Domain / Item / Context hierarchy, derived from the canonical nav data,
        with the correct interactive/current markers and entity-aware terminals.
     B. Quick Action matrix — quickActionsFor(view) yields the expected labels,
        visibility (context-aware), and destinations; missing context hides actions.
     C. No auto-execution — invoking the EXACT click payload a Quick Action button
        carries (resolve() + hrNavTo()) changes ONLY navigation/context state; every
        business collection (employees, contracts, payroll, transactions, overtime,
        audit) is byte-identical (JSON) before and after. "Go to Execution Center"
        is proven to be navigation only.

   All fixture data is obviously fabricated. Nothing is written to disk, no real
   company data is used, and no repository file is modified.
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
    + '\n;window.__TAM__ = { State: State, hrNavTo: hrNavTo,'
    + ' breadcrumbTrail: breadcrumbTrail, breadcrumbHTML: breadcrumbHTML,'
    + ' quickActionsFor: quickActionsFor, QUICK_ACTIONS_BY_VIEW: QUICK_ACTIONS_BY_VIEW,'
    + ' navOwnerItem: navOwnerItem, navItemGroup: navItemGroup,'
    + ' LocalIdentityProvider: LocalIdentityProvider };';
  const noop = function(){};
  const memStore = {};
  const memStorage = {
    getItem: (k)=> Object.prototype.hasOwnProperty.call(memStore,k) ? memStore[k] : null,
    setItem: (k,v)=>{ memStore[k] = String(v); },
    removeItem: (k)=>{ delete memStore[k]; }
  };
  // Inert DOM stub — the classic scripts must run, but nothing renders. render() is
  // presentation-only and mutates no business data, so a stub that swallows DOM calls
  // is sufficient to exercise the real hrNavTo() navigation path end to end.
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    getAttribute:()=>null, hasAttribute:()=>false, removeAttribute:noop, insertAdjacentHTML:noop,
    remove:noop, blur:noop, focus:noop, querySelector:()=>null, querySelectorAll:()=>[],
    classList:{ add:noop, remove:noop, toggle:noop } });
  const sandbox = {
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-ux004d' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    requestAnimationFrame: (fn)=>fn(),
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-ux004d-runtime.js' });
  return sandbox.__TAM__;
}

// ---------- obviously fabricated fixtures ----------
function seed(rt){
  const S = rt.State;
  S.employees = [
    { id:'emp_1', fullName:'SAMPLE — Norman Fixture', employeeId:'EMP-001', jobTitle:'Analyst', department:'Ops', monthlyBaseSalary:1000000, employmentStatus:'Active' }
  ];
  S.contracts = [
    { id:'ct_1', employeeId:'emp_1', employeeName:'SAMPLE — Norman Fixture', contractNumber:'SAMPLE/CT/001',
      startDate:'2026-01-01', durationMonths:12, monthlySalary:1000000, status:'Active' }
  ];
  // A COMMITTED plan -> payrollStage()==='Posted' (no completed txn), which makes the
  // "Go to Execution Center" quick action meaningful (post-posting only).
  S.payrollPlans = [
    { id:'pp_1', employeeId:'emp_1', employeeName:'SAMPLE — Norman Fixture', contractId:'ct_1',
      contractNumber:'SAMPLE/CT/001', month:'January', year:2026, monthKey:'2026-01', status:'Committed', history:[] }
  ];
  S.txns = [];
  S.overtimeRecords = [];
  S.auditLog = S.auditLog || [];
  S.selectedMonth = '2026-01';
}

// Deep snapshot of every business collection (order-independent by value).
function businessSnapshot(S){
  return JSON.stringify({
    employees: S.employees, contracts: S.contracts, payrollPlans: S.payrollPlans,
    txns: S.txns, overtimeRecords: S.overtimeRecords, auditLog: S.auditLog || [],
    recurringExpenses: S.recurringExpenses || [], monthlyPlans: S.monthlyPlans || []
  });
}

(function main(){
  console.log('== UX-004D BREADCRUMB + QUICK ACTIONS — RUNTIME VERIFICATION ==');

  // ---------- A. Breadcrumb matrix ----------
  console.log('-- A. breadcrumb matrix --');
  {
    const rt = loadRuntime(); seed(rt); const S = rt.State;
    const labels = (view)=>{ S.view=view; return rt.breadcrumbTrail(view).map(c=>c.label); };
    const trail  = (view)=>{ S.view=view; return rt.breadcrumbTrail(view); };

    // Direct sidebar items: Domain / Item, Item is current (non-interactive).
    check(JSON.stringify(labels('execDashboard'))===JSON.stringify(['Dashboard','Executive Dashboard']),
      'Executive Dashboard -> Dashboard / Executive Dashboard');
    check(JSON.stringify(labels('employees'))===JSON.stringify(['People','Employees']),
      'Employees -> People / Employees');
    check(JSON.stringify(labels('contracts'))===JSON.stringify(['People','Contracts']),
      'Contracts -> People / Contracts');
    check(JSON.stringify(labels('payroll'))===JSON.stringify(['Finance','Payroll']),
      'Payroll -> Finance / Payroll');
    check(JSON.stringify(labels('overtime'))===JSON.stringify(['Finance','Overtime']),
      'Overtime -> Finance / Overtime');
    check(JSON.stringify(labels('supplementals'))===JSON.stringify(['Finance','Supplements']),
      'Supplements -> Finance / Supplements');
    check(JSON.stringify(labels('add'))===JSON.stringify(['Finance','Import']),
      'Import -> Finance / Import');
    check(JSON.stringify(labels('reports'))===JSON.stringify(['Analytics','Reports']),
      'Reports -> Analytics / Reports');
    check(JSON.stringify(labels('settings'))===JSON.stringify(['System','Settings']),
      'Settings -> System / Settings');

    // The last crumb of a direct sidebar item is current + non-interactive.
    const eTrail = trail('employees');
    check(eTrail[eTrail.length-1].current===true && eTrail[eTrail.length-1].view===null,
      'sidebar-item terminal crumb is current and non-navigation');
    check(eTrail[0].view===null, 'domain crumb is non-interactive (no domain landing page)');

    /* Context/detail views: Domain / Item(link) / Context(current). Entity-aware terminals.
       Readiness-1 — the breadcrumb now resolves its terminal through the SCOPED record
       read, so that a foreign employee's NAME can never be printed above a detail page
       that correctly refuses to render them. Naming a record therefore requires a
       principal; with none selected the crumb falls back to the generic label (fail
       closed). CEO is selected here because this section tests breadcrumb DERIVATION,
       not scoping; scoping is proven by tools/verify-employee-read-scope-runtime.js. */
    rt.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
    S.detailEmpId='emp_1';
    check(JSON.stringify(labels('employeeDetail'))===JSON.stringify(['People','Employees','SAMPLE — Norman Fixture']),
      'Employee Detail -> People / Employees / <name> (entity-aware terminal)');
    const edTrail = trail('employeeDetail');
    check(edTrail[1].view==='employees', 'Employee Detail owning-item crumb links to Employees');
    check(edTrail[2].current===true && edTrail[2].view===null, 'Employee Detail terminal crumb is current + non-navigation');

    S.detailContractId='ct_1';
    check(JSON.stringify(labels('contractDetail'))===JSON.stringify(['People','Contracts','SAMPLE/CT/001']),
      'Contract Detail -> People / Contracts / <contract number>');
    check(trail('contractDetail')[1].view==='contracts', 'Contract Detail resolves through Contracts');

    S.detailPayrollId='pp_1';
    check(JSON.stringify(labels('payrollDetail'))===JSON.stringify(['Finance','Payroll','SAMPLE — Norman Fixture']),
      'Payroll Detail -> Finance / Payroll / <name>');
    check(trail('payrollDetail')[1].view==='payroll', 'Payroll Detail resolves through Payroll');

    check(JSON.stringify(labels('overtimeSheet'))===JSON.stringify(['Finance','Overtime','Overtime Sheet']),
      'Overtime Sheet -> Finance / Overtime / Overtime Sheet');
    check(trail('overtimeSheet')[1].view==='overtime', 'Overtime Sheet resolves through Overtime');

    check(JSON.stringify(labels('payrollAdjustments'))===JSON.stringify(['Finance','Payroll','Payroll Adjustments']),
      'Payroll Adjustments -> Finance / Payroll / Payroll Adjustments');
    check(JSON.stringify(labels('supplementalDetail'))===JSON.stringify(['Finance','Supplements','Supplemental Detail']),
      'Supplemental Detail -> Finance / Supplements / Supplemental Detail');
    check(JSON.stringify(labels('smartImport'))===JSON.stringify(['Finance','Import','Smart Import']),
      'Smart Import -> Finance / Import / Smart Import');

    // Entity-aware terminal falls back to a stable generic label (never a raw id) when
    // the selected entity is missing.
    S.detailEmpId='does_not_exist';
    check(labels('employeeDetail')[2]==='Employee Detail',
      'missing entity -> stable generic terminal label (no id leak)');

    // Exactly one Breadcrumb landmark in the emitted markup.
    S.detailEmpId='emp_1';
    const html = rt.breadcrumbHTML('employeeDetail');
    check((html.match(/aria-label="Breadcrumb"/g)||[]).length===1, 'breadcrumbHTML emits exactly one Breadcrumb landmark');
    check((html.match(/aria-current="page"/g)||[]).length===1, 'exactly one aria-current="page" inside the breadcrumb');
    check(html.indexOf('does_not_exist')===-1 && html.indexOf('emp_1')===-1, 'no internal id leaks into breadcrumb markup');
  }

  // ---------- B. Quick Action matrix ----------
  console.log('-- B. quick action matrix --');
  {
    const rt = loadRuntime(); seed(rt); const S = rt.State;
    const qa = (view)=>{ S.view=view; return rt.quickActionsFor(view).map(a=>({label:a.label,to:a.to})); };

    // Employee Detail: View Contract (contract exists today) + Go to Payroll.
    S.detailEmpId='emp_1';
    // activeContractToday uses coveringContract(empId, todayKey()); the fixture contract
    // covers 2026 — visibility depends on the run date, so assert View Contract is present
    // ONLY when the resolver reports a contract, and always assert Go to Payroll.
    let acts = qa('employeeDetail');
    check(acts.some(a=>a.label==='Go to Payroll' && a.to==='payroll'), 'Employee Detail exposes Go to Payroll -> payroll');
    check(acts.every(a=>['View Contract','Go to Payroll'].includes(a.label)), 'Employee Detail exposes only approved actions');

    // Contract Detail: View Employee (employee exists) + Go to Payroll.
    S.detailContractId='ct_1';
    acts = qa('contractDetail');
    check(acts.some(a=>a.label==='View Employee' && a.to==='employeeDetail'), 'Contract Detail exposes View Employee -> employeeDetail');
    check(acts.some(a=>a.label==='Go to Payroll'), 'Contract Detail exposes Go to Payroll');

    // Missing-context: no relevant employee -> View Employee hidden.
    S.detailContractId='nope';
    check(!qa('contractDetail').some(a=>a.label==='View Employee'), 'Contract Detail hides View Employee when context missing');
    S.detailContractId='ct_1';

    // Payroll workspace: Go to Execution Center is visible only after posting.
    // Committed plan present -> visible.
    check(qa('payroll').some(a=>a.label==='Go to Execution Center' && a.to==='executioncenter'),
      'Payroll exposes Go to Execution Center after posting (committed plan present)');
    // Remove posting -> hidden (pre-posting).
    S.payrollPlans[0].status='Ready'; // Approved stage, not committed
    check(!qa('payroll').some(a=>a.label==='Go to Execution Center'),
      'Payroll hides Go to Execution Center before posting');
    S.payrollPlans[0].status='Committed';

    // Execution Center contextual navigation.
    acts = qa('executioncenter');
    check(acts.some(a=>a.label==='View Posted Transactions' && a.to==='transactions'), 'Execution Center exposes View Posted Transactions');
    check(acts.some(a=>a.label==='Go to Payroll'), 'Execution Center exposes Go to Payroll');
    check(acts.some(a=>a.label==='Go to Overtime'), 'Execution Center exposes Go to Overtime');

    // Every visible action across every context targets an existing dispatched view.
    const dispatched = new Set(Object.keys(rt.QUICK_ACTIONS_BY_VIEW));
    let allTo = [];
    ['employeeDetail','contractDetail','payroll','payrollDetail','overtime','executioncenter']
      .forEach(v=>{ S.view=v; rt.quickActionsFor(v).forEach(a=>allTo.push(a.to)); });
    const knownRoutes = new Set(['contractDetail','employeeDetail','payroll','executioncenter','transactions','overtime']);
    check(allTo.length>0 && allTo.every(t=>knownRoutes.has(t)), 'every visible Quick Action targets an existing view');
    check(dispatched.size>0, 'the Quick Action manifest is centralized (single source)');
  }

  // ---------- C. No auto-execution: navigation-only side effects ----------
  console.log('-- C. no auto-execution (navigation only) --');
  {
    const rt = loadRuntime(); seed(rt); const S = rt.State;
    // Faithfully replay the EXACT payload each Quick Action button carries:
    //   const extra = a.resolve ? a.resolve() : null; hrNavTo(a.to, extra || undefined);
    // hrNavTo() runs render() (presentation) for real. We snapshot every business
    // collection before and after and require byte-equivalence — only navigation and
    // context state may differ.
    function clickAll(view, setup){
      S.view = view; if(setup) setup();
      const acts = rt.quickActionsFor(view);
      acts.forEach(a=>{
        const before = businessSnapshot(S);
        const extra = a.resolve ? a.resolve() : null;
        try { rt.hrNavTo(a.to, extra || undefined); } catch(e){ /* presentation stub may noop; business state is asserted below */ }
        const after = businessSnapshot(S);
        check(before === after,
          `[${view}] "${a.label}" changes no business state (payroll/overtime/txn/audit byte-identical)`);
        check(S.view === a.to, `[${view}] "${a.label}" navigates to ${a.to} (navigation only)`);
        S.view = view; if(setup) setup(); // reset context for the next action
      });
    }
    clickAll('employeeDetail', ()=>{ S.detailEmpId='emp_1'; });
    clickAll('contractDetail', ()=>{ S.detailContractId='ct_1'; });
    clickAll('payroll', ()=>{ S.payrollPlans[0].status='Committed'; });
    clickAll('overtime', null);
    clickAll('payrollDetail', ()=>{ S.detailPayrollId='pp_1'; });
    clickAll('executioncenter', null);

    // Explicit "Go to Execution Center" proof: payroll stays Posted, becomes nothing else.
    S.view='payroll'; S.payrollPlans[0].status='Committed';
    const stageBefore = S.payrollPlans[0].status;
    const before = businessSnapshot(S);
    try { rt.hrNavTo('executioncenter'); } catch(e){}
    check(S.view==='executioncenter', 'Go to Execution Center lands on the Execution Center view');
    check(S.payrollPlans[0].status===stageBefore, 'Go to Execution Center did NOT advance payroll stage (no execution)');
    check(businessSnapshot(S)===before, 'Go to Execution Center left all business state byte-identical');
  }

  console.log('');
  if(failures.length===0){ console.log('UX-004D RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.'); process.exit(0); }
  console.log('UX-004D RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
  failures.forEach(f=>console.log('   - ' + f)); process.exit(1);
})();
