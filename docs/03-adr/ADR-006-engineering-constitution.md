# ADR-006 — Engineering Constitution

**Status:** Accepted · **Established by:** DOC-001 (Project Governance Initialization)

## Context

The enforceable engineering rules already existed in [`CLAUDE.md`](../../CLAUDE.md) (and its
AI-facing mirror `AGENTS.md`), but their *intent* — the reasoning that makes the rules cohere — was
not written down as a small, memorable set of laws. New engineers and AI assistants had to infer the
philosophy from twenty numbered sections and from prior pull requests. The project needed a durable,
narrative constitution that states the enduring laws and names the Product Motto, without weakening
or duplicating the enforceable rules.

## Decision

Adopt the [Engineering Constitution](../00-governance/Engineering_Constitution.md) — **The Eleven
Engineering Laws** — as the narrative constitutional layer, anchored by the Product Motto: *business
truth lives in the Domain; everything else is a client.*

- The eleven laws express the enduring intent behind the rules: Domain authority, architecture
  preservation, one source of truth, determinism, additive-over-destructive, aggregate/handler split,
  explicit commands and queries, the verifier as gate, one-PR-one-purpose, no knowledge loss, and
  AI as a Domain client (Law XI).
- The Constitution is **narrative**; the enforceable, rule-by-rule form with the Approval Matrix and
  Definition of Done remains `CLAUDE.md`. Where the two could be read differently, `CLAUDE.md`
  governs — the Constitution never weakens an invariant, it explains one.
- The Constitution is version-agnostic and timeless; current state lives in the Roadmap and
  `AI_CONTEXT.md`.

## Consequences

- The project has a self-documenting statement of *why* its rules exist, readable without prior chat
  history.
- Precedence is explicit, so the narrative and enforceable layers cannot drift into conflict: the
  rules win.
- The governance library (values, principles, standards, ADRs) hangs coherently off the eleven laws,
  and future work can cite a specific law as its rationale.

> **Forward pointer (PR-5G review, not a rewrite).** This ADR records the **eleven** laws adopted at
> DOC-001 and is left intact per ADR immutability (`CLAUDE.md` §16.2). The Constitution is a living
> document and is the authoritative source of the current law set; **Law XII — Documentation Is
> Executable Knowledge** was added to it later, during the PR-5G Atlas Review. This note tracks that
> pointer without altering the decision above.
