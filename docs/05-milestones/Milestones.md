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
(`SCHEMA_VERSION` 6, `ACTIONS` 20). **PILOT-1 remains ON HOLD** pending the multi-user readiness gate
(the earlier "pending VPS" assumption was retired by HOSTING-0 — no VPS is required); backend **NOT STARTED**.

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
| Launch status | **NOT YET LAUNCHED — ON HOLD (PILOT-1)** |
| Audience | **1–3 named internal operators** (desktop Chromium, controlled profile) — not to be broadened |
| Canonical artifact | `tam-os-v2.10.0.html` — **published and frozen**, 1,151,267 B, SHA-256 `60382271…2c7fa704` |
| Pilot limitations | **accepted, not fixed** (no strong authentication; manual single-device backups; mouse-only disabled-reason discoverability; CDN-dependent `.xlsx`; no multi-device sync) |

**PILOT-1 is ON HOLD (maintainer direction, recorded by ARCH-GOV-1 on 2026-09-29).** Real operational
use with company data begins only after the multi-user readiness gate — authentication, shared
persistence, server-side authorization and the production cutover gate in
[`DEPLOYMENT.md`](../DEPLOYMENT.md) §8. **No real company data has been entered.** The currently hosted
TAM OS copy is **pre-operational**; local prototype testing and internal technical preview with
fabricated data are not PILOT-1. The sign-off above remains on record; it is not a launch
instruction while the hold stands.

**Sequencing ruling (maintainer, 2026-09-29).** The hold made the recorded order circular:
Distribution-1 waited on the pilot concluding, Multi-User waited on Distribution-1, and PILOT-1 now
waits on Multi-User. The maintainer resolved it — **Distribution-1 is no longer gated on PILOT-1**
(an [ADR-0002](../03b-repository-adr/ADR-0002-canonical-distribution-architecture.md) §5 revalidation,
recorded there as a forward-pointer note; the ADR's decision is unchanged). The binding sequence is:

**ARCH-GOV-1 → SDR-0002 → Distribution-1 → Multi-User implementation** (Supabase Auth, shared
persistence, RLS, authoritative identity integration, authenticated authorization E2E, removal of
production "Acting as") **→ production readiness validation → `finance.reliabilityindonesia.com`
cutover → PILOT-1**, followed by the recorded Post-Pilot Findings & Remediation, Pilot Exit Review and
General-Use Readiness.

**Refinement (ARCH-GOV-2, 2026-09-29).** The maintainer rejected Supabase, and
[ADR-0004](../03b-repository-adr/ADR-0004-hostinger-same-origin-backend.md) superseded ADR-0003. The backend is now a same-origin PHP + MariaDB API on the
existing Hostinger hosting. The binding sequence is now:

**ARCH-GOV-2 → SDR-0002 → Distribution-1 → backend foundation → authentication/session →
authoritative identity → authorization/data scope → audit/backup → authenticated E2E → "Acting as"
removal → production readiness/security review → `finance.reliabilityindonesia.com` cutover →
PILOT-1**.

Distribution-1 keeps its place before the backend for a new reason: a strict Content-Security-Policy,
which the inlined single file cannot carry (ADR-0004 §2.8).

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

## Distribution-1 — Modular Distribution Migration — **Completed (2026-09-29) · unreleased**
**Theme:** Canonical distribution moves from the generated single file to the application package.

**Delivered (one change, not staged).**
- **Package:** `tools/build-package.js` builds the static document root (`index.html`, 6 stylesheets,
  `js/boot/theme-boot.js`, every module-order script, vendored SheetJS 0.18.5 with its Apache-2.0
  licence, and the font OFL texts) as byte-identical copies of the source, plus a deterministic ZIP.
  The committed `dist/package-manifest.json` records every file's SHA-256, the package digest and the
  ZIP digest.
- **Strict CSP:**
  - The pre-paint theme script moved verbatim into `js/boot/theme-boot.js`.
  - SheetJS is served same-origin (the same bytes as the former cdnjs pin, still SRI-checked).
  - The page has no inline executable script and no third-party request.
  - The header contract lives in `tools/package-headers.js`: `script-src 'self'`, and one documented
    relaxation — `style-src-attr 'unsafe-inline'` for about 457 legacy inline style attributes.
    Removing that relaxation is tracked follow-up work.
- **Verifier:**
  - Single-file fidelity was replaced by package determinism, manifest parity and source parity.
  - The published `dist/tam-os-v2.11.0.html` is pinned by digest as frozen history.
  - Strict-CSP invariants were added.
  - `tools/build-single-file.js` is retired.
- **CI, release and governance:**
  - CI and release verify, build and check the manifest, then publish the ZIP and manifest.
  - CodeQL ignores `vendor/**`; CODEOWNERS covers `/vendor/`.
  - `CLAUDE.md` §3, §4.3, §5, §6.2, §10, §11, §12, §13, §15 and §19 were amended.
- **Browser re-acceptance:** done on the package served under its real CSP, with fabricated data:
  - boot with zero console errors and zero violations
  - CEO and Employee principal selection, with Employee privacy (a CEO-created employee is not visible)
  - Finance, Payroll, Employees and Dashboard navigation
  - the real `.xlsx` file-input flow
  - Complete Backup export → restore
  - reload persistence and the light/dark pre-paint theme
- **Release status:** unreleased. The next version is the first to ship the package.

Authorized by [ADR-0002](../03b-repository-adr/ADR-0002-canonical-distribution-architecture.md) (**Accepted**),
which approves `index.html` + application assets as the **preferred future distribution
architecture** and defers the migration to this dedicated milestone. It is explicitly **not** to be
attempted inside a release-candidate PR, and **not** partially.

The audit behind ADR-0002 found **zero `REQUIRED`** dependencies on the single-file artifact — Model A
is retained for the v2.10.0 pilot on release-risk sequencing grounds alone. It also established that
the single file is **not** fully offline: SheetJS and Google Fonts remain external CDN dependencies
in both models (fonts have since been embedded, in v2.11.0; SheetJS remains).

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

**Prerequisite (revised by the 2026-09-29 sequencing ruling):** SDR-0002 and its own authorization.
The former prerequisite — "the v2.10.0 controlled pilot has concluded" — is superseded: PILOT-1 now
follows Multi-User, which needs Distribution-1 first. Model A remains canonical until Distribution-1
lands.

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
| `CLAUDE.md` §4.3 client-only **MUST** amendment | ✅ **Performed by ARCH-GOV-1 (2026-09-29)**, then **re-amended by ARCH-GOV-2** — §1, §4.3, §6.2 and §7 now permit **only** the ADR-0004 same-origin PHP + MariaDB backend; authorizes no implementation |
| ADR-0003 | **Superseded** (2026-09-29) by [ADR-0004](../03b-repository-adr/ADR-0004-hostinger-same-origin-backend.md) — Accepted 2026-08-12; its architecture-neutral decisions carry forward |
| SDR-0002 (security decision record) | ✅ **Accepted** (2026-09-29) — [PHP + MariaDB security architecture](../security/SDR-0002-php-mariadb-security-architecture.md); authorizes no implementation |
| Data-residency answer | **Open** — now concerns the hosting location (ADR-0004 §5, trigger 3) |
| Per-milestone authorization | **None issued** — each MU milestone needs its own Sprint Assignment |

**Relationship to the controlled pilot (binding).** The approved v2.10.0 pilot runs on the **current
local, trust-based** architecture and is **unchanged** by this milestone. The pilot must never be
described as multi-user, and its audience must not be broadened on the strength of a *planned*
architecture. The recommendation is that the pilot **proceeds as approved, in parallel** with this
governance track — it de-risks the multi-user work by surfacing domain defects while they are still
cheap to fix.

**Sequencing.** Distribution-1 is recommended **before** Multi-User implementation: a multi-user client
needs runtime configuration and a deployable static bundle, so Model B is effectively a prerequisite
rather than a parallel track. ADR-0002 is **not** invalidated. *(ARCH-GOV-2: the runtime-configuration
reason lapsed with ADR-0004's same-origin API; Distribution-1 now precedes the backend for a strict CSP.)*

## Multi-User-1…8 — Shared Multi-User Implementation — **Future · not authorized**
**Theme:** building the [ADR-0004](../03b-repository-adr/ADR-0004-hostinger-same-origin-backend.md) backend — same-origin PHP + MariaDB on Hostinger.

Proposed decomposition: **MU-1** governance & backend foundation · **MU-2** authentication & identity
linkage · **MU-3** shared persistence (schema + central data-access layer) · **MU-4** server authorization & read scope ·
**MU-5** domain migration & data cutover · **MU-6** audit, backup & recovery · **MU-7** multi-user E2E
acceptance · **MU-8** cutover & decommission.

**MU-1 progress — Backend Foundation.** Phase 0 (discovery) is complete. **BF-1** (HTTP, configuration,
error contract, request ID, `GET /api/health`, logging, null identity seam, boundary tool, backend tests
and CI) is implemented as source only — no database, authentication, deployment or
frontend change. **BF-2** is split in two: **BF-2A** (data layer, transactions, MariaDB CI) is
implemented as source only, with no table or migration; **BF-2B** (migration runner, `schema_migrations`,
`/api/ready`) is implemented as source only, with zero production migrations. **BF-3** is split in
four: **BF-3A** (auth schema `0001`–`0006`, password verification, database sessions, authoritative
principal, route-level session resolution, login / logout / me, CSRF, login rate limiting, security
events) is implemented as source only — not deployed, not production-ready, no frontend change;
**BF-3B** (account lifecycle: migrations `0007`–`0008`, operator CLI `create-ceo` bootstrap and
break-glass `reset-credentials`, one-time activation, password change, logout-all, lifecycle events and
throttling — self-service plus operator CLI only, no HTTP account administration) is implemented as
source only on the same terms; **BF-3C** (server Policy/ACTIONS and authoritative authorization and data
scope — the start of the MU-4 work: the 20 ACTIONS with CI parity to the frontend, default-deny Policy,
principal-derived Scope, action-aware routes, migrations `0009`–`0010` for the employee authorization
anchor and binding FK *(owner decision D-C1 = A, 2026-09-30)*, the scoped data layer and the first
hostile-principal suite, over the anchor) is implemented as source only on the same terms, with no
production business endpoint; **BF-3D** (password recovery and governed mail — migrations
`0011`–`0013`, forgot/reset endpoints, the provider-neutral mail boundary with the Resend HTTPS adapter,
the database outbox and cron worker; *owner decisions D-D1 and D-D3, 2026-10-01, recorded in SDR-0003,
which resolves SDR-0002 O5*) is implemented as source only on the same terms, backend only, with no
provider account or real mail; **BF-4a1** (the server Employee record — migrations `0014`–`0017` for the employee
profile and the append-only business audit trail, CEO list, scoped read, versioned create/update and soft archive
under the existing employee ACTIONS; *owner decisions D-AFI4-1 = B, D-AFI4-2 = A, D-BF4a-1/2/3 = B, 2026-10-01*)
is implemented as source only on the same terms, backend only. **BF-4a2** (Employee account administration under
the CEO-only `account.manage` ACTION — provision, reissue activation, disable, enable — with activation through the
governed outbox; *SDR-0004, owner decision C1 = A, 2026-10-01*) is implemented as source on the same terms; ACTIONS
become 21. **BF-4a3** (the CEO-only `accountManageable` projection) and the authenticated Employee workspace
**AFI-4a1–AFI-4a3** followed, and **AFI-4a is CLOSED** as one Employee capability (owner acceptance 2026-10-02;
canonical merge `f545733b`, source only, not deployed). The next domain is **Overtime** — BF-4b1 → AFI-4b1 (the
non-money workflow), then BF-4b2 → AFI-4b2 (valuation and approval) *(owner decisions D-BF4b-1 = A, D-BF4b-2 = A,
2026-10-02; the valuation inputs D-BF4b-3 and the exact-decimal method D-BF4b-4, deferred to BF-4b2 Phase 0, are decided = A
on 2026-10-03)*. **BF-4b1** (the
non-money overtime record and workflow — migrations `0020`–`0021`, a required-month list, Draft create / update / hard
delete and submit / review / reject under the existing overtime ACTIONS; *D-BF4b1-1/2/3 = A, D-BF4b-5 = A, D-BF4b-6 = A*)
is merged as source (PR #40, canonical `9fbdd448`), backend only; it extends the hostile-principal suite to
overtime. **AFI-4b1** (its SESSION frontend — an Overtime section of the SESSION workspace; *D-AFI4b1-1/2/3 = A*,
D-AFI4b1-3 being the one route-scoped `employeeId` target selector on Overtime create, never authority) is merged
as source (PR #41, canonical `77332ca2`), frontend only. **BF-4b2** (server-authoritative valuation and approval —
Reviewed → Approved under the existing `overtime.manage`, the fixed internal method `TAM-OT-1`, exact integer
arithmetic, a CEO preview plus an `expectedAmount` guard, an immutable snapshot, migrations `0022`–`0023`;
*D-BF4b-3/4 = A, D-BF4b2-1..5 = A*) is merged as source (PR #42, canonical `78ec019d`), backend only, with no payroll
or finance effect. **AFI-4b2** (its SESSION frontend — the CEO's preview and approval of exactly that preview, the
frozen valuation for the CEO and the owner, never a preview for an Employee; *D-AFI4b2-1 = A, D-AFI4b2-2 = A*) is
merged as source (PR #43, canonical `58e1127a`), frontend only. BF-4b2 and AFI-4b2 must be deployed together; Overtime is
complete as source. The next domain is **Payroll** (*owner decisions D-PAY-1..6 = A, 2026-10-03*), split into BF-4c1 →
BF-4c2. **BF-4c1** (the payroll plan: migrations `0024`–`0026`, Base Salary + the frozen Approved Overtime amounts only,
generate and Draft recalculation, the pre-commit lifecycle and CEO reads under the existing `payroll.manage`; no Commit,
no Employee read, no finance, no statutory payroll) is merged as source (PR #44, canonical `ff53e7b4`), backend only; Commit,
the Employee's own Committed read and the MU-4 privacy proof are BF-4c2. **AFI-4c1** (the CEO's SESSION Payroll section
over BF-4c1 — month list, detail, Prepare payroll with named exclusions, the pre-commit lifecycle; exact server money
strings, Committed display-only; *D-AFI4c1-1..4 = A*) is merged as source (PR #45, canonical `6834a572`), frontend only.
**BF-4c2** (Commit — Ready → Committed, an immutable obligation under the existing `payroll.manage`, idempotent on an
SDR-0002 §10 key stored on the plan, guarded by `expectedTotal` and the drift guard; the CEO drift read; the Employee's
read of their own Committed plans and the MU-4 privacy proof; migrations `0027`–`0028`; *D-BF4c2-1..4 = A*) is merged as
source (PR #46, canonical `df15b41a`), backend only. **AFI-4c2** (the CEO's Commit payroll — one
intent, the exact server total, a Web Crypto key, a re-read after an unknown outcome and a deliberate same-key Retry commit —
the drift explanation, and the Employee's My payroll; *D-AFI4c2-1..3 = A*) is merged as source (PR #47, canonical
`0ae3ef82`), frontend only. AFI-4c2 needs BF-4c2 deployed first or with it; neither is deployed. Supplemental Payroll
follows (*D-SPAY-1..4 = A, 2026-10-05*), split into BF-4d → AFI-4d. **BF-4d** (a separate document settling Approved
overtime of a month that the employee's Committed base plan does not contain — late overtime only, never another payroll
component; the canonical Payroll lifecycle with an idempotent Commit under the existing `supplemental.manage`; the
Employee's read of their own Committed documents; migrations `0029`–`0031`) is merged as source (PR #48, canonical merge
`ab5e10c1e02a251e701c05c52574a8c86d838120`), backend only, not deployed. **AFI-4d** (the CEO's Supplemental payroll on the Payroll month page —
eligibility, Prepare, the month's documents and their detail, the linear lifecycle with no Draft → Ready, Commit with one
intent and a same-key Retry — and the Employee's own Committed documents as separate rows of My payroll; *D-AFI4d-1..2 = A*)
is merged as source (PR #49, canonical merge `152eccab1973db28b9e86f87d9959aa507b0b5fe`), frontend only, not deployed; it needs BF-4d deployed first
or with it. Finance posting follows (*D-FIN-1..5 = A, 2026-10-06*). **BF-4e** (one immutable, Planned Finance posting made
from exactly one Committed base plan or Committed Supplemental document, by an explicit CEO command per obligation —
never on Commit — under the Action of its source domain, `payroll.manage` or `supplemental.manage`, idempotent on an
SDR-0002 §10 key, at most one posting per source, CEO-only reads, no execution, payment, account, category, monthly plan,
reversal or correction; migrations `0032`–`0033`) is merged as source (PR #50, canonical merge `e6ce440c1ea1e71d2d921a1119543592f4113d56`), backend only, not deployed.
**AFI-4e** (the CEO's SESSION posting of a Committed plan or Committed Supplemental document from its own Payroll detail —
"Not posted to Finance" / "Posted to Finance — Planned, not paid", one confirmed command per obligation at the source's own
amount, one intent and a same-key "Retry posting", no Finance screen, nothing for an Employee, no execution; *D-AFI4e-1..5 =
A, 2026-10-06*) is merged as source (PR #51, canonical merge `d5a5fad1783e42f0f75b8e692aa05af7fd1837f6`), frontend only,
not deployed. It needs the Finance posting routes deployed first or with it. Finance execution follows (*D-FEX-1..8 = A,
2026-10-07*). **BF-4f** (a separate, immutable execution record that one Planned posting was paid in full outside TAM OS —
the posting stays Planned; exactly one execution per posting at the posting's own amount; a required date no later than
today in the Asia/Jakarta calendar and a closed-list payment method; one explicit CEO command per posting under the existing
`finance.execute` with full-body idempotent replay; CEO-only reads; no partial payment, reversal, correction,
reconciliation, company account or bank integration; migrations `0034`–`0035`) is merged as source (PR #52, canonical
merge `171392a16800c85e128c178f934d72c96a6255be`), backend only, not deployed. **AFI-4f** (the CEO's SESSION "Record
payment" inside the Finance card of a posted Committed plan or Supplemental document — a display-only posting amount, a
required Date paid and Payment method, one frozen intent with a same-key "Retry recording", "Payment recorded — paid
outside TAM OS"; TAM OS moves no money; details only, nothing for an Employee; *D-AFI4f-1..8 = A, 2026-10-07*) is merged as
source (PR #53, canonical merge `a39b728f00688fb27e5983422c878a2f933b0e37`), frontend only, not deployed. It needs the Finance
execution routes deployed first or with it. The audit/backup step follows (*Audit & Backup Phase 0, D-AB-1..16 =
recommended, 2026-10-07*: separate slices OPS-1 → OPS-2 → BF-4g → optional AFI-4g). **OPS-1** (encrypted database backups as
operator tooling — `server/bin/backup.php create | status | verify | keygen`: one read-only snapshot of every classified table
with the security state excluded, a manifest of counts, digests and exact money totals, libsodium encryption to a host
public key whose secret key stays off-host, atomic publication, host retention of 7, and an off-host audit-continuity check;
no route, UI, Action, migration or package change) is merged as source (PR #54, canonical merge
`f48f5f127581655a68bec7d0e065cbefb8e88a74`), not deployed. **OPS-2** (restore into an empty, migrated database —
`server/bin/backup.php restore | verify-restore`, off-host only (*D-OPS2-1 = A, 2026-10-07*: the secret key never reaches the
host; a production database only over an SSH tunnel), verifying the whole backup first, replaying it in one transaction
through the same verifier and parser, proving the target against the manifest before commit and again on a fresh
connection after it; a production target needs a production backup and a typed confirmation; no route, UI, Action, migration
or package change) is merged as source (PR #55, canonical merge `3732dfdca61b91aa6beba33d77f72b8224fdaa60`), not deployed. The
restore rehearsal (SDR-0002 E7, D-AB-14) stays open until a real off-host restore of an actual host backup passes, before
PILOT-1. **BF-4g** (the CEO audit read API — `GET /api/audit-events?month=` in the Asia/Jakarta company calendar as a
half-open UTC window, and `GET /api/audit-events/record?entity=&id=`; the eleven stored historical fields without the
company, a 2,000-row cap failing closed, history kept for deleted records, `auth_events` not exposed; CEO-only, no Action,
migration, frontend or package change; *D-BF4g-1..4 = A, 2026-10-08*) is a local candidate on a feature branch, not
deployed; its SESSION view is the optional AFI-4g. *(Owner decision D6, 2026-09-30, re-assigned BF-3C from
recovery and mail to Policy; recovery and mail became BF-3D.)* MU-4's acceptance criterion — an
authenticated Employee cannot fetch a colleague's payroll through the raw API — becomes provable only
when payroll has a backend store; each domain migration extends the hostile-principal suite.
See `ARCHITECTURE.md` → Backend foundation, Data foundation, Authentication and sessions, Account
lifecycle, Authorization and data scope, and Password recovery and governed mail.

**MU-1 through MU-4 are additive and reversible** — the product keeps working exactly as today
throughout. **MU-5 is the first irreversible step**, and it is deliberately gated behind MU-4, whose
sole acceptance criterion is proving that an authenticated Employee **cannot** fetch a colleague's
payroll through the raw API. Confidential data does not move until the privacy boundary is proven
against a hostile client.

**Remaining prerequisites (none authorized yet):**

- SDR-0002 (PHP + MariaDB) — ✅ Accepted 2026-09-29;
- the data-residency answer;
- Distribution-1 — ✅ completed 2026-09-29 (strict-CSP deployment package; unreleased until the next version);
- the mandatory pre-deployment host verifications in [`DEPLOYMENT.md`](../DEPLOYMENT.md) §8;
- a per-milestone Sprint Assignment.

The host is settled: frontend and backend both on the existing Hostinger Premium Web Hosting at
`finance.reliabilityindonesia.com`, with the cutover gate in [`DEPLOYMENT.md`](../DEPLOYMENT.md) §8.
**No VPS and no managed backend service are required.** "Acting as" is removed
from production only after authenticated E2E passes, with no automatic CEO/Employee fallback (see
[`ARCHITECTURE.md`](../../ARCHITECTURE.md), security boundary).

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
