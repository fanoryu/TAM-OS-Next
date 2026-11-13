/* ============================================================
   SESSION LEDGER DATA (Phase 1, D-INT-1 / D-INT-2) — js/core/session-ledger.js
   ------------------------------------------------------------
   The SESSION-mode Finance section of the authenticated workspace — CEO only — over the Phase 1
   routes: the financial dashboard (income and expenses by Financial Post, the general total, the
   separate Payroll line and the consolidated total) and the general transactions (history,
   record one, void one) for one inclusive date range. Held in memory only and owned here — never
   in the LOCAL `State`, never in storage, the URL or history, never through a LOCAL module (the
   LOCAL Transactions and Dashboard pages are another thing and are never reached). The server
   (TransactionApi, js/core/transaction-api.js) is the only source; this module only remembers its
   last decoded answers for the view and the CEO's unsent drafts.

   SessionLedgerStore — the data:
     principalKey, generation   the principal the data belongs to; clear() bumps the generation
     open, view                 the section is shown; 'dashboard' (the default) or 'transactions'
     range                      { from, to } shown — the current Asia/Jakarta month when the
                                section first opens, then the CEO's Apply
     rangeDraft                 the two date fields as typed (memory only)
     report, reportStatus       the report of `range`
     list, listStatus           the transactions of `range`, oldest first
     form                       null, or the Record transaction draft { values, key } — the
                                idempotency key is made once when the form opens, so a resubmit
                                after an ambiguous answer replays the same write
     voidTarget                 null, or { transaction, reason, key } for the inline void panel
     mutation                   { kind: 'create' | 'void', status, error, fields }
     error, notice, focus       the last failed read, a fixed message key, a focus hint

   A read takes a token { gen, kind, seq } and is applied only while it is the latest of its kind
   in the current generation. A write takes { gen } and is dropped when the principal changed.

   SessionLedger — the controller the view calls. CEO only: for any other principal every entry
   point is a no-op and no request is ever made. A 401 ends the session (AuthBoot.sessionLost());
   a recovery that could not confirm the session fails closed (AuthBoot.sessionUncertain()).
   Nothing is retried automatically. After a successful write the report and the list are read
   again from the server — nothing is computed or updated optimistically here.

   Classic shared global scope; top-level `const` bindings, not on window.
   ============================================================ */

const SESSION_LEDGER_STATUS = Object.freeze({ IDLE: 'idle', LOADING: 'loading', READY: 'ready', ERROR: 'error' });
const SESSION_LEDGER_MUTATION_STATUS = Object.freeze({ IDLE: 'idle', PENDING: 'pending', ERROR: 'error', AMBIGUOUS: 'ambiguous' });
const SESSION_LEDGER_VIEWS = Object.freeze(['dashboard', 'transactions']);
const SESSION_LEDGER_FIELDS = Object.freeze(['kind', 'financialPost', 'category', 'description', 'amount', 'transactionDate']);

function sessionLedgerIsCeo(p){ return !!p && p.principalType === PRINCIPAL_TYPES.CEO; }
function sessionLedgerEmptyValues(today){
  return Object.freeze({ kind: 'expense', financialPost: '', category: '', description: '', amount: '', transactionDate: today });
}

const SessionLedgerStore = (function(){
  const IDLE_MUTATION = Object.freeze({ kind: null, status: SESSION_LEDGER_MUTATION_STATUS.IDLE, error: null, fields: null });
  let principalKey = null;
  let generation = 0;
  let open = false, view = 'dashboard', range = null, rangeDraft = null;
  let report = null, reportSeq = 0, reportStatus = SESSION_LEDGER_STATUS.IDLE;
  let list = null, listSeq = 0, listStatus = SESSION_LEDGER_STATUS.IDLE;
  let form = null, voidTarget = null, mutation = IDLE_MUTATION;
  let error = null, notice = null, focus = null;

  function keyOf(p){ return p ? [p.id, p.principalType, p.employeeId || ''].join('|') : null; }
  function seqOf(kind){ return kind === 'report' ? reportSeq : kind === 'list' ? listSeq : -1; }
  function isCurrent(token){ return !!token && token.gen === generation && token.seq === seqOf(token.kind); }
  function isLive(token){ return !!token && token.gen === generation; }
  function clearError(scope){ if(error && error.scope === scope) error = null; }
  function dropReads(){
    reportSeq++; report = null; reportStatus = SESSION_LEDGER_STATUS.IDLE; clearError('report');
    listSeq++; list = null; listStatus = SESSION_LEDGER_STATUS.IDLE; clearError('list');
  }
  function clear(){
    open = false; view = 'dashboard'; range = null; rangeDraft = null;
    dropReads();
    form = null; voidTarget = null; mutation = IDLE_MUTATION;
    error = null; notice = null; focus = null;
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
    // Shows or leaves the section. The range is chosen once, when it is first shown; leaving the
    // section forgets what was read and any unsent draft.
    setOpen(value, initialRange){
      const next = value === true;
      if(open !== next){ dropReads(); form = null; voidTarget = null; notice = null; if(mutation.status !== SESSION_LEDGER_MUTATION_STATUS.PENDING) mutation = IDLE_MUTATION; }
      open = next;
      if(open && range === null){ range = initialRange; rangeDraft = { from: initialRange.from, to: initialRange.to }; }
    },
    setView(v){ if(SESSION_LEDGER_VIEWS.indexOf(v) !== -1){ view = v; notice = null; } },
    setRangeDraft(name, value){ if(rangeDraft && (name === 'from' || name === 'to')) rangeDraft[name] = typeof value === 'string' ? value : ''; },
    setRange(next){ range = Object.freeze({ from: next.from, to: next.to }); rangeDraft = { from: next.from, to: next.to }; notice = null; voidTarget = null; dropReads(); },
    begin(kind){
      if(kind === 'report'){ reportSeq++; report = null; reportStatus = SESSION_LEDGER_STATUS.LOADING; clearError('report'); return Object.freeze({ gen: generation, kind: kind, seq: reportSeq }); }
      if(kind === 'list'){ listSeq++; list = null; listStatus = SESSION_LEDGER_STATUS.LOADING; clearError('list'); return Object.freeze({ gen: generation, kind: kind, seq: listSeq }); }
      throw new Error('unknown session finance read');
    },
    isCurrent: isCurrent,
    isLive: isLive,
    applyRead(token, data){
      if(!isCurrent(token)) return false;
      if(token.kind === 'report'){ report = data; reportStatus = SESSION_LEDGER_STATUS.READY; }
      else { list = data; listStatus = SESSION_LEDGER_STATUS.READY; }
      return true;
    },
    applyError(token, failed){
      if(!isCurrent(token)) return false;
      if(token.kind === 'report'){ report = null; reportStatus = SESSION_LEDGER_STATUS.ERROR; }
      else { list = null; listStatus = SESSION_LEDGER_STATUS.ERROR; }
      error = Object.freeze(Object.assign({ scope: token.kind }, failure(failed)));
      return true;
    },
    openForm(today, key){ form = { values: Object.assign({}, sessionLedgerEmptyValues(today)), key: key }; voidTarget = null; notice = null; mutation = IDLE_MUTATION; },
    setDraft(name, value){ if(form && SESSION_LEDGER_FIELDS.indexOf(name) !== -1) form.values[name] = typeof value === 'string' ? value : ''; },
    closeForm(){ form = null; if(mutation.kind === 'create') mutation = IDLE_MUTATION; },
    openVoid(t, key){ voidTarget = { transaction: t, reason: '', key: key }; form = null; notice = null; mutation = IDLE_MUTATION; },
    setVoidReason(v){ if(voidTarget) voidTarget.reason = typeof v === 'string' ? v : ''; },
    closeVoid(){ voidTarget = null; if(mutation.kind === 'void') mutation = IDLE_MUTATION; },
    beginMutation(kind){
      mutation = Object.freeze({ kind: kind, status: SESSION_LEDGER_MUTATION_STATUS.PENDING, error: null, fields: null });
      return Object.freeze({ gen: generation });
    },
    failMutation(token, status, failed){
      if(!isLive(token)) return false;
      mutation = Object.freeze({ kind: mutation.kind, status: status, error: Object.freeze(failure(failed)), fields: failed.fields ? Object.freeze(failed.fields.slice()) : null });
      return true;
    },
    succeedMutation(token, noticeKey){
      if(!isLive(token)) return false;
      if(mutation.kind === 'create') form = null;
      if(mutation.kind === 'void') voidTarget = null;
      mutation = IDLE_MUTATION;
      notice = noticeKey;
      dropReads();
      return true;
    },
    setNotice(key){ notice = key; },
    setFocus(hint){ focus = hint; },
    takeFocus(){ const f = focus; focus = null; return f; },
    snapshot(){
      return Object.freeze({
        principalKey: principalKey, generation: generation, open: open, view: view, range: range,
        rangeDraft: rangeDraft ? Object.freeze({ from: rangeDraft.from, to: rangeDraft.to }) : null,
        report: report, reportStatus: reportStatus, list: list, listStatus: listStatus,
        form: form ? Object.freeze({ values: Object.freeze(Object.assign({}, form.values)), key: form.key }) : null,
        voidTarget: voidTarget ? Object.freeze({ transaction: voidTarget.transaction, reason: voidTarget.reason, key: voidTarget.key }) : null,
        mutation: mutation, error: error, notice: notice
      });
    }
  });
})();

const SessionLedger = (function(){
  // An ambiguous answer: the write may or may not have happened. Never resent automatically; the
  // same key makes a deliberate resubmit a replay, never a second transaction.
  const AMBIGUOUS = Object.freeze([API_RESULT_KINDS.UNAVAILABLE, API_RESULT_KINDS.SERVER_ERROR, TRANSACTION_API_INVALID]);
  function paint(){ if(typeof render === 'function') render(); }
  function principalNow(){
    const a = AuthBoot.snapshot();
    return a.state === AUTH_STATES.AUTHENTICATED ? a.principal : null;
  }
  function pending(){ return SessionLedgerStore.snapshot().mutation.status === SESSION_LEDGER_MUTATION_STATUS.PENDING; }
  function canRead(){ return sessionLedgerIsCeo(principalNow()) && SessionLedgerStore.snapshot().open; }
  function canAct(){ return canRead() && !pending(); }

  async function read(kind){
    const r = SessionLedgerStore.snapshot().range;
    const token = SessionLedgerStore.begin(kind);
    const out = await (kind === 'report' ? TransactionApi.report(r.from, r.to) : TransactionApi.range(r.from, r.to));
    if(!SessionLedgerStore.isCurrent(token)) return;
    if(!out.ok && out.kind === API_RESULT_KINDS.UNAUTHENTICATED){ AuthBoot.sessionLost(); return; }
    if(out.ok ? SessionLedgerStore.applyRead(token, out.data) : SessionLedgerStore.applyError(token, out)) paint();
  }
  function loadVisible(){
    const s = SessionLedgerStore.snapshot();
    const loads = [];
    if(s.view === 'dashboard' && s.reportStatus === SESSION_LEDGER_STATUS.IDLE) loads.push(read('report'));
    if(s.view === 'transactions' && s.listStatus === SESSION_LEDGER_STATUS.IDLE) loads.push(read('list'));
    return Promise.all(loads);
  }

  async function settle(token, out, noticeKey){
    if(out.recovery === 'unavailable'){ AuthBoot.sessionUncertain(); return; }   // identity already cleared: fail closed
    if(!SessionLedgerStore.isLive(token)) return;
    if(out.recovery === 'principal_changed'){ SessionLedgerStore.clear(); paint(); return; }
    if(out.recovery === 'signed_out' || (!out.ok && out.kind === API_RESULT_KINDS.UNAUTHENTICATED)){ AuthBoot.sessionLost(); return; }
    if(out.ok){
      SessionLedgerStore.succeedMutation(token, noticeKey);
      SessionLedgerStore.setFocus('message');
      const loading = loadVisible();
      paint();
      return loading;
    }
    SessionLedgerStore.failMutation(token, AMBIGUOUS.indexOf(out.kind) !== -1 ? SESSION_LEDGER_MUTATION_STATUS.AMBIGUOUS : SESSION_LEDGER_MUTATION_STATUS.ERROR, out);
    SessionLedgerStore.setFocus('message');
    paint();
  }

  return Object.freeze({
    // Called on every render of the authenticated workspace: binds the data to the principal and,
    // while the section is shown to the CEO, starts the reads its view needs.
    ensureLoaded(principal){
      if(!principal) return;
      SessionLedgerStore.bindPrincipal(principal);
      const s = SessionLedgerStore.snapshot();
      if(!s.open || !sessionLedgerIsCeo(principal)) return;
      loadVisible();
    },
    show(value){
      if(value === true && !sessionLedgerIsCeo(principalNow())) return;
      SessionLedgerStore.setOpen(value === true, transactionMonthRange(new Date()));
      if(value === true) SessionLedgerStore.setFocus('section');
      paint();
    },
    // The Dashboard / Transactions switch — never while a write is in flight.
    setView(v){
      if(!canAct() || SESSION_LEDGER_VIEWS.indexOf(v) === -1) return;
      SessionLedgerStore.setView(v);
      SessionLedgerStore.setFocus('view');
      const loading = loadVisible();
      paint();
      return loading;
    },
    setRangeDraft(name, value){ if(canRead()) SessionLedgerStore.setRangeDraft(name, value); },
    // Apply: the typed range, read again from the server. A range outside the grammar is never
    // sent: the view says so and the range shown stays.
    applyRange(){
      if(!canAct()) return;
      const d = SessionLedgerStore.snapshot().rangeDraft;
      if(!d || !transactionIsRange(d.from, d.to)){
        SessionLedgerStore.setNotice('rangeInvalid');
        SessionLedgerStore.setFocus('message');
        paint();
        return;
      }
      SessionLedgerStore.setRange(d);
      const loading = loadVisible();
      paint();
      return loading;
    },
    retry(){
      if(!canAct()) return;
      const s = SessionLedgerStore.snapshot();
      if(!s.error) return;
      const loading = read(s.error.scope);
      paint();
      return loading;
    },
    openCreate(){
      if(!canAct()) return;
      const key = payrollIdempotencyKey();
      if(key === null){ SessionLedgerStore.setNotice('noCrypto'); SessionLedgerStore.setFocus('message'); paint(); return; }
      SessionLedgerStore.openForm(transactionToday(new Date()), key);
      SessionLedgerStore.setFocus('form');
      paint();
    },
    setDraft(name, value){ if(canRead()) SessionLedgerStore.setDraft(name, value); },
    cancelCreate(){ if(!canAct()) return; SessionLedgerStore.closeForm(); SessionLedgerStore.setFocus('view'); paint(); },
    submitCreate(){
      if(!canAct()) return;
      const f = SessionLedgerStore.snapshot().form;
      if(!f) return;
      const token = SessionLedgerStore.beginMutation('create');
      const sending = TransactionApi.create(f.values, f.key).then(function(out){ return settle(token, out, 'created'); });
      paint();
      return sending;
    },
    // The inline void panel for the transaction at `index` of the list rendered — Active only.
    openVoid(index){
      if(!canAct()) return;
      const s = SessionLedgerStore.snapshot();
      const t = s.listStatus === SESSION_LEDGER_STATUS.READY && Number.isInteger(index) && index >= 0 ? s.list[index] : undefined;
      if(!t || t.status !== 'Active') return;
      const key = payrollIdempotencyKey();
      if(key === null){ SessionLedgerStore.setNotice('noCrypto'); SessionLedgerStore.setFocus('message'); paint(); return; }
      SessionLedgerStore.openVoid(t, key);
      SessionLedgerStore.setFocus('void');
      paint();
    },
    setVoidReason(v){ if(canRead()) SessionLedgerStore.setVoidReason(v); },
    cancelVoid(){ if(!canAct()) return; SessionLedgerStore.closeVoid(); SessionLedgerStore.setFocus('view'); paint(); },
    submitVoid(){
      if(!canAct()) return;
      const v = SessionLedgerStore.snapshot().voidTarget;
      if(!v) return;
      const token = SessionLedgerStore.beginMutation('void');
      const sending = TransactionApi.void(v.transaction.id, v.reason, v.key).then(function(out){ return settle(token, out, 'voided'); });
      paint();
      return sending;
    }
  });
})();
