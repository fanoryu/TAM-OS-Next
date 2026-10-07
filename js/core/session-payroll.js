/* ============================================================
   SESSION PAYROLL DATA (AFI-4c1, AFI-4c2, AFI-4d, AFI-4e, AFI-4f) — js/core/session-payroll.js
   ------------------------------------------------------------
   The SESSION-mode Payroll section of the authenticated workspace — CEO only — over BF-4c1:
   one month's payroll plans, a plan's detail with its contributing overtime, "Prepare payroll"
   (generate: Drafts for the eligible employees, Drafts recalculated, Reviewed / Ready plans left
   alone, the excluded employees reported) and the pre-commit lifecycle (Draft → Reviewed;
   Draft / Reviewed → Ready; Reviewed / Ready → Draft; Draft / Reviewed / Ready → Cancelled).
   Held in memory only and owned here — never in the LOCAL `State`, never in storage, the URL or
   history, never through a LOCAL repository or the LOCAL payroll modules
   (js/people/payroll-ops-engine.js, js/people/payroll-workspace.js). The server (PayrollApi,
   js/core/payroll-api.js) is the only source; this module only remembers its last decoded
   answers for the view. It computes no money: every amount is the exact string of a decoded
   server answer, shown as sent. Nothing here pays, posts or commits anything — Ready is an
   approved plan, not a payment, and Committed (BF-4c2) is display-only (D-AFI4c1-1 = A).

   SessionPayrollStore — the data:
     principalKey  the principal the data belongs to (user, role, binding)
     generation    bumped by clear(): logout, session loss, a different principal
     open          the Payroll section is shown (the Employees section stays the default)
     month         the month shown, "YYYY-MM": the browser's local calendar month when the section
                   first opens, then Previous / Next / the month field. Memory only.
     list, listMonth, listSeq, listStatus, listStale   the month's plans
     detail, detailId, detailSeq, detailStatus         one plan: { plan, overtime }
     excluded, excludedMonth   the employees the last confirmed generate of that month left out
                   ({ employeeId, reason }); forgotten on a month change, reload or logout
     people, labelsSeq, labelsStatus   the CEO Employee list (EmployeeApi.list({ archived: true }))
                   that names the excluded employees (D-AFI4c1-4 = A) — read only when there is an
                   exclusion to name; an id it cannot name is shown as the id, never guessed
     error         { scope, kind, retryAfter?, requestId? } of the last failed list / detail read
     labelsError   the same for the Employee list
     panel         the open confirmation { kind, id }: generate | review | approve | return | cancel
     mutation      { kind, status, error, fields, target } of the write — status idle | pending |
                   error | ambiguous; target { month } (generate) or { id, version }
     mutationSeq   the sequence of the write in flight
     notice, focus a fixed message key / a focus hint for the view

   A request takes a token { gen, kind, seq }; its answer is applied only while token.gen is the
   current generation AND token.seq is still the latest of its kind (list, detail, labels,
   mutation). A superseded read is ignored; a sent write is never aborted, and its late answer is
   dropped the same way.

   SessionPayroll — the controller the view calls. CEO only: for any other principal every entry
   point is a no-op and no Payroll request is ever made. Controls are UX only: every action is
   checked again here (sessionPayrollActions) and the server decides. Every write asks first (an
   inline confirmation) and is sent once; only the strictly decoded, confirming server answer
   changes the data — nothing is optimistic. A 401 (or a recovery that found the session gone)
   ends the session (AuthBoot.sessionLost()); a recovery that could not confirm it fails closed
   (AuthBoot.sessionUncertain()); a different principal destroys the data. ANY 409 closes the
   confirmation, reads the plan (or the month) again and asks for a new deliberate action; an
   outcome that cannot be known (503, network, timeout, malformed or non-confirming success) is
   AMBIGUOUS: the same re-read, and the write is NEVER sent again by this module.

   AFI-4c2 (over BF-4c2; owner decisions D-AFI4c2-1..3 = A):
     COMMIT (CEO, a Ready plan): a deliberate confirmation creates ONE commit intent
       { id, version, total, key } — the plan's decoded totalAmount string as it is and one Web
       Crypto key — held here in memory only and sent once. A strictly confirming answer (the
       same plan, Committed, version + 1, the same total) is a success. Any 409 (the server
       reports one generic conflict; its cause is never claimed) or other definite refusal drops
       the intent and reads the plan again. An outcome that cannot be known (503, 500, network,
       timeout, a malformed or non-confirming answer) keeps the intent and reads the plan again —
       NEVER resent automatically. That read decides: Committed at version + 1 with the same total
       is the success; still Ready at the same version and total keeps the intent and offers
       "Retry commit", which on a deliberate click sends exactly the same body and key (the
       server's idempotent replay, SDR-0002 §10 — the one exception to "never resent"); anything
       else drops the intent as stale; a failed read keeps it and sends nothing.
     DRIFT (CEO): read whenever a Ready plan's detail becomes current (so also after a commit 409)
       — the explanation of what changed, never authority: Commit is offered by status alone and
       the server decides.
     MY PAYROLL (Employee): the same section and month bar over the Employee's own Committed
       plans only (PayrollApi.myMonth / myGet); never a drift read, never a write.
   drift, driftId, driftSeq, driftStatus belong to the detail; commitIntent survives a re-read
   and is destroyed by clear() (logout, session loss, a different principal).

   AFI-4d (over BF-4d; owner decisions D-AFI4d-1 = A, D-AFI4d-2 = A): SUPPLEMENTAL PAYROLL — a
   separate obligation settling Approved overtime of a month that the employee's already-Committed
   base plan does not contain. It lives in this same store, so it shares the generation, clear(),
   the principal binding and the one write in flight:
     suppList, suppListMonth, suppListSeq, suppListStatus, suppListError   the month's documents
     elig, eligMonth, eligSeq, eligStatus, eligError   the CEO's eligibility of the month (one entry
                   per Committed base plan), named from that plan's own snapshot in `list` — never
                   from the Employee list
     suppDetail, suppDetailId, suppDetailSeq, suppDetailStatus   one document: { doc, overtime };
                   exclusive with the plan detail (opening one closes the other)
     suppIntent    the one Supplemental commit intent { id, version, total, key } — total is the
                   document's own overtimeAmount string; destroyed by clear()
   The CEO's month reads the plans, the Supplemental documents and the eligibility; "Prepare
   supplemental payroll" (generate, { payrollPlanId }) answers the plan's open document — a new or
   recalculated Draft, or an open Reviewed / Ready document untouched; the lifecycle is linear
   (Draft: review / cancel; Reviewed: approve / return / cancel; Ready: commit / return / cancel —
   there is no Draft → Ready); Commit follows D-AFI4c2-1 exactly (one intent, a re-read after an
   unknown outcome, a deliberate same-key "Retry commit"). An Employee's My payroll also reads their
   own Committed documents (SupplementalApi.myMonth / myGet) — never the eligibility, never a write.
   Nothing here adds a base plan and a Supplemental document together.

   AFI-4e (over BF-4e, PR #50; owner decisions D-AFI4e-1..5 = A): FINANCE POSTING — the CEO posts
   one Committed base plan or one Committed Supplemental document, from its own detail, as one
   immutable, Planned Finance posting. It lives in this same store (D-AFI4e-2 = A), so it shares the
   generation, clear(), the principal binding and the one write in flight:
     fin, finMonth, finSeq, finStatus, finError   the CEO's Finance postings of the month
                   (FinancePostingApi.month), read with the month, again whenever a plan or a
                   Supplemental document is opened, and after every posting outcome (D-AFI4e-4 = A)
     postIntent    the one posting intent { sourceKind, sourceId, employeeId, monthKey, amount, key }
                   — the source's own amount string and one Web Crypto key, frozen, memory only;
                   destroyed by clear()
   A source is matched to its posting by sourceKind + sourceId. Post is offered only for a Committed
   source the month's Finance read shows unposted — never while that read loads or failed, never
   while another posting intent is unresolved. Every post asks first and is sent once. A strictly
   confirming answer is a success; ANY 409 (the server reports one generic conflict; its cause is
   never claimed) or other definite refusal drops the intent and reads the source and the Finance
   postings again; an outcome that cannot be known keeps the intent and reads both again — NEVER
   resent automatically. Those reads decide: posted at the intent's amount is the success; still
   Committed, unposted, at the same amount keeps the intent and offers "Retry posting", which on a
   deliberate click sends exactly the same body and key (the server replays the original posting,
   D-AFI4e-3 = A); anything else drops it as stale. An Employee never reads or writes Finance.
   Nothing here pays, executes, reverses or corrects anything, and LOCAL is untouched.

   AFI-4f (over BF-4f, PR #52; owner decisions D-AFI4f-1..8 = A): RECORD PAYMENT — the CEO records,
   on the same detail and in the same Finance card, that one Planned posting was paid in full
   OUTSIDE TAM OS (one BF-4f execution). TAM OS moves no money. In this same store (D-AFI4f-2 = A):
     exec, execMonth, execSeq, execStatus, execError   the CEO's executions of the month
                   (FinanceExecutionApi.month), read together with the postings (loadFinance)
     execIntent    the one execution intent { financePostingId, employeeId, monthKey, amount,
                   executedOn, paymentMethod, key } — the posting's own amount string, the date and
                   method chosen, one Web Crypto key; frozen, memory only; destroyed by clear()
     payDraft      the open form's Date paid and Payment method (memory only), and the fields the
                   last confirmation found missing
   A posting is matched to its execution by financePostingId. Record payment is offered only when
   the source is Committed, its posting is read and consistent with it, the month's executions are
   read and hold none of it, and no posting or execution intent is unresolved — never while either
   read is idle, loading, failed or inconsistent. The intent is frozen before it is sent, once. The
   rules are AFI-4e's: a confirming answer is the success; ANY 409 (generic — its cause is never
   claimed) or other definite refusal drops the intent and reads the Finance status again; an
   unknown outcome keeps the intent and reads it again — NEVER resent automatically. Those reads
   decide: recorded with the intent's amount, date and method is the success; the posting at the
   same amount with no execution keeps the intent and offers "Retry recording", which on a
   deliberate click sends exactly the same body and key (D-AFI4f-5 = A); anything else drops it as
   stale. An Employee never reads or writes an execution (D-AFI4f-7 = A).

   Classic shared global scope; top-level `const` bindings, not on window.
   ============================================================ */

const SESSION_PAYROLL_STATUS = Object.freeze({ IDLE: 'idle', LOADING: 'loading', READY: 'ready', ERROR: 'error' });
const SESSION_PAYROLL_MUTATION_STATUS = Object.freeze({ IDLE: 'idle', PENDING: 'pending', ERROR: 'error', AMBIGUOUS: 'ambiguous' });
const SESSION_PAYROLL_PANEL_KINDS = Object.freeze(['generate', 'review', 'approve', 'return', 'cancel', 'commit']);
const SESSION_PAYROLL_MUTATION_IDLE = Object.freeze({ kind: null, status: SESSION_PAYROLL_MUTATION_STATUS.IDLE, error: null, fields: null, target: null });

// The control matrix of a plan (BF-4c1 PayrollStatus::TRANSITIONS; BF-4c2 Commit from Ready) — UX
// only; the server decides every write again. CEO only. Committed and Cancelled offer nothing.
const SESSION_PAYROLL_ACTIONS = Object.freeze({
  Draft: Object.freeze(['review', 'approve', 'cancel']),
  Reviewed: Object.freeze(['approve', 'return', 'cancel']),
  Ready: Object.freeze(['commit', 'return', 'cancel'])
});
const SESSION_PAYROLL_NONE = Object.freeze([]);
function sessionPayrollIsCeo(principal){ return !!principal && principal.principalType === PRINCIPAL_TYPES.CEO; }
// AFI-4c2: an Employee bound to their employee record reads their own Committed payroll (My payroll).
function sessionPayrollIsEmployee(principal){
  return !!principal && principal.principalType === PRINCIPAL_TYPES.EMPLOYEE && typeof principal.employeeId === 'string' && PAYROLL_EMPLOYEE_ID_PATTERN.test(principal.employeeId);
}
// AFI-4c2: what the reconciling read of a commit intent shows — 'committed' (the commit was
// applied: Committed at version + 1 with the same total), 'unresolved' (still Ready at the same
// version and total: Retry commit may send the same intent), or 'stale' (anything else).
function sessionPayrollIntentState(intent, plan){
  if(!intent || !plan || plan.id !== intent.id) return null;
  if(plan.status === 'Committed' && plan.version === intent.version + 1 && plan.totalAmount === intent.total) return 'committed';
  if(plan.status === 'Ready' && plan.version === intent.version && plan.totalAmount === intent.total) return 'unresolved';
  return 'stale';
}
function sessionPayrollActions(principal, plan){
  if(!sessionPayrollIsCeo(principal) || !plan) return SESSION_PAYROLL_NONE;
  return Object.prototype.hasOwnProperty.call(SESSION_PAYROLL_ACTIONS, plan.status) ? SESSION_PAYROLL_ACTIONS[plan.status] : SESSION_PAYROLL_NONE;
}

// AFI-4d: the Supplemental control matrix (BF-4d SupplementalStatus::TRANSITIONS; Commit from
// Ready) — UX only; the server decides every write again. CEO only. There is no Draft → Ready:
// a Draft is reviewed before it is approved. Committed and Cancelled offer nothing.
const SESSION_SUPPLEMENTAL_ACTIONS = Object.freeze({
  Draft: Object.freeze(['review', 'cancel']),
  Reviewed: Object.freeze(['approve', 'return', 'cancel']),
  Ready: Object.freeze(['commit', 'return', 'cancel'])
});
// The Supplemental confirmations and writes, and the operation each one is.
const SESSION_SUPPLEMENTAL_PANEL_KINDS = Object.freeze(['suppGenerate', 'suppReview', 'suppApprove', 'suppReturn', 'suppCancel', 'suppCommit']);
const SESSION_SUPPLEMENTAL_OPERATION = Object.freeze({ suppReview: 'review', suppApprove: 'approve', suppReturn: 'return', suppCancel: 'cancel', suppCommit: 'commit' });
function sessionSupplementalActions(principal, doc){
  if(!sessionPayrollIsCeo(principal) || !doc) return SESSION_PAYROLL_NONE;
  return Object.prototype.hasOwnProperty.call(SESSION_SUPPLEMENTAL_ACTIONS, doc.status) ? SESSION_SUPPLEMENTAL_ACTIONS[doc.status] : SESSION_PAYROLL_NONE;
}
// AFI-4d: the reconciling read of a Supplemental commit intent — 'committed' (Committed at
// version + 1 with the same amount), 'unresolved' (still Ready at the same version and amount:
// Retry commit may send the same intent) or 'stale' (anything else).
function sessionSupplementalIntentState(intent, doc){
  if(!intent || !doc || doc.id !== intent.id) return null;
  if(doc.status === 'Committed' && doc.version === intent.version + 1 && doc.overtimeAmount === intent.total) return 'committed';
  if(doc.status === 'Ready' && doc.version === intent.version && doc.overtimeAmount === intent.total) return 'unresolved';
  return 'stale';
}
// AFI-4d: the name of an eligibility entry — the snapshot of its own base plan (same payrollPlanId)
// in the month's plan list: { employeeName, employeeCode }, or null while that list is not there
// or does not hold the plan. Never the Employee list, never a guess.
function sessionSupplementalPlanOf(listStatus, list, planId){
  if(listStatus !== SESSION_PAYROLL_STATUS.READY || !list) return null;
  const hits = list.filter((p) => p.id === planId);
  return hits.length === 1 ? hits[0] : null;
}

// AFI-4e: the two posting confirmations and writes, and the source kind each one posts.
const SESSION_FINANCE_PANEL_KINDS = Object.freeze(['finPostPlan', 'finPostSupp']);
const SESSION_FINANCE_SOURCE_KIND = Object.freeze({ finPostPlan: 'payrollPlan', finPostSupp: 'supplementalPayroll' });
// AFI-4e: the source of `sourceKind` shown in its detail (a plan, a Supplemental document), or null.
function sessionFinanceSource(s, sourceKind){
  if(sourceKind === 'payrollPlan') return (s.detailStatus === SESSION_PAYROLL_STATUS.READY && s.detail && s.detail.plan.id === s.detailId) ? s.detail.plan : null;
  if(sourceKind === 'supplementalPayroll') return (s.suppDetailStatus === SESSION_PAYROLL_STATUS.READY && s.suppDetail && s.suppDetail.doc.id === s.suppDetailId) ? s.suppDetail.doc : null;
  return null;
}
// AFI-4e: the Finance status of a source — { state: 'none' } (not Committed: no Finance line),
// 'loading' (the month's postings are not read yet), 'error' (they could not be read), 'posted'
// (with its posting) or 'unposted'; null without a source. Matched by sourceKind + sourceId only.
function sessionFinanceStatus(s, sourceKind, source){
  if(!source) return null;
  if(source.status !== 'Committed') return Object.freeze({ state: 'none' });
  if(s.finStatus === SESSION_PAYROLL_STATUS.ERROR && s.finMonth === source.monthKey) return Object.freeze({ state: 'error' });
  if(s.finStatus !== SESSION_PAYROLL_STATUS.READY || !s.fin || s.finMonth !== source.monthKey) return Object.freeze({ state: 'loading' });
  const hits = s.fin.filter((p) => p.sourceKind === sourceKind && p.sourceId === source.id);
  return hits.length ? Object.freeze({ state: 'posted', posting: hits[0] }) : Object.freeze({ state: 'unposted' });
}
// AFI-4e: what the reads of a posting intent's source show — 'posted' (a posting of it at the
// intent's amount), 'unresolved' (still Committed and unposted at the same amount: Retry posting
// may send the same intent), 'stale' (anything else), or null (not this source, or not known yet).
function sessionFinanceIntentState(intent, sourceKind, source, status){
  if(!intent || !source || !status || intent.sourceKind !== sourceKind || intent.sourceId !== source.id) return null;
  if(status.state === 'posted') return status.posting.amount === intent.amount ? 'posted' : 'stale';
  if(status.state === 'unposted') return financePostingSourceAmount(sourceKind, source) === intent.amount ? 'unresolved' : 'stale';
  if(status.state === 'none') return 'stale';
  return null;
}

// AFI-4f: the two Record payment confirmations and writes, and the source kind of each.
const SESSION_FINANCE_EXECUTION_PANEL_KINDS = Object.freeze(['finRecordPlan', 'finRecordSupp']);
const SESSION_FINANCE_EXECUTION_SOURCE_KIND = Object.freeze({ finRecordPlan: 'payrollPlan', finRecordSupp: 'supplementalPayroll' });
const SESSION_FINANCE_EXECUTION_DRAFT_IDLE = Object.freeze({ executedOn: '', paymentMethod: '', missing: Object.freeze([]) });
// AFI-4f: the payment status of a source — null unless the month's Finance read shows it posted;
// else { state, posting } with state 'inconsistent' (the posting, or its execution, does not match
// the source), 'loading' (the executions are not read yet), 'error' (they could not be read),
// 'unrecorded' or 'recorded' (with its financeExecution). Matched by financePostingId only.
function sessionFinanceExecutionStatus(s, sourceKind, source){
  const f = sessionFinanceStatus(s, sourceKind, source);
  if(!f || f.state !== 'posted') return null;
  const p = f.posting;
  if(p.amount !== financePostingSourceAmount(sourceKind, source) || p.employeeId !== source.employeeId || p.monthKey !== source.monthKey) return Object.freeze({ state: 'inconsistent', posting: p });
  if(s.execStatus === SESSION_PAYROLL_STATUS.ERROR && s.execMonth === p.monthKey) return Object.freeze({ state: 'error', posting: p });
  if(s.execStatus !== SESSION_PAYROLL_STATUS.READY || !s.exec || s.execMonth !== p.monthKey) return Object.freeze({ state: 'loading', posting: p });
  const hits = s.exec.filter((e) => e.financePostingId === p.id);
  if(!hits.length) return Object.freeze({ state: 'unrecorded', posting: p });
  if(hits[0].amount !== p.amount || hits[0].employeeId !== p.employeeId || hits[0].monthKey !== p.monthKey) return Object.freeze({ state: 'inconsistent', posting: p });
  return Object.freeze({ state: 'recorded', posting: p, financeExecution: hits[0] });
}
// AFI-4f: what the reads of an execution intent show — 'recorded' (an execution of its posting at
// the intent's amount, date and method), 'unresolved' (its posting at the same amount, with no
// execution: Retry recording may send the same intent), 'stale' (anything else), or null (the
// month's postings and executions are not both read for the intent's month yet).
function sessionFinanceExecutionIntentState(s, intent){
  if(!intent) return null;
  if(s.finStatus !== SESSION_PAYROLL_STATUS.READY || !s.fin || s.finMonth !== intent.monthKey
    || s.execStatus !== SESSION_PAYROLL_STATUS.READY || !s.exec || s.execMonth !== intent.monthKey) return null;
  const hits = s.exec.filter((e) => e.financePostingId === intent.financePostingId);
  if(hits.length){
    const e = hits[0];
    return (e.amount === intent.amount && e.executedOn === intent.executedOn && e.paymentMethod === intent.paymentMethod
      && e.employeeId === intent.employeeId && e.monthKey === intent.monthKey) ? 'recorded' : 'stale';
  }
  const p = s.fin.filter((x) => x.id === intent.financePostingId);
  return (p.length === 1 && p[0].amount === intent.amount && p[0].employeeId === intent.employeeId) ? 'unresolved' : 'stale';
}

// The month the section opens on: the local calendar month of `now` (injectable; a Date by default).
function sessionPayrollCurrentMonth(now){
  return OvertimeCalendar.monthOf(now || new Date());
}

// The name of an excluded employee (D-AFI4c1-4 = A): "fullName (code)" from the CEO Employee list
// when exactly one entry has the id; while the list loads, null (the view says so); otherwise the
// id itself — never a guessed or another employee's name.
function sessionPayrollExcludedName(labelsStatus, people, employeeId){
  if(labelsStatus === SESSION_PAYROLL_STATUS.LOADING) return null;
  const hits = (labelsStatus === SESSION_PAYROLL_STATUS.READY && people) ? people.filter((e) => e.id === employeeId) : [];
  return hits.length === 1 ? hits[0].fullName + ' (' + hits[0].employeeCode + ')' : employeeId;
}

const SessionPayrollStore = (function(){
  let principalKey = null;
  let generation = 0;
  let open = false, month = null;
  let list = null, listMonth = null, listSeq = 0, listStatus = SESSION_PAYROLL_STATUS.IDLE, listStale = false;
  let detail = null, detailId = null, detailSeq = 0, detailStatus = SESSION_PAYROLL_STATUS.IDLE;
  let excluded = null, excludedMonth = null;
  let people = null, labelsSeq = 0, labelsStatus = SESSION_PAYROLL_STATUS.IDLE, labelsError = null;
  let error = null;
  let mutation = SESSION_PAYROLL_MUTATION_IDLE, mutationSeq = 0;
  let panel = null, notice = null, focus = null;
  let drift = null, driftId = null, driftSeq = 0, driftStatus = SESSION_PAYROLL_STATUS.IDLE;   // AFI-4c2
  let commitIntent = null;                                                                        // AFI-4c2
  // AFI-4d: Supplemental Payroll.
  let suppList = null, suppListMonth = null, suppListSeq = 0, suppListStatus = SESSION_PAYROLL_STATUS.IDLE, suppListError = null;
  let elig = null, eligMonth = null, eligSeq = 0, eligStatus = SESSION_PAYROLL_STATUS.IDLE, eligError = null;
  let suppDetail = null, suppDetailId = null, suppDetailSeq = 0, suppDetailStatus = SESSION_PAYROLL_STATUS.IDLE;
  let suppIntent = null;
  // AFI-4e: Finance posting.
  let fin = null, finMonth = null, finSeq = 0, finStatus = SESSION_PAYROLL_STATUS.IDLE, finError = null;
  let postIntent = null;
  // AFI-4f: Record payment (Finance execution).
  let exec = null, execMonth = null, execSeq = 0, execStatus = SESSION_PAYROLL_STATUS.IDLE, execError = null;
  let execIntent = null, payDraft = SESSION_FINANCE_EXECUTION_DRAFT_IDLE;

  function keyOf(p){
    return p ? [p.id, p.principalType, p.employeeId || ''].join('|') : null;
  }
  function seqOf(kind){
    return kind === 'list' ? listSeq : kind === 'detail' ? detailSeq : kind === 'labels' ? labelsSeq : kind === 'mutation' ? mutationSeq : kind === 'drift' ? driftSeq
      : kind === 'suppList' ? suppListSeq : kind === 'elig' ? eligSeq : kind === 'suppDetail' ? suppDetailSeq : kind === 'fin' ? finSeq : kind === 'exec' ? execSeq : -1;
  }
  function isLive(token){ return !!token && token.gen === generation; }
  function isCurrent(token){
    return isLive(token) && token.seq === seqOf(token.kind);
  }
  function forgetDrift(){ driftSeq++; drift = null; driftId = null; driftStatus = SESSION_PAYROLL_STATUS.IDLE; }
  // AFI-4d: the month's Supplemental reads, and the Supplemental detail (a pending answer is dropped).
  function forgetSupplementalMonth(){
    suppList = null; suppListMonth = null; suppListStatus = SESSION_PAYROLL_STATUS.IDLE; suppListError = null; suppListSeq++;
    elig = null; eligMonth = null; eligStatus = SESSION_PAYROLL_STATUS.IDLE; eligError = null; eligSeq++;
  }
  function forgetSupplementalDetail(){
    suppDetailSeq++; suppDetail = null; suppDetailId = null; suppDetailStatus = SESSION_PAYROLL_STATUS.IDLE;
    if(error && error.scope === 'suppDetail') error = null;
  }
  // AFI-4e: the month's Finance postings (a pending answer is dropped).
  function forgetFinance(){ finSeq++; fin = null; finMonth = null; finStatus = SESSION_PAYROLL_STATUS.IDLE; finError = null; }
  // AFI-4f: the month's executions (a pending answer is dropped).
  function forgetFinanceExecutions(){ execSeq++; exec = null; execMonth = null; execStatus = SESSION_PAYROLL_STATUS.IDLE; execError = null; }
  function clear(){
    forgetDrift(); commitIntent = null;
    forgetSupplementalMonth(); forgetSupplementalDetail(); suppIntent = null;      // AFI-4d: and its key
    forgetFinance(); postIntent = null;                                            // AFI-4e: and its key
    forgetFinanceExecutions(); execIntent = null; payDraft = SESSION_FINANCE_EXECUTION_DRAFT_IDLE;   // AFI-4f: and its key
    open = false; month = null;
    list = null; listMonth = null; listStatus = SESSION_PAYROLL_STATUS.IDLE; listStale = false; listSeq++;
    detail = null; detailId = null; detailStatus = SESSION_PAYROLL_STATUS.IDLE; detailSeq++;
    excluded = null; excludedMonth = null;
    people = null; labelsStatus = SESSION_PAYROLL_STATUS.IDLE; labelsError = null; labelsSeq++;
    error = null;
    mutation = SESSION_PAYROLL_MUTATION_IDLE; mutationSeq++;
    panel = null; notice = null; focus = null;
    principalKey = null;
    generation++;
  }
  function clearError(scope){ if(error && error.scope === scope) error = null; }
  function failure(f){
    const e = { kind: f.kind };
    if(f.retryAfter !== undefined) e.retryAfter = f.retryAfter;
    if(f.requestId) e.requestId = f.requestId;
    return Object.freeze(e);
  }

  return Object.freeze({
    clear: clear,
    // Binds the data to this principal; a different principal first destroys everything.
    bindPrincipal(p){
      const key = keyOf(p);
      if(key === principalKey) return false;
      clear();
      principalKey = key;
      return true;
    },
    // Shows or leaves the section. The month is chosen once, when it is first shown.
    setOpen(value, initialMonth){
      open = value === true;
      if(open && month === null) month = initialMonth;
    },
    // Another month: its list is read again; the exclusions, the detail and the panel go.
    setMonth(key){
      month = key;
      list = null; listMonth = null; listStatus = SESSION_PAYROLL_STATUS.IDLE; listStale = false; listSeq++; clearError('list');
      detailSeq++; detail = null; detailId = null; detailStatus = SESSION_PAYROLL_STATUS.IDLE; clearError('detail');
      forgetDrift();
      forgetSupplementalMonth(); forgetSupplementalDetail();                      // AFI-4d
      forgetFinance();                                                            // AFI-4e
      forgetFinanceExecutions();                                                         // AFI-4f
      excluded = null; excludedMonth = null; panel = null;
    },
    // A request token; the new request supersedes any earlier one of its kind.
    begin(kind, arg){
      if(kind === 'list'){
        listSeq++; listMonth = arg; list = null; listStatus = SESSION_PAYROLL_STATUS.LOADING; listStale = false; clearError('list');
        return Object.freeze({ gen: generation, kind: kind, seq: listSeq });
      }
      if(kind === 'detail'){
        detailSeq++; detailId = arg; detail = null; detailStatus = SESSION_PAYROLL_STATUS.LOADING; clearError('detail');
        forgetDrift();                       // a drift answer belongs to the detail it was read for
        return Object.freeze({ gen: generation, kind: kind, seq: detailSeq });
      }
      if(kind === 'drift'){
        driftSeq++; driftId = arg; drift = null; driftStatus = SESSION_PAYROLL_STATUS.LOADING;
        return Object.freeze({ gen: generation, kind: kind, seq: driftSeq, id: arg });
      }
      if(kind === 'labels'){
        labelsSeq++; people = null; labelsStatus = SESSION_PAYROLL_STATUS.LOADING; labelsError = null;
        return Object.freeze({ gen: generation, kind: kind, seq: labelsSeq });
      }
      // AFI-4d: the month's Supplemental documents, its eligibility, one Supplemental document.
      if(kind === 'suppList'){
        suppListSeq++; suppListMonth = arg; suppList = null; suppListStatus = SESSION_PAYROLL_STATUS.LOADING; suppListError = null;
        return Object.freeze({ gen: generation, kind: kind, seq: suppListSeq });
      }
      if(kind === 'elig'){
        eligSeq++; eligMonth = arg; elig = null; eligStatus = SESSION_PAYROLL_STATUS.LOADING; eligError = null;
        return Object.freeze({ gen: generation, kind: kind, seq: eligSeq });
      }
      if(kind === 'suppDetail'){
        suppDetailSeq++; suppDetailId = arg; suppDetail = null; suppDetailStatus = SESSION_PAYROLL_STATUS.LOADING; clearError('suppDetail');
        return Object.freeze({ gen: generation, kind: kind, seq: suppDetailSeq });
      }
      // AFI-4e: the month's Finance postings (CEO).
      if(kind === 'fin'){
        finSeq++; finMonth = arg; fin = null; finStatus = SESSION_PAYROLL_STATUS.LOADING; finError = null;
        return Object.freeze({ gen: generation, kind: kind, seq: finSeq });
      }
      // AFI-4f: the month's executions (CEO).
      if(kind === 'exec'){
        execSeq++; execMonth = arg; exec = null; execStatus = SESSION_PAYROLL_STATUS.LOADING; execError = null;
        return Object.freeze({ gen: generation, kind: kind, seq: execSeq });
      }
      throw new Error('unknown session payroll request kind');
    },
    isLive: isLive,
    isCurrent: isCurrent,
    applyList(token, items){
      if(!isCurrent(token) || token.kind !== 'list') return false;
      list = items; listStatus = SESSION_PAYROLL_STATUS.READY;
      return true;
    },
    // Only for the plan it was asked for, while that plan is still the detail.
    applyDetail(token, item){
      if(!isCurrent(token) || token.kind !== 'detail' || !item || item.plan.id !== detailId) return false;
      detail = item; detailStatus = SESSION_PAYROLL_STATUS.READY;
      return true;
    },
    applyLabels(token, items){
      if(!isCurrent(token) || token.kind !== 'labels') return false;
      people = items; labelsStatus = SESSION_PAYROLL_STATUS.READY;
      return true;
    },
    // AFI-4c2: only for the plan it was read for, while that plan is still the detail.
    applyDrift(token, item){
      if(!isCurrent(token) || token.kind !== 'drift' || !item || item.id !== driftId || driftId !== detailId) return false;
      drift = item; driftStatus = SESSION_PAYROLL_STATUS.READY;
      return true;
    },
    // AFI-4d: only for the month they were read for.
    applySuppList(token, items){
      if(!isCurrent(token) || token.kind !== 'suppList' || suppListMonth !== month) return false;
      suppList = items; suppListStatus = SESSION_PAYROLL_STATUS.READY;
      return true;
    },
    applyElig(token, items){
      if(!isCurrent(token) || token.kind !== 'elig' || eligMonth !== month) return false;
      elig = items; eligStatus = SESSION_PAYROLL_STATUS.READY;
      return true;
    },
    // AFI-4d: only for the document it was asked for, while that document is still the detail.
    applySuppDetail(token, item){
      if(!isCurrent(token) || token.kind !== 'suppDetail' || !item || item.doc.id !== suppDetailId) return false;
      suppDetail = item; suppDetailStatus = SESSION_PAYROLL_STATUS.READY;
      return true;
    },
    // AFI-4e: only for the month they were read for.
    applyFin(token, items){
      if(!isCurrent(token) || token.kind !== 'fin' || finMonth !== month) return false;
      fin = items; finStatus = SESSION_PAYROLL_STATUS.READY;
      return true;
    },
    // AFI-4f: only for the month they were read for.
    applyExec(token, items){
      if(!isCurrent(token) || token.kind !== 'exec' || execMonth !== month) return false;
      exec = items; execStatus = SESSION_PAYROLL_STATUS.READY;
      return true;
    },
    applyError(token, failed){
      if(!isCurrent(token)) return false;
      if(token.kind === 'exec'){ exec = null; execStatus = SESSION_PAYROLL_STATUS.ERROR; execError = failure(failed); return true; }   // AFI-4f
      if(token.kind === 'fin'){ fin = null; finStatus = SESSION_PAYROLL_STATUS.ERROR; finError = failure(failed); return true; }   // AFI-4e
      if(token.kind === 'drift'){ drift = null; driftStatus = SESSION_PAYROLL_STATUS.ERROR; return true; }
      if(token.kind === 'suppList'){ suppList = null; suppListStatus = SESSION_PAYROLL_STATUS.ERROR; suppListError = failure(failed); return true; }
      if(token.kind === 'elig'){ elig = null; eligStatus = SESSION_PAYROLL_STATUS.ERROR; eligError = failure(failed); return true; }
      if(token.kind === 'suppDetail'){
        suppDetail = null; suppDetailStatus = SESSION_PAYROLL_STATUS.ERROR;
        error = Object.freeze(Object.assign({ scope: 'suppDetail' }, failure(failed)));
        return true;
      }
      if(token.kind === 'labels'){ people = null; labelsStatus = SESSION_PAYROLL_STATUS.ERROR; labelsError = failure(failed); return true; }
      if(token.kind === 'list'){ list = null; listStatus = SESSION_PAYROLL_STATUS.ERROR; }
      else { detail = null; detailStatus = SESSION_PAYROLL_STATUS.ERROR; }
      error = Object.freeze(Object.assign({ scope: token.kind }, failure(failed)));
      return true;
    },
    // Leaves the detail: a pending detail answer is dropped, and the plan's confirmation goes.
    closeDetail(){
      detailSeq++; detail = null; detailId = null; detailStatus = SESSION_PAYROLL_STATUS.IDLE; clearError('detail');
      forgetDrift();
      if(panel && panel.kind !== 'generate' && panel.kind !== 'suppGenerate') panel = null;
    },
    // AFI-4d: leaves the Supplemental detail; its confirmation goes.
    closeSuppDetail(){
      forgetSupplementalDetail();
      if(panel && panel.kind !== 'generate' && panel.kind !== 'suppGenerate') panel = null;
    },

    /* ---------- writes ---------- */
    openPanel(kind, id){
      mutationSeq++; mutation = SESSION_PAYROLL_MUTATION_IDLE; notice = null;
      panel = Object.freeze({ kind: kind, id: id });
    },
    closePanel(){ mutationSeq++; mutation = SESSION_PAYROLL_MUTATION_IDLE; panel = null; },
    resetMutation(){ mutation = SESSION_PAYROLL_MUTATION_IDLE; notice = null; },
    beginMutation(kind, target){
      if(SESSION_PAYROLL_PANEL_KINDS.indexOf(kind) === -1 && SESSION_SUPPLEMENTAL_PANEL_KINDS.indexOf(kind) === -1 && SESSION_FINANCE_PANEL_KINDS.indexOf(kind) === -1
        && SESSION_FINANCE_EXECUTION_PANEL_KINDS.indexOf(kind) === -1) throw new Error('unknown session payroll mutation kind');
      mutationSeq++;
      mutation = Object.freeze({ kind: kind, status: SESSION_PAYROLL_MUTATION_STATUS.PENDING, error: null, fields: null, target: target || null });
      notice = null;
      return Object.freeze({ gen: generation, kind: 'mutation', seq: mutationSeq });
    },
    // A write that failed definitely (ERROR) or whose outcome is unknown (AMBIGUOUS). Either way
    // the confirmation closes: what is read again decides what is offered next.
    failMutation(token, status, failed){
      if(!isCurrent(token) || token.kind !== 'mutation') return false;
      mutation = Object.freeze({ kind: mutation.kind, status: status, error: failure(failed),
        fields: failed.fields ? Object.freeze(failed.fields.slice()) : null, target: mutation.target });
      panel = null;
      return true;
    },
    // A confirmed generate of `forMonth`: its exclusions are kept; the month's list is stale (the
    // generate answer lists live plans only, so the list is always read again).
    applyGenerated(token, forMonth, result){
      if(!isCurrent(token) || token.kind !== 'mutation' || forMonth !== month) return false;
      excluded = result.excluded; excludedMonth = forMonth;
      panel = null; mutation = SESSION_PAYROLL_MUTATION_IDLE; listStale = true; notice = 'generated';
      return true;
    },
    // A confirmed transition: the plan answered becomes the detail's plan at once; the detail is
    // read again for its contributing overtime (a cancel releases it), and the list is stale.
    applyTransitioned(token, plan, noticeKey){
      if(!isCurrent(token) || token.kind !== 'mutation' || !plan || plan.id !== detailId) return false;
      detail = Object.freeze({ plan: plan, overtime: detail ? detail.overtime : Object.freeze([]) });
      detailStatus = SESSION_PAYROLL_STATUS.READY;
      panel = null; mutation = SESSION_PAYROLL_MUTATION_IDLE; listStale = true; notice = noticeKey;
      return true;
    },
    // AFI-4d: a confirmed generate for the month shown: the base plan's open document. The month is
    // read again (documents and eligibility); the notice says whether it is a Draft or an open
    // Reviewed / Ready document returned unchanged — never that a new Draft was made.
    applySuppGenerated(token, forMonth, doc){
      if(!isCurrent(token) || token.kind !== 'mutation' || forMonth !== month || !doc) return false;
      panel = null; mutation = SESSION_PAYROLL_MUTATION_IDLE; listStale = true;
      notice = doc.status === 'Draft' ? 'suppGeneratedDraft' : 'suppGeneratedOpen';
      return true;
    },
    // AFI-4d: a confirmed Supplemental transition: the document answered becomes the detail's at
    // once; the detail is read again for its captured overtime (a cancel releases it).
    applySuppTransitioned(token, doc, noticeKey){
      if(!isCurrent(token) || token.kind !== 'mutation' || !doc || doc.id !== suppDetailId) return false;
      suppDetail = Object.freeze({ doc: doc, overtime: suppDetail ? suppDetail.overtime : Object.freeze([]) });
      suppDetailStatus = SESSION_PAYROLL_STATUS.READY;
      panel = null; mutation = SESSION_PAYROLL_MUTATION_IDLE; listStale = true; notice = noticeKey;
      return true;
    },
    // AFI-4d: the one Supplemental commit intent (frozen; memory only) and its end.
    setSuppIntent(intent){ suppIntent = Object.freeze({ id: intent.id, version: intent.version, total: intent.total, key: intent.key }); },
    dropSuppIntent(){ suppIntent = null; },
    // AFI-4e: a confirmed posting: the confirmation closes; the month's postings are read again.
    applyPosted(token){
      if(!isCurrent(token) || token.kind !== 'mutation') return false;
      panel = null; mutation = SESSION_PAYROLL_MUTATION_IDLE; notice = 'finRecorded';
      return true;
    },
    // AFI-4e: the one posting intent (frozen; memory only) and its end.
    setPostIntent(intent){
      postIntent = Object.freeze({ sourceKind: intent.sourceKind, sourceId: intent.sourceId, employeeId: intent.employeeId, monthKey: intent.monthKey, amount: intent.amount, key: intent.key });
    },
    dropPostIntent(){ postIntent = null; },
    // AFI-4f: a confirmed execution: the confirmation closes; the Finance status is read again.
    applyFinanceExecutionRecorded(token){
      if(!isCurrent(token) || token.kind !== 'mutation') return false;
      panel = null; mutation = SESSION_PAYROLL_MUTATION_IDLE; notice = 'payRecorded'; payDraft = SESSION_FINANCE_EXECUTION_DRAFT_IDLE;
      return true;
    },
    // AFI-4f: the one execution intent (frozen; memory only) and its end.
    setExecIntent(intent){
      execIntent = Object.freeze({ financePostingId: intent.financePostingId, employeeId: intent.employeeId, monthKey: intent.monthKey, amount: intent.amount,
        executedOn: intent.executedOn, paymentMethod: intent.paymentMethod, key: intent.key });
    },
    dropExecIntent(){ execIntent = null; },
    // AFI-4f: the open form's two fields (strings, as typed or chosen) and the missing ones.
    resetPayDraft(){ payDraft = SESSION_FINANCE_EXECUTION_DRAFT_IDLE; },
    setPayDraft(name, value){
      if((name !== 'executedOn' && name !== 'paymentMethod') || typeof value !== 'string') return;
      const next = { executedOn: payDraft.executedOn, paymentMethod: payDraft.paymentMethod, missing: payDraft.missing };
      next[name] = value;
      payDraft = Object.freeze(next);
    },
    setPayDraftMissing(fields){
      payDraft = Object.freeze({ executedOn: payDraft.executedOn, paymentMethod: payDraft.paymentMethod, missing: Object.freeze(fields.slice()) });
    },
    markListStale(){ listStale = true; },
    // AFI-4c2: the one commit intent (frozen; memory only) and its end.
    setIntent(intent){ commitIntent = Object.freeze({ id: intent.id, version: intent.version, total: intent.total, key: intent.key }); },
    dropIntent(){ commitIntent = null; },
    // The commit's outcome became known from a re-read: the message changes, nothing is sent.
    resolveMutation(noticeKey){ mutation = SESSION_PAYROLL_MUTATION_IDLE; notice = noticeKey; },
    setNotice(key){ notice = key; },
    setFocus(hint){ focus = hint; },
    takeFocus(){ const f = focus; focus = null; return f; },

    snapshot(){
      return Object.freeze({
        principalKey: principalKey, generation: generation, open: open, month: month,
        list: list, listMonth: listMonth, listStatus: listStatus, listStale: listStale,
        detail: detail, detailId: detailId, detailStatus: detailStatus,
        excluded: excluded, excludedMonth: excludedMonth,
        people: people, labelsStatus: labelsStatus, labelsError: labelsError, error: error,
        mutation: mutation, panel: panel, notice: notice,
        drift: drift, driftId: driftId, driftStatus: driftStatus, commitIntent: commitIntent,
        suppList: suppList, suppListMonth: suppListMonth, suppListStatus: suppListStatus, suppListError: suppListError,
        elig: elig, eligMonth: eligMonth, eligStatus: eligStatus, eligError: eligError,
        suppDetail: suppDetail, suppDetailId: suppDetailId, suppDetailStatus: suppDetailStatus, suppIntent: suppIntent,
        fin: fin, finMonth: finMonth, finStatus: finStatus, finError: finError, postIntent: postIntent,
        exec: exec, execMonth: execMonth, execStatus: execStatus, execError: execError, execIntent: execIntent, payDraft: payDraft
      });
    }
  });
})();

const SessionPayroll = (function(){
  function paint(){ if(typeof render === 'function') render(); }

  // Sends one read under a fresh token and applies its answer only if it is still current.
  async function run(kind, arg, call){
    const token = SessionPayrollStore.begin(kind, arg);
    const out = await call();
    if(!SessionPayrollStore.isCurrent(token)) return;
    if(!out.ok && out.kind === API_RESULT_KINDS.UNAUTHENTICATED){
      AuthBoot.sessionLost();          // clears identity, CSRF and this store; renders SIGNED_OUT
      return;
    }
    let applied;
    if(!out.ok) applied = SessionPayrollStore.applyError(token, out);
    else if(kind === 'list') applied = SessionPayrollStore.applyList(token, out.data);
    else if(kind === 'detail') applied = SessionPayrollStore.applyDetail(token, out.data);
    else if(kind === 'drift') applied = SessionPayrollStore.applyDrift(token, out.data);
    else if(kind === 'suppList') applied = SessionPayrollStore.applySuppList(token, out.data);
    else if(kind === 'elig') applied = SessionPayrollStore.applyElig(token, out.data);
    else if(kind === 'suppDetail') applied = SessionPayrollStore.applySuppDetail(token, out.data);
    else if(kind === 'fin') applied = SessionPayrollStore.applyFin(token, out.data);          // AFI-4e
    else if(kind === 'exec') applied = SessionPayrollStore.applyExec(token, out.data);        // AFI-4f
    else applied = SessionPayrollStore.applyLabels(token, out.data);
    if(applied && kind === 'detail' && out.ok) afterDetail(out.data.plan);
    if(applied && kind === 'suppDetail' && out.ok) afterSuppDetail(out.data.doc);
    if(applied && (kind === 'fin' || kind === 'detail' || kind === 'suppDetail')) reconcilePosting();   // AFI-4e
    if(applied && (kind === 'fin' || kind === 'exec')) reconcileFinanceExecution();                       // AFI-4f
    if(applied) paint();
  }

  // AFI-4f: reconcile an open execution intent with what was read again — the month's postings and
  // executions. Recorded at the intent's amount, date and method: the success; the posting at the
  // same amount with no execution: kept (Retry recording); anything else: stale. Until both are
  // read for the intent's month, nothing.
  function reconcileFinanceExecution(){
    if(!sessionPayrollIsCeo(principalNow())) return;
    const s = SessionPayrollStore.snapshot();
    const i = s.execIntent;
    if(!i || s.mutation.status === SESSION_PAYROLL_MUTATION_STATUS.PENDING) return;
    const state = sessionFinanceExecutionIntentState(s, i);
    const mine = SESSION_FINANCE_EXECUTION_PANEL_KINDS.indexOf(s.mutation.kind) !== -1;
    if(state === 'recorded'){
      SessionPayrollStore.dropExecIntent();
      if(mine) SessionPayrollStore.resolveMutation('payRecordConfirmed');
    } else if(state === 'stale'){
      SessionPayrollStore.dropExecIntent();
      if(mine) SessionPayrollStore.resolveMutation('payRecordStale');
    }
  }

  // AFI-4e: reconcile an open posting intent with what was read again — its source and the month's
  // Finance postings. Posted at the intent's amount: the success; still Committed and unposted at
  // the same amount: kept (Retry posting); anything else: stale. Until both are known, nothing.
  function reconcilePosting(){
    if(!sessionPayrollIsCeo(principalNow())) return;
    const s = SessionPayrollStore.snapshot();
    const i = s.postIntent;
    if(!i || s.mutation.status === SESSION_PAYROLL_MUTATION_STATUS.PENDING) return;
    const source = sessionFinanceSource(s, i.sourceKind);
    const state = sessionFinanceIntentState(i, i.sourceKind, source, sessionFinanceStatus(s, i.sourceKind, source));
    const mine = SESSION_FINANCE_PANEL_KINDS.indexOf(s.mutation.kind) !== -1;
    if(state === 'posted'){
      SessionPayrollStore.dropPostIntent();
      if(mine) SessionPayrollStore.resolveMutation('finPostConfirmed');
    } else if(state === 'stale'){
      SessionPayrollStore.dropPostIntent();
      if(mine) SessionPayrollStore.resolveMutation('finPostStale');
    }
  }

  // AFI-4c2: a plan the CEO now sees — reconcile an open commit intent with it, and read its drift
  // when it is Ready (D-AFI4c2-2 = A: explanatory only; Commit is offered by status alone).
  function afterDetail(plan){
    const principal = principalNow();
    if(!sessionPayrollIsCeo(principal)) return;
    const s = SessionPayrollStore.snapshot();
    const state = s.mutation.status === SESSION_PAYROLL_MUTATION_STATUS.PENDING ? null : sessionPayrollIntentState(s.commitIntent, plan);
    if(state === 'committed'){
      SessionPayrollStore.dropIntent();
      SessionPayrollStore.resolveMutation('commitConfirmed');
      SessionPayrollStore.markListStale();
    } else if(state === 'stale'){
      SessionPayrollStore.dropIntent();
      if(s.mutation.kind === 'commit') SessionPayrollStore.resolveMutation('commitStale');
    }
    if(plan.status === 'Ready') loadDrift(plan.id);
  }

  // AFI-4d: a Supplemental document the CEO now sees — reconcile an open commit intent with it.
  function afterSuppDetail(doc){
    if(!sessionPayrollIsCeo(principalNow())) return;
    const s = SessionPayrollStore.snapshot();
    const state = s.mutation.status === SESSION_PAYROLL_MUTATION_STATUS.PENDING ? null : sessionSupplementalIntentState(s.suppIntent, doc);
    if(state === 'committed'){
      SessionPayrollStore.dropSuppIntent();
      SessionPayrollStore.resolveMutation('suppCommitConfirmed');
      SessionPayrollStore.markListStale();
    } else if(state === 'stale'){
      SessionPayrollStore.dropSuppIntent();
      if(s.mutation.kind === 'suppCommit') SessionPayrollStore.resolveMutation('suppCommitStale');
    }
  }

  function principalNow(){
    const a = AuthBoot.snapshot();
    return a.state === AUTH_STATES.AUTHENTICATED ? a.principal : null;
  }

  // AFI-4c2: an Employee reads only their own Committed plans; the CEO the company's. AFI-4d: and
  // the month's Supplemental documents (an Employee: their own Committed ones) and, for the CEO
  // only, the eligibility — three independent reads, each applied only while current.
  function loadMonth(key){
    const p = principalNow();
    const reads = [run('list', key, () => sessionPayrollIsEmployee(p) ? PayrollApi.myMonth(key, p.employeeId) : PayrollApi.month(key))];
    if(sessionPayrollIsEmployee(p)) reads.push(run('suppList', key, () => SupplementalApi.myMonth(key, p.employeeId)));
    else if(sessionPayrollIsCeo(p)){
      reads.push(run('suppList', key, () => SupplementalApi.month(key)));
      reads.push(run('elig', key, () => SupplementalApi.eligibility(key)));
      reads.push(loadFinance(key));                                   // AFI-4e
    }
    return Promise.all(reads);
  }
  // AFI-4e: the month's Finance postings — CEO only; an Employee never reads Finance. AFI-4f: and,
  // together with them, the month's executions (the payment status), wherever they are read.
  function loadFinance(key){
    if(!sessionPayrollIsCeo(principalNow()) || !OvertimeCalendar.isMonth(key)) return;
    return Promise.all([run('fin', key, () => FinancePostingApi.month(key)), loadFinanceExecutions(key)]);
  }
  // AFI-4f: the month's executions — CEO only; an Employee never reads an execution.
  function loadFinanceExecutions(key){
    if(!sessionPayrollIsCeo(principalNow()) || !OvertimeCalendar.isMonth(key)) return;
    return run('exec', key, () => FinanceExecutionApi.month(key));
  }
  // AFI-4d: one Supplemental document — an Employee: their own Committed one only.
  function loadSuppDetail(id){
    const p = principalNow();
    return run('suppDetail', id, () => sessionPayrollIsEmployee(p) ? SupplementalApi.myGet(id, p.employeeId) : SupplementalApi.get(id));
  }
  function loadDetail(id){
    const p = principalNow();
    return run('detail', id, () => sessionPayrollIsEmployee(p) ? PayrollApi.myGet(id, p.employeeId) : PayrollApi.get(id));
  }
  // AFI-4c2: CEO only.
  function loadDrift(id){
    if(!sessionPayrollIsCeo(principalNow())) return;
    return run('drift', id, () => PayrollApi.drift(id));
  }
  // D-AFI4c1-4 = A: the canonical CEO Employee list, archived records included, read-only.
  function loadLabels(){ return run('labels', null, () => EmployeeApi.list({ archived: true })); }

  /* ---------- writes ---------- */
  // Outcomes that cannot be known: the write may or may not have been applied. AFI-4c2: for a
  // commit a 500 is one too (the server may have committed before failing to answer).
  const AMBIGUOUS = Object.freeze([API_RESULT_KINDS.UNAVAILABLE, PAYROLL_API_INVALID]);
  const COMMIT_AMBIGUOUS = Object.freeze([API_RESULT_KINDS.UNAVAILABLE, PAYROLL_API_INVALID, API_RESULT_KINDS.SERVER_ERROR]);
  const NOTICES = Object.freeze({ review: 'reviewed', approve: 'approved', return: 'returned', cancel: 'cancelled', commit: 'committed' });
  const TRANSITION_CALLS = Object.freeze({
    review: (id, v) => PayrollApi.review(id, v),
    approve: (id, v) => PayrollApi.approve(id, v),
    return: (id, v) => PayrollApi.returnToDraft(id, v),
    cancel: (id, v) => PayrollApi.cancel(id, v)
  });

  function pending(){ return SessionPayrollStore.snapshot().mutation.status === SESSION_PAYROLL_MUTATION_STATUS.PENDING; }
  // The authenticated CEO, the section shown, no write in flight (every write).
  function canAct(){ return sessionPayrollIsCeo(principalNow()) && SessionPayrollStore.snapshot().open && !pending(); }
  // AFI-4c2: the CEO or a bound Employee, the section shown, no write in flight (navigation, reads).
  function canRead(){
    const p = principalNow();
    return (sessionPayrollIsCeo(p) || sessionPayrollIsEmployee(p)) && SessionPayrollStore.snapshot().open && !pending();
  }

  // Applies a write's outcome. Late (another identity) and superseded answers are dropped.
  function settle(token, out){
    if(out.recovery === 'unavailable'){ AuthBoot.sessionUncertain(); return; }   // identity already cleared: fail closed
    if(!SessionPayrollStore.isLive(token)) return;
    if(out.recovery === 'principal_changed'){ SessionPayrollStore.clear(); paint(); return; }
    if(out.recovery === 'signed_out' || (!out.ok && out.kind === API_RESULT_KINDS.UNAUTHENTICATED)){ AuthBoot.sessionLost(); return; }
    if(!SessionPayrollStore.isCurrent(token)) return;
    const s = SessionPayrollStore.snapshot();
    const kind = s.mutation.kind;
    const generate = kind === 'generate';
    if(kind === 'commit') return settleCommit(token, out, s);
    if(SESSION_SUPPLEMENTAL_PANEL_KINDS.indexOf(kind) !== -1) return settleSupplemental(token, out, s);   // AFI-4d
    if(SESSION_FINANCE_PANEL_KINDS.indexOf(kind) !== -1) return settleFinance(token, out, s);             // AFI-4e
    if(SESSION_FINANCE_EXECUTION_PANEL_KINDS.indexOf(kind) !== -1) return settleFinanceExecution(token, out, s); // AFI-4f
    if(out.ok){
      if(generate){
        const target = s.mutation.target;
        if(SessionPayrollStore.applyGenerated(token, target.month, out.data)){
          SessionPayrollStore.setFocus('message');
          loadMonth(target.month);
          if(out.data.excluded.length) loadLabels();
        }
      } else if(SessionPayrollStore.applyTransitioned(token, out.data, NOTICES[kind])){
        SessionPayrollStore.setFocus('message');
        loadDetail(out.data.id);
      }
      paint();
      return;
    }
    if(AMBIGUOUS.indexOf(out.kind) !== -1){
      // Never resent: read the server state again instead.
      SessionPayrollStore.failMutation(token, SESSION_PAYROLL_MUTATION_STATUS.AMBIGUOUS, out);
      SessionPayrollStore.markListStale();
      SessionPayrollStore.setFocus('message');
      if(generate) loadMonth(s.month);
      else if(s.detailId) loadDetail(s.detailId);
      paint();
      return;
    }
    SessionPayrollStore.failMutation(token, SESSION_PAYROLL_MUTATION_STATUS.ERROR, out);
    SessionPayrollStore.setFocus('message');
    if(out.kind === API_RESULT_KINDS.CONFLICT){
      // ANY 409: the confirmation is closed; the plan (or the month) is read again, and a new,
      // deliberate action is required. Nothing is sent again.
      SessionPayrollStore.markListStale();
      if(generate) loadMonth(s.month);
      else if(s.detailId) loadDetail(s.detailId);
    } else if(out.kind === API_RESULT_KINDS.NOT_FOUND && !generate){
      SessionPayrollStore.closeDetail();
      loadMonth(s.month);
    }
    paint();
  }

  // AFI-4c2: a commit's outcome. Success: the Committed plan; definite refusal (any 409, other
  // 4xx): the intent ends and the plan is read again (its drift too while Ready); unknown: the
  // intent stays and the plan is read again — that read decides (afterDetail). Never resent here.
  function settleCommit(token, out, s){
    const intent = s.commitIntent;
    if(out.ok){
      if(SessionPayrollStore.applyTransitioned(token, out.data, NOTICES.commit)){
        SessionPayrollStore.dropIntent();
        SessionPayrollStore.setFocus('message');
        loadDetail(out.data.id);
      }
      paint();
      return;
    }
    const id = intent ? intent.id : s.detailId;
    if(COMMIT_AMBIGUOUS.indexOf(out.kind) !== -1){
      SessionPayrollStore.failMutation(token, SESSION_PAYROLL_MUTATION_STATUS.AMBIGUOUS, out);
      SessionPayrollStore.markListStale();
      SessionPayrollStore.setFocus('message');
      if(id && id === s.detailId) loadDetail(id);
      paint();
      return;
    }
    SessionPayrollStore.failMutation(token, SESSION_PAYROLL_MUTATION_STATUS.ERROR, out);
    SessionPayrollStore.dropIntent();
    SessionPayrollStore.setFocus('message');
    SessionPayrollStore.markListStale();
    if(out.kind === API_RESULT_KINDS.NOT_FOUND){ SessionPayrollStore.closeDetail(); loadMonth(s.month); }
    else if(s.detailId) loadDetail(s.detailId);
    paint();
  }

  // AFI-4d: a Supplemental write's outcome — the Payroll rules: only a confirming answer changes the
  // data; ANY 409 closes the confirmation and reads the document (generate: the month) again; an
  // outcome that cannot be known re-reads the same way and is NEVER sent again. Commit: below.
  const SUPP_NOTICES = Object.freeze({ suppReview: 'suppReviewed', suppApprove: 'suppApproved', suppReturn: 'suppReturned', suppCancel: 'suppCancelled', suppCommit: 'suppCommitted' });
  function settleSupplemental(token, out, s){
    const kind = s.mutation.kind;
    if(kind === 'suppCommit') return settleSuppCommit(token, out, s);
    const generate = kind === 'suppGenerate';
    if(out.ok){
      if(generate){
        const target = s.mutation.target;
        if(SessionPayrollStore.applySuppGenerated(token, target.month, out.data)){
          SessionPayrollStore.setFocus('message');
          loadMonth(target.month);
        }
      } else if(SessionPayrollStore.applySuppTransitioned(token, out.data, SUPP_NOTICES[kind])){
        SessionPayrollStore.setFocus('message');
        loadSuppDetail(out.data.id);
      }
      paint();
      return;
    }
    if(AMBIGUOUS.indexOf(out.kind) !== -1){
      SessionPayrollStore.failMutation(token, SESSION_PAYROLL_MUTATION_STATUS.AMBIGUOUS, out);
      SessionPayrollStore.markListStale();
      SessionPayrollStore.setFocus('message');
      if(generate) loadMonth(s.month);
      else if(s.suppDetailId) loadSuppDetail(s.suppDetailId);
      paint();
      return;
    }
    SessionPayrollStore.failMutation(token, SESSION_PAYROLL_MUTATION_STATUS.ERROR, out);
    SessionPayrollStore.setFocus('message');
    if(out.kind === API_RESULT_KINDS.CONFLICT || (out.kind === API_RESULT_KINDS.NOT_FOUND && generate)){
      SessionPayrollStore.markListStale();
      if(generate) loadMonth(s.month);
      else if(s.suppDetailId) loadSuppDetail(s.suppDetailId);
    } else if(out.kind === API_RESULT_KINDS.NOT_FOUND){
      SessionPayrollStore.closeSuppDetail();
      SessionPayrollStore.markListStale();
      loadMonth(s.month);
    }
    paint();
  }

  // AFI-4d: a Supplemental commit's outcome — exactly the AFI-4c2 rules over suppIntent.
  function settleSuppCommit(token, out, s){
    const intent = s.suppIntent;
    if(out.ok){
      if(SessionPayrollStore.applySuppTransitioned(token, out.data, SUPP_NOTICES.suppCommit)){
        SessionPayrollStore.dropSuppIntent();
        SessionPayrollStore.setFocus('message');
        loadSuppDetail(out.data.id);
      }
      paint();
      return;
    }
    const id = intent ? intent.id : s.suppDetailId;
    if(COMMIT_AMBIGUOUS.indexOf(out.kind) !== -1){
      SessionPayrollStore.failMutation(token, SESSION_PAYROLL_MUTATION_STATUS.AMBIGUOUS, out);
      SessionPayrollStore.markListStale();
      SessionPayrollStore.setFocus('message');
      if(id && id === s.suppDetailId) loadSuppDetail(id);
      paint();
      return;
    }
    SessionPayrollStore.failMutation(token, SESSION_PAYROLL_MUTATION_STATUS.ERROR, out);
    SessionPayrollStore.dropSuppIntent();
    SessionPayrollStore.setFocus('message');
    SessionPayrollStore.markListStale();
    if(out.kind === API_RESULT_KINDS.NOT_FOUND){ SessionPayrollStore.closeSuppDetail(); loadMonth(s.month); }
    else if(s.suppDetailId) loadSuppDetail(s.suppDetailId);
    paint();
  }

  // AFI-4d: sends the Supplemental commit intent once.
  async function sendSuppCommit(intent, retry){
    const token = SessionPayrollStore.beginMutation('suppCommit', { id: intent.id, version: intent.version, retry: retry === true });
    paint();
    return settle(token, await SupplementalApi.commit(intent));
  }
  const SUPP_TRANSITION_CALLS = Object.freeze({
    review: (id, v) => SupplementalApi.review(id, v),
    approve: (id, v) => SupplementalApi.approve(id, v),
    return: (id, v) => SupplementalApi.returnToDraft(id, v),
    cancel: (id, v) => SupplementalApi.cancel(id, v)
  });
  // AFI-4d: opens a Supplemental confirmation — generate on an eligibility entry of the month shown
  // (not for a "0.00" amount: UX only, the server decides), the others on the document shown, as
  // the matrix offers. Nothing is sent.
  function openSupplementalPanel(kind, planId){
    const s = SessionPayrollStore.snapshot();
    if(s.panel) return;
    if(kind === 'suppGenerate'){
      if(s.detailId || s.suppDetailId || s.eligStatus !== SESSION_PAYROLL_STATUS.READY || s.eligMonth !== s.month) return;
      const e = (s.elig || []).filter((x) => x.payrollPlanId === planId)[0];
      if(!e || e.eligibleAmount === '0.00') return;
      SessionPayrollStore.openPanel('suppGenerate', planId);
    } else {
      const d = s.suppDetail;
      if(s.suppDetailStatus !== SESSION_PAYROLL_STATUS.READY || !d || d.doc.id !== s.suppDetailId) return;
      if(sessionSupplementalActions(principalNow(), d.doc).indexOf(SESSION_SUPPLEMENTAL_OPERATION[kind]) === -1) return;
      if(kind === 'suppCommit' && s.suppIntent) return;       // an unresolved intent: Retry commit, never a second intent
      SessionPayrollStore.openPanel(kind, d.doc.id);
    }
    SessionPayrollStore.setFocus('panel');
    paint();
  }
  // AFI-4d: sends the open Supplemental action once — generate { payrollPlanId } for the entry it was
  // opened on; a transition for the document shown, at the version now held; commit: ONE intent.
  async function confirmSupplemental(s, a){
    if(a.kind === 'suppGenerate'){
      const e = s.eligMonth === s.month ? (s.elig || []).filter((x) => x.payrollPlanId === a.id)[0] : null;
      if(s.detailId || s.suppDetailId || !e || !OvertimeCalendar.isMonth(s.month)){ SessionPayrollStore.closePanel(); paint(); return; }
      const forMonth = s.month;
      const token = SessionPayrollStore.beginMutation('suppGenerate', { month: forMonth });
      paint();
      return settle(token, await SupplementalApi.generate(a.id, forMonth));
    }
    const d = s.suppDetail;
    if(s.suppDetailStatus !== SESSION_PAYROLL_STATUS.READY || !d || d.doc.id !== a.id) return;
    const op = SESSION_SUPPLEMENTAL_OPERATION[a.kind];
    if(sessionSupplementalActions(principalNow(), d.doc).indexOf(op) === -1){ SessionPayrollStore.closePanel(); paint(); return; }
    if(op === 'commit'){
      if(s.suppIntent){ SessionPayrollStore.closePanel(); paint(); return; }
      const key = payrollIdempotencyKey();
      if(key === null){
        const token = SessionPayrollStore.beginMutation('suppCommit', { id: d.doc.id, version: d.doc.version, retry: false });
        SessionPayrollStore.failMutation(token, SESSION_PAYROLL_MUTATION_STATUS.ERROR, { kind: 'CRYPTO_UNAVAILABLE' });
        SessionPayrollStore.setFocus('message');
        paint();
        return;
      }
      SessionPayrollStore.setSuppIntent({ id: d.doc.id, version: d.doc.version, total: d.doc.overtimeAmount, key: key });
      return sendSuppCommit(SessionPayrollStore.snapshot().suppIntent, false);
    }
    const token = SessionPayrollStore.beginMutation(a.kind, { id: d.doc.id, version: d.doc.version });
    paint();
    return settle(token, await SUPP_TRANSITION_CALLS[op](d.doc.id, d.doc.version));
  }

  // AFI-4e: a posting's outcome. Success: the confirming Planned posting — the intent ends and the
  // month's postings are read again; definite refusal (any 409, other 4xx): the intent ends and the
  // source and the postings are read again (a 404: the month); unknown: the intent stays and both
  // are read again — those reads decide (reconcilePosting). Never resent here.
  function settleFinance(token, out, s){
    const intent = s.postIntent;
    const reread = function(){
      if(intent && intent.sourceKind === 'payrollPlan' && s.detailId === intent.sourceId) loadDetail(intent.sourceId);
      else if(intent && intent.sourceKind === 'supplementalPayroll' && s.suppDetailId === intent.sourceId) loadSuppDetail(intent.sourceId);
      loadFinance(s.month);
    };
    if(out.ok){
      if(SessionPayrollStore.applyPosted(token)){
        SessionPayrollStore.dropPostIntent();
        SessionPayrollStore.setFocus('message');
        loadFinance(s.month);
      }
      paint();
      return;
    }
    if(COMMIT_AMBIGUOUS.indexOf(out.kind) !== -1){
      SessionPayrollStore.failMutation(token, SESSION_PAYROLL_MUTATION_STATUS.AMBIGUOUS, out);
      SessionPayrollStore.setFocus('message');
      reread();
      paint();
      return;
    }
    SessionPayrollStore.failMutation(token, SESSION_PAYROLL_MUTATION_STATUS.ERROR, out);
    SessionPayrollStore.dropPostIntent();
    SessionPayrollStore.setFocus('message');
    if(out.kind === API_RESULT_KINDS.NOT_FOUND){
      SessionPayrollStore.closeDetail(); SessionPayrollStore.closeSuppDetail();
      SessionPayrollStore.markListStale();
      loadMonth(s.month);
    } else reread();
    paint();
  }
  // AFI-4e: sends the posting intent once.
  async function sendPost(intent, retry){
    const kind = intent.sourceKind === 'payrollPlan' ? 'finPostPlan' : 'finPostSupp';
    const token = SessionPayrollStore.beginMutation(kind, { sourceKind: intent.sourceKind, sourceId: intent.sourceId, retry: retry === true });
    paint();
    return settle(token, await FinancePostingApi.post(intent));
  }
  // AFI-4e: opens the posting confirmation of the source shown — only Committed, unposted by the
  // month's Finance read, and with no other posting intent unresolved. Nothing is sent.
  function openFinancePanel(kind){
    const s = SessionPayrollStore.snapshot();
    if(s.panel || s.postIntent) return;
    const sourceKind = SESSION_FINANCE_SOURCE_KIND[kind];
    const source = sessionFinanceSource(s, sourceKind);
    const status = sessionFinanceStatus(s, sourceKind, source);
    if(!status || status.state !== 'unposted') return;
    SessionPayrollStore.openPanel(kind, source.id);
    SessionPayrollStore.setFocus('panel');
    paint();
  }
  // AFI-4e: ONE posting intent per deliberate confirmation — the source's own amount string and
  // one Web Crypto key. Without Web Crypto nothing is sent.
  async function confirmFinance(s, a){
    const sourceKind = SESSION_FINANCE_SOURCE_KIND[a.kind];
    const source = sessionFinanceSource(s, sourceKind);
    const status = sessionFinanceStatus(s, sourceKind, source);
    if(!source || source.id !== a.id || s.postIntent || !status || status.state !== 'unposted'){ SessionPayrollStore.closePanel(); paint(); return; }
    const intent = financePostingIntent(sourceKind, source);
    if(intent === null){
      const token = SessionPayrollStore.beginMutation(a.kind, { sourceKind: sourceKind, sourceId: source.id, retry: false });
      SessionPayrollStore.failMutation(token, SESSION_PAYROLL_MUTATION_STATUS.ERROR, { kind: 'CRYPTO_UNAVAILABLE' });
      SessionPayrollStore.setFocus('message');
      paint();
      return;
    }
    SessionPayrollStore.setPostIntent(intent);
    return sendPost(SessionPayrollStore.snapshot().postIntent, false);
  }

  // AFI-4f: an execution's outcome. Success: the confirming execution — the intent ends and the
  // Finance status is read again; definite refusal (any 409, other 4xx): the intent ends and the
  // Finance status is read again (a 404: the month); unknown: the intent stays and the Finance
  // status is read again — those reads decide (reconcileFinanceExecution). Never resent here.
  function settleFinanceExecution(token, out, s){
    if(out.ok){
      if(SessionPayrollStore.applyFinanceExecutionRecorded(token)){
        SessionPayrollStore.dropExecIntent();
        SessionPayrollStore.setFocus('message');
        loadFinance(s.month);
      }
      paint();
      return;
    }
    if(COMMIT_AMBIGUOUS.indexOf(out.kind) !== -1){
      SessionPayrollStore.failMutation(token, SESSION_PAYROLL_MUTATION_STATUS.AMBIGUOUS, out);
      SessionPayrollStore.setFocus('message');
      loadFinance(s.month);
      paint();
      return;
    }
    SessionPayrollStore.failMutation(token, SESSION_PAYROLL_MUTATION_STATUS.ERROR, out);
    SessionPayrollStore.dropExecIntent();
    SessionPayrollStore.setFocus('message');
    if(out.kind === API_RESULT_KINDS.NOT_FOUND){
      SessionPayrollStore.closeDetail(); SessionPayrollStore.closeSuppDetail();
      SessionPayrollStore.markListStale();
      loadMonth(s.month);
    } else loadFinance(s.month);
    paint();
  }
  // AFI-4f: sends the execution intent once.
  async function sendRecord(intent, sourceKind, retry){
    const kind = sourceKind === 'payrollPlan' ? 'finRecordPlan' : 'finRecordSupp';
    const token = SessionPayrollStore.beginMutation(kind, { financePostingId: intent.financePostingId, retry: retry === true });
    paint();
    return settle(token, await FinanceExecutionApi.record(intent));
  }
  // AFI-4f: opens the Record payment form of the source shown — only when its posting is read,
  // consistent and has no execution, and no posting or execution intent is unresolved. Nothing is
  // sent; the form starts empty (no date, no method).
  function openFinanceExecutionPanel(kind){
    const s = SessionPayrollStore.snapshot();
    if(s.panel || s.postIntent || s.execIntent) return;
    const sourceKind = SESSION_FINANCE_EXECUTION_SOURCE_KIND[kind];
    const source = sessionFinanceSource(s, sourceKind);
    const status = sessionFinanceExecutionStatus(s, sourceKind, source);
    if(!status || status.state !== 'unrecorded') return;
    SessionPayrollStore.openPanel(kind, source.id);
    SessionPayrollStore.resetPayDraft();
    SessionPayrollStore.setFocus('panel');
    paint();
  }
  // AFI-4f: ONE execution intent per deliberate confirmation — the posting's own amount string, the
  // date and method entered, one Web Crypto key, frozen before anything is sent. A missing or
  // invalid field sends nothing and keeps the form; without Web Crypto nothing is sent.
  async function confirmFinanceExecution(s, a){
    const sourceKind = SESSION_FINANCE_EXECUTION_SOURCE_KIND[a.kind];
    const source = sessionFinanceSource(s, sourceKind);
    const status = sessionFinanceExecutionStatus(s, sourceKind, source);
    if(!source || source.id !== a.id || s.postIntent || s.execIntent || !status || status.state !== 'unrecorded'){ SessionPayrollStore.closePanel(); paint(); return; }
    const d = s.payDraft;
    const missing = [];
    if(!financeExecutionIsDate(d.executedOn)) missing.push('executedOn');
    if(!financeExecutionIsMethod(d.paymentMethod)) missing.push('paymentMethod');
    if(missing.length){
      SessionPayrollStore.setPayDraftMissing(missing);
      SessionPayrollStore.setFocus('field:' + missing[0]);
      paint();
      return;
    }
    const intent = financeExecutionIntent(status.posting, d.executedOn, d.paymentMethod);
    if(intent === null){
      const token = SessionPayrollStore.beginMutation(a.kind, { financePostingId: status.posting.id, retry: false });
      SessionPayrollStore.failMutation(token, SESSION_PAYROLL_MUTATION_STATUS.ERROR, { kind: 'CRYPTO_UNAVAILABLE' });
      SessionPayrollStore.setFocus('message');
      paint();
      return;
    }
    SessionPayrollStore.setExecIntent(intent);
    return sendRecord(SessionPayrollStore.snapshot().execIntent, sourceKind, false);
  }

  // AFI-4c2: sends the commit intent once. A missing Web Crypto key sends nothing.
  async function sendCommit(intent, retry){
    const token = SessionPayrollStore.beginMutation('commit', { id: intent.id, version: intent.version, retry: retry === true });
    paint();
    return settle(token, await PayrollApi.commit(intent));
  }

  // The month field and Previous / Next: another month's plans, read from the server.
  function setMonth(key){
    const s = SessionPayrollStore.snapshot();
    if(!canRead() || s.detailId || s.suppDetailId || s.panel || !OvertimeCalendar.isMonth(key) || key === s.month) return;
    SessionPayrollStore.resetMutation();
    SessionPayrollStore.setMonth(key);
    const loading = loadMonth(key);
    paint();
    return loading;
  }

  return Object.freeze({
    // Called on every render of the authenticated workspace: binds the data to the principal
    // (a different one destroys it) and, while the section is shown to the CEO, starts the reads
    // it needs. Any other principal: nothing is read.
    ensureLoaded(principal){
      if(!principal) return;
      SessionPayrollStore.bindPrincipal(principal);
      const s = SessionPayrollStore.snapshot();
      if(!s.open || !(sessionPayrollIsCeo(principal) || sessionPayrollIsEmployee(principal))) return;
      if(s.listStatus === SESSION_PAYROLL_STATUS.IDLE || (s.listStale && !s.detailId && !s.suppDetailId && s.listStatus !== SESSION_PAYROLL_STATUS.LOADING)) loadMonth(s.month);
    },
    // The section switch of the workspace view: the CEO's Payroll, an Employee's My payroll
    // (AFI-4c2). Nothing changes while a write is in flight.
    show(value){
      if(pending()) return;
      const p = principalNow();
      if(value === true && !sessionPayrollIsCeo(p) && !sessionPayrollIsEmployee(p)) return;
      SessionPayrollStore.setOpen(value === true, sessionPayrollCurrentMonth());
      if(value === true) SessionPayrollStore.setFocus('section');
      paint();
    },
    // Previous / Next (delta -1 / +1) and the month field ("YYYY-MM").
    shiftMonth(delta){
      const s = SessionPayrollStore.snapshot();
      if(!canRead() || s.detailId || s.suppDetailId || s.panel || (delta !== 1 && delta !== -1)) return;
      return setMonth(OvertimeCalendar.shift(s.month, delta));
    },
    setMonth: setMonth,
    openDetail(id){
      if(!canRead() || typeof id !== 'string') return;
      const s = SessionPayrollStore.snapshot();
      if(s.panel) return;
      if(s.detailId === id && s.detailStatus === SESSION_PAYROLL_STATUS.LOADING) return;
      SessionPayrollStore.resetMutation();
      const loading = Promise.all([loadDetail(id), loadFinance(s.month)]);      // AFI-4e: the Finance status again (CEO)
      paint();
      return loading;
    },
    // AFI-4d: a Supplemental document of the month (CEO), or an own Committed one (Employee). A plan
    // detail gives way: one detail at a time.
    openSupplemental(id){
      if(!canRead() || typeof id !== 'string') return;
      const s = SessionPayrollStore.snapshot();
      if(s.panel) return;
      if(s.suppDetailId === id && s.suppDetailStatus === SESSION_PAYROLL_STATUS.LOADING) return;
      SessionPayrollStore.closeDetail();
      SessionPayrollStore.resetMutation();
      const loading = Promise.all([loadSuppDetail(id), loadFinance(s.month)]); // AFI-4e: the Finance status again (CEO)
      paint();
      return loading;
    },
    back(){
      if(pending()) return;
      SessionPayrollStore.closeDetail();
      SessionPayrollStore.closeSuppDetail();             // AFI-4d
      SessionPayrollStore.resetMutation();
      paint();
    },
    retry(){
      const s = SessionPayrollStore.snapshot();
      if(!canRead()) return;
      let loading;
      if(s.error && s.error.scope === 'list') loading = loadMonth(s.month);
      else if(s.error && s.error.scope === 'detail' && s.detailId) loading = loadDetail(s.detailId);
      else if(s.error && s.error.scope === 'suppDetail' && s.suppDetailId) loading = loadSuppDetail(s.suppDetailId);   // AFI-4d
      paint();
      return loading;
    },
    // AFI-4d: the month's Supplemental reads again after one of them failed.
    retrySupplemental(){
      const s = SessionPayrollStore.snapshot();
      if(!canRead() || s.detailId || s.suppDetailId) return;
      const p = principalNow();
      const reads = [];
      if(s.suppListStatus === SESSION_PAYROLL_STATUS.ERROR) reads.push(run('suppList', s.month, () => sessionPayrollIsEmployee(p) ? SupplementalApi.myMonth(s.month, p.employeeId) : SupplementalApi.month(s.month)));
      if(sessionPayrollIsCeo(p) && s.eligStatus === SESSION_PAYROLL_STATUS.ERROR) reads.push(run('elig', s.month, () => SupplementalApi.eligibility(s.month)));
      if(!reads.length) return;
      paint();
      return Promise.all(reads);
    },
    // AFI-4d: after a conflict (or to check an unconfirmed write): the document again.
    reloadSupplemental(){
      if(!canAct()) return;
      const s = SessionPayrollStore.snapshot();
      if(!s.suppDetailId) return;
      if(s.panel) SessionPayrollStore.closePanel();
      SessionPayrollStore.resetMutation();
      const loading = Promise.all([loadSuppDetail(s.suppDetailId), loadFinance(s.month)]);   // AFI-4e
      paint();
      return loading;
    },
    retryLabels(){
      const s = SessionPayrollStore.snapshot();
      if(!canAct() || s.labelsStatus !== SESSION_PAYROLL_STATUS.ERROR || !s.excluded || !s.excluded.length) return;
      const loading = loadLabels();
      paint();
      return loading;
    },
    // After a conflict (or to check an unconfirmed write): the plan again, from the server.
    reloadPlan(){
      if(!canAct()) return;
      const s = SessionPayrollStore.snapshot();
      if(!s.detailId) return;
      if(s.panel) SessionPayrollStore.closePanel();
      SessionPayrollStore.resetMutation();
      const loading = Promise.all([loadDetail(s.detailId), loadFinance(s.month)]);            // AFI-4e
      paint();
      return loading;
    },
    // Every write asks first: this only opens the confirmation; nothing is sent. Generate is a
    // list action; the transitions act on the plan shown, as the matrix offers.
    openPanel(kind, planId){
      if(!canAct()) return;
      if(SESSION_SUPPLEMENTAL_PANEL_KINDS.indexOf(kind) !== -1) return openSupplementalPanel(kind, planId);   // AFI-4d
      if(SESSION_FINANCE_PANEL_KINDS.indexOf(kind) !== -1) return openFinancePanel(kind);                     // AFI-4e
      if(SESSION_FINANCE_EXECUTION_PANEL_KINDS.indexOf(kind) !== -1) return openFinanceExecutionPanel(kind);         // AFI-4f
      if(SESSION_PAYROLL_PANEL_KINDS.indexOf(kind) === -1) return;
      const s = SessionPayrollStore.snapshot();
      if(s.panel) return;
      if(kind === 'generate'){
        if(s.detailId || !OvertimeCalendar.isMonth(s.month)) return;
        SessionPayrollStore.openPanel('generate', null);
      } else {
        const d = s.detail;
        if(s.detailStatus !== SESSION_PAYROLL_STATUS.READY || !d || d.plan.id !== s.detailId) return;
        if(sessionPayrollActions(principalNow(), d.plan).indexOf(kind) === -1) return;
        if(kind === 'commit' && s.commitIntent) return;     // an unresolved intent: Retry commit, never a second intent
        SessionPayrollStore.openPanel(kind, d.plan.id);
      }
      SessionPayrollStore.setFocus('panel');
      paint();
    },
    cancelPanel(){
      if(!canAct() || !SessionPayrollStore.snapshot().panel) return;
      SessionPayrollStore.closePanel();
      paint();
    },
    // Sends the open action once — generate for the month shown; a transition for the plan it was
    // opened on, at the version now held, only if the matrix still offers it.
    async confirmPanel(){
      if(!canAct()) return;
      const s = SessionPayrollStore.snapshot();
      const a = s.panel;
      if(!a) return;
      if(SESSION_SUPPLEMENTAL_PANEL_KINDS.indexOf(a.kind) !== -1) return confirmSupplemental(s, a);         // AFI-4d
      if(SESSION_FINANCE_PANEL_KINDS.indexOf(a.kind) !== -1) return confirmFinance(s, a);                   // AFI-4e
      if(SESSION_FINANCE_EXECUTION_PANEL_KINDS.indexOf(a.kind) !== -1) return confirmFinanceExecution(s, a);       // AFI-4f
      if(a.kind === 'generate'){
        if(s.detailId || !OvertimeCalendar.isMonth(s.month)){ SessionPayrollStore.closePanel(); paint(); return; }
        const forMonth = s.month;
        const token = SessionPayrollStore.beginMutation('generate', { month: forMonth });
        paint();
        return settle(token, await PayrollApi.generate(forMonth));
      }
      const d = s.detail;
      if(s.detailStatus !== SESSION_PAYROLL_STATUS.READY || !d || d.plan.id !== a.id) return;
      if(sessionPayrollActions(principalNow(), d.plan).indexOf(a.kind) === -1){ SessionPayrollStore.closePanel(); paint(); return; }
      if(a.kind === 'commit'){
        // AFI-4c2: ONE intent per deliberate confirmation — the plan's own totalAmount string and
        // one Web Crypto key. Without Web Crypto nothing is sent.
        if(s.commitIntent){ SessionPayrollStore.closePanel(); paint(); return; }
        const key = payrollIdempotencyKey();
        if(key === null){
          const token = SessionPayrollStore.beginMutation('commit', { id: d.plan.id, version: d.plan.version, retry: false });
          SessionPayrollStore.failMutation(token, SESSION_PAYROLL_MUTATION_STATUS.ERROR, { kind: 'CRYPTO_UNAVAILABLE' });
          SessionPayrollStore.setFocus('message');
          paint();
          return;
        }
        SessionPayrollStore.setIntent({ id: d.plan.id, version: d.plan.version, total: d.plan.totalAmount, key: key });
        return sendCommit(SessionPayrollStore.snapshot().commitIntent, false);
      }
      const token = SessionPayrollStore.beginMutation(a.kind, { id: d.plan.id, version: d.plan.version });
      paint();
      return settle(token, await TRANSITION_CALLS[a.kind](d.plan.id, d.plan.version));
    },
    // AFI-4c2 (D-AFI4c2-1 = A): after an unknown outcome whose re-read still shows the plan Ready
    // at the same version and total, a deliberate click sends the SAME intent — the same body and
    // key — again. Never automatic; never a new key.
    retryCommit(){
      if(!canAct()) return;
      const s = SessionPayrollStore.snapshot();
      const d = s.detail;
      if(s.panel || s.detailStatus !== SESSION_PAYROLL_STATUS.READY || !d || d.plan.id !== s.detailId) return;
      if(sessionPayrollIntentState(s.commitIntent, d.plan) !== 'unresolved') return;
      return sendCommit(s.commitIntent, true);
    },
    // AFI-4d: the same, for an unresolved Supplemental commit — the SAME intent, body and key, on a
    // deliberate click only.
    retrySupplementalCommit(){
      if(!canAct()) return;
      const s = SessionPayrollStore.snapshot();
      const d = s.suppDetail;
      if(s.panel || s.suppDetailStatus !== SESSION_PAYROLL_STATUS.READY || !d || d.doc.id !== s.suppDetailId) return;
      if(sessionSupplementalIntentState(s.suppIntent, d.doc) !== 'unresolved') return;
      return sendSuppCommit(s.suppIntent, true);
    },
    // AFI-4e (D-AFI4e-3 = A): after an unknown outcome whose reads still show the source Committed
    // and unposted at the same amount, a deliberate click sends the SAME intent — the same body and
    // key — again. Never automatic; never a new key.
    retryPosting(){
      if(!canAct()) return;
      const s = SessionPayrollStore.snapshot();
      const i = s.postIntent;
      if(s.panel || !i) return;
      const source = sessionFinanceSource(s, i.sourceKind);
      if(sessionFinanceIntentState(i, i.sourceKind, source, sessionFinanceStatus(s, i.sourceKind, source)) !== 'unresolved') return;
      return sendPost(i, true);
    },
    // AFI-4e: the month's Finance postings again after their read failed (CEO).
    retryFinance(){
      if(!canAct()) return;
      const s = SessionPayrollStore.snapshot();
      if(s.finStatus !== SESSION_PAYROLL_STATUS.ERROR) return;
      const loading = loadFinance(s.month);
      paint();
      return loading;
    },
    // AFI-4f: the open Record payment form follows its fields as they change (no render: focus and
    // the value typed stay); Record payment reads the values held here.
    setPayDraft(name, value){
      if(!canAct()) return;
      const s = SessionPayrollStore.snapshot();
      if(!s.panel || SESSION_FINANCE_EXECUTION_PANEL_KINDS.indexOf(s.panel.kind) === -1) return;
      SessionPayrollStore.setPayDraft(name, value);
    },
    // AFI-4f (D-AFI4f-5 = A): after an unknown outcome whose reads still show the posting at the same
    // amount with no execution, a deliberate click on the source's own detail sends the SAME intent —
    // the same body and key — again. Never automatic; never a new key.
    retryRecording(){
      if(!canAct()) return;
      const s = SessionPayrollStore.snapshot();
      const i = s.execIntent;
      if(s.panel || !i || sessionFinanceExecutionIntentState(s, i) !== 'unresolved') return;
      const shown = ['payrollPlan', 'supplementalPayroll'].filter((k) => {
        const st = sessionFinanceExecutionStatus(s, k, sessionFinanceSource(s, k));
        return !!st && st.state === 'unrecorded' && st.posting.id === i.financePostingId;
      });
      if(shown.length !== 1) return;
      return sendRecord(i, shown[0], true);
    },
    // AFI-4f: the month's executions again after their read failed (CEO).
    retryFinanceExecutionStatus(){
      if(!canAct()) return;
      const s = SessionPayrollStore.snapshot();
      if(s.execStatus !== SESSION_PAYROLL_STATUS.ERROR) return;
      const loading = loadFinanceExecutions(s.month);
      paint();
      return loading;
    }
  });
})();
