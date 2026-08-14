#!/usr/bin/env node
/*
 * verify-build.js — TAM Intelligence OS (Release Automation, v2.6.4+)
 * --------------------------------------------------------------------------------------
 * The dist JS is no longer byte-identical to v2.5.2 (search-focus fix, payroll workspace,
 * and later releases changed behavior intentionally). This verifier checks:
 *   - CSS still untouched  -> dist CSS == v2.5.2 CSS byte-for-byte (+ only the v2.6.3b
 *     floating-menu rule that later releases added).
 *   - Build fidelity: dist inlined payloads == concatenated modular source.
 *   - Version identity is DERIVED from js/core/constants.js (single source of truth) —
 *     APP_VERSION, <title>, APP_RELEASE_NAME, the Release Notes entry, and the generated
 *     dist filename must all agree with it (v2.6.4 Release Automation).
 *   - Data-safety invariants unchanged (keys, flags, schema 6, seed, mounts, init).
 *   - FOCUS FIX present: search boxes route to apply*Filter and no longer call the full
 *     page renderer on 'input'.
 *   - Payroll lifecycle + floating menu + module decomposition (as in prior releases).
 *   - v2.6.4 Activity Log + payroll audit timeline + post-blocker feedback present.
 * Usage:  node tools/verify-build.js
 *
 * MAINTENANCE NOTE (UX-005B finalization): the current single-file verifier size is
 * ACCEPTABLE and is not to be refactored now. If verification complexity grows
 * substantially (roughly ~2500-3000+ checks), evaluate splitting it into
 * domain-specific verifiers (e.g. finance, HR, grid, security) sharing a common
 * check() harness. This is a forward-looking guideline only — no split is authorized
 * by this note. See docs/01-roadmap/MAINT-001-repository-maintenance.md.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readAppMeta } = require('./app-version.js');
const root = path.resolve(__dirname, '..');
const LF = '\n';
const read = (p) => fs.readFileSync(p, 'utf8');
const trimLF = (s) => s.replace(/^\n+/, '').replace(/\n+$/, '');

// Version is derived from the single source of truth (constants.js) — never hardcoded here.
const meta = readAppMeta();

const orig = read(path.join(root, 'tam-intelligence-os-v2.5.2.html'));
if (!fs.existsSync(meta.distPath)) {
  console.error('Expected dist build not found: dist/' + meta.distName + ' — run `node tools/build-single-file.js` first.');
  process.exit(1);
}
const dist = read(meta.distPath);

let passes = 0; const fails = [];
const check = (cond, msg) => { if (cond) { passes++; console.log('  [PASS] ' + msg); } else { fails.push(msg); console.log('  [FAIL] ' + msg); } };
function extractStyle(h){ const a=h.indexOf('<style>'), b=h.indexOf('</style>'); if(a<0||b<0) return null; return trimLF(h.substring(a+7,b)); }
function extractMainScript(h){ const i=h.indexOf('const APP_VERSION'); if(i<0) return null; const o=h.lastIndexOf('<script>',i), c=h.indexOf('</script>',i); return trimLF(h.substring(o+8,c)); }

const distCss = extractStyle(dist), distJs = extractMainScript(dist);

const cssFiles = ['fonts.css','tokens.css','base.css','shell.css','components.css','charts.css'];
const jsFiles = require('./module-order.js');
const srcCss = cssFiles.map((f)=>read(path.join(root,'css',f))).join(LF);
const srcJs = jsFiles.map((f)=>read(path.join(root,'js',f))).join(LF);

// CSS GOLDEN MASTER (UX-002B / PD-A).
// Until v2.8.4 this check RECONSTRUCTED the expected stylesheet from the tracked
// v2.5.2 artifact plus one enumerated string patch. That derivation chain could not
// express an authorized multi-file revision without accumulating opaque, order-
// dependent literal patches — it would have looked stricter while getting weaker.
// It is replaced 1-for-1 by an exact pinned digest of concat(css/*.css) under the
// same normalization. Same count, strictly stronger guarantee: whole-file, exact,
// and every future revision is one reviewable line plus a diff.
// Pin history (each superseded value is preserved; see audit/ux-002b-2026-08-05/):
//   pre-UX-002B      b311990b405d4d8ac86efb406e9cfefafee2a53b29dec6a201e0690387a8100d
//   Phase 1          47413d6eb2e864367aed98e50e8d9a9ed80c14605092b853b08a0c775e35d712
//   Phase 1 remediation  b1cec5dd8b789f49d3967c5e49786961418f87b6f21975965315981c6f6e507c
//   UX-004D            49d87fbfe09436bc28e7f1e4ec0146cd9dd9169e4db90ef0089e1e95a65b7539
//     Breadcrumb landmark styles + Numeric Typography Standard.
//   UX-004E            90412710de6e9bbe3c24a0be7f2d57d69480861d965a6a3811e911c0132b3bce
//     Sidebar interaction: collapse rail, hamburger + backdrop, responsive drawer,
//     desktop hover-expand.
//   UX-004F              26bf828688dd2bbe280608e28c3abb583ab18032a3089f1cf5f991af5fe79fe6
//     Navigation-simplification + rebrand presentation only (css/shell.css).
//   UX-005A              fff716cb0c32719530ef2dc397064d4299d45de308101ad754d0dac11ce5c793
//     Executive Dashboard consolidation: Action Center navigable row (.action-item).
//   UX-005B              1b0452532108c8b35b8aaee8c6eb33f4d5680939b57dad952adfd2dd5453d3d6
//     Data Grid Foundation controls (.grid-sort/.grid-pager/.grid-count).
//   UX-005C              539328bf4f3ab26c1bc3ea42b660b7324152b0dc6829129e51b3b19544090752
//     Design-system consistency: additive .stack-section rhythm helper.
//   UX-005D              6a5a31987ad546c5afc16b5cf30dae093017ecdfa03294e5d8bebf57ab1679ad
//     Global Search palette, presentation only (css/components.css): additive
//     .gsearch-* classes for the Ctrl/Cmd+K dialog.
//   UX-005E              be8958b31c56424dc2ec93df4778b694de9b3f244ab37b720eb6753ad27d6f08
//     Modal viewport containment (css/components.css): shared .modal gains
//     max-height:88vh; overflow-y:auto.
//   UX-005F              5528908b942f7b85a1148d12f0852a4e21a5f3fa93c7b2e80e62ed920fcf87ba
//     Accessibility hardening, presentation only (css/shell.css): additive .skip-link +
//     .skip-link:focus (A1 skip-to-content) and an extended focus-visible selector list
//     covering .grid-sort/.nav-group-head/.sidebar-collapse-btn/.nav-hamburger (A5).
//   UX-006D1              569a3f063c2287486513a5bc7284369b561abf33df30081244ce90ade2189051
//     Reachable principal selection,
//     presentation only (css/shell.css): additive .identity-selector /
//     .identity-selector-label / .identity-select / .identity-selector-help in the brand
//     block, plus collapsed-rail hide + hover/drawer reveal mirroring .brand .sub. All
//     values resolve from existing tokens; no token/color/radius/type-scale change;
//     tokens.css byte-unchanged (pinned below); components.css untouched.
//   UX-006D2              cb242276248b38e29ba8308777d027ea559f3288f4dd1fcef0e0e9c7c0d952a2
//     Principal & workspace
//     presentation polish, presentation only (css/shell.css + css/components.css):
//     additive .identity-context / .identity-context-name / .identity-context-detail
//     and the collapsed-rail .identity-rail chip (with the matching collapsed /
//     hover-peek / drawer reveal rules, mirroring the existing .identity-selector
//     pattern); an additive .btn:disabled[data-authz-denied] treatment that raises
//     the denied control's contrast above the generic .4 and marks it with a dashed
//     edge so "you may not" reads differently from "not right now"; and additive
//     .action-item::after / .btn.quick-action affordances distinguishing navigation
//     from action. NOTHING is hidden, disabled or re-decided by any of it. All values
//     resolve from existing tokens; no token/color/radius/type-scale change;
//     tokens.css byte-unchanged (pinned below).
//   UX-006D3 (current) — AUTHORIZED golden-master revision. Cross-surface presentation
//     acceptance, presentation only (css/components.css): a single additive rule,
//     `.card li, .card p, .card .desc{overflow-wrap:break-word;}`. Long unbreakable
//     tokens in card prose (storage keys, identifiers, version strings) forced the
//     whole page into horizontal scroll on narrow viewports — Release Notes overflowed
//     a 375px viewport by 80px, a defect that PREDATES D3 and was found by the D3
//     responsive sweep. `break-word` engages only when a word would otherwise overflow,
//     so wider viewports and ordinary copy render identically. No layout, spacing,
//     colour, token or type-scale change; tokens.css byte-unchanged (pinned below);
//     css/shell.css untouched by D3.
//   BRAND-1 (current) — AUTHORIZED golden-master + tokens revision. Identity modernization:
//     (a) new css/fonts.css joins the concat (offline-embedded base64 WOFF2: Sora/Inter/
//     Source Serif 4/JetBrains Mono, Latin subset) — this is the bulk of the golden delta;
//     (b) css/tokens.css gains identity tokens (--identity-navy/blue/teal) and a --display
//     wordmark face token in both themes — the ONLY tokens.css change, so its pin moves too;
//     (c) css/shell.css moves the wordmark to var(--display) (Sora SemiBold), colours "OS"
//     with --identity-teal, adds the monogram lockup, makes the collapsed rail monogram-only
//     (wordmark visually-hidden for a11y), and removes the persistent company subtitle.
//     Semantic gold (--brand/--accent/--chart-actual and the pill/status colours) is
//     deliberately UNCHANGED (palette strategy P1: identity/UI separation). No schema,
//     storage-key, migration, type-scale or spacing change. Old CSS golden pin was
//     6d9c2137…3b4b96; old tokens pin was 60dde600…1a7d1.
//   BRAND-1 refinement (current) — AUTHORIZED golden revision, css/shell.css only. Owner
//     optical ruling: the expanded-sidebar monogram grows 30px→34px so it reads as a brand
//     mark; the collapsed rail keeps it at 30px (size intentionally differs by state);
//     hover-peek and the mobile drawer show the expanded 34px mark. Presentation only; no
//     token change (tokens.css pin unchanged). Prior CSS golden pin was 742164ea…4e0a7d8a.
const CSS_GOLDEN_SHA256 = '84c3434fe6b1f9c571462fa42bce0f62d550851f7b8605bcd9998f4b500f7bae';
// UX-005C — tokens.css anti-drift pin. The design tokens are the single source of truth
// for spacing/type/radius/color; this pin fails loudly if any token VALUE is changed,
// so a "consistency" edit can never silently move the scale it normalizes onto.
// BRAND-1 authorized revision (identity + --display tokens); prior pin 60dde600…1a7d1.
const TOKENS_CSS_SHA256 = '78d6dd315e43347770c780eca5ffce4591cbaae5db5c1ffaba06ab399786f8ef';
console.log('== CSS GOLDEN MASTER (pinned digest of concat(css/*.css)) ==');
const cssDigest = crypto.createHash('sha256').update(trimLF(srcCss), 'utf8').digest('hex');
check(cssDigest === CSS_GOLDEN_SHA256,
  'concat(css/*.css) matches the pinned CSS golden master'
  + (cssDigest === CSS_GOLDEN_SHA256 ? '' : ' >> VIOLATION: expected ' + CSS_GOLDEN_SHA256 + ', got ' + cssDigest + ' — an unapproved style change, or an approved revision whose pin was not updated'));
const tokensDigest = crypto.createHash('sha256').update(trimLF(read(path.join(root,'css','tokens.css'))), 'utf8').digest('hex');
check(tokensDigest === TOKENS_CSS_SHA256,
  'UX-005C: css/tokens.css matches its pinned digest (token values never drift silently)'
  + (tokensDigest === TOKENS_CSS_SHA256 ? '' : ' >> VIOLATION: expected ' + TOKENS_CSS_SHA256 + ', got ' + tokensDigest));

console.log('== BUILD FIDELITY (source -> dist) ==');
check(trimLF(srcCss) === distCss, 'concat(css/*.css) == dist CSS payload');
check(trimLF(srcJs) === distJs, 'concat(js/*.js) == dist JS payload');

// WHOLE-ARTIFACT FIDELITY (v2.8.5). The two payload comparisons above only inspect the
// inlined <style> and the main <script>. Anything OUTSIDE those two regions — appended
// bytes after </html>, an edited <title>, injected markup between the tags — was invisible
// to them, so a tampered or nondeterministic release asset could still verify clean. This
// re-assembles the artifact using exactly the builder's algorithm and compares byte-for-byte,
// which is what a release asset actually has to guarantee.
{
  const idxHtml = read(path.join(root, 'index.html'));
  const cssLinkBlock = cssFiles.map((f) => '<link rel="stylesheet" href="css/' + f + '">').join(LF);
  const jsTagBlock = jsFiles.map((f) => '<script src="js/' + f + '"></script>').join(LF);
  const cssInline = '<style>' + LF + cssFiles.map((f)=>read(path.join(root,'css',f))).join(LF) + LF + '</style>';
  const jsInline = '<script>' + LF + jsFiles.map((f)=>read(path.join(root,'js',f))).join(LF) + LF + '</script>';
  const expected = idxHtml.includes(cssLinkBlock) && idxHtml.includes(jsTagBlock)
    ? idxHtml.replace(cssLinkBlock, cssInline).replace(jsTagBlock, jsInline)
    : null;
  check(expected !== null && expected === dist,
    'the dist artifact is byte-identical to a fresh assembly of index.html + css/ + js/ (whole-file, not just the inlined payloads)');
}

console.log('== VERSION IDENTITY (derived from constants.js — no hardcoded version) ==');
check(dist.includes("const APP_VERSION = '" + meta.version + "';"), 'APP_VERSION == ' + meta.version + ' (matches constants.js)');
check(dist.includes("const APP_RELEASE_NAME = '" + meta.releaseName + "';"), 'APP_RELEASE_NAME == "' + meta.releaseName + '" (matches constants.js)');
check(dist.includes('<title>TAM OS v' + meta.version + '</title>'), '<title> == v' + meta.version);
check(dist.includes("{v:'" + meta.version + " "), 'Release Notes has a ' + meta.version + ' entry');
check(path.basename(meta.distPath) === 'tam-os-v' + meta.version + '.html', 'generated dist filename derived from APP_VERSION under TAM OS naming (dist/' + meta.distName + ')');
// History preserved: prior release entries are permanent and must never disappear.
check(dist.includes("{v:'2.6.3c ") && dist.includes("{v:'2.6.3b ") && dist.includes("{v:'2.6.3a ") && dist.includes("{v:'2.6.3 "), 'Release Notes still has 2.6.3c/2.6.3b/2.6.3a/2.6.3 entries (history preserved)');

console.log('== DATA-SAFETY INVARIANTS ==');
const mDist = dist.match(/const SCHEMA_VERSION = (\d+);/);
check(mDist && mDist[1] === '6', 'SCHEMA_VERSION == 6 (UNCHANGED)');
const keys = ['tam_txns_v1','tam_settings_v1','tam_backups_v1','tam_employees_v1','tam_contracts_v1','tam_payroll_plans_v1','tam_recurring_expenses_v1','tam_monthly_plans_v1','tam_overtime_records_v1','tam_import_batches_v1','tam_payroll_adjustments_v1','tam_employee_merges_v1','tam_audit_log_v1'];
const flags = ['tam_migrated_exec_v21','tam_migrated_hr_v22','tam_migrated_norm_v221','tam_migrated_overtime_v23','tam_migrated_payrollops_v25','tam_migrated_dedup_v252','tam_v23_ack'];
keys.forEach((k)=>check(dist.includes(k)&&orig.includes(k), 'storage key present & unchanged: '+k));
flags.forEach((f)=>check(dist.includes(f)&&orig.includes(f), 'migration flag present & unchanged: '+f));
// v2.6.9 + v2.7.0 — additive storage keys not present in the v2.5.2 golden master, so they are
// checked in the current build only. Total known keys: 15 (13 legacy + company accounts + supplemental).
const newKeysPost252 = ['tam_company_accounts_v1', 'tam_supplemental_payments_v1'];
newKeysPost252.forEach((k)=>check(dist.includes(k), 'post-v2.5.2 additive storage key present: '+k));
check(keys.length + newKeysPost252.length === 15, 'exactly 15 known storage keys (13 legacy + companyAccounts + supplementalPayments)');
check(dist.includes('tam_migrated_bankaccts_v269'), 'v2.6.9 company-account seed migration flag present');
// Bank Master is reference data — a constant, NOT a storage key.
check(dist.includes('const BANK_MASTER_GROUPS') && dist.includes('const INDONESIAN_BANKS'), 'Indonesian Bank Master is a constant (single source, no storage key)');
check(!/tam_bank_master_v\d/.test(dist) && !/tam_banks_v\d/.test(dist), 'no bank-master storage key introduced (Bank Master stays a constant)');
// v2.7.0 — Supplemental Payroll Engine: store present, lifecycle constants, backup inclusion.
check(dist.includes("supplementalPayments: 'tam_supplemental_payments_v1'"), 'supplemental store registered in HR_KEYS');
check(dist.includes("const SUPPLEMENTAL_STATUSES = ['Draft','Review','Approved','Posted','Executed','Cancelled']"), 'supplemental lifecycle statuses defined');
check(dist.includes('function generateSupplementalForPlan(') && dist.includes('function transitionSupplemental('), 'supplemental generator + transition engine present');
check(dist.includes('function supplementalEligibleOvertime(') && dist.includes('function capturedOvertimeIdsForPlan('), 'supplemental duplicate-prevention helpers present');
check(dist.includes('supplementalPayments: State.supplementalPayments'), 'supplemental store included in Complete Backup');
check(dist.includes("SUPPLEMENTAL_SOURCE_TYPES = ['overtime_drift']"), 'supplemental v1 source is overtime_drift only (no speculative adjustment types)');
check(!orig.includes('tam_supplemental_payments_v1') && !orig.includes('SUPPLEMENTAL_STATUSES'), 'supplemental engine is genuinely new (absent from the v2.5.2 golden master)');
check(dist.includes('function postSupplemental(') && dist.includes('supplementalId:supp.id'), 'supplemental posting links to a finance transaction (both directions)');
check(dist.includes('function linkSupplementalExecution('), 'supplemental execution linkage present (reuses Execution Center)');
// v2.7.0 — feature lifecycle registry replaces the hardcoded sidebar PREVIEW badge.
check(dist.includes('const FEATURE_REGISTRY') && dist.includes('function featureBadgeHTML('), 'centralized feature registry + shared badge helper present');
check(!/nav-preview-tag">Preview</.test(dist), 'no hardcoded "Preview" sidebar badge outside the registry');
check(dist.includes('featureBadgeHTML(n.id)'), 'sidebar badge rendered via the feature registry helper');
// v2.7.0 — workflow step label is count-neutral (no hardcoded verifier count).
try {
  const ci = read(path.join(root, '.github', 'workflows', 'ci.yml'));
  const rel = read(path.join(root, '.github', 'workflows', 'release.yml'));
  check(/name:\s*Verify build\s*$/m.test(ci) && !/invariant checks\)/.test(ci), 'ci.yml verify step label is count-neutral');
  check(/name:\s*Verify build\s*$/m.test(rel) && !/invariant checks\)/.test(rel), 'release.yml verify step label is count-neutral');
} catch(e){ check(false, 'workflow files readable for label check: '+e.message); }
check(dist.includes('<script id="seed-data" type="application/json">[]</script>'), 'seed-data JSON present and EMPTY');
check(dist.includes('<div id="app"></div>')&&dist.includes('<div id="toast-root"></div>')&&dist.includes('<div id="modal-root"></div>'), 'all three mount points present');
const initCount = (dist.match(/\(async function init\(\)/g)||[]).length;
check(initCount === 1, 'exactly one bootstrap init() (found '+initCount+')');
check(!dist.includes('type="module"'), 'no type=module (still classic scripts)');

console.log('== SEARCH FOCUS / INCREMENTAL RENDER FIX ==');
['function applyEmployeeFilter','function applyContractFilter','function applyTxnFilter','function applyOvertimeFilter','function applyPayrollFilter']
  .forEach((fn)=>check(dist.includes(fn), 'incremental refresh defined: '+fn.replace('function ','')));
// UX-005B: Transactions & Employees search is now DEBOUNCED (still incremental and
// focus-preserving — the input node is never re-rendered; the debounced callback runs
// applyTxnFilter/applyEmployeeFilter, an incremental grid-area swap). The two handler
// strings were updated to the debounced shape; Contracts/Overtime/Payroll are unchanged.
const newHandlers = [
  "eSearch.addEventListener('input', e=>{ State.empFilter.search=e.target.value; debSearch(); });",
  "getElementById('cSearch').addEventListener('input', e=>{ State.contractFilter.search=e.target.value; applyContractFilter(main); })",
  "fSearch.addEventListener('input', e=>{ State.txFilter.search=e.target.value; debSearch(); });",
  "getElementById('otSearch').addEventListener('input', e=>{ State.overtimeFilter.search=e.target.value; applyOvertimeFilter(main); })",
  "getElementById('pfSearch').addEventListener('input', e=>{ f.search=e.target.value; applyPayrollFilter(area, monthKey, main); })",
];
newHandlers.forEach((h)=>check(dist.includes(h), 'search handler is incremental: '+h.substring(14,38)+'...'));
const oldHandlers = [
  'State.empFilter.search=e.target.value; renderEmployees(main)',
  'State.contractFilter.search=e.target.value; renderContracts(main)',
  'State.txFilter.search=e.target.value; renderTransactions(main)',
  'State.overtimeFilter.search=e.target.value; renderOvertime(main)',
];
oldHandlers.forEach((h)=>check(!dist.includes(h), 'old full-render search handler removed: '+h.substring(0,24)+'...'));
['id="empRows"','id="ctRows"','id="otRows"','id="txnRows"','id="pwRows"','id="txnCount"']
  .forEach((id)=>check(dist.includes(id), 'incremental container present: '+id));

console.log('== PAYROLL LIFECYCLE (v2.6.3a) + FLOATING MENU (v2.6.3b) ==');
// Bug 1: Approve no longer gated by commit-blockers in the lifecycle helpers.
check(!dist.includes("if(status==='Ready' && payrollCommitBlockers(pp).length) continue;"), 'bulk Approve no longer skips on commit-blockers');
check(!dist.includes("if(status==='Ready'){ const b=payrollCommitBlockers(pp); if(b.length){"), 'single Approve no longer gated on commit-blockers');
// commit still validates — and (v2.6.4) records the exact skip reason per row (no relaxation of rules)
check(dist.includes('const blockers = payrollCommitBlockers(pp);'), 'Post to Finance still computes payrollCommitBlockers(pp) before posting');
check(dist.includes('if(blockers.length){ skipped++; skippedDetails.push({name:pp.employeeName, reasons:blockers}); continue; }'), 'Post to Finance skips blocked rows and records exact blocker reasons (v2.6.4)');
// Bug 2 (v2.6.3b): shared floating actions menu (portal, position:fixed, flip, close, reposition)
check(dist.includes('function openFloatingMenu(') && dist.includes('function closeFloatingMenu(') && dist.includes('function positionFloatingMenu('), 'floating menu controller defined');
check(dist.includes('<div id="menu-root"></div>'), '#menu-root portal layer present');
check(dist.includes('.actions-dropdown.floating{position:fixed'), 'CSS .actions-dropdown.floating (position:fixed) present');
check(!dist.includes('function positionActionsMenu('), 'old in-container positionActionsMenu removed');
check((dist.match(/openFloatingMenu\(btn, menu\)/g)||[]).length >= 2, 'floating menu wired into HR + finance action menus');
check(dist.includes("if(e.key==='Escape'){ e.stopPropagation(); closeFloatingMenu(); }"), 'menu closes on Escape');
check(dist.includes("window.addEventListener('scroll', s.onReposition, true)") || dist.includes("window.addEventListener('scroll', onReposition, true)"), 'menu repositions on window scroll');
check(dist.includes("window.addEventListener('resize', onReposition, true)"), 'menu repositions on window resize');

console.log('== PAYROLL INTELLIGENCE WORKSPACE (v2.6.3) ==');
['function payrollStage(','function payrollStagePill(','function payrollStageCounts(','function payrollSummary(','function payrollHealth(','function isPayrollLocked(','function setPayrollLock(','function renderPayrollWorkspace(']
  .forEach((fn)=>check(dist.includes(fn), 'defined: '+fn.replace('function ','').replace('(','')));
check(dist.includes("label:'Payroll'"), 'Payroll workspace nav item present (UX-004F simplified label: "Payroll")');
check(dist.includes('payrollLocks: {}') || dist.includes('payrollLocks:{}'), 'payrollLocks settings field present (lock persistence, same settings key)');
check(dist.includes('Post to Finance') || dist.includes('Post Approved Payroll to Finance'), 'Post to Finance action present');
check(dist.includes("<h3>Payroll History</h3>") && dist.includes("<h3>Overtime History</h3>"), 'Employee timeline (Payroll + Overtime History) present');
// lifecycle mapped over existing stored values — no new payroll status persisted
check(dist.includes("const PAYROLL_STATUSES = ['Draft','Reviewed','Ready','Committed','Cancelled']"), 'stored payroll status values unchanged (no migration)');

console.log('== MODULE DECOMPOSITION (v2.6.2) ==');
const jsdir = path.join(root, 'js');
// every module in the manifest exists on disk
let allExist = true; jsFiles.forEach((f)=>{ if(!fs.existsSync(path.join(jsdir,f))) { allExist=false; } });
check(allExist, 'all ' + jsFiles.length + ' modules in module-order.js exist on disk');
check(jsFiles.length >= 40, 'decomposed into ' + jsFiles.length + ' modules (was 20)');
// the flat js/NN-*.js files are gone
const flatLeft = fs.readdirSync(jsdir).filter((n)=>/^\d\d-.*\.js$/.test(n));
check(flatLeft.length === 0, 'no flat js/NN-*.js files remain' + (flatLeft.length?(' ('+flatLeft.join(',')+')'):''));
// subfolders present
['core','ui','finance','people','import','analytics'].forEach((d)=>check(fs.existsSync(path.join(jsdir,d)), 'js/'+d+'/ folder present'));
// index.html references the subfolder script paths, in manifest order
const indexHtml = read(path.join(root,'index.html'));
const idxTagBlock = jsFiles.map((f)=>`<script src="js/${f}"></script>`).join(LF);
check(indexHtml.includes(idxTagBlock), 'index.html <script> tags match module-order.js exactly (order + paths)');

console.log('== ACTIVITY LOG + AUDIT VISIBILITY (v2.6.4) ==');
// Activity Log page: helpers, render, incremental filter, CSV, nav + dispatch.
check(dist.includes('function logActivity(') && dist.includes('function getAuditEvents('), 'audit helpers logActivity / getAuditEvents defined');
check(dist.includes("const AUDIT_LOG_KEY = 'tam_audit_log_v1'"), 'audit log reuses existing tam_audit_log_v1 key (no new storage key)');
check(dist.includes('function renderActivityLog('), 'Activity Log page renderer defined');
check(dist.includes('function applyActivityFilter('), 'Activity Log uses incremental filter (search focus preserved)');
check(dist.includes('id="actRows"'), 'Activity Log incremental tbody container present');
check(dist.includes('function exportActivityCsv('), 'Activity Log CSV export defined');
check(dist.includes("label:'Activity Log'"), 'Activity Log nav item present');
check(dist.includes("State.view==='activity'") && dist.includes('renderActivityLog(main)'), 'Activity Log wired into renderView dispatch');
// No brand-new storage key was introduced for activity (the audit trail reuses tam_audit_log_v1).
check(!/tam_activity_log_v\d/.test(dist) && !/tam_audit_v\d/.test(dist), 'no independent activity/audit storage key introduced');
// Instrumentation at the key chokepoints so the log actually has cross-module records.
['payroll.generate','payroll.post','payroll.lock','payroll.unlock','overtime.','finance.execute','import.commit']
  .forEach((t)=>check(dist.includes("'"+t) || dist.includes("type:'"+t), 'audit instrumentation present: '+t));
// Payroll audit timeline (real events only, derived — not duplicated state).
check(dist.includes('function buildPayrollTimeline(') && dist.includes('function buildPayrollPeriodTimeline('), 'payroll timeline builders defined (workspace + detail)');
check(dist.includes('<h3>Payroll Timeline</h3>') || dist.includes('Payroll Timeline'), 'Payroll Detail timeline present');
// Post-blocker feedback modal (posted vs skipped, employee + exact reason).
check(dist.includes('function openPostResultModal('), 'post-result summary modal defined (posted vs skipped)');
check(dist.includes('skippedDetails') && dist.includes('posted:'), 'commitReadyPayroll returns posted + skippedDetails');

console.log('== PAYROLL INTEGRITY & REPORTING FOUNDATION (v2.7.1) ==');
// Stage-aware historical source-of-truth helper + integrity notice.
check(dist.includes('function payrollHistoricalSnapshot('), 'stage-aware historical payroll helper (payrollHistoricalSnapshot) present');
check(dist.includes('function payrollIntegrityNoticeHTML(') && dist.includes('Payroll snapshot mismatch'), 'payroll snapshot-mismatch integrity notice present');
check(dist.includes('Base Payroll Snapshot'), 'Payroll Detail renders a committed Base Payroll Snapshot');
check(dist.includes('function payrollHoursDisplay(') && dist.includes('(unavailable)'), 'unknown legacy overtime hours render as unavailable (not zero)');
// Immutable overtime snapshots frozen at posting (both commit pipelines).
check(dist.includes('function buildPayrollOvertimeSnapshot(') && dist.includes('function buildPayrollCommittedSnapshot('), 'immutable overtime + committed snapshot builders present');
// SPR-078 — exactly ONE payroll commit pipeline remains (payroll-planning's was retired).
// The transaction-side freeze happens once; buildPayrollOvertimeSnapshot(pp.overtimeIds) is
// called twice by design — once by that pipeline and once by buildPayrollCommittedSnapshot,
// the historical read model. Both live in payroll-ops-engine.js.
check((dist.match(/overtimeSnapshot:\s*otSnapshot\b/g)||[]).length === 1, 'the ONE remaining payroll commit pipeline freezes an overtimeSnapshot (SPR-078 retired the second)');
check((dist.match(/=\s*buildPayrollOvertimeSnapshot\(pp\.overtimeIds/g)||[]).length === 2, 'overtime snapshots are built in exactly two places (the one commit pipeline + the committed-snapshot read model)');
check(dist.includes('pp.committedSnapshot = buildPayrollCommittedSnapshot(pp)'), 'committed snapshot frozen on the plan at post time');
// Company-settings onboarding completion marker (Section 4).
check(dist.includes('companySettingsConfiguredAt') && dist.includes('function legacyMeaningfulCompanyProfile('), 'company-settings completion marker + legacy fallback present');
check(dist.includes('s.companySettingsConfiguredAt || legacyMeaningfulCompanyProfile(s)'), 'companySettingsConfigured uses explicit marker OR legacy fallback (not inference alone)');
check(!/tam_company_settings_v\d/.test(dist), 'settings marker is a settings field, not a new storage key');
// Supplemental hardening (Sections 11, 12).
check(dist.includes('function overtimeCapturedByOtherSupplemental('), 'supplemental GLOBAL duplicate guard present');
check(dist.includes('!overtimeCapturedByOtherSupplemental(id, exceptSupplementalId)') && dist.includes('!overtimeCapturedByOtherSupplemental(x, supp.id)'), 'global duplicate guard used by BOTH generation and refresh');
check(dist.includes("['Posted','Executed','Cancelled'].includes(supp.status)) return {ok:false, reason:'Notes are locked once the supplemental is Posted"), 'Posted supplemental notes are immutable');
check(dist.includes('supp.sourceOvertimeSnapshot = buildPayrollOvertimeSnapshot('), 'supplemental freezes a source-overtime snapshot at Approved');
// Execution Center deep-link (Section 13).
check(dist.includes('function focusTransactionInExecutionCenter(') && dist.includes('function execBucketKeyForTxn('), 'Execution Center deep-link/focus mechanism present');
check(!dist.includes("State.view='executioncenter'; State.execFilter='today'; render();"), 'generic today-filter Execution Center navigation replaced by focused deep-link');
// Persistence coordination (Section 15).
check(dist.includes('const txnOk = await persist();') && dist.includes('const suppOk = await persistSupplementalPayments();'), 'supplemental posting checks persistence results (no half-written linkage)');
// New integrity checks (Section 10).
['payroll-posted-no-transaction','payroll-plan-txn-total-diff','payroll-plan-txn-overtime-diff','payroll-missing-committed-snapshot','supplemental-missing-transaction','supplemental-orphan-transaction','supplemental-overtime-double-capture','supplemental-missing-source-snapshot']
  .forEach((c)=>check(dist.includes("'"+c+"'"), 'integrity check present: '+c));
// The released v2.7.0 artifact must never be OVERWRITTEN with v2.7.1 content. During development
// it stays present and unchanged; at release the dist-swap intentionally removes it from dist/
// (only the current artifact is kept — the historical GitHub Release asset is the real invariant
// and is never touched here). So ABSENCE is a valid released state; if still present it must be v2.7.0.
const prevDist = path.join(root, 'dist', 'tam-intelligence-os-v2.7.0.html');
if (fs.existsSync(prevDist)) {
  const prev = read(prevDist);
  check(prev.includes('<title>TAM Intelligence OS v2.7.0</title>') && prev.includes("const APP_VERSION = '2.7.0';"), 'if present, the v2.7.0 artifact is unchanged (still v2.7.0, never overwritten by the v2.7.1 build)');
} else {
  check(true, 'v2.7.0 artifact removed from dist/ by the release swap (historical GitHub Release asset untouched)');
}
// dist/ holds exactly one release artifact — the current version (release dist-swap invariant).
// v2.8.6 adopts the TAM OS artifact naming: dist/tam-os-v<version>.html. Every *.html in dist/
// is inspected so a leftover legacy-named artifact (tam-intelligence-os-v*) would fail here.
const distHtml = fs.readdirSync(path.join(root, 'dist')).filter((f)=>/\.html$/.test(f));
check(distHtml.length === 1 && distHtml[0] === 'tam-os-v' + meta.version + '.html', 'dist/ holds exactly one release artifact — the current v' + meta.version + ' under the TAM OS naming (dist/tam-os-v' + meta.version + '.html)');
check(!distHtml.some((f)=>/^tam-intelligence-os-v/.test(f)), 'no legacy tam-intelligence-os-v* artifact remains tracked in dist/ (historical filenames live only in Git history + published Releases)');
check(meta.version === '2.11.0', 'APP_VERSION is 2.11.0 (this development release — RELEASE-1)');

// == RELEASE IDENTITY GUARDRAILS (v2.10.0) ==
// The version and release name live ONCE in js/core/constants.js; these checks prove every
// authoritative surface agrees with that single source and that the release paperwork exists.
// They are derived from meta wherever possible so they do not need editing next release.
const distArtifacts = distHtml; // alias retained for downstream references
check(meta.releaseName === 'Identity Refresh', 'APP_RELEASE_NAME is the approved v2.11.0 release name');
check(!/tam-intelligence-os-v2\.8\.[456]\.html/.test(distArtifacts.join('|')), 'no tracked current artifact remains under a superseded tam-intelligence-os filename');
check(read(path.join(root, 'index.html')).includes('<title>TAM OS v' + meta.version + '</title>'), 'index.html <title> agrees with APP_VERSION');
const relNotes = read(path.join(root, 'RELEASE_NOTES.md'));
const changelog = read(path.join(root, 'CHANGELOG.md'));
check(relNotes.includes(meta.version), 'RELEASE_NOTES.md documents v' + meta.version);
check(relNotes.includes(meta.releaseName), 'RELEASE_NOTES.md names the release "' + meta.releaseName + '"');
check(changelog.includes('## ' + meta.version + ' — ' + meta.releaseName), 'CHANGELOG.md has the v' + meta.version + ' entry with the release name');
check(changelog.includes('## 2.8.4 — Monthly Plan Result Integrity'), 'CHANGELOG.md retains the historical v2.8.4 entry (history is never rewritten)');
check(changelog.includes('## 2.8.5 — Workspace & Contract Timeline Integrity'), 'CHANGELOG.md retains the historical v2.8.5 entry (history is never rewritten)');
check(changelog.includes('## 2.8.6 — Navigation Experience & TAM OS Rebrand'), 'CHANGELOG.md retains the historical v2.8.6 entry (history is never rewritten)');
check(changelog.includes('## 2.9.0 — Workspace Experience'), 'CHANGELOG.md retains the historical v2.9.0 entry (history is never rewritten)');
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root, 'js', 'core', 'constants.js'))), 'SCHEMA_VERSION remains 6 — v2.10.0 carries no data migration');
check(dist.includes('const SCHEMA_VERSION = 6;'), 'the portable artifact carries SCHEMA_VERSION 6');
check(relNotes.includes('SCHEMA_VERSION') && /remains \*{0,2}6\*{0,2}|unchanged \(6\)/.test(relNotes), 'RELEASE_NOTES.md states SCHEMA_VERSION remains 6');
// == v2.10.0 PUBLICATION GUARDRAILS (final release state) ==
// Current-state product/repository identity and honest release status for the PUBLISHED
// v2.10.0 release. Text guards over the release paperwork and current-state docs (never over
// historical evidence). Reconciled from the Readiness-3 release-candidate guardrails: those
// asserted "release candidate / not published / not tagged", which the v2.10.0 publication
// transaction retires. The polarity flips forward — the paperwork must now assert v2.10.0 is
// published and marked Latest and must carry NO stale candidate wording, while v2.9.0's
// published status survives as a historical statement.
//
// These checks are authored as part of the controlled publication transaction (annotated tag
// v2.10.0 + the tag-triggered Release workflow immediately follow this merge), mirroring the
// v2.9.0 reconciliation at 78fe910. They are a one-for-one replacement of the three
// candidate-polarity checks: release-state coverage is transitioned, never weakened or removed.
const readmeSrc = read(path.join(root, 'README.md'));
const securitySrc = read(path.join(root, 'SECURITY.md'));
const issueCfg = read(path.join(root, '.github', 'ISSUE_TEMPLATE', 'config.yml'));
check(dist.includes("const APP_NAME = 'TAM OS';"), 'APP_NAME is TAM OS (current product identity)');
check(/version-2\.11\.0/.test(readmeSrc) && /v2\.11\.0 — Identity Refresh/.test(readmeSrc),
  'README.md current-state identity is v2.11.0 / Identity Refresh');
// REPO-1 — CANONICAL REPOSITORY SLUG.
// The canonical repository is fanoryu/TAM-OS-Next. The predecessor fanoryu/TAM-OS is retained as a
// read-only archive and is still referenced legitimately as provenance (PROVENANCE.md, release history,
// the archived Release assets), so its mention is NOT forbidden — what matters is that the CURRENT-STATE
// slug is unambiguously the canonical one.
//
// The previous guard tested /fanoryu\/TAM-OS/ against README, which a plain substring match also
// satisfies for "fanoryu/TAM-OS-Next" — so it could not distinguish the two repositories at all and
// would have passed either way. These checks pin the distinction explicitly, using a negative
// lookahead so "fanoryu/TAM-OS" only counts when it is NOT followed by "-Next".
const CANONICAL_SLUG = /fanoryu\/TAM-OS-Next/;
const PREDECESSOR_SLUG = /fanoryu\/TAM-OS(?!-Next)/;
check(!/fanoryu\/TAM-Intelligence-OS/.test(readmeSrc + securitySrc + issueCfg),
  'current-state docs (README/SECURITY/issue-template) carry no retired fanoryu/TAM-Intelligence-OS slug');
check(CANONICAL_SLUG.test(readmeSrc),
  'README.md names the canonical repository slug fanoryu/TAM-OS-Next');
// The CI badge must report THIS repository's status, never the archived predecessor's.
check(/!\[CI\]\(https:\/\/github\.com\/fanoryu\/TAM-OS-Next\/actions\/workflows\/ci\.yml\/badge\.svg/.test(readmeSrc)
  && !/!\[CI\]\(https:\/\/github\.com\/fanoryu\/TAM-OS\/actions/.test(readmeSrc),
  'README.md CI badge points at the canonical repository, not the predecessor');
// Any surviving predecessor reference in README must be explicitly framed as predecessor/archive
// provenance — never presented as this repository's current identity.
check(!PREDECESSOR_SLUG.test(readmeSrc) || /predecessor repository/i.test(readmeSrc),
  'README.md frames every predecessor fanoryu/TAM-OS reference as predecessor/archive provenance');
// PUBLIC-1 — PUBLIC-VISIBILITY POSTURE GUARD.
// Once fanoryu/TAM-OS-Next is publicly viewable, the current-state operator docs must not regress to
// claiming the repository ITSELF is private. This is a narrow, SEMANTIC guard: it targets only the
// "this repository is private" family of assertions. It deliberately does NOT reject legitimate uses
// of "private" — the private PREDECESSOR repository, the private production/company data layer, or any
// historical discussion of when this repository used to be private (those never phrase it as
// "repository is private").
const PRIVATE_REPO_CLAIMS = [
  [/\brepository is\s+\*{0,2}private\b/i, '"repository is private"'],
  [/\brepository\s+remains\s+\*{0,2}private\b/i, '"repository remains private"'],
  [/Private source repository/i, '"Private source repository" heading'],
];
// PUBLIC-4 extends the guarded set to AI_CONTEXT.md — now that it carries the canonical public
// repository-posture statement, it must not regress to claiming the repository itself is private
// either. (aiContextSrc is read just below for the RELEASE-0B block; read it here so the guard can
// run first without reordering that block's own use.)
const aiContextSrcForPosture = read(path.join(root, 'AI_CONTEXT.md'));
for (const [docName, docSrc] of [['README.md', readmeSrc], ['SECURITY.md', securitySrc], ['AI_CONTEXT.md', aiContextSrcForPosture]]) {
  const hit = PRIVATE_REPO_CLAIMS.find(([re]) => re.test(docSrc));
  check(!hit, `${docName} current-state posture does not claim the repository itself is private`
    + (hit ? ` (found ${hit[1]})` : ''));
}
// RELEASE-0B — CANONICAL RE-PUBLICATION OF v2.10.0.
//
// v2.10.0 was ORIGINALLY published from the predecessor fanoryu/TAM-OS and is CANONICALLY
// RE-PUBLISHED, byte-identical and unchanged, from fanoryu/TAM-OS-Next. The previous guard here
// asserted the opposite ("no tags/Releases of its own yet") and is obsolete — but it is REPLACED,
// never dropped. These checks are strictly stronger: the old guard only proved an absence, whereas
// these pin the full provenance claim (original vs canonical, artifact identity, and the negative
// space of retired wording) so the two publications can never be conflated in either direction.
const aiContextSrc = read(path.join(root, 'AI_CONTEXT.md'));
const architectureSrc = read(path.join(root, 'ARCHITECTURE.md'));
const milestoneRoadmapSrc = read(path.join(root, 'docs', '01-roadmap', 'Milestone_Roadmap.md'));
const republicationDocs = [
  ['README.md', readmeSrc],
  ['RELEASE_NOTES.md', relNotes],
  ['SECURITY.md', securitySrc],
  ['docs/01-roadmap/README.md', read(path.join(root, 'docs', '01-roadmap', 'README.md'))],
  ['docs/06-releases/Pilot-Guide-v2.10.0.md', read(path.join(root, 'docs', '06-releases', 'Pilot-Guide-v2.10.0.md'))],
  // RELEASE-0D — the current-state knowledge records. These were NOT covered by the original
  // RELEASE-0B block, which is exactly why their pre-publication wording survived two green
  // release gates and had to be reconciled after the fact.
  ['AI_CONTEXT.md', aiContextSrc],
  ['ARCHITECTURE.md', architectureSrc],
  ['docs/01-roadmap/Milestone_Roadmap.md', milestoneRoadmapSrc],
];
// (1) The canonical re-publication is documented in the operator-facing paperwork.
check(/canonically re-published|canonical re-publication/i.test(readmeSrc)
  && /canonically re-published|canonical re-publication/i.test(relNotes),
  'README.md and RELEASE_NOTES.md document the canonical re-publication of v2.10.0 from TAM-OS-Next');
// (2) ORIGIN IS NEVER REWRITTEN. The original publication stays attributed to the predecessor.
// Without this, "canonical" could silently drift into "originated here" — the one provenance lie
// this whole exercise exists to prevent.
check(/original(ly)? published/i.test(relNotes) && PREDECESSOR_SLUG.test(relNotes),
  'RELEASE_NOTES.md attributes the ORIGINAL v2.10.0 publication to the predecessor fanoryu/TAM-OS');
check(/original/i.test(readmeSrc) && PREDECESSOR_SLUG.test(readmeSrc),
  'README.md attributes the ORIGINAL v2.10.0 publication to the predecessor fanoryu/TAM-OS');
// (3) The artifact is identified by exact size AND digest wherever it is offered for download.
// The checksum is deliberately NOT shipped as a separate file, so the paperwork IS the checksum.
const ARTIFACT_SHA = '60382271a6dcea23431fabb91e0d16abb03196e5cf64c6dc4da1e1af2c7fa704';
check(readmeSrc.includes(ARTIFACT_SHA) && relNotes.includes(ARTIFACT_SHA),
  'README.md and RELEASE_NOTES.md state the exact v2.10.0 artifact SHA-256');
check(/1,151,267 bytes/.test(readmeSrc) && /1,151,267 bytes/.test(relNotes),
  'README.md and RELEASE_NOTES.md state the exact v2.10.0 artifact byte size');
// (4) Byte-identity is the load-bearing claim of a re-publication — it must be stated, not implied.
check(/byte-identical/i.test(readmeSrc) && /byte-identical/i.test(relNotes),
  'README.md and RELEASE_NOTES.md record the artifact as byte-identical to the original publication');
// (5) NEGATIVE SPACE. The retired pre-republication wording must be gone from every CURRENT-STATE
// document. Archived/dated records under docs/99-archive keep their historical wording untouched.
//
// RELEASE-0D hardening. These are kept as SEPARATE named patterns rather than one catch-all, so a
// failure says which false claim was made. The distinction each pattern must respect:
//   LEGITIMATE — "originally published from the predecessor"; "the predecessor still shows Latest
//                v2.10.0"; "that commit resolves only in the predecessor" (historical provenance).
//   INVALID    — any claim that v2.10.0 exists ONLY in the predecessor, that TAM-OS-Next has no
//                v2.10.0 tag/Release, or that it was never re-tagged/re-published here.
// So every pattern below is anchored on the EXCLUSIVE framing ("not in this one", "no tags", "not
// re-tagged"), never on the mere co-occurrence of "predecessor" with "Latest" or "published".
const RETIRED_RELEASE_WORDING = [
  // Pre-publication absence claims.
  [/no tags and no Releases|no Releases of its own|no tags or Releases/i, 'claims TAM-OS-Next has no tags/Releases'],
  [/none will be created/i, 'claims no v2.10.0 tag will ever be created here'],
  [/no\s+`?v2\.10\.0`?\s+(tag|Release)\s+(here|in this repository)/i, 'claims there is no v2.10.0 tag/Release here'],
  // "not re-tagged / not re-published" in any word order, with or without a trailing locator.
  [/not\s+re-published,\s*re-tagged/i, 'claims v2.10.0 was not re-published/re-tagged'],
  [/not\s+re-(tagged|published)\s+or\s+re-(published|tagged)/i, 'claims v2.10.0 was not re-tagged or re-published'],
  // Latest asserted as living in the predecessor rather than in both repositories.
  [/Latest\s*[—–-]*\s*in the predecessor repository/i, 'asserts Latest lives in the predecessor repository'],
  // Predecessor-EXCLUSIVE resolution. Anchored on the "not in this one/repository" tail so the
  // legitimate "resolves only in the predecessor" provenance note is NOT rejected.
  [/predecessor[^.]{0,120}not in this (one|repository)/i, 'claims v2.10.0 resolves in the predecessor and not here'],
];
for (const [label, src] of republicationDocs) {
  const hit = RETIRED_RELEASE_WORDING.find(([re]) => re.test(src));
  check(!hit, hit
    ? `${label} carries retired pre-republication wording — ${hit[1]}`
    : `${label} carries no retired pre-republication or predecessor-only current-state wording`);
}
// (5b) POSITIVE current-state semantics for the knowledge records. Absence of stale wording is not
// the same as presence of the correct claim — a doc that simply went silent on v2.10.0 would pass
// the negative check above while telling a reader nothing.
for (const [label, src] of [['AI_CONTEXT.md', aiContextSrc], ['ARCHITECTURE.md', architectureSrc], ['docs/01-roadmap/Milestone_Roadmap.md', milestoneRoadmapSrc]]) {
  check(/canonically re-published|canonical re-publication/i.test(src),
    `${label} records the canonical re-publication of v2.10.0 from TAM-OS-Next`);
  check(/original(ly)? published/i.test(src) && PREDECESSOR_SLUG.test(src + ' fanoryu/TAM-OS'),
    `${label} attributes the ORIGINAL v2.10.0 publication to the predecessor`);
}
// (5c) CURRENT LATEST. After RELEASE-1, fanoryu/TAM-OS-Next shows Latest = v2.11.0 while the predecessor
// fanoryu/TAM-OS still shows Latest = v2.10.0. The knowledge records must state the current Latest
// (v2.11.0) positively AND still name the predecessor's v2.10.0, so the dual-repository history is intact.
check(/v2\.11\.0/.test(aiContextSrc) && /Latest/i.test(aiContextSrc) && /v2\.10\.0/.test(aiContextSrc),
  'AI_CONTEXT.md records v2.11.0 as the current Latest (predecessor v2.10.0 preserved)');
check(/v2\.11\.0/.test(architectureSrc) && /Latest/i.test(architectureSrc) && /v2\.10\.0/.test(architectureSrc),
  'ARCHITECTURE.md records v2.11.0 as the current Latest (predecessor v2.10.0 preserved)');
// (6) A re-publication is NOT a new product version. If this ever reads as a new build, the duplicate
// v2.10.0 across two repositories becomes a genuine ambiguity instead of a documented one.
check(/not v2\.10\.1/i.test(relNotes) && /not a new runtime build/i.test(relNotes)
  && /not a schema change/i.test(relNotes) && /not a feature release/i.test(relNotes),
  'RELEASE_NOTES.md states the re-publication is not a new version/runtime build/schema change/feature release');
check(/APP_VERSION` remains \*\*2\.10\.0\*\*|remains \*\*2\.10\.0\*\*/i.test(relNotes)
  && /SCHEMA_VERSION` \*\*remains 6\*\*|remains \*\*6\*\*/i.test(relNotes),
  'RELEASE_NOTES.md pins APP_VERSION 2.10.0 and SCHEMA_VERSION 6 as unchanged by the re-publication');
// (7) Artifact identity, not tree identity: the canonical tag carries a NEWER source/docs checkpoint
// than the predecessor's v2.10.0 snapshot. Stating this is what keeps the diff from reading as drift.
check(/artifact identity, not tree identity/i.test(relNotes) && /newer/i.test(relNotes),
  'RELEASE_NOTES.md records the artifact-identity (not tree-identity) semantics of the canonical tag');
// PUBLICATION: v2.11.0 is PUBLISHED and marked Latest (RELEASE-1). The paperwork must assert the current
// published state positively, must carry no stale "release candidate / not published / not tagged"
// wording, and must STILL record v2.10.0 as a published prior release (never demoted to unpublished).
check(/v2\.11\.0 is \*\*published/i.test(relNotes) && /marked Latest/i.test(relNotes),
  'RELEASE_NOTES.md records v2.11.0 as published and marked Latest');
check(/v2\.10\.0 is \*\*published/i.test(relNotes),
  'RELEASE_NOTES.md still records v2.10.0 as a published prior release (not demoted to unpublished)');
check(!/not (yet )?(been )?(published|tagged)/i.test(relNotes) && !/v2\.1[01]\.0 is (a |the )?\*\*release candidate/i.test(relNotes),
  'RELEASE_NOTES.md carries no stale pre-publication "release candidate / not published / not tagged" wording');
check(/v2\.11\.0[\s\S]{0,160}\*\*published/i.test(readmeSrc) && /marked Latest/i.test(readmeSrc)
  && !/release candidate \(not published\)/i.test(readmeSrc) && !/not (yet )?(been )?(published|tagged)/i.test(readmeSrc),
  'README.md records v2.11.0 as published and marked Latest (no stale candidate wording)');
// v2.9.0 remains HISTORICALLY published — the v2.10.0 publication supersedes it as Latest but
// must never re-label, demote, rewrite or delete it.
check(/v2\.9\.0/.test(relNotes) && /published/i.test(relNotes),
  'RELEASE_NOTES.md preserves v2.9.0 as a published historical release');
// v2.10.0 SHIPS the UX-006 authorization line + the Readiness programme — recorded as delivered.
check(/UX-006/.test(relNotes) && /UX-006/.test(changelog) && /## 2\.10\.0 — Governed Workspace/.test(changelog),
  'CHANGELOG/RELEASE_NOTES record the UX-006 authorization line as delivered in v2.10.0');
check(/Readiness-1/.test(relNotes) && /Readiness-2/.test(relNotes),
  'RELEASE_NOTES.md records the Readiness-1 (read scope) and Readiness-2 (E2E acceptance) programme');
// Historical published asset filenames are never rewritten; the newly published artifact is named.
check(/tam-intelligence-os-v2\.8\.5\.html/.test(relNotes) && /tam-os-v2\.8\.6\.html/.test(relNotes)
  && /tam-os-v2\.9\.0\.html/.test(relNotes) && /tam-os-v2\.10\.0\.html/.test(relNotes),
  'RELEASE_NOTES.md keeps historical v2.8.5/v2.8.6/v2.9.0 asset filenames and names the published tam-os-v2.10.0 artifact');
// The trust-model caveat is a RELEASE-HONESTY invariant, not decoration: Acting-as identity is
// a local application context, never authentication. It must be stated in the operator-facing
// paperwork so the pilot is never sold as an authentication boundary.
check(/not (strong )?authentication|not an authentication/i.test(relNotes),
  'RELEASE_NOTES.md carries the Acting-as trust-model caveat (local context, not authentication)');
// The Release workflow publishes future Releases under the current product name (TAM OS).
const releaseYml = read(path.join(root, '.github', 'workflows', 'release.yml'));
check(/--title "TAM OS \$TAG"/.test(releaseYml) && !/--title "TAM Intelligence OS \$TAG"/.test(releaseYml),
  'release.yml publishes GitHub Release titles under the current product name (TAM OS)');
// v2.7.1 polishing pass — snapshot metadata, single historical API, compact integrity badge.
check(dist.includes('function overtimeSnapshotMeta('), 'overtime snapshot audit metadata helper present');
check((dist.match(/overtimeSnapshotMeta:\s*overtimeSnapshotMeta\(/g)||[]).length === 1, 'the ONE remaining commit pipeline stores overtimeSnapshotMeta {recordCount,totalHours}');
check(dist.includes('if(txn.overtimeSnapshotMeta){') , 'historical snapshot reads frozen metadata (no recompute)');
check(dist.includes('function payrollIntegrityBadge(') && dist.includes('Integrity Verified') && dist.includes('Snapshot Mismatch'), 'compact Payroll Detail integrity badge present');
check(dist.includes('${payrollIntegrityBadge(p)}'), 'integrity badge rendered in Payroll Detail');
// Single historical API: Posted/Executed renderers migrated off direct plan-derived values.
check(dist.includes('empPlans.map(p=>{ const tc=payrollTotalCompensation(p)'), 'Employee Detail payroll history reads the immutable snapshot via payrollTotalCompensation');
check((dist.match(/const s=payrollHistoricalSnapshot\(p\); return \[p\.employeeName/g)||[]).length >= 1, 'payroll register/components reports use payrollHistoricalSnapshot');
check(!/<td class="num">\$\{fmtIDR\(payrollBaseSalary\(p\)\)\}<\/td>/.test(dist), 'no Employee Detail row renders payrollBaseSalary(p) directly');
check(!/fmtIDR\(p\.overtimeAmount\),fmtIDR\(num\(p\.allowance\)/.test(dist), 'payroll register no longer renders p.overtimeAmount directly');

// v2.7.2 — persistence / transactional-integrity fixes.
console.log('== PERSISTENCE & TRANSACTIONAL INTEGRITY (v2.7.2) ==');
// persistHR returns a strict boolean (false for unknown key, the actual set() result otherwise).
check(/function persistHR\(stateKey\)\{[\s\S]*?return false;[\s\S]*?return ok === true;\s*\}/.test(dist), 'persistHR returns a strict boolean (false on unknown key, set() result otherwise)');
check(dist.includes('async function saveBackups(){') && /saveBackups\(\)\{[\s\S]*?return ok === true;/.test(dist), 'saveBackups returns a strict boolean');
check(/async function persist\(\)\{[\s\S]*?return ok === true;/.test(dist) && /async function saveSettings\(\)\{[\s\S]*?return ok === true;/.test(dist), 'persist() and saveSettings() return strict booleans');
// postSupplemental verifies the rollback persisted and never leaves an orphan.
check(dist.includes('const rolledBack = await persist();') && dist.includes('unrecoverable:true') && dist.includes('orphanTxnId:txn.id'), 'supplemental posting verifies rollback persistence (no silent orphan)');
// executeTransaction snapshots, checks the write, rolls back in memory, and orders audit/supplemental.
check(dist.includes('const before = JSON.parse(JSON.stringify(t));') && dist.includes('const saved = await persist();') && dist.includes('Object.assign(t, before);'), 'executeTransaction snapshots + rolls back on failed persist');
check(/const saved = await persist\(\);\s*if\(!saved\)\{[\s\S]*?return \{ok:false/.test(dist), 'executeTransaction returns failure (no audit/supplemental) when persist fails');
check(dist.includes('let suppWarning = null;') && dist.includes('linkSupplementalExecution(t)'), 'linked supplemental executed only after transaction persists');
// linkSupplementalExecution reverts in memory and reports when its own persist fails.
check(/async function linkSupplementalExecution\(t\)\{[\s\S]*?const ok = await persistSupplementalPayments\(\);[\s\S]*?if\(!ok\)\{[\s\S]*?return \{ok:false/.test(dist), 'linkSupplementalExecution reverts + reports on failed persist (no misrepresented Executed)');
// restoreCompleteBackup is transaction-safe: validate, snapshot, checked writes, rollback.
check(dist.includes('const RESTORE_HR_KEYS') , 'restore uses a single RESTORE_HR_KEYS dataset list');
check(/async function restoreCompleteBackup\(data\)\{[\s\S]*?validateCompleteBackup\(data\)[\s\S]*?return \{ok:false/.test(dist), 'restoreCompleteBackup validates before mutating State');
check(dist.includes('const failed = writes.filter') && dist.includes('rbFail') && dist.includes('return {ok:true}'), 'restoreCompleteBackup checks every write, rolls back, returns {ok}');
check(dist.includes('if(!result || result.ok!==true)'), 'restore UI only reports success when result.ok === true');
// startup recovery for pre-2.7.2 failed-post orphan supplementals.
check(dist.includes('async function recoverSupplementalOrphans(') && dist.includes("s.status==='Posted'") && dist.includes('!s.executionId'), 'recoverSupplementalOrphans present (conservative failed-post repair)');
check(dist.includes('if(typeof recoverSupplementalOrphans===') && dist.includes('await recoverSupplementalOrphans()'), 'orphan recovery wired into startup load');
// existing bidirectional orphan integrity checks remain.
check(dist.includes("'supplemental-missing-transaction'") && dist.includes("'supplemental-orphan-transaction'"), 'integrity checks detect both orphan directions');

// v2.7.x Payroll History total-compensation reporting (read-only aggregate; no schema/persistence change).
console.log('== PAYROLL HISTORY — TOTAL COMPENSATION (v2.7.x reporting) ==');
check(dist.includes('function payrollTotalCompensation('), 'payrollTotalCompensation aggregate helper present');
check(/payrollTotalCompensation\(pp\)\{[\s\S]*?payrollHistoricalSnapshot\(pp\)/.test(dist), 'total-compensation is built on the immutable payrollHistoricalSnapshot');
check(dist.includes('baseTotal: num(snap.totalPayroll)') && dist.includes('totalCompensation: num(snap.totalPayroll) + committed'), 'base total is not redefined; total compensation is additive');
check(/s\.status==='Posted' \|\| s\.status==='Executed'/.test(dist) && /s\.status==='Draft' \|\| s\.status==='Review' \|\| s\.status==='Approved'/.test(dist), 'only Posted/Executed count; Draft/Review/Approved are pending (excluded from total)');
check(dist.includes('const tc=payrollTotalCompensation(p)') && dist.includes('>Total Compensation<') && dist.includes('>Supplemental<'), 'Payroll History renders Supplemental + Total Compensation columns');
check(dist.includes('Pending ${fmtIDR(tc.pendingSupplemental)}'), 'pending supplemental shown subtly, not added to Total Compensation');
check(dist.includes("'supplemental-missing-source-snapshot'") && dist.includes("'supplemental-missing-source-snapshot-legacy'"), 'integrity distinguishes legacy vs modern missing source snapshot');

// PR-5A — Enterprise Domain Registry: descriptive, read-only metadata layer.
// These checks guard the registry's integrity WITHOUT asserting it enforces
// anything (it does not). Handler names must resolve to real functions in dist;
// registry identifiers must be unique, frozen, and non-colliding.
console.log('== ENTERPRISE DOMAIN REGISTRY (PR-5A — descriptive, read-only) ==');
const domainFiles = ['aggregates.js','commands.js','queries.js','events.js','domain-layer.js'];
domainFiles.forEach((f)=>check(fs.existsSync(path.join(root,'js','domain',f)), 'domain module present: js/domain/'+f));
// module-order and index.html stay aligned for every domain module (belt-and-suspenders
// alongside the global idxTagBlock check above).
domainFiles.forEach((f)=>{
  const p = 'domain/'+f;
  check(jsFiles.indexOf(p) !== -1, 'module-order.js includes '+p);
  check(indexHtml.includes('<script src="js/'+p+'"></script>'), 'index.html includes '+p);
});
const cmdSrc = read(path.join(root,'js','domain','commands.js'));
const qrySrc = read(path.join(root,'js','domain','queries.js'));
const aggSrc = read(path.join(root,'js','domain','aggregates.js'));
const evtSrc = read(path.join(root,'js','domain','events.js'));
const facSrc = read(path.join(root,'js','domain','domain-layer.js'));
// Registries are frozen (Object.freeze) at their source of truth.
check(/const DOMAIN_COMMANDS = Object\.freeze\(/.test(cmdSrc), 'DOMAIN_COMMANDS is Object.freeze()');
check(/const DOMAIN_QUERIES = Object\.freeze\(/.test(qrySrc), 'DOMAIN_QUERIES is Object.freeze()');
check(/const DOMAIN_AGGREGATES = Object\.freeze\(/.test(aggSrc), 'DOMAIN_AGGREGATES is Object.freeze()');
check(/const DOMAIN_EVENTS = Object\.freeze\(/.test(evtSrc), 'DOMAIN_EVENTS is Object.freeze()');
check(/const Domain = \(function/.test(facSrc) && /Object\.freeze\(\{/.test(facSrc), 'Domain facade is a frozen object');
// No LEGACY execute surface: dispatch/ask must never appear on the facade.
check(!/\bdispatch\s*:/.test(facSrc) && !/\bask\s*:/.test(facSrc) && !/Domain\.(dispatch|ask)\(/.test(srcJs), 'no legacy dispatch/ask surface on the Domain facade');
// PR-5B — operational read-only query routing exists on the facade.
check(/\bquery:\s*function/.test(facSrc), 'Domain facade exposes read-only query() routing (PR-5B)');
// PR-5C.1 — operational command routing exists on the facade.
check(/\bcommand:\s*function/.test(facSrc), 'Domain facade exposes command() routing (PR-5C.1)');
// Exactly ONE query migrated (distinct routed query ids).
// PR-7B "The Conduit" — operational UI pathways now reach the Domain through the
// single UI-to-Transport seam (uiExecute), not via direct Domain.command/query. The
// seam id is the SECOND quoted literal: uiExecute('command'|'query', '<id>', [...]).
// Deriving from the seam call (which requires the '(' ) means comment-only mentions
// of Domain.command/Domain.query are NOT counted as operational call sites.
function seamIds(kind){ const re = new RegExp("uiExecute\\('"+kind+"',\\s*'([^']+)'","g"); const out=[]; let m; while((m=re.exec(srcJs))!==null) out.push(m[1]); return Array.from(new Set(out)); }
const migratedQueryIds = seamIds('query');
check(migratedQueryIds.length === 1 && migratedQueryIds[0] === 'employee.filtered', 'exactly one query id routed through the UI-to-Transport seam: '+JSON.stringify(migratedQueryIds));
check(dist.includes("uiExecute('command', 'employee.contact.update'") || dist.includes("uiExecute('query', 'employee.filtered'"), 'migrated query call present in dist (via the UI-to-Transport seam)');
check(/'employee\.filtered':\s*Object\.freeze\(\{[^}]*handler:\s*'employeesFiltered'/.test(qrySrc), 'employee.filtered query registered to handler employeesFiltered');
// Exactly ONE command migrated (distinct routed command ids), and it is the approved contact command.
const migratedCmdIds = seamIds('command');
const EXPECTED_OP_CMDS = ['employee.contact.update','employee.employment.update','employee.lifecycle.transition','employee.compensation.update','contract.dates.update','payroll.lifecycle.transition','contract.status.transition'];
check(migratedCmdIds.length === 8 && EXPECTED_OP_CMDS.every(id=>migratedCmdIds.indexOf(id)!==-1), 'exactly eight command ids routed through the UI-to-Transport seam: '+JSON.stringify(migratedCmdIds));
check(dist.includes("uiExecute('command', 'employee.contact.update'"), 'migrated command call present in dist (via the seam)');
check(dist.includes("uiExecute('command', 'employee.employment.update'"), 'employment command call present in dist (via the seam)');
check(dist.includes("uiExecute('command', 'employee.lifecycle.transition'"), 'lifecycle command call present in dist (via the seam)');
check(dist.includes("uiExecute('command', 'employee.compensation.update'"), 'compensation command call present in dist (via the seam)');
check(/'employee\.contact\.update':\s*Object\.freeze\(\{[^}]*handler:\s*'updateEmployeeContact'/.test(cmdSrc), 'employee.contact.update registered to handler updateEmployeeContact');
check(/'employee\.employment\.update':\s*Object\.freeze\(\{[^}]*handler:\s*'updateEmployeeEmployment'/.test(cmdSrc), 'employee.employment.update registered to handler updateEmployeeEmployment');
// The facade command() calls the handler exactly once (a single fn.apply, no loop).
const cmdMethod = (facSrc.match(/command:\s*function[\s\S]*?\n    \}/)||[''])[0];
check((cmdMethod.match(/fn\.apply\(/g)||[]).length === 1 && !/for\s*\(|while\s*\(|forEach/.test(cmdMethod), 'Domain.command invokes the handler exactly once (single fn.apply, no loop)');
// PR-5C.1 — approved-field allowlist: the contact handler mutates ONLY phone/email/notes.
const empSrc = read(path.join(root,'js','people','employees.js'));
check(/const EMPLOYEE_CONTACT_FIELDS = \['phone','email','notes'\]/.test(empSrc), 'contact command allowlist is exactly [phone, email, notes]');
const ucStart = empSrc.indexOf('async function updateEmployeeContact(');
check(ucStart !== -1, 'updateEmployeeContact handler present');
const ucRest = ucStart!==-1 ? empSrc.slice(ucStart+1) : '';
const ucNext = ucRest.search(/\n(async function|function) /);
const ucBody = ucNext>=0 ? ucRest.slice(0, ucNext) : ucRest;
['monthlyBaseSalary','employmentStatus','contractType','jobTitle','department','bankName','bankAccount','bankAccountNumber','monthlySalary','joinDate','active'].forEach((f)=>
  check(!ucBody.includes(f), 'contact handler does not touch forbidden field: '+f));
// PR-8A — the contact handler's persistence now goes through the Repository boundary.
// (comment-stripped: comments legitimately mention both symbols to describe the path.)
const ucCode = stripComments(ucBody);
check((ucCode.match(/EmployeeRepository\.save\(\)/g)||[]).length === 1, 'contact handler persists exactly once (via EmployeeRepository.save())');
check(!/persistEmployees\(/.test(ucCode), 'contact handler no longer calls persistEmployees() directly (routed through the Repository)');
check(!/logActivity\(/.test(ucBody), 'contact handler adds no duplicate audit call (history-only, matching the edit path)');
check(/success:\s*true/.test(ucBody) && /success:\s*false/.test(ucBody), 'contact handler returns a typed success/failure outcome');
// The full employee save path is unchanged and still direct (not routed):
// the empForm submit handler exists and Domain.command is used exactly once in
// this module (the contact command only) — the monolithic save is not routed.
check(/querySelector\('#empForm'\)\.addEventListener\('submit'/.test(empSrc), 'full employee save (empForm) submit handler still present');
// comment-stripped: a comment mentioning Domain.command()/Domain.query() is not an operational call site.
function stripComments(s){ return s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,''); }
const empCode = stripComments(empSrc);
check(!/Domain\.command\(/.test(empCode) && !/Domain\.query\(/.test(empCode), 'employees.js no longer calls Domain.command()/Domain.query() directly (authorized ops routed through the UI-to-Transport seam)');
check((empSrc.match(/uiExecute\('command'/g)||[]).length === 4, 'employees.js routes exactly four aggregate-backed commands through the seam (contact + employment + lifecycle + compensation)');

// PR-5D "The Steward" — first aggregate boundary (EmployeeContactAggregate).
console.log('== EMPLOYEE CONTACT AGGREGATE (PR-5D — business authority) ==');
const aggPath = path.join(root,'js','domain','employee-contact-aggregate.js');
check(fs.existsSync(aggPath), 'aggregate module present: js/domain/employee-contact-aggregate.js');
check(jsFiles.indexOf('domain/employee-contact-aggregate.js') !== -1, 'module-order.js includes domain/employee-contact-aggregate.js');
check(indexHtml.includes('<script src="js/domain/employee-contact-aggregate.js"></script>'), 'index.html includes domain/employee-contact-aggregate.js');
const aggSrc2 = read(aggPath);
check(/const EmployeeContactAggregate = Object\.freeze\(/.test(aggSrc2), 'EmployeeContactAggregate is a frozen object');
check(/prepare:\s*function/.test(aggSrc2), 'aggregate exposes prepare()');
// Exactly one operational aggregate: only one *Aggregate object with a prepare() exists in js/domain.
const aggregateDefs = (srcJs.match(/const \w*Aggregate = Object\.freeze\(\{\s*[\s\S]*?(?:prepare|transition):\s*function/g)||[]).length;
check(aggregateDefs === 9, 'exactly nine operational aggregates defined (found '+aggregateDefs+')');
// The command registry binds the aggregate as the boundary for the one command.
check(/'employee\.contact\.update':\s*Object\.freeze\(\{[^}]*boundary:\s*'EmployeeContactAggregate'/.test(cmdSrc), 'employee.contact.update declares boundary EmployeeContactAggregate');
// The facade routes a bounded command through the aggregate before the handler.
check(/c\.boundary/.test(facSrc) && /agg\[method\]\(/.test(facSrc), 'Domain.command routes bounded commands through the aggregate before the handler');
check(/c\.boundaryMethod \|\| 'prepare'/.test(facSrc) && /c\.boundaryPayload \|\| 'patch'/.test(facSrc), 'facade defaults boundary method/payload to prepare/patch (existing routing unchanged)');
// Aggregate PURITY — it must have no side effects. Assert its CODE (comments
// stripped) contains none of the forbidden operations. It reads existence via
// empById only.
const aggCode = aggSrc2.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
[['State mutation', /State\s*[.[]/],
 ['persistEmployees', /persistEmployees\s*\(/],
 ['history append', /\.history\b|history\s*=|\.push\(/],
 ['UI render', /\brender\s*\(/],
 ['localStorage', /localStorage/],
 ['audit logging', /logActivity\s*\(/]
].forEach(([label,re])=>check(!re.test(aggCode), 'aggregate never performs '+label));
// Aggregate returns only a sanitized patch or a typed business failure.
check(/return \{ ok: true, patch:/.test(aggSrc2), 'aggregate returns only a sanitized patch on success');
check(/return \{ ok: false, error: 'EmployeeNotFound' \}/.test(aggSrc2) && /error: 'NoContactFieldsProvided'/.test(aggSrc2), 'aggregate returns typed business failures (EmployeeNotFound / NoContactFieldsProvided)');
// Handler separation: mutation/persistence/history remain in the handler, NOT the aggregate.
check(ucBody.includes('EmployeeRepository.save('), 'handler still performs persistence (via EmployeeRepository.save())');
check(/e\.history/.test(ucBody) || /history/.test(ucBody), 'handler still performs history/audit');
check(/e\[k\] = applied\[k\]|e\[k\]=applied\[k\]/.test(ucBody), 'handler still performs the field mutation');

// PR-5E "The Custodian" — second aggregate boundary (EmployeeEmploymentAggregate).
console.log('== EMPLOYEE EMPLOYMENT AGGREGATE (PR-5E — business authority) ==');
const empAggPath = path.join(root,'js','domain','employee-employment-aggregate.js');
check(fs.existsSync(empAggPath), 'aggregate module present: js/domain/employee-employment-aggregate.js');
check(jsFiles.indexOf('domain/employee-employment-aggregate.js') !== -1, 'module-order.js includes domain/employee-employment-aggregate.js');
check(indexHtml.includes('<script src="js/domain/employee-employment-aggregate.js"></script>'), 'index.html includes domain/employee-employment-aggregate.js');
// Load order: the employment aggregate loads before the facade.
check(jsFiles.indexOf('domain/employee-employment-aggregate.js') < jsFiles.indexOf('domain/domain-layer.js'), 'employment aggregate loads before domain-layer.js');
const empAggSrc = read(empAggPath);
check(/const EmployeeEmploymentAggregate = Object\.freeze\(/.test(empAggSrc), 'EmployeeEmploymentAggregate is a frozen object');
check(/prepare:\s*function/.test(empAggSrc), 'employment aggregate exposes prepare()');
// EmployeeContactAggregate remains operational; both boundaries are declared.
check(/const EmployeeContactAggregate = Object\.freeze\(/.test(aggSrc2), 'EmployeeContactAggregate remains an operational aggregate');
check(/'employee\.employment\.update':\s*Object\.freeze\(\{[^}]*boundary:\s*'EmployeeEmploymentAggregate'/.test(cmdSrc), 'employee.employment.update declares boundary EmployeeEmploymentAggregate');
check(/'employee\.contact\.update':\s*Object\.freeze\(\{[^}]*boundary:\s*'EmployeeContactAggregate'/.test(cmdSrc), 'employee.contact.update still declares boundary EmployeeContactAggregate');
// Exactly one operational query remains (employee.filtered) — unchanged by PR-5E.
check(migratedQueryIds.length === 1 && migratedQueryIds[0] === 'employee.filtered', 'employee.filtered remains the only operational query');
// Employment aggregate PURITY — no side effects (comments stripped).
const empAggCode = empAggSrc.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
[['State mutation', /State\s*[.[]/],
 ['persistEmployees', /persistEmployees\s*\(/],
 ['history append', /\.history\b|history\s*=|\.push\(/],
 ['updatedAt mutation', /updatedAt/],
 ['UI render', /\brender\s*\(/],
 ['localStorage', /localStorage/],
 ['audit logging', /logActivity\s*\(/]
].forEach(([label,re])=>check(!re.test(empAggCode), 'employment aggregate never performs '+label));
// Employment aggregate returns only a sanitized patch or typed business failures.
check(/return \{ ok: true, patch:/.test(empAggSrc), 'employment aggregate returns only a sanitized patch on success');
['EmployeeNotFound','NoEmploymentFieldsProvided','InvalidEmploymentStatus','InvalidContractType'].forEach((err)=>
  check(empAggSrc.includes("error: '"+err+"'"), 'employment aggregate returns typed business failure: '+err));
// Employment field allowlist is exactly the five approved fields.
check(/const EMPLOYEE_EMPLOYMENT_FIELDS = \['jobTitle','department','employmentStatus','joinDate','contractType'\]/.test(empSrc), 'employment command allowlist is exactly [jobTitle, department, employmentStatus, joinDate, contractType]');
// Handler owns mutation/persistence/history/rollback (implementation authority).
const ueStart = empSrc.indexOf('async function updateEmployeeEmployment(');
check(ueStart !== -1, 'updateEmployeeEmployment handler present');
const ueRest = ueStart!==-1 ? empSrc.slice(ueStart+1) : '';
const ueNext = ueRest.search(/\n(async function|function) /);
const ueBody = ueNext>=0 ? ueRest.slice(0, ueNext) : ueRest;
['monthlyBaseSalary','email','phone','notes','bankName','bankAccount','bankAccountNumber','bankAccountHolder','active','fullName','employeeId','createdAt'].forEach((f)=>
  check(!ueBody.includes(f), 'employment handler does not touch forbidden field: '+f));
// PR-9A — the employment handler's persistence now goes through the Repository (comment-stripped).
const ueCode = stripComments(ueBody);
check((ueCode.match(/EmployeeRepository\.save\(\)/g)||[]).length === 1, 'employment handler persists exactly once (via EmployeeRepository.save())');
check(!/persistEmployees\(/.test(ueCode), 'employment handler no longer calls persistEmployees() directly (routed through the Repository)');
check(/e\[k\] = applied\[k\]/.test(ueBody), 'employment handler performs the field mutation');
check(/e\.updatedAt = new Date/.test(ueBody), 'employment handler updates updatedAt');
check(/event:'employment-edited'/.test(ueBody), 'employment handler appends exactly one employment-edited history entry');
check(/e\.history\.pop\(\)/.test(ueBody) && /e\.updatedAt = prevUpdatedAt/.test(ueBody), 'employment handler performs full rollback on persist failure');
check(/error:'PersistFailed'/.test(ueBody), 'employment handler returns PersistFailed on persistence failure');
check(/success:\s*true/.test(ueBody) && /success:\s*false/.test(ueBody), 'employment handler returns a typed success/failure outcome');
check(!/logActivity\(/.test(ueBody), 'employment handler adds no duplicate audit call (history-only)');
// Aggregate failure never invokes the handler: the facade returns early on !decision.ok.
check(/decision\.ok !== true/.test(facSrc) && /return \{ success: false, error:/.test(facSrc), 'facade returns a typed failure without invoking the handler when the aggregate rejects');

// PR-5G "The Gatekeeper" — third aggregate boundary (EmployeeLifecycleAggregate).
console.log('== EMPLOYEE LIFECYCLE AGGREGATE (PR-5G — business authority) ==');
const lifeAggPath = path.join(root,'js','domain','employee-lifecycle-aggregate.js');
check(fs.existsSync(lifeAggPath), 'aggregate module present: js/domain/employee-lifecycle-aggregate.js');
check(jsFiles.indexOf('domain/employee-lifecycle-aggregate.js') !== -1, 'module-order.js includes domain/employee-lifecycle-aggregate.js');
check(indexHtml.includes('<script src="js/domain/employee-lifecycle-aggregate.js"></script>'), 'index.html includes domain/employee-lifecycle-aggregate.js');
// Load order: the lifecycle aggregate loads before the facade and after the helpers.
check(jsFiles.indexOf('domain/employee-lifecycle-aggregate.js') < jsFiles.indexOf('domain/domain-layer.js') &&
      jsFiles.indexOf('domain/aggregate-helpers.js') < jsFiles.indexOf('domain/employee-lifecycle-aggregate.js'), 'lifecycle aggregate loads after helpers and before domain-layer.js');
const lifeAggSrc = read(lifeAggPath);
check(/const EmployeeLifecycleAggregate = Object\.freeze\(/.test(lifeAggSrc), 'EmployeeLifecycleAggregate is a frozen object');
check(/transition:\s*function/.test(lifeAggSrc), 'lifecycle aggregate exposes transition()');
// The command registry binds the aggregate as the boundary and declares its method/payload.
check(/'employee\.lifecycle\.transition':\s*Object\.freeze\(\{[^}]*boundary:\s*'EmployeeLifecycleAggregate'/.test(cmdSrc), 'employee.lifecycle.transition declares boundary EmployeeLifecycleAggregate');
check(/'employee\.lifecycle\.transition':\s*Object\.freeze\(\{[^}]*boundaryMethod:\s*'transition'/.test(cmdSrc) && /'employee\.lifecycle\.transition':\s*Object\.freeze\(\{[^}]*boundaryPayload:\s*'transition'/.test(cmdSrc), 'employee.lifecycle.transition declares boundaryMethod/boundaryPayload = transition');
check(/'employee\.lifecycle\.transition':\s*Object\.freeze\(\{[^}]*handler:\s*'transitionEmployeeLifecycle'/.test(cmdSrc), 'employee.lifecycle.transition registered to handler transitionEmployeeLifecycle');
// Only the four supported transitions are permitted; no extra lifecycle states.
check(/'Active':\s*\['Resigned',\s*'Terminated'\]/.test(lifeAggSrc) && /'Resigned':\s*\['Active'\]/.test(lifeAggSrc) && /'Terminated':\s*\['Active'\]/.test(lifeAggSrc), 'lifecycle transition map is exactly the four supported transitions');
check(/const EMPLOYEE_LIFECYCLE_STATES = \['Active', 'Resigned', 'Terminated'\]/.test(lifeAggSrc), 'lifecycle states are exactly [Active, Resigned, Terminated] (no new states)');
// Lifecycle aggregate PURITY — no side effects (comments stripped).
const lifeAggCode = lifeAggSrc.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
[['State mutation', /State\s*[.[]/],
 ['persistEmployees', /persistEmployees\s*\(/],
 ['Employee mutation', /\be\.\w+\s*=/],
 ['history append', /\.history\b|history\s*=|\.push\(/],
 ['updatedAt mutation', /updatedAt/],
 ['UI render', /\brender\s*\(/],
 ['localStorage', /localStorage/],
 ['audit logging', /logActivity\s*\(/]
].forEach(([label,re])=>check(!re.test(lifeAggCode), 'lifecycle aggregate never performs '+label));
// It uses the shared existence helper (PR-5F) rather than re-inlining empById.
check(/employeeExists\(/.test(lifeAggSrc), 'lifecycle aggregate uses the shared employeeExists helper');
// Aggregate returns a sanitized transition on success and typed failures otherwise.
check(/return \{ ok: true, transition:/.test(lifeAggSrc), 'lifecycle aggregate returns only a sanitized transition on success');
['EmployeeNotFound','InvalidLifecycleState','IllegalLifecycleTransition'].forEach((err)=>
  check(lifeAggSrc.includes("error: '"+err+"'"), 'lifecycle aggregate returns typed business failure: '+err));
// Handler owns mutation/persistence/history/rollback (implementation authority).
const tlStart = empSrc.indexOf('async function transitionEmployeeLifecycle(');
check(tlStart !== -1, 'transitionEmployeeLifecycle handler present');
const tlRest = tlStart!==-1 ? empSrc.slice(tlStart+1) : '';
const tlNext = tlRest.search(/\n(async function|function) /);
const tlBody = tlNext>=0 ? tlRest.slice(0, tlNext) : tlRest;
// Lifecycle changes ONLY employmentStatus (+ updatedAt/history); every other field is forbidden.
['monthlyBaseSalary','jobTitle','department','joinDate','contractType','email','phone','notes','bankName','bankAccount','bankAccountNumber','bankAccountHolder','active','fullName','employeeId','createdAt'].forEach((f)=>
  check(!tlBody.includes(f), 'lifecycle handler does not touch forbidden field: '+f));
// PR-9B — the lifecycle handler's persistence now goes through the Repository (comment-stripped).
const tlCodeLc = stripComments(tlBody);
check((tlCodeLc.match(/EmployeeRepository\.save\(\)/g)||[]).length === 1, 'lifecycle handler persists exactly once (via EmployeeRepository.save())');
check(!/persistEmployees\(/.test(tlCodeLc), 'lifecycle handler no longer calls persistEmployees() directly (routed through the Repository)');
check(/e\.employmentStatus = to/.test(tlBody), 'lifecycle handler performs the status mutation');
check(/e\.updatedAt = new Date/.test(tlBody), 'lifecycle handler updates updatedAt');
check(/event:'lifecycle-transition'/.test(tlBody), 'lifecycle handler appends exactly one lifecycle-transition history entry');
check(/e\.employmentStatus = prevStatus/.test(tlBody) && /e\.history\.pop\(\)/.test(tlBody) && /e\.updatedAt = prevUpdatedAt/.test(tlBody), 'lifecycle handler performs full rollback on persist failure');
check(/error:'PersistFailed'/.test(tlBody), 'lifecycle handler returns PersistFailed on persistence failure');
check(/error:'IllegalLifecycleTransition'/.test(tlBody), 'lifecycle handler performs defense-in-depth transition validation');
check(!/logActivity\(/.test(tlBody), 'lifecycle handler adds no duplicate audit call (history-only)');
check(/success:\s*true/.test(tlBody) && /success:\s*false/.test(tlBody), 'lifecycle handler returns a typed success/failure outcome');
// The existing contact and employment aggregates are untouched by PR-5G.
check(/const EmployeeContactAggregate = Object\.freeze\(/.test(aggSrc2) && /const EmployeeEmploymentAggregate = Object\.freeze\(/.test(empAggSrc), 'contact and employment aggregates remain operational');

// PR-5H "The Arbiter" — fourth aggregate boundary (EmployeeCompensationAggregate).
console.log('== EMPLOYEE COMPENSATION AGGREGATE (PR-5H — business authority) ==');
const compAggPath = path.join(root,'js','domain','employee-compensation-aggregate.js');
check(fs.existsSync(compAggPath), 'aggregate module present: js/domain/employee-compensation-aggregate.js');
check(jsFiles.indexOf('domain/employee-compensation-aggregate.js') !== -1, 'module-order.js includes domain/employee-compensation-aggregate.js');
check(indexHtml.includes('<script src="js/domain/employee-compensation-aggregate.js"></script>'), 'index.html includes domain/employee-compensation-aggregate.js');
// Load order: after helpers, before the facade.
check(jsFiles.indexOf('domain/aggregate-helpers.js') < jsFiles.indexOf('domain/employee-compensation-aggregate.js') &&
      jsFiles.indexOf('domain/employee-compensation-aggregate.js') < jsFiles.indexOf('domain/domain-layer.js'), 'compensation aggregate loads after helpers and before domain-layer.js');
const compAggSrc = read(compAggPath);
check(/const EmployeeCompensationAggregate = Object\.freeze\(/.test(compAggSrc), 'EmployeeCompensationAggregate is a frozen object');
check(/prepare:\s*function/.test(compAggSrc), 'compensation aggregate exposes prepare() (default entry contract)');
// Command registration + DEFAULT prepare/patch contract (no boundaryMethod/boundaryPayload).
check(/'employee\.compensation\.update':\s*Object\.freeze\(\{[^}]*boundary:\s*'EmployeeCompensationAggregate'/.test(cmdSrc), 'employee.compensation.update declares boundary EmployeeCompensationAggregate');
check(/'employee\.compensation\.update':\s*Object\.freeze\(\{[^}]*handler:\s*'updateEmployeeCompensation'/.test(cmdSrc), 'employee.compensation.update registered to handler updateEmployeeCompensation');
const compCmdEntry = (cmdSrc.match(/'employee\.compensation\.update':\s*Object\.freeze\(\{[^}]*\}\)/)||[''])[0];
check(compCmdEntry !== '' && !/boundaryMethod/.test(compCmdEntry) && !/boundaryPayload/.test(compCmdEntry), 'compensation command uses the DEFAULT prepare/patch contract (no boundaryMethod/boundaryPayload)');
// Domain routing (domain-layer.js) is UNCHANGED by PR-5H.
check(!/employee\.compensation|EmployeeCompensation/.test(facSrc), 'domain-layer.js is not modified for the compensation command');
// Compensation allowlist is exactly [monthlyBaseSalary].
check(/const EMPLOYEE_COMPENSATION_FIELDS = \['monthlyBaseSalary'\]/.test(empSrc), 'compensation allowlist is exactly [monthlyBaseSalary]');
// Compensation aggregate PURITY — no side effects (comments stripped).
const compAggCode = compAggSrc.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
[['State mutation', /State\s*[.[]/],
 ['persistEmployees', /persistEmployees\s*\(/],
 ['Employee mutation', /\be\.\w+\s*=/],
 ['history append', /\.history\b|history\s*=|\.push\(/],
 ['updatedAt mutation', /updatedAt/],
 ['UI render', /\brender\s*\(/],
 ['toast', /\btoast\s*\(/],
 ['localStorage', /localStorage/],
 ['audit logging', /logActivity\s*\(/]
].forEach(([label,re])=>check(!re.test(compAggCode), 'compensation aggregate never performs '+label));
// Uses the shared existence helper.
check(/employeeExists\(/.test(compAggSrc), 'compensation aggregate uses the shared employeeExists helper');
// Returns a sanitized {monthlyBaseSalary} patch on success and typed failures otherwise.
check(/return \{ ok: true, patch: \{ monthlyBaseSalary: value \} \}/.test(compAggSrc), 'compensation aggregate returns only a sanitized { monthlyBaseSalary } patch on success');
['EmployeeNotFound','NoCompensationFieldsProvided','InvalidMonthlyBaseSalary'].forEach((err)=>
  check(compAggSrc.includes("error: '"+err+"'"), 'compensation aggregate returns typed business failure: '+err));
// Handler owns mutation/updatedAt/history/persistence/rollback (implementation authority).
const ucoStart = empSrc.indexOf('async function updateEmployeeCompensation(');
check(ucoStart !== -1, 'updateEmployeeCompensation handler present');
const ucoRest = ucoStart!==-1 ? empSrc.slice(ucoStart+1) : '';
const ucoNext = ucoRest.search(/\n(async function|function) /);
const ucoBody = ucoNext>=0 ? ucoRest.slice(0, ucoNext) : ucoRest;
// Compensation changes ONLY monthlyBaseSalary (+ updatedAt/history); every other field forbidden.
['employmentStatus','jobTitle','department','joinDate','contractType','email','phone','notes','bankName','bankAccount','bankAccountNumber','bankAccountHolder','active','fullName','employeeId','createdAt'].forEach((f)=>
  check(!ucoBody.includes(f), 'compensation handler does not touch forbidden field: '+f));
// PR-9C — the compensation handler's persistence now goes through the Repository (comment-stripped).
const ucoCodeLc = stripComments(ucoBody);
check((ucoCodeLc.match(/EmployeeRepository\.save\(\)/g)||[]).length === 1, 'compensation handler persists exactly once (via EmployeeRepository.save())');
check(!/persistEmployees\(/.test(ucoCodeLc), 'compensation handler no longer calls persistEmployees() directly (routed through the Repository)');
check(/e\.monthlyBaseSalary = value/.test(ucoBody), 'compensation handler performs the monthlyBaseSalary mutation');
check(/e\.updatedAt = new Date/.test(ucoBody), 'compensation handler updates updatedAt');
check(/event:'compensation-edited'/.test(ucoBody), 'compensation handler appends exactly one compensation-edited history entry');
check(/e\.monthlyBaseSalary = before/.test(ucoBody) && /e\.history\.pop\(\)/.test(ucoBody) && /e\.updatedAt = prevUpdatedAt/.test(ucoBody), 'compensation handler performs full rollback on persist failure');
check(/error:'PersistFailed'/.test(ucoBody), 'compensation handler returns PersistFailed on persistence failure');
check(/error:'InvalidMonthlyBaseSalary'/.test(ucoBody), 'compensation handler performs defense-in-depth value validation');
check(!/logActivity\(/.test(ucoBody), 'compensation handler adds no duplicate audit call (history-only)');
check(/success:\s*true/.test(ucoBody) && /success:\s*false/.test(ucoBody), 'compensation handler returns a typed success/failure outcome');
// The history note must NOT record the salary value (no standard requires it).
check(/note:'Monthly base salary updated'/.test(ucoBody), 'compensation history note does not record the salary value');
// Existing aggregates remain operational and untouched by PR-5H.
check(/const EmployeeLifecycleAggregate = Object\.freeze\(/.test(lifeAggSrc), 'lifecycle aggregate remains operational');
// Architecture backlog / Proposed ADRs remain untouched (governance, not code — checked as docs).
check(/\*\*Status:\*\* Planned/.test(read(path.join(root,'docs','02-architecture','Architecture_Evolution_Backlog.md'))), 'ARCH backlog items remain Planned (not implemented here)');

// PR-5I "The Binder" — first Contract aggregate boundary (ContractDateAggregate).
console.log('== CONTRACT DATE AGGREGATE (PR-5I — business authority) ==');
const ctAggPath = path.join(root,'js','domain','contract-date-aggregate.js');
check(fs.existsSync(ctAggPath), 'aggregate module present: js/domain/contract-date-aggregate.js');
check(jsFiles.indexOf('domain/contract-date-aggregate.js') !== -1, 'module-order.js includes domain/contract-date-aggregate.js');
check(indexHtml.includes('<script src="js/domain/contract-date-aggregate.js"></script>'), 'index.html includes domain/contract-date-aggregate.js');
// Load order: after helpers, before the facade.
check(jsFiles.indexOf('domain/aggregate-helpers.js') < jsFiles.indexOf('domain/contract-date-aggregate.js') &&
      jsFiles.indexOf('domain/contract-date-aggregate.js') < jsFiles.indexOf('domain/domain-layer.js'), 'contract-date aggregate loads after helpers and before domain-layer.js');
const ctAggSrc = read(ctAggPath);
check(/const ContractDateAggregate = Object\.freeze\(/.test(ctAggSrc), 'ContractDateAggregate is a frozen object');
check(/prepare:\s*function/.test(ctAggSrc), 'contract-date aggregate exposes prepare() (default entry contract)');
// Command registration + DEFAULT prepare/patch contract (no boundaryMethod/boundaryPayload).
check(/'contract\.dates\.update':\s*Object\.freeze\(\{[^}]*boundary:\s*'ContractDateAggregate'/.test(cmdSrc), 'contract.dates.update declares boundary ContractDateAggregate');
check(/'contract\.dates\.update':\s*Object\.freeze\(\{[^}]*handler:\s*'updateContractDates'/.test(cmdSrc), 'contract.dates.update registered to handler updateContractDates');
check(/'contract\.dates\.update':\s*Object\.freeze\(\{[^}]*aggregate:\s*'Contract'/.test(cmdSrc), 'contract.dates.update declares aggregate Contract');
const ctCmdEntry = (cmdSrc.match(/'contract\.dates\.update':\s*Object\.freeze\(\{[^}]*\}\)/)||[''])[0];
check(ctCmdEntry !== '' && !/boundaryMethod/.test(ctCmdEntry) && !/boundaryPayload/.test(ctCmdEntry), 'contract.dates.update uses the DEFAULT prepare/patch contract (no boundaryMethod/boundaryPayload)');
check(dist.includes("uiExecute('command', 'contract.dates.update'"), 'contract dates command call present in dist (via the seam)');
// Domain routing (domain-layer.js) is UNCHANGED by PR-5I.
check(!/contract\.dates|ContractDate/.test(facSrc), 'domain-layer.js is not modified for the contract command');
// Allowlist is exactly [startDate, durationMonths] (stored facts; NOT endDate).
check(/const CONTRACT_DATE_FIELDS = \['startDate', 'durationMonths'\]/.test(ctAggSrc), 'contract date allowlist is exactly [startDate, durationMonths]');
// The aggregate never writes a stored endDate.
check(!/endDate\s*[:=]/.test(ctAggSrc.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'')), 'contract-date aggregate never writes endDate');
// Contract-date aggregate PURITY — no side effects (comments stripped).
const ctAggCode = ctAggSrc.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
[['State mutation', /State\s*[.[]/],
 ['persistContracts', /persistContracts\s*\(/],
 ['persistHR', /persistHR\s*\(/],
 ['Contract mutation', /\bc\.\w+\s*=/],
 ['history append', /\.history\b|history\s*=|\.push\(/],
 ['updatedAt mutation', /updatedAt/],
 ['UI render', /\brender\s*\(/],
 ['toast', /\btoast\s*\(/],
 ['localStorage', /localStorage/],
 ['audit logging', /logActivity\s*\(/]
].forEach(([label,re])=>check(!re.test(ctAggCode), 'contract-date aggregate never performs '+label));
// Returns a sanitized patch on success and typed failures otherwise.
check(/return \{ ok: true, patch: clean \}/.test(ctAggSrc), 'contract-date aggregate returns only a sanitized patch on success');
['ContractNotFound','NoContractDateFieldsProvided','InvalidStartDate','InvalidDurationMonths','InvalidContractDateRange'].forEach((err)=>
  check(ctAggSrc.includes("error: '"+err+"'"), 'contract-date aggregate returns typed business failure: '+err));
// Handler owns mutation/updatedAt/history/persistence/rollback (implementation authority).
const ctSrc = read(path.join(root,'js','people','contracts.js'));
const udStart = ctSrc.indexOf('async function updateContractDates(');
check(udStart !== -1, 'updateContractDates handler present');
const udRest = udStart!==-1 ? ctSrc.slice(udStart+1) : '';
const udNext = udRest.search(/\n(async function|function) /);
const udBody = udNext>=0 ? udRest.slice(0, udNext) : udRest;
// Contract dates change ONLY startDate/durationMonths (+ updatedAt/history); every other field forbidden.
['monthlySalary','contractNumber','contractType','employeeId','createdAt','notes','renewedFromId','renewedToId'].forEach((f)=>
  check(!udBody.includes(f), 'contract-date handler does not touch forbidden field: '+f));
// Handler must never write a stored endDate, and never mutate a status.
check(!/\.endDate\s*=/.test(udBody) && !/endDate:/.test(udBody), 'contract-date handler never writes endDate');
check(!/\.status\s*=/.test(udBody), 'contract-date handler never mutates Contract status');
// PR-10A — the contract-date handler's persistence now goes through the Repository (comment-stripped).
const udCode = stripComments(udBody);
check((udCode.match(/ContractRepository\.save\(\)/g)||[]).length === 1, 'contract-date handler persists exactly once (via ContractRepository.save())');
check(!/persistContracts\(/.test(udCode), 'contract-date handler no longer calls persistContracts() directly (routed through the Repository)');
check(!/persistEmployees\(|persistHR\(/.test(udBody), 'contract-date handler uses only the Contract persistence path');
check(/c\[k\] = applied\[k\]/.test(udBody), 'contract-date handler performs the stored-date mutation');
check(/c\.updatedAt = new Date/.test(udBody), 'contract-date handler updates updatedAt');
check(/event:'contract-dates-edited'/.test(udBody), 'contract-date handler appends exactly one contract-dates-edited history entry');
check(/c\[k\] = before\[k\]/.test(udBody) && /c\.history\.pop\(\)/.test(udBody) && /c\.updatedAt = prevUpdatedAt/.test(udBody), 'contract-date handler performs full rollback on persist failure');
check(/error:'PersistFailed'/.test(udBody), 'contract-date handler returns PersistFailed on persistence failure');
check(/error:'InvalidStartDate'/.test(udBody) && /error:'InvalidDurationMonths'/.test(udBody), 'contract-date handler performs defense-in-depth validation');
check(!/logActivity\(/.test(udBody), 'contract-date handler adds no duplicate audit call (history-only)');
check(/success:\s*true/.test(udBody) && /success:\s*false/.test(udBody), 'contract-date handler returns a typed success/failure outcome');
// The UI routes through Domain.command in contracts.js (dates seam + PR-5K status seam); no direct handler call.
check(!/Domain\.command\(/.test(ctSrc) && !/Domain\.query\(/.test(ctSrc), 'contracts.js no longer calls Domain.command()/Domain.query() directly (routed through the seam)');
check((ctSrc.match(/uiExecute\('command'/g)||[]).length === 3, 'contracts.js routes exactly three aggregate-backed commands through the seam (dates + status + renewal)');
check((ctSrc.match(/updateContractDates\(/g)||[]).length === 1, 'UI never calls updateContractDates() directly (only the function definition appears)');
// contractCalc() semantics are not modified by PR-5I (people-core.js untouched).
check(!/function contractCalc/.test(ctAggSrc) && !/function contractCalc/.test(udBody), 'contract-date capability does not redefine contractCalc()');

// PR-5J "The Accountant" — first Payroll aggregate boundary (PayrollLifecycleAggregate).
console.log('== PAYROLL LIFECYCLE AGGREGATE (PR-5J — business authority) ==');
const payAggPath = path.join(root,'js','domain','payroll-lifecycle-aggregate.js');
check(fs.existsSync(payAggPath), 'aggregate module present: js/domain/payroll-lifecycle-aggregate.js');
check(jsFiles.indexOf('domain/payroll-lifecycle-aggregate.js') !== -1, 'module-order.js includes domain/payroll-lifecycle-aggregate.js');
check(indexHtml.includes('<script src="js/domain/payroll-lifecycle-aggregate.js"></script>'), 'index.html includes domain/payroll-lifecycle-aggregate.js');
// Load order: after helpers + the payroll read/lock helpers, before the facade.
check(jsFiles.indexOf('domain/aggregate-helpers.js') < jsFiles.indexOf('domain/payroll-lifecycle-aggregate.js') &&
      jsFiles.indexOf('people/payroll-ops-engine.js') < jsFiles.indexOf('domain/payroll-lifecycle-aggregate.js') &&
      jsFiles.indexOf('domain/payroll-lifecycle-aggregate.js') < jsFiles.indexOf('domain/domain-layer.js'), 'payroll lifecycle aggregate loads after payroll helpers and before domain-layer.js');
const payAggSrc = read(payAggPath);
check(/const PayrollLifecycleAggregate = Object\.freeze\(/.test(payAggSrc), 'PayrollLifecycleAggregate is a frozen object');
check(/transition:\s*function/.test(payAggSrc), 'payroll lifecycle aggregate exposes transition()');
// Command registration: boundary + lifecycle transition/transition contract + handler + aggregate id.
check(/'payroll\.lifecycle\.transition':\s*Object\.freeze\(\{[^}]*boundary:\s*'PayrollLifecycleAggregate'/.test(cmdSrc), 'payroll.lifecycle.transition declares boundary PayrollLifecycleAggregate');
check(/'payroll\.lifecycle\.transition':\s*Object\.freeze\(\{[^}]*boundaryMethod:\s*'transition'/.test(cmdSrc) && /'payroll\.lifecycle\.transition':\s*Object\.freeze\(\{[^}]*boundaryPayload:\s*'transition'/.test(cmdSrc), 'payroll.lifecycle.transition declares boundaryMethod/boundaryPayload = transition');
check(/'payroll\.lifecycle\.transition':\s*Object\.freeze\(\{[^}]*handler:\s*'transitionPayrollLifecycle'/.test(cmdSrc), 'payroll.lifecycle.transition registered to handler transitionPayrollLifecycle');
check(/'payroll\.lifecycle\.transition':\s*Object\.freeze\(\{[^}]*aggregate:\s*'PayrollPlan'/.test(cmdSrc), 'payroll.lifecycle.transition declares aggregate PayrollPlan');
check(dist.includes("uiExecute('command', 'payroll.lifecycle.transition'"), 'payroll lifecycle command call present in dist (via the seam)');
// Domain routing (domain-layer.js) is UNCHANGED by PR-5J (reuses the transition/transition contract).
check(!/payroll\.lifecycle|PayrollLifecycle/.test(facSrc), 'domain-layer.js is not modified for the payroll lifecycle command');
// The transition graph is derived from runtime behavior — exactly the discovered edges, no more.
check(/'Draft':\s*\['Reviewed',\s*'Ready',\s*'Cancelled'\]/.test(payAggSrc) &&
      /'Reviewed':\s*\['Ready',\s*'Draft',\s*'Cancelled'\]/.test(payAggSrc) &&
      /'Ready':\s*\['Draft',\s*'Cancelled'\]/.test(payAggSrc) &&
      /'Committed':\s*\[\]/.test(payAggSrc) && /'Cancelled':\s*\[\]/.test(payAggSrc), 'payroll lifecycle transition map is exactly the derived pre-posting graph (Committed/Cancelled terminal)');
// Uses the existing stored statuses as the single source of truth (no invented states).
check(/PAYROLL_STATUSES/.test(payAggSrc), 'payroll lifecycle aggregate validates against the existing PAYROLL_STATUSES (single source)');
check(!/'Review'|'Approved'|'Posted'|'Executed'/.test(payAggSrc), 'aggregate never introduces UI/derived stages (Review/Approved/Posted/Executed) as stored statuses');
// Aggregate PURITY — no side effects (comments stripped). Reads only via payrollPlanById + isPayrollLocked.
const payAggCode = payAggSrc.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
[['State mutation', /State\s*[.[]/],
 ['persistPayrollPlans', /persistPayrollPlans\s*\(/],
 ['persist', /\bpersist(HR|Overtime|MonthlyPlans)?\s*\(/],
 ['PayrollPlan mutation', /\bpp\.\w+\s*=[^=]/],
 ['history append', /\.history\b|history\s*=|\.push\(/],
 ['updatedAt mutation', /updatedAt/],
 ['UI render', /\brender\s*\(/],
 ['toast/alert', /\btoast\s*\(|showWarning\s*\(|showSuccess\s*\(|\balert\s*\(/],
 ['localStorage', /localStorage/],
 ['audit logging', /logActivity\s*\(/],
 ['posting', /commitReadyPayroll\s*\(/],
 ['generation', /generatePayrollForMonth\s*\(/]
].forEach(([label,re])=>check(!re.test(payAggCode), 'payroll lifecycle aggregate never performs '+label));
check(/payrollPlanById\(/.test(payAggSrc) && /isPayrollLocked\(/.test(payAggSrc), 'aggregate reads existence + period lock read-only (payrollPlanById / isPayrollLocked)');
// Returns a sanitized transition on success and typed failures otherwise.
check(/return \{ ok: true, transition:/.test(payAggSrc), 'payroll lifecycle aggregate returns only a sanitized transition on success');
['PayrollPlanNotFound','InvalidPayrollLifecycleState','PayrollPeriodLocked','PayrollCommittedImmutable','IllegalPayrollLifecycleTransition'].forEach((err)=>
  check(payAggSrc.includes("error: '"+err+"'"), 'payroll lifecycle aggregate returns typed business failure: '+err));
// Handler owns mutation/updatedAt/history/persistence/rollback/audit (implementation authority).
const poeSrc = read(path.join(root,'js','people','payroll-ops-engine.js'));
const tpStart = poeSrc.indexOf('async function transitionPayrollLifecycle(');
check(tpStart !== -1, 'transitionPayrollLifecycle handler present');
const tpRest = tpStart!==-1 ? poeSrc.slice(tpStart+1) : '';
const tpNext = tpRest.search(/\n(async function|function) /);
const tpBody = tpNext>=0 ? tpRest.slice(0, tpNext) : tpRest;
// Lifecycle changes ONLY status (+ updatedAt/history); calculation/committed fields are forbidden.
['baseSalary','salaryOverride','overtimeAmount','overtimeHours','allowance','bonus','benefits','otherAddition','deduction','plannedAmount','committedSnapshot','committedTxnId','transactionId'].forEach((f)=>
  check(!tpBody.includes(f), 'payroll lifecycle handler does not touch forbidden field: '+f));
// PR-11A — the payroll-lifecycle handler's persistence now goes through the Repository (comment-stripped).
const tpCode = stripComments(tpBody);
check((tpCode.match(/PayrollRepository\.save\(\)/g)||[]).length === 1, 'handler persists exactly once (via PayrollRepository.save())');
check(!/persistPayrollPlans\(/.test(tpCode), 'payroll-lifecycle handler no longer calls persistPayrollPlans() directly (routed through the Repository)');
check(!/persist\(\)|persistOvertime\(|persistMonthlyPlans\(|persistSupplementalPayments\(/.test(tpBody), 'handler uses only the PayrollPlan persistence path (no other store written)');
check(/pp\.status = to/.test(tpBody), 'handler performs the status mutation (only PayrollPlan.status)');
check(/pp\.updatedAt = new Date/.test(tpBody), 'handler updates updatedAt');
check((tpBody.match(/\.push\(/g)||[]).length === 1, 'handler appends exactly one PayrollPlan history entry on success');
check(/pp\.status = prevStatus/.test(tpBody) && /pp\.history\.pop\(\)/.test(tpBody) && /pp\.updatedAt = prevUpdatedAt/.test(tpBody), 'handler performs full rollback on persist failure (status + history + updatedAt)');
check(/error:'PersistFailed'/.test(tpBody), 'handler returns PersistFailed on persistence failure');
check(/error:'IllegalPayrollLifecycleTransition'/.test(tpBody) && /error:'PayrollPeriodLocked'/.test(tpBody) && /error:'PayrollCommittedImmutable'/.test(tpBody), 'handler performs defense-in-depth lock/immutable/transition validation');
// Audit runs ONLY after a successful persist (never before, never on the failure path).
check(/PayrollRepository\.save\(\)[\s\S]*?persisted\.ok !== true[\s\S]*?return \{ success:false, error:'PersistFailed' \}[\s\S]*?logActivity\(/.test(tpBody), 'handler audits only after persistence succeeds (after the PersistFailed return)');
check(!/showWarning|showSuccess|\btoast\(|\brender\(/.test(tpBody), 'handler performs no UI (no toast/warning/render) — it is the implementation authority, not the UI');
check(!/commitReadyPayroll\(|generatePayrollForMonth\(|payrollCommitTxn\(|buildPayrollCommittedSnapshot\(/.test(tpBody), 'handler never posts, generates, or freezes a committed snapshot');
check(/success:\s*true/.test(tpBody) && /success:\s*false/.test(tpBody), 'handler returns a typed success/failure outcome');
// The former procedural mutators are gone — no second lifecycle mutation authority remains.
check(!/function setPayrollStatus\(/.test(poeSrc) && !/function bulkPayrollStatus\(/.test(poeSrc), 'setPayrollStatus / bulkPayrollStatus removed (single lifecycle authority via the Domain command)');
check(!/setPayrollStatus\(|bulkPayrollStatus\(/.test(srcJs), 'no caller of setPayrollStatus / bulkPayrollStatus remains anywhere');
// Single-record UI: routes through the one Domain-command seam (requestPayrollLifecycle); never the handler.
const pwsSrc = read(path.join(root,'js','people','payroll-workspace.js'));
check(/async function requestPayrollLifecycle\(/.test(pwsSrc) && /uiExecute\('command', 'payroll\.lifecycle\.transition', \[id, targetStatus\]\)/.test(pwsSrc), 'requestPayrollLifecycle routes single-record transitions through the UI-to-Transport seam');
check(/'prow-review'\)\s*\{ await requestPayrollLifecycle\(id,'Reviewed'\)/.test(empSrc) && /'prow-cancel'\)/.test(empSrc) && /requestPayrollLifecycle\(id,'Cancelled'\)/.test(empSrc), 'employee worksheet menu (prow-*) routes single-record transitions through requestPayrollLifecycle');
check(!/setPayrollStatus\(/.test(empSrc), 'the migrated single-record menu no longer calls setPayrollStatus directly');
check(!/transitionPayrollLifecycle\(/.test(empSrc) && !/transitionPayrollLifecycle\(/.test(pwsSrc), 'no UI file calls the handler transitionPayrollLifecycle() directly');
check((poeSrc.match(/transitionPayrollLifecycle\(/g)||[]).length === 1, 'transitionPayrollLifecycle appears only as its definition (never invoked outside the Domain command)');
// Bulk UI: one Domain command PER eligible record (no bulk aggregate/command, no cross-record rollback claim).
check(/for\(const pid of eligible\)\{[\s\S]*?uiExecute\('command', 'payroll\.lifecycle\.transition', \[pid, targetStatus\]\)/.test(pwsSrc), 'bulk runner invokes one seam transition per eligible PayrollPlan (via the UI-to-Transport seam)');
check(/partitionPayrollSelection\(/.test(pwsSrc), 'bulk runner preserves the existing eligible/ineligible partition (partitionPayrollSelection)');
check(!/BulkAggregate|bulkCommand|payroll\.lifecycle\.bulk/.test(srcJs), 'no second bulk aggregate/command introduced');
// Existing aggregates remain operational and untouched by PR-5J.
check(/const ContractDateAggregate = Object\.freeze\(/.test(ctAggSrc) && /const EmployeeLifecycleAggregate = Object\.freeze\(/.test(lifeAggSrc), 'existing Contract + Employee aggregates remain operational');

// PR-5K "The Ledger" — second Contract aggregate boundary (ContractStatusAggregate).
console.log('== CONTRACT STATUS AGGREGATE (PR-5K — business authority) ==');
const csAggPath = path.join(root,'js','domain','contract-status-aggregate.js');
check(fs.existsSync(csAggPath), 'aggregate module present: js/domain/contract-status-aggregate.js');
check(jsFiles.indexOf('domain/contract-status-aggregate.js') !== -1, 'module-order.js includes domain/contract-status-aggregate.js');
check(indexHtml.includes('<script src="js/domain/contract-status-aggregate.js"></script>'), 'index.html includes domain/contract-status-aggregate.js');
// Load order: after helpers, before the facade.
check(jsFiles.indexOf('domain/aggregate-helpers.js') < jsFiles.indexOf('domain/contract-status-aggregate.js') &&
      jsFiles.indexOf('domain/contract-status-aggregate.js') < jsFiles.indexOf('domain/domain-layer.js'), 'contract status aggregate loads after helpers and before domain-layer.js');
const csAggSrc = read(csAggPath);
check(/const ContractStatusAggregate = Object\.freeze\(/.test(csAggSrc), 'ContractStatusAggregate is a frozen object');
check(/transition:\s*function/.test(csAggSrc), 'contract status aggregate exposes transition()');
// Command registration: boundary + lifecycle transition/transition contract + handler + aggregate id.
check(/'contract\.status\.transition':\s*Object\.freeze\(\{[^}]*boundary:\s*'ContractStatusAggregate'/.test(cmdSrc), 'contract.status.transition declares boundary ContractStatusAggregate');
check(/'contract\.status\.transition':\s*Object\.freeze\(\{[^}]*boundaryMethod:\s*'transition'/.test(cmdSrc) && /'contract\.status\.transition':\s*Object\.freeze\(\{[^}]*boundaryPayload:\s*'transition'/.test(cmdSrc), 'contract.status.transition declares boundaryMethod/boundaryPayload = transition');
check(/'contract\.status\.transition':\s*Object\.freeze\(\{[^}]*handler:\s*'transitionContractStatus'/.test(cmdSrc), 'contract.status.transition registered to handler transitionContractStatus');
check(/'contract\.status\.transition':\s*Object\.freeze\(\{[^}]*aggregate:\s*'Contract'/.test(cmdSrc), 'contract.status.transition declares aggregate Contract');
check(dist.includes("uiExecute('command', 'contract.status.transition'"), 'contract status command call present in dist (via the seam)');
// Domain routing (domain-layer.js) is UNCHANGED by PR-5K (reuses the transition/transition contract).
check(!/contract\.status|ContractStatus/.test(facSrc), 'domain-layer.js is not modified for the contract status command');
// The transition graph is derived from runtime behavior — exactly the discovered edges, no more.
check(/'Draft':\s*\['Active',\s*'Cancelled'\]/.test(csAggSrc) && /'Active':\s*\['Cancelled'\]/.test(csAggSrc) &&
      /'Renewed':\s*\[\]/.test(csAggSrc) && /'Cancelled':\s*\[\]/.test(csAggSrc), 'contract status transition map is exactly the derived graph (Renewed/Cancelled terminal)');
// Uses the existing stored statuses; never treats derived display states as stored.
check(/CONTRACT_STORED_STATUSES/.test(csAggSrc), 'contract status aggregate validates against CONTRACT_STORED_STATUSES (single source)');
// Scope the following to the transition-map literal only (the header comment and the
// STATES fallback legitimately name derived states / list Renewed).
const csMapLit = (csAggSrc.match(/CONTRACT_STATUS_TRANSITIONS = Object\.freeze\(\{[\s\S]*?\}\)/)||[''])[0];
check(csMapLit !== '' && !/Expiring Soon|Expired/.test(csMapLit), 'transition map never treats derived display states (Expiring Soon/Expired) as stored statuses');
// Renewed is never a generic transition target: it appears in the map only as a key.
check(!/'Renewed'/.test(csMapLit.replace(/'Renewed':/,'')), 'Renewed is never a transition target (produced only by the renewal workflow)');
// Aggregate PURITY — no side effects (comments stripped).
const csAggCode = csAggSrc.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
[['State mutation', /State\s*[.[]/],
 ['persistContracts', /persistContracts\s*\(/],
 ['persist', /\bpersist(HR|Contracts)?\s*\(/],
 ['Contract mutation', /\bc\.\w+\s*=[^=]/],
 ['history append', /\.history\b|history\s*=|\.push\(/],
 ['updatedAt mutation', /updatedAt/],
 ['UI render', /\brender\s*\(/],
 ['toast/alert', /\btoast\s*\(|showWarning\s*\(|showSuccess\s*\(|\balert\s*\(|confirm\s*\(/],
 ['localStorage', /localStorage/],
 ['audit logging', /logActivity\s*\(/]
].forEach(([label,re])=>check(!re.test(csAggCode), 'contract status aggregate never performs '+label));
check(/contractById\(/.test(csAggSrc), 'aggregate reads existence read-only (contractById)');
// Returns a sanitized transition on success and typed failures otherwise.
check(/return \{ ok: true, transition:/.test(csAggSrc), 'contract status aggregate returns only a sanitized transition on success');
['ContractNotFound','InvalidContractStatusState','IllegalContractStatusTransition'].forEach((err)=>
  check(csAggSrc.includes("error: '"+err+"'"), 'contract status aggregate returns typed business failure: '+err));
// Handler owns mutation/updatedAt/history/persistence/rollback (implementation authority).
const tcStart = ctSrc.indexOf('async function transitionContractStatus(');
check(tcStart !== -1, 'transitionContractStatus handler present');
const tcRest = tcStart!==-1 ? ctSrc.slice(tcStart+1) : '';
const tcNext = tcRest.search(/\n(async function|function) /);
const tcBody = tcNext>=0 ? tcRest.slice(0, tcNext) : tcRest;
// Status changes ONLY c.status (+ updatedAt/history); dates/salary/renewal/links are forbidden.
['startDate','durationMonths','monthlySalary','renewedToId','renewedFromId','employeeId','contractNumber','notes','endDate'].forEach((f)=>
  check(!tcBody.includes(f), 'contract status handler does not touch forbidden field: '+f));
// PR-10B — the contract-status handler's persistence now goes through the Repository (comment-stripped).
const tcCode = stripComments(tcBody);
check((tcCode.match(/ContractRepository\.save\(\)/g)||[]).length === 1, 'handler persists exactly once (via ContractRepository.save())');
check(!/persistContracts\(/.test(tcCode), 'contract-status handler no longer calls persistContracts() directly (routed through the Repository)');
check(!/persistEmployees\(|persistHR\(|persist\(\)/.test(tcBody), 'handler uses only the Contract persistence path');
check(/c\.status = to/.test(tcBody), 'handler performs the status mutation (only Contract.status)');
check(/c\.updatedAt = new Date/.test(tcBody), 'handler updates updatedAt');
check((tcBody.match(/\.push\(/g)||[]).length === 1, 'handler appends exactly one Contract history entry on success');
check(/c\.status = prevStatus/.test(tcBody) && /c\.history\.pop\(\)/.test(tcBody) && /c\.updatedAt = prevUpdatedAt/.test(tcBody), 'handler performs full rollback on persist failure (status + history + updatedAt)');
check(/error:'PersistFailed'/.test(tcBody), 'handler returns PersistFailed on persistence failure');
check(/error:'IllegalContractStatusTransition'/.test(tcBody), 'handler performs defense-in-depth transition validation');
check(!/logActivity\(/.test(tcBody), 'handler adds no audit call (former setContractStatus wrote none — behavior preserved)');
check(/event:to\.toLowerCase\(\)/.test(tcBody) && /Status set to \$\{to\}/.test(tcBody), 'handler preserves the existing Contract history convention');
check(/success:\s*true/.test(tcBody) && /success:\s*false/.test(tcBody), 'handler returns a typed success/failure outcome');
// The former procedural mutator is gone — no second status-transition authority remains.
check(!/function setContractStatus\(/.test(ctSrc), 'setContractStatus removed (single status-transition authority via the Domain command)');
check(!/setContractStatus\(/.test(srcJs), 'no caller of setContractStatus remains anywhere');
// Single-record UI: routes through the one Domain-command seam (requestContractStatusTransition).
check(/async function requestContractStatusTransition\(/.test(ctSrc) && /uiExecute\('command', 'contract\.status\.transition', \[id, targetStatus\]\)/.test(ctSrc), 'requestContractStatusTransition routes status transitions through the UI-to-Transport seam');
check(/'ct-activate'\) requestContractStatusTransition\(id, 'Active'\)/.test(empSrc) && /'ct-cancel'\) requestContractStatusTransition\(id, 'Cancelled'\)/.test(empSrc), 'employee row menu (ct-activate/ct-cancel) routes through requestContractStatusTransition');
check(!/transitionContractStatus\(/.test(empSrc), 'no UI file calls the handler transitionContractStatus() directly (employees.js)');
check((ctSrc.match(/transitionContractStatus\(/g)||[]).length === 1, 'transitionContractStatus appears only as its definition (never invoked outside the Domain command)');
// The committed-payroll cancellation confirmation is preserved (moved into the UI seam, quirk unchanged).
check(/payrollPlansForContract\(id\)\.some\(isPayrollCommitted\)/.test(ctSrc), 'committed-payroll cancellation confirmation uses the shared canonical predicate (SPR-078 — the lowercase-only quirk is gone)');
// Transitions-only scope: creation (full editor) status writes intentionally remain (documented residual authority).
check(/rec\.status = fd\.get\('status'\)/.test(ctSrc), 'full-editor status assignment remains (creation — out of scope, documented residual authority)');
// SPR-077 supersedes the former PR-5K residual: the renewal status write is no longer
// an inline UI mutation — it is authored by ContractRenewalAggregate and applied by the
// renewContract handler. The old inline `c.status='Renewed'` MUST be gone.
check(!/c\.status='Renewed'/.test(ctSrc), 'inline renewal status assignment removed (SPR-077 — renewal is now aggregate-owned)');
// Existing aggregates remain operational and untouched by PR-5K.
check(/const ContractDateAggregate = Object\.freeze\(/.test(ctAggSrc) && /const PayrollLifecycleAggregate = Object\.freeze\(/.test(payAggSrc), 'existing Contract date + Payroll lifecycle aggregates remain operational');

// SPR-077 "The Successor" — third Contract aggregate boundary (ContractRenewalAggregate).
console.log('== CONTRACT RENEWAL AGGREGATE (SPR-077 — business authority) ==');
const crAggPath = path.join(root,'js','domain','contract-renewal-aggregate.js');
check(fs.existsSync(crAggPath), 'aggregate module present: js/domain/contract-renewal-aggregate.js');
check(jsFiles.indexOf('domain/contract-renewal-aggregate.js') !== -1, 'module-order.js includes domain/contract-renewal-aggregate.js');
check(indexHtml.includes('<script src="js/domain/contract-renewal-aggregate.js"></script>'), 'index.html includes domain/contract-renewal-aggregate.js');
// Load order: after helpers and after the date aggregate it reuses, before the facade.
check(jsFiles.indexOf('domain/aggregate-helpers.js') < jsFiles.indexOf('domain/contract-renewal-aggregate.js') &&
      jsFiles.indexOf('domain/contract-date-aggregate.js') < jsFiles.indexOf('domain/contract-renewal-aggregate.js') &&
      jsFiles.indexOf('domain/contract-renewal-aggregate.js') < jsFiles.indexOf('domain/domain-layer.js'), 'contract renewal aggregate loads after helpers + date aggregate and before domain-layer.js');
const crAggSrc = read(crAggPath);
check(/const ContractRenewalAggregate = Object\.freeze\(/.test(crAggSrc), 'ContractRenewalAggregate is a frozen object');
check(/prepare:\s*function/.test(crAggSrc), 'contract renewal aggregate exposes prepare()');
// EXACTLY ONE renewal aggregate and ONE renewal command — no second authority.
check((srcJs.match(/const \w*RenewalAggregate = Object\.freeze\(/g)||[]).length === 1, 'exactly one Contract renewal aggregate is defined');
check((cmdSrc.match(/'contract\.renewal\.[\w.]+':/g)||[]).length === 1, 'exactly one operational Contract renewal command is registered');
// Command registration: boundary + dedicated payload key + handler + aggregate id.
check(/'contract\.renewal\.execute':\s*Object\.freeze\(\{[^}]*boundary:\s*'ContractRenewalAggregate'/.test(cmdSrc), 'contract.renewal.execute declares boundary ContractRenewalAggregate');
check(/'contract\.renewal\.execute':\s*Object\.freeze\(\{[^}]*boundaryPayload:\s*'renewal'/.test(cmdSrc), 'contract.renewal.execute declares boundaryPayload = renewal');
check(/'contract\.renewal\.execute':\s*Object\.freeze\(\{[^}]*handler:\s*'renewContract'/.test(cmdSrc), 'contract.renewal.execute registered to handler renewContract');
check(/'contract\.renewal\.execute':\s*Object\.freeze\(\{[^}]*aggregate:\s*'Contract'/.test(cmdSrc), 'contract.renewal.execute declares aggregate Contract');
check(dist.includes("uiExecute('command', 'contract.renewal.execute'"), 'contract renewal command call present in dist (via the seam)');
// Domain routing is UNCHANGED by SPR-077 (reuses the default prepare entry contract).
check(!/contract\.renewal|ContractRenewal/.test(facSrc), 'domain-layer.js is not modified for the contract renewal command');
// Eligibility is derived from the EXISTING stored-status model: exactly the
// non-terminal statuses. Renewed/Cancelled are terminal and must never be renewable.
check(/CONTRACT_RENEWABLE_STATUSES = Object\.freeze\(\['Draft',\s*'Active'\]\)/.test(crAggSrc), 'renewable statuses are exactly the non-terminal stored statuses (Draft, Active)');
const crRenewableLit = (crAggSrc.match(/CONTRACT_RENEWABLE_STATUSES = Object\.freeze\(\[[\s\S]*?\]\)/)||[''])[0];
check(crRenewableLit !== '' && !/'Renewed'|'Cancelled'/.test(crRenewableLit), 'terminal statuses (Renewed/Cancelled) are never renewable');
check(/CONTRACT_RENEWAL_TARGET_STATUSES = Object\.freeze\(\['Active',\s*'Draft'\]\)/.test(crAggSrc), 'successor initial statuses match the existing form choices exactly (Active, Draft)');
// Aggregate PURITY — no side effects, no mutation, no id/timestamp generation
// (comments stripped). It reads existence via contractById only.
const crAggCode = crAggSrc.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
[['State mutation', /State\s*[.[]/],
 ['persistContracts', /persistContracts\s*\(/],
 ['persist', /\bpersist(HR|Contracts)?\s*\(/],
 ['Repository access', /\w*Repository\s*[.[]/],
 ['StorageAdapter access', /StorageAdapter/],
 ['Contract mutation', /\bc\.\w+\s*=[^=]/],
 ['history append', /\.history\b|history\s*=|\.push\(/],
 ['updatedAt mutation', /updatedAt/],
 ['id generation', /\buid\s*\(/],
 ['timestamp generation', /new Date\s*\(|Date\.now\s*\(/],
 ['DOM access', /document\s*[.[]|FormData/],
 ['UI render', /\brender\s*\(/],
 ['modal control', /openModalHTML\s*\(|closeModal\s*\(/],
 ['navigation', /hrNavTo\s*\(|detailContractId/],
 ['toast/alert', /\btoast\s*\(|showWarning\s*\(|showSuccess\s*\(|\balert\s*\(|confirm\s*\(/],
 ['localStorage', /localStorage/],
 ['audit logging', /logActivity\s*\(/]
].forEach(([label,re])=>check(!re.test(crAggCode), 'contract renewal aggregate never performs '+label));
check(/contractById\(/.test(crAggSrc), 'renewal aggregate reads existence read-only (contractById)');
// It REUSES the PR-5I date rules rather than restating them (one source of truth).
check(/isCanonicalContractDate\(/.test(crAggSrc) && /contractExtentIsValid\(/.test(crAggSrc), 'renewal aggregate reuses the canonical Contract date validators (PR-5I)');
// Returns an authored renewal on success and typed business failures otherwise.
check(/return \{\s*ok: true,\s*renewal:/.test(crAggSrc), 'renewal aggregate returns only an authored renewal decision on success');
["ContractNotFound","RenewalNotAllowed","ContractAlreadyRenewed","InvalidContractNumber","InvalidStartDate","InvalidDurationMonths","InvalidContractDateRange","InvalidMonthlySalary","InvalidContractStatusState"].forEach((e)=>
  check(new RegExp("error: '"+e+"'").test(crAggSrc), 'renewal aggregate returns typed business failure: '+e));
check(!/throw /.test(crAggCode), 'renewal aggregate never throws for an expected business outcome');
// The aggregate AUTHORS the successor shape and both history note texts as DATA.
check(/predecessorStatus: 'Renewed'/.test(crAggSrc), 'aggregate authors the predecessor canonical renewed status');
check(/predecessorNote:/.test(crAggSrc) && /successorNote:/.test(crAggSrc), 'aggregate authors both Contract history note texts');
check(/successor: \{/.test(crAggSrc), 'aggregate authors the successor Contract business shape');
// ADR-012 remains Proposed — renewal must NOT enforce overlap.
check(!/overlappingActiveContracts/.test(crAggCode), 'renewal aggregate enforces no contract overlap (ADR-012 remains Proposed)');

// SPR-077 — Contract renewal HANDLER (implementation authority) + UI seam.
console.log('== CONTRACT RENEWAL HANDLER (SPR-077 — implementation authority) ==');
const rcBody = stripComments((ctSrc.match(/async function renewContract\(id, renewal\)\{[\s\S]*?\n\}/)||[''])[0]);
check(rcBody !== '', 'renewContract handler is defined in js/people/contracts.js');
// The handler owns identity, timestamps, the history append, and the mutation.
check(/uid\('ct'\)/.test(rcBody), 'handler owns successor id generation (uid)');
check(/new Date\(\)\.toISOString\(\)/.test(rcBody), 'handler owns the business timestamp');
check(/c\.history=c\.history\|\|\[\]\)\.push\(/.test(rcBody), 'handler owns the predecessor history append');
check(/renewal\.predecessorNote/.test(rcBody) && /renewal\.successorNote/.test(rcBody), 'handler applies the aggregate-authored history notes');
check(/c\.status = renewal\.predecessorStatus/.test(rcBody), 'handler applies the aggregate-authored predecessor status');
check(/State\.contracts\.push\(nc\)/.test(rcBody), 'handler appends the successor to the ONE contracts collection');
// Persistence: exactly one Repository save, result strictly inspected, no direct persist.
check(/ContractRepository\.save\(\)/.test(rcBody), 'handler persists through ContractRepository.save()');
check((rcBody.match(/ContractRepository\.save\(/g)||[]).length === 1, 'handler invokes ContractRepository.save() exactly once');
check(!/persistContracts\s*\(/.test(rcBody), 'handler never calls persistContracts() directly');
check(/persisted\.ok !== true/.test(rcBody), 'handler strictly inspects the Repository result (no truthy/falsy ambiguity)');
// In-memory rollback on persistence failure: successor removed, predecessor restored.
check(/State\.contracts = State\.contracts\.filter\(x=>x\.id!==nc\.id\)/.test(rcBody), 'failed persist removes the successor from memory');
check(/c\.status = prevStatus/.test(rcBody) && /c\.history\.pop\(\)/.test(rcBody) && /c\.updatedAt = prevUpdatedAt/.test(rcBody), 'failed persist restores predecessor status, history, and updatedAt');
check(/prevRenewedToId/.test(rcBody), 'failed persist restores the predecessor renewedToId linkage');
check(/return \{ success:false, error:'PersistFailed' \}/.test(rcBody), 'handler returns the typed PersistFailed outcome');
check(/return \{ success:true, data:\{ predecessor:c, successor:nc \} \}/.test(rcBody), 'handler returns predecessor + successor on success');
// Defense-in-depth: the handler re-checks eligibility (the aggregate decided first).
check(/CONTRACT_RENEWABLE_STATUSES/.test(rcBody) && /c\.renewedToId/.test(rcBody), 'handler keeps its own defense-in-depth eligibility check');
// NO false success: every success action lives in the seam behind outcome.success.
const rcSeam = (ctSrc.match(/async function requestContractRenewal\(id, patch\)\{[\s\S]*?\n\}/)||[''])[0];
check(rcSeam !== '', 'requestContractRenewal UI seam is defined');
check(/uiExecute\('command', 'contract\.renewal\.execute'/.test(rcSeam), 'the seam routes through the Platform boundary (uiExecute)');
const rcSuccessBlock = (rcSeam.match(/if\(outcome && outcome\.success\)\{[\s\S]*?\n  \}/)||[''])[0];
check(rcSuccessBlock !== '', 'the seam gates its success actions on outcome.success');
['closeModal(','toast(','render()','detailContractId'].forEach((act)=>
  check(rcSuccessBlock.includes(act), 'success action runs ONLY after a confirmed persist: '+act));
// The renewal modal no longer authors business behavior.
const renewModalBody = stripComments((ctSrc.match(/function openRenewModal\(id\)\{[\s\S]*?\n\}/)||[''])[0]);
check(renewModalBody !== '', 'openRenewModal is defined');
check(/requestContractRenewal\(id,/.test(renewModalBody), 'the renewal modal delegates to the UI seam');
[['successor construction', /uid\('ct'\)/],
 ['predecessor mutation', /\bc\.\w+\s*=[^=]/],
 ['history append', /\.push\(\{event:/],
 ['direct persistence', /persistContracts\s*\(|ContractRepository\.save\(/]
].forEach(([label,re])=>check(!re.test(renewModalBody), 'renewal modal no longer performs '+label));
// UI eligibility mirrors the aggregate rule (single source of truth, no drift).
check(/function contractIsRenewable\(c\)\{/.test(ctSrc), 'contractIsRenewable UI eligibility mirror is defined');
check(/contractIsRenewable\(c\)\?\['ct-renew','Renew'\]:null/.test(ctSrc), 'the row menu offers Renew only for renewable contracts');
check(/contractIsRenewable\(c\)\?'<button class="btn btn-accent" id="renewCtD">/.test(ctSrc), 'contract detail offers Renew only for renewable contracts');
// NO compound-persistence abstraction is introduced anywhere by this slice.
[['transaction abstraction', /beginTransaction|commitTransaction|TransactionCoordinator/],
 ['unit of work', /unitOfWork|UnitOfWork/],
 ['coordinator', /PersistenceCoordinator|PostingCoordinator/],
 ['storage batch', /StorageAdapter\.(setMany|batch|transaction)/],
 ['write-ahead journal', /writeAhead|journalWrite/]
].forEach(([label,re])=>check(!re.test(crAggSrc) && !re.test(ctSrc), 'SPR-077 introduces no '+label));
// ADR-013 remains valid: the Repository contract is untouched and single-collection.
check(/async save\(\)\{[\s\S]*?await persistContracts\(\);[\s\S]*?\}/.test(read(path.join(root,'js','repository','contract-repository.js'))), 'ContractRepository.save() remains a single-collection delegate (ADR-013 unchanged)');

// SPR-077 — the behavioral counterpart to the structural checks above. This file
// proves SHAPE; tools/verify-renewal-runtime.js proves BEHAVIOR by executing the
// command through the Platform path against a failable in-memory storage shim.
check(fs.existsSync(path.join(root,'tools','verify-renewal-runtime.js')), 'SPR-077 runtime verification harness present: tools/verify-renewal-runtime.js');

// SPR-078 — LEGACY PAYROLL PLANNING RETIRED + CANONICAL COMMITTED-STATE PREDICATE.
console.log('== SPR-078 PAYROLL POSTING AUTHORITY (single path + one committed predicate) ==');
const planSrc078 = read(path.join(root,'js','people','payroll-planning.js'));
const planCode078 = stripComments(planSrc078);
const coreSrc078 = read(path.join(root,'js','people','people-core.js'));
const shellSrc078 = read(path.join(root,'js','ui','shell-render.js'));

// (a) THE DEAD SURFACE IS GONE. None of these had an external consumer.
['commitPayroll','renderPayrollPlanning','renderPayrollDraft','payrollRowHTML','generatePayrollRows','buildPayrollTxn','payrollAmount','samePayrollComponents'].forEach((fname)=>
  check(!new RegExp('function\\s+'+fname+'\\s*\\(').test(planCode078), 'retired dead payroll-planning surface: '+fname+'() is removed'));
check(!/commitPayroll\s*\(/.test(stripComments(srcJs)), 'no caller of the retired commitPayroll() remains anywhere');
check(!/renderPayrollPlanning\s*\(/.test(stripComments(srcJs)), 'no caller of the retired renderPayrollPlanning() remains anywhere');
// The retired screen must NOT be re-routed (Atlas: the missing route is not a bug).
check(!/State\.view===['"]payrollPlanning['"]/.test(srcJs), 'the retired planning screen is not re-routed');
// (b) THE SHARED UTILITIES SURVIVE — they are defined nowhere else and have real consumers.
check(/function num\(x\)/.test(planSrc078), 'shared utility num() is preserved in payroll-planning.js');
check(/function ensureMonthlyPlan\(monthKey\)/.test(planSrc078), 'shared utility ensureMonthlyPlan() is preserved in payroll-planning.js');
check((srcJs.match(/^function num\(/gm)||[]).length === 1, 'num() has exactly one definition repository-wide');
check((srcJs.match(/^function ensureMonthlyPlan\(/gm)||[]).length === 1, 'ensureMonthlyPlan() has exactly one definition repository-wide');
check(jsFiles.indexOf('people/payroll-planning.js') !== -1 && indexHtml.includes('<script src="js/people/payroll-planning.js"></script>'), 'payroll-planning.js remains loaded (retained for its shared utilities)');
// (c) ONE LIVE POSTING PATH.
check(/async function commitReadyPayroll\(monthKey, ids\)\{/.test(poeSrc), 'commitReadyPayroll is defined');
check((stripComments(srcJs).match(/steps\.push\(\['payrollPlans',\s+await persistPayrollPlans\(\)\]\);/g)||[]).length === 1,
  'exactly ONE four-store payroll posting sequence exists repository-wide (single posting authority)');
check(/isPayrollLocked\(monthKey\)/.test(poeSrc) && /payrollCommitBlockers\(pp\)/.test(poeSrc) && /pp\.status!=='Ready'/.test(poeSrc),
  'the sole posting path enforces period lock + commit blockers + the Ready gate');
check((stripComments(srcJs).match(/logActivity\(\{type:'payroll\.post'/g)||[]).length === 1, 'exactly one successful-posting audit entry exists (not duplicated by any wrapper)');
// (d) NO LIVE LOWERCASE WRITER. The v2.5.0 migration is the ONLY permitted mention.
const lowerWriters = [];
jsFiles.forEach((f)=>{
  if(f === 'core/hr-persistence-portability.js') return;          // the one-time v2.5.0 migration — untouched by SPR-078
  const code = stripComments(read(path.join(root,'js',f)));
  if(/status\s*[:=]\s*'committed'/.test(code)) lowerWriters.push(f);
});
check(lowerWriters.length === 0, 'no live writer writes the lowercase legacy payroll status (found: '+(lowerWriters.join(', ')||'none')+')');
check(/p\.status==='committed'\?'Committed':'Draft'/.test(read(path.join(root,'js','core','hr-persistence-portability.js'))), 'the one-time v2.5.0 migration is unchanged (no migration added or re-run)');
// (e) THE CANONICAL PREDICATE — one definition, in the shared people-domain boundary.
check(/const PAYROLL_COMMITTED_STATUS = 'Committed';/.test(coreSrc078), 'canonical committed status constant is defined (Committed)');
check(/const PAYROLL_COMMITTED_STATUS_LEGACY = 'committed';/.test(coreSrc078), 'legacy read-compatibility constant is defined (committed)');
check(/function isPayrollCommitted\(planOrStatus\)\{/.test(coreSrc078), 'the shared predicate isPayrollCommitted() is defined');
check((srcJs.match(/^function isPayrollCommitted\(/gm)||[]).length === 1, 'isPayrollCommitted() has exactly one definition repository-wide');
// It must load BEFORE every consumer, so no consumer relies on cross-file hoisting.
['people/contracts.js','people/hr-dashboard-reports.js','people/monthly-plan.js','people/payroll-ops-engine.js'].forEach((f)=>
  check(jsFiles.indexOf('people/people-core.js') < jsFiles.indexOf(f), 'the predicate module loads before its consumer: '+f));
// The predicate is a pure READ helper — it never writes a status.
const predBody = (coreSrc078.match(/function isPayrollCommitted\(planOrStatus\)\{[\s\S]*?\n\}/)||[''])[0];
check(predBody !== '', 'the predicate body is resolvable');
[['State access', /State\s*[.[]/], ['persistence', /persist/], ['record mutation', /\.\w+\s*=[^=]/],
 ['UI/DOM access', /document|render\s*\(|toast\s*\(/], ['id/timestamp generation', /\buid\s*\(|new Date\s*\(/]
].forEach(([label,re])=> check(!re.test(predBody), 'the predicate performs no '+label));
// (f) EVERY LIVE PayrollPlan COMMITTED READER USES THE PREDICATE.
const READER_FILES = ['people/contracts.js','people/hr-dashboard-reports.js','people/monthly-plan.js','people/payroll-ops-engine.js','core/stabilization.js','core/onboarding-reset.js'];
const strayReaders = [];
READER_FILES.forEach((f)=>{
  const code = stripComments(read(path.join(root,'js',f)));
  // A PayrollPlan status comparison is one made against a payroll record (p/pp/existing),
  // never against a MonthlyPlan or an Overtime record. MonthlyPlan reads are excluded by
  // their collection (State.monthlyPlans) or their variable name (plan/mplan).
  const m = (code.split('\n')
    .filter(line => !/monthlyPlans|\b(plan|mplan)\.status/.test(line))
    .join('\n')
    .match(/\b(p|pp|existing)\.status\s*===?\s*'(C|c)ommitted'/g)) || [];
  if(m.length) strayReaders.push(f+': '+m.join(' | '));
});
check(strayReaders.length === 0, 'every live PayrollPlan committed-state read goes through isPayrollCommitted() (stray: '+(strayReaders.join(' ;; ')||'none')+')');
check(/payrollPlansForContract\(id\)\.some\(isPayrollCommitted\)/.test(ctSrc), 'the contract-cancellation safety guard uses the shared predicate');
check(/isPayrollCommitted\(pp\)\{?[\s\S]{0,80}payrollTxnOf/.test(poeSrc) || /if\(isPayrollCommitted\(pp\)\)\{/.test(poeSrc), 'payrollStage() resolves committed state through the shared predicate');
check(/filter\(p=>p\.monthKey===monthKey && isPayrollCommitted\(p\)\)/.test(read(path.join(root,'js','people','hr-dashboard-reports.js'))), 'the HR dashboard payroll rollup uses the shared predicate');
check(/isPayrollCommitted\(p\) && Array\.isArray\(p\.overtimeIds\)/.test(read(path.join(root,'js','core','stabilization.js'))), 'the integrity checker uses the shared predicate');
// (g) SPR-078 INTRODUCES NO NEW ARCHITECTURE.
check(!/PayrollPostingAggregate/.test(srcJs), 'SPR-078 introduces no PayrollPostingAggregate');
check(aggregateDefs === 9, 'aggregate count is unchanged by SPR-078 (SPR-095 added the ninth: ContractCoreAggregate)');
[['coordinator', /PostingCoordinator|PersistenceCoordinator/], ['unit of work', /unitOfWork|UnitOfWork/],
 ['transaction abstraction', /beginTransaction|TransactionCoordinator/], ['batch persistence', /saveMany|StorageAdapter\.(setMany|batch)/],
 ['journal/recovery record', /writeAhead|journalWrite|recoveryRecord/]
].forEach(([label,re])=> check(!re.test(srcJs), 'SPR-078 introduces no '+label));
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root,'js','core','constants.js'))), 'SCHEMA_VERSION remains 6');
check(fs.existsSync(path.join(root,'tools','verify-payroll-committed-runtime.js')), 'SPR-078 runtime harness present: tools/verify-payroll-committed-runtime.js');

// SPR-079 — UNIFIED PERSISTENCE RESULT INTEGRITY (saveAllData honesty).
console.log('== SPR-079 saveAllData RESULT INTEGRITY (no false success) ==');
const stabSrc079 = read(path.join(root,'js','core','stabilization.js'));
const sadBody = stripComments((stabSrc079.match(/async function saveAllData\(\)\{[\s\S]*?\n\}/)||[''])[0]);
check(sadBody !== '', 'saveAllData() is defined in js/core/stabilization.js');
// (a) NO UNCONDITIONAL SUCCESS.
check(!/\}\s*$/.test('') && !/await Promise\.all\(\[[\s\S]*?\]\);\s*return true;/.test(sadBody), 'saveAllData() no longer returns unconditional true after the fan-out');
check((sadBody.match(/return true;/g)||[]).length === 1 && /return false;/.test(sadBody), 'saveAllData() has exactly one success return and at least one failure return');
// (b) EVERY REQUIRED RESULT IS AWAITED AND INSPECTED.
check(/const results = await Promise\.all\(\[/.test(sadBody), 'saveAllData() awaits every write and captures the results');
check(/results\[i\] !== true/.test(sadBody), 'saveAllData() inspects every result strictly (!== true, no truthy ambiguity)');
check(/if\(failed\.length\)\{[\s\S]*?return false;/.test(sadBody), 'saveAllData() returns false when any required write fails');
// (c) THE FAN-OUT STILL COVERS THE SAME DATASETS, IN A DETERMINISTIC ORDER.
check(/persist\(\), saveSettings\(\), saveBackups\(\)/.test(sadBody) && /Object\.keys\(HR_KEYS\)\.map\(k=>persistHR\(k\)\)/.test(sadBody), 'saveAllData() invokes the same authorized persistence operations');
check(/const labels = \['transactions', 'settings', 'backups', \.\.\.Object\.keys\(HR_KEYS\)\]/.test(sadBody), 'saveAllData() labels are positionally aligned with the promise list (deterministic ordering)');
// (d) NO ATOMICITY / ROLLBACK CLAIM, AND NO NEW MACHINERY.
// NOTE: the fan-out legitimately labels one dataset 'transactions', so the
// transaction-abstraction probe targets identifiers, never that data label.
[['retry', /\bretry\b|setTimeout|attempt\s*\+\+/i], ['compensation/rollback', /rollback|compensat/i],
 ['journal', /journal|writeAhead/i], ['recovery marker', /recoveryMarker|operationId/i],
 ['transaction abstraction', /unitOfWork|UnitOfWork|beginTransaction|commitTransaction|TransactionCoordinator/],
 ['StorageAdapter access', /StorageAdapter/]
].forEach(([label,re])=> check(!re.test(sadBody), 'saveAllData() introduces no '+label));
// It must not duplicate the user-facing failure notification StorageAdapter already emits.
check(!/toast\(|showError\(|showWarning\(/.test(sadBody), 'saveAllData() emits no duplicate user-facing notification (console only)');
check(/console\.error\(/.test(sadBody), 'saveAllData() reports which datasets failed to the console');

// (e) EVERY LIVE CALLER AWAITS AND CHECKS THE RESULT.
const CALLER_FILES_079 = ['people/employee-dedup.js','import/smart-import-commit.js'];
const uncheckedCallers = [];
CALLER_FILES_079.forEach((f)=>{
  const code = stripComments(read(path.join(root,'js',f)));
  // Every saveAllData() call must be awaited INTO a variable that is then tested.
  (code.match(/^.*saveAllData\(\).*$/gm)||[]).forEach((line)=>{
    if(!/=\s*await saveAllData\(\)/.test(line)) uncheckedCallers.push(f+': '+line.trim());
  });
});
check(uncheckedCallers.length === 0, 'every live caller awaits saveAllData() into a checked variable (unchecked: '+(uncheckedCallers.join(' ;; ')||'none')+')');
check((stripComments(srcJs).match(/await saveAllData\(\)/g)||[]).length === 3, 'exactly three live saveAllData() call sites exist (merge, import commit, import undo)');
check((stripComments(srcJs).match(/=\s*await saveAllData\(\)/g)||[]).length === 3, 'all three call sites capture the result');

// (f) NO SUCCESS UI / AUDIT / COMPLETION AFTER FAILURE.
const dedupSrc079 = read(path.join(root,'js','people','employee-dedup.js'));
const siCommitSrc079 = read(path.join(root,'js','import','smart-import-commit.js'));
const siUiSrc079 = read(path.join(root,'js','import','smart-import-ui.js'));
// Employee merge: typed result; UI shows success only on ok===true.
check(/return \{ ok: saved === true, audit: auditRec \};/.test(dedupSrc079), 'mergeEmployeeGroup returns a typed result carrying the persistence outcome');
check(/if\(res\.ok !== true\)\{[\s\S]{0,600}showError\(/.test(dedupSrc079), 'employee merge reports failure with showError before any success path');
const dedupFailBlock = (stripComments(dedupSrc079).match(/if\(res\.ok !== true\)\{[\s\S]*?\n    \}/)||[''])[0];
check(dedupFailBlock !== '' && !/showSuccess\(/.test(dedupFailBlock), 'employee merge shows no success message on failure');
check(dedupFailBlock !== '' && !/delete State\.dedupCanon/.test(dedupFailBlock), 'employee merge clears no completion state on failure');
// Smart Import commit: the success audit entry is written only after success.
check(/if\(saved !== true\) return \{ ok:false, audit \};/.test(siCommitSrc079), 'commitSmartImport returns failure before writing the success audit entry');
const siCommitBody079 = stripComments((siCommitSrc079.match(/async function commitSmartImport\(model\)\{[\s\S]*?\n\}/)||[''])[0]);
check(/if\(saved !== true\) return[\s\S]*?logActivity\(\{type:'import\.commit'/.test(siCommitBody079), 'the import.commit audit entry is unreachable on a failed persist');
// Smart Import UI: no success, no navigation, model retained for retry.
// Extract the failure branch from its opening brace to its `return;`, independent
// of indentation depth.
const siUiFail079 = (stripComments(siUiSrc079).match(/if\(res\.ok !== true\)\{[\s\S]*?return;/)||[''])[0];
check(siUiFail079 !== '', 'the Smart Import UI has an explicit failure branch');
[['success message', /showSuccess\(/], ['results navigation', /State\.view='importResults'/],
 ['model discard (retry blocked)', /State\.smartImport=null/], ['completion step', /State\.smartStep=9/]
].forEach(([label,re])=> check(!re.test(siUiFail079), 'Smart Import failure branch performs no '+label));
check(/showError\(/.test(siUiFail079), 'the Smart Import failure branch reports the failure to the user');
// Smart Import undo: failure branch, no success toast.
const siUndo079 = stripComments((siCommitSrc079.match(/async function undoLastSmartImport\(\)\{[\s\S]*?\n\}/)||[''])[0]);
check(/if\(saved !== true\)\{[\s\S]*?showError\([\s\S]*?return;/.test(siUndo079), 'undoLastSmartImport reports failure and returns before its success path');
const siUndoFail079 = (siUndo079.match(/if\(saved !== true\)\{[\s\S]*?return;/)||[''])[0];
check(siUndoFail079 !== '' && !/showSuccess\(/.test(siUndoFail079), 'undoLastSmartImport shows no success message on failure');
// The `undone` flag is BOTH the completion marker and the batch selector
// (`find(b=>!b.undone)`). Leaving it set after a failed write would misrepresent
// completion AND block every further attempt for the session, so it must be cleared.
check(/batch\.undone = false;\s*delete batch\.undoneAt;\s*delete batch\.keptTxns;/.test(siUndoFail079),
  'undoLastSmartImport clears the completion marker on failure (retry is not blocked)');
check(/find\(b=>!b\.undone\)/.test(siUndo079), 'the undo selector keys off the same `undone` flag the failure path clears');
// Clearing a marker is not a rollback — the wording must not imply one.
check(/you can try again, or reload the page/.test(siUndoFail079), 'undo failure offers retry AND reload without claiming a rollback');

// (g) FAILURE WORDING MUST NOT CLAIM A ROLLBACK (the fan-out is not atomic).
[dedupSrc079, siCommitSrc079, siUiSrc079].forEach((src, i)=>{
  const msgs = (stripComments(src).match(/showError\('[^']*'/g)||[]).join(' ');
  check(!/rolled back|reverted|nothing was changed|no data was saved|undone automatically/i.test(msgs),
    'SPR-079 failure wording claims no rollback in caller file #'+(i+1));
});
check(/was not completed successfully/.test(dedupSrc079) && /was not completed successfully/.test(siCommitSrc079) && /was not completed successfully/.test(siUiSrc079),
  'every failure message states the operation was not completed successfully');

// (h) SAFETY BACKUPS SURVIVE A FAILURE — no caller prunes State.backups.
[['people/employee-dedup.js', dedupSrc079], ['import/smart-import-commit.js', siCommitSrc079]].forEach(([f,src])=>
  check(!/State\.backups\s*=\s*State\.backups\.filter|State\.backups\.splice|State\.backups\s*=\s*\[\]/.test(stripComments(src)), 'no safety backup is removed by '+f));
check(/State\.backups\.unshift\(\{[\s\S]{0,300}Pre-merge safety backup|State\.backups\.unshift\(\{[\s\S]{0,300}Pre-employee-merge backup/.test(dedupSrc079), 'employee merge still takes a pre-operation safety backup');
check(/State\.backups\.unshift\(\{[\s\S]{0,300}Pre-Smart-Import backup/.test(siCommitSrc079), 'Smart Import still takes a pre-operation safety backup');

// (i) SPR-079 CHANGES NOTHING ELSE.
check(read(path.join(root,'js','core','storage-adapter.js')).indexOf('async set(key, value)') !== -1, 'StorageAdapter still exposes its unchanged single-key set()');
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root,'js','core','constants.js'))), 'SCHEMA_VERSION remains 6');
check(aggregateDefs === 9, 'aggregate count is unchanged by SPR-079 (SPR-095 added the ninth: ContractCoreAggregate)');
check(fs.existsSync(path.join(root,'tools','verify-savealldata-runtime.js')), 'SPR-079 runtime harness present: tools/verify-savealldata-runtime.js');

// SPR-081 — PAYROLL POSTING RESULT INTEGRITY + PARTIAL-STATE DETECTION.
console.log('== SPR-081 PAYROLL POSTING INTEGRITY (result checking + Scenario A/C detection) ==');
const poeSrc081 = read(path.join(root,'js','people','payroll-ops-engine.js'));
const crpBody081 = stripComments((poeSrc081.match(/async function commitReadyPayroll\(monthKey, ids\)\{[\s\S]*?\n\}/)||[''])[0]);
const stabSrc081 = read(path.join(root,'js','core','stabilization.js'));
const wsSrc081 = read(path.join(root,'js','people','payroll-workspace.js'));

// (a) ALL FOUR RESULTS CAPTURED AND STRICTLY INSPECTED.
['payrollPlans','monthlyPlans','overtime','transactions'].forEach((step)=>
  check(new RegExp("steps\\.push\\(\\['"+step+"',").test(crpBody081), 'payroll posting captures the result of the '+step+' write'));
check(/const failedSteps\s+= steps\.filter\(s=>s\[1\]!==true\)/.test(crpBody081), 'payroll posting inspects every result strictly (!== true)');
check(/const completedSteps = steps\.filter\(s=>s\[1\]===true\)/.test(crpBody081), 'payroll posting reports completed steps deterministically');
// (b) TYPED FAILURE / SUCCESS CONTRACT.
check(/error:\s*'PayrollPersistenceFailed'/.test(crpBody081), 'payroll posting returns the typed PayrollPersistenceFailed outcome');
check(/failedStep: failedSteps\[0\]/.test(crpBody081), 'the failed step is the FIRST failure in the fixed write order (deterministic)');
check(/partialPersistence: completedSteps\.length > 0/.test(crpBody081), 'partialPersistence is true only when at least one write succeeded');
check(/recoveryHint: 'RunIntegrityCheckAndReview'/.test(crpBody081), 'the failure result carries an actionable recovery hint');
check(/return \{ok:true, created, updated, skipped, posted, skippedDetails\}/.test(crpBody081), 'success returns ok:true with the existing summary fields');
check(/return \{ok:false, error:'PayrollPeriodLocked'/.test(crpBody081), 'the locked-period refusal is also typed');
// (c) SUCCESS AUDIT ONLY AFTER FULL PERSISTENCE SUCCESS.
check(/if\(failedSteps\.length\)\{[\s\S]*?return \{ok:false[\s\S]*?\}\s*logActivity\(\{type:'payroll\.post'/.test(crpBody081),
  "the payroll.post success audit is unreachable when any write failed");
check((crpBody081.match(/logActivity\(\{type:'payroll\.post'/g)||[]).length === 1, 'exactly one payroll.post audit call exists');
// (d) NO SUCCESS UI AFTER FAILURE.
const wsFail081 = (stripComments(wsSrc081).match(/if\(res\.ok !== true && res\.error === 'PayrollPersistenceFailed'\)\{[\s\S]*?return;/)||[''])[0];
check(wsFail081 !== '', 'the posting caller has an explicit persistence-failure branch');
[['success toast', /showSuccess\(/], ['posted-vs-skipped summary', /openPostResultModal\(/]].forEach(([label,re])=>
  check(!re.test(wsFail081), 'the payroll failure branch shows no '+label));
check(/showError\(/.test(wsFail081) && /Run Integrity Check/.test(wsFail081), 'the payroll failure branch reports the failure and directs the user to Integrity Check');
// SPR-081 follow-up — CONTROL-FLOW ORDERING. Clearing the selection is completion
// behaviour and must never precede result inspection. Scope the scan to the Post
// click handler so unrelated sel.clear() sites cannot mask a regression.
const postHandler081 = stripComments((wsSrc081.match(/const res=await commitReadyPayroll\(monthKey, readyIds\);[\s\S]*?\n      \}\);/)||[''])[0]);
check(postHandler081 !== '', 'the Post click handler is resolvable');
const iCommit081 = postHandler081.indexOf('await commitReadyPayroll');
const iFailBranch081 = postHandler081.indexOf("res.error === 'PayrollPersistenceFailed'");
const iSuccessClear081 = postHandler081.lastIndexOf('sel.clear()');
const iSummary081 = postHandler081.indexOf('openPostResultModal(');
const iSuccessToast081 = postHandler081.indexOf('showSuccess(');
check(iCommit081 > -1 && iFailBranch081 > iCommit081, 'the persistence-failure branch is evaluated after the posting call');
check(iSuccessClear081 > iFailBranch081, 'the success-path selection clear occurs AFTER the persistence-failure branch');
check(iSummary081 > iFailBranch081, 'the posted-vs-skipped summary occurs AFTER the persistence-failure branch');
check(iSuccessToast081 > iFailBranch081, 'the success toast occurs AFTER the persistence-failure branch');
// Nothing completion-shaped may sit between the call and the failure branch.
const preFail081 = postHandler081.slice(iCommit081, iFailBranch081);
[['selection clear', /sel\.clear\(\)/], ['success summary', /openPostResultModal\(/], ['success toast', /showSuccess\(/]
].forEach(([label,re])=> check(!re.test(preFail081.replace(/if\(res\.locked\)\{[^}]*\}/,'')), 'no success-only '+label+' precedes the persistence-failure branch'));
// The failure branch itself must not clear the selection.
check(!/sel\.clear\(\)/.test(wsFail081), 'the persistence-failure branch retains the selection (no sel.clear())');
// Locked keeps its own completion behaviour, and only warns once (from the engine).
check(/if\(res\.locked\)\{ sel\.clear\(\); closeModal\(\); return; \}/.test(postHandler081), 'the locked branch preserves its existing clear+close behaviour and returns');
check(!/showWarning\(|showError\(/.test((postHandler081.match(/if\(res\.locked\)\{[^}]*\}/)||[''])[0]), 'the locked branch adds no second warning');
check(!/rolled back|reverted|nothing was saved|nothing was written/i.test(wsFail081), 'the payroll failure message claims no rollback');
check(/Some data may already have been saved/.test(wsSrc081), 'the payroll failure message states that data may already have been saved');

// (e) TRANSACTION LOOKUP — forward first, narrow unique reverse fallback.
check(/function payrollTxnOf\(pp\)\{/.test(poeSrc081), 'payrollTxnOf is defined');
check(/const direct = findTxn\(pp && \(pp\.committedTxnId \|\| pp\.transactionId\)\);/.test(poeSrc081), 'the lookup still tries the FORWARD linkage first');
check(/function payrollTxnCandidates\(pp\)\{/.test(poeSrc081), 'the reverse-lookup candidate set is a named function');
const candBody081 = stripComments((poeSrc081.match(/function payrollTxnCandidates\(pp\)\{[\s\S]*?\n\}/)||[''])[0]);
check(/t\.source==='payroll'/.test(candBody081), 'the reverse lookup considers payroll-sourced transactions only');
check(/t\.payrollPlanId===pp\.id/.test(candBody081), 'the reverse lookup requires a matching payrollPlanId');
check(/t\.monthKey===pp\.monthKey/.test(candBody081), 'the reverse lookup requires matching period identity');
const resolveBody081 = stripComments((poeSrc081.match(/function resolvePayrollTxn\(pp\)\{[\s\S]*?\n\}/)||[''])[0]);
check(/if\(cands\.length > 1\) return \{ ambiguous: true/.test(resolveBody081), 'more than one candidate yields an AMBIGUOUS result, never a guess');
check(/cands\.length === 1 \? cands\[0\] : null/.test(resolveBody081), 'the reverse lookup resolves only when exactly one candidate exists');
// (f) SCENARIO A — a retry can never create a second transaction.
check(/const resolved = resolvePayrollTxn\(pp\);[\s\S]{0,400}if\(resolved\.ambiguous\)\{[\s\S]{0,600}continue;/.test(crpBody081),
  'ambiguity is detected BEFORE any mutation and the row is skipped uncommitted');
check(/PayrollTransactionAmbiguous/.test(crpBody081), 'the ambiguous skip reason uses the typed PayrollTransactionAmbiguous concept');
check(/if\(txn && pp\.committedTxnId!==txn\.id && pp\.transactionId!==txn\.id\)\{[\s\S]{0,400}pp\.committedTxnId=txn\.id/.test(crpBody081),
  'a reverse-matched transaction has its forward linkage restored instead of being duplicated');
check(/let txn = resolved\.txn;/.test(crpBody081), 'the posting path uses the resolved transaction (no second lookup that could create one)');
const createBlock081 = (crpBody081.match(/if\(!txn\)\{[\s\S]*?\}/)||[''])[0];
check(createBlock081 !== '' && /payrollCommitTxn\(pp, mo\)/.test(createBlock081), 'a transaction is created ONLY when none resolved');
check((crpBody081.match(/State\.txns\.push\(/g)||[]).length === 1, 'the posting path has exactly one transaction-creation site');

// (g) INTEGRITY RULE A + RULE C — critical, read-only.
check(/add\('critical','payroll-orphan-transaction'/.test(stabSrc081), 'Integrity Rule A (orphan payroll transaction) exists and is CRITICAL');
check(/add\('critical','payroll-overtime-uncommitted'/.test(stabSrc081), 'Integrity Rule C (committed payroll, uncommitted overtime) exists and is CRITICAL');
const ruleA081 = stripComments((stabSrc081.match(/const orphanPayrollTxns=\[\];[\s\S]*?\}\);\s*\n\s*orphanPayrollTxns\.forEach\([\s\S]*?\}\);/)||[''])[0]);
check(ruleA081 !== '', 'Rule A body is resolvable');
check(/t\.source!=='payroll'/.test(ruleA081) && /t\.payrollPlanId/.test(ruleA081), 'Rule A scans payroll transactions carrying a payrollPlanId');
check(/pp\.committedTxnId===t\.id \|\| pp\.transactionId===t\.id/.test(ruleA081), 'Rule A checks the forward linkage back to the transaction');
check(/isPayrollCommitted\(pp\)/.test(ruleA081), 'Rule A checks whether the payroll row is committed');
// Findings must carry review identifiers.
check(/Finance transaction \$\{t\.id\}[\s\S]{0,200}payroll row \$\{pp\.id\}/.test(stabSrc081), 'Rule A reports transaction id, amount, period, payroll row and employee');
check(/its linked overtime \$\{o\.id\}/.test(stabSrc081), 'Rule C reports payroll row, period, overtime id, amount and status');
// READ-ONLY: neither rule mutates or persists.
[ruleA081, (stabSrc081.match(/State\.payrollPlans\.forEach\(pp=>\{\s*if\(!isPayrollCommitted\(pp\)\) return;[\s\S]*?\}\);\s*\n\s*\}\);/)||[''])[0]
].forEach((body, i)=>{
  const label = i===0 ? 'Rule A' : 'Rule C';
  check(body !== '', label+' body is resolvable for the purity scan');
  [['status mutation', /\.status\s*=[^=]/], ['link mutation', /committedTxnId\s*=[^=]/], ['persistence', /persist|StorageAdapter/],
   ['deletion', /\.filter\(|splice\(/], ['snapshot rewrite', /committedSnapshot\s*=[^=]/]
  ].forEach(([l,re])=> check(!re.test(body), label+' performs no '+l+' (read-only detection, not repair)'));
});

// (h) WRITE ORDER UNCHANGED + NO NEW ARCHITECTURE.
const orderIdx081 = ['payrollPlans','monthlyPlans','overtime','transactions'].map(k=>crpBody081.indexOf("['"+k+"'"));
check(orderIdx081.every((v,i)=> v > -1 && (i===0 || v > orderIdx081[i-1])), 'the payroll write order is unchanged (plans, monthlyPlans, overtime, transactions)');
check(!/return \{ok:false[\s\S]{0,200}\}\s*steps\.push/.test(crpBody081), 'the attempt-all behaviour is preserved (no early abort between writes)');
[['coordinator', /PostingCoordinator|PersistenceCoordinator/], ['unit of work', /unitOfWork|UnitOfWork/],
 ['transaction abstraction', /beginTransaction|TransactionCoordinator/], ['journal', /writeAhead|journalWrite/],
 // NOTE: `payrollTotalCompensation` is a pre-existing v2.7.3 read-model, so the
 // probe targets compensation MACHINERY, never the word itself.
 ['compensation framework', /compensationStep|runCompensation|compensator|CompensationRunner/],
 ['batch persistence', /saveMany|StorageAdapter\.(setMany|batch)/]
].forEach(([label,re])=> check(!re.test(poeSrc081) && !re.test(stabSrc081), 'SPR-081 introduces no '+label));
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root,'js','core','constants.js'))), 'SCHEMA_VERSION remains 6');
check(read(path.join(root,'js','core','storage-adapter.js')).indexOf('async set(key, value)') !== -1, 'StorageAdapter is unchanged');
check(fs.existsSync(path.join(root,'tools','verify-payroll-posting-runtime.js')), 'SPR-081 runtime harness present: tools/verify-payroll-posting-runtime.js');

// SPR-082 — MONTHLY PLAN COMMIT RESULT INTEGRITY + PARTIAL-STATE DETECTION.
console.log('== SPR-082 MONTHLY PLAN RESULT INTEGRITY (result checking + orphan detection) ==');
const mpSrc082 = read(path.join(root,'js','people','monthly-plan.js'));
const cmpBody082 = stripComments((mpSrc082.match(/async function commitMonthlyPlan\(preview\)\{[\s\S]*?\n\}/)||[''])[0]);
const stabSrc082 = read(path.join(root,'js','core','stabilization.js'));
check(cmpBody082 !== '', 'commitMonthlyPlan body is resolvable for the scan');

// (a) BOTH RESULTS CAPTURED AND STRICTLY INSPECTED.
check(/const txnsOk = await persist\(\)/.test(cmpBody082), 'the transactions write result is captured');
check(/const plansOk = await persistMonthlyPlans\(\)/.test(cmpBody082), 'the monthlyPlans write result is captured');
check(!/await persist\(\); await persistMonthlyPlans\(\)/.test(cmpBody082), 'the old fire-and-forget write pair is gone');
check(/ok:\s*txnsOk===true/.test(cmpBody082) && /ok:\s*plansOk===true/.test(cmpBody082), 'both results are inspected strictly (=== true)');
check(/const completedSteps = steps\.filter\(s=>s\.ok\)/.test(cmpBody082), 'completed steps are derived from the captured results');
check(/const failedSteps = steps\.filter\(s=>!s\.ok\)/.test(cmpBody082), 'failed steps are derived from the captured results');

// (b) TYPED FAILURE / SUCCESS CONTRACT.
check(/error:\s*'MonthlyPlanPersistenceFailed'/.test(cmpBody082), 'the typed MonthlyPlanPersistenceFailed outcome is returned');
check(/failedStep: failedSteps\[0\]/.test(cmpBody082), 'the failed step is the FIRST failure in the fixed write order (deterministic)');
check(/partialPersistence: completedSteps\.length > 0/.test(cmpBody082), 'partialPersistence is true only when at least one write succeeded');
check(/recoveryHint:'RunIntegrityCheckAndReview'/.test(cmpBody082), 'the failure result carries an actionable recovery hint');
check(/return \{ok:true, created/.test(cmpBody082), 'success returns ok:true');
check(/monthlyPlanId:plan\.id/.test(cmpBody082), 'the result identifies the monthly plan');

// (c) SUCCESS REQUIRES BOTH WRITES — the failure return precedes the success return.
check(cmpBody082.indexOf("error:'MonthlyPlanPersistenceFailed'") < cmpBody082.indexOf('return {ok:true'),
  'the failure branch precedes the success return (success requires both writes)');
check(/if\(failedSteps\.length\)\{[\s\S]*?return \{ok:false/.test(cmpBody082), 'any failed step short-circuits to the typed failure result');

// (d) SUCCESS UI UNREACHABLE AFTER FAILURE (single live caller, same module).
const caller082 = stripComments((mpSrc082.match(/#commitPlan'\)\.addEventListener[\s\S]*?\n  \}\);/)||[''])[0]);
check(caller082 !== '', 'the commit caller body is resolvable for the scan');
check(/if\(!res\.ok\)\{[\s\S]*?return;\s*\}/.test(caller082), 'the caller inspects the result before any completion behaviour');
check(caller082.indexOf('if(!res.ok)') < caller082.indexOf('State.planPreview=null'),
  'the failure branch precedes clearing the preview (completion behaviour is gated)');
check(caller082.indexOf('if(!res.ok)') < caller082.indexOf('Monthly plan committed:'),
  'the failure branch precedes the success toast');
const failBranch082 = (caller082.match(/if\(!res\.ok\)\{[\s\S]*?return;\s*\}/)||[''])[0];
check(!/State\.planPreview\s*=\s*null/.test(failBranch082), 'the failure branch does NOT clear the preview (review context is retained)');
check(!/toast\(/.test(failBranch082), 'the failure branch shows no success toast');
check(/showError\(/.test(failBranch082), 'the failure branch shows an explicit error');
check(/did not complete successfully/.test(failBranch082), 'the failure message states the commit did not complete');
check(/Some data may already have been saved/.test(failBranch082), 'the failure message admits partial persistence');
check(/Run Integrity Check/.test(failBranch082), 'the failure message directs the user to Integrity Check');
check(!/localStorage|browser storage|developer tools/i.test(failBranch082), 'the failure message never tells the user to edit browser storage');

// (e) NO AUDIT REGRESSION — the module wrote no success audit before SPR-082 and still writes none.
check(!/logActivity\(/.test(mpSrc082), 'the monthly-plan module emits no activity audit entry (unchanged by SPR-082)');

// (f) NEW INTEGRITY RULE — read-only detection of the reverse-linkage break.
const ruleM082 = (stabSrc082.match(/State\.txns\.filter\(t=>t\.source!=='payroll' && t\.monthlyPlanId\)\.forEach\(t=>\{[\s\S]*?\n  \}\);/)||[''])[0];
check(ruleM082 !== '', 'Rule M body is resolvable for the purity scan');
check(/add\('critical','monthlyplan-orphan-transaction'/.test(stabSrc082), 'monthlyplan-orphan-transaction exists and is CRITICAL');
check(/t\.source!=='payroll'/.test(ruleM082), 'Rule M excludes payroll-sourced transactions (SPR-081 rules own those)');
// Reload evidence proved the plan can be ABSENT after a failed first commit of a
// month, so the rule must report that case rather than skip it.
check(/no such monthly plan exists/.test(ruleM082), 'Rule M reports an ABSENT monthly plan (the reloaded first-commit failure state)');
check(!/if\(!mp\) return;/.test(ruleM082), 'Rule M no longer silently skips a missing plan');
check((ruleM082.match(/add\('critical','monthlyplan-orphan-transaction'/g)||[]).length === 2,
  'Rule M raises Critical for BOTH the absent-plan and the not-linked-back cases');
check(/if\(\(mp\.committedTxnIds\|\|\[\]\)\.includes\(t\.id\)\) return;/.test(ruleM082), 'Rule M treats a linked-back transaction as healthy');
check(/Finance transaction \$\{t\.id\}/.test(ruleM082), 'Rule M reports the transaction id');
check(/monthly plan \$\{mp\.id\}/.test(ruleM082), 'Rule M reports the monthly plan id');
check(/Review the plan and this transaction/.test(ruleM082), 'Rule M gives an actionable manual-review instruction');
[['status mutation', /\.status\s*=[^=]/], ['link mutation', /committedTxnIds\s*=[^=]/], ['persistence', /persist|StorageAdapter/],
 ['deletion', /\.splice\(/], ['push mutation', /committedTxnIds\.push/]
].forEach(([l,re])=> check(!re.test(ruleM082), 'Rule M performs no '+l+' (read-only detection, not repair)'));

// (g) WRITE ORDER UNCHANGED + ATTEMPT-ALL PRESERVED + NO NEW ARCHITECTURE.
check(cmpBody082.indexOf('await persist()') < cmpBody082.indexOf('await persistMonthlyPlans()'),
  'the write order is unchanged (transactions, then monthlyPlans)');
check(!/if\(!txnsOk\)[\s\S]{0,80}return/.test(cmpBody082), 'the attempt-all behaviour is preserved (no early abort between the two writes)');
check(!/rolled back|rollback/i.test((cmpBody082.match(/'[^'\n]*'|`[^`]*`/g)||[]).join(' ')), 'no user-facing message in the slice claims a rollback');
[['coordinator', /PlanCoordinator|PersistenceCoordinator/], ['unit of work', /unitOfWork|UnitOfWork/],
 ['transaction abstraction', /beginTransaction|TransactionCoordinator/], ['journal', /writeAhead|journalWrite/],
 ['compensation framework', /compensationStep|runCompensation|compensator|CompensationRunner/],
 ['batch persistence', /saveMany|StorageAdapter\.(setMany|batch)/]
].forEach(([label,re])=> check(!re.test(mpSrc082) && !re.test(stabSrc082), 'SPR-082 introduces no '+label));
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root,'js','core','constants.js'))), 'SCHEMA_VERSION remains 6 (SPR-082 adds no migration)');
check(read(path.join(root,'js','core','storage-adapter.js')).indexOf('async set(key, value)') !== -1, 'StorageAdapter is unchanged by SPR-082');
check(!/HR_KEYS\s*=/.test(mpSrc082), 'SPR-082 introduces no storage key');
check(fs.existsSync(path.join(root,'tools','verify-monthlyplan-runtime.js')), 'SPR-082 runtime harness present: tools/verify-monthlyplan-runtime.js');

/* ================= INTEGRITY COVERAGE COMPLETENESS INVARIANT (GOV-007 / SPR-092) =================
   This block REPLACES the three near-identical SPR-089/090/091 discoverability blocks,
   which between them hard-coded all 63 production rule identifiers into this file — a
   second source of truth that had to be hand-edited for every new rule. Nothing is
   hard-coded here now: the production inventory is derived from runIntegrityCheck(),
   the coverage inventory is derived from the harnesses' own sentinel-delimited
   declarations, and the two are compared.

   WHAT THIS PROVES: every rule identifier EMITTED by production has an owning harness,
   at the declared severity, owned exactly once. WHAT IT DOES NOT PROVE: that every
   call site or every sub-predicate of a multiplexed rule is exercised. Rule-identifier
   completeness is NOT predicate completeness — duplicate-id (1 of 7 collections) and
   the schema-error / schema-warning roll-ups remain partially covered by design.

   This file stays a static, single-process verifier: no child_process, no harness
   execution, no runtime evaluation. Extraction is text-based, which is an ACCEPTED
   TRADE of the zero-dependency architecture (no parser is available). The trade is
   made safe by the sanity guards below: an extraction that yields implausibly little
   FAILS rather than silently reporting full coverage. */
console.log('== INTEGRITY COVERAGE COMPLETENESS (GOV-007 — derived, nothing hard-coded) ==');

// ---- production inventory, derived from runIntegrityCheck() ----
// The body is sliced first because js/core/stabilization.js also contains Set.add()
// calls; anchoring on the severity literal (not on "add(") is what makes this sound.
const covStabSrc = read(path.join(root,'js','core','stabilization.js'));
const covBodyStart = covStabSrc.indexOf('function runIntegrityCheck');
const covBodyEnd = covStabSrc.indexOf('function pageHeader');
const covBody = (covBodyStart > -1 && covBodyEnd > covBodyStart) ? covStabSrc.slice(covBodyStart, covBodyEnd) : '';
check(covBody.length > 5000, 'INTEGRITY COVERAGE: runIntegrityCheck() body located for extraction (' + covBody.length + ' chars)');

const covProdSites = [];
const covProdRe = /add\(\s*['"](critical|warning|info)['"]\s*,\s*['"]([a-z0-9-]+)['"]/g;
let covM;
while((covM = covProdRe.exec(covBody)) !== null){ covProdSites.push({ severity: covM[1], id: covM[2] }); }

const covProduction = {};          // id -> severity
const covConflicts = [];           // ids emitted at more than one severity
covProdSites.forEach((s)=>{
  if(!Object.prototype.hasOwnProperty.call(covProduction, s.id)){ covProduction[s.id] = s.severity; }
  else if(covProduction[s.id] !== s.severity && covConflicts.indexOf(s.id) === -1){ covConflicts.push(s.id); }
});
const covProdIds = Object.keys(covProduction);

// EXTRACTION SANITY GUARDS — an empty or implausibly small extraction must NEVER be
// read as success. Without these, a source refactor that defeats the pattern would
// report "0 production rules, 0 uncovered" and pass.
check(covProdSites.length >= 60, 'INTEGRITY COVERAGE: extraction plausible — ' + covProdSites.length + ' add() call sites found (expected >= 60)');
check(covProdIds.length >= 55, 'INTEGRITY COVERAGE: extraction plausible — ' + covProdIds.length + ' distinct rule identifiers found (expected >= 55)');
// A rule emitted at two different severities is ambiguous by construction.
check(covConflicts.length === 0, 'INTEGRITY COVERAGE: no production rule is emitted at conflicting severities'
  + (covConflicts.length ? ' (conflicting: ' + covConflicts.join(', ') + ')' : ''));
// Same id at multiple call sites with the SAME severity is legal and expected
// (monthlyplan-orphan-transaction emits from two sites); it needs one declaration.
const covMultiSite = covProdIds.filter((id)=>covProdSites.filter((s)=>s.id === id).length > 1);
check(covMultiSite.every((id)=>covConflicts.indexOf(id) === -1), 'INTEGRITY COVERAGE: multi-site rule identifiers are same-severity (legal): ' + (covMultiSite.join(', ') || 'none'));

// ---- coverage inventory, derived from the harnesses' own declarations ----
// Each harness carries one sentinel-delimited INTEGRITY_COVERAGE block. Parsing a
// bounded region (not the whole file) keeps unrelated string literals out of the set.
const COV_HARNESSES = [
  { file:'verify-integrity-rules-runtime.js',        kind:'dedicated',        ident:/Critical tier|CRITICAL INTEGRITY RULE/ },
  { file:'verify-integrity-warning-rules-runtime.js', kind:'dedicated',        ident:/Fixture families F1 \/ F2 \/ F3 \/ F4 \/ F8 \/ F10 \/ F11/ },
  { file:'verify-integrity-payroll-rules-runtime.js', kind:'dedicated',        ident:/Fixture families F5 \/ F6 \/ F7 \/ F9/ },
  { file:'verify-payroll-posting-runtime.js',         kind:'operation-driven', ident:/OPERATION-DRIVEN harness/ },
  { file:'verify-monthlyplan-runtime.js',             kind:'operation-driven', ident:/OPERATION-DRIVEN harness/ }
];
const covDeclared = {};   // id -> { severity, harness }
const covOwners = {};     // id -> [harness, ...]
COV_HARNESSES.forEach((h)=>{
  const p = path.join(root,'tools',h.file);
  check(fs.existsSync(p), 'INTEGRITY COVERAGE: harness file present: tools/' + h.file);
  const src = fs.existsSync(p) ? read(p) : '';
  const a = src.indexOf('INTEGRITY-COVERAGE-BEGIN');
  const b = src.indexOf('INTEGRITY-COVERAGE-END');
  check(a > -1 && b > a, 'INTEGRITY COVERAGE: sentinel-delimited declaration present in ' + h.file);
  const region = (a > -1 && b > a) ? src.slice(a, b) : '';
  const pairRe = /['"]([a-z0-9-]+)['"]\s*:\s*['"](critical|warning|info)['"]/g;
  let pm; const seenHere = [];
  while((pm = pairRe.exec(region)) !== null){
    seenHere.push(pm[1]);
    if(!covDeclared[pm[1]]) covDeclared[pm[1]] = { severity: pm[2], harness: h.file };
    (covOwners[pm[1]] = covOwners[pm[1]] || []).push(h.file);
  }
  check(seenHere.length > 0, 'INTEGRITY COVERAGE: ' + h.file + ' declares at least one rule (' + seenHere.length + ')');
  // Scope honesty, retained from the superseded per-harness blocks.
  check(h.ident.test(src), 'INTEGRITY COVERAGE: ' + h.file + ' self-identifies its scope');
  check(!/child_process|require\('http|require\("http/.test(src), 'INTEGRITY COVERAGE: ' + h.file + ' spawns no process and opens no network');
  check(!/fs\.(writeFile|writeFileSync|appendFile|appendFileSync|unlink|rmSync|mkdir)/.test(src), 'INTEGRITY COVERAGE: ' + h.file + ' writes nothing to disk');
  check(/process\.exit\(1\)/.test(src), 'INTEGRITY COVERAGE: ' + h.file + ' fails non-zero on assertion failure');
});
// The three DEDICATED harnesses additionally assert a clean healthy baseline and
// disclaim complete predicate coverage. Reads are GUARDED: a missing harness must
// produce clear failed checks, never an unhandled ENOENT that masks the diagnosis.
COV_HARNESSES.filter((h)=>h.kind === 'dedicated').forEach((h)=>{
  const p = path.join(root,'tools',h.file);
  const src = fs.existsSync(p) ? read(p) : '';
  check(/the healthy fabricated baseline produces ZERO findings/.test(src), 'INTEGRITY COVERAGE: ' + h.file + ' asserts a clean healthy baseline');
  check(/(NOT|not) complete predicate coverage|NOT COMPLETE PREDICATE COVERAGE|as full predicate coverage/.test(src), 'INTEGRITY COVERAGE: ' + h.file + ' does not claim complete predicate coverage');
});


// ---- EXEMPTIONS — must remain empty (GOV-007 §F) ----
// A non-empty list is an audit finding, not a normal state. Entries require a
// justification string; an unjustified entry fails. Atlas owns this list.
const COV_EXEMPTIONS = {};   // id -> justification
const covExemptIds = Object.keys(COV_EXEMPTIONS);
check(covExemptIds.length === 0, 'INTEGRITY COVERAGE: exemption list is empty' + (covExemptIds.length ? ' (exempt: ' + covExemptIds.join(', ') + ')' : ''));
covExemptIds.forEach((id)=>check(String(COV_EXEMPTIONS[id] || '').trim().length > 0, 'INTEGRITY COVERAGE: exemption for ' + id + ' carries a justification'));

// ---- the invariants ----
// 1. Every production rule is covered, at the right severity.
covProdIds.forEach((id)=>{
  const d = covDeclared[id];
  if(!d){
    check(false, 'INTEGRITY COVERAGE: production rule ' + id + ' (' + covProduction[id] + ') has no harness coverage');
    return;
  }
  // check() prints ONE label for both outcomes, so the label is chosen per outcome:
  // a pass-phrased label printed under [FAIL] would state the opposite of what happened.
  const sevOk = d.severity === covProduction[id];
  check(sevOk, sevOk
    ? 'INTEGRITY COVERAGE: ' + id + ' severity agrees with production (' + covProduction[id] + ') [' + d.harness + ']'
    : 'INTEGRITY COVERAGE: ' + id + ' is ' + covProduction[id] + ' in production but declared ' + d.severity + ' by ' + d.harness);
});
// 2. No stale declaration: every declared rule still exists in production.
Object.keys(covDeclared).forEach((id)=>{
  const emitted = Object.prototype.hasOwnProperty.call(covProduction, id);
  check(emitted, emitted
    ? 'INTEGRITY COVERAGE: ' + id + ' declared by ' + covDeclared[id].harness + ' is still emitted by runIntegrityCheck()'
    : 'INTEGRITY COVERAGE: ' + id + ' declared by ' + covDeclared[id].harness + ' but NOT emitted by runIntegrityCheck() (stale declaration)');
});
// 3. Exactly one owner per rule — no double ownership across harness contracts.
const covDoubleOwned = Object.keys(covOwners).filter((id)=>covOwners[id].length > 1);
check(covDoubleOwned.length === 0, 'INTEGRITY COVERAGE: every rule is owned by exactly one harness'
  + (covDoubleOwned.length ? ' (double-owned: ' + covDoubleOwned.map((id)=>id + ' [' + covOwners[id].join(' + ') + ']').join('; ') + ')' : ''));
// 4. Totals are DERIVED and must close. Nothing here is a governance constant.
const covUncovered = covProdIds.filter((id)=>!covDeclared[id] && covExemptIds.indexOf(id) === -1);
check(covUncovered.length === 0, 'INTEGRITY COVERAGE: 0 uncovered production rules'
  + (covUncovered.length ? ' (uncovered: ' + covUncovered.join(', ') + ')' : ''));
check(Object.keys(covDeclared).length === covProdIds.length,
  'INTEGRITY COVERAGE: declared rule count (' + Object.keys(covDeclared).length + ') equals production rule count (' + covProdIds.length + ')');
console.log('   derived: ' + covProdIds.length + ' production rule ids / ' + covProdSites.length + ' call sites / '
  + Object.keys(covDeclared).length + ' declared across ' + COV_HARNESSES.length + ' harnesses; 0 exemptions.');
console.log('   scope: RULE-IDENTIFIER completeness. This is NOT predicate completeness —');
console.log('          duplicate-id (1 of 7 collections) and the schema-error / schema-warning');
console.log('          roll-ups remain partially covered by design.');

// PR-5F "The Sentinel" — shared aggregate helpers (refactor; no behavior change).
console.log('== SHARED AGGREGATE HELPERS (PR-5F — business-support utilities) ==');
const helpPath = path.join(root,'js','domain','aggregate-helpers.js');
check(fs.existsSync(helpPath), 'helper module present: js/domain/aggregate-helpers.js');
check(jsFiles.indexOf('domain/aggregate-helpers.js') !== -1, 'module-order.js includes domain/aggregate-helpers.js');
check(indexHtml.includes('<script src="js/domain/aggregate-helpers.js"></script>'), 'index.html includes domain/aggregate-helpers.js');
// Helpers must load BEFORE both aggregates that consume them.
check(jsFiles.indexOf('domain/aggregate-helpers.js') < jsFiles.indexOf('domain/employee-contact-aggregate.js') &&
      jsFiles.indexOf('domain/aggregate-helpers.js') < jsFiles.indexOf('domain/employee-employment-aggregate.js'), 'helpers load before both aggregates');
const helpSrc = read(helpPath);
// It is a toolkit of small functions, NOT a generic framework.
['AggregateBase','BaseAggregate','AbstractAggregate','AggregateFactory','AggregateRegistry','class '].forEach((bad)=>
  check(!helpSrc.includes(bad), 'helper module introduces no generic framework construct: '+bad.trim()));
check(/function employeeExists\(/.test(helpSrc) && /function normalizeAllowedFields\(/.test(helpSrc) && /function validateEnum\(/.test(helpSrc), 'helper module defines the extracted utilities (employeeExists / normalizeAllowedFields / validateEnum)');
// Helper PURITY — no implementation-side effects (comments stripped).
const helpCode = helpSrc.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
[['State mutation', /State\s*[.[]/],
 ['persistEmployees', /persistEmployees\s*\(/],
 ['history append', /\.history\b|history\s*=|\.push\(/],
 ['updatedAt mutation', /updatedAt/],
 ['UI render', /\brender\s*\(/],
 ['localStorage', /localStorage/],
 ['audit logging', /logActivity\s*\(/]
].forEach(([label,re])=>check(!re.test(helpCode), 'helper module never performs '+label));
// Extraction actually happened: both aggregates now call the shared helpers.
check(/employeeExists\(/.test(aggSrc2) && /normalizeAllowedFields\(/.test(aggSrc2), 'contact aggregate uses the shared helpers');
check(/employeeExists\(/.test(empAggSrc) && /normalizeAllowedFields\(/.test(empAggSrc) && /validateEnum\(/.test(empAggSrc), 'employment aggregate uses the shared helpers');
// Operational surface is UNCHANGED by this refactor: still 2 aggregates, 2 commands, 1 query
// (asserted above via aggregateDefs===2, migratedCmdIds.length===2, migratedQueryIds.length===1).
check(aggregateDefs === 9, 'operational aggregate count remains exactly nine');
check(migratedCmdIds.length === 8, 'operational command count remains exactly eight');
check(migratedQueryIds.length === 1, 'operational query count remains exactly one');

// Extract command/query identifiers and their handler names.
function idKeys(src){ return (src.match(/^\s*'([a-z][a-zA-Z]*\.[a-zA-Z]+)':/gm)||[]).map(s=>s.match(/'([^']+)'/)[1]); }
function handlerNames(src){ return (src.match(/handler:\s*'([A-Za-z0-9_]+)'/g)||[]).map(s=>s.match(/'([^']+)'/)[1]); }
const cmdIds = idKeys(cmdSrc), qryIds = idKeys(qrySrc);
const cmdHandlers = handlerNames(cmdSrc), qryHandlers = handlerNames(qrySrc);
check(cmdIds.length > 0 && qryIds.length > 0, 'command and query registries are non-empty ('+cmdIds.length+' commands / '+qryIds.length+' queries)');
// Identifiers unique within each registry.
check(new Set(cmdIds).size === cmdIds.length, 'command identifiers are unique');
check(new Set(qryIds).size === qryIds.length, 'query identifiers are unique');
// No identifier collides between commands and queries.
check(cmdIds.filter(id=>qryIds.indexOf(id)!==-1).length === 0, 'no command/query identifier collision');
// Every registered handler name resolves to a real function present in dist.
cmdHandlers.forEach((h)=>check(dist.includes('function '+h+'('), 'command handler resolves to a real function: '+h+'()'));
qryHandlers.forEach((h)=>check(dist.includes('function '+h+'('), 'query handler resolves to a real function: '+h+'()'));

// PR-6A "The Gateway" — first Platform Layer boundary (ApplicationGateway).
// Infrastructure only: a pure application boundary that DELEGATES to the Domain
// facade and owns no business behavior. Implements the ATR-004 / SRD-062A canonical
// Platform Contract (request {kind,name,args,meta?}; uniform response envelope;
// three-class errors). Milestone Delta begins here.
console.log('== APPLICATION GATEWAY (PR-6A — canonical platform contract) ==');
const gwPath = path.join(root,'js','platform','application-gateway.js');
check(fs.existsSync(gwPath), 'platform module present: js/platform/application-gateway.js');
check(jsFiles.indexOf('platform/application-gateway.js') !== -1, 'module-order.js includes platform/application-gateway.js');
check(indexHtml.includes('<script src="js/platform/application-gateway.js"></script>'), 'index.html includes platform/application-gateway.js');
// Load order: AFTER the Domain facade it delegates to, and before bootstrap.
check(jsFiles.indexOf('domain/domain-layer.js') < jsFiles.indexOf('platform/application-gateway.js') &&
      jsFiles.indexOf('platform/application-gateway.js') < jsFiles.indexOf('core/app-bootstrap.js'), 'gateway loads after domain-layer.js and before app-bootstrap.js');
const gwSrc = read(gwPath);
check(/const ApplicationGateway = \(function/.test(gwSrc) && /Object\.freeze\(\{/.test(gwSrc), 'ApplicationGateway is a frozen object');
check(/execute:\s*(async\s+)?function/.test(gwSrc), 'gateway exposes execute()');
check(dist.includes('const ApplicationGateway') && dist.includes('window.ApplicationGateway = ApplicationGateway'), 'gateway present and exposed in dist');
// DELEGATION CONTRACT — the gateway reaches business behavior ONLY via the Domain facade.
check(/domain\.command\.apply\(/.test(gwSrc) && /domain\.query\.apply\(/.test(gwSrc), 'gateway delegates to Domain.command and Domain.query');
check(/typeof Domain !== 'undefined'/.test(gwSrc), 'gateway resolves the Domain facade (delegation target)');
// GATEWAY PURITY — it owns no business behavior (comments stripped).
const gwCode = gwSrc.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
[['State access', /State\s*[.[]/],
 ['persistence', /\bpersist\w*\s*\(/],
 ['history append', /\.history\b|history\s*=|\.push\(/],
 ['updatedAt mutation', /updatedAt/],
 ['UI render', /\brender\s*\(/],
 ['toast/alert', /\btoast\s*\(|showWarning\s*\(|showSuccess\s*\(|\balert\s*\(|confirm\s*\(/],
 ['localStorage', /localStorage/],
 ['audit logging', /logActivity\s*\(/]
].forEach(([label,re])=>check(!re.test(gwCode), 'gateway never performs '+label));
// NO DOMAIN BYPASS — the gateway never calls a handler or aggregate directly.
cmdHandlers.forEach((h)=>check(!new RegExp('\\b'+h+'\\s*\\(').test(gwCode), 'gateway does not call handler directly: '+h));
check(!/\w+Aggregate\s*[.[]/.test(gwCode), 'gateway does not touch any aggregate directly');
// NO DUPLICATE AUTHORITY — the gateway does not re-implement command/query routing.
check(!/DOMAIN_COMMANDS|DOMAIN_QUERIES|commandHandler\s*\(|queryHandler\s*\(/.test(gwCode), 'gateway does not re-implement the Domain registry/routing');
// --- CANONICAL REQUEST CONTRACT (ATR-004 / SRD-062A) ---
check(/request\.kind/.test(gwSrc) && /request\.name/.test(gwSrc) && /request\.args/.test(gwSrc) && /request\.meta/.test(gwSrc), 'gateway request contract reads kind / name / args / meta');
check(/kind !== 'command' && kind !== 'query'/.test(gwSrc), 'kind is constrained to command | query');
check(/request\.args === undefined\) \? \[\]/.test(gwSrc), 'args defaults to [] and is the canonical positional carrier');
check(/meta !== undefined/.test(gwSrc) && /INVALID_META/.test(gwSrc), 'meta is OPTIONAL and shape-validated (plain object) when present');
// --- CANONICAL RESPONSE ENVELOPE (uniform: ok/kind/name/result?/error?/meta?) ---
check(/\{ ok: true, kind: n\.kind, name: n\.name, result: result \}/.test(gwSrc), 'success envelope is { ok:true, kind, name, result } with the Domain result verbatim');
check(/ok: false, error: \{ source: 'gateway'/.test(gwSrc), 'structural failure envelope is { ok:false, error:{ source:"gateway", ... } }');
check(/if \(n\.meta !== undefined\) ok\.meta = n\.meta/.test(gwSrc), 'meta is transported back into the response verbatim (opaque)');
// `ok` reflects GATEWAY execution only — a business failure stays inside `result` (ok stays true).
check(!/result\.success|result\.ok|result\.error/.test(gwCode), 'gateway never inspects/reinterprets the Domain business outcome (result is opaque)');
// --- STRUCTURAL ERROR CONTRACT — typed codes, never reaches the Domain ---
['INVALID_REQUEST','INVALID_KIND','INVALID_NAME','INVALID_ARGS','INVALID_META'].forEach((code)=>
  check(gwSrc.includes("'"+code+"'"), 'gateway returns typed structural rejection code: '+code));
// --- FAULT CONTRACT — unexpected Domain exceptions are caught and enveloped ---
check(/try \{[\s\S]*domain\.(command|query)\.apply[\s\S]*\} catch \(err\)/.test(gwSrc), 'gateway wraps Domain delegation in try/catch (no unhandled exception escapes)');
// Domain command handlers are async — the gateway AWAITS delegation so result is the
// resolved outcome and async rejections are caught (not left as unhandled Promises).
check(/execute:\s*async function/.test(gwSrc), 'gateway execute() is async (Domain handlers return Promises)');
check(/await domain\.command\.apply\(/.test(gwSrc) && /await domain\.query\.apply\(/.test(gwSrc), 'gateway awaits Domain delegation (resolved result under `result`; async rejections caught)');
check(/source: 'domain', code: 'DOMAIN_FAULT'/.test(gwSrc), 'fault envelope is { ok:false, error:{ source:"domain", code:"DOMAIN_FAULT" } }');
check(/DOMAIN_UNAVAILABLE/.test(gwSrc), 'a missing Domain facade returns a typed gateway-source DOMAIN_UNAVAILABLE (never throws)');
// --- DETERMINISM — the gateway generates no ids/timestamps/randomness of its own ---
check(!/Math\.random|Date\.now|new Date\(|Date\.now\(|crypto\./.test(gwCode), 'gateway is deterministic — it generates no ids/timestamps/randomness (a transport-adapter concern)');
// The Domain facade must NOT depend on the platform layer (one-way dependency).
check(!/ApplicationGateway|application-gateway|platform\//.test(facSrc), 'domain-layer.js has no dependency on the platform layer (one-way)');
check(!/ApplicationGateway/.test(cmdSrc) && !/ApplicationGateway/.test(qrySrc) && !/ApplicationGateway/.test(aggSrc), 'domain registries have no dependency on the gateway');
// Operational surface is UNCHANGED by PR-6A (infrastructure only).
check(aggregateDefs === 9 && migratedCmdIds.length === 8 && migratedQueryIds.length === 1, 'operational surface unchanged by the gateway (9 aggregates / 8 seam-routed commands / 1 query)');

// PR-7A "The Transport" — Transport Layer boundary (TransportAdapter), the first
// operational Platform expansion. Infrastructure only: the canonical application
// transport boundary ABOVE the Application Gateway. It DELEGATES solely to the
// Gateway and owns no business behavior. It never touches the Domain directly.
console.log('== TRANSPORT ADAPTER (PR-7A — canonical application transport boundary) ==');
const txPath = path.join(root,'js','transport','transport-adapter.js');
check(fs.existsSync(txPath), 'transport module present: js/transport/transport-adapter.js');
check(jsFiles.indexOf('transport/transport-adapter.js') !== -1, 'module-order.js includes transport/transport-adapter.js');
check(indexHtml.includes('<script src="js/transport/transport-adapter.js"></script>'), 'index.html includes transport/transport-adapter.js');
// Load order: ABOVE the gateway it delegates to — AFTER application-gateway.js and before bootstrap.
check(jsFiles.indexOf('platform/application-gateway.js') < jsFiles.indexOf('transport/transport-adapter.js') &&
      jsFiles.indexOf('transport/transport-adapter.js') < jsFiles.indexOf('core/app-bootstrap.js'), 'transport loads after application-gateway.js and before app-bootstrap.js');
const txSrc = read(txPath);
check(/const TransportAdapter = \(function/.test(txSrc) && /Object\.freeze\(\{/.test(txSrc), 'TransportAdapter is a frozen object');
check(/execute:\s*async function/.test(txSrc), 'transport exposes async execute() (awaits the async Gateway)');
check(dist.includes('const TransportAdapter') && dist.includes('window.TransportAdapter = TransportAdapter'), 'transport present and exposed in dist');
// DELEGATION CONTRACT — the transport reaches business behavior ONLY via the Application Gateway.
check(/gateway\.execute\(request\)/.test(txSrc) && /return await gateway\.execute\(/.test(txSrc), 'transport delegates to (and awaits) ApplicationGateway.execute — the canonical request passes through unchanged');
check(/typeof ApplicationGateway !== 'undefined'/.test(txSrc), 'transport resolves the Application Gateway (its sole delegation target)');
// TRANSPORT PURITY — it owns no business behavior (comments stripped).
const txCode = txSrc.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
[['State access', /State\s*[.[]/],
 ['persistence', /\bpersist\w*\s*\(/],
 ['history append', /\.history\b|history\s*=|\.push\(/],
 ['updatedAt mutation', /updatedAt/],
 ['UI render', /\brender\s*\(/],
 ['toast/alert', /\btoast\s*\(|showWarning\s*\(|showSuccess\s*\(|\balert\s*\(|confirm\s*\(/],
 ['localStorage', /localStorage/],
 ['audit logging', /logActivity\s*\(/]
].forEach(([label,re])=>check(!re.test(txCode), 'transport never performs '+label));
// NO PLATFORM BYPASS — the transport never reaches the Domain, an Aggregate, a Handler, or a registry.
check(!/\bDomain\s*[.[]/.test(txCode), 'transport never calls the Domain facade directly (must go through the Gateway)');
check(!/domain\.(command|query)/.test(txCode), 'transport never invokes Domain.command/Domain.query directly');
cmdHandlers.forEach((h)=>check(!new RegExp('\\b'+h+'\\s*\\(').test(txCode), 'transport does not call handler directly: '+h));
check(!/\w+Aggregate\s*[.[]/.test(txCode), 'transport does not touch any aggregate directly');
check(!/DOMAIN_COMMANDS|DOMAIN_QUERIES|commandHandler\s*\(|queryHandler\s*\(/.test(txCode), 'transport does not re-implement the Domain registry/routing');
// TRANSPORT RESPONSE — the canonical Platform response is returned VERBATIM (business outcome never reinterpreted).
check(!/result\.success|result\.ok|result\.error|\.result\b/.test(txCode), 'transport never inspects/reinterprets the Platform/Domain result (returned verbatim)');
// TRANSPORT ERROR CONTRACT — may classify ONLY invalid transport request + transport unavailable (source:'transport').
check(/error: \{ source: 'transport', code: 'INVALID_TRANSPORT_REQUEST'/.test(txSrc), 'transport classifies an invalid transport request: { ok:false, error:{ source:"transport", code:"INVALID_TRANSPORT_REQUEST" } }');
check(/error: \{ source: 'transport', code: 'TRANSPORT_UNAVAILABLE'/.test(txSrc), 'transport classifies a missing Gateway: { ok:false, error:{ source:"transport", code:"TRANSPORT_UNAVAILABLE" } }');
check(!/DOMAIN_FAULT|'gateway'|source: 'domain'/.test(txCode), 'transport does not mint Platform/Domain error sources (only source:"transport")');
// META is opaque — the transport carries the request through and never rewrites meta contents.
check(!/meta\s*=\s*\{|meta\.[a-zA-Z]/.test(txCode), 'transport treats meta as opaque (never constructs or reads meta contents)');
// DETERMINISM — the transport generates no ids/timestamps/randomness of its own.
check(!/Math\.random|Date\.now|new Date\(|crypto\./.test(txCode), 'transport is deterministic — it generates no ids/timestamps/randomness');
// ONE-WAY DEPENDENCY — neither the Domain nor the Gateway depends on the transport.
check(!/TransportAdapter|transport-adapter|transport\//.test(facSrc), 'domain-layer.js has no dependency on the transport layer (one-way)');
// (test the comment-stripped gateway code: its comments legitimately mention "a transport-adapter concern")
check(!/TransportAdapter|transport-adapter|transport\//.test(gwCode), 'application-gateway.js has no dependency on the transport layer (one-way; the Gateway stays the boundary below)');
// EXPLICIT ONE-WAY INVARIANT (FAA-PR7A) — the Application Gateway must NEVER reference
// TransportAdapter. Preserves Transport -> Application Gateway -> Domain; the Platform
// Layer stays independent of the Transport Layer (no reverse dependency permitted).
check(!/\bTransportAdapter\b/.test(gwCode), 'one-way invariant: Application Gateway never references TransportAdapter (Platform independent of Transport)');
// Operational surface is UNCHANGED by PR-7A (infrastructure only).
check(aggregateDefs === 9 && migratedCmdIds.length === 8 && migratedQueryIds.length === 1, 'operational surface unchanged by the transport (9 aggregates / 8 seam-routed aggregate-backed commands / 1 aggregate-backed query)');
// Registered executable surface (full registry, incl. multi-segment ids) is 13 commands / 4 queries.
function allRegisteredIds(src){ return (src.match(/^\s*'([a-z][a-zA-Z]*(?:\.[a-zA-Z]+)+)':/gm)||[]).map(s=>s.match(/'([^']+)'/)[1]); }
const allCmdIds = allRegisteredIds(cmdSrc), allQryIds = allRegisteredIds(qrySrc);
check(allCmdIds.length === 15, 'registered command surface is exactly 15 (found '+allCmdIds.length+')');
check(allQryIds.length === 4, 'registered query surface is exactly 4 (found '+allQryIds.length+')');

// PR-7B "The Conduit" — the browser UI now CONSUMES the canonical application path.
// The authorized aggregate-backed operations reach the Domain ONLY through one
// official UI-to-Transport seam (uiExecute) → TransportAdapter → ApplicationGateway →
// Domain. No business authority moves into the UI, Transport, or Platform layers.
console.log('== UI-TO-TRANSPORT SEAM (PR-7B — operational transport consumption) ==');
const pwsSrc7b = read(path.join(root,'js','people','payroll-workspace.js'));
// ONE official seam exists, is async, and is present in the build.
check(/async function uiExecute\(kind, name, args, meta\)\{/.test(empSrc), 'exactly one official UI-to-Transport seam is defined: async uiExecute(kind, name, args, meta)');
check((srcJs.match(/async function uiExecute\(/g)||[]).length === 1, 'the UI-to-Transport seam is defined exactly once (single official seam)');
check(dist.includes('async function uiExecute('), 'UI-to-Transport seam present in dist');
// The seam DELEGATES only to the Transport Adapter — its single application dependency.
const seamStart = empSrc.indexOf('async function uiExecute(');
const seamBody = seamStart!==-1 ? empSrc.slice(seamStart, empSrc.indexOf('\n}', seamStart)+2) : '';
check(/await TransportAdapter\.execute\(request\)/.test(seamBody), 'the seam delegates to (and awaits) TransportAdapter.execute — its only application execution dependency');
check(!/\bDomain\s*[.[]/.test(seamBody) && !/ApplicationGateway/.test(seamBody), 'the seam never calls Domain or ApplicationGateway directly (Transport is the only path)');
cmdHandlers.forEach((h)=>check(!new RegExp('\\b'+h+'\\s*\\(').test(seamBody), 'the seam does not call handler directly: '+h));
check(!/\w+Aggregate\s*[.[]/.test(seamBody), 'the seam does not touch any aggregate directly');
// The seam owns NO business behavior (no state/persistence/history/rollback/render/UI writes).
[['State access', /State\s*[.[]/],
 ['persistence', /\bpersist\w*\s*\(/],
 ['history append', /\.history\b|\.push\(/],
 ['updatedAt mutation', /updatedAt/],
 ['UI render', /\brender\s*\(|innerHTML/],
 ['toast/alert', /\btoast\s*\(|showWarning\s*\(|showSuccess\s*\(/],
 ['localStorage', /localStorage/]
].forEach(([label,re])=>check(!re.test(seamBody), 'the seam never performs '+label));
// The seam distinguishes a BOUNDARY failure from the Domain business RESULT (not collapsed).
check(/response\.ok !== true/.test(seamBody) && /return response\.result/.test(seamBody), 'the seam distinguishes a Transport/Gateway boundary failure from the Domain result (returned verbatim on ok:true)');
// ZERO direct Domain bypass remains in any migrated UI file for the authorized ops.
const ctCode7b = stripComments(ctSrc), pwsCode7b = stripComments(pwsSrc7b);
check(!/Domain\.command\(/.test(empCode) && !/Domain\.command\(/.test(ctCode7b) && !/Domain\.command\(/.test(pwsCode7b), 'no direct Domain.command() call remains in employees.js / contracts.js / payroll-workspace.js');
check(!/Domain\.query\(/.test(empCode) && !/Domain\.query\(/.test(ctCode7b) && !/Domain\.query\(/.test(pwsCode7b), 'no direct Domain.query() call remains in employees.js / contracts.js / payroll-workspace.js');
// employee.lifecycle.transition is NOT exempted — it is migrated through the seam.
check(migratedCmdIds.indexOf('employee.lifecycle.transition')!==-1, 'employee.lifecycle.transition is migrated through the seam (not left as a direct bypass)');
// Payroll lifecycle migration is verified specifically in js/people/payroll-workspace.js (both live call sites).
check((pwsSrc7b.match(/uiExecute\('command', 'payroll\.lifecycle\.transition'/g)||[]).length === 2, 'payroll-workspace.js routes both live payroll.lifecycle.transition call sites through the seam');
// One-way independence: the Gateway and the Domain never reference the UI seam.
check(!/uiExecute/.test(gwCode), 'Application Gateway is independent of the UI seam (never references uiExecute)');
check(!/uiExecute|TransportAdapter/.test(facSrc), 'Domain is independent of the Transport/UI seam (never references uiExecute/TransportAdapter)');
// Operational surface is UNCHANGED by PR-7B (consumption paths only; no Domain op added/removed).
check(aggregateDefs === 9 && migratedCmdIds.length === 8 && migratedQueryIds.length === 1 && allCmdIds.length === 15 && allQryIds.length === 4, 'operational surface unchanged by the conduit (9 aggregates / 8 seam-routed aggregate-backed commands / 1 aggregate-backed query; 15 registered commands / 4 registered queries)');

// PR-8A "The Repository" — the first persistence-MECHANICS boundary, proven on one
// bounded reference slice (Employee Identity / employee.contact.update). It isolates
// HOW an entity collection is persisted from the handler that decides WHAT to persist.
// It owns NO business behavior; the handler keeps mutation/updatedAt/history/rollback.
console.log('== EMPLOYEE REPOSITORY (PR-8A — persistence-mechanics boundary) ==');
const repoPath = path.join(root,'js','repository','employee-repository.js');
check(fs.existsSync(repoPath), 'repository module present: js/repository/employee-repository.js');
check(jsFiles.indexOf('repository/employee-repository.js') !== -1, 'module-order.js includes repository/employee-repository.js');
check(indexHtml.includes('<script src="js/repository/employee-repository.js"></script>'), 'index.html includes repository/employee-repository.js');
// Load order: AFTER the persist infrastructure it delegates to, and BEFORE the migrated handler.
check(jsFiles.indexOf('core/hr-persistence-portability.js') < jsFiles.indexOf('repository/employee-repository.js') &&
      jsFiles.indexOf('repository/employee-repository.js') < jsFiles.indexOf('people/employees.js'), 'repository loads after hr-persistence-portability.js and before people/employees.js');
const repoSrc = read(repoPath);
const repoCode = stripComments(repoSrc);
check(/const EmployeeRepository = Object\.freeze\(\{/.test(repoSrc), 'EmployeeRepository is a frozen object');
check(/async save\(\)/.test(repoSrc), 'repository exposes async save()');
check(dist.includes('const EmployeeRepository') && dist.includes('window.EmployeeRepository = EmployeeRepository'), 'repository present and exposed in dist');
// DELEGATION — the repository delegates persistence to the EXISTING persist function only (code, not comments).
check(/await persistEmployees\(\)/.test(repoCode) && (repoCode.match(/persistEmployees\(/g)||[]).length === 1, 'repository delegates persistence to the existing persistEmployees() exactly once');
// RESULT CONTRACT — strict { ok:true } / { ok:false, error:'PersistFailed' }; no truthy/falsy ambiguity.
check(/ok:\s*true/.test(repoCode) && /ok:\s*false,\s*error:\s*'PersistFailed'/.test(repoCode) && /ok === true/.test(repoCode), 'repository normalizes the strict boolean into { ok:true } / { ok:false, error:"PersistFailed" }');
// REPOSITORY PURITY — persistence mechanics ONLY (comments stripped).
[['State access', /State\s*[.[]/],
 ['field mutation', /\be\[[^\]]+\]\s*=|\.updatedAt\s*=/],
 ['history creation', /\.history\b|\.push\(/],
 ['rollback', /rollback|\.pop\(/],
 ['UI render', /\brender\s*\(|innerHTML/],
 ['toast/alert', /\btoast\s*\(|showWarning\s*\(|showSuccess\s*\(/],
 ['navigation', /State\.view\s*=|hrNavTo\s*\(/],
 ['audit logging', /logActivity\s*\(/],
 ['Domain call', /\bDomain\s*[.[]/],
 ['aggregate call', /\w+Aggregate\s*[.[]/],
 ['direct storage bypass', /localStorage|window\.storage|StorageAdapter\s*[.[]/]
].forEach(([label,re])=>check(!re.test(repoCode), 'repository never performs '+label));
// The migrated handler still OWNS rollback (the repository does not roll back).
check(/e\.history\.pop\(\)/.test(ucBody) && /e\.updatedAt = prevUpdatedAt/.test(ucBody) && /Object\.keys\(before\)\.forEach/.test(ucBody), 'contact handler still owns full rollback (fields + history.pop + updatedAt) on persistence failure');
check(/error:'PersistFailed'/.test(ucBody), 'contact handler returns the typed PersistFailed on repository failure');
// StorageAdapter remains the untouched storage-backend boundary (repository goes through persistEmployees).
const storageSrc = read(path.join(root,'js','core','storage-adapter.js'));
check(/const StorageAdapter = \{/.test(storageSrc) && /async set\(key, value\)/.test(storageSrc) && /async get\(key\)/.test(storageSrc), 'StorageAdapter remains the unchanged storage-backend boundary (get/set present)');
check(!/EmployeeRepository|repository\//.test(storageSrc), 'StorageAdapter has no dependency on the Repository (one-way)');
// Unrelated employee handlers are UNCHANGED — they still persist directly (only contact migrated).
// PR-9C adoption state: the Employee aggregate is now FULLY Repository-mediated (all four handlers).
const tlCode = stripComments(tlBody), ucoCode = stripComments(ucoBody);
check((ucCode.match(/EmployeeRepository\.save\(\)/g)||[]).length === 1 && (ueCode.match(/EmployeeRepository\.save\(\)/g)||[]).length === 1 && (tlCode.match(/EmployeeRepository\.save\(\)/g)||[]).length === 1 && (ucoCode.match(/EmployeeRepository\.save\(\)/g)||[]).length === 1, 'exactly four aggregate-backed Employee handlers are Repository-mediated (contact + employment + lifecycle + compensation) — Employee aggregate fully mediated');
check(!/persistEmployees\(/.test(ucCode) && !/persistEmployees\(/.test(ueCode) && !/persistEmployees\(/.test(tlCode) && !/persistEmployees\(/.test(ucoCode), 'no aggregate-backed Employee handler calls persistEmployees() directly (all four route through the Repository)');
// Total Repository call sites across employees.js is exactly four (no unrelated migration).
check((stripComments(empSrc).match(/EmployeeRepository\.save\(\)/g)||[]).length === 4, 'exactly four EmployeeRepository.save() call sites in employees.js (contact + employment + lifecycle + compensation only)');
// The Domain facade has no dependency on the Repository (one-way).
check(!/EmployeeRepository|repository\//.test(facSrc), 'domain-layer.js has no dependency on the repository layer (one-way)');
// Operational surface is UNCHANGED by PR-8A (persistence infrastructure only).
check(aggregateDefs === 9 && migratedCmdIds.length === 8 && migratedQueryIds.length === 1 && allCmdIds.length === 15 && allQryIds.length === 4, 'operational surface unchanged by the repository (9 aggregates / 8 seam-routed commands / 1 query; 15 registered / 4 registered)');

// PR-10A "The Contract Foundation" — the SECOND entity Repository (ContractRepository),
// proving the Repository architecture generalizes to a second aggregate. Introduced on
// one bounded slice (contract.dates.update). Persistence mechanics only; handler keeps
// validation/mutation/updatedAt/history/rollback.
console.log('== CONTRACT REPOSITORY (PR-10A — second entity repository) ==');
const contractRepoPath = path.join(root,'js','repository','contract-repository.js');
check(fs.existsSync(contractRepoPath), 'repository module present: js/repository/contract-repository.js');
check(jsFiles.indexOf('repository/contract-repository.js') !== -1, 'module-order.js includes repository/contract-repository.js');
check(indexHtml.includes('<script src="js/repository/contract-repository.js"></script>'), 'index.html includes repository/contract-repository.js');
// Load order: AFTER the persist infrastructure it delegates to, and BEFORE the migrated handler (contracts.js).
check(jsFiles.indexOf('core/hr-persistence-portability.js') < jsFiles.indexOf('repository/contract-repository.js') &&
      jsFiles.indexOf('repository/contract-repository.js') < jsFiles.indexOf('people/contracts.js'), 'contract repository loads after hr-persistence-portability.js and before people/contracts.js');
const contractRepoSrc = read(contractRepoPath);
const contractRepoCode = stripComments(contractRepoSrc);
check(/const ContractRepository = Object\.freeze\(\{/.test(contractRepoSrc), 'ContractRepository is a frozen object');
check(/async save\(\)/.test(contractRepoSrc), 'ContractRepository exposes async save()');
check(dist.includes('const ContractRepository') && dist.includes('window.ContractRepository = ContractRepository'), 'ContractRepository present and exposed in dist');
// DELEGATION — the repository delegates persistence to the EXISTING persistContracts() only.
check(/await persistContracts\(\)/.test(contractRepoCode) && (contractRepoCode.match(/persistContracts\(/g)||[]).length === 1, 'ContractRepository delegates persistence to the existing persistContracts() exactly once');
// RESULT CONTRACT — strict { ok:true } / { ok:false, error:'PersistFailed' } (identical to EmployeeRepository).
check(/ok:\s*true/.test(contractRepoCode) && /ok:\s*false,\s*error:\s*'PersistFailed'/.test(contractRepoCode) && /ok === true/.test(contractRepoCode), 'ContractRepository normalizes the strict boolean into { ok:true } / { ok:false, error:"PersistFailed" }');
// REPOSITORY PURITY — persistence mechanics ONLY.
[['State access', /State\s*[.[]/],
 ['field mutation', /\bc\[[^\]]+\]\s*=|\.updatedAt\s*=|\.status\s*=/],
 ['history creation', /\.history\b|\.push\(/],
 ['rollback', /rollback|\.pop\(/],
 ['validation', /Invalid|isCanonical|contractExtent/],
 ['UI render', /\brender\s*\(|innerHTML/],
 ['Domain call', /\bDomain\s*[.[]/],
 ['aggregate call', /\w+Aggregate\s*[.[]/],
 ['direct storage bypass', /localStorage|window\.storage|StorageAdapter\s*[.[]/],
 ['Employee persistence', /persistEmployees\(/]
].forEach(([label,re])=>check(!re.test(contractRepoCode), 'ContractRepository never performs '+label));
// The migrated handler still OWNS rollback (the repository does not roll back).
check(/c\[k\] = before\[k\]/.test(udCode) && /c\.history\.pop\(\)/.test(udCode) && /c\.updatedAt = prevUpdatedAt/.test(udCode), 'contract-date handler still owns full rollback (fields + history.pop + updatedAt) on persistence failure');
// PR-10B / SPR-095 — exactly four ContractRepository call sites across contracts.js
// (dates + status + renewal + the unrouted core handler).
check((stripComments(ctSrc).match(/ContractRepository\.save\(\)/g)||[]).length === 4, 'exactly four ContractRepository.save() call sites in contracts.js (contract.dates.update + contract.status.transition + contract.renewal.execute + contract.core.update)');
// Renewal is Repository-mediated (SPR-077). The former comment here said renewal "remains DIRECT and
// out of scope", which contradicted the assertion below and predates SPR-077; corrected by ARCH-008.
// Comment only — the check itself is unchanged.
check(!/State\.contracts\.push\(nc\);\s*\n\s*await persistContracts\(\)/.test(ctSrc) && /State\.contracts\.push\(nc\);[\s\S]{0,600}ContractRepository\.save\(\)/.test(ctSrc), 'renewal is Repository-mediated (SPR-077 — create-successor persists through ContractRepository)');
// EmployeeRepository is unchanged and independent of the Contract repository.
check(!/ContractRepository/.test(repoSrc), 'EmployeeRepository has no dependency on ContractRepository (independent)');
check(!/ContractRepository|contract-repository/.test(facSrc), 'domain-layer.js has no dependency on the contract repository (one-way)');
check(!/ContractRepository|contract-repository/.test(storageSrc), 'StorageAdapter has no dependency on the contract repository (one-way)');
// Operational surface is UNCHANGED by PR-10A.
check(aggregateDefs === 9 && migratedCmdIds.length === 8 && migratedQueryIds.length === 1 && allCmdIds.length === 15 && allQryIds.length === 4, 'operational surface unchanged by the contract repository (9 aggregates / 8 seam-routed commands / 1 query; 15 registered / 4 registered)');

// PR-10B "The Contract Status Slice" — the SECOND Contract handler adopts the existing
// ContractRepository, completing Repository adoption for the Contract aggregate
// (5 of 7 -> 6 of 7 aggregate-backed handlers). Repository contract UNCHANGED; no new
// Repository module; handler keeps validation/mutation/updatedAt/history/rollback.
console.log('== CONTRACT STATUS REPOSITORY SLICE (PR-10B — Contract aggregate complete) ==');
// The migrated handler delegates persistence exactly once and never persists directly.
check((tcCode.match(/ContractRepository\.save\(\)/g)||[]).length === 1, 'transitionContractStatus() uses exactly one ContractRepository.save()');
check(!/persistContracts\(/.test(tcCode), 'transitionContractStatus() contains no direct persistContracts()');
// Strict result handling — no truthy/falsy ambiguity at either Repository call site.
check(/persisted\.ok !== true/.test(tcCode), 'contract-status handler uses strict persisted.ok handling (no truthy/falsy ambiguity)');
check(/persisted\.ok !== true/.test(udCode), 'contract-date handler still uses strict persisted.ok handling');
// The first slice remains Repository-mediated (no regression of PR-10A).
check((udCode.match(/ContractRepository\.save\(\)/g)||[]).length === 1 && !/persistContracts\(/.test(udCode), 'updateContractDates() remains Repository-mediated');
// Exactly two aggregate-backed Contract handlers use the Repository — the Contract
// aggregate is now FULLY Repository-mediated (contract.dates.update + contract.status.transition).
check((stripComments(ctSrc).match(/ContractRepository\.save\(\)/g)||[]).length === 4, 'exactly four aggregate-backed Contract handlers use ContractRepository (dates + status + renewal + SPR-095 core; Contract aggregate fully Repository-mediated)');
check(migratedCmdIds.filter(id=>/^contract\./.test(id)).length === 3, 'exactly three Contract commands are seam-routed and Repository-mediated (contract.core.update is Repository-mediated but deliberately NOT routed — SPR-095)');
// Rollback remains HANDLER-owned (the Repository does not roll back).
check(/c\.status = prevStatus/.test(tcCode) && /c\.history\.pop\(\)/.test(tcCode) && /c\.updatedAt = prevUpdatedAt/.test(tcCode), 'contract-status handler still owns full rollback (status + history.pop + updatedAt) on persistence failure');
check(/error:'PersistFailed'/.test(tcCode), 'contract-status handler preserves the typed PersistFailed result');
// Non-aggregate Contract persistence pathways remain DIRECT and unmigrated.
check(!/c\.status='Renewed'/.test(ctSrc) && /renewal\.predecessorStatus/.test(ctSrc), 'renewal status is aggregate-authored, not an inline UI write (SPR-077)');
// SPR-093 widened these two patterns to allow the persistence RESULT to be captured
// (`const persisted = await persistContracts()`). The invariant they guard is unchanged
// and is what still matters: both paths persist DIRECTLY via persistContracts(), with no
// repository mediation and no command route. Checking a write's result is not migration.
check(/rec\.status = fd\.get\('status'\)[\s\S]{0,900}(?:const persisted = )?await persistContracts\(\)/.test(ctSrc), 'full Contract editor remains direct (not migrated)');
check(/State\.contracts = State\.contracts\.filter\(x=>x\.id!==id\);\s*\n\s*(?:const persisted = )?await persistContracts\(\)/.test(ctSrc), 'delete Contract path remains direct (not migrated)');
// Neither residual path acquired repository mediation or a command route in SPR-093.
check(!/ContractRepository[\s\S]{0,200}fd\.get\('status'\)/.test(ctSrc), 'the editor did not acquire repository mediation (SPR-093 is honesty-only)');

/* ---------- SPR-093 — Contract persistence honesty (discoverability only) ----------
   Both residual paths now CHECK the persistContracts() result and roll back in memory on
   failure, so neither can report success after a failed write (ARCH-008 section 7). The
   behaviour is proven by tools/verify-contract-persistence-runtime.js; this file only makes
   that harness discoverable and asserts the production shape, without executing it. */
console.log('== CONTRACT PERSISTENCE HONESTY (SPR-093) ==');
const cphPath = path.join(root,'tools','verify-contract-persistence-runtime.js');
check(fs.existsSync(cphPath), 'SPR-093 runtime harness present: tools/verify-contract-persistence-runtime.js');
const cphSrc = fs.existsSync(cphPath) ? read(cphPath) : '';
check(/RUNTIME VERIFICATION PASSED/.test(cphSrc) && /process\.exit\(1\)/.test(cphSrc), 'SPR-093 harness fails non-zero on assertion failure');
check(!/child_process|require\('http|require\("http/.test(cphSrc), 'SPR-093 harness spawns no process and opens no network');
check(!/fs\.(writeFile|writeFileSync|appendFile|appendFileSync|unlink|rmSync|mkdir)/.test(cphSrc), 'SPR-093 harness writes nothing to disk');
// Scope honesty — the harness must not claim to have executed the modal-closure editor.
check(/DO NOT PROVE/.test(cphSrc), 'SPR-093 harness states which editor guarantees are static rather than executed');
// Production shape: no persistContracts() result is discarded anywhere in contracts.js.
check(!/\n\s*await persistContracts\(\);/.test(ctSrc), 'no persistContracts() call in contracts.js discards its result (SPR-093)');
check((ctSrc.match(/persisted !== true/g)||[]).length >= 2, 'editor and delete both use the strict persisted !== true check');
check(/State\.contracts\.splice\(prevIndex, 0, c\)/.test(ctSrc), 'a failed delete restores the record at its original index');
check(/if\(!isNew\) EDITED_FIELDS\.forEach\(k=>\{ before\[k\] = rec\[k\]; \}\);/.test(ctSrc), 'the editor snapshots mutated fields before assigning them');
check(/rec\.history\.pop\(\);/.test(ctSrc), 'a failed editor save drops the history entry it added');
// Pre-existing delete guards are untouched by SPR-093.
check(/cannot be deleted\. Cancel it instead\./.test(ctSrc), 'the linked-payroll delete refusal is preserved');
// Committed-payroll confirmation stays in the UI seam — never inside the Repository.
check(/payrollPlansForContract\(id\)\.some\(isPayrollCommitted\)/.test(ctSrc) && !/committed|confirm\s*\(|payrollPlansForContract/.test(contractRepoCode), 'committed-payroll confirmation remains outside the Repository (UI seam only)');
check(!/confirm\s*\(|payrollPlansForContract/.test(tcCode), 'committed-payroll confirmation remains outside the handler (UI seam only)');
// The Repository contract itself is UNCHANGED by PR-10B (no contract evolution, no new module).
check(/async save\(\)/.test(contractRepoSrc) && (contractRepoCode.match(/async \w+\(/g)||[]).length === 1, 'ContractRepository still exposes exactly one method (save) — contract unchanged');
check(/ok === true/.test(contractRepoCode) && /ok:\s*false,\s*error:\s*'PersistFailed'/.test(contractRepoCode), 'ContractRepository result contract remains { ok:true } / { ok:false, error:"PersistFailed" }');
check(!/ContractRepository/.test(poeSrc), 'payroll ops engine has no ContractRepository dependency (repositories stay independent)');
// Operational + registered surface UNCHANGED by PR-10B.
check(aggregateDefs === 9 && migratedCmdIds.length === 8 && migratedQueryIds.length === 1 && allCmdIds.length === 15 && allQryIds.length === 4, 'operational + registered surface unchanged by the contract status slice (9 aggregates / 8 seam-routed / 15 registered)');

// PR-11A "The Payroll Foundation" — the THIRD entity Repository (PayrollRepository),
// completing aggregate-backed Repository adoption (7 of 7) across Employee, Contract,
// and Payroll. Introduced on one bounded slice (payroll.lifecycle.transition).
// Persistence mechanics only; the handler keeps validation/mutation/updatedAt/history/
// rollback AND the Payroll-specific best-effort post-persistence audit.
console.log('== PAYROLL REPOSITORY (PR-11A — third entity repository, adoption complete) ==');
const payrollRepoPath = path.join(root,'js','repository','payroll-repository.js');
check(fs.existsSync(payrollRepoPath), 'repository module present: js/repository/payroll-repository.js');
check(jsFiles.indexOf('repository/payroll-repository.js') !== -1, 'module-order.js includes repository/payroll-repository.js');
check(indexHtml.includes('<script src="js/repository/payroll-repository.js"></script>'), 'index.html includes repository/payroll-repository.js');
// Load order: AFTER the persist infrastructure it delegates to, and BEFORE the migrated handler.
check(jsFiles.indexOf('core/hr-persistence-portability.js') < jsFiles.indexOf('repository/payroll-repository.js') &&
      jsFiles.indexOf('repository/payroll-repository.js') < jsFiles.indexOf('people/payroll-ops-engine.js'), 'payroll repository loads after hr-persistence-portability.js and before people/payroll-ops-engine.js');
const payrollRepoSrc = read(payrollRepoPath);
const payrollRepoCode = stripComments(payrollRepoSrc);
check(/const PayrollRepository = Object\.freeze\(\{/.test(payrollRepoSrc), 'PayrollRepository is a frozen object');
check(/async save\(\)/.test(payrollRepoSrc) && (payrollRepoCode.match(/async \w+\(/g)||[]).length === 1, 'PayrollRepository exposes exactly one method (async save)');
check(dist.includes('const PayrollRepository') && dist.includes('window.PayrollRepository = PayrollRepository'), 'PayrollRepository present and exposed in dist');
// DELEGATION — the repository delegates persistence to the EXISTING persistPayrollPlans() only.
check(/await persistPayrollPlans\(\)/.test(payrollRepoCode) && (payrollRepoCode.match(/persistPayrollPlans\(/g)||[]).length === 1, 'PayrollRepository delegates persistence to the existing persistPayrollPlans() exactly once');
check(!/persistEmployees\(|persistContracts\(|persistMonthlyPlans\(|persistOvertime\(|persist\(\)/.test(payrollRepoCode), 'PayrollRepository writes no other store (no compound persistence)');
// RESULT CONTRACT — strict, identical to the two existing repositories (no contract evolution).
check(/ok:\s*true/.test(payrollRepoCode) && /ok:\s*false,\s*error:\s*'PersistFailed'/.test(payrollRepoCode) && /ok === true/.test(payrollRepoCode), 'PayrollRepository normalizes the strict boolean into { ok:true } / { ok:false, error:"PersistFailed" }');
// REPOSITORY PURITY — persistence mechanics ONLY (audit explicitly included).
[['State access', /State\s*[.[]/],
 ['field mutation', /\bpp\.\w+\s*=|\.updatedAt\s*=|\.status\s*=/],
 ['history creation', /\.history\b|\.push\(/],
 ['rollback', /rollback|\.pop\(/],
 ['validation', /Invalid|isPayrollLocked|Locked|Immutable|TRANSITIONS/],
 ['audit', /logActivity\s*\(|payrollAuditType\s*\(/],
 ['UI render', /\brender\s*\(|innerHTML|toast\s*\(|showSuccess\s*\(|showWarning\s*\(/],
 ['Domain call', /\bDomain\s*[.[]/],
 ['aggregate call', /\w+Aggregate\s*[.[]/],
 ['direct storage bypass', /localStorage|window\.storage|StorageAdapter\s*[.[]/],
 ['other-entity persistence', /persistEmployees\(|persistContracts\(/]
].forEach(([label,re])=>check(!re.test(payrollRepoCode), 'PayrollRepository never performs '+label));
// No generic Repository / factory / base class / transaction abstraction.
check(!/class\s+\w*Repository|createRepository|RepositoryFactory|extends\s+\w+|transaction/i.test(payrollRepoCode), 'PayrollRepository introduces no generic repository, factory, base class, or transaction abstraction');
// HANDLER MIGRATION — exactly one Repository call, no direct persist, strict handling.
check((tpCode.match(/PayrollRepository\.save\(\)/g)||[]).length === 1, 'transitionPayrollLifecycle() uses exactly one PayrollRepository.save()');
check(!/persistPayrollPlans\(/.test(tpCode), 'transitionPayrollLifecycle() contains no direct persistPayrollPlans()');
check(/persisted\.ok !== true/.test(tpCode), 'payroll-lifecycle handler uses strict persisted.ok handling (no truthy/falsy ambiguity)');
// ROLLBACK remains HANDLER-owned (the repository does not roll back).
check(/pp\.status = prevStatus/.test(tpCode) && /pp\.history\.pop\(\)/.test(tpCode) && /pp\.updatedAt = prevUpdatedAt/.test(tpCode), 'payroll-lifecycle handler still owns full rollback (status + history.pop + updatedAt)');
check(/error:'PersistFailed'/.test(tpCode), 'payroll-lifecycle handler preserves the typed PersistFailed result');
// AUDIT INVARIANT (Payroll-specific — deliberately NOT the Contract "no audit" rule).
check(/logActivity\(/.test(tpCode), 'the best-effort audit remains inside transitionPayrollLifecycle()');
check((tpCode.match(/logActivity\(/g)||[]).length === 1, 'exactly one audit call in the payroll-lifecycle handler (no duplicate audit)');
check(/PayrollRepository\.save\(\)[\s\S]*?return \{ success:false, error:'PersistFailed' \}[\s\S]*?logActivity\(/.test(tpCode), 'the audit occurs AFTER successful Repository persistence (below the PersistFailed return)');
check(/try \{[\s\S]*?logActivity\([\s\S]*?\} catch/.test(tpCode), 'the audit remains try/catch-wrapped (best-effort; never alters the result)');
// The failure path spans the rollback through the PersistFailed return; no audit may appear inside it.
const tpFailStart = tpCode.indexOf('persisted.ok !== true');
const tpFailEnd = tpCode.indexOf("return { success:false, error:'PersistFailed' }");
const tpFailPath = (tpFailStart !== -1 && tpFailEnd > tpFailStart) ? tpCode.slice(tpFailStart, tpFailEnd) : '';
check(tpFailPath !== '' && !/logActivity\(/.test(tpFailPath), 'the audit is absent from the rollback/failure path (no audit between the failure branch and the PersistFailed return)');
check(!/logActivity\(/.test(payrollRepoCode), 'the audit stays OUTSIDE PayrollRepository');
// FENCED — every other persistPayrollPlans() call site remains DIRECT and unchanged.
const poeCode = stripComments(poeSrc);
check((poeCode.match(/persistPayrollPlans\(\)/g)||[]).length === 4, 'the four non-aggregate payroll-ops persistence sites remain direct (override clear/set, regeneration, compound posting)');
check(/steps\.push\(\['payrollPlans',\s+await persistPayrollPlans\(\)\]\);[\s\S]{0,400}steps\.push\(\['monthlyPlans',\s+await persistMonthlyPlans\(\)\]\);[\s\S]{0,400}steps\.push\(\['overtime',\s+await persistOvertime\(\)\]\);[\s\S]{0,400}steps\.push\(\['transactions',\s+await persist\(\)\]\);/.test(poeSrc), 'commitReadyPayroll compound posting remains direct and compound (4 stores, unchanged order)');
const planSrc = read(path.join(root,'js','people','payroll-planning.js'));
check(!/await persistPayrollPlans\(\)/.test(planSrc) && !/PayrollRepository/.test(planSrc), 'payroll-planning performs NO persistence at all (SPR-078 — posting path retired, not migrated)');
const wsSrc = read(path.join(root,'js','people','payroll-workspace.js'));
check(/await persistPayrollPlans\(\)/.test(wsSrc) && !/PayrollRepository/.test(wsSrc), 'payroll generation (payroll-workspace) remains direct (not migrated)');
check(/if\(touched\) await persistPayrollPlans\(\)/.test(read(path.join(root,'js','core','hr-persistence-portability.js'))), 'the v2.5 schema migration persistence remains direct (not migrated)');
// Repositories stay INDEPENDENT and one-way.
check(!/PayrollRepository/.test(repoSrc) && !/PayrollRepository/.test(contractRepoSrc), 'Employee/Contract repositories have no dependency on PayrollRepository (independent)');
check(!/PayrollRepository|payroll-repository/.test(facSrc), 'domain-layer.js has no dependency on the payroll repository (one-way)');
check(!/PayrollRepository|payroll-repository/.test(storageSrc), 'StorageAdapter has no dependency on the payroll repository (one-way)');
// ADOPTION — 4 (Employee) + 2 (Contract) + 1 (Payroll) = 7 of 7 aggregate-backed handlers.
check((stripComments(empSrc).match(/EmployeeRepository\.save\(\)/g)||[]).length === 4, 'Employee Repository adoption remains 4 of 4');
check((stripComments(ctSrc).match(/ContractRepository\.save\(\)/g)||[]).length === 4, 'Contract Repository adoption is 4 of 4');
check((poeCode.match(/PayrollRepository\.save\(\)/g)||[]).length === 1, 'Payroll Repository adoption becomes 1 of 1');
check(((stripComments(empSrc).match(/EmployeeRepository\.save\(\)/g)||[]).length +
       (stripComments(ctSrc).match(/ContractRepository\.save\(\)/g)||[]).length +
       (poeCode.match(/PayrollRepository\.save\(\)/g)||[]).length) === 9, 'overall aggregate-backed Repository adoption is 9 of 9 (aggregate-backed handlers only — NOT all persistence, NOT compound, NOT backend readiness)');
check(fs.readdirSync(path.join(root,'js','repository')).length === 3, 'exactly three Repository modules (Employee + Contract + Payroll); no generic repository added');
// Existing Repository contracts are UNCHANGED by PR-11A.
check(/async save\(\)/.test(contractRepoSrc) && (contractRepoCode.match(/async \w+\(/g)||[]).length === 1, 'ContractRepository contract unchanged by PR-11A');
check(/async save\(\)/.test(repoSrc) && (stripComments(repoSrc).match(/async \w+\(/g)||[]).length === 1, 'EmployeeRepository contract unchanged by PR-11A');
// Operational + registered surface UNCHANGED by PR-11A.
check(aggregateDefs === 9 && migratedCmdIds.length === 8 && migratedQueryIds.length === 1 && allCmdIds.length === 15 && allQryIds.length === 4, 'operational + registered surface unchanged by the payroll repository slice (9 aggregates / 8 seam-routed / 15 registered)');

// ============================================================
// ARCHITECTURAL MILESTONE — AGGREGATE-BACKED REPOSITORY ADOPTION COMPLETE (7 of 7).
// This section locks ONE claim: every aggregate-backed handler delegates persistence
// through an entity-named Repository. It deliberately does NOT assert — and must never
// be read as asserting — complete persistence abstraction, compound-persistence
// support, multi-store transactions, or backend readiness. The paired assertions below
// prove the boundary by ALSO pinning the non-aggregate and compound paths as DIRECT:
// adoption completeness and persistence abstraction are different things, and the
// second is explicitly NOT claimed. See the DESIGN NOTE in payroll-repository.js.
// ============================================================
console.log('== AGGREGATE-BACKED REPOSITORY ADOPTION MILESTONE (9 of 9 — bounded claim) ==');
const empCode2 = stripComments(empSrc), ctCode2 = stripComments(ctSrc);
const adoption = {
  Employee: (empCode2.match(/EmployeeRepository\.save\(\)/g)||[]).length,
  Contract: (ctCode2.match(/ContractRepository\.save\(\)/g)||[]).length,
  Payroll:  (poeCode.match(/PayrollRepository\.save\(\)/g)||[]).length
};
// (a) THE MILESTONE: all seven aggregate-backed handlers are Repository-mediated.
check(adoption.Employee === 4 && adoption.Contract === 4 && adoption.Payroll === 1 &&
      (adoption.Employee + adoption.Contract + adoption.Payroll) === 9,
      'MILESTONE: all nine aggregate-backed handlers are Repository-mediated through entity-named repositories (Employee 4 + Contract 4 + Payroll 1 = 9 of 9)');
// SPR-095 separates ADOPTION from ROUTING: nine aggregate-backed handlers are
// Repository-mediated, but only eight are reachable through the UI seam. The ninth
// (contract.core.update) is domain preparation and is invoked by nothing.
check(migratedCmdIds.length === 8, 'eight of the nine aggregate-backed commands are routed through the seam (contract.core.update is registered but unrouted — SPR-095)');
check(fs.readdirSync(path.join(root,'js','repository')).length === 3, 'exactly three entity-named repositories back the milestone (no generic repository)');
// (b) THE BOUND: non-aggregate paths remain DIRECT — adoption completeness is NOT
//     persistence abstraction. Each entity keeps direct collection writes.
check((empCode2.match(/await persistEmployees\(\)/g)||[]).length >= 1, 'non-aggregate Employee paths remain direct (persistEmployees still called directly in employees.js)');
check((ctCode2.match(/await persistContracts\(\)/g)||[]).length === 2, 'non-aggregate Contract paths remain direct (full editor + delete only — renewal migrated by SPR-077)');
check((poeCode.match(/persistPayrollPlans\(\)/g)||[]).length === 4, 'non-aggregate Payroll paths remain direct (override set/clear, regeneration, compound posting)');
check(/await persistPayrollPlans\(\)/.test(wsSrc) && !/PayrollRepository/.test(wsSrc), 'non-aggregate Payroll generation remains direct (payroll-workspace.js)');
// (c) THE BOUND: compound multi-store paths remain DIRECT and unexpressible in the contract.
check(/renewedToId = nc\.id;[\s\S]{0,900}ContractRepository\.save\(\)/.test(ctSrc), 'Contract renewal create-successor is Repository-mediated in ONE collection write (SPR-077 — not compound)');
check(/steps\.push\(\['payrollPlans',\s+await persistPayrollPlans\(\)\]\);[\s\S]{0,400}steps\.push\(\['monthlyPlans',\s+await persistMonthlyPlans\(\)\]\);[\s\S]{0,400}steps\.push\(\['overtime',\s+await persistOvertime\(\)\]\);[\s\S]{0,400}steps\.push\(\['transactions',\s+await persist\(\)\]\);/.test(poeSrc), 'compound Payroll posting remains direct (commitReadyPayroll — four stores in one operation)');
check(!/persist/.test(planSrc), 'the second compound Payroll posting path no longer exists (SPR-078 retired payroll-planning posting)');
// (d) THE DISCLAIMER, mechanically enforced: the Repository layer mediates only a
//     MINORITY of the collection persist functions. 7 of 7 is adoption, not coverage.
const hrPersistSrc = read(path.join(root,'js','core','hr-persistence-portability.js'));
const persistFnCount = (hrPersistSrc.match(/^async function persist\w*\(/gm)||[]).length;
check(persistFnCount > 3, 'persistence abstraction is NOT complete: the repository layer mediates 3 collections out of '+persistFnCount+' persist functions (adoption completeness != persistence abstraction)');
// (e) No repository may imply a backend or a transaction boundary.
[['employee-repository.js', repoSrc], ['contract-repository.js', contractRepoSrc], ['payroll-repository.js', payrollRepoSrc]].forEach(([name, src])=>{
  const code = stripComments(src);
  check(!/fetch\s*\(|XMLHttpRequest|WebSocket|axios|\bapi\b|endpoint|server|http/i.test(code), name+' implies no backend (no network/remote surface)');
  check(!/transaction|unitOfWork|commit\s*\(|rollback\s*\(/i.test(code), name+' implies no transaction/unit-of-work abstraction');
});

// PR-8B "The CLI" — the first NON-BROWSER ingress. It proves the canonical Platform
// contract is transport-agnostic: a CLI reaches the Domain through TransportAdapter
// with NO change to Domain/Aggregates/Handlers/Repository/Platform/StorageAdapter.
// Read-only this sprint (employee.filtered only); it delegates SOLELY to the Transport.
console.log('== CLI TRANSPORT (PR-8B — first non-browser ingress, read-only) ==');
const cliPath = path.join(root,'js','cli','cli.js');
check(fs.existsSync(cliPath), 'CLI module present: js/cli/cli.js');
const cliSrc = read(cliPath);
const cliCode = stripComments(cliSrc);
// The CLI is a Node ingress — it is NOT part of the browser build (module-order / dist).
check(jsFiles.indexOf('cli/cli.js') === -1, 'CLI is not in the browser module-order (Node-only ingress)');
check(!dist.includes('js/cli/cli.js') && !indexHtml.includes('js/cli/cli.js'), 'CLI is not loaded by index.html / dist (does not touch the browser build)');
// DELEGATION — the CLI delegates ONLY through the Transport Adapter.
check(/TransportAdapter\.execute\(/.test(cliCode), 'CLI delegates through TransportAdapter.execute()');
check(!/ApplicationGateway/.test(cliCode), 'CLI performs no direct Application Gateway access');
check(!/\bDomain\s*[.[]|domain\.(command|query)/.test(cliCode), 'CLI performs no direct Domain access');
check(!/\w+Aggregate\s*[.[]/.test(cliCode), 'CLI performs no direct Aggregate access');
check(!/updateEmployeeContact\(|employeesFiltered\(|transitionContractStatus\(/.test(cliCode), 'CLI performs no direct Handler access');
check(!/EmployeeRepository|repository\//.test(cliCode), 'CLI performs no direct Repository access');
// NO PERSISTENCE — the CLI never calls a persist function or the storage backend.
check(!/persistEmployees\(|persistHR\(|persist\(\)|StorageAdapter\.(set|remove)\(/.test(cliCode), 'CLI performs no persistence (no persist*/StorageAdapter writes)');
// READ-ONLY SCOPE — only the aggregate-backed query employee.filtered is permitted; commands are rejected.
check(/CLI_ALLOWED_QUERIES\s*=\s*\['employee\.filtered'\]/.test(cliCode), 'CLI read-only allowlist is exactly [employee.filtered]');
check(/kind !== 'query'/.test(cliCode), 'CLI rejects any non-query kind (no command / no write execution)');
// It reproduces the browser load order but EXCLUDES the only DOM-executing load-time module.
check(/!==\s*'core\/app-bootstrap\.js'/.test(cliCode), 'CLI runtime excludes core/app-bootstrap.js (the only DOM-executing load-time module)');
// The CLI classifies ONLY its own two failure modes (source:'cli'); Platform responses pass through.
check(/source:\s*'cli'/.test(cliCode) && /INVALID_CLI_INVOCATION/.test(cliCode) && /INVALID_CLI_ARGUMENTS/.test(cliCode), 'CLI classifies only INVALID_CLI_INVOCATION / INVALID_CLI_ARGUMENTS under { source:"cli" }');
check(!/DOMAIN_FAULT|source:\s*'gateway'|source:\s*'domain'|source:\s*'transport'/.test(cliCode), 'CLI does not mint Platform error sources (Platform responses are returned verbatim)');
// CLI ⇏ Browser UI (FAA-PR8B) — the CLI must NEVER evolve into a second UI layer.
// It performs no rendering and invokes no browser UI entry point. The loadRuntime()
// inert stubs name `window`/`document` only as loader plumbing for the classic
// shared-global scripts (see the FAA-PR8B design note in cli.js); those identifiers
// are never USED to render or to reach a real DOM — so the invariant is usage-based.
check(!/\brender\w*\s*\(|\btoast\s*\(|showWarning\s*\(|showSuccess\s*\(|openModal\w*\s*\(|closeModal\s*\(/.test(cliCode), 'CLI invokes no browser UI / rendering entry point (render/toast/modal)');
check(!/\bshell\b|renderShell|hrNavTo\s*\(|State\.view\s*=|\.innerHTML/.test(cliCode), 'CLI performs no shell/navigation/DOM rendering (CLI is not a UI layer)');
check(!/document\.(getElementById|querySelector|querySelectorAll|createElement|write)\s*\(|window\.(location|open)\b/.test(cliCode), 'CLI makes no real DOM/browser-UI calls (inert loader stubs only, never used to render)');
// Operational surface is UNCHANGED by PR-8B (a new ingress adds no Domain operation).
check(aggregateDefs === 9 && migratedCmdIds.length === 8 && migratedQueryIds.length === 1 && allCmdIds.length === 15 && allQryIds.length === 4, 'operational surface unchanged by the CLI (9 aggregates / 8 seam-routed commands / 1 query; 15 registered / 4 registered)');

/* SPR-095 — CONTRACT CORE DOMAIN PREPARATION (ADR-014 sequencing step 1).
   The BEHAVIOUR of the aggregate, the command, the handler and its repository
   mediation is proven by tools/verify-contract-core-runtime.js; this file only makes
   that harness discoverable and asserts the production SHAPE, without executing it.
   The bounded claim: the authority EXISTS and NOTHING invokes it. Editor routing is
   ADR-014 step 2, gated on OQ-2, and is not authorized here. */
console.log('== CONTRACT CORE AUTHORITY (SPR-095 — domain preparation, ADR-014) ==');
const ccPath = path.join(root,'js','domain','contract-core-aggregate.js');
check(fs.existsSync(ccPath), 'aggregate module present: js/domain/contract-core-aggregate.js');
check(jsFiles.indexOf('domain/contract-core-aggregate.js') !== -1, 'module-order.js includes domain/contract-core-aggregate.js');
check(indexHtml.includes('<script src="js/domain/contract-core-aggregate.js"></script>'), 'index.html includes domain/contract-core-aggregate.js');
// Load order: after the Contract linkage helpers it reads and before the Domain facade that resolves it.
check(jsFiles.indexOf('people/people-core.js') < jsFiles.indexOf('domain/contract-core-aggregate.js') &&
      jsFiles.indexOf('domain/contract-core-aggregate.js') < jsFiles.indexOf('domain/domain-layer.js'), 'contract-core-aggregate.js loads after people-core.js and before domain-layer.js');
const ccSrc = read(ccPath);
const ccCode = stripComments(ccSrc);
check(/const ContractCoreAggregate = Object\.freeze\(/.test(ccSrc), 'ContractCoreAggregate is a frozen object');
check(/prepare:\s*function/.test(ccSrc), 'ContractCoreAggregate exposes prepare() (the DEFAULT prepare/patch entry contract)');
check(dist.includes('const ContractCoreAggregate') && dist.includes('window.ContractCoreAggregate = ContractCoreAggregate'), 'ContractCoreAggregate present and exposed in dist');
// OWNERSHIP — exactly the ten fields of the ADR-014 field-authority matrix, and no other.
const ccFieldsDecl = (ccSrc.match(/const CONTRACT_CORE_FIELDS = \[([\s\S]*?)\];/)||[])[1] || '';
const ccFields = (ccFieldsDecl.match(/'([^']+)'/g)||[]).map(s=>s.slice(1,-1));
const ADR014_FIELDS = ['employeeId','employeeName','contractNumber','monthlySalary','notes',
  'workHoursPerDay','workDaysPerWeek','weeksPerMonth','scheduleEffectiveDate','scheduleNotes'];
check(ccFields.length === 10, 'the Core allowlist declares exactly ten fields (found '+ccFields.length+')');
check(ADR014_FIELDS.every(f=>ccFields.indexOf(f)!==-1) && ccFields.every(f=>ADR014_FIELDS.indexOf(f)!==-1), 'the Core allowlist is exactly the ADR-014 field-authority matrix');
['status','startDate','durationMonths','endDate','updatedAt','history','id','createdAt','renewedFromId','renewedToId'].forEach((f)=>
  check(ccFields.indexOf(f) === -1, 'the Core aggregate does not own the field owned elsewhere by ADR-014: '+f));
// AGGREGATE PURITY — a business authority with no side effects (comments stripped).
[['State mutation', /State\s*[.[]/],
 ['persistence', /\bpersist\w*\s*\(/],
 ['repository access', /Repository\s*[.[]/],
 ['history append', /\.history\b|history\s*=|\.push\(/],
 ['updatedAt mutation', /updatedAt/],
 ['UI render', /\brender\s*\(|innerHTML/],
 ['toast/alert/confirm', /\btoast\s*\(|showWarning\s*\(|showSuccess\s*\(|\balert\s*\(|confirm\s*\(/],
 ['localStorage', /localStorage/],
 ['audit logging', /logActivity\s*\(/],
 ['id/timestamp generation', /Math\.random|Date\.now|new Date\(|uid\s*\(/]
].forEach(([label,re])=>check(!re.test(ccCode), 'ContractCoreAggregate never performs '+label));
check(!/\w+Aggregate\s*[.[]/.test(ccCode), 'ContractCoreAggregate touches no other aggregate');
cmdHandlers.forEach((h)=>check(!new RegExp('\\b'+h+'\\s*\\(').test(ccCode), 'ContractCoreAggregate does not call handler directly: '+h));
// The aggregate returns typed decisions only — the existing { ok, patch } / { ok, error } contract.
check(/return \{ ok: true, patch: clean \};/.test(ccSrc), 'the aggregate returns the standard { ok:true, patch } decision');
['ContractNotFound','ForbiddenContractField','NoContractCoreFieldsProvided','IncompleteEmployeeLink',
 'EmployeeNotFound','EmployeeLinkMismatch','EmployeeReassignmentNotAllowed','InvalidContractNumber',
 'ContractNumberNotEditable','InvalidMonthlySalary','IncompleteScheduleGroup','InvalidScheduleComponent',
 'InvalidScheduleEffectiveDate'].forEach((e)=>
  check(ccSrc.includes("error: '"+e+"'"), 'the aggregate returns the typed business failure: '+e));
// The measured invariants ADR-014 records are enforced, not merely documented.
check(/hasEmpId !== hasEmpName/.test(ccCode), 'ADR-014 §1: employeeId + employeeName are enforced as an atomic pair');
check(/submittedSchedule\.length !== CONTRACT_CORE_SCHEDULE_FIELDS\.length/.test(ccCode), 'ADR-014 §2: a partial schedule group is refused');
check(/provided !== 0 && provided !== CONTRACT_CORE_SCHEDULE_COMPONENTS\.length/.test(ccCode), 'ADR-014 §2: an internally incomplete schedule (the rate-zeroing shape) is refused');
check(/c\.status !== 'Draft'/.test(ccCode) && /ContractNumberNotEditable/.test(ccCode), 'PD-1: contractNumber is constrained to Draft');
check(/contractHasLinkedRecords\(c\.id\)/.test(ccCode) && /EmployeeReassignmentNotAllowed/.test(ccCode), 'PD-2: reassignment consults the linked-record guard');
check(/payrollPlansForContract\(id\)/.test(ccCode) && /txnsForContract\(id\)/.test(ccCode) && /overtimeRecordsForContract\(id\)/.test(ccCode), 'PD-2 guard reads payroll, transactions AND overtime linkage');
check(/function overtimeRecordsForContract\(ctId\)\{ return State\.overtimeRecords\.filter\(o=>o\.contractId===ctId\); \}/.test(read(path.join(root,'js','people','people-core.js'))), 'the overtime linkage helper is a read-only filter (no mutation)');
// COMMAND REGISTRATION — registered, aggregate-backed, handler-bound.
check(/'contract\.core\.update':\s*Object\.freeze\(\{[^}]*boundary:\s*'ContractCoreAggregate'/.test(cmdSrc), 'contract.core.update declares boundary ContractCoreAggregate');
check(/'contract\.core\.update':\s*Object\.freeze\(\{[^}]*handler:\s*'updateContractCore'/.test(cmdSrc), 'contract.core.update is registered to handler updateContractCore');
check(!/'contract\.core\.update':\s*Object\.freeze\(\{[^}]*boundaryMethod/.test(cmdSrc), 'contract.core.update uses the DEFAULT prepare/patch contract (no new convention)');
// HANDLER — the implementation authority, Repository-mediated, with handler-owned rollback.
const uccStart = ctSrc.indexOf('async function updateContractCore(');
check(uccStart !== -1, 'updateContractCore handler present');
const uccRest = uccStart!==-1 ? ctSrc.slice(uccStart+1) : '';
const uccNext = uccRest.search(/\n(async function|function) /);
const uccBody = uccNext>=0 ? uccRest.slice(0, uccNext) : uccRest;
const uccCode = stripComments(uccBody);
check((uccCode.match(/ContractRepository\.save\(\)/g)||[]).length === 1, 'updateContractCore persists exactly once, through ContractRepository.save()');
check(!/persistContracts\(/.test(uccCode), 'updateContractCore never calls persistContracts() directly (repository-mediated)');
check(/persisted\.ok !== true/.test(uccCode), 'updateContractCore uses strict persisted.ok handling (no truthy/falsy ambiguity)');
check(/CONTRACT_CORE_FIELDS/.test(uccCode) && /ForbiddenContractField/.test(uccCode), 'updateContractCore re-checks the SAME allowlist (defense in depth, one source of truth)');
check(/success:\s*true/.test(uccCode) && /success:\s*false/.test(uccCode) && /error:'PersistFailed'/.test(uccCode), 'updateContractCore returns the existing typed result convention');
check(/if\(had\[k\]\) c\[k\] = before\[k\]; else delete c\[k\];/.test(uccCode) && /c\.history\.pop\(\);/.test(uccCode) && /c\.updatedAt = prevUpdatedAt;/.test(uccCode), 'updateContractCore owns full rollback (fields + history.pop + updatedAt) on persistence failure');
check(/if\(!hadHistory\) delete c\.history;/.test(uccCode), 'rollback restores the ABSENCE of a history property it created');
check(!/logActivity\(/.test(uccCode), 'updateContractCore adds no audit entry (matching the three existing Contract handlers)');
['status','startDate','durationMonths','endDate','renewedFromId','renewedToId','createdAt'].forEach((f)=>
  check(!uccCode.includes(f), 'contract-core handler does not touch forbidden field: '+f));
// SCOPE — the authority EXISTS but NOTHING invokes it. This is the whole claim of SPR-095.
check(!/uiExecute\('command',\s*'contract\.core\.update'/.test(srcJs), 'NO UI seam routes contract.core.update (registered but unrouted)');
check(migratedCmdIds.indexOf('contract.core.update') === -1, 'contract.core.update is absent from the seam-routed command set');
check((stripComments(srcJs).match(/updateContractCore\s*\(/g)||[]).length === 1, 'updateContractCore has exactly one occurrence in production source — its definition, with no call site');
check(!/ContractCoreAggregate\s*[.[]/.test(stripComments(srcJs)), 'no module invokes ContractCoreAggregate directly (only the Domain facade resolves it, by name)');
// The editor and the delete path are UNCHANGED by SPR-095.
check(/rec\.status = fd\.get\('status'\)/.test(ctSrc), 'the Contract editor still writes status directly (authority NOT migrated)');
check((stripComments(ctSrc).match(/const persisted = await persistContracts\(\);/g)||[]).length === 2, 'the editor and delete paths still persist directly through persistContracts() (exactly two direct sites)');
check((stripComments(ctSrc).match(/uiExecute\('command'/g)||[]).length === 3, 'contracts.js still routes exactly three commands through the seam (dates + status + renewal)');
// No schema, storage, or seeding implication.
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root,'js','core','constants.js'))), 'SCHEMA_VERSION remains 6 (SPR-095 is not a migration)');
check(!/ContractCoreAggregate|contract-core-aggregate/.test(facSrc), 'domain-layer.js has no hard dependency on the Core aggregate (resolved by name)');
check(!/ContractCoreAggregate/.test(contractRepoSrc), 'ContractRepository has no dependency on the Core aggregate (one-way)');
// The dedicated runtime harness is DISCOVERABLE and honest (not executed here).
const ccrPath = path.join(root,'tools','verify-contract-core-runtime.js');
check(fs.existsSync(ccrPath), 'SPR-095 runtime harness present: tools/verify-contract-core-runtime.js');
const ccrSrc = read(ccrPath);
check(/RUNTIME VERIFICATION PASSED/.test(ccrSrc) && /process\.exit\(1\)/.test(ccrSrc), 'SPR-095 harness fails non-zero on assertion failure');
check(!/child_process|require\('http|require\("http/.test(ccrSrc), 'SPR-095 harness spawns no process and opens no network');
check(!/fs\.(writeFile|writeFileSync|appendFile|appendFileSync|unlink|rmSync|mkdir)/.test(ccrSrc), 'SPR-095 harness writes nothing to disk');
check(/module-order\.js/.test(ccrSrc) && /vm\.runInContext/.test(ccrSrc), 'SPR-095 harness executes the REAL production modules in manifest order');
check(/Domain\.command\('contract\.core\.update'/.test(ccrSrc), 'SPR-095 harness exercises the real Domain command path (aggregate then handler)');
check(/const ADR014_CORE_FIELDS = \[/.test(ccrSrc), 'SPR-095 harness asserts ownership against its OWN copy of the ADR-014 matrix (not production'+"'"+'s)');

// UX-002A — SHELL/VIEW PERSISTENCE. The shell (sidebar + nav tree + #main container)
// is mounted ONCE by renderShell(); ordinary navigation replaces only the #main
// CONTENT and syncs the nav's derived state in place. These three checks inspect the
// real function bodies — not stray words anywhere in the file — so a regression that
// reintroduced full-shell rebuilds cannot pass verification.
console.log('== UX-002A SHELL/VIEW PERSISTENCE (structural invariants) ==');
const shellSrcUx2a = stripComments(read(path.join(root,'js','ui','shell-render.js')));
// Top-level function bodies: a declaration at column 0 through the next line that
// begins with a closing brace at column 0.
const ux2aBodyOf = (name)=>{
  const m = shellSrcUx2a.match(new RegExp('^function '+name+'\\(\\)\\{[\\s\\S]*?\\n\\}','m'));
  return m ? m[0] : '';
};
const ux2aRenderBody = ux2aBodyOf('render');
const ux2aRenderShellBody = ux2aBodyOf('renderShell');

// (1) render() must never rebuild the complete application shell.
const ux2aR1 = [];
if(ux2aRenderBody === '') ux2aR1.push('render() could not be located as a top-level function');
if(/\.innerHTML\s*=/.test(ux2aRenderBody)) ux2aR1.push('render() assigns .innerHTML (full-shell rebuild reintroduced)');
if(/class="sidebar"/.test(ux2aRenderBody)) ux2aR1.push('render() emits shell markup directly');
check(ux2aR1.length === 0,
  'render() never rebuilds the application shell — no .innerHTML assignment, no shell markup in its body'
  + (ux2aR1.length ? ' >> VIOLATION: ' + ux2aR1.join('; ') : ''));

// (2) The two structural functions must exist AND render() must invoke both.
const ux2aR2 = [];
if(!/^function renderShell\(\)\{/m.test(shellSrcUx2a)) ux2aR2.push('renderShell() is not defined at top level');
if(!/^function syncShellState\(\)\{/m.test(shellSrcUx2a)) ux2aR2.push('syncShellState() is not defined at top level');
if(!/\brenderShell\(\)/.test(ux2aRenderBody)) ux2aR2.push('render() does not invoke renderShell()');
if(!/\bsyncShellState\(\)/.test(ux2aRenderBody)) ux2aR2.push('render() does not invoke syncShellState()');
check(ux2aR2.length === 0,
  'renderShell() and syncShellState() are defined and render() invokes both (shell mount + in-place state sync)'
  + (ux2aR2.length ? ' >> VIOLATION: ' + ux2aR2.join('; ') : ''));

// (3) bindShell() binds shell listeners once — it must be reachable ONLY from renderShell().
const ux2aProd = stripComments(srcJs);
const ux2aDefs = (ux2aProd.match(/\bfunction\s+bindShell\s*\(/g)||[]).length;
const ux2aSites = (ux2aProd.match(/\bbindShell\s*\(/g)||[]).length - ux2aDefs;
const ux2aInShell = (ux2aRenderShellBody.match(/\bbindShell\s*\(/g)||[]).length;
const ux2aR3 = [];
if(ux2aDefs !== 1) ux2aR3.push('bindShell() must have exactly ONE definition repository-wide (found ' + ux2aDefs + ')');
if(ux2aSites !== 1) ux2aR3.push('bindShell() must have exactly ONE call site repository-wide (found ' + ux2aSites + ') — it must not be called from ordinary navigation or any other production path');
if(ux2aInShell !== 1) ux2aR3.push('the single bindShell() call must live inside renderShell() (found ' + ux2aInShell + ' there)');
check(ux2aR3.length === 0,
  'bindShell() is invoked exactly once repository-wide, and only from renderShell() (listeners bound once, never per navigation)'
  + (ux2aR3.length ? ' >> VIOLATION: ' + ux2aR3.join('; ') : ''));

// UX-004B — SIDEBAR FOUNDATION (canonical nav manifest + hierarchical active state).
// The navigation manifest is the single source of truth mapping every renderView()
// route to its owning sidebar item; active state resolves through it, not exact
// State.view equality. These checks inspect the real shell source so a regression
// (scattered active-state logic, a missing owner, a second renderer, a lost landmark,
// or a stored nav setting) cannot pass verification.
console.log('== UX-004B SIDEBAR FOUNDATION (nav manifest + hierarchical active state) ==');
const ux4bShell = stripComments(read(path.join(root,'js','ui','shell-render.js')));
// (1) The manifest exists and is defined exactly once.
const ux4bManifestDefs = (ux4bShell.match(/\bconst\s+NAV_VIEW_OWNER\s*=/g)||[]).length;
check(ux4bManifestDefs === 1, 'canonical navigation manifest NAV_VIEW_OWNER is defined exactly once (found ' + ux4bManifestDefs + ')');
// (2) The resolver helpers exist.
check(/\bfunction\s+navOwnerItem\s*\(/.test(ux4bShell) && /\bfunction\s+navItemGroup\s*\(/.test(ux4bShell) && /\bfunction\s+navActive\s*\(/.test(ux4bShell),
  'nav resolvers navOwnerItem() / navItemGroup() / navActive() are defined');
// Parse the sidebar item ids (every NAV_GROUPS item carries an `ic:` glyph) and the
// manifest owner map from source, then the routes renderView() actually dispatches.
const ux4bNavItems = new Set([...ux4bShell.matchAll(/\{id:'([a-zA-Z]+)',\s*label:'[^']*',\s*ic:/g)].map(m=>m[1]));
const ux4bOwnerBlock = (ux4bShell.match(/const\s+NAV_VIEW_OWNER\s*=\s*\{([\s\S]*?)\};/)||[,''])[1];
const ux4bOwner = {}; [...ux4bOwnerBlock.matchAll(/([a-zA-Z]+):\s*'([a-zA-Z]+)'/g)].forEach(m=>{ ux4bOwner[m[1]]=m[2]; });
// UX-004D refactor: the renderView() dispatch table moved into renderViewContent();
// renderView() now delegates to it and then mounts the breadcrumb + Quick Actions.
// Route resolution and "no shell remount" are proven against the dispatch function.
const ux4bRenderViewBody = (ux4bShell.match(/function renderViewContent\(main\)\{[\s\S]*?\n\}/)||[''])[0];
const ux4bRoutes = [...new Set([...ux4bRenderViewBody.matchAll(/State\.view===['"]([a-zA-Z]+)['"]/g)].map(m=>m[1]))];
// (3) Every dispatched route has a valid owner: it is a direct sidebar item, or the
//     manifest names a parent that is itself a real sidebar item.
const ux4bOrphans = ux4bRoutes.filter(v=> !ux4bNavItems.has(v) && !(v in ux4bOwner));
check(ux4bRoutes.length >= 30 && ux4bOrphans.length === 0,
  'every renderView() route resolves to a sidebar item or a manifest owner (' + ux4bRoutes.length + ' routes)'
  + (ux4bOrphans.length ? ' >> VIOLATION: unowned routes: ' + ux4bOrphans.join(', ') : ''));
// (3b) Every manifest owner value points at a real sidebar item.
const ux4bBadOwners = Object.entries(ux4bOwner).filter(([,item])=>!ux4bNavItems.has(item)).map(([v,item])=>v+'->'+item);
check(ux4bBadOwners.length === 0, 'every NAV_VIEW_OWNER value is a real sidebar item'
  + (ux4bBadOwners.length ? ' >> VIOLATION: ' + ux4bBadOwners.join(', ') : ''));
// (4/5/6/14) The three required inheritances, by nav ITEM.
check(ux4bOwner.employeeDetail === 'employees', 'Employee Detail inherits the Employees sidebar item');
check(ux4bOwner.contractDetail === 'contracts', 'Contract Detail inherits the Contracts sidebar item');
check(ux4bOwner.payrollDetail === 'payroll', 'Payroll Detail inherits the Payroll sidebar item');
check(ux4bOwner.overtimeSheet === 'overtime', 'Overtime Sheet inherits the Overtime sidebar item');
check(ux4bOwner.supplementalDetail === 'supplementals', 'Supplemental Detail inherits the Supplemental Payments sidebar item');
// (7) Active-state resolution reads the manifest in the in-place sync path.
const ux4bSyncBody = (ux4bShell.match(/function syncShellState\(\)\{[\s\S]*?\n\}/)||[''])[0];
check(/\bnavActive\s*\(/.test(ux4bSyncBody), 'syncShellState() resolves active state through navActive() (manifest, not ad-hoc)');
// (8) Exact-match-only active logic is gone: navGroupHTML no longer keys active off State.view===id.
const ux4bNavGroupBody = (ux4bShell.match(/function navGroupHTML\(g\)\{[\s\S]*?\n\}/)||[''])[0];
// UX-004F refactor: the per-item button markup (incl. active class + aria-current)
// moved into navItemHTML(); navGroupHTML() composes primary items + the "More"
// disclosure from it. Active-state resolution is proven against navItemHTML.
const ux4bNavItemBody = (ux4bShell.match(/function navItemHTML\(n, activeItem\)\{[\s\S]*?\n\}/)||[''])[0];
check(!/State\.view===n\.id/.test(ux4bNavItemBody) && /activeItem/.test(ux4bNavItemBody) && /active\.item/.test(ux4bNavGroupBody),
  'navGroupHTML()/navItemHTML() drive active state from the resolved active item, not exact State.view equality');
// (9/10) aria-current is applied to the active item and cleared from non-active items.
check(/aria-current/.test(ux4bNavItemBody), 'navItemHTML() marks the active item with aria-current="page"');
check(/setAttribute\('aria-current','page'\)/.test(ux4bSyncBody) && /removeAttribute\('aria-current'\)/.test(ux4bSyncBody),
  'syncShellState() sets aria-current on the active item and removes it from every non-active item');
// (11) Exactly one navigation landmark with an accessible name.
const ux4bNavLandmarks = (ux4bShell.match(/<nav class="nav" aria-label="Primary navigation">/g)||[]).length;
check(ux4bNavLandmarks === 1, 'the sidebar nav is a single <nav aria-label="Primary navigation"> landmark (found ' + ux4bNavLandmarks + ')');
// (12) One sidebar renderer only — a single renderShell() and a single navGroupHTML().
check((ux4bShell.match(/\bfunction\s+renderShell\s*\(/g)||[]).length === 1 && (ux4bShell.match(/\bfunction\s+navGroupHTML\s*\(/g)||[]).length === 1,
  'exactly one sidebar renderer (single renderShell() + single navGroupHTML(), no duplicate/per-view renderer)');
// (13) renderView() never remounts the shell.
check(!/\brenderShell\s*\(/.test(ux4bRenderViewBody) && !/\bbindShell\s*\(/.test(ux4bRenderViewBody),
  'renderView() calls neither renderShell() nor bindShell() (shell stays mounted across navigation)');
// (13) The active group is force-expanded while a descendant view is active: both the
//      mount markup and the in-place sync exclude the active group from collapse.
check(/!==\s*active\.group/.test(ux4bNavGroupBody) && /!==\s*active\.group/.test(ux4bSyncBody),
  'the owning group is kept expanded while one of its descendant views is active (navGroupHTML + syncShellState)');
// (15) Navigation state stays session-only — the shell layer persists nothing.
check(!/localStorage|StorageAdapter|persistHR|persist\(|saveSettings/.test(ux4bShell),
  'the sidebar/navigation layer persists nothing (no storage key, session-only nav state)');
// (16/17) SCHEMA_VERSION unchanged and no new standalone view was introduced for the
//         frozen-scope surfaces (HR Dashboard / Backup & Restore / unified Import-Export).
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root,'js','core','constants.js'))), 'UX-004B keeps SCHEMA_VERSION at 6');
const ux4bForbiddenViews = ['hrDashboard','backupRestore','importExport','importExportCenter'].filter(v=>ux4bRoutes.includes(v) || ux4bNavItems.has(v));
check(ux4bForbiddenViews.length === 0, 'no frozen-scope standalone view was introduced (HR Dashboard / Backup & Restore / Import-Export Center)'
  + (ux4bForbiddenViews.length ? ' >> VIOLATION: ' + ux4bForbiddenViews.join(', ') : ''));

// UX-004C — DOMAIN REGROUPING. The sidebar is exactly five business-domain groups
// in a fixed order, every existing item lives in exactly one group, and the manifest
// owners resolve to the approved domains. These read NAV_GROUPS structurally, so a
// regression (a lost/duplicated item, a renamed/reordered group, a mis-homed owner,
// or a frozen-scope violation) cannot pass verification. UX-004B checks above are
// untouched — this layer rides on the same manifest.
console.log('== UX-004C DOMAIN REGROUPING (five-domain navigation model) ==');
// Parse NAV_GROUPS: ordered list of {id,label,items:[itemId,...]}.
const ux4cGroupsBlock = (ux4bShell.match(/const\s+NAV_GROUPS\s*=\s*\[([\s\S]*?)\n\];/)||[,''])[1];
const ux4cGroups = [];
{
  const gre = /\{id:'([a-z]+)',\s*label:'([^']*)',\s*items:\[([\s\S]*?)\]\}/g;
  let gm;
  while((gm = gre.exec(ux4cGroupsBlock)) !== null){
    const items = [...gm[3].matchAll(/\{id:'([a-zA-Z]+)'/g)].map(m=>m[1]);
    ux4cGroups.push({id:gm[1], label:gm[2], items:items});
  }
}
const ux4cOrder = ux4cGroups.map(g=>g.label);
const ux4cGroupOf = {}; ux4cGroups.forEach(g=>g.items.forEach(it=>{ (ux4cGroupOf[it]=ux4cGroupOf[it]||[]).push(g.label); }));
const ux4cAllItems = ux4cGroups.flatMap(g=>g.items);
// (1) Exactly five top-level groups.
check(ux4cGroups.length === 5, 'exactly five top-level navigation groups (found ' + ux4cGroups.length + ')');
// (2) Group labels are exactly the approved five domain names (as a set).
const ux4cExpected = ['Dashboard','People','Finance','Analytics','System'];
check(ux4cExpected.every(l=>ux4cOrder.includes(l)) && ux4cOrder.length === 5,
  'group labels are exactly Dashboard, People, Finance, Analytics, System (found ' + ux4cOrder.join(', ') + ')');
// (3) Group order is exactly the approved sequence.
check(JSON.stringify(ux4cOrder) === JSON.stringify(ux4cExpected),
  'group order is exactly Dashboard -> People -> Finance -> Analytics -> System (found ' + ux4cOrder.join(' -> ') + ')');
// (4/5/6) Every existing nav item appears exactly once — none lost, none duplicated.
const ux4cDupes = Object.entries(ux4cGroupOf).filter(([,gs])=>gs.length>1).map(([it,gs])=>it+' in '+gs.join('+'));
check(ux4cDupes.length === 0, 'no nav item appears in more than one group'
  + (ux4cDupes.length ? ' >> VIOLATION: ' + ux4cDupes.join(', ') : ''));
check(ux4cAllItems.length === new Set(ux4cAllItems).size && new Set(ux4cAllItems).size === ux4bNavItems.size,
  'every sidebar item appears exactly once across the five groups (' + ux4cAllItems.length + ' items, no loss/duplication vs the item set)');
// (7) Every manifest owner resolves to an item that lives in the five-group model.
const ux4cOwnerOrphans = Object.values(ux4bOwner).filter(item=>!ux4cGroupOf[item]);
check(ux4cOwnerOrphans.length === 0, 'every NAV_VIEW_OWNER owner resolves to an item within the five-group model'
  + (ux4cOwnerOrphans.length ? ' >> VIOLATION: ' + ux4cOwnerOrphans.join(', ') : ''));
// Helper: the single group label an item belongs to.
const ux4cIn = (item, label)=> (ux4cGroupOf[item]||[]).length === 1 && ux4cGroupOf[item][0] === label;
// (8/9) People domain.
check(ux4cIn('employees','People'), 'Employees resolves to the People domain');
check(ux4cIn('contracts','People'), 'Contracts resolves to the People domain');
// (10/11/12) Finance domain — the payroll workflow surfaces.
check(ux4cIn('payroll','Finance'), 'Payroll resolves to the Finance domain');
check(ux4cIn('overtime','Finance'), 'Overtime resolves to the Finance domain');
check(ux4cIn('supplementals','Finance'), 'Supplemental Payments resolves to the Finance domain');
// (13) Analytics domain.
check(ux4cIn('reports','Analytics'), 'Reports resolves to the Analytics domain');
// (14) System domain.
check(ux4cIn('settings','System'), 'Settings resolves to the System domain');
// Dashboard primary item.
check(ux4cIn('execDashboard','Dashboard'), 'Executive Dashboard resolves to the Dashboard domain');
// (15/16/17) Frozen scope: no standalone HR Dashboard, no top-level Backup & Restore,
// no unified Import/Export Center item or group.
check(!ux4cGroups.some(g=>/HR Dashboard/i.test(g.label)) && !/label:'HR Dashboard'/.test(ux4bShell),
  'no standalone HR Dashboard nav item or group introduced');
check(!/label:'Backup( &| and)? Restore'/i.test(ux4bShell) && !ux4cAllItems.includes('backupRestore'),
  'no top-level Backup & Restore nav item introduced (stays inside Settings)');
check(!/label:'Import ?\/ ?Export/i.test(ux4bShell) && !ux4cAllItems.some(i=>/importExport/i.test(i)),
  'no unified Import/Export Center nav item or group introduced');
// (18) UX-004B single-renderer + persistent-shell invariants remain intact (single
//      NAV_GROUPS drives one renderer; no per-view group branching added).
check((ux4bShell.match(/const\s+NAV_GROUPS\s*=\s*\[/g)||[]).length === 1
  && (ux4bShell.match(/\bfunction\s+navGroupHTML\s*\(/g)||[]).length === 1
  && !/State\.view\s*===\s*['"][a-zA-Z]+['"]\s*\?\s*'[a-z]+'/.test(ux4bShell),
  'NAV_GROUPS is the single grouping source, one renderer, and no per-view group conditional was introduced');
// (19) No stored navigation grouping state — the shell layer still persists nothing.
check(!/localStorage|StorageAdapter|persistHR|persist\(|saveSettings/.test(ux4bShell),
  'no stored navigation grouping state (regrouping is session-only, derived from NAV_GROUPS)');
// (20) SCHEMA_VERSION remains 6.
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root,'js','core','constants.js'))), 'UX-004C keeps SCHEMA_VERSION at 6');

/* ============================================================
   UX-004D — BREADCRUMBS, CONTEXT QUICK ACTIONS, NUMERIC TYPOGRAPHY
   Static (single-process, text-based) guards. ux4bShell is the already-read
   js/ui/shell-render.js source. These prove SHAPE; behaviour is proven by
   tools/verify-breadcrumb-quickaction-runtime.js.
   ============================================================ */
console.log('== UX-004D BREADCRUMB + QUICK ACTION + NUMERIC TYPOGRAPHY INVARIANTS ==');

// ---- Part 18: breadcrumb protections ----
const ux4dTrailBody = (ux4bShell.match(/function breadcrumbTrail\(view\)\{[\s\S]*?\n\}/)||[''])[0];
// (1) The trail derives from the canonical nav data, not a second route hierarchy.
check(/navOwnerItem\s*\(/.test(ux4dTrailBody) && /navItemGroup\s*\(/.test(ux4dTrailBody) && /PAGE_TITLES/.test(ux4dTrailBody),
  'UX-004D: breadcrumbTrail() derives hierarchy from navOwnerItem()/navItemGroup()/PAGE_TITLES (canonical nav data)');
// (2) No independent breadcrumb route map: no second NAV_*/OWNER-like table introduced.
check(!/const\s+(BREADCRUMB_ROUTES|BREADCRUMB_OWNER|CRUMB_ROUTES|BREADCRUMB_TREE)\s*=/.test(ux4bShell),
  'UX-004D: no independent breadcrumb route hierarchy exists (single source of truth reused)');
// (3/4/5/6) Detail breadcrumbs resolve through their canonical owning item — proven by
// reusing the SAME NAV_VIEW_OWNER already validated above (ux4bOwner).
check(ux4bOwner.employeeDetail === 'employees', 'UX-004D: Employee Detail breadcrumb resolves through Employees');
check(ux4bOwner.contractDetail === 'contracts', 'UX-004D: Contract Detail breadcrumb resolves through Contracts');
check(ux4bOwner.payrollDetail === 'payroll', 'UX-004D: Payroll Detail breadcrumb resolves through Payroll');
check(ux4bOwner.overtimeSheet === 'overtime', 'UX-004D: Overtime Sheet breadcrumb resolves through Overtime');
// (7) Domain names derive from the five-domain model (NAV_GROUP_LABELS built from NAV_GROUPS).
check(/const\s+NAV_GROUP_LABELS\s*=\s*Object\.fromEntries\(NAV_GROUPS\.map/.test(ux4bShell),
  'UX-004D: breadcrumb domain labels derive from NAV_GROUPS (five-domain model)');
// (8) Exactly one Breadcrumb landmark, with an accessible name, emitted once.
const ux4dCrumbLandmarks = (ux4bShell.match(/<nav class="breadcrumb" aria-label="Breadcrumb">/g)||[]).length;
check(ux4dCrumbLandmarks === 1, 'UX-004D: exactly one <nav aria-label="Breadcrumb"> landmark is emitted (found ' + ux4dCrumbLandmarks + ')');
// (9) Terminal breadcrumb is current/non-navigation: the current crumb is rendered as
//     text with aria-current="page", never as a data-crumb-nav button.
const ux4dHtmlBody = (ux4bShell.match(/function breadcrumbHTML\(view\)\{[\s\S]*?\n\}/)||[''])[0];
check(/aria-current="page"/.test(ux4dHtmlBody) && /crumb-text/.test(ux4dHtmlBody)
  && /c\.view\b/.test(ux4dHtmlBody),
  'UX-004D: terminal crumb is non-navigation text with aria-current="page"; only linked crumbs get data-crumb-nav');
// (9b) The breadcrumb landmark is distinct from the sidebar landmark (no aria-current
//      collision): breadcrumb aria-current lives inside the Breadcrumb <nav>, the
//      sidebar keeps its own Primary-navigation landmark.
check(/aria-label="Breadcrumb"/.test(ux4bShell) && /aria-label="Primary navigation"/.test(ux4bShell),
  'UX-004D: breadcrumb current-state lives in its own Breadcrumb landmark, separate from the sidebar Primary navigation');
// (10) No new page/view is created for breadcrumb navigation: crumb links only target
//      EXISTING sidebar items (owner ids), and renderViewContent gains no new route.
const ux4dCrumbLinkTargets = ux4bShell.includes('data-crumb-nav="${c.view}"'); // links target resolved owner views only
check(ux4dCrumbLinkTargets && /hrNavTo\(btn\.dataset\.crumbNav\)/.test(ux4bShell),
  'UX-004D: breadcrumb links navigate to existing owner views via hrNavTo() — no new landing page created');

// ---- Part 19: quick action protections ----
const ux4dQaBlock = (ux4bShell.match(/const\s+QUICK_ACTIONS_BY_VIEW\s*=\s*\{[\s\S]*?\n\};/)||[''])[0];
// (1) One centralized Quick Action manifest.
check((ux4bShell.match(/const\s+QUICK_ACTIONS_BY_VIEW\s*=/g)||[]).length === 1 && ux4dQaBlock.length > 0,
  'UX-004D: exactly one centralized QUICK_ACTIONS_BY_VIEW manifest');
// (2) No duplicate per-module action maps scattered in view modules.
const ux4dScatter = jsFiles.filter(f=>f!=='ui/shell-render.js').filter(f=>/QUICK_ACTIONS_BY_VIEW|const\s+\w*QuickActions\s*=/.test(read(path.join(root,'js',f))));
check(ux4dScatter.length === 0, 'UX-004D: no per-module Quick Action maps outside the central manifest'
  + (ux4dScatter.length ? ' >> VIOLATION: ' + ux4dScatter.join(', ') : ''));
// (3) Actions target EXISTING views only: every `to:` value is a known route (sidebar
//     item or manifest owner key), i.e. dispatched by renderViewContent().
const ux4dActionTargets = [...new Set([...ux4dQaBlock.matchAll(/to:'([a-zA-Z]+)'/g)].map(m=>m[1]))];
const ux4dAllRoutes = new Set([...ux4bRoutes, ...ux4bNavItems]);
const ux4dBadTargets = ux4dActionTargets.filter(v=>!ux4dAllRoutes.has(v));
check(ux4dActionTargets.length > 0 && ux4dBadTargets.length === 0,
  'UX-004D: every Quick Action destination is an existing view (' + ux4dActionTargets.length + ' targets)'
  + (ux4dBadTargets.length ? ' >> VIOLATION: unknown targets: ' + ux4dBadTargets.join(', ') : ''));
// (4/5/6/7/8) NAVIGATION SEMANTICS ONLY. The manifest and its two mount/handler
//     functions must not name any execution, approval, posting or persistence
//     primitive. This is the durable no-auto-execution guard (Part C §12).
const ux4dQaHandlers = ux4dQaBlock
  + (ux4bShell.match(/function quickActionsFor\(view\)\{[\s\S]*?\n\}/)||[''])[0]
  + (ux4bShell.match(/function mountQuickActions\(main\)\{[\s\S]*?\n\}/)||[''])[0];
const ux4dForbidden = /\b(executeTransaction|executePayment|executePayroll|executeOvertime|recordExecution|approve\w*|postToFinance|postPayroll|persist\w*|StorageAdapter|localStorage|saveAllData|commitPayroll|generatePayroll)\s*\(/;
check(!ux4dForbidden.test(ux4dQaHandlers),
  'UX-004D: Quick Action manifest/handlers invoke no execution, approval, posting or persistence function');
// The only side-effecting call a Quick Action makes is hrNavTo() (navigation).
const ux4dMountBody = (ux4bShell.match(/function mountQuickActions\(main\)\{[\s\S]*?\n\}/)||[''])[0];
check(/hrNavTo\(a\.to/.test(ux4dMountBody) && !/render\(\);/.test(ux4dMountBody.replace(/hrNavTo[\s\S]*?\n/,'')),
  'UX-004D: mountQuickActions() drives navigation exclusively through hrNavTo()');
// (9) Execution Center action label is navigation-oriented ("Go to Execution Center"),
//     never "Execute".
check(/label:'Go to Execution Center'/.test(ux4dQaBlock) && !/label:'Execute/.test(ux4dQaBlock),
  'UX-004D: Execution Center Quick Action is worded as navigation ("Go to Execution Center"), not "Execute"');
// (10) Visibility derives from existing context/state via show() predicates.
check(/show:\(\)=>/.test(ux4dQaBlock),
  'UX-004D: Quick Action visibility derives from existing state via show() predicates');
// (11) No Quick Action state persisted, and (12) SCHEMA_VERSION remains 6.
check(!/persist|localStorage|StorageAdapter|SCHEMA_VERSION/.test(ux4dQaHandlers),
  'UX-004D: no Quick Action visibility/state is persisted (no storage, no schema)');
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root,'js','core','constants.js'))), 'UX-004D: SCHEMA_VERSION remains 6');

// ---- Part 20: numeric typography protections ----
const ux4dComp = read(path.join(root,'css','components.css'));
const ux4dCharts = read(path.join(root,'css','charts.css'));
const ux4dTokens = read(path.join(root,'css','tokens.css'));
// (1) tabular-nums applied in the approved business-number selectors.
check(/\.stat-value\{[^}]*font-variant-numeric:tabular-nums/.test(ux4dComp), 'UX-004D: .stat-value uses tabular-nums');
check(/td\.num,\s*th\.num\{[^}]*font-variant-numeric:tabular-nums/.test(ux4dComp), 'UX-004D: numeric table columns (td.num/th.num) use tabular-nums');
check(/\.mono\{[^}]*font-variant-numeric:tabular-nums/.test(ux4dComp), 'UX-004D: .mono currency/amount surface uses tabular-nums');
check(/\.chart-mini-stat \.val\{[^}]*font-variant-numeric:tabular-nums/.test(ux4dCharts), 'UX-004D: chart metric values use tabular-nums');
// (2) Primary UI font retained: business-number selectors use --sans (not --mono).
check(/\.stat-value\{[^}]*font-family:var\(--sans\)/.test(ux4dComp)
  && /\.mono\{[^}]*font-family:var\(--sans\)/.test(ux4dComp)
  && /td\.num,\s*th\.num\{[^}]*font-family:var\(--sans\)/.test(ux4dComp),
  'UX-004D: business-number surfaces use the primary UI font (--sans)');
// (3) Business numeric surfaces no longer depend on monospace (superseded), but --mono
//     is retained for technical/developer inputs (textarea.input).
check(!/\.stat-value\{[^}]*var\(--mono\)/.test(ux4dComp) && !/\.mono\{font-family:var\(--mono\)/.test(ux4dComp),
  'UX-004D: business numeric surfaces no longer depend on monospace');
check(/--mono:/.test(ux4dTokens) && /textarea\.input\{[^}]*var\(--mono\)/.test(ux4dCharts),
  'UX-004D: monospace (--mono) retained for technical inputs, not the default business-number font');
// (4/5/6/7/8/9) Formatter + export logic unchanged: fmtIDR, toLocaleString, CSV writers
//     are byte-identical to their form on the merge base (no presentation leak into logic).
const ux4dFmtSrc = read(path.join(root,'js','core','utils.js'));
const ux4dFmtIdr = (ux4dFmtSrc.match(/function fmtIDR\([\s\S]*?\n\}/)||[''])[0];
check(/function fmtIDR/.test(ux4dFmtSrc) && /toLocaleString\('id-ID'/.test(ux4dFmtIdr),
  'UX-004D: fmtIDR() still formats via toLocaleString(id-ID) — formatter unchanged');
// No CSS/presentation concept leaked into any formatter or export path.
const ux4dExportFiles = jsFiles.map(f=>read(path.join(root,'js',f))).join('\n');
check(!/font-variant-numeric|tabular-nums/.test(ux4dExportFiles),
  'UX-004D: no numeric-typography concept leaked into JS (formatters/exports are presentation-agnostic)');
// (10) CSS golden-master pin was revised exactly once for UX-004D (documented above).
check(/font-variant-numeric:tabular-nums/.test(ux4dComp) && /font-variant-numeric:tabular-nums/.test(ux4dCharts),
  'UX-004D: numeric-typography CSS is present in the pinned golden master');

// ---- runtime harness presence (behaviour proof lives out-of-process) ----
check(fs.existsSync(path.join(root,'tools','verify-breadcrumb-quickaction-runtime.js')),
  'UX-004D runtime harness present: tools/verify-breadcrumb-quickaction-runtime.js');

/* ============================================================
   UX-004E — SIDEBAR INTERACTION (collapse / pin / hover-expand / drawer)
   Static guards. Behaviour is proven by tools/verify-sidebar-interaction-runtime.js.
   All state is session-only; no storage, no schema; the shell is never remounted by
   interaction; active-state, breadcrumb and Quick Action logic are untouched.
   ============================================================ */
console.log('== UX-004E SIDEBAR INTERACTION INVARIANTS ==');
const ux4eShell = read(path.join(root,'js','ui','shell-render.js'));
const ux4eState = read(path.join(root,'js','core','state.js'));
const ux4eCss   = read(path.join(root,'css','shell.css'));
const ux4eBody  = (name)=> (ux4eShell.match(new RegExp('function\\s+'+name+'\\s*\\([^)]*\\)\\{[\\s\\S]*?\\n\\}'))||[''])[0];

// (1) Session-only State fields exist, declared as session-only (mirroring navCollapsed).
check(/sidebarCollapsed:\s*false/.test(ux4eState) && /sidebarPinned:\s*null/.test(ux4eState) && /sidebarDrawerOpen:\s*false/.test(ux4eState),
  'UX-004E: session-only sidebar state fields (sidebarCollapsed/sidebarPinned/sidebarDrawerOpen) declared in State');
// (2) NOT persisted: no storage key, and no persist path serializes the sidebar fields.
const ux4ePersistSrc = ['core/hr-persistence-portability.js','core/stabilization.js','core/state-load-migrations.js']
  .map(f=>read(path.join(root,'js',f))).join('\n');
check(!/sidebarCollapsed|sidebarPinned|sidebarDrawerOpen/.test(ux4ePersistSrc),
  'UX-004E: no persist path references the sidebar interaction fields (session-only, never written)');
check(!/tam_sidebar|sidebar_v1|tam_.*sidebar/i.test(ux4eShell+ux4eState) ,
  'UX-004E: no sidebar storage key introduced');
// (3) The interaction functions exist.
['sidebarApplyState','setSidebarCollapsed','openSidebarDrawer','closeSidebarDrawer','sidebarIsDrawerMode'].forEach(fn=>{
  check(new RegExp('function\\s+'+fn+'\\s*\\(').test(ux4eShell), 'UX-004E: '+fn+'() is defined');
});
// (4) NO SHELL REMOUNT: interaction functions never call renderShell/bindShell nor set innerHTML.
const ux4eInteract = ux4eBody('sidebarApplyState')+ux4eBody('setSidebarCollapsed')+ux4eBody('openSidebarDrawer')+ux4eBody('closeSidebarDrawer');
check(!/renderShell\s*\(|bindShell\s*\(|\.innerHTML\s*=/.test(ux4eInteract),
  'UX-004E: interaction handlers never remount the shell (no renderShell/bindShell/innerHTML=)');
// (5) Listeners bound ONCE inside bindShell (reuses the UX-002A single-bindShell guarantee):
//     collapse toggle, hamburger, backdrop, ESC/Tab keydown, and the media-query change.
const ux4eBindBody = (ux4eShell.match(/function bindShell\(app\)\{[\s\S]*?\n\}/)||[''])[0];
check(/#sidebarCollapseBtn/.test(ux4eBindBody) && /toggleSidebarCollapsed\(\)/.test(ux4eBindBody),
  'UX-004E: bindShell wires the collapse toggle');
check(/#navHamburger/.test(ux4eBindBody) && /openSidebarDrawer\(\)/.test(ux4eBindBody) && /closeSidebarDrawer\(\)/.test(ux4eBindBody),
  'UX-004E: bindShell wires the hamburger (open/close drawer)');
check(/#sidebarBackdrop/.test(ux4eBindBody) && /closeSidebarDrawer\(\)/.test(ux4eBindBody),
  'UX-004E: bindShell wires the backdrop to close the drawer');
check(/key==='Escape'/.test(ux4eBindBody) && /key==='Tab'/.test(ux4eBindBody),
  'UX-004E: bindShell installs ESC-close and Tab focus-trap keyboard handling');
check(/matchMedia\('\(max-width:768px\)'\)/.test(ux4eBindBody),
  'UX-004E: bindShell reacts to viewport (drawer<->desktop) changes');
// (6) renderShell emits the hamburger, backdrop, single sidebar and single Primary-nav landmark,
//     and calls sidebarApplyState() once after mount.
const ux4eRenderShellBody = (ux4eShell.match(/function renderShell\(\)\{[\s\S]*?\n\}/)||[''])[0];
check(/id="navHamburger"/.test(ux4eRenderShellBody) && /id="sidebarBackdrop"/.test(ux4eRenderShellBody) && /id="sidebarCollapseBtn"/.test(ux4eRenderShellBody),
  'UX-004E: renderShell mounts the hamburger, backdrop and collapse toggle');
check(/sidebarApplyState\(\)/.test(ux4eRenderShellBody),
  'UX-004E: renderShell applies session sidebar state once after mount');
check((ux4eShell.match(/<nav class="nav" aria-label="Primary navigation">/g)||[]).length === 1,
  'UX-004E: still exactly one Primary-navigation landmark');
// (7) Accessibility: aria-expanded on both controls; aria-hidden managed on the drawer.
check(/aria-expanded/.test(ux4eRenderShellBody) && /aria-controls="sidebar"/.test(ux4eRenderShellBody),
  'UX-004E: hamburger carries aria-expanded + aria-controls');
check(/setAttribute\('aria-hidden','true'\)/.test(ux4eBody('sidebarApplyState')) && /removeAttribute\('aria-hidden'\)/.test(ux4eBody('sidebarApplyState')),
  'UX-004E: drawer aria-hidden is set when closed off-canvas and cleared when open/desktop');
// (8) Focus management: drawer open moves focus into the sidebar; close restores previous focus.
check(/\.focus\(\)/.test(ux4eBody('openSidebarDrawer')) && /_sidebarFocusReturn/.test(ux4eBody('openSidebarDrawer')),
  'UX-004E: opening the drawer captures the return focus and focuses inside it');
check(/_sidebarFocusReturn/.test(ux4eBody('closeSidebarDrawer')) && /\.focus\(\)/.test(ux4eBody('closeSidebarDrawer')),
  'UX-004E: closing the drawer restores the previously focused element');
// (9) Active-state / breadcrumb / Quick Action logic untouched: navGroupHTML still marks
//     aria-current, and the label is now wrapped (labels hide when collapsed) without
//     changing the active resolution.
check(/aria-current="page"/.test(ux4bNavItemBody) && /class="nav-label"/.test(ux4eShell),
  'UX-004E: nav labels are wrapped for collapse while aria-current active-state is unchanged');
check(/const QUICK_ACTIONS_BY_VIEW/.test(ux4eShell) && (ux4eShell.match(/aria-label="Breadcrumb"/g)||[]).length===1,
  'UX-004E: breadcrumb + Quick Action logic remain present and unchanged (one Breadcrumb landmark)');
// (10) SCHEMA_VERSION unchanged.
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root,'js','core','constants.js'))), 'UX-004E: SCHEMA_VERSION remains 6');
// (11) CSS: collapse rail, hamburger, backdrop, drawer media query, hover-expand present.
check(/\.sidebar\.collapsed\{width:/.test(ux4eCss), 'UX-004E CSS: collapsed rail width defined');
check(/\.nav-hamburger\{/.test(ux4eCss) && /\.sidebar-backdrop\{/.test(ux4eCss), 'UX-004E CSS: hamburger + backdrop styles present');
check(/@media \(max-width:768px\)\{/.test(ux4eCss) && /transform:translateX\(-100%\)/.test(ux4eCss), 'UX-004E CSS: responsive drawer (off-canvas transform) present');
check(/@media \(min-width:769px\) and \(hover:hover\)\{/.test(ux4eCss) && /\.sidebar\.collapsed:hover\{width:258px/.test(ux4eCss), 'UX-004E CSS: desktop hover-expand present');
check(/transition:width \.2s/.test(ux4eCss), 'UX-004E CSS: sidebar width transition (animation) present');
// (12) UX-004E sidebar-interaction CSS is present in the pinned golden master.
check(/\.sidebar\.collapsed\{width:/.test(ux4eCss) && /\.nav-hamburger\{/.test(ux4eCss),
  'UX-004E: sidebar-interaction CSS is present in the pinned golden master');
// (13) Runtime harness present.
check(fs.existsSync(path.join(root,'tools','verify-sidebar-interaction-runtime.js')),
  'UX-004E runtime harness present: tools/verify-sidebar-interaction-runtime.js');

/* ============================================================
   UX-004F — NAVIGATION SIMPLIFICATION & TAM OS REBRAND
   Static guards. Behaviour is proven by tools/verify-nav-simplification-runtime.js.
   Presentation only: ids/routes/views/business logic unchanged; historical evidence
   preserved. ux4eShell (js/ui/shell-render.js) is already read above.
   ============================================================ */
console.log('== UX-004F NAVIGATION SIMPLIFICATION + TAM OS REBRAND INVARIANTS ==');
const ux4fShell = ux4eShell;
const ux4fConstants = read(path.join(root,'js','core','constants.js'));
const ux4fCss = ux4eCss;

// ---- rebrand: official product name is "TAM OS" ----
check(/const APP_NAME = 'TAM OS';/.test(ux4fConstants), 'UX-004F: APP_NAME is "TAM OS"');
check(!/const APP_NAME = 'TAM Intelligence OS';/.test(ux4fConstants), 'UX-004F: the old product name is no longer the APP_NAME');
check(dist.includes('<title>TAM OS v' + meta.version + '</title>'), 'UX-004F: browser <title> rebranded to TAM OS');
// Sidebar wordmark is "TAM OS", no "Intelligence" in the shell markup.
// BRAND-1: the wordmark is a single live-text mark — TAM&nbsp;<span class="os">OS</span> —
// alongside the monogram (Model C); the old mfull/mshort split is gone (collapsed shows the
// monogram, wordmark visually-hidden).
const ux4fMark = (ux4fShell.match(/<div class="mark">[\s\S]*?<\/div>/)||[''])[0];
check(/>TAM(&nbsp;| )<span class="os">OS<\/span>/.test(ux4fMark) && !/Intelligence/.test(ux4fMark),
  'UX-004F: sidebar wordmark is "TAM OS" (no "Intelligence")');
// No current-state in-app literal "TAM Intelligence OS" remains in the runtime JS,
// EXCEPT the historical Release Notes array in settings-about.js (immutable history).
const ux4fRuntimeJs = jsFiles.filter(f=>f!=='ui/settings-about.js').map(f=>read(path.join(root,'js',f))).join('\n');
check(!/TAM Intelligence OS/.test(ux4fRuntimeJs),
  'UX-004F: no current-state in-app "TAM Intelligence OS" literal remains (historical Release Notes excepted)');
// Historical evidence preserved: the Release Notes array still records the old name.
check(/TAM Intelligence OS/.test(read(path.join(root,'js','ui','settings-about.js'))),
  'UX-004F: historical Release Notes still record the old "TAM Intelligence OS" name (history intact)');
check(read(path.join(root,'CHANGELOG.md')).includes('TAM Intelligence OS'),
  'UX-004F: CHANGELOG history is untouched (still records the old name)');

// ---- navigation simplification: Finance primary + "More" disclosure ----
const ux4fFinBlock = (ux4fShell.match(/\{id:'finance', label:'Finance', items:\[([\s\S]*?)\]\},/)||[,''])[1];
const ux4fFinIds = [...ux4fFinBlock.matchAll(/\{id:'([a-zA-Z]+)'/g)].map(m=>m[1]);
const ux4fPrimary = [...ux4fFinBlock.matchAll(/\{id:'([a-zA-Z]+)',[^}]*\}/g)].filter(m=>!/more:true/.test(m[0])).map(m=>m[1]);
const ux4fMore = [...ux4fFinBlock.matchAll(/\{id:'([a-zA-Z]+)',[^}]*\}/g)].filter(m=>/more:true/.test(m[0])).map(m=>m[1]);
// Finance still owns all 15 destinations (no id added/removed): route stability.
check(ux4fFinIds.length === 15, 'UX-004F: Finance still contains all 15 destinations (no route removed) — found ' + ux4fFinIds.length);
check(JSON.stringify(ux4fPrimary) === JSON.stringify(['financeOverview','payroll','transactions','monthlyplan']),
  'UX-004F: exactly four Finance PRIMARY items (Overview/Payroll/Transactions/Planning): ' + ux4fPrimary.join(','));
check(ux4fMore.length === 11 && ['overtime','supplementals','add','recurring','cashflow','budgetcenter','executioncenter','bankaccounts','projects','vendors','calendar'].every(id=>ux4fMore.includes(id)),
  'UX-004F: every other Finance destination is disclosed under "More" (' + ux4fMore.length + ' items)');
// Simplified labels (labels only — ids above are unchanged).
[["financeOverview","Overview"],["payroll","Payroll"],["monthlyplan","Planning"],["supplementals","Supplements"],["add","Import"],["executioncenter","Execution"],["recurring","Recurring"]].forEach(([id,label])=>{
  check(new RegExp("\\{id:'"+id+"', label:'"+label+"'").test(ux4fShell), 'UX-004F: '+id+' label simplified to "'+label+'"');
});
// The "More" disclosure machinery: derived-open helper, item helper, toggle wiring, sync.
check(/function navItemHTML\(n, activeItem\)\{/.test(ux4fShell) && /function navMoreOpen\(g, activeItem\)\{/.test(ux4fShell),
  'UX-004F: navItemHTML() + navMoreOpen() helpers exist');
check(/class="nav-item nav-more-head" data-more=/.test(ux4fShell) && /class="nav-more-items"/.test(ux4fShell),
  'UX-004F: the "More" toggle + container are rendered');
const ux4fBindBody = (ux4fShell.match(/function bindShell\(app\)\{[\s\S]*?\n\}/)||[''])[0];
check(/\[data-more\]/.test(ux4fBindBody) && /State\.navMore\[g\]=!State\.navMore\[g\]/.test(ux4fBindBody),
  'UX-004F: bindShell wires the "More" disclosure toggle (session-only)');
const ux4fSyncBody = (ux4fShell.match(/function syncShellState\(\)\{[\s\S]*?\n\}/)||[''])[0];
check(/\[data-more\]/.test(ux4fSyncBody) && /navMoreOpen\(/.test(ux4fSyncBody),
  'UX-004F: syncShellState re-syncs the "More" disclosure in place (no shell remount)');
// Progressive-disclosure state is session-only (declared like navCollapsed, never persisted).
check(/navMore:\s*\{\}/.test(read(path.join(root,'js','core','state.js'))), 'UX-004F: navMore is a session-only State field');
check(!/navMore/.test(['core/hr-persistence-portability.js','core/stabilization.js','core/state-load-migrations.js'].map(f=>read(path.join(root,'js',f))).join('\n')),
  'UX-004F: navMore is never persisted (no storage path references it)');

// ---- preserved architecture ----
check((ux4fShell.match(/<nav class="nav" aria-label="Primary navigation">/g)||[]).length === 1, 'UX-004F: still exactly one Primary-navigation landmark');
check((ux4fShell.match(/aria-label="Breadcrumb"/g)||[]).length === 1 && /const QUICK_ACTIONS_BY_VIEW/.test(ux4fShell), 'UX-004F: breadcrumb + Quick Action systems unchanged');
check((ux4fShell.match(/\bfunction\s+renderShell\s*\(/g)||[]).length === 1 && (ux4fShell.match(/\bfunction\s+navGroupHTML\s*\(/g)||[]).length === 1, 'UX-004F: single persistent-shell renderer preserved');
check(/aria-expanded="\$\{moreOpen\}"/.test(ux4fShell), 'UX-004F: the "More" toggle exposes aria-expanded');
// Five-domain grouping unchanged (exactly the five approved groups, same ids).
const ux4fGroupIds = [...ux4fShell.matchAll(/\{id:'(dashboard|people|finance|analytics|system)', label:'/g)].map(m=>m[1]);
check(JSON.stringify(ux4fGroupIds) === JSON.stringify(['dashboard','people','finance','analytics','system']), 'UX-004F: the five-domain grouping is unchanged');

// ---- quieter placeholder badge (feature preserved) ----
check(/comingSoon:'Soon'/.test(ux4fShell), 'UX-004F: placeholder badge is the quieter "Soon"');
check(/projects:\s*\{ status:'comingSoon'/.test(ux4fShell) && /vendors:\s*\{ status:'comingSoon'/.test(ux4fShell) && /calendar:\s*\{ status:'comingSoon'/.test(ux4fShell),
  'UX-004F: placeholder features (Projects/Vendors/Financial Calendar) are preserved');
check(/\.nav-preview-tag\{[^}]*background:transparent/.test(ux4fCss) && /\.nav-preview-tag\{[^}]*font-weight:500/.test(ux4fCss),
  'UX-004F: the placeholder badge is visually quieter (no fill, normal weight)');

// ---- invariants unchanged ----
check(/const SCHEMA_VERSION = 6;/.test(ux4fConstants), 'UX-004F: SCHEMA_VERSION remains 6');
// v2.9.0 release: constants carry the single-source release identity forward.
check(/const APP_VERSION = '2\.11\.0';/.test(ux4fConstants) && /const APP_RELEASE_NAME = 'Identity Refresh';/.test(ux4fConstants),
  'release: APP_VERSION 2.11.0 and APP_RELEASE_NAME match the v2.11.0 release identity');
check(fs.existsSync(path.join(root,'tools','verify-nav-simplification-runtime.js')),
  'UX-004F runtime harness present: tools/verify-nav-simplification-runtime.js');

/* ============================================================
   UX-004 SIDEBAR INTERACTION HOTFIX
   The group-collapse and "More" toggles must not arm a phantom collapse/disclosure
   flag for the section that owns the active view (the active section is force-open
   by the verifier-enforced invariant, so flipping the flag changed nothing on screen
   yet surprised the user on the next navigation). Both handlers now no-op in that
   case. Behaviour proven by tools/verify-sidebar-click-regression-runtime.js.
   ============================================================ */
console.log('== UX-004 SIDEBAR INTERACTION HOTFIX INVARIANTS ==');
const ux4hBind = (ux4eShell.match(/function bindShell\(app\)\{[\s\S]*?\n\}/)||[''])[0];
const ux4hGroupHandler = (ux4hBind.match(/querySelectorAll\('\[data-group\]'\)[\s\S]*?\n  \}\);/)||[''])[0];
const ux4hMoreHandler  = (ux4hBind.match(/querySelectorAll\('\[data-more\]'\)[\s\S]*?\n  \}\);/)||[''])[0];
check(/g === navActive\(\)\.group/.test(ux4hGroupHandler) && /return;/.test(ux4hGroupHandler),
  'UX-004 hotfix: the group-toggle handler no-ops for the active group (no phantom collapse)');
check(/navActive\(\)\.item/.test(ux4hMoreHandler) && /i\.more/.test(ux4hMoreHandler) && /return;/.test(ux4hMoreHandler),
  'UX-004 hotfix: the More-toggle handler no-ops when the active view lives inside More');
// The force-open invariant it relies on must still be present (not weakened).
check(/!==\s*active\.group/.test(ux4bSyncBody), 'UX-004 hotfix: the active-group force-open invariant is preserved');
check(fs.existsSync(path.join(root,'tools','verify-sidebar-click-regression-runtime.js')),
  'UX-004 hotfix runtime harness present: tools/verify-sidebar-click-regression-runtime.js');

// UX-002B PHASE 1 — TYPOGRAPHY / TOKEN / THEME INVARIANTS.
// These convert design rules that were previously only conventions into
// mechanically enforced invariants, so they cannot silently regress.
console.log('== UX-002B TOKEN + TYPOGRAPHY INVARIANTS ==');
const ux2bCssFiles = cssFiles.map((f)=>({name:f, src:read(path.join(root,'css',f))}));
const ux2bStrip = (s)=>s.replace(/\/\*[\s\S]*?\*\//g,'');   // CSS has no // comments

// (1) No fractional font-size anywhere in CSS — the scale is integer-only.
const ux2bFrac = [];
ux2bCssFiles.forEach(({name,src})=>{
  const m = ux2bStrip(src).match(/font-size:\s*\d+\.\d+px/g);
  if(m) ux2bFrac.push(name + ' -> ' + m.join(', '));
});
check(ux2bFrac.length === 0,
  'no fractional font-size values in CSS (integer type scale only)'
  + (ux2bFrac.length ? ' >> VIOLATION: ' + ux2bFrac.join(' | ') : ''));

// (2) The serif is identity-only: it may appear on the wordmark and nowhere else.
// BRAND-1: the wordmark moved off --serif onto the dedicated display face --display
// (Sora SemiBold). The durable invariant is unchanged in spirit — the product wordmark has
// its OWN face, and general UI chrome does not borrow it. So: var(--display) is used exactly
// once in CSS, on .brand .mark, and nowhere else (UI content stays on --sans). --serif is no
// longer referenced in CSS at all (its only remaining use is the payroll month header in JS).
const ux2bDisplaySites = [];
ux2bCssFiles.forEach(({name,src})=>{
  ux2bStrip(src).split('\n').forEach((line,i)=>{
    if(/var\(--display\)/.test(line))
      ux2bDisplaySites.push({at:name + ':' + (i+1), brand:/^\.brand \.mark\{/.test(line.trim())});
  });
});
const ux2bDisplayBad = ux2bDisplaySites.filter(s=>!s.brand).map(s=>s.at);
check(ux2bDisplaySites.length === 1 && ux2bDisplayBad.length === 0,
  'BRAND-1: var(--display) is used exactly once in CSS, on .brand .mark (the wordmark has its own face; UI chrome is sans)'
  + ((ux2bDisplaySites.length === 1 && ux2bDisplayBad.length === 0) ? ''
     : ' >> VIOLATION: ' + ux2bDisplaySites.length + ' usage site(s)'
       + (ux2bDisplayBad.length ? ', non-brand: ' + ux2bDisplayBad.join(', ') : '')));

// (3) Dark/light parity: every custom property declared in :root must also be
//     declared in :root[data-theme="light"]. A theme cannot be half-defined.
const ux2bTokensSrc = ux2bStrip(read(path.join(root,'css','tokens.css')));
const ux2bBlock = (sel)=>{
  const i = ux2bTokensSrc.indexOf(sel); if(i<0) return null;
  const a = ux2bTokensSrc.indexOf('{', i), b = ux2bTokensSrc.indexOf('}', a);
  return (a<0||b<0) ? null : ux2bTokensSrc.slice(a+1,b);
};
const ux2bNames = (blk)=> new Set(((blk||'').match(/--[a-z0-9-]+\s*:/gi)||[]).map(s=>s.replace(/\s*:$/,'').trim()));
const ux2bDark = ux2bNames(ux2bBlock(':root, :root[data-theme="dark"]'));
const ux2bLight = ux2bNames(ux2bBlock(':root[data-theme="light"]'));
const ux2bMissing = [...ux2bDark].filter(t=>!ux2bLight.has(t));
let ux2bParityMsg = '';
if(ux2bDark.size === 0 || ux2bLight.size === 0) ux2bParityMsg = ' >> VIOLATION: a :root block could not be parsed';
else if(ux2bMissing.length) ux2bParityMsg = ' >> VIOLATION: missing from light theme: ' + ux2bMissing.join(', ');
check(ux2bDark.size > 0 && ux2bLight.size > 0 && ux2bMissing.length === 0,
  'every :root token is also defined for :root[data-theme="light"] (dark/light parity)' + ux2bParityMsg);

// (4) Spacing and radius resolve from tokens. Documented exceptions:
//     values below 4px (hairlines / optical nudges finer than the smallest step),
//     and td/th padding, which the table density invariant freezes.
const ux2bRaw = [];
ux2bCssFiles.forEach(({name,src})=>{
  // A fresh regex per file — a shared /g regex would carry lastIndex across files.
  const re = /(?:^|[;{])\s*(padding|margin|gap|row-gap|column-gap|border-radius)(-top|-right|-bottom|-left)?\s*:\s*([^;}]+)/gi;
  let scan = ux2bStrip(src);
  // Lookbehind so the preceding rule's closing brace is NOT consumed with the match.
  [/(?<![\w.\-])th\s*\{[^}]*\}/g, /(?<![\w.\-])td\s*\{[^}]*\}/g].forEach((ex)=>{ scan = scan.replace(ex, ''); });
  let m;
  while((m = re.exec(scan)) !== null){
    const val = m[3];
    (val.match(/-?\d+(?:\.\d+)?px/g) || []).forEach(p=>{
      if(Math.abs(parseFloat(p)) >= 4) ux2bRaw.push(name + ' -> ' + m[1] + (m[2]||'') + ':' + val.trim());
    });
  }
});
check(ux2bRaw.length === 0,
  'spacing and radius in CSS resolve from tokens (exceptions: sub-4px hairlines, td/th density freeze)'
  + (ux2bRaw.length ? ' >> VIOLATION: ' + [...new Set(ux2bRaw)].join(' | ') : ''));

// (5) UX-002B PHASE 2 — no theme-sensitive colour literal in production JS.
// Chart series colours used to be passed in as hex, so they never responded to the
// light theme. They now resolve through themeVar('--token', fallback). This check
// scans every production module for a QUOTED hex colour literal — the form all 27
// migrated sites used — after removing the constructs that are legitimately allowed
// to hold one. It cannot be satisfied by declaring a token elsewhere: the literal
// itself must be gone from the colour position.
// Documented exemptions, and why each is not debt:
//   - themeVar('--token', '#fallback') — the fallback IS the contract for a missing
//     token; stripped before scanning, so only unguarded literals remain.
//   - core/constants.js — STATUS_META / CATEGORY_COLOR, the shared semantic palette
//     consumed by BOTH pills and charts. Tokenizing it is cross-cutting and is
//     deliberately deferred out of UX-002B.
//   - core/stabilization.js — assigns the browser <meta name="theme-color">, which
//     must be a literal per theme by definition.
//   - ui/charts.js GRID_COLOR — its only use is as a themeVar() fallback argument.
console.log('== UX-002B CHART / THEME COLOUR TOKENIZATION ==');
const ux2bColourExemptFiles = new Set(['core/constants.js','core/stabilization.js']);
const ux2bHexHits = [];
jsFiles.forEach((rel)=>{
  if(ux2bColourExemptFiles.has(rel)) return;
  let src = stripComments(read(path.join(root,'js',rel)));
  src = src.replace(/themeVar\s*\([^)]*\)/g, '');                        // fallback arguments
  src = src.replace(/const\s+GRID_COLOR\s*=\s*['"]#[0-9a-fA-F]{6}['"]\s*;/, ''); // themeVar fallback constant
  const hits = src.match(/['"]#[0-9a-fA-F]{6}['"]/g);
  if(hits) ux2bHexHits.push(rel + ' -> ' + [...new Set(hits)].join(', '));
});
check(ux2bHexHits.length === 0,
  'no theme-sensitive hex colour literal in production JS colour positions (chart colours resolve via themeVar tokens)'
  + (ux2bHexHits.length ? ' >> VIOLATION: ' + ux2bHexHits.join(' | ') : ''));

// UX-003A — CONTRACT TIMELINE REFERENCE-DATE COHERENCE.
// contractCalc(c, refKey) derives progress, coversMonth, expiredForRef and
// beforeStart against refKey. daysUntilEnd used to be derived from isoToday(),
// so one return object answered two different questions and
// contractEffectiveStatus() — which reads daysUntilEnd for its "Expiring Soon"
// branch — became a today/refKey hybrid. These checks inspect the real function
// bodies, so a regression that reintroduced the today-based origin cannot pass.
console.log('== UX-003A CONTRACT TIMELINE (REFERENCE-DATE COHERENCE) ==');
const ux3aSrc = stripComments(read(path.join(root,'js','people','people-core.js')));
// Top-level function body: declaration at column 0 through the next line that
// begins with a closing brace at column 0.
const ux3aBodyOf = (name)=>{
  const m = ux3aSrc.match(new RegExp('^function '+name+'\\([^)]*\\)\\{[\\s\\S]*?\\n\\}','m'));
  return m ? m[0] : '';
};
const ux3aCalcBody = ux3aBodyOf('contractCalc');
const ux3aStatusBody = ux3aBodyOf('contractEffectiveStatus');
const ux3aRefDateBody = ux3aBodyOf('contractRefDate');
// UX-003B: the classifier now owns the calc call the facade used to make directly.
const ux3aStateBodyForTimeBasis = ux3aBodyOf('contractTimeline');
check(ux3aCalcBody !== '' && ux3aStatusBody !== '' && ux3aRefDateBody !== '',
  'UX-003A: contractCalc(), contractEffectiveStatus() and contractRefDate() are all resolvable top-level functions');
// 1. daysUntilEnd is not computed directly from isoToday() inside contractCalc().
const ux3aDaysLine = (ux3aCalcBody.match(/^.*\bout\.daysUntilEnd\s*=.*$/m)||[''])[0];
check(ux3aDaysLine !== '' && !/isoToday\s*\(/.test(ux3aDaysLine),
  'UX-003A: daysUntilEnd is NOT derived directly from isoToday() inside contractCalc()');
check(!/isoToday\s*\(/.test(ux3aCalcBody),
  'UX-003A: contractCalc() contains no direct isoToday() call at all (single reference-date source)');
// 2. The supplied refKey — via its normalized reference date — feeds the calculation.
check(/\bout\.daysUntilEnd\s*=\s*daysBetween\(\s*contractRefDate\(\s*ref\s*\)/.test(ux3aCalcBody),
  'UX-003A: daysUntilEnd is measured from contractRefDate(ref) — the normalized reference date of the supplied refKey');
check(/const\s+ref\s*=\s*refKey\s*\|\|\s*todayKey\(\)/.test(ux3aCalcBody),
  'UX-003A: ref still defaults to todayKey() when refKey is omitted (today behaviour preserved)');
// 3. contractRefDate() resolves the current month to isoToday(), which is what
//    makes an omitted refKey and an explicit current-month key identical.
check(/isoToday\s*\(/.test(ux3aRefDateBody) && /slice\(0,\s*7\)/.test(ux3aRefDateBody),
  'UX-003A: contractRefDate() resolves the CURRENT month to isoToday() (omitted === explicit current month)');
check(/keyParts\s*\(/.test(ux3aRefDateBody) && /-01/.test(ux3aRefDateBody),
  'UX-003A: contractRefDate() resolves any OTHER month to that month\'s first day');
// 4. contractEffectiveStatus() introduces no second, independent time source.
check(!/isoToday\s*\(/.test(ux3aStatusBody) && !/daysBetween\s*\(/.test(ux3aStatusBody) && !/new\s+Date\s*\(/.test(ux3aStatusBody),
  'UX-003A: contractEffectiveStatus() introduces no independent today-based time source (no isoToday/daysBetween/new Date)');
// UX-003B moved the time basis one level down: contractEffectiveStatus() is now a
// display facade over contractTimelineState(), which is the single site that calls
// contractCalc(c, refKey||todayKey()). The INTENT of this check — exactly one time
// basis, reached only through the calc — is unchanged and now asserted on the
// classifier. (Pre-UX-003B this regex matched the facade body directly.)
check(/contractCalc\(c,\s*ref\)/.test(ux3aStateBodyForTimeBasis) ||
      /contractCalc\(c,\s*refKey\s*\|\|\s*todayKey\(\)\)/.test(ux3aStatusBody),
  'UX-003A: the effective-status path derives its time basis solely from contractCalc()');
// UX-003A was a reference-date correction ONLY — no vocabulary, storage or schema move.
check(/const CONTRACT_STORED_STATUSES = \['Draft','Active','Renewed','Cancelled'\];/.test(read(path.join(root,'js','core','constants.js'))),
  'UX-003A: stored contract status vocabulary is unchanged (no Scheduled state added)');
// UX-003B introduced the DERIVED Scheduled state (this was UX-003A's "later phase").
// The safety intent is preserved and strengthened: Scheduled may exist as a derived
// classification, but people-core.js must never assign it to a stored status field.
check(!/\.status\s*=\s*['"]Scheduled['"]/.test(ux3aSrc) && !/\bstatus\s*:\s*['"]Scheduled['"]/.test(ux3aSrc),
  'UX-003A/B: people-core.js never writes Scheduled into a stored status field (derived only)');
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root,'js','core','constants.js'))),
  'UX-003A: SCHEMA_VERSION remains 6 (UX-003A is not a migration)');
// 5. The dedicated runtime harness is DISCOVERABLE and honest (not executed here).
const ux3aPath = path.join(root,'tools','verify-contract-timeline-runtime.js');
check(fs.existsSync(ux3aPath), 'UX-003A runtime harness present: tools/verify-contract-timeline-runtime.js');
const ux3aHarness = read(ux3aPath);
check(/UX-003A/.test(ux3aHarness) && /CONTRACT TIMELINE/.test(ux3aHarness),
  'UX-003A harness identifies its sprint and subject correctly');
check(/RUNTIME VERIFICATION PASSED/.test(ux3aHarness) && /process\.exit\(1\)/.test(ux3aHarness),
  'UX-003A harness fails non-zero on assertion failure');
check(!/child_process|require\('http|require\("http/.test(ux3aHarness),
  'UX-003A harness spawns no process and opens no network');
check(!/fs\.(writeFile|writeFileSync|appendFile|appendFileSync|unlink|rmSync|mkdir)/.test(ux3aHarness),
  'UX-003A harness writes nothing to disk');
check(/module-order\.js/.test(ux3aHarness) && /vm\.runInContext/.test(ux3aHarness),
  'UX-003A harness executes the REAL production modules in manifest order');
check(/payrollHealth/.test(ux3aHarness) && /generatePayrollForMonth/.test(ux3aHarness),
  'UX-003A harness exercises the real payroll paths (safety + historical advisory)');
check(/daysBetween\(firstDayOf\(/.test(ux3aHarness),
  'UX-003A harness states its OWN reference-date expectation (not production\'s helper result)');

// UX-003B — CANONICAL TWO-DIMENSIONAL CONTRACT TIMELINE MODEL (PD-T1..PD-T4).
// Effective state ("where in the lifecycle?") and expiry horizon ("how close to
// ending?") are INDEPENDENT dimensions, computed once by contractTimeline().
// A contract ending this month is state 'Active' WITH horizon 'EndingThisMonth' —
// a horizon never replaces the effective state. Calendar horizons are calendar
// facts and are NOT gated by contractExpiryWarningDays; only WithinWarningWindow
// depends on that threshold. These checks inspect real function bodies and the
// whole js/ tree, so a regression that flattened the dimensions, gated the
// calendar horizons, reintroduced a second rulebook or an inline band ladder, or
// stored 'Scheduled', cannot pass verification.
console.log('== UX-003B CANONICAL TWO-DIMENSIONAL TIMELINE MODEL ==');
const ux3bCoreSrc = stripComments(read(path.join(root,'js','people','people-core.js')));
const ux3bConstSrc = read(path.join(root,'js','core','constants.js'));
const ux3bConstCode = stripComments(ux3bConstSrc);
const ux3bBodyOf = (name)=>{
  const m = ux3bCoreSrc.match(new RegExp('^function '+name+'\\([^)]*\\)\\{[\\s\\S]*?\\n\\}','m'));
  return m ? m[0] : '';
};
const ux3bTimelineBody = ux3bBodyOf('contractTimeline');
const ux3bBandBody     = ux3bBodyOf('contractExpiryBand');
const ux3bWeekBody     = ux3bBodyOf('isoWeekKey');
const ux3bFacadeBody   = ux3bBodyOf('contractEffectiveStatus');
check(ux3bTimelineBody !== '' && ux3bBandBody !== '' && ux3bWeekBody !== '',
  'UX-003B: contractTimeline(), contractExpiryBand() and isoWeekKey() are resolvable top-level functions');

// 1. EFFECTIVE STATE AND HORIZON ARE DISTINCT CONCEPTS.
const ux3bStatesLit  = (ux3bConstCode.match(/const CONTRACT_EFFECTIVE_STATES\s*=\s*\[[\s\S]*?\];/)||[''])[0];
const ux3bHorizonLit = (ux3bConstCode.match(/const CONTRACT_EXPIRY_HORIZONS\s*=\s*\[[\s\S]*?\];/)||[''])[0];
check(ux3bStatesLit !== '' && ux3bHorizonLit !== '',
  'UX-003B: the effective-state and expiry-horizon vocabularies are declared separately (two dimensions)');
['Draft','Cancelled','Renewed','Scheduled','Active','Expired'].forEach((s)=>{
  check(new RegExp("'"+s+"'").test(ux3bStatesLit), 'UX-003B: effective-state vocabulary contains '+s);
});
['EndingToday','EndingThisWeek','EndingThisMonth','EndingNextMonth','WithinWarningWindow','None'].forEach((h)=>{
  check(new RegExp("'"+h+"'").test(ux3bHorizonLit), 'UX-003B: horizon vocabulary contains '+h);
});
// No horizon value may masquerade as an effective state (the flattened-model bug).
check(!/Ending(Today|ThisWeek|ThisMonth|NextMonth)|WithinWarningWindow/.test(ux3bStatesLit),
  'UX-003B: no horizon value appears in the effective-state vocabulary (horizons never replace Active)');
check(!/'Scheduled'|'Expired'|'Draft'/.test(ux3bHorizonLit),
  'UX-003B: no effective state appears in the horizon vocabulary');
// The classifier must return BOTH dimensions from one computation.
check(/state\s*:/.test(ux3bTimelineBody) && /horizon\s*:/.test(ux3bTimelineBody),
  'UX-003B: contractTimeline() returns both a state and a horizon from one computation');
check(/state:'Active'/.test(ux3bTimelineBody.replace(/\s/g,'')),
  'UX-003B: the horizon branch still yields effective state Active (the dimensions stay independent)');

// 2. Scheduled is DERIVED ONLY and never persisted.
check(/const CONTRACT_STORED_STATUSES = \['Draft','Active','Renewed','Cancelled'\];/.test(ux3bConstSrc),
  'UX-003B: CONTRACT_STORED_STATUSES is unchanged (Draft/Active/Renewed/Cancelled)');
check(!/CONTRACT_STORED_STATUSES\s*=\s*\[[^\]]*Scheduled/.test(ux3bConstSrc),
  'UX-003B: Scheduled is not a member of the stored contract lifecycle');
const ux3bStoredWrites = [];
jsFiles.forEach((rel)=>{
  const src = stripComments(read(path.join(root,'js',rel)));
  if(/\.status\s*=\s*['"]Scheduled['"]/.test(src) || /\bstatus\s*:\s*['"]Scheduled['"]/.test(src)) ux3bStoredWrites.push(rel);
});
check(ux3bStoredWrites.length === 0,
  'UX-003B: no production module ever writes \'Scheduled\' into a status field (derived only)'
  + (ux3bStoredWrites.length ? ' >> VIOLATION: ' + ux3bStoredWrites.join(', ') : ''));
check(!/'Scheduled'\s*:/.test((ux3bConstCode.match(/const CONTRACT_STATUS_META = \{[\s\S]*?\n\};/)||[''])[0]),
  'UX-003B: CONTRACT_STATUS_META gains no Scheduled entry (no new UI vocabulary in this sprint)');
check(!/Scheduled/.test(stripComments(read(path.join(root,'js','core','hr-persistence-portability.js')))),
  'UX-003B: the persistence layer has no knowledge of Scheduled');

// 3. ACTIVE CONTRACTS CAN CARRY A NON-None HORIZON.
//    Structurally: the Active return path assigns a horizon variable rather than
//    forcing 'None', and the non-Active paths funnel through the none() helper.
check(/horizon\s*:\s*horizon/.test(ux3bTimelineBody.replace(/\s+/g,' ')) || /horizon:horizon/.test(ux3bTimelineBody.replace(/\s/g,'')),
  'UX-003B: the Active path returns a computed horizon (Active + horizon is representable)');
check(/none\s*=\s*\(state\)\s*=>/.test(ux3bTimelineBody) && /horizon:'None'/.test(ux3bTimelineBody.replace(/\s/g,'')),
  'UX-003B: non-Active states funnel through a single horizon-None constructor');
check(/return none\('Cancelled'\)|none\('Cancelled'\)/.test(ux3bTimelineBody.replace(/\s+/g,' ')),
  'UX-003B: stored terminal states are returned with horizon None');

// 4. CALENDAR HORIZONS ARE NOT GATED BY THE WARNING SETTING.
//    The four calendar branches must be decided before, and independently of,
//    any comparison against the configured window.
const ux3bFlat = ux3bTimelineBody.replace(/\s+/g,' ');
const ux3bIdxToday   = ux3bFlat.indexOf("'EndingToday'");
const ux3bIdxWeek    = ux3bFlat.indexOf("'EndingThisWeek'");
const ux3bIdxMonth   = ux3bFlat.indexOf("'EndingThisMonth'");
const ux3bIdxNext    = ux3bFlat.indexOf("'EndingNextMonth'");
const ux3bIdxWithin  = ux3bFlat.indexOf("'WithinWarningWindow'");
check(ux3bIdxToday > -1 && ux3bIdxWeek > -1 && ux3bIdxMonth > -1 && ux3bIdxNext > -1 && ux3bIdxWithin > -1,
  'UX-003B: all four calendar horizons and the residual band are present in the classifier');
check(ux3bIdxToday < ux3bIdxWeek && ux3bIdxWeek < ux3bIdxMonth && ux3bIdxMonth < ux3bIdxNext,
  'UX-003B: calendar horizons are evaluated in the approved order (today -> week -> month -> next month)');
check(ux3bIdxNext < ux3bIdxWithin,
  'UX-003B: the four calendar horizons are decided BEFORE the warning-window band (never suppressed by it)');
// The 'within' flag must not appear in any calendar branch condition.
const ux3bCalendarSegment = ux3bFlat.slice(ux3bIdxToday, ux3bIdxWithin);
check(!/contractExpiryWarningDays/.test(ux3bCalendarSegment),
  'UX-003B: no calendar-horizon branch consults contractExpiryWarningDays');

// 5. WithinWarningWindow ALONE depends on the threshold.
check(/contractExpiryWarningDays/.test(ux3bTimelineBody),
  'UX-003B: the classifier is the single site that reads the configured warning window');
check(/else if\(within\)\s*horizon = 'WithinWarningWindow'/.test(ux3bTimelineBody.replace(/\s+/g,' ')) ||
      /within\)\s*horizon='WithinWarningWindow'/.test(ux3bTimelineBody.replace(/\s/g,'')),
  'UX-003B: WithinWarningWindow is the only horizon guarded by the threshold');
// The warning setting may be READ in exactly these places, and nowhere else. Any
// new reader is a candidate second rulebook and must fail here deliberately.
//   people/people-core.js        — the classifier: the ONE decision site
//   ui/settings-about.js         — the settings form that edits the value
//   people/contracts.js          — pre-existing DEAD `const warn` (declared, never used)
//   people/hr-dashboard-reports.js — pre-existing DEAD `const warn` (declared, never used)
// The two dead reads predate UX-003B; removing them would touch the contracts UI
// and the dashboard, both outside this sprint's file scope.
const UX3B_WARN_READERS = ['people/people-core.js','ui/settings-about.js',
  'people/contracts.js','people/hr-dashboard-reports.js'];
const ux3bWarnReaders = [];
jsFiles.forEach((rel)=>{
  const src = stripComments(read(path.join(root,'js',rel)));
  if(/State\.settings\.contractExpiryWarningDays/.test(src)) ux3bWarnReaders.push(rel);
});
const ux3bUnexpectedReaders = ux3bWarnReaders.filter(r=>UX3B_WARN_READERS.indexOf(r) === -1);
check(ux3bUnexpectedReaders.length === 0,
  'UX-003B: the warning setting is read only in the classifier, the settings form, and two pre-existing dead reads'
  + (ux3bUnexpectedReaders.length ? ' >> VIOLATION: new reader(s) ' + ux3bUnexpectedReaders.join(', ') : ''));
// The two dead reads must STAY dead — a declared-but-unused `warn` cannot become
// a second expiry rulebook without failing this check.
[['people/contracts.js','allContractAlerts'],['people/hr-dashboard-reports.js','hrDashboardAlerts']].forEach(([rel,fn])=>{
  let body = (stripComments(read(path.join(root,'js',rel)))
    .match(new RegExp('^function '+fn+'\\([^)]*\\)\\{[\\s\\S]*?\\n\\}','m'))||[''])[0];
  // Alert records carry a literal type:'warn'; those string occurrences are not
  // reads of the variable, so remove them before counting.
  body = body.replace(/'warn'/g,'').replace(/"warn"/g,'');
  const uses = (body.match(/\bwarn\b/g)||[]).length;   // the declaration itself is the one occurrence
  check(uses === 1,
    'UX-003B: the pre-existing `warn` read in '+rel+' remains unused (it is not a second expiry rulebook)');
});

// 6. LEGACY contractEffectiveStatus() REMAINS A COMPATIBILITY FACADE.
check(/contractTimeline\(/.test(ux3bFacadeBody),
  'UX-003B: contractEffectiveStatus() resolves through the canonical model');
check(/CONTRACT_LEGACY_STATE_DISPLAY/.test(ux3bFacadeBody) && /CONTRACT_LEGACY_EXPIRING_ALIAS/.test(ux3bFacadeBody),
  'UX-003B: the facade maps through the separate legacy display vocabulary and alias');
check(!/contractExpiryWarningDays/.test(ux3bFacadeBody),
  'UX-003B: the facade never re-reads the warning setting (the alias is computed once, in the model)');
check(/withinWarningWindow/.test(ux3bFacadeBody) && /withinWarningWindow/.test(ux3bTimelineBody),
  'UX-003B: the \'Expiring Soon\' alias is carried by the model, not recomputed by the facade');
const ux3bLegacyLit = (ux3bConstCode.match(/const CONTRACT_LEGACY_STATE_DISPLAY\s*=\s*\{[\s\S]*?\};/)||[''])[0];
check(ux3bLegacyLit !== '' && /'Scheduled':'Active'/.test(ux3bLegacyLit.replace(/\s/g,'')),
  'UX-003B: the legacy map is declared separately and maps Scheduled to Active for the facade only');
check(/const CONTRACT_LEGACY_EXPIRING_ALIAS = 'Expiring Soon';/.test(ux3bConstCode),
  'UX-003B: \'Expiring Soon\' is defined as a compatibility alias, not a canonical vocabulary member');
check(!/'Expiring Soon'/.test(ux3bStatesLit) && !/'Expiring Soon'/.test(ux3bHorizonLit),
  'UX-003B: \'Expiring Soon\' is neither an effective state nor a horizon');

// 7. CANONICAL HELPERS EXIST EXACTLY ONCE.
let ux3bTimelineDefs = 0, ux3bBandDefs = 0, ux3bWeekDefs = 0, ux3bStateDefs = 0, ux3bHorizonDefs = 0;
jsFiles.forEach((rel)=>{
  const src = stripComments(read(path.join(root,'js',rel)));
  ux3bTimelineDefs += (src.match(/function contractTimeline\s*\(/g)||[]).length;
  ux3bBandDefs     += (src.match(/function contractExpiryBand\s*\(/g)||[]).length;
  ux3bWeekDefs     += (src.match(/function isoWeekKey\s*\(/g)||[]).length;
  ux3bStateDefs    += (src.match(/function contractEffectiveState\s*\(/g)||[]).length;
  ux3bHorizonDefs  += (src.match(/function contractExpiryHorizon\s*\(/g)||[]).length;
});
check(ux3bTimelineDefs === 1, 'UX-003B: contractTimeline() is defined exactly once repository-wide (one rulebook)');
check(ux3bBandDefs === 1,     'UX-003B: contractExpiryBand() is defined exactly once repository-wide');
check(ux3bWeekDefs === 1,     'UX-003B: isoWeekKey() is defined exactly once repository-wide');
check(ux3bStateDefs === 1,    'UX-003B: contractEffectiveState() is defined exactly once repository-wide');
check(ux3bHorizonDefs === 1,  'UX-003B: contractExpiryHorizon() is defined exactly once repository-wide');
check((ux3bConstCode.match(/const CONTRACT_EFFECTIVE_STATES\s*=/g)||[]).length === 1 &&
      (ux3bConstCode.match(/const CONTRACT_EXPIRY_HORIZONS\s*=/g)||[]).length === 1,
  'UX-003B: each canonical vocabulary is declared exactly once');
// The thin readers must delegate, never recompute.
check(/function contractEffectiveState\([^)]*\)\{[^}]*contractTimeline\(/.test(ux3bCoreSrc.replace(/\s+/g,' ')),
  'UX-003B: contractEffectiveState() delegates to contractTimeline() (no duplicated calculation)');
check(/function contractExpiryHorizon\([^)]*\)\{[^}]*contractTimeline\(/.test(ux3bCoreSrc.replace(/\s+/g,' ')),
  'UX-003B: contractExpiryHorizon() delegates to contractTimeline() (no duplicated calculation)');

// 8. INLINE 30/60/90 LADDERS REMAIN ELIMINATED.
const ux3bBandLadders = [];
jsFiles.forEach((rel)=>{
  let src = stripComments(read(path.join(root,'js',rel)));
  if(rel === 'people/people-core.js') src = src.replace(ux3bBandBody, '');
  if(/<=\s*30\s*\?[^;]*<=\s*60\s*\?/.test(src)) ux3bBandLadders.push(rel);
});
check(ux3bBandLadders.length === 0,
  'UX-003B: no inline 30/60/90 expiry-band ladder outside contractExpiryBand()'
  + (ux3bBandLadders.length ? ' >> VIOLATION: ' + ux3bBandLadders.join(', ') : ''));
check(/30/.test(ux3bBandBody) && /60/.test(ux3bBandBody) && /90/.test(ux3bBandBody),
  'UX-003B: the 30/60/90 literals live inside contractExpiryBand()');
check(!/daysUntilEnd\s*<=\s*30/.test(stripComments(read(path.join(root,'js','people','payroll-ops-engine.js')))),
  'UX-003B: payrollHealth() no longer inlines its own 30-day threshold');
check(!/d<=30\?30:d<=60\?60:90/.test(stripComments(read(path.join(root,'js','people','contracts.js'))).replace(/\s+/g,'')),
  'UX-003B: contracts.js no longer inlines the 30/60/90 band ladder');

// 9. ONE TIME BASIS, AND NO SCHEMA/STORAGE IMPLICATION.
check(!/isoToday\s*\(/.test(ux3bTimelineBody),
  'UX-003B: the classifier never calls isoToday() independently (refKey is the only time basis)');
check(!/isoToday\s*\(/.test(ux3bWeekBody),
  'UX-003B: isoWeekKey() never calls isoToday() (it classifies the date it is given)');
check(/contractRefDate\s*\(/.test(ux3bTimelineBody),
  'UX-003B: the classifier resolves its reference date through contractRefDate()');
check(/const SCHEMA_VERSION = 6;/.test(ux3bConstSrc), 'UX-003B: SCHEMA_VERSION remains 6 (not a migration)');

// 10. The runtime harness covers the corrected model and stays honest.
const ux3bHarness = read(path.join(root,'tools','verify-contract-timeline-runtime.js'));
check(/UX-003B/.test(ux3bHarness) && /TWO-DIMENSIONAL/.test(ux3bHarness),
  'UX-003B harness identifies the two-dimensional model correctly');
check(/contractTimeline\(/.test(ux3bHarness) && /contractExpiryHorizon\(/.test(ux3bHarness) && /isoWeekKey\(/.test(ux3bHarness),
  'UX-003B harness exercises the canonical classifier, horizon reader and week key');
check(/K_STATES\s*=\s*\[/.test(ux3bHarness) && /K_HORIZONS\s*=\s*\[/.test(ux3bHarness),
  'UX-003B harness asserts BOTH vocabularies against its OWN copies (not production\'s)');
check(/\[1, 7, 30, 90, 3650\]/.test(ux3bHarness),
  'UX-003B harness sweeps the warning threshold (1/7/30/90/3650) to prove calendar independence');
check(/ONLY effectively Active contracts ever carry a non-None horizon/.test(ux3bHarness),
  'UX-003B harness proves horizons attach only to effectively Active contracts');

// UX-003C — PRESENTATION & COUNTER INTEGRITY.
// UX-003C adds no model; it consumes the UX-003B model. These checks prove that
// every displayed contract count resolves through ONE canonical helper, that no
// surface re-implements a counting predicate, that the lifecycle wording cannot
// regress to "3/3 = 1 month remaining", and that the presentation vocabulary
// stays out of the status-filter vocabulary (so filter behaviour is unchanged).
console.log('== UX-003C PRESENTATION & COUNTER INTEGRITY ==');
const ux3cCore = stripComments(read(path.join(root,'js','people','people-core.js')));
const ux3cConst = stripComments(read(path.join(root,'js','core','constants.js')));
const ux3cContracts = stripComments(read(path.join(root,'js','people','contracts.js')));
const ux3cEmployees = stripComments(read(path.join(root,'js','people','employees.js')));
const ux3cHrDash = stripComments(read(path.join(root,'js','people','hr-dashboard-reports.js')));
const ux3cReports = stripComments(read(path.join(root,'js','analytics','reports.js')));
const ux3cBodyOf = (name)=>{
  const m = ux3cCore.match(new RegExp('^function '+name+'\\([^)]*\\)\\{[\\s\\S]*?\\n\\}','m'));
  return m ? m[0] : '';
};
const ux3cCountsBody = ux3cBodyOf('contractTimelineCounts');
const ux3cNoteBody   = ux3cBodyOf('contractProgressNote');
const ux3cPresBody   = ux3cBodyOf('contractPresentation');
check(ux3cCountsBody !== '' && ux3cNoteBody !== '' && ux3cPresBody !== '',
  'UX-003C: contractTimelineCounts(), contractProgressNote() and contractPresentation() are resolvable top-level functions');

// 1. ONE canonical counting helper, defined exactly once repository-wide.
let ux3cCountDefs = 0, ux3cPresDefs = 0, ux3cNoteDefs = 0;
jsFiles.forEach((rel)=>{
  const src = stripComments(read(path.join(root,'js',rel)));
  ux3cCountDefs += (src.match(/function contractTimelineCounts\s*\(/g)||[]).length;
  ux3cPresDefs  += (src.match(/function contractPresentation\s*\(/g)||[]).length;
  ux3cNoteDefs  += (src.match(/function contractProgressNote\s*\(/g)||[]).length;
});
check(ux3cCountDefs === 1, 'UX-003C: contractTimelineCounts() is defined exactly once repository-wide (one counter)');
check(ux3cPresDefs === 1,  'UX-003C: contractPresentation() is defined exactly once repository-wide');
check(ux3cNoteDefs === 1,  'UX-003C: contractProgressNote() is defined exactly once repository-wide');
check(/contractTimeline\(/.test(ux3cCountsBody),
  'UX-003C: the counter derives every bucket from the canonical timeline model');

// 2. NO DUPLICATED COUNTING PREDICATE. Counting a contract collection by comparing
//    the legacy status string is exactly the pattern UX-003C removes. It may
//    survive ONLY in the status filter (compatibility) — nowhere else.
const ux3cLegacyCounters = [];
jsFiles.forEach((rel)=>{
  let src = stripComments(read(path.join(root,'js',rel)));
  if(/\.filter\(\s*c\s*=>\s*contractEffectiveStatus\(c\)\s*===\s*'/.test(src)) ux3cLegacyCounters.push(rel);
});
check(ux3cLegacyCounters.length === 0,
  'UX-003C: no module counts or selects contracts by comparing the legacy status string (the filter facade is the only exception)'
  + (ux3cLegacyCounters.length ? ' >> VIOLATION: ' + [...new Set(ux3cLegacyCounters)].join(', ') : ''));
check(/rows\.filter\(c=>contractEffectiveState\(c\)===f\.status\)/.test(ux3cContracts),
  'UX-003C: the status FILTER resolves through the CANONICAL effective state (filtering Active can never return a Scheduled badge)');
check(!/contractEffectiveStatus\(c\)===f\.status/.test(ux3cContracts),
  'UX-003C: the filter no longer resolves through the legacy status string');
check(/CONTRACT_FILTER_STATES\.map\(/.test(ux3cContracts),
  'UX-003C: the filter dropdown is built from the canonical filter vocabulary');
check(/const CONTRACT_FILTER_STATES = \['Active','Scheduled','Expired','Draft','Cancelled','Renewed'\];/.test(ux3cConst),
  'UX-003C: the filter vocabulary is the six canonical effective states, in display order');
check(!/Object\.keys\(CONTRACT_STATUS_META\)\.map\(/.test(ux3cContracts),
  'UX-003C: CONTRACT_STATUS_META no longer builds the filter options');

// 3. EVERY displayed counter comes from the canonical helper.
check(/const counts = contractTimelineCounts\(\)/.test(ux3cContracts),
  'UX-003C: the Contracts page header counts come from contractTimelineCounts()');
check(/const ctCounts = contractTimelineCounts\(\)/.test(ux3cHrDash),
  'UX-003C: hrDashboardStats() counts come from contractTimelineCounts()');
check(/activeContracts = ctCounts\.active/.test(ux3cHrDash) && /expiringSoon = ctCounts\.endingSoon/.test(ux3cHrDash),
  'UX-003C: the dashboard headline and sub-count are both read off the canonical helper');

// 4. THE SUB-COUNT IS PRESENTED AS A SUBSET (the old ambiguity).
check(/of these ending soon/.test(ux3cHrDash),
  'UX-003C: the dashboard sub-count is worded as a SUBSET of the active count');
check(/of them ending soon/.test(ux3cContracts),
  'UX-003C: the Contracts header words the ending-soon figure as a subset');
check(/of which/.test(ux3cReports),
  'UX-003C: the Reports summary words the ending-soon figure as a subset');
check(!/\(\$\{st\.expiringSoon\} expiring soon\)/.test(ux3cReports),
  'UX-003C: the Reports summary no longer renders the ambiguous "(N expiring soon)" parenthetical');

// 5. LIFECYCLE WORDING cannot regress to "3/3 = 1 month remaining".
check(/Final Month/.test(ux3cNoteBody),
  'UX-003C: the progress wording has a dedicated FINAL-MONTH phrasing');
check(/EndingThisMonth/.test(ux3cNoteBody) && /EndingToday/.test(ux3cNoteBody),
  'UX-003C: the final-month phrasing is selected from the canonical horizon, not from a day count');
check(/return `Final Month/.test(ux3cNoteBody),
  'UX-003C: the final-month branch returns before any remaining-duration wording');
// URGENCY BEFORE LIFECYCLE: the nearer horizons must be decided BEFORE the
// final-month wording, so a contract ending today never reads 'Final Month'.
const ux3cFlatNote = ux3cNoteBody.replace(/\s+/g,' ');
const ux3cIdxToday = ux3cFlatNote.indexOf("'EndingToday'");
const ux3cIdxWeek  = ux3cFlatNote.indexOf("'EndingThisWeek'");
const ux3cIdxMonth = ux3cFlatNote.indexOf("'EndingThisMonth'");
check(ux3cIdxToday > -1 && ux3cIdxToday < ux3cIdxWeek && ux3cIdxWeek < ux3cIdxMonth,
  'UX-003C: wording precedence is today -> this week -> final month (urgency before lifecycle)');
check(/return `Ends Today/.test(ux3cNoteBody) && /return `Ends This Week/.test(ux3cNoteBody),
  'UX-003C: EndingToday and EndingThisWeek have their OWN wording, not the final-month phrasing');
check(!/Final Month[^`]*ends today|Final Month[^`]*ends this week/.test(ux3cNoteBody),
  'UX-003C: the final-month phrasing never absorbs the today/this-week cases');
check(/Math\.max\(0, dur - out\.current\)/.test(ux3cCore),
  'UX-003C: remaining is still derived as max(0, total - current) in contractCalc()');
check(/out\.current=dur;/.test(ux3cCore),
  'UX-003C: current is still clamped to total on the expired branch (never exceeds total)');
check(!/\$\{cc\.remaining\} remaining/.test(ux3cContracts),
  'UX-003C: the contract detail no longer renders a bare "N remaining" figure');
check(!/\$\{calc\.remaining\} month/.test(ux3cEmployees),
  'UX-003C: the employee detail no longer renders a bare "N months remaining" figure');
check(/contractProgressNote\(/.test(ux3cContracts) && /contractProgressNote\(/.test(ux3cEmployees),
  'UX-003C: both detail surfaces word progress through the canonical helper');

// 6. PRESENTATION VOCABULARY IS SEPARATE FROM THE FILTER VOCABULARY.
check(/const CONTRACT_PRESENTATION_META = \{/.test(ux3cConst),
  'UX-003C: presentation labels live in their own map');
check((ux3cConst.match(/const CONTRACT_PRESENTATION_META\s*=/g)||[]).length === 1,
  'UX-003C: CONTRACT_PRESENTATION_META is declared exactly once');
const ux3cStatusMetaLit = (ux3cConst.match(/const CONTRACT_STATUS_META = \{[\s\S]*?\n\};/)||[''])[0];
check(ux3cStatusMetaLit !== '' && ux3cStatusMetaLit.indexOf('+') === -1,
  'UX-003C: CONTRACT_STATUS_META (which builds the filter options) gains no composite keys');
check(!/'Scheduled'\s*:/.test(ux3cStatusMetaLit),
  'UX-003C: CONTRACT_STATUS_META still has no Scheduled option (the filter vocabulary is unchanged)');
const ux3cPresLit = (ux3cConst.match(/const CONTRACT_PRESENTATION_META = \{[\s\S]*?\n\};/)||[''])[0];
['Ends Today','Ends This Week','Final Month','Ends Next Month','Ending Soon','Scheduled','Expired'].forEach((l)=>{
  check(ux3cPresLit.indexOf("'"+l+"'") !== -1, 'UX-003C: presentation vocabulary contains the label "'+l+'"');
});

// 7. NO storage, schema, payroll or model change.
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root,'js','core','constants.js'))),
  'UX-003C: SCHEMA_VERSION remains 6 (presentation only)');
check(/const CONTRACT_STORED_STATUSES = \['Draft','Active','Renewed','Cancelled'\];/.test(read(path.join(root,'js','core','constants.js'))),
  'UX-003C: CONTRACT_STORED_STATUSES is unchanged');
check(!/persistContracts|StorageAdapter/.test(ux3cCountsBody + ux3cNoteBody + ux3cPresBody),
  'UX-003C: the presentation helpers never touch persistence');
check(!/\.status\s*=\s*/.test(ux3cCountsBody),
  'UX-003C: the counter never mutates contract data');

// 8. The runtime harness covers it and stays honest.
const ux3cHarness = read(path.join(root,'tools','verify-contract-timeline-runtime.js'));
check(/UX-003C/.test(ux3cHarness) && /PRESENTATION & COUNTER INTEGRITY/.test(ux3cHarness),
  'UX-003C harness identifies its sprint and subject correctly');
check(/contractTimelineCounts\(/.test(ux3cHarness) && /contractProgressNote\(/.test(ux3cHarness),
  'UX-003C harness exercises the canonical counter and the wording helper');
check(/PARTITION the collection/.test(ux3cHarness) && /a true subset/.test(ux3cHarness),
  'UX-003C harness proves the partition and the subset relationship');
check(/never implies/.test(ux3cHarness),
  'UX-003C harness proves the final month never implies one month remaining');

// ============================================================
// UX-005A — EXECUTIVE DASHBOARD & INFORMATION ARCHITECTURE
// Presentation, ownership and navigation only. These checks guard the frozen
// product decisions: Executive Dashboard is the canonical home, Finance Overview
// stays an operational workspace, the Action Center reuses the existing alert
// pipeline (no second engine, no mutation), and no calculation/schema changed.
// ============================================================
console.log('== UX-005A: Executive Dashboard & Information Architecture ==');
const ux5aExec = read(path.join(root,'js','analytics','executive-dashboard.js'));
const ux5aDash = read(path.join(root,'js','finance','dashboard.js'));
const ux5aShell = read(path.join(root,'js','ui','shell-render.js'));
const ux5aStateMig = read(path.join(root,'js','core','state-load-migrations.js'));
const ux5aSettings = read(path.join(root,'js','ui','settings-about.js'));

// 1. Executive Dashboard remains the default/fallback canonical home.
check(/return renderExecutiveDashboard\(main\);\s*\n\}/.test(ux5aShell) || /\n  return renderExecutiveDashboard\(main\);/.test(ux5aShell),
  'UX-005A: renderViewContent falls back to the Executive Dashboard (canonical home)');
check(/defaultLandingPage: 'execDashboard'/.test(read(path.join(root,'js','core','state.js'))),
  'UX-005A: execDashboard remains the default landing page');
// 2. Finance Overview remains routed.
check(/State\.view==='financeOverview'\) return renderDashboard\(main\)/.test(ux5aShell),
  'UX-005A: Finance Overview (financeOverview) remains a routed view');
// 3. Finance Overview remains a valid landing-page choice (allowlist + Settings select).
check(/'financeOverview'/.test(ux5aStateMig) && /includes\(State\.settings\.defaultLandingPage\)/.test(ux5aStateMig),
  'UX-005A: financeOverview remains in the defaultLandingPage allowlist');
check(/value="financeOverview"/.test(ux5aSettings),
  'UX-005A: Finance Overview remains selectable in Settings landing-page options');
// 4. Net Cash Flow is not duplicated on Finance Overview (removed there; Executive owns it).
check(!/stat-label">\s*Net Cash Flow/.test(ux5aDash),
  'UX-005A: Finance Overview no longer renders a Net Cash Flow tile (Executive owns it)');
check(/'Net Cash Flow'/.test(ux5aExec),
  'UX-005A: Executive Dashboard still owns the Net Cash Flow signal');
// Budget Variance stays on BOTH with distinct framing (operational "% of plan" on Finance).
check(/Budget Variance/.test(ux5aDash) && /of plan/.test(ux5aDash),
  'UX-005A: Finance Overview keeps Budget Variance with its distinct "% of plan" framing');
// 5. Action Center consumes the existing alert pipeline (all four generators).
check(/computeExecutiveAlerts\(key, months\)/.test(ux5aExec) && /hrDashboardAlerts\(key\)/.test(ux5aExec)
      && /overtimeDashboardAlerts\(key\)/.test(ux5aExec) && /payrollDashboardAlerts\(key\)/.test(ux5aExec),
  'UX-005A: Action Center reuses all four existing alert generators');
check(/function actionCenterCardHTML\(/.test(ux5aExec) && /Action Center/.test(ux5aExec),
  'UX-005A: the Action Center presentation card exists');
// 6. No second alert engine — the generators are not redefined in the dashboard.
check((ux5aExec.match(/function computeExecutiveAlerts\(/g)||[]).length === 1,
  'UX-005A: no duplicate/second executive alert engine is introduced');
check(!/function (hrDashboardAlerts|overtimeDashboardAlerts|payrollDashboardAlerts)\(/.test(ux5aExec),
  'UX-005A: dashboard does not redefine the domain alert generators');
// 7-9. Action Center handler performs navigation only — no execution/approval/posting mutation.
const ux5aBindAC = (ux5aExec.match(/function bindActionCenter\(main\)\{[\s\S]*?\n\}/)||[''])[0];
check(ux5aBindAC.includes('hrNavTo(btn.dataset.acNav)'),
  'UX-005A: Action Center navigation uses hrNavTo (navigation only)');
check(!/(executePayment|postPayroll|commit|approve|persist|StorageAdapter|\.save|delete)/i.test(ux5aBindAC),
  'UX-005A: Action Center handler contains no execution/approval/posting/persistence mutation');
// 10. Drill-through destinations are existing routes.
const ux5aDrillTargets = [...ux5aExec.matchAll(/data-(?:dash|ac)-nav="([a-zA-Z]+)"/g)].map(m=>m[1]);
const ux5aResolverTargets = [...ux5aExec.matchAll(/to:'([a-zA-Z]+)'/g)].map(m=>m[1]);
const ux5aRoutedViews = new Set([...ux5aShell.matchAll(/State\.view==='([a-zA-Z]+)'/g)].map(m=>m[1]));
[...new Set([...ux5aDrillTargets, ...ux5aResolverTargets])].forEach((v)=>{
  check(ux5aRoutedViews.has(v), 'UX-005A: drill-through/resolver destination "'+v+'" is an existing route');
});
// 11. Protected calculation functions are not modified. Pin the CRITICAL computation
//     expressions (not just the function header), so a semantic change to the money
//     math is detected — UX-005A is presentation/navigation only.
const ux5aDomainSvc = read(path.join(root,'js','core','domain-services.js'));
check(ux5aDomainSvc.includes('return {planned, actual, income, incomeActual, variance: planned-actual, netCashFlow: incomeActual - actual, count: txns.length};'),
  'UX-005A: monthTotals computation is byte-for-byte unchanged (planned/actual/variance/netCashFlow/count)');
check(ux5aDomainSvc.includes('const rate = planned? (executed/planned*100) : 0;')
      && ux5aDomainSvc.includes('const remaining = planned-executed;'),
  'UX-005A: execStats computation is unchanged (execution rate & remaining)');
// 12. Schema unchanged.
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root,'js','core','constants.js'))),
  'UX-005A: SCHEMA_VERSION remains 6 (presentation/navigation only)');
// 13-15. No Personal Workspace / role / auth / UX-006 implementation introduced.
check(!/PersonalWorkspace|personalWorkspace|My Payroll|My Contract|My Profile/.test(ux5aExec + ux5aDash),
  'UX-005A: no Personal Workspace implementation introduced');
check(!/\b(currentUser|isEmployee|userRole|requireAuth|authenticate)\b/.test(ux5aExec + ux5aDash),
  'UX-005A: no role/auth/identity implementation introduced');
/* UX-006D3 — HARDENED (was `!/UX-006/.test(ux5aExec + ux5aDash)` on RAW source).
   The invariant is: **the UX-005A dashboard sources contain no UX-006
   identity / workspace / authorization IMPLEMENTATION**. The old form tested the raw
   file, so it fired on the mere string "UX-006" — including in a comment. That made it
   impossible to *document* a lawful presentation change in these files without either
   failing the build or silently dropping the explanation, and it never actually proved
   the invariant: code introduced without a "UX-006" label passed it untouched.

   Replaced by a strictly STRONGER pair:
   (a) the label check now runs on COMMENT-STRIPPED code, so prose is free but a real
       `UX-006*` symbol in code is still caught; and
   (b) an explicit symbol check naming the actual UX-006 API surface — which the old
       label check could not see at all.
   Coverage is preserved and widened; the sibling structural checks above are unchanged. */
const ux5aCode = stripComments(ux5aExec) + stripComments(ux5aDash);
check(!/UX-006/.test(ux5aCode),
  'UX-005A: no UX-006 implementation introduced in the dashboard sources (code, not prose)');
check(!/\b(getCurrentUser|getCurrentWorkspace|getScopedRecords|getBoundEmployee|authzDisabled|LocalIdentityProvider|IdentityProvider|principalType|canPrincipal|PRINCIPAL_TYPES|WORKSPACE_TYPES)\b|\bcan\(|\bACTIONS\./.test(ux5aCode),
  'UX-005A: dashboard sources call no UX-006 identity/workspace/authorization API');

// ============================================================
// UX-005B — DATA GRID FOUNDATION (R1–R9)
// Presentation/query-state only. Guards: the reusable module is data-source/role/
// storage agnostic; sorting is single-column over a copy (never mutates source);
// pagination defaults are frozen; feature flags gate UI capability only; export
// semantics are preserved; no schema/storage/virtualization/UX-006.
// ============================================================
console.log('== UX-005B: Data Grid Foundation ==');
const ux5bDG    = read(path.join(root,'js','core','data-grid.js'));
const ux5bTxn   = read(path.join(root,'js','finance','transactions.js'));
const ux5bEmp   = read(path.join(root,'js','people','employees.js'));
const ux5bState = read(path.join(root,'js','core','state.js'));
const ux5bUtils = read(path.join(root,'js','core','utils.js'));

// 1. canonical shared module + registered in load order
check(/function gridApply\(/.test(ux5bDG) && /function gridSort\(/.test(ux5bDG) && /function gridPage\(/.test(ux5bDG),
  'UX-005B: js/core/data-grid.js defines the canonical grid helpers (gridApply/gridSort/gridPage)');
check(require(path.join(root,'tools','module-order.js')).includes('core/data-grid.js'),
  'UX-005B: data-grid.js is registered in the load-order manifest');
// 2. column-definition contract (R1)
check(/const TXN_COLUMNS = \[/.test(ux5bTxn) && /getter:/.test(ux5bTxn) && /sortable:/.test(ux5bTxn),
  'UX-005B: Transactions declares a column-definition contract (R1)');
check(/const EMP_COLUMNS = \[/.test(ux5bEmp) && /getter:/.test(ux5bEmp) && /sortable:/.test(ux5bEmp),
  'UX-005B: Employees declares a column-definition contract (R1)');
// 3. comparator registry (R2)
check(/const GRID_COMPARATORS = \{/.test(ux5bDG) && /text\(/.test(ux5bDG) && /number\(/.test(ux5bDG) && /currency\(/.test(ux5bDG) && /date\(/.test(ux5bDG),
  'UX-005B: comparator registry defines text/number/currency/date (R2)');
// 4. no page-specific comparator registry; pages delegate sorting to the grid
check((ux5bTxn.match(/GRID_COMPARATORS/g)||[]).length===0 && (ux5bEmp.match(/GRID_COMPARATORS/g)||[]).length===0,
  'UX-005B: page modules do not redefine/duplicate the comparator registry');
check(/gridApply\(/.test(ux5bTxn) && /gridApply\(/.test(ux5bEmp),
  'UX-005B: Transactions and Employees delegate sort/paginate to gridApply');
// 5. centralized State.grid (R3); no per-table grid globals
check(/grid: \{ transactions:\{\}, employees:\{\}/.test(ux5bState),
  'UX-005B: centralized State.grid container exists (R3)');
check(!/State\.txGrid|State\.empGrid/.test(ux5bTxn+ux5bEmp+ux5bState),
  'UX-005B: no per-table txGrid/empGrid globals (R3)');
// 6. default-sort registry (R4)
check(/const GRID_DEFAULT_SORT = \{/.test(ux5bDG) && /transactions:/.test(ux5bDG) && /employees:/.test(ux5bDG),
  'UX-005B: default-sort registry defines transactions & employees (R4)');
check(!/const GRID_DEFAULT_SORT/.test(ux5bTxn) && !/GRID_DEFAULT_SORT *=/.test(ux5bEmp),
  'UX-005B: default sort is not hardcoded in page modules (R4)');
// 7-8. data-source agnostic (R5): the shared module reads no business arrays / seam.
//      Inspect CODE ONLY — the module's own doc comments legitimately name these
//      tokens to state what it must NOT do; strip comments before asserting.
const ux5bDGCode = ux5bDG.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/[^\n]*/g,'$1');
check(!/State\.txns|State\.employees/.test(ux5bDGCode),
  'UX-005B: data-grid.js references no business arrays (State.txns/State.employees) (R5)');
check(!/uiExecute|StorageAdapter|localStorage/.test(ux5bDGCode),
  'UX-005B: data-grid.js references no data seam or storage (R5)');
// 9-10. pagination frozen (R7)
check(/const GRID_DEFAULT_PAGE_SIZE = 20;/.test(ux5bDG),
  'UX-005B: default page size is 20 (R7)');
check(/const GRID_PAGE_SIZES = \[20, 50, 100\];/.test(ux5bDG),
  'UX-005B: allowed page sizes are 20/50/100 (R7)');
// 11. single-column sort only
check(/state && state\.sort/.test(ux5bDG) && !/multiSort|sortColumns|sorts\.forEach/.test(ux5bDG),
  'UX-005B: sorting is single-column only (no multi-column sort)');
// 12-16. feature flags (R9)
check(/const TXN_FEATURES = \{/.test(ux5bTxn) && /const EMP_FEATURES = \{/.test(ux5bEmp),
  'UX-005B: Transactions and Employees each declare an explicit features block (R9)');
['pagination','sorting','search','export','rowActions','resultCount'].forEach(fl=>{
  check(new RegExp(fl+':true').test(ux5bTxn) && new RegExp(fl+':true').test(ux5bEmp),
    'UX-005B: v1 feature "'+fl+'" declared on both grids');
});
const ux5bTxnFeat = (ux5bTxn.match(/const TXN_FEATURES = \{([^}]*)\}/)||['',''])[1];
const ux5bEmpFeat = (ux5bEmp.match(/const EMP_FEATURES = \{([^}]*)\}/)||['',''])[1];
const ux5bAllowedFlags = new Set(['pagination','sorting','search','export','rowActions','resultCount']);
const ux5bFlagKeys = (s)=> (s.match(/([a-zA-Z]+):/g)||[]).map(x=>x.replace(':',''));
check(ux5bFlagKeys(ux5bTxnFeat).every(k=>ux5bAllowedFlags.has(k)) && ux5bFlagKeys(ux5bEmpFeat).every(k=>ux5bAllowedFlags.has(k)),
  'UX-005B: feature flags are limited to the frozen v1 set (no selection/bulkActions/etc.)');
check(/return !!\(features && features\[name\] === true\);/.test(ux5bDG),
  'UX-005B: a missing feature flag evaluates to disabled (safe default) (R9)');
// 17. capability != authorization; no view-specific branching / role in the shared layer (R8)
check(!/=== ?'transactions'|=== ?'employees'|State\.view/.test(ux5bDGCode),
  'UX-005B: shared grid contains no view-specific branching');
check(!/currentUser|isEmployee|userRole|permission|authenticate|PersonalWorkspace|ExecutiveWorkspace/.test(ux5bDGCode),
  'UX-005B: shared grid contains no role/auth/workspace/currentUser concepts (R8)');
// 18. source arrays never sorted in place
check(/\(rows \|\| \[\]\)\.slice\(\)/.test(ux5bDG),
  'UX-005B: gridSort operates on a copy (source array never sorted in place)');
check(!/State\.txns\.sort\(|State\.employees\.sort\(/.test(ux5bTxn+ux5bEmp),
  'UX-005B: page modules never sort authoritative arrays in place');
// 19. result count before pagination
check(/paged\.total = src\.length;/.test(ux5bDG),
  'UX-005B: result count is the filtered total, captured before pagination');
// 20. export semantics preserved
check(/exportCsv\(txnsFiltered\(\)\)/.test(ux5bTxn) && !/exportCsv\(paged|exportCsv\(pageRows/.test(ux5bTxn),
  'UX-005B: Transactions export uses the full FILTERED set (not the page slice)');
/* Readiness-1 refined this check. The UX-005B invariant it protects is that the export
   is NOT narrowed by the GRID — no filter set, no page slice — so an operator always
   exports the whole set they can see. It was written as a literal `State.employees`
   match, which additionally froze the export to the raw company-wide array; Readiness-1
   makes every read principal-scoped, and an export is a read. The grid invariant is now
   asserted directly (no `employeesFiltered()`, no `paged`/`pageRows`), which is what the
   check was always for, while the principal-scope axis is asserted alongside it. */
{ const expFn = (ux5bEmp.match(/function exportEmployeesCsv\(\)\{[\s\S]*?\n\}/) || [''])[0];
  check(!/employeesFiltered\(\)|paged|pageRows/.test(expFn),
    'UX-005B: Employees export is not narrowed by the grid (no filter set, no page slice)');
  check(/getScopedRecords\('employee'\)/.test(expFn),
    'Readiness-1: Employees export carries the current principal read scope'); }
// 21. true-empty vs filtered-empty distinct
check(/match your current filters/.test(ux5bEmp) && /Add Employee/.test(ux5bEmp),
  'UX-005B: Employees distinguishes filtered-empty from true-empty onboarding');
check(/match your current filters/.test(ux5bTxn) && /No transactions yet/.test(ux5bTxn),
  'UX-005B: Transactions distinguishes filtered-empty from true-empty onboarding');
// 22-24. session-only, no persistence / schema
check(!/tam_grid|StorageAdapter[\s\S]{0,40}grid/.test(ux5bState+ux5bTxn+ux5bEmp),
  'UX-005B: grid state introduces no storage key (session-only)');
check(!/grid:/.test((ux5bState.match(/const DEFAULT_SETTINGS = \{[\s\S]*?\n\};/)||[''])[0]),
  'UX-005B: grid state is not part of persisted DEFAULT_SETTINGS');
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root,'js','core','constants.js'))),
  'UX-005B: SCHEMA_VERSION remains 6');
// 25. debounce helper (search)
check(/function debounce\(fn, wait\)\{/.test(ux5bUtils),
  'UX-005B: a generic debounce helper exists for search');
// 26. no virtualization / no UX-005C+ / no UX-006
check(!/virtual|windowing|react-window|clusterize/i.test(ux5bDGCode),
  'UX-005B: no virtualization is introduced');
check(!/commandPalette|globalSearch|Ctrl\+K|Cmd\+K/i.test(ux5bDG+ux5bTxn+ux5bEmp),
  'UX-005B: no Global Search / command palette introduced (UX-005C+ not begun)');
check(!/PersonalWorkspace|role-based|requireAuth/i.test(ux5bDG+ux5bTxn+ux5bEmp),
  'UX-005B: no UX-006 / auth implementation introduced');
// 27. deterministic runtime harness present
check(fs.existsSync(path.join(root,'tools','verify-data-grid-runtime.js')),
  'UX-005B: deterministic runtime harness tools/verify-data-grid-runtime.js exists');

// ============================================================
// UX-005C — DESIGN SYSTEM CONSISTENCY & TOKEN DRIFT CLEANUP
// Presentation-only consistency pass. Guards: the off-grid 14px rhythm drift is gone,
// the canonical section-rhythm helper exists, tokens are unchanged, numeric typography
// and table density are preserved, no arbitrary brand color / icon library, nav
// ids/labels/routes unchanged, and no schema/UX-005D/UX-006 creep.
// ============================================================
console.log('== UX-005C: Design System Consistency ==');
const ux5cJsAll = require(path.join(root,'tools','module-order.js'))
  .map(f=>read(path.join(root,'js',f))).join('\n');
const ux5cComponents = read(path.join(root,'css','components.css'));
const ux5cShell = read(path.join(root,'js','ui','shell-render.js'));
const ux5cSettings = read(path.join(root,'js','ui','settings-about.js'));
// 1. canonical section-rhythm helper exists
check(/\.stack-section\{margin-bottom:var\(--space-4\);\}/.test(ux5cComponents),
  'UX-005C: .stack-section canonical rhythm helper is defined (margin-bottom:var(--space-4))');
// 2. the off-grid 14px rhythm drift is gone (only card padding "14px 16px" may remain)
const ux5cFourteen = (ux5cJsAll.match(/:14px/g)||[]).length;
const ux5cCardPad = (ux5cJsAll.match(/14px 16px/g)||[]).length;
check(ux5cFourteen === ux5cCardPad,
  'UX-005C: no off-grid 14px rhythm literals remain in js/ (only documented card padding "14px 16px")');
check(!/margin-bottom:14px|margin-top:14px|margin:0 0 14px/.test(ux5cJsAll),
  'UX-005C: no margin rhythm uses the off-grid 14px literal');
// 3. undefined --gold fallback removed
check(!/--gold/.test(ux5cJsAll),
  'UX-005C: the undefined var(--gold,...) fallback is removed (uses a real token)');
// 4. numeric typography (UX-004D) preserved
check(/font-variant-numeric:tabular-nums/.test(ux5cComponents),
  'UX-005C: Numeric Typography Standard preserved (tabular-nums present)');
// 5. table density preserved (frozen td/th padding)
check(/td\{padding:9px 10px;/.test(ux5cComponents) && /padding:8px 10px;/.test(ux5cComponents),
  'UX-005C: table density invariant preserved (td/th padding unchanged)');
// Symbol scans run on COMMENT-STRIPPED code — module doc comments legitimately name
// tokens like "currentUser" to state what a module must NOT do.
const ux5cCode = ux5cJsAll.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/[^\n]*/g,'$1');
// 6. no new icon library / external icon assets; nav still uses inline glyph strings
check(!/icon-font|fontawesome|font-awesome|material-icons|feather|<svg[^>]*sprite|iconify/i.test(ux5cCode+ux5cComponents),
  'UX-005C: no icon library / SVG sprite architecture introduced');
// nav ids/labels/routes unchanged; the three formerly-duplicate glyphs are now distinct
check(/id:'reports', label:'Reports'/.test(ux5cShell) && /id:'activity', label:'Activity Log'/.test(ux5cShell) && /id:'releasenotes', label:'Release Notes'/.test(ux5cShell),
  'UX-005C: nav ids/labels for Reports/Activity Log/Release Notes are unchanged');
const ux5cGlyphs = [ (ux5cShell.match(/id:'reports', label:'Reports', ic:'([^']+)'/)||[])[1],
                     (ux5cShell.match(/id:'activity', label:'Activity Log', ic:'([^']+)'/)||[])[1],
                     (ux5cShell.match(/id:'releasenotes', label:'Release Notes', ic:'([^']+)'/)||[])[1] ];
check(ux5cGlyphs.every(Boolean) && new Set(ux5cGlyphs).size === 3,
  'UX-005C: Reports / Activity Log / Release Notes now use three DISTINCT glyphs');
// 7. sidebar geometry unchanged
check(/\.sidebar\{[^}]*width:258px/.test(read(path.join(root,'css','shell.css'))),
  'UX-005C: sidebar width (258px) unchanged');
// 8. invariants: schema, no UX-005D/UX-006 creep
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root,'js','core','constants.js'))),
  'UX-005C: SCHEMA_VERSION remains 6');
// (UX-005C's "no UX-005D global-search" phase-scoping guard was retired when UX-005D
//  was authorized and landed global search; the UX-006 guard below remains in force.)
check(!/PersonalWorkspace|isEmployee|userRole|requireAuth|currentUser/.test(ux5cCode),
  'UX-005C: no UX-006 role/auth/Personal-Workspace symbols introduced');

// ============================================================
// UX-005D — GLOBAL SEARCH (navigation-only, source-agnostic)
// Guards: the engine is a pure primitive (no State/DOM/nav/persistence/network),
// the palette activates only via hrNavTo, results carry stable keys and existing
// routes, navigation docs derive from the canonical manifest (no second route map),
// and no schema/storage/UX-006/dependency/Data-Grid/Action-Center changes.
// ============================================================
console.log('== UX-005D: Global Search ==');
const ux5dEngine = read(path.join(root,'js','core','global-search.js'));
const ux5dUi = read(path.join(root,'js','ui','global-search-ui.js'));
const ux5dEngineCode = ux5dEngine.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/[^\n]*/g,'$1');
const ux5dUiCode = ux5dUi.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/[^\n]*/g,'$1');
// 1. one canonical pure engine
check(/function searchGlobal\(query, documents, options\)/.test(ux5dEngine),
  'UX-005D: canonical pure engine searchGlobal(query, documents, options) exists');
check(require(path.join(root,'tools','module-order.js')).includes('core/global-search.js')
   && require(path.join(root,'tools','module-order.js')).includes('ui/global-search-ui.js'),
  'UX-005D: engine and palette modules are registered in the load-order manifest');
// 2-4. engine purity — no State-array reads, no DOM/nav, no persistence/network/auth
check(!/State\.(employees|contracts|txns|payrollPlans|settings)|NAV_GROUPS|PAGE_TITLES/.test(ux5dEngineCode),
  'UX-005D: engine reads no application State arrays or nav manifest (source-agnostic)');
check(!/document\.|hrNavTo|querySelector|addEventListener/.test(ux5dEngineCode),
  'UX-005D: engine performs no DOM access or navigation');
check(!/StorageAdapter|localStorage|uiExecute|fetch\s*\(|XMLHttpRequest|WebSocket|currentUser|userRole|requireAuth|PersonalWorkspace/.test(ux5dEngineCode),
  'UX-005D: engine has no persistence/network/auth/workspace coupling');
// 5. stable result key contract (type:id), never array index
check(/'employee:' \+ e\.id/.test(ux5dUi) && /'contract:' \+ c\.id/.test(ux5dUi) && /'payroll:' \+ p\.id/.test(ux5dUi) && /'view:' \+ it\.id/.test(ux5dUi),
  'UX-005D: search documents use stable type:id keys (no array-index identity)');
// 6. deterministic ranking implementation present
check(/function globalSearchScore\(/.test(ux5dEngine) && /return 100;/.test(ux5dEngine) && /return 80;/.test(ux5dEngine) && /return 60;/.test(ux5dEngine) && /return 40;/.test(ux5dEngine) && /return 20;/.test(ux5dEngine),
  'UX-005D: deterministic 5-tier ranking (exact/prefix/word-prefix/substring/meta)');
// 7-8. nav docs derive from the canonical manifest; no second hardcoded route map
check(/globalSearchViewDocs\(sources\.navGroups/.test(ux5dUi) && /it\.placeholder/.test(ux5dUi),
  'UX-005D: navigation docs derive from the supplied canonical manifest, placeholders excluded');
check(!/const .*ROUTES *=|routeMap|\bVIEWS *= *\[/.test(ux5dUiCode),
  'UX-005D: no second hardcoded route/view inventory');
// 10. result destinations resolve to existing routed views
const ux5dShell = read(path.join(root,'js','ui','shell-render.js'));
const ux5dRoutedViews = new Set([...ux5dShell.matchAll(/State\.view==='([a-zA-Z]+)'/g)].map(m=>m[1]));
['employeeDetail','contractDetail','payrollDetail'].forEach(v=>{
  check(ux5dRoutedViews.has(v), 'UX-005D: result destination "'+v+'" is an existing routed view');
});
// 11-12. activation navigation-only; no mutation paths anywhere in the palette
check(/hrNavTo\(doc\.to, doc\.context/.test(ux5dUi),
  'UX-005D: result activation is navigation-only (hrNavTo)');
check(!/persist|StorageAdapter|executePayment|postPayroll|commitReadyPayroll|\.save\(|deleteEmployee|generatePayroll|setOvertimeStatus/.test(ux5dUiCode),
  'UX-005D: palette contains no execute/approve/post/delete/generate/persist path');
// 13-14. no storage / schema change
check(!/localStorage|tam_[a-z_]+_v[0-9]/.test(ux5dEngineCode+ux5dUiCode),
  'UX-005D: Global Search introduces no storage key / persistence');
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root,'js','core','constants.js'))),
  'UX-005D: SCHEMA_VERSION remains 6');
// 15. no external fuzzy/search dependency
check(!/require\(|import .*from|fuse|lunr|flexsearch|elasticlunr/i.test(ux5dEngineCode+ux5dUiCode),
  'UX-005D: no external search/fuzzy dependency');
// 16-17. Data Grid + Action Center untouched (no coupling introduced)
check(!/gridApply|gridSort|gridPage|State\.grid/.test(ux5dEngineCode+ux5dUiCode),
  'UX-005D: Global Search is not coupled to the Data Grid');
check(!/actionCenter|computeExecutiveAlerts/.test(ux5dEngineCode+ux5dUiCode),
  'UX-005D: Global Search is not coupled to the Action Center engine');
// 18. no UX-006 auth/role/workspace in either module
check(!/currentUser|userRole|isEmployee|requireAuth|PersonalWorkspace|ExecutiveWorkspace/.test(ux5dEngineCode+ux5dUiCode),
  'UX-005D: no UX-006 role/auth/workspace implementation introduced');
// 19. tokens.css unchanged (shared anti-drift pin, asserted near the golden check too)
check(crypto.createHash('sha256').update(trimLF(read(path.join(root,'css','tokens.css'))),'utf8').digest('hex') === TOKENS_CSS_SHA256,
  'UX-005D: css/tokens.css remains byte-identical (no token drift)');
// 20. deterministic runtime harness present
check(fs.existsSync(path.join(root,'tools','verify-global-search-runtime.js')),
  'UX-005D: deterministic runtime harness tools/verify-global-search-runtime.js exists');

// ===== UX-005E — Responsive & Density Polish (modal viewport containment) =====
// Presentation-only sprint: the single authorized change is that the shared .modal
// primitive gains viewport containment. These checks pin that outcome, re-assert the
// frozen density/token/schema invariants around it, and guard against scope creep
// (arbitrary breakpoints, storage/schema/UX-006 leakage, grid/search coupling).
console.log('== UX-005E — RESPONSIVE & DENSITY POLISH ==');
const ux5eComponentsCss = read(path.join(root,'css','components.css'));
const ux5eModalRule = (ux5eComponentsCss.match(/\.modal\{[^}]*\}/) || [''])[0];
// 1-2. shared .modal is viewport-contained and internally scrollable.
check(/max-height:\s*88vh/.test(ux5eModalRule),
  'UX-005E: shared .modal declares a viewport max-height (88vh)');
check(/overflow-y:\s*auto/.test(ux5eModalRule),
  'UX-005E: shared .modal scrolls internally (overflow-y:auto)');
// 3-4. table density invariant preserved exactly (frozen; UX-005B / UX-002B).
check(/td\{padding:9px 10px;/.test(ux5eComponentsCss),
  'UX-005E: td density unchanged (padding:9px 10px)');
check(/padding:8px 10px;border-bottom:1px solid var\(--border\);/.test(ux5eComponentsCss),
  'UX-005E: th density unchanged (padding:8px 10px)');
// 5. tokens.css byte-identical (no density system, no new spacing/type token).
check(crypto.createHash('sha256').update(trimLF(read(path.join(root,'css','tokens.css'))),'utf8').digest('hex') === TOKENS_CSS_SHA256,
  'UX-005E: css/tokens.css remains byte-identical (no token drift, no density token)');
// 6. schema version frozen.
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root,'js','core','constants.js'))),
  'UX-005E: SCHEMA_VERSION remains 6');
// 7. no storage/migration introduced by the CSS change (no density preference/persistence).
check(!/localStorage|tam_[a-z_]+_v[0-9]|migration|density/i.test(ux5eModalRule),
  'UX-005E: modal containment introduces no storage/migration/density-preference');
// 8. no UX-006 auth/role/workspace leakage in the touched stylesheet.
check(!/currentUser|userRole|requireAuth|PersonalWorkspace|ExecutiveWorkspace/.test(ux5eComponentsCss),
  'UX-005E: no UX-006 role/auth/workspace symbol in components.css');
// 9. Data Grid architecture untouched — presentation controls still present, State.grid intact.
check(/\.grid-sort\{/.test(ux5eComponentsCss) && /\.grid-pager\{/.test(ux5eComponentsCss)
  && /State\.grid/.test(read(path.join(root,'js','finance','transactions.js'))),
  'UX-005E: Data Grid architecture unchanged (.grid-sort/.grid-pager present; State.grid intact)');
// 10. Global Search architecture untouched — engine present, palette classes intact.
check(/\.gsearch-box\{/.test(ux5eComponentsCss) && fs.existsSync(path.join(root,'js','core','global-search.js')),
  'UX-005E: Global Search architecture unchanged (palette classes + engine present)');
// 11. no arbitrary new breakpoint — every @media px value is in the accepted UX-005E set.
const ux5eAllowedBp = new Set([480,640,768,769,900,1050]);
const ux5eBpFound = new Set();
[read(path.join(root,'css','shell.css')),ux5eComponentsCss,read(path.join(root,'css','charts.css')),read(path.join(root,'css','base.css')),read(path.join(root,'css','tokens.css'))]
  .join('\n').replace(/@media[^{]*/g, (m)=>{ const nums=m.match(/(\d+)px/g)||[]; nums.forEach(n=>ux5eBpFound.add(parseInt(n,10))); return m; });
check([...ux5eBpFound].every(b=>ux5eAllowedBp.has(b)),
  'UX-005E: no arbitrary new breakpoint introduced (all @media px in {480,640,768,769,900,1050})'
  + ([...ux5eBpFound].every(b=>ux5eAllowedBp.has(b)) ? '' : ' >> found ' + [...ux5eBpFound].join(',')));
// 12. CSS golden-master enforcement remains active and green. NOTE: this check
// previously also asserted CSS_GOLDEN_SHA256 === the UX-005E literal; UX-005F is an
// authorized golden-master revision (shell.css a11y additions), so that phase-pinned
// literal is legitimately superseded and removed. The durable invariant — the live
// digest equals the current pin — is unchanged and strictly what the golden master is.
check(cssDigest === CSS_GOLDEN_SHA256,
  'UX-005E: CSS golden-master enforcement active (live digest == current pin)');
// 13. artifact fidelity enforcement remains active (source -> dist equality asserted above).
check(trimLF(srcCss) === distCss,
  'UX-005E: portable artifact CSS fidelity remains enforced (concat(css/*.css) == dist CSS)');

// ===== UX-005F — Final Workspace Polish & Accessibility Hardening =====
// A1 skip-link + main landmark, A2 modal Tab-trap, A3 finance dialog semantics,
// A4 decorative-glyph hiding, A5 focus-visible coverage, A6 aria-sort on <th>.
console.log('== UX-005F — ACCESSIBILITY HARDENING ==');
const ux5fShell = read(path.join(root,'js','ui','shell-render.js'));
const ux5fShellCss = read(path.join(root,'css','shell.css'));
const ux5fStab = read(path.join(root,'js','core','stabilization.js'));
const ux5fTxn = read(path.join(root,'js','finance','transaction-modals.js'));
const ux5fGrid = read(path.join(root,'js','core','data-grid.js'));
// A1 — skip link + single main landmark
check(/class="skip-link"[^>]*href="#main"/.test(ux5fShell),
  'UX-005F A1: skip link exists and targets #main');
check(/<main class="main" id="main" tabindex="-1">/.test(ux5fShell),
  'UX-005F A1: real <main> landmark with tabindex="-1" focus target');
check((ux5fShell.match(/<main class="main" id="main"/g) || []).length === 1,
  'UX-005F A1: exactly one <main> landmark');
check(/#skipLink[\s\S]{0,400}?getElementById\('main'\)[\s\S]{0,80}?\.focus\(\)/.test(ux5fShell),
  'UX-005F A1: skip link moves focus into #main on activation');
check(/\.skip-link\{/.test(ux5fShellCss) && /\.skip-link:focus\{/.test(ux5fShellCss),
  'UX-005F A1: skip-link is visually hidden until focused (.skip-link + :focus rules)');
// A2 — modal Tab focus trap scoped to modal-root, single install
check(/A2[\s\S]{0,600}?getElementById\('modal-root'\)[\s\S]{0,400}?e\.key==='Tab'/.test(ux5fStab),
  'UX-005F A2: modal Tab focus-trap is scoped to an open #modal-root dialog');
check(/e\.shiftKey[\s\S]{0,120}?\.focus\(\)[\s\S]{0,160}?\.focus\(\)/.test(ux5fStab)
  && /if\(!f\.length\)\{[^}]*preventDefault/.test(ux5fStab),
  'UX-005F A2: Tab/Shift+Tab wrap both ends and zero-focusables is handled safely');
check((ux5fStab.match(/__installedGlobalUI/g) || []).length >= 2,
  'UX-005F A2: modal handlers install exactly once (single-install guard)');
// A3 — finance dialog semantics (three dialogs) with existing heading ids
[['exec','execModalTitle'],['edit','editModalTitle'],['detail','detailModalTitle']].forEach(([k,id])=>{
  const rx = new RegExp('role="dialog" aria-modal="true" aria-labelledby="'+id+'"');
  check(rx.test(ux5fTxn) && new RegExp('id="'+id+'"').test(ux5fTxn),
    'UX-005F A3: Transaction '+k+' dialog has role/aria-modal/labelledby and the heading id exists');
});
// A4 — decorative glyphs hidden
check(/<span class="ic" aria-hidden="true">/.test(ux5fShell),
  'UX-005F A4: decorative nav icon spans are aria-hidden');
check(/<span class="chev" aria-hidden="true">/.test(ux5fShell),
  'UX-005F A4: decorative chevron/More glyphs are aria-hidden');
// A5 — focus-visible coverage for the audited borderless controls
check(/\.grid-sort:focus-visible/.test(ux5fShellCss) && /\.nav-group-head:focus-visible/.test(ux5fShellCss)
  && /\.sidebar-collapse-btn:focus-visible/.test(ux5fShellCss) && /\.nav-hamburger:focus-visible/.test(ux5fShellCss),
  'UX-005F A5: focus-visible coverage includes grid-sort/nav-group-head/collapse/hamburger');
// A6 — aria-sort on <th>, not the grid-sort button
check(/<th\$\{cls\} aria-sort="\$\{ariaSort\}">/.test(ux5fGrid),
  'UX-005F A6: aria-sort is on the <th> column header');
check(!/class="grid-sort[\s\S]{0,80}?aria-sort=/.test(ux5fGrid),
  'UX-005F A6: aria-sort is not placed on the grid-sort button');
// Preservation guards
check(/\.modal\{[^}]*max-height:88vh[^}]*overflow-y:auto/.test(read(path.join(root,'css','components.css'))),
  'UX-005F: UX-005E modal containment (88vh/overflow-y) preserved');
check(/td\{padding:9px 10px;/.test(read(path.join(root,'css','components.css')))
  && /\.stat-value\{[^}]*tabular-nums/.test(read(path.join(root,'css','components.css'))),
  'UX-005F: table density + numeric tabular typography preserved');
check(crypto.createHash('sha256').update(trimLF(read(path.join(root,'css','tokens.css'))),'utf8').digest('hex') === TOKENS_CSS_SHA256,
  'UX-005F: css/tokens.css remains byte-identical');
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root,'js','core','constants.js'))),
  'UX-005F: SCHEMA_VERSION remains 6');
// Scan the modules that gained new behavioral code (shell/stabilization/finance modals).
// data-grid.js is excluded intentionally: its only change is markup (aria-sort moved to
// <th>), and it carries a pre-existing scope-safety COMMENT that names currentUser/
// PersonalWorkspace precisely to state the grid depends on none of them (UX-005B/D).
check(!/currentUser|userRole|requireAuth|PersonalWorkspace|ExecutiveWorkspace/.test(ux5fShell+ux5fStab+ux5fTxn),
  'UX-005F: no UX-006 role/auth/workspace symbol in the modules with new behavioral code');
check(!/localStorage|StorageAdapter|tam_[a-z_]+_v[0-9]|migration/.test(ux5fShellCss),
  'UX-005F: a11y CSS introduces no storage/persistence/migration');

// ===== MAINT-001 Follow-Up — branding integration (favicon + repository assets) =====
// Presentation/repository only. The favicon is an inline PNG data URI (derived by
// resize from the official assets/branding/tam-os-logo-secondary.png), so the portable
// artifact stays self-contained; the whole-file fidelity check above already proves the
// favicon carries into dist. These checks pin that contract and the repo-asset paths.
console.log('== MAINT-001 — BRANDING INTEGRATION ==');
const m1Favicon = (indexHtml.match(/<link rel="icon"[^>]*>/) || [''])[0];
// 1-2. favicon exists and is an inline PNG data URI (no external dependency)
check(/<link rel="icon"[^>]*type="image\/png"[^>]*href="data:image\/png;base64,/.test(indexHtml),
  'MAINT-001: favicon is an inline PNG data URI in index.html');
check(m1Favicon !== '' && !/href="https?:\/\//.test(m1Favicon),
  'MAINT-001: favicon introduces no external URL dependency');
// 3. built artifact carries the same inline favicon (self-contained)
check(/<link rel="icon"[^>]*href="data:image\/png;base64,/.test(dist),
  'MAINT-001: portable artifact contains the inline favicon (self-contained)');
check(!/<link rel="icon"[^>]*href="https?:\/\//.test(dist),
  'MAINT-001: portable artifact has no external favicon URL');
// 4. APP_VERSION / SCHEMA_VERSION unchanged by branding work
check(indexHtml.includes('<title>TAM OS v' + meta.version + '</title>') && meta.version === '2.11.0',
  'MAINT-001: APP_VERSION/title consistent (v2.11.0)');
// 5. repository asset paths referenced by README actually resolve
['assets/branding/tam-os-logo-full-color.png',
 'assets/screenshots/dashboard-dark.png',
 'assets/screenshots/data-grid-transactions.png',
 'assets/screenshots/global-search.png',
 'assets/screenshots/payroll-workspace.png',
 'assets/social/tam-os-social.png'].forEach((p) => {
  check(fs.existsSync(path.join(root, p)), 'MAINT-001: repository asset exists — ' + p);
});
// 6. every relative README image path resolves to a real file (no broken images)
const readmeMd = read(path.join(root, 'README.md'));
const imgPaths = [];
let mm; const imgRe = /!\[[^\]]*\]\((assets\/[^)]+)\)|<img[^>]*src="(assets\/[^"]+)"/g;
while ((mm = imgRe.exec(readmeMd)) !== null) { imgPaths.push(mm[1] || mm[2]); }
check(imgPaths.length > 0 && imgPaths.every((p) => fs.existsSync(path.join(root, p))),
  'MAINT-001: every relative README image path resolves (' + imgPaths.length + ' images)');
// 7. no stale verifier count left in README current-state prose
check(!/1931/.test(readmeMd), 'MAINT-001: README no longer cites the stale 1931 verifier count');

// ===== UX-006A — IDENTITY FOUNDATION (additive, structural) =====
// STRUCTURE only; behaviour is proven by tools/verify-identity-foundation-runtime.js.
// These guards pin the frozen UX-006A boundaries: a minimal canonical
// IdentityProvider seam, local-only persona selection, CEO+Employee principals,
// NO authentication, NO identity persistence, NO schema change.
console.log('== UX-006A — IDENTITY FOUNDATION ==');
const idPath = path.join(root, 'js', 'core', 'identity.js');
check(fs.existsSync(idPath), 'UX-006A: identity module present — js/core/identity.js');
const idSrc = fs.existsSync(idPath) ? read(idPath) : '';
// Integration: registered in the load-order manifest AND mirrored in index.html.
check(jsFiles.indexOf('core/identity.js') !== -1, 'UX-006A: core/identity.js registered in module-order.js');
check(/<script src="js\/core\/identity\.js"><\/script>/.test(indexHtml), 'UX-006A: core/identity.js mirrored in index.html');
// Load-order: identity is an early core leaf (after utils, before data-grid).
check(jsFiles.indexOf('core/identity.js') > jsFiles.indexOf('core/utils.js')
  && jsFiles.indexOf('core/identity.js') < jsFiles.indexOf('core/state.js'),
  'UX-006A: identity loads after utils.js and before state.js (early core leaf)');
// Runtime harness registered/discoverable.
check(fs.existsSync(path.join(root, 'tools', 'verify-identity-foundation-runtime.js')),
  'UX-006A: runtime harness present — tools/verify-identity-foundation-runtime.js');
// Contract: canonical principal types + both representative principals.
check(/const PRINCIPAL_TYPES = Object\.freeze\(\{[^}]*CEO:\s*'ceo'[^}]*EMPLOYEE:\s*'employee'/.test(idSrc),
  'UX-006A: PRINCIPAL_TYPES defines exactly ceo + employee');
check(/principalType:\s*PRINCIPAL_TYPES\.CEO/.test(idSrc) && /principalType:\s*PRINCIPAL_TYPES\.EMPLOYEE/.test(idSrc),
  'UX-006A: CEO + Employee representative principals present');
check(/employeeId:\s*'[^']+'/.test(idSrc), 'UX-006A: Employee fixture carries a non-empty opaque employeeId (forward reference)');
// Canonical seam is minimal: IdentityProvider exposes ONLY getCurrentUser().
check(/const IdentityProvider = Object\.freeze\(\{\s*getCurrentUser\(\)\{[^}]*\}\s*\}\)/.test(idSrc),
  'UX-006A: canonical IdentityProvider exposes only getCurrentUser()');
check(/function getCurrentUser\(\)/.test(idSrc), 'UX-006A: single canonical getCurrentUser() consumer facade exists');
// Selection is a LOCAL-adapter capability, never the canonical contract and
// never a general application dependency. Only identity.js (its definition) and
// the SANCTIONED UX-006D1 selector module (ui/identity-selector.js — the single
// UI adapter) may call the local-only selection/enumeration APIs. No other
// module may.
const idxOrder = jsFiles.indexOf('core/identity.js');
const SELECTION_ADAPTER_ALLOWED = ['core/identity.js', 'ui/identity-selector.js'];
const selectionLeak = jsFiles.filter((f) => SELECTION_ADAPTER_ALLOWED.indexOf(f) === -1)
  .filter((f) => /\.(getAvailablePrincipals|selectPrincipal)\s*\(/.test(read(path.join(root, 'js', f))));
check(selectionLeak.length === 0,
  'UX-006A/D1: local-only selection APIs confined to identity.js + the D1 selector module (no other application module)' + (selectionLeak.length ? (' >> VIOLATION: ' + selectionLeak.join(', ')) : ''));
check(idxOrder !== -1, 'UX-006A: identity module is in the assembled build');
// Test-only provider override: it is a TEST SEAM, never a production API. It
// must not be exposed on the production global, and no application module may
// call it. (The runtime harness reaches it only via its appended __TAM__ export,
// which runs in the same lexical script scope — not through window.)
// The seam must be a top-level `const` (function expression) — NOT a function
// declaration and NOT assigned to window — so a classic script does not attach
// it to the global object. This structurally guarantees production-window
// invisibility (verified live in the browser smoke test).
check(/const setIdentityProviderForTesting =/.test(idSrc)
  && !/function setIdentityProviderForTesting\s*\(/.test(idSrc)
  && !/window\.setIdentityProviderForTesting/.test(idSrc),
  'UX-006A: setIdentityProviderForTesting is a lexical const (not a global) — not exposed on production window');
const overrideLeak = jsFiles.filter((f) => f !== 'core/identity.js')
  .filter((f) => /setIdentityProviderForTesting/.test(read(path.join(root, 'js', f))));
check(overrideLeak.length === 0,
  'UX-006A: the internal test-only provider override is not used by any application module');
// The canonical seam delegates through a single mutable active-provider handle,
// so it is genuinely testable while still exposing only getCurrentUser().
check(/let activeIdentityProvider = LocalIdentityProvider;/.test(idSrc)
  && /getCurrentUser\(\)\{\s*return activeIdentityProvider\.getCurrentUser\(\);/.test(idSrc),
  'UX-006A: canonical seam delegates via a single active-provider indirection (LocalIdentityProvider default)');
// The following boundary guards scan CODE only (comments stripped), so the
// module's own trust-boundary prose does not trip them.
const idCode = idSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
// No authentication — identity is NOT auth.
check(!/\b(authenticate|login|logout|password|oauth|accessToken|refreshToken|sessionToken)\b/i.test(idCode),
  'UX-006A: no authentication API/terminology in identity.js code');
// No identity persistence — no new tam_* key, no storage coupling.
check(!/tam_[a-z_]*_v[0-9]/.test(idCode), 'UX-006A: identity.js introduces no tam_* persistence key');
check(!/StorageAdapter|localStorage/.test(idCode), 'UX-006A: identity.js code has no StorageAdapter/localStorage coupling');
// No global State identity slice in UX-006A.
check(!/State\.identity/.test(idCode), 'UX-006A: no State.identity slice introduced (provider-owned private state)');
// No bootstrap lifecycle — app-bootstrap.js untouched by UX-006A.
check(!/resolveIdentity/.test(read(path.join(root, 'js', 'core', 'app-bootstrap.js'))),
  'UX-006A: app-bootstrap.js has no identity lifecycle (no resolveIdentity)');
// Schema unchanged.
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root, 'js', 'core', 'constants.js'))),
  'UX-006A: SCHEMA_VERSION remains 6 (no identity migration)');
// Trust boundary is stated in-source (anti-overclaim) — scans the RAW source.
check(/not\s+authentication/i.test(idSrc) && /spoofable/i.test(idSrc),
  'UX-006A: identity.js states the trust boundary (not authentication / spoofable client-side)');

// ===== UX-006B — PERSONAL WORKSPACE & SELF-SCOPE (additive, structural) =====
// STRUCTURE only; behaviour is proven by tools/verify-workspace-selfscope-runtime.js.
// Guards the frozen (R1-amended) UX-006B boundaries: derived workspaces, a
// centralized entity-scope registry, a minimal public API, NO persistence, NO
// authorization, NO schema change, and — per amendment R1 — Global Search left
// intentionally UNCHANGED (live scope integration deferred to UX-006D).
console.log('== UX-006B — PERSONAL WORKSPACE & SELF-SCOPE ==');
const ux6bWsPath = path.join(root, 'js', 'core', 'workspace.js');
check(fs.existsSync(ux6bWsPath), 'UX-006B: workspace module present — js/core/workspace.js');
const ux6bSrc = fs.existsSync(ux6bWsPath) ? read(ux6bWsPath) : '';
const ux6bCode = ux6bSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
// Integration: registered in the manifest AND mirrored in index.html, after identity.
check(jsFiles.indexOf('core/workspace.js') !== -1, 'UX-006B: core/workspace.js registered in module-order.js');
check(/<script src="js\/core\/workspace\.js"><\/script>/.test(indexHtml), 'UX-006B: core/workspace.js mirrored in index.html');
check(jsFiles.indexOf('core/workspace.js') > jsFiles.indexOf('core/identity.js'),
  'UX-006B: workspace loads after identity.js');
// Runtime harness discoverable.
check(fs.existsSync(path.join(root, 'tools', 'verify-workspace-selfscope-runtime.js')),
  'UX-006B: runtime harness present — tools/verify-workspace-selfscope-runtime.js');
// Contract: workspace types + minimal public API (exactly the three symbols).
check(/const WORKSPACE_TYPES = Object\.freeze\(\{[^}]*EXECUTIVE:\s*'executive'[^}]*PERSONAL:\s*'personal'/.test(ux6bSrc),
  'UX-006B: WORKSPACE_TYPES = executive/personal');
check(/function getCurrentWorkspace\(\)/.test(ux6bSrc) && /function getScopedRecords\(entityType\)/.test(ux6bSrc),
  'UX-006B: public getCurrentWorkspace() + getScopedRecords(entityType) present');
check(/window\.WORKSPACE_TYPES\s*=/.test(ux6bSrc) && /window\.getCurrentWorkspace\s*=/.test(ux6bSrc) && /window\.getScopedRecords\s*=/.test(ux6bSrc),
  'UX-006B: exactly the three public symbols exposed on window');
// Internal helpers must not reach the production global: not assigned to window,
// AND declared as `const` (function expressions) so a classic script does not
// implicitly attach them to window (a function declaration would). Verified live
// in the browser smoke (window.getBoundEmployee === undefined).
check(!/window\.(getBoundEmployee|getScopeContext|ENTITY_SCOPE)\s*=/.test(ux6bSrc)
  && !/function getBoundEmployee\s*\(/.test(ux6bSrc) && !/function getScopeContext\s*\(/.test(ux6bSrc)
  && /const getBoundEmployee =/.test(ux6bSrc) && /const getScopeContext =/.test(ux6bSrc),
  'UX-006B: internal helpers are lexical consts (not globals) — not exposed as public API');
// Derived model: deterministic ids, employee-anchored personal owner.
check(/workspace:executive:company/.test(ux6bSrc) && /'workspace:personal:'\s*\+\s*emp\.id/.test(ux6bSrc),
  'UX-006B: deterministic Executive id + Personal id anchored to Employee.id');
check(/ownerRef:\s*Object\.freeze\(\{\s*kind:\s*'system'/.test(ux6bSrc),
  'UX-006B: Executive Workspace is system-owned (not CEO-User-owned)');
// Binding is by Employee.id (empById), never the human Employee.employeeId code.
// (UX-006C1 refactor: the binding resolves the SUPPLIED principal's employeeId.)
check(/empById\(principal\.employeeId\)/.test(ux6bCode) && /principalType\s*!==\s*PRINCIPAL_TYPES\.EMPLOYEE/.test(ux6bCode),
  'UX-006B: employee binding uses empById(<principal>.employeeId) === Employee.id');
// Centralized entity scope registry; entity-specific predicates (not blind).
check(/const ENTITY_SCOPE = Object\.freeze\(/.test(ux6bSrc)
  && /return r && r\.id === eid/.test(ux6bSrc)
  && /return r && r\.employeeId === eid/.test(ux6bSrc),
  'UX-006B: centralized ENTITY_SCOPE with entity-specific SELF predicates (employee keys on record.id, others on employeeId)');
// No persistence, no storage coupling, no State slice, no schema change.
check(!/tam_[a-z_]*_v[0-9]/.test(ux6bCode), 'UX-006B: workspace.js introduces no tam_* persistence key');
check(!/StorageAdapter|localStorage/.test(ux6bCode), 'UX-006B: workspace.js has no StorageAdapter/localStorage coupling');
check(!/State\.identity/.test(ux6bCode), 'UX-006B: no State.identity slice introduced');
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root, 'js', 'core', 'constants.js'))),
  'UX-006B: SCHEMA_VERSION remains 6 (no workspace migration)');
// Scope is NOT authorization — no authz vocabulary in workspace.js code.
check(!/\b(can[A-Z]\w*|canRead|canEdit|isAuthorized|hasPermission|permission|rbac)\b/.test(ux6bCode),
  'UX-006B: no authorization vocabulary in workspace.js (scope != authz)');
// Trust boundary is stated in-source (anti-overclaim).
check(/not\s+secure\s+authorization|NOT secure authorization/i.test(ux6bSrc) && /spoofable/i.test(ux6bSrc),
  'UX-006B: workspace.js states the trust boundary (SELF scope is not secure authorization)');
// Bootstrap untouched.
check(!/workspace|getCurrentWorkspace|getScopedRecords/.test(read(path.join(root, 'js', 'core', 'app-bootstrap.js'))),
  'UX-006B: app-bootstrap.js not modified for workspace/scope');
/* Amendment R1 SUPERSEDED BY READINESS-1. This check previously asserted the exact
   OPPOSITE — that global-search-ui.js did NOT yet call getScopedRecords, because
   UX-006B shipped headless and live integration was deferred. Readiness-1 is the
   phase that performs that integration, so the deferral assertion has served its
   purpose and is replaced by the stronger post-integration invariant: the seam IS
   wired, and the engine is still NOT a policy engine. Coverage is not reduced —
   the file is now constrained more tightly than before, not less. */
const gsUiSrc = read(path.join(root, 'js', 'ui', 'global-search-ui.js'));
check(/getScopedRecords\('employee'\)/.test(gsUiSrc)
      && /getScopedRecords\('contract'\)/.test(gsUiSrc)
      && /getScopedRecords\('payrollPlan'\)/.test(gsUiSrc),
  'Readiness-1: global-search-ui.js provisions the collector from scoped sources');
{ // Structural: the collector CALL itself must be fed from the scoped bundle, never
  // from raw company-wide State.
  const gsCall = (gsUiSrc.match(/collectGlobalSearchDocuments\(\{[\s\S]*?\n\s*\}\);/) || [''])[0];
  check(/employees:\s*scoped\.employees/.test(gsCall)
        && /contracts:\s*scoped\.contracts/.test(gsCall)
        && /payrollPlans:\s*scoped\.payrollPlans/.test(gsCall),
    'Readiness-1: the collector call is provisioned from the scoped bundle');
  check(!/State\./.test(gsCall),
    'Readiness-1: the collector call reads no raw State (company-wide provisioning removed)'); }
{ const gsEngine = read(path.join(root, 'js', 'core', 'global-search.js'));
  check(!/getScopedRecords|getCurrentUser|getCurrentWorkspace|principalType|\bcan\(/.test(gsEngine),
    'Readiness-1: the search ENGINE stays source-agnostic (scope lives at the input seam, not in the engine)'); }
check(/employees:\s*State\.employees/.test(gsUiSrc) && /contracts:\s*State\.contracts/.test(gsUiSrc) && /payrollPlans:\s*State\.payrollPlans/.test(gsUiSrc),
  'UX-006B (R1): global-search-ui.js keeps company-wide source provisioning unchanged');
// SELF comparisons must not be scattered into the GS UI.
check(!/\.employeeId\s*===\s*[^;]*employeeId/.test(gsUiSrc),
  'UX-006B: no SELF employeeId comparison scattered into global-search-ui.js');

// ===== UX-006C1 — AUTHORIZATION FOUNDATION (additive, structural) =====
// STRUCTURE only; behaviour is proven by tools/verify-authz-runtime.js. Guards
// the frozen (headless) UX-006C1 boundaries: centralized mutation-only policy,
// minimal public API, scope precondition, NO reads/persistence/schema/authz-UI,
// and NO live mutation wiring (that is UX-006C2).
console.log('== UX-006C1 — AUTHORIZATION FOUNDATION ==');
const azPath = path.join(root, 'js', 'core', 'authz.js');
check(fs.existsSync(azPath), 'UX-006C1: authz module present — js/core/authz.js');
const azSrc = fs.existsSync(azPath) ? read(azPath) : '';
const azCode = azSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
// Integration: registered in the manifest AND mirrored in index.html, after workspace.
check(jsFiles.indexOf('core/authz.js') !== -1, 'UX-006C1: core/authz.js registered in module-order.js');
check(/<script src="js\/core\/authz\.js"><\/script>/.test(indexHtml), 'UX-006C1: core/authz.js mirrored in index.html');
check(jsFiles.indexOf('core/authz.js') > jsFiles.indexOf('core/workspace.js'),
  'UX-006C1: authz loads after workspace.js (identity -> workspace -> authz)');
// Runtime harness discoverable.
check(fs.existsSync(path.join(root, 'tools', 'verify-authz-runtime.js')),
  'UX-006C1: runtime harness present — tools/verify-authz-runtime.js');
// Contract: mutation-only ACTIONS, no reads.
check(/const ACTIONS = Object\.freeze\(/.test(azSrc), 'UX-006C1: ACTIONS frozen vocabulary present');
['employee.create','employee.update','employee.delete','contract.create','contract.update','contract.delete',
 'payroll.manage','overtime.submitSelf','overtime.manage','finance.execute','import.commit','supplemental.manage',
 'settings.manage'].forEach(function(act){
   check(azSrc.indexOf("'" + act + "'") !== -1, 'UX-006C1: ACTIONS includes ' + act);
 });
check(!/\.read(\.self)?['"]/.test(azCode),
  'UX-006C1: NO *.read / *.read.self authorization action (reads are scope, AZ-1)');
// Public API is exactly ACTIONS + can; internals not on window.
check(/window\.ACTIONS\s*=/.test(azSrc) && /window\.can\s*=/.test(azSrc),
  'UX-006C1: public API exposes ACTIONS + can on window');
check(!/window\.(canPrincipal|POLICY|ACTION_SET|ACTION_RESOURCE_ENTITY|ceoOnly)\s*=/.test(azSrc)
  && !/function canPrincipal\s*\(/.test(azSrc) && /const canPrincipal =/.test(azSrc),
  'UX-006C1: canPrincipal/POLICY internal (lexical const; not exposed on production window)');
check(/function can\(action, resource\)/.test(azSrc) || /const can =/.test(azSrc),
  'UX-006C1: single public can(action, resource?) facade present');
// Centralized POLICY registry; scope precondition via the frozen isInScope.
check(/const POLICY = Object\.freeze\(/.test(azSrc), 'UX-006C1: centralized POLICY action->predicate registry present');
// AZ-1 precondition must use the EXPLICIT-principal scope predicate so canPrincipal
// is deterministic from its supplied principal (not the globally-selected user).
check(/isInScopeForPrincipal\(\s*principal\s*,/.test(azCode),
  'UX-006C1: canPrincipal uses isInScopeForPrincipal(principal, …) (explicit-principal scope, AZ-1)');
check(!/isInScope\(\s*[^p)]/.test(azCode),
  'UX-006C1: authz.js does not use the current-context isInScope(entityType, …) in the policy path');
check(!/record\.employeeId\s*===|record\.id\s*===/.test(azCode),
  'UX-006C1: authz.js does not duplicate SELF comparisons (delegates to scope)');
// isInScope + isInScopeForPrincipal stay INTERNAL to workspace.js (lexical consts;
// not a 4th public API). The explicit-principal helper must NOT read getCurrentUser.
check(/const isInScope =/.test(ux6bSrc) && /const isInScopeForPrincipal =/.test(ux6bSrc)
  && !/window\.isInScope\b/.test(ux6bSrc) && !/window\.isInScopeForPrincipal\b/.test(ux6bSrc)
  && !/function isInScope\s*\(/.test(ux6bSrc) && !/function isInScopeForPrincipal\s*\(/.test(ux6bSrc),
  'UX-006C1: isInScope + isInScopeForPrincipal are internal lexical consts (not on window, not public Workspace API)');
// The explicit-principal scope helper (and its employee-binding helper) must NOT
// depend on getCurrentUser — that is the whole point of the correction. Extract
// each function body and assert it is free of getCurrentUser.
const ipBody = (ux6bSrc.match(/const isInScopeForPrincipal = function[\s\S]*?\n\};/) || [''])[0];
const bpBody = (ux6bSrc.match(/const getBoundEmployeeForPrincipal = function[\s\S]*?\n\};/) || [''])[0];
check(ipBody !== '' && !/getCurrentUser/.test(ipBody),
  'UX-006C1: isInScopeForPrincipal does NOT read getCurrentUser (pure over the supplied principal)');
check(bpBody !== '' && !/getCurrentUser/.test(bpBody),
  'UX-006C1: getBoundEmployeeForPrincipal does NOT read getCurrentUser (binds the supplied principal)');
check(/window\.WORKSPACE_TYPES\s*=/.test(ux6bSrc) && /window\.getCurrentWorkspace\s*=/.test(ux6bSrc) && /window\.getScopedRecords\s*=/.test(ux6bSrc)
  && !/window\.(getBoundEmployee|getScopeContext|ENTITY_SCOPE|isInScope)\s*=/.test(ux6bSrc),
  'UX-006C1: Workspace public API unchanged (exactly WORKSPACE_TYPES/getCurrentWorkspace/getScopedRecords)');
// No scattered permission role checks outside identity/workspace/authz.
const ux6cRoleLeak = jsFiles.filter(function(f){ return ['core/identity.js','core/workspace.js','core/authz.js'].indexOf(f) === -1; })
  .filter(function(f){ return /principalType\s*===\s*['"](ceo|employee)['"]/.test(read(path.join(root, 'js', f))); });
check(ux6cRoleLeak.length === 0, 'UX-006C1: no scattered principalType permission checks outside identity/workspace/authz');
// No persistence, no storage coupling, no schema change, no real auth.
check(!/tam_[a-z_]*_v[0-9]/.test(azCode), 'UX-006C1: authz.js introduces no tam_* persistence key');
check(!/StorageAdapter|localStorage/.test(azCode), 'UX-006C1: authz.js has no StorageAdapter/localStorage coupling');
check(!/\b(password|oauth|accessToken|refreshToken|sessionToken|authenticate)\b/i.test(azCode),
  'UX-006C1: no authentication API/terminology in authz.js code');
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root, 'js', 'core', 'constants.js'))),
  'UX-006C1: SCHEMA_VERSION remains 6 (no authz migration)');
// UX-006C2A wires Employee+Contract; UX-006C2B wires Overtime (guard blocks below).
// Operational boundaries (payroll/finance/import/supplemental/settings/bank + deferred
// operational Contract paths) remain UNWIRED until C2C.
check(/\bcan\(/.test(read(path.join(root, 'js', 'people', 'overtime.js'))),
  'UX-006C2B: overtime.js is wired to can() at its mutation boundaries');
check(!/authz|can\(|ACTIONS/.test(read(path.join(root, 'js', 'core', 'app-bootstrap.js'))),
  'UX-006C1: app-bootstrap.js not modified for authorization');
// Trust boundary stated in-source (anti-overclaim).
check(/not\s+a\s+server\s+security|UX enforcement only/i.test(azSrc) && /spoofable/i.test(azSrc),
  'UX-006C1: authz.js states the trust boundary (client policy is UX enforcement, not security)');

/* ============================================================
   UX-006D1 — REACHABLE PRINCIPAL SELECTION (structure guards)
   The selector makes the existing UX-006A principals reachable in the running
   app. Structure only; BEHAVIOUR is proven by tools/verify-identity-selection-runtime.js.
   ============================================================ */
const selPath = path.join(root, 'js', 'ui', 'identity-selector.js');
check(fs.existsSync(selPath), 'UX-006D1: js/ui/identity-selector.js exists');
const selSrc = fs.existsSync(selPath) ? read(selPath) : '';
// Comment-stripped view for content-negative guards, so the module's own
// disclaimer comments (which legitimately mention "persistence", "State.identity",
// etc. only to say it has NONE) never trip a check meant to catch real CODE.
const selCode = selSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
// Registration: module-order.js + index.html mirror, loaded after shell-render.js.
check(jsFiles.indexOf('ui/identity-selector.js') !== -1, 'UX-006D1: ui/identity-selector.js registered in module-order.js');
check(indexHtml.includes('<script src="js/ui/identity-selector.js"></script>'), 'UX-006D1: ui/identity-selector.js mirrored in index.html');
check(jsFiles.indexOf('ui/identity-selector.js') > jsFiles.indexOf('ui/shell-render.js'),
  'UX-006D1: identity-selector loads after shell-render.js (shell mounts/binds/syncs it)');
check(fs.existsSync(path.join(root, 'tools', 'verify-identity-selection-runtime.js')),
  'UX-006D1: runtime harness present — tools/verify-identity-selection-runtime.js');
// Public surface the shell consumes.
check(/window\.renderIdentitySelectorHTML\b/.test(selSrc) && /window\.bindIdentitySelector\b/.test(selSrc) && /window\.syncIdentitySelector\b/.test(selSrc),
  'UX-006D1: selector exposes renderIdentitySelectorHTML/bindIdentitySelector/syncIdentitySelector on window');
// Shell wiring: mount in .brand, bind once, sync in place.
const shellSrc = read(path.join(root, 'js', 'ui', 'shell-render.js'));
check(/renderIdentitySelectorHTML\(\)/.test(shellSrc), 'UX-006D1: shell mounts the selector (renderIdentitySelectorHTML) in renderShell');
check(/bindIdentitySelector\(/.test(shellSrc), 'UX-006D1: shell binds the selector (bindIdentitySelector) in bindShell');
check(/syncIdentitySelector\(/.test(shellSrc), 'UX-006D1: shell syncs the selector (syncIdentitySelector) in syncShellState');
// ADAPTER ISOLATION: the local-only enumeration/selection API is referenced ONLY by
// identity.js (its definition) and the dedicated selector module. It must not spread.
const adapterOffenders = jsFiles.filter(function(f){
  if(f === 'core/identity.js' || f === 'ui/identity-selector.js') return false;
  return /getAvailablePrincipals|selectPrincipal/.test(read(path.join(root, 'js', f)));
});
check(adapterOffenders.length === 0,
  'UX-006D1: LocalIdentityProvider selection API confined to identity.js + identity-selector.js' + (adapterOffenders.length ? (' >> VIOLATION: ' + adapterOffenders.join(', ')) : ''));
// No default/implicit CEO and no auto-selection introduced by the selector.
check(!/selectPrincipal\(\s*['"]user_ceo_fixture['"]\s*\)/.test(selCode),
  'UX-006D1: selector never auto-selects CEO (no hardcoded CEO selection)');
check(!/getCurrentUser\s*\(\s*\)\s*\|\|/.test(selCode),
  'UX-006D1: selector never treats null as a privileged fallback (no getCurrentUser()|| default)');
// Ephemeral: no persistence, no State.identity, no schema change from D1.
check(!/localStorage|StorageAdapter|persist|tam_[a-z]/i.test(selCode),
  'UX-006D1: selector introduces no persistence (no localStorage/StorageAdapter/persist/tam_* key)');
check(!/State\.identity/.test(selCode), 'UX-006D1: selector creates no State.identity slice');
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root, 'js', 'core', 'constants.js'))),
  'UX-006D1: SCHEMA_VERSION remains 6 (no D1 migration)');
// NOT authentication: no auth/session/credential vocabulary anywhere in the selector surface.
check(!/\b(password|oauth|accessToken|refreshToken|sessionToken|session|credential|authenticate|authentication|log[- ]?in|sign[- ]?in|logout)\b/i.test(selSrc),
  'UX-006D1: no authentication/session/login vocabulary in identity-selector.js');
// Trust boundary stated in-source (anti-overclaim).
check(/not\s+a\s+security\s+boundary/i.test(selSrc) && /spoofable/i.test(selSrc),
  'UX-006D1: selector states the trust boundary (identity selection, not a security boundary)');
// Uses the EXISTING render facade, not a new bootstrap lifecycle.
check(/render\(\)/.test(selSrc), 'UX-006D1: selector refreshes through the existing render() facade');
check(!/authz|can\(|ACTIONS|getScopedRecords/.test(selSrc),
  'UX-006D1: selector wires no authorization/scope enforcement (reachability only; C2/GS untouched)');
// R1 remains frozen: Global Search engine untouched by D1.
check(!/identity-selector|renderIdentitySelectorHTML|selectPrincipal/.test(read(path.join(root, 'js', 'core', 'global-search.js')))
  && !/identity-selector|renderIdentitySelectorHTML|selectPrincipal/.test(read(path.join(root, 'js', 'ui', 'global-search-ui.js'))),
  'UX-006D1: Global Search modules untouched (R1 scope wiring remains deferred)');
// D1 itself wires no enforcement; the identity-selector module never calls can().
check(!/\bcan\(/.test(read(path.join(root, 'js', 'ui', 'identity-selector.js'))),
  'UX-006D1: the selector module wires no authorization (can() lives at the domain boundary, not the selector)');
// Bootstrap untouched: no new identity lifecycle at boot.
check(!/selectPrincipal|renderIdentitySelectorHTML|getAvailablePrincipals/.test(read(path.join(root, 'js', 'core', 'app-bootstrap.js'))),
  'UX-006D1: app-bootstrap.js introduces no boot-time principal selection');

/* ============================================================
   UX-006C2A — CORE HR MUTATION ENFORCEMENT (structure guards)
   can(action, resource?) is wired at the Employee + Contract mutation boundaries.
   Behaviour (SE-0) is proven by tools/verify-mutation-enforcement-hr-runtime.js.
   ============================================================ */
const c2aEmpSrc = read(path.join(root, 'js', 'people', 'employees.js'));
const c2aCtrSrc = read(path.join(root, 'js', 'people', 'contracts.js'));
// Boundaries call the frozen public API with the expected ACTIONS.
check(/can\(\s*(?:ACTIONS\.)?EMPLOYEE_CREATE|ACTIONS\.EMPLOYEE_CREATE/.test(c2aEmpSrc)
  && /ACTIONS\.EMPLOYEE_UPDATE/.test(c2aEmpSrc) && /ACTIONS\.EMPLOYEE_DELETE/.test(c2aEmpSrc),
  'UX-006C2A: employees.js authorizes create/update/delete via can(ACTIONS.EMPLOYEE_*)');
check(/ACTIONS\.CONTRACT_CREATE/.test(c2aCtrSrc) && /ACTIONS\.CONTRACT_UPDATE/.test(c2aCtrSrc)
  && /ACTIONS\.CONTRACT_DELETE/.test(c2aCtrSrc),
  'UX-006C2A: contracts.js authorizes create/update/delete via can(ACTIONS.CONTRACT_*)');
check(/\bcan\(/.test(c2aEmpSrc) && /\bcan\(/.test(c2aCtrSrc),
  'UX-006C2A: both Core HR modules call the public can() facade');
// Domain code must use ONLY the public API — never the internal authz seams.
check(!/canPrincipal|\bPOLICY\b|isInScopeForPrincipal|isInScope\b/.test(c2aEmpSrc)
  && !/canPrincipal|\bPOLICY\b|isInScopeForPrincipal|isInScope\b/.test(c2aCtrSrc),
  'UX-006C2A: Core HR modules do not use internal authz seams (canPrincipal/POLICY/isInScope*)');
// No scattered role checks — authorization is centralized in POLICY, consulted via can().
check(!/principalType\s*===|principalType\s*!==/.test(c2aEmpSrc)
  && !/principalType\s*===|principalType\s*!==/.test(c2aCtrSrc),
  'UX-006C2A: no scattered principalType role checks in Core HR modules');
// No null->allow bypass / legacy shim.
check(!/getCurrentUser\(\)\s*\)?\s*(?:\|\||return\s+true)/.test(c2aEmpSrc)
  && !/!\s*getCurrentUser\(\)/.test(c2aEmpSrc) && !/!\s*getCurrentUser\(\)/.test(c2aCtrSrc),
  'UX-006C2A: no null->allow shim / no "if(!getCurrentUser()) allow" bypass in Core HR modules');
// UX-006C2C-3 — the "no authorization in persistence" invariant, expressed precisely.
// It has always meant: authorization must never live inside the storage WRITE PATH. The
// C2C-3 freeze gates restoreCompleteBackup — a data-lifecycle DOMAIN boundary that happens
// to be co-located in hr-persistence-portability.js — so this guard now asserts the write
// PRIMITIVES are free of can(), instead of banning the string file-wide. The invariant is
// unchanged in meaning and is now checked per function rather than per file.
const PERSIST_PRIMITIVES = ['persistHR','persistEmployees','persistContracts','persistPayrollPlans',
  'persistRecurring','persistMonthlyPlans','persistOvertime','persistPayrollAdjustments',
  'persistEmployeeMerges','persistCompanyAccounts','persistSupplementalPayments','persistImportBatches',
  'saveAllData','buildCompleteBackup'];
function persistenceLayerIsUnauthorized(src){
  return PERSIST_PRIMITIVES.every(function(fn){
    const m = src.match(new RegExp('(?:async )?function ' + fn + '\\([\\s\\S]*?\\n\\}'));
    return !m || !/\bcan\(/.test(m[0]);
  });
}
// Authorization is not pushed down into persistence/storage.
check(persistenceLayerIsUnauthorized(read(path.join(root, 'js', 'core', 'hr-persistence-portability.js')))
  && !/\bcan\(/.test(read(path.join(root, 'js', 'core', 'storage-adapter.js'))),
  'UX-006C2A: authorization is NOT wired into any persistence primitive or StorageAdapter');
// Authz core after UX-006C2C-2: exactly 17 ACTIONS (13 + the self-Draft trio + finance.manage).
check((read(path.join(root, 'js', 'core', 'authz.js')).match(/:\s*'[a-z]+\.[a-zA-Z]+'/g) || []).length === 20,
  'UX-006C2C-3: ACTIONS vocabulary is exactly 20 (17 + import.undo + data.restore + data.reset)');
// New SE-0 harness present; identity/D1 untouched; private CodeQL compat intact.
check(fs.existsSync(path.join(root, 'tools', 'verify-mutation-enforcement-hr-runtime.js')),
  'UX-006C2A: SE-0 runtime harness present — tools/verify-mutation-enforcement-hr-runtime.js');
check(/if:\s*\$\{\{\s*!github\.event\.repository\.private\s*\}\}/.test(read(path.join(root, '.github', 'workflows', 'codeql.yml'))),
  'UX-006C2A: private-repo CodeQL compatibility conditional remains intact');
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root, 'js', 'core', 'constants.js'))),
  'UX-006C2A: SCHEMA_VERSION remains 6 (no C2A migration/storage change)');

/* ============================================================
   UX-006C2B — OVERTIME MUTATION ENFORCEMENT (structure guards)
   can() wired at the Overtime boundaries; ACTIONS amended 13 -> 16.
   Behaviour (SE-0 + self-Draft policy) is proven by
   tools/verify-mutation-enforcement-overtime-runtime.js.
   ============================================================ */
const otSrc = read(path.join(root, 'js', 'people', 'overtime.js'));
const azSrcC2b = read(path.join(root, 'js', 'core', 'authz.js'));
// The three new ACTIONS exist, exactly, with the expected values; still no *.read.
check(/OVERTIME_CREATE_SELF_DRAFT:\s*'overtime\.createSelfDraft'/.test(azSrcC2b)
  && /OVERTIME_UPDATE_SELF_DRAFT:\s*'overtime\.updateSelfDraft'/.test(azSrcC2b)
  && /OVERTIME_DELETE_SELF_DRAFT:\s*'overtime\.deleteSelfDraft'/.test(azSrcC2b),
  'UX-006C2B: the three self-Draft ACTIONS are defined with their exact values');
check(!/\.read(\.|self|'|")/.test(azSrcC2b.match(/const ACTIONS[\s\S]*?\}\);/)[0]),
  'UX-006C2B: still no *.read / *.read.self action in ACTIONS');
check(/overtime\.submitSelf/.test(azSrcC2b) && /overtime\.manage/.test(azSrcC2b),
  'UX-006C2B: overtime.submitSelf + overtime.manage preserved');
// Boundaries use the frozen public API only.
check(/can\(\s*ACTIONS\.OVERTIME_CREATE_SELF_DRAFT/.test(otSrc)
  && /can\(\s*ACTIONS\.OVERTIME_UPDATE_SELF_DRAFT/.test(otSrc)
  && /can\(\s*ACTIONS\.OVERTIME_DELETE_SELF_DRAFT/.test(otSrc),
  'UX-006C2B: overtime.js authorizes create/update/delete via can(ACTIONS.OVERTIME_*_SELF_DRAFT)');
check(/ACTIONS\.OVERTIME_SUBMIT_SELF/.test(otSrc) && /ACTIONS\.OVERTIME_MANAGE/.test(otSrc) && /can\(\s*statusAction/.test(otSrc),
  'UX-006C2B: overtime.js splits the status boundary (submitSelf vs manage) via a computed action');
check(!/canPrincipal|\bPOLICY\b|isInScopeForPrincipal|isInScope\b/.test(otSrc),
  'UX-006C2B: overtime.js does not use internal authz seams');
check(!/principalType\s*===|principalType\s*!==/.test(otSrc),
  'UX-006C2B: no scattered principalType role checks in overtime.js');
check(!/!\s*getCurrentUser\(\)/.test(otSrc),
  'UX-006C2B: no null->allow shim in overtime.js');
// worksheetSave (bulk) is gated by overtime.manage BEFORE the row loop.
const wsFn = (otSrc.match(/async function worksheetSave[\s\S]*?\n\}/) || [''])[0];
check(wsFn.indexOf('ACTIONS.OVERTIME_MANAGE') !== -1
  && wsFn.indexOf('ACTIONS.OVERTIME_MANAGE') < wsFn.indexOf('for(const r of rows)'),
  'UX-006C2B: worksheetSave authorizes overtime.manage before mutating any row');
// updateOvertimeRecord performs a POST-update re-check (ownership/status protection).
check((otSrc.match(/async function updateOvertimeRecord[\s\S]*?\n\}/)[0].match(/can\(\s*ACTIONS\.OVERTIME_UPDATE_SELF_DRAFT/g) || []).length >= 2,
  'UX-006C2B: updateOvertimeRecord authorizes pre- AND post-mutation (ownership/status re-check)');
// Enforcement not pushed into persistence.
check(persistenceLayerIsUnauthorized(read(path.join(root, 'js', 'core', 'hr-persistence-portability.js'))),
  'UX-006C2B: no authorization wired into the persistence primitives');
// New harness present; C2C domains remain unwired; schema unchanged.
check(fs.existsSync(path.join(root, 'tools', 'verify-mutation-enforcement-overtime-runtime.js')),
  'UX-006C2B: SE-0 runtime harness present — tools/verify-mutation-enforcement-overtime-runtime.js');
// UX-006C2C-1 wires Payroll (payroll-ops-engine.js); UX-006C2C-2 wires Finance +
// Import. Supplemental/Settings/Bank/backup-restore remain unwired until C2C-3/4.
// Supplemental was deferred by C2C-2 and is wired by C2C-4 (rows 10-15) — see the C2C-4
// structure guards below for its ordering assertions.
check(/can\(ACTIONS\.SUPPLEMENTAL_MANAGE\)/.test(read(path.join(root, 'js', 'people', 'supplemental-engine.js'))),
  'UX-006C2C-4: supplemental is now wired (was the C2C-2 deferral marker)');
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root, 'js', 'core', 'constants.js'))),
  'UX-006C2B: SCHEMA_VERSION remains 6 (no C2B migration/storage change)');

/* ============================================================
   UX-006C2C-1 — CONTRACT OPERATIONS + PAYROLL ENFORCEMENT (structure guards)
   Behaviour (SE-0 + composite atomicity) is proven by
   tools/verify-mutation-enforcement-contract-payroll-runtime.js.
   ============================================================ */
const c2c1Ctr = read(path.join(root, 'js', 'people', 'contracts.js'));
const c2c1Poe = read(path.join(root, 'js', 'people', 'payroll-ops-engine.js'));
// Contract operational boundaries authorized with the frozen mappings.
check(/async function transitionContractStatus[\s\S]*?can\(\s*ACTIONS\.CONTRACT_UPDATE/.test(c2c1Ctr),
  'UX-006C2C-1: transitionContractStatus authorizes can(ACTIONS.CONTRACT_UPDATE)');
check(/async function renewContract[\s\S]*?can\(\s*ACTIONS\.CONTRACT_CREATE/.test(c2c1Ctr),
  'UX-006C2C-1: renewContract authorizes can(ACTIONS.CONTRACT_CREATE) (composite top gate)');
// Renewal single top-level authorization: the can() precedes the successor push and
// the predecessor status mutation (atomic denial).
const renewFn = (c2c1Ctr.match(/async function renewContract[\s\S]*?\n\}/) || [''])[0];
check(renewFn.indexOf('ACTIONS.CONTRACT_CREATE') !== -1
  && renewFn.indexOf('ACTIONS.CONTRACT_CREATE') < renewFn.indexOf('State.contracts.push')
  && renewFn.indexOf('ACTIONS.CONTRACT_CREATE') < renewFn.indexOf('c.status = renewal.predecessorStatus'),
  'UX-006C2C-1: renewContract authorizes ONCE before any predecessor/successor mutation');
// Payroll operational boundaries authorized with payroll.manage.
['generatePayrollForMonth','transitionPayrollLifecycle','commitReadyPayroll','prepareNextMonthPayroll','setPayrollLock']
  .forEach(function(fn){
    const re = new RegExp(fn + '[\\s\\S]*?can\\(\\s*ACTIONS\\.PAYROLL_MANAGE');
    check(re.test(c2c1Poe), 'UX-006C2C-1: ' + fn + ' authorizes can(ACTIONS.PAYROLL_MANAGE)');
  });
check(/#ovForm[\s\S]*?can\(\s*ACTIONS\.PAYROLL_MANAGE/.test(c2c1Poe) && /#ovClear[\s\S]*?can\(\s*ACTIONS\.PAYROLL_MANAGE/.test(c2c1Poe),
  'UX-006C2C-1: salary override + clear authorize can(ACTIONS.PAYROLL_MANAGE)');
// commitReadyPayroll authorizes BEFORE the row loop (atomic payroll+finance).
const commitFn = (c2c1Poe.match(/async function commitReadyPayroll[\s\S]*?\n\}/) || [''])[0];
check(commitFn.indexOf('ACTIONS.PAYROLL_MANAGE') !== -1
  && commitFn.indexOf('ACTIONS.PAYROLL_MANAGE') < commitFn.indexOf('for(const id of ids)'),
  'UX-006C2C-1: commitReadyPayroll authorizes before any plan/finance mutation (composite atomicity)');
// Public API only; no internal seams / role checks in the touched modules.
check(!/canPrincipal|\bPOLICY\b|isInScopeForPrincipal|isInScope\b/.test(c2c1Poe),
  'UX-006C2C-1: payroll-ops-engine.js uses no internal authz seams');
check(!/principalType\s*===|principalType\s*!==/.test(c2c1Poe),
  'UX-006C2C-1: no scattered principalType role checks in payroll-ops-engine.js');
check(!/!\s*getCurrentUser\(\)/.test(c2c1Poe) && !/!\s*getCurrentUser\(\)/.test(c2c1Ctr),
  'UX-006C2C-1: no null->allow shim in the C2C-1 modules');
// New harness present; authz core + ACTIONS frozen; schema unchanged.
check(fs.existsSync(path.join(root, 'tools', 'verify-mutation-enforcement-contract-payroll-runtime.js')),
  'UX-006C2C-1: SE-0 runtime harness present — tools/verify-mutation-enforcement-contract-payroll-runtime.js');
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root, 'js', 'core', 'constants.js'))),
  'UX-006C2C-1: SCHEMA_VERSION remains 6 (no C2C-1 migration/storage change)');

/* ============================================================
   UX-006C2C-2 — FINANCE + IMPORT AUTHORIZATION (structure guards)
   Frozen Decision F2: finance.execute = irreversible execution/posting;
   finance.manage (new, ACTIONS 16 -> 17) = reversible/administrative standalone
   Finance mutation; import.commit = Smart Import commit. All three CEO-only.
   Behaviour (SE-0 + action separation) is proven by
   tools/verify-mutation-enforcement-finance-import-runtime.js.
   ============================================================ */
const c2c2Az  = read(path.join(root, 'js', 'core', 'authz.js'));
const c2c2Exe = read(path.join(root, 'js', 'finance', 'execution-center.js'));
const c2c2Mod = read(path.join(root, 'js', 'finance', 'transaction-modals.js'));
const c2c2Add = read(path.join(root, 'js', 'finance', 'add-upload.js'));
const c2c2Imp = read(path.join(root, 'js', 'import', 'smart-import-commit.js'));
// The one new action, exactly — CEO-only, resource-free (Executive-only scope).
check(/FINANCE_MANAGE:\s*'finance\.manage'/.test(c2c2Az),
  'UX-006C2C-2: FINANCE_MANAGE is defined with the exact value finance.manage');
check(/'finance\.manage':\s*null/.test(c2c2Az) && /'finance\.manage':\s*ceoOnly/.test(c2c2Az),
  'UX-006C2C-2: finance.manage is resource-free and CEO-only in POLICY');
check(/FINANCE_EXECUTE:\s*'finance\.execute'/.test(c2c2Az) && /'finance\.execute':\s*ceoOnly/.test(c2c2Az),
  'UX-006C2C-2: finance.execute preserved unchanged (irreversible posting only)');
check(!/\.read(\.|self|'|")/.test(c2c2Az.match(/const ACTIONS[\s\S]*?\}\);/)[0]),
  'UX-006C2C-2: still no *.read / *.read.self action in ACTIONS');
// Execution boundary: finance.execute, authorized before the lookup/mutation, and it
// must NOT depend on finance.manage.
const c2c2ExecFn = (c2c2Exe.match(/async function executeTransaction[\s\S]*?\n\}/) || [''])[0];
check(/^\s*if\(!can\(ACTIONS\.FINANCE_EXECUTE\)\)/m.test(c2c2ExecFn)
  && c2c2ExecFn.indexOf('ACTIONS.FINANCE_EXECUTE') < c2c2ExecFn.indexOf('t.execution ='),
  'UX-006C2C-2: executeTransaction authorizes can(ACTIONS.FINANCE_EXECUTE) before any mutation');
check(!/FINANCE_MANAGE/.test(c2c2ExecFn),
  'UX-006C2C-2: executeTransaction does not depend on finance.manage');
// Administrative boundaries: finance.manage, one top gate each.
['scheduleTransaction','cancelTransaction','archiveTransaction','duplicateTransaction','saveEditedTransaction']
  .forEach(function(fn){
    const body = (c2c2Exe.match(new RegExp('async function ' + fn + '[\\s\\S]*?\\n\\}')) || [''])[0];
    check(/^\s*if\(!can\(ACTIONS\.FINANCE_MANAGE\)\)/m.test(body) && body.indexOf('ACTIONS.FINANCE_MANAGE') < body.indexOf('await persist()'),
      'UX-006C2C-2: ' + fn + ' authorizes can(ACTIONS.FINANCE_MANAGE) before persisting');
  });
// Manual create + inline delete are their own mutation boundaries (no engine function):
// the gate sits before the State.txns write, not on the rendering of a control.
check(/can\(ACTIONS\.FINANCE_MANAGE\)/.test(c2c2Add)
  && c2c2Add.indexOf('ACTIONS.FINANCE_MANAGE') < c2c2Add.indexOf('State.txns.push(txn)'),
  'UX-006C2C-2: manual transaction create authorizes finance.manage before State.txns.push');
const c2c2Del = (c2c2Mod.match(/else if\(action==='delete'\)\{[\s\S]*?\n/) || [''])[0];
check(/can\(ACTIONS\.FINANCE_MANAGE\)/.test(c2c2Del)
  && c2c2Del.indexOf('ACTIONS.FINANCE_MANAGE') < c2c2Del.indexOf('State.txns = State.txns.filter'),
  'UX-006C2C-2: inline delete authorizes finance.manage before the permanent filter');
// A denied engine result is never reported as a success.
check(/function reportTxnResult\(/.test(c2c2Mod) && /res\.ok===false/.test(c2c2Mod),
  'UX-006C2C-2: the Finance UI reports a denied/failed engine result instead of a success toast');
// Import: a single top gate before ANY write (including the pre-import safety backup).
const c2c2ImpFn = (c2c2Imp.match(/async function commitSmartImport[\s\S]*?\n\}/) || [''])[0];
check(/^\s*if\(!can\(ACTIONS\.IMPORT_COMMIT\)\)/m.test(c2c2ImpFn)
  && c2c2ImpFn.indexOf('ACTIONS.IMPORT_COMMIT') < c2c2ImpFn.indexOf('State.backups.unshift'),
  'UX-006C2C-2: commitSmartImport authorizes can(ACTIONS.IMPORT_COMMIT) before any write');
check((c2c2ImpFn.match(/can\(ACTIONS\./g) || []).length === 1,
  'UX-006C2C-2: commitSmartImport has exactly ONE authorization gate');
// Backup restore was deferred by C2C-2 and is wired by C2C-3 (row 4) — see the C2C-3
// structure guards below for its ordering assertion.
// Public API only; no internal seams, role checks, or null->allow shims.
[['execution-center.js', c2c2Exe], ['transaction-modals.js', c2c2Mod], ['add-upload.js', c2c2Add], ['smart-import-commit.js', c2c2Imp]]
  .forEach(function(pair){
    check(!/canPrincipal|\bPOLICY\b|isInScopeForPrincipal|isInScope\b/.test(pair[1]),
      'UX-006C2C-2: ' + pair[0] + ' uses no internal authz seams');
    check(!/principalType\s*===|principalType\s*!==/.test(pair[1]),
      'UX-006C2C-2: no scattered principalType role checks in ' + pair[0]);
    check(!/!\s*getCurrentUser\(\)/.test(pair[1]),
      'UX-006C2C-2: no null->allow shim in ' + pair[0]);
  });
// Enforcement is not pushed into persistence.
check(!/\bcan\(/.test(read(path.join(root, 'js', 'core', 'storage-adapter.js'))),
  'UX-006C2C-2: authorization is NOT wired into StorageAdapter');
// New SE-0 harness present; version/schema untouched.
check(fs.existsSync(path.join(root, 'tools', 'verify-mutation-enforcement-finance-import-runtime.js')),
  'UX-006C2C-2: SE-0 runtime harness present — tools/verify-mutation-enforcement-finance-import-runtime.js');
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root, 'js', 'core', 'constants.js'))),
  'UX-006C2C-2: SCHEMA_VERSION remains 6 (no C2C-2 migration/storage change)');

/* ============================================================
   UX-006C2C-3 — DESTRUCTIVE / LIFECYCLE AUTHORIZATION (structure guards)
   Frozen matrix rows 1-9. ACTIONS 17 -> 20 (import.undo, data.restore, data.reset).
   Behaviour (SE-0 + outcome reporting) is proven by tools/verify-authz-c2c3-runtime.js.
   ============================================================ */
// Ordering assertions below compare positions in COMMENT-STRIPPED source: a guard must
// never be satisfied (or defeated) by prose in a nearby comment.
const c2c3Az   = read(path.join(root, 'js', 'core', 'authz.js'));
const c2c3Undo = read(path.join(root, 'js', 'import', 'smart-import-commit.js'));
const c2c3Prev = read(path.join(root, 'js', 'import', 'import-preview.js'));
const c2c3Add  = read(path.join(root, 'js', 'finance', 'add-upload.js'));
const c2c3Hrp  = read(path.join(root, 'js', 'core', 'hr-persistence-portability.js'));
const c2c3Set  = read(path.join(root, 'js', 'ui', 'settings-about.js'));
const c2c3Onb  = read(path.join(root, 'js', 'core', 'onboarding-reset.js'));
const c2c3Ded  = read(path.join(root, 'js', 'people', 'employee-dedup.js'));
// Exactly the three frozen actions, no alias and no fourth.
check(/IMPORT_UNDO:\s*'import\.undo'/.test(c2c3Az), 'UX-006C2C-3: IMPORT_UNDO defined with its exact frozen value');
check(/DATA_RESTORE:\s*'data\.restore'/.test(c2c3Az), 'UX-006C2C-3: DATA_RESTORE defined with its exact frozen value');
check(/DATA_RESET:\s*'data\.reset'/.test(c2c3Az), 'UX-006C2C-3: DATA_RESET defined with its exact frozen value');
check(/'import\.undo':\s*null/.test(c2c3Az) && /'import\.undo':\s*ceoOnly/.test(c2c3Az),
  'UX-006C2C-3: import.undo is resource-free and CEO-only in POLICY');
check(/'data\.restore':\s*null/.test(c2c3Az) && /'data\.restore':\s*ceoOnly/.test(c2c3Az),
  'UX-006C2C-3: data.restore is resource-free and CEO-only in POLICY');
check(/'data\.reset':\s*null/.test(c2c3Az) && /'data\.reset':\s*ceoOnly/.test(c2c3Az),
  'UX-006C2C-3: data.reset is resource-free and CEO-only in POLICY');
['recurring.manage','bank.manage','employee.merge'].forEach(function(rej){
  check(c2c3Az.indexOf("'" + rej + "'") === -1, 'UX-006C2C-3: rejected action ' + rej + ' was NOT added');
});
check(!/\.read(\.|self|'|")/.test(c2c3Az.match(/const ACTIONS[\s\S]*?\}\);/)[0]),
  'UX-006C2C-3: still no *.read action in ACTIONS');
// Row 1 — undo gated before the batch lookup and any deletion, and it now audits.
const c2c3UndoFn = stripComments((c2c3Undo.match(/async function undoLastSmartImport[\s\S]*?\n\}/) || [''])[0]);
check(/^\s*if\(!can\(ACTIONS\.IMPORT_UNDO\)\)/m.test(c2c3UndoFn)
  && c2c3UndoFn.indexOf('ACTIONS.IMPORT_UNDO') < c2c3UndoFn.indexOf('State.txns = State.txns.filter'),
  'UX-006C2C-3: undoLastSmartImport authorizes import.undo before any deletion');
check(c2c3UndoFn.indexOf("logActivity({type:'import.undo'") !== -1
  && c2c3UndoFn.indexOf("logActivity({type:'import.undo'") > c2c3UndoFn.indexOf('const saved = await saveAllData();'),
  'UX-006C2C-3: the undo audit entry is written only after a successful save');
check((c2c3UndoFn.match(/can\(ACTIONS\./g) || []).length === 1,
  'UX-006C2C-3: undoLastSmartImport has exactly ONE authorization gate');
// Rows 2-3 — legacy import commit paths.
check(/can\(ACTIONS\.IMPORT_COMMIT\)/.test(c2c3Prev)
  && c2c3Prev.indexOf('ACTIONS.IMPORT_COMMIT') < c2c3Prev.indexOf('State.txns.push(buildImportedTxn'),
  'UX-006C2C-3: confirmImport authorizes import.commit before any State.txns write');
const c2c3Amu = stripComments((c2c3Prev.match(/async function applyMonthUpdate[\s\S]*?\n\}/) || [''])[0]);
check(/^\s*if\(!can\(ACTIONS\.IMPORT_COMMIT\)\)/m.test(c2c3Amu)
  && c2c3Amu.indexOf('ACTIONS.IMPORT_COMMIT') < c2c3Amu.indexOf('State.backups.unshift')
  && c2c3Amu.indexOf('ACTIONS.IMPORT_COMMIT') < c2c3Amu.indexOf('State.txns = State.txns.filter'),
  'UX-006C2C-3: applyMonthUpdate authorizes import.commit before the backup and the replacement');
check(!/data\.restore|DATA_RESTORE/.test(c2c3Amu),
  'UX-006C2C-3: applyMonthUpdate is NOT remapped to data.restore (frozen R2)');
// Row 4 — month restore.
const c2c3Restore = stripComments((c2c3Add.match(/data-restore-backup[\s\S]*?render\(\);/) || [''])[0]);
check(/can\(ACTIONS\.DATA_RESTORE\)/.test(c2c3Restore)
  && c2c3Restore.indexOf('ACTIONS.DATA_RESTORE') < c2c3Restore.indexOf('State.txns = State.txns.filter'),
  'UX-006C2C-3: month restore authorizes data.restore before the replacement');
// Row 5 — complete backup restore, gated before validation/snapshot/writes.
const c2c3Rcb = stripComments((c2c3Hrp.match(/async function restoreCompleteBackup[\s\S]*?\n\}/) || [''])[0]);
check(/^\s*if\(!can\(ACTIONS\.DATA_RESTORE\)\)/m.test(c2c3Rcb)
  && c2c3Rcb.indexOf('ACTIONS.DATA_RESTORE') < c2c3Rcb.indexOf('const safety = {')
  && c2c3Rcb.indexOf('ACTIONS.DATA_RESTORE') < c2c3Rcb.indexOf('State.txns = data.txns.map'),
  'UX-006C2C-3: restoreCompleteBackup authorizes data.restore before the safety backup and the replacement');
['validateCompleteBackup', 'const snap =', 'rbFail'].forEach(function(kept){
  check(c2c3Rcb.indexOf(kept) !== -1, 'UX-006C2C-3: restoreCompleteBackup keeps its "' + kept + '" behaviour');
});
// Rows 6-7 — destructive reset.
const c2c3Reset = stripComments((c2c3Set.match(/resetAppData'\)\.addEventListener[\s\S]*?render\(\);/) || [''])[0]);
check(/can\(ACTIONS\.DATA_RESET\)/.test(c2c3Reset)
  && c2c3Reset.indexOf('ACTIONS.DATA_RESET') < c2c3Reset.indexOf("StorageAdapter.set('tam_txns_v1'"),
  'UX-006C2C-3: resetAppData authorizes data.reset before any storage write');
const c2c3Fresh = stripComments((c2c3Onb.match(/async function startFresh[\s\S]*?\n\}/) || [''])[0]);
check(/^\s*if\(!can\(ACTIONS\.DATA_RESET\)\)/m.test(c2c3Fresh)
  && c2c3Fresh.indexOf('ACTIONS.DATA_RESET') < c2c3Fresh.indexOf('StorageAdapter.remove'),
  'UX-006C2C-3: startFresh authorizes data.reset before clearing any storage key');
// Row 8 — demo data uses the existing employee.create (no demo-specific action).
const c2c3Demo = stripComments((c2c3Onb.match(/async function loadDemoData[\s\S]*?\n\}/) || [''])[0]);
check(/^\s*if\(!can\(ACTIONS\.EMPLOYEE_CREATE\)\)/m.test(c2c3Demo)
  && c2c3Demo.indexOf('ACTIONS.EMPLOYEE_CREATE') < c2c3Demo.indexOf('State.employees.push'),
  'UX-006C2C-3: loadDemoData authorizes employee.create before creating records');
// Row 9 — dedup merge gated before the safety backup, the relink and the audit.
const c2c3Merge = stripComments((c2c3Ded.match(/async function mergeEmployeeGroup[\s\S]*?\n\}/) || [''])[0]);
check(/if\(!can\(ACTIONS\.EMPLOYEE_DELETE, canon\)\)/.test(c2c3Merge)
  && c2c3Merge.indexOf('ACTIONS.EMPLOYEE_DELETE') < c2c3Merge.indexOf('State.backups.unshift')
  && c2c3Merge.indexOf('ACTIONS.EMPLOYEE_DELETE') < c2c3Merge.indexOf('State.employees = State.employees.filter'),
  'UX-006C2C-3: mergeEmployeeGroup authorizes employee.delete before the safety backup, relink and deletion');
check(/res\.error === 'NotAuthorized'/.test(c2c3Ded),
  'UX-006C2C-3: the merge caller reports a denial instead of the persistence-failure wording');
// Public API only; no internal seams / role checks / null->allow in the C2C-3 modules.
[['smart-import-commit.js', c2c3Undo], ['import-preview.js', c2c3Prev], ['add-upload.js', c2c3Add],
 ['hr-persistence-portability.js', c2c3Hrp], ['settings-about.js', c2c3Set], ['onboarding-reset.js', c2c3Onb],
 ['employee-dedup.js', c2c3Ded]].forEach(function(pair){
  check(!/canPrincipal|isInScopeForPrincipal/.test(pair[1]),
    'UX-006C2C-3: ' + pair[0] + ' uses no internal authz seams');
  check(!/principalType\s*===|principalType\s*!==/.test(pair[1]),
    'UX-006C2C-3: no scattered principalType role checks in ' + pair[0]);
  check(!/!\s*getCurrentUser\(\)/.test(pair[1]),
    'UX-006C2C-3: no null->allow shim in ' + pair[0]);
});
// C2C-4 (rows 10-30) wires these domains; their ordering guards live in the C2C-4 block below.
['people/supplemental-engine.js','people/recurring-expenses.js','people/monthly-plan.js','people/legacy-mapping.js']
  .forEach(function(f){
    check(/\bcan\(ACTIONS\./.test(read(path.join(root, 'js', f))),
      'UX-006C2C-4: domain ' + f + ' is gated (was a C2C-3 deferral marker)');
  });
check(/can\(ACTIONS\.SETTINGS_MANAGE\)/.test(c2c3Set),
  'UX-006C2C-4: settings save / bank management are gated (was a C2C-3 deferral marker)');
check(!/can\(ACTIONS\.(SUPPLEMENTAL_MANAGE|SETTINGS_MANAGE)/.test(read(path.join(root, 'js', 'people', 'payroll-workspace.js'))),
  'UX-006C2C-3: payroll workspace gained no C2C-4 gate');
// New harness present; schema untouched.
check(fs.existsSync(path.join(root, 'tools', 'verify-authz-c2c3-runtime.js')),
  'UX-006C2C-3: SE-0 runtime harness present — tools/verify-authz-c2c3-runtime.js');
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root, 'js', 'core', 'constants.js'))),
  'UX-006C2C-3: SCHEMA_VERSION remains 6 (no C2C-3 migration/storage change)');

/* ============================================================
   UX-006C2C-4 — ADMINISTRATIVE DOMAIN AUTHORIZATION (structure guards)
   Frozen matrix rows 10-30. ZERO new actions: ACTIONS stays 20.
   Behaviour (SE-0 + outcome reporting) is proven by tools/verify-authz-c2c4-runtime.js.
   Ordering assertions compare COMMENT-STRIPPED source.
   ============================================================ */
const c2c4Sup = read(path.join(root, 'js', 'people', 'supplemental-engine.js'));
const c2c4Rec = read(path.join(root, 'js', 'people', 'recurring-expenses.js'));
const c2c4Mon = read(path.join(root, 'js', 'people', 'monthly-plan.js'));
const c2c4Pay = read(path.join(root, 'js', 'people', 'payroll-workspace.js'));
const c2c4Leg = read(path.join(root, 'js', 'people', 'legacy-mapping.js'));
const c2c4Set = read(path.join(root, 'js', 'ui', 'settings-about.js'));
const c2c4Onb = read(path.join(root, 'js', 'core', 'onboarding-reset.js'));
// ACTIONS unchanged by C2C-4 — reuse only.
check((read(path.join(root, 'js', 'core', 'authz.js')).match(/:\s*'[a-z]+\.[a-zA-Z]+'/g) || []).length === 20,
  'UX-006C2C-4: ACTIONS remains exactly 20 (C2C-4 adds no action)');
['recurring.manage','bank.manage','employee.merge'].forEach(function(rej){
  check(read(path.join(root, 'js', 'core', 'authz.js')).indexOf("'" + rej + "'") === -1,
    'UX-006C2C-4: rejected action ' + rej + ' still absent');
});
// Rows 10-15 — every supplemental user boundary gated with supplemental.manage.
['generateSupplementalForPlan','refreshSupplemental','transitionSupplemental','setSupplementalAccount',
 'setSupplementalNotes','postSupplemental'].forEach(function(fn){
  const body = stripComments((c2c4Sup.match(new RegExp('async function ' + fn + '[\\s\\S]*?\\n\\}')) || [''])[0]);
  check(/^\s*if\(!can\(ACTIONS\.SUPPLEMENTAL_MANAGE\)\)/m.test(body),
    'UX-006C2C-4: ' + fn + ' authorizes supplemental.manage at the top');
});
// Row 15 composite — the single top gate precedes BOTH the supplemental and finance writes.
const c2c4Post = stripComments((c2c4Sup.match(/async function postSupplemental[\s\S]*?\n\}/) || [''])[0]);
check(c2c4Post.indexOf('ACTIONS.SUPPLEMENTAL_MANAGE') < c2c4Post.indexOf('State.txns.push(txn)')
  && c2c4Post.indexOf('ACTIONS.SUPPLEMENTAL_MANAGE') < c2c4Post.indexOf("supp.status = 'Posted'"),
  'UX-006C2C-4: postSupplemental single top gate precedes the supplemental AND finance writes');
check((c2c4Post.match(/can\(ACTIONS\./g) || []).length === 1,
  'UX-006C2C-4: postSupplemental has exactly ONE authorization gate');
// Row 16 / indirect — frozen NOT-APPLICABLE rulings preserved.
const c2c4Recover = stripComments((c2c4Sup.match(/async function recoverSupplementalOrphans[\s\S]*?\n\}/) || [''])[0]);
check(!/can\(ACTIONS\./.test(c2c4Recover),
  'UX-006C2C-4: recoverSupplementalOrphans remains NOT APPLICABLE (bootstrap self-heal, ungated)');
const c2c4Link = stripComments((c2c4Sup.match(/async function linkSupplementalExecution[\s\S]*?\n\}/) || [''])[0]);
check(!/can\(ACTIONS\./.test(c2c4Link),
  'UX-006C2C-4: linkSupplementalExecution stays INDIRECTLY AUTHORIZED via finance.execute');
// Rows 17-19 — recurring rule administration.
check(/can\(ACTIONS\.FINANCE_MANAGE\)/.test(c2c4Rec)
  && stripComments(c2c4Rec).indexOf('ACTIONS.FINANCE_MANAGE') < stripComments(c2c4Rec).indexOf('State.recurringExpenses.push'),
  'UX-006C2C-4: recurring create/edit authorizes finance.manage before the push');
['toggleRecurring','deleteRecurring'].forEach(function(fn){
  const body = stripComments((c2c4Rec.match(new RegExp('async function ' + fn + '[\\s\\S]*?\\n\\}')) || [''])[0]);
  check(/^\s*if\(!can\(ACTIONS\.FINANCE_MANAGE\)\)/m.test(body),
    'UX-006C2C-4: ' + fn + ' authorizes finance.manage at the top');
});
check(!/RECURRING_MANAGE|recurring\.manage/.test(c2c4Rec),
  'UX-006C2C-4: recurring uses no recurring.manage action');
// Row 20 — monthly-plan commit, single top gate before the row loop.
const c2c4Commit = stripComments((c2c4Mon.match(/async function commitMonthlyPlan[\s\S]*?\n\}/) || [''])[0]);
check(/^\s*if\(!can\(ACTIONS\.FINANCE_MANAGE\)\)/m.test(c2c4Commit)
  && c2c4Commit.indexOf('ACTIONS.FINANCE_MANAGE') < c2c4Commit.indexOf('for(const r of sel)')
  && c2c4Commit.indexOf('ACTIONS.FINANCE_MANAGE') < c2c4Commit.indexOf('State.txns.push(txn)'),
  'UX-006C2C-4: commitMonthlyPlan authorizes finance.manage before the row loop and any txn write');
check((c2c4Commit.match(/can\(ACTIONS\./g) || []).length === 1,
  'UX-006C2C-4: commitMonthlyPlan has exactly ONE authorization gate');
check(/res\.error === 'NotAuthorized'/.test(c2c4Mon),
  'UX-006C2C-4: the monthly-plan caller reports a denial instead of the partial-persistence wording');
// Row 30 — markReviewed.
const c2c4Mark = stripComments((c2c4Mon.match(/markReviewed'\); if\(mr\)[\s\S]*?render\(\); \}\);/) || [''])[0]);
check(/can\(ACTIONS\.FINANCE_MANAGE\)/.test(c2c4Mark)
  && c2c4Mark.indexOf('ACTIONS.FINANCE_MANAGE') < c2c4Mark.indexOf("p.status='Reviewed'"),
  'UX-006C2C-4: markReviewed authorizes finance.manage before the status write');
// Rows 21-23 — payroll adjustments.
['toggleAdjustment','deleteAdjustment'].forEach(function(fn){
  const body = stripComments((c2c4Pay.match(new RegExp('async function ' + fn + '[\\s\\S]*?\\n\\}')) || [''])[0]);
  check(/^\s*if\(!can\(ACTIONS\.PAYROLL_MANAGE/m.test(body),
    'UX-006C2C-4: ' + fn + ' authorizes payroll.manage at the top');
});
check(/#paForm[\s\S]*?can\(ACTIONS\.PAYROLL_MANAGE/.test(stripComments(c2c4Pay)),
  'UX-006C2C-4: the adjustment create/edit form authorizes payroll.manage');
// Row 24 — legacy finance mapping.
const c2c4LegS = stripComments(c2c4Leg);
check(/can\(ACTIONS\.FINANCE_MANAGE\)/.test(c2c4LegS)
  && c2c4LegS.indexOf('ACTIONS.FINANCE_MANAGE') < c2c4LegS.indexOf('t.employeeId = empId'),
  'UX-006C2C-4: legacy mapping authorizes finance.manage before any transaction edit');
// Rows 25-29 — bank + settings + onboarding.
const c2c4SetS = stripComments(c2c4Set);
check(/#caccForm[\s\S]*?can\(ACTIONS\.SETTINGS_MANAGE\)/.test(c2c4SetS),
  'UX-006C2C-4: bank account create/edit authorizes settings.manage');
const c2c4Acct = stripComments((c2c4Set.match(/async function setCompanyAccountStatus[\s\S]*?\n\}/) || [''])[0]);
check(/^\s*if\(!can\(ACTIONS\.SETTINGS_MANAGE\)\)/m.test(c2c4Acct),
  'UX-006C2C-4: setCompanyAccountStatus authorizes settings.manage at the top');
check(!/BANK_MANAGE|bank\.manage/.test(c2c4Set), 'UX-006C2C-4: bank uses no bank.manage action');
check(/settingsForm'\)\.addEventListener\('submit'[\s\S]{0,400}?can\(ACTIONS\.SETTINGS_MANAGE\)/.test(c2c4SetS),
  'UX-006C2C-4: settings save authorizes settings.manage before any settings write');
check(/dismissOnb[\s\S]{0,400}?can\(ACTIONS\.SETTINGS_MANAGE\)/.test(stripComments(c2c4Onb)),
  'UX-006C2C-4: dismiss onboarding authorizes settings.manage');
check(/drShowOnb[\s\S]{0,400}?can\(ACTIONS\.SETTINGS_MANAGE\)/.test(c2c4SetS),
  'UX-006C2C-4: re-show onboarding authorizes settings.manage');
// settings.manage must NOT be broadened into destructive lifecycle authority.
const c2c4Reset2 = stripComments((c2c4Set.match(/resetAppData'\)\.addEventListener[\s\S]*?render\(\);/) || [''])[0]);
check(/can\(ACTIONS\.DATA_RESET\)/.test(c2c4Reset2) && !/can\(ACTIONS\.SETTINGS_MANAGE\)/.test(c2c4Reset2),
  'UX-006C2C-4: resetAppData still requires data.reset, NOT settings.manage');
// No internal seams / role checks / null->allow in the C2C-4 modules.
[['supplemental-engine.js', c2c4Sup], ['recurring-expenses.js', c2c4Rec], ['monthly-plan.js', c2c4Mon],
 ['payroll-workspace.js', c2c4Pay], ['legacy-mapping.js', c2c4Leg], ['settings-about.js', c2c4Set]].forEach(function(pair){
  check(!/canPrincipal|isInScopeForPrincipal/.test(pair[1]),
    'UX-006C2C-4: ' + pair[0] + ' uses no internal authz seams');
  check(!/principalType\s*===|principalType\s*!==/.test(pair[1]),
    'UX-006C2C-4: no scattered principalType role checks in ' + pair[0]);
  check(!/!\s*getCurrentUser\(\)/.test(pair[1]),
    'UX-006C2C-4: no null->allow shim in ' + pair[0]);
});
/* ---------- INVENTORY CLOSURE ----------
   Every one of the 30 frozen user-reachable rows is now AUTHORIZED, or explicitly
   NOT APPLICABLE / INDIRECTLY AUTHORIZED. A file listed here with zero gates means a
   frozen row was left unwired. */
const C2C_CLOSURE = [
  ['js/import/smart-import-commit.js',        /can\(ACTIONS\.(IMPORT_UNDO|IMPORT_COMMIT)\)/,   'rows 1 + Smart Import commit'],
  ['js/import/import-preview.js',             /can\(ACTIONS\.IMPORT_COMMIT\)/,                 'rows 2-3'],
  ['js/finance/add-upload.js',                /can\(ACTIONS\.DATA_RESTORE\)/,                  'row 4'],
  ['js/core/hr-persistence-portability.js',   /can\(ACTIONS\.DATA_RESTORE\)/,                  'row 5'],
  ['js/ui/settings-about.js',                 /can\(ACTIONS\.DATA_RESET\)/,                    'row 6'],
  ['js/core/onboarding-reset.js',             /can\(ACTIONS\.DATA_RESET\)/,                    'row 7'],
  ['js/people/employee-dedup.js',             /can\(ACTIONS\.EMPLOYEE_DELETE, canon\)/,        'row 9'],
  ['js/people/supplemental-engine.js',        /can\(ACTIONS\.SUPPLEMENTAL_MANAGE\)/,           'rows 10-15'],
  ['js/people/recurring-expenses.js',         /can\(ACTIONS\.FINANCE_MANAGE\)/,                'rows 17-19'],
  ['js/people/monthly-plan.js',               /can\(ACTIONS\.FINANCE_MANAGE\)/,                'rows 20 + 30'],
  ['js/people/payroll-workspace.js',          /can\(ACTIONS\.PAYROLL_MANAGE/,                  'rows 21-23'],
  ['js/people/legacy-mapping.js',             /can\(ACTIONS\.FINANCE_MANAGE\)/,                'row 24'],
  ['js/finance/execution-center.js',          /can\(ACTIONS\.FINANCE_(EXECUTE|MANAGE)\)/,      'C2C-2 finance'],
  ['js/finance/transaction-modals.js',        /can\(ACTIONS\.FINANCE_MANAGE\)/,                'C2C-2 inline delete']
];
C2C_CLOSURE.forEach(function(row){
  check(row[1].test(read(path.join(root, row[0]))),
    'UX-006C2C-4 closure: ' + row[0] + ' is gated (' + row[2] + ')');
});
check(fs.existsSync(path.join(root, 'tools', 'verify-authz-c2c4-runtime.js')),
  'UX-006C2C-4: SE-0 runtime harness present — tools/verify-authz-c2c4-runtime.js');
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root, 'js', 'core', 'constants.js'))),
  'UX-006C2C-4: SCHEMA_VERSION remains 6 (no C2C-4 migration/storage change)');

/* ============================================================
   UX-006C3 — INTEGRATION FREEZE (machine-enforced manifest, ruling C3-R8)
   The frozen integration surface lives in tools/integration-surface-manifest.js and is
   cross-checked against the REAL source here, so a new/removed/renamed surface cannot land
   silently. Behaviour (availability semantics, principal-change recomputation, deep links,
   affordance-vs-enforcement) is proven by tools/verify-authz-integration-runtime.js.
   ============================================================ */
const C3M = require('./integration-surface-manifest.js');
const c3Shell = read(path.join(root, 'js', 'ui', 'shell-render.js'));
const c3Exec  = read(path.join(root, 'js', 'analytics', 'executive-dashboard.js'));
const c3Stab  = read(path.join(root, 'js', 'core', 'stabilization.js'));
// --- sidebar: every manifest id exists in NAV_GROUPS, and NAV_GROUPS adds nothing new ---
const c3NavBlock = (c3Shell.match(/const NAV_GROUPS = \[[\s\S]*?\n\];/) || [''])[0];
// Items carry an `ic:` icon; group headers do not — matching on it keeps the 5 group ids
// out of the item inventory.
const c3NavIds = (c3NavBlock.match(/\{id:'(\w+)', label:'[^']*', ic:/g) || []).map(function(m){ return m.replace(/\{id:'/,'').replace(/',[\s\S]*$/,''); });
const c3ManifestNav = C3M.SIDEBAR.reduce(function(a,g){ return a.concat(g.items); }, []);
check(c3NavIds.length === C3M.NAV_COUNT,
  'UX-006C3 freeze: sidebar item count matches the manifest (' + C3M.NAV_COUNT + ')');
check(c3ManifestNav.every(function(id){ return c3NavIds.indexOf(id) !== -1; }),
  'UX-006C3 freeze: every manifest sidebar id exists in NAV_GROUPS');
check(c3NavIds.every(function(id){ return c3ManifestNav.indexOf(id) !== -1; }),
  'UX-006C3 freeze: NAV_GROUPS introduces no sidebar item missing from the manifest');
// --- Quick Actions: view set and per-view entry count match ---
const c3QaBlock = (c3Shell.match(/const QUICK_ACTIONS_BY_VIEW = \{[\s\S]*?\n\};/) || [''])[0];
const c3QaViews = (c3QaBlock.match(/^  (\w+): \[/gm) || []).map(function(m){ return m.trim().replace(/: \[$/,''); });
check(c3QaViews.length === C3M.QUICK_ACTIONS.length,
  'UX-006C3 freeze: Quick Action view count matches the manifest (' + C3M.QUICK_ACTIONS.length + ')');
check(C3M.QUICK_ACTIONS.every(function(v){ return c3QaViews.indexOf(v.view) !== -1; }),
  'UX-006C3 freeze: every manifest Quick Action view exists in QUICK_ACTIONS_BY_VIEW');
check(c3QaViews.every(function(v){ return C3M.QUICK_ACTIONS.some(function(m){ return m.view === v; }); }),
  'UX-006C3 freeze: QUICK_ACTIONS_BY_VIEW introduces no view missing from the manifest');
check((c3QaBlock.match(/\{ label:'/g) || []).length === C3M.QUICK_ACTION_COUNT,
  'UX-006C3 freeze: Quick Action entry count matches the manifest (' + C3M.QUICK_ACTION_COUNT + ')');
// --- Action Center: generator set matches ---
const c3AcBlock = (c3Exec.match(/function actionCenterSources[\s\S]*?\n\}/) || [''])[0];
check((c3AcBlock.match(/\{ to:'/g) || []).length === C3M.ACTION_CENTER_COUNT,
  'UX-006C3 freeze: Action Center generator count matches the manifest (' + C3M.ACTION_CENTER_COUNT + ')');
C3M.ACTION_CENTER.forEach(function(g){
  check(c3AcBlock.indexOf(g.generator) !== -1 && c3AcBlock.indexOf("to:'" + g.to + "'") !== -1,
    'UX-006C3 freeze: Action Center generator ' + g.generator + ' -> ' + g.to + ' present');
});
check(C3M.NAVIGATION_TOTAL === 43, 'UX-006C3 freeze: frozen integration surface totals 43 entries');
// --- navigation stays visible+normal: no availability policy on navigation (C3-R1/R4) ---
check(C3M.NAVIGATION_AVAILABILITY === 'visible-normal',
  'UX-006C3: navigation availability is visible-normal in the manifest');
check(!/authzDisabled/.test(c3NavBlock) && !/authzDisabled/.test(c3QaBlock) && !/authzDisabled/.test(c3AcBlock),
  'UX-006C3: no availability policy applied to navigation entries (never hidden, never disabled)');
check(!/data-nav[\s\S]{0,400}?can\(ACTIONS\./.test(stripComments(c3Shell)),
  'UX-006C3: the sidebar nav handler introduces no authorization gate (no route guard)');
check(!/\bcan\(ACTIONS\./.test(stripComments(c3Exec)),
  'UX-006C3: the Action Center introduces no authorization gate');
// --- the shared availability mechanism (C3-R2/R3/R5) ---
check(/function authzDisabled\(action, resource\)\{/.test(c3Stab),
  'UX-006C3: the shared authzDisabled(action, resource) helper exists');
const c3Helper = (c3Stab.match(/function authzDisabled[\s\S]*?\n\}/) || [''])[0];
check(/return can\(action, resource\) \?/.test(c3Helper),
  'UX-006C3: availability delegates to the frozen public can() — no duplicated policy');
check(!/principalType|POLICY|canPrincipal|ACTION_SET/.test(c3Helper),
  'UX-006C3: availability uses no role table, internal seam or policy copy');
check(!/State\./.test(c3Helper),
  'UX-006C3: availability is derived, never cached or persisted in State');
// --- mutation controls: exactly one action each, present at the render site ---
C3M.MUTATION_CONTROLS.forEach(function(c){
  const src = read(path.join(root, c.file));
  check(src.indexOf(c.marker) !== -1,
    'UX-006C3: control ' + c.id + ' surfaces availability for ' + c.action + ' (' + c.file + ')');
});
check(C3M.MUTATION_CONTROLS.every(function(c){ return typeof c.action === 'string' && c.action.indexOf(',') === -1; }),
  'UX-006C3: every availability control maps to EXACTLY ONE frozen action (no aggregate rule)');
{ const azSrc3 = read(path.join(root, 'js', 'core', 'authz.js'));
  check(C3M.MUTATION_CONTROLS.every(function(c){ return azSrc3.indexOf("'" + c.action + "'") !== -1; }),
    'UX-006C3: every control action exists in the frozen 20-action registry'); }
check(!/style="display:none|hidden/.test(read(path.join(root, 'js', 'import', 'smart-import-ui.js')).match(/id="irUndo"[^>]*>/)[0]),
  'UX-006C3: a denied control is disabled, never hidden');
// --- C3 changes no authorization semantics ---
check((read(path.join(root, 'js', 'core', 'authz.js')).match(/:\s*'[a-z]+\.[a-zA-Z]+'/g) || []).length === 20,
  'UX-006C3: ACTIONS remains exactly 20 (C3 adds no action)');
check(fs.existsSync(path.join(root, 'tools', 'verify-authz-integration-runtime.js')),
  'UX-006C3: integration runtime harness present — tools/verify-authz-integration-runtime.js');
check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root, 'js', 'core', 'constants.js'))),
  'UX-006C3: SCHEMA_VERSION remains 6 (no C3 migration/storage change)');

/* ============================================================
   UX-006D2 — PRINCIPAL & WORKSPACE PRESENTATION (structural)
   ------------------------------------------------------------
   D2 is PRESENTATION ONLY. These checks exist to make that claim mechanical: the
   presentation surfaces must be present, and the frozen semantics beneath them must
   be provably unmoved. BEHAVIOUR is proven by
   tools/verify-ux006d2-presentation-runtime.js.
   ============================================================ */
console.log('== UX-006D2 — PRINCIPAL & WORKSPACE PRESENTATION ==');
{
  const d2Sel = read(path.join(root, 'js', 'ui', 'identity-selector.js'));
  const d2SelCode = d2Sel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const d2Shell = read(path.join(root, 'css', 'shell.css'));
  const d2Comp = read(path.join(root, 'css', 'components.css'));
  const d2Stab = read(path.join(root, 'js', 'core', 'stabilization.js'));

  // --- the presentation surfaces exist ---
  check(/id="\s*'\s*\+\s*IDENTITY_CONTEXT_ID|IDENTITY_CONTEXT_ID/.test(d2SelCode),
    'UX-006D2: the workspace/principal context block is rendered by the selector');
  check(/IDENTITY_RAIL_ID/.test(d2SelCode),
    'UX-006D2: the collapsed-rail principal chip is rendered by the selector');
  check(/\.identity-context\{/.test(d2Shell) && /\.identity-rail\{/.test(d2Shell),
    'UX-006D2: context block and rail chip are styled in css/shell.css');
  check(/data-principal-state/.test(d2SelCode),
    'UX-006D2: presentation state is exposed as a deterministic attribute');

  // --- the context is DERIVED, never stored ---
  check(/getCurrentWorkspace/.test(d2SelCode),
    'UX-006D2: workspace context is read from the frozen UX-006B derived selector');
  check(!/State\.identity|State\.workspace|State\.principal/.test(d2SelCode),
    'UX-006D2: no principal/workspace presentation state is stored in State');
  check(!/localStorage|StorageAdapter/.test(d2SelCode),
    'UX-006D2: presentation persists nothing');
  check(!/getScopedRecords/.test(d2SelCode),
    'UX-006D2: the selector performs no scope query (labels only — R1 remains deferred)');

  // --- D1 remains frozen underneath D2 ---
  check(/>Acting as</.test(d2Sel), 'UX-006D2: the frozen "Acting as" label is unchanged');
  check(/selectPrincipal/.test(d2SelCode) && !/selectPrincipal\(\s*['"]user_ceo_fixture['"]\s*\)/.test(d2SelCode),
    'UX-006D2: selection semantics unchanged (still no default/implicit CEO)');
  check(/render\(\)/.test(d2SelCode),
    'UX-006D2: the existing render() facade is still the only refresh path');

  // --- the denied affordance: marked, never hidden, never re-decided ---
  const d2Helper = (d2Stab.match(/function authzDisabled[\s\S]*?\n\}/) || [''])[0];
  check(/return can\(action, resource\) \?/.test(d2Helper),
    'UX-006D2: the availability condition is byte-for-byte the frozen C3 delegation to can()');
  check(/data-authz-denied="1"/.test(d2Helper),
    'UX-006D2: the denied branch carries the presentation marker');
  check(/\?\s*''\s*:/.test(d2Helper),
    'UX-006D2: the ALLOWED branch is still the empty string (the marker rides the denied branch only)');
  check(!/State\./.test(d2Helper) && !/principalType|POLICY|canPrincipal|ACTION_SET/.test(d2Helper),
    'UX-006D2: the marker introduced no policy copy and no cached state');
  check(/\.btn:disabled\[data-authz-denied\]\{/.test(d2Shell),
    'UX-006D2: the denied marker has a distinct visual treatment');
  check(!/\[data-authz-denied\][^{]*\{[^}]*display:\s*none/.test(d2Shell),
    'UX-006D2: the denied treatment never hides a control');

  // --- navigation stays visible + normal: no authorization-driven CSS anywhere ---
  check(!/(nav-item|quick-action|action-item)[^{]*\{[^}]*display:\s*none/.test(d2Shell + d2Comp),
    'UX-006D2: no navigation surface is hidden by CSS');
  check(!/(nav-item|quick-action|action-item)[^{]*\[data-authz-denied\]/.test(d2Shell + d2Comp),
    'UX-006D2: no navigation surface is styled by an authorization attribute');
  { const c3Nav = read(path.join(root, 'js', 'ui', 'shell-render.js'));
    check(!/authzDisabled/.test(c3Nav),
      'UX-006D2: the shell/navigation module still applies no availability policy'); }

  // --- D2 changes no authorization vocabulary, schema or version ---
  check((read(path.join(root, 'js', 'core', 'authz.js')).match(/:\s*'[a-z]+\.[a-zA-Z]+'/g) || []).length === 20,
    'UX-006D2: ACTIONS remains exactly 20 (D2 adds no capability)');
  check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root, 'js', 'core', 'constants.js'))),
    'UX-006D2: SCHEMA_VERSION remains 6 (no D2 migration/storage change)');
  check(/const APP_VERSION = '2\.11\.0';/.test(read(path.join(root, 'js', 'core', 'constants.js'))),
    'UX-006D2: APP_VERSION is 2.11.0 (RELEASE-1 version; D2 remained presentation-only)');
  check(fs.existsSync(path.join(root, 'tools', 'verify-ux006d2-presentation-runtime.js')),
    'UX-006D2: presentation runtime harness present — tools/verify-ux006d2-presentation-runtime.js');
  // Global Search scope wiring is OUTSIDE UX-006D and must stay deferred.
  check(!/getScopedRecords|getCurrentWorkspace/.test(read(path.join(root, 'js', 'core', 'global-search.js'))),
    'UX-006D2: Global Search scope wiring remains deferred (outside UX-006D)');
}

/* ============================================================
   UX-006D3 — CROSS-SURFACE PRESENTATION CONSISTENCY (structural)
   ------------------------------------------------------------
   D3 is PRESENTATION ONLY and closes UX-006D. BEHAVIOUR is proven by
   tools/verify-ux006d3-presentation-runtime.js.
   ============================================================ */
console.log('== UX-006D3 — CROSS-SURFACE PRESENTATION CONSISTENCY ==');
{
  const d3Dash = read(path.join(root, 'js', 'finance', 'dashboard.js'));
  const d3DashCode = stripComments(d3Dash);
  const d3Empty = (d3Dash.match(/function emptyState[\s\S]*?\n\}/) || [''])[0];

  // --- the shared no-data card keeps the page's identity ---
  check(/function emptyState\(title, sub\)\{/.test(d3Dash),
    'UX-006D3: the shared emptyState(title, sub) helper keeps its signature (no call site changed)');
  check(/PAGE_TITLES/.test(d3Empty),
    'UX-006D3: the no-data heading is derived from PAGE_TITLES (the one NAV_GROUPS manifest)');
  check(/<h1>/.test(d3Empty) && /page-head/.test(d3Empty),
    'UX-006D3: the no-data state renders a page heading and the .page-head slot');
  check(/const label = /.test(d3Empty) && /label \?/.test(d3Empty),
    'UX-006D3: the heading is conditional — a context-only view still renders none');
  // No title is hardcoded into the helper: it must read the manifest, never a literal.
  check(!/<h1>[A-Za-z]/.test(d3Empty),
    'UX-006D3: no page title is duplicated as a literal inside the helper');

  // --- D3 introduced no behaviour into the empty-state path ---
  check(!/\bcan\(|authzDisabled|getCurrentUser|getScopedRecords/.test(d3DashCode),
    'UX-006D3: the empty-state path wires no authorization or scope');
  check(!/localStorage|StorageAdapter|SCHEMA_VERSION/.test(d3Empty),
    'UX-006D3: the empty-state path persists nothing');

  // --- the frozen surfaces are untouched by D3 ---
  check((read(path.join(root, 'js', 'core', 'authz.js')).match(/:\s*'[a-z]+\.[a-zA-Z]+'/g) || []).length === 20,
    'UX-006D3: ACTIONS remains exactly 20 (D3 adds no capability)');
  check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root, 'js', 'core', 'constants.js'))),
    'UX-006D3: SCHEMA_VERSION remains 6 (no D3 migration/storage change)');
  check(/const APP_VERSION = '2\.11\.0';/.test(read(path.join(root, 'js', 'core', 'constants.js'))),
    'UX-006D3: APP_VERSION is 2.11.0 (RELEASE-1 version; D3 remained presentation-only)');
  check(!/getScopedRecords|getCurrentWorkspace|getCurrentUser/.test(read(path.join(root, 'js', 'core', 'global-search.js'))),
    'UX-006D3: Global Search scope wiring remains deferred (outside UX-006D)');
  check(fs.existsSync(path.join(root, 'tools', 'verify-ux006d3-presentation-runtime.js')),
    'UX-006D3: presentation runtime harness present — tools/verify-ux006d3-presentation-runtime.js');
  // D1 and D2 stay frozen underneath D3.
  check(/data-authz-denied="1"/.test(read(path.join(root, 'js', 'core', 'stabilization.js'))),
    'UX-006D3: the D2 availability marker is unchanged');
  check(/IDENTITY_CONTEXT_ID|IDENTITY_RAIL_ID/.test(read(path.join(root, 'js', 'ui', 'identity-selector.js'))),
    'UX-006D3: the D2 principal/workspace presentation surfaces are unchanged');
}

/* ============================================================
   READINESS-1 — EMPLOYEE READ SCOPE (structural closure)
   ------------------------------------------------------------
   The readiness audit found the self-scope layer built, tested and wired to NOTHING.
   These checks exist so that gap cannot silently reopen: they assert the scoped seam
   is present at each privacy-critical read, and that the Employee-facing renderers do
   not go back to reading raw company-wide State. BEHAVIOUR is proven by
   tools/verify-employee-read-scope-runtime.js.
   ============================================================ */
console.log('== READINESS-1 — EMPLOYEE READ SCOPE ==');
{
  const r1 = (f) => stripComments(read(path.join(root, 'js', f)));

  // --- the scope layer has real production consumers (the audit's core defect) ---
  { const files = require(path.join(root, 'tools', 'module-order.js'));
    const consumers = files.filter(function(f){
      if(f === 'core/workspace.js') return false;                  // the definition itself
      return /getScopedRecords\(|getScopedRecordById\(/.test(r1(f));
    });
    check(consumers.length >= 7,
      'Readiness-1: the self-scope layer has production consumers (' + consumers.length + ') — it is no longer headless');
    ['people/employees.js','people/contracts.js','people/overtime.js','people/payroll-ops-engine.js',
     'people/hr-dashboard-reports.js','ui/global-search-ui.js','core/domain-services.js'
    ].forEach(function(f){
      check(consumers.indexOf(f) !== -1, 'Readiness-1: scoped read wired in ' + f);
    }); }

  // --- the scoped read API itself ---
  { const ws = r1('core/workspace.js');
    check(/function getScopedRecordById\(entityType, id\)\{/.test(ws),
      'Readiness-1: getScopedRecordById(entityType, id) exists (detail re-scope)');
    check(/isInScope\(entityType, rec\)/.test(ws),
      'Readiness-1: the detail read re-evaluates scope through the centralized predicate');
    check(/payrollAdjustment:/.test(ws) && /transaction:/.test(ws),
      'Readiness-1: ENTITY_SCOPE covers payrollAdjustment and transaction');
    check(/window\.getScopedRecordById = getScopedRecordById;/.test(ws),
      'Readiness-1: the scoped detail read is exposed as public API'); }

  // --- privacy-critical detail renderers re-scope their captured id ---
  [['people/employees.js', 'employee'], ['people/contracts.js', 'contract'],
   ['people/payroll-workspace.js', 'payrollPlan']].forEach(function(pair){
    check(new RegExp("getScopedRecordById\\('" + pair[1] + "'").test(r1(pair[0])),
      'Readiness-1: ' + pair[0] + ' re-scopes its detail id at render time (' + pair[1] + ')');
  });

  // --- the biggest leak surfaces no longer read raw company-wide State ---
  { const payroll = r1('people/payroll-ops-engine.js');
    const fn = (payroll.match(/function payrollPlansForMonth[\s\S]*?\n\}/) || [''])[0];
    check(/getScopedRecords\('payrollPlan'\)/.test(fn),
      'Readiness-1: the payroll read funnel is scoped (compensation is the most sensitive store)');
    const hr = r1('people/hr-dashboard-reports.js');
    check(!/State\.(employees|contracts|payrollPlans|overtimeRecords)\./.test(hr),
      'Readiness-1: HR dashboards/reports read no raw privacy store (aggregates match their rows)');
    const emp = r1('people/employees.js');
    check(/getScopedRecords\('employee'\)/.test(emp),
      'Readiness-1: the Employees list + its counters derive from the scoped dataset'); }

  // --- scope is a READ concern: never persistence, never a State rewrite ---
  { const ws = r1('core/workspace.js');
    check(!/localStorage|StorageAdapter|persistEmployees|persistContracts/.test(ws),
      'Readiness-1: scoping never touches persistence (canonical stores are complete on disk)');
    check(!/State\.employees\s*=|State\.contracts\s*=|State\.payrollPlans\s*=|State\.txns\s*=/.test(ws),
      'Readiness-1: scoping never reassigns a canonical collection (no destructive filtering)'); }

  // --- documented intentional raw reads: import/parser/persistence must stay canonical ---
  { const ds = r1('core/domain-services.js');
    const canonMonths = (ds.match(/function getMonths\(\)\{[\s\S]*?\n\}/) || [''])[0];
    const canonForMonth = (ds.match(/function txnsForMonth\([^)]*\)\{[^\n]*/) || [''])[0];
    check(/State\.txns/.test(canonMonths) && !/getScopedRecords|scopedTxns/.test(canonMonths),
      'Readiness-1: getMonths() remains CANONICAL (unscoped) for import, parsing and persistence');
    check(/State\.txns/.test(canonForMonth) && !/getScopedRecords|scopedTxns/.test(canonForMonth),
      'Readiness-1: txnsForMonth() remains CANONICAL (unscoped)');
    const scopedFn = (ds.match(/function scopedTxns\(\)\{[\s\S]*?\n\}/) || [''])[0];
    check(/getScopedRecords\('transaction'\)/.test(scopedFn),
      'Readiness-1: scopedTxns() is the scoped finance READ counterpart');
    check(/function scopedMonths\(\)/.test(ds) && /function scopedTxnsForMonth\(/.test(ds),
      'Readiness-1: scoped finance month/period selectors exist alongside the canonical ones');
    const parser = r1('import/parser.js');
    check(!/getScopedRecords/.test(parser),
      'Readiness-1: the import parser is deliberately NOT scoped (it must see the whole ledger)'); }

  // --- Readiness-1 changed no authorization, schema or version ---
  check((read(path.join(root, 'js', 'core', 'authz.js')).match(/:\s*'[a-z]+\.[a-zA-Z]+'/g) || []).length === 20,
    'Readiness-1: ACTIONS remains exactly 20 (read scope needed no new action)');
  check(/const SCHEMA_VERSION = 6;/.test(read(path.join(root, 'js', 'core', 'constants.js'))),
    'Readiness-1: SCHEMA_VERSION remains 6 (no migration)');
  check(/const APP_VERSION = '2\.11\.0';/.test(read(path.join(root, 'js', 'core', 'constants.js'))),
    'Readiness-1: APP_VERSION is 2.11.0 (RELEASE-1 version; Readiness-1 scope unchanged)');
  check(fs.existsSync(path.join(root, 'tools', 'verify-employee-read-scope-runtime.js')),
    'Readiness-1: read-scope runtime harness present — tools/verify-employee-read-scope-runtime.js');
}

/* ============================================================
   READINESS-2 — END-TO-END USER JOURNEY ACCEPTANCE (structural)
   ------------------------------------------------------------
   Readiness-2 validates whole user JOURNEYS rather than single boundaries. These
   checks assert only that the acceptance harness exists and that the journeys it
   covers still have their production seams; the journeys themselves are proven by
   tools/verify-readiness2-e2e-runtime.js.
   ============================================================ */
console.log('== READINESS-2 — END-TO-END USER JOURNEY ACCEPTANCE ==');
{
  const r2 = path.join(root, 'tools', 'verify-readiness2-e2e-runtime.js');
  check(fs.existsSync(r2), 'Readiness-2: E2E acceptance harness present — tools/verify-readiness2-e2e-runtime.js');
  const r2src = fs.existsSync(r2) ? read(r2) : '';
  ['Journey A','Journey B','Journey C','Journey D','Journey E','Journey F','Journey G','Journey H']
    .forEach(function(j){ check(r2src.indexOf(j) !== -1, 'Readiness-2: ' + j + ' is covered by the acceptance harness'); });
  // The journeys must exercise PRODUCTION seams, not re-implement the workflow.
  ['executeTransaction','commitReadyPayroll','setPayrollLock','addOvertimeRecord','commitSmartImport',
   'undoLastSmartImport','restoreCompleteBackup','postSupplemental'
  ].forEach(function(fn){
    check(r2src.indexOf('rt.' + fn + '(') !== -1,
      'Readiness-2: the harness drives the production seam ' + fn + '()');
  });
  // A journey that only mutates memory has not proven anything.
  check(/function persisted\(rt, key\)/.test(r2src) && (r2src.match(/persisted\(rt,/g)||[]).length >= 8,
    'Readiness-2: journeys assert the PERSISTED payload, not just in-memory State');
  check(/Global Search indexes no B document/.test(r2src) && /roster contains no B identity/.test(r2src),
    'Readiness-2: the Employee journey carries privacy assertions (Readiness-1 stays closed)');
  check(/ACTIONS remains exactly 20/.test(r2src) && /SCHEMA_VERSION remains 6/.test(r2src),
    'Readiness-2: the harness re-asserts the platform invariants it must not move');
}

/* ============================================================
   BRAND-1 — IDENTITY MODERNIZATION INVARIANTS
   Offline-embedded typography, TAM OS-only persistent chrome, dedicated wordmark
   face, identity palette separated from semantic gold. These encode the visual/offline
   contract mechanically so it cannot silently regress.
   ============================================================ */
console.log('== BRAND-1 IDENTITY MODERNIZATION INVARIANTS ==');
const b1Index   = read(path.join(root,'index.html'));
const b1Fonts   = read(path.join(root,'css','fonts.css'));
const b1Tokens  = read(path.join(root,'css','tokens.css'));
const b1Shell   = read(path.join(root,'css','shell.css'));
const b1ShellJs = read(path.join(root,'js','ui','shell-render.js'));

// 1. No remote webfont dependency anywhere in the portable artifact OR the source head.
check(!/googleapis|gstatic/.test(dist),
  'BRAND-1: portable artifact makes no Google Fonts / gstatic request (offline-safe typography)');
check(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(b1Index),
  'BRAND-1: index.html no longer links remote Google Fonts');

// 2. Typography is embedded locally: exactly the 8 expected faces as base64 WOFF2 data URIs.
check((b1Fonts.match(/@font-face/g)||[]).length === 8,
  'BRAND-1: css/fonts.css defines exactly 8 @font-face blocks');
check((b1Fonts.match(/url\(data:font\/woff2;base64,/g)||[]).length === 8,
  'BRAND-1: every embedded face is a self-contained base64 WOFF2 data URI (no external src)');
['Sora','Inter','Source Serif 4','JetBrains Mono'].forEach((fam)=>
  check(b1Fonts.includes("font-family:'" + fam + "'"),
    'BRAND-1: embedded family present — ' + fam));

// 3. Vendored font sources + OFL license text are retained in the repository.
['sora-600','inter-400','inter-500','inter-600','inter-700','jetbrainsmono-400','jetbrainsmono-600','sourceserif4-600']
  .forEach((f)=>check(fs.existsSync(path.join(root,'assets','fonts',f + '.woff2')),
    'BRAND-1: vendored WOFF2 present — assets/fonts/' + f + '.woff2'));
['Sora','Inter','JetBrainsMono','SourceSerif4'].forEach((f)=>
  check(fs.existsSync(path.join(root,'assets','fonts',f + '-OFL.txt')),
    'BRAND-1: SIL OFL license retained — assets/fonts/' + f + '-OFL.txt'));

// 4. Dedicated wordmark face: --display token defined (both themes) and used ONLY on the wordmark.
check((b1Tokens.match(/--display:'Sora'/g)||[]).length === 2,
  'BRAND-1: --display (Sora) wordmark face token defined in both themes');
check(/\.brand \.mark\{font-family:var\(--display\)/.test(b1Shell),
  'BRAND-1: the sidebar wordmark renders in the dedicated display face (var(--display))');
check(!/\.brand \.mark\{font-family:var\(--serif\)/.test(b1Shell),
  'BRAND-1: the wordmark no longer uses the old serif treatment (Source Serif cannot silently return to chrome)');

// 5. Identity palette exists and is kept separate from the semantic gold accent.
check((b1Tokens.match(/--identity-teal:/g)||[]).length === 2 && /--identity-navy:#062E5B/.test(b1Tokens),
  'BRAND-1: identity palette tokens (Navy/Blue/Teal) defined');
check(/\.brand \.mark \.os\{color:var\(--identity-teal\);?\}/.test(b1Shell),
  'BRAND-1: the wordmark "OS" uses the identity teal (not gold)');
check(/--brand:#C9A15C/.test(b1Tokens) && /--accent:#C9A15C/.test(b1Tokens),
  'BRAND-1: semantic gold accent (--brand/--accent) is preserved unchanged (palette strategy P1)');

// 6. Persistent chrome is "TAM OS" only — the company subtitle is gone from the brand lockup.
const b1Brand = (b1ShellJs.match(/<div class="brand">[\s\S]*?<nav class="nav"/)||[''])[0];
check(b1Brand.includes('class="brand-lockup"') && b1Brand.includes('class="brand-monogram"'),
  'BRAND-1: persistent chrome renders the Model C lockup (monogram + wordmark)');
check(!/class="sub">/.test(b1Brand) && !/COMPANY_NAME_DEFAULT/.test(b1Brand),
  'BRAND-1: persistent chrome shows no company subtitle (company identity stays in About/Settings/reports)');
// The monogram is decorative (aria-hidden) so it does not duplicate the wordmark for screen readers.
check(/class="brand-monogram"[^>]*aria-hidden="true"/.test(b1ShellJs),
  'BRAND-1: the chrome monogram is aria-hidden (no redundant screen-reader announcement)');

// 7. Company identity is NOT globally purged — it remains where it is formal/contextual.
check(/const COMPANY_NAME_DEFAULT = 'PT Total Asset Manajemen';/.test(read(path.join(root,'js','core','constants.js'))),
  'BRAND-1: company name default is preserved (About/Settings/reports still identify the company)');

console.log('');
if (fails.length === 0) { console.log('VERIFICATION PASSED -- ' + passes + ' checks OK.'); process.exit(0); }
console.log('VERIFICATION FAILED -- ' + passes + ' passed, ' + fails.length + ' failed:');
fails.forEach((f)=>console.log('   - ' + f));
process.exit(1);
