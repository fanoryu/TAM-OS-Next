# RDR-001 — Gamma Repository Snapshot

| Field | Value |
|---|---|
| **Record** | RDR-001 |
| **Title** | Gamma Repository Snapshot |
| **Type** | Repository Decision Record (repository state snapshot) |
| **Status** | Accepted |
| **Author** | Forge (engineering) |
| **Accountable approver** | Atlas — Chief Technology Officer |
| **Date created** | 2026-08-01 |
| **Snapshot commit** | `0337f31` (Merge PR #18 — PR-5J "The Accountant") |
| **Supersedes** | — |
| **Superseded by** | — |
| **Related** | [Milestones.md](../05-milestones/Milestones.md), [Domain_Roadmap.md](../01-roadmap/Domain_Roadmap.md), [SDR-0001](../security/SDR-0001-codeql-baseline-disposition.md) |

> **Purpose.** Freeze the repository state at the close of Milestone Gamma. This record is a **factual
> snapshot** of what exists on `main` after PR-5G…PR-5J merged — no future planning, no
> recommendations. It changes no code, no configuration, and no other decision record.

---

## 1. Repository Version

| Fact | Value | Source |
|---|---|---|
| `APP_VERSION` | `2.7.3` | `js/core/constants.js` |
| `APP_RELEASE_NAME` | Supplemental-Aware Payroll History | `js/core/constants.js` |
| `SCHEMA_VERSION` | `6` | `js/core/constants.js` |
| Portable build | `dist/tam-intelligence-os-v2.7.3.html` | one release artifact |

## 2. Current Merge Commit

- **`main` tip:** `0337f312f3278812c9920bf7050c0d57795c28b8` (`0337f31`).
- **Subject:** `Merge pull request #18 from fanoryu/feat/pr-5j-accountant` — parents `f92b69c` (main) + `a72528e` (PR-5J feature commit).
- **Working tree:** clean. **Verifier:** 578/578. **Dist:** reproducible (byte-identical to source).

## 3. Operational Aggregates (6)

| Aggregate | Root | Introduced |
|---|---|---|
| `EmployeeContactAggregate` | Employee | Beta (PR-5D) |
| `EmployeeEmploymentAggregate` | Employee | Beta (PR-5E) |
| `EmployeeLifecycleAggregate` | Employee | Gamma (PR-5G) |
| `EmployeeCompensationAggregate` | Employee | Gamma (PR-5H) |
| `ContractDateAggregate` | Contract | Gamma (PR-5I) |
| `PayrollLifecycleAggregate` | PayrollPlan | Gamma (PR-5J) |

Verifier assertion: `aggregateDefs === 6`.

## 4. Operational Commands (6)

| Command | Boundary aggregate | Handler | Persistence | Rollback |
|---|---|---|---|---|
| `employee.contact.update` | EmployeeContactAggregate | `updateEmployeeContact` | `persistEmployees` ×1 | handler |
| `employee.employment.update` | EmployeeEmploymentAggregate | `updateEmployeeEmployment` | `persistEmployees` ×1 | handler |
| `employee.lifecycle.transition` | EmployeeLifecycleAggregate | `transitionEmployeeLifecycle` | `persistEmployees` ×1 | handler |
| `employee.compensation.update` | EmployeeCompensationAggregate | `updateEmployeeCompensation` | `persistEmployees` ×1 | handler |
| `contract.dates.update` | ContractDateAggregate | `updateContractDates` | `persistContracts` ×1 | handler |
| `payroll.lifecycle.transition` | PayrollLifecycleAggregate | `transitionPayrollLifecycle` | `persistPayrollPlans` ×1 | handler |

Also registered but **descriptive / non-operational** (no `Domain.command()` call site): `payroll.commit`,
`finance.execute`, `supplemental.generate`, `supplemental.transition`, `supplemental.post`, `audit.log`.
Verifier assertion: `migratedCmdIds.length === 6`.

## 5. Operational Queries (1)

| Query | Owner | Handler | Purpose |
|---|---|---|---|
| `employee.filtered` | Employee | `employeesFiltered` | Read-only filtered/sorted employee list via `Domain.query()` |

Verifier assertion: `migratedQueryIds.length === 1 && [0] === 'employee.filtered'`.

## 6. Domain Coverage

Operational-write-path ratio per area (Domain-controlled write paths ÷ total business write paths on `main`).

| Area | Ratio | State |
|---|---|---|
| Employee | 4 / 7 | Partially Controlled |
| Contract | 1 / 5 | Partially Controlled |
| Payroll | 1 / 5 (the migrated lifecycle path is single-authority) | Partially Controlled |
| Supplemental | 0 / 3 operational | Not Controlled |
| Overtime | 0 / 1 | Not Controlled |
| Finance | 0 / 1 operational | Not Controlled |
| Reports | — (read-only; no mutation surface) | Not Controlled |

## 7. Domain Maturity Matrix

Scale: **Unstarted → Emerging → Transitional → Stable → Optimized.**

| Area | Maturity | Basis |
|---|---|---|
| Employee | **Transitional** | Four operational aggregates with full pattern discipline, but the full-record editor still co-writes the same fields |
| Contract | **Emerging** | One aggregate (dates); full editor, status, renewal, delete remain outside the Domain |
| Payroll | **Emerging** | One aggregate (pre-posting lifecycle, single-authority); generation, override, posting remain outside |
| Supplemental | **Unstarted** | Handlers + descriptive commands exist; none routed through `Domain.command()` |
| Overtime | **Unstarted** | No Domain surface |
| Finance | **Unstarted** | `finance.execute` descriptive only |
| Reports | **Unstarted** | Read-only; no write surface (the one query is Employee-owned) |

No area is **Stable** (each has a co-existing non-Domain writer) or **Optimized** (events/policies not yet operational).

## 8. Architecture Backlog Status

| Item | Status |
|---|---|
| ARCH-001 … ARCH-005 | Planned (non-blocking; not authorized for implementation) |

Source: [Architecture Evolution Backlog](../02-architecture/Architecture_Evolution_Backlog.md). No ARCH item was implemented by any Gamma slice.

## 9. ADR Status

| Record set | Status |
|---|---|
| Domain ADR-001 … ADR-007 | Accepted |
| Domain ADR-008 … ADR-012 | Proposed (open questions from PR-5G/5H/5I reviews; authorize no implementation) |
| Repository ADR-0001 (documentation governance) | Accepted |

Source: [Domain ADR index](../03-adr/README.md), [Repository ADR index](../adr/README.md).

## 10. Repository Health

| Check | State |
|---|---|
| Verifier | 578/578 PASS |
| Build fidelity | dist == concatenated source (reproducible) |
| Dist artifacts | exactly one (`v2.7.3`) |
| Working tree | clean at `0337f31` |
| CSS golden master | untouched |
| Storage keys | 15 known, unchanged |
| Hosted checks (main) | CI, Analyze (actions), Analyze (javascript-typescript), CodeQL — success |

## 11. Security Baseline

- **SDR-0001** (CodeQL Baseline Disposition) — Accepted 2026-08-01.
- Baseline of **5** High findings: **4 open** (FP-1 ×3 insecure-randomness, FP-2 incomplete-sanitization) and **1 dismissed** (alert #5, `clear-text-storage-of-sensitive-data` at `activity-log.js:31`, dismissed under **AR-1** accepted risk during PR-5J security triage).
- No CodeQL configuration weakened; no query suppressed; baseline intact.

## 12. Milestone Status

| Milestone | Status |
|---|---|
| Alpha — Product foundation | Completed |
| Beta — Domain Foundation | Completed |
| **Gamma — Domain Expansion (PR-5G…PR-5J)** | **Completed** |
| Delta — Domain Events & Policies | Upcoming |
| Epsilon — Workflow | Upcoming |
| Zeta — Intelligence Layer | Upcoming |
| Omega — Enterprise Platform | Upcoming |

Source: [Milestones.md](../05-milestones/Milestones.md).

## 13. Repository Snapshot Summary

At `main@0337f31`, TAM Intelligence OS v2.7.3 (SCHEMA 6) carries an operational Domain of **6 aggregates,
6 commands, and 1 query**, established across the Employee, Contract, and Payroll areas through
Milestones Beta and Gamma. The routing facade (`domain-layer.js`) is stable and was not modified after
the transition-contract slice. The verifier passes 578/578, the portable build is reproducible, the CSS
golden master and all storage keys are unchanged, and the CodeQL baseline is governed by SDR-0001 (4
open, 1 AR-1 dismissed). Milestones Alpha, Beta, and Gamma are Completed; Delta and later remain Upcoming.
This is the frozen state of the repository at the close of Milestone Gamma.

---

*RDR-001 is a factual repository snapshot. It changes no code, configuration, or other decision record,
and authorizes no work.*
