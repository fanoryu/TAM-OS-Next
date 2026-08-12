# UX-006D3 — Cross-surface Presentation Consistency & Acceptance (Implementation Plan)

**Status:** implemented, merged & frozen — merge `e76460dc`
**Baseline:** `5163cfce` (main after the UX-006D2 merge)
**Phase before:** UX-006D2 (merged & frozen, `5163cfce`) · **After merge:** UX-006D is COMPLETE / FROZEN
**Governing supersession:** [UX-006 architecture §20A](UX-006-Identity-Personal-Workspace-Architecture.md)

---

## 1. What this phase is

UX-006D3 is the final UX-006D phase and its acceptance gate. It is **presentation only**: no
authorization policy, action vocabulary, route semantic, mutation semantic, principal data scope,
storage or schema change. `js/core/authz.js` is **byte-unchanged**.

## 2. Cross-surface inventory

All 27 sidebar views were walked in a real browser at three viewports, plus the context-only detail
views, Action Center, Quick Actions, sidebar, principal/workspace context, empty states and modals.

| Classification | Count | Notes |
|---|---|---|
| **PASS** | 33 | already consistent — headings, `.page-head`, breadcrumbs, nav `aria-current`, button classes, Action Center, Quick Actions, principal/workspace context, detail views, modals |
| **FIX** | 2 | one systemic empty-state defect spanning 9 views; one narrow-viewport overflow |
| **DEFER** | 2 | see §6 |
| **NOT APPLICABLE** | — | placeholder/planned modules render the shared "Coming in a future release" state by design |

Only surfaces with a **material** inconsistency were changed.

## 3. FIX 1 — a view with no data lost its identity (9 views)

`emptyState(title, sub)` replaced the **entire page**, heading included. Nine sidebar views —
Overview, Executive Insights, Cash Flow, Budget Center, Execution Center, Planned vs Actual, Compare
Months, Monthly Trends, Reports — therefore rendered an **untitled card** the moment they had no data,
while the other eighteen kept their heading and showed an in-table empty row. The operator landed on a
page whose only identification was the breadcrumb.

The same early return also removed the `.page-head` slot `mountQuickActions()` mounts into, so a
**frozen UX-006C3 navigation surface silently never rendered** in the empty state: Execution Center
declares 3 Quick Actions in the manifest and `quickActionsFor('executioncenter')` returned all 3, yet
0 were displayed.

**Fix.** `emptyState()` now renders a heading **derived from `PAGE_TITLES`**, which is itself derived
from the one `NAV_GROUPS` manifest — no title is duplicated, and no call site changed. Context-only
detail views (`employeeDetail`, `contractDetail`, `payrollDetail`, `supplementalDetail`) are
deliberately absent from that manifest, so a **"record not found"** state still renders no heading,
exactly as before.

> **Judgement call flagged for review.** Restoring the header also restores the Quick Actions mount
> point, so Execution Center now shows its 3 frozen Quick Actions in the empty state (previously 0).
> This changes **no** destination, availability, label, handler or authorization — it makes an already
> frozen and already-resolving navigation surface actually render where it was silently dropped. It is
> reported explicitly rather than buried.

## 4. FIX 2 — narrow-viewport horizontal overflow (pre-existing)

Release Notes overflowed a 375px viewport by **80px**: long unbreakable tokens (storage keys,
identifiers, version strings) in card prose forced the whole page into horizontal scroll. Confirmed
**pre-existing** by re-measuring the untouched baseline, which overflows identically.

**Fix.** One additive rule: `.card li, .card p, .card .desc{overflow-wrap:break-word;}`. `break-word`
engages only when a word would otherwise overflow, so wider viewports and ordinary copy are unchanged.
Recorded as an authorized CSS golden-master revision; `css/tokens.css` and `css/shell.css` untouched.

## 5. Hardened UX-005A guard (prose sensitivity)

Documenting FIX 1 inside `js/finance/dashboard.js` tripped
`check(!/UX-006/.test(ux5aExec + ux5aDash))` — a **raw-source** guard that fired on the mere string
"UX-006", including in a comment.

- **Invariant it protects:** the UX-005A dashboard sources contain no UX-006 identity / workspace /
  authorization **implementation**.
- **Why the old form was fragile:** it could not distinguish prose from code, so a lawful presentation
  change could not be explained in-file; and it never proved the invariant anyway — code introduced
  without a "UX-006" label passed it untouched.
- **Hardening (strictly stronger, never weaker):** the label check now runs on **comment-stripped**
  code, **plus** a new explicit check for the actual UX-006 API surface (`getCurrentUser`,
  `getCurrentWorkspace`, `getScopedRecords`, `getBoundEmployee`, `authzDisabled`,
  `LocalIdentityProvider`, `IdentityProvider`, `principalType`, `canPrincipal`, `PRINCIPAL_TYPES`,
  `WORKSPACE_TYPES`, `can(`, `ACTIONS.`) — which the old label check could not see at all.
- **Regression proof:** D3 harness §8 asserts prose no longer trips it, while a real `getCurrentUser()`
  or `can(ACTIONS.*)` call in code still does.

The sibling structural checks are unchanged. **The UX-006D1 guard was not touched** — D3 does not
modify the source it protects.

## 6. Deferred

| Item | Reason |
|---|---|
| Disabled-control reason discoverability on touch/keyboard | The denial reason rides a native `title` on a `disabled` button, which some browsers do not surface on hover and which is not keyboard-reachable. Fixing it properly means changing the frozen UX-006C3 disabled-control pattern — out of D3's remit |
| Principal-aware Global Search data scope | Explicitly **outside UX-006D**; a separate future functionality milestone |

## 7. Acceptance criteria

| # | Criterion | Proven by |
|---|---|---|
| A1 | All 27 sidebar views keep an `<h1>` in the no-data state | D3 harness §1 |
| A2 | The heading is derived, never duplicated | D3 harness §1 + verifier |
| A3 | "Record not found" still renders no heading | D3 harness §1b |
| A4 | Empty-state copy never implies a permission problem, and is identical for every principal | D3 harness §1c |
| A5 | 43 frozen C3 entries intact; navigation visible+normal for CEO / Employee / null | D3 harness §2 |
| A6 | Seven denied controls stay visible + disabled + marked, never hidden | D3 harness §3 |
| A7 | D2 principal/workspace semantics survive, including both null-workspace causes | D3 harness §4 |
| A8 | No authorization-driven hiding introduced anywhere | D3 harness §5 |
| A9 | `ACTIONS` 20, `APP_VERSION` 2.9.0, `SCHEMA_VERSION` 6, `can()` delegation unchanged | D3 harness §6 + verifier |
| A10 | Global Search scope wiring still deferred | D3 harness §7 |
| A11 | The hardened UX-005A guard is stronger, not weaker | D3 harness §8 |
| A12 | No horizontal overflow at 375 / 768 / desktop across all 27 views | browser validation |

## 8. Verification

- Verifier **2386 PASS / 0 FAIL** (was 2371; +15)
- Runtime **2705 PASS / 32 harnesses / 0 FAIL** (was 2621 / 31; +84 from the new D3 harness)
- No existing count fell: D2 127 · C3 91 · C2C-4 164 · C2C-3 129 · C2C-2 118 · C2C-1 60 · authz 104 ·
  outcome 53 · D1 29
- Modular source **and** portable build both boot with **zero console errors**
