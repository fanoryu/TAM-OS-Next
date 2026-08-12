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

TAM Intelligence OS is a **proprietary, client-side, single-page** finance, payroll, and operations
application for **PT Total Asset Manajemen**. It runs entirely in the browser with **no backend, no
database, and no runtime dependencies**. All data is stored locally on the user's device.

- It is **not** open source. See [`LICENSE`](LICENSE) and [`PROPRIETARY-LICENSE-NOTICE.md`](PROPRIETARY-LICENSE-NOTICE.md).
- It handles **confidential** finance, payroll, employee, and contract data. Treat all data as
  sensitive by default.

## 2. Engineering Philosophy

1. **Correctness and data safety over features.** A change that risks stored data is never worth the
   feature. When in doubt, do less and preserve invariants.
2. **Preserve the architecture.** This is a single shared global scope of classic scripts by
   deliberate design. Do not introduce frameworks, bundlers, or module systems to "modernize" it.
3. **Determinism.** The build must be reproducible; the same source MUST produce the same portable
   output. Verification is mechanical, not a matter of opinion.
4. **One source of truth.** Every fact (version, load order, schema) lives in exactly one place.
   Never create a second copy that can drift.
5. **Explicit over clever.** Prefer readable, boring code that matches the surrounding style over
   clever abstractions.
6. **Additive over destructive.** Prefer changes that add behavior behind existing data shapes over
   changes that migrate or remove data.

## 3. Repository Structure (roles, not a file listing)

- **Modular source** — the human-edited application: `index.html` + a `css/` folder + a `js/` folder
  of classic-script modules grouped by domain (`core`, `ui`, `finance`, `people`, `import`,
  `analytics`).
- **Build/verify tooling** — a `tools/` folder of Node scripts (plus PowerShell fallbacks) that
  assemble and check the portable build. It is the **only** place Node is used.
- **Portable build** — a single self-contained HTML file under `dist/`, generated from the source.
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
3. **Client-only (MUST).** No server, database, or API is introduced. The only external network
   references are the spreadsheet parser and web fonts. No user data is ever transmitted.
4. **Derived, not duplicated (SHOULD).** Prefer computing display state from stored data at render
   time over storing new flags — this avoids migrations and stale state.
5. **CSS is a golden master (MUST).** Styles are treated as frozen; changes to CSS are exceptional
   and must be justified and verified.

## 5. Development Workflow

1. **Confirm the baseline** before editing: working tree clean, correct branch, latest commit and
   release tag as expected. If the baseline is unexpected, stop and reconcile.
2. **Edit the modular source only.** Never hand-edit the portable build.
3. **Build**, then **verify** (see §10, §11).
4. **Validate in the browser** — modular source and portable build (see §12).
5. **Update documentation** affected by the change.
6. Prepare the change for review; perform approval-gated actions (§20) only after approval.

Branch names: `feature/<name>`, `fix/<name>`, `chore/<name>`, `release/<version>`. The full
contributor contract is [`CONTRIBUTING.md`](CONTRIBUTING.md).

## 6. Coding Standards

1. **Match surrounding style.** Naming, indentation, comment density, and idioms should be
   indistinguishable from the neighboring code.
2. **No new runtime dependencies.** The application ships zero dependencies; keep it that way.
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
5. **Backups are a recovery contract (MUST).** The Complete Backup format is stable. Destructive
   actions must snapshot data first and require explicit confirmation.
6. **Never store secrets.** No credentials, tokens, or keys in state, storage, or the repository.

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
2. **The build only assembles.** It inlines CSS and JS in the manifest order into one portable file;
   it does not transform, minify, or reorder logic.
3. **Reproducible (MUST).** The same source produces byte-identical output. If output changes without
   a source change, investigate before proceeding.
4. **Never edit the output by hand.** Regenerate it from source.

## 11. QA Requirements

1. **Verification must pass (MUST).** The build is not "done" until the verifier passes all checks.
   A green build is necessary but not sufficient — it does not prove behavior.
2. **The verifier guards invariants**, including: CSS golden master, build fidelity (output equals
   concatenated source), version identity consistency, schema/storage/migration invariants, empty
   seed data, absence of ES-module syntax, and the module decomposition/load-order agreement.
3. **Test to break, not to confirm.** Exercise edge cases and failure paths, not just the happy path.
4. **Regressions are release blockers (MUST).** Any regression in a previously-working feature blocks
   the change until fixed.

The living checklist is [`docs/QA-CHECKLIST.md`](docs/QA-CHECKLIST.md).

## 12. Browser Validation Rules

1. **Validate both artifacts (MUST).** Every change is exercised in the modular source **and** the
   portable build.
2. **Zero console errors (MUST).** Both must boot and operate with no console errors.
3. **Confirm persistence.** Data must survive reload; no duplicate records are produced.
4. **Confirm interaction invariants.** Search keeps focus, scroll position is preserved, and menus
   open/close correctly.
5. **Never validate against real company data.** Use clearly fabricated sample data only, and do not
   leave seeded test data behind.

## 13. Release Workflow

1. **Releases are proposed, not published directly.** Present a Release Candidate and obtain explicit
   approval before any release action (see §20).
2. **Tag-driven and guarded (MUST).** Publishing is triggered by a version tag; automation refuses to
   publish unless the tag equals the source version and the portable build exists.
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

1. **Commit source and its generated output together.** When the portable build is regenerated, it is
   committed with the source that produced it.
2. **Clear, imperative commit subjects.** Release commits follow the agreed release-commit format.
3. **Do not rewrite published history (MUST).** No force-push or history rewrite of shared branches.
4. **Never commit secrets or real data (MUST).** No credentials, tokens, `.env` files, real company
   data, or Complete Backup exports.
5. **Respect the ignore rules.** Sensitive/local artifacts are ignored by policy; do not force-add
   them.
6. **Do not remove tracked files without approval.** This includes any intentionally tracked,
   documented exception.
7. **Owner-only authorship (MUST).** Every commit is authored by the repository owner's Git identity.
   Commit messages MUST NOT carry AI-attribution trailers or footers — no `Co-authored-by:` naming
   Claude, Claude Opus, Anthropic, Forge, or any other AI agent, and no "Generated with …" footer.
   AI participation is recorded in orchestration logs, never in Git metadata. This is mechanically
   enforced: `node tools/check-commit-attribution.js <file|--message>` fails closed on any prohibited
   trailer, and it is the check a `commit-msg` hook or CI job must run. Dependabot commits are the
   one permitted non-owner author.

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
- [ ] The portable build is regenerated from source.
- [ ] Verification passes **all** checks.
- [ ] Modular source and portable build both boot with **zero console errors**.
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
