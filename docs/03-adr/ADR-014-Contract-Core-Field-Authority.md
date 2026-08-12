# ADR-014 — Contract Core Field Authority

**Status:** Accepted · **Resolves:** [ARCH-008](../02-architecture/Architecture_Evolution_Backlog.md#arch-008--contract-authority-reconciliation-addendum) OQ-1 ·
**Evidence baseline:** `main` @ `2130dbda9fa8654f38ed273c338927bc60e841f6` (v2.8.4, `SCHEMA_VERSION` 6) ·
**Product decisions:** PD-1, PD-2 approved by Norman

> **This ADR decides ownership. It authorizes no implementation.** It establishes which authority owns
> each mutable Contract field, permanently. It does not create an aggregate, a command, or a handler; it
> does not migrate the editor; it does not resolve OQ-2 or OQ-3. See *Explicit non-authorizations*.

## Context

Three Contract operations are already aggregate-authoritative, each routed through the canonical Platform
path (UI seam → `uiExecute` → Gateway → `Domain.command` → aggregate → handler → `ContractRepository`)
with a typed result and handler-owned rollback:

| Operation | Command | Business authority |
|---|---|---|
| Status transition | `contract.status.transition` | `ContractStatusAggregate` |
| Date extent update | `contract.dates.update` | `ContractDateAggregate` |
| Renewal | `contract.renewal.execute` | `ContractRenewalAggregate` |

The full Contract editor still writes eleven fields directly, outside all three aggregates and outside
`ContractRepository`. ARCH-006 first recorded this as a *status* concern; [ARCH-008](../02-architecture/Architecture_Evolution_Backlog.md#arch-008--contract-authority-reconciliation-addendum)
narrowed and corrected that scope, closed Contract renewal, and left OQ-1 open: **which authority owns
the editor's non-aggregate fields?** SPR-093 subsequently closed the editor's and delete path's
persistence-honesty gaps, so what remains in M-5 is ownership alone.

This ADR answers OQ-1 and only OQ-1.

## Decision

### One aggregate, one command

Introduce exactly one new business authority:

- **Aggregate:** `ContractCoreAggregate`
- **Command:** `contract.core.update`

It owns exactly ten fields:

`employeeId` · `employeeName` · `contractNumber` · `monthlySalary` · `notes` ·
`workHoursPerDay` · `workDaysPerWeek` · `weeksPerMonth` · `scheduleEffectiveDate` · `scheduleNotes`

No second Core command is created. No existing aggregate is modified, renamed, split, or absorbed.

### Field-authority matrix — the permanent ownership boundary

| Field | Authority | Owner |
|---|---|---|
| `employeeId` | **Core aggregate** (atomic pair with `employeeName`) | `contract.core.update` |
| `employeeName` | **Core aggregate** (atomic pair with `employeeId`) | `contract.core.update` |
| `contractNumber` | **Core aggregate** (Draft-only — PD-1) | `contract.core.update` |
| `monthlySalary` | **Core aggregate** | `contract.core.update` |
| `notes` | **Core aggregate** (carried; see rationale) | `contract.core.update` |
| `workHoursPerDay` | **Core aggregate** (atomic schedule group) | `contract.core.update` |
| `workDaysPerWeek` | **Core aggregate** (atomic schedule group) | `contract.core.update` |
| `weeksPerMonth` | **Core aggregate** (atomic schedule group) | `contract.core.update` |
| `scheduleEffectiveDate` | **Core aggregate** (atomic schedule group) | `contract.core.update` |
| `scheduleNotes` | **Core aggregate** (atomic schedule group) | `contract.core.update` |
| `status` | **Unchanged** — specialized | `ContractStatusAggregate` |
| `startDate` | **Unchanged** — specialized | `ContractDateAggregate` |
| `durationMonths` | **Unchanged** — specialized | `ContractDateAggregate` |
| renewal (compound) | **Unchanged** — specialized | `ContractRenewalAggregate` |
| `endDate` | **Derived** — never persisted | `contractCalc` |
| `updatedAt` | **System-authored** | handler only |
| `history` | **System-authored** | handler only |
| `renewedFromId` | **System-authored** | renewal handler only |
| `renewedToId` | **System-authored** | renewal handler only |
| `id` | **Immutable after creation** | — |
| `createdAt` | **Immutable after creation** | — |

Every mutable Contract field has exactly one operational authority. **No ambiguous overlapping
operational authority remains defined** — the three overlaps that exist in the current runtime are named
under *Consequences* as the overlaps a future migration must remove.

### Approved policy decisions

**PD-1 — `contractNumber` is editable only while the Contract is in `Draft`.**
Once a Contract leaves `Draft`, its number is fixed. Correcting a number afterwards is not an edit; it is
a cancel-and-recreate, or a renewal. Rationale: the number is denormalized as a **frozen snapshot** into
payroll rows (`pp.contractNumber`) and transaction descriptions (`txn.payrollMeta.contractNumber`).
Those copies are deliberately historical and are never rewritten, so post-issuance edits silently
desynchronize live data from issued documents. Entity links use `contractId` and are unaffected either
way — this policy protects document fidelity, not referential integrity.

**PD-2 — Employee reassignment is permitted only while the Contract is in `Draft`, and only when no
payroll, overtime, or transaction is linked to that Contract.**
Rationale: reassigning a Contract that already has linked records splits one contract's operational
history across two people — the downstream rows keep the original `employeeId`. The guard deliberately
mirrors the existing deletion guard, which already refuses when linked payroll or transactions exist.

Both decisions are **approved by Norman and final within this ADR**. They constrain a capability the
current editor permits; that is intended.

### Explicit exemptions — permanent, bounded, non-operational write paths

The following write Contract records without routing through `contract.core.update`, permanently and by
design. They are **not** technical debt and **no migration of them is authorized**:

| Path | Why exempt |
|---|---|
| **Smart Import** | Bulk ingestion. Creation-only — `smart-import-commit.js` sets `updateContract: false, // never auto-update`. It never patches an existing Contract, so no operational overlap exists. |
| **Backup Restore** | Restores an authoritative snapshot verbatim. Routing a restore through a patch command would be semantically wrong and would rewrite `updatedAt` and `history`. |
| **Demo Seed / Reset** | Creates fabricated records wholesale; never patches. |
| **Employee Dedup Relink** | A bulk relink (`employee-dedup.js`), not a single-record edit. It already rewrites `employeeId` and `employeeName` **together**, satisfying the pair invariant this ADR codifies. |

These are shared-mode exemptions of the kind ARCH-008 §6 describes: operational mutation versus bulk
ingestion or snapshot restoration are **explicitly distinct modes**, which is the only circumstance in
which shared ownership is permitted.

## Rationale — measured invariants, not importance

Fields were assigned to the Core aggregate because source evidence showed a **cross-field or group
invariant**, or a **duplicate operational authority**, not because a field is business-critical. A field
does not need an aggregate merely because it matters.

### 1. Atomic pair — `employeeId` + `employeeName`

`employeeName` on a Contract is a **denormalized display cache**, not authoritative data. An ordinary
employee rename does **not** propagate to it; the only path that refreshes it is the dedup relink
(`employee-dedup.js`), which rewrites both fields together. Changing `employeeId` without `employeeName`
therefore leaves the Contract displaying the wrong person's name against the right person's id.

**Decision:** the two fields move together or not at all. This is the primary invariant justifying a Core
aggregate. `employeeName` **remains persisted** — normalizing it away is a schema change and is not
authorized here.

### 2. Atomic schedule group — five fields

`readSchedule()` treats the schedule as present if **any one** of `workHoursPerDay`, `workDaysPerWeek`
or `weeksPerMonth` is truthy, then coerces the missing components with `|| 0`. A Contract-level schedule
takes precedence over the employee schedule and the company default. Consequently a **partial** schedule —
setting hours but not days — overrides the employee and company schedules entirely and yields
`standardHours = 0`, hence `hourlyRate = 0`, silently zeroing overtime pay for that contract.

**Decision:** the five fields form one value object. A patch that would leave the group internally
incomplete must be rejected rather than silently zeroing the rate. `scheduleEffectiveDate` is included in
the group for atomicity even though it currently has **no consumer** — it is captured, stored and
displayed, but never used for time-based schedule selection.

### 3. Duplicate operational authority — `status`, `startDate`, `durationMonths`

These three are already owned by working aggregates *and* written directly by the editor. Business rules
those aggregates enforce — the status transition graph, `contractExtentIsValid` — are reachable through
one UI route and bypassable through another. Ownership is therefore **not** in question for these three;
they stay with their specialized aggregates. What this ADR records is that the editor's duplicate write
of them is the overlap a future migration must remove.

### 4. Why `notes` travels with the Core command

`notes` carries **no invariant**. Source shows no validation, no cross-field constraint, and no consumer
that depends on its shape. On the evidence alone it could remain plain editor-authoritative data.

It is nevertheless carried by `contract.core.update` for one reason, stated plainly as a consistency
judgment rather than an invariant claim: **leaving a single field writable directly preserves a second
operational write path into the Contract record.** The purpose of this decision is that exactly one
operational authority exists per field; an exception for `notes` would keep the editor a direct writer
and defeat that. The cost is ceremony `notes` does not strictly need. That cost is accepted knowingly.

### 5. Why `monthlySalary` needs no separate authority

Contract compensation is **prospective only**. Payroll snapshots the salary at generation
(`pp.baseSalarySnapshot`), and overtime reads it live at approval and then snapshots the derived rate
into the overtime record. Editing a Contract's salary therefore cannot alter committed or posted payroll.
It has no cross-field invariant beyond the negative/non-numeric validation the existing validator already
performs. A dedicated compensation command would be structure without a second caller
(`CLAUDE.md` §6.6), so `monthlySalary` joins the Core command rather than acquiring its own.

This is distinct from [ADR-010](ADR-010-Compensation-Write-Authority.md) (Proposed), which concerns
**Employee** `monthlyBaseSalary`. ADR-014 does not decide, affect, or pre-empt ADR-010.

## Consequences

- Every mutable Contract field has exactly one defined operational authority.
- All operational Contract mutations are expected to return **typed result contracts** and to persist
  through **`ContractRepository`**, matching the three existing Contract handlers.
- The full Contract editor ceases to be an *authority* for Core fields and becomes an *ingress*. It
  retains no operational authority over any field this ADR assigns.
- **Three duplicate authorities are identified for future removal:** the editor's direct writes of
  `status`, `startDate` and `durationMonths`. Removing them is user-visible wherever the editor currently
  permits what an aggregate would reject — that visibility is intended and is governed by OQ-2, not here.
- PD-1 and PD-2 constrain capabilities the current editor permits. Both are approved.
- Two hazards that exist on `main` today are closed by this ownership model when it is implemented: the
  desynchronizing employee-link edit, and the silently rate-zeroing partial schedule.
- **No backend implication.** This is entirely a client-side authority question; the Repository boundary
  already isolates persistence mechanics, and nothing here implies a server, an API, or a schema.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| **A — status quo** (editor remains authority for all non-specialized fields) | Leaves the three measured duplicate authorities in place; aggregate rules stay bypassable. |
| **B — lifecycle-only** (status/dates/renewal specialized, everything else direct) | Same defect as A; records no ownership for the six unowned fields. |
| **C — one Core aggregate owning every editable field including lifecycle** | Over-scoped. `status` and the date extent already have working, tested aggregates; absorbing them would discard working authority and enlarge the change for no invariant gain. |
| **E — immutable core plus per-field commands** | Presumed the answers to PD-1 and PD-2 before Norman decided them, and multiplies commands without a second caller. |

**D — hybrid bounded ownership** is the decision recorded above: specialized aggregates retain
status/dates/renewal; one bounded Core command owns the identity, link, compensation, schedule and notes
fields.

## Implementation sequencing (recorded, not authorized)

If and when a future sprint is separately chartered, the smallest safe sequence is:

1. **Domain preparation** — aggregate, command registration, handler, `ContractRepository` mediation,
   runtime harness. **No UI routing, no user-visible change.**
2. **Editor routing migration** — editor save routed through the Core command; the three duplicate
   authorities removed. **Gated on OQ-2**, because one form still writes `status`.
3. Documentation reconciliation; artifact rebuild in any sprint that changes production source.

**One sprint is not sufficient.** Step 2 is behaviour-changing and blocked on a decision step 1 does not
need. Nothing in this list is authorized by this ADR.

## Explicit non-authorizations

This ADR authorizes **no**:

implementation · editor migration · command routing · repository migration · aggregate or command
creation · handler modification · schema change · storage change · lifecycle redesign · `employeeName`
normalization · `endDate` persistence · backend work · version assignment · release.

It also does **not** resolve:

- **OQ-2** — whether the editor's status control is removed, constrained to legal transitions, or routed
  through `ContractStatusAggregate`. **Remains OPEN.**
- **OQ-3** — whether `deleteContract` becomes a canonical command with aggregate and repository
  mediation. **Remains OPEN.**

The editor's **save orchestration** is deliberately not decided here: a single form spanning Core fields,
`status` and the date extent cannot be fully specified until OQ-2 resolves. This ADR decides *ownership*,
which is separable from *orchestration*.

## Status of M-5 after this ADR

M-5 remains **open**, Medium, non-controlling. Its composition changes:

- **OQ-1 — CLOSED** by this ADR.
- **OQ-2 — OPEN.**
- **OQ-3 — OPEN.**

M-5 is not Ready, not Scheduled, and not Accepted for implementation.

## Related records

- [ARCH-008](../02-architecture/Architecture_Evolution_Backlog.md#arch-008--contract-authority-reconciliation-addendum) — the reconciliation that raised OQ-1
- [ARCH-006](../02-architecture/Architecture_Evolution_Backlog.md#arch-006--contract-status--renewal-write-authority) — the historical record ARCH-008 narrows
- [ADR-004](ADR-004-aggregate-pattern.md) — Aggregate Pattern (business authority)
- [ADR-007](ADR-007-shared-aggregate-helpers.md) — the precedent for refusing a framework
- [ADR-013](ADR-013-Repository-Layer.md) — Repository layer (persistence mechanics)
- [ADR-010](ADR-010-Compensation-Write-Authority.md) (Proposed) — **Employee** compensation; distinct and unaffected
- [ADR-011](ADR-011-Contract-Date-Model-Authority.md) (Proposed) — Contract date model; the date extent stays with `ContractDateAggregate`
