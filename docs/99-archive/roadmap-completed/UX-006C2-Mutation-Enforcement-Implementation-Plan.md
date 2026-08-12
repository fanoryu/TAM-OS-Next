# UX-006C2 — Mutation Enforcement: Discovery & Implementation Plan

**STATUS: PLANNING — NOT IMPLEMENTED.** No production code is authorized by this document. It maps every
real business mutation boundary and specifies exactly where and how the frozen UX-006C1 authorization seam
`can(action, resource?)` must be applied so that **a denied authorization produces zero business side
effect**. Implementation begins only under a separate, owner-authorized assignment (staged, §24).

**Core invariant (SE-0):** *denied authorization ⇒ no State mutation, no persistence, no audit event, no
downstream recalculation, no status transition, no generated record, no success toast, no
mutation-triggered navigation.*

---

## 0. Baseline (verified)

| Fact | Value |
|---|---|
| main | `c08b4ac93c226593ecf1a00185eafc895e158dae` (clean) |
| Frozen | UX-006A `73096303`, UX-006B `f40fc064`, UX-006C plan `eb90b91`, UX-006C1 `27aa882` |
| APP_VERSION / SCHEMA_VERSION | `2.9.0` / **6** |
| Verifier | **2097 PASS** · runtime **1684 / 21** (authz **68**, workspace **31**, identity **33**) |
| Global Search / Data Grid | **26 / 36** |
| Dev artifact | `dist/tam-os-v2.9.0.html` — 1,077,844 B — `aac5d9d9…` |
| Published v2.9.0 (immutable) | tag → `598edef0`; asset 1,049,018 B — `e7470ff5…` |

This plan adds only documentation; it changes none of the above.

---

## 1. Frozen authz contract (unchanged)

Business/feature code calls **only** `can(action, resource?)` (public). It must **not** reference
`canPrincipal`, `POLICY`, `isInScope`, or `isInScopeForPrincipal` (internal). `authz.js` is not redesigned.
Enforcement placement is **domain-mutation boundary**, never `StorageAdapter`/`persist*` (§18).

---

## 2. Mutation inventory (source-grounded)

| Domain | Entry point (function / handler) | File:line | Persist | Audit `type:` |
|---|---|---|---|---|
| Employee | create/update handler (inline onsubmit: `rec.push` / field set) | `people/employees.js:201-226` | `persistEmployees` | — (create/edit) |
| Employee | `toggleEmployeeActive` (active/inactive) | `people/employees.js:~230-236` | `persistEmployees` | — |
| Employee | `deleteEmployee(id)` | `people/employees.js:238-247` | `persistEmployees` | `employee.delete` |
| Contract | save handler (create/update) | `people/contracts.js:144-178` | `persistContracts` | — |
| Contract | `deleteContract` | `people/contracts.js:~286` | `persistContracts` | `contract.delete` |
| Payroll | `generateMonthlyPayroll` (draft rows) | `people/payroll-ops-engine.js:~262-303` | `persistPayrollPlans` | `payroll.generate` |
| Payroll | salary override (inline handler) | `people/payroll-ops-engine.js:437-446` | `persistPayrollPlans` | `payroll.override` |
| Payroll | `transitionPayrollLifecycle(id,transition)` | `people/payroll-ops-engine.js:384` | `persistPayrollPlans` | — |
| Payroll | `commitReadyPayroll(monthKey,ids)` → posts to finance | `people/payroll-ops-engine.js:479-548` | `persistPayrollPlans` + txns | `payroll.post` |
| Payroll | `prepareNextMonthPayroll(monthKey)` | `people/payroll-ops-engine.js:554-558` | `persistPayrollPlans` | — |
| Payroll | `setPayrollLock(monthKey,locked)` | `people/payroll-ops-engine.js:672` | settings persist | — |
| Overtime | `addOvertimeRecord(fields)` (create) | `people/overtime.js:105-108` | `persistOvertime` | — |
| Overtime | `updateOvertimeRecord(id,fields)` | `people/overtime.js:111-121` | `persistOvertime` | — |
| Overtime | `setOvertimeStatus(id,status)` (**generic** transition) | `people/overtime.js:123-131` | `persistOvertime` | — |
| Overtime | `duplicateOvertimeRecord(id)` (creates Draft) | `people/overtime.js:138-146` | `persistOvertime` | — |
| Overtime | `deleteOvertimeRecord(id)` | `people/overtime.js:148-154` | `persistOvertime` | — |
| Overtime | `worksheetSave(monthKey,rows,approve)` (**bulk**; direct `o.status=`) | `people/overtime.js:413-...` | `persistOvertime` | — |
| Finance | transaction execute | `finance/execution-center.js:~220` | txns persist | `finance.execute` |
| Import | smart-import commit | `import/smart-import-commit.js:291` | multiple persist | `import.commit` |
| Supplemental | `create` / `refreshSupplemental` / `postSupplemental` / `execute` / `setSupplementalAccount` | `people/supplemental-engine.js:111/118/219/285/181` | `persistSupplementalPayments` | `supplemental.*` |
| Settings | `saveSettings` | `ui/settings-about.js:~179` | `persistHR('settings')` | — |
| Settings | **destructive reset** (`State.txns=[]; State.settings={...DEFAULT}`) | `ui/settings-about.js:259` | multiple persist | — |
| Bank acct | `setCompanyAccountStatus(id,status)` | `ui/settings-about.js:431-436` | `persistCompanyAccounts` | `bankaccount.status` |

The earlier "11 `persist*`" count is **not** exhaustive of *entry points* — several domains have multiple
mutation callers per persist helper (esp. overtime and payroll), plus **bulk** and **reset** paths.

---

## 3. Persistence & audit maps (denial must precede both)

Each entry point in §2 ends in a `persist*` call (persistence map = the "Persist" column) and some also emit
a `logActivity({type:…})` (audit map = the "Audit" column). **Enforcement must run before the first State
mutation**, which is itself before persist and before audit — so a denial guarantees SE-0 for all three.

---

## 4. Bypass map (critical)

Paths that could mutate/persist **without** the obvious single-record boundary:

1. **Overtime bulk — `worksheetSave`** sets `o.status='Approved'` directly (not via `setOvertimeStatus`).
   Must be enforced independently (company `overtime.manage`, per-row).
2. **Overtime generic — `setOvertimeStatus`** accepts *any* target status. An employee allowed
   `overtime.submitSelf` must **not** be able to drive arbitrary transitions through it (§13).
3. **Payroll — `commitReadyPayroll`** both mutates payroll **and** posts finance txns (two side-effect
   domains from one call) — enforce once, at the top, before either.
4. **Settings destructive reset** (line 259) bypasses `saveSettings`; a separate `settings.manage` gate.
5. **Duplicate — `duplicateOvertimeRecord`** is a *create* (new Draft) not an edit — treat as a create
   action, not `submitSelf`.
6. **Repository seam** — `EmployeeRepository.save() → persistEmployees()`: enforce at the **handler**, not
   the repository/persist (which lack action/resource semantics).

Rule: for a domain with multiple entry points, place `can(...)` at **each** domain mutation boundary that
knows the action + canonical resource — not once in a shared low-level persist.

---

## 5. Overtime action-vocabulary review (Q-OT resolved)

C1 froze `overtime.submitSelf` + `overtime.manage`. Q-OT now authorizes employee **create/edit/delete own
Draft**. Overloading `overtime.manage` for employees is forbidden (it is company/CEO). **Recommendation —
add three narrow C2 actions** (a reviewed plan amendment, §25):

| New action | Semantics | CEO | Employee |
|---|---|---|---|
| `overtime.createSelfDraft` | create a new Overtime record owned by self, status `Draft` | ✔ | ✔ (own `employeeId` only) |
| `overtime.updateSelfDraft` | edit an own record while status `Draft` | ✔ | ✔ (own + Draft) |
| `overtime.deleteSelfDraft` | delete an own record while status `Draft` | ✔ | ✔ (own + Draft) |

`overtime.submitSelf` (Draft→Submitted) and `overtime.manage` (review/approve/reject/commit + bulk) are
unchanged. This is the **minimal** naming model that keeps company management and employee self-service
distinct and each predicate explicit.

---

## 6. Enforcement-location principle

Authorization executes **before the first business side effect**:

```
identify action + canonical resource
→ can(action, resource)
→ if !allowed: return failure (no-op)   ← SE-0 boundary
→ mutate State → persist → audit → render/toast
```

For each entry point the plan specifies the earliest safe line (top of the domain function / top of the
handler, before any `State.*` write or `rec.push`). Where current code computes/mutates before the full
resource is known, that is flagged (§11 ownership case) and the resource is resolved from the canonical
record **before** mutation.

---

## 7. Denied-result & side-effect contract

- **Denied result:** return a repository-consistent falsy/failure (`return;` / `return false;` / existing
  `{ok:false}` shape) — **no throw** for ordinary denial.
- **SE-0:** on denial, State deep-equals its pre-call value; `persist*` call count = 0; `logActivity` count =
  0; no derived recalculation; no `showSuccess`/toast; no `render()`-driven navigation implying success.
- **No denial UI** invented in C2 (a silent no-op or existing warning helper is acceptable); denial dialogs
  and action hiding are UX-006D/C3.
- **No new denial audit** in C2 (default: denied attempts emit nothing; a future security-telemetry event is
  out of scope — §17).

---

## 8. Create / Update / Delete strategies

- **Create** (`employee.create`, `contract.create`, `overtime.createSelfDraft`): no persisted record yet.
  Check the **candidate** record *before* persistence. For employee overtime create-self, the candidate's
  `employeeId` must equal `currentUser.employeeId` (AZ-1 via the resource passed to `can`), so an employee
  can never create a Draft owned by another employee. Company creates (`employee.create`/`contract.create`)
  are `ceoOnly` (no resource, or the candidate record).
- **Update** (`employee.update`, `contract.update`, `payroll.manage`, `overtime.updateSelfDraft`): authorize
  against the **canonical existing record** (pre-mutation) resolved by id. §11 covers ownership-change.
- **Delete** (`employee.delete`, `contract.delete`, `overtime.deleteSelfDraft`): authorize against the
  canonical record **before** deletion; on deny the record and its persistence/audit remain untouched.
  Employee `deleteSelfDraft` requires SELF + status `Draft`.

## 9. Resource-bearing operations

Resource passed to `can(action, resource)` is the **canonical record before mutation** (never a partial UI
surrogate when the real record is resolvable). For overtime self operations the resource must carry
`employeeId` and `status` (both present on the real record) so the policy's SELF + Draft predicate can hold.

## 10. Create-authorization detail

For `overtime.createSelfDraft`, the candidate resource is the about-to-be-built record (`buildOvertimeRecord`
output before push). Authorize on it (its `employeeId`/`status='Draft'`) **before** `State.overtimeRecords.push`
and `persistOvertime`. Deny ⇒ nothing pushed, nothing persisted.

## 11. Ownership-change protection (update, critical)

Threat: employee edits own Draft (authorized on old `employeeId`), then the payload reassigns `employeeId`
to another employee. **Mandatory mitigations (defense-in-depth):**
1. **`employeeId` is immutable on the employee self-edit path** — the update surface/handler must not accept
   a changed `employeeId` (drop/ignore it); AND
2. **post-update re-check** — authorize the **candidate post-update** resource as well, so a scope-changing
   edit is denied even if (1) is bypassed.
Both are required; either alone is insufficient. The plan mandates asserting this in tests (§26).

## 12. Delete-authorization detail

Authorize against the canonical record before removal; deny ⇒ `State.overtimeRecords` unchanged, no persist,
no audit. Employee path additionally requires status `Draft` (no delete after Submitted).

## 13. Overtime state-transition enforcement map

State machine: `Draft → Submitted → Reviewed → Approved → Rejected → Committed to Payroll`.

| Transition | Caller today | Action (C2) | CEO | Employee |
|---|---|---|---|---|
| create Draft | `addOvertimeRecord` / `duplicateOvertimeRecord` | `overtime.createSelfDraft` | ✔ | ✔ own |
| edit Draft | `updateOvertimeRecord` | `overtime.updateSelfDraft` | ✔ | ✔ own+Draft |
| delete Draft | `deleteOvertimeRecord` | `overtime.deleteSelfDraft` | ✔ | ✔ own+Draft |
| Draft→Submitted | `setOvertimeStatus(id,'Submitted')` | `overtime.submitSelf` | ✔ | ✔ own+Draft |
| Submitted→Reviewed / Approved / Rejected / Committed; any other target | `setOvertimeStatus` / `worksheetSave` | `overtime.manage` | ✔ | ✘ |

**Critical:** the **generic** `setOvertimeStatus(id, status)` must not authorize an employee for any target
just because `submitSelf` exists. The employee submit path must call `can('overtime.submitSelf', rec)` **and**
assert `status==='Submitted'` transition from a Draft; every other target requires `can('overtime.manage', rec)`.
`worksheetSave` (bulk approve) is `overtime.manage` per row.

## 14. CEO zero-regression requirement

For every boundary the plan proves the valid CEO flow stays allowed: CEO is `POLICY` pass-through, so each
`can(...)` returns true (subject to AZ-1 scope, where CEO ALL_COMPANY ⇒ any canonical record is in scope).
Collection/system actions (`import.commit`, `settings.manage`, destructive reset, `payroll.generate` with no
single record) call `can(action)` **without** a resource — verified so no accidental false denial. C2 must
not alter Executive flows.

## 15. Employee deny-by-default matrix

| Domain | Employee |
|---|---|
| Employee create/update/delete/toggle | **deny** (Q-SELF-EDIT denied) |
| Contract create/update/delete | **deny** |
| Payroll generate/override/transition/commit/post/lock/prepare | **deny** |
| Finance execute | **deny** |
| Import commit | **deny** |
| Supplemental create/refresh/post/execute/account | **deny** |
| Settings save / destructive reset / bank-account status | **deny** |
| Overtime review/approve/reject/commit / bulk | **deny** (`overtime.manage`) |
| Overtime own Draft create/edit/delete/submit | **allow** (own + Draft only) |
| Export | **deny** (Q-EXPORT) |

SELF visibility (UX-006B scope) never implies mutation permission.

## 16–17. Persistence proof & audit-on-denial

Every mutation maps to its `persist*` (§2). C2 tests prove denial occurs **before** persist and audit
(spy/counter = 0). **No new denial-audit system in C2** (default: no audit on denial). Security telemetry is
out of scope.

## 18. Persistence-placement recommendation

Enforce at the **domain mutation function/handler**, which knows action + canonical resource. **Do not** put
`can(...)` in generic `persist*` helpers or `StorageAdapter`/`localStorage` — storage stays
authorization-unaware. (A generic persist gate cannot express per-action/per-resource policy and would be a
bypass-prone false sense of safety.)

## 19. Bypass analysis (summary)

See §4. Each domain's enforcement is centralized at its lowest domain-specific boundary that knows
action/resource; `worksheetSave` and the settings reset get their **own** explicit gates; `setOvertimeStatus`
is split by transition.

## 20–22. UI / Action Center / Data Grid / Global Search

C2 is **enforcement, not presentation**. UI may still *display* actions that will be denied (acceptable
interim; the boundary blocks them). Action availability/hiding is **UX-006C3 / UX-006D**. **`data-grid.js`
unchanged (DG 36); `global-search.js`/`global-search-ui.js` unchanged (GS 26); GS scope wiring stays
UX-006D.**

## 23. Storage / schema decision

**No new persistence, no role/permission store, no migration; `SCHEMA_VERSION` stays 6.** If any boundary's
enforcement is found to *require* a schema/storage change, that is a **STOP CONDITION** (§34).

## 24. Decomposition — three staged PRs (do not ship one giant PR)

| Stage | Scope | Boundaries | New ACTIONS |
|---|---|---|---|
| **C2A — Core HR** | Employee + Contract mutations | employee create/update/delete/toggle; contract create/update/delete | none |
| **C2B — Overtime** | self-service + company management + bulk | createSelfDraft/updateSelfDraft/deleteSelfDraft/submitSelf; setOvertimeStatus split; `worksheetSave`; duplicate | **3 new** (`overtime.createSelfDraft/updateSelfDraft/deleteSelfDraft`, §5/§25) |
| **C2C — Operational** | Payroll, Finance, Import, Supplemental, Settings, bank, reset | all remaining company-only boundaries | none |

Dependencies: C2A independent; C2B depends on the §25 ACTIONS amendment (own PR step 2); C2C independent of
A/B. Each stage is a separate reviewed PR with its own harness + verifier guards. This assignment authorizes
only the **plan**; C2A is the recommended first implementation step.

## 25. New-ACTIONS change control (C2B)

Adding the three `overtime.*SelfDraft` actions amends the frozen C1 vocabulary and is a **reviewed C2B plan
step**, not an ad-hoc edit. The C2B PR must: add exact strings to `ACTIONS`; add `POLICY` predicates
(employee ⇒ own + `status==='Draft'`; CEO ⇒ pass-through); map each to entity `overtime` and resource-bearing
(create uses the candidate record); extend the authz harness with allow/deny + SE-0 cases; update verifier
ACTIONS-count guard (13 → 16).

## 26. Test architecture (side-effect isolation, not just return values)

Per staged mutation family: **CEO allow** (mutation + expected persist + expected audit occur); **Employee
deny** (return = failure; State deep-equal unchanged; persist spy = 0; audit spy = 0; downstream spy = 0);
**Employee allowed overtime** (only the legal own-Draft op mutates; other employee's record unchanged);
**scope failure** (missing linkage / other-employee resource ⇒ no mutation); **ownership-change** (edit
reassigning `employeeId` ⇒ denied, no mutation).

## 27. Denial test pattern (reusable)

```
snapshot = deepClone(relevant State) ; persistSpy=0 ; auditSpy=0
invoke denied mutation
assert deepEqual(State, snapshot)      // no state change
assert persistSpy === 0               // no persistence
assert auditSpy === 0                 // no audit
assert no success toast / no derived recompute
```

Implemented in the `vm` harness by wrapping `persist*` / `logActivity` with counters (same loader as the
existing runtime harnesses) — not via UI observation.

## 28. Harness strategy

**Keep the C1 authz harness frozen at 68.** Add **one dedicated mutation-enforcement harness per stage**
(`verify-mutation-enforcement-hr-runtime.js`, `…-overtime-runtime.js`, `…-ops-runtime.js`) so policy vs.
enforcement regressions stay separable. Report counts at implementation.

## 29. Verifier strategy (per stage, additive)

Guards: each target mutation module calls `can(` with the mapped action; the `can(` call appears **before**
the module's `persist*`/`logActivity`/`State.<collection>` write where statically detectable (ordering
proof); **no** `canPrincipal`/`POLICY`/`isInScope*` use in feature modules; **no** scattered `principalType
===`; **no** `*.read` action; enforcement not UI-only (the check is in the domain function, not only an event
handler); no storage/schema change; `global-search.js`/`data-grid.js` digests unchanged; C1 public API
(`ACTIONS`+`can`) frozen. Avoid brittle whole-function hashing except for frozen surfaces.

## 30. Failure semantics

Standardize the denied result as the existing per-function convention (most return `undefined`/`void` and
already early-return on validation failures — the `can(...)` guard slots in beside those). Do **not** change a
function's return type merely to standardize; document the denied result per boundary.

## 31. Exact file plan (per stage)

- **C2A:** `js/people/employees.js` (create/update handler + `deleteEmployee` + `toggleEmployeeActive`),
  `js/people/contracts.js` (save handler + `deleteContract`); `tools/verify-mutation-enforcement-hr-runtime.js`
  (new); `tools/verify-build.js` (guards); rebuilt `dist`; docs.
- **C2B:** `js/core/authz.js` (3 new ACTIONS + POLICY predicates), `js/people/overtime.js` (add/update/delete/
  submit/`setOvertimeStatus` split/`worksheetSave`/duplicate); harness + verifier; rebuilt `dist`; docs.
- **C2C:** `js/people/payroll-ops-engine.js`, `js/finance/execution-center.js`, `js/import/smart-import-commit.js`,
  `js/people/supplemental-engine.js`, `js/ui/settings-about.js` (saveSettings + reset + bank status); harness +
  verifier; rebuilt `dist`; docs.
- **Must NOT change (all stages):** identity/workspace/authz public contracts, `global-search*.js`,
  `data-grid.js`, `state.js` shape, `constants.js` (`SCHEMA_VERSION`), storage/migration, `app-bootstrap.js`,
  CSS. No `can(...)` in `persist*`/`StorageAdapter`.

## 32. Implementation order (per stage)

1. verifier baseline; 2. (C2B only) ACTIONS amendment; 3. write the mutation-enforcement harness + fixtures
first (fail-first); 4. insert `can(...)` at the mapped boundary(ies); 5. prove SE-0 (snapshot/spies);
6. full regression (identity 33/workspace 31/authz 68/GS 26/DG 36 + existing suites); 7. deterministic build
×2; 8. browser smoke (CEO flow works; employee denied silently, no toast); 9. docs (candidate); 10. PR.

## 33. Acceptance criteria (C2 overall)

All real mutation boundaries in §2 covered; CEO zero regression; Employee denied except approved Overtime
self-service (own Draft create/edit/delete/submit); **denied ⇒ SE-0** (no State/persist/audit/downstream);
scope failures deny; ownership-change denied; no scattered role checks; no direct internal-policy access; no
`*.read`; UI not relied on for protection; no persistence/schema/migration; GS/DG frozen; all harnesses green;
deterministic dev build; published v2.9.0 immutable.

## 34. Stop conditions (implementation)

Halt and escalate if: a mutation cannot be guarded before its first side effect; enforcement requires an
authz redesign or direct `canPrincipal` exposure; identity/workspace contracts need material change; employee
enforcement needs a field-level permission system beyond immutable-`employeeId`; a schema/migration or
storage-level gate becomes necessary; GS/DG **engine** must change; a broad UI rewrite is forced; a legacy
CEO workflow cannot stay compatible; overtime ownership can change unsafely during an employee edit; or a
denial cannot guarantee no persistence/audit side effect.

## 35. Confirmation — no implementation performed

Documentation-only. No `js/*`, CSS, harness, verifier, storage, schema, `dist/*`, or version change; no
`can(...)` inserted at any mutation boundary; no new ACTIONS added. `APP_VERSION` 2.9.0; `SCHEMA_VERSION` 6;
verifier 2097; authz 68 / workspace 31 / identity 33 / GS 26 / DG 36; dev artifact `aac5d9d9…`; published
v2.9.0 immutable.

## 36. Recommendation

**GO for staged UX-006C2 implementation, beginning with C2A (Core HR).** The mutation surface is fully
inventoried and bypass-mapped; enforcement is placed at domain boundaries (never storage); the SE-0 denial
contract is precise and test-provable via snapshot/spy; CEO flows are pass-through (zero regression); Q-OT is
handled by three narrow new employee-self actions (reviewed amendment in C2B); no persistence/schema change;
GS/DG frozen. Land **C2A → C2B → C2C** as separate reviewed PRs. Per-stage GO: **C2A GO**, **C2B GO after the
ACTIONS amendment is approved in its own PR step**, **C2C GO**.
