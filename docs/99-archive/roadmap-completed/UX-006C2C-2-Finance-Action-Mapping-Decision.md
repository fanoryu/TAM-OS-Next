# UX-006C2C-2 — Finance Action-Mapping Decision Memo

**STATUS: DECISION SUPPORT — NO IMPLEMENTATION.** No production code, no ACTIONS change, and no authz change
is made by this document. It resolves the one open question blocking C2C-2: **which authorization
capability(ies) govern the standalone Finance mutation boundaries** (transaction execute / create / edit /
archive / schedule / cancel / duplicate / delete) and **Import commit**. It recommends an owner ruling
(F1 / F2 / F3). Implementation begins only under a separate, owner-authorized C2C-2 assignment.

---

## 0. Baseline (verified)

main `dc0dbbeba54a337ed0de6343f8380d4db12bbfea` (clean); verifier **2160**, runtime **1926 / 25**, authz **92**,
C2C-1 **59**, C2B **64**, C2A **66**, D1 **29**, workspace **31**, identity **33**, GS **26**, DG **36**;
ACTIONS **16**; APP_VERSION **2.9.0**; SCHEMA_VERSION **6**; dev artifact `48d8bfe7…`; v2.9.0 tag → `598edef0`
(immutable). Private CI: build-and-verify runs; CodeQL skips cleanly. No `can(` in any finance/import module.

---

## 1. Source files inspected

`js/finance/execution-center.js`, `js/finance/add-upload.js`, `js/finance/transaction-modals.js`,
`js/finance/transactions.js`, `js/import/smart-import-commit.js`, `js/core/authz.js`, `js/domain/commands.js`,
`js/domain/events.js`.

## 2. Complete standalone Finance mutation inventory (source-grounded)

| # | Boundary | File:line | Behavior | Persist/audit |
|---|---|---|---|---|
| 1 | `executeTransaction(id, data)` | `execution-center.js:186` | **Irreversible posting**: planned→actual, writes `execution` record, status→completed/partial/archived, may close a linked supplemental | `persist()`; audit `finance.execute`; `TransactionExecuted` event |
| 2 | manual create (manual-entry submit) | `add-upload.js:96` | `State.txns.push(txn)` (new planned txn) | `persist()`; no audit |
| 3 | `saveEditedTransaction(id, fields)` | `execution-center.js:262` | `Object.assign(t, fields)` (edit) | `persist()`; no audit |
| 4 | `archiveTransaction(id)` | `execution-center.js:245` | status→archived | `persist()` |
| 5 | `scheduleTransaction(id, date)` | `execution-center.js:232` | status→scheduled | `persist()` |
| 6 | `cancelTransaction(id)` | `execution-center.js:239` | status→cancelled | `persist()` |
| 7 | `duplicateTransaction(id)` | `execution-center.js:251` | push a planned copy | `persist()` |
| 8 | inline delete | `transaction-modals.js:245` | `State.txns = State.txns.filter(...)` (permanent) | `persist()` |
| 9 | backup **restore** | `add-upload.js:168` | replaces a month's txns from a backup | `persist()` — **System/data-portability, not Finance** (see §7 → C2C-3) |

**Discovery:** the surface is larger than the assignment's three named ops — items 5, 6, 7, 8 are additional
standalone Finance mutations; item 9 is a System restore (defer to C2C-3, not Finance).

## 3. Current meaning of `finance.execute`

Architecturally **specific to execution/posting**, not a consolidated "all Finance" capability:
- `ACTION_RESOURCE_ENTITY['finance.execute'] = null` with comment "txn scope is Executive-only";
- Domain command `finance.execute` → handler `executeTransaction`, transition `planned -> actual`;
- Event `TransactionExecuted = 'finance.execute'`; audit `type:'finance.execute'` ("Transaction Executed").

So `finance.execute` means **the irreversible posting/settlement of a planned transaction to an actual**.
Mapping create/edit/archive/schedule/cancel/duplicate/delete onto it would **overload** the term and make the
audit trail and any future backend policy misleading (an "edit" recorded/authorized as an "execute").

## 4–7. Option assessment

### Option A / Decision F1 — keep ACTIONS 16; all standalone Finance → `finance.execute`
- **Pros:** no vocabulary growth; Employee still denied; minimal implementation.
- **Cons:** **semantic overloading** (execute ≠ create/edit/archive); misleading audit + future backend
  policy; cannot express least-privilege (§8); contradicts the established domain/event meaning of
  `finance.execute`. **Not recommended.**

### Option B / Decision F2 — ACTIONS 16 → 17; add `finance.manage`
- Split: `finance.execute` = irreversible posting (item 1, unchanged); **`finance.manage`** = reversible
  administration (items 2–8: create/edit/archive/schedule/cancel/duplicate/delete).
- **Genuinely supported by source** (§2 shows two distinct behavior classes). Both CEO-only; Employee/null
  deny. **Recommended.**

### Option C / Decision F3 — reuse another existing ACTION
- `settings.manage`/`supplemental.manage`/`import.commit` do **not** fit transaction administration; forcing
  them would be a worse overload than F1. **Rejected.** (Exception: the **backup restore**, item 9, is a
  System/data-portability op that legitimately maps to `settings.manage` and belongs to **C2C-3**, not here.)

## 8. Least-privilege / future-backend test

Both grants are meaningful and realistic:
- "Finance **maintenance** but not execute/post" (a clerk drafts/edits/schedules planned txns; cannot settle);
- "**Execute** but not edit/archive" (a poster settles approved txns; cannot alter records).

Because a real product/backend could reasonably grant these independently, collapsing everything into
`finance.execute` (F1) is premature. **This test favors F2.**

## 9. Employee policy

All candidate mappings keep **Employee → DENY** (and null → deny). `finance.execute` and the proposed
`finance.manage` are both CEO-only (`ceoOnly`). This decision is about semantic correctness and future policy
shape, not any Employee privilege expansion.

## 10. Import confirmation

`commitSmartImport` → `import.commit` is unambiguous and ready for C2C-2 (single top-level gate at the commit
boundary; preview/parse stays unguarded). No change needed.

## 11. ACTIONS impact — RECOMMENDATION: **Decision F2 (ACTIONS 16 → 17)**

Add exactly one action: **`finance.manage`** (CEO-only; `ACTION_RESOURCE_ENTITY` = `null`, same as
`finance.execute`, since transaction scope is Executive-only with no employee SELF path). Retain
`finance.execute` unchanged. This is the **only** new action required (no second new action → no stop
condition). Because it changes the frozen ACTIONS vocabulary (16→17), it is an **owner ruling**, exactly like
the reviewed C2B 13→16 amendment — recorded here, **not** implemented.

## 12. Future C2C-2 implementation map (under the recommended F2)

| Boundary | ACTION | Resource | Authorization point |
|---|---|---|---|
| `executeTransaction` | `finance.execute` | txn (or `{}` exec probe) | top, before actual/status write + supplemental close |
| manual create (add-upload submit) | `finance.manage` | candidate (or none) | before `State.txns.push` + persist |
| `saveEditedTransaction` | `finance.manage` | txn | after resolve, before `Object.assign` |
| `archiveTransaction` / `scheduleTransaction` / `cancelTransaction` | `finance.manage` | txn | after resolve, before status set/persist |
| `duplicateTransaction` | `finance.manage` | candidate copy | before push/persist |
| inline delete (`transaction-modals.js:245`) | `finance.manage` | txn | before `filter`/persist/confirm |
| `commitSmartImport` | `import.commit` | none | single top gate before any collection write |

**Composite/bypass note:** finance transactions created *inside* `commitReadyPayroll` remain covered by the
frozen C2C-1 `payroll.manage` composite gate — they are **not** re-authorized as `finance.execute`/`manage`.
Backup **restore** (item 9) is deferred to C2C-3 (`settings.manage`). No finance boundary requires a second
authz gate; each is a single top-of-boundary check.

## 13. Resulting ACTIONS count

**17** (16 + `finance.manage`) under the recommended F2. (F1 would keep 16 but is not recommended.)

## 14. Implementation implications

- One-line `authz.js` amendment (add `FINANCE_MANAGE`, `ACTION_RESOURCE_ENTITY` entry, `POLICY: ceoOnly`) —
  reviewed vocabulary change, same shape as C2B. authz harness grows (new-action assertions).
- Guards at 7 finance boundaries + 1 import boundary; SE-0 per boundary; new C2C-2 harness (finance manage +
  execute + import commit; null/Employee deny; CEO success; no partial state).
- No schema/storage change (SCHEMA_VERSION 6); no UI/GS/DG change.

## 15. Unresolved questions for the owner ruling

1. **F1 vs F2** (recommended **F2**).
2. Confirm inline **delete** → `finance.manage` (vs a stricter dedicated delete capability — not recommended;
   avoids a second new action).
3. Confirm **backup restore** is C2C-3/`settings.manage`, not C2C-2.

## 16. Stop-condition status

None triggered: boundaries categorize consistently (execute vs manage); no execution/management conflation
requiring refactor; no schema/storage change; no Employee Finance self-service; Import unambiguous; **at most
one** new action needed.

## 17. GO / NO-GO for C2C-2 implementation

**GO — conditional on the owner ruling F1/F2/F3** (recommended **F2**) and confirmation of items §15.2–§15.3.
Once ruled, C2C-2 (Finance + Import) is ready to implement from current `main`.
