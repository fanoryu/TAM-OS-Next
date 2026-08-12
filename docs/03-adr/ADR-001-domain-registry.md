# ADR-001 — Domain Registry

**Status:** Accepted · **Established by:** PR-5 / PR-5A (Enterprise Foundation)

## Context

Business truth — which aggregates exist, what invariants they hold, which functions serve as
commands and queries — was implicit, spread across the application's functions and known only from
reading the code or prior conversations. There was no single place that named the domain map, and
therefore no anchor for future consolidation of business logic.

The application is a single shared global scope of classic scripts with no framework, no bundler,
and no runtime dependencies. Any domain layer had to fit that architecture exactly and change no
runtime behavior.

## Decision

Introduce a **descriptive Domain registry**: frozen, read-only modules under `js/domain/` that
document the domain map without altering behavior.

- `DOMAIN_AGGREGATES` + `DOMAIN_INVARIANTS` (`aggregates.js`) — aggregate roots and the invariants
  they enforce elsewhere.
- `DOMAIN_COMMANDS` (`commands.js`) — state-changing commands mapped to their existing handler names.
- `DOMAIN_QUERIES` (`queries.js`) — side-effect-free reads mapped to their existing handler names.
- `DOMAIN_EVENTS` (`events.js`) — descriptive domain events.
- A frozen `Domain` facade (`domain-layer.js`) that exposes the registries and can *resolve* — not
  invoke — a handler by name.

Handlers are referenced by **name** and resolved on demand, so the registry carries no load-order
dependency on the handlers and never calls them. Nothing in the registry executes at load time.

## Consequences

- A single, authoritative map of the domain now exists, enabling the query, command, and aggregate
  slices that follow.
- Because the registry is purely descriptive and frozen, it changes no runtime behavior and adds no
  risk to stored data.
- The registry becomes a verifier target: identifiers must be unique, and every registered handler
  name must resolve to a real function in the build.
- A discipline is set: new domain facts are registered here rather than rediscovered from code.
