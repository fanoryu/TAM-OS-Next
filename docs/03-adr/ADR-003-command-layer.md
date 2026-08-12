# ADR-003 — Command Layer

**Status:** Accepted · **Established by:** PR-5C.1 (Contact Command)

## Context

The query layer (ADR-002) proved read routing. The write side is where business truth matters most,
and where risk to stored data is highest. A first operational command was needed to establish how
state changes flow through the Domain — narrowly, safely, and without changing behavior.

## Decision

Introduce **operational command routing** through `Domain.command(name, ...args)` and migrate exactly
one narrow, non-financial, non-lifecycle write: `employee.contact.update`, served by the existing
`updateEmployeeContact` handler (contact fields only: `phone`, `email`, `notes`).

- `Domain.command` resolves the registered handler and calls it **exactly once** (a single
  `fn.apply`, no loop), returning its typed outcome unchanged.
- The handler remains the **implementation authority**: its own validation, mutation, single persist,
  history entry, and atomic rollback are unchanged.
- The facade adds **no** authorization and, at this stage, **no** aggregate enforcement.
- There is **no** legacy `dispatch`/`ask` surface; the facade only routes the migrated command.
- Exactly one command is migrated; the monolithic employee save stays direct.

## Consequences

- The facade gains a working write path with typed outcomes, later fronted by an aggregate (ADR-004).
- Contact updates behave identically to before; the narrow editor calls `Domain.command(...)` instead
  of the handler directly.
- The verifier now asserts exactly one operational command exists, bound to its handler, invoked
  exactly once, touching only the allowlisted fields.
- The pattern is set: operational writes are registered commands routed through the facade, with the
  handler owning all side effects.
