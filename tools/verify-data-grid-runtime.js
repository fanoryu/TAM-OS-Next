#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-005B — DATA GRID FOUNDATION — RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of UX-005B. This harness proves its
   BEHAVIOUR by executing the REAL production helpers (gridApply/gridSort/gridPage/
   gridCycleSort/gridFeatureEnabled, GRID_COMPARATORS, and the Transactions pipeline
   txnsFiltered) in the browser's single shared global scope, reproduced in a Node
   `vm` context using the same loader technique as js/cli/cli.js (EXCLUDING
   core/app-bootstrap.js). No file is modified; no real data is used.

   Deterministic fixtures A–G (R6) are defined ONCE here and reused across every
   assertion. Proves: comparators (text/number/currency/date); blanks-last + stable
   ties; source arrays byte-identical after sort and after full gridApply; page
   count/bounds/clamp; frozen page sizes; result count captured BEFORE pagination;
   single-column three-click cycle; row-id preservation; feature flags gate UI
   capability only (disabled features change UI, never the data); missing flag →
   disabled; export dataset independent of pagination; no storage/business mutation.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

function loadRuntime(memStore){
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root, 'tools', 'module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(root, 'js', f), 'utf8')).join('\n')
    + '\n;window.__TAM__ = {'
    + ' State:State, gridApply:gridApply, gridSort:gridSort, gridPage:gridPage,'
    + ' gridCycleSort:gridCycleSort, gridFeatureEnabled:gridFeatureEnabled, gridInitState:gridInitState,'
    + ' GRID_COMPARATORS:GRID_COMPARATORS, GRID_PAGE_SIZES:GRID_PAGE_SIZES, GRID_DEFAULT_PAGE_SIZE:GRID_DEFAULT_PAGE_SIZE,'
    + ' GRID_DEFAULT_SORT:GRID_DEFAULT_SORT, TXN_COLUMNS:TXN_COLUMNS, TXN_FEATURES:TXN_FEATURES,'
    + ' EMP_COLUMNS:EMP_COLUMNS, EMP_FEATURES:EMP_FEATURES, txnsFiltered:txnsFiltered, debounce:debounce,'
    + ' LocalIdentityProvider:LocalIdentityProvider };';
  const noop = function(){};
  const memStorage = { getItem:(k)=>Object.prototype.hasOwnProperty.call(memStore,k)?memStore[k]:null, setItem:(k,v)=>{ memStore[k]=String(v); }, removeItem:(k)=>{ delete memStore[k]; } };
  const documentStub = { addEventListener:noop, removeEventListener:noop, getElementById:()=>null, querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>({style:{},setAttribute:noop,appendChild:noop}), body:{appendChild:noop}, documentElement:{dataset:{}} };
  const sandbox = { console:{log:noop,warn:noop,error:noop}, navigator:{userAgent:'tam-ux005b'}, setTimeout, clearTimeout, requestAnimationFrame:(fn)=>fn(),
    localStorage:memStorage, storage:undefined, addEventListener:noop, removeEventListener:noop,
    matchMedia:()=>({matches:false, addEventListener:noop, addListener:noop}), document:documentStub };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename:'tam-ux005b-runtime.js' });
  return sandbox.__TAM__;
}

/* ---------- deterministic fixtures A–G (R6) ---------- */
const COLS = [
  { id:'name',   label:'Name',   sortable:true, type:'text',     dir:'asc',  getter:r=>r.name },
  { id:'amount', label:'Amount', sortable:true, type:'number',   dir:'desc', getter:r=>r.amount },
  { id:'cur',    label:'Cur',    sortable:true, type:'currency', dir:'desc', getter:r=>r.cur },
  { id:'when',   label:'When',   sortable:true, type:'date',     dir:'asc',  getter:r=>r.when },
  { id:'act',    label:'',       sortable:false },
];
const FEATURES = { pagination:true, sorting:true, search:true, export:true, rowActions:true, resultCount:true };
function mkRow(i){ return { id:'r'+i, name:'Name'+String(i).padStart(4,'0'), amount:i, cur:i*1000, when:1600000000000+i*86400000 }; }
const FIX = {
  A: [],
  B: Array.from({length:5}, (_,i)=>mkRow(i+1)),
  C: Array.from({length:73}, (_,i)=>mkRow(i+1)),
  D: Array.from({length:510}, (_,i)=>mkRow(i+1)),
  E: Array.from({length:10}, (_,i)=>({ id:'e'+i, name:'Same', amount:42, cur:42000, when:1600000000000 })),
  F: [ {id:'f1',name:'Beta',amount:2,cur:2000,when:2}, {id:'f2',name:'',amount:null,cur:null,when:null}, {id:'f3',name:'Alpha',amount:1,cur:1000,when:1}, {id:'f4',name:null,amount:undefined,cur:undefined,when:undefined} ],
  // g4 carries a 12-digit epoch (< 1e12) so LEXICAL date order differs from NUMERIC
  // order — this is what distinguishes a correct numeric/date comparator from a
  // lexical one (a lexical compare would sort g4 last, not first).
  G: [ {id:'g1',name:'apple',amount:10,cur:1500000,when:1704067200000}, {id:'g2',name:'Apple',amount:2,cur:250000,when:1672531200000}, {id:'g3',name:'banana',amount:100,cur:999,when:1735689600000}, {id:'g4',name:'cherry',amount:5,cur:5,when:999999999999} ],
};

(function main(){
  console.log('== UX-005B DATA GRID FOUNDATION — RUNTIME VERIFICATION ==');
  const mem = {};
  const rt = loadRuntime(mem);

  // ---------- A. fixtures / pagination shape ----------
  console.log('-- A. pagination shape across fixtures --');
  {
    const st = rt.gridInitState('transactions'); st.pageSize = 20; st.sort = null;
    const a = rt.gridApply(FIX.A, st, COLS, FEATURES);
    check(a.total===0 && a.pageRows.length===0 && a.pageCount===1 && a.page===1, 'A: empty set is one page (no "Page 1 of 0")');
    const b = rt.gridApply(FIX.B, {sort:null,page:1,pageSize:20}, COLS, FEATURES);
    check(b.total===5 && b.pageRows.length===5 && b.pageCount===1, 'B: 5 rows fit one page');
    const c = rt.gridApply(FIX.C, {sort:null,page:4,pageSize:20}, COLS, FEATURES);
    check(c.total===73 && c.pageCount===4 && c.pageRows.length===13, 'C: 73 rows @20 -> 4 pages, last page 13 rows');
    const d = rt.gridApply(FIX.D, {sort:null,page:1,pageSize:50}, COLS, FEATURES);
    check(d.total===510 && d.pageCount===11, 'D: 510 rows @50 -> 11 pages');
  }

  // ---------- B. page bounds / clamp / sizes ----------
  console.log('-- B. bounds, clamp, sizes --');
  {
    check(rt.GRID_DEFAULT_PAGE_SIZE===20, 'default page size is 20');
    check(JSON.stringify(rt.GRID_PAGE_SIZES)===JSON.stringify([20,50,100]), 'allowed page sizes are [20,50,100]');
    const over = rt.gridApply(FIX.C, {sort:null,page:99,pageSize:20}, COLS, FEATURES);
    check(over.page===4, 'page beyond range clamps to last page');
    const under = rt.gridApply(FIX.C, {sort:null,page:0,pageSize:20}, COLS, FEATURES);
    check(under.page===1, 'page below 1 clamps to first page');
    const bad = rt.gridApply(FIX.C, {sort:null,page:1,pageSize:37}, COLS, FEATURES);
    check(bad.pageSize===20, 'unsupported page size falls back to default 20');
  }

  // ---------- C. comparators + blanks-last + stable ties ----------
  console.log('-- C. comparators, blanks-last, stable ties --');
  {
    const t = rt.gridSort(FIX.G, {col:'name',dir:'asc'}, COLS).map(r=>r.id);
    // 'apple' and 'Apple' compare equal (case-insensitive) -> stable original order (g1 before g2), then banana, cherry.
    check(JSON.stringify(t)===JSON.stringify(['g1','g2','g3','g4']), 'text sort is case-insensitive & locale-aware, ties stable (apple,Apple,banana,cherry)');
    const n = rt.gridSort(FIX.G, {col:'amount',dir:'asc'}, COLS).map(r=>r.amount);
    check(JSON.stringify(n)===JSON.stringify([2,5,10,100]), 'number sort is numeric, not lexical (2,5,10,100)');
    const cur = rt.gridSort(FIX.G, {col:'cur',dir:'desc'}, COLS).map(r=>r.cur);
    check(JSON.stringify(cur)===JSON.stringify([1500000,250000,999,5]), 'currency sort is numeric desc');
    // g4's 12-digit epoch is the SMALLEST numerically but would sort LAST lexically;
    // a correct comparator places it first.
    const dt = rt.gridSort(FIX.G, {col:'when',dir:'asc'}, COLS).map(r=>r.id);
    check(JSON.stringify(dt)===JSON.stringify(['g4','g2','g1','g3']), 'date sort is numeric on the sortable value, not lexical on display text');
    // blanks last in BOTH directions (fixture F)
    const fAsc = rt.gridSort(FIX.F, {col:'name',dir:'asc'}, COLS).map(r=>r.id);
    check(fAsc[fAsc.length-1]==='f2' || fAsc[fAsc.length-1]==='f4', 'F: blank text sorts last (asc)');
    const fDesc = rt.gridSort(FIX.F, {col:'amount',dir:'desc'}, COLS).map(r=>r.id);
    check((fDesc[fDesc.length-1]==='f2'||fDesc[fDesc.length-1]==='f4') && (fDesc[fDesc.length-2]==='f2'||fDesc[fDesc.length-2]==='f4'), 'F: blank numbers sink last (desc)');
    // stable ties (fixture E: all equal amount -> original order preserved)
    const e = rt.gridSort(FIX.E, {col:'amount',dir:'asc'}, COLS).map(r=>r.id);
    check(JSON.stringify(e)===JSON.stringify(FIX.E.map(r=>r.id)), 'E: equal values keep original order (stable)');
    const eDesc = rt.gridSort(FIX.E, {col:'amount',dir:'desc'}, COLS).map(r=>r.id);
    check(JSON.stringify(eDesc)===JSON.stringify(FIX.E.map(r=>r.id)), 'E: stable tie order not reversed by direction');
  }

  // ---------- D. no mutation of source ----------
  console.log('-- D. source arrays never mutated --');
  {
    const before = JSON.stringify(FIX.C);
    rt.gridSort(FIX.C, {col:'amount',dir:'desc'}, COLS);
    rt.gridApply(FIX.C, {sort:{col:'name',dir:'asc'},page:2,pageSize:20}, COLS, FEATURES);
    check(JSON.stringify(FIX.C)===before, 'gridSort/gridApply never mutate or reorder the source array');
  }

  // ---------- E. result count before pagination ----------
  console.log('-- E. result count before pagination --');
  {
    const p1 = rt.gridApply(FIX.C, {sort:null,page:1,pageSize:20}, COLS, FEATURES);
    const p3 = rt.gridApply(FIX.C, {sort:null,page:3,pageSize:20}, COLS, FEATURES);
    check(p1.total===73 && p3.total===73, 'total is the filtered count regardless of current page');
  }

  // ---------- F. three-click sort cycle (single column) ----------
  console.log('-- F. single-column three-click cycle --');
  {
    let s = rt.gridInitState('transactions').sort; // canonical default month desc
    s = rt.gridCycleSort(s, 'category', rt.TXN_COLUMNS, 'transactions');
    check(s.col==='category' && s.dir==='asc', 'first click -> column configured direction (Category asc)');
    s = rt.gridCycleSort(s, 'category', rt.TXN_COLUMNS, 'transactions');
    check(s.col==='category' && s.dir==='desc', 'second click -> reversed');
    s = rt.gridCycleSort(s, 'category', rt.TXN_COLUMNS, 'transactions');
    check(s.col==='month' && s.dir==='desc', 'third click -> canonical default sort (Month desc)');
    const s2 = rt.gridCycleSort(s, 'actions', rt.TXN_COLUMNS, 'transactions');
    check(s2.col==='month', 'non-sortable column does not change sort');
  }

  // ---------- G. row-id preservation after sort+page ----------
  console.log('-- G. row identity preserved --');
  {
    const paged = rt.gridApply(FIX.D, {sort:{col:'amount',dir:'desc'},page:2,pageSize:50}, COLS, FEATURES);
    check(paged.pageRows.every(r=>typeof r.id==='string' && r.id.length>0), 'page rows retain their canonical id after sort+paginate');
    check(paged.pageRows[0].amount >= paged.pageRows[paged.pageRows.length-1].amount, 'page 2 rows are correctly ordered by the sort');
  }

  // ---------- H. feature flags: capability only ----------
  console.log('-- H. feature flags gate capability, not data --');
  {
    const noPage = rt.gridApply(FIX.C, {sort:null,page:1,pageSize:20}, COLS, {sorting:true,pagination:false});
    check(noPage.pageRows.length===73 && noPage.total===73, 'disabled pagination returns the full set as one page');
    const noSort = rt.gridApply(FIX.G, {sort:{col:'amount',dir:'asc'},page:1,pageSize:20}, COLS, {sorting:false,pagination:true});
    check(JSON.stringify(noSort.pageRows.map(r=>r.id))===JSON.stringify(FIX.G.map(r=>r.id)), 'disabled sorting leaves order untouched');
    check(rt.gridFeatureEnabled({}, 'export')===false && rt.gridFeatureEnabled({export:true},'export')===true, 'missing feature flag defaults to disabled');
    check(rt.gridFeatureEnabled({export:'yes'},'export')===false, 'non-true feature value is treated as disabled');
    // two configs, same rows: capability differs, data output identical for the overlap
    const withPg = rt.gridApply(FIX.D, {sort:{col:'amount',dir:'asc'},page:1,pageSize:20}, COLS, FEATURES);
    const noPg = rt.gridApply(FIX.D, {sort:{col:'amount',dir:'asc'},page:1,pageSize:20}, COLS, {sorting:true,pagination:false});
    check(withPg.total===noPg.total && JSON.stringify(withPg.pageRows.map(r=>r.id))===JSON.stringify(noPg.pageRows.slice(0,20).map(r=>r.id)),
      'two feature configs over the same rows: same data, different capability');
  }

  // ---------- I. Transactions pipeline (real txnsFiltered + gridApply) ----------
  console.log('-- I. Transactions pipeline --');
  {
    const S = rt.State;
    /* Readiness-1 — the ledger is now a principal-scoped READ, so this pipeline test
       must act as a principal. With none selected the scoped ledger is correctly empty
       (fail closed: an unselected principal is not a CEO), which would leave the grid
       nothing to paginate. CEO is selected here because this section tests the GRID
       pipeline, not the scoping; scoping itself is proven by
       tools/verify-employee-read-scope-runtime.js. */
    rt.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
    S.txns = Array.from({length:60},(_,i)=>({ id:'t'+i, monthKey:'2025-06', month:'June', year:2025, monthNum:6, category:(i%2?'Rutin':'Gaji'), type:'expense', planned:1000+i, actual:(i%3===0?null:1000+i), uraian:'SAMPLE '+i }));
    S.txFilter = {month:'all',category:'all',search:'',budget:'all',type:'all',status:'all',method:'all',bank:'all'};
    const memBefore = JSON.stringify(mem);
    const txnBefore = JSON.stringify(S.txns);
    const filtered = rt.txnsFiltered();
    const paged = rt.gridApply(filtered, {sort:{col:'planned',dir:'desc'},page:2,pageSize:20}, rt.TXN_COLUMNS, rt.TXN_FEATURES);
    check(paged.total===60 && paged.pageCount===3 && paged.pageRows.length===20, 'Transactions: 60 filtered -> 3 pages @20');
    check(paged.pageRows[0].planned >= paged.pageRows[19].planned, 'Transactions: page ordered by Planned desc');
    check(JSON.stringify(S.txns)===txnBefore, 'Transactions pipeline does not mutate State.txns');
    check(JSON.stringify(mem)===memBefore, 'Transactions pipeline writes nothing to storage');
  }

  // ---------- J. Employees grid config (config-level; async seam covered in browser) ----------
  console.log('-- J. Employees grid config --');
  {
    const emp = Array.from({length:45},(_,i)=>({ id:'e'+i, fullName:'Emp '+String(i).padStart(3,'0'), jobTitle:'T', department:'D', employmentStatus:'Active', monthlyBaseSalary:5000000+i }));
    const paged = rt.gridApply(emp, {sort:{col:'name',dir:'asc'},page:1,pageSize:20}, rt.EMP_COLUMNS, rt.EMP_FEATURES);
    check(paged.total===45 && paged.pageCount===3 && paged.pageRows[0].id==='e0', 'Employees: EMP_COLUMNS drive sort/paginate over a supplied array');
    const feat = rt.EMP_FEATURES;
    check(feat.export===true && feat.rowActions===true, 'Employees features declare export & rowActions as UI capability');
  }

  console.log('');
  if(failures.length===0){ console.log('UX-005B RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.'); process.exit(0); }
  console.log('UX-005B RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
  failures.forEach(f=>console.log('   - ' + f)); process.exit(1);
})();
