# SPR Standard — Sprint Assignments

A **Sprint Assignment (SPR)** authorizes one unit of work. It is the layer of the
[Governance Pyramid](../00-governance/Project_Governance.md) between the Standards and a Pull Request:
it grants scope and states the gates the work must pass. No implementation begins without one.

## What an SPR must state

1. **Status and approval.** Explicit authorization (Founder and CTO/Atlas approval) before any
   implementation.
2. **Mission and objective.** What is being built and why, in one clear statement.
3. **Scope limit.** The exact files expected to change, and an explicit list of what must **not**
   change. Anything outside the named scope is out of bounds.
4. **Behavioral contract.** For Domain work: the aggregate contract, command routing, handler
   authority, typed failures, and success path — stated precisely.
5. **Invariants to hold.** `APP_VERSION`, `SCHEMA_VERSION`, storage keys, golden master, and any
   count invariants (e.g. number of operational aggregates/commands/queries).
6. **Verification required.** The verifier expectations and the runtime cases to exercise with
   **fabricated data only**.
7. **Discipline.** Exactly one feature commit; no drive-by cleanup; no speculative abstraction.
8. **Branch, commit message, and PR title.** Named explicitly.
9. **Pre-review gates.** The conditions that must all pass before the PR may leave draft.
10. **Return format.** The structured report expected back.

## One SPR, one purpose

An SPR authorizes a single intent (Law IX). It may not bundle unrelated changes, and its PR may not
exceed the scope it granted. If the work reveals a needed change outside scope, that is surfaced for a
separate SPR — not absorbed.

## The failure rule

Every SPR carries an explicit stop condition: **if any gate fails, stop — do not merge, do not expand
scope, return an incident report.** Gates are pass/fail, not negotiable.

## Lifecycle

`Authorized → Implemented (draft PR) → Gates green (ready) → Reviewed → Merge-authorized (a separate
SPR) → Merged`. Implementation and merge are distinct authorizations: an implementation SPR never
authorizes its own merge.
