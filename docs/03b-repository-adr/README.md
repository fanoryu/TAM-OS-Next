# Architecture Decision Records (ADR)

Architecture-level decisions for TAM Intelligence OS. Each ADR captures one decision, its
rationale, and its revalidation trigger. ADRs are **immutable once Accepted** — a later decision
supersedes an ADR with a new record that links back; it never rewrites history
(`CLAUDE.md` §14.4, §16.2).

New ADR: copy [`TEMPLATE.md`](TEMPLATE.md), number it `ADR-NNNN` (next in sequence, never reused),
add it to the register below, and link it from any related record.

## Lifecycle

`Proposed → Accepted → (Superseded | Deprecated)`

- **Proposed** — drafted, awaiting the `CLAUDE.md` §20 approver.
- **Accepted** — approved and authoritative.
- **Superseded** — replaced by a newer ADR (stays in place, read-only, links forward).
- **Deprecated** — guidance retired without a 1:1 successor.

## Register

| ADR | Title | Status | Date | Superseded by |
|---|---|---|---|---|
| [ADR-0001](ADR-0001-documentation-governance-model.md) | Documentation Governance & Lifecycle Model | Accepted | 2026-08-01 | — |
| [ADR-0002](ADR-0002-canonical-distribution-architecture.md) | Canonical Distribution Architecture — single-file artifact vs. application package | Accepted | 2026-08-11 | — |
| [ADR-0003](ADR-0003-shared-multi-user-architecture.md) | Shared Multi-User Architecture — one authoritative company dataset behind a server-enforced trust boundary | Accepted | 2026-08-12 | — |

## Timeline

- **2026-08-01** — ADR-0001 Accepted (documentation governance model; PR-4 / PR-4.1).
- **2026-08-11** — ADR-0002 Accepted (canonical distribution architecture; Model A retained for the
  v2.10.0 controlled pilot, Model B deferred to Distribution-1).
- **2026-08-11** — ADR-0003 Proposed (shared multi-user architecture; Multi-User-0).
- **2026-08-12** — ADR-0003 **Accepted** as the Multi-User-0 architecture **baseline**. Acceptance
  settles the direction only: it authorizes **no** implementation, backend provisioning, migration,
  runtime or schema change, and **no** `CLAUDE.md` amendment. `CLAUDE.md` §4.3 remains fully operative
  and continues to **block implementation** until amended through its own milestone.

*Security decisions live in [`../security/`](../security/README.md) as SDRs. Engineering decision
records (EDR) referenced from workflows are tracked in their originating decision packages.*
