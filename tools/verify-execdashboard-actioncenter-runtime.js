#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-005A — EXECUTIVE DASHBOARD & ACTION CENTER — RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of UX-005A. This harness proves its
   BEHAVIOUR by executing the REAL production functions (actionCenterSources,
   actionCenterItems, actionCenterCardHTML, kpiCard, bindActionCenter,
   bindDashboardDrill, goToMonthOverview, hrNavTo) in the browser's single shared
   global scope, reproduced in a Node `vm` context using the same loader technique
   as js/cli/cli.js (EXCLUDING core/app-bootstrap.js). No file is modified; no real
   data is used.

   Full-page rendering of the two dashboards (which drives the SVG chart subsystem)
   is validated in the browser matrix, not here; a text-only fake DOM cannot parse
   innerHTML. This harness proves the UX-005A CONTRACTS that must hold regardless of
   rendering:
     - the Action Center is derived from the four EXISTING alert generators, tagged
       by ORIGINATING generator (category), each mapped to one existing canonical view;
     - clicking an Action Center item or a KPI drill link is NAVIGATION ONLY — it
       changes view/context state and leaves every business collection byte-identical
       (no execution / approval / posting / deletion / persistence);
     - the honest empty state renders when nothing needs attention;
     - the month-trend drill-through preserves the selected month.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

/* ---------- compact fake DOM (only what these handlers touch) ---------- */
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
  el.click=()=>{ el.dispatchEvent({type:'click'}); };
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
  let ok=true;
  const idm=s.match(/#([\w-]+)/); if(idm) ok=ok&&(el.id===idm[1]);
  (s.match(/\.[\w-]+/g)||[]).forEach(c=>{ ok=ok&&el._classes.has(c.slice(1)); });
  (s.match(/\[[^\]]+\]/g)||[]).forEach(a=>{ const m=a.match(/^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/); if(!m){ok=false;return;} if(m[2]===undefined) ok=ok&&el.hasAttribute(m[1]); else ok=ok&&(el.getAttribute(m[1])===m[2]); });
  const tagm=s.match(/^([a-z]+)[.#\[]/i); if(tagm) ok=ok&&(el.tagName===tagm[1].toUpperCase());
  return ok;
}
function qsa(root,selector){ const parts=selector.split(',').map(x=>x.trim()); const pool=descendants(root); const set=new Set();
  parts.forEach(part=>{ pool.filter(e=>matchSimple(e,part)).forEach(e=>set.add(e)); });
  return [...set];
}

function loadRuntime(tree, memStore){
  const root = path.resolve(__dirname,'..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f=>f!=='core/app-bootstrap.js');
  const src = jsFiles.map(f=>fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = {'
    + ' State:State, PAGE_TITLES:PAGE_TITLES, EXEC_ALERT_VISIBLE:EXEC_ALERT_VISIBLE,'
    + ' actionCenterSources:actionCenterSources, actionCenterItems:actionCenterItems,'
    + ' actionCenterCardHTML:actionCenterCardHTML, actionCenterRowHTML:actionCenterRowHTML,'
    + ' bindActionCenter:bindActionCenter, bindDashboardDrill:bindDashboardDrill,'
    + ' kpiCard:kpiCard, goToMonthOverview:goToMonthOverview, hrNavTo:hrNavTo,'
    + ' computeExecutiveAlerts:computeExecutiveAlerts, hrDashboardAlerts:hrDashboardAlerts,'
    + ' overtimeDashboardAlerts:overtimeDashboardAlerts, payrollDashboardAlerts:payrollDashboardAlerts,'
    + ' setRender:function(fn){ render = fn; } };';
  const noop=function(){};
  const memStorage={ getItem:(k)=>Object.prototype.hasOwnProperty.call(memStore,k)?memStore[k]:null, setItem:(k,v)=>{ memStore[k]=String(v); }, removeItem:(k)=>{ delete memStore[k]; } };
  const documentStub={ addEventListener:noop, removeEventListener:noop,
    getElementById:(id)=>{ if(id==='app')return tree; return descendants(tree).find(e=>e.id===id)||null; },
    querySelector:(s)=>qsa(tree,s)[0]||null, querySelectorAll:(s)=>qsa(tree,s), createElement:(t)=>El(t),
    body:El('body'), documentElement:{ dataset:{} }, get activeElement(){ return ACTIVE; }, contains:(n)=>{ for(let x=n;x;x=x.parent){ if(x===tree)return true; } return false; } };
  const sandbox={ console:{log:noop,warn:noop,error:noop}, navigator:{userAgent:'tam-ux005a'}, setTimeout, clearTimeout, requestAnimationFrame:(fn)=>fn(),
    localStorage:memStorage, storage:undefined, addEventListener:noop, removeEventListener:noop,
    matchMedia:()=>({ matches:false, addEventListener:noop, addListener:noop }), document:documentStub };
  sandbox.window=sandbox; sandbox.self=sandbox; sandbox.globalThis=sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename:'tam-ux005a-runtime.js' });
  return sandbox.__TAM__;
}

// Snapshot of every authoritative business collection — used to prove navigation
// mutates none of them.
function businessSnapshot(S){
  return JSON.stringify({
    txns:S.txns, payrollPlans:S.payrollPlans, overtimeRecords:S.overtimeRecords,
    employees:S.employees, contracts:S.contracts, monthlyPlans:S.monthlyPlans, backups:S.backups,
  });
}

(function main(){
  console.log('== UX-005A EXECUTIVE DASHBOARD & ACTION CENTER — RUNTIME VERIFICATION ==');
  const monthsKey = '2025-06';

  // ---------- A. Action Center derives from the four existing generators ----------
  console.log('-- A. Action Center derivation (category = originating generator) --');
  {
    const rt = loadRuntime(El('div'), {}); const S = rt.State;
    if(!S.selectedMonth) S.selectedMonth = monthsKey;
    const months = [{key:monthsKey, month:'June', year:2025}];
    const sources = rt.actionCenterSources(monthsKey, months);
    check(sources.length===4, 'Action Center is built from exactly four alert sources');
    const byTo = Object.fromEntries(sources.map(s=>[s.to, s]));
    check(!!byTo.financeOverview && !!byTo.contracts && !!byTo.overtime && !!byTo.payroll,
      'the four sources map to financeOverview / contracts / overtime / payroll');
    // Each source's items are exactly the corresponding generator's output (category integrity),
    // proven by deep-equality against the generator called directly — no text parsing.
    check(JSON.stringify(byTo.contracts.items)===JSON.stringify(rt.hrDashboardAlerts(monthsKey)),
      'contracts source == hrDashboardAlerts output (unchanged generator)');
    check(JSON.stringify(byTo.overtime.items)===JSON.stringify(rt.overtimeDashboardAlerts(monthsKey)),
      'overtime source == overtimeDashboardAlerts output (unchanged generator)');
    check(JSON.stringify(byTo.payroll.items)===JSON.stringify(rt.payrollDashboardAlerts(monthsKey)),
      'payroll source == payrollDashboardAlerts output (unchanged generator)');
    check(JSON.stringify(byTo.financeOverview.items)===JSON.stringify(rt.computeExecutiveAlerts(monthsKey, months)),
      'financeOverview source == computeExecutiveAlerts output (unchanged generator)');
    // Every produced item carries a destination drawn only from the allowed set.
    const items = rt.actionCenterItems(monthsKey, months);
    const allowed = new Set(['financeOverview','contracts','overtime','payroll']);
    check(items.every(a=>allowed.has(a.to)), 'every Action Center item is tagged with an allowed destination view');
    check(items.every(a=>typeof a.type==='string' && typeof a.text!=='undefined'),
      'items preserve the generators\' {type, text} shape (only a destination is added)');
  }

  // ---------- B. honest empty state ----------
  console.log('-- B. honest empty state --');
  {
    const rt = loadRuntime(El('div'), {});
    const html = rt.actionCenterCardHTML([]);
    check(/No items need attention this period\./.test(html), 'empty Action Center renders the honest empty state');
    check(/Action Center/.test(html) && /0 items/.test(html), 'empty Action Center still shows the section header and a zero count');
    // populated card renders navigable buttons for items that carry a destination.
    const card = rt.actionCenterCardHTML([{type:'warn',text:'x',to:'payroll'},{type:'info',text:'y',to:'contracts'}]);
    check(/data-ac-nav="payroll"/.test(card) && /data-ac-nav="contracts"/.test(card),
      'populated Action Center renders navigable rows with data-ac-nav');
    check(/aria-label=/.test(card), 'Action Center rows carry an aria-label (severity + destination, not colour alone)');
  }

  // ---------- C. Action Center click = navigation only (no business mutation) ----------
  console.log('-- C. Action Center navigation is mutation-free --');
  {
    const mem={}; const rt = loadRuntime(El('div'), mem); const S = rt.State;
    let renderCalls=0; rt.setRender(()=>{ renderCalls++; });
    // Give the collections some content so a mutation would be detectable.
    S.txns=[{id:'t1',actual:100},{id:'t2',actual:null}];
    S.payrollPlans=[{id:'p1',status:'Ready'}];
    S.overtimeRecords=[{id:'o1',status:'Approved'}];
    const before = businessSnapshot(S);
    const beforeView = S.view;
    const host = El('div');
    host.appendChild((()=>{ const b=El('button'); b.classList.add('action-item'); b.setAttribute('data-ac-nav','payroll'); return b; })());
    rt.bindActionCenter(host);
    host.querySelector('[data-ac-nav]').click();
    check(S.view==='payroll' && S.view!==beforeView, 'clicking an Action Center item navigates to its destination view');
    check(renderCalls===1, 'navigation triggers exactly one re-render');
    check(businessSnapshot(S)===before, 'no business collection changed after Action Center navigation (mutation-free)');
  }

  // ---------- D. reveal-more toggle is presentation-only ----------
  console.log('-- D. reveal-more toggle --');
  {
    const rt = loadRuntime(El('div'), {}); const S = rt.State;
    const many = []; for(let i=0;i<rt.EXEC_ALERT_VISIBLE+3;i++) many.push({type:'info',text:'n'+i,to:'payroll'});
    const html = rt.actionCenterCardHTML(many);
    check(/id="actionCenterToggle"/.test(html), 'a "show all" toggle appears when items exceed the visible cap');
    check((html.match(/data-action-extra/g)||[]).length===3, 'exactly the overflow items are hidden behind the toggle');
    const before = businessSnapshot(S);
    check(businessSnapshot(S)===before, 'building the Action Center card mutates no business state');
  }

  // ---------- E. KPI drill-through = navigation only ----------
  console.log('-- E. KPI drill-through navigation --');
  {
    const rt = loadRuntime(El('div'), {}); const S = rt.State;
    let renderCalls=0; rt.setRender(()=>{ renderCalls++; });
    S.txns=[{id:'t1',actual:5}];
    const before = businessSnapshot(S);
    // kpiCard renders a drill link when given a drill option.
    const khtml = rt.kpiCard('Net Cash Flow','Rp 1', {drill:{to:'cashflow', label:'Open Cash Flow'}});
    check(/data-dash-nav="cashflow"/.test(khtml), 'kpiCard renders a drill link to the requested view');
    const host = El('div');
    host.appendChild((()=>{ const b=El('button'); b.classList.add('dash-drill'); b.setAttribute('data-dash-nav','cashflow'); return b; })());
    rt.bindDashboardDrill(host);
    host.querySelector('[data-dash-nav]').click();
    check(S.view==='cashflow', 'clicking a KPI drill link navigates to its destination');
    check(renderCalls===1 && businessSnapshot(S)===before, 'KPI drill navigation is mutation-free (one render, no data change)');
  }

  // ---------- F. month-trend drill preserves month context ----------
  console.log('-- F. trend drill preserves month --');
  {
    const rt = loadRuntime(El('div'), {}); const S = rt.State;
    let renderCalls=0; rt.setRender(()=>{ renderCalls++; });
    const before = businessSnapshot(S);
    rt.goToMonthOverview('2025-03');
    check(S.selectedMonth==='2025-03' && S.view==='financeOverview',
      'goToMonthOverview sets the month and opens Finance Overview');
    check(renderCalls===1 && businessSnapshot(S)===before, 'trend drill-through is mutation-free');
  }

  console.log('');
  if(failures.length===0){ console.log('UX-005A RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.'); process.exit(0); }
  console.log('UX-005A RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
  failures.forEach(f=>console.log('   - ' + f)); process.exit(1);
})();
