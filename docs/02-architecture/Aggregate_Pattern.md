# The Aggregate Pattern

An **aggregate** is the business authority for a bounded set of changes. A **handler** is the
implementation authority that carries them out. The pattern keeps a single, testable place for
"is this allowed and what does it mean" separate from "how the change is applied and persisted"
(Law VI).

This document describes the pattern as implemented by `EmployeeContactAggregate` and
`EmployeeEmploymentAggregate`.

## The two roles

### Aggregate — decides (pure)
`Aggregate.prepare(id, patch)` is a pure function that:

1. Performs a **read-only** existence check (`employeeExists(id)`).
2. Projects the input onto a **strict allowlist**, discarding every other field, and **trims**
   string values (`normalizeAllowedFields`).
3. Applies domain normalization (e.g. an empty `joinDate` becomes `null`).
4. **Validates** constrained values against canonical enums (`validateEnum`).
5. Returns either a **sanitized patch** or a **typed business failure**.

It has **no side effects**: no `State` mutation, no `persistEmployees()`, no history, no `updatedAt`,
no rendering, no `localStorage`, no audit logging.

### Handler — implements (all side effects)
`updateEmployee<Area>(id, patch)` is the implementation authority. It keeps its own guards
(defense in depth) and then:

1. Mutates **only** allowed fields.
2. Updates `updatedAt`.
3. Appends **exactly one** history entry describing what changed.
4. Calls `persistEmployees()` **exactly once**.
5. On a failed persist, performs a **full rollback** — restores every changed field and `updatedAt`,
   removes the new history entry — and returns a typed `PersistFailed`.
6. Returns a typed `{ success, ... }` result.

## The contract shape

```js
// Aggregate result
{ ok: true,  patch: { /* sanitized, allowlisted, trimmed, validated */ } }
{ ok: false, error: 'EmployeeNotFound' | 'No<Area>FieldsProvided' | 'Invalid<Field>' }

// Handler result
{ success: true,  data: employee }
{ success: false, error: 'EmployeeNotFound' | '...' | 'PersistFailed' }
```

## Worked examples

### `EmployeeContactAggregate`
- **Allowlist:** `phone`, `email`, `notes`.
- **Typed failures:** `EmployeeNotFound`, `NoContactFieldsProvided`.
- **Handler:** `updateEmployeeContact` — one persist, one `contact-edited` history entry, full
  rollback on failure.

### `EmployeeEmploymentAggregate`
- **Allowlist:** `jobTitle`, `department`, `employmentStatus`, `joinDate`, `contractType`.
- **Normalization:** empty `joinDate` → `null`.
- **Validation:** `employmentStatus` ∈ `EMPLOYMENT_STATUSES`; `contractType` ∈ `CONTRACT_TYPES`.
- **Typed failures:** `EmployeeNotFound`, `NoEmploymentFieldsProvided`, `InvalidEmploymentStatus`,
  `InvalidContractType`.
- **Handler:** `updateEmployeeEmployment` — one persist, one `employment-edited` history entry, full
  rollback on failure.

## Shared helpers

Logic common to both aggregates is extracted into `js/domain/aggregate-helpers.js` (PR-5F) as small,
explicit, pure functions — **not** a framework:

| Helper | Purpose |
|---|---|
| `employeeExists(id)` | Read-only existence lookup → the record or `null` |
| `normalizeAllowedFields(patch, allow)` | Allowlist projection + trim into a fresh object |
| `validateEnum(value, allowed)` | Pure membership test against a canonical enum |

There is deliberately **no** `AggregateBase`, factory, registry, inheritance, or dependency
injection. Helpers reduce duplication; they never hold business authority or perform side effects.

## Why the split matters

- **One place to reason about permission.** Whether a change is allowed is decided in the aggregate,
  in isolation, and is trivially testable with fabricated data.
- **Atomicity is the handler's job.** All-or-nothing mutation and rollback live where the side
  effects live, so a rejected decision cannot leave partial state.
- **Clients hold no authority.** A UI form or an AI assistant calls `Domain.command(...)`; it cannot
  reach the handler directly and cannot invent its own rules.
