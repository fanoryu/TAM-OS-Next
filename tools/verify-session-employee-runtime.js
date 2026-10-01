#!/usr/bin/env node
'use strict';
/* ============================================================
   AFI-4a1 / AFI-4a2 — SESSION EMPLOYEE WORKSPACE RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of AFI-4a1 / AFI-4a2. This harness proves
   its BEHAVIOUR by executing every production module (module-order.js, the boot
   included) in the dependency-free Node `vm` loader of the AFI-2 harness, with the
   ONE source line `const AUTH_MODE = AUTH_MODES.LOCAL;` rewritten to SESSION in the
   concatenated text — the committed value is untouched.

   fetch is a deterministic stub answering by URL (path + query) from a script; the
   API timeout timer is captured and fired on demand. localStorage / sessionStorage
   are instrumented, and the LOCAL boot, the shell, "Acting as", local data tools,
   Global Search, the legacy Employee handlers and the other domains' renderers are
   replaced by recording spies that must never be called. Every identity, token and
   record here is fabricated.

   AFI-4a2 (sections K–T): the CEO's create / update / archive writes. #app is a small
   recording element: querySelector('#id') finds an element only when the rendered
   HTML carries that id (its value read from that HTML), its listeners can be fired,
   and focus() is recorded — so bindings, disabled controls and focus moves are
   exercised, not assumed. Every write request (method, path, body, CSRF header) is
   recorded and asserted exactly.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

const root = path.resolve(__dirname, '..');
const CSRF = 'A'.repeat(21) + '_' + 'b'.repeat(21);
const RID = '0123456789abcdef0123456789abcdef';
const ME_CEO = { userId: 'u_ceo_1', membershipId: 'm_ceo_1', role: 'ceo', employeeId: null, csrfToken: CSRF };
const ME_EMP = { userId: 'u_emp_1', membershipId: 'm_emp_1', role: 'employee', employeeId: 'emp_srv_1', csrfToken: CSRF };
// Functions SESSION must never reach. Each is a `function` declaration, replaced by a spy.
const NEVER = ['loadState', 'saveState', 'applyTheme', 'installGlobalUIHandlers', 'maybeShowFirstRunChoice', 'startFresh',
  'renderShell', 'renderView', 'renderIdentitySelectorHTML', 'restoreCompleteBackup', 'renderSmartImport', 'openGlobalSearch',
  'openEmployeeModal', 'setEmployeeActive', 'deleteEmployee', 'renderEmployees', 'renderEmployeeDetail', 'persistEmployees',
  'renderOvertime', 'renderOvertimeWorksheet', 'renderPayrollWorkspace', 'renderPayrollDetail', 'renderDashboard',
  'renderExecutiveDashboard', 'renderTransactions', 'renderExecutionCenter'];

/* ---------- fabricated records ---------- */
const E1 = { id: 'e_1', employeeCode: 'EMP-001', fullName: 'Fabricated Alpha', jobTitle: 'Engineer', department: null, employmentStatus: 'Active', archived: false, accountState: 'active' };
const E2 = { id: 'e_2', employeeCode: 'EMP-002', fullName: 'Fabricated Beta', jobTitle: null, department: 'Operations', employmentStatus: 'On Leave', archived: false, accountState: 'none' };
const E3 = { id: 'e_3', employeeCode: 'EMP-003', fullName: 'Fabricated Gamma', jobTitle: 'Analyst', department: 'Operations', employmentStatus: 'Resigned', archived: true, accountState: 'disabled' };
const D1 = Object.assign({}, E1, { joinDate: '2026-01-05', contactEmail: 'alpha@example.test', phone: '0812 000', notes: 'fabricated note <b>x</b>', monthlyBaseSalary: '7500000.00', version: 3 });
const SELF = { id: 'emp_srv_1', employeeCode: 'EMP-777', fullName: 'Fabricated Self', jobTitle: 'Analyst', department: 'Operations', employmentStatus: 'Active',
  joinDate: null, contactEmail: null, phone: null, monthlyBaseSalary: '1234567890123.45' };
const LIST_ACTIVE = { employees: [E1, E2] };
const LIST_ARCHIVED = { employees: [E1, E2, E3] };
// AFI-4a2 fabricated write fixtures.
const CSRF2 = 'C'.repeat(21) + '_' + 'd'.repeat(21);
const LIST_KEYS = ['id', 'employeeCode', 'fullName', 'jobTitle', 'department', 'employmentStatus', 'archived', 'accountState'];
const pick = (o, keys) => { const out = {}; keys.forEach((k) => { out[k] = o[k]; }); return out; };
const D1V = (version, extra) => Object.assign({}, D1, { version: version }, extra || {});
const D3 = Object.assign({}, E3, { joinDate: null, contactEmail: null, phone: null, notes: null, monthlyBaseSalary: '6000000.00', version: 4 });
const NEW_D = { id: 'e_new', employeeCode: 'EMP-010', fullName: 'Fabricated Delta', jobTitle: null, department: 'Operations', employmentStatus: 'Active', archived: false,
  accountState: 'none', joinDate: '2026-03-01', contactEmail: 'delta@example.test', phone: null, notes: null, monthlyBaseSalary: '9000000.50', version: 1 };
const NEW_ITEM = pick(NEW_D, LIST_KEYS);
const CREATE_INPUT = { employeeCode: ' EMP-010 ', fullName: 'Fabricated Delta', employmentStatus: 'Active', jobTitle: '', department: 'Operations',
  joinDate: '2026-03-01', contactEmail: 'delta@example.test', phone: '', notes: '', monthlyBaseSalary: '9000000.50' };
const WRITABLE_SORTED = 'contactEmail,department,employeeCode,employmentStatus,fullName,jobTitle,joinDate,monthlyBaseSalary,notes,phone';

/* ---------- scripted responses ---------- */
function resp(status, body, headers){
  const h = Object.assign({ 'content-type': 'application/json; charset=utf-8' }, headers || {});
  const lower = {}; Object.keys(h).forEach(function(k){ lower[k.toLowerCase()] = h[k]; });
  return { status: status,
    headers: { get: function(n){ const v = lower[String(n).toLowerCase()]; return v === undefined ? null : v; } },
    text: async function(){ return typeof body === 'string' ? body : JSON.stringify(body); } };
}
const ok = (data) => resp(200, { ok: true, data: data, requestId: RID });
const err = (status, code, headers) => resp(status, { ok: false, error: { code: code, message: 'server text' }, requestId: RID }, headers);
const errF = (fields) => resp(400, { ok: false, error: { code: 'validation_failed', message: 'server text', fields: fields }, requestId: RID });
const NETFAIL = () => new TypeError('Failed to fetch');
function deferred(){ let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise: promise, resolve: resolve }; }

/* ---------- AFI-4a2: a recording #app ---------- */
const unescapeHtml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function mkApp(mkEl, dom){
  let html = '';
  let elements = {};
  const tagOf = (id) => { const m = new RegExp('<([a-z]+)[^>]*\\sid="' + id + '"[^>]*>').exec(html); return m ? m : null; };
  // The value the rendered control would hold: input value, textarea text, selected option.
  function valueOf(id, tag){
    if(tag[1] === 'input'){ const v = /\svalue="([^"]*)"/.exec(tag[0]); return v ? unescapeHtml(v[1]) : ''; }
    const rest = html.slice(tag.index + tag[0].length);
    if(tag[1] === 'textarea') return unescapeHtml(rest.slice(0, rest.indexOf('</textarea>')));
    if(tag[1] === 'select'){ const v = /<option value="([^"]*)" selected>/.exec(rest.slice(0, rest.indexOf('</select>'))); return v ? unescapeHtml(v[1]) : ''; }
    return '';
  }
  function find(sel){
    const m = /^#([A-Za-z0-9_-]+)$/.exec(sel);
    if(!m) return null;
    const id = m[1];
    const tag = tagOf(id);
    if(!tag) return null;
    if(!elements[id]){
      const listeners = {};
      elements[id] = { id: id, name: (/\sname="([^"]*)"/.exec(tag[0]) || [])[1] || '', value: valueOf(id, tag), listeners: listeners,
        disabled: /\sdisabled(\s|>|=)/.test(tag[0]),
        addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
        focus: () => { dom.focused.push(id); if(dom.doc) dom.doc.activeElement = elements[id]; }, setSelectionRange: () => {}, querySelector: find, getAttribute: () => null };
    }
    return elements[id];
  }
  const app = mkEl();
  app.querySelector = find;
  app.querySelectorAll = () => [];
  app.contains = () => true;
  Object.defineProperty(app, 'innerHTML', { get: () => html, set: (v) => { html = String(v); elements = {}; } });
  app.el = (id) => find('#' + id);
  // A user event on a rendered control; a disabled control receives none.
  app.fire = (id, type) => {
    const el = find('#' + id);
    if(!el) return 'absent';
    if(el.disabled) return 'disabled';
    (el.listeners[type] || []).forEach((fn) => fn.call(el, { preventDefault: () => {} }));
    return 'fired';
  };
  app.type = (name, value) => { const el = find('#swf-' + name); if(!el || el.disabled) return false; el.value = value; (el.listeners.input || []).forEach((fn) => fn.call(el, {})); return true; };
  return app;
}

/* ---------- runtime loader ---------- */
function loadRuntime(routes){
  const jsFiles = require(path.join(root, 'tools', 'module-order.js'));
  const parts = jsFiles.map((f) => {
    let src = fs.readFileSync(path.join(root, 'js', f), 'utf8');
    if(f === 'core/constants.js'){
      const assigns = src.match(/const AUTH_MODE = [^;\n]+;/g) || [];
      if(assigns.length !== 1) throw new Error('expected exactly one AUTH_MODE assignment');
      src = src.replace(assigns[0], 'const AUTH_MODE = AUTH_MODES.SESSION;');
    }
    if(f === 'core/app-bootstrap.js'){
      src = NEVER.map((n) => 'try { ' + n + ' = (function(){ return function(){ __spy.push("' + n + '"); return ""; }; })(); } catch(_e){ __spyErr.push("' + n + '"); }').join('\n') + '\n' + src;
    }
    return src;
  });
  const src = parts.join('\n')
    + '\n;window.__TAM__ = { State: State, AuthBoot: AuthBoot, AUTH_STATES: AUTH_STATES, CsrfHolder: CsrfHolder,'
    + ' SessionIdentityProvider: SessionIdentityProvider, ApiClient: ApiClient, API_RESULT_KINDS: API_RESULT_KINDS,'
    + ' EmployeeApi: EmployeeApi, EmployeeDecoders: EmployeeDecoders, SessionEmployeeStore: SessionEmployeeStore,'
    + ' SessionWorkspace: SessionWorkspace, PRINCIPAL_TYPES: PRINCIPAL_TYPES,'
    + ' EmployeeRequests: EmployeeRequests, EMPLOYEE_WRITABLE_FIELDS: EMPLOYEE_WRITABLE_FIELDS,'
    // A value built in the PAGE realm, as JSON.parse in ApiClient builds every answer.
    + ' parse: function(json){ return JSON.parse(json); } };';
  const noop = function(){};
  const access = { local: [], session: [] };
  const storageOf = (log) => {
    const mem = {};
    return {
      getItem: (k) => { log.push('get:' + k); return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: (k, v) => { log.push('set:' + k); mem[k] = String(v); },
      removeItem: (k) => { log.push('remove:' + k); delete mem[k]; },
      key: () => null, get length(){ return 0; }, clear: () => { log.push('clear'); }
    };
  };
  const mkEl = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'', value:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, removeChild:noop, setAttribute:noop,
    getAttribute:()=>null, remove:noop, focus:noop, contains:()=>false, querySelector:()=>null, querySelectorAll:()=>[],
    classList:{ add:noop, remove:noop, toggle:noop, contains:()=>false } });
  const els = {};
  const dom = { focused: [] };
  els.app = mkApp(mkEl, dom);
  const net = { calls: [], routes: routes || {}, timers: [] };
  const fetchStub = function(url, init){
    net.calls.push({ url: url, init: init });
    return new Promise(function(resolve, reject){
      if(init && init.signal) init.signal.addEventListener('abort', function(){ const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
      const q = net.routes[url] || [];
      const next = q.length > 1 ? q.shift() : q[0];
      Promise.resolve().then(function(){
        if(!next) return reject(new TypeError('no route'));
        if(next === 'HANG') return;                               // never answers: only the timeout ends it
        const out = typeof next === 'function' ? next(init) : next;
        if(out instanceof Error) reject(out); else resolve(out);
      });
    });
  };
  const sandbox = {
    __spy: [], __spyErr: [],
    console: { log:noop, warn:noop, error:noop, info:noop }, navigator: { userAgent:'tam-afi4a1' },
    setTimeout: function(fn, ms){ if(ms === 10000){ net.timers.push(fn); return 'api-timer-' + net.timers.length; } return setTimeout(fn, ms); },
    clearTimeout: function(id){ if(!/^api-timer-/.test(String(id))) clearTimeout(id); },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    AbortController: AbortController, fetch: fetchStub,
    localStorage: storageOf(access.local), sessionStorage: storageOf(access.session), storage: undefined,
    addEventListener: noop, removeEventListener: noop, confirm: ()=>true,
    matchMedia: ()=>({ matches:false, addEventListener:noop, addListener:noop }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: { addEventListener:noop, removeEventListener:noop,
      getElementById: (id) => (els[id] = els[id] || mkEl()),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>mkEl(), contains:()=>false,
      body: mkEl(), documentElement: { dataset:{}, style:{} }, activeElement: null }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  dom.doc = sandbox.document;            // focus() moves document.activeElement, as a browser does
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-afi4a1-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.net = net; rt.access = access; rt.spy = sandbox.__spy; rt.spyErr = sandbox.__spyErr;
  rt.appHTML = () => (els.app ? els.app.innerHTML : '');
  rt.app = els.app; rt.dom = dom;
  rt.store = () => rt.SessionEmployeeStore.snapshot();
  rt.state = () => rt.AuthBoot.snapshot().state;
  return rt;
}
const flush = async (n) => { for(let i = 0; i < (n || 8); i++) await new Promise((r) => setImmediate(r)); };
const urls = (rt) => rt.net.calls.map((c) => c.url);
const apiUrls = (rt) => urls(rt).filter((u) => u !== '/api/auth/me');
async function boot(me, routes){
  const rt = loadRuntime(Object.assign({ '/api/auth/me': [ok(me)] }, routes || {}));
  await flush();
  return rt;
}

// The SESSION firewall, after every phase: no storage, no LOCAL boot, no shell, no "Acting as",
// no local data tool, no other domain, no legacy State data.
function firewall(rt, label){
  check(rt.access.local.length === 0 && rt.access.session.length === 0,
    label + ': zero localStorage / sessionStorage access' + (rt.access.local.length + rt.access.session.length ? ' >> ' + rt.access.local.concat(rt.access.session).join(', ') : ''));
  check(rt.spy.length === 0, label + ': no LOCAL boot, shell, "Acting as", local data tool, Global Search, legacy Employee handler or other domain was called' + (rt.spy.length ? ' >> ' + rt.spy.join(', ') : ''));
  const html = rt.appHTML();
  check(!/identity-selector|identityPrincipalSelect|Acting as|class="sidebar"|data-nav=|Overtime|Payroll|Finance|Smart Import|Backup|Restore|Start fresh/i.test(html),
    label + ': the DOM carries no "Acting as", navigation, Overtime / Payroll / Finance entry or local data tool');
  check(rt.State.employees.length === 0 && rt.State.storageReady === false && rt.AuthBoot.allowsWorkspace() === false,
    label + ': legacy State stays empty and the business shell is never granted');
  // AFI-4a2: no account administration, as a request or as a control.
  check(!rt.net.calls.some((c) => /provision|reissue|disable-account|enable-account/i.test(c.url)) && !/Provision|Reissue|Disable login|Enable login|accountManageable/i.test(html),
    label + ': no account administration (no account route requested, no account control rendered)');
}

/* ---------- AFI-4a2 helpers ---------- */
const writes = (rt) => rt.net.calls.filter((c) => c.init && c.init.method === 'POST' && /^\/api\/employees\//.test(c.url));
const bodyOf = (c) => JSON.parse(c.init.body);
const countOf = (rt, url) => rt.net.calls.filter((c) => c.url === url).length;
const lastFocus = (rt) => rt.dom.focused[rt.dom.focused.length - 1];
function fieldsLabelled(html){
  const ids = (html.match(/<(input|select|textarea)[^>]*\sid="swf-[A-Za-z]+"/g) || []).map((m) => /id="(swf-[A-Za-z]+)"/.exec(m)[1]);
  return ids.length === 10 && ids.every((id) => (html.match(new RegExp('<label for="' + id + '">', 'g')) || []).length === 1);
}
function fill(rt, values){ Object.keys(values).forEach((k) => rt.SessionWorkspace.setDraft(k, values[k])); }
// A CEO on the list with the create form open and the draft filled.
async function createWith(createRoutes, extra){
  const rt = await boot(ME_CEO, Object.assign({ '/api/employees': [ok(LIST_ACTIVE)], '/api/employees/create': createRoutes }, extra || {}));
  rt.SessionWorkspace.openCreate(); await flush();
  fill(rt, CREATE_INPUT);
  return rt;
}
// A CEO on the detail of e_1 (version 3).
async function ceoDetail(extra){
  const rt = await boot(ME_CEO, Object.assign({ '/api/employees': [ok(LIST_ACTIVE)], '/api/employee?id=e_1': [ok({ employee: D1 })] }, extra || {}));
  await rt.SessionWorkspace.openDetail('e_1'); await flush();
  return rt;
}
// The same, with the edit form open and fullName changed.
async function editWith(updateRoutes, extra){
  const rt = await ceoDetail(Object.assign({ '/api/employees/update': updateRoutes }, extra || {}));
  rt.SessionWorkspace.openEdit(); await flush();
  rt.SessionWorkspace.setDraft('fullName', 'Fabricated Alpha Prime');
  return rt;
}
async function archiveWith(archiveRoutes, extra){
  const rt = await ceoDetail(Object.assign({ '/api/employees/archive': archiveRoutes }, extra || {}));
  rt.SessionWorkspace.openArchive(); await flush();
  return rt;
}

(async function main(){
  console.log('== AFI-4a1 / AFI-4a2 SESSION EMPLOYEE WORKSPACE — RUNTIME VERIFICATION ==');

  /* ---------- 0. the harness itself ---------- */
  {
    const rt = loadRuntime({});
    check(rt.spyErr.length === 0, '0. every forbidden function is a replaceable declaration and is spied' + (rt.spyErr.length ? ' >> ' + rt.spyErr.join(', ') : ''));
    check(/const AUTH_MODE = AUTH_MODES\.LOCAL;/.test(fs.readFileSync(path.join(root, 'js', 'core', 'constants.js'), 'utf8')),
      '0. the committed AUTH_MODE is LOCAL (SESSION exists only inside this harness)');
  }

  /* ---------- A. structured query (ApiClient) ---------- */
  {
    const rt = loadRuntime({ '/api/employee?id=e_1': [ok({})], '/api/employees?archived=1': [ok({})], '/api/employees': [ok({})],
      '/api/employee?archived=1&id=e_1': [ok({})] });
    // Options are built in the page realm, as a production caller builds them.
    const req = (p, o) => rt.ApiClient.request(p, o.query !== undefined && o.query !== null && typeof o.query === 'object' && !Array.isArray(o.query)
      ? Object.assign(rt.parse('{}'), o, { query: rt.parse(JSON.stringify(o.query)) }, o.body ? { body: rt.parse(JSON.stringify(o.body)) } : {}) : o);
    await req('/api/employee', { method: 'GET', query: { id: 'e_1' } });
    await req('/api/employees', { method: 'GET', query: { archived: '1' } });
    await req('/api/employee', { method: 'GET', query: { id: 'e_1', archived: '1' } });
    await req('/api/employees', { method: 'GET', query: {} });
    check(apiUrls(rt).join() === '/api/employee?id=e_1,/api/employees?archived=1,/api/employee?archived=1&id=e_1,/api/employees',
      'A. queries serialize as ?key=value, keys sorted; an empty query adds no "?"');
    const before = rt.net.calls.length;
    const refusals = [
      ['/api/employee', { method: 'GET', query: { name: 'x' } }, 'unknown key'],
      ['/api/employee', { method: 'GET', query: { id: 7 } }, 'non-string value'],
      ['/api/employee', { method: 'GET', query: { id: '' } }, 'empty value'],
      ['/api/employee', { method: 'GET', query: { id: 'a b' } }, 'space'],
      ['/api/employee', { method: 'GET', query: { id: 'a&b=c' } }, '& and ='],
      ['/api/employee', { method: 'GET', query: { id: 'a?b' } }, '?'],
      ['/api/employee', { method: 'GET', query: { id: 'a#b' } }, '#'],
      ['/api/employee', { method: 'GET', query: { id: 'a/b' } }, '/'],
      ['/api/employee', { method: 'GET', query: { id: '%2e%2e' } }, '%'],
      ['/api/employee', { method: 'GET', query: { id: 'x'.repeat(65) } }, 'longer than 64'],
      ['/api/employee', { method: 'GET', query: ['id'] }, 'array'],
      ['/api/employee', { method: 'GET', query: 'id=e_1' }, 'string'],
      ['/api/employee', { method: 'GET', query: null }, 'null'],
      ['/api/employees', { method: 'POST', body: {}, query: { id: 'e_1' } }, 'query on POST'],
      ['/api/employee?id=e_1', { method: 'GET' }, 'raw query in the path'],
      ['/api/employee#x', { method: 'GET' }, 'fragment in the path']
    ];
    for(const [p, o, label] of refusals){
      const res = await req(p, o);
      check(!res.ok && res.kind === 'CLIENT_FAULT', 'A. refused locally (CLIENT_FAULT): ' + label);
    }
    check(rt.net.calls.length === before, 'A. no refused query ever reaches the network');
    const control = await rt.ApiClient.request('/api/employees', { method: 'POST', body: rt.parse('{}') });
    check(control.kind !== 'CLIENT_FAULT' && rt.net.calls.length === before + 1, 'A. (control) the same POST without a query is sent — the query alone caused the refusal');
  }

  /* ---------- B. strict decoders ---------- */
  {
    const rt = loadRuntime({});
    const Raw = rt.EmployeeDecoders;
    const P = (x) => (x === null ? null : rt.parse(JSON.stringify(x)));
    const D = { listResponse: (x) => Raw.listResponse(P(x)), detailResponse: (x) => Raw.detailResponse(P(x)), selfResponse: (x) => Raw.selfResponse(P(x)),
      listItem: (x) => Raw.listItem(P(x)), detail: (x) => Raw.detail(P(x)) };
    check(Raw.listResponse({ employees: [E1] }) === null, 'B. an object from another realm (not a JSON answer) is not a plain record');
    const listed = D.listResponse({ employees: [E1, E2] });
    check(!!listed && listed.length === 2 && Object.isFrozen(listed) && Object.isFrozen(listed[0]) && listed[0].fullName === 'Fabricated Alpha', 'B. a canonical list decodes (frozen)');
    check(D.listResponse({ employees: [] }).length === 0, 'B. an empty list decodes');
    const d = D.detailResponse({ employee: D1 });
    check(!!d && d.monthlyBaseSalary === '7500000.00' && typeof d.monthlyBaseSalary === 'string' && d.version === 3, 'B. a canonical detail decodes; salary stays the exact string');
    check(!!D.selfResponse({ employee: SELF }) && D.selfResponse({ employee: SELF }).monthlyBaseSalary === '1234567890123.45', 'B. a canonical self record decodes; a 13-digit salary is exact');
    check(!!D.listItem(Object.assign({}, E1, { id: 'LEGACY_anchor-1' })), 'B. a non-hex server id (legacy anchor shape) is accepted — ids follow the server ID_PATTERN');
    const bad = (label, v) => check(v === null, 'B. rejected: ' + label);
    bad('list wrapper with an extra key', D.listResponse({ employees: [E1], total: 1 }));
    bad('list wrapper that is not an array', D.listResponse({ employees: E1 }));
    bad('list wrapper missing', D.listResponse([E1]));
    bad('list item with an extra key', D.listResponse({ employees: [Object.assign({}, E1, { salary: '1.00' })] }));
    bad('list item missing a key', D.listResponse({ employees: [Object.assign({}, E1, { accountState: undefined })] }));
    bad('one bad item rejects the whole list', D.listResponse({ employees: [E1, Object.assign({}, E2, { archived: 'no' })] }));
    bad('unknown employmentStatus', D.listItem(Object.assign({}, E1, { employmentStatus: 'Fired' })));
    bad('unknown accountState', D.listItem(Object.assign({}, E1, { accountState: 'locked' })));
    bad('id with a space', D.listItem(Object.assign({}, E1, { id: 'e 1' })));
    bad('id longer than 64', D.listItem(Object.assign({}, E1, { id: 'x'.repeat(65) })));
    bad('empty employeeCode', D.listItem(Object.assign({}, E1, { employeeCode: '' })));
    bad('employeeCode over 32 code points', D.listItem(Object.assign({}, E1, { employeeCode: 'X'.repeat(33) })));
    bad('fullName over 160 code points', D.listItem(Object.assign({}, E1, { fullName: 'é'.repeat(161) })));
    bad('empty jobTitle (the server sends null)', D.listItem(Object.assign({}, E1, { jobTitle: '' })));
    bad('salary as a number', D.detail(Object.assign({}, D1, { monthlyBaseSalary: 7500000 })));
    bad('salary with one decimal', D.detail(Object.assign({}, D1, { monthlyBaseSalary: '7500000.5' })));
    bad('impossible join date', D.detail(Object.assign({}, D1, { joinDate: '2026-02-30' })));
    bad('join date with a time', D.detail(Object.assign({}, D1, { joinDate: '2026-01-05T00:00:00Z' })));
    bad('contact email without @', D.detail(Object.assign({}, D1, { contactEmail: 'nobody' })));
    bad('phone with letters', D.detail(Object.assign({}, D1, { phone: 'call me' })));
    bad('version 0', D.detail(Object.assign({}, D1, { version: 0 })));
    bad('version as a string', D.detail(Object.assign({}, D1, { version: '3' })));
    bad('detail missing version', D.detailResponse({ employee: Object.assign({}, D1, { version: undefined }) }));
    bad('detail wrapper with an extra key', D.detailResponse({ employee: D1, extra: true }));
    bad('self carrying notes', D.selfResponse({ employee: Object.assign({}, SELF, { notes: null }) }));
    bad('self carrying accountState', D.selfResponse({ employee: Object.assign({}, SELF, { accountState: 'active' }) }));
    bad('self carrying archived and version (a CEO detail)', D.selfResponse({ employee: D1 }));
    bad('a record that is not a plain object', D.listItem(null));
  }

  /* ---------- C. CEO: boot, active list, archived, detail ---------- */
  {
    const rt = await boot(ME_CEO, { '/api/employees': [ok(LIST_ACTIVE)], '/api/employees?archived=1': [ok(LIST_ARCHIVED)], '/api/employee?id=e_1': [ok({ employee: D1 })] });
    check(rt.state() === 'AUTHENTICATED' && urls(rt).join() === '/api/auth/me,/api/employees', 'C. CEO boot: /me, then exactly one active-list read');
    const s = rt.store();
    check(s.listStatus === 'ready' && s.list.length === 2 && s.listArchived === false, 'C. the active list is in the SESSION store');
    const html = rt.appHTML();
    check(/>Employees<\/h1>/.test(html) && /Signed in as <strong>CEO<\/strong>/.test(html) && /authSignOutBtn/.test(html), 'C. the CEO workspace: heading, role label, Sign out');
    check(/Fabricated Alpha/.test(html) && /EMP-002/.test(html) && /Login active/.test(html) && /No login/.test(html) && /On Leave/.test(html), 'C. list rows show code, name, employment and account state as text');
    check(!/e_1|e_2/.test(html), 'C. the opaque record ids never appear in the page');
    // AFI-4a2 authorized revision: the CEO list now carries exactly one write control,
    // "Add employee" (no form until it is pressed). Was: no create control at all.
    check(/>Add employee</.test(html) && !/<form|<input|<select|<textarea|>Edit|>Archive<|>Create|Provision|Reissue|>Disable|>Enable/.test(html),
      'C. the CEO list carries "Add employee" only: no form, edit, archive or account control');
    firewall(rt, 'C. CEO list');
    await rt.SessionWorkspace.showArchived(true); await flush();
    check(urls(rt).slice(-1)[0] === '/api/employees?archived=1' && rt.store().listArchived === true && rt.store().list.length === 3, 'C. the archived tab reads ?archived=1 and lists archived records');
    check(/pill-status-archived/.test(rt.appHTML()) && /Login disabled/.test(rt.appHTML()), 'C. archived rows are marked');
    firewall(rt, 'C. archived toggle');
    const n = rt.net.calls.length;
    await rt.SessionWorkspace.showArchived(true); await flush();
    check(rt.net.calls.length === n, 'C. selecting the tab already shown sends nothing');
    await rt.SessionWorkspace.openDetail('e_1'); await flush();
    const ds = rt.store();
    check(urls(rt).slice(-1)[0] === '/api/employee?id=e_1' && ds.detailStatus === 'ready' && ds.detail.version === 3, 'C. opening a record reads GET /api/employee?id=e_1');
    const dh = rt.appHTML();
    check(/>Employee record<\/h1>/.test(dh) && /7500000\.00/.test(dh) && /alpha@example\.test/.test(dh) && /Login active/.test(dh) && /Back to list/.test(dh),
      'C. the detail shows the profile, the exact salary string and the account state');
    check(/fabricated note &lt;b&gt;x&lt;\/b&gt;/.test(dh) && !/<b>x<\/b>/.test(dh), 'C. server text is escaped');
    check(!/>3<|version/i.test(dh.replace(/Login active/g, '')), 'C. the version stays internal metadata');
    firewall(rt, 'C. CEO detail');
    rt.SessionWorkspace.back(); await flush();
    check(rt.store().detailId === null && /Fabricated Gamma/.test(rt.appHTML()), 'C. Back returns to the list');
    check(rt.store().list === s.list || rt.store().list.length === 3, 'C. the list is still the server answer');
  }

  /* ---------- D. CEO empty list ---------- */
  {
    const rt = await boot(ME_CEO, { '/api/employees': [ok({ employees: [] })] });
    check(rt.store().listStatus === 'ready' && rt.store().list.length === 0 && /class="empty"/.test(rt.appHTML()), 'D. an empty list renders the empty state');
    firewall(rt, 'D. empty list');
  }

  /* ---------- E. Employee: own profile ---------- */
  {
    const rt = await boot(ME_EMP, { '/api/employee?id=emp_srv_1': [ok({ employee: SELF })] });
    check(rt.state() === 'AUTHENTICATED' && urls(rt).join() === '/api/auth/me,/api/employee?id=emp_srv_1',
      'E. Employee boot reads only their own record, by the OPAQUE principal.employeeId');
    check(urls(rt).filter((u) => /^\/api\/employees/.test(u)).length === 0 && !/EMP-777/.test(urls(rt).join()), 'E. no list request; never the employee code');
    const s = rt.store();
    check(s.selfStatus === 'ready' && s.self.employeeCode === 'EMP-777' && s.list === null, 'E. the self profile is in the store; no list');
    const html = rt.appHTML();
    check(/>My profile<\/h1>/.test(html) && /Signed in as <strong>Employee<\/strong>/.test(html) && /Fabricated Self/.test(html) && /1234567890123\.45/.test(html),
      'E. the own profile renders, salary exact');
    check(!/Login|accountState|Notes|Archived|role="tablist"|>View</.test(html) && !/emp_srv_1/.test(html), 'E. no account state, notes, archive, tabs, list or opaque id');
    check(!/<form|<input|>Edit|>Archive|Provision|Reissue|>Disable|>Enable/.test(html), 'E. no administrative or edit control');
    firewall(rt, 'E. Employee self');
    const bogus = await rt.EmployeeApi.getSelf({ id: 'u', principalType: 'employee', employeeId: 'EMP-777 ' });
    check(!bogus.ok && bogus.kind === 'INVALID_RESPONSE', 'E. getSelf refuses a non-id value before any request');
  }
  {
    const rt = await boot(ME_EMP, { '/api/employee?id=emp_srv_1': [ok({ employee: Object.assign({}, SELF, { id: 'emp_other' }) })] });
    check(rt.store().selfStatus === 'error' && rt.store().error.kind === 'INVALID_RESPONSE' && rt.store().self === null && !/Fabricated Self/.test(rt.appHTML()),
      'E. a self answer for another id is refused and not shown');
  }

  /* ---------- F. errors (identity stays authenticated) ---------- */
  {
    const rt = await boot(ME_CEO, { '/api/employees': [err(403, 'forbidden')] });
    check(rt.state() === 'AUTHENTICATED' && rt.store().error.kind === 'DENIED' && /do not have access/.test(rt.appHTML()) && !/swRetryBtn/.test(rt.appHTML()),
      'F. 403 -> denied view; still signed in (never session loss); no Retry');
    check(rt.SessionIdentityProvider.getCurrentUser() !== null && rt.CsrfHolder.get() === CSRF, 'F. 403 keeps the identity and the CSRF token');
    firewall(rt, 'F. 403');
  }
  {
    const rt = await boot(ME_CEO, { '/api/employees': [ok(LIST_ACTIVE)], '/api/employee?id=e_9': [err(404, 'not_found')] });
    await rt.SessionWorkspace.openDetail('e_9'); await flush();
    check(rt.state() === 'AUTHENTICATED' && rt.store().error.kind === 'NOT_FOUND' && /record was not found/.test(rt.appHTML()) && /Back to list/.test(rt.appHTML()) && !/swRetryBtn/.test(rt.appHTML()),
      'F. CEO detail 404 -> not found, with the way back to the list');
  }
  {
    const rt = await boot(ME_EMP, { '/api/employee?id=emp_srv_1': [err(404, 'not_found'), ok({ employee: SELF })] });
    check(rt.state() === 'AUTHENTICATED' && rt.store().error.kind === 'NOT_FOUND' && /profile is not available/.test(rt.appHTML()) && /swRetryBtn/.test(rt.appHTML()),
      'F. Employee self 404 -> profile unavailable with Retry; still signed in');
    await rt.SessionWorkspace.retry(); await flush();
    check(rt.store().selfStatus === 'ready' && /Fabricated Self/.test(rt.appHTML()), 'F. Retry reads the profile again');
    firewall(rt, 'F. self 404 + retry');
  }
  {
    const rt = await boot(ME_CEO, { '/api/employees': [err(500, 'internal_error'), ok(LIST_ACTIVE)] });
    check(rt.state() === 'AUTHENTICATED' && rt.store().error.kind === 'SERVER_ERROR' && /could not be loaded/.test(rt.appHTML()) && /swRetryBtn/.test(rt.appHTML()) && /Reference: 0123/.test(rt.appHTML()),
      'F. 500 -> unavailable with Retry and the server reference; still signed in');
    const n = rt.net.calls.length;
    await flush(20);
    check(rt.net.calls.length === n, 'F. nothing is retried automatically');
    await rt.SessionWorkspace.retry(); await flush();
    check(rt.store().listStatus === 'ready' && rt.store().list.length === 2, 'F. explicit Retry reloads the list');
    firewall(rt, 'F. 500 + retry');
  }
  {
    const rt = await boot(ME_CEO, { '/api/employees': [NETFAIL] });
    check(rt.state() === 'AUTHENTICATED' && rt.store().error.kind === 'UNAVAILABLE' && /Check your connection/.test(rt.appHTML()), 'F. network failure -> unavailable; still signed in');
  }
  {
    const rt = await boot(ME_CEO, { '/api/employees': ['HANG'] });
    check(rt.store().listStatus === 'loading' && /Loading employees/.test(rt.appHTML()), 'F. a slow read shows the loading state');
    rt.net.timers[rt.net.timers.length - 1]();      // the ApiClient timeout fires
    await flush();
    check(rt.state() === 'AUTHENTICATED' && rt.store().error.kind === 'UNAVAILABLE', 'F. timeout -> unavailable; still signed in');
  }
  {
    const rt = await boot(ME_CEO, { '/api/employees': [err(429, 'rate_limited', { 'Retry-After': '30' })] });
    check(rt.state() === 'AUTHENTICATED' && rt.store().error.kind === 'RATE_LIMITED' && /Too many requests\. Try again in 30 seconds\./.test(rt.appHTML()), 'F. 429 -> rate-limit message with the wait; still signed in');
  }
  {
    const rt = await boot(ME_CEO, { '/api/employees': [err(409, 'conflict')] });
    check(rt.state() === 'AUTHENTICATED' && rt.store().error.kind === 'CONFLICT', 'F. 409 -> business error; still signed in');
  }
  {
    const rt = await boot(ME_CEO, { '/api/employees': [err(400, 'invalid_query')] });
    check(rt.state() === 'AUTHENTICATED' && rt.store().error.kind === 'CLIENT_FAULT' && /could not process this request/.test(rt.appHTML()), 'F. 400 -> unexpected-request error; still signed in');
  }

  /* ---------- G. malformed answers are never stored or shown ---------- */
  const malformed = [
    ['list wrapper', '/api/employees', { list: [E1] }, ME_CEO],
    ['list item', '/api/employees', { employees: [Object.assign({}, E1, { extra: 1 })] }, ME_CEO],
    ['unknown employmentStatus', '/api/employees', { employees: [Object.assign({}, E1, { employmentStatus: 'Fired' })] }, ME_CEO],
    ['unknown accountState', '/api/employees', { employees: [Object.assign({}, E1, { accountState: 'locked' })] }, ME_CEO],
    ['self containing notes', '/api/employee?id=emp_srv_1', { employee: Object.assign({}, SELF, { notes: 'x' }) }, ME_EMP],
    ['malformed self', '/api/employee?id=emp_srv_1', { employee: Object.assign({}, SELF, { monthlyBaseSalary: 12.5 }) }, ME_EMP]
  ];
  for(const [label, url, data, me] of malformed){
    const routes = {}; routes[url] = [ok(data)];
    const rt = await boot(me, routes);
    const s = rt.store();
    check(rt.state() === 'AUTHENTICATED' && s.error && s.error.kind === 'INVALID_RESPONSE' && s.list === null && s.self === null
      && /unexpected response/.test(rt.appHTML()) && !/Fabricated/.test(rt.appHTML()), 'G. malformed ' + label + ' -> nothing stored or shown; unexpected-response state');
  }
  {
    const rt = await boot(ME_CEO, { '/api/employees': [ok(LIST_ACTIVE)], '/api/employee?id=e_1': [ok({ employee: Object.assign({}, D1, { version: 'x' }) })] });
    await rt.SessionWorkspace.openDetail('e_1'); await flush();
    check(rt.store().detail === null && rt.store().error.kind === 'INVALID_RESPONSE' && !/7500000/.test(rt.appHTML()), 'G. malformed detail -> nothing stored or shown');
  }

  /* ---------- H. identity loss destroys the data ---------- */
  {
    const rt = await boot(ME_CEO, { '/api/employees': [ok(LIST_ACTIVE)], '/api/auth/logout': [ok(null)] });
    const g = rt.store().generation;
    await rt.AuthBoot.signOut(); await flush();
    const s = rt.store();
    check(rt.state() === 'SIGNED_OUT' && s.list === null && s.listStatus === 'idle' && s.principalKey === null && s.generation > g, 'H. logout clears the SESSION Employee data (generation bumped)');
    check(!/Fabricated/.test(rt.appHTML()) && rt.CsrfHolder.get() === null && rt.SessionIdentityProvider.getCurrentUser() === null, 'H. after logout nothing of the data, the identity or the CSRF token remains');
    firewall(rt, 'H. logout');
  }
  {
    const rt = await boot(ME_CEO, { '/api/employees': [ok(LIST_ACTIVE)], '/api/employee?id=e_1': [err(401, 'unauthenticated')] });
    check(rt.store().list.length === 2, 'H. (setup) a loaded list');
    await rt.SessionWorkspace.openDetail('e_1'); await flush();
    const s = rt.store();
    check(rt.state() === 'SIGNED_OUT' && rt.AuthBoot.snapshot().message === 'session_ended' && /session has ended/.test(rt.appHTML()), 'H. a 401 on a business read ends the session -> SIGNED_OUT (session_ended)');
    check(s.list === null && s.detail === null && s.principalKey === null && rt.CsrfHolder.get() === null && rt.SessionIdentityProvider.getCurrentUser() === null,
      'H. the 401 cleared identity, CSRF token and every SESSION Employee record');
    check(!/Fabricated/.test(rt.appHTML()), 'H. no record remains on screen');
    firewall(rt, 'H. 401');
  }
  {
    const late = deferred();
    const rt = await boot(ME_CEO, { '/api/employees': [() => late.promise], '/api/auth/logout': [ok(null)] });
    check(rt.store().listStatus === 'loading', 'H. (setup) the list read is pending');
    await rt.AuthBoot.signOut(); await flush();
    late.resolve(ok(LIST_ACTIVE)); await flush();
    check(rt.state() === 'SIGNED_OUT' && rt.store().list === null && !/Fabricated/.test(rt.appHTML()), 'H. a list answer arriving after logout is dropped (generation)');
  }
  {
    const late = deferred();
    const rt = await boot(ME_CEO, { '/api/employees': [() => late.promise] });
    await rt.SessionWorkspace.openDetail('e_1');
    const lost = deferred();
    rt.net.routes['/api/employee?id=e_1'] = [() => lost.promise];
    rt.AuthBoot.sessionLost(); await flush();
    late.resolve(err(401, 'unauthenticated')); await flush();
    check(rt.state() === 'SIGNED_OUT' && rt.store().principalKey === null, 'H. a stale 401 after the session already ended changes nothing');
  }
  {
    // Principal replacement: data of one principal never reaches the next.
    const lateA = deferred();
    const rt = await boot(ME_CEO, { '/api/employees': [() => lateA.promise, ok({ employees: [E3] })] });
    const gA = rt.store().generation;
    rt.SessionWorkspace.ensureLoaded({ id: 'u_ceo_2', displayName: 'CEO', principalType: 'ceo' }); await flush();
    check(rt.store().generation > gA && rt.store().list.length === 1 && rt.store().list[0].id === 'e_3', 'H. a different principal clears the data and loads its own');
    lateA.resolve(ok(LIST_ACTIVE)); await flush();
    check(rt.store().list.length === 1 && rt.store().list[0].id === 'e_3', 'H. the previous principal\'s late answer is dropped');
  }

  /* ---------- I. races between views ---------- */
  {
    const slowActive = deferred();
    const rt = await boot(ME_CEO, { '/api/employees': [() => slowActive.promise], '/api/employees?archived=1': [ok(LIST_ARCHIVED)] });
    check(rt.store().listStatus === 'loading' && rt.store().listArchived === false, 'I. (setup) the active list is pending');
    await rt.SessionWorkspace.showArchived(true); await flush();
    check(rt.store().listArchived === true && rt.store().list.length === 3, 'I. the archived list arrives first');
    slowActive.resolve(ok(LIST_ACTIVE)); await flush();
    check(rt.store().listArchived === true && rt.store().list.length === 3 && /Fabricated Gamma/.test(rt.appHTML()), 'I. the superseded active answer arrives later and is dropped: archived wins');
  }
  {
    const slow1 = deferred();
    const rt = await boot(ME_CEO, { '/api/employees': [ok(LIST_ACTIVE)], '/api/employee?id=e_1': [() => slow1.promise],
      '/api/employee?id=e_2': [ok({ employee: Object.assign({}, D1, E2, { joinDate: null, contactEmail: null, phone: null, notes: null, monthlyBaseSalary: null, version: 1 }) })] });
    rt.SessionWorkspace.openDetail('e_1');
    await rt.SessionWorkspace.openDetail('e_2'); await flush();
    slow1.resolve(ok({ employee: D1 })); await flush();
    check(rt.store().detailId === 'e_2' && rt.store().detail.fullName === 'Fabricated Beta', 'I. an earlier detail answer never replaces the record now open');
    rt.SessionWorkspace.back();
    const slow2 = deferred();
    rt.net.routes['/api/employee?id=e_1'] = [() => slow2.promise];
    rt.SessionWorkspace.openDetail('e_1');
    rt.SessionWorkspace.back();
    slow2.resolve(ok({ employee: D1 })); await flush();
    check(rt.store().detailId === null && rt.store().detail === null, 'I. a detail answer after Back is dropped');
  }

  /* ---------- J. fail closed on an unknown role ---------- */
  {
    const rt = await boot(ME_CEO, { '/api/employees': [ok(LIST_ACTIVE)] });
    const n = rt.net.calls.length;
    rt.SessionWorkspace.ensureLoaded({ id: 'u_x', displayName: 'X', principalType: 'auditor' }); await flush();
    check(rt.net.calls.length === n && rt.store().list === null, 'J. an unknown principal type reads nothing (and its data slot is empty)');
  }

  /* =================== AFI-4a2 — CEO WRITES =================== */

  /* ---------- K. request validation (the EmployeeInput mirror) ---------- */
  {
    const rt = loadRuntime({});
    const R = rt.EmployeeRequests;
    const P = (x) => rt.parse(JSON.stringify(x));
    const good = R.create(P(CREATE_INPUT));
    check(good.ok && Object.keys(good.body).sort().join() === WRITABLE_SORTED, 'K. create: a full draft builds a body of exactly the ten writable profile fields');
    check(rt.EMPLOYEE_WRITABLE_FIELDS.slice().sort().join() === WRITABLE_SORTED, 'K. the writable allowlist is exactly EmployeeInput::FIELDS');
    check(good.body.employeeCode === 'EMP-010' && good.body.jobTitle === null && good.body.phone === null && good.body.notes === null,
      'K. create: text is trimmed; a cleared optional field is sent as null, never ""');
    check(good.body.monthlyBaseSalary === '9000000.50' && typeof good.body.monthlyBaseSalary === 'string', 'K. create: salary stays the exact decimal string');
    const int = R.create(P({ employeeCode: 'X', fullName: 'Y', monthlyBaseSalary: 7500000 }));
    check(int.ok && int.body.monthlyBaseSalary === 7500000 && Object.keys(int.body).sort().join() === 'employeeCode,fullName,monthlyBaseSalary',
      'K. create: an integer salary is sent as that integer; only the given fields are sent');
    check(R.create(P({ employeeCode: 'X', fullName: 'Y', monthlyBaseSalary: '00012' })).body.monthlyBaseSalary === '00012', 'K. a salary string is sent exactly as entered (the server canonicalizes it)');
    check(R.create(P({ employeeCode: 'X', fullName: 'Y', notes: 'line one\nline two\ttab' })).ok, 'K. notes may span lines');
    check(R.create(P({ employeeCode: '😀'.repeat(32), fullName: '😀'.repeat(160) })).ok, 'K. lengths count code points (32 / 160 astral characters accepted)');
    check(R.create(P({ employeeCode: 'X', fullName: 'Y', contactEmail: ' Mixed@Example.COM ' })).body.contactEmail === 'Mixed@Example.COM', 'K. a valid email is sent trimmed (the server lower-cases it)');
    check(R.create(P({ employeeCode: 'X', fullName: 'Y', joinDate: '2024-02-29', phone: '+62 (812) 000-1.2' })).ok, 'K. a leap-day join date and a punctuated phone are accepted');
    const refused = (label, res, field) => check(!res.ok && res.fields.indexOf(field) !== -1, 'K. refused (' + field + '): ' + label);
    const base = (extra) => P(Object.assign({ employeeCode: 'X', fullName: 'Y' }, extra));
    refused('employeeCode missing', R.create(P({ fullName: 'Y' })), 'employeeCode');
    refused('fullName blank', R.create(base({ fullName: '   ' })), 'fullName');
    refused('employeeCode null', R.create(base({ employeeCode: null })), 'employeeCode');
    refused('employeeCode over 32 code points', R.create(base({ employeeCode: 'X'.repeat(33) })), 'employeeCode');
    refused('fullName over 160 code points', R.create(base({ fullName: 'é'.repeat(161) })), 'fullName');
    refused('fullName with a line break', R.create(base({ fullName: 'a\nb' })), 'fullName');
    refused('jobTitle over 120', R.create(base({ jobTitle: 'j'.repeat(121) })), 'jobTitle');
    refused('department with a control character', R.create(base({ department: 'a\u0007b' })), 'department');
    refused('notes over 2000', R.create(base({ notes: 'n'.repeat(2001) })), 'notes');
    refused('unknown employmentStatus', R.create(base({ employmentStatus: 'Fired' })), 'employmentStatus');
    refused('employmentStatus null', R.create(base({ employmentStatus: null })), 'employmentStatus');
    refused('join date before 1900', R.create(base({ joinDate: '1899-12-31' })), 'joinDate');
    refused('impossible join date', R.create(base({ joinDate: '2026-02-30' })), 'joinDate');
    refused('join date with a time', R.create(base({ joinDate: '2026-01-05T00:00' })), 'joinDate');
    refused('email without a domain', R.create(base({ contactEmail: 'nobody@' })), 'contactEmail');
    refused('email without @', R.create(base({ contactEmail: 'nobody' })), 'contactEmail');
    refused('non-ASCII email', R.create(base({ contactEmail: 'é@example.test' })), 'contactEmail');
    refused('phone with letters', R.create(base({ phone: 'call me' })), 'phone');
    refused('phone over 40', R.create(base({ phone: '1'.repeat(41) })), 'phone');
    refused('salary with three decimals', R.create(base({ monthlyBaseSalary: '7500000.555' })), 'monthlyBaseSalary');
    refused('salary with a separator', R.create(base({ monthlyBaseSalary: '7.500.000' })), 'monthlyBaseSalary');
    refused('salary over 13 digits', R.create(base({ monthlyBaseSalary: '1'.repeat(14) })), 'monthlyBaseSalary');
    refused('salary as a fractional number', R.create(base({ monthlyBaseSalary: 12.5 })), 'monthlyBaseSalary');
    refused('negative salary', R.create(base({ monthlyBaseSalary: -1 })), 'monthlyBaseSalary');
    refused('salary as a boolean', R.create(base({ monthlyBaseSalary: true })), 'monthlyBaseSalary');
    const AUTHORITY = ['id', 'version', 'archived', 'expectedVersion', 'company', 'companyId', 'company_id', 'user', 'userId', 'user_id', 'employeeId', 'employee_id',
      'membership', 'membershipId', 'role', 'accountState', 'accountManageable', 'bankAccount', 'bankName', 'createdBy', 'auditActor', 'token', 'csrfToken', 'password'];
    AUTHORITY.forEach((key) => { const x = {}; x[key] = 'x'; refused('authority / unknown key "' + key + '" on create', R.create(base(x)), key); });
    check(!R.create(null).ok && !R.create(P([])).ok && !R.create({ employeeCode: 'X', fullName: 'Y' }).ok, 'K. a non-plain draft (null, array, foreign object) is refused');
    const up = R.update('e_1', 3, P({ fullName: 'New', jobTitle: '' }));
    check(up.ok && Object.keys(up.body).sort().join() === 'expectedVersion,fullName,id,jobTitle' && up.body.jobTitle === null && up.body.expectedVersion === 3 && up.body.id === 'e_1',
      'K. update: id + expectedVersion + only the changed fields; a cleared field is null');
    check(R.update('e_1', 4294967295, P({ fullName: 'N' })).ok && R.update('LEGACY_anchor-1', 1, P({ fullName: 'N' })).ok, 'K. update accepts the server version range and ID_PATTERN');
    refused('update without a changed field', R.update('e_1', 3, P({})), 'fields');
    refused('update with a bad id', R.update('e 1', 3, P({ fullName: 'N' })), 'id');
    refused('update with no id', R.update(undefined, 3, P({ fullName: 'N' })), 'id');
    refused('expectedVersion 0', R.update('e_1', 0, P({ fullName: 'N' })), 'expectedVersion');
    refused('expectedVersion as a string', R.update('e_1', '3', P({ fullName: 'N' })), 'expectedVersion');
    refused('expectedVersion above 4294967295', R.update('e_1', 4294967296, P({ fullName: 'N' })), 'expectedVersion');
    refused('expectedVersion fractional', R.update('e_1', 1.5, P({ fullName: 'N' })), 'expectedVersion');
    refused('update blanking a required field', R.update('e_1', 3, P({ employeeCode: '' })), 'employeeCode');
    ['companyId', 'role', 'accountState', 'userId', 'version', 'archived', 'id'].forEach((key) => { const x = { fullName: 'N' }; x[key] = 'x'; refused('authority key "' + key + '" among the changed fields', R.update('e_1', 3, P(x)), key); });
    const ar = R.archive('e_1', 3);
    check(ar.ok && JSON.stringify(ar.body) === '{"id":"e_1","expectedVersion":3}', 'K. archive: exactly { id, expectedVersion }');
    refused('archive without a version', R.archive('e_1', undefined), 'expectedVersion');
    refused('archive with a bad id', R.archive('../x', 3), 'id');
    const n = rt.net.calls.length;
    const lc = await rt.EmployeeApi.create(P({ fullName: 'Y', role: 'ceo' }));
    const lu = await rt.EmployeeApi.update('e_1', 3, P({}));
    const la = await rt.EmployeeApi.archive('e_1', 0);
    check([lc, lu, la].every((o) => !o.ok && o.kind === 'VALIDATION' && o.local === true && o.recovery === 'none') && rt.net.calls.length === n,
      'K. EmployeeApi refuses an invalid write locally: nothing reaches the network');
  }

  /* ---------- L. CEO create ---------- */
  {
    const rt = await boot(ME_CEO, { '/api/employees': [ok(LIST_ACTIVE), ok({ employees: [E1, E2, NEW_ITEM] })], '/api/employees/create': [ok({ employee: NEW_D })] });
    check(rt.app.fire('swAddBtn', 'click') === 'fired', 'L. the CEO list renders a working "Add employee" control');
    await flush();
    const html = rt.appHTML();
    const names = (html.match(/\sname="[^"]+"/g) || []).map((m) => m.slice(7, -1)).sort().join();
    check(/<section class="card" aria-labelledby="swFormTitle">/.test(html) && /<form id="swForm" method="post" novalidate>/.test(html) && names === WRITABLE_SORTED,
      'L. Add employee opens an inline form card with exactly the ten writable fields (no modal)');
    check(lastFocus(rt) === 'swFormTitle', 'L. focus moves to the form heading');
    check(/<label for="swf-employeeCode">Employee code <span aria-hidden="true">\*<\/span><\/label>/.test(html) && /id="swf-employeeCode" name="employeeCode" required aria-required="true"/.test(html)
      && /<label for="swf-fullName">Full name <span aria-hidden="true">\*<\/span>/.test(html) && /Fields marked \* are required\./.test(html),
      'L. every field has an associated label; required fields are marked and aria-required');
    check(fieldsLabelled(html), 'L. each control id has exactly one <label for>');
    check(!/password|token|company|userId|membership|role=|accountState|accountManageable|name="id"|name="version"/i.test(html.replace(/role="(tablist|tab|status|alert)"/g, '')),
      'L. the form carries no password, token, company, user, role, account or version field');
    check(/<option value="Active" selected>Active<\/option>/.test(html) && /id="swf-monthlyBaseSalary"[^>]*aria-describedby="swf-monthlyBaseSalary-hint"/.test(html), 'L. employment status defaults to Active; hints are associated');
    check(writes(rt).length === 0 && !/id="swAddBtn"/.test(html), 'L. opening the form sends nothing; Add is not offered twice');
    firewall(rt, 'L. create form');
    Object.keys(CREATE_INPUT).forEach((k) => rt.app.type(k, CREATE_INPUT[k]));
    check(rt.store().form.values.employeeCode === ' EMP-010 ' && writes(rt).length === 0, 'L. typing keeps the draft in memory and sends nothing');
    rt.app.fire('swForm', 'submit'); await flush();
    const w = writes(rt);
    check(w.length === 1 && w[0].url === '/api/employees/create' && w[0].init.method === 'POST', 'L. Save sends exactly one POST /api/employees/create');
    const b = w.length ? bodyOf(w[0]) : {};
    check(Object.keys(b).sort().join() === WRITABLE_SORTED && b.employeeCode === 'EMP-010' && b.jobTitle === null && b.phone === null && b.notes === null && b.employmentStatus === 'Active',
      'L. body: exactly the ten profile fields, trimmed, a cleared field null');
    check(b.monthlyBaseSalary === '9000000.50' && /"monthlyBaseSalary":"9000000\.50"/.test(w[0] ? w[0].init.body : ''), 'L. the salary travels as the exact string');
    check(w[0] && w[0].init.headers['X-CSRF-Token'] === CSRF && w[0].init.headers['Content-Type'] === 'application/json' && w[0].init.credentials === 'same-origin'
      && w[0].init.mode === 'same-origin' && w[0].init.redirect === 'error', 'L. the write carries the in-memory CSRF token, JSON, same-origin only');
    const s = rt.store();
    check(s.detailId === 'e_new' && s.detail.version === 1 && s.detail.archived === false && s.detail.monthlyBaseSalary === '9000000.50' && Object.isFrozen(s.detail),
      'L. the strictly decoded server record (server id, version 1) becomes the detail');
    check(s.form === null && s.mutation.status === 'idle' && s.listStale === true, 'L. the form closes; the list is marked stale');
    const dh = rt.appHTML();
    check(/Employee record created\./.test(dh) && /Fabricated Delta/.test(dh) && /role="status"/.test(dh) && !/e_new/.test(dh), 'L. the new record opens with a confirmation; its opaque id stays out of the page');
    const reads = countOf(rt, '/api/employees');
    rt.app.fire('swBackBtn', 'click'); await flush();
    check(countOf(rt, '/api/employees') === reads + 1 && rt.store().list.length === 3 && rt.store().listStale === false && /Fabricated Delta/.test(rt.appHTML()),
      'L. back on the list, the authoritative list is read again (it was stale)');
    firewall(rt, 'L. create');
  }

  /* ---------- M. create: failures ---------- */
  {
    // Client validation: nothing is sent; the field is marked and focused; the draft is kept.
    const rt = await createWith([ok({ employee: NEW_D })]);
    rt.SessionWorkspace.setDraft('employeeCode', '  ');
    rt.SessionWorkspace.setDraft('fullName', '<img src=x onerror=alert(1)>"q\'');
    await rt.SessionWorkspace.submitForm(); await flush();
    const html = rt.appHTML();
    check(writes(rt).length === 0 && rt.store().mutation.status === 'error' && rt.store().mutation.fields.join() === 'employeeCode', 'M. client validation failure: zero requests');
    check(/id="swf-employeeCode" name="employeeCode" required aria-required="true" aria-invalid="true" aria-describedby="swf-employeeCode-error"/.test(html)
      && /<p class="hint auth-message-warn" id="swf-employeeCode-error">Enter an employee code/.test(html), 'M. the invalid field has aria-invalid and an associated error');
    check(lastFocus(rt) === 'swf-employeeCode', 'M. focus moves to the first invalid field');
    check(/value="&lt;img src=x onerror=alert\(1\)&gt;&quot;q&#39;"/.test(html) && !/<img/.test(html), 'M. the draft is kept and escaped inside the value attribute');
    firewall(rt, 'M. client validation');
  }
  {
    const rt = await createWith([errF(['contactEmail'])]);
    await rt.SessionWorkspace.submitForm(); await flush();
    const html = rt.appHTML();
    check(writes(rt).length === 1 && rt.store().mutation.error.kind === 'VALIDATION' && /id="swf-contactEmail"[^>]*aria-invalid="true"/.test(html) && lastFocus(rt) === 'swf-contactEmail',
      'M. server 400: the named field is marked and focused');
    check(rt.store().form.values.fullName === 'Fabricated Delta' && /value="Fabricated Delta"/.test(html) && /Some entries need attention/.test(html), 'M. server 400: the draft is kept');
  }
  {
    const rt = await createWith([errF(['expectedVersion'])]);
    await rt.SessionWorkspace.submitForm(); await flush();
    check(/could not accept these entries/.test(rt.appHTML()) && lastFocus(rt) === 'swMutationMessage' && !/aria-invalid/.test(rt.appHTML()),
      'M. a 400 naming no form field focuses the error message');
  }
  {
    const rt = await createWith([err(409, 'conflict')]);
    await rt.SessionWorkspace.submitForm(); await flush(20);
    const html = rt.appHTML();
    check(writes(rt).length === 1 && rt.store().mutation.status === 'error' && rt.store().mutation.error.kind === 'CONFLICT' && /employee code may already be in use/.test(html),
      'M. duplicate code 409: conflict shown, nothing resent');
    check(rt.store().form.values.fullName === 'Fabricated Delta' && !/swReloadBtn/.test(html) && rt.store().detailId === null, 'M. 409 on create keeps the draft; no record is opened');
    firewall(rt, 'M. create 409');
  }
  {
    const rt = await createWith([err(403, 'forbidden')]);
    await rt.SessionWorkspace.submitForm(); await flush();
    check(writes(rt).length === 1 && countOf(rt, '/api/auth/me') === 2 && rt.state() === 'AUTHENTICATED' && rt.store().mutation.error.kind === 'DENIED'
      && /do not have permission/.test(rt.appHTML()) && rt.CsrfHolder.get() === CSRF && rt.SessionIdentityProvider.getCurrentUser() !== null,
      'M. genuine 403 (token unchanged after one /me check): denied, still signed in, not replayed');
  }
  {
    const rt = await createWith([err(429, 'rate_limited', { 'Retry-After': '30' })]);
    await rt.SessionWorkspace.submitForm(); await flush(20);
    check(writes(rt).length === 1 && /Too many requests\. Try again in 30 seconds\./.test(rt.appHTML()) && rt.store().form !== null, 'M. 429: the wait is shown; nothing resent; draft kept');
  }
  {
    const rt = await createWith([err(500, 'internal_error'), ok({ employee: NEW_D })]);
    await rt.SessionWorkspace.submitForm(); await flush(20);
    const html = rt.appHTML();
    check(writes(rt).length === 1 && rt.store().mutation.error.kind === 'SERVER_ERROR' && /change was not saved/.test(html) && /Reference: 0123/.test(html)
      && /id="swFormSave"(?![^>]*disabled)/.test(html), 'M. 500: save failure shown (rolled back); Save stays available; nothing resent');
    await rt.SessionWorkspace.submitForm(); await flush();
    check(writes(rt).length === 2 && rt.store().detailId === 'e_new', 'M. a deliberate second Save after a 500 sends again');
  }
  const ambiguousCreate = [
    ['malformed success', [ok({ employee: Object.assign({}, NEW_D, { extra: 1 }) })]],
    ['success that does not confirm a new record (version 2)', [ok({ employee: Object.assign({}, NEW_D, { version: 2 }) })]],
    ['success with a wrong wrapper', [ok({ employees: [NEW_D] })]],
    ['network failure', [NETFAIL]],
    ['503', [err(503, 'service_unavailable')]],
    ['non-JSON proxy page', [resp(502, '<html>bad gateway</html>', { 'content-type': 'text/html' })]]
  ];
  for(const [label, routes] of ambiguousCreate){
    const rt = await createWith(routes, { '/api/employees': [ok(LIST_ACTIVE), ok({ employees: [E1, E2, NEW_ITEM] })] });
    const reads = countOf(rt, '/api/employees');
    await rt.SessionWorkspace.submitForm(); await flush(20);
    const s = rt.store();
    check(writes(rt).length === 1 && s.mutation.status === 'ambiguous' && s.mutation.kind === 'create' && s.detail === null && s.detailId === null,
      'M. create ' + label + ' -> AMBIGUOUS; the write is not resent and nothing is shown as created');
    check(countOf(rt, '/api/employees') === reads + 1 && s.list.length === 3 && /could not confirm the change/.test(rt.appHTML()) && s.form.values.fullName === 'Fabricated Delta'
      && rt.state() === 'AUTHENTICATED', 'M. create ' + label + ': the authoritative list is read again; the draft is kept; still signed in');
  }
  {
    // Focus: the reconciliation read finishing later must not pull focus off the message.
    const reread = deferred();
    const rt = await createWith([err(503, 'service_unavailable')], { '/api/employees': [ok(LIST_ACTIVE), () => reread.promise] });
    await rt.SessionWorkspace.submitForm(); await flush();
    check(lastFocus(rt) === 'swMutationMessage' && rt.store().listStatus === 'loading', 'M. ambiguous: focus moves to the message while the list is read again');
    const mark = rt.dom.focused.length;
    reread.resolve(ok(LIST_ACTIVE)); await flush();
    check(lastFocus(rt) === 'swMutationMessage' && rt.store().listStatus === 'ready' && rt.dom.focused.slice(mark).indexOf('authTitle') === -1,
      'M. the background re-render keeps focus on the message (not the page heading)');
    rt.app.el('swf-phone').focus();
    rt.SessionWorkspace.showArchived(true); await flush();
    check(lastFocus(rt) === 'swf-phone', 'M. a re-render keeps focus in the form field being edited');
  }
  {
    const rt = await createWith(['HANG']);
    rt.SessionWorkspace.submitForm(); await flush();
    const html = rt.appHTML();
    check(rt.store().mutation.status === 'pending' && /id="swFormSave" disabled aria-busy="true">Saving…</.test(html) && /<form id="swForm" method="post" novalidate aria-busy="true">/.test(html)
      && /id="swf-fullName" name="fullName" required aria-required="true" disabled/.test(html) && /id="swFormCancel" disabled/.test(html), 'M. pending: Save disabled (Saving…), form aria-busy, fields and Cancel disabled');
    rt.net.timers[rt.net.timers.length - 1](); await flush(20);
    check(writes(rt).length === 1 && rt.store().mutation.status === 'ambiguous', 'M. create timeout -> AMBIGUOUS; not resent');
  }
  {
    const late = deferred();
    const rt = await createWith([() => late.promise]);
    rt.SessionWorkspace.submitForm();
    rt.SessionWorkspace.submitForm();
    await flush();
    check(rt.app.fire('swFormSave', 'click') === 'disabled', 'M. the Save button is disabled while pending');
    rt.app.fire('swForm', 'submit'); rt.SessionWorkspace.submitForm(); await flush();
    check(writes(rt).length === 1, 'M. double / triple submit while pending sends exactly ONE write');
    late.resolve(ok({ employee: NEW_D })); await flush();
    check(rt.store().detailId === 'e_new' && writes(rt).length === 1, 'M. the one write completes');
  }

  /* ---------- N. CEO update ---------- */
  {
    const rt = await ceoDetail({ '/api/employees/update': [ok({ employee: D1V(4, { fullName: 'Fabricated Alpha Prime', jobTitle: null, monthlyBaseSalary: '8000000.00' }) })],
      '/api/employees': [ok(LIST_ACTIVE), ok(LIST_ACTIVE)] });
    const dh = rt.appHTML();
    check(/id="swEditBtn"[^>]*>Edit</.test(dh) && /id="swArchiveBtn"[^>]*>Archive</.test(dh), 'N. the CEO detail of a live record offers Edit and Archive');
    rt.app.fire('swEditBtn', 'click'); await flush();
    const html = rt.appHTML();
    check(/>Edit employee</.test(html) && /id="swf-fullName"[^>]*value="Fabricated Alpha"/.test(html) && /id="swf-monthlyBaseSalary"[^>]*value="7500000\.00"/.test(html)
      && /<textarea class="input" rows="4" id="swf-notes" name="notes">fabricated note &lt;b&gt;x&lt;\/b&gt;<\/textarea>/.test(html) && /id="swf-department"[^>]*value=""/.test(html),
      'N. the edit form starts from the decoded server record (escaped; null shown empty)');
    check(!/version|value="3"/i.test(html) && rt.store().detail.version === 3 && rt.store().form.values.version === undefined, 'N. the version stays in memory: never a form field or attribute');
    check(lastFocus(rt) === 'swFormTitle', 'N. focus moves to the form heading');
    await rt.SessionWorkspace.submitForm(); await flush();
    check(writes(rt).length === 0 && /No changes to save\./.test(rt.appHTML()) && lastFocus(rt) === 'swMutationMessage', 'N. no change: zero write requests');
    rt.app.type('fullName', 'Fabricated Alpha Prime'); rt.app.type('jobTitle', ''); rt.app.type('monthlyBaseSalary', '8000000');
    rt.app.fire('swForm', 'submit'); await flush();
    const w = writes(rt);
    check(w.length === 1 && w[0].url === '/api/employees/update' && w[0].init.body === '{"id":"e_1","expectedVersion":3,"fullName":"Fabricated Alpha Prime","jobTitle":null,"monthlyBaseSalary":"8000000"}',
      'N. update body: id, expectedVersion and only the changed fields (cleared -> null, salary a string)');
    check(w[0] && w[0].init.headers['X-CSRF-Token'] === CSRF, 'N. the update carries the CSRF token');
    const s = rt.store();
    check(s.detail.version === 4 && s.detail.fullName === 'Fabricated Alpha Prime' && s.detail.monthlyBaseSalary === '8000000.00' && s.form === null && s.listStale === true,
      'N. the decoded server record replaces the detail (server-normalized salary); the list is stale');
    check(/Employee record saved\./.test(rt.appHTML()) && /8000000\.00/.test(rt.appHTML()), 'N. the saved server record is shown');
    const reads = countOf(rt, '/api/employees');
    rt.SessionWorkspace.back(); await flush();
    check(countOf(rt, '/api/employees') === reads + 1, 'N. the list is read again when shown');
    firewall(rt, 'N. update');
  }
  {
    const rt = await editWith([ok({ employee: D1V(4) })]);
    rt.SessionWorkspace.cancelForm(); await flush();
    check(writes(rt).length === 0 && rt.store().form === null && /id="swEditBtn"/.test(rt.appHTML()) && rt.store().detail.version === 3, 'N. Cancel returns to the server detail; nothing sent');
  }
  {
    // 409: no overwrite, draft kept; Reload record reads the record; the next Save uses the new version, sending only the user's change.
    const rt = await editWith([err(409, 'conflict'), ok({ employee: D1V(6, { fullName: 'Fabricated Alpha Prime', department: 'Field Ops' }) })],
      { '/api/employee?id=e_1': [ok({ employee: D1 }), ok({ employee: D1V(5, { department: 'Field Ops' }) })] });
    await rt.SessionWorkspace.submitForm(); await flush(20);
    let html = rt.appHTML();
    check(writes(rt).length === 1 && rt.store().mutation.error.kind === 'CONFLICT' && /changed or could not be saved because of a conflict/.test(html) && !/stale version|duplicate|already archived/i.test(html),
      'N. 409: a generic conflict message (no claimed cause); nothing resent');
    check(rt.store().form.values.fullName === 'Fabricated Alpha Prime' && /value="Fabricated Alpha Prime"/.test(html) && rt.store().detail.version === 3, 'N. 409: the draft is kept; nothing is overwritten');
    check(/id="swReloadBtn"[^>]*>Reload record</.test(html) && lastFocus(rt) === 'swMutationMessage', 'N. 409 offers Reload record; focus on the message');
    rt.app.fire('swReloadBtn', 'click'); await flush();
    html = rt.appHTML();
    check(countOf(rt, '/api/employee?id=e_1') === 2 && rt.store().detail.version === 5 && rt.store().form.values.fullName === 'Fabricated Alpha Prime' && /read again from TAM OS/.test(html),
      'N. Reload record reads the authoritative record (version 5); the draft survives');
    await rt.SessionWorkspace.submitForm(); await flush();
    check(writes(rt).length === 2 && writes(rt)[1].init.body === '{"id":"e_1","expectedVersion":5,"fullName":"Fabricated Alpha Prime"}',
      'N. the deliberate Save uses the refreshed version and sends only the user\'s change (the other change is not overwritten)');
    check(rt.store().detail.version === 6 && rt.store().detail.department === 'Field Ops', 'N. the server record after the save keeps the concurrent change');
    firewall(rt, 'N. conflict + reload');
  }
  const ambiguousUpdate = [
    ['malformed success', [ok({ employee: Object.assign({}, D1V(4), { salary: 1 }) })]],
    ['success for another record', [ok({ employee: D1V(4, { id: 'e_2' }) })]],
    ['network failure', [NETFAIL]],
    ['503', [err(503, 'service_unavailable')]]
  ];
  for(const [label, routes] of ambiguousUpdate){
    const rt = await editWith(routes, { '/api/employee?id=e_1': [ok({ employee: D1 }), ok({ employee: D1V(4, { fullName: 'Fabricated Alpha Prime' }) })] });
    await rt.SessionWorkspace.submitForm(); await flush(20);
    const s = rt.store();
    check(writes(rt).length === 1 && s.mutation.status === 'ambiguous' && s.mutation.kind === 'update' && countOf(rt, '/api/employee?id=e_1') === 2 && s.detail.version === 4,
      'M/N. update ' + label + ' -> AMBIGUOUS; not resent; the record is read again from the server');
    check(s.form.values.fullName === 'Fabricated Alpha Prime' && s.listStale === true && /could not confirm the change/.test(rt.appHTML()), 'N. update ' + label + ': the draft is kept; the list is stale');
  }
  {
    const rt = await editWith(['HANG'], { '/api/employee?id=e_1': [ok({ employee: D1 }), ok({ employee: D1 })] });
    rt.SessionWorkspace.submitForm(); await flush();
    rt.net.timers[rt.net.timers.length - 1](); await flush(20);
    check(writes(rt).length === 1 && rt.store().mutation.status === 'ambiguous' && countOf(rt, '/api/employee?id=e_1') === 2, 'N. update timeout -> AMBIGUOUS; not resent; record re-read');
  }
  {
    const late = deferred();
    const rt = await editWith([() => late.promise]);
    rt.SessionWorkspace.submitForm(); rt.SessionWorkspace.submitForm(); rt.app.fire('swForm', 'submit'); await flush();
    check(writes(rt).length === 1 && rt.app.fire('swFormSave', 'click') === 'disabled', 'N. double submit of an update sends exactly ONE write');
    late.resolve(ok({ employee: D1V(4, { fullName: 'Fabricated Alpha Prime' }) })); await flush();
    check(rt.store().detail.version === 4, 'N. the one update completes');
  }
  {
    const rt = await editWith([err(404, 'not_found')], { '/api/employees': [ok(LIST_ACTIVE), ok({ employees: [E2] })] });
    await rt.SessionWorkspace.submitForm(); await flush();
    const s = rt.store();
    check(s.detailId === null && s.detail === null && s.form === null && s.list.length === 1 && /no longer available/.test(rt.appHTML()) && rt.state() === 'AUTHENTICATED',
      'N. 404: the stale detail and draft are cleared; the list is read again');
  }
  {
    const rt = await boot(ME_CEO, { '/api/employees?archived=1': [ok(LIST_ARCHIVED)], '/api/employees': [ok(LIST_ACTIVE)], '/api/employee?id=e_3': [ok({ employee: D3 })] });
    await rt.SessionWorkspace.showArchived(true); await flush();
    await rt.SessionWorkspace.openDetail('e_3'); await flush();
    const html = rt.appHTML();
    check(/pill-status-archived/.test(html) && !/swEditBtn|swArchiveBtn/.test(html), 'N/O. an archived record offers neither Edit nor Archive (no unarchive either)');
    rt.SessionWorkspace.openEdit(); rt.SessionWorkspace.openArchive(); await rt.SessionWorkspace.confirmArchive(); await rt.SessionWorkspace.submitForm(); await flush();
    check(writes(rt).length === 0 && rt.store().form === null && rt.store().confirm === null, 'N/O. an archived record cannot be edited or archived through the controller');
    check(!/[Uu]narchive|[Rr]estore/.test(html), 'O. there is no unarchive control');
  }

  /* ---------- O. CEO archive ---------- */
  {
    const archivedE1 = Object.assign({}, E1, { archived: true });
    const rt = await ceoDetail({ '/api/employees/archive': [ok({ employee: D1V(4, { archived: true }) })],
      '/api/employees': [ok(LIST_ACTIVE), ok({ employees: [E2] })], '/api/employees?archived=1': [ok({ employees: [archivedE1, E2, E3] })] });
    rt.app.fire('swArchiveBtn', 'click'); await flush();
    let html = rt.appHTML();
    check(writes(rt).length === 0, 'O. Archive does not send: it opens a confirmation');
    check(/<h2 class="section-title" id="swConfirmTitle" tabindex="-1">Archive this employee record\?<\/h2>/.test(html) && /Fabricated Alpha \(EMP-001\) will be archived/.test(html)
      && /id="swArchiveCancel"[^>]*>Cancel</.test(html) && /id="swArchiveConfirm"[^>]*>Archive record</.test(html) && lastFocus(rt) === 'swConfirmTitle',
      'O. the inline confirmation names the record, offers Cancel / Archive record, and takes focus');
    check(!/swEditBtn|swArchiveBtn/.test(html) && /not deletion/.test(html), 'O. while confirming, Edit / Archive are withdrawn; archiving is stated as not deletion');
    rt.app.fire('swArchiveCancel', 'click'); await flush();
    check(writes(rt).length === 0 && !/swConfirmTitle/.test(rt.appHTML()) && /swArchiveBtn/.test(rt.appHTML()), 'O. Cancel closes it: zero mutation requests');
    rt.app.fire('swArchiveBtn', 'click'); await flush();
    rt.app.fire('swArchiveConfirm', 'click'); await flush();
    const w = writes(rt);
    check(w.length === 1 && w[0].url === '/api/employees/archive' && w[0].init.body === '{"id":"e_1","expectedVersion":3}' && w[0].init.headers['X-CSRF-Token'] === CSRF,
      'O. Archive record sends exactly one POST /api/employees/archive with exactly { id, expectedVersion } and CSRF');
    const s = rt.store();
    check(s.detailId === null && s.detail === null && s.confirm === null && s.form === null && s.mutation.status === 'idle', 'O. success: the detail and confirmation are cleared');
    html = rt.appHTML();
    check(countOf(rt, '/api/employees') === 2 && s.list.length === 1 && !/Fabricated Alpha/.test(html) && /Employee record archived\./.test(html) && />Employees</.test(html),
      'O. back on the list, the active list is read again and the archived record is absent');
    await rt.SessionWorkspace.showArchived(true); await flush();
    html = rt.appHTML();
    check(/Fabricated Alpha<\/td>[\s\S]*?pill-status-archived/.test(html) && rt.store().list.find((e) => e.id === 'e_1').archived === true,
      'O. "Including archived" (read from the server) shows the record as archived');
    firewall(rt, 'O. archive');
  }
  {
    const late = deferred();
    const rt = await archiveWith([() => late.promise]);
    rt.SessionWorkspace.confirmArchive(); rt.SessionWorkspace.confirmArchive(); await flush();
    const html = rt.appHTML();
    check(rt.app.fire('swArchiveConfirm', 'click') === 'disabled' && /id="swArchiveConfirm" disabled aria-busy="true">Archiving…</.test(html) && /id="swArchiveCancel" disabled/.test(html),
      'O. pending: Archive record and Cancel disabled (Archiving…)');
    check(writes(rt).length === 1, 'O. double confirm sends exactly ONE archive');
    late.resolve(ok({ employee: D1V(4, { archived: true }) })); await flush();
    check(rt.store().detailId === null, 'O. the one archive completes');
  }
  {
    const rt = await archiveWith([err(409, 'conflict')], { '/api/employee?id=e_1': [ok({ employee: D1 }), ok({ employee: D1V(5) })] });
    await rt.SessionWorkspace.confirmArchive(); await flush(20);
    const html = rt.appHTML();
    check(writes(rt).length === 1 && /swConfirmTitle/.test(html) && /could not be archived because of a conflict/.test(html) && /id="swReloadBtn"/.test(html) && rt.store().detail.archived === false,
      'O. 409: the confirmation stays with a generic conflict and Reload record; nothing resent');
    await rt.SessionWorkspace.reloadRecord(); await flush();
    await rt.SessionWorkspace.confirmArchive(); await flush();
    check(writes(rt).length === 2 && writes(rt)[1].init.body === '{"id":"e_1","expectedVersion":5}', 'O. after Reload record, a deliberate archive uses the refreshed version');
  }
  const ambiguousArchive = [
    ['malformed success', [ok({ employee: Object.assign({}, D1V(4, { archived: true }), { archivedAt: 'x' }) })]],
    ['success that is not archived', [ok({ employee: D1V(4) })]],
    ['network failure', [NETFAIL]],
    ['503', [err(503, 'service_unavailable')]]
  ];
  for(const [label, routes] of ambiguousArchive){
    const rt = await archiveWith(routes, { '/api/employee?id=e_1': [ok({ employee: D1 }), ok({ employee: D1V(4, { archived: true }) })] });
    await rt.SessionWorkspace.confirmArchive(); await flush(20);
    const s = rt.store();
    const html = rt.appHTML();
    check(writes(rt).length === 1 && s.mutation.status === 'ambiguous' && s.mutation.kind === 'archive' && s.confirm === null && countOf(rt, '/api/employee?id=e_1') === 2,
      'O. archive ' + label + ' -> AMBIGUOUS; not resent; the record is read again');
    check(s.detail.archived === true && /pill-status-archived/.test(html) && !/swArchiveBtn/.test(html) && /could not confirm the change/.test(html) && s.listStale === true,
      'O. archive ' + label + ': the server state (archived) is shown; no second Archive offered');
  }
  {
    const rt = await archiveWith(['HANG'], { '/api/employee?id=e_1': [ok({ employee: D1 }), ok({ employee: D1 })] });
    rt.SessionWorkspace.confirmArchive(); await flush();
    rt.net.timers[rt.net.timers.length - 1](); await flush(20);
    check(writes(rt).length === 1 && rt.store().mutation.status === 'ambiguous' && rt.store().detail.archived === false && /swArchiveBtn/.test(rt.appHTML()),
      'O. archive timeout -> AMBIGUOUS; not resent; the re-read (not archived) lets the CEO decide again');
  }
  {
    const rt = await archiveWith([err(404, 'not_found')], { '/api/employees': [ok(LIST_ACTIVE), ok({ employees: [E2] })] });
    await rt.SessionWorkspace.confirmArchive(); await flush();
    check(rt.store().detailId === null && rt.store().confirm === null && rt.store().list.length === 1 && /no longer available/.test(rt.appHTML()), 'O. 404: detail cleared; the list is read again');
  }

  /* ---------- P. Employee: read-only, zero writes ---------- */
  {
    const rt = await boot(ME_EMP, { '/api/employee?id=emp_srv_1': [ok({ employee: SELF })], '/api/employees/create': [ok({ employee: NEW_D })],
      '/api/employees/update': [ok({ employee: D1V(4) })], '/api/employees/archive': [ok({ employee: D1V(4, { archived: true }) })] });
    let html = rt.appHTML();
    check(!/swAddBtn|swEditBtn|swArchiveBtn|swForm|swConfirmTitle|<form|<input|<textarea|<select|>Add employee|>Edit|>Archive/.test(html), 'P. the Employee view renders no Add, Edit, Archive, form or confirmation');
    const ws = rt.SessionWorkspace;
    // A valid draft, so only the role gate (not client validation) can stop the write.
    ws.openCreate(); ws.setDraft('employeeCode', 'EMP-900'); ws.setDraft('fullName', 'Forged'); await ws.submitForm(); ws.openEdit(); ws.openArchive(); await ws.confirmArchive(); ws.cancelForm(); ws.cancelArchive(); await ws.reloadRecord();
    await flush();
    check(writes(rt).length === 0 && rt.net.calls.length === 2 && rt.store().form === null && rt.store().confirm === null && rt.store().mutation.status === 'idle',
      'P. every mutation method fails closed for an Employee: 0 create / 0 update / 0 archive requests');
    // A forged draft in the store still renders nothing and sends nothing.
    rt.SessionEmployeeStore.openForm('create', null, { employeeCode: 'X', fullName: 'Y', employmentStatus: 'Active' });
    rt.SessionWorkspace.back(); await ws.submitForm(); await flush();
    html = rt.appHTML();
    check(!/swForm|<form|<input/.test(html) && writes(rt).length === 0 && /Fabricated Self/.test(html), 'P. even a forged draft renders no form for an Employee and sends nothing');
    firewall(rt, 'P. Employee');
  }

  /* ---------- Q. session, CSRF and identity ---------- */
  for(const [label, make] of [
    ['create', async () => { const rt = await createWith([err(401, 'unauthenticated')]); await rt.SessionWorkspace.submitForm(); return rt; }],
    ['update', async () => { const rt = await editWith([err(401, 'unauthenticated')]); await rt.SessionWorkspace.submitForm(); return rt; }],
    ['archive', async () => { const rt = await archiveWith([err(401, 'unauthenticated')]); await rt.SessionWorkspace.confirmArchive(); return rt; }]
  ]){
    const rt = await make(); await flush();
    const s = rt.store();
    check(rt.state() === 'SIGNED_OUT' && rt.AuthBoot.snapshot().message === 'session_ended' && s.form === null && s.confirm === null && s.list === null && s.detail === null
      && s.mutation.status === 'idle' && rt.CsrfHolder.get() === null && writes(rt).length === 1 && countOf(rt, '/api/auth/me') === 1,
      'Q. 401 on ' + label + ': session ended; identity, CSRF, draft and every record cleared; no /me, no resend');
    check(!/Fabricated/.test(rt.appHTML()), 'Q. 401 on ' + label + ': nothing remains on screen');
    firewall(rt, 'Q. 401 ' + label);
  }
  {
    const rt = await createWith([err(403, 'forbidden'), ok({ employee: NEW_D })], { '/api/auth/me': [ok(ME_CEO), ok(Object.assign({}, ME_CEO, { csrfToken: CSRF2 }))] });
    await rt.SessionWorkspace.submitForm(); await flush();
    const w = writes(rt);
    check(w.length === 2 && w[0].init.headers['X-CSRF-Token'] === CSRF && w[1].init.headers['X-CSRF-Token'] === CSRF2 && w[0].init.body === w[1].init.body && countOf(rt, '/api/auth/me') === 2,
      'Q. stale CSRF: one bounded /me refresh, then ONE replay with the new token and the same body');
    check(rt.store().detailId === 'e_new' && rt.state() === 'AUTHENTICATED', 'Q. the replay\'s answer is final and applied');
  }
  {
    const rt = await createWith([err(403, 'forbidden'), err(403, 'forbidden'), ok({ employee: NEW_D })], { '/api/auth/me': [ok(ME_CEO), ok(Object.assign({}, ME_CEO, { csrfToken: CSRF2 }))] });
    await rt.SessionWorkspace.submitForm(); await flush(20);
    check(writes(rt).length === 2 && rt.store().mutation.error.kind === 'DENIED' && rt.state() === 'AUTHENTICATED', 'Q. a 403 on the replay is final: denied, no third write');
  }
  {
    const rt = await createWith([err(403, 'forbidden'), ok({ employee: NEW_D })], {
      '/api/auth/me': [ok(ME_CEO), ok(Object.assign({}, ME_CEO, { userId: 'u_ceo_2', csrfToken: CSRF2 }))],
      '/api/employees': [ok(LIST_ACTIVE), ok({ employees: [E3] })] });
    const g = rt.store().generation;
    await rt.SessionWorkspace.submitForm(); await flush();
    const s = rt.store();
    check(writes(rt).length === 1 && s.generation > g && s.form === null && s.detail === null && s.mutation.status === 'idle' && rt.AuthBoot.snapshot().principal.id === 'u_ceo_2',
      'Q. principal_changed: the old principal\'s draft and data are cleared; no replay; the result is not applied');
    check(rt.state() === 'AUTHENTICATED' && s.list && s.list.length === 1 && s.list[0].id === 'e_3' && !/Fabricated Delta/.test(rt.appHTML()), 'Q. the workspace re-renders for the new principal');
  }
  {
    const rt = await createWith([err(403, 'forbidden')], { '/api/auth/me': [ok(ME_CEO), err(503, 'service_unavailable')] });
    const g = rt.store().generation;
    await rt.SessionWorkspace.submitForm(); await flush();
    const n = rt.net.calls.length;
    await flush(20);
    const s = rt.store();
    check(rt.state() === 'UNAVAILABLE' && rt.SessionIdentityProvider.getCurrentUser() === null && rt.CsrfHolder.get() === null && s.generation > g && s.form === null && s.list === null,
      'Q. recovery unavailable -> AuthBoot.sessionUncertain(): UNAVAILABLE; identity, CSRF and Employee data cleared');
    check(writes(rt).length === 1 && countOf(rt, '/api/auth/me') === 2 && rt.net.calls.length === n && /TAM OS is unavailable/.test(rt.appHTML()) && /authRetryBtn/.test(rt.appHTML()),
      'Q. sessionUncertain makes no request; the unavailable view offers Retry only');
    firewall(rt, 'Q. recovery unavailable');
  }
  {
    // sessionUncertain is reserved for that outcome: a plain 503 / 500 / 409 / 403 keeps the session.
    const rt = await boot(ME_CEO, { '/api/employees': [ok(LIST_ACTIVE)] });
    rt.AuthBoot.sessionUncertain();
    check(rt.state() === 'UNAVAILABLE', 'Q. (direct) sessionUncertain moves AUTHENTICATED to UNAVAILABLE');
    const out = rt.AuthBoot.sessionUncertain();
    check(out === undefined && rt.state() === 'UNAVAILABLE', 'Q. sessionUncertain outside AUTHENTICATED changes nothing');
  }
  {
    const late = deferred();
    const rt = await createWith([() => late.promise], { '/api/auth/logout': [ok(null)] });
    rt.SessionWorkspace.submitForm(); await flush();
    await rt.AuthBoot.signOut(); await flush();
    late.resolve(ok({ employee: NEW_D })); await flush();
    const s = rt.store();
    check(rt.state() === 'SIGNED_OUT' && s.detail === null && s.form === null && s.mutation.status === 'idle' && !/Fabricated Delta/.test(rt.appHTML()),
      'Q. logout while a write is pending: the late success is dropped; nothing is repopulated');
    firewall(rt, 'Q. logout while pending');
  }
  {
    const late = deferred();
    const rt = await editWith([() => late.promise], { '/api/auth/logout': [ok(null)] });
    rt.SessionWorkspace.submitForm(); await flush();
    await rt.AuthBoot.signOut(); await flush();
    late.resolve(err(409, 'conflict')); await flush();
    check(rt.state() === 'SIGNED_OUT' && rt.store().mutation.status === 'idle' && rt.store().form === null && rt.AuthBoot.snapshot().message === 'signed_out',
      'Q. a late failure after logout is dropped');
  }
  {
    const late = deferred();
    const rt = await archiveWith([() => late.promise], { '/api/employees': [ok(LIST_ACTIVE), ok({ employees: [E3] })] });
    rt.SessionWorkspace.confirmArchive(); await flush();
    rt.SessionWorkspace.ensureLoaded({ id: 'u_ceo_2', displayName: 'CEO', principalType: 'ceo' }); await flush();
    late.resolve(ok({ employee: D1V(4, { archived: true }) })); await flush();
    const s = rt.store();
    check(s.list.length === 1 && s.list[0].id === 'e_3' && s.notice === null && s.mutation.status === 'idle' && s.detail === null,
      'Q. principal replacement while a write is pending: the late result is dropped');
  }
  {
    const late = deferred();
    const rt = await createWith([() => late.promise]);
    rt.SessionWorkspace.submitForm(); await flush();
    rt.AuthBoot.sessionLost(); await flush();
    late.resolve(err(401, 'unauthenticated')); await flush();
    check(rt.state() === 'SIGNED_OUT' && rt.store().principalKey === null && rt.store().form === null, 'Q. a stale write answer after the session already ended changes nothing');
  }

  /* ---------- T. the draft: memory only, survives re-render, destroyed with the identity ---------- */
  {
    const rt = await boot(ME_CEO, { '/api/employees': [ok(LIST_ACTIVE)], '/api/employees?archived=1': [ok(LIST_ARCHIVED)] });
    rt.SessionWorkspace.openCreate(); await flush();
    rt.app.type('fullName', 'Draft Name'); rt.app.type('notes', 'line 1\nline 2');
    await rt.SessionWorkspace.showArchived(true); await flush();
    const html = rt.appHTML();
    check(/value="Draft Name"/.test(html) && />line 1\nline 2<\/textarea>/.test(html) && rt.store().listArchived === true, 'T. the draft survives an ordinary re-render (tab switch)');
    rt.SessionWorkspace.cancelForm(); await flush();
    rt.SessionWorkspace.openCreate(); await flush();
    check(rt.store().form.values.fullName === '' && !/Draft Name/.test(rt.appHTML()), 'T. Cancel destroys the draft');
    rt.app.type('fullName', 'Second Draft');
    await rt.SessionWorkspace.openDetail('e_1'); await flush();
    check(rt.store().form === null, 'T. leaving the list for a record leaves its create draft');
    firewall(rt, 'T. draft lifecycle');
  }

  console.log('');
  if(failures.length){
    console.log('AFI-4a1/AFI-4a2 SESSION EMPLOYEE WORKSPACE RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('AFI-4a1/AFI-4a2 SESSION EMPLOYEE WORKSPACE RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})().catch(function(e){ console.log('AFI-4a1/AFI-4a2 SESSION EMPLOYEE WORKSPACE RUNTIME VERIFICATION FAILED -- harness error: ' + (e && e.stack || e)); process.exit(1); });
