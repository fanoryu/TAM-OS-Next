/* ============================================================
   OVERTIME API (AFI-4b1) — js/core/overtime-api.js
   ------------------------------------------------------------
   The SESSION-mode client for the server overtime record (BF-4b1, merged as PR #40): two reads
   over ApiClient and six writes over authSessionMutation (js/core/auth-boot.js), each answer
   strictly decoded before anything else sees it. The non-money workflow only: no rate, salary,
   schedule, amount, approval, contract or payroll value exists here (valuation is BF-4b2).

     month(monthKey)   GET /api/overtime-records?month=YYYY-MM   the scope's records of one month
                                                                 (CEO: the company; Employee: own)
     get(id)           GET /api/overtime-record?id=<id>

     create(fields)                        POST /api/overtime-records/create   a new Draft
     update(id, expectedVersion, changed)  POST /api/overtime-records/update   a Draft only
     remove(id, expectedVersion)           POST /api/overtime-records/delete   a Draft only (hard)
     submit / review / reject(id, expectedVersion)
                                           POST /api/overtime-records/<op>     Draft → Submitted;
                                           Submitted → Reviewed; Submitted / Reviewed → Rejected

   STRICT DECODING (server/src/Overtime/OvertimeView.php): each wrapper and each record has
   exactly its keys, with the server's types and formats; anything else is INVALID_RESPONSE and
   nothing of it is returned. `hours` stays the server's exact decimal STRING ("7.50") — checked
   in integer hundredths, never a JavaScript number — and a date always falls inside its month.
   A month answer must hold only that month's records; one bad item fails the whole list.

   WRITES: OvertimeRequests is the allowlisted mirror of the server's OvertimeInput — UX only;
   the server stays the authority. Bodies are exact: create { employeeId, monthKey, hours,
   overtimeDate, workDescription, notes }; update { id, expectedVersion, changed fields };
   delete / submit / review / reject { id, expectedVersion }. Never a company, actor, status,
   version, money, contract, payroll id or reason. A success counts only when the decoded answer
   confirms the write (create: a version 1 Draft of the requested owner; update: the same Draft;
   submit / review / reject: the same record in the target status; delete: the same id) —
   otherwise it is INVALID_RESPONSE, never a success. Nothing is persisted, cached, logged or
   resent here.

   TARGET SELECTOR, NOT AUTHORITY (D-AFI4b1-3): the create body's employeeId names the owner of
   the new record — an Employee sends their own principal.employeeId, a CEO the selected record's
   id. ApiClient admits it on exactly POST /api/overtime-records/create (API_BODY_KEY_EXCEPTION);
   the server resolves it inside the session's scope (404 outside it) and Policy decides. Nothing
   here treats it as permission, and no other body ever carries it.

   Classic shared global scope; top-level `const` bindings, not on window.
   ============================================================ */

// The decoders' failure kind, beside ApiClient's API_RESULT_KINDS.
const OVERTIME_API_INVALID = 'INVALID_RESPONSE';
// server/src/Overtime/OvertimeStatus.php VALUES; OvertimeInput ID_PATTERN; EmployeeInput ID_PATTERN.
const OVERTIME_RECORD_STATUSES = Object.freeze(['Draft', 'Submitted', 'Reviewed', 'Rejected']);
const OVERTIME_ID_PATTERN = /^[0-9a-f]{32}$/;
const OVERTIME_EMPLOYEE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const OVERTIME_MAX_VERSION = 4294967295;
// OvertimeView::FIELDS, sorted for the exact-key comparison.
const OVERTIME_RECORD_KEYS = Object.freeze(['employeeId', 'hours', 'id', 'monthKey', 'notes', 'overtimeDate', 'status', 'version', 'workDescription']);
// OvertimeInput::FIELDS: the record fields a create or update writes, in column order.
const OVERTIME_WRITABLE_FIELDS = Object.freeze(['monthKey', 'overtimeDate', 'hours', 'workDescription', 'notes']);
// D-BF4b1-2 in hundredths of an hour: 0 < hours <= 744, in steps of 0.25.
const OVERTIME_MAX_HUNDREDTHS = 74400;
const OVERTIME_STEP_HUNDREDTHS = 25;

// Pure calendar helpers shared by the decoder, the request mirror and the view. Strings only.
const OvertimeCalendar = Object.freeze({
  isMonth(v){
    const m = typeof v === 'string' ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(v) : null;
    return !!m && +m[1] >= 1900;
  },
  daysIn(monthKey){
    const y = +monthKey.slice(0, 4), m = +monthKey.slice(5, 7);
    if(m === 2) return ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 29 : 28;
    return [4, 6, 9, 11].indexOf(m) !== -1 ? 30 : 31;
  },
  // A real calendar date (YYYY-MM-DD, year >= 1900) inside monthKey.
  isDateIn(v, monthKey){
    const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
    if(!m || !OvertimeCalendar.isMonth(m[1] + '-' + m[2]) || v.slice(0, 7) !== monthKey) return false;
    return +m[3] >= 1 && +m[3] <= OvertimeCalendar.daysIn(monthKey);
  },
  // The month before / after monthKey.
  shift(monthKey, delta){
    let y = +monthKey.slice(0, 4), m = +monthKey.slice(5, 7) + delta;
    while(m < 1){ m += 12; y--; }
    while(m > 12){ m -= 12; y++; }
    return String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0');
  },
  // The browser's local calendar month of `now` (a Date): only its calendar parts are read.
  monthOf(now){
    return String(now.getFullYear()).padStart(4, '0') + '-' + String(now.getMonth() + 1).padStart(2, '0');
  }
});

// Exact "N.NN", > 0, <= 744, a multiple of 0.25 — in integer hundredths, never a float.
function overtimeIsHours(v){
  const m = typeof v === 'string' ? /^(0|[1-9]\d{0,2})\.(\d{2})$/.exec(v) : null;
  if(!m) return false;
  const hundredths = +m[1] * 100 + +m[2];
  return hundredths > 0 && hundredths <= OVERTIME_MAX_HUNDREDTHS && hundredths % OVERTIME_STEP_HUNDREDTHS === 0;
}

const OvertimeDecoders = (function(){
  function isPlain(v){
    return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  }
  function exactKeys(o, keys){
    const k = Object.keys(o).sort();
    if(k.length !== keys.length) return false;
    for(let i = 0; i < k.length; i++){ if(k[i] !== keys[i]) return false; }
    return true;
  }
  function codePoints(s){ return Array.from(s).length; }
  const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
  const MULTI_LINE_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
  const checks = {
    id: (v) => typeof v === 'string' && OVERTIME_ID_PATTERN.test(v),
    employeeId: (v) => typeof v === 'string' && OVERTIME_EMPLOYEE_ID_PATTERN.test(v),
    monthKey: (v) => OvertimeCalendar.isMonth(v),
    hours: (v) => overtimeIsHours(v),
    workDescription: (v) => v === null || (typeof v === 'string' && v.length > 0 && codePoints(v) <= 160 && !CONTROL.test(v)),
    notes: (v) => v === null || (typeof v === 'string' && v.length > 0 && codePoints(v) <= 2000 && !MULTI_LINE_CONTROL.test(v)),
    status: (v) => OVERTIME_RECORD_STATUSES.indexOf(v) !== -1,
    version: (v) => Number.isInteger(v) && v >= 1 && v <= OVERTIME_MAX_VERSION
  };
  // A frozen copy holding exactly the record keys, or null. The date is checked against the
  // record's own month: a date outside it is malformed, whatever the other fields say.
  function record(o){
    if(!isPlain(o) || !exactKeys(o, OVERTIME_RECORD_KEYS)) return null;
    const out = {};
    for(let i = 0; i < OVERTIME_RECORD_KEYS.length; i++){
      const k = OVERTIME_RECORD_KEYS[i];
      if(k !== 'overtimeDate' && !checks[k](o[k])) return null;
      out[k] = o[k];
    }
    if(o.overtimeDate !== null && !OvertimeCalendar.isDateIn(o.overtimeDate, o.monthKey)) return null;
    return Object.freeze(out);
  }
  return Object.freeze({
    record: record,
    // { overtimeRecords: [record…] } of exactly `monthKey` -> frozen array, or null.
    monthResponse(data, monthKey){
      if(!isPlain(data) || !exactKeys(data, ['overtimeRecords']) || !Array.isArray(data.overtimeRecords)) return null;
      const out = [];
      for(let i = 0; i < data.overtimeRecords.length; i++){
        const item = record(data.overtimeRecords[i]);
        if(!item || item.monthKey !== monthKey) return null;
        out.push(item);
      }
      return Object.freeze(out);
    },
    recordResponse(data){
      return (isPlain(data) && exactKeys(data, ['overtimeRecord'])) ? record(data.overtimeRecord) : null;
    },
    // { deleted: { id } } -> the id, or null.
    deletedResponse(data){
      if(!isPlain(data) || !exactKeys(data, ['deleted']) || !isPlain(data.deleted) || !exactKeys(data.deleted, ['id'])) return null;
      return checks.id(data.deleted.id) ? data.deleted.id : null;
    }
  });
})();

// The allowlisted request mirror of OvertimeInput: { ok: true, body } or { ok: false, fields }.
const OvertimeRequests = (function(){
  const SINGLE_LINE_CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
  const MULTI_LINE_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
  const INVALID = Object.freeze({});
  function codePoints(s){ return Array.from(s).length; }
  function text(v, max, multiline){
    if(v === null) return null;
    if(typeof v !== 'string') return INVALID;
    const t = v.trim();
    if(t === '') return null;
    return ((multiline ? MULTI_LINE_CONTROL : SINGLE_LINE_CONTROL).test(t) || codePoints(t) > max) ? INVALID : t;
  }
  // Human hours text -> the canonical "N.NN", string-wise ("7.5" -> "7.50", "007" -> "7.00").
  function hours(v){
    const m = typeof v === 'string' ? /^\s*(\d{1,3})(?:\.(\d{1,2}))?\s*$/.exec(v) : null;
    if(!m) return INVALID;
    const canonical = m[1].replace(/^0+(?=\d)/, '') + '.' + (m[2] || '').padEnd(2, '0');
    return overtimeIsHours(canonical) ? canonical : INVALID;
  }
  function month(v){ return (typeof v === 'string' && OvertimeCalendar.isMonth(v.trim())) ? v.trim() : INVALID; }
  function date(v){
    if(v === null) return null;
    if(typeof v !== 'string') return INVALID;
    const t = v.trim();
    if(t === '') return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(t) && OvertimeCalendar.isDateIn(t, t.slice(0, 7)) ? t : INVALID;
  }
  function value(field, v){
    switch(field){
      case 'monthKey': return month(v);
      case 'overtimeDate': return date(v);
      case 'hours': return hours(v);
      case 'workDescription': return text(v, 160, false);
      case 'notes': return text(v, 2000, true);
      default: return INVALID;
    }
  }
  function isPlain(v){
    return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  }
  function target(id, expectedVersion, bad){
    if(typeof id !== 'string' || !OVERTIME_ID_PATTERN.test(id)) bad.push('id');
    if(!Number.isInteger(expectedVersion) || expectedVersion < 1 || expectedVersion > OVERTIME_MAX_VERSION) bad.push('expectedVersion');
  }
  function result(bad, body){
    return bad.length ? Object.freeze({ ok: false, fields: Object.freeze(bad) }) : Object.freeze({ ok: true, body: body });
  }
  // Copies the valid record fields into body; returns the unknown or invalid names.
  function fieldsInto(fields, body){
    const bad = [];
    Object.keys(fields).forEach(function(k){
      if(OVERTIME_WRITABLE_FIELDS.indexOf(k) === -1){ bad.push(k); return; }
      const out = value(k, fields[k]);
      if(out === INVALID) bad.push(k); else body[k] = out;
    });
    return bad;
  }
  // The D-BF4b1-1 rule over a complete record: a date falls inside the month.
  function consistent(body){
    return body.overtimeDate === null || body.overtimeDate === undefined || body.overtimeDate.slice(0, 7) === body.monthKey;
  }

  return Object.freeze({
    hours: function(v){ const h = hours(v); return h === INVALID ? null : h; },
    // POST /api/overtime-records/create: the owner and the record fields; month and hours required.
    create(employeeId, fields){
      const body = { employeeId: employeeId };
      const bad = [];
      if(typeof employeeId !== 'string' || !OVERTIME_EMPLOYEE_ID_PATTERN.test(employeeId)) bad.push('employeeId');
      if(!isPlain(fields)) return result(bad.concat(['monthKey', 'hours']), null);
      Array.prototype.push.apply(bad, fieldsInto(fields, body));
      ['monthKey', 'hours'].forEach(function(k){ if(!Object.prototype.hasOwnProperty.call(fields, k) && bad.indexOf(k) === -1) bad.push(k); });
      if(!bad.length && !consistent(body)) bad.push('overtimeDate');
      return result(bad, body);
    },
    // POST /api/overtime-records/update: id, expectedVersion and at least one changed field.
    // `record` is the whole record after the change, for the date/month rule.
    update(id, expectedVersion, changed, record){
      const body = { id: id, expectedVersion: expectedVersion };
      const bad = [];
      target(id, expectedVersion, bad);
      if(!isPlain(changed) || !Object.keys(changed).length) bad.push('fields');
      else Array.prototype.push.apply(bad, fieldsInto(changed, body));
      if(!bad.length && isPlain(record)){
        const whole = {};
        if(fieldsInto(record, whole).length || !consistent(whole)) bad.push('overtimeDate');
      }
      return result(bad, body);
    },
    // delete / submit / review / reject: exactly id and expectedVersion.
    target(id, expectedVersion){
      const bad = [];
      target(id, expectedVersion, bad);
      return result(bad, { id: id, expectedVersion: expectedVersion });
    }
  });
})();

const OvertimeApi = (function(){
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
      const invalid = { ok: false, kind: OVERTIME_API_INVALID };
      if(res.requestId) invalid.requestId = res.requestId;
      return Object.freeze(invalid);
    }
    return Object.freeze({ ok: true, data: data });
  }
  const refused = Object.freeze({ ok: false, kind: OVERTIME_API_INVALID });

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
  const record = (d) => OvertimeDecoders.recordResponse(d);
  const transition = (route, status) => (id, expectedVersion) =>
    write(route, OvertimeRequests.target(id, expectedVersion), record, (r) => r.id === id && r.status === status);

  return Object.freeze({
    async month(monthKey){
      if(!OvertimeCalendar.isMonth(monthKey)) return refused;
      const res = await ApiClient.request('/api/overtime-records', { method: 'GET', query: { month: monthKey } });
      return outcome(res, (d) => OvertimeDecoders.monthResponse(d, monthKey));
    },
    async get(id){
      if(typeof id !== 'string' || !OVERTIME_ID_PATTERN.test(id)) return refused;
      const res = await ApiClient.request('/api/overtime-record', { method: 'GET', query: { id: id } });
      const out = outcome(res, record);
      return out.ok && out.data.id !== id ? refused : out;
    },
    // A new record: a server id, a version 1 Draft of the requested owner.
    create(employeeId, fields){
      return write('/api/overtime-records/create', OvertimeRequests.create(employeeId, fields), record, (r) => r.status === 'Draft' && r.version === 1 && r.employeeId === employeeId);
    },
    update(id, expectedVersion, changed, whole){
      return write('/api/overtime-records/update', OvertimeRequests.update(id, expectedVersion, changed, whole), record, (r) => r.id === id && r.status === 'Draft');
    },
    // Hard delete of a Draft: only the same id coming back confirms it.
    remove(id, expectedVersion){
      return write('/api/overtime-records/delete', OvertimeRequests.target(id, expectedVersion), (d) => OvertimeDecoders.deletedResponse(d), (deleted) => deleted === id);
    },
    submit: transition('/api/overtime-records/submit', 'Submitted'),
    review: transition('/api/overtime-records/review', 'Reviewed'),
    reject: transition('/api/overtime-records/reject', 'Rejected')
  });
})();
