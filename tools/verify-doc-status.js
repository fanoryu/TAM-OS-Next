#!/usr/bin/env node
'use strict';
// DOC-01: small Markdown-table contract, not a replacement for security/build checks.
// DOC-01-R2: only rendered Markdown counts — fenced code and HTML comments are ignored, headings are
// matched as whole lines, and the contract must appear exactly once with well-formed two-cell rows.
const fs = require('fs');
const path = require('path');
const VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9./-]*$/;
// Lines as GitHub renders them: fenced code blocks and HTML comments become empty lines.
function renderedLines(src) {
  const out = [];
  let fence = null;
  let inComment = false;
  for (const raw of src.split('\n')) {
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(raw);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      out.push('');
      continue;
    }
    let rest = raw;
    let kept = '';
    while (rest.length) {
      if (inComment) {
        const end = rest.indexOf('-->');
        if (end < 0) { rest = ''; break; }
        rest = rest.slice(end + 3);
        inComment = false;
      } else {
        const start = rest.indexOf('<!--');
        if (start < 0) { kept += rest; break; }
        kept += rest.slice(0, start);
        rest = rest.slice(start + 4);
        inComment = true;
      }
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(kept);
    if (open) { fence = open[1]; out.push(''); continue; }
    out.push(kept);
  }
  return out;
}
function cells(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  return t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}
function parse(src) {
  const lines = renderedLines(src.replace(/\r\n/g, '\n'));
  const starts = [];
  lines.forEach((l, i) => { if (/^## Status contract\s*$/.test(l)) starts.push(i); });
  const values = {};
  const result = { values, valid: false, sections: starts.length, wellFormed: true, outside: [] };
  if (starts.length !== 1) return result;
  let end = lines.length;
  for (let i = starts[0] + 1; i < lines.length; i++) if (/^#{1,2} /.test(lines[i])) { end = i; break; }
  let valid = true;
  let header = 0;
  for (let i = starts[0] + 1; i < end; i++) {
    const row = cells(lines[i]);
    if (!row) continue;
    if (row.length !== 2) { result.wellFormed = false; continue; }
    if (row[0] === 'Key' && row[1] === 'Value') { header++; continue; }
    if (row.every((c) => /^:?-+:?$/.test(c))) continue;
    if (!row[0] || !VALUE_RE.test(row[1])) { result.wellFormed = false; continue; }
    if (Object.prototype.hasOwnProperty.call(values, row[0])) valid = false;
    values[row[0]] = row[1];
  }
  if (header !== 1) result.wellFormed = false;
  lines.forEach((l, i) => {
    if (i >= starts[0] && i < end) return;
    const row = cells(l);
    if (row && row.length) result.outside.push(row[0]);
  });
  result.valid = valid;
  return result;
}
function assertions(src, meta, mode) {
  src = src.replace(/\r\n/g, '\n');
  const { values, valid, sections, wellFormed, outside } = parse(src);
  const lines = renderedLines(src);
  const expected = {
    repository: 'fanoryu/TAM-OS-Next', 'source-version': meta.version,
    'source-auth-mode': mode, 'published-version': '2.11.0',
    'published-state': 'PUBLISHED-LATEST', 'candidate-state': 'UNRELEASED',
    'session-readiness': 'NOT-PRODUCTION-READY', 'ENG-C1': 'BLOCKED',
    'release-v3.0.0': 'HOLD', 'Gate-D': 'HOLD', 'Gate-R': 'HOLD', Hostinger: 'NO-GO',
  };
  return [
    [sections === 1, 'DOC-01: exactly one rendered Status contract section'],
    [sections === 1 && wellFormed, 'DOC-01: status contract rows are well-formed two-cell Key/Value rows'],
    [!outside.some((k) => Object.prototype.hasOwnProperty.call(expected, k)),
      'DOC-01: no required status key is restated in another table'],
    [valid && Object.keys(values).length === Object.keys(expected).length,
      'DOC-01: status contract has unique required keys and no unexpected keys'],
    ...Object.entries(expected).map(([key, value]) => [values[key] === value,
      'DOC-01: status ' + key + ' agrees with reviewed source/governance baseline']),
    ...['Architecture', 'Completed source work', 'Incomplete work and limitations',
      'Release governance', 'Deployment gates', 'Navigation and history'].map((heading) =>
      [lines.some((l) => l.replace(/\s+$/, '') === '## ' + heading), 'DOC-01: status section exists — ' + heading]),
  ];
}
// A rendered link to the status document, resolved relative to the linking file.
function linksToStatus(name, text) {
  const target = name.startsWith('docs/') ? 'STATUS\\.md' : 'docs\\/STATUS\\.md';
  const re = new RegExp('\\]\\((?:\\.\\/)?' + target + '(?:#[^)\\s]*)?\\)');
  return re.test(renderedLines(text.replace(/\r\n/g, '\n')).join('\n'));
}
function verify(root, meta, check) {
  const statusPath = path.join(root, 'docs', 'STATUS.md');
  const exists = fs.existsSync(statusPath);
  check(exists, 'DOC-01: central status document exists');
  if (!exists) return;
  const constants = fs.readFileSync(path.join(root, 'js', 'core', 'constants.js'), 'utf8');
  const mode = (/const AUTH_MODE\s*=\s*AUTH_MODES\.([A-Z]+)\s*;/.exec(constants) || [])[1];
  check(mode === 'SESSION', 'DOC-01: reviewed source auth mode remains SESSION');
  for (const [ok, msg] of assertions(fs.readFileSync(statusPath, 'utf8'), meta, mode)) check(ok, msg);
  for (const name of ['README.md', 'docs/README.md', 'AI_CONTEXT.md', 'AGENTS.md']) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    check(linksToStatus(name, text), 'DOC-01: ' + name + ' links to central status');
  }
}
function selftest() {
  const root = path.resolve(__dirname, '..');
  const src = fs.readFileSync(path.join(root, 'docs', 'STATUS.md'), 'utf8').replace(/\r\n/g, '\n');
  const meta = require('./app-version.js').readAppMeta();
  const good = (s) => assertions(s, meta, 'SESSION').every(([ok]) => ok);
  const table = /\| Key \| Value \|[\s\S]*?\| Hostinger \| NO-GO \|\n/.exec(src)[0];
  const fixtures = [['baseline', src, true], ['CRLF checkout', src.replace(/\n/g, '\r\n'), true],
    ['prose can change', src.replace('No host access', 'No remote host access'), true],
    ['alignment separator', src.replace('|---|---|', '|:---|:---:|'), true],
    ['trailing heading space', src.replace('## Deployment gates\n', '## Deployment gates  \n'), true]];
  for (const [key, value] of Object.entries(parse(src).values)) {
    fixtures.push(['reject changed ' + key, src.replace('| ' + key + ' | ' + value + ' |', '| ' + key + ' | WRONG |'), false]);
  }
  fixtures.push(['duplicate gate', src.replace('| Gate-D | HOLD |', '| Gate-D | HOLD |\n| Gate-D | HOLD |'), false]);
  fixtures.push(['missing governance section', src.replace('## Release governance', '## Other'), false]);
  fixtures.push(['wrong source version', src.replace('| source-version | ' + meta.version + ' |', '| source-version | 9.9.9 |'), false]);
  fixtures.push(['demoted heading', src.replace('## Deployment gates\n', '### Deployment gates\n'), false]);
  fixtures.push(['heading only in fenced code', src.replace('## Deployment gates\n', '```\n## Deployment gates\n```\n'), false]);
  fixtures.push(['contract table in fenced code', src.replace(table, '```\n' + table + '```\n'), false]);
  fixtures.push(['contract table in HTML comment', src.replace(table, '<!--\n' + table + '-->\n'), false]);
  fixtures.push(['unclosed fence before contract', src.replace('## Status contract', '```\n## Status contract'), false]);
  fixtures.push(['second contract section', src + '\n## Status contract\n\n| Key | Value |\n|---|---|\n| Gate-D | GO |\n', false]);
  fixtures.push(['contradictory key in another table', src.replace('## Navigation and history\n', '## Navigation and history\n\n| Gate-D | GO |\n'), false]);
  fixtures.push(['three-cell contract row', src.replace('| Gate-R | HOLD |', '| Gate-R | HOLD | GO |'), false]);
  fixtures.push(['empty value cell', src.replace('| Gate-R | HOLD |', '| Gate-R | |'), false]);
  fixtures.push(['malformed value', src.replace('| Gate-R | HOLD |', '| Gate-R | HOLD (lifted) |'), false]);
  fixtures.push(['missing required key', src.replace('| Hostinger | NO-GO |\n', ''), false]);
  fixtures.push(['missing header row', src.replace('| Key | Value |\n', ''), false]);
  const links = [['README.md', '[s](docs/STATUS.md)', true], ['AGENTS.md', '[s](./docs/STATUS.md#gates)', true],
    ['AI_CONTEXT.md', '[s](STATUS.md)', false], ['docs/README.md', '[s](STATUS.md)', true],
    ['docs/README.md', '[s](docs/STATUS.md)', false], ['README.md', '```\n[s](docs/STATUS.md)\n```', false],
    ['README.md', '<!-- [s](docs/STATUS.md) -->', false]];
  let fails = 0;
  for (const [name, text, expected] of fixtures) {
    const ok = (expected || text !== src) && good(text) === expected;
    if (!ok) fails++;
    console.log((ok ? 'PASS ' : 'FAIL ') + name);
  }
  for (const [name, text, expected] of links) {
    const ok = linksToStatus(name, text) === expected;
    if (!ok) fails++;
    console.log((ok ? 'PASS ' : 'FAIL ') + 'link ' + name + ' ' + JSON.stringify(text));
  }
  console.log((fixtures.length + links.length) + ' documentation fixtures; ' + fails + ' failures');
  if (fails) process.exitCode = 1;
}
module.exports = { verify, parse, assertions, linksToStatus, renderedLines };
if (require.main === module) {
  if (process.argv[2] !== '--selftest') throw new Error('Use --selftest, or run tools/verify-build.js');
  selftest();
}
