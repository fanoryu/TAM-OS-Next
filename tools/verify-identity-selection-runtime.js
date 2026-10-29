#!/usr/bin/env node
'use strict';
/* ============================================================
   UX-006D1 → AFI-5b — PRINCIPAL SELECTION: PRODUCTION ABSENCE + DEVELOPMENT ISOLATION
   ------------------------------------------------------------
   The file name is historical (UX-006D1 "Reachable Principal Selection", kept so the CI
   allowlist stays stable, design Rev 1.2 D-03). Since AFI-5b the application ships NO
   "Acting as" selector, NO principal fixtures and NO selection API; the persona used for
   LOCAL development lives only in tools/dev/local-identity-fixture.js.

   This harness executes the REAL production modules through the same dependency-free
   Node `vm` loader as the other harnesses (module-order.js MINUS core/app-bootstrap.js)
   and proves:
     A. the shipped SESSION runtime: no selector function, fixture or selection API is
        declared or on window; no identity before /me; no identity persistence;
     B. the source and package: no production file (registered or not) defines or calls
        the selector or the selection API; the selector module is gone from
        module-order.js, index.html and the built package;
     C. development isolation: in a LOCAL runtime with the development identity loaded,
        the alias enumerates CEO-first, a selection reaches identity + workspace + authz
        only once the alias is installed, nothing persists, a fresh load is null again,
        and empty/unknown ids are no-op misses — while the alias stays off window.
   No file is modified; no real data is used; all fixtures are fabricated.
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
const DEV_IDENTITY = fs.readFileSync(path.join(__dirname, 'dev', 'local-identity-fixture.js'), 'utf8');
const SELECTOR_NAMES = ['renderIdentitySelectorHTML', 'bindIdentitySelector', 'syncIdentitySelector',
  'identityAvailablePrincipals', 'onIdentityPrincipalChange'];
const FIXTURE_NAMES = ['LocalIdentityProvider', 'FIXTURE_PRINCIPALS'];

/* ---------- runtime loader ----------
   local=false: the shipped source unchanged (SESSION). local=true: the one AUTH_MODE
   assignment rewritten to LOCAL in memory and the development identity loaded right
   after identity.js (installation is left to each test). */
function loadRuntime(local){
  const jsFiles = require(path.join(root,'tools','module-order.js')).filter(f => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(f => {
      let s = fs.readFileSync(path.join(root,'js',f),'utf8');
      if(local && f === 'core/constants.js'){
        const assigns = s.match(/const AUTH_MODE = [^;\n]+;/g) || [];
        if(assigns.length !== 1) throw new Error('expected exactly one AUTH_MODE assignment');
        s = s.replace(assigns[0], 'const AUTH_MODE = AUTH_MODES.LOCAL;');
      }
      return (local && f === 'core/identity.js') ? s + '\n' + DEV_IDENTITY : s;
    }).join('\n')
    + '\n;window.__TAM__ = { State: State, getCurrentUser: getCurrentUser,'
    + ' getCurrentWorkspace: getCurrentWorkspace, can: can, ACTIONS: ACTIONS,'
    + ' setIdentityProviderForTesting: setIdentityProviderForTesting,'
    + (local ? ' LocalIdentityProvider: LocalIdentityProvider,' : '')
    + ' lexical: {' + SELECTOR_NAMES.concat(FIXTURE_NAMES).map(n => ' ' + n + ': typeof ' + n).join(',') + ' } };';
  const noop = function(){};
  const memStore = {};
  const memStorage = {
    getItem:(k)=> Object.prototype.hasOwnProperty.call(memStore,k)?memStore[k]:null,
    setItem:(k,v)=>{ memStore[k]=String(v); },
    removeItem:(k)=>{ delete memStore[k]; }
  };
  const el = () => ({ style:{}, dataset:{}, className:'', textContent:'', innerHTML:'',
    addEventListener:noop, removeEventListener:noop, appendChild:noop, setAttribute:noop,
    remove:noop, querySelector:()=>null, querySelectorAll:()=>[] });
  const sandbox = {
    console:{ log:noop, warn:noop, error:noop }, navigator:{ userAgent:'tam-afi5b-selection' },
    setTimeout:setTimeout, clearTimeout:clearTimeout, requestAnimationFrame:(fn)=>setTimeout(fn,0),
    localStorage:memStorage, storage:undefined,
    addEventListener:noop, removeEventListener:noop, confirm:()=>true,
    matchMedia:()=>({ matches:false, addEventListener:noop, addListener:noop }),
    document:{ addEventListener:noop, removeEventListener:noop, getElementById:()=>el(),
      querySelector:()=>null, querySelectorAll:()=>[], createElement:()=>el(),
      body:{ appendChild:noop }, documentElement:{ dataset:{} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename:'tam-afi5b-selection-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.memStore = memStore;
  return rt;
}

/* Executable text of a JS source: block and line comments removed, string contents kept. */
function code(s){ return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1'); }
function allJs(dir){
  return fs.readdirSync(dir, { withFileTypes:true }).flatMap((d) => d.isDirectory() ? allJs(path.join(dir, d.name))
    : (/\.js$/.test(d.name) ? [path.join(dir, d.name)] : []));
}

(function main(){
  console.log('== UX-006D1 → AFI-5b PRINCIPAL SELECTION — PRODUCTION ABSENCE + DEV ISOLATION ==');
  console.log('');

  /* ---------- A. the shipped SESSION runtime ---------- */
  const a = loadRuntime(false);
  SELECTOR_NAMES.forEach((n) => check(a.lexical[n] === 'undefined' && a.w[n] === undefined,
    'SESSION: no selector function ' + n + ' is declared or on window'));
  FIXTURE_NAMES.forEach((n) => check(a.lexical[n] === 'undefined' && a.w[n] === undefined,
    'SESSION: no ' + n + ' is declared or on window'));
  check(a.getCurrentUser() === null && a.getCurrentWorkspace() === null, 'SESSION: before /me there is no principal and no workspace');
  check(Object.keys(a.memStore).every(k => !/principal|identity|acting/i.test(k)) && !('identity' in a.State),
    'SESSION: no principal/identity persistence key and no State.identity slice');

  /* ---------- B. source and package ---------- */
  const modules = require(path.join(root,'tools','module-order.js'));
  const indexHtml = fs.readFileSync(path.join(root,'index.html'),'utf8');
  check(!fs.existsSync(path.join(root,'js','ui','identity-selector.js')) && modules.indexOf('ui/identity-selector.js') === -1
    && !/identity-selector/.test(indexHtml), 'source: the selector module is deleted, unregistered and not loaded by index.html');
  const API = /\b(selectPrincipal|getAvailablePrincipals|renderIdentitySelectorHTML|bindIdentitySelector|syncIdentitySelector|identityAvailablePrincipals|onIdentityPrincipalChange|LocalIdentityProvider|FIXTURE_PRINCIPALS)\b|user_ceo_fixture|user_employee_fixture|identityPrincipalSelect|>Acting as</;
  const offenders = allJs(path.join(root,'js')).filter((p) => API.test(code(fs.readFileSync(p,'utf8'))))
    .map((p) => path.relative(root, p).replace(/\\/g, '/'));
  check(offenders.length === 0, 'source: no production js/** file (registered or not) defines or uses the selector, the fixtures or the selection API'
    + (offenders.length ? ' >> ' + offenders.join(', ') : ''));
  const pkgManifest = path.join(root,'dist','package-manifest.json');
  const pkgFiles = fs.existsSync(pkgManifest) ? (JSON.parse(fs.readFileSync(pkgManifest,'utf8')).files || []).map(e => e.path) : [];
  check(pkgFiles.length > 0 && !pkgFiles.some(p => /identity-selector|local-identity-fixture|^dev\/|^tools\//.test(p)),
    'package: the manifest lists no selector, development fixture, dev/ or tools/ file');

  /* ---------- C. development isolation (LOCAL runtime, development identity) ---------- */
  const e = loadRuntime(true);
  const list = e.LocalIdentityProvider.getAvailablePrincipals();
  check(Array.isArray(list) && list.length === 2 && list[0].principalType === 'ceo' && list[1].principalType === 'employee',
    'dev: the alias enumerates exactly two principals, CEO first (deterministic order)');
  check(list.some(p=>p.displayName==='Executive (CEO)') && list.some(p=>p.displayName==='Employee (Sample)'),
    'dev: fixture displayName labels unchanged from v2.11.0');
  check(e.w.LocalIdentityProvider === undefined && e.w.DevLocalIdentity === undefined && e.w.TAM_DEV_LOCAL === undefined,
    'dev: the development identity puts nothing on window');
  check(e.getCurrentUser() === null, 'dev: loading the development identity alone selects nobody (no default CEO)');

  const c = loadRuntime(true);
  c.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  check(c.getCurrentUser() === null, 'dev: a selection has no effect until the alias is installed through the seam');
  c.setIdentityProviderForTesting(c.LocalIdentityProvider);
  const cu = c.getCurrentUser();
  check(!!cu && cu.principalType === 'ceo', 'dev: installed alias + CEO -> getCurrentUser() is CEO');
  const cw = c.getCurrentWorkspace();
  check(!!cw && cw.type === 'executive' && cw.scope === 'ALL_COMPANY', 'dev: CEO -> workspace Executive / ALL_COMPANY');
  check(c.can(c.ACTIONS.EMPLOYEE_CREATE) === true, 'dev: CEO -> authz allows a company mutation (employee.create)');

  const em = loadRuntime(true);
  em.setIdentityProviderForTesting(em.LocalIdentityProvider);
  em.LocalIdentityProvider.selectPrincipal('user_employee_fixture');
  check(!!em.getCurrentUser() && em.getCurrentUser().principalType === 'employee', 'dev: Employee selection resolves to Employee');
  check(em.getCurrentWorkspace() === null, 'dev: unbound Employee -> no workspace (fail-closed, never ALL_COMPANY)');
  check(em.can(em.ACTIONS.EMPLOYEE_CREATE) === false, 'dev: Employee -> authz denies a company mutation');
  const es = loadRuntime(true);
  es.State.employees = [{ id:'emp_fixture_self', fullName:'Sample', employeeId:'E-001' }];
  es.setIdentityProviderForTesting(es.LocalIdentityProvider);
  es.LocalIdentityProvider.selectPrincipal('user_employee_fixture');
  const esw = es.getCurrentWorkspace();
  check(!!esw && esw.type === 'personal' && esw.scope === 'SELF', 'dev: bound Employee -> Personal / SELF workspace');

  const r1 = loadRuntime(true);
  r1.setIdentityProviderForTesting(r1.LocalIdentityProvider);
  r1.LocalIdentityProvider.selectPrincipal('user_ceo_fixture');
  check(!!r1.getCurrentUser() && Object.keys(r1.memStore).every(k => !/principal|identity|acting/i.test(k)),
    'dev: a selection writes NO persistence key');
  check(loadRuntime(true).getCurrentUser() === null, 'dev: a fresh load resets to null (selection not retained)');

  const n = loadRuntime(true);
  n.setIdentityProviderForTesting(n.LocalIdentityProvider);
  check(n.LocalIdentityProvider.selectPrincipal('') === null && n.getCurrentUser() === null, 'dev: empty id leaves the principal null');
  check(n.LocalIdentityProvider.selectPrincipal('nope_unknown') === null && n.getCurrentUser() === null,
    'dev: unknown id is a no-op miss (never a privileged fallback)');

  /* ---------- summary ---------- */
  console.log('');
  if(failures.length){
    console.log('UX-006D1/AFI-5b PRINCIPAL SELECTION ABSENCE RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach(f=>console.log('  - ' + f));
    process.exit(1);
  }
  console.log('UX-006D1/AFI-5b PRINCIPAL SELECTION ABSENCE RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
