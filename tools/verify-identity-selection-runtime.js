#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-006D1 — REACHABLE PRINCIPAL SELECTION — RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of the D1 selector (module exists,
   registered, adapter-isolated, no persistence/schema, no auth vocabulary). This
   harness proves its BEHAVIOUR by executing the REAL production modules through
   the same dependency-free Node `vm` loader used by the UX-006A/B/C harnesses
   (concatenating module-order.js MINUS core/app-bootstrap.js) against an in-memory
   window + a small faithful fake DOM that models exactly the shell nodes the
   selector touches.

   Proves: initial fail-closed null (no auto-select / no default CEO); deterministic
   CEO-first enumeration; the selector change flow reaching identity/workspace/authz
   through the existing render facade; reload resets to null (ephemeral); no
   persistence key and no State.identity; and adapter isolation at runtime. No file
   is modified; no real data is used; all fixtures are fabricated.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

/* ---------- a small, faithful fake DOM (only what the selector code uses) ---------- */
function El(tag){
  const el = {
    tagName: String(tag||'div').toUpperCase(),
    _classes: new Set(), _attrs: {}, _listeners: {},
    children: [], parent: null, textContent: '', value: '',
    style: {}, dataset: {}, hidden: false, disabled: false
  };
  el.offsetParent = { real: true };
  el.classList = {
    add:(c)=>el._classes.add(c), remove:(c)=>el._classes.delete(c),
    contains:(c)=>el._classes.has(c),
    toggle:(c,on)=>{ const w=(on===undefined)?!el._classes.has(c):!!on; if(w) el._classes.add(c); else el._classes.delete(c); return w; }
  };
  el.setAttribute = (k,v)=>{ el._attrs[k]=String(v); if(k==='id') el.id=String(v); };
  el.getAttribute = (k)=> (k in el._attrs)?el._attrs[k]:null;
  el.hasAttribute = (k)=> k in el._attrs;
  el.removeAttribute = (k)=>{ delete el._attrs[k]; };
  el.appendChild = (c)=>{ c.parent=el; el.children.push(c); return c; };
  el.removeChild = (c)=>{ el.children=el.children.filter(x=>x!==c); return c; };
  el.replaceChild = (n,o)=>{ const i=el.children.indexOf(o); if(i>=0){ el.children[i]=n; n.parent=el; } return o; };
  el.insertAdjacentHTML = ()=>{};
  el.addEventListener = (t,fn)=>{ (el._listeners[t]=el._listeners[t]||[]).push(fn); };
  el.removeEventListener = (t,fn)=>{ el._listeners[t]=(el._listeners[t]||[]).filter(f=>f!==fn); };
  el.dispatchEvent = (evt)=>{ evt.target=evt.target||el; (el._listeners[evt.type]||[]).slice().forEach(fn=>fn(evt)); return true; };
  el.focus = ()=>{}; el.blur = ()=>{};
  el.contains = (n)=>{ for(let x=n; x; x=x.parent){ if(x===el) return true; } return false; };
  el.querySelector = (sel)=> qsa(el, sel)[0] || null;
  el.querySelectorAll = (sel)=> qsa(el, sel);
  Object.defineProperty(el,'className',{ get:()=>[...el._classes].join(' '), set:(v)=>{ el._classes=new Set(String(v).split(/\s+/).filter(Boolean)); } });
  Object.defineProperty(el,'parentNode',{ get:()=>el.parent });
  return el;
}
function descendants(root){ const out=[]; (function w(n){ n.children.forEach(c=>{ out.push(c); w(c); }); })(root); return out; }
function matchSimple(el, s){
  s=s.trim(); if(!s) return false;
  let ok=true; let sawSelector=false;
  const idm=s.match(/#([\w-]+)/); if(idm){ sawSelector=true; ok=ok&&(el.id===idm[1]); }
  const cls=s.match(/\.[\w-]+/g)||[]; cls.forEach(c=>{ sawSelector=true; ok=ok&&el._classes.has(c.slice(1)); });
  // attribute selectors: [attr] and [attr="val"] — match only when the attr is present/equal
  const attrs=s.match(/\[[^\]]+\]/g)||[]; attrs.forEach(a=>{
    sawSelector=true;
    const m=a.match(/^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/); if(!m){ ok=false; return; }
    if(m[2]===undefined) ok=ok&&el.hasAttribute(m[1]);
    else ok=ok&&(el.getAttribute(m[1])===m[2]);
  });
  const tagm=s.match(/^([a-z]+)(?:[.#\[]|$)/i);
  if(tagm){ sawSelector=true; ok=ok&&(el.tagName===tagm[1].toUpperCase()); }
  return sawSelector && ok;
}
function qsa(root, selector){
  const parts=selector.split(',').map(x=>x.trim());
  const pool=descendants(root); const set=new Set();
  parts.forEach(p=>{ pool.filter(e=>matchSimple(e,p)).forEach(e=>set.add(e)); });
  return [...set];
}

/* ---------- runtime loader (same technique as the UX-006A/B/C harnesses) ---------- */
function loadRuntime(){
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { State: State, PRINCIPAL_TYPES: PRINCIPAL_TYPES,'
    + ' LocalIdentityProvider: LocalIdentityProvider, getCurrentUser: getCurrentUser,'
    + ' getCurrentWorkspace: getCurrentWorkspace, getScopedRecords: getScopedRecords,'
    + ' can: can, ACTIONS: ACTIONS,'
    + ' renderIdentitySelectorHTML: renderIdentitySelectorHTML, bindIdentitySelector: bindIdentitySelector,'
    + ' syncIdentitySelector: syncIdentitySelector, identityAvailablePrincipals: identityAvailablePrincipals,'
    + ' onIdentityPrincipalChange: onIdentityPrincipalChange };';
  const noop = function(){};
  const memStore = {};
  const memStorage = {
    getItem:(k)=> Object.prototype.hasOwnProperty.call(memStore,k)?memStore[k]:null,
    setItem:(k,v)=>{ memStore[k]=String(v); },
    removeItem:(k)=>{ delete memStore[k]; }
  };
  // A shell tree containing #app and the mounted selector, so bind/sync operate on
  // real (fake) nodes. The selector markup is produced by the REAL renderIdentitySelectorHTML,
  // but we build the equivalent node graph here since the fake DOM does not parse HTML.
  const app = El('div'); app.setAttribute('id','app');
  const brand = El('div'); brand.classList.add('brand'); app.appendChild(brand);
  const sel = El('select'); sel.setAttribute('id','identityPrincipalSelect'); brand.appendChild(sel);
  const help = El('p'); help.setAttribute('id','identityPrincipalHelp'); brand.appendChild(help);
  const main = El('main'); main.setAttribute('id','main'); app.appendChild(main);
  const byId = { app: app, main: main, identityPrincipalSelect: sel, identityPrincipalHelp: help };
  const sandbox = {
    console:{ log:noop, warn:noop, error:noop }, navigator:{ userAgent:'tam-ux006d1' },
    setTimeout:setTimeout, clearTimeout:clearTimeout, requestAnimationFrame:(fn)=>setTimeout(fn,0),
    localStorage:memStorage, storage:undefined,
    addEventListener:noop, removeEventListener:noop, confirm:()=>true,
    matchMedia:()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document:{
      addEventListener:noop, removeEventListener:noop,
      getElementById:(id)=> byId[id] || null,
      querySelector:(s)=> app.querySelector(s), querySelectorAll:(s)=> app.querySelectorAll(s),
      createElement:(t)=>El(t), createComment:()=>El('#comment'),
      body:{ appendChild:noop }, documentElement:{ dataset:{} }
    }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename:'tam-ux006d1-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.memStore = memStore; rt.dom = { app, brand, sel, help };
  return rt;
}
function fresh(){ return loadRuntime(); }

(function main(){
  console.log('== UX-006D1 REACHABLE PRINCIPAL SELECTION — RUNTIME VERIFICATION ==');
  console.log('   fail-closed null / deterministic enumeration / selection reaches');
  console.log('   identity+workspace+authz / ephemeral (reload resets) / no persistence.');
  console.log('');

  /* ---------- 1. initial state: fail-closed null, no auto-select ---------- */
  const a = fresh();
  check(a.getCurrentUser() === null, 'initial: getCurrentUser() === null (no auto-select, no default CEO)');
  check(a.getCurrentWorkspace() === null, 'initial: no workspace resolves while unselected (fail-closed)');
  check(Object.keys(a.memStore).every(k => !/principal|identity|acting/i.test(k)),
    'initial: no principal/identity persistence key written at load');
  check(!('identity' in a.State), 'initial: no State.identity slice created');

  /* ---------- 2. enumeration: both principals, deterministic CEO-first ---------- */
  const e = fresh();
  const list = e.identityAvailablePrincipals();
  check(Array.isArray(list) && list.length === 2, 'enumeration: exactly two principals available');
  check(list[0] && list[0].principalType === 'ceo', 'enumeration: CEO is first (deterministic order)');
  check(list[1] && list[1].principalType === 'employee', 'enumeration: Employee is second');
  check(list.some(p=>p.displayName==='Executive (CEO)') && list.some(p=>p.displayName==='Employee (Sample)'),
    'enumeration: fixture displayName labels used verbatim');

  /* ---------- 3. rendered markup: placeholder + no-auth wording ---------- */
  const h = fresh();
  const html = h.renderIdentitySelectorHTML();
  check(/Acting as/.test(html), 'markup: "Acting as" label present');
  check(/— Select principal —/.test(html), 'markup: non-value placeholder option present');
  check(/No principal selected/.test(html), 'markup: unselected helper present while null');
  check(/aria-describedby="identityPrincipalHelp"/.test(html), 'markup: select is aria-describedby its helper');
  check(!/\b(login|log in|sign[- ]?in|password|oauth|session|credential|authenticate|authentication)\b/i.test(html),
    'markup: no authentication/session/login vocabulary in the rendered surface');

  /* ---------- 4. CEO selection flow reaches identity + workspace + authz ---------- */
  const c = fresh();
  c.onIdentityPrincipalChange('user_ceo_fixture');   // the exact call the change listener makes
  const cu = c.getCurrentUser();
  check(!!cu && cu.principalType === 'ceo', 'CEO: selection resolves getCurrentUser() to CEO');
  const cw = c.getCurrentWorkspace();
  check(!!cw && cw.type === 'executive' && cw.scope === 'ALL_COMPANY', 'CEO: workspace Executive / ALL_COMPANY');
  check(c.can(c.ACTIONS.EMPLOYEE_CREATE) === true, 'CEO: authz current-context allows a company mutation (employee.create)');
  check(c.dom.help.textContent === 'Acting as Executive (CEO).', 'CEO: acting-as indicator synced after render');
  check(c.dom.sel.value === 'user_ceo_fixture', 'CEO: select value synced to the chosen principal');

  /* ---------- 5. Employee selection flow: identity + fail-closed workspace + authz deny ---------- */
  const em = fresh();
  em.onIdentityPrincipalChange('user_employee_fixture');
  const eu = em.getCurrentUser();
  check(!!eu && eu.principalType === 'employee', 'Employee: selection resolves getCurrentUser() to Employee');
  // No bound Employee record exists (empty State) -> workspace fail-closed to null,
  // NEVER ALL_COMPANY. Employee-specific identity path is reachable regardless.
  check(em.getCurrentWorkspace() === null, 'Employee: unbound linkage -> no workspace (fail-closed, never ALL_COMPANY)');
  check(em.can(em.ACTIONS.EMPLOYEE_CREATE) === false, 'Employee: authz denies a company mutation (deny-by-default)');
  check(em.dom.help.textContent === 'Acting as Employee (Sample).', 'Employee: acting-as indicator synced');

  /* ---------- 5b. Employee SELF workspace when linkage resolves ---------- */
  const es = fresh();
  es.State.employees = [{ id:'emp_fixture_self', fullName:'Sample', employeeId:'E-001' }];
  es.onIdentityPrincipalChange('user_employee_fixture');
  const esw = es.getCurrentWorkspace();
  check(!!esw && esw.type === 'personal' && esw.scope === 'SELF', 'Employee: bound linkage -> Personal / SELF workspace');

  /* ---------- 6. ephemerality: a fresh module load is null again ---------- */
  const r1 = fresh();
  r1.onIdentityPrincipalChange('user_ceo_fixture');
  check(!!r1.getCurrentUser(), 'ephemeral: principal selected within a session');
  check(Object.keys(r1.memStore).every(k => !/principal|identity|acting/i.test(k)),
    'ephemeral: selection wrote NO persistence key');
  const r2 = fresh();  // simulates a reload (fresh module scope)
  check(r2.getCurrentUser() === null, 'ephemeral: a fresh load resets to null (selection not retained)');

  /* ---------- 7. no-op safety: empty / unknown id never fabricates a principal ---------- */
  const n = fresh();
  n.onIdentityPrincipalChange('');            // the placeholder value
  check(n.getCurrentUser() === null, 'safety: empty (placeholder) id leaves currentUser null');
  n.onIdentityPrincipalChange('nope_unknown');
  check(n.getCurrentUser() === null, 'safety: unknown id is a no-op miss (never a privileged fallback)');

  /* ---------- 8. adapter isolation (runtime): selector holds the only live calls ---------- */
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root,'tools','module-order.js'));
  const offenders = jsFiles.filter(function(f){
    if(f === 'core/identity.js' || f === 'ui/identity-selector.js') return false;
    const s = fs.readFileSync(path.join(root,'js',f),'utf8');
    return /getAvailablePrincipals|selectPrincipal/.test(s);
  });
  check(offenders.length === 0, 'adapter isolation: no module besides identity.js + identity-selector.js references the local-only selection API' + (offenders.length?(' >> '+offenders.join(', ')):''));

  /* ---------- summary ---------- */
  console.log('');
  if(failures.length){
    console.log('UX-006D1 REACHABLE PRINCIPAL SELECTION RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f=>console.log('  - ' + f));
    process.exit(1);
  }
  console.log('UX-006D1 REACHABLE PRINCIPAL SELECTION RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
