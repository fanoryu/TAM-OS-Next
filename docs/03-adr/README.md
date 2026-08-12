# 03 — Domain Architecture Decision Records

This register records the **Domain-layer** architecture decisions. Each ADR captures one decision — its
context, the decision itself, its consequences, and its status. ADRs are **immutable once Accepted**: a
later decision supersedes an ADR with a new record that links back; it never rewrites history. An ADR
may also be **Proposed** — an open question under evaluation that records no decision and authorizes no
implementation.

## Two registers, one convention

This repository keeps two decision-record series with distinct scopes and distinct numbering, so
there is no ambiguity about which governs what:

| Series | Location | Scope | Numbering |
|---|---|---|---|
| **Domain ADRs** | this folder (`docs/03-adr/`) | Domain-layer architecture (registry, query, command, aggregate, helpers, AI positioning) | `ADR-001`, `ADR-002`, … (three digit) |
| **Repository ADRs** | [`docs/03b-repository-adr/`](../03b-repository-adr/README.md) | Documentation & repository governance model | `ADR-NNNN` (four digit, e.g. `ADR-0001`) |

Security decisions live in [`docs/security/`](../security/README.md) as SDRs. The three series never
share a number and never overlap in scope.

## Lifecycle

`Proposed → Accepted → (Superseded | Deprecated)` — an Accepted ADR stays in place, read-only, and
links forward if it is ever superseded.

## Register

| ADR | Title | Status | Established by |
|---|---|---|---|
| [ADR-001](ADR-001-domain-registry.md) | Domain Registry | Accepted | PR-5 / PR-5A |
| [ADR-002](ADR-002-query-layer.md) | Query Layer | Accepted | PR-5B |
| [ADR-003](ADR-003-command-layer.md) | Command Layer | Accepted | PR-5C.1 |
| [ADR-004](ADR-004-aggregate-pattern.md) | Aggregate Pattern | Accepted | PR-5D / PR-5E |
| [ADR-005](ADR-005-ai-is-a-domain-client.md) | AI Is a Domain Client | Accepted | DOC-001 |
| [ADR-006](ADR-006-engineering-constitution.md) | Engineering Constitution | Accepted | DOC-001 |
| [ADR-007](ADR-007-shared-aggregate-helpers.md) | Shared Aggregate Helpers | Accepted | PR-5F |
| [ADR-008](ADR-008-Aggregate-Entry-Contract.md) | Aggregate Entry Contract | **Proposed** | PR-5G review ([ARCH-001](../02-architecture/Architecture_Evolution_Backlog.md#arch-001--aggregate-entry-contract)) |
| [ADR-009](ADR-009-Employment-vs-Lifecycle-Responsibility.md) | Employment vs Lifecycle Responsibility | **Proposed** | PR-5G review ([ARCH-002](../02-architecture/Architecture_Evolution_Backlog.md#arch-002--employment-vs-lifecycle-responsibility)) |
| [ADR-010](ADR-010-Compensation-Write-Authority.md) | Compensation Write Authority | **Proposed** | PR-5H review ([ARCH-003](../02-architecture/Architecture_Evolution_Backlog.md#arch-003--compensation-write-authority)) |
| [ADR-011](ADR-011-Contract-Date-Model-Authority.md) | Contract Date Model Authority | **Proposed** | PR-5I review ([ARCH-004](../02-architecture/Architecture_Evolution_Backlog.md#arch-004--contract-date-model-authority)) |
| [ADR-012](ADR-012-Contract-Overlap-Enforcement.md) | Contract Overlap Enforcement | **Proposed** | PR-5I review ([ARCH-005](../02-architecture/Architecture_Evolution_Backlog.md#arch-005--contract-overlap-enforcement)) |
| [ADR-013](ADR-013-Repository-Layer.md) | Repository Layer (entity-named, collection-grained) | Accepted | PR-8A … PR-11A; direction ATR-008, validated ATR-009 / ATR-010 |
| [ADR-014](ADR-014-Contract-Core-Field-Authority.md) | Contract Core Field Authority | Accepted | OQ-1 discovery ([ARCH-008](../02-architecture/Architecture_Evolution_Backlog.md#arch-008--contract-authority-reconciliation-addendum)); product decisions PD-1 / PD-2 |

**Proposed** ADRs (ADR-008 through ADR-012) record open questions from the PR-5G, PR-5H, and PR-5I
Atlas Reviews. They are not Accepted, record no decision, and authorize no implementation; see the
[Architecture Evolution Backlog](../02-architecture/Architecture_Evolution_Backlog.md).

[ADR-013](ADR-013-Repository-Layer.md) is **Accepted** and records the Repository layer delivered across
Milestones Delta and Epsilon: three entity-named repositories on one unevolved, collection-grained
`save()` contract, mediating all seven aggregate-backed handlers (7 of 7). It states explicitly that this
is **not** full persistence abstraction and implies **no** backend.

[ADR-014](ADR-014-Contract-Core-Field-Authority.md) is **Accepted** and establishes the permanent
ownership boundary for every mutable Contract field: one `ContractCoreAggregate` behind one
`contract.core.update` command owning the identity, link, compensation, schedule and notes fields, with
status, the date extent and renewal unchanged under their existing aggregates. It resolves **OQ-1**;
**OQ-2 and OQ-3 remain open**. Like the Proposed ADRs above, it authorizes **no** implementation — it
decides ownership only.
