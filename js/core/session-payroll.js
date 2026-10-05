/* ============================================================
   SESSION PAYROLL DATA (AFI-4c1, AFI-4c2) — js/core/session-payroll.js
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

  function keyOf(p){
    return p ? [p.id, p.principalType, p.employeeId || ''].join('|') : null;
  }
  function seqOf(kind){
    return kind === 'list' ? listSeq : kind === 'detail' ? detailSeq : kind === 'labels' ? labelsSeq : kind === 'mutation' ? mutationSeq : kind === 'drift' ? driftSeq : -1;
  }
  function isLive(token){ return !!token && token.gen === generation; }
  function isCurrent(token){
    return isLive(token) && token.seq === seqOf(token.kind);
  }
  function forgetDrift(){ driftSeq++; drift = null; driftId = null; driftStatus = SESSION_PAYROLL_STATUS.IDLE; }
  function clear(){
    forgetDrift(); commitIntent = null;
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
    applyError(token, failed){
      if(!isCurrent(token)) return false;
      if(token.kind === 'drift'){ drift = null; driftStatus = SESSION_PAYROLL_STATUS.ERROR; return true; }
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
      if(panel && panel.kind !== 'generate') panel = null;
    },

    /* ---------- writes ---------- */
    openPanel(kind, id){
      mutationSeq++; mutation = SESSION_PAYROLL_MUTATION_IDLE; notice = null;
      panel = Object.freeze({ kind: kind, id: id });
    },
    closePanel(){ mutationSeq++; mutation = SESSION_PAYROLL_MUTATION_IDLE; panel = null; },
    resetMutation(){ mutation = SESSION_PAYROLL_MUTATION_IDLE; notice = null; },
    beginMutation(kind, target){
      if(SESSION_PAYROLL_PANEL_KINDS.indexOf(kind) === -1) throw new Error('unknown session payroll mutation kind');
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
        drift: drift, driftId: driftId, driftStatus: driftStatus, commitIntent: commitIntent
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
    else applied = SessionPayrollStore.applyLabels(token, out.data);
    if(applied && kind === 'detail' && out.ok) afterDetail(out.data.plan);
    if(applied) paint();
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

  function principalNow(){
    const a = AuthBoot.snapshot();
    return a.state === AUTH_STATES.AUTHENTICATED ? a.principal : null;
  }

  // AFI-4c2: an Employee reads only their own Committed plans; the CEO the company's.
  function loadMonth(key){
    const p = principalNow();
    return run('list', key, () => sessionPayrollIsEmployee(p) ? PayrollApi.myMonth(key, p.employeeId) : PayrollApi.month(key));
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

  // AFI-4c2: sends the commit intent once. A missing Web Crypto key sends nothing.
  async function sendCommit(intent, retry){
    const token = SessionPayrollStore.beginMutation('commit', { id: intent.id, version: intent.version, retry: retry === true });
    paint();
    return settle(token, await PayrollApi.commit(intent));
  }

  // The month field and Previous / Next: another month's plans, read from the server.
  function setMonth(key){
    const s = SessionPayrollStore.snapshot();
    if(!canRead() || s.detailId || s.panel || !OvertimeCalendar.isMonth(key) || key === s.month) return;
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
      if(s.listStatus === SESSION_PAYROLL_STATUS.IDLE || (s.listStale && !s.detailId && s.listStatus !== SESSION_PAYROLL_STATUS.LOADING)) loadMonth(s.month);
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
      if(!canRead() || s.detailId || s.panel || (delta !== 1 && delta !== -1)) return;
      return setMonth(OvertimeCalendar.shift(s.month, delta));
    },
    setMonth: setMonth,
    openDetail(id){
      if(!canRead() || typeof id !== 'string') return;
      const s = SessionPayrollStore.snapshot();
      if(s.panel) return;
      if(s.detailId === id && s.detailStatus === SESSION_PAYROLL_STATUS.LOADING) return;
      SessionPayrollStore.resetMutation();
      const loading = loadDetail(id);
      paint();
      return loading;
    },
    back(){
      if(pending()) return;
      SessionPayrollStore.closeDetail();
      SessionPayrollStore.resetMutation();
      paint();
    },
    retry(){
      const s = SessionPayrollStore.snapshot();
      if(!canRead()) return;
      let loading;
      if(s.error && s.error.scope === 'list') loading = loadMonth(s.month);
      else if(s.error && s.error.scope === 'detail' && s.detailId) loading = loadDetail(s.detailId);
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
      const loading = loadDetail(s.detailId);
      paint();
      return loading;
    },
    // Every write asks first: this only opens the confirmation; nothing is sent. Generate is a
    // list action; the transitions act on the plan shown, as the matrix offers.
    openPanel(kind){
      if(!canAct() || SESSION_PAYROLL_PANEL_KINDS.indexOf(kind) === -1) return;
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
    }
  });
})();
