/* ============================================================
   PAYROLL API (AFI-4c1, AFI-4c2, AFI-4d, AFI-4e, AFI-4f) — js/core/payroll-api.js
   ------------------------------------------------------------
   The SESSION-mode client for the server payroll plan (BF-4c1, PR #44; BF-4c2, PR #46): three
   reads over ApiClient and six writes over authSessionMutation (js/core/auth-boot.js), each
   answer strictly decoded before anything else sees it. The writes and the drift read are the
   CEO's; an Employee reads only their own Committed plans (myMonth / myGet), and SessionPayroll
   never calls anything else for them (the server answers 403 anyway).

     month(monthKey)   GET /api/payroll-plans?month=YYYY-MM   every plan of the month, Cancelled
                                                             included, in the server's order
     get(id)           GET /api/payroll-plan?id=<id>          one plan and its contributing overtime

     generate(monthKey)              POST /api/payroll-plans/generate   { month } — Drafts for the
                                     eligible employees, Drafts recalculated; answers the month's
                                     live plans and the excluded employees
     review / approve / returnToDraft / cancel(id, expectedVersion)
                                     POST /api/payroll-plans/review | approve | return | cancel
                                     Draft → Reviewed; Draft / Reviewed → Ready; Reviewed / Ready →
                                     Draft; Draft / Reviewed / Ready → Cancelled

   AFI-4c2 (owner decisions D-AFI4c2-1..3 = A):
     drift(id)         GET /api/payroll-plan/drift?id=<id>    { id, current, reasons } — why a plan
                                     no longer matches TAM OS; explanatory only, never authority
     commit(intent)    POST /api/payroll-plans/commit         exactly { id, expectedVersion,
                                     expectedTotal, idempotencyKey } from ONE commit intent: the
                                     plan's own decoded totalAmount string, unchanged, and a key of
                                     16 Web Crypto random bytes (payrollIdempotencyKey). Confirmed
                                     only by the same plan, Committed, at expectedVersion + 1, with
                                     exactly expectedTotal. A retry sends the same intent again.
     myMonth(monthKey, employeeId) / myGet(id, employeeId)
                                     the Employee's reads: the same two routes, and every plan must
                                     be Committed and the principal's own — defence in depth only,
                                     the server scopes them

   MONEY IS THE SERVER'S (BF-4c1, owner decisions D-PAY-2/3 = A): Base Salary + the frozen
   approved amounts of the month's Approved overtime, calculated by the server. Every amount is
   decoded as the exact string the server sent (server/src/Payroll/PayrollView.php) and is only
   ever checked for its shape: nothing here adds, rounds, compares or converts money, and no
   overtime valuation exists here.

   STRICT DECODING: each wrapper, plan, contributing overtime row and exclusion has exactly its
   keys, with the server's types and formats; anything else is INVALID_RESPONSE and nothing of it
   is returned. A list holds only plans of the month asked for; one bad item fails the whole
   answer. The status vocabulary is BF-4c1's (PayrollStatus::VALUES): Committed is recognized —
   BF-4c1 cannot produce it — and is display-only here (D-AFI4c1-1 = A). An exclusion reason is
   one of the three BF-4c1 codes (PayrollService::EXCLUSIONS); an unknown one fails the answer.

   WRITES: PayrollRequests is the allowlisted mirror of the server's PayrollInput — exactly
   { month }, { id, expectedVersion } and (commit) { id, expectedVersion, expectedTotal,
   idempotencyKey }. Never an employee, company, role, salary, amount or status. A success counts
   only when the decoded answer
   confirms it (generate: every plan of the month asked for; a transition: the same plan in the
   target status at expectedVersion + 1) — otherwise INVALID_RESPONSE. Nothing is persisted,
   cached, logged or resent here.

   AFI-4d: SupplementalDecoders, SupplementalRequests and SupplementalApi (end of this file) are the
   client of the BF-4d Supplemental Payroll routes, over the same wire.
   AFI-4e: FinancePostingDecoders, FinancePostingRequests and FinancePostingApi (after them) are the
   client of the BF-4e Finance posting routes (D-AFI4e-2 = A: this module, no new one).
   AFI-4f: FinanceExecutionDecoders, FinanceExecutionRequests and FinanceExecutionApi (end of this
   file) are the client of the BF-4f Finance execution routes (D-AFI4f-2 = A: this module, no new one).

   Classic shared global scope; top-level `const` bindings, not on window.
   ============================================================ */

// The decoders' failure kind, beside ApiClient's API_RESULT_KINDS.
const PAYROLL_API_INVALID = 'INVALID_RESPONSE';
// server/src/Payroll/PayrollStatus.php VALUES (order included); PayrollInput ID_PATTERN.
const PAYROLL_PLAN_STATUSES = Object.freeze(['Draft', 'Reviewed', 'Ready', 'Committed', 'Cancelled']);
const PAYROLL_ID_PATTERN = /^[0-9a-f]{32}$/;
const PAYROLL_EMPLOYEE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PAYROLL_MAX_VERSION = 4294967295;
// PayrollView::FIELDS and OVERTIME_FIELDS, sorted for the exact-key comparison.
const PAYROLL_PLAN_KEYS = Object.freeze(['baseSalary', 'department', 'employeeCode', 'employeeId', 'employeeName', 'id', 'monthKey',
  'overtimeAmount', 'overtimeCount', 'overtimeHours', 'status', 'totalAmount', 'version']);
const PAYROLL_OVERTIME_KEYS = Object.freeze(['amount', 'hours', 'id']);
const PAYROLL_EXCLUDED_KEYS = Object.freeze(['employeeId', 'reason']);
// PayrollService::EXCLUSIONS.
const PAYROLL_EXCLUSION_REASONS = Object.freeze(['archived', 'not_active', 'salary_missing']);
// The exact money and hours shapes (PayrollCalculation::isSalary, isAmount, isHoursTotal; an
// overtime record's hours are OvertimeInput hours) — patterns over strings, never numbers.
const PAYROLL_SALARY_PATTERN = /^(0|[1-9][0-9]{0,12})\.([0-9]{2})$/;
const PAYROLL_AMOUNT_PATTERN = /^(0|[1-9][0-9]{0,14})\.00$/;
const PAYROLL_HOURS_TOTAL_PATTERN = /^(0|[1-9][0-9]{0,6})\.(00|25|50|75)$/;
const PAYROLL_RECORD_HOURS_PATTERN = /^(0|[1-9][0-9]{0,2})\.(00|25|50|75)$/;
// The transitions: operation → [route, target status].
// AFI-4c2: BF-4c2 PayrollDrift::REASONS (canonical order) and PayrollView::DRIFT_FIELDS (sorted);
// PayrollInput::KEY_PATTERN.
const PAYROLL_DRIFT_REASONS = Object.freeze(['employee_archived', 'employee_not_active', 'salary_missing', 'salary_changed', 'overtime_changed']);
const PAYROLL_DRIFT_KEYS = Object.freeze(['current', 'id', 'reasons']);
const PAYROLL_KEY_PATTERN = /^[0-9a-f]{32}$/;
const PAYROLL_HEX = '0123456789abcdef';
const PAYROLL_TRANSITIONS = Object.freeze({
  review: Object.freeze(['/api/payroll-plans/review', 'Reviewed']),
  approve: Object.freeze(['/api/payroll-plans/approve', 'Ready']),
  return: Object.freeze(['/api/payroll-plans/return', 'Draft']),
  cancel: Object.freeze(['/api/payroll-plans/cancel', 'Cancelled'])
});

// Shapes only, as strings: nothing here is a number.
function payrollIsSalary(v){ return typeof v === 'string' && PAYROLL_SALARY_PATTERN.test(v) && v !== '0.00'; }
function payrollIsAmount(v){ return typeof v === 'string' && PAYROLL_AMOUNT_PATTERN.test(v); }
function payrollIsHoursTotal(v){ return typeof v === 'string' && PAYROLL_HOURS_TOTAL_PATTERN.test(v); }
// An overtime record's hours: more than 0 and at most 744.00, in quarter hours (string-wise).
function payrollIsRecordHours(v){
  if(typeof v !== 'string' || !PAYROLL_RECORD_HOURS_PATTERN.test(v) || v === '0.00') return false;
  const whole = v.slice(0, v.indexOf('.'));
  return whole.length < 3 || whole < '744' || v === '744.00';
}

// AFI-4c2: one commit idempotency key — 16 bytes from Web Crypto as 32 lowercase hex characters,
// or null when this browser offers no crypto.getRandomValues (the commit is then not sent).
// Never Math.random; never stored anywhere but the in-memory commit intent.
function payrollIdempotencyKey(){
  const c = (typeof crypto !== 'undefined') ? crypto : null;
  if(!c || typeof c.getRandomValues !== 'function') return null;
  const bytes = c.getRandomValues(new Uint8Array(16));
  let out = '';
  for(let i = 0; i < 16; i++) out += PAYROLL_HEX.charAt(bytes[i] >> 4) + PAYROLL_HEX.charAt(bytes[i] & 15);
  return PAYROLL_KEY_PATTERN.test(out) ? out : null;
}

const PayrollDecoders = (function(){
  function isPlain(v){
    return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  }
  function exactKeys(o, keys){
    const k = Object.keys(o).sort();
    if(k.length !== keys.length) return false;
    for(let i = 0; i < k.length; i++){ if(k[i] !== keys[i]) return false; }
    return true;
  }
  const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
  function text(v, max){ return typeof v === 'string' && v.length > 0 && Array.from(v).length <= max && !CONTROL.test(v); }
  const checks = {
    id: (v) => typeof v === 'string' && PAYROLL_ID_PATTERN.test(v),
    employeeId: (v) => typeof v === 'string' && PAYROLL_EMPLOYEE_ID_PATTERN.test(v),
    monthKey: (v) => OvertimeCalendar.isMonth(v),
    status: (v) => PAYROLL_PLAN_STATUSES.indexOf(v) !== -1,
    employeeCode: (v) => text(v, 32),
    employeeName: (v) => text(v, 160),
    department: (v) => v === null || text(v, 120),
    baseSalary: (v) => payrollIsSalary(v),
    overtimeAmount: (v) => payrollIsAmount(v),
    overtimeHours: (v) => payrollIsHoursTotal(v),
    overtimeCount: (v) => Number.isInteger(v) && v >= 0 && v <= PAYROLL_MAX_VERSION,
    totalAmount: (v) => payrollIsAmount(v),
    version: (v) => Number.isInteger(v) && v >= 1 && v <= PAYROLL_MAX_VERSION
  };
  // A frozen copy holding exactly the plan keys, or null. The overtime fields agree with each
  // other as the server's schema requires (no record: no hours and no amount) — a shape check,
  // never a sum.
  function plan(o){
    if(!isPlain(o) || !exactKeys(o, PAYROLL_PLAN_KEYS)) return null;
    const out = {};
    for(let i = 0; i < PAYROLL_PLAN_KEYS.length; i++){
      const k = PAYROLL_PLAN_KEYS[i];
      if(!checks[k](o[k])) return null;
      out[k] = o[k];
    }
    if((o.overtimeCount === 0) !== (o.overtimeHours === '0.00') || (o.overtimeCount === 0 && o.overtimeAmount !== '0.00')) return null;
    return Object.freeze(out);
  }
  function overtimeRow(o){
    if(!isPlain(o) || !exactKeys(o, PAYROLL_OVERTIME_KEYS) || !checks.id(o.id) || !payrollIsRecordHours(o.hours) || !payrollIsAmount(o.amount)) return null;
    return Object.freeze({ id: o.id, hours: o.hours, amount: o.amount });
  }
  function excludedItem(o){
    if(!isPlain(o) || !exactKeys(o, PAYROLL_EXCLUDED_KEYS) || !checks.employeeId(o.employeeId) || PAYROLL_EXCLUSION_REASONS.indexOf(o.reason) === -1) return null;
    return Object.freeze({ employeeId: o.employeeId, reason: o.reason });
  }
  // [plan…] of exactly `monthKey` -> frozen array, or null; `live` refuses a Cancelled plan.
  function plans(items, monthKey, live){
    if(!Array.isArray(items)) return null;
    const out = [];
    for(let i = 0; i < items.length; i++){
      const item = plan(items[i]);
      if(!item || item.monthKey !== monthKey || (live && item.status === 'Cancelled')) return null;
      out.push(item);
    }
    return Object.freeze(out);
  }
  return Object.freeze({
    plan: plan,
    overtimeRow: overtimeRow,
    excludedItem: excludedItem,
    // { payrollPlans: [plan…] } of exactly `monthKey` -> frozen array, or null.
    monthResponse(data, monthKey){
      return (isPlain(data) && exactKeys(data, ['payrollPlans'])) ? plans(data.payrollPlans, monthKey, false) : null;
    },
    // { payrollPlan, payrollPlanOvertime: [{ id, hours, amount }…] } -> { plan, overtime }, or null.
    detailResponse(data){
      if(!isPlain(data) || !exactKeys(data, ['payrollPlan', 'payrollPlanOvertime']) || !Array.isArray(data.payrollPlanOvertime)) return null;
      const p = plan(data.payrollPlan);
      if(!p) return null;
      const rows = [];
      for(let i = 0; i < data.payrollPlanOvertime.length; i++){
        const r = overtimeRow(data.payrollPlanOvertime[i]);
        if(!r) return null;
        rows.push(r);
      }
      return Object.freeze({ plan: p, overtime: Object.freeze(rows) });
    },
    // { payrollPlan } -> the plan, or null.
    planResponse(data){
      return (isPlain(data) && exactKeys(data, ['payrollPlan'])) ? plan(data.payrollPlan) : null;
    },
    // { payrollPlans: [live plan…], excluded: [{ employeeId, reason }…] } of `monthKey` ->
    // { plans, excluded }, or null.
    generateResponse(data, monthKey){
      if(!isPlain(data) || !exactKeys(data, ['excluded', 'payrollPlans']) || !Array.isArray(data.excluded)) return null;
      const p = plans(data.payrollPlans, monthKey, true);
      if(!p) return null;
      const ex = [];
      for(let i = 0; i < data.excluded.length; i++){
        const e = excludedItem(data.excluded[i]);
        if(!e) return null;
        ex.push(e);
      }
      return Object.freeze({ plans: p, excluded: Object.freeze(ex) });
    },
    // AFI-4c2: { payrollPlanDrift: { id, current, reasons } } of plan `id` -> frozen copy, or
    // null. reasons: the closed BF-4c2 codes, each once, in their canonical order; current is
    // true exactly when there is none. Nothing else — never a salary, total or other value.
    driftResponse(data, id){
      if(!isPlain(data) || !exactKeys(data, ['payrollPlanDrift'])) return null;
      const d = data.payrollPlanDrift;
      if(!isPlain(d) || !exactKeys(d, PAYROLL_DRIFT_KEYS) || d.id !== id || typeof d.current !== 'boolean' || !Array.isArray(d.reasons)) return null;
      let last = -1;
      for(let i = 0; i < d.reasons.length; i++){
        const at = PAYROLL_DRIFT_REASONS.indexOf(d.reasons[i]);
        if(at <= last) return null;            // unknown, repeated or out of order
        last = at;
      }
      if(d.current !== (d.reasons.length === 0)) return null;
      return Object.freeze({ id: d.id, current: d.current, reasons: Object.freeze(d.reasons.slice()) });
    },
    // AFI-4c2: the Employee's own Committed plan, or null (defence in depth; the server scopes).
    ownCommitted(p, employeeId){
      return (p && p.status === 'Committed' && typeof employeeId === 'string' && p.employeeId === employeeId) ? p : null;
    }
  });
})();

// The allowlisted request mirror of PayrollInput: { ok: true, body } or { ok: false, fields }.
const PayrollRequests = Object.freeze({
  // POST /api/payroll-plans/generate: exactly { month }.
  generate(monthKey){
    return OvertimeCalendar.isMonth(monthKey) ? Object.freeze({ ok: true, body: { month: monthKey } }) : Object.freeze({ ok: false, fields: Object.freeze(['month']) });
  },
  // review / approve / return / cancel: exactly { id, expectedVersion }.
  target(id, expectedVersion){
    const bad = [];
    if(typeof id !== 'string' || !PAYROLL_ID_PATTERN.test(id)) bad.push('id');
    if(!Number.isInteger(expectedVersion) || expectedVersion < 1 || expectedVersion > PAYROLL_MAX_VERSION) bad.push('expectedVersion');
    return bad.length ? Object.freeze({ ok: false, fields: Object.freeze(bad) }) : Object.freeze({ ok: true, body: { id: id, expectedVersion: expectedVersion } });
  },
  // AFI-4c2 commit: exactly { id, expectedVersion, expectedTotal, idempotencyKey } of one intent —
  // the total is the plan's decoded totalAmount string, sent as it is.
  commit(intent){
    const i = intent || {};
    const t = PayrollRequests.target(i.id, i.version);
    const bad = t.ok ? [] : t.fields.slice();
    if(!payrollIsAmount(i.total)) bad.push('expectedTotal');
    if(typeof i.key !== 'string' || !PAYROLL_KEY_PATTERN.test(i.key)) bad.push('idempotencyKey');
    return bad.length ? Object.freeze({ ok: false, fields: Object.freeze(bad) })
      : Object.freeze({ ok: true, body: { id: i.id, expectedVersion: i.version, expectedTotal: i.total, idempotencyKey: i.key } });
  }
});

// The wire of PayrollApi and (AFI-4d) SupplementalApi — one implementation for both.
// ApiResult -> { ok: true, data } | { ok: false, kind, fields?, retryAfter?, requestId? }.
function payrollApiOutcome(res, decode){
  if(!res.ok){
    const failed = { ok: false, kind: res.kind };
    if(res.fields) failed.fields = res.fields;
    if(res.retryAfter !== undefined) failed.retryAfter = res.retryAfter;
    if(res.requestId) failed.requestId = res.requestId;
    return Object.freeze(failed);
  }
  const data = decode(res.data);
  if(data === null){
    const invalid = { ok: false, kind: PAYROLL_API_INVALID };
    if(res.requestId) invalid.requestId = res.requestId;
    return Object.freeze(invalid);
  }
  return Object.freeze({ ok: true, data: data });
}
const PAYROLL_API_REFUSED = Object.freeze({ ok: false, kind: PAYROLL_API_INVALID });

// One write through the established CSRF path. A refused request is never sent; an answer
// carries authSessionMutation's recovery, and only a strictly decoded answer that `confirms`
// the write is a success.
async function payrollApiWrite(route, prepared, decode, confirms){
  if(!prepared.ok) return Object.freeze({ ok: false, kind: API_RESULT_KINDS.VALIDATION, fields: prepared.fields, local: true, recovery: 'none' });
  const sent = await authSessionMutation(route, prepared.body);
  let out = payrollApiOutcome(sent.result, decode);
  if(out.ok && !confirms(out.data)) out = PAYROLL_API_REFUSED;
  return Object.freeze(Object.assign({}, out, { recovery: sent.recovery }));
}

const PayrollApi = (function(){
  const outcome = payrollApiOutcome, write = payrollApiWrite, refused = PAYROLL_API_REFUSED;
  // A transition: confirmed only by the same plan, in the target status, one version on.
  function transition(operation){
    const t = PAYROLL_TRANSITIONS[operation];
    return (id, expectedVersion) => write(t[0], PayrollRequests.target(id, expectedVersion), (d) => PayrollDecoders.planResponse(d),
      (p) => p.id === id && p.status === t[1] && p.version === expectedVersion + 1);
  }

  return Object.freeze({
    async month(monthKey){
      if(!OvertimeCalendar.isMonth(monthKey)) return refused;
      const res = await ApiClient.request('/api/payroll-plans', { method: 'GET', query: { month: monthKey } });
      return outcome(res, (d) => PayrollDecoders.monthResponse(d, monthKey));
    },
    async get(id){
      if(typeof id !== 'string' || !PAYROLL_ID_PATTERN.test(id)) return refused;
      const res = await ApiClient.request('/api/payroll-plan', { method: 'GET', query: { id: id } });
      const out = outcome(res, (d) => PayrollDecoders.detailResponse(d));
      return out.ok && out.data.plan.id !== id ? refused : out;
    },
    generate(monthKey){
      return write('/api/payroll-plans/generate', PayrollRequests.generate(monthKey), (d) => PayrollDecoders.generateResponse(d, monthKey), () => true);
    },
    review: transition('review'),
    approve: transition('approve'),
    returnToDraft: transition('return'),
    cancel: transition('cancel'),
    // AFI-4c2: the CEO drift read of plan `id`.
    async drift(id){
      if(typeof id !== 'string' || !PAYROLL_ID_PATTERN.test(id)) return refused;
      const res = await ApiClient.request('/api/payroll-plan/drift', { method: 'GET', query: { id: id } });
      return outcome(res, (d) => PayrollDecoders.driftResponse(d, id));
    },
    // AFI-4c2: one commit intent { id, version, total, key }, sent once per deliberate click.
    commit(intent){
      return write('/api/payroll-plans/commit', PayrollRequests.commit(intent), (d) => PayrollDecoders.planResponse(d),
        (p) => p.id === intent.id && p.status === 'Committed' && p.version === intent.version + 1 && p.totalAmount === intent.total);
    },
    // AFI-4c2: the Employee's reads — every plan Committed and their own, else INVALID_RESPONSE.
    async myMonth(monthKey, employeeId){
      const out = await PayrollApi.month(monthKey);
      return out.ok && !out.data.every((p) => PayrollDecoders.ownCommitted(p, employeeId)) ? refused : out;
    },
    async myGet(id, employeeId){
      const out = await PayrollApi.get(id);
      return out.ok && !PayrollDecoders.ownCommitted(out.data.plan, employeeId) ? refused : out;
    }
  });
})();

/* ============================================================
   AFI-4d — SUPPLEMENTAL PAYROLL (over BF-4d, PR #48; owner decisions D-AFI4d-1/2 = A)
   ------------------------------------------------------------
   The SESSION client of the server Supplemental Payroll document: a separate obligation for one
   employee and month that settles Approved overtime NOT contained in the employee's
   already-Committed base payroll plan. Three reads over ApiClient and six writes over
   authSessionMutation, each answer strictly decoded:

     month(monthKey)        GET /api/supplemental-payrolls?month=        every document of the month,
                                                                         Cancelled included (CEO)
     get(id)                GET /api/supplemental-payroll?id=            one document and its captured
                                                                         overtime (frozen amounts)
     eligibility(monthKey)  GET /api/supplemental-payrolls/eligibility?month=   the month's Committed
                                                                         base plans with Approved overtime
                                                                         no plan or document holds (CEO)
     generate(planId, monthKey)      POST …/generate   exactly { payrollPlanId }: the base plan's open
                                     document — a new or recalculated Draft, or an open Reviewed /
                                     Ready document returned untouched. No idempotency key: at most
                                     one document per plan is open (BF-4d).
     review / approve / returnToDraft / cancel(id, expectedVersion)
                                     POST …/review | approve | return | cancel   exactly { id,
                                     expectedVersion }: Draft → Reviewed; Reviewed → Ready (there is
                                     NO Draft → Ready); Reviewed / Ready → Draft; Draft / Reviewed /
                                     Ready → Cancelled
     commit(intent)         POST …/commit   exactly { id, expectedVersion, expectedTotal,
                                     idempotencyKey } of one intent — the document's own decoded
                                     overtimeAmount string, unchanged, and payrollIdempotencyKey()
     myMonth / myGet        the Employee's reads: every document must be Committed and their own

   The grammars of an id, a version, a month, an amount and the key are BF-4d's, which are
   PayrollInput's — so the request encoders are PayrollRequests' own. Money is the server's exact
   strings: nothing here adds, rounds, compares as numbers or converts it.
   ============================================================ */

// server/src/Supplemental/SupplementalView.php FIELDS, OVERTIME_FIELDS (PayrollView's line shape),
// ELIGIBILITY_FIELDS — sorted for the exact-key comparison; SupplementalStatus::VALUES and OPEN.
const SUPPLEMENTAL_API_DOC_KEYS = Object.freeze(['department', 'employeeCode', 'employeeId', 'employeeName', 'id', 'monthKey',
  'overtimeAmount', 'overtimeCount', 'overtimeHours', 'payrollPlanId', 'status', 'version']);
const SUPPLEMENTAL_API_LINE_KEYS = Object.freeze(['amount', 'hours', 'id']);
const SUPPLEMENTAL_API_ELIGIBILITY_KEYS = Object.freeze(['eligibleAmount', 'eligibleCount', 'eligibleHours', 'employeeId', 'payrollPlanId']);
const SUPPLEMENTAL_API_STATUSES = Object.freeze(['Draft', 'Reviewed', 'Ready', 'Committed', 'Cancelled']);
const SUPPLEMENTAL_API_OPEN = Object.freeze(['Draft', 'Reviewed', 'Ready']);
// The transitions (SupplementalStatus::TRANSITIONS): operation → [route, target status].
const SUPPLEMENTAL_API_TRANSITIONS = Object.freeze({
  review: Object.freeze(['/api/supplemental-payrolls/review', 'Reviewed']),
  approve: Object.freeze(['/api/supplemental-payrolls/approve', 'Ready']),
  return: Object.freeze(['/api/supplemental-payrolls/return', 'Draft']),
  cancel: Object.freeze(['/api/supplemental-payrolls/cancel', 'Cancelled'])
});

const SupplementalDecoders = (function(){
  function isPlain(v){
    return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  }
  function exactKeys(o, keys){
    const k = Object.keys(o).sort();
    if(k.length !== keys.length) return false;
    for(let i = 0; i < k.length; i++){ if(k[i] !== keys[i]) return false; }
    return true;
  }
  const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
  function text(v, max){ return typeof v === 'string' && v.length > 0 && Array.from(v).length <= max && !CONTROL.test(v); }
  const isId = (v) => typeof v === 'string' && PAYROLL_ID_PATTERN.test(v);
  const validEmployeeId = (v) => typeof v === 'string' && PAYROLL_EMPLOYEE_ID_PATTERN.test(v);
  const isCount = (v) => Number.isInteger(v) && v >= 1 && v <= PAYROLL_MAX_VERSION;
  // A document captures at least one record, so its hours and its amount are never zero
  // (SupplementalView: a positive whole-Rupiah amount, a count of at least one).
  const checks = {
    id: isId,
    payrollPlanId: isId,
    employeeId: validEmployeeId,
    monthKey: (v) => OvertimeCalendar.isMonth(v),
    status: (v) => SUPPLEMENTAL_API_STATUSES.indexOf(v) !== -1,
    employeeCode: (v) => text(v, 32),
    employeeName: (v) => text(v, 160),
    department: (v) => v === null || text(v, 120),
    overtimeAmount: (v) => payrollIsAmount(v) && v !== '0.00',
    overtimeHours: (v) => payrollIsHoursTotal(v) && v !== '0.00',
    overtimeCount: isCount,
    version: (v) => Number.isInteger(v) && v >= 1 && v <= PAYROLL_MAX_VERSION
  };
  // A frozen copy holding exactly the twelve document keys, or null.
  function doc(o){
    if(!isPlain(o) || !exactKeys(o, SUPPLEMENTAL_API_DOC_KEYS)) return null;
    const out = {};
    for(let i = 0; i < SUPPLEMENTAL_API_DOC_KEYS.length; i++){
      const k = SUPPLEMENTAL_API_DOC_KEYS[i];
      if(!checks[k](o[k])) return null;
      out[k] = o[k];
    }
    return Object.freeze(out);
  }
  // A captured overtime line: { id, hours, amount } — the record, its hours, its frozen amount.
  function line(o){
    if(!isPlain(o) || !exactKeys(o, SUPPLEMENTAL_API_LINE_KEYS) || !isId(o.id) || !payrollIsRecordHours(o.hours) || !payrollIsAmount(o.amount)) return null;
    return Object.freeze({ id: o.id, hours: o.hours, amount: o.amount });
  }
  // An eligibility entry; its amount may be "0.00" (generate then refuses: nothing to settle).
  function eligible(o){
    if(!isPlain(o) || !exactKeys(o, SUPPLEMENTAL_API_ELIGIBILITY_KEYS) || !isId(o.payrollPlanId) || !validEmployeeId(o.employeeId)
      || !isCount(o.eligibleCount) || !payrollIsHoursTotal(o.eligibleHours) || o.eligibleHours === '0.00' || !payrollIsAmount(o.eligibleAmount)) return null;
    return Object.freeze({ payrollPlanId: o.payrollPlanId, employeeId: o.employeeId, eligibleCount: o.eligibleCount, eligibleHours: o.eligibleHours, eligibleAmount: o.eligibleAmount });
  }
  return Object.freeze({
    doc: doc,
    line: line,
    eligible: eligible,
    // { supplementalPayrolls: [doc…] } of exactly `monthKey` -> frozen array, or null.
    monthResponse(data, monthKey){
      if(!isPlain(data) || !exactKeys(data, ['supplementalPayrolls']) || !Array.isArray(data.supplementalPayrolls)) return null;
      const out = [];
      for(let i = 0; i < data.supplementalPayrolls.length; i++){
        const d = doc(data.supplementalPayrolls[i]);
        if(!d || d.monthKey !== monthKey) return null;
        out.push(d);
      }
      return Object.freeze(out);
    },
    // { supplementalPayroll, supplementalPayrollOvertime: [line…] } -> { doc, overtime }, or null.
    detailResponse(data){
      if(!isPlain(data) || !exactKeys(data, ['supplementalPayroll', 'supplementalPayrollOvertime']) || !Array.isArray(data.supplementalPayrollOvertime)) return null;
      const d = doc(data.supplementalPayroll);
      if(!d) return null;
      const rows = [];
      for(let i = 0; i < data.supplementalPayrollOvertime.length; i++){
        const r = line(data.supplementalPayrollOvertime[i]);
        if(!r) return null;
        rows.push(r);
      }
      return Object.freeze({ doc: d, overtime: Object.freeze(rows) });
    },
    // { supplementalPayroll } -> the document, or null.
    docResponse(data){
      return (isPlain(data) && exactKeys(data, ['supplementalPayroll'])) ? doc(data.supplementalPayroll) : null;
    },
    // { supplementalEligibility: [entry…] } -> frozen array (one entry per base plan), or null.
    eligibilityResponse(data){
      if(!isPlain(data) || !exactKeys(data, ['supplementalEligibility']) || !Array.isArray(data.supplementalEligibility)) return null;
      const out = [];
      for(let i = 0; i < data.supplementalEligibility.length; i++){
        const e = eligible(data.supplementalEligibility[i]);
        if(!e || out.some((x) => x.payrollPlanId === e.payrollPlanId)) return null;
        out.push(e);
      }
      return Object.freeze(out);
    },
    // The Employee's own Committed document, or null (defence in depth; the server scopes).
    ownCommitted(d, employeeId){
      return (d && d.status === 'Committed' && typeof employeeId === 'string' && d.employeeId === employeeId) ? d : null;
    }
  });
})();

// The allowlisted request mirror of SupplementalInput: { ok: true, body } or { ok: false, fields }.
// The transition and commit grammars are PayrollInput's, so they are PayrollRequests' own.
const SupplementalRequests = Object.freeze({
  // POST /api/supplemental-payrolls/generate: exactly { payrollPlanId }.
  generate(planId){
    return (typeof planId === 'string' && PAYROLL_ID_PATTERN.test(planId)) ? Object.freeze({ ok: true, body: { payrollPlanId: planId } })
      : Object.freeze({ ok: false, fields: Object.freeze(['payrollPlanId']) });
  },
  // review / approve / return / cancel: exactly { id, expectedVersion }.
  target(id, expectedVersion){ return PayrollRequests.target(id, expectedVersion); },
  // commit: exactly { id, expectedVersion, expectedTotal, idempotencyKey } of one intent.
  commit(intent){ return PayrollRequests.commit(intent); }
});

const SupplementalApi = (function(){
  const outcome = payrollApiOutcome, write = payrollApiWrite, refused = PAYROLL_API_REFUSED;
  // A transition: confirmed only by the same document, in the target status, one version on.
  function transition(operation){
    const t = SUPPLEMENTAL_API_TRANSITIONS[operation];
    return (id, expectedVersion) => write(t[0], SupplementalRequests.target(id, expectedVersion), (d) => SupplementalDecoders.docResponse(d),
      (d) => d.id === id && d.status === t[1] && d.version === expectedVersion + 1);
  }
  return Object.freeze({
    async month(monthKey){
      if(!OvertimeCalendar.isMonth(monthKey)) return refused;
      const res = await ApiClient.request('/api/supplemental-payrolls', { method: 'GET', query: { month: monthKey } });
      return outcome(res, (d) => SupplementalDecoders.monthResponse(d, monthKey));
    },
    async get(id){
      if(typeof id !== 'string' || !PAYROLL_ID_PATTERN.test(id)) return refused;
      const res = await ApiClient.request('/api/supplemental-payroll', { method: 'GET', query: { id: id } });
      const out = outcome(res, (d) => SupplementalDecoders.detailResponse(d));
      return out.ok && out.data.doc.id !== id ? refused : out;
    },
    async eligibility(monthKey){
      if(!OvertimeCalendar.isMonth(monthKey)) return refused;
      const res = await ApiClient.request('/api/supplemental-payrolls/eligibility', { method: 'GET', query: { month: monthKey } });
      return outcome(res, (d) => SupplementalDecoders.eligibilityResponse(d));
    },
    // Confirmed by the base plan's open document of that month — whatever its open status.
    generate(planId, monthKey){
      return write('/api/supplemental-payrolls/generate', SupplementalRequests.generate(planId), (d) => SupplementalDecoders.docResponse(d),
        (d) => d.payrollPlanId === planId && d.monthKey === monthKey && SUPPLEMENTAL_API_OPEN.indexOf(d.status) !== -1);
    },
    review: transition('review'),
    approve: transition('approve'),
    returnToDraft: transition('return'),
    cancel: transition('cancel'),
    // One commit intent { id, version, total, key }, sent once per deliberate click.
    commit(intent){
      return write('/api/supplemental-payrolls/commit', SupplementalRequests.commit(intent), (d) => SupplementalDecoders.docResponse(d),
        (d) => d.id === intent.id && d.status === 'Committed' && d.version === intent.version + 1 && d.overtimeAmount === intent.total);
    },
    // The Employee's reads — every document Committed and their own, else INVALID_RESPONSE.
    async myMonth(monthKey, employeeId){
      const out = await SupplementalApi.month(monthKey);
      return out.ok && !out.data.every((d) => SupplementalDecoders.ownCommitted(d, employeeId)) ? refused : out;
    },
    async myGet(id, employeeId){
      const out = await SupplementalApi.get(id);
      return out.ok && !SupplementalDecoders.ownCommitted(out.data.doc, employeeId) ? refused : out;
    }
  });
})();

/* ============================================================
   AFI-4e — FINANCE POSTING (over BF-4e, PR #50; owner decisions D-AFI4e-1..5 = A)
   ------------------------------------------------------------
   The SESSION client of the BF-4e Finance posting routes, over the same wire: the CEO's month
   read and the two posting commands, each answer strictly decoded. A posting is one immutable,
   Planned Finance record made from exactly one Committed payroll obligation — a base payroll plan
   or a Supplemental document — and nothing else: no account, category, actual amount, reversal or
   correction exists here, and nothing here pays anything.

     month(monthKey)   GET /api/finance-postings?month=YYYY-MM       every posting of the month (CEO)
     post(intent)      POST /api/finance-postings/payroll-plan       exactly { payrollPlanId,
                       POST /api/finance-postings/supplemental-payroll   expectedAmount, idempotencyKey }
                                                                     or { supplementalPayrollId, … }
                       of ONE posting intent (financePostingIntent): the source's own decoded amount
                       string (a plan's totalAmount, a document's overtimeAmount), unchanged, and one
                       Web Crypto key (payrollIdempotencyKey). Confirmed only by a Planned posting of
                       the same source kind and id, at exactly that amount, for the source's own
                       employee and month. A retry sends the same intent again; the server replays
                       the original posting (SDR-0002 §10).

   STRICT DECODING: a posting has exactly FinancePostingView::FIELDS; its source kind is one of the
   two, its ids are the server's grammars, its amount a positive whole-Rupiah string and its status
   Planned; a month answer holds only postings of the month asked for, at most one per source and
   at most the server's list cap. Anything else is INVALID_RESPONSE and nothing of it is returned.
   ============================================================ */

// server/src/Finance/FinancePostingView.php FIELDS (sorted), SOURCE_KINDS and PLANNED; the input
// field of each source kind (FinancePostingInput); FinancePostingStore::LIST_CAP.
const FINANCE_POSTING_KEYS = Object.freeze(['amount', 'employeeId', 'id', 'monthKey', 'sourceId', 'sourceKind', 'status']);
const FINANCE_POSTING_SOURCE_KINDS = Object.freeze(['payrollPlan', 'supplementalPayroll']);
const FINANCE_POSTING_PLANNED = 'Planned';
const FINANCE_POSTING_LIST_CAP = 2000;
const FINANCE_POSTING_ROUTES = Object.freeze({ payrollPlan: '/api/finance-postings/payroll-plan', supplementalPayroll: '/api/finance-postings/supplemental-payroll' });
const FINANCE_POSTING_SOURCE_FIELDS = Object.freeze({ payrollPlan: 'payrollPlanId', supplementalPayroll: 'supplementalPayrollId' });

// The posted amount of a Committed source: a plan's totalAmount, a document's overtimeAmount — the
// decoded server string, never computed.
function financePostingSourceAmount(sourceKind, source){
  if(!source) return null;
  return sourceKind === 'payrollPlan' ? source.totalAmount : sourceKind === 'supplementalPayroll' ? source.overtimeAmount : null;
}
// One posting intent { sourceKind, sourceId, employeeId, monthKey, amount, key } of one Committed
// source, frozen — or null when this browser offers no Web Crypto (nothing is then sent).
function financePostingIntent(sourceKind, source){
  if(FINANCE_POSTING_SOURCE_KINDS.indexOf(sourceKind) === -1 || !source || source.status !== 'Committed') return null;
  const key = payrollIdempotencyKey();
  if(key === null) return null;
  return Object.freeze({ sourceKind: sourceKind, sourceId: source.id, employeeId: source.employeeId, monthKey: source.monthKey,
    amount: financePostingSourceAmount(sourceKind, source), key: key });
}

const FinancePostingDecoders = (function(){
  function isPlain(v){
    return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  }
  function exactKeys(o, keys){
    const k = Object.keys(o).sort();
    if(k.length !== keys.length) return false;
    for(let i = 0; i < k.length; i++){ if(k[i] !== keys[i]) return false; }
    return true;
  }
  const isId = (v) => typeof v === 'string' && PAYROLL_ID_PATTERN.test(v);
  // A frozen copy holding exactly the seven posting keys, or null.
  function posting(o){
    if(!isPlain(o) || !exactKeys(o, FINANCE_POSTING_KEYS)) return null;
    if(!isId(o.id) || FINANCE_POSTING_SOURCE_KINDS.indexOf(o.sourceKind) === -1 || !isId(o.sourceId)
      || typeof o.employeeId !== 'string' || !PAYROLL_EMPLOYEE_ID_PATTERN.test(o.employeeId) || !OvertimeCalendar.isMonth(o.monthKey)
      || !payrollIsAmount(o.amount) || o.amount === '0.00' || o.status !== FINANCE_POSTING_PLANNED) return null;
    return Object.freeze({ id: o.id, sourceKind: o.sourceKind, sourceId: o.sourceId, employeeId: o.employeeId, monthKey: o.monthKey, amount: o.amount, status: o.status });
  }
  return Object.freeze({
    posting: posting,
    // { financePostings: [posting…] } of exactly `monthKey` -> frozen array, or null. One posting
    // per source (the server's unique keys) and per id; never above the server's list cap.
    monthResponse(data, monthKey){
      if(!isPlain(data) || !exactKeys(data, ['financePostings']) || !Array.isArray(data.financePostings) || data.financePostings.length > FINANCE_POSTING_LIST_CAP) return null;
      const out = [];
      for(let i = 0; i < data.financePostings.length; i++){
        const p = posting(data.financePostings[i]);
        if(!p || p.monthKey !== monthKey || out.some((x) => x.id === p.id || (x.sourceKind === p.sourceKind && x.sourceId === p.sourceId))) return null;
        out.push(p);
      }
      return Object.freeze(out);
    },
    // { financePosting } -> the posting, or null.
    postingResponse(data){
      return (isPlain(data) && exactKeys(data, ['financePosting'])) ? posting(data.financePosting) : null;
    }
  });
})();

// The allowlisted request mirror of FinancePostingInput: { ok: true, body } or { ok: false, fields }.
const FinancePostingRequests = Object.freeze({
  // Exactly { payrollPlanId | supplementalPayrollId, expectedAmount, idempotencyKey } of one intent —
  // the amount is the source's decoded string, sent as it is.
  post(intent){
    const i = intent || {};
    const field = Object.prototype.hasOwnProperty.call(FINANCE_POSTING_SOURCE_FIELDS, i.sourceKind) ? FINANCE_POSTING_SOURCE_FIELDS[i.sourceKind] : null;
    if(field === null) return Object.freeze({ ok: false, fields: Object.freeze(['sourceKind']) });
    const bad = [];
    if(typeof i.sourceId !== 'string' || !PAYROLL_ID_PATTERN.test(i.sourceId)) bad.push(field);
    if(!payrollIsAmount(i.amount) || i.amount === '0.00') bad.push('expectedAmount');
    if(typeof i.key !== 'string' || !PAYROLL_KEY_PATTERN.test(i.key)) bad.push('idempotencyKey');
    if(bad.length) return Object.freeze({ ok: false, fields: Object.freeze(bad) });
    const body = {};
    body[field] = i.sourceId;
    body.expectedAmount = i.amount;
    body.idempotencyKey = i.key;
    return Object.freeze({ ok: true, body: body });
  }
});

const FinancePostingApi = (function(){
  const outcome = payrollApiOutcome, write = payrollApiWrite, refused = PAYROLL_API_REFUSED;
  return Object.freeze({
    async month(monthKey){
      if(!OvertimeCalendar.isMonth(monthKey)) return refused;
      const res = await ApiClient.request('/api/finance-postings', { method: 'GET', query: { month: monthKey } });
      return outcome(res, (d) => FinancePostingDecoders.monthResponse(d, monthKey));
    },
    // One posting intent, sent once per deliberate click (a Retry sends the same intent again).
    post(intent){
      const i = intent || {};
      const route = Object.prototype.hasOwnProperty.call(FINANCE_POSTING_ROUTES, i.sourceKind) ? FINANCE_POSTING_ROUTES[i.sourceKind] : null;
      return write(route, FinancePostingRequests.post(i), (d) => FinancePostingDecoders.postingResponse(d),
        (p) => p.sourceKind === i.sourceKind && p.sourceId === i.sourceId && p.amount === i.amount && p.monthKey === i.monthKey && p.employeeId === i.employeeId);
    }
  });
})();

/* ============================================================
   AFI-4f — FINANCE EXECUTION: RECORD PAYMENT (over BF-4f, PR #52; owner decisions D-AFI4f-1..8 = A)
   ------------------------------------------------------------
   The SESSION client of the BF-4f Finance execution routes, over the same wire: the CEO's month
   read and the one command that records that a Planned posting was paid in full OUTSIDE TAM OS.
   TAM OS moves no money: an execution is a statement the CEO records, never a transfer.

     month(monthKey)   GET /api/finance-executions?month=YYYY-MM       every execution of the month (CEO)
     record(intent)    POST /api/finance-executions/execute            exactly { financePostingId,
                       expectedAmount, executedOn, paymentMethod, idempotencyKey } of ONE execution
                       intent (financeExecutionIntent): the confirmed posting's own amount string,
                       unchanged, the date and the method the CEO chose, and one Web Crypto key
                       (payrollIdempotencyKey). Confirmed only by an execution of the same posting, at
                       exactly that amount, date and method, for the posting's employee and month. A
                       retry sends the same intent again; the server replays the original execution.

   STRICT DECODING: an execution has exactly FinanceExecutionView::FIELDS; its ids are the server's
   grammars, its amount a positive whole-Rupiah string, its executedOn a real calendar date and its
   paymentMethod one of FinanceExecutionInput::PAYMENT_METHODS; a month answer holds only executions
   of the month asked for, at most one per posting and per id, and at most the server's list cap.
   Anything else is INVALID_RESPONSE and nothing of it is returned. The seven-key posting decoder
   above is untouched (D-FEX-6 = A): an execution is a separate record, read separately.

   executedOn: "YYYY-MM-DD", no later than today in the company calendar (Asia/Jakarta) — the
   SERVER decides that bound (D-AFI4f-4 = A). financeExecutionToday() is only the date field's max
   hint: Asia/Jakarta is UTC+7 all year (no daylight saving).
   ============================================================ */

// server/src/Finance/FinanceExecutionView.php FIELDS (sorted); FinanceExecutionInput::PAYMENT_METHODS
// (order included); FinanceExecutionStore::LIST_CAP.
const FINANCE_EXECUTION_KEYS = Object.freeze(['amount', 'employeeId', 'executedOn', 'financePostingId', 'id', 'monthKey', 'paymentMethod']);
const FINANCE_EXECUTION_PAYMENT_METHODS = Object.freeze(['cash', 'bankTransfer', 'qris', 'virtualAccount', 'creditCard', 'other']);
const FINANCE_EXECUTION_LIST_CAP = 2000;
const FINANCE_EXECUTION_ROUTE = '/api/finance-executions/execute';
const FINANCE_EXECUTION_JAKARTA_OFFSET_MS = 25200000;
const FINANCE_EXECUTION_DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

// A real calendar date "YYYY-MM-DD" (the pure OvertimeCalendar helper: year >= 1900).
function financeExecutionIsDate(v){
  return typeof v === 'string' && FINANCE_EXECUTION_DATE_PATTERN.test(v) && OvertimeCalendar.isDateIn(v, v.slice(0, 7));
}
function financeExecutionIsMethod(v){ return typeof v === 'string' && FINANCE_EXECUTION_PAYMENT_METHODS.indexOf(v) !== -1; }
// The company calendar's today of `now` (a Date): the date field's hint, never authority.
function financeExecutionToday(now){
  return new Date((now || new Date()).getTime() + FINANCE_EXECUTION_JAKARTA_OFFSET_MS).toISOString().slice(0, 10);
}
// One execution intent { financePostingId, employeeId, monthKey, amount, executedOn, paymentMethod,
// key } of one Planned posting, frozen — or null for anything else, a date or method outside the
// grammar, or a browser without Web Crypto (nothing is then sent). The amount is the posting's own.
function financeExecutionIntent(posting, executedOn, paymentMethod){
  if(!posting || posting.status !== FINANCE_POSTING_PLANNED || !financeExecutionIsDate(executedOn) || !financeExecutionIsMethod(paymentMethod)) return null;
  const key = payrollIdempotencyKey();
  if(key === null) return null;
  return Object.freeze({ financePostingId: posting.id, employeeId: posting.employeeId, monthKey: posting.monthKey, amount: posting.amount,
    executedOn: executedOn, paymentMethod: paymentMethod, key: key });
}

const FinanceExecutionDecoders = (function(){
  function isPlain(v){
    return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  }
  function exactKeys(o, keys){
    const k = Object.keys(o).sort();
    if(k.length !== keys.length) return false;
    for(let i = 0; i < k.length; i++){ if(k[i] !== keys[i]) return false; }
    return true;
  }
  const isId = (v) => typeof v === 'string' && PAYROLL_ID_PATTERN.test(v);
  // A frozen copy holding exactly the seven execution keys, or null.
  function financeExecution(o){
    if(!isPlain(o) || !exactKeys(o, FINANCE_EXECUTION_KEYS)) return null;
    if(!isId(o.id) || !isId(o.financePostingId) || typeof o.employeeId !== 'string' || !PAYROLL_EMPLOYEE_ID_PATTERN.test(o.employeeId)
      || !OvertimeCalendar.isMonth(o.monthKey) || !payrollIsAmount(o.amount) || o.amount === '0.00'
      || !financeExecutionIsDate(o.executedOn) || !financeExecutionIsMethod(o.paymentMethod)) return null;
    return Object.freeze({ id: o.id, financePostingId: o.financePostingId, employeeId: o.employeeId, monthKey: o.monthKey, amount: o.amount,
      executedOn: o.executedOn, paymentMethod: o.paymentMethod });
  }
  return Object.freeze({
    financeExecution: financeExecution,
    // { financeExecutions: [execution…] } of exactly `monthKey` -> frozen array, or null. One
    // execution per posting (the server's unique key) and per id; never above the server's list cap.
    monthResponse(data, monthKey){
      if(!isPlain(data) || !exactKeys(data, ['financeExecutions']) || !Array.isArray(data.financeExecutions) || data.financeExecutions.length > FINANCE_EXECUTION_LIST_CAP) return null;
      const out = [];
      for(let i = 0; i < data.financeExecutions.length; i++){
        const e = financeExecution(data.financeExecutions[i]);
        if(!e || e.monthKey !== monthKey || out.some((x) => x.id === e.id || x.financePostingId === e.financePostingId)) return null;
        out.push(e);
      }
      return Object.freeze(out);
    },
    // { financeExecution } -> the execution, or null.
    financeExecutionResponse(data){
      return (isPlain(data) && exactKeys(data, ['financeExecution'])) ? financeExecution(data.financeExecution) : null;
    }
  });
})();

// The allowlisted request mirror of FinanceExecutionInput: { ok: true, body } or { ok: false, fields }.
const FinanceExecutionRequests = Object.freeze({
  // Exactly { financePostingId, expectedAmount, executedOn, paymentMethod, idempotencyKey } of one
  // intent — the amount is the posting's decoded string, sent as it is.
  record(intent){
    const i = intent || {};
    const bad = [];
    if(typeof i.financePostingId !== 'string' || !PAYROLL_ID_PATTERN.test(i.financePostingId)) bad.push('financePostingId');
    if(!payrollIsAmount(i.amount) || i.amount === '0.00') bad.push('expectedAmount');
    if(!financeExecutionIsDate(i.executedOn)) bad.push('executedOn');
    if(!financeExecutionIsMethod(i.paymentMethod)) bad.push('paymentMethod');
    if(typeof i.key !== 'string' || !PAYROLL_KEY_PATTERN.test(i.key)) bad.push('idempotencyKey');
    if(bad.length) return Object.freeze({ ok: false, fields: Object.freeze(bad) });
    return Object.freeze({ ok: true, body: { financePostingId: i.financePostingId, expectedAmount: i.amount, executedOn: i.executedOn, paymentMethod: i.paymentMethod, idempotencyKey: i.key } });
  }
});

const FinanceExecutionApi = (function(){
  const outcome = payrollApiOutcome, write = payrollApiWrite, refused = PAYROLL_API_REFUSED;
  return Object.freeze({
    async month(monthKey){
      if(!OvertimeCalendar.isMonth(monthKey)) return refused;
      const res = await ApiClient.request('/api/finance-executions', { method: 'GET', query: { month: monthKey } });
      return outcome(res, (d) => FinanceExecutionDecoders.monthResponse(d, monthKey));
    },
    // One execution intent, sent once per deliberate click (a Retry sends the same intent again).
    record(intent){
      const i = intent || {};
      return write(FINANCE_EXECUTION_ROUTE, FinanceExecutionRequests.record(i), (d) => FinanceExecutionDecoders.financeExecutionResponse(d),
        (e) => e.financePostingId === i.financePostingId && e.amount === i.amount && e.executedOn === i.executedOn && e.paymentMethod === i.paymentMethod
          && e.monthKey === i.monthKey && e.employeeId === i.employeeId);
    }
  });
})();
