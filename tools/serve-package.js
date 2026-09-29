#!/usr/bin/env node
/*
 * serve-package.js — TAM OS (Distribution-1)
 * -----------------------------------------------------------------
 * A local, loopback-only static server for dist/package/ that applies the production
 * header contract from tools/package-headers.js (CSP included), so the package can be
 * browser-validated under its real policy before any deployment. /api/* answers 404
 * with the API cache headers — the backend is not implemented.
 *
 * Development/validation tooling only; it is never deployed.
 *
 * Usage:  node tools/build-package.js && node tools/serve-package.js [port]   (default 8765)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { STATIC_HEADERS, API_HEADERS } = require('./package-headers.js');

const pkgRoot = path.resolve(__dirname, '..', 'dist', 'package');
const port = Number(process.argv[2]) || 8765;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '': 'text/plain; charset=utf-8',
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

if (!fs.existsSync(path.join(pkgRoot, 'index.html'))) {
  console.error('dist/package/index.html not found — run `node tools/build-package.js` first.');
  process.exit(1);
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  if (urlPath === '/api' || urlPath.startsWith('/api/')) {
    return send(res, 404, { ...API_HEADERS, 'Content-Type': 'application/json' }, '{"error":"not_implemented"}');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, { ...STATIC_HEADERS, 'Allow': 'GET, HEAD' }, '');
  }
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(pkgRoot, rel);
  if (!file.startsWith(pkgRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, { ...STATIC_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
  }
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  send(res, 200, { ...STATIC_HEADERS, 'Content-Type': type }, req.method === 'HEAD' ? '' : fs.readFileSync(file));
}).listen(port, '127.0.0.1', () => {
  console.log('Serving dist/package/ at http://127.0.0.1:' + port + '/ with the production header contract (Ctrl+C to stop).');
});
