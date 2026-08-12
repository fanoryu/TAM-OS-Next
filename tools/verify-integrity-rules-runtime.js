#!/usr/bin/env node
'use strict';
/* ============================================================
   SPR-089 — CRITICAL INTEGRITY RULE RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves that the Integrity Check EXISTS. This harness
   proves that its Critical rules actually FIRE, by executing the real
   runIntegrityCheck() against fabricated state and asserting the findings it
   returns.

   Same dependency-free Node `vm` loader technique as js/cli/cli.js and the
   SPR-077/078/079/081/082 harnesses. All fixture data is obviously fabricated.
   Nothing is written to disk and no repository file is modified.

   SCOPE — 11 of 63 rules. GOV-006 established that runIntegrityCheck() emits 63
   distinct rule identifiers (14 critical / 44 warning / 5 info). Three Critical
   rules already have OPERATION-DRIVEN coverage — payroll-orphan-transaction and
   payroll-overtime-uncommitted (SPR-081) and monthlyplan-orphan-transaction
   (SPR-082) — which is strictly stronger evidence than a hand-built fixture,
   so they are NOT re-covered here. This harness covers the remaining 11.
   Warning and Info rules are NOT covered by this harness and this harness makes
   no claim about them.

   GRANULARITY — coverage here is at RULE-IDENTIFIER granularity, which is not
   the same as predicate coverage. Several rule IDs multiplex over multiple code
   paths: duplicate-id runs over SEVEN collections and schema-error rolls up
   SEVEN validators. This harness covers ONE concrete collection path for
   duplicate-id (transactions) and the firing/non-firing BOUNDARY for
   schema-error. Full per-collection and per-validator coverage belongs to
   SPR-090 or later. Do not read "11 of 11" as full predicate coverage.

   HONESTY NOTE — this harness OBSERVES current behavior; it does not judge it.
   GOV-006 proved that current behavior contains rule aliases and at least one
   severity contradiction. Those are asserted here exactly as they behave today,
   deliberately, so that any future change to them is caught. Nothing in this
   sprint repairs them. In particular:
     * payroll-posted-no-transaction (critical) and payroll-missing-transaction
       (warning) fire together on the SAME condition. That contradiction is
       LOCKED IN below, not reconciled.
     * overtime-negative-hours (critical) and schema-error (critical) fire
       together because stabilization.js:285 and :179 use the identical
       predicate. Both are critical, so this is layering, not a contradiction.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

/* INTEGRITY-COVERAGE-BEGIN
   Machine-readable coverage ownership (GOV-007 / SPR-092). tools/verify-build.js
   parses THIS block — bounded by the sentinels — and compares it against the rule
   identifiers and severities actually emitted by runIntegrityCheck(). A rule added
   to production without an entry here, an entry here for a rule production no
   longer emits, or a severity that disagrees with production, all fail the
   verifier. The list is not a second source of truth: it is checked against the
   source on every build and cannot drift silently.
   Severities are the EXPECTED production severities, asserted per fixture below. */
const INTEGRITY_COVERAGE = {
  harness: 'verify-integrity-rules-runtime.js',
  rules: {
    'contract-multiple-employees': 'critical',
    'duplicate-employee-name': 'critical',
    'duplicate-id': 'critical',
    'overtime-double-commit': 'critical',
    'overtime-negative-hours': 'critical',
    'payroll-negative': 'critical',
    'payroll-posted-no-transaction': 'critical',
    'schema-error': 'critical',
    'supplemental-missing-transaction': 'critical',
    'supplemental-orphan-transaction': 'critical',
    'supplemental-overtime-double-capture': 'critical'
  }
};
/* INTEGRITY-COVERAGE-END */

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
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-spr089' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-spr089-runtime.js' });
  sandbox.toast = noop;
  return sandbox;
}

/* ---------- fabricated fixtures ----------
   Every value is a deterministic literal. No Date.now(), no generated id, no
   random source — runIntegrityCheck() branches on wall-clock in two places
   (the v2.7.1 snapshot thresholds at 2026-07-31), so fixture dates are pinned
   on the intended side of those thresholds and never derived from "now". */
const N   = '2026-01-01T00:00:00.000Z';   // stable createdAt/updatedAt
const M   = '2026-07';                    // primary fixture month
const M2  = '2026-08';                    // second month (avoids duplicate-month collisions)
const PRE_V271 = '2026-07-05T00:00:00.000Z'; // BEFORE the 2026-07-31 snapshot threshold

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
   (it is a wall-clock stamp) and neither is any message string (operator-facing
   prose containing formatted currency). Only category + severity are contracts. */
function cats(w){
  const r = w.runIntegrityCheck();
  return r.findings.map(f => f.severity + ':' + f.category).sort();
}
function findingsFor(w, category){
  return w.runIntegrityCheck().findings.filter(f => f.category === category);
}
const eqSet = (a,b)=> a.length===b.length && a.every((x,i)=>x===b[i]);

/* ---------- the per-rule assertion model ----------
   For each Critical rule, four assertions:
     1. NEGATIVE CONTROL — the healthy baseline does NOT raise it.
     2. FIRES           — the single-defect fixture raises it.
     3. SEVERITY        — every finding of that category is exactly 'critical'.
     4. EXACT SET       — the findings ADDED by the defect equal precisely the
                          expected set. This is the assertion that carries the
                          real weight: "it fires" is nearly free to satisfy by
                          accident, "it fires and nothing else does" proves the
                          predicate is actually scoped. Where GOV-006 proved a
                          current overlap, the co-firing entries are listed
                          explicitly here rather than suppressed.
   `expected` is the full sorted set of 'severity:category' strings the defect
   must add over the healthy baseline. */
function rule(id, label, expected, mutate){
  console.log('-- ' + id + ' — ' + label + ' --');
  const w = loadRuntime();
  const S = baseline(w);
  const before = cats(w);
  check(before.indexOf('critical:'+id) === -1, id + ': negative control — healthy baseline does NOT raise it');
  mutate(S);
  const after = cats(w);
  const added = after.filter(x => before.indexOf(x) === -1).sort();
  check(added.indexOf('critical:'+id) > -1, id + ': fires on its defect fixture');
  const own = findingsFor(w, id);
  check(own.length > 0 && own.every(f => f.severity === 'critical'), id + ': severity is exactly critical');
  const exp = expected.slice().sort();
  check(eqSet(added, exp), id + ': exact finding set is [' + exp.join(', ') + ']'
    + (eqSet(added, exp) ? '' : ' (actual: [' + added.join(', ') + '])'));
  return w;
}

(function main(){
  console.log('== SPR-089 CRITICAL INTEGRITY RULES — RUNTIME VERIFICATION ==');
  console.log('   11 of 14 Critical rules (3 already covered by SPR-081/082 operation-driven harnesses).');
  console.log('   Warning and Info rules are OUT OF SCOPE for this harness.');
  console.log('');

  /* ---------- 0. the healthy baseline ----------
     Every isolation assertion below is meaningless unless the untouched
     baseline is genuinely clean, so that is asserted FIRST and loudly. */
  console.log('-- scenario 0: healthy baseline --');
  {
    const w = loadRuntime(); baseline(w);
    const r = w.runIntegrityCheck();
    check(r.findings.length === 0, 'the healthy fabricated baseline produces ZERO findings');
    check(r.counts.critical === 0 && r.counts.warning === 0 && r.counts.info === 0, 'all three severity counts are zero');
    check(r.status === 'Healthy', 'baseline status is "Healthy"');
    check(Array.isArray(r.findings) && typeof r.ranAt === 'string', 'result shape is {findings[], counts, status, ranAt}');
    // Determinism: the same state re-checked yields the identical category set.
    check(eqSet(cats(w), cats(w)), 'repeated runs over identical state are deterministic');
  }

  /* ---------- 1. contract-multiple-employees ----------
     One contract NUMBER shared by contracts belonging to two different people. */
  console.log('');
  rule('contract-multiple-employees', 'one contract number linked to two employees',
    ['critical:contract-multiple-employees'],
    (S)=>{
      S.employees.push(EMP({ id:'e2', employeeId:'E2', fullName:'SAMPLE — Beta' }));
      S.contracts.push(CT({ id:'c2', employeeId:'e2', employeeName:'SAMPLE — Beta' })); // same contractNumber 'S/1'
    });

  /* ---------- 2. duplicate-employee-name ----------
     EXPECTED CO-FIRING (GOV-006 Pair 4). Two employees sharing a name are
     detected by three separate rules at three severities:
       * duplicate-employee-name   critical  — findEmployeeDuplicateGroups()
       * duplicate-employee        warning   — normStr(fullName) collision
       * orphan-duplicate-employee info      — the duplicate has no linked data
     These are layered detections over the same fixture, not a defect. Asserted
     as an exact set so that any future change to the layering is caught. */
  console.log('');
  rule('duplicate-employee-name', 'two employees share a name (co-fires with 2 lower-severity rules)',
    ['critical:duplicate-employee-name', 'warning:duplicate-employee', 'info:orphan-duplicate-employee'],
    (S)=>{ S.employees.push(EMP({ id:'e2', employeeId:'E2' })); }); // same fullName

  /* ---------- 3. duplicate-id ----------
     SCOPE LIMIT: duplicate-id is emitted by a shared dupIds() helper invoked over
     SEVEN collections (transactions, employees, contracts, payroll plans,
     recurring expenses, monthly plans, overtime records). This asserts ONE
     concrete collection path — transactions. The other six paths are NOT covered
     by this harness; they belong to SPR-090 or later. */
  console.log('');
  rule('duplicate-id', 'two transactions share an id (ONE of seven collection paths)',
    ['critical:duplicate-id'],
    (S)=>{ S.txns = [TX(), TX({ uraian:'SAMPLE — fabricated row 2' })]; }); // same id 't1'

  /* ---------- 4. overtime-double-commit ----------
     One approved overtime record referenced by the overtimeIds of TWO payroll
     plans — i.e. the same overtime can be paid twice. The two plans sit in
     DIFFERENT months on purpose, so the duplicate-payroll family stays silent
     and this rule is observed in isolation. */
  console.log('');
  rule('overtime-double-commit', 'one overtime record committed to two payroll plans',
    ['critical:overtime-double-commit'],
    (S)=>{
      S.overtimeRecords = [OT()];
      S.payrollPlans = [
        PP({ overtimeIds:['ot1'], overtime:20000, overtimeAmount:20000, plannedAmount:1020000 }),
        PP({ id:'pp2', monthKey:M2, month:'August', monthNum:8,
             overtimeIds:['ot1'], overtime:20000, overtimeAmount:20000, plannedAmount:1020000 })
      ];
    });

  /* ---------- 5. overtime-negative-hours ----------
     EXPECTED CO-FIRING — NEWLY DISCOVERED IN SPR-089, classified from source.
     stabilization.js:285 (the dedicated rule) and stabilization.js:179
     (validateOvertime, feeding the schema-error roll-up) apply the IDENTICAL
     predicate `num(o.overtimeHours) < 0`. Both classify as critical, so unlike
     GOV-006 Pair 3 this is layering, not a severity contradiction: the roll-up
     is a catch-all aggregator and negative hours is genuinely also a field-level
     validation error. Locked in as-is; not reconciled in this sprint. */
  console.log('');
  rule('overtime-negative-hours', 'negative overtime hours (co-fires with the schema-error roll-up)',
    ['critical:overtime-negative-hours', 'critical:schema-error'],
    (S)=>{ S.overtimeRecords = [OT({ overtimeHours:-2 })]; });

  /* ---------- 6. payroll-negative ----------
     A deduction that drives the computed total below zero. plannedAmount is left
     null on purpose: a stored NEGATIVE plannedAmount would additionally trip the
     invalid-amount warning, and a stored positive one would trip
     payroll-total-inconsistent. Null isolates the rule under test. */
  console.log('');
  rule('payroll-negative', 'deductions drive the computed payroll total below zero',
    ['critical:payroll-negative'],
    (S)=>{ S.payrollPlans = [PP({ otherDeduction:5000000, plannedAmount:null })]; });

  /* ---------- 7. payroll-posted-no-transaction ----------
     EXPECTED CO-FIRING — GOV-006 Pair 3, the KNOWN SEVERITY CONTRADICTION.
     A committed payroll row with no linked finance transaction is reported by
     TWO rules whose guards are provably co-extensive:
       * payroll-posted-no-transaction  CRITICAL (v2.7.1 block)
       * payroll-missing-transaction    WARNING  (v2.5.0 block)
     The same condition is therefore simultaneously critical and warning. This
     sprint LOCKS that behavior IN and does not reconcile it — reconciliation
     changes counts.critical and therefore the operator-facing status string,
     which is a runtime behavior change and out of scope here.
     committedAt is pinned BEFORE 2026-07-31 so the v2.7.1 missing-snapshot rule
     stays silent and the contradiction is observed cleanly. */
  console.log('');
  {
    const w = rule('payroll-posted-no-transaction', 'committed payroll with no finance transaction (KNOWN contradiction)',
      ['critical:payroll-posted-no-transaction', 'warning:payroll-missing-transaction'],
      (S)=>{ S.payrollPlans = [PP({ status:'Committed', committedAt:PRE_V271 })]; });
    // Assert BOTH sides of the contradiction explicitly, so a future severity
    // change to either rule fails here and forces a governance decision.
    const posted  = findingsFor(w, 'payroll-posted-no-transaction');
    const missing = findingsFor(w, 'payroll-missing-transaction');
    check(posted.length > 0 && posted.every(f => f.severity === 'critical'),
      'contradiction locked: payroll-posted-no-transaction is CRITICAL');
    check(missing.length > 0 && missing.every(f => f.severity === 'warning'),
      'contradiction locked: payroll-missing-transaction is WARNING on the SAME condition');
  }

  /* ---------- 8. schema-error ----------
     SCOPE LIMIT: schema-error is a ROLL-UP over seven validators. This asserts
     the firing/non-firing BOUNDARY only — one validator error makes it fire, and
     the healthy baseline keeps it silent. Per-validator coverage across all seven
     is NOT attempted here and belongs to SPR-090 or later.
     The defect is a monthly plan with no monthKey (validateMonthlyPlan pushes a
     hard error). committedTxnIds stays a valid empty array so the corrupt-plan-ref
     walk is unaffected. */
  console.log('');
  rule('schema-error', 'a field-level validator error rolls up (BOUNDARY only, not per-validator)',
    ['critical:schema-error'],
    (S)=>{ S.monthlyPlans = [{ id:'mp1', month:'July', year:2026, status:'Draft',
      committedTxnIds:[], createdAt:N, updatedAt:N }]; }); // monthKey deliberately absent

  /* ---------- 9. supplemental-missing-transaction ---------- */
  console.log('');
  rule('supplemental-missing-transaction', 'supplemental points at a finance transaction that does not exist',
    ['critical:supplemental-missing-transaction'],
    (S)=>{
      S.overtimeRecords = [OT()];
      S.supplementalPayments = [SUP({ financeTransactionId:'MISSING' })];
    });

  /* ---------- 10. supplemental-orphan-transaction ----------
     The opposite direction: a finance transaction pointing at a supplemental
     that does not exist. */
  console.log('');
  rule('supplemental-orphan-transaction', 'finance transaction points at a supplemental that does not exist',
    ['critical:supplemental-orphan-transaction'],
    (S)=>{ S.txns = [TX({ supplementalId:'MISSING' })]; });

  /* ---------- 11. supplemental-overtime-double-capture ----------
     One overtime record captured by TWO non-cancelled supplementals — the
     supplemental-side equivalent of double payment. */
  console.log('');
  rule('supplemental-overtime-double-capture', 'one overtime record captured by two non-cancelled supplementals',
    ['critical:supplemental-overtime-double-capture'],
    (S)=>{
      S.overtimeRecords = [OT()];
      S.supplementalPayments = [SUP(), SUP({ id:'sp2' })];
    });

  /* ---------- coverage roll-up ----------
     Asserts that this harness really did exercise all 11 in-scope rule IDs —
     a guard against a rule block being deleted or commented out without the
     total changing in an obvious way. */
  console.log('');
  console.log('-- coverage roll-up --');
  {
    // The declaration above is the single in-file contract; the roll-up walks it
    // rather than a second literal list, so the two cannot disagree.
    const REQUIRED = Object.keys(INTEGRITY_COVERAGE.rules);
    const self = fs.readFileSync(__filename,'utf8');
    REQUIRED.forEach((id)=>{
      check(self.indexOf("rule('" + id + "'") > -1, 'covered by an explicit rule() block: ' + id);
    });
    check(REQUIRED.length === 11, 'exactly 11 Critical rule IDs are in scope for this harness');
    check(REQUIRED.every((id)=>INTEGRITY_COVERAGE.rules[id] === 'critical'), 'every declared rule in this harness is declared critical');
    // The three already-covered Critical rules are deliberately NOT re-covered here.
    ['payroll-orphan-transaction','payroll-overtime-uncommitted','monthlyplan-orphan-transaction']
      .forEach((id)=>{
        check(self.indexOf("rule('" + id + "'") === -1,
          'NOT re-covered here (operation-driven coverage is stronger): ' + id);
      });
  }

  console.log('');
  if(failures.length){
    console.log('RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
    failures.forEach(f => console.log('   - ' + f));
    process.exit(1);
  }
  console.log('RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
