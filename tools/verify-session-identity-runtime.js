#!/usr/bin/env node
'use strict';
/* ============================================================
   AFI-1 — SESSION IDENTITY FOUNDATION RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of the AFI-1 foundation. This
   harness proves its BEHAVIOUR by executing the real production modules
   (js/transport/api-client.js, js/core/session-identity.js, js/core/identity.js)
   through the same dependency-free Node `vm` loader as the other runtime
   harnesses: every module in module-order.js MINUS core/app-bootstrap.js, run
   against an in-memory window/localStorage.

   NO NETWORK: fetch is a deterministic stub that records every call and answers
   from a scripted response. The request timeout is driven by a controllable
   timer, never by waiting. All identities and tokens are fabricated.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

const CSRF_A = 'A'.repeat(21) + '_' + 'b'.repeat(21);          // 43 chars, token shape
const CSRF_B = 'Z'.repeat(20) + '-' + '9'.repeat(22);
const RID = '0123456789abcdef0123456789abcdef';
const RID2 = 'fedcba9876543210fedcba9876543210';
const API_TIMEOUT_EXPECTED = 10000;

/* ---------- scripted fetch + controllable timer ---------- */
function makeNet(){
  const net = { calls: [], responder: null, timers: [], cleared: [] };
  net.fetch = function(url, init){
    net.calls.push({ url: url, init: init });
    return new Promise(function(resolve, reject){
      if(init && init.signal){
        init.signal.addEventListener('abort', function(){ reject(new Error('AbortError')); });
      }
      const r = net.responder;
      if(typeof r !== 'function'){ return; }                 // never answers (timeout scenario)
      Promise.resolve().then(function(){
        try {
          const out = r(url, init);
          if(out instanceof Error) reject(out); else resolve(out);
        } catch(e){ reject(e); }
      });
    });
  };
  return net;
}
function resp(status, body, headers){
  const h = Object.assign({ 'content-type': 'application/json; charset=utf-8' }, headers || {});
  const lower = {}; Object.keys(h).forEach(function(k){ lower[k.toLowerCase()] = h[k]; });
  return {
    status: status,
    headers: { get: function(name){ const v = lower[String(name).toLowerCase()]; return v === undefined ? null : v; } },
    text: async function(){ return typeof body === 'string' ? body : JSON.stringify(body); }
  };
}
function okEnv(data, rid){ return { ok: true, data: data, requestId: rid === undefined ? RID : rid }; }
function errEnv(code, extra){ return { ok: false, error: Object.assign({ code: code, message: 'server text' }, extra || {}), requestId: RID }; }

/* ---------- runtime loader (same technique as the other harnesses) ---------- */
function loadRuntime(){
  const root = path.resolve(__dirname, '..');
  const jsFiles = require(path.join(root, 'tools', 'module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => fs.readFileSync(path.join(root, 'js', f), 'utf8')).join('\n')
    + '\n;window.__TAM__ = { State: State, ApiClient: ApiClient, API_RESULT_KINDS: API_RESULT_KINDS,'
    + ' API_TIMEOUT_MS: API_TIMEOUT_MS, CsrfHolder: CsrfHolder, SessionIdentityProvider: SessionIdentityProvider,'
    + ' mapSessionProjection: mapSessionProjection, getCurrentUser: getCurrentUser, isValidUser: isValidUser,'
    + ' getCurrentWorkspace: getCurrentWorkspace, LocalIdentityProvider: LocalIdentityProvider,'
    + ' setIdentityProviderForTesting: setIdentityProviderForTesting, API_BODY_KEY_EXCEPTION: API_BODY_KEY_EXCEPTION,'
    // Builds a request body in the PAGE realm, as a real caller would (a plain object
    // from this Node realm has a different Object.prototype).
    + ' body: function(json){ return JSON.parse(json); } };';
  const noop = function(){};
  const memStore = {};
  const memStorage = {
    getItem: (k) => Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null,
    setItem: (k, v) => { memStore[k] = String(v); },
    removeItem: (k) => { delete memStore[k]; }
  };
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const net = makeNet();
  let nextTimer = 1;
  const sandbox = {
    console: { log:noop, warn:noop, error:noop }, navigator: { userAgent:'tam-afi1' },
    // The API timeout is recorded for manual firing; every other timer is real.
    setTimeout: function(fn, ms){
      if(ms === API_TIMEOUT_EXPECTED){ const id = 'api-' + (nextTimer++); net.timers.push({ id: id, fn: fn, ms: ms }); return id; }
      return setTimeout(fn, ms);
    },
    clearTimeout: function(id){ if(typeof id === 'string' && id.indexOf('api-') === 0){ net.cleared.push(id); return; } clearTimeout(id); },
    AbortController: AbortController,
    fetch: net.fetch,
    localStorage: memStorage, sessionStorage: memStorage, storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document: { addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-afi1-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.net = net; rt.memStore = memStore;
  return rt;
}
const flush = () => new Promise(r => setImmediate(r));
// Reads one field of a principal that may be null, so a wrongly refused identity is a
// counted [FAIL] (and the run reaches its summary) instead of a TypeError that aborts it.
const fieldOf = (o, k) => (o && typeof o === 'object') ? o[k] : undefined;

const ME_CEO = { userId: 'u_ceo_1', membershipId: 'm_ceo_1', role: 'ceo', employeeId: null, csrfToken: CSRF_A };

(async function main(){
  console.log('== AFI-1 SESSION IDENTITY FOUNDATION — RUNTIME VERIFICATION ==');
  console.log('   ApiClient / normalized results / CsrfHolder / SessionIdentityProvider /');
  console.log('   /api/auth/me projection / CEO binding / no fallback. Inert foundation.');
  console.log('');

  /* ---------- 0. inert at load: no request, no window exposure, Local provider active ---------- */
  {
    const rt = loadRuntime();
    check(rt.net.calls.length === 0, 'inert: loading every production module performs no fetch');
    check(rt.w.ApiClient === undefined && rt.w.SessionIdentityProvider === undefined && rt.w.CsrfHolder === undefined,
      'inert: ApiClient / SessionIdentityProvider / CsrfHolder are not exposed on window');
    check(rt.getCurrentUser() === null, 'inert: boot identity is still null (no session lookup, no default principal)');
    rt.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
    const u = rt.getCurrentUser();
    check(!!u && u.id === 'user_ceo_fixture' && rt.net.calls.length === 0,
      'inert: LocalIdentityProvider remains the active provider ("Acting as" selection works, no request)');
    check(rt.API_TIMEOUT_MS === API_TIMEOUT_EXPECTED, 'timeout: API_TIMEOUT_MS is a fixed 10000 ms');
  }

  /* ---------- 1. path acceptance / rejection ---------- */
  {
    const rt = loadRuntime(); const K = rt.API_RESULT_KINDS;
    rt.net.responder = () => resp(200, okEnv({ a: 1 }));
    const good = await rt.ApiClient.request('/api/auth/me');
    check(good.ok === true && rt.net.calls.length === 1 && rt.net.calls[0].url === '/api/auth/me',
      'path: relative /api/auth/me accepted and requested verbatim');
    const bad = ['http://evil.example/api/auth/me', 'https://evil.example/api/auth/me', '//evil.example/api/auth/me',
      '/other/path', '/api', '/api/', 'api/auth/me', '/api/../auth', '/api/./me', '/api//me', '/api/auth/me?x=1',
      '/api/auth/me#f', '/api/a\\b', ' /api/auth/me', '/API/auth/me', '', null, undefined, 42, { toString(){ return '/api/auth/me'; } }];
    let allRefused = true;
    for(const p of bad){
      const r = await rt.ApiClient.request(p);
      if(!(r.ok === false && r.kind === K.CLIENT_FAULT)) allRefused = false;
    }
    check(allRefused, 'path: absolute, protocol-relative, non-/api, dot-segment, query, fragment and non-string paths are CLIENT_FAULT');
    check(rt.net.calls.length === 1, 'path: no refused path ever reaches fetch');
  }

  /* ---------- 2. fetch options, GET/HEAD shape ---------- */
  {
    const rt = loadRuntime(); const K = rt.API_RESULT_KINDS;
    rt.CsrfHolder.replace(CSRF_A);
    rt.net.responder = () => resp(200, okEnv({}));
    await rt.ApiClient.request('/api/auth/me', { method: 'GET' });
    const init = rt.net.calls[0].init;
    check(init.credentials === 'same-origin' && init.mode === 'same-origin' && init.cache === 'no-store' && init.redirect === 'error',
      "fetch options: credentials 'same-origin', mode 'same-origin', cache 'no-store', redirect 'error'");
    check(init.method === 'GET' && init.body === undefined, 'GET: no request body');
    check(init.headers['Content-Type'] === undefined && init.headers['X-CSRF-Token'] === undefined,
      'GET: no Content-Type and no CSRF header even while a token is held');
    check(init.headers.Accept === 'application/json', 'GET: Accept application/json');
    check(!!init.signal && typeof init.signal.aborted === 'boolean', 'fetch receives an AbortController signal');
    const before = rt.net.calls.length;
    const r1 = await rt.ApiClient.request('/api/auth/me', { method: 'GET', body: rt.body('{}') });
    const r2 = await rt.ApiClient.request('/api/auth/me', { method: 'GET', csrf: true });
    const r3 = await rt.ApiClient.request('/api/auth/me', { method: 'TRACE' });
    check(r1.kind === K.CLIENT_FAULT && r2.kind === K.CLIENT_FAULT && r3.kind === K.CLIENT_FAULT && rt.net.calls.length === before,
      'GET with a body, GET with csrf, and an unknown method are refused locally');
    rt.net.responder = () => resp(200, '', { 'x-request-id': RID2, 'content-type': 'text/plain' });
    const h = await rt.ApiClient.request('/api/auth/me', { method: 'HEAD' });
    const hInit = rt.net.calls[rt.net.calls.length - 1].init;
    check(h.ok === true && h.data === null && h.requestId === RID2 && hInit.body === undefined,
      'HEAD: no body; success carries data null and the header request id');
  }

  /* ---------- 3. JSON mutations, authority fields, CSRF injection ---------- */
  {
    const rt = loadRuntime(); const K = rt.API_RESULT_KINDS;
    rt.net.responder = () => resp(200, okEnv({ done: true }));
    await rt.ApiClient.request('/api/auth/logout', { method: 'POST' });
    const i0 = rt.net.calls[0].init;
    check(i0.headers['Content-Type'] === 'application/json' && i0.body === '{}', 'mutation: JSON Content-Type, default body {}');
    check(i0.headers['X-CSRF-Token'] === undefined, 'CSRF: no header when the caller does not request CSRF');
    await rt.ApiClient.request('/api/auth/forgot-password', { method: 'POST', body: rt.body('{"email":"x@example.invalid"}') });
    check(rt.net.calls[1].init.body === '{"email":"x@example.invalid"}', 'mutation: plain object body serialized as JSON');
    const n = rt.net.calls.length;
    const forbidden = ['role', 'companyId', 'company_id', 'employeeId', 'employee_id'];
    let allRefused = true;
    for(const k of forbidden){
      const b = rt.body(JSON.stringify({ [k]: 'x' }));
      const r = await rt.ApiClient.request('/api/auth/logout', { method: 'POST', body: b });
      if(r.kind !== K.CLIENT_FAULT) allRefused = false;
    }
    const arr = await rt.ApiClient.request('/api/auth/logout', { method: 'POST', body: [] });
    const str = await rt.ApiClient.request('/api/auth/logout', { method: 'POST', body: 'x' });
    // D-AFI4b1-3 revision: identity-shaped mutation keys stay forbidden except for the ONE explicit
    // Overtime-create employeeId target selector (proven in section 3b). Was: forbidden everywhere.
    check(allRefused && arr.kind === K.CLIENT_FAULT && str.kind === K.CLIENT_FAULT && rt.net.calls.length === n,
      'mutation: role/companyId/company_id/employeeId/employee_id and non-object bodies are refused before any request (outside the one Overtime-create selector)');
    const noTok = await rt.ApiClient.request('/api/auth/logout', { method: 'POST', csrf: true });
    check(noTok.kind === K.CLIENT_FAULT && rt.net.calls.length === n, 'CSRF: requested with an empty holder -> refused locally, nothing sent');
    rt.CsrfHolder.replace(CSRF_A);
    await rt.ApiClient.request('/api/auth/logout', { method: 'POST', csrf: true });
    check(rt.net.calls[n].init.headers['X-CSRF-Token'] === CSRF_A, 'CSRF: X-CSRF-Token injected from the holder when requested');
    rt.CsrfHolder.replace(CSRF_B);
    await rt.ApiClient.request('/api/auth/logout', { method: 'POST', csrf: true });
    check(rt.net.calls[n + 1].init.headers['X-CSRF-Token'] === CSRF_B, 'CSRF: a replaced token is the one sent next');
  }

  /* ---------- 3b. D-AFI4b1-3: the one route-scoped employeeId target selector ---------- */
  {
    const rt = loadRuntime(); const K = rt.API_RESULT_KINDS;
    const X = rt.API_BODY_KEY_EXCEPTION;
    check(!!X && Object.isFrozen(X) && Object.keys(X).sort().join() === 'key,method,path'
      && X.method === 'POST' && X.path === '/api/overtime-records/create' && X.key === 'employeeId'
      && rt.w.API_BODY_KEY_EXCEPTION === undefined,
      'selector: exactly one frozen exception { POST, /api/overtime-records/create, employeeId }, not on window');
    try { X.path = '/api/employees/create'; X.key = 'employee_id'; X.method = 'PUT'; } catch(_e){ /* frozen */ }
    check(X.path === '/api/overtime-records/create' && X.key === 'employeeId' && X.method === 'POST',
      'selector: the exception cannot be rewritten at runtime');
    rt.net.responder = () => resp(200, okEnv({ done: true }));
    rt.CsrfHolder.replace(CSRF_A);
    const OT_CREATE = '/api/overtime-records/create';
    const okBody = '{"employeeId":"emp_srv_1","monthKey":"2026-10","hours":"7.50"}';
    const r0 = await rt.ApiClient.request(OT_CREATE, { method: 'POST', body: rt.body(okBody), csrf: true });
    const c0 = rt.net.calls[0];
    check(r0.ok === true && rt.net.calls.length === 1 && c0.url === OT_CREATE && c0.init.method === 'POST'
      && c0.init.body === okBody && c0.init.headers['X-CSRF-Token'] === CSRF_A,
      'selector: POST /api/overtime-records/create with employeeId is sent, body byte-exact, CSRF header attached');
    const r0b = await rt.ApiClient.request(OT_CREATE, { method: 'POST', body: rt.body('{"employeeId":"someone_else_9","monthKey":"2026-10","hours":"1.00"}') });
    check(r0b.ok === true && rt.net.calls.length === 2 && JSON.parse(rt.net.calls[1].init.body).employeeId === 'someone_else_9',
      'selector: any well-shaped value is passed through untouched — the client never treats it as authority; the server re-scopes it');
    // Negative: employeeId on every other route stays CLIENT_FAULT, nothing sent.
    const n = rt.net.calls.length;
    const otherRoutes = ['/api/employees/create', '/api/employees/update', '/api/employees/archive',
      '/api/overtime-records/update', '/api/overtime-records/delete', '/api/overtime-records/submit',
      '/api/overtime-records/review', '/api/overtime-records/reject', '/api/auth/logout', '/api/auth/login',
      '/api/overtime-records/create/', '/api/overtime-records', '/api/overtime-records/creat', '/api/overtime-records/create/x',
      '/api/Overtime-records/create', '/api/employees/provision-account'];
    for(const route of otherRoutes){
      const r = await rt.ApiClient.request(route, { method: 'POST', body: rt.body('{"employeeId":"emp_srv_1","id":"x"}') });
      check(r.kind === K.CLIENT_FAULT && rt.net.calls.length === n, 'selector: employeeId on POST ' + route + ' is CLIENT_FAULT, nothing sent');
    }
    const otherMethods = [];
    for(const method of ['PUT', 'PATCH', 'DELETE']){
      const r = await rt.ApiClient.request(OT_CREATE, { method: method, body: rt.body(okBody) });
      if(r.kind !== K.CLIENT_FAULT) otherMethods.push(method);
    }
    const getQ = await rt.ApiClient.request('/api/overtime-records', { method: 'GET', query: rt.body('{"employeeId":"emp_srv_1"}') });
    check(otherMethods.length === 0 && getQ.kind === K.CLIENT_FAULT && rt.net.calls.length === n,
      'selector: PUT / PATCH / DELETE to the create path with employeeId, and employeeId as a GET query key, are refused locally');
    // Negative on the authorized route itself: every other identity key stays forbidden.
    for(const extra of ['employee_id', 'role', 'companyId', 'company_id']){
      const alone = await rt.ApiClient.request(OT_CREATE, { method: 'POST', body: rt.body(JSON.stringify({ [extra]: 'x', monthKey: '2026-10', hours: '1.00' })) });
      const withSel = await rt.ApiClient.request(OT_CREATE, { method: 'POST', body: rt.body(JSON.stringify({ employeeId: 'emp_srv_1', [extra]: 'x', monthKey: '2026-10', hours: '1.00' })) });
      check(alone.kind === K.CLIENT_FAULT && withSel.kind === K.CLIENT_FAULT && rt.net.calls.length === n,
        'selector: ' + extra + ' stays CLIENT_FAULT on POST /api/overtime-records/create — alone and beside employeeId');
    }
    const r404 = await (async () => { rt.net.responder = () => resp(404, errEnv('not_found')); return rt.ApiClient.request(OT_CREATE, { method: 'POST', body: rt.body(okBody) }); })();
    check(r404.ok === false && r404.kind === K.NOT_FOUND && rt.net.calls.length === n + 1,
      'selector: an out-of-scope target is the server answer (404 NOT_FOUND passed through), never decided by the client');
  }

  /* ---------- 4. CsrfHolder ---------- */
  {
    const rt = loadRuntime();
    check(rt.CsrfHolder.get() === null, 'CsrfHolder: begins empty');
    check(rt.CsrfHolder.replace('short') === false && rt.CsrfHolder.replace(null) === false
      && rt.CsrfHolder.replace(CSRF_A + 'x') === false && rt.CsrfHolder.get() === null,
      'CsrfHolder: malformed tokens refused, holder stays empty');
    check(rt.CsrfHolder.replace(CSRF_A) === true && rt.CsrfHolder.get() === CSRF_A, 'CsrfHolder: replace stores a well-formed token');
    rt.CsrfHolder.clear();
    check(rt.CsrfHolder.get() === null, 'CsrfHolder: clear empties it');
    check(Object.isFrozen(rt.CsrfHolder), 'CsrfHolder: frozen API (get / replace / clear only)');
    const rt2 = loadRuntime();
    check(rt2.CsrfHolder.get() === null, 'CsrfHolder: a reload starts empty (nothing persisted)');
  }

  /* ---------- 5. timeout, network failure, invalid responses ---------- */
  {
    const rt = loadRuntime(); const K = rt.API_RESULT_KINDS;
    rt.net.responder = null;                                         // never answers
    const pending = rt.ApiClient.request('/api/auth/me');
    await flush();
    check(rt.net.timers.length === 1 && rt.net.timers[0].ms === API_TIMEOUT_EXPECTED, 'timeout: one 10000 ms timer armed per request');
    rt.net.timers[0].fn();                                           // fire the timeout deterministically
    const t = await pending;
    check(t.ok === false && t.kind === K.UNAVAILABLE, 'timeout: abort -> UNAVAILABLE');
    check(rt.net.cleared.indexOf(rt.net.timers[0].id) !== -1, 'timeout: the timer is cleared once the request settles');
    rt.net.responder = () => resp(200, okEnv({}));
    await rt.ApiClient.request('/api/auth/me');
    check(rt.net.cleared.indexOf(rt.net.timers[1].id) !== -1, 'timeout: the timer is cleared after a successful response');
    rt.net.responder = () => new TypeError('Failed to fetch');
    const nf = await rt.ApiClient.request('/api/auth/me');
    check(nf.kind === K.UNAVAILABLE, 'network failure -> UNAVAILABLE');
    const cases = [
      ['HTML 404 page', resp(404, '<html>not found</html>', { 'content-type': 'text/html' })],
      ['JSON content type, invalid JSON', resp(200, '{not json')],
      ['JSON but not an envelope', resp(200, [1, 2])],
      ['200 carrying ok:false', resp(200, { ok: false, error: { code: 'x' } })],
      ['200 without data', resp(200, { ok: true, requestId: RID })],
      ['error status carrying ok:true', resp(500, { ok: true, data: {} })],
      ['error envelope without a code', resp(401, { ok: false, error: {} })],
      ['no Content-Type', resp(200, okEnv({}), { 'content-type': undefined })]
    ];
    for(const [label, r] of cases){
      rt.net.responder = () => r;
      const out = await rt.ApiClient.request('/api/auth/me');
      check(out.ok === false && out.kind === K.UNAVAILABLE, 'invalid response -> UNAVAILABLE: ' + label);
    }
  }

  /* ---------- 6. success envelope, requestId ---------- */
  {
    const rt = loadRuntime();
    rt.net.responder = () => resp(200, okEnv({ a: 1, b: [2] }));
    const s = await rt.ApiClient.request('/api/auth/me');
    check(s.ok === true && s.data.a === 1 && s.data.b[0] === 2 && s.requestId === RID, 'success: data and server requestId returned');
    check(Object.keys(s).sort().join(',') === 'data,ok,requestId', 'success: only ok / data / requestId exposed (no raw Response)');
    rt.net.responder = () => resp(200, { ok: true, data: 1 }, { 'x-request-id': RID2 });
    const h = await rt.ApiClient.request('/api/auth/me');
    check(h.requestId === RID2, 'requestId: falls back to the X-Request-Id header');
    rt.net.responder = () => resp(200, okEnv(1, 'not-a-request-id'));
    const bad = await rt.ApiClient.request('/api/auth/me');
    check(bad.ok === true && bad.requestId === undefined, 'requestId: a malformed id is dropped, never invented');
    rt.net.responder = () => resp(404, errEnv('not_found'));
    const e = await rt.ApiClient.request('/api/auth/me');
    check(e.requestId === RID, 'requestId: propagated on failures');
  }

  /* ---------- 7. canonical error mapping ---------- */
  {
    const rt = loadRuntime(); const K = rt.API_RESULT_KINDS;
    const table = [
      [400, 'validation_failed', K.VALIDATION], [400, 'malformed_json', K.CLIENT_FAULT], [400, 'invalid_query', K.CLIENT_FAULT],
      [401, 'unauthenticated', K.UNAUTHENTICATED], [403, 'forbidden', K.DENIED], [404, 'not_found', K.NOT_FOUND],
      [405, 'method_not_allowed', K.CLIENT_FAULT], [409, 'conflict', K.CONFLICT], [413, 'payload_too_large', K.CLIENT_FAULT],
      [415, 'unsupported_media_type', K.CLIENT_FAULT], [429, 'rate_limited', K.RATE_LIMITED], [500, 'internal_error', K.SERVER_ERROR],
      [503, 'service_unavailable', K.UNAVAILABLE], [422, 'unprocessable', K.UNAVAILABLE], [502, 'bad_gateway', K.UNAVAILABLE]
    ];
    for(const [status, code, kind] of table){
      rt.net.responder = () => resp(status, errEnv(code));
      const r = await rt.ApiClient.request('/api/auth/me');
      check(r.ok === false && r.kind === kind, 'mapping: ' + status + ' ' + code + ' -> ' + kind);
      check(!('message' in r) && !('error' in r) && !('code' in r), 'mapping: ' + status + ' exposes no server message / raw error');
    }
    rt.net.responder = () => resp(403, errEnv('forbidden'));
    const d = await rt.ApiClient.request('/api/auth/logout', { method: 'POST' });
    check(d.ok === false && d.kind === K.DENIED, '403 on a mutation is DENIED, never success');
    rt.net.responder = () => resp(400, errEnv('validation_failed', { fields: ['token', 'bad field!', 7, 'password'] }));
    const v = await rt.ApiClient.request('/api/auth/reset-password', { method: 'POST', body: rt.body('{"token":"t","password":"p"}') });
    check(v.kind === K.VALIDATION && JSON.stringify(v.fields) === '["token","password"]', 'VALIDATION: only well-formed field names carried');
    rt.net.responder = () => resp(400, errEnv('validation_failed', { fields: ['token'] }));
    const tok = await rt.ApiClient.request('/api/auth/activate', { method: 'POST', body: rt.body('{"token":"t","password":"p"}') });
    check(JSON.stringify(Object.keys(tok).sort()) === '["fields","kind","ok","requestId"]' && tok.fields[0] === 'token',
      'anti-enumeration: a token failure stays the generic {kind, fields:["token"]}');
    rt.net.responder = () => resp(404, errEnv('not_found'));
    const nf = await rt.ApiClient.request('/api/auth/me');
    check(JSON.stringify(Object.keys(nf).sort()) === '["kind","ok","requestId"]', 'anti-enumeration: 404 carries nothing that separates absent from out of scope');
  }

  /* ---------- 8. Retry-After ---------- */
  {
    const rt = loadRuntime(); const K = rt.API_RESULT_KINDS;
    rt.net.responder = () => resp(429, errEnv('rate_limited'), { 'retry-after': '30' });
    const a = await rt.ApiClient.request('/api/auth/login', { method: 'POST', body: rt.body('{"email":"e","password":"p"}') });
    check(a.kind === K.RATE_LIMITED && a.retryAfter === 30, 'Retry-After: integer seconds parsed on 429');
    rt.net.responder = () => resp(429, errEnv('rate_limited'));
    const b = await rt.ApiClient.request('/api/auth/me');
    check(b.kind === K.RATE_LIMITED && !('retryAfter' in b), 'Retry-After: absent header -> no retryAfter');
    rt.net.responder = () => resp(429, errEnv('rate_limited'), { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' });
    const c = await rt.ApiClient.request('/api/auth/me');
    check(!('retryAfter' in c), 'Retry-After: a non-integer value is dropped');
    rt.net.responder = () => resp(503, errEnv('service_unavailable'), { 'retry-after': '5' });
    const e = await rt.ApiClient.request('/api/auth/me');
    check(!('retryAfter' in e), 'Retry-After: carried only for RATE_LIMITED');
  }

  /* ---------- 9. /me projection mapping and validation ---------- */
  {
    const rt = loadRuntime(); const map = rt.mapSessionProjection;
    const ceo = map(ME_CEO);
    check(!!ceo && ceo.principal.id === 'u_ceo_1' && ceo.principal.principalType === 'ceo' && ceo.principal.displayName === 'CEO'
      && !('employeeId' in ceo.principal), 'projection: CEO with null binding -> {id, displayName "CEO", principalType ceo}, no binding');
    check(ceo.csrfToken === CSRF_A && !('csrfToken' in ceo.principal) && !('membershipId' in ceo.principal),
      'projection: csrfToken and membershipId are not part of the principal');
    const ceoB = map(Object.assign({}, ME_CEO, { employeeId: 'emp_srv_7' }));
    check(!!ceoB && ceoB.principal.principalType === 'ceo' && ceoB.principal.employeeId === 'emp_srv_7', 'projection: CEO with a string binding keeps it');
    const emp = map({ userId: 'u_e', membershipId: 'm_e', role: 'employee', employeeId: 'emp_srv_1', csrfToken: CSRF_B });
    check(!!emp && emp.principal.principalType === 'employee' && emp.principal.employeeId === 'emp_srv_1' && emp.principal.displayName === 'Employee',
      'projection: Employee with a binding -> principal with that employeeId, label "Employee"');
    const reject = [
      ['Employee without binding', { userId: 'u', membershipId: 'm', role: 'employee', employeeId: null, csrfToken: CSRF_A }],
      ['Employee with empty binding', { userId: 'u', membershipId: 'm', role: 'employee', employeeId: '', csrfToken: CSRF_A }],
      ['unknown role', Object.assign({}, ME_CEO, { role: 'admin' })],
      ['role not lower-case', Object.assign({}, ME_CEO, { role: 'CEO' })],
      ['missing userId', { membershipId: 'm', role: 'ceo', employeeId: null, csrfToken: CSRF_A }],
      ['empty userId', Object.assign({}, ME_CEO, { userId: '' })],
      ['non-string userId', Object.assign({}, ME_CEO, { userId: 7 })],
      ['missing membershipId', { userId: 'u', role: 'ceo', employeeId: null, csrfToken: CSRF_A }],
      ['missing employeeId key', { userId: 'u', membershipId: 'm', role: 'ceo', csrfToken: CSRF_A }],
      ['malformed csrfToken', Object.assign({}, ME_CEO, { csrfToken: 'abc' })],
      ['missing csrfToken', { userId: 'u', membershipId: 'm', role: 'ceo', employeeId: null }],
      ['extra authority field companyId', Object.assign({}, ME_CEO, { companyId: 'c1' })],
      ['extra field permissions', Object.assign({}, ME_CEO, { permissions: ['all'] })],
      ['array', [ME_CEO]], ['null', null], ['string', 'ceo']
    ];
    for(const [label, data] of reject){ check(map(data) === null, 'projection refused: ' + label); }
  }

  /* ---------- 10. SessionIdentityProvider through the canonical seam ---------- */
  {
    const rt = loadRuntime(); const K = rt.API_RESULT_KINDS;
    rt.setIdentityProviderForTesting(rt.SessionIdentityProvider);
    check(rt.getCurrentUser() === null && rt.net.calls.length === 0, 'session: installed but not refreshed -> null, no request');
    rt.net.responder = () => resp(200, okEnv(ME_CEO));
    const r = await rt.SessionIdentityProvider.refresh();
    check(r.ok === true && r.requestId === RID, 'session: refresh succeeds on a valid /me');
    const call = rt.net.calls[0];
    check(rt.net.calls.length === 1 && call.url === '/api/auth/me' && call.init.method === 'GET' && call.init.body === undefined,
      'session: refresh issues exactly one GET /api/auth/me through ApiClient');
    const u = rt.getCurrentUser();
    check(!!u && u.id === 'u_ceo_1' && u.principalType === 'ceo' && !('csrfToken' in u), 'session: canonical getCurrentUser() returns the server principal (no csrfToken)');
    check(rt.CsrfHolder.get() === CSRF_A, 'session: /me csrfToken replaced the in-memory CSRF token');
    const ws = rt.getCurrentWorkspace();
    check(!!ws && ws.type === 'executive' && ws.scope === 'ALL_COMPANY', 'session: CEO -> Executive / ALL_COMPANY');
    const mutated = rt.getCurrentUser(); if(mutated) mutated.principalType = 'employee';
    check(!!mutated && fieldOf(rt.getCurrentUser(), 'principalType') === 'ceo', 'session: callers receive copies; the held principal cannot be mutated');
    rt.net.responder = () => resp(200, okEnv(Object.assign({}, ME_CEO, { employeeId: 'emp_srv_9', csrfToken: CSRF_B })));
    await rt.SessionIdentityProvider.refresh();
    const ub = rt.getCurrentUser(); const wsb = rt.getCurrentWorkspace();
    check(!!ub && ub.principalType === 'ceo' && ub.employeeId === 'emp_srv_9' && wsb && wsb.type === 'executive' && wsb.scope === 'ALL_COMPANY',
      'session: CEO with a server employee binding stays valid and Executive / ALL_COMPANY');
    check(rt.CsrfHolder.get() === CSRF_B, 'session: a later /me replaces the CSRF token');
    // an outage changes nothing
    rt.net.responder = () => new TypeError('Failed to fetch');
    const off = await rt.SessionIdentityProvider.refresh();
    check(off.ok === false && off.kind === K.UNAVAILABLE && fieldOf(rt.getCurrentUser(), 'id') === 'u_ceo_1' && rt.CsrfHolder.get() === CSRF_B,
      'session: UNAVAILABLE leaves identity and token unchanged (no fallback, no fabrication)');
    // 401 clears identity and token
    rt.net.responder = () => resp(401, errEnv('unauthenticated'));
    const out = await rt.SessionIdentityProvider.refresh();
    check(out.ok === false && out.kind === K.UNAUTHENTICATED && rt.getCurrentUser() === null && rt.CsrfHolder.get() === null,
      'session: 401 clears the principal and the CSRF token');
    // invalid projection clears and creates nothing
    rt.net.responder = () => resp(200, okEnv(ME_CEO));
    await rt.SessionIdentityProvider.refresh();
    rt.net.responder = () => resp(200, okEnv(Object.assign({}, ME_CEO, { role: 'superuser' })));
    const inv = await rt.SessionIdentityProvider.refresh();
    check(inv.ok === false && inv.kind === K.UNAVAILABLE && rt.getCurrentUser() === null && rt.CsrfHolder.get() === null,
      'session: an invalid projection creates no principal and clears the token');
    // clear()
    rt.net.responder = () => resp(200, okEnv(ME_CEO));
    await rt.SessionIdentityProvider.refresh();
    rt.SessionIdentityProvider.clear();
    check(rt.getCurrentUser() === null && rt.CsrfHolder.get() === null, 'session: clear() forgets principal and token');
    // concurrent refresh shares one request
    const n = rt.net.calls.length;
    const [p1, p2] = await Promise.all([rt.SessionIdentityProvider.refresh(), rt.SessionIdentityProvider.refresh()]);
    check(p1.ok && p2.ok && rt.net.calls.length === n + 1, 'session: concurrent refresh() calls share one /me request');
  }

  /* ---------- 11. Employee binding and no client authority ---------- */
  {
    const rt = loadRuntime(); const K = rt.API_RESULT_KINDS;
    rt.setIdentityProviderForTesting(rt.SessionIdentityProvider);
    // Client-controlled values that must never become authority.
    rt.State.employees = [{ id: 'local_uid_1', name: 'Fabricated Local' }];
    rt.State.settings.role = 'ceo';
    rt.memStore.role = 'ceo'; rt.memStore.employeeId = 'local_uid_1';
    rt.w.role = 'ceo'; rt.w.employeeId = 'local_uid_1';
    rt.net.responder = () => resp(200, okEnv({ userId: 'u_e1', membershipId: 'm_e1', role: 'employee', employeeId: 'emp_srv_1', csrfToken: CSRF_A }));
    await rt.SessionIdentityProvider.refresh();
    const u = rt.getCurrentUser();
    check(!!u && u.principalType === 'employee', 'authority: role comes from /me only (client State/storage/window "ceo" ignored)');
    check(!!u && u.employeeId === 'emp_srv_1', 'authority: employeeId comes from /me only (client values ignored)');
    check(rt.getCurrentWorkspace() === null, 'D2: the server binding is never auto-bound to a local employee uid (no workspace)');
    rt.net.responder = () => resp(200, okEnv({ userId: 'u_e2', membershipId: 'm_e2', role: 'employee', employeeId: null, csrfToken: CSRF_A }));
    const miss = await rt.SessionIdentityProvider.refresh();
    check(miss.ok === false && miss.kind === K.UNAVAILABLE && rt.getCurrentUser() === null, 'session: Employee without a binding -> no principal');
  }

  /* ---------- 12. no LocalIdentityProvider fallback; nothing persisted ---------- */
  {
    const rt = loadRuntime();
    rt.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');        // a local selection exists...
    rt.setIdentityProviderForTesting(rt.SessionIdentityProvider);         // ...but the session provider is active
    check(rt.getCurrentUser() === null, 'no fallback: unauthenticated session provider -> null despite a local CEO selection');
    for(const r of [resp(401, errEnv('unauthenticated')), resp(503, errEnv('service_unavailable')),
                    resp(200, okEnv({ bad: true })), new TypeError('offline')]){
      rt.net.responder = () => r;
      await rt.SessionIdentityProvider.refresh();
      check(rt.getCurrentUser() === null, 'no fallback: failed refresh never yields the local fixture or any principal');
    }
    rt.net.responder = () => resp(200, okEnv(ME_CEO));
    await rt.SessionIdentityProvider.refresh();
    const dump = JSON.stringify(rt.memStore) + JSON.stringify(rt.State);
    check(dump.indexOf(CSRF_A) === -1, 'persistence: the CSRF token is in no storage and not in State');
    check(dump.indexOf('u_ceo_1') === -1, 'persistence: the session principal is in no storage and not in State');
  }

  /* ---------- summary ---------- */
  console.log('');
  if(failures.length){
    console.log('AFI-1 SESSION IDENTITY RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('AFI-1 SESSION IDENTITY RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})().catch(function(e){ console.log('AFI-1 SESSION IDENTITY RUNTIME VERIFICATION FAILED -- harness error: ' + (e && e.message)); process.exit(1); });
