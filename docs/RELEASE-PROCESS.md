# Release Process — TAM Intelligence OS

The version lives once, in `const APP_VERSION` (and `APP_RELEASE_NAME`) in
`js/core/constants.js`. Everything else — dist filename, verifier checks, CI, and the release
workflow — derives from it. To cut a release you change those two constants, add release notes, and
follow the steps below.

> **`main` is protected by repository rules.** Every change to `main` — including release preparation
> — lands through a **pull request** whose required checks pass; a direct push to `main` is rejected.
> The permitted merge method is a **merge commit**. **Release tags are outside the branch ruleset.** While the
> separate tag ruleset is active, a pushed `v*` tag cannot be deleted, moved or force-updated, by anyone; it
> does not restrict creating one, so tagging and the tag-triggered release workflow are otherwise unaffected.
> Published tags stay immutable under [`CLAUDE.md`](../CLAUDE.md) §13.4 regardless of that technical protection.
>
> **Merge authorization and release authorization are separate events.** Approval to merge a release
> preparation PR is *not* approval to tag or publish. Temporarily disabling the ruleset, or using a
> bypass, is **not** part of this process.

## 1. Implementation
- Work on a **dedicated branch** (`release/<version>`); never commit release preparation onto `main`.
- Edit the **modular source** only (never `dist/`). Preserve data-safety invariants
  (`SCHEMA_VERSION`, storage keys, migration flags, backup format) unless intentionally migrating.
- Bump `APP_VERSION` and `APP_RELEASE_NAME` in `js/core/constants.js`.
- Update `index.html` `<title>`, the in-app Release Notes entry, `README.md`, `ARCHITECTURE.md`,
  `CHANGELOG.md`, and `RELEASE_NOTES.md`.

## 2. Build
```bash
node tools/build-package.js
```
Produces the deployment package `dist/package/`, `dist/tam-os-v<APP_VERSION>-package.zip` and the
committed record `dist/package-manifest.json` (Distribution-1). Single-file releases already in
`dist/` are frozen history and are never rebuilt or removed.

## 3. Verify
```bash
node tools/verify-build.js
```
Must pass all checks. (PowerShell fallback available for machines without Node.)

## 4. QA
Run `docs/QA-CHECKLIST.md` against the package served by `node tools/serve-package.js`. Zero console
errors, zero CSP violations.

## 5. Regression
Re-test previously-working features (payroll, overtime, execution, import, dedup, backup/restore,
activity log, settings). Any regression is a **release blocker**.

For a SESSION release (v3.0.0 onward) the regression also covers the real-backend suites (a disposable loopback PHP +
MariaDB stack with fabricated data, as in WP-E2E-2) and the backend suite `server/tests/run.php --require-db`; local
evidence is never presented as host evidence.

## 6. Release candidate
Prepare an RC summary that distinguishes **browser-tested / automated-test verified /
source-inspected / unable to verify**, reports any secret-scan findings (paths + categories only,
never values), and lists known limitations and branch-protection recommendations.

## 7. Merge authorization
Do **not** commit, push, merge, tag, or publish before the owner's explicit approval. This step
authorizes the **merge only** — it does not authorize tagging or publishing (see §11).

## 8. Commit on the release branch
```
Release vX.Y.Z - <Release Name>
```
Commit the source **and** the regenerated `dist/package-manifest.json` together on the release
branch. Confirm the working tree is clean.

## 9. Pull request into `main`
Push the **feature branch only** — never `main`:
```bash
git push -u origin release/vX.Y.Z
gh pr create --base main --title "Release vX.Y.Z - <Release Name>"
```
Then:
- Let the three required checks run and pass: **`build-and-verify`**,
  **`Analyze (javascript-typescript)`**, **`Analyze (actions)`**. Merge stays blocked until all three
  succeed.
- Resolve any open review conversation (required by the ruleset).
- No approving GitHub review is required (zero required approvals), but the repository's procedural
  Atlas and Norman authorization still applies.

## 10. Merge and post-merge verification
Merge with a **merge commit** (squash and rebase are rejected by the ruleset), then delete the
release branch. On updated `main`, confirm:
- the merge commit is present and the working tree is clean;
- `node tools/verify-build.js` passes;
- rebuilding the package leaves `dist/package-manifest.json` unchanged (same package digest and ZIP
  SHA-256 as reviewed);
- `APP_VERSION`, `APP_RELEASE_NAME`, and `SCHEMA_VERSION` are as intended.

**Record the merged `main` commit** — that commit, and only that commit, is the tag target.

## 11. Release authorization
Obtain **separate** explicit approval to release. A merged release preparation PR is not itself a
release. Nothing below runs until this approval is given.

## 12. Tag
Create the annotated tag on the **authorized merged `main` commit**:
```bash
git tag -a vX.Y.Z <merged-main-commit> -m "TAM Intelligence OS vX.Y.Z"
git cat-file -t vX.Y.Z            # must print: tag  (annotated, not lightweight)
git rev-parse vX.Y.Z^{commit}     # must equal the authorized merged main commit
```

## 13. Push the tag
Push **only** the tag. `main` is already up to date via the merge in §10, and a direct push to
`main` is rejected by repository rules.
```bash
git push origin refs/tags/vX.Y.Z
```

## 14. GitHub Release
Pushing the `vX.Y.Z` tag triggers `.github/workflows/release.yml`, which verifies, rebuilds the
package, confirms the build reproduces the committed manifest and the tag equals `v<APP_VERSION>`,
and publishes the release with the package ZIP and `package-manifest.json` as assets.
If publishing manually instead:
```bash
gh release create vX.Y.Z dist/tam-os-vX.Y.Z-package.zip dist/package-manifest.json \
  --title "TAM OS vX.Y.Z" --notes-file RELEASE_NOTES.md --verify-tag
```

## 15. Asset verification
```bash
gh release view vX.Y.Z
```
Confirm the release exists and the assets `tam-os-vX.Y.Z-package.zip` and `package-manifest.json`
are attached, and that the ZIP's SHA-256 equals the manifest's `zip.sha256`. Record the commit hash,
tag, release URL, asset names, CI status, branch, and working-tree status.

## Rollback
- **Problem found before the tag is pushed (§13):** stop and do not push the tag. Correct the candidate
  through a pull request (§§7–10) and obtain a fresh release authorization (§11). A tag created in §12 but not
  pushed exists only locally; removing it (`git tag -d vX.Y.Z`) is a `git tag` action and needs the owner's
  approval ([`CLAUDE.md`](../CLAUDE.md) §20).
- **Problem found after the tag is pushed or the release is published:** while the tag ruleset is active, a pushed
  `v*` tag cannot be deleted or updated, even if `release.yml` refused to publish; under [`CLAUDE.md`](../CLAUDE.md)
  §13.4 it stays immutable regardless of that technical protection. Keep the tag, its commit, the GitHub Release
  and its assets as the historical record — never delete, move or re-push the tag. Record the problem and its
  impact, then fix it in a **new corrective version** through this process from §1, with separate owner
  authorization to merge (§7) and to release (§11) before any new tag, release or asset is published. The
  corrective version's release notes state the problem and the fix.
- **What the tag ruleset does not cover:** it protects Git tags only. A GitHub Release and its uploaded assets can
  still be edited or deleted by anyone with write access, and `release.yml` replaces existing assets
  (`--clobber`) if it runs again for a published version. Under §13.4 they are treated as immutable regardless:
  do not edit or delete a published release or its assets, or re-run the release workflow for a published
  version.
- **Exceptions:** any exception (for example, withdrawing an asset that exposes a secret or real data — see
  [`SECURITY.md`](../SECURITY.md)) needs a separate, narrowly scoped owner approval that names the exact object
  and action, with the evidence recorded. Disabling a ruleset is not a rollback step; it is itself a separately
  authorized change. Nothing here changes ENG-C1, the v3.0.0 HOLD or any release or deployment gate.
- **Bad code already on main:** revert the release commit (`git revert <hash>`) on a branch and land
  the revert through a pull request — `main` accepts no direct push — then rebuild, verify, and cut a
  new patch version. Never force-push or rewrite `main`; the ruleset rejects both.
- **Restoring user data:** users restore from their most recent Complete Backup (Settings → Data
  Portability). A pre-restore safety backup is always created automatically.
- **SESSION releases (v3.0.0 onward):** a deployment is rolled back and recovered by
  [`BACKEND-DEPLOYMENT-RUNBOOK.md`](BACKEND-DEPLOYMENT-RUNBOOK.md) §8 (close the API, re-upload the previous verified
  package and backend, recreate a staging database, or restore an encrypted backup off-host under the §7.1
  safeguards). Complete Backup belongs to the LOCAL application and does not apply to SESSION data.
- **Publication flags (v3.0.0):** `release.yml` creates the Release with `gh release create` and no
  `--latest`/`--prerelease` flag, so GitHub marks it **Latest** by default; whether v3.0.0 may become Latest is an
  Owner decision taken before the tag is pushed.
