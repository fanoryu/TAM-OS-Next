# ADR-011 — Contract Date Model Authority

**Status:** Proposed · **Backlog item:** [ARCH-004](../02-architecture/Architecture_Evolution_Backlog.md#arch-004--contract-date-model-authority)

> **Proposed.** This ADR records a question under evaluation. It does **not** decide anything, is
> **not** Accepted, and authorizes **no** implementation. The current PR-5I runtime is correct and
> stays exactly as shipped until a separate, authorized Sprint Assignment implements a decision here.

## Context

The SPR-049 architecture incident established, and PR-5I confirmed, that the authoritative Contract
date model stores two facts — `startDate` and `durationMonths` — while `endDate` is **derived** by the
existing `contractCalc()` logic (end = last calendar day of `startMonth + durationMonths`). There is
no stored `endDate` field.

PR-5I introduced `contract.dates.update` (via `ContractDateAggregate`) as a controlled Domain path
that validates and updates `startDate` and `durationMonths` atomically, with a derived end-date
preview in the UI. The legacy full Contract editor (`openContractModal`) still writes those same
stored fields directly, outside the aggregate gate.

## Problem

Two code paths can write the stored Contract date facts with different guarantees: the aggregate path
is validated, audited, and atomic; the legacy path is a direct field write inside the monolithic
Contract save. Leaving the authoritative path implicit risks divergent expectations about which one is
canonical, and the long-term status of the derived `endDate` is not formally settled.

## Current State

- `contract.dates.update` is operational and behaves as specified in PR-5I: `startDate` +
  `durationMonths` only, canonical validation, one history entry, atomic rollback via
  `persistContracts()`.
- The legacy Contract editor still writes `startDate` and `durationMonths` directly.
- `endDate` is derived by `contractCalc()` and is never stored; those semantics are unchanged.
- No behavior is changed by recording this ADR.

## Options to Evaluate

1. **Aggregate is authoritative.** All Contract date edits route only through `contract.dates.update`;
   the legacy editor drops date fields from its save, with a staged UI migration.
2. **Split responsibility.** The legacy editor retains date editing for now; the aggregate path is
   documented as the canonical route without removing the legacy path.
3. **Status quo, documented.** Keep both paths and document intended usage without a code change.

Each option must also confirm whether `endDate` remains permanently derived and whether any future UI
should ever expose an editable end date (and, if so, how without introducing a second source of
truth).

## Constraints

- No runtime change.
- No UI migration.
- No implementation authorization.
- Preserve current behavior, including the derived-`endDate` model and `contractCalc()` semantics.

## Consequences

The chosen option determines whether Contract date facts have a single authoritative write path and
whether the legacy editor requires a staged migration. Because the current behavior is correct and no
stored data is at risk, the deliberate choice is to **observe and decide later** rather than force an
early boundary. This remains **Proposed**.

## Status

**Proposed.** No decision recorded.
