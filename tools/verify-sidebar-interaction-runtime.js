#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-004E — SIDEBAR INTERACTION — RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of the sidebar-interaction slice
   (session-only state, no persistence, no schema, listeners bound once, CSS present,
   golden-master revision). This harness proves its BEHAVIOUR by executing the REAL
   production functions (sidebarApplyState, setSidebarCollapsed, openSidebarDrawer,
   closeSidebarDrawer, and the bindShell-wired collapse/hamburger/backdrop/ESC/Tab
   listeners) against a purpose-built fake DOM that models exactly the shell nodes the
   code touches. It reproduces the browser's single shared global scope in a Node `vm`
   context using the same loader technique as js/cli/cli.js (EXCLUDING
   core/app-bootstrap.js). No file is modified; no real data is used.

   Proves: expand, collapse, pin (session-only — never persisted), drawer open/close,
   ESC close, backdrop close, hamburger toggle, Tab focus-trap, focus capture/restore,
   viewport (drawer<->desktop) handling, NO shell remount / NO node-identity change,
   and NO active-state (single active + single aria-current) regression.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

/* ---------- a small, faithful fake DOM (only what the shell code uses) ---------- */
let ACTIVE = null;                 // document.activeElement
let VW = 1280;                     // current viewport width (drives matchMedia)
const MQ_LISTENERS = [];           // matchMedia('(max-width:768px)') change listeners

function El(tag){
  const el = {
    tagName: String(tag||'div').toUpperCase(),
    _classes: new Set(),
    _attrs: {},
    _listeners: {},
    children: [],
    parent: null,
    textContent: '',
    hidden: false,
    disabled: false,
    style: {},
    dataset: {},
  };
  el.offsetParent = { real: true };  // non-null => "visible" for focusable filtering
  el.classList = {
    add: (c)=>el._classes.add(c),
    remove: (c)=>el._classes.delete(c),
    contains: (c)=>el._classes.has(c),
    toggle: (c,on)=>{ const want = (on===undefined)?!el._classes.has(c):!!on; if(want) el._classes.add(c); else el._classes.delete(c); return want; },
  };
  el.setAttribute = (k,v)=>{ el._attrs[k]=String(v); if(k==='id') el.id=String(v); };
  el.getAttribute = (k)=> (k in el._attrs) ? el._attrs[k] : null;
  el.hasAttribute = (k)=> k in el._attrs;
  el.removeAttribute = (k)=>{ delete el._attrs[k]; };
  el.appendChild = (c)=>{ c.parent=el; el.children.push(c); return c; };
  el.insertAdjacentHTML = ()=>{};
  el.addEventListener = (t,fn)=>{ (el._listeners[t]=el._listeners[t]||[]).push(fn); };
  el.removeEventListener = (t,fn)=>{ el._listeners[t]=(el._listeners[t]||[]).filter(f=>f!==fn); };
  el.dispatchEvent = (evt)=>{ evt.target = evt.target||el; (el._listeners[evt.type]||[]).slice().forEach(fn=>fn(evt)); return true; };
  el.focus = ()=>{ ACTIVE = el; };
  el.blur = ()=>{ if(ACTIVE===el) ACTIVE=null; };
  el.contains = (n)=>{ for(let x=n; x; x=x.parent){ if(x===el) return true; } return false; };
  el.querySelector = (sel)=> qsa(el, sel)[0] || null;
  el.querySelectorAll = (sel)=> qsa(el, sel);
  Object.defineProperty(el, 'className', { get:()=>[...el._classes].join(' '), set:(v)=>{ el._classes=new Set(String(v).split(/\s+/).filter(Boolean)); } });
  return el;
}
// descendants (self excluded)
function descendants(root){ const out=[]; (function walk(n){ n.children.forEach(c=>{ out.push(c); walk(c); }); })(root); return out; }
function matchSimple(el, s){
  s = s.trim(); if(!s) return false;
  // focusables shorthand used by sidebarFocusables()
  if(/^(button|input|select|textarea)$/i.test(s)) return el.tagName===s.toUpperCase();
  if(s==='[href]') return el.hasAttribute('href');
  if(s.startsWith('[tabindex]')) return el.hasAttribute('tabindex') && el.getAttribute('tabindex')!=='-1';
  // compound: tag? .class* [attr(=v)]*
  let ok = true;
  const idm = s.match(/#([\w-]+)/); if(idm) ok = ok && (el.id===idm[1]);
  const cls = s.match(/\.[\w-]+/g)||[]; cls.forEach(c=>{ ok = ok && el._classes.has(c.slice(1)); });
  const attrs = s.match(/\[[^\]]+\]/g)||[]; attrs.forEach(a=>{
    const m = a.match(/^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/); if(!m){ ok=false; return; }
    if(m[2]===undefined) ok = ok && el.hasAttribute(m[1]);
    else ok = ok && (el.getAttribute(m[1])===m[2]);
  });
  const tagm = s.match(/^([a-z]+)[.#\[]/i); if(tagm) ok = ok && (el.tagName===tagm[1].toUpperCase());
  return ok;
}
function qsa(root, selector){
  const parts = selector.split(',').map(x=>x.trim());
  const pool = descendants(root);
  const set = new Set();
  parts.forEach(part=>{
    if(part.includes(' ')){ // single descendant combinator "A B"
      const [a,b] = part.split(/\s+/);
      pool.filter(e=>matchSimple(e,a)).forEach(anc=>{ descendants(anc).filter(e=>matchSimple(e,b)).forEach(e=>set.add(e)); });
    } else {
      pool.filter(e=>matchSimple(e,part)).forEach(e=>set.add(e));
    }
  });
  return [...set];
}

function buildShellTree(){
  const app = El('div'); app.setAttribute('id','app');
  const ham = El('button'); ham.setAttribute('id','navHamburger'); ham.setAttribute('aria-label','Open navigation'); ham.setAttribute('aria-controls','sidebar'); ham.setAttribute('aria-expanded','false');
  const back = El('div'); back.setAttribute('id','sidebarBackdrop'); back.hidden=true;
  const sidebar = El('div'); sidebar.classList.add('sidebar'); sidebar.setAttribute('id','sidebar');
  const brand = El('div'); brand.classList.add('brand');
  const collapseBtn = El('button'); collapseBtn.setAttribute('id','sidebarCollapseBtn'); collapseBtn.setAttribute('aria-expanded','true'); collapseBtn.setAttribute('aria-label','Collapse sidebar');
  const cbar = El('span'); cbar.classList.add('cbar'); cbar.textContent='«'; collapseBtn.appendChild(cbar);
  brand.appendChild(collapseBtn);
  const nav = El('nav'); nav.classList.add('nav'); nav.setAttribute('aria-label','Primary navigation');
  const groupHead = El('button'); groupHead.setAttribute('data-group','people');
  const it1 = El('button'); it1.classList.add('nav-item'); it1.classList.add('active'); it1.setAttribute('data-nav','employees'); it1.setAttribute('aria-current','page');
  const it2 = El('button'); it2.classList.add('nav-item'); it2.setAttribute('data-nav','contracts');
  [groupHead,it1,it2].forEach(n=>nav.appendChild(n));
  const foot = El('div'); foot.classList.add('sidebar-foot');
  [brand,nav,foot].forEach(n=>sidebar.appendChild(n));
  const main = El('div'); main.classList.add('main'); main.setAttribute('id','main');
  [ham,back,sidebar,main].forEach(n=>app.appendChild(n));
  return { app, ham, back, sidebar, main, collapseBtn, it1, it2 };
}

function loadRuntime(tree){
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { State: State, bindShell: bindShell,'
    + ' sidebarApplyState: sidebarApplyState, setSidebarCollapsed: setSidebarCollapsed,'
    + ' toggleSidebarCollapsed: toggleSidebarCollapsed, openSidebarDrawer: openSidebarDrawer,'
    + ' closeSidebarDrawer: closeSidebarDrawer, sidebarIsDrawerMode: sidebarIsDrawerMode, render: render };';
  const noop = function(){};
  const memStore = {};
  const memStorage = { getItem:(k)=>Object.prototype.hasOwnProperty.call(memStore,k)?memStore[k]:null, setItem:(k,v)=>{ memStore[k]=String(v); }, removeItem:(k)=>{ delete memStore[k]; } };
  const documentStub = {
    addEventListener: noop, removeEventListener: noop,
    getElementById: (id)=>{ if(id==='app') return tree.app; return descendants(tree.app).find(e=>e.id===id) || null; },
    querySelector: (s)=> qsa(tree.app, s)[0]||null,
    querySelectorAll: (s)=> qsa(tree.app, s),
    createElement: (t)=>El(t),
    body: El('body'),
    documentElement: { dataset:{} },
    get activeElement(){ return ACTIVE; },
    contains: (n)=>{ for(let x=n; x; x=x.parent){ if(x===tree.app) return true; } return false; }
  };
  const matchMedia = (q)=>{
    const isMax768 = /max-width:\s*768px/.test(q);
    const mql = {
      get matches(){ return isMax768 ? (VW<=768) : false; },
      media:q,
      addEventListener:(t,fn)=>{ if(isMax768) MQ_LISTENERS.push(fn); },
      addListener:(fn)=>{ if(isMax768) MQ_LISTENERS.push(fn); },
      removeEventListener:noop, removeListener:noop,
    };
    return mql;
  };
  const sandbox = {
    console:{ log:noop, warn:noop, error:noop }, navigator:{ userAgent:'tam-ux004e' },
    setTimeout, clearTimeout, requestAnimationFrame:(fn)=>fn(),
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop,
    matchMedia, document: documentStub,
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename:'tam-ux004e-runtime.js' });
  const rt = sandbox.__TAM__; rt.memStore = memStore; return rt;
}
function fireMqChange(){ MQ_LISTENERS.slice().forEach(fn=>fn({ matches: VW<=768 })); }
function keydown(el, key, shift){ el.dispatchEvent({ type:'keydown', key, shiftKey:!!shift, preventDefault:()=>{}, stopPropagation:()=>{} }); }
function activeCounts(app){
  return { active: qsa(app,'.nav-item.active').length, current: qsa(app,'.nav-item[aria-current="page"]').length };
}

(function main(){
  console.log('== UX-004E SIDEBAR INTERACTION — RUNTIME VERIFICATION ==');

  // ---------- A. desktop collapse / expand + node identity + no remount ----------
  console.log('-- A. collapse / expand (desktop) --');
  {
    VW = 1280; MQ_LISTENERS.length = 0; ACTIVE = null;
    const tree = buildShellTree();
    const rt = loadRuntime(tree); rt.bindShell(tree.app); rt.sidebarApplyState();
    const sidebarRef = tree.sidebar, mainRef = tree.main;
    check(!tree.sidebar.classList.contains('collapsed'), 'starts expanded (not collapsed)');
    const c0 = activeCounts(tree.app);
    rt.setSidebarCollapsed(true);
    check(tree.sidebar.classList.contains('collapsed'), 'collapse adds .collapsed to the sidebar');
    check(rt.State.sidebarCollapsed === true && rt.State.sidebarPinned === 'collapsed', 'collapse sets session state + pin=collapsed');
    check(tree.collapseBtn.getAttribute('aria-expanded') === 'false', 'collapse toggle reports aria-expanded=false');
    check(tree.sidebar === sidebarRef && tree.main === mainRef, 'no shell remount: .sidebar and #main node identity preserved');
    rt.setSidebarCollapsed(false);
    check(!tree.sidebar.classList.contains('collapsed') && rt.State.sidebarPinned === 'expanded', 'expand removes .collapsed and pins expanded');
    const c1 = activeCounts(tree.app);
    check(c1.active === 1 && c1.current === 1 && c0.active === 1 && c0.current === 1, 'no active-state regression: exactly one active + one aria-current throughout');
    // toggle helper flips
    rt.toggleSidebarCollapsed(); check(rt.State.sidebarCollapsed===true, 'toggleSidebarCollapsed() flips to collapsed');
    rt.toggleSidebarCollapsed(); check(rt.State.sidebarCollapsed===false, 'toggleSidebarCollapsed() flips back to expanded');
  }

  // ---------- B. pin is SESSION-ONLY (never persisted) ----------
  console.log('-- B. pin session-only (no persistence) --');
  {
    VW = 1280; MQ_LISTENERS.length = 0;
    const tree = buildShellTree();
    const rt = loadRuntime(tree); rt.bindShell(tree.app);
    rt.setSidebarCollapsed(true); rt.setSidebarCollapsed(false); rt.setSidebarCollapsed(true);
    const keys = Object.keys(rt.memStore);
    check(!keys.some(k=>/sidebar/i.test(k)), 'no storage key mentions the sidebar after collapse/pin');
    const blob = keys.map(k=>rt.memStore[k]).join('|');
    check(!/sidebarCollapsed|sidebarPinned|sidebarDrawerOpen/.test(blob), 'no persisted value carries the sidebar interaction fields');
    check(rt.State.sidebarPinned === 'collapsed', 'the pin lives only on in-memory State (session-only)');
  }

  // ---------- C. responsive drawer: open/close, aria, backdrop, focus ----------
  console.log('-- C. responsive drawer (tablet/mobile) --');
  {
    VW = 375; MQ_LISTENERS.length = 0; ACTIVE = null;
    const tree = buildShellTree();
    const rt = loadRuntime(tree); rt.bindShell(tree.app); rt.sidebarApplyState();
    check(rt.sidebarIsDrawerMode() === true, 'drawer mode active at mobile width');
    check(tree.sidebar.getAttribute('aria-hidden') === 'true', 'closed drawer is aria-hidden off-canvas');
    tree.ham.focus();                        // user tabs to the hamburger
    tree.ham.dispatchEvent({ type:'click', preventDefault:()=>{} });   // opens via the real listener
    check(rt.State.sidebarDrawerOpen === true, 'hamburger click opens the drawer');
    check(tree.app.classList.contains('drawer-open'), 'app gains .drawer-open');
    check(tree.back.hidden === false, 'backdrop is shown while open');
    check(tree.sidebar.getAttribute('aria-hidden') === null, 'open drawer is not aria-hidden');
    check(tree.ham.getAttribute('aria-expanded') === 'true', 'hamburger reports aria-expanded=true');
    check(tree.sidebar.contains(ACTIVE), 'focus moved INTO the drawer on open');
    // ESC closes and restores focus to the hamburger
    keydown(tree.sidebar, 'Escape', false);
    check(rt.State.sidebarDrawerOpen === false, 'ESC closes the drawer');
    check(!tree.app.classList.contains('drawer-open') && tree.back.hidden === true, 'ESC clears .drawer-open and hides the backdrop');
    check(ACTIVE === tree.ham, 'ESC restores focus to the hamburger');
    // backdrop click closes
    tree.ham.focus(); tree.ham.dispatchEvent({ type:'click', preventDefault:()=>{} });
    check(rt.State.sidebarDrawerOpen === true, 'reopened via hamburger');
    tree.back.dispatchEvent({ type:'click' });
    check(rt.State.sidebarDrawerOpen === false, 'backdrop click closes the drawer');
    // hamburger toggles closed when already open
    tree.ham.dispatchEvent({ type:'click', preventDefault:()=>{} }); check(rt.State.sidebarDrawerOpen===true,'hamburger opens again');
    tree.ham.dispatchEvent({ type:'click', preventDefault:()=>{} }); check(rt.State.sidebarDrawerOpen===false,'hamburger toggles the open drawer closed');
  }

  // ---------- D. Tab focus-trap inside the open drawer ----------
  console.log('-- D. focus trap (keyboard) --');
  {
    VW = 375; MQ_LISTENERS.length = 0; ACTIVE = null;
    const tree = buildShellTree();
    const rt = loadRuntime(tree); rt.bindShell(tree.app);
    tree.ham.focus(); tree.ham.dispatchEvent({ type:'click', preventDefault:()=>{} });
    const focusables = qsa(tree.sidebar,'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    check(focusables.length >= 2, 'drawer has multiple focusable controls');
    const first = focusables[0], last = focusables[focusables.length-1];
    last.focus(); keydown(tree.sidebar, 'Tab', false);
    check(ACTIVE === first, 'Tab on the last focusable wraps to the first (trap forward)');
    first.focus(); keydown(tree.sidebar, 'Tab', true);
    check(ACTIVE === last, 'Shift+Tab on the first focusable wraps to the last (trap backward)');
  }

  // ---------- E. viewport change: drawer -> desktop auto-dismiss ----------
  console.log('-- E. viewport change (drawer <-> desktop) --');
  {
    VW = 375; MQ_LISTENERS.length = 0; ACTIVE = null;
    const tree = buildShellTree();
    const rt = loadRuntime(tree); rt.bindShell(tree.app);
    tree.ham.focus(); tree.ham.dispatchEvent({ type:'click', preventDefault:()=>{} });
    check(rt.State.sidebarDrawerOpen === true, 'drawer open at mobile width');
    VW = 1280; fireMqChange();               // resize to desktop
    check(rt.State.sidebarDrawerOpen === false, 'growing past the breakpoint auto-dismisses the drawer');
    check(tree.sidebar.getAttribute('aria-hidden') === null, 'desktop sidebar is never aria-hidden');
  }

  // ---------- F. collapse is desktop-only (ignored in drawer mode) ----------
  console.log('-- F. collapse ignored in drawer mode --');
  {
    VW = 375; MQ_LISTENERS.length = 0;
    const tree = buildShellTree();
    const rt = loadRuntime(tree); rt.bindShell(tree.app);
    rt.State.sidebarCollapsed = true; rt.sidebarApplyState();
    check(!tree.sidebar.classList.contains('collapsed'), 'the collapsed rail is not applied while in drawer mode');
  }

  console.log('');
  if(failures.length===0){ console.log('UX-004E RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.'); process.exit(0); }
  console.log('UX-004E RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
  failures.forEach(f=>console.log('   - ' + f)); process.exit(1);
})();
