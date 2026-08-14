# Milestones

The milestone track from Alpha to Omega. Each milestone groups the pull requests that share a theme.
Status advances only when the underlying work has actually landed on `main`. The forward-looking view
is the [Milestone Roadmap](../01-roadmap/Milestone_Roadmap.md).

---

## Milestone Alpha — **Completed**
**Theme:** Product foundation.

The application itself and the engineering discipline around it: a proprietary, client-side,
single-page finance/payroll/operations app in a shared global scope of classic scripts; a
deterministic single-file build; and the mechanical verifier that guards its invariants.

## Milestone Beta — **Completed**
**Theme:** Domain Foundation.

The Domain layer established and made operational in thin, reversible slices:

- **PR-5 / PR-5A** — descriptive Domain registries and the read-only facade.
- **PR-5B** — first operational query (`employee.filtered`).
- **PR-5C.1** — first operational command (`employee.contact.update`).
- **PR-5D** — first aggregate boundary (`EmployeeContactAggregate`).
- **PR-5E** — second aggregate boundary (`EmployeeEmploymentAggregate`).
- **PR-5F** — shared aggregate helpers extracted (refactor; no behavior change).

**Milestone Beta identifies Domain Foundation as completed.**

## Milestone Gamma — **Completed**
**Theme:** Domain Expansion.

The operational aggregate/command surface widened from Employee alone into the Contract and Payroll
areas, one bounded slice at a time, following the established aggregate → handler pattern:

- **PR-5G** — The Gatekeeper — third aggregate boundary (`EmployeeLifecycleAggregate`).
- **PR-5H** — The Arbiter — fourth aggregate boundary (`EmployeeCompensationAggregate`).
- **PR-5I** — The Binder — first Contract boundary (`ContractDateAggregate`).
- **PR-5J** — The Accountant — first Payroll boundary (`PayrollLifecycleAggregate`).

At close: **6 aggregates, 6 commands, 1 query** on `main`, recorded in
[RDR-001](../99-archive/RDR/RDR-001-gamma-repository-snapshot.md).

> **Since Gamma closed:** PR-5K "The Ledger" (`ContractStatusAggregate`) merged, then Milestone Delta ran
> to completion, followed by Milestone Epsilon's Repository adoption (both below). The **current
> authoritative baseline is [RDR-011](../99-archive/RDR/RDR-011-epsilon-repository-snapshot.md)** at commit
> `6714beb`; RDR-001, RDR-003 and RDR-007 are immutable predecessors and no longer the latest baseline.

## Milestone Delta — **Completed**
**Theme:** Platform & Transport.

Delta established the canonical application Platform and proved it transport-agnostic, one bounded slice at
a time (delivery recorded in [DPR-005](../99-archive/DPR/DPR-005-delta-completion-report.md)):

- **PR-6A** — The Gateway — the Application Gateway (canonical Platform boundary).
- **PR-6B** — The Record — governance publication (RDR-003, GHA-001).
- **PR-7A** — The Transport — the Transport Adapter (canonical transport boundary).
- **PR-7B** — The Conduit — the browser UI consumes the canonical path (UI-to-Transport seam).
- **PR-8A** — The Repository — the first persistence-mechanics boundary (one bounded slice).
- **PR-8B** — The CLI — the first non-browser, read-only ingress over the same contract.

At close: **two ingresses (Browser + CLI) over one canonical Platform contract**; 7 aggregates / 7
aggregate-backed commands / 1 aggregate-backed query; 13 registered commands / 4 registered queries;
v2.7.3, SCHEMA 6, commit `55499f2`, 824 verifier checks. The frozen state is recorded in
[RDR-007](../99-archive/RDR/RDR-007-delta-repository-snapshot.md); completion in
[DPR-005](../99-archive/DPR/DPR-005-delta-completion-report.md).

## Milestone Epsilon — **Completed**

**Theme:** Repository Adoption.
**Status:** **Closed** at commit `0ad8150` — closure review passed under MCR-002; closure recorded in
[ECR-001](../99-archive/ECR/ECR-001-milestone-epsilon-closure-record.md).

> **Charter reconciliation.** Epsilon was originally chartered as **Workflow** — *"model multi-step
> lifecycles (payroll, supplemental, finance execution) as explicit workflows over the existing status
> values, preserving derive-don't-duplicate."* It was **formally re-chartered from Workflow to Repository
> Adoption** through the accepted Atlas governance sequence beginning with **ATR-008**. The original
> charter is recorded here as **superseded, not deleted**; the Workflow theme was **not** delivered under
> Epsilon and remains available as a future milestone theme.

Epsilon adopted the Repository boundary across every aggregate, one bounded slice at a time — each
migrating exactly one aggregate-backed handler, with no change to the Repository contract, the Platform,
or the operational surface:

- **ATR-008** — Repository Adoption direction (Hybrid, entity-named repositories).
- **PR-9A / PR-9B / PR-9C** — Employee employment, lifecycle, compensation — **Employee aggregate complete (4 of 4)**.
- **RDR-009 · DPR-007** — intermediate snapshot / progress report (record-only).
- **ATR-009** — Contract Repository readiness review.
- **PR-10A / PR-10B** — `ContractRepository` introduced (dates), then status — **Contract aggregate complete (2 of 2)**.
- **RDR-010 · DPR-008** — intermediate snapshot / progress report (record-only).
- **ATR-010** — Payroll Repository readiness review.
- **PR-11A** — `PayrollRepository` introduced (lifecycle) — **Payroll complete (1 of 1)**; adoption reaches **7 of 7**.
- **RDR-011 · DPR-009** — published baseline and completion report.
- **SPR-075** — governance synchronization (ADR-013, RDR-011, DPR-009, architecture and register updates).

At close of the adoption objective: **three entity-named repositories** (`EmployeeRepository`,
`ContractRepository`, `PayrollRepository`) mediating **all seven aggregate-backed handlers**; Platform,
Transport, Gateway, Domain, Aggregates, Commands, Queries, StorageAdapter and the Repository contract
unchanged; 7 aggregates / 7 aggregate-backed commands / 1 aggregate-backed query; 13 registered commands /
4 registered queries; v2.7.3, SCHEMA 6, commit `6714beb`, **942 verifier checks**. The frozen state is
recorded in [RDR-011](../99-archive/RDR/RDR-011-epsilon-repository-snapshot.md); progress in
[DPR-009](../99-archive/DPR/DPR-009-epsilon-repository-adoption-completion.md); the decision in
[ADR-013](../03-adr/ADR-013-Repository-Layer.md); the closure in
[ECR-001](../99-archive/ECR/ECR-001-milestone-epsilon-closure-record.md) at commit `0ad8150`.

> **7 of 7 is a bounded claim.** It means every aggregate-backed handler delegates persistence through an
> entity-named Repository. It does **not** mean full persistence abstraction (3 of 11 persist functions
> are mediated), compound-persistence support, multi-store transactions, or backend readiness — the
> application remains client-only per [`CLAUDE.md`](../../CLAUDE.md) §4.3. **Compound persistence** is the
> next architectural frontier.

## v2.11.0 Official Release — **Completed · Published · Latest**
**Theme:** the Identity Refresh release ships (merged BRAND-1 product identity + offline typography).

TAM OS **v2.11.0 — Identity Refresh** is **published and marked Latest** in `fanoryu/TAM-OS-Next`, from
annotated tag `v2.11.0` (peeling to `04c1503d`); asset `tam-os-v2.11.0.html` (1,676,709 B, SHA-256
`57d8b0c2…2358557`). Presentation/identity only — no authorization, schema, data or backend change
(`SCHEMA_VERSION` 6, `ACTIONS` 20). **PILOT-1 remains ON HOLD PENDING VPS**; backend **NOT STARTED**.

## v2.10.0 Official Release — **Completed · Published (prior release)**
**Theme:** the Governed Workspace release ships.

TAM OS **v2.10.0 — Governed Workspace** is **published** (now the prior release, no longer Latest; superseded by v2.11.0).

| Field | State |
|---|---|
| Release commit | `335d53ed63056ef9fc0c81c6a5b6541c27018374` |
| Tag | annotated `v2.10.0`, peels to the release commit |
| GitHub Release | **published**, not draft, not prerelease, **Latest** |
| Asset | `tam-os-v2.10.0.html` — 1,151,267 B, SHA-256 `60382271…2c7fa704`, byte-identical to `dist/` |
| Prior release | **v2.9.0 remains published history** — superseded as Latest, never rewritten or deleted |

It packages the UX-006 authorization line and the Readiness programme, with `SCHEMA_VERSION` **6** and
no data migration. **What publication is not:** it is **not** a pilot launch and **not** a
general-availability declaration. It makes the verified artifact obtainable and checksum-verifiable.

## Controlled Pilot — v2.10.0 — **Next · Approved to start · NOT YET LAUNCHED**
**Theme:** the first real users.

Maintainer approval is **granted** and technical readiness is **GO**, recorded in
[Controlled-Pilot-Signoff-v2.10.0](../06-releases/Controlled-Pilot-Signoff-v2.10.0.md) (merge
`df76ec20`).

**Three distinct events — only the first two have happened:**

| # | Event | State |
|---|---|---|
| 1 | v2.10.0 publication | ✅ **DONE** |
| 2 | Controlled pilot sign-off | ✅ **DONE** |
| 3 | **Controlled pilot launch** | ❌ **NOT DONE** |

**Approved and released ≠ launched.** Approval authorises handing the published artifact to the named
operators. **The pilot has not started, and no launch date is set.** This milestone must not be marked
active/live/in-progress until a separate, explicit pilot-launch instruction is issued, and no pilot
participants, results, findings or exit decision may be recorded before they exist.

| Field | State |
|---|---|
| Maintainer approval | **YES** |
| Technical readiness | **GO** |
| Product released | **YES — v2.11.0 (Identity Refresh) published and Latest; v2.10.0 prior** |
| Launch status | **NOT YET LAUNCHED** |
| Audience | **1–3 named internal operators** (desktop Chromium, controlled profile) — not to be broadened |
| Canonical artifact | `tam-os-v2.10.0.html` — **published and frozen**, 1,151,267 B, SHA-256 `60382271…2c7fa704` |
| Pilot limitations | **accepted, not fixed** (no strong authentication; manual single-device backups; mouse-only disabled-reason discoverability; CDN-dependent `.xlsx`; no multi-device sync) |

**Next operational step:** pilot handoff, verifying the artifact SHA-256 before distribution.

## Post-Pilot Findings & Remediation — **Upcoming**
**Theme:** what the pilot actually surfaces.

Collect pilot findings, classify them, remediate the accepted defects, and preserve the evidence that
the Pilot Exit Review will need — while preventing silent mutation of the frozen RC.

**Triage rule:**

| Severity | Disposition |
|---|---|
| **P0 / P1** | **Pilot-stop / remediation candidates** — assess immediately against continuing the pilot |
| **P2** | Post-pilot remediation |
| **P3 / presentation polish** | Backlog, unless specifically promoted |

**RC mutation rule (binding).** The v2.10.0 RC is frozen. **Any runtime modification requires a new
candidate**, with new verification evidence and a **new artifact checksum** — the existing evidence
and hash may never be carried across a runtime change.

## Pilot Exit Review — **Upcoming**
**Theme:** may TAM OS leave the controlled pilot?

Reviews the pilot's outcome and evidence to determine whether the product may proceed from controlled
pilot toward general-use hardening, remain in pilot, or roll back. **Its result is not pre-declared
here** — this milestone records only that the review must happen and what it decides.

## Distribution-1 — Modular Distribution Migration — **Upcoming (post-pilot)**
**Theme:** Canonical distribution moves from the generated single file to the application package.

Authorized by [ADR-0002](../03b-repository-adr/ADR-0002-canonical-distribution-architecture.md) (**Accepted**),
which approves `index.html` + application assets as the **preferred future distribution
architecture** and defers the migration to this dedicated milestone. It is explicitly **not** to be
attempted inside a release-candidate PR, and **not** partially.

The audit behind ADR-0002 found **zero `REQUIRED`** dependencies on the single-file artifact — Model A
is retained for the v2.10.0 pilot on release-risk sequencing grounds alone. It also established that
the single file is **not** fully offline: SheetJS and Google Fonts remain external CDN dependencies
in both models.

**Scope (one change, not staged):**
- `index.html` + application assets as the canonical package
- explicit `CLAUDE.md` amendment (§3, §5, §10, §11, §12, §13, §15, §19) — partial migration prohibited
- deterministic package builder (directory and/or ZIP) with a package manifest and recorded hash
- replacement of single-file-only verifier assumptions — revised deliberately, never merely deleted:
  entry point present, all JS/CSS present per the load-order manifest, `APP_VERSION` consistency,
  package determinism, package↔source parity by hash, no missing runtime dependency
- CI artifact and release-workflow changes; `CODEOWNERS` and CodeQL path-rule updates
- documented source/package parity model
- **full browser re-acceptance against the new package** — never carried over from the single file —
  covering boot with zero console errors, principal selection, Employee privacy, Finance, Payroll,
  real `.xlsx` file-input flow, backup export/restore, and reload persistence

**Prerequisite:** the v2.10.0 controlled pilot has concluded. **Distribution-1 does not block the
controlled pilot** — the pilot ships on the retained Model A artifact.

## Multi-User-0 — Shared Multi-User Architecture Decision — **Completed · accepted baseline · FROZEN**
**Theme:** deciding how TAM OS becomes a genuine multi-user system — **without building any of it**.

Turned the recorded [multi-user requirement](../99-archive/roadmap-completed/Multi-User-Requirement-Note.md) into an
implementation-ready architecture. The full analysis is
[Multi-User-0](../01-roadmap/Multi-User-0-Shared-Multi-User-Architecture-Decision.md); the decision is
[ADR-0003](../03b-repository-adr/ADR-0003-shared-multi-user-architecture.md), **Accepted 2026-08-12**.

**Maintainer ruling: APPROVED as the architecture baseline.** The direction may be used as the basis
for subsequent planning, and this milestone is **closed and frozen**. **Implementation is not
authorized** — no backend provisioning, no migration, no runtime or schema change, and **no
`CLAUDE.md` amendment**.

**Recommended target:** one authoritative company dataset in **PostgreSQL** with **Row-Level Security**
as the enforcement boundary, **Supabase Auth** for verified identity, a thin server function layer for
composite/irreversible operations, and an **online-required** client. The browser becomes an
**untrusted** client; today's `can(...)` and `getScopedRecords()` are retained as **UX affordance only**.
`ACTIONS` stays **20**; existing record IDs are preserved.

**This milestone implemented nothing.** Implementation (Multi-User-1…8) remains gated on:

| Gate | State |
|---|---|
| `CLAUDE.md` §4.3 client-only **MUST** amendment | **NOT performed** — maintainer authority only. **This is the standing blocker** |
| ADR-0003 | ✅ **Accepted** (2026-08-12) — direction only; authorizes no implementation |
| SDR-0002 (security decision record) | **Not created** — required before MU-1 |
| Data-residency answer | **Open** — may change the vendor/region choice |
| Per-milestone authorization | **None issued** — each MU milestone needs its own Sprint Assignment |

**Relationship to the controlled pilot (binding).** The approved v2.10.0 pilot runs on the **current
local, trust-based** architecture and is **unchanged** by this milestone. The pilot must never be
described as multi-user, and its audience must not be broadened on the strength of a *planned*
architecture. The recommendation is that the pilot **proceeds as approved, in parallel** with this
governance track — it de-risks the multi-user work by surfacing domain defects while they are still
cheap to fix.

**Sequencing.** Distribution-1 is recommended **before** Multi-User implementation: a multi-user client
needs runtime configuration and a deployable static bundle, so Model B is effectively a prerequisite
rather than a parallel track. ADR-0002 is **not** invalidated.

## Multi-User-1…8 — Shared Multi-User Implementation — **Future · not authorized**
**Theme:** building it, only if ADR-0003 is Accepted.

Proposed decomposition: **MU-1** governance & backend foundation · **MU-2** authentication & identity
linkage · **MU-3** shared persistence (schema + RLS) · **MU-4** server authorization & read scope ·
**MU-5** domain migration & data cutover · **MU-6** audit, backup & recovery · **MU-7** multi-user E2E
acceptance · **MU-8** cutover & decommission.

**MU-1 through MU-4 are additive and reversible** — the product keeps working exactly as today
throughout. **MU-5 is the first irreversible step**, and it is deliberately gated behind MU-4, whose
sole acceptance criterion is proving that an authenticated Employee **cannot** fetch a colleague's
payroll through the raw API. Confidential data does not move until the privacy boundary is proven
against a hostile client.

## General-Use Readiness / Hardening — **Future**
**Theme:** the work between "a controlled pilot succeeded" and "anyone may use this".

Gated on the Pilot Exit Review. Addresses the limitations deliberately accepted for the controlled
pilot rather than fixed — principally the absence of strong authentication, manual single-device
backups, mouse-only disabled-reason discoverability, the CDN-dependent `.xlsx` path, and the lack of
multi-device synchronization. Scope is defined after the exit review, not before it.

## Milestone Zeta — **Upcoming**
**Theme:** Intelligence Layer.

Read-only analytical and advisory capability built strictly as a Domain client — never a parallel
source of truth (see [AI_Architecture.md](../02-architecture/AI_Architecture.md)).

## Milestone Omega — **Upcoming**
**Theme:** Enterprise Platform.

The long-horizon target: a fully Domain-governed operations platform whose every state change is a
registered command, every read a registered query, and every decision an aggregate.
