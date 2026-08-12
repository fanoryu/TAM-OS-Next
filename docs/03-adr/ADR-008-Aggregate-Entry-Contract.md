# ADR-008 — Aggregate Entry Contract

**Status:** Proposed · **Backlog item:** [ARCH-001](../02-architecture/Architecture_Evolution_Backlog.md#arch-001--aggregate-entry-contract)

> **Proposed.** This ADR records a question under evaluation. It does **not** decide anything, is
> **not** Accepted, and authorizes **no** implementation. It will be revised into an Accepted decision
> only through a separate, authorized Sprint Assignment once evidence supports one of the options
> below.

## Context

The Domain layer fronts a command's handler with a business-authority aggregate. Through PR-5D, PR-5E,
and PR-5F, every aggregate exposed the same shape: `prepare(id, patch)` returning `{ ok, patch }`, and
the facade called `agg.prepare(...)` and passed `decision.patch` to the handler.

PR-5G added a lifecycle aggregate whose natural business verb is not "prepare a patch" but "decide a
transition". To keep the aggregate's language honest, PR-5G generalized routing so a command declares
its aggregate's entry method and payload key in metadata:

- `boundaryMethod` — the aggregate's decision method (defaults to `prepare`).
- `boundaryPayload` — the decision key holding the sanitized handler input (defaults to `patch`).

## Problem

There is now more than one valid aggregate entry shape, but no stated rule for **when** each shape is
appropriate. Without a contract, future aggregates may pick method names and payload keys
inconsistently, eroding the readability the explicit-language rule is meant to protect.

## Current State

- `EmployeeContactAggregate` — `prepare(id, patch)` → `{ ok, patch }`.
- `EmployeeEmploymentAggregate` — `prepare(id, patch)` → `{ ok, patch }`.
- `EmployeeLifecycleAggregate` — `transition(id, transition)` → `{ ok, transition }`.
- `Domain.command` resolves `boundaryMethod` / `boundaryPayload` from command metadata, defaulting to
  `prepare` / `patch`, so the two older commands route exactly as before.

## Options to Evaluate

1. **Two named entries by intent.** `prepare()` for field-patch updates; `transition()` for
   state-machine changes. Any other verb requires an ADR.
2. **Single canonical entry.** Normalize all aggregates to one method (e.g. `decide()`), with the
   payload key fixed, and retire `boundaryMethod` / `boundaryPayload`.
3. **Open set, metadata-driven.** Allow any well-named entry method provided the command metadata
   declares it and the verifier enforces the declaration.

## Constraints

- No speculative framework — no base/abstract aggregate, factory, registry, inheritance, or DI.
- Preserve explicit, domain-focused aggregate business language.
- Preserve backward compatibility; existing routing must remain byte-identical.
- Require evidence from additional aggregate implementations before committing to broader abstraction.

## Consequences

Deciding this shapes how every future aggregate is named and routed. Choosing too rigidly could force
unnatural verbs onto genuine business operations; choosing too loosely could scatter conventions.
Because the cost of waiting is low (defaults keep current behavior stable) and the value of evidence is
high, this remains **Proposed** until more aggregates exist to learn from.

## Status

**Proposed.** No decision recorded.
