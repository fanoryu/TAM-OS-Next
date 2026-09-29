# SDR-0002 — PHP + MariaDB Multi-User Security Architecture

| Field | Value |
|---|---|
| **Record** | SDR-0002 |
| **Title** | PHP + MariaDB Multi-User Security Architecture — authentication, sessions, authorization, data scope, audit and operational security for the ADR-0004 backend |
| **Status** | **Accepted** |
| **Author** | Forge (engineering) |
| **Accountable approver** | Maintainer (`CLAUDE.md` §20) |
| **Date created** | 2026-09-29 |
| **Next review** | Before the first real company data (production cutover), then annually |
| **Supersedes** | — |
| **Superseded by** | — |
| **Related** | [ADR-0004](../03b-repository-adr/ADR-0004-hostinger-same-origin-backend.md); [ADR-0003](../03b-repository-adr/ADR-0003-shared-multi-user-architecture.md) (superseded); [ADR-0002](../03b-repository-adr/ADR-0002-canonical-distribution-architecture.md); [SDR-0001](SDR-0001-codeql-baseline-disposition.md); [`DEPLOYMENT.md`](../DEPLOYMENT.md) §8; `CLAUDE.md` §4.3, §6, §7, §15, §17, §20 |

> **What this is.** The security decision record that ADR-0004 requires before backend work. It fixes
> the security rules every implementation of the same-origin PHP + MariaDB backend must satisfy.
>
> **What it is not.** It is **architecture, not implementation**. It creates no PHP, SQL, schema,
> dependency, configuration or hosting change, and authorizes none; each Multi-User milestone still
> needs its own authorization.
>
> **Numbers.** Where a value is labelled an *implementation default*, the architecture does not depend
> on it. It may be tuned at implementation time without amending this record.
>
> **Scope of "Accepted".** Every architecture-level security decision is made. The owner items in §20
> are configuration or readiness choices that this architecture already accommodates.

---

## 1. Context and Trust Boundary

ADR-0004 places the shared multi-user backend on the existing Hostinger Premium Web Hosting:

- `https://finance.reliabilityindonesia.com/` serves the static frontend;
- `/api/*` serves a PHP 8.3 API;
- MariaDB/MySQL (InnoDB) is the authoritative store.

ADR-0004 also accepts two responsibilities explicitly:

- There is **no database Row-Level Security backstop**. Authorization is enforced by application code.
- Authentication and session handling are owned by TAM OS.

This record turns those into rules.

```
CURRENT (no boundary)
  Browser → LocalIdentityProvider → "Acting as" → client can()/getScopedRecords() → localStorage

TARGET (server-enforced)
  Browser (untrusted) ──same-origin HTTPS──▶ /api/* (PHP)
      ├─ authenticate: opaque session cookie → session row → user
      ├─ resolve principal: user → active membership → role, company_id, employee_id
      ├─ authorize: server POLICY over the 20 ACTIONS (default deny)
      └─ data-access layer: principal-scoped, prepared SQL only ──▶ MariaDB (InnoDB)
```

**Never trusted from the browser** — whatever the request body, query string, headers, cookies other
than the session cookie, or local storage say:

| Claim | Authoritative source |
|---|---|
| User identity | Session row resolved from the session cookie |
| Role, company, employee | The user's **active membership** row |
| Permission to act | Server `POLICY` evaluated on that principal |
| Record ownership | The stored row's `company_id` / `employee_id` |
| Salary / payroll visibility | Server scope rules |
| Audit actor and time | The session principal and the database clock |
| Account active / disabled | Membership and user status |

## 2. Authentication

### 2.1 Password storage

- `password_hash()` with **`PASSWORD_ARGON2ID`** when the host's PHP build supports it (verified at
  pre-deployment, §17). **`PASSWORD_BCRYPT`** is the accepted fallback.
- `password_verify()` for checking. `password_needs_rehash()` runs on every successful login, and the
  hash is upgraded when algorithm or cost parameters change.
- **No custom password cryptography, no pepper scheme and no reversible storage.**
- If bcrypt is in use, passwords over **72 bytes are rejected**, because bcrypt silently truncates
  longer inputs.

### 2.2 Password policy

These are implementation defaults and the owner may tighten them:

- minimum 12 characters and maximum 128 (72 bytes under bcrypt);
- no composition rules;
- reject the account's email and a short list of common passwords.

### 2.3 Login

1. **Identifier:** email address, normalized (trimmed and lower-cased).
2. **Failure response:** one generic message for every failure: unknown user, wrong password,
   disabled account, or no active membership.
3. **Timing:** when the user does not exist, a dummy `password_verify()` still runs, so response time
   does not reveal which accounts exist.
4. **Order of checks:** rate limit (§4) → credential verification → user and membership status →
   **only then** issue a session (§3).
5. **Audit:** successes and failures are recorded (§9). A password is never logged in any form.

### 2.4 Provisioning

- **No public self-signup.** There is no registration endpoint.
- Accounts are created **only** through a privileged server operation (§11) available to the **CEO
  role**. It creates the user and the membership in **one transaction**: role, `company_id` and an
  optional employee binding.
- The new user sets their own password through a single-use activation link with the same token
  properties as recovery (§5). No administrator ever chooses or sees the user's password.
- An Employee-role account must be bound to an existing authoritative Employee record.

### 2.5 MFA

Not required by this record for initial launch (question O2 in §20). The session model admits a later
TOTP step-up — a second verified factor recorded on the session row — without redesign.

## 3. Sessions

### 3.1 Model

- **Application-managed opaque sessions.** PHP's default file-based session storage is **not** used
  on the shared host.
- At login the server generates a token from 32 bytes of `random_bytes()`. The browser receives it
  **only** as the session cookie.
- MariaDB stores **only a hash** (SHA-256) of the token, with the session row holding:
  - user
  - creation time
  - last-seen time
  - absolute expiry
  - CSRF secret (§3.4)
  - revocation flag

  A leaked database therefore yields no usable session tokens.
- **The principal is resolved on every request** from the session row plus the **current** membership.
  Role, company and employee are never cached in the cookie or trusted from the client.
- An unknown, expired or revoked token is treated as unauthenticated. A client-supplied token that is
  not in the database is never adopted, which defeats session fixation.

### 3.2 Cookie

`__Host-tamos_session=<token>; Secure; HttpOnly; SameSite=Strict; Path=/`

It has **no `Domain` attribute** (the `__Host-` prefix requires this). The cookie never reaches the
apex site or other subdomains.

### 3.3 Lifetime and rotation

| Event | Behaviour |
|---|---|
| Idle timeout | Implementation default **30 minutes** without an authenticated request |
| Absolute timeout | Implementation default **12 hours** after login, regardless of activity |
| Login | Always a **new** token |
| Privilege change (role, company, employee binding, status) | All of that user's sessions are **revoked**; the user signs in again |
| Logout | The session row is revoked server-side and the cookie cleared |
| Password change or reset | **All** of the user's sessions are revoked |
| Disable | Denied on the next request (§12), and all sessions revoked |
| Revoke-all | A privileged operation for the CEO (any user) and for users (their own sessions) |

### 3.4 CSRF

Same origin does **not** remove CSRF. The controls:

1. `SameSite=Strict` as defense-in-depth.
2. **A synchronizer token.**
   - A per-session CSRF secret is stored on the session row and delivered in the JSON body of an
     authenticated session endpoint. It is never put in a cookie.
   - The client sends it as the `X-CSRF-Token` header.
   - The server compares it with `hash_equals()`.
3. **Origin check.**
   - `Origin` must equal `https://finance.reliabilityindonesia.com`.
   - If `Origin` is absent, `Referer` must have that origin.
   - If both are absent, the request is **rejected**.
4. State-changing requests must carry `Content-Type: application/json`, which blocks simple
   cross-site form posts.

**All `POST`, `PUT`, `PATCH` and `DELETE` requests** are validated. **`GET` and `HEAD` never change
state.** Login and password-recovery requests are not yet session-bound, so they get the origin check
and rate limiting (§4) instead of the synchronizer token.

## 4. Rate Limiting

- The state is **server-side in MariaDB**: attempts and lock-until per key. No client value is
  trusted.
- Limits run on **two dimensions**: per account identifier **and** per client IP. The IP is taken
  from the connection, or from a proxy header **only** if the pre-deployment gate establishes which
  header the Hostinger CDN sets trustworthily.

| Surface | Implementation default |
|---|---|
| Login | 5 failures per account per 15 minutes, then exponential backoff; 20 per IP per 15 minutes |
| Password recovery / activation requests | 3 per account per hour; 10 per IP per hour; the response is always generic |
| Account administration (create, disable, role change, revoke-all) | Rate-limited per principal and audited |
| Other writes | Not rate-limited by default; add a limit only on evidence of abuse |

Lockouts are **temporary** (backoff) rather than permanent, so an attacker cannot lock the CEO out
indefinitely.

## 5. Password Recovery and Activation

- The token comes from 32 bytes of `random_bytes()`, sent in a link to the account's email.
- **Only its SHA-256 hash is stored**, bound to the user and purpose (recovery or activation).
- Expiry: implementation default **30 minutes** for recovery and **72 hours** for activation.
- **Single use.** The token is consumed in the same transaction that sets the password. Requesting a
  new token invalidates earlier ones.
- A successful reset **revokes all sessions** (§3.3) and is audited. Recovery never re-enables a
  disabled account.
- A recovery request **always** gets the same generic response, whether or not the account exists.
- Mail goes through **governed SMTP**, with credentials stored as secrets (§14). A maintained mailer
  library is the expected route (§15), rather than hand-written SMTP.

## 6. Identity and Membership

```
user ──1:1 (current scope)──▶ membership
                                ├── company_id
                                ├── role          'ceo' | 'employee'
                                ├── employee_id   0..1 → employees.id
                                └── status        'active' | 'disabled'
```

- **User ≠ Employee**, as in ADR-0004 §2.1.
  - A user is a login subject; an Employee is a business record whether or not anyone logs in.
  - The CEO may have **no** employee binding.
  - A departing Employee keeps their records; their membership is disabled.
- **Role lives on the membership** and is stored explicitly, never derived from data. Only the two
  current roles exist, with no general RBAC.
- **Current scope:** exactly **one active membership per user**, and one company.
  - The model does not prevent more memberships later, but no company switching or tenant
    administration is built.
  - A second company is an ADR-0004 §5 revalidation event.
- **Employee binding:** zero or one per user. It is unique per company among active memberships,
  and it targets `employees.id` (the opaque `uid()`), never the human employee code.
- An unknown role, a missing membership, or more than one active membership all mean **deny**.

## 7. Authorization

- **`ACTIONS` stays 20.** The server holds the **authoritative** `POLICY` over the same vocabulary as
  `js/core/authz.js`. The client `can(...)` and `getScopedRecords()` remain **UX affordance only**.
- **Every state-changing endpoint maps to one or more `ACTIONS`.** An endpoint with no mapped action is
  a defect, and it fails closed. Reads are governed by scope (§8), mirroring today's split between
  authorization and scope.
- **Default deny:**
  - no principal → 401
  - unknown action → deny
  - unknown role → deny
  - disabled user or membership → deny
  - indeterminate state → deny

  There is **no fallback** to CEO or company capability. This is the current AZ-2 rule, now enforced
  on the server.
- For record-bearing actions, the action check runs **after** the scope check (§8), which is the
  server form of today's AZ-1 precondition.

## 8. Data-Access Boundary and Scope

This is the control that replaces RLS.

### 8.1 One data-access layer

- **SQL exists only** in the backend's designated data-access (repository) directory.
- Controllers/endpoints and services never issue SQL.
- Each repository method **requires the resolved principal** (or an explicit system context for
  migrations and jobs) as a parameter. There is no global "current user" inside SQL helpers.
- **The layer injects scope centrally**, so callers cannot omit it:
  - **Company scope** on every company-owned table: the `company_id = principal.company_id`
    predicate on reads, and `company_id` forced from the principal on writes.
  - **Employee self-scope** for the Employee role on self-scoped entities: the stored `employee_id`
    must equal `principal.employee_id`. This mirrors the six `ENTITY_SCOPE` predicates, including the
    deliberate rule that company transactions with no `employee_id` are outside every Employee's
    scope.
- **PDO with prepared statements only:**
  - `PDO::ATTR_EMULATE_PREPARES = false`
  - `ERRMODE_EXCEPTION`
  - `utf8mb4`
- **User-controlled values are never concatenated into SQL.** Identifiers that must vary (sort column,
  direction) come only from server-side allow-lists.

### 8.2 Enforcement in CI (to be built with the backend foundation)

A static check fails the build if any of these appear outside the data-access directory:

- SQL keywords used as query strings;
- `PDO` construction;
- `->query(`, `->exec(` or `->prepare(`.

Hostile-principal tests (§17) prove the scope at runtime.

### 8.3 Scope rules

- `company_id` is **never taken from the request**. A request-supplied `company_id` or `employee_id`
  can never widen access.
- Cross-company reads and writes → deny. Missing or ambiguous scope → deny.
- **Out-of-scope record IDs return 404** — indistinguishable from non-existent, which preserves
  today's semantics and prevents existence probing.
- **403** is returned only when the record is in scope but the **action** is denied.

## 9. Sensitive Data and Audit

### 9.1 Sensitive categories

| Category | Who may receive rows |
|---|---|
| Salary, payroll plans and adjustments, contracts and compensation, overtime amounts | CEO; the bound Employee (own rows only) |
| Employee personal data (identity, contact, bank account) | CEO; the Employee themself. Bank numbers stay masked in general exports |
| Finance records | CEO; employee-linked rows also to that Employee |
| Approval and audit records | Read by CEO; written only by the server |

**A browser never receives a row it is not entitled to.** Filtering on the client is not
authorization. Aggregates, search, exports and reports are computed server-side over **already
scoped** rows.

### 9.2 Audit

- **Append-only.** The data-access layer exposes no update or delete for audit rows, and the CI check
  treats any such SQL as a violation. Where the host allows per-user database grants, the application
  user is also denied `UPDATE`/`DELETE` on the audit table; whether it does is pre-deployment evidence
  (§17).
- **The actor** (user and, where bound, employee) comes from the **session principal**. A
  browser-supplied actor ID is never accepted.
- **The time** is the database clock. A client timestamp is only a labelled informational field.
- **Transaction:** a business mutation and its audit row are written in the **same transaction**.
- **Always audited:**
  - login success and failure (the identifier, never the password);
  - recovery requested and completed, and activation;
  - account creation, disable and enable;
  - role, company or employee-binding changes;
  - revoke-all;
  - every one of the 20 `ACTIONS` when it mutates, including approval and payroll-affecting
    transitions.
- **Never logged:** passwords, tokens (session, CSRF, recovery), secrets, or full request bodies.

## 10. Transactions

InnoDB transactions are **mandatory** for:

- any operation that writes more than one row or table, such as payroll commit, post and execute,
  which today touches four collections;
- every state transition together with its audit row;
- payroll-affecting and approval writes;
- security operations that must be atomic: account plus membership creation, token consumption plus
  password change, and privilege change plus session revocation.

**Concurrent transitions** lock the rows they read before changing them (`SELECT … FOR UPDATE`).
**Concurrent edits** of mutable business rows use optimistic versioning, so a lost update is rejected
with a typed conflict rather than silently overwritten. **Composite operations** (post, commit,
execute, import) accept an idempotency key.

MariaDB DDL commits implicitly, so **migrations are never mixed with data changes in one assumed
transaction**. Migration discipline belongs to the backend-foundation milestone.

## 11. Privileged Server Operations

An operation must be an explicit, named server operation (never generic CRUD) if **any** of these
hold:

- it creates or changes accounts, memberships, roles, status or sessions;
- it moves committed or irreversible state (`CLAUDE.md` §8.1, §9), such as payroll post/execute or
  finance execution;
- it changes more than one row or table as one unit;
- it is an approval transition;
- it needs server-derived values: actor, time, computed money totals;
- it aggregates across scope;
- it must be idempotent.

Only single-row reads and writes whose whole rule is the scope predicate plus one `ACTIONS` check
may use the generic repository path.

## 12. Disable and Revocation

- Disabling a user or membership is checked **on every request**, so access ends on the **next
  request**.
- Every session of that user is revoked in the same transaction, and the change is audited.
- Changes to role, company, employee binding or status revoke all affected sessions (§3.3).
- A password reset revokes all sessions.
- The CEO can revoke all sessions of any user; any user can revoke their own.
- **No data is deleted on disable.**

## 13. Transport, Headers, CORS and Caching

### 13.1 Security headers

Required before real data. Headers are set by PHP for `/api/*` and by the host's `.htaccess` support
for static files; the host behaviour is verified pre-deployment (§17).

| Header | Requirement |
|---|---|
| `Content-Security-Policy` | `default-src 'self'`; `script-src 'self'` plus the SRI-pinned spreadsheet parser origin; `connect-src 'self'`; `img-src 'self' data:`; `font-src 'self' data:`; `object-src 'none'`; `base-uri 'none'`; `form-action 'self'`; `frame-ancestors 'none'`. **No `'unsafe-inline'` scripts** — this is why Distribution-1 is required. Whether styles need `'unsafe-inline'` is settled in Distribution-1 |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Strict-Transport-Security` | Enabled once HTTPS is stable on the hostname. Start short, then `max-age=31536000`. **No `includeSubDomains` or preload** without checking the impact on the apex site and sibling subdomains |
| `Permissions-Policy` | Deny unused features (camera, microphone, geolocation) |

### 13.2 Same origin and CORS

- TAM OS needs **no application CORS**. The API sends **no** `Access-Control-Allow-Origin`, never
  `*`, and never reflects the origin.
- Cross-origin state-changing requests fail the Origin check (§3.4).
- The API serves only the canonical frontend origin unless a future ADR says otherwise.

### 13.3 Caching

- Every `/api/*` response carries `Cache-Control: no-store, private`.
- Authentication and session-bearing responses are never cacheable.
- The **Hostinger CDN must bypass or respect this for `/api/*`**, verified before real data (§17).
- A cached API response that reached another user would be a confidentiality breach.

## 14. Secrets

**Secrets are:**
- database credentials;
- SMTP credentials;
- the application secret (if any keyed hashing or HMAC is used);
- backup-encryption keys;
- any future third-party credentials;
- the Hostinger/hPanel and SFTP credentials themselves.

**Rules:**
- never committed;
- never in the frontend;
- **never inside the public web root**;
- held in a configuration file **outside the web root**, which must be verified possible
  pre-deployment (§17);
- readable only by the account's PHP process;
- development and test use separate, non-production values;
- any exposure means immediate rotation per `SECURITY.md`.

The **Hostinger account itself is a super-credential**: it can read files and databases and restore
backups. **Two-factor authentication on the Hostinger account is a pre-deployment requirement**, and
access to it is limited to the maintainer (plus a named delegate if the owner designates one).

## 15. Dependencies

- A Composer dependency is admitted only when its security and maintenance benefit **exceeds** that
  of a small custom implementation. It must be:
  - minimal;
  - pinned with a committed lock file;
  - security-reviewed;
  - approved under `CLAUDE.md` §6.2 and §20.
- **No framework is adopted merely to obtain one utility.** Routing, sessions, CSRF, rate limiting
  and password hashing are small and built on PHP built-ins (`password_*`, `random_bytes`,
  `hash_equals`, PDO).
- **Outbound email** is the expected exception. Hand-written SMTP (TLS, authentication, header
  injection) is riskier than a maintained mailer library. The specific package is chosen and approved
  at the implementation milestone, not here.

## 16. Backup and Recovery Security

The target is from ADR-0004 §2.6:

1. the provider backup (currently **Weekly**);
2. a nightly database dump;
3. an encrypted off-host copy;
4. restore rehearsal;
5. RPO about 24 hours.

Security requirements:

- Dumps are **encrypted before they leave the host**, with a key held **outside** the host (for
  example the private layer). The host holds only what it needs to encrypt.
- A dump is **never written inside the public web root**, and temporary files are removed after
  transfer.
- Off-host copies live in the private company layer with access limited to the maintainer (and any
  named delegate).
- **Restore rehearsal before real data**, then periodically. It restores into a **separate**
  database and reconciles row counts **and monetary totals**.
- Retention is set before production (question O4). The architecture does not depend on its value.

## 17. Pre-Deployment Security Evidence Gate

**Before real company data**, each item needs recorded evidence (in addition to
[`DEPLOYMENT.md`](../DEPLOYMENT.md) §8):

| # | Evidence |
|---|---|
| E1 | Backend configuration and secrets can live **outside the public web root** and are unreadable over HTTP |
| E2 | PHP extensions: `pdo_mysql`, `openssl`, `mbstring`, `sodium`; and Argon2id support, or the bcrypt fallback is recorded |
| E3 | MariaDB/InnoDB transactions and row locking behave as designed; the version is recorded |
| E4 | Cron is available and runs the nightly encrypted dump |
| E5 | The Hostinger CDN does not cache `/api/*`, and the trustworthy client-IP source is identified |
| E6 | TLS is valid and headers (§13.1) are applied to both `/api/*` and static files |
| E7 | An off-host encrypted copy exists and a **restore rehearsal** passed with reconciliation |
| E8 | **The physical location of the hosting data is recorded** (§19) |
| E9 | Whether per-user database grants are available (audit append-only at grant level, least-privilege application user) is recorded |
| E10 | The Hostinger account has **2FA**, and access holders are listed |
| E11 | Hostile-principal authorization tests pass for every endpoint and scoped entity; the CI SQL-boundary check is green |
| E12 | An **external security review** is completed, with findings resolved or explicitly accepted by the owner |

## 18. Shared-Hosting Risk

The Hostinger account also serves the company's `reliabilityindonesia.com` web presence.

**Not verified:**
- the **filesystem, process and database isolation** between the two sites inside one hosting
  account;
- whether the apex site shares TAM OS's filesystem at all. It appeared to run on Hostinger's Website
  Builder, but that is not confirmed.

**Assumption:** a compromise of the account, or of any site in it, may expose TAM OS files, secrets
and databases.

**Controls:**
- a **dedicated database and database user** for TAM OS, never shared with the website;
- TAM OS secrets outside every web root (§14);
- no other PHP application inside TAM OS's document root;
- least privilege where the host allows it (E9);
- Hostinger account 2FA (E10);
- encrypted off-host backups, so recovery doesn't depend on the compromised account (§16).

**Why the external review (E12) is mandatory:** with no database RLS backstop and a shared account,
an independent check is the only safeguard against a single application bug or a sibling-site
compromise exposing payroll data.

## 19. Data Residency

- The physical location of Hostinger's servers and database for this account is **not established**
  by any evidence in this repository.
- **The hosting data location must be verified before real employee and payroll data** (E8). hPanel
  normally shows the server location.
- Whether that location is acceptable — including any Indonesian personal-data or sector rules that
  apply to PT Total Asset Manajemen — is a **company compliance gate owned by the owner**.
- This does not change the architecture. A disallowed location is an ADR-0004 §5 revalidation event.

## 20. Owner Items — Configuration, Not Architecture

None of these changes the architecture. Each is settled before production readiness:

| # | Item | Default until decided |
|---|---|---|
| O1 | Employee logins at launch, or CEO-only first | Both supported. Employee accounts are simply not provisioned until approved |
| O2 | MFA required at launch? | Not required; a TOTP step-up can be added (§2.5) |
| O3 | Who may create and disable accounts | CEO role only (§2.4) |
| O4 | Backup retention | Set before production (§16) |
| O5 | SMTP provider | Any governed SMTP; credentials are secrets (§14) |
| O6 | Password policy beyond §2.2 defaults | §2.2 defaults |

## 21. Threat Model

| # | Threat | Control | Residual risk |
|---|---|---|---|
| 1 | Modified JS / devtools | Server re-resolves principal and re-authorizes everything (§1, §7) | None beyond server bugs |
| 2 | Forged API request | Session required; CSRF token + Origin check; `POLICY` + scope (§3.4, §7, §8) | Server bugs |
| 3 | Role spoofing | Role only from membership (§6) | — |
| 4 | Company spoofing | `company_id` from principal, injected centrally (§8) | — |
| 5 | `employee_id` spoofing | Self-scope from membership binding; request IDs cannot widen (§8.3) | — |
| 6 | IDOR | Scoped repository lookups; out-of-scope → 404 (§8.3) | A missed predicate; mitigated by CI and hostile tests |
| 7 | SQL injection | Native prepared statements only; allow-listed identifiers; CI boundary check (§8) | Low |
| 8 | XSS | Escaping (`CLAUDE.md` §6.3), strict CSP, `HttpOnly` cookie (§3.2, §13.1) | Injected script can still act as the user while the page is open |
| 9 | CSRF | SameSite=Strict + synchronizer token + Origin + JSON-only; no state-changing GET (§3.4) | Low |
| 10 | Session theft | HttpOnly + Secure + `__Host-`; short idle and absolute limits; hashed tokens at rest; revoke-all (§3) | Theft from a compromised device |
| 11 | Session fixation | New token at login; unknown tokens never adopted (§3.1) | — |
| 12 | Brute-force login | Per-account + per-IP limits with backoff; generic errors; strong hashing (§2, §4) | Distributed guessing slowed, not eliminated; O2 |
| 13 | Recovery abuse | Hashed single-use short-lived tokens; generic responses; limits; sessions revoked (§5) | Compromised mailbox |
| 14 | Disabled user with an old session | Status checked every request; sessions revoked (§12) | — |
| 15 | Missing authorization predicate | Central scope injection; default deny; CI check; hostile tests; external review (§7, §8, E11, E12) | **The principal residual risk of ADR-0004** |
| 16 | Audit actor spoofing | Actor and time server-derived; append-only; same transaction (§9.2) | Grant-level immutability depends on E9 |
| 17 | CDN caches a sensitive response | `no-store, private` + verified bypass (§13.3, E5) | Until E5 is verified |
| 18 | Leaked database or SMTP secret | Outside the web root, never in the repo, rotation; hashed tokens limit database-leak value (§3.1, §14) | Host-level compromise |
| 19 | Compromised backup | Encrypted before leaving the host; key held off-host; restricted access (§16) | Key compromise |
| 20 | Compromised sibling site / Hostinger account | Separate database and user, secrets off web roots, account 2FA, off-host backups, external review (§18) | Isolation unverified; a residual risk accepted by ADR-0004 |

## 22. "Acting as" Retirement Gate

The production "Acting as" selector is removed **only after all** of these hold, in order:

1. production login works;
2. the session resolves an authoritative user;
3. an active membership;
4. role from the membership;
5. employee binding;
6. server-side authorization and scope enforced (E11 green);
7. authenticated workspace derivation through `IdentityProvider.getCurrentUser()`;
8. authenticated end-to-end tests pass.

There is **no** implicit CEO fallback and **no** implicit Employee fallback. A missing or invalid
principal means no access.

## 23. Security Invariants

1. **The browser is untrusted.**
2. **The PHP backend is authoritative.**
3. **The database is never reachable from the browser.**
4. **Unknown principal → deny.**
5. **Unknown role → deny.**
6. **Disabled user or membership → deny.**
7. **Client `can()` is UX only.**
8. **Role, company and employee identity are server-derived** from the active membership.
9. **Every company-owned row is company-scoped**, with scope injected by the data-access layer.
10. **Employee self-scope is server-derived** from the membership binding.
11. **Raw SQL exists only in the approved data-access layer.**
12. **Prepared statements are mandatory.**
13. **Unauthorized rows are never sent to the browser.**
14. **Security-relevant audit identity and time are server-derived**, and audit is append-only.
15. **Secrets never reach the frontend, the repository or the public web root.**
16. **API responses are never publicly cached.**
17. **No real company data before the readiness and security gates pass** (§17,
    [`DEPLOYMENT.md`](../DEPLOYMENT.md) §8).

## 24. Compatibility and Consequences

- **ADR-0004:** fully compatible. This record details §2.3–§2.7 and changes no decision.
- **Distribution-1:** must deliver, and have verified:
  - a frontend package with **no inline script**, so the §13.1 CSP holds without `'unsafe-inline'`;
  - the SRI-pinned spreadsheet parser;
  - embedded fonts via `data:` or same-origin files;
  - a relative `/api` base, with no runtime key or configuration.

  A check on 2026-09-29 found that the current source has no inline event-handler attributes and no
  `eval` / `new Function`. The portable build has 3 inline `<script>` blocks (removed by packaging)
  and about 428 inline `style` attributes, so the style-source policy is a Distribution-1 decision.
- **Backend foundation:** must deliver the data-access directory, the CI SQL-boundary check (§8.2),
  the hostile-principal test harness, and migration discipline (§10) **before** any business
  endpoint.
- **Governance:** no `CLAUDE.md` change is needed. `CLAUDE.md` §6.2 and §20 govern the mailer
  dependency (§15).

## 25. Revalidation Triggers

Re-examine this record if:

- ADR-0004 is revalidated or superseded;
- a third role, a second company, or external users appear;
- MFA becomes mandatory (O2);
- any E-item fails;
- the external review or an incident finds an authorization bypass, cached sensitive response,
  session or CSRF weakness;
- Hostinger changes plan capabilities or isolation guarantees;
- a new third-party integration handles personal or payroll data.

---

*Lifecycle: Proposed → Accepted → (Superseded | Deprecated). See [`README.md`](README.md) for the
register.*
