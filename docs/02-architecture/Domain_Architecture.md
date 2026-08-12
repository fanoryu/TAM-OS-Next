# Domain Architecture

The Domain layer is a thin, additive layer over the existing application functions. It is the single
authority on business truth (Law I); the UI, import pipeline, tooling, and AI are its clients. It
introduces no framework, no dependency, and no ES modules — it is classic `<script>` modules in the
same shared global scope as the rest of the application.

## Modules

All Domain modules live under `js/domain/` and load, in order, after every application function is
defined and before bootstrap:

| Module | Role |
|---|---|
| `aggregates.js` | `DOMAIN_AGGREGATES`, `DOMAIN_INVARIANTS` — descriptive registry of aggregate roots and their invariants |
| `commands.js` | `DOMAIN_COMMANDS` — registry of state-changing commands (id → aggregate, boundary, handler, transition) |
| `queries.js` | `DOMAIN_QUERIES` — registry of side-effect-free queries (id → handler, result shape) |
| `events.js` | `DOMAIN_EVENTS` — descriptive registry of domain events |
| `aggregate-helpers.js` | Shared pure helpers used by aggregates (`employeeExists`, `normalizeAllowedFields`, `validateEnum`) |
| `employee-contact-aggregate.js` | `EmployeeContactAggregate` — business authority for `employee.contact.update` |
| `employee-employment-aggregate.js` | `EmployeeEmploymentAggregate` — business authority for `employee.employment.update` |
| `domain-layer.js` | `Domain` — the frozen, read-only facade that resolves and routes commands and queries |

## Load order is behavior-critical

The load order is defined once in [`tools/module-order.js`](../../tools/module-order.js) and mirrored
by `index.html`. The build inlines modules in exactly this order; the verifier asserts the manifest
and `index.html` agree. The helpers load **before** the aggregates that consume them, and every
aggregate loads **before** the facade that routes to it.

## The facade

`Domain` is an `Object.freeze`d singleton exposing:

- **Descriptive registries** — `aggregates`, `invariants`, `commands`, `queries`, `events`.
- **`commandHandler(name)` / `queryHandler(name)`** — *resolve* (return) the registered global
  handler function, or `null`. They never invoke it.
- **`query(name, ...args)`** — resolve and call the registered read-only handler; return its result
  unchanged. Throws clearly on an unknown query or a missing handler.
- **`command(name, ...args)`** — the operational write path (see below).

There is **no** legacy `dispatch`/`ask` surface. The facade routes exactly the migrated query and the
migrated commands; every other read and write in the application still calls its function directly.

## How an operational command flows

For a command that declares a `boundary` aggregate:

```
Client (UI / AI)
   │  Domain.command('employee.employment.update', id, patch)
   ▼
Domain facade
   │  1. look up the command; resolve its handler by name
   │  2. call boundary aggregate:  agg.prepare(id, patch)
   ▼
Aggregate (business authority)     ── pure: reads existence, allowlists, trims,
   │  returns { ok:true, patch }      validates enums, normalizes; NO side effects
   │  or     { ok:false, error }
   ▼
   ├─ ok:false  → facade returns { success:false, error } ; handler is NEVER called
   └─ ok:true   → facade calls the handler exactly once with the sanitized patch
                     ▼
                  Handler (implementation authority)
                     mutate allowed fields · update updatedAt · append one history
                     entry · persist once · roll back fully on failure → typed result
```

The aggregate decides; the handler implements (Law VI). A rejected aggregate decision never reaches
the handler, so no field changes, nothing persists, and no history is written.

## Purity and authority boundaries

- **Aggregates and helpers are pure.** They never mutate `State`, call `persistEmployees()`, append
  history, update `updatedAt`, render UI, access `localStorage`, or perform audit logging. The
  verifier enforces this by scanning their source.
- **Handlers own all side effects.** Mutation, persistence, the single history entry, and full
  rollback on a failed persist live only in the handler.

## What is operational today

- **Aggregates:** `EmployeeContactAggregate`, `EmployeeEmploymentAggregate`.
- **Commands:** `employee.contact.update`, `employee.employment.update`.
- **Queries:** `employee.filtered`.

All other registry entries remain **descriptive** — they document existing handlers without yet
routing through the facade. Widening this operational surface is the Domain Expansion phase of the
[Roadmap](../01-roadmap/Domain_Roadmap.md).
