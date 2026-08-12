# UX-005 — Executive & Personal Workspace: Product Architecture Freeze

**Status:** Architecture / product-definition **frozen for review**. **Not started** — no production
code is authorized by this document. Implementation is authorized only by a subsequent Sprint
Assignment per [`docs/01-roadmap/README.md`](README.md).

**Sprint:** UX-005 (architecture-definition; no UI). **Predecessors:** UX-001 (discovery) →
UX-002A/UX-002B → UX-003A–C → UX-004A discovery + UX-004B–UX-004F (shipped through **v2.8.6**).
**Successors:** UX-005A–UX-005F (Executive Workspace), then UX-006A–UX-006E (Personal Workspace).

This is forward-looking planning. It records the current architecture **as found in code on `main`**,
the **approved product decisions**, and the **intended sequence**. It is not architecture-as-built and
does not belong in [`docs/02-architecture/`](../02-architecture/README.md); the authoritative
current-state map remains [`ARCHITECTURE.md`](../../ARCHITECTURE.md). It supersedes nothing; it
reconciles and extends the UX-005 discovery audit.

---

## 1. Baseline Verification

Verified against the working tree at the assignment baseline.

| Fact | Value | Verified |
|---|---|---|
| Branch | `main` | ✓ |
| Post-release HEAD | `d624487e45666e7d09170a5f8d79340f2a35b4e7` | ✓ |
| Product / version | TAM OS 2.8.6 | ✓ (`APP_VERSION`, `index.html`) |
| `SCHEMA_VERSION` | `6` | ✓ (`js/core/constants.js:35`) |
| Artifact | `dist/tam-os-v2.8.6.html` | ✓ present |
| UX-004 | COMPLETE | ✓ (`AI_CONTEXT.md`) |
| UX-005 / UX-006 | not begun | ✓ |
| Working tree | clean at start | ✓ |

Verifier (1864), runtime (1467), harnesses (15) and contract-timeline (349) counts are taken from the
assignment as authoritative; this document changes none of them (no production code touched).

---

## 2. Prior UX-005 Discovery Reconciliation

The earlier discovery audit remains valid input. Reclassified against the approved decisions:

### Still valid (carried forward unchanged)
- Executive Dashboard ↔ Finance Overview KPI overlap (see §12).
- Data tables lack pagination, sorting, and debounced search (confirmed: no pagination/sort logic in
  `js/finance/transactions.js`, `js/people/employees.js`; search filters per-keystroke).
- Token drift / pervasive inline styles (`margin-bottom:14px` literals; 16–24 inline `style=` per view).
- No global search / command palette (confirmed absent).
- Finance navigation density (15 items + 3 placeholders under one domain).
- Responsive and accessibility polish opportunities (no skip-link, no `aria-sort`, no live-region
  result counts, mobile filter grids do not restack).

### Reprioritized
- **Dashboard architecture moves first** (UX-005A) — it defines KPI ownership that later phases depend on.
- **Design-system/token cleanup moves last** (UX-005E) — doing it before dashboard/data-grid work would
  restyle the same components twice.
- **Pagination is the approved default over virtualization** (§15) — the discovery had raised
  virtualization as an option; it is now explicitly deferred.
- **Action Center is elevated** to a first-class UX-005A contract (§13), not a "medium" polish item.

### Deferred to UX-006 (Personal Workspace)
- Any employee-facing surface, self-scope data model, authorization enforcement, and the employee
  overtime-submission UI. None of this is in UX-005.

Nothing from the discovery is discarded.

---

## 3. Executive Workspace — Definition (FROZEN)

The **Executive Workspace** is the current TAM OS company-management experience, renamed to reflect its
role. For the current product phase it is used by the **CEO** and has **company-wide (ALL COMPANY)**
scope. It remains the authoritative environment for all company operations and owns every existing
module: Executive Dashboard, Executive Insights, People (Employees, Contracts), Finance (Overview,
Payroll, Transactions, Planning, Overtime, Supplements, Import, Recurring, Cash Flow, Budget Center,
Execution, Bank Accounts), Analytics (Planned vs Actual, Compare, Trends, Reports), and System
(Settings, Activity Log, About, Release Notes).

No executive module is removed, gated, or reduced by this architecture. UX-005 **improves** this
workspace; it does not fork it.

---

## 4. Personal Workspace — Definition (FROZEN)

The **Personal Workspace** is a **separate, purpose-built** employee experience — **not** a reduced or
permission-masked copy of the Executive Workspace. It contains only the current employee's own
information. Target surfaces (UX-006, not now): **Home, My Profile, My Contract, My Payroll, My
Overtime** (+ personal documents only if later approved).

**Design rule (frozen):** unavailable executive modules are **absent from the Personal Workspace
information architecture** — never rendered as locked/disabled entries. The employee does not need to
know executive modules exist. The Personal Workspace has its own navigation manifest, not a filtered
view of `NAV_GROUPS`.

---

## 5. CEO Access Model (FROZEN)

`CEO → Executive Workspace`, data scope **ALL COMPANY**. Full access to every existing module and every
existing business control, exactly as today. No change to CEO capabilities in UX-005.

---

## 6. Employee Access Model (FROZEN)

`Employee → Personal Workspace`, data scope **SELF ONLY**. Approved employee-visible surfaces, all
**read-only** except where noted:

| Surface | Content (self only) | Access |
|---|---|---|
| My Profile | name, job title, department, join date, employment status, non-sensitive employment identity | read |
| My Contract | own contract only: status, start/end date, own salary terms, own benefit terms | read |
| My Payroll | own salary, payslip, payroll history, deductions, bonuses/THR | read |
| My Overtime | own overtime records; **submit own overtime request** | read + **submit only** |

The employee must never see another employee's profile, contract, or payroll, nor any company total.

---

## 7. Employee Mutation Boundary (FROZEN)

> An Employee is **read-only** across the Personal Workspace **except** for creating/submitting their
> own overtime request.

Explicitly **forbidden** for the employee: editing profile/employment/contract/salary/payroll;
approving/posting/executing overtime or payroll; creating/editing transactions or finance data; editing
system settings or company data; deleting any authoritative record. Submitting an overtime request is
the **only** approved employee mutation. Any further employee write permission requires a **new,
explicit product decision** — none may be inferred.

---

## 8. Employee Company-Data Boundary (FROZEN)

> The Personal Workspace does not expose company operational, financial, analytical, or administrative
> information.

Out of scope for the employee (non-exhaustive): Finance Overview, company Transactions, Cash Flow,
Budget, Planning, Execution Center, Bank Accounts, company-wide Payroll, Employees directory, other
employees' contracts, Analytics, Reports, System configuration, Settings, Activity Log, company-level
KPIs.

**Enforcement is layered — hidden navigation is not authorization.** The architecture distinguishes
three independent layers, all of which UX-006 must enforce:
1. **Navigation visibility** — the item is not in the Personal Workspace IA;
2. **Route authorization** — the view is not reachable via `State.view`, helpers, or deep-link for an
   employee identity;
3. **Record/data scope** — every retrieval resolves to the current employee's own records.

---

## 9. Data Scope Principle (FROZEN)

- **CEO:** `ALL COMPANY`.
- **Employee:** `SELF ONLY`, resolved from the **authenticated/current-user context** — never from a
  user-editable employee-id parameter as the sole boundary. Conceptual invariant:
  `requested employee record.id === current employee identity`.

This document states the principle only; it does **not** implement authentication or authorization
(that is UX-006B).

---

## 10. Executive Dashboard — Canonical Home (FROZEN)

**Executive Dashboard is the canonical home of the Executive Workspace** (already the default landing
page: `DEFAULT_SETTINGS.defaultLandingPage = 'execDashboard'`). Its purpose is executive
decision-making — it should answer: *What is the state of the company? What changed? What needs
attention? Where do I go next?* It owns top company KPIs, prioritized alerts, high-level trends,
decision/action signals, the future **Action Center**, and drill-through into operational workspaces.
It must **not** become a detailed accounting ledger.

---

## 11. Finance Overview — Operational Role (FROZEN)

Finance Overview is **retained**, recast as the **operational finance workspace** (month-scoped detail),
not a competing executive home. Its responsibilities: monthly financial position, finance-specific
breakdowns, over/under-budget items, unplanned/missing-realization items, execution/cash/budget context,
and category-level drill-downs. Duplicate KPIs are resolved by **clarifying ownership** (§12), not by
deleting information for visual tidiness.

---

## 12. Dashboard KPI Ownership Matrix

Inventory of headline KPIs as found in `js/analytics/executive-dashboard.js` (Executive Dashboard) and
`js/finance/dashboard.js` (Finance Overview). **No calculation changes are authorized in UX-005A** —
this matrix reassigns *presentation and ownership* only.

| KPI | Current calc source | Current page(s) | Future owner | Drill-through | Calc change? |
|---|---|---|---|---|---|
| Plan vs Actual (merged: actual, planned, budget-used %) | `monthTotals`, `monthActualInfo` | Exec Dashboard | **Executive** | → Finance Overview (month) | No |
| Budget Variance | `monthTotals.variance` | **Both** | **Executive** (headline) + **Finance** (as `% of plan`, different framing) | → Finance Overview | No |
| Net Cash Flow (income − actual expense) | `monthTotals.netCashFlow` / `monthIncomeInfo` | **Both** | **Executive** (company signal) | → Cash Flow | No |
| Planned (month) | `monthTotals.planned` | Finance Overview | **Finance-only** | → Transactions (month) | No |
| Actual Spent (under/over plan) | `monthTotals.actual` | Finance Overview | **Finance-only** | → Transactions (month) | No |
| Executed / Remaining / Execution Rate | `execStats` | Finance Overview | **Finance-only** | → Execution Center | No |
| Transaction Status (done/partial/pending/cancelled) | `execStats` | Finance Overview | **Finance-only** | → Transactions (status filter) | No |
| Payroll Cycle tile | `payrollCycleTileHTML` | Exec Dashboard | **Executive** | → Payroll | No |
| HR / Payroll / Overtime strips | `hrStatStripHTML`, `payrollStripHTML`, `overtimeStripHTML` | Exec Dashboard | **Executive** | → People / Payroll / Overtime | No |
| Executive Alerts (severity-sorted, capped) | `computeExecutiveAlerts` (+ HR/OT/payroll alerts) | Exec Dashboard | **Executive** → feeds **Action Center** | → owning workspace | No |
| Executive Trend (planned vs actual) | `trendRows` | Exec Dashboard | **Executive** | click point → month Overview | No |
| Planned vs Actual by Category | `categoryBreakdown` | Finance Overview | **Finance-only** | → Transactions (category) | No |
| Largest Expense Categories | `categoryBreakdown` | Finance Overview | **Finance-only** | → Transactions (category) | No |
| Over/Under Budget, Unplanned, Missing Realization | `overUnderItems`, `txnsForMonth` | Finance Overview | **Finance-only** | → transaction detail | No |
| Insights (auto-generated) | `computeInsights` | Finance Overview | **Finance-only** | — | No |

**Resolution summary.** The four overlapping headlines — Planned, Actual, Budget Variance, Net Cash
Flow — become **Finance-only for the raw operational figures** (Planned, Actual) and **Executive for the
decision signals** (Variance headline, Net Cash Flow). Where a figure appears on both (Budget Variance),
the framing must be materially different (absolute company signal on Executive; `% of plan` operational
detail on Finance) — otherwise it is removed from Finance. **Preferred UX-005A outcome: no computation
changes; ownership + drill-through only.**

---

## 13. Action Center — Product Contract (future, Executive Dashboard)

Answers **"What requires my attention now?"** Categories are derived only from existing authoritative
data (the same generators already backing Executive Alerts): payroll ready for next step; posted payroll
awaiting execution; contracts approaching expiry (`contractExpiryWarningDays`); integrity findings;
failed/residual posting states; and — **once the Personal Workspace exists** — pending employee overtime
requests.

**The Action Center MUST NOT** auto-execute, auto-approve, auto-post, invent new workflow stages, or
duplicate the raw Activity Log. Each item is a **navigation signal** to the authoritative workspace where
the existing business control (with its confirmations, permissions, and audit) remains responsible. This
is a **future UX contract**, not authorized for build in this document.

---

## 14. Global Search — Product Contract (future)

A read-/navigation-oriented command palette (`Ctrl/Cmd + K`). Searchable record types: employees,
contracts, transactions, payroll, and existing navigable views. First version supports **direct
navigation only** — **no execution, approval, posting, or destructive action** through the palette. It
must not become a write-command engine. Scope-aware in UX-006: an employee's palette searches only
self-scope records.

---

## 15. Pagination-vs-Virtualization Decision (FROZEN)

**Pagination is the approved default** for the initial Data Grid Foundation (UX-005B). Rationale:
stable row identity, predictable selection, export compatibility, deterministic keyboard behavior,
auditability, and easier deterministic testing — all of which matter for finance/payroll data.
**Virtualization is deferred** and introduced only if measured scale proves pagination insufficient.

---

## 15a. Data Grid is a Shared Platform Foundation (FROZEN, UX-005B finalization)

`js/core/data-grid.js` is a **shared platform foundation** consumed by multiple pages,
not a per-page utility. To keep it durable and reusable:

- **New generic grid capabilities** (selection, bulk actions, column visibility, saved
  views, density, server pagination, virtualization) require **explicit roadmap
  approval** before being added — never added casually.
- **Page-specific behaviour** (row markup, business filtering, action binding, export
  semantics) belongs in the owning page module, never inside the shared grid.
- The module stays **data-source / role / storage / business agnostic** and must not
  grow into a "god object": prefer small composable helpers + per-page column/feature
  configuration.

## 16. Data Grid Foundation — Contract

A reusable, presentation-only query layer. **Critical invariant: sorting, pagination, and filtering
never modify or reorder the underlying persisted business records — they are view/query state only.**

| Aspect | Contract |
|---|---|
| Pagination model | Page-based (offset), stable across re-render |
| Default page size | 50 (recommended; ratify in UX-005B) |
| Allowed page sizes | 25 / 50 / 100 |
| Sorting | Single-column, stable sort; multi-column deferred |
| Search | Debounced (~200–250ms), same fields as today |
| Filter result count | "N of M" shown; announced via live region (§19) |
| Filter ordering | Preserve existing filter order per view |
| Selection | Survives sort/paginate where a view already has selection (e.g. payroll) |
| Row identity | Business record id — never array index |
| Empty state | Existing per-view empty state (unchanged) |
| Filtered-empty state | Distinct "no rows match these filters" message |
| Keyboard | Tab order preserved; focus/scroll retained across re-render (per §12 browser rules) |
| Export | Export reflects the **filtered/sorted result set**, not the current page only |

---

## 17. Workspace Productivity — Contract (UX-005C)

Global search / command palette (§14), `Ctrl/Cmd + K`, recent records, pinned/favorite destinations,
contextual record discovery, and Action Center integration. All read-oriented; palette actions never
bypass authoritative business workflows.

---

## 18. Workspace Memory — Contract (UX-005D)

> Remember UI preferences only when there is clear user benefit and no business-data ambiguity.

Every remembered value MUST be classified before persisting:

| Class | Examples | Persistence |
|---|---|---|
| Session-only | drawer open, sidebar collapse, "More" disclosure, transient selection | in-memory (as today) |
| Persisted preference | last sort, last filters, page size, recent views, pinned destinations | localStorage **preference** key — governed |
| Business state | any authoritative record/field | **never** repurposed as UI memory |

**No `SCHEMA_VERSION` change during architecture work.** Any new persisted-preference key is a
storage-governance change (CLAUDE.md §7, §20; `docs/DATA-SAFETY.md`) requiring explicit approval — it
must not be smuggled into `tam_settings_v1` or the schema without that review.

---

## 19. Responsive & Accessibility Direction (UX-005F)

Skip-to-content link; `aria-sort` on sortable headers; live-region announcement of "N of M" filter
results; mobile filter-grid restacking; touch-target sizing (`btn-sm`, floating menu items); keyboard
navigation for data-grid controls; responsive table controls; optional density/wide mode only if
justified. Marks decorative nav glyphs `aria-hidden` while preserving the accessible label already
present.

---

## 20. Complete UX-005 Roadmap (Executive Workspace) — FROZEN sequence

| Phase | Title | Focus |
|---|---|---|
> **Sequence correction (authoritative).** The C–F phases were resequenced after this freeze
> was written. Design System Consistency is now **UX-005C** (moved earlier, since later phases
> benefit from a consistent base), and Global Search / Cross-Module Discoverability is now
> **UX-005D**. The detailed contracts in §14 (Global Search) and §17 (Workspace Productivity)
> describe the **UX-005D** work; §18 (Workspace Memory) folds into the later phases.

| Phase | Title | Focus |
|---|---|---|
| **UX-005A** *(merged to `main`)* | Executive Dashboard & Information Architecture | Canonical home; Exec↔Finance overlap resolved; KPI ownership; drill-through; Action Center; duplicate Net Cash Flow tile removed; all computations preserved |
| **UX-005B** *(merged to `main`)* | Data Grid Foundation | Reusable `js/core/data-grid.js` (R1–R9): column definitions, comparator registry, `State.grid`, default-sort registry, source/role/storage-agnostic helpers, fixtures, page sizes 20/50/100 (default 20), feature flags. Transactions + Employees; presentation/query-state only |
| **UX-005C** *(merged to `main`)* | Design System Consistency & Token Drift Cleanup | Normalized off-grid `margin-bottom:14px` rhythm → `var(--space-4)` via `.stack-section`; fixed undefined `var(--gold,…)` → `var(--accent)`; disambiguated the three duplicate `▤` sidebar glyphs. Presentation only |
| **UX-005D** *(implementation candidate — unmerged, branch `feature/ux-005d-global-search`)* | Cross-Module Discoverability / Global Search | Navigation-only `Ctrl/Cmd+K` palette over a pure, source-agnostic engine (`js/core/global-search.js`) + adapter/palette (`js/ui/global-search-ui.js`). Searches Employees/Contracts/Payroll/navigable-views; activates via `hrNavTo` only (no execute/write). Scope-safety seam for UX-006; transactions deferred; recents/pins deferred (see §14, §17) |
| **UX-005E** | Responsive & Density Polish | Mobile restack, density options, viewport polish. Not begun |
| **UX-005F** | Accessibility / final UX hardening | Skip-link, `aria-sort`, live counts, touch targets, keyboard. Not begun |

UX-005F completes the Executive Workspace before UX-006 begins, unless a later explicit product decision
resequences.

---

## 21. Complete UX-006 Roadmap (Personal Workspace) — high-level direction

| Phase | Title | Direction (not designed here) |
|---|---|---|
| **UX-006A** | Personal Workspace Foundation | Workspace selection, Personal Home, employee-specific navigation manifest, self-data presentation |
| **UX-006B** | Authorization & Self Scope | CEO vs Employee; route authorization; self-only record scope; executive-module isolation (three enforcement layers, §8) |
| **UX-006C** | Employee Overtime Request | Employee submission → Pending → executive review; no employee approval/posting/execution (§22) |
| **UX-006D** | Personal Documents / Employment Info | Only if product need is confirmed |
| **UX-006E** | Personal Workspace Polish & Audit | Accessibility, responsive, authorization regression + privacy testing |

No additional employee permissions may be manufactured beyond those frozen in §6–§7.

### Overtime Request future flow (product level)
`Employee → Submit Overtime Request → Pending → Executive review → Approved / Rejected → approved
overtime follows the existing authoritative payroll/overtime process.` Submitting ≠ approving. The
employee may not manipulate approval status, post, or execute. This maps onto the existing overtime
lifecycle (`js/people/overtime.js`: `Draft → Approved → Committed to Payroll`) but requires a distinct
**Submitted/Pending** state preceding executive `Approved`; the current model has no such
employee-submitted state (see §23). Not implemented in UX-005.

---

## 22. Authorization / Security Boundary (requirement only)

**UX visibility is NOT authorization.** UX-006 must enforce access at four points: workspace selection,
route/navigation, record/data retrieval, and mutation/action. An employee must not reach executive or
company data by manually changing `State.view`, calling an exposed navigation helper (e.g. `hrNavTo`),
manipulating record ids, deep-linking, or using hidden UI controls. This document records the
requirement; it authorizes no security implementation.

---

## 23. Architectural Conflicts Found (surfaced, not resolved)

Material conflicts between the approved product model and the current implementation. **None is silently
resolved** — each is flagged for the owning future sprint.

1. **No identity / auth / role model exists at all.** A repository-wide search for
   `currentUser` / `authenticat` / `login` / `role` / `permission` / user-session concepts returns
   nothing. The app is single-scope and single-user. The entire Executive/Personal split, `SELF ONLY`
   scope, and the "current-user context" of §9 depend on an identity primitive that **does not yet
   exist**. → **UX-006B** must introduce it; UX-005 must not.
2. **Routing has no workspace dimension.** Navigation is a flat `State.view` switch in
   `renderViewContent` (`js/ui/shell-render.js:496`) over one `NAV_GROUPS` manifest. There is no
   "workspace" concept above the view. Personal Workspace needs a **second navigation manifest and a
   workspace selector**, not a filter over the existing one. → **UX-006A**.
3. **State/storage is single-scope.** `State` is one global object and storage keys are company-scoped
   (`tam_*`), with `SCHEMA_VERSION 6`. Self-scoped employee data retrieval and any persisted UI
   preference (§18) are **storage-governance changes** — not free. → **UX-005D / UX-006B**.
4. **Overtime lifecycle lacks an employee-submitted state.** `newOvertime` creates status `Draft` and
   `setOvertimeStatus` moves `Draft → Approved → Committed to Payroll`; there is no
   employee-`Submitted/Pending` state distinct from executive approval. The §21 flow requires adding one
   without weakening the rule that submitting ≠ approving. → **UX-006C**.
5. **Employee/contract/payroll linkage exists but is not scope-guarded.** `empById`, `contractById`,
   `payrollPlanById` resolve any record by id (used freely in breadcrumbs/quick-actions). Reused as-is
   for an employee, they would return **any** employee's data — the §9 invariant must wrap them. →
   **UX-006B**.
6. **No table query-state layer.** Views render full result sets and re-filter per keystroke. The Data
   Grid contract (§16) is net-new shared behavior. → **UX-005B**.

These are **direction-setting**, not blockers for UX-005A (which is Executive-only and identity-free).

---

## 24. Frozen Product Decisions

1. `Executive Workspace` and `Personal Workspace` are the two product workspace concepts.
2. The current CEO uses the Executive Workspace.
3. The current Employee uses the Personal Workspace.
4. Executive Workspace has company-wide scope.
5. Personal Workspace has `SELF ONLY` scope.
6. Employee may see only their own profile, contract, payroll/salary, and overtime.
7. Employee cannot access company finance, analytics, system, other employees, or other company data.
8. Employee is read-only except for submitting their own overtime request.
9. Employee cannot approve/post/execute overtime or payroll.
10. Executive Dashboard is the canonical Executive Workspace home.
11. Finance Overview remains an operational finance workspace.
12. Pagination is preferred over virtualization for the initial Data Grid Foundation.
13. Global Search is navigation/read-oriented first.
14. Action Center never bypasses authoritative business workflow.
15. Workspace-memory persistence requires explicit state classification.
16. UX-005 concerns the Executive Workspace.
17. Personal Workspace implementation begins in UX-006.
18. UX-005F completes Executive Workspace polish before UX-006 begins, unless a later explicit product
    decision changes sequencing.

---

## 25. Documentation Placement Recommendation

This document is forward-looking approved direction, so it lives in
[`docs/01-roadmap/`](README.md) — matching the precedent set by
[`UX-004-Sidebar-Navigation-Discovery.md`](UX-004-Sidebar-Navigation-Discovery.md). Canonical name:
`docs/01-roadmap/UX-005-Executive-Personal-Workspace-Architecture.md` (this file). It does **not** belong
in `docs/02-architecture/` (implemented-only) and does not modify `ARCHITECTURE.md` or `AI_CONTEXT.md`
to imply these features exist. The only directly-required index update is the roadmap folder README
table.

---

## 26. Files Modified

- **Added:** `docs/01-roadmap/UX-005-Executive-Personal-Workspace-Architecture.md` (this document).
- **Edited:** `docs/01-roadmap/README.md` — one roadmap-index row referencing this document.

No production JS, CSS, `dist/` artifact, `APP_VERSION`, `SCHEMA_VERSION`, business logic, workflow,
published release, or tag was modified. No branch, commit, or PR was created.

---

## 27. Confirmation — No Implementation Began

No UX-005A or UX-006 implementation was started. No production code was written or changed. This is a
documentation-only architecture freeze.

---

## 28. Recommendation for the First UX-005A Implementation-Planning Assignment

Issue **UX-005A — Executive Dashboard & Information Architecture (implementation planning)** with this
scope:
- Adopt the §12 KPI ownership matrix as the contract; **change presentation/ownership/drill-through
  only — no computation changes** (verifier-checkable: the alert/KPI generator functions remain
  byte-identical).
- Make every Executive Dashboard KPI drill through to its owning operational workspace; recast Finance
  Overview per §11 (remove only KPIs whose Executive framing is not materially different).
- Specify the **Action Center** on the Executive Dashboard as a navigation-only surface over existing
  alert generators (§13) — no new workflow stages, no auto-actions.
- Explicitly **exclude** the Data Grid, global search, memory, token cleanup, and any Personal Workspace
  or identity work (those are UX-005B–F / UX-006).
- Require browser validation of both artifacts with zero console errors and preserved persistence, per
  CLAUDE.md §12 and `docs/QA-CHECKLIST.md`.

---

*Forward-looking planning only. Implementation of any phase is authorized solely by a subsequent Sprint
Assignment. This document records the sequence and the frozen product contract — not a commitment to
dates, and not authorization to build.*
