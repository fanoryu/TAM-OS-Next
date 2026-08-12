# Merge Standard

A merge brings an approved pull request into `main`. It is a distinct authorization from
implementation: an implementation Sprint Assignment never authorizes its own merge — a **separate**
merge SPR does. Merge is controlled, gated, and verified on both sides.

## Pre-merge gates

The merge proceeds only when **all** hold:

- [ ] PR is mergeable and conflict-free against `main`.
- [ ] Exactly one feature commit; diff limited to the approved files.
- [ ] Domain invariants intact: operational aggregate/command/query counts exactly as specified;
      aggregates and helpers pure; handlers own implementation.
- [ ] Verifier passes completely (the exact check count named by the SPR).
- [ ] CI and CodeQL green; no new CodeQL alerts.
- [ ] `APP_VERSION`, `SCHEMA_VERSION`, storage keys unchanged; golden master untouched.
- [ ] Generated `dist` matches source (or the PR is documentation-only).

**If any gate fails: stop. Do not merge. Return an incident report.**

## Merge mechanics

- Merge with a **merge commit** (the established practice: `Merge pull request #N from <branch>`),
  preserving the single feature commit beneath it.
- Delete the source branch on merge.
- A draft PR whose gates are all green is marked ready, then merged.

## Post-merge verification

After merging, confirm on `main`:

- [ ] The change is present (new modules/helpers exist; consumers reference them).
- [ ] Runtime behavior is identical; any equivalence check still holds.
- [ ] Verifier still passes the full check count.
- [ ] CI and CodeQL succeed on the merge commit; CodeQL baseline unchanged.
- [ ] No release workflow was triggered.
- [ ] Source branch is deleted; the PR is closed as merged.

## Authority

Merge is a human-authorized gate (`CLAUDE.md` §20). An AI assistant prepares the merge and verifies
the gates; the authorization to merge comes from the merge SPR and its approvers.
