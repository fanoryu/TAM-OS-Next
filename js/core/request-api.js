/* ============================================================
   FINANCE REQUEST API (I4, ADR-016) — js/core/request-api.js
   ------------------------------------------------------------
   The SESSION-mode client for the Phase 2 finance requests — payment requests and employee
   reimbursements, one lifecycle — over the nine AWP-01 routes: two reads over ApiClient and seven
   writes over authSessionMutation (js/core/auth-boot.js), each answer strictly decoded before
   anything else sees it.

     list(from, to)                 GET  /api/finance-requests?from=&to=     the requests whose
                                    documentDate is in the inclusive range, in documentDate order
                                    (CEO: the company; Employee: own reimbursements only)
     get(id)                        GET  /api/finance-request?id=            one request
     create(kind, values, key)      POST /api/finance-requests/create        a Draft: the CEO a
                                    payment request, an Employee their own reimbursement
     update(request, patch)         POST /api/finance-requests/update        changed Draft fields
     submit(request)                POST /api/finance-requests/submit        Draft -> Submitted
     approve(request)               POST /api/finance-requests/approve       Submitted -> Approved
     reject(request, reason)        POST /api/finance-requests/reject        Submitted -> Rejected
     cancel(request, reason)        POST /api/finance-requests/cancel        Draft / Submitted /
                                    Approved -> Cancelled
     pay(request, values, key)      POST /api/finance-requests/pay           Approved -> Paid, which
                                    records the linked general expense

   SOURCE CONTRACT: server/src/Request (RequestInput, RequestView, RequestStatus) — the body
   allowlists, the projection's exact fields, the statuses and the transitions. Every write names
   the version (and, for approve and pay, the exact amount) of the request the user was shown, so a
   request changed elsewhere is refused (409), never overwritten. The server decides every
   permission and scope; nothing here is authority.

   EMPLOYEE ID: ApiClient refuses an employeeId in any body but the one recorded exception
   (D-AFI4b1-3, Overtime create), so the CEO's create here is a payment request only; an Employee's
   reimbursement names no owner (the server takes it from the session scope). A CEO-filed
   reimbursement for an employee is not offered by this client.

   STRICT DECODING: a request has exactly RequestView::FIELDS with the server's grammars; a
   reimbursement has an employeeId and no payee, a payment request the reverse; a reason exactly on
   Rejected / Cancelled; a payment exactly on Paid. A list holds at most FINANCE_REQUEST_LIST_CAP
   rows, each id once, every documentDate inside the range, in documentDate order. Anything else is
   INVALID_RESPONSE and nothing of it is returned. MONEY is the exact server string: never parsed
   into a float, never rounded, never recomputed here.

   Nothing is persisted, cached, logged or resent here. The idempotency keys of create and pay are
   made once per deliberate form by the caller (payrollIdempotencyKey, Web Crypto) and kept only in
   memory, so a resubmit after an ambiguous answer replays the same write instead of making a
   second.

   Classic shared global scope; top-level `const` bindings, not on window.
   ============================================================ */

// RequestView::FIELDS and PAYMENT_FIELDS (sorted); RequestStatus; RequestInput limits; RequestStore::LIST_CAP.
const FINANCE_REQUEST_KEYS = Object.freeze(['amount', 'category', 'createdAt', 'createdByUserId', 'description', 'documentDate', 'employeeId', 'financialPost', 'id', 'kind', 'payee', 'payment', 'status', 'statusReason', 'updatedAt', 'version']);
const FINANCE_REQUEST_PAYMENT_KEYS = Object.freeze(['financeTransactionId', 'paidAt', 'paidByUserId', 'paidOn', 'paymentMethod']);
const FINANCE_REQUEST_KINDS = Object.freeze(['paymentRequest', 'reimbursement']);
const FINANCE_REQUEST_STATUSES = Object.freeze(['Draft', 'Submitted', 'Approved', 'Paid', 'Rejected', 'Cancelled']);
const FINANCE_REQUEST_FIELDS = Object.freeze(['financialPost', 'category', 'description', 'amount', 'payee', 'documentDate']);
const FINANCE_REQUEST_LIMITS = Object.freeze({ payee: 160, reason: 200, neededByDays: 366, maxVersion: 4294967295 });
const FINANCE_REQUEST_LIST_CAP = 2000;
// RequestStatus::TRANSITIONS: operation -> the legal source statuses.
const FINANCE_REQUEST_TRANSITIONS = Object.freeze({
  update: Object.freeze(['Draft']), submit: Object.freeze(['Draft']), approve: Object.freeze(['Submitted']),
  reject: Object.freeze(['Submitted']), cancel: Object.freeze(['Draft', 'Submitted', 'Approved']), pay: Object.freeze(['Approved'])
});
const FINANCE_REQUEST_ROUTES = Object.freeze({
  list: '/api/finance-requests', one: '/api/finance-request', create: '/api/finance-requests/create',
  update: '/api/finance-requests/update', submit: '/api/finance-requests/submit', approve: '/api/finance-requests/approve',
  reject: '/api/finance-requests/reject', cancel: '/api/finance-requests/cancel', pay: '/api/finance-requests/pay'
});

// True when `operation` is legal from the request's status (display and pre-send only; the server decides).
function financeRequestAllows(r, operation){
  const from = FINANCE_REQUEST_TRANSITIONS[operation];
  return !!r && !!from && from.indexOf(r.status) !== -1;
}
// today + NEEDED_BY_DAYS (RequestInput::neededByLimit), from a company-calendar date.
function financeRequestNeededByLimit(today){
  const d = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) + FINANCE_REQUEST_LIMITS.neededByDays * 86400000);
  return d.toISOString().slice(0, 10);
}
// RequestInput::isDocumentDate: from 1900-01-01; a reimbursement's expense date up to today, a
// payment request's needed-by date up to today + 366 days. `today` is a hint; the server decides.
function financeRequestIsDocumentDate(v, kind, today){
  if(!transactionIsDate(v) || v < '1900-01-01') return false;
  return v <= (kind === 'paymentRequest' ? financeRequestNeededByLimit(today) : today);
}
function financeRequestIsVersion(v){ return Number.isSafeInteger(v) && v >= 1 && v <= FINANCE_REQUEST_LIMITS.maxVersion; }
// The Financial Post rule, the payroll categories and the text limits are Phase 1's (TransactionInput).
function financeRequestFieldOk(name, v, kind, today){
  if(name === 'financialPost') return transactionIsPost(v);
  if(name === 'category') return transactionIsText(v, TRANSACTION_LIMITS.category) && TRANSACTION_PAYROLL_CATEGORIES.indexOf(String(v).toLowerCase()) === -1;
  if(name === 'description') return transactionIsText(v, TRANSACTION_LIMITS.description);
  if(name === 'amount') return transactionIsAmount(v);
  if(name === 'payee') return kind === 'paymentRequest' && transactionIsText(v, FINANCE_REQUEST_LIMITS.payee);
  if(name === 'documentDate') return financeRequestIsDocumentDate(v, kind, today);
  return false;
}

const FinanceRequestDecoders = (function(){
  function isPlain(v){
    return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  }
  function exactKeys(o, keys){
    const k = Object.keys(o).sort();
    if(k.length !== keys.length) return false;
    for(let i = 0; i < k.length; i++){ if(k[i] !== keys[i]) return false; }
    return true;
  }
  function hex(v){ return typeof v === 'string' && TRANSACTION_HEX32.test(v); }
  function instant(v){ return typeof v === 'string' && TRANSACTION_INSTANT.test(v); }
  // A frozen copy holding exactly the request keys, or null.
  function request(o){
    if(!isPlain(o) || !exactKeys(o, FINANCE_REQUEST_KEYS)) return null;
    if(!hex(o.id) || FINANCE_REQUEST_KINDS.indexOf(o.kind) === -1 || FINANCE_REQUEST_STATUSES.indexOf(o.status) === -1 || !transactionIsPost(o.financialPost)) return null;
    if(!transactionIsText(o.category, TRANSACTION_LIMITS.category) || !transactionIsText(o.description, TRANSACTION_LIMITS.description)) return null;
    if(!transactionIsAmount(o.amount) || !transactionIsDate(o.documentDate) || !financeRequestIsVersion(o.version)) return null;
    if(!hex(o.createdByUserId) || !instant(o.createdAt) || !instant(o.updatedAt)) return null;
    // The owner is the opaque employee id (employees.id, VARCHAR(64)): the Employee API's grammar.
    if(o.kind === 'reimbursement' ? !(typeof o.employeeId === 'string' && EMPLOYEE_API_ID_PATTERN.test(o.employeeId) && o.payee === null) : !(o.employeeId === null && transactionIsText(o.payee, FINANCE_REQUEST_LIMITS.payee))) return null;
    const reasoned = o.status === 'Rejected' || o.status === 'Cancelled';
    if(reasoned ? !transactionIsText(o.statusReason, FINANCE_REQUEST_LIMITS.reason) : o.statusReason !== null) return null;
    let payment = null;
    if(o.status === 'Paid'){
      const p = o.payment;
      if(!isPlain(p) || !exactKeys(p, FINANCE_REQUEST_PAYMENT_KEYS) || !hex(p.financeTransactionId) || !transactionIsDate(p.paidOn)
        || FINANCE_EXECUTION_PAYMENT_METHODS.indexOf(p.paymentMethod) === -1 || !hex(p.paidByUserId) || !instant(p.paidAt)) return null;
      payment = Object.freeze({ financeTransactionId: p.financeTransactionId, paidOn: p.paidOn, paymentMethod: p.paymentMethod, paidByUserId: p.paidByUserId, paidAt: p.paidAt });
    } else if(o.payment !== null) return null;
    const out = {};
    for(let i = 0; i < FINANCE_REQUEST_KEYS.length; i++) out[FINANCE_REQUEST_KEYS[i]] = o[FINANCE_REQUEST_KEYS[i]];
    out.payment = payment;
    return Object.freeze(out);
  }
  return Object.freeze({
    request: request,
    // { financeRequests: [request…] } -> frozen array, or null: at most the cap, each id once, every
    // documentDate inside the range, in documentDate order.
    listResponse(data, from, to){
      if(!isPlain(data) || !exactKeys(data, ['financeRequests']) || !Array.isArray(data.financeRequests) || data.financeRequests.length > FINANCE_REQUEST_LIST_CAP) return null;
      const out = [];
      for(let i = 0; i < data.financeRequests.length; i++){
        const r = request(data.financeRequests[i]);
        if(!r || r.documentDate < from || r.documentDate > to) return null;
        if(out.length && out[out.length - 1].documentDate > r.documentDate) return null;
        out.push(r);
      }
      return new Set(out.map(function(r){ return r.id; })).size === out.length ? Object.freeze(out) : null;
    },
    // { financeRequest: request } -> the request, or null.
    oneResponse(data){
      if(!isPlain(data) || !exactKeys(data, ['financeRequest'])) return null;
      return request(data.financeRequest);
    }
  });
})();

// The request bodies: exactly the server's allowlists, validated with its grammar. A body outside
// it is never sent — { ok: false, fields } names what to correct.
const FinanceRequestRequests = (function(){
  function fail(bad){ return Object.freeze({ ok: false, fields: Object.freeze(bad) }); }
  function target(r){
    const bad = [];
    if(!r || typeof r.id !== 'string' || !TRANSACTION_HEX32.test(r.id)) bad.push('financeRequestId');
    if(!r || !financeRequestIsVersion(r.version)) bad.push('expectedVersion');
    return bad;
  }
  function key(k){ return typeof k === 'string' && TRANSACTION_HEX32.test(k); }
  return Object.freeze({
    // The CEO: a payment request (with a payee). An Employee: their own reimbursement (no payee, no owner).
    create(kind, values, k, today){
      const v = values || {};
      const bad = [];
      if(FINANCE_REQUEST_KINDS.indexOf(kind) === -1) bad.push('kind');
      const names = kind === 'paymentRequest' ? FINANCE_REQUEST_FIELDS : FINANCE_REQUEST_FIELDS.filter(function(f){ return f !== 'payee'; });
      names.forEach(function(n){ if(!financeRequestFieldOk(n, v[n], kind, today)) bad.push(n); });
      if(!key(k)) bad.push('idempotencyKey');
      if(bad.length) return fail(bad);
      const body = { kind: kind, financialPost: v.financialPost, category: v.category, description: v.description, amount: v.amount };
      if(kind === 'paymentRequest') body.payee = v.payee;
      body.documentDate = v.documentDate;
      body.idempotencyKey = k;
      return Object.freeze({ ok: true, body: Object.freeze(body) });
    },
    // Only the fields that differ from the request shown; at least one.
    update(r, values, today){
      const bad = target(r);
      if(bad.length) return fail(bad);
      const names = r.kind === 'paymentRequest' ? FINANCE_REQUEST_FIELDS : FINANCE_REQUEST_FIELDS.filter(function(f){ return f !== 'payee'; });
      const body = { financeRequestId: r.id, expectedVersion: r.version };
      let changed = 0;
      names.forEach(function(n){
        const v = (values || {})[n];
        if(v === r[n]) return;
        if(!financeRequestFieldOk(n, v, r.kind, today)) bad.push(n);
        body[n] = v; changed++;
      });
      if(bad.length) return fail(bad);
      if(!changed) return fail(['unchanged']);
      return Object.freeze({ ok: true, body: Object.freeze(body) });
    },
    transition(r){
      const bad = target(r);
      return bad.length ? fail(bad) : Object.freeze({ ok: true, body: Object.freeze({ financeRequestId: r.id, expectedVersion: r.version }) });
    },
    approve(r){
      const bad = target(r);
      if(!r || !transactionIsAmount(r.amount)) bad.push('expectedAmount');
      return bad.length ? fail(bad) : Object.freeze({ ok: true, body: Object.freeze({ financeRequestId: r.id, expectedVersion: r.version, expectedAmount: r.amount }) });
    },
    withReason(r, reason){
      const bad = target(r);
      if(!transactionIsText(reason, FINANCE_REQUEST_LIMITS.reason)) bad.push('reason');
      return bad.length ? fail(bad) : Object.freeze({ ok: true, body: Object.freeze({ financeRequestId: r.id, expectedVersion: r.version, reason: reason }) });
    },
    // paidOn 1900-01-01 … today; one of the closed payment methods; the pay key.
    pay(r, values, k, today){
      const v = values || {};
      const bad = target(r);
      if(!r || !transactionIsAmount(r.amount)) bad.push('expectedAmount');
      if(!transactionIsDate(v.paidOn) || v.paidOn < '1900-01-01' || v.paidOn > today) bad.push('paidOn');
      if(FINANCE_EXECUTION_PAYMENT_METHODS.indexOf(v.paymentMethod) === -1) bad.push('paymentMethod');
      if(!key(k)) bad.push('idempotencyKey');
      if(bad.length) return fail(bad);
      return Object.freeze({ ok: true, body: Object.freeze({ financeRequestId: r.id, expectedVersion: r.version, expectedAmount: r.amount, paidOn: v.paidOn, paymentMethod: v.paymentMethod, idempotencyKey: k }) });
    }
  });
})();

const FinanceRequestApi = (function(){
  // ApiResult -> { ok: true, data } | { ok: false, kind, fields?, retryAfter?, requestId? }.
  function outcome(res, decode){
    if(!res.ok){
      const failed = { ok: false, kind: res.kind };
      if(res.fields) failed.fields = res.fields;
      if(res.retryAfter !== undefined) failed.retryAfter = res.retryAfter;
      if(res.requestId) failed.requestId = res.requestId;
      return Object.freeze(failed);
    }
    const data = decode(res.data);
    if(data === null){
      const invalid = { ok: false, kind: TRANSACTION_API_INVALID };
      if(res.requestId) invalid.requestId = res.requestId;
      return Object.freeze(invalid);
    }
    return Object.freeze({ ok: true, data: data });
  }
  const refused = Object.freeze({ ok: false, kind: API_RESULT_KINDS.CLIENT_FAULT });
  const invalid = Object.freeze({ ok: false, kind: TRANSACTION_API_INVALID });
  // One write through the established CSRF path; only a strictly decoded answer that `confirms`
  // the write is a success. The answer carries authSessionMutation's recovery.
  async function write(route, prepared, confirms){
    if(!prepared.ok) return Object.freeze({ ok: false, kind: API_RESULT_KINDS.VALIDATION, fields: prepared.fields, local: true, recovery: 'none' });
    const sent = await authSessionMutation(route, prepared.body);
    let out = outcome(sent.result, FinanceRequestDecoders.oneResponse);
    if(out.ok && !confirms(out.data)) out = invalid;
    return Object.freeze(Object.assign({}, out, { recovery: sent.recovery }));
  }
  function same(a, b, names){ return names.every(function(n){ return a[n] === b[n]; }); }

  return Object.freeze({
    async list(from, to){
      if(!transactionIsRange(from, to)) return refused;
      const res = await ApiClient.request(FINANCE_REQUEST_ROUTES.list, { method: 'GET', query: { from: from, to: to } });
      return outcome(res, function(d){ return FinanceRequestDecoders.listResponse(d, from, to); });
    },
    async get(id){
      if(typeof id !== 'string' || !TRANSACTION_HEX32.test(id)) return refused;
      const res = await ApiClient.request(FINANCE_REQUEST_ROUTES.one, { method: 'GET', query: { id: id } });
      return outcome(res, function(d){ const r = FinanceRequestDecoders.oneResponse(d); return r && r.id === id ? r : null; });
    },
    // Confirmed only by a Draft of this kind holding exactly the values sent (the original Draft on a replay).
    create(kind, values, key, today){
      const prepared = FinanceRequestRequests.create(kind, values, key, today);
      return write(FINANCE_REQUEST_ROUTES.create, prepared, function(r){
        const b = prepared.body;
        return r.kind === b.kind && r.status === 'Draft' && same(r, b, ['financialPost', 'category', 'description', 'amount', 'documentDate'])
          && (b.kind === 'paymentRequest' ? r.payee === b.payee : r.payee === null);
      });
    },
    // Confirmed by the same Draft holding the new values (the same version when nothing differed).
    update(r, values, today){
      const prepared = FinanceRequestRequests.update(r, values, today);
      return write(FINANCE_REQUEST_ROUTES.update, prepared, function(x){
        const b = prepared.body;
        return x.id === r.id && x.status === 'Draft' && x.version >= r.version && Object.keys(b).every(function(k){ return k === 'financeRequestId' || k === 'expectedVersion' || x[k] === b[k]; });
      });
    },
    submit(r){ return write(FINANCE_REQUEST_ROUTES.submit, FinanceRequestRequests.transition(r), function(x){ return x.id === r.id && x.status === 'Submitted'; }); },
    approve(r){ return write(FINANCE_REQUEST_ROUTES.approve, FinanceRequestRequests.approve(r), function(x){ return x.id === r.id && x.status === 'Approved' && x.amount === r.amount; }); },
    reject(r, reason){ return write(FINANCE_REQUEST_ROUTES.reject, FinanceRequestRequests.withReason(r, reason), function(x){ return x.id === r.id && x.status === 'Rejected' && x.statusReason === reason; }); },
    cancel(r, reason){ return write(FINANCE_REQUEST_ROUTES.cancel, FinanceRequestRequests.withReason(r, reason), function(x){ return x.id === r.id && x.status === 'Cancelled' && x.statusReason === reason; }); },
    // Confirmed only by the same request, Paid, of the amount shown, on the date and by the method sent.
    pay(r, values, key, today){
      const prepared = FinanceRequestRequests.pay(r, values, key, today);
      return write(FINANCE_REQUEST_ROUTES.pay, prepared, function(x){
        return x.id === r.id && x.status === 'Paid' && x.amount === r.amount && !!x.payment
          && x.payment.paidOn === prepared.body.paidOn && x.payment.paymentMethod === prepared.body.paymentMethod;
      });
    }
  });
})();
