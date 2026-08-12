# Release Process — TAM Intelligence OS

The version lives once, in `const APP_VERSION` (and `APP_RELEASE_NAME`) in
`js/core/constants.js`. Everything else — dist filename, verifier checks, CI, and the release
workflow — derives from it. To cut a release you change those two constants, add release notes, and
follow the steps below.

> **`main` is protected by repository rules.** Every change to `main` — including release preparation
> — lands through a **pull request** whose required checks pass; a direct push to `main` is rejected.
> The permitted merge method is a **merge commit**. **Release tags are outside the branch ruleset**, so
> tagging and the tag-triggered release workflow are unaffected.
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
node tools/build-single-file.js
```
Produces `dist/tam-os-v<APP_VERSION>.html`. Remove the superseded dist from the prior
version (`git rm`).

## 3. Verify
```bash
node tools/verify-build.js
```
Must pass all checks. (PowerShell fallback available for machines without Node.)

## 4. QA
Run `docs/QA-CHECKLIST.md` against the modular source **and** the portable dist. Zero console errors.

## 5. Regression
Re-test previously-working features (payroll, overtime, execution, import, dedup, backup/restore,
activity log, settings). Any regression is a **release blocker**.

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
Commit the source **and** the rebuilt `dist/` together on the release branch. Confirm the working
tree is clean.

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
- the portable build's size and SHA-256 are unchanged from the reviewed artifact;
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
Pushing the `vX.Y.Z` tag triggers `.github/workflows/release.yml`, which rebuilds, verifies,
confirms the tag equals `v<APP_VERSION>`, and publishes the release with the portable HTML asset.
If publishing manually instead:
```bash
gh release create vX.Y.Z dist/tam-os-vX.Y.Z.html \
  --title "TAM OS vX.Y.Z" --notes-file RELEASE_NOTES.md --verify-tag
```

## 15. Asset verification
```bash
gh release view vX.Y.Z
```
Confirm the release exists and the asset `tam-os-vX.Y.Z.html` is attached. Record the
commit hash, tag, release URL, asset name, CI status, branch, and working-tree status.

## Rollback
- **Bad release, tag not yet relied upon:** delete the GitHub Release and tag
  (`gh release delete vX.Y.Z`, `git push origin :refs/tags/vX.Y.Z`), fix, re-release.
- **Bad code already on main:** revert the release commit (`git revert <hash>`) on a branch and land
  the revert through a pull request — `main` accepts no direct push — then rebuild, verify, and cut a
  new patch version. Never force-push or rewrite `main`; the ruleset rejects both.
- **Restoring user data:** users restore from their most recent Complete Backup (Settings → Data
  Portability). A pre-restore safety backup is always created automatically.
