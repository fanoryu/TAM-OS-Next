# TAM OS v2.10.0 — Pilot Readiness Checklist

**Purpose:** the gate that must be green before v2.10.0 is handed to pilot operators. Every mechanical
row is re-checkable by running the command shown.

**Status of this record:** completed for the Readiness-3 candidate; §F updated at publication. Evidence
below is from the Readiness-3 branch unless a row says otherwise. This is a **pilot** gate, not a
general-availability gate.

> **Two distinct states — do not conflate them.**
>
> | | State |
> |---|---|
> | **Ready for release** | ✅ **YES** — gates green; v2.10.0 published, marked Latest, asset hash-verified |
> | **Pilot launched** | ❌ **NO** — approved and ready to start; **no launch date set**. It launches only when the artifact is actually handed to the 1–3 named operators |

---

## How to re-run the mechanical gate

```bash
node tools/build-single-file.js && node tools/verify-build.js
```

```bash
for f in tools/verify-*-runtime.js; do node "$f" >/dev/null || echo "FAILED: $f"; done
```

---

## A. Automated verification

| # | Gate | Required | Result |
|---|---|---|---|
| A1 | Full verifier | 0 failures, count ≥ 2439 | **PASS — 2443 checks, 0 failed** |
| A2 | All runtime harnesses | 0 failures, 34 harnesses | **PASS — 2921 checks, 34 harnesses, 0 failed** |
| A3 | Readiness-1 (Employee read scope) | 119 PASS, frozen count must not fall | **PASS — 119** |
| A4 | Readiness-2 (E2E user journeys) | 96 PASS, frozen count must not fall | **PASS — 96** |
| A5 | `ACTIONS` capability count | exactly 20 | **PASS — 20** |
| A6 | `SCHEMA_VERSION` | exactly 6, no migration | **PASS — 6** |
| A7 | `APP_VERSION` | 2.10.0, single source of truth | **PASS — 2.10.0 (`js/core/constants.js`)** |
| A8 | Version/artifact/paperwork consistency | runtime, `<title>`, About, CHANGELOG, RELEASE_NOTES, README, artifact filename all agree | **PASS — guarded by the verifier's release-identity checks** |

## B. Build & artifact

| # | Gate | Required | Result |
|---|---|---|---|
| B1 | Deterministic build | two consecutive builds byte-identical | **PASS** |
| B2 | Committed artifact == fresh build | no diff after rebuild | **PASS — clean tree after rebuild** |
| B3 | Artifact name | `tam-os-v<APP_VERSION>.html`, derived not hardcoded | **PASS — `dist/tam-os-v2.10.0.html`** |
| B4 | Artifact size | recorded | **1,151,267 bytes** |
| B5 | Artifact SHA-256 | recorded | **`60382271a6dcea23431fabb91e0d16abb03196e5cf64c6dc4da1e1af2c7fa704`** |
| B6 | `dist/` holds exactly one artifact | release dist-swap invariant | **PASS — v2.9.0 artifact swapped out; its published Release asset untouched** |
| B7 | Measured in an LF-equivalent checkout | `.gitattributes` `* text=auto eol=lf` | **PASS — `.gitattributes` unmodified** |
| B8 | Artifact honestly described | not claimed as offline/self-contained | **PASS — corrected.** The artifact is a **single-file application package**, not a fully offline one: SheetJS (required for `.xlsx`) and Google Fonts (cosmetic) remain external CDN dependencies |
| B9 | Canonical distribution ruled | decision recorded, not assumed | **PASS — [ADR-0002](../03b-repository-adr/ADR-0002-canonical-distribution-architecture.md) Accepted.** Model A retained for the v2.10.0 pilot on release-risk sequencing (`REQUIRED` single-file dependencies = **0**); Model B approved as the future architecture, deferred to the **Distribution-1** milestone. `CLAUDE.md` unchanged and fully operative for v2.10.0 |

## C. Browser validation

Recorded configuration: **Chromium-based browser pane on Windows 11**, desktop viewport.
Both artifacts exercised: **modular source** (`index.html` over `http://127.0.0.1`) and the
**portable build** (`dist/tam-os-v2.10.0.html` opened via `file://`).

| # | Gate | Source | Portable |
|---|---|---|---|
| C1 | Boots, zero **application** console errors | **PASS** | **PASS** |
| C2 | First boot shows no principal and clear guidance | **PASS** | **PASS** |
| C3 | Principal selection CEO ⇄ Employee, recomputed | **PASS** | **PASS** |
| C4 | Employee sees only own records; CEO sees all; canonical data never narrowed | **PASS** | **PASS** |
| C5 | Employee denied payroll / settings / import / reset | **PASS** | **PASS** |
| C6 | Full navigation visible in both contexts (nothing hidden) | **PASS — 27 items** | **PASS — 27 items** |
| C7 | Real `.xlsx` through the actual file input → parse → preview | **PASS** | **PASS** |
| C8 | Smart Import model built by the production builder | **PASS** | **PASS** |
| C9 | Commit succeeds; pre-import safety backup created | **PASS** | **PASS** |
| C10 | `import.commit` audit written with batch id | **PASS** | **PASS** |
| C11 | Undo removes exactly the batch (planned rows) | **PASS — 2/2/2/2 → 0** | **PASS — 2/2/2/2 → 0** |
| C12 | `import.undo` audit written | **PASS** | **PASS** |
| C13 | Undo preserves executed transactions and their dependencies, and **says so truthfully** | **PASS — see D1** | **PASS** |
| C14 | Backup export produces a real file; `schemaVersion` 6 | **PASS** | **PASS** |
| C15 | Backup re-imported through the real file input; preview validates before restore | **PASS** | **PASS** |
| C16 | Restore recovers the prior state and persists | **PASS** | **PASS** |
| C17 | Wrong Start Fresh confirmation does **not** clear state | **PASS** | **PASS** |
| C18 | Correct Start Fresh clears the expected stores only | **PASS** | **PASS** |
| C19 | Data survives reload | **PASS** | **not reproducible in the `file://` preview pane** (see note) |
| C20 | Principal is not persisted across reload | **PASS** | n/a — see C19 |
| C21 | Disabled controls carry a reason | **PASS (mouse)** | **PASS (mouse)** |
| C22 | Test fixtures cleared afterwards | **PASS** | **PASS** |

> **C19 note.** The `file://` preview pane blocks programmatic `location.reload()`, so the reload leg
> could not be driven there. Storage-level evidence was captured instead (the expected keys were
> cleared / written), and the reload behaviour itself is proven on the modular source, which runs
> identical code. Re-confirm C19 manually on the portable file before handing it to operators.

## D. Correctness findings resolved in this candidate

| # | Finding | Severity | Resolution |
|---|---|---|---|
| D1 | `smartRollbackPreview()` reported the raw *created* counts as the counts that would be *removed*. When an import produced executed transactions (any workbook with a `Realisasi` column), the undo correctly retained the dependent employees/contracts/payroll plans — but the confirmation dialog promised to delete them, and the `import.undo` **audit entry recorded deletions that never happened**. | P2 — misleading operator feedback and an inaccurate audit record. No data loss; the data behaviour was already the safe one. | **Fixed.** Retention is now computed once, from the same predicates the undo applies, and the undo consumes those sets — so what is reported and what is removed cannot drift. The confirmation and the audit entry now state removals and retentions truthfully. Removal behaviour is unchanged. |

## E. Documentation

| # | Gate | Result |
|---|---|---|
| E1 | Release notes for v2.10.0 | **PASS — `RELEASE_NOTES.md`** |
| E2 | Changelog entry with release name | **PASS — `CHANGELOG.md`** |
| E3 | Operator pilot guide | **PASS — [Pilot-Guide-v2.10.0.md](Pilot-Guide-v2.10.0.md)** |
| E4 | Backup cadence documented | **PASS — pilot guide §5** |
| E5 | Rollback plan, verified against code | **PASS — [Rollback-Plan-v2.10.0.md](Rollback-Plan-v2.10.0.md)** |
| E6 | Trust-model caveat stated in operator-facing docs | **PASS — pilot guide §1, release notes, README** |
| E7 | Known limitations stated honestly | **PASS — pilot guide §8** |
| E8 | Candidate is **not** described as published/tagged | **PASS — verifier-guarded** |
| E9 | v2.9.0 preserved as published history | **PASS — verifier-guarded** |
| E10 | Doc indexes and cross-references current | **PASS** |

## F. Release hygiene

| # | Gate | Result |
|---|---|---|
| F1 | GitHub Release published | **PASS — `v2.10.0` published, not draft, not prerelease, marked Latest** (was "none created" while this gate governed the pre-publication candidate) |
| F2 | Tag created, never moved | **PASS — annotated `v2.10.0` created once at the release commit; no existing tag moved or recreated** |
| F3 | v2.9.0 Release and asset untouched | **PASS — v2.9.0 remains published and immutable; superseded as Latest, never rewritten** |
| F7 | Published asset byte-identical to the repository artifact | **PASS — `tam-os-v2.10.0.html`, 1,151,267 B, SHA-256 `60382271…2c7fa704`, independently re-downloaded and hashed** |
| F4 | No secrets or real company data introduced | **PASS — fabricated fixtures only, cleared afterwards** |
| F5 | `.gitattributes` unmodified | **PASS** |
| F6 | No new runtime dependency | **PASS — fixture generator was a throwaway, never committed** |

## G. Blockers

| Class | Status |
|---|---|
| **Pilot blockers** | **None open.** |
| **General-use blockers** | Open — see below. Not required for a controlled pilot, required before general availability. |

**General-use blockers (deliberately out of scope for this pilot):**

1. **Acting-as is not authentication.** No identity verification exists. Acceptable for 1–3 trusted
   operators on controlled devices; not acceptable for general use.
2. **Disabled-reason discoverability is mouse-only.** The `title` tooltip is not reachable by
   keyboard or touch. Acceptable for a desktop-only pilot; needs an accessible presentation
   (adjacent help text or `aria-describedby`) before general use.
3. **`.xlsx` import depends on a CDN-hosted parser.** No offline `.xlsx` path exists.
4. **Single-device, single-profile data with manual backup.** No sync and no automatic backup.
5. **Not multi-user.** Two operators are two independent datasets.

---

## Sign-off

- [x] Mechanical gate green (sections A, B)
- [x] Browser validation complete on both artifacts (section C, with the C19 note)
- [x] No open pilot blockers (section G)
- [x] Operator documentation complete (section E)
- [x] **Maintainer approval for the controlled pilot** — **GRANTED**, recorded in [Controlled-Pilot-Signoff-v2.10.0.md](Controlled-Pilot-Signoff-v2.10.0.md) (merge `df76ec20`). Approval authorises handoff of the frozen artifact; **the pilot has not launched** and no launch date is set.
