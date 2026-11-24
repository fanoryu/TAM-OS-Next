// @ts-check
/*
 * TAM OS browser QA suite — TEST-ONLY. Run only by .github/workflows/browser-qa.yml from the trusted
 * harness checkout, against the APPROVED application commit's SESSION package served by its
 * tools/serve-e2e-proxy.js on http://localhost (one origin, loopback only) and its real PHP backend,
 * seeded with FABRICATED records by seed.php (two companies).
 *
 * Serial, one Chromium worker. Every test fails on an uncaught page exception, an application
 * console error, a Content-Security-Policy violation or a 5xx answer — reported as CATEGORIES and
 * COUNTS only (never a message text). The one standing tolerated console line is the browser's own
 * network-status line for the signed-out session check (GET /api/auth/me answered 401, CLAUDE.md
 * §12.2); a status a test provokes on purpose is tolerated for that path, in that test, only.
 *
 * Credential safety: passwords are typed through wrappers whose failures name the field only;
 * cookies are asserted as scalar flags, never as objects; the CSRF token never leaves the page
 * (probes read it from /api/auth/me inside the page); no assertion receives an auth response body.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('@playwright/test');

const BASE = process.env.BQA_BASE_URL || '';
const STATE_PATH = process.env.BQA_STATE || '';
const APP_DIR = process.env.BQA_APP_DIR || '';
if (!/^http:\/\/localhost:[0-9]{2,5}$/.test(BASE)) throw new Error('BQA_BASE_URL must be http://localhost:<port> (loopback only).');
if (!STATE_PATH || !fs.existsSync(STATE_PATH)) throw new Error('BQA_STATE must name the seed state file.');
if (!APP_DIR || !fs.existsSync(path.join(APP_DIR, 'server', 'src', 'bootstrap.php'))) throw new Error('BQA_APP_DIR must name the application checkout.');
const S = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
const W = S.window;
const GA = S.ledger.filter((t) => t.financialPost === 'GA');
const POST_NAMES = { GA: 'GA', NPIP: 'NP & IP', TJB: 'TJB', DRONE: 'RnD — Research & Development' };
const KIND_LABELS = { income: 'Income', expense: 'Expense' };
const CSV_HEADER = ['Date', 'Type', 'Financial Post', 'Category', 'Description', 'Amount (Rp)', 'Status', 'Void reason'];
// The application's own rule (js/core/session-csv.js SESSION_CSV_UNSAFE_START): such cells get a leading apostrophe.
const CSV_UNSAFE_START = /^[=+\-@\uff1d\uff0b\uff0d\uff20\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f\u2060\ufeff]/;
const VOID_REASON = 'BQA fabricated void reason';
const RECORD = { kind: 'expense', financialPost: 'GA', category: 'UI Record', description: 'BQA recorded through the browser UI', amount: '33000.00' };

test.describe.configure({ mode: 'serial' });
test.setTimeout(90000);

// ---- BQA-PURE-BEGIN: diagnostic categories and the status-cell parser ---------------------------
// Self-contained (no Playwright, no state, no I/O) so test 00 and an offline harness exercise exactly
// this text. Whatever may reach a report, an assertion message or a log passes through one of these:
// a value is either a member of a fixed list or a fixed placeholder — never the observed text.
const BQA_API_ROUTES = Object.freeze([
  '/api/auth/login', '/api/auth/logout', '/api/auth/me', '/api/health', '/api/ready',
  '/api/employee', '/api/employees', '/api/general-transactions', '/api/general-transactions/create',
  '/api/general-transactions/void', '/api/reports/financial', '/api/finance-request', '/api/finance-requests',
  '/api/finance-requests/approve', '/api/finance-requests/pay', '/api/finance-requests/create',
  '/api/finance-requests/submit', '/api/audit-events', '/api/audit-events/record']);
// The server's ErrorCode enum (server/src/Http/ErrorCode.php): the only codes a client may be shown.
const BQA_ERROR_CODES = Object.freeze(['malformed_json', 'invalid_query', 'validation_failed', 'unauthenticated',
  'forbidden', 'not_found', 'method_not_allowed', 'conflict', 'payload_too_large', 'unsupported_media_type',
  'rate_limited', 'internal_error', 'service_unavailable']);
const BQA_ERROR_NAMES = Object.freeze(['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError',
  'URIError', 'EvalError', 'AggregateError', 'DOMException']);
const BQA_CSP_DIRECTIVES = Object.freeze(['default-src', 'script-src', 'script-src-elem', 'script-src-attr',
  'style-src', 'style-src-elem', 'style-src-attr', 'img-src', 'font-src', 'connect-src', 'media-src',
  'object-src', 'frame-src', 'child-src', 'worker-src', 'manifest-src', 'frame-ancestors', 'form-action',
  'base-uri', 'require-trusted-types-for', 'trusted-types']);

/** A URL or path → a fixed category: a listed API route, 'api:other', 'page', 'asset' or 'other'. */
function pathCategory(urlOrPath) {
  let p;
  try { p = new URL(String(urlOrPath), 'http://localhost/').pathname; } catch (e) { return 'other'; }
  if (BQA_API_ROUTES.includes(p)) return p;
  if (p.startsWith('/api/')) return 'api:other';
  if (p === '/' || p === '/index.html') return 'page';
  if (/^\/(css|js|vendor)\//.test(p)) return 'asset';
  return 'other';
}
/** A server error code → itself when it is an ErrorCode, null when absent, otherwise 'other'. */
function errorCodeCategory(v) { return v === null || v === undefined ? null : (BQA_ERROR_CODES.includes(v) ? v : 'other'); }
function errorNameCategory(v) { return BQA_ERROR_NAMES.includes(v) ? v : 'other'; }
function cspCategory(v) { return BQA_CSP_DIRECTIVES.includes(v) ? v : 'other'; }
function sameSiteCategory(v) { return ['Strict', 'Lax', 'None'].includes(v) ? v : 'other'; }
function cookiePathCategory(v) { return v === '/' ? '/' : 'other'; }

const BQA_ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", nbsp: String.fromCharCode(160) });
function decodeHtmlText(s) { return String(s).replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (m, e) => BQA_ENTITIES[e]); }
// The ledger's two Status badges exactly as the application renders them (js/ui/session-ledger-view.js:
// statusBadgeHTML('Active', 'done') and statusBadgeHTML('Voided', 'stop') + ' ' + escapeHtml(reason)).
// Test 00 fails if the application's own helper stops producing these exact strings.
const BQA_ACTIVE_BADGE = '<span class="ux-badge ux-tone-done"><span class="ux-badge-mark" aria-hidden="true">✓</span>Active</span>';
const BQA_VOIDED_BADGE = '<span class="ux-badge ux-tone-stop"><span class="ux-badge-mark" aria-hidden="true">✕</span>Voided</span>';
/**
 * A ledger Status cell's HTML → { label, reason }, strictly. Accepted are exactly two shapes:
 * the Active badge alone, or the Voided badge + one space + a non-blank, markup-free reason. The
 * decorative mark is accepted only as the application's own glyph for that status, so a duplicated,
 * contradictory, hidden or re-labelled status — or a Voided row without a reason, or an Active row
 * with one — is { label: 'unrecognised', reason: '' } and fails the row comparison against the API.
 */
function statusFromCellHtml(html) {
  const bad = { label: 'unrecognised', reason: '' };
  if (typeof html !== 'string') return bad;
  if (html === BQA_ACTIVE_BADGE) return { label: 'Active', reason: '' };
  if (!html.startsWith(BQA_VOIDED_BADGE + ' ')) return bad;
  const rest = html.slice(BQA_VOIDED_BADGE.length + 1);
  if (/[<>]/.test(rest) || /&(?!(amp|lt|gt|quot|#39|#x27|nbsp);)/.test(rest)) return bad;
  const reason = decodeHtmlText(rest);
  if (reason.trim() === '') return bad;
  return { label: 'Voided', reason };
}

// Fixed names for page and process operations whose failure must not carry an observed message.
const BQA_OPERATIONS = Object.freeze(['probe', 'navigate', 'read-ledger-rows', 'read-money', 'read-consolidated',
  'read-marked-rows', 'read-focus', 'read-page-text', 'expire-sessions']);
/** Runs fn; on failure throws a NEW error naming only the fixed operation (no message, no cause). */
async function bqaGuarded(operation, fn) {
  const name = BQA_OPERATIONS.includes(operation) ? operation : 'other';
  let value;
  let failed = false;
  try { value = await fn(); } catch (e) { failed = true; }
  if (failed) throw new Error('page operation failed: ' + name);
  return value;
}
/** Async half of the self-check: a failing operation never surfaces the thrown value. */
async function bqaGuardSelfCheck(tokens) {
  const failures = [];
  let n = 0;
  const check = (name, ok) => { n++; if (!ok) failures.push(name); };
  for (const tok of tokens) {
    const throwers = [() => { throw new Error(tok); }, () => Promise.reject(new Error('x ' + tok)), () => Promise.reject(tok),
      async () => { const e = new TypeError(tok); e.cause = tok; throw e; }, () => { throw { message: tok, stack: tok }; }];
    for (const f of throwers) {
      let caught = null;
      try { await bqaGuarded('probe', f); } catch (e) { caught = e; }
      const text = caught ? String(caught.message) + String(caught.stack) + JSON.stringify(Object.getOwnPropertyNames(caught).map((k) => String(caught[k]))) : '';
      check('guarded failure rethrown', caught instanceof Error && caught.message === 'page operation failed: probe');
      check('guarded failure carries no observed text', !text.includes(tok) && caught.cause === undefined);
    }
  }
  let unknown = null;
  try { await bqaGuarded(tokens[0], () => { throw new Error('x'); }); } catch (e) { unknown = e; }
  check('unknown operation name not echoed', unknown && unknown.message === 'page operation failed: other');
  check('success passes the value through', (await bqaGuarded('read-focus', async () => 42)) === 42);
  return { failures, cases: n };
}

/**
 * Regression self-check, run by test 00 and offline. `badge` / `esc` are the APPLICATION's own
 * statusBadgeHTML and escapeHtml. Returns failing CASE NAMES only — never an observed value.
 */
function bqaSelfCheck(badge, esc) {
  const failures = [];
  let n = 0;
  const check = (name, ok) => { n++; if (!ok) failures.push(name); };
  // Fabricated, token-shaped values: none is a real credential.
  const tokens = ['ghp_BQAfabricatedTOKEN000000000000000000000', 'eyJhbGciOiJub25lIn0.QlFBZmFicmljYXRlZA.c2lnbmF0dXJl',
    '__Host-tamos_session=bqa0fabricated0cookie0value', 'Bearer bqa-fabricated-bearer-0000', 'Bqa-Fabricated-Passw0rd!',
    'csrf_bqa_fabricated_0123456789abcdef', 'mysql://tamos_bqa:browser-qa-only-not-a-secret@127.0.0.1/tamos_browser_qa'];
  const outputs = [];
  const out = (v) => { outputs.push(v); return v; };
  for (const tok of tokens) {
    const enc = encodeURIComponent(tok);
    check('route query dropped', out(pathCategory('/api/auth/me?token=' + enc)) === '/api/auth/me');
    check('route absolute url', out(pathCategory('http://localhost:8768/api/general-transactions?from=' + enc)) === '/api/general-transactions');
    check('unknown api path', out(pathCategory('/api/' + enc)) === 'api:other');
    check('unknown api subpath', out(pathCategory('/api/employee/' + enc)) === 'api:other');
    check('unknown page path', out(pathCategory('/' + enc)) === 'other');
    check('asset path', out(pathCategory('/js/' + enc)) === 'asset');
    check('unparseable url', out(pathCategory('http://[' + tok)) === 'other');
    check('arbitrary error code', out(errorCodeCategory(tok)) === 'other');
    check('code-shaped error code', out(errorCodeCategory('forbidden_' + tok.replace(/[^a-z_]/g, ''))) === 'other');
    check('arbitrary error name', out(errorNameCategory(tok)) === 'other');
    check('arbitrary csp directive', out(cspCategory(tok)) === 'other');
    check('arbitrary samesite', out(sameSiteCategory(tok)) === 'other');
    check('arbitrary cookie path', out(cookiePathCategory('/' + tok)) === 'other');
    check('non-string error code', out(errorCodeCategory({ code: tok })) === 'other');
  }
  const flat = JSON.stringify(outputs);
  check('no token text in any category', tokens.every((tok) => !flat.includes(tok) && !flat.includes(encodeURIComponent(tok))));
  check('known code kept', errorCodeCategory('forbidden') === 'forbidden' && errorCodeCategory('not_found') === 'not_found');
  check('absent code is null', errorCodeCategory(null) === null && errorCodeCategory(undefined) === null);
  check('known name kept', errorNameCategory('TypeError') === 'TypeError');
  check('known csp kept', cspCategory('script-src-elem') === 'script-src-elem');
  check('strict kept', sameSiteCategory('Strict') === 'Strict' && cookiePathCategory('/') === '/');
  check('listed routes kept', BQA_API_ROUTES.every((r) => pathCategory(r) === r));
  check('known pages', pathCategory('/') === 'page' && pathCategory('/index.html') === 'page');

  // Status cell: the application's real markup (ledger view: badge, then ' ' + escaped reason).
  const ACTIVE = badge('Active', 'done');
  const VOIDED = badge('Voided', 'stop');
  check('app Active badge is the parsed shape', ACTIVE === BQA_ACTIVE_BADGE);
  check('app Voided badge is the parsed shape', VOIDED === BQA_VOIDED_BADGE);
  const NBSP = String.fromCharCode(160);
  const reasons = ['BQA fabricated void reason', 'R&D <b>bold</b> "quoted" \'single\'', 'a' + NBSP + 'b', 'Active by mistake', '✕ lookalike'];
  const voidedCell = (r) => VOIDED + ' ' + esc(r);
  // How a browser re-serialises the same text node through innerHTML: quotes literal, NBSP as an entity.
  const browserSerialised = (h) => h.replace(/&quot;/g, '"').replace(/&#39;/g, "'").split(NBSP).join('&nbsp;');
  const a = statusFromCellHtml(ACTIVE);
  check('real Active markup passes', a.label === 'Active' && a.reason === '');
  for (const r of reasons) {
    for (const [name, h] of [['source', voidedCell(r)], ['innerHTML', browserSerialised(voidedCell(r))]]) {
      const v = statusFromCellHtml(h);
      check('real Voided markup with reason passes (' + name + ')', v.label === 'Voided' && v.reason === r);
    }
  }
  // The earlier defect: in the real Voided badge the decorative mark's text comes before the visible
  // label, so a visible-text rule "starts with Voided" could never match. Checked by position in the
  // application's own markup (already equal to BQA_VOIDED_BADGE above); no tag stripping.
  const VOIDED_MARK = '<span class="ux-badge-mark" aria-hidden="true">✕</span>';
  check('decorative mark precedes the visible Voided label',
    VOIDED.indexOf(VOIDED_MARK) > 0 && VOIDED.indexOf(VOIDED_MARK + 'Voided</span>') === VOIDED.indexOf(VOIDED_MARK));
  // Malformed, contradictory, duplicated or ambiguous cells: every one must be rejected.
  const malformed = {
    'Voided without a reason': VOIDED,
    'Voided with a blank reason': VOIDED + ' ',
    'Voided with a whitespace reason': VOIDED + ' ' + NBSP + '  ',
    'Active with a trailing reason': ACTIVE + ' leftover reason',
    'Active with a trailing Voided label': ACTIVE + ' Voided',
    'Active then Voided badges': ACTIVE + VOIDED + ' r',
    'Voided then Active badges': VOIDED + ' ' + ACTIVE,
    'Active badge twice': ACTIVE + ACTIVE,
    'Voided badge twice': VOIDED + ' ' + VOIDED + ' r',
    'hidden Active label in the Voided mark': VOIDED.replace('>✕<', '>Active<') + ' r',
    'hidden Voided label in the Active mark': ACTIVE.replace('>✓<', '>Voided<'),
    'hidden status span before the badge': '<span aria-hidden="true">Voided</span>' + ACTIVE,
    'hidden status span after the badge': ACTIVE + '<span aria-hidden="true">Voided</span>',
    'Voided label with the Active mark': badge('Voided', 'done') + ' r',
    'Active label with the Voided mark': badge('Active', 'stop'),
    'mark missing': '<span class="ux-badge ux-tone-done">Active</span>',
    'mark class lookalike': ACTIVE.replace('class="ux-badge ux-tone-done"', 'class="ux-badge-mark ux-tone-done"'),
    'label padded': ACTIVE.replace('</span>Active<', '</span> Active<'),
    'label lower case': ACTIVE.replace('</span>Active<', '</span>active<'),
    'other label': badge('Pending', 'info'),
    'leading whitespace': ' ' + ACTIVE,
    'markup in the reason': VOIDED + ' <b>x</b>',
    'unknown entity in the reason': VOIDED + ' a &copy; b',
    'no separator before the reason': VOIDED + 'r',
    'plain text Voided': 'Voided because',
    'plain text Active': 'Active',
    'empty cell': '',
  };
  for (const [name, h] of Object.entries(malformed)) check('rejects: ' + name, statusFromCellHtml(h).label === 'unrecognised');
  check('rejects a non-string cell', statusFromCellHtml(null).label === 'unrecognised' && statusFromCellHtml(undefined).label === 'unrecognised');
  // A genuinely wrong status stays visible to the row comparison against the API.
  check('wrong status differs from the API value', statusFromCellHtml(voidedCell('r')).label !== 'Active' && statusFromCellHtml(ACTIVE).label !== 'Voided');
  return { failures, cases: n, tokens };
}
// ---- BQA-PURE-END --------------------------------------------------------------------------------

// ---- problem collection: categories and counts only --------------------------------------------
function safePath(url) { return pathCategory(url); }

async function openPage(browser) {
  const context = await browser.newContext({ baseURL: BASE, acceptDownloads: true });
  await context.addInitScript(() => {
    window.__bqaCsp = [];
    document.addEventListener('securitypolicyviolation', (e) => { window.__bqaCsp.push(String(e.effectiveDirective || e.violatedDirective || 'unknown')); });
  });
  const page = await context.newPage();
  const counts = {};
  const tolerate = [{ path: '/api/auth/me', status: 401 }];
  const add = (category) => { counts[category] = (counts[category] || 0) + 1; };
  page.on('pageerror', (e) => add('pageerror:' + errorNameCategory(e && e.name)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const where = safePath((m.location() && m.location().url) || '');
    const status = /status of ([0-9]{3})\b/.exec(m.text());          // classified, never stored
    if (status && tolerate.some((x) => x.path === where && String(x.status) === status[1])) return;
    add(status ? 'console-status-' + status[1] + ':' + where : 'console-error:' + where);
  });
  page.on('response', (r) => { if (r.status() >= 500) add('http-' + r.status() + ':' + safePath(r.url())); });
  return { context, page, counts, tolerate };
}

async function assertClean(t) {
  let csp = [];
  try { csp = await t.page.evaluate(() => window.__bqaCsp || []); } catch (e) { csp = ['page-unavailable']; }
  const all = Object.assign({}, t.counts);
  csp.forEach((d) => { const k = 'csp:' + cspCategory(d); all[k] = (all[k] || 0) + 1; });
  expect(all, 'problem categories (counts only, never messages)').toEqual({});
}

// ---- credential-safe input -----------------------------------------------------------------------
async function fillSecret(page, selector, value) {
  try { await page.locator(selector).fill(value); } catch (e) { throw new Error('could not fill ' + selector); }
}
async function typeSecret(page, value) {
  try { await page.keyboard.type(value); } catch (e) { throw new Error('could not type into the focused field'); }
}

async function signIn(page, who) {
  await page.goto('/');
  await expect(page.locator('#authSignInForm')).toBeVisible();
  await fillSecret(page, '#authEmail', who.email);
  await fillSecret(page, '#authPassword', who.password);
  await page.click('#authSignInBtn');
  await expect(page.locator('#swSectionHome')).toBeVisible();
}

/** Cookie flags as scalars only; the value is never read into an assertion or a log. */
async function sessionCookieFlags(context) {
  const all = await context.cookies();
  const c = all.filter((k) => k.name === '__Host-tamos_session');
  return { count: c.length, secure: c.length === 1 && c[0].secure === true, httpOnly: c.length === 1 && c[0].httpOnly === true,
    path: c.length === 1 ? cookiePathCategory(c[0].path) : '', sameSite: c.length === 1 ? sameSiteCategory(c[0].sameSite) : '', hasDomainAttribute: c.length === 1 && c[0].domain.startsWith('.') };
}

/**
 * A same-origin request made BY THE PAGE (fetch), so it carries exactly the cookie the browser
 * accepted. With csrf, the page reads its own CSRF token from /api/auth/me and sends it; the token
 * never leaves the page. Returns { status, code, data } — data only for non-auth reads.
 */
async function probe(t, method, url, expectStatus, opts = {}) {
  const p = url.split('?')[0];
  if (expectStatus >= 400) t.tolerate.push({ path: pathCategory(p), status: expectStatus });
  const out = await bqaGuarded('probe', () => t.page.evaluate(async ({ method, url, body, csrf, wantData }) => {
    const headers = {};
    if (csrf) {
      const me = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const j = me.ok ? await me.json() : null;
      if (!j || !j.data || typeof j.data.csrfToken !== 'string') return { status: -1, code: 'no_csrf', data: null };
      headers['X-CSRF-Token'] = j.data.csrfToken;
    }
    const init = { method, credentials: 'same-origin', headers };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const r = await fetch(url, init);
    let j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    return { status: r.status, code: j && j.error && typeof j.error.code === 'string' ? j.error.code : null, data: wantData && j && j.ok ? j.data : null };
  }, { method, url, body: opts.body, csrf: !!opts.csrf, wantData: !!opts.data && !p.startsWith('/api/auth/') }));
  // Only fixed categories leave this function besides the data of a non-auth read: an unexpected
  // status is a number, an unexpected error code becomes 'other' (never the server's raw text).
  return { status: Number.isInteger(out.status) ? out.status : -1, code: out.code === 'no_csrf' ? 'no_csrf' : errorCodeCategory(out.code), data: out.data };
}
async function read(t, url) {
  const r = await probe(t, 'GET', url, 200, { data: true });
  expect(r.status, 'GET ' + pathCategory(url)).toBe(200);
  return r.data;
}

// ---- view helpers --------------------------------------------------------------------------------
async function goTo(page, button, hash) {
  const b = page.locator('#' + button);
  if (await b.isVisible()) await b.click();
  else await bqaGuarded('navigate', () => page.evaluate((h) => { location.hash = '#/' + h; }, hash));
}

async function setLedgerRange(page, from, to) {
  await page.fill('#sfFrom', from);
  await page.fill('#sfTo', to);
  await page.click('#sfApplyBtn');
  await expect(page.locator('#sfViewTitle')).toContainText(from === to ? from : from + ' to ' + to);
}

/** The visible ledger rows as the eight CSV columns, read from the rendered table. */
async function visibleLedgerRows(page) {
  const raw = await bqaGuarded('read-ledger-rows', () => page.locator('#sfList tbody tr').evaluateAll((trs) => trs.map((tr) => {
    const td = tr.querySelectorAll('td');
    const money = td[5].querySelector('data.ux-money');
    return [td[0].innerText.trim(), td[1].innerText.trim(), td[2].innerText.trim(), td[3].innerText.trim(), td[4].innerText,
      money ? money.getAttribute('value') : '', td[6].innerHTML];
  })));
  return raw.map((r) => {
    const s = statusFromCellHtml(r[6]);                                // strict: exact application markup only
    return r.slice(0, 6).concat([s.label, s.reason]);
  });
}

function csvCell(s) { return CSV_UNSAFE_START.test(s) ? "'" + s : s; }

/** Minimal RFC 4180 reader (quoted fields, doubled quotes, CRLF), BOM stripped. */
function parseCsv(text) {
  const src = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r' && src[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Exports the current Transactions view; checks name, BOM, CRLF, header; returns the data rows. */
async function exportCsv(page, expectedName) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#sfExportBtn')]);
  expect(download.suggestedFilename()).toBe(expectedName);
  const raw = fs.readFileSync(await download.path(), 'utf8');
  expect(raw.charCodeAt(0), 'UTF-8 BOM').toBe(0xFEFF);
  expect(raw.endsWith('\r\n') && !/[^\r]\n/.test(raw), 'CRLF line ends only').toBe(true);
  const rows = parseCsv(raw);
  expect(rows[0]).toEqual(CSV_HEADER);
  return rows.slice(1);
}

/** All eight columns: CSV row i = visible row i (description as the CSV writer neutralises it) = API row i. */
function expectCsvEqualsVisible(csvRows, uiRows, apiRows) {
  expect(csvRows.length, 'CSV rows = visible rows').toBe(uiRows.length);
  expect(apiRows.length, 'API rows = visible rows').toBe(uiRows.length);
  uiRows.forEach((u, i) => {
    const a = apiRows[i];
    const fromApi = [a.transactionDate, KIND_LABELS[a.kind], POST_NAMES[a.financialPost], a.category, a.description, a.amount,
      a.status === 'Voided' ? 'Voided' : 'Active', a.void ? a.void.reason : ''];
    expect(u, 'visible row ' + i + ' = API row').toEqual(fromApi);
    // Every text column goes through the writer's neutralisation; the amount (column 5) is exported as is.
    expect(csvRows[i], 'CSV row ' + i + ' = visible row').toEqual(u.map((v, k) => (k === 5 ? v : csvCell(v))));
  });
}

async function moneyRow(page, tableId, label) {
  const row = page.locator('#' + tableId + ' tbody tr').filter({ has: page.locator('th', { hasText: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) });
  await expect(row).toHaveCount(1);
  return bqaGuarded('read-money', () => row.locator('data.ux-money').evaluateAll((els) => els.map((e) => e.getAttribute('value'))));
}

function money(a) { return (Math.round(a * 100) / 100).toFixed(2); }

/** Runs seed.php expire-sessions for one QA account (same guards; real absolute expiry; no endpoint). */
async function expireSessions(email) {
  const out = await bqaGuarded('expire-sessions', () => execFileSync('php', [path.join(__dirname, 'seed.php'), 'expire-sessions', '--app=' + APP_DIR, '--email=' + email],
    { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 30000 }));
  const m = /expired ([0-9]+)/.exec(out);
  return m ? Number(m[1]) : -1;
}

// ---- shared CEO page across the CEO tests (serial) ---------------------------------------------
let ceo;
let paidTransactionId = null;

test.afterAll(async () => { if (ceo) await ceo.context.close(); });

/** The approved application's own badge and escape helpers (js/core/utils.js), read as data into a sandbox. */
function appBadgeHelpers() {
  const vm = require('vm');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP_DIR, 'js', 'core', 'utils.js'), 'utf8')
    + '\n;this.__bqa = { statusBadgeHTML: statusBadgeHTML, escapeHtml: escapeHtml };', sandbox, { timeout: 2000 });
  return sandbox.__bqa;
}

test('00 diagnostics are categorical; the Status parser is strict', async () => {
  const h = appBadgeHelpers();
  const r = bqaSelfCheck(h.statusBadgeHTML, h.escapeHtml);
  const g = await bqaGuardSelfCheck(r.tokens);
  // The ledger view renders exactly the two parsed shapes (source read as text, never executed).
  const view = fs.readFileSync(path.join(APP_DIR, 'js', 'ui', 'session-ledger-view.js'), 'utf8');
  const rendersParsedShapes = view.includes("(voided ? statusBadgeHTML('Voided', 'stop') + ' ' + escapeHtml(t.void.reason) : statusBadgeHTML('Active', 'done'))");
  console.log('self-check cases: ' + (r.cases + g.cases + 1) + ', failing: ' + (r.failures.length + g.failures.length + (rendersParsedShapes ? 0 : 1)));
  expect(r.failures.concat(g.failures), 'failing self-check case names').toEqual([]);
  expect(rendersParsedShapes, 'ledger Status cell markup is the parsed shape').toBe(true);
});

test('01 signed-out boot: sign-in only, 401 session check, wrong password sets no cookie', async ({ browser }) => {
  const t = await openPage(browser);
  await t.page.goto('/');
  await expect(t.page.locator('#authSignInForm')).toBeVisible();
  await expect(t.page.locator('#swSectionHome')).toHaveCount(0);
  expect((await probe(t, 'GET', '/api/auth/me', 401)).status, 'no session').toBe(401);
  t.tolerate.push({ path: '/api/auth/login', status: 401 });         // provoked on purpose
  await fillSecret(t.page, '#authEmail', S.ceo.email);
  await fillSecret(t.page, '#authPassword', 'Bqa-wrong-password-0000');
  await t.page.click('#authSignInBtn');
  await expect(t.page.locator('#authMessage')).toHaveText(/\S/);
  await expect(t.page.locator('#swSectionHome')).toHaveCount(0);
  expect((await sessionCookieFlags(t.context)).count, 'no session cookie').toBe(0);
  await assertClean(t);
  await t.context.close();
});

test('02 CEO sign-in: cookie flags, authorized navigation, CSRF enforced', async ({ browser }) => {
  ceo = await openPage(browser);
  await signIn(ceo.page, S.ceo);
  const f = await sessionCookieFlags(ceo.context);
  console.log('session cookie: count=' + f.count + ' secure=' + f.secure + ' httpOnly=' + f.httpOnly + ' path=' + f.path + ' sameSite=' + f.sameSite);
  expect(f.count, 'exactly one session cookie').toBe(1);
  expect(f.secure, 'Secure').toBe(true);
  expect(f.httpOnly, 'HttpOnly').toBe(true);
  expect(f.path, 'Path').toBe('/');
  expect(f.sameSite, 'SameSite').toBe('Strict');
  expect(f.hasDomainAttribute, 'no Domain attribute (__Host-)').toBe(false);
  for (const id of ['swSectionFinance', 'swSectionTransactions', 'swSectionRequests', 'swSectionAudit', 'swSectionPayroll']) {
    await expect(ceo.page.locator('#' + id), id).toHaveCount(1);
  }
  expect((await probe(ceo, 'GET', '/api/auth/me', 200)).status, 'the browser cookie authenticates').toBe(200);
  const noCsrf = await probe(ceo, 'POST', '/api/general-transactions/create', 403, { body: {} });
  console.log('authenticated write without CSRF: ' + noCsrf.status + ' ' + noCsrf.code);
  expect([noCsrf.status, noCsrf.code]).toEqual([403, 'forbidden']);
  await assertClean(ceo);
});

test('03 Financial Post filter; CSV equals the visible rows in all eight columns', async () => {
  const page = ceo.page;
  await goTo(page, 'swSectionTransactions', 'transactions');
  await expect(page.locator('#sfPostFilter')).toBeVisible();
  await setLedgerRange(page, W.from, W.to);
  await expect(page.locator('#sfList tbody tr')).toHaveCount(S.ledger.length);
  await expect(page.locator('#sfPostFilter')).toHaveValue('');
  const api = (await read(ceo, '/api/general-transactions?from=' + W.from + '&to=' + W.to)).generalTransactions;
  expect(api.length).toBe(S.ledger.length);

  await page.selectOption('#sfPostFilter', 'GA');
  await expect(page.locator('#sfList tbody tr')).toHaveCount(GA.length);
  await expect(page.getByText(GA.length + ' transactions in GA, oldest first.')).toBeVisible();
  expect(await bqaGuarded('read-focus', () => page.evaluate(() => !!document.activeElement && document.activeElement !== document.body)), 'focus not lost').toBe(true);
  const gaUi = await visibleLedgerRows(page);
  const gaCsv = await exportCsv(page, 'tam-os-transactions-ga-' + W.from + '-to-' + W.to + '.csv');
  expectCsvEqualsVisible(gaCsv, gaUi, api.filter((a) => a.financialPost === 'GA'));
  expect(gaCsv.some((r) => r[4] === "'" + GA[1].description), 'formula-like description neutralised').toBe(true);

  await page.selectOption('#sfPostFilter', 'TJB');
  const tjbUi = await visibleLedgerRows(page);
  const tjbCsv = await exportCsv(page, 'tam-os-transactions-tjb-' + W.from + '-to-' + W.to + '.csv');
  expectCsvEqualsVisible(tjbCsv, tjbUi, api.filter((a) => a.financialPost === 'TJB'));
  await page.selectOption('#sfPostFilter', '');
  await expect(page.locator('#sfList tbody tr')).toHaveCount(S.ledger.length);
  await assertClean(ceo);
});

test('04 Financial Report: rendered totals equal the server report and ignore the Transactions filter', async () => {
  const page = ceo.page;
  const report = (await read(ceo, '/api/reports/financial?from=' + W.from + '&to=' + W.to)).financialReport;
  const sum = (post, kind) => money(S.ledger.filter((t) => t.financialPost === post && t.kind === kind).reduce((a, t) => a + Number(t.amount), 0));
  await goTo(page, 'swSectionFinance', 'overview');
  await expect(page.locator('#sfPosts')).toBeVisible();
  await expect(page.locator('#sfViewTitle')).toContainText(W.from);
  const rendered = {};
  for (const p of report.posts) {
    rendered[p.code] = await moneyRow(page, 'sfPosts', POST_NAMES[p.code]);
    expect(rendered[p.code].slice(0, 3), p.code + ' rendered = server').toEqual([p.income, p.expense, p.net]);
    expect([p.income, p.expense], p.code + ' server = seeded fixture').toEqual([sum(p.code, 'income'), sum(p.code, 'expense')]);
  }
  expect(Object.keys(rendered).sort()).toEqual(Object.keys(POST_NAMES).sort());
  const consolidated = await bqaGuarded('read-consolidated', () => page.locator('#sfConsolidated tbody tr data.ux-money').evaluateAll((els) => els.map((e) => e.getAttribute('value'))));
  expect(consolidated, 'consolidated rendered = server').toEqual([report.consolidated.income, report.consolidated.expense, report.consolidated.net]);

  await goTo(page, 'swSectionTransactions', 'transactions');
  await page.selectOption('#sfPostFilter', 'DRONE');
  await goTo(page, 'swSectionFinance', 'overview');
  await expect(page.locator('#sfPosts')).toBeVisible();
  for (const p of report.posts) expect(await moneyRow(page, 'sfPosts', POST_NAMES[p.code]), p.code + ' unchanged by the filter').toEqual(rendered[p.code]);
  await goTo(page, 'swSectionTransactions', 'transactions');
  await page.selectOption('#sfPostFilter', '');
  await assertClean(ceo);
});

test('05 Void under a filter voids the visible row; CSV then carries Status and Void reason', async () => {
  const page = ceo.page;
  await goTo(page, 'swSectionTransactions', 'transactions');
  await expect(page.locator('#sfList tbody tr')).toHaveCount(S.ledger.length);
  const target = GA[1];
  const fullAtIndex = S.ledger[1];
  expect(target.description).not.toBe(fullAtIndex.description);
  await page.selectOption('#sfPostFilter', 'GA');
  await expect(page.locator('#sfList tbody tr')).toHaveCount(GA.length);
  await page.click('#sfList [data-sf-void="1"]');
  await expect(page.locator('#sfVoidForm')).toBeVisible();
  await expect(page.locator('#sfPostFilter')).toBeDisabled();
  const lead = await page.locator('#sfVoidForm .auth-lead').innerText();
  expect(lead.includes(target.description), 'void panel names the visible row').toBe(true);
  expect(lead.includes(fullAtIndex.description), 'void panel does not name the full-list row').toBe(false);
  await page.fill('#sfVoidReason', VOID_REASON);
  await page.click('#sfVoidSubmit');
  await expect(page.locator('#sfVoidForm')).toHaveCount(0);
  await page.selectOption('#sfPostFilter', '');
  await expect(page.locator('#sfList tbody tr', { hasText: 'Voided' })).toHaveCount(1);

  const api = (await read(ceo, '/api/general-transactions?from=' + W.from + '&to=' + W.to)).generalTransactions;
  const voided = api.filter((a) => a.status === 'Voided');
  expect(voided.length).toBe(1);
  expect(voided[0].description).toBe(target.description);
  expect(api.find((a) => a.description === fullAtIndex.description).status).toBe('Active');
  const ui = await visibleLedgerRows(page);
  expect(ui.map((r) => r[6]).sort(), 'visible Status labels').toEqual(api.map((a) => a.status).sort());
  const uiVoided = ui.filter((r) => r[6] === 'Voided');
  expect(uiVoided.map((r) => [r[4], r[7]]), 'the one Voided row and its reason').toEqual([[target.description, VOID_REASON]]);
  expect(ui.filter((r) => r[6] === 'Active').every((r) => r[7] === ''), 'Active rows carry no reason').toBe(true);
  expect(ui.filter((r) => r[6] === 'Active').length, 'Active rows').toBe(S.ledger.length - 1);
  const csv = await exportCsv(page, 'tam-os-transactions-' + W.from + '-to-' + W.to + '.csv');
  expectCsvEqualsVisible(csv, ui, api);
  expect(csv.some((r) => r[6] === 'Voided' && r[7] === VOID_REASON), 'Status and Void reason exported').toBe(true);
  expect(csv.filter((r) => r[6] === 'Active').length, 'Active rows exported').toBe(S.ledger.length - 1);
  await assertClean(ceo);
});

test('06 Record through the UI creates exactly one ledger record', async () => {
  const page = ceo.page;
  await goTo(page, 'swSectionTransactions', 'transactions');
  await setLedgerRange(page, S.today, S.today);
  const before = (await read(ceo, '/api/general-transactions?from=' + S.today + '&to=' + S.today)).generalTransactions;
  await expect(page.locator('#sfList tbody tr')).toHaveCount(before.length);
  await page.click('#sfAddBtn');
  await expect(page.locator('#sfForm')).toBeVisible();
  await page.selectOption('#sff-kind', RECORD.kind);
  await page.selectOption('#sff-financialPost', RECORD.financialPost);
  await page.fill('#sff-category', RECORD.category);
  await page.fill('#sff-description', RECORD.description);
  await page.fill('#sff-amount', RECORD.amount);
  await page.fill('#sff-transactionDate', S.today);
  const [created] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === '/api/general-transactions/create' && r.request().method() === 'POST'),
    page.click('#sfFormSubmit'),
  ]);
  expect(created.status(), 'create answered').toBeLessThan(300);
  const createdId = (await created.json()).data.generalTransaction.id;
  await expect(page.locator('#sfForm')).toHaveCount(0);
  await expect(page.locator('#sfList tbody tr')).toHaveCount(before.length + 1);
  await expect(page.locator('#sfList tbody tr', { hasText: RECORD.description })).toHaveCount(1);
  const after = (await read(ceo, '/api/general-transactions?from=' + S.today + '&to=' + S.today)).generalTransactions;
  expect(after.length, 'exactly one new record').toBe(before.length + 1);
  const mine = after.filter((a) => a.description === RECORD.description);
  expect(mine.length, 'recorded once').toBe(1);
  expect(mine[0].id, 'the created record').toBe(createdId);
  expect([mine[0].kind, mine[0].financialPost, mine[0].category, mine[0].amount, mine[0].transactionDate, mine[0].status])
    .toEqual([RECORD.kind, RECORD.financialPost, RECORD.category, RECORD.amount, S.today, 'Active']);
  await assertClean(ceo);
});

test('07 Finance Requests: type filter, approve, pay, exact drill to payment.financeTransactionId, back', async () => {
  const page = ceo.page;
  const pr = S.requests.payment;
  await goTo(page, 'swSectionRequests', 'requests');
  await page.fill('#frFrom', W.from);
  await page.fill('#frTo', S.today);
  await page.click('#frApplyBtn');
  await expect(page.locator('#frList tbody tr')).toHaveCount(3);
  await page.selectOption('#frKind', 'paymentRequest');
  await expect(page.locator('#frList tbody tr')).toHaveCount(1);
  await page.selectOption('#frKind', 'reimbursement');
  await expect(page.locator('#frList tbody tr')).toHaveCount(2);
  await page.selectOption('#frKind', 'paymentRequest');
  const row = page.locator('#frList tbody tr').filter({ hasText: pr.category });
  await expect(row).toContainText('Submitted');
  await row.locator('[data-fr-open]').click();
  await expect(page.locator('#frDetail')).toBeVisible();

  await page.click('#frApproveBtn');
  await expect(page.locator('#frActionForm')).toBeVisible();
  await page.click('#frActionConfirm');
  await expect(page.locator('#frPayBtn')).toBeVisible();

  await page.click('#frPayBtn');
  await expect(page.locator('#frPaidOn')).toBeVisible();
  await page.fill('#frPaidOn', S.today);
  await page.selectOption('#frMethod', 'bankTransfer');
  const [paid] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === '/api/finance-requests/pay' && r.request().method() === 'POST'),
    page.click('#frActionConfirm'),
  ]);
  expect(paid.status(), 'pay answered').toBeLessThan(300);
  const payment = (await paid.json()).data.financeRequest.payment;
  paidTransactionId = payment.financeTransactionId;
  expect(/^[0-9a-f]{32}$/.test(paidTransactionId), 'payment.financeTransactionId').toBe(true);
  expect(paidTransactionId).not.toBe(S.distractor.id);
  await expect(page.locator('#frLedgerBtn')).toBeVisible();

  await page.click('#frLedgerBtn');
  await expect(page.locator('#sfDrill')).toBeVisible();
  await expect(page.locator('#sfDrillTxn')).toContainText(pr.description);
  // The authoritative one-day list, in the order the page shows it: same date, post, category,
  // description and amount for the distractor and the paid expense — only the id tells them apart.
  const day = (await read(ceo, '/api/general-transactions?from=' + S.today + '&to=' + S.today)).generalTransactions;
  const paidIndex = day.findIndex((a) => a.id === paidTransactionId);
  const distractorIndex = day.findIndex((a) => a.id === S.distractor.id);
  expect(paidIndex, 'paid expense listed').toBeGreaterThanOrEqual(0);
  expect(distractorIndex, 'distractor listed').toBeGreaterThanOrEqual(0);
  expect([day[distractorIndex].description, day[distractorIndex].amount, day[distractorIndex].transactionDate])
    .toEqual([day[paidIndex].description, day[paidIndex].amount, day[paidIndex].transactionDate]);
  await expect(page.locator('#sfList tbody tr')).toHaveCount(day.length);
  const marked = await bqaGuarded('read-marked-rows', () => page.locator('#sfList tbody tr').evaluateAll((trs) => trs.map((tr, i) => (tr.getAttribute('aria-current') === 'true' ? i : -1)).filter((i) => i >= 0)));
  expect(marked, 'exactly the linked transaction is marked').toEqual([paidIndex]);

  await page.click('#sfDrillBack');
  await expect(page.locator('#frDetail')).toBeVisible();
  await expect(page.locator('#frDetail')).toContainText('Paid');
  await assertClean(ceo);
});

test('08 Company isolation: another company’s records cannot be read or changed, even with CSRF', async () => {
  const B = S.otherCompany;
  const detail = await probe(ceo, 'GET', '/api/finance-request?id=' + B.requestId, 404);
  expect(detail.status, 'other-company request detail').toBe(404);
  const approve = await probe(ceo, 'POST', '/api/finance-requests/approve', 404, { csrf: true,
    body: { financeRequestId: B.requestId, expectedVersion: B.requestVersion, expectedAmount: B.requestAmount } });
  expect(approve.status, 'other-company approval with valid CSRF').toBe(404);
  const voidOther = await probe(ceo, 'POST', '/api/general-transactions/void', 404, { csrf: true,
    body: { financeTransactionId: B.transactionId, reason: 'BQA cross-company probe', idempotencyKey: 'b'.repeat(32) } });
  expect(voidOther.status, 'other-company void with valid CSRF').toBe(404);
  const employee = await probe(ceo, 'GET', '/api/employee?id=' + B.employeeId, 404);
  expect(employee.status, 'other-company employee detail').toBe(404);
  const ledger = (await read(ceo, '/api/general-transactions?from=' + W.from + '&to=' + S.today)).generalTransactions;
  expect(ledger.some((a) => a.id === B.transactionId || a.description === B.transactionDescription), 'other-company ledger row absent').toBe(false);
  const requests = (await read(ceo, '/api/finance-requests?from=' + W.from + '&to=' + S.today)).financeRequests;
  expect(requests.some((r) => r.id === B.requestId || r.description === B.requestDescription), 'other-company request absent').toBe(false);
  const people = (await read(ceo, '/api/employees')).employees;
  expect(people.some((e) => e.id === B.employeeId || e.fullName === B.employeeName), 'other-company employee absent').toBe(false);
  await assertClean(ceo);
});

test('09 Keyboard: sidebar activation by Enter keeps focus on a live control', async () => {
  const page = ceo.page;
  await page.locator('#swSectionTransactions').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#sfViewTitle')).toContainText('Transactions');
  const active = await bqaGuarded('read-focus', () => page.evaluate(() => (document.activeElement && document.activeElement !== document.body ? (document.activeElement.id || document.activeElement.tagName) : 'BODY')));
  console.log('focus after keyboard navigation: ' + (/^[A-Za-z0-9_-]{1,40}$/.test(active) ? active : 'other'));
  expect(active).not.toBe('BODY');
  await page.keyboard.press('Tab');
  expect(await bqaGuarded('read-focus', () => page.evaluate(() => document.activeElement !== document.body))).toBe(true);
  await assertClean(ceo);
});

test('10 CEO sign-out ends the session', async () => {
  const page = ceo.page;
  await page.click('#authSignOutBtn');
  await expect(page.locator('#authSignInForm')).toBeVisible();
  expect((await probe(ceo, 'GET', '/api/auth/me', 401)).status, 'the old cookie no longer authenticates').toBe(401);
  await assertClean(ceo);
  await ceo.context.close();
  ceo = null;
});

test('11 Session expiry: a real 401 on a business read signs the page out and clears it', async ({ browser }) => {
  const t = await openPage(browser);
  const page = t.page;
  await signIn(page, S.ceo);
  await goTo(page, 'swSectionTransactions', 'transactions');
  await setLedgerRange(page, W.from, W.to);
  await expect(page.locator('#sfList tbody tr', { hasText: S.ledger[0].description })).toHaveCount(1);
  const expired = await expireSessions(S.ceo.email);
  console.log('sessions expired: ' + expired);
  expect(expired, 'the live session was expired').toBeGreaterThanOrEqual(1);
  t.tolerate.push({ path: '/api/general-transactions', status: 401 }, { path: '/api/reports/financial', status: 401 });
  await page.fill('#sfTo', W.from);                                    // a new range forces a real read …
  await page.click('#sfApplyBtn');                                     // … answered 401 by the server
  await expect(page.locator('#authSignInForm')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#authMessage')).toHaveText(/\S/);
  await expect(page.locator('#swSectionHome')).toHaveCount(0);
  await expect(page.locator('#sfList')).toHaveCount(0);
  expect(await bqaGuarded('read-page-text', () => page.evaluate((d) => document.body.innerText.includes(d), S.ledger[0].description)), 'ledger data cleared from the page').toBe(false);
  expect((await probe(t, 'GET', '/api/auth/me', 401)).status, 'the expired cookie is refused').toBe(401);
  await assertClean(t);
  await t.context.close();
});

test('12 Employee: keyboard sign-in, own data only, peer and CEO-only actions refused, sign-out', async ({ browser }) => {
  const t = await openPage(browser);
  const page = t.page;
  await page.goto('/');
  await expect(page.locator('#authSignInForm')).toBeVisible();
  const focusedId = () => bqaGuarded('read-focus', () => page.evaluate(() => (document.activeElement && document.activeElement.id) || ''));
  for (let i = 0; i < 15 && (await focusedId()) !== 'authEmail'; i++) await page.keyboard.press('Tab');
  expect(await focusedId()).toBe('authEmail');
  await typeSecret(page, S.employee.email);
  await page.keyboard.press('Tab');
  expect(await focusedId()).toBe('authPassword');
  await typeSecret(page, S.employee.password);
  await page.keyboard.press('Enter');
  await expect(page.locator('#swSectionHome')).toBeVisible();

  for (const id of ['swSectionFinance', 'swSectionTransactions', 'swSectionAudit']) await expect(page.locator('#' + id), id).toHaveCount(0);
  await bqaGuarded('navigate', () => page.evaluate(() => { location.hash = '#/transactions'; }));
  await expect(page.locator('#sfList')).toHaveCount(0);
  await expect(page.locator('#sfPostFilter')).toHaveCount(0);

  await goTo(page, 'swSectionRequests', 'reimbursements');
  await page.fill('#frFrom', W.from);
  await page.fill('#frTo', S.today);
  await page.click('#frApplyBtn');
  await expect(page.locator('#frList tbody tr')).toHaveCount(1);
  await expect(page.locator('#frList')).toContainText(S.requests.own.category);
  await expect(page.locator('#frKind')).toHaveCount(0);
  for (const hidden of [S.colleague.fullName, S.requests.colleague.category, S.requests.payment.category, S.otherCompany.employeeName]) {
    expect(await bqaGuarded('read-page-text', () => page.evaluate((h) => document.body.innerText.includes(h), hidden)), 'not shown to the Employee').toBe(false);
  }

  // The server, not the page, enforces the boundary.
  expect((await probe(t, 'GET', '/api/general-transactions?from=' + W.from + '&to=' + W.to, 403)).status, 'ledger read').toBe(403);
  expect((await probe(t, 'GET', '/api/reports/financial?from=' + W.from + '&to=' + W.to, 403)).status, 'report read').toBe(403);
  const list = (await read(t, '/api/finance-requests?from=' + W.from + '&to=' + S.today)).financeRequests;
  expect(list.map((r) => r.id), 'only the own request').toEqual([S.employee.ownRequestId]);
  const peerStatus = (await probe(t, 'GET', '/api/employee?id=' + S.colleague.employeeId, 404)).status;
  console.log('employee peer detail: ' + peerStatus);
  expect(peerStatus, 'peer detail refused (non-disclosure)').toBe(404);
  const create = await probe(t, 'POST', '/api/general-transactions/create', 403, { csrf: true,
    body: { kind: 'expense', financialPost: 'GA', category: 'Probe', description: 'BQA employee probe', amount: '1000.00', transactionDate: W.from, idempotencyKey: 'e'.repeat(32) } });
  expect([create.status, create.code], 'CEO-only create with valid CSRF').toEqual([403, 'forbidden']);
  const own = (await read(t, '/api/finance-request?id=' + S.employee.ownRequestId)).financeRequest;
  const approve = await probe(t, 'POST', '/api/finance-requests/approve', 403, { csrf: true,
    body: { financeRequestId: own.id, expectedVersion: own.version, expectedAmount: own.amount, financialPost: 'GA' } });
  expect([approve.status, approve.code], 'CEO-only approval of the own request with valid CSRF').toEqual([403, 'forbidden']);

  await page.click('#authSignOutBtn');
  await expect(page.locator('#authSignInForm')).toBeVisible();
  expect((await probe(t, 'GET', '/api/auth/me', 401)).status).toBe(401);
  await assertClean(t);
  await t.context.close();
});
