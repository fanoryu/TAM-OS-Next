# 02 — Architecture

How the system is built **today**. These documents describe implemented reality, not plans. Future
direction lives in the [Roadmap](../01-roadmap/README.md); the reasoning behind each decision lives
in the [Domain ADRs](../03-adr/README.md).

| Document | Read it for |
|---|---|
| [Domain_Architecture.md](Domain_Architecture.md) | The Domain layer: modules, load order, facade, and how a call flows |
| [Aggregate_Pattern.md](Aggregate_Pattern.md) | The aggregate/handler split — business authority vs. implementation authority |
| [Command_Query_Model.md](Command_Query_Model.md) | How commands and queries are registered and routed |
| [AI_Architecture.md](AI_Architecture.md) | How AI capabilities are positioned as Domain clients |
| [Architecture_Evolution_Backlog.md](Architecture_Evolution_Backlog.md) | Non-blocking architecture evolution items (ARCH-NNN) — open questions, not decisions |

The authoritative, file-by-file module map for the whole application remains
[`ARCHITECTURE.md`](../../ARCHITECTURE.md) at the repository root. This folder focuses on the Domain
layer and its patterns; it links to the root map rather than duplicating it.

> **Rule for this folder:** the architecture documents describe only what is implemented — if a
> statement about how the system works cannot be traced to code on `main`, it belongs in the Roadmap,
> not in Architecture. The [Architecture Evolution Backlog](Architecture_Evolution_Backlog.md) is the
> one exception by design: it registers *open questions* about implemented code, explicitly marked as
> non-blocking and undecided, never as architecture-as-built.
