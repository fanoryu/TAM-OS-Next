/* ============================================================
   PEOPLE & CONTRACTS ENGINE (v2.2.0)
   Master data (employees, contracts), the calendar-month contract
   progress calculator, payroll planning, recurring expenses, and
   the monthly plan generator. All planned finance transactions that
   originate here carry structured links (employeeId / contractId /
   payrollPlanId / monthlyPlanId) — never description text alone.
   ============================================================ */

/* ============================================================
   CANONICAL PAYROLL COMMITTED-STATE PREDICATE (SPR-078)
   ------------------------------------------------------------
   ONE shared read predicate for "is this PayrollPlan committed?". It lives here,
   in the shared people-domain read helpers, because it is consumed across
   Contracts, the HR dashboard, reports, the monthly plan, the payroll engine, and
   the integrity checker — and this module loads BEFORE every one of them, so no
   consumer relies on cross-file hoisting.

   CANONICAL stored value is 'Committed' (see PAYROLL_STATUSES in
   payroll-ops-engine.js). It is the ONLY value any live writer may write.

   'committed' (lowercase) is a LEGACY READ-COMPATIBILITY value only. It was
   written by the retired Payroll Planning posting path (commitPayroll), which
   SPR-078 removed. The v2.5.0 migration (migrateToPayrollOpsSchema) already maps
   legacy lowercase forward, but it is one-time and flag-guarded, so rows written
   by the retired path AFTER that flag was set are never revisited. Those rows are
   real committed payroll with a real Finance transaction; before SPR-078 they read
   as stage "Draft", were invisible to the integrity checker and HR reports, and
   were rejected by PayrollLifecycleAggregate as an invalid state.

   Treating the legacy value as committed is the SAFE direction: a committed row is
   immutable (CLAUDE.md §8.1), so recognizing it PROTECTS it. Recognizing it is a
   READ concern only — this predicate never writes, and no migration is added or
   re-run (that remains separately authorized work).
   ============================================================ */
const PAYROLL_COMMITTED_STATUS = 'Committed';          // canonical — the only writable value
const PAYROLL_COMMITTED_STATUS_LEGACY = 'committed';   // legacy read compatibility ONLY

// Accepts a PayrollPlan record OR a bare status string. Read-only; never mutates.
function isPayrollCommitted(planOrStatus){
  if(planOrStatus == null) return false;
  const s = (typeof planOrStatus === 'string') ? planOrStatus : planOrStatus.status;
  return s === PAYROLL_COMMITTED_STATUS || s === PAYROLL_COMMITTED_STATUS_LEGACY;
}

/* ---------- month-key math ---------- */
// Transactions key months as "YYYY-MM". These helpers keep contract
// progress, payroll and planning consistent with that scheme.
function mkKey(y, m){ return `${y}-${String(m).padStart(2,'0')}`; }
function keyParts(key){ const y=+String(key).slice(0,4), m=+String(key).slice(5,7); return {y, m}; }
function keyToMonthObj(key){ const {y,m}=keyParts(key); return {key, month:NUM_MONTH[m], year:y, monthNum:m}; }
function dateToKey(iso){ if(!iso) return null; return String(iso).slice(0,7); }
function todayKey(){ return isoToday().slice(0,7); }
// 0-based absolute month index for arithmetic (year*12 + (month-1)).
function absMonth(y, m){ return y*12 + (m-1); }
function keyAbs(key){ const {y,m}=keyParts(key); return absMonth(y,m); }
function daysBetween(isoA, isoB){ return Math.round((new Date(isoB+'T00:00:00') - new Date(isoA+'T00:00:00'))/86400000); }

/* ---------- contract progress calculator ---------- */
/* UX-003A — ONE reference date per calc.
   Every field contractCalc() derives (progress, coversMonth, expiredForRef,
   beforeStart) is measured against refKey. daysUntilEnd must share that basis,
   or the same return object answers two different questions at once.

   The reference DATE for a reference MONTH:
     - current month (or refKey omitted) → isoToday(). This is exactly what an
       omitted refKey has always meant, so today-evaluated callers are unchanged
       byte for byte, and passing todayKey() explicitly is identical to omitting it.
     - any other month → that month's FIRST day. There is no "today" inside a
       historical or future month, and the first day makes the calc internally
       coherent: coversMonth <=> daysUntilEnd >= 0, and expiredForRef <=>
       daysUntilEnd < 0.
     - unusable key (null, malformed, month outside 1-12) → isoToday(), which
       LOCKS the pre-UX-003A fallback. UX-003A adds no validation semantics. */
function contractRefDate(refKey){
  const today = isoToday();
  if(!refKey) return today;
  const key = String(refKey).slice(0,7);
  if(key === today.slice(0,7)) return today;      // current month → today
  const {y, m} = keyParts(key);
  if(!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return today;
  return `${y}-${String(m).padStart(2,'0')}-01`;
}
// Pure, calendar-month based. Never stores "8/12" — always derived from
// startDate + durationMonths for a given reference month (default: current).
//   before the contract starts → 0/N
//   during month 1             → 1/N
//   after it ends              → N/N and Expired
function contractCalc(c, refKey){
  const dur = Math.max(0, Number(c && c.durationMonths)||0);
  const start = c && c.startDate ? String(c.startDate).slice(0,10) : null;
  const ref = refKey || todayKey();
  const out = {total:dur, current:0, remaining:dur, pct:0, progress:`0/${dur}`,
    beforeStart:true, coversMonth:false, expiredForRef:false,
    startDate:start, endDate:null, daysUntilEnd:null, valid:!!(start && dur>0)};
  if(!out.valid) return out;
  const sp = keyParts(start.slice(0,7));
  const startAbs = absMonth(sp.y, sp.m);
  const refAbs = keyAbs(ref);
  const elapsed = refAbs - startAbs;      // 0 = start month
  const current = elapsed + 1;            // 1 during the start month
  // end date = start + duration months − 1 day (last covered calendar day)
  const endD = new Date(sp.y, (sp.m-1)+dur, 0);
  out.endDate = `${endD.getFullYear()}-${String(endD.getMonth()+1).padStart(2,'0')}-${String(endD.getDate()).padStart(2,'0')}`;
  out.daysUntilEnd = daysBetween(contractRefDate(ref), out.endDate);
  if(current < 1){ out.current=0; out.beforeStart=true; }
  else if(current > dur){ out.current=dur; out.expiredForRef=true; out.beforeStart=false; }
  else { out.current=current; out.beforeStart=false; out.coversMonth=true; }
  out.remaining = Math.max(0, dur - out.current);
  out.pct = dur ? Math.round(out.current/dur*100) : 0;
  out.progress = `${out.current}/${dur}`;
  return out;
}
/* ---------- UX-003B canonical contract timeline model ---------- */
// ISO-8601 week key ("YYYY-Www", Monday-start) for a YYYY-MM-DD date. Computed
// in UTC so it never depends on the host timezone. Weeks legitimately span a
// month or year boundary — that is why ExpiringThisWeek is tested BEFORE
// ExpiringThisMonth in the classification order below.
function isoWeekKey(iso){
  const d = new Date(iso+'T00:00:00');
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;                     // Mon=1 .. Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - day);             // the Thursday of this week
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((t - yearStart)/86400000) + 1)/7);
  return t.getUTCFullYear()+'-W'+String(week).padStart(2,'0');
}
/* THE canonical expiry-band helper. The 30/60/90 literals live here and ONLY
   here — the inline ladders that used to sit in contracts.js and
   payroll-ops-engine.js now call this. Pure: days in, band out. */
function contractExpiryBand(days){
  if(days==null || !isFinite(days)) return null;
  return days<=30 ? 30 : days<=60 ? 60 : 90;
}
/* THE canonical timeline classifier — the single source of truth for BOTH
   timeline questions, computed once (PD-T1..PD-T4):

     { state:   one of CONTRACT_EFFECTIVE_STATES   — always present
       horizon: one of CONTRACT_EXPIRY_HORIZONS    — 'None' unless state==='Active'
       daysUntilEnd, withinWarningWindow }

   The two dimensions are INDEPENDENT. A contract ending this month is
   state 'Active' with horizon 'EndingThisMonth' — the horizon never replaces
   the effective state.

   CALENDAR HORIZONS ARE NOT GATED BY THE WARNING SETTING. EndingToday /
   ThisWeek / ThisMonth / NextMonth are calendar facts and hold at any
   contractExpiryWarningDays, including 1. Only WithinWarningWindow — the
   residual band — depends on that threshold.

   withinWarningWindow is the COMPATIBILITY ALIAS behind the legacy
   'Expiring Soon' label. It is computed here, once, so the facade below never
   re-reads the setting and no second rulebook can appear.

   Everything is measured against refKey through contractCalc()/contractRefDate();
   no branch here calls isoToday() independently. */
function contractTimeline(c, refKey){
  const none = (state)=>({state:state, horizon:'None', daysUntilEnd:null, withinWarningWindow:false});
  if(!c) return null;
  if(c.status==='Cancelled') return none('Cancelled');
  if(c.status==='Renewed')   return none('Renewed');
  if(c.status==='Draft')     return none('Draft');
  const ref = refKey || todayKey();
  const calc = contractCalc(c, ref);
  if(!calc.valid)      return none('Draft');           // unusable dates read as Draft
  if(calc.beforeStart) return Object.assign(none('Scheduled'), {daysUntilEnd:calc.daysUntilEnd});
  if(calc.expiredForRef) return Object.assign(none('Expired'), {daysUntilEnd:calc.daysUntilEnd});
  // --- effectively Active: resolve the independent horizon dimension ---
  const days = calc.daysUntilEnd;
  const warn = Number(State.settings.contractExpiryWarningDays)||90;
  const within = days!=null && days <= warn;
  const refDate = contractRefDate(ref);
  let horizon;
  if(calc.endDate === refDate)                          horizon = 'EndingToday';
  else if(isoWeekKey(calc.endDate) === isoWeekKey(refDate)) horizon = 'EndingThisWeek';
  else {
    const refM = refDate.slice(0,7), endM = calc.endDate.slice(0,7);
    const rp = keyParts(refM);
    const nextM = mkKey(rp.m===12 ? rp.y+1 : rp.y, rp.m===12 ? 1 : rp.m+1);
    if(endM === refM)       horizon = 'EndingThisMonth';
    else if(endM === nextM) horizon = 'EndingNextMonth';
    else if(within)         horizon = 'WithinWarningWindow';
    else                    horizon = 'None';
  }
  return {state:'Active', horizon:horizon, daysUntilEnd:days, withinWarningWindow:within};
}
// Thin readers over the one canonical computation — no duplicated calculation.
function contractEffectiveState(c, refKey){ const t = contractTimeline(c, refKey); return t ? t.state : null; }
function contractExpiryHorizon(c, refKey){ const t = contractTimeline(c, refKey); return t ? t.horizon : null; }
// Effective status string (derived) — Draft/Cancelled/Renewed are stored;
// Active-family contracts resolve to Active / Expiring Soon / Expired by date.
// UX-003B: a LEGACY COMPATIBILITY FACADE over the two-dimensional model. It
// returns exactly the six values it always has, so every existing badge, filter,
// counter, alert and report is byte-identical. 'Expiring Soon' is the
// compatibility alias for "effectively Active and inside the warning window" —
// it is neither a canonical state nor a canonical horizon. UX-003C owns
// surfacing Scheduled and the horizon labels.
function contractEffectiveStatus(c, refKey){
  if(!c) return '—';
  const t = contractTimeline(c, refKey);
  if(t.state==='Active' && t.withinWarningWindow) return CONTRACT_LEGACY_EXPIRING_ALIAS;
  return CONTRACT_LEGACY_STATE_DISPLAY[t.state];
}
/* ---------- UX-003C canonical presentation + counting ---------- */
/* THE presentation label for a contract, derived from the canonical two-dimensional
   model. Returns {key, label, pill}. Deliberately NOT wired into
   CONTRACT_STATUS_META, which drives the status filter — filter behaviour is
   unchanged; only the rendered label distinguishes Scheduled and the horizons. */
function contractPresentation(c, refKey){
  const t = contractTimeline(c, refKey);
  if(!t) return {key:'—', label:'—', pill:'pill-other'};
  const key = (t.state === 'Active' && t.horizon !== 'None') ? ('Active+' + t.horizon) : t.state;
  const meta = CONTRACT_PRESENTATION_META[key] || CONTRACT_PRESENTATION_META[t.state] || {label:t.state, pill:'pill-other'};
  return {key:key, label:meta.label, pill:meta.pill, state:t.state, horizon:t.horizon};
}
function contractPresentationBadge(c, refKey){
  const p = contractPresentation(c, refKey);
  return `<span class="pill ${p.pill}">${escapeHtml(p.label)}</span>`;
}
/* LIFECYCLE PROGRESS WORDING (UX-003C business rule).
   current/total is the contract month BEING SERVED, so 3/3 is the FINAL month,
   never "one month remaining". remaining is always max(0, total-current) and
   current never exceeds total — both guaranteed by contractCalc(); this helper
   only words them. */
function contractProgressNote(c, refKey){
  const cc = contractCalc(c, refKey);
  if(!cc.valid) return 'No start date or duration yet';
  const t = contractTimeline(c, refKey);
  if(t.state === 'Scheduled') return `Not started · begins ${fmtDateID(cc.startDate)}`;
  if(t.state === 'Expired')   return `Ended ${fmtDateID(cc.endDate)}`;
  // URGENCY BEFORE LIFECYCLE — the nearest horizon wins the wording, so a contract
  // ending today reads "Ends Today", never "Final Month".
  if(t.horizon === 'EndingToday')     return `Ends Today · ${fmtDateID(cc.endDate)}`;
  if(t.horizon === 'EndingThisWeek')  return `Ends This Week · ${fmtDateID(cc.endDate)}`;
  if(t.horizon === 'EndingThisMonth') return `Final Month · ends ${fmtDateID(cc.endDate)}`;
  return `Month ${cc.current} of ${cc.total} · ${cc.remaining} month${cc.remaining===1?'':'s'} remaining`;
}
/* THE canonical contract counter. Every displayed contract count resolves here —
   Contracts page, HR strip and Reports all call this one helper, so no two
   surfaces can drift or re-implement a predicate.

   The six effective states PARTITION the collection (they sum to total). The
   horizon counts are a BREAKDOWN OF `active`, never a sibling of it: this is what
   removes the old "Active: 12 / Expiring: 3" ambiguity, because the 3 are now
   genuinely among the 12 and can be worded as a subset. */
function contractTimelineCounts(refKey){
  const out = {total:0, draft:0, cancelled:0, renewed:0, scheduled:0, active:0, expired:0,
    endingToday:0, endingThisWeek:0, endingThisMonth:0, endingNextMonth:0, withinWarningWindow:0,
    endingSoon:0};
  const bucket = {Draft:'draft', Cancelled:'cancelled', Renewed:'renewed',
    Scheduled:'scheduled', Active:'active', Expired:'expired'};
  const hBucket = {EndingToday:'endingToday', EndingThisWeek:'endingThisWeek',
    EndingThisMonth:'endingThisMonth', EndingNextMonth:'endingNextMonth',
    WithinWarningWindow:'withinWarningWindow'};
  State.contracts.forEach(c=>{
    const t = contractTimeline(c, refKey);
    if(!t) return;
    out.total++;
    out[bucket[t.state]]++;
    if(t.state === 'Active' && t.horizon !== 'None'){ out[hBucket[t.horizon]]++; out.endingSoon++; }
  });
  return out;
}
function contractsForEmployee(empId){ return State.contracts.filter(c=>c.employeeId===empId); }
// The contract that funds payroll for a given month: covers it, and is not
// Draft/Cancelled. Prefer a live Active contract over a Renewed historical one.
function coveringContract(empId, monthKey){
  const cands = contractsForEmployee(empId).filter(c=>
    c.status!=='Cancelled' && c.status!=='Draft' && contractCalc(c, monthKey).coversMonth);
  if(!cands.length) return null;
  cands.sort((a,b)=> (a.status==='Renewed'?1:0)-(b.status==='Renewed'?1:0)
    || String(b.startDate||'').localeCompare(String(a.startDate||'')));
  return cands[0];
}
function activeContractToday(empId){ return coveringContract(empId, todayKey()); }
// Two Active contracts overlap if their covered month ranges intersect.
function overlappingActiveContracts(empId){
  const act = contractsForEmployee(empId).filter(c=>c.status==='Active' && contractCalc(c).valid);
  const ranges = act.map(c=>{ const sp=keyParts(String(c.startDate).slice(0,7)); const s=absMonth(sp.y,sp.m); return {c, s, e:s+(Number(c.durationMonths)||0)-1}; });
  const clash = [];
  for(let i=0;i<ranges.length;i++) for(let j=i+1;j<ranges.length;j++){
    if(ranges[i].s <= ranges[j].e && ranges[j].s <= ranges[i].e){ clash.push([ranges[i].c, ranges[j].c]); }
  }
  return clash;
}

/* ---------- linkage helpers ---------- */
function empById(id){ return State.employees.find(e=>e.id===id); }
function contractById(id){ return State.contracts.find(c=>c.id===id); }
function payrollPlanById(id){ return State.payrollPlans.find(p=>p.id===id); }
function txnsForEmployee(empId){ return State.txns.filter(t=>t.employeeId===empId); }
function txnsForContract(ctId){ return State.txns.filter(t=>t.contractId===ctId); }
function payrollPlansForContract(ctId){ return State.payrollPlans.filter(p=>p.contractId===ctId); }
// SPR-095 — read-only sibling of the two helpers above, completing the linked-record
// set ADR-014's PD-2 guard consults (payroll + transactions + overtime). Overtime rows
// carry contractId from creation (overtime.js). Nothing else calls it yet.
function overtimeRecordsForContract(ctId){ return State.overtimeRecords.filter(o=>o.contractId===ctId); }
function payrollPlansForEmployee(empId){ return State.payrollPlans.filter(p=>p.employeeId===empId); }
function empHasHistory(empId){ return txnsForEmployee(empId).length>0 || payrollPlansForEmployee(empId).length>0; }
function empEligible(e){ return e && e.active!==false && e.employmentStatus==='Active'; }
function monthlyPlanFor(key){ return State.monthlyPlans.find(p=>p.monthKey===key); }

/* ---------- shared HR UI helpers ---------- */
function openModalHTML(inner, opts){
  const root = document.getElementById('modal-root');
  State._modalOpener = document.activeElement; // remember for focus return on close
  root.innerHTML = `<div class="modal-overlay" id="hrModalOverlay"><div class="modal" role="dialog" aria-modal="true" style="max-width:${(opts&&opts.width)||560}px;max-height:88vh;overflow-y:auto;">${inner}</div></div>`;
  const ov = document.getElementById('hrModalOverlay');
  ov.addEventListener('click', e=>{ if(e.target.id==='hrModalOverlay') closeModal(); });
  if(opts && opts.onMount) opts.onMount(root);
  focusFirstIn(root); // move keyboard focus into the dialog
}
function progressBar(pct, color){ return `<div class="bar-track"><div class="bar-fill" style="width:${Math.min(100,Math.max(0,pct))}%;background:${color||'var(--accent)'};"></div></div>`; }
function hrNavTo(view, extra){ if(extra) Object.assign(State, extra); State.view=view; render(); }
function fmtDateID(iso){ if(!iso) return '—'; try{ return new Date(iso+'T00:00:00').toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'}); }catch(e){ return iso; } }
function nextEmployeeCode(){
  let max=0; State.employees.forEach(e=>{ const m=/(\d+)\s*$/.exec(e.employeeId||''); if(m) max=Math.max(max, +m[1]); });
  return 'EMP-'+String(max+1).padStart(3,'0');
}
