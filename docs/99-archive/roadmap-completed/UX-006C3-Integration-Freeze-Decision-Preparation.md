# UX-006C3 — Integration Freeze: Decision Preparation

**STATUS: DECISION PREPARATION — NO IMPLEMENTATION.** No production code, no `ACTIONS` change, no `POLICY`
change, no UI change is made by this document. It exists because UX-006C3 is specified in the repository only
as a one-line staging-table row; this inventories the actual integration surface, classifies it, and proposes
an implementation contract for an owner ruling. **Recommendations here are evidence, not frozen decisions.**

---

## 0. Baseline

| | |
|---|---|
| `main` | `ce9a68370ac34247a2906873f9f8dbb3c0524acd` (PR #125 merge) |
| `ACTIONS` | **20** (frozen) · `APP_VERSION` **2.9.0** · `SCHEMA_VERSION` **6** |
| Mutation enforcement | **CLOSED** — all 30 frozen rows authorized (C2C-1…C2C-4) |
| Verifier / runtime | 2312 PASS / 0 FAIL · 2403 PASS / 29 harnesses / 0 FAIL |

**Why this document exists.** The only C3 specification in the repository is
`UX-006C-Authorization-Implementation-Plan.md:315`:

> **UX-006C3 — Integration Freeze** | Action Center / navigation / action-availability semantics, regression,
> freeze | shell/nav (authorized) | overlaps UX-006D presentation

Four other documents defer the same subject jointly to *"UX-006C3 / UX-006D"*
(`UX-006C2` plan §143 and §253, `UX-006C2C` plan §299, `UX-006D1` plan §263), so the C3↔D boundary was never
drawn. No acceptance criteria, no surface inventory, no ruling on denied-action presentation existed.

---

## 1. Frozen premises (not reopened here)

- Runtime authorization at the **mutation boundary** is the source of truth. UI availability is an
  **affordance, never an enforcement boundary**. C3 must not replace, duplicate or weaken any gate.
- `ACTIONS` stays **20**. This document proposes **no new action** — none is needed (§4).
- Denied mutations must keep the outcome-reporting invariant established by PR #122 and applied through
  C2C-3/4: no mutation, no persistence, no false success, denial reported.

---

## 2. Surface inventory

**Totals: 43 entries** — 27 sidebar nav items, 12 Quick Actions, 4 Action Center generators.
**Every one of them is navigation-only.** Not one performs a domain mutation.

### 2.1 Sidebar navigation — `js/ui/shell-render.js`, `NAV_GROUPS` (27 items, 5 groups)

| Group | Items | Notes |
|---|---|---|
| Dashboard | `execDashboard`, `execinsights` | 2 |
| People | `employees`, `contracts` | 2 |
| Finance | `financeOverview`, `payroll`, `transactions`, `monthlyplan`, `overtime`, `supplementals`, `add`, `recurring`, `cashflow`, `budgetcenter`, `executioncenter`, `bankaccounts`, `projects`*, `vendors`*, `calendar`* | 15 (*3 are `placeholder:true` — no destination behaviour) |
| Analytics | `planvsactual`, `compare`, `trends`, `reports` | 4 |
| System | `settings`, `activity`, `about`, `releasenotes` | 4 |

Click handler (`[data-nav]`, `shell-render.js:292`): `captureSidebarScroll()` → `State.view = …` →
`State.pendingImport = null` → `render()`. **No persistence, no domain write.**

### 2.2 Quick Actions — `QUICK_ACTIONS_BY_VIEW` (12 entries across 6 views)

`employeeDetail` (2), `contractDetail` (2), `payroll` (1), `payrollDetail` (2), `overtime` (2),
`executioncenter` (3). Each entry is `{label, to, show?, resolve?}`; `quickActionsFor()` filters by the
`show()` predicate at render time (a throwing predicate hides the action — fail-safe). The only effect is
`hrNavTo()`.

### 2.3 Executive Dashboard Action Center — `js/analytics/executive-dashboard.js` (4 generators)

| Generator | Destination |
|---|---|
| `computeExecutiveAlerts` | `financeOverview` |
| `hrDashboardAlerts` | `contracts` |
| `overtimeDashboardAlerts` | `overtime` |
| `payrollDashboardAlerts` | `payroll` |

Items are **derived alerts** (dynamic count, not a fixed list) rendered as `[data-ac-nav]` buttons whose
handler navigates only.

---

## 3. Navigation vs. mutation — verified comprehensively

```
hrNavTo(view, extra){ if(extra) Object.assign(State, extra); State.view = view; render(); }
```

`State.view` and the `detail*Id` context keys it assigns are **in-memory view state** — the category the
C2C-3/4 inventory already ruled NOT APPLICABLE (§5.1: "no persistence, no business record"). I traced all
three handlers (`[data-nav]`, `[data-ac-nav]`, Quick Actions) plus `hrNavTo` itself:

**Direct mutation findings: NONE.** No entry in the 43-item surface writes a domain collection or calls a
`persist*` / `saveAllData` / `StorageAdapter` path. This materially simplifies the C3 contract: C3 is about
*affordance*, and cannot become a second enforcement layer even by accident.

---

## 4. Authorization relationship — destination availability ≠ action availability

This is the crux, and it is why a naive "gate the nav item" model fails.

| Destination | Mutation capabilities inside | Read-only value inside |
|---|---|---|
| `payroll` | `payroll.manage` (generate, lifecycle, commit, lock, adjustments) | payroll figures, stages, timeline |
| `transactions` / `executioncenter` | `finance.manage`, `finance.execute` | the ledger, statuses, history |
| `employees` / `contracts` | `employee.*`, `contract.*` | directory, contract terms, alerts |
| `overtime` | `overtime.manage` **and** `overtime.*SelfDraft` (Employee **is** allowed on own Drafts) | own records |
| `supplementals` | `supplemental.manage` | supplemental status |
| `add` (Import) | `import.commit`, `finance.manage` | — mostly a workflow entry |
| `settings` | `settings.manage` **and** `data.restore` / `data.reset` (different capabilities in one view) | diagnostics, exports, About |
| `bankaccounts` | `settings.manage` | account list |
| `recurring`, `monthlyplan` | `finance.manage` | plan/rule listings |
| Analytics, Dashboard, `activity`, `about`, `releasenotes` | **none** | entirely read-only |

**Findings:** (a) most destinations mix capabilities — `settings` alone spans `settings.manage`,
`data.restore` and `data.reset`; (b) every destination retains read value under UX-006B scope; (c) `overtime`
is the clearest counter-example to hiding — an Employee **is** authorized there for own-Draft self-service.
No one-action-per-destination mapping is defensible, and **no new action is required**.

---

## 5. Three presentation semantics assessed

| Criterion | VISIBLE + NORMAL (today) | VISIBLE + DISABLED | HIDDEN |
|---|---|---|---|
| Discoverability | full | full | destroyed — the user cannot learn the feature exists |
| Honest feedback | denial arrives only after clicking | states inability up front | silently misrepresents the product as smaller |
| Consistency with C2C | matches (block at boundary, report honestly) | matches and improves | conflicts — C2C deliberately kept functionality reachable and blocked |
| Navigation usefulness | preserved | preserved | lost, incl. read-only value |
| Can authorization be determined at this layer? | n/a | **only for a single-capability control** | requires collapsing a multi-capability view into one verdict — not sound |
| Policy-duplication risk | none | low **if** derived from `can()` at render time | high |
| UX complexity | none | low | low but destructive |

**Recommendation (evidence, not a ruling): a split model.**
- **Navigation entries** (sidebar, Quick Actions, Action Center) → **VISIBLE + NORMAL**. They are
  navigation-only, destinations are multi-capability and carry read-only value, and the frozen premise is not
  to hide functionality merely because the final mutation is denied.
- **Individual mutation controls inside a view** (the buttons that call a gated boundary) → **VISIBLE +
  DISABLED**, where the control maps to exactly one capability and `can()` can answer at render time. The
  boundary still denies independently; the disabled state is a courtesy, never the guard.
- **HIDDEN** → not recommended anywhere.

---

## 6. Proposed C3 / UX-006D ownership split

| UX-006C3 owns | UX-006D owns |
|---|---|
| authorization-aware availability state (derived, never persisted) | visual styling, layout, spacing |
| routing correctness, principal-change reaction | responsive presentation, iconography, animation |
| deep-link semantics: view access vs mutation authorization | copy polish that does not change authorization semantics |
| integration invariants + behavioural regression harness, then freeze | principal/workspace presentation UX |

Tested against the repository: the split holds for all 43 entries. **One ambiguous surface remains** — the
"Acting as" identity selector (`js/ui/identity-selector.js`, UX-006D1). It is presentation *and* the trigger
for principal change (§7). Recommend C3 own only its **re-render contract**, leaving its appearance to D.

---

## 7. Principal-change behaviour — already correct, must be preserved

`identity-selector.js` calls `LocalIdentityProvider.selectPrincipal(id)` then `render()` (line 88–90). Because
the shell re-renders from scratch and `quickActionsFor()` / the Action Center generators run **at render
time**, any availability derived inside a render pass is recalculated automatically on every principal change.

**Requirement for C3 (not implementation):** availability must be **derived at render time from `can()`**, and
never cached in `State`, persisted, or captured in a closure that outlives the render. This matches the
constitution's "derived, not duplicated" rule (§4.4). A regression must prove that a CEO-rendered surface,
after switching to Employee, shows Employee availability without a manual reload — the stale-provenance case
the C2C-2 review already caught once at the mutation layer (opening a modal as CEO, submitting as Employee).

---

## 8. Deep-link / direct navigation

`renderView()` contains **zero** `can(ACTIONS.*)` checks; `State.view` is assigned from 25 sites. A denied
principal can therefore reach any view directly.

**This is not a bypass.** Read visibility is owned by UX-006B scope, mutation by the closed C2C inventory;
view access is neither. Recommend C3 **explicitly rule** that navigation is permitted and privileged actions
inside are denied at the boundary — and add a regression asserting direct navigation to a privileged view
still cannot mutate. Route-level guards are **not** recommended: they would duplicate policy at a second
layer, destroy read-only value, and contradict §4's finding that destinations are multi-capability.

---

## 9. Proposed "Integration Freeze" acceptance criteria

1. All 27 nav items, 12 Quick Actions and 4 Action Center generators inventoried in a manifest the verifier reads.
2. Navigation-only surfaces **proven** non-mutating (behavioural, not string matching).
3. Availability is deterministic per principal and **derived at render time** — no persisted availability, no new `State` key, no `SCHEMA_VERSION` change.
4. A principal change recalculates availability with no reload.
5. Direct navigation to a privileged view cannot mutate (boundary still denies).
6. Denied mutations retain honest outcome reporting (no false success) — the PR #122 invariant re-asserted at the integration layer.
7. CEO positive paths remain fully available; Employee/null remain fail-closed at every mutation boundary.
8. `ACTIONS` remains **20**; no `POLICY` / `ACTION_RESOURCE_ENTITY` reinterpretation.
9. No schema, storage or backup-format change.
10. C3 absorbs no UX-006D visual redesign (asserted by diff scope: no CSS golden-master change).
11. A new behavioural harness covers 2–7.

**Proposed harness — `tools/verify-authz-integration-runtime.js`:** drives the real render path for CEO,
Employee and unresolved identity; asserts every navigation entry is reachable and non-mutating; asserts
availability recalculates on principal change; asserts direct navigation to each privileged view leaves State
byte-identical and performs zero writes when a mutation is attempted by a denied principal.

---

## 10. Expected implementation file inventory (if ruled)

`js/ui/shell-render.js` (nav + Quick Actions availability), `js/analytics/executive-dashboard.js` (Action
Center), possibly the per-view modules for individual disabled controls, plus
`tools/verify-authz-integration-runtime.js` (new) and `tools/verify-build.js` (structure guards). **No
`js/core/authz.js` change.**

---

## 11. Stale governance documentation (confirmed)

Both root documents are badly out of date — they predate four merged phases:

| File | Stale statement | Correction needed |
|---|---|---|
| `AI_CONTEXT.md:118-119` | *"The next authorized phase is UX-006C2 — Mutation Enforcement … which is not implemented and has not begun; UX-006C3 (integration freeze) and UX-006D have not begun"* | C2C-1…C2C-4 merged and frozen; `ACTIONS` 20; mutation-enforcement inventory CLOSED; C3 is the next phase, pending this ruling |
| `ARCHITECTURE.md:169-170` | *"The next stages, UX-006C2 (mutation enforcement) and UX-006C3 (integration freeze), are not implemented"* | same correction; the authz section should state `ACTIONS` 20 and name the three C2C-3 actions |

Deliberately **not** corrected in this PR: the fix belongs with the C3 ruling (or a dedicated housekeeping
assignment), and rewriting current-state docs is not part of decision preparation.

---

## 12. Risks and ambiguities requiring an Atlas ruling

| # | Question | Recommendation |
|---|---|---|
| C3-R1 | Denied-action semantics: VISIBLE+NORMAL / VISIBLE+DISABLED / HIDDEN? | the **split model** in §5 |
| C3-R2 | Do navigation entries ever get disabled or hidden? | **no** — navigation-only, multi-capability destinations, read-only value |
| C3-R3 | Should disabled state apply to every mutation control, or only single-capability ones? | only where `can()` answers unambiguously; never collapse a multi-capability view |
| C3-R4 | Does C3 own the "Acting as" selector? | its **re-render contract** only; appearance is D |
| C3-R5 | Are route-level guards in scope? | **no** — would duplicate policy and destroy read value |
| C3-R6 | Does C3 include the `AI_CONTEXT` / `ARCHITECTURE` refresh, or a separate pass? | separate housekeeping, sequenced with the ruling |
| C3-R7 | Are the 3 `placeholder:true` nav items in scope? | no — no destination behaviour exists to authorize |
| C3-R8 | Is "freeze" a doc status, or an enforced verifier invariant (manifest-count guard)? | **enforced** — a verifier-read manifest, so new surfaces cannot land unreviewed |

**No stop condition was triggered by this analysis:** no missing capability was found, no frozen mapping needs
reinterpretation, and no schema/storage implication exists.
