# ADR-009 — Employment vs Lifecycle Responsibility

**Status:** Proposed · **Backlog item:** [ARCH-002](../02-architecture/Architecture_Evolution_Backlog.md#arch-002--employment-vs-lifecycle-responsibility)

> **Proposed.** This ADR records a question under evaluation. It does **not** decide anything, is
> **not** Accepted, and authorizes **no** implementation. The current PR-5G runtime is correct and
> stays exactly as shipped until a separate, authorized Sprint Assignment implements a decision here.

## Context

`employmentStatus` is a single stored field that two operational commands can now change:

- `employee.employment.update` (via `EmployeeEmploymentAggregate`) — may set `employmentStatus` to any
  value in `EMPLOYMENT_STATUSES` (`Active`, `Inactive`, `On Leave`, `Resigned`, `Terminated`), as part
  of a broader employment-fields edit.
- `employee.lifecycle.transition` (via `EmployeeLifecycleAggregate`) — applies a narrow, validated
  state machine over a subset (`Active ↔ Resigned`, `Active ↔ Terminated`).

## Problem

Two aggregates can write the same field with different rules. This overlap is intentional and correct
today — the lifecycle command adds a controlled path without restricting the employment editor — but
the **authoritative** owner of status changes is undecided. Leaving it implicit indefinitely risks
divergent expectations about which path is canonical.

## Current State

- Both commands are operational and behave as specified in PR-5E and PR-5G.
- The employment editor can set any status; the lifecycle editor offers only legal transitions from the
  current state.
- `Inactive` and `On Leave` are deliberately outside the lifecycle state machine.
- No behavior is changed by recording this ADR.

## Options to Evaluate

1. **Lifecycle is authoritative.** `employmentStatus` changes flow only through
   `employee.lifecycle.transition`; the employment command drops `employmentStatus` from its allowlist.
2. **Split responsibility.** Employment retains a limited status-edit capability (e.g. `Inactive` /
   `On Leave` administrative states) while lifecycle owns the `Active`/`Resigned`/`Terminated` machine.
3. **Status quo, documented.** Keep both paths, and document the intended usage without a code change.

Each option must also resolve how `Inactive` and `On Leave` relate to lifecycle transitions and whether
existing UI paths need a staged migration.

## Constraints

- No behavior change inside PR-5G.
- No retroactive scope expansion.
- Preserve existing runtime until a separately authorized decision is implemented.

## Consequences

The chosen option determines whether the employment and lifecycle aggregates share a field or hold
disjoint authority over it, and whether any UI migration is needed. Because the current behavior is
correct and no data is at risk, the deliberate choice is to **observe and decide later** rather than
force an early boundary. This remains **Proposed**.

## Status

**Proposed.** No decision recorded.
