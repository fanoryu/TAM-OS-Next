# UX-006C — Authorization: Discovery & Implementation Plan

**STATUS: DISCOVERY / IMPLEMENTATION PLAN — NOT IMPLEMENTED.** No production code is authorized by this
document. It converts the frozen UX-006 baseline and the merged, frozen UX-006A (identity) and UX-006B
(Personal Workspace & SELF-scope) into an exact execution contract for **UX-006C — Authorization**: *which
actions a principal may perform on records already in scope*. Implementation begins only under a separate,
owner-authorized assignment. Authorization is kept **strictly separate** from record scope: UX-006B answers
*which records are in context*; UX-006C answers *which actions are allowed on them*.

**Rev. 2 (boundary refinements):** the action vocabulary is **mutation/action-only** — **all `*.read` /
`*.read.self` actions are removed** because visibility is owned by UX-006B scope (§4, §6, §7). The
single-record scope predicate `isInScope` is an **internal lexical helper** in `workspace.js` (not on
`window`, not a fourth public API, authz-only consumer, backed by `ENTITY_SCOPE`) (§10). CEO and Employee
matrices now separate **visibility (scope)** from **capability (authz)** (§5, §6). `overtime.submitSelf` is
scoped to the own Draft→Submitted transition only; Q-OT/Q-EXPORT/Q-SELF-EDIT remain unresolved and gate
UX-006C2 (§4.1, §26).

---

## 0. Baseline (verified)

| Fact | Value |
|---|---|
| main | `b20e865affd93fa8f5ccc19fcf5a8ba777ff47b6` (clean) |
| Frozen | UX-006A identity (`73096303`), UX-006B workspace/scope (`f40fc064`) |
| APP_VERSION / SCHEMA_VERSION | `2.9.0` / **6** |
| Verifier | **2058 PASS** · runtime **1616 / 20** (identity **33**, workspace **31**) |
| Global Search / Data Grid | **26 / 36** |
| Dev artifact | `dist/tam-os-v2.9.0.html` — 1,066,037 B — `2621a69f…` |
| Published v2.9.0 (immutable) | tag → `598edef0`; asset 1,049,018 B — `e7470ff5…` |

This plan adds only documentation; it changes none of the above.

---

## 1. Source files inspected (evidence base)

- **Mutation entry points (11 `persist*`):** `persistEmployees`, `persistContracts`, `persistPayrollPlans`,
  `persistPayrollAdjustments`, `persistOvertime`, `persistRecurring`, `persistMonthlyPlans`,
  `persistCompanyAccounts`, `persistEmployeeMerges`, `persistSupplementalPayments`, `persistHR`.
- **Audit vocabulary (grounded action names, from `logActivity({type:…})`):** `employee.delete`,
  `contract.delete`, `payroll.generate`, `payroll.post`, `payroll.override`, `finance.execute`,
  `import.commit`, `supplemental.create/post/execute/refresh/recover`, `bankaccount.status`.
- **Overtime model (`js/people/overtime.js`):** state machine `OVERTIME_STATUSES = ['Draft','Submitted',
  'Reviewed','Approved','Rejected','Committed to Payroll']`; mutations `addOvertimeRecord`,
  `updateOvertimeRecord`, `setOvertimeStatus(id,status)`, `duplicateOvertimeRecord`, `deleteOvertimeRecord`;
  each overtime row carries `employeeId === Employee.id`.
- **Identity (frozen):** `getCurrentUser() → User|null`, `PRINCIPAL_TYPES = {ceo, employee}`.
- **Workspace/scope (frozen):** `getCurrentWorkspace()`, `getScopedRecords(entityType)`, internal
  `ENTITY_SCOPE` registry (employee→`r.id`, contract/payroll/overtime→`r.employeeId`).
- **No authorization today:** `js/core/authz.js` absent; **no scattered `principalType===`/`role===`
  checks** in production (only `identity.js`/`workspace.js` legitimately read `principalType`). Settings
  writes via `saveSettings()`; destructive reset in `settings-about.js`.
- **Single-operator reality:** `getCurrentUser()` is `null` by default (no selector until UX-006D); today's
  app is CEO-equivalent operator. **No employee-facing mutation UI exists yet.**

---

## 2. Principal / role model — **`principalType` is sufficient; no separate role object**

The policy subject is the existing `principalType` (`ceo` | `employee`). Evidence: exactly two access models
ship in v3.0.0 (frozen Q2), the audit/mutation surface has no admin/member/viewer distinction, and no
product requirement introduces one. **Do not add generic owner/admin/member/viewer RBAC** — it would be
speculative and is a stop condition if it appears necessary. (A future `role` claim can map onto
`principalType` behind the same policy API without call-site change.)

---

## 3. Scope vs authorization (the central separation)

| Question | Owner | Mechanism |
|---|---|---|
| *Which records are in this principal's context?* | **UX-006B (scope)** | `getScopedRecords`, `ENTITY_SCOPE` |
| *Which actions may this principal perform on them?* | **UX-006C (authz)** | `can(action, resource?)` |

**Invariant AZ-1:** an action is permitted only if (a) the policy allows the `(principal, action)` pair AND
(b) the target resource is within the principal's scope. Authorization never widens scope; scope never
authorizes an action. Read visibility stays a **scope** concern (§7); UX-006C governs **mutations/actions**.

---

## 4. Action vocabulary — **mutation/action-only** (reads are scope, not authz)

**Refined:** the vocabulary contains **no `*.read` / `*.read.self` actions**. Read visibility is owned
entirely by UX-006B scope (`getScopedRecords`); authorization governs only **operations that change state or
perform a company action**. Minting read permissions would duplicate SELF logic and blur the AZ-1 separation.
Derived from the real mutation surface (§1), consolidated to `entity.verb` (coarse where the app treats
operations as one workflow, e.g. `payroll.manage` = generate/post/override/commit).

| Action (mutation/operation only) | Meaning (grounded) | Resource | CEO | Employee |
|---|---|---|---|---|
| `employee.create` | add employee | employee | ✔ | ✘ |
| `employee.update` | edit employee | employee | ✔ | ✘ (incl. own record in 006C) |
| `employee.delete` | delete employee (`employee.delete`) | employee | ✔ | ✘ |
| `contract.create` | add contract | contract | ✔ | ✘ |
| `contract.update` | edit contract | contract | ✔ | ✘ |
| `contract.delete` | delete contract (`contract.delete`) | contract | ✔ | ✘ |
| `payroll.manage` | generate/post/override/commit (`payroll.*`) | payrollPlan | ✔ | ✘ |
| `overtime.submitSelf` | transition **own Draft → Submitted** | overtime | ✔ (n/a) | ✔ **the one approved employee mutation** |
| `overtime.manage` | create/edit/approve/reject/delete/commit | overtime | ✔ | ✘ |
| `finance.execute` | execute a transaction (`finance.execute`) | txn | ✔ | ✘ |
| `import.commit` | commit an import (`import.commit`) | system | ✔ | ✘ |
| `supplemental.manage` | supplemental payroll ops (`supplemental.*`) | payrollPlan | ✔ | ✘ |
| `settings.manage` | edit settings / destructive reset | system | ✔ | ✘ |

**No read actions exist in this vocabulary.** Employee is **deny-by-default** for every action above; the
**only** `true` employee entry is `overtime.submitSelf`. CEO is a pass-through for all (§5). Reads for both
principals are resolved by scope (§6/§7), never by `can(...)`.

### 4.1 `overtime.submitSelf` semantics (and what it does NOT settle)

`overtime.submitSelf` authorizes exactly one thing: an **employee performing the own-record Draft →
Submitted transition** (an in-scope overtime record with `record.employeeId === currentUser.employeeId` and
current status `Draft`). It deliberately **does NOT settle** — these remain **Q-OT** product decisions for
UX-006C2:
- who creates the Draft, and whether an employee may **create** a Draft;
- whether an employee may **edit** a Draft before submission;
- whether an employee may **delete** a Draft;
- resubmission behavior for a **Rejected** item.

**UX-006C1** may implement and test the `overtime.submitSelf` *policy rule* against a **fabricated/in-memory
own Draft** resource (headless — no live mutation wiring). **UX-006C2 must not wire the corresponding
mutation boundary until Q-OT is resolved.**

---

## 5. CEO — visibility vs. capability

- **Visibility (scope, UX-006B):** CEO → Executive / `ALL_COMPANY` → sees every record via
  `getScopedRecords`. This is **not** an authz permission.
- **Capability (authz, UX-006C):** every action in §4 is `true` for `ceo` (subject to unchanged business
  validators). The CEO policy branch is a **pass-through**, so introducing gates causes **zero** regression
  to today's operator flows.

## 6. Employee — visibility vs. capability (deny-by-default)

**Visibility / scope (UX-006B — not authorization):**

| Records visible | Mechanism |
|---|---|
| own Employee record | `getScopedRecords('employee')` (SELF: `record.id === user.employeeId`) |
| own Contract / Payroll / Overtime | `getScopedRecords('contract'|'payrollPlan'|'overtime')` (SELF: `record.employeeId === user.employeeId`) |

These are **scope behavior**, subject to the frozen SELF scope — never expressed as a `can(...)` permission.

**Authorized mutations (UX-006C — deny-by-default):**

| Operation | Decision | Basis |
|---|---|---|
| `overtime.submitSelf` (own Draft → Submitted) | **allow** | frozen approved self-service |
| every other action in §4 (employee/contract/payroll/overtime.manage/finance/import/supplemental/settings) | **deny** | company-owned / reviewer authority = CEO |
| create / edit / delete own Overtime Draft | **deny in 006C1** (product decision to widen) | frozen intent authorizes *submit* only — **Q-OT** |
| export own data | **deny** (defer) | data-minimization — **Q-EXPORT** |
| edit own Employee contact fields | **deny** (read-only) | frozen "read-oriented" — **Q-SELF-EDIT** |

## 7. Read authorization — **none (scope owns all reads)**

UX-006C mints **no** read permissions for either principal. Employee read-set = `getScopedRecords` (SELF);
CEO read-set = `getScopedRecords` (`ALL_COMPANY`). There are **no** `*.read`/`*.read.self` actions in the
vocabulary (§4) — visibility is a scope question (UX-006B), operations are an authz question (UX-006C). This
keeps SELF logic in exactly one place (`ENTITY_SCOPE`) and preserves AZ-1 mechanically.

---

## 8. Policy API — pure core + thin current-context façade

- **Pure (testable, no DOM, backend-swappable):**
  `canPrincipal(principal, action, resource, ctx) → boolean`, where `ctx` may carry the resolved workspace/
  scope predicate. Deterministic; the unit under test.
- **Convenience façade (app call sites):** `can(action, resource?) → boolean`, which resolves
  `principal = getCurrentUser()` and workspace/scope internally and delegates to `canPrincipal`.
- **Signature decisions:** `resource` is **optional** (system/collection actions omit it); when present it is
  the **record object** (not a UI shape, not just an id) plus its entity type (either `{entityType, record}`
  or the record with a known type at the call site). Policy does **not** read the DOM.
- **Return/error:** returns strict `boolean`; unknown/covered-below states return **`false`** (fail closed,
  §12); never throws for an ordinary deny.

**Decision:** implement **both** (pure + façade) — the split is cheap, sharply improves testability, and
matches the frozen UX-006A/UX-006B seam style. Not over-engineered: one predicate registry, two entry points.

## 9. Resource model

`resource` is the **domain record** tagged by entity type: `employee | contract | payrollPlan | overtime |
txn | system`. Collection/system actions (`import.commit`, `settings.manage`) take **no** resource.
Authorization consumes the same record shapes the business modules already hold — no UI-specific descriptors.

## 10. Scope precondition (defense-in-depth, no duplicated SELF logic)

For any resource-bearing action, `canPrincipal` first requires the resource to be **in scope** for the
principal, reusing the **UX-006B scope predicate** (the internal `ENTITY_SCOPE` self-relation / a small
exported scope-check helper) — it does **not** re-implement `record.employeeId === …`. Then it evaluates the
action policy. So an out-of-scope resource is denied even if the action category is otherwise allowed
(Invariant AZ-1). This is the mutation-safety backstop behind UI hiding.

> Implementation note: UX-006B exposes `getScopedRecords` (collection) but not a single-record scope check.
> UX-006C needs a tiny in-scope predicate `isInScope(entityType, record)`. It is **added to `workspace.js`
> and backed by the existing centralized `ENTITY_SCOPE` knowledge** (it reuses the same self-relation, never
> a duplicated `record.employeeId === …`). **Hard constraints — `isInScope` MUST:**
> - remain an **internal lexical `const`** (function expression), **not** attached to `window`
>   (`window.isInScope === undefined`), following the UX-006A/UX-006B internal-helper pattern;
> - **not** become a fourth stable Workspace consumer API — the frozen public Workspace API stays exactly
>   `WORKSPACE_TYPES`, `getCurrentWorkspace`, `getScopedRecords`;
> - **not** be consumed by any UI/business module — only the centralized authz boundary uses it;
> - be reached by tests via the harness `window.__TAM__` export (same lexical scope).
>
> This is the **only** touch of the frozen `workspace.js` in UX-006C and must be called out explicitly in the
> implementation PR. The verifier proves it stays non-public (§21).

## 11. Mutation enforcement (UI hiding is NOT authorization)

Enforcement belongs at the **mutation boundary**, not only event handlers. Grounded target boundaries:

| Boundary (grounded) | Action | Failure |
|---|---|---|
| employee create/update / `deleteEmployee` | `employee.*` | no-op + denial signal; no persist |
| contract save / `deleteContract` | `contract.*` | no-op; no persist |
| payroll generate/post/override/commit | `payroll.manage` | no-op; no persist |
| overtime `setOvertimeStatus`/`add`/`update`/`delete` | `overtime.submitSelf` (employee) / `overtime.manage` (CEO) | no-op; no persist |
| `finance.execute` (transaction execution) | `finance.execute` | no-op; no persist |
| import commit | `import.commit` | no-op; no persist |
| `saveSettings` / destructive reset | `settings.manage` | no-op; no persist |

Because today every operator is CEO-equivalent (no employee selector until UX-006D), **wiring enforcement is
low-risk** (CEO passes all gates → no behavior change) — but it touches many business modules, which drives
the staged decomposition (§20). UI availability (§14) **mirrors** policy for UX, but the boundary check is
authoritative.

## 12. Fail-closed matrix (never fall back to CEO)

| Condition | `can(...)` |
|---|---|
| no `currentUser` | **false** |
| unknown `principalType` | **false** |
| null / unknown action | **false** |
| resource required but missing/malformed | **false** |
| resource out of scope | **false** |
| employee missing linkage | **false** |
| unsupported (entity, action) pair | **false** |
| policy exception thrown internally | **false** |

**Invariant AZ-2:** unknown/indeterminate authorization state **denies**, and never yields CEO/company
capability.

## 13. Backend compatibility

`canPrincipal`/`can` are interfaces; the client policy table is a UX-enforcement implementation. A future
backend authorization service implements the same signature and becomes authoritative with **no call-site
change**. Document in-source: *client policy is UX enforcement only; server authorization is the future
security boundary; client checks are spoofable.* No UI couples directly to hardcoded role literals (§18).

## 14. Navigation / Action Center / Data Grid / Global Search implications

- **Action Center / navigation:** unauthorized actions should be **absent** for the principal (preferred) or
  disabled; either way the **mutation boundary still enforces** (§11). Presentation wiring is **UX-006D**;
  UX-006C defines the semantics/mapping only.
- **Data Grid:** stays generic; **row/bulk action eligibility** is computed by callers via `can(...)` and
  passed in (mixed-eligibility resolves per-row). `data-grid.js` untouched; **DG 36**.
- **Global Search:** unchanged in UX-006C; result **visibility** is scope (UX-006B/D), and action affordances
  from results are UX-006D. **No GS engine change; GS 26.**

## 15. Storage / schema — **none**

No authz/role persistence, no new `tam_*` key, no migration. Policy is **derived** from `principalType` +
scope. `SCHEMA_VERSION` stays **6**. (A future persisted policy/role store is out of scope and a stop
condition.)

## 16. No scattered role checks (verifier-enforced)

All permission decisions flow through `authz.js`. A verifier guard bans permission-style `principalType ===
'ceo'` / `=== 'employee'` comparisons **outside** the allowed modules. **Allowed locations:**
`js/core/identity.js` (defines/classifies), `js/core/workspace.js` (derives workspace/scope by principal
type — legitimate, frozen), and `js/core/authz.js` (the policy home). Any new such check elsewhere fails the
guard. The guard targets permission logic, not identity/workspace derivation.

## 17. Policy representation — **action → predicate registry (table)**

Chosen: a centralized frozen `POLICY`/`ACTIONS` registry mapping each action to a small predicate over
`(principal, resource, ctx)`, mirroring the UX-006B `ENTITY_SCOPE` precedent. Rejected: scattered `switch`
in call sites (A) — un-auditable; ad-hoc `if role` (D) — the anti-pattern §16 bans. A table is auditable,
unit-testable, verifier-enforceable, and extensible. Employee predicates are explicit and narrow
(`overtime.submitSelf` only); CEO is a pass-through.

## 18. Public API plan (minimized, three tiers)

- **Stable consumer API:** `ACTIONS` (frozen action constants), `can(action, resource?)`.
- **Pure/internal:** `canPrincipal(principal, action, resource, ctx)`, the `POLICY` predicate registry.
- **Do NOT expose** resource-specific helpers (`canEditEmployee`, `canDeleteContract`, …). Callers use
  `can('employee.update', rec)`. Tests reach internals via the harness `window.__TAM__` export (same lexical
  scope), mirroring UX-006A/UX-006B; internal helpers are lexical `const`s (not attached to `window`).

## 19. Exact file plan (proposed; implementation assignment only)

| File | Category | Purpose |
|---|---|---|
| `js/core/authz.js` | **new source** | `ACTIONS`, `POLICY` registry, `canPrincipal`, `can` façade |
| `js/core/workspace.js` | **modified (flagged, minimal)** | add **internal lexical `const`** `isInScope(entityType, record)` backed by `ENTITY_SCOPE` (§10) — not on `window`, not a 4th public API, authz-only consumer |
| `tools/module-order.js` | build manifest | register `core/authz.js` after `core/workspace.js` |
| `index.html` | index integration | mirror manifest |
| `tools/verify-authz-runtime.js` | **new harness** | policy behaviour proof (vm loader) |
| `tools/verify-build.js` | verifier | additive guards (§21) |
| `dist/tam-os-v2.9.0.html` | generated | rebuilt deterministically |
| `AI_CONTEXT.md` / `ARCHITECTURE.md` | docs | record 006C |
| business mutation modules (006C2 only) | **modified, staged** | insert `can(...)` at mutation boundaries (§11) |

**Must NOT change (006C1):** identity contract, `getCurrentUser`, workspace public API (beyond the flagged
`isInScope`), `global-search*.js`, `data-grid.js`, `state.js`, `constants.js` (`SCHEMA_VERSION`), storage/
migration, `app-bootstrap.js`, CSS.

## 20. Recommended decomposition — **stage it (mutation surface is broad)**

| Sub-phase | Scope | Touches | Risk |
|---|---|---|---|
| **UX-006C1 — Authorization Foundation** | `ACTIONS`, `POLICY`, `canPrincipal`, `can`, `isInScope`, harness, verifier — **no live mutation wiring** | new `authz.js` (+ flagged `workspace.js` predicate) | low; headless, matches 006A/006B |
| **UX-006C2 — Mutation Enforcement** | wire `can(...)` into the §11 boundaries — **gated on owner decisions Q-OT / Q-EXPORT / Q-SELF-EDIT where applicable** | many business modules | medium (broad surface; CEO passes all → no behavior change) |
| **UX-006C3 — Integration Freeze** | Action Center / navigation / action-availability semantics, regression, freeze | shell/nav (authorized) | overlaps UX-006D presentation |

**Recommendation:** land **UX-006C1** first as a headless foundation PR (like UX-006A/UX-006B); do **not**
force one giant PR. 006C2 is a separate reviewed PR (or a few grouped by domain); 006C3 coordinates with
UX-006D. This plan authorizes only the **006C1** design as the immediate next implementation step.

## 21. Verifier plan (additive; 006C1)

authz module present + registered (manifest/index); minimal public API (`ACTIONS` + `can`; **no**
`canEdit*`/`canDelete*`/`canPrincipal` public helpers on `window`); explicit `ACTIONS` vocabulary present;
**no `*.read`/`*.read.self` action** anywhere in `authz.js` (reads are scope — mechanical AZ-1 guard);
centralized `POLICY` registry (no scattered permission `principalType===` outside identity/workspace/authz);
**`isInScope` stays internal** — `window.isInScope === undefined` and no non-authz module references it;
**no duplicated SELF comparison** (`record.employeeId ===`/`record.id ===`) in `authz.js` (it delegates to
the scope predicate); **no** authz storage (`tam_*`/StorageAdapter/localStorage) and **no** schema change
(`SCHEMA_VERSION` 6); **no** real-auth vocabulary (`password|token|oauth|session|authenticate`); scope-
precondition present (policy consults the scope predicate); trust-boundary statement in-source; frozen-surface
preservation (`global-search.js`/`data-grid.js` digests; identity/workspace public APIs unchanged — Workspace
public API still exactly the three symbols); release/artifact integrity. Avoid syntax-fragile checks.

## 22. Test plan (006C1 harness `verify-authz-runtime.js`)

**CEO:** allowed for representative company actions (`employee.update`, `contract.delete`, `payroll.manage`,
`overtime.manage`, `finance.execute`, `settings.manage`). **Employee:** denied all company mutations;
**allowed `overtime.submitSelf` on an in-scope own Draft** (tested against a fabricated in-memory own Draft,
§4.1); denied `overtime.manage`/approve/reject; denied mutation on another employee's record. **No read
actions:** assert the `ACTIONS`/`POLICY` set contains no `*.read` key (reads are scope). **Scope+policy:**
out-of-scope resource denied even for an otherwise-allowed action; employee with missing linkage denied.
**Fail-closed:** no-user deny; unknown/null action deny; missing/malformed required resource deny; unknown
principal deny. **Separation & non-public internals:** `authz.js` exposes no scope enumeration and
`workspace.js` no policy; `window.isInScope === undefined`; `window.canPrincipal === undefined`.
**Preservation:** identity **33**, workspace **31**, GS **26**, DG **36** unchanged; Workspace public API
still exactly three symbols. One dedicated harness; report the actual count at implementation.

## 23. Implementation order (006C1)

1. `ACTIONS` constants (frozen). 2. `isInScope` scope predicate in `workspace.js` (flagged). 3. `POLICY`
registry (CEO pass-through; employee `overtime.submitSelf` only; deny default). 4. `canPrincipal` (scope
precondition → policy). 5. `can` façade (resolve current principal). 6. Register in manifest + index.
7. Harness. 8. Verifier guards. 9. Build twice (byte-identical); full regression (identity 33/workspace
31/GS 26/DG 36); browser smoke. 10. Docs (candidate). 11. Open PR. Checkpoint after each step.

## 24. Acceptance criteria (006C1)

Centralized policy exists (`can`/`canPrincipal`/`POLICY`); **mutation-only vocabulary — no `*.read` action**;
Employee minimal privilege (only `overtime.submitSelf`; deny default); reads governed by scope, not authz;
CEO current functionality preserved (pass-through; no regression); enforcement is **not UI-only** (design
provides a boundary check; 006C2 wires it); out-of-scope resources denied (AZ-1); unknown states deny (AZ-2);
no scattered role checks (verifier); **`isInScope` non-public** (`window.isInScope === undefined`) and
Workspace public API still exactly `WORKSPACE_TYPES`/`getCurrentWorkspace`/`getScopedRecords`; no
persistence/schema change; no real-auth claims; `global-search.js`/`data-grid.js` byte-identical (GS 26 / DG
36); all harnesses green + new authz harness green; deterministic build; published v2.9.0 immutable.

## 25. Stop conditions (implementation)

Halt and escalate if: policy needs an identity/workspace **contract** change (beyond the flagged internal
`isInScope`); authz requires **persisted roles** or a schema bump; real backend auth becomes required; a
broad UI refactor is forced; Global Search or Data Grid **engine** must change; employee overtime semantics
cannot be derived from the existing state machine (widening beyond `submitSelf` — product decision **Q-OT**);
the mutation surface cannot be centralized without architecture change; or scope and authorization cannot
remain separated.

## 26. Open product decisions (flagged, non-blocking for 006C1)

- **Q-OT:** may an employee **create/edit/delete their own Draft** overtime (not just submit)? 006C1 assumes
  **submit-only**; widening is a product decision for 006C2/UX-006D.
- **Q-EXPORT:** may an employee export their own data? 006C default **deny**.
- **Q-SELF-EDIT:** may an employee edit their own Employee contact fields? 006C default **deny** (read-only).

None blocks the 006C1 foundation; each is a §25 stop condition if forced earlier.

## 27. Confirmation — no implementation performed

Documentation-only. No `js/*`, CSS, harness, verifier, storage, schema, `dist/*`, or version change; no
`authz.js`, `can(...)`, policy, or mutation-boundary edit. `APP_VERSION` 2.9.0; `SCHEMA_VERSION` 6; verifier
2058; identity 33 / workspace 31 / GS 26 / DG 36; dev artifact `2621a69f…`; published v2.9.0 immutable.

## 28. Recommendation

**GO for UX-006C1 (Authorization Foundation) implementation** under a separate owner-authorized assignment.
The design is source-grounded and minimal: `principalType` is the policy subject (no RBAC); a centralized
`ACTIONS` + `POLICY` table with `can`/`canPrincipal`; **scope and authorization stay separate** (AZ-1) with a
defense-in-depth scope precondition reusing the frozen scope predicate; Employee is deny-by-default with the
single approved `overtime.submitSelf`; CEO behavior is preserved (pass-through, no regression); no
persistence, no schema change, no real auth, no GS/DG engine change. The broad mutation surface is handled by
staging enforcement into **UX-006C2**, and Action Center/navigation availability into **UX-006C3/UX-006D**.
Three product questions (Q-OT/Q-EXPORT/Q-SELF-EDIT) are flagged but do not block the 006C1 foundation.
