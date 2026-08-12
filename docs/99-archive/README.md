# `docs/99-archive/` — Provenance Records

**These documents are historical provenance, not current operational guidance.**

Everything in this folder was written in the source repository **`fanoryu/TAM-OS`** and carried into
`TAM-OS-Next` **verbatim**, as evidence of how the system reached its current state. Nothing here is
a status page, a specification of present behaviour, or authorization to implement anything.

For current state, read [`AI_CONTEXT.md`](../../AI_CONTEXT.md); for present architecture, read
[`ARCHITECTURE.md`](../../ARCHITECTURE.md); for what is authorized next, read the
[roadmap](../01-roadmap/README.md). Where an archived document and a current document disagree, the
**current document wins** — the archived one is a record of what was true when it was written.

See [`PROVENANCE.md`](../../PROVENANCE.md) for the migration record.

## How to read these documents

- **Old PR numbers, issue numbers, commit SHAs, branch names and tags belong to `fanoryu/TAM-OS`.**
  They do **not** resolve in this repository. `TAM-OS-Next` began with fresh Git history, so a
  reference like "merge `c15a7ad`" or "PR #134" can only be looked up in the source repository, which
  is retained privately with its full history and published releases intact.
- **Past and future tense are preserved as written.** A plan that says "UX-006D3 is next" was correct
  on its date. It was deliberately not rewritten into the past tense, because editing a historical
  record to match a later present destroys its value as evidence.
- **Implementation-candidate and "not yet authorized" wording is preserved** for the same reason, even
  where the work has since shipped.
- **Relative links inside these documents may not resolve.** They were written against the source
  repository's directory layout, before this archive existed. The document bodies were preserved
  verbatim rather than rewritten, so their internal cross-references were deliberately left untouched.
  Use the folder listings below to navigate instead.

## Contents

| Folder | Holds |
|---|---|
| [`audit/`](audit/) | Dated, immutable point-in-time records — repository audits (`GHA-NNN`), the 2026-07-31 sanitization record and its `git filter-repo` metadata, and the UX-002B CSS golden-master revision |
| [`roadmap-completed/`](roadmap-completed/) | Completed roadmap discovery documents, implementation plans, decision memos and audits — the UX-004 / UX-005 / UX-006 lines, the Readiness-1…3 programme, MAINT-001, the multi-user requirement note, and the 2026-08-11 repository freshness audit |
| [`RDR/`](RDR/README.md) | Repository Decision Records (`RDR-NNN`) — factual repository-state snapshots at milestone boundaries |
| [`DPR/`](DPR/README.md) | Delivery Progress Reports (`DPR-NNN`) |
| [`ECR/`](ECR/README.md) | Milestone Closure Records (`ECR-NNN`) |

## Why these were archived rather than deleted

They record *why* the architecture is shaped the way it is — the authorization model, the read-scope
closure, the distribution ruling, the CSS golden-master revision. Deleting them would leave the
current code unexplained. Keeping them in the active documentation tree would have made a reader
mistake a completed plan for a live one. The archive is the boundary between the two.

Archived records are **never rewritten**. If an archived record needs correction, the correction is a
new document in the active tree that supersedes it — the same supersession rule that governs ADRs
(`CLAUDE.md` §16, §18).
