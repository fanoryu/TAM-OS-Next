# ADR-005 — AI Is a Domain Client

**Status:** Accepted · **Established by:** DOC-001 (Project Governance Initialization)

## Context

AI coding assistants already contribute to this repository, and a future in-product intelligence
layer is on the roadmap. Without an explicit rule, an AI could become a second place where business
rules are decided or a privileged path that reaches state without the aggregate gate — quietly
undermining the guarantees the Domain exists to provide.

The Product Motto states the principle plainly: *business truth lives in the Domain; everything else
is a client.* AI needed to be named, unambiguously, as one of those clients.

## Decision

Establish that **AI is a Domain client**, never an authority, in both of its roles:

- **The engineering AI** (working on the repository) is governed by [`AGENTS.md`](../../AGENTS.md) and
  the governance library. It reads the Constitution, Core Values, Roadmap, and relevant ADRs before
  implementing; works through registered commands and queries; respects the verifier and the Approval
  Matrix; and never bypasses the Domain to reach state directly. It proposes and prepares; humans
  authorize commit, merge, and release.
- **A future in-product intelligence layer** consumes registered **queries**, invents no business
  rules, and expresses any suggested action as a registered **command** subject to the same aggregate
  gate, typed failures, and audit path as a human action. Consistent with the client-only
  architecture, it transmits no user data.

This is captured as Law XI of the [Engineering Constitution](../00-governance/Engineering_Constitution.md).

## Consequences

- The system's guarantees hold regardless of who initiates a change; correctness lives once, in the
  aggregate, and every client inherits it.
- There is no privileged AI path that skips validation — an AI-originated command fails exactly as any
  other client's would.
- The architectural contract for the not-yet-built intelligence layer is fixed now, so it cannot later
  be implemented as a parallel source of truth. See
  [AI_Architecture.md](../02-architecture/AI_Architecture.md).
