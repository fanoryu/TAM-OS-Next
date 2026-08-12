#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-005D — GLOBAL SEARCH — RUNTIME VERIFICATION
   ------------------------------------------------------------
   Proves the BEHAVIOUR of the pure engine (searchGlobal / globalSearchScore) and the
   application collector (collectGlobalSearchDocuments) by running the REAL production
   functions in the browser's shared global scope (Node `vm`, same loader as
   js/cli/cli.js, excluding core/app-bootstrap.js). Deterministic fixtures only.

   Acceptance gates: deterministic ranking; grouping/caps; stable type:id keys;
   correct route/context per entity type; NAVIGATION-ONLY documents (no functions, no
   mutation); collector/engine never mutate their inputs; and the SCOPE-SAFETY test —
   the engine only ever surfaces records present in the supplied document set, so a
   reduced source cannot leak the full dataset (the UX-006 compatibility gate).
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){ if(cond){ passed++; console.log('  [PASS] ' + label); } else { failures.push(label); console.log('  [FAIL] ' + label); } }

function loadRuntime(){
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { State:State, searchGlobal:searchGlobal, globalSearchScore:globalSearchScore,'
    + ' collectGlobalSearchDocuments:collectGlobalSearchDocuments, GLOBAL_SEARCH_GROUP_CAP:GLOBAL_SEARCH_GROUP_CAP,'
    + ' GLOBAL_SEARCH_TOTAL_CAP:GLOBAL_SEARCH_TOTAL_CAP };';
  const noop = function(){};
  const store = {};
  const memStorage = { getItem:(k)=>Object.prototype.hasOwnProperty.call(store,k)?store[k]:null, setItem:(k,v)=>{store[k]=String(v);}, removeItem:(k)=>{delete store[k];} };
  const documentStub = { addEventListener:noop, removeEventListener:noop, getElementById:()=>null, querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>({style:{},setAttribute:noop,appendChild:noop,addEventListener:noop}), body:{appendChild:noop}, documentElement:{dataset:{}} };
  const sandbox = { console:{log:noop,warn:noop,error:noop}, navigator:{userAgent:'tam-ux005d'}, setTimeout, clearTimeout, requestAnimationFrame:(fn)=>fn(), localStorage:memStorage, storage:undefined, addEventListener:noop, removeEventListener:noop, matchMedia:()=>({matches:false,addEventListener:noop,addListener:noop}), document:documentStub };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename:'tam-ux005d-runtime.js' });
  return { rt: sandbox.__TAM__, store };
}

// Deterministic fixtures
const EMPLOYEES = [
  { id:'e1', employeeId:'EMP-001', fullName:'Norman Ahmad', jobTitle:'Analyst', department:'Finance', email:'norman@x', phone:'1' },
  { id:'e2', employeeId:'EMP-002', fullName:'Nadia Putri', jobTitle:'Manager', department:'Operations', email:'nadia@x', phone:'2' },
  { id:'e3', employeeId:'EMP-003', fullName:'Budi Santoso', jobTitle:'Staff', department:'Finance', email:'budi@x', phone:'3' },
];
const CONTRACTS = [ { id:'c1', contractNumber:'CTR-2025-01', employeeName:'Norman Ahmad', status:'Active' } ];
const PAYROLL = [ { id:'p1', employeeName:'Norman Ahmad', monthKey:'2025-06', status:'Ready' } ];
const NAVGROUPS = [ { id:'finance', label:'Finance', items:[ {id:'transactions', label:'Transactions'}, {id:'executioncenter', label:'Execution'}, {id:'projects', label:'Projects', placeholder:true} ] } ];
const TITLES = { transactions:'Transactions', executioncenter:'Execution' };

(function main(){
  console.log('== UX-005D GLOBAL SEARCH — RUNTIME VERIFICATION ==');
  const { rt, store } = loadRuntime();

  // ---------- A. collector: documents, keys, routes, no functions ----------
  console.log('-- A. document collection --');
  const docs = rt.collectGlobalSearchDocuments({ navGroups:NAVGROUPS, pageTitles:TITLES, employees:EMPLOYEES, contracts:CONTRACTS, payrollPlans:PAYROLL });
  check(docs.some(d=>d.key==='employee:e1' && d.to==='employeeDetail' && d.context.detailEmpId==='e1'), 'employee doc: stable key + employeeDetail route + context');
  check(docs.some(d=>d.key==='contract:c1' && d.to==='contractDetail' && d.context.detailContractId==='c1'), 'contract doc: stable key + contractDetail route + context');
  check(docs.some(d=>d.key==='payroll:p1' && d.to==='payrollDetail' && d.context.detailPayrollId==='p1'), 'payroll doc: stable key + payrollDetail route + context');
  check(docs.some(d=>d.key==='view:transactions' && d.to==='transactions') && docs.some(d=>d.key==='view:executioncenter'), 'navigation docs derived from manifest');
  check(!docs.some(d=>d.key==='view:projects'), 'placeholder nav item excluded');
  check(!docs.some(d=>d.type==='transaction'), 'transaction entity results deferred (v1)');
  check(docs.every(d=>typeof d.to==='string' && (d.context===undefined || typeof d.context==='object') && Object.values(d).every(v=>typeof v!=='function')), 'documents are plain data (no stored callbacks/functions)');

  // ---------- B. deterministic ranking ----------
  console.log('-- B. ranking tiers --');
  check(rt.globalSearchScore({key:'employee:e1',label:'Norman Ahmad',searchText:'norman'}, 'norman ahmad')===100, 'exact label -> 100');
  check(rt.globalSearchScore({label:'Norman Ahmad'}, 'norman')===80, 'label prefix -> 80');
  check(rt.globalSearchScore({label:'Norman Ahmad'}, 'ahmad')===60, 'word prefix -> 60');
  check(rt.globalSearchScore({label:'Norman Ahmad'}, 'rman')===40, 'label substring -> 40');
  check(rt.globalSearchScore({label:'Norman',meta:'finance',searchText:'finance'}, 'finance')===20, 'meta/searchText substring -> 20');
  check(rt.globalSearchScore({label:'Norman'}, 'zzz')===0, 'no match -> 0');

  // ---------- C. search: grouping, order, stable ties ----------
  console.log('-- C. grouping & stability --');
  const r = rt.searchGlobal('norman', docs, {});
  check(r.groups.length>0 && r.groups[0].type==='employee' || r.groups.some(g=>g.type==='employee'), 'employee group present for "norman"');
  const empGroup = r.groups.find(g=>g.type==='employee');
  check(empGroup && empGroup.items[0].key==='employee:e1', 'exact match ranks first');
  // stable ties: two equal-scoring docs keep input order
  const tie = rt.searchGlobal('x', [ {key:'employee:a',type:'employee',label:'X',searchText:'x'}, {key:'employee:b',type:'employee',label:'X',searchText:'x'} ], {});
  check(tie.groups[0].items[0].key==='employee:a' && tie.groups[0].items[1].key==='employee:b', 'equal scores keep original order (stable)');

  // ---------- D. caps ----------
  console.log('-- D. caps --');
  const many = []; for(let i=0;i<12;i++) many.push({key:'employee:e'+i,type:'employee',label:'Emp'+i,searchText:'emp'});
  const capped = rt.searchGlobal('emp', many, {});
  check(capped.groups.find(g=>g.type==='employee').items.length===rt.GLOBAL_SEARCH_GROUP_CAP, 'per-group cap enforced ('+rt.GLOBAL_SEARCH_GROUP_CAP+')');
  const wide=[]; ['employee','contract','payroll','view'].forEach(t=>{ for(let i=0;i<8;i++) wide.push({key:t+':'+i,type:t,label:t+i,searchText:'z'}); });
  const totalCapped = rt.searchGlobal('z', wide, {});
  check(totalCapped.total<=rt.GLOBAL_SEARCH_TOTAL_CAP, 'overall cap enforced ('+rt.GLOBAL_SEARCH_TOTAL_CAP+')');

  // ---------- E. empty query ----------
  console.log('-- E. empty query --');
  const eq = rt.searchGlobal('', docs, {});
  check(eq.total===0 && eq.groups.length===0, 'empty query returns no results');

  // ---------- F. SCOPE-SAFETY GATE (UX-006 compatibility) ----------
  console.log('-- F. scope safety --');
  const full = rt.collectGlobalSearchDocuments({ employees:EMPLOYEES });
  const fullRes = rt.searchGlobal('a', full, {}); // matches multiple names
  const fullKeys = fullRes.groups.flatMap(g=>g.items.map(i=>i.key));
  check(fullKeys.includes('employee:e1'), 'full source can return e1');
  const scoped = rt.collectGlobalSearchDocuments({ employees:[EMPLOYEES[1]] }); // only e2 (Nadia)
  const scopedRes = rt.searchGlobal('a', scoped, {});
  const scopedKeys = scopedRes.groups.flatMap(g=>g.items.map(i=>i.key));
  check(scopedKeys.length>0 && scopedKeys.every(k=>k==='employee:e2'), 'reduced source returns ONLY the supplied record (e2)');
  check(!scopedKeys.includes('employee:e1') && !scopedKeys.includes('employee:e3'), 'engine never recovers records absent from the supplied source (scope gate)');

  // ---------- G. mutation-free ----------
  console.log('-- G. mutation-free --');
  const srcCopy = JSON.stringify(EMPLOYEES);
  const docsCopy = JSON.stringify(docs);
  rt.searchGlobal('norman', docs, {});
  const S = rt.State; const stateBefore = JSON.stringify({e:S.employees,c:S.contracts,t:S.txns,p:S.payrollPlans});
  rt.collectGlobalSearchDocuments({ employees:EMPLOYEES, contracts:CONTRACTS, payrollPlans:PAYROLL });
  check(JSON.stringify(EMPLOYEES)===srcCopy, 'collector does not mutate its source arrays');
  check(JSON.stringify(docs)===docsCopy, 'searchGlobal does not mutate the documents');
  check(JSON.stringify({e:S.employees,c:S.contracts,t:S.txns,p:S.payrollPlans})===stateBefore, 'no business State mutated');
  check(Object.keys(store).length===0, 'no storage writes');

  console.log('');
  if(failures.length===0){ console.log('UX-005D RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.'); process.exit(0); }
  console.log('UX-005D RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
  failures.forEach(f=>console.log('   - ' + f)); process.exit(1);
})();
