/* ============================================================
   SESSION AUDIT DATA (AFI-4g) — js/core/session-audit.js
   ------------------------------------------------------------
   The SESSION-mode Audit section of the authenticated workspace — CEO only (D-AFI4g-3 = A) — over
   BF-4g (PR #56): one company-calendar month of the business audit trail, one event in full, and
   the history of the record an event names. Read only: nothing here writes, corrects, deletes or
   exports anything, and the authentication log is never read. Held in memory only and owned here
   — never in the LOCAL `State`, never in storage, the URL or history, never through a LOCAL
   module (the LOCAL activity log, js/ui/activity-log.js, is another thing and is never reached).
   The server (AuditApi, js/core/audit-api.js) is the only source; this module only remembers its
   last decoded answers for the view.

   SessionAuditStore — the data:
     principalKey  the principal the data belongs to (user, role, binding)
     generation    bumped by clear(): logout, session loss, a different principal
     open          the Audit section is shown (the Employees section stays the default)
     month         the month shown, "YYYY-MM": the current Asia/Jakarta month when the section first
                   opens (D-AFI4g-4 = A), then Previous / Next / the month field. Memory only.
     list, listMonth, listSeq, listStatus   the month's events
     record        { entity, entityId } whose history is shown — only ever taken from a decoded
                   event the CEO opened (D-AFI4g-5 = A); null on the month list
     history, historySeq, historyStatus     that record's events
     selected      { event, from } — the event shown in full and the list it was opened from
                   ('month' | 'record')
     error         { scope, kind, retryAfter?, requestId? } of the last failed list / record read
     notice, focus a fixed message key / a focus hint for the view

   A request takes a token { gen, kind, seq }; its answer is applied only while token.gen is the
   current generation AND token.seq is still the latest of its kind (list, record): a superseded
   read — another month, another record, a section closed or opened again — is ignored.

   SessionAudit — the controller the view calls. CEO only: for any other principal every entry
   point is a no-op and no audit request is ever made; the server decides anyway (an Employee is
   403 before any lookup). A 401 ends the session (AuthBoot.sessionLost()); a different principal
   destroys the data. Nothing is retried automatically: Retry is a deliberate click. An empty
   record history is shown in one neutral wording whatever the reason (D-BF4g-4 = A): it never
   says whether the record exists, existed or was deleted. No identity join (D-AFI4g-7 = A).

   Classic shared global scope; top-level `const` bindings, not on window.
   ============================================================ */

const SESSION_AUDIT_STATUS = Object.freeze({ IDLE: 'idle', LOADING: 'loading', READY: 'ready', ERROR: 'error' });

function sessionAuditIsCeo(p){ return !!p && p.principalType === PRINCIPAL_TYPES.CEO; }

// The month the section opens on: the company-calendar month of `now` (injectable; a Date by default).
function sessionAuditCurrentMonth(now){
  return auditJakartaMonth(now || new Date());
}

const SessionAuditStore = (function(){
  let principalKey = null;
  let generation = 0;
  let open = false, month = null;
  let list = null, listMonth = null, listSeq = 0, listStatus = SESSION_AUDIT_STATUS.IDLE;
  let record = null, history = null, historySeq = 0, historyStatus = SESSION_AUDIT_STATUS.IDLE;
  let selected = null, error = null, notice = null, focus = null;

  function keyOf(p){
    return p ? [p.id, p.principalType, p.employeeId || ''].join('|') : null;
  }
  function seqOf(kind){
    return kind === 'list' ? listSeq : kind === 'record' ? historySeq : -1;
  }
  function isCurrent(token){
    return !!token && token.gen === generation && token.seq === seqOf(token.kind);
  }
  function clearError(scope){ if(error && error.scope === scope) error = null; }
  function dropList(){ listSeq++; list = null; listMonth = null; listStatus = SESSION_AUDIT_STATUS.IDLE; clearError('list'); }
  function dropRecord(){
    historySeq++; record = null; history = null; historyStatus = SESSION_AUDIT_STATUS.IDLE; clearError('record');
    if(selected && selected.from === 'record') selected = null;
  }
  function clear(){
    open = false; month = null;
    dropList(); dropRecord();
    selected = null; error = null; notice = null; focus = null;
    principalKey = null;
    generation++;
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
    // Shows or leaves the section. The month is chosen once, when it is first shown; leaving the
    // section forgets what was read, so returning reads the month again.
    setOpen(value, initialMonth){
      const next = value === true;
      if(open !== next){ dropList(); dropRecord(); selected = null; notice = null; }
      open = next;
      if(open && month === null) month = initialMonth;
    },
    setMonth(key){
      month = key; notice = null; selected = null;
      dropList(); dropRecord();
    },
    // A request token; the new request supersedes any earlier one of its kind.
    begin(kind, arg){
      if(kind === 'list'){
        listSeq++; listMonth = arg; list = null; listStatus = SESSION_AUDIT_STATUS.LOADING; clearError('list');
        return Object.freeze({ gen: generation, kind: kind, seq: listSeq });
      }
      if(kind === 'record'){
        historySeq++; history = null; historyStatus = SESSION_AUDIT_STATUS.LOADING; clearError('record');
        return Object.freeze({ gen: generation, kind: kind, seq: historySeq });
      }
      throw new Error('unknown session audit request kind');
    },
    isCurrent: isCurrent,
    applyList(token, items){
      if(!isCurrent(token) || token.kind !== 'list') return false;
      list = items; listStatus = SESSION_AUDIT_STATUS.READY;
      return true;
    },
    applyHistory(token, items){
      if(!isCurrent(token) || token.kind !== 'record' || !record) return false;
      history = items; historyStatus = SESSION_AUDIT_STATUS.READY;
      return true;
    },
    applyError(token, failed){
      if(!isCurrent(token)) return false;
      if(token.kind === 'list'){ list = null; listStatus = SESSION_AUDIT_STATUS.ERROR; }
      else { history = null; historyStatus = SESSION_AUDIT_STATUS.ERROR; }
      const e = { scope: token.kind, kind: failed.kind };
      if(failed.retryAfter !== undefined) e.retryAfter = failed.retryAfter;
      if(failed.requestId) e.requestId = failed.requestId;
      error = Object.freeze(e);
      return true;
    },
    // The record whose history is shown: a decoded event's own entity and id.
    openRecord(event){
      dropRecord();
      record = Object.freeze({ entity: event.entity, entityId: event.entityId });
      selected = null;
    },
    closeRecord(){ dropRecord(); },
    select(event, from){ selected = Object.freeze({ event: event, from: from }); },
    unselect(){ selected = null; },
    setNotice(key){ notice = key; },
    setFocus(hint){ focus = hint; },
    takeFocus(){ const f = focus; focus = null; return f; },

    snapshot(){
      return Object.freeze({
        principalKey: principalKey, generation: generation, open: open, month: month,
        list: list, listMonth: listMonth, listStatus: listStatus,
        record: record, history: history, historyStatus: historyStatus,
        selected: selected, error: error, notice: notice
      });
    }
  });
})();

const SessionAudit = (function(){
  function paint(){ if(typeof render === 'function') render(); }

  function principalNow(){
    const a = AuthBoot.snapshot();
    return a.state === AUTH_STATES.AUTHENTICATED ? a.principal : null;
  }
  // The authenticated CEO, the section shown.
  function canRead(){ return sessionAuditIsCeo(principalNow()) && SessionAuditStore.snapshot().open; }

  // Sends one read under a fresh token and applies its answer only if it is still current.
  async function run(kind, arg, call){
    const token = SessionAuditStore.begin(kind, arg);
    const out = await call();
    if(!SessionAuditStore.isCurrent(token)) return;
    if(!out.ok && out.kind === API_RESULT_KINDS.UNAUTHENTICATED){
      AuthBoot.sessionLost();          // clears identity, CSRF and this store; renders SIGNED_OUT
      return;
    }
    let applied;
    if(!out.ok) applied = SessionAuditStore.applyError(token, out);
    else if(kind === 'list') applied = SessionAuditStore.applyList(token, out.data);
    else applied = SessionAuditStore.applyHistory(token, out.data);
    if(applied) paint();
  }

  function loadMonth(key){ return run('list', key, () => AuditApi.month(key)); }
  function loadRecord(r){ return run('record', r, () => AuditApi.record(r.entity, r.entityId)); }

  // The month field and Previous / Next: another month's events, read from the server. A value
  // outside the grammar is never sent: the view says so and the month shown stays.
  function setMonth(key){
    const s = SessionAuditStore.snapshot();
    if(!canRead() || s.record || s.selected) return;
    if(!OvertimeCalendar.isMonth(key)){
      SessionAuditStore.setNotice('monthInvalid');
      SessionAuditStore.setFocus('message');
      paint();
      return;
    }
    if(key === s.month){ SessionAuditStore.setNotice(null); paint(); return; }
    SessionAuditStore.setMonth(key);
    const loading = loadMonth(key);
    paint();
    return loading;
  }

  return Object.freeze({
    // Called on every render of the authenticated workspace: binds the data to the principal
    // (a different one destroys it) and, while the section is shown to the CEO, starts the reads
    // it needs.
    ensureLoaded(principal){
      if(!principal) return;
      SessionAuditStore.bindPrincipal(principal);
      const s = SessionAuditStore.snapshot();
      if(!s.open || !sessionAuditIsCeo(principal)) return;
      if(s.listStatus === SESSION_AUDIT_STATUS.IDLE) loadMonth(s.month);
      if(s.record && s.historyStatus === SESSION_AUDIT_STATUS.IDLE) loadRecord(s.record);
    },
    // The section switch of the workspace view: the CEO's Audit. Anyone may leave it.
    show(value){
      if(value === true && !sessionAuditIsCeo(principalNow())) return;
      SessionAuditStore.setOpen(value === true, sessionAuditCurrentMonth());
      if(value === true) SessionAuditStore.setFocus('section');
      paint();
    },
    // Previous / Next (delta -1 / +1) and the month field ("YYYY-MM").
    shiftMonth(delta){
      const s = SessionAuditStore.snapshot();
      if(!canRead() || s.record || s.selected || (delta !== 1 && delta !== -1)) return;
      return setMonth(OvertimeCalendar.shift(s.month, delta));
    },
    setMonth: setMonth,
    // One event in full, by its position in the list rendered ('month' or 'record').
    openEvent(index, from){
      if(!canRead()) return;
      const s = SessionAuditStore.snapshot();
      const rows = from === 'record' ? (s.record && s.historyStatus === SESSION_AUDIT_STATUS.READY ? s.history : null)
        : (from === 'month' && !s.record && s.listStatus === SESSION_AUDIT_STATUS.READY ? s.list : null);
      const event = rows && Number.isInteger(index) && index >= 0 ? rows[index] : undefined;
      if(!event) return;
      SessionAuditStore.select(event, from);
      SessionAuditStore.setFocus('detail');
      paint();
    },
    // The history of the record the event shown names — never a typed entity or id.
    openRecord(){
      if(!canRead()) return;
      const s = SessionAuditStore.snapshot();
      if(!s.selected) return;
      const event = s.selected.event;
      SessionAuditStore.openRecord(event);
      SessionAuditStore.setFocus('record');
      const loading = loadRecord(SessionAuditStore.snapshot().record);
      paint();
      return loading;
    },
    // From an event back to the list it was opened from; from a record history back to the month.
    back(){
      if(!canRead()) return;
      const s = SessionAuditStore.snapshot();
      if(s.selected){ SessionAuditStore.unselect(); SessionAuditStore.setFocus(s.selected.from === 'record' ? 'record' : 'list'); }
      else if(s.record){ SessionAuditStore.closeRecord(); SessionAuditStore.setFocus('list'); }
      else return;
      paint();
    },
    // A failed read, read again — a deliberate click only.
    retry(){
      if(!canRead()) return;
      const s = SessionAuditStore.snapshot();
      let loading;
      if(s.error && s.error.scope === 'record' && s.record) loading = loadRecord(s.record);
      else if(s.error && s.error.scope === 'list' && !s.record) loading = loadMonth(s.month);
      else return;
      paint();
      return loading;
    }
  });
})();
