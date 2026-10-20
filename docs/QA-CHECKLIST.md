# QA Checklist — TAM Intelligence OS

Run this checklist against the **deployment package** built by `node tools/build-package.js` and
served by `node tools/serve-package.js` (the production header contract, CSP included) before every
release. Use fabricated placeholder data — never real company data.

## Environments
- [ ] Served package boots over HTTP, sidebar mounts, correct version in title/footer
- [ ] **Zero browser console errors** and **zero Content-Security-Policy violations**
- [ ] SheetJS loads from `vendor/` (same-origin); fonts render; no third-party network request

## Build & verify
- [ ] `node tools/build-package.js` succeeds; ZIP = `tam-os-v<APP_VERSION>-package.zip`; rebuilding
      leaves `dist/package-manifest.json` unchanged
- [ ] `node tools/verify-build.js` passes (all checks)
- [ ] PowerShell fallback derives the same version (optional)

## Core pages render (no errors, non-empty)
- [ ] Executive Dashboard, Finance Overview, Execution Center, Transactions, Cash Flow, Budget Center
- [ ] Employees, Employee Detail, Contracts, Contract Detail
- [ ] Payroll Workspace, Payroll Detail, Overtime, Monthly Plan Generator
- [ ] Reports, Activity Log, Settings, About, Release Notes

## Workflows
- [ ] **Employees / Contracts:** create, edit, detail view, delete guarded by linked records
- [ ] **Payroll:** generate → review → approve → post → execute; total = base + approved overtime
- [ ] **Overtime:** create → approve → flows into a Draft plan; precision preserved
- [ ] **Execution Center:** execute / partial / schedule / cancel; status transitions correct
- [ ] **Smart Import:** import the workbook; review; commit; **duplicate prevention** on re-import
- [ ] **Employee Deduplication:** detect, merge, relink records, safety backup + audit
- [ ] **Activity Log:** records payroll/overtime/finance/import events; filters + CSV work
- [ ] **Company Settings:** save persists; onboarding "Configure company settings" completes
- [ ] **Backup / Restore:** Complete Backup export; restore round-trips; safety backup created
- [ ] **Export CSV:** Transactions, Employees, Contracts, Payroll, Activity produce valid files

## UI / robustness
- [ ] **Themes:** Dark / Light / System all apply correctly
- [ ] **Responsive:** no horizontal page overflow at ~1050px and ~860px (125% / 150% zoom)
- [ ] Wide tables scroll inside their own container, not the page
- [ ] **Floating action menus:** portal to `#menu-root`, `position:fixed`, close on outside click / Escape
- [ ] **Search:** typing keeps focus (no focus loss); filters correctly
- [ ] **Scroll:** Smart Import selection does not jump the list; scroll preserved on incremental updates
- [ ] **Keyboard:** forms submit; Escape closes menus/modals; tab order is usable
- [ ] **Data persistence:** reload preserves data (localStorage / Claude Artifact storage)
- [ ] **No duplicate records** produced by any repeated action
- [ ] **Memory/leak sanity:** repeated navigation leaves `#menu-root` / `#modal-root` empty; single sidebar

## SESSION mode (test-only servers)
Run against `node tools/serve-auth-stub.js` (fabricated stub) and, when authorized, `node tools/serve-e2e-proxy.js` over a
disposable local PHP + MariaDB backend — never a production backend or real data.
- [ ] **Audit (AFI-4g):** the CEO's Audit section opens on the current Asia/Jakarta month; an event shows WIB and UTC; record
      history opens from an event; empty, 403, 500 (with the informational 2,000-event note), 503 and malformed answers are
      shown as such; an Employee has no Audit section; a 401 signs out; zero console errors other than the browser's own
      network-status lines for deliberately failed requests, and zero CSP violations

## LOCAL development persona (test-only server, AFI-5a)
Run against `node tools/serve-local-dev.js --as ceo` and `--as employee` after `node tools/build-package.js`, with
fabricated data only; clear the dev origin's site data afterwards. The shipped package is unchanged.
- [ ] **Persona (AFI-5a):** the "DEVELOPMENT — LOCAL DATA — NOT AUTHENTICATED" banner is shown; `--as ceo` gives the
      Executive workspace, `--as employee` the Personal workspace (no linked record → no workspace, never company-wide);
      the "Acting as" control cannot replace the dev persona; `node tools/serve-package.js` still shows today's
      "Acting as" with no persona selected; zero console errors and zero CSP violations in both

## Identity transition (AFI-5b — unmerged candidate only; merge on HOLD)
Applies only to the `feature/afi-5b-identity-transition` candidate (SESSION shipped, "Acting as" removed). Fabricated
data only; clear each test origin's site data afterwards. None of this is production evidence: SDR-0002 §22 items 1
and 8 need the production host.
- [ ] **SESSION (auth stub):** `node tools/serve-auth-stub.js` boots to the sign-in view; sign-in → the SESSION
      workspace, sign-out → signed-out view; no selector, `LocalIdentityProvider` or `.sidebar` anywhere; `localStorage`
      and `sessionStorage` stay empty; no script error or CSP violation (the `/api/auth/me` 401 network log is expected)
- [ ] **LOCAL (dev server):** `--as ceo` / `--as employee` mount the shell with the development banner and no selector
      or `identity-*` node; expanded, collapsed rail, hover-peek and the narrow drawer render without the selector and
      without horizontal scroll; zero console messages
- [ ] **Runtime and verifier:** `verify-build.js` passes; the 13 CI harnesses pass in UTC−12, UTC, UTC+7 and UTC+14;
      every one of the 43 harnesses passes; the H-1, H-2, D-02/R-2, T4, R-3 and CI six-case mutants are each killed

## Data-safety confirmations
- [ ] `SCHEMA_VERSION` unchanged (6) unless an intentional, documented migration
- [ ] Storage keys and migration flags unchanged
- [ ] Backup format unchanged
- [ ] No real company/employee/payroll/bank/backup data committed

## Honesty of results
Record each item as one of: **browser-tested**, **automated-test verified**, **source-inspected**,
or **unable to verify** — never present an assumption as a completed validation.
