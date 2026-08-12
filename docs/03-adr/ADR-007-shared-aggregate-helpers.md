# ADR-007 — Shared Aggregate Helpers

**Status:** Accepted · **Established by:** PR-5F (The Sentinel)

## Context

After the second aggregate (`EmployeeEmploymentAggregate`, ADR-004) landed, two aggregates contained
the same building blocks: a read-only existence check, an allowlist-and-trim projection, and — within
the employment aggregate — a repeated enum-membership test. Duplicated business-support logic invites
drift: a fix or refinement made in one aggregate could silently diverge from the other, violating the
single-source-of-truth law.

The risk was over-correction: a generic "aggregate framework" (base class, factory, registry,
inheritance, dependency injection) would contradict the architecture's preference for explicit, boring
code and add abstraction with no second-caller justification.

## Decision

Extract only the logic already duplicated across aggregates into a small toolkit,
`js/domain/aggregate-helpers.js`, as explicit pure functions — and nothing more:

| Helper | Purpose |
|---|---|
| `employeeExists(id)` | Read-only existence lookup → the record or `null` |
| `normalizeAllowedFields(patch, allow)` | Allowlist projection + trim into a fresh object |
| `validateEnum(value, allowed)` | Pure membership test against a canonical enum |

- Helpers are **pure** business-support utilities: no `State` mutation, no `persistEmployees()`, no
  history, no `updatedAt`, no render, no `localStorage`, no audit.
- The aggregates keep their **typed-failure and success returns literal**, so business rules stay
  visible in each aggregate; helpers reduce duplication, they do not hold authority.
- **No** framework: no base/abstract aggregate, factory, registry, inheritance, or dependency
  injection.
- Runtime behavior is unchanged — verified by an equivalence check comparing pre- and post-refactor
  aggregate output across many fabricated inputs, with zero differences.

## Consequences

- The shared logic now lives in one place; a future refinement updates both aggregates at once.
- A small, reusable toolkit is available for future aggregates without pre-committing to a framework.
- The verifier enforces helper presence and load order (before both aggregates), helper purity, and
  that both aggregates actually consume the helpers, while the operational counts (2 aggregates, 2
  commands, 1 query) remain unchanged.
