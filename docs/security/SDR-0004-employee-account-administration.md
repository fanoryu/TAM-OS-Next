# SDR-0004 — Employee Account Administration

| Field | Value |
|---|---|
| **Record** | SDR-0004 |
| **Title** | Employee Account Administration — the `account.manage` ACTION, activation through the governed mail outbox, and Employee account disable / enable |
| **Status** | **Accepted** |
| **Author** | Maintainer |
| **Accountable approver** | Maintainer (`CLAUDE.md` §20) — owner decisions D-BF4a-1 = B, D-BF4a-2 = B and BF-4a2 C1 = A, 2026-10-01 |
| **Date created** | 2026-10-01 |
| **Next review** | Before the first real Employee account is provisioned (production cutover), then annually |
| **Supersedes** | **Partially** [SDR-0002](SDR-0002-php-mariadb-security-architecture.md): only the clauses that fix the ACTION count at 20 (§2 below). Every other SDR-0002 requirement stays in force, and SDR-0002 stays Accepted and unchanged |
| **Superseded by** | — |
| **Related** | [SDR-0002](SDR-0002-php-mariadb-security-architecture.md) §2.4, §5, §6, §7, §8, §9.2, §10, §11, §12; [SDR-0003](SDR-0003-governed-mail-transport.md) §3, §4, §7, §8; [ADR-0004](../03b-repository-adr/ADR-0004-hostinger-same-origin-backend.md); `CLAUDE.md` §4.3, §17, §20 |

> **What this is.** The security decision for **BF-4a2**: how the CEO creates and administers login
> accounts for existing Employee records on the ADR-0004 backend. It records the new ACTION, the
> supersession of SDR-0002's frozen ACTION count, and the SDR-0003 §8 revalidation for activation mail.
>
> **What it is not.** It implements nothing: no ACTION, migration, route, mail kind or worker change
> exists because of this record alone. It authorizes no frontend feature, no deployment and no real
> mail. BF-4a2 implementation is a separate, owner-authorized step.

---

## 1. Decision

1. **New ACTION `account.manage`.** BF-4a2 adds one ACTION, `account.manage`.
2. **CEO only.** Its rule is CEO-only. An Employee is denied; an unknown action, role or state is
   denied (SDR-0002 §7 default deny, unchanged).
3. **Record-bearing.** It is decided against an Employee record: the server loads the Employee under
   the principal's scope first — absent and out of scope alike are **404** — and only then asks Policy
   — an in-scope record the principal may not administer is **403** (SDR-0002 §7, §8).
4. **One ACTION, four operations.** `account.manage` authorizes exactly four named server operations
   (SDR-0002 §11): **provision account**, **reissue activation**, **disable account** and
   **enable account**.
5. **Distinct audit operations.** Authorization is one ACTION, but each operation is recorded as its
   own audit operation (§6). The four are never collapsed into one indistinguishable event.
6. **One shared vocabulary.** The canonical ACTION vocabulary stays **shared** between the server
   (`server/src/Policy/Action.php`) and the frontend (`js/core/authz.js`). There is **no server-only
   ACTION** and no parity exception (owner decision C1 = A).
7. **ACTIONS 20 → 21.** BF-4a2 therefore moves the ACTION count from **20 to 21** in both places, and
   the frontend distribution package changes as a consequence.
8. **Vocabulary is not a feature.** `account.manage` in `js/core/authz.js` is authorization vocabulary
   and parity only. It authorizes no frontend feature and does not make client authorization a
   security boundary: the server Policy stays authoritative and the client `can(...)` stays UX
   affordance (SDR-0002 §7). Consuming `account.manage` in the authenticated Employee workspace is
   AFI-4a's work.

## 2. Supersession of SDR-0002 (partial)

SDR-0002 froze the ACTION count when the vocabulary held 20 actions. This record supersedes **only**
these clauses:

| SDR-0002 | Clause | Replaced by |
|---|---|---|
| §7, first bullet | "**`ACTIONS` stays 20.**" | The vocabulary is the shared set of §1.6, now 21 with `account.manage`; it changes only through a decision record |
| §1, target diagram | "server POLICY over the 20 ACTIONS" | server POLICY over the shared ACTIONS |
| §9.2, "Always audited" | "every one of the 20 `ACTIONS` when it mutates" | every ACTION when it mutates, `account.manage` included |

The rest of each clause stands: the server holds the authoritative POLICY over the **same**
vocabulary as `js/core/authz.js`; every state-changing endpoint maps to an ACTION; default deny;
record-bearing actions are decided after scope. SDR-0002's text is not edited; this record and the
register carry the supersession.

## 3. Account administration rules

**Topology (source-derived).** Under the current schema a user has exactly one membership
(`UNIQUE (user_id)`), and an Employee login is a membership with role `employee` bound to
`memberships.employee_id` (SDR-0002 §6). Account state is **derived** from the user, membership and
Employee rows, not stored as a new flag (`CLAUDE.md` §4.4).

1. **Provisioning is separate from Employee creation.** `employee.create` never creates an account,
   and an Employee may exist without one.
2. **The Employee exists first.** Provisioning targets an existing, non-archived Employee record of the
   principal's company.
3. **Activation topology.** Provisioning creates exactly what the existing activation lifecycle
   expects: a user with status `active` and `password_hash` NULL, and an `active` membership with role
   `employee` bound to that Employee — in one transaction with its outbox row and audit record.
4. **Activation authority unchanged.** `POST /api/auth/activate` stays the only activation path; it
   needs no behavioral redesign. Existing account-token, password and session primitives are reused,
   never duplicated.
5. **No raw token to the browser.** No route ever returns a raw activation token, link or token hash to
   the CEO or any browser.
6. **Disable** acts on the Employee's **membership** — never on `employmentStatus`, and never
   automatically on `users.status`. In the same transaction it revokes every session and every open
   account token of the target user (SDR-0002 §12).
7. **Enable** restores the membership status only. It sends no activation mail by itself; an account
   that never activated is pending again and needs a reissue.
8. **Independence.** Employment status and login / account status stay independent: neither changes
   the other. Employee archive and account disable stay distinct (an Employee with an active login
   cannot be archived — BF-4a1).
9. **CEO-target guard (mandatory).** A CEO membership may be bound to an Employee record. Every
   Employee account operation therefore refuses a target membership whose role is not `employee`, so
   Employee-keyed administration can never disable or alter a CEO membership — including the acting
   CEO's own.
10. **Scope from the session only.** Cross-company targets stay concealed by server scope (404). No
    route accepts a `company_id`, `user_id`, actor identity, token, role or any other scope or security
    authority from the client; the target is named only by Employee id.

## 4. Activation mail — SDR-0003 §8 revalidation

SDR-0003 §8 makes "a second mail kind beyond recovery" a revalidation trigger. Activation is that
second kind. Activation delivery uses the **governed mail outbox** (owner decision D-BF4a-2 = B):

1. The request transaction **enqueues** activation delivery intent only. It neither creates nor sends a
   raw token.
2. The **outbox worker** issues the activation token **at send time**, with the existing token
   generation and hashing primitives and the existing activation expiry.

**Revalidation performed for this design.** SDR-0003's controls hold unchanged for the activation
kind:

| SDR-0003 control | Holds for activation because |
|---|---|
| Link origin from server configuration only; token in the URL fragment | the activation link uses the same canonical-origin rule, as `<origin>/#activation=<token>` (the form the AFI-3 frontend already reads) |
| Token generation and hashing | the same primitives as recovery and the bootstrap CEO: random bytes, only the SHA-256 hash at rest |
| No secret at rest | the outbox row holds only the user, the kind and the delivery state; the raw token exists only transiently in the worker's memory and in the message — never in the database, the outbox or an HTTP response |
| Eligibility re-checked | the worker re-reads the account under lock at send time and cancels the row unless the account is still awaiting activation |
| Single use, expiring | the activation token stays single-use and expiring; a newer token revokes earlier ones |
| Asynchronous delivery | mail network I/O happens only in the worker, never inside a business transaction or an HTTP request; only the durable outbox enqueue is transactional |
| No business data in mail | the message carries an address and a link only |

The transport, provider, sender domain and dependency posture of SDR-0003 are unchanged. SDR-0003
stays Accepted and unchanged; this section is its revalidation for the activation kind.

## 5. Transactions

Each operation is one transaction over the account rows, the outbox enqueue (where applicable) and its
audit record (SDR-0002 §10): a failure of any part rolls back the whole. Mail delivery is never part
of it (§4).

## 6. Audit

- Business audit records for account administration use the **authenticated session actor** and the
  **target user** (`target_user_id`, reserved for BF-4a2 by BF-4a1), on the database clock, in the
  same transaction as the change (SDR-0002 §9.2).
- **Provision, reissue, disable and enable are distinguishable operations** in the audit trail, even
  though all four are authorized by `account.manage`.
- No password, token, link or token hash is ever recorded.
- The existing security events (`activation_ok`, `activation_fail`, `mail_fail`) keep recording the
  activation and delivery outcomes.

## 7. Consequences

- The frontend distribution package changes once, for the vocabulary entry (ACTIONS 21), with no new
  UI behavior.
- Activation mail adds the provider as processor of the Employee's address and one-time link, as for
  recovery (SDR-0003 §6); whether this is acceptable is part of the SDR-0002 §19 compliance gate.
- A CEO cannot administer their own membership through the Employee routes (§3.9); CEO credential
  recovery stays with the operator CLI and self-service recovery.

## 8. Pre-deployment evidence (in addition to SDR-0002 §17 and SDR-0003 §7)

| # | Evidence |
|---|---|
| A1 | An activation mail with fabricated content is delivered to an owner-controlled mailbox and its link activates a fabricated Employee account on the production origin |
| A2 | Disabling that account ends its session on the next request, and its activation and recovery links no longer work |

## 9. Revalidation triggers

Any further ACTION; any route that administers accounts outside the Employee-keyed operations of §1.4;
allowing a user more than one membership; any change that lets a client name a user, company or role;
returning or logging an activation token or link; a third mail kind; coupling employment status to
account status.
