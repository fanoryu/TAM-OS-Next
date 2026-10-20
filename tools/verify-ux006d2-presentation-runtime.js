#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-006D2 — PRINCIPAL & WORKSPACE PRESENTATION — RUNTIME VERIFICATION
   ------------------------------------------------------------
   UX-006D2 is PRESENTATION ONLY. Its whole risk is that a visual improvement
   silently becomes a behaviour or policy change, so this harness is written to
   catch exactly that: every check below either proves a presentation surface is
   truthful, or proves that the frozen UX-006C3 semantics underneath it did NOT
   move.

   Proves:
     D2-1..3  AFI-5b: the "Acting as" selector, its workspace context block and its
           collapsed-rail chip are REMOVED with the selector (design Rev 1.2, B-3a/B-3b):
           no selector function exists, shell.css carries no selector rule, the shell
           mounts nothing; what stays true underneath — no default principal, the frozen
           UX-006B fail-closed workspace, zero storage writes on a principal switch — is
           still proved, in a LOCAL runtime with the development identity
           (tools/dev/local-identity-fixture.js) installed through the test seam
     D2-4  all 43 frozen UX-006C3 integration entries are still present and are
           never hidden or disabled for any principal
     D2-5  the seven frozen single-capability controls stay VISIBLE + DISABLED when
           denied and enabled when allowed — with the D2 marker present on the
           denied branch only
     D2-6  presentation changed no decision: can() results, ACTIONS and the disabled
           condition are identical to the C3 baseline
     D2-7  the CSS carries no authorization-dependent hiding of navigation

   Executes the REAL production modules through the same dependency-free Node `vm`
   loader used by the UX-006A/B/C/D1 harnesses. All fixtures are fabricated; no
   production file is modified and no real data is used.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const MANIFEST = require('./integration-surface-manifest.js');

const ROOT = path.resolve(__dirname, '..');
// AFI-5b (design Rev 1.2 §3, D-02) — this harness runs LOCAL mode. The shipped AUTH_MODE is
// SESSION, so the loader rewrites its one assignment to LOCAL in memory, loads the development
// identity right after core/identity.js and installs its LocalIdentityProvider alias once.
const AFI5_DEV_IDENTITY = fs.readFileSync(path.join(__dirname, 'dev', 'local-identity-fixture.js'), 'utf8');
function afi5LocalSource(f, src){
  if(f === 'core/constants.js'){
    const assigns = src.match(/const AUTH_MODE = [^;\n]+;/g) || [];
    if(assigns.length !== 1) throw new Error('expected exactly one AUTH_MODE assignment');
    return src.replace(assigns[0], 'const AUTH_MODE = AUTH_MODES.LOCAL;');
  }
  return f === 'core/identity.js' ? src + '\n' + AFI5_DEV_IDENTITY : src;
}
const AFI5_LOCAL_INSTALL = '\n;setIdentityProviderForTesting(LocalIdentityProvider); window.LocalIdentityProvider = LocalIdentityProvider;';
let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ---------- minimal fake DOM (mirrors the UX-006D1 harness) ---------- */
function El(tag){
  const el = { tagName:String(tag||'div').toUpperCase(), _classes:new Set(), _attrs:{}, _listeners:{},
    children:[], parent:null, textContent:'', value:'', style:{}, dataset:{} };
  el.setAttribute = (k,v)=>{ el._attrs[k]=String(v); if(k==='id') el.id=String(v); };
  el.getAttribute = (k)=> (k in el._attrs)?el._attrs[k]:null;
  el.hasAttribute = (k)=> k in el._attrs;
  el.appendChild = (c)=>{ c.parent=el; el.children.push(c); return c; };
  el.addEventListener = (t,fn)=>{ (el._listeners[t]=el._listeners[t]||[]).push(fn); };
  el.dispatchEvent = (evt)=>{ (el._listeners[evt.type]||[]).slice().forEach(fn=>fn(evt)); return true; };
  el.classList = { add:(c)=>el._classes.add(c), remove:(c)=>el._classes.delete(c), contains:(c)=>el._classes.has(c) };
  el.querySelector = (s)=> qsa(el,s)[0] || null;
  el.querySelectorAll = (s)=> qsa(el,s);
  Object.defineProperty(el,'className',{ get:()=>[...el._classes].join(' '),
    set:(v)=>{ el._classes=new Set(String(v).split(/\s+/).filter(Boolean)); } });
  return el;
}
function descendants(root){ const out=[]; (function w(n){ n.children.forEach(c=>{ out.push(c); w(c); }); })(root); return out; }
function matchSimple(el, s){
  s=s.trim(); if(!s) return false;
  let ok=true, saw=false;
  const idm=s.match(/#([\w-]+)/); if(idm){ saw=true; ok=ok&&(el.id===idm[1]); }
  (s.match(/\.[\w-]+/g)||[]).forEach(c=>{ saw=true; ok=ok&&el._classes.has(c.slice(1)); });
  (s.match(/\[[^\]]+\]/g)||[]).forEach(a=>{
    saw=true; const m=a.match(/^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/); if(!m){ ok=false; return; }
    if(m[2]===undefined) ok=ok&&el.hasAttribute(m[1]); else ok=ok&&(el.getAttribute(m[1])===m[2]);
  });
  const tagm=s.match(/^([a-z]+)(?:[.#[]|$)/i); if(tagm){ saw=true; ok=ok&&(el.tagName===tagm[1].toUpperCase()); }
  return saw && ok;
}
function qsa(root, selector){
  const pool=descendants(root); const set=new Set();
  selector.split(',').map(x=>x.trim()).forEach(p=>{ pool.filter(e=>matchSimple(e,p)).forEach(e=>set.add(e)); });
  return [...set];
}

/* ---------- runtime loader ---------- */
function loadRuntime(){
  const jsFiles = require(path.join(ROOT,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => afi5LocalSource(f, fs.readFileSync(path.join(ROOT,'js',f),'utf8'))).join('\n') + AFI5_LOCAL_INSTALL
    + '\n;window.__TAM__ = { State: State, LocalIdentityProvider: LocalIdentityProvider,'
    + ' getCurrentUser: getCurrentUser, getCurrentWorkspace: getCurrentWorkspace,'
    + ' can: can, ACTIONS: ACTIONS, authzDisabled: authzDisabled, quickActionsFor: quickActionsFor,'
    + ' selectorDeclared: [typeof renderIdentitySelectorHTML, typeof syncIdentitySelector,'
    + ' typeof bindIdentitySelector, typeof identityAvailablePrincipals] };';
  const noop = function(){};
  const memStore = {};
  const writes = [];
  const memStorage = {
    getItem:(k)=> Object.prototype.hasOwnProperty.call(memStore,k)?memStore[k]:null,
    setItem:(k,v)=>{ writes.push(k); memStore[k]=String(v); },
    removeItem:(k)=>{ delete memStore[k]; }
  };
  // Shell tree (AFI-5b: no selector nodes exist any more).
  const app = El('div'); app.setAttribute('id','app');
  const brand = El('div'); brand.classList.add('brand'); app.appendChild(brand);
  const main = El('main'); main.setAttribute('id','main'); app.appendChild(main);
  const byId = { app:app, main:main };
  const sandbox = {
    console:{ log:noop, warn:noop, error:noop }, navigator:{ userAgent:'tam-ux006d2' },
    setTimeout:function(){ return 0; }, clearTimeout:clearTimeout,
    localStorage:memStorage, storage:undefined,
    addEventListener:noop, removeEventListener:noop, confirm:()=>true, prompt:()=>'',
    matchMedia:()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document:{ addEventListener:noop, removeEventListener:noop,
      getElementById:(id)=> byId[id] || null,
      querySelector:(s)=> app.querySelector(s), querySelectorAll:(s)=> app.querySelectorAll(s),
      createElement:(t)=>El(t), body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename:'tam-ux006d2-runtime.js' });
  sandbox.render = noop; sandbox.showSuccess = noop; sandbox.showError = noop; sandbox.showWarning = noop;
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.dom = { app, brand, main }; rt.writes = writes;
  return rt;
}
const N = '2025-01-01T00:00:00.000Z';
function seed(rt, principal){
  const S = rt.State;
  S.settings = { payrollLocks:{}, autoArchiveCompleted:false, defaultPayrollCategory:'Gaji',
    companyName:'SAMPLE COMPANY', onboardingDismissed:false };
  // The employee principal fixture binds to this fabricated Employee, so the Personal
  // workspace resolves instead of failing closed on missing linkage.
  const bound = rt.w.LocalIdentityProvider.getAvailablePrincipals()
    .filter(function(p){ return p.principalType === 'employee'; })[0];
  S.employees = [{ id:(bound && bound.employeeId) || 'emp_fixture_self', employeeId:'SELF',
    fullName:'SAMPLE — Self', employmentStatus:'Active', active:true,
    monthlyBaseSalary:1000000, createdAt:N, updatedAt:N }];
  S.contracts = []; S.payrollPlans = []; S.overtimeRecords = []; S.monthlyPlans = [];
  S.payrollAdjustments = []; S.recurringExpenses = []; S.employeeMerges = [];
  S.companyAccounts = []; S.supplementalPayments = []; S.importBatches = [];
  S.backups = []; S.txns = [];
  S.selectedMonth = '2025-01'; S.payrollMonth = '2025-01'; S.view = 'execDashboard';
  if(principal) rt.w.LocalIdentityProvider.selectPrincipal(principal);
  rt.writes.length = 0;
  return S;
}
const attrOf = (html, id, attr) => {
  const m = html.match(new RegExp('id="' + id + '"[^>]*'));
  if(!m) return null;
  const a = m[0].match(new RegExp(attr + '="([^"]*)"'));
  return a ? a[1] : null;
};

(function main(){
  console.log('== UX-006D2 PRINCIPAL & WORKSPACE PRESENTATION — RUNTIME VERIFICATION ==');
  console.log('   presentation is truthful and derived; frozen C3 semantics unmoved.');
  console.log('');
  const CEO_P = 'user_ceo_fixture';
  const EMP_P = 'user_employee_fixture';
  const PRINCIPALS = [['CEO', CEO_P], ['employee', EMP_P], ['null', null]];

  /* 1-3. AFI-5b — the selector, its context block and its rail chip are removed */
  console.log('-- 1. D2-1..3 : the selector presentation is removed with the selector (AFI-5b) --');
  { const rt = loadRuntime(); seed(rt, null);
    check(rt.selectorDeclared.join() === 'undefined,undefined,undefined,undefined',
      'no selector function exists (render / sync / bind / enumeration helpers are gone)');
    check(rt.w.getCurrentUser() === null, 'initial state is still unselected (no default principal)');
    const shell = read('css/shell.css');
    check(!/\.identity-(selector|select|context|rail)\b/.test(shell),
      'shell.css carries no selector, context-block or rail-chip rule');
    check(/\.sidebar\.collapsed \.sidebar-collapse-btn\{/.test(shell) && /\.sidebar\.collapsed:hover \.nav-label/.test(shell),
      'the neighbouring collapsed-rail and hover-peek rules are preserved');
    const shellJs = read('js/ui/shell-render.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    check(!/IdentitySelector|identityPrincipal|identity-(selector|context|rail)/.test(shellJs),
      'the shell mounts, binds and syncs no selector'); }
  { const rtUnlinked = loadRuntime(); seed(rtUnlinked, null);
    rtUnlinked.State.employees = [];                       // linkage deliberately removed
    rtUnlinked.w.LocalIdentityProvider.selectPrincipal(EMP_P);
    check(rtUnlinked.w.getCurrentWorkspace() === null,
      'unlinked employee: the frozen UX-006B rule still fails closed to no workspace'); }
  { const seq = [['CEO', CEO_P, 'executive'], ['employee', EMP_P, 'personal'], ['CEO again', CEO_P, 'executive']];
    const rt = loadRuntime(); seed(rt, null);
    let ok = true;
    for(const [label, principal, want] of seq){
      rt.w.LocalIdentityProvider.selectPrincipal(principal);
      const ws = rt.w.getCurrentWorkspace();
      if(!ws || ws.type !== want) ok = false;
      check(!!ws && ws.type === want, 'switch -> ' + label + ': the workspace re-derives to ' + want);
    }
    check(ok, 'no stale workspace provenance survives any switch in the sequence');
    check(rt.writes.length === 0, 'a principal switch performs ZERO storage writes'); }

  /* 4. D2-4 — the 43 frozen integration entries are untouched by D2 */
  console.log('-- 4. D2-4 : the frozen UX-006C3 integration surface is unchanged --');
  check(MANIFEST.NAVIGATION_TOTAL === 43, 'manifest still freezes 43 integration entries');
  check(MANIFEST.NAV_COUNT === 27 && MANIFEST.QUICK_ACTION_COUNT === 12 && MANIFEST.ACTION_CENTER_COUNT === 4,
    'manifest still reads 27 sidebar + 12 Quick Actions + 4 Action Center generators');
  check(MANIFEST.NAVIGATION_AVAILABILITY === 'visible-normal',
    'navigation availability is still visible-normal (D2 introduced no gating)');
  { const counts = PRINCIPALS.map(function(p){
      const rt = loadRuntime(); seed(rt, p[1]);
      return MANIFEST.QUICK_ACTIONS.map(function(v){ return rt.w.quickActionsFor(v.view).length; }).join(',');
    });
    check(counts[0] === counts[1] && counts[1] === counts[2],
      'Quick Action visibility is still identical for CEO / employee / null'); }

  /* 5. D2-5 — the seven controls stay visible + disabled when denied */
  console.log('-- 5. D2-5 : the seven frozen controls stay VISIBLE + DISABLED when denied --');
  { const rt = loadRuntime(); seed(rt, CEO_P);
    MANIFEST.MUTATION_CONTROLS.forEach(function(c){
      const res = c.action === 'payroll.manage' ? { employeeId:null } : undefined;
      const out = rt.w.authzDisabled(c.action, res);
      check(out === '', 'CEO: ' + c.id + ' (' + c.action + ') is enabled and unmarked');
    }); }
  for(const [label, principal] of [['employee', EMP_P], ['null', null]]){
    const rt = loadRuntime(); seed(rt, principal);
    MANIFEST.MUTATION_CONTROLS.forEach(function(c){
      const res = c.action === 'payroll.manage' ? { employeeId:null } : undefined;
      const out = rt.w.authzDisabled(c.action, res);
      check(/\sdisabled\b/.test(out), label + ': ' + c.id + ' is disabled');
      check(/data-authz-denied="1"/.test(out), label + ': ' + c.id + ' is marked as availability-denied');
      check(!/display:\s*none|hidden/.test(out), label + ': ' + c.id + ' is disabled, NEVER hidden');
      check(/title="[^"]+"/.test(out), label + ': ' + c.id + ' still explains why it is unavailable');
    });
  }
  { const shell = read('css/shell.css');
    check(/\.btn:disabled\[data-authz-denied\]\{/.test(shell),
      'the denied treatment styles the marker (denied reads differently from merely inert)');
    check(!/\[data-authz-denied\][^{]*\{[^}]*display:\s*none/.test(shell),
      'the denied treatment never hides a control');
    check(/opacity:\.65/.test(shell),
      'the denied treatment raises contrast above the generic .4 disabled opacity'); }

  /* 6. D2-6 — presentation changed no decision */
  console.log('-- 6. D2-6 : presentation changed no authorization decision --');
  { const rt = loadRuntime();
    check(Object.keys(rt.ACTIONS).length === 21, 'ACTIONS remains exactly 21 (D2 adds no capability; BF-4a2 added account.manage)');
    const stab = read('js/core/stabilization.js');
    const helper = (stab.match(/function authzDisabled[\s\S]*?\n\}/) || [''])[0];
    check(/return can\(action, resource\) \?/.test(helper),
      'availability still delegates to the frozen public can() — the condition is untouched');
    check(!/principalType|POLICY|canPrincipal|ACTION_SET/.test(helper),
      'the D2 marker introduced no role table or policy copy');
    check(!/State\./.test(helper), 'availability is still derived, never cached in State');
    // The marker rides the denied branch only: an allowed control returns the empty string.
    const rtc = loadRuntime(); seed(rtc, CEO_P);
    check(rtc.w.authzDisabled('data.reset') === '', 'an allowed control returns no marker at all');
    const rte = loadRuntime(); seed(rte, EMP_P);
    check(rte.w.can('data.reset') === false && /data-authz-denied/.test(rte.w.authzDisabled('data.reset')),
      'the marker appears exactly when can() denies — it mirrors the decision, it does not make one');
    check(/const SCHEMA_VERSION = 6;/.test(read('js/core/constants.js')),
      'SCHEMA_VERSION remains 6 (D2 is presentation only)'); }

  /* 7. D2-7 — no authorization-dependent hiding anywhere in the D2 CSS */
  console.log('-- 7. D2-7 : D2 introduced no authorization-dependent hiding --');
  // Comment-stripped, like the UX-006D1 structural guard: these are claims about
  // CODE, and prose that merely names a forbidden symbol must not fail them.
  // AFI-5b: the selector is deleted; its successor, the development identity, carries the
  // same three guarantees.
  { const devSrc = read('tools/dev/local-identity-fixture.js');
    const dev = devSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    check(!/getScopedRecords/.test(dev), 'the development identity performs no scope query');
    check(!/localStorage|StorageAdapter/.test(dev), 'the development identity stores nothing');
    check(!/State\.identity/.test(dev), 'the development identity creates no State.identity slice');
    const css = read('css/shell.css') + read('css/components.css');
    check(!/\.nav-item\[[^\]]*authz[^\]]*\]/.test(css), 'no navigation item is styled by an authorization attribute');
    check(!/quick-action[^{]*\{[^}]*display:\s*none/.test(css), 'no Quick Action is hidden by CSS');
    check(!/action-item[^{]*\{[^}]*display:\s*none/.test(css), 'no Action Center row is hidden by CSS'); }

  console.log('');
  if(failures.length){
    console.log('UX-006D2 PRESENTATION VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f=>console.log('  - ' + f));
    process.exit(1);
  }
  console.log('UX-006D2 PRESENTATION VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
