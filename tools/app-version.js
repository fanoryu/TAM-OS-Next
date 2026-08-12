#!/usr/bin/env node
/*
 * app-version.js — single source of truth for the release version in the Node tooling.
 * -----------------------------------------------------------------------------------
 * The canonical application version lives ONCE, in js/core/constants.js
 * (const APP_VERSION / const APP_RELEASE_NAME). This module parses those two
 * constants so the build and verify tools never hardcode a version string.
 *
 * Requirement (v2.6.4 Release Automation): there must be no independent version
 * source — build-single-file.js and verify-build.js both derive from here, which
 * derives from constants.js.
 *
 * Exports readAppMeta() -> { version, releaseName, distName, distPath }.
 * Throws clearly if APP_VERSION cannot be parsed or is not a recognized format.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const CONSTANTS = path.join(root, 'js', 'core', 'constants.js');

// Accept semver-like x.y.z with an optional single lowercase hotfix letter (e.g. 2.6.3c).
const VERSION_RE = /^\d+\.\d+\.\d+[a-z]?$/;

function readAppMeta() {
  let src;
  try {
    src = fs.readFileSync(CONSTANTS, 'utf8');
  } catch (e) {
    throw new Error('Cannot read js/core/constants.js to derive APP_VERSION: ' + e.message);
  }
  const vm = src.match(/const\s+APP_VERSION\s*=\s*'([^']+)'/);
  const rm = src.match(/const\s+APP_RELEASE_NAME\s*=\s*'([^']+)'/);
  if (!vm) throw new Error('Could not parse APP_VERSION from js/core/constants.js — release tooling cannot derive the version.');
  if (!rm) throw new Error('Could not parse APP_RELEASE_NAME from js/core/constants.js — release tooling cannot derive the release name.');
  const version = vm[1];
  if (!VERSION_RE.test(version)) {
    throw new Error('APP_VERSION "' + version + '" is not a recognized version format (expected x.y.z with an optional hotfix letter, e.g. 2.6.4 or 2.6.3c).');
  }
  const distName = 'tam-os-v' + version + '.html';
  return {
    version,
    releaseName: rm[1],
    distName,
    distPath: path.join(root, 'dist', distName),
  };
}

module.exports = { readAppMeta };

// Allow `node tools/app-version.js` to print the derived version (handy for scripts/CI).
if (require.main === module) {
  const m = readAppMeta();
  console.log(m.version + ' — ' + m.releaseName + ' -> dist/' + m.distName);
}
