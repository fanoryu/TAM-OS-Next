/* ============================================================
   EMPLOYEE API (AFI-4a1) — js/core/employee-api.js
   ------------------------------------------------------------
   The SESSION-mode read client for the server Employee record (BF-4a1): three
   reads over ApiClient, each answer strictly decoded before anything else sees it.

     list({ archived })  GET /api/employees            CEO only (an Employee is 403)
                         GET /api/employees?archived=1 archived records included
     get(id)             GET /api/employee?id=<id>      CEO detail
     getSelf(principal)  GET /api/employee?id=<principal.employeeId>   Employee self

   IDENTIFIERS: principal.employeeId (from GET /api/auth/me) is the OPAQUE Employee
   record id — the same value as the `id` of every DTO here. It is NOT the human
   `employeeCode`. getSelf() asks for exactly that id and accepts the answer only
   when its `id` equals it.

   STRICT DECODING (server/src/Employee/EmployeeView.php): each wrapper and each
   record must have exactly its keys, with the server's types, enums and formats;
   anything else is INVALID_RESPONSE and nothing of it is returned. Money stays the
   server's exact decimal STRING ("7500000.00") — never a JavaScript number.

   READ-ONLY (AFI-4a1): no mutation route is named here. The server is the only
   authority; nothing is persisted, cached or logged. Employee writes (AFI-4a2) will
   be added beside these reads, through the same decoders.

   Classic shared global scope; top-level `const` bindings, not on window.
   ============================================================ */

// The decoders' failure kind, beside ApiClient's API_RESULT_KINDS.
const EMPLOYEE_API_INVALID = 'INVALID_RESPONSE';
// server/src/Employee/EmployeeInput.php STATUSES / ID_PATTERN; AccountState::VALUES.
const EMPLOYEE_API_STATUSES = Object.freeze(['Active', 'Inactive', 'On Leave', 'Resigned', 'Terminated']);
const EMPLOYEE_API_ACCOUNT_STATES = Object.freeze(['none', 'pending', 'active', 'disabled']);
const EMPLOYEE_API_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
// EmployeeView::LIST_FIELDS / DETAIL_FIELDS / SELF_FIELDS, sorted for the exact-key comparison.
const EMPLOYEE_LIST_KEYS = Object.freeze(['accountState', 'archived', 'department', 'employeeCode', 'employmentStatus', 'fullName', 'id', 'jobTitle']);
const EMPLOYEE_DETAIL_KEYS = Object.freeze(EMPLOYEE_LIST_KEYS.concat(['contactEmail', 'joinDate', 'monthlyBaseSalary', 'notes', 'phone', 'version']).sort());
const EMPLOYEE_SELF_KEYS = Object.freeze(['contactEmail', 'department', 'employeeCode', 'employmentStatus', 'fullName', 'id', 'jobTitle', 'joinDate', 'monthlyBaseSalary', 'phone']);

const EmployeeDecoders = (function(){
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
  function text(v, max){ return typeof v === 'string' && v.length > 0 && codePoints(v) <= max; }
  function optText(v, max){ return v === null || text(v, max); }
  function isDate(v){
    if(v === null) return true;
    const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
    if(!m) return false;
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
  }
  const checks = {
    id: (v) => typeof v === 'string' && EMPLOYEE_API_ID_PATTERN.test(v),
    employeeCode: (v) => text(v, 32),
    fullName: (v) => text(v, 160),
    jobTitle: (v) => optText(v, 120),
    department: (v) => optText(v, 120),
    employmentStatus: (v) => EMPLOYEE_API_STATUSES.indexOf(v) !== -1,
    archived: (v) => typeof v === 'boolean',
    accountState: (v) => EMPLOYEE_API_ACCOUNT_STATES.indexOf(v) !== -1,
    joinDate: isDate,
    contactEmail: (v) => v === null || (text(v, 254) && v.indexOf('@') !== -1),
    phone: (v) => v === null || (typeof v === 'string' && /^[0-9+()\-. ]{1,40}$/.test(v)),
    notes: (v) => optText(v, 2000),
    monthlyBaseSalary: (v) => v === null || (typeof v === 'string' && /^\d{1,13}\.\d{2}$/.test(v)),
    version: (v) => Number.isInteger(v) && v >= 1 && v <= 4294967295
  };
  // A frozen copy holding exactly `keys`, or null.
  function record(o, keys){
    if(!isPlain(o) || !exactKeys(o, keys)) return null;
    const out = {};
    for(let i = 0; i < keys.length; i++){
      if(!checks[keys[i]](o[keys[i]])) return null;
      out[keys[i]] = o[keys[i]];
    }
    return Object.freeze(out);
  }
  function single(data, keys){
    return (isPlain(data) && exactKeys(data, ['employee'])) ? record(data.employee, keys) : null;
  }
  return Object.freeze({
    listItem: (o) => record(o, EMPLOYEE_LIST_KEYS),
    detail: (o) => record(o, EMPLOYEE_DETAIL_KEYS),
    self: (o) => record(o, EMPLOYEE_SELF_KEYS),
    // { employees: [item…] } -> frozen array of items, or null if any part is malformed.
    listResponse(data){
      if(!isPlain(data) || !exactKeys(data, ['employees']) || !Array.isArray(data.employees)) return null;
      const out = [];
      for(let i = 0; i < data.employees.length; i++){
        const item = record(data.employees[i], EMPLOYEE_LIST_KEYS);
        if(!item) return null;
        out.push(item);
      }
      return Object.freeze(out);
    },
    detailResponse: (data) => single(data, EMPLOYEE_DETAIL_KEYS),
    selfResponse: (data) => single(data, EMPLOYEE_SELF_KEYS)
  });
})();

const EmployeeApi = (function(){
  // ApiResult -> { ok: true, data } | { ok: false, kind, retryAfter?, requestId? }.
  function outcome(res, decode){
    if(!res.ok){
      const failed = { ok: false, kind: res.kind };
      if(res.retryAfter !== undefined) failed.retryAfter = res.retryAfter;
      if(res.requestId) failed.requestId = res.requestId;
      return Object.freeze(failed);
    }
    const data = decode(res.data);
    if(data === null){
      const invalid = { ok: false, kind: EMPLOYEE_API_INVALID };
      if(res.requestId) invalid.requestId = res.requestId;
      return Object.freeze(invalid);
    }
    return Object.freeze({ ok: true, data: data });
  }
  const refused = Object.freeze({ ok: false, kind: EMPLOYEE_API_INVALID });

  return Object.freeze({
    async list(options){
      const archived = !!(options && options.archived === true);
      const res = await ApiClient.request('/api/employees', archived ? { method: 'GET', query: { archived: '1' } } : { method: 'GET' });
      return outcome(res, EmployeeDecoders.listResponse);
    },
    async get(id){
      if(typeof id !== 'string' || !EMPLOYEE_API_ID_PATTERN.test(id)) return refused;
      const res = await ApiClient.request('/api/employee', { method: 'GET', query: { id: id } });
      return outcome(res, EmployeeDecoders.detailResponse);
    },
    // The Employee's own record: the OPAQUE principal.employeeId, never the employee code.
    async getSelf(principal){
      const own = principal ? principal.employeeId : undefined;
      if(typeof own !== 'string' || !EMPLOYEE_API_ID_PATTERN.test(own)) return refused;
      const res = await ApiClient.request('/api/employee', { method: 'GET', query: { id: own } });
      const out = outcome(res, EmployeeDecoders.selfResponse);
      if(out.ok && out.data.id !== own) return refused;
      return out;
    }
  });
})();
