# Changelog

## 2.10.0 — Governed Workspace

**Type:** Feature/minor release completing the **UX-006** authorization / personal-workspace line and the
**Readiness-1 / Readiness-2** programme. Authorization, read-scope and presentation changes only — **no**
change to payroll, overtime, contract, finance, execution, approval, posting, import or export
*calculations*; **no** schema, storage-key, persisted-data or migration change (`SCHEMA_VERSION` stays
**6**); no historical record is rewritten. **Published** from annotated tag `v2.10.0` and marked Latest;
it is the package approved for a controlled internal pilot, which has **not launched**.

### Added
- **Complete mutation authorization (UX-006C / UX-006C2 / UX-006C2C)** — every operational mutation
  across Finance, Payroll, Overtime, Contract, HR, Import and the data lifecycle resolves through one
  frozen capability set of **20 actions**. Enforcement is at the action boundary; the disabled control is
  an affordance only, so bypassing it grants nothing.
- **Employee self-only read scope (Readiness-1)** — employee rosters, pickers, worksheets, duplicate
  review, settings diagnostics and Global Search are scoped at the read boundary, including against
  direct deep links. Canonical `State` is never narrowed; scoped results are defensive copies.
- **Principal & workspace presentation (UX-006D1 / D2 / D3)** — "Acting as" selector, collapsed-rail
  identity chip, explicit workspace label, and honest null-workspace presentation that distinguishes
  "nobody is acting yet" from "acting, but no linked employee record".
- **C3 integration freeze (UX-006C3)** — availability derived per render from the frozen `can()`; never
  cached, never persisted, never applied to navigation.
- **End-to-end acceptance harness (Readiness-2)** — eight user journeys driven through the real
  production seams and asserted against the persisted result.

### Changed
- **First-boot guidance** — the no-principal helper line now names the cause of the empty workspace and
  the single action that resolves it. Presentation only: the fail-closed null principal is unchanged,
  no principal is defaulted, selected or persisted, and there is no automatic CEO.
- **Release identity** — `APP_VERSION` `2.9.0` → `2.10.0`; `APP_RELEASE_NAME` → `Governed Workspace`;
  release artifact `dist/tam-os-v2.10.0.html` replaces `dist/tam-os-v2.9.0.html` under the standing
  release dist-swap invariant (the published v2.9.0 GitHub Release asset is untouched).

### Fixed
- **Employee identity disclosure** — rosters and employee pickers disclosed foreign employee identities
  to an Employee principal; closed at the read boundary (Readiness-1).
- **Global Search privacy scoping** — search could surface records outside the acting principal's read
  scope; results are now scoped.

### Known limitations
- Acting-as identity is a **local, trust-based application context, not authentication**, and is not a
  security boundary against local access.
- `.xlsx` import depends on a CDN-hosted, integrity-pinned parser and does not work offline; `.csv`
  import is unaffected.
- Disabled-control reasons are exposed via the native `title` tooltip — reliable with a mouse, not on
  touch. Accepted for a desktop-only pilot; broader polish deferred post-pilot.

## 2.9.0 — Workspace Experience

**Type:** Feature/minor release completing the **UX-005** workspace line plus the **MAINT-001**
repository/branding follow-up. Presentation, navigation, query-state and repository-surface changes
only — **no** business-logic, calculation, finance, payroll, overtime, contract, execution, import or
export change; **no** schema, storage-key, persisted-data or migration change (`SCHEMA_VERSION` stays
**6**); no historical record is rewritten. Not included: authentication, roles/permissions, Personal
Workspace, or any backend — those remain future roadmap work (UX-006 onward).

### Added
- **Global Search (UX-005D)** — a navigation-only `Ctrl/Cmd+K` command palette over a pure,
  source-agnostic engine returning Navigation, Employee, Contract and Payroll results; activation is
  navigation only, and the engine only ranks the document set it is handed (scope-safe for future work).
- **Data Grid Foundation (UX-005B)** — a reusable grid (single-column sorting, pagination 20/50/100,
  debounced search, live result counts, filtered-empty states, declarative feature flags) adopted by
  Transactions and Employees; source records are never reordered or mutated.
- **TAM OS branding assets (MAINT-001)** — official branding, a self-contained inline favicon, README
  product-preview screenshots, and a repository social-preview asset.

### Changed
- **Executive Dashboard & Finance hierarchy (UX-005A)** — dashboard consolidation with a navigation-only
  Action Center; Finance Overview recast as the operational finance workspace; a single owner for Net
  Cash Flow.
- **Design-system consistency (UX-005C)** — canonical spacing/rhythm, numeric (tabular) typography, and
  navigation glyph disambiguation from shared tokens.
- **Responsive modal behaviour (UX-005E)** — the shared modal surface stays inside the viewport and
  scrolls internally on short/mobile screens; table density preserved.
- **Repository presentation (MAINT-001)** — README Product Preview, documentation cleanup, legacy
  migration-tool review.

### Accessibility (UX-005F)
- Skip to main content link and a real `<main>` landmark.
- Modal Tab/Shift+Tab keyboard focus containment; correct dialog semantics on the finance transaction
  dialogs; opener focus restoration unchanged.
- Broader visible-focus (`:focus-visible`) coverage; decorative navigation glyphs hidden from assistive
  technology; Data Grid `aria-sort` moved onto the column-header cell.

### Maintenance
- Legacy migration-tooling review and repository/documentation cleanup (MAINT-001); official branding
  adoption and favicon/social-preview integration.

## 2.8.6 — Navigation Experience & TAM OS Rebrand

**Type:** Navigation, presentation, naming and release-packaging release. It packages the complete
UX-004 navigation modernization (UX-004B–UX-004F) plus the sidebar interaction hotfix and the TAM OS
rebrand. **No** business-logic, schema, storage-key, persisted-data, or persistence-mechanics change
(still 15 keys, `SCHEMA_VERSION` 6); no migration added or re-run; no historical record is rewritten.
UX-005 is **not** included. Starting with this release the portable artifact uses the TAM OS naming
convention `dist/tam-os-v<version>.html`; the historical `tam-intelligence-os-v2.8.5.html` asset and
older filenames remain immutable in Git history and their published Releases.

### Added
- **Five-domain navigation (UX-004C)** — Dashboard, People, Finance, Analytics, System — over the
  UX-004B foundation: a persistent shell mounted once, canonical navigation ownership, hierarchical
  active state, and a single primary-navigation landmark.
- **Breadcrumbs (UX-004D)** derived from the canonical navigation architecture (Domain / Item / Context)
  in their own semantic Breadcrumb landmark, with entity-aware terminal labels and no id leaks.
- **Context-aware Quick Actions (UX-004D)** — navigation-only deep links, including a Payroll/Overtime →
  Execution Center friction reduction. They never execute, approve or post anything, and cannot bypass
  Review/Approval/Posting/Execution.
- **Sidebar interaction (UX-004E)** — collapse to an icon rail, session-only pin (expanded/collapsed),
  desktop hover-expand, and a responsive overlay drawer (hamburger, backdrop, Escape-to-close, focus
  trap, focus restoration). All session-only; no persistence.
- **Navigation simplification (UX-004F)** — Finance shows four primary items (Overview, Payroll,
  Transactions, Planning); every other Finance destination lives under a **More** progressive-disclosure
  control (session-only, auto-opens for an active secondary destination).

### Changed
- **Product identity is now TAM OS (UX-004F).** Sidebar wordmark, browser title (`TAM OS v2.8.6`),
  About and Settings read TAM OS; the GitHub repository is now `fanoryu/TAM-OS`, and current-state
  documentation and links were reconciled. Historical releases retain the `TAM Intelligence OS` name and
  the `TAM-Intelligence-OS` repository slug where accurate at the time.
- **Simplified navigation labels (UX-004F):** Finance Overview → Overview, Payroll Workspace → Payroll,
  Monthly Plan Generator → Planning, Supplemental Payments → Supplements, Add / Upload → Import,
  Execution Center → Execution, Recurring Expenses → Recurring — presentation labels only; no view/route/
  id/storage/entity rename.
- **Numeric typography (UX-004D):** business-number surfaces use the primary UI font with tabular
  numerals — presentation only; formatters, rounding, currency rules, CSV/Excel/PDF output unchanged.
- **Quieter Soon placeholder tag (UX-004F).** Placeholder destinations (Projects, Vendors, Financial
  Calendar) are preserved; only the badge's visual weight was reduced.

### Fixed
- **Sidebar active-section interaction regression (hotfix).** Clicking a group header, or the Finance
  **More** control, while its own section held the active view silently flipped hidden session state and
  armed a surprising collapse/disclosure on the next navigation. Those clicks are now clean no-ops; the
  active section still stays open by design (verifier-enforced invariant), and every non-active toggle
  works normally.

### Verification
- Verifier and Node runtime harnesses over the modular source and the portable artifact, plus browser
  validation (dark/light across desktop and responsive widths). Deterministic build: the same source
  yields a byte-identical `dist/tam-os-v2.8.6.html`. CSS golden master unchanged from v2.8.5.

### Known limitations
- Carried forward from v2.8.5 and unchanged by this release: compound Payroll posting
  (`commitReadyPayroll`) writes multiple storage keys sequentially and remains non-atomic (residual
  states are detected by Integrity Check, not auto-repaired); Contract Core editor routing (ADR-014
  step 2) stays blocked on OQ-2. This release introduces no new known issue.

### Upgrade / storage
- **`SCHEMA_VERSION` remains 6.** No migration, no storage-key add/remove/rename, no change to how or
  when data is written. A Complete Backup exported from v2.8.5 restores into v2.8.6 unchanged, and
  existing persisted data remains compatible. Payroll/contract/finance business semantics are unchanged.

## 2.8.5 — Workspace & Contract Timeline Integrity

**Type:** Presentation, shell-architecture and derived-calculation release packaging the merged
UX-002A, UX-002B, UX-003A, UX-003B and UX-003C sprints plus the UX-001–UX-003 documentation
reconciliation. **No** schema, storage-key, persisted-data, or persistence-mechanics change (still 15
keys, `SCHEMA_VERSION` 6); no migration added or re-run; no historical record is rewritten.

> **UX-001 was discovery only.** The minimal enterprise-workspace direction, the reduced "AI dashboard"
> presentation, and the typography/density emphasis are recorded as *product direction*. The sidebar and
> navigation work it identified was deferred to UX-004 and is **not** in this release.

### Added
- **Persistent application shell (UX-002A).** The shell mounts once; view navigation updates the view
  content only and no longer rebuilds the shell. Sidebar and navigation DOM node identity now persists
  across navigation. Structural regression checks were added to hold this.
- **Shared token scales (UX-002B).** Spacing, corner-radius and type token scales, applied across the UI
  chrome, with the CSS golden master pinned by digest rather than reconstruction.
- **Canonical contract timeline model (UX-003B).** One classifier returns two *independent* derived
  dimensions:
  - **Effective state** — `Draft`, `Cancelled`, `Renewed`, `Scheduled`, `Active`, `Expired`.
  - **Expiry horizon** — `EndingToday`, `EndingThisWeek`, `EndingThisMonth`, `EndingNextMonth`,
    `WithinWarningWindow`, `None`.

  An `Active` contract stays `Active` while carrying a horizon; the two dimensions never collapse into
  one another. `Scheduled` is derived-only and is never stored. The calendar horizons are calendar
  facts and do not depend on the configured warning-days setting. `Expiring Soon` is retained as a
  compatibility alias.
- **One canonical contract-counter helper (UX-003C).** Every contract counter resolves through it.

### Changed
- **UI chrome typography and density (UX-002B).** A sans-serif UI typeface and the token scales above.
- **Chart colours are theme tokens (UX-002B).** Chart colours are drawn from the theme tokens, and the
  light-theme chart colours were corrected.
- **Executive Dashboard reduced from 20 to 13 metric containers (UX-002B).** The alert list is capped
  while every alert remains reachable.
- **Contract counter membership (UX-003C).** `Active` includes active contracts that carry an expiry
  horizon; `Scheduled` and `Expired` are excluded from `Active`. The ending-soon set is a strict
  **subset** of `Active`. The `Active` and `Scheduled` filters are consistent with the badges.
- **Contract wording priority (UX-003C)** is fixed and ordered: **Ends Today** → **Ends This Week** →
  **Final Month** → **Ends Next Month** → **Ending Soon**.
- **CSV Status uses the presentation vocabulary (UX-003C)**, so the export reads as the screen does.

### Fixed
- **Contract timeline reference-date correctness (UX-003A).** `daysUntilEnd` now shares the one
  normalized reference date used by the rest of `contractCalc`. Today-facing behaviour is preserved;
  advisory output computed for a historical date is now correct. No payroll, committed payroll,
  monthly-plan, storage, schema or contract value changed.
- **Contract progress wording (UX-003C).** On a three-month contract: month 1 = `1/3`, 2 months
  remaining; month 2 = `2/3`, 1 month remaining; month 3 = `3/3`, final month, 0 months remaining; the
  following month = `Expired`. **`3/3` never means one month remaining.** The bare "N remaining" figures
  on the contract detail and employee detail surfaces were replaced by the canonical wording helper.

### Verification
- Static verifier: **1713 checks** (up from 1700 — the v2.8.4 version pin was retargeted to v2.8.5, and
  **13** checks were added: 12 release-identity guardrails plus one whole-artifact fidelity check. No
  existing check was weakened or removed.)
- Runtime harnesses: **eleven**, **1333 checks**, unchanged — contract timeline **349**. No runtime
  assertion was added, because no business, payroll, contract, storage or UI behaviour changed in the
  release sprint itself.
- The portable build is deterministic: two clean builds are byte-identical.

### Known limitations
- **UX-004 — Sidebar & Navigation is not in this release.** No context-aware sidebar, no breadcrumb or
  quick-action system, no collapsed/pinned/hover-expand rail.
- **UX-005 — Responsive/Mobile Refinement is not in this release.** No mobile drawer.
- **OQ-2 and OQ-3 remain OPEN.** Contract editor routing (ADR-014 step 2) stays blocked on OQ-2. No
  contract-editor authority migration and no deletion-command migration occurred.
- UX-001 remains discovery only; nothing from it shipped as implementation beyond what UX-002/UX-003
  delivered.

### Upgrade / storage
- **No data migration is required.** `SCHEMA_VERSION` remains **6** and no migration runs on upgrade.
- No storage key is added, removed, or renamed (still 15 keys).
- **Existing backups remain compatible.** A Complete Backup exported from v2.8.4 restores in v2.8.5, and
  a v2.8.5 export retains the same schema contract.
- **Payroll and committed-payroll semantics are unchanged.** Committed payroll remains immutable and
  byte-identical across the upgrade.

## 2.8.4 — Monthly Plan Result Integrity

**Type:** Correctness patch (SPR-082). **No** schema, storage-key, persisted-data, or
persistence-mechanics change (still 15 keys, `SCHEMA_VERSION` 6); no migration added or re-run; no
historical record is rewritten.

> **No atomicity or rollback was introduced.** The Monthly Plan commit still writes two storage keys
> sequentially — transactions, then monthly plans — and the browser is atomic per key only, so a failure
> means the commit did not complete — not that nothing was written. No rollback, compensating action, or
> transaction abstraction exists.

### Changed
- `commitMonthlyPlan` captures and strictly inspects both persistence results (finance transactions,
  then monthly plans). It previously awaited both writes and discarded both results, marking the plan
  committed and reporting success without looking at either. Success now requires both. Failure returns
  a typed `MonthlyPlanPersistenceFailed` outcome naming the first failed step in the fixed write order,
  every failed step, the steps that completed, whether partial persistence occurred, and a
  `RunIntegrityCheckAndReview` recovery hint.
- The write order and attempt-all behaviour are unchanged — transactions are still written first, and a
  failing first write still does not abort the second — so the failure matrix is unchanged.
- Success behaviour is gated on complete persistence. The commit handler inspects the result before any
  completion behaviour; the success toast runs on the success path only.
- The persistence-failure branch retains the preview, so the rows the user was committing stay on screen
  while they are told to review the data manually. Clearing the preview was completion behaviour that
  discarded exactly the context needed for that review.
- The failure message states that the commit did not complete and that some data may already have been
  saved, and directs the user to run Integrity Check and review the Monthly Plan and Finance transaction
  before retrying. It never claims a rollback. The harness asserts no user-facing message in the module
  claims rollback, compensation, or that nothing was saved.

### Added
- Integrity Check rule: `monthlyplan-orphan-transaction` reported as **Critical** — a non-payroll Finance
  transaction carrying a `monthlyPlanId` whose referenced monthly plan is **absent entirely**, or which
  **exists but does not list the transaction** in `committedTxnIds`. Both broken-linkage directions fire
  the rule. Payroll-sourced transactions stay out of scope and remain owned by
  `payroll-orphan-transaction` and `payroll-missing-monthlyplan`. `corrupt-plan-ref` is unchanged and
  still covers the opposite direction (dangling `committedTxnIds`), which it could see and the new rule
  cannot, and vice versa.
- `tools/verify-monthlyplan-runtime.js` (118 checks) — all-succeed; each of the two writes failing; both
  partial states rebuilt from only the keys that actually persisted, through the app's own `loadState()`,
  so retry is a genuine reload path; and proof that the slice introduces no snapshot, restore, unit of
  work, coordinator, journal, or schema change.

### Known limitations
- The commit remains **non-atomic**: two sequential writes, no rollback, no compensation. Checking
  results makes failure visible; it does not make the commit all-or-nothing.
- Integrity Check **detects but does not repair**. The new finding reports that a partial state exists
  and where — it does not fix it and does not block the underlying operation.
- **Retry prevents duplicate transaction creation but does not repair linkage.** Two residual states
  remain, both reload-state proven, and both requiring **manual review**:
  - **Scenario A2** (the plan was created by the failing commit; only the transactions write landed) —
    the retry creates no duplicate transaction, but the reloaded rows are skipped as duplicates and are
    therefore never linked to the newly created plan, so `monthlyplan-orphan-transaction` **remains**
    after a successful retry.
  - **Scenario B** (only the monthly plans write landed) — the retry creates the missing transaction
    under a new id, but the stale dangling `committedTxnIds` are never removed, so `corrupt-plan-ref`
    **remains** and the commit **reports success while that finding still stands**.

## 2.8.3 — Payroll Posting Integrity

**Type:** Correctness patch (SPR-081). **No** schema, storage-key, persisted-data, or
persistence-mechanics change (still 15 keys, `SCHEMA_VERSION` 6); no migration added or re-run; no
historical record is rewritten.

> **No atomicity or rollback was introduced.** Payroll posting still writes four storage keys
> sequentially and the browser is atomic per key only, so a failure means the posting did not complete —
> not that nothing was written. No rollback or compensating action exists.

### Changed
- `commitReadyPayroll` captures and strictly inspects all four persistence results (payroll plans,
  monthly plan, overtime, finance transactions). Success requires all four. Failure returns a typed
  outcome naming the first failed step in the fixed write order, the completed steps, and that partial
  persistence occurred. The write order and write mechanics are unchanged.
- No success audit entry is written after a failed posting.
- The workspace Post handler inspects the result before any completion behaviour. `sel.clear()` and
  `closeModal()` previously ran on the same line as the posting call; the success toast, the
  posted-vs-skipped summary, and the selection clear are now on the success path only.
- The persistence-failure branch retains the selection, so the same rows stay checked after the
  re-render and the user can see what was involved while being told to review manually. It closes the
  modal explicitly because `render()` rebuilds the workspace beneath it. The locked branch is unchanged
  and still emits exactly one warning.
- `payrollTxnOf()` keeps its forward lookup and gains a narrow reverse fallback — payroll-sourced only,
  exact `payrollPlanId`, exact period. Previously, when the payroll-plans write failed and the
  transactions write succeeded, a reload left a real transaction that forward lookup could not resolve,
  so a retry created a **second** transaction and doubled the payroll (measured: 1,020,000 became
  2,040,000) with no integrity finding beforehand. A reverse-matched transaction now has its forward
  linkage restored with a `transaction-relinked` history entry instead of being duplicated.
- `resolvePayrollTxn()` distinguishes resolved / none / ambiguous so a caller that may **create** a
  transaction can never mistake ambiguity for absence. `commitReadyPayroll` resolves before mutating, so
  an ambiguous row is skipped uncommitted with a `PayrollTransactionAmbiguous` reason listing every
  candidate. It never guesses and never adds a third transaction.

### Added
- Integrity Check rule: orphan Payroll transactions reported as **Critical** — a payroll-sourced Finance
  transaction whose linked payroll plan is not committed.
- Integrity Check rule: committed Payroll whose linked Overtime is still Approved reported as
  **Critical**. When the overtime write failed after the plan and transaction writes landed, that
  overtime stayed Approved and was runtime-proven to be re-included in the next month's generated
  payroll. No rule previously detected it.
- `tools/verify-payroll-posting-runtime.js` (106 checks) — all-succeed; each of the four writes failing;
  the orphan-retry scenario proven not to duplicate; the overtime-still-Approved scenario proven
  detected; ambiguous resolution proven to skip rather than guess; and workspace-caller coverage proving
  failure retains the selection and emits only the manual-review error while success preserves the full
  completion UX. Branch ordering is proven by index.

### Known limitations
- Posting remains **non-atomic**: four sequential writes, no rollback, no compensation. Checking results
  makes failure visible; it does not make posting all-or-nothing.
- Integrity Check **detects but does not repair**. The two new findings report that a partial state
  exists and where — they do not fix it.
- **Not every possible Payroll partial state is automatically repairable.** The two failure modes closed
  here are those proven by SPR-080 discovery; this release does not claim to detect or remediate every
  combination of the four writes failing. Manual review may still be required after partial persistence.

## 2.8.2 — Honest Persistence Results

**Type:** Correctness patch (SPR-079). **No** schema, storage-key, persisted-data, or
persistence-mechanics change (still 15 keys, `SCHEMA_VERSION` 6); no migration added or re-run; no
historical record is rewritten.

> **No atomicity or rollback was introduced.** Multi-dataset saves write one storage key per dataset and
> the browser is atomic per key only, so a failure means the operation did not complete — not that
> nothing was written.

### Changed
- `saveAllData()` inspects every one of its 14 write results and returns success only when all succeeded.
  It previously discarded every result and returned `true` unconditionally, so callers reported success
  after failed writes. The strict boolean contract is unchanged; failing dataset names go to the console.
- Employee merge returns a typed result. A failed save shows a clear message instead of a merge
  confirmation, clears no completion state, and preserves the pre-merge safety backup.
- Smart Import commit writes its `import.commit` audit entry only after a successful save. On failure the
  wizard stays on the review step with the parsed model intact, does not navigate to the results screen,
  and shows no success message.
- Smart Import undo clears its completion marker (`undone`, `undoneAt`, `keptTxns`) when the save fails.
  Because that marker is also the batch selector, leaving it set previously blocked every further attempt
  for the rest of the session. Clearing it restores an honest in-memory state and allows an immediate
  retry. Only the marker is cleared — record removals stay applied and nothing is rolled back.
- Failure messages state that the operation did not complete. Reloading reads whatever data was
  successfully persisted; partial saves may still require manual review or restoration from the
  pre-operation backup. The verifier asserts that no failure message claims a rollback.

### Added
- `tools/verify-savealldata-runtime.js` (61 checks) — exercises all-succeed, first/middle/final/multiple
  write failures, a throwing write, each caller's success and failure behaviour, backup survival, undo
  marker clearing, immediate retry, and retry after reload. It asserts partial persistence is real rather
  than hidden.

### Known limitation
- Payroll posting is **unchanged**: four sequential writes, results still unchecked, no coordinated
  rollback. A failed write can leave a period partially posted and needing manual review. Nothing in
  Payroll posting was fixed in this release; discovery is complete (SPR-080) and the corrective sprint
  follows separately.

## 2.8.1 — Single Payroll Posting Authority

**Type:** Correctness release (SPR-077 + SPR-078). **No** schema, storage-key, persisted-data, or
persistence-mechanics change (still 15 keys, `SCHEMA_VERSION` 6); no migration added or re-run; no
historical record is rewritten.

> `2.8.0` ("Aggregate-Owned Contract Renewal") was merged to `main` but never tagged or published. Its
> content is included here.

### Added
- `ContractRenewalAggregate` — eighth aggregate boundary, third Contract boundary. A pure decision
  boundary: it decides renewal eligibility and authors the successor's business shape, the predecessor's
  canonical `Renewed` status, and both history note texts. It never mutates, generates ids/timestamps, or
  persists.
- `contract.renewal.execute` — one operational command; no Domain facade change.
- `renewContract` handler and `requestContractRenewal` UI seam — the handler owns id, timestamps, the
  history append, one `ContractRepository.save()`, strict result inspection, in-memory rollback, and the
  typed result.
- `isPayrollCommitted()` in `js/people/people-core.js` — one canonical committed-state predicate.
  Canonical `'Committed'`; the legacy lowercase value is accepted for reads only.
- Runtime harnesses `tools/verify-renewal-runtime.js` (67 checks) and
  `tools/verify-payroll-committed-runtime.js` (72 checks).

### Changed
- Contract renewal reports success only when the write succeeds. The result of `persistContracts()` was
  previously discarded, so a failed save still closed the modal, showed "Contract renewed", and navigated
  to the successor while nothing had been stored. A failed save now fully restores `State.contracts`,
  keeps the modal open, and reports that nothing changed.
- Renew is offered only from the non-terminal statuses (`Draft`, `Active`). Renewing an already `Renewed`
  contract previously overwrote `renewedToId` and orphaned the first successor. Expired contracts remain
  renewable (`Expired` is derived; the stored status stays `Active`).
- Legacy Payroll Planning retired. The screen had been unreachable since v2.5.0; its posting function was
  dead code and a divergent authority that bypassed the period lock, commit blockers, and Approved gate,
  wrote no audit entry, never set `committedAt`, and wrote a status value outside `PAYROLL_STATUSES`.
  `commitReadyPayroll` is now the sole live Payroll posting path.
- All fourteen live committed-payroll reads now use the shared predicate, so payroll committed through
  the retired path is recognised in reports, Integrity Check, and stage display instead of showing as
  "Draft".
- The contract-cancellation warning fires again. It previously checked only the legacy value and so never
  appeared for payroll posted through the Payroll Workspace.
- Governance: `ARCHITECTURE.md`, `AI_CONTEXT.md`, and the ARCH-007 backlog entry corrected. Accepted
  decision records (ADR-013, DPR-009, ECR-001) left immutable per `CLAUDE.md` §18.
- `APP_VERSION` → `2.8.1`, `APP_RELEASE_NAME` → "Single Payroll Posting Authority".

### Removed
- Dead legacy Payroll Planning surface: `commitPayroll`, `renderPayrollPlanning`, `renderPayrollDraft`,
  `payrollRowHTML`, `generatePayrollRows`, `buildPayrollTxn`, `payrollAmount`, `samePayrollComponents` —
  none had an external consumer. `js/people/payroll-planning.js` is retained for `num()` and
  `ensureMonthlyPlan()`, which are defined nowhere else.

### Known limitation
- Persistence mechanics are unchanged and remain non-atomic: `commitReadyPayroll` still writes four
  stores sequentially and discards their results. No cross-key atomicity is claimed. This is the open
  compound-persistence question recorded in ATR-011.

## 2.7.3 — Supplemental-Aware Payroll History

**Type:** Reporting/presentation patch. **No** persistence, finance, schema, or storage-key change
(still 15 keys, `SCHEMA_VERSION` 6); no historical record is rewritten.

### Added
- `payrollTotalCompensation(pp)` — a read-only aggregate over the immutable `payrollHistoricalSnapshot()`
  plus committed supplementals. Total Compensation = Base Payroll + Payroll Overtime + committed
  (Posted/Executed) supplementals; `baseTotal` is never redefined.

### Changed
- Employee Detail → Payroll History columns are now Base Payroll · Payroll OT · Supplemental · Total
  Compensation · Stage, with a document count and a subtle Pending figure (Draft/Review/Approved,
  excluded from the total; Cancelled ignored).
- Integrity Check distinguishes a legacy (pre-v2.7.1) missing source snapshot (info, display-only) from
  one approved under v2.7.1+ that is genuinely missing (warning). Verifier: **188** checks.

## 2.7.2 — Persistence & Transactional Integrity

**Type:** Persistence/transactional-integrity fix. **No** new storage key (still 15) and **no**
`SCHEMA_VERSION` change (still 6); no committed payroll/finance amount or historical record is rewritten.

### Fixed
- Critical: `persistHR()` did not return its boolean, so Supplemental posting always took the failure
  path — rolling the finance transaction out of storage while the supplemental stayed Posted, leaving an
  orphaned supplemental after reload. Persistence helpers now return a strict `true`/`false`.
- High: Complete Backup restore ignored write results; it is now transaction-safe (validate → snapshot →
  checked writes → in-memory + storage rollback → `{ok}`).
- Medium: transaction execution ignored persistence failure; it now snapshots, checks the write, rolls
  back on failure, and only then writes the audit event / closes a linked supplemental.

### Added
- Startup recovery for the specific failed-post orphan supplemental (restored to a re-postable Approved
  state with an audit entry; no monetary value altered). Verifier: **181** checks.

## 2.7.1 — Payroll Integrity & Reporting Foundation

**Type:** Post-release integrity fix. **No** new storage key (still 15) and **no** `SCHEMA_VERSION`
change (still 6). No historical payroll or finance amount is auto-repaired.

### Fixed
- Posted/Executed payroll could display a plan total (e.g. Rp7,000,000, 0 overtime) that disagreed
  with its immutable committed transaction (e.g. Rp8,750,000). Every payroll consumer read live
  plan values instead of the committed transaction snapshot.

### Added
- `payrollHistoricalSnapshot(pp)` — one centralized stage-aware source-of-truth view model.
  Draft/Review/Approved show working-plan values; Posted/Executed derive from committed evidence in
  priority order (explicit committed snapshot → immutable linked transaction → committed plan fields →
  legacy fallback), returning `{baseSalary, overtimeAmount, overtimeHours, overtimeRecordCount,
  totalPayroll, source, integrityStatus, differences}`. Unknown legacy hours are `null` → rendered
  "— / unavailable".
- Immutable overtime snapshots frozen at posting: `overtimeSnapshot` on the payroll/supplemental
  transaction and `committedSnapshot` on the plan; supplemental `sourceOvertimeSnapshot` frozen at
  Approved. Snapshot-preferring breakdown/source tables survive later edit/deletion of source overtime.
- Explicit onboarding completion marker `companySettingsConfiguredAt` (settings field, not a storage
  key) set only after a successful Settings save, with `legacyMeaningfulCompanyProfile` fallback.
- Execution Center deep-link `focusTransactionInExecutionCenter` — reveals/highlights the exact linked
  transaction regardless of date bucket; clear warning if missing.
- Global supplemental duplicate guard `overtimeCapturedByOtherSupplemental` used by both generation and
  refresh; empty/inactive company-account posting UX; 12 new integrity checks (payroll↔transaction
  linkage, snapshot consistency, supplemental orphan/double-capture/missing-snapshot).

### Changed
- Payroll Detail ("Base Payroll Snapshot" + mismatch notice), worksheet rows, period totals/summary,
  and CSV export are stage-aware. Posted supplemental notes are immutable. `persist()` and
  `saveSettings()` return their success flag; supplemental posting persistence is coordinated with
  rollback to avoid orphaned linkage. Verifier: 129 → **166** checks.

## 2.7.0 — Supplemental Payroll Engine

**Type:** New payroll capability + housekeeping. Adds **one** additive storage key
(`tam_supplemental_payments_v1`, 14 → 15). **No** `SCHEMA_VERSION` change (still 6); no storage key
renamed/removed; the base payroll total, its finance transaction, and its execution history are
never modified.

### Added — Supplemental Payroll Engine
- A **Supplemental Payment** is a separate accounting document that settles overtime approved **after**
  the base payroll became immutable (Posted/Executed). New module `js/people/supplemental-engine.js`
  and store `tam_supplemental_payments_v1`.
- **Source (v1): overtime only.** The amount reuses the existing `payrollOvertimeDrift(pp)`
  calculation (`addedAmount` per-ID basis) — no second overtime-delta formula.
- **Lifecycle:** Draft → Review → Approved → Posted → Executed (+ Cancelled). Amount and source
  overtime **freeze at Approved**. Centralized helpers own all business rules (eligible unpaid
  overtime, duplicate detection, generation, explicit refresh, transition eligibility/apply,
  posting, execution linkage) — not scattered in UI handlers.
- **Duplicate prevention:** an overtime record is never captured by two non-cancelled supplementals;
  at most one open Draft/Review per employee/period/source; later overtime after a frozen record
  forms a **new** supplemental; generation is idempotent; zero/negative deltas create nothing.
- **Finance:** posting creates exactly **one** Planned transaction (`source:'supplemental'`), linked
  both ways, with an immutable company-account snapshot. **Execution** reuses the Execution Center;
  executing the linked transaction closes the supplemental (idempotent — no double pay).
- **UI:** the v2.6.8 overtime-drift warning is now **actionable** (Generate / Open) in the Payroll
  Workspace, Payroll Detail, and Overtime page; a new **Supplemental Payments** page (list / search /
  filter / detail / lifecycle actions); Payroll Detail and Employee Detail show related supplementals
  separately from base payroll; Activity Log labels for every `supplemental.*` transition.

### Added / Changed — housekeeping
- **Feature lifecycle registry** (`FEATURE_REGISTRY` in `shell-render.js`) replaces the hardcoded
  sidebar "Preview" badge. Projects / Vendors / Financial Calendar show **SOON** (they are
  non-functional placeholders); Recurring Expenses is **stable** (no badge). One shared badge helper,
  accessible tooltips.
- **CSV bank-account policy:** the general employee CSV export now **masks** account numbers (last 4);
  import still accepts full numbers; stored values are not rewritten. Documented in `docs/DATA-SAFETY.md`.
- **Workflow labels:** CI/Release "Verify build" step labels are now count-neutral (no hardcoded
  verifier count).
- `APP_VERSION` → `2.7.0`, `APP_RELEASE_NAME` → "Supplemental Payroll Engine".

### Data safety
- SCHEMA_VERSION **unchanged (6)**; storage keys **14 → 15** (additive); backup/restore include
  `supplementalPayments`; older backups without it restore cleanly. No seed (fresh installs start
  empty).

### Not in this release
- Supplemental support for bonuses / reimbursements / arbitrary adjustments, and Payroll Reporting,
  remain out of scope (later releases).

### Validation
- `node tools/build-single-file.js` → `dist/tam-intelligence-os-v2.7.0.html`;
  `node tools/verify-build.js` → **129 checks**. Modular + portable boot with **zero console errors**.

---

## 2.6.9 — Enterprise Banking Foundation

**Type:** Banking data model + UI. Adds **one** additive storage key (`tam_company_accounts_v1`).
**No** `SCHEMA_VERSION` change (still 6); no storage key renamed/removed; no payroll/finance
calculation or committed-data change. Supplemental Payment is **not** in this release (planned for
v2.7.0).

### Added
- **Indonesian Bank Master** (`BANK_MASTER_GROUPS` / `INDONESIAN_BANKS` in `js/core/constants.js`) —
  a single, reusable, grouped (State / Private / Digital / Islamic / Regional / International +
  "Other Bank"), alphabetically-sorted constant. Reference data only: **no storage key, no
  duplicated arrays**.
- **Company Bank Accounts** — a new **Settings → Bank Accounts** page (create / edit / deactivate /
  archive / search / filter). Model: `{ id, label, bankName, holder, accountNumber, purpose, status }`
  in the new store `tam_company_accounts_v1`. Purposes: Operational / Payroll / Tax / Savings /
  Petty Cash / Other; statuses: Active / Inactive / Archived. **Account numbers are masked** in all
  lists (last 4 only); no PIN/OTP/password/token is stored. Only **Active** accounts appear in
  transaction dropdowns, shown as **"Label — Bank"**.
- **Employee banking** — the employee **Bank** is chosen from the Bank Master; new **Account Holder**
  field; employee account numbers masked in the profile view.
- Activity Log types `bankaccount.create` / `bankaccount.edit` / `bankaccount.status` (reuse the
  existing `tam_audit_log_v1` — no new audit key).

### Changed
- Bank dropdowns in Add/Execute transaction, the transactions filter, recurring expenses, and the
  default-bank setting now list only **Active company accounts** (legacy string values still resolve).
- Complete Backup / Restore now include `companyAccounts`; older backups without it restore cleanly.
- `APP_VERSION` → `2.6.9`, `APP_RELEASE_NAME` → "Enterprise Banking Foundation".
- Verifier: known storage keys **13 → 14** (the new key is checked in the current build; the 13
  legacy keys are still checked against the v2.5.2 golden master). New checks: 14-key count, seed
  flag present, Bank Master is a constant. **114 checks** total.

### Backward compatibility & migration
- Employee legacy bank values map correctly (Mandiri → Bank Mandiri, BSI → Bank Syariah Indonesia,
  …); unknown free-text banks are preserved as a "(current)" option. **No bulk data migration.**
- One-time, **guarded, non-destructive** seed (`tam_migrated_bankaccts_v269`) converts the five
  legacy bank strings into Active company accounts **only when the install already has data** — a
  fresh install stays **empty** (invariant preserved).

### Not in this release
- **Supplemental Payment** (lifecycle, finance/execution, storage, Activity Log, timelines) —
  planned for **v2.7.0**. The v2.6.8 overtime-drift warning and its disabled placeholder are
  unchanged.

### Validation
- `node tools/build-single-file.js` → `dist/tam-intelligence-os-v2.6.9.html`;
  `node tools/verify-build.js` → **114/114**. Modular + portable boot with **zero console errors**.

---

## 2.6.8 — Payroll Selection and Overtime Drift UX Fixes

**Type:** Targeted UX/correctness fixes in the Payroll Workspace and Overtime modules. **No change
to payroll status rules, committed-payroll immutability, business calculations, storage keys,
migration flags, SCHEMA_VERSION (6), backup format, or `.css` files.**

### Changed — Generic payroll bulk-selection model (Issue 1)
- **Selection is now stage-agnostic.** Select All and the header checkbox select **all visible
  rows**, and the selected count is the **actual** number of selected rows. Every visible stage is
  selectable, so a future action (Export, Delete, …) can reuse the same selection.
- **Each bulk action owns its eligibility** via a single registry (`PAYROLL_BULK_ACTIONS`) and
  `partitionPayrollSelection(ids, action)`:
  - **Review** → eligible **Draft**
  - **Approve** → eligible **Draft, Review**
  - **Post** → eligible **Approved**
- **Every action reports eligible / skipped / reason.** This removes the original confusion
  (*"16 selected → 0 approved"*): e.g. *"Approved 3 payroll(s). 2 skipped — 1 already at Posted
  stage; 1 already at Executed stage."* Post to Finance now also reports rows skipped because they
  are not at the Approved stage, alongside any commit blockers.
- The header "select all shown" checkbox stays synchronized with the visible rows (checked /
  indeterminate / unchecked / disabled when none); each action auto-disables when the period has no
  row eligible for **that** action; a helper hint and per-button tooltips document each action's
  eligible stages.

### Fixed — Overtime drift visibility (Issue 2)
- Approving overtime after payroll already exists now shows an **immediate** warning — with **no
  need to click Generate Payroll first** — on the **Overtime page**, the **Payroll Workspace**, and
  **Payroll Detail**.
  - Draft / Review / Approved payroll: *"Overtime approved. Regenerate payroll to include the
    updated overtime."*
  - Posted / Executed payroll: *"Approved overtime was added after payroll was posted. The original
    payroll remains unchanged. A supplemental payment will be required."* plus a **disabled**
    "Supplemental Payment (Coming in a future release)" placeholder.
- The warning is **derived** from the existing overtime-comparison logic
  (`approvedOvertimeForMonth` + `sameIdSet`) via a new read-only `payrollOvertimeDrift(pp)` — so it
  appears immediately, **survives reload, and never duplicates**. No stored flag is added.

### Guarantees
- Posted and Executed payroll stays fully immutable — payroll totals and posted/executed
  transactions are never modified. Supplemental Payment itself is intentionally **deferred**.

### Changed
- `APP_VERSION` → `2.6.8`, `APP_RELEASE_NAME` → "Payroll Selection and Overtime Drift UX Fixes".

### Validation
- Build + verify: `node tools/build-single-file.js` → `dist/tam-intelligence-os-v2.6.8.html`;
  `node tools/verify-build.js` → all checks pass. Modular source and portable dist boot with **zero
  console errors**.

---

## 2.6.7 — Enterprise Repository & Delivery Foundation

**Type:** Engineering, repository governance, CI, and release automation. **No business feature,
calculation, payroll/overtime/finance/import/execution logic, storage key, migration flag,
SCHEMA_VERSION (6), backup format, module load order, or `.css` change.** The application runtime is
byte-identical to v2.6.6 apart from the version identity.

### Added
- **GitHub Actions CI** (`.github/workflows/ci.yml`): build + verify (109 checks) on every push and
  pull request to `main` and on demand; confirms the version-derived dist exists and uploads it as
  an artifact. No dependencies installed.
- **Release workflow** (`.github/workflows/release.yml`): tag-triggered (`v*`); rebuilds, verifies,
  re-derives the version, refuses to publish unless the tag equals `v<APP_VERSION>` and the portable
  HTML exists, and creates/updates the GitHub Release with the portable HTML asset (idempotent).
- **Governance:** issue templates (bug/feature) + `config.yml`, pull request template, `CODEOWNERS`,
  `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `PROPRIETARY-LICENSE-NOTICE.md` (proprietary),
  `.github/RELEASE_TEMPLATE.md`, `RELEASE_NOTES.md`, and `docs/{QA-CHECKLIST,RELEASE-PROCESS,
  DATA-SAFETY}.md`.
- **README badges:** CI status, latest release, version, proprietary status.

### Changed
- `APP_VERSION` → `2.6.7`, `APP_RELEASE_NAME` → "Enterprise Repository & Delivery Foundation".
- Hardened `.gitignore`/`.gitattributes`: keep secrets, `.env`, local backups, uploaded evidence,
  and real workbooks out of version control; documented a sample-data policy (fabricated samples
  only, under `samples/`).

### Security
- Private vulnerability reporting via GitHub Security Advisories; blank public issues disabled.
- **Open finding:** the real company workbook `Rencana Penggunaan Dana Juli 2026.xlsx` is currently
  tracked in git history. It is **not** removed automatically; safe removal (`git rm --cached` and a
  history purge) is recommended pending an ownership decision.

### Validation
- Build + verify: `node tools/build-single-file.js` → `dist/tam-intelligence-os-v2.6.7.html`;
  `node tools/verify-build.js` → **109/109**. Modular source and portable dist boot with **zero
  console errors**. Workflow/template YAML syntax-validated locally; GitHub Actions runs on push.

---

## 2.6.6 — Company Settings Checklist Fix

**Type:** Targeted onboarding bug fix. **No change to company data, storage keys, SCHEMA_VERSION
(6), calculations, or `.css` files.**

### Fixed
- **The onboarding "Configure company settings" step now completes when you save a meaningful
  company profile.** Previously the check ignored the Product Name field and treated the shipped
  default company name as unconfigured, so saving Settings often left the step unchecked.

### How
- Completion is derived purely from persisted settings (`tam_settings_v1`) via a new
  `companySettingsConfigured()` helper: **configured** when the Company Name **or** Product Name
  is non-empty and non-default, **or** an Opening Cash Balance has been set.
- Because it is derived from persisted state (not transient UI), the step is correct immediately
  after saving and remains correct after navigation and browser reload. The Settings save already
  re-renders, so the dashboard checklist refreshes without a full reload.
- Unchanged shipped defaults do not count (fresh install stays "not configured"); a theme-only
  save does not count (Appearance is not a company-identity field); optional blank fields never
  block completion.

### Validation
- Node build + verify: **109/109 checks pass**; PowerShell fallback derives the same version.
  In the running app (modular source + dist): fresh untouched defaults → not completed; changing
  Company Name and saving via the real Settings form → completed immediately and the dashboard
  checklist shows "✓ Configure company settings" without a reload; the value persists and the
  step remains completed after a real browser reload; Product-Name-only and Opening-Cash-only
  each also complete it; a theme-only change does not; **zero console errors**.

---

## 2.6.5 — Smart Import Selection Scroll Preservation

**Type:** Targeted UX bug fix. **No change to import parsing, employee/contract matching, payroll
generation, transaction creation, duplicate prevention, storage keys, SCHEMA_VERSION (6), audit
behavior, or `.css` files.**

### Fixed
- **Smart Import review no longer jumps to the top when you select/unselect a row.** Previously
  every checkbox change re-rendered the whole wizard (`main.innerHTML = …`), rebuilding the
  scrolling table container and resetting its `scrollTop` to 0.

### How
- **Root cause:** `smartCounts` derives all stat cards and tab counts from `actions.*` /
  `reviewRequired` / match status — never from `selected` — so the per-row re-render was
  unnecessary.
- **Row selection is now fully incremental:** it updates only `model.items[].selected` and a new
  live "N selected" counter; the wizard is not re-rendered, so scroll position and keyboard focus
  are preserved natively.
- **Select All Safe / Unselect All** sync the visible checkboxes in place (no re-render).
- **Skip Conflicts** and **column-mapping overrides** still re-render (they change buckets/counts
  or rebuild the model), but now run through `preserveSmartImportView`, which captures the
  `.table-wrap` + window scroll and the focused control and restores them after layout via a
  guarded `requestAnimationFrame` + `setTimeout` backstop, using `focus({preventScroll:true})`.
- Switching review tabs is intentional navigation and still starts at the top; selection survives
  tab switches (it lives in the model).

### Validation
- Node build + verify: **109/109 checks pass**; PowerShell fallback: **53/53** (version derived
  from `constants.js`). Real workbook (`Rencana Penggunaan Dana Juli 2026.xlsx`, **152 rows across
  11 months**) driven through the actual pipeline: selecting 1 then 6 rows near the bottom moved
  `scrollTop` by **0 px**, window scroll unchanged, focus stayed on the checkbox; Select All Safe /
  Unselect All 0 px; Skip Conflicts (23 rows, a real re-render that rebuilt the scroll container)
  restored `scrollTop` exactly. Commit still works (18 employees / 25 contracts / 129 plans / 129
  transactions), duplicate prevention still skips re-imports (77 duplicates skipped), Activity Log
  still records `import.commit`. Modular source and dist boot with **zero console errors**.

---

## 2.6.4 — Release Automation & Payroll Audit Visibility

**Type:** Release tooling + read-only audit features. **No business logic, storage key,
migration flag, SCHEMA_VERSION (6) or CSS-file change.**

### Release automation (Part 1)
- **The version is no longer hardcoded in the tooling.** The single source of truth is
  `const APP_VERSION` (and `APP_RELEASE_NAME`) in `js/core/constants.js`. New
  `tools/app-version.js` parses those constants; `build-single-file.js` and `verify-build.js`
  derive from it, and the PowerShell fallbacks (`*.ps1`) parse the same constants.
- The portable **dist filename is derived** — `dist/tam-intelligence-os-v${APP_VERSION}.html`.
  The build fails clearly if `APP_VERSION` cannot be parsed, and asserts the assembled HTML
  actually carries that version and `<title>` and that the filename matches.
- `verify-build.js` now derives and checks `APP_VERSION`, `<title>`, `APP_RELEASE_NAME`, the
  Release Notes entry and the generated filename against the same source; stale header comments
  corrected. No existing verification check was weakened.

### Activity Log (Part 3)
- New **Management → Activity Log**: a read-only audit trail across payroll, overtime, finance
  execution, imports and deletes. Columns: time, module, event, entity, description, related IDs.
- Search + module + event-type + period filters, newest-first, empty state, and CSV export.
  **Incrementally rendered** (only the table body swaps) so the search box keeps focus.
- Backed by the **existing** `tam_audit_log_v1` store (same key the reset record used) — **no
  new storage key, no SCHEMA_VERSION change**. Newest 500 events retained; survives a data reset.

### Payroll audit visibility (Part 4)
- **Payroll Detail → Payroll Timeline** and **Payroll Workspace → Period Activity**: read-only
  timelines for Generated, Reviewed, Approved, Posted to Finance, Executed, Period locked/unlocked.
- Derived from existing payroll history, the linked transaction, and audit records. Events with
  no real timestamp are **omitted, never fabricated**. No business state is duplicated.

### Post-blocker feedback (Part 5)
- **Post to Finance** now shows a clear posted-vs-skipped summary. Each skipped Approved row
  shows the **employee name and the exact blocker reason**, stays Approved, and creates **no**
  transaction. Blocker rules are unchanged; no duplicate transactions are created.

### Validation
- Node build + verify: **109/109 checks pass** (up from 87 — adds version-derivation, Activity
  Log, payroll-timeline and post-blocker assertions). PowerShell fallback: **53/53**, deriving
  the same version. Modular source and portable dist boot with **zero console errors**; Activity
  Log filters/CSV, payroll timeline (real events only), and the post-result summary verified in
  the browser in dark/light/system themes. 44 JS modules load in order.

---

## 2.6.3c — Responsive UI Polish

**Type:** UI polish. **No business logic, storage, verification, or CSS-file change.**

### Improved
- **Sidebar icon consistency:** the Execution Center icon now renders as **monochrome text**
  (a Unicode text-presentation selector, VS-15, is appended to the ⚡ glyph) instead of a
  colored emoji that drew attention even when the page was inactive. Only the active row's
  background and text color indicate the current page.
- **Responsive detail pages (Employee / Contract / Payroll):** the two side-by-side cards now
  use `align-items:start`, so each card sizes to its own content instead of stretching to the
  taller card's height (fixing the "vertically stretched / overly tall" look at 125%–150%
  browser zoom). They already stack to one column at ≤1050px CSS width (existing `.grid-2`
  breakpoint), which covers 125%/150% zoom.
- **Tighter vertical spacing:** detail-card `line-height` reduced (2 → 1.75, 1.9/1.95 → 1.7/1.75)
  for higher information density while remaining readable. Top action buttons (Back / Edit /
  New Contract) already wrap via `.head-controls{flex-wrap:wrap}`.

All changes are in JS/markup (inline styles + reusing existing responsive classes) — **no
`.css` files were touched, so the CSS golden master is unchanged**, and no verification logic
was modified.

### Validation
- Node build + verify: **87/87 checks pass** (CSS golden master still asserts CSS == v2.5.2 +
  only the v2.6.3b floating rule). Browser, zero console errors, at 100% / 125% / 150% zoom in
  dark and light: no horizontal scrolling, no overlapping controls, no clipped content; detail
  cards stack when width is limited and are content-sized (not stretched); the Execution Center
  icon renders monochrome like its siblings.

---

## 2.6.3b — Floating Actions Menu Fix

**Type:** UI infrastructure. **No business logic, schema, or storage change.**

### Fixed
- **Row Actions menu is no longer clipped by the scrolling table container.** Replaced the
  in-container dropdown (which `overflow:auto` clipped even when flipped up) with a shared
  **floating layer**: the menu is portaled out to a top-level `#menu-root` node and positioned
  with `position:fixed` via `getBoundingClientRect()`, so it always renders fully visible.
- One shared controller — `openFloatingMenu` / `closeFloatingMenu` / `positionFloatingMenu`
  in `ui/shell-render.js` — reused by **Employees, Contracts, Payroll, Overtime, Transactions,
  Execution Center** (both the HR `bindHRActions` and finance `bindActionMenus` menus). It:
  auto-flips up/down by available space, closes on outside click and **Escape**, repositions
  on window **resize/scroll**, keeps one menu open at a time, and is cleaned up centrally at
  the start of `render()` so a portaled menu is never orphaned across a re-render.
- Also fixed a latent wiring bug the portal exposed: the **Payroll** row menu emitted
  un-prefixed action values (`detail`, `review`, …) that never matched the `bindHRActions`
  dispatch (`prow-detail`, `prow-review`, …), so those dropdown items did nothing. They now
  use the correct `prow-*` values and work (View Detail, Mark Reviewed, Approve, Return to
  Draft, Open in Execution Center, Cancel Row). Every other page already used prefixed values.

### Validation
- Node build + verify: **87/87 checks pass** (CSS golden master now allows only the one new
  `.actions-dropdown.floating` rule; new assertions for the portal, `position:fixed`, Escape,
  reposition-on-scroll/resize, and removal of the old in-container helper). Browser (dist +
  modular source, zero console errors): the menu is portaled to `#menu-root`, never inside a
  `.table-wrap`, fully within the viewport, flips up on bottom rows; closes on outside click
  and Escape; repositions on scroll; item actions fire and the menu is cleaned up — verified on
  Payroll, Employees, Contracts, Overtime and Transactions.

---

## 2.6.3a — Payroll Workspace Hotfix

**Type:** UI / action-flow hotfix. **No calculation-engine, schema, or storage change.**

### Fixed
- **Approve Selected now moves rows from Review to Approved.** Approval is a sign-off and
  is no longer gated by commit-blockers in the lifecycle helpers (`setPayrollStatus`,
  `bulkPayrollStatus`). Data validation (missing salary, invalid/duplicate contract, invalid
  schedule) now runs **only at Post to Finance** (`commitReadyPayroll`), where blocked rows
  are skipped and reported. So **Post to Finance succeeds after Approve**, valid rows create
  Planned transactions, and no duplicate payroll is created. The payroll calculation engine
  (generation, `computePayrollPlanned`, overtime math) is untouched.
- **Actions dropdown auto-flips upward** when there isn't enough room below the row, so menu
  items are never hidden and no scrolling is required. A shared `positionActionsMenu()` helper
  measures available space against the viewport / nearest scroll container and adds
  `.actions-dropdown.up` when needed. Wired into both the HR menus (Employees, Contracts,
  Overtime, Payroll) and the finance menus (Transactions, Execution Center).

### Validation
- Node build + verify: **82/82 checks pass** (CSS golden master tightened to allow **only**
  the one new `.actions-dropdown.up` rule; new hotfix assertions for the approve gate and the
  auto-flip). Browser (dist), zero console errors: Approve moves Review→Approved (incl. a
  zero-salary row), Post posts the valid rows and skips the blocked one, no duplicate payroll,
  and the Actions menu flips up on bottom rows (down on top rows) on Employees and Payroll.

---

## 2.6.3 — Payroll Intelligence Workspace

**Type:** feature — payroll operational workspace. **No schema, storage-key, or calculation-engine change.**

Upgrades Payroll from a generator into a clean, workflow-oriented **operational workspace**.
Payroll in TAM is **Base Salary + Approved Overtime only** — no tax, BPJS, loan, transport,
meal allowance, or deduction engine.

### Added
- **Payroll Workspace** (the main payroll page): a current-period banner + period switcher,
  top KPI cards (Current Period, Employees, Draft, Review, Approved, Posted, Executed, Total
  Payroll, Total Overtime), and workspace actions (Generate, Review, Approve, Post to Finance).
- **Operational lifecycle** Draft → Review → Approved → Posted → Executed, shown as stage
  badges. It is a **display mapping over the existing stored status values** (Reviewed/Ready/
  Committed) with **Executed derived** from the linked finance transaction — so **no data
  migration**. Execution still happens in the Execution Center.
- **Bulk operations** with confirmation dialogs: Select All, Review Selected, Approve
  Selected, Post to Finance.
- **Payroll period lock** (`State.settings.payrollLocks`, same `tam_settings_v1` key): a
  locked month blocks regeneration, edits, its overtime changes, and finance re-posting.
  Unlock requires confirmation. Overtime mutators (add/edit/status/duplicate/delete/worksheet)
  are guarded against locked periods.
- **Payroll Health** — deterministic (no AI) warning cards: contract expiring within 30 days,
  payroll up/down >20% vs previous period, unusually high overtime, employee missing an
  active contract.
- **Payroll Summary**: total employees, payroll total, total overtime, average, highest, lowest.
- **Employee Timeline** on Employee Detail: Profile, Active Contract, Contract History,
  **Payroll History**, **Overtime History**, and **Finance Transactions** in one linked view.
- **Read-only payroll preview** (employee, contract, progress, base, approved overtime, total,
  generated finance transaction) with a payroll history log.

### Changed
- The payroll worksheet is now **read-only** (Employee · Contract · Progress · Base · Approved
  OT · Total · Stage) — the editable component spreadsheet (allowance/bonus/benefits/deduction
  columns) is gone. Edit salary via the Contract, overtime via Overtime.
- "Commit Ready Payroll" is now **Post to Finance** / "Post Approved Payroll to Finance"; only
  Approved payroll may be posted; it creates **Planned** transactions and never auto-executes.
- Nav label "Payroll Planning" → **"Payroll Workspace"**. Recurring adjustments UI is retained
  for backward compatibility but is no longer part of the standard workflow.
- Version identity → 2.6.3; new Release Notes entry (history preserved).

### Unchanged (verified)
- **`SCHEMA_VERSION` stays 6**; all storage keys, migration flags, backup shape, and CSS are
  byte-for-byte unchanged. The calculation engine (`computePayrollPlanned`) is untouched;
  because TAM configures no adjustments, Total already equals Base + Approved Overtime.
- Employee Dedup, Smart Import, Contract Engine, Execution Center, Monthly Planning, Reports,
  Node build, verification, Git, and the 43-module structure are all preserved. The v2.6.1
  search-focus fix still holds on the payroll search.
- Still classic ordered scripts — no ES modules, no bundler.

### Validation
- Node build + verify: **76/76 checks pass** (adds payroll-workspace assertions).
- Browser (dist + modular source, zero console errors): Generate, duplicate prevention,
  Draft→Review→Approved→Posted lifecycle, bulk review/approve/post, period lock (blocks bulk
  and re-posting), approved-overtime integration (Total = Base + OT; overtime flips to
  "Committed to Payroll" on post), finance posting creates Planned transactions, Executed
  derived from a completed transaction, employee timeline, period switching, payroll search
  focus, and dark/light themes.

### Out of scope (not implemented, by design)
- BPJS, tax, loan, meal allowance, transport, insurance, deduction engine, payslip PDF,
  multi-user approval, electronic signature.

---

## 2.6.2 — Developer Experience & Module Decomposition

**Type:** developer workflow + code organization. **No business logic, data, or schema change.**

### Added
- **Git repository** initialized on branch `main` with a practical `.gitignore`
  (`node_modules/`, `dist/*.tmp`, `*.log`, `.vscode/settings.json`, `Thumbs.db`, `.DS_Store`).
  The portable release HTML (`dist/*.html`) is **intentionally version-controlled**.
- `tools/module-order.js` — the single source of truth for classic-script load order,
  consumed by `build-single-file.js`, `verify-build.js`, and mirrored by `index.html`.
- `tools/decompose.js` — the one-time, self-verifying splitter used for this release.

### Changed
- **Decomposed the largest JS modules into a feature-folder tree.** Went from **20 flat
  files → 43 modules** under `js/{core,ui,finance,people,import,analytics}/`. Average
  module size dropped from ~410 to ~190 lines; the biggest file is now ~350 lines (was
  1,581). The three named large files were split:
  - `09-finance-pages.js` → `finance/{dashboard, execution-center, transaction-modals, transactions, add-upload}.js`
  - `11-import-ui-analytics.js` → `import/import-preview.js`, `analytics/{plan-vs-actual, compare, trends, executive-dashboard, executive-insights, reports}.js`, `finance/{cashflow, budget}.js`, `ui/settings-about.js`
  - `12-people-pages.js` → `people/{people-core, employees, contracts, payroll-planning, recurring-expenses, monthly-plan, legacy-mapping, hr-dashboard-reports}.js`
  - `17-employee-dedup.js` and `18-payroll-ops.js` were also split along their internal seams.
- **Node.js is the primary build/verify toolchain**; the PowerShell scripts remain an
  optional fallback and now read the shared manifest so they stay in sync.
- Version identity → `2.6.2` / "Developer Experience & Module Decomposition"; new Release
  Notes entry (2.6.1 and earlier preserved).

### Unchanged (verified)
- **Pure code move.** The decomposition is verified **byte-identical**: the concatenation
  of the 43 modules in load order equals the previous concatenation of the 20 files, so
  runtime behavior is unchanged. `SCHEMA_VERSION` stays **6**; all storage keys, migration
  flags, and backup shape untouched; **CSS byte-for-byte identical to v2.5.2**.
- Still **classic ordered `<script>` tags** in one shared global scope — no ES modules,
  no `import`/`export`, no bundler.
- The v2.6.1 search-focus behavior is intact (verified by the same focus-fix assertions).

### Validation
- Node build + verify: **63/63 checks pass** (adds module-decomposition integrity checks:
  all 43 modules present, no flat files remain, folders present, `index.html` matches the
  manifest).
- Browser: modular source loads all **43 `<script src>` files `200 OK` in manifest order**;
  every page renders, search focus works, charts render, themes toggle — **zero console
  errors** on both the modular source and the portable dist.

---

## 2.6.1 — Search Focus & Incremental Rendering Fix

**Type:** UX / rendering-path fix. **No business logic, data, or schema change.**

Fixed a regression where typing in any search box lost keyboard focus after every
keystroke (the whole content pane, including the `<input>`, was rebuilt on each `input`
event). Search and filter controls now update **only the table body** (and any
filter-dependent totals), so the search input is never destroyed while typing.

### Fixed / Changed
- **Employees, Contracts, Transactions, Payroll Planning, Overtime** search boxes and
  their filter dropdowns now call an incremental `apply*Filter()` that swaps only the
  `<tbody>` and re-binds the row-level handlers — the page shell, toolbar, and inputs are
  never rebuilt.
- Result: the search input keeps **focus, caret position, and text selection**; the table
  keeps its **scroll position**; dropdown selections and payroll **row-selection
  checkboxes survive** filtering (selection state lives in `State.payrollSel`).
- Filter-dependent summaries update in place: Transactions "N of M" count, Overtime
  "Records Shown / Total Hours / Total Amount" tiles.
- Each affected renderer was split into `X` (shell, built once), `XFiltered()` /
  `XRowsHTML()` (data → rows), and `bind*Rows()` (row handlers), shared by the initial
  render and the incremental refresh.

### Unchanged (verified)
- `SCHEMA_VERSION` stays **6**; all storage keys, migration flags, and the complete-backup
  shape are untouched. **CSS is byte-for-byte identical to v2.5.2.**
- No calculation, import, deduplication, payroll/overtime result, export, row action,
  inline edit, or Actions-menu behavior changed. Reports and Smart Import have no live
  search input and were not affected.

### Validation
- 52 automated checks pass (`tools/verify-build.*`), including "old full-render search
  handler removed" and "incremental refresh present" assertions.
- Browser-verified on both the modular source and the portable dist: for every search box
  the input node is preserved across keystrokes, focus/caret/selection persist, lists
  filter live, row actions/inline-edits re-bind, and payroll checkbox selection survives
  filtering. Zero console errors.

---

## 2.6.0 — Modular Frontend Architecture (Phase 0)

**Type:** architecture / refactoring only. **No behavior change.**

Phase 0 of the Modular Frontend Architecture initiative. The stable single-file
application (`tam-intelligence-os-v2.5.2.html`) was physically split into a maintainable
modular source tree while preserving 100% of existing functionality.

### Changed
- Split the single 8,500-line file into **20 ordered JavaScript files** (`js/00-*` …
  `js/19-*`) and **5 CSS files** (`css/tokens|base|shell|components|charts.css`),
  each a verbatim contiguous slice of v2.5.2 in original order.
- JS loads as **classic `<script src>` tags** (shared global scope) — **no** ES modules,
  `import`, or `export`. Declaration order == original order.
- CSS extracted to external files in fixed cascade order (tokens → base → shell →
  components → charts).
- Added a portable single-file build pipeline (`tools/build-single-file.*`) that inlines
  the modular source into `dist/tam-intelligence-os-v2.6.0.html`, behaviorally identical
  to previous releases (same external XLSX/font behavior, no minification).
- Added golden-master verification (`tools/verify-build.*`) gating storage keys, schema
  version, migration flags, seed data, mount points, single bootstrap, and byte-level JS/CSS
  equivalence against v2.5.2.
- `APP_VERSION` → `2.6.0`; `APP_RELEASE_NAME` → `Modular Frontend Architecture`;
  browser `<title>` → `TAM Intelligence OS v2.6.0`. These propagate to About, Diagnostics,
  report headers, and all export filenames (`FILE_BASE`) automatically.
- Added a 2.6.0 Release Notes entry (no historical entry altered).

### Unchanged (verified by golden master)
- `SCHEMA_VERSION` stays **6**.
- All storage keys: `tam_txns_v1`, `tam_settings_v1`, `tam_backups_v1`, all `HR_KEYS`
  (`tam_employees_v1` … `tam_employee_merges_v1`), `tam_audit_log_v1`.
- All migration flags: `tam_migrated_exec_v21`, `tam_migrated_hr_v22`,
  `tam_migrated_norm_v221`, `tam_migrated_overtime_v23`, `tam_migrated_payrollops_v25`,
  `tam_migrated_dedup_v252`, `tam_v23_ack` (the `v252` in the flag name is a storage key,
  not version identity — untouched).
- Complete-backup shape, workbook import, Smart Import, employee deduplication, payroll
  and overtime calculations, transaction lifecycle, Execution Center buckets, reports,
  diagnostics, themes, charts, sidebar scroll, action menus, fresh-install detection, and
  standalone localStorage persistence — all byte-for-byte identical.

### Not in this release (deferred)
- ES module conversion, bundler, dead-code elimination.
- Any logic de-duplication, renaming, or optimization.
- Any data-schema change.

---

## 2.5.2 — Employee Deduplication & Master Data Consolidation

Previous stable release. See in-app **Release Notes** for the full history (2.5.2 → 1.0).
