# ADR-0003 — Shared Multi-User Architecture

| Field | Value |
|---|---|
| **Record** | ADR-0003 |
| **Title** | Shared Multi-User Architecture — one authoritative company dataset behind a server-enforced trust boundary |
| **Status** | **Accepted** |
| **Date created** | 2026-08-11 |
| **Date accepted** | 2026-08-12 |
| **Author** | Multi-User-0 architecture decision review |
| **Accountable approver** | Maintainer (`CLAUDE.md` §20) — ruling recorded 2026-08-12 |
| **Supersedes** | — |
| **Superseded by** | — |
| **Related** | [ADR-0001](ADR-0001-documentation-governance-model.md); [ADR-0002](ADR-0002-canonical-distribution-architecture.md); [Multi-User-0 architecture decision](../01-roadmap/Multi-User-0-Shared-Multi-User-Architecture-Decision.md); [Multi-User requirement note](../99-archive/roadmap-completed/Multi-User-Requirement-Note.md); `CLAUDE.md` §4.3, §7, §17 |

> **What this is.** An Architecture Decision Record captures one architecture-level decision, why it
> was made, and what future event would require it to be revisited. It is immutable once Accepted: a
> later decision does not rewrite it, it supersedes it with a new ADR that links back
> (`CLAUDE.md` §14.4, §16.2).
>
> **This record is `Accepted`.** The maintainer ruling of 2026-08-12 — *"APPROVED as the Multi-User-0
> architecture baseline"* — is recorded in §2A. The technical analysis (§1, §4) is unchanged from the
> Proposed draft: the ruling settled the direction, not the evidence.
>
> **What acceptance does and does not mean.** Acceptance makes this the **authoritative architecture
> baseline** for subsequent planning. It **does not authorize implementation.** Specifically it
> authorizes **no** backend provisioning, **no** database or authentication migration, **no** runtime
> or schema change, and **no** `CLAUDE.md` amendment. The `CLAUDE.md` §4.3 client-only **MUST** remains
> **fully operative and unamended**, and it continues to **block implementation** until it is amended
> through its own controlled milestone (§3, GC-1). This mirrors [ADR-0002](ADR-0002-canonical-distribution-architecture.md),
> which was Accepted while its migration was deferred to a dedicated milestone.
>
> The full analysis behind this record is the
> [Multi-User-0 architecture decision](../01-roadmap/Multi-User-0-Shared-Multi-User-Architecture-Decision.md).

---

## 1. Context

TAM OS is today a **client-only, single-device** application. `CLAUDE.md` §4.3 states this as a
**MUST**: *no server, database, or API is introduced.* All state lives in `localStorage` behind one
`StorageAdapter` gateway; identity is a local "Acting as" selector documented in-source as **not a
security boundary**; authorization (`can(...)`, 20 frozen `ACTIONS`) and read scope
(`getScopedRecords()`, 6 scoped entity types) are **client-side product controls**.

The maintainer has since stated a requirement that this model cannot satisfy:

> TAM OS must eventually use **one shared company dataset** across authorized users and devices. The
> maintainer/CEO supplies and controls the company data. Employees must **not** receive separate
> independent copies merely because they use another computer or browser. Each user accesses the same
> authoritative dataset, but what they may read or mutate is constrained by their **authenticated**
> identity, read scope and authorization policy.

Three forces make a decision necessary now rather than later:

1. **The current model is not merely missing a feature — it is structurally incompatible.** A
   `localStorage` dataset is per-browser by definition. No amount of client work makes two browsers
   share one authoritative dataset.
2. **The current controls cannot be promoted as-is.** Client-side JavaScript authorization is an
   affordance, not a boundary. Anyone with the portable HTML file and a devtools console can call any
   handler. This is already documented and accepted for a 1–3 operator trust-based pilot; it is
   **not** acceptable once an Employee principal is a real, separate, potentially adversarial user.
3. **The existing architecture is unusually well-positioned.** Identity resolves through a single
   canonical `IdentityProvider` seam whose in-source comment already anticipates *"a future
   backend/authenticated provider implements exactly this one method"*; scope resolves through one
   declarative `ENTITY_SCOPE` predicate registry; persistence funnels through one `StorageAdapter`.
   Deciding now lets these seams be used as designed instead of being worked around later.

## 2. Decision

**Adopt a server-enforced shared-persistence architecture in which the browser is an untrusted client,
and defer all implementation to a separately authorized milestone sequence.**

Specifically:

1. **Trust boundary (the load-bearing decision).** The **server/API + database is the authorization
   boundary**. Browser JavaScript is untrusted. The existing client-side `can(...)` and
   `getScopedRecords()` are **retained as UX affordance and early denial only**, and must never again
   be described as the enforcement layer.
2. **One authoritative dataset.** A single shared company dataset, **not** one database per employee.
   Users receive **server-computed projections** of that one dataset.
3. **Target stack — PostgreSQL with Row-Level Security, via Supabase.** Postgres + RLS as the
   enforcement mechanism, Supabase Auth for authenticated identity, Supabase's managed Postgres for
   persistence and PITR backups, and a thin server-side function layer for composite/irreversible
   operations that RLS alone cannot express atomically.
4. **Single-company schema, but with `company_id` present from day one.** TAM OS serves one company
   (PT Total Asset Manajemen). No SaaS multi-tenancy is built. A stable `company_id` column is carried
   on every business table anyway, because retrofitting a tenant discriminator into a live payroll and
   finance dataset is materially more expensive than carrying an unused column.
5. **`ACTIONS` stays 20.** The existing vocabulary is re-expressed server-side, not extended. No new
   action is invented by this decision.
6. **Online-required.** No offline-first synchronization machinery is built. Shared authoritative data
   and offline write-merge are contradictory goals at this team size.
7. **Identity model.** `User` (authentication subject) is separate from `Employee` (business record),
   linked by a nullable `employee_id`. The CEO/admin may exist **without** an Employee record. Role is
   **stored** on the membership row, not derived.
8. **Existing record IDs are preserved.** The client's `uid()` string IDs migrate unchanged as
   `text` primary keys, so backup files, audit references and cross-collection links stay valid.

**This ADR authorizes no implementation.** It records the target and the reasoning. Implementation
requires the `CLAUDE.md` §4.3 amendment (§3 below), a security decision record, and per-milestone
authorization.

## 2A. Maintainer ruling (2026-08-12)

**APPROVED as the Multi-User-0 architecture baseline.**

The ruling, recorded verbatim in effect:

| The approval **does** mean | The approval **does NOT** mean |
|---|---|
| The architecture analysis is **accepted** | Implementation is authorized |
| Its recommended direction **may be used as the baseline** for subsequent planning | Backend provisioning is authorized |
| **Multi-User-0 may be closed / frozen** | Database migration is authorized |
| | Authentication migration is authorized |
| | Any runtime change is authorized |
| | Any schema change is authorized |
| | Any `CLAUDE.md` amendment is authorized |

**Acceptance is separable from authorization.** This repository has direct precedent: ADR-0002 was
Accepted while its migration was deferred to the Distribution-1 milestone and `CLAUDE.md` remained
"fully operative". The same separation applies here — the *decision* is now authoritative; the *work*
remains blocked.

**The blocking gate is unchanged.** `CLAUDE.md` §4.3 (*"No server, database, or API is introduced"*)
is **fully operative and unamended**. No Multi-User implementation milestone may begin until that
amendment is performed through its own controlled milestone with its own authorization. Accepting this
ADR does **not** silently override the constitution, and must never be cited as having done so.

> **Correction to the Proposed draft.** The draft stated that the `CLAUDE.md` amendment was required
> *before this ADR could be Accepted*. That was too strong and is superseded by this ruling and by the
> ADR-0002 precedent: the amendment gates **implementation**, not **acceptance**. §5.1 is corrected
> accordingly.

## 3. Consequences

### Accepted positive consequences

- Real confidentiality: an Employee's browser never receives another employee's salary row, rather
  than receiving it and hiding it.
- One dataset, many devices — the actual business requirement.
- Real authentication, password reset, and a route to MFA.
- Managed backups and point-in-time recovery replace a manual single-device export.
- A truthful multi-user audit trail becomes possible (see the gap in §3 below).

### Accepted negative consequences and trade-offs

- **`CLAUDE.md` §4.3 must be amended.** This is the single largest consequence. The client-only MUST is
  a founding invariant, and this decision cannot proceed without the maintainer explicitly retiring or
  narrowing it. **This ADR does not perform that amendment.**
- **Operational burden appears where there was none.** A hosted database, an auth provider, secrets,
  and uptime become real responsibilities for a single-owner project.
- **Recurring cost appears where there was none** (est. **USD 0–25/month** at 1–3 users; see the
  Multi-User-0 document §23).
- **Vendor concentration.** Supabase supplies auth, database and hosting. This is mitigated, not
  eliminated, by the fact that the data layer is standard PostgreSQL and is exportable via `pg_dump`;
  the genuinely sticky component is Auth.
- **The offline story regresses deliberately.** The application becomes online-required.
- **A latent gap is exposed: the current audit record has no actor field.** `logActivity()` writes
  `{ts, type, module, entity, entityId, desc, refs}` — sufficient when there is exactly one user,
  insufficient the moment there are two. Multi-user audit is new work, not a port.

### Explicitly NOT consequences of this decision

- The v2.10.0 controlled pilot is **unchanged** and remains approved under the existing local
  trust-based model. This ADR does not pause, replace, or re-scope it.
- ADR-0002 is **not invalidated**. Model A remains canonical for v2.10.0; Distribution-1 remains
  approved future work.
- `SCHEMA_VERSION` 6 and the 20 `ACTIONS` are unchanged by this record.

## 4. Alternatives Considered

| Alternative | Why rejected |
|---|---|
| **Firebase / Firestore + security rules** | Document store is a poor fit for payroll and finance, which are inherently relational and require multi-row transactional integrity (`commitReadyPayroll` writes four collections as one logical unit). Firestore's transaction and join model would make the existing domain harder, not easier. Security rules are also a bespoke language with weaker expressive power than SQL predicates for the ownership tests TAM OS already has. |
| **Node.js API + self-hosted PostgreSQL** | Correct and maximally portable, but every authorization check becomes hand-written application code — precisely the class of code where confidentiality bugs hide. It also imposes the largest operational burden (server patching, TLS, backups, monitoring) on a single-owner project. Retained as the fallback if Supabase lock-in is ruled unacceptable. |
| **Serverless API + managed Postgres (e.g. Neon + Vercel functions)** | Viable and lower lock-in than Supabase, but assembles auth, database, hosting and backups from separate vendors, increasing integration surface and failure modes for no security benefit at this scale. |
| **Auth0 / Clerk for authentication** | Both are strong products, but adopting one means auth is a *second* vendor alongside the database vendor, and neither integrates with Postgres RLS as directly as Supabase Auth (whose JWT claims are readable inside RLS policies via `auth.uid()`). Clerk's pricing model is also oriented to consumer-scale MAU rather than a 1–3 user internal tool. |
| **Custom username/password authentication** | Rejected on security-responsibility grounds. Correctly implementing password hashing, reset flows, session invalidation, and brute-force protection is a specialist responsibility that a single-owner project should not assume when managed alternatives cost approximately nothing at this scale. |
| **One database (or one dataset) per employee** | Explicitly rejected by the requirement. It reintroduces divergent copies, makes company-wide CEO reporting impossible without cross-database aggregation, and destroys referential integrity. |
| **Keep client-only; sync `localStorage` between devices** | Does not satisfy the requirement. Any client-mediated sync still ships the whole company dataset to every device, so an Employee's browser would hold every colleague's salary — the exact defect Readiness-1 was created to close. |
| **Multi-tenant SaaS architecture now** | Rejected as unjustified scope. One company is the requirement. `company_id` is carried as cheap insurance without building tenant isolation, onboarding, or per-tenant configuration. |
| **Offline-first with conflict resolution (CRDT/queue)** | Rejected as disproportionate. Conflict resolution on payroll and finance records is a correctness minefield (what is the merge of two payroll postings?), and the operators are office-based with reliable connectivity. |

## 5. Revalidation Trigger

This decision must be re-examined if any of the following occurs:

1. **The maintainer declines to amend `CLAUDE.md` §4.3.** The amendment gates **implementation**, not
   this record's acceptance. If it is ultimately declined, no Multi-User milestone may ever begin, and
   the requirement must be met — or formally abandoned — some other way; this ADR would then be
   **Superseded** by that decision rather than rewritten.
2. **The user population or access model changes materially** — external/customer access, more than
   roughly 25 users, or multiple companies genuinely operating in one deployment.
3. **A regulatory or contractual data-residency constraint emerges** (for example a requirement that
   PT Total Asset Manajemen payroll data remain on Indonesian infrastructure), which may rule out a
   given managed region and favour self-hosting.
4. **Supabase materially changes its pricing, regional availability, or Postgres/RLS guarantees**, or
   is otherwise judged an unacceptable single point of dependency.
5. **The controlled pilot produces a finding that invalidates a premise here** — for example evidence
   that the operators genuinely require offline operation.
6. **Offline capability becomes a stated business requirement**, which would reopen §2.6.

---

*Lifecycle: Proposed → Accepted → (Superseded | Deprecated). See
[`docs/adr/README.md`](README.md) for the register and lifecycle rules.*
