# Post-UX-006D — User-Readiness Audit

**Type:** audit / inventory / recommendation — **no runtime change**
**Baseline:** `main` = `e76460dc8c759bab4b6bdf406d32bea707d1cdee`
**Status at audit:** UX-006C COMPLETE/FROZEN · UX-006D COMPLETE/FROZEN (D1 `4a53a35`, D2 `5163cfce`, D3 `e76460dc`)
**Verifier** 2386 PASS / 0 FAIL · **Runtime** 2705 PASS / 32 harnesses / 0 FAIL · `ACTIONS` 20 · `APP_VERSION` 2.9.0 · `SCHEMA_VERSION` 6

This document answers one question: **what remains before TAM OS can be used by real users with confidence?**

---

> ## STATUS UPDATE — Readiness-1 MERGED / FROZEN (merge `3521d811`)
>
> The headline finding below has been **closed** by **Readiness-1 — Employee Read Scope &
> Privacy Closure** (branch `feature/readiness-1-employee-read-scope`). `getScopedRecords()`
> now has production consumers across People/HR, payroll, finance, analytics, reports and
> Global Search; `getScopedRecordById()` re-scopes every detail id at render time; and the
> breadcrumb no longer names an out-of-scope record. Employee **self-only read** is wired
> and regression-proved by `tools/verify-employee-read-scope-runtime.js` (84 checks), which
> fails with **33 counted assertion failures** on this baseline. No new ACTION, no schema or
> storage change: `ACTIONS` 20, `APP_VERSION` 2.9.0, `SCHEMA_VERSION` 6.
>
> **Finance/Analytics** follow the Atlas ruling: navigation stays visible+normal, but an
> Employee receives only records with an existing explicit `employeeId` relationship; an
> unowned company transaction is simply not in their scope, and no ownership model was
> invented. **Next milestone: Readiness-2 — End-to-End User Journey Acceptance.**
>
> The audit text below is preserved unchanged as the record of what was found.

## 1. Headline finding

> **The UX-006B self-scope layer is fully built, fully tested, and connected to nothing.**
>
> `getScopedRecords()` has **zero production consumers**. Every list, detail, search and report reads raw
> `State.*`, so an **Employee principal sees the entire company's data — including other employees' salaries**.
> Mutation authorization (UX-006C) is complete and correct; **read scope was never wired**.

This is not a defect in any completed milestone. UX-006B deliberately shipped **headless** (owner amendment
R1) and deferred consumer wiring to UX-006D "once a reachable principal-selection UX exists". UX-006D then
delivered D1 (selector), D2 (principal presentation) and D3 (cross-surface presentation) — all **presentation
only**, each explicitly excluding scope wiring. The wiring fell between the two milestones and **no phase
currently owns it**.

### Severity, stated honestly

| Framing | Assessment |
|---|---|
| As a **security vulnerability** | **No.** Identity is a local, spoofable selector documented in-source as *"NOT a security boundary"*. Anyone who can select Employee can select CEO. There is no authentication to bypass and no server to defend |
| As a **confidentiality/product defect** | **Yes — P1.** The app's own approved success criterion is *"self-only read"*. Today the Employee principal is not a usable persona: it shows a payroll operator every colleague's compensation |
| Effect on pilot | **A CEO-only pilot is unaffected. An Employee-facing pilot is blocked.** |

### Evidence (fabricated two-employee fixture, cleared afterwards)

| Probe | Scope layer says | UI actually does |
|---|---|---|
| `getScopedRecords('employee')` as Employee | **1** | — |
| Employees view header | 1 | **"2 of 2 employees shown, 2 active"** |
| Contracts view | 1 | **"2 contracts"**, renders `CT-SELF` **and** `CT-OTHER` |
| Payroll view | 1 | renders both employees' payroll rows |
| Global Search `"FIXTURE"` | 1 | **4 hits** — including *"employee: FIXTURE Other Employee"* and *"payroll: FIXTURE Other Employee"* |
| Deep link to other employee's detail | not in scope | **reached; their salary rendered** |

### Exact boundary

`js/ui/global-search-ui.js:158-166` already documents the seam:

```js
// SCOPE SEAM: today we pass company-wide sources. UX-006 will pass a self-scoped
// subset here without touching the engine or collector contract.
const docs = collectGlobalSearchDocuments({ employees: State.employees || [], … });
```

The Global Search **engine is correct and source-agnostic** — only the call site passes raw state. That part is
a ~3-line change. The list/detail/report surfaces are the larger share of the work.

### Intended policy is defined — no governance ruling needed to classify it

UX-006 architecture §20 (owner Decision Q2) states the v3.0.0 success criterion verbatim:

> "…the lower-privilege Employee path (**self-only read**; every non-approved write denied…). Shipping a
> CEO-only build does not satisfy v3.0.0."

So the requirement exists and is approved; only its **sequencing** needs an Atlas ruling (§10).

---

## 2. Read-scope classification (Employee-facing surfaces)

| Surface | Classification |
|---|---|
| Employees list · Employee detail | **LEAK / WRONG SCOPE** — company-wide, salary visible |
| Contracts list · Contract detail | **LEAK / WRONG SCOPE** — includes rates |
| Payroll workspace · Payroll detail | **LEAK / WRONG SCOPE** — includes totals |
| Overtime | **LEAK / WRONG SCOPE** — all employees' records |
| Global Search | **LEAK / WRONG SCOPE** — indexes employees, contracts, payroll company-wide |
| Activity Log | **LEAK / WRONG SCOPE** — company-wide audit trail |
| Finance (Overview, Transactions, Execution Center, Monthly Plan, Supplemental, Recurring, Bank) | **COMPANY-WIDE BY DESIGN** — no per-employee ownership model exists; needs a product ruling on whether Employees should reach these at all |
| Analytics (Insights, Cash Flow, Budget, Plan vs Actual, Compare, Trends, Reports) | **COMPANY-WIDE BY DESIGN** — same ruling needed |
| Settings / Backup / Reset | **CEO-ONLY DATA PRESENT BUT NON-MUTABLE** — visible, controls correctly disabled |
| Projects · Vendors · Calendar | **NOT APPLICABLE** — honest "Coming in a future release" placeholders |

**Deep-link semantics are working as frozen** (view access ≠ mutation authority). The problem is not that
Employees can *reach* views — C3 ruled that correct — it is that the views they reach are **unscoped**.

---

## 3. Functional readiness by workflow

| Domain | Status | Evidence |
|---|---|---|
| Identity / principal selection, switching, null | **READY** | D1 29 + D2 127 + D3 84 harness checks; browser-verified |
| Workspace context presentation | **READY** | D2; both null-workspace causes distinguished |
| People — create/edit/archive/delete/merge | **READY (CEO)** / **BLOCKED FOR GENERAL USE (Employee read scope)** | C2A 66 |
| Contracts + operations | **READY (CEO)** / same caveat | C2C-1 60 |
| Overtime incl. own-Draft self-service | **READY (CEO)** / same caveat | C2B 64 |
| Payroll — generate, lock, lifecycle, post to Finance | **READY** | C2C-1; payroll-posting 106, payroll-committed 72, integrity-payroll 144 |
| Finance — create/edit/archive/schedule/cancel/execute | **READY** | C2C-2 118 |
| Recurring · Monthly Plan · Legacy mapping | **READY** | monthlyplan 118, renewal 67 |
| Supplemental incl. orphan recovery | **READY** | C2C-4 164 |
| Import — commit, undo, preview, month replace | **READY** | C2C-2/3, savealldata 61 |
| Data lifecycle — backup, restore, reset, start fresh, demo | **READY** | C2C-3; savealldata 61 |
| Settings, bank/company accounts, onboarding | **READY** | C2C-4 |
| Navigation, Quick Actions, Action Center, deep links, disabled controls, responsive | **READY** | C3 91, D3 84; browser-verified at desktop/768/375 + collapsed rail |

**No workflow is BLOCKED FOR PILOT under a CEO-only pilot.** The single blocking issue is Employee read scope.

---

## 4. End-to-end journeys

| Journey | Harness coverage | Manual/browser proof still required |
|---|---|---|
| A — CEO finance (create → edit → schedule → execute) | C2C-2 118 + outcome 53 | Full UI click-through of execute/partial-payment |
| B — Employee self-service (own-Draft allowed, admin denied) | C2B 64 + C3 91 | Own-Draft overtime create/submit in the UI |
| C — Payroll (generate → review → lock → post) | C2C-1 60, posting 106, committed 72 | End-to-end UI run with real month data |
| D — Import (commit → undo) | savealldata 61, C2C-2/3 | Real spreadsheet file through the parser |
| E — Restore / lifecycle | savealldata 61, C2C-3 | Backup → restore → reload round-trip in the UI |
| F — Principal switching | D1 29, D2 127, D3 84 | **Covered** — browser-verified |

Journeys are **well covered at the boundary layer** and **thin at the UI click-through layer**. That gap is the
main non-privacy pilot risk, and is what Readiness-2 addresses.

---

## 5. Persistence, recovery, outcome integrity

| Area | Status |
|---|---|
| Multi-dataset persistence (SPR-079) — all 14 writes inspected | **INTACT** |
| Monthly Plan result integrity (SPR-082) | **INTACT** |
| `saveAllData()` result contract, failure-wording honesty | **PROVEN** — savealldata 61 |
| Denial ≠ success; no false success, no contradictory warning+success | **PROVEN** — outcome 53 |
| Backup before destructive action; restore rollback | **PROVEN** — C2C-3 |
| Reload/restart persistence, portable-build persistence | **PROVEN** — contract-persistence 74 |

No workflow was found that reports success while persistence failed. **Disaster recovery is adequate for a
pilot**, with the standing caveat that all data is browser-local: a cleared profile is unrecoverable without a
Complete Backup export. Pilot instructions must make export cadence explicit.

---

## 6. Accessibility / usability

| Finding | Class |
|---|---|
| Disabled-reason discoverability — denial rides a native `title` on a `disabled` button; not keyboard-reachable and unreliable on touch | **NON-BLOCKING POLISH** for CEO pilot; **GENERAL-USE BLOCKER** once Employees see disabled controls routinely |
| Visible labels, focus-visible coverage, skip-link, modal containment, `aria-current`, empty-state clarity, destructive emphasis, narrow-viewport usability | **NON-BLOCKING** — all verified good (UX-005F + D3) |

No pilot blockers.

---

## 7. Release readiness

| Fact | Value |
|---|---|
| Published release | v2.9.0 — 1,049,018 B, `e7470ff5…` (immutable) |
| Repo `dist/` at this baseline | 1,128,965 B, `ce3d869d…` |
| Convention | Semantic `MAJOR.MINOR.PATCH`; minor = backward-compatible features |

Since v2.9.0 the repo has added the entire UX-006A–D stack: identity, workspace primitives, a 20-action
authorization model enforced at 30 mutation boundaries, a reachable principal selector, and the C3 integration
freeze. These are **backward-compatible features** — no schema, storage-key or backup-format change
(`SCHEMA_VERSION` stays 6).

**Recommendation: `2.10.0`.** Not a patch (far beyond fixes); not `3.0.0`, because the repository reserves
that for the Decision Q2 criteria — both access models validated including **self-only read** — which this
audit shows are **not yet met**. Releasing 3.0.0 now would contradict the project's own success criterion.

Required alongside a 2.10.0 release candidate: release notes, "no migration required" note, Complete Backup
guidance, rollback guidance (reinstall prior single-file build; data is untouched), and pilot instructions.

---

## 8. Prioritized backlog

| ID | Title | Domain | Evidence | User impact | Risk | Pilot blocker | General-use blocker | Milestone | Size | Depends on |
|---|---|---|---|---|---|---|---|---|---|---|
| **R-1** | Wire `getScopedRecords()` into list/detail read paths | Read scope | zero consumers; other employee's salary reachable | Employee sees all salaries | High | **Employee pilot only** | **YES** | Readiness-1 | **L** | ruling §10.1 |
| **R-2** | Pass self-scoped sources at the Global Search seam | Read scope | `global-search-ui.js:158` | Employee searches all staff | High | **Employee pilot only** | **YES** | Readiness-1 | **S** | R-1 |
| **R-3** | Rule Employee reachability of Finance/Analytics | Product | company-wide by design, no ownership model | Undefined persona | Med | No | **YES** | Readiness-1 | **S** (ruling) | Atlas |
| **R-4** | Scope the Activity Log / audit trail | Read scope | company-wide | Employee sees all activity | Med | No | **YES** | Readiness-1 | **M** | R-3 |
| **R-5** | UI click-through E2E for journeys A–E | QA | boundary-covered, UI-thin | Undetected UI regressions | Med | **YES** | YES | Readiness-2 | **M** | — |
| **R-6** | Release candidate 2.10.0 + notes/backup/rollback/pilot docs | Release | no RC exists | Cannot pilot cleanly | Low | **YES** | YES | Readiness-3 | **S** | R-5 |
| **R-7** | Disabled-reason discoverability (keyboard/touch) | A11y | native `title` on `disabled` | Denials look arbitrary | Low | No | YES | Post-pilot | **M** | touches frozen C3 pattern → ruling |
| **R-8** | UX-006E — Persistence & Migration Hardening | Platform | NOT STARTED | Corruption recovery | Med | No | Recommended | Post-pilot | **L** | — |
| **R-9** | UX-006F — Integration Freeze & v3.0.0 Readiness | Platform | NOT STARTED | v3.0.0 gate | Low | No | For 3.0.0 | Pre-3.0.0 | **L** | R-1…R-8 |
| **R-10** | Projects / Vendors / Calendar modules | Features | honest placeholders | None — clearly labelled | None | No | No | Optional | **L** | product |
| **R-11** | MAINT-001 §7 follow-ups (branding assets, screenshots) | Docs | recorded backlog | None | None | No | No | Optional | **S** | — |

**Counts:** 11 live items · **2 pilot blockers** (R-5, R-6) for a CEO-only pilot, **+R-1/R-2 if Employees
participate** · **7 general-use blockers** (R-1…R-6, R-7).

**Superseded / not applicable:** pre-C3 UX-006D routing language (§20A), the "GS scope deferred to UX-006D"
deferrals in UX-006B/C2/C2C/D1 (D3 moved it outside UX-006D entirely), UX-006D's own three sub-phases, and the
UX-006C/C2/C2C plan bodies — all COMPLETE/FROZEN. **Total roadmap items reviewed: 11 live, 6 superseded,
3 not applicable.**

---

## 9. Recommended milestone sequence

```
Readiness-1 — Employee read scope      R-1, R-2, R-3, R-4   (needs ruling §10.1 first)
Readiness-2 — E2E / regression closure R-5
Readiness-3 — Release candidate 2.10.0 R-6
        ↓
   CONTROLLED PILOT  (CEO-only pilot may start after Readiness-2 + R-6)
        ↓
Post-pilot remediation                 R-7, R-8 + pilot findings
        ↓
   GENERAL USE
        ↓
UX-006F → v3.0.0                       R-9
```

**A CEO-only pilot can begin after Readiness-2 and R-6, without Readiness-1.** That is the fastest safe path to
real user feedback, and it is what the evidence supports.

### Pilot GO criteria
No P0/P1 data-loss defect · no unauthorized mutation bypass (**met** — 30 boundaries, 2705 runtime checks) ·
no unacceptable read-scope leak **for the personas in the pilot** (met for CEO-only; **not met** if Employees
participate) · core journeys click-through proven (R-5) · persistence/recovery proven (**met**) · source and
portable build green with zero console errors (**met**) · known limitations documented (this document) ·
Complete Backup + rollback path available (**met**) · verifier/runtime green (**met**).

**Recommended pilot shape:** 1–3 operators, **CEO principal only**, single device each, on real data **only
after** an exported Complete Backup, with a weekly export cadence. The architecture is single-user local-first,
so pilot size is bounded by devices, not concurrency.

### General-use GO criteria
All pilot criteria **plus**: R-1…R-4 complete (self-only read enforced and harness-proven) · R-7 resolved ·
pilot findings remediated · UX-006E persistence hardening (recommended) · multi-persona journeys proven.

---

## 10. Decisions requiring an Atlas ruling

1. **Sequencing of Employee read scope (R-1/R-2/R-4).** The requirement is already approved ("self-only read",
   Decision Q2). The ruling needed is *when*: block the pilot on it, or run a **CEO-only pilot first** and
   deliver it before general use? **This audit recommends CEO-only pilot first.**
2. **Which phase owns read-scope wiring.** It fell between UX-006B (headless) and UX-006D (presentation only).
   Recommend a new **Readiness-1** rather than reopening either frozen milestone.
3. **Employee reachability of Finance/Analytics (R-3).** No per-employee ownership model exists for
   transactions, so "self-scope" is undefined there. Options: keep company-wide, hide from Employees, or
   introduce ownership. **This is a genuine product decision and is not invented here.**
4. **R-7** touches the frozen C3 disabled-control pattern and needs authorization before implementation.

---

## 11. Completion estimate

Denominator: **everything required for General Use** — architecture, authorization, presentation, functional
workflows, read-scope/privacy, and release readiness — *excluding* optional feature modules (R-10) and the
v3.0.0-only UX-006F gate, which are beyond general use.

| Dimension | % | Basis |
|---|---|---|
| Architecture / core | **95%** | Complete and frozen; UX-006E hardening outstanding |
| Authorization (mutation) | **100%** | 20 actions, 30 boundaries, inventory CLOSED, frozen |
| Presentation / UX | **100%** | UX-006D complete and frozen |
| Functional readiness | **85%** | All workflows implemented and boundary-proven; UI click-through E2E thin (R-5) |
| Data privacy / read scope | **15%** | Primitives + harness exist (UX-006B); **zero consumers wired** |
| Release readiness | **40%** | Build green and deterministic; no RC, notes or pilot docs |
| **Pilot readiness (CEO-only)** | **85%** | Needs R-5 + R-6 |
| **Overall General Use readiness** | **~70%** | Weighted by remaining effort, dominated by R-1 (L) and R-8 (L) |

The overall figure is close to the previously cited 72% **for a different reason**: authorization and
presentation went from partial to complete (raising it), while this audit newly exposes read scope at ~15%
(lowering it). The prior estimate did not account for read scope at all.

---

## 12. Verification of this audit

Documentation-only. `ACTIONS` 20 · `APP_VERSION` 2.9.0 · `SCHEMA_VERSION` 6 · Verifier **2386 PASS / 0 FAIL** ·
Runtime **2705 PASS / 32 harnesses / 0 FAIL** · `dist/` unchanged. All investigation used fabricated fixtures
in browser `localStorage`, cleared afterwards (`tam_*` keys = 0); no repository file and no real data was
touched.
