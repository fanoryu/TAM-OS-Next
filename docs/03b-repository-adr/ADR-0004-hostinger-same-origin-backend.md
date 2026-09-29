# ADR-0004 — Hostinger Same-Origin PHP + MariaDB Backend Architecture

| Field | Value |
|---|---|
| **Record** | ADR-0004 |
| **Title** | Hostinger Same-Origin PHP + MariaDB Backend Architecture — the shared multi-user backend runs on the existing company web hosting |
| **Status** | **Accepted** |
| **Date created** | 2026-09-29 |
| **Date accepted** | 2026-09-29 |
| **Author** | ARCH-GOV-2 architecture reconciliation |
| **Accountable approver** | Maintainer (`CLAUDE.md` §20) — rulings recorded 2026-09-29 (§2A) |
| **Supersedes** | [ADR-0003](ADR-0003-shared-multi-user-architecture.md) |
| **Superseded by** | — |
| **Related** | [ADR-0001](ADR-0001-documentation-governance-model.md); [ADR-0002](ADR-0002-canonical-distribution-architecture.md); [ADR-0003](ADR-0003-shared-multi-user-architecture.md) (superseded); [Multi-User-0](../01-roadmap/Multi-User-0-Shared-Multi-User-Architecture-Decision.md); [`DEPLOYMENT.md`](../DEPLOYMENT.md) §8; `CLAUDE.md` §4.3, §6.2, §7, §17, §20 |

> **What this is.** An Architecture Decision Record captures one architecture-level decision, why it
> was made, and what future event would require it to be revisited. It is immutable once Accepted: a
> later decision does not rewrite it, it supersedes it with a new ADR that links back
> (`CLAUDE.md` §14.4, §16.2).
>
> **What acceptance does and does not mean.** This record replaces ADR-0003's **backend selection**
> and carries its architecture-neutral decisions forward unchanged (§2.1). It **authorizes no
> implementation**: no PHP, SQL, schema, dependency, hosting change, deployment or runtime change.
> Each Multi-User milestone still needs its own authorization, and the security design belongs to
> SDR-0002.

---

## 1. Context

[ADR-0003](ADR-0003-shared-multi-user-architecture.md) (Accepted 2026-08-12) selected a managed
backend — Supabase Auth, managed PostgreSQL with Row-Level Security, and server functions — behind a
server-enforced trust boundary. Nothing was implemented.

On 2026-09-29 the maintainer **rejected Supabase**. TAM OS must not depend on a separately paid
managed backend service. This triggers ADR-0003's own revalidation clauses:

- **§5.4:** Supabase judged an unacceptable dependency (here, on operating-cost grounds).
- **§5.1:** its governing premise changed. `CLAUDE.md` §4.3 permitted only that backend, and it
  requires a superseding ADR for any other.

The company already pays for **Hostinger Premium Web Hosting** (hPanel), which serves the target
hostname `finance.reliabilityindonesia.com`. BACKEND-ARCH-REVALIDATION-1 and the maintainer's hPanel
review (2026-09-29) established these capabilities:

| Capability | State |
|---|---|
| PHP | 8.3 (observed publicly and confirmed in hPanel) |
| Database facility | MariaDB/MySQL available |
| PHP configuration and extensions | Configurable in hPanel |
| SFTP | Existing deployment mechanism |
| SSH | Available but **inactive** |
| SSL | Active |
| CDN | Active |
| Provider backups | Automatic, **Weekly** |

Placing configuration outside the public web root has **not** yet been verified.

## 2. Decision

**The shared multi-user backend runs on the existing Hostinger web hosting as a same-origin PHP 8.3
API over MariaDB/MySQL.** The browser remains an untrusted client, and the PHP backend is the
authorization boundary.

```
Browser (untrusted)
   │  same-origin HTTPS
   ▼
https://finance.reliabilityindonesia.com/        → static TAM OS frontend
https://finance.reliabilityindonesia.com/api/*   → PHP authentication / session
                                                      → authoritative principal
                                                      → central policy + data-access layer
                                                      → MariaDB (InnoDB)
```

### 2.1 Carried forward from ADR-0003, unchanged

1. **The browser is untrusted.** Client-side `can(...)` and `getScopedRecords()` are UX affordance and
   early denial only.
2. **The backend is authoritative** for identity, authorization, read scope and persistence.
3. **One shared company dataset**, not one per user.
4. **`company_id` on every business table from day one.** It is single-company insurance, not
   multi-tenancy.
5. **`ACTIONS` stays 20.** The vocabulary is re-expressed server-side, not extended.
6. **User ≠ Employee.** The link is a nullable employee binding. Role is **stored on the
   authoritative membership**, never derived from data, and the employee binding is authoritative.
7. **Online-required.** No offline synchronization is built.
8. **Existing `uid()` record IDs are preserved** where migration permits.
9. **"Acting as" remains** until authenticated identity passes its retirement gate
   (`ARCHITECTURE.md`), with no automatic CEO or Employee fallback.
10. **No real company data** before the production security and readiness gate
    ([`DEPLOYMENT.md`](../DEPLOYMENT.md) §8).

### 2.2 What changes

| Concern | ADR-0003 (superseded) | ADR-0004 |
|---|---|---|
| Backend host | Supabase (managed, separately paid) | Existing Hostinger web hosting |
| API | Supabase Data API + server functions | Same-origin PHP 8.3 at `/api/*` |
| Database | Managed PostgreSQL | Hostinger MariaDB/MySQL, InnoDB (transactional) |
| Authentication | Supabase Auth (JWT) | Server-side PHP sessions |
| Enforcement | PostgreSQL RLS + functions | Central PHP policy + data-access layer |
| Recovery | Managed backups / PITR | Provider backup + nightly encrypted off-host dump (§2.6) |
| Frontend config | Public project URL + key | None: same origin |

### 2.3 Accepted trade-off — no database RLS backstop

MariaDB has no PostgreSQL Row-Level Security. With RLS, the database refuses a row the policy did not
allow. Here, a query that omits its scope predicate **returns the row**. Authorization is therefore
enforced by application code, and this record accepts that responsibility — including the
authentication and session responsibility that ADR-0003 had delegated to a vendor. The following
**compensating architectural controls are mandatory**:

1. The browser never reaches the database; there is no generic query endpoint.
2. SQL exists **only** inside one controlled data-access/repository layer.
3. Every request resolves the authoritative principal server-side (user → membership → role,
   `company_id`, employee binding). **Role, company and employee are never taken from the browser.**
4. Company scope and Employee self-scope are **injected by the data-access layer**, never supplied by
   callers.
5. Prepared statements only.
6. Hostile-principal authorization tests for every endpoint and scoped entity.
7. CI enforcement that no SQL or database access exists outside the data-access layer.
8. An **external security review** before real company data.

### 2.4 Authentication and session direction (principles; detail in SDR-0002)

Principles:

- server-side sessions, recorded in the database so they can be revoked;
- `Secure`, `HttpOnly`, `SameSite` cookies on the single origin;
- password hashing through PHP's current password APIs;
- server-side account status checked on every request;
- password recovery through server-generated, single-use, expiring tokens;
- login rate limiting;
- CSRF defense;
- session rotation and invalidation (logout, disable, password change).

### 2.5 Same origin

Frontend and API share `https://finance.reliabilityindonesia.com`. This gives:

- server-managed secure cookies;
- **no** application CORS;
- a tighter CSP (`connect-src 'self'`);
- one production origin;
- **no** public backend runtime key or configuration in the frontend;
- one deployment target.

**`/api/*` must never be publicly cached.** The Hostinger CDN is active, and API responses must carry
appropriate headers (for example `Cache-Control: no-store, private`). Production readiness must
verify this.

### 2.6 Backup and recovery direction

1. Hostinger automatic provider backup — currently **Weekly**, the provider-level baseline.
2. A nightly database dump via cron.
3. Encryption of that dump.
4. An off-host copy held in the private company layer.
5. Periodic restore rehearsal.
6. Reconciliation after restore: row counts and monetary totals.

Target initial **RPO ≈ 24 hours**. **PITR is not required** for the initial operating profile
(1–3 users, low write volume). Daily provider backups are not purchased now. Nothing here is
implemented.

### 2.7 Dependencies, secrets and hosting boundaries

- **Composer dependencies are permitted in principle**, but only when each one is justified, minimal,
  pinned and locked, and security-reviewed, and approved under `CLAUDE.md` §20. None is added by this
  record.
- **No credentials in the repository.** Backend configuration and secrets live outside the public web
  root. Verifying that this placement works on the host is **mandatory before deployment**; it does
  not block this decision.
- **No additional backend service, managed backend, or VPS** without a further ADR. SSH stays inactive
  unless a later, authorized milestone needs it.

### 2.8 Distribution-1 stays before the backend — new rationale

ADR-0002's 2026-09-29 note sequenced Distribution-1 before Multi-User because a Supabase client
needed runtime configuration. Same-origin removes that reason. **Distribution-1 is retained before
backend implementation for a different reason:** the current monolithic, inlined single-file artifact
cannot carry a strict Content-Security-Policy without broad `'unsafe-inline'`, and a strict CSP is
required before real data.

## 2A. Maintainer rulings (2026-09-29)

| Ruling | Effect |
|---|---|
| TAM OS will **not** use Supabase — no separately paid managed backend | ADR-0003's backend selection is superseded |
| Target: Hostinger Premium Web Hosting, PHP 8.3, MariaDB/MySQL, same-origin `/api/*` | §2 |
| Composer permitted in principle, governed; nothing added now | §2.7 |
| Provider backup stays Weekly; nightly encrypted off-host dump; RPO ≈ 24 h; no PITR initially | §2.6 |
| Config outside the web root is a mandatory pre-deployment verification, not a blocker | §2.7 |
| Distribution-1 stays before backend implementation (strict-CSP rationale) | §2.8 |
| Do not enable SSH, change PHP or extensions, or change the hosting account now | §2.7 |

## 3. Consequences

### Positive

- **No new recurring infrastructure cost**: the existing Premium plan provides PHP, databases, cron,
  SFTP, SSL and CDN.
- The single origin simplifies cookies, CSP and deployment, and removes CORS and public backend
  configuration.
- No vendor lock-in; the data layer is standard SQL exportable with `mysqldump`.

### Negative — accepted

- **Security responsibility moves into this repository.** Authentication, sessions, recovery, rate
  limiting, CSRF, authorization and scope are ours to build, test, patch and review. There is no
  database backstop (§2.3).
- **A second language (PHP) and a database schema** enter the repository. The build, verifier and CI
  must grow to cover them.
- **Shared-hosting blast radius.** The account also hosts the company website; its compromise
  endangers TAM OS.
- **Recovery is coarser** than managed PITR (RPO ≈ 24 h), and backups on the same provider make the
  off-host copy mandatory.
- MFA, if required, becomes our own build work.
- MariaDB DDL commits implicitly, so migration safety must be designed rather than assumed.

## 4. Alternatives Considered

| Alternative | Disposition |
|---|---|
| **Supabase (ADR-0003's selection)** | **Rejected by the maintainer**: a separately paid managed backend dependency. Retained as history in ADR-0003 and Multi-User-0 |
| **New VPS / self-hosted server** | **Not required.** Every needed capability exists on the current plan. A VPS adds OS, TLS, database and patching burden with no security gain at this scale. Fallback only, via a new ADR |
| **Other managed backends** (Firebase, Neon + serverless, Auth0/Clerk) | Rejected by the same managed-service cost ruling. ADR-0003 §4 also recorded fit problems |
| **Keep client-only; sync `localStorage`** | Still does not meet the shared-dataset requirement (ADR-0003 §4) |
| **Node.js backend on Hostinger** | Not established on this plan. PHP is the host's native, confirmed runtime |

## 5. Revalidation Trigger

Re-examine this decision if:

1. The host cannot meet a mandatory pre-deployment verification: configuration outside the web root,
   `/api/*` cache bypass, required PHP extensions, cron, or database transactions.
2. The external security review finds the no-RLS application boundary insufficient for the data.
3. A data-residency or regulatory requirement (for example sector rules on where payroll data is
   hosted) conflicts with the hosting location.
4. Users grow materially beyond a small internal team, or a second company or external users appear.
5. Recovery requirements tighten beyond RPO ≈ 24 h.
6. The shared hosting account is compromised, or its co-hosted workloads are judged an unacceptable
   risk.

---

*Lifecycle: Proposed → Accepted → (Superseded | Deprecated). See [`README.md`](README.md) for the
register and lifecycle rules.*
