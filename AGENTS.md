# AGENTS.md — Entry Point for AI Coding Assistants

This is the **mandatory first read** for any AI coding assistant working on TAM Intelligence OS.
Read it before you plan, edit, or implement anything. It exists to make one thing unambiguous:

> **Business truth lives in the Domain. Everything else is a client — including you.**

You are a **Domain client** (Law XI). You may read the Domain, request decisions through it, and
prepare changes for human approval. You never become a second source of business truth, and you never
bypass the Domain to reach state directly.

---

## Required reading before implementation

Read these, in order, before touching code. For a given task, read the ADRs relevant to it — not all
of them, but every one your change touches.

1. **[Engineering Constitution](docs/00-governance/Engineering_Constitution.md)** — the Engineering
   Laws and the Product Motto.
2. **[Core Values](docs/00-governance/Core_Values.md)** — how judgement calls are resolved.
3. **[Roadmap](docs/01-roadmap/README.md)** — where the project is going and what is authorized.
4. **Relevant [Domain ADRs](docs/03-adr/README.md)** — the reasoning behind the architecture your task
   touches (and, for governance/process, the [repository ADRs](docs/03b-repository-adr/README.md)). Read the
   **Accepted** ADRs your change touches, and **inspect** any **Proposed** ADR or **Planned**
   [Architecture Evolution Backlog](docs/02-architecture/Architecture_Evolution_Backlog.md) item in the
   same area — a Proposed ADR or Planned ARCH item is context to respect, **never** implementation
   authorization.
5. **The Standards for your task** —
   [SPR](docs/04-standards/SPR_Standard.md) ·
   [PR](docs/04-standards/PR_Standard.md) ·
   [Review](docs/04-standards/Review_Standard.md) ·
   [Merge](docs/04-standards/Merge_Standard.md) ·
   [Coding](docs/04-standards/Coding_Standard.md) ·
   [Testing](docs/04-standards/Testing_Standard.md) ·
   [Release](docs/04-standards/Release_Standard.md).

The full, enforceable rule set — with the Approval Matrix and Definition of Done — is
[`CLAUDE.md`](CLAUDE.md). Where anything here and `CLAUDE.md` could be read differently, **`CLAUDE.md`
governs.**

## Non-negotiable obligations

Every engineering AI working here **must**:

- **Read the Engineering Constitution, Core Values, and Roadmap** before implementing.
- **Read the ADRs relevant to the task** and honor the decisions the **Accepted** ones record.
- **Inspect relevant Proposed ADRs and Planned Architecture Backlog items** for context, and **never
  treat a Proposed ADR or a Planned ARCH item as implementation authorization** — only a Sprint
  Assignment (typically after an ADR is Accepted) authorizes the corresponding work.
- **Follow the SPR Standard** — implement only what a Sprint Assignment authorizes, within its named
  scope, and stop and report if any gate fails.
- **Follow the PR Standard** — one purpose, one feature commit, draft until every pre-review gate is
  green.
- **Follow the Merge Standard** — merge is a *separate* authorization; never self-merge; verify the
  pre-merge and post-merge gates.
- **Respect One PR, One Purpose** — no drive-by cleanup, no speculative abstraction, no unrelated
  change riding along.
- **Respect Domain ownership** — aggregates decide (pure, no side effects); handlers implement (all
  mutation, persistence, history, rollback). Never move business authority into a client or a helper.
- **Respect the verifier** — a change is not done until the verifier passes completely; extend it when
  you add Domain surface; never weaken or route around it.
- **Never bypass the Domain** — operational reads go through registered queries, operational writes
  through registered commands and their aggregate gate. No hidden dispatch path, ever.

## What stays human

`git commit`, `git push`, `git tag`, review approval, merge, and release are **human-authorized**
gates (`CLAUDE.md` §20). You prepare and propose; you present a candidate; you wait for approval. You
never change `APP_VERSION`, `SCHEMA_VERSION`, storage keys, or the CSS golden master except as an
intentional, separately-authorized, documented migration.

## Authorship is the owner's, not yours

Git authorship in this repository belongs to the owner alone (`CLAUDE.md` §15.7). When you draft a
commit message you **MUST NOT** append an AI-attribution trailer or footer of any kind — no
`Co-authored-by:` naming Claude, Claude Opus, Anthropic, Forge or any other agent, and no
"Generated with …" line. This holds **even when your default tooling adds one automatically**: strip
it before proposing the commit. Your participation is recorded in the orchestration log, which is
where it belongs — putting it in Git metadata would permanently misattribute authorship of a
proprietary codebase.

The rule is mechanically enforced in two layers, so a violation fails rather than merely being
noticed. Both run the same implementation (`tools/check-commit-attribution.js`):

```bash
node tools/install-hooks.js                              # once per clone — activates .githooks/
node tools/check-commit-attribution.js --selftest        # 35 fixtures
node tools/check-commit-attribution.js --range A..B      # what CI runs
```

The local hook only exists in clones that ran the installer, so **`verify-attribution` in CI is the
line you cannot get around**: it inspects every commit in the pull request. Do not attempt to bypass
either layer, and do not "fix" a rejection by rewording the checker — remove the trailer.

## Where to look next

- **What exists today:** [`docs/02-architecture/`](docs/02-architecture/README.md) and the root
  [`ARCHITECTURE.md`](ARCHITECTURE.md).
- **Current project state:** [`AI_CONTEXT.md`](AI_CONTEXT.md).
- **How governance flows:** [`docs/00-governance/Project_Governance.md`](docs/00-governance/Project_Governance.md).
- **The documentation index:** [`docs/README.md`](docs/README.md).

If a request conflicts with any rule here or in `CLAUDE.md`, **surface the conflict and the safe
alternative** rather than silently violating it.
