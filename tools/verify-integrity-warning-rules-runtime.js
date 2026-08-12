#!/usr/bin/env node
'use strict';
/* ============================================================
   SPR-090 — WARNING / INFO INTEGRITY RULE RUNTIME VERIFICATION
   Fixture families F1 / F2 / F3 / F4 / F8 / F10 / F11
   ------------------------------------------------------------
   Companion to tools/verify-integrity-rules-runtime.js (SPR-089), which covers
   the Critical tier. This harness covers the FIRST HALF of the Warning/Info
   tier, partitioned by FIXTURE FAMILY rather than by severity — SPR-090A
   measured that the Info rules are not separable from the Warning rules they
   co-fire with, so a severity split would force the same fixtures to be built
   twice.

   Same dependency-free Node `vm` loader technique as js/cli/cli.js and the
   SPR-077/078/079/081/082/089 harnesses. All fixture data is obviously
   fabricated. Nothing is written to disk and no repository file is modified.

   SCOPE — 24 of 63 rule identifiers, in seven families:
     F1  referential links     6
     F2  field validity        4
     F3  duplicate cluster     4  (3 exercised here; see note)
     F4  overtime              6
     F8  import batch          2
     F10 adjustment            1
     F11 schema roll-up        1
   The remaining 25 Warning/Info rules belong to families F5 (payroll plan
   state), F6 (posted provenance), F7 (employee dedup) and F9 (supplemental).
   They are RESERVED FOR SPR-091 and are NOT covered here. This harness makes
   no claim about them.

   PREDICATE COVERAGE IS NARROWER THAN RULE-ID COVERAGE. Three rules in scope
   multiplex over independent sub-predicates, and this harness exercises them
   as follows:
     * invalid-date        2 of 2 paths (employee joinDate, contract startDate)
     * invalid-amount      2 of 3 paths (transaction, contract) — the payroll
                           plan path is DEFERRED because its only companion
                           finding is payroll-total-inconsistent, an F5 rule
                           reserved for SPR-091
     * overtime-bad-snapshot  3 of 3 sub-predicates
   duplicate-id and schema-error remain partially covered from SPR-089 and are
   out of scope here. Do not read "24 of 24 rule IDs" as complete predicate
   coverage.

   HONESTY NOTE — this harness OBSERVES current behavior; it does not judge it.
   Current behavior contains rule aliases and layered detections. They are
   asserted here exactly as they behave today, deliberately, so that any future
   change is caught. Nothing in this sprint repairs, renames, removes or
   reclassifies any rule. In particular:
     * duplicate-payroll and duplicate-payroll-plan apply an IDENTICAL predicate
       and never fire apart; payroll-duplicate-month joins them on the natural
       fixture as a coarser superset. All three are locked in as-is.
     * schema-warning is a validator ROLL-UP companion: several rules in F2/F4
       cannot fire without it, because the validator warns on the very condition
       the rule detects. Those co-firings are asserted, not suppressed.
     * invalid-date on the CONTRACT path drags in schema-error at CRITICAL,
       because validateContract raises a hard error for an invalid startDate.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

/* The 24 rule identifiers this harness is responsible for, grouped by fixture
   family. This list is the harness's coverage contract: every id here must be
   exercised by at least one rule() call, asserted mechanically at the end. */
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
  harness: 'verify-integrity-warning-rules-runtime.js',
  rules: {
    'broken-employee-link': 'warning',
    'broken-contract-link': 'warning',
    'broken-payroll-link': 'warning',
    'corrupt-plan-ref': 'warning',
    'orphan-transaction': 'warning',
    'broken-import-link': 'warning',
    'invalid-date': 'warning',
    'invalid-amount': 'warning',
    'overlapping-contracts': 'warning',
    'invalid-contract-evidence': 'warning',
    'duplicate-payroll': 'warning',
    'duplicate-payroll-plan': 'warning',
    'payroll-duplicate-month': 'warning',
    'duplicate-payroll-txn': 'warning',
    'overtime-broken-employee': 'warning',
    'overtime-broken-contract': 'warning',
    'overtime-broken-payroll': 'warning',
    'overtime-bad-snapshot': 'warning',
    'overtime-outside-contract': 'warning',
    'overtime-payroll-mismatch': 'warning',
    'import-multiple-employees-per-candidate': 'warning',
    'rollback-preserved': 'info',
    'adjustment-invalid-period': 'warning',
    'schema-warning': 'info'
  }
};
/* INTEGRITY-COVERAGE-END */

/* The same 24 identifiers grouped by fixture family, for the per-family roll-up
   below. Derived from the declaration above — the family map may not introduce
   an identifier the declaration does not carry, asserted in the roll-up. */
const COVERED = {
  F1: ['broken-employee-link','broken-contract-link','broken-payroll-link',
       'corrupt-plan-ref','orphan-transaction','broken-import-link'],
  F2: ['invalid-date','invalid-amount','overlapping-contracts','invalid-contract-evidence'],
  F3: ['duplicate-payroll','duplicate-payroll-plan','payroll-duplicate-month','duplicate-payroll-txn'],
  F4: ['overtime-broken-employee','overtime-broken-contract','overtime-broken-payroll',
       'overtime-bad-snapshot','overtime-outside-contract','overtime-payroll-mismatch'],
  F8: ['import-multiple-employees-per-candidate','rollback-preserved'],
  F10:['adjustment-invalid-period'],
  F11:['schema-warning']
};
/* Families reserved for SPR-091. Asserted ABSENT from this harness's contract so
   a future edit cannot quietly claim them. */
const RESERVED_SPR091 = [
  'payroll-without-employee','payroll-no-employee','payroll-no-contract','payroll-outside-contract',
  'payroll-overtime-broken','payroll-total-inconsistent','payroll-missing-monthlyplan',
  'payroll-override-no-reason','payroll-missing-transaction','payroll-txn-mismatch',
  'payroll-txn-missing-planid','payroll-plan-txn-total-diff','payroll-plan-txn-overtime-diff',
  'payroll-missing-overtime-ids','payroll-missing-committed-snapshot','payroll-snapshot-txn-diff',
  'duplicate-employee','duplicate-employee-id','payroll-split-across-duplicates',
  'overtime-split-across-duplicates','duplicate-contact-conflict','orphan-duplicate-employee',
  'supplemental-missing-source-snapshot','supplemental-missing-source-snapshot-legacy',
  'supplemental-amount-drift'
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
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-spr090' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-spr090-runtime.js' });
  sandbox.toast = noop;
  return sandbox;
}

/* ---------- fabricated fixtures ----------
   Every value is a deterministic literal. runIntegrityCheck() branches on
   wall-clock at the v2.7.1 thresholds (2026-07-31), so fixture dates are pinned
   on the intended side and never derived from "now". */
const N   = '2026-01-01T00:00:00.000Z';       // stable createdAt/updatedAt
const M   = '2026-07';                        // primary fixture month
const M2  = '2026-08';                        // second month
const PRE_V271 = '2026-07-05T00:00:00.000Z';  // BEFORE the 2026-07-31 threshold
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
const MP = (o)=>Object.assign({ id:'mp1', monthKey:M, month:'July', year:2026,
  status:'Draft', committedTxnIds:[], createdAt:N, updatedAt:N }, o);

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
   containing formatted currency). Only category + severity are contracts.
   Sorting also means finding ORDER within a severity is never asserted. */
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
                          expected set. Where isolation is impossible the
                          co-firing entries are listed explicitly rather than
                          suppressed.
   `label` distinguishes sub-predicate variants of the same rule id; failure
   messages carry family + label so a failure names exactly what broke. */
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
  console.log('== SPR-090 WARNING / INFO INTEGRITY RULES — RUNTIME VERIFICATION ==');
  console.log('   Fixture families F1 / F2 / F3 / F4 / F8 / F10 / F11 — 24 rule identifiers.');
  console.log('   Families F5 / F6 / F7 / F9 (25 rules) are RESERVED FOR SPR-091 and NOT covered.');
  console.log('   Rule-identifier coverage is NOT complete predicate coverage — see header.');
  console.log('');

  /* ---------- 0. the healthy baseline ----------
     Every isolation assertion below is meaningless unless the untouched
     baseline is genuinely clean, so that is asserted FIRST and loudly. */
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

  /* ================= F1 — REFERENTIAL LINKS =================
     Every rule here is a dangling identifier reference. All six isolate
     cleanly: the transaction validator never inspects employeeId/contractId/
     payrollPlanId/importBatchId, so a dangling link raises the link rule alone. */
  console.log('');
  console.log('===== F1 — REFERENTIAL LINKS (6 rules) =====');
  rule('F1','broken-employee-link','warning','broken-employee-link',
    ['warning:broken-employee-link'],
    (S)=>{ S.txns = [TX({ employeeId:'GHOST' })]; });
  rule('F1','broken-contract-link','warning','broken-contract-link',
    ['warning:broken-contract-link'],
    (S)=>{ S.txns = [TX({ contractId:'GHOST' })]; });
  rule('F1','broken-payroll-link','warning','broken-payroll-link',
    ['warning:broken-payroll-link'],
    (S)=>{ S.txns = [TX({ payrollPlanId:'GHOST' })]; });
  rule('F1','corrupt-plan-ref','warning','corrupt-plan-ref',
    ['warning:corrupt-plan-ref'],
    (S)=>{ S.monthlyPlans = [MP({ committedTxnIds:['GHOST'] })]; });
  // A payroll-sourced transaction carrying NO employee/contract link at all.
  rule('F1','orphan-transaction','warning','orphan-transaction',
    ['warning:orphan-transaction'],
    (S)=>{ S.txns = [TX({ source:'payroll', employeeId:null, contractId:null })]; });
  rule('F1','broken-import-link','warning','broken-import-link',
    ['warning:broken-import-link'],
    (S)=>{ S.txns = [TX({ importBatchId:'GHOST' })]; });

  /* ================= F2 — FIELD VALIDITY =================
     Surrounding objects are valid; only the field under test is defective, so
     the finding is caused by the intended defect and not by a malformed fixture.
     EXPECTED CO-FIRING: the validators inspect these same fields, so the
     schema roll-up follows the rule. Which roll-up depends on the path —
     validateEmployee WARNS on a bad joinDate (schema-warning) while
     validateContract raises an ERROR on a bad startDate (schema-error, CRITICAL). */
  console.log('');
  console.log('===== F2 — FIELD VALIDITY (4 rules, 6 predicate paths) =====');
  rule('F2','invalid-date','warning','invalid-date [path 1/2: employee joinDate]',
    ['warning:invalid-date', 'info:schema-warning'],
    (S)=>{ S.employees[0].joinDate = 'not-a-date'; });
  rule('F2','invalid-date','warning','invalid-date [path 2/2: contract startDate]',
    ['warning:invalid-date', 'critical:schema-error'],
    (S)=>{ S.contracts[0].startDate = 'not-a-date'; });
  rule('F2','invalid-amount','warning','invalid-amount [path 1/3: transaction planned]',
    ['warning:invalid-amount', 'info:schema-warning'],
    (S)=>{ S.txns = [TX({ planned:-5 })]; });
  rule('F2','invalid-amount','warning','invalid-amount [path 2/3: contract monthlySalary]',
    ['warning:invalid-amount', 'info:schema-warning'],
    (S)=>{ S.contracts[0].monthlySalary = -5; });
  // Path 3/3 (payroll plan plannedAmount) is DEFERRED: its only companion is
  // payroll-total-inconsistent, an F5 rule reserved for SPR-091.
  rule('F2','overlapping-contracts','warning','overlapping-contracts',
    ['warning:overlapping-contracts'],
    (S)=>{ S.contracts.push(CT({ id:'c2', contractNumber:'S/2' })); });
  // invalid-contract-evidence REQUIRES an invalid startDate, which is itself a
  // validateContract error — so it can never fire alone. Three findings, locked.
  rule('F2','invalid-contract-evidence','warning','invalid-contract-evidence',
    ['warning:invalid-contract-evidence', 'warning:invalid-date', 'critical:schema-error'],
    (S)=>{ S.contracts[0].importEvidence = { row:1 }; S.contracts[0].startDate = 'not-a-date'; });

  /* ================= F3 — DUPLICATE CLUSTER =================
     duplicate-payroll and duplicate-payroll-plan build a BYTE-IDENTICAL key
     (monthKey|employeeId|contractId) over the same collection with no differing
     guard — they never fire apart. payroll-duplicate-month uses a COARSER key
     (monthKey|employeeId) and is therefore a genuine superset, joining them on
     the natural fixture but separable (proved below). Locked in as-is. */
  console.log('');
  console.log('===== F3 — DUPLICATE CLUSTER (4 rules) =====');
  {
    const w = rule('F3','duplicate-payroll','warning','duplicate-payroll (cluster: all three fire)',
      ['warning:duplicate-payroll', 'warning:duplicate-payroll-plan', 'warning:payroll-duplicate-month'],
      (S)=>{ S.payrollPlans = [PP(), PP({ id:'pp2' })]; });
    exercised.add('duplicate-payroll-plan');
    // Assert the alias explicitly: identical counts prove the shared predicate.
    const a = findingsFor(w,'duplicate-payroll'), b = findingsFor(w,'duplicate-payroll-plan');
    check(a.length === 1 && b.length === 1, 'alias locked: duplicate-payroll and duplicate-payroll-plan both raise exactly one finding');
    check(a.every(f=>f.severity==='warning') && b.every(f=>f.severity==='warning'), 'alias locked: both alias rules are WARNING');
  }
  // Separability: same employee + month, DIFFERENT contracts, with the second
  // contract Cancelled so overlappingActiveContracts (Active-only) stays silent.
  // This proves payroll-duplicate-month is a real superset, not a third alias.
  rule('F3','payroll-duplicate-month','warning','payroll-duplicate-month ISOLATED (different contracts)',
    ['warning:payroll-duplicate-month'],
    (S)=>{
      S.contracts.push(CT({ id:'c2', contractNumber:'S/2', status:'Cancelled' }));
      S.payrollPlans = [PP(), PP({ id:'pp2', contractId:'c2', contractNumber:'S/2' })];
    });
  rule('F3','duplicate-payroll-txn','warning','duplicate-payroll-txn',
    ['warning:duplicate-payroll-txn'],
    (S)=>{ S.txns = [TX({ source:'payroll', employeeId:'e1', contractId:'c1' }),
                     TX({ id:'t2', source:'payroll', employeeId:'e1', contractId:'c1' })]; });

  /* ================= F4 — OVERTIME =================
     EXPECTED CO-FIRING: validateOvertime warns on a missing employee, a missing
     contract, and a non-positive monthlyStandardHours — the same conditions
     three of these rules detect — so schema-warning follows. The payroll-link
     and outside-contract rules are not validated, so they isolate. */
  console.log('');
  console.log('===== F4 — OVERTIME (6 rules, 8 predicate paths) =====');
  rule('F4','overtime-broken-employee','warning','overtime-broken-employee',
    ['warning:overtime-broken-employee', 'info:schema-warning'],
    (S)=>{ S.overtimeRecords = [OT({ employeeId:'GHOST' })]; });
  rule('F4','overtime-broken-contract','warning','overtime-broken-contract',
    ['warning:overtime-broken-contract', 'info:schema-warning'],
    (S)=>{ S.overtimeRecords = [OT({ contractId:'GHOST' })]; });
  rule('F4','overtime-broken-payroll','warning','overtime-broken-payroll',
    ['warning:overtime-broken-payroll'],
    (S)=>{ S.overtimeRecords = [OT({ payrollPlanId:'GHOST' })]; });
  // overtime-bad-snapshot has THREE independent sub-predicates; all three covered.
  rule('F4','overtime-bad-snapshot','warning','overtime-bad-snapshot [1/3: monthlyStandardHours]',
    ['warning:overtime-bad-snapshot', 'info:schema-warning'],
    (S)=>{ S.overtimeRecords = [OT({ monthlyStandardHours:0 })]; });
  rule('F4','overtime-bad-snapshot','warning','overtime-bad-snapshot [2/3: hourlyRate]',
    ['warning:overtime-bad-snapshot'],
    (S)=>{ S.overtimeRecords = [OT({ hourlyRate:-1 })]; });
  rule('F4','overtime-bad-snapshot','warning','overtime-bad-snapshot [3/3: calculatedAmount]',
    ['warning:overtime-bad-snapshot'],
    (S)=>{ S.overtimeRecords = [OT({ calculatedAmount:'abc' })]; });
  rule('F4','overtime-outside-contract','warning','overtime-outside-contract',
    ['warning:overtime-outside-contract'],
    (S)=>{ S.overtimeRecords = [OT({ monthKey:'2030-01', overtimeDate:'2030-01-10' })]; });
  // The linked overtime is already "Committed to Payroll" on purpose: leaving it
  // Approved would additionally raise payroll-overtime-uncommitted (CRITICAL,
  // already covered by SPR-081), masking this rule. Isolated deliberately.
  rule('F4','overtime-payroll-mismatch','warning','overtime-payroll-mismatch',
    ['warning:overtime-payroll-mismatch'],
    (S)=>{
      S.overtimeRecords = [OT({ status:COMMITTED_OT })];
      S.payrollPlans = [PP({ status:'Committed', committedAt:PRE_V271, committedTxnId:'t1',
        overtimeIds:['ot1'], overtime:999999, overtimeAmount:999999, plannedAmount:1999999 })];
      S.txns = [TX({ id:'t1', source:'payroll', payrollPlanId:'pp1', employeeId:'e1',
        contractId:'c1', planned:1999999, overtimeAmount:999999 })];
    });

  /* ================= F8 — IMPORT BATCH =================
     Fabricated import batches and candidate mappings only. */
  console.log('');
  console.log('===== F8 — IMPORT BATCH (2 rules) =====');
  // A batch that created MORE employees than it had distinct candidates.
  rule('F8','import-multiple-employees-per-candidate','warning','import-multiple-employees-per-candidate',
    ['warning:import-multiple-employees-per-candidate'],
    (S)=>{ S.importBatches = [{ batchId:'b1', undone:false,
      candidateMap:{ r1:'cand1', r2:'cand1' }, created:{ employees:['e1','e2'] }, createdAt:N }]; });
  // An UNDONE batch whose created transaction was already executed, so rollback
  // deliberately preserved it. Informational by design — expected, not a fault.
  rule('F8','rollback-preserved','info','rollback-preserved',
    ['info:rollback-preserved'],
    (S)=>{ S.txns = [TX({ actual:1000000, importBatchId:'b1' })];
           S.importBatches = [{ batchId:'b1', undone:true, created:{ txns:['t1'] }, createdAt:N }]; });

  /* ================= F10 — ADJUSTMENT ================= */
  console.log('');
  console.log('===== F10 — ADJUSTMENT (1 rule) =====');
  rule('F10','adjustment-invalid-period','warning','adjustment-invalid-period',
    ['warning:adjustment-invalid-period'],
    (S)=>{ S.payrollAdjustments = [{ id:'adj1', employeeId:'e1',
      startMonth:M2, endMonth:M, amount:1000, createdAt:N, updatedAt:N }]; });

  /* ================= F11 — SCHEMA ROLL-UP =================
     SCOPE LIMIT: schema-warning is a ROLL-UP over seven validators. This asserts
     the firing/non-firing BOUNDARY only — one validator warning makes it fire,
     and the healthy baseline keeps it silent. Per-validator coverage across all
     seven is NOT attempted here. An unrecognized employmentStatus is chosen
     because validateEmployee warns without any rule in scope also reacting. */
  console.log('');
  console.log('===== F11 — SCHEMA ROLL-UP (1 rule, boundary only) =====');
  rule('F11','schema-warning','info','schema-warning [roll-up BOUNDARY, not per-validator]',
    ['info:schema-warning'],
    (S)=>{ S.employees[0].employmentStatus = 'NotAStatus'; });

  /* ---------- coverage roll-up ----------
     Asserts this harness really exercised every id in its contract, and that it
     has NOT quietly grown into the SPR-091 families. */
  console.log('');
  console.log('===== COVERAGE ROLL-UP =====');
  {
    const flat = Object.keys(COVERED).reduce((a,f)=>a.concat(COVERED[f]), []);
    check(flat.length === 24, 'coverage contract names exactly 24 rule identifiers (found ' + flat.length + ')');
    check(new Set(flat).size === 24, 'the 24 rule identifiers are distinct');
    // The family map and the machine-readable declaration must name the same set.
    const declared = Object.keys(INTEGRITY_COVERAGE.rules).sort();
    check(eqSet(flat.slice().sort(), declared), 'family map matches the INTEGRITY_COVERAGE declaration exactly');
    Object.keys(COVERED).forEach((fam)=>{
      COVERED[fam].forEach((id)=>{
        check(exercised.has(id), fam + ' exercised by a real fixture: ' + id);
      });
    });
    // SPR-091 families must not appear in this harness's contract.
    const claimed = RESERVED_SPR091.filter((id)=>flat.indexOf(id) !== -1);
    check(claimed.length === 0, 'no SPR-091 family rule is claimed as covered here'
      + (claimed.length ? ' (claimed: ' + claimed.join(', ') + ')' : ''));
    check(RESERVED_SPR091.length === 25, 'exactly 25 rules remain reserved for SPR-091');
    // Every id exercised must be one this harness is responsible for.
    const stray = Array.from(exercised).filter((id)=>flat.indexOf(id) === -1);
    check(stray.length === 0, 'no fixture exercises a rule outside the contract'
      + (stray.length ? ' (stray: ' + stray.join(', ') + ')' : ''));
  }

  console.log('');
  if(failures.length){
    console.log('RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
    failures.forEach(f => console.log('   - ' + f));
    process.exit(1);
  }
  console.log('RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
