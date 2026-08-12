# Multi-User Operation — New Maintainer Requirement

**Status:** **NEW MAINTAINER REQUIREMENT — NOT YET ARCHITECTED**
**Recorded:** 2026-08-11, during the post-sign-off repository freshness audit
**Authorizes:** nothing. No design, no technology choice, no implementation.

---

## 1. The requirement

The maintainer has stated that a future pilot / general-use target requires TAM OS to operate as a
genuine multi-user system:

- **Shared company data across users and devices** — one company dataset, not a per-device copy.
- **Real authentication** — verified identity, not a selector.
- **Backend / shared persistence** — a server-side store of record.
- **Server-side authorization and read scope** — enforcement that survives a hostile client.
- **Multi-user deployment** — more than one concurrent operator against the same data.

## 2. What this is NOT

This requirement **does not describe the currently approved v2.10.0 controlled pilot**, and the pilot
must never be represented as multi-user. The approved pilot model is, and remains:

| Dimension | Approved v2.10.0 controlled pilot | This future requirement |
|---|---|---|
| Data | Local to one device (`localStorage`) | Shared company data |
| Identity | "Acting as" selector — local, spoofable, **explicitly not a security boundary** | Real authentication |
| Authorization | Client-side `can(...)`, a **product** control | Server-side enforcement |
| Read scope | Client-side scoping (Readiness-1) | Server-side read scope |
| Operators | 1–3 named internal operators, one device each | Multiple concurrent users |
| Persistence | Manual single-device backups | Shared backend persistence |

The pilot's trust model is documented in
[Controlled-Pilot-Signoff-v2.10.0](../06-releases/Controlled-Pilot-Signoff-v2.10.0.md) and
[Pilot-Guide-v2.10.0](../06-releases/Pilot-Guide-v2.10.0.md), and it is accepted as-is.

## 3. Governance position — this conflicts with a frozen invariant

[`CLAUDE.md`](../../CLAUDE.md) §4.3 states a **MUST**: *client-only — no server, database, or API is
introduced.* §7 and §17 build on it, and the "Explicitly not authorised … any backend assumption"
line in [`AI_CONTEXT.md`](../../AI_CONTEXT.md) §17 restates it.

**This requirement cannot be implemented under the constitution as written.** It therefore requires,
before any work begins:

1. An explicit, deliberate **`CLAUDE.md` amendment** (at minimum §4.3, and consequentially §1, §7, §17).
2. A dedicated **ADR** recording the decision, the alternatives, and the revalidation trigger.
3. A **security decision record (SDR)** covering authentication, transport, server-side authorization,
   and confidential-data handling once data leaves the device.
4. A data-migration and residency position, since today all data is local by design.

Nothing here pre-judges any of those. Recording a requirement is not approving it.

## 4. Explicitly out of scope of this note

- **No backend technology is chosen** — not a language, framework, database, or hosting model.
- **No architecture is proposed.**
- **No milestone is scheduled**, and no existing frozen milestone is reopened.
- **No implementation is authorized.**

## 5. Relationship to the existing roadmap

The nearest existing milestone is **General-Use Readiness / Hardening**
([Milestones.md](../05-milestones/Milestones.md)), which already records the absence of strong
authentication and of multi-device synchronization among the limitations *accepted, not fixed* for the
controlled pilot. This requirement is **larger than that milestone's current framing** — General-Use
Readiness is scoped after the Pilot Exit Review, and this note exists so the multi-user target is not
silently folded into it without the governance steps in §3.

**Sequencing position:** after the Controlled Pilot and Pilot Exit Review at the earliest. It does not
block, alter, or gate the currently approved controlled pilot.

## 6. Open governance questions

| # | Question | Owner |
|---|---|---|
| MU-1 | Is the client-only MUST amended, or is multi-user delivered as a separate product line? | Maintainer / Atlas |
| MU-2 | Does multi-user precede or follow General-Use Readiness, or subsume it? | Maintainer |
| MU-3 | What is the data-residency and confidentiality position once company data leaves the device? | Maintainer / security review |
| MU-4 | Does Distribution-1 (Model B) need to land first, given a backend implies a served application? | Atlas |

These are recorded as **open**. None is answered here.
