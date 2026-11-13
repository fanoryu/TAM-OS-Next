/* ============================================================
   TRANSACTION API (Phase 1, D-INT-1 / D-INT-2) — js/core/transaction-api.js
   ------------------------------------------------------------
   The SESSION-mode client for the general transactions and the financial report: two reads over
   ApiClient and two writes over authSessionMutation (js/core/auth-boot.js), each answer strictly
   decoded before anything else sees it. CEO only: SessionLedger never calls this for anyone else
   (the server answers 403 anyway, before any lookup).

     range(from, to)            GET  /api/general-transactions?from=&to=      the transactions dated
                                in the inclusive range, oldest first
     report(from, to)           GET  /api/reports/financial?from=&to=         the Financial Post
                                lines, the general total, the voided rows, the separate Payroll line
                                and the consolidated total
     create(values, key)        POST /api/general-transactions/create         one income or expense
     void(id, reason, key)      POST /api/general-transactions/void           the only correction

   FINANCIAL POSTS: the four fixed codes are FINANCIAL_POSTS — the same closed list, in the same
   order, as server/src/Transaction/FinancialPost.php and migration 0036's CHECK
   (tools/verify-backend-boundary.js checks the three agree). A Financial Post is not a category:
   the category is a separate free-text field. Payroll is never a Financial Post and never a
   general transaction — it is the report's own Payroll line.

   STRICT DECODING: a transaction has exactly TransactionView::FIELDS (never the company or the
   idempotency key) with the server's grammars, and its status is Active with a null void or Voided
   with exactly { reason, voidedByUserId, voidedAt }. A range list holds at most
   TRANSACTION_LIST_CAP rows, each id once, every date inside the range, in date order. A report
   holds exactly the four posts in FINANCIAL_POSTS order and every amount is "N.00" ("-N.00" only
   for a net). Anything else is INVALID_RESPONSE and nothing of it is returned. MONEY is the exact
   server string: never parsed into a float, never rounded, never recomputed here.

   Nothing is persisted, cached, logged or resent here. The idempotency key of a write is made
   once per deliberate submit (payrollIdempotencyKey, Web Crypto) and kept only in memory by the
   caller, so a retry after an ambiguous answer replays the same write instead of making a second.

   Classic shared global scope; top-level `const` bindings, not on window.
   ============================================================ */

// server/src/Transaction/FinancialPost.php — codes and display names, in order.
const FINANCIAL_POSTS = Object.freeze([
  Object.freeze({ code: 'GA', name: 'GA' }),
  Object.freeze({ code: 'NPIP', name: 'NP & IP' }),
  Object.freeze({ code: 'TJB', name: 'TJB' }),
  Object.freeze({ code: 'DRONE', name: 'Drone' })
]);
// TransactionView::FIELDS and VOID_FIELDS (sorted); TransactionInput limits; TransactionStore::LIST_CAP.
const TRANSACTION_KEYS = Object.freeze(['amount', 'category', 'createdAt', 'createdByUserId', 'description', 'financialPost', 'id', 'kind', 'status', 'transactionDate', 'void']);
const TRANSACTION_VOID_KEYS = Object.freeze(['reason', 'voidedAt', 'voidedByUserId']);
const TRANSACTION_KINDS = Object.freeze(['income', 'expense']);
const TRANSACTION_PAYROLL_CATEGORIES = Object.freeze(['gaji', 'payroll', 'salary']);
const TRANSACTION_LIMITS = Object.freeze({ category: 64, description: 500, reason: 200, rangeDays: 366 });
const TRANSACTION_LIST_CAP = 2000;
const TRANSACTION_API_INVALID = 'INVALID_RESPONSE';
const TRANSACTION_HEX32 = /^[0-9a-f]{32}$/;
const TRANSACTION_AMOUNT = /^(0|[1-9][0-9]{0,14})\.00$/;
const TRANSACTION_NET = /^-?(0|[1-9][0-9]{0,18})\.00$/;
const TRANSACTION_TOTAL = /^(0|[1-9][0-9]{0,18})\.00$/;
const TRANSACTION_INSTANT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/;
const TRANSACTION_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TRANSACTION_JAKARTA_OFFSET_MS = 25200000;
const TRANSACTION_ROUTES = Object.freeze({
  range: '/api/general-transactions', report: '/api/reports/financial',
  create: '/api/general-transactions/create', void: '/api/general-transactions/void'
});

function transactionIsPost(v){ return typeof v === 'string' && FINANCIAL_POSTS.some(function(p){ return p.code === v; }); }
function transactionPostName(code){
  const p = FINANCIAL_POSTS.find(function(x){ return x.code === code; });
  return p ? p.name : '';
}
// A real calendar date "YYYY-MM-DD" from 1900-01-01 (the pure OvertimeCalendar helper).
function transactionIsDate(v){
  return typeof v === 'string' && TRANSACTION_DATE.test(v) && OvertimeCalendar.isDateIn(v, v.slice(0, 7));
}
// The company calendar's today of `now` (a Date): a hint and the default range, never authority.
function transactionToday(now){
  return new Date((now || new Date()).getTime() + TRANSACTION_JAKARTA_OFFSET_MS).toISOString().slice(0, 10);
}
// The first and last day of the company-calendar month of `now`: the range the section opens on.
function transactionMonthRange(now){
  const month = transactionToday(now).slice(0, 7);
  return Object.freeze({ from: month + '-01', to: month + '-' + String(OvertimeCalendar.daysIn(month)).padStart(2, '0') });
}
// from <= to, both real dates, at most TRANSACTION_LIMITS.rangeDays days (TransactionInput::range).
function transactionIsRange(from, to){
  if(!transactionIsDate(from) || !transactionIsDate(to) || from > to) return false;
  const days = (Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86400000 + 1;
  return days <= TRANSACTION_LIMITS.rangeDays;
}
// 1..max characters (code points), no control character, no surrounding whitespace (TransactionInput::isText).
function transactionIsText(v, max){
  if(typeof v !== 'string' || v === '' || /[\u0000-\u001f\u007f-\u009f]/.test(v) || v.trim() !== v) return false;
  return Array.from(v).length <= max;
}
function transactionIsAmount(v){ return typeof v === 'string' && TRANSACTION_AMOUNT.test(v) && v !== '0.00'; }

const TransactionDecoders = (function(){
  function isPlain(v){
    return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  }
  function exactKeys(o, keys){
    const k = Object.keys(o).sort();
    if(k.length !== keys.length) return false;
    for(let i = 0; i < k.length; i++){ if(k[i] !== keys[i]) return false; }
    return true;
  }
  // A frozen copy holding exactly the transaction keys, or null.
  function transaction(o){
    if(!isPlain(o) || !exactKeys(o, TRANSACTION_KEYS)) return null;
    if(typeof o.id !== 'string' || !TRANSACTION_HEX32.test(o.id) || TRANSACTION_KINDS.indexOf(o.kind) === -1 || !transactionIsPost(o.financialPost)) return null;
    if(!transactionIsText(o.category, TRANSACTION_LIMITS.category) || !transactionIsText(o.description, TRANSACTION_LIMITS.description)) return null;
    if(!transactionIsAmount(o.amount) || !transactionIsDate(o.transactionDate)) return null;
    if(typeof o.createdByUserId !== 'string' || !TRANSACTION_HEX32.test(o.createdByUserId) || typeof o.createdAt !== 'string' || !TRANSACTION_INSTANT.test(o.createdAt)) return null;
    let voided = null;
    if(o.status === 'Active'){
      if(o.void !== null) return null;
    } else if(o.status === 'Voided'){
      const v = o.void;
      if(!isPlain(v) || !exactKeys(v, TRANSACTION_VOID_KEYS) || !transactionIsText(v.reason, TRANSACTION_LIMITS.reason)
        || typeof v.voidedByUserId !== 'string' || !TRANSACTION_HEX32.test(v.voidedByUserId) || typeof v.voidedAt !== 'string' || !TRANSACTION_INSTANT.test(v.voidedAt)) return null;
      voided = Object.freeze({ reason: v.reason, voidedByUserId: v.voidedByUserId, voidedAt: v.voidedAt });
    } else return null;
    const out = {};
    for(let i = 0; i < TRANSACTION_KEYS.length; i++) out[TRANSACTION_KEYS[i]] = o[TRANSACTION_KEYS[i]];
    out.void = voided;
    return Object.freeze(out);
  }
  // { generalTransactions: [transaction…] } -> frozen array, or null: at most the cap, each id once,
  // every date inside the range, in date order.
  function rangeResponse(data, from, to){
    if(!isPlain(data) || !exactKeys(data, ['generalTransactions']) || !Array.isArray(data.generalTransactions) || data.generalTransactions.length > TRANSACTION_LIST_CAP) return null;
    const out = [];
    for(let i = 0; i < data.generalTransactions.length; i++){
      const t = transaction(data.generalTransactions[i]);
      if(!t || t.transactionDate < from || t.transactionDate > to) return null;
      if(out.length && out[out.length - 1].transactionDate > t.transactionDate) return null;
      out.push(t);
    }
    return new Set(out.map(function(t){ return t.id; })).size === out.length ? Object.freeze(out) : null;
  }
  function count(v){ return Number.isSafeInteger(v) && v >= 0; }
  function line(o, keys, pattern){
    if(!isPlain(o) || !exactKeys(o, keys.slice().sort())) return false;
    return keys.every(function(k){ return k === 'count' ? count(o[k]) : (k === 'net' ? typeof o[k] === 'string' && TRANSACTION_NET.test(o[k]) : typeof o[k] === 'string' && pattern.test(o[k])); });
  }
  // True when { financialReport: report } is exactly a report of this range.
  function validReport(data, from, to){
    if(!isPlain(data) || !exactKeys(data, ['financialReport'])) return false;
    const r = data.financialReport;
    if(!isPlain(r) || !exactKeys(r, ['consolidated', 'from', 'general', 'payroll', 'posts', 'to', 'voided']) || r.from !== from || r.to !== to) return false;
    if(!Array.isArray(r.posts) || r.posts.length !== FINANCIAL_POSTS.length) return false;
    for(let i = 0; i < FINANCIAL_POSTS.length; i++){
      const p = r.posts[i];
      if(!isPlain(p) || p.code !== FINANCIAL_POSTS[i].code || p.name !== FINANCIAL_POSTS[i].name || !exactKeys(p, ['code', 'count', 'expense', 'income', 'name', 'net'])) return false;
      if(!line({ income: p.income, expense: p.expense, net: p.net, count: p.count }, ['income', 'expense', 'net', 'count'], TRANSACTION_TOTAL)) return false;
    }
    if(!line(r.general, ['income', 'expense', 'net', 'count'], TRANSACTION_TOTAL) || !line(r.voided, ['count', 'amount'], TRANSACTION_TOTAL)) return false;
    const pr = r.payroll;
    if(!isPlain(pr) || !exactKeys(pr, ['paid', 'posted'])) return false;
    const posted = pr.posted;
    if(!isPlain(posted) || !exactKeys(posted, ['amount', 'count', 'fromMonth', 'toMonth']) || typeof posted.amount !== 'string' || !TRANSACTION_TOTAL.test(posted.amount) || !count(posted.count)
      || posted.fromMonth !== from.slice(0, 7) || posted.toMonth !== to.slice(0, 7)) return false;
    return line(pr.paid, ['amount', 'count'], TRANSACTION_TOTAL) && line(r.consolidated, ['income', 'expense', 'net'], TRANSACTION_TOTAL);
  }
  return Object.freeze({
    transaction: transaction,
    rangeResponse: rangeResponse,
    // { financialReport: report } of exactly this range -> a frozen copy, or null.
    reportResponse: function(data, from, to){
      if(!validReport(data, from, to)) return null;
      const copy = JSON.parse(JSON.stringify(data.financialReport));
      copy.posts = Object.freeze(copy.posts.map(Object.freeze));
      ['general', 'voided', 'consolidated'].forEach(function(k){ Object.freeze(copy[k]); });
      copy.payroll = Object.freeze({ posted: Object.freeze(copy.payroll.posted), paid: Object.freeze(copy.payroll.paid) });
      return Object.freeze(copy);
    },
    // { generalTransaction: transaction } -> the transaction, or null.
    writeResponse(data){
      if(!isPlain(data) || !exactKeys(data, ['generalTransaction'])) return null;
      return transaction(data.generalTransaction);
    }
  });
})();

// The request bodies: exactly the server's allowlists, validated with its grammar. A body outside
// it is never sent — { ok: false, fields } names what to correct.
const TransactionRequests = Object.freeze({
  create(values, key){
    const v = values || {};
    const bad = [];
    if(TRANSACTION_KINDS.indexOf(v.kind) === -1) bad.push('kind');
    if(!transactionIsPost(v.financialPost)) bad.push('financialPost');
    if(!transactionIsText(v.category, TRANSACTION_LIMITS.category) || TRANSACTION_PAYROLL_CATEGORIES.indexOf(String(v.category).toLowerCase()) !== -1) bad.push('category');
    if(!transactionIsText(v.description, TRANSACTION_LIMITS.description)) bad.push('description');
    if(!transactionIsAmount(v.amount)) bad.push('amount');
    if(!transactionIsDate(v.transactionDate)) bad.push('transactionDate');
    if(typeof key !== 'string' || !TRANSACTION_HEX32.test(key)) bad.push('idempotencyKey');
    if(bad.length) return Object.freeze({ ok: false, fields: Object.freeze(bad) });
    return Object.freeze({ ok: true, body: Object.freeze({ kind: v.kind, financialPost: v.financialPost, category: v.category, description: v.description,
      amount: v.amount, transactionDate: v.transactionDate, idempotencyKey: key }) });
  },
  void(id, reason, key){
    const bad = [];
    if(typeof id !== 'string' || !TRANSACTION_HEX32.test(id)) bad.push('financeTransactionId');
    if(!transactionIsText(reason, TRANSACTION_LIMITS.reason)) bad.push('reason');
    if(typeof key !== 'string' || !TRANSACTION_HEX32.test(key)) bad.push('idempotencyKey');
    if(bad.length) return Object.freeze({ ok: false, fields: Object.freeze(bad) });
    return Object.freeze({ ok: true, body: Object.freeze({ financeTransactionId: id, reason: reason, idempotencyKey: key }) });
  }
});

const TransactionApi = (function(){
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
    let out = outcome(sent.result, TransactionDecoders.writeResponse);
    if(out.ok && !confirms(out.data)) out = invalid;
    return Object.freeze(Object.assign({}, out, { recovery: sent.recovery }));
  }

  return Object.freeze({
    async range(from, to){
      if(!transactionIsRange(from, to)) return refused;
      const res = await ApiClient.request(TRANSACTION_ROUTES.range, { method: 'GET', query: { from: from, to: to } });
      return outcome(res, function(d){ return TransactionDecoders.rangeResponse(d, from, to); });
    },
    async report(from, to){
      if(!transactionIsRange(from, to)) return refused;
      const res = await ApiClient.request(TRANSACTION_ROUTES.report, { method: 'GET', query: { from: from, to: to } });
      return outcome(res, function(d){ return TransactionDecoders.reportResponse(d, from, to); });
    },
    // Confirmed only by an Active transaction holding exactly the values sent.
    create(values, key){
      const prepared = TransactionRequests.create(values, key);
      return write(TRANSACTION_ROUTES.create, prepared, function(t){
        const b = prepared.body;
        return t.status === 'Active' && t.kind === b.kind && t.financialPost === b.financialPost && t.category === b.category
          && t.description === b.description && t.amount === b.amount && t.transactionDate === b.transactionDate;
      });
    },
    // Confirmed only by the same transaction, Voided, with the reason sent.
    void(id, reason, key){
      return write(TRANSACTION_ROUTES.void, TransactionRequests.void(id, reason, key), function(t){
        return t.id === id && t.status === 'Voided' && t.void.reason === reason;
      });
    }
  });
})();
