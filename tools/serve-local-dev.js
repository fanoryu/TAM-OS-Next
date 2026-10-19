#!/usr/bin/env node
/*
 * serve-local-dev.js — TAM OS (AFI-5a, owner decision D-AFI5-2)
 * -----------------------------------------------------------------
 * TEST-ONLY. A loopback-only server for browser QA of LOCAL mode with a DEVELOPMENT persona
 * from tools/dev/local-identity-fixture.js instead of the "Acting as" selection. It serves
 * dist/package/ under the production header contract (tools/package-headers.js, its
 * Content-Security-Policy included) with exactly two changes, both IN MEMORY only:
 *   1. index.html gains <script src="dev/local-identity-fixture.js"></script> immediately
 *      after the js/core/identity.js tag, so the persona installs before boot;
 *   2. that dev file is served from tools/dev/ with its DEV_PERSONA line set to the persona
 *      chosen by the required --as argument.
 * Nothing on disk changes, dist/package/ is never written, and the dev file is never part of
 * the package. There is no in-app persona switch: restart with another --as to change it.
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

const pkgRoot = path.resolve(__dirname, '..', 'dist', 'package');
const devFile = path.resolve(__dirname, 'dev', 'local-identity-fixture.js');
const PERSONAS = { ceo: 'user_ceo_fixture', employee: 'user_employee_fixture' };
const IDENTITY_TAG = '<script src="js/core/identity.js"></script>';
const DEV_TAG = '<script src="dev/local-identity-fixture.js"></script>';
const PERSONA_LINE = 'const DEV_PERSONA = null;';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '': 'text/plain; charset=utf-8' };

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
    const file = path.resolve(pkgRoot, rel);
    if(!file.startsWith(pkgRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()){
      return send(res, 404, { ...STATIC_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
    }
    body = fs.readFileSync(file);
    if(rel === 'index.html'){
      const html = body.toString('utf8');
      if(html.split(IDENTITY_TAG).length !== 2) return send(res, 500, STATIC_HEADERS, 'identity script tag not found');
      body = html.replace(IDENTITY_TAG, IDENTITY_TAG + '\n' + DEV_TAG);                       // in memory only
    }
  }
  send(res, 200, { ...STATIC_HEADERS, 'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream' }, req.method === 'HEAD' ? '' : body);
}).listen(port, '127.0.0.1', () => {
  console.log('TEST-ONLY LOCAL dev server: persona ' + persona + ' at http://127.0.0.1:' + port + '/ (not authenticated). Ctrl+C to stop.');
});
