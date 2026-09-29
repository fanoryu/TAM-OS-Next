#!/usr/bin/env node
/*
 * build-package.js — TAM OS (Distribution-1, ADR-0002 Model B)
 * -----------------------------------------------------------------
 * Assembles the canonical deployment package: the static document root served at
 * https://finance.reliabilityindonesia.com/ (ADR-0004), with the future PHP API at
 * /api/* beside it.
 *
 *   dist/package/                          the document root (NOT committed)
 *   dist/tam-os-v<APP_VERSION>-package.zip the same files, deterministic ZIP (NOT committed)
 *   dist/package-manifest.json             per-file SHA-256 + package digest (COMMITTED)
 *
 * The build only assembles: every package file is a byte-identical copy of the source
 * file at the SAME relative path. Nothing is inlined, minified, transformed or reordered.
 * The file set is derived from index.html (its <link>/<script> references), plus the
 * licence texts for the bundled third-party code and fonts.
 *
 * It fails loudly on: an external (http/https/protocol-relative) reference, an inline
 * executable <script>, an inline <style> element, an inline event-handler attribute in
 * index.html, or a referenced file that does not exist.
 *
 * Output is deterministic: no timestamps, sorted entries, fixed ZIP dates.
 *
 * Usage:  node tools/build-package.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readAppMeta } = require('./app-version.js');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const MANIFEST_FORMAT = 'tam-os-package/1';
const ENTRY = 'index.html';

// Licence texts that must travel with the code/fonts they cover (paths as in source).
const PACKAGE_LICENSES = [
  'vendor/sheetjs/LICENSE',
  'assets/fonts/Inter-OFL.txt',
  'assets/fonts/JetBrainsMono-OFL.txt',
  'assets/fonts/Sora-OFL.txt',
  'assets/fonts/SourceSerif4-OFL.txt',
];

function fail(msg) { throw new Error('build-package: ' + msg); }

// Derive the runtime file set from index.html, enforcing the strict-CSP shape.
function referencedFiles(html) {
  const refs = [];
  if (/<style[\s>]/i.test(html)) fail('index.html contains an inline <style> element.');
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) fail('index.html contains an inline event-handler attribute.');
  const scriptRe = /<script\b([^>]*)>/gi;
  let m;
  while ((m = scriptRe.exec(html))) {
    const attrs = m[1];
    const src = (attrs.match(/\ssrc="([^"]*)"/) || [])[1];
    if (src === undefined) {
      if (!/\stype="application\/json"/.test(attrs)) fail('index.html contains an inline executable <script>.');
      continue;
    }
    refs.push(src);
  }
  const linkRe = /<link\b([^>]*)>/gi;
  while ((m = linkRe.exec(html))) {
    const href = (m[1].match(/\shref="([^"]*)"/) || [])[1];
    if (href === undefined || href.startsWith('data:')) continue;
    refs.push(href);
  }
  for (const r of refs) {
    if (/^(?:[a-z]+:)?\/\//i.test(r) || /^[a-z]+:/i.test(r)) fail('index.html references a non-local URL: ' + r);
    if (r.startsWith('/') || r.includes('..') || r.includes('\\')) fail('index.html reference must be a plain relative path: ' + r);
  }
  return refs;
}

function packageFiles() {
  const html = read(path.join(root, ENTRY));
  const files = [ENTRY, ...referencedFiles(html), ...PACKAGE_LICENSES];
  const unique = Array.from(new Set(files));
  if (unique.length !== files.length) fail('duplicate file reference in the package set.');
  for (const f of unique) {
    if (!fs.existsSync(path.join(root, f))) fail('referenced file does not exist: ' + f);
  }
  return unique.sort();
}

function sourceFacts() {
  const constants = read(path.join(root, 'js', 'core', 'constants.js'));
  const schema = constants.match(/const SCHEMA_VERSION = (\d+);/);
  if (!schema) fail('SCHEMA_VERSION not found in js/core/constants.js.');
  const authz = read(path.join(root, 'js', 'core', 'authz.js'));
  const block = authz.match(/const ACTIONS = Object\.freeze\(\{([\s\S]*?)\}\);/);
  if (!block) fail('ACTIONS not found in js/core/authz.js.');
  const actions = (block[1].match(/^\s*[A-Z_]+:\s*'[A-Za-z.]+',?\s*$/gm) || []).length;
  return { schemaVersion: Number(schema[1]), actions };
}

// ---- deterministic ZIP (STORE method, fixed 1980-01-01 timestamps, sorted entries) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
const DOS_TIME = 0x0000;
const DOS_DATE = 0x0021; // 1980-01-01

function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(10, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, end]);
}

// Pure assembly (no writes): the files, the ZIP bytes and the manifest text.
function assemblePackage() {
  const meta = readAppMeta();
  const facts = sourceFacts();
  const files = packageFiles().map((p) => {
    const data = fs.readFileSync(path.join(root, p));
    return { path: p, data, bytes: data.length, sha256: sha256(data) };
  });
  const packageDigest = sha256(files.map((f) => f.sha256 + '  ' + f.path + '\n').join(''));
  const zipName = 'tam-os-v' + meta.version + '-package.zip';
  const zip = buildZip(files.map((f) => ({ name: f.path, data: f.data })));
  const manifest = {
    format: MANIFEST_FORMAT,
    appVersion: meta.version,
    appReleaseName: meta.releaseName,
    schemaVersion: facts.schemaVersion,
    actions: facts.actions,
    entry: ENTRY,
    packageDigest,
    zip: { name: zipName, bytes: zip.length, sha256: sha256(zip) },
    files: files.map((f) => ({ path: f.path, bytes: f.bytes, sha256: f.sha256 })),
  };
  return { files, zip, zipName, manifestText: JSON.stringify(manifest, null, 2) + '\n', manifest };
}

function writePackage() {
  const pkg = assemblePackage();
  const distDir = path.join(root, 'dist');
  const outDir = path.join(distDir, 'package');
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const f of pkg.files) {
    const dest = path.join(outDir, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.data);
  }
  for (const old of fs.readdirSync(distDir)) {
    if (/^tam-os-v.*-package\.zip$/.test(old)) fs.rmSync(path.join(distDir, old));
  }
  fs.writeFileSync(path.join(distDir, pkg.zipName), pkg.zip);
  fs.writeFileSync(path.join(distDir, 'package-manifest.json'), pkg.manifestText, 'utf8');
  return pkg;
}

module.exports = { assemblePackage, packageFiles, referencedFiles, buildZip, crc32, PACKAGE_LICENSES, MANIFEST_FORMAT };

if (require.main === module) {
  const pkg = writePackage();
  console.log('Built dist/package/ (' + pkg.files.length + ' files), dist/' + pkg.zipName
    + ' (' + pkg.zip.length + ' bytes) and dist/package-manifest.json — v' + pkg.manifest.appVersion
    + ' ' + pkg.manifest.appReleaseName + ', package digest ' + pkg.manifest.packageDigest);
}
