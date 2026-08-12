# TAM OS v2.10.0 — Governed Workspace

**Release Name:** Governed Workspace
**Status:** v2.10.0 is **published** and **marked Latest** in the predecessor repository
[`fanoryu/TAM-OS`](https://github.com/fanoryu/TAM-OS), from annotated tag `v2.10.0` there. The published
asset is `tam-os-v2.10.0.html` (1,151,267 bytes, SHA-256
`60382271a6dcea23431fabb91e0d16abb03196e5cf64c6dc4da1e1af2c7fa704`), byte-identical to the repository
artifact `dist/tam-os-v2.10.0.html` tracked here. `SCHEMA_VERSION` **remains 6** — this release carries
**no data migration**, so Complete Backups taken on v2.9.0 restore unchanged.

> **Release lineage.** All tags and Releases up to v2.10.0 belong to the predecessor repository, which is
> retained as a read-only archive. The canonical repository `fanoryu/TAM-OS-Next` currently has **no tags
> and no Releases**, and begins its own lineage at the next separately authorized version. v2.10.0 is not
> re-tagged or re-published here. See [`PROVENANCE.md`](PROVENANCE.md).
**v2.9.0** remains **published** and immutable (asset `tam-os-v2.9.0.html`, 1,049,018 bytes) and is
simply no longer marked Latest; v2.10.0 supersedes it as Latest without moving, replacing, re-labelling
or rewriting it.

**Release identity.** `APP_VERSION` accepts only stable `x.y.z` (plus an optional hotfix letter), and
the portable artifact filename is derived from it. The runtime, the `<title>`, the About page, the
artifact and the tag all say `2.10.0` — one source of truth, no drift.

**What this release is for.** v2.10.0 is the package approved for a **controlled internal pilot** with
1–3 named operators. Publication makes the verified artifact obtainable and checksum-verifiable; it is
**not** a general-availability declaration, and **the pilot has not launched** — see *Known limitations*.

## Summary
A feature/minor release completing the **UX-006** authorization and personal-workspace line and the
**Readiness-1/Readiness-2** programme. Every operational mutation is now authorized through one frozen
capability set, employees read only their own records, and eight end-to-end user journeys are accepted
against the real production code paths. Business calculations are untouched.

## New
- **Complete mutation authorization (UX-006C / C2 / C2C).** Finance, Payroll, Overtime, Contract, HR,
  Import and Data-lifecycle actions all resolve through the same frozen set of **20 actions**. A control
  you may not use is disabled and says why; the action behind it refuses independently, so bypassing the
  control changes nothing.
- **Employee self-only read scope (Readiness-1).** An Employee principal sees their own records and no
  one else's — roster, pickers, worksheets, duplicate review, settings diagnostics and Global Search are
  all scoped at the read boundary, including against direct deep links. Scoping is a **read** concern:
  the stored data is never narrowed, only what a principal is shown.
- **Principal & workspace presentation (UX-006D1 / D2 / D3).** An "Acting as" selector, a collapsed-rail
  identity chip, an explicit workspace label, and first-boot guidance to choose a principal.
- **Integration freeze (UX-006C3).** Availability is an affordance derived per render from the frozen
  `can()` — never cached, never persisted, never applied to navigation.

## Changed
- **First-boot guidance.** With no principal selected the app previously said only that "some actions are
  unavailable", which did not explain why the pages looked empty. It now names the cause and the one
  action that resolves it. The fail-closed behaviour is unchanged — nothing selects, defaults to, or
  remembers a principal, and there is **no automatic CEO**.
- **Release identity.** `APP_VERSION` moves `2.9.0 → 2.10.0`; `APP_RELEASE_NAME` becomes *Governed
  Workspace*.

## Fixed
- **Employee identity disclosure (Readiness-1).** Rosters and employee pickers previously disclosed
  other employees' identities to an Employee principal. Closed at the read boundary.
- **Global Search privacy scoping.** Search results are scoped to the acting principal, so search can no
  longer surface a record the principal may not read.

## Verified
Eight end-to-end journeys accepted (Readiness-2): CEO finance; employee self-service and privacy;
payroll lifecycle; Smart Import with undo; backup/restore/reset; principal switching; settings; and
supplemental payroll — each driven through the real production seams and asserted against the
**persisted** result, not in-memory state.

## Known limitations
- **Acting-as identity is not authentication.** It is a **local, trust-based application context** for a
  single trusted operator. It is **not** a security boundary against anyone with local access to the
  device, the browser profile, or the portable HTML file. Read-scope and authorization are product
  behaviour under that trust model — do not deploy this as an access-control system.
- **Spreadsheet import needs internet access.** `.xlsx` parsing uses a CDN-hosted parser
  (`cdnjs.cloudflare.com`, integrity-pinned). Offline, the rest of the app works and `.csv` import is
  unaffected, but `.xlsx` import will not run. This is a **pilot dependency**.
- **Disabled-control reasons are hover tooltips.** The reason a control is disabled is exposed via the
  native `title` attribute, which is reliable with a mouse but not on touch. The pilot is desktop-only,
  so this is accepted and deferred rather than redesigned.
- **Single-device data.** Data lives in one browser profile on one device. There is **no cloud backup
  and no sync** — the Complete Backup export is the only copy that survives losing the profile. Two
  computers running v2.10.0 hold **two independent datasets**; they do not share data.
- **This is not the shared multi-user system.** v2.10.0 is the **client-side, local** application.
  There is **no backend, no shared database, no server, and no real authentication** in this release.
  The Multi-User-0 architecture decision ([ADR-0003](docs/03b-repository-adr/ADR-0003-shared-multi-user-architecture.md),
  Accepted) defines a **future direction only** — shared persistence, authentication and server-side
  authorization **have not been implemented and have not begun**.
- **The controlled pilot has not launched.** Publication makes the verified artifact obtainable; the
  pilot is **approved and ready to start**, with **no launch date set**. This release is **not** a
  general-availability or production-readiness declaration.

## Data safety
No change to payroll, overtime, contract, finance, execution, approval, posting, import or export
calculations; no schema, storage-key or migration change (`SCHEMA_VERSION` **remains 6**); existing
Complete Backups remain compatible in both directions, which is what makes rollback to v2.9.0 viable.
**Export a Complete Backup before installing this release.**

## How to run it
1. Download **`tam-os-v2.10.0.html`** from this Release's assets.
2. *(Recommended)* Verify the checksum before opening it:
   - PowerShell — `Get-FileHash tam-os-v2.10.0.html -Algorithm SHA256`
   - macOS/Linux — `shasum -a 256 tam-os-v2.10.0.html`

   It must be **1,151,267 bytes** and SHA-256
   `60382271a6dcea23431fabb91e0d16abb03196e5cf64c6dc4da1e1af2c7fa704`.
3. Open the file in a **desktop Chromium browser** (Chrome or Edge). No install, no server, no build step.
4. Keep **internet access** available: `.xlsx` import needs the CDN-hosted parser (`.csv` does not),
   and web fonts are cosmetic.
5. Your data is stored **locally in that browser profile**. It is not uploaded anywhere, and it is not
   shared with any other computer or browser. Use **Settings → Complete Backup** to export it.

## Pilot instructions
See [`docs/06-releases/Pilot-Guide-v2.10.0.md`](docs/06-releases/Pilot-Guide-v2.10.0.md) for the
operator-facing guide (who should use it, what to enter, backup cadence, restore and rollback), and
[`docs/06-releases/Release-Checklist-v2.10.0.md`](docs/06-releases/Release-Checklist-v2.10.0.md) for the
pilot readiness gate.

---

# TAM OS v2.9.0 — Workspace Experience

**Release Name:** Workspace Experience
**Status:** v2.9.0 is **published and marked Latest** — annotated tag `v2.9.0` on commit `598edef0`; asset
`tam-os-v2.9.0.html` (1,049,018 bytes, SHA-256
`e7470ff5261896b8d7d1f8645294d2abd6a72e9820df94b799973627ddcaf3ea`), byte-identical to the repository
artifact. `SCHEMA_VERSION` 6. **v2.8.6** remains published and immutable (asset `tam-os-v2.8.6.html`,
998,413 bytes), and is simply no longer the Latest release.

## Summary
A feature/minor release completing the **UX-005** workspace line and the **MAINT-001** repository/branding
follow-up. It is presentation, navigation, query-state and repository-surface work only — the way TAM OS
looks and is navigated, not how it calculates or stores anything.

## Highlights
- **A clearer Executive workspace** — a consolidated Executive Dashboard with a navigation-only Action
  Center that surfaces what needs attention; the Finance Overview is the operational finance workspace.
- **Scalable Data Grids** — Transactions and Employees run on a shared grid with sorting, pagination
  (20/50/100), debounced search and live result counts; your records are never reordered or mutated.
- **Global Search** — press `Ctrl/Cmd+K` to jump to any employee, contract, payroll record or page.
  Results only navigate; nothing is executed, posted or changed.
- **Responsive & accessibility hardening** — dialogs stay inside the viewport and scroll internally on
  small screens; a Skip to main content link, a proper main landmark, modal keyboard focus containment,
  clearer visible focus, and correct table sort semantics for assistive technology.
- **Refreshed TAM OS branding** — official branding, a browser-tab favicon, README product screenshots,
  and a repository social-preview image.

## Not included (future roadmap)
- **No authentication or role/permission system yet.**
- **No Personal Workspace / employee self-service yet.**
- **No backend migration.** TAM OS is **client-side today** — all data stays in your browser — while the
  architecture remains compatible with a future, separately-approved backend roadmap.

## Data safety
No change to payroll, overtime, contract, finance, execution, approval, posting, import or export
behaviour; no schema, storage-key or migration change (`SCHEMA_VERSION` 6); existing Complete Backups
remain compatible.

---

# TAM OS v2.8.6 — Navigation Experience & TAM OS Rebrand

**Release Name:** Navigation Experience & TAM OS Rebrand
**Status:** **Published** — annotated tag `v2.8.6` on commit `7ac0092d`; asset `tam-os-v2.8.6.html` (998,413 bytes, SHA-256 `8481523c11f78c8959291912551ee3205781daf0ec466ff79cfc59c7c91d3f62`). Superseded as Latest by v2.9.0 once published.

## Product
TAM OS is now the current product identity. The sidebar wordmark, the browser title
(`TAM OS v2.8.6`), the About page and Settings all read **TAM OS**. Historical releases keep their
original **TAM Intelligence OS** name where that was accurate at the time of release.

## Summary
A navigation, presentation and naming release. It packages the complete UX-004 navigation modernization
(**UX-004B–UX-004F**), the sidebar interaction hotfix, and the TAM OS rebrand — all previously completed
and merged to `main`. No business logic changed.

## Navigation
- **Five business domains** — Dashboard, People, Finance, Analytics, System — over a persistent shell
  that mounts once, with canonical navigation ownership, hierarchical active state, and a single
  primary-navigation landmark.
- **Progressive disclosure:** Finance shows four primary items (Overview, Payroll, Transactions,
  Planning); every other Finance destination lives under a **More** control (session-only, and it
  auto-opens when an active destination lives inside it). Labels are simplified and the **Soon**
  placeholder tag is quieter. No route, view, id or destination changed.

## Sidebar
Collapse to an icon rail, session-only **pin** (expanded or collapsed), desktop **hover-expand**, and a
responsive overlay **drawer** on tablet/mobile — hamburger, backdrop, Escape-to-close, focus trap and
focus restoration. All session-only; nothing is persisted.

## Context
- **Breadcrumbs** derive from the canonical navigation architecture (Domain / Item / Context) in their
  own semantic Breadcrumb landmark, with entity-aware terminal labels and no internal-id leaks.
- **Context-aware Quick Actions** are navigation-only deep links, including a Payroll/Overtime →
  Execution Center hand-off.

## Payroll safety
Navigation shortcuts **do not execute, approve, or post anything automatically**. Quick Actions only
change the view and the navigation context; the canonical workflow (Generate → Review → Approve → Post
to Finance → Execution → Completed) is unchanged, and the destination screen remains authoritative.

## Numeric typography
Business-number surfaces use the primary UI font with **tabular numerals** so figures align in columns.
Presentation-only: `fmtIDR`, `toLocaleString`, rounding, currency rules and CSV/Excel/PDF output are
unchanged.

## Sidebar interaction hotfix
Clicking a group header, or the Finance **More** control, while its own section held the active view
previously flipped hidden session state and armed a surprising later collapse/disclosure. Those clicks
are now clean no-ops; the active section still intentionally remains open, and every non-active toggle
works normally.

## Rebrand
- Product identity: **TAM OS**.
- Repository is now: **`fanoryu/TAM-OS`** (renamed by the maintainer; current-state links reconciled).
- Starting with this release the portable artifact uses the TAM OS naming convention
  `dist/tam-os-v2.8.6.html`. The historical `tam-intelligence-os-v2.8.5.html` asset and older filenames
  remain immutable in Git history and their published GitHub Releases.

## Compatibility
- **`SCHEMA_VERSION` remains 6.** No migration required.
- **No storage-key add/remove/rename;** existing persisted data remains compatible.
- **Complete Backup compatibility retained:** a backup exported from v2.8.5 restores into v2.8.6, and a
  restore round-trip does not alter business data beyond the existing provenance/history behavior.
- **Payroll, overtime, contract, execution, posting and finance semantics are unchanged.**

## Known Existing Issues
Carried forward from prior releases and **verified still present**; not introduced by v2.8.6:
- **Compound Payroll posting is non-atomic.** `commitReadyPayroll` writes multiple storage keys
  sequentially; a mid-sequence failure can leave a residual state. Integrity Check detects it for
  review; it is not auto-repaired. Unchanged by v2.8.6.
- **Contract Core editor routing is not migrated.** `ContractCoreAggregate`/`contract.core.update` are
  prepared but have no operational ingress; the editor still writes through `persistContracts()`.
  **OQ-2 and OQ-3 remain OPEN**, so editor routing (ADR-014 step 2) stays blocked. Unchanged by v2.8.6.

## Build
- Portable single-file build: `dist/tam-os-v2.8.6.html`, byte-identical on rebuild.
- CSS golden master unchanged from v2.8.5.

## Release state
v2.8.6 is **published and marked Latest**, from annotated tag `v2.8.6` on commit `7ac0092d`. The published
asset `tam-os-v2.8.6.html` (998,413 bytes, SHA-256
`8481523c11f78c8959291912551ee3205781daf0ec466ff79cfc59c7c91d3f62`) is byte-identical to the repository
artifact. The prior **v2.8.5** tag, GitHub Release, and asset (`tam-intelligence-os-v2.8.5.html`, 965,767
bytes) remain historical and immutable. **UX-005 has not begun.**
