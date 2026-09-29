#!/usr/bin/env node
/*
 * build-single-file.js — TAM Intelligence OS (Release Automation, v2.6.4+)
 * -----------------------------------------------------------------
 * RETIRED by Distribution-1 (ADR-0002 Model B).
 *
 * This tool assembled the portable single-file release dist/tam-os-v<APP_VERSION>.html by
 * inlining the CSS and the module-order JS into index.html. The single file cannot carry a
 * strict Content-Security-Policy, so the canonical distribution is now the deployment package
 * built by tools/build-package.js.
 *
 * Every single-file release already published (dist/tam-os-v2.11.0.html and the Releases before
 * it) is frozen history: tools/verify-build.js pins it by digest. Running the old assembly
 * against the current source would overwrite that artifact with different bytes under the same
 * version name, so this tool now refuses to run. It is kept, not deleted, as the record of how
 * those releases were produced (see Git history for its last working version).
 *
 * Usage:  node tools/build-package.js     (the replacement)
 */
'use strict';

console.error('tools/build-single-file.js is RETIRED by Distribution-1 — the single-file build is no longer produced.');
console.error('Build the deployment package instead:  node tools/build-package.js');
process.exit(1);
