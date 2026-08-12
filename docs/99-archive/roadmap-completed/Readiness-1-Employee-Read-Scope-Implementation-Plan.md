# Readiness-1 — Employee Read Scope & Privacy Closure (Implementation Plan)

**Status:** implemented, merged & frozen — merge `3521d811`
**Baseline:** `3b78f854` (main after the readiness-audit merge)
**Closes:** the headline finding of the [Post-UX-006D user-readiness audit](Post-UX-006D-User-Readiness-Audit.md)
**Next milestone:** Readiness-2 — End-to-End User Journey Acceptance

---

## 1. The defect

The UX-006B self-scope layer was built, tested and **connected to nothing**. `getScopedRecords()` had
**zero production consumers**, so every list, detail, aggregate, report and Global Search read raw
`State.*`. An Employee principal could read the whole company, including colleagues' salaries.

Mutation authorization (UX-006C) was complete and correct throughout. This was purely unwired **read**
scope, orphaned between UX-006B (headless per amendment R1) and UX-006D (presentation only).

## 2. Policy implemented (unchanged from the approved ruling)

| Principal | Read scope |
|---|---|
| CEO | company-wide (**unchanged in every respect**) |
| Employee | **self-only** — records related to the active employee |
| null / unresolved | **fail closed** — never treated as CEO |

No scattered `if(role === 'Employee')` checks exist. The single mechanism is the frozen UX-006B
workspace/self-scope layer.

## 3. Architecture

```
canonical State  ->  principal-aware scoped selector  ->  renderer / report / search collector
```

- **`ENTITY_SCOPE`** extended from four entities to six. `payrollAdjustment` and `transaction` each
  declare an **explicit** SELF predicate over an ownership field the domain already carries. No
  ownership metadata was invented, and the "never a silent default" rule is preserved and now asserted
  directly rather than implied by a count.
- **`getScopedRecordById(entityType, id)`** — new public API. Detail pages are reached by an id captured
  earlier, possibly under a different principal, so scope is re-evaluated at **render** time. Out-of-scope
  and non-existent both return `null`, deliberately indistinguishable, so a renderer cannot leak the
  *existence* of a foreign record.
- The canonical `State` is never narrowed, never rewritten, and never filtered at persistence level. A
  scoped result is a copy; mutating it cannot damage `State`.

## 4. Surfaces wired

| Surface | Seam |
|---|---|
| Employees list, counters, department facet, CSV export | `getScopedRecords('employee')` |
| Employee detail | `getScopedRecordById('employee', …)` |
| Contracts list, alerts, CSV export | `getScopedRecords('contract')` |
| Contract detail | `getScopedRecordById('contract', …)` |
| **Payroll worksheet, month totals, cycle status, stage counts, bulk eligibility** | `payrollPlansForMonth()` — the single payroll read funnel |
| Payroll detail | `getScopedRecordById('payrollPlan', …)` |
| Payroll adjustments, employee pickers, eligible/excluded lists, Payroll Health alerts | `getScopedRecords('employee' / 'payrollAdjustment')` |
| Overtime list, facets, counters, CSV export | `getScopedRecords('overtime')` |
| HR dashboards and all report rows | four module-local scoped helpers |
| Finance ledger, months, derived analytics aggregates | `scopedTxns()` / `scopedTxnsForMonth()` / `scopedMonths()` |
| Action Center payroll generator | scoped employee read |
| **Breadcrumb terminal label** | `getScopedRecordById(…)` |
| **Global Search** | scoped sources at the collector seam |

**Global Search** keeps the frozen architecture: the engine stays source-agnostic and is **not** a policy
engine. Scope is applied at the document-collection input, so a foreign record is never *indexed* — not
merely filtered from results.

## 5. Finance / Analytics (Atlas ruling)

Navigation stays **visible + normal** for every principal; no route guards were added. An Employee
receives only finance records with an existing, explicit `employeeId` relationship — in practice their own
payroll postings. An ordinary company expense carries no `employeeId` and is therefore simply not in their
scope. Where that yields nothing, the surface renders the existing D3 no-data state: *"no scoped data
available"*, never *"permission denied"*.

## 5A. Identity-disclosure closure (Atlas ruling, added after first review)

An employee's **name is itself scoped data**. Scoping detail pages, salary and payroll is not
sufficient while a roster, picker, dropdown or navigator still lists colleagues — the identity has
already been disclosed, and refusing the subsequent click is too late. Foreign identities must not be
rendered into an Employee-visible source in the first place; detail re-scoping remains as defence in
depth.

Every identity-bearing source was inventoried mechanically (all remaining `State.employees` reads) and
classified. Newly scoped:

| Surface | Classification | Note |
|---|---|---|
| Overtime employee picker (`openOvertimeModal`) | **SCOPED — mutation input, Employee-authorized** | The critical one: own-Draft overtime *is* permitted, so this picker is genuinely usable by an Employee |
| Overtime worksheet (`renderOvertimeSheet`) | **SCOPED** | Renders one row per employee — unscoped it is a full roster |
| Contract form employee picker | **SCOPED** | Creation is CEO-only, but the roster was disclosed the moment the modal *rendered* |
| Payroll adjustment employee picker | **SCOPED** | |
| Legacy-mapping employee picker + empty-state gate | **SCOPED** | |
| Duplicate Review render | **SCOPED at the render site** | Detection stays canonical — see below |
| Settings employee diagnostics (count, unique names) | **SCOPED** | Settings is Employee-visible |
| Onboarding checklist, HR/payroll alerts naming employees, excluded-employee counts | **SCOPED** | |
| Employees CSV export | **SCOPED** | An export is a read |

Deliberately **not** scoped, with reasons:

| Surface | Classification | Why |
|---|---|---|
| `findEmployeeDuplicateGroups()` | **INTEGRITY INPUT** | It backs the `duplicate-employee-name` integrity rules and must see every record or data-quality detection silently stops. Disclosure is handled at the render site, which shows a group only if it contains a record the principal may read |
| Payroll workspace setup gate (`!State.employees.length \|\| !State.contracts.length`) | **NOT A PER-PRINCIPAL READ** | It asks whether the *company* is set up. Scoping it sent a null principal into the no-data state, which removed `#genPay` and `#lockBtn` — two of the seven controls **UX-006C3 froze as VISIBLE + DISABLED for null**. The frozen C3 contract wins; worksheet rows stay scoped via `payrollPlansForMonth()` |
| Employee merge `masterSnapshot`, dedup merge engine | **MUTATION INPUT WITH EXISTING AUTHORIZATION** | CEO-only maintenance; the backup snapshot must be complete |
| Import matching (`smart-import-*`, `legacy-mapping` matchers) | **MUTATION INPUT** | Duplicate detection and name matching operate on the whole dataset |
| `stabilization.js` integrity/validation scans | **INTEGRITY INPUT** | Data-quality checks over the canonical set |
| `hr-persistence-portability.js` | **PERSISTENCE** | The stored dataset is complete by definition |

### Frozen guard refined

`UX-005B: Employees export remains ALL employees` was written as a literal `State.employees` match. The
invariant it protects is that the export is **not narrowed by the grid** (no filter set, no page slice) —
not that it ignores principal scope. It is now asserted directly (`no employeesFiltered()`, no
`paged`/`pageRows`) with the principal-scope axis asserted alongside it. Strictly more precise.

### Proof

DOM-level, in both artifacts — not helper return values:

| Principal | Roster | Overtime picker | Contract picker | Result |
|---|---|---|---|---|
| **Employee A** | A only | 2 options | 6 options | **no Bravo identity, code or salary anywhere** |
| **Employee B** | B only | 2 options | — | **no Alpha identity** (mirror image) |
| **CEO** | both | 3 options | 7 options | unchanged |
| **null** | none | none | none | **no identity, no salary**; `#genPay`/`#lockBtn` still visible + disabled + marked (C3 intact) |

Principal switching recomputes with no reload: CEO 2 → A 1 → CEO 2, and the CEO roster is byte-identical
before and after, proving it is recomputed rather than served from a cache.

## 6. Documented intentional raw reads (§18/§22)

These are **deliberately unscoped** and must stay so:

| Path | Why |
|---|---|
| `getMonths()`, `txnsForMonth()` | canonical accessors for import, parsing, persistence and migration — they must always see the whole ledger |
| `js/import/*` (parser, commit, preview) | duplicate detection and month replacement operate on the complete dataset |
| `generatePayroll()` (`payroll-ops-engine.js`) | CEO-only mutation, already gated by `can(PAYROLL_MANAGE)`; it must iterate every employee |
| Persistence / portability / migration modules | the stored dataset is complete by definition |
| Dedup, merge, onboarding-reset engines | CEO-only maintenance over the canonical set |

## 7. A consequence worth stating plainly

Because `null` fails closed, **the app now shows no business data until a principal is selected**. That is
the required semantic (§13: null must never be treated as CEO), and it surfaced in two existing harnesses
that read data without selecting a principal — both updated to act as CEO, with the reason recorded
in-file. It is a real change to the default boot experience and is flagged for **Readiness-3** to consider
alongside the release candidate.

## 8. Verification

| Gate | Result |
|---|---|
| Read-scope harness | **119 PASS** — `tools/verify-employee-read-scope-runtime.js` (84 + 35 identity-disclosure checks) |
| **Negative control** on baseline `3b78f854` | **49 counted assertion failures** (was 33 before identity closure), no crash — reproduces both the salary exposure and the roster/picker identity disclosure |
| Verifier | **2419 PASS / 0 FAIL** (was 2386) |
| Runtime | **2825 PASS / 33 harnesses / 0 FAIL** (was 2705 / 32) |
| Frozen counts | D3 84 · D2 127 · C3 91 · C2C-4 164 · C2C-3 129 · C2C-2 118 · C2C-1 60 · authz 104 · outcome 53 · D1 29 — none fell |
| Browser (source **and** portable build) | Employee A: **zero leaks** across 17 views + 3 deep links **and every roster/picker DOM**; Employee B mirror; CEO unchanged; null shows nothing; zero console errors |
| Invariants | `ACTIONS` 20 · `APP_VERSION` 2.9.0 · `SCHEMA_VERSION` 6 · `js/core/authz.js` byte-unchanged |

## 9. Stop conditions

None triggered. Every privacy-sensitive HR record had an existing ownership relationship; no schema or
storage migration was required; no new ACTION was needed; Finance/Analytics were resolved by the standing
Atlas ruling rather than by inventing ownership; C3 navigation semantics are unchanged.
