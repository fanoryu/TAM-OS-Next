# UX-006C2C-3/4 — Authorization Mutation Inventory and Mapping Proposal

**STATUS: MAPPING FROZEN BY GOVERNANCE RULING — NO IMPLEMENTATION.** No production code, no `ACTIONS` change,
and no authz change is made by this document. It closes the inventory gap found during the UX-006C2C-2
governance review, enumerates every remaining mutation boundary in the application, classifies each by
reachability and blast radius, and records the **frozen** boundary → action mapping and C2C-3 / C2C-4 split.
Implementation begins only under a separate, owner-authorized assignment.

**Governance status.** Atlas reviewed this inventory and returned
**GO FOR MAPPING FREEZE**, resolving every open question (R1–R9) and requiring three corrections, all of which
are incorporated here: one omitted live boundary added (**row 30**, `markReviewed`), the repository delegation
seam recorded as NOT APPLICABLE (§5.1), and the `finance.manage` vocabulary amendment stated verbatim (§4.12).
Totals are corrected to **60 / 30**. Nothing in the ruling is open for reinterpretation during implementation.

| Phase | State |
|---|---|
| C2C-2 (Finance + Import) | **MERGED / FROZEN** (merge `9ab256a`) |
| C2C-3/4 inventory | **COMPLETE** |
| C2C-3/4 mapping | **MERGED / FROZEN** (merge `552007d`) |
| C2C-3 implementation | **MERGED / FROZEN** (merge `88eb9ca`) — rows 1–9, ACTIONS 17 → 20 |
| C2C-4 implementation | **MERGED / FROZEN** (merge `888d0a8`) — rows 10–30, zero new actions (ACTIONS stays 20) |

**The user-reachable mutation-enforcement inventory is CLOSED** (C2C-4 merged as `888d0a8`): every one of the
30 frozen rows is AUTHORIZED, and the only ungated write-like behaviour left is the set explicitly ruled
NOT APPLICABLE in §5.1 (bootstrap migrations, the Node CLI, the repository delegation seam, in-memory/view
state, `recoverSupplementalOrphans`) plus `linkSupplementalExecution`, which stays INDIRECTLY AUTHORIZED
through `finance.execute`.

---

## 0. Baseline (verified)

| | |
|---|---|
| Analysed tree | `js/` + `tools/` at `9ab256abdb591320d1d207016f7e5b6853a0d601` (the UX-006C2C-2 controlled-merge commit) |
| Branch base | `54c4dba53cd98db93e9912195874b43384a24d64` |
| `APP_VERSION` | 2.9.0 |
| `SCHEMA_VERSION` | 6 |
| `ACTIONS` | 17 |
| Modules inspected | all 72 in `tools/module-order.js` |

**Baseline drift, disclosed.** The assignment named `main = 9ab256a`. While this analysis was starting,
`origin/main` advanced to `54c4dba` via merged PR #120 (dependabot, `chore(deps): Bump github/codeql-action`).
`git diff 9ab256a origin/main -- js/ tools/ dist/` is **empty** — the drift touches only
`.github/workflows/codeql.yml`, and `9ab256a` remains an ancestor of `origin/main`. The drift therefore cannot
affect a mutation inventory of the runtime, and this branch is based on current `origin/main` so the docs PR
merges cleanly. Not treated as a material stop condition; recorded here for the ruling.

---

## 1. Why this inventory exists

The UX-006C2C-2 F2 memo claimed a *"complete standalone Finance mutation inventory."* Governance review proved
it was not: the memo's §1 list of inspected files never included **`js/import/import-preview.js`**, and it did
not inventory **`undoLastSmartImport`**. Atlas behaviourally demonstrated that an Employee principal can invoke
`undoLastSmartImport()` and remove imported transactions (and, for a batch that created them, payroll plans,
contracts and employees).

This document does not repeat that mistake: §8 states the search method and the completeness evidence, and the
inventory is derived from **every** state-write and persistence entry point in the tree, not from the UI. The
governance review of *this* memo applied the same method independently and found one further omission
(`markReviewed`), now recorded as row 30 — the correction is kept visible rather than folded in silently.

---

## 2. Frozen state (not reopened)

`finance.execute` = irreversible Finance execution/posting only — **unchanged by this document**.
`finance.manage` = reversible/administrative standalone Finance transaction mutation — the **one** approved
description amendment is in §4.12. `import.commit` = Smart Import commit. CEO allow / Employee deny / null deny
for all three. Already-enforced boundaries (C2A employees + contracts; C2B overtime; C2C-1 contract operations
+ payroll; C2C-2 finance + import commit) are **AUTHORIZED** and out of scope here.

---

## 3. Inventory totals

| | Count |
|---|---|
| Mutation boundaries discovered (whole tree) | **60** |
| — already AUTHORIZED (C2A/C2B/C2C-1/C2C-2) | **25** *(counting rule below)* |
| — NOT APPLICABLE (bootstrap migrations, Node CLI, repository delegation seam, in-memory UI/view state, bootstrap self-heal) | **5 groups** |
| — **UNAUTHORIZED and user-reachable (frozen matrix, §5)** | **30** |
| Cross-domain among the 30 (mutate ≥2 domains) | **9** |
| Reuse an existing action | **21** |
| Require a new action | **9** (covered by **3** new actions) |

**Counting rule for "already AUTHORIZED = 25" (added on governance review).** This figure counts **logical
mutation boundaries** — one per operation a user can invoke (e.g. `renewContract` is one boundary) — **not**
raw `can(ACTIONS.*)` call sites, of which there are ~35 across the 8 gated files, because several boundaries
authorize at more than one point (e.g. `updateOvertimeRecord` re-checks post-mutation, and the payroll salary
override and clear closures each carry their own gate). The two numbers are not interchangeable. The same
logical-boundary rule is used for the 30 unauthorized rows in §5, so the totals are comparable.

**Corrections applied on governance review:** totals `59 → 60` and `29 → 30` (row 30 `markReviewed` was
omitted from the first draft and was found by an independent persistence-side trace); reuse count `20 → 21`.

---

## 4. Mandatory analyses

### 4.1 `undoLastSmartImport` — `js/import/smart-import-commit.js:307`

**Reachability: LIVE** — bound in the Import Results view ("Undo Last Smart Import"). Selects the newest batch
with `find(b => !b.undone)`.

Reverses a Smart Import batch, but **not symmetrically**. It deletes, in one pass:
`State.txns` (only rows still `planned`, `actual == null`, single history entry — executed/modified rows are
deliberately *kept*), `State.payrollPlans` created by the batch (unless their committed transaction survived),
`State.contracts` and `State.employees` created by the batch (unless still referenced), and it prunes
`monthlyPlans[].committedTxnIds`. It then sets `batch.undone` and calls `saveAllData()`.

- **Reversibility:** none. There is no undo-of-undo; the pre-import safety backup is the only recovery route.
- **Blast radius:** Import + Finance + Payroll + People (4 domains, master data included).
- **Relationship to `commitSmartImport`:** inverse operation over the same `batchId`, but with *deletion*
  semantics that `import.commit` does not describe.
- **Audit:** the undo path writes **no** `logActivity` entry (only the batch marker) — a gap worth noting.
- **Current authorization: UNAUTHORIZED** (Employee-executable; proven behaviourally).

**FROZEN (R1): new action `import.undo`.** Applying the same least-privilege test F2 used for
execute-vs-manage: a product could plausibly grant "may commit an import" without granting "may mass-delete
master data created by one." Reusing `import.commit` would make the capability name describe the opposite of
what it does — considered and **REJECTED**.

### 4.2 `js/import/import-preview.js` — legacy import preview

**Reachability: LEGACY BUT LIVE — and reachable from *two* routes, not one.**
`handleFile()` (line 3) routes to the Smart Import wizard when `State.importMode` is `smart` or `review`;
otherwise (`importMode === 'finance'`, i.e. Import Purpose = *"Finance Transactions Only"*) it sets
`State.pendingImport` and `renderUpload()` → `renderImportPreview()`. **Additionally**, at line 17, a Smart or
Review import that finds **no payroll rows** falls back into the same legacy preview. So a user who never
selects the legacy mode can still land in it.

| Boundary | Line | Mutates | Reversible | Authorization |
|---|---|---|---|---|
| `confirmImport` (bulk add) | 142–146 | pushes N `State.txns` rows, `persist()` | yes (delete per row) | **UNAUTHORIZED** |
| `applyMonthUpdate` (month replace) | 235–249 | `State.backups.unshift` + `saveBackups()`, then **deletes every txn of the month** and re-adds from the file, `persist()` | only via the backup it just took | **UNAUTHORIZED** |

Semantic overlap with Smart Import: both commit parsed rows; the legacy path commits **transactions only** (no
employees/contracts/payroll plans).

**FROZEN:** `confirmImport` → **`import.commit`** (reuse — identical capability, narrower scope).
`applyMonthUpdate` → **`import.commit`** (R2) **with a recorded caveat** — it is an
import commit that takes its own safety backup, but it destroys pre-existing non-imported rows in the target
month, which is closer to a restore than to a commit. The caveat stands so a future backend never reads
`import.commit` as strictly additive. Mapping it to `data.restore` was considered and **REJECTED**.
**Placement:** at each current mutation boundary. There is no shared engine seam between the two functions, and
creating one would be a refactor beyond an authorization change.

### 4.3 Backup restore — two distinct boundaries

| Boundary | File | Replaces | Safety | Failure behaviour |
|---|---|---|---|---|
| Month restore | `js/finance/add-upload.js:165` (`renderBackupPanel`) | every `State.txns` row of one month, from `bk.txns` | `confirm()` only — **no pre-restore backup** | `persist()` result unchecked |
| Complete Backup restore | `js/core/hr-persistence-portability.js` (`restoreCompleteBackup`) | `State.txns`, `State.settings`, **every `RESTORE_HR_KEYS` collection**, `State.backups` | validates the file, deep-clones a rollback snapshot, writes a `Pre-restore safety backup` | inspects every write; **rolls back in memory and re-writes every key** on failure; reports an explicit unrecoverable case |

Complete restore additionally re-stamps `schemaVersion: SCHEMA_VERSION` onto restored settings and re-marks the
`tam_migrated_*` flags as `done` (so restored data does not re-run lifecycle migrations). It touches
**every domain in the application** and is the single largest blast radius in the codebase. No audit entry is
written by either restore path.

**FROZEN (R3): new action `data.restore`** for both. Neither `settings.manage` (config only) nor
`finance.manage` (transaction administration) describes replacing the entire dataset; the earlier
"restore → `settings.manage`" suggestion in the C2C-2 memo was made on naming, and the capability semantics do
not support it — **REJECTED**. The schema/migration-flag interaction is a *read* of `SCHEMA_VERSION` and a
write of existing migration flags: it introduces no migration and no schema change, so it required no separate
schema ruling. It does mean `data.restore` is a data-lifecycle capability, not a Finance one.

### 4.4 Settings vs. destructive reset — deliberately separated

| Boundary | File | Blast radius |
|---|---|---|
| Settings save | `js/ui/settings-about.js:179` | preferences/company profile; reversible |
| `onboardingDismissed` toggles | `onboarding-reset.js:69`, `settings-about.js:194` | one boolean; trivial |
| `resetAppData` | `js/ui/settings-about.js:250` | writes `[]` to `tam_txns_v1`, `tam_backups_v1`, **every** `HR_KEYS` store, resets settings to defaults, clears 9 in-memory collections. Two `confirm()`s. **No backup taken.** Irreversible |
| `startFresh` | `js/core/onboarding-reset.js:121` | forces a Complete Backup **download** first, requires typing `DELETE ALL TAM DATA`, then `StorageAdapter.remove()` on all 15 TAM keys incl. migration flags and `tam_v23_ack`, writes a `reset` audit record that survives, reloads. Irreversible in-browser |
| `loadDemoData` | `js/core/onboarding-reset.js:139` | creates 2 employees + 2 contracts labelled DEMO; persists |

**FROZEN:** settings save and the onboarding toggles → **`settings.manage`** (existing, currently unused by
any boundary). `resetAppData` and `startFresh` → **new action `data.reset`** (R3); they are irreversible
whole-store destruction and must not share a capability with editing a preference. `loadDemoData` →
**`employee.create`** (R4, existing) since that is exactly what it does. A dedicated demo capability was
considered and **REJECTED** — a fourth new action for a two-record seed.

### 4.5 Bank / company accounts

`js/ui/settings-about.js:423` (create/edit) and `setCompanyAccountStatus` (~433). These are company
configuration records consumed by supplemental posting as a frozen snapshot; they are **not** transactions and
carry no money movement. Note the form stores an account number and explicitly warns against storing a
PIN/OTP/token. Both write `persistCompanyAccounts()` and `logActivity({type:'bankaccount.*'})`.

**FROZEN (R7): `settings.manage`** (reuse) — configuration metadata only; no money movement and no banking
credential or operational authority. Mapping them to `finance.manage` would broaden a frozen
transaction-administration capability to master configuration. A new **`bank.manage`** was considered and
**REJECTED**: no capability argument survived review.

### 4.6 Recurring expenses

`js/people/recurring-expenses.js`: create/edit (line 75), `toggleRecurring` (80), `deleteRecurring` (85). These
administer a **rule**, not a transaction. The rule materialises into `State.txns` only through
`commitMonthlyPlan` (§4.7) — so rule administration and financial execution are already separated by the code.

**FROZEN (R6): `finance.manage`** (reuse) under the §4.12 amendment. F2 froze `finance.manage` in terms of
"standalone transaction mutation" and a recurring rule is not a transaction, so the description is clarified
explicitly rather than stretched silently. Rule administration is **not** execution: transactions materialised
from a rule still execute under `finance.execute`. A new **`recurring.manage`** was considered and
**REJECTED**.

### 4.7 Monthly plan — two boundaries

`commitMonthlyPlan` (`js/people/monthly-plan.js:60`) creates planned `State.txns` rows from recurring/manual
preview rows, marks the plan `Committed`, and writes both stores (non-atomic by design, results inspected).
Payroll rows are deliberately **not** re-created here (they come from Payroll Planning, already gated by
`payroll.manage`).

`markReviewed` (`js/people/monthly-plan.js:158`) — **added on governance review; omitted from the first
draft.** A live click handler (`#markReviewed`) that transitions a monthly plan `Draft → Reviewed`, stamps
`updatedAt`, and calls `persistMonthlyPlans()`. **LIVE, user-reachable, currently UNAUTHORIZED.** Single-record
blast radius, no cross-domain effect. It was found by tracing every `persistMonthlyPlans()` call site rather
than by reading the UI — the same persistence-side method that surfaced `recoverSupplementalOrphans`, applied
exhaustively.

**Frozen: both → `finance.manage`** (reuse). `commitMonthlyPlan` takes a **single top gate before the row
loop**, following the C2C-1 `commitReadyPayroll` composite precedent; `markReviewed` gates its status write.
`commitMonthlyPlan` is cross-domain (Planning + Finance), but everything it creates is a planned transaction.

### 4.8 Supplemental payroll

Seven user boundaries in `js/people/supplemental-engine.js`: `generateSupplementalForPlan` (88),
`refreshSupplemental` (118), `transitionSupplemental` (156), `setSupplementalAccount` (181),
`setSupplementalNotes` (189), `postSupplemental` (219, **creates a finance transaction** — cross-domain), and
`recoverSupplementalOrphans` (301, **automatic**, runs at load to repair failed-post orphans).
`linkSupplementalExecution` (264) is called *from* `executeTransaction` and is therefore already
**INDIRECTLY AUTHORIZED** by `finance.execute`.

**FROZEN: `supplemental.manage`** (existing, currently unused) for all six user boundaries, with
`postSupplemental` taking a single top gate covering its finance write (C2C-1 composite precedent).
`recoverSupplementalOrphans` → **NOT APPLICABLE (R8)**: it runs without a user principal during bootstrap and
only repairs an inconsistent state; gating it would make a self-healing routine fail closed at load. Ruled
explicitly rather than left accidental.

### 4.9 Employee deduplication

`mergeEmployeeGroup` (`js/people/employee-dedup.js:30`). Takes a full master-data safety backup, then relinks
`contracts`, `payrollPlans`, `txns`, `overtimeRecords`, `payrollAdjustments` from the duplicates to the
canonical record, applies chosen profile fields, **deletes the duplicate employee master records**, writes an
`employeeMerges` audit record, and calls `saveAllData()`. Not reversible in-app (recovery is via the backup).
Blast radius: People + Finance + Payroll + Overtime (5 collections).

**FROZEN (R5): `employee.delete`** (existing, CEO-only) — the strongest capability the operation actually
exercises. Approved **on condition** that the cross-domain relink and master-record deletion above stay visible
in this freeze, so the narrow action name is never mistaken for a narrow effect. A dedicated
**`employee.merge`** was considered and **REJECTED** — it would add vocabulary without adding a grant anyone
would issue separately.

### 4.10 Legacy payroll mapping

`js/people/legacy-mapping.js:56` (Apply). Sets `employeeId`/`contractId` and `payrollMeta` on unlinked *Gaji*
transactions in bulk, pushes history, `persist()`. This is a bulk **transaction edit**.

**FROZEN: `finance.manage`** (reuse) — clean fit with the frozen semantics; bulk edit, still administrative.

### 4.11 Payroll adjustments

`js/people/payroll-workspace.js`: create/edit (514), `toggleAdjustment` (519), `deleteAdjustment` (520). These
feed payroll computation. **FROZEN: `payroll.manage`** (reuse) — clean fit; no new action.

### 4.12 `finance.manage` vocabulary amendment (approved, exact)

Rows 17–20, 24 and 30 administer Finance records that are not themselves transactions. Rather than let those
mappings quietly stretch a frozen action, the governance ruling approves **one** explicit description change:

| | Wording |
|---|---|
| **Old (C2C-2, F2)** | reversible/administrative standalone Finance **transaction** mutation |
| **Frozen (C2C-3/4)** | reversible/administrative Finance mutation — standalone transactions **and the Finance-administrative records that generate them** (recurring rules, monthly-plan commit) |

Approved specifically to cover: recurring rule administration (17–19), `commitMonthlyPlan` (20), `markReviewed`
(30), and legacy Finance mapping (24, already a transaction edit).

**This does NOT alter `finance.execute`**, which remains **irreversible Finance execution/posting only**.
Execution of any transaction materialised from a recurring rule or a monthly-plan commit stays under
`finance.execute`. The amendment widens the *kind of record* `finance.manage` administers; it does not move a
single byte of execution authority. It is a description change only — no predicate, resource shape, or policy
entry changes with it.

---

## 5. Decision matrix

CEO = allow, Employee = deny, null = deny **for every row below** (fail-closed preserved; no authentication or
trust-model change). Reachability is LIVE unless stated.

| # | Domain | File | Boundary | State affected | Persist | Reversible | Current authz | Proposed action | New/existing | Phase | Rationale |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Import | `import/smart-import-commit.js:307` | `undoLastSmartImport` | txns, payrollPlans, contracts, employees, monthlyPlans, importBatches | `saveAllData` | **no** | UNAUTHORIZED | `import.undo` | **NEW** | C2C-3 | deletion ≠ commit; 4-domain blast radius |
| 2 | Import | `import/import-preview.js:142` | `confirmImport` | txns (bulk add) | `persist` | yes | UNAUTHORIZED | `import.commit` | existing | C2C-3 | same capability as Smart commit, narrower |
| 3 | Import | `import/import-preview.js:245` | `applyMonthUpdate` | backups + all txns of a month | `saveBackups`+`persist` | via own backup | UNAUTHORIZED | `import.commit` (R2) | existing | C2C-3 | import commit that replaces a month |
| 4 | Backup/Restore | `finance/add-upload.js:165` | month restore | all txns of a month | `persist` | no safety backup | UNAUTHORIZED | `data.restore` | **NEW** | C2C-3 | replacement, not administration |
| 5 | Backup/Restore | `core/hr-persistence-portability.js` | `restoreCompleteBackup` | txns, settings, **all HR stores**, backups | all stores | rollback on write failure | UNAUTHORIZED | `data.restore` | **NEW** | C2C-3 | largest blast radius in the app |
| 6 | System lifecycle | `ui/settings-about.js:250` | `resetAppData` | every store + 9 collections | direct `StorageAdapter.set` | **no** | UNAUTHORIZED | `data.reset` | **NEW** | C2C-3 | irreversible wipe, no backup taken |
| 7 | System lifecycle | `core/onboarding-reset.js:121` | `startFresh` | removes all 15 TAM keys | `StorageAdapter.remove` | **no** (backup downloaded first) | UNAUTHORIZED | `data.reset` | **NEW** | C2C-3 | irreversible wipe |
| 8 | System lifecycle | `core/onboarding-reset.js:139` | `loadDemoData` | employees, contracts | `persistEmployees/Contracts` | yes | UNAUTHORIZED | `employee.create` (R4) | existing | C2C-3 | it literally creates employees + contracts |
| 9 | People | `people/employee-dedup.js:30` | `mergeEmployeeGroup` | employees (delete), contracts, payrollPlans, txns, overtime, adjustments, merges, backups | `saveAllData` | no (backup only) | UNAUTHORIZED | `employee.delete` (R5) | existing | C2C-3 | master-record deletion is the strongest verb used |
| 10 | Supplemental | `people/supplemental-engine.js:88` | `generateSupplementalForPlan` | supplementalPayments | persist | yes | UNAUTHORIZED | `supplemental.manage` | existing | C2C-4 | frozen action already exists, unused |
| 11 | Supplemental | `:118` | `refreshSupplemental` | supplementalPayments | persist | yes | UNAUTHORIZED | `supplemental.manage` | existing | C2C-4 | — |
| 12 | Supplemental | `:156` | `transitionSupplemental` | status/history | persist | yes | UNAUTHORIZED | `supplemental.manage` | existing | C2C-4 | — |
| 13 | Supplemental | `:181` | `setSupplementalAccount` | account snapshot | persist | yes | UNAUTHORIZED | `supplemental.manage` | existing | C2C-4 | — |
| 14 | Supplemental | `:189` | `setSupplementalNotes` | notes | persist | yes | UNAUTHORIZED | `supplemental.manage` | existing | C2C-4 | — |
| 15 | Supplemental → Finance | `:219` | `postSupplemental` | supplementalPayments **+ txns** | persist ×2 | yes (status) | UNAUTHORIZED | `supplemental.manage` (single top gate) | existing | C2C-4 | composite; C2C-1 precedent |
| 16 | Supplemental | `:301` | `recoverSupplementalOrphans` | supplementalPayments | persist | n/a | UNAUTHORIZED | **NOT APPLICABLE** (R8) | — | C2C-4 | automatic self-heal at load, no principal |
| 17 | Recurring | `people/recurring-expenses.js:75` | create/edit rule | recurringExpenses | persist | yes | UNAUTHORIZED | `finance.manage` (R6) | existing | C2C-4 | rule administration, not a transaction |
| 18 | Recurring | `:80` | `toggleRecurring` | recurringExpenses | persist | yes | UNAUTHORIZED | `finance.manage` (R6) | existing | C2C-4 | — |
| 19 | Recurring | `:85` | `deleteRecurring` | recurringExpenses | persist | no | UNAUTHORIZED | `finance.manage` (R6) | existing | C2C-4 | — |
| 20 | Monthly Plan → Finance | `people/monthly-plan.js:60` | `commitMonthlyPlan` | txns + monthlyPlans | persist ×2 | yes | UNAUTHORIZED | `finance.manage` (single top gate) | existing | C2C-4 | creates planned transactions |
| 21 | Payroll | `people/payroll-workspace.js:514` | adjustment create/edit | payrollAdjustments | persist | yes | UNAUTHORIZED | `payroll.manage` | existing | C2C-4 | clean fit |
| 22 | Payroll | `:519` | `toggleAdjustment` | payrollAdjustments | persist | yes | UNAUTHORIZED | `payroll.manage` | existing | C2C-4 | — |
| 23 | Payroll | `:520` | `deleteAdjustment` | payrollAdjustments | persist | no | UNAUTHORIZED | `payroll.manage` | existing | C2C-4 | — |
| 24 | Finance | `people/legacy-mapping.js:56` | apply legacy mapping | txns (bulk relink) | persist | yes | UNAUTHORIZED | `finance.manage` | existing | C2C-4 | bulk transaction edit |
| 25 | Bank | `ui/settings-about.js:423` | account create/edit | companyAccounts | persist | yes | UNAUTHORIZED | `settings.manage` (R7) | existing | C2C-4 | configuration, not money movement |
| 26 | Bank | `ui/settings-about.js` `setCompanyAccountStatus` | archive/activate | companyAccounts | persist | yes | UNAUTHORIZED | `settings.manage` (R7) | existing | C2C-4 | — |
| 27 | Settings | `ui/settings-about.js:179` | settings save | settings | `saveSettings` | yes | UNAUTHORIZED | `settings.manage` | existing | C2C-4 | the action exists and is unused |
| 28 | Settings | `core/onboarding-reset.js:69` | dismiss onboarding | `settings.onboardingDismissed` | `saveSettings` | yes | UNAUTHORIZED | `settings.manage` | existing | C2C-4 | trivial, but a settings write |
| 29 | Settings | `ui/settings-about.js:194` | re-show onboarding | `settings.onboardingDismissed` | `saveSettings` | yes | UNAUTHORIZED | `settings.manage` | existing | C2C-4 | — |
| **30** | Monthly Plan | `people/monthly-plan.js:158` | **`markReviewed`** (plan `Draft → Reviewed`) | monthlyPlans (one record) | `persistMonthlyPlans` | yes | UNAUTHORIZED | `finance.manage` | existing | C2C-4 | added on governance review; same domain ruling as row 20 |

Every row above is **APPROVED** by the governance ruling; none is left ambiguous. CEO = allow, Employee = deny,
null = deny for all 30 (§6.1).

### 5.1 Deliberately NOT APPLICABLE (no user principal / not application API)

These were each **examined and ruled** non-targets — they are not forgotten or deferred boundaries.

| Path | Why |
|---|---|
| `core/state-load-migrations.js`, `core/stabilization.js`, `core/hr-persistence-portability.js` migrations | run during bootstrap before any principal is meaningful; gating them would fail closed at load and break data migration |
| `storage-adapter.js` | authorization must never be pushed into persistence (frozen C2A invariant) |
| **Repository delegation seam** — `EmployeeRepository.save()`, `ContractRepository.save()`, `PayrollRepository.save()` | **Examined; NOT a mutation boundary and NOT a bypass.** `save()` performs no independent domain mutation — mutation is handler-owned and has already been applied; the method only delegates to `persist*` and normalizes the boolean into a result contract. Every production caller sits **inside an already-gated boundary** in `people/employees.js`, `people/contracts.js` and `people/payroll-ops-engine.js`. Recorded explicitly because the earlier UX-006C2 plan listed the repository seam in its bypass map |
| `js/cli/cli.js:122` seed | Node CLI harness, TEST ONLY, not loaded in the browser |
| view/filter state (`State.view`, `*Filter`, `*Tab`, `planPreview`, `dedupCanon`, …) | in-memory UI state, no persistence, no business record |
| `recoverSupplementalOrphans` (row 16) | bootstrap self-healing repair path, no user principal; gating it would make recovery fail closed at load |
| `linkSupplementalExecution` | reached only from `executeTransaction`; **INDIRECTLY AUTHORIZED** by `finance.execute` |

---

## 6. Frozen `ACTIONS` delta

```
Current ACTIONS:        17
Reuse existing:         21 boundaries  (import.commit, employee.create, employee.delete,
                                        payroll.manage, finance.manage, supplemental.manage,
                                        settings.manage)
Require a new action:    9 boundaries
New actions (frozen):    3   (import.undo, data.restore, data.reset)
Frozen future ACTIONS:  17 + 3 = 20
```

**No other future action is approved.** Nothing outside `import.undo`, `data.restore` and `data.reset` may
appear as possible, optional, alternative, candidate or pending anywhere in the operative sections; the
rejected set is listed with final status below.

**Why each new action is unavoidable**

| New action | Semantics | Boundaries | Why no existing action fits |
|---|---|---|---|
| `import.undo` | reverse a committed import batch, deleting the records it created | #1 | `import.commit` means *commit*; reusing it would authorize mass deletion of employees/contracts under a name that says the opposite |
| `data.restore` | replace stored data from a backup (month or complete) | #4, #5 | `settings.manage` is configuration; `finance.manage` is transaction administration; neither describes replacing every domain |
| `data.reset` | irreversibly destroy all stored data | #6, #7 | must not share a capability with editing a preference; the two differ like `finance.manage` differs from `finance.execute` |

**Rejected future actions — final status.** `recurring.manage` — **REJECTED** (reuse `finance.manage`, R6).
`bank.manage` — **REJECTED** (reuse `settings.manage`, R7). `employee.merge` — **REJECTED** (reuse
`employee.delete`, R5). None is an approved future action; none may be treated as a live alternative.

---

## 7. Frozen C2C-3 / C2C-4 split

The split is derived from blast radius and from where new vocabulary is needed — not from file count.

**C2C-3 — irreversible / cross-domain data-lifecycle, Import and Restore (rows 1–9).**
Contains **every** new action (`import.undo`, `data.restore`, `data.reset`), every irreversible operation, and
every boundary that mutates more than two domains. This is where the real risk and the real governance
decisions are. **`ACTIONS` 17 → 20 happens here**, in one reviewed vocabulary amendment.

**C2C-4 — administrative domain mutations (rows 10–30).**
Supplemental, recurring, monthly plan (incl. `markReviewed`), payroll adjustments, bank, settings, legacy
mapping. **Zero new actions** — pure reuse of `supplemental.manage`, `settings.manage`, `payroll.manage` and
`finance.manage`, including the two currently-unused frozen actions, plus the §4.12 description amendment.

**C2C-4 closes the user-reachable mutation-enforcement inventory.** After it lands, every remaining ungated
write-like behaviour falls into a category explicitly **ruled** NOT APPLICABLE in §5.1 — bootstrap migrations,
the Node CLI, the repository delegation seam, in-memory/view state, and `recoverSupplementalOrphans`. Those are
non-user enforcement targets by decision, not forgotten or deferred boundaries.

---

## 8. Completeness evidence

This inventory is derived mechanically, not from the UI:

1. **All 72 modules** in `tools/module-order.js` were enumerated and searched (the browser loads exactly these).
2. **Every `State.*` write site** was enumerated with a repository-wide regex over assignment, `push`,
   `unshift`, `splice`, `pop`, `shift`, `sort` and `delete` — **160 raw hits**, then partitioned into persisted
   business state vs. in-memory view/filter state.
3. **Every persistence entry point** was enumerated independently — `StorageAdapter.set/remove`,
   `persist()`, `persistHR`/`persist*`, `saveAllData()`, `saveBackups()`, `saveSettings()`, and direct
   `localStorage.setItem` — and each call site traced back to its boundary. Cross-checking (2) against (3) is
   what surfaced boundaries with no UI button, e.g. `recoverSupplementalOrphans`.
4. **Every caller** of each boundary was traced to establish reachability (`LIVE` / `LEGACY BUT LIVE` /
   `TEST ONLY`); this is how the legacy-preview **fallback route** (a Smart import with no payroll rows) was
   found — a route the C2C-2 memo missed entirely.
5. **Existing authorization was audited per boundary**: exactly 8 files contain `can(ACTIONS.*)`; every other
   mutation boundary in the tree is therefore unauthorized by construction, which bounds the problem.
6. The two known gaps that triggered this assignment (`undoLastSmartImport`, `import-preview.js`) both appear
   in the inventory, and both were reached by method (2)/(3) rather than by being told about them.

**Residual risk, stated honestly:** dynamic dispatch or a mutation performed by a library callback would not be
caught by (2)/(3). None exists in this codebase — there is no `eval`, no dynamic property-name state write, and
the only third-party dependency is the spreadsheet parser, which is read-only.

---

## 9. Governance rulings — FROZEN

All questions raised by the first draft were ruled. Nothing below is open for reinterpretation during
implementation; a change requires a new governance ruling that supersedes this memo.

| # | Question | **Ruling** |
|---|---|---|
| R1 | `undoLastSmartImport` — new `import.undo`, or reuse `import.commit`? | **new `import.undo`.** Deletes across four domains incl. employee/contract master records, is itself irreversible, and `import.commit` names the act of committing — granting it must never silently confer mass deletion |
| R2 | `applyMonthUpdate` — `import.commit` or `data.restore`? | **`import.commit`**, with the replacement caveat recorded (§4.2): it destroys/replaces existing rows for the imported month, but is initiated from a parsed-file import and creates its own safety backup. Recorded so a future backend does not read `import.commit` as strictly additive |
| R3 | `data.restore` + `data.reset`, or one `data.lifecycle`? | **two actions.** Restore is recoverable and takes a safety backup; reset is irreversible destruction. They differ as `finance.manage` differs from `finance.execute` |
| R4 | `loadDemoData` → `employee.create`, or a lifecycle action? | **`employee.create`** — it creates employees and contracts, nothing more |
| R5 | Dedup merge → `employee.delete`, or a new `employee.merge`? | **`employee.delete`** — the strongest verb the operation exercises; approved **on condition** that its cross-domain blast radius is visible in this freeze (§4.9), which it is. No `employee.merge` |
| R6 | Recurring rules → `finance.manage`, or new `recurring.manage`? | **`finance.manage`** under the §4.12 amendment. Rule administration ≠ execution: transactions materialised from a rule still execute under `finance.execute`. No `recurring.manage` |
| R7 | Bank accounts → `settings.manage`, or new `bank.manage`? | **`settings.manage`** — configuration metadata only; no money movement and no banking credential or operational authority. No `bank.manage` |
| R8 | `recoverSupplementalOrphans` → NOT APPLICABLE? | **Yes, explicitly ruled** (§5.1) — bootstrap self-healing repair path with no user principal |
| R9 | Should `undoLastSmartImport` write an audit entry (it currently writes none)? | **Yes — but NOT here.** It is a runtime behaviour change, out of scope for this document and for the C2C-3/4 mapping. See §12, Finding C |

## 10. Stop conditions

**None triggered.** No boundary was ambiguous enough to block the inventory; no frozen mapping changes the
meaning of `finance.execute` or `import.commit`, and the one `finance.manage` description change is stated
explicitly (§4.12) rather than applied silently; no schema, storage, migration or backup-format change is
implied (`data.restore` *reads* `SCHEMA_VERSION` and re-marks existing migration flags, which is existing
behaviour, not a new migration); and no runtime modification was required to establish the inventory. The
baseline drift in §0 is CI-only and non-material.

## 11. GO / NO-GO

**GO — mapping frozen.** Atlas returned **GO FOR MAPPING FREEZE**; R1–R9 are ruled (§9), all **30** rows are
APPROVED with no ambiguous row (§5), the split is exact (§7), and the future count is exact: **`ACTIONS` 17 →
20** (§6). C2C-3 is ready to implement from `main` once this document merges, followed by C2C-4. No
implementation may begin before this freeze is recorded on `main`.


## 12. Governance NOTES — outcome-reporting defects (recorded, NOT fixed here)

The governance review of this inventory found three defects that are **not** authorization-mapping issues and
must not be repaired under a mapping or inventory assignment. They are recorded so they are not lost.

**Finding A — `js/people/payroll-workspace.js:146`, Generate button.** Calls the gated
`generatePayrollForMonth`, which on denial returns `{denied:true, generated:0}` and shows no warning; the
caller then unconditionally calls `persistPayrollPlans()` and `showSuccess('Generated 0, refreshed 0, 0
excluded.')`. A denied principal receives a **success banner**.
Classification: **AUTHORIZED BOUNDARY — NO AUTHORIZATION BYPASS — FALSE SUCCESS / OUTCOME-REPORTING DEFECT.**

**Finding B — `js/people/payroll-workspace.js:139–140`, lock/unlock buttons.** `setPayrollLock` warns and
returns on denial; the caller then unconditionally shows `showSuccess('Period locked.' / 'Period unlocked.')`.
A denied principal sees a warning **and** a success.
Classification: **AUTHORIZED BOUNDARY — NO AUTHORIZATION BYPASS — FALSE SUCCESS / OUTCOME-REPORTING DEFECT.**

Both are the same defect class as UX-006C2C-2 **BLOCKER-1** (the Execution Center Schedule control), whose
remediation fixed only the Finance instance. They require a **dedicated outcome-reporting audit and
remediation assignment** covering every gated boundary. They do not alter the C2C-3/4 mapping.

**Finding C — `undoLastSmartImport` writes no audit entry.** It sets `batch.undone` and calls `saveAllData()`
but emits no `logActivity`, so a four-domain deletion leaves no entry in the read-only activity trail — while
its counterpart `commitSmartImport` does log. Evaluate in the same remediation pass or during C2C-3
implementation planning. **No runtime change is made by this document.**
