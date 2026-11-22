#!/usr/bin/env node
/*
 * serve-local-dev.js — TAM OS (AFI-5a, owner decision D-AFI5-2)
 * -----------------------------------------------------------------
 * TEST-ONLY. A loopback-only server for browser QA of LOCAL mode with a DEVELOPMENT persona
 * from tools/dev/local-identity-fixture.js (the application ships no selection since AFI-5b).
 * It serves dist/package/ under the production header contract (tools/package-headers.js, its
 * Content-Security-Policy included) with exactly four changes, all IN MEMORY only:
 *   1. js/core/constants.js has its ONE AUTH_MODE assignment rewritten from SESSION (the
 *      shipped mode) to LOCAL — exactly once; any other shape is refused;
 *   2. index.html gains <script src="dev/local-identity-fixture.js"></script> immediately
 *      after the js/core/identity.js tag, so the persona installs before boot;
 *   3. that dev file is served from tools/dev/ with its DEV_PERSONA line set to the persona
 *      chosen by the required --as argument;
 *   4. U-ISO (ADR-0005): the package is SESSION-only, so index.html has its production script
 *      block (tools/module-order.js productionOrder) replaced by the full canonical order, and
 *      the LOCAL-only modules (module-order.js localOnly) are served from js/ in the source tree.
 * Nothing on disk changes, dist/package/ is never written, and neither the dev file nor any
 * LOCAL-only module is ever part of the package. There is no in-app persona switch: restart with another --as to change it.
 *
 * It is not authentication, holds no data, credential or configuration, answers /api/* with
 * 404 like serve-package.js, and never listens on anything but 127.0.0.1. It is never
 * deployed and never a runtime dependency.
 *
 * Usage:  node tools/build-package.js
 *         node tools/serve-local-dev.js --as ceo|employee [port]        (default port 8770)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { STATIC_HEADERS, API_HEADERS } = require('./package-headers.js');
const ORDER = require('./module-order.js');

const pkgRoot = path.resolve(__dirname, '..', 'dist', 'package');
const srcRoot = path.resolve(__dirname, '..');
const devFile = path.resolve(__dirname, 'dev', 'local-identity-fixture.js');
const PERSONAS = { ceo: 'user_ceo_fixture', employee: 'user_employee_fixture' };
const IDENTITY_TAG = '<script src="js/core/identity.js"></script>';
const DEV_TAG = '<script src="dev/local-identity-fixture.js"></script>';
const PERSONA_LINE = 'const DEV_PERSONA = null;';
const SESSION_LINE = 'const AUTH_MODE = AUTH_MODES.SESSION;';
const scriptTags = (list) => list.map((m) => '<script src="js/' + m + '"></script>').join('\n');
const PRODUCTION_BLOCK = scriptTags(ORDER.productionOrder);
const LOCAL_BLOCK = scriptTags(ORDER);

// The LOCAL development index.html, in memory: the full canonical module order (U-ISO), then the
// dev persona tag after identity.js. Returns null when the package page does not have exactly one
// production script block and one identity tag (any other shape is refused).
function localDevIndexHtml(html){
  if(html.split(PRODUCTION_BLOCK).length !== 2) return null;
  const full = html.replace(PRODUCTION_BLOCK, LOCAL_BLOCK);
  if(full.split(IDENTITY_TAG).length !== 2) return null;
  return full.replace(IDENTITY_TAG, IDENTITY_TAG + '\n' + DEV_TAG);
}
module.exports = { localDevIndexHtml, PRODUCTION_BLOCK, LOCAL_BLOCK };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '': 'text/plain; charset=utf-8' };

if(require.main === module){
const args = process.argv.slice(2);
const asIdx = args.indexOf('--as');
const persona = asIdx !== -1 ? PERSONAS[args[asIdx + 1]] : undefined;
if(!persona){
  console.error('Usage: node tools/serve-local-dev.js --as ceo|employee [port]');
  process.exit(1);
}
const rest = args.filter((a, i) => i !== asIdx && i !== asIdx + 1);
const port = Number(rest[0]) || 8770;

if(!fs.existsSync(path.join(pkgRoot, 'index.html'))){
  console.error('dist/package/ is missing — run node tools/build-package.js first.');
  process.exit(1);
}

function send(res, status, headers, body){ res.writeHead(status, headers); res.end(body); }

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  if(urlPath === '/api' || urlPath.startsWith('/api/')){
    return send(res, 404, { ...API_HEADERS, 'Content-Type': 'application/json' }, '{"error":"not_implemented"}');
  }
  if(req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { ...STATIC_HEADERS, 'Allow': 'GET, HEAD' }, '');
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  let body;
  if(rel === 'dev/local-identity-fixture.js'){
    const src = fs.readFileSync(devFile, 'utf8');
    if(src.split(PERSONA_LINE).length !== 2) return send(res, 500, STATIC_HEADERS, 'persona line not found');
    body = src.replace(PERSONA_LINE, 'const DEV_PERSONA = ' + JSON.stringify(persona) + ';');   // in memory only
  } else {
    // U-ISO: a LOCAL-only module is not in the package; serve it from the source tree.
    const localModule = rel.startsWith('js/') && ORDER.isLocalOnly(rel.slice(3));
    const base = localModule ? srcRoot : pkgRoot;
    const file = path.resolve(base, rel);
    if(!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()){
      return send(res, 404, { ...STATIC_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
    }
    body = fs.readFileSync(file);
    if(rel === 'js/core/constants.js'){
      const src = body.toString('utf8');
      if((src.match(/const AUTH_MODE = [^;\n]+;/g) || []).length !== 1 || src.split(SESSION_LINE).length !== 2){
        return send(res, 500, STATIC_HEADERS, 'auth mode line not found');
      }
      body = src.replace(SESSION_LINE, 'const AUTH_MODE = AUTH_MODES.LOCAL;');               // in memory only
    }
    if(rel === 'index.html'){
      const html = localDevIndexHtml(body.toString('utf8'));                                     // in memory only
      if(html === null) return send(res, 500, STATIC_HEADERS, 'production script block or identity script tag not found');
      body = html;
    }
  }
  send(res, 200, { ...STATIC_HEADERS, 'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream' }, req.method === 'HEAD' ? '' : body);
}).listen(port, '127.0.0.1', () => {
  console.log('TEST-ONLY LOCAL dev server: persona ' + persona + ' at http://127.0.0.1:' + port + '/ (not authenticated). Ctrl+C to stop.');
});
}
