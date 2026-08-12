# MAINT-001 — Repository Maintenance & Branding Refresh (Planned)

**Status:** Planned backlog item — **not started**. This document is forward-looking
planning; it authorizes no implementation. Work is authorized only by a subsequent
Sprint Assignment per [`docs/01-roadmap/README.md`](README.md).

**Predecessor:** UX-005B (Data Grid Foundation), merged. **This item does not depend on
any later UX-005 phase** and may be scheduled independently. It is the recommended
**next work item** after UX-005B.

**Guiding constraints (inherited):** no business-logic or calculation changes; no
`SCHEMA_VERSION`, storage-key, or migration change; no backend work; the published
`v2.8.6` tag/Release/asset remain immutable. Anything touching the CSS golden master
follows the intentional pin-revision process.

---

## 1. Repository — legacy migration scripts

Evaluate removal of the one-time source-decomposition tooling, now that the modular
`js/` tree is the source of truth:

- `tools/decompose.js`
- `tools/extract-source.ps1`

**Before removal (MUST):** prove nothing references them — grep the repo (docs, CI
workflows under `.github/`, `tools/`, `package`-style scripts, READMEs) for
`decompose` / `extract-source`. Removing tracked files is approval-gated
(`CLAUDE.md` §20); the removal Sprint must list them explicitly and confirm the build
(`build-single-file.js`) and verifier (`verify-build.js`) do not invoke them.

## 2. Documentation — synchronization & cleanup

- Resolve README inconsistencies (see §4 below) and reconcile the root `README.md`
  documentation table, `docs/README.md`, and `SECURITY.md` SDR list.
- Documentation synchronization pass: verify version references, counts, and
  cross-links are current after UX-005A/UX-005B (verifier 1931, runtime 1526 / 17
  harnesses on the current line).
- General documentation cleanup; remove stale pointers; keep one responsibility per
  document (`CLAUDE.md` §16, §18).

## 3. Branding — refresh (PREPARE ONLY)

Prepare (do **not** create or modify any binary asset in this planning item) an
`assets/branding/` structure. Do **not** redesign the logo.

```
assets/
  branding/
    logo-full-color.png     # PRIMARY — blue + cyan
    logo-flat-blue.png      # secondary
    logo-white.png          # secondary (dark backgrounds)
    logo-black.png          # secondary (light backgrounds)
    icon.png                # app/mark icon
    favicon.png             # browser favicon
    BRAND_GUIDELINES.md     # usage, spacing, color values, do/don't
```

- **Primary:** Full Color (blue + cyan).
- **Secondary:** Flat Blue · White · Black · Icon · Favicon.

The branding Sprint will add the actual assets and `BRAND_GUIDELINES.md`; this item
only reserves the structure and intent. (No placeholder binaries are committed here —
creating empty/placeholder image files would be modifying branding assets, which this
planning item explicitly excludes.)

## 4. README refresh (PLAN ONLY)

Plan a README refresh to land in a later Sprint:

- Add the new logo (from §3).
- Add high-quality screenshots at **1920×1080**, using **consistent fabricated demo
  data**, **dark theme**, **sidebar expanded**. Never use real company data
  (`CLAUDE.md` §12, §17).
- **Remove the "Zero Backend" positioning** and **update product positioning** to
  accommodate a future backend architecture. Note: this is a documentation/positioning
  change only — it authorizes **no** backend implementation, and the app remains
  client-only until a separate, explicitly approved architecture decision (ADR) says
  otherwise. The current-state architecture docs must not be edited to imply a backend
  exists.

---

## 5. Suggested MAINT-001 sequence (when authorized)

1. Reference-check + remove the two legacy migration scripts (approval-gated).
2. Documentation synchronization + cleanup; reconcile the three navigation hubs.
3. Reserve `assets/branding/` structure + author `BRAND_GUIDELINES.md`.
4. Add branding assets (separate, once assets exist).
5. README refresh (logo + 1920×1080 dark-theme screenshots + positioning update).
6. Verify (build + verifier + harnesses green), deterministic rebuild, PR, controlled
   merge.

## 6. Out of scope for MAINT-001

UX-005C/D/E/F, UX-006, Data Grid redesign, business-logic/calculation changes,
`SCHEMA_VERSION`/storage/migration changes, and any actual backend implementation.

---

## 7. Post-MAINT-001 follow-up backlog (recorded, not started)

The MAINT-001 core (legacy-script removal, documentation sync, official branding adoption,
README refresh) is **merged and complete**. During that work three follow-up items were
approved and are recorded here so the decisions are durable in the roadmap rather than only
in a report. Each is **documentation/branding planning only** — none authorizes runtime,
schema, storage, or backend work.

### Follow-up 1 — Branding asset organization
Reorganize `assets/branding/` into a scalable structure once the asset set grows:

```text
assets/
└── branding/
    ├── logos/
    ├── favicon/
    ├── screenshots/
    ├── social/
    ├── BRAND_GUIDELINES.pdf
    └── BRAND_GUIDELINES.md
```

Future housekeeping only. **Do not move or rename** the current branding assets until this
task is authorized (renames would break the README/BRAND_GUIDELINES references).

### Follow-up 2 — README screenshot refresh
Documentation-only task to capture and commit official product screenshots. **Frozen
screenshot standard:** 1920×1080 · dark theme · sidebar expanded · official TAM OS
branding · consistent fabricated demo dataset · high-resolution PNG · no modal/dialog · no
sensitive data · no placeholder images. **Recommended set:** Executive Dashboard, Finance
Overview, Transactions, Employees, Payroll Workspace, Overtime, Reports, Settings. Captures
land under `docs/screenshots/` (or `assets/branding/screenshots/` per Follow-up 1).

### Follow-up 3 — Brand integration
Branding-integration task for: favicon, browser-tab icon, Open Graph image, and social
preview image. A future app/PWA icon may reference the official TAM OS **monogram**. This
work must use the **already-approved official assets** — do not redesign, recolor, recreate,
or substitute the logo — and introduces **no backend work**. Any runtime wiring (e.g. a
favicon `<link>`) is deferred to its own authorized task, with the portable single-file
build's standalone behaviour considered at that time.

### Follow-up status (merged and complete)
The three follow-ups above are **merged to `main`** (branch `chore/maint-001-branding-integration`, after
the UX-005 Platform Freeze). The one remaining action is external: the GitHub repository **Social Preview**
Settings upload of `assets/social/tam-os-social.png` (not expressible in repository code). What shipped:
- **Favicon** — derived by resize only from the official `assets/branding/tam-os-logo-secondary.png`
  (64×64), embedded in `index.html` as an inline PNG `data:` URI so the portable artifact stays
  self-contained (no external request); a provenance copy is `assets/branding/tam-os-favicon-64.png`.
- **Screenshots** — four true 1920×1080 dark-theme captures of the frozen UI (Executive Dashboard,
  Transactions Data Grid, Global Search, Payroll Workspace) under `assets/screenshots/`, using a
  clearly-fabricated demo dataset; added to a README **Product Preview** section.
- **Social preview** — `assets/social/tam-os-social.png` (1280×640), composed from the official
  on-navy wordmark; the GitHub repository Social-Preview **Settings** upload is a separate manual step
  after merge (committing the file does not configure it).

The branding follow-up added no `APP_VERSION` bump, no `SCHEMA_VERSION`/storage change, and no application
CSS/JS change (favicon is an `index.html` `<link>` only); `css/*` golden master and `tokens.css` stayed
byte-identical. **Status: merged and complete** — the subsequent v2.9.0 Release Preparation carries the
version identity forward and folds these assets into the v2.9.0 release.

### Branding principle (persisted)
The approved **TAM OS Brand Guidelines** and the supplied official assets are the canonical
visual identity. **Primary:** Full-Color logo. **Secondary / variants:** Flat Blue, White,
Black, Monogram/Icon, Favicon. Historical release branding (in `CHANGELOG.md`,
`RELEASE_NOTES.md`, and past release notes) must remain historically accurate and is never
retroactively rebranded.

---

*Forward-looking planning only. Implementation of any part is authorized solely by a
subsequent Sprint Assignment.*
