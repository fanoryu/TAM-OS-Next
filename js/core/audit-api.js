/* ============================================================
   AUDIT API (AFI-4g) — js/core/audit-api.js
   ------------------------------------------------------------
   The SESSION-mode client for the CEO audit read (BF-4g, PR #56; owner decisions D-BF4g-1..4 = A,
   D-AFI4g-1..10 = A): two reads over ApiClient, each answer strictly decoded before anything else
   sees it. Read only — there is no audit write, correction, deletion or export, and no
   authentication-log read. CEO only: SessionAudit never calls this for anyone else (the server
   answers 403 anyway, before any lookup).

     month(monthKey)        GET /api/audit-events?month=YYYY-MM            the audit events of one
                            month of the company calendar (Asia/Jakarta, D-BF4g-1 = A)
     record(entity, id)     GET /api/audit-events/record?entity=…&id=…     the history of one
                            record — [] when it has none; the server never looks the record up
                            (D-BF4g-4 = A), so an empty answer says nothing about the record

   STRICT DECODING: an event has exactly AuditEventView::FIELDS (server/src/Audit/AuditEventView.php)
   — never a company — with the server's grammars: a positive decimal id, occurredAt the stored
   UTC instant "YYYY-MM-DDTHH:MM:SS.ffffffZ", 32-hex actor, membership and request ids, an action
   of the closed vocabulary of migration 0035, the one entity that action names, an entity id in
   that entity's format (AuditInput::ENTITIES), the operation that action allows (null when it
   allows none), a null or 32-hex target user and a list of field NAMES. A list holds at most
   AUDIT_LIST_CAP events, each id once, strictly in the server's order (occurredAt, id); a month
   answer holds only events of that Asia/Jakarta month, a record answer only events of that
   entity and id. Anything else is INVALID_RESPONSE and nothing of it is returned.

   ABOVE THE CAP the server fails closed (D-BF4g-2 = A) with a 500 that carries no cause; a 500
   here is a SERVER_ERROR like any other and is never reported as a cap overflow (D-AFI4g-6 = A).

   COMPANY CALENDAR (D-AFI4g-4 = A): Asia/Jakarta is UTC+7 all year (no daylight saving).
   auditJakartaMonth() is the month the section opens on and auditJakartaTime() the WIB wall time
   an event is shown at — both pure, from the decoded UTC string, never from the browser's zone.
   The server decides which events belong to a month; the month check here is defence in depth.

   No identity join (D-AFI4g-7 = A): every id is shown as stored. Nothing is persisted, cached,
   logged or resent here.

   Classic shared global scope; top-level `const` bindings, not on window.
   ============================================================ */

// server/src/Audit/AuditEventView.php FIELDS (sorted); AuditEventStore::LIST_CAP.
const AUDIT_EVENT_KEYS = Object.freeze(['action', 'actorMembershipId', 'actorUserId', 'entity', 'entityId', 'fields', 'id', 'occurredAt', 'operation', 'requestId', 'targetUserId']);
const AUDIT_LIST_CAP = 2000;
const AUDIT_API_INVALID = 'INVALID_RESPONSE';
const AUDIT_JAKARTA_OFFSET_MS = 25200000;
const AUDIT_HEX32_PATTERN = /^[0-9a-f]{32}$/;
const AUDIT_EVENT_ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const AUDIT_OCCURRED_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})\.([0-9]{6})Z$/;
const AUDIT_FIELD_PATTERN = /^[a-z][A-Za-z]{0,31}$/;
// AuditInput::ENTITIES — the stored audit entities and each one's id format.
const AUDIT_ENTITY_ID_PATTERNS = Object.freeze({
  employee: /^[A-Za-z0-9_-]{1,64}$/,
  overtime: AUDIT_HEX32_PATTERN,
  payrollPlan: AUDIT_HEX32_PATTERN,
  supplementalPayroll: AUDIT_HEX32_PATTERN,
  financePosting: AUDIT_HEX32_PATTERN
});
// Migration 0035 audit_events_action_v6 / audit_events_entity_v5: each action and the one entity
// it names.
const AUDIT_ACTION_ENTITY = Object.freeze({
  'employee.create': 'employee', 'employee.update': 'employee', 'employee.delete': 'employee', 'account.manage': 'employee',
  'overtime.createSelfDraft': 'overtime', 'overtime.updateSelfDraft': 'overtime', 'overtime.deleteSelfDraft': 'overtime',
  'overtime.submitSelf': 'overtime', 'overtime.manage': 'overtime',
  'payroll.manage': 'payrollPlan', 'supplemental.manage': 'supplementalPayroll', 'finance.execute': 'financePosting'
});
// Migration 0035 audit_events_action_operation_v7: the operations an action requires; an action
// not named here stores none.
const AUDIT_ACTION_OPERATIONS = Object.freeze({
  'account.manage': Object.freeze(['provision', 'reissue', 'disable', 'enable']),
  'overtime.submitSelf': Object.freeze(['submit']),
  'overtime.manage': Object.freeze(['review', 'reject', 'approve']),
  'payroll.manage': Object.freeze(['create', 'recalculate', 'review', 'approve', 'return', 'cancel', 'commit', 'post']),
  'supplemental.manage': Object.freeze(['create', 'recalculate', 'review', 'approve', 'return', 'cancel', 'commit', 'post']),
  'finance.execute': Object.freeze(['execute'])
});
const AUDIT_ROUTES = Object.freeze({ month: '/api/audit-events', record: '/api/audit-events/record' });

// A stored audit entity and an id in its format (the request mirror of AuditInput::record).
function auditIsRecord(entity, id){
  return typeof entity === 'string' && Object.prototype.hasOwnProperty.call(AUDIT_ENTITY_ID_PATTERNS, entity)
    && typeof id === 'string' && AUDIT_ENTITY_ID_PATTERNS[entity].test(id);
}

// The parts of a decoded occurredAt that is a real UTC instant, or null.
function auditInstant(v){
  const m = typeof v === 'string' ? AUDIT_OCCURRED_PATTERN.exec(v) : null;
  if(!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], mi = +m[5], s = +m[6];
  if(y < 1900 || mi > 59 || s > 59) return null;
  // A month, day or hour out of range rolls into another date, which the round trip refuses.
  const ms = Date.UTC(y, mo - 1, d, +m[4], mi, s);
  const back = new Date(ms);
  if(back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return { ms: ms, micro: m[7] };
}

// The company-calendar wall time "YYYY-MM-DD HH:MM:SS" of a decoded occurredAt (seconds; the
// exact instant stays in occurredAt), or '' when it is not one.
function auditJakartaTime(occurredAt){
  const t = auditInstant(occurredAt);
  return t ? new Date(t.ms + AUDIT_JAKARTA_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ') : '';
}

// The company-calendar month "YYYY-MM" of `now` (a Date) — the month the section opens on.
function auditJakartaMonth(now){
  return new Date((now || new Date()).getTime() + AUDIT_JAKARTA_OFFSET_MS).toISOString().slice(0, 7);
}

// (occurredAt, id) of a strictly before b — the server's total order. occurredAt is fixed-width;
// the decimal ids compare by length, then digit by digit.
function auditBefore(a, b){
  if(a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt;
  if(a.id.length !== b.id.length) return a.id.length < b.id.length;
  return a.id < b.id;
}

const AuditDecoders = (function(){
  function isPlain(v){
    return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  }
  function exactKeys(o, keys){
    const k = Object.keys(o).sort();
    if(k.length !== keys.length) return false;
    for(let i = 0; i < k.length; i++){ if(k[i] !== keys[i]) return false; }
    return true;
  }
  // A frozen copy holding exactly the event keys, or null.
  function event(o){
    if(!isPlain(o) || !exactKeys(o, AUDIT_EVENT_KEYS)) return null;
    if(typeof o.id !== 'string' || !AUDIT_EVENT_ID_PATTERN.test(o.id) || !auditInstant(o.occurredAt)) return null;
    if(![o.actorUserId, o.actorMembershipId, o.requestId].every((v) => typeof v === 'string' && AUDIT_HEX32_PATTERN.test(v))) return null;
    // An action outside the vocabulary names no entity, so it fails the entity check.
    if(typeof o.action !== 'string' || o.entity !== AUDIT_ACTION_ENTITY[o.action] || !auditIsRecord(o.entity, o.entityId)) return null;
    const ops = Object.prototype.hasOwnProperty.call(AUDIT_ACTION_OPERATIONS, o.action) ? AUDIT_ACTION_OPERATIONS[o.action] : null;
    if(ops ? ops.indexOf(o.operation) === -1 : o.operation !== null) return null;
    if(o.targetUserId !== null && !(typeof o.targetUserId === 'string' && AUDIT_HEX32_PATTERN.test(o.targetUserId))) return null;
    if(!Array.isArray(o.fields) || !o.fields.every((f) => typeof f === 'string' && AUDIT_FIELD_PATTERN.test(f))) return null;
    const out = {};
    for(let i = 0; i < AUDIT_EVENT_KEYS.length; i++) out[AUDIT_EVENT_KEYS[i]] = o[AUDIT_EVENT_KEYS[i]];
    out.fields = Object.freeze(o.fields.slice());
    return Object.freeze(out);
  }
  // { auditEvents: [event…] } -> frozen array, or null: at most the cap, each id once, in the
  // server's order, every event accepted by `belongs`.
  function list(data, belongs){
    if(!isPlain(data) || !exactKeys(data, ['auditEvents']) || !Array.isArray(data.auditEvents) || data.auditEvents.length > AUDIT_LIST_CAP) return null;
    const out = [];
    for(let i = 0; i < data.auditEvents.length; i++){
      const item = event(data.auditEvents[i]);
      if(!item || !belongs(item)) return null;
      if(out.length && !auditBefore(out[out.length - 1], item)) return null;      // strictly in the server's order
      out.push(item);
    }
    const ids = new Set(out.map((e) => e.id));                                    // and each id once, wherever it is
    return ids.size === out.length ? Object.freeze(out) : null;
  }
  return Object.freeze({
    event: event,
    // The events of exactly `monthKey` in the company calendar.
    monthResponse(data, monthKey){
      return list(data, (e) => auditJakartaTime(e.occurredAt).slice(0, 7) === monthKey);
    },
    // The events of exactly `entity` / `id`; [] when there are none.
    recordResponse(data, entity, id){
      return list(data, (e) => e.entity === entity && e.entityId === id);
    }
  });
})();

const AuditApi = (function(){
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
      const invalid = { ok: false, kind: AUDIT_API_INVALID };
      if(res.requestId) invalid.requestId = res.requestId;
      return Object.freeze(invalid);
    }
    return Object.freeze({ ok: true, data: data });
  }
  // A request outside the grammar is never sent.
  const refused = Object.freeze({ ok: false, kind: API_RESULT_KINDS.CLIENT_FAULT });

  return Object.freeze({
    async month(monthKey){
      if(!OvertimeCalendar.isMonth(monthKey)) return refused;
      const res = await ApiClient.request(AUDIT_ROUTES.month, { method: 'GET', query: { month: monthKey } });
      return outcome(res, (d) => AuditDecoders.monthResponse(d, monthKey));
    },
    async record(entity, id){
      if(!auditIsRecord(entity, id)) return refused;
      const res = await ApiClient.request(AUDIT_ROUTES.record, { method: 'GET', query: { entity: entity, id: id } });
      return outcome(res, (d) => AuditDecoders.recordResponse(d, entity, id));
    }
  });
})();
