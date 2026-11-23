/* ============================================================
   SESSION FINANCE REQUESTS DATA (I4, ADR-016) — js/core/session-requests.js
   ------------------------------------------------------------
   The SESSION-mode Finance Requests section of the authenticated workspace over the nine AWP-01
   routes (FinanceRequestApi, js/core/request-api.js):

     CEO       Finance Requests: the company's payment requests and reimbursements; create a
               payment request or (CR-01) a reimbursement for one active employee, its post
               optional; edit / submit a Draft; approve or reject a Submitted request; cancel
               a Draft, Submitted or Approved one; pay an Approved one (which records the linked
               general expense); each request's activity history (AuditApi.record)
     Employee  My reimbursements: their own reimbursements only; create one; edit / submit their
               own Draft; follow its status (approved, rejected, cancelled, paid). Never a CEO
               control — and the server refuses one anyway (403 before any lookup).

   FINANCIAL POST (CR-01, ADR-017): an Employee never chooses a reimbursement's post; they see the
   one the CEO assigned, read-only. The CEO may set or replace it in a Draft edit and selects or
   confirms it in the approval panel (preselected with the stored post). A projection that does not
   fit the principal (the snapshot fields for an Employee, or their absence for the CEO) is
   INVALID_RESPONSE.

   Held in memory only and owned here — never in the LOCAL `State`, never in storage, the URL or
   history. The server is the only source; this module remembers its last decoded answers for the
   view and the user's unsent drafts.

   SessionRequestsStore — the data:
     principalKey, generation   the principal the data belongs to; clear() bumps the generation
     open                       the section is shown
     range, rangeDraft          the documentDate range listed — the current company-calendar year
                                when first shown, then the user's Apply
     filter                     '' or one status: the list shown (the server list is not re-read)
     kindFilter                 CEO only: '' or one request kind, composed with `filter` over the same
                                list (never re-read); reset with every principal change
     list, listStatus           the requests of `range`, in documentDate order
     detailId, detail, detailStatus   the request opened, read from the server
     history, historyStatus     the CEO's activity history of the request opened
     employees                  the CEO's employee names by id, archived included (display only), or null
     employeeOptions            CR-01: the CEO's live, Active employees [{ id, fullName }] offered by the
                                reimbursement create form, or null (the server decides eligibility)
     form                       null, or { mode: 'create' | 'edit', kind, values, key } — the
                                create key is made once when the form opens
     action                     null, or the confirmation panel { op, reason, paidOn,
                                paymentMethod, financialPost, key } — the pay key is made once
                                when it opens; financialPost is the approval's post (CR-01)
     mutation                   { kind, status, error, fields }
     errors                     { list, detail, history }: each read's own last failure, or null —
                                one read's failure never overwrites or clears another's (I4-F01)
     notice, focus              a fixed message key, a focus hint

   A read takes a token { gen, kind, seq } and is applied only while it is the latest of its kind
   in the current generation. A write takes { gen } and is dropped when the principal changed.

   SessionRequests — the controller the view calls. A write always names the version (and for
   approve / pay the amount) of the request on screen. After a write — or a 409 — the list and the
   request are read again from the server; nothing is updated optimistically here. A 401 ends the
   session (AuthBoot.sessionLost()); a recovery that could not confirm the session fails closed
   (AuthBoot.sessionUncertain()). Nothing is retried automatically: an ambiguous write keeps its
   form and key, so a deliberate resubmit replays it instead of making a second request or payment.

   Classic shared global scope; top-level `const` bindings, not on window.
   ============================================================ */

const SESSION_REQUESTS_STATUS = Object.freeze({ IDLE: 'idle', LOADING: 'loading', READY: 'ready', ERROR: 'error' });
const SESSION_REQUESTS_MUTATION_STATUS = Object.freeze({ IDLE: 'idle', PENDING: 'pending', ERROR: 'error', AMBIGUOUS: 'ambiguous' });
const SESSION_REQUESTS_OPS = Object.freeze(['submit', 'approve', 'reject', 'cancel', 'pay']);

function sessionRequestsIsCeo(p){ return !!p && p.principalType === PRINCIPAL_TYPES.CEO; }
function sessionRequestsIsEmployee(p){ return !!p && p.principalType === PRINCIPAL_TYPES.EMPLOYEE && typeof p.employeeId === 'string' && p.employeeId !== ''; }
// The kind this principal creates by default: the CEO a payment request, an Employee a reimbursement.
function sessionRequestsCreateKind(p){ return sessionRequestsIsCeo(p) ? 'paymentRequest' : (sessionRequestsIsEmployee(p) ? 'reimbursement' : null); }
// CR-01 (ADR-017 §6): the kinds this principal may create — the CEO either (a reimbursement for an
// employee), an Employee only their own reimbursement.
function sessionRequestsCreateKinds(p){ return sessionRequestsIsCeo(p) ? ['paymentRequest', 'reimbursement'] : (sessionRequestsIsEmployee(p) ? ['reimbursement'] : []); }
// The company-calendar year of `now`: the range the section opens on (365 or 366 days).
function sessionRequestsYearRange(now){
  const y = transactionToday(now).slice(0, 4);
  return Object.freeze({ from: y + '-01-01', to: y + '-12-31' });
}
// The operations this principal is offered on `r` — display only; the server Policy decides.
//   CEO: edit / submit / cancel a Draft; approve / reject / cancel a Submitted; pay / cancel an Approved.
//   Employee: edit / submit their own Draft reimbursement (the server scopes the read to their own).
function sessionRequestsOffered(p, r){
  if(!r) return [];
  const out = [];
  if(sessionRequestsIsCeo(p)){
    ['update', 'submit', 'approve', 'reject', 'pay', 'cancel'].forEach(function(op){ if(financeRequestAllows(r, op)) out.push(op); });
  } else if(sessionRequestsIsEmployee(p) && r.kind === 'reimbursement' && r.employeeId === p.employeeId){
    ['update', 'submit'].forEach(function(op){ if(financeRequestAllows(r, op)) out.push(op); });
  }
  return out;
}
function sessionRequestsValuesOf(r){
  return { financialPost: r.financialPost === null ? '' : r.financialPost, category: r.category, description: r.description, amount: r.amount, payee: r.payee === null ? '' : r.payee, documentDate: r.documentDate };
}
// CR-01 (ADR-017 R-3): the CEO receives the approval snapshot, an Employee never does.
function sessionRequestsShapeFits(p, r){ return sessionRequestsIsCeo(p) ? financeRequestHasSnapshot(r) : !financeRequestHasSnapshot(r); }
// The rows of the list as filtered and rendered: the status filter and, for the CEO only, the
// request-type filter, over the list already read. The view renders these and Open names one by its index.
function sessionRequestsVisibleRows(s, p){
  if(s.listStatus !== SESSION_REQUESTS_STATUS.READY || !s.list) return [];
  const kind = sessionRequestsIsCeo(p) ? s.kindFilter : '';
  return s.list.filter(function(r){ return (!s.filter || r.status === s.filter) && (!kind || r.kind === kind); });
}

const SessionRequestsStore = (function(){
  const IDLE_MUTATION = Object.freeze({ kind: null, status: SESSION_REQUESTS_MUTATION_STATUS.IDLE, error: null, fields: null });
  let principalKey = null, generation = 0;
  let open = false, range = null, rangeDraft = null, filter = '', kindFilter = '';
  let list = null, listSeq = 0, listStatus = SESSION_REQUESTS_STATUS.IDLE;
  let detailId = null, detail = null, detailSeq = 0, detailStatus = SESSION_REQUESTS_STATUS.IDLE;
  let history = null, historySeq = 0, historyStatus = SESSION_REQUESTS_STATUS.IDLE;
  let employees = null, employeeOptions = null, employeesSeq = 0;
  let form = null, action = null, mutation = IDLE_MUTATION;
  let errors = { list: null, detail: null, history: null }, notice = null, focus = null;

  function keyOf(p){ return p ? [p.id, p.principalType, p.employeeId || ''].join('|') : null; }
  function seqOf(kind){ return kind === 'list' ? listSeq : kind === 'detail' ? detailSeq : kind === 'history' ? historySeq : kind === 'employees' ? employeesSeq : -1; }
  function isCurrent(token){ return !!token && token.gen === generation && token.seq === seqOf(token.kind); }
  function isLive(token){ return !!token && token.gen === generation; }
  function clearError(scope){ errors[scope] = null; }
  function dropList(){ listSeq++; list = null; listStatus = SESSION_REQUESTS_STATUS.IDLE; clearError('list'); }
  function dropDetail(){
    detailSeq++; detail = null; detailStatus = SESSION_REQUESTS_STATUS.IDLE; clearError('detail');
    historySeq++; history = null; historyStatus = SESSION_REQUESTS_STATUS.IDLE; clearError('history');
  }
  function clear(){
    open = false; range = null; rangeDraft = null; filter = ''; kindFilter = '';
    dropList(); detailId = null; dropDetail(); employeesSeq++; employees = null; employeeOptions = null;
    form = null; action = null; mutation = IDLE_MUTATION;
    errors = { list: null, detail: null, history: null }; notice = null; focus = null;
    principalKey = null;
    generation++;
  }
  function failure(failed){
    const e = { kind: failed.kind };
    if(failed.retryAfter !== undefined) e.retryAfter = failed.retryAfter;
    if(failed.requestId) e.requestId = failed.requestId;
    return e;
  }

  return Object.freeze({
    clear: clear,
    bindPrincipal(p){
      const key = keyOf(p);
      if(key === principalKey) return false;
      clear();
      principalKey = key;
      return true;
    },
    // Shows or leaves the section; leaving it forgets what was read and any unsent draft.
    setOpen(value, initialRange){
      const next = value === true;
      if(open !== next){
        dropList(); detailId = null; dropDetail(); form = null; action = null; notice = null;
        if(mutation.status !== SESSION_REQUESTS_MUTATION_STATUS.PENDING) mutation = IDLE_MUTATION;
      }
      open = next;
      if(open && range === null){ range = initialRange; rangeDraft = { from: initialRange.from, to: initialRange.to }; }
    },
    setRangeDraft(name, value){ if(rangeDraft && (name === 'from' || name === 'to')) rangeDraft[name] = typeof value === 'string' ? value : ''; },
    setRange(next){ range = Object.freeze({ from: next.from, to: next.to }); rangeDraft = { from: next.from, to: next.to }; notice = null; dropList(); },
    setFilter(v){ filter = v === '' || FINANCE_REQUEST_STATUSES.indexOf(v) !== -1 ? v : ''; },
    setKindFilter(v){ kindFilter = v === '' || FINANCE_REQUEST_KINDS.indexOf(v) !== -1 ? v : ''; },
    openDetail(id){ detailId = id; dropDetail(); form = null; action = null; notice = null; mutation = IDLE_MUTATION; },
    closeDetail(){ detailId = null; dropDetail(); form = null; action = null; notice = null; mutation = IDLE_MUTATION; },
    begin(kind){
      if(kind === 'list'){ listSeq++; list = null; listStatus = SESSION_REQUESTS_STATUS.LOADING; clearError('list'); return Object.freeze({ gen: generation, kind: kind, seq: listSeq }); }
      if(kind === 'detail'){ detailSeq++; detailStatus = SESSION_REQUESTS_STATUS.LOADING; clearError('detail'); return Object.freeze({ gen: generation, kind: kind, seq: detailSeq, id: detailId }); }
      if(kind === 'history'){ historySeq++; history = null; historyStatus = SESSION_REQUESTS_STATUS.LOADING; clearError('history'); return Object.freeze({ gen: generation, kind: kind, seq: historySeq, id: detailId }); }
      if(kind === 'employees'){ employeesSeq++; return Object.freeze({ gen: generation, kind: kind, seq: employeesSeq }); }
      throw new Error('unknown finance request read');
    },
    isCurrent: isCurrent,
    isLive: isLive,
    applyRead(token, data){
      if(!isCurrent(token)) return false;
      if(token.kind === 'list'){ list = data; listStatus = SESSION_REQUESTS_STATUS.READY; clearError('list'); }
      else if(token.kind === 'detail'){ if(token.id !== detailId) return false; detail = data; detailStatus = SESSION_REQUESTS_STATUS.READY; clearError('detail'); }
      else if(token.kind === 'history'){ if(token.id !== detailId) return false; history = data; historyStatus = SESSION_REQUESTS_STATUS.READY; clearError('history'); }
      else if(token.kind === 'employees'){ employees = data.names; employeeOptions = data.options; }
      return true;
    },
    applyError(token, failed){
      if(!isCurrent(token)) return false;
      if(token.kind === 'employees') return false;                 // names are display only: the ids stay
      if(token.kind === 'list'){ list = null; listStatus = SESSION_REQUESTS_STATUS.ERROR; }
      else if(token.kind === 'detail'){ if(token.id !== detailId) return false; detail = null; detailStatus = SESSION_REQUESTS_STATUS.ERROR; }
      else { if(token.id !== detailId) return false; history = null; historyStatus = SESSION_REQUESTS_STATUS.ERROR; }
      errors[token.kind] = Object.freeze(Object.assign({ scope: token.kind }, failure(failed)));   // its own slot only (I4-F01)
      return true;
    },
    openForm(mode, kind, values, key){ form = { mode: mode, kind: kind, values: Object.assign({}, values), key: key }; action = null; notice = null; mutation = IDLE_MUTATION; },
    setDraft(name, value){ if(form && (FINANCE_REQUEST_FIELDS.indexOf(name) !== -1 || name === 'employeeId')) form.values[name] = typeof value === 'string' ? value : ''; },
    closeForm(){ form = null; if(mutation.kind === 'create' || mutation.kind === 'update') mutation = IDLE_MUTATION; },
    openAction(op, today, key, post){ action = { op: op, reason: '', paidOn: today, paymentMethod: '', financialPost: typeof post === 'string' ? post : '', key: key }; form = null; notice = null; mutation = IDLE_MUTATION; },
    setActionField(name, value){ if(action && (name === 'reason' || name === 'paidOn' || name === 'paymentMethod' || name === 'financialPost')) action[name] = typeof value === 'string' ? value : ''; },
    closeAction(){ action = null; if(SESSION_REQUESTS_OPS.indexOf(mutation.kind) !== -1) mutation = IDLE_MUTATION; },
    beginMutation(kind){
      mutation = Object.freeze({ kind: kind, status: SESSION_REQUESTS_MUTATION_STATUS.PENDING, error: null, fields: null });
      return Object.freeze({ gen: generation });
    },
    // A failed write. A 409 (the request changed or moved on) closes the form or panel: what is on
    // screen is stale, so it is read again and the user decides afresh.
    failMutation(token, status, failed){
      if(!isLive(token)) return false;
      if(failed.kind === API_RESULT_KINDS.CONFLICT){ form = form && form.mode === 'create' ? form : null; action = null; }
      mutation = Object.freeze({ kind: mutation.kind, status: status, error: Object.freeze(failure(failed)), fields: failed.fields ? Object.freeze(failed.fields.slice()) : null });
      return true;
    },
    // A confirmed write: the panel closes, the request shown is `openId` (the new Draft after a
    // create), and the list and the request are read again.
    succeedMutation(token, noticeKey, openId){
      if(!isLive(token)) return false;
      form = null; action = null;
      mutation = IDLE_MUTATION;
      notice = noticeKey;
      dropList();
      if(openId) detailId = openId;
      dropDetail();
      return true;
    },
    refreshAfterConflict(){ dropList(); dropDetail(); },
    // A create refused as a reused key with other values: the form keeps its values under a new key.
    rekeyForm(key){ if(form && form.mode === 'create') form.key = key; },
    setNotice(key){ notice = key; },
    setFocus(hint){ focus = hint; },
    takeFocus(){ const f = focus; focus = null; return f; },
    snapshot(){
      return Object.freeze({
        principalKey: principalKey, generation: generation, open: open, range: range, filter: filter, kindFilter: kindFilter,
        rangeDraft: rangeDraft ? Object.freeze({ from: rangeDraft.from, to: rangeDraft.to }) : null,
        list: list, listStatus: listStatus, detailId: detailId, detail: detail, detailStatus: detailStatus,
        history: history, historyStatus: historyStatus, employees: employees, employeeOptions: employeeOptions,
        form: form ? Object.freeze({ mode: form.mode, kind: form.kind, values: Object.freeze(Object.assign({}, form.values)), key: form.key }) : null,
        action: action ? Object.freeze(Object.assign({}, action)) : null,
        mutation: mutation, errors: Object.freeze({ list: errors.list, detail: errors.detail, history: errors.history }), notice: notice
      });
    }
  });
})();

const SessionRequests = (function(){
  // An ambiguous answer: the write may or may not have happened. Never resent automatically; the
  // same key makes a deliberate resubmit of a create or a payment a replay, never a second one.
  const AMBIGUOUS = Object.freeze([API_RESULT_KINDS.UNAVAILABLE, API_RESULT_KINDS.SERVER_ERROR, TRANSACTION_API_INVALID]);
  function paint(){ if(typeof render === 'function') render(); }
  function principalNow(){
    const a = AuthBoot.snapshot();
    return a.state === AUTH_STATES.AUTHENTICATED ? a.principal : null;
  }
  function today(){ return transactionToday(new Date()); }
  function pending(){ return SessionRequestsStore.snapshot().mutation.status === SESSION_REQUESTS_MUTATION_STATUS.PENDING; }
  function canRead(){ return sessionRequestsCreateKind(principalNow()) !== null && SessionRequestsStore.snapshot().open; }
  function canAct(){ return canRead() && !pending(); }
  function message(key){ SessionRequestsStore.setNotice(key); SessionRequestsStore.setFocus('message'); paint(); }

  async function read(kind){
    const s = SessionRequestsStore.snapshot();
    const p = principalNow();
    if(kind === 'history' && !sessionRequestsIsCeo(p)) return;
    if(kind === 'employees' && !sessionRequestsIsCeo(p)) return;
    if((kind === 'detail' || kind === 'history') && !s.detailId) return;
    const token = SessionRequestsStore.begin(kind);
    const out = await (kind === 'list' ? FinanceRequestApi.list(s.range.from, s.range.to)
      : kind === 'detail' ? FinanceRequestApi.get(s.detailId)
      : kind === 'history' ? AuditApi.record('financeRequest', s.detailId)
      : EmployeeApi.list({ archived: true }));   // names, archived employees included
    if(!SessionRequestsStore.isCurrent(token)) return;
    if(!out.ok && out.kind === API_RESULT_KINDS.UNAUTHENTICATED){ AuthBoot.sessionLost(); return; }
    // CR-01: a request projection that does not fit this principal is refused whole.
    if(out.ok && (kind === 'list' || kind === 'detail') && !(kind === 'list' ? out.data : [out.data]).every(function(r){ return sessionRequestsShapeFits(p, r); })){
      if(SessionRequestsStore.applyError(token, { kind: TRANSACTION_API_INVALID })) paint();
      return;
    }
    let data = out.ok ? out.data : null;
    if(out.ok && kind === 'employees'){
      const names = {};
      (data || []).forEach(function(e){ names[e.id] = e.fullName; });
      // CR-01: the employees a CEO-filed reimbursement may name — live and Active, as the Overtime
      // create selector (UX only; the server decides eligibility). Display order kept.
      const options = (data || []).filter(function(e){ return e.archived === false && e.employmentStatus === 'Active'; }).map(function(e){ return Object.freeze({ id: e.id, fullName: e.fullName }); });
      data = Object.freeze({ names: Object.freeze(names), options: Object.freeze(options) });
    }
    if(out.ok ? SessionRequestsStore.applyRead(token, data) : SessionRequestsStore.applyError(token, out)) paint();
  }
  function loadVisible(){
    const s = SessionRequestsStore.snapshot();
    const loads = [];
    if(s.listStatus === SESSION_REQUESTS_STATUS.IDLE) loads.push(read('list'));
    if(s.detailId && s.detailStatus === SESSION_REQUESTS_STATUS.IDLE) loads.push(read('detail'));
    if(s.detailId && s.historyStatus === SESSION_REQUESTS_STATUS.IDLE && sessionRequestsIsCeo(principalNow())) loads.push(read('history'));
    return Promise.all(loads);
  }

  async function settle(token, out, noticeKey, openId){
    if(out.recovery === 'unavailable'){ AuthBoot.sessionUncertain(); return; }   // identity already cleared: fail closed
    // CR-01: an answer of the wrong projection confirms nothing (ambiguous, never resent).
    if(out.ok && !sessionRequestsShapeFits(principalNow(), out.data)) out = Object.freeze({ ok: false, kind: TRANSACTION_API_INVALID, recovery: out.recovery });
    if(!SessionRequestsStore.isLive(token)) return;
    if(out.recovery === 'principal_changed'){ SessionRequestsStore.clear(); paint(); return; }
    if(out.recovery === 'signed_out' || (!out.ok && out.kind === API_RESULT_KINDS.UNAUTHENTICATED)){ AuthBoot.sessionLost(); return; }
    if(out.ok){
      SessionRequestsStore.succeedMutation(token, noticeKey, openId ? openId(out.data) : null);
      SessionRequestsStore.setFocus('message');
      const loading = loadVisible();
      paint();
      return loading;
    }
    SessionRequestsStore.failMutation(token, AMBIGUOUS.indexOf(out.kind) !== -1 ? SESSION_REQUESTS_MUTATION_STATUS.AMBIGUOUS : SESSION_REQUESTS_MUTATION_STATUS.ERROR, out);
    SessionRequestsStore.setFocus('message');
    // 409: the request changed elsewhere or moved on — show the server's current state, never resend.
    // 404: it is gone or out of scope — the list is read again.
    // A create's 409 is its key already used with other values (after an ambiguous answer): the
    // first one may be stored, so the list is read again and the next submit gets a new key.
    let loading;
    if(out.kind === API_RESULT_KINDS.CONFLICT && SessionRequestsStore.snapshot().mutation.kind === 'create'){ const k = payrollIdempotencyKey(); if(k !== null) SessionRequestsStore.rekeyForm(k); }
    if(out.kind === API_RESULT_KINDS.CONFLICT || out.kind === API_RESULT_KINDS.NOT_FOUND){ SessionRequestsStore.refreshAfterConflict(); loading = loadVisible(); }
    paint();
    return loading;
  }
  // The request on screen, when the operation is offered for it to this principal.
  function shown(op){
    const s = SessionRequestsStore.snapshot();
    const r = s.detailStatus === SESSION_REQUESTS_STATUS.READY ? s.detail : null;
    return r && sessionRequestsOffered(principalNow(), r).indexOf(op) !== -1 ? r : null;
  }

  return Object.freeze({
    // Called on every render of the authenticated workspace: binds the data to the principal and,
    // while the section is shown, starts the reads its view needs.
    ensureLoaded(principal){
      if(!principal) return;
      SessionRequestsStore.bindPrincipal(principal);
      const s = SessionRequestsStore.snapshot();
      if(!s.open || sessionRequestsCreateKind(principal) === null) return;
      loadVisible();
    },
    show(value){
      if(value === true && sessionRequestsCreateKind(principalNow()) === null) return;
      const was = SessionRequestsStore.snapshot().open;
      SessionRequestsStore.setOpen(value === true, sessionRequestsYearRange(new Date()));
      if(value === true){
        SessionRequestsStore.setFocus('section');
        if(!was && sessionRequestsIsCeo(principalNow())) read('employees');
      }
      paint();
    },
    setRangeDraft(name, value){ if(canRead()) SessionRequestsStore.setRangeDraft(name, value); },
    // Apply: the typed range, read again from the server. A range outside the grammar is never sent.
    applyRange(){
      if(!canAct()) return;
      const d = SessionRequestsStore.snapshot().rangeDraft;
      if(!d || !transactionIsRange(d.from, d.to)){ message('rangeInvalid'); return; }
      SessionRequestsStore.setRange(d);
      const loading = loadVisible();
      paint();
      return loading;
    },
    setFilter(v){ if(!canRead()) return; SessionRequestsStore.setFilter(v); paint(); },
    // CEO only: the request type shown, over the list already read (nothing is read again).
    setKindFilter(v){ if(!canRead() || !sessionRequestsIsCeo(principalNow())) return; SessionRequestsStore.setKindFilter(v); paint(); },
    // Retry the read named by the Retry shown with its error (I4-F01): that read only, and only while it failed.
    retry(scope){
      if(!canAct() || ['list', 'detail', 'history'].indexOf(scope) === -1) return;
      if(!SessionRequestsStore.snapshot().errors[scope]) return;
      const loading = read(scope);
      paint();
      return loading;
    },
    // The request at `index` of the list as filtered and rendered.
    openDetail(index){
      if(!canAct()) return;
      const s = SessionRequestsStore.snapshot();
      const rows = sessionRequestsVisibleRows(s, principalNow());
      const r = Number.isInteger(index) && index >= 0 ? rows[index] : undefined;
      if(!r) return;
      SessionRequestsStore.openDetail(r.id);
      SessionRequestsStore.setFocus('detail');
      const loading = loadVisible();
      paint();
      return loading;
    },
    back(){ if(!canAct()) return; SessionRequestsStore.closeDetail(); SessionRequestsStore.setFocus('list'); paint(); },
    // `kind` (CR-01): the CEO's choice — a payment request (the default) or a reimbursement for an
    // employee; an Employee always creates their own reimbursement and names no one.
    openCreate(kind){
      if(!canAct()) return;
      const p = principalNow();
      const chosen = sessionRequestsIsCeo(p) && kind !== undefined ? kind : sessionRequestsCreateKind(p);
      if(sessionRequestsCreateKinds(p).indexOf(chosen) === -1) return;
      const key = payrollIdempotencyKey();
      if(key === null){ message('noCrypto'); return; }
      SessionRequestsStore.closeDetail();
      SessionRequestsStore.openForm('create', chosen, { employeeId: '', financialPost: '', category: '', description: '', amount: '', payee: '', documentDate: today() }, key);
      SessionRequestsStore.setFocus('form');
      paint();
    },
    openEdit(){
      if(!canAct()) return;
      const r = shown('update');
      if(!r) return;
      SessionRequestsStore.openForm('edit', r.kind, sessionRequestsValuesOf(r), null);
      SessionRequestsStore.setFocus('form');
      paint();
    },
    setDraft(name, value){ if(canRead()) SessionRequestsStore.setDraft(name, value); },
    cancelForm(){ if(!canAct()) return; SessionRequestsStore.closeForm(); SessionRequestsStore.setFocus(SessionRequestsStore.snapshot().detailId ? 'detail' : 'list'); paint(); },
    submitForm(){
      if(!canAct()) return;
      const s = SessionRequestsStore.snapshot();
      const f = s.form;
      if(!f) return;
      if(f.mode === 'create'){
        const p = principalNow();
        if(sessionRequestsCreateKinds(p).indexOf(f.kind) === -1) return;
        const token = SessionRequestsStore.beginMutation('create');
        const sending = FinanceRequestApi.create(f.kind, f.values, f.key, today(), sessionRequestsIsCeo(p))
          .then(function(out){ return settle(token, out, 'created', function(r){ return r.id; }); });
        paint();
        return sending;
      }
      const r = shown('update');
      if(!r) return;
      const token = SessionRequestsStore.beginMutation('update');
      const sending = FinanceRequestApi.update(r, f.values, today(), sessionRequestsIsEmployee(principalNow())).then(function(out){ return settle(token, out, 'updated'); });
      paint();
      return sending;
    },
    // The confirmation panel for an operation offered on the request shown. Submit and approve
    // confirm; reject and cancel ask for a reason; pay asks for the date and method; a
    // reimbursement's approval asks for its post, preselected with the stored one (CR-01).
    openAction(op){
      const r = canAct() && SESSION_REQUESTS_OPS.indexOf(op) !== -1 ? shown(op) : null;
      if(!r) return;
      let key = null;
      if(op === 'pay'){
        key = payrollIdempotencyKey();
        if(key === null){ message('noCrypto'); return; }
      }
      SessionRequestsStore.openAction(op, today(), key, op === 'approve' && r.kind === 'reimbursement' && r.financialPost !== null ? r.financialPost : '');
      SessionRequestsStore.setFocus('action');
      paint();
    },
    setActionField(name, value){ if(canRead()) SessionRequestsStore.setActionField(name, value); },
    cancelAction(){ if(!canAct()) return; SessionRequestsStore.closeAction(); SessionRequestsStore.setFocus('detail'); paint(); },
    confirmAction(){
      if(!canAct()) return;
      const a = SessionRequestsStore.snapshot().action;
      const r = a ? shown(a.op) : null;
      if(!r) return;
      const token = SessionRequestsStore.beginMutation(a.op);
      const call = a.op === 'submit' ? FinanceRequestApi.submit(r)
        : a.op === 'approve' ? FinanceRequestApi.approve(r, r.kind === 'reimbursement' ? a.financialPost : undefined)
        : a.op === 'reject' ? FinanceRequestApi.reject(r, a.reason)
        : a.op === 'cancel' ? FinanceRequestApi.cancel(r, a.reason)
        : FinanceRequestApi.pay(r, { paidOn: a.paidOn, paymentMethod: a.paymentMethod }, a.key, today());
      const sending = call.then(function(out){ return settle(token, out, a.op); });
      paint();
      return sending;
    }
  });
})();
