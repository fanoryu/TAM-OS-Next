/* ============================================================
   PAYROLL API (AFI-4c1) — js/core/payroll-api.js
   ------------------------------------------------------------
   The SESSION-mode client for the server payroll plan (BF-4c1, merged as PR #44): two reads
   over ApiClient and five writes over authSessionMutation (js/core/auth-boot.js), each answer
   strictly decoded before anything else sees it. CEO only: an Employee never reaches it
   (SessionPayroll refuses before any call; the server answers 403 anyway).

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
   { month } and { id, expectedVersion }. Never an employee, company, role, salary, amount, total,
   status, confirmation total or idempotency key. A success counts only when the decoded answer
   confirms it (generate: every plan of the month asked for; a transition: the same plan in the
   target status at expectedVersion + 1) — otherwise INVALID_RESPONSE. Nothing is persisted,
   cached, logged or resent here.

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
  }
});

const PayrollApi = (function(){
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
      const invalid = { ok: false, kind: PAYROLL_API_INVALID };
      if(res.requestId) invalid.requestId = res.requestId;
      return Object.freeze(invalid);
    }
    return Object.freeze({ ok: true, data: data });
  }
  const refused = Object.freeze({ ok: false, kind: PAYROLL_API_INVALID });

  // One write through the established CSRF path. A refused request is never sent; an answer
  // carries authSessionMutation's recovery, and only a strictly decoded answer that `confirms`
  // the write is a success.
  async function write(route, prepared, decode, confirms){
    if(!prepared.ok) return Object.freeze({ ok: false, kind: API_RESULT_KINDS.VALIDATION, fields: prepared.fields, local: true, recovery: 'none' });
    const sent = await authSessionMutation(route, prepared.body);
    let out = outcome(sent.result, decode);
    if(out.ok && !confirms(out.data)) out = refused;
    return Object.freeze(Object.assign({}, out, { recovery: sent.recovery }));
  }
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
    cancel: transition('cancel')
  });
})();
