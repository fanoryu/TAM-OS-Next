# RDR-011 — Epsilon Repository Snapshot

| Field | Value |
|---|---|
| **Record** | RDR-011 |
| **Title** | Aggregate-Backed Repository Adoption Complete |
| **Status** | Accepted |
| **Codename** | The Payroll Foundation baseline |
| **Season / Sprint / PR** | Milestone Epsilon · SPR-075 · PR-11A (published) |
| **Author** | Forge (engineering) |
| **Accountable approver** | Atlas — Chief Technology Officer |
| **Founder** | Approved |
| **Distribution** | Forge · Repository |
| **Date created** | 2026-08-03 |
| **Snapshot commit** | `6714beb0299f5544fedef94cda9fc72536f27aa7` |
| **Branch** | `main` |
| **Supersedes** | [RDR-007](RDR-007-delta-repository-snapshot.md) (as current baseline), and the record-only intermediate snapshots RDR-008, RDR-009, RDR-010 |
| **Superseded by** | — |
| **Related** | [ADR-013](../03-adr/ADR-013-Repository-Layer.md), [DPR-009](../DPR/DPR-009-epsilon-repository-adoption-completion.md), [Atlas Governance Register](../00-governance/Atlas_Governance_Register.md) |

> **Purpose.** This Repository Decision Record freezes the factual state of `main` at the **completion of
> aggregate-backed Repository adoption** (after PR-11A "The Payroll Foundation"). It is the **current
> authoritative repository baseline** and supersedes [RDR-007](RDR-007-delta-repository-snapshot.md) in
> that role. RDR-007 remains the immutable Milestone Delta snapshot and is not rewritten. RDR-008,
> RDR-009 and RDR-010 were record-only intermediate snapshots in the Atlas governance system (Employee
> adoption, Contract adoption, and Contract-completion boundaries); they are superseded here and recorded
> in the [RDR register](README.md) timeline.

---

## 1. Baseline Facts

| Fact | Value |
|---|---|
| Snapshot commit | `6714beb0299f5544fedef94cda9fc72536f27aa7` |
| Branch | `main`, in sync with `origin/main`, working tree clean |
| `APP_VERSION` | `2.7.3` |
| `APP_RELEASE_NAME` | `Supplemental-Aware Payroll History` |
| `SCHEMA_VERSION` | `6` |
| Verifier | **942 checks OK — PASSED** |
| Build | Deterministic; `dist/tam-intelligence-os-v2.7.3.html` @ `f78c222ec302053a32739cb3573c36f62433460c08f8edfb59d954b8e679c1dc` |
| Latest tag | `v2.7.3` — **no tag points at this commit** |
| Latest release | `v2.7.3` (2026-07-31) — unchanged |
| CI / CodeQL on `main` | Green / Green |
| Repository modules | **3** |
| Storage keys | Unchanged (15 asserted by the verifier: 13 legacy + companyAccounts + supplementalPayments) |
| Golden master | Unchanged |

## 2. Architecture

```
Browser ┐
        ├→ Transport Adapter → Application Gateway → Domain → Aggregate
CLI    ─┘                                                        │
                                                                 ▼
                                        Handler → Entity-Named Repository → StorageAdapter
```

Unchanged at this baseline: Platform, Transport Adapter, Application Gateway, Domain, Aggregates,
Commands, Queries, StorageAdapter, and the Repository contract. Every layer above and below the
Repository is byte-identical through the PR-11A merge.

## 3. Repository Inventory

Exactly **three** entity-named modules, each a frozen object exposing exactly one `save()`:

| Module | Path | Collection |
|---|---|---|
| `EmployeeRepository` | `js/repository/employee-repository.js` | employees |
| `ContractRepository` | `js/repository/contract-repository.js` | contracts |
| `PayrollRepository` | `js/repository/payroll-repository.js` | payrollPlans |

Shared contract, unevolved since PR-8A:

```
async save() → { ok: true } | { ok: false, error: 'PersistFailed' }
```

Each is collection-grained, client-side, and persistence-mechanics only — verified free of business
authority, validation, mutation, `updatedAt`, history, rollback, UI, audit, and Domain/Aggregate access,
and free of network surface or transaction/unit-of-work constructs. See
[ADR-013](../03-adr/ADR-013-Repository-Layer.md).

## 4. Repository Adoption

All seven aggregate-backed handlers are Repository-mediated:

| Aggregate | Command | Repository |
|---|---|---|
| Employee | `employee.contact.update` | EmployeeRepository |
| Employee | `employee.employment.update` | EmployeeRepository |
| Employee | `employee.lifecycle.transition` | EmployeeRepository |
| Employee | `employee.compensation.update` | EmployeeRepository |
| Contract | `contract.dates.update` | ContractRepository |
| Contract | `contract.status.transition` | ContractRepository |
| Payroll | `payroll.lifecycle.transition` | PayrollRepository |

**Employee 4 of 4 · Contract 2 of 2 · Payroll 1 of 1 · Overall 7 of 7.**

## 5. Bounded Claim

**7 of 7 means aggregate-backed Repository adoption is complete** — nothing more.

It does **not** mean: all persistence operations are mediated · non-aggregate writes are mediated ·
compound persistence is solved · multi-store transactions are supported · full persistence abstraction
is complete · backend readiness is achieved.

Non-aggregate and compound persistence remain **direct by design**, verifier-fenced:

| Entity | Unmediated direct writes at this baseline |
|---|---|
| Employee | 4 — `employees.js` ×3, `onboarding-reset.js` |
| Contract | 4 — full editor, delete, renewal, `onboarding-reset.js` |
| Payroll | 7 — override set/clear, regeneration, generation, v2.5 schema migration, 2 compound posting sites |

The verifier records the bound mechanically: the layer mediates **3 collections out of 11** persist
functions, asserted under the message *"adoption completeness != persistence abstraction"*.

## 6. Payroll Audit Invariant

`transitionPayrollLifecycle` is the only aggregate-backed handler carrying a post-persistence audit.
Confirmed at this baseline in modular source and portable build: audit is **handler-owned**, occurs
**after** successful Repository persistence, **once** on success, **zero** times on persistence failure,
remains **outside** `PayrollRepository`, and **rollback remains handler-owned** (status + `history.pop()`
+ `updatedAt`).

## 7. Repository Evolution

| PR | Milestone | Event |
|---|---|---|
| PR-8A | Delta | `EmployeeRepository` introduced (`employee.contact.update`) |
| PR-9A | Epsilon | Employee Employment adopted |
| PR-9B | Epsilon | Employee Lifecycle adopted |
| PR-9C | Epsilon | Employee Compensation adopted — **Employee aggregate complete** |
| PR-10A | Epsilon | `ContractRepository` introduced (Contract Dates) |
| PR-10B | Epsilon | Contract Status adopted — **Contract aggregate complete** |
| PR-11A | Epsilon | `PayrollRepository` introduced (Payroll Lifecycle) — **adoption complete at 7 of 7** |

**Maturity advanced through adoption breadth, not Repository contract expansion.** The contract has been
byte-identical since PR-8A across seven consumers and three modules: no method added, no responsibility
absorbed, no generic repository, factory, base class, or transaction abstraction introduced.

## 8. Operational Surface

| Surface | Value |
|---|---|
| Aggregates | 7 |
| Aggregate-backed commands | 7 |
| Aggregate-backed queries | 1 |
| Registered commands | 13 |
| Registered queries | 4 |

**No Domain operation was added or removed** across the entire adoption arc.

## 9. Repository Health

Working tree clean · verifier 942 checks OK · deterministic byte-identical build · zero runtime drift ·
zero version drift · zero schema drift · storage keys unchanged · golden master unchanged · CI green ·
CodeQL green · no release · no tag · no deployment.

## 10. Governance Status at Snapshot Time

At the moment this snapshot was taken (before SPR-075), Repository-layer governance synchronization was
**outstanding**: the layer appeared in no ADR, no `ARCHITECTURE.md` module map, no `AI_CONTEXT.md` entry,
and no register; the published baseline and progress pointers still named RDR-007 / DPR-005; and the
published Milestone Epsilon charter described *Workflow* while the delivered work was *Repository
Adoption*.

**SPR-075 closes that gap** — it publishes this record, [DPR-009](../DPR/DPR-009-epsilon-repository-adoption-completion.md),
and [ADR-013](../03-adr/ADR-013-Repository-Layer.md); updates `ARCHITECTURE.md`, `AI_CONTEXT.md`, the
registers and the documentation index; and reconciles the Epsilon charter (see §11). This section is
retained as the factual record of the gap that existed at snapshot time.

## 11. Milestone Epsilon Charter

Milestone Epsilon was **formally re-chartered from Workflow to Repository Adoption** through the accepted
Atlas governance sequence beginning with ATR-008. The original *Workflow* charter — "model multi-step
lifecycles (payroll, supplemental, finance execution) as explicit workflows over the existing status
values" — is recorded as **superseded, not deleted**, in
[`Milestones.md`](../05-milestones/Milestones.md). Workflow remains available as a future milestone theme;
it was not delivered under Epsilon.

## 12. Supersession

- **Current authoritative repository baseline:** RDR-011 (this record).
- Supersedes **RDR-007** in that role; RDR-007 remains the immutable Milestone Delta snapshot.
- Absorbs the record-only intermediate snapshots **RDR-008**, **RDR-009**, **RDR-010** (Atlas governance
  system; not separately published as files, per the register's established convention).
- RDR-001 and RDR-003 remain immutable predecessors. **RDR numbering is never reused**, and no prior
  record is rewritten.

## 13. Assessment

`6714beb` is the **first repository baseline at which aggregate-backed Repository adoption is complete
across every aggregate** — three aggregates, three separate entity-named repositories, seven mediated
handlers — while the Platform architecture remains entirely unchanged.

The baseline is notable for what it declines to claim. The verifier mechanically asserts that adoption
completeness is *not* persistence abstraction, that compound multi-store writes remain direct and
inexpressible in the contract, and that no repository implies a backend. A completion milestone that
encodes its own limits is more trustworthy than one that does not.

The genuine architectural frontier is now visible and untouched: **compound persistence** — the two
four-store payroll posting paths and Contract renewal's create-successor write. That is the next
architecture question, and it is ATR-scale, not slice-scale.
