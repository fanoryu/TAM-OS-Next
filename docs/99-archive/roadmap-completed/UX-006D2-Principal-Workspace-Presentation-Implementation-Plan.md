# UX-006D2 — Principal & Workspace Presentation Polish (Implementation Plan)

**Status:** implemented, merged & frozen — merge `5163cfc4`
**Baseline:** `de272283` (main after the PR #128 documentation merge)
**Phase before:** UX-006D1 (merged & frozen, `4a53a35`) · **Phase after:** UX-006D3 (not started)
**Governing supersession:** [UX-006 architecture §20A](UX-006-Identity-Personal-Workspace-Architecture.md)

---

## 1. What this phase is

UX-006D2 is **presentation only**. It changes how the active principal, the active workspace context and
unavailable controls *look and read*. It changes nothing about what any principal is *allowed to do*.

The single test applied to every change in this phase:

> Does this change what the principal is authorized to do?

If yes, it is out of scope. Every change below answers **no**, and the verifier plus the D2 harness assert
that mechanically rather than by claim.

## 2. Why it was needed (defects found in the reviewed baseline)

| # | Defect observed in the running app | Consequence |
|---|---|---|
| D2-a | The collapsed sidebar rail hid the whole "Acting as" block (`.sidebar.collapsed .identity-selector{display:none}`) | With the sidebar collapsed there was **no indication whatsoever** of which principal was acting |
| D2-b | The active **workspace** context was never rendered anywhere | `getCurrentWorkspace()` has existed since UX-006B but was headless; an operator could not tell whether they were in the Executive or Personal context |
| D2-c | A denied control rendered as `.btn:disabled{opacity:.4}` — the same treatment as an ordinarily inert control | "You may not do this" was **visually identical** to "not right now". `#genPay` is disabled both by a locked payroll period *and* by denial, and the two were indistinguishable. `.4` opacity also pushes the label below a comfortable contrast ratio |
| D2-d | Quick Actions rendered as plain `.btn` in `.head-controls`, beside operational buttons | **Navigation** and **mutation** looked like the same act |
| D2-e | Action Center rows: a navigable `<button data-ac-nav>` and a non-navigable `<div role="note">` differed only on `:hover` | On touch there was no way to tell which rows go somewhere |

## 3. Changes

### 3.1 `js/ui/identity-selector.js` (presentation)
- Renders a **workspace context block** (`#identityPrincipalContext`) labelling the active context:
  *Executive workspace / Company-wide records*, *Personal workspace / Your own records*, or *No workspace*.
- Renders a **collapsed-rail chip** (`#identityPrincipalRail`) carrying the acting principal's initials plus the
  full acting-as text as its `title`.
- Both carry `data-principal-state="active|none"` so the state is deterministically assertable.
- `syncIdentitySelector()` refreshes both on the **existing write-on-change discipline**, so a principal switch
  re-derives them with no stale provenance.

**The two causes of a null workspace are presented distinctly.** A null workspace means either *nobody is
acting yet* or *an employee principal has no linked Employee record* (the frozen UX-006B fail-closed path).
Telling an active principal to "select a principal" would be false, so the second case reads
**"No linked employee record"**. This was caught during browser validation of this phase.

**Unchanged:** `selectPrincipal()` semantics, the render/recompute contract, the "Acting as" label, CEO-first
enumeration, the placeholder option, ephemerality (no persistence, no `State.identity`, `SCHEMA_VERSION` 6).

### 3.2 `js/core/stabilization.js` — `authzDisabled(action, resource)`
The denied branch gains a `data-authz-denied="1"` marker. **The condition is untouched**:

```js
return can(action, resource) ? '' : ' disabled data-authz-denied="1" title="…"';
```

The allowed branch is still the empty string, so the marker rides the denied branch only and mirrors a decision
it does not make. No policy copy, no `State`, no caching.

### 3.3 CSS (additive; authorized golden-master revision)
`css/shell.css` and `css/components.css` only — `css/tokens.css` is **byte-unchanged** and every value resolves
from an existing token. New pin recorded and documented in `tools/verify-build.js`.

- `.identity-context*` / `.identity-rail` and the collapsed / hover-peek / drawer reveal rules, mirroring the
  existing `.identity-selector` pattern so the chip and the full selector are **never shown at once**.
- `.btn:disabled[data-authz-denied]` — raises opacity `.4 → .65` and adds a dashed edge.
- `.action-item::after` — a persistent chevron on navigable Action Center rows (decorative, `::after`, so the
  generated markup, destinations and accessible names are untouched).
- `.btn.quick-action` — a quieter surface plus a trailing arrow, separating navigation from action.

Nothing is hidden, disabled or re-decided by any rule.

## 4. Acceptance criteria

| # | Criterion | Proven by |
|---|---|---|
| A1 | The "Acting as" selector still renders, enumerates CEO-first, and starts unselected | D2 harness §1 |
| A2 | Principal & workspace context is visible and truthful for CEO / Employee / null | D2 harness §2 |
| A3 | The two causes of a null workspace read differently | D2 harness §2a |
| A4 | Context re-derives on every principal switch; zero storage writes | D2 harness §2b |
| A5 | The collapsed rail shows which principal is active; chip and selector never co-render | D2 harness §3 |
| A6 | All **43** frozen C3 entries present; Quick Action visibility identical across principals | D2 harness §4 |
| A7 | The seven controls stay VISIBLE + DISABLED when denied, enabled when allowed, never hidden | D2 harness §5 |
| A8 | `ACTIONS` 20, `SCHEMA_VERSION` 6, `APP_VERSION` 2.9.0; the `can()` delegation is byte-identical | D2 harness §6 + verifier |
| A9 | No navigation surface is hidden or styled by an authorization attribute | D2 harness §7 + verifier |
| A10 | No horizontal overflow, clipping or inaccessible control at desktop / tablet / mobile | browser validation |

## 5. Frozen invariants preserved

`ACTIONS` **20** · `ACTION_SET` 20 · `POLICY` 20 · `ACTION_RESOURCE_ENTITY` 20 · `APP_VERSION` **2.9.0** ·
`SCHEMA_VERSION` **6** · no migration · no storage-format change · no new action · no route guard ·
C3 manifest closure green in both directions · `js/core/authz.js` **untouched**.

## 6. Out of scope (stop conditions — none triggered)

Global Search principal-aware scope wiring (outside UX-006D entirely), any authorization semantic change, any
new action, route guards, principal data-model changes, schema/storage migration, and any change to C3 manifest
semantics. The UX-006D1 prose-sensitive verifier guard was **not** modified.

## 7. Verification

- Verifier **2371 PASS / 0 FAIL** (was 2346; +25 D2 structural checks)
- Runtime **2614 PASS / 31 harnesses / 0 FAIL** (was 2494 / 30; +120 from the new D2 harness)
- No existing count fell: C3 91 · C2C-4 164 · C2C-3 129 · C2C-2 118 · C2C-1 60 · authz 104 · outcome 53 · D1 29
- Modular source **and** portable build both boot with **zero console errors**; principal switching, denied-control
  presentation and navigation visibility verified identically in both
