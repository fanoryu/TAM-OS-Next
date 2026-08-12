#!/usr/bin/env node
'use strict';
/* ============================================================
   READINESS-1 — EMPLOYEE READ SCOPE & PRIVACY CLOSURE — RUNTIME VERIFICATION
   ------------------------------------------------------------
   The post-UX-006D readiness audit proved that the UX-006B self-scope layer was
   built, tested and connected to nothing: getScopedRecords() had zero production
   consumers, so an Employee principal could read the whole company — including a
   colleague's salary — through lists, aggregates, deep links and Global Search.

   This harness is the regression proof that the gap is closed and stays closed. It
   is deliberately adversarial: it does not merely assert that A sees A's records, it
   asserts that B's DISTINCTIVE COMPENSATION VALUE cannot appear anywhere in A's
   scoped read output.

   Fixture: two employees with deliberately unmistakable salaries —
     A = 11,111,111   B = 99,999,999
   Principals exercised: CEO, Employee A, Employee B, null.

   Executes the REAL production modules through the same dependency-free Node `vm`
   loader used by the UX-006A/B/C/D harnesses. All fixtures are fabricated; no
   production file is modified and no real data is used.
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

const A_EID = 'emp_fixture_self';        // the principal fixture's bound employee
const B_EID = 'emp_other_fixture';
const A_PAY = 11111111;
const B_PAY = 99999999;                  // must NEVER surface in A's scoped reads
const N = '2025-01-01T00:00:00.000Z';
const CEO_P = 'user_ceo_fixture';
const A_P   = 'user_employee_fixture';

function loadRuntime(){
  const jsFiles = require(path.join(ROOT,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(ROOT,'js',f),'utf8')).join('\n')
    /* Every export is resolved DEFENSIVELY. This harness is also run as a NEGATIVE
       CONTROL against the pre-Readiness-1 baseline, where getScopedRecordById,
       scopedTxns and scopedMonths do not exist yet. A bare reference would throw at
       load time and the run would abort with zero counted assertions; resolving to
       null instead lets the old baseline execute and FAIL LOUDLY on the privacy
       checks — which is exactly the evidence a negative control must produce. */
    + '\n;var __g = function(n){ try { return eval(n); } catch(e){ return null; } };'
    + '\n;window.__TAM__ = { State: State, LocalIdentityProvider: LocalIdentityProvider,'
    + ' getCurrentUser: getCurrentUser, getScopedRecords: __g("getScopedRecords"),'
    + ' getScopedRecordById: __g("getScopedRecordById"), ENTITY_SCOPE: __g("ENTITY_SCOPE"),'
    + ' employeesFiltered: __g("employeesFiltered"), contractsFiltered: __g("contractsFiltered"),'
    + ' payrollPlansForMonth: __g("payrollPlansForMonth"), payrollMonthTotals: __g("payrollMonthTotals"),'
    + ' hrDashboardStats: __g("hrDashboardStats"), scopedTxns: __g("scopedTxns"), scopedMonths: __g("scopedMonths"),'
    + ' txnsFiltered: __g("txnsFiltered"), collectGlobalSearchDocuments: __g("collectGlobalSearchDocuments"),'
    + ' searchGlobal: __g("searchGlobal"), NAV_GROUPS: NAV_GROUPS, PAGE_TITLES: PAGE_TITLES,'
    + ' ACTIONS: ACTIONS, can: can };';
  const noop = function(){};
  const memStore = {};
  const memStorage = {
    getItem:(k)=> Object.prototype.hasOwnProperty.call(memStore,k)?memStore[k]:null,
    setItem:(k,v)=>{ memStore[k]=String(v); }, removeItem:(k)=>{ delete memStore[k]; }
  };
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'', value:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    getAttribute:()=>null, remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const sandbox = {
    console:{ log:noop, warn:noop, error:noop }, navigator:{ userAgent:'tam-readiness1' },
    setTimeout:function(){ return 0; }, clearTimeout:clearTimeout,
    localStorage:memStorage, storage:undefined,
    addEventListener:noop, removeEventListener:noop, confirm:()=>true, prompt:()=>'',
    matchMedia:()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document:{ addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename:'tam-readiness1-runtime.js' });
  sandbox.render = noop; sandbox.showSuccess = noop; sandbox.showError = noop; sandbox.showWarning = noop;
  const rt = sandbox.__TAM__; rt.w = sandbox;
  return rt;
}

function seed(rt, principal){
  const S = rt.State;
  S.settings = { payrollLocks:{}, autoArchiveCompleted:false, defaultPayrollCategory:'Gaji',
    companyName:'SAMPLE COMPANY', onboardingDismissed:false, contractExpiryWarningDays:90 };
  S.employees = [
    { id:A_EID, employeeId:'A-001', fullName:'FIXTURE Alpha', department:'Alpha Dept', employmentStatus:'Active', active:true, monthlyBaseSalary:A_PAY, createdAt:N, updatedAt:N },
    { id:B_EID, employeeId:'B-002', fullName:'FIXTURE Bravo', department:'Bravo Dept', employmentStatus:'Active', active:true, monthlyBaseSalary:B_PAY, createdAt:N, updatedAt:N }
  ];
  S.contracts = [
    { id:'c_a', employeeId:A_EID, employeeName:'FIXTURE Alpha', contractNumber:'CT-ALPHA', status:'Active', monthlySalary:A_PAY, startDate:'2025-01-01', durationMonths:12, createdAt:N, updatedAt:N },
    { id:'c_b', employeeId:B_EID, employeeName:'FIXTURE Bravo', contractNumber:'CT-BRAVO', status:'Active', monthlySalary:B_PAY, startDate:'2025-01-01', durationMonths:12, createdAt:N, updatedAt:N }
  ];
  S.payrollPlans = [
    { id:'p_a', employeeId:A_EID, employeeName:'FIXTURE Alpha', contractNumber:'CT-ALPHA', monthKey:'2025-01', month:'Januari', year:2025, status:'Draft', baseSalary:A_PAY, plannedAmount:A_PAY, totalPayroll:A_PAY, createdAt:N, updatedAt:N },
    { id:'p_b', employeeId:B_EID, employeeName:'FIXTURE Bravo', contractNumber:'CT-BRAVO', monthKey:'2025-01', month:'Januari', year:2025, status:'Draft', baseSalary:B_PAY, plannedAmount:B_PAY, totalPayroll:B_PAY, createdAt:N, updatedAt:N }
  ];
  S.overtimeRecords = [
    { id:'o_a', employeeId:A_EID, employeeName:'FIXTURE Alpha', monthKey:'2025-01', status:'Draft', overtimeHours:3, calculatedAmount:A_PAY, createdAt:N, updatedAt:N },
    { id:'o_b', employeeId:B_EID, employeeName:'FIXTURE Bravo', monthKey:'2025-01', status:'Draft', overtimeHours:9, calculatedAmount:B_PAY, createdAt:N, updatedAt:N }
  ];
  S.payrollAdjustments = [
    { id:'adj_a', employeeId:A_EID, employeeName:'FIXTURE Alpha', amount:A_PAY, active:true, createdAt:N },
    { id:'adj_b', employeeId:B_EID, employeeName:'FIXTURE Bravo', amount:B_PAY, active:true, createdAt:N }
  ];
  S.txns = [
    { id:'t_a', employeeId:A_EID, monthKey:'2025-01', month:'Januari', year:2025, monthNum:1, category:'Gaji', type:'expense', source:'payroll', uraian:'FIXTURE Alpha payroll', planned:A_PAY, actual:null, status:'planned', execution:null, history:[] },
    { id:'t_b', employeeId:B_EID, monthKey:'2025-01', month:'Januari', year:2025, monthNum:1, category:'Gaji', type:'expense', source:'payroll', uraian:'FIXTURE Bravo payroll', planned:B_PAY, actual:null, status:'planned', execution:null, history:[] },
    { id:'t_co', monthKey:'2025-01', month:'Januari', year:2025, monthNum:1, category:'Rutin', type:'expense', source:'manual', uraian:'FIXTURE company rent', planned:7777777, actual:null, status:'planned', execution:null, history:[] }
  ];
  S.monthlyPlans = []; S.recurringExpenses = []; S.employeeMerges = [];
  S.companyAccounts = []; S.supplementalPayments = []; S.importBatches = []; S.backups = [];
  S.selectedMonth = '2025-01'; S.payrollMonth = '2025-01'; S.view = 'execDashboard';
  S.empFilter = { search:'', status:'all', department:'all', active:'all' };
  S.contractFilter = { search:'', status:'all' };
  S.txFilter = { month:'all', category:'all', search:'', budget:'all', type:'all', status:'all', method:'all', bank:'all' };
  S.grid = S.grid || {};
  if(principal) rt.LocalIdentityProvider.selectPrincipal(principal);
  return S;
}

// The central privacy assertion: B's salary must not appear ANYWHERE in a blob of
// A-scoped output. Serialising and string-searching is deliberate — it catches a leak
// through any field, nested object or derived total, not just the ones we thought to check.
// Null-safe: on the pre-Readiness-1 baseline getScopedRecordById does not exist, and
// the negative control must report a counted FAILURE rather than crash.
function sid(rt, type, id){ return (typeof rt.getScopedRecordById === 'function') ? rt.getScopedRecordById(type, id) : '__MISSING__'; }
function leaksB(blob){ return JSON.stringify(blob === undefined ? null : blob).indexOf(String(B_PAY)) !== -1; }
function mentionsBravo(blob){ return JSON.stringify(blob === undefined ? null : blob).indexOf('Bravo') !== -1; }

(function main(){
  console.log('== READINESS-1 EMPLOYEE READ SCOPE & PRIVACY — RUNTIME VERIFICATION ==');
  console.log('   Employee A must never read Employee B. B salary = ' + B_PAY + '.');
  console.log('');

  /* 1. the scope layer now HAS production consumers */
  console.log('-- 1. the self-scope layer is wired (the audit gap) --');
  { const consumers = [];
    const files = require(path.join(ROOT,'tools','module-order.js'));
    files.forEach(function(f){
      if(f === 'core/workspace.js') return;                 // the definition itself
      const src = fs.readFileSync(path.join(ROOT,'js',f),'utf8')
        .replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/[^\n]*/g,'$1');
      if(/getScopedRecords\(|getScopedRecordById\(/.test(src)) consumers.push(f);
    });
    check(consumers.length > 0, 'getScopedRecords/getScopedRecordById now has production consumers ('+consumers.length+')');
    ['people/employees.js','people/contracts.js','people/overtime.js','people/payroll-ops-engine.js',
     'people/hr-dashboard-reports.js','ui/global-search-ui.js','core/domain-services.js'
    ].forEach(function(f){
      check(consumers.indexOf(f) !== -1, 'scoped read wired in ' + f);
    }); }

  /* 2. entity coverage */
  console.log('-- 2. every privacy-relevant store has an explicit SELF predicate --');
  { const rt = loadRuntime();
    ['employee','contract','payrollPlan','overtime','payrollAdjustment','transaction'].forEach(function(k){
      const e = rt.ENTITY_SCOPE[k];
      check(!!e && typeof e.collection === 'function' && typeof e.self === 'function',
        'ENTITY_SCOPE.' + k + ' declares an explicit collection + self predicate');
    }); }

  /* 3. Employee A / Employee B privacy matrix */
  console.log('-- 3. Employee A privacy matrix : A sees A, never B --');
  { const rt = loadRuntime(); seed(rt, A_P);
    const sets = {
      employee:          rt.getScopedRecords('employee'),
      contract:          rt.getScopedRecords('contract'),
      payrollPlan:       rt.getScopedRecords('payrollPlan'),
      overtime:          rt.getScopedRecords('overtime'),
      payrollAdjustment: rt.getScopedRecords('payrollAdjustment'),
      transaction:       rt.getScopedRecords('transaction')
    };
    Object.keys(sets).forEach(function(k){
      check(sets[k].length === 1, 'A: ' + k + ' scope returns exactly A\'s 1 record (got ' + sets[k].length + ')');
      check(!mentionsBravo(sets[k]), 'A: ' + k + ' scope contains no Bravo record');
      check(!leaksB(sets[k]), 'A: ' + k + ' scope does not leak B\'s salary');
    });
    // the company transaction has no employeeId -> not in an Employee's scope (Atlas §9)
    check(JSON.stringify(sets.transaction).indexOf('company rent') === -1,
      'A: an unowned company transaction is NOT in Employee scope (no invented ownership)'); }

  /* 4. list/aggregate renderers */
  console.log('-- 4. list + aggregate renderers are scoped (rows AND totals) --');
  { const rt = loadRuntime(); seed(rt, A_P);
    const emps = rt.employeesFiltered();
    check(emps.length === 1 && emps[0].id === A_EID, 'A: employees list returns only A');
    check(!leaksB(emps), 'A: employees list does not leak B\'s salary');
    const cts = rt.contractsFiltered();
    check(cts.length === 1 && cts[0].id === 'c_a', 'A: contracts list returns only A\'s contract');
    check(!leaksB(cts), 'A: contracts list does not leak B\'s salary');
    const plans = rt.payrollPlansForMonth('2025-01', true);
    check(plans.length === 1 && plans[0].id === 'p_a', 'A: payroll worksheet returns only A\'s row');
    check(!leaksB(plans), 'A: payroll worksheet does not leak B\'s salary');
    const totals = rt.payrollMonthTotals('2025-01');
    check(totals.count === 1, 'A: payroll month TOTALS are derived from the scoped rows (count=1)');
    check(!leaksB(totals), 'A: payroll totals do not leak B\'s salary');
    const stats = rt.hrDashboardStats('2025-01');
    check(!leaksB(stats) && !mentionsBravo(stats), 'A: HR dashboard aggregates leak neither B nor B\'s salary');
    const ledger = rt.txnsFiltered();
    check(!leaksB(ledger) && !mentionsBravo(ledger), 'A: finance ledger leaks neither B nor B\'s salary'); }

  /* 5. Global Search */
  console.log('-- 5. Global Search is scoped at the collector seam --');
  { const rt = loadRuntime(); seed(rt, A_P);
    const docs = rt.collectGlobalSearchDocuments({ navGroups: rt.NAV_GROUPS, pageTitles: rt.PAGE_TITLES,
      employees: rt.getScopedRecords('employee'), contracts: rt.getScopedRecords('contract'),
      payrollPlans: rt.getScopedRecords('payrollPlan') });
    check(!mentionsBravo(docs), 'A: no Bravo document is INDEXED (not merely filtered from results)');
    check(!leaksB(docs), 'A: the search index does not carry B\'s salary');
    const res = rt.searchGlobal('FIXTURE', docs);
    check(!mentionsBravo(res), 'A: searching "FIXTURE" returns no Bravo result');
    const resB = rt.searchGlobal('Bravo', docs);
    check(resB.total === 0, 'A: searching "Bravo" by name returns nothing');
    /* The checks above feed the collector the way production now does. That alone
       cannot fail on the old baseline, because getScopedRecords already existed there —
       what was missing was the production CALL SITE using it. Assert that directly, so
       the negative control fails here too. */
    const gsSrc = fs.readFileSync(path.join(ROOT,'js','ui','global-search-ui.js'),'utf8');
    const gsCall = (gsSrc.match(/collectGlobalSearchDocuments\(\{[\s\S]*?\}\);/) || [''])[0];
    check(/scoped\.employees/.test(gsCall) && /scoped\.contracts/.test(gsCall) && /scoped\.payrollPlans/.test(gsCall),
      'production: the Global Search collector call is provisioned from scoped sources');
    check(gsCall.indexOf('State.') === -1,
      'production: the Global Search collector call reads no raw company-wide State');
    const ceo = loadRuntime(); seed(ceo, CEO_P);
    const ceoDocs = ceo.collectGlobalSearchDocuments({ navGroups: ceo.NAV_GROUPS, pageTitles: ceo.PAGE_TITLES,
      employees: ceo.getScopedRecords('employee'), contracts: ceo.getScopedRecords('contract'),
      payrollPlans: ceo.getScopedRecords('payrollPlan') });
    check(mentionsBravo(ceoDocs), 'CEO: Bravo remains searchable (company-wide read unchanged)'); }

  /* 6. deep links / detail-id provenance */
  console.log('-- 6. deep links : a captured id is re-scoped at render time --');
  { const rt = loadRuntime(); seed(rt, A_P);
    check(sid(rt, 'employee', B_EID) === null, 'A: deep link to B\'s employee record resolves to null');
    check(sid(rt, 'contract', 'c_b') === null, 'A: deep link to B\'s contract resolves to null');
    check(sid(rt, 'payrollPlan', 'p_b') === null, 'A: deep link to B\'s payroll resolves to null');
    check(sid(rt, 'employee', A_EID) !== null, 'A: A\'s own record still resolves');
    check(sid(rt, 'employee', 'does_not_exist') === null, 'missing id resolves to null');
    // a foreign record and a missing record are indistinguishable to the caller
    check(sid(rt, 'employee', B_EID) === sid(rt, 'employee', 'no_such_id'),
      'A: foreign and non-existent are indistinguishable (existence is not leaked)'); }

  /* 7. principal switching — no cached scope */
  console.log('-- 7. principal switching recomputes scope immediately --');
  { const rt = loadRuntime(); seed(rt, CEO_P);
    check(rt.employeesFiltered().length === 2, 'CEO: sees both employees');
    check(leaksB(rt.payrollPlansForMonth('2025-01', true)), 'CEO: reads B\'s compensation (company-wide, unchanged)');
    rt.LocalIdentityProvider.selectPrincipal(A_P);              // CEO -> A, no reload
    check(rt.employeesFiltered().length === 1, 'CEO -> A: company-wide list shrinks immediately');
    check(!leaksB(rt.payrollPlansForMonth('2025-01', true)), 'CEO -> A: B\'s compensation disappears immediately');
    check(sid(rt, 'employee', B_EID) === null, 'CEO -> A: a detail id captured as CEO stops resolving');
    rt.LocalIdentityProvider.selectPrincipal(CEO_P);            // A -> CEO
    check(rt.employeesFiltered().length === 2, 'A -> CEO: company-wide data returns');
    check(leaksB(rt.payrollPlansForMonth('2025-01', true)), 'A -> CEO: compensation returns'); }

  /* 8. null principal — fail closed, never CEO */
  console.log('-- 8. null principal : fail closed, never treated as CEO --');
  { const rt = loadRuntime(); seed(rt, null);
    check(rt.getCurrentUser() === null, 'null: no principal is selected');
    ['employee','contract','payrollPlan','overtime','payrollAdjustment','transaction'].forEach(function(k){
      check(rt.getScopedRecords(k).length === 0, 'null: ' + k + ' scope is empty (fail closed)');
    });
    check(rt.employeesFiltered().length === 0, 'null: employees list is empty');
    check(rt.payrollPlansForMonth('2025-01', true).length === 0, 'null: payroll worksheet is empty');
    check(!leaksB(rt.hrDashboardStats('2025-01')), 'null: HR aggregates leak no compensation');
    check(sid(rt, 'employee', A_EID) === null, 'null: deep link resolves nothing');
    check(!!rt.scopedMonths && rt.scopedMonths().length === 0, 'null: finance months are empty (not treated as CEO)'); }

  /* 9. mutation authorization untouched */
  console.log('-- 9. Readiness-1 changed no mutation authorization --');
  { const rt = loadRuntime();
    check(Object.keys(rt.ACTIONS).length === 20, 'ACTIONS remains exactly 20 (no new action)');
    const az = fs.readFileSync(path.join(ROOT,'js','core','authz.js'),'utf8');
    check((az.match(/:\s*'[a-z]+\.[a-zA-Z]+'/g) || []).length === 20, 'the frozen 20-action registry is unchanged');
    const rtA = loadRuntime(); seed(rtA, A_P);
    check(rtA.can('data.reset') === false, 'A: a denied mutation is still denied');
    const rtC = loadRuntime(); seed(rtC, CEO_P);
    check(rtC.can('data.reset') === true, 'CEO: an allowed mutation is still allowed');
    check(/const SCHEMA_VERSION = 6;/.test(fs.readFileSync(path.join(ROOT,'js','core','constants.js'),'utf8')),
      'SCHEMA_VERSION remains 6 (read scope needed no migration)'); }

  /* 9b. IDENTITY DISCLOSURE (Atlas closure ruling).
     An employee's NAME is itself scoped data. It is not enough that detail pages,
     salary and payroll are scoped while a roster, picker, dropdown or navigator still
     lists colleagues — by then the identity has already been disclosed, and refusing
     the click afterwards is too late. Every Employee-visible identity-bearing source
     must therefore be produced from scoped records in the first place. */
  console.log('-- 9b. identity disclosure : rosters, pickers and selectors are scoped --');
  { // Employee A: A present, B absent — across every identity-bearing source.
    const rt = loadRuntime(); seed(rt, A_P);
    const sources = {
      'employee roster (list)':        rt.employeesFiltered(),
      'contract list identities':      rt.contractsFiltered(),
      'payroll worksheet identities':  rt.payrollPlansForMonth('2025-01', true),
      'scoped employee set':           rt.getScopedRecords('employee'),
      'scoped adjustment identities':  rt.getScopedRecords('payrollAdjustment'),
      'scoped overtime identities':    rt.getScopedRecords('overtime')
    };
    Object.keys(sources).forEach(function(k){
      const blob = JSON.stringify(sources[k]);
      check(blob.indexOf('Alpha') !== -1 || sources[k].length === 0, 'A: ' + k + ' may contain A');
      check(blob.indexOf('Bravo') === -1, 'A: ' + k + ' contains NO B identity');
      check(blob.indexOf('B-002') === -1, 'A: ' + k + ' contains no B employee code');
    }); }
  { // Employee B is the mirror image — proving the scope follows the principal, not a
    // hardcoded fixture. B is reached by rebinding the employee principal's linkage.
    const rt = loadRuntime(); seed(rt, A_P);
    rt.State.employees = rt.State.employees.map(function(e){
      return (e.id === A_EID) ? Object.assign({}, e, { id:'emp_moved_away' })
           : (e.id === B_EID) ? Object.assign({}, e, { id:A_EID }) : e;   // B now occupies the bound id
    });
    rt.State.contracts = rt.State.contracts.map(function(c){
      return c.id === 'c_b' ? Object.assign({}, c, { employeeId:A_EID }) : Object.assign({}, c, { employeeId:'emp_moved_away' });
    });
    const roster = JSON.stringify(rt.employeesFiltered());
    check(roster.indexOf('Bravo') !== -1, 'B: roster contains B');
    check(roster.indexOf('Alpha') === -1, 'B: roster contains NO A identity'); }
  { // CEO sees the full roster; null sees no sensitive roster at all.
    const ceo = loadRuntime(); seed(ceo, CEO_P);
    const cr = JSON.stringify(ceo.employeesFiltered());
    check(cr.indexOf('Alpha') !== -1 && cr.indexOf('Bravo') !== -1, 'CEO: roster contains BOTH identities');
    const nul = loadRuntime(); seed(nul, null);
    const nr = JSON.stringify(nul.employeesFiltered());
    check(nr.indexOf('Alpha') === -1 && nr.indexOf('Bravo') === -1, 'null: roster contains NO identity');
    check(nul.employeesFiltered().length === 0, 'null: receives no sensitive employee roster at all'); }
  { // The pickers/selectors themselves — asserted structurally at their source, because
    // they build <option> markup rather than returning an array.
    const pickers = [
      ['people/overtime.js',          'overtime employee picker + worksheet'],
      ['people/contracts.js',         'contract form employee picker'],
      ['people/payroll-workspace.js', 'payroll adjustment employee picker'],
      ['people/legacy-mapping.js',    'legacy mapping employee picker'],
      ['people/employee-dedup.js',    'duplicate-review roster render'],
      ['ui/settings-about.js',        'settings employee diagnostics']
    ];
    pickers.forEach(function(pr){
      const src = fs.readFileSync(path.join(ROOT,'js',pr[0]),'utf8')
        .replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/[^\n]*/g,'$1');
      check(/getScopedRecords\('employee'\)/.test(src),
        'identity source is scoped: ' + pr[1] + ' (' + pr[0] + ')');
    });
    // The overtime picker is the critical one: it is reachable in an Employee-AUTHORIZED
    // workflow (own-Draft overtime), so it is genuinely usable, not merely renderable.
    const ot = fs.readFileSync(path.join(ROOT,'js','people','overtime.js'),'utf8');
    const modal = (ot.match(/function openOvertimeModal[\s\S]*?const v = /) || [''])[0];
    check(/getScopedRecords\('employee'\)/.test(modal),
      'the Employee-authorized overtime picker is scoped (usable, not just renderable)');
    const sheet = (ot.match(/const eligible = [^\n]*/) || [''])[0];
    check(/getScopedRecords\('employee'\)/.test(sheet),
      'the overtime worksheet (one row per employee) is scoped'); }
  { // Principal switching must recompute the roster every time, with no reload.
    const rt = loadRuntime(); seed(rt, CEO_P);
    const seq = [];
    seq.push(['CEO', JSON.stringify(rt.employeesFiltered())]);
    rt.LocalIdentityProvider.selectPrincipal(A_P);
    seq.push(['A', JSON.stringify(rt.employeesFiltered())]);
    rt.LocalIdentityProvider.selectPrincipal(CEO_P);
    seq.push(['CEO again', JSON.stringify(rt.employeesFiltered())]);
    check(seq[0][1].indexOf('Bravo') !== -1, 'switch CEO: roster holds both');
    check(seq[1][1].indexOf('Bravo') === -1 && seq[1][1].indexOf('Alpha') !== -1,
      'switch CEO -> A: roster shrinks to A immediately (no reload)');
    check(seq[2][1].indexOf('Bravo') !== -1, 'switch A -> CEO: full roster returns');
    check(seq[0][1] === seq[2][1], 'the roster is recomputed, never served from a cached copy'); }

  /* 10. the canonical State is never narrowed */
  console.log('-- 10. scoping is a READ concern : canonical State stays complete --');
  { const rt = loadRuntime(); seed(rt, A_P);
    rt.employeesFiltered(); rt.contractsFiltered(); rt.payrollPlansForMonth('2025-01', true);
    rt.getScopedRecords('employee'); sid(rt, 'employee', B_EID);
    check(rt.State.employees.length === 2, 'canonical State.employees still holds BOTH employees after scoped reads');
    check(rt.State.payrollPlans.length === 2, 'canonical State.payrollPlans is not narrowed');
    check(rt.State.txns.length === 3, 'canonical State.txns is not narrowed');
    const scoped = rt.getScopedRecords('employee');
    scoped.length = 0;                                        // mutate the returned array
    check(rt.State.employees.length === 2, 'a scoped result is a COPY — mutating it cannot damage State'); }

  console.log('');
  if(failures.length){
    console.log('READINESS-1 EMPLOYEE READ SCOPE VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f=>console.log('  - ' + f));
    process.exit(1);
  }
  console.log('READINESS-1 EMPLOYEE READ SCOPE VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
