# Deployment & the Source-Core / Private-Company-Layer Split

This document explains how TAM Intelligence OS is structured for a **source core** with a
**separate private company layer**, and how PT Total Asset Manajemen keeps production data and
configuration outside this repository. It describes only what actually exists in the repo; for the
module map see [`ARCHITECTURE.md`](../ARCHITECTURE.md), for data rules see
[`DATA-SAFETY.md`](DATA-SAFETY.md), and for the release procedure see
[`RELEASE-PROCESS.md`](RELEASE-PROCESS.md).

## 1. Two layers

**Source core (this repository)** — application source (`index.html`, `css/`, `js/`), the
build/verify tooling (`tools/`), the tracked portable release (`dist/*.html`), the golden-master
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

The app is a single-page, client-only application with **no backend, database, API, or runtime
dependencies**. Two equivalent forms:

- **Modular source** — serve the project root over HTTP (`python -m http.server 8000`) and open it.
- **Portable build** — open `dist/tam-os-v<version>.html` directly in a browser.

All data is stored **locally** in the browser's `localStorage` (or the Claude Artifact storage
environment). Nothing is transmitted to a server. Typography is embedded; the only external network
reference is the spreadsheet parser loaded from a CDN, and no user data is sent to it. Two browsers —
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
publishes nothing. Every change is built (`node tools/build-single-file.js`) and verified
(`node tools/verify-build.js`) — the verifier enforces build fidelity, version identity, the schema
version, the storage-key set, the empty seed, and the reporting invariants. Full steps:
[`RELEASE-PROCESS.md`](RELEASE-PROCESS.md); QA gate: [`QA-CHECKLIST.md`](QA-CHECKLIST.md).

## 7. Maintaining the private layer (PT Total Asset Manajemen)

1. Keep the source core (this repo) and the private layer in **separate locations**. If the private
   layer becomes a Git repository, keep it **private** and never add this repository's remote to it.
2. Put the real workbook, exports, backups, branding, and deployment config in the private layer only.
3. To run against real data: open the app locally and load a Complete Backup, or import the private
   workbook — all locally, on a company-controlled device.
4. If any confidential file is ever committed to the source core by mistake, treat it as disclosed:
   purge it from history, rotate anything sensitive, and follow [`SECURITY.md`](../SECURITY.md).

## 8. Production hosting — frontend target (not yet cut over)

**Target:** `https://finance.reliabilityindonesia.com`, served from the company's existing
**Hostinger managed web hosting** (hPanel), which it shares with the `reliabilityindonesia.com` web
presence. It is **not** a VPS. HOSTING-0 (2026-09-29) observed that the hostname already resolves to
Hostinger with valid HTTPS behind Hostinger's CDN, and that it serves the Hostinger default page —
**TAM OS is not deployed there.** A separately hosted TAM OS copy exists but is **pre-operational**:
no real company data has been entered, and none may be until the cutover gate below is met.

**Role.** Hostinger serves **static frontend files only**. The backend accepted in
[ADR-0003](03b-repository-adr/ADR-0003-shared-multi-user-architecture.md) — Supabase Auth, managed
PostgreSQL with Row-Level Security, and server functions — runs on Supabase, reached from the browser
over HTTPS/WSS. No backend code runs on Hostinger: its PHP runtime is irrelevant to the architecture,
Node/database/container capability there is not required, and **no VPS is required** (a self-hosted
backend is only ADR-0003's fallback if the Supabase direction is explicitly rejected). The backend is
**not implemented**; see [`Milestones.md`](05-milestones/Milestones.md) for Multi-User status.

**Source of truth.** Git `main` is canonical. Files on the host are deployment copies, never source;
nothing is edited on the server. A local copy of the artifact outside `dist/` is a convenience copy,
not a release input. Hosting credentials, server paths and account details belong in the private
layer (§1), never in this repository.

**Governed frontend deployment flow:**

1. Canonical `main` at the release commit/tag (per [`RELEASE-PROCESS.md`](RELEASE-PROCESS.md)).
2. Deterministic build and a passing verifier.
3. Record the SHA-256 of the verified `dist/` output.
4. Upload that output over SFTP (currently via WinSCP) to the Hostinger web root.
5. Confirm the deployed file's SHA-256 matches, then run a production smoke test.

Today the output is the single-file `dist/tam-os-v<version>.html`. A multi-user client also needs
public runtime configuration (backend URL, public anon key — never a server secret), so under
[ADR-0002](03b-repository-adr/ADR-0002-canonical-distribution-architecture.md) the multi-user frontend
is expected to ship as a package (Distribution-1), not one inlined file.

**Cutover gate.** TAM OS replaces the default page at `finance.reliabilityindonesia.com` — and real
company data may be entered — only when **all** of the following hold. A visible login form is not
readiness.

- [ ] Canonical production build verified; deployed hash matches the release artifact
- [ ] HTTPS valid on the production hostname
- [ ] Supabase Auth operational: sign-in, session refresh, logout, password recovery/reset
- [ ] Disabled and unauthorized accounts are denied
- [ ] User → membership → employee mapping verified
- [ ] Shared persistence verified across separate browsers/devices
- [ ] Default-deny RLS and server-side authorization verified with a real token, bypassing the UI
- [ ] No "Acting as" selector in production
- [ ] No server secret in the frontend or the repository
- [ ] Managed backups / point-in-time recovery enabled and a restore rehearsed
- [ ] Authenticated end-to-end tests pass
- [ ] Production smoke test passes

## 9. Responsible disclosure

Security issues must be reported **privately** by email to <fanoryu@gmail.com> (subject
`TAM-OS Security Report`) — see [`SECURITY.md`](../SECURITY.md). Do not file a vulnerability as an
issue, and never include real company data in a report.
