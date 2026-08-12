# ECR-001 — Milestone Epsilon Closure Record

| Field | Value |
|---|---|
| **Record** | ECR-001 |
| **Title** | Milestone Epsilon Closure Record |
| **Status** | Accepted — closed |
| **Milestone** | Epsilon |
| **Author** | Forge (engineering) |
| **Accountable approver** | Atlas — Chief Technology Officer |
| **Founder** | Approved |
| **Date created** | 2026-08-03 |
| **Closure baseline** | `0ad81501b5a7cddc525bdc65bfa45710233476e9` |
| **Preceded by** | MCR-002 — Milestone Epsilon Formal Closure Review (passed) |
| **Published by** | SPR-076 |
| **Related** | [ADR-013](../03-adr/ADR-013-Repository-Layer.md), [RDR-011](../RDR/RDR-011-epsilon-repository-snapshot.md), [DPR-009](../DPR/DPR-009-epsilon-repository-adoption-completion.md), [Milestones](../05-milestones/Milestones.md) |

> **Purpose.** Historical closure record for **Milestone Epsilon**. It records the completed milestone
> and nothing else — it evaluates nothing, recommends nothing, authorizes nothing, and speculates about
> nothing. It is immutable once Accepted (`CLAUDE.md` §14.4, §16.2).

---

## 1. Baseline

The milestone closed at commit `0ad81501b5a7cddc525bdc65bfa45710233476e9` on `main`.

| Fact | Value at closure |
|---|---|
| Closure commit | `0ad81501b5a7cddc525bdc65bfa45710233476e9` |
| Branch | `main`, equal to `origin/main`, working tree clean |
| `APP_VERSION` | `2.7.3` |
| `APP_RELEASE_NAME` | `Supplemental-Aware Payroll History` |
| `SCHEMA_VERSION` | `6` |
| Verifier | 942 checks OK |
| Build | Deterministic |
| dist hash | `f78c222ec302053a32739cb3573c36f62433460c08f8edfb59d954b8e679c1dc` |
| Repository baseline | [RDR-011](../RDR/RDR-011-epsilon-repository-snapshot.md) |
| Progress report | [DPR-009](../DPR/DPR-009-epsilon-repository-adoption-completion.md) |
| Repository ADR | [ADR-013](../03-adr/ADR-013-Repository-Layer.md) — Accepted |
| Milestone review | MCR-002 — passed |

## 2. Milestone Objective

The delivered objective of Milestone Epsilon is **Repository Adoption**.

The original charter of Milestone Epsilon was **Workflow** — "model multi-step lifecycles (payroll,
supplemental, finance execution) as explicit workflows over the existing status values, preserving
derive-don't-duplicate."

The original charter is preserved as **superseded history** in
[`Milestones.md`](../05-milestones/Milestones.md) and in the superseded-themes table of
[`Milestone_Roadmap.md`](../01-roadmap/Milestone_Roadmap.md). It was not deleted.

## 3. Delivered Architecture

```
Browser ┐
        ├→ Transport Adapter → Application Gateway → Domain → Aggregate
CLI    ─┘                                                        │
                                                                 ▼
                                        Handler → Entity-Named Repository → StorageAdapter
                                                                                  │
                                                                                  ▼
                                                              localStorage / Artifact storage
```

Entity-named Repository architecture. Repository contract:

```
async save() → { ok: true } | { ok: false, error: 'PersistFailed' }
```

Ownership as delivered: business authority with the Domain aggregates; implementation authority with the
handlers, including validation, mutation, `updatedAt`, history, rollback, and typed results; persistence
mechanics with the Repository; the storage-backend boundary with `StorageAdapter`. The Payroll
best-effort audit remained handler-owned and post-persistence.

## 4. Repository Evolution Summary

| PR | Milestone | Event |
|---|---|---|
| PR-8A | Delta | `EmployeeRepository` introduced (`employee.contact.update`) |
| PR-9A | Epsilon | Employee Employment adopted |
| PR-9B | Epsilon | Employee Lifecycle adopted |
| PR-9C | Epsilon | Employee Compensation adopted — Employee aggregate complete |
| PR-10A | Epsilon | `ContractRepository` introduced (Contract Dates) |
| PR-10B | Epsilon | Contract Status adopted — Contract aggregate complete |
| PR-11A | Epsilon | `PayrollRepository` introduced (Payroll Lifecycle) — adoption reached 7 of 7 |

The Repository contract was byte-identical from PR-8A through PR-11A across seven consumers and three
modules.

## 5. Implementation Summary

Completed implementation sequence: **PR-8A · PR-9A · PR-9B · PR-9C · PR-10A · PR-10B · PR-11A**.

Modules delivered:

- `EmployeeRepository` — `js/repository/employee-repository.js`
- `ContractRepository` — `js/repository/contract-repository.js`
- `PayrollRepository` — `js/repository/payroll-repository.js`

Seven aggregate-backed handlers, all Repository-mediated:

| Aggregate | Commands | Count |
|---|---|---|
| Employee | `contact.update`, `employment.update`, `lifecycle.transition`, `compensation.update` | 4 of 4 |
| Contract | `dates.update`, `status.transition` | 2 of 2 |
| Payroll | `lifecycle.transition` | 1 of 1 |
| **Total** | | **7 of 7** |

The Repository contract did not change. The Platform did not change.

## 6. Governance Summary

Completed: **ATR-008 · ATR-009 · ATR-010 · ADR-013 · RDR-011 · DPR-009 · SPR-075 · FAA-PR11A ·
FAA-PR12A · MCR-002.**

Published records:

- [ADR-013 — Repository Layer](../03-adr/ADR-013-Repository-Layer.md) — Accepted
- [RDR-011 — Epsilon Repository Snapshot](../RDR/RDR-011-epsilon-repository-snapshot.md) — repository baseline
- [DPR-009 — Epsilon Repository Adoption Completion Report](../DPR/DPR-009-epsilon-repository-adoption-completion.md) — progress report

## 7. Repository State at Closure

Three Repository modules. Entity-named Repository architecture. Collection-grained Repository contract.
Client-only architecture.

`APP_VERSION` 2.7.3 · `APP_RELEASE_NAME` "Supplemental-Aware Payroll History" · `SCHEMA_VERSION` 6 ·
15 storage keys (13 legacy + `tam_company_accounts_v1` + `tam_supplemental_payments_v1`) · golden master
unchanged.

## 8. Operational State at Closure

942 verifier checks OK · deterministic build · dist `f78c222e…79c1dc` · CI green · CodeQL green ·
no release · no tag on the closure commit · no deployment.

Operational surface: 7 aggregates / 7 aggregate-backed commands / 1 aggregate-backed query. Registered
surface: 13 commands / 4 queries. Both unchanged across every Epsilon slice.

## 9. Boundary Statement

Recorded permanently:

**7 of 7 means:** every aggregate-backed handler delegates through an entity-named Repository.

**It does not mean:**

- full persistence abstraction
- compound persistence solved
- backend readiness
- transaction abstraction
- multi-store support

This statement is historical record.

## 10. Deferred Items

- Compound persistence
- Workflow theme
- Dependabot PR #33

## 11. Post-Closure Repository Maintenance

Repository maintenance PR #33 (merge commit `e5b642c88498580f9ce8a796f665bde3b86c527e`) was merged
**after** this milestone closed. It bumped `github/codeql-action/init` and
`github/codeql-action/analyze` from `4.37.3` to `4.37.4` in `.github/workflows/codeql.yml` — four
changed lines, all version strings, in one file.

It did not alter engineering completion, architecture, governance, runtime, version, schema, storage, or
the milestone decision. The closure baseline recorded in §1 remains
`0ad81501b5a7cddc525bdc65bfa45710233476e9`; the maintenance merge is recorded here for continuity and is
not part of Milestone Epsilon.

## 12. Historical Significance

Milestone Epsilon is the first period in this repository's history in which every aggregate-backed
handler across every aggregate persists through a dedicated boundary rather than through a direct
collection write.

It is also the first in which a persistence abstraction was extended three times without changing its
contract. `EmployeeRepository`, `ContractRepository`, and `PayrollRepository` were added as siblings
sharing identical mechanics; no generic repository, factory, shared base class, or transaction
abstraction was introduced, and no method was added to the contract established at PR-8A.

Across six merged slices, the Platform, Transport Adapter, Application Gateway, Domain, Aggregates,
Commands, Queries, and StorageAdapter were unchanged; the operational and registered surfaces did not
move; and no schema migration, storage-key change, version change, or release was required.

Epsilon is the milestone in which the repository recorded the limits of a completion claim alongside the
claim itself. The bounded meaning of 7 of 7 exists in three independent layers of the repository: a
design note in `payroll-repository.js`, a dedicated verifier section that asserts the milestone and the
bound together, and the governance records ADR-013, RDR-011, and DPR-009.

It is additionally the milestone whose charter changed during delivery and whose original charter
survived that change in the record, and in whose closing sprint a pre-existing divergence in the Delta
roadmap entry was surfaced and reconciled rather than overwritten.

## 13. Milestone Closure Statement

Milestone Epsilon delivered Repository Adoption across the Employee, Contract, and Payroll aggregates in
seven implementation slices, established three entity-named Repository modules on an unchanged
collection-grained contract, preserved every architectural invariant and the Platform, and completed its
governance and documentation synchronization. Its closure was reviewed and passed under MCR-002 at
`main` @ `0ad8150`.

---

**MILESTONE EPSILON CLOSED**

**REPOSITORY BASELINE:**
[RDR-011](../RDR/RDR-011-epsilon-repository-snapshot.md)

**CURRENT PROGRESS RECORD:**
[DPR-009](../DPR/DPR-009-epsilon-repository-adoption-completion.md)

**CURRENT REPOSITORY ADR:**
[ADR-013](../03-adr/ADR-013-Repository-Layer.md)
