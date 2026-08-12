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
     D2-1  the "Acting as" selector still renders, still enumerates CEO-first, and
           still starts unselected (D1 contract intact)
     D2-2  principal & workspace context is VISIBLE and truthful for CEO / Employee /
           null, and is derived per render (no stale provenance across a switch)
     D2-3  the collapsed rail no longer hides WHICH principal is active
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
  const src = jsFiles.map(f => fs.readFileSync(path.join(ROOT,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { State: State, LocalIdentityProvider: LocalIdentityProvider,'
    + ' getCurrentUser: getCurrentUser, getCurrentWorkspace: getCurrentWorkspace,'
    + ' can: can, ACTIONS: ACTIONS, authzDisabled: authzDisabled,'
    + ' renderIdentitySelectorHTML: renderIdentitySelectorHTML,'
    + ' syncIdentitySelector: syncIdentitySelector, quickActionsFor: quickActionsFor,'
    + ' identityAvailablePrincipals: identityAvailablePrincipals };';
  const noop = function(){};
  const memStore = {};
  const writes = [];
  const memStorage = {
    getItem:(k)=> Object.prototype.hasOwnProperty.call(memStore,k)?memStore[k]:null,
    setItem:(k,v)=>{ writes.push(k); memStore[k]=String(v); },
    removeItem:(k)=>{ delete memStore[k]; }
  };
  // Shell tree carrying the nodes syncIdentitySelector() writes to.
  const app = El('div'); app.setAttribute('id','app');
  const brand = El('div'); brand.classList.add('brand'); app.appendChild(brand);
  const wrap = El('div'); wrap.classList.add('identity-selector'); wrap.setAttribute('data-principal-state','none'); brand.appendChild(wrap);
  const rail = El('div'); rail.classList.add('identity-rail'); rail.setAttribute('id','identityPrincipalRail');
  rail.setAttribute('data-principal-state','none'); wrap.appendChild(rail);
  const sel = El('select'); sel.setAttribute('id','identityPrincipalSelect'); wrap.appendChild(sel);
  const help = El('p'); help.setAttribute('id','identityPrincipalHelp'); wrap.appendChild(help);
  const ctx = El('div'); ctx.classList.add('identity-context'); ctx.setAttribute('id','identityPrincipalContext');
  ctx.setAttribute('data-principal-state','none'); wrap.appendChild(ctx);
  const ctxName = El('span'); ctxName.classList.add('identity-context-name'); ctx.appendChild(ctxName);
  const ctxDetail = El('span'); ctxDetail.classList.add('identity-context-detail'); ctx.appendChild(ctxDetail);
  const main = El('main'); main.setAttribute('id','main'); app.appendChild(main);
  const byId = { app:app, main:main, identityPrincipalSelect:sel, identityPrincipalHelp:help,
    identityPrincipalRail:rail, identityPrincipalContext:ctx };
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
  rt.w = sandbox; rt.dom = { app, wrap, rail, sel, help, ctx, ctxName, ctxDetail }; rt.writes = writes;
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

  /* 1. D2-1 — the D1 selector contract is intact */
  console.log('-- 1. D2-1 : the UX-006D1 selector contract is unchanged --');
  { const rt = loadRuntime(); seed(rt, null);
    const html = rt.w.renderIdentitySelectorHTML();
    check(/id="identityPrincipalSelect"/.test(html), 'the "Acting as" select still renders');
    check(/<label[^>]*for="identityPrincipalSelect"[^>]*>Acting as<\/label>/.test(html),
      'the "Acting as" label still names the select (unchanged wording)');
    check(rt.w.getCurrentUser() === null, 'initial state is still unselected (no default principal)');
    check(/<option value="">/.test(html), 'the non-value placeholder is still present (never auto-selects)');
    const order = rt.w.identityAvailablePrincipals().map(function(p){ return p.principalType; });
    check(order[0] === 'ceo', 'enumeration is still CEO-first (deterministic order preserved)'); }

  /* 2. D2-2 — principal & workspace context is visible and truthful */
  console.log('-- 2. D2-2 : principal & workspace context is visible and truthful --');
  { const expect = { CEO:'Executive workspace', employee:'Personal workspace', null:'No workspace' };
    for(const [label, principal] of PRINCIPALS){
      const rt = loadRuntime(); seed(rt, principal);
      const html = rt.w.renderIdentitySelectorHTML();
      check(html.indexOf('id="identityPrincipalContext"') !== -1,
        label + ': the workspace context block is rendered (never omitted)');
      check(html.indexOf('>' + expect[label] + '<') !== -1,
        label + ': the active workspace context reads "' + expect[label] + '"');
      const state = attrOf(html, 'identityPrincipalContext', 'data-principal-state');
      check(state === (principal ? 'active' : 'none'),
        label + ': the context block carries the correct data-principal-state');
      if(principal){
        const cur = rt.w.getCurrentUser();
        check(html.indexOf('Acting as ' + cur.displayName + '.') !== -1,
          label + ': the helper line names the active principal');
      } else {
        check(html.indexOf('No principal selected') !== -1,
          'null: the unselected state is stated, not blank');
      }
    } }

  /* 2a. the TWO causes of a null workspace are presented distinctly.
     A fresh install has no Employee records, so an employee principal resolves —
     correctly, per the frozen UX-006B fail-closed rule — to NO workspace. Telling
     that active principal to "select a principal" would be false. */
  console.log('-- 2a. D2-2 : the two causes of a null workspace read differently --');
  { const rtNone = loadRuntime(); seed(rtNone, null);
    const htmlNone = rtNone.w.renderIdentitySelectorHTML();
    check(htmlNone.indexOf('Select a principal to begin') !== -1,
      'no principal: the context invites a selection');
    const rtUnlinked = loadRuntime(); seed(rtUnlinked, null);
    rtUnlinked.State.employees = [];                       // linkage deliberately removed
    rtUnlinked.w.LocalIdentityProvider.selectPrincipal(EMP_P);
    const htmlUnlinked = rtUnlinked.w.renderIdentitySelectorHTML();
    check(rtUnlinked.w.getCurrentWorkspace() === null,
      'unlinked employee: the frozen UX-006B rule still fails closed to no workspace');
    check(htmlUnlinked.indexOf('No linked employee record') !== -1,
      'unlinked employee: the context names the real cause');
    check(htmlUnlinked.indexOf('Select a principal to begin') === -1,
      'unlinked employee: an ACTIVE principal is never told to select a principal');
    check(htmlUnlinked.indexOf('Acting as ') !== -1,
      'unlinked employee: the active principal is still named (presentation stays truthful)'); }

  /* 2b. derived per render — no stale provenance across a principal switch */
  console.log('-- 2b. D2-2 : context is derived per render (no stale provenance) --');
  // NOTE: the frozen D1 contract has no de-selection — selectPrincipal() treats an
  // unknown id as a safe no-op miss, and `null` is reachable only as the initial
  // load state (selection is ephemeral and resets on reload). The switch sequence
  // therefore covers null -> CEO -> employee -> CEO, exactly as C3 froze it.
  { const seq = [['CEO', CEO_P, 'Executive workspace'], ['employee', EMP_P, 'Personal workspace'],
                 ['CEO again', CEO_P, 'Executive workspace']];
    const rt = loadRuntime(); seed(rt, null);
    rt.w.syncIdentitySelector();
    check(rt.dom.ctxName.textContent === 'No workspace',
      'initial (null): context reads "No workspace" before any switch');
    let ok = true;
    for(const [label, principal, want] of seq){
      rt.w.LocalIdentityProvider.selectPrincipal(principal);
      rt.w.syncIdentitySelector();
      const got = rt.dom.ctxName.textContent;
      const st = rt.dom.ctx.getAttribute('data-principal-state');
      if(got !== want || st !== 'active') ok = false;
      check(got === want, 'switch -> ' + label + ': context re-derives to "' + want + '"');
      check(st === 'active', 'switch -> ' + label + ': state attribute tracks the current principal');
    }
    check(ok, 'no stale workspace provenance survives any switch in the sequence');
    check(rt.writes.length === 0, 'presentation sync performs ZERO storage writes'); }

  /* 3. D2-3 — the collapsed rail carries the active principal */
  console.log('-- 3. D2-3 : the collapsed rail no longer hides which principal is active --');
  { const shell = read('css/shell.css');
    check(/\.sidebar\.collapsed \.identity-rail\{display:block;\}/.test(shell),
      'collapsed rail reveals the principal chip');
    check(/\.sidebar\.collapsed:hover \.identity-rail\{display:none;\}/.test(shell),
      'hover-peek hides the chip (the full selector takes over — never both)');
    for(const [label, principal] of PRINCIPALS){
      const rt = loadRuntime(); seed(rt, principal);
      const html = rt.w.renderIdentitySelectorHTML();
      check(html.indexOf('id="identityPrincipalRail"') !== -1, label + ': the rail chip is rendered');
      const st = attrOf(html, 'identityPrincipalRail', 'data-principal-state');
      check(st === (principal ? 'active' : 'none'), label + ': the rail chip reports the correct state');
      const title = attrOf(html, 'identityPrincipalRail', 'title');
      check(!!title && title.length > 0, label + ': the rail chip still carries the readable principal text');
    }
    // The chip must read as initials, not as stray punctuation from a display name
    // like "Executive (CEO)".
    const rtC = loadRuntime(); seed(rtC, CEO_P);
    const chip = rtC.dom && rtC.w.renderIdentitySelectorHTML().match(/id="identityPrincipalRail"[^>]*>([^<]*)</);
    check(!!chip && /^[A-Z0-9]{1,2}$/.test(chip[1]),
      'the rail chip is alphanumeric initials only (no punctuation leakage)');
    const rtN = loadRuntime(); seed(rtN, null);
    const chipN = rtN.w.renderIdentitySelectorHTML().match(/id="identityPrincipalRail"[^>]*>([^<]*)</);
    check(!!chipN && chipN[1] === '—', 'the unselected rail chip shows a neutral placeholder'); }

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
    check(Object.keys(rt.ACTIONS).length === 20, 'ACTIONS remains exactly 20 (D2 adds no capability)');
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
  { const selSrc = read('js/ui/identity-selector.js');
    const sel = selSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    check(!/getScopedRecords/.test(sel), 'the selector still performs no scope query');
    check(!/localStorage|StorageAdapter/.test(sel), 'the selector still stores nothing');
    check(!/State\.identity/.test(sel), 'the selector still creates no State.identity slice');
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
