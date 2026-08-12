# PR Standard — Pull Requests

A pull request is the concrete change that implements a [Sprint Assignment](SPR_Standard.md). It
expresses one purpose, lands as one feature commit, and stays within its authorized scope.

## Structure

- **Branch naming.** `feature/<name>` for features, `fix/<name>`, `chore/<name>`, `docs/<name>`,
  `release/<version>`. Example: `feature/pr-5e-custodian`, `docs/project-governance`.
- **Exactly one feature commit.** The commit subject follows the form named by the SPR, e.g.
  `feat(domain): second aggregate boundary — EmployeeEmploymentAggregate (PR-5E)`.
- **Source and generated output together.** When the portable build is regenerated, `dist/` is
  committed with the source that produced it (documentation-only PRs touch neither).
- **Draft first.** Open as a draft; do not mark ready for review until every pre-review gate passes.

## Scope discipline

- The diff stays within the files the SPR named. No drive-by cleanup, no speculative abstraction, no
  unrelated refactor riding along (Law IX).
- Pre-existing, unrelated untracked files are left untouched and out of the commit.

## Pre-review gates

A PR may leave draft only when **all** of the following hold:

- [ ] Exactly one feature commit; diff within approved scope.
- [ ] Verifier passes completely.
- [ ] Runtime verification passes (fabricated data only).
- [ ] Generated `dist` matches source (byte-reproducible), or the PR is documentation-only.
- [ ] Modular source **and** portable build boot with zero console errors (for code changes).
- [ ] CI succeeds; CodeQL succeeds; no new CodeQL alerts.
- [ ] `APP_VERSION` and `SCHEMA_VERSION` unchanged (unless the SPR authorizes a change).
- [ ] Storage keys unchanged; golden master untouched.
- [ ] Release workflow not triggered.
- [ ] Affected documentation updated; indexes and cross-references current.

## The return report

Each PR closes with a structured summary in the shape the SPR requested — implementation summary,
changed files, contract, verification results, CI/CodeQL results, invariant checks, scope check, and
the draft PR link — so the reasoning is captured in the record (Law X).

## Human authority

`git commit`, `git push`, marking ready, and opening the PR are prepared by the implementer;
`CLAUDE.md` §20 governs which actions require explicit approval. The PR is never self-merged.
