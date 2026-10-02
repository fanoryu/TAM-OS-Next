/* ============================================================
   SESSION OVERTIME DATA (AFI-4b1) — js/core/session-overtime.js
   ------------------------------------------------------------
   The SESSION-mode Overtime section of the authenticated workspace: the non-money workflow of
   BF-4b1 (Draft → Submitted → Reviewed, Submitted / Reviewed → Rejected; edit and hard delete of
   a Draft only). Held in memory only and owned here — never in the LOCAL `State`, never in
   storage, the URL or history, never through a LOCAL repository or the LOCAL Overtime module
   (js/people/overtime.js). The server (OvertimeApi, js/core/overtime-api.js) is the only source;
   this module only remembers its last decoded answers for the view. No rate, salary, schedule,
   amount, approval, contract or payroll value exists here (valuation is BF-4b2).

   SessionOvertimeStore — the data:
     principalKey  the principal the data belongs to (user, role, binding)
     generation    bumped by clear(): logout, session loss, a different principal
     open          the Overtime section is shown (the existing section stays the default)
     month         the month shown, "YYYY-MM": the browser's local calendar month when the section
                   first opens, then Previous / Next / the month field. Memory only: a reload,
                   logout, principal change or session loss forgets it.
     list, listMonth, listSeq, listStatus, listStale   the month's records
     detail, detailId, detailSeq, detailStatus         one record
     people, labelsSeq, labelsStatus   CEO: the Employee list (EmployeeApi.list({ archived: true }),
                   the one strict Employee decoder — D-AFI4b1-1) behind the owner labels and the
                   create selector; never stored on a record, never guessed
     error         { scope, kind, retryAfter?, requestId? } of the last failed list / detail read
     labelsError   the same for the Employee list
     form          the create / edit draft { mode, id, base, values } — strings, memory only
     panel         the open action panel { kind, id }: delete | submit | review | reject
     mutation      { kind, status, error, fields, target } of the write — status idle | pending |
                   error | ambiguous; target { id, version } of the record it was sent for
     mutationSeq   the sequence of the write in flight
     notice, focus a fixed message key / a focus hint for the view

   A request takes a token { gen, kind, seq }; its answer is applied only while token.gen is the
   current generation AND token.seq is still the latest of its kind (list, detail, labels,
   mutation). A superseded read is ignored; a sent write is never aborted, and its late answer is
   dropped the same way.

   SessionOvertime — the controller the view calls. Controls are UX only: every action is checked
   again here (sessionOvertimeActions) and the server decides. A write is sent once; only the
   strictly decoded, confirming server answer changes the data — nothing is optimistic. A 401 (or a
   recovery that found the session gone) ends the session (AuthBoot.sessionLost()); a recovery that
   could not confirm it fails closed (AuthBoot.sessionUncertain()); a different principal destroys
   the data. An outcome that cannot be known (503, network, timeout, malformed or non-confirming
   success) is AMBIGUOUS: never resent — the month (create) or the record (every other write) is
   read again and the view reports what that read shows.

   TARGET SELECTOR (D-AFI4b1-3): the owner a create names is the Employee's own
   principal.employeeId, or the CEO's selected live, Active Employee — a selector the server
   re-scopes, never authority.

   Classic shared global scope; top-level `const` bindings, not on window.
   ============================================================ */

const SESSION_OVERTIME_STATUS = Object.freeze({ IDLE: 'idle', LOADING: 'loading', READY: 'ready', ERROR: 'error' });
const SESSION_OVERTIME_MUTATION_STATUS = Object.freeze({ IDLE: 'idle', PENDING: 'pending', ERROR: 'error', AMBIGUOUS: 'ambiguous' });
const SESSION_OVERTIME_MUTATION_KINDS = Object.freeze(['create', 'update', 'delete', 'submit', 'review', 'reject']);
const SESSION_OVERTIME_PANEL_KINDS = Object.freeze(['delete', 'submit', 'review', 'reject']);
// The form fields, in form order: the owner (CEO create only) and OVERTIME_WRITABLE_FIELDS.
const SESSION_OVERTIME_FORM_FIELDS = Object.freeze(['employeeId', 'monthKey', 'overtimeDate', 'hours', 'workDescription', 'notes']);
const SESSION_OVERTIME_MUTATION_IDLE = Object.freeze({ kind: null, status: SESSION_OVERTIME_MUTATION_STATUS.IDLE, error: null, fields: null, target: null });

// The control matrix (D-BF4b-5) — UX only; the server decides every write again.
//   Employee + Draft: edit, delete, submit. Employee + anything else: view only.
//   CEO + Draft: edit, delete, submit. CEO + Submitted: review, reject. CEO + Reviewed: reject.
//   CEO + Rejected: view only. An Employee is offered nothing on a record that is not their own.
const SESSION_OVERTIME_EMPLOYEE_ACTIONS = Object.freeze({ Draft: Object.freeze(['edit', 'delete', 'submit']) });
const SESSION_OVERTIME_CEO_ACTIONS = Object.freeze({
  Draft: Object.freeze(['edit', 'delete', 'submit']),
  Submitted: Object.freeze(['review', 'reject']),
  Reviewed: Object.freeze(['reject'])
});
const SESSION_OVERTIME_NONE = Object.freeze([]);
function sessionOvertimeActions(principal, record){
  if(!principal || !record) return SESSION_OVERTIME_NONE;
  const own = (map) => Object.prototype.hasOwnProperty.call(map, record.status) ? map[record.status] : SESSION_OVERTIME_NONE;
  if(principal.principalType === PRINCIPAL_TYPES.CEO) return own(SESSION_OVERTIME_CEO_ACTIONS);
  if(principal.principalType === PRINCIPAL_TYPES.EMPLOYEE && typeof principal.employeeId === 'string' && record.employeeId === principal.employeeId) return own(SESSION_OVERTIME_EMPLOYEE_ACTIONS);
  return SESSION_OVERTIME_NONE;
}

// The month the section opens on: the local calendar month of `now` (injectable; a Date by default).
function sessionOvertimeCurrentMonth(now){
  return OvertimeCalendar.monthOf(now || new Date());
}

// The CEO's create selector: live Employees whose employment status is Active (UX only).
function sessionOvertimeEligible(people){
  return (people || []).filter((e) => e.archived === false && e.employmentStatus === 'Active');
}

// The owner label of a record — never guessed, never another record's. CEO: "fullName (code)",
// " (archived)" when archived, "Loading…" while the Employee list loads, "Unknown employee" when the
// id is not in it (or it failed). Employee: "You" for their own record only.
function sessionOvertimeOwnerLabel(principal, labelsStatus, people, employeeId){
  if(!principal || typeof employeeId !== 'string') return 'Unknown employee';
  if(principal.principalType === PRINCIPAL_TYPES.EMPLOYEE) return employeeId === principal.employeeId ? 'You' : 'Unknown employee';
  if(principal.principalType !== PRINCIPAL_TYPES.CEO) return 'Unknown employee';
  if(labelsStatus === SESSION_OVERTIME_STATUS.LOADING || labelsStatus === SESSION_OVERTIME_STATUS.IDLE) return 'Loading…';
  if(labelsStatus !== SESSION_OVERTIME_STATUS.READY || !people) return 'Unknown employee';
  const hits = people.filter((e) => e.id === employeeId);
  if(hits.length !== 1) return 'Unknown employee';
  return hits[0].fullName + ' (' + hits[0].employeeCode + ')' + (hits[0].archived ? ' (archived)' : '');
}

const SessionOvertimeStore = (function(){
  let principalKey = null;
  let generation = 0;
  let open = false, month = null;
  let list = null, listMonth = null, listSeq = 0, listStatus = SESSION_OVERTIME_STATUS.IDLE, listStale = false;
  let detail = null, detailId = null, detailSeq = 0, detailStatus = SESSION_OVERTIME_STATUS.IDLE;
  let people = null, labelsSeq = 0, labelsStatus = SESSION_OVERTIME_STATUS.IDLE, labelsError = null;
  let error = null;
  let mutation = SESSION_OVERTIME_MUTATION_IDLE, mutationSeq = 0;
  let form = null, panel = null, notice = null, focus = null;

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
    list = null; listMonth = null; listStatus = SESSION_OVERTIME_STATUS.IDLE; listStale = false; listSeq++;
    detail = null; detailId = null; detailStatus = SESSION_OVERTIME_STATUS.IDLE; detailSeq++;
    people = null; labelsStatus = SESSION_OVERTIME_STATUS.IDLE; labelsError = null; labelsSeq++;
    error = null;
    mutation = SESSION_OVERTIME_MUTATION_IDLE; mutationSeq++;
    form = null; panel = null; notice = null; focus = null;
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
  function formView(){
    return form ? Object.freeze({ mode: form.mode, id: form.id, base: form.base, values: Object.freeze(Object.assign({}, form.values)) }) : null;
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
    setMonth(key){
      month = key;
      list = null; listMonth = null; listStatus = SESSION_OVERTIME_STATUS.IDLE; listStale = false; listSeq++; clearError('list');
    },
    // A request token; the new request supersedes any earlier one of its kind.
    begin(kind, arg){
      if(kind === 'list'){
        listSeq++; listMonth = arg; list = null; listStatus = SESSION_OVERTIME_STATUS.LOADING; listStale = false; clearError('list');
        return Object.freeze({ gen: generation, kind: kind, seq: listSeq });
      }
      if(kind === 'detail'){
        detailSeq++; detailId = arg; detail = null; detailStatus = SESSION_OVERTIME_STATUS.LOADING; clearError('detail');
        return Object.freeze({ gen: generation, kind: kind, seq: detailSeq });
      }
      if(kind === 'labels'){
        labelsSeq++; people = null; labelsStatus = SESSION_OVERTIME_STATUS.LOADING; labelsError = null;
        return Object.freeze({ gen: generation, kind: kind, seq: labelsSeq });
      }
      throw new Error('unknown session overtime request kind');
    },
    isLive: isLive,
    isCurrent: isCurrent,
    applyList(token, items){
      if(!isCurrent(token) || token.kind !== 'list') return false;
      list = items; listStatus = SESSION_OVERTIME_STATUS.READY;
      return true;
    },
    applyDetail(token, item){
      if(!isCurrent(token) || token.kind !== 'detail') return false;
      detail = item; detailStatus = SESSION_OVERTIME_STATUS.READY;
      return true;
    },
    applyLabels(token, items){
      if(!isCurrent(token) || token.kind !== 'labels') return false;
      people = items; labelsStatus = SESSION_OVERTIME_STATUS.READY;
      return true;
    },
    applyError(token, failed){
      if(!isCurrent(token)) return false;
      if(token.kind === 'labels'){ people = null; labelsStatus = SESSION_OVERTIME_STATUS.ERROR; labelsError = failure(failed); return true; }
      if(token.kind === 'list'){ list = null; listStatus = SESSION_OVERTIME_STATUS.ERROR; }
      else { detail = null; detailStatus = SESSION_OVERTIME_STATUS.ERROR; }
      error = Object.freeze(Object.assign({ scope: token.kind }, failure(failed)));
      return true;
    },
    // Leaves the detail: a pending detail answer is dropped, and the edit draft and the action
    // panel of that record go with it.
    closeDetail(){
      detailSeq++; detail = null; detailId = null; detailStatus = SESSION_OVERTIME_STATUS.IDLE; clearError('detail');
      if(form && form.mode === 'edit') form = null;
      panel = null;
    },

    /* ---------- writes ---------- */
    openForm(mode, id, base){
      mutationSeq++; mutation = SESSION_OVERTIME_MUTATION_IDLE; notice = null; panel = null;
      form = { mode: mode, id: id, base: Object.freeze(Object.assign({}, base)), values: Object.assign({}, base) };
    },
    setDraft(name, value){
      if(!form || SESSION_OVERTIME_FORM_FIELDS.indexOf(name) === -1 || typeof value !== 'string') return false;
      if(name === 'employeeId' && form.mode !== 'create') return false;
      form.values[name] = value;
      return true;
    },
    closeForm(){ mutationSeq++; mutation = SESSION_OVERTIME_MUTATION_IDLE; form = null; },
    openPanel(kind, id){
      mutationSeq++; mutation = SESSION_OVERTIME_MUTATION_IDLE; notice = null;
      panel = Object.freeze({ kind: kind, id: id });
    },
    closePanel(){ mutationSeq++; mutation = SESSION_OVERTIME_MUTATION_IDLE; panel = null; },
    resetMutation(){ mutation = SESSION_OVERTIME_MUTATION_IDLE; notice = null; },
    beginMutation(kind, target){
      if(SESSION_OVERTIME_MUTATION_KINDS.indexOf(kind) === -1) throw new Error('unknown session overtime mutation kind');
      mutationSeq++;
      mutation = Object.freeze({ kind: kind, status: SESSION_OVERTIME_MUTATION_STATUS.PENDING, error: null, fields: null, target: target || null });
      notice = null;
      return Object.freeze({ gen: generation, kind: 'mutation', seq: mutationSeq });
    },
    // A write that failed definitely (ERROR) or whose outcome is unknown (AMBIGUOUS). An
    // unconfirmed action closes its panel: the record read again decides what is offered.
    failMutation(token, status, failed){
      if(!isCurrent(token) || token.kind !== 'mutation') return false;
      mutation = Object.freeze({ kind: mutation.kind, status: status, error: failure(failed),
        fields: failed.fields ? Object.freeze(failed.fields.slice()) : null, target: mutation.target });
      if(status === SESSION_OVERTIME_MUTATION_STATUS.AMBIGUOUS) panel = null;
      return true;
    },
    // A request refused before transport: nothing was sent.
    refuseMutation(kind, fields){
      mutationSeq++;
      mutation = Object.freeze({ kind: kind, status: SESSION_OVERTIME_MUTATION_STATUS.ERROR, error: Object.freeze({ kind: 'VALIDATION' }), fields: Object.freeze(fields.slice()), target: null });
      notice = null;
    },
    // A confirmed record from create / update / submit / review / reject: it becomes the detail;
    // the list is stale and shows the record's month.
    applySaved(token, item, noticeKey){
      if(!isCurrent(token) || token.kind !== 'mutation') return false;
      detailSeq++; detail = item; detailId = item.id; detailStatus = SESSION_OVERTIME_STATUS.READY; clearError('detail');
      form = null; panel = null; mutation = SESSION_OVERTIME_MUTATION_IDLE; listStale = true; notice = noticeKey;
      if(month !== item.monthKey){ month = item.monthKey; list = null; listMonth = null; listStatus = SESSION_OVERTIME_STATUS.IDLE; listSeq++; clearError('list'); }
      return true;
    },
    // A confirmed delete: the detail and its form close; the list is stale.
    applyDeleted(token){
      if(!isCurrent(token) || token.kind !== 'mutation') return false;
      detailSeq++; detail = null; detailId = null; detailStatus = SESSION_OVERTIME_STATUS.IDLE; clearError('detail');
      form = null; panel = null; mutation = SESSION_OVERTIME_MUTATION_IDLE; listStale = true; notice = 'deleted';
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
        people: people, labelsStatus: labelsStatus, labelsError: labelsError, error: error,
        mutation: mutation, form: formView(), panel: panel, notice: notice
      });
    }
  });
})();

const SessionOvertime = (function(){
  function paint(){ if(typeof render === 'function') render(); }

  // Sends one read under a fresh token and applies its answer only if it is still current.
  async function run(kind, arg, call){
    const token = SessionOvertimeStore.begin(kind, arg);
    const out = await call();
    if(!SessionOvertimeStore.isCurrent(token)) return;
    if(!out.ok && out.kind === API_RESULT_KINDS.UNAUTHENTICATED){
      AuthBoot.sessionLost();          // clears identity, CSRF and this store; renders SIGNED_OUT
      return;
    }
    let applied;
    if(!out.ok) applied = SessionOvertimeStore.applyError(token, out);
    else if(kind === 'list') applied = SessionOvertimeStore.applyList(token, out.data);
    else if(kind === 'detail') applied = SessionOvertimeStore.applyDetail(token, out.data);
    else applied = SessionOvertimeStore.applyLabels(token, out.data);
    if(applied) paint();
  }

  function principalNow(){
    const a = AuthBoot.snapshot();
    return a.state === AUTH_STATES.AUTHENTICATED ? a.principal : null;
  }
  function ceoPrincipal(p){ return !!p && p.principalType === PRINCIPAL_TYPES.CEO; }
  function employeePrincipal(p){ return !!p && p.principalType === PRINCIPAL_TYPES.EMPLOYEE && typeof p.employeeId === 'string' && OVERTIME_EMPLOYEE_ID_PATTERN.test(p.employeeId); }
  function knownPrincipal(p){ return ceoPrincipal(p) || employeePrincipal(p); }

  function loadMonth(key){ return run('list', key, () => OvertimeApi.month(key)); }
  function loadDetail(id){ return run('detail', id, () => OvertimeApi.get(id)); }
  // D-AFI4b1-1: the canonical Employee list, archived records included, read-only.
  function loadLabels(){ return run('labels', null, () => EmployeeApi.list({ archived: true })); }

  /* ---------- writes ---------- */
  // Outcomes that cannot be known: the write may or may not have been applied.
  const AMBIGUOUS = Object.freeze([API_RESULT_KINDS.UNAVAILABLE, OVERTIME_API_INVALID]);
  const NOTICES = Object.freeze({ create: 'created', update: 'saved', submit: 'submitted', review: 'reviewed', reject: 'rejected' });
  const PANEL_CALLS = Object.freeze({
    delete: (id, v) => OvertimeApi.remove(id, v),
    submit: (id, v) => OvertimeApi.submit(id, v),
    review: (id, v) => OvertimeApi.review(id, v),
    reject: (id, v) => OvertimeApi.reject(id, v)
  });

  function pending(){ return SessionOvertimeStore.snapshot().mutation.status === SESSION_OVERTIME_MUTATION_STATUS.PENDING; }
  // An authenticated CEO or bound Employee, the section shown, no write in flight.
  function canAct(){ return knownPrincipal(principalNow()) && SessionOvertimeStore.snapshot().open && !pending(); }

  // A draft's starting values: the decoded record as strings ('' for null).
  function formValues(d, monthKey){
    const out = { employeeId: '' };
    OVERTIME_WRITABLE_FIELDS.forEach(function(k){ out[k] = (d && d[k] !== null && d[k] !== undefined) ? String(d[k]) : ''; });
    if(!d) out.monthKey = monthKey;
    return out;
  }
  function focusFirst(fields){
    const first = SESSION_OVERTIME_FORM_FIELDS.filter((k) => (fields || []).indexOf(k) !== -1)[0];
    SessionOvertimeStore.setFocus(first ? 'field:' + first : 'message');
  }
  function refuse(kind, fields){
    SessionOvertimeStore.refuseMutation(kind, fields);
    focusFirst(fields);
    paint();
  }
  // A value as the server would store it, for "changed?" — hours canonical, text trimmed.
  function normal(name, v){
    if(name === 'hours'){ const h = OvertimeRequests.hours(v); return h === null ? v : h; }
    return typeof v === 'string' ? v.trim() : v;
  }

  // Applies a write's outcome. Late (another identity) and superseded answers are dropped.
  function settle(token, out){
    if(out.recovery === 'unavailable'){ AuthBoot.sessionUncertain(); return; }   // identity already cleared: fail closed
    if(!SessionOvertimeStore.isLive(token)) return;
    if(out.recovery === 'principal_changed'){ SessionOvertimeStore.clear(); paint(); return; }
    if(out.recovery === 'signed_out' || (!out.ok && out.kind === API_RESULT_KINDS.UNAUTHENTICATED)){ AuthBoot.sessionLost(); return; }
    if(!SessionOvertimeStore.isCurrent(token)) return;
    const s = SessionOvertimeStore.snapshot();
    const kind = s.mutation.kind;
    if(out.ok){
      if(kind === 'delete'){
        SessionOvertimeStore.applyDeleted(token);
        SessionOvertimeStore.setFocus('message');
        loadMonth(SessionOvertimeStore.snapshot().month);
      } else {
        SessionOvertimeStore.applySaved(token, out.data, NOTICES[kind]);
        SessionOvertimeStore.setFocus('message');
      }
      paint();
      return;
    }
    if(AMBIGUOUS.indexOf(out.kind) !== -1){
      // Never resent: read the server state again instead.
      SessionOvertimeStore.failMutation(token, SESSION_OVERTIME_MUTATION_STATUS.AMBIGUOUS, out);
      SessionOvertimeStore.markListStale();
      SessionOvertimeStore.setFocus('message');
      if(kind === 'create') loadMonth(s.month);
      else if(s.detailId) loadDetail(s.detailId);
      paint();
      return;
    }
    SessionOvertimeStore.failMutation(token, SESSION_OVERTIME_MUTATION_STATUS.ERROR, out);
    if(out.kind === API_RESULT_KINDS.NOT_FOUND && kind !== 'create'){
      SessionOvertimeStore.closeDetail();
      SessionOvertimeStore.setFocus('message');
      loadMonth(s.month);
    } else if(out.kind === API_RESULT_KINDS.VALIDATION){
      focusFirst(out.fields);
    } else {
      SessionOvertimeStore.setFocus('message');
    }
    paint();
  }

  // The month field and Previous / Next: another month's records, read from the server.
  function setMonth(key){
    const s = SessionOvertimeStore.snapshot();
    if(!canAct() || s.detailId || s.form || !OvertimeCalendar.isMonth(key) || key === s.month) return;
    SessionOvertimeStore.resetMutation();
    SessionOvertimeStore.setMonth(key);
    const loading = loadMonth(key);
    paint();
    return loading;
  }

  return Object.freeze({
    // Called on every render of the authenticated workspace: binds the data to the principal
    // (a different one destroys it) and, while the section is shown, starts the reads it needs.
    ensureLoaded(principal){
      if(!principal) return;
      SessionOvertimeStore.bindPrincipal(principal);
      const s = SessionOvertimeStore.snapshot();
      if(!s.open || !knownPrincipal(principal)) return;
      if(s.listStatus === SESSION_OVERTIME_STATUS.IDLE || (s.listStale && !s.detailId && s.listStatus !== SESSION_OVERTIME_STATUS.LOADING)) loadMonth(s.month);
      if(ceoPrincipal(principal) && s.labelsStatus === SESSION_OVERTIME_STATUS.IDLE) loadLabels();
    },
    // The section switch of the workspace view. Nothing changes while a write is in flight.
    show(value){
      if(pending()) return;
      const p = principalNow();
      if(!knownPrincipal(p)) return;
      SessionOvertimeStore.setOpen(value === true, sessionOvertimeCurrentMonth());
      if(value === true) SessionOvertimeStore.setFocus('section');
      paint();
    },
    // Previous / Next (delta -1 / +1) and the month field ("YYYY-MM").
    shiftMonth(delta){
      const s = SessionOvertimeStore.snapshot();
      if(!canAct() || s.detailId || s.form || (delta !== 1 && delta !== -1)) return;
      return setMonth(OvertimeCalendar.shift(s.month, delta));
    },
    setMonth: setMonth,
    openDetail(id){
      if(!canAct() || typeof id !== 'string') return;
      const s = SessionOvertimeStore.snapshot();
      if(s.detailId === id && s.detailStatus === SESSION_OVERTIME_STATUS.LOADING) return;
      if(s.form) SessionOvertimeStore.closeForm();         // leaving the list leaves its create draft
      SessionOvertimeStore.resetMutation();
      const loading = loadDetail(id);
      paint();
      return loading;
    },
    back(){
      if(pending()) return;
      SessionOvertimeStore.closeDetail();
      SessionOvertimeStore.resetMutation();
      paint();
    },
    retry(){
      const p = principalNow();
      const s = SessionOvertimeStore.snapshot();
      if(!knownPrincipal(p) || pending() || !s.open) return;
      let loading;
      if(s.error && s.error.scope === 'list') loading = loadMonth(s.month);
      else if(s.error && s.error.scope === 'detail' && s.detailId) loading = loadDetail(s.detailId);
      paint();
      return loading;
    },
    retryLabels(){
      const p = principalNow();
      const s = SessionOvertimeStore.snapshot();
      if(!ceoPrincipal(p) || pending() || !s.open || s.labelsStatus !== SESSION_OVERTIME_STATUS.ERROR) return;
      const loading = loadLabels();
      paint();
      return loading;
    },

    openCreate(){
      if(!canAct()) return;
      const s = SessionOvertimeStore.snapshot();
      if(s.detailId || s.form) return;
      SessionOvertimeStore.openForm('create', null, formValues(null, s.month));
      SessionOvertimeStore.setFocus('form');
      paint();
    },
    openEdit(){
      if(!canAct()) return;
      const s = SessionOvertimeStore.snapshot();
      const d = s.detail;
      if(s.detailStatus !== SESSION_OVERTIME_STATUS.READY || !d || s.form || s.panel) return;
      if(sessionOvertimeActions(principalNow(), d).indexOf('edit') === -1) return;
      SessionOvertimeStore.openForm('edit', d.id, formValues(d, d.monthKey));
      SessionOvertimeStore.setFocus('form');
      paint();
    },
    // Keeps the draft in memory as it is typed; no render, so focus and caret stay put. A
    // changed month re-renders once, so the date field follows it.
    setDraft(name, value){
      if(!knownPrincipal(principalNow()) || pending()) return;
      const before = SessionOvertimeStore.snapshot().form;
      if(!SessionOvertimeStore.setDraft(name, value)) return;
      if(name === 'monthKey' && before && before.values.monthKey !== value) paint();
    },
    cancelForm(){
      if(!canAct() || !SessionOvertimeStore.snapshot().form) return;
      SessionOvertimeStore.closeForm();
      paint();
    },
    // Create: the owner and every field. Edit: only the fields changed from the record the form
    // started from, against the version of the record now held — nothing changed sends nothing.
    async submitForm(){
      if(!canAct()) return;
      const p = principalNow();
      const s = SessionOvertimeStore.snapshot();
      const f = s.form;
      if(!f) return;
      const fields = {};
      OVERTIME_WRITABLE_FIELDS.forEach(function(k){ fields[k] = f.values[k]; });
      if(f.mode === 'create'){
        // The target selector: the Employee's own id, or the CEO's selected live, Active Employee.
        let owner = null;
        if(employeePrincipal(p)) owner = p.employeeId;
        else if(sessionOvertimeEligible(s.people).some((e) => e.id === f.values.employeeId)) owner = f.values.employeeId;
        const prepared = OvertimeRequests.create(owner === null ? '' : owner, fields);
        if(owner === null || !prepared.ok){
          const bad = prepared.ok ? [] : prepared.fields.slice();
          if(owner === null && bad.indexOf('employeeId') === -1) bad.unshift('employeeId');
          return refuse('create', bad);
        }
        const token = SessionOvertimeStore.beginMutation('create', null);
        paint();
        return settle(token, await OvertimeApi.create(owner, fields));
      }
      const d = s.detail;
      if(s.detailStatus !== SESSION_OVERTIME_STATUS.READY || !d || d.id !== f.id || sessionOvertimeActions(p, d).indexOf('edit') === -1) return;
      const changed = {};
      OVERTIME_WRITABLE_FIELDS.forEach(function(k){ if(normal(k, f.values[k]) !== normal(k, f.base[k])) changed[k] = f.values[k]; });
      if(!Object.keys(changed).length){
        SessionOvertimeStore.resetMutation();
        SessionOvertimeStore.setNotice('unchanged');
        SessionOvertimeStore.setFocus('message');
        paint();
        return;
      }
      const prepared = OvertimeRequests.update(d.id, d.version, changed, fields);
      if(!prepared.ok) return refuse('update', prepared.fields);
      const token = SessionOvertimeStore.beginMutation('update', { id: d.id, version: d.version });
      paint();
      return settle(token, await OvertimeApi.update(d.id, d.version, changed, fields));
    },
    // After a conflict (or to check an unconfirmed write): the record again, from the server.
    // An open draft is kept; a later Save uses the version read now.
    reloadRecord(){
      if(!canAct()) return;
      const s = SessionOvertimeStore.snapshot();
      if(!s.detailId) return;
      if(s.panel) SessionOvertimeStore.closePanel();      // the record read again decides what is offered
      SessionOvertimeStore.resetMutation();
      if(s.form) SessionOvertimeStore.setNotice('reloaded');
      const loading = loadDetail(s.detailId);
      paint();
      return loading;
    },
    // Delete / submit / review / reject ask first: this only opens the panel; nothing is sent.
    openPanel(kind){
      if(!canAct() || SESSION_OVERTIME_PANEL_KINDS.indexOf(kind) === -1) return;
      const s = SessionOvertimeStore.snapshot();
      const d = s.detail;
      if(s.detailStatus !== SESSION_OVERTIME_STATUS.READY || !d || s.form || s.panel) return;
      if(sessionOvertimeActions(principalNow(), d).indexOf(kind) === -1) return;
      SessionOvertimeStore.openPanel(kind, d.id);
      SessionOvertimeStore.setFocus('panel');
      paint();
    },
    cancelPanel(){
      if(!canAct() || !SessionOvertimeStore.snapshot().panel) return;
      SessionOvertimeStore.closePanel();
      paint();
    },
    // Sends the open action once, for the record it was opened on, at the version now held —
    // only if the matrix still offers it for that record.
    async confirmPanel(){
      if(!canAct()) return;
      const s = SessionOvertimeStore.snapshot();
      const a = s.panel;
      const d = s.detail;
      if(!a || s.detailStatus !== SESSION_OVERTIME_STATUS.READY || !d || d.id !== a.id) return;
      if(sessionOvertimeActions(principalNow(), d).indexOf(a.kind) === -1){ SessionOvertimeStore.closePanel(); paint(); return; }
      const token = SessionOvertimeStore.beginMutation(a.kind, { id: d.id, version: d.version });
      paint();
      return settle(token, await PANEL_CALLS[a.kind](d.id, d.version));
    }
  });
})();
