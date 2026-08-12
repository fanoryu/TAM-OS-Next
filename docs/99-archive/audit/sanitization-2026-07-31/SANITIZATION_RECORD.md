# Git History Sanitization Record

Immutable audit record of the history rewrite that removed a confidential company workbook from the
TAM Intelligence OS repository. This document and the artifacts alongside it are the authoritative
account of what was changed, when, and how it was verified.

## Repository
- **Repository:** `fanoryu/TAM-Intelligence-OS` (private GitHub repository)
- **Default branch:** `main`
- **Visibility at time of rewrite:** PRIVATE (unchanged by this work)
- **LICENSE:** unchanged (proprietary; blob `8986487e9c649f893bcef68d66e6b88a7f82db0c`)

## Rewrite event
- **Date:** 2026-07-31
- **Reason:** purge the confidential workbook `Rencana Penggunaan Dana Juli 2026.xlsx` from all
  branches and tags to prepare a public-core / private-company-data separation.
- **Sensitive blob removed:** `fb7f8c664f2dcc9a4d631b85fc263755a59d6fc8` (330,742 bytes)
- **First commit that introduced it:** `d6fcd77312718257e7641b186210d9d9531e99dc` (initial commit),
  rewritten to `c7d4bad6259fbfb9f0c25ae523eae9cfa4f3edcf`
- **Scope:** exactly one path removed; all application source, tooling, `dist/`, and CSS are
  byte-identical before/after. Post-rewrite the public-readiness checkpoint commit `57bb4ba` added
  docs (`docs/DEPLOYMENT.md`), `.gitignore` hardening, and README/SECURITY/AI_CONTEXT wording fixes.

## Tooling
- **git:** 2.55.0.windows.3
- **git-filter-repo:** 2.47.0 (module build `a40bce548d2c`), invoked as `python -m git_filter_repo`
- **Command:** `git filter-repo --path "Rencana Penggunaan Dana Juli 2026.xlsx" --invert-paths --force`

## Recovery assets (preserved externally — NOT stored in the public repo)
> These contain the confidential workbook (the full bundle records complete pre-rewrite history), so
> they are intentionally kept **outside** the public repository. Only their location and checksum are
> recorded here.

| Asset | Location | Bytes | SHA-256 |
|---|---|---|---|
| Pre-rewrite full git bundle | `../tam-private-backup/20260731-174217/tam-repo-full-prerewrite.bundle` | 951,887 | `a97de5dfb4c8108f363491ba3858c10ed6ca151d6ba49f014e85f7380331e7a6` |
| Workbook backup | `../tam-private-backup/20260731-174217/Rencana Penggunaan Dana Juli 2026.xlsx` | 330,742 | `62785e7e4d11c983c7bf243b35ec80923fc306b5355421f387ac7024485b3033` |
| Private-layer template | `../tam-company-private-template/` (holds a copy of the workbook in `workbooks/`) | — | — |

Bundle integrity: `git bundle verify` → *"The bundle records a complete history."*

## Rewritten refs — old → new
### Branch
| Ref | Old (pre-rewrite) | New (rewritten equivalent) | Pushed tip |
|---|---|---|---|
| `refs/heads/main` | `c599a48ce8788a1bb086ca56b9ab8b8d21b23e00` | `17417ff5d34b8bf644407dea8dd06392170d2b31` | `57bb4baabf66cfb327f90a51097f0ee0aa503918` (checkpoint on top) |

### Tags (annotated) — old→new tag object, and peeled commit
| Tag | Old tag-obj → New tag-obj | Old commit → New commit |
|---|---|---|
| v2.6.6 | `703e532` → `0fe5e06` | `fed7db8` → `99a9d3f` |
| v2.6.7 | `74ea426` → `c2ef6ff` | `97b1eec` → `31406b8` |
| v2.6.8 | `1ae7f4c` → `685f61c` | `c36925d` → `6873a91` |
| v2.6.9 | `3019823` → `6dbc746` | `889c2ac` → `47affc3` |
| v2.7.0 | `00c6eb5` → `d4bb843` | `9d8f8be` → `288251e` |
| v2.7.1 | `472a0ad` → `b31f32c` | `488145f` → `dc86e1d` |
| v2.7.2 | `431037a` → `ca6b6ba` | `63b4467` → `1806e2a` |
| v2.7.3 | `d069925` → `def4494` | `97b8e89` → `a9f37d8` |

Full-length mappings are in `filter-repo-metadata/commit-map.txt` and `ref-map.txt`.

## Remote push (2026-07-31)
- `main`: `git push --force-with-lease=refs/heads/main:c599a48…` → `+ c599a48…57bb4ba (forced update)`; lease honored.
- Tags: explicit refspec force-push of the 8 tags above.
- **CI on sanitized `main` (`57bb4ba`): success — run `30626156789`.**
- Tag force-push triggered **no** Release runs → no duplicate releases, no version-guard failures.
- All 8 GitHub Releases intact, non-draft, assets/byte-sizes unchanged, no duplicates. (`v2.6.6` had 0
  assets before and after — pre-existing, predates the tracked-dist policy.)

## GitHub Support ticket
### Summary (request to be submitted by the owner)
- **Repository:** fanoryu/TAM-Intelligence-OS (private)
- **Ask:** dereference/expire cached refs at the old commits; invalidate cached blob/commit views; run
  repository garbage collection; purge sensitive object from storage so it is no longer retrievable by SHA.
- **Sensitive blob:** `fb7f8c664f2dcc9a4d631b85fc263755a59d6fc8` (330,742 bytes), path
  `Rencana Penggunaan Dana Juli 2026.xlsx`, introduced at `d6fcd773…`.
- **State:** `main` + tags v2.6.6–v2.7.3 point only to sanitized history; 0 open PRs; 0 `refs/pull/*`;
  0 forks; Git LFS not used.
- **Retention evidence at push time:** old commit `c599a48` and blob `fb7f8c66` were still retrievable
  from GitHub storage by SHA (expected until GitHub GC) — the reason this ticket is required.

### Response
- **Status: Completed.**

**GitHub Support Response:**

> "No problem! I've cleared out unreferenced commits, and that link should now return a 404 error."

**Outcome:**
- GitHub Support confirmed server-side cleanup of unreferenced commits.
- Cached references associated with the removed history have been cleared.
- The previous object link now returns HTTP 404.
- Sensitive-data removal process completed.

## Final verification checklist
- [x] Pre-rewrite bundle exists, verifies "complete history", SHA-256 recorded
- [x] Workbook backup exists, SHA-256 matches original source (`62785e7e…`)
- [x] `git-filter-repo` metadata preserved (commit-map, ref-map, changed-refs, first-changed-commits, suboptimal-issues, already_ran)
- [x] Workbook absent from local HEAD and all reachable local objects; blob `fb7f8c66` unreachable locally
- [x] `git fsck --full --strict` clean (0 errors, 0 dangling, 0 garbage)
- [x] All 8 tags present, annotated, peel to rewritten commits (== commit-map)
- [x] Only delta vs original: workbook removed, `docs/DEPLOYMENT.md` added, `.gitignore`+README+SECURITY+AI_CONTEXT wording; app/tooling/dist byte-identical
- [x] Build OK; verifier **188/188**; browser smoke zero console errors
- [x] Remote `main` == `57bb4ba`; all 8 remote tags peel to expected NEW commits
- [x] Workbook absent from remote `main` tree (API root + recursive)
- [x] Repository remains **PRIVATE**; default branch `main`; LICENSE blob unchanged
- [x] All 8 Releases exist with expected assets; no duplicates
- [x] GitHub Support purge of retained old objects — **completed** (Support confirmed unreferenced
      commits cleared; old object link now returns HTTP 404)

**Sanitization complete.** Every verification item above is satisfied.

> Deferred owner decisions (intentionally **not** part of this sanitization and tracked separately):
> author-email scrub of commit metadata, repository visibility change, and the licensing choice. These
> remain the owner's to make and are out of scope for this record.

---
*Generated 2026-07-31 as part of the post-sanitization audit & archive. Do not edit historical facts;
append updates below. Updated 2026-07-31: GitHub Support cleanup completed (object link now 404).*
