# ADR-017 — CEO-Assigned Financial Post for Reimbursements (CR-01)

**Status:** Accepted — 2026-11-20 (Owner acceptance of revision 2 and of decision R2-2 = Option A; see *Acceptance*)
**Supersedes (in part):** ADR-016 (`docs/03-adr/ADR-016-Finance-Payment-Requests-and-Reimbursements.md`) —
only the reimbursement Financial Post provisions listed in *Superseded provisions*. Every other ADR-016 rule
stays in force unchanged.
**Evidence baseline:** `main` @ `609d50a7429ab9da6d7c6795b77dedbce9a98b7b` (migration head 0041, ACTIONS 24,
routes 67, package digest `270af38d…`, CR-02 merged).
**Owner decisions:** CR01-D1 … CR01-D9, confirmations R-1 … R-3 and governance G-1 … G-5, all given on
2026-11-20 and recorded in `CR01-OWNER-DECISIONS.md`. Once accepted, this record is filed through a separate
documentation-only pull request before any CR-01 implementation (G-2).

> **Accepted 2026-11-20. This record is immutable;** a later decision supersedes it with a new record and
> never rewrites it. It supersedes only the ADR-016 provisions listed in *Superseded provisions*; ADR-016
> stays unchanged and in force for everything else. Acceptance of the decision does not authorize
> implementation: a CR-01 implementation GO must name migration 0042 and its test requirements. The body
> below is revision 2 as accepted, unchanged.
>
> **ADR-015 stays reserved** for the Phase 1 decisions PD-1 … PD-11.

## Context

- ADR-016 (Accepted 2026-11-17) requires a Financial Post on every finance request from creation:
  `finance_requests.financial_post` is `NOT NULL` (migration 0039 line 5), and the reimbursement create body
  must carry `financialPost` for the CEO and the Employee alike (`server/src/Request/RequestInput.php:56`,
  `:88`).
- The post decides which cost centre (GA, NP & IP, TJB, RnD) bears the expense when the request is paid
  (`RequestService.php:228–236`) and where an Approved request appears in the report
  (`FinancialReportStore.php:37`).
- After the 2026-11-19 demo the Owner directed (CR-01) that allocation is a CEO decision: employees report
  what they spent, and the CEO decides which post bears it, at approval.

## Decision

### 1. Who sets the post, and when (CR01-D1, D2, D6, D9)

| Request | At create | At Draft edit | At approval | After approval |
|---|---|---|---|---|
| Reimbursement created by the Employee | **no post**; a body carrying `financialPost` is 400 | the Employee cannot set or change it (400) | CEO **must** select or confirm a valid post | immutable |
| Reimbursement created by the CEO for an employee | CEO **may** leave it empty or give one | CEO may set it, or replace a set post; **never clear** it | CEO **must** select or confirm a valid post, which may replace the earlier one | immutable |
| Payment request | unchanged: CEO gives it (required) | unchanged | unchanged: the approve body must **not** carry a post (400) | immutable |

Rules:
1. **Every reimbursement approval names the post (D6).** The approve body of a reimbursement is exactly
   `{ financeRequestId, expectedVersion, expectedAmount, financialPost }`, even when a post was assigned
   earlier. There is no server-side default and no separate "assign post" action.
2. **Approval and allocation are one write.** Inside the existing READ COMMITTED transaction, after the
   existing primary-key lock (`RequestStore::LOCK_SQL`) and the existing state, version and exact-amount
   guards, one UPDATE sets the status `Approved`, the final post, the previous-post snapshot (§3) and
   `version + 1`. No state exists in which a reimbursement is Approved without its post.
3. **The Employee never assigns or modifies the post (D8).** Employee create and Draft update refuse the
   key. An Employee editing other fields of a Draft leaves the stored post untouched, because the Employee's
   update statement no longer writes the column.
4. **"No post" has one spelling (D9).** Leaving the key out. An explicit JSON `null` is 400 on create, update
   and approve. Once a post is set on a Draft, the CEO can replace it but not remove it.
5. **Payment uses the final approved post.** ADR-016 §5 step 4 is unchanged; "the request's post" is, by
   construction, the post the CEO approved.

### 2. Data rule (migration 0042, forward-only)

- `finance_requests.financial_post` becomes nullable. The value list stays exactly `GA`, `NPIP`, `TJB`,
  `DRONE`. `DRONE` remains the canonical code, displayed as "RnD — Research & Development" (CR-02); no
  code is added, renamed or removed.
- Database CHECKs, written so that none can pass by SQL's unknown (NULL) result:
  - a payment request always has a post;
  - an Approved or Paid row always has a post;
  - a post may be absent only on a reimbursement in Draft, Submitted, Rejected or Cancelled;
  - a reimbursement whose approval was captured (`pre_approval_post_captured = 1`) always has a post, in
    every status, including Cancelled after approval. Only a reimbursement cancelled before approval
    (captured = 0) may be Cancelled with no post.
- Two new columns hold the approval snapshot (§3): `pre_approval_financial_post` (nullable post) and
  `pre_approval_post_captured` (boolean, default 0).
- No existing row is updated. Every row written under ADR-016 has a post and satisfies the new rules.

Full design: `CR01-MIGRATION-0042-DESIGN.md`.

### 3. Previous and final allocation: record snapshot, not audit values (CR01-D5, D7)

**What the audit trail records.** The approve audit row (action `finance.manage`, entity `financeRequest`,
operation `approve`) records the field **name** `financialPost` when the approved post differs from the post
stored before approval (including no post → a post), and no field when the CEO confirms the stored post.
It records **no values**. PD-9 and the `audit_events_fields` CHECK (migration 0017 line 24) allow field
names only; this ADR keeps that rule and does not claim that PD-9 permits values. The audit vocabulary
(migration 0041's triples) does not change. `AuditLog::appendRequest` is widened by exactly one case: `approve`
may name exactly `['financialPost']`; every other transition still names no field.

**What the request record retains.** The protected reimbursement record keeps both values:

| Column | Meaning |
|---|---|
| `financial_post` | the final, CEO-approved post |
| `pre_approval_financial_post` | the post stored immediately before approval, or NULL if there was none |
| `pre_approval_post_captured` | 1 when the snapshot was taken by an approval under ADR-017; 0 otherwise |

**The exact difference.** The audit row says *that* the allocation changed at approval, *who* did it
(actor, membership) and *when* (`occurred_at`), and it is append-only. The record snapshot says *what* the
allocation was before and after. It is not an audit event: it lives on the business row, it is protected
by the write rules of §4 and the CHECKs of §2, and it records only the single value in force at approval,
not every intermediate Draft change (each of those has its own `update` audit row naming
`financialPost`, without values). An immutable audit event carrying before/after values is **not**
adopted; that would need a separate decision amending PD-9.

**How the snapshot is taken.** The previous value is read from the row already locked `FOR UPDATE` by
primary key in the same transaction, and bound as a parameter. The UPDATE does not compute it from
another column, so it does not depend on the order in which SQL evaluates assignments. The UPDATE's
WHERE clause also requires the stored post to still equal that value (null-safe), the status to be
`Submitted` and `pre_approval_post_captured = 0`, so the write changes exactly one row or the
transaction rolls back.

**Rows approved before 0042 (D7).** They have `pre_approval_post_captured = 0` and
`pre_approval_financial_post` NULL. That means **the prior allocation was not captured**, not that it was
empty. The CEO view says "Not recorded (approved before CR-01)". After 0042, captured = 1 with a NULL
previous post means the request genuinely had no post before approval. The database guarantees that
captured = 1 always comes with a final post (`finance_requests_captured_post`), so a captured approval can
never lose its approved allocation, also after cancellation.

### 4. Protection of approved allocations

The only statements that write `financial_post` on `finance_requests` are:

| Statement | When | Guard |
|---|---|---|
| create (CEO, Employee) | insert of a Draft | Employee variant binds NULL |
| Draft update (CEO only) | edit of a Draft | `status = 'Draft'` in the WHERE (`RequestStore.php:74`); the Employee's update statement no longer names the column |
| approve (reimbursement) | Submitted → Approved | `status = 'Submitted'`, `kind = 'reimbursement'`, version, stored post, `pre_approval_post_captured = 0` |
| restore | off-host into an empty database only (`RestoreWriter`) | unreachable from HTTP (boundary tool) |

The two snapshot columns are written only by the approve statement (and by restore). Reject, cancel, pay
and submit never name any of the three columns. The backend boundary tool gains a rule enforcing this list,
so a new writer cannot be added silently. After approval no route can change the allocation; a correction
would need a new decision (ADR-016 P2-D6 forbids reversal or correction).

### 5. Authorization, concurrency, idempotency (unchanged guarantees)

- ACTIONS stay **24**; routes stay **67**; no role or rule is added. Approve stays under the record-free
  CeoOnly `finance.manage` check, so an Employee is 403 before any lookup.
- Employee self Scope, the 404-for-out-of-scope rule and enumeration prevention are unchanged.
- Optimistic concurrency: every write that changes the post increments `version`, so `expectedVersion`
  covers it. Two concurrent approvals → one success, one 409. A Draft update cannot race an approval: update
  needs Draft, approval needs Submitted, and both lock the row by primary key first.
- `expectedAmount` stays required on approve, compared as an exact string.
- Payment idempotency, the one-payment-per-request UNIQUE constraint, the pay lock order and the
  linked-void rule (ADR-016 §5, §7) are unchanged.
- Create idempotency is unchanged. A create replay is still recognised only when the stored request
  still holds the values the create sent, compared by `RequestService::sameCreate()` against the current
  row, with the post compared as sent (absent = NULL). As today, a retry of a create after the request was
  later changed is 409 `idempotency_mismatch`; CR-01 adds the CEO's post assignment to the changes that
  have this effect. No duplicate request can result. See `CR01-TECHNICAL-IMPACT-ASSESSMENT.md`,
  *Create idempotency*.

### 6. Interface (CR01-D8)

- **Employee, My reimbursements:** no Financial Post field on create or edit. The list and detail show the
  assigned post read-only, or the neutral status "Not yet assigned by the CEO" before assignment (R-2, in
  the English of the SESSION interface). The previous-post snapshot is CEO-only: the Employee API response
  carries neither `preApprovalFinancialPost` nor `preApprovalPostCaptured` (R-3).
- **CEO, Requests:** reimbursement create keeps an optional post select ("Not assigned"); Draft edit offers
  the select without an empty choice once a post is set. The approve dialog for a reimbursement has a
  required select, preselected with the stored post when there is one. The detail shows previous and final
  post after approval.
- Labels come from `FINANCIAL_POSTS` (`js/core/transaction-api.js`). Existing CSS only.

## Superseded provisions of ADR-016

Only these. Everything else in ADR-016 stays in force.

| ADR-016 | Provision | Replaced by |
|---|---|---|
| §1, column table, `financial_post` | always one of the four posts | absent allowed only for a reimbursement in Draft, Submitted, Rejected or Cancelled (§2); plus the two snapshot columns (§3) |
| §2, lifecycle table, rows *create* and *update* for a reimbursement | the fields include the post for the Employee | the Employee's fields exclude the post; the CEO's post is optional and cannot be cleared (§1) |
| §2, lifecycle table, row *approve* | carries `expectedVersion`, `expectedAmount` | for a reimbursement also `financialPost`, always (§1); payment requests unchanged |
| §8, "one audit row per write, field names only", as applied to `approve` | approve names no field (as implemented) | approve may name exactly `financialPost`; names only, PD-9 kept (§3) |
| §10, Employee interface | create and edit include the post | no post field; read-only assigned post or neutral status (§6) |
| Acceptance test M3 | post-list CHECK | extended by the tests in `CR01-IMPLEMENTATION-PLAN.md` |

Clarified, not superseded: §5 step 4 ("the request's post") now means the CEO-approved post; §9 gains
migration 0042 after 0039–0041, with Phase 1 tables still untouched.

## Consequences

- Server and frontend ship together: the strict client decoder (`js/core/request-api.js:112`) and the server
  view (`RequestView.php:37`, `:57`) both reject a NULL post today.
- Backup and restore: `RestoreWriter::COLUMNS` gains the two columns. Restore already requires the backup's
  migration set to equal the code's (`BackupRestorer::requireCompatible`), so a pre-0042 backup is restored
  by pre-0042 code and then migrated forward, as for every earlier migration.
- Historical financial transactions, payments, voids and audit rows are not rewritten.
- A late retry of an Employee's reimbursement create, after the CEO assigned a post, is answered 409
  instead of replaying. This follows the existing create-idempotency rule and is not a policy change.
- The temporary CEO-only control model (ADR-016 acceptance clarification 5) is unchanged; there is still no
  maker-checker.

## Alternatives considered

- **Separate "assign post" action (CR-01 option B):** rejected. ACTIONS 24 → 25, one more route and audit
  operation, and two CEO steps.
- **Post at payment (option C):** rejected. Approved-not-paid would have no post, breaking the per-post
  Approved line, and approval would commit an unallocated cost.
- **Audit event with before/after values:** not adopted. It needs a PD-9 amendment and a change to the 0017
  `fields` CHECK.
- **Separate allocation table:** not adopted. A second table, backup classification and a second write for
  one value per request.
- **Names-only audit with no snapshot:** rejected. It does not preserve the previous allocation (D3).
- **Snapshot without a capture flag:** rejected. NULL could not tell "not captured (before 0042)" from "was
  empty" (D7).
- **Computing the previous value inside the UPDATE (`pre = financial_post`):** rejected. It depends on SQL
  assignment order and on `sql_mode`; the locked row value is bound instead.
- **Nulling the post on existing Draft or Submitted reimbursements:** rejected. It is a data rewrite.

## Explicit non-authorizations

This proposal does not authorize: implementation, writing or running migration 0042, changing ADR-016,
changes to the PD-3 post list or codes, new Actions, routes or roles, a PD-9 amendment, CR-03 or CR-04,
deployment, release, staging or production work. LIVE-HOST HOLD, STAGING HOLD and PRODUCTION NO-GO remain in
force.

## Acceptance

Accepted by the Owner on 2026-11-20. The accepted text is revision 2 (`ADR-017-PROPOSED.md`, SHA-256
`b73c110917a224bebf404a21aed02dda5189a56789a1a9d89d8d905a969b9d80`), from the reviewed package
`TAM-OS-NEXT-CR01-ADR017-PROPOSED-R2-20261120.zip` (SHA-256
`326ef94f646691034b9f64944ea7b3e6a27b225ed4a0eb75d119c04099ec8d3f`). Filing changed only the Status line,
the opening callout and this section.

The acceptance covers CR01-D1 … CR01-D9, confirmations R-1 … R-3 and governance G-1 … G-5 as recorded in that
package. The body's references to `CR01-OWNER-DECISIONS.md`, `CR01-MIGRATION-0042-DESIGN.md`,
`CR01-TECHNICAL-IMPACT-ASSESSMENT.md` and `CR01-IMPLEMENTATION-PLAN.md` name documents of that package, held
in the Owner's records outside this repository.

The acceptance also records decision **R2-2 = Option A** (create idempotency):
1. A create retried while the stored request still holds the values the create sent returns the original
   request.
2. A create retried after the stored values changed may return 409 `idempotency_mismatch`.
3. A CEO Financial Post assignment is treated like every other change made after creation.
4. No duplicate request may be created.
5. No original-value storage is added, and the accepted ADR-016 idempotency policy is unchanged.

Governance recorded with the acceptance:
- G-1: a future CR-01 implementation authorization must name migration 0042 and its test requirements;
  this acceptance authorizes neither writing nor running it.
- G-2: this record is filed through its own documentation-only pull request, before any CR-01 code.
- G-3: PHP 8.3 and MariaDB 10.11 tests run in the existing GitHub CI.
- G-4: the approval audit event names `financialPost` without values; PD-9 is preserved.
- G-5: the seven legacy harnesses that expect 21 Actions are deferred to separate work.
