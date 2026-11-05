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
| **v2.11.0 Official Release** | **Completed · published · Latest** | TAM OS v2.11.0 *Identity Refresh* — the merged **BRAND-1** product-identity / offline-typography modernization; **published and marked Latest** in `fanoryu/TAM-OS-Next` from annotated tag `v2.11.0` (peeling to `04c1503d`). Asset `tam-os-v2.11.0.html` (1,676,709 B, SHA-256 `57d8b0c2…2358557`) byte-identical to `dist/`. Presentation/identity only — no authorization, schema, data or backend change; **not** a pilot launch and **not** general availability |
| **v2.10.0 Official Release** | **Completed · published (prior release)** | TAM OS v2.10.0 *Governed Workspace* — **originally published** from annotated tag `v2.10.0` on release commit `335d53ed` in the predecessor `fanoryu/TAM-OS`, then **canonically re-published unchanged** from annotated tag `v2.10.0` in `fanoryu/TAM-OS-Next` (peeling to `856e3ca6`); now the prior release — the predecessor still shows Latest = v2.10.0 while `fanoryu/TAM-OS-Next` shows Latest = v2.11.0. Asset `tam-os-v2.10.0.html` (1,151,267 B, SHA-256 `60382271…2c7fa704`) byte-identical across both Releases and to `dist/` at that tag. It is **not** a new product version and **not** general availability |
| **Controlled Pilot — v2.10.0** | Approved · **NOT YET LAUNCHED · ON HOLD (PILOT-1)** | The first real users — the published, frozen `tam-os-v2.10.0.html` handed to 1–3 named internal operators. Approved and released is **not** launched; no launch date is set. **On hold** by maintainer direction until the multi-user readiness gate; per the 2026-09-29 sequencing ruling it follows Multi-User and the production cutover ([Milestones](../05-milestones/Milestones.md)) |
| **Post-Pilot Findings & Remediation** | Upcoming | Collect, triage and remediate what the pilot surfaces; the frozen RC may not be mutated silently |
| **Pilot Exit Review** | Upcoming | May TAM OS leave the controlled pilot? Outcome deliberately not pre-declared |
| **Distribution-1** | **Completed** (2026-09-29) · unreleased | Modular distribution migration — `index.html` + assets as the canonical package, per [ADR-0002](../03b-repository-adr/ADR-0002-canonical-distribution-architecture.md). Prerequisite for Multi-User implementation (2026-09-29 sequencing ruling; ADR-0002 revalidated) — now for a strict CSP ([ADR-0004](../03b-repository-adr/ADR-0004-hostinger-same-origin-backend.md) §2.8) |
| **Multi-User-0** | **Completed · accepted baseline** | Shared Multi-User Architecture Decision — architecture/governance only. One authoritative company dataset behind a server-enforced trust boundary ([ADR-0003](../03b-repository-adr/ADR-0003-shared-multi-user-architecture.md), **Accepted** 2026-08-12; **superseded 2026-09-29 by [ADR-0004](../03b-repository-adr/ADR-0004-hostinger-same-origin-backend.md)**). **Implements nothing**; acceptance settled direction only |
| **Multi-User-1…8** | **In progress · source only** (backend not deployed; production SESSION mode not enabled; AFI-5b merged as source (PR #62), not deployed; AFI-5c on hold) | Shared multi-user implementation — governance/backend foundation, authentication, shared persistence, server authorization & read scope, domain migration, audit/backup/recovery, multi-user E2E acceptance, cutover. Target: same-origin PHP + MariaDB on the existing Hostinger hosting ([ADR-0004](../03b-repository-adr/ADR-0004-hostinger-same-origin-backend.md)); `CLAUDE.md` §4.3 permits only that backend; SDR-0002 Accepted; Distribution-1 completed; each milestone separately authorized |
| **Core SESSION** | **Engineering complete · not released** | Sign-in, Account security (Change password, Sign out all devices) and the SESSION domains (Employees, Overtime, Payroll, Supplemental, Finance posting, Record payment, Audit). Merged via PR #76, #77, #78 (`main` @ `8ef3d6be`); validated locally by WP-E2E-2 (282/282 E2E, 901/0 PHP). No version, tag or deployment |
| **Staging Deployment** | **Next · gated** | First deployment, **staging only, fabricated data, CEO-only**, per [`BACKEND-DEPLOYMENT-RUNBOOK.md`](../BACKEND-DEPLOYMENT-RUNBOOK.md). Requires a **staging-specific Gate D ruling**, the SDR-0006 X1–X8 evidence, a separately authorized release candidate, and Owner decisions OD-W2-1…3; host evidence E1–E6/E9 and the HP-1…HP-7 probe (incl. F-2) on the host |
| **Staging Stabilization** | Upcoming | Triage and fix what staging surfaces; re-run the regression on the deployed commit |
| **GitHub Repository Cleanup** | Upcoming | Merged branches (remote and local), branch-deletion setting, repository metadata. No history rewrite, no evidence deletion |
| **Documentation Simplification and Finalization** | Upcoming | Shorter current-state entry documents with clear status lines; historical entries and governance records preserved |
| **README Badge & Link Audit** | Upcoming | The README badge findings below |
| **Phased Full Parity** | Upcoming | The remaining LOCAL domains migrate to SESSION **one domain at a time**, each separately authorized, verified and released |
| **Production Readiness & Cutover** | Future · separately gated | Production Gate D on a tagged release and Gate R; E7 restore rehearsal, E8 data residency, E10 Hostinger 2FA, E12 external security review, governed mail, production-only secrets and keys, SDR-0002 §22 items 1 and 8 on the production host, the `DEPLOYMENT.md` §8 cutover gate |
| **General-Use Readiness** | Future | The gap between "a controlled pilot succeeded" and "anyone may use this"; scope defined after the exit review |
| **Zeta** | Upcoming | Intelligence Layer — read-only analytical clients of the Domain |
| **Omega** | Upcoming | Enterprise Platform — fully Domain-governed operations |

**Owner-approved sequence (2026-11-05).** Core SESSION → Staging Deployment → Staging Stabilization → GitHub
Repository Cleanup → Documentation Simplification and Finalization → README Badge & Link Audit → Phased Full Parity →
Production Readiness & Cutover. The order records direction only: **no row authorizes implementation, a version, a
tag, a release or a deployment**; each needs its own Owner authorization, and Gate D and Gate R stay on HOLD until
separately ruled. `APP_VERSION` remains 2.11.0. Existing gates, decisions and records above are unchanged.

**README Badge & Link Audit — recorded findings (future cleanup; not fixed here).**

1. The five Shields.io badges (Version, License, JavaScript, HTML, Core) are not wrapped in links, so selecting one
   opens the raw SVG image.
2. The CI and Attribution badges are correctly linked to their workflows; keep them.
3. The Version badge is a hard-coded `2.11.0`; it must track the actually released version.
4. README states `ACTIONS` **20** for v2.11.0 while `main` carries 21: verify the historical count at the `v2.11.0`
   tag before changing any wording.

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
- **Engineering complete · not released** — merged and verified on `main`, with no version, tag or deployment.
- **Next · gated** — the next direction; it starts only when its named gates are satisfied and the Owner authorizes it.
- **Future · separately gated** — a later direction behind gates of its own.

*Milestone status advances only when the work beneath it has actually landed. This document tracks
the track; it does not itself authorize work.*
