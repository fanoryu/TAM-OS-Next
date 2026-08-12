# Milestone Roadmap

The milestone track is the coarse-grained view of the project's progress. Where the
[Domain Roadmap](Domain_Roadmap.md) sequences individual pull requests, the milestone track groups
them into named eras. Detailed, per-milestone scope is recorded in
[Milestones.md](../05-milestones/Milestones.md).

| Milestone | Status | Theme |
|---|---|---|
| **Alpha** | Completed | Product foundation — application, deterministic build, mechanical verifier |
| **Beta** | Completed | Domain Foundation — registry, query, command, aggregates, shared helpers |
| **Gamma** | Completed | Domain Expansion — widened the operational aggregate/command surface (PR-5G–PR-5J) |
| **Delta** | Completed | Platform & Transport — Application Gateway, Transport Adapter, first Repository boundary, CLI ingress |
| **Epsilon** | Completed | Repository Adoption — entity-named repositories across every aggregate (7 of 7); closed at `0ad8150`, recorded in [ECR-001](../99-archive/ECR/ECR-001-milestone-epsilon-closure-record.md) |
| **v2.10.0 Official Release** | **Completed · published · Latest** | TAM OS v2.10.0 *Governed Workspace* published from annotated tag `v2.10.0` on release commit `335d53ed`; asset `tam-os-v2.10.0.html` (1,151,267 B, SHA-256 `60382271…2c7fa704`) byte-identical to `dist/`. Publication makes the artifact obtainable — it is **not** a pilot launch and **not** general availability |
| **Controlled Pilot — v2.10.0** | Next · approved · **NOT YET LAUNCHED** | The first real users — the published, frozen `tam-os-v2.10.0.html` handed to 1–3 named internal operators. Approved and released is **not** launched; no launch date is set |
| **Post-Pilot Findings & Remediation** | Upcoming | Collect, triage and remediate what the pilot surfaces; the frozen RC may not be mutated silently |
| **Pilot Exit Review** | Upcoming | May TAM OS leave the controlled pilot? Outcome deliberately not pre-declared |
| **Distribution-1** | Upcoming (post-pilot) | Modular distribution migration — `index.html` + assets as the canonical package, per [ADR-0002](../03b-repository-adr/ADR-0002-canonical-distribution-architecture.md). Does not block the pilot |
| **Multi-User-0** | **Completed · accepted baseline** | Shared Multi-User Architecture Decision — architecture/governance only. One authoritative company dataset behind a server-enforced trust boundary ([ADR-0003](../03b-repository-adr/ADR-0003-shared-multi-user-architecture.md), **Accepted** 2026-08-12). **Implements nothing**; acceptance settles direction only |
| **Multi-User-1…8** | Future · **not authorized, not started** | Shared multi-user implementation — governance/backend foundation, authentication, shared persistence, server authorization & read scope, domain migration, audit/backup/recovery, multi-user E2E acceptance, cutover. **Blocked on the `CLAUDE.md` §4.3 amendment, which has NOT been performed** |
| **General-Use Readiness** | Future | The gap between "a controlled pilot succeeded" and "anyone may use this"; scope defined after the exit review |
| **Zeta** | Upcoming | Intelligence Layer — read-only analytical clients of the Domain |
| **Omega** | Upcoming | Enterprise Platform — fully Domain-governed operations |

**Superseded themes (recorded, not deleted).** Two milestones were re-chartered as their work was
authorized; the original directions are preserved here and remain available as future themes:

| Milestone | Original theme | Delivered theme | Re-chartered by |
|---|---|---|---|
| Delta | Domain Events & Policies | Platform & Transport | Milestone Delta sequence (PR-6A … PR-8B); recorded in [RDR-007](../99-archive/RDR/RDR-007-delta-repository-snapshot.md) / [DPR-005](../99-archive/DPR/DPR-005-delta-completion-report.md) |
| Epsilon | Workflow — explicit lifecycles over existing status values | Repository Adoption | Accepted Atlas sequence beginning **ATR-008**; recorded in [RDR-011](../99-archive/RDR/RDR-011-epsilon-repository-snapshot.md) / [DPR-009](../99-archive/DPR/DPR-009-epsilon-repository-adoption-completion.md) / [ADR-013](../03-adr/ADR-013-Repository-Layer.md) |

## Status meaning

- **Completed** — every pull request in the milestone is merged, verified, and reflected on `main`.
- **Engineering complete · closure pending** — the milestone's work is merged, verified and
  governance-synchronized on `main`, awaiting only a formal closure record.
- **Upcoming** — an approved direction whose work is authorized only as Sprint Assignments are issued.

*Milestone status advances only when the work beneath it has actually landed. This document tracks
the track; it does not itself authorize work.*
