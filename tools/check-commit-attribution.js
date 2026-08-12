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
 * This module is the SINGLE source of attribution policy. The tracked commit-msg hook
 * and the verify-attribution CI workflow both call it; neither restates the rules, so
 * local enforcement and CI enforcement cannot drift apart.
 *
 * Usage:
 *   node tools/check-commit-attribution.js <path-to-commit-message-file>
 *   node tools/check-commit-attribution.js --message "<commit message text>"
 *   node tools/check-commit-attribution.js --range <A>..<B>      # CI: check a range
 *   node tools/check-commit-attribution.js --base <sha> --head <sha>
 *   node tools/check-commit-attribution.js --selftest
 *
 * Local enforcement (tracked hook, survives a fresh clone once configured once):
 *   node tools/install-hooks.js        # sets core.hooksPath=.githooks for THIS repo
 * or equivalently:
 *   git config core.hooksPath .githooks
 */
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');

/*
 * Names that may never appear as a commit co-author or generator.
 *
 * These are matched ONLY inside a machine-readable attribution trailer value or a
 * "Generated with …" footer — never against ordinary prose. That distinction matters
 * here: "Atlas" and "Forge" are this project's own orchestration agent names and appear
 * legitimately in documentation and commit subjects (for example
 * docs/00-governance/Atlas_Governance_Register.md). A commit that *talks about* Atlas is
 * fine; a commit that *credits* Atlas as an author is not.
 */
const AI_NAMES = [
  'claude', 'anthropic', 'forge', 'atlas',
  'chatgpt', 'openai', 'codex', 'copilot',
  'gpt-3', 'gpt-4', 'gpt-5', 'gpt4',
  'gemini', 'cursor', 'devin',
];

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
// Range mode — used by CI so that the hook and the workflow share ONE policy
// implementation. There is deliberately no second copy of the rules in YAML.
//
// Accepts "A..B", a single revision, or nothing (defaults to HEAD). A missing or
// all-zero base (a branch's first push, where `github.event.before` is zeros) is
// treated as "just check the tip", not as "check nothing".
// ---------------------------------------------------------------------------
const ZERO_SHA = /^0{7,40}$/;

function readCommits(range) {
  // %H then the raw body, NUL-terminated per commit so multi-line bodies survive.
  const args = ['log', '--no-merges', '--format=%H%n%B%x00'];
  if (range) args.push(range);
  const out = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out
    .split('\0')
    .map((chunk) => chunk.replace(/^\n+/, ''))
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => {
      const nl = chunk.indexOf('\n');
      return nl === -1
        ? { sha: chunk.trim(), message: '' }
        : { sha: chunk.slice(0, nl).trim(), message: chunk.slice(nl + 1) };
    });
}

function resolveRange(base, head) {
  const h = head && head.trim() ? head.trim() : 'HEAD';
  if (!base || !base.trim() || ZERO_SHA.test(base.trim())) return h;
  return base.trim() + '..' + h;
}

function checkRange(range) {
  let commits;
  try {
    commits = readCommits(range);
  } catch (e) {
    console.error('check-commit-attribution: cannot read commit range "' + range + '": ' + e.message);
    return 2; // fail closed — an unreadable range is not a passing range
  }
  if (commits.length === 0) {
    console.log('check-commit-attribution: no commits in range "' + (range || 'HEAD') + '" — nothing to check.');
    return 0;
  }
  let bad = 0;
  for (const c of commits) {
    const v = check(c.message);
    const subject = c.message.split('\n')[0];
    if (v.length === 0) {
      console.log('  [OK]     ' + c.sha.slice(0, 12) + '  ' + subject);
    } else {
      bad++;
      console.log('  [REJECT] ' + c.sha.slice(0, 12) + '  ' + subject);
      for (const x of v) console.log('             * ' + x.describe + ' -> ' + x.line);
    }
  }
  console.log('\nchecked ' + commits.length + ' commit(s); ' + bad + ' violation(s).');
  if (bad > 0) {
    console.error('\ncheck-commit-attribution: ATTRIBUTION POLICY VIOLATED.');
    console.error('TAM OS commits are owner-authored (CLAUDE.md §15.7). AI participation belongs in the');
    console.error('orchestration log, not in Git metadata. Rewrite the offending commit message(s).\n');
    return 1;
  }
  console.log('check-commit-attribution: OK — every commit in range is attribution-clean.');
  return 0;
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
  // --- durable-guard additions: the remaining agent names the policy names explicitly ---
  ['Atlas co-author', 'feat: x\n\nCo-authored-by: Atlas <atlas@example.com>', true],
  ['Codex co-author', 'feat: x\n\nCo-authored-by: Codex <codex@example.com>', true],
  ['ChatGPT co-author', 'feat: x\n\nCo-authored-by: ChatGPT <chatgpt@openai.com>', true],
  ['OpenAI co-author', 'feat: x\n\nCo-authored-by: OpenAI Assistant <bot@openai.com>', true],
  ['GitHub Copilot co-author', 'feat: x\n\nCo-authored-by: GitHub Copilot <copilot@github.com>', true],
  ['Generated-by trailer', 'feat: x\n\nGenerated-by: Codex', true],
  ['Created-by trailer', 'feat: x\n\nCreated-by: Atlas', true],
  ['Authored-by trailer', 'feat: x\n\nAuthored-by: ChatGPT', true],
  // --- durable-guard additions: things that MUST keep passing ---
  // Atlas and Forge are this project's own agent names and appear legitimately in prose.
  ['prose naming Atlas (governance register)', 'docs(governance): update the Atlas Governance Register index', false],
  ['prose naming Forge', 'docs: record the Forge staging assignment outcome in the archive', false],
  ['prose naming several AI tools', 'docs: compare Claude, ChatGPT and Copilot as implementation tools', false],
  ['dependabot grouped actions bump', 'chore(deps): bump the github-actions group with 3 updates\n\nBumps actions/checkout, actions/setup-node and actions/upload-artifact.\n\nSigned-off-by: dependabot[bot] <support@github.com>', false],
  ['dependabot co-author trailer', 'chore(deps): bump actions/checkout from 4 to 5\n\nCo-authored-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>', false],
  ['dependabot bumping an ai-named package', 'chore(deps): bump ariga/atlas-action from 1.0.0 to 1.1.0', false],
  ['human co-author plus signoff', 'fix(payroll): correct lock check\n\nCo-authored-by: Budi Santoso <budi@example.com>\nSigned-off-by: fanoryu <fanoryu@gmail.com>', false],
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

  // Range mode (CI). --range A..B, or --base <sha> --head <sha>.
  const ri = argv.indexOf('--range');
  const bi = argv.indexOf('--base');
  const hi = argv.indexOf('--head');
  if (ri !== -1) {
    const r = argv[ri + 1];
    if (r === undefined) {
      console.error('check-commit-attribution: --range requires a value (e.g. A..B).');
      return 2;
    }
    return checkRange(r);
  }
  if (bi !== -1 || hi !== -1) {
    return checkRange(resolveRange(bi !== -1 ? argv[bi + 1] : '', hi !== -1 ? argv[hi + 1] : ''));
  }

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
      console.error('Usage: node tools/check-commit-attribution.js <commit-msg-file>');
      console.error('       node tools/check-commit-attribution.js --message "<text>"');
      console.error('       node tools/check-commit-attribution.js --range <A>..<B>');
      console.error('       node tools/check-commit-attribution.js --base <sha> --head <sha>');
      console.error('       node tools/check-commit-attribution.js --selftest');
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

module.exports = { check, normalize, checkRange, resolveRange, AI_NAMES };

if (require.main === module) process.exit(main(process.argv.slice(2)));
