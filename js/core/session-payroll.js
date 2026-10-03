/* ============================================================
   SESSION PAYROLL DATA (AFI-4c1) — js/core/session-payroll.js
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

   Classic shared global scope; top-level `const` bindings, not on window.
   ============================================================ */

const SESSION_PAYROLL_STATUS = Object.freeze({ IDLE: 'idle', LOADING: 'loading', READY: 'ready', ERROR: 'error' });
const SESSION_PAYROLL_MUTATION_STATUS = Object.freeze({ IDLE: 'idle', PENDING: 'pending', ERROR: 'error', AMBIGUOUS: 'ambiguous' });
const SESSION_PAYROLL_PANEL_KINDS = Object.freeze(['generate', 'review', 'approve', 'return', 'cancel']);
const SESSION_PAYROLL_MUTATION_IDLE = Object.freeze({ kind: null, status: SESSION_PAYROLL_MUTATION_STATUS.IDLE, error: null, fields: null, target: null });

// The control matrix of a plan (BF-4c1 PayrollStatus::TRANSITIONS) — UX only; the server decides
// every write again. CEO only. Committed (BF-4c2) and Cancelled offer nothing.
const SESSION_PAYROLL_ACTIONS = Object.freeze({
  Draft: Object.freeze(['review', 'approve', 'cancel']),
  Reviewed: Object.freeze(['approve', 'return', 'cancel']),
  Ready: Object.freeze(['return', 'cancel'])
});
const SESSION_PAYROLL_NONE = Object.freeze([]);
function sessionPayrollIsCeo(principal){ return !!principal && principal.principalType === PRINCIPAL_TYPES.CEO; }
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

  function keyOf(p){
    return p ? [p.id, p.principalType, p.employeeId || ''].join('|') : null;
  }
  function seqOf(kind){
    return kind === 'list' ? listSeq : kind === 'detail' ? detailSeq : kind === 'labels' ? labelsSeq : kind === 'mutation' ? mutationSeq : -1;
  }
  function isLive(token){ return !!token && token.gen === generation; }
  function isCurrent(token){
    return isLive(token) && token.seq === seqOf(token.kind);
  }
  function clear(){
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
        return Object.freeze({ gen: generation, kind: kind, seq: detailSeq });
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
    applyError(token, failed){
      if(!isCurrent(token)) return false;
      if(token.kind === 'labels'){ people = null; labelsStatus = SESSION_PAYROLL_STATUS.ERROR; labelsError = failure(failed); return true; }
      if(token.kind === 'list'){ list = null; listStatus = SESSION_PAYROLL_STATUS.ERROR; }
      else { detail = null; detailStatus = SESSION_PAYROLL_STATUS.ERROR; }
      error = Object.freeze(Object.assign({ scope: token.kind }, failure(failed)));
      return true;
    },
    // Leaves the detail: a pending detail answer is dropped, and the plan's confirmation goes.
    closeDetail(){
      detailSeq++; detail = null; detailId = null; detailStatus = SESSION_PAYROLL_STATUS.IDLE; clearError('detail');
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
        mutation: mutation, panel: panel, notice: notice
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
    else applied = SessionPayrollStore.applyLabels(token, out.data);
    if(applied) paint();
  }

  function principalNow(){
    const a = AuthBoot.snapshot();
    return a.state === AUTH_STATES.AUTHENTICATED ? a.principal : null;
  }

  function loadMonth(key){ return run('list', key, () => PayrollApi.month(key)); }
  function loadDetail(id){ return run('detail', id, () => PayrollApi.get(id)); }
  // D-AFI4c1-4 = A: the canonical CEO Employee list, archived records included, read-only.
  function loadLabels(){ return run('labels', null, () => EmployeeApi.list({ archived: true })); }

  /* ---------- writes ---------- */
  // Outcomes that cannot be known: the write may or may not have been applied.
  const AMBIGUOUS = Object.freeze([API_RESULT_KINDS.UNAVAILABLE, PAYROLL_API_INVALID]);
  const NOTICES = Object.freeze({ review: 'reviewed', approve: 'approved', return: 'returned', cancel: 'cancelled' });
  const TRANSITION_CALLS = Object.freeze({
    review: (id, v) => PayrollApi.review(id, v),
    approve: (id, v) => PayrollApi.approve(id, v),
    return: (id, v) => PayrollApi.returnToDraft(id, v),
    cancel: (id, v) => PayrollApi.cancel(id, v)
  });

  function pending(){ return SessionPayrollStore.snapshot().mutation.status === SESSION_PAYROLL_MUTATION_STATUS.PENDING; }
  // The authenticated CEO, the section shown, no write in flight.
  function canAct(){ return sessionPayrollIsCeo(principalNow()) && SessionPayrollStore.snapshot().open && !pending(); }

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

  // The month field and Previous / Next: another month's plans, read from the server.
  function setMonth(key){
    const s = SessionPayrollStore.snapshot();
    if(!canAct() || s.detailId || s.panel || !OvertimeCalendar.isMonth(key) || key === s.month) return;
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
      if(!s.open || !sessionPayrollIsCeo(principal)) return;
      if(s.listStatus === SESSION_PAYROLL_STATUS.IDLE || (s.listStale && !s.detailId && s.listStatus !== SESSION_PAYROLL_STATUS.LOADING)) loadMonth(s.month);
    },
    // The section switch of the workspace view: CEO only. Nothing changes while a write is in flight.
    show(value){
      if(pending()) return;
      if(value === true && !sessionPayrollIsCeo(principalNow())) return;
      SessionPayrollStore.setOpen(value === true, sessionPayrollCurrentMonth());
      if(value === true) SessionPayrollStore.setFocus('section');
      paint();
    },
    // Previous / Next (delta -1 / +1) and the month field ("YYYY-MM").
    shiftMonth(delta){
      const s = SessionPayrollStore.snapshot();
      if(!canAct() || s.detailId || s.panel || (delta !== 1 && delta !== -1)) return;
      return setMonth(OvertimeCalendar.shift(s.month, delta));
    },
    setMonth: setMonth,
    openDetail(id){
      if(!canAct() || typeof id !== 'string') return;
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
      if(!canAct()) return;
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
      const token = SessionPayrollStore.beginMutation(a.kind, { id: d.plan.id, version: d.plan.version });
      paint();
      return settle(token, await TRANSITION_CALLS[a.kind](d.plan.id, d.plan.version));
    }
  });
})();
