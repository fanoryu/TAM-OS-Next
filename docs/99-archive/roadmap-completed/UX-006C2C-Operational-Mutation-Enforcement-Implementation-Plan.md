# UX-006C2C — Operational Mutation Enforcement: Discovery & Implementation Plan

**STATUS: PLANNING ONLY — NO C2C IMPLEMENTATION PERFORMED.** No production code is authorized by this
document. It maps every remaining **operational** business mutation boundary (operational Contract workflows,
Payroll, Finance, Import, Supplemental, Settings/System, Bank/account, destructive Reset, plus additional
paths discovered in source) and specifies where and how the frozen `can(action, resource?)` seam must be
applied so a denied authorization yields **SE-0 — zero business side effect**. Implementation begins only
under separate, owner-authorized, staged assignments.

**Core invariant (SE-0):** *denied authorization ⇒ no State mutation, no persistence, no audit event, no
downstream recalculation, no status transition, no generated/removed record, no external/finance side effect,
no partial composite mutation, no success feedback.*

---

## 0. Baseline (verified)

| Fact | Value |
|---|---|
| main | `c09354747a2b541ecce8fe5ae0416a811f29a333` (clean) |
| Frozen | C1 `27aa882`, D1 `4a53a35`, C2A `a7369447`, C2B `023a8214` |
| verifier / runtime | **2144 PASS** · **1867 / 24** (C2B 64, C2A 66, authz 92, D1 29, workspace 31, identity 33) |
| Global Search / Data Grid | **26 / 36** |
| ACTIONS | **16** · APP_VERSION **2.9.0** · SCHEMA_VERSION **6** |
| Dev artifact | `dist/tam-os-v2.9.0.html` — 1,093,078 B — `a47bafc8…` |
| Published v2.9.0 (immutable) | tag → `598edef0` |

This plan adds only documentation; it changes none of the above.

---

## 1. Frozen authz contract (unchanged; no ACTIONS change proposed)

Business code calls **only** `can(action, resource?)` (public) with the frozen **16** ACTIONS; it must not
reference `canPrincipal`/`POLICY`/`isInScope*`. Enforcement is at the **domain-mutation boundary**, never in
`persist*`/StorageAdapter. **C2C proposes NO new ACTIONS** — every operational boundary maps cleanly to an
existing action (see §12). Two mappings are flagged **ambiguous** for an owner decision (§12.1); neither is
authorized here.

### The 16 frozen actions
`employee.create/update/delete`, `contract.create/update/delete`, `payroll.manage`,
`overtime.submitSelf/createSelfDraft/updateSelfDraft/deleteSelfDraft/manage`, `finance.execute`,
`import.commit`, `supplemental.manage`, `settings.manage`.

All C2C boundaries are **company/operational** → **CEO pass-through; Employee deny-by-default; null deny**
(§13–§14). None is employee self-service.

---

## 2. Operational mutation inventory (source-grounded)

| # | Domain | Entry point (function) | File:line | State writes | Persist | Audit `type:` | Proposed action |
|---|---|---|---|---|---|---|---|
| 1 | Contract op | `transitionContractStatus(id, transition)` | `people/contracts.js:220` | `c.status`, history | `persistContracts` (via repo) | `contract.status.*` | `contract.update` |
| 2 | Contract op | `renewContract(id, renewal)` | `people/contracts.js:334` | predecessor status + **new successor** push | `ContractRepository.save` | renewal | **composite** `contract.create` (§16.1) |
| 3 | Payroll | `generatePayrollForMonth(monthKey)` | `people/payroll-ops-engine.js:257` | `payrollPlans.push` | `persistPayrollPlans` | `payroll.generate` | `payroll.manage` |
| 4 | Payroll | salary override + clear (inline `#ovForm`) | `payroll-ops-engine.js:427-450` | `pp.salaryOverride/baseSalary` | `persistPayrollPlans` | `payroll.override` | `payroll.manage` |
| 5 | Payroll | `transitionPayrollLifecycle(id, transition)` | `payroll-ops-engine.js:384` | `pp.status`, history | `persistPayrollPlans` | lifecycle | `payroll.manage` |
| 6 | Payroll→Finance | `commitReadyPayroll(monthKey, ids)` | `payroll-ops-engine.js:479` | plans + **finance txns** | `persistPayrollPlans` + txns | `payroll.post` | **composite** `payroll.manage` (§16.2) |
| 7 | Payroll | `prepareNextMonthPayroll(monthKey)` | `payroll-ops-engine.js:554` | plan generation | `persistPayrollPlans` | — | `payroll.manage` |
| 8 | Payroll | `setPayrollLock(monthKey, locked)` | `payroll-ops-engine.js:672` | `settings.payrollLocks` | settings persist | lock/unlock | `payroll.manage` |
| 9 | Finance | `executeTransaction(id, data)` | `finance/execution-center.js:186` | `txn.actual/status`, links | txns persist | `finance.execute` | `finance.execute` |
| 10 | Finance | `archiveTransaction(id)` | `finance/execution-center.js:245` | `txn.archived` | txns persist | — | `finance.execute` (ambiguous, §12.1) |
| 11 | Finance | `saveEditedTransaction(id, fields)` | `finance/execution-center.js:262` | txn fields | txns persist | — | `finance.execute` (ambiguous, §12.1) |
| 12 | Finance | manual transaction create/edit (add-upload/modals) | `finance/add-upload.js` / `transaction-modals.js` | `txns.push` | txns persist | — | `finance.execute` (ambiguous, §12.1) |
| 13 | Import | `commitSmartImport(model)` | `import/smart-import-commit.js:180` | multiple collections (may create employees/txns) | multiple persist | `import.commit` | `import.commit` |
| 14 | Supplemental | `createSupplemental` (push) | `people/supplemental-engine.js:~105` | `supplementalPayments.push` | `persistSupplementalPayments` | supplemental.* | `supplemental.manage` |
| 15 | Supplemental | `refreshSupplemental` / `setSupplementalAccount` / `setSupplementalNotes` / `postSupplemental` / `recoverSupplementalOrphans` | `supplemental-engine.js:118/181/189/219/301` | fields/status/**finance txn** on post | persist (+txn) | supplemental.* | `supplemental.manage` (post = **composite**, §16.3) |
| 16 | Settings | `saveSettings()` | `core/state-load-migrations.js:109` | `State.settings` | settings persist | — | `settings.manage` (scope: company vs local pref, §9/§12.1) |
| 17 | Settings | **destructive reset** (inline handler) | `ui/settings-about.js:250-262` | **wipes all collections**; direct `StorageAdapter.set` | direct storage | reset (existing) | `settings.manage` (high-impact, §11) |
| 18 | Bank | `setCompanyAccountStatus(id, status)` | `ui/settings-about.js:431` | `account.status` | `persistCompanyAccounts` | `bankaccount.status` | `settings.manage` (ambiguous, §12.1) |
| 19 | Bank | company account create/edit (inline `openCompanyAccountModal`) | `ui/settings-about.js:396-424` | `companyAccounts.push`/edit | `persistCompanyAccounts` | — | `settings.manage` (ambiguous, §12.1) |
| 20 | Recurring | `deleteRecurring(id)` + create/save (recurring-expenses.js) | `people/recurring-expenses.js:85` + modal | `recurringExpenses.*` | persist | — | `settings.manage` **or** new (ambiguous, §12.1) |
| 21 | Monthly plan | `commitMonthlyPlan(preview)` + manual row | `people/monthly-plan.js:60/164` | `monthlyPlans` (+ may create txns) | persist | — | `finance.execute`/`payroll.manage` (ambiguous, §12.1) |
| 22 | Legacy map | link Gaji txns to employees/contracts | `people/legacy-mapping.js` | txn link fields | persist | — | `finance.execute` (ambiguous, §12.1) |
| 23 | Dedup | `mergeEmployeeGroup(canonicalId, duplicateIds, choices)` | `people/employee-dedup.js:30` | merges/removes employees | persist | — | `employee.update`+`employee.delete` **or** ambiguous (§12.1) |

**Note:** items 10–12, 16, 18–23 were **not** in the assignment's known list — discovered by source
inspection and reported here. Several are **ambiguous** mappings requiring an owner decision (§12.1).

---

## 3. Contract operational discovery (§4)

- `transitionContractStatus(id, transition)` (`contracts.js:220`): validates a transition, sets `c.status`,
  appends history, persists via repository, audits `contract.status.*`. **No new Contract created.** → maps to
  **`contract.update`** on the in-scope contract; CEO pass-through, Employee/null deny. `requestContractStatusTransition`
  (`:255`) routes to it via the domain command seam.
- `renewContract(id, renewal)` (`contracts.js:334`): **composite** — mutates the predecessor
  (status→Renewed, back-link, history) **and pushes a new successor contract**, persisted in one
  `ContractRepository.save`. It is a create of a new Contract plus an update of the old. **§16.1** specifies a
  **single top-level authorization = `contract.create`** (the strongest privilege — creating a Contract),
  evaluated before any predecessor mutation or successor push, so denial is atomic (no predecessor change, no
  successor). Rationale: renewal's defining new effect is a new Contract; `contract.create` already implies
  CEO-only. (Alternative considered: require both `contract.create` AND `contract.update` — rejected as it
  risks partial semantics and offers no additional safety for a CEO-only model.)
- Neither path is employee self-service. Neither invokes the C2A-guarded modal handlers (they mutate
  directly), so C2C must guard them independently.

---

## 4. Payroll discovery (§5)

All payroll mutations map to **`payroll.manage`** (CEO-only; Employee/null deny). Entry points: generate
(3), salary override + clear (4), lifecycle transition (5), commit-to-finance (6), prepare-next-month (7),
lock/unlock (8). Authorization point = the resolved plan/collection at the top of each function, before the
first `push`/field set/`persistPayrollPlans`/`logActivity`. Salary override (4) is an **inline modal
closure** (like C2A create/update) — guard at the top of both the `#ovForm` submit and the `#ovClear`
handler. **Committed payroll immutability (CLAUDE.md §8.1)** is independent of and preserved by C2C.

---

## 5. Finance discovery (§6)

- `executeTransaction` (9) → **`finance.execute`** (the canonical, already-frozen action). Guard before
  actual/status write and any linked-supplemental Executed flip.
- `archiveTransaction` (10), `saveEditedTransaction` (11), manual create/edit (12): finance mutations with no
  dedicated action. **Ambiguous (§12.1)** — map to `finance.execute` (broad "finance mutation") OR introduce a
  finance-management action. Flagged for owner decision; not authorized here.
- **Composite:** `commitReadyPayroll` (6) mutates payroll **and** creates finance transactions. **§16.2**:
  authorize once with **`payroll.manage`** at the top (the operator posting payroll is the payroll manager);
  do **not** additionally require `finance.execute` (posting creates *planned* txns, not executions — and a
  second gate could half-post). CEO passes both anyway; the single top gate guarantees atomic denial.

---

## 6. Import discovery (§7)

`commitSmartImport(model)` (`smart-import-commit.js:180`) is the **commit** boundary (preview/parse is
read-only and must stay unguarded). It can create employees/contracts/txns across collections. → single
top-level **`import.commit`** authorized before the first collection mutation/persist, so a denied import
writes nothing (atomic). Upload/parse/preview UI unchanged.

---

## 7. Supplemental discovery (§8)

All supplemental mutations → **`supplemental.manage`**: create (14), refresh/setAccount/setNotes/recover
(15), and `postSupplemental` (15) which is **composite** (creates a finance transaction). **§16.3**:
authorize once with `supplemental.manage` at the top of `postSupplemental` before the supplemental status
change and the txn creation. One consolidated action remains sufficient (no materially different privilege
tier found).

---

## 8. Settings / Bank / Reset discovery (§9–§11)

- `saveSettings()` (16): company/system configuration → **`settings.manage`**. **Distinction (§9):** a
  purely-local UI preference (theme/appearance) is arguably not a business mutation. Since `saveSettings`
  writes the whole settings object (company name, opening cash, payroll defaults, overtime rules) it must be
  guarded as `settings.manage`. Whether theme-only changes warrant an unguarded fast path is a **minor owner
  UX decision (§12.1)** — default recommendation: guard `saveSettings` wholesale (simplest, safest).
- **Destructive reset (17)** (`settings-about.js:250`): wipes every collection via **direct
  `StorageAdapter.set`** and direct `State` reassignment (a persistence-layer bypass). Highest-impact SE-0
  path. → **`settings.manage`**, authorized at the very top of the click handler, before the confirms and
  before any `StorageAdapter.set`/State wipe. (§11 risk: SE-0 failure here is catastrophic.)
- **Bank/account (18–19)**: `setCompanyAccountStatus` + create/edit modal. No dedicated bank action after
  consolidation. **Ambiguous (§12.1)** — map to `settings.manage` (company financial configuration) OR a new
  bank action. Flagged; default recommendation `settings.manage` with owner confirmation.

---

## 9. Additional discovered boundaries (§3 "do not assume prior inventory complete")

Recurring expenses (20), monthly-plan commit (21), legacy payroll mapping (22), employee dedup merge (23) are
real operational mutations not in the assignment's list. Mappings are **ambiguous** (§12.1): recurring →
`settings.manage`?; monthly-plan commit → `finance.execute`/`payroll.manage` (composite, may create txns);
legacy mapping → `finance.execute`; dedup merge → `employee.update`+`employee.delete` (composite). All
CEO-only; all flagged for owner mapping confirmation before their stage.

---

## 10. Boundary → ACTION mapping table & classification (§12)

| Classification | Boundaries |
|---|---|
| **Cleanly covered** (existing action) | transitionContractStatus→contract.update; renewContract→contract.create (composite); all payroll→payroll.manage; executeTransaction→finance.execute; commitSmartImport→import.commit; all supplemental→supplemental.manage; saveSettings→settings.manage; reset→settings.manage |
| **Ambiguous — owner decision (§12.1)** | archive/edit/manual transactions; bank account status/create; recurring expenses; monthly-plan commit; legacy mapping; dedup merge; theme-only settings fast-path |
| **Requires new action** | **None identified.** The 16-action vocabulary can represent every boundary; ambiguities are *mapping* choices, not missing vocabulary. |

### 10.1 Ambiguous mappings (owner decision — NOT authorized here)
Each can be safely expressed with an existing action; the decision is *which* existing action best matches
product intent (e.g., finance CRUD under `finance.execute` vs. a future finance-management split; bank under
`settings.manage` vs. dedicated). **No new ACTION is proposed**; if the owner prefers finer granularity, that
is a separate reviewed ACTIONS amendment (like C2B's 13→16), not part of C2C as scoped.

---

## 11. Employee / CEO / null policy (§13–§14)

- **Employee:** denied **all** C2C operational mutations (Contract ops, Payroll, Finance, Import,
  Supplemental, Settings, Bank, Reset, recurring/monthly/legacy/dedup). No self-service tier exists for any
  operational domain; source/product architecture supports uniform deny. No permission inferred from
  visibility. (If any future requirement needs an Employee operational capability, that is an owner product
  decision — flagged, not assumed.)
- **CEO:** pass-through with **explicit D1 selection**; every domain gets a zero-regression success test. No
  default/implicit/boot CEO.
- **null:** deny everywhere (fail-closed).

---

## 12. Composite / cross-domain atomicity strategy (§16 — critical)

| Composite op | Domains | Authorization design |
|---|---|---|
| `renewContract` | Contract(update predecessor) + Contract(create successor) | single top gate `contract.create` before any write |
| `commitReadyPayroll` | Payroll + Finance(create txns) | single top gate `payroll.manage` before any write |
| `postSupplemental` | Supplemental + Finance(create txn) | single top gate `supplemental.manage` before any write |
| `commitMonthlyPlan` | MonthlyPlan + possibly Finance txns | single top gate (owner-mapped) before any write |
| `commitSmartImport` | Employees/Contracts/Txns | single top gate `import.commit` before any write |
| `mergeEmployeeGroup` | Employee(update)+Employee(delete) | single top gate (owner-mapped) before any write |

**Rule:** authorize **once at the top-level command**, before the first sub-mutation, so a denial can never
produce "domain A mutated → domain B denied". No per-sub-operation re-authorization that could partially
succeed. This is the central C2C design principle.

---

## 13. Bypass map (§17)

| File / function | Direct mutation | Intended C2C boundary |
|---|---|---|
| `settings-about.js:250` reset | `StorageAdapter.set(...)` + `State.*=[]` (bypasses persist*) | guard at handler top (`settings.manage`) |
| `payroll-ops-engine.js` generate/commit | `State.payrollPlans.push`, direct `pp.status=` | guard at function top (`payroll.manage`) |
| `contracts.js` renew | predecessor `.status=`, `State.contracts.push(successor)` | guard at `renewContract` top (`contract.create`) |
| `supplemental-engine.js` | `State.supplementalPayments.push`, status set | guard at function top (`supplemental.manage`) |
| finance execution/edit/archive | direct `txn.*=` | guard at function top (`finance.execute`) |
| inline modal submits (salary override, company account, manual txn) | direct field/collection writes in closures | guard at top of each submit closure |

Authorization stays at the **domain boundary**, never in `persist*`/StorageAdapter/repository `.save`.

---

## 14. Denied return-semantics map (§19)

Preserve each boundary's existing contract; do not standardize:
- Imperative handlers (reset click, setPayrollLock, transition*, execute/archive, setCompanyAccountStatus,
  deleteRecurring): early **void** return + neutral permission toast; no throw.
- Typed-outcome helpers (supplemental `{success,error}`, monthly `commitMonthlyPlan` preview result,
  `mergeEmployeeGroup`): return the existing failure shape with `error:'NotAuthorized'`.
- Inline modal submits: gate success toast/close on the result (as C2A/C2B did).

---

## 15. Recommended staged decomposition (§23–§24)

Source dependencies (Payroll↔Finance, Supplemental↔Finance, Import↔many) suggest this order:

- **C2C-1 — Contract Operations + Payroll** (items 1,2,3,4,5,6,7,8) — includes the two contract-op paths and
  all payroll incl. the Payroll→Finance composite `commitReadyPayroll`.
- **C2C-2 — Finance + Import** (items 9–13) — execution/edit/archive/manual + `commitSmartImport`; resolves
  the finance-mapping ambiguity first (owner decision gate).
- **C2C-3 — Supplemental + System Administration** (items 14–20) — supplemental (incl. composite post),
  settings save, **destructive reset**, bank/account, recurring.
- **C2C-4 — Remaining operational + Integration Freeze** (items 21–23: monthly-plan, legacy mapping, dedup) +
  a C2C integration/verifier freeze.

Each stage: its own domain runtime harness, additive verifier guards, deterministic rebuild, browser/harness
proof, docs reconciliation. Owner **ACTION-mapping decisions (§10.1)** for ambiguous items must be resolved
**before** the stage that touches them.

## 15.1 Proposed harness decomposition
`tools/verify-mutation-enforcement-contract-payroll-runtime.js`,
`tools/verify-mutation-enforcement-finance-import-runtime.js`,
`tools/verify-mutation-enforcement-supplemental-system-runtime.js`,
`tools/verify-mutation-enforcement-operational-runtime.js` — each with null/Employee deny SE-0, CEO success,
persistence/audit spies, and **composite atomicity** tests (assert domain-B untouched when the top gate
denies).

---

## 16. Verifier strategy (§26)

Per stage, additive guards: each boundary calls `can(...)` with the correct ACTION; guard precedes the first
side effect; no internal authz API; no `principalType===`; no `null→allow`; no persistence-layer auth;
remaining unstaged domains still `!/can\(/` (explicitly untouched); ACTIONS unchanged (16) unless a separate
amendment; SCHEMA_VERSION 6; GS/DG/D1 preserved. Avoid brittle full-source hashing.

---

## 17. Browser / integration strategy (§27)

Per stage: null → operational mutation denied, no crash; CEO (explicit D1) → operation works; Employee →
denied, no state change. **Destructive reset and bulk ops proven by harness** (browser automation unsafe for
data-wipe). Composite ops verified for atomic denial in the harness.

---

## 18. Storage / schema conclusion (§22)

No new storage key, no migration, `SCHEMA_VERSION` stays **6**. Authorization is derived (policy over the
current principal), not persisted. If any stage appears to need a schema/storage change → **STOP and flag**.

---

## 19. GS / DG / UI boundary (§20–§21)

No Global Search scope wiring, no Data Grid engine change, no action-availability UI (button hiding/nav/Action
Center/CSS). C2C is domain enforcement only; presentation consistency is C3/remaining-D.

---

## 20. Risk register (§28)

| Risk | Likelihood | Impact | Mitigation / stage |
|---|---|---|---|
| Partial composite mutation (A done, B denied) | Med | High | single top-gate design (§12); atomicity harness tests |
| Destructive reset SE-0 failure | Low | **Critical** | guard at handler top before any `StorageAdapter.set`; harness proof (C2C-3) |
| Direct bypass unguarded (reset/generate/renew) | Med | High | bypass map (§13); verifier `can()`-before-mutation guards |
| Wrong ACTION mapping (ambiguous items) | Med | Med | owner decision §10.1 **before** the touching stage |
| CEO regression | Low | High | per-domain CEO success tests + browser smoke |
| Audit on denied op | Low | Med | authorize before `logActivity`; audit-spy = 0 on deny |
| Downstream finance side effect on deny | Med | High | top-gate before txn creation (composites) |
| Auth pushed into persistence layer | Low | Med | verifier guard: no `can(` in persist*/StorageAdapter |
| Stale modal closures (inline submits) | Med | Med | gate success on result; guard at submit top |
| Async ordering / repeated authorization | Low | Med | single authorization per command; no re-check that can partially apply |

---

## 21. Implementation stop conditions (§29)

STOP and escalate if: a new ACTION is required (owner decision); an Employee operational capability is
required; a schema/storage change is needed; a composite cannot be made atomic; the persistence layer would
need to know authorization; GS/DG/UI changes are required; real authentication is required; or current source
contradicts frozen C1/C2 policy.

---

## 22. Canonical status

**UX-006C2C — OPERATIONAL MUTATION ENFORCEMENT: PLANNING ONLY — NO IMPLEMENTATION PERFORMED.** No ACTIONS
change proposed (16 stays). Staged C2C-1…C2C-4 recommended. Ambiguous ACTION mappings (§10.1) and any ACTIONS
granularity preference are **owner decisions** to resolve before the relevant stage. Next authorized activity:
owner review of this plan, then a separate assignment for **C2C-1 (Contract Operations + Payroll)**.
