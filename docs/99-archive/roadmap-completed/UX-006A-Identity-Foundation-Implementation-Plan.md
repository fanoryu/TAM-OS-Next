# UX-006A — Identity Foundation: Implementation Plan

**STATUS: IMPLEMENTATION PLAN — NOT IMPLEMENTED.** No production code is authorized by this document. It
translates the frozen [`UX-006-Identity-Personal-Workspace-Architecture.md`](UX-006-Identity-Personal-Workspace-Architecture.md)
(the **UX-006 baseline**, merged in `99c0f08`) into an exact, reviewable build plan for the **UX-006A —
Identity Foundation** phase. Implementation begins only under a separate, owner-authorized implementation
assignment. This plan makes **no** new architectural decisions; where the baseline is silent it selects the
smallest repository-consistent option and records the rationale so implementation can execute mechanically.

**Rev. 2 (owner refinements incorporated):** minimal canonical `IdentityProvider` seam (`getCurrentUser`
only) with selection isolated on a `LocalIdentityProvider` adapter (§5); **no `app-bootstrap.js` change** —
the identity module self-initializes (§12); Employee `employeeId` is an explicit **contract forward
reference**, referential validity deferred to 006B (§7, §19); artifact rule is **build determinism**, not a
freeze of development `dist/` to v2.9.0 bytes, with the published v2.9.0 asset independently immutable (§24).

---

## 0. Baseline (verified against the working tree)

| Fact | Value | Verified |
|---|---|---|
| Branch base | `main` | ✓ (`main == origin/main`) |
| Main SHA | `99c0f0840b19c91b2e7fd47961d93150fed7c9b8` | ✓ |
| Architecture merge / reviewed head (parent-2) | `99c0f08` / `7d2ff45` | ✓ |
| Working tree | clean | ✓ |
| Version / release | TAM OS **2.9.0 — Workspace Experience** | ✓ (`js/core/constants.js`) |
| `SCHEMA_VERSION` | **6** | ✓ (`js/core/constants.js:35`) |
| Verifier | **2013 PASS** | ✓ (`node tools/verify-build.js`) |
| Runtime harnesses | **18** files (`tools/verify-*-runtime.js`), GS **26** / DG **36** | ✓ |
| Artifact | `dist/tam-os-v2.9.0.html` — **1,049,018 bytes** | ✓ |
| Artifact SHA-256 | `e7470ff5261896b8d7d1f8645294d2abd6a72e9820df94b799973627ddcaf3ea` | ✓ |
| v2.9.0 tag | peels to `598edef0` (unmoved) | ✓ |
| UX-006 production code | **none** (`js/core/identity.js`, `workspace.js`, `authz.js` absent) | ✓ |

This plan changes none of the above. It adds only documentation.

---

## 1. Source Files Inspected (evidence base)

- **Bootstrap:** `js/core/app-bootstrap.js` — a single async IIFE: `await loadState() → applyTheme() →
  installGlobalUIHandlers() → render() → maybeShowFirstRunChoice()`.
- **State:** `js/core/state.js` — one global `State` object literal; `DEFAULT_SETTINGS`; session-only UI
  slices already colocated on `State` (e.g. `grid`, `navCollapsed`, `budgetSim`, `storageReady`).
- **Constants / identity block:** `js/core/constants.js` — app identity + frozen enum objects (`STATUS`,
  `OVERTIME_STATUSES`, …). `SCHEMA_VERSION = 6` at line 35. Convention: **frozen plain objects / literal
  arrays** for closed vocabularies (`const STATUS = { PLANNED:'planned', … }`).
- **Utilities:** `js/core/utils.js:2` — `uid(prefix)` id generator (opaque client id). `escapeHtml` present.
- **Resolvers:** `js/people/people-core.js:288` — `empById`, `contractById`, `payrollPlanById` (unguarded
  today; SELF-scope wrapping is **UX-006B**, out of scope here).
- **Storage adapter:** `js/core/storage-adapter.js` — single persistence gateway; `tam_*_v1` keys; the
  proven migration template (flag-guarded, back-up-first). Not touched by UX-006A.
- **Seam precedent:** `js/repository/employee-repository.js` — the exact pattern for a **frozen, delegating,
  globally-exposed seam** (`const X = Object.freeze({ … }); window.X = X;`), owning no business behavior.
  This is the template for `IdentityProvider`.
- **Load-order manifest:** `tools/module-order.js` — single source of truth for JS order; `index.html`
  mirrors it; build/verify read it.
- **Harness pattern:** `tools/verify-contract-core-runtime.js` (and 17 siblings) — dependency-free Node `vm`
  loader that concatenates `module-order.js` **minus** `core/app-bootstrap.js`, runs against an in-memory
  `window`/`localStorage` mock, exposes `window.__TAM__ = {…}`, and asserts with a local `check()` counter.
- **Verifier:** `tools/verify-build.js` — single-process structural verifier; asserts harness **presence**
  (`fs.existsSync`), never executes them; frozen-surface guards scan **named** modules only (see §12.1).
- **CI:** `.github/workflows/ci.yml` — runs `build-single-file.js` then `verify-build.js` (+ dist name/size
  checks); it does **not** execute the runtime harnesses. `codeql.yml` runs CodeQL.
- **Seed data:** none — a fresh install starts empty (Constitution §7.4). **Consequence:** no employee
  records exist at runtime by default (see §7, §17).

---

## 2. Frozen decisions carried in (non-negotiable)

Identity only; **no** authentication (no password/token/OAuth/session/credential/network). Provider-based
local principal selection is an **identity abstraction, not a security boundary**. Ship representative
**CEO** and **Employee** principals. One canonical `currentUser` contract; consumers never read fixtures or
storage directly. Identity persistence is **conditional** (default: none). `SCHEMA_VERSION` stays **6**; no
migration. **No** workspace ownership, SELF-scope resolvers, or authorization in UX-006A (those are 006B/C).

---

## 3. Proposed `User` contract (minimum viable)

The baseline proposed `{id, displayName, principalType, employeeId?, email?}`. For UX-006A the **minimum
necessary** contract omits `email` (§22 privacy — no consumer needs it this phase):

| Property | Type | Req? | Allowed values | Invariant | Why UX-006A needs it | Persist? | Backend-preserved? |
|---|---|---|---|---|---|---|---|
| `id` | `string` | **req** | opaque, `uid('user')` | immutable, non-empty | stable principal identity for the selector | conditional (§13) | yes — maps to backend user id |
| `displayName` | `string` | **req** | non-empty | mutable | proves a resolved principal is more than an id | conditional | yes — mirrors profile |
| `principalType` | `string` | **req** | `'ceo'` \| `'employee'` (see §6) | immutable per user | drives future workspace/scope; identity classification only | conditional | yes — maps to role claim |
| `employeeId` | `string` | **cond.** | present **iff** `principalType === 'employee'` | immutable; forward reference (§7) | proves the SELF-scope join key exists on the contract | conditional | yes — join key |

`email` is **deliberately excluded** in UX-006A (add later only if an auth handle is required). No
password/hash/token/avatar/phone/last-login — ever, client-side. Favor minimum surface area.

---

## 4. `principalType` representation

Follow the repository's closed-vocabulary convention (frozen plain object, like `STATUS`):

```js
// js/core/identity.js
const PRINCIPAL_TYPES = Object.freeze({ CEO: 'ceo', EMPLOYEE: 'employee' });
```

- **Location:** `js/core/identity.js` (the new identity module), not `constants.js` — it is identity-domain
  data, and colocating it with the provider/selector keeps the identity surface in one file.
- **Values** are the exact lowercase literals the baseline froze (`ceo`, `employee`).
- **Not** RBAC roles. `principalType` is identity classification for this phase; authorization vocabulary
  (`can(...)`, capabilities) is **UX-006C** and must not appear here.

---

## 5. Provider contract — canonical seam vs. local adapter (minimal)

**Correction (owner):** the *canonical* provider contract must not couple application consumers to persona
switching. Split it into two layers — a minimal **canonical seam** that consumers depend on, and a
**local/development adapter** that adds deterministic selection for tests only.

### 5.1 Canonical `IdentityProvider` seam (the ONLY consumer-facing contract)

```text
IdentityProvider
└── getCurrentUser() -> User | null
```

Modeled on `EmployeeRepository` (frozen object, global-exposed, no business behavior). **Synchronous** —
there is no network, so async buys nothing and would complicate initialization. A future
backend/authenticated provider implements **exactly this one method** and is **not** required to enumerate
or select principals.

- **Return:** validated `User` or `null`.
- **Null semantics:** `null` = *identity unresolved / no principal* — **fail-closed** (§9, §17); never a
  privileged default.
- **Error semantics:** never throws for "no/unknown principal"; a malformed principal is rejected by
  validation (§18) and surfaces as `null`, never a partial `User`.
- **Excluded (premature):** `login`, `logout`, `refreshToken`, `authenticate`, sessions, credentials,
  network calls — and, deliberately, `getAvailablePrincipals`/`selectPrincipal` (those are **not** part of
  the canonical contract; they live only on the local adapter, §5.2).

### 5.2 `LocalIdentityProvider` (development/test adapter only)

The client build wires the canonical seam to a local adapter that additionally supports deterministic
persona selection for harnesses/development. These extra methods are **adapter-specific, not canonical**:

```text
LocalIdentityProvider   (implements the canonical getCurrentUser())
├── getCurrentUser()          -> User | null        // canonical
├── getAvailablePrincipals()  -> User[]  (may be []) // local-only (enumerate fixtures)
└── selectPrincipal(id)       -> User | null         // local-only, API only, no UI, no persistence
```

- `getAvailablePrincipals()` / `selectPrincipal(id)` exist **only** on the local adapter, used to prove Q2
  (both principals resolvable) and to drive tests. They read fixtures; no persistence; `selectPrincipal`
  on an unknown id is a no-op miss returning `null` (never a privileged fallback).
- **Consumer rule:** application modules depend **only** on `IdentityProvider.getCurrentUser()`. Nothing in
  the application depends on `getAvailablePrincipals`/`selectPrincipal`; a verifier guard (§20) keeps
  selection APIs out of the canonical dependency path.
- **Naming** follows repository convention (frozen object exposed on `window`, `LocalIdentityProvider`
  paralleling `IdentityProvider`). `IdentityProvider` in the client build is the local adapter surfaced
  under the canonical name for `getCurrentUser()`; consumers never reference `LocalIdentityProvider`
  directly.

---

## 6. `currentUser` contract (single canonical access path)

Repository convention has no pre-existing selector pattern for identity, so this plan **establishes one**:
a single free function that delegates to the provider. Consumers call the selector — never the provider or
fixtures directly (enforced by §16 and a verifier guard, §20).

```js
function getCurrentUser() { return IdentityProvider.getCurrentUser(); }  // the ONLY consumer entry point
```

Semantics:

| Situation | `getCurrentUser()` returns | Meaning |
|---|---|---|
| resolved principal | the validated `User` | active principal |
| no principal selected (default at load) | `null` | identity unresolved (fail-closed) |
| invalid provider result | `null` (validation rejects) | never a fabricated/partial user |
| module loaded, nothing selected | `null` | self-initialized default (fail-closed) |
| unknown `principalType` | `null` (validation rejects) | never inferred as CEO |

**"Fail closed" in UX-006A** (before authorization exists) concretely means: identity-dependent code must
treat `null` as *no principal*, **never** infer or default to CEO/privileged, and never fabricate a `User`.
The identity module self-initializes at load (no bootstrap call, §12); `getCurrentUser()` returns `null`
until a test selects a principal. Because UX-006A wires **no** identity-dependent product surface, the
practical invariant is: the selector faithfully returns `null` rather than a convenience default, and the
tests assert exactly that. Existing v2.9.0 behavior remains fully operational when `currentUser` is `null`.

---

## 7. CEO & Employee representative principals

Deterministic fixtures inside the local provider (`js/core/identity.js`) — not `constants.js`, not runtime
seed data (the app seeds nothing). Obviously-fabricated values; no real PII.

```js
const FIXTURE_PRINCIPALS = Object.freeze([
  Object.freeze({ id: 'user_ceo_fixture',      displayName: 'Executive (CEO)', principalType: 'ceo' }),
  Object.freeze({ id: 'user_employee_fixture', displayName: 'Employee (Sample)', principalType: 'employee',
                  employeeId: 'emp_fixture_self' })
]);
```

- **CEO:** `principalType: 'ceo'`, no `employeeId` (Executive scope is company-wide; the link is N/A).
- **Employee:** `principalType: 'employee'` with `employeeId` present to prove the SELF-scope **join key
  exists on the contract**.
- **`employeeId` is a contract forward reference (critical, source-grounded).** It is a **deterministic,
  non-empty opaque fixture reference**. A fresh install has **no** employee records, so `emp_fixture_self`
  intentionally resolves to nothing today. UX-006A therefore:
  - validates only its **type/shape/presence** (non-empty string when `principalType==='employee'`);
  - does **not** call `empById`;
  - does **not** assert the referenced Employee exists;
  - does **not** create or mutate Employee data.

  Two validities are kept strictly distinct — **UX-006A proves only the first:**
  - **Identity-contract validity** — the `User` object is well-formed (proven in 006A).
  - **Employee-record referential validity** — `employeeId` resolves to a real `State.employees` record
    (deferred to **UX-006B**, when SELF scope and scoped resolvers are introduced).

  The Employee principal must **not** be described as fully linked to an existing employee record. See §17
  (`employee missing employeeId` → invalid) vs. *unresolved* `employeeId` (valid, expected in 006A).
- **No default selection.** The provider starts with **no** active principal (`getCurrentUser() → null`);
  tests drive `selectPrincipal(...)`. Defaulting to CEO for convenience would violate fail-closed (§10).

---

## 8–10. Principal selection & default behavior

- **Switching:** implemented **API-only** via `LocalIdentityProvider.selectPrincipal(id)` — a local-adapter
  method, **not** part of the canonical seam (§5). No UI (a principal-switch UI is **UX-006D**).
- **Driven by:** fixture/adapter configuration; the two `FIXTURE_PRINCIPALS` are the selectable set.
- **Initial/default:** **no active principal** at construction → `getCurrentUser()` returns `null`.
  "No active principal" is a valid, expected UX-006A state.
- **Reload preservation:** **not** required in UX-006A (no persistence — §13). If a future phase shows a
  concrete continuity need, persistence is added then, guarded (§13).
- **Why no CEO default:** silently defaulting to the privileged principal is precisely the fail-closed
  violation the baseline forbids (Risk 3/4). Selection must be explicit.

---

## 11. State integration — recommendation

**Chosen: Option A — provider-owned private state** (selection state lives inside `IdentityProvider`'s
module closure), exposed only through `getCurrentUser()`.

| Option | Coupling | Testability | Bootstrap impact | 006B fit | Backend swap | Ergonomics |
|---|---|---|---|---|---|---|
| **A. Provider-owned (chosen)** | lowest — no `State` change | high — construct provider, assert selector | none — `State` untouched | 006B adds `State.identity` when workspace needs it | cleanest — swap provider only | consumers call one selector |
| B. `State.identity` slice now | adds identity to global `State` | high | edits `state.js` | native home for workspace later | fine | direct `State` reads (discouraged) |
| C. Thin module + private state | same as A, different name | high | none | same as A | same as A | same as A |
| D. Other | — | — | — | — | — | — |

Rationale: A is the **smallest seam** and keeps `js/core/state.js` byte-stable this phase, minimizing
frozen-surface risk. **Exact state shape added to `State`: none in UX-006A.** (UX-006B may introduce
`State.identity = { currentUser, activeWorkspace, availableWorkspaces }` when workspace resolution needs a
render-visible home — deferred by design.)

---

## 12. Bootstrap integration — **NONE in UX-006A** (corrected)

**Correction (owner):** do not introduce an identity bootstrap lifecycle for future use. Under the chosen
architecture — synchronous provider, no storage, no migration, no network, no async resolution,
provider-owned private state — the identity module **initializes itself deterministically at load time**
(the `module-order.js` slot after `core/utils.js`), and `getCurrentUser()` is safe to call from the moment
the module is defined (returns `null` until a test selects a principal). There is **no UX-006A
responsibility that must occur during bootstrap**: no view is identity-gated, nothing hydrates on identity,
and existing v2.9.0 boot behavior is unchanged.

**Decision: no `app-bootstrap.js` change in UX-006A.** The former `resolveIdentity()` seam is **removed**
from the plan. `getCurrentUser()` self-initializes (canonical seam returns `null` by default); no lifecycle
call is added.

- **Rendering / behavior:** identical to today; identity is additive and non-gating.
- **Failure behavior:** provider/validation failure → `getCurrentUser()` returns `null`; app continues.

### 12.1 How UX-006B later adds real initialization without a breaking change

Because consumers depend only on `IdentityProvider.getCurrentUser()` (§5.1), UX-006B can introduce a real
identity/workspace initialization step in `app-bootstrap.js` **then** — resolving the active principal,
hydrating `State.identity`, and adding workspace resolution — **without changing the consumer API**. The
canonical `getCurrentUser()` signature is unchanged; only its backing (a real resolved principal instead of
`null`) changes. Adding a bootstrap call in 006B is additive and consumer-transparent, so deferring it out
of 006A costs nothing and keeps 006A's changed-file surface minimal.

### 12.2 Frozen-surface guard finding (unchanged relevance)

`verify-build.js`'s "no UX-006 role/auth/workspace/currentUser" guards scan **named** modules only
(dashboard sources, `data-grid.js`, `global-search*.js`, `components.css`, and
`shell + stabilization + transaction-modals`). A **new** `js/core/identity.js` is in **none** of those
sets. With the bootstrap edit removed, UX-006A now touches **no** module in any guard scan at all — the
only rule to honor is that identity symbols must not leak into the scanned modules (implementation must not
import identity into shell/stabilization/txn/dashboard/grid/GS/CSS).

### 12.1 Frozen-surface guard finding (why UX-006A is low-risk)

`verify-build.js`'s "no UX-006 role/auth/workspace/currentUser" guards scan **named** modules only:
dashboard sources, `data-grid.js`, `global-search*.js`, `components.css`, and `shell + stabilization +
transaction-modals` (line ~3782). A **new** `js/core/identity.js` and an additive line in
`app-bootstrap.js` are in **none** of those sets, so the identity symbols do not trip them. The only rule
to honor: identity symbols (`currentUser`, `IdentityProvider`, `PersonalWorkspace`, …) must **not** leak
into the scanned modules. Implementation must not import identity into shell/stabilization/txn/dashboard/
grid/GS/CSS. (A later phase that *does* touch those surfaces will update the guards under its own
authorization — not UX-006A.)

---

## 13. Storage decision — **NO UX-006A identity persistence**

**Recommendation: NO persistence.** Source evidence: the two representative principals are static fixtures;
no UX-006A surface consumes a persisted selection; there is no reload-continuity requirement (no UI, no
identity-dependent view). Therefore UX-006A introduces:

- **no** new `tam_*` keys (specifically **not** `tam_users_v1`, **not** `tam_active_principal_v1`);
- **no** migration and **no** migration flag;
- **no** backup-format change;
- **no** `SCHEMA_VERSION` bump (stays **6**).

If a later phase proves a concrete continuity need, persistence is added then as **additive dedicated keys**
following the proven flag-guarded template — with its own schema decision at that time.

---

## 14. Exact file plan (proposed diff at file level)

**New / changed (production — *for the future implementation assignment only*):**

| File | Category | Purpose | Symbols | Why UX-006A |
|---|---|---|---|---|
| `js/core/identity.js` | **new source** | identity module: types, fixtures, canonical seam, local adapter, selector, validation | `PRINCIPAL_TYPES`, `IdentityProvider` (canonical), `LocalIdentityProvider` (adapter), `getCurrentUser`; internal `FIXTURE_PRINCIPALS`, `isValidUser` | the whole identity surface in one file |
| `tools/module-order.js` | build manifest | register load order | add `'core/identity.js'` after `'core/utils.js'` | manifest is load-order SoT |
| `index.html` | build/index integration | mirror manifest | add `<script src="js/core/identity.js">` in the same position | index mirrors the manifest (MUST) |
| `tools/verify-identity-foundation-runtime.js` | **new harness** | behavioral harness (§19) | `vm` loader + `check()` cases | proves identity behavior out-of-process |
| `tools/verify-build.js` | verifier | additive structural guards (§20) | new `check(...)` lines only | structure/preservation guardrails |
| `dist/tam-os-v2.9.0.html` | generated artifact | rebuilt from source | — | build re-inlines new module (§24) |

**`app-bootstrap.js` is REMOVED from UX-006A scope** (§12): the identity module self-initializes, so no
bootstrap edit is needed. It moves to the must-NOT-change list.

**Load-order placement:** `core/identity.js` immediately **after** `core/utils.js` (it uses `uid`) and
before `core/state.js`. It depends on nothing else and touches no `State`, so this is the lowest-risk slot.

**Revised changed-file categories/count (≈5 tracked paths + 1 generated):**
- **source:** `js/core/identity.js` (new) — 1
- **build manifest / index integration:** `tools/module-order.js`, `index.html` — 2
- **harness:** `tools/verify-identity-foundation-runtime.js` (new) — 1
- **verifier:** `tools/verify-build.js` — 1
- **generated development artifact:** `dist/tam-os-v2.9.0.html` (rebuilt) — 1
- **documentation:** `AI_CONTEXT.md` / `ARCHITECTURE.md` module-map update (implementation PR, §28)

**Must NOT change:** `js/core/app-bootstrap.js`, `js/core/state.js`, `js/core/constants.js`
(`SCHEMA_VERSION`), `js/core/storage-adapter.js`, `js/core/state-load-migrations.js`,
`js/people/people-core.js` (resolvers), `data-grid.js`, `global-search*.js`, `global-search-ui.js`,
Action Center sources, all `css/*`, `APP_VERSION`, published v2.9.0 tag/asset.

---

## 15. Public API surface — three tiers (minimized stable surface)

**Stable consumer API** — the only symbols normal application modules may depend on:

| Symbol | Signature | Returns | Failure | Frozen after 006A? |
|---|---|---|---|---|
| `getCurrentUser` | `() → User\|null` | validated `User` or `null` | returns `null` | contract frozen; impl may extend |
| `IdentityProvider.getCurrentUser` | `() → User\|null` | canonical seam | returns `null` | interface frozen |
| `PRINCIPAL_TYPES` | frozen `{CEO,EMPLOYEE}` | `'ceo'`/`'employee'` | — | values frozen |

**Provider/adapter API** — used to *supply* identity, not consumed by application modules:

| Symbol | Signature | Notes |
|---|---|---|
| `LocalIdentityProvider.getCurrentUser` | `() → User\|null` | the canonical method, on the local adapter |
| `LocalIdentityProvider.getAvailablePrincipals` | `() → User[]` | **local-only**; enumerate fixtures (tests/dev) |
| `LocalIdentityProvider.selectPrincipal` | `(id) → User\|null` | **local-only**; API-only selection, no UI/persistence |

**Local fixture / development helpers — internal, must NOT become application dependencies:**
`FIXTURE_PRINCIPALS`, `isValidUser`. Tests reach these (and the adapter) via the harness's
`window.__TAM__` export, mirroring existing harnesses.

`resolveIdentity` is **removed** (no bootstrap lifecycle, §12). A verifier guard (§20) asserts the
application depends only on the stable consumer API — never on `getAvailablePrincipals`/`selectPrincipal`.

---

## 16. Module dependency graph (enforced direction)

```
consumers (future identity-aware code; NONE in UX-006A)
        │  depend ONLY on the canonical seam
        ▼
getCurrentUser()  ── selector façade → IdentityProvider.getCurrentUser()   [canonical]
        │
        ▼
IdentityProvider  ── canonical seam (getCurrentUser only)
        ▲
        │ implemented by
LocalIdentityProvider  ── adapter: +getAvailablePrincipals()/selectPrincipal()  [local-only]
        │
        ▼
FIXTURE_PRINCIPALS + isValidUser  ── local fixtures/validation (identity.js)
        ▲
        └── tests reach adapter + internals via window.__TAM__ (NOT via app consumers)
```

Forbidden: application/UI/business modules calling `getAvailablePrincipals`/`selectPrincipal` or reading
`FIXTURE_PRINCIPALS`/adapter state directly (they use only `getCurrentUser()`); adapter importing UI/shell;
identity importing `State` (Option A keeps it `State`-free in 006A); any circular bootstrap/state
dependency. Everything lives in one leaf module loaded early with **no** bootstrap edit, so cycles are
structurally impossible this phase.

---

## 17. Fail-closed matrix

| Condition | UX-006A behavior |
|---|---|
| valid CEO principal selected | `getCurrentUser()` → CEO `User`; `principalType==='ceo'`; no `employeeId` |
| valid Employee principal selected | `getCurrentUser()` → Employee `User`; `employeeId` present (unresolved is fine) |
| provider returns null / none selected | `getCurrentUser()` → `null`; **no privileged inference** |
| provider returns malformed object | validation rejects → `getCurrentUser()` → `null` (never partial `User`) |
| unknown `principalType` | validation rejects → `null` (never treated as CEO) |
| employee **missing** `employeeId` | **invalid** → `null` (employee requires the join key) |
| employee `employeeId` present but unresolved | **valid** in 006A (forward reference; resolution is 006B) |
| provider `selectPrincipal` throws / bad id | no state change; `getCurrentUser()` unchanged (stays `null` if none) |

No branch fabricates a privileged identity as recovery.

---

## 18. Runtime validation plan

- **Location:** a small internal `isValidUser(u)` in `identity.js`; the provider/selector return `null`
  rather than an invalid `User`.
- **Checks:** object is non-null; `id` non-empty string; `displayName` non-empty string; `principalType`
  ∈ `PRINCIPAL_TYPES`; if `principalType==='employee'` then `employeeId` is a non-empty string; if
  `'ceo'` then `employeeId` absent. No unexpected credential-like fields.
- **Invalid-result behavior:** treated as no principal → `null` (fail-closed).
- **No schema library** — plain guards, matching repository style (`computeStatus`-level simplicity).

---

## 19. Test plan (concrete cases)

**One new dedicated harness:** `tools/verify-identity-foundation-runtime.js`, using the established `vm`
loader (concatenate `module-order.js` minus `app-bootstrap.js`; export `window.__TAM__ = { IdentityProvider,
LocalIdentityProvider, getCurrentUser, PRINCIPAL_TYPES, FIXTURE_PRINCIPALS, isValidUser }`). One harness
(not many) matches the
"one bounded concern per harness" precedent and keeps the count change to **+1** (18 → 19).

Cases, grouped by concern:

**Canonical identity contract**
- CEO fixture valid; Employee fixture valid; Employee requires **non-empty** `employeeId` (missing/empty
  rejected); CEO does **not** require Employee linkage (valid with no `employeeId`; stray `employeeId`
  rejected); invalid `principalType` rejected; malformed/non-object rejected; missing `id`/`displayName`
  rejected.

**Canonical provider seam** (`IdentityProvider.getCurrentUser`)
- resolves a valid current user; `null` remains `null`; a malformed provider result **fails closed**
  (`null`, not partial); a provider error does **not** fabricate identity.

**Local provider behavior** (`LocalIdentityProvider`, only because selection is retained)
- `selectPrincipal('user_ceo_fixture')` → CEO; `selectPrincipal('user_employee_fixture')` → Employee;
  `selectPrincipal('nope')` → `null` with **no privileged fallback**; `getAvailablePrincipals()` returns
  both — and the harness asserts enumeration is **adapter** behavior, **not** the canonical contract
  (canonical `IdentityProvider` exposes only `getCurrentUser`).

**Referential boundary** (explicit)
- Prove UX-006A validates the Employee identity object **without** any `State.employees` record present:
  run validation/selection with `State.employees === []` and assert success. The harness does **not**
  create a fake employee to pass, and does **not** call `empById`.

**Preservation (in-suite)**
- full harness set still passes; GS harness **26**; DG harness **36**; verifier **presence** check for the
  new harness passes.

**Harness structure recommendation:** **one new dedicated runtime harness** (not an extension of a core
harness — identity is a new bounded concern with its own fixtures), consistent with the SPR-077…095 pattern.

---

## 20. Verifier additions (additive, structural — implement in 006A, not now)

Add `check(...)` lines to `verify-build.js` (never weaken existing checks):

- identity module present: `js/core/identity.js` exists and is registered in `module-order.js` **and**
  mirrored in `index.html`;
- `PRINCIPAL_TYPES` defines exactly `ceo` + `employee`; both representative principals present;
- **canonical seam is minimal:** a single canonical `getCurrentUser` selector exists; the selection methods
  (`getAvailablePrincipals`/`selectPrincipal`) exist **only** on the local adapter and appear in **no**
  application/business/UI module (canonical-contract guard);
- **no-auth guard:** no `authenticate|login|logout|password|token|OAuth|session` symbols in `identity.js`;
- **no persistence:** `identity.js` contains no `tam_*_v1` key and no `StorageAdapter`/`localStorage`
  reference (matches §13);
- `SCHEMA_VERSION` still `6` (existing check already covers this);
- new runtime harness present: `tools/verify-identity-foundation-runtime.js` (`fs.existsSync`);
- **determinism, not a byte-freeze:** assert the committed `dist/` equals a fresh rebuild from current
  source (build-fidelity), i.e. two consecutive builds are byte-identical. **Do NOT** add any check that
  pins development `dist/` to the v2.9.0 bytes/size/SHA (that invariant is retired the moment source
  changes — see §24).

Avoid brittle internal-syntax freezes (e.g. exact fixture ids) beyond what proves the contract.

---

## 21. Security / trust guardrails (anti-overclaim)

- File header comment in `identity.js`: *"Development/client identity abstraction. Provider-based local
  principal selection is NOT authentication; it is spoofable client-side; real security enforcement is a
  future backend responsibility. No credential material is stored or verified."*
- Verifier no-auth guard (§20) mechanically prevents auth vocabulary creeping in.
- No security UI, no "secure/login" wording in code or docs.

## 22. Privacy decision

`email` **omitted** in UX-006A (no consumer needs it). No passwords/credentials/tokens/PII. Fixtures use
obviously-fabricated labels. Add `email` only if a future auth handle is required, as an additive optional
field.

## 23. Accessibility / UI impact

**None.** No visible product UI, no CSS change. Principal-switch UI is **UX-006D**. Switching is API-only.

## 24. Build / artifact semantics — published (immutable) vs. development (expected to change)

Two distinct artifacts, corrected per owner:

**Published v2.9.0 artifact — immutable forever.** The GitHub Release asset `tam-os-v2.9.0.html`
(**1,049,018 bytes**, SHA-256 `e7470ff5261896b8d7d1f8645294d2abd6a72e9820df94b799973627ddcaf3ea`) and the
`v2.9.0` tag (`598edef0`) must **never** be modified. UX-006A verifies this asset **independently** as the
historical immutable artifact.

**Development artifact — changes when source changes.** Once UX-006A adds `core/identity.js`, the working
generated `dist/` **is expected to differ** from the v2.9.0 bytes. UX-006A must therefore **NOT** require
the development `dist/` to retain the v2.9.0 SHA/size. Instead require:
- **deterministic build** — `build-single-file.js` inlines the manifest in order, no transform;
- **committed `dist/` matches current source** (build-fidelity);
- **two consecutive builds are byte-identical** (reproducibility);
- a **new current-development size/SHA is recorded** in the implementation report (not frozen as an
  invariant);
- the **published v2.9.0 asset remains independently verified** as `e7470ff5…`.

No verifier invariant may permanently freeze development `dist/` to the v2.9.0 bytes. The rebuilt `dist/`
is committed with its source (Constitution §15.1). **No artifact change occurs in this planning assignment.**

---

## 25. Implementation order (for the future assignment)

1. `PRINCIPAL_TYPES` + `isValidUser` (contract/validation) → unit-check in isolation.
2. `FIXTURE_PRINCIPALS` (CEO + Employee) → shape asserted.
3. Canonical `IdentityProvider` seam (`getCurrentUser` only) + `LocalIdentityProvider` adapter
   (`getAvailablePrincipals`/`selectPrincipal`); adapter self-initializes (no bootstrap call).
4. `getCurrentUser()` selector façade over the canonical seam.
5. Register in `module-order.js` **and** `index.html` (together).
6. New runtime harness `verify-identity-foundation-runtime.js`.
7. Additive verifier guards (incl. canonical-contract + no-auth + no-persistence + build-fidelity).
8. `build-single-file.js` → rebuild `dist/`; run twice to confirm byte-identical; full verifier + all
   harnesses; regression (GS 26 / DG 36); record the new development size/SHA.

**No bootstrap step** (§12). Checkpoint after each step: verifier green + no frozen-surface regression.

## 26. Acceptance criteria (measurable)

- `js/core/identity.js` exists, registered in manifest + mirrored in `index.html`; **no `app-bootstrap.js`
  change** (self-initializing module, §12).
- `getCurrentUser()` returns a validated `User` for a selected CEO or Employee principal, `null` otherwise.
- **Canonical `IdentityProvider` exposes only `getCurrentUser`;** selection (`getAvailablePrincipals`/
  `selectPrincipal`) exists only on `LocalIdentityProvider` and appears in no application module.
- Both representative principals selectable via the local adapter.
- Fail-closed matrix (§17) holds for every row; no privileged default.
- **Referential boundary:** identity validates with `State.employees === []`; no `empById` call; no fake
  employee created.
- No auth symbols; no `tam_*` identity key; no `StorageAdapter`/`localStorage` in `identity.js`.
- `SCHEMA_VERSION === 6`; no migration; no business-data change.
- GS harness **26**, DG harness **36**, all pre-existing harnesses green.
- New identity harness green; verifier total **increases** (all prior checks still pass) — expected order
  **2013 → >2013**; runtime harness count **18 → 19**.
- **Build:** deterministic and reproducible (two builds byte-identical); committed `dist/` matches source;
  a **new** development size/SHA is recorded (development `dist/` is **not** frozen to v2.9.0 bytes).
- **Published** v2.9.0 release/tag/asset independently re-verified as immutable `e7470ff5…`.

## 27. Stop conditions (halt implementation; escalate)

Halt and request an architecture decision if any occurs: identity requires a persisted-state migration;
a `SCHEMA_VERSION` bump becomes necessary; the Employee principal cannot be represented without resolving
against (absent) employee data (i.e. referential validity is forced into 006A); the **canonical** provider
contract is pushed to require `getAvailablePrincipals`/`selectPrincipal` (selection leaking into the
consumer seam); identity cannot self-initialize and genuinely needs a bootstrap lifecycle; the work would
require workspace/authz behavior to function; Global Search / Data Grid must change; the provider contract
is pushed toward authentication semantics; the build cannot be made deterministic **or** a check is
demanded that freezes development `dist/` to the v2.9.0 bytes; any contradiction with the frozen baseline;
any historical-release (v2.9.0 tag/asset) mutation; or unrelated regressions.

## 28. Implementation PR strategy

- **Branch:** `feature/ux-006a-identity-foundation` (per Constitution §5 naming).
- **One narrowly-scoped PR** (source evidence supports it: 1 new module + 2 registrations + 1 harness +
  additive verifier lines + rebuilt `dist/`; **no bootstrap edit**).
- **Expected changed files (~5 tracked + 1 generated):** `js/core/identity.js` (new),
  `tools/module-order.js`, `index.html`, `tools/verify-identity-foundation-runtime.js` (new),
  `tools/verify-build.js`, plus the rebuilt `dist/tam-os-v2.9.0.html`. **`app-bootstrap.js` is NOT in
  scope.**
- **Review boundaries:** identity-only; zero change to business logic, storage, schema, frozen surfaces.
- **Docs:** update `AI_CONTEXT.md`/`ARCHITECTURE.md` module map in the **same** PR (identity module now
  exists); this plan and the baseline are referenced, not modified.
- **Merge:** true merge commit (repo convention), owner-approved, after CI + all harnesses green.
- **Not created here** — this assignment does not open the implementation branch.

## 29. Implementation report template (for the future assignment)

Return: baseline SHA; implementation head SHA; changed files (confirm `app-bootstrap.js` untouched); final
`User` contract; **canonical** `IdentityProvider` contract (getCurrentUser only) + `LocalIdentityProvider`
adapter methods; `currentUser` behavior + fail-closed proof; CEO fixture; Employee fixture; **referential-
boundary proof** (validated with `State.employees === []`, no `empById`); persistence decision (expected:
none); schema status (expected: 6, no migration); new harness + case results; verifier total
(before/after); GS **26** / DG **36** preservation; **development** artifact **new** size/SHA + two-build
byte-identical proof; **published** v2.9.0 asset independently re-verified as immutable `e7470ff5…`;
no-auth confirmation; no-workspace/no-authz confirmation; CI + CodeQL status; PR identity/status;
stop-condition status; and a GO/HOLD line.

---

## 30. Confirmation — no implementation performed

This is a documentation-only planning artifact. No production/runtime/CSS/business code was written or
changed; no `js/core/identity.js`, provider, `currentUser`, fixtures, bootstrap edit, storage key, schema
change, harness, or verifier change was created. `APP_VERSION` stays `2.9.0`; `SCHEMA_VERSION` stays `6`;
the verifier remains **2013 PASS**; GS **26** / DG **36**; the published v2.9.0 artifact, tag, and all
historical releases remain immutable.

## 31. Recommendation

**GO for UX-006A implementation.** After the owner refinements, the plan is even tighter: a **minimal
canonical `IdentityProvider` seam** (`getCurrentUser` only) with selection isolated on a
`LocalIdentityProvider` adapter; **no bootstrap change** (the module self-initializes), so UX-006A touches
**no** module in any frozen-surface guard scan; the Employee `employeeId` is an explicit **contract forward
reference** (identity-contract validity proven in 006A; employee-record referential validity deferred to
006B); and the artifact rule is **build determinism**, not a freeze of development `dist/` to the v2.9.0
bytes (the published v2.9.0 asset remains independently immutable). No schema/persistence change is
required and no open architectural decision remains.
