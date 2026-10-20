#!/usr/bin/env node
'use strict';
/* ============================================================
   AFI-5a / AFI-5b — DEVELOPMENT LOCAL IDENTITY RUNTIME VERIFICATION
   ------------------------------------------------------------
   AFI-5b moved the fixture identity out of js/: the application ships SESSION and no
   fixtures, and tools/dev/local-identity-fixture.js is the only home of the development
   persona and of its LocalIdentityProvider compatibility alias (design Rev 1.2 D-02).
   This harness proves that persona still reproduces the v2.11.0 "Acting as" identity
   exactly, against an INDEPENDENT oracle, and that it stays isolated:

     V. PROVENANCE (design Rev 1.2.1 R-2) — before any parity claim. The oracle
        tools/fixtures/afi5-identity-baseline-36ec46b.json must match its frozen SHA-256
        pin; its identity.js and its three reference modules (constants.js, workspace.js,
        authz.js) must match their frozen SHA-256 pins AND re-hash to their baseline Git
        blob ids (computed here, offline). The candidate workspace.js and authz.js must be
        byte-identical (raw SHA-256) to the pinned baseline; the candidate constants.js must
        hold exactly one AUTH_MODE assignment, SESSION. Any failure stops here: the parity
        below is not evaluated, so it can never print a green result over a drifted input.
     P. PARITY — two ISOLATED vm contexts sharing only fabricated inputs (the same State
        content, injected as independent deep copies — Forge note N-1):
          reference = the oracle's baseline constants.js (LOCAL, unchanged), identity.js,
                      workspace.js and authz.js, persona chosen with the baseline adapter;
          candidate = the tree's constants.js rewritten to LOCAL once in memory, the
                      revised identity.js + the development file, workspace.js and authz.js,
                      persona installed with DevLocalIdentity.install.
        For CEO, Employee, no persona and unknown-after-valid: getCurrentUser(),
        getCurrentWorkspace(), getScopedRecords() for six entity types,
        getScopedRecordById() for every record and can() for all 21 ACTIONS.
     I. ISOLATION — on disk the file installs nothing and selects nobody; unknown personas
        install nothing; copies are defensive; nothing on window; no storage write; no
        network; the dev-server persona rewrite installs at load with one banner.
     M. MUTATION SELF-TEST — seeded defects in the development file (D-02) and in the
        oracle/candidate inputs (R-2) each turn the suite red with counted failures.

   No git, network or disk write at run time; all data is fabricated.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const DEV_PATH = path.join(root, 'tools', 'dev', 'local-identity-fixture.js');
const DEV_SRC = fs.readFileSync(DEV_PATH, 'utf8');
const ORACLE_PATH = path.join(root, 'tools', 'fixtures', 'afi5-identity-baseline-36ec46b.json');
const ORACLE_BUF = fs.readFileSync(ORACLE_PATH);
const PERSONA_LINE = 'const DEV_PERSONA = null;';
const CEO_ID = 'user_ceo_fixture';
const EMP_ID = 'user_employee_fixture';
const SELF_EID = 'emp_fixture_self';
const OTHER_EID = 'emp_other';
const ENTITY_TYPES = ['employee', 'contract', 'payrollPlan', 'overtime', 'payrollAdjustment', 'transaction'];

/* Frozen pins (design Rev 1.2.1 R-2) — never regenerated to make parity green. */
const PINS = Object.freeze({
  oracleSha256: 'd5ea9f80b5a71fdc8a7d598d68c6a27a04968abc5e9e1bcc56e81050cf5ffef8',
  format: 'afi5-baseline-identity-oracle/v1',
  baselineCommit: '36ec46bf8d5b5450dc9095603211cc5b57df9f46',
  modules: Object.freeze({
    'js/core/identity.js':  { blob: 'cc97da608c7c1feb93a5329d27744798a8e2ca66', sha256: 'ceb8ebcb348ccea2260bd3d559d77a7a2a2613b37fc0251c2b3176c8d67ede32' },
    'js/core/constants.js': { blob: 'a371779070d1715ba4cf4019fbe75b8b8c991929', sha256: 'ad639d797de84243abc0291a21539c2db7811d38b19defc9d93dbfee12d70141' },
    'js/core/workspace.js': { blob: 'a49a13d73ec3035aafbac0b0fbaada1e6e07a758', sha256: 'b2ce20aab542d3cc1fe21a8bd3c162fb146614882286bb3e3829891609d6376d' },
    'js/core/authz.js':     { blob: '200a22ff9522ca126a8054c8e720e05f18ca812d', sha256: 'fa449d17a34fc4863fb67155cce14f4db54fb116b80225bb3138c4324ba1ec05' }
  })
});
const REFERENCE_PATHS = ['js/core/constants.js', 'js/core/workspace.js', 'js/core/authz.js'];

let passed = 0; const failures = [];
function check(cond, label){
  if(cond){ passed++; console.log('  [PASS] ' + label); }
  else { failures.push(label); console.log('  [FAIL] ' + label); }
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const gitBlob = (buf) => crypto.createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex');
const modeAssigns = (src) => src.match(/const AUTH_MODE = [^;\n]+;/g) || [];
const readTree = (rel) => fs.readFileSync(path.join(root, rel));

/* ---------- inputs: the oracle, and the candidate tree ---------- */
function treeInputs(){
  return {
    constants: readTree('js/core/constants.js'), identity: readTree('js/core/identity.js'),
    workspace: readTree('js/core/workspace.js'), authz: readTree('js/core/authz.js'),
    peopleCore: readTree('js/people/people-core.js').toString('utf8')
  };
}
const EMP_BY_ID_LINE = 'function empById(id){ return State.employees.find(e=>e.id===id); }';

/* V. Provenance. Returns { ok, ref, cand } — ref/cand are the four sources as strings. */
function provenance(oracleBuf, tree, chk){
  let ok = true;
  const v = (cond, label) => { chk(cond, label); if(!cond) ok = false; };
  v(sha256(oracleBuf) === PINS.oracleSha256, 'V1. the oracle file matches its frozen SHA-256 pin');
  let o = null;
  try { o = JSON.parse(oracleBuf.toString('utf8')); } catch(e){ o = null; }
  v(!!o && o.format === PINS.format && o.baselineCommit === PINS.baselineCommit && o.sourcePath === 'js/core/identity.js',
    'V2. the oracle declares the v1 format, the 36ec46b baseline and js/core/identity.js');
  if(!o) return { ok: false };
  const idBuf = Buffer.from(String(o.sourceUtf8 || ''), 'utf8');
  const idPin = PINS.modules['js/core/identity.js'];
  v(o.sourceEncoding === 'UTF-8' && sha256(idBuf) === idPin.sha256 && gitBlob(idBuf) === idPin.blob
    && o.sourceSha256 === idPin.sha256 && o.sourceGitBlob === idPin.blob,
    'V3. the oracle identity.js matches its pinned SHA-256 and re-hashes to its baseline Git blob');
  const refs = Array.isArray(o.referenceModules) ? o.referenceModules : [];
  const refPaths = refs.map((m) => m && m.path);
  v(refs.length === 3 && REFERENCE_PATHS.every((p) => refPaths.filter((x) => x === p).length === 1),
    'V4. the oracle holds exactly the three reference modules (constants, workspace, authz), no duplicate, missing or extra entry');
  const ref = { identity: idBuf.toString('utf8') };
  REFERENCE_PATHS.forEach(function(p){
    const m = refs.find((x) => x && x.path === p) || {};
    const buf = Buffer.from(String(m.sourceUtf8 || ''), 'utf8');
    const pin = PINS.modules[p];
    v(m.sourceEncoding === 'UTF-8' && m.baselineCommit === PINS.baselineCommit && sha256(buf) === pin.sha256
      && gitBlob(buf) === pin.blob && m.sourceSha256 === pin.sha256 && m.sourceGitBlob === pin.blob,
      'V5. reference ' + p + ' matches its pinned SHA-256 and re-hashes to its baseline Git blob');
    ref[path.basename(p, '.js')] = buf.toString('utf8');
  });
  v(modeAssigns(ref.constants || '').length === 1 && modeAssigns(ref.constants || '')[0] === 'const AUTH_MODE = AUTH_MODES.LOCAL;',
    'V6. the reference constants.js holds exactly one AUTH_MODE assignment, LOCAL (loaded unchanged)');
  v(sha256(tree.workspace) === PINS.modules['js/core/workspace.js'].sha256 && sha256(tree.authz) === PINS.modules['js/core/authz.js'].sha256,
    'V7. the candidate workspace.js and authz.js are byte-identical (raw SHA-256) to the pinned baseline');
  const cc = tree.constants.toString('utf8');
  v(modeAssigns(cc).length === 1 && modeAssigns(cc)[0] === 'const AUTH_MODE = AUTH_MODES.SESSION;',
    'V8. the candidate constants.js holds exactly one AUTH_MODE assignment, SESSION (the shipped default)');
  v((tree.peopleCore || '').split(EMP_BY_ID_LINE).length === 2,
    'V9. the injected empById resolver is the application\'s own line (js/people/people-core.js), unchanged');
  const cand = {
    constants: modeAssigns(cc).length === 1 ? cc.replace(modeAssigns(cc)[0], 'const AUTH_MODE = AUTH_MODES.LOCAL;') : cc,
    identity: tree.identity.toString('utf8'), workspace: tree.workspace.toString('utf8'), authz: tree.authz.toString('utf8')
  };
  return { ok: ok, ref: ref, cand: cand };
}

/* ---------- fabricated state: all six scoped entity types, own and foreign rows ---------- */
function seedState(){
  return {
    employees: [{ id: SELF_EID, employeeId: 'EMP-001', fullName: 'SAMPLE — Self' },
                { id: OTHER_EID, employeeId: 'EMP-002', fullName: 'SAMPLE — Other' }],
    contracts: [{ id: 'c_self', employeeId: SELF_EID }, { id: 'c_other', employeeId: OTHER_EID }],
    payrollPlans: [{ id: 'p_self', employeeId: SELF_EID, status: 'draft' }, { id: 'p_other', employeeId: OTHER_EID, status: 'draft' }],
    overtimeRecords: [
      { id: 'ot_self_draft', employeeId: SELF_EID, status: 'Draft' },
      { id: 'ot_self_submitted', employeeId: SELF_EID, status: 'Submitted' },
      { id: 'ot_other_draft', employeeId: OTHER_EID, status: 'Draft' }
    ],
    payrollAdjustments: [{ id: 'adj_self', employeeId: SELF_EID }, { id: 'adj_other', employeeId: OTHER_EID }],
    txns: [{ id: 't_self', employeeId: SELF_EID, type: 'expense' }, { id: 't_other', employeeId: OTHER_EID, type: 'expense' },
           { id: 't_company', type: 'expense' }]
  };
}
function allRecords(S){
  return [].concat(S.employees, S.contracts, S.payrollPlans, S.overtimeRecords, S.payrollAdjustments, S.txns);
}
const json = (v) => JSON.stringify(v === undefined ? null : v);
const ids = (list) => json((list || []).map((r) => r && r.id));

/* ---------- sandboxes ---------- */
function sandboxFor(state, tag){
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
    console: { log: noop, warn: noop, error: noop }, navigator: { userAgent: 'tam-afi5b-' + tag },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    localStorage: memStorage, sessionStorage: memStorage, storage: undefined,
    fetch: function(){ net.calls++; return Promise.reject(new Error('no network in this harness')); },
    addEventListener: noop, removeEventListener: noop, confirm: () => true,
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    document: { readyState: 'complete', addEventListener: noop, removeEventListener: noop, getElementById: () => el(),
      querySelector: () => null, querySelectorAll: () => [], createElement: () => el(),
      body: { appendChild: (n) => { appended.push(n); } }, documentElement: { dataset: {} } }
  };
  if(state){
    // N-1: injected fabricated input, identical in both contexts. workspace.js binds an
    // Employee through the raw resolver empById (js/people/people-core.js, outside the
    // pinned module set); the same one-line resolver is injected here (V9 proves it is
    // the application's own line, so the binding is real and the parity non-vacuous).
    sandbox.State = state;
    sandbox.empById = function(id){ return sandbox.State.employees.find((e) => e.id === id); };
  }
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  return { sandbox: sandbox, memStore: memStore, net: net, appended: appended };
}
const COMMON_EXPORTS = ' getCurrentUser: getCurrentUser, getCurrentWorkspace: getCurrentWorkspace, getScopedRecords: getScopedRecords,'
  + ' getScopedRecordById: getScopedRecordById, can: can, ACTION_SET: ACTION_SET';
function run(src, box, filename){
  vm.runInContext(src, vm.createContext(box.sandbox), { filename: filename });
  const rt = box.sandbox.__TAM__;
  rt.w = box.sandbox; rt.memStore = box.memStore; rt.net = box.net; rt.appended = box.appended;
  return rt;
}

/* Reference: the oracle's four baseline modules only (no candidate byte). */
function reference(ref, personaId){
  const S = JSON.parse(JSON.stringify(seedState()));
  const src = [ref.constants, ref.identity, ref.workspace, ref.authz].join('\n')
    + '\n;window.__TAM__ = { FIXTURE_PRINCIPALS: FIXTURE_PRINCIPALS, LocalIdentityProvider: LocalIdentityProvider,' + COMMON_EXPORTS + ' };';
  const rt = run(src, sandboxFor(S, 'reference'), 'afi5b-reference.js');
  rt.S = S;
  if(personaId) rt.LocalIdentityProvider.selectPrincipal(personaId);
  return rt;
}
/* Candidate: the same four module paths from the tree, LOCAL in memory, plus the dev file. */
function candidate(cand, devSrc, personaId){
  const S = JSON.parse(JSON.stringify(seedState()));
  const src = [cand.constants, cand.identity + '\n' + devSrc, cand.workspace, cand.authz].join('\n')
    + '\n;window.__TAM__ = { LocalIdentityProvider: LocalIdentityProvider, DevLocalIdentity: DevLocalIdentity,'
    + ' DEV_PERSONA: DEV_PERSONA, DEV_FIXTURE_PRINCIPALS: DEV_FIXTURE_PRINCIPALS, TAM_DEV_LOCAL: TAM_DEV_LOCAL,'
    + ' localDevReady: localDevReady, setIdentityProviderForTesting: setIdentityProviderForTesting,'
    + ' productionFixture: typeof FIXTURE_PRINCIPALS,' + COMMON_EXPORTS + ' };';
  const rt = run(src, sandboxFor(S, 'candidate'), 'afi5b-candidate.js');
  rt.S = S;
  if(personaId) rt.DevLocalIdentity.install(personaId);
  return rt;
}
/* Full application (isolation only): module-order minus bootstrap, LOCAL in memory, dev file. */
function fullApp(devSrc){
  const jsFiles = require(path.join(root, 'tools', 'module-order.js')).filter((f) => f !== 'core/app-bootstrap.js');
  const src = jsFiles.map(function(f){
      let s = fs.readFileSync(path.join(root, 'js', f), 'utf8');
      if(f === 'core/constants.js'){
        const a = modeAssigns(s);
        if(a.length !== 1) throw new Error('expected exactly one AUTH_MODE assignment');
        s = s.replace(a[0], 'const AUTH_MODE = AUTH_MODES.LOCAL;');
      }
      return f === 'core/identity.js' ? s + '\n' + devSrc : s;
    }).join('\n')
    + '\n;window.__TAM__ = { State: State, DevLocalIdentity: DevLocalIdentity, LocalIdentityProvider: LocalIdentityProvider,' + COMMON_EXPORTS + ' };';
  return run(src, sandboxFor(null, 'full'), 'afi5b-full.js');
}

/* The V + P + I suite. `o` = { oracleBuf, tree, devSrc, refOverride }. */
function suite(o, chk){
  const pv = provenance(o.oracleBuf, o.tree, chk);
  if(!pv.ok){
    chk(false, 'P. parity NOT evaluated: provenance failed (no parity result is reported over drifted inputs)');
    return;
  }
  const ref = o.refOverride ? o.refOverride(pv) : pv.ref;
  const devSrc = o.devSrc;

  /* ---------- P0. persona definitions and oracle independence ---------- */
  const r0 = reference(ref, null), c0 = candidate(pv.cand, devSrc, null);
  chk(r0.w !== c0.w && r0.LocalIdentityProvider !== c0.LocalIdentityProvider && typeof r0.FIXTURE_PRINCIPALS === 'object'
    && c0.productionFixture === 'undefined' && sha256(Buffer.from(ref.identity, 'utf8')) === PINS.modules['js/core/identity.js'].sha256,
    'P0. independence: the reference runs the pinned baseline identity.js in its own context; the candidate production identity ships no fixture');
  chk(json(c0.DEV_FIXTURE_PRINCIPALS) === json(r0.FIXTURE_PRINCIPALS),
    'P0. DEV_FIXTURE_PRINCIPALS deep-equals the baseline FIXTURE_PRINCIPALS (ids, names, types, employee binding, order)');
  chk(json(c0.DevLocalIdentity.principals()) === json(r0.LocalIdentityProvider.getAvailablePrincipals())
    && json(c0.LocalIdentityProvider.getAvailablePrincipals()) === json(r0.LocalIdentityProvider.getAvailablePrincipals()),
    'P0. the alias and DevLocalIdentity enumerate exactly the baseline principals');

  /* ---------- P1..P4. parity per persona sequence ---------- */
  const SEQ = [['P1', 'CEO', [CEO_ID]], ['P2', 'Employee', [EMP_ID]], ['P3', 'no persona', []],
               ['P4', 'unknown after CEO', [CEO_ID, 'user_unknown']]];
  SEQ.forEach(function(p){
    const tag = p[0], name = p[1], seq = p[2];
    const b = reference(ref, null), d = candidate(pv.cand, devSrc, null);
    seq.forEach(function(id){ b.LocalIdentityProvider.selectPrincipal(id); d.DevLocalIdentity.install(id); });
    chk(json(d.getCurrentUser()) === json(b.getCurrentUser()), tag + '. ' + name + ': getCurrentUser() identical');
    chk(json(d.getCurrentWorkspace()) === json(b.getCurrentWorkspace()), tag + '. ' + name + ': getCurrentWorkspace() identical');
    ENTITY_TYPES.forEach(function(t){
      chk(ids(d.getScopedRecords(t)) === ids(b.getScopedRecords(t)), tag + '. ' + name + ': getScopedRecords(' + t + ') identical');
    });
    const recs = allRecords(b.S);
    const byIdOk = ENTITY_TYPES.every(function(t){
      return recs.every(function(r){ return json(d.getScopedRecordById(t, r.id)) === json(b.getScopedRecordById(t, r.id)); });
    });
    chk(byIdOk, tag + '. ' + name + ': getScopedRecordById() identical for every record and entity type');
    chk(b.ACTION_SET.length === 21 && json(d.ACTION_SET) === json(b.ACTION_SET), tag + '. ' + name + ': the same 21 ACTIONS');
    const resources = [undefined].concat(recs);
    const resourcesD = [undefined].concat(allRecords(d.S));
    // Non-vacuity: the parity below compares real decisions, not two empty answers.
    const allowed = b.ACTION_SET.reduce((n, act) => n + resources.filter((r) => b.can(act, r) === true).length, 0);
    const scoped = ENTITY_TYPES.reduce((n, t) => n + b.getScopedRecords(t).length, 0);
    const first = seq[0];
    chk(first === CEO_ID ? (allowed > 0 && scoped === recs.length)
      : first === EMP_ID ? (allowed > 0 && scoped > 0 && scoped < recs.length)
      : (allowed === 0 && scoped === 0),
      tag + '. ' + name + ': non-vacuous baseline (' + allowed + ' allowed decisions, ' + scoped + ' scoped records)');
    b.ACTION_SET.forEach(function(act){
      const diff = resources.filter(function(r, i){ return d.can(act, resourcesD[i]) !== b.can(act, r); });
      chk(diff.length === 0, tag + '. ' + name + ': can(' + act + ') identical over ' + resources.length + ' resources'
        + (diff.length ? ' >> differs for ' + diff.map((r) => r ? r.id : '(none)').join(', ') : ''));
    });
  });

  /* ---------- I. isolation ---------- */
  const raw = candidate(pv.cand, devSrc, null);
  chk(raw.DEV_PERSONA === null && raw.DevLocalIdentity.current() === null && raw.getCurrentUser() === null && raw.localDevReady() === false,
    'I1. loaded as on disk: DEV_PERSONA is null, nobody selected, getCurrentUser() null, not ready (no default CEO)');
  chk(raw.appended.length === 0, 'I1. loaded as on disk: no development banner');
  raw.LocalIdentityProvider.selectPrincipal(CEO_ID);
  chk(raw.getCurrentUser() === null && raw.localDevReady() === false,
    'I2. loaded as on disk the alias is NOT installed: a selection alone changes nothing canonical (zero load-time seam calls)');
  const unk = candidate(pv.cand, devSrc, null);
  chk(unk.DevLocalIdentity.install('user_unknown') === null && unk.DevLocalIdentity.install('') === null
    && unk.DevLocalIdentity.install(undefined) === null && unk.getCurrentUser() === null && unk.DevLocalIdentity.current() === null,
    'I3. an unknown, empty or missing persona installs nothing and never yields a principal');
  const keep = candidate(pv.cand, devSrc, CEO_ID);
  chk(keep.DevLocalIdentity.install('user_unknown') === null && keep.getCurrentUser() && keep.getCurrentUser().id === CEO_ID,
    'I4. an unknown install after a valid one keeps the valid persona and the installed provider');
  const sel = candidate(pv.cand, devSrc, null);
  sel.LocalIdentityProvider.selectPrincipal(EMP_ID);
  chk(sel.LocalIdentityProvider.selectPrincipal('user_unknown') === null && sel.LocalIdentityProvider.selectPrincipal(null) === null
    && sel.LocalIdentityProvider.getCurrentUser() && sel.LocalIdentityProvider.getCurrentUser().id === EMP_ID,
    'I10. the alias: an unknown or null selection returns null and leaves the previous selection unchanged');
  const cp = candidate(pv.cand, devSrc, CEO_ID);
  const u1 = cp.getCurrentUser(), u2 = cp.getCurrentUser();
  const l1 = cp.LocalIdentityProvider.getAvailablePrincipals(), l2 = cp.LocalIdentityProvider.getAvailablePrincipals();
  chk(u1 !== u2 && !Object.isFrozen(u1) && l1 !== l2 && l1[0] !== l2[0] && !Object.isFrozen(l1[0])
    && cp.LocalIdentityProvider.selectPrincipal(CEO_ID) !== cp.LocalIdentityProvider.selectPrincipal(CEO_ID),
    'I11. every principal handed out is a fresh, mutable copy (never the frozen fixture)');
  l1[0].displayName = 'MUTATED';
  chk(cp.LocalIdentityProvider.getAvailablePrincipals()[0].displayName === 'Executive (CEO)', 'I11. mutating a returned copy cannot corrupt the fixtures');
  const io = fullApp(devSrc);
  const before = json(io.memStore);
  io.DevLocalIdentity.install(CEO_ID); io.DevLocalIdentity.install(EMP_ID);
  ENTITY_TYPES.forEach((t) => io.getScopedRecords(t));
  chk(json(io.memStore) === before, 'I5. full application: installing and reading writes nothing to storage');
  chk(io.net.calls === 0, 'I6. full application: no network call');
  chk(io.w.DevLocalIdentity === undefined && io.w.TAM_DEV_LOCAL === undefined && io.w.DEV_FIXTURE_PRINCIPALS === undefined
    && io.w.DEV_PERSONA === undefined && io.w.LocalIdentityProvider === undefined, 'I7. nothing from the dev file is attached to window');
  chk(devSrc.split(PERSONA_LINE).length === 2, 'I8. the persona line occurs exactly once (the dev server rewrites exactly it)');
  [['ceo', CEO_ID], ['employee', EMP_ID]].forEach(function(p){
    const rw = candidate(pv.cand, devSrc.replace(PERSONA_LINE, 'const DEV_PERSONA = ' + JSON.stringify(p[1]) + ';'), null);
    const banner = rw.appended.filter((n) => n && n.getAttribute && n.getAttribute('data-dev-local') === 'true');
    chk(rw.getCurrentUser() && rw.getCurrentUser().id === p[1] && json(rw.getCurrentUser()) === json(reference(ref, p[1]).getCurrentUser())
      && rw.localDevReady() === true,
      'I9. dev-server rewrite --as ' + p[0] + ': the persona is installed at load, equals the baseline fixture, and is ready');
    chk(banner.length === 1 && /^DEVELOPMENT — LOCAL DATA — NOT AUTHENTICATED/.test(banner[0].textContent),
      'I9. dev-server rewrite --as ' + p[0] + ': exactly one development banner');
  });
}

(function main(){
  console.log('== AFI-5a/AFI-5b DEVELOPMENT LOCAL IDENTITY — RUNTIME VERIFICATION ==');
  console.log('   Provenance (pinned oracle), parity with the baseline adapter (2 personas + none + unknown,');
  console.log('   6 entity types, 21 ACTIONS), isolation, mutation self-test.');
  console.log('');

  const base = { oracleBuf: ORACLE_BUF, tree: treeInputs(), devSrc: DEV_SRC };
  suite(base, check);

  /* ---------- M. mutation self-test ---------- */
  console.log('');
  console.log('-- M. mutation self-test (each mutant must be caught) --');
  const devMut = (fn) => Object.assign({}, base, { devSrc: fn(DEV_SRC) });
  const oracleMut = (fn) => { const j = JSON.parse(ORACLE_BUF.toString('utf8')); fn(j);
    return Object.assign({}, base, { oracleBuf: Buffer.from(JSON.stringify(j, null, 2) + '\n', 'utf8') }); };
  const treeMut = (key, fn) => { const t = Object.assign({}, base.tree); t[key] = Buffer.from(fn(t[key].toString('utf8')), 'utf8');
    return Object.assign({}, base, { tree: t }); };
  const MUTANTS = [
    ['M1. CEO default when no persona is set', devMut((s) => s.replace(PERSONA_LINE, "const DEV_PERSONA = 'user_ceo_fixture';"))],
    ['M2. persona drift (CEO display name)', devMut((s) => s.replace("displayName: 'Executive (CEO)'", "displayName: 'Executive'"))],
    ['M3. persona drift (Employee binding)', devMut((s) => s.replace("employeeId: 'emp_fixture_self' })", "employeeId: 'emp_other' })"))],
    ['M4. storage write on selection', devMut((s) => s.replace('selectedId = u.id;', "selectedId = u.id; localStorage.setItem('tam_dev_persona', id);"))],
    ['M5. install without the test seam', devMut((s) => s.replace('setIdentityProviderForTesting(LocalIdentityProvider);', ''))],
    ['M6. CEO fallback for an unknown persona', devMut((s) => s.replace('const u = LocalIdentityProvider.selectPrincipal(id);',
      "const u = LocalIdentityProvider.selectPrincipal(id) || LocalIdentityProvider.selectPrincipal('user_ceo_fixture');"))],
    ['M7. D02-UNKNOWN: an unknown selection clears the previous one', devMut((s) => s.replace('if(!u) return null;\n      selectedId = u.id;',
      'if(!u){ selectedId = null; return null; }\n      selectedId = u.id;'))],
    ['M8. D02-COPY: the frozen fixture is handed out', devMut((s) => s.replace('return isValidUser(u) ? copy(u) : null;', 'return isValidUser(u) ? u : null;'))],
    ['M9. D02-NULL-AUTO: the alias is installed at load with a null persona', devMut((s) => s.replace('  if(DEV_PERSONA !== null){',
      '  setIdentityProviderForTesting(LocalIdentityProvider);\n  if(DEV_PERSONA !== null){'))],
    ['M10. R2-REFERENCE-DRIFT: one byte of the reference workspace.js changed', oracleMut((j) => {
      const m = j.referenceModules.find((x) => x.path === 'js/core/workspace.js'); m.sourceUtf8 = m.sourceUtf8.replace('ALL_COMPANY', 'ALL_C0MPANY'); })],
    ['M11. R2-REFERENCE-DRIFT: oracle metadata redirected (blob id)', oracleMut((j) => { j.referenceModules[0].sourceGitBlob = '0'.repeat(40); })],
    ['M12. R2-REFERENCE-DRIFT: a reference entry duplicated', oracleMut((j) => { j.referenceModules.push(j.referenceModules[0]); })],
    ['M13. R2-CANDIDATE-MODULE-DRIFT: candidate authz.js changed by one newline', treeMut('authz', (s) => s + '\n')],
    ['M14. R2-CANDIDATE-MODULE-DRIFT: candidate workspace.js changed', treeMut('workspace', (s) => s.replace('ALL_COMPANY', 'ALL_C0MPANY'))],
    ['M15. R2-CONSTANTS-REWRITE: a second AUTH_MODE assignment in the candidate', treeMut('constants', (s) => s + '\nconst AUTH_MODE = AUTH_MODES.LOCAL;\n')],
    ['M16. R2-CONSTANTS-REWRITE: candidate ships LOCAL', treeMut('constants', (s) => s.replace('const AUTH_MODE = AUTH_MODES.SESSION;', 'const AUTH_MODE = AUTH_MODES.LOCAL;'))],
    ['M17. D02-ORACLE-ALIASED: the reference is built from the candidate', Object.assign({}, base, {
      refOverride: (pv) => ({ constants: pv.cand.constants, identity: pv.cand.identity + '\n' + DEV_SRC
        + '\nconst FIXTURE_PRINCIPALS = DEV_FIXTURE_PRINCIPALS;', workspace: pv.cand.workspace, authz: pv.cand.authz }) })]
  ];
  MUTANTS.forEach(function(m){
    const o = m[1];
    const same = o.devSrc === base.devSrc && o.oracleBuf === base.oracleBuf && o.tree === base.tree && !o.refOverride;
    if(same){ check(false, m[0] + ' — mutation did not apply (harness out of date)'); return; }
    const red = [];
    try { suite(o, function(c, label){ if(!c) red.push(label); }); }
    catch(e){ red.push('threw: ' + (e && e.message)); }
    const counted = red.filter((l) => !/^threw:/.test(l));
    check(counted.length > 0, m[0] + ' — caught (' + counted.length + ' counted failing check' + (counted.length === 1 ? '' : 's')
      + (red.length !== counted.length ? ', plus a thrown error' : '') + ')');
  });

  /* ---------- summary ---------- */
  console.log('');
  if(failures.length){
    console.log('AFI-5a/AFI-5b DEV LOCAL IDENTITY RUNTIME VERIFICATION FAILED -- ' + failures.length + ' failing:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('AFI-5a/AFI-5b DEV LOCAL IDENTITY RUNTIME VERIFICATION PASSED -- ' + passed + ' checks OK.');
})();
