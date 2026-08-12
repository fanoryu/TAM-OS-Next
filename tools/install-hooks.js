#!/usr/bin/env node
/*
 * install-hooks.js — point THIS repository's Git at the tracked .githooks/ directory.
 * ----------------------------------------------------------------------------------
 * Why this exists: `.git/hooks/` is not version-controlled, so a fresh clone of
 * TAM-OS-Next starts with no commit-message enforcement. `.githooks/` IS tracked, and
 * one repository-local config setting makes Git use it:
 *
 *     git config core.hooksPath .githooks
 *
 * This script performs exactly that and then proves it works, so the install is
 * verified rather than assumed.
 *
 * Scope guarantees (CLAUDE.md §15.7):
 *   - Writes ONLY repository-local config (`git config`, never `--global`/`--system`).
 *   - Never touches global Git configuration or hooks.
 *   - Refuses to run outside a Git work tree rather than configuring something else.
 *
 * Usage:
 *   node tools/install-hooks.js            install and verify
 *   node tools/install-hooks.js --check    verify only; non-zero if not installed
 *   node tools/install-hooks.js --uninstall  unset core.hooksPath for this repo
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOKS_DIR = '.githooks';
const REQUIRED_HOOKS = ['commit-msg'];

function git(args, opts) {
  return execFileSync('git', args, { encoding: 'utf8', ...opts }).trim();
}

function gitQuiet(args) {
  try {
    return { ok: true, out: git(args) };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  }
}

function fail(msg) {
  console.error('install-hooks: ' + msg);
  return 1;
}

function main(argv) {
  const check = argv.includes('--check');
  const uninstall = argv.includes('--uninstall');

  // Must be inside a work tree; otherwise `git config` would write somewhere unintended.
  const inTree = gitQuiet(['rev-parse', '--is-inside-work-tree']);
  if (!inTree.ok || inTree.out !== 'true') {
    return fail('not inside a Git work tree — refusing to write any Git configuration.');
  }
  const root = git(['rev-parse', '--show-toplevel']);

  if (uninstall) {
    gitQuiet(['config', '--unset', 'core.hooksPath']);
    console.log('install-hooks: core.hooksPath unset for this repository.');
    console.log('               Commit-message enforcement is now OFF locally (CI still enforces).');
    return 0;
  }

  // The tracked hooks must actually be present before we point Git at them.
  const missing = REQUIRED_HOOKS.filter((h) => !fs.existsSync(path.join(root, HOOKS_DIR, h)));
  if (missing.length) {
    return fail('missing tracked hook(s) in ' + HOOKS_DIR + '/: ' + missing.join(', '));
  }

  const current = gitQuiet(['config', '--local', '--get', 'core.hooksPath']);
  const installed = current.ok && current.out === HOOKS_DIR;

  if (check) {
    if (!installed) {
      return fail('core.hooksPath is ' + (current.ok ? '"' + current.out + '"' : 'unset') +
        ' — expected "' + HOOKS_DIR + '". Run: node tools/install-hooks.js');
    }
    console.log('install-hooks: OK — core.hooksPath = ' + HOOKS_DIR + ' (repository-local).');
    return 0;
  }

  if (!installed) {
    git(['config', 'core.hooksPath', HOOKS_DIR]); // repository-local by default
  }

  // Verify from Git's own view, not from what we think we wrote.
  const local = gitQuiet(['config', '--local', '--get', 'core.hooksPath']);
  if (!local.ok || local.out !== HOOKS_DIR) {
    return fail('failed to set core.hooksPath (got ' + (local.ok ? '"' + local.out + '"' : 'unset') + ').');
  }

  // Prove global config was not touched.
  const global_ = gitQuiet(['config', '--global', '--get', 'core.hooksPath']);
  const globalState = global_.ok && global_.out ? '"' + global_.out + '"' : 'unset (untouched)';

  // Prove the hook actually rejects a prohibited message, so a green install means
  // a working guard rather than a written config value.
  const checker = path.join(root, 'tools', 'check-commit-attribution.js');
  const probe = path.join(root, HOOKS_DIR, '.install-probe.tmp');
  let proof = 'not run';
  try {
    fs.writeFileSync(probe, 'chore: install probe\n\nCo-authored-by: Claude <noreply@anthropic.com>\n');
    let rejected = false;
    try {
      execFileSync(process.execPath, [checker, probe], { stdio: 'pipe' });
    } catch (e) {
      rejected = e.status === 1;
    }
    proof = rejected ? 'prohibited message correctly REJECTED' : 'PROBE FAILED — guard did not reject';
    if (!rejected) {
      fs.unlinkSync(probe);
      return fail('the attribution checker did not reject a prohibited message — guard is NOT operational.');
    }
  } finally {
    if (fs.existsSync(probe)) fs.unlinkSync(probe);
  }

  console.log('install-hooks: installed.');
  console.log('  repository       : ' + root);
  console.log('  core.hooksPath   : ' + local.out + '  (repository-local)');
  console.log('  global hooksPath : ' + globalState);
  console.log('  hooks active     : ' + REQUIRED_HOOKS.join(', '));
  console.log('  guard proof      : ' + proof);
  console.log('\nCommit messages carrying AI-attribution trailers will now be rejected locally.');
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
