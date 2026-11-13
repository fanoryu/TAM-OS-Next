<div align="center">

<img src="assets/branding/tam-os-logo-full-color.png" alt="TAM OS" width="360">

# TAM OS

**Integrated Management Intelligence for PT Total Asset Manajemen** — a single-page finance,
payroll, and operations workspace. The shipped application runs entirely in the browser; a
same-origin backend for future multi-user use is being built as source only and is not deployed.

[![CI](https://github.com/fanoryu/TAM-OS-Next/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/fanoryu/TAM-OS-Next/actions/workflows/ci.yml)
[![Attribution](https://github.com/fanoryu/TAM-OS-Next/actions/workflows/attribution.yml/badge.svg?branch=main)](https://github.com/fanoryu/TAM-OS-Next/actions/workflows/attribution.yml)
[![Version](https://img.shields.io/badge/version-2.11.0-blue)](https://github.com/fanoryu/TAM-OS-Next/releases/tag/v2.11.0)
[![License](https://img.shields.io/badge/license-see%20LICENSE-red)](LICENSE)
[![JavaScript](https://img.shields.io/badge/JavaScript-vanilla%20%C2%B7%20no%20framework-f7df1e)](ARCHITECTURE.md)
[![HTML](https://img.shields.io/badge/HTML-static%20package-e34f26)](docs/DEPLOYMENT.md)
[![Core](https://img.shields.io/badge/core-source%20repository-blue)](docs/STATUS.md)

</div>

> **Publicly viewable source — company data is separate.** This is the source core of TAM OS: application source,
> tooling, docs and an empty-data default. Production company data and configuration are maintained in a private
> company layer ([`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)). TAM OS is **proprietary and all rights reserved** under
> [`LICENSE`](LICENSE); public visibility grants no right to use, copy, modify or redistribute it, and this repository
> is **not** open source. Never commit real company, employee, payroll or backup data.

---

## Status at a glance

The central release, deployment and gate record is [docs/STATUS.md](docs/STATUS.md). This section is orientation
only; it authorizes nothing, and where it differs from that record, the record wins.

| | |
|---|---|
| **Latest release** | **v2.11.0 — Identity Refresh**, **published** and **marked Latest** from annotated tag `v2.11.0` in `fanoryu/TAM-OS-Next`. A client-only single HTML file (`AUTH_MODE` LOCAL): data stays in the browser profile. Its "Acting as" selector is a local, trust-based context, **not authentication** and not a security boundary. |
| **On `main` (unreleased)** | The **v3.0.0 — Core SESSION Foundation** candidate: a signed-in application (`AUTH_MODE` SESSION) built as the Distribution-1 package against the same-origin PHP 8.3 + MariaDB backend under `server/` ([ADR-0004](docs/03b-repository-adr/ADR-0004-hostinger-same-origin-backend.md)), plus **Finance Phase 1** — general transactions by Financial Post and the SESSION financial report (PR #85) — and the v2.11.0-style SESSION shell (UI-INT-1, PR #88). Source only: **not deployed, not production-ready**, Core SESSION areas only; browser-stored v2.x data is not migrated. Scope: [`RELEASE_NOTES.md`](RELEASE_NOTES.md), [`CHANGELOG.md`](CHANGELOG.md). |
| **Gates** | Every release, deployment and production gate is restrictive (ENG-C1 BLOCKED, v3.0.0 HOLD, Gate D and Gate R HOLD, Hostinger NO-GO). The controlled internal pilot (**PILOT-1**) is **ON HOLD** and no real company data has been entered. A release, tag or deployment needs separate, explicit Owner authorization ([`CLAUDE.md`](CLAUDE.md) §20). |

**Previous release.** v2.10.0 (Governed Workspace) remains **published** and intact. It was
**originally published** from the predecessor repository **`fanoryu/TAM-OS`** (private predecessor
repository retained for historical provenance — not resolvable by public visitors) and
**canonically re-published** unchanged from `fanoryu/TAM-OS-Next` under annotated tag `v2.10.0`. Its asset
`tam-os-v2.10.0.html` (1,151,267 bytes, SHA-256
`60382271a6dcea23431fabb91e0d16abb03196e5cf64c6dc4da1e1af2c7fa704`) is **byte-identical** across both
Releases. Earlier releases and the migration record: [`RELEASE_NOTES.md`](RELEASE_NOTES.md),
[`CHANGELOG.md`](CHANGELOG.md) and [`PROVENANCE.md`](PROVENANCE.md).

---

## What it does

Capabilities of the published v2.11.0 release. The SESSION candidate on `main` does not expose all of these areas
yet; see *Incomplete work and limitations* in [docs/STATUS.md](docs/STATUS.md).

- **Finance operations** — a transaction ledger with planned vs. actual amounts, an Execution Center, cash-flow and
  budget views, and a financial calendar.
- **People & payroll** — employees and contracts; a Payroll Workspace running Draft → Review → Approved → Posted →
  Executed over a read-only worksheet; a TAM-method overtime engine; Supplemental Payments for overtime approved after
  payroll is immutable.
- **Integrity & history** — Posted/Executed payroll renders from immutable committed snapshots; committed financial
  history is never reconstructed or auto-repaired.
- **Planning & analytics** — a monthly plan generator, planned-vs-actual and month-over-month comparisons, trend
  charts and an executive dashboard.
- **Import & recovery** — Smart Import from spreadsheets with duplicate prevention; a read-only Activity Log, Complete
  Backup / Restore, CSV exports and typed-confirmation safeguards.

| Executive Overview | Transactions Data Grid |
|---|---|
| ![Executive Dashboard and Action Center](assets/screenshots/dashboard-dark.png) | ![Transactions Data Grid](assets/screenshots/data-grid-transactions.png) |
| **Global Search** (`Ctrl/Cmd+K`) | **Payroll Workspace** |
| ![Global Search command palette](assets/screenshots/global-search.png) | ![Payroll Workspace](assets/screenshots/payroll-workspace.png) |

Captured from the frozen UX-005 interface (dark theme) with clearly labelled fabricated demo data.

---

## Getting started

**Run the published release (v2.11.0).**

1. Get **`tam-os-v2.11.0.html`** — [`dist/tam-os-v2.11.0.html`](dist/tam-os-v2.11.0.html), or the identical asset of
   the Latest [`v2.11.0` Release](https://github.com/fanoryu/TAM-OS-Next/releases/tag/v2.11.0).
2. *(Recommended)* Verify it — `Get-FileHash tam-os-v2.11.0.html -Algorithm SHA256` (PowerShell) or
   `shasum -a 256 tam-os-v2.11.0.html`. Expect **1,676,709 bytes** / SHA-256
   `57d8b0c23c83509a70a766d903e2ee19aa57e5bcfc70950652d930e8f2358557`.
3. Open it in a **desktop Chromium browser**. No install, no server. Fonts are embedded; `.xlsx` import in this file
   still needs the CDN-hosted parser (`.csv` does not).
4. Data stays **local to that browser profile**. Export via **Settings → Complete Backup**.

**Build and serve the current source.** No framework and no `npm install` (Node.js v18+, tested on v24):

```bash
node tools/verify-build.js
node tools/build-package.js
node tools/serve-package.js
```

Then open <http://127.0.0.1:8765/>; `file://` is not supported. The source runs in SESSION mode, so signing in needs a
backend — the test-only loopback servers are indexed in [`tools/README.md`](tools/README.md). Use fabricated data only.

---

## Development

Plain HTML, CSS and classic-script JavaScript sharing one global scope; the only runtime dependency is the vendored,
integrity-checked SheetJS parser, and Node.js is used only for build/verify tooling. The modular source is assembled
byte-for-byte into a static deployment package that runs under a strict Content-Security-Policy; an invariant verifier
and runtime harnesses guard schema, storage keys, migration flags and build fidelity on every change.

- **Edit the modular source only** — never generated output or the frozen releases in `dist/`. A new or moved module
  updates `tools/module-order.js` **and** `index.html` together.
- **Verify, build, then browser-validate** the served package: zero console errors, zero CSP violations
  ([`docs/QA-CHECKLIST.md`](docs/QA-CHECKLIST.md)). The version lives once, in `APP_VERSION` (`js/core/constants.js`).
- **Ask before approval-gated actions** — commit, push, tag and release need explicit Owner approval
  ([`CLAUDE.md`](CLAUDE.md) §20). Releases are tag-driven and guarded ([`docs/RELEASE-PROCESS.md`](docs/RELEASE-PROCESS.md)).
- **Data safety** — `SCHEMA_VERSION` = 6 and the storage keys are stable; the build seeds no data; destructive actions
  snapshot first ([`docs/DATA-SAFETY.md`](docs/DATA-SAFETY.md)).

The full contributor contract is [`CONTRIBUTING.md`](CONTRIBUTING.md). Commits are owner-authored; AI-attribution
trailers are rejected locally by `.githooks/commit-msg` (`node tools/install-hooks.js`) and in CI by
[`tools/check-commit-attribution.js`](tools/check-commit-attribution.js).

---

## Documentation

Each document owns one responsibility and links rather than repeats. Browsing `docs/`? Start at the
[`docs/` index](docs/README.md).

| Document | Read it for |
|---|---|
| [`docs/STATUS.md`](docs/STATUS.md) | **Start here** — current baseline, limitations, release and deployment gates |
| [`AI_CONTEXT.md`](AI_CONTEXT.md) | Modules, workflows, decisions, glossary and detailed engineering history |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Module map, load order, per-release provenance and diagrams |
| [`CLAUDE.md`](CLAUDE.md) · [`AGENTS.md`](AGENTS.md) | Engineering constitution and approval matrix · AI-assistant entry point |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contribution workflow (baseline, build, verify, QA, approvals) |
| [`CHANGELOG.md`](CHANGELOG.md) · [`RELEASE_NOTES.md`](RELEASE_NOTES.md) | Version history · current candidate and published releases |
| [`docs/01-roadmap/`](docs/01-roadmap/README.md) · [`docs/05-milestones/`](docs/05-milestones/Milestones.md) | Forward roadmap (directions, not commitments) · milestone detail |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) · [`docs/BACKEND-DEPLOYMENT-RUNBOOK.md`](docs/BACKEND-DEPLOYMENT-RUNBOOK.md) | Package deployment and header contract · governed backend procedure |
| [`docs/03b-repository-adr/`](docs/03b-repository-adr/README.md) · [`docs/security/`](docs/security/README.md) | Architecture Decision Records · Security Decision Records |
| [`docs/99-archive/`](docs/99-archive/README.md) · [`PROVENANCE.md`](PROVENANCE.md) | Historical provenance records · where this repository came from |
| [`assets/branding/`](assets/branding/BRAND_GUIDELINES.md) | Brand guidelines ([canonical PDF](assets/branding/TAM-OS-Brand-Guidelines.pdf)); use the supplied artwork only |

Review is routed by [`.github/CODEOWNERS`](.github/CODEOWNERS); PRs use the
[pull request template](.github/pull_request_template.md); issues use the structured
[bug](.github/ISSUE_TEMPLATE/bug_report.yml) and [feature](.github/ISSUE_TEMPLATE/feature_request.yml) forms.

---

## License and security

- **License:** proprietary — all rights reserved by PT Total Asset Manajemen ([`LICENSE`](LICENSE),
  [`PROPRIETARY-LICENSE-NOTICE.md`](PROPRIETARY-LICENSE-NOTICE.md)). Not open source.
- **Data:** this repository holds **no** company data; production data and configuration are maintained separately.
- **Security:** report vulnerabilities privately by email to <fanoryu@gmail.com> (subject `TAM-OS Security Report`) —
  never in an issue, and never with real data. Full policy: [`SECURITY.md`](SECURITY.md).

© PT Total Asset Manajemen. All rights reserved.
