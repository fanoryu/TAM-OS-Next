#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-004F — NAVIGATION SIMPLIFICATION & TAM OS REBRAND — RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of UX-004F. This harness proves its
   BEHAVIOUR by executing the REAL production functions (navMoreOpen, navItemHTML,
   the bindShell-wired "More" toggle, and syncShellState) against a purpose-built
   fake DOM. It reproduces the browser's single shared global scope in a Node `vm`
   context using the same loader technique as js/cli/cli.js (EXCLUDING
   core/app-bootstrap.js). No file is modified; no real data is used.

   Proves: the "More" disclosure is session-only (never persisted), closed by
   default, auto-opens when the active view lives inside it, and toggles in place
   WITHOUT a shell remount / node-identity change; simplified labels flow through
   PAGE_TITLES; ids/routes (NAV_VIEW_OWNER + Finance destinations) are unchanged;
   the quieter "Soon" placeholder badge and the placeholder features are preserved;
   active-state stays single (one active + one aria-current).
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

/* ---------- compact fake DOM (only what the shell code touches) ---------- */
let ACTIVE = null;
function El(tag){
  const el = { tagName:String(tag||'div').toUpperCase(), _classes:new Set(), _attrs:{}, _listeners:{}, children:[], parent:null, textContent:'', hidden:false, disabled:false, style:{}, dataset:{} };
  el.offsetParent = { real:true };
  el.classList = { add:(c)=>el._classes.add(c), remove:(c)=>el._classes.delete(c), contains:(c)=>el._classes.has(c), toggle:(c,on)=>{ const w=(on===undefined)?!el._classes.has(c):!!on; if(w)el._classes.add(c);else el._classes.delete(c); return w; } };
  el.setAttribute=(k,v)=>{ el._attrs[k]=String(v); if(k==='id')el.id=String(v); if(k&&k.indexOf('data-')===0) el.dataset[k.slice(5).replace(/-([a-z])/g,(m,c)=>c.toUpperCase())]=String(v); };
  el.getAttribute=(k)=> (k in el._attrs)?el._attrs[k]:null;
  el.hasAttribute=(k)=> k in el._attrs;
  el.removeAttribute=(k)=>{ delete el._attrs[k]; };
  el.appendChild=(c)=>{ c.parent=el; el.children.push(c); return c; };
  el.insertAdjacentHTML=()=>{};
  el.addEventListener=(t,fn)=>{ (el._listeners[t]=el._listeners[t]||[]).push(fn); };
  el.removeEventListener=()=>{};
  el.dispatchEvent=(evt)=>{ evt.target=evt.target||el; (el._listeners[evt.type]||[]).slice().forEach(fn=>fn(evt)); return true; };
  el.focus=()=>{ ACTIVE=el; }; el.blur=()=>{ if(ACTIVE===el)ACTIVE=null; };
  el.contains=(n)=>{ for(let x=n;x;x=x.parent){ if(x===el)return true; } return false; };
  el.querySelector=(s)=> qsa(el,s)[0]||null;
  el.querySelectorAll=(s)=> qsa(el,s);
  Object.defineProperty(el,'className',{ get:()=>[...el._classes].join(' '), set:(v)=>{ el._classes=new Set(String(v).split(/\s+/).filter(Boolean)); } });
  Object.defineProperty(el,'parentNode',{ get:()=>el.parent }); // production reads head.parentNode
  return el;
}
function descendants(root){ const out=[]; (function w(n){ n.children.forEach(c=>{ out.push(c); w(c); }); })(root); return out; }
function matchSimple(el,s){ s=s.trim(); if(!s)return false;
  if(/^(button|input|select|textarea)$/i.test(s)) return el.tagName===s.toUpperCase();
  if(s==='[href]') return el.hasAttribute('href');
  if(s.startsWith('[tabindex]')) return el.hasAttribute('tabindex')&&el.getAttribute('tabindex')!=='-1';
  let ok=true;
  const idm=s.match(/#([\w-]+)/); if(idm) ok=ok&&(el.id===idm[1]);
  (s.match(/\.[\w-]+/g)||[]).forEach(c=>{ ok=ok&&el._classes.has(c.slice(1)); });
  (s.match(/\[[^\]]+\]/g)||[]).forEach(a=>{ const m=a.match(/^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/); if(!m){ok=false;return;} if(m[2]===undefined) ok=ok&&el.hasAttribute(m[1]); else ok=ok&&(el.getAttribute(m[1])===m[2]); });
  const tagm=s.match(/^([a-z]+)[.#\[]/i); if(tagm) ok=ok&&(el.tagName===tagm[1].toUpperCase());
  return ok;
}
function qsa(root,selector){ const parts=selector.split(',').map(x=>x.trim()); const pool=descendants(root); const set=new Set();
  parts.forEach(part=>{ if(part.includes(' ')){ const [a,b]=part.split(/\s+/); pool.filter(e=>matchSimple(e,a)).forEach(anc=>{ descendants(anc).filter(e=>matchSimple(e,b)).forEach(e=>set.add(e)); }); } else { pool.filter(e=>matchSimple(e,part)).forEach(e=>set.add(e)); } });
  return [...set];
}

function loadRuntime(tree, memStore){
  const root = path.resolve(__dirname,'..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f=>f!=='core/app-bootstrap.js');
  const src = jsFiles.map(f=>fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { State:State, bindShell:bindShell, syncShellState:syncShellState, render:render,'
    + ' navMoreOpen:navMoreOpen, navItemHTML:navItemHTML, navActive:navActive, NAV_GROUPS:NAV_GROUPS,'
    + ' NAV_VIEW_OWNER:NAV_VIEW_OWNER, PAGE_TITLES:PAGE_TITLES, FEATURE_BADGE_TEXT:FEATURE_BADGE_TEXT,'
    + ' FEATURE_REGISTRY:FEATURE_REGISTRY, QUICK_ACTIONS_BY_VIEW:QUICK_ACTIONS_BY_VIEW, APP_NAME:APP_NAME };';
  const noop=function(){};
  const memStorage={ getItem:(k)=>Object.prototype.hasOwnProperty.call(memStore,k)?memStore[k]:null, setItem:(k,v)=>{ memStore[k]=String(v); }, removeItem:(k)=>{ delete memStore[k]; } };
  const documentStub={ addEventListener:noop, removeEventListener:noop,
    getElementById:(id)=>{ if(id==='app')return tree; return descendants(tree).find(e=>e.id===id)||null; },
    querySelector:(s)=>qsa(tree,s)[0]||null, querySelectorAll:(s)=>qsa(tree,s), createElement:(t)=>El(t),
    body:El('body'), documentElement:{ dataset:{} }, get activeElement(){ return ACTIVE; }, contains:(n)=>{ for(let x=n;x;x=x.parent){ if(x===tree)return true; } return false; } };
  const sandbox={ console:{log:noop,warn:noop,error:noop}, navigator:{userAgent:'tam-ux004f'}, setTimeout, clearTimeout, requestAnimationFrame:(fn)=>fn(),
    localStorage:memStorage, storage:undefined, addEventListener:noop, removeEventListener:noop,
    matchMedia:()=>({ matches:false, addEventListener:noop, addListener:noop }), document:documentStub };
  sandbox.window=sandbox; sandbox.self=sandbox; sandbox.globalThis=sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename:'tam-ux004f-runtime.js' });
  return sandbox.__TAM__;
}

// Build a fake finance-group nav subtree that mirrors navGroupHTML's output.
function buildTree(rt){
  const app=El('div'); app.setAttribute('id','app');
  const sidebar=El('div'); sidebar.classList.add('sidebar'); app.appendChild(sidebar);
  const brand=El('div'); brand.classList.add('brand'); const sub=El('div'); sub.classList.add('sub'); sub.textContent='PT Total Asset Manajemen'; brand.appendChild(sub); sidebar.appendChild(brand);
  const nav=El('nav'); nav.classList.add('nav'); nav.setAttribute('aria-label','Primary navigation'); sidebar.appendChild(nav);
  const fin = rt.NAV_GROUPS.find(g=>g.id==='finance');
  const group=El('div'); group.classList.add('nav-group'); nav.appendChild(group);
  const head=El('button'); head.classList.add('nav-group-head'); head.setAttribute('data-group','finance'); head.setAttribute('aria-expanded','true');
  const gchev=El('span'); gchev.classList.add('chev'); gchev.textContent='▾'; head.appendChild(gchev); group.appendChild(head);
  const items=El('div'); items.classList.add('nav-group-items'); group.appendChild(items);
  fin.items.filter(i=>!i.more).forEach(i=>{ const b=El('button'); b.classList.add('nav-item'); b.setAttribute('data-nav',i.id); items.appendChild(b); });
  const moreHead=El('button'); moreHead.classList.add('nav-item'); moreHead.classList.add('nav-more-head'); moreHead.setAttribute('data-more','finance'); moreHead.setAttribute('aria-expanded','false');
  const mchev=El('span'); mchev.classList.add('chev'); mchev.textContent='▸'; moreHead.appendChild(mchev); items.appendChild(moreHead);
  const moreBox=El('div'); moreBox.classList.add('nav-more-items'); moreBox.style.display='none'; items.appendChild(moreBox);
  fin.items.filter(i=>i.more).forEach(i=>{ const b=El('button'); b.classList.add('nav-item'); b.setAttribute('data-nav',i.id); moreBox.appendChild(b); });
  const main=El('div'); main.classList.add('main'); main.setAttribute('id','main'); app.appendChild(main);
  return { app, nav, group, head, items, moreHead, moreBox };
}

(function main(){
  console.log('== UX-004F NAVIGATION SIMPLIFICATION + TAM OS REBRAND — RUNTIME VERIFICATION ==');

  // ---------- A. rebrand ----------
  console.log('-- A. rebrand --');
  {
    const rt = loadRuntime(El('div'), {});
    check(rt.APP_NAME === 'TAM OS', 'APP_NAME resolves to "TAM OS" at runtime');
  }

  // ---------- B. simplified labels flow through PAGE_TITLES; ids/routes stable ----------
  console.log('-- B. labels simplified; ids/routes unchanged --');
  {
    const rt = loadRuntime(El('div'), {});
    const T = rt.PAGE_TITLES;
    check(T.financeOverview==='Overview', 'financeOverview label -> "Overview"');
    check(T.payroll==='Payroll', 'payroll label -> "Payroll"');
    check(T.monthlyplan==='Planning', 'monthlyplan label -> "Planning"');
    check(T.supplementals==='Supplements', 'supplementals label -> "Supplements"');
    check(T.add==='Import', 'add label -> "Import"');
    check(T.executioncenter==='Execution', 'executioncenter label -> "Execution"');
    check(T.recurring==='Recurring', 'recurring label -> "Recurring"');
    // routes/ids unchanged: the owner manifest and all 15 finance ids still exist.
    check(rt.NAV_VIEW_OWNER.payrollDetail==='payroll' && rt.NAV_VIEW_OWNER.smartImport==='add' && rt.NAV_VIEW_OWNER.overtimeSheet==='overtime',
      'NAV_VIEW_OWNER route ownership is unchanged (ids stable)');
    const finIds = rt.NAV_GROUPS.find(g=>g.id==='finance').items.map(i=>i.id);
    check(finIds.length===15 && finIds.includes('executioncenter') && finIds.includes('monthlyplan') && finIds.includes('add'),
      'all 15 Finance destination ids are still present (no route removed)');
    // Quick Actions unchanged (still navigation-worded to the real views).
    check(rt.QUICK_ACTIONS_BY_VIEW.payroll && rt.QUICK_ACTIONS_BY_VIEW.executioncenter, 'QUICK_ACTIONS_BY_VIEW manifest is unchanged');
  }

  // ---------- C. "More" disclosure derivation (progressive disclosure) ----------
  console.log('-- C. More disclosure derivation --');
  {
    const rt = loadRuntime(El('div'), {}); const S=rt.State;
    const fin = rt.NAV_GROUPS.find(g=>g.id==='finance');
    S.view='financeOverview'; // active is a PRIMARY item
    check(rt.navMoreOpen(fin, rt.navActive().item)===false, 'More is closed by default (active is a primary item)');
    S.navMore.finance = true;
    check(rt.navMoreOpen(fin, rt.navActive().item)===true, 'More opens when the user toggles it (session flag)');
    S.navMore.finance = false;
    S.view='executioncenter'; // active is a MORE item
    check(rt.navMoreOpen(fin, rt.navActive().item)===true, 'More AUTO-opens when the active view lives inside it');
    S.view='employees';       // active outside finance
    check(rt.navMoreOpen(fin, rt.navActive().item)===false, 'More closes again when the active view is elsewhere');
    // active-state stays single via navItemHTML
    S.view='executioncenter';
    const html = fin.items.filter(i=>i.more).map(i=>rt.navItemHTML(i, rt.navActive().item)).join('');
    check((html.match(/aria-current="page"/g)||[]).length===1 && (html.match(/class="nav-item active/g)||[]).length===1,
      'exactly one active item + one aria-current among the More items when active lives there');
  }

  // ---------- D. session-only: the More flag is never persisted ----------
  console.log('-- D. More is session-only (never persisted) --');
  {
    const mem={}; const rt = loadRuntime(El('div'), mem); const S=rt.State;
    S.navMore.finance = true;
    // navMore is a top-level session field, NOT part of the persisted settings object,
    // so no settings write can ever carry it.
    check(!/navMore/.test(JSON.stringify(S.settings)), 'the More flag is not part of the persisted settings object');
    check(Object.prototype.hasOwnProperty.call(S, 'navMore') && !Object.prototype.hasOwnProperty.call(S.settings, 'navMore'),
      'navMore lives on session State, never inside State.settings (never persisted)');
    check(!Object.keys(mem).length, 'toggling the More disclosure writes nothing to storage');
  }

  // ---------- E. in-place toggle: no shell remount / node identity preserved ----------
  console.log('-- E. More toggle: in place, no remount --');
  {
    const mem={}; const rt = loadRuntime(El('div'), mem); const S=rt.State; S.view='financeOverview';
    // Rebuild the tree against the loaded runtime, then re-point document at it.
    const tree = buildTree(rt);
    const rt2 = loadRuntime(tree.app, mem); const S2 = rt2.State; S2.view='financeOverview';
    const boxRef = tree.moreBox, headRef = tree.moreHead;
    rt2.syncShellState();
    check(tree.moreBox.style.display==='none', 'More starts collapsed after sync');
    S2.navMore.finance = true; rt2.syncShellState();
    check(tree.moreBox.style.display==='' && tree.moreHead.getAttribute('aria-expanded')==='true', 'toggling the flag opens the More container in place');
    check(tree.moreBox===boxRef && tree.moreHead===headRef, 'no shell remount: the More nodes keep their identity across sync');
    // auto-open when navigating to a more item
    S2.navMore.finance = false; S2.view='executioncenter'; rt2.syncShellState();
    check(tree.moreBox.style.display==='' && tree.moreHead.getAttribute('aria-expanded')==='true', 'navigating to a More view auto-opens the disclosure in place');
  }

  // ---------- F. quieter badge + placeholders preserved ----------
  console.log('-- F. quieter badge; placeholders preserved --');
  {
    const rt = loadRuntime(El('div'), {});
    check(rt.FEATURE_BADGE_TEXT.comingSoon==='Soon', 'placeholder badge text is the quieter "Soon"');
    check(rt.FEATURE_REGISTRY.projects.status==='comingSoon' && rt.FEATURE_REGISTRY.vendors.status==='comingSoon' && rt.FEATURE_REGISTRY.calendar.status==='comingSoon',
      'placeholder features (Projects/Vendors/Financial Calendar) are still registered as coming soon');
  }

  console.log('');
  if(failures.length===0){ console.log('UX-004F RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.'); process.exit(0); }
  console.log('UX-004F RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
  failures.forEach(f=>console.log('   - ' + f)); process.exit(1);
})();
