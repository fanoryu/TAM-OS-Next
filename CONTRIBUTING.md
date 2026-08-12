# Contributing to TAM Intelligence OS

This is proprietary internal software for **PT Total Asset Manajemen** (see `PROPRIETARY-LICENSE-NOTICE.md`).
Contributions are limited to authorized collaborators. This guide is the contract for how changes
are made, verified, and released.

## Golden rules

1. **Never commit real company data** — no employee names, salaries, contracts, bank details, or
   Complete Backup JSON. **The repository contains no real company workbook or confidential
   operational dataset.** Development, examples, and testing must use fabricated or appropriately
   sanitized data. Never commit confidential company information.
2. **Never hand-edit `dist/`.** The portable HTML is generated. Edit the modular source, then build.
3. **Preserve data-safety invariants.** Do not change `SCHEMA_VERSION`, storage keys, migration
   flags, calculations, or the backup format unless the change is an intentional, documented
   migration.
4. **Build must stay verifiable.** Every change must pass `node tools/verify-build.js`.

## Baseline check (before you start)

Confirm a known-good starting point before editing:

```bash
git status                 # working tree clean
git branch --show-current  # main (or your feature branch)
git log -1 --oneline       # latest commit
git describe --tags --abbrev=0   # latest released tag
```

If the baseline is unexpected, stop and reconcile before making changes.

## Actions that require explicit approval

Do **not** do any of the following without the maintainer's explicit approval:

- `git commit`, `git push`, `git tag`, or creating/editing a GitHub Release;
- rewriting Git history (rebase, amend of pushed commits, force-push);
- removing or moving a tracked file;
- changing `APP_VERSION`, `APP_RELEASE_NAME`, `SCHEMA_VERSION`, storage keys, or migration flags
  outside an intentional, approved release/migration.

## Architecture (what you are editing)

- **Modular source** = `index.html` + `css/` (5 files) + `js/` (**72 browser-loaded** classic-script
  modules across `core/ ui/ finance/ people/ import/ analytics/ domain/ platform/ transport/
  repository/`), loaded as ordered `<script>` tags sharing one global scope. **No ES modules, no
  bundler.** A 73rd module, `js/cli/cli.js`, is a Node-only ingress and is deliberately **not**
  browser-loaded.
- **Load order is behavior-critical** and lives in exactly one place: `tools/module-order.js`.
  `index.html` mirrors it; the build/verify tools read it; `verify-build.js` asserts they match.
  If you add or move a module, update the manifest **and** `index.html` together.
- **Portable build** = one single-file application package `dist/tam-os-v<APP_VERSION>.html`,
  produced by inlining the CSS and JS. It is **single-file packaging, not a fully offline artifact** —
  the XLSX parser and web fonts are still loaded from CDNs (see
  [ADR-0002](docs/03b-repository-adr/ADR-0002-canonical-distribution-architecture.md)). The version is derived from `APP_VERSION` in
  `js/core/constants.js` via `tools/app-version.js` — never hand-typed into the tooling.
- See `ARCHITECTURE.md` for the full module map and history.

## Local development

**First thing after cloning — activate the attribution guard:**

```bash
node tools/install-hooks.js
```

`.git/hooks/` is not version-controlled, so a fresh clone has no commit-message enforcement until Git
is pointed at the tracked `.githooks/` directory. This command does that for **this repository only**
and never touches your global Git configuration. Skipping it does not let a violation through — CI's
`verify-attribution` job still rejects it — it just means you find out later. See
[`tools/README.md`](tools/README.md).

No framework and no `npm install` — the app has no runtime dependencies. Node is used **only** for
the build/verify tooling (v18+; tested on v24).

Serve the folder over HTTP and open the modular source:

```bash
python -m http.server 8000     # or: npx serve
# open http://localhost:8000
```

The portable build in `dist/` can also be opened directly in a browser.

## Build

```bash
node tools/build-single-file.js
```


## Verify

```bash
node tools/verify-build.js
```

Fails if CSS drifts, the dist payload ≠ concatenated source, the version identity is inconsistent,
`SCHEMA_VERSION` ≠ 6, a storage key or migration flag disappears, the seed data is non-empty, ES
module syntax appears, the search-focus fix regresses, the module decomposition is inconsistent, or
the audit/timeline/blocker features regress.

## Branch naming

- `feature/<name>` — new capability
- `fix/<name>` — bug fix
- `chore/<name>` — tooling, docs, infra
- `release/<version>` — release preparation

## Commit naming

- Descriptive, imperative subject lines (e.g. `fix: preserve smart-import scroll on selection`).
- Release commits use: `Release vX.Y.Z - <Release Name>`.

## QA requirements (before opening a PR)

Exercise your change in **both** the modular source and the portable dist:

- Zero browser console errors.
- Verify the affected pages/workflows behave correctly.
- Confirm search keeps focus, scroll is preserved, and floating menus open/close.
- Confirm no duplicate records are produced and data persists across reload.

See `docs/QA-CHECKLIST.md` for the full checklist.

## Regression checklist

Re-test the features most likely to be affected by any change to shared code:

- Employee Import (Smart Import) and Employee Deduplication
- Payroll Generation, Posting, and duplicate prevention
- Overtime Approval → payroll inclusion
- Execution Center (execute / schedule / cancel)
- Transactions, Backup, Restore
- Activity Log, Company Settings persistence

Any regression in a previously-working feature is a **release blocker**.

## Source → build → verify → dist workflow

1. Edit the **modular source** (never `dist/`).
2. `node tools/build-single-file.js` to regenerate the portable HTML.
3. `node tools/verify-build.js` (must pass).
4. Boot both the modular source and the dist; confirm zero console errors.
5. Update `CHANGELOG.md` (and `RELEASE_NOTES.md` for a release) and any affected docs.
6. Commit the source **and** the rebuilt `dist/` together.

## Release-candidate process

Releases are proposed as a **Release Candidate**, not published directly. Before any release action:

1. Bump `APP_VERSION` + `APP_RELEASE_NAME` in `js/core/constants.js`; add a `RELEASE_NOTES.md` entry
   and a `CHANGELOG.md` entry.
2. `node tools/build-single-file.js` then `node tools/verify-build.js` (must pass).
3. Boot the modular source **and** the portable dist — zero console errors.
4. Present the RC (root cause, files changed, validation, regression, known limitations, build/verify
   output, working-tree status) and **wait for explicit approval**.
5. Only after approval: commit source + rebuilt dist → annotate `vX.Y.Z` → push `main` then the tag →
   let the tag-triggered Release workflow publish. See [`docs/RELEASE-PROCESS.md`](docs/RELEASE-PROCESS.md).

## Version-consistency audit

The version lives **once**, in `APP_VERSION`. After a version bump, confirm every human-facing
reference agrees and that historical references stay intact:

- Runtime/derived: `<title>` in `index.html`, `APP_RELEASE_NAME`, the About/embedded Release Notes
  entry, the `dist/` filename (all checked by the verifier).
- Docs: `README.md` (version badge, "Current release", portable filename), `ARCHITECTURE.md`
  ("Current release" header + section index), `CHANGELOG.md`/`RELEASE_NOTES.md`, and issue-template
  version examples.
- Leave **historical** references (past CHANGELOG entries, prior release sections, lineage lists)
  unchanged — only update pointers that should track the latest release.

## Documentation

Update `README.md` and/or `ARCHITECTURE.md` whenever you change behavior, structure, or the build.
Keep the version references consistent — the version lives once, in `APP_VERSION`.

## Secrets & data

No secrets, tokens, `.env` files, credentials, or real company data in commits, issues, PRs, logs,
or screenshots. See `SECURITY.md` for reporting and rotation guidance.
