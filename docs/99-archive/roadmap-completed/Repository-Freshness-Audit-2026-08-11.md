# Repository Freshness Audit — 2026-08-11

**Type:** Documentation / governance housekeeping. **No product or runtime change.**
**Baseline:** `main` @ `2d33b00fedeca1f0f2aab46e96a2cd45445fa026` (clean working tree, `main == origin/main`)
**Trigger:** post-sign-off synchronization after the controlled-pilot roadmap merge (PR #136).

---

## 1. Baseline gate — verified GREEN before any edit

| Invariant | Expected | Observed | Result |
|---|---|---|---|
| `main` SHA | `2d33b00f…` | `2d33b00f…` | ✅ |
| `origin/main` SHA | `2d33b00f…` | `2d33b00f…` | ✅ |
| Working tree | clean | clean | ✅ |
| `APP_VERSION` | 2.10.0 | 2.10.0 | ✅ |
| `APP_RELEASE_NAME` | Governed Workspace | Governed Workspace | ✅ |
| `SCHEMA_VERSION` | 6 | 6 | ✅ |
| `ACTIONS` / `ACTION_SET` / `POLICY` / `ACTION_RESOURCE_ENTITY` | 20 / 20 / 20 / 20 | 20 / 20 / 20 / 20 | ✅ |
| Verifier | 2443 PASS / 0 FAIL | 2443 PASS / 0 FAIL | ✅ |
| Runtime | 2921 PASS / 34 harnesses / 0 FAIL | 2921 PASS / 34 harnesses / 0 FAIL | ✅ |
| Readiness-1 | 119 PASS | 119 PASS | ✅ |
| Readiness-2 | 96 PASS | 96 PASS | ✅ |
| Artifact | `dist/tam-os-v2.10.0.html`, 1,151,267 B | identical | ✅ |
| Artifact SHA-256 | `60382271a6dcea23431fabb91e0d16abb03196e5cf64c6dc4da1e1af2c7fa704` | identical | ✅ |

**GitHub state verified independently:** tags end at `v2.9.0` (**no `v2.10.0` tag**); the latest GitHub
Release is `TAM OS v2.9.0`, marked Latest (**no v2.10.0 Release, no published v2.10.0 asset**); **0 open
PRs**; the only remote branch is `main`. This matches the authoritative baseline exactly.

## 2. Methodology

1. Gate on the baseline; refuse to edit anything until every invariant above was confirmed mechanically.
2. Enumerate the documentation surface — 198 Markdown files across the root, `docs/`, `audit/` and `.github/`.
3. Establish ground truth **from source and tooling, not from prose**: `js/core/constants.js`,
   `js/core/authz.js`, `tools/app-version.js`, `tools/module-order.js`, `tools/verify-build.js`, the 34
   runtime harnesses, `index.html`, `dist/`, and live `gh` queries for tag/Release/PR/branch state.
4. Mechanically scan for the known stale patterns (version strings, artifact names, ACTIONS counts,
   verifier/harness counts, "not started" / "not implemented" / "pending" / "current" / "Latest",
   pilot-launch language, offline/self-contained claims, rejected action names).
5. **Inspect the context of every hit before classifying.** Grep hits are candidates, never proof.
6. Classify each hit; correct only current-state sources of truth; leave historical records untouched.
7. Re-run the full verification suite and re-scan.

## 3. Files inspected

**Read in full or in substantial part (24):** `AI_CONTEXT.md`, `ARCHITECTURE.md`, `README.md`,
`CLAUDE.md`, `CHANGELOG.md`, `RELEASE_NOTES.md`, `CONTRIBUTING.md`, `SECURITY.md`,
`docs/README.md`, `docs/01-roadmap/README.md`, `docs/01-roadmap/Milestone_Roadmap.md`,
`docs/05-milestones/Milestones.md`, `docs/06-releases/README.md`,
`docs/06-releases/Controlled-Pilot-Signoff-v2.10.0.md`, `docs/06-releases/Release-Checklist-v2.10.0.md`,
`docs/06-releases/Pilot-Guide-v2.10.0.md`, `docs/adr/README.md`,
`docs/adr/ADR-0002-canonical-distribution-architecture.md`, `docs/00-governance/Atlas_Governance_Register.md`,
`.github/RELEASE_TEMPLATE.md`, `.github/workflows/release.yml`, `.github/workflows/ci.yml`,
`.github/codeql/codeql-config.yml`, `.github/CODEOWNERS`.

**Pattern-scanned (all 198 Markdown files),** including every `docs/01-roadmap/UX-*` and `Readiness-*`
plan, `docs/03-adr/`, `docs/04-standards/`, `docs/RDR/`, `docs/DPR/`, `docs/ECR/`, `docs/security/`,
and all of `audit/`.

## 4. Findings

**Candidate stale statements surfaced by mechanical scanning: 61 (first pass) + 12 (post-edit re-scan).**
**Confirmed stale current-state statements: 32.** **Deliberately preserved as historical: 33.**
**Ambiguous / no action: 4.**

### 4.1 Contradictions found (3)

| # | Location | Contradiction |
|---|---|---|
| C-1 | `AI_CONTEXT.md` header | v2.8.6 described as "no longer Latest" and "marked Latest" in the same sentence |
| C-2 | `AI_CONTEXT.md` §16 vs. header | §16 said screenshots and the social-preview image were "planned, not yet captured"; the header records them as delivered under MAINT-001 Follow-Up |
| C-3 | `AI_CONTEXT.md` §15 / `ARCHITECTURE.md` release pipeline | Both claimed the workflow titles Releases `TAM Intelligence OS <tag>`; `release.yml` actually emits `TAM OS $TAG`, and the published v2.9.0 Release is titled `TAM OS v2.9.0` |

### 4.2 Corrections applied

| # | File | Was | Now | Class |
|---|---|---|---|---|
| 1 | `AI_CONTEXT.md` header | "current source state: v2.9.0 — Workspace Experience" | v2.10.0 *Governed Workspace*, `ACTIONS` 20, RC **not published / not tagged**, pilot **approved but not launched** | STALE |
| 2 | `AI_CONTEXT.md` header | v2.8.6 "no longer Latest … and marked Latest" | published, **no longer Latest** — v2.9.0 holds it | CONTRADICTORY |
| 3 | `AI_CONTEXT.md` artifact table | "current repository artifact `dist/tam-os-v2.9.0.html`", 2-column table | 3-column table adding the **unpublished** `dist/tam-os-v2.10.0.html` (1,151,267 B, `60382271…`) and noting the v2.9.0 dev artifact was removed by the dist-swap | STALE |
| 4 | `AI_CONTEXT.md` §5 | "66 JS modules … 65 browser-loaded" | **73 modules, 72 browser-loaded** | STALE |
| 5 | `AI_CONTEXT.md` §6 | "2001 on the UX-005F branch; 1979 on `main`", "eighteen" harnesses, "1552" | **2443**, **thirty-four**, **2921** | STALE |
| 6 | `AI_CONTEXT.md` §14 | "v2.8.5 is the latest published release … v2.8.4 … no longer Latest" | **v2.9.0** latest published; v2.8.6 and earlier no longer Latest; v2.10.0 deliberately untagged | STALE |
| 7 | `AI_CONTEXT.md` §15 | Release title `TAM Intelligence OS <tag>`, example v2.8.4 | `TAM OS <tag>`, example v2.9.0; pre-branding titles preserved and never rewritten | INCORRECT |
| 8 | `AI_CONTEXT.md` §16 | verifier 2001/1979, eighteen harnesses, stale 18-harness enumeration | **2443**, **thirty-four**, **2921**, corrected top-14 enumeration | STALE |
| 9 | `AI_CONTEXT.md` §16 | screenshots/social image "planned, not yet captured" | **delivered** (MAINT-001 Follow-Up); only the GitHub Settings upload remains manual | CONTRADICTORY |
| 10 | `AI_CONTEXT.md` §17 | "v2.8.5 — current, and the latest published release" | v2.9.0 latest published; v2.10.0 **prepared but not published** | STALE |
| 11 | `AI_CONTEXT.md` §17 | "**UX-004 has not begun, and UX-005 has not begun**" | UX-004, UX-005A–F, the Platform Freeze Review and **UX-006 A–D are complete and frozen**; forward sequence restated with pointers | STALE |
| 12 | `AI_CONTEXT.md` §18 | "eighteen targeted runtime harnesses" | **thirty-four** | STALE |
| 13 | `AI_CONTEXT.md` §19 | CSS pin `26bf8286…` "revised once for UX-004F" | **`6d9c2137…`**, last revised for **UX-006D3** | STALE |
| 14 | `AI_CONTEXT.md` §17 | "Under consideration: authentication and role-based access control" | replaced by the explicit **multi-user requirement** entry pointing at the new note | SUPERSEDED |
| 15 | `README.md` ×4 | "2001-check verifier" / "(2001 checks)" ×3 | **2443** | STALE |
| 16 | `README.md` Roadmap | "Next, in order: MAINT-001 / v2.9.0 Release Preparation / UX-006 … **Not started.**" | all three marked complete, plus Readiness-1/2/3; new "Next" = Controlled Pilot → Post-Pilot → Exit Review → Distribution-1 → General-Use → v3.0.0 | STALE |
| 17 | `ARCHITECTURE.md` "Shape today" | "66 … 65 browser-loaded", `dist/tam-intelligence-os-v${APP_VERSION}.html` | **73 / 72**, **`dist/tam-os-v${APP_VERSION}.html`**, `ACTIONS` 20 added | STALE |
| 18 | `ARCHITECTURE.md` Verification | "1855 checks; **fifteen** harnesses — 1467" | **2443**, **thirty-four**, **2921**, corrected enumeration | STALE |
| 19 | `ARCHITECTURE.md` diagram | "js/ — 66 modules: 65 browser-loaded" | **73 / 72** | STALE |
| 20 | `ARCHITECTURE.md` release pipeline | `TAM Intelligence OS <tag>` / v2.8.5 example | `TAM OS <tag>` / v2.9.0; pre-branding titles preserved | INCORRECT |
| 21 | `CONTRIBUTING.md` | "one self-contained file `dist/tam-intelligence-os-v<APP_VERSION>.html`" | "single-file application package `dist/tam-os-v<APP_VERSION>.html`" + the ADR-0002 not-fully-offline caveat | STALE + DISTRIBUTION WORDING |
| 22 | `.github/RELEASE_TEMPLATE.md` | "dist/tam-intelligence-os-vX.Y.Z.html" | **"dist/tam-os-vX.Y.Z.html"** | STALE |
| 23 | `docs/01-roadmap/README.md` ×6 | UX-004 "(not started)"; UX-006 "(NOT IMPLEMENTED)"; UX-006C2 "(NOT IMPLEMENTED)"; UX-006C "awaiting owner review"; UX-006C2C "(PLANNING ONLY — NOT IMPLEMENTED)"; C2C-3/4 "in decision preparation" ×2 | each corrected to its actual merged/frozen state | STALE |
| 24 | `docs/01-roadmap/Milestone_Roadmap.md` | table jumped **Epsilon → Zeta**, omitting the entire current programme | five rows added: Controlled Pilot (**NOT YET LAUNCHED**), Post-Pilot, Exit Review, Distribution-1, General-Use Readiness | STALE / INCOMPLETE |

**Second-pass corrections.** The post-edit mechanical re-scan (§6 of the methodology) surfaced eight
further stale current-state statements that the first pass missed — recorded here rather than quietly
folded in, because they show the re-scan was load-bearing and not a formality:

| # | File | Was | Now | Class |
|---|---|---|---|---|
| 25 | `ARCHITECTURE.md` CSS pin | `26bf8286…` "revised once for UX-004F" | **`6d9c2137…`**, last revised for **UX-006D3** | STALE |
| 26 | `ARCHITECTURE.md` build diagram | "verify-build.js — 1855 invariant checks" | **2443** | STALE |
| 27 | `ARCHITECTURE.md` release diagram | "Upload portable asset — `tam-intelligence-os-vX.Y.Z.html`" | **`tam-os-vX.Y.Z.html`** | STALE |
| 28 | `README.md` ×3 (distribution table, load-order prose, project-structure tree) | "66 modules / 65 browser-loaded" | **73 / 72** | STALE |
| 29 | `CONTRIBUTING.md` | "**65 browser-loaded** … a 66th module `js/cli/cli.js`" | **72 browser-loaded … a 73rd module** | STALE |
| 30 | `docs/QA-CHECKLIST.md` | `dist/tam-intelligence-os-v<APP_VERSION>.html` | **`dist/tam-os-v<APP_VERSION>.html`** | STALE |
| 31 | `docs/DEPLOYMENT.md` | `dist/tam-intelligence-os-v<version>.html` | **`dist/tam-os-v<version>.html`** | STALE |
| 32 | `docs/RELEASE-PROCESS.md` ×3 | build output, `gh release create` asset + `--title "TAM Intelligence OS vX.Y.Z"`, asset-verification name | **`tam-os-v…`** and **`--title "TAM OS vX.Y.Z"`**, matching `release.yml` | STALE |

### 4.3 Deliberately preserved as INTENTIONALLY HISTORICAL (not edited)

- **`AI_CONTEXT.md` per-phase narrative paragraphs** — the UX-006A/B/C1/C2A/C2B/C2C-1/C2C-2/D1 blocks
  carry the verifier, runtime, artifact-size, SHA, `ACTIONS` (13 / 16 / 17) and `APP_VERSION` **2.9.0**
  values that were true **at that phase**, plus "C2C has not begun"-style statements scoped to their
  moment. These are a deliberate delivery record, not current-state claims.
- **`ARCHITECTURE.md` phase blockquotes** — same rationale (`ACTIONS` 13/16/17, `APP_VERSION` 2.9.0,
  "C2C-3/4 remain unwired").
- **`RELEASE_NOTES.md` prior-release sections** — including the v2.8.6 "Release state" block ending
  "**UX-005 has not begun.**" That was accurate for v2.8.6 and is historical release copy.
- **`CHANGELOG.md`** — historical by definition; the v2.10.0 entry is current and correct.
- **All `docs/01-roadmap/UX-*` and `Readiness-*` implementation plans** — frozen plan documents whose
  bodies record contemporaneous baselines, counts and next-steps. Only the **index descriptions** of
  them in `docs/01-roadmap/README.md` were corrected, because an index states current status.
- **`docs/RDR/`, `docs/DPR/`, `docs/ECR/`, `audit/`** — immutable dated point-in-time records.
- **`docs/03-adr/`, `docs/adr/`, `docs/security/`** — decision records; immutable once Accepted.
- **`MAINT-001-repository-maintenance.md` §7** — "recorded, not started" follow-up backlog; still true.
- **`Post-UX-006D-User-Readiness-Audit.md`** R-8 / R-9 "NOT STARTED" — UX-006E and UX-006F genuinely
  have not started. **FUTURE / DEFERRED — STILL VALID.**
- **`.github/codeql/codeql-config.yml`** reference to `tam-intelligence-os-v2.5.2.html` — that file is
  the intentionally retained JS-provenance golden master and still exists at the repository root.
  **CURRENT AND CORRECT.**

### 4.4 Verified clean — no correction needed

- **Pilot state.** Every pilot statement across the repository already says **approved / not launched /
  no launch date**. **Zero** launch, "in progress", "live" or "running" claims exist. No launch date
  appears anywhere.
- **`ACTIONS = 20`** in every current-state document; the three rejected actions (`recurring.manage`,
  `bank.manage`, `employee.merge`) are recorded as **REJECTED** everywhere they appear — in
  `js/core/authz.js`, in the C2C-3/4 mapping proposal, and as negative assertions in two harnesses.
  None is presented as current.
- **`SCHEMA_VERSION = 6`** consistently; no current-state document claims an older schema.
- **Distribution wording.** `README.md`, `ARCHITECTURE.md`, `ADR-0002`, `Milestones.md`,
  `Release-Checklist-v2.10.0.md`, `Controlled-Pilot-Signoff-v2.10.0.md` and `Pilot-Guide-v2.10.0.md`
  all describe the artifact accurately as a **single-file application package, not fully offline**
  (SheetJS required for `.xlsx`; Google Fonts cosmetic). Only `CONTRIBUTING.md` was out of line (fixed).
- **`RELEASE_NOTES.md`, `CHANGELOG.md`, `docs/05-milestones/Milestones.md`,
  `docs/06-releases/README.md`, `docs/README.md`, `SECURITY.md`, `docs/adr/README.md`** — all already
  current after PR #135/#136. ADR-0002 correctly registered as **Accepted**; SDR-0001 correctly listed.
- **PR / branch / release state.** No document references an open PR, an undeleted branch, or a
  v2.10.0 tag/Release. Repository documentation matches live GitHub state.
- **Workflows and CI** (`ci.yml`, `release.yml`, `dependabot.yml`, `CODEOWNERS`, issue templates) —
  version is derived at runtime via `tools/app-version.js`; no hardcoded stale version anywhere.

### 4.5 NEEDS GOVERNANCE RULING — not changed

| # | Item | Why it was not touched |
|---|---|---|
| G-1 | `CLAUDE.md` §1/§3/§4.3/§10 describe the product as "no runtime dependencies" and the build as "a single self-contained HTML file" — which ADR-0002 qualified | `CLAUDE.md` is the constitution and is **explicitly out of scope** for this audit. **ADR-0002 itself rules that `CLAUDE.md` is unamended and fully operative for v2.10.0**, and scopes the §3/§5/§10/§11/§12/§13/§15/§19 amendment to the **Distribution-1** milestone. Correct disposition: leave it; Distribution-1 owns it. |
| G-2 | The multi-user requirement conflicts with the `CLAUDE.md` §4.3 client-only MUST | Recorded, **not resolved** — see [Multi-User-Requirement-Note.md](Multi-User-Requirement-Note.md) §3 and its four open questions MU-1…MU-4. No amendment attempted. |
| G-3 | `AI_CONTEXT.md` §2 calls the product a self-contained "operations OS" | Reads as *independent of external business systems*, not as a packaging claim, and §16 carries the accurate CDN caveat. Left as-is; flagged for the maintainer rather than silently reworded. |
| G-4 | `Milestones.md` says the forward-looking view is the Milestone Roadmap, which had omitted the pilot track | The omission was corrected additively (finding 24). Whether the Alpha→Omega lettered track and the pilot programme should be **one** track is a governance question, not an audit call. |

## 5. New multi-user requirement note

Created [`docs/01-roadmap/Multi-User-Requirement-Note.md`](Multi-User-Requirement-Note.md), classified
**NEW MAINTAINER REQUIREMENT — NOT YET ARCHITECTED**. It records the five stated needs (shared company
data, real authentication, backend/shared persistence, server-side authorization and read scope,
multi-user deployment), contrasts them line-by-line with the approved local/trust-based v2.10.0 pilot
model so the two can never be conflated, states the `CLAUDE.md` §4.3 conflict and the amendment +
ADR + SDR sequence it would require, and explicitly chooses **no backend technology**, proposes **no
architecture**, schedules **no milestone**, and authorizes **no implementation**. It is registered in
the roadmap index and cross-referenced from `AI_CONTEXT.md` §17.

## 6. Verification after the corrections

| Check | Expected | Observed | Result |
|---|---|---|---|
| Verifier | 2443 PASS / 0 FAIL | 2443 PASS / 0 FAIL | ✅ |
| Runtime | 2921 PASS / 34 harnesses / 0 FAIL | 2921 PASS / 34 harnesses / 0 FAIL | ✅ |
| Readiness-1 | 119 PASS | 119 PASS | ✅ |
| Readiness-2 | 96 PASS | 96 PASS | ✅ |
| `APP_VERSION` | 2.10.0 | 2.10.0 | ✅ |
| `SCHEMA_VERSION` | 6 | 6 | ✅ |
| `ACTIONS` / `ACTION_SET` / `POLICY` / `ARE` | 20 / 20 / 20 / 20 | 20 / 20 / 20 / 20 | ✅ |
| Artifact size | 1,151,267 B | 1,151,267 B | ✅ |
| Artifact SHA-256 | `60382271…2c7fa704` | identical | ✅ |
| Diff under `js/ css/ tools/ index.html dist/ CLAUDE.md .gitattributes` | **zero** | **zero** | ✅ |

The single file touched under `.github/` is `RELEASE_TEMPLATE.md` — a documentation template carrying a
stale artifact-name pattern (`tam-intelligence-os-vX.Y.Z.html`, superseded by `tam-os-vX.Y.Z.html` in
`tools/app-version.js`). No workflow, action, permission or guardrail was modified.

**Release/tag preservation:** no tag created, moved or deleted; no GitHub Release created or edited; no
release asset published. `v2.9.0` remains Latest, `v2.10.0` remains untagged and unpublished, and all
historical release records are untouched.

## 7. Final state

**Current truth after this audit:**

- **v2.10.0 *Governed Workspace*** — release candidate, `SCHEMA_VERSION` 6, `ACTIONS` 20,
  `dist/tam-os-v2.10.0.html` (1,151,267 B, `60382271…2c7fa704`), frozen. **No tag. No GitHub Release.**
- **v2.9.0 *Workspace Experience*** — latest published release, marked Latest, immutable.
- **Controlled Pilot** — **APPROVED / READY TO START / NOT YET LAUNCHED.** No launch date.
- **UX-006D, Readiness-1, Readiness-2, Readiness-3** — complete / merged / frozen.
- **Next:** Post-Pilot Findings & Remediation → Pilot Exit Review → Distribution-1 → General-Use
  Readiness → UX-006F / v3.0.0.
- **Multi-user operation** — recorded as a new maintainer requirement; **not architected, not authorized.**

**Known stale current-state statements remaining: 0.** Remaining mechanical hits on the stale-pattern
list are intentionally historical records or correct forward-looking statements, as enumerated in §4.3.
