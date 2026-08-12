# ADR-0001 — Documentation Governance & Lifecycle Model

| Field | Value |
|---|---|
| **Record** | ADR-0001 |
| **Title** | Documentation Governance & Lifecycle Model |
| **Status** | Accepted |
| **Date created** | 2026-08-01 |
| **Author** | Forge (engineering) |
| **Accountable approver** | Atlas — Chief Technology Officer |
| **Supersedes** | — |
| **Superseded by** | — |
| **Related** | PR-4 "The Archivist" decision package; PR-4.1 lifecycle addendum; [[SDR-0001]] |

> This record captures the documentation-governance decision approved in PR-4 and refined
> in PR-4.1. It records an already-made decision; it introduces no new governance beyond
> what was approved.

## 1. Context
The repository's documentation was well-governed at the root level (one-responsibility-per-document
in `CLAUDE.md` §18, mirrored by the README index) but lacked governance for the growing `docs/` tree
and for decision records: no folder taxonomy, no decision-record lifecycle, no naming convention, and
an index that had already drifted (it omitted `docs/DEPLOYMENT.md` and the `docs/security/` SDR
series). An empty `docs/adr/` folder implied an unused convention.

## 2. Decision
Adopt a lightweight, tooling-free documentation governance model:

1. **Taxonomy.** `docs/` root holds standing process/reference docs; `docs/security/` holds Security
   Decision Records (SDR); `docs/adr/` holds Architecture Decision Records (ADR); `audit/` holds
   immutable dated point-in-time records.
2. **Two lifecycle shapes.** *Living* docs stay Active and are edited in place (git history is the
   version record). *Records* (ADR/SDR/EDR) are immutable once Accepted and are **superseded**, never
   rewritten.
3. **States.** Draft → Review → Approved → Active, with terminal Superseded / Deprecated / Archived.
   Decision records use Proposed → Accepted → (Superseded | Deprecated).
4. **Naming.** `ADR-NNNN-kebab.md`, `SDR-NNNN-kebab.md` (zero-padded, monotonic, never reused);
   `SCREAMING-KEBAB.md` for `docs/` process files; `audit/<topic>-YYYY-MM-DD/`.
5. **Navigation.** A `docs/README.md` folder index, the root README table, and the `SECURITY.md` SDR
   list are the three cross-referencing hubs — each links, none duplicates (single source of truth).
6. **Definition of Done.** Documentation changes must keep indexes fresh and cross-references valid
   (`CLAUDE.md` §19).
7. **Ownership.** A documentation steward (default @fanoryu) owns index freshness and record
   lifecycle, atop the existing `CODEOWNERS` and `CLAUDE.md` §18 ownership.

## 3. Consequences
- **Positive:** decisions become discoverable and immutable; index drift is prevented by a DoD gate;
  the model scales by adding files + one index line, with no documentation tooling.
- **Negative / trade-off:** contributors must update indexes and set record status by hand (accepted
  deliberately to avoid MkDocs/Docusaurus/docs-CI in a single-owner, low-ceremony repo).

## 4. Alternatives Considered
- *Do nothing:* index already drifting; rejected.
- *Heavy governance (metadata schema, generated site, docs CI):* disproportionate; rejected.
- *Collapse ADR into SDR:* overloads "security" onto architecture decisions; rejected — the two
  lenses are kept distinct.
- *Delete the empty `docs/adr/`:* discards a useful convention slot and needs tracked-file-removal
  approval; rejected in favor of populating it (this record).

## 5. Revalidation Trigger
Re-examine if: the repository gains many contributors or hundreds of documents (may justify automated
freshness/link checking — a future tooling decision); backend/infra documentation or RFC/API-spec
categories are introduced at scale; or the one-responsibility-per-document boundary in `CLAUDE.md`
§18 changes.

---

*Lifecycle: Proposed → Accepted → (Superseded | Deprecated). See
[`docs/adr/README.md`](README.md) for the register.*
