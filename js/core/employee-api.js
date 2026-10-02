/* ============================================================
   EMPLOYEE API (AFI-4a1, AFI-4a2) — js/core/employee-api.js
   ------------------------------------------------------------
   The SESSION-mode client for the server Employee record (BF-4a1): three reads over
   ApiClient and three writes over authSessionMutation (js/core/auth-boot.js), each
   answer strictly decoded before anything else sees it.

     list({ archived })  GET /api/employees            CEO only (an Employee is 403)
                         GET /api/employees?archived=1 archived records included
     get(id)             GET /api/employee?id=<id>      CEO detail
     getSelf(principal)  GET /api/employee?id=<principal.employeeId>   Employee self

     create(fields)                         POST /api/employees/create   employee.create
     update(id, expectedVersion, changed)   POST /api/employees/update   employee.update
     archive(id, expectedVersion)           POST /api/employees/archive  employee.delete (soft)

     AFI-4a3 account administration (account.manage, BF-4a2; no expectedVersion):
     provisionAccount(id, email)  POST /api/employees/provision-account   { id, email }
     reissueActivation(id)        POST /api/employees/reissue-activation  { id }
     disableAccount(id)           POST /api/employees/disable-account     { id }
     enableAccount(id)            POST /api/employees/enable-account      { id }

   IDENTIFIERS: principal.employeeId (from GET /api/auth/me) is the OPAQUE Employee
   record id — the same value as the `id` of every DTO here. It is NOT the human
   `employeeCode`. getSelf() asks for exactly that id and accepts the answer only
   when its `id` equals it.

   STRICT DECODING (server/src/Employee/EmployeeView.php): each wrapper and each
   record must have exactly its keys, with the server's types, enums and formats;
   anything else is INVALID_RESPONSE and nothing of it is returned. Money stays the
   server's exact decimal STRING ("7500000.00") — never a JavaScript number.

   WRITES (AFI-4a2): EmployeeRequests is the allowlisted mirror of the server's
   EmployeeInput — UX only; the server stays the authority. It builds the exact body
   (profile fields only; id + expectedVersion for update / archive), trims text, sends
   a cleared optional field as null, keeps money a decimal STRING (or an integer) and
   refuses any other key or value before transport. Every write goes through
   authSessionMutation — the established CSRF path with its bounded stale-token
   recovery — and its outcome carries that recovery. A success must decode as
   { employee: detail } and confirm the write, or it is INVALID_RESPONSE — never a
   success. Nothing is persisted, cached or logged, and nothing here resends a write.

   ACCOUNT WRITES (AFI-4a3): the same path. The bodies are exactly { id, email } and
   { id } — never an expectedVersion, accountState or accountManageable. No response
   carries an activation token or link (SDR-0004 §3.5); a success counts only when the
   decoded record is the same one in the state the operation produces (provision /
   reissue: pending; disable: disabled; enable: active or pending).

   Classic shared global scope; top-level `const` bindings, not on window.
   ============================================================ */

// The decoders' failure kind, beside ApiClient's API_RESULT_KINDS.
const EMPLOYEE_API_INVALID = 'INVALID_RESPONSE';
// server/src/Employee/EmployeeInput.php STATUSES / ID_PATTERN; AccountState::VALUES.
const EMPLOYEE_API_STATUSES = Object.freeze(['Active', 'Inactive', 'On Leave', 'Resigned', 'Terminated']);
const EMPLOYEE_API_ACCOUNT_STATES = Object.freeze(['none', 'pending', 'active', 'disabled']);
const EMPLOYEE_API_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
// EmployeeView::LIST_FIELDS / DETAIL_FIELDS / SELF_FIELDS, sorted for the exact-key comparison. BF-4a3: the
// CEO list and detail carry accountManageable (a required boolean); the self view never does.
const EMPLOYEE_LIST_KEYS = Object.freeze(['accountManageable', 'accountState', 'archived', 'department', 'employeeCode', 'employmentStatus', 'fullName', 'id', 'jobTitle']);
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
    accountManageable: (v) => v === true || v === false,
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

// server/src/Employee/EmployeeInput.php FIELDS (the writable profile, in column order) and MAX_VERSION.
const EMPLOYEE_WRITABLE_FIELDS = Object.freeze(['employeeCode', 'fullName', 'jobTitle', 'department', 'employmentStatus', 'joinDate', 'contactEmail', 'phone', 'notes', 'monthlyBaseSalary']);
const EMPLOYEE_API_MAX_VERSION = 4294967295;

// The allowlisted request mirror of EmployeeInput: { ok: true, body } or { ok: false, fields }.
const EmployeeRequests = (function(){
  const REQUIRED = Object.freeze(['employeeCode', 'fullName']);
  const SINGLE_LINE_CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
  const MULTI_LINE_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
  // EmailAddress::candidate / isValid: trimmed, lower-cased, printable ASCII, <= 254 bytes, an address.
  const EMAIL_PATTERN = /^[a-z0-9!#$%&'*+\/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+\/=?^_`{|}~-]+)*@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
  const INVALID = Object.freeze({});

  function codePoints(s){ return Array.from(s).length; }
  // A trimmed string, null for a cleared optional value, or INVALID.
  function text(v, max, required, multiline){
    if(v === null && !required) return null;
    if(typeof v !== 'string') return INVALID;
    const t = v.trim();
    if(t === '') return required ? INVALID : null;
    if((multiline ? MULTI_LINE_CONTROL : SINGLE_LINE_CONTROL).test(t) || codePoints(t) > max) return INVALID;
    return t;
  }
  function optional(v, accept){
    if(v === null) return null;
    if(typeof v !== 'string') return INVALID;
    const t = v.trim();
    if(t === '') return null;
    return accept(t) ? t : INVALID;
  }
  function isDate(t){
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if(!m) return false;
    const y = +m[1], mo = +m[2], d = +m[3];
    const at = new Date(Date.UTC(y, mo - 1, d));
    return y >= 1900 && at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d;
  }
  function isEmail(t){
    const candidate = t.toLowerCase();
    return candidate.length <= 254 && /^[\x21-\x7E]+$/.test(candidate) && EMAIL_PATTERN.test(candidate);
  }
  // An exact decimal: a string matching the server pattern (sent as that string) or a whole integer.
  function money(v){
    if(Number.isInteger(v)) return (v >= 0 && v <= 9999999999999) ? v : INVALID;
    return optional(v, (t) => /^\d{1,13}(\.\d{1,2})?$/.test(t));
  }
  function value(field, v){
    switch(field){
      case 'employeeCode': return text(v, 32, true, false);
      case 'fullName': return text(v, 160, true, false);
      case 'jobTitle': case 'department': return text(v, 120, false, false);
      case 'employmentStatus': return EMPLOYEE_API_STATUSES.indexOf(v) !== -1 ? v : INVALID;
      case 'joinDate': return optional(v, isDate);
      case 'contactEmail': return optional(v, isEmail);
      case 'phone': return optional(v, (t) => /^[0-9+()\-. ]{1,40}$/.test(t));
      case 'notes': return text(v, 2000, false, true);
      case 'monthlyBaseSalary': return money(v);
      default: return INVALID;
    }
  }
  function isPlain(v){
    return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  }
  // Copies the valid profile fields into `body`; returns the names of the unknown or invalid ones.
  function profile(fields, body){
    const bad = [];
    Object.keys(fields).forEach(function(k){
      if(EMPLOYEE_WRITABLE_FIELDS.indexOf(k) === -1){ bad.push(k); return; }
      const out = value(k, fields[k]);
      if(out === INVALID) bad.push(k); else body[k] = out;
    });
    return bad;
  }
  function target(id, expectedVersion, bad){
    if(typeof id !== 'string' || !EMPLOYEE_API_ID_PATTERN.test(id)) bad.push('id');
    if(!Number.isInteger(expectedVersion) || expectedVersion < 1 || expectedVersion > EMPLOYEE_API_MAX_VERSION) bad.push('expectedVersion');
  }
  function result(bad, body){
    return bad.length ? Object.freeze({ ok: false, fields: Object.freeze(bad) }) : Object.freeze({ ok: true, body: body });
  }

  return Object.freeze({
    // POST /api/employees/create: profile fields only; employeeCode and fullName required.
    create(fields){
      if(!isPlain(fields)) return result(REQUIRED.slice(), null);
      const body = {};
      const bad = profile(fields, body);
      REQUIRED.forEach(function(k){ if(!Object.prototype.hasOwnProperty.call(fields, k)) bad.push(k); });
      return result(bad, body);
    },
    // POST /api/employees/update: id, expectedVersion and at least one changed profile field.
    update(id, expectedVersion, changed){
      const body = { id: id, expectedVersion: expectedVersion };
      const bad = [];
      target(id, expectedVersion, bad);
      if(!isPlain(changed) || !Object.keys(changed).length) bad.push('fields');
      else Array.prototype.push.apply(bad, profile(changed, body));
      return result(bad, body);
    },
    // POST /api/employees/archive: exactly id and expectedVersion.
    archive(id, expectedVersion){
      const bad = [];
      target(id, expectedVersion, bad);
      return result(bad, { id: id, expectedVersion: expectedVersion });
    },
    // AFI-4a3 POST /api/employees/provision-account: exactly id and the login email (trimmed; the
    // server lower-cases it). The login email is entered for this purpose — never contactEmail.
    provisionAccount(id, email){
      const bad = [];
      if(typeof id !== 'string' || !EMPLOYEE_API_ID_PATTERN.test(id)) bad.push('id');
      const t = typeof email === 'string' ? email.trim() : '';
      if(!t || !isEmail(t)) bad.push('email');
      return result(bad, { id: id, email: t });
    },
    // AFI-4a3 reissue-activation / disable-account / enable-account: exactly the Employee id.
    accountTarget(id){
      const bad = [];
      if(typeof id !== 'string' || !EMPLOYEE_API_ID_PATTERN.test(id)) bad.push('id');
      return result(bad, { id: id });
    }
  });
})();

const EmployeeApi = (function(){
  // ApiResult -> { ok: true, data } | { ok: false, kind, retryAfter?, requestId? }.
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
      const invalid = { ok: false, kind: EMPLOYEE_API_INVALID };
      if(res.requestId) invalid.requestId = res.requestId;
      return Object.freeze(invalid);
    }
    return Object.freeze({ ok: true, data: data });
  }
  const refused = Object.freeze({ ok: false, kind: EMPLOYEE_API_INVALID });

  // One write through the established CSRF path. A refused request is never sent; an answer
  // carries authSessionMutation's recovery, and only a strictly decoded { employee: detail }
  // that `confirms` the write is a success.
  async function write(route, prepared, confirms){
    if(!prepared.ok) return Object.freeze({ ok: false, kind: API_RESULT_KINDS.VALIDATION, fields: prepared.fields, local: true, recovery: 'none' });
    const sent = await authSessionMutation(route, prepared.body);
    let out = outcome(sent.result, EmployeeDecoders.detailResponse);
    if(out.ok && !confirms(out.data)) out = refused;
    return Object.freeze(Object.assign({}, out, { recovery: sent.recovery }));
  }

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
    },
    // A new record: a server id, version 1, not archived.
    create(fields){
      return write('/api/employees/create', EmployeeRequests.create(fields), (e) => e.version === 1 && e.archived === false);
    },
    update(id, expectedVersion, changed){
      return write('/api/employees/update', EmployeeRequests.update(id, expectedVersion, changed), (e) => e.id === id && e.archived === false);
    },
    // Soft archive: the same record, now archived. There is no unarchive.
    archive(id, expectedVersion){
      return write('/api/employees/archive', EmployeeRequests.archive(id, expectedVersion), (e) => e.id === id && e.archived === true);
    },
    // AFI-4a3: a login now bound to this live record, activation outstanding.
    provisionAccount(id, email){
      return write('/api/employees/provision-account', EmployeeRequests.provisionAccount(id, email), (e) => e.id === id && e.archived === false && e.accountState === 'pending');
    },
    reissueActivation(id){
      return write('/api/employees/reissue-activation', EmployeeRequests.accountTarget(id), (e) => e.id === id && e.accountState === 'pending');
    },
    disableAccount(id){
      return write('/api/employees/disable-account', EmployeeRequests.accountTarget(id), (e) => e.id === id && e.accountState === 'disabled');
    },
    // Enabling restores the membership: active with a password, pending without (no mail is sent).
    enableAccount(id){
      return write('/api/employees/enable-account', EmployeeRequests.accountTarget(id), (e) => e.id === id && (e.accountState === 'active' || e.accountState === 'pending'));
    }
  });
})();
