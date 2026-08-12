# ADR-002 — Query Layer

**Status:** Accepted · **Established by:** PR-5B (Pathfinder)

## Context

With the descriptive registry in place (ADR-001), the next step was to prove that a real call site
could be routed through the Domain facade without changing behavior. Reads are the safest place to
start: a query has no side effects, so routing one carries no risk to stored data.

## Decision

Introduce **operational query routing** through `Domain.query(name, ...args)` and migrate exactly one
read: `employee.filtered`, served by the existing `employeesFiltered` handler.

- `Domain.query` resolves the registered read-only handler and returns its result **unchanged**.
- It throws clearly on an unknown query or a missing handler — never a silent no-op.
- No mutation, persistence, or audit occurs on this path.
- Exactly one query is migrated; every other read still calls its function directly.

## Consequences

- The facade gains a working, minimal read path — the pattern later reused for commands.
- `employee.filtered` returns identical results to the direct call; behavior is unchanged.
- The verifier now asserts that exactly one operational query exists and that it is `employee.filtered`
  bound to `employeesFiltered`.
- A precedent is set: reads that become operational are registered queries routed through the facade,
  not ad-hoc function calls scattered across clients.
