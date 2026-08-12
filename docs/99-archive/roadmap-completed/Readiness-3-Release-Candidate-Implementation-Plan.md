# Readiness-3 — Release Candidate & Pilot Package

**Status:** implemented, merged & frozen — merge `61ddd939`.
**Baseline:** `580d8999` (main, after the Readiness-2 merge).
**Predecessors:** Readiness-1 (read scope — merged & frozen, `3521d811`), Readiness-2 (E2E user
journey acceptance — merged & frozen, merge `580d8999`).
**Outcome:** `APP_VERSION` 2.9.0 → **2.10.0** (*Governed Workspace*), `SCHEMA_VERSION` **6**
(unchanged), `ACTIONS` **20** (unchanged).

---

## 1. What this assignment owned

Readiness-1 closed the privacy gap; Readiness-2 proved the eight primary journeys end to end. Both
deferred the release decision itself, and both deferred two acceptance items that could only be
proven through real browser file I/O. Readiness-3 owns the packaging: the version decision, the
release paperwork, the pilot operating model, and the two deferred acceptances.

It is a **release-candidate** assignment. No tag is created and no GitHub Release is published.

## 2. The version decision — and why not 3.0.0

**Chosen: 2.10.0.**

`APP_VERSION` is the single source of truth in `js/core/constants.js`; `tools/app-version.js` parses
it and derives the artifact filename, and both CI and the Release workflow derive from that. The
version format accepted by the tooling is `x.y.z` with an optional hotfix letter.

- **Minor, not patch.** Since v2.9.0 main gained materially new backward-compatible capability:
  complete mutation authorization, Employee self-only read scope, the C3 integration freeze, the
  UX-006D presentation line, and the Readiness E2E acceptance.
- **Minor, not major.** No breaking change: no schema migration, no storage-key change, no removed
  capability, and existing backups remain compatible in both directions. The roadmap references
  v3.0 *criteria*, but those criteria are not met — the readiness audit's Decision Q2 was the
  self-only read criterion, and meeting it is what earns a minor bump, not a major one. Bumping to
  3.0.0 because a roadmap document mentions v3.0 would be version theatre.
- **`SCHEMA_VERSION` stays 6.** There is no migration, and inventing one purely to accompany a
  version bump would violate the standing invariant that the schema version moves only for real data
  migrations.

**Release name:** *Governed Workspace* — the release that makes the workspace governed (authorized
mutations, scoped reads) rather than merely presented.

## 3. RC identity — expressed in paperwork, not in runtime

`tools/app-version.js` rejects prerelease suffixes, and the canonical artifact filename is derived
from `APP_VERSION` (`tam-os-v<version>.html`). Encoding `-rc1` into the runtime version would either
break that derivation or require inventing a second version format — a second source of truth, which
the constitution forbids.

**Decision:** the runtime version is exactly `2.10.0`, and the artifact is the repository-conformant
`dist/tam-os-v2.10.0.html`. The RC marker lives in `RELEASE_NOTES.md`, `README.md` and the pilot
documents, which state plainly that the version is a candidate and is not published or tagged. The
verifier enforces that honesty (§5).

**No tag.** No documented RC-tag policy exists, so the default applies.

## 4. Deferred acceptances, now closed

### 4.1 Real `.xlsx` upload
Driven through the actual `#fileInput` with a genuine `File` object carrying real `.xlsx` bytes
(fabricated payroll data, generated with a throwaway stdlib script — no dependency added, fixture
never committed). Exercised on **both** artifacts: parse → preview → production Smart Import model
builder → commit → pre-import safety backup → `import.commit` audit → undo → `import.undo` audit.
Not a `buildSmartImport()` call: the real parser, the real handler and the real UI path all ran.

**Recorded pilot dependency:** `.xlsx` parsing uses the CDN-hosted, integrity-pinned SheetJS build
referenced from `index.html`. The portable build inlines the repository's own CSS and JS but not
that external script, so **`.xlsx` import does not work offline**. `.csv` import is unaffected.

### 4.2 Real backup-file roundtrip
Export driven from the Settings button, capturing the exact bytes handed to the browser download;
state then mutated and cleared; the same bytes fed back through the real `#importCompleteFile` input
as a `File`; the preview validated `schemaVersion 6` before anything was written; restore recovered
the prior state and persisted it. Wrong Start Fresh confirmation left state intact; the correct
confirmation cleared the expected stores. Exercised on both artifacts.

## 5. Changes made

**Runtime (4 files).**
- `js/core/constants.js` — `APP_VERSION` 2.10.0, `APP_RELEASE_NAME` *Governed Workspace*.
- `index.html` — `<title>` follows the version.
- `js/ui/settings-about.js` — the in-app Release Notes gain the 2.10.0 entry.
- `js/ui/identity-selector.js` — **first-boot guidance only.** The no-principal helper line now names
  the cause of the empty workspace and the single action that resolves it. Presentation only: the
  fail-closed null principal is untouched, nothing selects/defaults/persists a principal, and there
  is no automatic CEO (§6 of the assignment).
- `js/import/smart-import-commit.js` — **the one product fix**, see §6.

**Tooling.** `tools/verify-build.js` release-identity guardrails moved from "v2.9.0 published" to
"v2.10.0 candidate", with v2.9.0 preserved as published history and new checks that the paperwork
makes no false published/tagged claim and carries the trust-model caveat. The deliberate
`APP_VERSION === '2.9.0'` pins in `verify-build.js`, `verify-readiness2-e2e-runtime.js` and
`verify-ux006d3-presentation-runtime.js` — each written to defer the release decision to Readiness-3
— were moved with that decision.

**Documentation.** `RELEASE_NOTES.md`, `CHANGELOG.md`, `README.md`, this plan, and three new
operator documents in `docs/06-releases/`: the pilot guide, the rollback plan, and the release
checklist.

## 6. The one product defect found and fixed

**`smartRollbackPreview()` reported created-counts as removal-counts.**

The undo deliberately retains any created record still reachable from a transaction it may not
delete — an executed or modified transaction is never rolled back, its payroll plan survives with
it, and the contract and employee those reference survive in turn. The preview did not model that:
it returned `c.employees.length` / `c.contracts.length` / `c.payrollPlans.length` verbatim.

Importing TAM's standard workbook shape — one with a `Realisasi` column — produces exactly that
case, so the common path told the operator "will remove 3 employees, 3 contracts, 3 payroll plans",
removed none of them (correctly), and then wrote an `import.undo` **audit entry recording deletions
that never occurred**.

Severity **P2**: misleading feedback and an inaccurate audit record in a finance application. Not
data loss — the data behaviour was already the safe one, and remains byte-for-byte unchanged.

**Fix.** Retention is computed once in `smartRollbackPreview()` using the same predicates the undo
applies, and the undo consumes those sets instead of recomputing them — so what is reported and what
is removed cannot drift. The confirmation dialog and the audit entry now state both the removals and
the retentions, and explain the retention. Verified in the browser on both artifacts, in both the
executed-transaction case (0 removed, retention explained) and the planned-only case (batch removed
exactly).

## 7. First-boot principal — what was deliberately *not* done

The Atlas ruling was: do not silently default to CEO, do not weaken null fail-closed, and add a
remembered principal only if the architecture already supports it safely.

`LocalIdentityProvider` holds the selection in a provider-private variable and persists nothing.
There is no existing approved persistence mechanism for a principal, so **none was added** — a
remembered principal would have been new identity semantics, not a presentation change. The selector
already renders a non-value placeholder, an explicit "No workspace / Select a principal to begin"
context, and a help line. Only that help line's wording changed.

Confirmed in the browser: first boot selects nothing, discloses nothing, and denies every probed
capability under the null principal.

## 8. Disabled-reason discoverability — audited, documented, deferred

Audited on the real UI. Denied controls are `disabled`, carry `data-authz-denied="1"` and a `title`
giving the reason, and **none are hidden** — full navigation stays visible in both principal
contexts.

- **Mouse:** the reason is discoverable on hover. Works.
- **Keyboard:** a `disabled` control is not focusable, so the tooltip cannot be reached.
- **Touch:** no hover, so the tooltip cannot be reached.

The assignment permits accepting this for a tightly controlled desktop-only pilot and documenting the
limitation. That is the ruling taken: **no change to `can()`, no change to C3 semantics, nothing
hidden, and nothing made misleadingly focusable.** It is recorded as a general-use blocker and a
post-pilot item; the accessible fix (adjacent help text or `aria-describedby`) is a presentation
change that should be made deliberately, not squeezed into a release-candidate assignment.

## 9. Verification

| Gate | Result |
|---|---|
| Verifier | **2443 PASS / 0 FAIL** (baseline 2439; +4 net from the new RC guardrails) |
| Runtime harnesses | **2921 PASS / 34 harnesses / 0 FAIL** |
| Readiness-1 | **119 PASS** |
| Readiness-2 | **96 PASS** |
| Deterministic build | two consecutive builds byte-identical |
| Artifact | `dist/tam-os-v2.10.0.html`, 1,151,267 bytes, SHA-256 `60382271a6dcea23431fabb91e0d16abb03196e5cf64c6dc4da1e1af2c7fa704` |
| Browser | modular source + portable build, zero application console errors |

No frozen count fell.

## 10. What Readiness-3 does not do

It does not publish, tag, or release. It does not start the pilot — the maintainer's sign-off on the
release checklist is the gate for that. It does not fix the general-use blockers in §8 and in the
checklist's section G, which are deliberately out of scope for a controlled pilot.

**Next:** maintainer review → merge → maintainer approval → **controlled pilot**.
