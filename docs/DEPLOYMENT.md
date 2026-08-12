# Deployment & the Public-Core / Private-Company-Layer Split

This document explains how TAM Intelligence OS is structured for a **public source core** with a
**separate private company layer**, and how PT Total Asset Manajemen keeps production data and
configuration outside this repository. It describes only what actually exists in the repo; for the
module map see [`ARCHITECTURE.md`](../ARCHITECTURE.md), for data rules see
[`DATA-SAFETY.md`](DATA-SAFETY.md), and for the release procedure see
[`RELEASE-PROCESS.md`](RELEASE-PROCESS.md).

## 1. Two layers

**Public core (this repository)** — application source (`index.html`, `css/`, `js/`), the
build/verify tooling (`tools/`), the tracked portable release (`dist/*.html`), the golden-master
reference HTML, documentation, CI/release workflows, and issue/PR templates. It contains **no company
data** and ships an **empty data seed** (a fresh install starts with zero records; the verifier
asserts the embedded `seed-data` JSON is `[]`).

**Private company layer (maintained separately, never in this repo)** — the real fund-usage / payroll
planning workbook, employee/payroll/finance records, Complete Backup exports, company branding, and any
deployment-specific configuration or secrets. A ready-to-use template for this layer
(`tam-company-private-template/`) is kept **outside** the public repository with folders for
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
environment). Nothing is transmitted to a server. The only external network references are the
spreadsheet parser and web fonts loaded from a CDN; no user data is sent to them.

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

1. Keep the public core (this repo) and the private layer in **separate locations**. If the private
   layer becomes a Git repository, keep it **private** and never add the public remote to it.
2. Put the real workbook, exports, backups, branding, and deployment config in the private layer only.
3. To run against real data: open the app locally and load a Complete Backup, or import the private
   workbook — all locally, on a company-controlled device.
4. If any confidential file is ever committed to the public core by mistake, treat it as disclosed:
   purge it from history, rotate anything sensitive, and follow [`SECURITY.md`](../SECURITY.md).

## 8. Responsible disclosure

Security issues must be reported **privately** — see [`SECURITY.md`](../SECURITY.md). Do not open a
public issue for a vulnerability, and never include real company data in a report.
