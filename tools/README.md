# `tools/` — Build, Verify, and Runtime Harnesses

Node is the **only** place Node is used in this project (`CLAUDE.md` §3). The application itself never
runs Node; its only runtime dependency is the vendored, pinned SheetJS parser. Nothing here needs
`npm install`.

All commands are run from the repository root.

---

## Core toolchain

| Tool | Purpose |
|---|---|
| [`module-order.js`](module-order.js) | **Single source of truth** for classic-script load order, mirrored by `index.html` |
| [`app-version.js`](app-version.js) | **Single source of truth** for the version in tooling — parses `APP_VERSION` / `APP_RELEASE_NAME` from `js/core/constants.js` and derives the artifact filename |
| [`build-package.js`](build-package.js) | Builds the Distribution-1 deployment package (`dist/package/`, the ZIP, and the committed `dist/package-manifest.json`). Copies only — no inline, transform, minify or reorder |
| [`package-headers.js`](package-headers.js) | **Single source of truth** for the production response headers (CSP, security headers, cache rules) |
| [`serve-package.js`](serve-package.js) | Local loopback server for `dist/package/` that applies the production header contract — for browser validation only, never deployed |
| [`serve-auth-stub.js`](serve-auth-stub.js) | **Test-only** loopback server for browser QA of the SESSION-mode auth views: serves the package with `AUTH_MODE` set to SESSION in memory and answers `/api/auth/me`, `/login`, `/logout` and (AFI-3) `/activate`, `/forgot-password`, `/reset-password` from fabricated scenarios and one-time tokens, and (AFI-4a1) the scoped Employee reads `/api/employees[?archived=1]` and `/api/employee?id=` over fabricated records, and (AFI-4a2) the CEO writes `POST /api/employees/create`, `/update`, `/archive` with CSRF, versions, duplicate codes, archive state and `write-*` error scenarios, every CEO answer carrying the BF-4a3 `accountManageable`, and (AFI-4a3) the four account routes `provision-account`, `reissue-activation`, `disable-account`, `enable-account` with their state guards and matrix fixtures — never a token or link — and (AFI-4b1) the Overtime month / record reads and the six Overtime writes, scoped like BF-4b1 (an Employee's own records only, the create `employeeId` resolved in scope, eligibility, status and version checks, Draft-only delete, the `write-*` scenarios), and (AFI-4b2) the BF-4b2 valuation read and approve (frozen for Approved, CEO preview for Reviewed, the `expectedAmount` check, `/__stub/bump-salary` to make a shown preview stale), and (AFI-4c1) the BF-4c1 payroll reads, generate and the four transitions, CEO only (`/__stub/bump-payroll` makes a shown plan stale), and (AFI-4c2) the BF-4c2 commit (key replay and mismatch), the CEO drift read and the Employee's own Committed reads (`/__stub/drift-payroll` drifts every Ready plan; `/__stub/fail-next-commit` applies the next commit, then answers 503) (`/__stub/scenario/<name>`). Not a backend; never deployed |
| [`build-single-file.js`](build-single-file.js) | **Retired** by Distribution-1 — refuses to run so it cannot overwrite a frozen single-file release |
| [`verify-build.js`](verify-build.js) | The invariant verifier. A change is not done until this passes completely |
| [`integration-surface-manifest.js`](integration-surface-manifest.js) | The frozen UX-006C3 integration surface (43 entries), consumed by the verifier and the authorization harness |
| [`check-commit-attribution.js`](check-commit-attribution.js) | Owner-only authorship guard — the single source of attribution policy, shared by the tracked hook and CI (`CLAUDE.md` §15.7) |
| [`install-hooks.js`](install-hooks.js) | Points this repository at the tracked `.githooks/` directory (repository-local; never global) |
| [`verify-backend-boundary.js`](verify-backend-boundary.js) | Static boundary check for the PHP backend under `server/` (data-access boundary, forbidden APIs, API-header parity, `.gitignore` traps; BF-3C: capability construction, scoped business stores, company-table confinement, migration tenant key, and ACTION parity with `js/core/authz.js`; BF-4b1: `overtime_records` has one writer, its only DELETE is pinned to the Draft, version and company predicate, no TRUNCATE, each overtime route declares its existing Action, and double-quoted `*_SELF_SQL` constants must bind `:self_employee_id` too; BF-4b2: the approval is the one writer of the valuation snapshot and of `Approved` — from `'Reviewed'`, at the expected version, in company scope — the overtime store never reads the salary through a self-scope statement, the `TAM-OT-1` valuation is integer arithmetic only (no float, rounding helper, BCMath or `/`), the Overtime code names no payroll or finance, and approve declares `overtime.manage`; BF-4c1: `payroll_plans` and `payroll_plan_overtime` have one writer, no plan DELETE or TRUNCATE, every plan UPDATE is a pre-commit compare-and-swap and none writes `'Committed'`, the link release requires a pre-commit plan, payroll locks rows only by primary key, reads only Approved overtime and never a valuation column, `PayrollCalculation` is integer arithmetic only, the Payroll code names no valuation, finance or statutory term, the inputs are exactly `{ month }` and `{ id, expectedVersion }`, the five payroll writes declare `payroll.manage`, and ACTIONS stay 21; BF-4c2: exactly one statement — `COMMIT_SQL`, from `'Ready'` at the expected version — writes `'Committed'`, `committed_at` or the commit key, every Employee payroll read is a plain SELECT of their own Committed plans, commit takes exactly `{ id, expectedVersion, expectedTotal, idempotencyKey }` and is the sixth `payroll.manage` route, and the drift read declares no Action) |

### Backend (BF-1)

The PHP backend under `server/` has its own checks; none of them affects the frontend verifier count.

```bash
node tools/verify-backend-boundary.js --selftest   # prove every rule catches its violation
node tools/verify-backend-boundary.js              # check server/ (needs every server/ file tracked)
php server/tests/run.php                           # backend tests (PHP 8.3; no Composer, no database)
```

The boundary tool runs without PHP. The tests need a PHP 8.3 CLI; CI (`backend.yml` → `backend-verify`)
uses the runner's own PHP 8.3 and fails if the runner has a different version.

The database suite (`server/tests/Db/`) runs only with `TAMOS_DB_TESTS=1` and a guarded disposable
database (`TAMOS_TEST_DB_HOST` / `_PORT` / `_NAME` / `_USER` / `_PASS`: loopback host, name ending in
`_test`). Otherwise it is reported **NOT RUN**, never passed. CI (`backend.yml` → `backend-db`) runs it
against a MariaDB 10.11 service container with `php server/tests/run.php --require-db`.

Schema migrations (BF-2B) run only through the CLI runner, never over HTTP:

```bash
php server/bin/migrate.php status   # locked, read-only: current / pending / reason
php server/bin/migrate.php apply    # create and verify history, then run pending migrations
```

Migration tests write their fixture files to temporary directories; nothing under `server/migrations/`
is a test fixture. `server/migrations/` holds the production schema (BF-3A: `0001`–`0006`; BF-3B:
`0007`–`0008`; BF-3C: `0009`–`0010`; BF-3D: `0011`–`0013`; BF-4a1: `0014`–`0017`; BF-4a2: `0018`–`0019`; BF-4b1: `0020`–`0021`; BF-4b2: `0022`–`0023`; BF-4c1: `0024`–`0026`; BF-4c2: `0027`–`0028`); the boundary tool refuses any migration that inserts, updates or
deletes rows (the one exception, `0015_backfill_legacy_employees`, is admitted only at its pinned digest), any cascading foreign key, and any new table that is not an auth/system table or a
registered company table carrying the tenant key.

Accounts (BF-3B) come into existence only through the operator CLI, never over HTTP and never from seed
data. Neither command takes a password; each prints a one-time activation token once:

```bash
php server/bin/account.php create-ceo --email=<address>          # once: first company + pending CEO
php server/bin/account.php reset-credentials --email=<address>   # break-glass, CEO only; also reissues an expired token
```

Recovery mail (BF-3D, SDR-0003) is sent only by the cron worker, never by an HTTP request. It needs
the `mail` configuration section and prints counts only:

```bash
php server/bin/mail.php run   # deliver up to 20 due outbox rows under the tamos_mail lock, then exit
```

Mail tests use the in-memory `RecordingMailTransport` (`server/tests/lib.php`) and the Resend adapter
with an injected poster: no test reaches a network or sends mail, and the CLI tests run the worker
only over an empty outbox.

Authentication tests create their accounts per run inside the guarded test database
(`server/tests/lib.php` → `authFixture`, and `pendingCeo` through the real lifecycle); no credential is
stored in the repository. The boundary tool also confines the password API, the session cookie name,
`Set-Cookie`, `HTTP_COOKIE`, principal construction and CSRF comparison to their approved files, and
account and account-token writes to their two stores (see `ARCHITECTURE.md` → Authentication and
sessions, Account lifecycle).

### Build

```bash
node tools/build-package.js
```

Writes `dist/package/` (the document root), `dist/tam-os-v<APP_VERSION>-package.zip` and
`dist/package-manifest.json`. Only the manifest is committed. The version is **derived, never typed** —
it comes from `js/core/constants.js` via `app-version.js`. The build is reproducible: the same source
produces byte-identical files, ZIP and manifest.

Serve the built package locally under the production headers:

```bash
node tools/serve-package.js        # http://127.0.0.1:8765/
```

### Verify

```bash
node tools/verify-build.js
```

Guards the CSS golden-master pin, package determinism and fidelity (the committed manifest equals a
fresh assembly; every package file equals its source), the frozen single-file releases (pinned by
digest), the strict-CSP shape, version identity, schema/storage/migration invariants, empty seed data,
absence of ES-module syntax, and the module decomposition and load-order agreement.

Print the derived version without building:

```bash
node tools/app-version.js
```

### Attribution guard — install after cloning

**Run this once per clone.** `.git/hooks/` is not version-controlled, so a fresh clone starts with no
local commit-message enforcement until Git is pointed at the tracked `.githooks/` directory:

```bash
node tools/install-hooks.js
```

That sets `core.hooksPath=.githooks` **for this repository only** — it never writes global Git
configuration — and then proves the guard works by feeding it a prohibited message and confirming the
rejection. The equivalent raw command is `git config core.hooksPath .githooks`.

| Command | Does |
|---|---|
| `node tools/install-hooks.js` | Install and verify |
| `node tools/install-hooks.js --check` | Verify only; non-zero if not installed |
| `node tools/install-hooks.js --uninstall` | Unset `core.hooksPath` for this repository |

### Check attribution directly

```bash
node tools/check-commit-attribution.js .git/COMMIT_EDITMSG   # one message file
node tools/check-commit-attribution.js --message "<text>"    # a literal message
node tools/check-commit-attribution.js --range A..B          # every commit in a range
node tools/check-commit-attribution.js --base <sha> --head <sha>
node tools/check-commit-attribution.js --selftest            # 35 fixtures
```

### Two layers, one policy

| Layer | Runs | Catches |
|---|---|---|
| `.githooks/commit-msg` (tracked) | locally, at commit time | the violation before it exists — but only in clones that ran the installer |
| `.github/workflows/attribution.yml` → **`verify-attribution`** | on every PR and push to `main` | anything the local layer missed; **cannot be skipped** |

Both layers execute `tools/check-commit-attribution.js`. The rules exist in **one** place — the
workflow does not restate them — so local and CI enforcement cannot drift apart. CI additionally
self-tests the checker before trusting it, and asserts that the tracked hook still delegates to it.

The policy: commits are owner-authored; no `Co-authored-by:` / `Assisted-by:` / `Generated-by:` /
`Authored-by:` / `Created-by:` trailer or "Generated with …" footer may name Claude, Anthropic, Forge,
Atlas, ChatGPT, OpenAI, Codex, Copilot or any other AI agent, and no `@anthropic.com` address may
appear in a trailer. Ordinary prose that merely *mentions* those names is fine — the rules match
machine-readable attribution, not discussion. Genuine human co-authors and Dependabot are permitted
(`CLAUDE.md` §15.7).

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

> **Note.** `ci.yml` runs ten of these harnesses as blocking steps after `verify-build.js` —
> `verify-identity-foundation-runtime.js`, `verify-session-identity-runtime.js`,
> `verify-identity-selection-runtime.js`, `verify-workspace-selfscope-runtime.js`,
> `verify-authz-runtime.js` and, since N1-B, `verify-auth-boot-runtime.js`, `verify-auth-flow-runtime.js` and
> `verify-session-employee-runtime.js`, since AFI-4b1 (D-AFI4b1-2) `verify-session-overtime-runtime.js`, and since AFI-4c1 (D-AFI4c1-2) `verify-session-payroll-runtime.js` — a fixed allowlist of deterministic identity/authorization/SESSION
> harnesses that `verify-build.js` pins (no glob, no failure bypass). The rest of the suite is **not** wired into CI
> (the contract-timeline harness is date-sensitive); run it locally before proposing a change that
> touches behaviour.

### Authorization & identity

| Harness | Proves |
|---|---|
| [`verify-identity-foundation-runtime.js`](verify-identity-foundation-runtime.js) | UX-006A identity seam, CEO + Employee principals, no persistence, fail-closed |
| [`verify-session-identity-runtime.js`](verify-session-identity-runtime.js) | AFI-1 same-origin API client, normalized errors, in-memory CSRF holder, `/api/auth/me` projection, CEO binding, no local fallback (scripted fetch, no network); D-AFI4b1-3: the one `employeeId` target-selector exception on `POST /api/overtime-records/create`, refused on every other route, method and identity key |
| [`verify-auth-boot-runtime.js`](verify-auth-boot-runtime.js) | AFI-2 SESSION-mode boot: explicit auth mode, `/me` classification, login then `/me`, logout, bounded 403 recovery, no local state / shell / "Acting as" in SESSION, LOCAL boot unchanged (in the CI allowlist) |
| [`verify-session-employee-runtime.js`](verify-session-employee-runtime.js) | AFI-4a1 read-only SESSION Employee workspace, AFI-4a2 CEO create / update / archive , the BF-4a3 strict `accountManageable` decoder contract and the AFI-4a3 account-administration matrix, operations, unconfirmed-write reconciliation and email-draft lifecycle (request mirror, exact write bodies, CSRF recovery, ambiguous-write reconciliation without resend, conflicts, Employee containment, draft lifecycle, focus): structured API queries, strict DTO decoders, CEO list / archived / detail and Employee self flows, every error kind, malformed answers, logout / 401 / principal change / late and superseded answers, zero localStorage / sessionStorage access, and no LOCAL boot, shell, "Acting as", local data tool, Global Search or other domain (in the CI allowlist) |
| [`verify-session-payroll-runtime.js`](verify-session-payroll-runtime.js) | AFI-4c1 SESSION Payroll section (CEO only; D-AFI4c1-2 = A: dedicated, the tenth CI harness): strict plan / detail / generate decoders (exact keys, the five BF-4c1 statuses with Committed display-only, exact money and hours strings, the three exclusion reasons), exact `{ month }` / `{ id, expectedVersion }` bodies, money shown verbatim (a deliberately inconsistent total), the month bar and stale month answers, the detail and the control matrix, Prepare payroll with named exclusions and an unnamed-id fallback, transitions confirmed at version + 1, 409 / 404 / ambiguous outcomes re-read and never resent, CSRF recovery, 401 and session uncertainty, logout and principal-change races, the Employee's zero Payroll requests, and the LOCAL / Overtime / Finance / statutory firewalls (deterministic: fetch stub, fixed clock; repeated-run and UTC-12 … UTC+14 proven); AFI-4c2: Commit payroll on Ready only, the exact total and Web Crypto key sent once, the four unknown-outcome cases and the deliberate same-key Retry commit, the neutral 409, the drift decoder and display, the Employee's My payroll of their own Committed plans only, and the store's guards (injectable deterministic crypto) |
| [`verify-session-overtime-runtime.js`](verify-session-overtime-runtime.js) | AFI-4b1 + AFI-4b2 SESSION Overtime section (AFI-4b2, D-AFI4b2-2 = A: extended here, sections S–Z — strict valuation decoding, the CEO preview and approval of exactly that preview, every approve 409 reconciled by reading with a new deliberate approval, ambiguous approvals never resent, stale valuation answers, the Employee disclosure boundary and zero valuation requests for an Employee's non-Approved records; the DOM firewall admits money and approval only inside the BF-4b2 disclosure). AFI-4b1: strict Overtime DTO decoder and request encoders, the month helper with an injected clock, CEO owner labels from the canonical Employee list (D-AFI4b1-1), Employee own-only records, the D-BF4b-5 control matrix, create / edit / delete / submit / review / reject with exact bodies and `expectedVersion`, 400 / 403 / 404 / 409, CSRF recovery, 401 and session uncertainty, every ambiguous write reconciled without resend, stale list / detail / labels / write answers, logout and principal change, focus, and zero storage, URL, LOCAL Overtime, shell or money (deterministic: fetch stub, virtual timers, fixed clock; in the CI allowlist) |
| [`verify-auth-flow-runtime.js`](verify-auth-flow-runtime.js) | AFI-3 credential flows: strict `#recovery=` / `#activation=` parsing and immediate stripping, activation, recovery request (enumeration-safe), reset, error mapping, token and password never stored, no local state / shell / "Acting as", LOCAL ignores the fragment (in the CI allowlist) |
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

- **Never hand-edit generated output or a frozen release.** Rebuild the package (`CLAUDE.md` §10.4).
- **Never hardcode a version** in tooling — derive it from `app-version.js` (`CLAUDE.md` §10.1).
- **If you add or move a JS module**, update `module-order.js` **and** `index.html` together
  (`CLAUDE.md` §4.2).
- **Fail loudly.** Build and verify tooling throws clearly on bad input; it never degrades silently.
