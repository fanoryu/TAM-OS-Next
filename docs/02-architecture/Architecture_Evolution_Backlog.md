# Architecture Evolution Backlog

The authoritative register for **non-blocking** architecture evolution items — observations worth
resolving deliberately, later, with evidence. An entry here is a question the project has chosen to
hold open, not a problem it is ignoring.

> **What an ARCH item is — and is not.** Every item below is:
> - **non-blocking** — it does not block any merge, release, or current work;
> - **not a defect** — the current implementation is correct and intentional;
> - **not an accepted architecture decision** — nothing here has been decided;
> - **not implementation authorization** — no ARCH item permits code changes on its own.
>
> An item becomes actionable only when a Sprint Assignment authorizes it, typically after its paired
> Proposed ADR is evaluated and Accepted. Until then it is a recorded intention to think, not to build.

## Status legend

- **Planned** — recorded for future evaluation; no decision, no authorization.
- **Under Review** — actively being evaluated (e.g. via its Proposed ADR).
- **Resolved** — closed by an Accepted ADR or a deliberate decision to take no action.

## Register

| ID | Title | Status | Paired ADR |
|---|---|---|---|
| [ARCH-001](#arch-001--aggregate-entry-contract) | Aggregate Entry Contract | Planned | [ADR-008](../03-adr/ADR-008-Aggregate-Entry-Contract.md) (Proposed) |
| [ARCH-002](#arch-002--employment-vs-lifecycle-responsibility) | Employment vs Lifecycle Responsibility | Planned | [ADR-009](../03-adr/ADR-009-Employment-vs-Lifecycle-Responsibility.md) (Proposed) |
| [ARCH-003](#arch-003--compensation-write-authority) | Compensation Write Authority | Planned | [ADR-010](../03-adr/ADR-010-Compensation-Write-Authority.md) (Proposed) |
| [ARCH-004](#arch-004--contract-date-model-authority) | Contract Date Model Authority | Planned | [ADR-011](../03-adr/ADR-011-Contract-Date-Model-Authority.md) (Proposed) |
| [ARCH-005](#arch-005--contract-overlap-enforcement) | Contract Overlap Enforcement | Planned | [ADR-012](../03-adr/ADR-012-Contract-Overlap-Enforcement.md) (Proposed) |
| [ARCH-006](#arch-006--contract-status--renewal-write-authority) | Contract Status & Renewal Write Authority | Planned — **scope narrowed by [ARCH-008](#arch-008--contract-authority-reconciliation-addendum)** | — |
| [ARCH-007](#arch-007--legacy-lifecycle-mutation-paths) | Legacy Lifecycle Mutation Paths | Planned | — |
| [ARCH-008](#arch-008--contract-authority-reconciliation-addendum) | Contract Authority Reconciliation Addendum (narrows ARCH-006) | Planned | — |

---

## ARCH-001 — Aggregate Entry Contract

**Status:** Planned

### Context
PR-5G introduced metadata-driven aggregate routing. A command may now declare, in its registry entry,
which method the boundary aggregate exposes and which key carries the sanitized payload:

- `boundaryMethod` — the aggregate's decision method (defaults to `prepare`).
- `boundaryPayload` — the key on the decision object holding the sanitized handler input (defaults to
  `patch`).

Today two shapes exist: `EmployeeContactAggregate` and `EmployeeEmploymentAggregate` expose
`prepare(id, patch)` returning `{ ok, patch }`; `EmployeeLifecycleAggregate` exposes
`transition(id, transition)` returning `{ ok, transition }`.

### Objective
Define a consistent public entry contract for future aggregates, so method naming and payload shape
are principled rather than incidental.

### Questions to resolve
- When an aggregate should expose `prepare()`.
- When an aggregate should expose `transition()`.
- Whether other entry methods are permitted, and under what criteria.
- How command metadata should identify the entry method and the returned payload.

### Constraints
- No speculative framework.
- Preserve explicit, domain-focused aggregate business language.
- Preserve backward compatibility (existing routing must remain unchanged).
- Require evidence from additional aggregate implementations before any broader abstraction.

Evaluated in [ADR-008 (Proposed)](../03-adr/ADR-008-Aggregate-Entry-Contract.md).

---

## ARCH-002 — Employment vs Lifecycle Responsibility

**Status:** Planned

### Context
Both `EmployeeEmploymentAggregate` (via `employee.employment.update`) and
`EmployeeLifecycleAggregate` (via `employee.lifecycle.transition`) can affect `employmentStatus`. The
employment command may set `employmentStatus` to any value in `EMPLOYMENT_STATUSES`; the lifecycle
command applies a narrow, validated state machine (`Active ↔ Resigned`, `Active ↔ Terminated`). This
overlap is intentional and correct as shipped, but the authoritative boundary for status changes is
not yet decided.

### Objective
Clarify the authoritative boundary for lifecycle status changes.

### Questions to resolve
- Whether `employmentStatus` changes must occur only through `employee.lifecycle.transition`.
- Whether `EmployeeEmploymentAggregate` should retain a limited status-edit capability.
- How `Inactive` and `On Leave` should relate to lifecycle transitions.
- Whether existing UI paths require a staged migration.

### Constraints
- No behavior change inside PR-5G.
- No retroactive scope expansion.
- Preserve existing runtime until a separately authorized decision is implemented.

Evaluated in [ADR-009 (Proposed)](../03-adr/ADR-009-Employment-vs-Lifecycle-Responsibility.md).

---

## ARCH-003 — Compensation Write Authority

**Status:** Planned

### Context
PR-5H introduced `EmployeeCompensationAggregate` as the controlled Domain path for `monthlyBaseSalary`
updates, via `employee.compensation.update`. The legacy full Employee editor (`openEmployeeModal`) can
still write `monthlyBaseSalary` directly, outside the aggregate gate. Both paths are correct and
intentional as shipped; this item records the open question of which one is authoritative.

### Objective
Determine the authoritative write path for Employee compensation.

### Questions to evaluate
- Should `monthlyBaseSalary` be writable **only** through `employee.compensation.update`?
- Should the legacy Employee editor stop writing salary directly?
- How should any migration occur without runtime regression?
- What business meaning distinguishes `null` from `0` for `monthlyBaseSalary`?
- Should compensation history eventually include the previous and new values (it currently records
  neither)?

### Constraints
- No runtime change.
- No UI migration.
- No implementation authorization.
- Preserve existing behavior.

**ARCH-003 is Planned, non-blocking, not a defect, and not implementation authorization.**

Evaluated in [ADR-010 (Proposed)](../03-adr/ADR-010-Compensation-Write-Authority.md).

---

## ARCH-004 — Contract Date Model Authority

**Status:** Planned

### Context
PR-5I confirmed (via the SPR-049 architecture incident) that the authoritative Contract model stores
`startDate` and `durationMonths`, while `endDate` remains **derived** through the existing Contract
calculation semantics (`contractCalc`). PR-5I introduced `contract.dates.update` as a controlled
Domain path over those stored facts. The legacy full Contract editor (`openContractModal`) can still
write `startDate` and `durationMonths` directly, outside the aggregate gate. Both paths are correct
and intentional as shipped.

### Objective
Establish the permanent authoritative Contract date model.

### Questions to evaluate
- Should all Contract date edits route exclusively through `contract.dates.update`?
- Should the legacy Contract editor stop mutating stored date fields directly?
- Should `endDate` remain permanently derived?
- Should any future UI expose `endDate` as editable (and, if so, how without a second source of truth)?

### Constraints
- No runtime change.
- No UI migration.
- No implementation authorization.
- Preserve current behavior.

**ARCH-004 is Planned, non-blocking, not a defect, and not implementation authorization.**

Evaluated in [ADR-011 (Proposed)](../03-adr/ADR-011-Contract-Date-Model-Authority.md).

---

## ARCH-005 — Contract Overlap Enforcement

**Status:** Planned

### Context
PR-5I intentionally preserved existing overlap behavior: a read-only detector
(`overlappingActiveContracts`) surfaces informational warnings, but no overlap policy exists inside
the Domain. `contract.dates.update` does not reject overlapping date updates and does not touch
sibling Contracts.

### Objective
Determine whether Contract overlap becomes Aggregate validation, a Domain Policy, or remains a UI
warning only.

### Questions to evaluate
- Should overlap **reject** updates, or remain informational?
- If enforced, how should self-overlap exclusion work (a Contract must not overlap "itself")?
- Which layer owns overlap enforcement — the aggregate, a dedicated policy, or the UI?
- What is the authoritative scope of an overlap (per employee, per active status, month-range)?

### Constraints
- No runtime change.
- No overlap engine.
- No implementation authorization.

**ARCH-005 is Planned, non-blocking, not a defect, and not implementation authorization.**

Evaluated in [ADR-012 (Proposed)](../03-adr/ADR-012-Contract-Overlap-Enforcement.md).

---

## ARCH-006 — Contract Status & Renewal Write Authority

**Status:** Planned — active residual scope **narrowed by [ARCH-008](#arch-008--contract-authority-reconciliation-addendum)**

> **Forward pointer (added by ARCH-008, 2026-08-04).** Everything below is **retained verbatim as
> historical evidence** and is accurate as of the state it recorded. One of the two write paths it
> names — Contract renewal — has since been closed by the shipped compound renewal path, and the
> record's scope has proven narrower than the residual actually is. **[ARCH-008](#arch-008--contract-authority-reconciliation-addendum)
> governs the current interpretation.** Read this entry for history; read ARCH-008 for present scope.

### Context
PR-5K introduced `ContractStatusAggregate` via `contract.status.transition` as the controlled Domain
path for Contract status transitions. Two write paths still assign Contract status **outside** that
aggregate gate, and both are correct and intentional as shipped:

- **Full Contract editor** (`js/people/contracts.js:146`) — `rec.status = fd.get('status')` sets status
  directly when the full editor is saved.
- **Contract renewal** (`js/people/contracts.js:262`) — `c.status = 'Renewed'` marks the source contract
  as renewed while creating its successor.

This is the same residual-authority pattern already recorded for compensation (ARCH-003) and contract
dates (ARCH-004): a controlled aggregate path coexists with a legacy editor path. It is **documented
technical debt, not a defect, and not authorization to migrate it here.**

### Objective
Determine the permanent authoritative write path for Contract status, and how renewal relates to it.

### Questions to evaluate
- Should Contract status edits from the full editor route exclusively through
  `contract.status.transition`?
- Should the legacy Contract editor stop writing `status` directly?
- How should any migration occur without runtime regression?

### Constraints (recorded decisions)
- **Contract renewal must NOT be routed into the generic `contract.status.transition` command.** Renewal
  is a compound operation (mark source `Renewed` **and** create a successor contract); the generic
  status transition models neither the linkage nor the successor creation.
- **`Renewed` remains renewal-only** — it is not a general transition target and must not be reachable as
  an ordinary status change.
- Any future consolidation requires a **compound renewal command** or a **dedicated renewal/lifecycle
  authority**, evaluated on its own, before the renewal path is migrated.
- No runtime change, no UI migration, no implementation authorization in this record.

**ARCH-006 is Planned, non-blocking, not a defect, and not implementation authorization.**

---

## ARCH-007 — Legacy Lifecycle Mutation Paths

**Status:** Planned

### Context
Several operational engines predate the aggregate boundaries and still mutate lifecycle status directly.
They are correct and intentional as shipped, and are the pre-existing operational paths behind the
descriptive (handler-only) registry entries (see [RDR-007 §2](../99-archive/RDR/RDR-007-delta-repository-snapshot.md#2-operational-surface-unchanged-since-rdr-003)):

- **Supplemental lifecycle** — `js/people/supplemental-engine.js` (e.g. `:236` `Posted`, `:273`
  `Executed`, `:310` rollback to `Approved`). Registered descriptive commands (`supplemental.generate` /
  `.transition` / `.post`) exist, but the engine still writes status directly.
- **Payroll & Overtime** — `js/people/payroll-ops-engine.js` (`:446`/`:452`/`:458`) sets `Committed` /
  `Committed to Payroll`; `js/people/overtime.js` (`:142`/`:423`) sets overtime status.
  *(Corrected, SPR-078: the former `js/people/payroll-planning.js` entry is withdrawn. That path was
  unreachable dead code and was retired; it additionally wrote a non-canonical lowercase `'committed'`
  payroll status, which this entry never recorded. `commitReadyPayroll` is now the sole live Payroll
  posting path.)*
- **Monthly plan** — `js/people/monthly-plan.js` (`:74` `Committed`, `:136` `Reviewed`).

### Objective
Record these as known residual authority to be evaluated when their aggregates are introduced — not to
migrate now.

### Constraints
- No runtime change.
- No implementation authorization.
- Committed payroll and posted finance remain immutable (`CLAUDE.md` §8, §9); any future migration must
  preserve that invariant.

**ARCH-007 is Planned, non-blocking, not a defect, and not implementation authorization.**

---

## ARCH-008 — Contract Authority Reconciliation Addendum

**Status:** Planned
**Relationship:** narrowing addendum to [ARCH-006](#arch-006--contract-status--renewal-write-authority)
**Evidence baseline:** `main` @ `d4c00179b71ea4564df2fb67d90824d3f31c2285`, 2026-08-04 —
`APP_VERSION` 2.8.4, `SCHEMA_VERSION` 6, verifier 1443 checks, runtime harnesses 781 checks.

### 1. Relationship to ARCH-006

ARCH-006 is **retained as historical evidence and is not rewritten**. It was accurate when written; it
is not treated here as having been wrong. Two things have since changed:

- One of the two write paths it named — **Contract renewal** — was closed by a shipped implementation
  that satisfied the very constraint ARCH-006 recorded (see §3).
- Its scope proved **narrower than the residual actually is**: ARCH-006 frames the residual as a
  *status* concern, whereas the full editor writes considerably more than status (see §4).

ARCH-008 therefore **narrows and updates the active residual scope** of ARCH-006 and **governs the
current interpretation going forward**. ARCH-006 remains the record of how that scope was first
identified and of the constraints that shaped the renewal solution.

### 2. Current shipped Contract write architecture

Three Contract operations are **aggregate-authoritative** — each routed through the canonical Platform
path (UI seam → `uiExecute` → Gateway → `Domain.command` → aggregate → handler → `ContractRepository`
→ `persistContracts()` → `StorageAdapter`), each returning a typed result with handler-owned rollback:

| Operation | Command | Aggregate |
|---|---|---|
| Status transition | `contract.status.transition` | `ContractStatusAggregate` |
| Date extent update | `contract.dates.update` | `ContractDateAggregate` |
| Renewal | `contract.renewal.execute` | `ContractRenewalAggregate` |

All three are operationally routed — each has a live UI caller, none is metadata-only.
`ContractRepository.save()` has exactly three call sites in `js/people/contracts.js`, one per operation
above; the verifier asserts that count.

Two Contract operations remain **direct**: the full editor save and `deleteContract` (§4, §5). Bulk
paths (Smart Import, import rollback, backup restore, demo seed, reset) write Contract records outside
the aggregate design by intent and are **not** part of the editor residual (§6).

### 3. Renewal closure

**Contract renewal is aggregate-authoritative and is no longer part of active M-5 scope.**

Verified at the evidence baseline:

- **Command** `contract.renewal.execute` (`js/domain/commands.js:53`), boundary
  `ContractRenewalAggregate`, `boundaryPayload: 'renewal'`, handler `renewContract`.
- **Sole ingress** — `requestContractRenewal()` (`js/people/contracts.js:326`) routes through
  `uiExecute('command', 'contract.renewal.execute', …)`. The renewal modal is its only caller.
  **No alternate renewal ingress exists**; no other path marks a Contract `Renewed`.
- **Business authority is the aggregate** — the predecessor's renewed status is applied from the
  aggregate-authored decision (`c.status = renewal.predecessorStatus`), not from a literal in the
  handler. The successor's business shape and both history notes are likewise aggregate-authored.
- **Repository mediation** — `ContractRepository.save()`; one write covers predecessor and successor,
  which live in the same collection.
- **Typed result** — `{ success, data:{ predecessor, successor } }`, with typed failures
  `ContractNotFound`, `RenewalNotAllowed`, `ContractAlreadyRenewed`, `PersistFailed`.
- **Rollback** — in-memory and complete on `PersistFailed`: the successor is dropped and every mutated
  predecessor field is restored.
- **Runtime evidence** — `tools/verify-renewal-runtime.js`, **67 checks**, including *"renewal succeeds
  through the canonical Platform path"*.

The ARCH-006 constraints that governed this outcome were **honoured, not bypassed**:

- Renewal was **not** routed into the generic `contract.status.transition` command. It received its own
  compound command, exactly as ARCH-006 required before any renewal migration.
- **`Renewed` remains renewal-only.** It is not an ordinary transition target and must not become one.
- Any future consolidation of renewal into another authority would need to re-satisfy both constraints.

### 4. Remaining residual — the full Contract editor

The full Contract editor save remains a **direct write path**: `js/people/contracts.js:139–153` (field
assignments at `:140–148`, `rec.status` at `:146`, `await persistContracts()` at `:152`).

> *Line numbers are accurate at the evidence baseline and must be re-verified at implementation time.*

On submit it assigns `employeeId`, `employeeName`, `contractNumber`, `startDate`, `durationMonths`,
`monthlySalary`, `status`, `notes`, schedule fields, `updatedAt`, and a `history` entry directly to the
record, then persists via `persistContracts()`. It therefore bypasses **`ContractStatusAggregate`,
`ContractDateAggregate`, and `ContractRepository`**.

This creates genuine **duplicate authority for at least three fields** that operational aggregates
already own:

- `status` — owned by `contract.status.transition`
- `startDate` and `durationMonths` — owned by `contract.dates.update`

For those three, business rules enforced by the aggregates (the legal-transition graph; date-extent
validation) are reachable through one UI route and bypassable through another.

**This record does not conclude that every editor field must become aggregate-owned.** Authority for
the remaining fields is an open question (§9, OQ-1). Notably, the narrow *Edit Contract Dates* modal
already routes correctly through `contract.dates.update`; only the full editor writes those same fields
directly.

### 5. Remaining residual — deletion

`deleteContract()` (`js/people/contracts.js:222–233`) removes a Contract from `State.contracts` and
calls `persistContracts()` directly. It is:

- outside any aggregate;
- outside `ContractRepository`;
- without a typed result contract;
- without persistence-failure rollback.

It does carry meaningful **pre-conditions** — deletion is refused when linked payroll or transactions
exist, and non-`Draft` deletion requires confirmation. Those guards are correct and are not in question.

**Whether deletion should become a canonical command is not decided here** (§9, OQ-3).

### 6. Scope boundary — bulk paths are not the editor residual

Smart Import creation, import rollback, backup restore, demo seed, and reset also write Contract records
directly. They are **batch/portability paths, outside the per-operation aggregate design by intent**,
and they are **not automatically part of an editor-authority migration**. They are recorded here only so
that "residual Contract authority" is not read as covering them.

### 7. Persistence-honesty findings — CLOSED by SPR-093

> **Current state (SPR-094, 2026-08-04). Both findings below are IMPLEMENTED and CLOSED.**
> SPR-093 landed on `main` at merge commit `e22e4c04ab66ff4541879d3e850d5c9cd41dc1cf`. The editor save
> and `deleteContract` now check the `persistContracts()` result and roll back in memory on failure, so
> neither can report success after a failed write. **They are no longer active components of M-5**
> (§8). The findings are retained below as the record of what was found and why.
>
> What SPR-093 changed, and nothing more:
> - a failed editor **create** leaves no new record;
> - a failed editor **edit** restores every mutated field, and restores `history` both in contents and
>   in prior own-property absence — a record carrying no `history` (reachable via legacy backup restore)
>   is left with none;
> - a failed **delete** restores the record at its exact original index and writes **no** activity entry;
> - failure produces failure feedback, never success feedback, and the editor modal stays open for retry.
>
> Verified by `tools/verify-contract-persistence-runtime.js` (73 checks) and by real-browser QA against
> the actual submit handler and the actual `deleteContract`, with the storage layer forced to fail.
> **SPR-093 migrated no authority** — the editor still assigns `status` directly, both paths still
> persist through `persistContracts()`, and no command, aggregate, or repository mediation was
> introduced. §4 and §5 below remain accurate as the current residual description.

Two findings surfaced during the ARCH-008 discovery that neither ARCH-006 nor the GHA records had
captured. Both are about **honest reporting on a failure path**, not about aggregate authority:

1. **Editor save can report success after a persistence failure.** `js/people/contracts.js:152`
   discards the return value of `await persistContracts()`, then unconditionally closes the modal and
   shows *"Contract created."* / *"Contract updated."* `persistHR()` returns `ok === true`, so a failed
   write is observable but unobserved.

2. **Deletion can report and log success after a persistence failure.**
   `js/people/contracts.js:230` discards the same result, then writes a `contract.delete` activity-log
   entry and shows *"Contract deleted."* — so the audit trail can record a deletion that did not persist.

Classification for both:

- **Severity: Medium.** **Non-controlling** — no release gate, no invariant breach.
- **Not data corruption.** Nothing stored is damaged; in-memory state diverges from persisted state
  until the next reload, and the user is told the wrong thing about a failed save.
- **Testable and implementation-ready**, and **separable** from the unresolved aggregate-authority
  question — a narrow fix needs no new aggregate, command, or ADR.
- The controlled paths (status, dates, renewal) already handle this correctly via strict
  `persisted.ok !== true` checks and rollback; this is the same class of gap SPR-079 closed for
  `saveAllData`.

*(Historical note, accurate when ARCH-008 was published: "**Recorded, not implemented.** ARCH-008 does
not fix, schedule, or authorize fixing them." Both were subsequently implemented by SPR-093 under its
own sprint authorization — see the current-state box at the head of this section.)*

### 8. Narrowed M-5 scope and status

**Active M-5 consists of exactly three items — all of them AUTHORITY questions:**

1. Full Contract editor direct authority over fields that **overlap existing aggregates** (`status`,
   `startDate`, `durationMonths`).
2. **Undefined authority** for the remaining non-aggregate editor fields (OQ-1).
3. Direct **deletion** authority (OQ-3).

**Explicitly excluded from M-5:**

- **Persistence honesty** — closed by SPR-093 (§7). It was never an authority question; it is no longer
  an M-5 component in any form.
- **Contract renewal** — closed (§3).
- **Bulk paths** — Smart Import, restore, seed, reset (§6).
- M-5 is **not** "all Contract writes." Three of the six single-record Contract operations are already
  aggregate-authoritative.

| Attribute | Value |
|---|---|
| Status | **Requires additional discovery** |
| Severity | **Medium** |
| Controlling | **No** |
| Implementation readiness — editor-authority migration | **Domain preparation ready** (OQ-1 closed by ADR-014); **editor routing still blocked on OQ-2** |
| Persistence-honesty gaps | **Closed** — implemented by SPR-093, no longer in scope |
| Field ownership (OQ-1) | **Closed** — decided by [ADR-014](../03-adr/ADR-014-Contract-Core-Field-Authority.md) (Accepted) |

M-5 is **not** Closed, Ready, Accepted, or Scheduled. What remains is entirely the unresolved
ownership question: which authority should own the editor's fields, and whether deletion should become
a canonical command. **Nothing in M-5 now concerns failure reporting or rollback.**

### 9. Open architecture questions

> **OQ-1 is RESOLVED and CLOSED by [ADR-014 — Contract Core Field Authority](../03-adr/ADR-014-Contract-Core-Field-Authority.md)
> (Accepted).** One `ContractCoreAggregate` behind one `contract.core.update` command owns `employeeId`,
> `employeeName`, `contractNumber`, `monthlySalary`, `notes` and the five schedule fields; status, the
> date extent and renewal stay with their existing aggregates; `endDate` stays derived; `updatedAt`,
> `history` and the renewal references are system-authored; `id` and `createdAt` are immutable. Product
> decisions **PD-1** (`contractNumber` editable only while `Draft`) and **PD-2** (employee reassignment
> only while `Draft` and only with no linked payroll, overtime or transactions) are approved. Smart
> Import, Backup Restore, Demo Seed and the Employee Dedup relink are permanent, bounded exemptions.
> **ADR-014 authorizes no implementation.** OQ-2 and OQ-3 below remain **OPEN**.

- **OQ-1 — Which authority owns the editor's non-aggregate fields** (`contractNumber`, `employeeId`,
  `employeeName`, `notes`, schedule fields)? A new aggregate, an extension of an existing one, or a
  deliberate decision to leave them direct. ~~**This blocks editor-authority migration readiness.**~~
  **CLOSED by [ADR-014](../03-adr/ADR-014-Contract-Core-Field-Authority.md).**
- **OQ-2 — Should the editor's status control be removed, constrained to legal transitions, or routed
  through `ContractStatusAggregate`?** **Potentially requires a product decision:** aggregate routing
  would reject status changes the editor currently permits, so the migration is not behaviour-neutral.
- **OQ-3 — Should `deleteContract` become a canonical command with aggregate and repository
  mediation?** Not covered by any existing ARCH record.

### 10. Recommended sequencing

Recorded as a recommendation only. **No step below is authorized by this record.**

1. ~~Publication of ARCH-008 (this record).~~ **Done.**
2. ~~A narrow implementation sprint for the editor and delete **persistence-honesty gaps** (§7) — no ADR
   required, no aggregate decision required.~~ **Done — SPR-093** (`e22e4c04`), documentation reconciled
   by SPR-094.
3. ~~An architecture decision or ADR resolving **OQ-1** (editor field authority).~~ **Done —
   [ADR-014](../03-adr/ADR-014-Contract-Core-Field-Authority.md) (Accepted).**
4. Targeted discovery and an implementation charter for **editor-authority migration**, gated on OQ-1
   and OQ-2.
5. A separate decision for **delete authority** (OQ-3) if not resolved by the OQ-1 ADR.

### 11. Explicit non-authorization

ARCH-008 is a documentation and architecture-governance record. It authorizes **no** production code
change, **no** editor migration, **no** deletion migration, **no** new aggregate, **no** new command,
**no** status-dropdown behaviour change, **no** schema or migration change, **no** backend work, and
**no** version assignment. It makes no product decision.

**ARCH-008 is Planned, non-blocking, not a defect, and not implementation authorization.**

### 12. Verification and no-state-change statement

Established read-only at the evidence baseline: verifier **1443 checks**; runtime harnesses
**67 / 146 / 144 / 118 / 106 / 61 / 67 / 72** (total **781**); artifact
`dist/tam-intelligence-os-v2.8.4.html` **914,409 bytes**, SHA-256
`09c622b3a692dab426e8ef517592aa55f898d75560972c6d661e7bda3eaa02c6`. No production behaviour, rule
identifier, severity, schema, workflow, tag, or Release was changed by the discovery that produced this
record, or by the record itself.

### 13. Repository state after SPR-093 (added by SPR-094)

Repository `main` now contains truthful editor persistence and truthful delete persistence. It does
**not** contain any aggregate migration, repository migration, or command migration for those paths —
the editor and `deleteContract` remain direct writers through `persistContracts()`, exactly as §4 and
§5 describe.

Because production source changed, the portable artifact was regenerated from it (`CLAUDE.md` §10, §19).
`APP_VERSION` remains 2.8.4, `APP_RELEASE_NAME` remains *Monthly Plan Result Integrity*, and
`SCHEMA_VERSION` remains 6, so the artifact filename is unchanged. **The artifact recorded below is
SPR-095's rebuild** (SPR-095 added production modules under ADR-014 step 1) — it is the snapshot as of
this record and is retained as evidence, NOT the current repository artifact: the UX-002B, UX-003A,
UX-003B and UX-003C sprints have rebuilt it since. `ARCHITECTURE.md` holds the authoritative current
header.

| | Repository `main` | Published v2.8.4 Release asset |
|---|---|---|
| `dist/tam-intelligence-os-v2.8.4.html` | **934,518 bytes** | 914,409 bytes |
| SHA-256 | `3b7204a04ed9bba6e0db0a6fa00fc354ed0ea868d745ecdc63f1cb2251eae10e` | `09c622b3a692dab426e8ef517592aa55f898d75560972c6d661e7bda3eaa02c6` |

**Repository `main` therefore contains production changes beyond the published v2.8.4 Release
artifact.** This is a recorded fact about the current repository state, not a defect and not a release
recommendation. The tag `v2.8.4`, the GitHub Release, and its published asset are **unchanged and were
not republished**. No version has been assigned to the divergence, and this record neither recommends
nor authorizes a release.
