# Deployment & the Source-Core / Private-Company-Layer Split

This document explains how TAM Intelligence OS is structured for a **source core** with a
**separate private company layer**, and how PT Total Asset Manajemen keeps production data and
configuration outside this repository. It describes only what actually exists in the repo; for the
module map see [`ARCHITECTURE.md`](../ARCHITECTURE.md), for data rules see
[`DATA-SAFETY.md`](DATA-SAFETY.md), and for the release procedure see
[`RELEASE-PROCESS.md`](RELEASE-PROCESS.md).

## 1. Two layers

**Source core (this repository)** — application source (`index.html`, `css/`, `js/`, vendored
`vendor/`), the build/verify tooling (`tools/`), the committed package manifest
(`dist/package-manifest.json`) and frozen single-file releases (`dist/*.html`), the golden-master
reference HTML, documentation, CI/release workflows, and issue/PR templates. It contains **no company
data** and ships an **empty data seed** (a fresh install starts with zero records; the verifier
asserts the embedded `seed-data` JSON is `[]`).

**Private company layer (maintained separately, never in this repo)** — the real fund-usage / payroll
planning workbook, employee/payroll/finance records, Complete Backup exports, company branding, and any
deployment-specific configuration or secrets. A ready-to-use template for this layer
(`tam-company-private-template/`) is kept **outside** this repository with folders for
`company-config/`, `production-data/`, `workbooks/`, `exports/`, `backups/`, `branding/`, and
`deployment/`.

> **Rule:** No production or company-identifying data belongs in this repository — not in the working
> tree, not in Git history, not in issues or PRs, not in screenshots. Only clearly-fabricated sample
> values may ever appear, and the application does not require any seeded data to run.

## 2. Running the app

The app is a single-page, client-only application with **no backend, database or API**; its only
runtime dependency is the vendored, pinned SheetJS parser. It is distributed as the **deployment
package** (Distribution-1, [ADR-0002](03b-repository-adr/ADR-0002-canonical-distribution-architecture.md)
Model B) and runs **over HTTP**:

```bash
node tools/build-package.js     # dist/package/ + ZIP + dist/package-manifest.json
node tools/serve-package.js     # http://127.0.0.1:8765/ under the production header contract
```

`file://` is not a supported way to run TAM OS. Earlier single-file releases (`dist/*.html`) are
frozen history, kept byte-identical and never rebuilt.

All data is stored **locally** in the browser's `localStorage` (or the Claude Artifact storage
environment). Nothing is transmitted to a server. The page makes **no third-party network request**:
typography is embedded and the spreadsheet parser is served from the package itself. Two browsers —
including two visitors to the same hosted copy — hold two independent datasets.

## 3. Local / offline data handling

- Data is persisted under a fixed set of stable storage keys and a schema version; a fresh install is
  empty. See [`DATA-SAFETY.md`](DATA-SAFETY.md) for the enumerated keys and migration rules.
- **Recovery contract:** the Complete Backup JSON export/import is the supported recovery path;
  destructive actions snapshot data first and require typed confirmation. Complete Backups are company
  data — store them in the private layer (`backups/`), never in this repo.

## 4. Import / export boundaries

- **Import (in):** Smart Import reads spreadsheets locally in the browser to extract
  employees/contracts/transactions, with column mapping and duplicate prevention. Source spreadsheets
  are private data — keep them in the private layer's `workbooks/`.
- **Export (out):** CSV exports and Complete Backup JSON are generated locally and downloaded by the
  user. Employee bank-account numbers are masked in the general CSV export. Treat every export as
  confidential and keep it in the private layer.

## 5. Reporting read models (read-only)

Historical reporting is derived, never mutated:

- `payrollHistoricalSnapshot(pp)` is the immutable source of truth for a committed payroll row
  (Posted/Executed values come from committed evidence, never reconstructed from current master data).
- `payrollTotalCompensation(pp)` is a **read-only** aggregate over that snapshot plus committed
  (Posted/Executed) supplementals; it never mutates data and never redefines the base payroll total.

These read models are pure display logic; they do not change persistence, finance, or payroll state.

## 6. Release & verification

Releases are tag-driven and guarded; the tag must equal the source `APP_VERSION` or the workflow
publishes nothing. Every change is verified (`node tools/verify-build.js`) and built
(`node tools/build-package.js`) — the verifier enforces package determinism and fidelity, the frozen
historical releases, the strict-CSP shape, version identity, the schema version, the storage-key set,
the empty seed, and the reporting invariants. The release assets are the package ZIP and its
manifest. Full steps:
[`RELEASE-PROCESS.md`](RELEASE-PROCESS.md); QA gate: [`QA-CHECKLIST.md`](QA-CHECKLIST.md).

## 7. Maintaining the private layer (PT Total Asset Manajemen)

1. Keep the source core (this repo) and the private layer in **separate locations**. If the private
   layer becomes a Git repository, keep it **private** and never add this repository's remote to it.
2. Put the real workbook, exports, backups, branding, and deployment config in the private layer only.
3. To run against real data: open the app locally and load a Complete Backup, or import the private
   workbook — all locally, on a company-controlled device.
4. If any confidential file is ever committed to the source core by mistake, treat it as disclosed:
   purge it from history, rotate anything sensitive, and follow [`SECURITY.md`](../SECURITY.md).

## 8. Production hosting — target (not yet cut over)

**Target:** `https://finance.reliabilityindonesia.com`, on the company's existing **Hostinger Premium
Web Hosting** (hPanel), which it shares with the `reliabilityindonesia.com` web presence. It is **not**
a VPS. HOSTING-0 (2026-09-29) observed that the hostname already resolves to Hostinger with valid HTTPS
behind Hostinger's CDN, and that it serves the Hostinger default page — **TAM OS is not deployed
there.** A separately hosted TAM OS copy exists but is **pre-operational**: no real company data has
been entered, and none may be until the cutover gate below is met.

**Role — same origin, per [ADR-0004](03b-repository-adr/ADR-0004-hostinger-same-origin-backend.md).**
The same host will serve both halves of TAM OS from one origin:

- `/` — the static TAM OS frontend;
- `/api/*` — a PHP 8.3 backend over MariaDB/MySQL (InnoDB).

The browser never reaches the database. **No separate managed backend service and no VPS are
required.** The backend is **not deployed** and only its foundation (HTTP, data layer, migration
machinery, the BF-3A authentication schema and session endpoints, and the BF-3B account lifecycle and
operator CLI — no authorization policy or business schema) exists in source; it is **not
production-ready**. See [`Milestones.md`](05-milestones/Milestones.md)
for Multi-User status. Supabase, selected by the superseded ADR-0003, is not the target.

**Deployment dependency — Overtime approval (owner decision D-BF4b2-5 = A).**
BF-4b2 and AFI-4b2 must be deployed together. BF-4b2 lets the CEO approve overtime (an `Approved`
status), and the AFI-4b1 SESSION Overtime client deliberately fails closed on that status, so there must
never be a production interval in which the backend can create Approved records while the deployed
frontend is AFI-4b1 only.

Plan facts confirmed by the maintainer in hPanel (2026-09-29):

| Facility | State |
|---|---|
| PHP | 8.3, with PHP configuration and extensions in hPanel |
| Database facility | Available |
| SFTP | Available |
| SSH | Available but **inactive** |
| SSL / CDN | Active |
| Provider backups | **Weekly** |

**Source of truth.** Git `main` is canonical. Files on the host are deployment copies, never source;
nothing is edited on the server. A local copy of the artifact outside `dist/` is a convenience copy,
not a release input. Hosting credentials, database credentials, server paths and account details
belong in the private layer (§1), never in this repository.

**Governed deployment flow:**

1. Canonical `main` at the release commit/tag (per [`RELEASE-PROCESS.md`](RELEASE-PROCESS.md)).
2. A passing verifier, then `node tools/build-package.js`; the rebuilt `dist/package-manifest.json`
   must equal the committed one.
3. Take the package ZIP (or `dist/package/`) and confirm its SHA-256 equals the manifest's
   `zip.sha256`.
4. Upload the **contents** of the package over SFTP (currently via WinSCP) to the Hostinger document
   root, so `index.html` sits at `/`. Nothing else from the repository is uploaded.
5. Spot-check deployed files against the manifest's per-file SHA-256, then run a production smoke
   test.

**The package (Distribution-1).** Every file is a byte-identical copy of its source file at the same
relative path: `index.html`, the six stylesheets, the pre-paint `js/boot/theme-boot.js`, every
module-order script, vendored SheetJS, and the licence texts. It has no inline executable script and
no third-party request, so it runs under a strict Content-Security-Policy. The API base is the
relative same-origin `/api` — there is no runtime configuration file, key or absolute URL (ADR-0004
§2.5).

**Response-header contract.** The headers the host must send are defined once, in
[`tools/package-headers.js`](../tools/package-headers.js), which `tools/serve-package.js` applies
locally and the verifier checks. In summary:

- **CSP:** `script-src 'self'` with no `'unsafe-inline'` / `'unsafe-eval'`; `style-src 'self'`;
  `connect-src 'self'`; `object-src`, `base-uri`, `frame-ancestors` `'none'`; `data:` only for fonts and
  images.
- **Security headers:** `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy`; HSTS only per SDR-0002 §13.1.
- **Documented exception — inline style attributes.** `style-src-attr 'unsafe-inline'` is the one
  relaxation. About 457 `style="…"` attributes in UI templates across 33 modules (420 static layout
  values, 37 runtime-computed) predate Distribution-1. Moving them into classes is a broad UI and
  CSS-golden-master change, so it is **tracked follow-up work**, not part of this package change.
  `<style>` elements and style URLs stay restricted to `'self'`, and scripts are unaffected.

Applying these headers on Hostinger (for example via `.htaccess`) is a deployment step for the backend
readiness milestones; nothing here configures the host.

**Cache model.**

| Path | Cache-Control | Why |
|---|---|---|
| `/` and every package file | `no-cache` (revalidate) | Filenames are not content-hashed, so no file may be cached as immutable; a stale script beside a fresh `index.html` must be impossible |
| `/api/*` | `no-store, private` | Never cached by the browser or the CDN (SDR-0002 §13.3) |

The Hostinger CDN must honour both before real data (SDR-0002 E5). Content-hashed filenames with
long-lived caching are a possible later optimization, not a requirement.

**Schema changes.** The database schema changes only through `php server/bin/migrate.php apply`
(`status` reports without changing anything); there is no migration endpoint and nothing migrates at
start-up. `/api/ready` answers 503 until the schema is exactly current. How that command will be run on
Hostinger — SSH is currently inactive — is a pre-deployment decision, as is whether migrations use
separate database credentials from the runtime API.

**Mandatory pre-deployment verifications (backend):**

- backend configuration and secrets can live **outside the public web root**;
- `/api/*` responses are never publicly cached by the CDN (for example `Cache-Control: no-store,
  private`);
- the required PHP extensions are present;
- cron is available for the nightly database dump and for the BF-3D mail worker
  (`php server/bin/mail.php run`, at a recorded interval);
- (BF-3D) the governed-mail evidence of [SDR-0003](security/SDR-0003-governed-mail-transport.md) §7:
  outbound HTTPS to the provider with a trusted CA bundle, the sender domain verified with SPF, DKIM
  and DMARC published, a delivery test to an owner-controlled mailbox with fabricated content, and the
  send-only key stored only in the configuration file outside the web root;
- database transactions (InnoDB) behave as designed;
- (BF-3A) the server engine and version enforce the schema's CHECK constraints; Argon2id is available
  (or the bcrypt fallback is recorded) and its 64 MiB per verification fits the host's limits; the
  `__Host-tamos_session` cookie (`Secure`, `HttpOnly`, `SameSite=Strict`) passes LiteSpeed and the CDN
  unchanged; which client address `REMOTE_ADDR` carries behind the CDN (a shared edge address would
  make the per-IP login limit global); and whether the runtime database user can be denied
  `UPDATE`/`DELETE` on `auth_events`;
- (BF-3B) the server engine applies `0008` (`ALTER TABLE … DROP CONSTRAINT …, ADD CONSTRAINT …`) and
  honours `GET_LOCK`; how `php server/bin/account.php` (the first-CEO bootstrap and break-glass reset) is
  run on the host, by whom, and how its one-time activation token reaches the CEO out of band without
  being stored in a log or ticket.

**Backup target:**

1. Hostinger's automatic backup (currently Weekly) as the provider baseline.
2. A nightly cron database dump, encrypted, with an off-host copy in the private layer.
3. Periodic restore rehearsal, with row counts and monetary totals reconciled.

Target RPO is about 24 hours; PITR is not required initially.

**Cutover gate.** TAM OS replaces the default page at `finance.reliabilityindonesia.com` — and real
company data may be entered — only when **all** of the following hold. A visible login form is not
readiness.

- [ ] Canonical production build verified; deployed hash matches the release artifact
- [ ] HTTPS valid on the production hostname
- [ ] Authentication operational: sign-in, session rotation, logout, password recovery/reset, rate
      limiting
- [ ] Disabled and unauthorized accounts are denied
- [ ] User → membership → employee mapping verified
- [ ] Shared persistence verified across separate browsers/devices
- [ ] Server-side authorization and data scope verified with hostile-principal tests that bypass the UI
- [ ] `/api/*` is never publicly cached
- [ ] No "Acting as" selector in production
- [ ] No secret in the frontend, the repository or the public web root
- [ ] Nightly encrypted off-host database dump running, and a restore rehearsed
- [ ] External security review completed, with findings resolved or explicitly accepted
- [ ] Authenticated end-to-end tests pass
- [ ] Production smoke test passes

## 9. Responsible disclosure

Security issues must be reported **privately** by email to <fanoryu@gmail.com> (subject
`TAM-OS Security Report`) — see [`SECURITY.md`](../SECURITY.md). Do not file a vulnerability as an
issue, and never include real company data in a report.
