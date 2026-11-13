# TAM OS v3.0.0 — Core SESSION Foundation (release candidate)

**Release Name:** Core SESSION Foundation
**Type:** **MAJOR** release candidate (Owner decision 2026-11-05) — breaking architectural and delivery changes.
`APP_VERSION` is **3.0.0** on main; `SCHEMA_VERSION` **remains 6** (no client data
migration); `ACTIONS` **21** (20 at v2.11.0; BF-4a2 added `account.manage`).

> **Candidate status.** v3.0.0 is a **release candidate**. It becomes a release only through separate Owner
> authorizations: merge of this preparation, then the annotated tag and the GitHub Release (`docs/RELEASE-PROCESS.md`
> §7 and §11). Until then **v2.11.0 — Identity Refresh remains the latest published release** (recorded below). Nothing
> here approves a deployment: Gate D and Gate R stay on **HOLD**.

> **Status update (2026-11-13; this candidate record is kept as written).** The figures in this section describe the
> candidate as prepared on `main` @ `8ef3d6be` (102 package files, migrations 0001–0035, package digest `819f74ac…`).
> Finance Phase 1 has since merged into the v3.0.0 candidate on `main` as source (PR #85; see
> [`CHANGELOG.md`](CHANGELOG.md), *Unreleased*): 105 package files, migrations 0001–0038, package digest `b865f6f2…`.
> UI-INT-1, the v2.11.0-style SESSION shell, has since merged into the same candidate as source (PR #88, `ec3cf40`;
> frontend only): 105 package files, package digest `97658f5a…`. Neither is
> released or deployed. The artifacts below predate Phase 1 and UI-INT-1, so a release needs a fresh candidate build
> record and separate Owner authorization; every HOLD and NO-GO gate is unchanged.

**Why this is a major version.** Since v2.11.0 the product changed how it is delivered, what it needs to run and what
it offers. A v2.11.0 user cannot simply replace the file:

| | v2.11.0 (published) | v3.0.0 (candidate) |
|---|---|---|
| Delivery | one self-contained HTML file, opens offline from disk | a deployment package (`tam-os-v3.0.0-package.zip`, 102 files) served over **HTTPS** under a strict Content-Security-Policy |
| Runs against | nothing — browser-only (LOCAL) | the same-origin **PHP 8.3 + MariaDB** backend (`server/`, migrations 0001–0035) |
| Identity | "Acting as" selector, no sign-in | **signed-in accounts** (CEO, Employee); "Acting as" removed |
| Data | this browser's local storage | the server database; **data stored in the browser by v2.x is not read and not migrated** |
| Scope | every LOCAL area | the **Core SESSION** areas below only |

**Core SESSION scope (what v3.0.0 contains).**

- **CEO:** Employees (create, edit, archive, exact salary strings), employee logins (provision, reissue, disable,
  enable); Overtime (record, submit, review, approve with the TAM-OT-1 valuation, reject, delete); Payroll (prepare,
  review, approve, commit with salary-drift protection, return and regenerate); Supplemental payroll; Post to Finance;
  Record payment (paid outside TAM OS); Audit history by Asia/Jakarta month with record history.
- **Employee:** My profile, My overtime (own Drafts), My payroll.
- **Everyone signed in:** Account security — **Change password** (the other sessions end, this device stays signed in;
  an unconfirmed change is reported and never resent) and **Sign out all devices**.
- Every write is authorized by the server; money is exact decimal strings; payroll, posting and payment writes are
  idempotent, and an unknown network outcome is never resent automatically.

**Not included — LOCAL areas not yet migrated.** Executive Dashboard, Executive Insights, Contracts, Finance Overview, Transactions, Import, Recurring, Cash Flow, Budget Center, Execution, Bank Accounts, Projects, Vendors, Financial Calendar, Reports, Activity Log, Global Search and Settings with Data Portability (Complete Backup and restore) are **not part of the v3.0.0 application**. They migrate
domain by domain in later releases (Phased Full Parity, `docs/01-roadmap/Milestone_Roadmap.md`); **v3.0.0 does not
claim Full Parity**. For them, the published v2.11.0 single file remains available and unchanged.

**Accounts.** The first CEO exists only through the operator command `php bin/account.php create-ceo` on the host,
which prints a one-time 72-hour activation link to hand over out of band; there is no sign-up and no HTTP bootstrap.
The CEO then provisions Employee logins. Employee activation and password recovery send mail, which needs the governed
mail transport (SDR-0003 §7); until it is configured, a deployment is **CEO-only**. One company per deployment.

**Requirements to run.** HTTPS on a dedicated hostname whose document-root parent is not web-served; PHP 8.3 with
`pdo_mysql`, `openssl`, `mbstring`, `sodium`, `zlib`; MariaDB/MySQL with InnoDB; the configuration, logs and
encrypted backups outside the document root; cron for the nightly backup. The procedure — placement, configuration and
secrets, migrations, first CEO, header probe, rollback — is
[`docs/BACKEND-DEPLOYMENT-RUNBOOK.md`](docs/BACKEND-DEPLOYMENT-RUNBOOK.md).

**Deployment constraints.** v3.0.0 is not deployed anywhere. The first deployment is **staging only, with fabricated
data**, after a staging-specific Gate D ruling and the SDR-0006 X1–X8 (and SDR-0007 M1–M3) evidence, with Owner
decisions OD-W2-1…3. Production is separately gated (E7 restore rehearsal, E8 data residency, E10 Hostinger two-factor,
E12 external security review, governed mail, Gate R / SDR-0002 §22). v3.0.0 is **not** production-ready by itself.

**Rollback and recovery.** Before any deployment, users stay on v2.11.0. For a deployed v3.0.0, rollback and recovery
follow the runbook §8 (close the API, re-upload the previous verified package and backend, staging database recreate,
off-host restore of an encrypted backup with the §7.1 safeguards) — not the v2.x Complete Backup.

**Known limitations.**

- Browser evidence is **Chrome only** (RR-3: Firefox and Safari untested).
- F-2: that Hostinger's LiteSpeed applies the document-root `/api/*` header exclusion is proven only by the host probe
  HP-3.
- SDR-0002 §22 items 1 and 8 (authenticated end-to-end on the production host) are not satisfied.
- No import of v2.x data; the LOCAL areas listed above are absent.

**Verified (local engineering evidence).** `tools/verify-build.js` and all 44 runtime harnesses pass on this candidate;
the backend suite passed 901/0 with the database suite (431) and the real-backend regression WP-E2E-2 passed 282/282 on
`main` @ `8ef3d6be` (disposable loopback PHP 8.3.36 + MariaDB 10.11.19, fabricated data). Local evidence is not host
evidence.

**Artifacts (candidate build).** `tam-os-v3.0.0-package.zip` (3,124,997 bytes, SHA-256 `3b6dcecb796fa74f88aca9b509f70b0a91ae74b8daf7cf6d24093afe00247d58`) and
`dist/package-manifest.json` (SHA-256 `1451ab44997828b39758ad4b0c780566497c9ca40ed8144e2c32287649a7ab27`); package digest `819f74acb9c22f0a3a88ece162fa60612f23f3ecf409932aa6561e728884b2c5`. The backend is deployed from the
same commit by `git archive` (runbook §2.1); it is not a release asset.

---

# TAM OS v2.11.0 — Identity Refresh

**Release Name:** Identity Refresh
**Type:** Presentation / product-identity release carrying the merged **BRAND-1** identity modernization.
`APP_VERSION` is **2.11.0**; `SCHEMA_VERSION` **remains 6** (no data migration); `ACTIONS` remains **20**.
The portable artifact is `dist/tam-os-v2.11.0.html`.

**What changed (identity & typography only):**

- **Refreshed TAM OS product lockup** — the persistent sidebar chrome pairs the existing TAM monogram with
  a live "TAM OS" wordmark. Expanded: `[monogram] TAM OS`; collapsed: monogram only.
- **Sora SemiBold 600** wordmark typography (`--display`), scoped to the wordmark; **Inter** remains the UI
  face. The `OS` carries the **TAM Teal** identity accent (`#08B9B0` dark; `#0A857E` on light backgrounds).
- **Persistent company subtitle removed** — `PT Total Asset Manajemen` no longer appears in the application
  brand block; company identity is retained in About, Settings, reports and positioning copy.
- **Identity palette tokens (P1)** — Navy/Blue/Teal for the product identity, kept separate from the
  existing **semantic gold** UI accent, which is preserved unchanged.
- **Self-contained offline typography** — Sora, Inter, Source Serif 4 and JetBrains Mono are embedded as
  base64 WOFF2 in `css/fonts.css` (SIL OFL 1.1 sources under `assets/fonts/`); the portable artifact
  renders its intended type under `file://` with **no Google Fonts network dependency**.

**No change** to authorization, Acting-as semantics, read-scope, persistence, schema, or any
financial/payroll calculation. **PILOT-1 remains ON HOLD PENDING VPS**; backend remains **NOT STARTED**.

> **Publication status.** v2.11.0 is **published** and **marked Latest** in `fanoryu/TAM-OS-Next`, from
> annotated tag `v2.11.0` peeling to commit `04c1503d`. The published asset `tam-os-v2.11.0.html`
> (**1,676,709 bytes**, SHA-256 `57d8b0c23c83509a70a766d903e2ee19aa57e5bcfc70950652d930e8f2358557`) is
> byte-identical to `dist/tam-os-v2.11.0.html` tracked here. v2.10.0 remains published and intact as the
> **prior release** (no longer Latest), recorded below.

---

## Previous published release — v2.10.0 — Governed Workspace

**Release Name:** Governed Workspace
**Status:** v2.10.0 is **published** and intact — now the **prior release** (no longer Latest; superseded
by v2.11.0). It was **originally published on
2026-08-11** from the predecessor repository `fanoryu/TAM-OS` (private predecessor repository retained
for historical provenance; not resolvable by public visitors),
from annotated tag `v2.10.0` there (tag object `26c74071`, commit `335d53ed`), where it remains
published, marked Latest and immutable. The same frozen artifact is now **canonically re-published,
unchanged**, from [`fanoryu/TAM-OS-Next`](https://github.com/fanoryu/TAM-OS-Next). The asset is
`tam-os-v2.10.0.html` (**1,151,267 bytes**, SHA-256
`60382271a6dcea23431fabb91e0d16abb03196e5cf64c6dc4da1e1af2c7fa704`), verified **byte-identical** to the
repository artifact `dist/tam-os-v2.10.0.html` tracked here. `SCHEMA_VERSION` **remains 6** — this
release carries **no data migration**, so Complete Backups taken on v2.9.0 restore unchanged.

> **This is not a new product version.** Not v2.10.1, not a new runtime build,
> not a schema change, not a feature release.
> `APP_VERSION` remains **2.10.0** and `SCHEMA_VERSION` remains **6**. Canonical
> re-publication moves *where the verified artifact can be downloaded* — it changes nothing about what
> the artifact is.

> **Release lineage.** Every release up to and including the original v2.10.0 belongs to the predecessor
> repository `fanoryu/TAM-OS`, which is retained as a read-only archive; its tags, Releases and assets
> are unchanged and remain the authoritative record of those publications. `fanoryu/TAM-OS-Next` is the
> canonical repository from this point forward, and v2.10.0 is its first Release — the same artifact,
> re-published rather than rebuilt. Ongoing development continues in `fanoryu/TAM-OS-Next`. See
> [`PROVENANCE.md`](PROVENANCE.md).

> **Artifact identity, not tree identity.** The canonical `v2.10.0` tag marks the re-publication
> checkpoint in `fanoryu/TAM-OS-Next`. Its **source and documentation are newer** than the predecessor's
> v2.10.0 source snapshot — they additionally carry the PILOT-0 controlled-pilot readiness record, the
> SECURITY-1 policy reconciliation and this canonical re-publication reconciliation. The **portable
> artifact is unchanged and byte-identical**. What v2.10.0 denotes is the identity of the shipped
> artifact, not the identity of the source tree that accompanies it.

> **Scope.** This publication exists for download convenience, frozen-baseline distribution and
> canonical archival availability. It does **not** launch the pilot — **PILOT-1 remains ON HOLD PENDING
> VPS**. Backend work remains **NOT STARTED**. Nothing here authorizes use with real company data.

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
