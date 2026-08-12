#!/usr/bin/env node
/*
 * check-commit-attribution.js — owner-only Git authorship guard.
 * ---------------------------------------------------------------
 * TAM OS is a proprietary, single-owner codebase. Git authorship records who is
 * accountable for a change, and that is the owner — never an AI agent. AI
 * participation belongs in the orchestration log, not in commit metadata
 * (CLAUDE.md §15.7, AGENTS.md "Authorship is the owner's, not yours").
 *
 * This check FAILS CLOSED: any prohibited AI-attribution trailer or footer in the
 * commit message causes a non-zero exit, so a `commit-msg` hook or CI job running
 * it will reject the commit. It deliberately does NOT reject ordinary messages,
 * including ones that merely discuss Claude or mention co-authorship in prose —
 * only the machine-readable attribution forms are prohibited.
 *
 * Usage:
 *   node tools/check-commit-attribution.js <path-to-commit-message-file>
 *   node tools/check-commit-attribution.js --message "<commit message text>"
 *   node tools/check-commit-attribution.js --selftest
 *
 * Wiring it as a local hook (never installed automatically — the owner opts in):
 *   .git/hooks/commit-msg  ->  node tools/check-commit-attribution.js "$1"
 */
'use strict';
const fs = require('fs');

// Names that may never appear as a commit co-author or generator.
const AI_NAMES = ['claude', 'anthropic', 'forge', 'copilot', 'chatgpt', 'openai', 'gpt-4', 'gemini', 'cursor', 'devin'];

/*
 * Normalize before matching so trivial evasions do not slip through:
 *  - case is folded
 *  - zero-width and non-breaking spaces become ordinary spaces
 *  - runs of whitespace collapse (defeats "Co-authored-by  :  Claude")
 *  - common separator/homoglyph padding around the colon is removed
 */
function normalize(text) {
  return String(text)
    .replace(/[​-‍﻿]/g, '')
    .replace(/[  -   　]/g, ' ')
    .toLowerCase()
    .replace(/[ \t]+/g, ' ');
}

// Strip comment lines (git puts instructions there; they are not part of the message).
function messageBody(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

const RULES = [
  {
    id: 'co-authored-by',
    describe: 'Co-authored-by: trailer naming an AI agent',
    // "co-authored-by" with optional hyphen/space variance, then anything, then an AI name
    test: (n) => {
      const re = /^\s*co[-_ ]?authored[-_ ]?by\s*:\s*(.+)$/gm;
      let m;
      while ((m = re.exec(n)) !== null) {
        if (AI_NAMES.some((name) => m[1].includes(name))) return m[0].trim();
      }
      return null;
    },
  },
  {
    id: 'generated-with',
    describe: '"Generated with <AI>" footer',
    test: (n) => {
      const re = /^.*\bgenerated with\b.*$/gm;
      let m;
      while ((m = re.exec(n)) !== null) {
        if (AI_NAMES.some((name) => m[0].includes(name))) return m[0].trim();
      }
      return null;
    },
  },
  {
    id: 'assisted-by',
    describe: 'AI assistance/authorship trailer (Assisted-by / Authored-by / Created-by)',
    test: (n) => {
      const re = /^\s*(assisted[-_ ]?by|authored[-_ ]?by|created[-_ ]?by|generated[-_ ]?by|signed[-_ ]?off[-_ ]?by)\s*:\s*(.+)$/gm;
      let m;
      while ((m = re.exec(n)) !== null) {
        if (AI_NAMES.some((name) => m[2].includes(name))) return m[0].trim();
      }
      return null;
    },
  },
  {
    id: 'ai-noreply-email',
    describe: 'AI agent no-reply email address in a trailer',
    test: (n) => {
      const m = n.match(/^.*<[^>]*@(anthropic\.com|users\.noreply\.anthropic\.com)>.*$/m);
      return m ? m[0].trim() : null;
    },
  },
];

function check(text) {
  const n = normalize(messageBody(text));
  const violations = [];
  for (const rule of RULES) {
    const hit = rule.test(n);
    if (hit) violations.push({ rule: rule.id, describe: rule.describe, line: hit });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Self-test — proves the checker both rejects prohibited forms and accepts
// ordinary owner-authored messages. No Git commit is created.
// ---------------------------------------------------------------------------
const FIXTURES = [
  // [label, message, expectViolation]
  ['plain owner commit', 'feat(payroll): add overtime drift warning\n\nDerived at render time; no schema change.', false],
  ['owner commit with body + bullets', 'fix(finance): stop duplicate planned transactions\n\n- posting now updates or skips\n- audit trail unchanged', false],
  ['message mentioning claude in prose', 'docs: describe the Claude Artifact storage environment fallback', false],
  ['message with human co-author', 'feat(ui): sidebar density\n\nCo-authored-by: Jane Doe <jane@example.com>', false],
  ['dependabot style', 'chore(deps): bump github/codeql-action from 3 to 4', false],
  ['Co-authored-by Claude', 'feat: x\n\nCo-authored-by: Claude <noreply@anthropic.com>', true],
  ['Co-authored-by Claude Opus', 'feat: x\n\nCo-authored-by: Claude Opus 5 <noreply@anthropic.com>', true],
  ['Anthropic co-author', 'feat: x\n\nCo-authored-by: Anthropic Assistant <bot@anthropic.com>', true],
  ['Forge co-author', 'feat: x\n\nCo-authored-by: Forge <forge@example.com>', true],
  ['lowercase evasion', 'feat: x\n\nco-authored-by: claude <noreply@anthropic.com>', true],
  ['UPPERCASE evasion', 'feat: x\n\nCO-AUTHORED-BY: CLAUDE <NOREPLY@ANTHROPIC.COM>', true],
  ['MiXeD case evasion', 'feat: x\n\nCo-Authored-By: ClAuDe <x@y.z>', true],
  ['extra spacing evasion', 'feat: x\n\nCo-authored-by  :   Claude   <x@y.z>', true],
  ['tab evasion', 'feat: x\n\nCo-authored-by:\tClaude <x@y.z>', true],
  ['non-breaking space evasion', 'feat: x\n\nCo-authored-by: Claude <x@y.z>', true],
  ['zero-width space evasion', 'feat: x\n\nCo-au​thored-by: Claude <x@y.z>', true],
  ['underscore variant', 'feat: x\n\nCo_authored_by: Claude <x@y.z>', true],
  ['generated-with footer', 'feat: x\n\n🤖 Generated with Claude Code', true],
  ['assisted-by trailer', 'feat: x\n\nAssisted-by: Claude Opus 5', true],
  ['anthropic noreply email only', 'feat: x\n\nCo-authored-by: Someone <noreply@anthropic.com>', true],
];

function selftest() {
  let pass = 0, fail = 0;
  for (const [label, msg, expect] of FIXTURES) {
    const v = check(msg);
    const got = v.length > 0;
    const ok = got === expect;
    if (ok) pass++; else fail++;
    const verdict = expect ? 'REJECT' : 'ACCEPT';
    console.log(
      (ok ? '  [PASS] ' : '  [FAIL] ') +
      'expect ' + verdict + ' — ' + label +
      (got ? '  (matched: ' + v.map((x) => x.rule).join(', ') + ')' : '')
    );
  }
  console.log('\nSELFTEST ' + (fail === 0 ? 'PASSED' : 'FAILED') + ' -- ' + pass + ' passed, ' + fail + ' failed.');
  return fail === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
function main(argv) {
  if (argv.includes('--selftest')) return selftest();

  let text;
  const mi = argv.indexOf('--message');
  if (mi !== -1) {
    text = argv[mi + 1];
    if (text === undefined) {
      console.error('check-commit-attribution: --message requires a value.');
      return 2;
    }
  } else {
    const file = argv.find((a) => !a.startsWith('--'));
    if (!file) {
      console.error('Usage: node tools/check-commit-attribution.js <commit-msg-file> | --message "<text>" | --selftest');
      return 2;
    }
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (e) {
      console.error('check-commit-attribution: cannot read commit message file: ' + e.message);
      return 2; // fail closed — an unreadable message is not a passing message
    }
  }

  const violations = check(text);
  if (violations.length === 0) {
    console.log('check-commit-attribution: OK — no prohibited AI-attribution trailer.');
    return 0;
  }
  console.error('\ncheck-commit-attribution: COMMIT REJECTED — prohibited AI-attribution found.\n');
  for (const v of violations) {
    console.error('  * ' + v.describe);
    console.error('    ' + v.line);
  }
  console.error('\nTAM OS commits are owner-authored (CLAUDE.md §15.7). Remove the trailer and commit again.');
  console.error('AI participation belongs in the orchestration log, not in Git metadata.\n');
  return 1;
}

module.exports = { check, normalize };

if (require.main === module) process.exit(main(process.argv.slice(2)));
