# ADR-004 — Aggregate Pattern

**Status:** Accepted · **Established by:** PR-5D (The Steward) and PR-5E (The Custodian)

## Context

Command routing (ADR-003) gave the facade a write path, but the business decision — whether a change
is allowed and what the sanitized input is — still lived only inside the handler, mixed with mutation
and persistence. To make business truth explicit, testable, and reusable, the decision needed its own
home, separate from implementation (Law VI).

## Decision

Introduce **aggregate boundaries** as the business authority in front of a command's handler.

- An aggregate exposes `prepare(id, patch)`, a **pure** function that performs a read-only existence
  check, applies a strict field allowlist, trims and normalizes values, validates constrained fields
  against canonical enums, and returns either a **sanitized patch** (`{ ok:true, patch }`) or a
  **typed business failure** (`{ ok:false, error }`).
- A command may declare a `boundary` aggregate. `Domain.command` calls `prepare` first: on failure it
  returns a typed failure and **never calls the handler**; on success it passes the sanitized patch
  to the handler.
- The **handler remains the implementation authority** — it keeps its own guards and owns mutation,
  `updatedAt`, the single history entry, the single persist, and full rollback on failure.
- Aggregates are **pure**: no `State` mutation, no `persistEmployees()`, no history, no `updatedAt`,
  no render, no `localStorage`, no audit.

Established with `EmployeeContactAggregate` (PR-5D) and `EmployeeEmploymentAggregate` (PR-5E).

## Consequences

- "What the business allows" now has a single, isolated, trivially testable home per bounded area.
- A rejected decision cannot reach the handler, so no partial mutation and nothing persists on
  failure — atomicity is preserved by construction.
- The verifier enforces aggregate purity, the handler's ownership of side effects, and the typed
  failure set for each aggregate.
- The pattern generalizes: each future controlled write adds one aggregate + one command + one
  handler, following this exact split (see the Domain Expansion phase of the Roadmap).
