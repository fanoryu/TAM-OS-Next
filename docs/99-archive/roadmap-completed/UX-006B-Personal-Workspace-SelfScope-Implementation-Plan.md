# UX-006B — Personal Workspace & SELF-Scope: Discovery & Implementation Plan

**STATUS: DISCOVERY / IMPLEMENTATION PLAN — NOT IMPLEMENTED.** No production code is authorized by this
document. It converts the frozen UX-006 architecture baseline
([`UX-006-Identity-Personal-Workspace-Architecture.md`](UX-006-Identity-Personal-Workspace-Architecture.md))
and the merged, frozen UX-006A Identity Foundation
([`UX-006A-Identity-Foundation-Implementation-Plan.md`](UX-006A-Identity-Foundation-Implementation-Plan.md),
merge `73096303`) into an exact execution contract for **UX-006B — Personal Workspace & SELF-Scope**: the
first real identity→business-data boundary. Implementation begins only under a separate, owner-authorized
assignment. Where the baseline is silent this plan selects the smallest source-grounded option and records
the evidence.

**Rev. 2 (scoped-API final review):** after a call-site map (§13.1) showed the only live SELF consumer in
006B is Global Search, the scope layer is finalized as **Hybrid (Option C)** — a minimal public surface
(`getCurrentWorkspace`, `getScopedRecords`, `WORKSPACE_TYPES`) with **centralized internal** entity-specific
SELF predicates (`ENTITY_SCOPE`), replacing the earlier four per-entity public functions. Raw resolvers stay
unchanged/internal; no scoped-by-id lookup ships (no consumer); scope stays cleanly separable from UX-006C
authorization (§13.2).

---

## 0. Baseline (verified)

| Fact | Value |
|---|---|
| main | `5f43c87791d3d15ce2b6aebd5d2e8726a128a5ef` (== origin/main, clean) |
| UX-006A merge | `73096303062a89054f6105f955b8433689984500` (frozen) |
| APP_VERSION / SCHEMA_VERSION | `2.9.0` / **6** |
| Verifier | **2035 PASS** |
| Runtime | **1585 / 19** (identity harness **33**) |
| Global Search / Data Grid | **26 / 36** |
| Dev artifact | `dist/tam-os-v2.9.0.html` — 1,057,396 B — SHA `fe353405…` |
| Published v2.9.0 (immutable) | tag → `598edef0`; asset 1,049,018 B — SHA `e7470ff5…` |

This plan adds only documentation; it changes none of the above.

---

## 1. Source files inspected (evidence base)

- `js/core/identity.js` — UX-006A: `getCurrentUser() → User|null`, `IdentityProvider` (canonical), `User.employeeId` opaque forward reference.
- `js/people/people-core.js:288-301` — raw resolvers `empById(id)` (by `Employee.id`), `contractById`, `payrollPlanById`, and relation helpers `txnsForEmployee`, `payrollPlansForEmployee`, `overtimeForEmployeeMonth`, etc.
- `js/people/employees.js:201` — `Employee.id = uid('emp')` (set once, immutable); `:171` `Employee.employeeId = nextEmployeeCode()` (human code "EMP-001"); `:247` delete is **guarded** (only when no linked payroll/transactions).
- `js/people/contracts.js:163` — `contract.employeeId = emp.id`. `js/people/payroll-ops-engine.js:293` — `pp.employeeId = e.id`. `js/people/overtime.js:93` — `overtime.employeeId = emp.id`.
- `js/core/state.js` — one global `State`; **no** `State.identity` (UX-006A kept it provider-owned).
- `js/core/state-load-migrations.js` — `loadState()`; proven flag-guarded migration template (`tam_migrated_*`); `settings.schemaVersion = SCHEMA_VERSION`.
- `js/ui/global-search-ui.js:158-166` — the **GS scope seam**: `openGlobalSearch()` passes company-wide sources to `collectGlobalSearchDocuments()`; an in-source comment already reserves this call site for UX-006 self-scoping "without touching the engine or collector contract."
- `js/core/data-grid.js:21` — DG is source-agnostic and explicitly "knows NOTHING about Personal Workspace, permissions, currentUser"; callers pass rows to `gridApply(rows, …)`.
- `js/ui/shell-render.js:93` — single `NAV_GROUPS` manifest.
- `tools/verify-contract-core-runtime.js` — `vm`-loader harness convention; `tools/verify-build.js` — additive structural guards; `.github/workflows/ci.yml` — build+verify (harnesses not run in CI).

**Decisive finding:** across **every** business entity the stored link is `record.employeeId === Employee.id` (the opaque uid), while `Employee.employeeId` is a *separate human code*. This yields one uniform SELF relation and is the backbone of the plan.

---

## 2. Frozen UX-006A contract carried in

Canonical seam `getCurrentUser()`/`IdentityProvider.getCurrentUser()`; CEO + Employee principals;
`User.employeeId` opaque; **no `State.identity`**; no bootstrap lifecycle; no persistence; `SCHEMA_VERSION 6`;
no auth; no authorization. UX-006B must not convert SELF-scope into UX-006C authorization.

---

## 3. Employee referential binding (first critical decision)

- **Canonical Employee ID field:** `Employee.id` (`uid('emp')`), set once at creation, **immutable**, persisted in `tam_employees_v1`. `Employee.employeeId` is a human code and MUST NOT be used for linkage.
- **Recommended relation:** **`User.employeeId → Employee.id`.** Evidence: every business record already stores `record.employeeId = Employee.id`, and `empById` resolves by `Employee.id`. Binding identity to `Employee.id` makes SELF a single uniform predicate and requires **zero** business-data change.
- **Can it change?** No — `Employee.id` is never reassigned. **Deleted?** Yes, but delete is guarded to unlinked employees (`employees.js:247`); a deleted self-employee is the missing-linkage case (§6). **Duplicates?** `uid` collisions are practically impossible; `empById` returns the first — treated as a data-integrity fault, not a scope path.
- **Never bind by email/name** (mutable, non-unique).
- **Referential invariants:** (RI-1) `User.employeeId` is opaque and compared by strict equality to `Employee.id`; (RI-2) resolution is read-only — UX-006B never creates/mutates/deletes an Employee to satisfy identity; (RI-3) an unresolved link never widens scope.

---

## 4. Missing / invalid Employee linkage — behavior matrix

| Condition | Behavior |
|---|---|
| employee principal + valid Employee (`empById` hit) | Personal Workspace resolves; SELF scope active |
| employee principal + **missing** Employee (no `empById` hit) | **fail closed** — no workspace resolves; explicit "identity-unresolved / no accessible workspace" state; **never** Executive/ALL_COMPANY |
| employee principal + malformed/empty `employeeId` | rejected by UX-006A `isValidUser` already → `getCurrentUser()===null` → no workspace |
| CEO principal | Executive Workspace (ALL_COMPANY); no employee binding required |
| no `currentUser` (null) | fail closed — no workspace; no company data |
| Employee dataset not yet loaded | resolvers read `State.employees` at call time (post-`loadState`); before load, treated as missing → fail closed |
| duplicate Employee id | data-integrity fault; resolve first, surface a diagnostic; still SELF-only (no escalation) |

Rule: **invalid linkage denies Personal Workspace; it never falls back to Executive/company scope.**

---

## 5–10. Workspace domain model

### 7. `Workspace` contract (minimum)

| Field | Type | Req | Persisted/Derived | Invariant |
|---|---|---|---|---|
| `id` | string | req | **derived** (deterministic, §16) | immutable, opaque |
| `type` | `'executive' \| 'personal'` | req | derived from principal | immutable per resolution |
| `scope` | `'ALL_COMPANY' \| 'SELF'` | req | derived from `type` | `executive⇒ALL_COMPANY`, `personal⇒SELF` |
| `ownerRef` | `{ kind:'system' } \| { kind:'employee', employeeId }` | req | derived | Personal: the bound `Employee.id`; Executive: system |
| `name` | string | opt | derived (display only) | not identity; Executive = company name; Personal = employee display name |

`ownerId` from the baseline sketch is **replaced** by the structured `ownerRef` to avoid conflating company ownership with a CEO `User.id` (§10). No `members`, no `sharing` fields (frozen: non-shared).

### 8. Persisted vs derived — **DERIVED (Option A)**

| Option | Migration | Schema | Verdict |
|---|---|---|---|
| **A. Derived (chosen)** | none | 6 | smallest; workspaces are a pure function of `currentUser` + company state |
| B. Persisted records | new key + migration | →7 | unjustified now (no sharing, no per-workspace mutable metadata) |
| C. Hybrid | later | 6→7 later | deferred until sharing/persisted prefs exist |

Rationale: in the frozen model each principal has exactly one non-shared workspace fully determined by identity. Persisting it would add a storage key and a migration for **zero** additional behavior. **Do not persist because "workspace" sounds like an entity.**

### 9. Personal Workspace ownership

`ownerRef = { kind:'employee', employeeId: <Employee.id> }`. Owner is referenced by **`Employee.id`** (the linkage key), not `User.id` (the client `User` is a fixture today and will be backend-supplied later; `Employee.id` is the stable business anchor). Immutable; **exactly one** Personal Workspace per Employee (deterministic id); **not deletable, not shareable, not renameable** in v3.0.0; recreated deterministically each resolution (no stored instance to orphan). If the principal changes, a different Personal Workspace derives; if the Employee record is removed, resolution fails closed (§4).

### 10. Executive Workspace

A **deterministic system workspace**, `ownerRef = { kind:'system' }`, scope `ALL_COMPANY`. The CEO *inhabits* it but does **not own** company data as a `User`; canonical business data is **company/system-owned** (§11). This deliberately avoids coupling company-wide data ownership to one CEO `User.id`, keeping future multi-admin clean.

---

## 11. Canonical business-data ownership matrix (frozen: no re-homing)

| Entity | Canonical owner/context | CEO read | Employee read | UX-006B write | New `workspaceId` field? | Scope mechanism |
|---|---|---|---|---|---|---|
| Employee | company (Executive) | all | **self record only** (`id===user.employeeId`) | none (CEO-only, existing) | **no** | derived filter |
| Contract | company (Executive) | all | own (`employeeId===user.employeeId`) | none | **no** | derived filter |
| Payroll plan / adjustments | company (Executive) | all | own | none | **no** | derived filter |
| Overtime | company (Executive) | all | own | **none in 006B** (submit-own-overtime is 006C) | **no** | derived filter |
| Transactions (`txns`) | company (Executive) | all | none in 006B (personal txn view deferred) | none | **no** | Executive-only |
| Recurring / monthly plans / company accounts / import batches | company (Executive) | all | none | none | **no** | Executive-only |
| Audit log / backups / settings | system/company | CEO only | none | none | **no** | Executive-only |
| Workspace metadata | derived | n/a | n/a | n/a (not persisted) | n/a | derived |

**No per-record `workspaceId` is added** — SELF is derived from the existing `employeeId` relation. This preserves one canonical record per entity and requires no migration.

---

## 12. SELF Scope Matrix

SELF for an employee principal `u = getCurrentUser()` (with `eid = u.employeeId`):

| Entity | Relation path | Resolvable today? | Read | Mutation (006B) | Unresolved-relation behavior |
|---|---|---|---|---|---|
| Employee (self) | `employee.id === eid` | yes (`empById`) | self only | none | fail closed (no record) |
| Contract | `contract.employeeId === eid` | yes | own | none | empty set |
| Payroll plan | `payrollPlan.employeeId === eid` | yes (`payrollPlansForEmployee`) | own | none | empty set |
| Payroll adjustments | via `adj.employeeId === eid` | yes | own | none | empty set |
| Overtime | `overtime.employeeId === eid` | yes (`overtimeForEmployeeMonth`) | own | **none in 006B** | empty set |
| Transactions | `txn.employeeId === eid` | yes (`txnsForEmployee`) | **deferred** (personal finance view not in 006B) | none | n/a |

Every SELF relation is a strict equality against an existing field — **no fuzzy matching, no new fields**. Unresolved relations yield an **empty** result (fail closed), never a widened set.

---

## 13. Scope-resolver architecture — **Option C (minimal public query + centralized internal entity predicates)**

**Chosen after the call-site review (§13.1).** The live SELF consumer surface in UX-006B is essentially
**one** call site (Global Search, 3 entity types). Exposing 4–5 per-entity public functions for a single
consumer is premature surface area; a single blind `record.employeeId` primitive is unsafe (§3). The Hybrid
gives the smallest safe boundary:

- **Keep** raw resolvers (`empById`/`contractById`/`payrollPlanById`/relation helpers) **unchanged** —
  internal low-level primitives, still used by the Executive/company path.
- **Public boundary (narrow):** `getCurrentWorkspace()`, `WORKSPACE_TYPES`, and a single query
  `getScopedRecords(entityType)` returning the in-scope collection for the current principal.
- **Centralized internal predicates:** an `ENTITY_SCOPE` registry keyed by entity type maps each entity to
  its **entity-specific** SELF relation — `employee → r.id === eid`, `contract → r.employeeId === eid`,
  `payrollPlan → r.employeeId === eid`, `overtime → r.employeeId === eid`. The registry is the **single**
  place SELF relations live; there is **no** blind `record.employeeId` applied to arbitrary types, and a new
  entity must add an explicit predicate (a stop-and-decide point, not a silent default).
- **Internal scope context:** `getScopeContext()` derives `{ workspace, principal, employee }` once and is
  reused by `getScopedRecords`; internal (no consumer needs it directly yet).
- **CEO:** `getScopedRecords` returns the full collection (pass-through) — no filtering overhead beyond a
  principal-type branch. **Employee:** filters by the registered predicate. **No `currentUser`:** empty
  (closed). **Invalid linkage / unknown entity type:** empty (closed) — unknown type is a fault, never a
  widened set.
- **Dependency direction:** `getCurrentUser()` → `getBoundEmployee()` (`empById(eid)`) → `getCurrentWorkspace()`
  → `getScopeContext()` → `getScopedRecords()` (+ `ENTITY_SCOPE`) → feature callers. Scoped layer depends on
  raw resolvers + `State`, never the reverse.
- **Boundary discipline:** **record-scope filtering, not authorization.** No `can(...)`, `canRead/canEdit`,
  `isAuthorized`, `hasPermission`, or role vocabulary (UX-006C). Verifier-guarded (§31).

### 13.1 Call-site map (evidence)

| Dataset | Raw-resolver + direct reads (total, mostly Executive path) | **Live SELF consumers in 006B** |
|---|---|---|
| Employees (`State.employees`, `empById`) | ~72 reads | **Global Search source** |
| Contracts (`State.contracts`, `contractById`) | ~47 reads | **Global Search source** |
| Payroll plans (`State.payrollPlans`, `payrollPlanById`) | ~52 reads | **Global Search source** |
| Overtime (`State.overtimeRecords`) | ~34 reads | none live in 006B (registered predicate only) |
| Raw resolvers total | ~88 call sites | — |

The ~200+ dataset reads are the existing **CEO/company** UI and stay on the raw path unchanged. The **only**
employee-facing (SELF) consumer wired in 006B is `global-search-ui.js:160`, which needs employees/contracts/
payrollPlans. No production code consumes `getCurrentUser()` today. This is why a **single** `getScopedRecords`
query — not four public per-entity functions — is the right-sized public surface; overtime's predicate is
registered but has no live 006B caller (no speculative public API).

### 13.2 UX-006C authorization compatibility

The boundary keeps **scope** and **authorization** cleanly separable. `getScopedRecords` answers *which
records are in this principal's data scope* (a read-set question). UX-006C will add a separate policy layer
answering *which actions the principal may perform on those records* (`can(principal, action, resource)`),
in its own module. UX-006B deliberately exposes **no** action/permission vocabulary, so 006C can layer on
top without reshaping the scope API: a future authorized action first resolves its scoped record set via
`getScopedRecords`, then checks `can(...)`. The `ENTITY_SCOPE` registry (scope predicates) and the future
authz policy (action predicates) stay in different modules with different vocabularies.

---

## 14. CEO / ALL_COMPANY semantics

CEO retains existing full-company visibility. `getScopedRecords` detects `principalType==='ceo'` and returns the existing raw collections unfiltered; the Executive path may also continue calling raw resolvers directly. **No new filtering is imposed on the CEO path** where current behavior is already correct.

### 14.1 Raw resolvers & scoped-by-ID lookup (boundary)

Raw by-id resolvers (`empById`/`contractById`/`payrollPlanById`) stay **unchanged and internal** — they are
Executive/company primitives and must not be reached by an employee-facing path, because knowing an id must
not let an employee fetch another employee's record. UX-006B ships **no** scoped by-id lookup because it has
**no** employee-facing by-id consumer. If one later appears, add a narrow `getScopedRecordById(entityType, id)`
that returns the record **only** if it passes the `ENTITY_SCOPE` predicate for the current principal, else
`null` — built when a consumer exists, never speculatively.

## 15. Active workspace — **derived, no switching**

`getCurrentWorkspace()` derives the workspace purely from `getCurrentUser()` (CEO⇒Executive, Employee⇒Personal). **No** `activeWorkspace` persistence, **no** switcher UI, **no** selectable switching in 006B. CEO cannot switch to Personal; Employee cannot switch to Executive; each principal has exactly one workspace this phase. (Switching UI is UX-006D.)

## 16. Workspace ID strategy (deterministic, derived)

- Executive: a **system constant**, e.g. `workspace:executive:company`.
- Personal: **derived from the linkage key**, e.g. `workspace:personal:<Employee.id>` — deterministic, stable, no persisted random id, never a display name. Regenerating on each resolution yields the same id.

## 17. Storage impact — **NO new persistence**

UX-006B introduces **no** new `tam_*` key, **no** workspace record store, **no** migration marker. Workspaces are derived; SELF is a derived filter over existing relations.

## 18. Schema version — **remains 6**

No persisted shape changes (no per-record `workspaceId`, no workspace store, no ownership fields). Per Constitution §7.2 and the frozen schema rule, **`SCHEMA_VERSION` stays 6**. A bump to 7 is justified only when a real persisted-data migration appears (e.g., persisted workspaces or per-record ownership) — **not** in 006B under the derived design.

## 19. Legacy data migration — **none**

**UX-006B introduces no persisted-data migration.** Existing v2.9.0 business data is untouched; SELF scope is derived from existing `employeeId` relations; no records are modified, no ownership ids added, no workspaces created/persisted, no migration flag.

## 20. Bootstrap / load-order — **no `app-bootstrap.js` change**

Workspace and scope resolution are **lazy/derived**: `getCurrentWorkspace()` and the scoped resolvers read `State.employees` (and friends) **at call time**, which is after `loadState()` completes. `currentUser` remains provider-owned (UX-006A). Ordering is therefore satisfied without a bootstrap edit: `loadState()` → (identity already available, null until selected) → derive workspace/scope on demand → render. If a future phase needs eager resolution or a render-time identity gate, that is UX-006D, not here. **Prove-if-needed result: not needed.**

## 21. Global Search boundary — **engine byte-identical**

SELF filtering happens at the **existing call site** `global-search-ui.js:160` (`openGlobalSearch`). Future
call pattern: replace each `State.employees/contracts/payrollPlans` argument with
`getScopedRecords('employee'|'contract'|'payrollPlan')`, e.g.
`employees: getScopedRecords('employee')`, etc. Inputs then resolve as: CEO ⇒ full sets; Employee ⇒ SELF
subset; no-user/invalid ⇒ empty sets — all decided inside the scoped layer, so the call site carries **no**
SELF comparison itself. **`global-search.js` (engine) and the `collectGlobalSearchDocuments` contract stay
byte-for-byte unchanged; GS harness remains 26.**

## 22. Data Grid boundary — **engine byte-identical**

DG stays identity-unaware: employee-facing **callers** obtain rows via `getScopedRecords(entityType)` and pass them into `gridApply(...)`. No employee-visible grid ships in 006B (UI deferred to UX-006D), so no DG caller changes in 006B; the pattern is defined for later use. `data-grid.js` is untouched; **DG harness remains 36.** No identity/scope logic enters grid internals.

## 23. Action Center — **no implementation in 006B**

No Action Center change. Scope-safe destination selection and action authorization are deferred (navigation → UX-006D; authorization → UX-006C). If a Personal surface later needs navigation, only its call site changes, never the center's contract.

## 24. Navigation / UI — **deferred to UX-006D**

UX-006B establishes **data/workspace/scope semantics only**. No `NAV_GROUPS` change, no Personal navigation manifest, no visible workspace UI, **no CSS**. Rationale: prove the identity→data boundary headlessly (harness + selectors) before building visible surfaces; this keeps 006B free of frozen-surface risk.

## 25. Failure-state matrix (all fail closed; never escalate)

| Condition | Behavior |
|---|---|
| `currentUser` null | no workspace; no company data |
| employee missing `employeeId` | rejected upstream (006A) → null → no workspace |
| `employeeId` → missing Employee | no Personal Workspace; explicit unresolved state |
| Employee data not loaded | treated as missing → closed |
| invalid principalType | rejected (006A) → null |
| workspace derivation failure | no workspace; closed |
| duplicate workspace derivation | deterministic id ⇒ idempotent; single workspace |
| unsupported scope relation | empty set (no widening) |
| corrupted business relation | empty/closed; surfaced, never widened |
| storage unavailable | existing read-only degrade; scope derives over whatever loaded; closed on absence |

**Invariant SE-1:** an employee/invalid/unknown principal is **never** granted Executive/ALL_COMPANY scope.

## 26. Security / trust boundary (no overclaim)

Client-side, single trusted local session. SELF scope is **UX/data-scope enforcement, not secure authorization**: local data is editable, the principal is spoofable client-side, scoped resolvers reduce **accidental** cross-scope UI leakage but are **not** a server-enforced control. Real security remains a future backend responsibility. Code/docs must state this and must not describe SELF scope as secure.

---

## 27. Exact file plan (proposed; implementation assignment only)

| File | Category | Purpose | Symbols |
|---|---|---|---|
| `js/core/workspace.js` | **new source** | derived workspace + Hybrid scope layer | public `WORKSPACE_TYPES`, `getCurrentWorkspace`, `getScopedRecords`; internal `getScopeContext`, `getBoundEmployee`, `ENTITY_SCOPE` predicate registry |
| `tools/module-order.js` | build manifest | register after `core/identity.js` (needs identity; before people modules unnecessary since it reads `State` at call time) | add `'core/workspace.js'` |
| `index.html` | index integration | mirror manifest | add `<script src="js/core/workspace.js">` |
| `js/ui/global-search-ui.js` | **call-site only** | pass scoped sources in `openGlobalSearch()` | edit the `collectGlobalSearchDocuments({...})` argument only |
| `tools/verify-workspace-selfscope-runtime.js` | **new harness** | behavior proof (vm loader) | `check()` cases |
| `tools/verify-build.js` | verifier | additive guards (§31) | new `check(...)` |
| `dist/tam-os-v2.9.0.html` | generated | rebuilt deterministically | — |
| `AI_CONTEXT.md` / `ARCHITECTURE.md` | docs | record 006B | — |

**Load order:** `core/workspace.js` after `core/identity.js`. It reads `State`/resolvers at call time, so it needs no ordering vs `state.js`/`people-core.js` beyond being defined before those functions run (all post-load).
**Must NOT change:** `js/core/identity.js`, `js/core/state.js` (no `State.identity`), `js/core/constants.js` (`SCHEMA_VERSION`), `js/core/storage-adapter.js`, `js/core/state-load-migrations.js`, `js/core/app-bootstrap.js`, `js/core/data-grid.js`, `js/core/global-search.js`, `js/people/people-core.js` (raw resolvers), `NAV_GROUPS`, all `css/*`, `APP_VERSION`.

## 28. Public API plan (three tiers) — minimized (Hybrid, §13)

- **Stable consumer API (three symbols):**
  - `getCurrentWorkspace() → Workspace|null` — derived active workspace.
  - `getScopedRecords(entityType) → Array` — the current principal's in-scope collection for a **registered**
    entity type (`'employee'|'contract'|'payrollPlan'|'overtime'`); CEO ⇒ full, Employee ⇒ SELF,
    no-user/invalid/unknown-type ⇒ `[]`.
  - `WORKSPACE_TYPES` — frozen `{EXECUTIVE:'executive', PERSONAL:'personal'}`.
- **Internal-only:** `getScopeContext()` (`{workspace, principal, employee}`), `getBoundEmployee()`
  (`empById(currentUser.employeeId)` or null), and the `ENTITY_SCOPE` predicate registry (the single home of
  entity-specific SELF relations). Not app-facing.
- **Test-only:** the internals are reached via the harness `window.__TAM__` export (same lexical scope),
  mirroring UX-006A. No production `window` test seam unless proven necessary; if needed, use the UX-006A
  `const`-not-declaration pattern.

Rejected: four public `getScoped<Entity>()` functions (Option A) — premature surface for one live consumer;
a lone generic `isRecordInCurrentScope(record, type)` as the *only* API (Option B) — pushes entity-type
handling to callers and risks blind-`employeeId` use.

## 29. Module dependency graph

```
getCurrentUser() (identity, frozen)
      ↓
getBoundEmployee()  →  empById (raw, unchanged)
      ↓
getCurrentWorkspace() (derived: executive|personal)
      ↓
getScopeContext()  → { workspace, principal, employee }   (internal)
      ↓
getScopedRecords(entityType)  →  ENTITY_SCOPE predicate + raw collections (unchanged)   [PUBLIC]
      ↓
feature callers (GS call site now; employee-facing grids in 006D)
```

No cycles: workspace depends on identity + State + raw resolvers; none depend back on workspace. Identity unchanged; State untouched; GS/DG engines untouched. SELF predicates live only inside `ENTITY_SCOPE`.

## 30. Test plan (new harness `verify-workspace-selfscope-runtime.js`)

**Employee linkage:** valid binding resolves self Employee; missing Employee → no workspace; malformed `employeeId` (rejected upstream) → null; CEO needs no binding; no `currentUser` → closed.
**Workspace:** CEO → Executive (`ALL_COMPANY`, system owner); Employee → Personal (`SELF`, `ownerRef.employeeId===eid`); deterministic/stable id (`workspace:personal:<id>`); no workspace on invalid linkage.
**SELF scope via `getScopedRecords(entityType)` (per entity in §12):** self record allowed; another employee's record filtered out; CEO sees all; no-user closed; broken relation → empty; **unknown entity type → `[]`** (no blind fallback); `ENTITY_SCOPE` has an explicit predicate for each registered type.
**No escalation:** invalid Employee never gets Executive scope; unknown principal never gets ALL_COMPANY (asserts SE-1).
**Scope ≠ authz:** `workspace.js` exposes no `can*/isAuthorized/hasPermission` symbol.
**Frozen surfaces:** GS **26**, DG **36**, identity **33** unchanged; `global-search.js`/`data-grid.js`/`people-core.js` byte-stable.
**Structure:** one new dedicated harness (matches conventions); expected count added reported at implementation (do not pre-fix a total).

## 31. Verifier additions (additive, structural)

Workspace module present + registered (manifest + index); `WORKSPACE_TYPES` = executive/personal; derived-workspace selector present; **minimal public surface** — `workspace.js` exposes `getCurrentWorkspace`, `getScopedRecords`, `WORKSPACE_TYPES` and **not** per-entity `getScoped<Entity>` functions; **no workspace persistence** (no new `tam_*` key, no StorageAdapter/localStorage in `workspace.js`) — OR, if a future persisted design is chosen, schema/migration consistency instead; **no authorization vocabulary** (`can(`/`canRead`/`canEdit`/`isAuthorized`/`hasPermission`/role-enforcement) in `workspace.js` (scope ≠ authz guard); **SELF predicates centralized** — the `record.employeeId ===`/`record.id ===` scope comparisons appear only in `workspace.js` (`ENTITY_SCOPE`), not duplicated in `global-search-ui.js` or views; `global-search.js` + `data-grid.js` digests unchanged (engine preservation); `SCHEMA_VERSION` still 6; published-artifact/tag integrity. Avoid syntax-fragile checks.

## 32. Implementation order

1. `WORKSPACE_TYPES` + `getBoundEmployee()` (`empById(eid)` or null).
2. `getCurrentWorkspace()` derived selector (CEO/Employee/none) + internal `getScopeContext()`.
3. `ENTITY_SCOPE` predicate registry + single public `getScopedRecords(entityType)` over unchanged raw collections.
4. New runtime harness (linkage / workspace / `getScopedRecords` self-scope / unknown-type / no-escalation).
5. Additive verifier guards (minimal public surface, no-authz, centralized-SELF, engine preservation).
6. GS call-site scoping (`global-search-ui.js:160`) via `getScopedRecords(...)` — engine untouched.
7. Register `core/workspace.js` in manifest + index; rebuild `dist` twice (byte-identical); full verifier + all harnesses; GS 26 / DG 36 regression; browser smoke.

Checkpoint after each step: verifier green, no frozen-surface regression.

## 33. Acceptance criteria

Employee principal resolves its canonical Employee record (by `Employee.id`); missing linkage fails closed (no workspace, never Executive); CEO → Executive/ALL_COMPANY preserved (unfiltered); Employee → Personal/SELF; Personal owner deterministic (`ownerRef.employeeId`, id `workspace:personal:<id>`); no business-data duplication or re-homing; **public surface limited to `getCurrentWorkspace`/`getScopedRecords`/`WORKSPACE_TYPES`**; SELF predicates centralized in `ENTITY_SCOPE` (no scattering; unknown entity type → `[]`); no `can(...)`/RBAC/auth vocabulary; `global-search.js`/`data-grid.js` byte-identical, GS 26/DG 36; `SCHEMA_VERSION` 6, no migration; all harnesses green + new workspace harness green; deterministic dev build (two builds identical), new size/SHA recorded; published v2.9.0 immutable.

## 34. Implementation stop conditions

Halt and escalate if: identity contract must change; linkage needs fuzzy matching or unstable ids; business data must be duplicated/re-homed; per-record `workspaceId` becomes necessary without a planned migration; a schema bump becomes necessary; bootstrap needs a real rewrite; Global Search or Data Grid **engine** must change; authorization/RBAC or real auth becomes required; a migration risks data loss; or the workspace model contradicts the frozen baseline.

## 35. Implementation PR strategy

- **Branch:** `feature/ux-006b-personal-workspace-selfscope`.
- **One PR** under the derived/no-migration design (workspace module + scoped resolvers + GS call-site + harness + verifier + rebuilt dist + docs). **If** a future decision forces persisted workspaces/`SCHEMA_VERSION 7`, split into **staged PRs** — (1) derived workspace/scope foundation, (2) persisted migration — so the migration is reviewed in isolation. Under this plan, staging is **not** required.
- **Merge:** true merge commit after CI + all harnesses green; owner-reviewed. No implementation branch is created by this assignment.

## 36. Confirmation — no implementation performed

Documentation-only. No `js/*`, CSS, harness, verifier, storage, schema, `dist/*`, or version change; no workspace/scoped-resolver code, no GS/DG edit, no migration. `APP_VERSION` 2.9.0; `SCHEMA_VERSION` 6; verifier 2035; GS 26 / DG 36; dev artifact `fe353405…`; published v2.9.0 immutable.

## 37. Recommendation

**GO for UX-006B implementation** under a separate owner-authorized assignment. The design is fully source-grounded and minimal: identity binds `User.employeeId → Employee.id` (the relation every business record already uses); workspaces are **derived** (no persistence, **`SCHEMA_VERSION` stays 6, no migration**); the scope layer is **Hybrid** — three public symbols (`getCurrentWorkspace`/`getScopedRecords`/`WORKSPACE_TYPES`) with centralized entity-specific SELF predicates, sized to the one live consumer (Global Search) and leaving no scattered SELF logic; CEO/ALL_COMPANY is preserved unfiltered; raw resolvers stay unchanged/internal; GS/DG engines stay byte-identical (GS 26 / DG 36); scope is cleanly separable from UX-006C authorization; no bootstrap, no `State.identity`, no authorization, no auth, no UI. The one carried-forward nuance — a deleted/absent self-Employee — is handled fail-closed (no Executive fallback) and is a listed stop condition.
