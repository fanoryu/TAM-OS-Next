# ADR-016 — Finance Payment Requests and Reimbursements (Phase 2)

**Status:** Accepted — 2026-11-17 (Owner acceptance of revision 1 and `SUBMISSION.md` decisions 1–4, with clarifications 1–5; see *Acceptance*) ·
**Evidence baseline:** `main` @ `40c63216c201e0ca0a4594505f9919800e597ff1` (migration head 0038, ACTIONS 21,
routes 58, package digest `b865f6f2…`) · **Owner decisions:** P2-D1 … P2-D8 approved as recommended (2026-11-13)

> **Accepted 2026-11-17. This record is immutable;** a later decision supersedes it with a new record and
> never rewrites it. Acceptance of the decision did not itself authorize implementation. This filing does not
> grant or retrospectively establish implementation authorization. The body below is revision 1 as accepted,
> unchanged.
>
> **ADR-015 stays reserved** for the Phase 1 decisions PD-1 … PD-11. That record remains deferred until the
> Finance/HR role design revisits PD-1 (DD-P1-08 stays **open**). This ADR builds on PD-1 … PD-11 as recorded
> in `AI_CONTEXT.md` and does not restate or decide them.

## Context

- Phase 1 (PR #85, merge `79c8c497`) delivered:
  - immutable general transactions by Financial Post (tables `finance_transactions` 0036 and
    `finance_transaction_voids` 0037);
  - CEO-only `finance.manage` (PD-1, temporary);
  - a cash-basis report that counts paid payroll only and shows posted payroll separately (PD-6).
- Payroll already records that a payment happened outside TAM OS without moving money (BF-4f, `finance.execute`).
- There is no domain for company expenses approved before payment, or for money an employee spent on the
  company's behalf. The LOCAL Execution Center works on browser state only and is not reused.
- The Owner approved P2-D1 … P2-D8 on 2026-11-13.

## Decision

### 1. One table with a `kind` (P2-D1)

New table `finance_requests`, with `kind` ∈ {`paymentRequest`, `reimbursement`} and one lifecycle.

| Column | Rule (enforced by CHECK and by input validation) |
|---|---|
| `company_id`, `id` | `id` 32 lowercase hex, server-generated; PK (`id`); UNIQUE (`company_id`, `id`) |
| `kind` | `paymentRequest` \| `reimbursement`; immutable after create |
| `financial_post` | `GA`, `NPIP`, `TJB`, `DRONE` (the PD-3 list, the same CHECK as 0036) |
| `category` | 1–64 characters, trimmed; lower-case value not in `gaji`, `payroll`, `salary` (PD-4) |
| `description` | 1–500 characters, trimmed |
| `amount` | DECIMAL; `> 0 AND = FLOOR(amount)`, so whole Rupiah only (PD-5) |
| `payee` | paymentRequest: 1–160 characters, trimmed; reimbursement: NULL |
| `owner_employee_id` | reimbursement: the reimbursed employee (FK `employees (company_id, id)`); paymentRequest: NULL. Immutable |
| `document_date` | paymentRequest: needed-by date; reimbursement: expense date (§6) |
| `status` | `Draft`, `Submitted`, `Approved`, `Paid`, `Rejected`, `Cancelled` |
| `status_reason` | 1–200 characters iff the status is `Rejected` or `Cancelled`, otherwise NULL |
| `version` | ≥ 1; +1 on every successful write |
| `idempotency_key` | 32 hex, the key of the create; UNIQUE (`company_id`, `idempotency_key`) |
| `created_by_user_id`, `created_at`, `updated_at` | as existing tables |

The CHECKs tie `payee` / `owner_employee_id` to `kind`, so no malformed row can be stored. The column is
named `owner_employee_id` because the scoped data layer requires every row it reads to project
`company_id` and `owner_employee_id` (§4).

### 2. Lifecycle, optimistic concurrency, terminal states

```
            submit              approve              pay
  Draft ───────────▶ Submitted ──────────▶ Approved ──────────▶ Paid (terminal)
    │                   │                     │
    │ cancel            │ reject / cancel     │ cancel
    ▼                   ▼                     ▼
 Cancelled (terminal) Rejected | Cancelled (terminal)  Cancelled (terminal)
```

| From | Operation | To | Business permission (§3) | Request must carry |
|---|---|---|---|---|
| — | create | Draft | `finance.manage` (paymentRequest); `reimbursement.createSelfDraft` (reimbursement) | fields, `idempotencyKey` |
| Draft | update | Draft | `finance.manage`; `reimbursement.updateSelfDraft` | fields, `expectedVersion` |
| Draft | submit | Submitted | `finance.manage`; `reimbursement.submitSelf` | `expectedVersion` |
| Submitted | approve | Approved | `finance.manage` | `expectedVersion`, `expectedAmount` |
| Submitted | reject | Rejected | `finance.manage` | `expectedVersion`, `reason` |
| Draft, Submitted, Approved | cancel | Cancelled | `finance.manage` | `expectedVersion`, `reason` |
| Approved | pay | Paid | `finance.execute` | §5 |

The rules:
- **Optimistic concurrency.** Every transition runs in one transaction that locks the request row by
  primary key (`SELECT … FOR UPDATE`), then compares `expectedVersion` with the stored version. A mismatch
  answers 409 and changes nothing. The write sets `version = version + 1`.
- **Approve takes an exact amount.** `expectedAmount` must equal the stored amount as an exact decimal
  string, so the CEO approves the amount they saw.
- **Terminal states are protected.** Paid, Rejected and Cancelled accept no operation: every attempt is
  409 with no change and no audit row.
- **Nothing else is offered.** There is no "return to Draft", no edit after Draft, no partial payment
  (P2-D4), and no reversal or correction (P2-D6).

### 3. Business permissions (P2-D2, P2-D3)

ACTIONS grow from 21 to **24**. The three new Employee self-service actions use the existing `CeoOrOwnDraft`
rule, mirroring overtime's self-draft actions. No role and no rule is added.

| Action | Rule | Governs |
|---|---|---|
| `finance.manage` (existing) | CeoOnly | **management**: create / update / submit a payment request; approve, reject, cancel either kind |
| `finance.execute` (existing) | CeoOnly | **payment execution**: pay either kind |
| `reimbursement.createSelfDraft` (new) | CeoOrOwnDraft | create a reimbursement Draft |
| `reimbursement.updateSelfDraft` (new) | CeoOrOwnDraft | update a reimbursement Draft |
| `reimbursement.submitSelf` (new) | CeoOrOwnDraft | submit a reimbursement Draft |

The reimbursement self actions also admit the CEO, for any employee; `CeoOrOwnDraft` admits the CEO by
definition.

Policy is the only place a permission is decided, and it is enforced on the server only. The browser hides
what it cannot do but is never trusted. `js/core/authz.js` changes in lockstep, and the boundary tool keeps
the two lists equal. PD-1 stays temporary: a later ADR replaces this table when Finance/HR roles are designed.

### 4. Reimbursement ownership: reads, writes, enumeration

Ownership is enforced in two independent layers.

1. **Scoped data layer (structural).** An Employee's requests run under a self Scope.
   `ScopedDatabase` refuses any statement that does not bind `:self_employee_id` from the Scope, and checks
   every fetched row's `company_id` and `owner_employee_id` against it. A row of another employee fails the
   read, and a payment request (whose `owner_employee_id` is NULL) never matches a self Scope. Request
   input can never become scope.
2. **Policy (semantic).** `CeoOrOwnDraft` admits an Employee only when the loaded record's
   `owner_employee_id` equals their own employee id **and** its status is `Draft`.

| Employee request | Result |
|---|---|
| List | only own reimbursements, any status; never a payment request, never another employee's row |
| Read one, own | 200 |
| Read one: another employee's reimbursement, any payment request, or a non-existent id | **404**, identical body |
| Create | own only: `owner_employee_id` is taken from the Scope. A body naming another employee is a 400 (unknown key); an Employee's create body has no employee field |
| Update / submit own Draft | allowed |
| Update / submit own non-Draft | 403 (in scope, not permitted) |
| Update / submit anyone else's | 404 (loaded through the self Scope first, so it is absent) |
| Approve / reject / cancel / pay | 403 before any lookup (record-free CeoOnly check) |
| Disabled or signed-out account | 401 |

**Enumeration prevention.** Ids are 128-bit random. Out-of-scope and non-existent ids return the same 404,
and authorization for a record-bearing action runs only after the scoped load, so a 403 can only ever
concern the caller's own record. The CEO's company Scope sees every request of the company and nothing of
another company.

### 5. Recording payment: one atomic transaction (P2-D4, P2-D5)

Input is exactly `{ financeRequestId, expectedVersion, expectedAmount, paidOn, paymentMethod, idempotencyKey }`:
- `paidOn` follows §6;
- `paymentMethod` comes from the existing closed list `cash`, `bankTransfer`, `qris`, `virtualAccount`,
  `creditCard`, `other`.

The record-free `finance.execute` check comes first, so an Employee gets 403 before any lookup. Then one
transaction runs, at **READ COMMITTED**:

1. **Lock** the request row `FOR UPDATE` by **primary key** (absent → 404). This is the only row lock taken
   before the inserts, and it comes before the key check, as in the Phase 1 void and BF-4f, so two retries
   with the same key serialize here: the second sees the first's committed payment and replays.
2. **Idempotency.** Read `finance_request_payments` by (`company_id`, `idempotency_key`):
   - a row for this same request with the same `paidOn`, `paymentMethod` and amount → return that result
     (200, no write, no audit);
   - any other row → 409 `idempotency_mismatch`.
3. **Guards:** status `Approved` (else 409), `version = expectedVersion` (else 409), and `amount =
   expectedAmount` as an exact string (else 409).
4. **Insert the expense** into `finance_transactions` (Phase 1 schema, unchanged):
   - kind `expense`;
   - the request's post, category, description and amount;
   - `transaction_date = paidOn`;
   - creator = the CEO;
   - a server-generated 32-hex idempotency key, which never collides with client keys.
5. **Insert the payment** into `finance_request_payments`.
6. **Update the request:** status `Paid`, version + 1.
7. **Insert the two audit rows** (§8).
8. Commit.

**Lock ordering.** The request row is always locked first, by primary key. The inserts take only the
implicit locks of new rows plus the shared FK checks on `companies`, `users` and `finance_requests`. No
statement in this path locks a range of a secondary index, and no `FOR UPDATE` touches `employees`. That
avoids the deadlock that payroll generate hit when locking employees through a secondary index together
with overtime create's FK check. Concurrent payments of one request therefore serialize on step 2: the
first commits, and the second sees `Paid` → 409 (a different key) or replays (the same key, step 2).

**Uniqueness constraints** (the database is the last line):

| Table | UNIQUE | Guarantees |
|---|---|---|
| `finance_request_payments` | (`finance_request_id`) | at most one payment per request (P2-D4) |
| `finance_request_payments` | (`finance_transaction_id`) | one request per linked expense |
| `finance_request_payments` | (`company_id`, `idempotency_key`) | one payment per client key |
| `finance_requests` | (`company_id`, `idempotency_key`) | one request per create key |
| `finance_transactions` (existing) | (`company_id`, `idempotency_key`) | unchanged |

**Rollback.** Any exception, including a duplicate-key error (MariaDB 1062) from step 4 or 5, rolls back
the whole transaction. A duplicate key answers 409. A refused or failed payment stores nothing and
consumes no key. No money moves.

**Idempotent retries.** Two writes carry client idempotency keys: create, and pay. This follows the
existing pattern of keys on creating and irreversible writes.
- A retry with the same key and the same values replays the stored result with no write and no audit row.
- The same key with different values is 409 `idempotency_mismatch`.

Update, submit, approve, reject and cancel are guarded by `expectedVersion` instead. A retry after a
success sees a newer version and gets 409; the client re-reads the request and shows its current state.
This never applies a transition twice.

**Isolation assumptions.**
- The server default is REPEATABLE READ. Every Phase 2 write transaction asks for READ COMMITTED
  (`Database::transaction` readCommitted), and correctness comes from the primary-key row lock plus the
  UNIQUE constraints, not from snapshot isolation.
- Reads (lists, the report) use the existing READ ONLY REPEATABLE READ snapshot, so the report's lines come
  from one consistent view.

### 6. Dates and reporting semantics

"Today" is the company calendar date in Asia/Jakarta at the time of the request. Every date is
`YYYY-MM-DD` and must be a real calendar date.

| Date | Rule |
|---|---|
| reimbursement `document_date` (expense date) | 1900-01-01 … today |
| paymentRequest `document_date` (needed-by) | 1900-01-01 … today + 366 days |
| `paidOn` | 1900-01-01 … today; it may be before or after `document_date` (no ordering rule) |
| report `from` / `to` | as Phase 1: `from ≤ to`, at most 366 days (PD-7) |

Reporting, extending the Phase 1 report without changing any Phase 1 line:

| Request state | Where it appears | In cash totals? |
|---|---|---|
| Draft, Submitted, Rejected, Cancelled | not in the report (visible in the Requests list) | no |
| Approved (unpaid) | new line **Approved, not paid**: count and amount by Financial Post, for requests whose `document_date` is in [`from`, `to`] | **no**: never added to income, expense, net or the consolidated cash total |
| Paid | its linked general expense, counted once by the Phase 1 rule on `paidOn` | yes, once, as a general expense |

The new line is read in the same snapshot as the other report lines and counts toward the 20,000-row
REPORT_CAP (fail closed). When a request is paid it leaves the Approved line, and its expense appears on
`paidOn` in the same commit, so it is never in both.

### 7. Paid-linked expenses cannot be voided (P2-D6)

`POST /api/general-transactions/void` locks the transaction row by primary key, as today. It then checks
`finance_request_payments` through its UNIQUE (`finance_transaction_id`) index, inside the same
transaction. If a link exists → **409** `finance_linked`, and nothing changes.
- The rule lives in the server service, so it holds for every caller, including a hand-crafted API request.
  The browser additionally hides the Void control on linked rows.
- **No race is possible.** The expense and its link are inserted in one transaction, so under READ
  COMMITTED a void can never see the expense without its link. The `finance_transactions` row of an
  uncommitted payment is not visible (404).
- Unlinked Phase 1 transactions void exactly as today.
- The boundary tool gains a rule that the void path references `finance_request_payments`, so the check
  cannot be removed silently.

### 8. Audit validation, separate from permissions

- **Permission** (§3) decides whether a principal may act.
- **Audit validation** (the database CHECK constraints and the client decoder) decides only which
  (action, entity, operation) triples a stored audit row may contain.
- An audit row records the Action that Policy actually authorized. Accepting a triple in the vocabulary
  grants no one anything.

| Action | Entity | Operations |
|---|---|---|
| `finance.manage` | `financeTransaction` | `create`, `void` (Phase 1, unchanged) |
| `finance.manage` | `financeRequest` | `create`, `update`, `submit`, `approve`, `reject`, `cancel` |
| `finance.execute` | `financePosting` | `execute` (BF-4f, unchanged) |
| `finance.execute` | `financeRequest` | `pay` |
| `finance.execute` | `financeTransaction` | `create`: the linked expense, recorded under the payment authority that created it; it does not imply `finance.manage` |
| `reimbursement.createSelfDraft` | `financeRequest` | none (NULL), as `overtime.createSelfDraft` |
| `reimbursement.updateSelfDraft` | `financeRequest` | none (NULL) |
| `reimbursement.submitSelf` | `financeRequest` | `submit` |
| every existing action | its existing entity | unchanged |

How the vocabulary is enforced and recorded:
- **One migration.** 0041 replaces the audit constraints with action v8, entity v7 and operation v9,
  expressed as the allowed triple set. The current rule "one entity per action" cannot express the pay rows.
- **One audit row per write,** field names only and never values (as PD-9). Pay writes exactly two rows in
  its transaction. A replay or a refused write writes none.
- **Client in the same commit.** The decoder (`js/core/audit-api.js`) changes from an action → entity map
  to the same triple set. Its labels and the `verify-build.js` pin, which now reads migration 0041, change
  in the same commit as the migration (PH1-QA-01 lesson).
- **The decoder stays strict.** A triple outside the set, an unknown action, entity or operation, or a
  malformed id rejects the response.

### 9. Phase 1 schema compatibility, backup, migration

- **No change to Phase 1 tables.** There is no ALTER of `finance_transactions` or
  `finance_transaction_voids`, and no Phase 1 row is updated. The link lives only in the new
  `finance_request_payments` table, which has FKs to `finance_requests (company_id, id)` and
  `finance_transactions (company_id, id)`.
- **Migrations:**
  - 0039 creates `finance_requests`;
  - 0040 creates `finance_request_payments`;
  - 0041 replaces the audit constraints. This follows the precedent of 0035 and 0038; existing audit rows
    remain valid under v8/v7/v9.
- **Forward-only.** Migrations are not reversed; a rollback is a restore from backup.
- **Backup.** Both new tables are added to `BackupTables`. The boundary tool fails if any migrated table is
  unclassified.

### 10. Interface

- **CEO.** The SESSION Finance section gains **Requests**: a list filtered by range, status and kind; a
  detail page; and the create, update, submit, approve, reject, cancel and pay actions.
- **Employee.** **My reimbursements** offers their own list, create and edit while Draft, submit, and the
  status of each.
- Existing CSS only (PD-11). No placeholder controls. Loading, empty, conflict and permission-denied
  states are explicit.

## Phase 2 acceptance tests

Each must be executed and pass before Owner acceptance. A test not run is reported as NOT RUN.

**Migrations**
- M1: fresh install 0001 → 0041 on disposable MariaDB 10.11.19.
- M2: upgrade 0038 → 0041 with Phase 1 data present; every existing audit row is still valid; Phase 1
  tables are byte-identical in schema.
- M3: each CHECK rejects its malformed row, including the kind-dependent NULL rules, the post list,
  payroll categories, amount ≤ 0, a fractional amount and a missing reason.
- M4: backup → restore round trip includes both new tables; restored totals are equal.

**Lifecycle and concurrency**
- L1: every legal transition succeeds and increments the version.
- L2: every illegal transition is 409, with no change and no audit row. This includes every operation on
  Paid, Rejected and Cancelled.
- L3: a stale `expectedVersion` is 409 for every transition.
- L4: approve with a different `expectedAmount` is 409.
- C1: two concurrent approves of one request → one success, one 409.
- C2: two concurrent pays of one request (different keys) → one Paid, one 409; exactly one payment row and
  one linked expense.
- C3: a pay concurrent with a cancel → exactly one wins; the database state matches the winner.
- C4: no deadlock in a 100-iteration mixed run (pay, cancel, overtime create, general-transaction create).

**Retries and rollback**
- R1: create replay (same key, same values) → same id, no new row, no audit row.
- R2: create with the same key and different values → 409 `idempotency_mismatch`.
- R3: pay replay → same payment, no second expense, no audit row.
- R4: pay with the same key and different values → 409.
- R5: a refused pay (wrong amount, wrong status, stale version) consumes no key; the same key then
  succeeds once valid.
- B1: a failure injected after step 4, 5, 6 and 7 of §5 each leaves zero new rows in all four tables and no
  consumed key.

**Authorization and ownership**
- A1: the §3 matrix holds for the CEO, the owning Employee, another Employee, a disabled account (401) and
  anonymous (401).
- A2: an Employee is 404 for another employee's reimbursement, for any payment request and for a
  non-existent id, with identical bodies.
- A3: an Employee's create body with an employee field is 400; the stored owner is always the caller.
- A4: an Employee editing or submitting their own non-Draft is 403.
- A5: an Employee is 403 for approve, reject, cancel and pay, before any lookup.
- A6: ACTIONS = 24 in the server and `js/core/authz.js`; the boundary parity check passes; no rule or role
  is added.
- A7: an Employee list returns only their own reimbursements across 2 employees × 3 statuses.

**Linked void**
- V1: voiding a paid-linked expense through the UI is not offered, and through a direct API call is 409
  `finance_linked`, with nothing changed.
- V2: voiding an unlinked Phase 1 transaction still succeeds.

**Audit decoding**
- D1: every new triple decodes and is labelled.
- D2: a mixed month (Phase 1, payroll and Phase 2 events) decodes whole.
- D3: the record history of a request shows its full lifecycle; that of a linked expense shows the
  `finance.execute` / `create` row.
- D4: each out-of-set triple and each malformed id is rejected, alone and beside valid events.
- D5: the verify-build pin reads 0041; seeded defects (a dropped triple, an extra triple, a broadened
  operation) are caught.

**Reporting reconciliation**
- P1: totals before payment, then the same totals plus one expense on `paidOn` after payment; Approved
  drops by the same amount.
- P2: Approved-not-paid is never part of income, expense, net or the consolidated total, for any range.
- P3: a request whose `document_date` is out of range is not on the line; a request paid in range is
  counted once.
- P4: Phase 1-only data produces byte-identical report figures before and after migration 0041.
- P5: above REPORT_CAP the report fails closed (500), never partially.

**Regression and browser**
- G1: verify-build, boundary and self-test, the doc-status self-test, every runtime harness (plus the new
  Requests harness, pinned in CI) and the backend suites without and with the database all pass; Phase 1
  counts are unchanged or higher.
- G2: CEO and Employee end-to-end at 375 / 768 / 1440 over HTTP under the production headers, with zero
  console errors and no CSP violations (the documented signed-out 401 excepted).

## Consequences

- The ACTIONS contract changes from 21 to 24 (Owner acknowledged). Every Action pin, the `authz.js` parity
  and the boundary rules change together.
- Audit validation becomes a triple set. Every future vocabulary migration must update the decoder and its
  pin in the same commit.
- Phase 1 behaviour changes in exactly one place: a payment-linked expense cannot be voided.
- Employee writes widen the attack surface. They are limited to own Draft reimbursements, enforced in two
  layers, and tested with A1–A7.

## Alternatives considered

- **Two tables:** rejected (P2-D1).
- **Manual ledger entry:** rejected (P2-D5) because of the double-entry risk.
- **A link column on `finance_transactions`:** rejected because it breaks Phase 1 schema compatibility.
- **One audit row for pay:** rejected because the linked expense's own history would not show its origin.
- **Recording the linked expense under `finance.manage`:** rejected because it would record an authority
  the payment did not use.
- **Idempotency journals for every transition:** rejected because `expectedVersion` already prevents a
  double transition, and existing tables key only creating and irreversible writes.

## Explicit non-authorizations

This ADR does not authorize:
- new roles, attachments or receipts (P2-D7), partial payments, reversal or correction of a paid item, or
  category-level reporting (PD-4);
- changes to the PD-3 post list, or any Phase 1 schema change;
- deployment, release, or any change to Gate D/R HOLD, ENG-C1 BLOCKED or the v3.0.0 HOLD;
- any GitHub write by Forge.

PD-10's production rehearsal remains required. ADR-015 and DD-P1-08 remain open.

## Acceptance

Accepted by the Owner on 2026-11-17 as the architectural baseline for AWP-01. The accepted text is revision 1
(SHA-256 `80e29b1028e9c5fa6720b83df069203b2c108a1304a8a18735fbd9d290b9b66a`). Filing changed only the Status
line, the opening callout and this section.

The acceptance also covers the four technical choices submitted with revision 1:
1. **Needed-by date.** A payment request may be dated up to today + 366 days. An expense date and `paidOn`
   may not be in the future, and the two have no ordering rule between them.
2. **Approved, not paid.** The line selects Approved requests by `document_date` within the report range.
3. **Retries.** Only create and pay carry idempotency keys. The other transitions rely on `expectedVersion`,
   so a retry after a success is a 409 followed by a re-read.
4. **Employee read access.** An Employee can read only their own reimbursements, which they need in order to
   edit and follow their drafts.

These clarifications are part of the acceptance:
1. R1 = Option A. Creating and submitting a reimbursement requires an Active, non-archived employee.
   Reimbursements submitted before the employee was archived stay eligible for review, approval, rejection
   and payment.
2. C4 is extended with reimbursement create and employee archive, preserving consistent row-lock ordering
   (employee row by primary key, then the request row).
3. The requirement that all 39 acceptance tests pass applies to acceptance of the completed Phase 2
   implementation, not to acceptance of this decision.
4. Migration 0041 replaces all four affected audit constraints (action, entity, operation,
   action_operation).
5. The temporary CEO-only financial control model, with no maker-checker and no receipt attachments, is a
   deferred production risk. It is not production approval.
