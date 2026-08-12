# PROVENANCE — where this repository came from

`TAM-OS-Next` is a **clean-history migration** of the TAM Intelligence OS codebase. It is the same
application, carried over from a verified snapshot of the source repository, in a repository that
starts its Git history fresh.

This document exists so that the absence of Git history is never mistaken for the absence of
provenance.

## Source

| Field | Value |
|---|---|
| Source repository | [`fanoryu/TAM-OS`](https://github.com/fanoryu/TAM-OS) (private) |
| Source canonical branch | `main` |
| Source canonical commit | `efacd809a594b519e809d61933d6b715fad07093` |
| Source release at migration | **v2.10.0 — Governed Workspace** |
| Source schema version | `SCHEMA_VERSION` **6** |
| Source verifier baseline | `node tools/verify-build.js` — **2443 checks OK** |
| Source portable artifact | `dist/tam-os-v2.10.0.html` (1,151,267 bytes) |
| Clean-migration date | 2026-08-12 |

## Methodology

The initial commit of this repository is a **tracked-tree snapshot** of the source commit above,
produced with `git archive` so that only tracked files were carried over — no `.git` directory, no
ignored files, no untracked local artifacts, and no data from outside the repository.

Git history was **not** imported. This repository begins a fresh history under owner-only authorship
(see below). The classification applied to the snapshot — what was kept, archived, or excluded — was
prepared and reviewed before the first commit, and the build, verifier, full runtime-harness suite and
browser validation were all re-run against the migrated tree before it was committed.

## Deliberately excluded

- **The source repository's Git history.** 350 commits, retained in `fanoryu/TAM-OS`.
- **Historical release assets.** Every published build (v2.6.6 → v2.10.0) remains available as a
  GitHub Release asset in the source repository. Only the current artifact is tracked here.
- **Superseded PowerShell build/verify fallbacks** (`tools/build-single-file.ps1`,
  `tools/verify-build.ps1`). They still derived the retired `tam-intelligence-os-v<version>.html`
  artifact name while the Node tooling had moved to `tam-os-v<version>.html`, so they produced a
  wrongly-named artifact and could no longer verify a current build. Node is the supported toolchain.
- **`CODE_OF_CONDUCT.md`**, per owner ruling — an open-source-community convention that does not fit a
  private, proprietary, single-owner repository. The contributor contract lives in
  [`CONTRIBUTING.md`](CONTRIBUTING.md) and the licence terms in [`LICENSE`](LICENSE) /
  [`PROPRIETARY-LICENSE-NOTICE.md`](PROPRIETARY-LICENSE-NOTICE.md).
- **All ignored and untracked local artifacts** — legacy pre-v2.6 HTML builds, backup JSON exports,
  spreadsheet data, and local editor/tooling state. No company, employee, payroll, contract or backup
  data was carried over; the sample-data and secrets rules in [`.gitignore`](.gitignore) were preserved
  unchanged.

## Reorganized during migration

- Historical records moved to [`docs/99-archive/`](docs/99-archive/README.md) — dated audits,
  completed roadmap plans, and the RDR/DPR/ECR series. **Document bodies were preserved verbatim.**
- The repository/governance ADR register moved from `docs/adr/` to
  [`docs/03b-repository-adr/`](docs/03b-repository-adr/README.md), so that it is no longer
  distinguished from the domain register [`docs/03-adr/`](docs/03-adr/README.md) only by zero-padding.
  **ADR contents were not rewritten** — this was a location change; Accepted decisions remain
  immutable and are superseded, never edited.

## The source repository is retained

**`fanoryu/TAM-OS` remains a private archive.** It was not deleted, not archived, not made public, and
its history, tags and published releases were not modified in any way. It is the authoritative record
of everything that happened before commit `efacd809`.

## Reading historical references

Commit SHAs, PR numbers, issue numbers, branch names and tags that appear in
[`CHANGELOG.md`](CHANGELOG.md) and throughout [`docs/99-archive/`](docs/99-archive/README.md) refer to
**`fanoryu/TAM-OS`**. They do not resolve in this repository. This is expected: the narrative was
carried forward as documents, which is the durable form, while the commit graph stayed behind.

## Authorship

This repository uses **owner-only Git authorship**. Commits are authored by the repository owner; AI
agents that assist with implementation are never recorded as authors or co-authors, and AI-attribution
trailers are prohibited and mechanically rejected by
[`tools/check-commit-attribution.js`](tools/check-commit-attribution.js) (`CLAUDE.md` §15.7).

Removing accumulated AI co-authorship from the canonical repository was one of the reasons for the
clean-history migration. No commit trailers from the source repository were copied into this document
or anywhere else in this tree.
