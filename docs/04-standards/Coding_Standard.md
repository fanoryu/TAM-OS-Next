# Coding Standard

Code in TAM Intelligence OS is boring on purpose. It matches its surroundings, holds the
architecture, and keeps business truth in the Domain.

## Style
- **Match the surrounding code.** Naming, indentation, comment density, and idioms should be
  indistinguishable from the neighboring module.
- **Explicit over clever.** Prefer readable code a stranger can verify quickly over a compact
  abstraction (Core Value: *Clarity over Cleverness*).
- **No dead code or speculative abstraction.** Add structure when a second caller exists, not before.

## Architecture
- **Shared global scope, classic scripts.** No ES modules, `import`/`export`, `type="module"`, or
  bundler. No new runtime dependencies, frameworks, or build steps.
- **Load order is behavior-critical.** It lives once in `tools/module-order.js`, mirrored by
  `index.html`. Add or move a module → update both together, in the same order.
- **One source of truth.** Version, schema, and load order are each defined once; everything else
  derives from or links to them. Never hardcode a version in tooling.

## Domain rules
- **Aggregates decide; handlers implement.** An aggregate's `prepare` is pure — no `State` mutation,
  no `persistEmployees()`, no history, no `updatedAt`, no render, no `localStorage`, no audit. All
  side effects live in the handler.
- **Route operational reads/writes through the facade.** Operational reads are registered queries;
  operational writes are registered commands with a handler (and, where a decision is involved, a
  boundary aggregate). No hidden dispatch path.
- **Handlers are atomic.** Mutate only allowed fields, update `updatedAt`, append exactly one history
  entry, persist exactly once, and roll back fully on a failed persist.
- **Helpers are pure support, not authority.** Shared helpers reduce duplication; they never hold
  business rules or perform side effects. No aggregate framework.

## Safety
- **Escape untrusted data (MUST).** Any employee/company-supplied value rendered into the DOM is
  escaped; never build HTML from unescaped user data.
- **Precise money math.** Full precision internally; round only the final payable amount, using the
  existing helpers.
- **Fail loudly in tooling, gracefully in UI.** Build/verify tools throw clearly on bad input; the UI
  degrades without data loss.
- **Never introduce secrets or real company data.** Fabricated placeholders only, everywhere.

The enforceable, rule-numbered form of these expectations is `CLAUDE.md` §4–§9; this standard
summarizes them for day-to-day coding.
