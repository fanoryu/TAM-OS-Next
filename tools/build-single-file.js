#!/usr/bin/env node
/*
 * build-single-file.js — TAM Intelligence OS (Release Automation, v2.6.4+)
 * -----------------------------------------------------------------
 * Reassembles the modular source (index.html + css/ + js/) into the
 * portable single-file release:
 *     dist/tam-os-v.html
 *
 * The version is NEVER hardcoded here: it is derived from the single
 * source of truth, js/core/constants.js (APP_VERSION), via app-version.js.
 * The output filename follows APP_VERSION automatically.
 *
 * It inlines the five CSS files into one <style> and the JS modules into
 * one <script>, preserving order (from tools/module-order.js). No
 * minification. External XLSX + Google Fonts links are left untouched, so
 * the portable build behaves exactly like earlier single-file releases.
 *
 * Usage:  node tools/build-single-file.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readAppMeta } = require('./app-version.js');

const root = path.resolve(__dirname, '..');
const LF = '\n';

// Derive the release version + output filename from constants.js (fails clearly if unparseable).
const meta = readAppMeta();

const cssFiles = ['tokens.css', 'base.css', 'shell.css', 'components.css', 'charts.css'];
// JS load order lives in one place (mirrored by index.html). Paths are relative to js/.
const jsFiles = require('./module-order.js');

const read = (p) => fs.readFileSync(p, 'utf8');

let html = read(path.join(root, 'index.html'));

const cssLinkBlock = cssFiles.map((f) => `<link rel="stylesheet" href="css/${f}">`).join(LF);
const jsTagBlock = jsFiles.map((f) => `<script src="js/${f}"></script>`).join(LF);
if (!html.includes(cssLinkBlock)) throw new Error('CSS <link> block not found in index.html — cannot inline.');
if (!html.includes(jsTagBlock)) throw new Error('JS <script src> block not found in index.html — cannot inline (is index.html in sync with module-order.js?).');

const cssInline = '<style>' + LF + cssFiles.map((f) => read(path.join(root, 'css', f))).join(LF) + LF + '</style>';
const jsInline = '<script>' + LF + jsFiles.map((f) => read(path.join(root, 'js', f))).join(LF) + LF + '</script>';

html = html.replace(cssLinkBlock, cssInline).replace(jsTagBlock, jsInline);

const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const outPath = meta.distPath;

// Guard: the generated dist filename MUST embed APP_VERSION exactly (requirement 8).
if (path.basename(outPath) !== 'tam-os-v' + meta.version + '.html') {
  throw new Error('Generated dist filename "' + path.basename(outPath) + '" does not match APP_VERSION ' + meta.version + '.');
}
// Guard: the assembled HTML must actually carry this version (title + APP_VERSION const).
if (!html.includes("const APP_VERSION = '" + meta.version + "';")) {
  throw new Error('Assembled HTML does not contain APP_VERSION ' + meta.version + ' — is constants.js in sync?');
}
if (!html.includes('<title>TAM OS v' + meta.version + '</title>')) {  // UX-004F rebrand: TAM Intelligence OS -> TAM OS
  throw new Error('Assembled HTML <title> does not match version ' + meta.version + ' — update index.html.');
}

fs.writeFileSync(outPath, html, 'utf8');

console.log('Built ' + path.relative(root, outPath) + ' (' + Buffer.byteLength(html, 'utf8') + ' bytes) — v' + meta.version + ' ' + meta.releaseName);
