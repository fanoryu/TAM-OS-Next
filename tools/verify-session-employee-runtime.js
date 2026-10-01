#!/usr/bin/env node
'use strict';
/* ============================================================
   AFI-4a1 — SESSION EMPLOYEE WORKSPACE RUNTIME VERIFICATION
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of AFI-4a1. This harness proves its
   BEHAVIOUR by executing every production module (module-order.js, the boot
   included) in the dependency-free Node `vm` loader of the AFI-2 harness, with the
   ONE source line `const AUTH_MODE = AUTH_MODES.LOCAL;` rewritten to SESSION in the
   concatenated text — the committed value is untouched.

   fetch is a deterministic stub answering by URL (path + query) from a script; the
   API timeout timer is captured and fired on demand. localStorage / sessionStorage
   are instrumented, and the LOCAL boot, the shell, "Acting as", local data tools,
   Global Search, the legacy Employee handlers and the other domains' renderers are
   replaced by recording spies that must never be called. Every identity, token and
   record here is fabricated.
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
const NETFAIL = () => new TypeError('Failed to fetch');
function deferred(){ let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise: promise, resolve: resolve }; }

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
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-afi4a1-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.net = net; rt.access = access; rt.spy = sandbox.__spy; rt.spyErr = sandbox.__spyErr;
  rt.appHTML = () => (els.app ? els.app.innerHTML : '');
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
}

(async function main(){
  console.log('== AFI-4a1 SESSION EMPLOYEE WORKSPACE — RUNTIME VERIFICATION ==');

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
    check(!/<form|<input|<select|<textarea|>Edit|>Archive<|>Create|Provision|Reissue|>Disable|>Enable/.test(html), 'C. no create, edit, archive or account control');
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

  console.log('');
  if(failures.length){
    console.log('AFI-4a1 SESSION EMPLOYEE WORKSPACE RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('AFI-4a1 SESSION EMPLOYEE WORKSPACE RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})().catch(function(e){ console.log('AFI-4a1 SESSION EMPLOYEE WORKSPACE RUNTIME VERIFICATION FAILED -- harness error: ' + (e && e.stack || e)); process.exit(1); });
