#!/usr/bin/env node
'use strict';
/* ============================================================
   AFI-5a — DEVELOPMENT LOCAL IDENTITY RUNTIME VERIFICATION
   ------------------------------------------------------------
   Proves, by executing the REAL, UNCHANGED production modules, that the test-only
   development persona file tools/dev/local-identity-fixture.js reproduces today's
   "Acting as" fixture identity exactly — the precondition for AFI-5b moving the
   fixtures out of js/ — while staying isolated from the application:

     P. PARITY — for the CEO and the Employee persona, and for "no persona", the dev
        file (installed through the internal test seam) and the shipped
        LocalIdentityProvider.selectPrincipal(sameId) yield the same getCurrentUser(),
        getCurrentWorkspace(), getScopedRecords() for all six entity types,
        getScopedRecordById() for every record, and can() for all 21 ACTIONS against
        every fabricated record (and no record).
     I. ISOLATION — on disk the file installs nothing; an unknown persona installs
        nothing (never a CEO); no storage write, no network call, nothing on window;
        the in-memory persona rewrite used by tools/serve-local-dev.js installs at load
        and shows the development banner.
     M. MUTATION SELF-TEST — each seeded defect in the dev file (CEO default, persona
        drift, storage write, use of the shipped selection API, CEO fallback for an
        unknown persona) turns the P/I suite red with counted failures.

   Loader: the dependency-free Node `vm` loader of the UX-006 harnesses — module-order.js
   MINUS core/app-bootstrap.js, then the dev file appended (after core/identity.js, as the
   dev server injects it). All data is fabricated; nothing is written to disk.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const DEV_PATH = path.join(root, 'tools', 'dev', 'local-identity-fixture.js');
const DEV_SRC = fs.readFileSync(DEV_PATH, 'utf8');
const PERSONA_LINE = 'const DEV_PERSONA = null;';
const CEO_ID = 'user_ceo_fixture';
const EMP_ID = 'user_employee_fixture';
const SELF_EID = 'emp_fixture_self';
const OTHER_EID = 'emp_other';
const ENTITY_TYPES = ['employee', 'contract', 'payrollPlan', 'overtime', 'payrollAdjustment', 'transaction'];

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

/* ---------- runtime loader ---------- */
function loadRuntime(devSrc){
  const jsFiles = require(path.join(root, 'tools', 'module-order.js')).filter((f) => f !== 'core/app-bootstrap.js');
  const exportsDev = devSrc !== null
    ? ' TAM_DEV_LOCAL: TAM_DEV_LOCAL, DEV_PERSONA: DEV_PERSONA, DEV_FIXTURE_PRINCIPALS: DEV_FIXTURE_PRINCIPALS, DevLocalIdentity: DevLocalIdentity,'
    : '';
  const src = jsFiles.map((f) => fs.readFileSync(path.join(root, 'js', f), 'utf8')).join('\n')
    + (devSrc !== null ? '\n' + devSrc : '')
    + '\n;window.__TAM__ = { State: State, FIXTURE_PRINCIPALS: FIXTURE_PRINCIPALS, LocalIdentityProvider: LocalIdentityProvider,'
    + exportsDev
    + ' getCurrentUser: getCurrentUser, getCurrentWorkspace: getCurrentWorkspace, getScopedRecords: getScopedRecords,'
    + ' getScopedRecordById: getScopedRecordById, can: can, ACTION_SET: ACTION_SET };';
  const noop = function(){};
  const memStore = {};
  const memStorage = {
    getItem: (k) => Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null,
    setItem: (k, v) => { memStore[k] = String(v); }, removeItem: (k) => { delete memStore[k]; },
    clear: () => { Object.keys(memStore).forEach((k) => { delete memStore[k]; }); }
  };
  const net = { calls: 0 };
  const appended = [];
  const el = () => {
    const attrs = {};
    return { style: {}, dataset: {}, className: '', textContent: '', innerHTML: '', attrs: attrs,
      addEventListener: noop, removeEventListener: noop, appendChild: noop, remove: noop,
      setAttribute: (k, v) => { attrs[k] = String(v); }, getAttribute: (k) => (k in attrs ? attrs[k] : null),
      querySelector: () => null, querySelectorAll: () => [] };
  };
  const sandbox = {
    console: { log: noop, warn: noop, error: noop }, navigator: { userAgent: 'tam-afi5a' },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, sessionStorage: memStorage, storage: undefined,
    fetch: function(){ net.calls++; return Promise.reject(new Error('no network in this harness')); },
    addEventListener: noop, removeEventListener: noop, confirm: () => true,
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    document: { readyState: 'complete', addEventListener: noop, removeEventListener: noop, getElementById: () => el(),
      querySelector: () => null, querySelectorAll: () => [], createElement: () => el(),
      body: { appendChild: (n) => { appended.push(n); } }, documentElement: { dataset: {} } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInContext(src, vm.createContext(sandbox), { filename: 'tam-afi5a-runtime.js' });
  const rt = sandbox.__TAM__;
  rt.w = sandbox; rt.memStore = memStore; rt.net = net; rt.appended = appended;
  return rt;
}

/* ---------- fabricated state: all six scoped entity types, own and foreign rows ---------- */
function seed(rt){
  const S = rt.State;
  S.employees = [{ id: SELF_EID, employeeId: 'EMP-001', fullName: 'SAMPLE — Self' },
                 { id: OTHER_EID, employeeId: 'EMP-002', fullName: 'SAMPLE — Other' }];
  S.contracts = [{ id: 'c_self', employeeId: SELF_EID }, { id: 'c_other', employeeId: OTHER_EID }];
  S.payrollPlans = [{ id: 'p_self', employeeId: SELF_EID, status: 'draft' }, { id: 'p_other', employeeId: OTHER_EID, status: 'draft' }];
  S.overtimeRecords = [
    { id: 'ot_self_draft', employeeId: SELF_EID, status: 'Draft' },
    { id: 'ot_self_submitted', employeeId: SELF_EID, status: 'Submitted' },
    { id: 'ot_other_draft', employeeId: OTHER_EID, status: 'Draft' }
  ];
  S.payrollAdjustments = [{ id: 'adj_self', employeeId: SELF_EID }, { id: 'adj_other', employeeId: OTHER_EID }];
  S.txns = [{ id: 't_self', employeeId: SELF_EID, type: 'expense' }, { id: 't_other', employeeId: OTHER_EID, type: 'expense' },
            { id: 't_company', type: 'expense' }];
  return S;
}
function allRecords(S){
  return [].concat(S.employees, S.contracts, S.payrollPlans, S.overtimeRecords, S.payrollAdjustments, S.txns);
}
const json = (v) => JSON.stringify(v === undefined ? null : v);
const ids = (list) => json((list || []).map((r) => r && r.id));

/* Baseline: today's shipped adapter. Dev: the dev file through the test seam. */
function baseline(personaId){
  const rt = loadRuntime(null); seed(rt);
  if(personaId) rt.LocalIdentityProvider.selectPrincipal(personaId);
  return rt;
}
function dev(devSrc, personaId){
  const rt = loadRuntime(devSrc); seed(rt);
  if(personaId) rt.DevLocalIdentity.install(personaId);
  return rt;
}

/* The P + I suite against a given dev source. `chk` collects results. */
function suite(devSrc, chk){
  /* ---------- P0. persona definitions ---------- */
  const b0 = baseline(null), d0 = dev(devSrc, null);
  chk(json(d0.DEV_FIXTURE_PRINCIPALS) === json(b0.FIXTURE_PRINCIPALS),
    'P0. DEV_FIXTURE_PRINCIPALS deep-equals the shipped FIXTURE_PRINCIPALS (ids, names, types, employee binding, order)');
  chk(json(d0.DevLocalIdentity.principals()) === json(b0.LocalIdentityProvider.getAvailablePrincipals()),
    'P0. DevLocalIdentity.principals() equals LocalIdentityProvider.getAvailablePrincipals()');

  /* ---------- P1..P3. parity per persona (and no persona) ---------- */
  [['P1', 'CEO', CEO_ID], ['P2', 'Employee', EMP_ID], ['P3', 'no persona', null]].forEach(function(p){
    const tag = p[0], name = p[1], id = p[2];
    const b = baseline(id), d = dev(devSrc, id);
    chk(json(d.getCurrentUser()) === json(b.getCurrentUser()), tag + '. ' + name + ': getCurrentUser() identical');
    chk(json(d.getCurrentWorkspace()) === json(b.getCurrentWorkspace()), tag + '. ' + name + ': getCurrentWorkspace() identical');
    ENTITY_TYPES.forEach(function(t){
      chk(ids(d.getScopedRecords(t)) === ids(b.getScopedRecords(t)), tag + '. ' + name + ': getScopedRecords(' + t + ') identical');
    });
    const recs = allRecords(b.State);
    const byIdOk = ENTITY_TYPES.every(function(t){
      return recs.every(function(r){ return json(d.getScopedRecordById(t, r.id)) === json(b.getScopedRecordById(t, r.id)); });
    });
    chk(byIdOk, tag + '. ' + name + ': getScopedRecordById() identical for every record and entity type');
    chk(b.ACTION_SET.length === 21 && json(d.ACTION_SET) === json(b.ACTION_SET), tag + '. ' + name + ': the same 21 ACTIONS');
    const resources = [undefined].concat(recs);
    // Non-vacuity: the parity below compares real decisions, not two empty answers.
    const allowed = b.ACTION_SET.reduce((n, act) => n + resources.filter((r) => b.can(act, r) === true).length, 0);
    const scoped = ENTITY_TYPES.reduce((n, t) => n + b.getScopedRecords(t).length, 0);
    chk(id === CEO_ID ? (allowed > 0 && scoped === recs.length)
      : id === EMP_ID ? (allowed > 0 && scoped > 0 && scoped < recs.length)
      : (allowed === 0 && scoped === 0),
      tag + '. ' + name + ': non-vacuous baseline (' + allowed + ' allowed decisions, ' + scoped + ' scoped records)');
    b.ACTION_SET.forEach(function(act){
      const diff = resources.filter(function(r){ return d.can(act, r) !== b.can(act, r); });
      chk(diff.length === 0, tag + '. ' + name + ': can(' + act + ') identical over ' + resources.length + ' resources'
        + (diff.length ? ' >> differs for ' + diff.map((r) => r ? r.id : '(none)').join(', ') : ''));
    });
  });

  /* ---------- I. isolation ---------- */
  const raw = dev(devSrc, null);
  chk(raw.DEV_PERSONA === null && raw.DevLocalIdentity.current() === null && raw.getCurrentUser() === null,
    'I1. loaded as on disk: DEV_PERSONA is null, nothing installed, getCurrentUser() null (no default CEO)');
  chk(raw.appended.length === 0, 'I1. loaded as on disk: no development banner');
  raw.LocalIdentityProvider.selectPrincipal(EMP_ID);
  chk(json(raw.getCurrentUser()) === json(baseline(EMP_ID).getCurrentUser()),
    'I2. loaded as on disk the shipped "Acting as" adapter behaves exactly as today');
  const unk = dev(devSrc, null);
  chk(unk.DevLocalIdentity.install('user_unknown') === null && unk.DevLocalIdentity.install('') === null
    && unk.DevLocalIdentity.install(undefined) === null && unk.getCurrentUser() === null && unk.DevLocalIdentity.current() === null,
    'I3. an unknown, empty or missing persona installs nothing and never yields a principal');
  const seamWins = dev(devSrc, CEO_ID);
  seamWins.LocalIdentityProvider.selectPrincipal(EMP_ID);
  chk(seamWins.getCurrentUser() && seamWins.getCurrentUser().id === CEO_ID,
    'I4. an installed dev persona is held by the test seam (the shipped selection cannot replace it)');
  const io = dev(devSrc, CEO_ID); io.DevLocalIdentity.install(EMP_ID);
  ENTITY_TYPES.forEach((t) => io.getScopedRecords(t));
  const ioBase = baseline(CEO_ID); ioBase.LocalIdentityProvider.selectPrincipal(EMP_ID);
  ENTITY_TYPES.forEach((t) => ioBase.getScopedRecords(t));
  chk(json(io.memStore) === json(ioBase.memStore), 'I5. no storage write beyond what the unchanged application does');
  chk(io.net.calls === 0, 'I6. no network call');
  chk(io.w.DevLocalIdentity === undefined && io.w.TAM_DEV_LOCAL === undefined && io.w.DEV_FIXTURE_PRINCIPALS === undefined
    && io.w.DEV_PERSONA === undefined, 'I7. nothing from the dev file is attached to window');
  chk(devSrc.split(PERSONA_LINE).length === 2, 'I8. the persona line occurs exactly once (the dev server rewrites exactly it)');
  [['ceo', CEO_ID], ['employee', EMP_ID]].forEach(function(p){
    const rw = dev(devSrc.replace(PERSONA_LINE, 'const DEV_PERSONA = ' + JSON.stringify(p[1]) + ';'), null);
    const banner = rw.appended.filter((n) => n && n.getAttribute && n.getAttribute('data-dev-local') === 'true');
    chk(rw.getCurrentUser() && rw.getCurrentUser().id === p[1] && json(rw.getCurrentUser()) === json(baseline(p[1]).getCurrentUser()),
      'I9. dev-server rewrite --as ' + p[0] + ': the persona is installed at load and equals the shipped fixture');
    chk(banner.length === 1 && /^DEVELOPMENT — LOCAL DATA — NOT AUTHENTICATED/.test(banner[0].textContent),
      'I9. dev-server rewrite --as ' + p[0] + ': exactly one development banner');
  });
}

(function main(){
  console.log('== AFI-5a DEVELOPMENT LOCAL IDENTITY — RUNTIME VERIFICATION ==');
  console.log('   Dev persona parity with "Acting as" (2 personas + none, 6 entity types, 21 ACTIONS),');
  console.log('   isolation (no default, no storage, no network, not on window), mutation self-test.');
  console.log('');

  suite(DEV_SRC, check);

  /* ---------- M. mutation self-test ---------- */
  console.log('');
  console.log('-- M. mutation self-test (each mutant must be caught) --');
  const MUTANTS = [
    ['M1. CEO default when no persona is set', (s) => s.replace(PERSONA_LINE, "const DEV_PERSONA = 'user_ceo_fixture';")],
    ['M2. persona drift (CEO display name)', (s) => s.replace("displayName: 'Executive (CEO)'", "displayName: 'Executive'")],
    ['M3. persona drift (Employee binding)', (s) => s.replace("employeeId: 'emp_fixture_self' })", "employeeId: 'emp_other' })")],
    ['M4. storage write on install', (s) => s.replace('installed = u;', "installed = u; localStorage.setItem('tam_dev_persona', id);")],
    ['M5. shipped selection API instead of the seam', (s) => s.replace('setIdentityProviderForTesting(provider);', 'LocalIdentityProvider.selectPrincipal(id);')],
    ['M6. CEO fallback for an unknown persona', (s) => s.replace('if(!u) return null;', 'if(!u){ installed = DEV_FIXTURE_PRINCIPALS[0]; setIdentityProviderForTesting(provider); return null; }')]
  ];
  MUTANTS.forEach(function(m){
    const mutated = m[1](DEV_SRC);
    if(mutated === DEV_SRC){ check(false, m[0] + ' — mutation did not apply (harness out of date)'); return; }
    const red = [];
    try { suite(mutated, function(c, label){ if(!c) red.push(label); }); }
    catch(e){ red.push('threw: ' + (e && e.message)); }
    check(red.length > 0, m[0] + ' — caught (' + red.length + ' failing)');
  });

  /* ---------- summary ---------- */
  console.log('');
  if(failures.length){
    console.log('AFI-5a DEV LOCAL IDENTITY RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('AFI-5a DEV LOCAL IDENTITY RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
