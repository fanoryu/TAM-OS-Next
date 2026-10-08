#!/usr/bin/env node
/*
 * serve-e2e-proxy.js — TAM OS (AFI-4g, owner decision D-AFI4g-8 = A)
 * -----------------------------------------------------------------
 * TEST-ONLY. A loopback-only front for the REAL authenticated end-to-end check of the SESSION
 * workspace against the real PHP backend: it serves dist/package/ under the production header
 * contract (tools/package-headers.js, its Content-Security-Policy included) with
 * js/core/constants.js served IN MEMORY with AUTH_MODE set to SESSION — nothing on disk changes
 * and the shipped package stays LOCAL — and forwards every /api request, byte for byte, to a PHP
 * built-in server on loopback running the development router (server/dev/router.php). The browser
 * sees ONE origin, so the session cookie, the Origin check and the CSRF header are the backend's
 * own, unchanged.
 *
 * It is not a backend, holds no data, credential or configuration, and never listens on anything
 * but 127.0.0.1. It is never deployed, never part of the package and never a runtime dependency.
 * Its evidence is AFI-4g's alone: it does not satisfy the SDR-0002 §22 "authenticated end-to-end"
 * gate (item 8).
 *
 * Usage:  node tools/build-package.js
 *         TAMOS_CONFIG=<scratch config.local.php> php -S 127.0.0.1:<api port> server/dev/router.php
 *         node tools/serve-e2e-proxy.js [port] [api port]           (defaults 8768 and 8769)
 * Open http://localhost:<port>/ (localhost, so the browser treats the origin as secure and keeps
 * the backend's Secure __Host- session cookie); the backend's configured origin must be exactly it.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { STATIC_HEADERS } = require('./package-headers.js');

const pkgRoot = path.resolve(__dirname, '..', 'dist', 'package');
const port = Number(process.argv[2]) || 8768;
const apiPort = Number(process.argv[3]) || 8769;
const MODE_LINE = 'const AUTH_MODE = AUTH_MODES.LOCAL;';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '': 'text/plain; charset=utf-8' };
const HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer'];

function forward(req, res){
  const headers = {};
  Object.keys(req.headers).forEach((k) => { if(HOP.indexOf(k) === -1) headers[k] = req.headers[k]; });
  const up = http.request({ host: '127.0.0.1', port: apiPort, method: req.method, path: req.url, headers: headers }, (r) => {
    const out = {};
    Object.keys(r.headers).forEach((k) => { if(HOP.indexOf(k) === -1) out[k] = r.headers[k]; });
    res.writeHead(r.statusCode, out);
    r.pipe(res);
  });
  up.on('error', () => { res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('backend unreachable'); });
  req.pipe(up);
}

if(!fs.existsSync(path.join(pkgRoot, 'index.html'))){
  console.error('dist/package/ is missing — run node tools/build-package.js first.');
  process.exit(1);
}

http.createServer((req, res) => {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  if(urlPath === '/api' || urlPath.startsWith('/api/')) return forward(req, res);
  if(req.method !== 'GET' && req.method !== 'HEAD'){ res.writeHead(405, { ...STATIC_HEADERS, 'Allow': 'GET, HEAD' }); return res.end(); }
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
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
  console.log('TEST-ONLY E2E front: SESSION-mode package at http://localhost:' + port + '/, /api → 127.0.0.1:' + apiPort + '. Ctrl+C to stop.');
});
