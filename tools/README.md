# `tools/` — Build, Verify, and Runtime Harnesses

Node is the **only** place Node is used in this project (`CLAUDE.md` §3). The application itself ships
zero dependencies and never runs Node. Nothing here needs `npm install`.

All commands are run from the repository root.

---

## Core toolchain

| Tool | Purpose |
|---|---|
| [`module-order.js`](module-order.js) | **Single source of truth** for classic-script load order, mirrored by `index.html` |
| [`app-version.js`](app-version.js) | **Single source of truth** for the version in tooling — parses `APP_VERSION` / `APP_RELEASE_NAME` from `js/core/constants.js` and derives the artifact filename |
| [`build-single-file.js`](build-single-file.js) | Assembles `css/` + `js/` into the portable single-file build. Assembles only — no transform, no minify, no reorder |
| [`verify-build.js`](verify-build.js) | The invariant verifier. A change is not done until this passes completely |
| [`integration-surface-manifest.js`](integration-surface-manifest.js) | The frozen UX-006C3 integration surface (43 entries), consumed by the verifier and the authorization harness |
| [`check-commit-attribution.js`](check-commit-attribution.js) | Owner-only authorship guard — rejects AI-attribution trailers in commit messages (`CLAUDE.md` §15.7) |

### Build

```bash
node tools/build-single-file.js
```

Writes `dist/tam-os-v<APP_VERSION>.html`. The version is **derived, never typed** — it comes from
`js/core/constants.js` via `app-version.js`. The build is reproducible: the same source produces
byte-identical output.

### Verify

```bash
node tools/verify-build.js
```

Guards the CSS golden-master pin, build fidelity (output equals concatenated source), version identity,
schema/storage/migration invariants, empty seed data, absence of ES-module syntax, the module
decomposition and load-order agreement, and the `dist/` single-artifact invariant.

Print the derived version without building:

```bash
node tools/app-version.js
```

### Check a commit message

```bash
node tools/check-commit-attribution.js .git/COMMIT_EDITMSG
node tools/check-commit-attribution.js --selftest
```

To enforce it locally, wire it as a `commit-msg` hook (opt-in — it is never installed automatically):

```bash
printf '#!/bin/sh\nexec node tools/check-commit-attribution.js "$1"\n' > .git/hooks/commit-msg && chmod +x .git/hooks/commit-msg
```

---

## Runtime verification harnesses

**34 harnesses.** Each boots the application's modules in a headless harness and asserts *behaviour* —
what `verify-build.js` cannot prove by reading source. A green `verify-build.js` is necessary but not
sufficient (`CLAUDE.md` §11.1).

Each is run the same way and exits non-zero on failure:

```bash
node tools/verify-<name>-runtime.js
```

### Run the whole suite

```bash
for f in tools/verify-*-runtime.js; do node "$f" >/dev/null 2>&1 && echo "PASS $f" || echo "FAIL $f"; done
```

PowerShell:

```bash
Get-ChildItem tools/verify-*-runtime.js | ForEach-Object { node $_.FullName *> $null; if ($LASTEXITCODE -eq 0) { "PASS $($_.Name)" } else { "FAIL $($_.Name)" } }
```

> **Note.** These harnesses are **not** wired into CI — `ci.yml` runs the build and `verify-build.js`
> only. Run the suite locally before proposing a change that touches behaviour. Wiring them into CI is
> a known, separately-scoped follow-up.

### Authorization & identity

| Harness | Proves |
|---|---|
| [`verify-identity-foundation-runtime.js`](verify-identity-foundation-runtime.js) | UX-006A identity seam, CEO + Employee principals, no persistence, fail-closed |
| [`verify-identity-selection-runtime.js`](verify-identity-selection-runtime.js) | UX-006D1 reachable principal selection ("Acting as"), ephemeral, no boot default |
| [`verify-workspace-selfscope-runtime.js`](verify-workspace-selfscope-runtime.js) | UX-006B derived Executive/Personal workspaces and the SELF-scope resolver |
| [`verify-authz-runtime.js`](verify-authz-runtime.js) | The frozen `can(action, resource?)` policy table and capability matrix |
| [`verify-authz-integration-runtime.js`](verify-authz-integration-runtime.js) | UX-006C3 integration freeze — 43 surfaces, navigation-only, visible+disabled pattern |
| [`verify-authz-c2c3-runtime.js`](verify-authz-c2c3-runtime.js) | C2C-3 boundaries — import undo, backup restore, data reset |
| [`verify-authz-c2c4-runtime.js`](verify-authz-c2c4-runtime.js) | C2C-4 administrative boundaries (zero new actions) |
| [`verify-authz-outcome-reporting-runtime.js`](verify-authz-outcome-reporting-runtime.js) | Denied mutations report honestly — no false success |
| [`verify-employee-read-scope-runtime.js`](verify-employee-read-scope-runtime.js) | Readiness-1 — Employee self-only read scope and identity-disclosure closure |

### Mutation enforcement (SE-0: denied ⇒ zero side effect)

| Harness | Proves |
|---|---|
| [`verify-mutation-enforcement-hr-runtime.js`](verify-mutation-enforcement-hr-runtime.js) | Employee and Contract CRUD boundaries |
| [`verify-mutation-enforcement-overtime-runtime.js`](verify-mutation-enforcement-overtime-runtime.js) | Overtime self-service, ownership and status-attack protection |
| [`verify-mutation-enforcement-contract-payroll-runtime.js`](verify-mutation-enforcement-contract-payroll-runtime.js) | Contract operations and payroll composite atomicity |
| [`verify-mutation-enforcement-finance-import-runtime.js`](verify-mutation-enforcement-finance-import-runtime.js) | Finance administration, execution, and Smart Import commit |

### Payroll, contracts & integrity

| Harness | Proves |
|---|---|
| [`verify-payroll-posting-runtime.js`](verify-payroll-posting-runtime.js) | Posting creates planned transactions and never auto-executes |
| [`verify-payroll-committed-runtime.js`](verify-payroll-committed-runtime.js) | Committed payroll is immutable |
| [`verify-monthlyplan-runtime.js`](verify-monthlyplan-runtime.js) | Monthly plan generation and commit |
| [`verify-renewal-runtime.js`](verify-renewal-runtime.js) | Contract renewal |
| [`verify-contract-core-runtime.js`](verify-contract-core-runtime.js) | Contract core field authority (ADR-014) |
| [`verify-contract-date-*` / `verify-contract-timeline-runtime.js`](verify-contract-timeline-runtime.js) | Contract date model and timeline derivation |
| [`verify-contract-persistence-runtime.js`](verify-contract-persistence-runtime.js) | Contract persistence round-trip |
| [`verify-integrity-rules-runtime.js`](verify-integrity-rules-runtime.js) | Cross-module integrity rules |
| [`verify-integrity-payroll-rules-runtime.js`](verify-integrity-payroll-rules-runtime.js) | Payroll-specific integrity rules |
| [`verify-integrity-warning-rules-runtime.js`](verify-integrity-warning-rules-runtime.js) | Drift is surfaced as a warning, never silently mutated |

### Data safety & end-to-end

| Harness | Proves |
|---|---|
| [`verify-savealldata-runtime.js`](verify-savealldata-runtime.js) | Complete Backup export/restore contract |
| [`verify-readiness2-e2e-runtime.js`](verify-readiness2-e2e-runtime.js) | Eight end-to-end user journeys against production seams, asserting the **persisted** payload |

### Interface & presentation

| Harness | Proves |
|---|---|
| [`verify-data-grid-runtime.js`](verify-data-grid-runtime.js) | Shared data grid — search, sort, filter, pagination, focus retention |
| [`verify-global-search-runtime.js`](verify-global-search-runtime.js) | Global search engine — navigation-only, source-agnostic |
| [`verify-sidebar-interaction-runtime.js`](verify-sidebar-interaction-runtime.js) | Sidebar open/close and interaction invariants |
| [`verify-sidebar-click-regression-runtime.js`](verify-sidebar-click-regression-runtime.js) | Sidebar click regression guard |
| [`verify-nav-simplification-runtime.js`](verify-nav-simplification-runtime.js) | Navigation structure |
| [`verify-breadcrumb-quickaction-runtime.js`](verify-breadcrumb-quickaction-runtime.js) | Breadcrumbs and Quick Actions |
| [`verify-execdashboard-actioncenter-runtime.js`](verify-execdashboard-actioncenter-runtime.js) | Executive dashboard and Action Center — drill-through is mutation-free |
| [`verify-ux006d2-presentation-runtime.js`](verify-ux006d2-presentation-runtime.js) | UX-006D2 principal & workspace presentation |
| [`verify-ux006d3-presentation-runtime.js`](verify-ux006d3-presentation-runtime.js) | UX-006D3 cross-surface presentation consistency |

---

## Rules

- **Never hand-edit the portable build.** Regenerate it (`CLAUDE.md` §10.4).
- **Never hardcode a version** in tooling — derive it from `app-version.js` (`CLAUDE.md` §10.1).
- **If you add or move a JS module**, update `module-order.js` **and** `index.html` together
  (`CLAUDE.md` §4.2).
- **Fail loudly.** Build and verify tooling throws clearly on bad input; it never degrades silently.
