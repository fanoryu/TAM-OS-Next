# GHA-002 — GitHub & Repository Comprehensive Post-Release Audit

| Field | Value |
|---|---|
| **Record** | GHA-002 |
| **Title** | GitHub & Repository Comprehensive Post-Release Audit |
| **Owner** | Forge (engineering) |
| **Status** | Complete — recorded |
| **Founder (Norman)** | Approved |
| **Atlas (CTO)** | Approved |
| **Distribution** | Forge · Repository |
| **Date** | 2026-08-04 |
| **Baseline commit** | `b8c27a9cfe5d525576dc37b69658b79dc2f6b34a` (`main`) |
| **APP_VERSION / APP_RELEASE_NAME** | 2.8.4 / Monthly Plan Result Integrity |
| **SCHEMA_VERSION** | 6 |
| **Release tag audited** | `v2.8.4` (annotated) → `bd8819af0287af02711898cf43d22fb70cc3bcd5` |
| **Mode** | Read-only. No repository, GitHub, or release modification occurred during the audit. |
| **Decision** | `GHA-002 CONDITIONALLY READY` |
| **Predecessor** | [GHA-001](../github-audit-2026-08-02/GHA-001-github-repository-comprehensive-audit.md) (2026-08-02, v2.7.3) |
| **Related** | [SDR-0001](../../docs/security/SDR-0001-codeql-baseline-disposition.md), [ADR-013](../../docs/03-adr/ADR-013-Repository-Layer.md), [RDR-011](../../docs/RDR/RDR-011-epsilon-repository-snapshot.md), [ECR-001](../../docs/ECR/ECR-001-milestone-epsilon-closure-record.md), [Architecture Evolution Backlog](../../docs/02-architecture/Architecture_Evolution_Backlog.md), [Sanitization Record 2026-07-31](../sanitization-2026-07-31/SANITIZATION_RECORD.md) |

---

## 1. Purpose

This is the immutable, dated record of the comprehensive read-only audit of the
`fanoryu/TAM-Intelligence-OS` repository and its GitHub state at commit `b8c27a9`, performed after the
v2.8.4 controlled release and the post-release documentation synchronization. It is a point-in-time audit
(per `CLAUDE.md` §18 `audit/`), not a decision record.

Recording this audit **closes no finding**. Every controlling condition and follow-up named here requires
separate authorization to act upon.

---

## 2. Executive Summary

The repository is healthy, deterministic, verifier-green, and internally consistent. **No Critical and no
High findings.** The v2.8.4 release is reproducible and trustworthy: a rebuild from clean `main` is
byte-identical to the committed artifact, the published asset is byte-identical to both, and the published
Release body is byte-identical to `RELEASE_NOTES.md` at the tagged commit. Three artifacts — modular
source, committed dist, and the downloaded published asset — each boot with zero console messages and
empty seed data. Runtime confirms 14 registered commands / 4 queries, matching documentation exactly, and
the retired Payroll Planning posting surface is absent.

**Five Medium findings** concentrate in governance, security controls, and documentation consistency:
`main` carries no branch protection or rulesets (M-1); two active documents falsely state a company
workbook is tracked, when it was purged on 2026-07-31 (M-2); secret scanning and push protection are
disabled (M-3); no automated invariant ties documentation to version, tag, or Release state (M-4); and the
ARCH-006 residual Contract write authority remains open as Planned (M-5).

**Decision: `GHA-002 CONDITIONALLY READY`** — controlled by three bounded conditions (M-2, M-1, M-3), not
by code blockers. M-4, M-5, and L-5 are tracked follow-ups, not controlling conditions.

---

## 3. Baseline Confirmation

| Item | Expected | Observed |
|---|---|---|
| Branch / sync | `main`, synced with origin | ✅ |
| HEAD | `b8c27a9…` | `b8c27a9cfe5d525576dc37b69658b79dc2f6b34a` ✅ |
| Working tree | clean | clean, no untracked ✅ |
| APP_VERSION / RELEASE_NAME / SCHEMA | 2.8.4 / Monthly Plan Result Integrity / 6 | ✅ |
| Tag `v2.8.4` | annotated, peels to `bd8819a…` | tag object `21a602c` ✅ |
| Release | published, not draft, not prerelease, Latest | ✅ |
| v2.8.3 | published, no longer Latest | ✅ |
| Artifact / published asset | 914,409 B / `09c622b3…a02c6` | both, byte-identical ✅ |
| Verifier | pass | 1267 checks OK ✅ |
| Runtime harnesses | 424 | 118 / 106 / 61 / 67 / 72 ✅ |
| Build determinism | byte-identical | confirmed ✅ |

---

## 4. Audit Method and Evidence Sources

Read-only Git and GitHub REST inspection; source inspection; the full verification suite; a temporary
rebuild for determinism (working tree left clean); published-asset download and byte comparison;
Release-body comparison against the tagged file; and browser boots of three artifacts using fabricated or
empty data only.

Read every document listed under Required Reading — the governance and standards corpus
(`docs/00-governance/`, `docs/04-standards/`), repository current-state documentation (`README.md`,
`AI_CONTEXT.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`), roadmap and architecture context
(`docs/01-roadmap/`, `docs/02-architecture/Architecture_Evolution_Backlog.md`), both ADR registers
(`docs/03-adr/README.md`, `docs/adr/README.md`), security and data-safety records (`SECURITY.md`,
`docs/security/SDR-0001`, `docs/DATA-SAFETY.md`), release and QA documentation
(`docs/RELEASE-PROCESS.md`, `docs/QA-CHECKLIST.md`, `CHANGELOG.md`, `RELEASE_NOTES.md`), GHA-001, and
directly relevant referenced records (the 2026-07-31 sanitization record, ADR-013, RDR-011, ECR-001). All
Required Reading paths were confirmed present.

---

## 5. Findings Summary

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 5 | M-1, M-2, M-3, M-4, M-5 |
| Low | 5 | L-1, L-2, L-3, L-4, L-5 |
| Informational | 6 | I-1 … I-6 |

---

## 6. Detailed Findings

### M-1 — `main` has no branch protection and no rulesets

- **Observed:** `GET /branches/main/protection` → 404 "Branch not protected"; `GET /rulesets` → `[]`.
- **Governing source:** `CLAUDE.md` §15.3 (no force-push / history rewrite — MUST), §11.1, §20.
- **Evidence:** GitHub REST API at audit time.
- **Impact:** Nothing mechanically prevents a direct push to `main` bypassing CI, or a force-push that
  would rewrite history and invalidate published release tags. Observed practice is disciplined: 47 merged
  pull requests, no direct pushes to `main` outside merges, and 100 of the last 100 workflow runs green.
- **Temporal classification:** Latent.
- **Disposition:** Open — controlling condition B.
- **Recommended action:** Enable branch protection or a ruleset requiring `build-and-verify` + CodeQL and
  blocking force-push; **or** create a formal governance risk-acceptance record meeting the ten-element
  requirement in §11.
- **Record type:** Governance record or SPR.

### M-2 — Documentation asserts a tracked company workbook that was purged

**Class 1 — current, actionable documentation drift**

- **Observed:** `AI_CONTEXT.md:347` and `CONTRIBUTING.md:36–37` describe a real company workbook as
  "intentionally tracked as a documented, accepted exception," with `CONTRIBUTING.md` binding contributors
  not to move, untrack, or delete it.

**Class 2 — historical published inaccuracy**

- **Observed:** `RELEASE_NOTES.md:109` **at tag `v2.8.4`**, and the v2.8.4 GitHub Release body derived
  byte-for-byte from that tagged file, contain the same claim.

- **Governing source:** `audit/sanitization-2026-07-31/SANITIZATION_RECORD.md` — the workbook was removed
  from all branches and tags on 2026-07-31 via `git filter-repo`.
- **Evidence:** `git ls-files` → 0 matches; `git rev-list --all --objects` → 0 matches across all
  reachable refs including tags; `git log --all -- "*.xlsx" "*Rencana*"` → 0 commits; repository
  `visibility=public`. **No workbook currently exists in the repository or in reachable history.**
- **Impact:** The statement is false. It errs conservatively — asserting confidential data is present when
  it is absent — and therefore creates **no current confidential-data exposure**. The operational harm is
  that `CONTRIBUTING.md` binds contributors to a rule for a nonexistent file and `AI_CONTEXT.md` seeds
  AI-assisted work with a false premise.
- **Temporal classification:** Class 1 current; Class 2 historical.
- **Disposition:** Open (Class 1); acknowledged historical inaccuracy (Class 2). Controlling condition A.
- **Recommended action:** A documentation SPR correcting **only `AI_CONTEXT.md` and `CONTRIBUTING.md`**.
  The published v2.8.4 GitHub Release body **is not to be rewritten** (`CLAUDE.md` §13.4). Treatment of
  `RELEASE_NOTES.md` on `main` requires a **separate governance decision** and is excluded from the
  immediate corrective SPR — see §18.
- **Record type:** SPR (documentation-only).
- **Note:** The `RELEASE_NOTES.md` occurrence was introduced during SPR-084, carried forward from the
  v2.8.3 notes without validation against the sanitization record.

### M-3 — Secret scanning and push protection disabled

- **Observed:** `GET /secret-scanning/alerts` → 404 "Secret scanning is disabled on this repository."
- **Governing source:** `CLAUDE.md` §7.6, §15.4, §17.1 (never store or commit secrets — MUST).
- **Evidence:** GitHub REST API at audit time.
- **Impact:** Three MUST-level rules have no mechanical enforcement in a public repository that has
  already required one history rewrite to purge confidential material. Both features are available at no
  cost for public repositories. Because scanning is disabled, absence of alerts is **not** evidence of
  absence of secrets; manual inspection found none.
- **Temporal classification:** Latent.
- **Disposition:** Open — controlling condition C.
- **Recommended action:** Enable secret scanning and push protection; **or** create a formal security
  risk-acceptance record meeting the ten-element requirement in §11. Must be closed separately from M-1.
- **Record type:** SDR or governance SPR.

### M-4 — No automated invariant ties documentation to version, tag, or Release state

- **Observed:** `verify-build.js` asserts the in-app Release Notes entry inside the built artifact but
  performs no check against `README.md`, `CHANGELOG.md`, `RELEASE_NOTES.md`, `AI_CONTEXT.md`, or
  `ARCHITECTURE.md`.
- **Governing source:** `CLAUDE.md` §11.1 (a green build is necessary but not sufficient), §16.2.
- **Evidence:** RR-001 identified three release-blocking documentation gaps while the verifier was fully
  green; this audit independently identified M-2 by the same mechanism.
- **Impact:** A demonstrated, recurring drift class detected only by manual review. It is **not** a direct
  runtime or release-integrity blocker at the audited baseline — build, artifact, and release integrity
  are independently verified and clean.
- **Temporal classification:** Current.
- **Disposition:** Open — requires separate decision. **Not a controlling condition.**
- **Recommended action:** A **discovery assignment** to identify which release-state claims are stable,
  machine-readable, and enforceable before any ADR or implementation SPR is authorized. Scoping is
  non-trivial, and not every release-state fact can or should be derived mechanically.
- **Record type:** Discovery, then ADR or SPR. Not implemented during GHA-002.

### M-5 — Residual Contract write authority (carried from GHA-001 M-5)

- **Observed:** `js/people/contracts.js:146` (`rec.status = fd.get('status')`) writes contract status
  outside the `contract.status.transition` aggregate. Lines 182/194 (transition + in-memory rollback) and
  297 (renewal) are correctly handler-owned.
- **Governing source:** Architecture Evolution Backlog **ARCH-006**, status *Planned*, explicitly
  "non-blocking, not a defect, and not implementation authorization."
- **Evidence:** Source inspection at this baseline.
- **Impact:** A second write path for contract status exists outside the aggregate gate. Accurately
  documented and explicitly bounded.
- **Temporal classification:** Latent.
- **Disposition:** Accepted / open as Planned. **Not a controlling condition.**
- **Recommended action:** None new. ARCH-006 governs. This audit's reconfirmation does **not** authorize
  ARCH-006 for implementation.
- **Record type:** None; ARCH-006 already governs.

### L-1 — Four stale local branches

- **Observed:** `docs/pr-4-archivist-structure`, `feature/pr-1-license-apache-2.0`, `pr33`, `pr33rebased`.
- **Governing source:** Repository hygiene; GHA-001 L-1 (which reported two).
- **Evidence:** `git branch -a`; `git ls-remote --heads origin` shows `origin/main` only.
- **Impact:** Local-only clutter; no remote or release impact. **Temporal classification:** Current.
- **Disposition:** Open. **Recommended action:** Prune. **Record type:** Chore.

### L-2 — `delete_branch_on_merge` disabled

- **Observed:** Repository setting `delete_branch_on_merge=false`.
- **Governing source:** Merge Standard (branch cleanup after merge).
- **Evidence:** `GET /repos/fanoryu/TAM-Intelligence-OS`.
- **Impact:** Feature branches survive merge unless `--delete-branch` is passed explicitly; the safety net
  is manual. All recent branches were deleted correctly. **Temporal classification:** Current.
- **Disposition:** Open. **Recommended action:** Repository-setting decision. **Record type:** Chore.

### L-3 — Two ADR series coexist

- **Observed:** `docs/03-adr/ADR-001…013` (domain) and `docs/adr/ADR-0001` (governance).
- **Governing source:** `docs/README.md`; ADR-0001.
- **Evidence:** Directory listing.
- **Impact:** Intentional and documented, but numerically confusable. Carried from GHA-001 L-2 with no
  changed evidence. **Temporal classification:** Current.
- **Disposition:** Accepted. **Recommended action:** None. **Record type:** None.

### L-4 — Release-note template emits a self-stale tag line

- **Observed:** `RELEASE_NOTES.md:125` at tag `v2.8.4` reads ``Release tag: `v2.8.4` *(not yet created)*``,
  which became false at publication and is immutably present in the published Release body. `v2.8.3` shows
  the identical pattern, confirming a template artifact rather than a one-off.
- **Governing source:** `docs/RELEASE-PROCESS.md`; Release Standard.
- **Evidence:** `git show v2.8.4:RELEASE_NOTES.md`; `git show v2.8.3:RELEASE_NOTES.md`.
- **Impact:** Cosmetic inaccuracy in published release bodies. A later edit to `RELEASE_NOTES.md` on
  `main` would **not** modify the tagged file and would **not** break the verified body-match invariant,
  which is anchored to the tagged blob. **Temporal classification:** Historical (published) and current
  (template).
- **Disposition:** Open. **Recommended action:** Change the convention for future releases; leave
  published bodies untouched. **Record type:** Convention change.

### L-5 — SDR-0001 current-state narrative differs from the authorized CodeQL alert disposition

- **Observed:**
  1. SDR-0001 §5 records alert #5 (`js/clear-text-storage-of-sensitive-data`, `activity-log.js`) as
     **AR-1, Accepted Risk**.
  2. SDR-0001 states a **preference** that accepted-risk alerts remain **open and visible, not
     dismissed** — §5: *"Accepted risks remain visible in GitHub Code Scanning (not dismissed) so the
     acceptance is auditable and self-expiring at the review date"*; §4: *"Left open and visible, not
     dismissed"*; §3.1: *"The five High alerts … remain open."*
  3. GitHub currently reports alert #5 as **`dismissed`** (`reason="won't fix"`, 2026-08-01, by
     `fanoryu`).
  4. **The dismissal was authorized.** SDR-0001 **§7.3** pre-approves this exact action and reason for
     Alert A; §7.2 requires Atlas (CTO) approval; the dismissal comment cites *"Per SDR-0001 §7.3;
     approved SPR-054B (Atlas CTO)."* §7.4 states dismissal is *"optional and reversible."* §7.5's
     prohibitions are not engaged (the classification is Accepted Risk, and the dismissal was not made to
     pass a build or scan). **The dismissal was valid.**
  5. The underlying security rationale (AR-1) **remains valid** — the client-only architecture is
     unchanged and no §8 revalidation trigger has fired.
  6. The **current SDR narrative is stale**: §3.1 and §5 still assert as present fact that all five alerts
     are open.
  7. The **self-expiry mechanism described in §5 no longer operates** — a dismissed alert neither remains
     visible in Code Scanning nor self-expires at the review date.
- **Governing source:** SDR-0001 §4, §5, §7.2–§7.5, §8; `CLAUDE.md` §18 (decision records are immutable
  once Accepted and are superseded, never rewritten).
- **Evidence:** `docs/security/SDR-0001-codeql-baseline-disposition.md` lines 92, 114, 157, 174–191;
  `GET /code-scanning/alerts/5`.
- **Impact:** Low. Record currency only. **This is not a vulnerability and not an unauthorized action.**
  No security exposure exists and no rationale is invalidated. The residual effect is that the review-date
  trigger SDR-0001 relied on to force re-examination no longer fires automatically.
- **Temporal classification:** Current (record currency); the authorizing action is historical
  (2026-08-01).
- **Disposition:** Open — requires security-governance follow-up. **Not a controlling condition.** Kept
  separate from M-3: M-3 concerns absent repository-level scanning controls, L-5 concerns
  record-versus-state currency; no governance evidence shows one corrective action closes both.
- **Recommended action:** Revalidate SDR-0001 and determine whether (a) the alert remains dismissed and
  SDR-0001 is **superseded or amended through the proper security-record process**, preserving the
  review-date trigger by another means; or (b) the alert is restored to open if the §5 preferred posture
  is reaffirmed as binding. The alert was not changed during this audit and must not be changed outside
  that process.
- **Record type:** SDR revalidation or successor SDR.

### Informational

- **I-1** Verifier 1267 checks OK; runtime harnesses 118 / 106 / 61 / 67 / 72 = 424.
- **I-2** Rebuild byte-identical; published asset `cmp`-identical to `dist/`; Release body IDENTICAL
  (9,850 characters, normalized) to `RELEASE_NOTES.md` at tag `v2.8.4`.
- **I-3** Modular source, committed dist, and downloaded published asset each boot with zero console
  messages, seed `[]`, and all datasets empty.
- **I-4** Runtime: 14 commands / 4 queries — exactly as documented; Gateway, TransportAdapter, and all
  three Repositories present.
- **I-5** `commitPayroll` and `renderPayrollPlanning` are `undefined` at runtime; `commitReadyPayroll` is
  the sole live Payroll posting path.
- **I-6** 12 tags ↔ 12 releases, one-to-one; no orphaned asset, duplicate tag, or tag without a release.

---

## 7. GHA-001 Follow-Up Disposition

| GHA-001 | Disposition | Basis |
|---|---|---|
| M-1 CodeQL disposition clarity | Resolved | SDR-0001 dispositions all alerts; no new alert class since |
| M-2 Delta baseline snapshot absent | Resolved | RDR-003/007/011, DPR-005/009, ECR-001 published |
| M-3 Operational-surface count clarity | Resolved | Runtime 14/4 matches docs; 8/8/1 stated with explicit bounds |
| M-4 Gateway `{ok}` vs `result.success` | Accepted | Intentional per ATR-004; no new evidence |
| M-5 Residual Contract write authority | **Still open** → GHA-002 **M-5** | `contracts.js:146`; ARCH-006 Planned |
| L-1 Stale local branches | **Still open, worsened** (2 → 4) → GHA-002 **L-1** | `git branch -a` |
| L-2 Two ADR series | Still open, accepted → GHA-002 **L-3** | Directory listing |
| L-3 Application Gateway dormant | **No longer applicable** | Gateway is live: browser via the `uiExecute` seam (PR-7B), CLI via TransportAdapter (PR-8B) |
| Client-only go-live boundary | Still accepted by design | `CLAUDE.md` §4.3 |
| *(state change since GHA-001)* Alert #5 | **New finding L-5** — record-currency defect. The dismissal was **authorized** under SDR-0001 §7.2–§7.3 with Atlas approval cited (SPR-054B); the AR-1 rationale remains valid | SDR-0001 §7.3; `GET /code-scanning/alerts/5` |

Prior classifications were re-verified rather than assumed; GHA-001 L-3 inverted on current evidence.

---

## 8. GitHub State

Default branch `main`; the remote holds `origin/main` only. 48 pull requests — 47 merged, 1 closed (#6,
superseded by #8), 0 open. No issues. 12 tags and 12 releases in one-to-one correspondence; `v2.8.4` is
Latest. Public, not archived, not a fork. Merge commits used consistently, matching the Merge Standard.
Four stale local branches (L-1); `delete_branch_on_merge` disabled (L-2); no branch protection or rulesets
(M-1).

---

## 9. CI / Workflows

`ci.yml` (push + pull_request to `main`), `codeql.yml` (push + pull_request + weekly cron;
`javascript-typescript` and `actions`), `release.yml` (tag `v*` only). All actions are official and
current: `actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7`,
`github/codeql-action@v4.37.4`; Dependabot watches the actions ecosystem weekly. **100 of the last 100
runs succeeded** — no failures, cancellations, or skips. Release guardrails verified: version derived from
`APP_VERSION`, tag-equals-version enforced, filename and existence enforced, notes resolved from
`RELEASE_NOTES.md`, idempotent create-or-refresh. No workflow can publish from a non-tag ref. Green status
is materially reliable; the checks are not *required* to merge (M-1).

---

## 10. CodeQL / Security

6 alerts: **4 open** (#1–3 `js/insecure-randomness` → FP-1; #4 `js/incomplete-multi-character-sanitization`
→ FP-2), **1 dismissed** (#5, AR-1), **1 fixed** (#6). No new alert class since GHA-001 across Repository,
CLI, Transport, and three persistence-integrity sprints.

SDR-0001's dispositions remain valid: the client-only architecture is unchanged and no §8 revalidation
trigger has fired. Alert #5's dismissal was **authorized** by SDR-0001 §7.3 with the pre-approved reason
and justification and Atlas approval cited (SPR-054B); it is not an unauthorized deviation. The residual
issue — SDR-0001's narrative still describing all five alerts as open, and the loss of the described
self-expiry mechanism — is recorded as **L-5**.

XLSX 0.18.5 is pinned with Subresource Integrity and `crossorigin`. No secrets, credentials, or real
company data were found in tracked files or reachable history. Secret scanning and push protection are
disabled — recorded as **M-3**; because the feature is off, absence of secret alerts is not evidence of
absence.

---

## 11. Governance and Records

The complete hierarchy is present: Engineering Constitution, Core Values, Project Governance, Atlas
Governance Register, roadmaps, architecture backlog, six standards, two ADR registers, RDR/DPR/ECR series,
SDR series, and the `audit/` record set. Every v2.8.4-cycle stage maps to an authorizing instruction, with
merge and release separately authorized. ADR-013 is Accepted and matched by the implementation; ARCH-006
is Planned and correctly not implemented. No implementation was found lacking an authorizing record, and
no Proposed or Planned item was implemented without authorization.

**Formal risk-acceptance requirements.** Any formal risk acceptance closing M-1 or M-3 must state:

1. risk owner;
2. the exact control not implemented;
3. rationale;
4. current compensating controls;
5. repository scope;
6. residual risk;
7. review trigger;
8. expiration date or re-evaluation condition;
9. relation to the applicable MUST-level governance rule (`CLAUDE.md` §15.3 for M-1; §7.6 / §15.4 / §17.1
   for M-3);
10. whether a temporary exception, permanent exception, or deferred implementation is authorized.

**A risk-acceptance record must not claim the control exists.** M-1 and M-3 must be closed separately; one
generic statement cannot close both.

---

## 12. Architecture Boundary

Verified: business truth remains in the Domain; aggregates remain pure decision boundaries; handlers own
mutation, persistence, timestamps, history, rollback, and typed outcomes; the Application Gateway remains
business-blind; the Transport Adapter remains the canonical transport boundary; the browser consumes it
via the approved seam; the CLI is read-only and outside the browser load order; the Domain has no
dependency on Platform, Transport, Repository, UI, or storage; three entity-named Repositories operate on
the collection-grained contract; the 8-of-8 adoption claim is correctly bounded; **no** Unit of Work,
Transaction Coordinator, journal, generic Repository, factory, or backend abstraction exists; there is no
ES module syntax; no duplicate business authority was reintroduced; the retired Payroll Planning surface
is absent at runtime; contract renewal remains aggregate-authored and single-collection; and compound
persistence remains direct, sequential, and non-atomic as documented. Residual: M-5.

---

## 13. Persistence and Integrity Model

All standing distinctions hold and are documented correctly: inspection is not atomicity; detection is not
prevention; detection is not repair; retry idempotency is not reconciliation; command success does not
prove integrity health; reload does not restore a complete prior state; and no coordinated rollback exists
for the compound operations.

| Residual | Classification |
|---|---|
| Payroll Scenario A | Prevented on retry |
| Payroll Scenario C | Detected (Critical); not repaired, not blocked; still present |
| Monthly Plan Scenario A2 | Detected; still present after a successful retry |
| Monthly Plan Scenario B | Detected (`corrupt-plan-ref`); still present; command reports success |
| Dangling `committedTxnIds` | Still present; never removed |
| Orphaned transaction references | Detected (Critical); not repaired |
| Smart Import undo marker divergence | Still present; unresolved |
| Smart Import undo pre-operation backup | Still absent |

No residual is incorrectly documented. Manual review is consistently named as the operational response.

---

## 14. Build / Dist / Runtime

The manifest's 64 modules equal the 64 `js/` script tags in `index.html`; 65 `.js` files exist with
`js/cli/cli.js` correctly excluded from the browser load order; the 65th `<script src>` in `index.html` is
the XLSX CDN, not a module. 5 CSS files. No missing, duplicate, or stale references. The version is
single-sourced and the filename derived. Rebuild is byte-identical; committed artifact, rebuilt artifact,
and published asset are all `09c622b3…a02c6` at 914,409 bytes. Golden master intact; seed data empty;
`SCHEMA_VERSION` 6; no manual dist editing.

---

## 15. Verifier and Runtime Harness Coverage

1267 invariant checks plus 424 runtime harness checks across five harnesses, all green, none weakened. New
architecture surfaces are verifier-fenced, including negative assertions that no transaction abstraction
was introduced. The documented claim that a green verifier is necessary but not sufficient is accurate and
was demonstrated twice during this release cycle. Material coverage gap: M-4.

---

## 16. Documentation Consistency

Verifier count (1267), harness counts (424; 118 / 106 / 61 / 67 / 72), module counts (65 source / 64
browser-loaded), command and query counts (14 / 4), artifact name, schema value, and release state are
consistent across `README.md`, `AI_CONTEXT.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, and `RELEASE_NOTES.md`.
Historical entries are preserved and not presented as current state. Exceptions: M-2 and L-4.

---

## 17. Release Lifecycle Integrity

SPR-082 (PR #45) → SPR-083 (#46) → RR-001 discovery-only readiness review → SPR-084 (#47) → controlled
merge → REL-001 controlled release → SPR-085 (#48). Merge and release were separately authorized at every
stage. The tag targets the intended commit; notes came from the intended file; the published body matches
the tagged file; the asset matches the committed artifact; Latest is correct; no historical Release was
rewritten; no post-tag source mutation is attributed to the tagged release; and `main` correctly
distinguishes the tagged baseline `bd8819a` from the later documentation-only commit `b8c27a9`.

---

## 18. `RELEASE_NOTES.md` on `main` versus the tagged and published record

The verified invariant is specifically: **GitHub Release body == `RELEASE_NOTES.md` at tagged commit
`v2.8.4`.** Confirmed IDENTICAL.

- The **tag, GitHub Release, and published asset are immutable** (`CLAUDE.md` §13.4;
  `docs/04-standards/Release_Standard.md` §17). They must not be rewritten.
- **No explicit rule clearly prohibits editing `RELEASE_NOTES.md` on `main` after publication.**
  `CLAUDE.md` §13.4 and Release Standard §17 enumerate the tag, release, and asset — not the main-branch
  file.
- An **ambiguity** exists between historical-release immutability (`CLAUDE.md` §14.4 and Release Standard
  §26: "historical changelog and release entries are immutable") and the rolling-current-summary language
  defining `RELEASE_NOTES.md` as the "summary of the **current** release" (`CLAUDE.md` §18; `README.md`),
  a file wholly replaced each release cycle.
- **This audit identifies but does not resolve that ambiguity.**
- **No change to `RELEASE_NOTES.md` is authorized** by this audit.

---

## 19. Dead / Orphaned / Duplicate Surfaces

`js/people/payroll-planning.js` is retained deliberately for two shared utilities (`num`,
`ensureMonthlyPlan`) with its dead surface removed — documented, not orphaned. No unreachable routes, dead
business functions, duplicate business authority, unused modules, stale build references, obsolete
scripts, or generated files outside `dist/`. No untracked or abandoned temporary files. Four stale local
branches (L-1). Nothing was removed during this audit.

---

## 20. Dependencies and External Surfaces

Zero runtime dependencies; no package files; Node is used only for build and verification tooling, with no
`npm install`. Two external references: the XLSX 0.18.5 parser (SRI-pinned) and Google Fonts (no SRI —
inherent to a font stylesheet). The offline limitation is accurately documented. A backend remains
prohibited by `CLAUDE.md` §4.3 and absent.

---

## 21. Go-Live Assessment

| Dimension | Assessment |
|---|---|
| Development safety | Ready |
| Internal client-only operation | Ready |
| Release reproducibility | Ready — triple byte-identity proven |
| Data-safety posture | Ready by design, with bounded documented residuals requiring manual review |
| Auditability | Ready |
| Recoverability | Conditionally ready — no coordinated rollback; Smart Import undo lacks a pre-operation snapshot |
| Multi-user / backend | Not applicable by design |
| Authentication / authorization | Not applicable by design; under consideration on the roadmap |
| Operational monitoring | Not applicable by design |
| Backup / restore | Ready |

---

## 22. Readiness Decision

```
GHA-002 CONDITIONALLY READY
```

**Basis:** no Critical finding; no High finding; code, architecture, runtime, build, artifact, and release
integrity are healthy and evidence-backed; the controlling conditions are bounded governance,
security-control, and current-documentation matters. Proceeding to unrelated architecture or product work
requires closure or explicit formal acceptance of the named controlling conditions.

**Controlling conditions — these three only:**

- **Condition A (M-2).** Correct the active false tracked-workbook statements in `AI_CONTEXT.md` and
  `CONTRIBUTING.md`. The historical published inaccuracy is acknowledged and does **not** require
  rewriting the v2.8.4 GitHub Release body.
- **Condition B (M-1).** Enable appropriate branch protection or repository rulesets, **or** execute a
  formal governance risk-acceptance record per §11.
- **Condition C (M-3).** Enable secret scanning and push protection, **or** execute a formal security
  risk-acceptance record per §11.

**M-1 and M-3 must be closed separately.** **M-4, M-5, and L-5 are tracked follow-ups, not blockers.**

---

## 23. Recommended Follow-Up Records

| # | Finding | Action | Record type |
|---|---|---|---|
| 1 | M-2 | Correct `AI_CONTEXT.md` + `CONTRIBUTING.md` only | SPR (documentation-only) |
| 2 | M-1 | Branch protection/rulesets **or** formal governance acceptance | Governance record or SPR |
| 3 | M-3 | Secret scanning + push protection **or** formal security acceptance | SDR or governance SPR |
| 4 | L-5 | Revalidate SDR-0001 against the live alert state | SDR revalidation / successor SDR |
| 5 | M-4 | Discovery: which claims are stable, machine-readable, enforceable | Discovery → ADR/SPR |
| 6 | L-1 | Prune four stale local branches | Chore |
| 7 | L-2 | `delete_branch_on_merge` setting decision | Chore |
| 8 | L-4 | Future release-note convention change | Convention |
| 9 | M-5 | Remains governed by ARCH-006; **not newly scheduled** | None |

---

## 24. Audit Limitations

- Branch protection and rulesets were read via API; organization- or account-level settings not exposed to
  the token were not inspected.
- Secret scanning could not be evaluated for historical findings because the feature is disabled; absence
  of alerts is not evidence of absence of secrets. Manual inspection found none — weaker evidence than a
  scan.
- Dependabot alerts returned an empty set; whether that reflects "no alerts" or restricted visibility was
  not separately confirmed.
- Browser validation covered boot, identity, mount, seed, and console state. It was **not** a full
  functional QA pass of `docs/QA-CHECKLIST.md`; no payroll, import, or finance workflow was exercised.
  This audit therefore does not certify functional behavior beyond what the 424 harness checks cover.
- Persistence residuals were assessed from source, harness assertions, and documentation — not by inducing
  live storage failures beyond what the harnesses already simulate.
- Real company data was neither available nor inspected, by design.
- Whether a published current-release summary becomes an immutable "historical release entry" under
  `CLAUDE.md` §14.4 is a genuine governance ambiguity this audit identifies but does not resolve (§18).

---

## 25. Read-Only Attestation

The audit itself was **read-only**. No file was created, edited, or deleted in the repository during the
audit; no branch, commit, tag, GitHub Release, asset, workflow, issue, pull request, label, security
alert, ruleset, or repository setting was created or modified. No CodeQL alert was reopened or dismissed.
SDR-0001, `AI_CONTEXT.md`, `CONTRIBUTING.md`, and `RELEASE_NOTES.md` were read but not modified. A
temporary rebuild was performed to prove determinism and produced a byte-identical artifact, leaving no
diff. A copy of the published asset was staged outside version control for a boot test and removed. The
working tree was clean at audit start and at audit end, at commit
`b8c27a9cfe5d525576dc37b69658b79dc2f6b34a`.

Recording this audit **closes no finding**. Every controlling condition and follow-up requires separate
authorization to act upon.

---

*GHA-002 is an immutable point-in-time audit record. No repository modification occurred during the audit.
Implementation follow-up requires separate authorization.*
