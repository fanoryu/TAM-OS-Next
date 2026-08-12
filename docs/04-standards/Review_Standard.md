# Review Standard

Review confirms that a pull request is correct, in scope, and safe before it is authorized to merge.
Review is evidence-based (Core Value: *Evidence over Assumption*): every conclusion is backed by the
verifier, runtime checks, or observed behavior — not by trust.

## What a reviewer must confirm

### Scope and discipline
- The diff matches the files the [Sprint Assignment](SPR_Standard.md) authorized — nothing more.
- Exactly one feature commit; no drive-by changes; no speculative abstraction.

### Correctness
- The behavioral contract in the SPR is met: aggregate contract, command routing, handler authority,
  typed failures, and success path.
- Runtime verification covers the required cases with fabricated data, including failure and rollback
  paths — not just the happy path (*test to break, not to confirm*).
- For refactors, behavior is proven unchanged (e.g. a before/after equivalence check).

### Domain integrity
- Aggregates and helpers remain pure; handlers remain the implementation authority.
- No client bypasses the Domain to reach state directly.
- Operational counts (aggregates, commands, queries) are exactly as the SPR specifies.

### Safety and invariants
- Verifier passes completely; CI and CodeQL are green with no new alerts.
- `APP_VERSION`, `SCHEMA_VERSION`, storage keys, and the CSS golden master are unchanged unless the
  SPR authorizes a documented migration.
- No secrets or real company data anywhere; fabricated placeholders only.

### Documentation
- Affected documentation is updated in the same change; indexes and cross-references resolve.

## Verdict

- **Approve** only when every applicable item above holds.
- **Request changes** with specific, reproducible findings — ranked by severity, each naming the file
  and the failure scenario.
- If a gate fails, the review does not "approve with reservations"; the PR returns to the implementer.

Review approval is a human authority. It authorizes the PR for a **merge** decision (see the
[Merge Standard](Merge_Standard.md)); it does not itself merge.
