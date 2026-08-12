# AI Architecture

TAM Intelligence OS treats an AI assistant the way it treats the UI and the import pipeline: as a
**client** of the Domain, never as a source of business truth (Law XI, and the Product Motto —
*business truth lives in the Domain; everything else is a client*).

This document describes the architectural position of AI in the system as it stands today. It is a
positioning statement, not a feature description: the application ships no AI runtime and transmits no
data.

## Position in the system

```
        ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
        │      UI       │   │    Import     │   │  AI assistant │   ← clients
        └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
               │                  │                  │
               └───────────  Domain facade  ─────────┘
                        (commands · queries · aggregates)
                                   │
                          Handlers → State → storage
```

Every client reaches business truth through the same door — the `Domain` facade. None of them holds
authority the others lack.

## Two kinds of AI client

1. **The engineering AI** — an AI coding assistant working *on* the repository. It is governed by
   [`AGENTS.md`](../../AGENTS.md) and this governance library. It must read the Constitution, Core
   Values, Roadmap, and relevant ADRs before implementing; work through registered commands and
   queries; respect the verifier and the Approval Matrix; and never bypass the Domain to reach state
   directly. It proposes and prepares; humans authorize the gates (commit, merge, release).

2. **A future in-product intelligence layer** — read-only analytical and advisory capability *inside*
   the product. Its architectural contract is fixed in advance: it consumes registered **queries**,
   it does not invent business rules, and any action it suggests is expressed as a registered
   **command** that flows through the same aggregate gate as a human action. It is a client, subject
   to the identical validation, typed failures, and audit path. This layer is on the
   [Roadmap](../01-roadmap/Domain_Roadmap.md) (Intelligence Layer phase) and is **not** implemented
   today; only its guarantees are pre-committed here.

## Invariants for any AI client

- **No parallel truth.** AI never becomes a second place where "what the business allows" is decided.
  Validation and normalization stay in the aggregate.
- **Reads via queries, writes via commands.** No AI path mutates state outside a registered command
  and its aggregate gate.
- **Same failure surface.** An AI-originated command receives the same typed failures as any other
  client; there is no privileged path that skips the aggregate.
- **Client-only, offline.** Consistent with the client-only architecture, no user data is transmitted
  to an external service as part of any in-product AI behavior.

## Why this matters

Positioning AI as a Domain client keeps the system's guarantees intact no matter who or what initiates
a change. The aggregate is the one place that must be correct; every client — human, import, or AI —
inherits that correctness rather than re-implementing it.
