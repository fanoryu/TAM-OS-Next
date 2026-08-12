# AI_CONTEXT.md — Repository Knowledge

This document captures the **current state** of TAM OS to help future contributors and
AI assistants get productive quickly. It is descriptive (what *is*), whereas
[`CLAUDE.md`](CLAUDE.md) is prescriptive (the timeless rules). For deep implementation detail and the
authoritative module map, see [`ARCHITECTURE.md`](ARCHITECTURE.md) — this file summarizes and points
there rather than duplicating it.

**As of the current source state:** v2.10.0 — "Governed Workspace"; `SCHEMA_VERSION` 6; `ACTIONS` 20.
**v2.10.0 is PUBLISHED and marked Latest**, from annotated tag `v2.10.0`. Its published asset
`tam-os-v2.10.0.html` (1,151,267 bytes, SHA-256
`60382271a6dcea23431fabb91e0d16abb03196e5cf64c6dc4da1e1af2c7fa704`) is byte-identical to the repository
artifact `dist/tam-os-v2.10.0.html`, which is frozen. Publication makes the verified artifact obtainable
— it is **not** a general-availability declaration. The controlled pilot is **APPROVED but NOT YET
LAUNCHED**, and no launch date is set.
**v2.9.0 — "Workspace Experience" — remains published and immutable** (no longer Latest; v2.10.0
supersedes it)
— annotated tag `v2.9.0` peels to the publication commit `598edef0`; the
GitHub Release is published (not draft, not prerelease), and its asset
`tam-os-v2.9.0.html` (1,049,018 bytes, SHA-256 `e7470ff5…ddcaf3ea`) is immutable and remains the pilot
rollback target.
**v2.8.6 remains published and immutable** (no longer Latest) — annotated tag
`v2.8.6` peels to
the release commit `7ac0092d8f60a00118c86e26a7dce429660017c9` on `main`, and the GitHub Release is published
(not draft, not prerelease) but is **no longer marked Latest** — v2.9.0 holds that marker. UX-004 is complete. **UX-005A (Executive Dashboard),
UX-005B (Data Grid Foundation), UX-005C (Design System Consistency), and MAINT-001 (repository
maintenance & official branding adoption, plus its follow-up backlog) are all merged to `main`.**
**UX-005D (Global Search) is merged to `main`**: a navigation-only `Ctrl/Cmd+K` command palette over a pure,
source-agnostic engine (`js/core/global-search.js`) plus an application adapter/palette
(`js/ui/global-search-ui.js`). It searches Employees, Contracts, Payroll, and navigable views (from the
canonical manifest, placeholders excluded) and activates results solely via `hrNavTo` — no execute/
approve/post/delete/persist, no storage/schema change. **Scope-safety (frozen for UX-006):** the engine
only ranks the document set it is handed, so a future Personal Workspace supplies a self-scoped set with
zero engine changes. Transaction entity results are deferred (no non-mutating focus route).
**UX-005E (Responsive & Density Polish) is merged to `main`**: a deliberately minimal, presentation-only
sprint whose sole change gives the shared `.modal` primitive viewport containment (`max-height:88vh;
overflow-y:auto` in `css/components.css`), so the finance Transaction Execute / Edit / Detail dialogs stay
inside short/mobile viewports and scroll internally. No JS, token, schema, storage, breakpoint, or
density-preference change; the table density invariant (td 9px/10px, th 8px/10px) and all UX-005B/UX-005D
architecture stay frozen. The three deferred responsive items (`.exec-timeline` reflow, `.form-grid`
mobile 1-col, KPI stacking) were empirically re-tested in UX-005F and confirmed **non-defective** at 480px,
so none were changed.
**UX-005F (Final Workspace Polish & Accessibility Hardening) is merged to `main`**: an
accessibility-hardening sprint implementing A1 skip-to-content + a real `<main>` landmark, A2 modal
Tab/Shift+Tab focus containment (on the existing single-install modal seam), A3
`role="dialog"`/`aria-modal`/`aria-labelledby` on the three finance transaction dialogs, A4 `aria-hidden`
on decorative nav glyphs, A5 focus-visible coverage for borderless controls, and A6 relocating Data Grid
`aria-sort` onto the `<th>`. Presentation/semantics only — no business logic, no token/schema/storage
change, no new breakpoint, no UX-006.
**UX-005A–F are complete and merged; the UX-005 Platform Freeze Review has been performed** (baseline
`main @ fd6cf536`; verifier 2001; 18 runtime harnesses / 1552 checks; artifact SHA `0026af50…`; CSS pin
`5528908b…`; tokens `60dde600…`). The review found the platform coherent and stable — no freeze-blocking
defect — with residual work (MAINT-001 follow-up, the four pre-existing CodeQL alerts, and UX-006 scope)
correctly deferred.
**MAINT-001 Follow-Up (branding integration) is merged** (`main`): a self-contained inline-PNG favicon
(resized from the official `assets/branding/tam-os-logo-secondary.png`), four true 1920×1080 dark-theme UI
screenshots under `assets/screenshots/` in a README **Product Preview** section, and a 1280×640
`assets/social/tam-os-social.png` (the GitHub social-preview **Settings upload remains a manual step**).
Repository/presentation only — no application CSS/JS change; `css/*` golden master and `tokens.css`
byte-identical.
**v2.9.0 Release Preparation is merged (PR #93) and v2.9.0 is published (PR #94 reconciled current-state
docs; the controlled publication then tagged and released it).** It carried the version identity forward
(`APP_VERSION` `2.8.6` → `2.9.0`, `APP_RELEASE_NAME` "Workspace Experience", `<title>`, in-app release
notes, and the release-identity verifier guardrails), authored the v2.9.0 `CHANGELOG`/`RELEASE_NOTES`
entries, and swapped the dev artifact to `dist/tam-os-v2.9.0.html` (deterministic, SHA `e7470ff5…`,
1,049,018 bytes; the superseded `tam-os-v2.8.6.html` dev artifact was removed per the release dist-swap).
`SCHEMA_VERSION` stays **6** (no migration); no application CSS/JS/business change (`css/*` and `tokens.css`
byte-identical); verifier 2014 → 2013. **The annotated `v2.9.0` tag (peeling to publication commit
`598edef0`) and its GitHub Release are published and marked Latest; the published asset is byte-identical
to the candidate.**
**UX-006 architecture baseline and UX-006A implementation plan are approved, merged, and frozen** (see
`docs/99-archive/roadmap-completed/UX-006-Identity-Personal-Workspace-Architecture.md` and
`docs/99-archive/roadmap-completed/UX-006A-Identity-Foundation-Implementation-Plan.md`). **UX-006A — Identity Foundation is
implemented, verified, merged, and frozen** (merge commit `73096303`; the `feature/ux-006a-identity-foundation`
branch has been deleted): a new `js/core/identity.js` core leaf providing the minimal `User` contract,
`PRINCIPAL_TYPES` (`ceo`/`employee`), CEO + Employee representative fixtures, a **canonical `IdentityProvider`
seam** (`getCurrentUser() → User|null` only, delegating through a single internal active-provider handle), a
**`LocalIdentityProvider`** dev/test adapter (`getAvailablePrincipals`/`selectPrincipal`, local-only), and the
single `getCurrentUser()` consumer façade — all **fail-closed** (`null` when unresolved; no default CEO;
malformed/throwing provider → `null`). It is **identity only, not authentication**: no password/token/session/
OAuth, no persistence (no new `tam_*` key), **no `State.identity` slice**, **no `app-bootstrap.js` change**,
`SCHEMA_VERSION` stays **6**, no UI/CSS, and no workspace/authorization. One new runtime harness
(`tools/verify-identity-foundation-runtime.js`, **33** checks) and additive `verify-build.js` guardrails
(verifier **2035**; runtime **1585 / 19**; GS **26** / DG **36**); the Employee `employeeId` is a **forward
reference** (shape-validated only, no `empById`, no record required). The current development artifact
`dist/tam-os-v2.9.0.html` is rebuilt deterministically — now **1,057,396 bytes**, SHA `fe353405…` — and is
distinct from the immutable **published** v2.9.0 Release asset (**1,049,018 bytes**, SHA `e7470ff5…`), whose
tag still peels to `598edef0`; neither the published asset nor the tag is modified.
**UX-006B — Personal Workspace & SELF-Scope is implemented, verified, merged, and frozen** (merge commit
`f40fc064`; the `feature/ux-006b-personal-workspace-selfscope` branch has been deleted). Owner amendment
**R1** made it a **headless** foundation: a new `js/core/workspace.js` core leaf binding
`User.employeeId → Employee.id`
(the opaque uid every business record stores as `record.employeeId`; the human `Employee.employeeId` code is
never used), deriving Executive (`workspace:executive:company`, system-owned, `ALL_COMPANY`) and Personal
(`workspace:personal:<Employee.id>`, `SELF`) workspaces, with a minimal public API — `getCurrentWorkspace()`,
`getScopedRecords(entityType)`, `WORKSPACE_TYPES` — over a centralized internal `ENTITY_SCOPE` predicate
registry and unchanged raw resolvers. All **fail-closed** (no principal / invalid linkage / unknown type ⇒
`null`/`[]`; never Executive/ALL_COMPANY escalation). **Global Search is intentionally left unchanged (R1):
live principal-aware GS source scoping is deferred to UX-006D**, when a reachable principal selector exists
(today `getCurrentUser()` is `null` by default, so wiring GS now would empty a shipped feature). No
persistence, no migration, `SCHEMA_VERSION` stays **6**, no `State.identity`, no `app-bootstrap.js` change,
no authorization, no UI/CSS. One new harness (`tools/verify-workspace-selfscope-runtime.js`, **31** checks)
and additive verifier guards: verifier **2058**, runtime **1616 / 20**, identity **33**, GS **26**, DG **36**;
dev artifact rebuilt deterministically — **1,066,037 bytes**, SHA `2621a69f…` — distinct from the immutable
**published** v2.9.0 asset (**1,049,018 bytes**, SHA `e7470ff5…`).
**UX-006C — Authorization is planned (merge `eb90b91`), and UX-006C1 — Authorization Foundation is
implemented, verified, merged, and frozen** (merge commit `27aa882`; the `feature/ux-006c1-authorization-foundation`
branch has been deleted; headless). A
new `js/core/authz.js` core leaf provides a centralized, **mutation-only** policy — frozen `ACTIONS` (no
`*.read`; reads stay a scope concern), a stable `can(action, resource?)` façade, an internal pure
`canPrincipal(principal, action, resource, ctx)`, and an internal `POLICY` action→predicate table. CEO is a
**pass-through**; Employee is **deny-by-default** with exactly one allowed mutation — `overtime.submitSelf`
(own in-scope Draft→Submitted). Defense-in-depth **AZ-1** scope precondition uses a new **internal,
explicit-principal** predicate `isInScopeForPrincipal(principal, entityType, record)` in `workspace.js` — so
`canPrincipal(principal,…)` is deterministic from its supplied principal and never depends on the
globally-selected `currentUser` (a current-context `isInScope` delegates to it). Both are backed by
`ENTITY_SCOPE`, **not** on `window`, **not** a fourth Workspace public API — the Workspace public API stays
exactly the three symbols; **AZ-2** fail-closed (unknown/indeterminate ⇒ deny, never a CEO fallback). It is
**headless**: **no** live business mutation is wired to `can(...)` (that is UX-006C2), no UI/Action
Center/nav/GS/DG change, no `State.identity`, no `app-bootstrap.js` change, no persistence (no `tam_*`),
`SCHEMA_VERSION` stays **6**, no authentication. One new harness (`tools/verify-authz-runtime.js`, **68**
checks) + additive verifier guards: verifier **2097**, runtime **1684 / 21**, identity **33**, workspace
**31**, GS **26**, DG **36**; dev artifact rebuilt deterministically — **1,077,844 bytes**, SHA `aac5d9d9…` —
distinct from the immutable **published** v2.9.0 asset (1,049,018 bytes, `e7470ff5…`). Owner product decisions
are resolved: **Q-OT** (employee may create/edit/delete own Draft + submit; no edit/delete/resubmit after
submission; Rejected is read-only), **Q-EXPORT** (denied), **Q-SELF-EDIT** (denied) — recorded for UX-006C2;
C1 wires none of these mutations. **UX-006C2 — Mutation Enforcement is COMPLETE**: C2A (HR), C2B (overtime),
C2C-1 (contract ops + payroll), C2C-2 (finance + import), C2C-3 (destructive/lifecycle) and C2C-4
(administrative domains) are all merged and frozen, and the user-reachable mutation-enforcement inventory is
**CLOSED** — every one of the 30 frozen boundaries is authorized, the rest explicitly ruled NOT APPLICABLE or
INDIRECTLY AUTHORIZED. `ACTIONS` is now **20** (the 17 after C2C-2 plus `import.undo`, `data.restore`,
`data.reset` from C2C-3). **UX-006C3 — Integration Freeze is COMPLETE, merged and frozen** — its decision
preparation is merged (`049ae0e`) and its implementation is merged (`675cb314`), freezing **43 integration
surfaces** (27 sidebar nav items, 12 Quick Actions, 4 Action Center generators) behind the machine-enforced
manifest `tools/integration-surface-manifest.js`; navigation stays visible+normal for every principal, seven
single-capability mutation controls are visible+disabled when denied, availability is derived at render time,
and `ACTIONS` stays **20**. **With C3 frozen, UX-006C — Authorization is COMPLETE and FROZEN in full, and
UX-006D is the current milestone.** UX-006D is **presentation only** and is decomposed as **D1** (reachable
principal selection — merged & frozen, `4a53a35`), **D2 — Principal & Workspace Presentation Polish**
(**merged & frozen**, merge `5163cfce`), and **D3 — Cross-surface Presentation Consistency & Acceptance**
(**merged & frozen**, merge `e76460dc`). D3 restored the page heading every sidebar view
lost in its no-data state — which also restored the `.page-head` slot Quick Actions mount into — fixes a
pre-existing narrow-viewport overflow, and hardens the raw-prose UX-005A dashboard guard into a stronger
comment-stripped + API-symbol check. **UX-006D is therefore COMPLETE / FROZEN** (D1 `4a53a35`, D2 `5163cfce`, D3 `e76460dc`). The pre-C3 UX-006D
staging-row language (*nav-per-principal*,
*unauthorized routes blocked*, *employee never reaches exec routes/data*) is **SUPERSEDED as a routing rule**
by the frozen C3 semantics — see UX-006 architecture §20A. **Principal-aware Global Search scope wiring is
OUTSIDE UX-006D**: it is a data-scope behavior change, not presentation, and is carried as a separate future
functionality milestone. Later UX-006 phases (**E — Persistence & Migration Hardening**, **F — Integration
Freeze & v3.0.0 Readiness**) have not begun.

**READINESS — read scope CLOSED (Readiness-1, merged `3521d811`); journeys ACCEPTED (Readiness-2, merged & frozen, merge `580d8999`); release candidate PREPARED and FROZEN (Readiness-3, merged & frozen, merge `61ddd939`); CONTROLLED PILOT APPROVED and NOT YET LAUNCHED (sign-off merged `df76ec20`).** The
[Post-UX-006D user-readiness audit](docs/99-archive/roadmap-completed/Post-UX-006D-User-Readiness-Audit.md) (baseline `e76460dc`)
found that the UX-006B self-scope layer is **built, tested and connected to nothing**: `getScopedRecords()` has
**zero production consumers**, so every list, detail, report and Global Search reads raw `State.*` and an
**Employee principal sees the whole company, including other employees' salaries** (proven with a fabricated
two-employee fixture, via lists, deep links and search). Mutation enforcement is complete and correct — this is
purely unwired read scope, orphaned between UX-006B (headless per amendment R1) and UX-006D (presentation only).
It was **not a security vulnerability** (identity is a local, spoofable selector, documented in-source as *not a
security boundary*) but a **P1 confidentiality/product defect** against the approved **"self-only read"**
criterion (Decision Q2). **Readiness-1 wires it**: scoped reads across People/HR, the payroll read funnel,
overtime, adjustments, HR dashboards and reports, the finance ledger and derived aggregates, the breadcrumb, and
Global Search at its collector seam; plus `getScopedRecordById()` so a detail id captured under another principal
is re-scoped at render time. `null` now **fails closed**, so no business data renders until a principal is
selected — the required semantic, and a real change to the default boot experience flagged for Readiness-3.
No new ACTION and no schema/storage change. It also closes **identity disclosure** (an employee's *name* is scoped data): rosters, the
Employee-authorized overtime picker, contract/adjustment/legacy pickers, Duplicate Review, Settings diagnostics and employee-naming alerts
are scoped, while integrity inputs and the payroll setup gate stay canonical and documented. Proven by
`tools/verify-employee-read-scope-runtime.js` (119 checks) with a negative control producing 49 counted
failures on the pre-Readiness-1 baseline. **Readiness-2 — End-to-End User Journey Acceptance** then validated all eight primary journeys in the
browser and in `tools/verify-readiness2-e2e-runtime.js` (96 checks): CEO finance, Employee self-service +
privacy, payroll lifecycle (a locked period truthfully refuses posting), Smart Import commit/undo,
backup/restore/Start Fresh, principal switching, settings, and supplemental. **No product defect was found.**
It also corrected the Readiness-1 `.gitattributes` recommendation — the policy already existed and was
correct; one stale CRLF worktree file was the entire cause. **Readiness-3 — Release Candidate & Pilot Package** then packaged the line for a controlled pilot:
`APP_VERSION` **2.9.0 -> 2.10.0** (*Governed Workspace*) with `SCHEMA_VERSION` **6** and `ACTIONS` **20**
unchanged - a minor bump because the capability added since 2.9.0 is materially new but backward-compatible,
explicitly **not** 3.0.0. RC identity lives in the release paperwork, not the runtime, because
`tools/app-version.js` accepts only stable `x.y.z` and derives the artifact filename from it; new verifier
guardrails enforce that the candidate is never described as published or tagged, that v2.9.0 survives as
published history, and that the trust-model caveat is stated. It closed the two deferred acceptances through
**real browser file I/O on both artifacts** (a genuine `.xlsx` `File` through the real file input, and a real
backup-file export/restore roundtrip), and **found and fixed one P2 defect**: `smartRollbackPreview()` reported
*created* counts as *removal* counts, so an import of TAM's standard `Realisasi` workbook made the undo promise
deletions it correctly did not perform and write an `import.undo` audit entry recording deletions that never
happened. First boot still selects nothing and persists nothing (**no auto-CEO, no remembered principal** - none
was added, because no approved mechanism exists); only the null helper line's wording changed. Disabled-reason
discoverability is `title`-on-hover only: accepted and documented for a **desktop-only** pilot, recorded as a
general-use blocker. Recorded **pilot dependency**: `.xlsx` import needs the CDN-hosted parser and does not work
offline. **No tag and no GitHub Release were created.** Sequence: Readiness-1 (read scope, **done**) ->
Readiness-2 (E2E acceptance, **done, merged**) -> Readiness-3 (release candidate 2.10.0, **done, merged &
frozen**, merge `61ddd939`) -> Controlled Pilot Sign-off (**merged `df76ec20`; maintainer approval
GRANTED**) -> **Controlled Pilot (NEXT — approved to start, NOT YET LAUNCHED)**. Approval authorises
handoff of the frozen artifact to the 1-3 named internal operators; launch happens only when it is
actually handed over, and **no launch date is set**. After the pilot: Post-Pilot Findings & Remediation
-> Pilot Exit Review -> Distribution-1 (modular distribution migration, post-pilot) -> General-Use
Readiness -> UX-006F / v3.0.0. **Distribution-1 does not block the pilot.**
v2.8.5 remains
published and unchanged; it is no longer marked Latest. Publication created a tag and a GitHub Release
only — it changed no source commit, runtime behavior, schema, or storage key.

**UX-006D1 — Reachable Principal Selection is implemented, verified, merged, and frozen** (merge commit
`4a53a35`; the `feature/ux-006d1-principal-selection` branch has been deleted). It resolves the C2A halt: live `can(...)`
enforcement cannot activate safely while `getCurrentUser() === null` is the only reachable state (every
mutation would deny, regressing the operator), so the roadmap is amended to `C1 → D1 → C2A → …`. A new
`js/ui/identity-selector.js` UI module mounts a compact **"Acting as"** native `<select>` into the persistent
sidebar `.brand` (via `renderShell`/`bindShell`/`syncShellState` — the existing mount-once/sync lifecycle, no
new bootstrap). It is the **single** UI adapter allowed to call the local-only
`LocalIdentityProvider.getAvailablePrincipals()` / `selectPrincipal(id)`; every other module still consumes
identity only through `getCurrentUser()` (verifier-enforced isolation). Initial state stays
`getCurrentUser() === null` (**no default/implicit/boot CEO**, no auto-select); a non-value placeholder plus
"No principal selected — some actions are unavailable." makes the fail-closed state visible. Selection is
**ephemeral** (LocalIdentityProvider closure only; resets on reload) — **no persistence, no storage key, no
`State.identity`, no schema change (`SCHEMA_VERSION` stays 6)**. Selecting CEO → Executive/ALL_COMPANY and
CEO-side `can(...)`; selecting Employee → Personal/SELF (when linkage resolves, else fail-closed null) and
company-mutation deny — **reachability proof only; no `can(...)` wired at any business mutation boundary (C2A
remains halted)**, Global Search untouched (R1 deferred), Data Grid/Action Center/nav unchanged. It is an
identity-selection affordance, **not** login/authentication/session/security. One new harness
(`tools/verify-identity-selection-runtime.js`, **29** checks) + additive verifier guards and an authorized CSS
golden-master revision (`css/shell.css` `.identity-selector*`, digest `569a3f06…`; `tokens.css` unchanged):
verifier **2119**, runtime **1713 / 22**, identity **33**, workspace **31**, authz **68**, D1 **29**, GS **26**,
DG **36**; dev artifact rebuilt deterministically — **1,085,745 bytes**, SHA `48ea7057…` — distinct from the
immutable **published** v2.9.0 asset (1,049,018 bytes, `e7470ff5…`). **With D1 merged and frozen, the next
authorized phase — UX-006C2A (Core HR Mutation Enforcement) — is now safe to resume from the then-current
`main` (a reachable active principal now exists); it has not begun.**

**UX-006C2A — Core HR Mutation Enforcement is implemented, verified, merged, and frozen** (merge commit
`a7369447`; the `feature/ux-006c2a-core-hr-enforcement` branch has been deleted). It wires the frozen public
`can(action, resource?)` into the real **Employee** and **Contract** mutation boundaries so a denied
authorization yields **SE-0 — zero business side effect** (no State mutation, no persistence, no audit write,
no success). Employee boundaries guarded (`js/people/employees.js`): create + update (modal), `setEmployeeActive`
(→`employee.update`), `deleteEmployee` (→`employee.delete`), and the repository-seam handlers
`updateEmployeeContact`/`updateEmployeeEmployment`/`updateEmployeeCompensation` (→`employee.update`). Contract
boundaries guarded (`js/people/contracts.js`): create + update (modal), `deleteContract` (→`contract.delete`),
`updateContractDates`/`updateContractCore` (→`contract.update`). **Null principal denies all** (correct now
that D1 makes CEO reachable — no default/implicit/boot CEO, no null→allow shim); **Employee denies all,
including SELF records** (Q-SELF-EDIT stays denied — SELF visibility is not mutation permission); **CEO
preserved** (explicit selection → existing flows unchanged, zero regression). Domain code uses only
`ACTIONS`/`can()` (never `canPrincipal`/`POLICY`/`isInScope*`); enforcement is at the domain boundary, never in
`persist*`/StorageAdapter. `authz.js` unchanged (ACTIONS stays 13, authz harness 68); no new ACTION; no
UI/CSS/GS/DG/nav change; no `State.identity`; `SCHEMA_VERSION` stays 6. Deferred to later phases and reported:
contract **status transitions** (`transitionContractStatus`) and **renewal** (`renewContract`) are operational
(C2C), overtime is C2B — all remain unwired. One new SE-0 harness
(`tools/verify-mutation-enforcement-hr-runtime.js`, **66** checks) exercises the real handlers with
persistence/audit spies; two existing harnesses (`verify-contract-core-runtime.js`,
`verify-contract-persistence-runtime.js`) now explicitly select the CEO principal in setup (valid CEO
workflow; no production default). verifier **2130**, runtime **1779 / 23**, C2A **66**, identity **33**,
workspace **31**, authz **68**, D1 **29**, GS **26**, DG **36**; dev artifact rebuilt deterministically —
**1,088,479 bytes**, SHA `3b297f3e…`. **UX-006C2B (overtime) and C2C (operational) have not begun.**

**UX-006C2B — Overtime Mutation Enforcement is implemented, verified, merged, and frozen** (merge commit
`023a8214`; the `feature/ux-006c2b-overtime-enforcement` branch has been deleted). It amends the frozen ACTIONS
vocabulary **13 → 16**, adding exactly `overtime.createSelfDraft`, `overtime.updateSelfDraft`,
`overtime.deleteSelfDraft` (preserving `overtime.submitSelf` + `overtime.manage`; still no `*.read`), and
wires `can(...)` into the real Overtime boundaries in `js/people/overtime.js`: `addOvertimeRecord`
(createSelfDraft), `updateOvertimeRecord` (updateSelfDraft, with a **post-update re-check** that rolls back an
ownership-change or status-change attack), `setOvertimeStatus` (**split**: own `Draft→Submitted` =
`overtime.submitSelf`; every other transition = `overtime.manage`), `duplicateOvertimeRecord` (createSelfDraft
on the copy), `deleteOvertimeRecord` (deleteSelfDraft), and `worksheetSave` (**bulk `overtime.manage`,
authorized once before any row is mutated** — atomic SE-0). **Employee** may self-service only on **own Draft**
(create/update/delete/submit); **null** denies all; **CEO** unchanged (pass-through, incl. approve/reject/
worksheet). Denied ⇒ **SE-0** (no State/persist/audit/success). Employee can never reach `overtime.manage`
(no approve/reject/commit/arbitrary-status/bulk/other-employee). `authz.js` changed only for the authorized
13→16 amendment (public `ACTIONS`/`can()` shape, fail-closed, CEO pass-through, deny-by-default, scope/authz
separation all preserved). New harness `tools/verify-mutation-enforcement-overtime-runtime.js` (**64** checks,
real handlers + persistence/audit spies + ownership/status attacks); the C1 authz harness intentionally grows
**68 → 92** for the three new actions. No UI availability wiring, no GS/DG change, no `State.identity`, no
schema/storage change (`SCHEMA_VERSION` 6). Deferred to **C2C**: operational Contract paths
(`transitionContractStatus`, `renewContract`) and the other operational domains (payroll/finance/import/
supplemental/settings/bank). verifier **2144**, runtime **1867 / 24**, C2B **64**, C2A **66**, authz **92**,
D1 **29**, workspace **31**, identity **33**, GS **26**, DG **36**; dev artifact rebuilt deterministically —
**1,093,078 bytes**, SHA `a47bafc8…`. **C2C has not begun.**

**UX-006C2C — Operational Mutation Enforcement is planned and frozen** (plan merge `9b36fc6`,
`docs/99-archive/roadmap-completed/UX-006C2C-Operational-Mutation-Enforcement-Implementation-Plan.md`), staged C2C-1…C2C-4.
**UX-006C2C-1 — Contract Operations + Payroll is implemented, verified, merged, and frozen** (merge commit
`c15a7ad`; the `feature/ux-006c2c1-contract-payroll-enforcement` branch has been deleted). It wires `can(...)` into the
operational Contract + Payroll boundaries with the frozen mappings and SE-0. Contract:
`transitionContractStatus`→`contract.update`; `renewContract`→`contract.create` as a **composite top-level
gate** (one authorization before predecessor mutation + successor create — atomic denial). Payroll (all →
`payroll.manage`): `generatePayrollForMonth`, `transitionPayrollLifecycle`, `commitReadyPayroll` (**composite
payroll+finance**, one top gate before any plan/txn write), `prepareNextMonthPayroll`, `setPayrollLock`,
salary override + clear (inline modal). Company/period-level paths use a `{employeeId:null}` `payroll.manage`
probe (CEO ALL_COMPANY passes; Employee/null deny); record-level paths pass the real plan. **Null and Employee
deny all; CEO preserved** (explicit D1). Domain code uses only `ACTIONS`/`can()`; no internal seams/role
checks/null-allow; no persistence-layer auth. `authz.js` unchanged (**ACTIONS stays 16**); no UI/GS/DG change;
no `State.identity`; `SCHEMA_VERSION` 6. New harness `tools/verify-mutation-enforcement-contract-payroll-runtime.js`
(**59** checks incl. renewal + commit **composite-atomicity** tests); four legacy CEO harnesses
(contract-timeline, renewal, payroll-committed, payroll-posting) now explicitly select CEO in setup. verifier
**2160**, runtime **1926 / 25**, C2C-1 **59**, C2B **64**, C2A **66**, authz **92**, D1 **29**, workspace
**31**, identity **33**, GS **26**, DG **36**; dev artifact rebuilt deterministically — **1,096,029 bytes**,
SHA `48d8bfe7…`. **C2C-3 (Supplemental + System/Bank/Reset) and C2C-4 have not begun; their ambiguous ACTION
mappings remain owner decisions.**

**UX-006C2C-2 — Finance + Import Authorization is implemented, merged & frozen (merge `9ab256a`).**
It implements the frozen **Decision
F2** ruling (memo merge `fa58b0d`, PR #118): the Finance vocabulary is split, so **ACTIONS 16 → 17** with
exactly one new action — **`finance.manage`** (CEO-only, resource-free like `finance.execute`).
`finance.execute` keeps its unchanged meaning — **irreversible execution/posting only** (`executeTransaction`;
domain command + `TransactionExecuted` event + `finance.execute` audit intact). `finance.manage` governs the
reversible/administrative standalone Finance mutations: manual create (`js/finance/add-upload.js`),
`saveEditedTransaction`, `archiveTransaction`, `scheduleTransaction`, `cancelTransaction`,
`duplicateTransaction` (`js/finance/execution-center.js`) and the inline permanent delete
(`js/finance/transaction-modals.js`). `commitSmartImport`→`import.commit` is a **single top gate before any
write** — a denied import writes nothing, not even the pre-import safety backup. The five administrative
engine boundaries now return a typed `{ok:false, reason}` so the UI can never report a denial as a success.
**Null and Employee deny all three actions; CEO allowed for all three** (explicit D1). Domain code uses only
`ACTIONS`/`can()`; no internal seams/role checks/null-allow; no persistence-layer auth. No UI/GS/DG change; no
`State.identity`; `SCHEMA_VERSION` **6**; `APP_VERSION` **2.9.0**; no release/tag change. New harness
`tools/verify-mutation-enforcement-finance-import-runtime.js` (**118** checks, incl. instrumented-`can()`
proof that `executeTransaction` consults `finance.execute` and **not** `finance.manage`); the SPR-079
`saveAllData` harness now selects CEO in setup (its import commit is authorized). **Atlas governance review of
PR #119 found one blocker, now remediated:** the Execution Center **Schedule** control
(`js/finance/execution-center.js`, `[data-schedule-txn]`) ignored the `scheduleTransaction` result and always
emitted `showSuccess('Transaction scheduled.')`, so a denied principal was told the schedule had happened —
the mutation was correctly blocked (SE-0 held), only the report was wrong. The call site now reports the typed
result, and the harness drives the **real bound click handler** (denied ⇒ no success message, State
byte-identical, zero writes; CEO ⇒ still schedules and still reports success). verifier **2191**, runtime
**2047 / 26**, C2C-2 **118**, C2C-1 **59**, C2B **64**, C2A **66**, authz **95**, D1 **29**, workspace **31**,
identity **33**, GS **26**, DG **36**. **Deferred and untouched: backup restore (C2C-3), supplemental,
settings, bank, reset, recurring, monthly plan, legacy mapping, employee dedup, C3, remaining UX-006D.**

**v2.10.0 is the latest published release (Latest); the repository artifact is byte-identical to its
published asset; the published v2.9.0 and v2.8.6 Release assets remain immutable.** `dist/` holds
`tam-os-v2.10.0.html` only — the superseded `dist/tam-os-v2.9.0.html` was removed by the release
dist-swap, and every published Release asset stays immutable regardless:

| | Published v2.10.0 Release asset (Latest) | Published v2.9.0 Release asset (immutable) | Published v2.8.6 Release asset (immutable) |
|---|---|---|---|
| Artifact | `tam-os-v2.10.0.html` — **1,151,267 bytes** | `tam-os-v2.9.0.html` — **1,049,018 bytes** | `tam-os-v2.8.6.html` — **998,413 bytes** |
| SHA-256 | `60382271…2c7fa704` (published, Latest; byte-identical to `dist/`) | `e7470ff5…ddcaf3ea` (published, unchanged) | `8481523c…c91d3f62` (published, unchanged) |

The prior published asset `tam-intelligence-os-v2.8.5.html` (965,767 bytes, `32e624a262…1c23a7db8cb`) and
its v2.8.5 tag/Release remain immutable and unchanged.

The superseded `dist/tam-intelligence-os-v2.8.4.html` was removed from `dist/` by the release dist-swap,
as `docs/RELEASE-PROCESS.md` §2 requires; the historical v2.8.4 tag, Release, and published asset
(914,409 bytes, `09c622b3a6…3aea02c6`) are untouched.

When these change, update this document (not `CLAUDE.md`).

**Current baseline (aggregate-backed Repository adoption complete):**
[RDR-011](docs/99-archive/RDR/RDR-011-epsilon-repository-snapshot.md) at commit `6714beb`; progress recorded in
[DPR-009](docs/99-archive/DPR/DPR-009-epsilon-repository-adoption-completion.md). Milestone Delta established the
canonical application **Platform** and proved it transport-agnostic
([RDR-007](docs/99-archive/RDR/RDR-007-delta-repository-snapshot.md) / [DPR-005](docs/99-archive/DPR/DPR-005-delta-completion-report.md),
both immutable predecessors); **Milestone Epsilon** completed **Repository adoption** over it. The current
architecture has **two ingresses over one canonical contract**:

```
Browser ┐
        ├→ Transport Adapter → Application Gateway → Domain → Aggregate → Handler → Entity-Named Repository → StorageAdapter
CLI    ─┘
```

- **Application Gateway** (PR-6A) — exclusive, business-blind Platform boundary.
- **Transport Adapter** (PR-7A) — canonical transport boundary; the browser consumes it via the
  `uiExecute` seam (PR-7B "The Conduit").
- **CLI** (PR-8B) — first non-browser, read-only ingress delegating solely through `TransportAdapter`.
- **Repository** (PR-8A … PR-11A) — persistence-mechanics boundary; **three entity-named modules** in
  `js/repository/`: `EmployeeRepository`, `ContractRepository`, `PayrollRepository`. One unevolved,
  collection-grained, client-side contract: `save() → { ok:true } | { ok:false, error:'PersistFailed' }`.
  Handlers keep validation, mutation, `updatedAt`, history, rollback, typed results — and, for Payroll,
  the post-persistence best-effort audit. See [ADR-013](docs/03-adr/ADR-013-Repository-Layer.md).

**Aggregate-backed Repository adoption: 9 of 9** — Employee 4/4, Contract 4/4, Payroll 1/1.
This means *only* that every aggregate-backed handler delegates persistence through an entity-named
Repository. It does **not** mean all persistence is mediated (the layer covers 3 of 11 persist
functions), that compound persistence is solved, that multi-store transactions are supported, or that
backend readiness is achieved. Non-aggregate and compound writes remain direct by design and are
verifier-fenced. **Backend remains prohibited** by [`CLAUDE.md`](CLAUDE.md) §4.3 (client-only MUST).

**Contract authority.** Contract status transitions are aggregate-backed, and renewal is
**aggregate-authored**: `ContractRenewalAggregate` decides eligibility and authors the successor's
business shape, the predecessor's canonical `Renewed` status, and both history note texts, without
mutating, generating ids/timestamps, or persisting. The `renewContract` handler owns ids, timestamps, the
history append, one `ContractRepository.save()`, strict result inspection, in-memory rollback on a failed
write, and the typed result. Renewability is evaluated against **stored** statuses (`Draft`, `Active`),
never derived display states — so a contract displayed as *Expired*, *Final Month* or *Ending Soon*
remains renewable while its stored status is still `Active`. Terminal statuses (`Renewed`, `Cancelled`) are never renewable.

**Contract Core authority — prepared, not routed (ADR-014 step 1 / SPR-095).** `ContractCoreAggregate`
**is prepared** (a pure boundary owning exactly ten fields) and `contract.core.update` **is registered**
to the `ContractRepository`-mediated `updateContractCore` handler. **No operational ingress exists** — no
UI, modal, Platform, Gateway, Transport or `uiExecute` route invokes it, and the only invoker in the
repository is `tools/verify-contract-core-runtime.js`. **Editor routing is unchanged**: the full Contract
editor still writes those ten fields directly through `persistContracts()`, and the delete path is
unchanged. **No authority migration has happened.** **OQ-2 and OQ-3 remain OPEN**, and editor routing
(ADR-014 step 2) stays blocked on OQ-2.

**Next architecture frontier: compound persistence** — `commitReadyPayroll` writes four stores in one
logical unit, which the collection-grained contract cannot express. This is the open question, not backend
work. It is now the **only** compound operation in the Payroll domain: Contract renewal was shown to be
single-collection (SPR-077, ATR-011 §4) and payroll-planning posting was retired as dead code (SPR-078).

SPR-079, SPR-081 and SPR-082 changed how compound persistence is **reported and detected**, not how it
is performed. Multi-key writes remain sequential and non-atomic; see *Known Limitations* for the standing
residuals and *Future Roadmap* for what is and is not authorised.

`commitReadyPayroll` is the **sole live Payroll posting path**. The legacy Payroll Planning screen and its
`commitPayroll` function were removed in SPR-078: the screen had been unreachable since v2.5.0 (no route,
no navigation entry, no external caller) and its posting path was a second, divergent authority that
bypassed the period lock, commit blockers, and the `Ready` gate, and wrote a non-canonical lowercase
`'committed'` status. Committed-state reads now go through one shared predicate, `isPayrollCommitted()`
(`js/people/people-core.js`), which accepts the canonical `'Committed'` and — for reads only — the legacy
lowercase value that retired path may have persisted. No live writer writes the legacy value.

**Payroll posting result integrity (SPR-081, v2.8.3).** `commitReadyPayroll` captures and strictly
inspects **all four** persistence results (payroll plans, monthly plan, overtime, finance transactions);
success requires all four, and failure returns a typed outcome naming the first failed step in the fixed
write order, the completed steps, and that partial persistence occurred. The success audit entry and the
success UI (toast, posted-vs-skipped summary, selection clear) are gated on full persistence success; the
failure branch retains the row selection so the user can see what was involved. Transaction lookup keeps
its forward resolution and adds a narrow reverse fallback — payroll-sourced only, exact `payrollPlanId`,
exact period — that resolves **only when exactly one candidate exists**; more than one yields a typed
`PayrollTransactionAmbiguous` skip and never a guess. A reverse-matched transaction has its forward
linkage restored rather than being duplicated. **This added no atomicity and no rollback** — the four
writes are still sequential.

**The two SPR-080 failure modes are not equally addressed.** Scenario A (duplicate finance transaction on
retry) is **prevented on retry** by the unique reverse lookup: the existing transaction is found and
relinked instead of a second one being created. Scenario C (overtime left `Approved` after a committed
posting, and therefore re-payable) is **detected as a Critical integrity finding before reuse** — it is
**not automatically repaired, and not universally blocked**. Nothing prevents that overtime from being
included in a later payroll; the finding is advisory and requires a human to act on it.

**Monthly Plan result integrity (SPR-082, v2.8.4).** `commitMonthlyPlan` (`js/people/monthly-plan.js`)
now captures and strictly inspects **both** persistence results — transactions first, monthly plans
second. The two writes keep their existing order and attempt-all behaviour; success requires both, and
failure returns a typed `MonthlyPlanPersistenceFailed` outcome naming the first failed step in the fixed
write order, the completed steps, and that partial persistence occurred. The failure branch **keeps the
preview** (so the user retains the rows they were committing), shows no success toast, and states plainly
that some data may already have been saved and that Integrity Check should be run before retrying.
**This added no atomicity and no rollback** — the two writes are still sequential, and a failure means
the commit did not complete, **not** that nothing was written.

The partial states are now **detectable**, not prevented and not repaired. A new **Critical** rule,
`monthlyplan-orphan-transaction`, fires for a non-payroll Finance transaction carrying a `monthlyPlanId`
when either the referenced monthly plan is **absent entirely** or the plan exists but **does not list the
transaction** in `committedTxnIds`. The pre-existing `corrupt-plan-ref` **warning** still covers the
opposite direction — a plan whose `committedTxnIds` point at transactions that do not exist. Payroll-sourced
transactions stay out of scope of the new rule; they are owned by `payroll-orphan-transaction` and
`payroll-missing-monthlyplan`.

**Retry is idempotent for transaction creation only — it does not reconcile linkage.** Two residual
states are documented and proven by the runtime harness, and both require **manual review**:

- **Scenario A2** (the monthly plan was created by the failing commit; only the transactions write
  landed). After reload the transactions return with a `monthlyPlanId` pointing at nothing, and
  `monthlyplan-orphan-transaction` fires. The retry **creates no duplicate transaction** — the reloaded
  rows are recognised as duplicates and skipped — but because they are skipped they are **never linked**
  to the newly created plan, so the Critical finding **remains** after a successful retry.
- **Scenario B** (only the monthly plans write landed). After reload the plan is `Committed` with
  **dangling** `committedTxnIds` and `corrupt-plan-ref` fires. The retry creates the missing transaction
  under a **new id**; the stale dangling ids **stay on the plan** — nothing removes them — so
  `corrupt-plan-ref` **remains** and the commit **reports success while that finding still stands**.

**Multi-dataset persistence (SPR-079, v2.8.2).** `saveAllData()` inspects every one of its 14 writes and
returns `true` only when all succeed; Employee Merge and Smart Import no longer report false success.
Multi-key saves remain non-atomic: a failure means the operation did not complete, **not** that nothing
was written. **Reload reads whatever storage keys successfully persisted. It does not restore a complete
prior state.**

**Integrity Check** gained two **Critical** rules in SPR-081 — `payroll-orphan-transaction`, which fires
when a payroll-sourced Finance transaction references a `PayrollPlan` that is **either not `Committed`
or does not link back to that transaction** (both broken-linkage directions, not only the uncommitted
case), and `payroll-overtime-uncommitted` (committed payroll whose linked overtime is still `Approved`,
which was runtime-proven to be re-payable in the next month). SPR-082 added a third **Critical** rule,
`monthlyplan-orphan-transaction` (a non-payroll transaction whose referenced monthly plan is absent, or
exists but does not list it), alongside the pre-existing `corrupt-plan-ref` **warning** for the reverse
direction. All of these are **read-only detection**: they report that a partial state exists and where —
they do **not** repair it and do **not** block the underlying operation.

Operational surface: 9 aggregates / 8 seam-routed aggregate-backed commands / 1 aggregate-backed query;
15 registered commands / 4 registered queries — unchanged by every Repository slice. The ninth
aggregate-backed command, `contract.core.update`, is registered and Repository-mediated but routed by
nothing. Business authority remains exclusively in the Domain.

**v2.7.1 note.** Posted/Executed payroll and supplemental display now derive from a single stage-aware
historical source-of-truth helper (`payrollHistoricalSnapshot`) backed by immutable snapshots frozen
at posting — historical figures are never reconstructed from current master data, and a visible notice
appears when a legacy plan disagrees with its committed transaction. No storage key was added (still
15) and `SCHEMA_VERSION` is unchanged (6).

---

## 1. Project Overview

TAM OS is a **single-page, client-side** finance, payroll, and operations application
for **PT Total Asset Manajemen**. It runs entirely in the browser with no backend, database, API, or
runtime dependencies; all data persists locally. It ships in two forms: a modular development source
and a portable single-file HTML build. See [`README.md`](README.md) for the public overview.

## 2. Product Vision

A self-contained "operations OS" that lets a small finance/HR team run the full monthly cycle —
people and contracts, overtime, payroll, transaction execution, cash flow, budgeting, planning, and
reporting — without external systems, while keeping confidential data on the user's own device.

## 3. Business Domain

- **Organization:** PT Total Asset Manajemen (Indonesian company; currency and formatting are IDR).
- **Core entities:** employees, contracts (with work schedules), overtime records, payroll plans,
  finance transactions (planned vs. actual), monthly plans, budgets, and an audit/activity log.
- **Primary users:** directors, finance, HR/payroll administrators, and reviewers/auditors.
- **Sensitivity:** all payroll/employee/contract/finance data is confidential (see
  [`SECURITY.md`](SECURITY.md) and [`docs/DATA-SAFETY.md`](docs/DATA-SAFETY.md)).

## 4. Major Modules

Grouped as they appear in the app's navigation:

- **Executive / Analytics:** Executive Dashboard, Executive Insights, Planned vs. Actual, Compare
  Months, Monthly Trends.
- **Finance:** Finance Overview, Transactions, Execution Center, Add/Upload, Cash Flow, Budget
  Center.
- **People & Contracts:** Employees (+ Employee Detail), Contracts, Payroll Workspace (+ Payroll
  Detail), Overtime, Monthly Plan Generator, Recurring Expenses.
- **Import:** Smart Import (spreadsheet extraction, column mapping, deduplication).
- **Management / System:** Financial Calendar, Reports, Activity Log, Settings, Bank Accounts, About,
  Release Notes.

A capability status matrix (Available / Planned) is maintained in [`README.md`](README.md).

## 5. Current Architecture

Client-only, single shared global scope of classic-script modules organized into
`core / ui / finance / people / import / analytics / domain / platform / transport / repository / cli`,
assembled into one portable HTML file. **73 JS modules** exist in the source: **72 are browser-loaded**
(the load-order manifest and `index.html` agree on all 72), and `js/cli/cli.js` is the CLI-only ingress,
deliberately outside the browser load order. There are no ES modules and no bundler; module load order is
the critical invariant. The full structure, provenance, and diagrams (application structure, payroll
workflow, release pipeline) live in [`ARCHITECTURE.md`](ARCHITECTURE.md).

**Shell / view separation (UX-002A).** The application shell is mounted once and then persists.
`renderShell()` builds the sidebar, brand, nav tree and the `#main` container and binds its listeners
once; ordinary navigation replaces only the content inside the persistent `#main` (`renderView()`) and
reapplies the nav's derived state in place (`syncShellState()` — active item, group collapse, chevron,
`aria-expanded`, brand subtitle). `render()` is retained as a compatibility facade with unchanged
observable behaviour, so every existing caller works untouched. Three verifier invariants hold the
shape: `render()` never assigns `.innerHTML` or emits shell markup; `renderShell()` and
`syncShellState()` must exist and both be invoked by `render()`; and `bindShell()` must be invoked
exactly once repository-wide, only from `renderShell()`.

**Presentation system (UX-002B).** CSS resolves from token scales defined in `css/tokens.css` — six
font sizes, six 4px-based spacing steps, four radii — with `--brand` (identity) split from
`--interactive` (selection and primary action), a `--warn` semantic token, and six `--chart-*` series
tokens. The serif survives on the wordmark only; UI chrome is sans. Chart series colours resolve
through `themeVar('--token', fallback)` at render time, so charts follow the active theme; the
remaining exemptions are the `constants.js` status/category palette (deferred), the browser
theme-colour meta, and `themeVar()` fallback arguments. Five static invariants enforce this: no
fractional `font-size`; `var(--serif)` exactly once on `.brand .mark`; every `:root` token also defined
for `:root[data-theme="light"]`; spacing and radius resolve from tokens; and no theme-sensitive hex
literal in a production-JS colour position.

**Contract timeline model (UX-003A / UX-003B / UX-003C).** `contractCalc(c, refKey)` measures every
field it derives — progress, `coversMonth`, `expiredForRef`, `beforeStart` **and** `daysUntilEnd` —
against ONE normalized reference date (UX-003A). `contractRefDate()` resolves the current month (or an
omitted key) to today and any other month to that month's first day; unusable keys fall back to today.

`contractTimeline(c, refKey)` is the single classifier (UX-003B) and returns two **independent** derived
dimensions in one computation — `{state, horizon, daysUntilEnd, withinWarningWindow}`:

| Dimension | Values |
|---|---|
| **Effective state** | `Draft` · `Cancelled` · `Renewed` · `Scheduled` · `Active` · `Expired` |
| **Expiry horizon** | `EndingToday` · `EndingThisWeek` · `EndingThisMonth` · `EndingNextMonth` · `WithinWarningWindow` · `None` |

A contract ending this month is state `Active` **with** horizon `EndingThisMonth` — a horizon never
replaces the effective state. Only effectively-Active contracts carry a non-`None` horizon; Scheduled,
Expired, Draft, Cancelled and Renewed are always `None`. The four **calendar** horizons are calendar
facts and are NOT gated by `settings.contractExpiryWarningDays`; only `WithinWarningWindow` depends on
that threshold. `Scheduled` is **derived only** — `CONTRACT_STORED_STATUSES` remains exactly
`Draft/Active/Renewed/Cancelled`, no module writes it, and `SCHEMA_VERSION` is unchanged.
`Expiring Soon` survives as a **legacy compatibility alias** meaning "effectively Active and inside the
configured warning window"; it is neither a canonical state nor a canonical horizon and is never stored.

**Contract progress semantics (UX-003C).** `current / total` is the contract month **currently being
served**, so for a three-month contract:

| Reference month | Progress | Remaining | State |
|---|---|---|---|
| month 1 | `1/3` | 2 | Active |
| month 2 | `2/3` | 1 | Active |
| month 3 | `3/3` | **0** — final month | Active |
| month 4 | `3/3` | 0 | **Expired** |

`3/3` therefore means the **final contract month with zero months remaining** — it must never be worded
as "one month remaining". `current` never exceeds `total` and `remaining` is always
`max(0, total - current)`.

**Counters, filters and wording (UX-003C).** Every displayed contract count resolves through one
canonical helper, `contractTimelineCounts()`. The six effective states **partition** the collection; the
horizon counts are a **breakdown of `active`**, not a sibling of it — so `Active` includes
horizon-carrying active contracts, `Scheduled` and `Expired` are excluded from it, and ending-soon is a
true subset of `Active`. The Contracts status filter follows the canonical effective state
(All / Active / Scheduled / Expired / Draft / Cancelled / Renewed): filtering `Active` can never return
a `Scheduled` contract, `Scheduled` has its own option, and every contract is reachable through exactly
one option. Presentation wording puts **urgency before lifecycle**: `Ends Today` → `Ends This Week` →
`Final Month` → `Ends Next Month` → `Ending Soon`. `Final Month` is used only for `EndingThisMonth`, no
internal horizon identifier reaches the UI, and the CSV export Status column uses the same presentation
labels so exported terminology matches the screen.

## 6. Build System

- **Node tooling only** (no `npm install`): a build script inlines CSS + JS in manifest order into
  the portable single file, and a verifier runs a suite of invariant checks (**2443** on `main`),
  joined by **thirty-four** runtime harnesses (**2921** checks).
  PowerShell fallbacks exist for machines without Node.
- The portable build is **reproducible**: the same source produces a byte-identical artifact, so the
  published SHA-256 verifies any downloaded copy.
- **Version is derived** from a single source constant; the portable filename follows it
  automatically.
- Commands and the full verifier scope are documented in [`README.md`](README.md) and
  [`CONTRIBUTING.md`](CONTRIBUTING.md).

## 7. Storage Overview

- Persistence is **local**: browser `localStorage` (standalone file) or the Claude Artifact storage
  environment; nothing is sent to a server.
- `SCHEMA_VERSION` is **6**; there is a fixed set of stable storage keys (**15** as of v2.7.0:
  transactions, settings, backups, employees, contracts, payroll plans, recurring, monthly plans,
  overtime records, import batches, payroll adjustments, employee merges, audit log,
  `tam_company_accounts_v1`, and `tam_supplemental_payments_v1`) plus one-time migration flags. The
  shipped build seeds **no** data.
- Recovery is via Complete Backup export/import; destructive actions snapshot first.
- The enumerated keys and migration rules are in [`docs/DATA-SAFETY.md`](docs/DATA-SAFETY.md).

## 8. Data Flow Summary

Master data (employees, contracts, work schedules, approved overtime) feeds payroll generation.
Payroll flows into finance as planned transactions, which are later executed as actuals. Analytics
and reports read across transactions and plans. Cross-module actions are recorded in a read-only
audit/activity log. All computation happens client-side at render or on user action; no data leaves
the device.

## 9. Payroll Workflow

Operational lifecycle: **Generate → Draft → Review → Approved → Posted → Executed** (stages are a
display mapping over stored status values; "Executed" is derived from the linked finance
transaction). Payroll = Base Salary + Approved Overtime. Bulk selection is generic: each action
(Review → Draft; Approve → Draft/Review; Post → Approved) owns its eligibility and reports
eligible/skipped/reason. Posted/Executed payroll is immutable. See the payroll diagram in
[`ARCHITECTURE.md`](ARCHITECTURE.md).

## 10. Finance Workflow

Approved payroll is **posted** to finance as **planned** transactions (one per employee; no
duplicates, never auto-executed). Payments are then **executed** in the Execution Center, recording
the actual amount separately from the planned amount. Cash Flow and Budget views aggregate across
transactions; Reports export locally as CSV.

## 11. Overtime Workflow

Overtime is calculated with the internal TAM method (monthly standard hours → hourly rate → payable,
rounding only the final amount). Records move Draft → Reviewed → Approved and, once payroll is
committed, "Committed to Payroll". **Drift detection** is derived and read-only: if approved overtime
changes after payroll captured it, the app warns immediately (regenerate for uncommitted payroll; for
posted/executed payroll it becomes actionable — generate a **Supplemental Payment** (v2.7.0) that
settles the late overtime as a separate document without touching the base payroll (Draft → Review →
Approved → Posted → Executed; reuses the finance transaction model and Execution Center).

## 12. Repository Layout

At a glance: `index.html` + `css/` + `js/` (modular source), `tools/` (build/verify), `dist/`
(portable build), `docs/` and root Markdown (governance/knowledge), `.github/` (CI, release,
templates), `docs/99-archive/audit/` (immutable dated records), and a frozen reference HTML (`tam-intelligence-os-v2.5.2.html`)
retained as the **JS provenance** golden master. Since UX-002B it is no longer the CSS comparator —
CSS is pinned by digest instead (see §19). The authoritative, detailed layout is in
[`README.md`](README.md#project-structure) and [`ARCHITECTURE.md`](ARCHITECTURE.md).

## 13. Current Engineering Practices

- Edit modular source; never hand-edit the portable build; commit source + regenerated build
  together.
- Build + verify on every change; boot modular and portable with zero console errors; validate with
  fabricated data only.
- Documentation is updated as part of behavior/structure/build changes; version references stay
  consistent. Full contract: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## 14. Release Process

Bump the version constants, add release notes, build + verify, present a Release Candidate, and — on
approval — commit, tag, push, and let the tag-triggered workflow publish the GitHub Release and
portable asset (guarded so it publishes only when the tag matches the source version). **v2.10.0 is the latest
published release, published from annotated tag `v2.10.0` and marked Latest; v2.9.0 (publication commit
`598edef0`), v2.8.6 and earlier remain published and unchanged but are no longer Latest.** Detailed steps:
[`docs/RELEASE-PROCESS.md`](docs/RELEASE-PROCESS.md). History: [`CHANGELOG.md`](CHANGELOG.md); latest
summary: [`RELEASE_NOTES.md`](RELEASE_NOTES.md).

## 15. CI/CD Overview

- **CI** (`ci.yml`) builds + verifies on every push/PR to the main branch and uploads the portable HTML
  as a build artifact; permissions are read-only.
- **CodeQL** (`codeql.yml`) runs code scanning on push/PR with two Analyze jobs
  (`javascript-typescript` and `actions`).
- **Release** (`release.yml`) is tag-triggered, re-derives the version, enforces the tag-equals-version
  guardrail, and creates/refreshes the GitHub Release idempotently, uploading the portable HTML as the
  release asset. It titles the Release `TAM OS <tag>` — the short convention, which is why the latest
  published Release title reads `TAM OS v2.9.0` rather than including the release name. (Releases published
  before the branding change carry the older `TAM Intelligence OS <tag>` title and are never rewritten.)
  It resolves the Release body from `RELEASE_NOTES.md` at the tagged commit. Shipped releases are never
  rewritten.
- Workflows use **official GitHub Actions only**, on current stable major versions, with minimal
  permissions.

## 16. Known Limitations

- **Contract editor and delete report persistence truthfully (SPR-093 — implemented, not a
  limitation).** Recorded here because it *was* one. Both paths previously discarded the
  `persistContracts()` result and could announce success after a failed write, with delete additionally
  writing a `contract.delete` activity entry for a deletion that never persisted. **SPR-093 closed
  both.** A failed create leaves no record; a failed edit restores every mutated field and restores
  `history` in both contents and prior own-property absence; a failed delete restores the record at its
  exact original index and writes no activity entry; failure shows failure feedback and the editor modal
  stays open for retry. Proven by `tools/verify-contract-persistence-runtime.js` (74 checks) and by
  real-browser QA. **What SPR-093 did not do:** it migrated no authority. The editor still assigns
  `status` directly and both paths still persist through `persistContracts()` — the editor routes through
  no command and uses no repository mediation, and SPR-095 did not change that. That residual authority
  is ARCH-008's M-5 and remains open.
- **Payroll posting is not atomic.** `commitReadyPayroll` still writes **four storage keys
  sequentially** and retains attempt-all behaviour. Its results are now checked (SPR-081), which makes
  failure *visible* — it does not make the operation all-or-nothing. **No coordinated rollback and no
  compensating action exist for Payroll posting.** A failure means the posting did not complete, not
  that nothing was written.
- **Integrity Check detects but does not repair.** `payroll-orphan-transaction`,
  `payroll-overtime-uncommitted`, `monthlyplan-orphan-transaction` and `corrupt-plan-ref` report that a
  partial state exists and where it is; none of them fixes it. **Some partial states may still require
  manual review** or restoration from the pre-operation backup, and not every possible partial state is
  automatically detectable or repairable.
- **Monthly Plan commit is not atomic.** `commitMonthlyPlan` writes **two storage keys sequentially** and
  retains attempt-all behaviour. Both results are now checked (SPR-082), which makes failure *visible* —
  it does not make the commit all-or-nothing. **No coordinated rollback and no compensating action exist.**
- **Monthly Plan retry does not reconcile transaction–plan linkage.** Retry is idempotent for
  *transaction creation* only. In **Scenario A2** the retry creates no duplicate transaction but never
  links the pre-existing rows to the new plan, so `monthlyplan-orphan-transaction` **remains**. In
  **Scenario B** the stale dangling `committedTxnIds` are never removed, so `corrupt-plan-ref` **remains**
  and the retry **reports success while that finding still stands**. Both are documented residual states
  whose current operational response is **manual review**.
- **Smart Import undo has an unresolved partial-persistence case.** The undo sets its `undone` completion
  marker *before* the write, because the marker is part of the `importBatches` payload. If the
  `importBatches` write **succeeds** but another required dataset write **fails**, reload may preserve
  `undone:true` while some record removals did not persist — and because the marker is also the batch
  selector (`find(b=>!b.undone)`), **the batch may then be unavailable for retry after reload**.
  **Immediate retry is available only where the failure branch clears the in-memory completion marker
  before reload**; once a divergent state has been reloaded, that path is gone. This is explicitly
  **not** a rollback: the record removals stay applied in memory and whatever the fan-out wrote stays
  written. Unresolved.
- **Smart Import undo has no pre-operation backup.** Employee Merge and Smart Import **commit** each
  snapshot a pre-operation safety backup before writing; **Smart Import undo does not** take an
  equivalent snapshot, so there is no undo-specific restore point to fall back on.
- **No backend, server-side transaction, or multi-user synchronisation exists** — the application is
  client-only by [`CLAUDE.md`](CLAUDE.md) §4.3, so cross-key atomicity cannot be delegated to a server.
- **Supplemental Payments** (v2.7.0) settle overtime drift only; other adjustment sources (bonuses,
  reimbursements) are not yet implemented (the engine is designed to extend).
- **No automated browser/unit test suite** — QA is the invariant verifier (**2443** checks on `main`)
  plus **thirty-four** Node runtime harnesses (**2921** checks total; the largest are contract timeline
  349, authz C2C-4 164, integrity warning rules 146, integrity payroll rules 144, Contract Core 129,
  authz C2C-3 129, UX-006D2 presentation 127, employee read scope 119, monthly plan 118, finance/import
  mutation enforcement 118, payroll posting 106, authz 104, Readiness-2 E2E 96, authz integration 91)
  plus manual browser validation. The runtime harnesses drive real
  behaviour against the live engine and UI seams, but they are not a general test suite.
- **One theme-blind colour path remains.** UX-002B tokenized every chart series colour, but the shared
  `STATUS_META` / `CATEGORY_COLOR` palette in `js/core/constants.js` is still hardcoded hex. It is
  consumed by **both** status pills and charts, so tokenizing it is cross-cutting and was deliberately
  deferred out of UX-002B. The visible symptom is the Monthly Trends *category* series keeping its
  dark-theme gold under the light theme. The verifier's colour invariant exempts this file explicitly.
- **No automated visual-regression coverage.** The UX-002B Phase 1 narrow-width regression was caught
  only because a later phase validated with a richer fixture. The standing controls are the canonical
  12-month transaction-bearing QA fixture and the rule that every width assertion captures
  `innerWidth`, `clientWidth`, `scrollWidth` and overflow in the same instant — both recorded in
  [`audit/ux-002b-2026-08-05/`](docs/99-archive/audit/ux-002b-2026-08-05/CSS-GOLDEN-MASTER-REVISION.md). Dashboard
  information-integrity and alert-reachability are likewise protected by documented behavioural probes,
  not by static invariants.
- **External CDN references** for the spreadsheet parser and fonts mean the fully offline experience
  depends on those assets (no user data is sent to them).
- **Single-owner project** — response and review timelines are best-effort.
- **The repository contains no real company workbook and no confidential operational dataset.** A
  confidential workbook was removed from all branches and tags by the 2026-07-31 sanitization
  ([record](docs/99-archive/audit/sanitization-2026-07-31/SANITIZATION_RECORD.md)); it is not tracked and not
  reachable in repository history. Development, examples, and testing use **fabricated or
  appropriately sanitized data only**, and confidential company data must never be introduced into
  this public repository.
- Screenshots and a social-preview image are **delivered** (MAINT-001 Follow-Up): four 1920×1080
  dark-theme UI screenshots under `assets/screenshots/` and a 1280×640 `assets/social/tam-os-social.png`,
  all captured from fabricated data. The GitHub social-preview **Settings upload remains a manual step**.

## 17. Future Roadmap

Directions (no committed release numbers unless already approved):

- **Released:** Supplemental Payroll Engine (v2.7.0); Payroll Integrity & Reporting Foundation (v2.7.1);
  Persistence & Transactional Integrity (v2.7.2); Supplemental-Aware Payroll History (v2.7.3);
  Aggregate-Owned Contract Renewal + Single Payroll Posting Authority (v2.8.1); Honest Persistence
  Results (v2.8.2); Payroll Posting Integrity (v2.8.3); Monthly Plan Result Integrity (v2.8.4);
  Workspace & Contract Timeline Integrity (v2.8.5); v2.8.6; Workspace Experience (v2.9.0);
  **Governed Workspace (v2.10.0 — published, marked Latest, and the current release; the
  controlled-pilot package)**.
- **Immediate residuals** (evidence-backed, not yet scheduled): Monthly Plan retry linkage reconciliation
  (Scenarios A2 and B); the Smart Import undo in-memory/storage divergence — both described under
  *Known Limitations*, and both answered today by **manual review** only.
- **Open architecture question — Contract editor and delete authority (ARCH-008 M-5).** The full editor
  and `deleteContract` remain direct writers, bypassing `ContractStatusAggregate`, `ContractDateAggregate`
  and `ContractRepository`. M-5 is now **entirely an authority question** — its persistence-honesty
  component was closed by SPR-093. **Field ownership is decided:
  [ADR-014 — Contract Core Field Authority](docs/03-adr/ADR-014-Contract-Core-Field-Authority.md) is
  Accepted**, establishing one `ContractCoreAggregate` behind one `contract.core.update` command owning
  `employeeId`, `employeeName`, `contractNumber`, `monthlySalary`, `notes` and the five schedule fields,
  with status, the date extent and renewal unchanged. Approved policy: `contractNumber` editable only
  while `Draft` (PD-1); employee reassignment only while `Draft` and only with no linked payroll,
  overtime or transactions (PD-2). Smart Import, Backup Restore, Demo Seed and the Employee Dedup relink
  are permanent bounded exemptions. **ADR-014 itself authorized no implementation**; SPR-095 was
  separately chartered and delivered **step 1 only** — `ContractCoreAggregate`, `contract.core.update`
  and the `ContractRepository`-mediated `updateContractCore` handler now exist, and **nothing invokes
  them**. Editor routing (step 2) does not exist and existing user-visible flows are unchanged. OQ-2
  (editor status control) and OQ-3 (delete as a command) **remain open**, and editor routing stays
  blocked on OQ-2. **Not scheduled and not authorized.**
- **Deferred architecture** — considered only if evidence justifies it, never pre-emptively:
  operation-specific compensation (only where a concrete failure mode warrants it); a persisted recovery
  marker (only if runtime evidence requires one); a generic coordination mechanism (only after a
  **second** convergent operation demonstrates the need). None of these is approved today.
- **Explicitly not authorised:** a Unit of Work; a Transaction Coordinator; a `StorageAdapter` journal;
  a single-key envelope; any backend assumption. Generic compound-persistence coordination is an **open
  question**, not an approved direction.
- **UX roadmap (workspace refresh).** **UX-001** (discovery) and **GOV-008** (governance) are complete
  and authorized nothing by themselves. **UX-002A — Shell/View Structural Foundation** and **UX-002B —
  Minimal Workspace Foundation** are **merged**: UX-002A separated the persistent shell from view
  rendering; UX-002B delivered the CSS golden-master revision (PD-A), the typography and token
  foundation (PD-B, PD-C), chart theme tokenization, and the dashboard density pass (20 metric
  containers → 13 on the Executive Dashboard, with no unique value removed). UX-002B carried an
  authorized fourth commit — a **Phase 1 narrow-width remediation** — after Phase 2 validation exposed a
  480px grid-containment regression that Phase 1 had introduced and mis-reported as resolved; the
  correction and the mandated fixture/measurement method are recorded in
  [`audit/ux-002b-2026-08-05/`](docs/99-archive/audit/ux-002b-2026-08-05/CSS-GOLDEN-MASTER-REVISION.md).
  **UX-003 is complete and merged** in three sprints. **UX-003A — Reference-Date Correctness** made
  `daysUntilEnd` share the normalized reference date used by the rest of `contractCalc`; today-facing
  behaviour stayed equivalent, historical advisory output became reference-correct, and no payroll,
  committed payroll, monthly-plan, storage, schema or contract value changed. **UX-003B — Canonical
  Contract Timeline Model** replaced the scattered expiry logic with one classifier returning two
  independent derived dimensions (effective state + expiry horizon), with `Scheduled` derived-only and
  `Expiring Soon` retained as a legacy alias. **UX-003C — Contract Progress, Counters, Filters and
  Presentation** made every counter resolve through one canonical helper, moved the status filter onto
  the canonical effective state, and fixed the progress wording so `3/3` reads as the final month.
  See §5 for the model and §19 for the decisions.
  **UX-004 — Sidebar & Navigation**, **UX-005A–F** and the UX-005 Platform Freeze Review are all
  **complete and merged**, and **UX-006 — Identity, Personal Workspace, Authorization and Presentation
  (A/B/C/C2/C2C/C3/D) is COMPLETE and FROZEN**; the Readiness-1/2/3 programme is merged and frozen and
  **v2.10.0 is published and marked Latest**, while the v2.10.0 controlled pilot is **APPROVED but NOT
  YET LAUNCHED** (publication is not a launch). The forward-looking sequence is
  Controlled Pilot → Post-Pilot Findings & Remediation → Pilot Exit Review → Distribution-1 →
  Multi-User-1…8 → General-Use Readiness → UX-006F / v3.0.0; the authoritative table is
  [`docs/01-roadmap/README.md`](docs/01-roadmap/README.md) and the milestone detail is
  [`docs/05-milestones/Milestones.md`](docs/05-milestones/Milestones.md). **UX-006E — Persistence &
  Migration Hardening and UX-006F — Integration Freeze & v3.0.0 Readiness have not begun.**
- **Planned:** Payroll Reporting suite expansion; supplemental sources beyond overtime; ongoing
  repository maintenance.
- **Under consideration:** attachment/evidence handling; expanded approval workflows.
- **NEW MAINTAINER REQUIREMENT — NOT YET ARCHITECTED: multi-user operation.** A future pilot/general-use
  target requires shared company data across users and devices, real authentication, backend/shared
  persistence, server-side authorization and read scope, and multi-user deployment. This is **separate
  from, and does not describe, the currently approved v2.10.0 controlled pilot**, which is explicitly
  single-operator, local-only and trust-based. It conflicts with the client-only MUST in
  [`CLAUDE.md`](CLAUDE.md) §4.3 and would require an explicit constitutional amendment and ADR before any
  work begins. **No implementation is authorized.** Recorded in
  [`docs/99-archive/roadmap-completed/Multi-User-Requirement-Note.md`](docs/99-archive/roadmap-completed/Multi-User-Requirement-Note.md).
  **Multi-User-0 — Shared Multi-User Architecture Decision** has since analysed it and proposed a target
  architecture — one authoritative company dataset in PostgreSQL with Row-Level Security as the
  enforcement boundary, Supabase Auth for verified identity, an online-required client, and the browser
  treated as **untrusted** (`ACTIONS` stays 20; existing record IDs preserved). See
  [`docs/01-roadmap/Multi-User-0-Shared-Multi-User-Architecture-Decision.md`](docs/01-roadmap/Multi-User-0-Shared-Multi-User-Architecture-Decision.md)
  and [ADR-0003](docs/03b-repository-adr/ADR-0003-shared-multi-user-architecture.md). **ADR-0003 is `Accepted`
  (2026-08-12) as the architecture *baseline* — Multi-User-0 is MERGED / FROZEN.** Acceptance settles
  the **direction only**: it authorizes **no** implementation, backend provisioning, migration, runtime
  or schema change, and **no `CLAUDE.md` amendment**. **`CLAUDE.md` §4.3 remains fully operative and
  unamended, and continues to block every Multi-User implementation milestone** — Multi-User-1…8 have
  **not begun and are not authorized**. The approved v2.10.0 controlled pilot is **unchanged** and is
  not multi-user.

The canonical roadmap lives in [`README.md`](README.md#roadmap).

## 18. Technical Debt

- No general automated regression suite; coverage is the invariant verifier plus thirty-four targeted runtime
  harnesses, with the remaining behavioural coverage manual.
- Heavy use of direct DOM string rendering — safe today because user data is escaped, but a
  standing reason to keep escaping disciplined.
- Some persisted records carry legacy/compatibility fields retained to avoid migrations.
- Compound (multi-key) persistence is checked and reported but not coordinated, and detected partial
  states are not repaired; see *Known Limitations* for the outstanding residuals.

## 19. Important Design Decisions

- **Single-file, client-only, zero-dependency** by design — maximizes portability and keeps
  confidential data on-device.
- **Classic scripts in one global scope** were kept deliberately (not migrated to modules) to
  preserve a verified, byte-checked golden master and avoid a bundler.
- **CSS is pinned by digest, not derived from a reference artifact** (UX-002B / PD-A). The verifier
  previously reconstructed the expected stylesheet from the v2.5.2 artifact plus one enumerated string
  patch; that chain could not express an authorized multi-file revision without accumulating opaque,
  order-dependent patches. It was replaced **one-for-one** by an exact SHA-256 of `concat(css/*.css)`,
  which is stricter and makes every future revision one reviewable line plus a diff. The current pin is
  `6d9c21375bdc608e99a56a3a65bc6fc293bbc506cda1b521742560902e3b4b96` (last revised for UX-006D3); every superseded anchor is
  preserved in [`audit/ux-002b-2026-08-05/`](docs/99-archive/audit/ux-002b-2026-08-05/CSS-GOLDEN-MASTER-REVISION.md).
- **Contract timeline is TWO derived dimensions, not one list** (UX-003B). "Where is this contract in
  its lifecycle?" and "how close is it to ending?" are independent questions, so `contractTimeline()`
  answers both in one computation and a horizon never replaces the effective state. Calendar horizons
  are calendar facts and are not gated by the warning setting; only `WithinWarningWindow` depends on it.
  Nothing is stored: `Scheduled` is derived, `Expiring Soon` is a compatibility alias, and
  `SCHEMA_VERSION` is unchanged.
- **One reference date per calculation** (UX-003A). Every field `contractCalc()` derives is measured
  against the same normalized reference date, so a single return object cannot answer two different
  time questions at once.
- **Presentation reads the model; it does not re-derive it** (UX-003C). One canonical counter, one label
  resolver and one wording helper serve every surface, so no two screens can drift. The status filter
  follows the canonical effective state so a badge and a filter can never disagree.
- **The application shell is mounted once** (UX-002A). `renderShell()` builds the sidebar, nav tree and
  the `#main` container; ordinary navigation replaces only the view content inside the persistent
  `#main` and syncs the nav's derived state in place via `syncShellState()`. `render()` survives as a
  compatibility facade, so all existing callers are unchanged.
- **Version derived from one constant** so the build, filename, and identity can never drift.
- **Operational payroll stages are a display mapping** over stored statuses, so UX can evolve without
  schema migrations.
- **Overtime drift is derived, not stored**, so warnings appear immediately, survive reload, and
  never duplicate — without a new storage flag.
- **Committed payroll immutability** is a hard rule; downstream corrections use supplemental flows
  rather than editing posted amounts.

## 20. Glossary

- **Modular source** — the human-edited `index.html` + `css/` + `js/` application.
- **Portable build** — the single self-contained HTML file under `dist/`, generated from source.
- **JS-provenance comparator** — the retained legacy reference HTML (`tam-intelligence-os-v2.5.2.html`),
  read by `tools/verify-build.js` **only** as the regression comparator for **JS provenance** and the
  data-safety invariants derived from it. It is *not* a general source of truth for the current
  application: since UX-002B the **CSS** master is a separate mechanism — a pinned SHA-256 digest of
  `concat(css/*.css)` asserted by the verifier.
- **CSS pin** — the pinned digest of the concatenated stylesheet. Changing CSS requires an approved
  revision, a new dated record under `docs/99-archive/audit/`, and a one-line pin update.
- **Load-order manifest** — the single file defining JS script load order, mirrored by `index.html`.
- **Verifier** — the Node script that enforces build fidelity and data-safety invariants.
- **Payroll stage** — the operational label (Draft/Review/Approved/Posted/Executed) derived from a
  stored status.
- **Overtime drift** — a derived warning that approved overtime no longer matches captured payroll.
- **Commit (payroll)** — posting approved payroll to finance as planned transactions.
- **Execution** — recording the actual payment against a planned transaction.
- **Complete Backup** — the full local-data JSON export/import used for recovery.
- **`SCHEMA_VERSION`** — the persisted-data schema version (currently 6); changes only via migration.

---

*This document describes the project as it currently stands. For the rules that do not change, see
[`CLAUDE.md`](CLAUDE.md); for implementation specifics, see [`ARCHITECTURE.md`](ARCHITECTURE.md).*
