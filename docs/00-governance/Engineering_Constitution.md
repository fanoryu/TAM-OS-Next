# Engineering Constitution — The Twelve Engineering Laws

TAM Intelligence OS is a proprietary, client-side finance, payroll, and operations application for
PT Total Asset Manajemen. It handles confidential data, runs entirely in the browser, and ships as a
single self-contained file. Those facts make correctness and data safety non-negotiable and make
discipline the cheapest insurance we have.

This document states the laws that govern every engineering change. They are timeless and
version-agnostic. The enforceable, rule-by-rule form of these laws — with the Approval Matrix and
the Definition of Done — lives in [`CLAUDE.md`](../../CLAUDE.md) / [`AGENTS.md`](../../AGENTS.md).

---

## The Product Motto

> **Business truth lives in the Domain. Everything else is a client.**

The Domain layer is the single authority on what the business permits and what the data means. The
UI, the import pipeline, the tooling, and any AI assistant are **clients** of that authority. A
client may request a decision; it never *is* the decision.

---

## The Twelve Engineering Laws

### Law I — Business Truth Lives in the Domain
Every business decision — whether a change is allowed, what a value means, how input is sanitized —
belongs to the Domain layer. No client re-implements, second-guesses, or works around it.

### Law II — Preserve the Architecture
The application is a single shared global scope of classic `<script>` modules by deliberate design.
No frameworks, bundlers, ES modules, or runtime dependencies are introduced to "modernize" it.
Architecture is preserved, not re-litigated per feature.

### Law III — One Source of Truth
Every fact — the version, the load order, the schema, a business rule — lives in exactly one place.
Others link to it. A second copy that can drift is a defect, not a convenience.

### Law IV — Determinism
The same source produces byte-identical output. Verification is mechanical, not a matter of opinion.
If output changes without a source change, that is a bug to investigate, never to accept.

### Law V — Additive over Destructive
Prefer changes that add behavior behind existing data shapes over changes that migrate or remove
data. Stored finance, payroll, employee, and contract data is protected by default; migrations are
deliberate, guarded, and one-way-forward.

### Law VI — Aggregates Decide, Handlers Implement
An aggregate is the **business authority**: it validates, normalizes, and either returns a sanitized
result or a typed failure — with no side effects. A handler is the **implementation authority**: it
performs mutation, persistence, history, and rollback. The two responsibilities never merge.

### Law VII — Commands and Queries Are Explicit
State changes travel through registered commands; reads travel through registered queries. Both are
routed through the Domain facade and named in the Domain registries. There is no hidden dispatch and
no anonymous mutation path.

### Law VIII — The Verifier Is the Gate
A change is not "done" until the verifier passes every check. A green verifier is necessary but not
sufficient; behavior is still validated in both the modular source and the portable build. Nothing
merges on optimism.

### Law IX — One PR, One Purpose
Each pull request expresses a single intent, lands as a single feature commit, and stays within its
approved scope. No drive-by cleanup, no speculative abstraction, no bundled unrelated change.

### Law X — No Knowledge Loss
Every decision of consequence is recorded — as an ADR, a Sprint Assignment (SPR), or a pull request
— so the reasoning survives without chat history. Documentation is a feature, delivered with the
change, not after it.

### Law XI — AI Is a Domain Client
An AI coding assistant is a client of the Domain and of this governance, never an exception to it.
It reads the Constitution, the Core Values, the Roadmap, and the relevant ADRs before implementing;
it acts through registered commands and queries; it respects the verifier and the Approval Matrix;
and it never bypasses the Domain to reach state directly. The AI proposes and prepares — approval
and merge remain human authority.

### Law XII — Documentation Is Executable Knowledge
Engineering documentation is part of the system, not commentary about it. It is version-controlled in
the repository, evolves in lockstep with the implementation, is reviewed like code, and is verified
like code. It is the authoritative source of engineering knowledge: when a question about how the
system works has an answer, that answer lives here, not only in someone's memory or a past
conversation.

Because documentation and implementation describe the same system, they must agree. **If documentation
no longer describes reality, the implementation is incomplete** — the change that made them diverge is
unfinished until the documentation is brought back into truth. Stale documentation is a defect, not a
lesser artifact.

---

*These laws are intentionally timeless. When the project's current state changes, update the
Roadmap and `AI_CONTEXT.md` — not this document — unless an engineering law itself is changing.*
