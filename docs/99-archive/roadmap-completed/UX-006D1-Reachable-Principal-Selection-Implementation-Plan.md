# UX-006D1 — Reachable Principal Selection: Discovery & Implementation Plan

**STATUS: PLANNING — NOT IMPLEMENTED.** No production code is authorized by this document. It is the
focused discovery/implementation plan for **UX-006D1 — Reachable Principal Selection / Activation**, the
minimal prerequisite that makes the already-existing UX-006A `IdentityProvider` principals *reachable in the
running application* so that live identity-dependent behavior (UX-006C2 mutation enforcement) can later be
activated **without weakening the fail-closed identity model**. Implementation begins only under a separate,
owner-authorized assignment.

**This is not authentication.** UX-006D1 ships a UX affordance over the existing spoofable client-side
identity abstraction. It introduces no login, no password, no token, no session, no account security, and no
persistence. `currentUser === null` remains the initial, fail-closed state.

---

## 0. Baseline (carried from the C2A halt decision; unverified deltas are none)

| Fact | Value |
|---|---|
| main (frozen until this branch opens) | `28acd4e6fe326fed93ebbfef9017e1b2cb2fcf47` (clean) |
| APP_VERSION / SCHEMA_VERSION | `2.9.0` / **6** |
| Verifier | **2097 PASS** · runtime **1684 / 21** (authz **68**, workspace **31**, identity **33**) |
| Global Search / Data Grid | **26 / 36** |
| Dev artifact | `dist/tam-os-v2.9.0.html` — 1,077,844 B — `aac5d9d9…` |
| Published v2.9.0 (immutable) | tag → `598edef0`; asset 1,049,018 B — `e7470ff5…` |

This plan adds only documentation; it changes none of the above. The runtime/verifier deltas listed in
§11 are the **expected** counts *after* the future implementation, not changes made by this document.

---

## 1. Why the sequencing changed (roadmap amendment — required record, decision §14)

The C2A implementation attempt established a real dependency:

> **Live `can(...)` mutation enforcement cannot be activated safely while `getCurrentUser() === null` is the
> only reachable application state.** With no reachable principal selector, activating enforcement makes
> *every* mutation deny (fail-closed working as designed) and regresses the existing operator workflow.

The conceptual order `C1 → C2A → C2B → C2C → C3 → D` is amended to:

```
C1 → D1 (Reachable Principal Selection) → C2A → C2B → C2C → C3 → remaining D integration
```

**This is not a weakening of fail-closed behavior — it is the opposite.** We preserve `no currentUser → deny`
and satisfy the missing *runtime prerequisite* (a reachable active principal) before enabling enforcement.
Only the minimal prerequisite is pulled earlier; the full UX-006D Personal Workspace UX is **not**.

**Rejected alternatives (owner ruling):** R-C2-A (`null principal → allow`), R-C2-C (call-site compatibility
shim / legacy bypass), any default/implicit CEO, and any boot-time auto-selection. The invariant
`no currentUser → deny` remains frozen.

---

## 2. Contracts consumed (frozen — NOT redesigned)

UX-006D1 is **UX over the existing identity abstraction**. It calls the already-shipped API and redesigns
nothing:

| Symbol | File | Kind | D1 use |
|---|---|---|---|
| `LocalIdentityProvider.getAvailablePrincipals()` | `js/core/identity.js:98` | local adapter (defensive copies) | enumerate selectable principals |
| `LocalIdentityProvider.selectPrincipal(id)` | `js/core/identity.js:103` | local adapter | set the active principal by id |
| `getCurrentUser()` | `js/core/identity.js:145` | canonical seam | read the active principal (or `null`) |
| `PRINCIPAL_TYPES` | `js/core/identity.js:36` | frozen enum | label mapping only |

The fixture principal set is fixed and defined once (`FIXTURE_PRINCIPALS`, `identity.js:66`):

- `user_ceo_fixture` → `displayName: "Executive (CEO)"`, `principalType: ceo`
- `user_employee_fixture` → `displayName: "Employee (Sample)"`, `principalType: employee`, `employeeId: emp_fixture_self`

**Do NOT redesign** the User contract, the canonical `IdentityProvider` seam, the `LocalIdentityProvider`
principal set, `getCurrentUser()`, or the no-auth trust model. The selector consumes them as-is.

**Contract-boundary note (must be honored):** normal application modules must never depend on the
local-only adapter methods (`getAvailablePrincipals` / `selectPrincipal`) — that is stated as an invariant in
`identity.js:20-23`. The selector is a **development/local identity affordance**, not general application
code, so it is the *one* sanctioned local-adapter consumer. The plan localizes both adapter calls to the
single selector module (§10) and forbids any other module from calling them (verifier guard, §11).

---

## 3. Discovery of the shell surfaces (source-grounded)

The running app has **no top header bar**. The persistent chrome is the **sidebar**, mounted exactly once by
`renderShell()` (`js/ui/shell-render.js:253`) and thereafter only *synced* in place by `syncShellState()`
(`shell-render.js:360`); ordinary navigation replaces only `#main`. The sidebar structure is:

```
.sidebar
  .brand      → mark (TAM OS) + .sub (company name) + collapse button
  nav.nav     → NAV_GROUPS (Dashboard / People / Finance / Analytics / System)
  .sidebar-foot → "TAM OS vX.Y.Z" + tagline + "Data stored privately in your browser."
```

Relevant facts for placement:

- The shell is mounted **once**; `render()` (`shell-render.js:490`) is the compatibility facade every caller
  already uses — it mounts the shell if absent, calls `syncShellState()`, then `renderView()`.
- The sidebar has a **desktop collapsed rail** state and a **mobile off-canvas drawer** (`shell-render.js:408+`).
  Any persistent selector placed in the sidebar must behave in both.
- `Settings` is a per-view page (`renderSettings`, `js/ui/settings-about.js:2`) reached via nav; it is **not**
  persistent chrome, so a selector placed only there would not be reachable while the user is on another view.
- Bootstrap (`js/core/app-bootstrap.js`) does `loadState()` → `applyTheme()` → `installGlobalUIHandlers()` →
  `render()` → `maybeShowFirstRunChoice()`. **No identity call exists in bootstrap and none is added** — there
  is no boot-time principal selection (§5).

---

## 4. Placement decision (the 12 required answers, decision §12)

### 4.1 Where the selector lives

**A single compact control in the persistent sidebar `.brand` block, rendered directly under `.sub`**, as a
new `.identity-selector` region mounted by `renderShell()`. Rationale:

- It is the only surface that is **persistent and reachable from every view** without inventing a new
  landmark, matching the ruling "do not invent a large account menu."
- It rides the existing mount-once / sync-in-place lifecycle, so no new re-render machinery is needed.
- It naturally degrades in the collapsed rail and mobile drawer (§8), because the whole `.brand` block already
  has defined behavior in both.

**Form:** a native `<select class="input">` (labelled "Acting as") with three options — an unselected
placeholder plus one option per available principal — **not** a bespoke dropdown menu. A native select is the
smallest correct affordance, is keyboard/screen-reader native (§7), and matches the existing `.input` select
idiom used throughout Settings.

> Rejected: a full account menu / avatar popover (too large; forbidden by §12). Rejected: Settings-only
> placement (not reachable from other views while `null`, so mutations would silently deny with no visible way
> to fix it).

### 4.2 How it calls LocalIdentityProvider

Two calls, localized to the new selector module only:

- **Populate options:** `LocalIdentityProvider.getAvailablePrincipals()` → map each to
  `<option value="{id}">{principalLabel}</option>`.
- **On change:** `LocalIdentityProvider.selectPrincipal(selectEl.value)`; on the placeholder value, this
  branch is not reached (the placeholder is non-selectable / no-op — see §4.4). Unknown id is already a safe
  no-op miss returning `null` (`identity.js:103-108`), never a CEO fabrication.

No other module may call these two methods (verifier guard, §11).

### 4.3 How app context re-renders after selection

The change handler calls the existing **`render()`** facade after `selectPrincipal(...)`. Because selection
changes what `getCurrentUser()` returns, re-running `render()`:

- re-runs `renderView()` for the current view (so any future scope/authz-aware view re-derives correctly), and
- re-runs `syncShellState()`, which must be minimally extended to **reflect the current principal in the
  selector** (set the `<select>` value + the "Acting as" indicator) so the control stays truthful after any
  navigation (§4.5). This is the *only* addition to `syncShellState()`.

No `State` slice is written; selection lives solely in the provider closure (§6/§4.6). `render()` reads it
live via `getCurrentUser()`.

### 4.4 Null / unselected presentation

Initial state is `currentUser === null` (no auto-selection). The selector shows a **non-value placeholder
option** selected by default: `— Select principal —` (disabled/placeholder), and a small helper line **"No
principal selected — some actions are unavailable."** This:

- makes the fail-closed state visible and self-explanatory rather than looking broken, and
- gives the user the reachable mechanism to leave `null` — satisfying decision §6 ("before a principal is
  selected: identity-sensitive mutations deny; the UI must provide a reachable mechanism to select a
  principal").

The placeholder is never a selectable *principal* — choosing it is not a path back to `null` in D1 (no
"deselect"), because `LocalIdentityProvider` exposes no deselect API and D1 does not add one. `null` exists
only as the initial state. (A future phase may add explicit deselect if needed; out of scope here.)

### 4.5 CEO / Employee labels

Option labels come from the fixture `displayName` values verbatim (no new copy, no schema): **"Executive
(CEO)"** and **"Employee (Sample)"**. The current-principal indicator reads "Acting as: {displayName}". Labels
must **not** imply login/auth/security (§4.9). `principalType` is used only to keep ordering deterministic
(CEO first), never rendered as a security role.

### 4.6 Is selection ephemeral?

**Yes — ephemeral, in-memory, resets on reload.** Selection lives only in the `LocalIdentityProvider` closure
(`selectedId`, `identity.js:81`). D1 adds **no persistence, no storage key, no `State.identity` slice, no
schema change** (`SCHEMA_VERSION` stays 6). Persisting a principal requires a *separate reviewed decision*
(decision §5) and is explicitly out of scope.

### 4.7 Accessibility / keyboard behavior

- Native `<select>` → full keyboard operability and screen-reader semantics for free.
- Associate a visible `<label for>` ("Acting as") with the select; the helper text is linked via
  `aria-describedby`.
- The control participates in the existing sidebar focus order and, in the mobile drawer, in the existing
  **focus trap** (`sidebarFocusables`, `shell-render.js:459`) with **no change** to that logic — a `<select>`
  is already matched by that query.
- No custom key handlers, no new focus management, no ARIA menu pattern (native select needs none).

### 4.8 Mobile / responsive implications

- The selector sits in `.brand`, which is present in both the desktop rail and the mobile off-canvas drawer,
  so it is reachable on mobile via the existing hamburger → drawer flow with no new entry point.
- **Desktop collapsed rail:** when the sidebar is collapsed, brand text is minimized. The selector must hide
  its label/helper in the collapsed rail (CSS, consistent with how `.sub` behaves) and either hide the control
  or show a minimal glyph; expanding the rail (existing hover-expand / toggle) reveals it. Exact CSS treatment
  is a golden-master change (§9) and must be minimal and justified.
- No new breakpoints; reuse the existing `(max-width:768px)` drawer boundary.

### 4.9 No-auth wording

All copy must describe **identity selection**, never authentication/security. Approved wording:

- Label: **"Acting as"**
- Placeholder: **"— Select principal —"**
- Helper (null): **"No principal selected — some actions are unavailable."**
- Optional tooltip: **"Choose which principal the app acts as. This is not a login and provides no security."**

Forbidden wording anywhere in the control: "log in", "sign in", "authenticate", "account", "password",
"session", "secure", "user account". (Mirrors the trust-boundary notes in `identity.js:9-14` and
`workspace.js:17-20`.)

### 4.10 Exact changed files

| File | Change | Kind |
|---|---|---|
| `js/ui/identity-selector.js` **(new)** | The selector: `renderIdentitySelectorHTML()`, `bindIdentitySelector()`, `syncIdentitySelector()`; the only caller of `getAvailablePrincipals` / `selectPrincipal`. | source (new module) |
| `tools/module-order.js` | Register `ui/identity-selector.js` in load order (after `ui/shell-render.js`, which owns the shell it mounts into). | manifest |
| `index.html` | Mirror the manifest: add the `<script src>` tag in the same position. | source |
| `js/ui/shell-render.js` | In `renderShell()`, mount `renderIdentitySelectorHTML()` inside `.brand`; in `bindShell()`, call `bindIdentitySelector()`; in `syncShellState()`, call `syncIdentitySelector()`. ~3 call-sites, no logic redesign. | source |
| `css/…` (golden master) | Minimal `.identity-selector` styling + collapsed-rail treatment. | **CSS golden-master change (justified, §9)** |
| `dist/tam-os-v2.9.0.html` | Regenerated portable build (assemble-only). | generated |
| `tools/verify-identity-selection-runtime.js` **(new)** | Runtime harness for the selector (§11). | tooling |
| `tools/verify-build.js` (or existing verifier wiring) | Register the new harness / decomposition + adapter-isolation guard. | tooling |
| `AI_CONTEXT.md`, `ARCHITECTURE.md`, this roadmap doc, `docs/README.md` index | Reflect the new module, the sequencing amendment, and the load-order entry. | docs |

**Load-order note (MUST, CLAUDE.md §4.2):** the manifest and `index.html` change together in the same commit.

### 4.11 Tests / verifier

See §11. Net: one new runtime harness proving reachable selection + fail-closed null + ephemerality +
adapter-isolation, plus the existing verifier's decomposition/load-order/build-fidelity checks extended to the
new module. Existing identity (33), workspace (31), authz (68) harnesses must remain **unchanged and green**
— D1 touches none of their contracts.

### 4.12 How D1 unblocks C2 without implementing C2

After D1, a CEO principal is **reachable at runtime**:

- Selecting **CEO** → `getCurrentUser()` resolves CEO → `getCurrentWorkspace()` = Executive/ALL_COMPANY →
  existing company mutation workflows are performed by a non-null principal for whom `can(...)` returns `true`.
- Selecting **Employee** → `getCurrentUser()` resolves Employee → Personal/SELF workspace → future C2
  Employee-denial / self-service policies become reachable and testable.

Therefore C2A can later wrap real mutation boundaries in `can(action, resource?)` and the existing operator
(acting as CEO) is **not** regressed, because a reachable principal now exists. **D1 wires no `can(...)` call
itself** — it only makes a principal selectable. C2 enforcement remains HALTED/NOT IMPLEMENTED and resumes
from the then-current `main` **after D1 is merged, verified, and frozen** (decision §11).

---

## 5. Explicit non-goals (decision §7 scope limit — NOT allowed in D1)

- Global Search scope wiring to `getScopedRecords(...)` (remains deferred, decision §10).
- Personal Workspace redesign; broad navigation redesign; Action Center authorization presentation.
- C2 mutation enforcement (`can(...)` at any business boundary); C3 action-availability integration.
- Authentication / login / password / session semantics.
- Persistence / schema changes; any `State.identity` slice; any default or boot-time CEO.
- Any change to the User contract, `IdentityProvider` seam, `LocalIdentityProvider` principal set, or
  `getCurrentUser()`.

---

## 6. Invariants preserved (Definition of Done cross-check, CLAUDE.md §19)

- `no currentUser → deny` frozen; initial `currentUser === null`; no implicit/default/boot CEO.
- `SCHEMA_VERSION` **6**; no storage key added/renamed; no migration; empty-seed unchanged.
- Shared global classic-script scope; no ES modules/bundler/framework; manifest ⇄ `index.html` agree.
- Build remains assemble-only and reproducible; portable build regenerated, not hand-edited.
- CSS treated as golden master; the one CSS change is minimal, justified, and verifier-tracked.
- Both artifacts boot with **zero console errors**; selection survives navigation and resets on reload
  (ephemeral, by design).

---

## 7. Verification plan (expected post-implementation counts — informational)

The new `tools/verify-identity-selection-runtime.js` must assert at least:

1. Initial `getCurrentUser() === null` (no auto-select) with the selector mounted and reachable.
2. Selecting CEO → `getCurrentUser()` is CEO, `getCurrentWorkspace()` is Executive/ALL_COMPANY.
3. Selecting Employee → `getCurrentUser()` is Employee, Personal/SELF workspace resolves (given a bound
   Employee fixture) or fails closed to `null` workspace without leaking ALL_COMPANY.
4. No `State.identity` slice created; `SCHEMA_VERSION` unchanged; no new storage key written.
5. Adapter isolation: no module other than `ui/identity-selector.js` references `getAvailablePrincipals` /
   `selectPrincipal` (static guard over source).
6. No-auth wording guard: the forbidden lexicon (§4.9) does not appear in the selector's rendered strings.

Existing suites must stay green and unchanged: identity **33**, workspace **31**, authz **68**, plus verifier
build-fidelity / decomposition / no-ES-module / empty-seed / version-identity checks over the new module.

---

## 8. Staging (single reviewable increment)

D1 is small enough for one implementation PR after this planning PR is approved:

1. New `ui/identity-selector.js` (headless-ish: pure render + bind + sync; two adapter calls).
2. Manifest + `index.html` load-order entry (together).
3. Three `shell-render.js` call-sites (mount / bind / sync).
4. Minimal CSS golden-master delta.
5. New runtime harness + verifier wiring.
6. Rebuild portable artifact; run full verifier; browser-validate both artifacts (zero console errors);
   confirm reachability in desktop rail, collapsed rail, and mobile drawer.
7. Docs (`AI_CONTEXT.md`, `ARCHITECTURE.md`, this file's status, `docs/README.md`).

---

## 9. Canonical status

**UX-006C2A IMPLEMENTATION DEFERRED — UX-006D1 PRINCIPAL-SELECTION PREREQUISITE IDENTIFIED — FAIL-CLOSED
MODEL PRESERVED.**

Next authorized activity: **owner review of this planning PR.** No C2 work. No D1 implementation until this
plan is approved and a separate implementation assignment is issued.
