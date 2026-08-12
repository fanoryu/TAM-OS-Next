# UX-004 — Sidebar & Navigation: Discovery & Architecture

**Status:** Discovery complete; approved as the implementation baseline. **Not started** — no
production code is authorized by this document. Implementation is authorized only by a subsequent
Sprint Assignment per [`docs/01-roadmap/README.md`](README.md).

**Sprint:** UX-004A (discovery-only). **Predecessors:** UX-001 (discovery) → UX-002A/UX-002B →
UX-003A/UX-003B/UX-003C, all shipped in **v2.8.5**. **Successor sprints:** UX-004B–UX-004E, then
UX-005 (responsive/mobile), sequenced in §6 — this document does **not** change that ordering.

This is forward-looking planning: it records the current navigation architecture as found in code on
`main`, the approved design constraints, and the intended sequence. It is not architecture-as-built and
does not belong in [`docs/02-architecture/`](../02-architecture/README.md); the authoritative
current-state map remains [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

---

## 1. Approved Design Constraints (mandatory)

The following two decisions are **approved, mandatory design constraints** for UX-004 and every sprint
after it. They are recorded here **once** and are the authoritative statement; other documents link
here rather than restating them.

### Constraint 1 — Numeric Typography Standard (official, from UX-004 onward)

The application **must not** expand monospace typography across the interface. The official standard is:

- **Keep the application's primary UI font** (the sans UI face established in UX-002B). Numbers stay in
  the primary font, not a monospace face.
- **Apply OpenType Tabular Numerals** — `font-variant-numeric: tabular-nums` — wherever numeric values
  are shown and the font supports it, so digits occupy equal advance width.
- **Objective:** a modern UI appearance with aligned digits, stable layout, and no "jumping numbers"
  when values change or re-render.

**Minimum scope** (numeric surfaces that must adopt tabular numerals):

- Dashboard KPI values
- Currency values
- Payroll amounts
- Salary values
- Financial totals
- Transaction amounts
- Percentages
- Progress indicators (e.g. `1/3`, `20/24`)
- Dashboard counters
- Numeric table columns
- Analytics metrics

**Monospace remains reserved for** source code, technical identifiers, and developer-oriented values
only — never for ordinary financial or UI numbers.

**Presentation-layer boundary (binding).** This standard is **strictly a presentation-layer concern —
only the on-screen *rendering* of digits changes.** It **must never** modify any of the following, and
no implementation of it may be interpreted as doing so:

- numeric precision
- number-formatting rules
- locale-specific separators
- currency formatting
- calculation logic
- payroll calculations
- persisted data
- exported values — including CSV, Excel, and PDF output

`font-variant-numeric: tabular-nums` selects a glyph set for display; it changes no character in a
string and no value in memory or storage. The formatting helpers (e.g. `fmtIDR`,
`toLocaleString('id-ID', …)`) and every export path produce byte-identical output before and after this
standard is applied. Any change that would alter a computed, formatted, stored, or exported number is
**out of scope for UX-004 and prohibited** by this constraint.

*Baseline at time of approval:* the codebase currently applies the monospace token `var(--mono)`
(JetBrains Mono) to numeric surfaces — `.stat-value`, `td.num`/`th.num`, `.mono`
([`css/components.css`](../../css/components.css)) — and declares **no** `tabular-nums` anywhere. This
standard **supersedes that styling going forward** (see §7, Conflict C-1); it does not rewrite the
shipped UX-002B decision as history.

### Constraint 2 — Payroll / Overtime Workflow UX (navigation only)

The canonical ERP workflow **must not** be simplified, shortened, or have steps removed. It remains:

```
Generate → Review → Approve → Post to Finance → Execution → Completed
```

This sequence exists for **auditability and separation of duties** and is a business-control invariant.
UX-004 improves **navigation only — never business logic.** Every approval, audit-trail entry, and
control in the sequence is preserved exactly.

**Required UX improvements (navigation only):**

- After **Post to Finance**, the user must **not** have to manually search for the Execution Center.
- Provide contextual **Quick Actions / deep links** at the hand-off, for example:
  - **Go to Execution Center**
  - **View Posted Transactions**
  - **Execute Posted Transactions**

**Governance guardrail (binding):** these Quick Actions are **navigation shortcuts only** — they move
the user to the next step and nothing more. They **must**:

- never auto-execute payroll;
- never bypass approvals;
- never bypass posting;
- never alter the business workflow;
- never reduce auditability.

Each shortcut lands the user on the existing screen for the next step (Execution Center / posted
transactions), where the same controls, confirmations, and audit-trail entries apply exactly as they do
today. This keeps the constraint consistent with the payroll and finance invariants in
[`CLAUDE.md`](../../CLAUDE.md) §8–§9 — in particular §9.2 *"No automatic execution (MUST)"* and §8.1
*"Committed payroll is immutable (MUST)."*

**Goal:** preserve approvals, the audit trail, and business controls, while making navigation feel
linear and intuitive — faster to move through, without reducing governance.

### Constraint 3 — Sidebar Branding Standard

The sidebar branding is simplified to a fixed application wordmark plus a configurable organization
subtitle. **This is a visual simplification only** — it does not change product identity, the About
screen, or release branding, and it touches no data.

**Expanded sidebar — two lines:**

- **Application wordmark (fixed):** **"TAM Intelligence OS"** — line 1. It is a fixed product identity
  string, not configurable.
- **Organization subtitle (configurable):** line 2 uses the **configured company name**
  (`State.settings.companyName`), with the default installation value **"PT Total Asset Manajemen"**
  (`COMPANY_NAME_DEFAULT`).

**Collapsed sidebar:**

- Display only the compact application icon (e.g. "TAM OS"); **no wordmark and no subtitle.**

Stated explicitly:

- the **application wordmark is fixed**;
- the **company subtitle remains configurable** — it **must not be hardcoded**;
- the **default installation uses "PT Total Asset Manajemen"**;
- keeping the subtitle configurable **improves future reuse without changing product identity**.

This preserves the current behaviour of the second brand line (`State.settings.companyName ||
COMPANY_NAME_DEFAULT`) and resolves the open product question raised in UX-004B planning in favour of the
**configurable** subtitle. There is no separate image logo today — the mark is already a text wordmark —
so "wordmark only" formalizes existing behaviour. The wordmark remains the one place the serif face
survives (per UX-002B / PD-B). No change to `APP_NAME`, `APP_VERSION`, `APP_RELEASE_NAME`, the About
view, or any release-branding text.

### Constraint 4 — Icon System Standard

UX-004 introduces **one consistent sidebar icon language**, replacing the current mix of inline Unicode
glyphs (27 literal characters in `NAV_GROUPS`, including a `VS-15` variation-selector workaround).

- **One icon family only** — no mixed Unicode glyph styles.
- **Consistent** visual weight, sizing, and alignment across every nav item.
- Icons remain **decorative**; **labels remain the primary navigation cue** (icons never carry meaning
  a label does not also convey).

*No specific icon library is selected at this stage.* This is the architectural standard the
implementation must satisfy; library selection is deferred to the implementing phase.

### Constraint 5 — Sidebar Spacing Standard

Sidebar layout is governed by **shared layout tokens**, not per-component styling. Spacing,
indentation, icon alignment, menu-item height, and section spacing must all resolve from the shared
token scales (`--space-*`, `--radius-*`, `--fs-*` established in UX-002B) rather than ad-hoc values on
individual elements. The purpose is **long-term consistency as new modules are added**: a new nav item
inherits correct geometry by construction. (Documentation of the rule only — no implementation here.)

### Constraint 6 — Context-Aware Quick Actions

This **extends the Quick Actions guidance in Constraint 2**; the governance guardrail defined there
(navigation shortcuts only; never auto-execute payroll, bypass approvals, bypass posting, alter the
business workflow, or reduce auditability) applies in full and is **not restated here**.

Quick Actions are **contextual** — the actions offered depend on the current view. Illustrative sets:

| Context | Contextual Quick Actions (navigation shortcuts) |
|---|---|
| **Employee Detail** | Edit Employee · View Contract · Generate Payroll |
| **Contract Detail** | Renew Contract · View Employee · Payroll Impact |
| **Payroll Workspace** | Generate Payroll · Review Posted Payroll · Execute Posted Payroll |
| **Execution Center** | Execute Posted Transactions · View Transaction Queue |

Each action routes the user to the existing screen where that operation is performed under its normal
controls and approvals. **Quick Actions never execute a business operation automatically**; business
workflow and approvals remain exactly as they are today. (Implementation of these belongs to UX-004D per
§6; recorded here as the approved contract.)

### Constraint 7 — Visual Design Principles

The intended navigation experience is **enterprise-first and calm**:

- **enterprise-first** — a management tool, not a consumer app;
- **typography over decoration**;
- **whitespace over visual density**;
- **consistency over novelty**;
- navigation should feel **calm and predictable**;
- **branding should be understated**;
- **navigation hierarchy should always be visually obvious** (the user can always tell where they are
  and what contains what).

These principles are the tie-breaker for any design choice left open by the constraints above; they do
not add scope.

### Constraint 8 — Sidebar Width Standard

The expanded sidebar uses **one fixed width**, defined by shared layout tokens:

- the expanded rail has a **single fixed width**, sourced from the design-system tokens (not an ad-hoc
  literal on the component);
- the width **never changes based on menu text length** — content never drives rail geometry;
- **labels may wrap or truncate** according to the design system, but the rail does not resize to fit
  them;
- the **navigation rail itself never expands or shrinks because of content.**

This improves **visual stability** and preserves **predictable layout alignment** as new modules and
labels are added. (The collapsed/pinned/hover-expand rail of UX-004E is a separate, deliberate *mode*
switch — not content-driven resizing — and is consistent with this constraint.)

---

## 2. Current Navigation Architecture (as found on `main`)

Traceable to code on `main` at the time of discovery. File/line references are anchors, not a promise
they never move.

- **Shell:** one persistent shell mounted once by `renderShell()` (UX-002A); navigation swaps only
  `#main` and calls `syncShellState()` — [`js/ui/shell-render.js`](../../js/ui/shell-render.js).
- **Nav data:** a single static literal `NAV_GROUPS` — **7 groups, 34 items** (Executive, Finance,
  People & Contracts, Analytics, Operations, Management, System).
- **Route key:** `State.view`, a flat string assigned across ~25 sites; `renderView()` is a 34-branch
  `if` ladder with no parent/child model and no URL/history.
- **Two nav entry points:** sidebar `[data-nav]` clicks (via `bindShell`) and the drill-down helper
  `hrNavTo(view, extra)` ([`js/people/people-core.js`](../../js/people/people-core.js)).
- **Context-only views (10, no nav entry):** `smartImport, importResults, employeeDedup,
  employeeDetail, contractDetail, payrollDetail, payrollAdjustments, overtimeSheet, supplementalDetail,
  legacyMap`.
- **Active state:** `syncShellState()` marks `.active` only where `State.view` equals a `[data-nav]`
  id — so **detail views show no active sidebar item**.
- **Back-navigation:** hardcoded per view (`backCt→contracts`, `backEmp→employees`,
  `pdBack→payroll`, `wsBack→overtime`, …); `State.detailReturnView` is declared but **never read or
  written** (dead state).
- **No breadcrumb** exists. **No mobile drawer/hamburger** exists; the sidebar is always on-screen
  (258px, 170px ≤640px). Numeric surfaces use monospace; **no `tabular-nums`.**

## 3. Discovered Issues (summary)

Redundant/miscategorized nav (Reports, Activity Log, Bank Accounts, Recurring Expenses sit in
catch-all Operations/Management groups); duplicated action reachability (Execute/Schedule from two
views; two Generate-Payroll buttons; Add/Upload vs Smart Import); sidebar debt (dead `detailReturnView`,
active-state blind on detail views, two nav APIs, ad-hoc Unicode glyphs); responsive risk (no drawer,
five unaligned breakpoints, px-fixed type scale, a known pre-existing 480px Release-Notes overflow, and
a `prompt()`-based Schedule action). Click-path baseline (source-traced): contract navigation **2**,
overtime approval **3**, **payroll execution ~10** clicks spanning two separate nav destinations —
which Constraint 2 targets by navigation, not by removing steps.

## 4. Domain Grouping (7 → 5)

> **Finalized by UX-004C.** The table below is the **finalized five-domain model** that UX-004C
> implements. It **supersedes the original discovery proposal** (preserved beneath it for the record).
> The frozen §1 constraints and §5.1 scope decisions are unchanged by this finalization.

| Domain (finalized) | Items |
|---|---|
| **Dashboard** | Executive Dashboard, Executive Insights |
| **People** | Employees, Contracts |
| **Finance** | Finance Overview, Payroll Workspace, Overtime, Supplemental Payments, Monthly Plan Generator, Transactions, Add/Upload, Recurring Expenses, Cash Flow, Budget Center, Execution Center, Bank Accounts, Projects*, Vendors*, Financial Calendar* |
| **Analytics** | Planned vs Actual, Compare Months, Monthly Trends, Reports |
| **System** | Settings, Activity Log, About, Release Notes |

*Projects / Vendors / Financial Calendar are `comingSoon` placeholders.*

**Product decision (finalized in UX-004C).** Payroll, Overtime, Supplemental Payments and Monthly Plan
are **Finance**, not People: their primary function is financial processing, and grouping them with
Execution Center keeps the *Payroll → Execution* flow inside one domain. **Reports** is **Analytics**
(an analytical workspace), not Dashboard (executive consumption/overview). **Executive Insights** stays
in **Dashboard**. **Employees** and **Contracts** remain **People** (workforce master data). The
**Finance** group being larger than the others is an accepted trade-off; internal visual sub-hierarchy
is deferred to later UX refinement and must not change canonical domain ownership without a new product
decision.

> **Original discovery proposal (superseded — kept for the record).** The grouping first *proposed*
> during discovery differed: it placed Payroll Workspace / Overtime / Supplemental Payments / Monthly
> Plan Generator under **People**, and Reports under **Dashboard**. That was a proposal, not a frozen
> decision; the finalized model above is authoritative.
>
> | Proposed group (discovery) | Absorbs |
> |---|---|
> | Dashboard | Executive Dashboard, Executive Insights, Reports |
> | People | Employees, Contracts, Payroll Workspace, Overtime, Supplemental Payments, Monthly Plan Generator |
> | Finance | Finance Overview, Execution Center, Transactions, Add/Upload, Cash Flow, Budget Center, Recurring Expenses, Bank Accounts |
> | Analytics | Planned vs Actual, Compare Months, Monthly Trends |
> | System | Settings, About, Release Notes, Activity Log |

## 5. Future Module Placement

| Module | Group | Notes |
|---|---|---|
| Reimbursement | People | New; peer of Supplemental Payments |
| Leave | People | New; employee-scoped |
| Vendors | Finance | Already `comingSoon` in `FEATURE_REGISTRY` |
| Projects | Finance (or Analytics) | Already `comingSoon` |
| Financial Calendar | Finance | Already `comingSoon` |

New modules reuse the existing `FEATURE_REGISTRY` + `featureBadgeHTML` "SOON" mechanism — badged,
non-navigable placeholders, no schema change.

### 5.1 Confirmed Scope Decisions (frozen — no longer open questions)

The following are **confirmed product-owner scope decisions** for UX-004. They were previously raised as
open questions in UX-004B planning; they are now settled and are **not** implementation questions:

- **HR Dashboard is not a standalone navigation page.** HR information **remains part of the Executive
  Dashboard** until a future sprint explicitly introduces a dedicated page. UX-004 adds no HR Dashboard
  nav item or view.
- **Backup & Restore remains inside Settings** (Settings → Data Portability). It is **not** promoted to
  top-level navigation during UX-004.
- **Import and Export remain distributed features** (import via Add/Upload + Smart Import; export via
  per-module CSV and Data Portability). **No unified Import/Export Center** is introduced during UX-004.

These decisions bound UX-004 to the **existing views**; none of the three is a new surface to be built in
this workstream.

## 6. Implementation Phases (sequence unchanged by this revision)

- **UX-004B** — Navigation model & active-state: view→group/label descriptor; fix active-state on the
  10 detail views; retire dead `detailReturnView` and the hardcoded back-buttons.
- **UX-004C** — Domain regrouping (7 → 5, §4).
- **UX-004D** — Breadcrumbs & Quick Actions — **including the Constraint 2 payroll → execution
  hand-off deep links.**
- **UX-004E** — Collapsed / pinned / hover-expand rail.
- **UX-005** — Responsive/mobile drawer, breakpoint unification, px→rem type-scale review, 480px
  overflow remediation.

**The Numeric Typography Standard (Constraint 1)** is a cross-cutting styling change; it is applied as
each phase touches the relevant numeric surfaces and is completed no later than UX-004D. It is a CSS
change and therefore requires an intentional, documented golden-master pin revision (see §7).

Each phase is independently shippable, additive, and behind existing data shapes.

### 6.1 Approved Implementation Architecture (UX-004B — frozen)

The UX-004B Sidebar Foundation is built on the following approved architecture. It is the frozen
technical contract for the B1→B4 sequence above.

- **Canonical navigation manifest (B1).** One source of truth maps every `renderView()` route that is
  not itself a sidebar item (context-only detail, wizard and drill-down views) to its owning sidebar
  **item**. Direct sidebar views own themselves; only context-only views declare a parent. The owning
  **group is never hardcoded** — it is derived from `NAV_GROUPS`, so ownership follows automatically
  when UX-004C regroups. This replaces scattered exact-match (`State.view === id`) logic.
- **Hierarchical active-state inheritance (B2).** Active state resolves through the manifest, not exact
  `State.view` equality: a detail page keeps its **parent** sidebar item highlighted; **exactly one**
  item is active and it alone carries `aria-current="page"` (stale `aria-current` is always removed);
  the owning group is automatically shown expanded while one of its descendant views is active.
  Resolution is centralized in the shell/navigation layer — no business module carries sidebar-highlight
  code — and both navigation APIs (sidebar `[data-nav]` and `hrNavTo()`) converge on it.
- **One data-driven sidebar renderer (B3).** A single persistent, data-driven renderer (driven by
  `NAV_GROUPS` + the manifest) — never a second or per-view renderer. It preserves the UX-002A
  persistent-shell contract: the sidebar mounts once, ordinary navigation never rebuilds it, and node
  identity, listener identity, and scroll position are preserved.
- **Accessibility foundation (B4).** The sidebar nav is a single `<nav aria-label="Primary
  navigation">` landmark; group heads keep correct `aria-expanded`; the active item uses
  `aria-current="page"`; native keyboard tab order is preserved. Roving tabindex, arrow-key navigation,
  shortcuts, and a command palette are explicitly deferred.
- **State & storage.** All navigation state is **session-only** — no storage key, no `SCHEMA_VERSION`
  change, no migration. The manifest is a module-level constant; active state is derived each sync.

## 7. Architectural Interactions & Conflicts

- **C-1 — Numeric typography vs UX-002B (forward supersession, not contradiction).** UX-002B styled
  numeric surfaces with `var(--mono)`. Constraint 1 replaces that with primary-font + `tabular-nums`
  **from UX-004 onward**. UX-002B stays intact as shipped history; the new standard is the go-forward
  rule and is consistent with UX-002B's own token-based, theme-aware approach. **Implementation impact:**
  it changes `concat(css/*.css)` and will trip the pinned CSS golden-master digest
  (`b1cec5dd…`), so the implementing phase must ship a documented pin revision (CLAUDE.md §4.5, §11) —
  the same discipline UX-002B used.
- **C-2 — Payroll workflow vs finance invariants (reinforcing, no conflict).** Constraint 2 preserves
  the Generate→…→Completed sequence and forbids auto-execution, which *strengthens* CLAUDE.md §8–§9
  (plan-vs-actual separation, no automatic execution, committed-payroll immutability). The hand-off is
  navigation-only by design.
- **No conflict with UX-001 or UX-003.** UX-001 was discovery/direction; UX-003 governs contract
  timeline/counter presentation, a different surface. Constraint 1's "progress indicators (`1/3`)" item
  aligns with UX-003C wording and only changes digit rendering, not the values or the wording rules.

## 8. Constraints, Risks & Stop Conditions

All UX-004 implementation sprints remain bound by: shared global classic-script scope and load-order
manifest agreement (CLAUDE.md §4.1–4.2); the CSS golden-master pin discipline (§4.5, §11); the
persistent-shell node-identity contract (UX-002A) — the drawer/rail must mutate in place, never rebuild
the shell; **no** `SCHEMA_VERSION` bump, storage-key, or migration change (collapse/pin/hover/breadcrumb
state stays client-only, §7 of the constitution); no new runtime dependency, framework, bundler, or ES
modules; and no weakening of any verifier or runtime-harness check. Any change violating these stops the
sprint for reconciliation.
