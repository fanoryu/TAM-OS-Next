#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-006D3 — CROSS-SURFACE PRESENTATION CONSISTENCY & ACCEPTANCE
   ------------------------------------------------------------
   The final UX-006D phase. D3 is PRESENTATION ONLY and is the acceptance gate for
   the whole UX-006D milestone, so this harness does two jobs:

     (1) it proves the D3 consistency fix itself — every sidebar view keeps its
         heading in the no-data state, while a context-only "record not found" state
         correctly keeps none; and
     (2) it re-proves, from D3's own vantage point, that nothing frozen moved:
         the 43 UX-006C3 integration surfaces, navigation visible+normal for every
         principal, the seven denied controls visible+disabled, D2 principal/workspace
         semantics, and the absence of any authorization-hidden navigation.

   Executes the REAL production modules through the same dependency-free Node `vm`
   loader used by the UX-006A/B/C/D1/D2 harnesses. All fixtures are fabricated; no
   production file is modified and no real data is used.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const MANIFEST = require('./integration-surface-manifest.js');

const ROOT = path.resolve(__dirname, '..');
let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/* ---------- runtime loader ---------- */
function loadRuntime(){
  const jsFiles = require(path.join(ROOT,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(ROOT,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { State: State, LocalIdentityProvider: LocalIdentityProvider,'
    + ' getCurrentUser: getCurrentUser, getCurrentWorkspace: getCurrentWorkspace,'
    + ' can: can, ACTIONS: ACTIONS, authzDisabled: authzDisabled, emptyState: emptyState,'
    + ' PAGE_TITLES: PAGE_TITLES, NAV_GROUPS: NAV_GROUPS, quickActionsFor: quickActionsFor,'
    + ' renderIdentitySelectorHTML: renderIdentitySelectorHTML };';
  const noop = function(){};
  const memStore = {};
  const writes = [];
  const memStorage = {
    getItem:(k)=> Object.prototype.hasOwnProperty.call(memStore,k)?memStore[k]:null,
    setItem:(k,v)=>{ writes.push(k); memStore[k]=String(v); },
    removeItem:(k)=>{ delete memStore[k]; }
  };
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'', value:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    getAttribute:()=>null, remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const sandbox = {
    console:{ log:noop, warn:noop, error:noop }, navigator:{ userAgent:'tam-ux006d3' },
    setTimeout:function(){ return 0; }, clearTimeout:clearTimeout,
    localStorage:memStorage, storage:undefined,
    addEventListener:noop, removeEventListener:noop, confirm:()=>true, prompt:()=>'',
    matchMedia:()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document:{ addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename:'tam-ux006d3-runtime.js' });
  sandbox.render = noop; sandbox.showSuccess = noop; sandbox.showError = noop; sandbox.showWarning = noop;
  const rt = sandbox.__TAM__; rt.w = sandbox; rt.writes = writes;
  return rt;
}
const N = '2025-01-01T00:00:00.000Z';
function seed(rt, principal){
  const S = rt.State;
  S.settings = { payrollLocks:{}, autoArchiveCompleted:false, defaultPayrollCategory:'Gaji',
    companyName:'SAMPLE COMPANY', onboardingDismissed:false };
  S.employees = []; S.contracts = []; S.payrollPlans = []; S.overtimeRecords = [];
  S.monthlyPlans = []; S.payrollAdjustments = []; S.recurringExpenses = []; S.employeeMerges = [];
  S.companyAccounts = []; S.supplementalPayments = []; S.importBatches = [];
  S.backups = []; S.txns = [];
  S.selectedMonth = '2025-01'; S.payrollMonth = '2025-01'; S.view = 'execDashboard';
  if(principal) rt.w.LocalIdentityProvider.selectPrincipal(principal);
  rt.writes.length = 0;
  return S;
}

(function main(){
  console.log('== UX-006D3 CROSS-SURFACE PRESENTATION & ACCEPTANCE — RUNTIME VERIFICATION ==');
  console.log('   every sidebar view keeps its identity; nothing frozen moved.');
  console.log('');
  const CEO_P = 'user_ceo_fixture';
  const EMP_P = 'user_employee_fixture';
  const PRINCIPALS = [['CEO', CEO_P], ['employee', EMP_P], ['null', null]];

  /* 1. D3-1 — every sidebar view keeps its heading in the no-data state */
  console.log('-- 1. D3-1 : a view with no data keeps its identity --');
  { const rt = loadRuntime(); const S = seed(rt, CEO_P);
    const ids = rt.NAV_GROUPS.reduce(function(a,g){ return a.concat(g.items.map(function(i){ return i.id; })); }, []);
    check(ids.length === MANIFEST.NAV_COUNT,
      'the sidebar manifest still enumerates ' + MANIFEST.NAV_COUNT + ' views');
    const missing = [];
    ids.forEach(function(id){
      S.view = id;
      const html = rt.w.emptyState('No data yet', 'Add or upload monthly data first.');
      if(!/<h1>/.test(html)) missing.push(id);
    });
    check(missing.length === 0,
      'every one of the ' + ids.length + ' sidebar views renders an <h1> in its no-data state'
      + (missing.length ? ' >> missing: ' + missing.join(', ') : ''));
    // The heading is DERIVED from the one manifest — never duplicated at a call site.
    S.view = 'executioncenter';
    const ec = rt.w.emptyState('No data yet', 'x');
    check(ec.indexOf('<h1>' + rt.PAGE_TITLES.executioncenter + '</h1>') !== -1,
      'the no-data heading is the canonical PAGE_TITLES label (derived, not duplicated)');
    check(/class="page-head"/.test(ec),
      'the no-data state provides the .page-head slot the shell mounts Quick Actions into'); }

  /* 1b. a context-only "record not found" state correctly keeps NO heading */
  console.log('-- 1b. D3-1 : "record not found" is not a titled page --');
  { const rt = loadRuntime(); const S = seed(rt, CEO_P);
    ['employeeDetail','contractDetail','payrollDetail','supplementalDetail'].forEach(function(v){
      S.view = v;
      const html = rt.w.emptyState('Employee not found', 'It may have been deleted.');
      check(!/<h1>/.test(html) && !/page-head/.test(html),
        v + ': a missing record renders no page heading (context-only view, absent from the manifest)');
    });
    check(rt.PAGE_TITLES.employeeDetail === undefined,
      'context-only detail views are deliberately absent from PAGE_TITLES'); }

  /* 1c. the empty-state copy never implies an authorization problem */
  console.log('-- 1c. D3-1 : empty-state copy is about DATA, never about permission --');
  for(const [label, principal] of PRINCIPALS){
    const rt = loadRuntime(); const S = seed(rt, principal);
    S.view = 'reports';
    const html = rt.w.emptyState('No data yet', 'Add or upload monthly data first.');
    check(!/permission|not allowed|unauthor|denied|restricted/i.test(html),
      label + ': the no-data state never implies a permission problem');
    check(/<h1>/.test(html), label + ': the heading is present regardless of principal');
  }
  { // identical for every principal — the empty state is not principal-dependent
    const outs = PRINCIPALS.map(function(p){
      const rt = loadRuntime(); const S = seed(rt, p[1]); S.view = 'reports';
      return rt.w.emptyState('No data yet', 'Add or upload monthly data first.');
    });
    check(outs[0] === outs[1] && outs[1] === outs[2],
      'the no-data state is byte-identical for CEO / employee / null (presentation, not policy)'); }

  /* 2. D3-2 — the frozen UX-006C3 integration surface is untouched */
  console.log('-- 2. D3-2 : the frozen UX-006C3 integration surface is untouched --');
  check(MANIFEST.NAVIGATION_TOTAL === 43, 'manifest still freezes 43 integration entries');
  check(MANIFEST.NAV_COUNT === 27 && MANIFEST.QUICK_ACTION_COUNT === 12 && MANIFEST.ACTION_CENTER_COUNT === 4,
    'manifest still reads 27 sidebar + 12 Quick Actions + 4 Action Center generators');
  check(MANIFEST.NAVIGATION_AVAILABILITY === 'visible-normal',
    'navigation availability is still visible-normal');
  { const counts = PRINCIPALS.map(function(p){
      const rt = loadRuntime(); seed(rt, p[1]);
      return MANIFEST.QUICK_ACTIONS.map(function(v){ return rt.w.quickActionsFor(v.view).length; }).join(',');
    });
    check(counts[0] === counts[1] && counts[1] === counts[2],
      'Quick Action visibility is identical for CEO / employee / null'); }
  { const rt = loadRuntime(); seed(rt, EMP_P);
    const total = MANIFEST.QUICK_ACTIONS.reduce(function(a,v){ return a + rt.w.quickActionsFor(v.view).length; }, 0);
    check(total > 0, 'employee still resolves Quick Actions (navigation is never principal-filtered)'); }

  /* 3. D3-3 — the seven denied controls are unchanged by D3 */
  console.log('-- 3. D3-3 : the seven frozen controls keep their D2 presentation --');
  { const rt = loadRuntime(); seed(rt, CEO_P);
    MANIFEST.MUTATION_CONTROLS.forEach(function(c){
      const res = c.action === 'payroll.manage' ? { employeeId:null } : undefined;
      check(rt.w.authzDisabled(c.action, res) === '', 'CEO: ' + c.id + ' is enabled and unmarked');
    }); }
  for(const [label, principal] of [['employee', EMP_P], ['null', null]]){
    const rt = loadRuntime(); seed(rt, principal);
    MANIFEST.MUTATION_CONTROLS.forEach(function(c){
      const res = c.action === 'payroll.manage' ? { employeeId:null } : undefined;
      const out = rt.w.authzDisabled(c.action, res);
      check(/\sdisabled\b/.test(out) && /data-authz-denied="1"/.test(out) && /title="[^"]+"/.test(out),
        label + ': ' + c.id + ' stays visible + disabled + marked, with its reason');
      check(!/display:\s*none|hidden/.test(out), label + ': ' + c.id + ' is never hidden');
    });
  }

  /* 4. D3-4 — D2 principal/workspace semantics survive D3 */
  console.log('-- 4. D3-4 : D2 principal & workspace semantics survive --');
  { const expect = { CEO:'Executive workspace', employee:'No workspace', null:'No workspace' };
    for(const [label, principal] of PRINCIPALS){
      const rt = loadRuntime(); seed(rt, principal);
      const html = rt.w.renderIdentitySelectorHTML();
      check(html.indexOf('>' + expect[label] + '<') !== -1,
        label + ': workspace context still reads "' + expect[label] + '"');
      check(html.indexOf('id="identityPrincipalRail"') !== -1, label + ': the collapsed rail chip still renders');
    }
    // the two null-workspace causes stay distinct (D2 invariant)
    const rtN = loadRuntime(); seed(rtN, null);
    check(rtN.w.renderIdentitySelectorHTML().indexOf('Select a principal to begin') !== -1,
      'no principal: still invited to select');
    const rtU = loadRuntime(); seed(rtU, EMP_P);
    check(rtU.w.renderIdentitySelectorHTML().indexOf('No linked employee record') !== -1,
      'unlinked employee: still names the real cause, not "select a principal"'); }
  { // principal switching still re-derives, with no writes
    const rt = loadRuntime(); seed(rt, null);
    rt.w.LocalIdentityProvider.selectPrincipal(CEO_P);
    const a = rt.w.renderIdentitySelectorHTML();
    rt.w.LocalIdentityProvider.selectPrincipal(EMP_P);
    const b = rt.w.renderIdentitySelectorHTML();
    check(a !== b && a.indexOf('Executive workspace') !== -1,
      'principal switch still re-derives the presentation');
    check(rt.writes.length === 0, 'principal switching still performs ZERO storage writes'); }

  /* 5. D3-5 — no authorization-hidden navigation, anywhere */
  console.log('-- 5. D3-5 : no authorization-driven hiding was introduced --');
  { const css = read('css/shell.css') + read('css/components.css');
    check(!/(nav-item|quick-action|action-item)[^{]*\{[^}]*display:\s*none/.test(css),
      'no navigation surface is hidden by CSS');
    check(!/(nav-item|quick-action|action-item)[^{]*\[data-authz-denied\]/.test(css),
      'no navigation surface is styled by an authorization attribute');
    const shell = stripComments(read('js/ui/shell-render.js'));
    check(!/authzDisabled/.test(shell), 'the shell/navigation module applies no availability policy');
    check(!/\bcan\(/.test(shell), 'the shell/navigation module contains no authorization gate');
    const dash = stripComments(read('js/finance/dashboard.js'));
    check(!/\bcan\(|authzDisabled|getCurrentUser/.test(dash),
      'the D3-touched empty-state helper wires no authorization'); }

  /* 6. D3-6 — presentation never becomes the authorization source of truth */
  console.log('-- 6. D3-6 : presentation is not authorization --');
  { const rt = loadRuntime();
    check(Object.keys(rt.ACTIONS).length === 20, 'ACTIONS remains exactly 20 (D3 adds no capability)');
    const helper = (read('js/core/stabilization.js').match(/function authzDisabled[\s\S]*?\n\}/) || [''])[0];
    check(/return can\(action, resource\) \?/.test(helper),
      'the availability condition is still the frozen delegation to can()');
    check(!/State\./.test(helper), 'availability is still derived, never cached');
    check(/const SCHEMA_VERSION = 6;/.test(read('js/core/constants.js')), 'SCHEMA_VERSION remains 6');
    check(/const APP_VERSION = '2\.10\.0';/.test(read('js/core/constants.js')), 'APP_VERSION is 2.10.0 (Readiness-3 release decision)'); }

  /* 7. D3-7 — Global Search scope wiring remains outside UX-006D */
  console.log('-- 7. D3-7 : Global Search scope wiring remains deferred --');
  { const gs = read('js/core/global-search.js');
    check(!/getScopedRecords|getCurrentWorkspace|getCurrentUser|principalType/.test(gs),
      'js/core/global-search.js performs no principal-aware data scoping');
    check(!/\bcan\(|authzDisabled/.test(stripComments(gs)),
      'js/core/global-search.js wires no authorization'); }

  /* 8. D3-8 — regression proof for the hardened UX-005A guard.
     D3 legitimately had to document a presentation change inside the dashboard
     sources, which the old raw-source `!/UX-006/` guard forbade. The guard was
     hardened rather than weakened; these checks prove the replacement is strictly
     stronger — it ignores prose but still catches real API use. */
  console.log('-- 8. D3-8 : the hardened UX-005A guard is stronger, not weaker --');
  { const vb = read('tools/verify-build.js');
    check(/dashboard sources call no UX-006 identity\/workspace\/authorization API/.test(vb),
      'the hardened guard exists (explicit API-symbol check)');
    check(/no UX-006 implementation introduced in the dashboard sources \(code, not prose\)/.test(vb),
      'the label check now runs on comment-stripped code');
    const SYM = /\b(getCurrentUser|getCurrentWorkspace|getScopedRecords|getBoundEmployee|authzDisabled|LocalIdentityProvider|IdentityProvider|principalType|canPrincipal|PRINCIPAL_TYPES|WORKSPACE_TYPES)\b|\bcan\(|\bACTIONS\./;
    // a comment mentioning the milestone must NOT trip it …
    check(!SYM.test(stripComments('/* UX-006D3 — a purely explanatory comment. */\nfunction f(){ return 1; }')),
      'regression: prose naming UX-006 no longer trips the guard');
    // … but real API use in code MUST.
    check(SYM.test(stripComments('function f(){ return getCurrentUser(); }')),
      'regression: a real getCurrentUser() call in code still trips the guard');
    check(SYM.test(stripComments('function f(){ return can(ACTIONS.DATA_RESET); }')),
      'regression: a real can(ACTIONS.*) call in code still trips the guard');
    check(!SYM.test(stripComments(read('js/finance/dashboard.js')) + stripComments(read('js/analytics/executive-dashboard.js'))),
      'the live dashboard sources pass the hardened guard'); }

  console.log('');
  if(failures.length){
    console.log('UX-006D3 PRESENTATION VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f=>console.log('  - ' + f));
    process.exit(1);
  }
  console.log('UX-006D3 PRESENTATION VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
