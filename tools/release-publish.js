#!/usr/bin/env node
/*
 * release-publish.js — fail-closed, draft-first GitHub Release publication guard.
 * -------------------------------------------------------------------------------
 * Called ONLY by .github/workflows/release.yml (Approach C — defense in depth). It never
 * replaces, edits or deletes an existing release, draft or asset, and never retries a
 * mutation. Any doubt about the state on GitHub stops the run with a non-zero exit and a
 * printed recovery boundary for the Owner.
 *
 * Main ancestry and a valid tag are ELIGIBILITY evidence only. They are not release
 * authorization: the separate Owner GO of CLAUDE.md §20 and docs/RELEASE-PROCESS.md §11
 * still comes before any tag is pushed.
 *
 * Usage (the workflow passes the GitHub Actions environment):
 *   node tools/release-publish.js --eligibility
 *       Read-only. Event, repository, workflow revision, annotated tag, tag target, complete
 *       main history and main ancestry. Needs only a contents:read token.
 *   node tools/release-publish.js --publish --title "TAM OS $TAG" --notes-file RELEASE_NOTES.md
 *       Eligibility again, local package evidence, then: refuse if ANY release or draft exists
 *       for the tag -> create a draft -> upload the exact assets -> compare GitHub's digests
 *       with local SHA-256 values and the committed manifest -> publish -> read back.
 *   node tools/release-publish.js --selftest
 *       Offline. Mocked GitHub API, git and gh; never touches the network or the repository.
 *
 * Exit status: 0 on success; 1 on any refusal or failure (the message names the stage and
 * what the Owner must check). The token is read from GH_TOKEN and is never printed.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPOSITORY = 'fanoryu/TAM-OS-Next';
const WORKFLOW_FILE = '.github/workflows/release.yml';
const API_URL = 'https://api.github.com';
const UPLOAD_ORIGIN = 'https://uploads.github.com';
const TAG_RE = /^v\d+\.\d+\.\d+[a-z]?$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const MANIFEST_PATH = 'dist/package-manifest.json';
const MANIFEST_ASSET = 'package-manifest.json';
const API_TIMEOUT_MS = 30000;
const UPLOAD_TIMEOUT_MS = 300000;
const RELEASES_PER_PAGE = 100;
const MAX_RELEASE_PAGES = 20;

// Recovery boundaries. Each refusal names exactly one; the Owner acts on it, the workflow never does.
const STAGES = {
  'pre-draft': 'Nothing was created on GitHub by this run. Fix the cause. Re-running needs the Owner\'s release authorization and still refuses while any release or draft exists for the tag.',
  'draft-uncertain': 'The draft-creation request failed or its answer was unexpected: a draft MAY exist for this tag. The Owner inspects the repository\'s releases (drafts included). This workflow never deletes a draft, and every later run refuses while one exists.',
  'draft-left': 'A draft exists for this tag and was NOT published. It is left in place for Owner review and was not deleted, edited or re-uploaded. Every later run refuses while it exists; removing it is a separate, explicitly authorized Owner action.',
  'publish-uncertain': 'The publish request failed or its answer was unexpected: the release MAY now be published. Do not re-run this workflow. The Owner inspects the release; no asset was or will be replaced or removed by this workflow.',
  'post-publish': 'The release is published but its read-back did not fully verify. Nothing was replaced or removed, and this workflow will not try. The Owner records the finding; under CLAUDE.md section 13.4 a correction is a new version, never a change to this release.',
};

class Refusal extends Error {
  constructor(stage, message) {
    super(message);
    if (!STAGES[stage]) throw new Error('unknown stage ' + stage);
    this.stage = stage;
  }
}

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

// ---------------------------------------------------------------------------------------
// Real adapters (replaced by mocks in --selftest).
// ---------------------------------------------------------------------------------------
function realHttp(token) {
  return async function request(method, url, opts) {
    const o = opts || {};
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs || API_TIMEOUT_MS);
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'tam-os-release-guard',
    };
    let body;
    if (o.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.json); }
    else if (o.body !== undefined) { headers['Content-Type'] = o.contentType; body = o.body; }
    try {
      const res = await fetch(url, { method, headers, body, signal: ctrl.signal, redirect: 'error' });
      const text = await res.text();
      let data = null;
      if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
      return { status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  };
}

function realRunner(cmd) {
  return function run(args) {
    const r = spawnSync(cmd, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) return { status: -1, stdout: Buffer.alloc(0), stderr: String(r.error.message) };
    return { status: r.status, stdout: r.stdout, stderr: r.stderr ? r.stderr.toString('utf8') : '' };
  };
}

function realContext(env) {
  const root = path.resolve(__dirname, '..');
  return {
    env,
    root,
    http: realHttp(env.GH_TOKEN || ''),
    git: realRunner('git'),
    gh: realRunner('gh'),
    readFile: (rel) => fs.readFileSync(path.join(root, rel)),
    exists: (rel) => fs.existsSync(path.join(root, rel)),
    appVersion: () => require('./app-version.js').readAppMeta().version,
    log: (line) => console.log(line),
  };
}

// ---------------------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------------------
function gitText(ctx, args) {
  const r = ctx.git(args);
  if (r.status !== 0) throw new Refusal('pre-draft', 'git ' + args.join(' ') + ' failed (status ' + r.status + ')');
  return r.stdout.toString('utf8').trim();
}

async function api(ctx, method, url, opts, expect) {
  let res;
  try {
    res = await ctx.http(method, url, opts);
  } catch (e) {
    throw new ApiError(method + ' ' + url + ' did not complete: ' + (e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'error'), 0);
  }
  if (!res || res.status !== expect) {
    throw new ApiError(method + ' ' + url + ' answered ' + (res ? res.status : 'nothing') + ' (expected ' + expect + ')', res ? res.status : 0);
  }
  return res.data;
}

const repoUrl = (p) => API_URL + '/repos/' + REPOSITORY + p;

// Every release whose tag_name equals the tag, drafts included (drafts are visible only to a
// token with push access, which is why this runs only in the contents:write job). Any doubt
// about completeness — a non-array page or more pages than the cap — is a refusal.
async function releasesForTag(ctx, tag, stage) {
  const found = [];
  for (let page = 1; page <= MAX_RELEASE_PAGES; page++) {
    let data;
    try {
      data = await api(ctx, 'GET', repoUrl('/releases?per_page=' + RELEASES_PER_PAGE + '&page=' + page), {}, 200);
    } catch (e) {
      throw new Refusal(stage, 'cannot determine the release state for ' + tag + ': ' + e.message);
    }
    if (!Array.isArray(data)) throw new Refusal(stage, 'cannot determine the release state for ' + tag + ': releases page ' + page + ' is not a list');
    for (const r of data) {
      if (!r || typeof r.tag_name !== 'string') throw new Refusal(stage, 'cannot determine the release state for ' + tag + ': malformed release on page ' + page);
      if (r.tag_name === tag) found.push(r);
    }
    if (data.length < RELEASES_PER_PAGE) return found;
  }
  throw new Refusal(stage, 'cannot determine the release state for ' + tag + ': more than ' + (MAX_RELEASE_PAGES * RELEASES_PER_PAGE) + ' releases');
}

// ---------------------------------------------------------------------------------------
// Eligibility (read-only).
// ---------------------------------------------------------------------------------------
async function checkEligibility(ctx) {
  const env = ctx.env;
  const refuse = (m) => { throw new Refusal('pre-draft', m); };
  const tag = env.GITHUB_REF_NAME || '';
  const sha = env.GITHUB_SHA || '';
  if ((env.GITHUB_API_URL || '') !== API_URL) refuse('unsupported API endpoint (expected ' + API_URL + ')');
  if (env.GITHUB_REPOSITORY !== REPOSITORY) refuse('unexpected repository ' + JSON.stringify(env.GITHUB_REPOSITORY));
  if (env.GITHUB_EVENT_NAME !== 'push') refuse('release publication runs only on a tag push (event ' + JSON.stringify(env.GITHUB_EVENT_NAME) + ')');
  if (env.GITHUB_REF_TYPE !== 'tag' || env.GITHUB_REF !== 'refs/tags/' + tag) refuse('the triggering ref is not a tag: ' + JSON.stringify(env.GITHUB_REF));
  if (!TAG_RE.test(tag)) refuse('tag ' + JSON.stringify(tag) + ' is not a release version tag (vX.Y.Z)');
  let version;
  try { version = ctx.appVersion(); } catch (e) { refuse('cannot derive APP_VERSION: ' + e.message); }
  if (tag !== 'v' + version) refuse('tag ' + tag + ' does not match APP_VERSION (expected v' + version + ')');
  if (!SHA_RE.test(sha)) refuse('GITHUB_SHA is not a full commit id');
  // The workflow that is running must be the one at the tagged commit — never another revision.
  if (env.GITHUB_WORKFLOW_REF !== REPOSITORY + '/' + WORKFLOW_FILE + '@refs/tags/' + tag) refuse('unexpected workflow revision ' + JSON.stringify(env.GITHUB_WORKFLOW_REF));
  if (env.GITHUB_WORKFLOW_SHA !== sha) refuse('the running workflow file is not the one at the tagged commit');

  // Local evidence: complete history, annotated tag, tag target, checkout target.
  if (gitText(ctx, ['rev-parse', '--is-shallow-repository']) !== 'false') refuse('the checkout is shallow: main ancestry cannot be established');
  if (gitText(ctx, ['cat-file', '-t', 'refs/tags/' + tag]) !== 'tag') refuse('tag ' + tag + ' is not an annotated tag object (lightweight tags are refused)');
  const tagObject = gitText(ctx, ['rev-parse', 'refs/tags/' + tag]);
  if (gitText(ctx, ['rev-parse', 'refs/tags/' + tag + '^{commit}']) !== sha) refuse('tag ' + tag + ' does not resolve to the triggering commit');
  if (gitText(ctx, ['rev-parse', 'HEAD^{commit}']) !== sha) refuse('the checkout is not the tagged commit');
  const mainLocal = gitText(ctx, ['rev-parse', 'refs/remotes/origin/main^{commit}']);
  if (!SHA_RE.test(mainLocal)) refuse('origin/main is not available in the checkout');

  // GitHub's own view must agree with the local evidence.
  try {
    const ref = await api(ctx, 'GET', repoUrl('/git/ref/tags/' + encodeURIComponent(tag)), {}, 200);
    if (!ref || !ref.object || ref.object.type !== 'tag' || ref.object.sha !== tagObject) refuse('GitHub does not report ' + tag + ' as the same annotated tag object');
    const tobj = await api(ctx, 'GET', repoUrl('/git/tags/' + tagObject), {}, 200);
    if (!tobj || !tobj.object || tobj.object.type !== 'commit' || tobj.object.sha !== sha) refuse('GitHub reports a different target for tag ' + tag);
    const main = await api(ctx, 'GET', repoUrl('/branches/main'), {}, 200);
    if (!main || !main.commit || main.commit.sha !== mainLocal) refuse('the checked-out origin/main is not GitHub\'s current main: ancestry evidence is incomplete or stale');
  } catch (e) {
    if (e instanceof Refusal) throw e;
    refuse('cannot establish eligibility: ' + e.message);
  }

  const anc = ctx.git(['merge-base', '--is-ancestor', sha, mainLocal]);
  if (anc.status === 1) refuse('the tagged commit is not in the history of main');
  if (anc.status !== 0) refuse('cannot establish main ancestry (git status ' + anc.status + ')');

  ctx.log('Eligible: ' + tag + ' is an annotated tag on ' + sha + ', an ancestor of main ' + mainLocal + '. (Eligibility is not release authorization.)');
  return { tag, sha, version, mainLocal };
}

// ---------------------------------------------------------------------------------------
// Local package evidence: the exact assets, their sizes and SHA-256 values.
// ---------------------------------------------------------------------------------------
function localAssets(ctx, elig) {
  const refuse = (m) => { throw new Refusal('pre-draft', m); };
  const zipName = 'tam-os-v' + elig.version + '-package.zip';
  const zipPath = 'dist/' + zipName;
  if (!ctx.exists(MANIFEST_PATH)) refuse('missing ' + MANIFEST_PATH);
  if (!ctx.exists(zipPath)) refuse('missing ' + zipPath);
  const manifestBytes = ctx.readFile(MANIFEST_PATH);
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch (e) { refuse(MANIFEST_PATH + ' is not valid JSON'); }
  if (!manifest || manifest.format !== 'tam-os-package/1' || manifest.appVersion !== elig.version) refuse(MANIFEST_PATH + ' does not describe a tam-os-package/1 build of ' + elig.version);
  if (!manifest.zip || manifest.zip.name !== zipName || !/^[0-9a-f]{64}$/.test(manifest.zip.sha256 || '') || !Number.isInteger(manifest.zip.bytes)) refuse(MANIFEST_PATH + ' does not record ' + zipName);
  const committed = ctx.git(['show', elig.sha + ':' + MANIFEST_PATH]);
  if (committed.status !== 0) refuse('cannot read the committed ' + MANIFEST_PATH + ' at ' + elig.sha);
  if (!Buffer.from(committed.stdout).equals(manifestBytes)) refuse('the built ' + MANIFEST_PATH + ' differs from the one committed at the tag');
  const zipBytes = ctx.readFile(zipPath);
  const zipSha = sha256(zipBytes);
  if (zipSha !== manifest.zip.sha256 || zipBytes.length !== manifest.zip.bytes) refuse(zipPath + ' does not match the committed manifest (size or SHA-256)');
  return [
    { name: zipName, path: zipPath, bytes: zipBytes, size: zipBytes.length, sha256: zipSha, contentType: 'application/zip' },
    { name: MANIFEST_ASSET, path: MANIFEST_PATH, bytes: manifestBytes, size: manifestBytes.length, sha256: sha256(manifestBytes), contentType: 'application/json' },
  ];
}

// The release must carry exactly the expected assets: names, count, state, size and digest.
function assetProblems(release, expected) {
  const problems = [];
  const assets = Array.isArray(release && release.assets) ? release.assets : null;
  if (!assets) return ['the release has no readable asset list'];
  if (assets.length !== expected.length) problems.push('expected ' + expected.length + ' assets, found ' + assets.length);
  const names = assets.map((a) => a && a.name);
  if (new Set(names).size !== names.length) problems.push('duplicate asset names');
  for (const want of expected) {
    const got = assets.filter((a) => a && a.name === want.name);
    if (got.length !== 1) { problems.push(want.name + ': ' + (got.length ? 'ambiguous' : 'missing')); continue; }
    const a = got[0];
    if (a.state !== 'uploaded') problems.push(want.name + ': state ' + JSON.stringify(a.state));
    if (a.size !== want.size) problems.push(want.name + ': size ' + a.size + ' != ' + want.size);
    if (typeof a.digest !== 'string' || !DIGEST_RE.test(a.digest)) problems.push(want.name + ': no SHA-256 digest reported');
    else if (a.digest !== 'sha256:' + want.sha256) problems.push(want.name + ': digest ' + a.digest + ' != sha256:' + want.sha256);
  }
  for (const n of names) if (!expected.some((w) => w.name === n)) problems.push('unexpected asset ' + JSON.stringify(n));
  return problems;
}

// ---------------------------------------------------------------------------------------
// Publication.
// ---------------------------------------------------------------------------------------
async function publish(ctx, opts) {
  if (!opts.title || !opts.notesFile) throw new Refusal('pre-draft', '--publish needs --title and --notes-file');
  const elig = await checkEligibility(ctx);
  const assets = localAssets(ctx, elig);
  if (!ctx.exists(opts.notesFile)) throw new Refusal('pre-draft', 'missing release notes ' + opts.notesFile);
  const notes = ctx.readFile(opts.notesFile).toString('utf8');
  for (const a of assets) ctx.log('Local asset ' + a.name + ': ' + a.size + ' bytes, sha256:' + a.sha256);

  // 5. No release and no draft may exist for this tag.
  const existing = await releasesForTag(ctx, elig.tag, 'pre-draft');
  if (existing.length) {
    throw new Refusal('pre-draft', 'a release already exists for ' + elig.tag + ' (' + existing.map((r) => 'id ' + r.id + (r.draft ? ' draft' : ' published')).join(', ') + '); refusing to touch it');
  }

  // 6. Create the draft. A failure here leaves an unknown state, never a retry.
  let draft;
  try {
    draft = await api(ctx, 'POST', repoUrl('/releases'), { json: { tag_name: elig.tag, name: opts.title, body: notes, draft: true, prerelease: false } }, 201);
  } catch (e) {
    throw new Refusal('draft-uncertain', 'draft creation failed: ' + e.message);
  }
  if (!draft || !Number.isInteger(draft.id) || draft.draft !== true || draft.tag_name !== elig.tag) {
    throw new Refusal('draft-uncertain', 'draft creation answered with an unexpected release object');
  }
  const draftUrl = repoUrl('/releases/' + draft.id);
  ctx.log('Created draft release id ' + draft.id + ' for ' + elig.tag + '.');

  // A concurrent run may have created its own: exactly one release for the tag, and it is ours.
  const mine = await releasesForTag(ctx, elig.tag, 'draft-left');
  if (mine.length !== 1 || mine[0].id !== draft.id) {
    throw new Refusal('draft-left', 'more than one release now exists for ' + elig.tag + ' (' + mine.map((r) => r.id).join(', ') + '); nothing is published');
  }

  // 7. Upload each asset exactly once to this draft's own upload URL.
  const uploadBase = String(draft.upload_url || '').replace(/\{\?[^}]*\}$/, '');
  if (uploadBase !== UPLOAD_ORIGIN + '/repos/' + REPOSITORY + '/releases/' + draft.id + '/assets') {
    throw new Refusal('draft-left', 'the draft reported an unexpected upload URL');
  }
  for (const a of assets) {
    let up;
    try {
      up = await api(ctx, 'POST', uploadBase + '?name=' + encodeURIComponent(a.name), { body: a.bytes, contentType: a.contentType, timeoutMs: UPLOAD_TIMEOUT_MS }, 201);
    } catch (e) {
      throw new Refusal('draft-left', 'upload of ' + a.name + ' failed: ' + e.message + ' (no retry, no replacement)');
    }
    if (!up || up.name !== a.name) throw new Refusal('draft-left', 'upload of ' + a.name + ' was stored under another name');
    ctx.log('Uploaded ' + a.name + ' to draft ' + draft.id + '.');
  }

  // 8. GitHub's digests must equal the local SHA-256 values (the ZIP's already equals the manifest).
  let fresh;
  try { fresh = await api(ctx, 'GET', draftUrl, {}, 200); } catch (e) { throw new Refusal('draft-left', 'cannot read the draft back: ' + e.message); }
  if (!fresh || fresh.id !== draft.id || fresh.draft !== true || fresh.tag_name !== elig.tag) throw new Refusal('draft-left', 'the draft is no longer an unpublished draft for ' + elig.tag);
  const before = assetProblems(fresh, assets);
  if (before.length) throw new Refusal('draft-left', 'draft assets do not verify: ' + before.join('; '));
  ctx.log('Draft assets verified: names, count, sizes and SHA-256 digests match.');

  // 9. Publish — the only change ever made to an existing release, and only to this draft.
  let pub;
  try {
    pub = await api(ctx, 'PATCH', draftUrl, { json: { draft: false } }, 200);
  } catch (e) {
    throw new Refusal('publish-uncertain', 'publish failed: ' + e.message);
  }
  if (!pub || pub.id !== draft.id || pub.draft !== false) throw new Refusal('publish-uncertain', 'publish answered with an unexpected release object');
  ctx.log('Published release id ' + draft.id + '.');

  // 10. Read back the published release (read-only from here on).
  const post = (m) => { throw new Refusal('post-publish', m); };
  let live;
  try { live = await api(ctx, 'GET', repoUrl('/releases/tags/' + encodeURIComponent(elig.tag)), {}, 200); } catch (e) { post('cannot read the published release back: ' + e.message); }
  if (!live || live.id !== draft.id || live.draft !== false || live.tag_name !== elig.tag) post('the published release for ' + elig.tag + ' is not the verified draft');
  const after = assetProblems(live, assets);
  if (after.length) post('published assets do not verify: ' + after.join('; '));
  const all = await releasesForTag(ctx, elig.tag, 'post-publish');
  if (all.length !== 1) post('more than one release exists for ' + elig.tag);
  for (const a of live.assets) ctx.log('Published asset ' + a.name + ': ' + a.size + ' bytes, ' + a.digest);
  if (typeof live.immutable !== 'boolean') post('the release does not report its immutable state');
  ctx.log('Release immutable: ' + live.immutable + '.');
  if (live.immutable) {
    // Immutable Releases is on: use GitHub's own attestation verification as well.
    const help = ctx.gh(['release', 'verify', '--help']);
    if (help.status !== 0) post('Immutable Releases is on but this GitHub CLI has no "release verify" command');
    const v = ctx.gh(['release', 'verify', elig.tag, '--repo', REPOSITORY]);
    if (v.status !== 0) post('gh release verify failed for ' + elig.tag);
    for (const a of assets) {
      const va = ctx.gh(['release', 'verify-asset', elig.tag, a.path, '--repo', REPOSITORY]);
      if (va.status !== 0) post('gh release verify-asset failed for ' + a.name);
    }
    ctx.log('GitHub release attestation verified for the release and every asset.');
  } else {
    ctx.log('Immutable Releases is not in effect for this release; asset immutability rests on CLAUDE.md section 13.4 policy.');
  }
  ctx.log('Release ' + elig.tag + ' published and verified: ' + (live.html_url || ''));
  return { id: draft.id, immutable: live.immutable };
}

// ---------------------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------------------
function argValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : '';
}

let currentStage = 'pre-draft';
function report(e) {
  if (e instanceof Refusal) {
    console.error('::error::Release refused at stage "' + e.stage + '": ' + e.message);
    console.error('Recovery boundary: ' + STAGES[e.stage]);
  } else {
    console.error('::error::Release guard failed: ' + (e && e.message));
    console.error('Recovery boundary: ' + STAGES[currentStage]);
  }
}

async function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const ctx = realContext(process.env);
  // Track the furthest stage reached so a cancellation or crash prints the right boundary.
  const http = ctx.http;
  ctx.http = async (method, url, opts) => {
    if (method === 'POST' && url === repoUrl('/releases')) currentStage = 'draft-uncertain';
    else if (method === 'POST') currentStage = 'draft-left';
    else if (method === 'PATCH') currentStage = 'publish-uncertain';
    const res = await http(method, url, opts);
    if (method === 'POST' && url === repoUrl('/releases') && res.status === 201) currentStage = 'draft-left';
    if (method === 'PATCH' && res.status === 200) currentStage = 'post-publish';
    return res;
  };
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.error('::error::Release run cancelled (' + sig + ') at stage "' + currentStage + '". No cleanup is attempted.');
      console.error('Recovery boundary: ' + STAGES[currentStage]);
      process.exit(1);
    });
  }
  if (argv.includes('--eligibility')) { await checkEligibility(ctx); return 0; }
  if (argv.includes('--publish')) {
    if (!ctx.env.GH_TOKEN) throw new Refusal('pre-draft', 'GH_TOKEN is not set');
    await publish(ctx, { title: argValue(argv, '--title'), notesFile: argValue(argv, '--notes-file') });
    return 0;
  }
  console.error('Usage: node tools/release-publish.js --eligibility | --publish --title <t> --notes-file <f> | --selftest');
  return 1;
}

// ---------------------------------------------------------------------------------------
// --selftest: offline scenarios against a mocked GitHub, git and gh.
// ---------------------------------------------------------------------------------------
function mockWorld(over) {
  const o = over || {};
  const sha = 'a'.repeat(40);
  const tagObj = 'b'.repeat(40);
  const main = o.main || 'c'.repeat(40);
  const version = '3.0.0';
  const tag = 'v' + version;
  const zipName = 'tam-os-v' + version + '-package.zip';
  const zip = Buffer.from('fabricated package zip bytes for selftest');
  const manifestObj = { format: 'tam-os-package/1', appVersion: version, zip: { name: zipName, bytes: zip.length, sha256: sha256(zip) }, files: [] };
  const manifest = Buffer.from(JSON.stringify(manifestObj, null, 2) + '\n');
  const files = Object.assign({ [MANIFEST_PATH]: manifest, ['dist/' + zipName]: zip, 'RELEASE_NOTES.md': Buffer.from('notes') }, o.files || {});
  for (const k of Object.keys(files)) if (files[k] === null) delete files[k];
  const w = {
    sha, tagObj, main, version, tag, zip, manifest,
    releases: (o.releases || []).map((r) => Object.assign({ assets: [] }, r)),
    nextId: 100, nextAsset: 1, calls: [], immutable: o.immutable || false, fail: o.fail || {},
  };
  const env = Object.assign({
    GITHUB_API_URL: API_URL, GITHUB_REPOSITORY: REPOSITORY, GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'tag',
    GITHUB_REF: 'refs/tags/' + tag, GITHUB_REF_NAME: tag, GITHUB_SHA: sha,
    GITHUB_WORKFLOW_REF: REPOSITORY + '/' + WORKFLOW_FILE + '@refs/tags/' + tag, GITHUB_WORKFLOW_SHA: sha, GH_TOKEN: 'x',
  }, o.env || {});
  const gitAnswers = Object.assign({
    'rev-parse --is-shallow-repository': 'false',
    ['cat-file -t refs/tags/' + tag]: 'tag',
    ['rev-parse refs/tags/' + tag]: tagObj,
    ['rev-parse refs/tags/' + tag + '^{commit}']: sha,
    'rev-parse HEAD^{commit}': sha,
    'rev-parse refs/remotes/origin/main^{commit}': main,
  }, o.git || {});
  const ancestorStatus = o.ancestorStatus === undefined ? 0 : o.ancestorStatus;
  const committedManifest = o.committedManifest || manifest;
  const git = (args) => {
    const key = args.join(' ');
    if (key === 'merge-base --is-ancestor ' + sha + ' ' + main) return { status: ancestorStatus, stdout: Buffer.alloc(0) };
    if (key === 'show ' + sha + ':' + MANIFEST_PATH) return { status: 0, stdout: committedManifest };
    if (Object.prototype.hasOwnProperty.call(gitAnswers, key)) {
      const v = gitAnswers[key];
      return v === null ? { status: 128, stdout: Buffer.alloc(0) } : { status: 0, stdout: Buffer.from(v + '\n') };
    }
    return { status: 128, stdout: Buffer.alloc(0) };
  };
  const api = (p) => API_URL + '/repos/' + REPOSITORY + p;
  const view = (r) => JSON.parse(JSON.stringify(Object.assign({ immutable: r.draft ? false : w.immutable, html_url: 'https://github.test/r/' + r.id }, r)));
  const http = async (method, url, opts) => {
    const op = opts || {};
    w.calls.push({ method, url, json: op.json });
    const f = w.fail;
    const key = method + ' ' + url.replace(/\?.*$/, '');
    if (f.timeout === key || (f.timeoutCall && f.timeoutCall(method, url))) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    if (f.status && f.status[key]) return { status: f.status[key], data: { message: 'injected' } };
    if (method === 'GET' && url === api('/git/ref/tags/' + tag)) return { status: 200, data: o.apiRef || { object: { type: 'tag', sha: tagObj } } };
    if (method === 'GET' && url === api('/git/tags/' + tagObj)) return { status: 200, data: o.apiTag || { object: { type: 'commit', sha } } };
    if (method === 'GET' && url === api('/branches/main')) return { status: 200, data: { commit: { sha: o.apiMain || main } } };
    if (method === 'GET' && url.startsWith(api('/releases?'))) {
      const page = Number(/[?&]page=(\d+)/.exec(url)[1]);
      if (f.listPages) return { status: 200, data: f.listPages(page, w) };
      return { status: 200, data: page === 1 ? w.releases.map(view) : [] };
    }
    if (method === 'POST' && url === api('/releases')) {
      if (f.raceDraft) w.releases.push({ id: 999, tag_name: tag, draft: true, assets: [] });
      const r = { id: w.nextId++, tag_name: op.json.tag_name, name: op.json.name, draft: op.json.draft, assets: [],
        upload_url: (f.uploadHost || UPLOAD_ORIGIN) + '/repos/' + REPOSITORY + '/releases/' + (w.nextId - 1) + '/assets{?name,label}' };
      w.releases.push(r);
      return { status: 201, data: f.createAnswer ? f.createAnswer(r) : view(r) };
    }
    const up = new RegExp('^' + UPLOAD_ORIGIN.replace(/\./g, '\\.') + '/repos/' + REPOSITORY + '/releases/(\\d+)/assets\\?name=(.+)$').exec(url);
    if (method === 'POST' && up) {
      const r = w.releases.find((x) => x.id === Number(up[1]));
      const name = decodeURIComponent(up[2]);
      if (!r || !r.draft) return { status: 404, data: {} };
      if (r.assets.some((a) => a.name === name)) return { status: 422, data: { message: 'already_exists' } };
      if (f.uploadFailAt && f.uploadFailAt === r.assets.length + 1) {
        if (f.partialStored) r.assets.push({ name, size: op.body.length, state: 'starter', digest: null });
        const e = new Error('socket hang up'); throw e;
      }
      let digest = 'sha256:' + sha256(op.body);
      if (f.digest && Object.prototype.hasOwnProperty.call(f.digest, name)) digest = f.digest[name];
      const size = f.size && f.size[name] !== undefined ? f.size[name] : op.body.length;
      const a = { id: w.nextAsset++, name, size, state: (f.state && f.state[name]) || 'uploaded', digest };
      if (!(f.dropAsset && f.dropAsset === name)) r.assets.push(a);
      if (f.extraAsset && r.assets.length === 1) r.assets.push({ id: w.nextAsset++, name: f.extraAsset, size: 1, state: 'uploaded', digest: 'sha256:' + sha256(Buffer.from('x')) });
      return { status: 201, data: a };
    }
    const one = new RegExp('^' + api('/releases/').replace(/[./]/g, '\\$&') + '(\\d+)$').exec(url);
    if (one && method === 'GET') {
      const r = w.releases.find((x) => x.id === Number(one[1]));
      return r ? { status: 200, data: view(r) } : { status: 404, data: {} };
    }
    if (one && method === 'PATCH') {
      const r = w.releases.find((x) => x.id === Number(one[1]));
      if (!r) return { status: 404, data: {} };
      r.draft = op.json.draft;
      if (f.afterPublish) f.afterPublish(r);
      return { status: 200, data: view(r) };
    }
    if (method === 'GET' && url === api('/releases/tags/' + tag)) {
      const r = w.releases.find((x) => x.tag_name === tag && !x.draft);
      if (!r) return { status: 404, data: {} };
      const v = view(r);
      if (f.noImmutableField) delete v.immutable;
      return { status: 200, data: v };
    }
    return { status: 404, data: {} };
  };
  w.ghCalls = [];
  const gh = (args) => { w.ghCalls.push(args.join(' ')); return { status: (o.ghFail && o.ghFail(args)) ? 1 : 0, stdout: Buffer.alloc(0) }; };
  w.ctx = {
    env, root: '/selftest', http, git, gh,
    readFile: (rel) => { if (!files[rel]) throw new Error('ENOENT ' + rel); return files[rel]; },
    exists: (rel) => Object.prototype.hasOwnProperty.call(files, rel),
    appVersion: () => o.appVersion || version,
    log: () => {},
  };
  return w;
}

async function selftest() {
  let pass = 0, fail = 0;
  const ok = (cond, name) => { if (cond) pass++; else { fail++; console.error('FAIL: ' + name); } };
  const OPTS = { title: 'TAM OS v3.0.0', notesFile: 'RELEASE_NOTES.md' };
  const mutations = (w) => w.calls.filter((c) => c.method !== 'GET');
  const run = async (w, fn) => { try { await (fn || ((c) => publish(c, OPTS)))(w.ctx); return null; } catch (e) { return e; } };
  // Invariants every scenario must hold, whatever the outcome.
  const invariants = (w, name) => {
    ok(!w.calls.some((c) => c.method === 'DELETE' || c.method === 'PUT'), name + ': never DELETE or PUT');
    ok(w.calls.filter((c) => c.method === 'PATCH').every((c) => JSON.stringify(c.json) === '{"draft":false}'), name + ': PATCH only ever publishes ({draft:false})');
    ok(w.calls.filter((c) => c.method === 'PATCH').length <= 1, name + ': at most one publish request');
    ok(w.calls.filter((c) => c.method === 'POST' && c.url === API_URL + '/repos/' + REPOSITORY + '/releases').length <= 1, name + ': at most one draft creation');
    const created = w.calls.find((c) => c.method === 'POST' && c.url.endsWith('/repos/' + REPOSITORY + '/releases'));
    const draftIds = new Set(w.releases.filter((r) => r.id >= 100 && r.id < 999).map((r) => String(r.id)));
    ok(w.calls.filter((c) => c.method !== 'GET' && /\/releases\/\d+/.test(c.url)).every((c) => created && draftIds.has(/\/releases\/(\d+)/.exec(c.url)[1])),
      name + ': only the draft this run created is ever changed');
    const uploads = w.calls.filter((c) => c.method === 'POST' && c.url.startsWith(UPLOAD_ORIGIN)).map((c) => c.url);
    ok(new Set(uploads).size === uploads.length, name + ': no asset upload is retried');
    ok(!w.calls.some((c) => /clobber/i.test(c.url)), name + ': no clobber');
  };
  const refused = (e, stage, re, name) => {
    ok(e instanceof Refusal, name + ': refused');
    ok(e instanceof Refusal && e.stage === stage, name + ': stage ' + stage + (e && e.stage ? ' (got ' + e.stage + ')' : ' (got ' + (e && e.message) + ')'));
    if (re) ok(e && re.test(e.message), name + ': reason matches ' + re + ' (got ' + (e && e.message) + ')');
  };
  const scenario = async (name, over, check, fn) => {
    const w = mockWorld(over);
    const e = await run(w, fn);
    try { check(w, e, name); } catch (x) { ok(false, name + ': check crashed (' + x.message + ')'); }
    invariants(w, name);
  };
  const DIGEST_X = 'sha256:' + 'f'.repeat(64);

  // 1. New valid release candidate.
  await scenario('S1 valid candidate', {}, (w, e, n) => {
    ok(e === null, n + ': publishes (' + (e && e.message) + ')');
    const r = w.releases.find((x) => x.id === 100);
    ok(r && r.draft === false && r.assets.length === 2, n + ': one published release with two assets');
    const seq = mutations(w).map((c) => c.method + (c.url.startsWith(UPLOAD_ORIGIN) ? ' upload' : ''));
    ok(seq.join() === 'POST,POST upload,POST upload,PATCH', n + ': exact sequence create, upload, upload, publish (got ' + seq.join() + ')');
    const patchAt = w.calls.findIndex((c) => c.method === 'PATCH');
    ok(w.calls.slice(0, patchAt).some((c) => c.method === 'GET' && c.url.endsWith('/releases/100')), n + ': draft read back and verified before publish');
    ok(w.calls.slice(patchAt).some((c) => c.url.endsWith('/releases/tags/v3.0.0')), n + ': published release read back');
    ok(w.ghCalls.length === 0, n + ': no gh attestation call while immutable is false');
  });
  await scenario('S1b eligibility only (read-only)', {}, (w, e, n) => {
    ok(e === null, n + ': eligible');
    ok(mutations(w).length === 0, n + ': no mutation');
    ok(!w.calls.some((c) => c.url.includes('/releases')), n + ': eligibility never reads release state (drafts need a write token)');
  }, (c) => checkEligibility(c));

  // 2. Existing published release. 3. Existing draft.
  for (const [name, rel] of [['S2 existing published release', { id: 7, tag_name: 'v3.0.0', draft: false }],
    ['S3 existing draft', { id: 8, tag_name: 'v3.0.0', draft: true }]]) {
    await scenario(name, { releases: [{ id: 1, tag_name: 'v2.11.0', draft: false }, rel] }, (w, e, n) => {
      refused(e, 'pre-draft', /already exists/, n);
      ok(mutations(w).length === 0, n + ': zero mutations');
      ok(w.releases.some((r) => r.id === rel.id && r.draft === rel.draft), n + ': existing release left untouched');
    });
  }
  await scenario('S3b existing draft on page 2', { fail: { listPages: (p) => p === 1 ? Array.from({ length: 100 }, (_, i) => ({ id: 500 + i, tag_name: 'v1.0.' + i, draft: false })) : p === 2 ? [{ id: 9, tag_name: 'v3.0.0', draft: true }] : [] } },
    (w, e, n) => { refused(e, 'pre-draft', /already exists/, n); ok(mutations(w).length === 0, n + ': zero mutations'); });

  // 4. Unannotated tag.
  await scenario('S4 lightweight tag (local)', { git: { 'cat-file -t refs/tags/v3.0.0': 'commit' } }, (w, e, n) => { refused(e, 'pre-draft', /annotated/, n); ok(mutations(w).length === 0, n + ': zero mutations'); });
  await scenario('S4b GitHub reports a lightweight tag', { apiRef: { object: { type: 'commit', sha: 'b'.repeat(40) } } }, (w, e, n) => { refused(e, 'pre-draft', /annotated tag object/, n); ok(mutations(w).length === 0, n + ': zero mutations'); });
  await scenario('S4c tag points elsewhere on GitHub', { apiTag: { object: { type: 'commit', sha: 'd'.repeat(40) } } }, (w, e, n) => { refused(e, 'pre-draft', /different target/, n); });
  await scenario('S4d tag target differs from trigger', { git: { 'rev-parse refs/tags/v3.0.0^{commit}': 'd'.repeat(40) } }, (w, e, n) => { refused(e, 'pre-draft', /triggering commit/, n); });

  // 5. Tag not reachable from main.
  await scenario('S5 not an ancestor of main', { ancestorStatus: 1 }, (w, e, n) => { refused(e, 'pre-draft', /not in the history of main/, n); ok(mutations(w).length === 0, n + ': zero mutations'); });

  // 6. Incomplete ancestry evidence.
  await scenario('S6 shallow checkout', { git: { 'rev-parse --is-shallow-repository': 'true' } }, (w, e, n) => { refused(e, 'pre-draft', /shallow/, n); });
  await scenario('S6b stale origin/main', { apiMain: 'e'.repeat(40) }, (w, e, n) => { refused(e, 'pre-draft', /incomplete or stale/, n); });
  await scenario('S6c ancestry check errors', { ancestorStatus: 128 }, (w, e, n) => { refused(e, 'pre-draft', /cannot establish main ancestry/, n); });
  await scenario('S6d origin/main missing', { git: { 'rev-parse refs/remotes/origin/main^{commit}': null } }, (w, e, n) => { refused(e, 'pre-draft', /git rev-parse/, n); });

  // Workflow revision and trigger.
  for (const [name, env, re] of [
    ['S6e other workflow revision', { GITHUB_WORKFLOW_SHA: 'd'.repeat(40) }, /workflow file/],
    ['S6f workflow from a branch', { GITHUB_WORKFLOW_REF: REPOSITORY + '/' + WORKFLOW_FILE + '@refs/heads/main' }, /workflow revision/],
    ['S6g fork repository', { GITHUB_REPOSITORY: 'someone/TAM-OS-Next' }, /repository/],
    ['S6h manual dispatch', { GITHUB_EVENT_NAME: 'workflow_dispatch' }, /tag push/],
    ['S6i branch ref', { GITHUB_REF_TYPE: 'branch', GITHUB_REF: 'refs/heads/v3.0.0' }, /not a tag/],
    ['S6j tag differs from APP_VERSION', { GITHUB_REF_NAME: 'v3.0.1', GITHUB_REF: 'refs/tags/v3.0.1', GITHUB_WORKFLOW_REF: REPOSITORY + '/' + WORKFLOW_FILE + '@refs/tags/v3.0.1' }, /APP_VERSION/],
    ['S6k non-version tag', { GITHUB_REF_NAME: 'vNext', GITHUB_REF: 'refs/tags/vNext' }, /release version tag/],
    ['S6l other API host', { GITHUB_API_URL: 'https://ghe.example.test/api/v3' }, /API endpoint/],
  ]) {
    await scenario(name, { env }, (w, e, n) => { refused(e, 'pre-draft', re, n); ok(mutations(w).length === 0, n + ': zero mutations'); });
  }

  // 7. Missing manifest or asset.
  await scenario('S7 missing manifest', { files: { [MANIFEST_PATH]: null } }, (w, e, n) => { refused(e, 'pre-draft', /missing dist\/package-manifest/, n); ok(mutations(w).length === 0, n + ': zero mutations'); });
  await scenario('S7b missing package ZIP', { files: { 'dist/tam-os-v3.0.0-package.zip': null } }, (w, e, n) => { refused(e, 'pre-draft', /missing dist\/tam-os-v3\.0\.0-package\.zip/, n); });
  await scenario('S7c ZIP differs from manifest', { files: { 'dist/tam-os-v3.0.0-package.zip': Buffer.from('tampered') } }, (w, e, n) => { refused(e, 'pre-draft', /does not match the committed manifest/, n); });
  await scenario('S7d built manifest differs from committed', { committedManifest: Buffer.from('{}') }, (w, e, n) => { refused(e, 'pre-draft', /differs from the one committed/, n); });
  await scenario('S7e missing release notes', { files: { 'RELEASE_NOTES.md': null } }, (w, e, n) => { refused(e, 'pre-draft', /release notes/, n); });
  await scenario('S7f asset missing from draft after upload', { fail: { dropAsset: MANIFEST_ASSET } }, (w, e, n) => {
    refused(e, 'draft-left', /package-manifest\.json: missing/, n);
    ok(!w.calls.some((c) => c.method === 'PATCH'), n + ': not published');
    ok(w.releases.some((r) => r.id === 100 && r.draft === true), n + ': draft left in place');
  });

  await scenario('S7g unexpected extra asset on draft', { fail: { extraAsset: 'extra.txt' } }, (w, e, n) => {
    refused(e, 'draft-left', /expected 2 assets, found 3.*unexpected asset "extra\.txt"/, n);
    ok(!w.calls.some((c) => c.method === 'PATCH'), n + ': not published');
  });

  // 8. Digest mismatch, missing digest, size mismatch.
  for (const [name, fail, re] of [
    ['S8 digest mismatch', { digest: { 'tam-os-v3.0.0-package.zip': DIGEST_X } }, /digest sha256:f+ != /],
    ['S8b missing digest', { digest: { [MANIFEST_ASSET]: null } }, /no SHA-256 digest/],
    ['S8c malformed digest', { digest: { [MANIFEST_ASSET]: 'md5:abc' } }, /no SHA-256 digest/],
    ['S8d size mismatch', { size: { 'tam-os-v3.0.0-package.zip': 1 } }, /size 1 != /],
    ['S8e asset not fully uploaded', { state: { [MANIFEST_ASSET]: 'starter' } }, /package-manifest\.json: state "starter"/],
  ]) {
    await scenario(name, { fail }, (w, e, n) => {
      refused(e, 'draft-left', re, n);
      ok(!w.calls.some((c) => c.method === 'PATCH'), n + ': not published');
      ok(w.releases.find((r) => r.id === 100).draft === true, n + ': draft left unpublished');
    });
  }

  // 9. GitHub API failure and timeout.
  const LIST = 'GET ' + API_URL + '/repos/' + REPOSITORY + '/releases';
  const CREATE = 'POST ' + API_URL + '/repos/' + REPOSITORY + '/releases';
  await scenario('S9 release list answers 500', { fail: { status: { [LIST]: 500 } } }, (w, e, n) => { refused(e, 'pre-draft', /cannot determine the release state/, n); ok(mutations(w).length === 0, n + ': zero mutations'); });
  await scenario('S9b release list times out', { fail: { timeout: LIST } }, (w, e, n) => { refused(e, 'pre-draft', /timeout/, n); ok(mutations(w).length === 0, n + ': zero mutations'); });
  await scenario('S9c release list not a list', { fail: { listPages: () => ({ message: 'x' }) } }, (w, e, n) => { refused(e, 'pre-draft', /not a list/, n); });
  await scenario('S9d too many releases to be sure', { fail: { listPages: (p) => Array.from({ length: 100 }, (_, i) => ({ id: p * 1000 + i, tag_name: 'v0.' + p + '.' + i, draft: false })) } },
    (w, e, n) => { refused(e, 'pre-draft', /more than 2000 releases/, n); ok(mutations(w).length === 0, n + ': zero mutations'); });
  await scenario('S9e tag lookup answers 502', { fail: { status: { ['GET ' + API_URL + '/repos/' + REPOSITORY + '/git/ref/tags/v3.0.0']: 502 } } }, (w, e, n) => { refused(e, 'pre-draft', /cannot establish eligibility/, n); });
  await scenario('S9f draft creation times out', { fail: { timeout: CREATE } }, (w, e, n) => {
    refused(e, 'draft-uncertain', /timeout/, n);
    ok(mutations(w).length === 1, n + ': no further request after the failed creation');
  });
  await scenario('S9g draft creation answers 500', { fail: { status: { [CREATE]: 500 } } }, (w, e, n) => { refused(e, 'draft-uncertain', /answered 500/, n); ok(mutations(w).length === 1, n + ': no retry'); });
  await scenario('S9h creation returns a published release', { fail: { createAnswer: (r) => Object.assign({}, r, { draft: false }) } }, (w, e, n) => {
    refused(e, 'draft-uncertain', /unexpected release object/, n);
    ok(mutations(w).length === 1, n + ': nothing uploaded or published');
  });
  await scenario('S9i draft read-back fails', { fail: { status: { ['GET ' + API_URL + '/repos/' + REPOSITORY + '/releases/100']: 503 } } }, (w, e, n) => {
    refused(e, 'draft-left', /cannot read the draft back/, n);
    ok(!w.calls.some((c) => c.method === 'PATCH'), n + ': not published');
  });
  await scenario('S9j unexpected upload host', { fail: { uploadHost: 'https://uploads.example.test' } }, (w, e, n) => {
    refused(e, 'draft-left', /upload URL/, n);
    ok(!w.calls.some((c) => c.method === 'POST' && !c.url.endsWith('/releases')), n + ': nothing uploaded');
  });

  // 10. Duplicate invocation: a second run after success, and two runs racing.
  {
    const w = mockWorld({});
    const first = await run(w);
    ok(first === null, 'S10 duplicate: first run publishes');
    const before = mutations(w).length;
    const second = await run(w);
    refused(second, 'pre-draft', /already exists for v3\.0\.0 \(id 100 published\)/, 'S10 duplicate: second run');
    ok(mutations(w).length === before, 'S10 duplicate: second run makes zero mutations');
    const r100 = w.releases.find((r) => r.id === 100);
    ok(r100 && r100.draft === false && r100.assets.length === 2 && r100.assets.every((a) => a.state === 'uploaded'), 'S10 duplicate: published release and assets untouched');
    invariants(w, 'S10 duplicate');
  }
  await scenario('S10b concurrent draft appears', { fail: { raceDraft: true } }, (w, e, n) => {
    refused(e, 'draft-left', /more than one release/, n);
    ok(!w.calls.some((c) => c.method === 'PATCH' || c.url.startsWith(UPLOAD_ORIGIN)), n + ': nothing uploaded or published');
    ok(w.releases.some((r) => r.id === 999), n + ': the other draft is not touched');
  });

  // 11. Partial upload.
  await scenario('S11 second upload fails', { fail: { uploadFailAt: 2 } }, (w, e, n) => {
    refused(e, 'draft-left', /upload of package-manifest\.json failed.*no retry/, n);
    ok(w.calls.filter((c) => c.url.startsWith(UPLOAD_ORIGIN)).length === 2, n + ': exactly two upload attempts');
    ok(!w.calls.some((c) => c.method === 'PATCH'), n + ': not published');
    ok(w.releases.find((r) => r.id === 100).draft === true, n + ': draft left for Owner review');
  });
  await scenario('S11b first upload times out', { fail: { timeoutCall: (m, u) => m === 'POST' && u.startsWith(UPLOAD_ORIGIN) } }, (w, e, n) => {
    refused(e, 'draft-left', /timeout/, n);
    ok(w.calls.filter((c) => c.url.startsWith(UPLOAD_ORIGIN)).length === 1, n + ': no retry');
  });

  // 12. Publish failure.
  const PATCH100 = 'PATCH ' + API_URL + '/repos/' + REPOSITORY + '/releases/100';
  await scenario('S12 publish answers 500', { fail: { status: { [PATCH100]: 500 } } }, (w, e, n) => { refused(e, 'publish-uncertain', /answered 500/, n); ok(w.calls[w.calls.length - 1].method === 'PATCH', n + ': nothing after the failed publish'); });
  await scenario('S12b publish times out', { fail: { timeout: PATCH100 } }, (w, e, n) => { refused(e, 'publish-uncertain', /timeout/, n); ok(w.calls[w.calls.length - 1].method === 'PATCH', n + ': no retry'); });

  // Post-publication read-back: read-only, never a repair.
  await scenario('S13 asset changed after publish', { fail: { afterPublish: (r) => { r.assets[0].digest = DIGEST_X; } } }, (w, e, n) => {
    refused(e, 'post-publish', /published assets do not verify/, n);
    ok(w.calls.slice(w.calls.findIndex((c) => c.method === 'PATCH') + 1).every((c) => c.method === 'GET'), n + ': only reads after publish');
  });
  await scenario('S13b immutable state not reported', { fail: { noImmutableField: true } }, (w, e, n) => { refused(e, 'post-publish', /immutable state/, n); });
  await scenario('S14 immutable release verified', { immutable: true }, (w, e, n) => {
    ok(e === null, n + ': publishes (' + (e && e.message) + ')');
    ok(w.ghCalls.join('|') === 'release verify --help|release verify v3.0.0 --repo ' + REPOSITORY + '|release verify-asset v3.0.0 dist/tam-os-v3.0.0-package.zip --repo ' + REPOSITORY + '|release verify-asset v3.0.0 dist/package-manifest.json --repo ' + REPOSITORY,
      n + ': gh release verify and verify-asset for every asset');
  });
  await scenario('S14b immutable but gh lacks verify', { immutable: true, ghFail: (a) => a[2] === '--help' }, (w, e, n) => { refused(e, 'post-publish', /no "release verify"/, n); });
  await scenario('S14c immutable and attestation fails', { immutable: true, ghFail: (a) => a[1] === 'verify-asset' }, (w, e, n) => { refused(e, 'post-publish', /verify-asset failed/, n); });

  // Static guards on the workflow that drives this script.
  {
    const wf = fs.readFileSync(path.join(__dirname, '..', WORKFLOW_FILE), 'utf8');
    const code = wf.replace(/^\s*#.*$/gm, '');
    ok(!/--clobber|gh release (upload|delete|edit|create)|delete-asset|git push|git tag /.test(code), 'workflow: no clobber, no gh release upload/delete/edit/create, no tag or push');
    ok(/^permissions:\n  contents: read\n/m.test(wf), 'workflow: top-level permissions are contents: read');
    ok((code.match(/contents: write/g) || []).length === 1 && /\n  publish:\n[\s\S]*?\n    permissions:\n      contents: write\n/.test(code), 'workflow: contents: write only on the publish job');
    ok(/concurrency:\n  group: release-\$\{\{ github\.ref \}\}\n  cancel-in-progress: false\n/.test(wf), 'workflow: per-tag concurrency, never cancels an active run');
    ok(!/workflow_dispatch|pull_request|schedule:|workflow_run/.test(code), 'workflow: triggered only by a tag push');
    const uses = code.match(/uses:\s*\S+/g) || [];
    ok(uses.length > 0 && uses.every((u) => /@[0-9a-f]{40}$/.test(u)), 'workflow: every action is pinned to a full commit SHA');
    ok((code.match(/fetch-depth: 0/g) || []).length === 2 && (code.match(/persist-credentials: false/g) || []).length === 2, 'workflow: full history and no persisted credentials in both jobs');
    ok(/node tools\/release-publish\.js --selftest/.test(code) && /node tools\/release-publish\.js --eligibility/.test(code) && /node tools\/release-publish\.js --publish --title "TAM OS \$TAG"/.test(code), 'workflow: runs the selftest, the eligibility gate and the guarded publish');
    ok(/needs: verify/.test(code) && !/continue-on-error|\|\|\s*true|set \+e/.test(code), 'workflow: publish needs verify; no failure bypass');
  }

  console.log('release-publish selftest: ' + pass + ' passed, ' + fail + ' failed');
  return fail === 0 ? 0 : 1;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { report(e); process.exit(1); });
}

module.exports = { checkEligibility, publish, assetProblems, releasesForTag, realContext, STAGES, Refusal };
