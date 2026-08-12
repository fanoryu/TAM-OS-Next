/* ============================================================
   SUPPLEMENTAL PAYROLL ENGINE (v2.7.0)
   A separate accounting document that settles overtime approved AFTER the
   base payroll became immutable (Posted/Executed). It NEVER mutates the base
   payroll totals, its finance transaction, or its execution history.

   Source (v1): overtime_drift only — the authoritative delta is the existing
   payrollOvertimeDrift(pp) calculation (no second overtime-delta formula).
   Lifecycle: Draft → Review → Approved → Posted → Executed (+ Cancelled).
   Store: tam_supplemental_payments_v1 (additive; SCHEMA_VERSION unchanged, 6).

   Business rules live here (centralized helpers), not in UI handlers.
   ============================================================ */
const SUPPLEMENTAL_STATUSES = ['Draft','Review','Approved','Posted','Executed','Cancelled'];
const SUPPLEMENTAL_SOURCE_TYPES = ['overtime_drift']; // extensible; v2.7.0 supports overtime drift only
const SUPPLEMENTAL_OPEN_STATUSES = ['Draft','Review'];           // editable / may refresh
const SUPPLEMENTAL_FROZEN_STATUSES = ['Approved','Posted','Executed']; // amount + source frozen
const SUPPLEMENTAL_STATUS_META = {
  'Draft':    {pill:'pill-status-planned'},
  'Review':   {pill:'pill-status-scheduled'},
  'Approved': {pill:'pill-status-partial'},
  'Posted':   {pill:'pill-status-completed'},
  'Executed': {pill:'pill-status-completed'},
  'Cancelled':{pill:'pill-status-cancelled'},
};
function supplementalStatusPill(supp){ return hrStatusBadge(supp&&supp.status||'Draft', SUPPLEMENTAL_STATUS_META); }
function supplementalSourceLabel(t){ return t==='overtime_drift' ? 'Overtime (post-payroll)' : (t||'—'); }

/* ---------- lookups & partitioning ---------- */
function supplementalById(id){ return (State.supplementalPayments||[]).find(s=>s.id===id) || null; }
function supplementalsForPlan(planId){ return (State.supplementalPayments||[]).filter(s=>s.payrollPlanId===planId); }
function supplementalsForEmployee(empId){ return (State.supplementalPayments||[]).filter(s=>s.employeeId===empId); }
function activeSupplementalsForPlan(planId){ return supplementalsForPlan(planId).filter(s=>s.status!=='Cancelled'); }
// The single OPEN (Draft/Review) supplemental for a plan+source, if any (rule 6: at most one open).
function openSupplementalForPlan(pp, sourceType){
  sourceType = sourceType || 'overtime_drift';
  return supplementalsForPlan(pp.id).find(s=>s.sourceType===sourceType && SUPPLEMENTAL_OPEN_STATUSES.includes(s.status)) || null;
}
function supplementalTxnOf(supp){ return supp && supp.financeTransactionId ? findTxn(supp.financeTransactionId) : null; }

/* ---------- money (reuse the drift per-ID formula; no second money system) ----------
   Same per-ID basis as payrollOvertimeDrift: approvedAmount when set, else calculatedAmount. */
function supplementalAmountForIds(ids){
  return (ids||[]).reduce((sum,id)=>{ const o=overtimeById(id); return sum + (o?num(o.approvedAmount!=null?o.approvedAmount:o.calculatedAmount):0); }, 0);
}

/* ---------- duplicate prevention & eligible unpaid overtime (rules 1–5) ----------
   Overtime already captured by any NON-cancelled supplemental for this plan is
   excluded, so an overtime ID is never paid twice. */
function capturedOvertimeIdsForPlan(planId, exceptSupplementalId){
  const set = new Set();
  activeSupplementalsForPlan(planId).forEach(s=>{ if(s.id!==exceptSupplementalId) (s.sourceOvertimeIds||[]).forEach(id=>set.add(id)); });
  return set;
}
function overtimeIdCapturedAnywhere(oid){
  return (State.supplementalPayments||[]).some(s=>s.status!=='Cancelled' && (s.sourceOvertimeIds||[]).includes(oid));
}
// v2.7.1 — global duplicate guard: is this overtime ID already captured by ANY other
// non-cancelled supplemental anywhere in the store (across all payroll plans)? Generation
// and refresh both use this so an overtime record can never be paid twice, even when two
// payroll plans reference the same overtime ID. Excludes the supplemental being refreshed.
function overtimeCapturedByOtherSupplemental(oid, exceptSupplementalId){
  return (State.supplementalPayments||[]).some(s=>s.status!=='Cancelled' && s.id!==exceptSupplementalId && (s.sourceOvertimeIds||[]).includes(oid));
}
// Unpaid, uncaptured overtime that can seed/refresh a delta for this plan.
function supplementalEligibleOvertime(pp, exceptSupplementalId){
  const drift = payrollOvertimeDrift(pp);
  if(!drift) return {ids:[], amount:0, drift:null, committed:false};
  const captured = capturedOvertimeIdsForPlan(pp.id, exceptSupplementalId);
  // Exclude IDs captured for this plan AND any ID captured by another supplemental anywhere
  // (cross-plan global guard) — prevents double payment when two plans share an overtime ID.
  const ids = drift.addedIds.filter(id=>!captured.has(id) && !overtimeCapturedByOtherSupplemental(id, exceptSupplementalId));
  return {ids, amount:supplementalAmountForIds(ids), drift, committed:drift.committed};
}

/* ---------- audit-safe company-account snapshot ---------- */
function supplementalAccountSnapshot(acctId){
  const a = acctId ? companyAccountById(acctId) : null;
  return a
    ? {companyAccountId:a.id, companyAccountSnapshotLabel:a.label, companyAccountSnapshotBank:a.bankName||'', companyAccountSnapshotPurpose:a.purpose||''}
    : {companyAccountId:null, companyAccountSnapshotLabel:null, companyAccountSnapshotBank:null, companyAccountSnapshotPurpose:null};
}

/* ---------- generation (explicit; never during startup/background render) ----------
   Only for base payroll that is already committed (Posted/Executed) — supplemental
   settles overtime approved AFTER immutability. Idempotent: if an open Draft/Review
   already exists, it is returned (not duplicated). Zero/negative delta → no record. */
async function generateSupplementalForPlan(planId){
  // UX-006C2C-4 (row 10) — supplemental administration is CEO-only (supplemental.manage).
  // Authorized at the top, before any State/persist/audit side effect.
  if(!can(ACTIONS.SUPPLEMENTAL_MANAGE)) return {ok:false, reason:'You do not have permission to manage supplemental payments.'};
  const pp = payrollPlanById(planId);
  if(!pp) return {ok:false, reason:'Payroll plan not found.'};
  const elig = supplementalEligibleOvertime(pp);
  if(!elig.drift) return {ok:false, reason:'No overtime drift — this payroll already matches its approved overtime.'};
  if(!elig.committed) return {ok:false, reason:'This payroll is not Posted/Executed — regenerate the base payroll instead of creating a supplemental.'};
  const open = openSupplementalForPlan(pp, 'overtime_drift');
  if(open) return {ok:true, existing:true, supplemental:open};
  if(!elig.ids.length || num(elig.amount)<=0) return {ok:false, reason:'No unpaid, uncaptured overtime — nothing to settle.'};
  const now = new Date().toISOString();
  const supp = Object.assign({
    id: uid('supp'),
    employeeId: pp.employeeId, employeeName: pp.employeeName,
    payrollPlanId: pp.id, payrollPeriod: pp.monthKey, periodLabel: `${pp.month} ${pp.year}`,
    sourceType: 'overtime_drift', sourceOvertimeIds: elig.ids.slice(),
    amount: elig.amount, status: 'Draft',
    financeTransactionId: null, executionId: null, notes: '',
    createdAt: now, updatedAt: now, reviewedAt: null, approvedAt: null, postedAt: null, executedAt: null,
    createdBy: '—', auditVersion: 1,
    history: [{event:'create', ts:now, note:`Draft supplemental — ${elig.ids.length} unpaid overtime record(s), ${fmtIDR(elig.amount)}`}],
  }, supplementalAccountSnapshot(null));
  State.supplementalPayments.push(supp);
  await persistSupplementalPayments();
  logActivity({type:'supplemental.create', module:'Supplemental Payroll', entity:pp.employeeName, entityId:supp.id,
    desc:`Created supplemental (Draft) — ${fmtIDR(supp.amount)} for ${supp.periodLabel}`,
    refs:{employeeId:pp.employeeId, payrollPlanId:pp.id, supplementalId:supp.id, monthKey:pp.monthKey}});
  return {ok:true, existing:false, supplemental:supp};
}

/* ---------- explicit, audited refresh (Draft/Review only; never Approved+) ---------- */
async function refreshSupplemental(id){
  // UX-006C2C-4 (row 11) — supplemental administration is CEO-only (supplemental.manage).
  // Authorized at the top, before any State/persist/audit side effect.
  if(!can(ACTIONS.SUPPLEMENTAL_MANAGE)) return {ok:false, reason:'You do not have permission to manage supplemental payments.'};
  const supp = supplementalById(id);
  if(!supp) return {ok:false, reason:'Supplemental not found.'};
  if(!SUPPLEMENTAL_OPEN_STATUSES.includes(supp.status)) return {ok:false, reason:'Only Draft or Review supplementals can be refreshed.'};
  const pp = payrollPlanById(supp.payrollPlanId);
  if(!pp) return {ok:false, reason:'Linked payroll plan is missing.'};
  const drift = payrollOvertimeDrift(pp);
  const capturedByOthers = capturedOvertimeIdsForPlan(pp.id, supp.id);
  const eligibleIds = (drift ? drift.addedIds : []).filter(x=>!capturedByOthers.has(x) && !overtimeCapturedByOtherSupplemental(x, supp.id));
  const added   = eligibleIds.filter(x=>!(supp.sourceOvertimeIds||[]).includes(x));
  const removed = (supp.sourceOvertimeIds||[]).filter(x=>!eligibleIds.includes(x));
  if(!added.length && !removed.length) return {ok:true, changed:false, supplemental:supp};
  supp.sourceOvertimeIds = eligibleIds.slice();
  supp.amount = supplementalAmountForIds(supp.sourceOvertimeIds);
  supp.updatedAt = new Date().toISOString();
  (supp.history=supp.history||[]).push({event:'refresh', ts:supp.updatedAt, note:`Refreshed: +${added.length} / −${removed.length} overtime record(s) → ${fmtIDR(supp.amount)}`});
  await persistSupplementalPayments();
  logActivity({type:'supplemental.refresh', module:'Supplemental Payroll', entity:supp.employeeName, entityId:supp.id,
    desc:`Refreshed supplemental — ${fmtIDR(supp.amount)} (${supp.sourceOvertimeIds.length} record(s))`,
    refs:{employeeId:supp.employeeId, payrollPlanId:supp.payrollPlanId, supplementalId:supp.id}});
  return {ok:true, changed:true, added:added.length, removed:removed.length, supplemental:supp};
}

/* ---------- lifecycle transitions (validate status; audit; timestamps) ---------- */
const SUPPLEMENTAL_TRANSITIONS = {
  submit:       {from:['Draft'],    to:'Review',   event:'review',        tsField:'reviewedAt', label:'Submit for Review'},
  returnDraft:  {from:['Review'],   to:'Draft',    event:'return_draft',  tsField:null,         label:'Return to Draft'},
  approve:      {from:['Review'],   to:'Approved', event:'approve',       tsField:'approvedAt', label:'Approve'},
  returnReview: {from:['Approved'], to:'Review',   event:'return_review', tsField:null,         label:'Return to Review'},
  cancel:       {from:['Draft','Review'], to:'Cancelled', event:'cancel', tsField:null,         label:'Cancel'},
};
function canTransitionSupplemental(supp, action){
  if(!supp) return false;
  if(action==='post') return supp.status==='Approved' && !supp.financeTransactionId;
  if(action==='cancel') return SUPPLEMENTAL_OPEN_STATUSES.includes(supp.status) && !supp.financeTransactionId;
  const t = SUPPLEMENTAL_TRANSITIONS[action];
  return !!(t && t.from.includes(supp.status));
}
async function transitionSupplemental(id, action){
  // UX-006C2C-4 (row 12) — supplemental administration is CEO-only (supplemental.manage).
  // Authorized at the top, before any State/persist/audit side effect.
  if(!can(ACTIONS.SUPPLEMENTAL_MANAGE)) return {ok:false, reason:'You do not have permission to manage supplemental payments.'};
  const supp = supplementalById(id);
  if(!supp) return {ok:false, reason:'Supplemental not found.'};
  const t = SUPPLEMENTAL_TRANSITIONS[action];
  if(!t) return {ok:false, reason:'Unknown transition.'};
  if(!t.from.includes(supp.status)) return {ok:false, reason:`Cannot ${action} from ${supp.status}.`};
  if(action==='approve' && (!(supp.sourceOvertimeIds||[]).length || num(supp.amount)<=0)) return {ok:false, reason:'Nothing to approve (zero amount).'};
  if(action==='cancel' && supp.financeTransactionId) return {ok:false, reason:'A posted supplemental cannot be cancelled.'};
  const now = new Date().toISOString();
  // v2.7.1 — freeze an immutable source-overtime snapshot no later than Approved, so the
  // Supplemental Detail source table survives later edits/deletion of the source overtime.
  if(action==='approve' && !supp.sourceOvertimeSnapshot && typeof buildPayrollOvertimeSnapshot==='function'){
    supp.sourceOvertimeSnapshot = buildPayrollOvertimeSnapshot(supp.sourceOvertimeIds||[]);
  }
  supp.status = t.to; supp.updatedAt = now;
  if(t.tsField && !supp[t.tsField]) supp[t.tsField] = now;
  (supp.history=supp.history||[]).push({event:t.event, ts:now, note:`${t.label} → ${t.to}`});
  await persistSupplementalPayments();
  logActivity({type:'supplemental.'+t.event, module:'Supplemental Payroll', entity:supp.employeeName, entityId:supp.id,
    desc:`${supp.employeeName} supplemental → ${t.to} (${fmtIDR(supp.amount)})`,
    refs:{employeeId:supp.employeeId, payrollPlanId:supp.payrollPlanId, supplementalId:supp.id}});
  return {ok:true, supplemental:supp};
}

/* ---------- account selection & notes (Draft/Review/Approved, before posting) ---------- */
async function setSupplementalAccount(id, acctId){
  // UX-006C2C-4 (row 13) — supplemental administration is CEO-only (supplemental.manage).
  // Authorized at the top, before any State/persist/audit side effect.
  if(!can(ACTIONS.SUPPLEMENTAL_MANAGE)) return {ok:false, reason:'You do not have permission to manage supplemental payments.'};
  const supp = supplementalById(id); if(!supp) return {ok:false, reason:'Supplemental not found.'};
  if(['Posted','Executed','Cancelled'].includes(supp.status)) return {ok:false, reason:'The company account is locked after posting.'};
  Object.assign(supp, supplementalAccountSnapshot(acctId||null));
  supp.updatedAt = new Date().toISOString();
  await persistSupplementalPayments();
  return {ok:true, supplemental:supp};
}
async function setSupplementalNotes(id, notes){
  // UX-006C2C-4 (row 14) — supplemental administration is CEO-only (supplemental.manage).
  // Authorized at the top, before any State/persist/audit side effect.
  if(!can(ACTIONS.SUPPLEMENTAL_MANAGE)) return {ok:false, reason:'You do not have permission to manage supplemental payments.'};
  const supp = supplementalById(id); if(!supp) return {ok:false};
  // v2.7.1 — Posted/Executed/Cancelled supplementals are immutable (notes included).
  if(['Posted','Executed','Cancelled'].includes(supp.status)) return {ok:false, reason:'Notes are locked once the supplemental is Posted.'};
  supp.notes = (notes||'').trim(); supp.updatedAt = new Date().toISOString();
  await persistSupplementalPayments();
  return {ok:true, supplemental:supp};
}

/* ---------- posting to finance (Phase D) — reuse the existing transaction model ----------
   Creates exactly ONE Planned finance transaction, linked both ways, with an immutable
   company-account snapshot. Idempotent: a supplemental that already has a finance
   transaction is never posted twice. Never touches base payroll. */
function supplementalCommitTxn(supp){
  const ts = new Date().toISOString();
  const mo = keyToMonthObj(supp.payrollPeriod);
  const uraian = `Supplemental Payroll — ${supp.employeeName} · ${supp.periodLabel} · overtime`;
  return {id:uid('pay'), monthKey:supp.payrollPeriod, month:mo.month, year:mo.year, monthNum:mo.monthNum,
    category:State.settings.defaultPayrollCategory||'Gaji', categoryCode:'A', no:null, uraian, vol:1, satuan:'bulan', hargaSatuan:num(supp.amount),
    planned:num(supp.amount), actual:null, type:'expense', txnDate:null, source:'supplemental', unplanned:false,
    scheduledDate:null, paymentMethod:null, bankAccount:supp.companyAccountSnapshotLabel||null, referenceNumber:null,
    notes:'Supplemental payroll (overtime settlement)', vendor:null,
    executionId:null, executionTimestamp:null, execution:null, status:'planned',
    employeeId:supp.employeeId, contractId:null, payrollPlanId:supp.payrollPlanId,
    supplementalId:supp.id, supplementalKind:supp.sourceType,
    companyAccountId:supp.companyAccountId||null,
    overtimeIds:(supp.sourceOvertimeIds||[]).slice(), overtimeAmount:num(supp.amount),
    payrollMeta:{employeeName:supp.employeeName, supplemental:true, period:supp.periodLabel},
    history:[{event:'created', ts, note:'Created from Supplemental Payroll posting'}]};
}
async function postSupplemental(id){
  // UX-006C2C-4 (row 15) — COMPOSITE: this posts the supplemental AND creates a finance
  // transaction. Per the frozen ruling it takes a SINGLE top gate (supplemental.manage,
  // the initiating domain), following the C2C-1 commitReadyPayroll precedent, so a denial
  // is atomic: no supplemental change and no transaction.
  if(!can(ACTIONS.SUPPLEMENTAL_MANAGE)) return {ok:false, reason:'You do not have permission to post supplemental payments.'};
  const supp = supplementalById(id); if(!supp) return {ok:false, reason:'Supplemental not found.'};
  if(supp.status!=='Approved') return {ok:false, reason:'Only Approved supplementals can be posted.'};
  if(supp.financeTransactionId) return {ok:false, reason:'This supplemental is already posted.'}; // idempotent
  if(!supp.companyAccountId) return {ok:false, reason:'Select an Active company account before posting.'};
  const acct = companyAccountById(supp.companyAccountId);
  if(!acct || acct.status!=='Active') return {ok:false, reason:'The selected company account is not Active.'};
  if(!(supp.sourceOvertimeIds||[]).length || num(supp.amount)<=0) return {ok:false, reason:'Nothing to post (zero amount).'};
  Object.assign(supp, supplementalAccountSnapshot(acct.id)); // freeze the snapshot at post time
  const now = new Date().toISOString();
  const txn = supplementalCommitTxn(supp);
  // v2.7.1 (Section 15) — coordinated persistence to avoid half-written linkage/orphans.
  // 1) create + persist the transaction first; roll back in-memory if it does not persist.
  State.txns.push(txn);
  const txnOk = await persist();
  if(!txnOk){ State.txns = State.txns.filter(t=>t.id!==txn.id); return {ok:false, reason:'Posting failed — the transaction could not be saved. Nothing was changed.'}; }
  // 2) link the supplemental and persist it; on failure, undo the transaction so no orphan remains.
  supp.financeTransactionId = txn.id; supp.status = 'Posted'; supp.postedAt = now; supp.updatedAt = now;
  (supp.history=supp.history||[]).push({event:'post', ts:now, note:`Posted to finance — Planned ${fmtIDR(supp.amount)} (${acct.label})`});
  const suppOk = await persistSupplementalPayments();
  if(!suppOk){
    // Roll back the finance transaction so no orphan remains, and VERIFY the rollback persisted.
    supp.financeTransactionId = null; supp.status = 'Approved'; supp.postedAt = null; (supp.history||[]).pop();
    State.txns = State.txns.filter(t=>t.id!==txn.id);
    const rolledBack = await persist();
    if(!rolledBack){
      // Storage is failing both ways. In memory nothing is posted; storage still holds the
      // transaction (persisted a moment ago) but NOT the supplemental link — so on reload it is a
      // detectable orphan transaction (Integrity Check → supplemental-orphan-transaction), never an
      // orphan supplemental (the supplemental write failed, so it stays Approved in storage).
      return {ok:false, unrecoverable:true, orphanTxnId:txn.id,
        reason:'Posting failed and the automatic rollback could not be saved (storage error). The supplemental is NOT posted. A stray finance transaction may remain until you reload — run Integrity Check to detect and remove it. Do not retry until storage is healthy.'};
    }
    return {ok:false, reason:'Posting failed — the supplemental could not be saved. The transaction was rolled back; nothing was changed.'};
  }
  logActivity({type:'supplemental.post', module:'Supplemental Payroll', entity:supp.employeeName, entityId:supp.id,
    desc:`Posted supplemental to finance — ${fmtIDR(supp.amount)} (${acct.label})`,
    refs:{employeeId:supp.employeeId, payrollPlanId:supp.payrollPlanId, supplementalId:supp.id, transactionId:txn.id, monthKey:supp.payrollPeriod}});
  return {ok:true, supplemental:supp, txn};
}

/* ---------- execution linkage (Phase E) — hook called from executeTransaction ----------
   When the linked Planned transaction is executed (fully) via the Execution Center, the
   supplemental becomes Executed. Idempotent: an already-Executed supplemental is never
   re-closed, so repeated execution cannot double-pay. Base payroll is untouched. */
async function linkSupplementalExecution(t){
  if(!t || !t.supplementalId) return {ok:true, changed:false};
  const supp = supplementalById(t.supplementalId); if(!supp) return {ok:true, changed:false};
  if(supp.status==='Executed') return {ok:true, changed:false}; // idempotent guard
  if(!['completed','archived'].includes(statusOf(t))) return {ok:true, changed:false}; // only when fully paid
  // v2.7.2 — snapshot the pre-execution supplemental so a failed persist can be reverted in
  // memory (memory matches storage), instead of misrepresenting it as Executed.
  const prev = {status:supp.status, executionId:supp.executionId, executedAt:supp.executedAt, updatedAt:supp.updatedAt, historyLen:(supp.history||[]).length};
  const now = new Date().toISOString();
  supp.status = 'Executed';
  supp.executionId = (t.execution && t.execution.executionId) || t.executionId || null;
  supp.executedAt = now; supp.updatedAt = now;
  (supp.history=supp.history||[]).push({event:'execute', ts:now, note:`Executed via Execution Center — ${fmtIDR(num(t.actual))}`});
  const ok = await persistSupplementalPayments();
  if(!ok){
    // The committed transaction stays executed (never rewritten). Revert the supplemental in
    // memory to match storage (still Posted) and report a clear, detectable remediation state.
    supp.status = prev.status; supp.executionId = prev.executionId; supp.executedAt = prev.executedAt; supp.updatedAt = prev.updatedAt;
    if((supp.history||[]).length > prev.historyLen) supp.history.length = prev.historyLen;
    return {ok:false, reason:'The payment was recorded, but the linked supplemental could not be updated to Executed (storage error). It remains Posted and will reconcile the next time you open/execute it — run Integrity Check if it persists.'};
  }
  logActivity({type:'supplemental.execute', module:'Supplemental Payroll', entity:supp.employeeName, entityId:supp.id,
    desc:`Supplemental executed — ${fmtIDR(num(t.actual))} (${supp.periodLabel})`,
    refs:{employeeId:supp.employeeId, supplementalId:supp.id, transactionId:t.id, executionId:supp.executionId}});
  return {ok:true, changed:true};
}

/* ---------- startup recovery: pre-2.7.2 failed-post orphan supplementals ----------
   The v2.7.1 persistHR bug made postSupplemental ALWAYS take the failure path even when the
   supplemental write actually succeeded: it left the supplemental persisted as Posted with a
   financeTransactionId while rolling the transaction OUT of storage → an orphaned Posted
   supplemental pointing at a transaction that no longer exists. This detects ONLY that exact,
   known-safe pattern and restores the record to a re-postable Approved state, with an audit
   entry. It never fabricates or alters any financial amount, never touches Executed records, and
   never touches a supplemental whose transaction still exists. Anything ambiguous is left intact
   for Integrity Check to surface. Idempotent and self-limiting: once restored the pattern no
   longer matches, so it is safe to run on every boot. */
async function recoverSupplementalOrphans(){
  try{
    const supps = State.supplementalPayments||[];
    let recovered = 0; const now = new Date().toISOString();
    supps.forEach(s=>{
      const isFailedPostOrphan = s && s.status==='Posted' && s.financeTransactionId
        && !findTxn(s.financeTransactionId) && !s.executionId && !s.executedAt;
      if(isFailedPostOrphan){
        const lostTxnId = s.financeTransactionId;
        s.financeTransactionId = null; s.status = 'Approved'; s.postedAt = null; s.updatedAt = now;
        (s.history=s.history||[]).push({event:'recover', ts:now,
          note:`Auto-recovered from a failed post (linked transaction ${lostTxnId} was never saved). Restored to Approved so it can be re-posted. No financial amount was changed.`});
        recovered++;
        if(typeof logActivity==='function') logActivity({type:'supplemental.recover', module:'Supplemental Payroll', entity:s.employeeName, entityId:s.id,
          desc:'Recovered orphaned supplemental (missing transaction) → Approved, re-postable',
          refs:{employeeId:s.employeeId, payrollPlanId:s.payrollPlanId, supplementalId:s.id}});
      }
    });
    if(recovered) await persistSupplementalPayments();
    return recovered;
  }catch(e){ console.error('recoverSupplementalOrphans skipped', e); return 0; }
}

/* ---------- per-plan supplemental state (for workspace/detail summaries) ---------- */
function supplementalPlanState(pp){
  if(!pp) return {needsGeneration:false, elig:{ids:[],amount:0}, records:[], counts:{}};
  const elig = supplementalEligibleOvertime(pp);
  const records = activeSupplementalsForPlan(pp.id);
  const counts = {Draft:0, Review:0, Approved:0, Posted:0, Executed:0};
  records.forEach(s=>{ if(counts[s.status]!=null) counts[s.status]++; });
  const open = openSupplementalForPlan(pp, 'overtime_drift');
  // "needs generation" only when the base payroll is committed, there IS eligible unpaid
  // overtime, and no open Draft/Review already holds it.
  const needsGeneration = !!(elig.committed && elig.ids.length && num(elig.amount)>0 && !open);
  return {needsGeneration, elig, records, counts, open};
}

/* ============================================================
   SUPPLEMENTAL PAYMENTS — UI (workspace + detail + post modal)
   ============================================================ */
function supplementalFiltered(){
  const f = State.supplementalFilter || {search:'', status:'all', period:'all', employee:'all'};
  let rows = (State.supplementalPayments||[]).slice();
  if(f.status!=='all') rows = rows.filter(s=>s.status===f.status);
  if(f.period!=='all') rows = rows.filter(s=>s.payrollPeriod===f.period);
  if(f.employee!=='all') rows = rows.filter(s=>s.employeeId===f.employee);
  if(f.search.trim()){ const q=normStr(f.search); rows = rows.filter(s=>[s.employeeName,s.periodLabel,s.status,s.notes].some(x=>normStr(x||'').includes(q))); }
  rows.sort((a,b)=> String(b.payrollPeriod).localeCompare(String(a.payrollPeriod)) || String(a.employeeName||'').localeCompare(String(b.employeeName||'')));
  return rows;
}
function supplementalLinkedTxnCell(s){
  if(!s.financeTransactionId) return '<span class="dim">—</span>';
  const t = findTxn(s.financeTransactionId);
  if(!t) return '<span class="dim">(missing)</span>';
  return `<span class="faint">${escapeHtml(statusOf(t))}</span>`;
}
function supplementalRowActions(s){
  const items = [['supp-detail','View Detail']];
  if(canTransitionSupplemental(s,'submit')) items.push(['supp-submit','Submit for Review']);
  if(canTransitionSupplemental(s,'approve')) items.push(['supp-approve','Approve']);
  if(canTransitionSupplemental(s,'returnDraft')) items.push(['supp-return-draft','Return to Draft']);
  if(canTransitionSupplemental(s,'returnReview')) items.push(['supp-return-review','Return to Review']);
  if(SUPPLEMENTAL_OPEN_STATUSES.includes(s.status)) items.push(['supp-refresh','Refresh from Overtime']);
  if(canTransitionSupplemental(s,'post')) items.push(['supp-post','Post to Finance']);
  if(s.status==='Posted') items.push(['supp-exec','Open in Execution Center']);
  if(canTransitionSupplemental(s,'cancel')) items.push(['supp-cancel','Cancel']);
  return hrActionsMenu('supp', s.id, items);
}
function supplementalRowsHTML(){
  return supplementalFiltered().map(s=>`<tr>
      <td><button class="linklike" data-hr-action="supp-detail" data-hr-id="${s.id}"><b>${escapeHtml(s.employeeName||'—')}</b></button></td>
      <td class="dim">${escapeHtml(s.periodLabel||s.payrollPeriod||'—')}</td>
      <td class="dim">${escapeHtml(supplementalSourceLabel(s.sourceType))}</td>
      <td class="num"><b>${fmtIDR(s.amount)}</b></td>
      <td>${supplementalStatusPill(s)}</td>
      <td>${supplementalLinkedTxnCell(s)}</td>
      <td>${supplementalRowActions(s)}</td>
    </tr>`).join('') || `<tr><td colspan="7" class="empty">No supplemental payments. Generate one from an overtime-drift warning in the Payroll Workspace.</td></tr>`;
}
function applySupplementalFilter(main){
  const tb=document.getElementById('suppRows'); if(!tb) return;
  tb.innerHTML=supplementalRowsHTML();
  const el=document.getElementById('suppShown'); if(el) el.textContent=supplementalFiltered().length;
  bindHRActions(main);
}
function renderSupplementalPayments(main){
  if(!State.supplementalFilter) State.supplementalFilter={search:'', status:'all', period:'all', employee:'all'};
  const f=State.supplementalFilter;
  const all=State.supplementalPayments||[];
  const periods=[...new Set(all.map(s=>s.payrollPeriod))].sort().reverse();
  const emps=[...new Map(all.map(s=>[s.employeeId,s.employeeName])).entries()];
  const totalOpen=all.filter(s=>SUPPLEMENTAL_OPEN_STATUSES.includes(s.status)).length;
  const totalPosted=all.filter(s=>s.status==='Posted').length;
  main.innerHTML = pageHeader('Supplemental Payments',
      'Separate payroll documents that settle overtime approved after the base payroll became immutable. The base payroll is never modified. Source (v2.7.0): overtime only.',
      '', `Supplemental Payment is planned to expand to other adjustment types in a later release; v2.7.0 settles overtime drift only.`)
    + `<div class="grid grid-4 stack-section">
        <div class="card stat-card"><div class="stat-label">Total</div><div class="stat-value">${all.length}</div></div>
        <div class="card stat-card"><div class="stat-label">Open (Draft/Review)</div><div class="stat-value">${totalOpen}</div></div>
        <div class="card stat-card"><div class="stat-label">Posted — awaiting execution</div><div class="stat-value">${totalPosted}</div></div>
        <div class="card stat-card"><div class="stat-label">Shown</div><div class="stat-value" id="suppShown">${supplementalFiltered().length}</div></div>
      </div>
      <div class="card">
        <div class="form-grid" style="grid-template-columns:1.4fr 1fr 1fr 1fr;margin-bottom:12px;">
          <div class="field"><label>Search</label><input class="input" id="suppSearch" placeholder="employee, period…" value="${escapeHtml(f.search)}"></div>
          <div class="field"><label>Status</label><select class="input" id="suppStatus"><option value="all">All statuses</option>${SUPPLEMENTAL_STATUSES.map(s=>`<option ${f.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
          <div class="field"><label>Period</label><select class="input" id="suppPeriod"><option value="all">All periods</option>${periods.map(p=>{const o=keyToMonthObj(p);return `<option value="${p}" ${f.period===p?'selected':''}>${o.month} ${o.year}</option>`;}).join('')}</select></div>
          <div class="field"><label>Employee</label><select class="input" id="suppEmp"><option value="all">All employees</option>${emps.map(([id,name])=>`<option value="${id}" ${f.employee===id?'selected':''}>${escapeHtml(name||id)}</option>`).join('')}</select></div>
        </div>
        <div class="table-wrap" style="max-height:560px;overflow:auto;">
          <table>
            <thead><tr><th>Employee</th><th>Period</th><th>Source</th><th class="num">Amount</th><th>Status</th><th>Finance</th><th></th></tr></thead>
            <tbody id="suppRows">${supplementalRowsHTML()}</tbody>
          </table>
        </div>
        <p class="hint" style="margin-top:10px;">Lifecycle: Draft → Review → Approved → Post to Finance → Execute (Execution Center). Amount and source overtime freeze at Approved. Posting creates one Planned transaction; execution records the actual payment. Account numbers are shown masked.</p>
      </div>`;
  document.getElementById('suppSearch').addEventListener('input', e=>{ State.supplementalFilter.search=e.target.value; applySupplementalFilter(main); });
  document.getElementById('suppStatus').addEventListener('change', e=>{ State.supplementalFilter.status=e.target.value; applySupplementalFilter(main); });
  document.getElementById('suppPeriod').addEventListener('change', e=>{ State.supplementalFilter.period=e.target.value; applySupplementalFilter(main); });
  document.getElementById('suppEmp').addEventListener('change', e=>{ State.supplementalFilter.employee=e.target.value; applySupplementalFilter(main); });
  bindHRActions(main);
}
function renderSupplementalDetail(main){
  const s = supplementalById(State.detailSupplementalId);
  if(!s){ main.innerHTML=emptyState('Supplemental not found','It may have been cancelled or removed.'); return; }
  const emp=empById(s.employeeId), pp=payrollPlanById(s.payrollPlanId), txn=supplementalTxnOf(s);
  const frozenSnap = (SUPPLEMENTAL_FROZEN_STATUSES.includes(s.status) && Array.isArray(s.sourceOvertimeSnapshot) && s.sourceOvertimeSnapshot.length) ? s.sourceOvertimeSnapshot : null;
  const liveRecs=(s.sourceOvertimeIds||[]).map(overtimeById).filter(Boolean);
  const recs = frozenSnap || liveRecs;                       // v2.7.1 prefer frozen snapshot after Approved
  const acctDisplay = s.companyAccountSnapshotLabel ? `${escapeHtml(s.companyAccountSnapshotLabel)}${s.companyAccountSnapshotBank?' — '+escapeHtml(s.companyAccountSnapshotBank):''}` : '<span class="dim">not selected</span>';
  main.innerHTML = pageHeader(`Supplemental — ${escapeHtml(s.employeeName||'')}`, `${escapeHtml(s.periodLabel||'')} · ${escapeHtml(supplementalSourceLabel(s.sourceType))}`,
      `<button class="btn" id="spBack">← Supplemental Payments</button>${emp?`<button class="btn" id="spEmp">Employee</button>`:''}${pp?`<button class="btn" id="spPay">Base Payroll</button>`:''}${txn?`<button class="btn" id="spTxn">Transaction</button>`:''}`)
    + `<div class="grid grid-2" style="margin-bottom:var(--space-4);align-items:start;">
      <div class="card"><h3>Supplemental ${supplementalStatusPill(s)}</h3><div style="font-size:13px;line-height:1.8;">
        <div>ID: <span class="mono faint">${escapeHtml(s.id)}</span></div>
        <div>Employee: <b>${escapeHtml(s.employeeName||'—')}</b></div>
        <div>Payroll period: <b>${escapeHtml(s.periodLabel||s.payrollPeriod||'—')}</b></div>
        <div>Source: <b>${escapeHtml(supplementalSourceLabel(s.sourceType))}</b> · ${recs.length} overtime record(s)</div>
        <div class="divider" style="margin:8px 0;"></div>
        <div style="font-size:15px;">Amount: <b class="mono" style="color:var(--accent);">${fmtIDR(s.amount)}</b></div>
        <div>Company account: <b>${acctDisplay}</b></div>
        <div>Notes: ${s.notes?escapeHtml(s.notes):'<span class="dim">—</span>'}</div>
        <p class="hint" style="margin-top:8px;">This supplemental does not change the base payroll total or its transaction. Amount and source overtime freeze at Approved.</p>
      </div></div>
      <div class="card"><h3>Finance & Execution</h3>${txn?`<div style="font-size:13px;line-height:1.8;">
        <div>Transaction: ${statusBadge(statusOf(txn))}</div>
        <div>Planned: <b class="mono">${fmtIDR(txn.planned)}</b> · Actual: <b class="mono">${txn.actual!=null?fmtIDR(txn.actual):'—'}</b></div>
        <div>Bank account: <b>${escapeHtml(s.companyAccountSnapshotLabel||'—')}</b> <span class="faint">(snapshot)</span></div>
        <div>Execution: <b>${s.executionId?escapeHtml(s.executionId):'—'}</b></div>
        <div style="margin-top:8px;"><button class="btn btn-sm" id="spExec">Open in Execution Center</button></div>
      </div>`:'<div class="empty">Not posted to finance yet. Approve, then Post to Finance to create a Planned transaction.</div>'}</div>
    </div>
    <div class="card stack-section"><h3>Source Overtime <span class="tag">${recs.length}</span>${frozenSnap?' <span class="pill pill-status-completed" title="Frozen at Approved — does not change if source overtime is later edited or deleted">frozen</span>':''}</h3>
      ${frozenSnap?'<p class="hint" style="margin-top:-2px;margin-bottom:8px;">Frozen source snapshot — captured when this supplemental was approved.</p>':''}
      <div class="table-wrap"><table><thead><tr><th>Date</th><th class="num">Hours</th><th class="num">Amount</th><th>Status</th></tr></thead>
      <tbody>${recs.map(o=>`<tr><td class="dim">${escapeHtml(o.overtimeDate||'—')}</td><td class="num">${num(o.overtimeHours)}</td><td class="num">${fmtIDR(o.approvedAmount!=null?o.approvedAmount:o.calculatedAmount)}</td><td>${frozenSnap?escapeHtml(o.statusAtCommit||'—'):hrStatusBadge(o.status,OVERTIME_STATUS_META)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">No linked overtime.</td></tr>'}</tbody></table></div></div>
    <div class="card"><h3>History</h3><div class="hist-list">${(s.history||[]).map(h=>`<div class="hist-row"><span class="hist-event">${escapeHtml((h.event||'').replace(/_/g,' '))}</span><span class="hist-note">${escapeHtml(h.note||'')}</span><span class="hist-ts faint">${h.ts?new Date(h.ts).toLocaleString('id-ID'):'—'}</span></div>`).join('')||'<div class="empty">No history.</div>'}</div></div>
    <div class="small-btn-row" style="margin-top:var(--space-4);flex-wrap:wrap;gap:8px;">${supplementalDetailActionsHTML(s)}</div>`;
  const on=(id,fn)=>{ const el=document.getElementById(id); if(el) el.addEventListener('click', fn); };
  on('spBack', ()=>hrNavTo('supplementals'));
  on('spEmp', ()=>hrNavTo('employeeDetail',{detailEmpId:emp.id}));
  on('spPay', ()=>hrNavTo('payrollDetail',{detailPayrollId:pp.id}));
  on('spTxn', ()=>{ if(txn) openDetailModal(txn.id); });
  on('spExec', ()=>{ if(txn) focusTransactionInExecutionCenter(txn.id); else showWarning('Not posted to a transaction yet.'); });
  bindSupplementalDetailActions(main, s);
}
function supplementalDetailActionsHTML(s){
  const btn=(act,label,cls)=>`<button class="btn ${cls||''}" data-supp-act="${act}" data-supp-id="${s.id}">${label}</button>`;
  let h='';
  if(canTransitionSupplemental(s,'submit')) h+=btn('submit','Submit for Review');
  if(canTransitionSupplemental(s,'returnDraft')) h+=btn('returnDraft','Return to Draft');
  if(canTransitionSupplemental(s,'approve')) h+=btn('approve','Approve','btn-accent');
  if(canTransitionSupplemental(s,'returnReview')) h+=btn('returnReview','Return to Review');
  if(SUPPLEMENTAL_OPEN_STATUSES.includes(s.status)) h+=btn('refresh','Refresh from Overtime');
  if(canTransitionSupplemental(s,'post')) h+=btn('post','Post to Finance','btn-accent');
  if(s.status==='Posted') h+=btn('exec','Open in Execution Center','btn-accent');
  if(canTransitionSupplemental(s,'cancel')) h+=btn('cancel','Cancel','btn-danger');
  return h || '<span class="dim" style="font-size:12px;">No actions available for this status.</span>';
}
function bindSupplementalDetailActions(main, s){
  main.querySelectorAll('[data-supp-act]').forEach(b=>b.addEventListener('click', ()=>handleSupplementalAction(b.dataset.suppAct, b.dataset.suppId)));
}
async function handleSupplementalAction(act, id){
  const s=supplementalById(id); if(!s) return;
  if(act==='detail'){ hrNavTo('supplementalDetail',{detailSupplementalId:id}); return; }
  if(act==='exec'){ const t=supplementalTxnOf(s); if(t) focusTransactionInExecutionCenter(t.id); else showWarning('Not posted to a transaction yet.'); return; }
  if(act==='post'){ openSupplementalPostModal(id); return; }
  if(act==='refresh'){ const r=await refreshSupplemental(id); if(r.ok&&r.changed) showSuccess(`Refreshed — now ${fmtIDR(supplementalById(id).amount)}.`); else if(r.ok) showSuccess('Already up to date.'); else showWarning(r.reason); render(); return; }
  const map={submit:'submit', returnDraft:'returnDraft', approve:'approve', returnReview:'returnReview', cancel:'cancel'};
  if(map[act]){
    if(act==='cancel' && !confirmAction('Cancel this supplemental? It will not be paid. This cannot be undone.')) return;
    const r=await transitionSupplemental(id, map[act]);
    if(r.ok) showSuccess(`Supplemental → ${r.supplemental.status}.`); else showWarning(r.reason);
    render();
  }
}
function openSupplementalPostModal(id){
  const s=supplementalById(id); if(!s) return;
  if(s.status!=='Approved'){ showWarning('Only Approved supplementals can be posted.'); return; }
  // v2.7.1 (Section 14) — company-account empty state. Disable Post and guide the user to
  // Bank Accounts instead of showing an unusable empty dropdown; distinguish "none" from
  // "all Inactive/Archived". The supplemental and its status are preserved; no transaction.
  const active = activeCompanyAccounts();
  const anyAccounts = (State.companyAccounts||[]).length>0;
  if(!active.length){
    const msg = anyAccounts
      ? 'All company accounts are Inactive or Archived. Activate one in Settings → Bank Accounts before posting.'
      : 'No Active company account is available.';
    openModalHTML(`<h3>Post Supplemental to Finance</h3>
      <div class="insight-item warn" style="display:block;margin-bottom:10px;">${escapeHtml(msg)}</div>
      <p class="hint">The supplemental stays Approved and no transaction is created. Add or activate a company account, then Post again.</p>
      <div class="modal-actions"><button type="button" class="btn" id="spPostCancel">Cancel</button><button type="button" class="btn btn-accent" id="spOpenBanks">Open Bank Accounts</button></div>`,
      {width:520, onMount:(root)=>{
        root.querySelector('#spPostCancel').addEventListener('click', closeModal);
        root.querySelector('#spOpenBanks').addEventListener('click', ()=>{ closeModal(); State.view='bankaccounts'; render(); });
      }});
    return;
  }
  openModalHTML(`<h3>Post Supplemental to Finance</h3>
    <div style="font-size:12.5px;line-height:1.9;">
      <div>Employee: <b>${escapeHtml(s.employeeName)}</b> · ${escapeHtml(s.periodLabel)}</div>
      <div>Amount: <b class="mono" style="color:var(--accent);">${fmtIDR(s.amount)}</b> · ${(s.sourceOvertimeIds||[]).length} overtime record(s)</div>
    </div>
    <form id="spPostForm"><div class="form-grid" style="grid-template-columns:1fr;margin-top:10px;">
      <div class="field"><label>Company Account (Active only)</label><select class="input" name="companyAccountId" required>${active.map(a=>`<option value="${a.id}" ${s.companyAccountId===a.id?'selected':''}>${escapeHtml(companyAccountLabel(a))}</option>`).join('')}</select></div>
    </div>
    <p class="hint" style="margin-top:6px;">Creates one Planned finance transaction (not executed). Execute it later in the Execution Center. The account is snapshotted and will not change if the account is later renamed.</p>
    <div class="modal-actions"><button type="button" class="btn" id="spPostCancel">Cancel</button><button type="submit" class="btn btn-accent">Post ${fmtIDR(s.amount)}</button></div></form>`,
    {width:560, onMount:(root)=>{
      root.querySelector('#spPostCancel').addEventListener('click', closeModal);
      root.querySelector('#spPostForm').addEventListener('submit', async ev=>{
        ev.preventDefault(); const acctId=new FormData(ev.target).get('companyAccountId');
        if(!acctId){ showWarning('Select an Active company account first (Settings → Bank Accounts).'); return; }
        await setSupplementalAccount(id, acctId);
        const r=await postSupplemental(id);
        closeModal();
        if(r.ok) showSuccess(`Posted ${fmtIDR(r.supplemental.amount)} to finance.`); else showWarning(r.reason);
        render();
      });
    }});
}

/* ---------- delegated actions for the actionable drift banner (Phase B) ----------
   Generation is ALWAYS user-initiated (a click), never during background render. */
document.addEventListener('click', async (e)=>{
  const gen = e.target.closest && e.target.closest('[data-supp-gen]');
  if(gen){
    e.preventDefault();
    const r = await generateSupplementalForPlan(gen.dataset.suppGen);
    if(r.ok){ showSuccess(r.existing ? 'Opened the existing Draft/Review supplemental.' : `Draft supplemental created — ${fmtIDR(r.supplemental.amount)}.`);
      hrNavTo('supplementalDetail', {detailSupplementalId:r.supplemental.id}); }
    else showWarning(r.reason);
    return;
  }
  const open = e.target.closest && e.target.closest('[data-supp-open]');
  if(open){ e.preventDefault(); hrNavTo('supplementalDetail', {detailSupplementalId:open.dataset.suppOpen}); }
}, false);

/* ---------- contextual sections (Phase F) — reused by Payroll Detail & Employee Detail.
   Links use data-supp-open / data-supp-gen, handled by the delegated listener above. */
function supplementalPlanSectionHTML(pp){
  if(!pp) return '';
  const recs = activeSupplementalsForPlan(pp.id);
  const st = supplementalPlanState(pp);
  if(!recs.length && !st.needsGeneration) return '';
  const subtotal = recs.reduce((s,x)=>s+num(x.amount),0);
  const rows = recs.map(s=>`<div class="hist-row"><span class="hist-event">${supplementalStatusPill(s)}</span><span class="hist-note"><button class="linklike" data-supp-open="${s.id}">${fmtIDR(s.amount)}</button> · ${escapeHtml(supplementalSourceLabel(s.sourceType))}</span><span class="hist-ts faint">${s.updatedAt?new Date(s.updatedAt).toLocaleDateString('id-ID'):''}</span></div>`).join('');
  const genBtn = st.needsGeneration ? `<button class="btn btn-sm btn-accent" data-supp-gen="${pp.id}" style="margin-top:8px;">Generate Supplemental (${fmtIDR(st.elig.amount)})</button>` : '';
  return `<div class="card stack-section"><h3>Supplemental Payments <span class="tag">${recs.length}</span></h3>
    <p class="hint" style="margin-top:-2px;margin-bottom:8px;">Separate documents for overtime approved after this payroll was posted. They do <b>not</b> change the base payroll total above.</p>
    ${recs.length?`<div class="hist-list">${rows}</div><div style="margin-top:8px;font-size:13px;">Supplemental subtotal: <b class="mono">${fmtIDR(subtotal)}</b> <span class="faint">(separate from base payroll)</span></div>`:'<div class="empty">None yet.</div>'}
    ${genBtn}</div>`;
}
function supplementalEmployeeSectionHTML(empId){
  const recs = supplementalsForEmployee(empId).filter(s=>s.status!=='Cancelled');
  if(!recs.length) return '';
  const rows = recs.map(s=>`<div class="hist-row"><span class="hist-event">${supplementalStatusPill(s)}</span><span class="hist-note"><button class="linklike" data-supp-open="${s.id}">${fmtIDR(s.amount)}</button> · ${escapeHtml(s.periodLabel||'')}</span><span class="hist-ts faint">${escapeHtml(supplementalSourceLabel(s.sourceType))}</span></div>`).join('');
  return `<div class="card stack-section"><h3>Supplemental Payments <span class="tag">${recs.length}</span></h3><div class="hist-list">${rows}</div></div>`;
}
