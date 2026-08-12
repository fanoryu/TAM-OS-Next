# Testing Standard

Verification is mechanical and layered. A change is not "done" until every layer passes (Law VIII).
"It should work" is not a status.

## The three layers

### 1. The verifier (`tools/verify-build.js`)
The mechanical gate. It guards invariants, including:

- CSS golden master and build fidelity (portable build equals concatenated source in manifest order).
- Version identity consistency; schema/storage/migration invariants; empty seed data.
- Absence of ES-module syntax; module decomposition and load-order agreement.
- Domain invariants: operational aggregate/command/query counts; aggregate and helper **purity**;
  handler ownership of mutation, persistence, history, and rollback; typed failures; helper presence
  and load order.

A change that adds Domain surface extends the verifier to assert its new invariants. The verifier
must pass **completely** — the SPR names the exact check count (e.g. 341/341).

### 2. Runtime verification (fabricated data only)
Exercise the behavior directly against **fabricated** employee data — never real company data. For a
Domain command, cover at minimum:

- The success path (trim/normalize/validate; handler called once; persist once; one history entry;
  `updatedAt` changes; typed success).
- Every typed failure (unknown entity, no allowed fields, each invalid enum) — and confirm the
  handler is **not** called and nothing mutates or persists.
- Forbidden fields are ignored and remain unchanged.
- Persistence failure triggers full rollback and returns `PersistFailed`.

For a refactor, add an **equivalence check**: compare pre- and post-change output across many inputs
and require zero differences.

Test to break, not to confirm — failure and rollback paths matter more than the happy path.

### 3. Browser validation
Boot **both** artifacts — the modular source and the portable build — and confirm:

- Zero console errors.
- Data persists across reload; no duplicate records.
- Interaction invariants hold (search keeps focus, scroll position preserved, menus open/close).
- Validation uses clearly fabricated sample data, left behind nowhere.

## Regressions
Any regression in a previously-working feature is a release blocker. Relevant regressions are
re-tested and must pass before a change is done.

The living, human-run checklist is [`docs/QA-CHECKLIST.md`](../QA-CHECKLIST.md).
