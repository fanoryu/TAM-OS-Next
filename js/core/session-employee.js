/* ============================================================
   SESSION EMPLOYEE DATA (AFI-4a1, AFI-4a2) — js/core/session-employee.js
   ------------------------------------------------------------
   The SESSION-mode Employee data, held in memory only and owned here — never in
   the LOCAL `State`, never in storage, never through the legacy repository. The
   server (EmployeeApi, js/core/employee-api.js) is the only source; this module
   only remembers its last decoded answers for the view.

   SessionEmployeeStore — the data:
     principalKey  the principal the data belongs to (user, role, binding)
     generation    bumped by clear(): logout, session loss, a different principal
     list, listArchived, listSeq, listStatus     CEO list (active / archived)
     listStale     AFI-4a2: a write succeeded (or may have); refetch when shown
     detail, detailId, detailSeq, detailStatus   CEO detail
     self, selfSeq, selfStatus                   Employee's own profile
     error         { scope, kind, retryAfter?, requestId? } of the last failed read
     mutation      AFI-4a2: { kind, status, error, fields } of the CEO's write —
                   kind create | update | archive; status idle | pending | error |
                   ambiguous; error { kind, retryAfter?, requestId? }; fields the
                   field names a validation failure named
     mutationSeq   AFI-4a2: the sequence of the write in flight
     form          AFI-4a2: the create / edit draft { mode, id, base, values } —
                   strings, memory only; never persisted, destroyed with the identity
     confirm       AFI-4a2: the archive confirmation { id }
     notice        AFI-4a2: a fixed message key for the view
     accountAction AFI-4a3: the open account-administration panel { kind, id, email } —
                   the login email typed for "Create login" lives only here (memory)

   A request takes a token { gen, kind, seq } from begin() / beginMutation(); its
   answer is applied only while token.gen is the current generation AND token.seq is
   still the latest for its kind. The generation drops everything an earlier identity
   asked for; the sequence drops a superseded request (the active list answering after
   the user switched to archived, an earlier detail). Reads have no side effect, so a
   superseded request is simply ignored rather than aborted. A write that was sent
   cannot be unsent: it is never aborted, and its late answer is dropped the same way.

   SessionWorkspace — the controller the view calls:
     ensureLoaded(principal)  CEO: the active list (again when stale); Employee: their
                              own profile. Idempotent: nothing is sent while pending.
     showArchived(bool)       CEO: the list with or without archived records
     openDetail(id) / back()  CEO detail
     retry()                  repeat the read that failed
   AFI-4a2, CEO only — for any other principal each one returns without a request:
     openCreate() / openEdit() / setDraft(name, value) / cancelForm() / submitForm()
     openArchive() / cancelArchive() / confirmArchive() / reloadRecord()
   AFI-4a3, CEO only, the same way: openAccountAction(kind) / setAccountEmail(value) /
     cancelAccountAction() / submitAccountAction() — kind is provision, reissue,
     disable or enable, and only an operation sessionAccountOperations() offers for
     the server projection (accountManageable + accountState) can be opened or sent.
   A write is sent once (a second submit while it is pending sends nothing). Only the
   strictly decoded server answer changes the data — nothing is optimistic. A 401
   (or a recovery that found the session gone) ends the session
   (AuthBoot.sessionLost()); a recovery that could not confirm it fails closed
   (AuthBoot.sessionUncertain()); a different principal destroys the data. An outcome
   that cannot be known (503, network, timeout, malformed success) is AMBIGUOUS: it is
   never resent — the list or record is read again so the server state is shown.
   Any other failure stays a workspace error while the identity stays authenticated.

   Classic shared global scope; top-level `const` bindings, not on window.
   ============================================================ */

const SESSION_EMPLOYEE_STATUS = Object.freeze({ IDLE: 'idle', LOADING: 'loading', READY: 'ready', ERROR: 'error' });
const SESSION_MUTATION_STATUS = Object.freeze({ IDLE: 'idle', PENDING: 'pending', ERROR: 'error', AMBIGUOUS: 'ambiguous' });
const SESSION_MUTATION_KINDS = Object.freeze(['create', 'update', 'archive', 'provision', 'reissue', 'disable', 'enable']);
// AFI-4a3: the account operations the server projection allows — accountManageable first, then
// accountState. Nothing else (role, membership, contact email, archive flag) is consulted: the
// server derives accountManageable, and its account routes re-check everything themselves.
const SESSION_ACCOUNT_KINDS = Object.freeze(['provision', 'reissue', 'disable', 'enable']);
const SESSION_ACCOUNT_OPERATIONS = Object.freeze({
  none: Object.freeze(['provision']),
  pending: Object.freeze(['reissue', 'disable']),
  active: Object.freeze(['disable']),
  disabled: Object.freeze(['enable'])
});
function sessionAccountOperations(detail){
  if(!detail || detail.accountManageable !== true) return [];
  return Object.prototype.hasOwnProperty.call(SESSION_ACCOUNT_OPERATIONS, detail.accountState) ? SESSION_ACCOUNT_OPERATIONS[detail.accountState] : [];
}
const SESSION_MUTATION_IDLE = Object.freeze({ kind: null, status: SESSION_MUTATION_STATUS.IDLE, error: null, fields: null });

const SessionEmployeeStore = (function(){
  let principalKey = null;
  let generation = 0;
  let list = null, listArchived = false, listSeq = 0, listStatus = SESSION_EMPLOYEE_STATUS.IDLE, listStale = false;
  let detail = null, detailId = null, detailSeq = 0, detailStatus = SESSION_EMPLOYEE_STATUS.IDLE;
  let self = null, selfSeq = 0, selfStatus = SESSION_EMPLOYEE_STATUS.IDLE;
  let error = null;
  let mutation = SESSION_MUTATION_IDLE, mutationSeq = 0;
  let form = null, confirm = null, notice = null, focus = null;
  let accountAction = null;

  function keyOf(p){
    return p ? [p.id, p.principalType, p.employeeId || ''].join('|') : null;
  }
  function seqOf(kind){
    return kind === 'list' ? listSeq : kind === 'detail' ? detailSeq : kind === 'self' ? selfSeq : kind === 'mutation' ? mutationSeq : -1;
  }
  function isLive(token){ return !!token && token.gen === generation; }
  function isCurrent(token){
    return isLive(token) && token.seq === seqOf(token.kind);
  }
  function clear(){
    list = null; listArchived = false; listStatus = SESSION_EMPLOYEE_STATUS.IDLE; listStale = false;
    detail = null; detailId = null; detailStatus = SESSION_EMPLOYEE_STATUS.IDLE;
    self = null; selfStatus = SESSION_EMPLOYEE_STATUS.IDLE;
    error = null;
    mutation = SESSION_MUTATION_IDLE; mutationSeq++;
    form = null; confirm = null; notice = null; focus = null; accountAction = null;
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
    // A request token; the new request supersedes any earlier one of its kind.
    begin(kind, arg){
      if(kind === 'list'){
        listSeq++; listArchived = arg === true; list = null; listStatus = SESSION_EMPLOYEE_STATUS.LOADING; listStale = false; clearError('list');
        return Object.freeze({ gen: generation, kind: kind, seq: listSeq });
      }
      if(kind === 'detail'){
        detailSeq++; detailId = arg; detail = null; detailStatus = SESSION_EMPLOYEE_STATUS.LOADING; clearError('detail');
        return Object.freeze({ gen: generation, kind: kind, seq: detailSeq });
      }
      if(kind === 'self'){
        selfSeq++; self = null; selfStatus = SESSION_EMPLOYEE_STATUS.LOADING; clearError('self');
        return Object.freeze({ gen: generation, kind: kind, seq: selfSeq });
      }
      throw new Error('unknown session employee request kind');
    },
    isLive: isLive,
    isCurrent: isCurrent,
    applyList(token, items){
      if(!isCurrent(token) || token.kind !== 'list') return false;
      list = items; listStatus = SESSION_EMPLOYEE_STATUS.READY;
      return true;
    },
    applyDetail(token, item){
      if(!isCurrent(token) || token.kind !== 'detail') return false;
      detail = item; detailStatus = SESSION_EMPLOYEE_STATUS.READY;
      return true;
    },
    applySelf(token, item){
      if(!isCurrent(token) || token.kind !== 'self') return false;
      self = item; selfStatus = SESSION_EMPLOYEE_STATUS.READY;
      return true;
    },
    applyError(token, failed){
      if(!isCurrent(token)) return false;
      if(token.kind === 'list'){ list = null; listStatus = SESSION_EMPLOYEE_STATUS.ERROR; }
      else if(token.kind === 'detail'){ detail = null; detailStatus = SESSION_EMPLOYEE_STATUS.ERROR; }
      else { self = null; selfStatus = SESSION_EMPLOYEE_STATUS.ERROR; }
      error = Object.freeze(Object.assign({ scope: token.kind }, failure(failed)));
      return true;
    },
    // Leaves the detail: a pending detail answer is dropped (its sequence is superseded),
    // and the edit draft and archive confirmation of that record go with it.
    closeDetail(){
      detailSeq++; detail = null; detailId = null; detailStatus = SESSION_EMPLOYEE_STATUS.IDLE; clearError('detail');
      if(form && form.mode === 'edit') form = null;
      confirm = null;
      accountAction = null;
    },

    /* ---------- AFI-4a2: the CEO's writes ---------- */
    // A draft starting from `base` (strings). A new form supersedes any earlier write state.
    openForm(mode, id, base){
      mutationSeq++; mutation = SESSION_MUTATION_IDLE; notice = null; confirm = null;
      form = { mode: mode, id: id, base: Object.freeze(Object.assign({}, base)), values: Object.assign({}, base) };
    },
    setDraft(name, value){
      if(!form || EMPLOYEE_WRITABLE_FIELDS.indexOf(name) === -1 || typeof value !== 'string') return false;
      form.values[name] = value;
      return true;
    },
    closeForm(){ mutationSeq++; mutation = SESSION_MUTATION_IDLE; form = null; },
    openConfirm(id){ mutationSeq++; mutation = SESSION_MUTATION_IDLE; notice = null; confirm = Object.freeze({ id: id }); },
    closeConfirm(){ mutationSeq++; mutation = SESSION_MUTATION_IDLE; confirm = null; },
    resetMutation(){ mutation = SESSION_MUTATION_IDLE; notice = null; },
    // AFI-4a3: one account panel at a time, for one record; the email draft starts empty.
    openAccountAction(kind, id){
      mutationSeq++; mutation = SESSION_MUTATION_IDLE; notice = null; confirm = null;
      accountAction = { kind: kind, id: id, email: '' };
    },
    setAccountEmail(value){
      if(!accountAction || accountAction.kind !== 'provision' || typeof value !== 'string') return false;
      accountAction.email = value;
      return true;
    },
    closeAccountAction(){ mutationSeq++; mutation = SESSION_MUTATION_IDLE; accountAction = null; },
    beginMutation(kind){
      if(SESSION_MUTATION_KINDS.indexOf(kind) === -1) throw new Error('unknown session employee mutation kind');
      mutationSeq++;
      mutation = Object.freeze({ kind: kind, status: SESSION_MUTATION_STATUS.PENDING, error: null, fields: null });
      notice = null;
      return Object.freeze({ gen: generation, kind: 'mutation', seq: mutationSeq });
    },
    // A write that failed definitely (ERROR) or whose outcome is unknown (AMBIGUOUS).
    failMutation(token, status, failed){
      if(!isCurrent(token) || token.kind !== 'mutation') return false;
      const kind = mutation.kind;
      mutation = Object.freeze({ kind: kind, status: status, error: failure(failed), fields: failed.fields ? Object.freeze(failed.fields.slice()) : null });
      if(status === SESSION_MUTATION_STATUS.AMBIGUOUS && kind === 'archive') confirm = null;
      // An unconfirmed account write closes its panel: the record read again decides what is offered.
      if(status === SESSION_MUTATION_STATUS.AMBIGUOUS && SESSION_ACCOUNT_KINDS.indexOf(kind) !== -1) accountAction = null;
      return true;
    },
    // A request refused before transport: nothing was sent.
    refuseMutation(kind, fields){
      mutationSeq++;
      mutation = Object.freeze({ kind: kind, status: SESSION_MUTATION_STATUS.ERROR, error: Object.freeze({ kind: 'VALIDATION' }), fields: Object.freeze(fields.slice()) });
      notice = null;
    },
    // A decoded server record from create / update: it becomes the detail; the list is stale.
    applySaved(token, item, noticeKey){
      if(!isCurrent(token) || token.kind !== 'mutation') return false;
      detailSeq++; detail = item; detailId = item.id; detailStatus = SESSION_EMPLOYEE_STATUS.READY; clearError('detail');
      form = null; confirm = null; accountAction = null; mutation = SESSION_MUTATION_IDLE; listStale = true; notice = noticeKey;
      return true;
    },
    // A decoded archived record: the detail and its form close; the list is stale.
    applyArchived(token){
      if(!isCurrent(token) || token.kind !== 'mutation') return false;
      detailSeq++; detail = null; detailId = null; detailStatus = SESSION_EMPLOYEE_STATUS.IDLE; clearError('detail');
      form = null; confirm = null; accountAction = null; mutation = SESSION_MUTATION_IDLE; listStale = true; notice = 'archived';
      return true;
    },
    markListStale(){ listStale = true; },
    setNotice(key){ notice = key; },
    // A focus hint for the next render, taken once by the view.
    setFocus(hint){ focus = hint; },
    takeFocus(){ const f = focus; focus = null; return f; },

    snapshot(){
      return Object.freeze({
        principalKey: principalKey, generation: generation,
        list: list, listArchived: listArchived, listStatus: listStatus, listStale: listStale,
        detail: detail, detailId: detailId, detailStatus: detailStatus,
        self: self, selfStatus: selfStatus, error: error,
        mutation: mutation, form: formView(), confirm: confirm, notice: notice,
        accountAction: accountAction ? Object.freeze(Object.assign({}, accountAction)) : null
      });
    }
  });
})();

const SessionWorkspace = (function(){
  function paint(){ if(typeof render === 'function') render(); }

  // Sends one read under a fresh token and applies its answer only if it is still current.
  async function run(kind, arg, call){
    const token = SessionEmployeeStore.begin(kind, arg);
    const out = await call();
    if(!SessionEmployeeStore.isCurrent(token)) return;
    if(!out.ok && out.kind === API_RESULT_KINDS.UNAUTHENTICATED){
      AuthBoot.sessionLost();          // clears identity, CSRF and this store; renders SIGNED_OUT
      return;
    }
    let applied;
    if(!out.ok) applied = SessionEmployeeStore.applyError(token, out);
    else if(kind === 'list') applied = SessionEmployeeStore.applyList(token, out.data);
    else if(kind === 'detail') applied = SessionEmployeeStore.applyDetail(token, out.data);
    else applied = SessionEmployeeStore.applySelf(token, out.data);
    if(applied) paint();
  }

  function principalNow(){
    const a = AuthBoot.snapshot();
    return a.state === AUTH_STATES.AUTHENTICATED ? a.principal : null;
  }
  function ceoPrincipal(p){ return !!p && p.principalType === PRINCIPAL_TYPES.CEO; }
  function employeePrincipal(p){ return !!p && p.principalType === PRINCIPAL_TYPES.EMPLOYEE; }

  function loadList(archived){ return run('list', archived, () => EmployeeApi.list({ archived: archived })); }
  function loadSelf(p){ return run('self', null, () => EmployeeApi.getSelf(p)); }
  function loadDetail(id){ return run('detail', id, () => EmployeeApi.get(id)); }

  /* ---------- AFI-4a2: writes (CEO only) ---------- */
  // Outcomes that cannot be known: the write may or may not have been applied.
  const AMBIGUOUS = Object.freeze([API_RESULT_KINDS.UNAVAILABLE, EMPLOYEE_API_INVALID]);

  function pending(){ return SessionEmployeeStore.snapshot().mutation.status === SESSION_MUTATION_STATUS.PENDING; }
  // A CEO, authenticated, with no write in flight. Anything else acts on nothing.
  function canAct(){ return ceoPrincipal(principalNow()) && !pending(); }

  // A draft's starting values: the decoded server record as strings ('' for null).
  function formValues(d){
    const out = {};
    EMPLOYEE_WRITABLE_FIELDS.forEach(function(k){ out[k] = (d && d[k] !== null && d[k] !== undefined) ? String(d[k]) : ''; });
    if(!d) out.employmentStatus = 'Active';
    return out;
  }
  function focusFirst(fields){
    const first = EMPLOYEE_WRITABLE_FIELDS.filter((k) => (fields || []).indexOf(k) !== -1)[0];
    if(first) SessionEmployeeStore.setFocus('field:' + first);
    else SessionEmployeeStore.setFocus((fields || []).indexOf('email') !== -1 && SessionEmployeeStore.snapshot().accountAction ? 'account-email' : 'message');
  }
  function refuse(kind, fields){
    SessionEmployeeStore.refuseMutation(kind, fields);
    focusFirst(fields);
    paint();
  }

  const ACCOUNT_NOTICES = Object.freeze({ provision: 'provisioned', reissue: 'reissued', disable: 'disabled', enable: 'enabled' });
  const ACCOUNT_CALLS = Object.freeze({
    provision: (id, a) => EmployeeApi.provisionAccount(id, a.email),
    reissue: (id) => EmployeeApi.reissueActivation(id),
    disable: (id) => EmployeeApi.disableAccount(id),
    enable: (id) => EmployeeApi.enableAccount(id)
  });

  // Applies a write's outcome. Late (another identity) and superseded answers are dropped.
  function settle(token, out){
    if(out.recovery === 'unavailable'){ AuthBoot.sessionUncertain(); return; }   // identity already cleared: fail closed
    if(!SessionEmployeeStore.isLive(token)) return;
    if(out.recovery === 'principal_changed'){ SessionEmployeeStore.clear(); paint(); return; }
    if(out.recovery === 'signed_out' || (!out.ok && out.kind === API_RESULT_KINDS.UNAUTHENTICATED)){ AuthBoot.sessionLost(); return; }
    if(!SessionEmployeeStore.isCurrent(token)) return;
    const s = SessionEmployeeStore.snapshot();
    const kind = s.mutation.kind;
    if(out.ok){
      if(kind === 'archive'){
        SessionEmployeeStore.applyArchived(token);
        loadList(s.listArchived);
      } else if(SESSION_ACCOUNT_KINDS.indexOf(kind) !== -1){
        // AFI-4a3: the decoded record (already confirmed by EmployeeApi) is the new detail.
        SessionEmployeeStore.applySaved(token, out.data, kind === 'enable' && out.data.accountState === 'pending' ? 'enabled_pending' : ACCOUNT_NOTICES[kind]);
      } else {
        SessionEmployeeStore.applySaved(token, out.data, kind === 'create' ? 'created' : 'saved');
      }
      paint();
      return;
    }
    if(AMBIGUOUS.indexOf(out.kind) !== -1){
      // Never resent: read the server state again instead.
      SessionEmployeeStore.failMutation(token, SESSION_MUTATION_STATUS.AMBIGUOUS, out);
      SessionEmployeeStore.markListStale();
      SessionEmployeeStore.setFocus('message');
      if(kind === 'create') loadList(s.listArchived);
      else if(s.detailId) loadDetail(s.detailId);
      paint();
      return;
    }
    SessionEmployeeStore.failMutation(token, SESSION_MUTATION_STATUS.ERROR, out);
    if(out.kind === API_RESULT_KINDS.NOT_FOUND && kind !== 'create'){
      SessionEmployeeStore.closeDetail();
      SessionEmployeeStore.setFocus('message');
      loadList(s.listArchived);
    } else if(out.kind === API_RESULT_KINDS.VALIDATION){
      focusFirst(out.fields);
    } else {
      SessionEmployeeStore.setFocus('message');
    }
    paint();
  }

  return Object.freeze({
    // Called while rendering the authenticated view: starts the first read once, and
    // reads the list again when it is shown after a write.
    ensureLoaded(principal){
      if(!principal) return;
      SessionEmployeeStore.bindPrincipal(principal);
      const s = SessionEmployeeStore.snapshot();
      if(ceoPrincipal(principal)){
        if(s.listStatus === SESSION_EMPLOYEE_STATUS.IDLE || (s.listStale && !s.detailId && s.listStatus !== SESSION_EMPLOYEE_STATUS.LOADING)) loadList(s.listArchived);
      }
      else if(employeePrincipal(principal) && s.selfStatus === SESSION_EMPLOYEE_STATUS.IDLE) loadSelf(principal);
    },
    showArchived(archived){
      const p = principalNow();
      if(!ceoPrincipal(p) || pending()) return;
      const s = SessionEmployeeStore.snapshot();
      if(s.listArchived === (archived === true) && s.listStatus !== SESSION_EMPLOYEE_STATUS.ERROR && !s.listStale) return;
      SessionEmployeeStore.closeDetail();
      const loading = loadList(archived === true);
      paint();
      return loading;
    },
    openDetail(id){
      const p = principalNow();
      if(!ceoPrincipal(p) || typeof id !== 'string' || pending()) return;
      const s = SessionEmployeeStore.snapshot();
      if(s.detailId === id && s.detailStatus === SESSION_EMPLOYEE_STATUS.LOADING) return;
      if(s.form) SessionEmployeeStore.closeForm();         // leaving the list leaves its create draft
      SessionEmployeeStore.resetMutation();
      const loading = loadDetail(id);
      paint();
      return loading;
    },
    back(){
      if(pending()) return;
      SessionEmployeeStore.closeDetail();
      SessionEmployeeStore.resetMutation();
      paint();
    },
    retry(){
      const p = principalNow();
      const s = SessionEmployeeStore.snapshot();
      if(!s.error || !p || pending()) return;
      let loading;
      if(s.error.scope === 'list' && ceoPrincipal(p)) loading = loadList(s.listArchived);
      else if(s.error.scope === 'detail' && ceoPrincipal(p) && s.detailId) loading = loadDetail(s.detailId);
      else if(s.error.scope === 'self' && employeePrincipal(p)) loading = loadSelf(p);
      paint();
      return loading;
    },

    /* ---------- AFI-4a2 ---------- */
    openCreate(){
      if(!canAct()) return;
      const s = SessionEmployeeStore.snapshot();
      if(s.detailId || s.form) return;
      SessionEmployeeStore.openForm('create', null, formValues(null));
      SessionEmployeeStore.setFocus('form');
      paint();
    },
    openEdit(){
      if(!canAct()) return;
      const s = SessionEmployeeStore.snapshot();
      const d = s.detail;
      if(s.detailStatus !== SESSION_EMPLOYEE_STATUS.READY || !d || d.archived || s.form || s.confirm || s.accountAction) return;
      SessionEmployeeStore.openForm('edit', d.id, formValues(d));
      SessionEmployeeStore.setFocus('form');
      paint();
    },
    // Keeps the draft in memory as it is typed; no render, so focus and caret stay put.
    setDraft(name, value){
      if(!ceoPrincipal(principalNow()) || pending()) return;
      SessionEmployeeStore.setDraft(name, value);
    },
    cancelForm(){
      if(!canAct() || !SessionEmployeeStore.snapshot().form) return;
      SessionEmployeeStore.closeForm();
      paint();
    },
    // Create: every profile field. Edit: only the fields changed from the record the form
    // started from, against the version of the record now held — nothing changed sends nothing.
    async submitForm(){
      if(!canAct()) return;
      const s = SessionEmployeeStore.snapshot();
      const f = s.form;
      if(!f) return;
      if(f.mode === 'create'){
        const fields = Object.assign({}, f.values);
        const prepared = EmployeeRequests.create(fields);
        if(!prepared.ok) return refuse('create', prepared.fields);
        const token = SessionEmployeeStore.beginMutation('create');
        paint();
        return settle(token, await EmployeeApi.create(fields));
      }
      const d = s.detail;
      if(s.detailStatus !== SESSION_EMPLOYEE_STATUS.READY || !d || d.id !== f.id || d.archived) return;
      const changed = {};
      EMPLOYEE_WRITABLE_FIELDS.forEach(function(k){ if(f.values[k] !== f.base[k]) changed[k] = f.values[k]; });
      if(!Object.keys(changed).length){
        SessionEmployeeStore.resetMutation();
        SessionEmployeeStore.setNotice('unchanged');
        SessionEmployeeStore.setFocus('message');
        paint();
        return;
      }
      const prepared = EmployeeRequests.update(d.id, d.version, changed);
      if(!prepared.ok) return refuse('update', prepared.fields);
      const token = SessionEmployeeStore.beginMutation('update');
      paint();
      return settle(token, await EmployeeApi.update(d.id, d.version, changed));
    },
    // After a conflict (or to check an unconfirmed write): the record again, from the server.
    // An open draft is kept; a later Save uses the version read now.
    reloadRecord(){
      if(!canAct()) return;
      const s = SessionEmployeeStore.snapshot();
      if(!s.detailId) return;
      if(s.accountAction) SessionEmployeeStore.closeAccountAction();      // the record read again decides what is offered
      SessionEmployeeStore.resetMutation();
      if(s.form) SessionEmployeeStore.setNotice('reloaded');
      const loading = loadDetail(s.detailId);
      paint();
      return loading;
    },
    // Archive asks first: this only opens the confirmation; nothing is sent.
    openArchive(){
      if(!canAct()) return;
      const s = SessionEmployeeStore.snapshot();
      const d = s.detail;
      if(s.detailStatus !== SESSION_EMPLOYEE_STATUS.READY || !d || d.archived || s.form || s.accountAction) return;
      SessionEmployeeStore.openConfirm(d.id);
      SessionEmployeeStore.setFocus('confirm');
      paint();
    },
    cancelArchive(){
      if(!canAct() || !SessionEmployeeStore.snapshot().confirm) return;
      SessionEmployeeStore.closeConfirm();
      paint();
    },
    async confirmArchive(){
      if(!canAct()) return;
      const s = SessionEmployeeStore.snapshot();
      const d = s.detail;
      if(!s.confirm || s.detailStatus !== SESSION_EMPLOYEE_STATUS.READY || !d || d.id !== s.confirm.id || d.archived) return;
      const token = SessionEmployeeStore.beginMutation('archive');
      paint();
      return settle(token, await EmployeeApi.archive(d.id, d.version));
    },

    /* ---------- AFI-4a3: account administration (CEO only) ---------- */
    // Opens the panel of an operation the server projection offers for the record shown; nothing is sent.
    openAccountAction(kind){
      if(!canAct()) return;
      const s = SessionEmployeeStore.snapshot();
      const d = s.detail;
      if(s.detailStatus !== SESSION_EMPLOYEE_STATUS.READY || !d || s.form || s.confirm || s.accountAction) return;
      if(sessionAccountOperations(d).indexOf(kind) === -1) return;
      SessionEmployeeStore.openAccountAction(kind, d.id);
      SessionEmployeeStore.setFocus('account');
      paint();
    },
    // The login email as it is typed; memory only, no render.
    setAccountEmail(value){
      if(!ceoPrincipal(principalNow()) || pending()) return;
      SessionEmployeeStore.setAccountEmail(value);
    },
    cancelAccountAction(){
      if(!canAct() || !SessionEmployeeStore.snapshot().accountAction) return;
      SessionEmployeeStore.closeAccountAction();
      paint();
    },
    // Sends the open operation once, for the record it was opened on, if the projection still offers it.
    async submitAccountAction(){
      if(!canAct()) return;
      const s = SessionEmployeeStore.snapshot();
      const a = s.accountAction;
      const d = s.detail;
      if(!a || s.detailStatus !== SESSION_EMPLOYEE_STATUS.READY || !d || d.id !== a.id) return;
      if(sessionAccountOperations(d).indexOf(a.kind) === -1){ SessionEmployeeStore.closeAccountAction(); paint(); return; }
      if(a.kind === 'provision'){
        const prepared = EmployeeRequests.provisionAccount(d.id, a.email);
        if(!prepared.ok) return refuse('provision', prepared.fields);
      }
      const token = SessionEmployeeStore.beginMutation(a.kind);
      paint();
      return settle(token, await ACCOUNT_CALLS[a.kind](d.id, a));
    }
  });
})();
