#!/usr/bin/env node
'use strict';
/* ============================================================
   SPR-091 — INTEGRITY RULE RUNTIME VERIFICATION (REMAINING FAMILIES)
   Fixture families F5 / F6 / F7 / F9
   ------------------------------------------------------------
   Third and final harness in the BC-C2 series:
     * tools/verify-integrity-rules-runtime.js          SPR-089, Critical tier, 11 rules
     * tools/verify-integrity-warning-rules-runtime.js  SPR-090, families F1/F2/F3/F4/F8/F10/F11, 24 rules
     * this file                                        SPR-091, families F5/F6/F7/F9, 25 rules
   Together these three plus the SPR-081/082 operation harnesses cover all 63
   rule identifiers emitted by runIntegrityCheck().

   Same dependency-free Node `vm` loader technique as js/cli/cli.js and every
   preceding harness. All fixture data is obviously fabricated. Nothing is
   written to disk and no repository file is modified.

   SCOPE — 25 rule identifiers, derived mechanically as the complement of what
   the earlier harnesses already cover (never hard-coded):
     F5  payroll plan state    8
     F6  posted provenance     8
     F7  employee dedup        6
     F9  supplemental          3
   22 Warning + 3 Info. No Critical rule is claimed here; the three Critical
   rules that co-fire below are already covered by SPR-089.

   THIS COMPLETES RUNTIME RULE-IDENTIFIER COVERAGE. IT DOES NOT COMPLETE
   PREDICATE COVERAGE. Rules that multiplex over several independent code paths
   remain partially covered:
     * duplicate-id      1 of 7 collections   (SPR-089)
     * schema-error      boundary only        (SPR-089)
     * schema-warning    boundary only        (SPR-090)
   This harness DOES close the one predicate path deferred by SPR-090 —
   invalid-amount via the payroll plan — which is exercised below as a
   supplementary case. invalid-amount's rule ID belongs to SPR-090; it is NOT
   counted among this harness's 25.

   HONESTY NOTE — this harness OBSERVES current behavior; it does not judge it.
   Every alias, layering and severity contradiction measured by GOV-006 is
   asserted exactly as it behaves today so that any future change is caught.
   Nothing here repairs, renames, removes or reclassifies any rule. Notably:
     * payroll-missing-transaction (WARNING) and payroll-posted-no-transaction
       (CRITICAL) fire on the SAME condition — the known severity contradiction.
       Locked, not reconciled.
     * payroll-txn-mismatch is a strict SUBSET of payroll-plan-txn-total-diff:
       it adds a `t.actual == null` guard, so it can never fire alone, while
       payroll-plan-txn-total-diff can (an executed transaction). Both directions
       are asserted below.
     * payroll-no-employee is a strict subset of payroll-without-employee — the
       Cancelled-row guard is the sole discriminator, asserted in both directions.
     * every F7 rule co-fires with duplicate-employee-name (CRITICAL, SPR-089),
       because any name collision forms a duplicate group.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

/* The 25 rule identifiers this harness is responsible for, grouped by family.
   Every id here must be exercised by a real fixture — asserted mechanically at
   the end against what the rule() calls actually ran. */
/* INTEGRITY-COVERAGE-BEGIN
   Machine-readable coverage ownership (GOV-007 / SPR-092). tools/verify-build.js
   parses THIS block — bounded by the sentinels — and compares it against the rule
   identifiers and severities actually emitted by runIntegrityCheck(). A rule added
   to production without an entry here, a stale entry for a rule production no
   longer emits, or a severity that disagrees with production, all fail the
   verifier. The list is not a second source of truth: it is checked against the
   source on every build and cannot drift silently.
   Severities are the EXPECTED production severities, asserted per fixture below. */
const INTEGRITY_COVERAGE = {
  harness: 'verify-integrity-payroll-rules-runtime.js',
  rules: {
    'payroll-without-employee': 'warning',
    'payroll-no-employee': 'warning',
    'payroll-no-contract': 'warning',
    'payroll-outside-contract': 'warning',
    'payroll-overtime-broken': 'warning',
    'payroll-total-inconsistent': 'warning',
    'payroll-missing-monthlyplan': 'warning',
    'payroll-override-no-reason': 'warning',
    'payroll-missing-transaction': 'warning',
    'payroll-txn-mismatch': 'warning',
    'payroll-txn-missing-planid': 'warning',
    'payroll-plan-txn-total-diff': 'warning',
    'payroll-plan-txn-overtime-diff': 'warning',
    'payroll-missing-overtime-ids': 'warning',
    'payroll-missing-committed-snapshot': 'warning',
    'payroll-snapshot-txn-diff': 'warning',
    'duplicate-employee': 'warning',
    'duplicate-employee-id': 'warning',
    'payroll-split-across-duplicates': 'warning',
    'overtime-split-across-duplicates': 'warning',
    'duplicate-contact-conflict': 'info',
    'orphan-duplicate-employee': 'info',
    'supplemental-missing-source-snapshot': 'warning',
    'supplemental-missing-source-snapshot-legacy': 'info',
    'supplemental-amount-drift': 'warning'
  }
};
/* INTEGRITY-COVERAGE-END */

/* The same 25 identifiers grouped by fixture family, for the per-family roll-up
   below. Derived from the declaration above — the family map may not introduce
   an identifier the declaration does not carry, asserted in the roll-up. */
const COVERED = {
  F5: ['payroll-without-employee','payroll-no-employee','payroll-no-contract',
       'payroll-outside-contract','payroll-overtime-broken','payroll-total-inconsistent',
       'payroll-missing-monthlyplan','payroll-override-no-reason'],
  F6: ['payroll-missing-transaction','payroll-txn-mismatch','payroll-txn-missing-planid',
       'payroll-plan-txn-total-diff','payroll-plan-txn-overtime-diff',
       'payroll-missing-overtime-ids','payroll-missing-committed-snapshot',
       'payroll-snapshot-txn-diff'],
  F7: ['duplicate-employee','duplicate-employee-id','payroll-split-across-duplicates',
       'overtime-split-across-duplicates','duplicate-contact-conflict','orphan-duplicate-employee'],
  F9: ['supplemental-missing-source-snapshot','supplemental-missing-source-snapshot-legacy',
       'supplemental-amount-drift']
};
/* Rules owned by the EARLIER harnesses. Asserted absent from this contract so a
   future edit cannot silently re-claim work another harness already proves. */
const OWNED_ELSEWHERE = [
  // SPR-089 (Critical tier)
  'contract-multiple-employees','duplicate-employee-name','duplicate-id','overtime-double-commit',
  'overtime-negative-hours','payroll-negative','payroll-posted-no-transaction','schema-error',
  'supplemental-missing-transaction','supplemental-orphan-transaction',
  'supplemental-overtime-double-capture',
  // SPR-081 / SPR-082 (operation-driven)
  'payroll-orphan-transaction','payroll-overtime-uncommitted','monthlyplan-orphan-transaction',
  // SPR-090 (families F1/F2/F3/F4/F8/F10/F11)
  'broken-employee-link','broken-contract-link','broken-payroll-link','corrupt-plan-ref',
  'orphan-transaction','broken-import-link','invalid-date','invalid-amount',
  'overlapping-contracts','invalid-contract-evidence','duplicate-payroll','duplicate-payroll-plan',
  'payroll-duplicate-month','duplicate-payroll-txn','overtime-broken-employee',
  'overtime-broken-contract','overtime-broken-payroll','overtime-bad-snapshot',
  'overtime-outside-contract','overtime-payroll-mismatch',
  'import-multiple-employees-per-candidate','rollback-preserved','adjustment-invalid-period',
  'schema-warning'
];

/* ---------- runtime loader ----------
   Loads the REAL production modules in the manifest order, excluding the only
   DOM-executing load-time module. Browser infrastructure is stubbed; no business
   logic, validator, or predicate is mocked or reimplemented. */
function loadRuntime(){
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { State: State };';
  const noop = function(){};
  const memStore = {};
  const memStorage = {
    getItem: (k)=> Object.prototype.hasOwnProperty.call(memStore,k) ? memStore[k] : null,
    setItem: (k,v)=>{ memStore[k] = String(v); },
    removeItem: (k)=>{ delete memStore[k]; }
  };
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const sandbox = {
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-spr091' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-spr091-runtime.js' });
  sandbox.toast = noop;
  return sandbox;
}

/* ---------- fabricated fixtures ----------
   Every value is a deterministic literal. runIntegrityCheck() branches on
   wall-clock at the v2.7.1 thresholds (2026-07-31), and F6/F9 sit directly on
   those branches — so fixture dates are pinned on the intended side and never
   derived from "now". */
const N   = '2026-01-01T00:00:00.000Z';       // stable createdAt/updatedAt
const M   = '2026-07';                        // primary fixture month
const M2  = '2026-08';                        // second month
const PRE_V271  = '2026-07-05T00:00:00.000Z'; // BEFORE the 2026-07-31 threshold
const POST_V271 = '2026-08-01T00:00:00.000Z'; // AFTER  the 2026-07-31 threshold
const COMMITTED_OT = 'Committed to Payroll';  // OVERTIME_STATUSES member

const EMP = (o)=>Object.assign({ id:'e1', employeeId:'E1', fullName:'SAMPLE — Alpha',
  employmentStatus:'Active', active:true, monthlyBaseSalary:1000000, joinDate:'2025-01-01',
  workHoursPerDay:8, workDaysPerWeek:5, weeksPerMonth:4, createdAt:N, updatedAt:N }, o);
const CT = (o)=>Object.assign({ id:'c1', employeeId:'e1', employeeName:'SAMPLE — Alpha',
  contractNumber:'S/1', startDate:'2025-01-01', durationMonths:36, monthlySalary:1000000,
  status:'Active', createdAt:N, updatedAt:N, history:[] }, o);
const OT = (o)=>Object.assign({ id:'ot1', employeeId:'e1', contractId:'c1', monthKey:M,
  overtimeDate:M+'-10', overtimeHours:2, monthlyStandardHours:160, hourlyRate:10000,
  calculatedAmount:20000, approvedAmount:20000, status:'Approved',
  createdAt:N, updatedAt:N, history:[] }, o);
const PP = (o)=>Object.assign({ id:'pp1', monthKey:M, month:'July', year:2026, monthNum:7,
  employeeId:'e1', employeeName:'SAMPLE — Alpha', contractId:'c1', contractNumber:'S/1',
  baseSalary:1000000, baseSalarySnapshot:1000000, overtime:0, overtimeAmount:0,
  allowance:0, deduction:0, bonus:0, benefits:0, otherAddition:0, otherDeduction:0,
  plannedAmount:1000000, overtimeIds:[], status:'Ready', history:[],
  createdAt:N, updatedAt:N }, o);
const TX = (o)=>Object.assign({ id:'t1', monthKey:M, month:'July', year:2026,
  uraian:'SAMPLE — fabricated row', category:'Gaji', planned:1000000, actual:null,
  createdAt:N, updatedAt:N }, o);
const SUP = (o)=>Object.assign({ id:'sp1', employeeId:'e1', monthKey:M, amount:20000,
  status:'Approved', sourceType:'overtime_drift', sourceOvertimeIds:['ot1'],
  createdAt:N, updatedAt:N, approvedAt:PRE_V271 }, o);

/* F6 works exclusively on the COMMITTED plan + linked transaction pair, so both
   halves get a canonical healthy shape that individual fixtures perturb one
   field at a time. committedAt is pinned BEFORE the v2.7.1 threshold so the
   missing-snapshot rule stays silent unless a fixture asks for it. */
const CPP = (o)=>PP(Object.assign({ status:'Committed', committedAt:PRE_V271, committedTxnId:'t1' }, o));
const PTX = (o)=>TX(Object.assign({ id:'t1', source:'payroll', payrollPlanId:'pp1',
  employeeId:'e1', contractId:'c1', planned:1000000 }, o));
/* A second employee sharing Alpha's name, with its own contract so it is not an
   ORPHAN duplicate. Used by F7 to isolate the split/conflict rules from
   orphan-duplicate-employee. */
const DUP_EMP = ()=>EMP({ id:'e2', employeeId:'E2' });
const DUP_CT  = ()=>CT({ id:'c2', employeeId:'e2', employeeName:'SAMPLE — Alpha', contractNumber:'S/2' });

/* The minimal HEALTHY baseline: one employee, one contract covering the fixture
   months, and every other collection present-but-empty. Initializing every
   collection matters — runIntegrityCheck() iterates all of them unconditionally. */
function baseline(w){
  const S = w.__TAM__.State;
  S.employees = [EMP()];
  S.contracts = [CT()];
  S.overtimeRecords = []; S.monthlyPlans = []; S.txns = []; S.payrollPlans = [];
  S.payrollAdjustments = []; S.recurringExpenses = []; S.employeeMerges = [];
  S.companyAccounts = []; S.supplementalPayments = []; S.importBatches = []; S.backups = [];
  return S;
}

/* Category set, sorted for deterministic comparison. `ranAt` is never asserted
   (a wall-clock stamp) and neither is any message string (operator-facing prose
   containing formatted currency). Sorting also means finding ORDER within a
   severity is never asserted. */
function cats(w){
  const r = w.runIntegrityCheck();
  return r.findings.map(f => f.severity + ':' + f.category).sort();
}
function findingsFor(w, category){
  return w.runIntegrityCheck().findings.filter(f => f.category === category);
}
const eqSet = (a,b)=> a.length===b.length && a.every((x,i)=>x===b[i]);

const exercised = new Set();

/* ---------- the per-case assertion model ----------
   Four assertions per fixture case:
     1. NEGATIVE CONTROL — the healthy baseline does NOT raise it.
     2. FIRES           — the single-defect fixture raises it.
     3. SEVERITY        — every finding of that category has the expected severity.
     4. EXACT SET       — the findings ADDED by the defect equal precisely the
                          expected set, co-firings listed explicitly rather than
                          suppressed.
   Failure labels carry family + label so a failure names exactly what broke. */
function rule(family, id, sev, label, expected, mutate){
  const tag = family + ' ' + label;
  console.log('-- ' + tag + ' --');
  exercised.add(id);
  const w = loadRuntime();
  const S = baseline(w);
  const before = cats(w);
  check(before.indexOf(sev+':'+id) === -1, tag + ': negative control — healthy baseline does NOT raise ' + id);
  mutate(S);
  const after = cats(w);
  const added = after.filter(x => before.indexOf(x) === -1).sort();
  check(added.indexOf(sev+':'+id) > -1, tag + ': fires on its defect fixture');
  const own = findingsFor(w, id);
  check(own.length > 0 && own.every(f => f.severity === sev), tag + ': severity is exactly ' + sev);
  const exp = expected.slice().sort();
  check(eqSet(added, exp), tag + ': exact finding set is [' + exp.join(', ') + ']'
    + (eqSet(added, exp) ? '' : ' (actual: [' + added.join(', ') + '])'));
  return w;
}

(function main(){
  console.log('== SPR-091 INTEGRITY RULES (REMAINING FAMILIES) — RUNTIME VERIFICATION ==');
  console.log('   Fixture families F5 / F6 / F7 / F9 — 25 rule identifiers (22 Warning, 3 Info).');
  console.log('   Completes runtime RULE-IDENTIFIER coverage of runIntegrityCheck().');
  console.log('   This is NOT complete predicate coverage — see header.');
  console.log('');

  /* ---------- 0. the healthy baseline ---------- */
  console.log('-- scenario 0: healthy baseline --');
  {
    const w = loadRuntime(); baseline(w);
    const r = w.runIntegrityCheck();
    check(r.findings.length === 0, 'the healthy fabricated baseline produces ZERO findings');
    check(r.counts.critical === 0, 'baseline Critical count is zero');
    check(r.counts.warning === 0, 'baseline Warning count is zero');
    check(r.counts.info === 0, 'baseline Info count is zero');
    check(r.status === 'Healthy', 'baseline status is "Healthy"');
    check(eqSet(cats(w), cats(w)), 'repeated runs over identical state are deterministic');
  }

  /* ================= F5 — PAYROLL PLAN STATE =================
     Uncommitted payroll plans. EXPECTED CO-FIRING: a dangling employee or
     contract reference is ALSO seen by the F1 link rules and by the validators,
     so those three rules travel together. The remaining five isolate. */
  console.log('');
  console.log('===== F5 — PAYROLL PLAN STATE (8 rules) =====');
  // Cancelled row: the v2.5.0 loop SKIPS Cancelled, so payroll-no-employee stays
  // silent while payroll-without-employee (no such guard) fires. This is the sole
  // discriminator between the two rules — asserted here and inverted below.
  rule('F5','payroll-without-employee','warning','payroll-without-employee [CANCELLED row — the discriminator]',
    ['warning:payroll-without-employee', 'warning:broken-employee-link', 'info:schema-warning'],
    (S)=>{ S.payrollPlans = [PP({ employeeId:'GHOST', status:'Cancelled' })]; });
  // Same defect on a LIVE row: now BOTH fire, proving the subset relation.
  rule('F5','payroll-no-employee','warning','payroll-no-employee [live row — both rules fire]',
    ['warning:payroll-no-employee', 'warning:payroll-without-employee',
     'warning:broken-employee-link', 'info:schema-warning'],
    (S)=>{ S.payrollPlans = [PP({ employeeId:'GHOST' })]; });
  rule('F5','payroll-no-contract','warning','payroll-no-contract',
    ['warning:payroll-no-contract', 'warning:broken-contract-link', 'info:schema-warning'],
    (S)=>{ S.payrollPlans = [PP({ contractId:'GHOST' })]; });
  rule('F5','payroll-outside-contract','warning','payroll-outside-contract',
    ['warning:payroll-outside-contract'],
    (S)=>{ S.payrollPlans = [PP({ monthKey:'2030-01', month:'January', year:2030, monthNum:1 })]; });
  rule('F5','payroll-overtime-broken','warning','payroll-overtime-broken',
    ['warning:payroll-overtime-broken'],
    (S)=>{ S.payrollPlans = [PP({ overtimeIds:['GHOST'] })]; });
  rule('F5','payroll-total-inconsistent','warning','payroll-total-inconsistent',
    ['warning:payroll-total-inconsistent'],
    (S)=>{ S.payrollPlans = [PP({ plannedAmount:12345 })]; });
  rule('F5','payroll-missing-monthlyplan','warning','payroll-missing-monthlyplan',
    ['warning:payroll-missing-monthlyplan'],
    (S)=>{ S.payrollPlans = [PP({ monthlyPlanId:'GHOST' })]; });
  // salaryOverride drives payrollBaseSalary, so plannedAmount must match the
  // OVERRIDDEN base or payroll-total-inconsistent would mask this rule.
  rule('F5','payroll-override-no-reason','warning','payroll-override-no-reason',
    ['warning:payroll-override-no-reason'],
    (S)=>{ S.payrollPlans = [PP({ salaryOverride:{ overridden:1000000, reason:'   ' },
      plannedAmount:1000000 })]; });

  /* ---------- deferred predicate path from SPR-090 ----------
     SPR-090 covered invalid-amount on the transaction and contract paths but
     DEFERRED the payroll-plan path, because its only companion finding is
     payroll-total-inconsistent — an F5 rule that was out of scope there and is
     in scope here. Closing it completes invalid-amount at 3 of 3 paths.
     invalid-amount's RULE ID belongs to SPR-090 and is deliberately NOT counted
     among this harness's 25 identifiers. */
  console.log('');
  console.log('===== F5* — DEFERRED PREDICATE PATH (invalid-amount, owned by SPR-090) =====');
  {
    const w = loadRuntime();
    const S = baseline(w);
    const before = cats(w);
    check(before.indexOf('warning:invalid-amount') === -1, 'F5* invalid-amount [3/3 payroll plan]: negative control');
    S.payrollPlans = [PP({ plannedAmount:-5 })];
    const added = cats(w).filter(x => before.indexOf(x) === -1).sort();
    check(added.indexOf('warning:invalid-amount') > -1, 'F5* invalid-amount [3/3 payroll plan]: fires via the payroll plan path');
    const own = findingsFor(w, 'invalid-amount');
    check(own.length > 0 && own.every(f => f.severity === 'warning'), 'F5* invalid-amount [3/3 payroll plan]: severity is exactly warning');
    check(eqSet(added, ['warning:invalid-amount','warning:payroll-total-inconsistent'].sort()),
      'F5* invalid-amount [3/3 payroll plan]: exact set is [warning:invalid-amount, warning:payroll-total-inconsistent]');
    check(OWNED_ELSEWHERE.indexOf('invalid-amount') !== -1, 'F5* invalid-amount rule ID remains owned by SPR-090, not claimed here');
  }

  /* ================= F6 — POSTED PROVENANCE (v2.7.1) =================
     Every rule needs a COMMITTED plan plus its linked transaction. Six isolate;
     two carry the overlaps GOV-006 identified. */
  console.log('');
  console.log('===== F6 — POSTED PROVENANCE (8 rules) =====');
  // KNOWN SEVERITY CONTRADICTION (GOV-006 Pair 3). The guards of these two rules
  // are provably co-extensive, so the same condition is reported at BOTH
  // warning and critical. Locked in; reconciliation is a governance decision.
  {
    const w = rule('F6','payroll-missing-transaction','warning','payroll-missing-transaction [KNOWN severity contradiction]',
      ['warning:payroll-missing-transaction', 'critical:payroll-posted-no-transaction'],
      (S)=>{ S.payrollPlans = [CPP()]; });
    const miss = findingsFor(w,'payroll-missing-transaction');
    const post = findingsFor(w,'payroll-posted-no-transaction');
    check(miss.length > 0 && miss.every(f=>f.severity==='warning'), 'contradiction locked: payroll-missing-transaction is WARNING');
    check(post.length > 0 && post.every(f=>f.severity==='critical'), 'contradiction locked: payroll-posted-no-transaction is CRITICAL on the SAME condition');
  }
  // GOV-006 Pair 5 — a strict SUBSET, proven in both directions.
  // (a) unexecuted transaction with a differing amount: BOTH fire.
  rule('F6','payroll-txn-mismatch','warning','payroll-txn-mismatch [subset — can never fire alone]',
    ['warning:payroll-txn-mismatch', 'warning:payroll-plan-txn-total-diff'],
    (S)=>{ S.payrollPlans = [CPP()]; S.txns = [PTX({ planned:900000 })]; });
  // (b) EXECUTED transaction (actual != null) defeats the t.actual==null guard,
  //     so the superset fires ALONE. This is what proves the subset direction.
  rule('F6','payroll-plan-txn-total-diff','warning','payroll-plan-txn-total-diff [superset — fires alone when executed]',
    ['warning:payroll-plan-txn-total-diff'],
    (S)=>{ S.payrollPlans = [CPP()]; S.txns = [PTX({ planned:900000, actual:900000 })]; });
  rule('F6','payroll-txn-missing-planid','warning','payroll-txn-missing-planid',
    ['warning:payroll-txn-missing-planid'],
    (S)=>{ S.payrollPlans = [CPP()]; S.txns = [PTX({ payrollPlanId:undefined })]; });
  // Overtime already Committed to Payroll, so payroll-overtime-uncommitted
  // (CRITICAL, SPR-081) stays silent and this rule is observed alone.
  rule('F6','payroll-plan-txn-overtime-diff','warning','payroll-plan-txn-overtime-diff',
    ['warning:payroll-plan-txn-overtime-diff'],
    (S)=>{
      S.overtimeRecords = [OT({ status:COMMITTED_OT })];
      S.payrollPlans = [CPP({ overtimeIds:['ot1'], overtime:20000, overtimeAmount:20000, plannedAmount:1020000 })];
      S.txns = [PTX({ planned:1020000, overtimeAmount:0, overtimeIds:['ot1'] })];
    });
  // Committed transaction carries overtime money but neither side lists overtime IDs.
  rule('F6','payroll-missing-overtime-ids','warning','payroll-missing-overtime-ids',
    ['warning:payroll-missing-overtime-ids'],
    (S)=>{
      S.payrollPlans = [CPP({ overtime:20000, overtimeAmount:20000, plannedAmount:1020000 })];
      S.txns = [PTX({ planned:1020000, overtimeAmount:20000 })];
    });
  // committedAt pinned AFTER 2026-07-31: a v2.7.1-era post must carry a snapshot.
  rule('F6','payroll-missing-committed-snapshot','warning','payroll-missing-committed-snapshot [committedAt AFTER the v2.7.1 threshold]',
    ['warning:payroll-missing-committed-snapshot'],
    (S)=>{ S.payrollPlans = [CPP({ committedAt:POST_V271 })]; S.txns = [PTX()]; });
  rule('F6','payroll-snapshot-txn-diff','warning','payroll-snapshot-txn-diff',
    ['warning:payroll-snapshot-txn-diff'],
    (S)=>{ S.payrollPlans = [CPP({ committedSnapshot:{ totalPayroll:777777 } })]; S.txns = [PTX()]; });

  /* ================= F7 — EMPLOYEE DEDUP =================
     EXPECTED CO-FIRING: every rule here needs two employees sharing a name, and
     that same collision is what duplicate-employee-name (CRITICAL, SPR-089) and
     duplicate-employee (warning) detect — so they travel together. Only
     duplicate-employee-id, which keys on the employeeId code rather than the
     name, isolates. Giving the duplicate its OWN contract keeps
     orphan-duplicate-employee silent where it is not the rule under test. */
  console.log('');
  console.log('===== F7 — EMPLOYEE DEDUP (6 rules) =====');
  rule('F7','duplicate-employee','warning','duplicate-employee [orphan duplicate — no linked data]',
    ['warning:duplicate-employee', 'critical:duplicate-employee-name', 'info:orphan-duplicate-employee'],
    (S)=>{ S.employees.push(DUP_EMP()); });
  // Keys on the employeeId CODE, not the name — so no duplicate group forms.
  rule('F7','duplicate-employee-id','warning','duplicate-employee-id [shared code, different name]',
    ['warning:duplicate-employee-id'],
    (S)=>{ S.employees.push(EMP({ id:'e2', fullName:'SAMPLE — Beta' })); }); // same employeeId 'E1'
  rule('F7','payroll-split-across-duplicates','warning','payroll-split-across-duplicates',
    ['warning:payroll-split-across-duplicates', 'critical:duplicate-employee-name', 'warning:duplicate-employee'],
    (S)=>{
      S.employees.push(DUP_EMP()); S.contracts.push(DUP_CT());
      S.payrollPlans = [PP(), PP({ id:'pp2', employeeId:'e2', contractId:'c2',
        contractNumber:'S/2', monthKey:M2, month:'August', monthNum:8 })];
    });
  rule('F7','overtime-split-across-duplicates','warning','overtime-split-across-duplicates',
    ['warning:overtime-split-across-duplicates', 'critical:duplicate-employee-name', 'warning:duplicate-employee'],
    (S)=>{
      S.employees.push(DUP_EMP()); S.contracts.push(DUP_CT());
      S.overtimeRecords = [OT(), OT({ id:'ot2', employeeId:'e2', contractId:'c2' })];
    });
  rule('F7','duplicate-contact-conflict','info','duplicate-contact-conflict [conflicting email]',
    ['info:duplicate-contact-conflict', 'critical:duplicate-employee-name', 'warning:duplicate-employee'],
    (S)=>{
      S.employees[0].email = 'a@sample.invalid';
      S.employees.push(EMP({ id:'e2', employeeId:'E2', email:'b@sample.invalid' }));
      S.contracts.push(DUP_CT());
    });
  rule('F7','orphan-duplicate-employee','info','orphan-duplicate-employee [duplicate with no linked data]',
    ['info:orphan-duplicate-employee', 'critical:duplicate-employee-name', 'warning:duplicate-employee'],
    (S)=>{ S.employees.push(DUP_EMP()); });

  /* ================= F9 — SUPPLEMENTAL =================
     The two snapshot rules are the SAME condition split by the v2.7.1 date
     threshold: a Posted supplemental with no frozen source snapshot is a
     WARNING if approved on/after 2026-07-31 and an INFO (legacy, display-only)
     if approved before. Both sides are pinned and asserted. */
  console.log('');
  console.log('===== F9 — SUPPLEMENTAL (3 rules) =====');
  rule('F9','supplemental-missing-source-snapshot','warning','supplemental-missing-source-snapshot [approved AFTER the v2.7.1 threshold]',
    ['warning:supplemental-missing-source-snapshot'],
    (S)=>{ S.overtimeRecords = [OT()];
           S.supplementalPayments = [SUP({ status:'Posted', approvedAt:POST_V271 })]; });
  rule('F9','supplemental-missing-source-snapshot-legacy','info','supplemental-missing-source-snapshot-legacy [approved BEFORE the threshold]',
    ['info:supplemental-missing-source-snapshot-legacy'],
    (S)=>{ S.overtimeRecords = [OT()];
           S.supplementalPayments = [SUP({ status:'Posted', approvedAt:PRE_V271 })]; });
  // Amount no longer matches the frozen source snapshot it was derived from.
  rule('F9','supplemental-amount-drift','warning','supplemental-amount-drift',
    ['warning:supplemental-amount-drift'],
    (S)=>{ S.overtimeRecords = [OT()];
           S.supplementalPayments = [SUP({ status:'Posted', approvedAt:PRE_V271, amount:999999,
             sourceOvertimeSnapshot:[{ approvedAmount:20000 }] })]; });

  /* ---------- coverage roll-up ---------- */
  console.log('');
  console.log('===== COVERAGE ROLL-UP =====');
  {
    const flat = Object.keys(COVERED).reduce((a,f)=>a.concat(COVERED[f]), []);
    check(flat.length === 25, 'coverage contract names exactly 25 rule identifiers (found ' + flat.length + ')');
    check(new Set(flat).size === 25, 'the 25 rule identifiers are distinct');
    // The family map and the machine-readable declaration must name the same set.
    const declared = Object.keys(INTEGRITY_COVERAGE.rules).sort();
    check(eqSet(flat.slice().sort(), declared), 'family map matches the INTEGRITY_COVERAGE declaration exactly');
    Object.keys(COVERED).forEach((fam)=>{
      COVERED[fam].forEach((id)=>{
        check(exercised.has(id), fam + ' exercised by a real fixture: ' + id);
      });
    });
    // No rule owned by an earlier harness may be claimed here.
    const reclaimed = OWNED_ELSEWHERE.filter((id)=>flat.indexOf(id) !== -1);
    check(reclaimed.length === 0, 'no rule owned by SPR-081/082/089/090 is re-claimed here'
      + (reclaimed.length ? ' (re-claimed: ' + reclaimed.join(', ') + ')' : ''));
    // Every id exercised as a COVERED rule must belong to this contract. The
    // invalid-amount deferred-path case above deliberately does not use rule(),
    // so it cannot pollute this set.
    const stray = Array.from(exercised).filter((id)=>flat.indexOf(id) === -1);
    check(stray.length === 0, 'no fixture claims a rule outside the contract'
      + (stray.length ? ' (stray: ' + stray.join(', ') + ')' : ''));
    // The three harnesses together must account for every emitted rule id.
    check(flat.length + OWNED_ELSEWHERE.length === 63,
      'this contract (25) plus rules owned elsewhere (' + OWNED_ELSEWHERE.length + ') accounts for all 63 rule identifiers');
  }

  console.log('');
  if(failures.length){
    console.log('RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
    failures.forEach(f => console.log('   - ' + f));
    process.exit(1);
  }
  console.log('RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
