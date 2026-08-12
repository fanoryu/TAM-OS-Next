# UX-006 — Identity, Personal Workspace & Authorization: Discovery & Architecture Baseline

**STATUS: DISCOVERY / ARCHITECTURE — NOT IMPLEMENTED.** No production code is authorized by this
document. It records the current architecture **as found in code on `main`**, the identity/workspace/
authorization contracts UX-006 must adopt, the migration and compatibility requirements, and a reviewable
phase decomposition. Implementation is authorized only by a subsequent Sprint Assignment per
[`README.md`](README.md). **The two former gating product questions (identity mechanism; whether an
Employee principal ships) are now owner-approved and recorded as resolved decisions in §1A — UX-006A
planning is GO; UX-006A implementation remains NOT YET AUTHORIZED (§20.1).** It extends — and does not
supersede — the frozen product decisions in
[`UX-005-Executive-Personal-Workspace-Architecture.md`](UX-005-Executive-Personal-Workspace-Architecture.md)
(hereafter **UX-005-Arch**), whose §3–§9, §21–§24 remain the authoritative product model.

---

## 1. Baseline Verification (verified against the working tree)

| Fact | Value | Verified |
|---|---|---|
| Branch at discovery | `main` | ✓ |
| Main SHA | `4069102ca0267744df376d73717930fc87923221` | ✓ (`main == origin/main`) |
| Working tree | clean | ✓ |
| Version / release | TAM OS **2.9.0 — Workspace Experience** | ✓ (`APP_VERSION`, `<title>`) |
| `SCHEMA_VERSION` | **6** | ✓ (`js/core/constants.js`) |
| v2.9.0 tag object | `482029538b43eb4d0e1c3b2042790d30e78ae2aa` | ✓ |
| v2.9.0 peels to | `598edef090a41e457397b31ac30e3ff512184090` (publication commit) | ✓ (unmoved) |
| Published artifact | `tam-os-v2.9.0.html` — **1,049,018 bytes** | ✓ |
| Artifact SHA-256 | `e7470ff5261896b8d7d1f8645294d2abd6a72e9820df94b799973627ddcaf3ea` | ✓ |
| Verifier / runtime / harnesses | **2013 / 1552 / 18** | ✓ |
| Global Search / Data Grid harness | **26 / 36** | ✓ |
| CSS digest / tokens digest | `5528908b…` / `60dde600…` | ✓ |
| UX-005A–F / MAINT-001 | complete, published in v2.9.0 | ✓ |
| UX-006 | **not begun** | ✓ |

This discovery changes none of the above. No product/runtime/CSS/artifact/version/tag change is made.

---

## 1A. Approved Owner Decisions (resolved — supersede the former gating questions)

The two product decisions that this discovery previously listed as **gating open questions** (former Q1/Q2)
have been **decided by the owner** and are now **resolved architecture inputs**. They are recorded here as
approved decisions and are reflected throughout §3, §6–§8, §10, §13, §18, §20 and the ADRs. No further
product decision blocks UX-006A planning.

### Decision Q1 — Identity mechanism (APPROVED): provider-based local principal selection as an identity abstraction

v3.0.0 resolves the active application principal through **provider-based local principal selection** — an
`IdentityProvider` supplies the set of available principals and resolves the currently-selected one into the
single `currentUser` contract. **This mechanism is an identity abstraction, not authentication.** It MUST
NOT be described or built as secure login, account authentication, session security, credential
verification, or an authorization security boundary.

The architecture preserves, as invariants:
- an **`IdentityProvider`** seam as the sole source of the active principal;
- a single **`currentUser` consumer contract** (one selector; no module resolves identity independently);
- **provider-supplied principal resolution** (the provider owns which principals exist and which is active);
- **future replacement by real backend/auth infrastructure** behind the same interface, with **no
  widespread consumer changes**.

**No password, token, OAuth, session, credential, or real-authentication implementation is authorized.**
A local principal selection changes *who the app is acting as* within a single trusted local session; it
proves nothing about *who the human is*. See §6, §7, §17.3, §22 (risk 4), and ADR-006-01/02.

### Decision Q2 — v3.0.0 ships both CEO and Employee principals (APPROVED)

v3.0.0 **MUST** ship with **at least both** canonical principals so the identity, workspace-scope, and
authorization architecture is proven against a lower-privilege principal — not only a CEO identity
abstraction:

| Principal | `principalType` | Workspace | Scope |
|---|---|---|---|
| CEO | `ceo` | Executive Workspace | `ALL_COMPANY` |
| Employee | `employee` | Personal Workspace | `SELF` |

Employee capabilities remain **intentionally minimal and policy-driven**. **No generic employee CRUD** is
introduced. The frozen product intent stands: employee access is primarily **SELF-scoped and
read-oriented**, with only explicitly approved self-service mutations (e.g. `submit-own-overtime`) enabled
when their authorized phase is reached. This is reflected in §3, §8, §10, §18 and the §20 success criteria.

---

## 2. Current-State Architecture Map (source-grounded)

### 2.1 Application state & bootstrap
- **One global `State` object** (`js/core/state.js`): entity arrays (`txns`, `employees`, `contracts`,
  `payrollPlans`, `recurringExpenses`, `monthlyPlans`, `overtimeRecords`, payroll `adjustments`,
  `companyAccounts`, `employeeMerges`, `importBatches`, `backups`, audit log) + `settings` (a single
  company-scoped settings object) + **session-only UI state** (`view`, filters, `grid`, `navCollapsed`,
  `navMore`, sidebar flags, `budgetSim`, `storageReady`).
- **Bootstrap** (`js/core/app-bootstrap.js`): `loadState()` → `applyTheme()` → `installGlobalUIHandlers()`
  → `render()` → `maybeShowFirstRunChoice()`.
- **`loadState()`** (`js/core/state-load-migrations.js`): `StorageAdapter.selfTest()` → load each dataset
  → run the **sequential one-time migrations** → `recoverSupplementalOrphans()` → compute
  `_hadStoredData` → pick landing view → `storageReady = true`.

### 2.2 Persistence
- **`StorageAdapter`** (`js/core/storage-adapter.js`): Claude-Artifact storage → `localStorage` fallback;
  `get`/`set` return typed results; client-only, no network. Constitution §4.3 prohibits a backend.
- **Storage keys** (all company/local-scoped, no owner): `tam_txns_v1`, `tam_employees_v1`,
  `tam_contracts_v1`, `tam_payroll_plans_v1`, `tam_payroll_adjustments_v1`, `tam_overtime_records_v1`,
  `tam_recurring_expenses_v1`, `tam_monthly_plans_v1`, `tam_company_accounts_v1`, `tam_employee_merges_v1`,
  `tam_import_batches_v1`, `tam_supplemental_payments_v1`, `tam_backups_v1`, `tam_audit_log_v1`,
  `tam_settings_v1`; plus one-time **migration flags** `tam_migrated_*` and probe/ack keys.
- **Migration pattern** (proven, reused 6×): read a persisted `tam_migrated_*` flag; if `done`, defensive
  no-op; else **snapshot/back up → transform in place → set flag**. Idempotent by construction, never
  re-runs, never invents or discards data. **This is the exact template UX-006 legacy binding must use.**

### 2.3 Navigation & routing
- Flat `State.view` switch in `renderViewContent` over **one** `NAV_GROUPS` manifest (`shell-render.js`).
  **No workspace dimension above the view.** Persistent shell mounts once (UX-004E).

### 2.4 Identity / authorization (as-found)
- **None.** A repo-wide search for `currentUser` / `authenticat` / `login` / `session` / `role` /
  `permission` / `ownerId` returns **no production identity concept** (only ARIA `role=` attributes, the
  view name "Payroll Workspace", and `global-search.js`'s comment that it "knows NOTHING about
  roles/auth/currentUser/workspace"). TAM OS v2.9.0 is **single-user, single-scope, anonymous-local**.
- **Unguarded record resolvers:** `empById`, `contractById`, `payrollPlanById` (`people-core.js:288-290`)
  resolve **any** record by id — the §9 self-scope invariant must wrap these.
- **ID utility:** `uid(prefix)` (`utils.js:2`) = `prefix + base36(random) + base36(time)`, client-side;
  `nextEmployeeCode()` for employee codes. Reusable for `User`/`Workspace`/`Membership` ids.

### 2.5 Frozen UX-005 surfaces (must be preserved — see §16)
Data Grid (`js/core/data-grid.js`, harness 36), Global Search (`js/core/global-search.js` +
`global-search-ui.js`, harness 26), Action Center, navigation shell, design tokens, responsive/a11y
foundation, branding. Global Search and Data Grid are **explicitly source-agnostic** and already carry a
"scope-safety seam" (they only rank the document set they are handed) — the key enabler for §15/§16.

---

## 3. Workspace Semantics — Current vs Target

**Current (v2.9.0):** "workspace" is **implicit** — the entire `State` is one anonymous local workspace
with company-wide scope; "Payroll Workspace" is a view label, not an ownership boundary. No ownership
exists on any record.

**Target (UX-006, per UX-005-Arch §3–§9, frozen):** two explicit **workspace types**, **both of which
v3.0.0 must ship and validate** (Decision Q2, §1A) —
- **Executive Workspace** — `ceo` principal, scope **ALL_COMPANY**; owns every existing module unchanged.
- **Personal Workspace** — `employee` principal, scope **SELF** only; a separate, purpose-built experience
  with its **own** navigation manifest (not a filtered `NAV_GROUPS`); read-only except **submit own
  overtime request** (the single approved employee mutation). Employee capability stays intentionally
  minimal and policy-driven — **no generic employee CRUD**. Shipping both principals (not a CEO-only
  abstraction) is what proves the scope and authorization architecture against a lower-privilege principal.

Assumptions that become invalid once >1 principal exists: (a) every resolver returns any record; (b)
`State.view` alone determines what is shown; (c) settings/UI prefs are global; (d) all data is readable by
the active user.

---

## 4. Entity Ownership — Current Assumptions

Today every entity is **implicitly company/system-owned, single-scope**. There is no per-record owner.
The target classification (recommendation, §10) introduces ownership without changing business fields.

---

## 5. Identity Domain Model (recommendation)

Three concepts kept **strictly distinct** (never conflated):
- **Identity** — *who* the principal is (a `User` + the employee/CEO linkage).
- **Authentication** — *how* identity is proven (deferred; see §7). **UX-006 introduces identity, not a
  real authentication mechanism.**
- **Authorization** — *what* the identity may do (roles → permissions → policy; §12–§14).

### 5.1 Proposed minimal `User` contract
| Field | Purpose | Req? | Stability | Persistence | Backend-compat | Privacy |
|---|---|---|---|---|---|---|
| `id` | stable principal identifier | **req** | immutable | persisted | maps to backend user id | non-sensitive opaque id |
| `displayName` | UI label | **req** | mutable | persisted | mirrors backend profile | low (name only) |
| `principalType` | `'ceo' \| 'employee'` | **req** | immutable per user | persisted | maps to backend role claim | non-sensitive |
| `employeeId` | link to `State.employees[].id` when `principalType==='employee'` | cond. | immutable | persisted | join key | links identity ↔ HR record |
| `email` | optional contact / future auth handle | opt | mutable | persisted **only if needed** | future auth handle | **PII — collect only if required** |

**Deliberately excluded now** (data minimization, §25): password/hash, tokens, avatar binary, phone,
last-login, address. No credential material is ever stored client-side.

---

## 6. `currentUser` Contract (recommendation)

- **Shape:** `currentUser` is a **resolved `User` object** (not a raw id) exposed through a single
  accessor/selector (e.g. `getCurrentUser()`), backed by `State.identity.currentUser`. UI reads the
  selector; **no module mutates it directly** except the identity provider.
- **Nullability:** `currentUser` **may be `null`** — meaning *identity unresolved* (bootstrap not yet
  complete, or no principal selected). Null is a **fail-closed** state: authorization denies, and
  workspace-scoped data does not hydrate.
- **Bootstrap:** during `loadState()` identity resolves *after* storage/migration and *before* workspace
  resolution (§18/§27). Until resolved, `currentUser === null` and the app shows an identity-resolution
  state, never company data.
- **Provider seam:** `currentUser` is supplied by an **`IdentityProvider` interface**, not hard-wired
  (Decision Q1, §1A). The initial client provider performs **provider-based local principal selection** —
  it owns the set of available principals (at minimum `ceo` + `employee`, Decision Q2) and resolves the
  currently-selected one; this is an identity abstraction, **not** real authentication. A future
  backend/session provider implements the same interface with **zero call-site changes**.
- **Invariant:** *`currentUser` identifies the active application principal; it never implies
  authentication unless supplied by a trusted auth provider.* (§28)

---

## 7. Authentication Boundary (accurate trust statement)

**Chosen model (owner-approved, Decision Q1 §1A): (C) provider-based local principal selection as an
identity abstraction with future authentication compatibility.** UX-006 introduces an **identity primitive
and an `IdentityProvider` seam**, plus a **provider-based local principal-selection** mechanism — **not**
real authentication. It must not be represented as secure login, account authentication, session security,
credential verification, or an authorization security boundary. **Explicit, non-overclaimed limitations
(client-only architecture):**
- Client-side identity can be **spoofed** by editing `localStorage`/`State`; the browser owner has full
  control of their device. **Client-side role/permission checks are UX enforcement, not security.**
- No credential verification, no session integrity, no server-enforced authorization exists or is
  implied. §22 of UX-005-Arch is a *requirement*, satisfiable as real security **only** by a future
  backend.
- Therefore UX-006 **must not describe** any client check as "secure authorization." Documentation and
  code comments must state the trust boundary exactly: *these checks shape the UX and prevent accidental
  cross-scope access within a single trusted local session; they are not a security control against a
  motivated local actor.*

---

## 8. Personal Workspace & Workspace Contract (recommendation)

Per UX-005-Arch §4/§9 (frozen). Proposed **`Workspace`** contract (minimal):
| Field | Purpose | Notes |
|---|---|---|
| `id` | stable workspace id (`uid('ws')`) | immutable |
| `type` | `'executive' \| 'personal'` | drives nav manifest + scope |
| `name` | display label | Executive = company name; Personal = employee display name |
| `ownerId` | `User.id` of the owner | Personal: the employee; Executive: the CEO |
| `scope` | `'ALL_COMPANY' \| 'SELF'` | derived from `type`; the data-scope key |

**Personal Workspace rules (frozen §4/§6/§7):** exactly one owner (immutable), created automatically for
an employee principal, **not shareable, not deletable, not member-bearing** in the initial model; own
navigation manifest; read-only except submit-own-overtime. **Executive Workspace** = the current
experience unchanged, scope ALL COMPANY, CEO-owned. **Membership** (§11) is **deferred** — the frozen
model is single-owner per workspace with no co-members, so a `WorkspaceMembership` table is **not**
required for v3.0.0.

---

## 9. Ownership Matrix (recommendation)

| Entity / domain | Owner type | Owner id | Read scope | Write scope | Migration | Search visibility | Deletion |
|---|---|---|---|---|---|---|---|
| Transactions (`txns`) | Workspace (Executive) | exec `ws.id` | CEO: all | CEO only | bind to Executive ws | Executive only | CEO only |
| Employees | Workspace (Executive) | exec `ws.id` | CEO: all; Employee: **self record only** | CEO only | bind to Executive ws | Exec: all; Personal: self | CEO only |
| Contracts | Workspace (Executive) | exec `ws.id` | CEO: all; Employee: **own** | CEO only | bind to Executive ws | Exec: all; Personal: own | CEO only |
| Payroll plans / adjustments | Workspace (Executive) | exec `ws.id` | CEO: all; Employee: **own** | CEO only | bind to Executive ws | Exec: all; Personal: own | CEO only |
| Overtime records | Workspace (Executive) | exec `ws.id` | CEO: all; Employee: **own** | CEO; **Employee: submit own request only** | bind to Executive ws | Exec: all; Personal: own | CEO only |
| Company accounts / recurring / monthly plans / import batches | Workspace (Executive) | exec `ws.id` | CEO only | CEO only | bind to Executive ws | Executive only | CEO only |
| Audit log | System | — | CEO only | append-only (system) | unchanged | not searchable | never |
| Backups | System | — | CEO only | system | unchanged | not searchable | CEO only |
| Company settings | Workspace (Executive) | exec `ws.id` | CEO only | CEO only | unchanged | n/a | n/a |
| **User** | System (identity) | — | self + CEO | identity provider | new | not searchable (or self only) | governed |
| **Workspace** | System (identity) | `ownerId` | owner | identity provider | new (created at bind) | n/a | Personal: never |
| Personal UI prefs (future) | User | `user.id` | self | self | new (per-user key) | n/a | with user |

**Key point (owner-confirmed ownership model):** business data stays **Executive-workspace-owned** (company
data is the CEO's). The Employee's SELF-only *read* access is a **scope filter over Executive-owned data
keyed by `user.employeeId`** (or the appropriate source-grounded relationship), not a transfer of
ownership. The Personal Workspace is **not** architected by duplicating or re-homing company records — it
provides a SELF-scoped access context over the canonical company records. Explicitly preserved:
- **one canonical business record** per entity (company-wide canonical storage);
- **no employee-owned duplicate** payroll/employee records;
- **SELF visibility derived** through scoped resolvers/policies, not by copying data;
- existing business records remain **canonical company / Executive Workspace data**.

This avoids re-homing any existing record.

---

## 10. Membership, Roles, Permissions

- **Membership (§11):** **deferred.** The frozen model has single-owner workspaces with no co-members;
  introduce `WorkspaceMembership` only if a future product decision adds shared workspaces. Recommend
  the *derived* stance for now (owner ⇒ implicit sole member).
- **Roles (§12) — minimal vocabulary:** exactly two principal types map to two roles: **`ceo`**
  (Executive, ALL COMPANY, full existing controls) and **`employee`** (Personal, SELF ONLY, read +
  submit-own-overtime). **No `admin`/`viewer`/generic RBAC** — none is justified by the frozen product
  model; adding them requires a new product decision. Roles are **workspace-scoped** (a principal's role
  is defined by which workspace type they own/inhabit).
- **Permissions (§13) — centralized capability check, not scattered role checks.** Recommend a single
  pure policy function `can(principal, action, resource) → boolean` (plus thin named helpers e.g.
  `canSubmitOwnOvertime`, `canReadEmployeeRecord`) living in one module (e.g. `js/core/authz.js`, new in
  UX-006C). Forbid scattered `if (user.role === 'ceo')` in views (verifier-guarded, §30). Candidate
  vocabulary, retained only where the frozen model justifies it:
  `workspace.read`, `employee.record.read.self`, `contract.read.self`, `payroll.read.self`,
  `overtime.read.self`, `overtime.submit.self`, and the full Executive set `company.*` (CEO only). A CEO
  gets `company.*`; an employee gets only the `*.self` read set plus `overtime.submit.self`.

---

## 11. Authorization Enforcement Boundaries (per UX-005-Arch §8/§22, frozen)

Four independent layers — **UI hiding is not authorization**:
1. **Workspace selection** — principal resolves to exactly one workspace type.
2. **Navigation/route** — the Personal Workspace has its **own** manifest; executive views are **not
   reachable** via `State.view`, nav helpers (`hrNavTo`), or deep-link for an employee principal.
3. **Record/data retrieval** — every resolver enforces `requested.employeeId === currentUser.employeeId`
   for an employee (wrap `empById`/`contractById`/`payrollPlanById`).
4. **Mutation/action** — every write passes the centralized policy `can(...)`; the only employee-true
   mutation is submit-own-overtime.
Checks belong at the **mutation boundary and the resolver boundary**, not only in the view. All four fail
**closed** on unknown/unresolved state.

---

## 12. Frozen-Surface Implications (no change in this discovery)

- **Global Search (§15):** GS is already scope-safe — it ranks only the document set it is handed
  (`collectGlobalSearchDocuments`). The **only** UX-006 change is *what documents the caller supplies*:
  for an employee principal, the collector must be handed a **self-scoped** document set (own
  contract/payroll/overtime + Personal nav), filtered **before** ranking/rendering so inaccessible
  entities never enter the engine. **Do not modify the GS engine, ranking, grouping, or the document
  contract; do not break harness 26.** Transaction-entity search remains deferred. Recommendation:
  UX-006B establishes the *scope-provisioning* policy at the call site only.
- **Data Grid (§16):** DG is source-agnostic; it renders the rows it is given. UX-006 authorization
  affects **the rows/actions the caller passes** (row visibility = pre-filtered set; action visibility =
  policy-gated buttons) and the **mutation handlers behind row actions** (must call `can(...)`). **Do not
  modify `data-grid.js`; keep harness 36.** Mixed-permission bulk selections resolve per-action
  eligibility (the existing "selection generic; actions own eligibility" rule, Constitution §8.5).
- **Action Center (§17):** already navigation-only; when identity exists, its navigation targets must be
  workspace-appropriate and any action must pass `can(...)`. Unauthorized actions are **absent** from an
  employee's Action Center (not disabled). No change in this discovery.
- **Navigation/workspace context (§18):** introduce `State.identity.currentUser`, `activeWorkspace`,
  `availableWorkspaces`; Personal uses a second manifest. Initialization order in §18/§27. No switcher UI
  built here.

---

## 13. Storage & Schema Strategy (recommendation)

- **Persistence is evidence-based, not assumed (UX-006A storage correction).** UX-006A must prefer the
  **smallest architecture that proves the identity contract**. The persisted keys formerly named as likely
  UX-006A additions (`tam_users_v1`, `tam_active_principal_v1`, and a `tam_workspaces_v1`) are **NOT
  mandatory UX-006A requirements**. Distinguish:
  - **Required in UX-006A (no persistence assumed):** the `User` contract; the `IdentityProvider` seam; the
    `currentUser` selector/contract; runtime identity state; **CEO + Employee representative principals**
    (Decision Q2); fail-closed identity behavior; identity-focused tests/verifier guardrails. A
    fixture/default/local provider **may supply principals at runtime without any persisted identity
    storage** if that is sufficient to prove the contract.
  - **Conditional / evidence-based (persist only on a concrete need):** persistence of the available
    principals, of the selected principal, or of any identity-related local state. **Persist principal
    selection only if there is a concrete UX-continuity requirement** (e.g. the selected principal must
    survive reload). Do **not** create storage coupling merely because the architecture can support it.
  - If persistence is later justified, use **new dedicated additive keys** (following the per-dataset
    convention, e.g. `tam_users_v1` / `tam_active_principal_v1`) — never by overloading existing business
    keys, which stay byte-stable. `Workspace` persistence belongs with the UX-006B workspace-binding
    migration, not with the UX-006A identity foundation.
- **Existing business keys stay unchanged in shape**; ownership is expressed by the **derived
  Executive-workspace binding**, not by adding `ownerId` to every record (avoids a mass in-place
  migration of business data). If a per-record `ownerId` is later required, it is an additive field with
  its own guarded migration.
- **Schema version (§20):** **`SCHEMA_VERSION` should remain `6` for the identity foundation** (UX-006A:
  new keys, no transformation of existing persisted business data). The **first bump to `SCHEMA_VERSION
  7`** should occur at **UX-006B/E**, when the legacy-binding migration first *transforms or governs*
  persisted business data (workspace binding + self-scope governance). Rationale: bump only for a real
  data migration (Constitution §7.2); a staged bump keeps the identity foundation reversible and low-risk.
  Do **not** change `SCHEMA_VERSION` in this discovery **or in UX-006A**. **Architecture rule (owner-
  affirmed): schema-version changes follow actual persisted-schema migrations — never milestone names or
  feature labels.** `SCHEMA_VERSION = 6` is preserved through UX-006A unless UX-006A introduces a real
  persisted-state migration (it should not). The likely `SCHEMA_VERSION 7` transition remains associated
  with the workspace-binding / ownership migration in a later UX-006 phase (UX-006B/E).

---

## 14. Legacy v2.9.0 Migration Strategy (critical — no data loss)

**Chosen strategy:** **bind existing local data to the Executive Workspace of the first resolved CEO
principal** (do *not* re-home business data into a Personal Workspace). Rationale: all v2.9.0 data is
company/operational data owned by the CEO; the Employee's self view is a *filter*, not a *move*.
- **Trigger:** one-time, at `loadState()` after existing migrations, guarded by a new flag
  `tam_migrated_workspace_v3` — following the proven §2.2 pattern.
- **Steps:** snapshot/back up → ensure a CEO `User` + Executive `Workspace` exist → record the binding
  (Executive `ws.id`) → set flag. Existing business records are **not rewritten** (binding is derived);
  if a later phase adds per-record `ownerId`, that is a separate additive guarded migration.
- **Idempotency:** flag-guarded; re-run is a defensive no-op (§2.2).
- **Failure/recovery:** back-up-first means a failed transform is recoverable; partial state is detected
  by the existing Integrity Check pattern; missing identity → migration **defers** (does not fabricate a
  user) and the app stays in the identity-resolution state; corrupted legacy state → surfaced, never
  silently dropped. **No v2.9.0 data is deleted or overwritten.**

---

## 15. ID, Backend-Compatibility, Bootstrap, Failure States

- **ID strategy (§22 of assignment):** reuse `uid('user')` / `uid('ws')` / `uid('mem')`; client-generated
  ids are opaque strings — future backend ids drop in behind the `IdentityProvider`/repository seam.
  Migration-generated ids follow the same generator. No new ID code required for the foundation.
- **Backend compatibility (§23):** define **interfaces, not infrastructure** — `IdentityProvider`
  (supplies `currentUser`), `WorkspaceProvider` (supplies workspaces/scope), and an `AuthzPolicy`
  (`can(...)`). The existing Repository/Transport seam (ADR-013) is the persistence adapter point. UI and
  policy call the interfaces; the client implementations wrap local state today; a backend implements the
  same interfaces later with no call-site change. **No UI couples directly to `localStorage` or fake auth.**
- **Bootstrap order (§27):** `load storage → run existing + workspace-binding migration → resolve identity
  (IdentityProvider) → resolve active workspace (WorkspaceProvider) → derive permissions (AuthzPolicy) →
  hydrate workspace-scoped state → render`. Identity/workspace resolve **after** storage/migration and
  **before** render; any failure yields a fail-closed identity-resolution state, never company data.
- **Failure states (§26) — all fail closed:** no current user → deny + no hydration; missing/invalid/
  deleted/stale workspace → fall back to the principal's owned workspace or identity-resolution state;
  unknown role/permission → deny; failed/partial migration → recover from snapshot, surface, do not
  proceed; unsupported schema → refuse to run rather than corrupt; storage unavailable → read-only degrade
  with a clear message. **Never grant access on unknown authorization state.**

---

## 16. Frozen v2.9.0 Surfaces (must be preserved)

UX-005A Action Center · UX-005B Data Grid (`data-grid.js`, harness **36**) · UX-005C design tokens
(`css/tokens.css` `60dde600…`, CSS golden `5528908b…`) · UX-005D Global Search (`global-search.js` +
`global-search-ui.js`, harness **26**, document contract, ranking) · UX-005E responsive/modal containment
· UX-005F accessibility baseline · navigation shell · branding + Social Preview · **published v2.9.0
artifact + tag (`598edef0`), and v2.8.6 / v2.8.5 / v2.8.4 releases — all immutable.** No UX-006 phase may
modify a frozen surface without an explicit later authorization; the verifier's frozen-surface checks and
GS/DG harnesses guard them.

---

## 17. Architecture Invariants (UX-006)

1. Every persisted workspace-scoped entity resolves to exactly one workspace owner (Executive, until a
   product decision adds others).
2. A Personal Workspace has exactly one immutable owner and no members.
3. `currentUser` never implies authentication unless a trusted auth provider supplied it.
4. Unknown/unresolved identity, role, permission, or workspace state **fails closed** (deny + no
   hydration).
5. An employee resolver returns a record only if `record.employeeId === currentUser.employeeId`.
6. Global Search never exposes entities outside the principal's readable scope (scope is applied at the
   collector call site, before the engine).
7. UI visibility is never the authorization boundary; every mutation passes the centralized policy.
8. The legacy workspace-binding migration is idempotent and never deletes or overwrites v2.9.0 data.
9. `SCHEMA_VERSION` bumps only for a real persisted-data migration; the identity foundation adds keys
   without a bump.
10. Frozen UX-005 surfaces, published artifacts, and historical tags remain immutable.

---

## 18. Test & Verifier Strategy (behavioral coverage first)

**Required new runtime-harness categories** (Node, pure-logic, mirroring existing harnesses):
- **Identity:** user resolution; null/unresolved identity fails closed; invalid identity rejected.
- **Workspace:** Personal Workspace auto-create for an employee; single immutable owner; active-workspace
  resolution; invalid/stale workspace recovery.
- **Authorization:** `can(...)` allow/deny/unknown; CEO full; employee self-read; employee
  submit-own-overtime allowed; every other employee write denied; destructive ops denied for employee.
- **Scope resolvers:** wrapped `empById`/`contractById`/`payrollPlanById` return self-only for an
  employee; cross-scope id returns nothing (no leak).
- **Migration:** v2.9.0 → workspace-bound; idempotent rerun; partial/corrupted state recovery; missing
  identity defers without fabrication; no data loss.
- **Visibility:** navigation manifest per principal; GS collector self-scope; DG row/action gating; Action
  Center action gating.
- **Preservation:** GS harness stays **26**, DG harness stays **36**, and no existing harness regresses.

**Verifier guardrail categories** (`tools/verify-build.js`, additive, per phase): identity/`currentUser`
contract present; centralized policy module exists and **no scattered `user.role ===` checks** in views;
workspace ownership invariants; schema/version consistency (bump only with a migration present); legacy
migration flag + idempotency present; frozen-surface preservation (GS/DG/tokens/golden unchanged);
release-identity + artifact integrity. **Do not weaken existing checks; do not modify the verifier in this
discovery.**

---

## 19. Architecture Decisions (ADR-style; DISCOVERY — not implemented)

Each records context / options / recommendation / rationale / tradeoffs / risks / deferred. None is
implemented; final ADRs are authored in `docs/03-adr/` when the owning phase is authorized.

- **ADR-006-01 — Identity representation.** *Options:* raw id vs `User` object vs external claim.
  *Decided (owner-approved, §1A):* a minimal `User` object (§5) behind an `IdentityProvider` using
  **provider-based local principal selection** — an identity abstraction, not authentication. *Rationale:*
  stable contract, backend-swappable. *Tradeoff:* an extra indirection. *Deferred:* email/PII inclusion.
- **ADR-006-02 — `currentUser` contract.** *Recommend:* nullable resolved `User` via a single selector,
  fail-closed on null, provider-supplied (§6). *Rationale:* decouples UI from auth. *Risk:* callers
  reading stale identity — mitigated by a single accessor.
- **ADR-006-03 — Personal Workspace model.** *Recommend:* separate experience, own manifest, single
  immutable owner, non-shareable/non-deletable (§8, frozen §4). *Tradeoff:* no sharing now (accepted).
- **ADR-006-04 — Ownership model.** *Recommend:* business data stays Executive-workspace-owned; employee
  SELF access is a scope filter keyed by `employeeId`, not re-homing (§9). *Rationale:* zero mass
  migration of business records.
- **ADR-006-05 — Membership model.** *Recommend:* **defer**; single-owner workspaces, derived membership
  (§10). *Deferred:* shared workspaces.
- **ADR-006-06 — Role/permission strategy.** *Recommend:* two roles (`ceo`/`employee`), centralized
  capability policy `can(...)`, no generic RBAC (§10/§12). *Risk:* role proliferation — verifier-guarded.
- **ADR-006-07 — Authorization enforcement boundary.** *Recommend:* four fail-closed layers, checks at
  resolver + mutation boundaries (§11, frozen §8/§22). *Rule:* UI hiding ≠ authorization.
- **ADR-006-08 — Storage/schema strategy.** *Recommend:* **evidence-based identity persistence** — UX-006A
  persists nothing unless a concrete UX-continuity need is shown; a runtime provider may supply CEO +
  Employee principals with no persisted key. If justified, use additive dedicated keys. No `SCHEMA_VERSION`
  bump for the foundation (stays `6`); schema changes follow real persisted-data migrations only, so the
  first bump is at the workspace-binding migration (§13).
- **ADR-006-09 — Legacy migration strategy.** *Recommend:* bind existing local data to the CEO's Executive
  Workspace, flag-guarded, idempotent, back-up-first, no data loss (§14).
- **ADR-006-10 — Backend-compatibility boundary.** *Recommend:* `IdentityProvider`/`WorkspaceProvider`/
  `AuthzPolicy` interfaces over the existing Repository/Transport seam; no UI↔storage/auth coupling (§15).

---

## 20. UX-006 Phase Decomposition (recommended; reconciles UX-005-Arch §21)

The frozen §21 labeled A–E starting at "Personal Workspace Foundation". Discovery finds the **identity
primitive is the hard prerequisite for everything** (§23.1 conflict), so an explicit **Identity
Foundation** must come first. Recommended sequence (maps onto §21):

| Phase | Objective | Allowed surfaces | Forbidden | Schema | Key tests | Acceptance | Stop-if |
|---|---|---|---|---|---|---|---|
| **UX-006A — Identity Foundation** | `User` contract, `currentUser` selector, `IdentityProvider` seam (provider-based local principal selection), runtime identity state, **CEO + Employee representative principals**; **no real auth** | new `js/core/identity.js`, state, verifier, new harness; **identity persistence only if a concrete UX-continuity need is shown** (then additive `tam_users_v1`/`tam_active_principal_v1`) | any auth/session/token/credential; assumed identity persistence with no evidenced need; UI redesign; touching business logic/frozen surfaces | **6** (no bump) | identity resolution + null fail-closed; both `ceo` and `employee` principals resolvable | `currentUser` resolvable/nullable, fail-closed; CEO + Employee principals present; GS 26 / DG 36 intact | real auth required |
| **UX-006B — Personal Workspace & Self-Scope** | `Workspace` contract, Personal Workspace, active workspace, scope-guarded resolvers, workspace-binding migration | new `js/core/workspace.js`, resolver wrappers, second nav manifest, migration, verifier/harness | executive-module changes; GS/DG engine edits | **→ 7** (binding migration) | workspace resolution, self-scope resolvers, migration idempotency/no-loss | employee reads self-only; migration idempotent; no data loss | ambiguous ownership risks loss |
| **UX-006C — Authorization** | roles, centralized `can(...)` policy, mutation enforcement, employee submit-own-overtime state | new `js/core/authz.js`, overtime submit path, verifier/harness | scattered role checks; new employee permissions | 7 | allow/deny/unknown; submit≠approve | all four layers fail-closed; only approved mutation | new permission needed |
| **UX-006D — Workspace UI Integration** ⚠️ **row SUPERSEDED in part — see §20A** | workspace/account context UI, Personal navigation, ~~unauthorized states~~ | shell/nav (authorized), Personal views | changing frozen business behavior | 7 | ~~nav-per-principal; unauthorized routes blocked~~ | ~~employee never reaches exec routes/data~~ | UI-only "authorization" |
| **UX-006E — Persistence & Migration Hardening** | schema migration hardening, legacy/corruption/recovery, compatibility | migration/storage, verifier/harness | product-scope creep | 7 | partial/corrupt/rerun/missing-identity | recoverable, idempotent, no loss | unsafe migration |
| **UX-006F — Integration Freeze & v3.0.0 Readiness** | cross-surface policy integration (GS/DG/AC where authorized), a11y, verifier expansion, regression suite, freeze | authorized integration points, docs | scope beyond frozen model | 7 | full authorization regression + privacy | platform frozen; v3.0.0 ready | regression in a frozen surface |

**Parallelism:** UX-006A must precede all; B depends on A; C depends on B; D depends on C; E overlaps
B/C on migration; F is last. Documentation/test scaffolding for later phases may be drafted in parallel.

---

## 20A. UX-006D — supersession of the pre-C3 authorization language

The UX-006D row in §20 was written **before** UX-006C existed. Its authorization language was overtaken by
the **UX-006C3 Integration Freeze** (merge `675cb314`), which is now frozen and authoritative. The row above
is retained for auditability with the overtaken clauses struck through; **this section is operative where the
two disagree.**

**SUPERSEDED — do not implement.** The following pre-C3 clauses are void:

| Superseded clause (§20 row) | Superseded by (frozen UX-006C3 ruling) |
|---|---|
| *"unauthorized states"* as a navigation concept | Navigation has no unauthorized state |
| *"nav-per-principal"* | Navigation is **VISIBLE + NORMAL** for CEO, Employee and null alike — never principal-filtered |
| *"unauthorized routes blocked"* | There is **no route-level authorization guard**; `renderView()` contains zero `can(...)` checks |
| *"employee never reaches exec routes/data"* (as a *routing* claim) | **View access ≠ mutation authority.** A denied principal may reach any view; the mutation boundary is the authorization source of truth. Record *scope* remains enforced by the frozen UX-006B resolvers — that part was never a routing rule |

**Still operative from the original row:** workspace/account context UI, Personal navigation presentation, the
`schema 7`→ *(actual: 6, unchanged)* constraint that D changes no frozen business behavior, and the stop-if
condition **UI-only "authorization"** — which C3 restates precisely: UI availability is an **affordance**, never
enforcement.

### UX-006D phase decomposition (operative)

| Sub-phase | Scope | Status |
|---|---|---|
| **UX-006D1 — Reachable Principal Selection** | the "Acting as" selector making UX-006A principals reachable at runtime | **implemented, merged & frozen** (merge `4a53a35`) |
| **UX-006D2 — Principal & Workspace Presentation Polish** | presentation of principal/workspace context, disabled-control legibility, sidebar / Quick Action / Action Center presentation, responsive behaviour of those elements | **implemented, merged & frozen** (merge `5163cfce`) |
| **UX-006D3 — Cross-surface Presentation Consistency & Acceptance** | cross-surface consistency pass, empty-state presentation, responsive acceptance, and the UX-006D presentation freeze | **merged & frozen** (merge `e76460dc`) ([plan](UX-006D3-Cross-Surface-Presentation-Implementation-Plan.md)) |

**UX-006D is COMPLETE / FROZEN** (D1 `4a53a35`, D2 `5163cfce`, D3 `e76460dc`). D3 is the last phase of the milestone; nothing in UX-006D
remains open after it. Global Search scope wiring is explicitly **not** part of that completion — it stays a
separate future functionality milestone.

**Global Search principal-aware scope wiring is OUTSIDE UX-006D.** It is a **data-scope behaviour** change, not
presentation, and is carried as a **separate future functionality milestone**. Neither D2 nor D3 may implement
it. (Earlier documents that "defer live GS scope wiring to UX-006D" are superseded on that point.)

**UX-006D owns presentation only.** It may change appearance, position, spacing, grouping, responsive
arrangement, visual prominence, iconography, disabled-control styling and labels whose semantics are unchanged.
It may **not** change `can(...)` results, the action vocabulary, route semantics, mutation semantics,
persistence, schema or principal policy.

**v3.0.0 success criteria (Decision Q2):** v3.0.0 ships and validates **both** canonical access models —
CEO (`ceo` / Executive / `ALL_COMPANY`) and Employee (`employee` / Personal / `SELF`). The authorization
suite must prove the lower-privilege Employee path (self-only read; every non-approved write denied; only
`submit-own-overtime` permitted where its authorized phase is reached), not merely a CEO identity
abstraction. Shipping a CEO-only build does not satisfy v3.0.0.

### 20.1 UX-006A implementation-planning status

- **GO for UX-006A implementation *planning*.** After the owner decisions in §1A, **no unresolved product
  decision blocks UX-006A planning.** The identity contract, provider seam, `currentUser` contract,
  principal set (CEO + Employee), fail-closed behavior, and the evidence-based persistence stance are all
  settled at the architecture level.
- **NOT YET AUTHORIZED for UX-006A *implementation*.** No code, runtime files, storage, schema, verifier,
  harness, or artifact change is authorized by this document. Implementation begins only under a subsequent
  Sprint Assignment (per `README.md`). This follow-up remains architecture documentation only.

---

## 21. Dependency Graph

```
Identity contract (User)  ──► currentUser (IdentityProvider)
        │                            │
        ▼                            ▼
Workspace ownership  ──►  active workspace / scope-guarded resolvers  ──► workspace-binding migration
        │                            │                                          │
        └────────────► Role/permission policy (can) ──► mutation enforcement    │
                                     │                                          │
                                     ▼                                          ▼
                        UI / navigation integration  ◄────────  persistence & migration hardening
                                     │
                                     ▼
                          UX-006 integration freeze (v3.0.0 readiness)
```

---

## 22. Risk Register

| # | Risk | Likelihood | Impact | Mitigation | Phase |
|---|---|---|---|---|---|
| 1 | Accidental v2.9.0 data loss in migration | Low | **Critical** | back-up-first, idempotent, no-rewrite binding, integrity check | 006B/E |
| 2 | Cross-workspace/self-scope leakage | Med | High | wrap resolvers; scope at GS collector; fail-closed | 006B/C |
| 3 | UI-only authorization mistaken for security | Med | High | four-layer enforcement; §7 trust statement; verifier bans scattered checks | 006C/F |
| 4 | Fake auth mistaken for real security | Med | High | explicit trust boundary docs; `IdentityProvider` seam; no credential storage | 006A |
| 5 | Over-engineered RBAC | Med | Med | two roles only; capability policy; verifier role-proliferation guard | 006C |
| 6 | Schema incompatibility / premature bump | Low | High | staged bump only with a migration; §13 | 006B/E |
| 7 | Circular bootstrap dependency | Low | Med | fixed order (§15/§27), fail-closed states | 006A/B |
| 8 | Frozen-surface regression (GS/DG/AC) | Med | High | no-engine-edit rule; keep harness 26/36; verifier frozen checks | all |
| 9 | Global Search leakage | Med | High | scope at collector before ranking; do not touch engine | 006B |
| 10 | Backend lock-in | Low | Med | interfaces not infrastructure; Repository/Transport seam | 006A/B |
| 11 | Identity/privacy over-collection | Med | Med | data minimization (§25): no email/PII unless required; no credentials | 006A |
| 12 | Published artifact/tag mutation | Low | **Critical** | immutability checks; never retag/replace | all |

---

## 23. Open Questions

**Resolved by owner decision (formerly gating — see §1A):**
- ~~(Q1) Principal-selection mechanism for the client.~~ **RESOLVED — APPROVED:** provider-based local
  principal selection as an identity abstraction (not authentication). See §1A, §6, §7.
- ~~(Q2) Does an employee principal exist locally in v3.0.0?~~ **RESOLVED — APPROVED:** yes — v3.0.0 ships
  **at least both** CEO and Employee principals; self-scope ships in v3.0.0. See §1A, §3, §20.

**No unresolved product decision blocks UX-006A planning.** The only open items are phase-scoped or
out-of-scope, categorized below.

**Must resolve before the later UX-006 phase noted (not before UX-006A):**
- (Q3) Employee-submitted overtime state-machine details (Submitted/Pending) — before **UX-006C**.
- (Q4) Personal Documents scope — before **UX-006D**, and only if a product need is confirmed.

**Safely deferred (revisit only if triggered):**
- (Q5) Per-record `ownerId` vs derived binding — revisit at **UX-006E** if a backend arrives.
- (Q8) Whether identity/selected-principal persistence is needed at all — evidence-based; decide during
  UX-006A/B on concrete UX-continuity evidence (§13). Default is no persistence.

**Beyond v3.0.0 (new product decision / separate milestone required):**
- (Q6) Shared workspaces / membership / additional roles — new product decision required.
- (Q7) Real authentication / backend authorization — separate infrastructure milestone.

Foundational identity/ownership semantics (§5–§14) and the two former product gates (Q1/Q2) are all
resolved. UX-006A planning is unblocked; implementation remains unauthorized until a Sprint Assignment.

---

## 24. Documentation Placement & Change Boundary

This is forward-looking approved direction → `docs/01-roadmap/` (precedent: UX-004/UX-005 docs). Canonical
name: this file. It does **not** belong in `docs/02-architecture/` (implemented-only) and does **not**
modify `ARCHITECTURE.md`/`AI_CONTEXT.md`/`README.md` to imply UX-006 exists. The only index update is one
roadmap-README row. No production JS/CSS/`dist/`/`APP_VERSION`/`SCHEMA_VERSION`/business/workflow/release/
tag change.

---

## 25. Confirmation — No Implementation Began

No UX-006 implementation was started. Incorporating the owner decisions (§1A) is a **documentation-only**
revision. No production/runtime/CSS/business code was written or changed; no `js/*`, CSS, storage, schema,
verifier, harness, or `dist/` artifact change was made; `APP_VERSION` stays `2.9.0` and `SCHEMA_VERSION`
stays `6`. No `currentUser`, authentication, workspace, ownership, role, permission, migration, or schema
change was implemented. The published v2.9.0 artifact, tag, and all historical releases remain immutable.
