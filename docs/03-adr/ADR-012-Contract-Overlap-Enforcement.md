# ADR-012 — Contract Overlap Enforcement

**Status:** Proposed · **Backlog item:** [ARCH-005](../02-architecture/Architecture_Evolution_Backlog.md#arch-005--contract-overlap-enforcement)

> **Proposed.** This ADR records a question under evaluation. It does **not** decide anything, is
> **not** Accepted, and authorizes **no** implementation. The current PR-5I runtime is correct and
> stays exactly as shipped until a separate, authorized Sprint Assignment implements a decision here.

## Context

A read-only overlap detector (`overlappingActiveContracts`) already exists: it surfaces informational
warnings when two `Active` contracts for the same employee cover intersecting month ranges (derived
from `startDate` + `durationMonths`). It is purely diagnostic — it mutates nothing.

PR-5I deliberately did **not** add overlap enforcement to the Domain. `contract.dates.update` validates
only the updated Contract's own date extent; it does not reject overlapping updates and never touches
sibling Contracts. Building an overlap engine was explicitly out of scope.

## Problem

There is no policy layer that decides whether a Contract date update that would create an overlap
should be prevented. Overlap is currently informational only, and the question of which layer (if any)
should own enforcement is unsettled.

## Current State

- `overlappingActiveContracts` is read-only and drives UI warnings only.
- `contract.dates.update` performs no overlap check and mutates no sibling Contract.
- Existing overlap warning behavior is unchanged by PR-5I.
- No behavior is changed by recording this ADR.

## Options to Evaluate

1. **Aggregate validation.** `ContractDateAggregate` rejects a date update that would create an
   overlap, using a read-only detector that excludes the Contract being updated from its own check,
   and returns a typed failure (e.g. `ContractDateOverlap`).
2. **Domain Policy.** Overlap becomes an explicit, testable cross-Contract policy consulted by the
   aggregate, rather than logic embedded in one aggregate.
3. **UI warning only.** Overlap remains informational; no command rejects on overlap.

Each option must define the authoritative overlap scope (per employee, `Active`-status only, month
granularity) and how self-overlap exclusion is guaranteed.

## Constraints

- No runtime change.
- No overlap engine (no new detector, no adaptation of the existing detector into mutation logic).
- No implementation authorization.

## Consequences

The chosen option determines whether overlap is a hard business rule or an advisory signal, and which
layer owns it. Because enforcing overlap now would change runtime behavior and risk rejecting
legitimate edits, the deliberate choice is to **decide later** with evidence. This remains
**Proposed**.

## Status

**Proposed.** No decision recorded.
