# CLAUDE.md — Engineering Constitution

This document is the **long-term engineering constitution** for TAM Intelligence OS. It states
timeless rules for how the software is designed, changed, verified, and released. It is written as
repository documentation for any engineer or AI assistant working here — not as a chat prompt.

**Precedence.** These rules take precedence over convenience. When a request conflicts with a rule
here, surface the conflict and the safe alternative rather than silently violating the rule. Rules
marked **MUST** are invariants; **SHOULD** rules are strong defaults that require a stated reason to
deviate.

For the *current* state of the project (modules, roadmap, decisions), see
[`AI_CONTEXT.md`](AI_CONTEXT.md). For technical implementation detail, see
[`ARCHITECTURE.md`](ARCHITECTURE.md). This document is deliberately version-agnostic.

---

## 1. Project Identity

TAM Intelligence OS is a **proprietary, single-page** finance, payroll, and operations application for
**PT Total Asset Manajemen**. The shipped application is **client-side**: it runs entirely in the
browser with **no backend, no database, and no runtime dependencies**, and all data is stored locally
on the user's device. It is transitioning — only through separately authorized milestones — to the
shared multi-user architecture accepted in
[ADR-0004](docs/03b-repository-adr/ADR-0004-hostinger-same-origin-backend.md) (see §4.3). Until that
work lands, no backend exists and none may be described as implemented.

- It is **not** open source. See [`LICENSE`](LICENSE) and [`PROPRIETARY-LICENSE-NOTICE.md`](PROPRIETARY-LICENSE-NOTICE.md).
- It handles **confidential** finance, payroll, employee, and contract data. Treat all data as
  sensitive by default.

## 2. Engineering Philosophy

1. **Correctness and data safety over features.** A change that risks stored data is never worth the
   feature. When in doubt, do less and preserve invariants.
2. **Preserve the architecture.** This is a single shared global scope of classic scripts by
   deliberate design. Do not introduce frameworks, bundlers, or module systems to "modernize" it.
3. **Determinism.** The build must be reproducible; the same source MUST produce the same deployment
   package. Verification is mechanical, not a matter of opinion.
4. **One source of truth.** Every fact (version, load order, schema) lives in exactly one place.
   Never create a second copy that can drift.
5. **Explicit over clever.** Prefer readable, boring code that matches the surrounding style over
   clever abstractions.
6. **Additive over destructive.** Prefer changes that add behavior behind existing data shapes over
   changes that migrate or remove data.

## 3. Repository Structure (roles, not a file listing)

- **Modular source** — the human-edited application: `index.html` + a `css/` folder + a `js/` folder
  of classic-script modules grouped by domain (`core`, `ui`, `finance`, `people`, `import`,
  `analytics`), plus pinned third-party runtime code under `vendor/`.
- **Build/verify tooling** — a `tools/` folder of Node scripts (plus PowerShell fallbacks) that
  assemble and check the deployment package. It is the **only** place Node is used.
- **Deployment package** — the canonical distribution (ADR-0002 Model B): the static document root
  assembled from the source by the package builder, recorded by a committed package manifest under
  `dist/`. Earlier single-file releases stay in `dist/` as frozen, digest-pinned history.
- **Backend source** — a `server/` folder holding the ADR-0004 same-origin PHP API, grown only through
  its separately authorized Multi-User milestones and checked by its own boundary tool, tests and CI.
  It is not part of the deployment package and never holds configuration secrets.
- **Governance & docs** — root Markdown files and a `docs/` folder; `.github/` for CI, release, and
  issue/PR templates.

The authoritative, current file-by-file map lives in [`ARCHITECTURE.md`](ARCHITECTURE.md). Do not
duplicate that map here.

## 4. Architecture Principles

1. **Shared global scope (MUST).** All JS modules are classic `<script>` files sharing one global
   scope. No ES modules, no `import`/`export`, no `type="module"`, no bundler.
2. **Load order is behavior-critical (MUST).** Top-level `const` initializations depend on order.
   The load order lives in exactly one manifest; `index.html` mirrors it, and the build/verify tools
   read it. If you add or move a module, update the manifest **and** `index.html` together.
3. **Client-only until the authorized backend lands (MUST).** The shipped application is client-only.
   The **only** server, database, or API that may be introduced is the backend accepted in ADR-0004 —
   a same-origin PHP API at `/api/*` over MariaDB/MySQL on the existing Hostinger web hosting — and
   only through separately authorized Multi-User milestones. Any other server, API, database, managed
   backend service, VPS, or client-side data synchronization requires a further ADR. The browser is an
   **untrusted client**: once the backend exists, authentication, authorization and read scope are
   enforced by its central policy and data-access layer, the browser never reaches the database, and
   client-side checks are UX affordance only. The page makes no third-party network request: the
   spreadsheet parser is vendored and typography is embedded, so its only network peer, once
   implemented, is that same-origin API. Until then no user data is transmitted; afterwards it is
   transmitted only to that API.
4. **Derived, not duplicated (SHOULD).** Prefer computing display state from stored data at render
   time over storing new flags — this avoids migrations and stale state.
5. **CSS is a golden master (MUST).** Styles are treated as frozen; changes to CSS are exceptional
   and must be justified and verified.

## 5. Development Workflow

1. **Confirm the baseline** before editing: working tree clean, correct branch, latest commit and
   release tag as expected. If the baseline is unexpected, stop and reconcile.
2. **Edit the modular source only.** Never hand-edit generated output or the frozen historical releases.
3. **Build**, then **verify** (see §10, §11).
4. **Validate in the browser** — the deployment package served over HTTP under its production headers
   (see §12).
5. **Update documentation** affected by the change.
6. Prepare the change for review; perform approval-gated actions (§20) only after approval.

Branch names: `feature/<name>`, `fix/<name>`, `chore/<name>`, `release/<version>`. The full
contributor contract is [`CONTRIBUTING.md`](CONTRIBUTING.md).

## 6. Coding Standards

1. **Match surrounding style.** Naming, indentation, comment density, and idioms should be
   indistinguishable from the neighboring code.
2. **No new runtime dependencies.** The frontend ships no dependency beyond the vendored, pinned and
   integrity-checked spreadsheet parser; keep it that way. A backend
   (Composer) dependency is permitted only when it is justified, minimal, pinned and locked,
   security-reviewed, and approved under §20 (ADR-0004).
3. **Escape untrusted data (MUST).** Any employee/company-supplied value rendered into the DOM MUST
   be escaped. Never build HTML by concatenating unescaped user data.
4. **Pure functions for calculations (SHOULD).** Money and payroll math should be deterministic and
   testable; round only the final currency result, never intermediate rates.
5. **Fail loudly in tooling, gracefully in UI.** Build/verify tools should throw clearly on bad
   input; the UI should degrade without data loss.
6. **No dead code or speculative abstraction.** Add structure when a second caller exists, not
   before.

## 7. State & Storage Rules

1. **Storage keys are stable (MUST).** Do not rename, remove, or repurpose a persisted storage key
   except through an intentional, documented migration.
2. **The schema version is an invariant (MUST).** Do not change `SCHEMA_VERSION` except as part of a
   deliberate migration that transforms old data forward, guarded by a one-time migration flag.
3. **Migration flags persist (MUST).** A migration that has run must not run again; its flag must not
   be dropped.
4. **The shipped build seeds no data (MUST).** A fresh install starts empty.
5. **Backups are a recovery contract (MUST).** The Complete Backup format is stable while local
   storage is in use. Destructive actions must snapshot data first and require explicit confirmation.
   Once authoritative data lives in the ADR-0004 backend database, recovery rests on the provider
   backup plus a nightly, encrypted, off-host database dump, which must be in place and
   restore-rehearsed before real company data is entered.
6. **Never store secrets.** No credentials, tokens, or keys in state, storage, or the repository. A
   Backend secrets (database credentials, token and session keys, SMTP and deployment credentials)
   never enter the frontend or the repository, and live outside the public web root.
7. **One authoritative store (MUST).** `localStorage` behind `StorageAdapter` is the current client
   store, governed by rules 1–3 until migrated. Under the multi-user architecture, authoritative
   business data lives only in the approved shared server database; the browser never becomes a second
   authoritative copy, and moving data between the two is an explicit, documented migration.

Detailed data-safety guidance: [`docs/DATA-SAFETY.md`](docs/DATA-SAFETY.md).

## 8. Payroll Integrity Rules

1. **Committed payroll is immutable (MUST).** Once payroll is posted or executed, its totals and the
   posted/executed transactions must never be modified.
2. **A single, transparent formula.** Payroll is Base Salary + Approved Overtime; salary is edited on
   the contract, overtime in the overtime module. The computed total is read-only where displayed.
3. **Lifecycle stages are a display mapping (SHOULD).** Operational stages are derived over stored
   status values; introducing a stage must not require a schema change unless truly necessary.
4. **No duplicate payroll (MUST).** One payroll record per employee per period; regeneration updates
   or skips, never duplicates.
5. **Selection is generic; actions own eligibility (SHOULD).** A selection set is stage-agnostic;
   each bulk action decides its own eligible rows and reports eligible/skipped/reason. Do not couple
   the selection model to one action.
6. **Surface drift, don't mutate (MUST).** When approved inputs change after payroll is committed,
   warn the user; never silently alter committed amounts.

## 9. Finance Integrity Rules

1. **Planned vs. actual is preserved (MUST).** A planned transaction and its executed actual are
   distinct; posting creates planned entries, and execution records actuals separately.
2. **No automatic execution (MUST).** Posting to finance never auto-executes a payment; execution is
   an explicit, separate user action.
3. **No duplicate transactions (MUST).** Re-posting updates or skips; it must not create duplicates.
4. **Amounts are auditable.** Financial changes are recorded in the read-only activity/audit trail;
   do not remove or rewrite audit history.
5. **Money math is precise.** Use full precision internally and round only the final payable amount,
   consistently with existing helpers.

## 10. Build Process

1. **Version is derived, never hardcoded (MUST).** The release version lives once, in the source
   constants; the tooling derives the output filename and identity from it. Never type a version
   into the tooling.
2. **The build only assembles.** It copies the files `index.html` references — CSS, the manifest-ordered
   JS, vendored code — plus their licence texts into the deployment package, each byte-identical at the
   same relative path; it does not inline, transform, minify, or reorder logic. The page carries no
   inline executable script, so it runs under a strict Content-Security-Policy.
3. **Reproducible (MUST).** The same source produces byte-identical output. If output changes without
   a source change, investigate before proceeding.
4. **Never edit the output by hand.** Regenerate it from source.

## 11. QA Requirements

1. **Verification must pass (MUST).** The build is not "done" until the verifier passes all checks.
   A green build is necessary but not sufficient — it does not prove behavior.
2. **The verifier guards invariants**, including: CSS golden master, package fidelity (every package
   file equals its source; the committed manifest equals a fresh, deterministic assembly), frozen
   historical releases pinned by digest, strict-CSP shape, version identity consistency,
   schema/storage/migration invariants, empty seed data, absence of ES-module syntax, and the module
   decomposition/load-order agreement.
3. **Test to break, not to confirm.** Exercise edge cases and failure paths, not just the happy path.
4. **Regressions are release blockers (MUST).** Any regression in a previously-working feature blocks
   the change until fixed.

The living checklist is [`docs/QA-CHECKLIST.md`](docs/QA-CHECKLIST.md).

## 12. Browser Validation Rules

1. **Validate the package over HTTP (MUST).** Every change is exercised in the built deployment
   package served over HTTP with the production header contract, including its Content-Security-Policy
   (`file://` is not a supported way to run TAM OS).
2. **Zero console errors (MUST).** The package must boot and operate with no console errors and no
   Content-Security-Policy violations.
3. **Confirm persistence.** Data must survive reload; no duplicate records are produced.
4. **Confirm interaction invariants.** Search keeps focus, scroll position is preserved, and menus
   open/close correctly.
5. **Never validate against real company data.** Use clearly fabricated sample data only, and do not
   leave seeded test data behind.

## 13. Release Workflow

1. **Releases are proposed, not published directly.** Present a Release Candidate and obtain explicit
   approval before any release action (see §20).
2. **Tag-driven and guarded (MUST).** Publishing is triggered by a version tag; automation refuses to
   publish unless the tag equals the source version and the deployment package builds, reproduces the
   committed package manifest, and matches it.
3. **Idempotent (MUST).** Re-running the release must not create duplicate releases or corrupt the
   asset.
4. **Never rewrite a published release.** A shipped tag, release, and asset are immutable; corrections
   go into a new version or a documentation-only follow-up.

The step-by-step procedure is [`docs/RELEASE-PROCESS.md`](docs/RELEASE-PROCESS.md).

## 14. Versioning Rules

1. **Semantic-style `MAJOR.MINOR.PATCH`.** Increment the patch for fixes, the minor for
   backward-compatible features, the major for breaking changes.
2. **Single source of truth (MUST).** The version and release name live once in the source constants;
   all other references are either derived or documentation that points to it.
3. **The schema version is independent of the app version.** Bump it only for real data migrations.
4. **Historical references are immutable.** Past changelog entries and release history are never
   rewritten to a new version — only forward-looking pointers track the latest release.

## 15. Git Rules

1. **Commit source and its generated record together.** When the source changes, the regenerated
   package manifest is committed with it. Package files and the package ZIP are build output and are
   never committed.
2. **Clear, imperative commit subjects.** Release commits follow the agreed release-commit format.
3. **Do not rewrite published history (MUST).** No force-push or history rewrite of shared branches.
4. **Never commit secrets or real data (MUST).** No credentials, tokens, `.env` files, real company
   data, or Complete Backup exports.
5. **Respect the ignore rules.** Sensitive/local artifacts are ignored by policy; do not force-add
   them.
6. **Do not remove tracked files without approval.** This includes any intentionally tracked,
   documented exception.
7. **Owner-only authorship (MUST).** Every commit is authored by the repository owner's Git identity.
   Commit messages MUST NOT carry AI-attribution trailers or footers — no `Co-authored-by:`,
   `Assisted-by:`, `Generated-by:`, `Authored-by:` or `Created-by:` trailer naming Claude, Claude Opus,
   Anthropic, Forge, Atlas, ChatGPT, OpenAI, Codex, Copilot or any other AI agent; no "Generated
   with …" footer; and no `@anthropic.com` address in a trailer. AI participation is recorded in
   orchestration logs, never in Git metadata. Ordinary prose that *mentions* an AI tool is fine — the
   rule governs attribution, not discussion.

   **Enforced in two layers, from one implementation.** `tools/check-commit-attribution.js` is the
   single source of this policy; nothing restates its rules.
   - **Locally** — the tracked hook `.githooks/commit-msg`, activated per clone by
     `node tools/install-hooks.js` (sets `core.hooksPath=.githooks` for that repository only; global
     Git configuration is never modified).
   - **In CI** — the `verify-attribution` job, which checks every commit in a pull request or push to
     `main` and cannot be skipped.

   Both fail closed. **Dependabot is the one permitted non-owner author**, and genuine human
   co-authors remain permitted.

## 16. Documentation Rules

1. **One responsibility per document (MUST).** Each document has a single role (see §18 and the
   Repository Documentation section of the README). Do not duplicate content across documents;
   cross-reference instead.
2. **Keep pointers consistent.** After a version bump, update the forward-looking references and
   leave historical references intact.
3. **Document behavior, structure, and build changes** in the appropriate file as part of the change.
4. **Accuracy over marketing.** Describe only what actually exists; never claim unavailable
   functionality.

## 17. Security Rules

1. **Confidential by default (MUST).** Treat all finance/payroll/employee/contract data as sensitive.
2. **Never expose data (MUST).** Do not print, commit, or transmit real data in code, issues, PRs,
   logs, screenshots, or reports. Use fabricated placeholders.
3. **Report privately.** Security issues are reported through the private channel in
   [`SECURITY.md`](SECURITY.md), never as public issues.
4. **Least privilege in automation (MUST).** CI/release workflows use official actions only and the
   minimum permissions required; do not weaken version/tag guardrails.
5. **Rotate on exposure.** If a secret is ever exposed, rotate it immediately and follow the incident
   guidance in `SECURITY.md`.

## 18. Repository Standards (documentation responsibilities)

| Document | Responsibility |
|---|---|
| `README.md` | Public product overview and entry point |
| `CLAUDE.md` | Engineering constitution — timeless rules (this file) |
| `AI_CONTEXT.md` | Repository knowledge — current state and context |
| `ARCHITECTURE.md` | Technical implementation, module map, provenance, diagrams |
| `CHANGELOG.md` | Historical record of changes |
| `RELEASE_NOTES.md` | Summary of the current release |
| `CONTRIBUTING.md` | Contribution workflow and contract |
| `SECURITY.md` | Security and vulnerability-reporting policy |
| `PROVENANCE.md` | Where this repository came from — source repository, snapshot SHA, migration method |
| `docs/` | QA checklist, release process, data-safety detail, deployment; indexed by `docs/README.md` |
| `docs/03-adr/` | Domain Architecture Decision Records (ADR-NNN, three-digit); see `docs/03-adr/README.md` |
| `docs/03b-repository-adr/` | Repository/governance Architecture Decision Records (ADR-NNNN, four-digit); see `docs/03b-repository-adr/README.md` |
| `docs/security/` | Security Decision Records (SDR-NNNN); see `docs/security/README.md` |
| `docs/99-archive/` | Provenance records — immutable dated audits, completed plans, RDR/DPR/ECR; **not** current operational guidance |

Keep these boundaries. If information could live in two places, put it in one and link from the
other. Decision records (ADR/SDR) are immutable once Accepted and are **superseded** by a new record,
never rewritten. The governance model is recorded in `docs/03b-repository-adr/ADR-0001`.

## 19. Definition of Done

A change is **done** only when **all** of the following hold:

- [ ] The modular source is edited (never the generated output by hand).
- [ ] Load-order manifest and `index.html` agree (if modules changed).
- [ ] The deployment package is rebuilt from source and its manifest committed.
- [ ] Verification passes **all** checks.
- [ ] The package, served over HTTP under its production headers, boots with **zero console errors**
      and no Content-Security-Policy violations.
- [ ] Data persists across reload; no duplicates; committed data is immutable.
- [ ] Invariants preserved: schema version, storage keys, migration flags, empty seed, CSS golden
      master (or an intentional, documented migration).
- [ ] Affected documentation is updated; version references are consistent.
- [ ] Documentation indexes and cross-references are current (root `README.md` table, `docs/README.md`,
      and the `SECURITY.md` SDR list); any new/changed decision record has a valid status and is listed
      in its register (per `docs/03b-repository-adr/ADR-0001`).
- [ ] No secrets or real company data introduced anywhere.
- [ ] Relevant regressions re-tested and passing.

## 20. Approval Matrix

| Action | Requires explicit approval? |
|---|---|
| Edit modular source, build, verify, browser-validate locally | No |
| Update documentation | No |
| `git commit` | **Yes** |
| `git push` | **Yes** |
| `git tag` | **Yes** |
| Create or edit a GitHub Release / release asset | **Yes** |
| Rewrite Git history (rebase/amend pushed commits, force-push) | **Yes — avoid; only on explicit instruction** |
| Change `SCHEMA_VERSION`, storage keys, or migration flags | **Yes — intentional, documented migration only** |
| Change `APP_VERSION` / `APP_RELEASE_NAME` | **Yes — as part of an approved release** |
| Remove or move a tracked file (incl. documented exceptions) | **Yes** |
| Add a runtime dependency, framework, bundler, or ES modules | **Yes — strongly discouraged; contradicts the architecture** |
| Add a third-party CI action or external service | **Yes** |

When an action requires approval, prepare it and present a candidate; do not perform it until the
maintainer approves.

---

*This constitution is intentionally timeless. It names no specific version. When the project's
current state changes, update [`AI_CONTEXT.md`](AI_CONTEXT.md) — not this file — unless an
engineering rule itself is changing.*
