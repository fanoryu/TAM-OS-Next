# RDR-003 — Delta Repository Snapshot

| Field | Value |
|---|---|
| **Record** | RDR-003 |
| **Title** | Delta Repository Snapshot |
| **Status** | Accepted |
| **Codename** | The Record |
| **Season / Sprint / PR** | SPR-063 · PR-6B |
| **Author** | Forge (engineering) |
| **Accountable approver** | Atlas — Chief Technology Officer |
| **Founder** | Approved |
| **Distribution** | Forge · Repository |
| **Date created** | 2026-08-02 |
| **Snapshot commit** | `851c038ddb06be44b974e88227109ce51519cdcb` |
| **Branch** | `main` |
| **Supersedes** | [RDR-001](RDR-001-gamma-repository-snapshot.md) (as the current authoritative baseline) |
| **Superseded by** | — |
| **Related** | [GHA-001](../../audit/github-audit-2026-08-02/GHA-001-github-repository-comprehensive-audit.md), [SDR-0001](../security/SDR-0001-codeql-baseline-disposition.md), [Architecture Evolution Backlog](../02-architecture/Architecture_Evolution_Backlog.md) (ARCH-006, ARCH-007) |

> **Purpose.** This Repository Decision Record freezes the factual state of `main` at the close of the
> first Platform boundary (PR-6A "The Gateway") and the opening of Milestone Delta. It records **what
> exists** — it authorizes no work and plans no future. It is the **current authoritative baseline**
> and supersedes [RDR-001](RDR-001-gamma-repository-snapshot.md) (Gamma) in that role. RDR-001 remains
> in place, read-only, as the Gamma boundary record.

---

## 1. Baseline Facts

| Fact | Value | Source of truth |
|---|---|---|
| Snapshot commit | `851c038…` | `git rev-parse HEAD` |
| Branch | `main` | — |
| APP_VERSION | `2.7.3` | `js/core/constants.js:29` |
| APP_RELEASE_NAME | `Supplemental-Aware Payroll History` | `js/core/constants.js:30` |
| SCHEMA_VERSION | `6` | `js/core/constants.js:35` |
| Portable build | `dist/tam-intelligence-os-v2.7.3.html` (861,072 bytes) | version-derived filename |
| Verifier | 695 checks passing | `node tools/verify-build.js` |
| Build | deterministic; rebuild byte-identical to committed dist | — |

These facts were independently confirmed by [GHA-001](../../audit/github-audit-2026-08-02/GHA-001-github-repository-comprehensive-audit.md).

## 2. Operational Surface

The repository exposes **two distinct surfaces** that answer **two different architectural questions**.
Neither figure replaces the other; both are accurate.

### 2.1 Aggregate-backed operational surface — migrated Domain authority

These are the operations whose write authority has been migrated behind an explicit Domain **aggregate
boundary**. This is the "how much authority has the Domain layer actually taken over?" figure.

```
7 Aggregates
7 Aggregate-backed Commands
1 Aggregate-backed Query
```

| Kind | Id | Boundary aggregate | Handler | Introduced |
|---|---|---|---|---|
| Query   | `employee.filtered`             | —                             | `employeesFiltered`          | PR-5B |
| Command | `employee.contact.update`       | `EmployeeContactAggregate`    | `updateEmployeeContact`      | PR-5D |
| Command | `employee.employment.update`    | `EmployeeEmploymentAggregate` | `updateEmployeeEmployment`   | PR-5E |
| Command | `employee.lifecycle.transition` | `EmployeeLifecycleAggregate`  | `transitionEmployeeLifecycle`| PR-5G |
| Command | `employee.compensation.update`  | `EmployeeCompensationAggregate`| `updateEmployeeCompensation`| PR-5H |
| Command | `contract.dates.update`         | `ContractDateAggregate`       | `updateContractDates`        | PR-5I |
| Command | `payroll.lifecycle.transition`  | `PayrollLifecycleAggregate`   | `transitionPayrollLifecycle` | PR-5J |
| Command | `contract.status.transition`    | `ContractStatusAggregate`     | `transitionContractStatus`   | PR-5K |

The "7 aggregates" are the seven boundary aggregates in that table. This count is **verifier-enforced**.

### 2.2 Total registered executable surface — full registry

The frozen Domain registries (`js/domain/commands.js`, `js/domain/queries.js`) register more ids than
are aggregate-backed. Every registered id is executable via `Domain.command` / `Domain.query`. This is
the "what is the full command/query contract exposed by the Domain facade?" figure.

```
13 Registered Commands
4 Registered Queries
```

- **13 registered commands** = the 7 aggregate-backed commands above **plus** 6 handler-only /
  descriptive commands: `payroll.commit`, `finance.execute`, `supplemental.generate`,
  `supplemental.transition`, `supplemental.post`, `audit.log`.
- **4 registered queries** = `employee.filtered` **plus** `payroll.totalCompensation`,
  `payroll.historicalSnapshot`, `audit.events`.

Handler-only / descriptive operations document an existing handler routed through the facade **without**
an aggregate gate. They are not aggregate-backed authority; they are the pre-existing operational and
read paths. See §5 (Residual Authority) for the write paths that remain outside a boundary.

### 2.3 Reading the two figures

- **7 / 7 / 1** answers: *how much write authority has migrated behind a Domain aggregate boundary?*
- **13 / 4** answers: *what is the total registered, executable Domain surface?*
- Both are true simultaneously. A statement that quotes only "7 commands" is describing aggregate-backed
  authority, not the full executable surface, and should say so.

The descriptive/aggregate distinction is documented in
[`Command_Query_Model.md`](../02-architecture/Command_Query_Model.md).

## 3. Platform Layer

Milestone Delta established the first Platform boundary: the **Application Gateway**
(`js/platform/application-gateway.js`, PR-6A "The Gateway", contract SRD-062A).

- **1 Application Gateway**, exposing a single `execute(request)` entry point.
- The Gateway is **business-blind**: no business rules, no persistence, no history, no rollback, no
  registry duplication. It never calls aggregates or handlers directly; it delegates to the Domain
  facade and returns the Domain result verbatim.
- The Domain layer has **no dependency** on the Platform layer (one-way dependency, verifier-enforced).
- The Gateway is currently **dormant**: no application path invokes it yet. This is intentional for a
  boundary-only PR; wiring a caller (a transport adapter) is future, separately-authorized work.

### 3.1 Gateway envelope semantics (ATR-004) — intentional, not a defect

The Gateway response envelope deliberately carries **two independent success signals**:

```json
{ "ok": true, "result": { "success": false } }
```

- `ok` reports **Gateway boundary execution** — whether the request was structurally valid and
  delegation completed without a structural/transport fault.
- `result.success` reports the **Domain business outcome** — whether the business operation succeeded.

These fields answer different questions and are **not** to be normalized into one. A structurally valid
request that delegates to a Domain operation which then rejects the business input correctly yields
`{ ok: true, result: { success: false } }`. This is the ATR-004 decision and is recorded here as
**intentional**. (GHA-001 finding M-4 flags this only as a future consideration for a transport/REST
adapter, not as a current defect.)

## 4. Security Posture

CodeQL runs on push, pull request, and a weekly schedule. At this snapshot there are **5 open alerts and
1 fixed alert**, all part of the documented baseline; **no new alert was introduced by the Domain or
Platform work** in Delta.

All open alerts are **already dispositioned** in
[SDR-0001](../security/SDR-0001-codeql-baseline-disposition.md) (Accepted, Atlas-approved):

| GitHub alert | Rule | Location | SDR-0001 disposition |
|---|---|---|---|
| #1 | `js/insecure-randomness` | `js/core/onboarding-reset.js:146` | **False Positive** (FP-1) |
| #2 | `js/insecure-randomness` | `js/finance/execution-center.js:222` | **False Positive** (FP-1) |
| #3 | `js/insecure-randomness` | `js/ui/settings-about.js:426` | **False Positive** (FP-1) |
| #4 | `js/incomplete-multi-character-sanitization` | `js/analytics/reports.js:89` | **False Positive** (FP-2) |
| #5 | `js/clear-text-storage-of-sensitive-data` | `js/ui/activity-log.js:31` | **Accepted Risk** (AR-1); dismissed in GitHub per SDR-0001 §7 |

> **Correction of record.** GHA-001 finding M-1 stated alerts #1–4 "lack a recorded disposition." That
> was imprecise: SDR-0001 §4/§6 **already** dispositions all four (FP-1, FP-2), deliberately leaving
> them **open and undismissed** so the baseline stays honest (SDR-0001 §7.4). The only outstanding
> difference is dismissal *state* (only #5 is dismissed). No new security disposition record is required
> or created by SPR-063; SDR-0001 remains the single source of truth. Alerts remain **open** — this
> record does not claim security is "fully clean" while alerts are open; it records that the open alerts
> are classified, non-exploitable in the current architecture, and self-expiring at their SDR review
> date (2027-08-01).

The disposition is conditional on the current client-only, no-backend architecture (SDR-0001 §8). A
backend, authentication, or storage redesign would reopen several classifications.

## 5. Residual Authority

Direct-write authority that remains **outside** a Domain aggregate boundary is **documented technical
debt, not a defect and not authorization to migrate it in this PR**. It is recorded in the
[Architecture Evolution Backlog](../02-architecture/Architecture_Evolution_Backlog.md):

- **ARCH-003 / ARCH-004** — legacy Employee compensation and Contract-date editors (pre-existing).
- **ARCH-006** — Contract full-editor status assignment and Contract renewal status assignment.
- **ARCH-007** — Supplemental lifecycle, Payroll/Overtime, and monthly-plan legacy mutation paths.

Two constraints are recorded explicitly (ARCH-006):

- Contract **renewal** must **not** be routed into the generic `contract.status.transition` command.
- `Renewed` remains **renewal-only**; a future compound-renewal or dedicated lifecycle authority is
  required before consolidating it.

## 6. Repository State at Snapshot

- **Branches:** `main` only on the remote (`origin/main`); no stale remote feature branches.
- **Pull requests:** #1–#21 all merged except #6 (closed, legitimately superseded by #8). No open PRs.
- **Releases / tags:** `v2.6.6` → `v2.7.3`; latest release `v2.7.3`. **No new release or tag was created
  by PR-6A** (or by this documentation PR). Prior releases and tags exist and are unchanged — this
  snapshot does not imply the repository has never had a release or tag.
- **Working tree:** clean; deterministic build; 695 verifier checks passing; dist boots with zero
  console errors (GHA-001 §16).

## 7. Supersession

RDR-003 supersedes [RDR-001](RDR-001-gamma-repository-snapshot.md) as the **current authoritative
repository baseline**. RDR-001 stays in place as the immutable Gamma-boundary snapshot (6 aggregates, 6
commands, 1 query) and links forward to this record via the [RDR register](README.md). No governance
document should describe RDR-001 as the latest baseline after this record is Accepted.

---

*RDR-003 is a factual snapshot. It changes no code, no version, no schema, and no CodeQL configuration,
and it authorizes no work. It is proposed for Atlas CTO review.*
