#!/usr/bin/env node
/*
 * serve-auth-stub.js — TAM OS (AFI-2, owner decision D-B)
 * -----------------------------------------------------------------
 * TEST-ONLY. A loopback-only server for browser QA of the SESSION-mode auth views. It
 * serves dist/package/ under the production header contract (tools/package-headers.js),
 * except that js/core/constants.js is served IN MEMORY with AUTH_MODE set to SESSION —
 * nothing on disk changes and the shipped package stays LOCAL. /api/auth/me, /login and
 * /logout answer with the canonical envelope and the AuthController projection, from a
 * deterministic scenario held in memory.
 *
 * It is NOT a backend: no database, no PHP, no real credentials, no real cookie session
 * (the HttpOnly cookie is invisible to the page anyway, so the stub keeps one in-memory
 * session instead). Real PHP + MariaDB authenticated E2E is still required before AFI-5.
 * It is never deployed, never part of the package and never a runtime dependency.
 *
 * Usage:  node tools/build-package.js && node tools/serve-auth-stub.js [port]   (default 8767)
 *
 * Scenario (GET switches it; the in-memory session resets on every switch):
 *   /__stub/scenario/signed-out          /me 401 until a login (default)
 *   /__stub/scenario/ceo                 already signed in as CEO
 *   /__stub/scenario/employee            already signed in as Employee
 *   /__stub/scenario/me-unavailable      /me 503
 *   /__stub/scenario/me-malformed        /me 200 with an unknown role
 *   /__stub/scenario/login-rate-limited  login 429 with Retry-After: 120
 *   /__stub/scenario/logout-stale-csrf   the first logout answers 403 and rotates the CSRF token
 *   /__stub/scenario/logout-unavailable  logout 503
 * Fabricated test login (stub only): ceo@example.invalid / stub-only-password
 * (employee@example.invalid signs in as Employee); anything else is 401.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { STATIC_HEADERS, API_HEADERS } = require('./package-headers.js');

const pkgRoot = path.resolve(__dirname, '..', 'dist', 'package');
const port = Number(process.argv[2]) || 8767;
const ORIGIN = 'http://127.0.0.1:' + port;
const MODE_LINE = 'const AUTH_MODE = AUTH_MODES.LOCAL;';
const STUB_PASSWORD = 'stub-only-password';
const USERS = {
  'ceo@example.invalid': { userId: 'u_stub_ceo', membershipId: 'm_stub_ceo', role: 'ceo', employeeId: null },
  'employee@example.invalid': { userId: 'u_stub_emp', membershipId: 'm_stub_emp', role: 'employee', employeeId: 'emp_stub_1' }
};
const SCENARIOS = ['signed-out', 'ceo', 'employee', 'me-unavailable', 'me-malformed', 'login-rate-limited', 'logout-stale-csrf', 'logout-unavailable'];

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '': 'text/plain; charset=utf-8' };

let scenario = 'signed-out';
let session = null;            // { user, csrf, staleOnce }

const token = () => crypto.randomBytes(32).toString('base64url');        // 43 characters, the server shape
const rid = () => crypto.randomBytes(16).toString('hex');
function reset(name){
  scenario = name;
  session = (name === 'ceo' || name === 'me-malformed') ? { user: USERS['ceo@example.invalid'], csrf: token() }
    : (name === 'employee') ? { user: USERS['employee@example.invalid'], csrf: token() } : null;
}
function api(res, status, payload, extra){
  const id = rid();
  const body = status < 300 ? { ok: true, data: payload, requestId: id }
    : { ok: false, error: { code: payload, message: 'stub' }, requestId: id };
  res.writeHead(status, { ...API_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'X-Request-Id': id, ...(extra || {}) });
  res.end(JSON.stringify(body));
}
function readJson(req){
  return new Promise((resolve) => {
    let raw = ''; req.on('data', (c) => { raw += c; if(raw.length > 16384) req.destroy(); });
    req.on('end', () => { try { const v = JSON.parse(raw); resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : null); } catch(_e){ resolve(null); } });
  });
}

async function handleApi(req, res, p){
  const mutation = req.method !== 'GET' && req.method !== 'HEAD';
  if(mutation){
    if(req.headers.origin !== ORIGIN) return api(res, 403, 'forbidden');                 // same-origin only
    if(!/^application\/json\b/i.test(req.headers['content-type'] || '')) return api(res, 415, 'unsupported_media_type');
  }
  if(p === '/api/auth/me' && (req.method === 'GET' || req.method === 'HEAD')){
    if(scenario === 'me-unavailable') return api(res, 503, 'service_unavailable');
    if(!session) return api(res, 401, 'unauthenticated');
    const projection = { ...session.user, csrfToken: session.csrf };
    if(scenario === 'me-malformed') projection.role = 'superuser';
    return api(res, 200, projection);
  }
  if(p === '/api/auth/login' && req.method === 'POST'){
    const b = await readJson(req);
    if(!b || Object.keys(b).sort().join() !== 'email,password' || typeof b.email !== 'string' || typeof b.password !== 'string') return api(res, 400, 'validation_failed');
    if(scenario === 'login-rate-limited') return api(res, 429, 'rate_limited', { 'Retry-After': '120' });
    const user = USERS[b.email.trim().toLowerCase()];
    if(!user || b.password !== STUB_PASSWORD) return api(res, 401, 'unauthenticated');
    session = { user: user, csrf: token(), staleOnce: scenario === 'logout-stale-csrf' };
    return api(res, 200, { ...user, csrfToken: session.csrf });
  }
  if(p === '/api/auth/logout' && req.method === 'POST'){
    const b = await readJson(req);
    if(!b || Object.keys(b).length !== 0) return api(res, 400, 'validation_failed');
    if(scenario === 'logout-unavailable') return api(res, 503, 'service_unavailable');
    if(session){
      if(session.staleOnce){ session.staleOnce = false; session.csrf = token(); return api(res, 403, 'forbidden'); }  // another tab rotated it
      if(req.headers['x-csrf-token'] !== session.csrf) return api(res, 403, 'forbidden');
    }
    session = null;
    return api(res, 200, { loggedOut: true });
  }
  return api(res, 404, 'not_found');
}

if(!fs.existsSync(path.join(pkgRoot, 'index.html'))){
  console.error('dist/package/index.html not found — run `node tools/build-package.js` first.');
  process.exit(1);
}
reset('signed-out');

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, ORIGIN).pathname);
  const sw = /^\/__stub\/scenario\/([a-z-]+)$/.exec(urlPath);
  if(sw && req.method === 'GET'){
    if(SCENARIOS.indexOf(sw[1]) === -1){ res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('unknown scenario'); }
    reset(sw[1]);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('scenario: ' + scenario);
  }
  if(urlPath === '/api' || urlPath.startsWith('/api/')) return handleApi(req, res, urlPath);
  if(req.method !== 'GET' && req.method !== 'HEAD'){ res.writeHead(405, { ...STATIC_HEADERS, 'Allow': 'GET, HEAD' }); return res.end(); }
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(pkgRoot, rel);
  if(!file.startsWith(pkgRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()){
    res.writeHead(404, { ...STATIC_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found');
  }
  let body = fs.readFileSync(file);
  if(rel === 'js/core/constants.js'){
    const src = body.toString('utf8');
    if(src.split(MODE_LINE).length !== 2){ res.writeHead(500); return res.end('auth mode line not found'); }
    body = src.replace(MODE_LINE, 'const AUTH_MODE = AUTH_MODES.SESSION;');   // in memory only
  }
  res.writeHead(200, { ...STATIC_HEADERS, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(req.method === 'HEAD' ? '' : body);
}).listen(port, '127.0.0.1', () => {
  console.log('TEST-ONLY auth stub: SESSION-mode package at ' + ORIGIN + '/ (scenario: ' + scenario + '). Ctrl+C to stop.');
});
