# Milestone Closure Records (ECR)

Closure records for completed milestones. An ECR is the **final historical record** of a milestone: it
states what was delivered, at which baseline the milestone closed, and what was deferred. It evaluates
nothing, recommends nothing, and authorizes no work.

ECRs are written **after** a milestone closure review passes. They are **immutable once Accepted** — a
later milestone gets its own record; an ECR is never rewritten (`CLAUDE.md` §14.4, §16.2).

An ECR is distinct from the other record types:

| Record | Answers |
|---|---|
| [RDR](../RDR/README.md) | What was the factual repository state at a boundary? |
| [DPR](../DPR/README.md) | What progress was made, and what remains? |
| [ADR](../03-adr/README.md) | What was decided, and why? |
| **ECR** | **Which milestone closed, at which baseline, having delivered what?** |

## Lifecycle

`Reviewed → Accepted (closed)`

- **Reviewed** — a milestone closure review (MCR) has passed.
- **Accepted (closed)** — the milestone is formally closed; the record is immutable.

## Register

| ECR | Milestone | Theme delivered | Status | Closure baseline | Date |
|---|---|---|---|---|---|
| [ECR-001](ECR-001-milestone-epsilon-closure-record.md) | Epsilon | Repository Adoption | **Accepted — closed** | `0ad8150` | 2026-08-03 |

> **Milestone Epsilon closed** at commit `0ad81501b5a7cddc525bdc65bfa45710233476e9`, having delivered
> aggregate-backed Repository adoption across the Employee, Contract, and Payroll aggregates (7 of 7).
> The repository baseline at closure is [RDR-011](../RDR/RDR-011-epsilon-repository-snapshot.md); the
> progress record is [DPR-009](../DPR/DPR-009-epsilon-repository-adoption-completion.md); the decision is
> [ADR-013](../03-adr/ADR-013-Repository-Layer.md).

**Earlier milestones.** Milestones Alpha through Delta closed before this record type existed and have no
ECR. Their completion is recorded in [`Milestones.md`](../05-milestones/Milestones.md), with Milestone
Delta additionally captured by [RDR-007](../RDR/RDR-007-delta-repository-snapshot.md) and
[DPR-005](../DPR/DPR-005-delta-completion-report.md). ECR numbering starts at Epsilon and is never
reused.

**Record-only closure reviews.** Milestone closure reviews (MCR-001, MCR-002) are maintained in the Atlas
governance system and are not separately published as files; MCR-002's outcome is captured by
[ECR-001](ECR-001-milestone-epsilon-closure-record.md).

## Post-closure changes

A milestone's closure baseline is fixed at the commit recorded in its ECR. Work merged after that commit
belongs to whatever follows the milestone — it never retroactively joins the closed milestone and never
changes the recorded baseline. Where such work is materially adjacent to closure, the ECR notes it for
continuity (see [ECR-001 §11](ECR-001-milestone-epsilon-closure-record.md#11-post-closure-repository-maintenance)).
