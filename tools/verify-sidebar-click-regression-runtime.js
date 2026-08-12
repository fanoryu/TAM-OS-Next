#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-004 SIDEBAR INTERACTION HOTFIX — CLICK-PATH REGRESSION VERIFICATION
   ------------------------------------------------------------
   Reproduces the reported defect through the REAL binding path: it builds a fake
   shell tree, calls the production bindShell() to attach the SAME listeners the
   browser uses, then DISPATCHES real click events on the rendered group-header and
   "More" nodes — not helper functions. It asserts:

     * a NON-active group header toggles (state + aria + items visibility), and a
       second click reverses it;
     * clicking the ACTIVE group header is a clean no-op — it never arms a phantom
       collapse that would surprise the user on the next navigation (the bug);
     * the "More" disclosure toggles when Finance is not the active section, and a
       second click closes it;
     * clicking "More" while the active view lives inside it is a clean no-op (no
       phantom navMore flip);
     * an active secondary destination still auto-opens "More" via syncShellState.

   Runs in the browser's single shared global scope reproduced in a Node `vm`
   context (same loader technique as js/cli/cli.js, EXCLUDING core/app-bootstrap.js).
   No file is modified; no real data is used.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

/* ---------- compact fake DOM ---------- */
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
  el.dispatchEvent=(evt)=>{ evt.target=evt.target||el; let n=el; while(n){ (n._listeners[evt.type]||[]).slice().forEach(fn=>fn(evt)); n=evt._stop?null:n.parent; } return true; };
  el.focus=()=>{ ACTIVE=el; }; el.blur=()=>{ if(ACTIVE===el)ACTIVE=null; };
  el.contains=(n)=>{ for(let x=n;x;x=x.parent){ if(x===el)return true; } return false; };
  el.querySelector=(s)=> qsa(el,s)[0]||null;
  el.querySelectorAll=(s)=> qsa(el,s);
  Object.defineProperty(el,'className',{ get:()=>[...el._classes].join(' '), set:(v)=>{ el._classes=new Set(String(v).split(/\s+/).filter(Boolean)); } });
  Object.defineProperty(el,'parentNode',{ get:()=>el.parent });
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
function clickEvt(){ return { type:'click', preventDefault:()=>{}, stopPropagation(){ this._stop=true; } }; }

function loadRuntime(tree){
  const root = path.resolve(__dirname,'..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f=>f!=='core/app-bootstrap.js');
  const src = jsFiles.map(f=>fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { State:State, bindShell:bindShell, syncShellState:syncShellState, render:render, navActive:navActive, NAV_GROUPS:NAV_GROUPS };';
  const noop=function(){};
  const memStore={};
  const memStorage={ getItem:(k)=>Object.prototype.hasOwnProperty.call(memStore,k)?memStore[k]:null, setItem:(k,v)=>{memStore[k]=String(v);}, removeItem:(k)=>{delete memStore[k];} };
  const documentStub={ addEventListener:noop, removeEventListener:noop,
    getElementById:(id)=>{ if(id==='app')return tree; return descendants(tree).find(e=>e.id===id)||null; },
    querySelector:(s)=>qsa(tree,s)[0]||null, querySelectorAll:(s)=>qsa(tree,s), createElement:(t)=>El(t),
    body:El('body'), documentElement:{dataset:{}}, get activeElement(){return ACTIVE;}, contains:(n)=>{ for(let x=n;x;x=x.parent){ if(x===tree)return true; } return false; } };
  const sandbox={ console:{log:noop,warn:noop,error:noop}, navigator:{userAgent:'tam-hotfix'}, setTimeout, clearTimeout, requestAnimationFrame:(fn)=>fn(),
    localStorage:memStorage, storage:undefined, addEventListener:noop, removeEventListener:noop,
    matchMedia:()=>({matches:false,addEventListener:noop,addListener:noop}), document:documentStub };
  sandbox.window=sandbox; sandbox.self=sandbox; sandbox.globalThis=sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename:'tam-hotfix-runtime.js' });
  return sandbox.__TAM__;
}

// Build a shell tree with the real group heads (dashboard/people/finance) + items,
// and Finance's primary items + "More" head + more-items — mirroring navGroupHTML.
function buildTree(rt){
  const app=El('div'); app.setAttribute('id','app');
  const sidebar=El('div'); sidebar.classList.add('sidebar'); app.appendChild(sidebar);
  const brand=El('div'); brand.classList.add('brand'); const sub=El('div'); sub.classList.add('sub'); brand.appendChild(sub); sidebar.appendChild(brand);
  const nav=El('nav'); nav.classList.add('nav'); nav.setAttribute('aria-label','Primary navigation'); sidebar.appendChild(nav);
  const refs={heads:{},moreHead:null,moreBox:null,items:{}};
  ['dashboard','people','finance'].forEach(gid=>{
    const g=rt.NAV_GROUPS.find(x=>x.id===gid);
    const group=El('div'); group.classList.add('nav-group'); nav.appendChild(group);
    const head=El('button'); head.classList.add('nav-group-head'); head.setAttribute('data-group',gid); head.setAttribute('aria-expanded','true');
    const chev=El('span'); chev.classList.add('chev'); chev.textContent='▾'; head.appendChild(chev); group.appendChild(head); refs.heads[gid]=head;
    const items=El('div'); items.classList.add('nav-group-items'); group.appendChild(items);
    g.items.filter(i=>!i.more).forEach(i=>{ const b=El('button'); b.classList.add('nav-item'); b.setAttribute('data-nav',i.id); items.appendChild(b); refs.items[i.id]=b; });
    const moreItems=g.items.filter(i=>i.more);
    if(moreItems.length){
      const mh=El('button'); mh.classList.add('nav-item'); mh.classList.add('nav-more-head'); mh.setAttribute('data-more',gid); mh.setAttribute('aria-expanded','false');
      const mc=El('span'); mc.classList.add('chev'); mc.textContent='▸'; mh.appendChild(mc); items.appendChild(mh); refs.moreHead=mh;
      const box=El('div'); box.classList.add('nav-more-items'); box.style.display='none'; items.appendChild(box); refs.moreBox=box;
      moreItems.forEach(i=>{ const b=El('button'); b.classList.add('nav-item'); b.setAttribute('data-nav',i.id); box.appendChild(b); refs.items[i.id]=b; });
    }
  });
  const main=El('div'); main.classList.add('main'); main.setAttribute('id','main'); app.appendChild(main);
  return { app, refs };
}

(function main(){
  console.log('== UX-004 SIDEBAR HOTFIX — CLICK-PATH REGRESSION VERIFICATION ==');

  // ---------- A. non-active group toggles via the real bindShell click path ----------
  // People is exercised end-to-end here; Analytics and System share the identical
  // single [data-group] handler, so this proves the whole non-active group matrix.
  console.log('-- A. non-active group toggle (real click path) --');
  {
    const rtTmp=loadRuntime(El('div')); const tree=buildTree(rtTmp); const rt=loadRuntime(tree.app);
    rt.State.view='execDashboard'; rt.State.navCollapsed={}; rt.bindShell(tree.app); rt.syncShellState();
    const people=tree.refs.heads.people;
    const a0=people.getAttribute('aria-expanded');
    people.dispatchEvent(clickEvt());
    const a1=people.getAttribute('aria-expanded'); const s1=rt.State.navCollapsed.people;
    const disp1=people.parentNode.querySelector('.nav-group-items').style.display;
    check(a0==='true' && a1==='false' && s1===true && disp1==='none',
      'clicking a NON-active group header collapses it (state + aria + items hidden)');
    people.dispatchEvent(clickEvt());
    check(people.getAttribute('aria-expanded')==='true' && rt.State.navCollapsed.people===false,
      'a second click re-expands the group (toggle reverses)');
  }

  // ---------- B. active group header is a clean no-op (the fixed bug) ----------
  console.log('-- B. active group header — no phantom collapse --');
  {
    const rtTmp=loadRuntime(El('div')); const tree=buildTree(rtTmp); const rt=loadRuntime(tree.app);
    rt.State.view='employees'; rt.State.navCollapsed={}; rt.bindShell(tree.app); rt.syncShellState();
    const people=tree.refs.heads.people;
    check(rt.navActive().group==='people', 'People is the active group while viewing Employees');
    people.dispatchEvent(clickEvt());
    check(rt.State.navCollapsed.people === undefined,
      'clicking the ACTIVE group header does NOT arm a phantom collapse flag (bug fixed)');
    // navigate away — People must NOT be surprisingly collapsed
    rt.State.view='execDashboard'; rt.syncShellState();
    check(tree.refs.heads.people.parentNode.querySelector('.nav-group-items').style.display !== 'none',
      'after navigating away, the previously-active group is not surprisingly collapsed');
  }

  // ---------- C. "More" toggles when Finance is not the active section ----------
  console.log('-- C. non-active More toggle (real click path) --');
  {
    const rtTmp=loadRuntime(El('div')); const tree=buildTree(rtTmp); const rt=loadRuntime(tree.app);
    rt.State.view='execDashboard'; rt.State.navMore={}; rt.bindShell(tree.app); rt.syncShellState();
    const more=tree.refs.moreHead;
    check(more.getAttribute('aria-expanded')==='false' && tree.refs.moreBox.style.display==='none', 'More starts collapsed');
    more.dispatchEvent(clickEvt());
    check(rt.State.navMore.finance===true && more.getAttribute('aria-expanded')==='true' && tree.refs.moreBox.style.display==='',
      'clicking More opens the disclosure (state + aria + items visible)');
    more.dispatchEvent(clickEvt());
    check(rt.State.navMore.finance===false && more.getAttribute('aria-expanded')==='false',
      'a second click closes More (toggle reverses)');
  }

  // ---------- D. active-More header is a clean no-op; auto-open still works ----------
  console.log('-- D. active secondary destination — More auto-opens; header no-op --');
  {
    const rtTmp=loadRuntime(El('div')); const tree=buildTree(rtTmp); const rt=loadRuntime(tree.app);
    rt.State.view='executioncenter'; rt.State.navMore={}; rt.bindShell(tree.app); rt.syncShellState();
    check(tree.refs.moreBox.style.display==='' && tree.refs.moreHead.getAttribute('aria-expanded')==='true',
      'an active secondary destination auto-opens More (no extra click needed)');
    const more=tree.refs.moreHead;
    more.dispatchEvent(clickEvt());
    check(rt.State.navMore.finance === undefined,
      'clicking More while its active view is inside it does NOT arm a phantom flag (bug fixed)');
    rt.State.view='execDashboard'; rt.syncShellState();
    check(tree.refs.moreBox.style.display==='none',
      'after navigating away, More is not surprisingly left open');
  }

  console.log('');
  if(failures.length===0){ console.log('UX-004 SIDEBAR HOTFIX RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.'); process.exit(0); }
  console.log('UX-004 SIDEBAR HOTFIX RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
  failures.forEach(f=>console.log('   - ' + f)); process.exit(1);
})();
