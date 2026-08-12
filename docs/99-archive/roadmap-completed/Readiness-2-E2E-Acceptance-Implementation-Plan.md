# Readiness-2 — End-to-End User Journey Acceptance (Implementation Plan)

**Status:** implemented, merged & frozen — merge `580d8999`
**Baseline:** `3521d811` (main after the Readiness-1 merge)
**Next milestone:** Readiness-3 — Release Candidate & Pilot Package

---

## 1. What this phase answers

Every harness before this one validated a **boundary**: does this function authorize, does
this selector scope, does this control render. Readiness-2 asks a different question:

> Can a real user complete the primary TAM OS workflows from the actual UI, start to finish,
> with correct state, feedback, persistence, privacy and recovery?

The unit of validation is the **journey**, not the function. A workflow that throws no
exception but persists nothing is a failure here.

## 2. Acceptance matrix

**A** = automated in `tools/verify-readiness2-e2e-runtime.js` · **B** = browser-confirmed
(real DOM, both artifacts) · **M** = manual-only step, stated explicitly.

| Journey | A | B | Steps proven | Residual limitation |
|---|---|---|---|---|
| **A — CEO finance** | ✅ | ✅ | Create via the **real `#manualForm` submit**; edit → schedule → execute through production handlers; status `planned → scheduled → completed`; execution metadata (date, amount, method, bank, ref); 4-event history; `finance.execute` audit; **survives reload** | — |
| **B — Employee self-service + privacy** | ✅ | ✅ | Roster/search/scope = A only; own-Draft overtime **created and persisted**; denied finance execute and payroll lock (typed reason, SE-0); deep-link to B renders nothing; nav stays complete (28 items) | — |
| **C — Payroll lifecycle** | ✅ | ✅ | Generate 2 rows; totals match rows; → Approved; **lock refuses posting** (`PayrollPeriodLocked`, 0 created, stages untouched); unlock → post creates 2 **planned** finance txns linked by `payrollPlanId` + `employeeId`; never auto-executes | — |
| **D — Smart Import + undo** | ✅ | ✅ | Model built by the **production `buildSmartImport()`**; commit creates 2 employees / 2 contracts / 2 plans / 2 txns + **pre-import safety backup** + `import.commit` audit; rollback preview names exactly those records; undo removes them all, marks the batch `undone`, writes `import.undo` | **M:** a real `.xlsx` file cannot be uploaded in this environment — the CDN spreadsheet parser is blocked (§7). The journey enters at `buildSmartImport(rawBatches)`, the first production seam after parsing. The parser itself is unproven here |
| **E — Backup / restore / reset** | ✅ | ✅ | Backup captures data + `schemaVersion 6`; state diverges; restore recovers exactly and persists; **Start Fresh** forces a backup download first, refuses on wrong confirmation text, and on the correct text clears every sensitive store while retaining only the deliberate reset-audit key | **M:** `window.prompt` typed confirmation and the backup **file download** are browser-native; the confirmation was supplied programmatically and the download counted, not saved to disk |
| **F — Principal switching** | ✅ | ✅ | CEO → A → CEO with no reload: workspace context, roster, payroll scope, Global Search index, foreign detail id, the seven C3 controls and `can()` all recompute; CEO view byte-identical before/after (recomputed, not cached) | — |
| **G — Settings** | ✅ | ✅ | CEO save persists through the **real `#settingsForm` submit**; Employee save through the same form is **denied** — State and persisted value both unchanged, no false success | — |
| **H — Supplemental** | ✅ | ✅ | Generated from **real overtime drift** after posting; account + notes set; Draft → Review → Approved; post creates one finance txn; **linked in both directions** (`supplementalId` ↔ `financeTransactionId`); persisted | — |

**Reload persistence** was confirmed in-browser for Journey A (full executed state and history
survived a real page reload) and asserted from the persisted payload for every other journey.
The principal correctly resets to `null` on reload — the frozen UX-006D1 ephemeral contract.

## 3. Defects found

**None in the product.** All eight journeys completed correctly on first pass. Three findings
were mine, not the app's, and are recorded because each nearly became a false report:

| # | What looked wrong | What it actually was |
|---|---|---|
| 1 | `executeTransaction` left `actual` undefined | My payload used `actual`/`paymentMethod`; the contract is `actualAmount`/`method`. The real modal sends the right shape |
| 2 | Employee `saveSettings()` persisted a company-name change — apparent **authorization bypass** | `saveSettings()` is a persistence **primitive**; the boundary is the form handler (`settings-about.js:151`, UX-006C2C-4 row 27). Re-run through the **real form**, the Employee save is correctly denied. Verified before reporting |
| 3 | Payroll post reported `skipped: 2 — invalid work schedule` | A truthful business blocker; my fixture omitted `workHoursPerDay`/`workDaysPerWeek`/`weeksPerMonth`. Correct outcome reporting, not a defect |

Finding 2 is the reason this plan states the settings boundary explicitly in the harness: the
journey asserts the **policy the handler consults** rather than pretending the primitive is the
gate.

## 4. Line-ending finding (§19) — resolved, and my earlier note corrected

Readiness-1 reported that local `core.autocrlf=true` produced a non-canonical artifact and
recommended Readiness-3 add a `.gitattributes` policy. **That recommendation was wrong.**

`.gitattributes` **already exists** and is correct: `* text=auto eol=lf`, with binary
exclusions and `dist/*.html linguist-generated=true`. The audit found exactly **one** tracked
file out of 249 with CRLF in the working tree — `js/finance/execution-center.js` — a stale
local checkout artifact, not a policy gap. Refreshing that one file restored the canonical
build immediately: verifier `2419 PASS / 0 FAIL` and artifact `979be89d…`, byte-identical to
CI and to the committed `dist/`.

**No `.gitattributes` change is needed and none was made** — adding one would have caused
churn against an already-correct policy.

## 5. Environment limitations (stated, not glossed)

- **External resources are blocked** in the validation browser: Google Fonts and the
  cdnjs spreadsheet parser 404. These are the two external references the constitution
  permits (§4.3). **Every local resource returned 200 and there were zero application
  console errors** — the 404s are environmental, and they are why Journey D enters after
  parsing.
- `window.prompt` and file **download**/**upload** are browser-native; where a journey needs
  them the step is marked **M** above.

## 6. Verification

| Gate | Result |
|---|---|
| E2E acceptance harness | **96 PASS** |
| Verifier | **2439 PASS / 0 FAIL** (was 2419; +20) |
| Runtime | **2921 PASS / 34 harnesses / 0 FAIL** (was 2825 / 33; +96) |
| Frozen counts | R1 119 · C3 91 · C2C-4 164 · C2C-3 129 · C2C-2 118 · C2C-1 60 · authz 104 · outcome 53 · D1 29 · D2 127 · D3 84 · workspace 32 — **none fell** |
| Invariants | `ACTIONS` 20 · `APP_VERSION` 2.9.0 · `SCHEMA_VERSION` 6 · `js/core/authz.js` untouched |
| Browser | Source **and** portable build: all journeys behave identically; zero application console errors; fabricated `tam_*` fixtures cleared afterwards |

## 7. Deferred to Readiness-3 / post-pilot

- Real `.xlsx` upload through the CDN parser (needs a network-enabled environment)
- Backup **file** download/upload round-trip on disk
- Disabled-reason discoverability for touch/keyboard (frozen C3 pattern — unchanged, and no
  journey was blocked by it)
- Default / remembered principal for first boot — the app is data-empty until a principal is
  selected, which is the required fail-closed semantic and **not** a defect

## 8. Stop conditions

**None triggered.** No data corruption, no unrecoverable persistence failure, no authorization
bypass, no privacy leak, no migration requirement, no undefined product behaviour, and no
external dependency that the journeys could not represent through a production seam.

## 9. Pilot recommendation

All eight primary journeys are complete, persistent, private and recoverable in both artifacts.
The remaining gap to a pilot is **packaging, not correctness**: Readiness-3 (release candidate,
notes, backup/rollback guidance, pilot instructions). A **CEO-led pilot with the Employee
persona now safe to include** is supported by this evidence.
