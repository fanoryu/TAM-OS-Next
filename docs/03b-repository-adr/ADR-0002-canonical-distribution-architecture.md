# ADR-0002 — Canonical Distribution Architecture

| Field | Value |
|---|---|
| **Record** | ADR-0002 |
| **Title** | Canonical Distribution Architecture — single-file artifact vs. application package |
| **Status** | **Accepted** |
| **Date created** | 2026-08-11 |
| **Date accepted** | 2026-08-11 |
| **Author** | Readiness-3 distribution-architecture review |
| **Accountable approver** | Maintainer (`CLAUDE.md` §20) — ruling recorded 2026-08-11 |
| **Supersedes** | — |
| **Superseded by** | — |
| **Related** | [ADR-0001](ADR-0001-documentation-governance-model.md); `CLAUDE.md` §3, §5, §10, §11, §13, §15, §19; [Release-Checklist-v2.10.0](../06-releases/Release-Checklist-v2.10.0.md); [Milestones — Distribution-1](../05-milestones/Milestones.md) |

> **What this is.** An Architecture Decision Record captures one architecture-level decision, why it
> was made, and what future event would require it to be revisited. It is immutable once Accepted:
> a later decision does not rewrite it, it supersedes it with a new ADR that links back
> (`CLAUDE.md` §14.4, §16.2).
>
> **This record is `Accepted`.** The maintainer ruling of 2026-08-11 is recorded in §2. The technical
> findings of the distribution audit (§1) are unchanged from the Proposed draft — the ruling settled
> the decision, not the evidence.

---

## 1. Context

TAM OS currently ships two forms of the same application:

- **Model A — generated single file.** `dist/tam-os-v<version>.html`, produced by
  `tools/build-single-file.js`, which inlines `css/*.css` and `js/**` into `index.html`. This is the
  artifact attached to every GitHub Release.
- **Model B — application package.** The modular source itself: `index.html` + `css/` + `js/`.

The Readiness-3 release-candidate review raised the question of whether Model A should remain the
canonical distribution, or whether Model B should become canonical — explicitly asking that an
existing verifier assertion not be mistaken for an architectural requirement.

Two findings from that review force the question:

1. **Model A is not offline-capable.** `index.html` references Google Fonts and the SheetJS parser
   from CDNs, and `tools/build-single-file.js` states in its own header that it leaves those links
   untouched. The single-file artifact is therefore **single-file packaging, not a self-contained
   offline application**. `.xlsx` import does not work without internet access in *either* model.
2. **Model B is viable, including from `file://`.** Verified in a browser: `index.html` opened
   directly from disk boots fully — 73 classic scripts and 6 stylesheets load, `APP_VERSION` 2.10.0,
   `SCHEMA_VERSION` 6, `ACTIONS` 20, the parser loads, `localStorage` works, and there are **zero
   console errors**. The application contains **no `fetch`, `XMLHttpRequest`, `Worker`, or
   `importScripts` calls**, so the usual `file://` CORS failure modes do not apply to it at all.

Model A therefore cannot be justified on offline grounds, and Model B cannot be dismissed on
`file://` grounds. The decision rests on distribution integrity, verification strategy, and
governance cost.

## 2. Decision

**Ruled by the maintainer on 2026-08-11. The decision has two halves, and both are binding.**

**2.1 — For v2.10.0 and the controlled pilot: RETAIN Model A.**
`dist/tam-os-v2.10.0.html` remains the canonical pilot distribution artifact.

**2.2 — For the long term: Model B is APPROVED as the preferred future distribution architecture.**
`index.html` + application assets is the target. Migration is **deferred to a dedicated post-pilot
architecture milestone**, recorded as **Distribution-1 — Modular Distribution Migration** in
[Milestones.md](../05-milestones/Milestones.md). It must not be attempted inside the v2.10.0
release-candidate PR, nor partially.

**2.3 — The rationale is release-risk sequencing, NOT architectural merit.**
This is recorded explicitly because the distinction is load-bearing for anyone reading this later:

> **`REQUIRED` single-file dependencies = 0.**
>
> The audit traced every dependency on the single-file artifact through the build scripts, the
> verifier, CI, the release workflow, `index.html`, and the release paperwork. **None classified as
> REQUIRED.** They classified as 4 CONVENIENCE, 3 LEGACY and 125 VERIFIER-ONLY. In particular the
> 122 `dist.includes(...)` assertions depend on having one searchable concatenation of the JS, not
> on the distribution format — an in-memory concatenation of the source would serve them identically.
>
> **The single-file artifact is NOT fully offline or self-contained.** `index.html` loads the
> SheetJS parser and Google Fonts from CDNs, and `tools/build-single-file.js` states in its own
> header that it leaves those links untouched. `.xlsx` import requires network access in **both**
> distribution models. The accurate term is **single-file application package**, and the two
> external dependencies are: **SheetJS CDN — required for `.xlsx` import**, and **Google Fonts —
> cosmetic**.
>
> Model A is therefore retained **despite** having no architecturally required justification, purely
> because migrating during a release candidate carries unacceptable schedule and regression risk.
> Nothing in this record should be cited as evidence that single-file packaging is necessary.

Supporting rationale for the sequencing, in order of weight:

1. **Migration is a constitution change, not a tooling change.** The portable single-file build is
   written into `CLAUDE.md` in nine places — §3 (repository structure), §5.2/§5.4 (workflow),
   §10 (build process), §11.2 (verifier invariants), §12.1 (browser validation), §13.2 (release),
   §15.1 (git), and §19 (Definition of Done). `CLAUDE.md` §1 requires surfacing such a conflict
   rather than silently violating it, and the §20 approval matrix reserves architecture-level change
   for the maintainer. Migrating inside a release-candidate PR would invert that order.
2. **It would invalidate accepted evidence at the worst moment.** PR #134's functional acceptance is
   provisionally accepted. Changing the canonical package requires re-running the entire browser
   acceptance against the new package and rewriting the substrate of 122 verifier assertions, inside
   the very artifact under final review. That is a large regression surface introduced into an RC.
3. **The pilot benefit is marginal, and the operational risk is real.** Both models are equally
   non-offline. For a 1–3 person pilot of non-technical operators, a single double-clickable file
   with **one SHA-256 to verify** is more robust than a folder that can be partially copied, moved,
   or emailed as a broken subset — failure modes that surface as a blank page rather than an error.
   The rollback plan already instructs operators to verify an artifact hash before use.

**This is a deferral on sequencing and risk, not a rejection of Model B on merit** — and the ruling
in §2.2 makes that explicit by approving Model B as the future target. Section 4 records the
architectural argument in its favour.

**Constitution status (binding).** `CLAUDE.md` is **not amended** by this record, and was not
amended in PR #134. The existing single-file constitutional rules — §3 (repository structure),
§5.2/§5.4 (workflow), §10 (build process), §11.2 (verifier invariants), §12.1 (browser validation),
§13.2 (release), §15.1 (git) and §19 (Definition of Done) — **remain fully operative for v2.10.0**.
The future Model B migration **requires an explicit constitution amendment**, together with
replacement verifier, build and release rules. Those rules must be migrated as one deliberate
change: **partial migration is prohibited**, because a half-migrated constitution would leave the
build and verification contract self-contradictory.

## 3. Consequences

**Accepted by retaining Model A:**
- The source→dist divergence risk class persists, mitigated (not eliminated) by the verifier's build
  fidelity check.
- The build step remains a prerequisite for every release.
- 122 verifier assertions continue to use the built artifact as their search substrate, which
  couples content verification to the packaging format.

**Avoided:**
- A constitution amendment and a full re-acceptance cycle inside a release candidate.
- Distribution-integrity regressions for pilot operators.

**Explicitly corrected regardless of this decision:** documentation must not describe the artifact as
*self-contained* or *offline* without qualification. The accurate description is "a single-file
application package that still requires network access for web fonts and `.xlsx` import."

## 4. Alternatives Considered

### Model B — application package as canonical (`index.html` + `css/` + `js/`), shipped as a deterministic ZIP

**Rejected for now, on sequencing — not on merit.** Its central argument is strong and should be
weighed on its own terms at the next opportunity:

- **It eliminates the source/dist divergence risk class entirely.** Under Model B the package *is*
  the source, so "does the artifact match what we verified?" stops being a question that needs a
  guard. That is architecturally superior to detecting divergence after the fact.
- The 122 `dist.includes(...)` assertions do not actually depend on the *distribution* — they depend
  on having one searchable concatenation of the JS. An in-memory concatenation of the source serves
  them identically, so they are **VERIFIER-ONLY**, not REQUIRED.
- It is debuggable: real file paths and real stack traces instead of one 1.15 MB line-shifted file.
- Measured footprint: 79 files, 1,163,644 bytes concatenated, versus 1,151,267 bytes for Model A —
  essentially identical in size.

Its costs are distribution integrity for non-technical operators (mitigable with a deterministic
ZIP + recorded hash) and the governance/re-acceptance cost described in §2.

### Ship both, with Model B canonical and Model A a convenience download
Rejected: two canonical-ish artifacts is exactly the "second source of truth" the constitution
forbids (§4.4, §14.2), and it doubles the verification surface without removing either risk.

### Make the single file genuinely self-contained (inline SheetJS and fonts)
Not evaluated in depth here, and **not blocked by this ADR**. It is a separate, orthogonal decision:
it would make Model A actually offline-capable, at the cost of vendoring a third-party library into
the repository — which engages `CLAUDE.md` §6.2 (no new runtime dependencies) and the licensing
review that implies. Worth its own record if offline `.xlsx` import becomes a requirement.

## 5. Revalidation Trigger

Revisit this decision when **any** of the following occurs:

- Offline `.xlsx` import becomes a pilot or product requirement.
- The pilot ends and a general-availability packaging decision is taken.
- A source/dist divergence incident occurs despite the build-fidelity guard.
- The verifier is refactored such that its assertions no longer read the built artifact.
- Distribution moves to hosted HTTP rather than file hand-off.

## 6. Ruling — Given

The question put to the maintainer was:

> Does the canonical distribution for v2.10.0 remain the generated single file (Model A), or should
> the application package (Model B) become canonical before PR #134 merges?

**Ruling (2026-08-11):** Model A is retained for v2.10.0 and the controlled pilot; Model B is
approved as the preferred future architecture, with migration deferred to a dedicated post-pilot
milestone. PR #134 does not change the distribution format and does not amend `CLAUDE.md`.

### Carried forward to Distribution-1

The migration is tracked as **Distribution-1 — Modular Distribution Migration**
([Milestones.md](../05-milestones/Milestones.md)). It must carry, as one change:

- `index.html` + application assets as the canonical package
- an explicit `CLAUDE.md` amendment (§3, §5, §10, §11, §12, §13, §15, §19) — never partial
- a deterministic package builder producing a package directory and/or ZIP
- a package manifest and recorded canonical hash
- **replacement** of the single-file-only verifier assumptions — revised deliberately, never merely
  deleted. At minimum: entry point present; every JS/CSS asset present per the load-order manifest;
  `APP_VERSION` consistency across runtime, package and paperwork; package determinism;
  package↔source parity by hash; no missing runtime dependency; canonical package hash recorded
- CI artifact changes and release-workflow changes
- `CODEOWNERS` and path-rule updates (`.github/codeql/codeql-config.yml`) where needed
- a documented source/package parity model
- full browser re-acceptance against the new package — **not carried over** from the single file —
  including real `.xlsx` file-input acceptance, backup export/restore roundtrip, and reload
  persistence

The audit's classification of which old assertions are **LEGACY** versus still architecturally
meaningful is recorded in §1 and §4 of this record and must be revisited, not assumed, at migration
time.
