# ADR-0005 — SESSION-Only Production Package

| Field | Value |
|---|---|
| **Record** | ADR-0005 |
| **Title** | SESSION-only production package (LOCAL development modules excluded) |
| **Status** | Accepted |
| **Date created** | 2026-11-23 |
| **Author** | Repository maintainer |
| **Accountable approver** | Repository owner (CLAUDE.md §20) — Owner GO 2026-11-23 |
| **Supersedes** | — |
| **Superseded by** | — |
| **Related** | [ADR-0002](ADR-0002-canonical-distribution-architecture.md) (Model B package), [ADR-0004](ADR-0004-hostinger-same-origin-backend.md) (same-origin backend) |

> **What this is.** An Architecture Decision Record captures one architecture-level
> decision, why it was made, and what future event would require it to be revisited.
> It is immutable once Accepted: a later decision does not rewrite it, it supersedes it
> with a new ADR that links back (CLAUDE.md §14.4, §16.2).

## 1. Context

The shipped application runs only in SESSION mode (`AUTH_MODE` is fixed to SESSION in
`js/core/constants.js`), yet the deployment package still carried the whole LOCAL application:
`State`, its `localStorage` store, the LOCAL activity log, the LOCAL shell and the LOCAL business
pages. That code never ran, but it shipped, could be invoked from the browser console, and kept
browser-storage writers inside the production page (CodeQL alert #1 points at one of them,
`js/ui/activity-log.js`). LOCAL mode must stay available for development and its runtime harnesses.

## 2. Decision

1. `tools/module-order.js` stays the **one** canonical load order. It classifies the LOCAL-only modules
   (`localOnly`) and derives `productionOrder` — the canonical order without them, same relative
   order. No second order exists.
2. `index.html` lists exactly `productionOrder`. `tools/build-package.js` derives the package from it
   and refuses a LOCAL-only module. The package therefore contains no LOCAL-only module, referenced or not.
3. The shell part SESSION shares (the floating Actions menu, `NAV_GROUPS`, the drawer helpers and the
   `render()` facade) moves to `js/ui/shell-core.js`; `js/ui/shell-render.js` keeps the LOCAL shell,
   which `render()` reaches only through `renderLocalShell()` behind the LOCAL gate.
4. LOCAL development (`tools/serve-local-dev.js`) serves the package with the full canonical order
   restored in memory and the LOCAL-only modules served from `js/` in the source tree. The LOCAL
   runtime harnesses keep loading the full canonical order.
5. CodeQL keeps analysing every `js/` module; no source path is excluded. Alert #1 stays open because
   its source stays in the repository; this decision removes the code from the production package,
   not from analysis.
6. The vendored SheetJS parser stays in the package for now.

## 3. Consequences

- The production package shrinks from 110 to 44 files (30 modules plus the theme boot). It defines no
  `State` or `logActivity` and has no code path that reads or writes LOCAL business storage. The one
  appearance-only `tam_settings_v1` read in `js/boot/theme-boot.js` is unchanged.
- Adding a module now needs a classification decision: a LOCAL-only module is listed in `localOnly`,
  a production module is also added to `index.html`. `tools/verify-build.js` checks both and also
  checks that no production module names a LOCAL-only symbol, apart from the two guarded hand-overs.
- Opening the built package in LOCAL mode without `tools/serve-local-dev.js` no longer works.
- CodeQL alert #1 remains open as a finding in development-only source.

## 4. Alternatives Considered

- **Two manifests or two pages (separate build targets).** Rejected: two load orders drift apart,
  against the single-source rule (CLAUDE.md §2.4, §4.2).
- **Isolate only the activity log.** Rejected: dozens of LOCAL modules call `logActivity`, and the
  rest of the LOCAL store would still ship.
- **Excluding LOCAL source from CodeQL.** Rejected: it would hide the finding instead of resolving it.

## 5. Revalidation Trigger

- LOCAL mode is retired or moved out of the repository (alert #1 can then close by removal).
- A LOCAL-only capability is needed in SESSION, or the module classification needs a third class.
- SheetJS is no longer needed by any production module.

---

*Lifecycle: Proposed → Accepted → (Superseded | Deprecated). See
[`README.md`](README.md) for the register and lifecycle rules.*
