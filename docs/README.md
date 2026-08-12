# `docs/` — Documentation Index

Supporting documentation for TAM Intelligence OS. Each document owns one responsibility and
cross-references rather than repeats (`CLAUDE.md` §16, §18). This folder index, the root
[`README.md`](../README.md) documentation table, and [`SECURITY.md`](../SECURITY.md) are the three
navigation hubs — each links, none duplicates.

The governance model for this folder is recorded in
[ADR-0001](03b-repository-adr/ADR-0001-documentation-governance-model.md).

## Engineering governance library

The numbered `NN-<area>/` folders are the project's engineering governance library, initialized by
DOC-001. Each folder owns one area and carries its own README.

| Section | Read it for |
|---|---|
| [`00-governance/`](00-governance/README.md) | Engineering Constitution, Core Values, Principles, and the Governance Pyramid |
| [`01-roadmap/`](01-roadmap/README.md) | The Domain roadmap and the milestone track (forward-looking) |
| [`02-architecture/`](02-architecture/README.md) | The Domain layer as implemented today: architecture, aggregate pattern, command/query model, AI positioning, and the [Architecture Evolution Backlog](02-architecture/Architecture_Evolution_Backlog.md) (non-blocking `ARCH-NNN` items) |
| [`03-adr/`](03-adr/README.md) | Domain Architecture Decision Records (`ADR-001`…, three-digit) — Accepted and Proposed |
| [`04-standards/`](04-standards/README.md) | SPR, PR, Review, Merge, Coding, Testing, and Release standards |
| [`05-milestones/`](05-milestones/README.md) | Milestones Alpha → Omega and their status |
| [`06-releases/`](06-releases/README.md) | Release strategy, flow, checklist, and hotfix flow — plus the v2.10.0 controlled-pilot package (operator guide, rollback plan, pilot readiness checklist) |
| [`99-archive/`](99-archive/README.md) | **Provenance records, not current operational guidance** — dated audits, completed roadmap plans, and the RDR/DPR/ECR series carried over from the source repository |

The AI-facing entry point that requires this reading before implementation is
[`AGENTS.md`](../AGENTS.md); the enforceable rule set is [`CLAUDE.md`](../CLAUDE.md).

## Process & reference

| Document | Read it for |
|---|---|
| [`QA-CHECKLIST.md`](QA-CHECKLIST.md) | The living QA checklist run before a change is done |
| [`RELEASE-PROCESS.md`](RELEASE-PROCESS.md) | The step-by-step release procedure |
| [`DATA-SAFETY.md`](DATA-SAFETY.md) | Data-safety guidance for storage, migrations, and backups |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | How the portable build is deployed and the public/private layering |

## Decision records

| Area | Index | Holds |
|---|---|---|
| Repository & documentation governance | [`03b-repository-adr/`](03b-repository-adr/README.md) | Architecture Decision Records (`ADR-NNNN`, four-digit) |
| Domain architecture | [`03-adr/`](03-adr/README.md) | Domain Architecture Decision Records (`ADR-001`…, three-digit) |
| Security | [`security/`](security/README.md) | Security Decision Records (`SDR-NNNN`) |
| Repository snapshots | [`99-archive/RDR/`](99-archive/RDR/README.md) | Repository Decision Records (`RDR-NNN`) — factual state snapshots at milestone boundaries. **Current baseline: [RDR-011](99-archive/RDR/RDR-011-epsilon-repository-snapshot.md)** (aggregate-backed Repository adoption complete, 7 of 7, `6714beb`); RDR-001 (Gamma), RDR-003 (Gateway boundary) and RDR-007 (Milestone Delta) are superseded as baseline |
| Delivery progress reports | [`99-archive/DPR/`](99-archive/DPR/README.md) | Delivery Progress Reports (`DPR-NNN`). **Current report: [DPR-009](99-archive/DPR/DPR-009-epsilon-repository-adoption-completion.md)** (Epsilon Repository adoption complete); Milestone Delta completion remains [DPR-005](99-archive/DPR/DPR-005-delta-completion-report.md) |
| Milestone closure records | [`99-archive/ECR/`](99-archive/ECR/README.md) | Milestone Closure Records (`ECR-NNN`) — the final historical record of a closed milestone. **Milestone Epsilon: [ECR-001](99-archive/ECR/ECR-001-milestone-epsilon-closure-record.md)** (Repository Adoption, closed at `0ad8150`) |
| Governance artifact index | [`00-governance/Atlas_Governance_Register.md`](00-governance/Atlas_Governance_Register.md) | Discovery index of Atlas governance artifacts (published + pending source text) — points to homes, defines no new record type |
| Point-in-time audits | [`99-archive/audit/`](99-archive/README.md) | Dated immutable audit/incident records, incl. [GHA-001](99-archive/audit/github-audit-2026-08-02/GHA-001-github-repository-comprehensive-audit.md) (2026-08-02 repository audit) |

The two ADR series are distinct: `03b-repository-adr/` (`ADR-NNNN`) records repository- and documentation-governance
decisions; `03-adr/` (`ADR-001`…) records Domain-layer architecture decisions. They never share a
number or overlap in scope. Domain ADRs may be **Accepted** (authoritative) or **Proposed**
(ADR-008 through ADR-012 — open questions from the PR-5G, PR-5H, and PR-5I reviews that record no
decision and authorize no implementation); the paired non-blocking backlog items live in the
[Architecture Evolution Backlog](02-architecture/Architecture_Evolution_Backlog.md). The Repository layer
is recorded in [ADR-013](03-adr/ADR-013-Repository-Layer.md) (Accepted), and Contract field ownership in
[ADR-014](03-adr/ADR-014-Contract-Core-Field-Authority.md) (Accepted — resolves ARCH-008 OQ-1; OQ-2 and
OQ-3 remain open; authorizes no implementation).

Decision records are immutable once Accepted and are **superseded**, never rewritten
(`CLAUDE.md` §14.4, §16.2). Point-in-time audit records live under [`99-archive/audit/`](99-archive/README.md).

## Conventions (per ADR-0001)

- **Naming:** `ADR-NNNN-kebab.md`, `SDR-NNNN-kebab.md` (zero-padded, monotonic, never reused);
  `SCREAMING-KEBAB.md` for process files; `audit/<topic>-YYYY-MM-DD/` for archived records.
- **Lifecycle:** `Draft → Review → Approved → Active`, terminal `Superseded / Deprecated / Archived`;
  decision records use `Proposed → Accepted → (Superseded | Deprecated)`.
- **Single source of truth:** every fact lives in one document; others link to it.
