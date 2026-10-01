/* ============================================================
   SESSION EMPLOYEE DATA (AFI-4a1) — js/core/session-employee.js
   ------------------------------------------------------------
   The SESSION-mode Employee data, held in memory only and owned here — never in
   the LOCAL `State`, never in storage, never through the legacy repository. The
   server (EmployeeApi, js/core/employee-api.js) is the only source; this module
   only remembers its last decoded answers for the view.

   SessionEmployeeStore — the data:
     principalKey  the principal the data belongs to (user, role, binding)
     generation    bumped by clear(): logout, session loss, a different principal
     list, listArchived, listSeq, listStatus     CEO list (active / archived)
     detail, detailId, detailSeq, detailStatus   CEO detail
     self, selfSeq, selfStatus                   Employee's own profile
     error         { scope, kind, retryAfter?, requestId? } of the last failure

   A request takes a token { gen, kind, seq } from begin(); its answer is applied
   only while token.gen is the current generation AND token.seq is still the latest
   for its kind. The generation drops everything an earlier identity asked for; the
   sequence drops a superseded request (the active list answering after the user
   switched to archived, an earlier detail). Reads have no side effect, so a
   superseded request is simply ignored rather than aborted.

   SessionWorkspace — the read-only controller the view calls:
     ensureLoaded(principal)  CEO: the active list; Employee: their own profile.
                              Idempotent: nothing is sent while one is pending.
     showArchived(bool)       CEO: the list with or without archived records
     openDetail(id) / back()  CEO detail
     retry()                  repeat the request that failed
   A 401 on a current request ends the session (AuthBoot.sessionLost()); any other
   failure stays a workspace error while the identity stays authenticated. AFI-4a2
   adds its writes here, invalidating and refetching — authority never moves.

   Classic shared global scope; top-level `const` bindings, not on window.
   ============================================================ */

const SESSION_EMPLOYEE_STATUS = Object.freeze({ IDLE: 'idle', LOADING: 'loading', READY: 'ready', ERROR: 'error' });

const SessionEmployeeStore = (function(){
  let principalKey = null;
  let generation = 0;
  let list = null, listArchived = false, listSeq = 0, listStatus = SESSION_EMPLOYEE_STATUS.IDLE;
  let detail = null, detailId = null, detailSeq = 0, detailStatus = SESSION_EMPLOYEE_STATUS.IDLE;
  let self = null, selfSeq = 0, selfStatus = SESSION_EMPLOYEE_STATUS.IDLE;
  let error = null;

  function keyOf(p){
    return p ? [p.id, p.principalType, p.employeeId || ''].join('|') : null;
  }
  function seqOf(kind){
    return kind === 'list' ? listSeq : kind === 'detail' ? detailSeq : kind === 'self' ? selfSeq : -1;
  }
  function isCurrent(token){
    return !!token && token.gen === generation && token.seq === seqOf(token.kind);
  }
  function clear(){
    list = null; listArchived = false; listStatus = SESSION_EMPLOYEE_STATUS.IDLE;
    detail = null; detailId = null; detailStatus = SESSION_EMPLOYEE_STATUS.IDLE;
    self = null; selfStatus = SESSION_EMPLOYEE_STATUS.IDLE;
    error = null;
    principalKey = null;
    generation++;
  }
  function clearError(scope){ if(error && error.scope === scope) error = null; }

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
        listSeq++; listArchived = arg === true; list = null; listStatus = SESSION_EMPLOYEE_STATUS.LOADING; clearError('list');
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
    applyError(token, failure){
      if(!isCurrent(token)) return false;
      if(token.kind === 'list'){ list = null; listStatus = SESSION_EMPLOYEE_STATUS.ERROR; }
      else if(token.kind === 'detail'){ detail = null; detailStatus = SESSION_EMPLOYEE_STATUS.ERROR; }
      else { self = null; selfStatus = SESSION_EMPLOYEE_STATUS.ERROR; }
      const e = { scope: token.kind, kind: failure.kind };
      if(failure.retryAfter !== undefined) e.retryAfter = failure.retryAfter;
      if(failure.requestId) e.requestId = failure.requestId;
      error = Object.freeze(e);
      return true;
    },
    // Leaves the detail: a pending detail answer is dropped (its sequence is superseded).
    closeDetail(){
      detailSeq++; detail = null; detailId = null; detailStatus = SESSION_EMPLOYEE_STATUS.IDLE; clearError('detail');
    },
    snapshot(){
      return Object.freeze({
        principalKey: principalKey, generation: generation,
        list: list, listArchived: listArchived, listStatus: listStatus,
        detail: detail, detailId: detailId, detailStatus: detailStatus,
        self: self, selfStatus: selfStatus, error: error
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

  return Object.freeze({
    // Called while rendering the authenticated view: starts the first read once.
    ensureLoaded(principal){
      if(!principal) return;
      SessionEmployeeStore.bindPrincipal(principal);
      const s = SessionEmployeeStore.snapshot();
      if(ceoPrincipal(principal) && s.listStatus === SESSION_EMPLOYEE_STATUS.IDLE) loadList(false);
      else if(employeePrincipal(principal) && s.selfStatus === SESSION_EMPLOYEE_STATUS.IDLE) loadSelf(principal);
    },
    showArchived(archived){
      const p = principalNow();
      if(!ceoPrincipal(p)) return;
      const s = SessionEmployeeStore.snapshot();
      if(s.listArchived === (archived === true) && s.listStatus !== SESSION_EMPLOYEE_STATUS.ERROR) return;
      SessionEmployeeStore.closeDetail();
      const pending = loadList(archived === true);
      paint();
      return pending;
    },
    openDetail(id){
      const p = principalNow();
      if(!ceoPrincipal(p) || typeof id !== 'string') return;
      const s = SessionEmployeeStore.snapshot();
      if(s.detailId === id && s.detailStatus === SESSION_EMPLOYEE_STATUS.LOADING) return;
      const pending = loadDetail(id);
      paint();
      return pending;
    },
    back(){
      SessionEmployeeStore.closeDetail();
      paint();
    },
    retry(){
      const p = principalNow();
      const s = SessionEmployeeStore.snapshot();
      if(!s.error || !p) return;
      let pending;
      if(s.error.scope === 'list' && ceoPrincipal(p)) pending = loadList(s.listArchived);
      else if(s.error.scope === 'detail' && ceoPrincipal(p) && s.detailId) pending = loadDetail(s.detailId);
      else if(s.error.scope === 'self' && employeePrincipal(p)) pending = loadSelf(p);
      paint();
      return pending;
    }
  });
})();
