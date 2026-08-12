# ADR-013 — Repository Layer (Entity-Named, Collection-Grained)

**Status:** Accepted · **Established by:** PR-8A (The Repository) … PR-11A (The Payroll Foundation) ·
**Direction set by:** ATR-008 (Hybrid Repository direction) · **Validated by:** ATR-009 (Contract), ATR-010 (Payroll)

## Context

Before PR-8A, every aggregate-backed handler called its collection persist function directly
(`persistEmployees()`, `persistContracts()`, `persistPayrollPlans()`), each of which delegates to
`persistHR(stateKey)` → `StorageAdapter.set(...)`. Persistence mechanics — invoking the write and
interpreting its strict boolean — were therefore duplicated across every handler, mixed in with
business behavior that legitimately belongs to the handler.

The risk in fixing this was over-correction. A generic repository framework (base class, factory,
registry, unit of work, transaction manager) would contradict the architecture's preference for
explicit, boring code, add abstraction with no second-caller justification, and — worse — invite the
Repository to absorb business responsibilities that must stay with the Domain and the handlers.

A second risk was scope creep in the other direction: treating "introduce a Repository" as a mandate
to route *all* persistence through it, including compound multi-store operations whose transaction
boundary no simple contract can express.

## Decision

Introduce a **persistence-mechanics boundary** between handler mutation and the existing collection
persistence, as **entity-named repository modules** under `js/repository/` — and nothing more.

### The modules

| Repository | Module | Collection | Delegates to |
|---|---|---|---|
| `EmployeeRepository` | `js/repository/employee-repository.js` | employees | `persistEmployees()` |
| `ContractRepository` | `js/repository/contract-repository.js` | contracts | `persistContracts()` |
| `PayrollRepository` | `js/repository/payroll-repository.js` | payrollPlans | `persistPayrollPlans()` |

Each is a frozen object exposing exactly one method. This is the **Hybrid direction** (ATR-008): the
three repositories share identical mechanics, and the *name* marks the collection. They are siblings,
not specializations — there is no shared base, no factory, no registry.

### The contract

```
async save() → { ok: true }
             → { ok: false, error: 'PersistFailed' }
```

The contract is:

- **Collection-grained** — one `save()` writes one in-memory collection. It models no unit of work
  spanning collections.
- **Client-side** — it terminates at the existing `StorageAdapter`, which is the storage-backend
  boundary. It contains no network surface.
- **Strict** — the underlying `persistHR` returns `ok === true`; the Repository normalizes that into an
  explicit result. Handlers test `persisted.ok !== true`. Truthy/falsy handling is prohibited.

### Ownership

| Layer | Owns |
|---|---|
| **Domain aggregate** | **Business authority** — transition rules, legality, sanitized decisions |
| **Handler** | **Implementation authority** — validation (defense-in-depth), mutation, `updatedAt`, history, the persistence decision, rollback, the typed result |
| **Repository** | **Persistence mechanics only** — delegate the write, normalize the result |
| **StorageAdapter** | Storage-backend boundary (unchanged) |

The Repository owns **no** business behavior: no validation, no mutation, no `updatedAt`, no history,
no rollback, no UI, **no audit**, and no Domain or Aggregate access. It never reinterprets a business
outcome. Rollback in particular stays with the handler — on a failed persist the handler restores every
mutated field, pops its history entry, restores `updatedAt`, and returns its typed `PersistFailed`.

### The Payroll audit exception

`transitionPayrollLifecycle` is the only one of the seven aggregate-backed handlers that writes a
best-effort audit entry. That audit **remains handler-owned**: inside the handler, after successful
Repository persistence, in the success path only, `try/catch`-wrapped, absent from the rollback path,
and never emitted on persistence failure. It was deliberately **not** moved into `PayrollRepository`,
and the Contract-slice verifier rule prohibiting audit calls was deliberately **not** generalized to
Payroll. Audit semantics are business semantics; the Repository does not own them.

### What stays direct

**Non-aggregate persistence remains direct.** Whole-record editors, deletes, generation, regeneration,
salary overrides, onboarding reset, and the one-time v2.5 schema migration continue to call their
persist function directly.

**Compound persistence remains direct.** Three operations write more than one store in a single logical
unit and are outside this boundary by design:

- `commitReadyPayroll` (`js/people/payroll-ops-engine.js`) — four stores;
- payroll-planning posting (`js/people/payroll-planning.js`) — four stores;
- Contract renewal (`js/people/contracts.js`) — mutates the predecessor and creates the successor.

These are **not unfinished work**. A collection-grained `save()` cannot express their transaction
boundary, and pretending otherwise would make the contract dishonest. The verifier asserts each of them
stays direct so the boundary cannot drift silently.

## The bounded meaning of "7 of 7"

Aggregate-backed Repository adoption is complete at **7 of 7**: Employee 4 of 4, Contract 2 of 2,
Payroll 1 of 1.

That figure means **exactly one thing**: every aggregate-backed handler delegates its persistence
through an entity-named Repository.

It does **not** mean:

- that all persistence operations are Repository-mediated — the layer mediates **3 collections out of
  11** persist functions, and direct writes remain even within those three;
- that non-aggregate writes are mediated;
- that compound persistence is solved;
- that multi-store transactions are supported;
- that **full persistence abstraction** is complete;
- that **backend readiness** is achieved.

**Aggregate-backed adoption completion and full persistence abstraction are different properties.**
The first is complete; the second is not, and this ADR does not claim or schedule it.

## No backend implication

This ADR **authorizes no backend work**. The application is client-only by constitutional rule
([`CLAUDE.md`](../../CLAUDE.md) §4.3: "No server, database, or API is introduced"). Introducing one
would require a constitutional amendment and a separate, explicitly authorized decision record.

The Repository is **not** a remote-persistence seam, and its existence must not be read as preparation
for one. The verifier asserts that every repository module is free of network surface (`fetch`,
`XMLHttpRequest`, WebSocket, endpoint/server references) and free of transaction or unit-of-work
constructs.

## Alternatives considered

- **A single generic `Repository`** parameterized by collection — rejected: it would centralize a
  detail that is already one line per module, and would create a natural home for future business
  logic. Entity-named siblings keep each boundary trivially auditable.
- **A base class / factory / registry** — rejected for the same reason ADR-007 rejected an aggregate
  framework: abstraction without a second-caller justification.
- **A unit-of-work / transaction abstraction** to absorb the compound paths — rejected as premature.
  The compound paths deserve their own architecture review; inventing a transaction model to
  accommodate them mid-adoption would have changed the contract for all seven slices.
- **Moving rollback (or the Payroll audit) into the Repository** — rejected: both are business
  semantics. A persistence-mechanics layer that rolls back or audits is no longer persistence
  mechanics.

## Consequences

- Persistence mechanics live in one place per collection; the strict-boolean normalization is written
  once per repository rather than once per handler.
- The pattern proved reproducible three times over with **no contract evolution**: the contract has
  been byte-identical since PR-8A across seven consumers and three modules. Maturity advanced through
  **adoption breadth**, not contract expansion.
- The Platform paid **zero cost**: across the seven-slice arc the operational surface (7 aggregates /
  7 aggregate-backed commands / 1 aggregate-backed query) and registered surface (13 commands /
  4 queries) never moved, no Domain operation was added or removed, and no migration was required.
- The verifier enforces the boundary and its limits: module presence, load order (after the persist
  function, before the migrated handler), frozen shape, single `save`, exactly-one delegation, the
  strict result contract, per-repository purity (including no audit), handler-owned rollback, the
  Payroll audit invariant, the fenced direct paths, and a dedicated milestone section asserting
  7 of 7 **alongside** the assertion that persistence abstraction is *not* complete.
- **The next architectural question is compound persistence**, not backend adoption — it is the only
  remaining question whose answer would change the shape of this contract rather than its reach.

## Related

- [RDR-011](../99-archive/RDR/RDR-011-epsilon-repository-snapshot.md) — repository baseline at adoption completion
- [DPR-009](../99-archive/DPR/DPR-009-epsilon-repository-adoption-completion.md) — Epsilon completion report
- [ADR-004](ADR-004-aggregate-pattern.md) — Aggregate Pattern (business authority)
- [ADR-007](ADR-007-shared-aggregate-helpers.md) — the precedent for refusing a framework
- [`ARCHITECTURE.md` §18](../../ARCHITECTURE.md) — Repository layer implementation detail
