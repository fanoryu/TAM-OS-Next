# QA Checklist — TAM Intelligence OS

Run this checklist against **both** the modular source (`index.html`) and the portable build
(`dist/tam-os-v<APP_VERSION>.html`) before every release. Use fabricated placeholder
data — never real company data.

## Environments
- [ ] Modular source boots (served over HTTP), sidebar mounts, correct version in title/footer
- [ ] Portable dist boots (opened directly), sidebar mounts, correct version
- [ ] **Zero browser console errors** in both

## Build & verify
- [ ] `node tools/build-single-file.js` succeeds; dist filename = `...-v<APP_VERSION>.html`
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

## Data-safety confirmations
- [ ] `SCHEMA_VERSION` unchanged (6) unless an intentional, documented migration
- [ ] Storage keys and migration flags unchanged
- [ ] Backup format unchanged
- [ ] No real company/employee/payroll/bank/backup data committed

## Honesty of results
Record each item as one of: **browser-tested**, **automated-test verified**, **source-inspected**,
or **unable to verify** — never present an assumption as a completed validation.
