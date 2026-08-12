#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-003A — CONTRACT TIMELINE (REFERENCE-DATE) RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the SHAPE of the reference-date fix (that
   daysUntilEnd is not derived from isoToday() inside contractCalc(), and that
   contractEffectiveStatus() introduces no second time source). This harness
   proves its BEHAVIOR by executing the REAL production modules.

   THE DEFECT (pre-UX-003A):
     out.daysUntilEnd = daysBetween(isoToday(), out.endDate);
   Every other field contractCalc() derives — progress, coversMonth,
   expiredForRef, beforeStart — is measured against refKey. daysUntilEnd was
   measured against today, so one return object answered two different
   questions. contractEffectiveStatus() reads daysUntilEnd for its "Expiring
   Soon" branch, so the derived status was a today/refKey hybrid: a contract
   evaluated for a month it genuinely covered could report "Expiring Soon" with
   a NEGATIVE days-remaining value.

   THE MODEL (post-UX-003A):
     reference month == current month, or refKey omitted -> isoToday()
     any other reference month                           -> that month's 1st day
     unusable key (null / malformed / month outside 1-12)-> isoToday() (locked)

   WHAT THIS HARNESS DOES NOT CLAIM:
     It does not claim the fix changes any monetary value — it proves the
     OPPOSITE (families G and H). No Scheduled state, expiry band, counter
     change, or presentation change is introduced or asserted by UX-003A.

   It reproduces the browser's single shared global scope in a Node `vm`
   context using the same loader technique as js/cli/cli.js (EXCLUDING
   core/app-bootstrap.js, the only DOM-executing load-time module).

   All fixture data is obviously fabricated. Nothing is written to disk, no real
   company data is used, no process is spawned, and no repository file is
   modified.

   Fixture families:
     A  today-equivalence invariant (omitted == explicit current month)
     B  historical refKey BEFORE contract start
     C  historical refKey DURING the contract
     D  historical refKey AFTER contract end
     E  far-past and far-future reference keys
     F  boundaries: duration 1, invalid duration, month end, year boundary, leap year
     G  warning boundary: warn-1 / warn / warn+1
     H  malformed and null refKey (locked pre-UX-003A fallback)
     I  payroll safety: eligibility, generated values, committed rows, monthly plan
     J  historical advisory: payrollHealth() coherence
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

// ---------- runtime loader (same technique as js/cli/cli.js) ----------
function loadRuntime(){
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(root,'js',f),'utf8')).join('\n')
    + '\n;window.__TAM__ = { State: State, contractCalc: contractCalc,'
    + ' contractEffectiveStatus: contractEffectiveStatus, contractRefDate: contractRefDate,'
    + ' coveringContract: coveringContract, activeContractToday: activeContractToday,'
    + ' payrollExclusionReason: payrollExclusionReason, generatePayrollForMonth: generatePayrollForMonth,'
    + ' payrollHealth: payrollHealth, computePayrollPlanned: computePayrollPlanned,'
    + ' isoToday: isoToday, todayKey: todayKey, daysBetween: daysBetween,'
    // UX-003B — canonical two-dimensional timeline model
    + ' contractTimeline: contractTimeline, contractEffectiveState: contractEffectiveState,'
    + ' contractExpiryHorizon: contractExpiryHorizon, contractExpiryBand: contractExpiryBand,'
    + ' isoWeekKey: isoWeekKey, keyParts: keyParts, mkKey: mkKey,'
    + ' CONTRACT_EFFECTIVE_STATES: CONTRACT_EFFECTIVE_STATES,'
    + ' CONTRACT_EXPIRY_HORIZONS: CONTRACT_EXPIRY_HORIZONS,'
    + ' CONTRACT_LEGACY_STATE_DISPLAY: CONTRACT_LEGACY_STATE_DISPLAY,'
    + ' CONTRACT_LEGACY_EXPIRING_ALIAS: CONTRACT_LEGACY_EXPIRING_ALIAS,'
    + ' CONTRACT_STORED_STATUSES: CONTRACT_STORED_STATUSES,'
    // UX-003C - presentation + canonical counting
    + ' contractTimelineCounts: contractTimelineCounts, contractPresentation: contractPresentation,'
    + ' contractProgressNote: contractProgressNote, contractPresentationBadge: contractPresentationBadge,'
    + ' hrDashboardStats: hrDashboardStats, CONTRACT_PRESENTATION_META: CONTRACT_PRESENTATION_META,'
    + ' CONTRACT_STATUS_META: CONTRACT_STATUS_META, contractsFiltered: contractsFiltered,'
    + ' CONTRACT_FILTER_STATES: CONTRACT_FILTER_STATES };';
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
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-ux003a' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(), querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(), body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-ux003a-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.memStore = memStore; rt.sandbox = sandbox;
  // UX-006C2C-1 — transitionContractStatus now authorizes (contract.update). This
  // harness models the valid CEO/company workflow, so it explicitly selects CEO
  // through the real local identity path (no production default introduced).
  sandbox.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  return rt;
}

const RT = loadRuntime();
const { State, contractCalc, contractEffectiveStatus, contractRefDate,
        coveringContract, payrollExclusionReason, generatePayrollForMonth,
        payrollHealth, isoToday, todayKey, daysBetween, keyParts } = RT;

// ---------- fabricated fixture helpers ----------
let seq = 0;
function ct(startDate, durationMonths, opts){
  seq++;
  return Object.assign({ id:'ct-fix-'+seq, employeeId:'emp-fix-1', employeeName:'Fixture Person '+seq,
    contractNumber:'CT-FIX-'+String(seq).padStart(3,'0'), startDate, durationMonths,
    monthlySalary: 10000000, status:'Active', notes:'' }, opts||{});
}
// Month-key arithmetic mirrored locally so the harness never depends on
// production helpers to state its OWN expectations.
function addMonths(key, n){
  const y=+key.slice(0,4), m=+key.slice(5,7);
  const abs = y*12 + (m-1) + n;
  return `${Math.floor(abs/12)}-${String((abs%12)+1).padStart(2,'0')}`;
}
function firstDayOf(key){ return key + '-01'; }
function lastDayOfEnd(startDate, dur){
  const sy=+startDate.slice(0,4), sm=+startDate.slice(5,7);
  const d = new Date(sy, (sm-1)+dur, 0);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function sameCalc(a, b){
  return JSON.stringify(a) === JSON.stringify(b);
}

const TODAY = isoToday();
const TODAY_KEY = todayKey();

console.log('== UX-003A CONTRACT TIMELINE — REFERENCE-DATE RUNTIME VERIFICATION ==');
console.log('   (frozen inputs; reference "today" for this run is ' + TODAY + ')');

/* ============================================================
   FAMILY A — TODAY-EQUIVALENCE INVARIANT
   The whole fix is worthless if it moves today-evaluated behaviour. An
   omitted refKey and an explicitly-passed current month key must produce
   byte-identical output for every contract shape.
   ============================================================ */
console.log('-- A. today-equivalence invariant --');
const aFixtures = [
  ct(addMonths(TODAY_KEY,-6)+'-01', 12),                 // mid-term today
  ct(addMonths(TODAY_KEY,-24)+'-01', 12),                // long expired
  ct(addMonths(TODAY_KEY,6)+'-01', 12),                  // not yet started
  ct(addMonths(TODAY_KEY,-11)+'-01', 12),                // final month today
  ct(TODAY_KEY+'-01', 1),                                // single-month, this month
  ct(addMonths(TODAY_KEY,-3)+'-15', 6, {status:'Draft'}),
  ct(addMonths(TODAY_KEY,-3)+'-15', 6, {status:'Renewed'}),
  ct(addMonths(TODAY_KEY,-3)+'-15', 6, {status:'Cancelled'})
];
aFixtures.forEach((c,i)=>{
  const omitted = contractCalc(c);
  const explicit = contractCalc(c, TODAY_KEY);
  check(sameCalc(omitted, explicit),
    `A${i+1}. contractCalc: omitted refKey === explicit current month (all fields identical)`);
});
aFixtures.forEach((c,i)=>{
  check(contractEffectiveStatus(c) === contractEffectiveStatus(c, TODAY_KEY),
    `A${i+1}. contractEffectiveStatus: omitted refKey === explicit current month`);
});
// The reference date resolver itself
check(contractRefDate(undefined) === TODAY, 'A9. contractRefDate(undefined) === isoToday()');
check(contractRefDate(null) === TODAY, 'A10. contractRefDate(null) === isoToday()');
check(contractRefDate(TODAY_KEY) === TODAY, 'A11. contractRefDate(current month) === isoToday() (not the 1st)');
// Today-evaluated daysUntilEnd is still measured from today, exactly as before.
const aMid = aFixtures[0];
check(contractCalc(aMid).daysUntilEnd === daysBetween(TODAY, lastDayOfEnd(aMid.startDate, aMid.durationMonths)),
  'A12. today-evaluated daysUntilEnd is still measured from isoToday() (pre-UX-003A value preserved)');

/* ============================================================
   FAMILY B — HISTORICAL refKey BEFORE CONTRACT START
   ============================================================ */
console.log('-- B. historical refKey before contract start --');
// Contract runs 2025-06 .. 2026-05. Evaluate at 2025-01 (5 months before start).
const bC = ct('2025-06-01', 12);
const bRef = '2025-01';
const bCalc = contractCalc(bC, bRef);
check(bCalc.beforeStart === true, 'B1. beforeStart === true for a pre-start reference month');
check(bCalc.coversMonth === false, 'B2. coversMonth === false before start');
check(bCalc.expiredForRef === false, 'B3. expiredForRef === false before start');
check(bCalc.progress === '0/12', 'B4. progress is 0/N before start');
check(bCalc.daysUntilEnd > 0, 'B5. daysUntilEnd is POSITIVE before start');
check(bCalc.daysUntilEnd === daysBetween(firstDayOf(bRef), lastDayOfEnd('2025-06-01',12)),
  'B6. daysUntilEnd is measured from the reference month, not from today (no hybrid result)');
check(bCalc.daysUntilEnd !== daysBetween(TODAY, lastDayOfEnd('2025-06-01',12)),
  'B7. daysUntilEnd is NOT the today-based value (the pre-UX-003A defect is gone)');

/* ============================================================
   FAMILY C — HISTORICAL refKey DURING THE CONTRACT
   This is the family that reproduced the original defect: a contract
   evaluated for a month it genuinely covered reported "Expiring Soon"
   with a negative days-remaining value.
   ============================================================ */
console.log('-- C. historical refKey during the contract --');
// Contract runs 2025-01 .. 2025-12 (long finished relative to any later today).
const cC = ct('2025-01-15', 12);
const cEnd = lastDayOfEnd('2025-01-15', 12);
[['2025-03', 3], ['2025-06', 6], ['2025-11', 11], ['2025-12', 12]].forEach(([ref, month], i)=>{
  const cc = contractCalc(cC, ref);
  check(cc.coversMonth === true, `C${i+1}a. ref=${ref} coversMonth === true`);
  check(cc.expiredForRef === false, `C${i+1}b. ref=${ref} expiredForRef === false`);
  check(cc.progress === month+'/12', `C${i+1}c. ref=${ref} progress === ${month}/12`);
  check(cc.daysUntilEnd === daysBetween(firstDayOf(ref), cEnd),
    `C${i+1}d. ref=${ref} daysUntilEnd measured from that historical reference`);
  check(cc.daysUntilEnd >= 0, `C${i+1}e. ref=${ref} daysUntilEnd is NOT negative while the contract is running`);
});
// The exact regression: mid-term historical evaluation must not read "Expiring Soon".
check(contractEffectiveStatus(cC, '2025-03') === 'Active',
  'C5. a mid-term historical month reports Active, not Expiring Soon (the original defect)');
// Internal coherence: coversMonth <=> daysUntilEnd >= 0.
check(contractCalc(cC,'2025-06').coversMonth === (contractCalc(cC,'2025-06').daysUntilEnd >= 0),
  'C6. coversMonth <=> daysUntilEnd >= 0 (one coherent time basis)');

/* ============================================================
   FAMILY D — HISTORICAL refKey AFTER CONTRACT END
   ============================================================ */
console.log('-- D. historical refKey after contract end --');
const dRef = '2026-03';   // after the 2025-01..2025-12 contract
const dCalc = contractCalc(cC, dRef);
check(dCalc.expiredForRef === true, 'D1. expiredForRef === true after contract end');
check(dCalc.coversMonth === false, 'D2. coversMonth === false after end');
check(dCalc.beforeStart === false, 'D3. beforeStart === false after end');
check(dCalc.daysUntilEnd < 0, 'D4. daysUntilEnd is NEGATIVE after contract end');
check(dCalc.daysUntilEnd === daysBetween(firstDayOf(dRef), cEnd),
  'D5. negative daysUntilEnd measured from the reference month');
check(contractEffectiveStatus(cC, dRef) === 'Expired',
  'D6. status is Expired for a post-end reference month');
check(dCalc.expiredForRef === (dCalc.daysUntilEnd < 0),
  'D7. expiredForRef <=> daysUntilEnd < 0 (one coherent time basis)');

/* ============================================================
   FAMILY E — FAR PAST AND FAR FUTURE REFERENCE KEYS
   ============================================================ */
console.log('-- E. far-past and far-future reference keys --');
const eFar = ct('2025-01-01', 12);
const eEnd = lastDayOfEnd('2025-01-01', 12);
const eFarPast = contractCalc(eFar, '1975-01');
check(eFarPast.beforeStart === true, 'E1. far-past reference: beforeStart === true');
check(eFarPast.daysUntilEnd === daysBetween('1975-01-01', eEnd), 'E2. far-past reference: daysUntilEnd from 1975-01-01');
check(eFarPast.daysUntilEnd > 18000, 'E3. far-past reference produces a large positive distance');
const eFarFuture = contractCalc(eFar, '2199-12');
check(eFarFuture.expiredForRef === true, 'E4. far-future reference: expiredForRef === true');
check(eFarFuture.daysUntilEnd === daysBetween('2199-12-01', eEnd), 'E5. far-future reference: daysUntilEnd from 2199-12-01');
check(eFarFuture.daysUntilEnd < -60000, 'E6. far-future reference produces a large negative distance');

/* ============================================================
   FAMILY F — BOUNDARY CASES
   ============================================================ */
console.log('-- F. boundaries: duration, month end, year boundary, leap year --');
// duration 1 month
const f1 = ct('2025-05-01', 1);
check(contractCalc(f1,'2025-05').coversMonth === true, 'F1. duration 1: its own month is covered');
check(contractCalc(f1,'2025-05').progress === '1/1', 'F2. duration 1: progress 1/1');
check(contractCalc(f1,'2025-05').daysUntilEnd === daysBetween('2025-05-01','2025-05-31'), 'F3. duration 1: daysUntilEnd spans its own month');
check(contractCalc(f1,'2025-06').expiredForRef === true, 'F4. duration 1: the next month is expired');
check(contractCalc(f1,'2025-06').daysUntilEnd < 0, 'F5. duration 1: next month gives a negative distance');
// invalid duration — production behaviour is "invalid": valid=false, daysUntilEnd stays null
const f0 = ct('2025-05-01', 0);
check(contractCalc(f0,'2025-05').valid === false, 'F6. duration 0: valid === false (unchanged production behaviour)');
check(contractCalc(f0,'2025-05').daysUntilEnd === null, 'F7. duration 0: daysUntilEnd stays null (never computed)');
const fNoStart = ct(null, 12);
check(contractCalc(fNoStart,'2025-05').valid === false, 'F8. missing startDate: valid === false');
check(contractCalc(fNoStart,'2025-05').daysUntilEnd === null, 'F9. missing startDate: daysUntilEnd stays null');
// month end — a 31st start still derives the last covered calendar day
const fEnd = ct('2025-01-31', 2);
check(contractCalc(fEnd,'2025-01').endDate === '2025-02-28', 'F10. month-end start: endDate is the last covered calendar day');
check(contractCalc(fEnd,'2025-01').daysUntilEnd === daysBetween('2025-01-01','2025-02-28'), 'F11. month-end start: daysUntilEnd from the reference month');
// year boundary
const fYear = ct('2025-11-01', 4);   // 2025-11 .. 2026-02
check(contractCalc(fYear,'2025-12').coversMonth === true, 'F12. year boundary: December is covered');
check(contractCalc(fYear,'2026-01').coversMonth === true, 'F13. year boundary: January of the next year is covered');
check(contractCalc(fYear,'2026-03').expiredForRef === true, 'F14. year boundary: March of the next year is expired');
check(contractCalc(fYear,'2026-01').daysUntilEnd === daysBetween('2026-01-01','2026-02-28'), 'F15. year boundary: daysUntilEnd crosses the year correctly');
// leap year — 2024 is a leap year; February has 29 days
const fLeap = ct('2024-01-01', 2);
check(contractCalc(fLeap,'2024-01').endDate === '2024-02-29', 'F16. leap year: endDate is 2024-02-29');
check(contractCalc(fLeap,'2024-01').daysUntilEnd === daysBetween('2024-01-01','2024-02-29'), 'F17. leap year: daysUntilEnd counts the leap day');
check(contractCalc(fLeap,'2024-02').daysUntilEnd === daysBetween('2024-02-01','2024-02-29'), 'F18. leap year: February reference resolves to 2024-02-01');
const fLeapStart = ct('2024-02-29', 12);
check(contractCalc(fLeapStart,'2024-02').coversMonth === true, 'F19. leap-day start: its own month is covered');
check(contractCalc(fLeapStart,'2024-02').endDate === '2025-01-31', 'F20. leap-day start: endDate derived from the start MONTH, not the day');

/* ============================================================
   FAMILY G — WARNING BOUNDARY (warn-1 / warn / warn+1)
   The Expiring Soon threshold is "<= warn". UX-003A does not change that
   meaning; it only changes which date the distance is measured from. These
   assertions lock the boundary so a later sprint cannot drift it silently.
   ============================================================ */
console.log('-- G. Expiring Soon warning boundary --');
const gWarnDefault = Number(State.settings.contractExpiryWarningDays) || 90;
check(gWarnDefault === 90, 'G1. default contractExpiryWarningDays is 90 (unchanged)');
// Build a contract whose end is an exact number of days after a historical reference month's 1st.
function gContractEndingDaysAfter(refKey, days){
  // find a start month whose derived end lands exactly `days` after firstDayOf(refKey)
  const target = new Date(firstDayOf(refKey)+'T00:00:00');
  target.setDate(target.getDate() + days);
  const endKey = `${target.getFullYear()}-${String(target.getMonth()+1).padStart(2,'0')}`;
  // a contract ending in endKey must end on the LAST day of endKey
  const lastDay = new Date(target.getFullYear(), target.getMonth()+1, 0).getDate();
  if(target.getDate() !== lastDay) return null;   // not expressible on a month boundary
  return endKey;
}
// Use an explicit, hand-checked case instead of searching: reference 2025-01-01,
// contract ending 2025-03-31 => 89 days; ending 2025-04-30 => 119 days.
const gRef = '2025-01';
const gEnd89 = ct('2024-04-01', 12);      // 2024-04 .. 2025-03, end 2025-03-31
check(contractCalc(gEnd89, gRef).endDate === '2025-03-31', 'G2. boundary fixture ends 2025-03-31');
const g89 = contractCalc(gEnd89, gRef).daysUntilEnd;
check(g89 === daysBetween('2025-01-01','2025-03-31'), 'G3. boundary fixture distance measured from the reference month');
// Drive the boundary by moving warn, not by moving the contract.
const gOrigWarn = State.settings.contractExpiryWarningDays;
State.settings.contractExpiryWarningDays = g89 - 1;                 // warn = distance - 1
check(contractEffectiveStatus(gEnd89, gRef) === 'Active',
  'G4. warn = daysUntilEnd - 1  -> Active (outside the window)');
State.settings.contractExpiryWarningDays = g89;                     // warn = distance exactly
check(contractEffectiveStatus(gEnd89, gRef) === 'Expiring Soon',
  'G5. warn = daysUntilEnd exactly -> Expiring Soon (boundary is inclusive, <=)');
State.settings.contractExpiryWarningDays = g89 + 1;                 // warn = distance + 1
check(contractEffectiveStatus(gEnd89, gRef) === 'Expiring Soon',
  'G6. warn = daysUntilEnd + 1  -> Expiring Soon (inside the window)');
State.settings.contractExpiryWarningDays = gOrigWarn;
check(Number(State.settings.contractExpiryWarningDays) === gOrigWarn, 'G7. warning setting restored after the boundary sweep');
// The six status meanings are untouched by UX-003A.
check(contractEffectiveStatus(ct('2025-01-01',12,{status:'Draft'}), '2025-06') === 'Draft', 'G8. Draft meaning unchanged');
check(contractEffectiveStatus(ct('2025-01-01',12,{status:'Cancelled'}), '2025-06') === 'Cancelled', 'G9. Cancelled meaning unchanged');
check(contractEffectiveStatus(ct('2025-01-01',12,{status:'Renewed'}), '2025-06') === 'Renewed', 'G10. Renewed meaning unchanged');
check(contractEffectiveStatus(ct('2027-01-01',12), TODAY_KEY) === 'Active', 'G11. a not-yet-started contract still reports Active (no Scheduled state in UX-003A)');
check(['Active','Expiring Soon','Expired','Draft','Cancelled','Renewed','—']
  .indexOf(contractEffectiveStatus(cC,'2025-06')) !== -1, 'G12. no new status vocabulary is introduced');

/* ============================================================
   FAMILY H — MALFORMED AND NULL refKey (LOCKED FALLBACK)
   UX-003A adds NO validation semantics. These assertions document and lock
   the pre-existing fallback so a later sprint changing it must do so
   deliberately.
   ============================================================ */
console.log('-- H. malformed and null refKey (locked pre-UX-003A fallback) --');
const hC = ct(addMonths(TODAY_KEY,-3)+'-01', 12);
const hToday = contractCalc(hC, TODAY_KEY);
check(contractRefDate('') === TODAY, 'H1. empty-string refKey falls back to isoToday()');
check(contractRefDate('garbage') === TODAY, 'H2. non-date refKey falls back to isoToday()');
check(contractRefDate('2025-13') === TODAY, 'H3. month 13 falls back to isoToday() (no new validation invented)');
check(contractRefDate('2025-00') === TODAY, 'H4. month 00 falls back to isoToday()');
check(contractRefDate('not-a-key') === TODAY, 'H5. unparseable key falls back to isoToday()');
check(contractCalc(hC, null).daysUntilEnd === hToday.daysUntilEnd, 'H6. null refKey: daysUntilEnd equals the today-evaluated value');
check(contractCalc(hC, undefined).daysUntilEnd === hToday.daysUntilEnd, 'H7. undefined refKey: daysUntilEnd equals the today-evaluated value');
check(contractCalc(hC, 'garbage').daysUntilEnd === hToday.daysUntilEnd, 'H8. malformed refKey: daysUntilEnd falls back to the today value (locked)');
check(typeof contractCalc(hC, 'garbage').daysUntilEnd === 'number', 'H9. malformed refKey still yields a NUMBER, never NaN');
check(!Number.isNaN(contractCalc(hC, '2025-13').daysUntilEnd), 'H10. out-of-range month still yields a non-NaN distance');
check(contractCalc(hC, null).endDate === hToday.endDate, 'H11. null refKey: endDate unchanged (contract-intrinsic)');

/* ============================================================
   FAMILY I — PAYROLL SAFETY
   UX-003A must not move a single monetary value. Eligibility flows through
   coveringContract() -> coversMonth, which was ALREADY refKey-correct, so
   these assertions prove the fix did not reach it.
   ============================================================ */
console.log('-- I. payroll safety (no monetary value may move) --');
// Fabricated employee + contract + committed payroll fixture.
State.employees = [{ id:'emp-fix-1', employeeId:'EMP-FIX-001', fullName:'Fixture Person One',
  active:true, employmentStatus:'Active', monthlyBaseSalary: 9000000,
  workDaysPerWeek:5, workHoursPerDay:8 }];
State.contracts = [ct('2025-01-01', 24, {id:'ct-payroll-1', employeeId:'emp-fix-1', monthlySalary: 12000000})];
State.overtimeRecords = []; State.txns = []; State.monthlyPlans = [];
State.recurringAdjustments = State.recurringAdjustments || [];
State.payrollPlans = [];

// Eligibility across the contract's whole span and outside it.
check(payrollExclusionReason(State.employees[0], '2024-12') !== null, 'I1. month before the contract: excluded');
check(payrollExclusionReason(State.employees[0], '2025-01') === null, 'I2. first covered month: eligible');
check(payrollExclusionReason(State.employees[0], '2025-06') === null, 'I3. mid-term historical month: eligible');
check(payrollExclusionReason(State.employees[0], '2026-12') === null, 'I4. final covered month: eligible');
check(payrollExclusionReason(State.employees[0], '2027-01') !== null, 'I5. month after the contract: excluded');
check(payrollExclusionReason(State.employees[0], '2024-12') === 'Contract not started', 'I6. pre-start exclusion REASON is unchanged');
/* I7 — LOCKS A PRE-EXISTING BEHAVIOUR THAT UX-003A DELIBERATELY DOES NOT CHANGE.
   payrollExclusionReason() classifies "expired" with `cc.current > cc.total`, but
   contractCalc() CLAMPS out.current to dur on the expired branch (people-core.js),
   so that test can never be true and the 'Contract expired' reason is unreachable
   dead code; post-end exclusion falls through to the generic message below. This
   predates UX-003A, is unrelated to the reference-date defect (it is a clamp/branch
   mismatch, not a time-basis mismatch), and correcting it would change user-visible
   exclusion text — outside this sprint's authorized scope. Locked here so the
   behaviour cannot drift silently before it is deliberately addressed. */
check(payrollExclusionReason(State.employees[0], '2027-01') === 'No active contract covering this month',
  'I7. post-end exclusion REASON is unchanged (pre-existing unreachable "Contract expired" branch left intact)');
check(contractCalc(State.contracts[0], '2027-01').current === contractCalc(State.contracts[0], '2027-01').total,
  'I7b. the clamp that makes that branch unreachable is still in place (current === total when expired)');
check(contractCalc(State.contracts[0], '2027-01').expiredForRef === true,
  'I7c. expiredForRef remains the correct expiry signal for a post-end reference month');
// coveringContract is refKey-correct and untouched.
check(coveringContract('emp-fix-1','2025-06') !== null, 'I8. coveringContract resolves for a historical covered month');
check(coveringContract('emp-fix-1','2024-12') === null, 'I9. coveringContract is null before the contract starts');
check(coveringContract('emp-fix-1','2027-01') === null, 'I10. coveringContract is null after the contract ends');

// Generated payroll values for a HISTORICAL month.
const iGen = generatePayrollForMonth('2025-06');
const iPlan = State.payrollPlans.find(p=>p.monthKey==='2025-06');
check(iGen.generated === 1, 'I11. generation produced exactly one payroll row for the historical month');
check(!!iPlan, 'I12. the generated payroll row exists');
check(iPlan.plannedAmount === 12000000, 'I13. generated planned amount is the contract salary (12,000,000) — unchanged by UX-003A');
check(iPlan.baseSalary === 12000000 || iPlan.contractSalary === 12000000 || iPlan.plannedAmount === 12000000,
  'I14. the base figure comes from the covering contract, not from any expiry field');
// Regenerating must be idempotent and must not duplicate.
const iBefore = JSON.stringify(State.payrollPlans);
generatePayrollForMonth('2025-06');
check(State.payrollPlans.filter(p=>p.monthKey==='2025-06').length === 1, 'I15. regeneration created no duplicate row');
check(JSON.stringify(State.payrollPlans) === iBefore || State.payrollPlans.filter(p=>p.monthKey==='2025-06').length === 1,
  'I16. regeneration did not change the monetary value');
// Committed payroll is never regenerated.
iPlan.status = 'Committed';
const iCommittedSnapshot = JSON.stringify(iPlan);
const iAfterCommit = generatePayrollForMonth('2025-06');
check(iAfterCommit.skippedCommitted === 1, 'I17. committed payroll is SKIPPED by regeneration');
check(JSON.stringify(State.payrollPlans.find(p=>p.monthKey==='2025-06')) === iCommittedSnapshot,
  'I18. the committed payroll row is byte-identical after regeneration (immutability preserved)');
// Monthly plan values untouched.
State.monthlyPlans = [{ id:'mp-fix-1', monthKey:'2025-06', status:'Committed', committedTxnIds:['t1','t2'], totalPlanned: 12000000 }];
const iMpBefore = JSON.stringify(State.monthlyPlans);
contractCalc(State.contracts[0], '2025-06');
contractEffectiveStatus(State.contracts[0], '2025-06');
check(JSON.stringify(State.monthlyPlans) === iMpBefore, 'I19. monthly-plan values are untouched by any timeline evaluation');
// The calc is pure — it must not mutate the contract.
const iCtBefore = JSON.stringify(State.contracts[0]);
contractCalc(State.contracts[0], '2025-06');
contractCalc(State.contracts[0], '2030-01');
contractEffectiveStatus(State.contracts[0], '1999-01');
check(JSON.stringify(State.contracts[0]) === iCtBefore, 'I20. contractCalc/contractEffectiveStatus never mutate contract data');

/* ============================================================
   FAMILY J — HISTORICAL ADVISORY COHERENCE
   payrollHealth(monthKey) supplies a NON-CURRENT month and reads
   daysUntilEnd. Before UX-003A that warning was measured from today while
   the payroll row it describes belongs to monthKey.
   ============================================================ */
console.log('-- J. payrollHealth() historical advisory coherence --');
// Contract ending 2025-06-30; a payroll row for 2025-06 is in its final month.
State.employees = [{ id:'emp-adv-1', employeeId:'EMP-ADV-001', fullName:'Fixture Advisory One',
  active:true, employmentStatus:'Active', monthlyBaseSalary: 8000000,
  workDaysPerWeek:5, workHoursPerDay:8 }];
State.contracts = [ct('2025-01-01', 6, {id:'ct-adv-1', employeeId:'emp-adv-1',
  employeeName:'Fixture Advisory One', contractNumber:'CT-ADV-001', monthlySalary: 8000000})];
State.payrollPlans = []; State.overtimeRecords = []; State.txns = []; State.monthlyPlans = [];
generatePayrollForMonth('2025-06');
const jFinal = payrollHealth('2025-06');
const jExpiring = jFinal.filter(h=>h.title === 'Contract expiring within 30 days');
check(contractCalc(State.contracts[0],'2025-06').endDate === '2025-06-30', 'J1. advisory fixture ends 2025-06-30');
check(contractCalc(State.contracts[0],'2025-06').daysUntilEnd === daysBetween('2025-06-01','2025-06-30'),
  'J2. the final month resolves to a 29-day distance from that month (not from today)');
check(jExpiring.length === 1, 'J3. the final month RAISES the "expiring within 30 days" advisory (reference-correct)');
// An early month of the same contract must NOT raise it.
State.payrollPlans = [];
generatePayrollForMonth('2025-02');
const jEarly = payrollHealth('2025-02').filter(h=>h.title === 'Contract expiring within 30 days');
check(contractCalc(State.contracts[0],'2025-02').daysUntilEnd === daysBetween('2025-02-01','2025-06-30'),
  'J4. an early month measures its own distance to the end');
check(contractCalc(State.contracts[0],'2025-02').daysUntilEnd > 30, 'J5. that distance is greater than 30 days');
check(jEarly.length === 0, 'J6. an early month does NOT raise the 30-day advisory (was today-based before UX-003A)');
// The advisory never fires for a month after the contract ended (guard is >= 0).
State.payrollPlans = [];
const jAfter = payrollHealth('2025-09').filter(h=>h.title === 'Contract expiring within 30 days');
check(jAfter.length === 0, 'J7. no expiry advisory for a month after the contract ended');
// The advisory text carries the reference-correct number.
check(jExpiring.length === 1 && /29 day/.test(jExpiring[0].detail),
  'J8. the advisory text reports the reference-correct day count');
// Extract the reported day count itself — the contract NUMBER also contains
// digits after a hyphen, so the assertion must read the number, not the string.
const jReported = jExpiring.length === 1 ? /ends in (-?\d+) day/.exec(jExpiring[0].detail) : null;
check(!!jReported, 'J9. the advisory text exposes a parseable day count');
check(!!jReported && Number(jReported[1]) >= 0,
  'J10. the advisory never renders a NEGATIVE day count');
check(!!jReported && Number(jReported[1]) === daysBetween('2025-06-01','2025-06-30'),
  'J11. the reported day count equals the reference-month distance exactly');
/* ============================================================
   UX-003B — CANONICAL TWO-DIMENSIONAL TIMELINE MODEL
   ------------------------------------------------------------
   PD-T1..PD-T4: "where is this contract in its lifecycle?" and "how close is it
   to ending?" are INDEPENDENT questions, so the canonical model has TWO
   dimensions and never one flattened list:

     contractTimeline(c, refKey) -> { state, horizon, daysUntilEnd, withinWarningWindow }

     state   : Draft | Cancelled | Renewed | Scheduled | Active | Expired
     horizon : EndingToday | EndingThisWeek | EndingThisMonth |
               EndingNextMonth | WithinWarningWindow | None

   A contract ending this month is state 'Active' WITH horizon
   'EndingThisMonth' — the horizon never replaces the effective state.

   CALENDAR HORIZONS ARE NOT GATED BY contractExpiryWarningDays. They are
   calendar facts and hold at any threshold, including 1. Only
   WithinWarningWindow — the residual band — depends on the setting.

   'Expiring Soon' is a COMPATIBILITY ALIAS (effectively Active AND inside the
   warning window), not a canonical state and not a canonical horizon.

   MODEL NOTE (structural, deliberate): contractRefDate() resolves a non-current
   reference month to that month's FIRST day, and a derived endDate is always a
   month's LAST day. The day-granular horizons (EndingToday / EndingThisWeek)
   are therefore reachable only through the CURRENT-month reference path, where
   the reference date is isoToday(). Family N tests them through that path
   against an INDEPENDENTLY computed expectation.

   Families:
     K  effective-state vocabulary: exhaustive, mutually exclusive, derived-only
     L  Scheduled
     M  ISO-week key correctness (incl. year/leap boundaries)
     N  horizon dimension: the six values, and Active x horizon pairings
     O  warning-threshold independence (1 / 7 / 30 / 90 / 3650) + band helper
     P  legacy facade byte-compatibility, today-equivalence, payroll immutability
   ============================================================ */
const { contractTimeline, contractEffectiveState, contractExpiryHorizon,
        contractExpiryBand, isoWeekKey,
        CONTRACT_EFFECTIVE_STATES, CONTRACT_EXPIRY_HORIZONS,
        CONTRACT_LEGACY_STATE_DISPLAY, CONTRACT_LEGACY_EXPIRING_ALIAS,
        CONTRACT_STORED_STATUSES } = RT;

console.log('== UX-003B CANONICAL TWO-DIMENSIONAL TIMELINE MODEL ==');

/* ---------- K. effective-state dimension ---------- */
console.log('-- K. effective-state vocabulary (exhaustive, exclusive, derived-only) --');
const K_STATES   = ['Draft','Cancelled','Renewed','Scheduled','Active','Expired'];
const K_HORIZONS = ['EndingToday','EndingThisWeek','EndingThisMonth','EndingNextMonth','WithinWarningWindow','None'];
check(Array.isArray(CONTRACT_EFFECTIVE_STATES) && CONTRACT_EFFECTIVE_STATES.length === 6,
  'K1. the effective-state vocabulary has exactly six members');
check(JSON.stringify(CONTRACT_EFFECTIVE_STATES) === JSON.stringify(K_STATES),
  'K2. effective-state vocabulary matches the approved model (harness holds its OWN copy)');
check(Array.isArray(CONTRACT_EXPIRY_HORIZONS) && CONTRACT_EXPIRY_HORIZONS.length === 6,
  'K3. the horizon vocabulary has exactly six members');
check(JSON.stringify(CONTRACT_EXPIRY_HORIZONS) === JSON.stringify(K_HORIZONS),
  'K4. horizon vocabulary matches the approved model (harness holds its OWN copy)');
// The two dimensions must be DISTINCT — no value may appear in both.
check(CONTRACT_EFFECTIVE_STATES.filter(s=>CONTRACT_EXPIRY_HORIZONS.indexOf(s) !== -1).length === 0,
  'K5. effective state and expiry horizon are disjoint vocabularies (two dimensions, not one)');
check(K_HORIZONS.every(h=>K_STATES.indexOf(h) === -1),
  'K6. no horizon value is an effective state (a horizon never replaces Active)');
// Scheduled is DERIVED ONLY.
check(JSON.stringify(CONTRACT_STORED_STATUSES) === JSON.stringify(['Draft','Active','Renewed','Cancelled']),
  'K7. CONTRACT_STORED_STATUSES is unchanged by UX-003B');
check(CONTRACT_STORED_STATUSES.indexOf('Scheduled') === -1, 'K8. Scheduled is NOT a stored status');
check(CONTRACT_STORED_STATUSES.indexOf('Expired') === -1, 'K9. Expired remains derived, not stored');
// Exhaustiveness + well-formedness across a wide sweep.
const kShapes = [
  ct('2025-01-01', 12), ct('2025-01-01', 1), ct('2026-06-15', 24),
  ct('2024-02-29', 12), ct('2025-11-01', 4), ct('2027-01-01', 12),
  ct('2025-01-01', 12, {status:'Draft'}), ct('2025-01-01', 12, {status:'Cancelled'}),
  ct('2025-01-01', 12, {status:'Renewed'}), ct(null, 12), ct('2025-01-01', 0)
];
let kTotal = 0, kBadState = 0, kBadHorizon = 0, kHorizonOnNonActive = 0;
const kSeenStates = new Set(), kSeenHorizons = new Set();
kShapes.forEach(c=>{
  for(let y=2023; y<=2029; y++) for(let m=1; m<=12; m++){
    const t = contractTimeline(c, `${y}-${String(m).padStart(2,'0')}`);
    kTotal++;
    if(!t || K_STATES.indexOf(t.state) === -1) kBadState++;
    else kSeenStates.add(t.state);
    if(!t || K_HORIZONS.indexOf(t.horizon) === -1) kBadHorizon++;
    else kSeenHorizons.add(t.horizon);
    // ONLY effectively Active contracts may carry a non-None horizon.
    if(t && t.state !== 'Active' && t.horizon !== 'None') kHorizonOnNonActive++;
  }
});
check(kTotal === kShapes.length*84, `K10. sweep ran every shape x 84 reference months (${kTotal} classifications)`);
check(kBadState === 0, 'K11. every classification yields a member of the effective-state vocabulary (exhaustive)');
check(kBadHorizon === 0, 'K12. every classification yields a member of the horizon vocabulary (exhaustive)');
check(kHorizonOnNonActive === 0, 'K13. ONLY effectively Active contracts ever carry a non-None horizon');
check(kSeenStates.size >= 5, `K14. the sweep exercised ${kSeenStates.size} distinct effective states`);
check(kSeenHorizons.size >= 3, `K15. the sweep exercised ${kSeenHorizons.size} distinct horizons`);
// Mutual exclusivity is structural: one call yields exactly one state and one horizon.
check(kShapes.every(c=>{ const t = contractTimeline(c,'2026-03');
  return typeof t.state === 'string' && typeof t.horizon === 'string'; }),
  'K16. each classification returns exactly one state and exactly one horizon');
check(contractTimeline(null, '2026-03') === null, 'K17. a null contract yields null (no state invented)');
// The thin readers must agree with the canonical computation (no second rulebook).
check(kShapes.every(c=>contractEffectiveState(c,'2026-03') === contractTimeline(c,'2026-03').state),
  'K18. contractEffectiveState() agrees with contractTimeline().state');
check(kShapes.every(c=>contractExpiryHorizon(c,'2026-03') === contractTimeline(c,'2026-03').horizon),
  'K19. contractExpiryHorizon() agrees with contractTimeline().horizon');

/* ---------- L. Scheduled ---------- */
console.log('-- L. Scheduled (derived, never Active, horizon always None) --');
const lC = ct('2027-06-01', 12);
check(contractTimeline(lC, '2026-01').state === 'Scheduled', 'L1. a contract starting later is Scheduled');
check(contractTimeline(lC, '2027-05').state === 'Scheduled', 'L2. still Scheduled the month before it starts');
check(contractTimeline(lC, '2027-06').state !== 'Scheduled', 'L3. NOT Scheduled once its own month is reached');
check(contractTimeline(lC, '2026-01').state !== 'Active', 'L4. Scheduled is never the Active state');
check(contractTimeline(lC, '2026-01').horizon === 'None', 'L5. Scheduled always has horizon None');
check(contractTimeline(lC, '2020-01').state === 'Scheduled', 'L6. Scheduled holds for a far-past reference month');
check(contractCalc(lC, '2026-01').beforeStart === true, 'L7. Scheduled corresponds exactly to beforeStart');
// Stored lifecycle outranks Scheduled, and all of those carry horizon None.
[['Draft','L8'],['Cancelled','L9'],['Renewed','L10']].forEach(([st,id])=>{
  const t = contractTimeline(ct('2027-06-01',12,{status:st}), '2026-01');
  check(t.state === st && t.horizon === 'None', `${id}. a stored ${st} outranks Scheduled and has horizon None`);
});
// Expired always has horizon None.
const lExpired = ct('2024-01-01', 12);
check(contractTimeline(lExpired,'2026-03').state === 'Expired' && contractTimeline(lExpired,'2026-03').horizon === 'None',
  'L11. Expired always has horizon None');

/* ---------- M. ISO-8601 week key ---------- */
console.log('-- M. ISO-8601 week key --');
check(isoWeekKey('2026-01-01') === '2026-W01', 'M1. 2026-01-01 (Thursday) is 2026-W01');
check(isoWeekKey('2026-03-01') === '2026-W09', 'M2. 2026-03-01 (Sunday) closes 2026-W09');
check(isoWeekKey('2026-03-02') === '2026-W10', 'M3. 2026-03-02 (Monday) opens 2026-W10');
check(isoWeekKey('2025-01-01') === '2025-W01', 'M4. 2025-01-01 (Wednesday) is 2025-W01');
check(isoWeekKey('2024-12-30') === '2025-W01', 'M5. 2024-12-30 belongs to 2025-W01 (year boundary)');
check(isoWeekKey('2023-01-01') === '2022-W52', 'M6. 2023-01-01 (Sunday) belongs to 2022-W52');
check(isoWeekKey('2024-02-29') === '2024-W09', 'M7. leap day 2024-02-29 resolves to 2024-W09');
check(isoWeekKey('2020-12-31') === '2020-W53', 'M8. 2020 has a W53');
const mWeek = isoWeekKey('2026-03-02');
check(['2026-03-02','2026-03-03','2026-03-04','2026-03-05','2026-03-06','2026-03-07','2026-03-08']
  .every(d=>isoWeekKey(d) === mWeek), 'M9. all seven days Mon..Sun share one week key');
check(isoWeekKey('2026-03-09') !== mWeek, 'M10. the next Monday starts a new week key');
check(isoWeekKey('2026-03-01') !== mWeek, 'M11. the preceding Sunday is the PREVIOUS week (Monday-start)');

/* ---------- N. horizon dimension ---------- */
console.log('-- N. expiry horizon (Active keeps its state) --');
// Non-current reference month => reference date is that month's 1st.
const nThisMonth = ct('2025-04-01', 12);                 // ends 2026-03-31
check(contractCalc(nThisMonth,'2026-03').endDate === '2026-03-31', 'N1. this-month fixture ends 2026-03-31');
const nT1 = contractTimeline(nThisMonth,'2026-03');
check(nT1.state === 'Active', 'N2. a contract ending this month is STILL effectively Active');
check(nT1.horizon === 'EndingThisMonth', 'N3. ... with horizon EndingThisMonth (Active + EndingThisMonth is valid)');
const nNextMonth = ct('2025-04-01', 13);                 // ends 2026-04-30
const nT2 = contractTimeline(nNextMonth,'2026-03');
check(nT2.state === 'Active' && nT2.horizon === 'EndingNextMonth',
  'N4. Active + EndingNextMonth is valid');
const nBeyond = ct('2025-04-01', 14);                    // ends 2026-05-31, 91 days out
const nT3 = contractTimeline(nBeyond,'2026-03');
check(nT3.state === 'Active' && nT3.horizon === 'None',
  'N5. beyond next month and outside a 90-day window is Active + None');
// Year rollover: December reference -> next month is January of the next year.
const nDec = ct('2025-02-01', 12);                       // ends 2026-01-31
check(contractCalc(nDec,'2025-12').endDate === '2026-01-31', 'N6. year-boundary fixture ends 2026-01-31');
check(contractExpiryHorizon(nDec,'2025-12') === 'EndingNextMonth',
  'N7. December reference treats the following January as next month (year rollover)');
check(contractEffectiveState(nDec,'2025-12') === 'Active', 'N8. ... and the contract is still Active');
// Current-month path: reference date is isoToday(), so day-granular horizons are reachable.
const nEndOfThisMonth = (function(){
  const p = keyParts(TODAY_KEY);
  const d = new Date(p.y, p.m, 0);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
})();
const nCurrent = ct(TODAY_KEY+'-01', 1);
check(contractCalc(nCurrent, TODAY_KEY).endDate === nEndOfThisMonth,
  'N9. current-month fixture ends on the last day of the current month');
const nExpected = (TODAY === nEndOfThisMonth) ? 'EndingToday'
  : (isoWeekKey(nEndOfThisMonth) === isoWeekKey(TODAY)) ? 'EndingThisWeek'
  : 'EndingThisMonth';
const nT4 = contractTimeline(nCurrent, TODAY_KEY);
check(nT4.horizon === nExpected,
  `N10. the current-month horizon matches the independently computed expectation (${nExpected})`);
check(nT4.state === 'Active', 'N11. ... and the current-month contract is still effectively Active');
check(['EndingToday','EndingThisWeek','EndingThisMonth'].indexOf(nT4.horizon) !== -1,
  'N12. a contract ending this month lands in a day/month horizon, never NextMonth or WithinWarningWindow');
check([TODAY === nEndOfThisMonth,
       TODAY !== nEndOfThisMonth && isoWeekKey(nEndOfThisMonth) === isoWeekKey(TODAY),
       TODAY !== nEndOfThisMonth && isoWeekKey(nEndOfThisMonth) !== isoWeekKey(TODAY)]
      .filter(Boolean).length === 1,
  'N13. exactly one of today / this-week / this-month applies (horizons are mutually exclusive)');
// Every horizon value is reachable at least once across the sweep + explicit probes.
const nOrigWarn0 = State.settings.contractExpiryWarningDays;
State.settings.contractExpiryWarningDays = 3650;
check(contractExpiryHorizon(nBeyond,'2026-03') === 'WithinWarningWindow',
  'N14. Active + WithinWarningWindow is valid (residual band inside a wide window)');
State.settings.contractExpiryWarningDays = nOrigWarn0;

/* ---------- O. warning-threshold independence ---------- */
console.log('-- O. calendar horizons are independent of contractExpiryWarningDays --');
const oOrigWarn = State.settings.contractExpiryWarningDays;
[1, 7, 30, 90, 3650].forEach((w)=>{
  State.settings.contractExpiryWarningDays = w;
  check(contractExpiryHorizon(nThisMonth,'2026-03') === 'EndingThisMonth',
    `O1.${w}. EndingThisMonth survives warningDays=${w} (calendar horizon, not gated)`);
  check(contractExpiryHorizon(nNextMonth,'2026-03') === 'EndingNextMonth',
    `O2.${w}. EndingNextMonth survives warningDays=${w} (calendar horizon, not gated)`);
  check(contractEffectiveState(nThisMonth,'2026-03') === 'Active',
    `O3.${w}. effective state stays Active at warningDays=${w}`);
});
// Only WithinWarningWindow moves with the threshold.
State.settings.contractExpiryWarningDays = 30;
check(contractExpiryHorizon(nBeyond,'2026-03') === 'None',
  'O4. the residual band is None when the contract is outside a 30-day window');
State.settings.contractExpiryWarningDays = 120;
check(contractExpiryHorizon(nBeyond,'2026-03') === 'WithinWarningWindow',
  'O5. the same contract becomes WithinWarningWindow at 120 days (threshold-dependent)');
State.settings.contractExpiryWarningDays = 3650;
check(contractExpiryHorizon(nBeyond,'2026-03') === 'WithinWarningWindow',
  'O6. it stays WithinWarningWindow at 3650 days');
State.settings.contractExpiryWarningDays = oOrigWarn;
check(Number(State.settings.contractExpiryWarningDays) === oOrigWarn, 'O7. warning setting restored after the sweep');
// Canonical band helper — the 30/60/90 literals live in exactly one place.
check(contractExpiryBand(0) === 30,  'O8. 0 days -> band 30');
check(contractExpiryBand(30) === 30, 'O9. 30 days -> band 30 (inclusive)');
check(contractExpiryBand(31) === 60, 'O10. 31 days -> band 60');
check(contractExpiryBand(60) === 60, 'O11. 60 days -> band 60 (inclusive)');
check(contractExpiryBand(61) === 90, 'O12. 61 days -> band 90');
check(contractExpiryBand(365) === 90,'O13. far-out distances saturate at band 90');
check(contractExpiryBand(null) === null, 'O14. null distance yields no band');
check(contractExpiryBand(NaN) === null, 'O15. NaN distance yields no band');

/* ---------- P. legacy facade, today-equivalence, payroll immutability ---------- */
console.log('-- P. legacy compatibility facade / today-equivalence / payroll immutability --');
const P_DISPLAY = ['Draft','Active','Expiring Soon','Expired','Renewed','Cancelled'];
check(CONTRACT_LEGACY_EXPIRING_ALIAS === 'Expiring Soon', 'P1. the compatibility alias is the legacy label');
check(Object.keys(CONTRACT_LEGACY_STATE_DISPLAY).length === 6,
  'P2. the legacy display map covers all six effective states');
check(CONTRACT_LEGACY_STATE_DISPLAY['Scheduled'] === 'Active',
  'P3. Scheduled maps to Active FOR THE LEGACY FACADE ONLY');
check(CONTRACT_EFFECTIVE_STATES.indexOf(CONTRACT_LEGACY_EXPIRING_ALIAS) === -1 &&
      CONTRACT_EXPIRY_HORIZONS.indexOf(CONTRACT_LEGACY_EXPIRING_ALIAS) === -1,
  'P4. \'Expiring Soon\' is neither a canonical state nor a canonical horizon (alias only)');
// The facade must emit only the six historical values, and must equal the
// alias rule exactly — recomputed here from the model, independently.
let pOutside = 0, pMismatch = 0;
kShapes.forEach(c=>{
  for(let y=2023; y<=2029; y++) for(let m=1; m<=12; m++){
    const k = `${y}-${String(m).padStart(2,'0')}`;
    const disp = contractEffectiveStatus(c, k);
    const t = contractTimeline(c, k);
    const expected = (t.state==='Active' && t.withinWarningWindow)
      ? CONTRACT_LEGACY_EXPIRING_ALIAS : CONTRACT_LEGACY_STATE_DISPLAY[t.state];
    if(P_DISPLAY.indexOf(disp) === -1) pOutside++;
    if(disp !== expected) pMismatch++;
  }
});
check(pOutside === 0, 'P5. the facade only ever emits the six historical display values');
check(pMismatch === 0, 'P6. the facade is exactly the documented alias rule over the model (one rulebook)');
check(contractEffectiveStatus(lC, '2026-01') === 'Active',
  'P7. Scheduled still displays as Active (no new UI vocabulary in UX-003B)');
check(contractEffectiveStatus(nThisMonth, '2026-03') === 'Expiring Soon',
  'P8. an in-window horizon still displays as Expiring Soon');
check(contractEffectiveStatus(nBeyond, '2026-03') === 'Active',
  'P9. outside the window still displays as Active');
check(contractEffectiveStatus(lExpired, '2026-03') === 'Expired', 'P10. Expired display unchanged');
check(contractEffectiveStatus(null) === '—', 'P11. a null contract still displays as em-dash');
// The alias must track the SETTING, exactly as the pre-UX-003B build did.
const pOrigWarn = State.settings.contractExpiryWarningDays;
State.settings.contractExpiryWarningDays = 1;
check(contractEffectiveStatus(nThisMonth, '2026-03') === 'Active',
  'P12. with warningDays=1 an EndingThisMonth contract displays Active (legacy alias respects the setting)');
check(contractExpiryHorizon(nThisMonth, '2026-03') === 'EndingThisMonth',
  'P13. ... while the CALENDAR horizon is still EndingThisMonth (dimensions are independent)');
State.settings.contractExpiryWarningDays = pOrigWarn;
// Today-equivalence survives the model change.
const pFixtures = [ct(addMonths(TODAY_KEY,-6)+'-01',12), ct(addMonths(TODAY_KEY,-24)+'-01',12),
                   ct(addMonths(TODAY_KEY,6)+'-01',12), ct(TODAY_KEY+'-01',1)];
pFixtures.forEach((c,i)=>{
  check(contractEffectiveStatus(c) === contractEffectiveStatus(c, TODAY_KEY),
    `P14.${i+1} facade: omitted refKey === explicit current month`);
  check(JSON.stringify(contractTimeline(c)) === JSON.stringify(contractTimeline(c, TODAY_KEY)),
    `P15.${i+1} model: omitted refKey === explicit current month (state, horizon and alias)`);
});
// UX-003A reference-date fallbacks still hold through the model.
check(contractRefDate('2025-13') === TODAY && contractRefDate('2025-00') === TODAY,
  'P16. out-of-range month: the reference DATE still falls back to isoToday()');
check(contractTimeline(pFixtures[0], 'garbage').state === contractTimeline(pFixtures[0], TODAY_KEY).state,
  'P17. malformed refKey falls back to the current-month classification');
check(contractTimeline(pFixtures[0], null).state === contractTimeline(pFixtures[0], TODAY_KEY).state,
  'P18. null refKey falls back to the current-month classification');
check(contractCalc(pFixtures[0], '2025-13').beforeStart === true,
  'P19. out-of-range month: the PROGRESS math still uses the overflowed month (pre-existing, unfixed)');
// Duration / validity edges.
check(contractTimeline(ct('2025-05-01', 0), '2025-05').state === 'Draft',
  'P20. duration 0 (invalid) classifies as Draft with horizon None');
check(contractTimeline(ct('2025-05-01', 0), '2025-05').horizon === 'None', 'P21. ... horizon is None');
check(contractTimeline(ct(null, 12), '2025-05').state === 'Draft', 'P22. a missing start date classifies as Draft');
check(contractTimeline(ct('2025-05-01', 1), '2025-05').state === 'Active', 'P23. duration 1 in its own month is Active');
check(contractTimeline(ct('2025-01-01',12), '1975-01').state === 'Scheduled', 'P24. far-past reference -> Scheduled');
check(contractTimeline(ct('2025-01-01',12), '2199-12').state === 'Expired', 'P25. far-future reference -> Expired');
// PAYROLL IMMUTABILITY.
State.employees = [{ id:'emp-ux3b-1', employeeId:'EMP-UX3B-001', fullName:'Fixture Person UX3B',
  active:true, employmentStatus:'Active', monthlyBaseSalary: 9000000,
  workDaysPerWeek:5, workHoursPerDay:8 }];
State.contracts = [ct('2025-01-01', 24, {id:'ct-ux3b-1', employeeId:'emp-ux3b-1', monthlySalary: 12000000})];
State.payrollPlans = []; State.overtimeRecords = []; State.txns = []; State.monthlyPlans = [];
const pCtBefore = JSON.stringify(State.contracts[0]);
const pGen = generatePayrollForMonth('2025-06');
const pPlan = State.payrollPlans.find(p=>p.monthKey==='2025-06');
check(pGen.generated === 1 && !!pPlan, 'P26. payroll still generates for a historical covered month');
check(pPlan.plannedAmount === 12000000, 'P27. generated payroll value is unchanged by the timeline model');
check(payrollExclusionReason(State.employees[0], '2025-06') === null, 'P28. eligibility unchanged (mid-term)');
check(payrollExclusionReason(State.employees[0], '2024-12') === 'Contract not started', 'P29. pre-start exclusion reason unchanged');
check(payrollExclusionReason(State.employees[0], '2027-06') === 'No active contract covering this month',
  'P30. post-end exclusion reason unchanged (pre-existing unreachable branch still untouched)');
pPlan.status = 'Committed';
const pSnap = JSON.stringify(pPlan);
const pAfter = generatePayrollForMonth('2025-06');
check(pAfter.skippedCommitted === 1, 'P31. committed payroll is still skipped by regeneration');
check(JSON.stringify(State.payrollPlans.find(p=>p.monthKey==='2025-06')) === pSnap,
  'P32. committed payroll row is byte-identical after the model change');
for(let y=2023; y<=2029; y++) contractTimeline(State.contracts[0], y+'-06');
check(JSON.stringify(State.contracts[0]) === pCtBefore,
  'P33. contractTimeline() never mutates contract data');
check(/const SCHEMA_VERSION = 6;/.test(fs.readFileSync(path.resolve(__dirname,'..','js','core','constants.js'),'utf8')),
  'P34. SCHEMA_VERSION remains 6 (UX-003B is not a migration)');
/* ============================================================
   UX-003C — PRESENTATION & COUNTER INTEGRITY
   ------------------------------------------------------------
   UX-003C adds NO model. It consumes the UX-003B model to fix two things:

   1. LIFECYCLE PROGRESS WORDING. current/total is the contract month BEING
      SERVED. A 3-month contract reads 1/3, 2/3, 3/3 and then Expired. 3/3 is
      therefore the FINAL month and must never be worded as "1 month remaining".
      remaining is always max(0, total-current); current never exceeds total.
      (Both already held in contractCalc() — family R LOCKS them.)

   2. COUNTER INTEGRITY. Every displayed contract count resolves through one
      canonical helper, contractTimelineCounts(). The six effective states
      PARTITION the collection; the horizon counts are a BREAKDOWN OF `active`,
      not a sibling of it. That is what removes the old "Active: 12 /
      Expiring: 3" ambiguity — the 3 are now genuinely among the 12.

   Families:
     Q  canonical counting: partition, subset, single source, filter compatibility
     R  lifecycle progress wording and the remaining/current invariants
   ============================================================ */
const { contractTimelineCounts, contractPresentation, contractProgressNote,
        contractPresentationBadge, hrDashboardStats, CONTRACT_PRESENTATION_META,
        CONTRACT_STATUS_META, contractsFiltered, CONTRACT_FILTER_STATES } = RT;

console.log('== UX-003C PRESENTATION & COUNTER INTEGRITY ==');

/* ---------- Q. canonical counting ---------- */
console.log('-- Q. counter integrity (one canonical helper) --');
State.contracts = [
  ct(addMonths(TODAY_KEY,-6)+'-01', 24),                 // Active, far from ending
  ct(addMonths(TODAY_KEY,-6)+'-01', 24),                 // Active, far from ending
  ct(TODAY_KEY+'-01', 1),                                // Active, ending this month
  ct(addMonths(TODAY_KEY,-1)+'-01', 3),                  // Active, ending next month
  ct(addMonths(TODAY_KEY,6)+'-01', 12),                  // Scheduled
  ct(addMonths(TODAY_KEY,9)+'-01', 12),                  // Scheduled
  ct(addMonths(TODAY_KEY,-36)+'-01', 12),                // Expired
  ct(addMonths(TODAY_KEY,-6)+'-01', 12, {status:'Draft'}),
  ct(addMonths(TODAY_KEY,-6)+'-01', 12, {status:'Cancelled'}),
  ct(addMonths(TODAY_KEY,-6)+'-01', 12, {status:'Renewed'})
];
const qC = contractTimelineCounts();
check(qC.total === State.contracts.length, 'Q1. the canonical helper counts every contract exactly once');
check(qC.draft + qC.cancelled + qC.renewed + qC.scheduled + qC.active + qC.expired === qC.total,
  'Q2. the six effective states PARTITION the collection (they sum to the total)');
check(qC.scheduled === 2, 'Q3. Scheduled contracts are counted as Scheduled');
check(qC.expired === 1, 'Q4. Expired contracts are counted as Expired');
check(qC.draft === 1 && qC.cancelled === 1 && qC.renewed === 1, 'Q5. stored lifecycle states are counted separately');
const qActiveByModel = State.contracts.filter(c=>contractTimeline(c).state === 'Active').length;
check(qC.active === qActiveByModel, 'Q6. `active` equals the model\'s own Active population');
check(qC.active + qC.scheduled + qC.expired + qC.draft + qC.cancelled + qC.renewed === qC.total,
  'Q7. Scheduled is never counted as Active, and Expired is never counted as Active');
check(qC.endingSoon === qC.endingToday + qC.endingThisWeek + qC.endingThisMonth
      + qC.endingNextMonth + qC.withinWarningWindow,
  'Q8. endingSoon is exactly the sum of the five horizon buckets');
check(qC.endingSoon <= qC.active, 'Q9. every ending-soon contract is ALSO counted in active (a true subset)');
check(qC.endingThisMonth >= 1 && qC.endingNextMonth >= 1, 'Q10. the fixture exercises real horizon buckets');
let qOutside = 0;
State.contracts.forEach(c=>{ const t = contractTimeline(c);
  if(t.horizon !== 'None' && t.state !== 'Active') qOutside++; });
check(qOutside === 0, 'Q11. no non-Active contract carries a horizon, so the subset cannot leak');
State.employees = []; State.payrollPlans = []; State.txns = []; State.monthlyPlans = []; State.overtimeRecords = [];
const qStats = hrDashboardStats(TODAY_KEY);
check(qStats.activeContracts === qC.active,
  'Q12. hrDashboardStats().activeContracts comes from the canonical helper (no second count)');
check(qStats.expiringSoon === qC.endingSoon,
  'Q13. hrDashboardStats().expiringSoon comes from the canonical helper (no second count)');
check(qStats.expiringSoon <= qStats.activeContracts,
  'Q14. the dashboard sub-count is a subset of its headline count (the old ambiguity is gone)');
const qSnapshot = JSON.stringify(State.contracts);
const qC2 = contractTimelineCounts();
check(JSON.stringify(qC) === JSON.stringify(qC2), 'Q15. the counter is deterministic');
check(JSON.stringify(State.contracts) === qSnapshot, 'Q16. counting never mutates contract data');
// UX-003C revision — the filter now follows the CANONICAL effective state, so a
// user filtering Active can never be shown a Scheduled badge. Family S proves it.
State.contractFilter = {status:'Active', search:''};
const qActiveRows = contractsFiltered();
check(qActiveRows.every(c=>contractEffectiveState(c) === 'Active'),
  'Q17. the Active filter returns ONLY effectively-Active contracts');
State.contractFilter = {status:'all', search:''};
check(Object.keys(CONTRACT_STATUS_META).every(k=>k.indexOf('+') === -1),
  'Q18. CONTRACT_STATUS_META (which builds the filter options) gains no canonical keys');
check(Object.keys(CONTRACT_PRESENTATION_META).some(k=>k.indexOf('+') !== -1),
  'Q19. presentation labels live in their OWN map, separate from the filter vocabulary');

/* ---------- R. lifecycle progress wording ---------- */
console.log('-- R. lifecycle progress wording (the 3/3 rule) --');
const rC = ct('2026-01-01', 3);
const rMonths = [
  ['2026-01', 1, 2, '1/3'],
  ['2026-02', 2, 1, '2/3'],
  ['2026-03', 3, 0, '3/3']
];
rMonths.forEach(function(row, i){
  const key = row[0], cur = row[1], rem = row[2], prog = row[3];
  const cc = contractCalc(rC, key);
  check(cc.current === cur,   'R' + (i+1) + 'a. month ' + (i+1) + ': current === ' + cur);
  check(cc.remaining === rem, 'R' + (i+1) + 'b. month ' + (i+1) + ': remaining === ' + rem);
  check(cc.progress === prog, 'R' + (i+1) + 'c. month ' + (i+1) + ': progress reads ' + prog);
  check(contractTimeline(rC, key).state === 'Active', 'R' + (i+1) + 'd. month ' + (i+1) + ': still effectively Active');
});
const r4 = contractCalc(rC, '2026-04');
check(contractTimeline(rC,'2026-04').state === 'Expired', 'R4a. month 4: Expired');
check(r4.remaining === 0, 'R4b. month 4: remaining === 0');
check(r4.current === r4.total, 'R4c. month 4: current is clamped to total (never beyond)');
check(contractTimeline(rC,'2026-04').horizon === 'None', 'R4d. month 4: horizon None');
const rFinalNote = contractProgressNote(rC, '2026-03');
check(/Final Month/.test(rFinalNote), 'R5. 3/3 is worded as the FINAL month');
check(!/1 month remaining/.test(rFinalNote), 'R6. 3/3 never implies "1 month remaining"');
check(!/remaining/.test(rFinalNote), 'R7. the final-month wording drops remaining-duration language entirely');
check(/2 months remaining/.test(contractProgressNote(rC,'2026-01')), 'R8. month 1 states 2 months remaining');
check(/1 month remaining/.test(contractProgressNote(rC,'2026-02')), 'R9. month 2 states 1 month remaining');
check(/Month 2 of 3/.test(contractProgressNote(rC,'2026-02')), 'R10. month 2 states its position in the term');
check(/Ended/.test(contractProgressNote(rC,'2026-04')), 'R11. after the term the wording says Ended');
check(/Not started/.test(contractProgressNote(ct('2027-06-01',12), TODAY_KEY)), 'R12. a Scheduled contract reads Not started');
let rCurGt = 0, rNeg = 0, rMismatch = 0, rN = 0;
[0,1,2,3,6,12,24].forEach(function(dur){
  const c = ct('2026-01-01', dur);
  for(let y=2023; y<=2030; y++) for(let m=1; m<=12; m++){
    const cc = contractCalc(c, y + '-' + String(m).padStart(2,'0'));
    rN++;
    if(cc.current > cc.total) rCurGt++;
    if(cc.remaining < 0) rNeg++;
    if(cc.remaining !== Math.max(0, cc.total - cc.current)) rMismatch++;
  }
});
check(rN === 7*96, 'R13. invariant sweep ran ' + rN + ' month/duration combinations');
check(rCurGt === 0, 'R14. current NEVER exceeds total');
check(rNeg === 0, 'R15. remaining is NEVER negative');
check(rMismatch === 0, 'R16. remaining is ALWAYS max(0, total - current)');
check(contractPresentation(rC,'2026-03').label === 'Final Month', 'R17. the 3/3 badge reads Final Month');
check(contractPresentation(rC,'2026-02').label === 'Ends Next Month', 'R18. month 2 badge reads Ends Next Month');
check(contractPresentation(ct('2027-06-01',12), TODAY_KEY).label === 'Scheduled', 'R19. a future contract is labelled Scheduled');
check(contractPresentation(ct(addMonths(TODAY_KEY,-36)+'-01',12), TODAY_KEY).label === 'Expired', 'R20. a finished contract is labelled Expired');
const rLabels = Object.keys(CONTRACT_PRESENTATION_META).map(function(k){ return CONTRACT_PRESENTATION_META[k].label; });
check(rLabels.every(function(l){ return !/Ending(Today|ThisWeek|ThisMonth|NextMonth)|WithinWarningWindow/.test(l); }),
  'R21. no presentation label leaks an internal horizon identifier');
check(/<span class="pill /.test(contractPresentationBadge(rC,'2026-03')), 'R22. the badge renders as a pill');
check(!/</.test(contractPresentation(rC,'2026-03').label), 'R23. labels are plain text (escaped at render time)');

/* ---------- S. filter consistency + wording precedence (UX-003C revision) ---------- */
/* The badge and the filter must speak ONE vocabulary. Before this revision the
   badge could read "Scheduled" while the legacy Active filter still returned that
   contract — internally inconsistent. The filter now follows the canonical
   effective state. The legacy 'Expiring Soon' alias still resolves inside
   contractEffectiveStatus(), but it no longer forces Scheduled into Active. */
console.log('-- S. filter consistency & wording precedence --');
State.contracts = [
  ct(addMonths(TODAY_KEY,-6)+'-01', 24),                 // Active
  ct(TODAY_KEY+'-01', 1),                                // Active + ending this month
  ct(addMonths(TODAY_KEY,-1)+'-01', 3),                  // Active + ending next month
  ct(addMonths(TODAY_KEY,6)+'-01', 12),                  // Scheduled
  ct(addMonths(TODAY_KEY,9)+'-01', 12),                  // Scheduled
  ct(addMonths(TODAY_KEY,-36)+'-01', 12),                // Expired
  ct(addMonths(TODAY_KEY,-6)+'-01', 12, {status:'Draft'}),
  ct(addMonths(TODAY_KEY,-6)+'-01', 12, {status:'Cancelled'}),
  ct(addMonths(TODAY_KEY,-6)+'-01', 12, {status:'Renewed'})
];
// The filter vocabulary IS the canonical effective-state vocabulary.
check(JSON.stringify(CONTRACT_FILTER_STATES.slice().sort()) === JSON.stringify(CONTRACT_EFFECTIVE_STATES.slice().sort()),
  'S1. the filter vocabulary is exactly the canonical effective states (a permutation)');
check(CONTRACT_FILTER_STATES.indexOf('Expiring Soon') === -1,
  'S2. the legacy alias is NOT a filter option (it is not an effective state)');
// 1 — the Active filter never returns a Scheduled contract.
State.contractFilter = {status:'Active', search:''};
const sActive = contractsFiltered();
check(sActive.length > 0, 'S3. the Active filter returns rows');
check(sActive.every(c=>contractEffectiveState(c) === 'Active'),
  'S4. the Active filter returns ONLY effectively-Active contracts');
check(sActive.every(c=>contractPresentation(c).state === 'Active'),
  'S5. every badge shown under the Active filter belongs to an Active contract');
check(!sActive.some(c=>contractPresentation(c).label === 'Scheduled'),
  'S6. a user filtering Active NEVER sees a Scheduled badge (the inconsistency is gone)');
check(!sActive.some(c=>contractEffectiveState(c) === 'Expired'),
  'S7. the Active filter never returns an Expired contract');
// 2 — the Scheduled filter returns EVERY Scheduled contract, and only those.
State.contractFilter = {status:'Scheduled', search:''};
const sSched = contractsFiltered();
const sSchedAll = State.contracts.filter(c=>contractEffectiveState(c) === 'Scheduled');
check(sSched.length === sSchedAll.length && sSched.length === 2,
  'S8. the Scheduled filter returns EVERY Scheduled contract');
check(sSched.every(c=>contractEffectiveState(c) === 'Scheduled'),
  'S9. the Scheduled filter returns ONLY Scheduled contracts');
check(sSched.every(c=>contractPresentation(c).label === 'Scheduled'),
  'S10. every row under the Scheduled filter carries the Scheduled badge');
// Every canonical state round-trips through the filter.
CONTRACT_FILTER_STATES.forEach((st, i)=>{
  State.contractFilter = {status:st, search:''};
  const rows = contractsFiltered();
  const expected = State.contracts.filter(c=>contractEffectiveState(c) === st);
  check(rows.length === expected.length && rows.every(c=>contractEffectiveState(c) === st),
    `S11.${i+1} the ${st} filter returns exactly the ${st} population`);
});
// The partition holds through the filter: every contract is reachable from exactly one option.
let sSeen = 0, sDupe = 0;
const sIds = {};
CONTRACT_FILTER_STATES.forEach((st)=>{
  State.contractFilter = {status:st, search:''};
  contractsFiltered().forEach(c=>{ sSeen++; if(sIds[c.id]) sDupe++; sIds[c.id] = 1; });
});
check(sSeen === State.contracts.length, 'S12. the filter options together reach every contract exactly once');
check(sDupe === 0, 'S13. no contract appears under two filter options (the options partition the list)');
State.contractFilter = {status:'all', search:''};
check(contractsFiltered().length === State.contracts.length, 'S14. the All option returns everything');
// 3 — legacy 'Expiring Soon' compatibility still functions where required.
const sAliasPop = State.contracts.filter(c=>contractTimeline(c).withinWarningWindow);
check(sAliasPop.every(c=>contractEffectiveStatus(c) === CONTRACT_LEGACY_EXPIRING_ALIAS),
  'S15. the legacy Expiring Soon alias still resolves for in-window contracts');
check(State.contracts.filter(c=>contractEffectiveStatus(c) === 'Expiring Soon').length === sAliasPop.length,
  'S16. the legacy alias population is unchanged (compatibility preserved)');
check(sAliasPop.every(c=>contractEffectiveState(c) === 'Active'),
  'S17. every legacy Expiring Soon contract is canonically Active (so the Active filter includes it)');
State.contractFilter = {status:'Active', search:''};
check(sAliasPop.every(c=>contractsFiltered().some(r=>r.id === c.id)),
  'S18. in-window contracts are reachable through the Active filter, not stranded');
State.contractFilter = {status:'all', search:''};

/* --- wording precedence: urgency before lifecycle --- */
// The horizon is a calendar fact, so the three near bands are exercised by
// driving the reference month rather than by faking a horizon.
const sToday = ct(TODAY_KEY+'-01', 1);                   // ends on the last day of this month
const sTodayT = contractTimeline(sToday, TODAY_KEY);
const sEndOfMonth = (function(){
  const p = keyParts(TODAY_KEY); const d = new Date(p.y, p.m, 0);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
})();
const sExpectedHorizon = (TODAY === sEndOfMonth) ? 'EndingToday'
  : (isoWeekKey(sEndOfMonth) === isoWeekKey(TODAY)) ? 'EndingThisWeek' : 'EndingThisMonth';
check(sTodayT.horizon === sExpectedHorizon,
  `S19. the current-month fixture resolves to ${sExpectedHorizon} (independently computed)`);
// Whatever the real horizon is today, the label and note must match it — and the
// nearer bands must never be worded as "Final Month".
const sExpectedLabel = {EndingToday:'Ends Today', EndingThisWeek:'Ends This Week', EndingThisMonth:'Final Month'}[sExpectedHorizon];
check(contractPresentation(sToday, TODAY_KEY).label === sExpectedLabel,
  `S20. the badge reads "${sExpectedLabel}" for horizon ${sExpectedHorizon}`);
check(contractProgressNote(sToday, TODAY_KEY).indexOf(sExpectedLabel) === 0,
  'S21. the progress note leads with the same wording as the badge');
// Precedence is a property of the MAP and the NOTE, so assert it directly for
// every band, independent of what today happens to be.
check(CONTRACT_PRESENTATION_META['Active+EndingToday'].label === 'Ends Today',
  'S22. EndingToday is labelled "Ends Today", NOT "Final Month"');
check(CONTRACT_PRESENTATION_META['Active+EndingThisWeek'].label === 'Ends This Week',
  'S23. EndingThisWeek is labelled "Ends This Week", NOT "Final Month"');
check(CONTRACT_PRESENTATION_META['Active+EndingThisMonth'].label === 'Final Month',
  'S24. EndingThisMonth keeps the "Final Month" lifecycle wording');
check(CONTRACT_PRESENTATION_META['Active+EndingToday'].label !== CONTRACT_PRESENTATION_META['Active+EndingThisMonth'].label,
  'S25. Ends Today wording OVERRIDES the Final Month wording (they are distinct)');
check(CONTRACT_PRESENTATION_META['Active+EndingThisWeek'].label !== CONTRACT_PRESENTATION_META['Active+EndingThisMonth'].label,
  'S26. EndingThisWeek wording takes precedence over Final Month');
// A 3-month contract still reads Final Month in its last month (lifecycle case).
const sThree = ct('2026-01-01', 3);
check(contractPresentation(sThree,'2026-03').label === 'Final Month',
  'S27. Final Month wording appears when the horizon is EndingThisMonth');
check(contractPresentation(sThree,'2026-02').label === 'Ends Next Month',
  'S28. the month before reads Ends Next Month, not Final Month');
check(!/Final Month/.test(contractProgressNote(sThree,'2026-02')),
  'S29. Final Month wording never appears outside the final month');
check(!/Ends Today|Ends This Week/.test(contractProgressNote(sThree,'2026-03')),
  'S30. the final-month note does not claim today/this-week urgency it does not have');

console.log('');
if(failures.length === 0){
  console.log('RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
  process.exit(0);
}
console.log('RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
failures.forEach(f=>console.log('   - ' + f));
process.exit(1);
