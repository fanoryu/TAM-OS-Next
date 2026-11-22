#!/usr/bin/env node
'use strict';
/* ============================================================
   U-ISO — SESSION-ONLY PRODUCTION PACKAGE RUNTIME VERIFICATION (ADR-0005)
   ------------------------------------------------------------
   tools/verify-build.js proves the STRUCTURE of the SESSION-only package. This harness runs the
   package itself: the exact files tools/build-package.js assembles (in memory, nothing written),
   loaded in the order of the package's own index.html, in the dependency-free Node `vm` loader of
   the AFI harnesses, against a deterministic fetch stub. Every identity and record is fabricated.

     C  composition: the package's scripts are exactly tools/module-order.js productionOrder (plus
        the theme boot); no LOCAL-only module is a package file, referenced or not
     S  SESSION boot (CEO, Employee, signed out): the SESSION shell or the sign-in form renders,
        State, logActivity, loadState and the LOCAL storage layer are not defined, no browser
        storage is touched, and no error is logged
     X  the AWP-05 CSV writer (SessionCsv) builds and downloads a document in the package alone
     L  LOCAL development: the page tools/serve-local-dev.js serves lists the full canonical
        order with the development persona after identity.js, and loading that order in LOCAL
        mode defines State and writes the development activity log (tam_audit_log_v1)

   No git, network or disk write at run time.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parseSessionShell } = require('./session-shell-chrome.js');

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

const root = path.resolve(__dirname, '..');
const ORDER = require('./module-order.js');
const pkg = require('./build-package.js').assemblePackage();
const pkgFile = (p) => { const f = pkg.files.find((x) => x.path === p); return f ? f.data.toString('utf8') : null; };
const pkgIndex = pkgFile('index.html');
const pkgScripts = (pkgIndex.match(/<script\b[^>]*\ssrc="([^"]+)"/g) || []).map((t) => /\ssrc="([^"]+)"/.exec(t)[1]);
const CSRF = 'A'.repeat(21) + '_' + 'b'.repeat(21);
const RID = '0123456789abcdef0123456789abcdef';
const ME_CEO = { userId: 'u_ceo_1', membershipId: 'm_ceo_1', role: 'ceo', employeeId: null, csrfToken: CSRF };
const ME_EMP = { userId: 'u_emp_1', membershipId: 'm_emp_1', role: 'employee', employeeId: 'emp_srv_1', csrfToken: CSRF };
const SELF = { id: 'emp_srv_1', employeeCode: 'EMP-777', fullName: 'Fabricated Self', jobTitle: null, department: null, employmentStatus: 'Active',
  joinDate: null, contactEmail: null, phone: null, monthlyBaseSalary: '1000000.00' };
const E1 = { id: 'e_1', employeeCode: 'EMP-001', fullName: 'Fabricated Alpha', jobTitle: 'Engineer', department: null, employmentStatus: 'Active', archived: false, accountState: 'active', accountManageable: true };
// The LOCAL application's globals. None may exist in the SESSION-only package.
const LOCAL_GLOBALS = ['State', 'logActivity', 'loadState', 'saveState', 'StorageAdapter', 'TAM_DATA_KEYS', 'AUDIT_LOG_KEY', 'readAuditRaw',
  'renderShell', 'renderLocalShell', 'syncShellState', 'renderView', 'renderActivityLog', 'openGlobalSearch', 'can', 'ACTIONS', 'getCurrentWorkspace'];

function resp(status, body){
  return { status: status,
    headers: { get: (n) => String(n).toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null },
    text: async () => JSON.stringify(body) };
}
const ok = (data) => resp(200, { ok: true, data: data, requestId: RID });
const err = (status, code) => resp(status, { ok: false, error: { code: code, message: 'server text' }, requestId: RID });

/* ---------- a minimal browser: a recording #app, storage and console spies, a fetch stub ---------- */
function sandboxOf(routes){
  const noop = function(){};
  const access = { local: [], session: [] };
  const storageOf = (log) => { const mem = {}; return { getItem: (k) => { log.push('get:' + k); return k in mem ? mem[k] : null; },
    setItem: (k, v) => { log.push('set:' + k); mem[k] = String(v); }, removeItem: (k) => { log.push('remove:' + k); delete mem[k]; },
    key: () => null, get length(){ return Object.keys(mem).length; }, clear: () => { log.push('clear'); }, mem: mem }; };
  const mkEl = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'', value:'', click: noop,
    addEventListener:noop, removeEventListener:noop, appendChild:noop, removeChild:noop, setAttribute:noop, removeAttribute:noop,
    getAttribute:()=>null, remove:noop, focus:noop, contains:()=>false, querySelector:()=>null, querySelectorAll:()=>[],
    classList:{ add:noop, remove:noop, toggle:noop, contains:()=>false } });
  let html = '';
  const app = mkEl();
  Object.defineProperty(app, 'innerHTML', { get: () => html, set: (v) => { html = String(v); } });
  const els = { app: app };
  const logged = [];
  const net = { calls: [] };
  const dl = { blobs: [], clicks: 0 };
  function RecBlob(parts, opts){ this.parts = parts; this.type = opts && opts.type; dl.blobs.push(this); }
  const sandbox = {
    console: { log: noop, info: noop, warn: (...a) => logged.push('warn:' + a.join(' ')), error: (...a) => logged.push('error:' + a.join(' ')) },
    navigator: { userAgent: 'tam-u-iso' },
    setTimeout: (fn, ms) => (ms === 10000 ? 'api-timer' : setTimeout(fn, ms)), clearTimeout: (id) => { if(id !== 'api-timer') clearTimeout(id); },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    AbortController: AbortController,
    fetch: function(url, init){
      net.calls.push(url);
      const next = (routes[url] || [])[0];
      return next ? Promise.resolve(next) : Promise.reject(new TypeError('no route'));
    },
    localStorage: storageOf(access.local), sessionStorage: storageOf(access.session),
    addEventListener: noop, removeEventListener: noop, confirm: () => true,
    location: { hash: '', search: '', pathname: '/', href: 'http://127.0.0.1/' },
    history: { replaceState: noop, pushState: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    Blob: RecBlob, URL: { createObjectURL: (b) => 'blob:http://127.0.0.1/' + dl.blobs.indexOf(b), revokeObjectURL: noop },
    document: { addEventListener: noop, removeEventListener: noop, hasFocus: () => true,
      getElementById: (id) => (els[id] = els[id] || mkEl()), querySelector: () => null, querySelectorAll: () => [],
      createElement: () => { const a = mkEl(); a.click = () => { dl.clicks++; }; return a; }, contains: () => false,
      body: mkEl(), documentElement: { dataset:{}, style:{} }, activeElement: null }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  return { sandbox, access, logged, net, dl, appHTML: () => html };
}
const flush = async (n) => { for(let i = 0; i < (n || 10); i++) await new Promise((r) => setImmediate(r)); };
const typeOf = (ctx, name) => vm.runInContext('typeof ' + name, ctx);

// The production package, exactly as built: its own index.html script order, its own file bytes.
async function bootPackage(routes){
  const b = sandboxOf(routes);
  const ctx = vm.createContext(b.sandbox);
  const src = pkgScripts.filter((s) => s.startsWith('js/') && s !== 'js/boot/theme-boot.js').map(pkgFile).join('\n')
    + '\n;window.__TAM__ = { AuthBoot: AuthBoot, SessionCsv: SessionCsv, render: render };';
  vm.runInContext(src, ctx, { filename: 'tam-session-package.js' });
  await flush();
  return Object.assign(b, { ctx, rt: b.sandbox.__TAM__ });
}

async function main(){
  console.log('== C. COMPOSITION ==');
  const pkgJs = pkg.files.map((f) => f.path).filter((p) => p.startsWith('js/'));
  check(JSON.stringify(pkgScripts.filter((s) => s.startsWith('js/') && s !== 'js/boot/theme-boot.js')) === JSON.stringify(ORDER.productionOrder.map((m) => 'js/' + m)),
    'C: the package index.html loads exactly module-order productionOrder (' + ORDER.productionOrder.length + ' modules), in order');
  check(pkgJs.length === ORDER.productionOrder.length + 1 && pkgJs.every((p) => p === 'js/boot/theme-boot.js' || ORDER.productionOrder.includes(p.slice(3))),
    'C: the package holds only those modules and the theme boot (' + pkgJs.length + ' JS files of ' + pkg.files.length + ')');
  check(ORDER.localOnly.length > 0 && ORDER.localOnly.every((m) => !pkg.files.some((f) => f.path === 'js/' + m)),
    'C: none of the ' + ORDER.localOnly.length + ' LOCAL-only modules is a package file (activity-log.js, state.js, storage-adapter.js and shell-render.js included)');
  // Comments may name LOCAL things (to say they are never used); code may not.
  const codeOf = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
  check(!pkg.files.filter((f) => /\.(js|html)$/.test(f.path)).some((f) => /\b(tam_audit_log_v1|AUDIT_LOG_KEY|TAM_DATA_KEYS|StorageAdapter)\b/.test(codeOf(f.data.toString('utf8')))),
    'C: no package code names the LOCAL audit log key, the LOCAL data keys or the LOCAL storage layer');

  console.log('== S. SESSION BOOT (the package alone) ==');
  const BASE = { ceo: { '/api/employees': [ok({ employees: [E1] })] }, employee: { '/api/employee?id=emp_srv_1': [ok({ employee: SELF })] } };
  for(const me of [ME_CEO, ME_EMP]){
    const b = await bootPackage(Object.assign({ '/api/auth/me': [ok(me)] }, BASE[me.role]));
    const shell = parseSessionShell(b.appHTML());
    check(b.rt.AuthBoot.snapshot().state === 'AUTHENTICATED' && !!shell && shell.role === me.role && shell.active === 'home',
      'S ' + me.role + ': the package boots to the ' + me.role + ' SESSION shell, Home active');
    const defined = LOCAL_GLOBALS.filter((n) => typeOf(b.ctx, n) !== 'undefined');
    check(defined.length === 0, 'S ' + me.role + ': no LOCAL global is defined (State, logActivity, loadState, the storage layer, the LOCAL shell)' + (defined.length ? ' >> ' + defined.join(', ') : ''));
    // The shell offers the role's sections and a repaint through render() (js/ui/shell-core.js) raises nothing.
    const ids = Array.from(new Set((b.appHTML().match(/id="swSection[A-Za-z]+"/g) || []).map((t) => t.slice(4, -1))));
    let threw = null;
    try{ b.rt.render(); }catch(e){ threw = e; }
    await flush();
    check(ids.length >= 3 && threw === null && !!parseSessionShell(b.appHTML()),
      'S ' + me.role + ': the shell offers ' + ids.length + ' sections and a repaint through render() raises nothing' + (threw ? ' >> ' + threw : ''));
    check(b.access.local.length === 0 && b.access.session.length === 0 && b.logged.length === 0,
      'S ' + me.role + ': no localStorage or sessionStorage access and no console error or warning' + (b.access.local.length ? ' >> ' + b.access.local.join(',') : '') + (b.logged.length ? ' >> ' + b.logged.join(' | ') : ''));
    check(b.net.calls[0] === '/api/auth/me' && b.net.calls.every((u) => u.startsWith('/api/')), 'S ' + me.role + ': the only network peer is the same-origin API, starting with /api/auth/me');
  }
  {
    const b = await bootPackage({ '/api/auth/me': [err(401, 'unauthenticated')] });
    check(b.rt.AuthBoot.snapshot().state === 'SIGNED_OUT' && /id="authSignInForm"/.test(b.appHTML()) && !parseSessionShell(b.appHTML()),
      'S signed out (/me 401): the sign-in form, no shell');
    check(typeOf(b.ctx, 'State') === 'undefined' && typeOf(b.ctx, 'logActivity') === 'undefined' && b.access.local.length === 0 && b.logged.length === 0,
      'S signed out: no LOCAL global, no storage access, no console error');

    console.log('== X. CSV WRITER (AWP-05) ==');
    const Csv = b.rt.SessionCsv;
    const doc = Csv.document(['Date', 'Amount', 'Note'], [[Csv.text('2031-04-01'), Csv.money('1500000.00'), Csv.text('=SUM(A1)')]]);
    const okDl = Csv.download(doc, Csv.filename(['audit', '2031-04']));
    check(okDl === true && b.dl.blobs.length === 1 && b.dl.blobs[0].type === 'text/csv;charset=utf-8' && b.dl.clicks === 1
      && doc === '﻿Date,Amount,Note\r\n2031-04-01,1500000.00,\'=SUM(A1)\r\n' && Csv.filename(['audit', '2031-04']) === 'tam-os-audit-2031-04.csv',
      'X: SessionCsv builds the document (BOM, CRLF, formula-safe cell) and downloads text/csv in the package alone');
  }

  console.log('== L. LOCAL DEVELOPMENT (tools/serve-local-dev.js) ==');
  const { localDevIndexHtml } = require('./serve-local-dev.js');
  const devHtml = localDevIndexHtml(pkgIndex);
  const devScripts = devHtml ? (devHtml.match(/<script\b[^>]*\ssrc="([^"]+)"/g) || []).map((t) => /\ssrc="([^"]+)"/.exec(t)[1]) : [];
  const devJs = devScripts.filter((s) => s.startsWith('js/') && s !== 'js/boot/theme-boot.js');
  check(devHtml !== null && JSON.stringify(devJs) === JSON.stringify(ORDER.map((m) => 'js/' + m))
    && devScripts[devScripts.indexOf('js/core/identity.js') + 1] === 'dev/local-identity-fixture.js',
    'L: the LOCAL development page lists the full canonical order (' + ORDER.length + ' modules) with the persona right after identity.js');
  check(ORDER.localOnly.every((m) => fs.existsSync(path.join(root, 'js', m))) && localDevIndexHtml(pkgIndex.replace('<script src="js/core/session-csv.js"></script>\n', '')) === null,
    'L: every LOCAL-only module exists in js/ (served from source), and a package page of any other shape is refused');
  {
    const b = sandboxOf({});
    const ctx = vm.createContext(b.sandbox);
    const src = devJs.filter((s) => s !== 'js/core/app-bootstrap.js').map((s) => {
      let t = fs.readFileSync(path.join(root, s), 'utf8');
      if(s === 'js/core/constants.js') t = t.replace('const AUTH_MODE = AUTH_MODES.SESSION;', 'const AUTH_MODE = AUTH_MODES.LOCAL;');
      return t;
    }).join('\n');
    let loadErr = null;
    try{ vm.runInContext(src + '\n;logActivity({ type: "test", module: "System", desc: "Fabricated development entry" });', ctx, { filename: 'tam-local-dev.js' }); }catch(e){ loadErr = e; }
    const stored = b.sandbox.localStorage.mem.tam_audit_log_v1;
    check(loadErr === null && typeOf(ctx, 'State') === 'object' && typeOf(ctx, 'logActivity') === 'function' && typeOf(ctx, 'render') === 'function',
      'L: the full order loads in LOCAL mode and defines State, logActivity and render' + (loadErr ? ' >> ' + loadErr : ''));
    check(typeof stored === 'string' && JSON.parse(stored)[0].desc === 'Fabricated development entry',
      'L: LOCAL development still writes its activity log (tam_audit_log_v1) to its own storage');
  }

  console.log('');
  if(failures.length === 0){ console.log('RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.'); process.exit(0); }
  console.log('RUNTIME VERIFICATION FAILED -- ' + passed + ' passed, ' + failures.length + ' failed:');
  failures.forEach((f) => console.log('   - ' + f));
  process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
