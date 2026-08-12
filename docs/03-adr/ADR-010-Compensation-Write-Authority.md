# ADR-010 — Compensation Write Authority

**Status:** Proposed · **Backlog item:** [ARCH-003](../02-architecture/Architecture_Evolution_Backlog.md#arch-003--compensation-write-authority)

> **Proposed.** This ADR records a question under evaluation. It does **not** decide anything, is
> **not** Accepted, and authorizes **no** implementation. The current PR-5H runtime is correct and
> stays exactly as shipped until a separate, authorized Sprint Assignment implements a decision here.

## Context

PR-5H introduced `EmployeeCompensationAggregate` and the operational command
`employee.compensation.update`, giving `monthlyBaseSalary` a controlled Domain write path: existence
check, strict allowlist, numeric normalization and validation, a single mutation, one
`compensation-edited` history entry, one persist, and atomic rollback.

The legacy full Employee editor (`openEmployeeModal`) can still write `monthlyBaseSalary` directly, as
part of a broader employee save that bypasses the aggregate gate. Both paths ship intentionally.

## Problem

Two code paths can write the same compensation field with different guarantees: the aggregate path is
validated, audited, and atomic; the legacy path is a direct field write inside the monolithic save.
Leaving the authoritative path implicit risks divergent expectations about which one is canonical and
which guarantees apply to a given change.

## Current State

- `employee.compensation.update` (via `EmployeeCompensationAggregate`) is operational and behaves as
  specified in PR-5H: `monthlyBaseSalary` only, `null`-or-non-negative-number, typed failures, one
  history entry, atomic rollback.
- The legacy Employee editor still writes `monthlyBaseSalary` directly.
- The compensation history note records neither the previous nor the new value.
- No behavior is changed by recording this ADR.

## Options to Evaluate

1. **Aggregate is authoritative.** `monthlyBaseSalary` becomes writable only through
   `employee.compensation.update`; the legacy editor drops salary from its save, with a staged UI
   migration.
2. **Split responsibility.** The legacy editor retains salary editing for now; the aggregate path is
   the preferred route, documented as canonical without removing the legacy path.
3. **Status quo, documented.** Keep both paths and document intended usage without a code change.

Each option must also resolve the business meaning of `null` vs `0` for `monthlyBaseSalary`, and
whether compensation history should eventually carry previous/new values.

## Constraints

- No runtime change.
- No UI migration.
- No implementation authorization.
- Preserve existing behavior until a separately authorized decision is implemented.

## Consequences

The chosen option determines whether Employee compensation has a single authoritative write path and
whether the legacy editor requires a staged migration. Because the current behavior is correct and no
stored data is at risk, the deliberate choice is to **observe and decide later** rather than force an
early boundary. This remains **Proposed**.

## Status

**Proposed.** No decision recorded.
