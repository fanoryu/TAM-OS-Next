# Project Governance

Governance in TAM Intelligence OS flows in one direction: from enduring intent down to a shipped
release. Each layer authorizes the one beneath it and is constrained by the one above it. No layer
may be skipped, and no lower layer may override a higher one.

## The Governance Pyramid

```
                          Vision
                            ↓
                        Core Values
                            ↓
                 Engineering Constitution
                            ↓
              Architecture Decision Records
                            ↓
                          Roadmap
                            ↓
                         Standards
                            ↓
                    Sprint Assignment
                            ↓
                       Pull Request
                            ↓
                          Review
                            ↓
                          Merge
                            ↓
                         Release
```

## How to read the pyramid

| Layer | Question it answers | Where it lives |
|---|---|---|
| **Vision** | Why does the system exist? | [`README.md`](../../README.md), `AI_CONTEXT.md` |
| **Core Values** | How do we resolve judgement calls? | [Core_Values.md](Core_Values.md) |
| **Engineering Constitution** | What rules are non-negotiable? | [Engineering_Constitution.md](Engineering_Constitution.md), [`CLAUDE.md`](../../CLAUDE.md) |
| **Architecture Decision Records** | Why is the architecture shaped this way? | [`docs/03-adr/`](../03-adr/README.md), [`docs/03b-repository-adr/`](../03b-repository-adr/README.md) |
| **Roadmap** | What are we building, and in what order? | [`docs/01-roadmap/`](../01-roadmap/README.md) |
| **Standards** | How is each kind of work performed? | [`docs/04-standards/`](../04-standards/README.md) |
| **Sprint Assignment (SPR)** | What is authorized for this unit of work? | Issued per task; contract in [SPR_Standard.md](../04-standards/SPR_Standard.md) |
| **Pull Request** | What concrete change implements it? | GitHub PR; contract in [PR_Standard.md](../04-standards/PR_Standard.md) |
| **Review** | Is it correct, in-scope, and safe? | GitHub review; contract in [Review_Standard.md](../04-standards/Review_Standard.md) |
| **Merge** | Is it authorized to enter `main`? | Contract in [Merge_Standard.md](../04-standards/Merge_Standard.md) |
| **Release** | Is it published to users? | Contract in [Release_Standard.md](../04-standards/Release_Standard.md) |

## Authority and direction

- **Downward authority.** Vision authorizes values; values authorize the Constitution; and so on.
  A Sprint Assignment cannot authorize anything the Standards forbid; a Pull Request cannot exceed
  the scope its Sprint Assignment granted.
- **Upward constraint.** A lower layer surfaces conflicts to the layer above rather than resolving
  them locally. If a PR cannot be completed without violating an ADR, the ADR is revisited first —
  the PR does not quietly break it.
- **Human authority at the gates.** Commit, push, tag, review approval, merge, and release are
  human-authorized actions (see the Approval Matrix in [`CLAUDE.md`](../../CLAUDE.md) §20). An AI
  assistant prepares and proposes; it does not self-authorize a gate.

## The recorded trail

Every change leaves a durable trail: an ADR (if a decision was made), a Sprint Assignment (what was
authorized), a Pull Request (what was implemented), a Review (what was checked), and a Merge commit
(what entered `main`). This trail is the mechanism behind Law X — No Knowledge Loss.
