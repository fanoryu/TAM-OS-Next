# TAM OS NEXT — Current status

DOC-01-R2 proposed status record, 2026-11-09 (Asia/Jakarta), incorporating Owner decision D-2.
Baseline refreshed 2026-11-14 after UI-INT-1 merged (PR #88); the D-2 decisions are unchanged.
Source baseline snapshot: main at ec3cf40e53a3203a59babf3e6e8c83e252a933ae, observed read-only on 2026-11-14
(previous snapshot: 40c63216c201e0ca0a4594505f9919800e597ff1, 2026-11-13).
This is a dated snapshot, not a permanently current commit; later commits to main do not update it.
This file centralizes current status; it does not supersede accepted technical/security decisions
or authorize work. Detailed historical wording stays in its original records.

## Status contract

Stable keys below are checked by tools/verify-doc-status.js through tools/verify-build.js.
Values describe this reviewed baseline, not automatically discovered production state.

| Key | Value |
|---|---|
| repository | fanoryu/TAM-OS-Next |
| source-version | 3.0.0 |
| source-auth-mode | SESSION |
| published-version | 2.11.0 |
| published-state | PUBLISHED-LATEST |
| candidate-state | UNRELEASED |
| session-readiness | NOT-PRODUCTION-READY |
| ENG-C1 | BLOCKED |
| release-v3.0.0 | HOLD |
| Gate-D | HOLD |
| Gate-R | HOLD |
| Hostinger | NO-GO |

The source version/mode are compared with [constants.js](../js/core/constants.js).
Published state comes from the preserved [release records](../RELEASE_NOTES.md), not a live release
publication check in DOC-01. The ENG-C1, release-v3.0.0, Gate-D, Gate-R and Hostinger values record Owner
decision D-2 below. Gate D and Gate R HOLD also match earlier AI_CONTEXT records; ENG-C1, release-v3.0.0
and Hostinger have no earlier repository record and are first recorded here.
Changing a value requires evidence, review and any applicable separate authorization; green CI does
not clear a gate. The verifier is not a production monitor.

### Owner decision D-2 (2026-11-09)

On 9 November 2026 the Owner confirmed these restrictive statuses as current decisions: ENG-C1 BLOCKED;
release v3.0.0 HOLD; Gate D HOLD; Gate R HOLD; Hostinger / production NO-GO. D-2 authorizes documenting
these restrictions only. It does not authorize a release, tag, deployment, host access or production change,
and it accepts no residual risk. D-2 is a new Owner confirmation, distinct from the historical Gate D/R
records, and adds no technical evidence.

## Development baseline

Published v2.11.0 — Identity Refresh is the historical LOCAL frontend baseline. Current main contains
the v3.0.0 Core SESSION Foundation candidate, not a published production release. The canonical
distribution for current source is the strict-CSP package built by [build-package.js](../tools/build-package.js),
recorded in [package-manifest.json](../dist/package-manifest.json). Frozen single-file artifacts stay intact.

## Architecture

LOCAL uses browser-profile business storage and a trust-based context selector. SESSION uses
server-derived identity, authorization and authoritative business records through a same-origin
PHP 8.3 API with MariaDB. Browser UI checks are not security boundaries. SESSION does not migrate
v2.x local records; the package retains LOCAL code even though the SESSION shell does not expose
all LOCAL areas. Fetched/rendered data exists in browser memory. This status record does not assert
that every browser-storage path is empty. See [ARCHITECTURE](../ARCHITECTURE.md),
[ADR-0004](03b-repository-adr/ADR-0004-hostinger-same-origin-backend.md) and [DATA-SAFETY](DATA-SAFETY.md).

## Completed source work

Core SESSION source includes sign-in/session identity, employee/login management, overtime, payroll,
supplemental payroll, payroll-sourced posting/payment, audit, employee self-service and account security.
Finance Phase 1 merged before the 2026-11-13 snapshot (PR #85, merge commit 79c8c497; documentation reconciled by
PR #86): CEO-only general income and expense transactions against four fixed Financial Posts (GA, NP & IP, TJB,
Drone), void-only correction with a mandatory reason, and a SESSION financial report with a cash-basis consolidated
total (migrations 0036–0038, head 0038; 58 routes; ACTIONS stay 21). It is merged source in the v3.0.0 candidate:
not deployed and not released, and a new encrypted backup-and-restore rehearsal must pass before any production deployment (PD-10).
UI-INT-1 merged after the previous snapshot (PR #88, merge commit ec3cf40): the SESSION shell uses the v2.11.0
sidebar labels and chrome over the existing SESSION pages, with unsupported areas hidden (frontend only; no CSS,
backend, route, migration or storage change). It is merged source in the v3.0.0 candidate: not deployed and not released.
The Distribution-1 package and backend source exist. These are source implementation statements, not
hosting acceptance. Detailed milestone, PR and verification records remain in
[AI_CONTEXT](../AI_CONTEXT.md), [CHANGELOG](../CHANGELOG.md), [Milestones](05-milestones/Milestones.md)
and [RELEASE_NOTES](../RELEASE_NOTES.md).

## Incomplete work and limitations

SESSION is not production-ready. Dashboards, Contracts, the LOCAL Finance Overview and Transactions ledger, Import,
Recurring, Cash Flow, Budget, Execution, Bank Accounts, Projects, Vendors, Calendar, Reports,
Global Search, Settings and Data Portability have not reached full SESSION parity. Neither the payroll
posting/payment actions nor the Phase 1 Financial Post transactions and report mean the LOCAL Finance workspace
has migrated; Phase 1 has no category-level reporting (PD-4). Refer to
[release scope](../RELEASE_NOTES.md) and the [forward roadmap](01-roadmap/Milestone_Roadmap.md).

Hosting runtime/header/database/security evidence remains incomplete; repository checks and local
fabricated-data tests cannot establish production readiness. The [backend runbook](BACKEND-DEPLOYMENT-RUNBOOK.md)
and [security register](security/README.md) retain the detailed acceptance requirements.

## Release governance

Offline ENG-C1 alternative-design records are held outside this repository. Their review outcomes are not
recorded or verified here and are not evidence of release readiness. The residual tag race is OPEN / NOT YET
ACCEPTED.

ENG-C1 remains BLOCKED; v3.0.0 is HOLD (Owner decision D-2). These offline designs authorize no release
and provide no independent human approval. They are not implemented or committed to this baseline and have no
repository evidence links here. Do not imply they are deployed.

[.github/workflows/release.yml](../.github/workflows/release.yml) still publishes on v* tag pushes, and
GitHub runs the `release.yml` of the tagged commit. The reviewed revision (PR #92) publishes draft-first
through `tools/release-publish.js` and refuses, without changing anything, when a release or draft already
exists for the tag; it does not replace assets. That applies only to a tag on a commit that contains this
revision. Older commits, including most of `main`'s history, carry the previous workflow, which publishes
directly and can replace assets; being in the history of `main` does not mean a commit has the reviewed
workflow. That previous workflow is not technically disabled, and the tag ruleset does not restrict creating
a new v* tag. The reviewed behavior is proven only offline (mocked selftest); no release workflow has run
with it. Its eligibility checks are not release authorization. No tag may be created while v3.0.0 and the
release gates are on HOLD; do not create a tag or run a release workflow under DOC-01. Rulesets, the
Immutable Releases setting (off), app permission changes and release controls need separate authorization
and live verification.

## Deployment gates

Gate D and Gate R are HOLD; Hostinger is NO-GO (Owner decision D-2, 2026-11-09; see Status contract).
No host access, staging deployment, production cutover or release is authorized. See
[DEPLOYMENT section 8](DEPLOYMENT.md) and the [backend runbook](BACKEND-DEPLOYMENT-RUNBOOK.md).

Prior 2026-11-07 roadmap proposal reported D4 Windows OPEN, D5 B1 LIMITED PASS, SC4 OPEN and backend
validation PENDING; bounded N1 was Owner-only and not executed at that report. Exact durable approval
and D2/D3 evidence links were unavailable in that proposal. These are dated reports, not newly
verified current outcomes or permission for DOC-01 to execute N1. R-5 and other gate details must be
read from their governing records; no missing evidence is promoted to PASS.

## Navigation and history

Use [docs index](README.md) for technical/security/governance homes, [roadmap index](01-roadmap/README.md)
for future sequencing and [archive](99-archive/README.md) for dated evidence. Accepted ADRs/SDRs,
release artifacts, milestones and historical audit records are preserved unchanged. README is the
entry point; this file is the current-status record; AI_CONTEXT retains detailed engineering history.
