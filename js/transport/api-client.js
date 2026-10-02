/* ============================================================
   SAME-ORIGIN API CLIENT (AFI-1) — js/transport/api-client.js
   ------------------------------------------------------------
   The ONE outbound HTTP boundary of the frontend. It is the only production
   module that may call fetch(); every future call to the same-origin backend
   (ADR-0004, SDR-0002) goes through ApiClient.request().

   NOT the TransportAdapter. TransportAdapter is the INBOUND, in-process
   application boundary (UI -> Transport -> Application Gateway -> Domain) and
   stays business-blind and network-free. ApiClient is OUTBOUND: browser ->
   /api/* on this origin. The two never call each other.

   INERT IN AFI-1: nothing at boot calls ApiClient. It is reached only by
   SessionIdentityProvider.refresh() (js/core/session-identity.js), and nothing
   in production invokes that yet. No request happens during normal boot.

   CONTRACT
     request(path, { method?, body?, csrf? }) -> Promise<ApiResult>
       path    a relative same-origin '/api/...' path. Absolute URLs,
               protocol-relative '//host' forms, '..' segments, query strings,
               fragments and anything outside /api/ are refused locally.
       query   AFI-4a1: GET / HEAD only — a plain object of API_QUERY_KEYS whose
               values are short identifier strings. It is serialized here, keys
               sorted and every part encoded; the path itself never carries '?'.
       method  GET | HEAD | POST | PUT | PATCH | DELETE (default GET).
       body    mutations only: a plain JSON object (default {}). It may never
               carry an authority/scope field (role, company, employee) — those
               are server-derived (SDR-0002 §23.8). D-AFI4b1-3: the one pinned
               target-selector exception, API_BODY_KEY_EXCEPTION, is employeeId on
               exactly POST /api/overtime-records/create — it names the record's
               owner; the server re-scopes and authorizes it. It is not authority.
       csrf    true only for a session-bound mutation. The token is read from
               the in-memory CsrfHolder and sent as X-CSRF-Token; never sent
               otherwise. An empty holder refuses the request locally.

     ApiResult — the backend envelope, normalized; the raw Response, the
     server's message text and any internal detail never leave this module:
       { ok: true,  data, requestId? }
       { ok: false, kind, fields?, retryAfter?, requestId? }

   TRUST BOUNDARY: the browser is untrusted. A result here is never authority —
   the server decides; this module only reports what it said. It persists
   nothing, logs nothing and generates no request id (the server's requestId is
   carried for diagnostics). It never retries.

   Classic shared global scope; no ES modules. Its symbols are top-level `const`
   bindings, shared with the other classic scripts but NOT attached to window.
   ============================================================ */

/* ---------- normalized failure kinds ---------- */
const API_RESULT_KINDS = Object.freeze({
  VALIDATION: 'VALIDATION',             // 400 validation_failed (fields named)
  CLIENT_FAULT: 'CLIENT_FAULT',         // a frontend bug: malformed call, 400/405/413/415
  UNAUTHENTICATED: 'UNAUTHENTICATED',   // 401
  DENIED: 'DENIED',                     // 403 (CSRF and policy alike — deliberately one answer)
  NOT_FOUND: 'NOT_FOUND',               // 404 (absent and out of scope alike)
  CONFLICT: 'CONFLICT',                 // 409
  RATE_LIMITED: 'RATE_LIMITED',         // 429 (+ retryAfter seconds)
  SERVER_ERROR: 'SERVER_ERROR',         // 500
  UNAVAILABLE: 'UNAVAILABLE'            // 503, network failure, timeout, non-canonical response
});

// Bounded wait for the whole exchange (headers and body). Fixed, so tests are deterministic.
const API_TIMEOUT_MS = 10000;

// Same-origin API paths only: '/api/' then unreserved path characters. No scheme, no
// host, no '//', no query, no fragment, no backslash. '..' segments are refused below.
const API_PATH_PATTERN = /^\/api\/[A-Za-z0-9._~\-\/]+$/;
const API_METHODS = Object.freeze(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
// Authority and scope are server-derived; a request body may never claim them.
const API_FORBIDDEN_BODY_KEYS = Object.freeze(['role', 'companyId', 'company_id', 'employeeId', 'employee_id']);
// D-AFI4b1-3: the ONE target-selector exception — this exact method, path and key, nothing else.
// The Overtime create body names the owner of the new record (BF-4b1 OvertimeInput::create); the
// server resolves it inside the session's scope (404 outside it) and Policy decides — the value
// selects a target and is never authority. Every other forbidden key, route and method is refused.
const API_BODY_KEY_EXCEPTION = Object.freeze({ method: 'POST', path: '/api/overtime-records/create', key: 'employeeId' });
// AFI-4a1 structured query: the only query keys a read may send (GET /api/employees
// ?archived=1, GET /api/employee?id=<opaque id>), and the only value shape — the server
// Employee id pattern (server/src/Employee/EmployeeInput.php ID_PATTERN), which '1' also fits.
// AFI-4b1: plus month (GET /api/overtime-records?month=YYYY-MM, which the same shape fits; the
// overtime record id fits it too).
const API_QUERY_KEYS = Object.freeze(['archived', 'id', 'month']);
const API_QUERY_VALUE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
// Server formats (server/src/Http/RequestId.php, server/src/Auth/SessionToken.php).
const API_REQUEST_ID_PATTERN = /^[0-9a-f]{32}$/;
const API_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const ApiClient = (function(){
  function isApiPath(path){
    return typeof path === 'string' && API_PATH_PATTERN.test(path)
      && path.indexOf('//') === -1 && !/(^|\/)\.\.?(\/|$)/.test(path);
  }

  function isPlainObject(v){
    return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  }

  // '' for an empty query, '?k=v&…' (keys sorted, parts encoded), or null when refused.
  function queryString(query){
    if(!isPlainObject(query)) return null;
    const keys = Object.keys(query).sort();
    const parts = [];
    for(let i = 0; i < keys.length; i++){
      const value = query[keys[i]];
      if(API_QUERY_KEYS.indexOf(keys[i]) === -1 || typeof value !== 'string' || !API_QUERY_VALUE_PATTERN.test(value)) return null;
      parts.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(value));
    }
    return parts.length ? '?' + parts.join('&') : '';
  }

  function failure(kind, extra){
    const r = { ok: false, kind: kind };
    if(extra){
      if(extra.fields) r.fields = extra.fields;
      if(extra.retryAfter !== undefined) r.retryAfter = extra.retryAfter;
      if(extra.requestId) r.requestId = extra.requestId;
    }
    return Object.freeze(r);
  }

  function requestIdOf(envelope, response){
    if(envelope && typeof envelope.requestId === 'string' && API_REQUEST_ID_PATTERN.test(envelope.requestId)) return envelope.requestId;
    const h = response.headers && typeof response.headers.get === 'function' ? response.headers.get('X-Request-Id') : null;
    return (typeof h === 'string' && API_REQUEST_ID_PATTERN.test(h)) ? h : undefined;
  }

  // Retry-After as whole non-negative seconds (the backend sends an integer); anything else is dropped.
  function retryAfterOf(response){
    const h = response.headers && typeof response.headers.get === 'function' ? response.headers.get('Retry-After') : null;
    return (typeof h === 'string' && /^[0-9]{1,6}$/.test(h)) ? parseInt(h, 10) : undefined;
  }

  // Only the field NAMES of a validation failure are carried — never values or messages.
  function fieldsOf(error){
    if(!error || !Array.isArray(error.fields)) return undefined;
    const names = error.fields.filter(function(f){ return typeof f === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(f); });
    return names.length ? Object.freeze(names.slice()) : undefined;
  }

  // Status -> kind. Only the canonical backend statuses are mapped; any other status
  // (including 422, which the backend does not use) is not a canonical answer.
  function kindOf(status, code){
    switch(status){
      case 400: return code === 'validation_failed' ? API_RESULT_KINDS.VALIDATION : API_RESULT_KINDS.CLIENT_FAULT;
      case 401: return API_RESULT_KINDS.UNAUTHENTICATED;
      case 403: return API_RESULT_KINDS.DENIED;
      case 404: return API_RESULT_KINDS.NOT_FOUND;
      case 405: case 413: case 415: return API_RESULT_KINDS.CLIENT_FAULT;
      case 409: return API_RESULT_KINDS.CONFLICT;
      case 429: return API_RESULT_KINDS.RATE_LIMITED;
      case 500: return API_RESULT_KINDS.SERVER_ERROR;
      default: return API_RESULT_KINDS.UNAVAILABLE;
    }
  }

  // Maps a received Response to an ApiResult. Anything that is not the canonical
  // JSON envelope (an HTML error page, a proxy answer, a contradiction between the
  // status and `ok`) is UNAVAILABLE — never success.
  async function normalize(response, method){
    const status = response.status;
    if(method === 'HEAD'){
      if(status >= 200 && status < 300) return Object.freeze({ ok: true, data: null, requestId: requestIdOf(null, response) });
      return failure(kindOf(status, null), { requestId: requestIdOf(null, response), retryAfter: status === 429 ? retryAfterOf(response) : undefined });
    }
    const type = response.headers && typeof response.headers.get === 'function' ? response.headers.get('Content-Type') : null;
    if(typeof type !== 'string' || !/^application\/json\b/i.test(type)) return failure(API_RESULT_KINDS.UNAVAILABLE);
    let envelope;
    try { envelope = JSON.parse(await response.text()); }
    catch(_e){ return failure(API_RESULT_KINDS.UNAVAILABLE); }
    if(!isPlainObject(envelope) || typeof envelope.ok !== 'boolean') return failure(API_RESULT_KINDS.UNAVAILABLE);
    const requestId = requestIdOf(envelope, response);
    if(status >= 200 && status < 300){
      if(envelope.ok !== true || !('data' in envelope)) return failure(API_RESULT_KINDS.UNAVAILABLE);
      return Object.freeze({ ok: true, data: envelope.data, requestId: requestId });
    }
    if(envelope.ok !== false || !isPlainObject(envelope.error) || typeof envelope.error.code !== 'string') return failure(API_RESULT_KINDS.UNAVAILABLE);
    const kind = kindOf(status, envelope.error.code);
    return failure(kind, {
      requestId: requestId,
      fields: kind === API_RESULT_KINDS.VALIDATION ? fieldsOf(envelope.error) : undefined,
      retryAfter: kind === API_RESULT_KINDS.RATE_LIMITED ? retryAfterOf(response) : undefined
    });
  }

  return Object.freeze({
    request: async function(path, options){
      const opts = options || {};
      const method = (opts.method === undefined) ? 'GET' : opts.method;
      if(!isApiPath(path) || API_METHODS.indexOf(method) === -1) return failure(API_RESULT_KINDS.CLIENT_FAULT);
      const mutation = method !== 'GET' && method !== 'HEAD';
      const headers = { 'Accept': 'application/json' };
      const init = {
        method: method,
        headers: headers,
        credentials: 'same-origin',
        mode: 'same-origin',
        cache: 'no-store',
        redirect: 'error'
      };
      if(mutation){
        const body = (opts.body === undefined) ? {} : opts.body;
        if(!isPlainObject(body)) return failure(API_RESULT_KINDS.CLIENT_FAULT);
        for(let i = 0; i < API_FORBIDDEN_BODY_KEYS.length; i++){
          const key = API_FORBIDDEN_BODY_KEYS[i];
          if(!Object.prototype.hasOwnProperty.call(body, key)) continue;
          if(method === API_BODY_KEY_EXCEPTION.method && path === API_BODY_KEY_EXCEPTION.path && key === API_BODY_KEY_EXCEPTION.key) continue;
          return failure(API_RESULT_KINDS.CLIENT_FAULT);
        }
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
        if(opts.csrf === true){
          const token = (typeof CsrfHolder !== 'undefined' && CsrfHolder) ? CsrfHolder.get() : null;
          if(typeof token !== 'string' || !API_TOKEN_PATTERN.test(token)) return failure(API_RESULT_KINDS.CLIENT_FAULT);
          headers['X-CSRF-Token'] = token;
        }
      } else if(opts.body !== undefined || opts.csrf === true){
        return failure(API_RESULT_KINDS.CLIENT_FAULT);   // GET/HEAD carry no body and no CSRF token
      }
      let target = path;
      if(opts.query !== undefined){
        const qs = mutation ? null : queryString(opts.query);
        if(qs === null) return failure(API_RESULT_KINDS.CLIENT_FAULT);   // a mutation carries no query; a bad query is never sent
        target = path + qs;
      }
      if(typeof fetch !== 'function' || typeof AbortController !== 'function') return failure(API_RESULT_KINDS.UNAVAILABLE);
      const controller = new AbortController();
      init.signal = controller.signal;
      const timer = setTimeout(function(){ controller.abort(); }, API_TIMEOUT_MS);
      try {
        const response = await fetch(target, init);
        return await normalize(response, method);
      } catch(_e){
        return failure(API_RESULT_KINDS.UNAVAILABLE);   // network failure, timeout (abort), redirect refused
      } finally {
        clearTimeout(timer);
      }
    }
  });
})();
