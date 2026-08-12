# Atlas Governance Artifact Register

A **discovery index** for the Atlas-issued governance artifacts that bear on the current architecture
baseline. This register does **not** define a new decision-record type and does **not** replace the
authoritative homes for records that already have one (`docs/99-archive/RDR/`, `docs/security/`, `docs/03b-repository-adr/`,
`docs/03-adr/`, `audit/`). It exists so that every artifact referenced by the milestone baseline is
**discoverable and its publication status is honest** — nothing is silently missing, and nothing is
fabricated.

> **Convention (per [ADR-0001](../03b-repository-adr/ADR-0001-documentation-governance-model.md)).** Records with an
> established home are published there and linked from their own register; this page only points to them.
> Artifacts whose authoritative text is maintained in the external Atlas governance system and has **not
> been supplied to the repository** are listed as **Pending repository publication** — reserved, not
> orphaned, and explicitly not yet present as a file. No placeholder invents record content.

## Published in this repository

| Artifact | Title | Home | Status |
|---|---|---|---|
| [RDR-001](../99-archive/RDR/RDR-001-gamma-repository-snapshot.md) | Gamma Repository Snapshot | `docs/99-archive/RDR/` | Accepted (superseded as baseline) |
| [RDR-003](../99-archive/RDR/RDR-003-delta-repository-snapshot.md) | Delta Repository Snapshot (Gateway boundary) | `docs/99-archive/RDR/` | Accepted (superseded as baseline by RDR-007) |
| [RDR-007](../99-archive/RDR/RDR-007-delta-repository-snapshot.md) | Delta Repository Snapshot (post-PR-8B) | `docs/99-archive/RDR/` | Accepted (superseded as baseline by RDR-011) (`55499f2`) |
| [RDR-011](../99-archive/RDR/RDR-011-epsilon-repository-snapshot.md) | Epsilon Repository Snapshot — Aggregate-Backed Repository Adoption Complete | `docs/99-archive/RDR/` | **Accepted — current authoritative baseline** (`6714beb`) |
| [DPR-005](../99-archive/DPR/DPR-005-delta-completion-report.md) | Delta Completion Report | `docs/99-archive/DPR/` | Accepted — official Milestone Delta completion report (superseded as current by DPR-009) |
| [DPR-009](../99-archive/DPR/DPR-009-epsilon-repository-adoption-completion.md) | Epsilon Repository Adoption Completion Report | `docs/99-archive/DPR/` | **Accepted — current progress report** |
| [ADR-013](../03-adr/ADR-013-Repository-Layer.md) | Repository Layer (entity-named, collection-grained) | `docs/03-adr/` | **Accepted — Repository architecture decision** |
| [ADR-014](../03-adr/ADR-014-Contract-Core-Field-Authority.md) | Contract Core Field Authority | `docs/03-adr/` | **Accepted — resolves ARCH-008 OQ-1; authorizes no implementation** |
| [ECR-001](../99-archive/ECR/ECR-001-milestone-epsilon-closure-record.md) | Milestone Epsilon Closure Record | `docs/99-archive/ECR/` | **Accepted — Milestone Epsilon closed** (`0ad8150`) |
| [GHA-001](../99-archive/audit/github-audit-2026-08-02/GHA-001-github-repository-comprehensive-audit.md) | GitHub & Repository Comprehensive Audit | `audit/` | Complete — recorded |
| [SDR-0001](../security/SDR-0001-codeql-baseline-disposition.md) | CodeQL Baseline Disposition | `docs/security/` | Accepted (dispositions CodeQL #1–5) |

## Milestone Delta governance trail (record-only / superseded)

The artifacts below are Atlas governance records produced across Milestone Delta. Progress reports and
repository snapshots are **superseded** by the current baselines ([RDR-011](../99-archive/RDR/RDR-011-epsilon-repository-snapshot.md),
[DPR-009](../99-archive/DPR/DPR-009-epsilon-repository-adoption-completion.md)); reviews/approvals are recorded as milestone events.
Record-only entries were maintained in the Atlas governance system; their substance is captured by the
current published records and by the in-repo verifier/merge trail — they are **not** separately published
as files (no fabricated bodies; `CLAUDE.md` §16.4).

| Artifact | Title | Status |
|---|---|---|
| RDR-002 / RDR-004 / RDR-005 / RDR-006 | Intermediate Delta repository snapshots | Record-only — **superseded by RDR-007** (see [RDR register](../99-archive/RDR/README.md)) |
| DPR-001 / DPR-002 / DPR-003 / DPR-004 | Delta progress reports | Record-only — **superseded by [DPR-005](../99-archive/DPR/DPR-005-delta-completion-report.md)** (see [DPR register](../99-archive/DPR/README.md)) |
| ATR-003 | Delta Readiness Review | Record-only — milestone review |
| ATR-004 | Platform Gateway Contract Review | Record-only — decision captured in [RDR-003 §3.1](../99-archive/RDR/RDR-003-delta-repository-snapshot.md#31-gateway-envelope-semantics-atr-004--intentional-not-a-defect) |
| ATR-005 / ATR-006 / ATR-007 | Delta capability/multi-transport reviews | Record-only — milestone reviews (informed PR-7A/PR-8A/PR-8B) |
| SRD-062A | Platform Gateway Contract Revision | Record-only — contract implemented at commit `a4eedac` |
| SRD-065A | Repository Scope Correction Directive | Record-only — corrected scope for PR-7B |
| FAA-PR6A … FAA-PR8B | Final Architecture Approvals (per PR) | Record-only — each captured by its merge commit (PR #21–#26) |
| GCR-001 | Gamma Closure Report | Record-only (pre-Delta) |
| SPR-058 … SPR-068 | Sprint Assignments | Process instruments — governed by [`SPR_Standard.md`](../04-standards/SPR_Standard.md); realized as PRs #19–#26 |

## Milestone Epsilon governance trail (Repository Adoption)

Milestone Epsilon was **formally re-chartered from Workflow to Repository Adoption** through the accepted
Atlas governance sequence beginning with **ATR-008**. The original Workflow charter is preserved as
superseded history in [`Milestones.md`](../05-milestones/Milestones.md#milestone-epsilon--repository-adoption).

| Artifact | Title | Status |
|---|---|---|
| ATR-008 | Repository Adoption Direction (Hybrid, entity-named) | Record-only — direction; re-chartered Epsilon. Decision published as [ADR-013](../03-adr/ADR-013-Repository-Layer.md) |
| PR-9A / PR-9B / PR-9C | Employee Repository adoption (employment, lifecycle, compensation) | Merged — PRs #28, #29, #30 |
| RDR-008 / RDR-009 | Intermediate Epsilon repository snapshots | Record-only — **superseded by [RDR-011](../99-archive/RDR/RDR-011-epsilon-repository-snapshot.md)** |
| DPR-006 / DPR-007 | Intermediate Epsilon progress reports | Record-only — **superseded by [DPR-009](../99-archive/DPR/DPR-009-epsilon-repository-adoption-completion.md)** |
| ATR-009 | Contract Repository Readiness Review | Record-only — milestone review (informed PR-10A/PR-10B) |
| PR-10A / PR-10B | Contract Repository adoption (dates, status) | Merged — PRs #31, #32 |
| RDR-010 | Contract-adoption-complete repository snapshot | Record-only — **superseded by [RDR-011](../99-archive/RDR/RDR-011-epsilon-repository-snapshot.md)** |
| DPR-008 | Epsilon Progress Report — Contract Adoption Complete | Record-only — **superseded by [DPR-009](../99-archive/DPR/DPR-009-epsilon-repository-adoption-completion.md)** |
| ATR-010 | Payroll Repository Readiness Review | Record-only — milestone review (informed PR-11A) |
| FAA-PR10A / FAA-PR10B / FAA-PR11A | Final Architecture Approvals (per PR) | Record-only — each captured by its merge commit (PRs #31, #32, #34) |
| PR-11A | Payroll Repository adoption — **7 of 7** | Merged — PR #34 (`6714beb`) |
| [RDR-011](../99-archive/RDR/RDR-011-epsilon-repository-snapshot.md) | Epsilon Repository Snapshot | **Published — current baseline** |
| [DPR-009](../99-archive/DPR/DPR-009-epsilon-repository-adoption-completion.md) | Epsilon Repository Adoption Completion Report | **Published — current report** |
| SPR-074 / SPR-075 | Sprint Assignments (Payroll slice; governance synchronization) | Process instruments — realized as PR #34 and PR #35 |
| MCR-002 | Milestone Epsilon Formal Closure Review | Record-only — passed; outcome captured by [ECR-001](../99-archive/ECR/ECR-001-milestone-epsilon-closure-record.md) |
| [ECR-001](../99-archive/ECR/ECR-001-milestone-epsilon-closure-record.md) | Milestone Epsilon Closure Record | **Published — Milestone Epsilon closed at `0ad8150`** |
| SPR-076 | Sprint Assignment (ECR-001 publication) | Process instrument — realized as this documentation PR |

> **7 of 7 is a bounded claim.** It means every aggregate-backed handler delegates persistence through an
> entity-named Repository. It does **not** mean full persistence abstraction, compound-persistence support,
> multi-store transactions, or backend readiness. See [ADR-013](../03-adr/ADR-013-Repository-Layer.md).

> **Authoritative statements live in the published records**, not this index. Where a decision is captured
> by an in-repo record (e.g. ATR-004 → RDR-003 §3.1) or by the merge/verifier trail, that record is
> authoritative; this register only tracks each artifact's status.

## Notes

- SPR (Sprint Assignment) contracts are issued per task and governed by
  [`SPR_Standard.md`](../04-standards/SPR_Standard.md); they are process instruments, not decision
  records, and are not individually filed here unless a specific SPR is later published as an artifact.
- This register is linked from the [`docs/` index](../README.md). It carries no authority of its own; it
  points to records that do.
